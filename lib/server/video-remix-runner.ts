import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { generateYunwuImage } from "./yunwu-image";
import { getVideoRemixJob, updateVideoRemixJob, type VideoRemixJob } from "./video-remix-store";

const execFileAsync = promisify(execFile);
const MODEL = "gemini-3.1-pro-preview";
const ENDPOINT = `https://yunwu.ai/v1beta/models/${MODEL}:generateContent`;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [3000, 8000];
const NORMAL_TIMEOUT_MS = 300_000;
const LARGE_VIDEO_TIMEOUT_MS = 600_000;
const IMAGE_RETRY_DELAYS_MS = [2000, 5000];

const log = (stage: string, payload: Record<string, unknown>) => {
  console.log(`[VIDEO_REMIX][${stage}]`, JSON.stringify(payload));
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const asObject = (value: unknown): Record<string, unknown> | null => {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
};

const pickText = (value: unknown) => (typeof value === "string" ? value : "");

const stringifyUnknown = (value: unknown) => {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  if (value === null || typeof value === "undefined") return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const shouldRetryGeminiError = (params: { status?: number | null; reason: string }) => {
  const status = params.status ?? null;
  const lower = params.reason.toLowerCase();
  if (status === 400 || status === 401 || status === 403 || status === 404) return false;
  return (
    status === 429 ||
    (typeof status === "number" && status >= 500) ||
    lower.includes("429") ||
    lower.includes("status=429") ||
    lower.includes("上游已饱和") ||
    lower.includes("too many requests") ||
    lower.includes("rate limit") ||
    lower.includes("status=5") ||
    lower.includes("fetch failed") ||
    lower.includes("network") ||
    lower.includes("timeout") ||
    lower.includes("aborterror") ||
    lower.includes("空内容") ||
    lower.includes("未返回 prompt") ||
    lower.includes("未返回复刻提示词") ||
    lower.includes("json 解析失败")
  );
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

const outputLanguageInstruction = (language?: VideoRemixJob["outputLanguage"]) => {
  if (language === "en") {
    return "Output language: English. Both analysis and prompt must be written strictly in English. Do not mix Chinese, Japanese, or other languages.";
  }
  if (language === "ja") {
    return "出力言語：日本語。analysis と prompt は必ず日本語のみで書いてください。中国語・英語などを混在させないでください。";
  }
  return "输出语言：中文。analysis 和 prompt 必须严格使用中文，不要中英混杂，也不要夹杂日文或其他语言。";
};

const buildInstruction = (job: VideoRemixJob) => {
  const ratioLabel = job.ratio === "9:16" ? "9:16竖屏" : "16:9横屏";
  const userHint = job.userHint ? `\n用户主动填写的复刻补充要求：${job.userHint}` : "\n用户没有填写复刻补充要求。";
  return `你是短视频提示词复刻专家。请先忠实识别用户上传视频本身的内容，再生成适配 Sora2 的最终视频生成提示词。目标生成时长为 ${job.targetSeconds} 秒，比例为 ${ratioLabel}。

${outputLanguageInstruction(job.outputLanguage)}
请严格使用用户选择的输出语言，不要中英混杂。返回 JSON 中 analysis 和 prompt 都必须使用该语言。

核心规则：
1. 默认不要改变原视频主题、商品类别、场景类别或叙事主体。
2. 必须保留原视频的核心主体、商品类型、场景类型、商业目的、带货逻辑和卖点表达方式。
3. 如果原视频是厨房工具带货视频，输出也必须是厨房工具带货视频的复刻提示词；如果是其他商品/场景，也应保持原商品类别和场景类别。
4. 只复刻镜头结构、节奏、画面风格、运动方式、卖点呈现、情绪氛围和叙事结构。
5. 不复制品牌、Logo、水印、原字幕、人脸身份、明确版权元素。
6. 不要把主题改成外部旧文案或用户输入框里的其他内容。
7. 只有当“复刻补充要求”明确要求改成某个主题/品类时，才允许主题迁移；否则必须忠实保持原视频核心主体和业务类型。
8. 最终提示词必须完整适配目标秒数，避免叙事未完就结束，也避免叙事过早结束后画面无持续价值。

最终 prompt 必须包含：目标秒数、比例、0-1s/1-3s 等分段镜头节奏、画面主体、商品/人物/场景、动作、风格、构图、光线、情绪、卖点结构，以及禁止字幕/水印/Logo/品牌/原人物身份的约束。
4秒要快速闭环；8秒要有清晰起承转合；12秒可以有更完整的递进。${userHint}

请只输出 JSON：{"analysis":"string","prompt":"string"}`;
};

const extractTextFromGemini = (payload: Record<string, unknown> | null) => {
  const candidates = payload?.candidates;
  if (!Array.isArray(candidates)) return "";
  for (const candidate of candidates) {
    const parts = asObject(asObject(candidate)?.content)?.parts;
    if (!Array.isArray(parts)) continue;
    const text = parts.map((part) => pickText(asObject(part)?.text)).filter(Boolean).join("\n");
    if (text) return text;
  }
  return "";
};

const parseAnalysisJson = (text: string) => {
  const trimmed = text.trim();
  const withoutFence = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const match = withoutFence.match(/\{[\s\S]*\}/);
  const jsonText = match ? match[0] : withoutFence;
  let parsed: { analysis?: unknown; prompt?: unknown };
  try {
    parsed = JSON.parse(jsonText) as { analysis?: unknown; prompt?: unknown };
  } catch {
    const promptMatch =
      withoutFence.match(/"prompt"\s*:\s*"([\s\S]*?)"\s*(?:[,}])/i) ||
      withoutFence.match(/prompt\s*[:：]\s*([\s\S]+)$/i);
    const analysisMatch =
      withoutFence.match(/"analysis"\s*:\s*"([\s\S]*?)"\s*,\s*"prompt"/i) ||
      withoutFence.match(/analysis\s*[:：]\s*([\s\S]*?)(?:prompt\s*[:：]|$)/i);
    const fallbackPrompt = promptMatch?.[1]?.replace(/\\"/g, "\"").trim() || "";
    if (!fallbackPrompt) {
      throw new Error("Gemini 输出 JSON 解析失败且未提取到 prompt");
    }
    parsed = {
      analysis: analysisMatch?.[1]?.replace(/\\"/g, "\"").trim() || "",
      prompt: fallbackPrompt,
    };
  }
  return {
    analysis: pickText(parsed.analysis).trim(),
    prompt: pickText(parsed.prompt).trim(),
  };
};

async function requestGeminiWithRetry(job: VideoRemixJob, videoBase64: string) {
  const timeoutMs = job.fileSize > 20 * 1024 * 1024 ? LARGE_VIDEO_TIMEOUT_MS : NORMAL_TIMEOUT_MS;
  let lastReason = "Gemini 分析失败";
  let lastStatus: number | null = null;
  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: buildInstruction(job) },
          {
            inline_data: {
              mime_type: job.mimeType,
              data: videoBase64,
            },
          },
        ],
      },
    ],
  };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      log("GEMINI_REQUEST", {
        attempt,
        maxAttempts: MAX_ATTEMPTS,
        endpoint: ENDPOINT,
        model: MODEL,
        fileSize: job.fileSize,
        targetSeconds: job.targetSeconds,
        ratio: job.ratio,
        timeoutMs,
        hasVideoBase64: true,
        base64PreviewLength: Math.min(videoBase64.length, 80),
      });
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.YUNWU_API_KEY || ""}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const rawText = await response.text();
      const contentType = response.headers.get("content-type") || "";
      lastStatus = response.status;
      log("GEMINI_RESPONSE", {
        attempt,
        maxAttempts: MAX_ATTEMPTS,
        ok: response.ok,
        status: response.status,
        contentType,
        rawPreview: rawText.slice(0, 1200),
      });
      if (!response.ok) {
        let parsedError = "";
        try {
          const errorJson = JSON.parse(rawText) as Record<string, unknown>;
          parsedError = stringifyUnknown(asObject(errorJson.error)?.message || errorJson.message || errorJson.error);
        } catch {
          parsedError = rawText.slice(0, 300);
        }
        lastReason = parsedError ? `Gemini 分析失败 status=${response.status}: ${parsedError}` : `Gemini 分析失败 status=${response.status}`;
        throw new Error(lastReason);
      }
      const json = JSON.parse(rawText) as Record<string, unknown>;
      const text = extractTextFromGemini(json);
      if (!text) throw new Error("模型返回空内容");
      const parsed = parseAnalysisJson(text);
      if (!parsed.prompt) throw new Error("Gemini 未返回 prompt");
      return { parsed, attempt };
    } catch (error) {
      const errorName = error instanceof Error ? error.name : "Error";
      const isTimeout = errorName === "AbortError" || controller.signal.aborted;
      lastReason = isTimeout ? `timeout after ${timeoutMs}ms` : stringifyUnknown(error) || lastReason;
      const retryable = shouldRetryGeminiError({ status: lastStatus, reason: lastReason });
      if (retryable && attempt < MAX_ATTEMPTS) {
        const delayMs = RETRY_DELAYS_MS[attempt - 1] ?? 0;
        log("RETRY", { attempt, maxAttempts: MAX_ATTEMPTS, delayMs, reason: lastReason, status: lastStatus, retryable: true });
        if (delayMs > 0) await delay(delayMs);
        continue;
      }
      throw new Error(lastReason);
    } finally {
      clearTimeout(timeoutId);
    }
  }
  throw new Error(lastReason);
}

