import { fetchProviderVideo } from "./provider-video-fetch";

type RunningHubTaskStatus = "pending" | "processing" | "success" | "failed";

type RunningHubQueryResult = {
  status: RunningHubTaskStatus;
  upscaledVideoUrl?: string;
  upscaledCoverUrl?: string;
  consumeMoney?: number;
  taskCostTime?: number;
  errorMessage?: string;
};

const baseUrl = () => (process.env.RUNNINGHUB_BASE_URL || "https://www.runninghub.cn").replace(/\/$/, "");
const appId = () => process.env.RUNNINGHUB_UPSCALE_APP_ID || "1996062530516795394";
const maxResolution = () => process.env.RUNNINGHUB_MAX_RESOLUTION || "1920";

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
  const resultsRaw = (data?.results ?? payload?.results) as unknown;
  const results = Array.isArray(resultsRaw) ? resultsRaw.map(asObject).filter((item): item is Record<string, unknown> => Boolean(item)) : [];
  let videoUrl: string | undefined;
  let coverUrl: string | undefined;
  for (const result of results) {
    const outputType = String(result.outputType || result.type || "").toLowerCase();
    const url = extractUrlFromResult(result);
    if (!url) continue;
    if (!videoUrl && (outputType.includes("mp4") || url.toLowerCase().includes(".mp4"))) {
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

export async function uploadRunningHubBinaryFromRemoteUrl(remoteUrl: string): Promise<{ fileName: string; downloadUrl?: string }> {
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
    throw new Error(String(json?.message || json?.error || "RunningHub 上传失败"));
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

export async function createRunningHubUpscaleTask(videoInput: string): Promise<{ taskId: string }> {
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
        fieldValue: maxResolution(),
        description: "最大分辨率设置（爆显存就降低）",
      },
    ],
    instanceType: "default",
    usePersonalQueue: "false",
  };
  const url = `${baseUrl()}/openapi/v2/run/ai-app/${appId()}`;
  log("CREATE_REQUEST", {
    url,
    rhInputSource: "uploaded_binary",
    fileName: videoInput,
    fieldValuePreview: videoInput.slice(0, 120),
    maxResolution: maxResolution(),
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
    throw new Error(String(json?.message || json?.error || "RunningHub 创建超分任务失败"));
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
  const data = asObject(json?.data);
  const statusRaw = data?.status ?? json?.status;
  const status = mapStatus(statusRaw);
  const outputs = extractOutputs(json);
  const consumeMoneyValue = data?.consumeMoney ?? data?.consume_money ?? json?.consumeMoney;
  const taskCostTimeValue = data?.taskCostTime ?? data?.task_cost_time ?? json?.taskCostTime;
  const consumeMoney = typeof consumeMoneyValue === "number" ? consumeMoneyValue : Number(consumeMoneyValue);
  const taskCostTime = typeof taskCostTimeValue === "number" ? taskCostTimeValue : Number(taskCostTimeValue);
  const errorMessage =
    pickString(data?.errorMessage) ||
    pickString(data?.error_message) ||
    pickString(json?.message) ||
    pickString(json?.error);
  log("QUERY_RESPONSE", {
    taskId,
    status: statusRaw,
    mappedStatus: status,
    hasMp4: outputs.hasMp4,
    hasCover: outputs.hasCover,
    errorMessage: errorMessage || "",
    consumeMoney: Number.isFinite(consumeMoney) ? consumeMoney : undefined,
    taskCostTime: Number.isFinite(taskCostTime) ? taskCostTime : undefined,
  });
  return {
    status,
    upscaledVideoUrl: outputs.videoUrl,
    upscaledCoverUrl: outputs.coverUrl,
    consumeMoney: Number.isFinite(consumeMoney) ? consumeMoney : undefined,
    taskCostTime: Number.isFinite(taskCostTime) ? taskCostTime : undefined,
    errorMessage,
  };
}

export async function runRunningHubUpscaleWithPolling(originalVideoUrl: string) {
  const pollIntervalMs = Math.max(1000, Number(process.env.RUNNINGHUB_POLL_INTERVAL_MS || 5000));
  const maxAttempts = Math.max(1, Number(process.env.RUNNINGHUB_POLL_MAX_ATTEMPTS || 120));

  const uploaded = await uploadRunningHubBinaryFromRemoteUrl(originalVideoUrl);
  log("UPSCALE_INPUT", {
    rhInputSource: "uploaded_binary",
    fileName: uploaded.fileName,
    remoteUrlPreview: originalVideoUrl.slice(0, 120),
  });
  const { taskId } = await createRunningHubUpscaleTask(uploaded.fileName);

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
      log("UPSCALE_SUCCESS", {
        taskId,
        status: "SUCCESS",
        hasMp4: true,
        hasCover: Boolean(result.upscaledCoverUrl),
        errorMessage: "",
        consumeMoney: result.consumeMoney,
        taskCostTime: result.taskCostTime,
      });
      return {
        success: true as const,
        taskId,
        upscaledVideoUrl: result.upscaledVideoUrl,
        upscaledCoverUrl: result.upscaledCoverUrl,
        consumeMoney: result.consumeMoney,
        taskCostTime: result.taskCostTime,
      };
    }
    if (result.status === "failed") {
      const errorMessage = result.errorMessage || "超分任务失败";
      log("UPSCALE_FAILED", {
        taskId,
        status: "FAILED",
        hasMp4: Boolean(result.upscaledVideoUrl),
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

export async function retryVideoUpscale(originalVideoUrl: string) {
  return runRunningHubUpscaleWithPolling(originalVideoUrl);
}

/** @deprecated 使用 uploadRunningHubBinaryFromRemoteUrl；保留同名导出以兼容调用方 */
export const uploadRunningHubBinary = uploadRunningHubBinaryFromRemoteUrl;
