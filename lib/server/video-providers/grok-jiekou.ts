import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveLocalUploadsSource } from "../local-uploads";
import { extractTailReferenceFrameForContinuation } from "../medium-video-frame";
import { GrokVideoResult, GrokVideoSegmentsInput, GrokVideoWithExtensionsInput } from "./types";

type JiekouTaskStatus = "processing" | "success" | "failed" | "unknown";
type PreparedJiekouImage = {
  payload: string;
  mode: "data_url" | "public_url";
};

const PROVIDER_SOURCE = "jiekou";
const T2V_PATH = "/v3/async/grok-imagine-video-t2v";
const I2V_PATH = "/v3/async/grok-imagine-video-i2v";
const QUERY_PATH = "/v3/async/task-result";
const JIEKOU_UNIT_SECONDS = 10;
const MAX_ATTEMPTS = 5;
const RETRY_BACKOFF_MS = [5000, 15000, 30000, 60000];
const QUERY_FETCH_MAX_ATTEMPTS = 3;
const QUERY_FETCH_BACKOFF_MS = [3000, 5000];

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const log = (stage: string, payload: Record<string, unknown>) => {
  console.log(`[JIEKOU_GROK][${stage}]`, JSON.stringify({ providerSource: PROVIDER_SOURCE, ...payload }));
};

const getBaseUrl = () => (process.env.JIEKOU_GROK_VIDEO_BASE_URL || "https://api.highwayapi.ai").replace(/\/$/, "");

const getApiKey = () => {
  const key = process.env.JIEKOU_GROK_VIDEO_API_KEY;
  if (!key) {
    throw new Error("缺少 JIEKOU_GROK_VIDEO_API_KEY，请在服务端环境变量配置接口AI Grok API Key。");
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
  const task = source.task && typeof source.task === "object" ? (source.task as Record<string, unknown>) : undefined;
  const videos = Array.isArray(source.videos) ? source.videos : undefined;
  const firstVideo = videos?.[0] && typeof videos[0] === "object" ? (videos[0] as Record<string, unknown>) : undefined;
  return {
    task_id: source.task_id || task?.task_id,
    status: source.status || task?.status,
    reason: source.reason || task?.reason,
    videosCount: videos?.length ?? 0,
    hasVideoUrl: typeof firstVideo?.video_url === "string" && firstVideo.video_url.length > 0,
  };
};

const extractTaskId = (json: Record<string, unknown> | null) => {
  const task = json?.task && typeof json.task === "object" ? (json.task as Record<string, unknown>) : undefined;
  const candidates = [json?.task_id, json?.taskId, json?.id, task?.task_id];
  const found = candidates.find((value) => typeof value === "string" && value.trim().length > 0);
  return typeof found === "string" ? found : "";
};

const extractReason = (json: Record<string, unknown> | null, fallback = "") => {
  const task = json?.task && typeof json.task === "object" ? (json.task as Record<string, unknown>) : undefined;
  const value = task?.reason || json?.reason || json?.message || json?.error || fallback;
  return typeof value === "string" ? value : fallback;
};

const normalizeStatus = (value: unknown): JiekouTaskStatus => {
  const status = String(value || "").toUpperCase();
  if (status === "TASK_STATUS_QUEUED" || status === "TASK_STATUS_PROCESSING") return "processing";
  if (status === "TASK_STATUS_SUCCEED") return "success";
  if (status === "TASK_STATUS_FAILED") return "failed";
  return "unknown";
};

const extractVideoUrl = (json: Record<string, unknown> | null) => {
  const videos = Array.isArray(json?.videos) ? json?.videos : [];
  const firstVideo = videos[0] && typeof videos[0] === "object" ? (videos[0] as Record<string, unknown>) : undefined;
  const found = firstVideo?.video_url;
  return typeof found === "string" && /^https?:\/\//i.test(found) ? found : "";
};

const isNonRetryableError = (message: string) => {
  const text = message.toLowerCase();
  return (
    text.includes("jiekou_grok_video_api_key") ||
    text.includes("api key") ||
    text.includes("401") ||
    text.includes("403") ||
    text.includes("invalid_api_key") ||
    text.includes("unauthorized") ||
    text.includes("forbidden") ||
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
      text.includes("fetch failed") ||
      text.includes("timeout") ||
      text.includes("network") ||
      text.includes("上游负载") ||
      text.includes("任务失败") ||
      text.includes("videos 为空") ||
      text.includes("video_url 为空") ||
      text.includes("video_url") ||
      text.includes("未返回可用视频地址"))
  );
};

