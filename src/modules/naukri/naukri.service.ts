import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Page, Locator, BrowserContext } from 'playwright';
import { promises as fs } from 'fs';
import { resolve } from 'path';
import * as readline from 'readline';
import { compareTwoStrings } from 'string-similarity';
import { BrowserService } from '../browser/browser.service';
import { AnswerBankService } from './answer-bank.service';
import { HrLookupService } from './hr-lookup.service';
import { JobDetails, Profile, RunState, UnknownQuestion } from './types';

const PROFILE_PATH = resolve('./data/profile.json');
const STATE_PATH = resolve('./data/state.json');
const APPLIED_DIR = resolve('./data/applied');
const SKIPPED_DIR = resolve('./data/skipped');
const RECOMMENDED_URL = 'https://www.naukri.com/mnjuser/recommendedjobs';

const CSV_COLUMNS: (keyof JobDetails)[] = [
    'appliedAt', 'status', 'title', 'company', 'location', 'salary',
    'experienceRequired', 'postedAgo', 'recruiterName', 'recruiterEmail', 'recruiterPhone',
    'hrEmail', 'hrPhone', 'hrSource', 'keyword', 'url', 'description', 'note',
];

@Injectable()
export class NaukriService implements OnApplicationBootstrap {
    private readonly logger = new Logger(NaukriService.name);
    private profile!: Profile;
    private appliedThisRun = 0;
    private seenKeys = new Set<string>();

    constructor(
        private readonly browser: BrowserService,
        private readonly answerBank: AnswerBankService,
        private readonly hrLookup: HrLookupService,
    ) {}

    async onApplicationBootstrap() {
        setTimeout(() => {
            this.run().catch((err) => this.logger.error(`Run failed: ${err?.message || err}`, err?.stack));
        }, 1500);
    }

    async run() {
        this.profile = JSON.parse(await fs.readFile(PROFILE_PATH, 'utf-8')) as Profile;
        await this.answerBank.load();
        await this.ensureCsvFiles();
        await this.loadDedupIndex();
        this.logger.log(`Dedup index loaded: ${this.seenKeys.size} previously seen company-role pairs.`);

        const state = await this.loadState();
        const today = this.todayKey();
        const max = this.profile.search.maxApplicationsPerRun ?? 50;

        this.appliedThisRun = await this.countAppliedToday();
        this.logger.log(`Already applied today: ${this.appliedThisRun} / ${max}`);

        if (state.dailyLimitHitOn === today || this.appliedThisRun >= max) {
            if (this.appliedThisRun >= max) {
                await this.markDailyLimitHit();
                this.logger.warn(`Daily quota reached (${this.appliedThisRun}/${max}). Stopping.`);
            } else {
                this.logger.warn(`Daily Naukri apply limit was already hit today (${today}).`);
            }
            return;
        }

        const page = this.browser.getPage();
        await page.goto('https://www.naukri.com/mnjuser/homepage', { waitUntil: 'domcontentloaded' });
        await this.waitForLoginConfirm(page);

        try {
            await this.processViaMultiApply(page, max);
        } catch (err: any) {
            this.logger.warn(`Flow failed: ${err?.message || err}`);
        }

        await this.saveState({
            ...state,
            lastRunAt: new Date().toISOString(),
            appliedTotal: (state.appliedTotal ?? 0) + this.appliedThisRun,
        });
        this.logger.log(`Done. Applied ${this.appliedThisRun} jobs this run.`);
    }

    private async waitForLoginConfirm(page: Page) {
        this.logger.log('\n>>> Log in to Naukri in the Chrome window. <<<');
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        await new Promise<void>((res) => rl.question('Press ENTER when logged in... ', () => { rl.close(); res(); }));
        this.logger.log(`Continuing. URL: ${page.url()}`);
    }

