import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from './entities/job.entity';
import { CreateJobDto } from './dto/create-job.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { Cv } from '../cvs/entities/cv.entity';
import { User } from '../users/entities/user.entity';
import {
  RecruiterCopilotCandidate,
  RecruiterCopilotDecision,
  RecruiterCopilotReport,
} from './dto/recruiter-copilot.dto';
import { normalizeUnicodeText } from '../common/text-normalization';
import { RecruiterCopilotAgentService } from './recruiter-copilot-agent.service';

type JobStatus = 'ACTIVE' | 'CLOSED';

@Injectable()
export class JobsService {
  constructor(
    @InjectRepository(Job) private readonly repo: Repository<Job>,
    private readonly recruiterCopilotAgentService: RecruiterCopilotAgentService,
  ) {}

  findAll(userId: number) {
    const jobs = this.repo.find({
      where: { owner: { id: userId } },
      relations: { cvs: true },
      order: { createdAt: 'DESC' },
    });

    return jobs.then((rows) => rows.map((job) => this.withOnlyAnalyzedCvs(job)));
  }

  async findOne(id: number, userId: number) {
    const job = await this.repo.findOne({
      where: { id, owner: { id: userId } },
      relations: { cvs: true },
    });
    if (!job) throw new NotFoundException('Job not found');
    return this.withOnlyAnalyzedCvs(job);
  }

  create(userId: number, dto: CreateJobDto) {
    const job = this.repo.create({
      ...dto,
      location: dto.location ?? '',
      requirements: dto.requirements ?? '',
      status: (dto.status ?? 'ACTIVE') as JobStatus,
      cvs: [],
      owner: { id: userId } as User,
    });

    return this.repo.save(job);
  }

  async update(id: number, userId: number, dto: UpdateJobDto) {
    const job = await this.findOne(id, userId);

    if (job.status === 'CLOSED') {
      throw new BadRequestException(
        'Job-ul este închis. Poți doar să îl ștergi.',
      );
    }

    const { status, ...safeDto } = dto as any;

    Object.assign(job, {
      ...safeDto,

      location: safeDto.location ?? job.location,
      requirements: safeDto.requirements ?? job.requirements,
    });

    return this.repo.save(job);
  }

  async setStatus(id: number, userId: number, status: JobStatus) {
    const job = await this.findOne(id, userId);
    job.status = status;
    return this.repo.save(job);
  }

  async remove(id: number, userId: number) {
    const job = await this.findOne(id, userId);
    await this.repo.remove(job);
    return { ok: true };
  }
  

  async getRecruiterCopilotReport(
    id: number,
    userId: number,
  ): Promise<RecruiterCopilotReport> {
    const job = await this.repo.findOne({
      where: { id, owner: { id: userId } },
      relations: { cvs: true },
    });

    if (!job) throw new NotFoundException('Job not found');

    const analyzedCvs = (Array.isArray(job.cvs) ? job.cvs : [])
      .filter((cv) => this.isAnalyzedCv(cv))
      .map((cv) => this.buildCandidateCard(cv, job.title))
      .sort((a, b) => {
        if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
        if (b.confidenceScore !== a.confidenceScore) {
          return b.confidenceScore - a.confidenceScore;
        }
        return a.candidateName.localeCompare(b.candidateName, 'ro-RO');
      });

    const candidates = analyzedCvs.slice(0, 10).map((candidate, index) => ({
      ...candidate,
      position: index + 1,
    }));

    const averageScore = candidates.length
      ? Math.round(
          candidates.reduce((sum, candidate) => sum + candidate.matchScore, 0) /
            candidates.length,
        )
      : 0;

    const topCandidate = candidates[0] ?? null;
    const generatedAt = new Date().toISOString();
    const agent = await this.recruiterCopilotAgentService.synthesize({
      job: {
        id: job.id,
        title: normalizeUnicodeText(job.title) || job.title,
        category: normalizeUnicodeText(job.category) || job.category,
        location: normalizeUnicodeText(job.location) || job.location,
        type: normalizeUnicodeText(job.type) || job.type,
        requirements: normalizeUnicodeText(job.requirements) || job.requirements,
        description: normalizeUnicodeText(job.description) || job.description,
      },
      candidates,
      previousMemory: job.copilotMemory,
      generatedAt,
    });
    const highlights = agent.highlights.length
      ? agent.highlights
      : this.buildReportHighlights(candidates);

    await this.repo.update(job.id, {
      copilotMemory: agent.memory,
      copilotLastRunAt: new Date(generatedAt),
      copilotMode: agent.mode,
    } as any);

    return {
      job: {
        id: job.id,
        title: normalizeUnicodeText(job.title) || job.title,
        category: normalizeUnicodeText(job.category) || job.category,
        location: normalizeUnicodeText(job.location) || job.location,
        type: normalizeUnicodeText(job.type) || job.type,
        status: job.status,
        requirements: normalizeUnicodeText(job.requirements) || job.requirements,
      },
      summary: {
        totalCandidates: Array.isArray(job.cvs) ? job.cvs.length : 0,
        analyzedCandidates: analyzedCvs.length,
        shortlistCount: candidates.length,
        averageScore,
        topRecommendation:
          agent.topRecommendation ?? topCandidate?.nextStep ?? 'FOLLOW_UP',
        topSignal: agent.topSignal,
        highlights,
        agentMode: agent.mode,
      },
      candidates,
      agent: {
        mode: agent.mode,
        label: agent.label,
        summary: agent.summary,
        trace: agent.trace,
        memory: agent.memory,
        usedFallback: agent.usedFallback,
      },
      generatedAt,
    };
  }

