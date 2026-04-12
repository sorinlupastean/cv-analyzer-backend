import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { CandidateAnalysisService } from './candidate-analysis.service';
import { FinalAnalysisService } from './final-analysis.service';
import { GithubAnalyzerService } from './github-analyzer.service';

@Module({
  imports: [AiModule],
  providers: [
    GithubAnalyzerService,
    FinalAnalysisService,
    CandidateAnalysisService,
  ],
  exports: [CandidateAnalysisService],
})
export class AnalysisModule {}
