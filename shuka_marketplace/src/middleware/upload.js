const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { DATA_DIR } = require('../db');

const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIMES.has(file.mimetype)) {
      return cb(new Error('INVALID_FILE_TYPE'));
    }
    cb(null, true);
  }
});

async function processAndSaveImage(buffer) {
  // Verify actual image headers via sharp metadata (prevents renamed .exe files)
  const meta = await sharp(buffer).metadata();
  if (!['jpeg', 'png', 'webp'].includes(meta.format)) {
    throw new Error('INVALID_FILE_TYPE');
  }

  const baseName = `${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  const largeFile = `${baseName}_large.webp`;
  const thumbFile = `${baseName}_thumb.webp`;

  await sharp(buffer)
    .rotate()
    .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(path.join(UPLOADS_DIR, largeFile));

  await sharp(buffer)
    .rotate()
    .resize(320, 320, { fit: 'cover' })
    .webp({ quality: 75 })
    .toFile(path.join(UPLOADS_DIR, thumbFile));

  return `/uploads/${largeFile}`;
}

module.exports = { upload, processAndSaveImage, UPLOADS_DIR };
