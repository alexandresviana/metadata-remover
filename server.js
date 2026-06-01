const express = require("express");
const multer = require("multer");
const path = require("path");
const exifr = require("exifr");
const sharp = require("sharp");
const {
  createSession,
  setSessionCookie,
  clearSessionCookie,
  getSession,
  requireAuth,
  verifyPassword,
  isAuthConfigured,
} = require("./auth");
const {
  getMediaKind,
  extensionFromFile,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  validateUpload,
} = require("./media");
const { readVideoMetadata, stripVideo, formatDuration } = require("./video");

const PORT = Number(process.env.PORT) || 3000;
const MAX_UPLOAD_BYTES = Math.max(MAX_IMAGE_BYTES, MAX_VIDEO_BYTES);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    const check = validateUpload({ mimetype: file.mimetype, size: 0 });
    if (!check.ok) {
      cb(new Error(check.error));
      return;
    }
    cb(null, true);
  },
});

const app = express();
app.use(express.json({ limit: "16kb" }));

const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

function clientIp(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
}

function isLoginBlocked(ip) {
  const entry = loginAttempts.get(ip);
  if (!entry) return false;
  if (Date.now() > entry.until) {
    loginAttempts.delete(ip);
    return false;
  }
  return entry.count >= LOGIN_MAX_ATTEMPTS;
}

function recordLoginFailure(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip) || { count: 0, until: now + LOGIN_WINDOW_MS };
  entry.count += 1;
  entry.until = now + LOGIN_WINDOW_MS;
  loginAttempts.set(ip, entry);
}

app.use(express.static(path.join(__dirname, "public")));

function formatMetadataValue(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if (Array.isArray(value)) {
      return value.map(formatMetadataValue);
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const formatted = formatMetadataValue(v);
      if (formatted !== null && formatted !== undefined && formatted !== "") {
        out[k] = formatted;
      }
    }
    return Object.keys(out).length ? out : null;
  }
  if (typeof value === "number" && Number.isNaN(value)) return null;
  return value;
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  if (value instanceof Date) return false;
  if (ArrayBuffer.isView(value)) return false;
  if (value instanceof ArrayBuffer) return false;
  return Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null;
}

