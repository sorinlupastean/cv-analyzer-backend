import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { existsSync, mkdirSync } from 'fs';
import { extname, resolve } from 'path';
import type { Response } from 'express';

import { CvsService } from './cvs.service';
import { SendEmailDto } from './dto/send-email.dto';
import { normalizeUploadedFilename } from '../common/text-normalization';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

function ensureUploadsDir(): string {
  const dir = resolve(process.cwd(), 'uploads', 'cvs');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

@Controller()
@UseGuards(JwtAuthGuard)
export class CvsController {
  constructor(private readonly cvsService: CvsService) {}

  @Get('jobs/:jobId/cvs')
  listForJob(@Req() req: any, @Param('jobId', ParseIntPipe) jobId: number) {
    return this.cvsService.listForJob(jobId, req.user.id);
  }

  @Post('jobs/:jobId/cvs/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const dir = ensureUploadsDir();
          cb(null, dir);
        },
        filename: (_req, file, cb) => {
          const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          const safeExt = (extname(file.originalname) || '').toLowerCase();
          cb(null, `${unique}${safeExt}`);
        },
      }),
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const allowed = [
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ];

        if (!allowed.includes(file.mimetype)) {
          return cb(
            new BadRequestException('Accept doar PDF, DOC, DOCX'),
            false,
          );
        }

        cb(null, true);
      },
    }),
  )
  uploadCv(
    @Req() req: any,
    @Param('jobId', ParseIntPipe) jobId: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Fișier lipsă');
    }

    file.path = resolve(file.path).replace(/\\/g, '/');
    file.originalname = normalizeUploadedFilename(file.originalname);

    return this.cvsService.uploadForJob(jobId, req.user.id, file);
  }

  @Get('cvs/:cvId')
  findOne(@Req() req: any, @Param('cvId', ParseIntPipe) cvId: number) {
    return this.cvsService.findOne(cvId, req.user.id);
  }

  @Post('jobs/:jobId/cvs/:cvId/analyze')
  analyzeForJob(
    @Req() req: any,
    @Param('jobId', ParseIntPipe) jobId: number,
    @Param('cvId', ParseIntPipe) cvId: number,
  ) {
    return this.cvsService.analyzeCv(jobId, cvId, req.user.id);
  }

  @Post('cvs/:cvId/analyze')
  async analyzeLegacy(@Req() req: any, @Param('cvId', ParseIntPipe) cvId: number) {
    const cv = await this.cvsService.findOne(cvId, req.user.id);
    const jobId = cv?.job?.id;

    if (!jobId) {
      throw new BadRequestException(
        'CV-ul nu are job asociat sau nu a fost încărcat corect.',
      );
    }

    return this.cvsService.analyzeCv(jobId, cvId, req.user.id);
  }

  @Get('cvs/:cvId/download')
  async download(
    @Req() req: any,
    @Param('cvId', ParseIntPipe) cvId: number,
    @Res() res: Response,
  ) {
    const { filePath, fileName, mimeType } =
      await this.cvsService.getFileInfo(cvId, req.user.id);

    res.setHeader('Content-Type', mimeType || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(fileName || 'cv')}"`,
    );

    return res.sendFile(filePath);
  }

  @Post('cvs/:cvId/send-email')
  sendEmail(
    @Req() req: any,
    @Param('cvId', ParseIntPipe) cvId: number,
    @Body() dto: SendEmailDto,
  ) {
    return this.cvsService.sendEmail(cvId, req.user.id, dto);
  }

  @Get('picker')
  picker(@Req() req: any, @Query('q') q = '', @Query('limit') limit = '20') {
    return this.cvsService.picker(q, Number(limit) || 20, req.user.id);
  }

  @Delete('cvs/:cvId')
  remove(@Req() req: any, @Param('cvId', ParseIntPipe) cvId: number) {
    return this.cvsService.remove(cvId, req.user.id);
  }
}
