const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { requireAuth } = require('../middleware/auth');
const { configured: cloudinaryConfigured, uploadBuffer } = require('../cloudinary');

const router = express.Router();

// Kept on disk only as a fallback for local dev without Cloudinary credentials configured —
// see cloudinary.js. Disk storage doesn't survive a redeploy on most hosts, which is exactly
// why the primary path below uploads to Cloudinary instead.
const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

router.post('/', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  if (cloudinaryConfigured) {
    try {
      const result = await uploadBuffer(req.file.buffer, req.file.originalname);
      return res.status(201).json({ fileUrl: result.secure_url, fileName: req.file.originalname });
    } catch (err) {
      console.error('[upload] Cloudinary upload failed', err);
      return res.status(502).json({ error: 'Upload failed' });
    }
  }

  const unique = crypto.randomBytes(16).toString('hex');
  const filename = `${unique}${path.extname(req.file.originalname)}`;
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.writeFileSync(path.join(uploadsDir, filename), req.file.buffer);
  res.status(201).json({ fileUrl: `/uploads/${filename}`, fileName: req.file.originalname });
});

module.exports = router;
