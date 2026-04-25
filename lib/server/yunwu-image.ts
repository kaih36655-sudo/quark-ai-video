import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type YunwuImageMode = "text-to-image" | "image-to-image";

type GenerateYunwuImageParams = {
  prompt: string;
  referenceImageUrl?: string;
  ratio?: string;
  imageSize?: "1K" | "2K" | "4K";
};

type GenerateYunwuImageResult = {
  imageUrl: string;
  providerTaskId?: string;
  model: string;
  endpoint: string;
};

const UPLOADS_DIR = "/www/wwwroot/quark-video-git/public/uploads";
const IMAGE_UPLOAD_DIR = path.join(UPLOADS_DIR, "images");

const getYunwuApiKey = () => process.env.YUNWU_API_KEY || process.env.SORA2_API_KEY || process.env.SORA_API_KEY || "";
const getBaseUrl = () => (process.env.YUNWU_BASE_URL || process.env.SORA2_BASE_URL || "https://yunwu.ai").replace(/\/$/, "");
const getImageModel = () =>
  process.env.YUNWU_IMAGE_MODEL ||
  process.env.YUNWU_TEXT_TO_IMAGE_MODEL ||
  process.env.YUNWU_IMAGE_TO_IMAGE_MODEL ||
  "gemini-3.1-flash-image-preview";
const getImagePath = (model: string) =>
  process.env.YUNWU_IMAGE_PATH || `/v1beta/models/${encodeURIComponent(model)}:generateContent`;

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

const joinUrl = (base: string, urlPath: string) => `${base}${urlPath.startsWith("/") ? "" : "/"}${urlPath}`;

