import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { JobsService } from './jobs.service';
import { CreateJobDto } from './dto/create-job.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { IsIn } from 'class-validator';

class SetJobStatusDto {
  @IsIn(['ACTIVE', 'CLOSED'])
  status: 'ACTIVE' | 'CLOSED';
}

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Get()
  findAll() {
    return this.jobsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.jobsService.findOne(Number(id));
  }

  @Post()
  create(@Body() dto: CreateJobDto) {
    return this.jobsService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateJobDto) {
    return this.jobsService.update(Number(id), dto);
  }

  @Patch(':id/status')
  setStatus(@Param('id') id: string, @Body() dto: SetJobStatusDto) {
    return this.jobsService.setStatus(Number(id), dto.status);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.jobsService.remove(Number(id));
  }
}
