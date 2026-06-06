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

type JobStatus = 'ACTIVE' | 'CLOSED';

@Injectable()
export class JobsService {
  constructor(@InjectRepository(Job) private readonly repo: Repository<Job>) {}

  findAll() {
    const jobs = this.repo.find({
      relations: { cvs: true },
      order: { createdAt: 'DESC' },
    });

    return jobs.then((rows) => rows.map((job) => this.withOnlyAnalyzedCvs(job)));
  }

  async findOne(id: number) {
    const job = await this.repo.findOne({
      where: { id },
      relations: { cvs: true },
    });
    if (!job) throw new NotFoundException('Job not found');
    return this.withOnlyAnalyzedCvs(job);
  }

  create(dto: CreateJobDto) {
    const job = this.repo.create({
      ...dto,
      location: dto.location ?? '',
      requirements: dto.requirements ?? '',
      status: (dto.status ?? 'ACTIVE') as JobStatus,
      cvs: [],
    });

    return this.repo.save(job);
  }

  async update(id: number, dto: UpdateJobDto) {
    const job = await this.findOne(id);

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

  async setStatus(id: number, status: JobStatus) {
    const job = await this.findOne(id);
    job.status = status;
    return this.repo.save(job);
  }

  async remove(id: number) {
    const job = await this.findOne(id);
    await this.repo.remove(job);
    return { ok: true };
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
}
