// src/ml/ml.service.ts

import { Injectable, Logger } from '@nestjs/common';

export type MlRecommendation = 'INVITA' | 'REVIZUIRE' | 'RESPINGE';

export type MlPredictInput = {
  cvScore: number;
  githubScore: number | null;
  finalScore: number;
  confidenceScore: number;
  matchedRequirements: string[];
  missingRequirements: string[];
  redFlags: string[];
  evidence: string[];
  hasGithub: boolean;
  validatedSkills: string[];
};

export type MlPredictResult = {
  recommendation: MlRecommendation;
  confidenceMl: number;
  probabilities: Record<string, number>;
  usedMl: boolean;
};

@Injectable()
export class MlService {
  private readonly logger = new Logger(MlService.name);
  private readonly mlUrl =
    process.env.ML_SERVICE_URL ?? 'http://localhost:8000';

  async predict(input: MlPredictInput): Promise<MlPredictResult> {
    try {
      const body = {
        cv_score: input.cvScore,
        github_score: input.githubScore ?? 0,
        final_score: input.finalScore,
        confidence: input.confidenceScore,
        matched_req: input.matchedRequirements.length,
        missing_req: input.missingRequirements.length,
        red_flags: input.redFlags.length,
        evidence_count: input.evidence.length,
        has_github: input.hasGithub ? 1 : 0,
        validated_skills: input.validatedSkills.length,
      };

      const res = await fetch(`${this.mlUrl}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000), // timeout 5s
      });

      if (!res.ok) {
        throw new Error(`ML service responded with ${res.status}`);
      }

      const data = await res.json();

      return {
        recommendation: data.recommendation as MlRecommendation,
        confidenceMl: data.confidence_ml,
        probabilities: data.probabilities,
        usedMl: true,
      };
    } catch (err) {
      this.logger.warn(
        `ML service indisponibil, se folosește recomandarea Gemini. Eroare: ${String(err)}`,
      );

      return {
        recommendation: this.fallback(input),
        confidenceMl: 0,
        probabilities: {},
        usedMl: false,
      };
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.mlUrl}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private fallback(input: MlPredictInput): MlRecommendation {
    const { finalScore, redFlags, missingRequirements } = input;

    if (finalScore < 40) return 'RESPINGE';
    if (redFlags.length >= 4 && finalScore < 70) return 'RESPINGE';
    if (missingRequirements.length >= 6 && finalScore < 75) return 'REVIZUIRE';
    if (finalScore >= 75 && redFlags.length <= 2) return 'INVITA';

    if (finalScore >= 75) return 'INVITA';
    if (finalScore >= 45) return 'REVIZUIRE';
    return 'RESPINGE';
  }
}
