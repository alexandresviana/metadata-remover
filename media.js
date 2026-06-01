const path = require("path");

const IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/tiff",
  "image/avif",
  "image/heic",
  "image/heif",
]);

const VIDEO_MIMES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/x-matroska",
  "video/webm",
  "video/x-msvideo",
  "video/3gpp",
  "video/mpeg",
]);

const EXT_BY_MIME = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/tiff": "tiff",
  "image/avif": "avif",
  "image/heic": "heic",
  "image/heif": "heif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/x-matroska": "mkv",
  "video/webm": "webm",
  "video/x-msvideo": "avi",
  "video/3gpp": "3gp",
  "video/mpeg": "mpeg",
};

const MAX_IMAGE_BYTES = Number(process.env.MAX_IMAGE_MB || 25) * 1024 * 1024;
const MAX_VIDEO_BYTES = Number(process.env.MAX_VIDEO_MB || 200) * 1024 * 1024;

function isImageMime(mimetype) {
  return IMAGE_MIMES.has(mimetype);
}

function isVideoMime(mimetype) {
  return VIDEO_MIMES.has(mimetype);
}

function getMediaKind(mimetype) {
  if (isImageMime(mimetype)) return "image";
  if (isVideoMime(mimetype)) return "video";
  return null;
}

function extensionFromFile(mimetype, originalname) {
  const fromMime = EXT_BY_MIME[mimetype];
  if (fromMime) return fromMime;
  const ext = path.extname(originalname || "").slice(1).toLowerCase();
  return ext || "bin";
}

function maxBytesForKind(kind) {
  return kind === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
}

function validateUpload(file) {
  const kind = getMediaKind(file.mimetype);
  if (!kind) {
    return {
      ok: false,
      error:
        "Formato não suportado. Imagens: JPEG, PNG, WebP, GIF, TIFF, AVIF, HEIC. Vídeos: MP4, MOV, MKV, WebM, AVI.",
    };
  }

  const limit = maxBytesForKind(kind);
  if (file.size > limit) {
    const mb = Math.round(limit / (1024 * 1024));
    const label = kind === "video" ? "vídeo" : "imagem";
    return { ok: false, error: `Arquivo muito grande (máximo ${mb} MB para ${label}).` };
  }

  return { ok: true, kind };
}

module.exports = {
  IMAGE_MIMES,
  VIDEO_MIMES,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  isImageMime,
  isVideoMime,
  getMediaKind,
  extensionFromFile,
  maxBytesForKind,
  validateUpload,
};
