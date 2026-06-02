import { fetchProviderVideo } from "./provider-video-fetch";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { resolveLocalUploadsSource } from "./local-uploads";

type RunningHubTaskStatus = "pending" | "processing" | "success" | "failed";

type RunningHubQueryResult = {
  status: RunningHubTaskStatus;
  upscaledVideoUrl?: string;
  upscaledCoverUrl?: string;
  consumeMoney?: number;
  taskCostTime?: number;
  errorMessage?: string;
  errorCode?: string;
  exceptionType?: string;
  nodeName?: string;
};

const baseUrl = () => (process.env.RUNNINGHUB_BASE_URL || "https://www.runninghub.cn").replace(/\/$/, "");
const appId = () => process.env.RUNNINGHUB_UPSCALE_APP_ID || "1996062530516795394";
const defaultMaxResolution = () => process.env.RUNNINGHUB_UPSCALE_MAX_RESOLUTION || process.env.RUNNINGHUB_MAX_RESOLUTION || "1920";
const defaultInstanceType = () => process.env.RUNNINGHUB_UPSCALE_INSTANCE_TYPE || "default";
const UPLOADS_DIR = "/www/wwwroot/quark-video-git/public/uploads";

const headers = () => {
  const token = process.env.RUNNINGHUB_API_KEY;
  if (!token) {
    throw new Error("缺少 RUNNINGHUB_API_KEY，请先在 .env.local 配置");
  }
  return {
    Authorization: `Bearer ${token}`,
  };
};

const log = (stage: string, payload: Record<string, unknown>) => {
  console.log(`[RUNNINGHUB][${stage}]`, JSON.stringify(payload));
};

const pickString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const pickStringOrNumberAsString = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
};

const urlPreview = (value?: string) => (value ? value.slice(0, 120) : "");

const asObject = (value: unknown): Record<string, unknown> | null => {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
};

const extractUrlFromResult = (result: Record<string, unknown> | null): string | undefined => {
  if (!result) return undefined;
  return (
    pickString(result.url) ||
    pickString(result.fileUrl) ||
    pickString(result.file_url) ||
    pickString(result.downloadUrl) ||
    pickString(result.download_url) ||
    pickString(result.outputUrl) ||
    pickString(result.output_url)
  );
};

const extractOutputs = (payload: Record<string, unknown> | null) => {
  const data = asObject(payload?.data);
  const result = asObject(payload?.result);
  const resultsRaw = (data?.results ?? result?.results ?? payload?.results) as unknown;
  const results = Array.isArray(resultsRaw) ? resultsRaw.map(asObject).filter((item): item is Record<string, unknown> => Boolean(item)) : [];
  let videoUrl: string | undefined;
  let coverUrl: string | undefined;
  const outputTypes: string[] = [];
  for (const result of results) {
    const outputType = String(result.outputType || result.type || "").toLowerCase();
    outputTypes.push(outputType);
    const url = extractUrlFromResult(result);
    if (!url) continue;
    if (!videoUrl && (outputType.includes("mp4") || outputType.includes("video") || url.toLowerCase().endsWith(".mp4") || url.toLowerCase().includes(".mp4?"))) {
      videoUrl = url;
      continue;
    }
    if (!coverUrl && (outputType.includes("png") || outputType.includes("jpg") || outputType.includes("jpeg") || outputType.includes("webp") || /\.(png|jpe?g|webp)(\?|$)/i.test(url))) {
      coverUrl = url;
    }
  }
  return {
    videoUrl,
    coverUrl,
    resultsCount: results.length,
    outputTypes,
    hasMp4: Boolean(videoUrl),
    hasCover: Boolean(coverUrl),
  };
};

