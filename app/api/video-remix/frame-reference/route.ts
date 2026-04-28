import { NextRequest, NextResponse } from "next/server";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { requireCurrentUser } from "@/lib/server/auth";
import { generateYunwuImage } from "@/lib/server/yunwu-image";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const IMAGE_RETRY_DELAYS_MS = [2000, 5000];

const mimeByExt: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
};

const log = (stage: string, payload: Record<string, unknown>) => {
  console.log(`[VIDEO_REMIX][${stage}]`, JSON.stringify(payload));
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const pickText = (value: FormDataEntryValue | null) => (typeof value === "string" ? value.trim() : "");

const parseTargetSeconds = (value: FormDataEntryValue | null): 4 | 8 | 12 | null => {
  const num = Number(value);
  return num === 4 || num === 8 || num === 12 ? num : null;
};

const normalizeRatio = (value: FormDataEntryValue | null) => {
  return value === "9:16" ? "9:16" : "16:9";
};

const resolveMimeType = (file: File) => {
  const ext = path.extname(file.name).toLowerCase();
  const mimeFromExt = mimeByExt[ext];
  if (!mimeFromExt) return null;
  if (file.type && !["video/mp4", "video/quicktime", "video/webm", "video/x-m4v"].includes(file.type)) {
    return null;
  }
  return mimeFromExt;
};

const shouldRetryImageError = (message: string) => {
  const lower = message.toLowerCase();
  if (lower.includes("status=400") || lower.includes("status=401") || lower.includes("status=403") || lower.includes("status=404")) return false;
  return (
    lower.includes("429") ||
    lower.includes("status=5") ||
    lower.includes("fetch failed") ||
    lower.includes("network") ||
    lower.includes("timeout") ||
    lower.includes("no_image") ||
    lower.includes("未返回图片")
  );
};

async function probeDuration(filePath: string) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  const duration = Number(stdout.trim());
  return Number.isFinite(duration) ? duration : null;
}

async function extractFrame(videoPath: string, outputPath: string, timestamp: number) {
  await execFileAsync("ffmpeg", [
    "-y",
    "-ss",
    String(Math.max(0, timestamp)),
    "-i",
    videoPath,
    "-frames:v",
    "1",
    "-q:v",
    "2",
    outputPath,
  ]);
}

async function extractFrameWithRetry(params: { videoPath: string; outputPath: string; duration: number | null; fileName: string }) {
  const firstTimestamp = params.duration !== null && params.duration < 2.5 ? Math.max(0.1, params.duration * 0.4) : 2.2;
  const timestamps = [firstTimestamp, params.duration !== null ? Math.max(0.1, params.duration * 0.5) : 1];
  let lastReason = "抽帧失败";
  for (let attempt = 1; attempt <= timestamps.length; attempt += 1) {
    const timestamp = timestamps[attempt - 1];
    log("FRAME_EXTRACT_REQUEST", {
      attempt,
      maxAttempts: timestamps.length,
      fileName: params.fileName,
      duration: params.duration,
      timestamp,
    });
    try {
      await extractFrame(params.videoPath, params.outputPath, timestamp);
      log("FRAME_EXTRACT_SUCCESS", {
        attempt,
        duration: params.duration,
        timestamp,
      });
      return { timestamp };
    } catch (error) {
      lastReason = error instanceof Error ? error.message : String(error);
      log("FRAME_EXTRACT_FAILED", {
        attempt,
        maxAttempts: timestamps.length,
        timestamp,
        reason: lastReason,
      });
    }
  }
  throw new Error(lastReason);
}