    /** Multi-apply via checkboxes: select up to 5 unchecked job tuples, click "Apply N Jobs", handle questionnaire, repeat. */
    private async processViaMultiApply(page: Page, maxTotal: number) {
        const today = this.todayKey();
        const BATCH = 5;
        let consecutiveEmpty = 0;

        while (this.appliedThisRun < maxTotal) {
            if ((await this.loadState()).dailyLimitHitOn === today) {
                this.logger.warn('Daily limit flag hit. Stopping.');
                return;
            }

            // Always start fresh on the recommended jobs page
            if (!(await this.gotoWithRetry(page, RECOMMENDED_URL))) return;

            try {
                await page.waitForSelector('article.jobTuple', { timeout: 15000 });
            } catch {
                this.logger.warn('No job tuples loaded.');
                return;
            }
            await page.waitForTimeout(2000);

            // Scroll to lazy-load more
            for (let i = 0; i < 6; i++) {
                await page.evaluate(() => window.scrollBy(0, document.body.scrollHeight)).catch(() => null);
                await page.waitForTimeout(800);
            }
            await page.evaluate(() => window.scrollTo(0, 0)).catch(() => null);
            await page.waitForTimeout(800);

            // Pick up to BATCH unchecked, non-dup tuples
            const tuples = await this.collectAvailableTuples(page);
            this.logger.log(`Found ${tuples.length} unchecked tuples on the page.`);

            const remaining = maxTotal - this.appliedThisRun;
            const want = Math.min(BATCH, remaining);
            const selected: { article: Locator; details: JobDetails }[] = [];
            for (const t of tuples) {
                if (selected.length >= want) break;
                if (this.seenKeys.has(this.dedupKey(t.details.company, t.details.title))) continue;
                if (!this.isRelevant(t.details.title, t.details.description)) continue;
                selected.push(t);
            }

            if (selected.length === 0) {
                consecutiveEmpty++;
                this.logger.warn(`No selectable jobs this iteration (consecutiveEmpty=${consecutiveEmpty}).`);
                if (consecutiveEmpty >= 2) {
                    this.logger.warn('No more jobs to apply. Stopping.');
                    return;
                }
                continue;
            }
            consecutiveEmpty = 0;

            this.logger.log(`Selecting ${selected.length} jobs:`);
            for (const s of selected) {
                this.logger.log(`  - ${s.details.title} @ ${s.details.company}`);
            }

            // Click each tuple's checkbox icon
            for (const s of selected) {
                const checkbox = s.article.locator('.tuple-check-box').first();
                await checkbox.scrollIntoViewIfNeeded().catch(() => null);
                await checkbox.click({ timeout: 5000 }).catch((e) => this.logger.warn(`Checkbox click failed: ${e?.message}`));
                await page.waitForTimeout(300);
            }

            // Click "Apply N Jobs"
            const applyBtn = page.locator('button.multi-apply-button').first();
            if (!(await applyBtn.isVisible().catch(() => false))) {
                this.logger.warn('Multi-apply button not visible.');
                continue;
            }
            const btnText = (await applyBtn.innerText().catch(() => '')).toLowerCase();
            this.logger.log(`Clicking "${btnText}"`);
            await applyBtn.click().catch(() => null);
            await page.waitForTimeout(2500);

            // Daily limit check
            const limitMsg = page.locator('text=/exceeded|daily.*limit|limit reached|tomorrow/i').first();
            if (await limitMsg.isVisible().catch(() => false)) {
                this.logger.warn('Daily limit reached. Saving state.');
                await this.markDailyLimitHit();
                this.appliedThisRun = maxTotal;
                return;
            }

            // Handle chatbot Q&A (or success if no questions)
            const result = await this.handleChatbotQuestionnaire(page, selected.map((s) => s.details.title).join(', '));

            if (result === 'skip') {
                this.logger.warn('User skipped — logging this batch as skipped.');
                for (const s of selected) {
                    s.details.status = 'skipped';
                    s.details.note = 'user skipped during Q';
                    await this.enrichWithHrAndLog(this.browser.getContext(), s.details);
                }
                await page.waitForTimeout(1500);
                continue;
            }

            // Success: log all selected as applied
            for (const s of selected) {
                this.appliedThisRun++;
                s.details.status = 'applied';
                await this.logJob(s.details);
                this.logger.log(`Applied (${this.appliedThisRun}): ${s.details.title} @ ${s.details.company}`);
                if (this.appliedThisRun >= maxTotal) {
                    await this.markDailyLimitHit();
                    return;
                }
            }
            await page.waitForTimeout(2000);
        }
    }

