import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
} from '@nestjs/common';
import { InterviewsService } from './interviews.service';
import { CreateInterviewDto } from './dto/create-interview.dto';
import { UpdateInterviewDto } from './dto/update-interview.dto';

@Controller('interviews')
export class InterviewsController {
  constructor(private readonly service: InterviewsService) {}

  // Listare pentru calendar (interval)
  @Get()
  list(@Query('from') from: string, @Query('to') to: string) {
    return this.service.list(from, to);
  }

  @Post()
  create(@Body() dto: CreateInterviewDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateInterviewDto) {
    return this.service.update(Number(id), dto);
  }

  // Anulare “admin” (tu)
  @Post(':id/cancel')
  cancel(@Param('id') id: string, @Body() body: { reason?: string }) {
    return this.service.cancel(Number(id), body?.reason);
  }

  // Confirmare “candidate” via email link
  @Post('confirm')
  confirm(@Body() body: { token: string }) {
    return this.service.confirmByToken(body.token);
  }

  // Anulare “candidate” via email link (optional)
  @Post('cancel')
  cancelByToken(@Body() body: { token: string }) {
    return this.service.cancelByToken(body.token);
  }
}