const mapStatus = (value: unknown): RunningHubTaskStatus => {
  const status = String(value || "").toUpperCase();
  if (["QUEUED", "PENDING", "WAITING"].includes(status)) return "pending";
  if (["RUNNING", "PROCESSING", "IN_PROGRESS"].includes(status)) return "processing";
  if (["SUCCESS", "SUCCEEDED", "COMPLETED"].includes(status)) return "success";
  if (["FAILED", "ERROR", "CANCELLED", "CANCELED"].includes(status)) return "failed";
  return "processing";
};

const responsePreview = (payload: unknown) => {
  try {
    return JSON.stringify(payload).slice(0, 300);
  } catch {
    return String(payload).slice(0, 300);
  }
};

const extFromUrl = (url: string, fallback: string) => {
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    if (/^\.[a-z0-9]+$/.test(ext)) return ext;
  } catch {}
  return fallback;
};

const isHttpUrl = (value: string) => /^https?:\/\//i.test(value);

async function downloadRunningHubResult(params: { taskId: string; sourceUrl: string; folder: string; fallbackExt: string }) {
  const targetDir = path.join(UPLOADS_DIR, params.folder);
  await mkdir(targetDir, { recursive: true });
  const ext = extFromUrl(params.sourceUrl, params.fallbackExt);
  const fileName = `${params.taskId.replace(/[^a-zA-Z0-9_-]/g, "-")}-${Date.now()}-${randomUUID().slice(0, 8)}${ext}`;
  const filePath = path.join(targetDir, fileName);
  const tempFilePath = `${filePath}.tmp`;
  const response = await fetch(params.sourceUrl);
  if (!response.ok) {
    throw new Error(`下载 RunningHub 结果失败 status=${response.status}`);
  }
  if (!response.body) {
    throw new Error("RunningHub 结果下载失败：响应 body 为空");
  }
  try {
    await pipeline(Readable.fromWeb(response.body as unknown as NodeReadableStream), createWriteStream(tempFilePath));
    await rename(tempFilePath, filePath);
  } catch (error) {
    await rm(tempFilePath, { force: true }).catch(() => undefined);
    throw error;
  }
  const savedStat = await stat(filePath);
  return {
    localPath: filePath,
    publicUrl: `/api/uploads/${params.folder}/${fileName}`,
    bytes: savedStat.size,
  };
}

async function persistRunningHubOutputs(taskId: string, outputs: { videoUrl?: string; coverUrl?: string }) {
  let videoUrl = outputs.videoUrl;
  let coverUrl = outputs.coverUrl;
  if (outputs.videoUrl) {
    log("RESULT_DOWNLOAD_START", { taskId, mp4UrlPreview: urlPreview(outputs.videoUrl) });
    try {
      const saved = await downloadRunningHubResult({ taskId, sourceUrl: outputs.videoUrl, folder: "upscaled", fallbackExt: ".mp4" });
      videoUrl = saved.publicUrl;
      log("RESULT_DOWNLOAD_SUCCESS", { taskId, localPath: saved.localPath, publicUrl: saved.publicUrl, bytes: saved.bytes });
    } catch (error) {
      log("RESULT_DOWNLOAD_FAILED", {
        taskId,
        reason: error instanceof Error ? error.message : String(error),
        fallbackExternalUrl: Boolean(outputs.videoUrl),
      });
    }
  }
  if (outputs.coverUrl) {
    try {
      const saved = await downloadRunningHubResult({ taskId, sourceUrl: outputs.coverUrl, folder: "upscaled-covers", fallbackExt: ".jpg" });
      coverUrl = saved.publicUrl;
    } catch (error) {
      log("RESULT_DOWNLOAD_FAILED", {
        taskId,
        reason: `cover ${error instanceof Error ? error.message : String(error)}`,
        fallbackExternalUrl: Boolean(outputs.coverUrl),
      });
    }
  }
  return { videoUrl, coverUrl };
}