async function extractFrame(videoPath: string, outputPath: string, timestamp: number) {
  await execFileAsync("ffmpeg", ["-y", "-ss", String(Math.max(0, timestamp)), "-i", videoPath, "-frames:v", "1", "-q:v", "2", outputPath]);
}

async function extractReferenceFrame(job: VideoRemixJob, framePath: string) {
  const firstTimestamp = job.duration !== null && job.duration < 2.5 ? Math.max(0.1, job.duration * 0.4) : 2.2;
  const timestamps = [firstTimestamp, job.duration !== null ? Math.max(0.1, job.duration * 0.5) : 1];
  let lastReason = "抽帧失败";
  for (let attempt = 1; attempt <= timestamps.length; attempt += 1) {
    const timestamp = timestamps[attempt - 1];
    log("FRAME_EXTRACT_REQUEST", { attempt, maxAttempts: timestamps.length, jobId: job.id, fileName: job.fileName, duration: job.duration, timestamp });
    try {
      await extractFrame(job.filePath, framePath, timestamp);
      log("FRAME_EXTRACT_SUCCESS", { attempt, jobId: job.id, duration: job.duration, timestamp });
      return;
    } catch (error) {
      lastReason = stringifyUnknown(error);
      log("FRAME_EXTRACT_FAILED", { attempt, maxAttempts: timestamps.length, jobId: job.id, timestamp, reason: lastReason });
    }
  }
  throw new Error(lastReason);
}

