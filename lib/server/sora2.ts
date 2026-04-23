type CreateVideoRequest = {
  prompt: string;
  images?: string[];
  orientation?: "portrait" | "landscape";
  size?: "720x1280" | "1280x720";
  duration?: number;
};

type SoraTaskStatus = "pending" | "processing" | "succeeded" | "failed" | "canceled" | "unknown";

type SoraQueryResult = {
  id: string;
  status: SoraTaskStatus;
  videoUrl?: string;
  coverUrl?: string;
  seconds?: number;
  size?: string;
  ratio?: string;
  errorMessage?: string;
};

type SoraDownloadResult = {
  ok: boolean;
  url?: string;
  statusCode: number;
  code?: string;
  message?: string;
};

const getBaseUrl = () => (process.env.SORA2_BASE_URL || "https://yunwu.ai").replace(/\/$/, "");
const getCreatePath = () => process.env.SORA2_CREATE_PATH || "/v1/video/create";
const getImageCreatePath = () => process.env.SORA2_IMAGE_CREATE_PATH || "/v1/video/create";
const getQueryPath = () => process.env.SORA2_QUERY_PATH || "/v1/video/query";
const getDownloadPath = (taskId: string) =>
  (process.env.SORA2_DOWNLOAD_PATH_TEMPLATE || "/v1/videos/{id}/content").replace("{id}", encodeURIComponent(taskId));

const authHeaders = () => {
  const key = process.env.SORA2_API_KEY;
  if (!key) {
    throw new Error("缺少 SORA2_API_KEY，请先在 .env.local 配置");
  }
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
};

const log = (stage: string, payload: Record<string, unknown>) => {
  console.log(`[SORA2][${stage}]`, JSON.stringify(payload));
};

const maskHeaders = (headers: Record<string, string>) => {
  const next = { ...headers };
  if (next.Authorization) {
    const value = next.Authorization;
    next.Authorization = `${value.slice(0, 16)}***`;
  }
  return next;
};

const textPreview = (raw: string, length = 300) => raw.slice(0, length).replace(/\s+/g, " ").trim();
const urlPreview = (value: string, length = 160) => value.slice(0, length);

