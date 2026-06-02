import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveLocalUploadsSource } from "./local-uploads";

export type GrokVideoResult = {
  ok: boolean;
  providerTaskIds: string[];
  finalTaskId?: string;
  finalVideoUrl?: string;
  segmentVideoUrls?: string[];
  isFinalVideoLikelyComplete?: boolean;
  durationSeconds: number;
  successfulUnits: number;
  stitchConcatFailed?: boolean;
  stitchConcatError?: string;
  error?: string;
};

type GrokTaskStatus = "pending" | "processing" | "succeeded" | "failed" | "cancelled" | "timeout" | "unknown";

type GrokTaskQueryResult = {
  taskId: string;
  status: GrokTaskStatus;
  rawStatus: string;
  videoUrl?: string;
  coverUrl?: string;
  errorMessage?: string;
  raw?: Record<string, unknown>;
};

const CREATE_PATH = "/v1/video/create";
const QUERY_PATH = "/v1/video/query";
const EXTEND_PATH = "/v1/video/extend";
const GROK_UNIT_SECONDS = 10;
const MAX_ATTEMPTS = 5;
const RETRY_BACKOFF_MS = [5000, 15000, 30000, 60000];
const QUERY_FETCH_MAX_ATTEMPTS = 3;
const QUERY_FETCH_BACKOFF_MS = [3000, 5000];

type PreparedGrokImage = {
  payload: string;
  mimeType: string;
  mode: "images.base64";
};

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const log = (stage: string, payload: Record<string, unknown>) => {
  console.log(`[GROK_VIDEO][${stage}]`, JSON.stringify(payload));
};

const getBaseUrl = () => (process.env.YUNWU_GROK_VIDEO_BASE_URL || "https://yunwu.ai").replace(/\/$/, "");
const getModel = () => process.env.YUNWU_GROK_VIDEO_MODEL || "grok-video-3-10s";

const getApiKey = () => {
  const key = process.env.YUNWU_GROK_VIDEO_API_KEY;
  if (!key) {
    throw new Error("缺少 YUNWU_GROK_VIDEO_API_KEY，请在服务端环境变量配置 Grok 视频 API Key。");
  }
  return key;
};

const safeResponsePreview = (value: unknown) => {
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  return {
    id: source.id,
    status: source.status,
    type: source.type,
    model: source.model,
    progress: source.progress,
    hasVideoUrl: typeof source.video_url === "string" && source.video_url.length > 0,
    hasThumbnailUrl: typeof source.thumbnail_url === "string" && source.thumbnail_url.length > 0,
    error: source.error,
    status_update_time: source.status_update_time,
  };
};

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

const buildHeaders = () => ({
  Authorization: `Bearer ${getApiKey()}`,
  "Content-Type": "application/json",
  Accept: "application/json",
});

const normalizeStatus = (value: unknown): GrokTaskStatus => {
  const status = String(value || "").toLowerCase();
  if (["succeeded", "success", "completed", "complete", "done"].includes(status)) return "succeeded";
  if (["pending", "queued", "queue", "created"].includes(status)) return "pending";
  if (["running", "processing", "generating", "in_progress"].includes(status)) return "processing";
  if (["failed", "failure", "error"].includes(status)) return "failed";
  if (["cancelled", "canceled"].includes(status)) return "cancelled";
  if (status === "timeout") return "timeout";
  return "unknown";
};

const extractTaskId = (json: Record<string, unknown> | null) => {
  const candidates = [json?.id, json?.task_id, json?.taskId, (json?.data as Record<string, unknown> | undefined)?.id, (json?.data as Record<string, unknown> | undefined)?.task_id];
  const found = candidates.find((value) => typeof value === "string" && value.trim().length > 0);
  return typeof found === "string" ? found : "";
};