export async function uploadRunningHubBinaryFromRemoteUrl(remoteUrl: string, context?: { videoId?: string }): Promise<{ fileName: string; downloadUrl?: string }> {
  const localSource = await resolveLocalUploadsSource(remoteUrl);
  if (localSource) {
    console.log("[UPSCALE][LOCAL_UPLOAD_SOURCE]", JSON.stringify({
      videoId: context?.videoId || "",
      sourceVideoUrl: remoteUrl,
      resolvedPath: localSource.resolvedPath,
      exists: localSource.exists,
    }));
    if (!localSource.exists) {
      throw new Error("本地拼接视频文件不存在，无法提交超分");
    }
    return uploadRunningHubBinaryFromLocalFile(localSource.resolvedPath, localSource.size);
  }
  if (!isHttpUrl(remoteUrl)) {
    throw new Error("超分源视频必须是 http/https URL 或 /api/uploads/ 本地上传路径");
  }
  log("UPLOAD_REQUEST", { source: "uploaded_binary", remoteUrlPreview: remoteUrl.slice(0, 120) });
  const videoRes = await fetchProviderVideo(remoteUrl);
  if (!videoRes.ok) {
    throw new Error(`服务端拉取源视频失败，status=${videoRes.status}`);
  }
  const blob = await videoRes.blob();
  const formData = new FormData();
  formData.append("file", blob, "source.mp4");
  const response = await fetch(`${baseUrl()}/openapi/v2/media/upload/binary`, {
    method: "POST",
    headers: headers(),
    body: formData,
  });
  const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || !json) {
    log("UPLOAD_RESPONSE", {
      ok: response.ok,
      statusCode: response.status,
      message: json?.message || json?.error,
    });
    throw new Error(`RunningHub 上传失败 status=${response.status} message=${String(json?.message || json?.error || "空响应")}`);
  }
  const data = asObject(json.data);
  const fileName = pickString(data?.fileName) || pickString(data?.filename) || "";
  if (!fileName) {
    throw new Error("RunningHub 上传成功但未返回 fileName");
  }
  log("UPLOAD_RESPONSE", {
    ok: response.ok,
    statusCode: response.status,
    fileName,
    download_url: pickString(data?.download_url),
    message: json?.message || json?.error,
  });
  return {
    fileName,
    downloadUrl: pickString(data?.download_url),
  };
}

async function uploadRunningHubBinaryFromLocalFile(filePath: string, fileSize: number): Promise<{ fileName: string; downloadUrl?: string }> {
  const boundary = `----quark-runninghub-${randomUUID()}`;
  const safeName = path.basename(filePath).replace(/[^a-zA-Z0-9._-]/g, "-") || "source.mp4";
  const header = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeName}"\r\nContent-Type: video/mp4\r\n\r\n`
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  async function* bodyStream() {
    yield header;
    yield* createReadStream(filePath);
    yield footer;
  }
  log("UPLOAD_REQUEST", { source: "local_file_stream", filePath, fileSize });
  const response = await fetch(`${baseUrl()}/openapi/v2/media/upload/binary`, {
    method: "POST",
    headers: {
      ...headers(),
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": String(header.length + fileSize + footer.length),
    },
    body: Readable.from(bodyStream()) as unknown as BodyInit,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || !json) {
    log("UPLOAD_RESPONSE", {
      ok: response.ok,
      statusCode: response.status,
      message: json?.message || json?.error,
    });
    throw new Error(`RunningHub 上传失败 status=${response.status} message=${String(json?.message || json?.error || "空响应")}`);
  }
  const data = asObject(json.data);
  const fileName = pickString(data?.fileName) || pickString(data?.filename) || "";
  if (!fileName) {
    throw new Error("RunningHub 上传成功但未返回 fileName");
  }
  log("UPLOAD_RESPONSE", {
    ok: response.ok,
    statusCode: response.status,
    fileName,
    download_url: pickString(data?.download_url),
    message: json?.message || json?.error,
  });
  return {
    fileName,
    downloadUrl: pickString(data?.download_url),
  };
}