  private withOnlyAnalyzedCvs(job: Job): Job {
    const cvs = Array.isArray(job.cvs) ? job.cvs : [];

    return {
      ...job,
      cvs: cvs.filter((cv) => this.isAnalyzedCv(cv)),
    };
  }

  private isAnalyzedCv(cv: Cv): boolean {
    const status = String(cv?.status ?? '').toLowerCase();
    return status.includes('analiz') || Boolean(cv?.analysisRaw);
  }

  private buildCandidateCard(cv: Cv, jobTitle: string): RecruiterCopilotCandidate {
    const analysis = this.getAnalysis(cv);
    const cvAnalysis = analysis?.cvAnalysis ?? null;
    const experience = Array.isArray(cvAnalysis?.experience) ? cvAnalysis.experience : [];
    const evidenceList = Array.isArray(analysis?.evidence) ? analysis.evidence : [];
    const matchedRequirements = Array.isArray(analysis?.matchedRequirements)
      ? analysis.matchedRequirements
      : [];
    const missingRequirements = Array.isArray(analysis?.missingRequirements)
      ? analysis.missingRequirements
      : [];
    const redFlags = Array.isArray(analysis?.redFlags) ? analysis.redFlags : [];
    const skillsList = Array.isArray(analysis?.skills) ? analysis.skills : [];
    const validatedSkills = Array.isArray(analysis?.validatedSkills)
      ? analysis.validatedSkills
      : [];
    const languagesList = Array.isArray(analysis?.languages) ? analysis.languages : [];
    const domainsList = Array.isArray(analysis?.domains) ? analysis.domains : [];
    const githubEvidence = Array.isArray(analysis?.githubAnalysis?.evidence)
      ? analysis.githubAnalysis.evidence
      : [];
    const finalScore = this.clampScore(
      analysis?.finalScore ?? cv.matchScore ?? 0,
    );
    const confidenceScore = this.clampScore(
      analysis?.confidenceScore ?? (analysis?.finalScore ? 70 : 55),
    );
    const recommendation = this.normalizeRecommendation(
      analysis?.recommendation,
      finalScore,
      redFlags.length,
      missingRequirements.length,
    );
    const nextStep = this.pickNextStep(
      recommendation,
      finalScore,
      confidenceScore,
      redFlags.length,
      missingRequirements.length,
    );

    const evidence = this.takeUnique([
      ...evidenceList,
      ...matchedRequirements.slice(0, 2),
      ...experience.flatMap((experience) => {
        const parts = [
          experience.title,
          experience.company,
          experience.location,
        ]
          .map((part) => normalizeUnicodeText(part))
          .filter(Boolean);
        return parts.length ? [`${parts[0]}${parts[1] ? ` at ${parts[1]}` : ''}`] : [];
      }),
      ...githubEvidence,
    ]).slice(0, 4);

    const risks = this.takeUnique([
      ...redFlags.map((item) => `Semnal de risc: ${item}`),
      ...missingRequirements.slice(0, 4).map((item) => `Lipsă: ${item}`),
    ]).slice(0, 4);

    const experienceHighlights = this.takeUnique(
      experience
        .slice(0, 3)
        .map((experience) => {
          const role = normalizeUnicodeText(experience.title);
          const company = normalizeUnicodeText(experience.company);
          if (!role && !company) return '';
          return company ? `${role || 'Rol'} - ${company}` : role || '';
        }),
    ).filter(Boolean);

    const interviewQuestions = this.buildInterviewQuestions({
      analysis,
      jobTitle,
      candidateName: cv.candidateName,
    });

    const badge = this.resolveBadge(finalScore, recommendation, risks.length);
    const githubAnalysis = analysis?.githubAnalysis ?? null;

    return {
      id: cv.id,
      candidateName: normalizeUnicodeText(cv.candidateName) || cv.candidateName,
      fileName: normalizeUnicodeText(cv.fileName) || cv.fileName,
      matchScore: finalScore,
      confidenceScore,
      recommendation,
      nextStep,
      badge,
      explanation: this.buildShortExplanation(
        analysis?.reasoningShort ?? analysis?.summary ?? cv.analysisSummary ?? '',
        recommendation,
        finalScore,
      ),
      evidence,
      risks,
      experienceHighlights,
      interviewQuestions,
      skills: this.takeUnique([
        ...skillsList,
        ...validatedSkills,
        ...(Array.isArray(cv.skills) ? cv.skills : []),
      ]).slice(0, 8),
      languages: this.takeUnique([
        ...languagesList,
        ...(Array.isArray(cv.languages) ? cv.languages : []),
      ]).slice(0, 6),
      domains: this.takeUnique([
        ...domainsList,
        ...(Array.isArray(cv.domains) ? cv.domains : []),
      ]).slice(0, 6),
      github: githubAnalysis
        ? {
            username: normalizeUnicodeText(githubAnalysis.username) || githubAnalysis.username,
            profileUrl: githubAnalysis.profileUrl,
            score: this.clampScore(githubAnalysis.githubScore),
            evidence: this.takeUnique(githubAnalysis.evidence ?? []).slice(0, 3),
          }
        : null,
      position: 0,
    };
  }

