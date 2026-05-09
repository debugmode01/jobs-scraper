import { Module } from '@nestjs/common';
import { BrowserModule } from '../browser/browser.module';
import { NaukriService } from './naukri.service';
import { AnswerBankService } from './answer-bank.service';

@Module({
    imports: [BrowserModule],
    providers: [NaukriService, AnswerBankService],
    exports: [NaukriService, AnswerBankService],
})
export class NaukriModule {}
