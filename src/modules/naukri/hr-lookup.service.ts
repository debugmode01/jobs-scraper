import { Injectable, Logger } from '@nestjs/common';
import { BrowserContext, Page } from 'playwright';

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /(\+?91[\s-]?)?[6-9]\d{9}\b/g;

const HR_KEYWORDS = ['hr', 'careers', 'recruit', 'talent', 'jobs', 'hiring', 'people'];

@Injectable()
export class HrLookupService {
    private readonly logger = new Logger(HrLookupService.name);

    /** Best-effort Google search to find HR email/phone for a company. Returns first plausible email/phone. */
    async lookup(ctx: BrowserContext, company: string): Promise<{ email?: string; phone?: string; source?: string }> {
        if (!company || company === 'Unknown') return {};
        const page = await ctx.newPage();
        try {
            const query = encodeURIComponent(`${company} HR email careers contact`);
            await page.goto(`https://www.google.com/search?q=${query}`, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null);
            await page.waitForTimeout(1500);

            const text = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
            const found = this.extractContact(text);
            if (found.email || found.phone) {
                return { ...found, source: 'google' };
            }

            // open the top result and try again
            const firstLink = page.locator('a[href^="http"]:not([href*="google.com"])').first();
            const href = await firstLink.getAttribute('href').catch(() => null);
            if (href) {
                await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null);
                await page.waitForTimeout(1500);
                const t2 = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
                const f2 = this.extractContact(t2);
                if (f2.email || f2.phone) return { ...f2, source: href };
            }
            return {};
        } catch (err: any) {
            this.logger.warn(`HR lookup failed for ${company}: ${err?.message || err}`);
            return {};
        } finally {
            await page.close().catch(() => null);
        }
    }

    private extractContact(text: string): { email?: string; phone?: string } {
        const emails = (text.match(EMAIL_RE) || []).filter((e) => {
            const lower = e.toLowerCase();
            if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.gif')) return false;
            if (lower.includes('example.com') || lower.includes('sentry') || lower.includes('wixpress')) return false;
            return true;
        });
        const ranked = emails.sort((a, b) => this.score(b) - this.score(a));
        const phones = (text.match(PHONE_RE) || []);
        return { email: ranked[0], phone: phones[0] };
    }

    private score(email: string): number {
        const lower = email.toLowerCase();
        let s = 0;
        for (const kw of HR_KEYWORDS) if (lower.includes(kw)) s += 5;
        if (lower.startsWith('info@') || lower.startsWith('contact@')) s += 1;
        return s;
    }
}
