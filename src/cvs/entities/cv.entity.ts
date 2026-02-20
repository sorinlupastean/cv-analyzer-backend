import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  Index,
  CreateDateColumn,
} from 'typeorm';
import { Job } from '../../jobs/entities/job.entity';

@Entity()
export class Cv {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 220 })
  fileName: string;

  @Column({ type: 'varchar', length: 220, nullable: true })
  storedName: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  filePath: string | null;

  @Column({ type: 'int', nullable: true })
  fileSize: number | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  mimeType: string | null;

  @Column({ length: 160, default: '' })
  candidateName: string;

  // NOU: date contact
  @Column({ type: 'varchar', length: 180, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  phone: string | null;

  // NOU: limbi si domenii, utile in UI
  @Column({ type: 'text', array: true, default: () => 'ARRAY[]::text[]' })
  languages: string[];

  @Column({ type: 'text', array: true, default: () => 'ARRAY[]::text[]' })
  domains: string[];

  @Column({ type: 'date', nullable: true })
  uploadDate: Date | null;

  @Column({ type: 'int', default: 0 })
  matchScore: number;

  @Column({ length: 60, default: 'Încărcat' })
  status: string;

  @Column({ type: 'text', array: true, default: () => 'ARRAY[]::text[]' })
  skills: string[];

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'text', nullable: true })
  analysisSummary: string | null;

  @Column({ type: 'jsonb', nullable: true })
  analysisRaw: any | null;

  @Index()
  @ManyToOne(() => Job, (job) => job.cvs, { onDelete: 'CASCADE' })
  job: Job;
}