    /** One-shot extraction of all visible job tuples via $$eval (no per-locator timeouts). */
    private async collectAvailableTuples(page: Page): Promise<{ article: Locator; details: JobDetails }[]> {
        const raw = await page.$$eval('article.jobTuple', (arts) =>
            arts.map((a) => {
                const q = (sel: string) => (a.querySelector(sel) as HTMLElement | null);
                const txt = (sel: string) => (q(sel)?.innerText || '').trim();
                const attr = (sel: string, name: string) => (q(sel)?.getAttribute(name) || '').trim();
                const iconClass = attr('.tuple-check-box i', 'class');
                return {
                    dataJobId: a.getAttribute('data-job-id') || '',
                    iconClass,
                    title: attr('p.title', 'title') || txt('p.title') || 'Unknown',
                    company: attr('span.subTitle', 'title') || txt('span.subTitle') || 'Unknown',
                    exp: txt('li.placeHolderLi.experience span'),
                    salary: txt('li.placeHolderLi.salary span'),
                    location: txt('li.placeHolderLi.location span'),
                    postedAgo: txt('.jobTupleFooter .type span'),
                    description: attr('.job-description span', 'title'),
                };
            }),
        );
        this.logger.log(`Total tuples on page: ${raw.length}`);
        const freshDays = this.profile.search.freshnessDays ?? 10;
        const out: { article: Locator; details: JobDetails }[] = [];
        for (const r of raw) {
            if (!r.iconClass.includes('naukicon-ot-checkbox')) continue; // skip already checked / applied / no-checkbox
            const ageDays = this.parseAgeDays(r.postedAgo);
            if (ageDays != null && ageDays > freshDays) continue;
            const article = page.locator(`article.jobTuple[data-job-id="${r.dataJobId}"]`).first();
            out.push({
                article,
                details: {
                    title: r.title,
                    company: r.company,
                    url: r.dataJobId ? `https://www.naukri.com/job-listings-${r.dataJobId}` : page.url(),
                    keyword: 'recommended',
                    location: r.location,
                    salary: r.salary,
                    experienceRequired: r.exp,
                    postedAgo: r.postedAgo,
                    description: r.description,
                    status: 'skipped',
                },
            });
        }
        return out;
    }

    /** Handles the Naukri chatbot Q&A drawer that appears after multi-apply. */
    private async handleChatbotQuestionnaire(page: Page, batchLabel: string): Promise<'done' | 'skip'> {
        const MAX_LOOPS = 60;
        let prevQuestion = '';

        for (let i = 0; i < MAX_LOOPS; i++) {
            await page.waitForTimeout(1500);

            const drawer = page.locator('.chatbot_DrawerContentWrapper, ._chatBotContainer, [class*="chatbot_Drawer"]').first();
            const visible = await drawer.isVisible().catch(() => false);
            if (!visible) {
                // success path: confirm "applied successfully" or just no popup
                const success = page.locator('text=/applied successfully|application sent|successfully applied/i').first();
                if (await success.isVisible().catch(() => false)) return 'done';
                // wait one more iteration in case popup is animating
                if (i > 2) return 'done';
                continue;
            }

            // Last bot question
            const lastQ = page.locator('.botMsg').last();
            const question = (await lastQ.innerText().catch(() => '')).trim();
            if (!question || question === prevQuestion) {
                // give it a moment in case nothing changed yet
                if (i > 5) return 'done';
                continue;
            }
            prevQuestion = question;
            this.logger.log(`Q: ${question}`);

            // Detect input type
            const chips = page.locator('.chatbot_Chip:not(:has-text("Skip this question"))');
            const chipCount = await chips.count().catch(() => 0);
            const radioOpts = page.locator('label:has(input[type="radio"])');
            const radioCount = await radioOpts.count().catch(() => 0);
            const checkboxOpts = page.locator('label:has(input[type="checkbox"])');
            const checkCount = await checkboxOpts.count().catch(() => 0);
            const textArea = page.locator('div.textArea[contenteditable="true"]').last();
            const hasText = (await textArea.count().catch(() => 0)) > 0 && await textArea.isVisible().catch(() => false);
            const numberInput = page.locator('input[type="number"]:visible').last();
            const hasNumber = (await numberInput.count().catch(() => 0)) > 0;

            let fieldType: UnknownQuestion['fieldType'] = 'unknown';
            let options: string[] | undefined;
            if (chipCount > 0) {
                fieldType = 'radio';
                options = await chips.allInnerTexts();
            } else if (radioCount > 0) {
                fieldType = 'radio';
                options = await radioOpts.allInnerTexts();
            } else if (checkCount > 0) {
                fieldType = 'checkbox';
                options = await checkboxOpts.allInnerTexts();
            } else if (hasNumber) {
                fieldType = 'number';
            } else if (hasText) {
                fieldType = 'text';
            }

            // Match in answer bank
            let answer = this.answerBank.findAnswer(question)?.answer ?? null;
            if (!answer) {
                answer = await this.answerBank.askUserAndLearn({
                    question, options, fieldType,
                    seenAt: new Date().toISOString(),
                    jobTitle: batchLabel,
                    jobUrl: page.url(),
                });
                if (answer === '__SKIP__') return 'skip';
            }

            // Fill
            if (fieldType === 'radio' && options) {
                const idx = this.bestOptionIndex(options, answer);
                const target = chipCount > 0 ? chips : radioOpts;
                if (idx >= 0) await target.nth(idx).click().catch(() => null);
                else await target.first().click().catch(() => null);
            } else if (fieldType === 'checkbox' && options) {
                const idx = this.bestOptionIndex(options, answer);
                if (idx >= 0) await checkboxOpts.nth(idx).click().catch(() => null);
            } else if (fieldType === 'number') {
                await numberInput.fill(answer).catch(() => null);
            } else if (fieldType === 'text') {
                await textArea.click().catch(() => null);
                await page.keyboard.type(answer, { delay: 20 }).catch(() => null);
            }

            await page.waitForTimeout(700);

            // Click Save / Send
            const send = page.locator('div.sendMsg:not(.disabled), button:has-text("Save")').first();
            await send.click().catch(() => null);
            await page.waitForTimeout(1200);
        }
        return 'done';
    }

