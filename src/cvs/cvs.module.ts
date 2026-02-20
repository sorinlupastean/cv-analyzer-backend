import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Cv } from './entities/cv.entity';
import { Job } from '../jobs/entities/job.entity';
import { CvsService } from './cvs.service';
import { CvsController } from './cvs.controller';
import { AiModule } from 'src/ai/ai.module';
import { MailModule } from 'src/mail/mail.module';

@Module({
  imports: [TypeOrmModule.forFeature([Cv, Job]), AiModule, MailModule],
  controllers: [CvsController],
  providers: [CvsService],
})
export class CvsModule {}