export function isRunningHubOomError(value: unknown) {
  const text = typeof value === "string" ? value : responsePreview(value);
  return (
    text.includes('"805"') ||
    text.includes("errorCode=805") ||
    text.includes("errorCode:805") ||
    text.includes("torch.OutOfMemoryError") ||
    text.includes("OutOfMemory") ||
    text.includes("显存不足") ||
    text.includes("显存耗尽") ||
    text.includes("CUDA out of memory") ||
    text.includes("FlashVSR_SM_KSampler")
  );
}

const extractFailureDetails = (json: Record<string, unknown> | null) => {
  const data = asObject(json?.data);
  const result = asObject(json?.result);
  const failedReason =
    asObject(data?.failedReason) ||
    asObject(data?.failed_reason) ||
    asObject(result?.failedReason) ||
    asObject(result?.failed_reason) ||
    asObject(json?.failedReason) ||
    asObject(json?.failed_reason);
  const errorCode = pickStringOrNumberAsString(data?.errorCode, result?.errorCode, json?.errorCode, failedReason?.errorCode);
  const exceptionType = pickString(failedReason?.exception_type) || pickString(failedReason?.exceptionType) || pickString(data?.exception_type) || pickString(json?.exception_type);
  const nodeName = pickString(failedReason?.node_name) || pickString(failedReason?.nodeName) || pickString(data?.node_name) || pickString(json?.node_name);
  const exceptionMessage = pickString(failedReason?.exception_message) || pickString(failedReason?.exceptionMessage) || pickString(data?.exception_message) || pickString(json?.exception_message);
  return { errorCode, exceptionType, nodeName, exceptionMessage };
};

