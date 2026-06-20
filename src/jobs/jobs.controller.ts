import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JobsService } from './jobs.service';
import { CreateJobDto } from './dto/create-job.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { IsIn } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

class SetJobStatusDto {
  @IsIn(['ACTIVE', 'CLOSED'])
  status: 'ACTIVE' | 'CLOSED';
}

@Controller('jobs')
@UseGuards(JwtAuthGuard)
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Get()
  findAll(@Req() req: any) {
    return this.jobsService.findAll(req.user.id);
  }

  @Get(':id')
  findOne(@Req() req: any, @Param('id') id: string) {
    return this.jobsService.findOne(Number(id), req.user.id);
  }

  @Get(':id/recruiter-copilot')
  getRecruiterCopilot(@Req() req: any, @Param('id') id: string) {
    return this.jobsService.getRecruiterCopilotReport(Number(id), req.user.id);
  }

  @Post()
  create(@Req() req: any, @Body() dto: CreateJobDto) {
    return this.jobsService.create(req.user.id, dto);
  }

  @Patch(':id')
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateJobDto) {
    return this.jobsService.update(Number(id), req.user.id, dto);
  }

  @Patch(':id/status')
  setStatus(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: SetJobStatusDto,
  ) {
    return this.jobsService.setStatus(Number(id), req.user.id, dto.status);
  }

  @Delete(':id')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.jobsService.remove(Number(id), req.user.id);
  }
}
