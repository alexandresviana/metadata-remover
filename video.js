const { execFile } = require("child_process");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { promisify } = require("util");
const { extensionFromFile } = require("./media");

const execFileAsync = promisify(execFile);

const FAST_TIMEOUT_MS = Number(process.env.FFMPEG_FAST_TIMEOUT_MS || 5 * 60 * 1000);
const MAX_TIMEOUT_MS = Number(process.env.FFMPEG_MAX_TIMEOUT_MS || 15 * 60 * 1000);

const OUTPUT_MIME = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  webm: "video/webm",
  avi: "video/x-msvideo",
};

async function run(bin, args, timeoutMs) {
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
    });
    return { stdout: stdout?.toString() || "", stderr: stderr?.toString() || "" };
  } catch (err) {
    const msg = err.stderr?.toString() || err.message || `Falha ao executar ${bin}.`;
    throw new Error(msg.slice(0, 800));
  }
}

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mr-vid-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function flattenExiftoolRecord(record, section = "exiftool") {
  const entries = [];
  if (!record || typeof record !== "object") return entries;

  for (const [key, value] of Object.entries(record)) {
    if (key === "SourceFile") continue;
    if (value === null || value === undefined || value === "") continue;

    if (typeof value === "object" && !Array.isArray(value)) {
      for (const [subKey, subVal] of Object.entries(value)) {
        if (subVal === null || subVal === undefined || subVal === "") continue;
        entries.push({
          key: `${key}.${subKey}`,
          value: Array.isArray(subVal) ? subVal.join(", ") : String(subVal),
          section,
        });
      }
    } else if (Array.isArray(value)) {
      entries.push({ key, value: value.join(", "), section });
    } else {
      entries.push({ key, value: String(value), section });
    }
  }

  return entries;
}

async function probeVideo(filePath) {
  const { stdout } = await run(
    "ffprobe",
    [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      filePath,
    ],
    60_000
  );

  const data = JSON.parse(stdout);
  const videoStream = (data.streams || []).find((s) => s.codec_type === "video");
  const audioStream = (data.streams || []).find((s) => s.codec_type === "audio");
  const format = data.format || {};

  return {
    duration: format.duration ? Number(format.duration) : null,
    size: format.size ? Number(format.size) : null,
    formatName: format.format_name || format.format_long_name || null,
    bitRate: format.bit_rate ? Number(format.bit_rate) : null,
    width: videoStream?.width ?? null,
    height: videoStream?.height ?? null,
    videoCodec: videoStream?.codec_name ?? null,
    audioCodec: audioStream?.codec_name ?? null,
    tags: format.tags || {},
  };
}

async function readVideoMetadata(buffer, mimetype, originalname) {
  return withTempDir(async (dir) => {
    const ext = extensionFromFile(mimetype, originalname);
    const inputPath = path.join(dir, `input.${ext}`);
    await fs.writeFile(inputPath, buffer);

    const [exifOut, probe] = await Promise.all([
      run("exiftool", ["-json", "-n", inputPath], 120_000).catch(() => ({ stdout: "[]" })),
      probeVideo(inputPath),
    ]);

    let exifEntries = [];
    try {
      const parsed = JSON.parse(exifOut.stdout || "[]");
      if (Array.isArray(parsed) && parsed[0]) {
        exifEntries = flattenExiftoolRecord(parsed[0], "exiftool");
      }
    } catch {
      exifEntries = [];
    }

    const containerEntries = [];
    for (const [key, value] of Object.entries(probe.tags)) {
      if (value === null || value === undefined || value === "") continue;
      containerEntries.push({ key, value: String(value), section: "container" });
    }

    const entries = [...exifEntries, ...containerEntries];
    const sections = {};
    for (const entry of entries) {
      sections[entry.section] = (sections[entry.section] || 0) + 1;
    }

    const metadata = {
      exiftool: exifEntries.length ? Object.fromEntries(exifEntries.map((e) => [e.key, e.value])) : {},
      container: probe.tags,
    };

    return {
      entries,
      sections,
      metadata,
      probe,
    };
  });
}

function outputExtension(inputExt, mode) {
  if (mode === "max") return "mp4";
  return inputExt === "mov" ? "mov" : inputExt === "mkv" ? "mkv" : inputExt === "webm" ? "webm" : "mp4";
}

async function stripVideo(buffer, mimetype, originalname, mode) {
  if (mode !== "fast" && mode !== "max") {
    throw new Error('Modo inválido. Use "fast" ou "max".');
  }

  return withTempDir(async (dir) => {
    const inExt = extensionFromFile(mimetype, originalname);
    const outExt = outputExtension(inExt, mode);
    const inputPath = path.join(dir, `input.${inExt}`);
    const outputPath = path.join(dir, `output.${outExt}`);
    await fs.writeFile(inputPath, buffer);

    if (mode === "fast") {
      await run(
        "ffmpeg",
        [
          "-y",
          "-i",
          inputPath,
          "-map",
          "0",
          "-map_metadata",
          "-1",
          "-map_metadata:s:v",
          "-1",
          "-map_metadata:s:a",
          "-1",
          "-map_metadata:s:s",
          "-1",
          "-fflags",
          "+bitexact",
          "-flags:v",
          "+bitexact",
          "-flags:a",
          "+bitexact",
          "-c",
          "copy",
          outputPath,
        ],
        FAST_TIMEOUT_MS
      );
    } else {
      await run(
        "ffmpeg",
        [
          "-y",
          "-i",
          inputPath,
          "-map",
          "0:v:0?",
          "-map",
          "0:a?",
          "-map_metadata",
          "-1",
          "-fflags",
          "+bitexact",
          "-flags:v",
          "+bitexact",
          "-flags:a",
          "+bitexact",
          "-c:v",
          "libx264",
          "-preset",
          "fast",
          "-crf",
          "22",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-movflags",
          "+faststart",
          outputPath,
        ],
        MAX_TIMEOUT_MS
      );
    }

    const outBuffer = await fs.readFile(outputPath);
    const mime = OUTPUT_MIME[outExt] || "video/mp4";
    return { buffer: outBuffer, ext: outExt, mime, mode };
  });
}

function formatDuration(seconds) {
  if (!seconds || Number.isNaN(seconds)) return null;
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

module.exports = {
  readVideoMetadata,
  stripVideo,
  formatDuration,
  OUTPUT_MIME,
};
