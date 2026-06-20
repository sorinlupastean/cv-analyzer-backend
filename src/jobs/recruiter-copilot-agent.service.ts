import { Injectable, Logger } from '@nestjs/common';
import { GeminiService } from '../ai/gemini.service';
import { normalizeUnicodeText } from '../common/text-normalization';
import {
  RecruiterCopilotAgentMemory,
  RecruiterCopilotAgentMode,
  RecruiterCopilotAgentTrace,
  RecruiterCopilotCandidate,
  RecruiterCopilotDecision,
} from './dto/recruiter-copilot.dto';

type CopilotJobContext = {
  id: number;
  title: string;
  category: string;
  location: string;
  type: string;
  requirements: string;
  description: string;
};

type CopilotAgentResult = {
  mode: RecruiterCopilotAgentMode;
  label: string;
  summary: string;
  topRecommendation: RecruiterCopilotDecision;
  topSignal: string;
  highlights: string[];
  trace: RecruiterCopilotAgentTrace[];
  memory: RecruiterCopilotAgentMemory;
  usedFallback: boolean;
};

type CopilotAgentResponse = {
  label?: string;
  summary?: string;
  topRecommendation?: RecruiterCopilotDecision;
  topSignal?: string;
  highlights?: string[];
  trace?: RecruiterCopilotAgentTrace[];
  notes?: string[];
};

@Injectable()
export class RecruiterCopilotAgentService {
  private readonly logger = new Logger(RecruiterCopilotAgentService.name);

  constructor(private readonly geminiService: GeminiService) {}

  async synthesize(params: {
    job: CopilotJobContext;
    candidates: RecruiterCopilotCandidate[];
    previousMemory: Partial<RecruiterCopilotAgentMemory> | null;
    generatedAt: string;
  }): Promise<CopilotAgentResult> {
    const { job, candidates, previousMemory, generatedAt } = params;
    const topCandidates = candidates.slice(0, 5);

    if (!topCandidates.length) {
      return this.buildLocalOutcome(job, topCandidates, previousMemory, generatedAt);
    }

    if (!process.env.GEMINI_API_KEY) {
      return this.buildLocalOutcome(job, topCandidates, previousMemory, generatedAt);
    }

    const prompt = this.buildPrompt(job, topCandidates, previousMemory);

    try {
      const response = await this.geminiService.generateJson<CopilotAgentResponse>(
        prompt,
      );
      return this.normalizeOutcome(
        response,
        job,
        topCandidates,
        previousMemory,
        generatedAt,
        false,
      );
    } catch (error) {
      this.logger.warn(
        `Recruiter copilot agent fell back to local mode: ${String(
          (error as any)?.message || error,
        )}`,
      );
      return this.buildLocalOutcome(job, topCandidates, previousMemory, generatedAt);
    }
  }

  private buildPrompt(
    job: CopilotJobContext,
    candidates: RecruiterCopilotCandidate[],
    previousMemory: Partial<RecruiterCopilotAgentMemory> | null,
  ): string {
    const memoryBlock = previousMemory
      ? JSON.stringify(previousMemory, null, 2)
      : 'null';
    const candidateBlock = candidates
      .map((candidate) => ({
        id: candidate.id,
        nume: candidate.candidateName,
        scor: candidate.matchScore,
        incredere: candidate.confidenceScore,
        recomandare: candidate.recommendation,
        pas_urmator: candidate.nextStep,
        badge: candidate.badge,
        explicatie: candidate.explanation,
        dovezi: candidate.evidence.slice(0, 3),
        riscuri: candidate.risks.slice(0, 3),
        questions: candidate.interviewQuestions.slice(0, 3),
        skills: candidate.skills.slice(0, 5),
      }))
      .map((item) => JSON.stringify(item, null, 2))
      .join('\n');

    return `
Ești un agent AI pentru decizie de recrutare.
Trebuie să analizezi clasamentul deja calculat și să produci un rezumat scurt, clar și profesional, în limba română.

Reguli:
- Nu inventa date care nu apar în context.
- Nu folosi cuvântul "shortlist".
- Nu schimba ordinea candidaților, folosește ordinea existentă.
- Ține răspunsul scurt, premium și ușor de citit.
- Concentrează-te pe: cine este primul în clasament, ce îl susține, ce rezervă există și ce semnal de decizie trebuie văzut prima dată.
- Dacă memoria anterioară există, notează dacă topul s-a schimbat.

Job activ:
${JSON.stringify(job, null, 2)}

Memorie anterioară:
${memoryBlock}

Candidați prioritizați:
${candidateBlock}

Returnează doar JSON valid, cu exact această formă:
{
  "label": "Top 3 candidați pentru acest job",
  "summary": "string scurt în română",
  "topRecommendation": "INVITE" | "REVIEW" | "REJECT" | "FOLLOW_UP",
  "topSignal": "string scurt și clar",
  "highlights": ["string", "string", "string"],
  "trace": [
    { "step": "string", "detail": "string" }
  ],
  "notes": ["string"]
}
`.trim();
  }

