// src/modules/analysis/candidate-analysis.service.ts

import { Injectable } from '@nestjs/common';
import { GeminiService } from '../ai/gemini.service';
import {
  FinalCandidateAnalysis,
  GithubProfileAnalysis,
} from './analysis.types';
import { FinalAnalysisService } from './final-analysis.service';
import { GithubAnalyzerService } from './github-analyzer.service';

@Injectable()
export class CandidateAnalysisService {
  constructor(
    private readonly geminiService: GeminiService,
    private readonly githubAnalyzerService: GithubAnalyzerService,
    private readonly finalAnalysisService: FinalAnalysisService,
  ) {}

  async analyzeCandidate(params: {
    filePath: string;
    mimeType: string;
    jobText: string;
    githubUsernameOrUrl?: string | null;
  }): Promise<FinalCandidateAnalysis> {
    const cvAnalysis = await this.geminiService.analyzeCvAgainstJob(
      params.filePath,
      params.mimeType,
      params.jobText,
    );

    let githubAnalysis: GithubProfileAnalysis | null = null;
    if (params.githubUsernameOrUrl?.trim()) {
      githubAnalysis = await this.githubAnalyzerService.analyzeGithubProfile(
        params.githubUsernameOrUrl,
        params.jobText,
        cvAnalysis.skills,
      );
    }

    return this.finalAnalysisService.buildFinalAnalysis({
      cvAnalysis,
      githubAnalysis,
    });
  }
}
