import { mkdir, rename, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fetchProviderVideo } from "./provider-video-fetch";

const UPLOADS_DIR = "/www/wwwroot/quark-video-git/public/uploads";
const MEDIUM_VIDEO_REF_DIR = path.join(UPLOADS_DIR, "medium-video-refs");

type CommandCheckResult = {
  available: boolean;
  error?: string;
};

async function checkCommandAvailable(command: string, args: string[]): Promise<CommandCheckResult> {
  return new Promise((resolve) => {
    const cp = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    cp.stderr.on("data", (chunk) => {
      stderr += String(chunk || "");
    });
    cp.on("error", (error) => {
      resolve({ available: false, error: error.message });
    });
    cp.on("close", (code) => {
      if (code === 0) {
        resolve({ available: true });
        return;
      }
      resolve({ available: false, error: `${command} exit=${code}; stderr=${stderr.slice(0, 400)}` });
    });
  });
}

export async function checkMediumVideoFrameTools(): Promise<{
  ffmpegAvailable: boolean;
  ffprobeAvailable: boolean;
  error?: string;
}> {
  const [ffmpeg, ffprobe] = await Promise.all([
    checkCommandAvailable("ffmpeg", ["-version"]),
    checkCommandAvailable("ffprobe", ["-version"]),
  ]);
  const errors = [
    ffmpeg.available ? "" : `ffmpeg: ${ffmpeg.error || "not available"}`,
    ffprobe.available ? "" : `ffprobe: ${ffprobe.error || "not available"}`,
  ].filter(Boolean);
  return {
    ffmpegAvailable: ffmpeg.available,
    ffprobeAvailable: ffprobe.available,
    error: errors.length ? errors.join("; ") : undefined,
  };
}

async function downloadToTempFile(videoUrl: string): Promise<string> {
  const res = await fetchProviderVideo(videoUrl);
  if (!res.ok || !res.body) {
    throw new Error(`download source failed: status=${res.status}`);
  }

  const tempInputPath = path.join(tmpdir(), `medium-video-src-${Date.now()}-${randomUUID()}.mp4`);
  const writeStream = createWriteStream(tempInputPath);
  await pipeline(Readable.fromWeb(res.body as any), writeStream);
  return tempInputPath;
}

async function probeDurationSeconds(inputPath: string): Promise<number | null> {
  return new Promise((resolve) => {
    const cp = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", inputPath], {
      stdio: ["ignore", "pipe", "pipe"],
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
      const parsed = Number(stdout.trim());
      resolve(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
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

function getSeekAttempts(duration: number | null): number[] {
  const rawAttempts = duration
    ? [duration - 0.5, duration * 0.85, duration * 0.7]
    : [11.5, 10, 8, 5];
  const seen = new Set<string>();
  return rawAttempts
    .map((value) => Math.max(0.3, Number(value.toFixed(2))))
    .filter((value) => {
      const key = value.toFixed(2);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export async function extractMediumVideoReferenceFrame(params: {
  taskId: string;
  segmentIndex: number;
  sourceVideoUrl: string;
}) {
  await mkdir(MEDIUM_VIDEO_REF_DIR, { recursive: true });
  const fileName = `${params.taskId}-segment-${params.segmentIndex}-${Date.now()}-${randomUUID().slice(0, 8)}.jpg`;
  const finalPath = path.join(MEDIUM_VIDEO_REF_DIR, fileName);
  const tempOutputPath = path.join(tmpdir(), `${fileName}.${randomUUID()}.tmp.jpg`);
  let tempInputPath = "";

  try {
    tempInputPath = await downloadToTempFile(params.sourceVideoUrl);
    const duration = await probeDurationSeconds(tempInputPath);
    const seekAttempts = getSeekAttempts(duration);
    let lastError: unknown = null;
    let seekSeconds = seekAttempts[0] ?? 11.5;
    for (let attemptIndex = 0; attemptIndex < seekAttempts.length; attemptIndex += 1) {
      seekSeconds = seekAttempts[attemptIndex];
      console.log(
        "[MEDIUM_VIDEO][FRAME_EXTRACT_ATTEMPT]",
        JSON.stringify({
          taskId: params.taskId,
          segmentIndex: params.segmentIndex,
          timestamp: seekSeconds,
          attempt: attemptIndex + 1,
        })
      );
      try {
        await runFfmpegExtract(tempInputPath, tempOutputPath, seekSeconds);
        await rename(tempOutputPath, finalPath);
        return {
          referenceUrl: `/api/uploads/medium-video-refs/${fileName}`,
          finalPath,
          seekSeconds,
          duration,
        };
      } catch (error) {
        lastError = error;
        await rm(tempOutputPath, { force: true }).catch(() => {});
      }
    }
    if (lastError instanceof Error) throw lastError;
    throw new Error("ffmpeg extract failed");
  } finally {
    if (tempInputPath) await rm(tempInputPath, { force: true }).catch(() => {});
    await rm(tempOutputPath, { force: true }).catch(() => {});
  }
}
