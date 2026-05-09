import { Module } from '@nestjs/common';
import { BrowserModule } from '../browser/browser.module';
import { NaukriService } from './naukri.service';
import { AnswerBankService } from './answer-bank.service';
import { HrLookupService } from './hr-lookup.service';

@Module({
    imports: [BrowserModule],
    providers: [NaukriService, AnswerBankService, HrLookupService],
    exports: [NaukriService, AnswerBankService, HrLookupService],
})
export class NaukriModule {}