const extractVideoUrl = (json: Record<string, unknown> | null) => {
  const data = json?.data && typeof json.data === "object" ? (json.data as Record<string, unknown>) : undefined;
  const output = json?.output && typeof json.output === "object" ? (json.output as Record<string, unknown>) : undefined;
  const candidates = [
    json?.video_url,
    json?.url,
    json?.content_url,
    json?.videoUrl,
    data?.video_url,
    data?.url,
    data?.content_url,
    output?.video_url,
    output?.url,
    Array.isArray(json?.videos) ? json?.videos[0] : undefined,
  ];
  const found = candidates.find((value) => typeof value === "string" && /^https?:\/\//i.test(value));
  return typeof found === "string" ? found : "";
};

const extractCoverUrl = (json: Record<string, unknown> | null) => {
  const data = json?.data && typeof json.data === "object" ? (json.data as Record<string, unknown>) : undefined;
  const candidates = [json?.thumbnail_url, json?.cover_url, json?.coverUrl, data?.thumbnail_url, data?.cover_url];
  const found = candidates.find((value) => typeof value === "string" && /^https?:\/\//i.test(value));
  return typeof found === "string" ? found : "";
};

const extractErrorMessage = (json: Record<string, unknown> | null, fallback = "") => {
  const data = json?.data && typeof json.data === "object" ? (json.data as Record<string, unknown>) : undefined;
  const value = json?.error || json?.message || data?.error || data?.message || fallback;
  return typeof value === "string" ? value : fallback;
};

const isNonRetryableError = (message: string) => {
  const text = message.toLowerCase();
  return (
    text.includes("yunwu_grok_video_api_key") ||
    text.includes("api key") ||
    text.includes("401") ||
    text.includes("403") ||
    text.includes("unauthorized") ||
    text.includes("forbidden") ||
    text.includes("invalid parameter") ||
    text.includes("参数错误") ||
    text.includes("参数无效") ||
    text.includes("failed to decode base64 image") ||
    text.includes("illegal base64 data") ||
    text.includes("invalid image base64") ||
    text.includes("image decode failed")
  );
};

const isRetryableError = (message: string) => !isNonRetryableError(message);

const isQueryFetchRetryableError = (message: string) => {
  const text = message.toLowerCase();
  return (
    text.includes("fetch failed") ||
    text.includes("network") ||
    text.includes("timeout") ||
    text.includes("aborterror") ||
    text.includes("status=429") ||
    /status=5\d\d/.test(text)
  );
};

const mimeFromPathOrUrl = (value: string) => {
  const ext = (() => {
    try {
      return path.extname(new URL(value).pathname).toLowerCase();
    } catch {
      return path.extname(value).toLowerCase();
    }
  })();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
};

const stripDataUrl = (value: string) => {
  const match = /^data:([^;,]+);base64,([\s\S]+)$/i.exec(value.trim());
  if (!match) return null;
  return {
    mimeType: match[1].toLowerCase(),
    base64: match[2].replace(/\s+/g, ""),
  };
};

const assertBase64Image = (value: string) => {
  if (!value || /[^a-zA-Z0-9+/=]/.test(value) || value.length % 4 === 1) {
    throw new Error("invalid image base64");
  }
};

async function prepareGrokReferenceImages(images?: string[]): Promise<PreparedGrokImage[]> {
  const sourceImages = (images || []).filter((item) => typeof item === "string" && item.trim().length > 0);
  const prepared: PreparedGrokImage[] = [];
  for (const source of sourceImages) {
    const trimmed = source.trim();
    try {
      const dataUrl = stripDataUrl(trimmed);
      if (dataUrl) {
        assertBase64Image(dataUrl.base64);
        prepared.push({ payload: dataUrl.base64, mimeType: dataUrl.mimeType, mode: "images.base64" });
        continue;
      }

      const localSource = await resolveLocalUploadsSource(trimmed);
      if (localSource) {
        if (!localSource.exists) {
          throw new Error("本地参考图文件不存在");
        }
        const bytes = await readFile(localSource.resolvedPath);
        prepared.push({ payload: bytes.toString("base64"), mimeType: mimeFromPathOrUrl(localSource.resolvedPath), mode: "images.base64" });
        continue;
      }

      if (/^https?:\/\//i.test(trimmed)) {
        const response = await fetch(trimmed);
        if (!response.ok) {
          throw new Error(`公网参考图下载失败 status=${response.status}`);
        }
        const bytes = Buffer.from(await response.arrayBuffer());
        prepared.push({
          payload: bytes.toString("base64"),
          mimeType: response.headers.get("content-type")?.split(";")[0]?.trim() || mimeFromPathOrUrl(trimmed),
          mode: "images.base64",
        });
        continue;
      }

      const rawBase64 = trimmed.replace(/\s+/g, "");
      assertBase64Image(rawBase64);
      prepared.push({ payload: rawBase64, mimeType: "image/jpeg", mode: "images.base64" });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Grok 参考图读取失败：${reason}`);
    }
  }
  return prepared;
}

export async function createGrokVideoTask(params: { prompt: string; ratio: string; images?: PreparedGrokImage[]; attempt?: number }) {
  const model = getModel();
  const images = params.images?.map((item) => item.payload) ?? [];
  const payload = {
    model,
    prompt: `${params.prompt.trim()} --mode=custom`,
    aspect_ratio: params.ratio === "9:16" ? "9:16" : "16:9",
    size: "720P",
    images,
  };
  log("CREATE_REQUEST", {
    attempt: params.attempt ?? 1,
    endpoint: CREATE_PATH,
    model,
    ratio: payload.aspect_ratio,
    size: payload.size,
    hasReferenceImage: payload.images.length > 0,
    referenceImageMode: payload.images.length > 0 ? "images.base64" : "none",
    imagesCount: payload.images.length,
    imagePayloadPreviewLength: payload.images[0]?.length ?? 0,
    mimeType: params.images?.[0]?.mimeType || "",
  });
  const response = await fetch(`${getBaseUrl()}${CREATE_PATH}`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify(payload),
  });
  const parsed = await parseJsonResponse(response);
  log("CREATE_RESPONSE", { attempt: params.attempt ?? 1, status: parsed.status, ok: parsed.ok, response: safeResponsePreview(parsed.json) });
  if (!parsed.ok) {
    throw new Error(`Grok 创建视频失败 status=${parsed.status} ${extractErrorMessage(parsed.json, parsed.rawText.slice(0, 120))}`);
  }
  const taskId = extractTaskId(parsed.json);
  if (!taskId) throw new Error("Grok 创建视频失败：未返回 task id");
  return { taskId, raw: parsed.json };
}

export async function queryGrokVideoTask(taskId: string): Promise<GrokTaskQueryResult> {
  log("QUERY_REQUEST", { endpoint: QUERY_PATH, taskId });
  const response = await fetch(`${getBaseUrl()}${QUERY_PATH}?id=${encodeURIComponent(taskId)}`, {
    method: "GET",
    headers: buildHeaders(),
  });
  const parsed = await parseJsonResponse(response);
  log("QUERY_RESPONSE", { status: parsed.status, ok: parsed.ok, taskId, response: safeResponsePreview(parsed.json) });
  if (!parsed.ok) {
    throw new Error(`Grok 查询任务失败 status=${parsed.status} ${extractErrorMessage(parsed.json, parsed.rawText.slice(0, 120))}`);
  }
  const rawStatus = String(parsed.json?.status || "");
  return {
    taskId: extractTaskId(parsed.json) || taskId,
    status: normalizeStatus(rawStatus),
    rawStatus,
    videoUrl: extractVideoUrl(parsed.json),
    coverUrl: extractCoverUrl(parsed.json),
    errorMessage: extractErrorMessage(parsed.json, ""),
    raw: parsed.json ?? undefined,
  };
}

export async function extendGrokVideoTask(params: { prompt: string; taskId: string; ratio: string; startTime: number; attempt?: number }) {
  const model = getModel();
  const payload = {
    model,
    prompt: params.prompt.trim(),
    task_id: params.taskId,
    aspect_ratio: params.ratio === "9:16" ? "9:16" : "16:9",
    size: "720P",
    start_time: params.startTime,
    upscale: false,
  };
  log("EXTEND_REQUEST", { attempt: params.attempt ?? 1, endpoint: EXTEND_PATH, model, taskId: params.taskId, ratio: payload.aspect_ratio, startTime: payload.start_time });
  const response = await fetch(`${getBaseUrl()}${EXTEND_PATH}`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify(payload),
  });
  const parsed = await parseJsonResponse(response);
  log("EXTEND_RESPONSE", { attempt: params.attempt ?? 1, status: parsed.status, ok: parsed.ok, response: safeResponsePreview(parsed.json) });
  if (!parsed.ok) {
    throw new Error(`Grok 扩展视频失败 status=${parsed.status} ${extractErrorMessage(parsed.json, parsed.rawText.slice(0, 120))}`);
  }
  const taskId = extractTaskId(parsed.json);
  if (!taskId) throw new Error("Grok 扩展视频失败：未返回 task id");
  return { taskId, raw: parsed.json };
}

async function queryGrokVideoTaskWithFetchRetry(taskId: string) {
  for (let attempt = 1; attempt <= QUERY_FETCH_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await queryGrokVideoTask(taskId);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (!isQueryFetchRetryableError(reason) || attempt === QUERY_FETCH_MAX_ATTEMPTS) {
        throw new Error(reason);
      }
      const delayMs = QUERY_FETCH_BACKOFF_MS[attempt - 1] ?? QUERY_FETCH_BACKOFF_MS[QUERY_FETCH_BACKOFF_MS.length - 1];
      log("QUERY_RETRY", { taskId, attempt, maxAttempts: QUERY_FETCH_MAX_ATTEMPTS, delayMs, reason });
      await delay(delayMs);
    }
  }
  throw new Error(`Grok 查询任务失败，taskId=${taskId}`);
}

async function waitForGrokTask(taskId: string): Promise<GrokTaskQueryResult> {
  const pollIntervalMs = Math.max(1000, Number(process.env.YUNWU_GROK_VIDEO_POLL_INTERVAL_MS || 5000));
  const maxPoll = Math.max(1, Number(process.env.YUNWU_GROK_VIDEO_POLL_MAX_ATTEMPTS || 120));
  for (let pollCount = 1; pollCount <= maxPoll; pollCount += 1) {
    const result = await queryGrokVideoTaskWithFetchRetry(taskId);
    if (result.status === "succeeded") {
      if (result.videoUrl) return result;
      throw new Error(`Grok 任务已完成但未返回 video_url，taskId=${taskId}`);
    }
    if (result.status === "failed" || result.status === "cancelled" || result.status === "timeout") {
      throw new Error(result.errorMessage || `Grok 任务失败，status=${result.rawStatus || result.status}`);
    }
    if (result.status === "unknown") {
      log("QUERY_RESPONSE", { taskId, pollCount, unknownStatus: result.rawStatus, decision: "continue_polling" });
    }
    await delay(pollIntervalMs);
  }
  throw new Error(`Grok 任务查询超时，taskId=${taskId}`);
}

async function runStepWithRetry(params: {
  stage: "create" | "extend";
  prompt: string;
  ratio: string;
  previousTaskId?: string;
  startTime: number;
  images?: PreparedGrokImage[];
}) {
  let lastTaskId = "";
  let lastError = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const created =
        params.stage === "create"
          ? await createGrokVideoTask({ prompt: params.prompt, ratio: params.ratio, images: params.images, attempt })
          : await extendGrokVideoTask({
              prompt: params.prompt,
              ratio: params.ratio,
              taskId: params.previousTaskId || "",
              startTime: params.startTime,
              attempt,
            });
      lastTaskId = created.taskId;
      const result = await waitForGrokTask(created.taskId);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastError = message;
      if (isNonRetryableError(message) || !isRetryableError(message) || attempt === MAX_ATTEMPTS) {
        log("FINAL_FAILED", { stage: params.stage, attempts: attempt, finalReason: message, lastTaskId });
        throw new Error(message);
      }
      const delayMs = RETRY_BACKOFF_MS[attempt - 1] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1];
      log("RETRY", { stage: params.stage, attempt, maxAttempts: MAX_ATTEMPTS, delayMs, reason: message, taskId: lastTaskId, retryable: true });
      await delay(delayMs);
    }
  }
  throw new Error(lastError || "Grok 视频生成失败");
}

export async function runGrokVideoWithExtensions(params: {
  basePrompt: string;
  extensionPrompts: string[];
  ratio: string;
  targetDurationSeconds: number;
  referenceImages?: string[];
}): Promise<GrokVideoResult> {
  const providerTaskIds: string[] = [];
  const segmentVideoUrls: string[] = [];
  let successfulUnits = 0;
  try {
    const baseImages = await prepareGrokReferenceImages(params.referenceImages);
    const baseResult = await runStepWithRetry({
      stage: "create",
      prompt: params.basePrompt,
      ratio: params.ratio,
      images: baseImages,
      startTime: 0,
    });
    providerTaskIds.push(baseResult.taskId);
    if (baseResult.videoUrl) segmentVideoUrls.push(baseResult.videoUrl);
    successfulUnits += 1;

    let previousTaskId = baseResult.taskId;
    let finalResult = baseResult;
    for (let index = 0; index < params.extensionPrompts.length; index += 1) {
      const extensionResult = await runStepWithRetry({
        stage: "extend",
        prompt: params.extensionPrompts[index],
        ratio: params.ratio,
        previousTaskId,
        startTime: (index + 1) * GROK_UNIT_SECONDS,
      });
      providerTaskIds.push(extensionResult.taskId);
      if (extensionResult.videoUrl) segmentVideoUrls.push(extensionResult.videoUrl);
      successfulUnits += 1;
      previousTaskId = extensionResult.taskId;
      finalResult = extensionResult;
    }

    const finalVideoUrl = finalResult.videoUrl || segmentVideoUrls[segmentVideoUrls.length - 1] || "";
    const isFinalVideoLikelyComplete = params.extensionPrompts.length === 0 ? true : undefined;
    log("FINAL_SUCCESS", {
      providerTaskIdsCount: providerTaskIds.length,
      finalTaskId: finalResult.taskId,
      finalVideoUrl: Boolean(finalVideoUrl),
      segmentVideoUrlsCount: segmentVideoUrls.length,
      targetDurationSeconds: params.targetDurationSeconds,
      successfulUnits,
      isFinalVideoLikelyComplete: isFinalVideoLikelyComplete ?? "unknown",
    });
    return {
      ok: Boolean(finalVideoUrl),
      providerTaskIds,
      finalTaskId: finalResult.taskId,
      finalVideoUrl,
      segmentVideoUrls,
      isFinalVideoLikelyComplete,
      durationSeconds: params.targetDurationSeconds,
      successfulUnits,
      error: finalVideoUrl ? undefined : "Grok 任务完成但没有可用视频地址",
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
      providerTaskIds,
      finalTaskId: providerTaskIds[providerTaskIds.length - 1],
      finalVideoUrl: segmentVideoUrls[segmentVideoUrls.length - 1],
      segmentVideoUrls,
      isFinalVideoLikelyComplete: false,
      durationSeconds: params.targetDurationSeconds,
      successfulUnits,
      error: message,
    };
  }
}

export async function runGrokVideoSegments(params: {
  prompts: string[];
  ratio: string;
  targetDurationSeconds: number;
  getReferenceImagesForSegment?: (segmentIndex: number, previousVideoUrl?: string) => Promise<string[] | undefined>;
}): Promise<GrokVideoResult> {
  const providerTaskIds: string[] = [];
  const segmentVideoUrls: string[] = [];
  let successfulUnits = 0;
  try {
    let previousVideoUrl = "";
    for (let index = 0; index < params.prompts.length; index += 1) {
      log("STITCH_SEGMENT_START", { segmentIndex: index + 1, totalSegments: params.prompts.length, hasPreviousVideo: Boolean(previousVideoUrl) });
      const imageSources = await params.getReferenceImagesForSegment?.(index + 1, previousVideoUrl);
      const images = await prepareGrokReferenceImages(imageSources);
      const result = await runStepWithRetry({
        stage: "create",
        prompt: params.prompts[index],
        ratio: params.ratio,
        images,
        startTime: 0,
      });
      providerTaskIds.push(result.taskId);
      if (result.videoUrl) segmentVideoUrls.push(result.videoUrl);
      previousVideoUrl = result.videoUrl || "";
      successfulUnits += 1;
      log("STITCH_SEGMENT_SUCCESS", { segmentIndex: index + 1, taskId: result.taskId, hasVideoUrl: Boolean(result.videoUrl), imagesCount: images.length });
    }
    const finalVideoUrl = segmentVideoUrls[segmentVideoUrls.length - 1] || "";
    log("FINAL_SUCCESS", {
      providerTaskIdsCount: providerTaskIds.length,
      finalTaskId: providerTaskIds[providerTaskIds.length - 1],
      finalVideoUrl: Boolean(finalVideoUrl),
      segmentVideoUrlsCount: segmentVideoUrls.length,
      targetDurationSeconds: params.targetDurationSeconds,
      successfulUnits,
      isFinalVideoLikelyComplete: "segmented",
    });
    return {
      ok: Boolean(finalVideoUrl),
      providerTaskIds,
      finalTaskId: providerTaskIds[providerTaskIds.length - 1],
      finalVideoUrl,
      segmentVideoUrls,
      isFinalVideoLikelyComplete: false,
      durationSeconds: params.targetDurationSeconds,
      successfulUnits,
      error: finalVideoUrl ? undefined : "Grok 分段生成完成但没有可用视频地址",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("FINAL_FAILED", {
      stage: "stitch",
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
      providerTaskIds,
      finalTaskId: providerTaskIds[providerTaskIds.length - 1],
      finalVideoUrl: segmentVideoUrls[segmentVideoUrls.length - 1],
      segmentVideoUrls,
      isFinalVideoLikelyComplete: false,
      durationSeconds: params.targetDurationSeconds,
      successfulUnits,
      error: message,
    };
  }
}
