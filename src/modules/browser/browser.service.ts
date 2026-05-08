import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BrowserContext, chromium, Page } from 'playwright';
import { resolve } from 'path';

@Injectable()
export class BrowserService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(BrowserService.name);
    private readonly userDataDir = resolve('./chrome-profile');
    private context: BrowserContext | null = null;
    private page: Page | null = null;

    constructor(private readonly config: ConfigService) { }

    async onModuleInit() {
        this.logger.log('Starting browser...');
        this.context = await chromium.launchPersistentContext(this.userDataDir, {
            headless: false,
            channel: 'chrome',
        });
        this.page = this.context.pages()[0] ?? await this.context.newPage();

        await this.ensureLoggedIn();
    }

    private async ensureLoggedIn() {
        if (!this.page) return;

        await this.page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });

        if (this.page.url().includes('/feed')) {
            this.logger.log('Already signed in.');
            return;
        }

        this.logger.log('Not signed in. Starting login...');
        await this.loginWithEmail();
    }

    private async loginWithEmail() {
        if (!this.page) return;

        const email = this.config.get<string>('LINKEDIN_EMAIL');
        const password = this.config.get<string>('LINKEDIN_PASSWORD');
        if (!email || !password) {
            this.logger.error('LINKEDIN_EMAIL or LINKEDIN_PASSWORD missing in .env');
            return;
        }

        this.logger.log('Opening login page...');
        await this.page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });

        const passwordField = this.page.locator('input[type="password"]:visible').first();
        const emailField = this.page.locator('input[type="email"]:visible, input[type="text"]:visible').first();

        await passwordField.waitFor({ state: 'visible', timeout: 30000 });

        this.logger.log('Submitting credentials...');
        if (await emailField.isVisible({ timeout: 2000 }).catch(() => false)) {
            await emailField.fill(email);
        } else {
            this.logger.log('Welcome-back screen — only password needed.');
        }
        await passwordField.fill(password);
        await this.page.getByRole('button', { name: /^sign in$/i }).click();

        await this.waitForFeed();
    }

    private async waitForFeed() {
        if (!this.page) return;

        const RETRY_INTERVAL_MS = 2 * 60 * 1000;
        const MAX_TOTAL_MS = 30 * 60 * 1000;
        const startedAt = Date.now();
        let firstWait = true;

        while (Date.now() - startedAt < MAX_TOTAL_MS) {
            try {
                await this.page.waitForURL(/\/feed/, { timeout: RETRY_INTERVAL_MS });
                this.logger.log('Signed in. Feed loaded.');
                return;
            } catch {
                if (firstWait) {
                    this.logger.log('Verification sent to your phone — please tap "Yes, this is me".');
                    firstWait = false;
                }

                const resend = this.page
                    .getByRole('button', { name: /resend|send again|try another/i })
                    .or(this.page.getByRole('link', { name: /resend|send again|try another/i }))
                    .first();

                if (await resend.isVisible().catch(() => false)) {
                    this.logger.log('No response in 2 minutes — clicking "Send again".');
                    await resend.click().catch(() => null);
                } else {
                    this.logger.log('Still waiting for verification...');
                }
            }
        }

        this.logger.error('Login did not complete within 30 minutes. Please sign in manually.');
    }

    async onModuleDestroy() {
        if (this.context) {
            await this.context.close();
            this.context = null;
            this.page = null;
        }
    }

    getPage(): Page {
        if (!this.page) throw new Error('Browser page not initialized');
        return this.page;
    }

    getContext(): BrowserContext {
        if (!this.context) throw new Error('Browser context not initialized');
        return this.context;
    }
}
