import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import { InterviewsService } from './interviews.service';
import { CreateInterviewDto } from './dto/create-interview.dto';
import { UpdateInterviewDto } from './dto/update-interview.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('interviews')
export class InterviewsController {
  constructor(private readonly service: InterviewsService) {}

  // Listare pentru calendar (interval)
  @Get()
  @UseGuards(JwtAuthGuard)
  list(@Req() req: any, @Query('from') from: string, @Query('to') to: string) {
    return this.service.list(from, to, req.user);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@Req() req: any, @Body() dto: CreateInterviewDto) {
    return this.service.create(dto, req.user);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateInterviewDto) {
    return this.service.update(Number(id), dto, req.user);
  }

  // Anulare “admin” (tu)
  @Post(':id/cancel')
  @UseGuards(JwtAuthGuard)
  cancel(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.service.cancel(Number(id), body?.reason, req.user);
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