const getPublicAppBaseUrl = () => {
  const raw =
    process.env.SORA2_REFERENCE_IMAGE_BASE_URL ||
    process.env.APP_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  if (!raw) return "http://127.0.0.1:3000";
  return raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`;
};

const toAbsoluteReferenceImageUrl = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  const base = getPublicAppBaseUrl();
  return new URL(trimmed.startsWith("/") ? trimmed : `/${trimmed}`, base).toString();
};

const isLikelyPublicUrl = (value: string) => {
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0") return false;
    if (host.endsWith(".local")) return false;
    return true;
  } catch {
    return false;
  }
};

type ParsedResponse = {
  ok: boolean;
  status: number;
  contentType: string;
  rawText: string;
  json: Record<string, unknown> | null;
};

async function parseResponse(response: Response): Promise<ParsedResponse> {
  const contentType = response.headers.get("content-type") || "";
  const rawText = await response.text();
  const isJson = contentType.toLowerCase().includes("application/json");
  if (!isJson) {
    return {
      ok: response.ok,
      status: response.status,
      contentType,
      rawText,
      json: null,
    };
  }
  try {
    return {
      ok: response.ok,
      status: response.status,
      contentType,
      rawText,
      json: (JSON.parse(rawText) as Record<string, unknown>) ?? null,
    };
  } catch {
    return {
      ok: response.ok,
      status: response.status,
      contentType,
      rawText,
      json: null,
    };
  }
}

const mapStatus = (value: unknown): SoraTaskStatus => {
  const raw = String(value || "").toLowerCase();
  if (["pending", "queued"].includes(raw)) return "pending";
  if (["processing", "running", "in_progress"].includes(raw)) return "processing";
  if (["succeeded", "success", "completed"].includes(raw)) return "succeeded";
  if (["failed", "error"].includes(raw)) return "failed";
  if (["canceled", "cancelled"].includes(raw)) return "canceled";
  return "unknown";
};

const pickString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const getNestedObject = (value: unknown): Record<string, unknown> | null => {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
};

const extractMediaFields = (payload: Record<string, unknown> | null) => {
  const data = getNestedObject(payload?.data);
  const videoUrl =
    pickString(payload?.url) ||
    pickString(payload?.video_url) ||
    pickString(payload?.download_url) ||
    pickString(payload?.file_url) ||
    pickString(payload?.output_url) ||
    pickString(data?.url) ||
    pickString(data?.video_url);
  const coverUrl =
    pickString(payload?.cover_url) ||
    pickString(payload?.cover) ||
    pickString(payload?.thumbnail_url) ||
    pickString(data?.cover_url) ||
    pickString(data?.cover) ||
    pickString(data?.thumbnail_url);
  return {
    videoUrl,
    coverUrl,
    fields: {
      url: pickString(payload?.url),
      video_url: pickString(payload?.video_url),
      download_url: pickString(payload?.download_url),
      file_url: pickString(payload?.file_url),
      output_url: pickString(payload?.output_url),
      "data.url": pickString(data?.url),
      "data.video_url": pickString(data?.video_url),
      cover_url: pickString(payload?.cover_url),
      cover: pickString(payload?.cover),
      thumbnail_url: pickString(payload?.thumbnail_url),
      "data.cover_url": pickString(data?.cover_url),
      "data.cover": pickString(data?.cover),
      "data.thumbnail_url": pickString(data?.thumbnail_url),
    },
  };
};

export async function createSora2Task(payload: CreateVideoRequest): Promise<{ taskId: string }> {
  const allowedSeconds = new Set([4, 8, 12]);
  const rawSeconds = Number(payload.duration ?? 4);
  const seconds = allowedSeconds.has(rawSeconds) ? rawSeconds : 4;
  if (!allowedSeconds.has(rawSeconds)) {
    console.warn(
      `[SORA2][CREATE_WARN]`,
      JSON.stringify({
        message: "非法 seconds，已自动兜底为 4",
        receivedSeconds: rawSeconds,
        fallbackSeconds: 4,
      })
    );
  }
  const size = payload.size === "720x1280" ? "720x1280" : "1280x720";
  const model = process.env.SORA2_MODEL || "sora-2";
  const imageFieldName = process.env.SORA2_REFERENCE_IMAGE_FIELD || "images";
  const imageFieldMode = (process.env.SORA2_REFERENCE_IMAGE_MODE || "repeat").toLowerCase();
  const inputImage = (payload.images || []).find((item) => typeof item === "string" && item.trim().length > 0);
  const absoluteImageUrl = inputImage ? toAbsoluteReferenceImageUrl(inputImage) : "";
  const useImageStructuredRequest = Boolean(absoluteImageUrl);
  const orientation = payload.orientation || (size === "720x1280" ? "portrait" : "landscape");

  const requestFields: string[] = [];
  let body: BodyInit;
  let headers: Record<string, string>;
  let url = `${getBaseUrl()}${(useImageStructuredRequest ? getImageCreatePath() : getCreatePath()).startsWith("/") ? "" : "/"}${
    useImageStructuredRequest ? getImageCreatePath() : getCreatePath()
  }`;

  if (useImageStructuredRequest) {
    const createBody: Record<string, unknown> = {
      model,
      prompt: payload.prompt,
      orientation,
      size,
      duration: seconds,
      seconds,
      watermark: false,
    };
    if (imageFieldName === "images") {
      createBody[imageFieldName] = [absoluteImageUrl];
    } else if (imageFieldMode === "array_json") {
      createBody[imageFieldName] = [absoluteImageUrl];
    } else {
      createBody[imageFieldName] = absoluteImageUrl;
    }
    requestFields.push(...Object.keys(createBody));
    body = JSON.stringify(createBody);
    headers = authHeaders();
  } else {
    const formData = new FormData();
    formData.append("model", model);
    formData.append("prompt", payload.prompt);
    formData.append("seconds", String(seconds));
    formData.append("size", size);
    requestFields.push("model", "prompt", "seconds", "size");
    body = formData;
    headers = {
      Authorization: authHeaders().Authorization,
      Accept: "application/json",
    };
  }

  log("CREATE_REQUEST", {
    model,
    promptPreview: payload.prompt.slice(0, 120),
    seconds,
    size,
    hasReferenceImage: Boolean(absoluteImageUrl),
    referenceImageFieldName: absoluteImageUrl ? imageFieldName : "",
    referenceImageFieldMode: absoluteImageUrl ? imageFieldMode : "",
    referenceImageUrlPreview: absoluteImageUrl ? urlPreview(absoluteImageUrl) : "",
    referenceImageUrlPublic: absoluteImageUrl ? isLikelyPublicUrl(absoluteImageUrl) : false,
    createPath: useImageStructuredRequest ? getImageCreatePath() : getCreatePath(),
    requestFields,
  });

  log("CREATE_HTTP_REQUEST", {
    url,
    method: "POST",
    headers: maskHeaders(headers),
    imagePayloadMeta: absoluteImageUrl
      ? {
          fieldName: imageFieldName,
          mode: imageFieldMode,
          valuePreview: urlPreview(absoluteImageUrl),
        }
      : { fieldName: "", mode: "", valuePreview: "" },
  });
  const response = await fetch(url, {
    method: "POST",
    headers,
    body,
  });
  const parsed = await parseResponse(response);
  log("CREATE_RESPONSE", {
    ok: parsed.ok,
    status: parsed.status,
    contentType: parsed.contentType,
    id: parsed.json?.id,
    statusValue: parsed.json?.status,
    message: parsed.json?.message || parsed.json?.error,
    rawPreview: textPreview(parsed.rawText),
  });
  if (!parsed.contentType.toLowerCase().includes("application/json")) {
    throw new Error(`Sora2 创建任务返回非JSON，status=${parsed.status}，preview=${textPreview(parsed.rawText, 120)}`);
  }
  if (!parsed.ok || !parsed.json?.id) {
    throw new Error(String(parsed.json?.message || parsed.json?.error || "Sora2 创建任务失败"));
  }
  return { taskId: String(parsed.json.id) };
}

export async function querySora2Task(taskId: string): Promise<SoraQueryResult> {
  const url = new URL(`${getBaseUrl()}${getQueryPath().startsWith("/") ? "" : "/"}${getQueryPath()}`);
  url.searchParams.set("id", taskId);
  const headers = authHeaders();
  log("QUERY_HTTP_REQUEST", {
    url: url.toString(),
    method: "GET",
    headers: maskHeaders(headers),
  });
  const response = await fetch(url.toString(), {
    method: "GET",
    headers,
  });
  const parsed = await parseResponse(response);
  log("QUERY_RESPONSE", {
    taskId,
    ok: parsed.ok,
    statusCode: parsed.status,
    contentType: parsed.contentType,
    providerStatus: parsed.json?.status,
    hasVideoUrl: typeof parsed.json?.video_url === "string" && parsed.json.video_url.length > 0,
    hasCoverUrl: typeof parsed.json?.cover_url === "string" && parsed.json.cover_url.length > 0,
    message: parsed.json?.message || parsed.json?.error || parsed.json?.error_message,
    rawPreview: textPreview(parsed.rawText),
  });
  if (!parsed.contentType.toLowerCase().includes("application/json")) {
    throw new Error(`Sora2 查询任务返回非JSON，status=${parsed.status}，preview=${textPreview(parsed.rawText, 120)}`);
  }
  if (!parsed.ok || !parsed.json) {
    throw new Error(String(parsed.json?.message || parsed.json?.error || "Sora2 查询任务失败"));
  }
  const media = extractMediaFields(parsed.json);
  const videoUrl = media.videoUrl;
  const coverUrl = media.coverUrl;
  const seconds =
    typeof parsed.json.seconds === "number"
      ? parsed.json.seconds
      : typeof parsed.json.seconds === "string"
        ? Number(parsed.json.seconds)
      : typeof parsed.json.duration === "number"
        ? parsed.json.duration
        : typeof parsed.json.duration === "string"
          ? Number(parsed.json.duration)
        : undefined;
  const size = typeof parsed.json.size === "string" ? parsed.json.size : undefined;
  const ratio = typeof parsed.json.ratio === "string" ? parsed.json.ratio : undefined;
  const status = mapStatus(parsed.json.status);
  if (status === "succeeded") {
    log("QUERY_COMPLETED_FIELDS", {
      taskId,
      extractedVideoUrl: videoUrl || "",
      extractedCoverUrl: coverUrl || "",
      fields: media.fields,
      size: size || "",
      ratio: ratio || "",
    });
  }
  return {
    id: String(parsed.json.id || taskId),
    status,
    videoUrl,
    coverUrl,
    seconds,
    size,
    ratio,
    errorMessage:
      typeof parsed.json.error_message === "string"
        ? parsed.json.error_message
        : typeof parsed.json.message === "string"
          ? parsed.json.message
          : undefined,
  };
}

export async function downloadSora2Video(taskId: string): Promise<SoraDownloadResult> {
  const url = `${getBaseUrl()}${getDownloadPath(taskId).startsWith("/") ? "" : "/"}${getDownloadPath(taskId)}`;
  const headers = authHeaders();
  log("DOWNLOAD_HTTP_REQUEST", {
    url,
    method: "GET",
    headers: maskHeaders(headers),
  });
  const response = await fetch(url, {
    method: "GET",
    headers,
    redirect: "follow",
  });
  const parsed = await parseResponse(response);
  log("DOWNLOAD_RESPONSE", {
    taskId,
    ok: parsed.ok,
    statusCode: parsed.status,
    contentType: parsed.contentType,
    rawPreview: textPreview(parsed.rawText),
    finalUrl: response.url || "",
    code: parsed.json?.code,
    message: parsed.json?.message || parsed.json?.error || parsed.json?.error_message,
  });
  const media = extractMediaFields(parsed.json);
  if (!parsed.ok) {
    return {
      ok: false,
      statusCode: parsed.status,
      code: pickString(parsed.json?.code),
      message:
        pickString(parsed.json?.message) ||
        pickString(parsed.json?.error) ||
        pickString(parsed.json?.error_message) ||
        "download 接口失败",
    };
  }
  const urlCandidate = media.videoUrl || pickString(response.url);
  if (!urlCandidate) {
    return {
      ok: false,
      statusCode: parsed.status,
      code: "missing_download_url",
      message: "download 成功但未返回可用地址",
    };
  }
  return {
    ok: true,
    statusCode: parsed.status,
    url: urlCandidate,
  };
}
