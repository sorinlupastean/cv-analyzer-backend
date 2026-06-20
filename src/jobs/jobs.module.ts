import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiModule } from '../ai/ai.module';
import { JobsController } from './jobs.controller';
import { RecruiterCopilotAgentService } from './recruiter-copilot-agent.service';
import { JobsService } from './jobs.service';
import { Job } from './entities/job.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Job]), AiModule],
  controllers: [JobsController],
  providers: [JobsService, RecruiterCopilotAgentService],
  exports: [JobsService],
})
export class JobsModule {}
