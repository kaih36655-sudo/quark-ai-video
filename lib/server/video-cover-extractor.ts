import { mkdir, rename, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fetchProviderVideo } from "./provider-video-fetch";
import { resolveLocalUploadsSource } from "./local-uploads";

const COVER_DIR = "/www/wwwroot/quark-video-git/public/uploads/covers";

const log = (stage: string, payload: Record<string, unknown>) => {
  console.log(`[VIDEO_COVER][${stage}]`, JSON.stringify(payload));
};

async function downloadToTempFile(videoUrl: string): Promise<string> {
  const res = await fetchProviderVideo(videoUrl);
  if (!res.ok || !res.body) {
    throw new Error(`download source failed: status=${res.status}`);
  }

  const tempInputPath = path.join(tmpdir(), `video-cover-src-${Date.now()}-${randomUUID()}.mp4`);
  const writeStream = createWriteStream(tempInputPath);
  await pipeline(Readable.fromWeb(res.body as any), writeStream);
  return tempInputPath;
}

async function probeDurationSeconds(inputPath: string): Promise<number | null> {
  return new Promise((resolve) => {
    const cp = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", inputPath], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let stdout = "";
    cp.stdout.on("data", (chunk) => {
      stdout += String(chunk || "");
    });
    cp.on("error", () => resolve(null));
    cp.on("close", (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }
      const duration = Number(stdout.trim());
      resolve(Number.isFinite(duration) && duration > 0 ? duration : null);
    });
  });
}

async function detectBlackFrame(inputPath: string, seekSeconds: number): Promise<number | null> {
  return new Promise((resolve) => {
    const cp = spawn(
      "ffmpeg",
      ["-ss", seekSeconds.toFixed(2), "-i", inputPath, "-frames:v", "1", "-vf", "blackframe=amount=98:threshold=32", "-f", "null", "-"],
      { stdio: ["ignore", "ignore", "pipe"] }
    );
    let stderr = "";
    cp.stderr.on("data", (chunk) => {
      stderr += String(chunk || "");
    });
    cp.on("error", () => resolve(null));
    cp.on("close", () => {
      const match = /pblack:(\d+)/.exec(stderr);
      resolve(match ? Number(match[1]) : null);
    });
  });
}

async function runFfmpegExtract(inputPath: string, outputPath: string, seekSeconds: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const cp = spawn(
      "ffmpeg",
      [
        "-y",
        "-ss",
        seekSeconds.toFixed(2),
        "-i",
        inputPath,
        "-frames:v",
        "1",
        "-q:v",
        "2",
        outputPath,
      ],
      { stdio: ["ignore", "ignore", "pipe"] }
    );

    let stderr = "";
    cp.stderr.on("data", (chunk) => {
      stderr += String(chunk || "");
    });

    cp.on("error", reject);
    cp.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`ffmpeg exit=${code}; stderr=${stderr.slice(0, 800)}`));
    });
  });
}

function getSmartCoverAttempts(duration: number | null) {
  const attempts = [1, 1.5, 2];
  if (duration && duration > 0) {
    attempts.push(duration * 0.15, duration * 0.25);
  }
  attempts.push(0.15);
  const seen = new Set<string>();
  return attempts
    .map((value) => Math.max(0.1, Number(value.toFixed(2))))
    .filter((value) => {
      const key = value.toFixed(2);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export async function extractCoverAt015FromVideoUrl(params: {
  videoId: string;
  sourceVideoUrl: string;
  kind: "original" | "upscaled";
}) {
  const { videoId, sourceVideoUrl, kind } = params;
  await mkdir(COVER_DIR, { recursive: true });

  const finalFilename = `${videoId}-${kind}-cover.jpg`;
  const finalPath = path.join(COVER_DIR, finalFilename);
  const tempOutputPath = path.join(tmpdir(), `${finalFilename}.${randomUUID()}.tmp.jpg`);
  let tempInputPath = "";

  log("EXTRACT_START", {
    videoId,
    kind,
    sourceVideoUrlPreview: sourceVideoUrl.slice(0, 140),
    finalPath,
  });

  try {
    const localSource = await resolveLocalUploadsSource(sourceVideoUrl);
    log("LOCAL_SOURCE", {
      videoId,
      kind,
      sourceVideoUrlPreview: sourceVideoUrl.slice(0, 140),
      resolvedPath: localSource?.resolvedPath || "",
      exists: Boolean(localSource?.exists),
    });
    const inputPath = await (async () => {
      if (!localSource) {
        tempInputPath = await downloadToTempFile(sourceVideoUrl);
        return tempInputPath;
      }
      if (!localSource.exists) {
        throw new Error("本地视频文件不存在，无法抽取封面");
      }
      return localSource.resolvedPath;
    })();

    const duration = await probeDurationSeconds(inputPath);
    const attempts = getSmartCoverAttempts(duration);
    let lastError: unknown = null;
    for (let index = 0; index < attempts.length; index += 1) {
      const timestamp = attempts[index];
      log("SMART_EXTRACT_ATTEMPT", { videoId, source: kind, timestamp, attempt: index + 1 });
      try {
        const pblack = await detectBlackFrame(inputPath, timestamp);
        if (pblack !== null && pblack >= 98 && index < attempts.length - 1) {
          log("BLACK_FRAME_SKIPPED", { videoId, timestamp, meanBrightness: Math.max(0, 100 - pblack) });
          continue;
        }
        await runFfmpegExtract(inputPath, tempOutputPath, timestamp);
        await rename(tempOutputPath, finalPath);
        const coverUrl = `/api/uploads/covers/${finalFilename}`;
        log("SMART_EXTRACT_SUCCESS", { videoId, coverUrl, timestamp });
        log("EXTRACT_SUCCESS", { videoId, kind, coverUrl, finalPath });
        return { coverUrl, finalPath };
      } catch (error) {
        lastError = error;
        await rm(tempOutputPath, { force: true }).catch(() => {});
      }
    }
    const reason = lastError instanceof Error ? lastError.message : "智能抽帧失败";
    log("SMART_EXTRACT_FAILED", { videoId, reason });
    throw new Error(reason);
  } finally {
    if (tempInputPath) await rm(tempInputPath, { force: true }).catch(() => {});
    await rm(tempOutputPath, { force: true }).catch(() => {});
  }
}

export async function saveCoverFromImageUrl(params: {
  videoId: string;
  sourceImageUrl: string;
  kind: "original" | "upscaled";
}) {
  const { videoId, sourceImageUrl, kind } = params;
  await mkdir(COVER_DIR, { recursive: true });
  const finalFilename = `${videoId}-${kind}-provider-cover.jpg`;
  const finalPath = path.join(COVER_DIR, finalFilename);
  const tempPath = path.join(tmpdir(), `${finalFilename}.${randomUUID()}.tmp.jpg`);
  log("PROVIDER_COVER_DOWNLOAD_START", {
    videoId,
    kind,
    sourceImageUrlPreview: sourceImageUrl.slice(0, 140),
  });
  try {
    const res = await fetchProviderVideo(sourceImageUrl);
    if (!res.ok || !res.body) {
      throw new Error(`download provider cover failed: status=${res.status}`);
    }
    await pipeline(Readable.fromWeb(res.body as any), createWriteStream(tempPath));
    await rename(tempPath, finalPath);
    const coverUrl = `/api/uploads/covers/${finalFilename}`;
    log("PROVIDER_COVER_DOWNLOAD_SUCCESS", { videoId, kind, coverUrl, finalPath });
    return { coverUrl, finalPath };
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    log("PROVIDER_COVER_DOWNLOAD_FAILED", {
      videoId,
      kind,
      reason: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