export async function createRunningHubUpscaleTask(videoInput: string, options?: { instanceType?: string; maxResolution?: string }): Promise<{ taskId: string }> {
  const instanceType = options?.instanceType || defaultInstanceType();
  const resolution = options?.maxResolution || defaultMaxResolution();
  const body = {
    nodeInfoList: [
      {
        nodeId: "23",
        fieldName: "video",
        fieldValue: videoInput,
        description: "上传视频",
      },
      {
        nodeId: "16",
        fieldName: "value",
        fieldValue: resolution,
        description: "最大分辨率设置（爆显存就降低）",
      },
    ],
    instanceType,
    usePersonalQueue: "false",
  };
  const url = `${baseUrl()}/openapi/v2/run/ai-app/${appId()}`;
  log("CREATE_REQUEST", {
    url,
    rhInputSource: "uploaded_binary",
    fileName: videoInput,
    fieldValuePreview: videoInput.slice(0, 120),
    instanceType,
    maxResolution: resolution,
  });
  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...headers(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const taskId =
    pickString(json?.taskId) ||
    pickString(asObject(json?.data)?.taskId) ||
    pickString(asObject(json?.data)?.id) ||
    pickString(json?.id);
  log("CREATE_RESPONSE", {
    ok: response.ok,
    statusCode: response.status,
    taskId: taskId || "",
    message: json?.message || json?.error,
  });
  if (!response.ok || !taskId) {
    throw new Error(`RunningHub 创建超分任务失败 status=${response.status} message=${String(json?.message || json?.error || "未返回 taskId")}`);
  }
  return { taskId };
}

export async function queryRunningHubTask(taskId: string): Promise<RunningHubQueryResult> {
  const url = `${baseUrl()}/openapi/v2/query`;
  log("QUERY_REQUEST", { taskId });
  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...headers(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ taskId }),
  });
  const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || !json) {
    const errorMessage = `RunningHub 查询任务失败 status=${response.status} message=${String(json?.message || json?.error || "空响应")}`;
    log("QUERY_RESPONSE", {
      taskId,
      status: response.status,
      mappedStatus: "failed",
      hasMp4: false,
      hasCover: false,
      errorMessage,
    });
    return {
      status: "failed",
      errorMessage,
    };
  }
  const data = asObject(json?.data);
  const result = asObject(json?.result);
  const statusRaw = data?.status ?? result?.status ?? json?.status;
  const status = mapStatus(statusRaw);
  const outputs = extractOutputs(json);
  const consumeMoneyValue = data?.consumeMoney ?? data?.consume_money ?? json?.consumeMoney;
  const taskCostTimeValue = data?.taskCostTime ?? data?.task_cost_time ?? json?.taskCostTime;
  const consumeMoney = typeof consumeMoneyValue === "number" ? consumeMoneyValue : Number(consumeMoneyValue);
  const taskCostTime = typeof taskCostTimeValue === "number" ? taskCostTimeValue : Number(taskCostTimeValue);
  const failureDetails = extractFailureDetails(json);
  const errorMessage =
    pickString(data?.errorMessage) ||
    pickString(data?.error_message) ||
    failureDetails.exceptionMessage ||
    pickString(json?.message) ||
    pickString(json?.error);
  const detailedErrorMessage = [
    errorMessage,
    failureDetails.errorCode ? `errorCode=${failureDetails.errorCode}` : "",
    failureDetails.exceptionType ? `exception_type=${failureDetails.exceptionType}` : "",
    failureDetails.nodeName ? `node_name=${failureDetails.nodeName}` : "",
  ].filter(Boolean).join(" | ");
  log("QUERY_RESPONSE", {
    taskId,
    rawStatus: statusRaw,
    mappedStatus: status,
    resultsCount: outputs.resultsCount,
    outputTypes: outputs.outputTypes,
    hasMp4: outputs.hasMp4,
    mp4UrlPreview: urlPreview(outputs.videoUrl),
    hasCover: outputs.hasCover,
    coverUrlPreview: urlPreview(outputs.coverUrl),
    errorMessage: detailedErrorMessage || "",
    errorCode: failureDetails.errorCode || "",
    exceptionType: failureDetails.exceptionType || "",
    nodeName: failureDetails.nodeName || "",
    consumeMoney: Number.isFinite(consumeMoney) ? consumeMoney : undefined,
    taskCostTime: Number.isFinite(taskCostTime) ? taskCostTime : undefined,
    rawPreview: responsePreview(json),
  });
  if (status === "success" && !outputs.hasMp4) {
    return {
      status: "failed",
      consumeMoney: Number.isFinite(consumeMoney) ? consumeMoney : undefined,
      taskCostTime: Number.isFinite(taskCostTime) ? taskCostTime : undefined,
      errorMessage: detailedErrorMessage || "RunningHub SUCCESS 但未返回结果文件",
      errorCode: failureDetails.errorCode,
      exceptionType: failureDetails.exceptionType,
      nodeName: failureDetails.nodeName,
    };
  }
  return {
    status,
    upscaledVideoUrl: outputs.videoUrl,
    upscaledCoverUrl: outputs.coverUrl,
    consumeMoney: Number.isFinite(consumeMoney) ? consumeMoney : undefined,
    taskCostTime: Number.isFinite(taskCostTime) ? taskCostTime : undefined,
    errorMessage: detailedErrorMessage || errorMessage,
    errorCode: failureDetails.errorCode,
    exceptionType: failureDetails.exceptionType,
    nodeName: failureDetails.nodeName,
  };
}

