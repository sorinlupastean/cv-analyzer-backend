import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Cv } from './entities/cv.entity';
import { Job } from '../jobs/entities/job.entity';
import { CvsService } from './cvs.service';
import { CvsController } from './cvs.controller';
import { AnalysisModule } from '../analysis/analysis.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [TypeOrmModule.forFeature([Cv, Job]), AnalysisModule, MailModule],
  controllers: [CvsController],
  providers: [CvsService],
  exports: [CvsService],
})
export class CvsModule {}
