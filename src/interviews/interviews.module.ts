import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InterviewEvent } from './entities/interview-event.entity';
import { InterviewsController } from './interviews.controller';
import { InterviewsService } from './interviews.service';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [TypeOrmModule.forFeature([InterviewEvent]), MailModule],
  controllers: [InterviewsController],
  providers: [InterviewsService],
})
export class InterviewsModule {}
