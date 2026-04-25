import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type YunwuImageMode = "text-to-image" | "image-to-image";

type GenerateYunwuImageParams = {
  prompt: string;
  referenceImageUrl?: string;
  ratio?: string;
};

type GenerateYunwuImageResult = {
  imageUrl: string;
  providerTaskId?: string;
  model: string;
};

const UPLOADS_DIR = "/www/wwwroot/quark-video-git/public/uploads";
const IMAGE_UPLOAD_DIR = path.join(UPLOADS_DIR, "images");

const getYunwuApiKey = () => process.env.YUNWU_API_KEY || process.env.SORA2_API_KEY || process.env.SORA_API_KEY || "";
const getBaseUrl = () => (process.env.YUNWU_BASE_URL || process.env.SORA2_BASE_URL || "https://yunwu.ai").replace(/\/$/, "");
const getTextToImagePath = () => process.env.YUNWU_TEXT_TO_IMAGE_PATH || "/v1/images/generations";
const getImageToImagePath = () => process.env.YUNWU_IMAGE_TO_IMAGE_PATH || "/v1/images/edits";
const getTextToImageModel = () => process.env.YUNWU_TEXT_TO_IMAGE_MODEL || "gemini-2.5-flash-image";
const getImageToImageModel = () => process.env.YUNWU_IMAGE_TO_IMAGE_MODEL || "gemini-3-pro-image-preview";

const log = (stage: string, payload: Record<string, unknown>) => {
  console.log(`[YUNWU_IMAGE][${stage}]`, JSON.stringify(payload));
};

const pickString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const asObject = (value: unknown): Record<string, unknown> | null => {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
};

const imageSizeForRatio = (ratio?: string) => (ratio === "9:16" ? "1024x1792" : "1792x1024");

const joinUrl = (base: string, urlPath: string) => `${base}${urlPath.startsWith("/") ? "" : "/"}${urlPath}`;

const contentTypeFromExt = (filePath: string) => {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
};

const localUploadPathFromUrl = (url: string) => {
  const prefix = "/api/uploads/";
  if (!url.startsWith(prefix)) return null;
  const relative = url.slice(prefix.length);
  if (!relative || relative.split("/").some((part) => !part || part === "." || part === "..")) return null;
  return path.join(UPLOADS_DIR, relative);
};

async function resolveReferenceImageInput(referenceImageUrl?: string) {
  if (!referenceImageUrl) return undefined;
  const localPath = localUploadPathFromUrl(referenceImageUrl);
  if (!localPath) return referenceImageUrl;
  const bytes = await readFile(localPath);
  return `data:${contentTypeFromExt(localPath)};base64,${Buffer.from(bytes).toString("base64")}`;
}

const extractImageCandidate = (payload: Record<string, unknown> | null): string | undefined => {
  if (!payload) return undefined;
  const data = payload.data;
  if (Array.isArray(data)) {
    for (const item of data) {
      const obj = asObject(item);
      const direct =
        pickString(obj?.url) ||
        pickString(obj?.image_url) ||
        pickString(obj?.imageUrl) ||
        pickString(obj?.b64_json) ||
        pickString(obj?.base64);
      if (direct) return direct;
    }
  }
  const nested = asObject(data);
  return (
    pickString(payload.url) ||
    pickString(payload.image_url) ||
    pickString(payload.imageUrl) ||
    pickString(payload.b64_json) ||
    pickString(payload.base64) ||
    pickString(nested?.url) ||
    pickString(nested?.image_url) ||
    pickString(nested?.imageUrl) ||
    pickString(nested?.b64_json) ||
    pickString(nested?.base64)
  );
};

const fileExtFromContentType = (contentType: string) => {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("gif")) return "gif";
  return "jpg";
};

async function saveImageBytes(bytes: Uint8Array, ext: string) {
  await mkdir(IMAGE_UPLOAD_DIR, { recursive: true });
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  await writeFile(path.join(IMAGE_UPLOAD_DIR, fileName), bytes);
  return `/api/uploads/images/${fileName}`;
}

async function persistImage(candidate: string, apiKey: string) {
  if (candidate.startsWith("data:image/")) {
    const [meta, encoded] = candidate.split(",", 2);
    const ext = meta.includes("png") ? "png" : meta.includes("webp") ? "webp" : "jpg";
    return saveImageBytes(Buffer.from(encoded || "", "base64"), ext);
  }
  if (/^[A-Za-z0-9+/=]+$/.test(candidate) && candidate.length > 200) {
    return saveImageBytes(Buffer.from(candidate, "base64"), "png");
  }
  const response = await fetch(candidate, {
    headers: candidate.includes("yunwu") && apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
  });
  if (!response.ok) {
    throw new Error(`图片下载失败 status=${response.status}`);
  }
  const contentType = response.headers.get("content-type") || "image/jpeg";
  const bytes = new Uint8Array(await response.arrayBuffer());
  return saveImageBytes(bytes, fileExtFromContentType(contentType));
}

export async function generateYunwuImage(params: GenerateYunwuImageParams): Promise<GenerateYunwuImageResult> {
  const apiKey = getYunwuApiKey();
  if (!apiKey) {
    throw new Error("缺少 YUNWU_API_KEY，请在服务端环境变量配置；也可临时复用 SORA2_API_KEY/SORA_API_KEY");
  }
  const mode: YunwuImageMode = params.referenceImageUrl ? "image-to-image" : "text-to-image";
  const model = mode === "image-to-image" ? getImageToImageModel() : getTextToImageModel();
  const endpoint = joinUrl(getBaseUrl(), mode === "image-to-image" ? getImageToImagePath() : getTextToImagePath());
  const body: Record<string, unknown> = {
    model,
    prompt: params.prompt,
    size: imageSizeForRatio(params.ratio),
    response_format: "url",
  };
  const referenceImageInput = await resolveReferenceImageInput(params.referenceImageUrl);
  if (referenceImageInput) {
    body.image = referenceImageInput;
    body.images = [referenceImageInput];
  }

  log("REQUEST", {
    mode,
    model,
    endpoint,
    hasReferenceImage: Boolean(params.referenceImageUrl),
    promptPreview: params.prompt.slice(0, 120),
  });

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const rawText = await response.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(rawText) as Record<string, unknown>;
  } catch {
    json = null;
  }
  if (!response.ok || !json) {
    throw new Error(String(json?.message || json?.error || `图片生成失败 status=${response.status} preview=${rawText.slice(0, 160)}`));
  }
  const candidate = extractImageCandidate(json);
  if (!candidate) {
    throw new Error("图片生成成功但未返回图片地址或 base64");
  }
  const imageUrl = await persistImage(candidate, apiKey);
  log("SUCCESS", {
    mode,
    model,
    imageUrl,
    providerTaskId: json.id || "",
  });
  return {
    imageUrl,
    providerTaskId: typeof json.id === "string" ? json.id : undefined,
    model,
  };
}
