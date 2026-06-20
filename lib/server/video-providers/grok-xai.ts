import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveLocalUploadsSource } from "../local-uploads";
import { extractTailReferenceFrameForContinuation } from "../medium-video-frame";
import { GrokVideoResult, GrokVideoSegmentsInput, GrokVideoWithExtensionsInput } from "./types";

type XaiTaskStatus = "processing" | "success" | "failed" | "unknown";
type PreparedXaiImage = {
  url: string;
  mode: "data_url" | "public_url";
};

const PROVIDER_SOURCE = "xai";
const GENERATIONS_PATH = "/v1/videos/generations";
const EXTENSIONS_PATH = "/v1/videos/extensions";
const QUERY_PATH = "/v1/videos";
const XAI_UNIT_SECONDS = 10;
const MAX_ATTEMPTS = 5;
const RETRY_BACKOFF_MS = [5000, 15000, 30000, 60000];
const QUERY_FETCH_MAX_ATTEMPTS = 3;
const QUERY_FETCH_BACKOFF_MS = [3000, 5000];
const XAI_PROMPT_MAX_LENGTH = 3500;
const XAI_PROMPT_LENGTH_ERROR_MESSAGE = "xAI Grok 提示词过长，已超过官方限制，请缩短智能体提示词或用户主题。";

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const log = (stage: string, payload: Record<string, unknown>) => {
  console.log(`[XAI_GROK][${stage}]`, JSON.stringify({ providerSource: PROVIDER_SOURCE, ...payload }));
};

const getBaseUrl = () => (process.env.XAI_GROK_VIDEO_BASE_URL || "https://api.x.ai").replace(/\/$/, "");
const getTextToVideoModel = () => process.env.XAI_GROK_VIDEO_MODEL || "grok-imagine-video";
const getImageToVideoModel = () => process.env.XAI_GROK_IMAGE_TO_VIDEO_MODEL || "grok-imagine-video-1.5";
const getResolution = () => process.env.XAI_GROK_VIDEO_RESOLUTION || "720p";

const getApiKey = () => {
  const key = process.env.XAI_API_KEY;
  if (!key) {
    throw new Error("缺少 XAI_API_KEY，请在服务端环境变量配置 xAI 官方 API Key。");
  }
  return key;
};

const buildHeaders = () => ({
  Authorization: `Bearer ${getApiKey()}`,
  "Content-Type": "application/json",
  Accept: "application/json",
});

const parseJsonResponse = async (response: Response) => {
  const rawText = await response.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : null;
  } catch {
    json = null;
  }
  return { ok: response.ok, status: response.status, rawText, json };
};

const safeRawPreview = (value: unknown) => {
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const video = source.video && typeof source.video === "object" ? (source.video as Record<string, unknown>) : undefined;
  const error = source.error && typeof source.error === "object" ? (source.error as Record<string, unknown>) : source.error;
  return {
    request_id: source.request_id || source.id,
    status: source.status,
    model: source.model,
    hasVideoUrl: typeof video?.url === "string" && video.url.length > 0,
    duration: video?.duration,
    error,
    message: source.message,
  };
};

const extractRequestId = (json: Record<string, unknown> | null) => {
  const candidates = [json?.request_id, json?.requestId, json?.id];
  const found = candidates.find((value) => typeof value === "string" && value.trim().length > 0);
  return typeof found === "string" ? found : "";
};

const extractErrorMessage = (json: Record<string, unknown> | null, fallback = "") => {
  const error = json?.error && typeof json.error === "object" ? (json.error as Record<string, unknown>) : undefined;
  const candidates = [error?.message, error?.code, json?.message, json?.reason, typeof json?.error === "string" ? json.error : undefined, fallback];
  const found = candidates.find((value) => typeof value === "string" && value.trim().length > 0);
  return typeof found === "string" ? found : fallback;
};