function valueToDisplayString(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    const bytes = new Uint8Array(value.buffer ?? value, value.byteOffset ?? 0, value.byteLength ?? value.byteLength);
    if (bytes.length <= 48) {
      return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(" ");
    }
    return `[dados binários, ${bytes.length} bytes]`;
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function flattenForDisplay(obj, prefix = "", section = "") {
  const lines = [];
  if (obj === null || obj === undefined) return lines;

  if (!isPlainObject(obj)) {
    if (prefix) lines.push({ key: prefix, value: valueToDisplayString(obj), section });
    return lines;
  }

  for (const [key, value] of Object.entries(obj)) {
    const label = prefix ? `${prefix}.${key}` : key;

    if (isPlainObject(value)) {
      const nested = flattenForDisplay(value, label, section);
      if (nested.length) {
        lines.push(...nested);
      } else {
        lines.push({ key: label, value: "{}", section });
      }
    } else if (Array.isArray(value)) {
      if (!value.length) {
        lines.push({ key: label, value: "[]", section });
      } else if (value.every((item) => item === null || typeof item !== "object")) {
        lines.push({ key: label, value: value.map(valueToDisplayString).join(", "), section });
      } else {
        value.forEach((item, index) => {
          lines.push(...flattenForDisplay(item, `${label}[${index}]`, section));
        });
      }
    } else {
      lines.push({ key: label, value: valueToDisplayString(value), section });
    }
  }

  return lines;
}

const SECTION_LABELS = {
  exif: "EXIF / TIFF",
  gps: "GPS",
  xmp: "XMP",
  iptc: "IPTC",
  icc: "Perfil ICC",
  jfif: "JFIF",
  ihdr: "PNG (IHDR)",
  exiftool: "ExifTool",
  container: "Container (ffprobe)",
  other: "Outros",
};

function sanitizeBaseName(originalname) {
  return (
    path
      .basename(originalname, path.extname(originalname))
      .replace(/[^\w.\-]+/g, "_") || "arquivo"
  );
}

function buildAnalyzeResponse({ info, entries, sections, metadata, hasMetadata }) {
  return {
    info,
    metadata,
    entries,
    sections,
    sectionLabels: SECTION_LABELS,
    totalCount: entries.length,
    hasMetadata,
  };
}

async function analyzeImage(file) {
  const metadata = await readAllMetadata(file.buffer);
  const sharpMeta = await sharp(file.buffer, { failOn: "none" }).metadata();

  const info = {
    kind: "image",
    filename: file.originalname,
    mimetype: file.mimetype,
    size: file.size,
    width: sharpMeta.width,
    height: sharpMeta.height,
    format: sharpMeta.format,
    hasAlpha: sharpMeta.hasAlpha,
    orientation: sharpMeta.orientation,
    duration: null,
    videoCodec: null,
    audioCodec: null,
  };

  const entries = buildMetadataEntries(metadata);
  const sections = {};
  for (const entry of entries) {
    const name = entry.section || "other";
    sections[name] = (sections[name] || 0) + 1;
  }

  return buildAnalyzeResponse({
    info,
    entries,
    sections,
    metadata,
    hasMetadata: entries.length > 0 || Boolean(sharpMeta.exif || sharpMeta.icc || sharpMeta.xmp),
  });
}

async function analyzeVideoFile(file) {
  const { entries, sections, metadata, probe } = await readVideoMetadata(
    file.buffer,
    file.mimetype,
    file.originalname
  );

  const info = {
    kind: "video",
    filename: file.originalname,
    mimetype: file.mimetype,
    size: file.size,
    width: probe.width,
    height: probe.height,
    format: probe.formatName,
    hasAlpha: null,
    orientation: null,
    duration: formatDuration(probe.duration),
    durationSeconds: probe.duration,
    videoCodec: probe.videoCodec,
    audioCodec: probe.audioCodec,
    bitRate: probe.bitRate,
  };

  return buildAnalyzeResponse({
    info,
    entries,
    sections,
    metadata,
    hasMetadata: entries.length > 0,
  });
}

async function readAllMetadata(buffer) {
  const segments = {};

  try {
    segments.exif = await exifr.parse(buffer, { tiff: true, ifd0: true, exif: true, mergeOutput: false });
  } catch {
    segments.exif = null;
  }

  try {
    segments.gps = await exifr.gps(buffer);
  } catch {
    segments.gps = null;
  }

  try {
    segments.xmp = await exifr.xmp(buffer);
  } catch {
    segments.xmp = null;
  }

  try {
    segments.iptc = await exifr.iptc(buffer);
  } catch {
    segments.iptc = null;
  }

  try {
    segments.icc = await exifr.icc(buffer);
  } catch {
    segments.icc = null;
  }

  const cleaned = {};
  for (const [name, data] of Object.entries(segments)) {
    const formatted = formatMetadataValue(data);
    if (formatted && (typeof formatted !== "object" || Object.keys(formatted).length > 0)) {
      cleaned[name] = formatted;
    }
  }

  return cleaned;
}

function buildMetadataEntries(metadata) {
  const flat = [];
  for (const [section, data] of Object.entries(metadata)) {
    flat.push(...flattenForDisplay(data, "", section));
  }
  return flat;
}

function outputFormat(mimetype) {
  switch (mimetype) {
    case "image/jpeg":
      return { format: "jpeg", ext: "jpg", options: { quality: 92, mozjpeg: true } };
    case "image/png":
      return { format: "png", ext: "png", options: { compressionLevel: 9 } };
    case "image/webp":
      return { format: "webp", ext: "webp", options: { quality: 92 } };
    case "image/gif":
      return { format: "gif", ext: "gif", options: {} };
    case "image/tiff":
      return { format: "tiff", ext: "tiff", options: {} };
    case "image/avif":
      return { format: "avif", ext: "avif", options: { quality: 80 } };
    case "image/heic":
    case "image/heif":
      return { format: "jpeg", ext: "jpg", options: { quality: 92, mozjpeg: true } };
    default:
      return { format: "jpeg", ext: "jpg", options: { quality: 92, mozjpeg: true } };
  }
}

async function stripImageMetadata(buffer, mimetype) {
  const { format, options } = outputFormat(mimetype);
  let pipeline = sharp(buffer, { failOn: "none" }).rotate();

  switch (format) {
    case "jpeg":
      pipeline = pipeline.jpeg(options);
      break;
    case "png":
      pipeline = pipeline.png(options);
      break;
    case "webp":
      pipeline = pipeline.webp(options);
      break;
    case "gif":
      pipeline = pipeline.gif(options);
      break;
    case "tiff":
      pipeline = pipeline.tiff(options);
      break;
    case "avif":
      pipeline = pipeline.avif(options);
      break;
    default:
      pipeline = pipeline.jpeg(options);
  }

  return pipeline.toBuffer();
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    auth: isAuthConfigured(),
    video: true,
    limits: {
      imageMb: Math.round(MAX_IMAGE_BYTES / (1024 * 1024)),
      videoMb: Math.round(MAX_VIDEO_BYTES / (1024 * 1024)),
    },
  });
});

