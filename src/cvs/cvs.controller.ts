import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
  Body,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, resolve } from 'path';
import { existsSync, mkdirSync } from 'fs';
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

  // ✅ upload fișier pentru un job selectat
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
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
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
    if (!file) throw new BadRequestException('Fișier lipsă');

    // normalizează absolut, ca să nu ai mismatch în prod/dist/docker
    file.path = resolve(file.path).replace(/\\/g, '/');

    return this.cvsService.uploadForJob(jobId, file);
  }

  @Get('cvs/:cvId')
  findOne(@Param('cvId', ParseIntPipe) cvId: number) {
    return this.cvsService.findOne(cvId);
  }

  // ✅ ruta NOUĂ (recomandată)
  @Post('jobs/:jobId/cvs/:cvId/analyze')
  analyzeForJob(
    @Param('jobId', ParseIntPipe) jobId: number,
    @Param('cvId', ParseIntPipe) cvId: number,
  ) {
    return this.cvsService.analyzeCv(jobId, cvId);
  }

  // ✅ ruta VECHE (compatibilitate cu frontend-ul tău: POST /cvs/:cvId/analyze)
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

  @Delete('cvs/:cvId')
  remove(@Param('cvId', ParseIntPipe) cvId: number) {
    return this.cvsService.remove(cvId);
  }
}