async function generateReferenceImageWithRetry(params: { frameDataUrl: string; ratio: string; prompt: string }) {
  let lastReason = "参考图生成失败";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      log("REFERENCE_IMAGE_REQUEST", {
        attempt,
        maxAttempts: 3,
        ratio: params.ratio,
        imageSize: "2K",
        imageModel: "banana2",
        hasFrameBase64: true,
        frameBase64PreviewLength: 80,
        promptPreview: params.prompt.slice(0, 160),
      });
      const result = await generateYunwuImage({
        prompt: params.prompt,
        referenceImageUrl: params.frameDataUrl,
        ratio: params.ratio,
        imageSize: "2K",
        imageModel: "banana2",
        maxAttempts: 1,
        logParsedJson: false,
      });
      log("REFERENCE_IMAGE_SUCCESS", {
        attempt,
        imageUrl: result.imageUrl,
        model: result.apiModel,
      });
      return result.imageUrl;
    } catch (error) {
      lastReason = error instanceof Error ? error.message : String(error);
      const retryable = shouldRetryImageError(lastReason);
      if (retryable && attempt < 3) {
        const delayMs = IMAGE_RETRY_DELAYS_MS[attempt - 1] ?? 0;
        log("REFERENCE_IMAGE_RETRY", {
          attempt,
          maxAttempts: 3,
          delayMs,
          reason: lastReason,
          retryable: true,
        });
        if (delayMs > 0) {
          await delay(delayMs);
        }
        continue;
      }
      log("REFERENCE_IMAGE_FAILED", {
        maxAttempts: 3,
        finalReason: lastReason,
      });
      throw new Error(lastReason);
    }
  }
  log("REFERENCE_IMAGE_FAILED", {
    maxAttempts: 3,
    finalReason: lastReason,
  });
  throw new Error(lastReason);
}

export async function POST(req: NextRequest) {
  const tempPaths: string[] = [];
  try {
    await requireCurrentUser();
    const formData = await req.formData();
    const file = formData.get("video");
    const ratio = normalizeRatio(formData.get("ratio"));
    const targetSeconds = parseTargetSeconds(formData.get("targetSeconds"));
    const remixPrompt = pickText(formData.get("prompt"));

    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, message: "请上传参考视频" }, { status: 400 });
    }
    if (!targetSeconds) {
      return NextResponse.json({ ok: false, message: "targetSeconds 必须为 4、8 或 12" }, { status: 400 });
    }
    const mimeType = resolveMimeType(file);
    if (!mimeType) {
      return NextResponse.json({ ok: false, message: "仅支持 mp4 / mov / webm 视频" }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ ok: false, message: "参考视频最大 50MB" }, { status: 400 });
    }

    const ext = path.extname(file.name).toLowerCase();
    const videoPath = path.join(tmpdir(), `quark-remix-frame-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    const framePath = path.join(tmpdir(), `quark-remix-frame-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`);
    tempPaths.push(videoPath, framePath);
    await writeFile(videoPath, Buffer.from(await file.arrayBuffer()));
    const duration = await probeDuration(videoPath).catch(() => null);
    await extractFrameWithRetry({ videoPath, outputPath: framePath, duration, fileName: file.name });
    const frameBytes = await readFile(framePath);
    const frameDataUrl = `data:image/jpeg;base64,${frameBytes.toString("base64")}`;
    const prompt = [
      `请基于参考帧生成一张适合作为 Sora2 图生视频首帧/参考图的高清图片。保持原视频主体、商品类别、场景类型和画面风格，不要改变商品结构，不要添加文字、水印、Logo 或品牌标识。画面应清晰、干净、适合作为视频生成参考图。比例为 ${ratio}。`,
      remixPrompt ? `参考视频复刻提示词：${remixPrompt}` : "",
    ].filter(Boolean).join("\n");
    const imageUrl = await generateReferenceImageWithRetry({ frameDataUrl, ratio, prompt });
    return NextResponse.json({ ok: true, imageUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : "参考图生成失败";
    log("REFERENCE_IMAGE_FAILED", {
      finalReason: message,
    });
    const status = message === "请先登录" || message === "账号已被禁用" ? 401 : 500;
    return NextResponse.json({ ok: false, message }, { status });
  } finally {
    await Promise.all(tempPaths.map((filePath) => unlink(filePath).catch(() => undefined)));
  }
}