const isQueryFetchRetryableError = (message: string) => {
  const text = message.toLowerCase();
  return text.includes("fetch failed") || text.includes("network") || text.includes("timeout") || text.includes("aborterror") || text.includes("status=429") || /status=5\d\d/.test(text);
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

async function prepareJiekouReferenceImage(source?: string): Promise<PreparedJiekouImage | undefined> {
  const trimmed = source?.trim();
  if (!trimmed) return undefined;
  if (/^data:image\/[^;,]+;base64,[\s\S]+$/i.test(trimmed)) {
    return { payload: trimmed, mode: "data_url" };
  }
  const localSource = await resolveLocalUploadsSource(trimmed);
  if (localSource) {
    if (!localSource.exists) {
      throw new Error("接口AI Grok 图片读取失败：本地参考图文件不存在");
    }
    const bytes = await readFile(localSource.resolvedPath);
    const mimeType = mimeFromPathOrUrl(localSource.resolvedPath);
    return { payload: `data:${mimeType};base64,${bytes.toString("base64")}`, mode: "data_url" };
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return { payload: trimmed, mode: "public_url" };
  }
  throw new Error("接口AI Grok 图片读取失败：参考图必须是公网 URL、data URL 或本地上传文件");
}

export async function createJiekouGrokVideoTask(params: { prompt: string; ratio: string; referenceImage?: string; attempt?: number }) {
  const preparedImage = await prepareJiekouReferenceImage(params.referenceImage);
  const mode = preparedImage ? "image-to-video" : "text-to-video";
  const endpoint = preparedImage ? I2V_PATH : T2V_PATH;
  const aspectRatio = params.ratio === "9:16" ? "9:16" : params.ratio === "1:1" ? "1:1" : "16:9";
  const payload = preparedImage
    ? {
        image: preparedImage.payload,
        prompt: params.prompt.trim(),
        duration: JIEKOU_UNIT_SECONDS,
        resolution: "720p",
      }
    : {
        prompt: params.prompt.trim(),
        duration: JIEKOU_UNIT_SECONDS,
        resolution: "720p",
        aspect_ratio: aspectRatio,
      };
  log("CREATE_REQUEST", {
    attempt: params.attempt ?? 1,
    endpoint,
    mode,
    duration: JIEKOU_UNIT_SECONDS,
    resolution: "720p",
    aspectRatio,
    hasReferenceImage: Boolean(preparedImage),
    imageMode: preparedImage?.mode || "none",
    promptPreview: params.prompt.slice(0, 120),
  });
  const response = await fetch(`${getBaseUrl()}${endpoint}`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify(payload),
  });
  const parsed = await parseJsonResponse(response);
  const taskId = extractTaskId(parsed.json);
  log("CREATE_RESPONSE", { ok: parsed.ok, status: parsed.status, taskId, rawPreview: safeRawPreview(parsed.json) });
  if (!parsed.ok) {
    throw new Error(`接口AI Grok 创建视频失败 status=${parsed.status} ${extractReason(parsed.json, parsed.rawText.slice(0, 120))}`);
  }
  if (!taskId) throw new Error("接口AI Grok 创建视频失败：未返回 task_id");
  return { taskId, raw: parsed.json };
}

export async function queryJiekouGrokVideoTask(taskId: string) {
  log("QUERY_REQUEST", { taskId });
  const response = await fetch(`${getBaseUrl()}${QUERY_PATH}?task_id=${encodeURIComponent(taskId)}`, {
    method: "GET",
    headers: buildHeaders(),
  });
  const parsed = await parseJsonResponse(response);
  const task = parsed.json?.task && typeof parsed.json.task === "object" ? (parsed.json.task as Record<string, unknown>) : undefined;
  const rawStatus = String(task?.status || parsed.json?.status || "");
  const mappedStatus = normalizeStatus(rawStatus);
  const videoUrl = extractVideoUrl(parsed.json);
  const reason = extractReason(parsed.json, "");
  log("QUERY_RESPONSE", {
    taskId,
    status: rawStatus,
    mappedStatus,
    hasVideoUrl: Boolean(videoUrl),
    videoUrlPreview: videoUrl ? videoUrl.slice(0, 140) : "",
    reason,
  });
  if (!parsed.ok) {
    throw new Error(`接口AI Grok 查询任务失败 status=${parsed.status} ${extractReason(parsed.json, parsed.rawText.slice(0, 120))}`);
  }
  return {
    taskId: extractTaskId(parsed.json) || taskId,
    status: mappedStatus,
    rawStatus,
    videoUrl,
    reason,
    raw: parsed.json ?? undefined,
  };
}

