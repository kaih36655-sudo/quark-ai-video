import { mkdir, rename, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fetchProviderVideo } from "./provider-video-fetch";

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

async function runFfmpegExtract(inputPath: string, outputPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const cp = spawn(
      "ffmpeg",
      [
        "-y",
        "-ss",
        "00:00:00.15",
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
    tempInputPath = await downloadToTempFile(sourceVideoUrl);
    await runFfmpegExtract(tempInputPath, tempOutputPath);
    await rename(tempOutputPath, finalPath);
    const coverUrl = `/api/uploads/covers/${finalFilename}`;
    log("EXTRACT_SUCCESS", { videoId, kind, coverUrl, finalPath });
    return { coverUrl, finalPath };
  } finally {
    if (tempInputPath) await rm(tempInputPath, { force: true }).catch(() => {});
    await rm(tempOutputPath, { force: true }).catch(() => {});
  }
}

