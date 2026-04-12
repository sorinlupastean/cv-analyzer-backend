// src/modules/analysis/final-analysis.service.ts

import { Injectable } from '@nestjs/common';
import {
  FinalCandidateAnalysis,
  GeminiJobCvAnalysis,
  GithubProfileAnalysis,
} from './analysis.types';
import {
  clampInt,
  mergeUnique,
  normalizeRecommendation,
  scoreToRecommendation,
  truncate,
  uniqueStrings,
} from './analysis.utils';

@Injectable()
export class FinalAnalysisService {
  buildFinalAnalysis(params: {
    cvAnalysis: GeminiJobCvAnalysis;
    githubAnalysis: GithubProfileAnalysis | null;
  }): FinalCandidateAnalysis {
    const { cvAnalysis, githubAnalysis } = params;

    const cvScore = clampInt(cvAnalysis.matchScore, 0, 100);
    const hasUsefulGithub =
      !!githubAnalysis &&
      githubAnalysis.usedInScoring &&
      githubAnalysis.analyzedReposCount > 0;

    const githubScore = hasUsefulGithub
      ? clampInt(githubAnalysis!.githubScore, 0, 100)
      : null;

    const finalScore = hasUsefulGithub
      ? clampInt(cvScore * 0.7 + (githubScore ?? 0) * 0.3, 0, 100)
      : cvScore;

    let confidenceScore = 65;

    confidenceScore += Math.min(cvAnalysis.evidence.length * 2, 12);
    confidenceScore += Math.min(cvAnalysis.matchedRequirements.length, 10);

    if (hasUsefulGithub) {
      confidenceScore += githubAnalysis!.confidenceBoost;
      confidenceScore += Math.min(githubAnalysis!.validatedSkills.length, 8);
    } else {
      confidenceScore -= 5;
    }

    confidenceScore = clampInt(confidenceScore, 45, 95);

    const matchedRequirements = uniqueStrings(
      [
        ...cvAnalysis.matchedRequirements,
        ...(hasUsefulGithub ? githubAnalysis!.matchedRequirements : []),
      ],
      20,
    );

    const missingRequirements = uniqueStrings(
      [
        ...cvAnalysis.missingRequirements,
        ...(hasUsefulGithub ? githubAnalysis!.missingRequirements : []),
      ],
      20,
    );

    const redFlags = uniqueStrings(
      [
        ...cvAnalysis.redFlags,
        ...(hasUsefulGithub ? githubAnalysis!.redFlags : []),
      ],
      12,
    );

    const validatedSkills = hasUsefulGithub
      ? uniqueStrings(githubAnalysis!.validatedSkills, 20)
      : [];

    const unverifiedSkills = hasUsefulGithub
      ? uniqueStrings(githubAnalysis!.unverifiedSkills, 20)
      : uniqueStrings(cvAnalysis.skills, 20);

    const evidence = uniqueStrings(
      [
        ...cvAnalysis.evidence,
        ...(hasUsefulGithub ? githubAnalysis!.evidence : []),
      ],
      15,
    );

    const recommendation = this.computeRecommendation({
      cvRecommendation: normalizeRecommendation(cvAnalysis.recommendation),
      finalScore,
      redFlagsCount: redFlags.length,
      missingRequirementsCount: missingRequirements.length,
    });

    const githubText = hasUsefulGithub
      ? `Analiza a inclus și validarea prin GitHub.`
      : `Analiza a fost realizată doar pe baza CV-ului și a cerințelor jobului.`;

    const summary = truncate(
      `${cvAnalysis.summary} ${githubText}`.trim(),
      1200,
    );

    const reasoningShort = truncate(
      [
        `- CV score: ${cvScore}`,
        hasUsefulGithub
          ? `- GitHub score: ${githubScore}`
          : `- GitHub: indisponibil sau nefolosit`,
        `- Final score: ${finalScore}`,
        `- Confidence: ${confidenceScore}`,
        `- Matched: ${matchedRequirements.slice(0, 5).join(', ') || 'puține potriviri clare'}`,
        `- Missing: ${missingRequirements.slice(0, 5).join(', ') || 'fără lipsuri majore evidente'}`,
      ].join('\n'),
      700,
    );

    return {
      candidateName: cvAnalysis.candidateName,
      email: cvAnalysis.email,
      phone: cvAnalysis.phone,

      cvScore,
      githubScore,
      finalScore,
      confidenceScore,

      recommendation,

      languages: cvAnalysis.languages,
      domains: cvAnalysis.domains,
      skills: cvAnalysis.skills,

      validatedSkills,
      unverifiedSkills,

      matchedRequirements,
      missingRequirements,
      redFlags,

      summary,
      reasoningShort,
      evidence,

      cvAnalysis,
      githubAnalysis: hasUsefulGithub ? githubAnalysis : null,
    };
  }

  private computeRecommendation(input: {
    cvRecommendation: 'INVITA' | 'REVIZUIRE' | 'RESPINGE';
    finalScore: number;
    redFlagsCount: number;
    missingRequirementsCount: number;
  }): 'INVITA' | 'REVIZUIRE' | 'RESPINGE' {
    const {
      cvRecommendation,
      finalScore,
      redFlagsCount,
      missingRequirementsCount,
    } = input;

    if (finalScore < 40) return 'RESPINGE';
    if (redFlagsCount >= 4 && finalScore < 70) return 'RESPINGE';
    if (missingRequirementsCount >= 6 && finalScore < 75) return 'REVIZUIRE';
    if (finalScore >= 75 && redFlagsCount <= 2) return 'INVITA';

    if (cvRecommendation === 'RESPINGE' && finalScore < 55) return 'RESPINGE';

    return scoreToRecommendation(finalScore);
  }
}
