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
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { existsSync, mkdirSync } from 'fs';
import { extname, resolve } from 'path';
import type { Response } from 'express';

import { CvsService } from './cvs.service';
import { SendEmailDto } from './dto/send-email.dto';

function ensureUploadsDir(): string {
  const dir = resolve(process.cwd(), 'uploads', 'cvs');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

@Controller()
export class CvsController {
  constructor(private readonly cvsService: CvsService) {}

  @Get('jobs/:jobId/cvs')
  listForJob(@Param('jobId', ParseIntPipe) jobId: number) {
    return this.cvsService.listForJob(jobId);
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
    @Param('jobId', ParseIntPipe) jobId: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Fișier lipsă');
    }

    file.path = resolve(file.path).replace(/\\/g, '/');

    return this.cvsService.uploadForJob(jobId, file);
  }

  @Get('cvs/:cvId')
  findOne(@Param('cvId', ParseIntPipe) cvId: number) {
    return this.cvsService.findOne(cvId);
  }

  @Post('jobs/:jobId/cvs/:cvId/analyze')
  analyzeForJob(
    @Param('jobId', ParseIntPipe) jobId: number,
    @Param('cvId', ParseIntPipe) cvId: number,
  ) {
    return this.cvsService.analyzeCv(jobId, cvId);
  }

  @Post('cvs/:cvId/analyze')
  async analyzeLegacy(@Param('cvId', ParseIntPipe) cvId: number) {
    const cv = await this.cvsService.findOne(cvId);
    const jobId = cv?.job?.id;

    if (!jobId) {
      throw new BadRequestException(
        'CV-ul nu are job asociat sau nu a fost încărcat corect.',
      );
    }

    return this.cvsService.analyzeCv(jobId, cvId);
  }

  @Get('cvs/:cvId/download')
  async download(
    @Param('cvId', ParseIntPipe) cvId: number,
    @Res() res: Response,
  ) {
    const { filePath, fileName, mimeType } =
      await this.cvsService.getFileInfo(cvId);

    res.setHeader('Content-Type', mimeType || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(fileName || 'cv')}"`,
    );

    return res.sendFile(filePath);
  }

  @Post('cvs/:cvId/send-email')
  sendEmail(
    @Param('cvId', ParseIntPipe) cvId: number,
    @Body() dto: SendEmailDto,
  ) {
    return this.cvsService.sendEmail(cvId, dto);
  }

  @Get('picker')
  picker(@Query('q') q = '', @Query('limit') limit = '20') {
    return this.cvsService.picker(q, Number(limit) || 20);
  }

  @Delete('cvs/:cvId')
  remove(@Param('cvId', ParseIntPipe) cvId: number) {
    return this.cvsService.remove(cvId);
  }
}