  private getAnalysis(cv: Cv): any | null {
    const raw = cv.analysisRaw;
    if (!raw || typeof raw !== 'object') return null;
    return raw;
  }

  private normalizeRecommendation(
    value: unknown,
    score: number,
    redFlagsCount: number,
    missingRequirementsCount: number,
  ) {
    const rec = String(value ?? '').toUpperCase();
    if (rec === 'INVITA' || rec === 'REVIZUIRE' || rec === 'RESPINGE') {
      return rec as 'INVITA' | 'REVIZUIRE' | 'RESPINGE';
    }

    if (score >= 78 && redFlagsCount <= 1) return 'INVITA';
    if (score < 42 || redFlagsCount >= 4) return 'RESPINGE';
    if (missingRequirementsCount >= 4) return 'REVIZUIRE';
    return 'REVIZUIRE';
  }

  private pickNextStep(
    recommendation: 'INVITA' | 'REVIZUIRE' | 'RESPINGE',
    score: number,
    confidence: number,
    redFlagsCount: number,
    missingRequirementsCount: number,
  ): RecruiterCopilotDecision {
    if (recommendation === 'RESPINGE' && score < 40) return 'REJECT';
    if (recommendation === 'INVITA' && confidence >= 70 && redFlagsCount <= 1) {
      return 'INVITE';
    }
    if (recommendation === 'REVIZUIRE' && missingRequirementsCount >= 3) {
      return 'FOLLOW_UP';
    }
    if (score >= 70 && confidence < 70) return 'FOLLOW_UP';
    if (recommendation === 'REVIZUIRE') return 'REVIEW';
    return recommendation === 'RESPINGE' ? 'REJECT' : 'INVITE';
  }

  private resolveBadge(
    score: number,
    recommendation: 'INVITA' | 'REVIZUIRE' | 'RESPINGE',
    risksCount: number,
  ): string {
    if (score >= 85) return 'Potrivire';
    if (score >= 74 && risksCount <= 2) return 'Pregătit pentru interviu';
    if (risksCount >= 3 && score < 80) return 'Risc identificat';
    if (recommendation === 'REVIZUIRE') return 'Necesită revizuire';
    return 'Dovezi solide';
  }