async function generateReferenceImageForJob(job: VideoRemixJob, prompt: string) {
  const framePath = path.join(tmpdir(), `quark-remix-job-${job.id}.jpg`);
  try {
    await extractReferenceFrame(job, framePath);
    const frameBytes = await readFile(framePath);
    const frameDataUrl = `data:image/jpeg;base64,${frameBytes.toString("base64")}`;
    const imagePrompt = [
      `请基于参考帧生成一张适合作为 Sora2 图生视频首帧/参考图的高清图片。保持原视频主体、商品类别、场景类型和画面风格，不要改变商品结构，不要添加文字、水印、Logo 或品牌标识。画面应清晰、干净、适合作为视频生成参考图。比例为 ${job.ratio}。`,
      prompt ? `参考视频复刻提示词：${prompt}` : "",
    ].filter(Boolean).join("\n");
    let lastReason = "参考图生成失败";
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        log("REFERENCE_IMAGE_REQUEST", {
          attempt,
          maxAttempts: 3,
          jobId: job.id,
          ratio: job.ratio,
          imageSize: "2K",
          imageModel: "banana2",
          hasFrameBase64: true,
          frameBase64PreviewLength: 80,
        });
        const result = await generateYunwuImage({
          prompt: imagePrompt,
          referenceImageUrl: frameDataUrl,
          ratio: job.ratio,
          imageSize: "2K",
          imageModel: "banana2",
          maxAttempts: 1,
          logParsedJson: false,
        });
        log("REFERENCE_IMAGE_SUCCESS", { attempt, jobId: job.id, imageUrl: result.imageUrl, model: result.apiModel });
        return result.imageUrl;
      } catch (error) {
        lastReason = stringifyUnknown(error);
        if (shouldRetryImageError(lastReason) && attempt < 3) {
          const delayMs = IMAGE_RETRY_DELAYS_MS[attempt - 1] ?? 0;
          log("REFERENCE_IMAGE_RETRY", { attempt, maxAttempts: 3, jobId: job.id, delayMs, reason: lastReason, retryable: true });
          if (delayMs > 0) await delay(delayMs);
          continue;
        }
        log("REFERENCE_IMAGE_FAILED", { jobId: job.id, maxAttempts: 3, finalReason: lastReason });
        throw new Error(lastReason);
      }
    }
    throw new Error(lastReason);
  } finally {
    await unlink(framePath).catch(() => undefined);
  }
}

export async function runVideoRemixJob(jobId: string) {
  let job = await getVideoRemixJob(jobId);
  if (!job) return;
  try {
    log("JOB_STARTED", { jobId });
    job = (await updateVideoRemixJob(jobId, { status: "running", error: "" })) ?? job;
    if (!process.env.YUNWU_API_KEY) {
      throw new Error("缺少 YUNWU_API_KEY，请在服务端环境变量配置");
    }
    const videoBase64 = (await readFile(job.filePath)).toString("base64");
    const { parsed, attempt } = await requestGeminiWithRetry(job, videoBase64);
    log("ANALYZE_SUCCESS", {
      attempt,
      duration: job.duration,
      targetSeconds: job.targetSeconds,
      promptLength: parsed.prompt.length,
      analysisLength: parsed.analysis.length,
      promptPreview: parsed.prompt.slice(0, 160),
      usedUserHint: job.hasUserHint,
    });

    let referenceImageUrl = "";
    let referenceImageError = "";
    if (job.generateReferenceImage) {
      try {
        referenceImageUrl = await generateReferenceImageForJob(job, parsed.prompt);
      } catch (error) {
        referenceImageError = stringifyUnknown(error) || "参考图生成失败";
      }
    }

    await updateVideoRemixJob(jobId, {
      status: "success",
      analysis: parsed.analysis,
      prompt: parsed.prompt,
      referenceImageUrl,
      referenceImageError,
    });
    log("JOB_SUCCESS", {
      jobId,
      promptLength: parsed.prompt.length,
      analysisLength: parsed.analysis.length,
      hasReferenceImage: Boolean(referenceImageUrl),
    });
  } catch (error) {
    const message = stringifyUnknown(error) || "分析失败";
    await updateVideoRemixJob(jobId, { status: "failed", error: message });
    log("JOB_FAILED", { jobId, error: message });
  }
}
