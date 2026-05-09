import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Page, Locator } from 'playwright';
import { promises as fs } from 'fs';
import { resolve } from 'path';
import * as readline from 'readline';
import { compareTwoStrings } from 'string-similarity';
import { BrowserService } from '../browser/browser.service';
import { AnswerBankService } from './answer-bank.service';
import { AppliedJob, Profile, RunState, UnknownQuestion } from './types';

const PROFILE_PATH = resolve('./data/profile.json');
const APPLIED_CSV = resolve('./data/applied-jobs.csv');
const STATE_PATH = resolve('./data/state.json');

@Injectable()
export class NaukriService implements OnApplicationBootstrap {
    private readonly logger = new Logger(NaukriService.name);
    private profile!: Profile;
    private appliedThisRun = 0;

    constructor(
        private readonly browser: BrowserService,
        private readonly answerBank: AnswerBankService,
    ) {}

    async onApplicationBootstrap() {
        setTimeout(() => {
            this.run().catch((err) => this.logger.error(`Run failed: ${err?.message || err}`, err?.stack));
        }, 1500);
    }

    async run() {
        this.profile = JSON.parse(await fs.readFile(PROFILE_PATH, 'utf-8')) as Profile;
        await this.answerBank.load();
        await this.ensureCsvHeader();

        const state = await this.loadState();
        const today = this.todayKey();
        if (state.dailyLimitHitOn === today) {
            this.logger.warn(`Daily Naukri apply limit was already hit today (${today}). Nothing to do. Try again tomorrow.`);
            return;
        }

        const page = this.browser.getPage();
        await page.goto('https://www.naukri.com/mnjuser/homepage', { waitUntil: 'domcontentloaded' });

        await this.waitForLoginConfirm(page);

        const max = this.profile.search.maxApplicationsPerRun ?? 50;
        for (const keyword of this.profile.search.keywords) {
            if (this.appliedThisRun >= max) break;
            if ((await this.loadState()).dailyLimitHitOn === today) break;
            this.logger.log(`\n===== Searching: "${keyword}" =====`);
            try {
                await this.searchAndApply(page, keyword, max);
            } catch (err: any) {
                this.logger.warn(`Keyword "${keyword}" failed: ${err?.message || err}`);
            }
        }

        await this.saveState({
            ...state,
            lastRunAt: new Date().toISOString(),
            appliedTotal: (state.appliedTotal ?? 0) + this.appliedThisRun,
        });
        this.logger.log(`Done. Applied ${this.appliedThisRun} jobs this run.`);
    }

    private async waitForLoginConfirm(page: Page) {
        this.logger.log('\n>>> A Chrome window has opened. Please log in to Naukri (Google/email/password). <<<');
        this.logger.log('>>> Once you see your Naukri homepage, return to this terminal. <<<');
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        await new Promise<void>((res) => rl.question('Press ENTER when logged in... ', () => { rl.close(); res(); }));
        this.logger.log(`Continuing. Current URL: ${page.url()}`);
    }

