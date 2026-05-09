import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { BrowserContext, chromium, Page } from 'playwright';
import { resolve } from 'path';

@Injectable()
export class BrowserService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(BrowserService.name);
    private readonly userDataDir = resolve('./chrome-profile');
    private context: BrowserContext | null = null;
    private page: Page | null = null;

    async onModuleInit() {
        this.logger.log('Launching Chromium with persistent profile...');
        this.context = await chromium.launchPersistentContext(this.userDataDir, {
            headless: false,
            channel: 'chrome',
            viewport: { width: 1366, height: 850 },
        });
        this.page = this.context.pages()[0] ?? await this.context.newPage();
        this.logger.log('Browser ready.');
    }

    async onModuleDestroy() {
        if (this.context) {
            await this.context.close().catch(() => null);
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

    async newPage(): Promise<Page> {
        if (!this.context) throw new Error('Browser context not initialized');
        return this.context.newPage();
    }
}