export async function runRunningHubUpscaleWithPolling(originalVideoUrl: string, options?: { existingTaskId?: string; onTaskId?: (taskId: string) => void | Promise<void>; videoId?: string; instanceType?: string; maxResolution?: string }) {
  const pollIntervalMs = Math.max(1000, Number(process.env.RUNNINGHUB_POLL_INTERVAL_MS || 5000));
  const maxAttempts = Math.max(1, Number(process.env.RUNNINGHUB_POLL_MAX_ATTEMPTS || 120));

  let taskId = options?.existingTaskId || "";
  if (!taskId) {
    const uploaded = await uploadRunningHubBinaryFromRemoteUrl(originalVideoUrl, { videoId: options?.videoId });
    log("UPSCALE_INPUT", {
      rhInputSource: "uploaded_binary",
      fileName: uploaded.fileName,
      remoteUrlPreview: originalVideoUrl.slice(0, 120),
    });
    taskId = (await createRunningHubUpscaleTask(uploaded.fileName, { instanceType: options?.instanceType, maxResolution: options?.maxResolution })).taskId;
  }
  await options?.onTaskId?.(taskId);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const result = await queryRunningHubTask(taskId);
    if (result.status === "success") {
      if (!result.upscaledVideoUrl) {
        const errorMessage = result.errorMessage || "超分任务成功但未返回 mp4 输出地址";
        log("UPSCALE_FAILED", {
          taskId,
          status: "SUCCESS_WITHOUT_MP4",
          hasMp4: false,
          hasCover: Boolean(result.upscaledCoverUrl),
          errorMessage,
          consumeMoney: result.consumeMoney,
          taskCostTime: result.taskCostTime,
        });
        return {
          success: false as const,
          taskId,
          errorMessage,
          consumeMoney: result.consumeMoney,
          taskCostTime: result.taskCostTime,
        };
      }
      const persisted = await persistRunningHubOutputs(taskId, { videoUrl: result.upscaledVideoUrl, coverUrl: result.upscaledCoverUrl });
      log("UPSCALE_SUCCESS", {
        taskId,
        status: "SUCCESS",
        hasMp4: true,
        hasCover: Boolean(persisted.coverUrl),
        errorMessage: "",
        consumeMoney: result.consumeMoney,
        taskCostTime: result.taskCostTime,
      });
      return {
        success: true as const,
        taskId,
        upscaledVideoUrl: persisted.videoUrl,
        upscaledCoverUrl: persisted.coverUrl,
        consumeMoney: result.consumeMoney,
        taskCostTime: result.taskCostTime,
      };
    }
    if (result.status === "failed") {
      const errorMessage = result.errorMessage || "超分任务失败";
      if (isRunningHubOomError(`${result.errorCode || ""} ${result.exceptionType || ""} ${result.nodeName || ""} ${errorMessage}`)) {
        console.log("[UPSCALE][OOM_DETECTED]", JSON.stringify({
          taskId: options?.videoId || "",
          runninghubTaskId: taskId,
          errorCode: result.errorCode || "",
          exceptionType: result.exceptionType || "",
          nodeName: result.nodeName || "",
          messagePreview: errorMessage.slice(0, 180),
        }));
      }
      log("UPSCALE_FAILED", {
        taskId,
        status: "FAILED",
        hasMp4: Boolean(result.upscaledVideoUrl),
        hasCover: Boolean(result.upscaledCoverUrl),
        errorMessage,
        errorCode: result.errorCode,
        exceptionType: result.exceptionType,
        nodeName: result.nodeName,
        consumeMoney: result.consumeMoney,
        taskCostTime: result.taskCostTime,
      });
      return {
        success: false as const,
        taskId,
        errorMessage,
        errorCode: result.errorCode,
        exceptionType: result.exceptionType,
        nodeName: result.nodeName,
        consumeMoney: result.consumeMoney,
        taskCostTime: result.taskCostTime,
      };
    }
    await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  log("UPSCALE_FAILED", {
    taskId,
    status: "TIMEOUT",
    hasMp4: false,
    hasCover: false,
    errorMessage: "超分任务超时",
  });
  return {
    success: false as const,
    taskId,
    errorMessage: "超分任务超时",
  };
}

export async function retryVideoUpscale(originalVideoUrl: string, options?: { existingTaskId?: string; onTaskId?: (taskId: string) => void | Promise<void> }) {
  return runRunningHubUpscaleWithPolling(originalVideoUrl, options);
}

/** @deprecated 使用 uploadRunningHubBinaryFromRemoteUrl；保留同名导出以兼容调用方 */
export const uploadRunningHubBinary = uploadRunningHubBinaryFromRemoteUrl;