const normalizePromptText = (value: string) => value.replace(/\r/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

const uniquePromptLines = (value: string) => {
  const seen = new Set<string>();
  return value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      const key = line.replace(/\s+/g, " ").slice(0, 180);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const pickPromptLines = (lines: string[], patterns: RegExp[], maxChars: number) => {
  const picked: string[] = [];
  let total = 0;
  for (const line of lines) {
    if (!patterns.some((pattern) => pattern.test(line))) continue;
    const nextTotal = total + line.length + 1;
    if (nextTotal > maxChars) continue;
    picked.push(line);
    total = nextTotal;
  }
  return picked;
};

export function compactPromptForXai(prompt: string, maxLength = XAI_PROMPT_MAX_LENGTH): string {
  const normalized = normalizePromptText(prompt);
  const originalLength = normalized.length;
  const criticalTail = [
    "Hard constraints: no subtitles, no watermark, no logo.",
    "If a reference image is provided, it is the previous segment's last usable non-black frame.",
    "Continue from previous frame with immediate motion at 0.0s; do not repeat completed action; do not restart; do not return to an earlier state.",
  ].join(" ");

  if (originalLength <= maxLength) {
    log("PROMPT_COMPACTED", { originalLength, finalLength: originalLength, maxLength, wasCompacted: false });
    return normalized;
  }

  const lines = uniquePromptLines(normalized);
  const priorityLines = pickPromptLines(
    lines,
    [
      /第\s*\d+\s*\/\s*\d+\s*段|segment\s*\d+|segmentPlan\[\d+\]|完整脚本\s*\d+\s*-\s*\d+s|当前段|本段|0-10|10-20|20-30|30-40|40-50|50-60/i,
      /主题|主体|场景|画面|动作|镜头|口播|对白|voiceover|visual|camera|scene|subject|action/i,
      /承接|上一段|尾帧|最后可用非黑帧|继续|连续|无缝|不要重复|不要重新|immediate motion|previous frame|continue/i,
      /不要字幕|水印|logo|subtitle|watermark/i,
    ],
    Math.max(900, maxLength - criticalTail.length - 400)
  );
  const fallbackHead = normalized.slice(0, Math.max(400, maxLength - criticalTail.length - 700));
  const compactedBody = normalizePromptText(priorityLines.length ? priorityLines.join("\n") : fallbackHead);
  const budgetForBody = Math.max(200, maxLength - criticalTail.length - 4);
  const finalBody = compactedBody.length > budgetForBody ? compactedBody.slice(0, budgetForBody).trim() : compactedBody;
  const finalPrompt = normalizePromptText(`${finalBody}\n\n${criticalTail}`).slice(0, maxLength).trim();

  log("PROMPT_COMPACTED", {
    originalLength,
    finalLength: finalPrompt.length,
    maxLength,
    wasCompacted: true,
  });
  return finalPrompt;
}

const isPromptLengthError = (message: string) => {
  const text = message.toLowerCase();
  return (
    text.includes("prompt length exceeds") ||
    text.includes("maximum allowed length") ||
    text.includes("prompt too long") ||
    text.includes("input too long") ||
    text.includes("context length") ||
    text.includes("提示词过长") ||
    text.includes("超过官方限制")
  );
};

const normalizeStatus = (value: unknown): XaiTaskStatus => {
  const status = String(value || "").toLowerCase();
  if (status === "pending") return "processing";
  if (status === "done") return "success";
  if (status === "failed" || status === "expired") return "failed";
  return "unknown";
};

const extractVideoUrl = (json: Record<string, unknown> | null) => {
  const video = json?.video && typeof json.video === "object" ? (json.video as Record<string, unknown>) : undefined;
  const url = video?.url;
  return typeof url === "string" && (/^https?:\/\//i.test(url) || /^data:video\//i.test(url)) ? url : "";
};

const extractVideoDuration = (json: Record<string, unknown> | null) => {
  const video = json?.video && typeof json.video === "object" ? (json.video as Record<string, unknown>) : undefined;
  const duration = Number(video?.duration);
  return Number.isFinite(duration) && duration > 0 ? duration : undefined;
};

const isNonRetryableError = (message: string) => {
  const text = message.toLowerCase();
  return (
    isPromptLengthError(message) ||
    text.includes("xai_api_key") ||
    text.includes("api key") ||
    text.includes("401") ||
    text.includes("403") ||
    text.includes("unauthorized") ||
    text.includes("forbidden") ||
    text.includes("invalid_argument") ||
    text.includes("permission_denied") ||
    text.includes("failed_precondition") ||
    text.includes("invalid parameter") ||
    text.includes("参数错误") ||
    text.includes("参数无效") ||
    text.includes("图片读取失败") ||
    text.includes("非法 base64") ||
    text.includes("invalid image base64") ||
    text.includes("image decode failed")
  );
};

const isRetryableError = (message: string) => {
  const text = message.toLowerCase();
  return (
    !isNonRetryableError(message) &&
    (text.includes("429") ||
      /5\d\d/.test(text) ||
      text.includes("service_unavailable") ||
      text.includes("fetch failed") ||
      text.includes("timeout") ||
      text.includes("network") ||
      text.includes("video url 空") ||
      text.includes("video_url 为空") ||
      text.includes("video url") ||
      text.includes("未返回可用视频地址"))
  );
};

const isQueryFetchRetryableError = (message: string) => {
  const text = message.toLowerCase();
  return text.includes("fetch failed") || text.includes("network") || text.includes("timeout") || text.includes("aborterror") || text.includes("status=429") || /status=5\d\d/.test(text);
};

const mimeFromPathOrUrl = (value: string, fallback: "image" | "video" = "image") => {
  const ext = (() => {
    try {
      return path.extname(new URL(value).pathname).toLowerCase();
    } catch {
      return path.extname(value).toLowerCase();
    }
  })();
  if (fallback === "video") {
    if (ext === ".webm") return "video/webm";
    if (ext === ".mov") return "video/quicktime";
    return "video/mp4";
  }
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
};

async function prepareXaiReferenceImage(source?: string): Promise<PreparedXaiImage | undefined> {
  const trimmed = source?.trim();
  if (!trimmed) return undefined;
  if (/^data:image\/[^;,]+;base64,[\s\S]+$/i.test(trimmed)) {
    return { url: trimmed, mode: "data_url" };
  }
  const localSource = await resolveLocalUploadsSource(trimmed);
  if (localSource) {
    if (!localSource.exists) {
      throw new Error("xAI Grok 图片读取失败：本地参考图文件不存在");
    }
    const bytes = await readFile(localSource.resolvedPath);
    const mimeType = mimeFromPathOrUrl(localSource.resolvedPath);
    return { url: `data:${mimeType};base64,${bytes.toString("base64")}`, mode: "data_url" };
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return { url: trimmed, mode: "public_url" };
  }
  throw new Error("xAI Grok 图片读取失败：参考图必须是公网 URL、data URL 或本地上传文件");
}

const getPublicSiteUrl = () => (process.env.PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://kuake888.com").replace(/\/$/, "");

async function prepareXaiExtensionVideoUrl(source: string) {
  const trimmed = source.trim();
  if (!trimmed) {
    throw new Error("xAI 扩展视频需要公网可访问的视频 URL，请配置 PUBLIC_SITE_URL。");
  }
  if (/^https?:\/\//i.test(trimmed) || /^data:video\/[^;,]+;base64,/i.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith("/api/uploads/")) {
    return `${getPublicSiteUrl()}${trimmed}`;
  }
  const localSource = await resolveLocalUploadsSource(trimmed);
  if (localSource) {
    if (!localSource.exists) {
      throw new Error("xAI 扩展视频需要公网可访问的视频 URL，请配置 PUBLIC_SITE_URL。");
    }
    const bytes = await readFile(localSource.resolvedPath);
    const mimeType = mimeFromPathOrUrl(localSource.resolvedPath, "video");
    return `data:${mimeType};base64,${bytes.toString("base64")}`;
  }
  if (trimmed.startsWith("/")) {
    return `${getPublicSiteUrl()}${trimmed}`;
  }
  throw new Error("xAI 扩展视频需要公网可访问的视频 URL，请配置 PUBLIC_SITE_URL。");
}

export async function createXaiGrokVideoTask(params: { prompt: string; ratio: string; referenceImage?: string; attempt?: number }) {
  const preparedImage = await prepareXaiReferenceImage(params.referenceImage);
  const mode = preparedImage ? "image-to-video" : "text-to-video";
  const aspectRatio = params.ratio === "9:16" ? "9:16" : "16:9";
  const model = preparedImage ? getImageToVideoModel() : getTextToVideoModel();
  const resolution = getResolution();
  const prompt = compactPromptForXai(params.prompt);
  const payload = preparedImage
    ? {
        model,
        prompt,
        image: { url: preparedImage.url },
        duration: XAI_UNIT_SECONDS,
        aspect_ratio: aspectRatio,
        resolution,
      }
    : {
        model,
        prompt,
        duration: XAI_UNIT_SECONDS,
        aspect_ratio: aspectRatio,
        resolution,
      };
  log("CREATE_REQUEST", {
    attempt: params.attempt ?? 1,
    endpoint: GENERATIONS_PATH,
    mode,
    model,
    duration: XAI_UNIT_SECONDS,
    resolution,
    aspectRatio,
    hasReferenceImage: Boolean(preparedImage),
    imageMode: preparedImage?.mode || "none",
    promptPreview: prompt.slice(0, 120),
    promptLength: prompt.length,
  });
  const response = await fetch(`${getBaseUrl()}${GENERATIONS_PATH}`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify(payload),
  });
  const parsed = await parseJsonResponse(response);
  const requestId = extractRequestId(parsed.json);
  log("CREATE_RESPONSE", { ok: parsed.ok, status: parsed.status, requestId, rawPreview: safeRawPreview(parsed.json) });
  if (!parsed.ok) {
    const errorMessage = extractErrorMessage(parsed.json, parsed.rawText.slice(0, 120));
    if (parsed.status === 400 && isPromptLengthError(errorMessage)) {
      throw new Error(XAI_PROMPT_LENGTH_ERROR_MESSAGE);
    }
    throw new Error(`xAI Grok 创建视频失败 status=${parsed.status} ${errorMessage}`);
  }
  if (!requestId) throw new Error("xAI Grok 创建视频失败：未返回 request_id");
  return { requestId, model, raw: parsed.json };
}

export async function extendXaiGrokVideoTask(params: { prompt: string; videoUrl: string; attempt?: number }) {
  const model = getTextToVideoModel();
  const videoUrl = await prepareXaiExtensionVideoUrl(params.videoUrl);
  const prompt = compactPromptForXai(params.prompt);
  const payload = {
    model,
    prompt,
    video: { url: videoUrl },
    duration: XAI_UNIT_SECONDS,
  };
  log("EXTEND_REQUEST", {
    attempt: params.attempt ?? 1,
    endpoint: EXTENSIONS_PATH,
    model,
    duration: XAI_UNIT_SECONDS,
    videoMode: videoUrl.startsWith("data:") ? "data_url" : "public_url",
    promptPreview: prompt.slice(0, 120),
    promptLength: prompt.length,
  });
  const response = await fetch(`${getBaseUrl()}${EXTENSIONS_PATH}`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify(payload),
  });
  const parsed = await parseJsonResponse(response);
  const requestId = extractRequestId(parsed.json);
  log("EXTEND_RESPONSE", { ok: parsed.ok, status: parsed.status, requestId, rawPreview: safeRawPreview(parsed.json) });
  if (!parsed.ok) {
    const errorMessage = extractErrorMessage(parsed.json, parsed.rawText.slice(0, 120));
    if (parsed.status === 400 && isPromptLengthError(errorMessage)) {
      throw new Error(XAI_PROMPT_LENGTH_ERROR_MESSAGE);
    }
    throw new Error(`xAI Grok 扩展视频失败 status=${parsed.status} ${errorMessage}`);
  }
  if (!requestId) throw new Error("xAI Grok 扩展视频失败：未返回 request_id");
  return { requestId, model, raw: parsed.json };
}

export async function queryXaiGrokVideoTask(requestId: string) {
  log("QUERY_REQUEST", { requestId });
  const response = await fetch(`${getBaseUrl()}${QUERY_PATH}/${encodeURIComponent(requestId)}`, {
    method: "GET",
    headers: buildHeaders(),
  });
  const parsed = await parseJsonResponse(response);
  const rawStatus = String(parsed.json?.status || "");
  const mappedStatus = normalizeStatus(rawStatus);
  const videoUrl = extractVideoUrl(parsed.json);
  const duration = extractVideoDuration(parsed.json);
  const reason = extractErrorMessage(parsed.json, "");
  log("QUERY_RESPONSE", {
    requestId,
    status: rawStatus,
    mappedStatus,
    hasVideoUrl: Boolean(videoUrl),
    videoUrlPreview: videoUrl ? videoUrl.slice(0, 140) : "",
    duration,
    rawPreview: safeRawPreview(parsed.json),
  });
  if (!parsed.ok) {
    throw new Error(`xAI Grok 查询任务失败 status=${parsed.status} ${extractErrorMessage(parsed.json, parsed.rawText.slice(0, 120))}`);
  }
  return {
    requestId: extractRequestId(parsed.json) || requestId,
    status: mappedStatus,
    rawStatus,
    videoUrl,
    duration,
    reason,
    raw: parsed.json ?? undefined,
  };
}

async function queryXaiGrokVideoTaskWithFetchRetry(requestId: string) {
  for (let attempt = 1; attempt <= QUERY_FETCH_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await queryXaiGrokVideoTask(requestId);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (!isQueryFetchRetryableError(reason) || attempt === QUERY_FETCH_MAX_ATTEMPTS) {
        throw new Error(reason);
      }
      const delayMs = QUERY_FETCH_BACKOFF_MS[attempt - 1] ?? QUERY_FETCH_BACKOFF_MS[QUERY_FETCH_BACKOFF_MS.length - 1];
      log("QUERY_RETRY", { requestId, attempt, maxAttempts: QUERY_FETCH_MAX_ATTEMPTS, delayMs, reason });
      await delay(delayMs);
    }
  }
  throw new Error(`xAI Grok 查询任务失败，requestId=${requestId}`);
}

async function waitForXaiTask(requestId: string) {
  const pollIntervalMs = Math.max(1000, Number(process.env.XAI_GROK_VIDEO_POLL_INTERVAL_MS || 5000));
  const maxPoll = Math.max(1, Number(process.env.XAI_GROK_VIDEO_POLL_MAX_ATTEMPTS || 120));
  for (let pollCount = 1; pollCount <= maxPoll; pollCount += 1) {
    const result = await queryXaiGrokVideoTaskWithFetchRetry(requestId);
    if (result.status === "success") {
      if (result.videoUrl) return result;
      throw new Error(`xAI Grok 任务完成但 video url 空，requestId=${requestId}`);
    }
    if (result.status === "failed") {
      throw new Error(result.reason || "xAI Grok 视频生成失败");
    }
    if (result.status === "unknown") {
      log("QUERY_RESPONSE", { requestId, pollCount, rawStatus: result.rawStatus, decision: "continue_polling" });
    }
    await delay(pollIntervalMs);
  }
  throw new Error(`xAI Grok 任务查询超时，requestId=${requestId}`);
}

async function runCreateWithRetry(params: { prompt: string; ratio: string; referenceImage?: string }) {
  let lastRequestId = "";
  let lastError = "";
  let model = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const created = await createXaiGrokVideoTask({ ...params, attempt });
      lastRequestId = created.requestId;
      model = created.model;
      const result = await waitForXaiTask(created.requestId);
      return { ...result, model };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastError = message;
      if (isNonRetryableError(message) || (!isRetryableError(message) && attempt > 1) || attempt === MAX_ATTEMPTS) {
        log("FINAL_FAILED", { stage: "create", attempts: attempt, finalReason: message, lastRequestId, model });
        throw new Error(message);
      }
      const delayMs = RETRY_BACKOFF_MS[attempt - 1] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1];
      log("RETRY", { stage: "create", attempt, maxAttempts: MAX_ATTEMPTS, delayMs, reason: message, requestId: lastRequestId, retryable: true });
      await delay(delayMs);
    }
  }
  throw new Error(lastError || "xAI Grok 视频生成失败");
}

