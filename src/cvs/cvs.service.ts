import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { stat } from 'fs/promises';
import { Repository } from 'typeorm';
import { Cv } from './entities/cv.entity';
import { Job } from '../jobs/entities/job.entity';
import { CandidateAnalysisService } from '../analysis/candidate-analysis.service';
import { subtractStrings } from '../analysis/analysis.utils';
import { MailService } from '../mail/mail.service';
import { SendEmailDto } from './dto/send-email.dto';

@Injectable()
export class CvsService {
  private readonly logger = new Logger(CvsService.name);

  constructor(
    @InjectRepository(Cv) private readonly cvRepo: Repository<Cv>,
    @InjectRepository(Job) private readonly jobRepo: Repository<Job>,
    private readonly candidateAnalysisService: CandidateAnalysisService,
    private readonly mailService: MailService,
  ) {}

  async listForJob(jobId: number) {
    const job = await this.jobRepo.findOne({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Postul nu a fost găsit');

    const rows = await this.cvRepo.find({
      where: { job: { id: jobId } },
      order: { createdAt: 'DESC' },
    });

    return rows.map((cv) => this.sanitizeAnalysisOnRead(cv));
  }

  async uploadForJob(jobId: number, file: Express.Multer.File) {
    const job = await this.jobRepo.findOne({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Postul nu a fost găsit');

    if ((job as any).status === 'CLOSED') {
      throw new BadRequestException(
        'Postul este închis. Nu poți încărca CV-uri.',
      );
    }

    if (!file) {
      throw new BadRequestException('Lipsește fișierul');
    }

    const cv = this.cvRepo.create({
      job,
      fileName: file.originalname,
      storedName: file.filename,
      filePath: (file.path || '').replace(/\\/g, '/'),
      fileSize: file.size,
      mimeType: file.mimetype,

      candidateName: '',
      email: null,
      phone: null,
      languages: [],
      domains: [],

      matchScore: 0,
      status: 'Încărcat',
      skills: [],
      uploadDate: new Date(),

      analysisSummary: null,
      analysisRaw: null,
    });

    return this.cvRepo.save(cv);
  }

  async findOne(cvId: number) {
    const cv = await this.cvRepo.findOne({
      where: { id: cvId },
      relations: { job: true },
    });

    if (!cv) {
      throw new NotFoundException('CV-ul nu a fost găsit');
    }

    return this.sanitizeAnalysisOnRead(cv);
  }

  async getFileInfo(cvId: number) {
    const cv = await this.cvRepo.findOne({ where: { id: cvId } });
    if (!cv) throw new NotFoundException('CV-ul nu a fost găsit');
    if (!cv.filePath) throw new BadRequestException('CV nu are filePath');

    return {
      filePath: cv.filePath,
      fileName: cv.fileName,
      mimeType: cv.mimeType,
    };
  }

  async remove(cvId: number) {
    const cv = await this.cvRepo.findOne({ where: { id: cvId } });
    if (!cv) throw new NotFoundException('CV-ul nu a fost găsit');

    await this.cvRepo.remove(cv);
    return { ok: true as const };
  }

  async analyzeCv(jobId: number, cvId: number) {
    const cv = await this.cvRepo.findOne({
      where: { id: cvId },
      relations: { job: true },
    });

    if (!cv) {
      throw new NotFoundException('CV-ul nu a fost găsit');
    }

    if (!cv.job || cv.job.id !== jobId) {
      throw new BadRequestException('CV-ul nu aparține acestui job');
    }

    const job = await this.jobRepo.findOne({ where: { id: jobId } });
    if (!job) {
      throw new NotFoundException('Postul nu a fost găsit');
    }

    if ((job as any).status === 'CLOSED') {
      throw new BadRequestException(
        'Postul este închis. Analiza este blocată.',
      );
    }

    if (!cv.filePath) {
      throw new BadRequestException('CV-ul nu are fișier asociat (filePath).');
    }

    const st = await stat(cv.filePath).catch(() => null);
    if (!st || st.size < 200) {
      throw new BadRequestException(
        'Fișierul nu există pe disk sau este corupt.',
      );
    }

    const jobText = [
      `Titlu: ${job.title}`,
      `Categorie: ${job.category}`,
      `Locație: ${job.location}`,
      `Tip: ${job.type}`,
      `Descriere: ${job.description || ''}`,
      `Cerințe: ${job.requirements || ''}`,
    ]
      .filter(Boolean)
      .join('\n');

    this.logger.log(
      `Analyze CV vs Job: cvId=${cv.id} jobId=${job.id} file="${cv.fileName}"`,
    );

    const result = await this.candidateAnalysisService.analyzeCandidate({
      filePath: cv.filePath,
      mimeType: cv.mimeType || 'application/pdf',
      jobText,
      githubUsernameOrUrl: null,
    });

    cv.candidateName = result.candidateName || cv.candidateName || '';
    cv.matchScore = result.finalScore ?? 0;
    cv.status = 'Analizat';
    cv.skills = result.skills ?? [];
    cv.analysisSummary = result.summary || null;

    cv.email = result.email ?? null;
    cv.phone = result.phone ?? null;
    cv.languages = result.languages ?? [];
    cv.domains = result.domains ?? [];

    cv.analysisRaw = result;

    return this.cvRepo.save(cv);
  }

  private sanitizeAnalysisOnRead(cv: Cv) {
    const raw = cv.analysisRaw as any;
    if (!raw || typeof raw !== 'object') return cv;

    const topMatched = Array.isArray(raw.matchedRequirements)
      ? raw.matchedRequirements
      : [];
    const topMissing = Array.isArray(raw.missingRequirements)
      ? raw.missingRequirements
      : [];

    const cleanedTopMatched = subtractStrings(topMatched, [], 20);
    const cleanedTopMissing = subtractStrings(topMissing, cleanedTopMatched, 20);

    const cvAnalysis = raw.cvAnalysis && typeof raw.cvAnalysis === 'object'
      ? raw.cvAnalysis
      : null;
    const githubAnalysis =
      raw.githubAnalysis && typeof raw.githubAnalysis === 'object'
        ? raw.githubAnalysis
        : null;

    const cleanedCvAnalysis = cvAnalysis
      ? {
          ...cvAnalysis,
          matchedRequirements: subtractStrings(
            Array.isArray(cvAnalysis.matchedRequirements)
              ? cvAnalysis.matchedRequirements
              : [],
            [],
            15,
          ),
          missingRequirements: subtractStrings(
            Array.isArray(cvAnalysis.missingRequirements)
              ? cvAnalysis.missingRequirements
              : [],
            Array.isArray(cvAnalysis.matchedRequirements)
              ? cvAnalysis.matchedRequirements
              : [],
            15,
          ),
        }
      : null;

    const cleanedGithubAnalysis = githubAnalysis
      ? {
          ...githubAnalysis,
          matchedRequirements: subtractStrings(
            Array.isArray(githubAnalysis.matchedRequirements)
              ? githubAnalysis.matchedRequirements
              : [],
            [],
            15,
          ),
          missingRequirements: subtractStrings(
            Array.isArray(githubAnalysis.missingRequirements)
              ? githubAnalysis.missingRequirements
              : [],
            Array.isArray(githubAnalysis.matchedRequirements)
              ? githubAnalysis.matchedRequirements
              : [],
            15,
          ),
        }
      : null;

    cv.analysisRaw = {
      ...raw,
      matchedRequirements: cleanedTopMatched,
      missingRequirements: cleanedTopMissing,
      cvAnalysis: cleanedCvAnalysis,
      githubAnalysis: cleanedGithubAnalysis,
    };

    return cv;
  }

  async sendEmail(cvId: number, dto: SendEmailDto) {
    if (!cvId || Number.isNaN(cvId)) {
      throw new BadRequestException('CV invalid');
    }

    const hasText = typeof dto.text === 'string' && dto.text.trim().length > 0;
    const hasHtml = typeof dto.html === 'string' && dto.html.trim().length > 0;

    if (!hasText && !hasHtml) {
      throw new BadRequestException('Trimite text sau html.');
    }

    await this.mailService.send({
      to: dto.to.trim(),
      subject: dto.subject.trim(),
      text: hasText ? dto.text!.trim() : '',
      html: hasHtml ? dto.html : undefined,
    });

    return { ok: true };
  }

  async picker(q: string, limit = 20) {
    const take = Math.min(50, Math.max(5, limit));
    const term = q.trim().toLowerCase();

    const qb = this.cvRepo.createQueryBuilder('cv');

    if (term) {
      qb.where('LOWER(cv.candidateName) LIKE :t OR LOWER(cv.email) LIKE :t', {
        t: `%${term}%`,
      });
    }

    qb.orderBy('cv.updatedAt', 'DESC').take(take);

    const rows = await qb.getMany();

    return rows
      .filter((r: any) => r?.candidateName && r?.email)
      .map((r: any) => {
        const fullName = String(r.candidateName || '').trim();
        const email = String(r.email || '').trim();
        const id = Number(r.id);

        return {
          id,
          fullName,
          email,
          label: `${fullName} • ${email} • CV #${id}`,
        };
      });
  }
}
