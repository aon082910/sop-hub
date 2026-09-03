import multer from "multer";
import path from "node:path";
import { nanoid } from "nanoid";

const UPLOAD_DIR = process.env.UPLOAD_DIR || "/data/uploads";

export const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || ".png";
      cb(null, `${nanoid()}${ext}`);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
});

export function uploadDir(): string {
  return UPLOAD_DIR;
}
