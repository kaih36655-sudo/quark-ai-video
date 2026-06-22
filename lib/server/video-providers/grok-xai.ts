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
const XAI_TEXT_PROMPT_MAX_BYTES = 3000;
const XAI_IMAGE_PROMPT_MAX_BYTES = 2400;
const XAI_PROMPT_LENGTH_ERROR_MESSAGE = "xAI Grok 提示词过长，已超过官方限制，请缩短智能体提示词或用户主题。";

type XaiPromptMode = "text-to-video" | "image-to-video" | "extension";
type XaiPromptContext = {
  taskId?: string;
  sourcePrompt?: string;
  segmentIndex?: number;
  totalSegments?: number;
};

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

const getPromptBytes = (value: string) => Buffer.byteLength(value, "utf8");
const normalizePromptText = (value: string) => value.replace(/\r/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
const getXaiPromptMaxBytes = (mode: XaiPromptMode) => {
  const configured = Number(process.env.XAI_GROK_PROMPT_MAX_BYTES || "");
  if (Number.isFinite(configured) && configured >= 800) return Math.floor(configured);
  return mode === "image-to-video" ? XAI_IMAGE_PROMPT_MAX_BYTES : XAI_TEXT_PROMPT_MAX_BYTES;
};

const truncateUtf8 = (value: string, maxBytes: number) => {
  let usedBytes = 0;
  let output = "";
  for (const char of Array.from(value)) {
    const charBytes = getPromptBytes(char);
    if (usedBytes + charBytes > maxBytes) break;
    output += char;
    usedBytes += charBytes;
  }
  return output.trim();
};

const promptPreview = (value: string, maxChars = 300) => value.replace(/\s+/g, " ").slice(0, maxChars);

const resolveUserTheme = (prompt: string, sourcePrompt?: string) => {
  const source = normalizePromptText(sourcePrompt || "");
  if (source) return source;
  return normalizePromptText(prompt || "");
};

const buildXaiPromptForSegment = (prompt: string, mode: XaiPromptMode, context: XaiPromptContext = {}) => {
  const segmentIndex = context.segmentIndex ?? 1;
  const totalSegments = Math.max(1, context.totalSegments ?? 1);
  const userTheme = resolveUserTheme(prompt, context.sourcePrompt);
  if (!userTheme) {
    throw new Error("缺少视频主题，请输入生成内容。");
  }
  const compactTheme = truncateUtf8(userTheme, 520);
  const segmentRange = `${(segmentIndex - 1) * XAI_UNIT_SECONDS}-${segmentIndex * XAI_UNIT_SECONDS}s`;
  const continuity =
    segmentIndex <= 1
      ? "第1段必须围绕用户主题建立主体、场景和核心动作，不能使用默认示例主题。"
      : "承接上一段最后一帧，0.0秒立即继续动作，不重新介绍人物/场景/卖点，不重复上一段动作和文案。";
  const endingRule =
    totalSegments > 1 && segmentIndex < totalSegments
      ? "本段只推进完整故事的当前部分，结尾保留连续动作或未完成信息给下一段。"
      : "如果这是最后一段，才允许自然总结或行动引导。";
  return normalizePromptText(`用户主题：${compactTheme}
全片主题：${compactTheme}
本段必须围绕该主题生成，不能替换成其他主题，不能使用默认示例主题。
当前段：第 ${segmentIndex}/${totalSegments} 段，时间范围 ${segmentRange}，模式 ${mode}。
当前段任务：只推进完整故事的第 ${segmentIndex} 部分，不要把本段写成另一条独立短视频。
连续性要求：${continuity} ${endingRule}

当前段提示：
${prompt}

基础约束：真实连续视频镜头，主体、场景、动作和口播必须服务用户主题；无字幕、水印、Logo。`);
};

const uniquePromptLines = (value: string) => {
  const seen = new Set<string>();
  return value
    .replace(/([。！？；!?;])\s*/g, "$1\n")
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

export function compactPromptForXai(prompt: string, mode: XaiPromptMode, context: XaiPromptContext = {}, maxBytes = getXaiPromptMaxBytes(mode)): string {
  const userTheme = resolveUserTheme(prompt, context.sourcePrompt);
  const userThemeBytes = getPromptBytes(userTheme);
  const hasUserTheme = userThemeBytes > 0;
  const normalized = buildXaiPromptForSegment(prompt, mode, context);
  const originalChars = normalized.length;
  const originalBytes = getPromptBytes(normalized);
  const segmentIndex = context.segmentIndex ?? 1;
  const totalSegments = Math.max(1, context.totalSegments ?? 1);
  const criticalTail = [
    "No subtitles, no watermark, no logo.",
    "If image is provided, it is the previous segment's last usable non-black frame.",
    "Continue from previous frame at 0.0s with immediate motion. Do not repeat, restart, or return to an earlier state.",
  ].join(" ");
  const themeAnchor = normalizePromptText(`用户主题：${truncateUtf8(userTheme, 520)}
全片主题：${truncateUtf8(userTheme, 520)}
本段必须围绕该主题生成，不能替换成其他主题，不能使用默认示例主题。`);

  if (originalBytes <= maxBytes) {
    log("PROMPT_COMPACTED", {
      mode,
      segmentIndex,
      totalSegments,
      originalChars,
      originalBytes,
      finalChars: originalChars,
      finalBytes: originalBytes,
      maxBytes,
      wasCompacted: false,
      userThemeBytes,
      hasUserTheme,
      userThemePreview: promptPreview(userTheme, 160),
    });
    return normalized;
  }

  const lines = uniquePromptLines(normalized)
    .filter((line) => !/^全片主题[:：]/.test(line))
    .filter((line) => !/^用户主题[:：]/.test(line))
    .filter((line) => !/示例主题|placeholder|sample|demo|默认视频主题/i.test(line));
  const priorityLines = pickPromptLines(
    lines,
    [
      /第\s*\d+\s*\/\s*\d+\s*段|segment\s*\d+|segmentPlan\[\d+\]|完整脚本\s*\d+\s*-\s*\d+s|当前段|本段|0-10|10-20|20-30|30-40|40-50|50-60/i,
      /主题|主体|场景|画面|动作|镜头|口播|对白|voiceover|visual|camera|scene|subject|action/i,
      /承接|上一段|尾帧|最后可用非黑帧|继续|连续|无缝|不要重复|不要重新|immediate motion|previous frame|continue/i,
      /不要字幕|水印|logo|subtitle|watermark/i,
    ],
    Math.max(500, Math.floor(maxBytes / 2))
  );
  const fallbackHead = truncateUtf8(lines.join("\n"), Math.max(300, Math.floor(maxBytes / 2)));
  const compactedBody = normalizePromptText(priorityLines.length ? priorityLines.join("\n") : fallbackHead);
  const fixedTail = `${themeAnchor}\n\n${criticalTail}`;
  const fixedTailBytes = getPromptBytes(fixedTail) + 6;
  const bodyByteBudget = Math.max(160, maxBytes - fixedTailBytes);
  const finalBody = getPromptBytes(compactedBody) > bodyByteBudget ? truncateUtf8(compactedBody, bodyByteBudget) : compactedBody;
  let finalPrompt = normalizePromptText(`${themeAnchor}\n\n当前段精简提示：\n${finalBody}\n\n${criticalTail}`);
  if (getPromptBytes(finalPrompt) > maxBytes) {
    const hardBodyBudget = Math.max(80, maxBytes - fixedTailBytes - getPromptBytes("当前段精简提示：\n"));
    finalPrompt = normalizePromptText(`${themeAnchor}\n\n当前段精简提示：\n${truncateUtf8(finalBody, hardBodyBudget)}\n\n${criticalTail}`);
  }
  if (getPromptBytes(finalPrompt) > maxBytes) {
    const shortThemeAnchor = normalizePromptText(`用户主题：${truncateUtf8(userTheme, 360)}
本段必须围绕该主题生成，不能替换成其他主题。`);
    const shortTail = "No subtitles, no watermark, no logo. Continue from previous frame with immediate motion. Do not repeat or restart.";
    const remaining = Math.max(60, maxBytes - getPromptBytes(shortThemeAnchor) - getPromptBytes(shortTail) - 8);
    finalPrompt = normalizePromptText(`${shortThemeAnchor}\n\n${truncateUtf8(finalBody, remaining)}\n\n${shortTail}`);
  }
  if (getPromptBytes(finalPrompt) > maxBytes) {
    finalPrompt = truncateUtf8(finalPrompt, maxBytes);
  }

  log("PROMPT_COMPACTED", {
    mode,
    segmentIndex,
    totalSegments,
    originalChars,
    originalBytes,
    finalChars: finalPrompt.length,
    finalBytes: getPromptBytes(finalPrompt),
    maxBytes,
    wasCompacted: true,
    userThemeBytes,
    hasUserTheme,
    userThemePreview: promptPreview(userTheme, 160),
  });
  return finalPrompt;
}

const logPromptReady = (params: {
  taskId?: string;
  mode: XaiPromptMode;
  prompt: string;
  sourcePrompt?: string;
  segmentIndex?: number;
  totalSegments?: number;
}) => {
  const userTheme = resolveUserTheme(params.prompt, params.sourcePrompt);
  const hasUserTheme = getPromptBytes(userTheme) > 0 && params.prompt.includes(truncateUtf8(userTheme, 80));
  const payload = {
    taskId: params.taskId || "",
    mode: params.mode,
    promptBytes: getPromptBytes(params.prompt),
    promptChars: params.prompt.length,
    hasUserTheme,
    userThemePreview: promptPreview(userTheme, 160),
    promptPreview: promptPreview(params.prompt, 300),
    segmentIndex: params.segmentIndex,
    totalSegments: params.totalSegments,
  };
  log("PROMPT_READY", payload);
  if (!hasUserTheme) {
    log("PROMPT_MISSING_USER_THEME", {
      taskId: params.taskId || "",
      mode: params.mode,
      segmentIndex: params.segmentIndex,
      promptPreview: promptPreview(params.prompt, 300),
    });
  }
};

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

const isLocalDevHost = (hostname: string) => {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "0.0.0.0" || normalized === "::1" || normalized === "[::1]";
};

const isProductionUploadHost = (hostname: string) => {
  const normalized = hostname.toLowerCase();
  return normalized === "kuake888.com" || normalized === "www.kuake888.com";
};

const getConfiguredPublicSiteUrl = () => (process.env.PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");

const isPublicSiteUrlUsableForXai = (siteUrl = getConfiguredPublicSiteUrl()) => {
  if (!siteUrl) return false;
  let parsed: URL;
  try {
    parsed = new URL(siteUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (isLocalDevHost(parsed.hostname)) return false;
  if (process.env.NODE_ENV === "production") return true;

  const explicitPublicSiteUrl = process.env.PUBLIC_SITE_URL?.trim();
  if (!explicitPublicSiteUrl) return false;
  try {
    return isProductionUploadHost(new URL(explicitPublicSiteUrl).hostname);
  } catch {
    return false;
  }
};

async function readLocalUploadImageAsDataUrl(source: string, reason?: string): Promise<PreparedXaiImage> {
  const localSource = await resolveLocalUploadsSource(source);
  if (!localSource || !localSource.exists) {
    throw new Error("xAI Grok 图片读取失败：本地参考图文件不存在");
  }
  const bytes = await readFile(localSource.resolvedPath);
  const mimeType = mimeFromPathOrUrl(localSource.resolvedPath);
  if (reason) {
    log("LOCAL_UPLOAD_IMAGE_RESOLVED", {
      originalUrlPreview: source.slice(0, 140),
      imageMode: "data_url",
      reason,
    });
  }
  return { url: `data:${mimeType};base64,${bytes.toString("base64")}`, mode: "data_url" };
}

async function prepareXaiReferenceImage(source?: string): Promise<PreparedXaiImage | undefined> {
  const trimmed = source?.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("/api/uploads/")) {
    const publicSiteUrl = getConfiguredPublicSiteUrl();
    if (isPublicSiteUrlUsableForXai(publicSiteUrl)) {
      return { url: `${publicSiteUrl}${trimmed}`, mode: "public_url" };
    }
    return readLocalUploadImageAsDataUrl(trimmed, "relative_upload_local_fallback");
  }
  if (/^data:image\/[^;,]+;base64,[\s\S]+$/i.test(trimmed)) {
    return { url: trimmed, mode: "data_url" };
  }
  if (/^https?:\/\//i.test(trimmed)) {
    let parsedUrl: URL | null = null;
    try {
      parsedUrl = new URL(trimmed);
    } catch {
      parsedUrl = null;
    }
    if (parsedUrl?.pathname.startsWith("/api/uploads/")) {
      if (isLocalDevHost(parsedUrl.hostname)) {
        return readLocalUploadImageAsDataUrl(trimmed, "localhost_upload_url");
      }
      if (isProductionUploadHost(parsedUrl.hostname)) {
        return { url: trimmed, mode: "public_url" };
      }
    }
    return { url: trimmed, mode: "public_url" };
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

export async function createXaiGrokVideoTask(params: { prompt: string; ratio: string; referenceImage?: string; attempt?: number; taskId?: string; sourcePrompt?: string; segmentIndex?: number; totalSegments?: number }) {
  const preparedImage = await prepareXaiReferenceImage(params.referenceImage);
  const mode = preparedImage ? "image-to-video" : "text-to-video";
  const aspectRatio = params.ratio === "9:16" ? "9:16" : "16:9";
  const model = preparedImage ? getImageToVideoModel() : getTextToVideoModel();
  const resolution = getResolution();
  const prompt = compactPromptForXai(params.prompt, mode, {
    taskId: params.taskId,
    sourcePrompt: params.sourcePrompt,
    segmentIndex: params.segmentIndex,
    totalSegments: params.totalSegments,
  });
  logPromptReady({
    taskId: params.taskId,
    mode,
    prompt,
    sourcePrompt: params.sourcePrompt,
    segmentIndex: params.segmentIndex,
    totalSegments: params.totalSegments,
  });
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
    imageUrlPreview: preparedImage?.mode === "public_url" ? preparedImage.url.slice(0, 140) : "",
    promptPreview: promptPreview(prompt, 300),
    promptChars: prompt.length,
    promptBytes: getPromptBytes(prompt),
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

export async function extendXaiGrokVideoTask(params: { prompt: string; videoUrl: string; attempt?: number; taskId?: string; sourcePrompt?: string; segmentIndex?: number; totalSegments?: number }) {
  const model = getTextToVideoModel();
  const videoUrl = await prepareXaiExtensionVideoUrl(params.videoUrl);
  const prompt = compactPromptForXai(params.prompt, "extension", {
    taskId: params.taskId,
    sourcePrompt: params.sourcePrompt,
    segmentIndex: params.segmentIndex,
    totalSegments: params.totalSegments,
  });
  logPromptReady({
    taskId: params.taskId,
    mode: "extension",
    prompt,
    sourcePrompt: params.sourcePrompt,
    segmentIndex: params.segmentIndex,
    totalSegments: params.totalSegments,
  });
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
    promptPreview: promptPreview(prompt, 300),
    promptChars: prompt.length,
    promptBytes: getPromptBytes(prompt),
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

async function runCreateWithRetry(params: { prompt: string; ratio: string; referenceImage?: string; taskId?: string; sourcePrompt?: string; segmentIndex?: number; totalSegments?: number }) {
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

async function runExtendWithRetry(params: { prompt: string; videoUrl: string; taskId?: string; sourcePrompt?: string; segmentIndex?: number; totalSegments?: number }) {
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
  sourcePrompt?: string;
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
        taskId: params.taskId,
        sourcePrompt: params.sourcePrompt,
        segmentIndex,
        totalSegments: params.prompts.length,
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
      taskId: params.taskId,
      sourcePrompt: params.sourcePrompt,
      segmentIndex: 1,
      totalSegments: params.extensionPrompts.length + 1,
    });
    providerTaskIds.push(base.requestId);
    if (base.videoUrl) segmentVideoUrls.push(base.videoUrl);
    successfulUnits += 1;
    let previousVideoUrl = base.videoUrl || "";
    for (let index = 0; index < params.extensionPrompts.length; index += 1) {
      const result = await runExtendWithRetry({
        prompt: params.extensionPrompts[index],
        videoUrl: previousVideoUrl,
        taskId: params.taskId,
        sourcePrompt: params.sourcePrompt,
        segmentIndex: index + 2,
        totalSegments: params.extensionPrompts.length + 1,
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
    sourcePrompt: params.sourcePrompt,
    getReferenceImagesForSegment: params.getReferenceImagesForSegment,
  });
}