app.get("/api/session", (req, res) => {
  if (!isAuthConfigured()) {
    return res.status(503).json({ error: "Servidor sem APP_PASSWORD configurado." });
  }
  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ authenticated: false });
  }
  res.json({ authenticated: true, csrfToken: session.csrf });
});

app.post("/api/login", (req, res) => {
  if (!isAuthConfigured()) {
    return res.status(503).json({ error: "Servidor sem APP_PASSWORD configurado." });
  }

  const ip = clientIp(req);
  if (isLoginBlocked(ip)) {
    return res.status(429).json({ error: "Muitas tentativas. Aguarde alguns minutos." });
  }

  const password = String(req.body?.password || "");
  if (!verifyPassword(password)) {
    recordLoginFailure(ip);
    return res.status(401).json({ error: "Senha incorreta." });
  }

  loginAttempts.delete(ip);
  const { token, csrf } = createSession();
  setSessionCookie(res, token);
  res.json({ ok: true, csrfToken: csrf });
});

app.post("/api/logout", requireAuth, (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

const apiRouter = express.Router();
apiRouter.use(requireAuth);

apiRouter.post("/analyze", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Nenhum arquivo enviado." });
    }

    const sizeCheck = validateUpload(req.file);
    if (!sizeCheck.ok) {
      return res.status(400).json({ error: sizeCheck.error });
    }

    const kind = getMediaKind(req.file.mimetype);
    const result =
      kind === "video" ? await analyzeVideoFile(req.file) : await analyzeImage(req.file);

    res.json(result);
  } catch (err) {
    console.error("analyze error:", err);
    res.status(500).json({ error: err.message || "Erro ao analisar o arquivo." });
  }
});

apiRouter.post("/strip", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Nenhum arquivo enviado." });
    }

    const sizeCheck = validateUpload(req.file);
    if (!sizeCheck.ok) {
      return res.status(400).json({ error: sizeCheck.error });
    }

    const kind = getMediaKind(req.file.mimetype);
    const baseName = sanitizeBaseName(req.file.originalname);
    const mode = String(req.body?.mode || "fast").toLowerCase();

    let cleanBuffer;
    let ext;
    let mime;

    if (kind === "video") {
      const result = await stripVideo(
        req.file.buffer,
        req.file.mimetype,
        req.file.originalname,
        mode
      );
      cleanBuffer = result.buffer;
      ext = result.ext;
      mime = result.mime;
    } else {
      cleanBuffer = await stripImageMetadata(req.file.buffer, req.file.mimetype);
      const format = outputFormat(req.file.mimetype);
      ext = format.ext;
      mime =
        ext === "jpg"
          ? "image/jpeg"
          : ext === "png"
            ? "image/png"
            : ext === "webp"
              ? "image/webp"
              : `image/${ext}`;
    }

    const suffix = kind === "video" ? (mode === "max" ? "_sem_metadados_max" : "_sem_metadados") : "_sem_metadados";

    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Disposition", `attachment; filename="${baseName}${suffix}.${ext}"`);
    res.send(cleanBuffer);
  } catch (err) {
    console.error("strip error:", err);
    res.status(500).json({ error: err.message || "Erro ao remover metadados." });
  }
});

app.use("/api", apiRouter);

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      const imageMb = Math.round(MAX_IMAGE_BYTES / (1024 * 1024));
      const videoMb = Math.round(MAX_VIDEO_BYTES / (1024 * 1024));
      return res
        .status(400)
        .json({ error: `Arquivo muito grande (máx. ${imageMb} MB imagem / ${videoMb} MB vídeo).` });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
  res.status(500).json({ error: "Erro interno." });
});

app.listen(PORT, () => {
  if (!isAuthConfigured()) {
    console.warn("AVISO: defina APP_PASSWORD e SESSION_SECRET para ativar autenticação.");
  }
  console.log(`Metadata Remover rodando em http://0.0.0.0:${PORT}`);
});
