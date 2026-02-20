import { BadRequestException, Injectable } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import { readFile } from 'fs/promises';

export type Recommendation = 'INVITA' | 'REVIZUIRE' | 'RESPINGE';

export type CandidateExperience = {
  title: string;
  company?: string;
  startDate?: string;
  endDate?: string;
  location?: string;
  responsibilities?: string[];
  technologies?: string[];
};

export type CandidateEducation = {
  school: string;
  degree?: string;
  field?: string;
  startDate?: string;
  endDate?: string;
};

export type GeminiJobCvAnalysis = {
  candidateName: string;
  email: string | null;
  phone: string | null;

  languages: string[];
  domains: string[];

  skills: string[];
  experience: CandidateExperience[];
  education: CandidateEducation[];

  matchedRequirements: string[];
  missingRequirements: string[];
  redFlags: string[];

  summary: string;
  matchScore: number;
  recommendation: Recommendation;

  reasoningShort: string;
  evidence: string[];
};

@Injectable()
export class GeminiService {
  private client: GoogleGenAI;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY || '';
    this.client = new GoogleGenAI({ apiKey });
  }

  async analyzeCvAgainstJob(
    filePath: string,
    mimeType: string,
    jobText: string,
  ): Promise<GeminiJobCvAnalysis> {
    if (!process.env.GEMINI_API_KEY) {
      throw new BadRequestException('Lipsește GEMINI_API_KEY în .env');
    }

    const bytes = await readFile(filePath);
    const base64 = Buffer.from(bytes).toString('base64');

    const schema = `
Return ONLY valid JSON matching exactly this shape:
{
  "candidateName": string,
  "email": string | null,
  "phone": string | null,

  "languages": string[],
  "domains": string[],

  "skills": string[],
  "experience": [
    {
      "title": string,
      "company": string | undefined,
      "startDate": string | undefined,
      "endDate": string | undefined,
      "location": string | undefined,
      "responsibilities": string[] | undefined,
      "technologies": string[] | undefined
    }
  ],
  "education": [
    {
      "school": string,
      "degree": string | undefined,
      "field": string | undefined,
      "startDate": string | undefined,
      "endDate": string | undefined
    }
  ],

  "matchedRequirements": string[],
  "missingRequirements": string[],
  "redFlags": string[],

  "summary": string,
  "matchScore": number,
  "recommendation": "INVITA" | "REVIZUIRE" | "RESPINGE",
  "reasoningShort": string,
  "evidence": string[]
}

Rules:
- Extract email/phone ONLY if present in CV, else null (no guessing)
- matchScore must be an integer 0..100
- skills distinct, max 30
- experience max 10 items (do your best to extract from CV)
- education max 10 items
- languages distinct, max 10
- domains distinct, max 10
- matchedRequirements max 15, missingRequirements max 15, redFlags max 10
- summary max 1200 chars
- reasoningShort max 700 chars, bullet style, short lines
- evidence max 10 items, each item max 120 chars, paraphrase, do not quote long text
- CRITICAL: evaluate FIT strictly vs JOB.
  If JOB is "oier" and candidate CV is only IT or construction, matchScore must be LOW (0..25) and recommendation should be RESPINGE or REVIZUIRE with clear redFlags.
- Use this scoring rubric:
  1) Core domain fit (0..40)
  2) Must-have requirements fit (0..30)
  3) Relevant experience recency/depth (0..20)
  4) Soft/other (0..10)
`.trim();

    const prompt = `
You are an ATS recruiter assistant.

You will receive:
1) JOB requirements and description
2) The candidate CV as a document (PDF/DOC/DOCX)

Task:
- Extract structured candidate data
- Evaluate candidate fit against the JOB using the rubric
- Provide matchedRequirements, missingRequirements, redFlags, evidence
- Produce matchScore 0..100 and recommendation

JOB:
${jobText}

${schema}
`.trim();

    const res = await this.client.models.generateContent({
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: mimeType || 'application/pdf',
                data: base64,
              },
            },
          ],
        },
      ],
    });

    const text = res.text ?? '';
    const jsonStr = this.extractJson(text);

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      throw new BadRequestException('Gemini a returnat un JSON invalid.');
    }

    return this.sanitizeAnalysis(parsed);
  }

  private sanitizeAnalysis(input: unknown): GeminiJobCvAnalysis {
    const obj = (input && typeof input === 'object' ? input : {}) as any;

    const toArrayStrings = (v: unknown, max: number) => {
      if (!Array.isArray(v)) return [];
      const cleaned = v
        .map((x) => String(x).trim())
        .filter((s) => s.length > 0);
      return Array.from(new Set(cleaned)).slice(0, max);
    };

    const clampScore = (v: unknown) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return 0;
      return Math.max(0, Math.min(100, Math.round(n)));
    };

    const normalizeEmail = (v: unknown) => {
      const s = typeof v === 'string' ? v.trim() : '';
      if (!s) return null;
      // simplu, doar validare minimă
      if (!s.includes('@') || s.length < 5) return null;
      return s;
    };

    const normalizePhone = (v: unknown) => {
      const s = typeof v === 'string' ? v.trim() : '';
      if (!s) return null;
      const digits = s.replace(/[^\d+]/g, '');
      if (digits.length < 8) return null;
      return s;
    };

    const recRaw = String(obj.recommendation || 'REVIZUIRE').toUpperCase();
    const recommendation: Recommendation =
      recRaw === 'INVITA' || recRaw === 'RESPINGE' || recRaw === 'REVIZUIRE'
        ? recRaw
        : 'REVIZUIRE';

    const experience: CandidateExperience[] = Array.isArray(obj.experience)
      ? obj.experience
          .slice(0, 10)
          .map((e: any) => ({
            title: String(e?.title || '').trim(),
            company: e?.company ? String(e.company).trim() : undefined,
            startDate: e?.startDate ? String(e.startDate).trim() : undefined,
            endDate: e?.endDate ? String(e.endDate).trim() : undefined,
            location: e?.location ? String(e.location).trim() : undefined,
            responsibilities: toArrayStrings(e?.responsibilities, 20),
            technologies: toArrayStrings(e?.technologies, 30),
          }))
          .filter((e: any) => e.title.length > 0)
      : [];

    const education: CandidateEducation[] = Array.isArray(obj.education)
      ? obj.education
          .slice(0, 10)
          .map((ed: any) => ({
            school: String(ed?.school || '').trim(),
            degree: ed?.degree ? String(ed.degree).trim() : undefined,
            field: ed?.field ? String(ed.field).trim() : undefined,
            startDate: ed?.startDate ? String(ed.startDate).trim() : undefined,
            endDate: ed?.endDate ? String(ed.endDate).trim() : undefined,
          }))
          .filter((ed: any) => ed.school.length > 0)
      : [];

    return {
      candidateName: String(obj.candidateName || '').trim(),
      email: normalizeEmail(obj.email),
      phone: normalizePhone(obj.phone),

      languages: toArrayStrings(obj.languages, 10),
      domains: toArrayStrings(obj.domains, 10),

      skills: toArrayStrings(obj.skills, 30),
      experience,
      education,

      matchedRequirements: toArrayStrings(obj.matchedRequirements, 15),
      missingRequirements: toArrayStrings(obj.missingRequirements, 15),
      redFlags: toArrayStrings(obj.redFlags, 10),

      summary: String(obj.summary || '')
        .trim()
        .slice(0, 1200),
      matchScore: clampScore(obj.matchScore),
      recommendation,

      reasoningShort: String(obj.reasoningShort || '')
        .trim()
        .slice(0, 700),
      evidence: toArrayStrings(obj.evidence, 10).map((x) => x.slice(0, 120)),
    };
  }

  private extractJson(s: string) {
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return '{}';
    return s.slice(start, end + 1);
  }
}