    private bestOptionIndex(options: string[], answer: string): number {
        const a = answer.toLowerCase().trim();
        let best = -1, bestScore = 0;
        for (let i = 0; i < options.length; i++) {
            const o = options[i].toLowerCase().trim();
            if (o === a) return i;
            if (o.includes(a) || a.includes(o)) return i;
            const s = compareTwoStrings(o, a);
            if (s > bestScore) { bestScore = s; best = i; }
        }
        return bestScore > 0.4 ? best : -1;
    }

    private parseAgeDays(s?: string): number | null {
        if (!s) return null;
        const t = s.toLowerCase();
        if (t.includes('just now') || t.includes('few hour') || t.includes('hour')) return 0;
        const m = t.match(/(\d+)\s*(day|week|month|year)/);
        if (!m) return null;
        const n = parseInt(m[1], 10);
        const unit = m[2];
        if (unit === 'day') return n;
        if (unit === 'week') return n * 7;
        if (unit === 'month') return n * 30;
        if (unit === 'year') return n * 365;
        return null;
    }

    private isRelevant(title: string, description?: string): boolean {
        const hay = this.normalize(`${title} ${description ?? ''}`);
        const tokens = new Set<string>();
        for (const k of this.profile.search.keywords || []) for (const t of this.normalize(k).split(' ')) if (t.length > 2) tokens.add(t);
        for (const s of this.profile.professional?.primarySkills || []) for (const t of this.normalize(s).split(' ')) if (t.length > 2) tokens.add(t);
        for (const t of tokens) if (hay.includes(t)) return true;
        return false;
    }

