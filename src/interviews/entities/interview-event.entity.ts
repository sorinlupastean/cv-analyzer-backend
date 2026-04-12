import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type InterviewStatus = 'SCHEDULED' | 'CONFIRMED' | 'CANCELLED';

// interview-event.entity.ts
@Entity({ name: 'interview_events' })
export class InterviewEvent {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column({ type: 'timestamptz' })
  startAt!: Date;

  @Index()
  @Column({ type: 'timestamptz' })
  endAt!: Date;

  @Column({ type: 'varchar', length: 180 })
  title!: string;

  @Column({ type: 'varchar', length: 180, nullable: true })
  location!: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  meetLink!: string | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ type: 'varchar', length: 20, default: 'SCHEDULED' })
  status!: InterviewStatus;

  @Index()
  @Column({ type: 'int', nullable: true })
  cvId!: number | null;

  @Column({ type: 'varchar', length: 180 })
  candidateName!: string;

  @Column({ type: 'varchar', length: 180 })
  candidateEmail!: string;

  @Index()
  @Column({ type: 'varchar', length: 80, nullable: true })
  confirmToken!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  confirmTokenExpiresAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  confirmedAt!: Date | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  cancelToken!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