  private buildShortExplanation(
    input: string,
    recommendation: 'INVITA' | 'REVIZUIRE' | 'RESPINGE',
    score: number,
  ): string {
    const normalized = normalizeUnicodeText(input);
    if (normalized) {
      return this.truncate(normalized.replace(/^\s*-\s*/gm, ''), 180);
    }

    if (recommendation === 'INVITA') {
      return `Scorul ${score}% și dovezile relevante susțin o invitație rapidă.`;
    }
    if (recommendation === 'RESPINGE') {
      return `Scorul ${score}% și riscurile identificate cer respingere sau filtrare.`;
    }
    return `Scorul ${score}% indică potențial, dar sunt necesare clarificări.`;
  }

  private buildInterviewQuestions(params: {
    analysis: any | null;
    jobTitle: string;
    candidateName: string;
  }): string[] {
    const { analysis, jobTitle, candidateName } = params;
    const questions = new Array<string>();
    const missing = this.takeUnique(
      Array.isArray(analysis?.missingRequirements) ? analysis.missingRequirements : [],
    );
    const risks = this.takeUnique(
      Array.isArray(analysis?.redFlags) ? analysis.redFlags : [],
    );
    const experiences = Array.isArray(analysis?.cvAnalysis?.experience)
      ? analysis.cvAnalysis.experience
      : [];
    const github = analysis?.githubAnalysis;

    if (missing.length) {
      questions.push(`Poți detalia experiența ta cu ${missing[0]}?`);
    }

    if (experiences.length) {
      const first = experiences[0];
      const role = normalizeUnicodeText(first?.title);
      const company = normalizeUnicodeText(first?.company);
      if (role || company) {
        questions.push(
          `Cum ai livrat impact în rolul ${role || 'menționat'}${company ? ` la ${company}` : ''}?`,
        );
      }
    }

    if (github?.profileUrl) {
      questions.push(
        'Ce ai valida în plus în repo-urile tale pentru a demonstra calitatea codului?',
      );
    }

    if (risks.length) {
      questions.push(`Cum ai clarifica semnalul de risc legat de ${risks[0]}?`);
    }

    if (!questions.length) {
      questions.push(
        `Ce te face potrivit pentru ${jobTitle || 'această poziție'}?`,
      );
      questions.push(`Care este cea mai relevantă decizie tehnică din parcursul tău, ${candidateName || 'candidatul'}?`);
    }

    return questions.slice(0, 4);
  }

  private buildReportHighlights(
    candidates: RecruiterCopilotCandidate[],
  ): string[] {
    const topCandidate = candidates[0];
    const secondCandidate = candidates[1];
    const thirdCandidate = candidates[2];

    const highlights = [
      topCandidate
        ? `1. ${topCandidate.candidateName} conduce clasamentul cu ${topCandidate.matchScore}% potrivire.`
        : 'Încă nu există candidați analizați.',
      secondCandidate
        ? `2. ${secondCandidate.candidateName} este opțiunea de rezervă, cu ${secondCandidate.matchScore}% potrivire.`
        : 'Locul 2 nu este încă disponibil.',
      thirdCandidate
        ? `3. ${thirdCandidate.candidateName} completează topul cu ${thirdCandidate.matchScore}% potrivire.`
        : 'Locul 3 nu este încă disponibil.',
    ];

    return highlights;
  }

  private takeUnique(values: unknown[]): string[] {
    const seen = new Set<string>();
    const output: string[] = [];

    for (const value of values || []) {
      const normalized = normalizeUnicodeText(String(value ?? ''));
      if (!normalized || seen.has(normalized.toLowerCase())) continue;
      seen.add(normalized.toLowerCase());
      output.push(normalized);
    }

    return output;
  }

  private clampScore(value: unknown): number {
    const num = Number(value ?? 0);
    if (!Number.isFinite(num)) return 0;
    return Math.max(0, Math.min(100, Math.round(num)));
  }

  private truncate(value: string, length = 120): string {
    const text = normalizeUnicodeText(value);
    if (text.length <= length) return text;
    return `${text.slice(0, Math.max(0, length - 1)).trimEnd()}…`;
  }
}