const stringifyUnknown = (value: unknown): string => {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  if (value === null || typeof value === "undefined") return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const contentTypeFromExt = (filePath: string) => {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
};

const normalizeAspectRatio = (ratio?: string) => {
  if (ratio === "1:1" || ratio === "9:16" || ratio === "16:9") return ratio;
  return "9:16";
};

const normalizeImageSize = (imageSize?: string) => {
  if (imageSize === "1K" || imageSize === "2K" || imageSize === "4K") return imageSize;
  return "2K";
};

const localUploadPathFromUrl = (url: string) => {
  const prefix = "/api/uploads/";
  if (!url.startsWith(prefix)) return null;
  const relative = url.slice(prefix.length);
  if (!relative || relative.split("/").some((part) => !part || part === "." || part === "..")) return null;
  return path.join(UPLOADS_DIR, relative);
};

async function resolveReferenceImageInlineData(referenceImageUrl?: string) {
  if (!referenceImageUrl) return undefined;
  if (referenceImageUrl.startsWith("data:image/")) {
    const [meta, encoded] = referenceImageUrl.split(",", 2);
    const mimeType = meta.match(/^data:([^;]+);base64$/)?.[1] || "image/png";
    return { mimeType, data: encoded || "" };
  }
  const localPath = localUploadPathFromUrl(referenceImageUrl);
  if (localPath) {
    const bytes = await readFile(localPath);
    return { mimeType: contentTypeFromExt(localPath), data: Buffer.from(bytes).toString("base64") };
  }
  if (/^https?:\/\//i.test(referenceImageUrl)) {
    const response = await fetch(referenceImageUrl);
    if (!response.ok) {
      throw new Error(`参考图读取失败 status=${response.status}`);
    }
    const contentType = response.headers.get("content-type") || "image/png";
    const bytes = Buffer.from(await response.arrayBuffer());
    return { mimeType: contentType, data: bytes.toString("base64") };
  }
  throw new Error(`无法解析参考图地址：${referenceImageUrl}`);
}

const extractImageCandidate = (payload: Record<string, unknown> | null): string | undefined => {
  if (!payload) return undefined;
  const candidates = payload.candidates;
  if (Array.isArray(candidates)) {
    for (const candidate of candidates) {
      const content = asObject(asObject(candidate)?.content);
      const parts = content?.parts;
      if (!Array.isArray(parts)) continue;
      for (const part of parts) {
        const obj = asObject(part);
        const inlineData = asObject(obj?.inlineData) || asObject(obj?.inline_data);
        const imageData = pickString(inlineData?.data);
        if (imageData) {
          const mimeType = pickString(inlineData?.mimeType) || pickString(inlineData?.mime_type) || "image/png";
          return `data:${mimeType};base64,${imageData}`;
        }
        const direct = pickString(obj?.url) || pickString(obj?.b64_json);
        if (direct) return direct;
      }
    }
  }
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

const shouldRetryImageError = (message: string) => {
  const lower = message.toLowerCase();
  return (
    lower.includes("429") ||
    lower.includes("no_image") ||
    lower.includes("image_generation_failed") ||
    lower.includes("network") ||
    lower.includes("fetch failed") ||
    lower.includes("timeout") ||
    lower.includes("status=5") ||
    lower.includes("status=4") ||
    lower.includes("未返回图片")
  );
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
  const model = getImageModel();
  const endpoint = joinUrl(getBaseUrl(), getImagePath(model));
  const aspectRatio = normalizeAspectRatio(params.ratio);
  const imageSize = normalizeImageSize(params.imageSize);
  const referenceImageInlineData = await resolveReferenceImageInlineData(params.referenceImageUrl);
  const parts: Record<string, unknown>[] = [{ text: params.prompt }];
  if (referenceImageInlineData) {
    parts.push({
      inline_data: {
        mime_type: referenceImageInlineData.mimeType,
        data: referenceImageInlineData.data,
      },
    });
  }
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseModalities: ["IMAGE"],
      imageConfig: {
        aspectRatio,
        imageSize,
      },
    },
  };

  const maxAttempts = 3;
  let lastErrorMessage = "图片生成失败";
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      log("REQUEST", {
        mode,
        model,
        endpoint,
        attempt,
        maxAttempts,
        aspectRatio,
        imageSize,
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
      const contentType = response.headers.get("content-type") || "";
      let json: Record<string, unknown> | null = null;
      try {
        json = JSON.parse(rawText) as Record<string, unknown>;
      } catch {
        json = null;
      }
      log("RESPONSE", {
        status: response.status,
        ok: response.ok,
        contentType,
        rawPreview: rawText.slice(0, 1200),
        parsedJson: json,
      });
      if (!response.ok || !json) {
        const parsedError = json?.error || json?.message;
        lastErrorMessage = parsedError
          ? `图片生成失败 status=${response.status} error=${stringifyUnknown(parsedError)}`
          : `图片生成失败 status=${response.status} preview=${rawText.slice(0, 300)}`;
        throw new Error(lastErrorMessage);
      }
      const candidate = extractImageCandidate(json);
      if (!candidate) {
        lastErrorMessage = `NO_IMAGE: 图片生成成功但未返回图片地址或 base64 response=${stringifyUnknown(json)}`;
        throw new Error(lastErrorMessage);
      }
      const imageUrl = await persistImage(candidate, apiKey);
      log("SUCCESS", {
        mode,
        model,
        endpoint,
        imageUrl,
        providerTaskId: json.id || "",
      });
      return {
        imageUrl,
        providerTaskId: typeof json.id === "string" ? json.id : undefined,
        model,
        endpoint,
      };
    } catch (error) {
      lastErrorMessage = stringifyUnknown(error) || lastErrorMessage;
      if (attempt < maxAttempts && shouldRetryImageError(lastErrorMessage)) {
        log("RETRY", {
          mode,
          model,
          endpoint,
          attempt,
          maxAttempts,
          message: lastErrorMessage,
        });
        continue;
      }
      break;
    }
  }
  log("FINAL_FAILED", {
    mode,
    model,
    endpoint,
    maxAttempts,
    finalReason: lastErrorMessage,
  });
  throw new Error(lastErrorMessage);
}
