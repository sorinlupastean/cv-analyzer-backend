import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
} from 'typeorm';
import { Cv } from '../../cvs/entities/cv.entity';

export type JobStatus = 'ACTIVE' | 'CLOSED';

@Entity()
export class Job {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 200 })
  title: string;

  @Column({ length: 120 })
  category: string;

  @Column({ length: 120, default: '' })
  location: string;

  @Column({ length: 60 })
  type: string;

  @Column({ type: 'text' })
  description: string;

  // ✅ nou: requirements separat
  @Column({ type: 'text', default: '' })
  requirements: string;

  // ✅ nou: status job
  @Column({ type: 'varchar', length: 10, default: 'ACTIVE' })
  status: JobStatus;

  @CreateDateColumn()
  createdAt: Date;

  @OneToMany(() => Cv, (cv) => cv.job, { cascade: true })
  cvs: Cv[];
}
