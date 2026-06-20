import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
  ManyToOne,
} from 'typeorm';
import { Cv } from '../../cvs/entities/cv.entity';
import { User } from '../../users/entities/user.entity';

export type JobStatus = 'ACTIVE' | 'CLOSED';

@Entity()
export class Job {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ length: 200 })
  title!: string;

  @Column({ length: 120 })
  category!: string;

  @Column({ length: 120, default: '' })
  location!: string;

  @Column({ length: 60 })
  type!: string;

  @Column({ type: 'text' })
  description!: string;

  @Column({ type: 'text', default: '' })
  requirements!: string;

  @Column({ type: 'varchar', length: 10, default: 'ACTIVE' })
  status!: JobStatus;

  @Column({ type: 'jsonb', nullable: true })
  copilotMemory!: {
    mode?: 'ai' | 'local';
    lastTopCandidateIds?: number[];
    lastTopCandidateNames?: string[];
    lastGeneratedAt?: string;
    notes?: string[];
  } | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  copilotLastRunAt!: Date | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  copilotMode!: 'ai' | 'local' | null;

  @CreateDateColumn()
  createdAt!: Date;

  @OneToMany(() => Cv, (cv) => cv.job, { cascade: true })
  cvs!: Cv[];

  @ManyToOne(() => User, {
    nullable: true,
    onDelete: 'CASCADE',
  })
  owner!: User | null;
}
