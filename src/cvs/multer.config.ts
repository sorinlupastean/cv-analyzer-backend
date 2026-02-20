import { diskStorage } from 'multer';
import { extname, resolve } from 'path';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync } from 'fs';

function ensureUploadsDir() {
  const dir = resolve(process.cwd(), 'uploads', 'cvs');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export const cvMulterOptions = {
  storage: diskStorage({
    destination: (_req, _file, cb) => {
      const dir = ensureUploadsDir();
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const safeExt = extname(file.originalname || '').toLowerCase() || '';
      cb(null, `${randomUUID()}${safeExt}`);
    },
  }),
  limits: {
    fileSize: 15 * 1024 * 1024,
  },
};
