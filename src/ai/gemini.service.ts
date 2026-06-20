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

  async generateJson<T = unknown>(prompt: string): Promise<T> {
    const res = await this.withRetry(() =>
      this.client.models.generateContent({
        model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      }),
    );

    const text = res.text ?? '';
    const jsonStr = this.extractJson(text);

    try {
      return JSON.parse(jsonStr) as T;
    } catch {
      throw new BadRequestException('Gemini a returnat un JSON invalid.');
    }
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
    const mt = String(mimeType || '').toLowerCase();
    const bytes = await readFile(filePath);
    const candidatePhotoDataUrl = await this.extractCandidatePhotoDataUrl(
      filePath,
      bytes,
      mt,
    );

    if (!process.env.GEMINI_API_KEY) {
      this.logger.warn(
        'GEMINI_API_KEY lipsește, folosesc analiza locală pentru CV.',
      );
      return this.buildLocalAnalysis(bytes, mt, jobText, candidatePhotoDataUrl);
    }

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

    try {
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
    } catch (error) {
      this.logger.warn(
        `Gemini analysis failed, falling back to local analysis: ${String(
          (error as any)?.message || error,
        )}`,
      );
      return this.buildLocalAnalysis(bytes, mt, jobText, candidatePhotoDataUrl);
    }

    return this.buildLocalAnalysis(bytes, mt, jobText, candidatePhotoDataUrl);
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
      pdf = await pdfjs
        .getDocument({
          data: pdfBytes,
          standardFontDataUrl: path.resolve(
            process.cwd(),
            'node_modules/pdfjs-dist/standard_fonts/',
          ),
        })
        .promise;
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

  private async buildLocalAnalysis(
    bytes: Buffer,
    mimeType: string,
    jobText: string,
    candidatePhotoDataUrl: string | null,
  ): Promise<GeminiJobCvAnalysis> {
    const cvText = await this.extractPlainText(bytes, mimeType);
    const normalizedCvText = normalizeUnicodeText(cvText).replace(/\s+/g, ' ').trim();
    const normalizedJobText = normalizeUnicodeText(jobText).replace(/\s+/g, ' ').trim();

    const skillCatalog = [
      'TypeScript',
      'JavaScript',
      'React',
      'Node.js',
      'NestJS',
      'Express',
      'Angular',
      'Vue',
      'Next.js',
      'HTML',
      'CSS',
      'SQL',
      'PostgreSQL',
      'MongoDB',
      'Prisma',
      'Docker',
      'Git',
      'GitHub',
      'REST API',
      'JWT',
      'Testing',
    ];

    const detectedSkills = skillCatalog.filter((skill) =>
      this.includesText(normalizedCvText, skill),
    );

    const jobRequirements = this.extractRequirementSegments(normalizedJobText);
    const matchedRequirements = jobRequirements.filter((req) =>
      this.includesText(normalizedCvText, req),
    );
    const missingRequirements = jobRequirements.filter(
      (req) => !this.includesText(normalizedCvText, req),
    );

    const redFlags: string[] = [];
    if (normalizedCvText.length < 350) {
      redFlags.push('CV-ul are prea puțin text extras pentru o analiză sigură.');
    }
    if (!detectedSkills.length) {
      redFlags.push('Nu au fost identificate competențe tehnice clare în CV.');
    }
    if (!this.extractGithubUrl(normalizedCvText)) {
      redFlags.push('Nu a fost găsit un profil GitHub sau o trimitere clară către GitHub.');
    }

    const evidence = this.buildEvidenceSnippets(normalizedCvText, [
      ...detectedSkills.slice(0, 4),
      ...matchedRequirements.slice(0, 2),
    ]);

    const candidateName =
      this.extractCandidateName(normalizedCvText) ||
      'Candidat identificat local';

    const score = this.computeLocalScore({
      skillsCount: detectedSkills.length,
      matchedCount: matchedRequirements.length,
      missingCount: missingRequirements.length,
      redFlagsCount: redFlags.length,
      textLength: normalizedCvText.length,
      hasGithub: Boolean(this.extractGithubUrl(normalizedCvText)),
    });

    const recommendation: Recommendation =
      score >= 75 ? 'INVITA' : score >= 45 ? 'REVIZUIRE' : 'RESPINGE';

    const reasoningShort = [
      `- Score local: ${score}`,
      detectedSkills.length
        ? `- Skills: ${detectedSkills.slice(0, 6).join(', ')}`
        : '- Skills: nu au fost identificate clar',
      matchedRequirements.length
        ? `- Potriviri: ${matchedRequirements.slice(0, 5).join(', ')}`
        : '- Potriviri: puține potriviri clare',
      missingRequirements.length
        ? `- Lipsuri: ${missingRequirements.slice(0, 5).join(', ')}`
        : '- Lipsuri: nu sunt evidente',
    ].join('\n');

    const summary = [
      `Analiză locală pentru ${candidateName}.`,
      detectedSkills.length
        ? `Competențe detectate: ${detectedSkills.slice(0, 6).join(', ')}.`
        : 'Competențele tehnice nu sunt foarte clare din textul extras.',
      matchedRequirements.length
        ? `Cerinte potrivite: ${matchedRequirements.slice(0, 4).join(', ')}.`
        : 'Sunt necesare clarificări pe cerințele jobului.',
    ].join(' ');

    return this.sanitizeAnalysis(
      {
        candidateName,
        email: null,
        phone: null,
        githubUrl: this.extractGithubUrl(normalizedCvText),
        languages: this.extractLanguages(normalizedCvText),
        domains: this.extractDomains(normalizedCvText),
        skills: detectedSkills,
        experience: this.extractExperience(normalizedCvText),
        education: this.extractEducation(normalizedCvText),
        matchedRequirements,
        missingRequirements,
        redFlags,
        summary,
        matchScore: score,
        recommendation,
        reasoningShort,
        evidence,
      },
      candidatePhotoDataUrl,
    );
  }

  private async extractPlainText(
    bytes: Buffer,
    mimeType: string,
  ): Promise<string> {
    const mt = String(mimeType || '').toLowerCase();

    if (mt === 'application/pdf') {
      try {
        const parsed = await pdfParse(bytes);
        return normalizeUnicodeText(parsed?.text || '');
      } catch {
        return '';
      }
    }

    const isDocx =
      mt.includes(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ) || mt.includes('application/docx');

    if (isDocx) {
      try {
        const extracted = await mammoth.extractRawText({ buffer: bytes });
        return normalizeUnicodeText(extracted?.value || '');
      } catch {
        return '';
      }
    }

    return normalizeUnicodeText(bytes.toString('utf8'));
  }

  private extractRequirementSegments(jobText: string): string[] {
    const lines = normalizeUnicodeText(jobText)
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*[-*•]\s*/, '').trim())
      .filter(Boolean);

    const cleaned = lines
      .filter((line) => line.length >= 4)
      .filter(
        (line) =>
          !/^(titlu|categorie|locație|locatie|tip|descriere|cerințe|cerinte):/i.test(line),
      );

    const segments = cleaned.length ? cleaned : [normalizeUnicodeText(jobText)];

    return segments
      .flatMap((segment) =>
        segment
          .split(/[,;/]| și /i)
          .map((part) => part.trim())
          .filter((part) => part.length >= 4),
      )
      .slice(0, 12);
  }

  private includesText(text: string, term: string): boolean {
    const t = normalizeUnicodeText(text).toLowerCase();
    const n = normalizeUnicodeText(term).toLowerCase();
    if (!t || !n) return false;
    const normalizedTerm = n.replace(/\./g, '').trim();
    return (
      t.includes(n) ||
      (normalizedTerm !== n && t.includes(normalizedTerm)) ||
      t.includes(normalizedTerm.replace(/\s+/g, ' '))
    );
  }

  private extractGithubUrl(text: string): string | null {
    const match = text.match(/https?:\/\/(?:www\.)?github\.com\/[A-Za-z0-9_.-]+/i);
    return match?.[0] ?? null;
  }

  private extractCandidateName(text: string): string {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 12);

    for (const line of lines) {
      const cleanLine = line
        .replace(/[|·•]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (cleanLine.length < 4 || cleanLine.length > 42) continue;
      if (/@/.test(cleanLine) || /\d{2,}/.test(cleanLine)) continue;
      if (this.includesText(cleanLine, 'curriculum vitae')) continue;
      if (this.includesText(cleanLine, 'resume')) continue;
      if (this.includesText(cleanLine, 'email')) continue;
      if (this.includesText(cleanLine, 'telefon')) continue;
      if (/^(experience|experiență|educație|education|skills|competences)/i.test(cleanLine)) continue;
      return cleanLine;
    }

    return '';
  }

  private extractLanguages(text: string): string[] {
    const catalog = ['Romanian', 'English', 'German', 'French', 'Italian', 'Spanish'];
    return catalog.filter((lang) => this.includesText(text, lang)).slice(0, 6);
  }

  private extractDomains(text: string): string[] {
    const catalog = ['Frontend', 'Backend', 'Full Stack', 'Mobile', 'DevOps', 'Data'];
    return catalog.filter((item) => this.includesText(text, item)).slice(0, 6);
  }

  private extractExperience(text: string) {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 10);

    const likely = lines.filter((line) =>
      /(developer|engineer|intern|manager|specialist|consultant|lead|senior|junior)/i.test(line),
    );

    return likely.slice(0, 5).map((line) => ({
      title: line.slice(0, 80),
      company: undefined,
      startDate: undefined,
      endDate: undefined,
      location: undefined,
      responsibilities: [],
      technologies: [],
    }));
  }

  private extractEducation(text: string) {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 10);

    const likely = lines.filter((line) => /(university|universitate|facult|college|school|liceu|academy)/i.test(line));

    return likely.slice(0, 4).map((line) => ({
      school: line.slice(0, 80),
      degree: undefined,
      field: undefined,
      startDate: undefined,
      endDate: undefined,
    }));
  }

  private buildEvidenceSnippets(text: string, terms: string[]): string[] {
    const snippets: string[] = [];
    const lowerText = text.toLowerCase();
    for (const term of terms) {
      const idx = lowerText.indexOf(term.toLowerCase());
      if (idx === -1) continue;
      const start = Math.max(0, idx - 35);
      const end = Math.min(text.length, idx + term.length + 45);
      snippets.push(text.slice(start, end).trim());
      if (snippets.length >= 4) break;
    }
    return snippets;
  }

  private computeLocalScore(input: {
    skillsCount: number;
    matchedCount: number;
    missingCount: number;
    redFlagsCount: number;
    textLength: number;
    hasGithub: boolean;
  }): number {
    const base = 20;
    const skillsScore = Math.min(input.skillsCount * 7, 35);
    const matchScore = Math.min(input.matchedCount * 5, 30);
    const textScore = input.textLength >= 1200 ? 10 : input.textLength >= 600 ? 6 : 0;
    const githubScore = input.hasGithub ? 5 : 0;
    const penalty = Math.min(input.redFlagsCount * 4, 25) + Math.min(input.missingCount * 2, 10);

    return Math.max(0, Math.min(100, base + skillsScore + matchScore + textScore + githubScore - penalty));
  }

  private extractJson(s: string) {
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return '{}';
    return s.slice(start, end + 1);
  }
}
