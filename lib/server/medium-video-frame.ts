import { mkdir, rename, rm, writeFile } from "node:fs/promises";
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
const MEDIUM_VIDEO_MERGED_DIR = path.join(UPLOADS_DIR, "medium-video-merged");

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

export async function concatMediumVideoSegments(params: { taskId: string; segmentUrls: string[]; targetDurationSeconds?: number }) {
  if (params.segmentUrls.length < 2) {
    throw new Error("拼接至少需要 2 个视频片段");
  }
  await mkdir(MEDIUM_VIDEO_MERGED_DIR, { recursive: true });
  const tempDir = path.join(tmpdir(), `medium-video-concat-${params.taskId}-${Date.now()}-${randomUUID()}`);
  await mkdir(tempDir, { recursive: true });
  const outputName = `${params.taskId}-${Date.now()}-${randomUUID().slice(0, 8)}.mp4`;
  const concatOutputPath = path.join(tmpdir(), `${outputName}.${randomUUID()}.concat.tmp.mp4`);
  const normalizedOutputPath = path.join(tmpdir(), `${outputName}.${randomUUID()}.normalized.tmp.mp4`);
  const finalPath = path.join(MEDIUM_VIDEO_MERGED_DIR, outputName);
  let normalized = false;
  try {
    const localSegments: string[] = [];
    for (let index = 0; index < params.segmentUrls.length; index += 1) {
      const downloaded = await downloadToTempFile(params.segmentUrls[index]);
      const localPath = path.join(tempDir, `segment-${index + 1}.mp4`);
      await rename(downloaded, localPath);
      localSegments.push(localPath);
    }
    const listPath = path.join(tempDir, "concat.txt");
    await writeFile(listPath, localSegments.map((item) => `file '${item.replace(/'/g, "'\\''")}'`).join("\n"), "utf-8");
    await new Promise<void>((resolve, reject) => {
      const cp = spawn("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", concatOutputPath], { stdio: ["ignore", "ignore", "pipe"] });
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
        reject(new Error(`ffmpeg concat exit=${code}; stderr=${stderr.slice(0, 800)}`));
      });
    });
    const targetDurationSeconds = params.targetDurationSeconds;
    if (targetDurationSeconds && targetDurationSeconds > 0) {
      const trimStartSeconds = 0.2;
      console.log("[GROK_VIDEO][STITCH_NORMALIZE_START]", JSON.stringify({
        targetDurationSeconds,
        trimStartSeconds,
        inputFilesCount: localSegments.length,
      }));
      try {
        await new Promise<void>((resolve, reject) => {
          const cp = spawn(
            "ffmpeg",
            [
              "-y",
              "-ss",
              trimStartSeconds.toFixed(2),
              "-i",
              concatOutputPath,
              "-t",
              targetDurationSeconds.toFixed(2),
              "-c:v",
              "libx264",
              "-preset",
              "veryfast",
              "-pix_fmt",
              "yuv420p",
              "-c:a",
              "aac",
              "-movflags",
              "+faststart",
              normalizedOutputPath,
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
            reject(new Error(`ffmpeg normalize exit=${code}; stderr=${stderr.slice(0, 800)}`));
          });
        });
        await rename(normalizedOutputPath, finalPath);
        normalized = true;
        const outputDuration = await probeDurationSeconds(finalPath);
        console.log("[GROK_VIDEO][STITCH_NORMALIZE_SUCCESS]", JSON.stringify({
          outputPath: finalPath,
          publicUrl: `/api/uploads/medium-video-merged/${outputName}`,
          outputDuration,
        }));
      } catch (error) {
        console.log("[GROK_VIDEO][STITCH_NORMALIZE_FAILED]", JSON.stringify({ reason: error instanceof Error ? error.message : String(error) }));
        await rename(concatOutputPath, finalPath);
      }
    } else {
      await rename(concatOutputPath, finalPath);
    }
    return {
      mergedVideoUrl: `/api/uploads/medium-video-merged/${outputName}`,
      finalPath,
      normalized,
    };
  } finally {
    await rm(concatOutputPath, { force: true }).catch(() => {});
    await rm(normalizedOutputPath, { force: true }).catch(() => {});
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
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
        "-i",
        inputPath,
        "-ss",
        seekSeconds.toFixed(2),
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

async function detectBlackFrame(inputPath: string, seekSeconds: number): Promise<number | null> {
  return new Promise((resolve) => {
    const cp = spawn(
      "ffmpeg",
      ["-i", inputPath, "-ss", seekSeconds.toFixed(2), "-frames:v", "1", "-vf", "blackframe=amount=98:threshold=32", "-f", "null", "-"],
      { stdio: ["ignore", "ignore", "pipe"] }
    );
    let stderr = "";
    cp.stderr.on("data", (chunk) => {
      stderr += String(chunk || "");
    });
    cp.on("error", () => resolve(null));
    cp.on("close", () => {
      const match = /pblack:([\d.]+)/.exec(stderr);
      resolve(match ? Number(match[1]) : null);
    });
  });
}

type TailSeekAttempt = {
  timestamp: number;
  reason: "near_tail" | "scan_back_after_black_outro" | "unknown_duration_scan";
};

function uniqueTailAttempts(attempts: TailSeekAttempt[], duration: number | null): TailSeekAttempt[] {
  const seen = new Set<string>();
  return attempts
    .map((item) => {
      const upperBound = duration && duration > 0 ? Math.max(0.1, duration - 0.05) : item.timestamp;
      const timestamp = Math.min(upperBound, Math.max(0.1, Number(item.timestamp.toFixed(2))));
      return { ...item, timestamp: Number(timestamp.toFixed(2)) };
    })
    .filter((value) => {
      const key = value.timestamp.toFixed(2);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function getTailReferenceSeekAttempts(duration: number | null): TailSeekAttempt[] {
  if (duration && duration > 0) {
    const nearTailOffsets = [0.1, 0.2, 0.3, 0.5, 0.8, 1.0];
    const blackOutroScanOffsets = [1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 6.0];
    return uniqueTailAttempts([
      ...nearTailOffsets.map((offset) => ({ timestamp: duration - offset, reason: "near_tail" as const })),
      ...blackOutroScanOffsets.map((offset) => ({ timestamp: duration - offset, reason: "scan_back_after_black_outro" as const })),
      ...[duration * 0.75, duration * 0.6, duration * 0.5].map((timestamp) => ({ timestamp, reason: "scan_back_after_black_outro" as const })),
    ], duration);
  }
  return uniqueTailAttempts(
    [9.9, 9.8, 9.7, 9.5, 9.2, 9.0, 8.5, 8.0, 7.0, 6.0, 5.0, 4.0, 3.0].map((timestamp) => ({
      timestamp,
      reason: "unknown_duration_scan" as const,
    })),
    null
  );
}

export async function extractTailReferenceFrameForContinuation(params: {
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
    const seekAttempts = getTailReferenceSeekAttempts(duration);
    console.log(
      "[MEDIUM_VIDEO][TAIL_FRAME_EXTRACT_START]",
      JSON.stringify({
        taskId: params.taskId,
        segmentIndex: params.segmentIndex,
        sourceVideoUrlPreview: params.sourceVideoUrl.slice(0, 140),
        duration,
      })
    );
    let lastError: unknown = null;
    let lastSkippedBlack: { timestamp: number; pblack: number } | null = null;
    let seekSeconds = seekAttempts[0]?.timestamp ?? 9.9;
    for (let attemptIndex = 0; attemptIndex < seekAttempts.length; attemptIndex += 1) {
      const attempt = seekAttempts[attemptIndex];
      seekSeconds = attempt.timestamp;
      console.log(
        "[MEDIUM_VIDEO][TAIL_FRAME_EXTRACT_ATTEMPT]",
        JSON.stringify({
          taskId: params.taskId,
          segmentIndex: params.segmentIndex,
          timestamp: seekSeconds,
          duration,
          attempt: attemptIndex + 1,
          reason: attempt.reason,
        })
      );
      try {
        const pblack = await detectBlackFrame(tempInputPath, seekSeconds);
        if (pblack !== null && pblack >= 98) {
          lastSkippedBlack = { timestamp: seekSeconds, pblack };
          console.log(
            "[MEDIUM_VIDEO][TAIL_FRAME_BLACK_SKIPPED]",
            JSON.stringify({
              taskId: params.taskId,
              segmentIndex: params.segmentIndex,
              timestamp: seekSeconds,
              blackScore: pblack,
              meanBrightness: Math.max(0, 100 - pblack),
            })
          );
          continue;
        }
        await runFfmpegExtract(tempInputPath, tempOutputPath, seekSeconds);
        await rename(tempOutputPath, finalPath);
        const outputUrl = `/api/uploads/medium-video-refs/${fileName}`;
        console.log(
          "[MEDIUM_VIDEO][TAIL_FRAME_EXTRACT_SUCCESS]",
          JSON.stringify({
            taskId: params.taskId,
            segmentIndex: params.segmentIndex,
            timestamp: seekSeconds,
            outputUrl,
            offsetFromEnd: duration ? Number(Math.max(0, duration - seekSeconds).toFixed(2)) : null,
          })
        );
        return {
          referenceUrl: outputUrl,
          finalPath,
          seekSeconds,
          duration,
        };
      } catch (error) {
        lastError = error;
        await rm(tempOutputPath, { force: true }).catch(() => {});
      }
    }
    const reason = lastError instanceof Error
      ? lastError.message
      : lastSkippedBlack
        ? `尾部候选帧均为黑帧，最后黑帧 timestamp=${lastSkippedBlack.timestamp}, blackScore=${lastSkippedBlack.pblack}`
        : "ffmpeg extract failed";
    console.log(
      "[MEDIUM_VIDEO][TAIL_FRAME_EXTRACT_FAILED]",
      JSON.stringify({
        taskId: params.taskId,
        segmentIndex: params.segmentIndex,
        reason,
      })
    );
    throw new Error(`尾帧抽取失败，无法为下一段生成参考图：${reason}`);
  } finally {
    if (tempInputPath) await rm(tempInputPath, { force: true }).catch(() => {});
    await rm(tempOutputPath, { force: true }).catch(() => {});
  }
}

export async function extractMediumVideoReferenceFrame(params: {
  taskId: string;
  segmentIndex: number;
  sourceVideoUrl: string;
}) {
  return extractTailReferenceFrameForContinuation(params);
}