    private async gotoWithRetry(page: Page, url: string, attempts = 3): Promise<boolean> {
        for (let i = 0; i < attempts; i++) {
            try {
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            } catch (err: any) {
                const msg = err?.message || String(err);
                if (/closed|detached|Target/i.test(msg)) { this.logger.warn('Browser closed.'); return false; }
                this.logger.warn(`goto failed (try ${i + 1}): ${msg}`);
                await page.waitForTimeout(2000);
                continue;
            }
            await page.waitForTimeout(2000);
            const oops = page.locator('text=/Oops|Something went wrong|error loading/i').first();
            if (await oops.isVisible().catch(() => false)) {
                const reload = page.locator('button:has-text("Reload"), a:has-text("Reload")').first();
                if (await reload.isVisible().catch(() => false)) await reload.click().catch(() => null);
                else await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => null);
                await page.waitForTimeout(3000);
                if (!(await oops.isVisible().catch(() => false))) return true;
                continue;
            }
            return true;
        }
        return false;
    }

    private async enrichWithHrAndLog(ctx: BrowserContext, details: JobDetails) {
        if (!details.recruiterEmail && !details.recruiterPhone) {
            try {
                const found = await this.hrLookup.lookup(ctx, details.company);
                if (found.email) details.hrEmail = found.email;
                if (found.phone) details.hrPhone = found.phone;
                if (found.source) details.hrSource = found.source;
            } catch (err: any) {
                this.logger.warn(`HR lookup error: ${err?.message || err}`);
            }
        }
        await this.logJob(details);
    }

    // ---- Dedup ----

    private normalize(s: string): string {
        return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
    }

    private dedupKey(company: string, role: string): string {
        return `${this.normalize(company)}|${this.normalize(role)}`;
    }

    private async loadDedupIndex(): Promise<void> {
        this.seenKeys.clear();
        for (const dir of [APPLIED_DIR, SKIPPED_DIR]) {
            let files: string[] = [];
            try { files = await fs.readdir(dir); } catch { continue; }
            for (const f of files) {
                if (!f.endsWith('.csv')) continue;
                const text = await fs.readFile(`${dir}/${f}`, 'utf-8').catch(() => '');
                const lines = text.split(/\r?\n/);
                if (lines.length < 2) continue;
                const header = this.parseCsvRow(lines[0]);
                const titleIdx = header.indexOf('title');
                const companyIdx = header.indexOf('company');
                if (titleIdx < 0 || companyIdx < 0) continue;
                for (let i = 1; i < lines.length; i++) {
                    if (!lines[i].trim()) continue;
                    const cols = this.parseCsvRow(lines[i]);
                    const company = cols[companyIdx];
                    const role = cols[titleIdx];
                    if (company && role) this.seenKeys.add(this.dedupKey(company, role));
                }
            }
        }
    }

    private parseCsvRow(line: string): string[] {
        const out: string[] = [];
        let cur = '';
        let inQ = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (inQ) {
                if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
                else if (ch === '"') { inQ = false; }
                else { cur += ch; }
            } else {
                if (ch === ',') { out.push(cur); cur = ''; }
                else if (ch === '"') { inQ = true; }
                else { cur += ch; }
            }
        }
        out.push(cur);
        return out;
    }

    // ---- State ----

    private todayKey(): string {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    private async loadState(): Promise<RunState> {
        try { return JSON.parse(await fs.readFile(STATE_PATH, 'utf-8')) as RunState; }
        catch { return {}; }
    }

    private async saveState(state: RunState): Promise<void> {
        await fs.mkdir(resolve('./data'), { recursive: true }).catch(() => null);
        await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2), 'utf-8');
    }

    private async markDailyLimitHit(): Promise<void> {
        const state = await this.loadState();
        await this.saveState({
            ...state,
            dailyLimitHitOn: this.todayKey(),
            lastRunAt: new Date().toISOString(),
            appliedTotal: (state.appliedTotal ?? 0) + this.appliedThisRun,
        });
    }

    private async countAppliedToday(): Promise<number> {
        const file = `${APPLIED_DIR}/${this.todayKey()}.csv`;
        try {
            const text = await fs.readFile(file, 'utf-8');
            const lines = text.split(/\r?\n/).filter((l) => l.trim());
            return Math.max(0, lines.length - 1);
        } catch {
            return 0;
        }
    }

    private async ensureCsvFiles() {
        await fs.mkdir(APPLIED_DIR, { recursive: true }).catch(() => null);
        await fs.mkdir(SKIPPED_DIR, { recursive: true }).catch(() => null);
    }

    private async logJob(job: JobDetails) {
        if (!job.appliedAt) job.appliedAt = new Date().toISOString();
        const dir = job.status === 'applied' ? APPLIED_DIR : SKIPPED_DIR;
        const file = `${dir}/${this.todayKey()}.csv`;
        try { await fs.access(file); }
        catch { await fs.writeFile(file, CSV_COLUMNS.join(',') + '\n', 'utf-8'); }
        const row = CSV_COLUMNS.map((c) => csvSafe(String((job as any)[c] ?? ''))).join(',') + '\n';
        await fs.appendFile(file, row, 'utf-8');
        this.seenKeys.add(this.dedupKey(job.company, job.title));
    }
}

function csvSafe(s: string): string {
    if (!s) return '';
    const clean = s.replace(/\r?\n/g, ' ').replace(/"/g, '""').slice(0, 2000);
    return /[,"]/.test(clean) ? `"${clean}"` : clean;
}