async function queryJiekouGrokVideoTaskWithFetchRetry(taskId: string) {
  for (let attempt = 1; attempt <= QUERY_FETCH_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await queryJiekouGrokVideoTask(taskId);
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
  throw new Error(`接口AI Grok 查询任务失败，taskId=${taskId}`);
}

async function waitForJiekouTask(taskId: string) {
  const pollIntervalMs = Math.max(1000, Number(process.env.JIEKOU_GROK_VIDEO_POLL_INTERVAL_MS || 5000));
  const maxPoll = Math.max(1, Number(process.env.JIEKOU_GROK_VIDEO_POLL_MAX_ATTEMPTS || 120));
  for (let pollCount = 1; pollCount <= maxPoll; pollCount += 1) {
    const result = await queryJiekouGrokVideoTaskWithFetchRetry(taskId);
    if (result.status === "success") {
      if (result.videoUrl) return result;
      throw new Error(`接口AI Grok 任务成功但 video_url 为空，videos 为空或 video_url 为空，taskId=${taskId}`);
    }
    if (result.status === "failed") {
      throw new Error(result.reason || "接口AI Grok 任务失败");
    }
    if (result.status === "unknown") {
      log("QUERY_RESPONSE", { taskId, pollCount, rawStatus: result.rawStatus, decision: "continue_polling" });
    }
    await delay(pollIntervalMs);
  }
  throw new Error(`接口AI Grok 任务查询超时，taskId=${taskId}`);
}

async function runCreateWithRetry(params: { prompt: string; ratio: string; referenceImage?: string }) {
  let lastTaskId = "";
  let lastError = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const created = await createJiekouGrokVideoTask({ ...params, attempt });
      lastTaskId = created.taskId;
      return await waitForJiekouTask(created.taskId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastError = message;
      if (isNonRetryableError(message) || (!isRetryableError(message) && attempt > 1) || attempt === MAX_ATTEMPTS) {
        log("FINAL_FAILED", { stage: "create", attempts: attempt, finalReason: message, lastTaskId });
        throw new Error(message);
      }
      const delayMs = RETRY_BACKOFF_MS[attempt - 1] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1];
      log("RETRY", { stage: "create", attempt, maxAttempts: MAX_ATTEMPTS, delayMs, reason: message, taskId: lastTaskId, retryable: true });
      await delay(delayMs);
    }
  }
  throw new Error(lastError || "接口AI Grok 视频生成失败");
}

async function runJiekouSegments(params: {
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
          taskId: params.taskId || `jiekou-grok-${Date.now()}`,
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
      providerTaskIds.push(result.taskId);
      if (result.videoUrl) segmentVideoUrls.push(result.videoUrl);
      previousVideoUrl = result.videoUrl || "";
      successfulUnits += 1;
      log("STITCH_SEGMENT_SUCCESS", { segmentIndex, totalSegments: params.prompts.length, taskId: result.taskId, hasVideoUrl: Boolean(result.videoUrl), hasReferenceImage: Boolean(referenceImages?.[0]) });
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
      error: finalVideoUrl ? undefined : "接口AI Grok 分段生成完成但没有可用视频地址",
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

export async function runJiekouGrokVideoWithExtensions(params: GrokVideoWithExtensionsInput): Promise<GrokVideoResult> {
  return runJiekouSegments({
    prompts: [params.basePrompt, ...params.extensionPrompts],
    ratio: params.ratio,
    targetDurationSeconds: params.targetDurationSeconds,
    initialReferenceImages: params.referenceImages,
    taskId: params.taskId,
  });
}

export async function runJiekouGrokVideoSegments(params: GrokVideoSegmentsInput): Promise<GrokVideoResult> {
  return runJiekouSegments({
    prompts: params.prompts,
    ratio: params.ratio,
    targetDurationSeconds: params.targetDurationSeconds,
    taskId: params.taskId,
    getReferenceImagesForSegment: params.getReferenceImagesForSegment,
  });
}
