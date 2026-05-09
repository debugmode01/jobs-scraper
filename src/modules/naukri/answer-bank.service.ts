import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import { resolve } from 'path';
import * as readline from 'readline';
import { compareTwoStrings } from 'string-similarity';
import { AnswerBank, AnswerEntry, UnknownQuestion } from './types';

const ANSWERS_PATH = resolve('./data/answers.json');

@Injectable()
export class AnswerBankService {
    private readonly logger = new Logger(AnswerBankService.name);
    private bank: AnswerBank | null = null;

    async load(): Promise<AnswerBank> {
        const raw = await fs.readFile(ANSWERS_PATH, 'utf-8');
        this.bank = JSON.parse(raw) as AnswerBank;
        return this.bank;
    }

    async save(): Promise<void> {
        if (!this.bank) return;
        await fs.writeFile(ANSWERS_PATH, JSON.stringify(this.bank, null, 2), 'utf-8');
    }

    private normalize(s: string): string {
        return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    }

    /** Returns the matched answer or null. */
    findAnswer(question: string): AnswerEntry | null {
        if (!this.bank) return null;
        const q = this.normalize(question);
        const threshold = this.bank._meta?.matchThreshold ?? 0.55;

        let best: { entry: AnswerEntry; score: number } | null = null;
        for (const entry of this.bank.answers) {
            for (const pattern of entry.patterns) {
                const score = compareTwoStrings(q, this.normalize(pattern));
                if (!best || score > best.score) best = { entry, score };
            }
        }
        if (best && best.score >= threshold) {
            this.logger.log(`Matched "${question}" -> ${best.entry.id} (${best.score.toFixed(2)})`);
            return best.entry;
        }
        return null;
    }

    /** Pause and ask the user for an answer. Persists immediately. */
    async askUserAndLearn(unknown: UnknownQuestion): Promise<string> {
        if (!this.bank) await this.load();

        const optionsHint = unknown.options?.length
            ? `\n   Options: ${unknown.options.join(' | ')}`
            : '';

        // also add to unknown log so user has a record
        this.bank!.unknown.push(unknown);
        await this.save();

        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const ask = (q: string): Promise<string> =>
            new Promise((resolveP) => rl.question(q, (a) => resolveP(a)));

        console.log('\n========== UNKNOWN QUESTION ==========');
        console.log(`Job:      ${unknown.jobTitle ?? '-'}`);
        console.log(`Question: ${unknown.question}`);
        console.log(`Type:     ${unknown.fieldType}${optionsHint}`);
        console.log('--------------------------------------');

        const answer = (await ask('Your answer (or "skip" to skip this job): ')).trim();
        if (answer.toLowerCase() === 'skip') {
            rl.close();
            return '__SKIP__';
        }

        // ask for matching patterns to improve coverage
        const extraPatternsRaw = await ask(
            'Extra patterns to match similar future questions (comma-separated, ENTER to use the question itself): ',
        );
        rl.close();

        const patterns = [unknown.question.toLowerCase()];
        if (extraPatternsRaw.trim()) {
            patterns.push(...extraPatternsRaw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
        }

        // remove from unknown list since we now have an answer
        this.bank!.unknown = this.bank!.unknown.filter((u) => u.question !== unknown.question);

        const id = `learned_${Date.now()}`;
        this.bank!.answers.push({
            id,
            patterns,
            answer,
            type: unknown.fieldType === 'number' ? 'number' : 'text',
        });
        await this.save();
        this.logger.log(`Learned new answer (${id}). Bank size: ${this.bank!.answers.length}`);
        return answer;
    }
}