async function runExtendWithRetry(params: { prompt: string; videoUrl: string }) {
  let lastRequestId = "";
  let lastError = "";
  let model = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const created = await extendXaiGrokVideoTask({ ...params, attempt });
      lastRequestId = created.requestId;
      model = created.model;
      const result = await waitForXaiTask(created.requestId);
      return { ...result, model };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastError = message;
      if (isNonRetryableError(message) || (!isRetryableError(message) && attempt > 1) || attempt === MAX_ATTEMPTS) {
        log("FINAL_FAILED", { stage: "extend", attempts: attempt, finalReason: message, lastRequestId, model });
        throw new Error(message);
      }
      const delayMs = RETRY_BACKOFF_MS[attempt - 1] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1];
      log("RETRY", { stage: "extend", attempt, maxAttempts: MAX_ATTEMPTS, delayMs, reason: message, requestId: lastRequestId, retryable: true });
      await delay(delayMs);
    }
  }
  throw new Error(lastError || "xAI Grok 扩展视频失败");
}

async function runXaiSegments(params: {
  prompts: string[];
  ratio: string;
  targetDurationSeconds: number;
  initialReferenceImages?: string[];
  taskId?: string;
  getReferenceImagesForSegment?: (segmentIndex: number, previousVideoUrl?: string) => Promise<string[] | undefined>;
}): Promise<GrokVideoResult> {
  const providerTaskIds: string[] = [];
  const segmentVideoUrls: string[] = [];
  const segmentCoverUrls: string[] = [];
  let successfulUnits = 0;
  try {
    let previousVideoUrl = "";
    for (let index = 0; index < params.prompts.length; index += 1) {
      const segmentIndex = index + 1;
      let referenceImages =
        index === 0
          ? params.initialReferenceImages ?? await params.getReferenceImagesForSegment?.(segmentIndex, previousVideoUrl)
          : await params.getReferenceImagesForSegment?.(segmentIndex, previousVideoUrl);
      if (index > 0 && !referenceImages?.length && previousVideoUrl) {
        const frame = await extractTailReferenceFrameForContinuation({
          taskId: params.taskId || `xai-grok-${Date.now()}`,
          segmentIndex,
          sourceVideoUrl: previousVideoUrl,
        });
        referenceImages = [frame.referenceUrl];
      }
      const result = await runCreateWithRetry({
        prompt: params.prompts[index],
        ratio: params.ratio,
        referenceImage: referenceImages?.[0],
      });
      providerTaskIds.push(result.requestId);
      if (result.videoUrl) segmentVideoUrls.push(result.videoUrl);
      previousVideoUrl = result.videoUrl || "";
      successfulUnits += 1;
      log("STITCH_SEGMENT_SUCCESS", { segmentIndex, totalSegments: params.prompts.length, requestId: result.requestId, hasVideoUrl: Boolean(result.videoUrl), hasReferenceImage: Boolean(referenceImages?.[0]), duration: result.duration });
    }
    const finalVideoUrl = segmentVideoUrls[segmentVideoUrls.length - 1] || "";
    log("FINAL_SUCCESS", {
      providerTaskIdsCount: providerTaskIds.length,
      finalTaskId: providerTaskIds[providerTaskIds.length - 1],
      finalVideoUrl: Boolean(finalVideoUrl),
      segmentVideoUrlsCount: segmentVideoUrls.length,
      targetDurationSeconds: params.targetDurationSeconds,
      successfulUnits,
      isFinalVideoLikelyComplete: params.prompts.length === 1 ? true : "segmented",
    });
    return {
      ok: Boolean(finalVideoUrl),
      providerSource: PROVIDER_SOURCE,
      providerTaskIds,
      finalTaskId: providerTaskIds[providerTaskIds.length - 1],
      finalVideoUrl,
      segmentVideoUrls,
      segmentCoverUrls,
      isFinalVideoLikelyComplete: params.prompts.length === 1,
      durationSeconds: params.targetDurationSeconds,
      successfulUnits,
      failedUnits: Math.max(0, params.prompts.length - successfulUnits),
      error: finalVideoUrl ? undefined : "xAI Grok 分段生成完成但没有可用视频地址",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("FINAL_FAILED", {
      stage: "run",
      attempts: 1,
      finalReason: message,
      lastTaskId: providerTaskIds[providerTaskIds.length - 1] || "",
      providerTaskIdsCount: providerTaskIds.length,
      segmentVideoUrlsCount: segmentVideoUrls.length,
      targetDurationSeconds: params.targetDurationSeconds,
      successfulUnits,
    });
    return {
      ok: false,
      providerSource: PROVIDER_SOURCE,
      providerTaskIds,
      finalTaskId: providerTaskIds[providerTaskIds.length - 1],
      finalVideoUrl: segmentVideoUrls[segmentVideoUrls.length - 1],
      segmentVideoUrls,
      segmentCoverUrls,
      isFinalVideoLikelyComplete: false,
      durationSeconds: params.targetDurationSeconds,
      successfulUnits,
      failedUnits: Math.max(1, params.prompts.length - successfulUnits),
      error: message,
    };
  }
}

export async function runXaiGrokVideoWithExtensions(params: GrokVideoWithExtensionsInput): Promise<GrokVideoResult> {
  const providerTaskIds: string[] = [];
  const segmentVideoUrls: string[] = [];
  const segmentCoverUrls: string[] = [];
  let successfulUnits = 0;
  try {
    const base = await runCreateWithRetry({
      prompt: params.basePrompt,
      ratio: params.ratio,
      referenceImage: params.referenceImages?.[0],
    });
    providerTaskIds.push(base.requestId);
    if (base.videoUrl) segmentVideoUrls.push(base.videoUrl);
    successfulUnits += 1;
    let previousVideoUrl = base.videoUrl || "";
    for (let index = 0; index < params.extensionPrompts.length; index += 1) {
      const result = await runExtendWithRetry({
        prompt: params.extensionPrompts[index],
        videoUrl: previousVideoUrl,
      });
      providerTaskIds.push(result.requestId);
      if (result.videoUrl) segmentVideoUrls.push(result.videoUrl);
      previousVideoUrl = result.videoUrl || previousVideoUrl;
      successfulUnits += 1;
      log("EXTEND_SEGMENT_SUCCESS", { segmentIndex: index + 2, totalSegments: params.extensionPrompts.length + 1, requestId: result.requestId, hasVideoUrl: Boolean(result.videoUrl), duration: result.duration });
    }
    const finalVideoUrl = previousVideoUrl || segmentVideoUrls[segmentVideoUrls.length - 1] || "";
    log("FINAL_SUCCESS", {
      providerTaskIdsCount: providerTaskIds.length,
      finalTaskId: providerTaskIds[providerTaskIds.length - 1],
      finalVideoUrl: Boolean(finalVideoUrl),
      segmentVideoUrlsCount: segmentVideoUrls.length,
      targetDurationSeconds: params.targetDurationSeconds,
      successfulUnits,
      isFinalVideoLikelyComplete: successfulUnits === params.extensionPrompts.length + 1 ? true : "unknown",
    });
    return {
      ok: Boolean(finalVideoUrl),
      providerSource: PROVIDER_SOURCE,
      providerTaskIds,
      finalTaskId: providerTaskIds[providerTaskIds.length - 1],
      finalVideoUrl,
      segmentVideoUrls,
      segmentCoverUrls,
      isFinalVideoLikelyComplete: successfulUnits === params.extensionPrompts.length + 1 ? true : "unknown",
      durationSeconds: params.targetDurationSeconds,
      successfulUnits,
      failedUnits: Math.max(0, params.extensionPrompts.length + 1 - successfulUnits),
      error: finalVideoUrl ? undefined : "xAI Grok 扩展生成完成但没有可用视频地址",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("FINAL_FAILED", {
      stage: "run_extend",
      attempts: 1,
      finalReason: message,
      lastTaskId: providerTaskIds[providerTaskIds.length - 1] || "",
      providerTaskIdsCount: providerTaskIds.length,
      segmentVideoUrlsCount: segmentVideoUrls.length,
      targetDurationSeconds: params.targetDurationSeconds,
      successfulUnits,
    });
    return {
      ok: false,
      providerSource: PROVIDER_SOURCE,
      providerTaskIds,
      finalTaskId: providerTaskIds[providerTaskIds.length - 1],
      finalVideoUrl: segmentVideoUrls[segmentVideoUrls.length - 1],
      segmentVideoUrls,
      segmentCoverUrls,
      isFinalVideoLikelyComplete: false,
      durationSeconds: params.targetDurationSeconds,
      successfulUnits,
      failedUnits: Math.max(1, params.extensionPrompts.length + 1 - successfulUnits),
      error: message,
    };
  }
}

export async function runXaiGrokVideoSegments(params: GrokVideoSegmentsInput): Promise<GrokVideoResult> {
  return runXaiSegments({
    prompts: params.prompts,
    ratio: params.ratio,
    targetDurationSeconds: params.targetDurationSeconds,
    taskId: params.taskId,
    getReferenceImagesForSegment: params.getReferenceImagesForSegment,
  });
}