    private async searchAndApply(page: Page, keyword: string, maxTotal: number) {
        const slug = keyword.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-+|-+$/g, '');
        const minE = this.profile.search.minExperienceYears;
        const fresh = this.profile.search.freshnessDays ?? 1;
        const sortPart = (this.profile.search.sortBy ?? 'date') === 'date' ? '&sort=date' : '';
        const url = `https://www.naukri.com/${slug}-jobs?experience=${minE}&jobAge=${fresh}${sortPart}`;
        this.logger.log(`URL: ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2500);

        let pageNum = 1;
        const today = this.todayKey();
        while (this.appliedThisRun < maxTotal) {
            if ((await this.loadState()).dailyLimitHitOn === today) return;

            const cards = page.locator('.srp-jobtuple-wrapper, article.jobTuple, .jobTuple');
            const count = await cards.count();
            if (count === 0) {
                this.logger.warn('No job cards found on this page. Moving on.');
                break;
            }
            this.logger.log(`Page ${pageNum}: ${count} jobs.`);

            for (let i = 0; i < count; i++) {
                if (this.appliedThisRun >= maxTotal) break;
                if ((await this.loadState()).dailyLimitHitOn === today) return;
                const card = cards.nth(i);
                try {
                    await this.applyToJobFromCard(page, card, keyword);
                } catch (err: any) {
                    this.logger.warn(`Card ${i} failed: ${err?.message || err}`);
                }
            }

            const nextBtn = page.locator('a:has-text("Next"), .styles_btn-secondary__2AsIP:has-text("Next")').first();
            if (await nextBtn.isVisible().catch(() => false)) {
                await nextBtn.click().catch(() => null);
                await page.waitForTimeout(2500);
                pageNum++;
            } else {
                break;
            }
        }
    }

    private async applyToJobFromCard(_listingPage: Page, card: Locator, keyword: string) {
        const titleLink = card.locator('a.title, a.jobTitle').first();
        const title = (await titleLink.innerText().catch(() => '')) || 'Unknown';
        const href = await titleLink.getAttribute('href').catch(() => null);
        if (!href) return;

        const company = (await card.locator('.comp-name, a.subTitle, .companyInfo a').first().innerText().catch(() => '')) || 'Unknown';

        const ctx = this.browser.getContext();
        const detailPage = await ctx.newPage();
        try {
            await detailPage.goto(href, { waitUntil: 'domcontentloaded' });
            await detailPage.waitForTimeout(2000);

            const applyBtn = detailPage.locator(
                'button#apply-button, button.apply-button, button:has-text("Apply"), #apply-button',
            ).first();

            if (!(await applyBtn.isVisible().catch(() => false))) {
                this.logger.log(`SKIP (no apply btn): ${title} @ ${company}`);
                await this.logApplied({ title, company, url: detailPage.url(), keyword, status: 'skipped', note: 'no apply button' });
                return;
            }

            const btnText = (await applyBtn.innerText().catch(() => '')).toLowerCase();
            if (btnText.includes('company site') || btnText.includes('register')) {
                this.logger.log(`SKIP (external/register): ${title}`);
                await this.logApplied({ title, company, url: detailPage.url(), keyword, status: 'skipped', note: 'external apply' });
                return;
            }

            this.logger.log(`Applying: ${title} @ ${company}`);
            await applyBtn.click().catch(() => null);
            await detailPage.waitForTimeout(2500);

            const limitMsg = detailPage.locator('text=/exceeded|daily.*limit|limit reached|apply.*limit|tomorrow/i').first();
            if (await limitMsg.isVisible().catch(() => false)) {
                this.logger.warn('Daily Naukri apply limit reached. Saving state, stopping.');
                await this.markDailyLimitHit();
                this.appliedThisRun = this.profile.search.maxApplicationsPerRun;
                return;
            }

            const already = detailPage.locator('text=/already applied|applied successfully/i').first();
            if (await already.isVisible().catch(() => false)) {
                const text = (await already.innerText().catch(() => '')).toLowerCase();
                if (text.includes('already')) {
                    this.logger.log(`Already applied: ${title}`);
                    await this.logApplied({ title, company, url: detailPage.url(), keyword, status: 'skipped', note: 'already applied' });
                    return;
                }
                if (text.includes('successfully')) {
                    this.appliedThisRun++;
                    await this.logApplied({ title, company, url: detailPage.url(), keyword, status: 'applied' });
                    this.logger.log(`Applied (${this.appliedThisRun}): ${title}`);
                    return;
                }
            }

            const handled = await this.handleQuestionnaire(detailPage, title);
            if (handled === 'skip') {
                await this.logApplied({ title, company, url: detailPage.url(), keyword, status: 'skipped', note: 'user skipped during Q' });
                return;
            }

            await detailPage.waitForTimeout(2500);
            const success = detailPage.locator('text=/applied successfully|application sent|successfully applied/i').first();
            if (await success.isVisible().catch(() => false)) {
                this.appliedThisRun++;
                await this.logApplied({ title, company, url: detailPage.url(), keyword, status: 'applied' });
                this.logger.log(`Applied (${this.appliedThisRun}): ${title}`);
            } else {
                await this.logApplied({ title, company, url: detailPage.url(), keyword, status: 'failed', note: 'no success confirmation' });
                this.logger.warn(`No confirmation: ${title}`);
            }
        } finally {
            await detailPage.close().catch(() => null);
        }
    }

    private async handleQuestionnaire(page: Page, jobTitle: string): Promise<'done' | 'skip'> {
        const MAX_LOOPS = 25;
        for (let i = 0; i < MAX_LOOPS; i++) {
            await page.waitForTimeout(1200);

            const qContainer = page.locator('.chatbot_DrawerContentWrapper, .chatbot_MainContainer, .chatbot_QnA, ._chatbot, .chatbot_ChatBody').first();
            const questionVisible = await qContainer.isVisible().catch(() => false);
            if (!questionVisible) return 'done';

            const lastQ = page.locator('.botMsg, .chatbot_botMsg, li.botMsg span, .chatbot_BotMsgRow').last();
            const question = (await lastQ.innerText().catch(() => '')).trim();
            if (!question) {
                this.logger.warn('Could not read question text. Stopping questionnaire.');
                return 'done';
            }

            const radioOpts = page.locator('.ssrc__radio-btn-container label, .chatBot_RadioBtns label, label:has(input[type="radio"])');
            const checkboxOpts = page.locator('label:has(input[type="checkbox"])');
            const textInput = page.locator('div[contenteditable="true"], textarea.textArea, input[type="text"]:visible').last();
            const numberInput = page.locator('input[type="number"]:visible').last();

            const radioCount = await radioOpts.count().catch(() => 0);
            const checkCount = await checkboxOpts.count().catch(() => 0);
            const hasNumber = (await numberInput.count().catch(() => 0)) > 0 && await numberInput.isVisible().catch(() => false);
            const hasText = (await textInput.count().catch(() => 0)) > 0 && await textInput.isVisible().catch(() => false);

            let fieldType: UnknownQuestion['fieldType'] = 'unknown';
            let options: string[] | undefined;
            if (radioCount > 0) {
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

            let answer = this.answerBank.findAnswer(question)?.answer ?? null;

            if (!answer) {
                const unknown: UnknownQuestion = {
                    question,
                    options,
                    fieldType,
                    seenAt: new Date().toISOString(),
                    jobTitle,
                    jobUrl: page.url(),
                };
                answer = await this.answerBank.askUserAndLearn(unknown);
                if (answer === '__SKIP__') return 'skip';
            }

            if (fieldType === 'radio' && options) {
                const idx = this.bestOptionIndex(options, answer);
                if (idx >= 0) {
                    await radioOpts.nth(idx).click().catch(() => null);
                } else {
                    this.logger.warn(`No matching radio option for "${answer}". Picking first.`);
                    await radioOpts.first().click().catch(() => null);
                }
            } else if (fieldType === 'checkbox' && options) {
                const idx = this.bestOptionIndex(options, answer);
                if (idx >= 0) await checkboxOpts.nth(idx).click().catch(() => null);
            } else if (fieldType === 'number') {
                await numberInput.fill(answer).catch(() => null);
            } else if (fieldType === 'text') {
                if ((await textInput.getAttribute('contenteditable').catch(() => null)) === 'true') {
                    await textInput.click().catch(() => null);
                    await textInput.evaluate((el, val) => { (el as HTMLElement).innerText = val as string; }, answer).catch(() => null);
                    await textInput.type(' ').catch(() => null);
                    await textInput.press('Backspace').catch(() => null);
                } else {
                    await textInput.fill(answer).catch(() => null);
                }
            }

            const send = page.locator('.sendMsg, .sendMsgbtn, button:has-text("Save"), .chatbot_SaveBtn, [class*="sendMsg"]').first();
            await send.click().catch(() => null);
            await page.waitForTimeout(1200);
        }
        return 'done';
    }

    private bestOptionIndex(options: string[], answer: string): number {
        const a = answer.toLowerCase().trim();
        let best = -1;
        let bestScore = 0;
        for (let i = 0; i < options.length; i++) {
            const o = options[i].toLowerCase().trim();
            if (o === a) return i;
            if (o.includes(a) || a.includes(o)) return i;
            const s = compareTwoStrings(o, a);
            if (s > bestScore) { bestScore = s; best = i; }
        }
        return bestScore > 0.4 ? best : -1;
    }

    private todayKey(): string {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    private async loadState(): Promise<RunState> {
        try {
            const raw = await fs.readFile(STATE_PATH, 'utf-8');
            return JSON.parse(raw) as RunState;
        } catch {
            return {};
        }
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

    private async ensureCsvHeader() {
        try {
            await fs.access(APPLIED_CSV);
        } catch {
            await fs.mkdir(resolve('./data'), { recursive: true }).catch(() => null);
            await fs.writeFile(APPLIED_CSV, 'appliedAt,status,title,company,keyword,url,note\n', 'utf-8');
        }
    }

    private async logApplied(job: AppliedJob) {
        const row = [
            new Date().toISOString(),
            job.status,
            csvSafe(job.title),
            csvSafe(job.company),
            csvSafe(job.keyword),
            csvSafe(job.url),
            csvSafe(job.note ?? ''),
        ].join(',') + '\n';
        await fs.appendFile(APPLIED_CSV, row, 'utf-8');
    }
}

function csvSafe(s: string): string {
    if (!s) return '';
    const clean = s.replace(/\r?\n/g, ' ').replace(/"/g, '""');
    return /[,"]/.test(clean) ? `"${clean}"` : clean;
}