  private buildLocalOutcome(
    job: CopilotJobContext,
    candidates: RecruiterCopilotCandidate[],
    previousMemory: Partial<RecruiterCopilotAgentMemory> | null,
    generatedAt: string,
  ): CopilotAgentResult {
    const top = candidates[0] ?? null;
    const second = candidates[1] ?? null;
    const third = candidates[2] ?? null;

    const highlights = [
      top
        ? `1. ${top.candidateName} conduce clasamentul cu ${top.matchScore}% potrivire.`
        : 'Încă nu există candidați analizați.',
      second
        ? `2. ${second.candidateName} este alternativa imediată, cu ${second.matchScore}% potrivire.`
        : 'Locul 2 nu este încă disponibil.',
      third
        ? `3. ${third.candidateName} completează topul cu ${third.matchScore}% potrivire.`
        : 'Locul 3 nu este încă disponibil.',
    ];

    const trace: RecruiterCopilotAgentTrace[] = [
      {
        step: 'clasament',
        detail: 'Am folosit ordinea deja calculată a candidaților pentru acest job.',
      },
      {
        step: 'evidence',
        detail: 'Am păstrat doar dovezile relevante, riscurile și întrebările de interviu.',
      },
      {
        step: 'decizie',
        detail: 'Rezultatul local este pregătit pentru afișare și pentru memorie.',
      },
    ];

    const memory = this.buildMemory(candidates, previousMemory, generatedAt, 'local');

    return {
      mode: 'local',
      label: 'Top 3 candidați pentru acest job',
      summary: top
        ? `${top.candidateName} este liderul actual, iar următorii doi candidați oferă alternative clare pentru decizie.`
        : `Nu există încă date suficiente pentru ${normalizeUnicodeText(job.title) || 'acest job'}.`,
      topRecommendation: top?.nextStep ?? 'FOLLOW_UP',
      topSignal: top
        ? `${top.candidateName} - ${top.matchScore}% potrivire`
        : 'Nu există candidați analizați',
      highlights,
      trace,
      memory,
      usedFallback: true,
    };
  }

  private normalizeOutcome(
    response: CopilotAgentResponse,
    job: CopilotJobContext,
    candidates: RecruiterCopilotCandidate[],
    previousMemory: Partial<RecruiterCopilotAgentMemory> | null,
    generatedAt: string,
    usedFallback: boolean,
  ): CopilotAgentResult {
    const top = candidates[0] ?? null;
    const second = candidates[1] ?? null;
    const third = candidates[2] ?? null;

    const label = this.cleanText(response.label) || 'Top 3 candidați pentru acest job';
    const summary =
      this.cleanText(response.summary) ||
      (top
        ? `${top.candidateName} conduce clasamentul pentru ${normalizeUnicodeText(job.title) || 'acest job'}.`
        : 'Nu există încă candidați analizați.');
    const topRecommendation =
      response.topRecommendation ||
      top?.nextStep ||
      'FOLLOW_UP';
    const topSignal =
      this.cleanText(response.topSignal) ||
      (top ? `${top.candidateName} - ${top.matchScore}% potrivire` : 'Nu există candidați analizați');
    const highlights = this.takeExactlyThree(
      Array.isArray(response.highlights) ? response.highlights : [],
      top,
      second,
      third,
    );
    const trace = Array.isArray(response.trace) && response.trace.length
      ? response.trace.slice(0, 3).map((item) => ({
          step: this.cleanText(item?.step) || 'pas',
          detail: this.cleanText(item?.detail) || 'fără detalii',
        }))
      : [
          {
            step: 'clasament',
            detail: 'Clasamentul a fost sintetizat din datele existente.',
          },
          {
            step: 'rezumat',
            detail: 'Am extras mesajul principal pentru recruiter.',
          },
        ];

    const memory = this.buildMemory(
      candidates,
      previousMemory,
      generatedAt,
      'ai',
      Array.isArray(response.notes) ? response.notes : [],
    );

    return {
      mode: 'ai',
      label,
      summary,
      topRecommendation,
      topSignal,
      highlights,
      trace,
      memory,
      usedFallback,
    };
  }

  private buildMemory(
    candidates: RecruiterCopilotCandidate[],
    previousMemory: Partial<RecruiterCopilotAgentMemory> | null,
    generatedAt: string,
    mode: RecruiterCopilotAgentMode,
    notes: string[] = [],
  ): RecruiterCopilotAgentMemory {
    const topThree = candidates.slice(0, 3);
    const topCandidateIds = topThree.map((candidate) => candidate.id);
    const topCandidateNames = topThree.map((candidate) => candidate.candidateName);
    const mergedNotes = [
      ...notes,
      ...(previousMemory?.notes ?? []).slice(0, 2),
    ]
      .map((note) => this.cleanText(note))
      .filter(Boolean)
      .slice(0, 5);

    return {
      mode,
      lastTopCandidateIds: topCandidateIds,
      lastTopCandidateNames: topCandidateNames,
      lastGeneratedAt: generatedAt,
      notes: mergedNotes,
    };
  }

  private takeExactlyThree(
    values: string[],
    top: RecruiterCopilotCandidate | null,
    second: RecruiterCopilotCandidate | null,
    third: RecruiterCopilotCandidate | null,
  ): string[] {
    const fallback = [
      top
        ? `${top.candidateName} rămâne primul în clasament cu ${top.matchScore}% potrivire.`
        : 'Încă nu există candidați analizați.',
      second
        ? `${second.candidateName} este următorul candidat de urmărit, cu ${second.matchScore}% potrivire.`
        : 'Locul 2 nu este încă disponibil.',
      third
        ? `${third.candidateName} completează topul cu ${third.matchScore}% potrivire.`
        : 'Locul 3 nu este încă disponibil.',
    ];

    const cleaned = values.map((value) => this.cleanText(value)).filter(Boolean);
    const result = [...cleaned];

    for (const item of fallback) {
      if (result.length >= 3) break;
      result.push(item);
    }

    return result.slice(0, 3);
  }

  private cleanText(value: unknown): string {
    return normalizeUnicodeText(String(value ?? '').trim()).replace(/\s+/g, ' ').trim();
  }
}
