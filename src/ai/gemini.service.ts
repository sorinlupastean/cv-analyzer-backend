import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { GoogleGenAI } from '@google/genai';
import { readFile } from 'fs/promises';
import path from 'path';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import {
  CandidateEducation,
  CandidateExperience,
  GeminiJobCvAnalysis,
  Recommendation,
} from '../analysis/analysis.types';
import { normalizeUnicodeText } from '../common/text-normalization';
import {
  buildDataUrl,
  parseImageDimensions,
  pdfImageToPngDataUrl,
} from '../common/image-utils';

const RETRY_DELAYS_MS = [3000, 6000, 12000];

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private client: GoogleGenAI;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY || '';
    this.client = new GoogleGenAI({ apiKey });
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        lastError = err;

        const msg = String(err?.message || err || '');
        const is503 =
          msg.includes('503') ||
          msg.includes('UNAVAILABLE') ||
          msg.includes('high demand') ||
          msg.includes('overloaded');

        if (!is503) throw err;

        if (attempt < RETRY_DELAYS_MS.length) {
          const delay = RETRY_DELAYS_MS[attempt];
          this.logger.warn(
            `Gemini 503 — retry ${attempt + 1}/${RETRY_DELAYS_MS.length} după ${delay}ms...`,
          );
          await new Promise((res) => setTimeout(res, delay));
        }
      }
    }

    throw new BadRequestException(
      'Gemini API este supraîncărcat. Te rugăm să încerci din nou în câteva minute.',
    );
  }

  async analyzeCvAgainstJob(
    filePath: string,
    mimeType: string,
    jobText: string,
  ): Promise<GeminiJobCvAnalysis> {
    if (!process.env.GEMINI_API_KEY) {
      throw new BadRequestException('Lipsește GEMINI_API_KEY în .env');
    }

    const mt = String(mimeType || '').toLowerCase();
    const bytes = await readFile(filePath);
    const candidatePhotoDataUrl = await this.extractCandidatePhotoDataUrl(
      filePath,
      bytes,
      mt,
    );

    const schema = `
Return ONLY valid JSON matching exactly this shape:
{
  "candidateName": string,
  "email": string | null,
  "phone": string | null,
  "githubUrl": string | null,

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
- Return all free-text output in Romanian.
- Use Romanian month names for any date labels when possible.
- Extract email/phone ONLY if present in CV, else null (no guessing)
- Extract githubUrl ONLY if a github.com URL or username is present in CV, else null
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
- For experience and education dates:
  - If the CV mentions only a single month/year for an activity, put that same value in both startDate and endDate.
  - If the activity is still ongoing, set endDate to "Prezent".
  - Prefer the format "Martie 2023" instead of English month names.
- CRITICAL: evaluate FIT strictly vs JOB.
  If JOB is "oier" and candidate CV is only IT or construction, matchScore must be LOW (0..25) and recommendation should be RESPINGE or REVIZUIRE with clear redFlags.
- Use this scoring rubric:
  1) Core domain fit (0..40)
  2) Must-have requirements fit (0..30)
  3) Relevant experience recency/depth (0..20)
  4) Soft/other (0..10)
`.trim();

    const promptBase = `
You are an ATS recruiter assistant.

You will receive:
1) JOB requirements and description
2) The candidate CV as a document (PDF) OR extracted text (DOCX)

Task:
- Extract structured candidate data
- Evaluate candidate fit against the JOB using the rubric
- Provide matchedRequirements, missingRequirements, redFlags, evidence
- Produce matchScore 0..100 and recommendation

JOB:
${jobText}

${schema}
`.trim();

    if (!mt || mt === 'application/pdf') {
      const extractedText = await this.extractPdfText(bytes);

      const res =
        extractedText && extractedText.length >= 50
          ? await this.withRetry(() =>
              this.client.models.generateContent({
                model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
                contents: [
                  {
                    role: 'user',
                    parts: [
                      {
                        text: `${promptBase}\n\nCV (text extras din PDF):\n${extractedText}`,
                      },
                    ],
                  },
                ],
              }),
            )
          : await this.withRetry(() =>
              this.client.models.generateContent({
                model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
                contents: [
                  {
                    role: 'user',
                    parts: [
                      { text: promptBase },
                      {
                        inlineData: {
                          mimeType: 'application/pdf',
                          data: Buffer.from(bytes).toString('base64'),
                        },
                      },
                    ],
                  },
                ],
              }),
            );

      const text = res.text ?? '';
      const jsonStr = this.extractJson(text);

      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonStr);
      } catch {
        throw new BadRequestException('Gemini a returnat un JSON invalid.');
      }

      return this.sanitizeAnalysis(parsed, candidatePhotoDataUrl);
    }

    const isDocx =
      mt.includes(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ) || mt.includes('application/docx');

    if (isDocx) {
      let cvText = '';
      try {
        const extracted = await mammoth.extractRawText({ buffer: bytes });
        cvText = normalizeUnicodeText(extracted?.value || '');
      } catch {
        throw new BadRequestException('Nu pot extrage text din DOCX.');
      }

      if (!cvText || cvText.length < 50) {
        throw new BadRequestException(
          'DOCX pare gol sau textul extras este prea scurt pentru analiză.',
        );
      }

      if (cvText.length > 25000) {
        cvText = cvText.slice(0, 25000);
      }

      const promptDocx = `
${promptBase}

CV (text extras din DOCX):
${cvText}
`.trim();

      const res = await this.withRetry(() =>
        this.client.models.generateContent({
          model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
          contents: [{ role: 'user', parts: [{ text: promptDocx }] }],
        }),
      );

      const text = res.text ?? '';
      const jsonStr = this.extractJson(text);

      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonStr);
      } catch {
        throw new BadRequestException('Gemini a returnat un JSON invalid.');
      }

      return this.sanitizeAnalysis(parsed, candidatePhotoDataUrl);
    }

    throw new BadRequestException(
      `Tip fișier nesuportat pentru analiză: ${mimeType}. Folosește PDF sau DOCX.`,
    );
  }

  private async extractPdfText(bytes: Buffer): Promise<string> {
    try {
      const parsed = await pdfParse(bytes);
      const text = normalizeUnicodeText(parsed?.text || '');

      if (text.length < 50) return '';

      return text.length > 25000 ? text.slice(0, 25000) : text;
    } catch (error) {
      this.logger.warn(
        `PDF text extraction failed, will fallback to inline PDF input: ${String(
          (error as any)?.message || error,
        )}`,
      );
      return '';
    }
  }

  private async extractCandidatePhotoDataUrl(
    filePath: string,
    bytes: Buffer,
    mimeType: string,
  ): Promise<string | null> {
    const mt = String(mimeType || '').toLowerCase();

    if (mt === 'application/pdf') {
      const pdfPhoto = await this.extractPdfCandidatePhotoDataUrlWithPyMuPDF(
        filePath,
      );
      if (pdfPhoto) return pdfPhoto;

      return this.extractPdfCandidatePhotoDataUrl(new Uint8Array(bytes));
    }

    const isDocx =
      mt.includes(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ) || mt.includes('application/docx');

    if (isDocx) {
      return this.extractDocxCandidatePhotoDataUrl(bytes);
    }

    return null;
  }

  private async extractPdfCandidatePhotoDataUrlWithPyMuPDF(
    filePath: string,
  ): Promise<string | null> {
    const scriptCandidates = [
      path.resolve(process.cwd(), 'src/common/pdf-photo-extractor.py'),
      path.resolve(__dirname, '../common/pdf-photo-extractor.py'),
    ];
    const scriptPath = scriptCandidates.find((candidate) =>
      existsSync(candidate),
    );

    if (!scriptPath) {
      return null;
    }

    try {
      const stdout = execFileSync('python', [scriptPath, filePath], {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        timeout: 30000,
      }).trim();

      if (!stdout || stdout === 'null') return null;
      if (!stdout.startsWith('data:image/png;base64,')) return null;

      return stdout;
    } catch (error) {
      this.logger.warn(
        `PyMuPDF photo extraction failed: ${String(
          (error as any)?.message || error,
        )}`,
      );
      return null;
    }
  }

  private async extractDocxCandidatePhotoDataUrl(
    bytes: Buffer,
  ): Promise<string | null> {
    const candidates: Array<{ score: number; src: string }> = [];

    try {
      await mammoth.convertToHtml(
        { buffer: bytes },
        {
          convertImage: mammoth.images.imgElement(async (image) => {
            const buffer = Buffer.from(await image.readAsArrayBuffer());
            const src = buildDataUrl(image.contentType, buffer);
            const dimensions = parseImageDimensions(buffer);

            if (dimensions) {
              const area = dimensions.width * dimensions.height;
              const ratio = dimensions.width / Math.max(dimensions.height, 1);

              if (
                area >= 4000 &&
                area <= 600000 &&
                ratio >= 0.5 &&
                ratio <= 1.9
              ) {
                const squareScore = 1 - Math.min(Math.abs(ratio - 1), 1);
                const sizeScore = Math.min(area / 60000, 1);
                candidates.push({
                  src,
                  score: sizeScore * 0.7 + squareScore * 0.3,
                });
              }
            } else if (!candidates.length) {
              candidates.push({ src, score: 0 });
            }

            return { src };
          }),
        },
      );
    } catch (error) {
      this.logger.warn(
        `DOCX image extraction failed: ${String((error as any)?.message || error)}`,
      );
      return null;
    }

    if (!candidates.length) return null;

    candidates.sort((a, b) => b.score - a.score);
    return candidates[0]?.src || null;
  }

  private async extractPdfCandidatePhotoDataUrl(
    bytes: Uint8Array,
  ): Promise<string | null> {
    let pdf: any = null;
    let page: any = null;
    const pdfBytes =
      bytes instanceof Uint8Array && !Buffer.isBuffer(bytes)
        ? bytes
        : new Uint8Array(bytes);

    try {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      pdf = await pdfjs.getDocument({ data: pdfBytes }).promise;
      page = await pdf.getPage(1);
      const ops = await page.getOperatorList();

      const paintImageOps = new Set(
        ['paintImageXObject', 'paintImageMaskXObject']
          .map((name) => pdfjs.OPS?.[name])
          .filter((op) => typeof op === 'number'),
      );

      const candidates: Array<{
        objId: string;
        score: number;
      }> = [];
      const seen = new Set<string>();

      for (let i = 0; i < ops.fnArray.length; i++) {
        if (!paintImageOps.has(ops.fnArray[i])) continue;

        const args = ops.argsArray[i];
        const objId = Array.isArray(args) ? String(args[0] || '').trim() : '';
        const width = Array.isArray(args) ? Number(args[1]) : NaN;
        const height = Array.isArray(args) ? Number(args[2]) : NaN;

        if (!objId || seen.has(objId)) continue;
        seen.add(objId);

        if (!Number.isFinite(width) || !Number.isFinite(height)) continue;

        const safeWidth = Math.max(1, Math.round(width));
        const safeHeight = Math.max(1, Math.round(height));
        const area = safeWidth * safeHeight;
        const ratio = safeWidth / safeHeight;

        if (
          area < 4000 ||
          area > 600000 ||
          ratio < 0.5 ||
          ratio > 1.9
        ) {
          continue;
        }

        const squareScore = 1 - Math.min(Math.abs(ratio - 1), 1);
        const sizeScore = Math.min(area / 60000, 1);
        candidates.push({
          objId,
          score: sizeScore * 0.7 + squareScore * 0.3,
        });
      }

      candidates.sort((a, b) => b.score - a.score);

      for (const candidate of candidates.slice(0, 6)) {
        const image = await new Promise<any>((resolve) =>
          page.objs.get(candidate.objId, resolve),
        );
        const dataUrl = pdfImageToPngDataUrl(image);
        if (dataUrl) return dataUrl;
      }
    } catch (error) {
      this.logger.warn(
        `PDF photo extraction failed: ${String((error as any)?.message || error)}`,
      );
    } finally {
      try {
        page?.cleanup?.();
      } catch {
        // ignore cleanup issues
      }

      try {
        await pdf?.destroy?.();
      } catch {
        // ignore cleanup issues
      }
    }

    return null;
  }

  private sanitizeAnalysis(
    input: unknown,
    candidatePhotoDataUrl: string | null,
  ): GeminiJobCvAnalysis {
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

    const normalizeGithubUrl = (v: unknown) => {
      const s = typeof v === 'string' ? v.trim() : '';
      if (!s) return null;
      if (s.includes('github.com') || /^[a-zA-Z0-9-]+$/.test(s)) return s;
      return null;
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
      candidateName: normalizeUnicodeText(obj.candidateName),
      email: normalizeEmail(obj.email),
      phone: normalizePhone(obj.phone),
      githubUrl: normalizeGithubUrl(obj.githubUrl),
      candidatePhotoDataUrl: candidatePhotoDataUrl || null,

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
