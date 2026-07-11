const { v2: cloudinary } = require('cloudinary');

const configured = !!(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);

if (configured) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

// Uploads a buffer (from multer's memoryStorage) as a single request instead of the
// streaming upload_stream API — simpler to await, and our files are already capped at
// 10MB by multer so there's no real memory-pressure reason to stream them.
function uploadBuffer(buffer, originalName) {
  const dataUri = `data:application/octet-stream;base64,${buffer.toString('base64')}`;
  return cloudinary.uploader.upload(dataUri, {
    folder: 'messenger',
    resource_type: 'auto',
    filename_override: originalName,
    use_filename: false,
    unique_filename: true,
  });
}

module.exports = { cloudinary, configured, uploadBuffer };
