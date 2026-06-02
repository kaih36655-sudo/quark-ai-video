import { getStore } from "./store";
import { tasksRepository, videosRepository } from "./repositories";
import { Task, Video } from "./types";
import { generateGrokMediumVideoPlan, generateVideoScript } from "./gpt";
import { createSora2Task, downloadSora2Video, querySora2Task } from "./sora2";
import { runGrokVideoSegments, runGrokVideoWithExtensions } from "./grok-video";
import { isRunningHubOomError, runRunningHubUpscaleWithPolling } from "./runninghub";
import { generateYunwuImage } from "./yunwu-image";
import { enqueueUpscaleJob } from "./upscale-queue";
import { extractCoverAt015FromVideoUrl, saveCoverFromImageUrl } from "./video-cover-extractor";
import { concatMediumVideoSegments, extractMediumVideoReferenceFrame } from "./medium-video-frame";
import { adjustUserBalance } from "./auth-store";
import { getMediumVideoUnitPrice, getUnitPrice } from "./pricing";
import { getManagedAgentById } from "./agent-store";
import {
  PIPELINE_RETRY_BACKOFF_MS,
  PIPELINE_RETRY_MAX_ATTEMPTS,
  extractHttpStatusFromText,
  isSora2GenerationNonRetryable,
  isSora2GenerationRetryable,
  isUpscaleNonRetryable,
  isUpscaleRetryable,
  pickLogCode,
} from "./provider-retry-policy";

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const runnerLog = (stage: string, payload: Record<string, unknown>) => {
  console.log(`[TASK_RUNNER][${stage}]`, JSON.stringify(payload));
};
const mediumVideoLog = (stage: string, payload: Record<string, unknown>) => {
  console.log(`[MEDIUM_VIDEO][${stage}]`, JSON.stringify(payload));
};

const stringifyUnknownError = (value: unknown): string => {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  if (value === null || typeof value === "undefined") return "未知错误";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const sora2PipelineLog = (stage: "CREATE_RETRY" | "CREATE_FINAL_FAILED" | "CREATE_FINAL_SUCCESS", payload: Record<string, unknown>) => {
  console.log(`[SORA2][${stage}]`, JSON.stringify(payload));
};

const upscalePipelineLog = (stage: "RETRY" | "FINAL_FAILED" | "FINAL_SUCCESS" | "SKIP_DUPLICATE" | "RESOURCE_PLAN", payload: Record<string, unknown>) => {
  console.log(`[UPSCALE][${stage}]`, JSON.stringify(payload));
};

async function chargeSuccessfulGenerations(task: Task, successCount: number, unitPrice?: number) {
  if (successCount <= 0) return null;
  const resolvedUnitPrice = Number((unitPrice ?? (await getUnitPrice(task))).toFixed(2));
  const amount = Number((-resolvedUnitPrice * successCount).toFixed(2));
  try {
    await adjustUserBalance({
      userId: task.userId,
      amount,
      reason: task.mode === "image" ? `图片生成成功扣费 x${successCount}` : `视频生成成功扣费 x${successCount}`,
      operatorUserId: "system",
    });
    runnerLog("BALANCE_CHARGED", {
      taskId: task.id,
      userId: task.userId,
      successCount,
      amount,
      unitPrice: resolvedUnitPrice,
    });
    return resolvedUnitPrice;
  } catch (error) {
    runnerLog("BALANCE_CHARGE_FAILED", {
      taskId: task.id,
      userId: task.userId,
      successCount,
      errorMessage: stringifyUnknownError(error),
    });
    return null;
  }
}

function updateSuccessfulRecordCosts(videoIds: string[], unitPrice: number | null) {
  if (unitPrice === null) return;
  videoIds.forEach((videoId) => {
    videosRepository.update(videoId, { cost: unitPrice });
  });
}

const getImageModelLabel = (imageModel?: "image2" | "banana2") => (imageModel === "banana2" ? "Nano Banana2" : imageModel === "image2" ? "image2" : "未记录");
const formatUpscaleErrorMessage = (message?: string) => {
  const raw = message || "超分任务失败";
  return isRunningHubOomError(raw) ? "超分失败：显存不足，已保留原视频" : raw;
};
const getImageApiModel = (imageModel?: "image2" | "banana2") => (imageModel === "banana2" ? "gemini-3.1-flash-image-preview" : imageModel === "image2" ? "gpt-image-2" : undefined);
const pickCoverFallback = (...items: unknown[]) => {
  for (const item of items) {
    const value = item && typeof item === "object" ? item as { upscaledCoverUrl?: unknown; coverUrl?: unknown; coverData?: unknown; originalCoverUrl?: unknown } : null;
    const candidates = [value?.upscaledCoverUrl, value?.coverUrl, value?.coverData, value?.originalCoverUrl];
    const found = candidates.find((candidate) => typeof candidate === "string" && candidate.trim().length > 0);
    if (typeof found === "string") return found;
  }
  return "";
};

function resolveSoraSeconds(duration: string): number {
  if (duration === "4s") return 4;
  if (duration === "8s") return 8;
  if (duration === "12s") return 12;
  const numeric = Number(String(duration).replace(/[^\d]/g, ""));
  if (numeric === 4 || numeric === 8 || numeric === 12) return numeric;
  return 4;
}

type Sora2WaitResult = Awaited<ReturnType<typeof runSora2AndWait>>;
type UpscalePollResult = Awaited<ReturnType<typeof runRunningHubUpscaleWithPolling>>;

async function runSora2GenerationWithRetry(
  prompt: string,
  duration: string,
  ratio: string,
  imageUrl?: string
): Promise<Sora2WaitResult> {
  const max = PIPELINE_RETRY_MAX_ATTEMPTS;
  let last: Sora2WaitResult = {
    success: false,
    providerTaskId: "",
    errorMessage: "视频生成失败",
    seconds: resolveSoraSeconds(duration),
  };
  for (let attempt = 1; attempt <= max; attempt += 1) {
    try {
      const r = await runSora2AndWait(prompt, duration, ratio, imageUrl);
      if (r.success) {
        sora2PipelineLog("CREATE_FINAL_SUCCESS", {
          attempt,
          providerTaskId: r.providerTaskId,
          hasVideoUrl: Boolean(r.videoUrl),
        });
        return r;
      }
      last = r;
      const msg = r.errorMessage || "视频生成失败";
      if (isSora2GenerationNonRetryable(msg) || !isSora2GenerationRetryable(msg)) {
        sora2PipelineLog("CREATE_FINAL_FAILED", {
          attempts: attempt,
          maxAttempts: max,
          finalReason: msg,
          lastStatus: String(extractHttpStatusFromText(msg) ?? "non_retryable"),
          lastCode: pickLogCode(msg),
          lastProviderTaskId: r.providerTaskId || "",
        });
        return { ...r, errorMessage: msg };
      }
      if (attempt === max) break;
      const delayMs = PIPELINE_RETRY_BACKOFF_MS[attempt - 1];
      sora2PipelineLog("CREATE_RETRY", {
        attempt,
        maxAttempts: max,
        delayMs,
        status: String(extractHttpStatusFromText(msg) ?? "retryable"),
        code: pickLogCode(msg),
        message: msg,
        providerTaskId: r.providerTaskId || "",
        retryable: true,
      });
      await delay(delayMs);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      last = {
        success: false as const,
        providerTaskId: "",
        errorMessage: msg,
        seconds: resolveSoraSeconds(duration),
      };
      if (isSora2GenerationNonRetryable(msg) || !isSora2GenerationRetryable(msg, error)) {
        sora2PipelineLog("CREATE_FINAL_FAILED", {
          attempts: attempt,
          maxAttempts: max,
          finalReason: msg,
          lastStatus: String(extractHttpStatusFromText(msg) ?? "non_retryable"),
          lastCode: pickLogCode(msg),
          lastProviderTaskId: "",
        });
        return last;
      }
      if (attempt === max) break;
      const delayMs = PIPELINE_RETRY_BACKOFF_MS[attempt - 1];
      sora2PipelineLog("CREATE_RETRY", {
        attempt,
        maxAttempts: max,
        delayMs,
        status: String(extractHttpStatusFromText(msg) ?? "retryable"),
        code: pickLogCode(msg),
        message: msg,
        providerTaskId: "",
        retryable: true,
      });
      await delay(delayMs);
    }
  }
  const msg = last.errorMessage || "视频生成失败";
  sora2PipelineLog("CREATE_FINAL_FAILED", {
    attempts: max,
    maxAttempts: max,
    finalReason: msg,
    lastStatus: String(extractHttpStatusFromText(msg) ?? "exhausted"),
    lastCode: pickLogCode(msg),
    lastProviderTaskId: last.providerTaskId || "",
  });
  return last;
}

async function runUpscaleWithRetries(
  originalVideoUrl: string,
  options?: { existingTaskId?: string; onTaskId?: (taskId: string) => void | Promise<void>; videoId?: string }
): Promise<UpscalePollResult> {
  const max = PIPELINE_RETRY_MAX_ATTEMPTS;
  let last = { success: false as const, errorMessage: "超分失败" } as UpscalePollResult;
  let currentExistingTaskId = options?.existingTaskId || "";
  let oomFallbackLevel = 0;
  const baseInstanceType = process.env.RUNNINGHUB_UPSCALE_INSTANCE_TYPE || "default";
  const baseResolution = process.env.RUNNINGHUB_UPSCALE_MAX_RESOLUTION || process.env.RUNNINGHUB_MAX_RESOLUTION || "1920";
  const fallbackInstanceType = process.env.RUNNINGHUB_UPSCALE_OOM_FALLBACK_INSTANCE_TYPE || "plus";
  const fallbackResolution = process.env.RUNNINGHUB_UPSCALE_OOM_FALLBACK_RESOLUTION || "1280";
  const resourceForAttempt = () => {
    if (oomFallbackLevel <= 0) return { instanceType: baseInstanceType, maxResolution: baseResolution, reason: "initial" };
    if (oomFallbackLevel === 1) return { instanceType: fallbackInstanceType, maxResolution: baseResolution, reason: "oom_fallback_plus_same_resolution" };
    if (oomFallbackLevel === 2) return { instanceType: fallbackInstanceType, maxResolution: fallbackResolution, reason: "oom_fallback_plus_lower_resolution" };
    return { instanceType: "default", maxResolution: fallbackResolution, reason: "oom_fallback_default_lower_resolution" };
  };
  const isInstancePermissionError = (message: string) => {
    const text = message.toLowerCase();
    return text.includes("401") || text.includes("403") || text.includes("permission") || text.includes("权限") || text.includes("不支持实例") || text.includes("instance");
  };
  for (let attempt = 1; attempt <= max; attempt += 1) {
    const resource = resourceForAttempt();
    upscalePipelineLog("RESOURCE_PLAN", {
      attempt,
      maxAttempts: max,
      instanceType: resource.instanceType,
      maxResolution: resource.maxResolution,
      reason: resource.reason,
    });
    try {
      const r = await runRunningHubUpscaleWithPolling(originalVideoUrl, {
        ...options,
        existingTaskId: currentExistingTaskId,
        instanceType: resource.instanceType,
        maxResolution: resource.maxResolution,
        onTaskId: async (taskId) => {
          currentExistingTaskId = taskId;
          await options?.onTaskId?.(taskId);
        },
      });
      if (r.success) {
        upscalePipelineLog("FINAL_SUCCESS", {
          attempt,
          runninghubTaskId: r.taskId || "",
          hasMp4: Boolean(r.upscaledVideoUrl),
          hasCover: Boolean(r.upscaledCoverUrl),
        });
        return r;
      }
      last = r;
      currentExistingTaskId = "";
      const msg = r.errorMessage || "超分失败";
      const shouldRetryWithDefaultAfterPlusPermission = isInstancePermissionError(msg) && resource.instanceType === fallbackInstanceType && attempt < max;
      if (shouldRetryWithDefaultAfterPlusPermission) {
        oomFallbackLevel = 3;
      } else if (isRunningHubOomError(`${(r as { errorCode?: string }).errorCode || ""} ${(r as { exceptionType?: string }).exceptionType || ""} ${(r as { nodeName?: string }).nodeName || ""} ${msg}`)) {
        oomFallbackLevel += 1;
      }
      if (!shouldRetryWithDefaultAfterPlusPermission && (isUpscaleNonRetryable(msg) || !isUpscaleRetryable(msg))) {
        upscalePipelineLog("FINAL_FAILED", {
          attempts: attempt,
          maxAttempts: max,
          finalReason: msg,
          lastStatus: String(extractHttpStatusFromText(msg) ?? "non_retryable"),
          lastCode: pickLogCode(msg),
          lastRunninghubTaskId: r.taskId || "",
        });
        return { ...r, errorMessage: msg };
      }
      if (attempt === max) break;
      const delayMs = PIPELINE_RETRY_BACKOFF_MS[attempt - 1];
      upscalePipelineLog("RETRY", {
        attempt,
        maxAttempts: max,
        delayMs,
        status: String(extractHttpStatusFromText(msg) ?? "retryable"),
        code: pickLogCode(msg),
        message: msg,
        runninghubTaskId: r.taskId || "",
        retryable: true,
      });
      await delay(delayMs);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      last = { success: false as const, errorMessage: msg } as UpscalePollResult;
      currentExistingTaskId = "";
      const shouldRetryWithDefaultAfterPlusPermission = isInstancePermissionError(msg) && resource.instanceType === fallbackInstanceType && attempt < max;
      if (shouldRetryWithDefaultAfterPlusPermission) {
        oomFallbackLevel = 3;
      } else if (isRunningHubOomError(msg)) {
        oomFallbackLevel += 1;
      }
      if (!shouldRetryWithDefaultAfterPlusPermission && (isUpscaleNonRetryable(msg) || !isUpscaleRetryable(msg, error))) {
        upscalePipelineLog("FINAL_FAILED", {
          attempts: attempt,
          maxAttempts: max,
          finalReason: msg,
          lastStatus: String(extractHttpStatusFromText(msg) ?? "non_retryable"),
          lastCode: pickLogCode(msg),
          lastRunninghubTaskId: "",
        });
        return last;
      }
      if (attempt === max) break;
      const delayMs = PIPELINE_RETRY_BACKOFF_MS[attempt - 1];
      upscalePipelineLog("RETRY", {
        attempt,
        maxAttempts: max,
        delayMs,
        status: String(extractHttpStatusFromText(msg) ?? "retryable"),
        code: pickLogCode(msg),
        message: msg,
        runninghubTaskId: "",
        retryable: true,
      });
      await delay(delayMs);
    }
  }
  const msg = last.errorMessage || "超分失败";
  upscalePipelineLog("FINAL_FAILED", {
    attempts: max,
    maxAttempts: max,
    finalReason: msg,
    lastStatus: String(extractHttpStatusFromText(msg) ?? "exhausted"),
    lastCode: pickLogCode(msg),
    lastRunninghubTaskId: last.taskId || "",
  });
  return last;
}

async function runSora2AndWait(prompt: string, duration: string, ratio: string, imageUrl?: string) {
  const seconds = (() => {
    if (duration === "4s") return 4;
    if (duration === "8s") return 8;
    if (duration === "12s") return 12;
    const numeric = Number(String(duration).replace(/[^\d]/g, ""));
    if (numeric === 4 || numeric === 8 || numeric === 12) return numeric;
    console.warn(
      `[TASK_RUNNER][DURATION_WARN]`,
      JSON.stringify({
        message: "非法时长输入，已兜底到 4s",
        receivedDuration: duration,
        fallbackSeconds: 4,
      })
    );
    return 4;
  })();

  const size: "720x1280" | "1280x720" = ratio === "9:16" ? "720x1280" : "1280x720";
  const orientation: "portrait" | "landscape" = ratio === "9:16" ? "portrait" : "landscape";
  const { taskId } = await createSora2Task({
    prompt,
    images: imageUrl ? [imageUrl] : [],
    orientation,
    size,
    duration: seconds,
  });

  const pollIntervalMs = Math.max(1000, Number(process.env.SORA2_POLL_INTERVAL_MS || 5000));
  const maxPoll = Math.max(1, Number(process.env.SORA2_POLL_MAX_ATTEMPTS || 120));
  const maxAllowedSeconds = Math.floor((pollIntervalMs * maxPoll) / 1000);
  const startedAt = Date.now();
  const completedRetryIntervalMs = 60_000;
  const completedRetryMaxAttempts = 10;
  runnerLog("QUERY_STRATEGY", {
    providerTaskId: taskId,
    pollIntervalMs,
    maxPollAttempts: maxPoll,
    maxAllowedSeconds,
  });
  for (let i = 0; i < maxPoll; i += 1) {
    const result = await querySora2Task(taskId);
    const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
    runnerLog("QUERY_PROGRESS", {
      providerTaskId: taskId,
      pollCount: i + 1,
      status: result.status,
      elapsedSeconds,
      maxAllowedSeconds,
    });
    if (result.status === "succeeded") {
      runnerLog("QUERY_COMPLETED", {
        providerTaskId: taskId,
        queryVideoUrl: result.videoUrl || "",
        queryCoverUrl: result.coverUrl || "",
        size: result.size || "",
        ratio: result.ratio || "",
      });
      let downloadedUrl: string | null = null;
      let downloadErrorCode = "";
      let downloadErrorMessage = "";
      if (!result.videoUrl) {
        const downloadResult = await downloadSora2Video(taskId);
        if (downloadResult.ok) {
          downloadedUrl = downloadResult.url || null;
        } else {
          downloadErrorCode = downloadResult.code || "";
          downloadErrorMessage = downloadResult.message || "download 兜底失败";
          runnerLog("DOWNLOAD_FALLBACK_FAILED", {
            providerTaskId: taskId,
            statusCode: downloadResult.statusCode,
            code: downloadErrorCode,
            message: downloadErrorMessage,
          });
        }
      }
      const finalVideoUrl = result.videoUrl || downloadedUrl || "";
      if (!finalVideoUrl) {
        runnerLog("COMPLETED_RETRY_START", {
          providerTaskId: taskId,
          retryIntervalMs: completedRetryIntervalMs,
          maxAttempts: completedRetryMaxAttempts,
          initialQueryCoverUrl: result.coverUrl || "",
          initialDownloadError: downloadErrorMessage || "",
        });
        let latestCoverUrl = result.coverUrl || "";
        for (let retryIndex = 0; retryIndex < completedRetryMaxAttempts; retryIndex += 1) {
          await delay(completedRetryIntervalMs);
          const retryQuery = await querySora2Task(taskId);
          const retryQueryUrl = retryQuery.videoUrl || "";
          const retryCoverUrl = retryQuery.coverUrl || "";
          if (retryCoverUrl) latestCoverUrl = retryCoverUrl;
          let retryDownloadUrl = "";
          let retryDownloadCode = "";
          let retryDownloadMessage = "";

          if (!retryQueryUrl) {
            const retryDownload = await downloadSora2Video(taskId);
            if (retryDownload.ok && retryDownload.url) {
              retryDownloadUrl = retryDownload.url;
            } else {
              retryDownloadCode = retryDownload.code || "";
              retryDownloadMessage = retryDownload.message || "download 兜底失败";
            }
          }

          const resolvedVideoUrl = retryQueryUrl || retryDownloadUrl;
          runnerLog("COMPLETED_RETRY_PROGRESS", {
            providerTaskId: taskId,
            attempt: retryIndex + 1,
            maxAttempts: completedRetryMaxAttempts,
            queryStatus: retryQuery.status,
            hasQueryVideoUrl: Boolean(retryQueryUrl),
            hasQueryCoverUrl: Boolean(retryCoverUrl),
            hasDownloadVideoUrl: Boolean(retryDownloadUrl),
            downloadCode: retryDownloadCode,
            downloadMessage: retryDownloadMessage,
          });

          if (resolvedVideoUrl) {
            runnerLog("COMPLETED_RETRY_SUCCESS", {
              providerTaskId: taskId,
              attempt: retryIndex + 1,
              videoUrl: resolvedVideoUrl,
              coverUrl: latestCoverUrl,
            });
            return {
              success: true as const,
              providerTaskId: taskId,
              videoUrl: resolvedVideoUrl,
              coverUrl: latestCoverUrl || undefined,
              size: retryQuery.size || result.size,
              ratio: retryQuery.ratio || result.ratio,
              seconds,
            };
          }
        }

        const composedError = [
          "视频任务已完成，但延迟补轮询仍未拿到可用视频地址",
          "query completed 但 url/cover_url 未就绪",
          downloadErrorMessage
            ? `初始 download 兜底失败：${downloadErrorCode ? `${downloadErrorCode} ` : ""}${downloadErrorMessage}`.trim()
            : "",
          `补轮询次数：${completedRetryMaxAttempts}`,
        ]
          .filter(Boolean)
          .join("｜");
        runnerLog("COMPLETED_RETRY_FAILED", {
          providerTaskId: taskId,
          reason: composedError,
          maxAttempts: completedRetryMaxAttempts,
        });
        return {
          success: false as const,
          providerTaskId: taskId,
          errorMessage: composedError,
          seconds,
        };
      }
      runnerLog("QUERY_SUCCESS", {
        providerTaskId: taskId,
        videoUrl: finalVideoUrl,
        coverUrl: result.coverUrl || "",
        size: result.size || "",
        ratio: result.ratio || "",
        elapsedSeconds,
        maxAllowedSeconds,
        decision: "success_with_available_video_url",
      });
      return {
        success: true as const,
        providerTaskId: taskId,
        videoUrl: finalVideoUrl,
        coverUrl: result.coverUrl,
        size: result.size,
        ratio: result.ratio,
        seconds,
      };
    }
    if (result.status === "failed" || result.status === "canceled") {
      runnerLog("QUERY_FAILED", {
        providerTaskId: taskId,
        providerError: result.errorMessage || "未提供错误信息",
        elapsedSeconds,
        maxAllowedSeconds,
      });
      return {
        success: false as const,
        providerTaskId: taskId,
        errorMessage: result.errorMessage || "视频生成失败",
        seconds,
      };
    }
    await delay(pollIntervalMs);
  }
  const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
  runnerLog("QUERY_TIMEOUT", {
    providerTaskId: taskId,
    elapsedSeconds,
    maxAllowedSeconds,
    message: "达到轮询上限，判定超时",
  });
  return {
    success: false as const,
    providerTaskId: taskId,
    errorMessage: "视频生成超时",
    seconds,
  };
}

async function executeTask(taskId: string) {
  const task = tasksRepository.getById(taskId);
  if (!task || task.status === "cancelled") return;
  runnerLog("TASK_START", {
    taskId: task.id,
    agent: task.agentName || task.agentId || "未指定",
    promptPreview: task.prompt.slice(0, 120),
    count: task.count,
    hasReferenceImage: Boolean(task.referenceImageUrl),
  });

  tasksRepository.update(taskId, { status: "queued" });
  await delay(500);
  const queued = tasksRepository.getById(taskId);
  if (!queued || queued.status === "cancelled") return;

  tasksRepository.update(taskId, { status: "running" });
  await delay(1300);
  const running = tasksRepository.getById(taskId);
  if (!running || running.status === "cancelled") return;

  const agent = task.agentId ? await getManagedAgentById(task.agentId) : null;
  const effectivePrompt = task.promptSnapshot || task.prompt;
  const unitPrice = task.mode === "medium_video" ? await getMediumVideoUnitPrice() : await getUnitPrice(task);
  let successCount = 0;
  let failedCount = 0;
  const successfulRecordIds: string[] = [];
  const upscaleJobs: Promise<void>[] = [];
  const enqueueMediumVideoUpscale = (created: Video) => {
    const upscaleJob = enqueueUpscaleJob(task.userId, { videoId: created.id, taskId: task.id }, async () => {
      const currentVideo = videosRepository.getById(created.id);
      if (currentVideo?.upscaledVideoUrl) {
        upscalePipelineLog("SKIP_DUPLICATE", {
          videoId: created.id,
          existingTaskId: currentVideo.upscaleTaskId || "",
          upscaleStatus: currentVideo.upscaleStatus || "",
          reason: "already_has_upscaled_url",
        });
        return;
      }
      const existingTaskId = currentVideo?.upscaleTaskId && ["queued", "pending", "processing"].includes(String(currentVideo.upscaleStatus || ""))
        ? currentVideo.upscaleTaskId
        : "";
      if (existingTaskId) {
        upscalePipelineLog("SKIP_DUPLICATE", {
          videoId: created.id,
          existingTaskId,
          upscaleStatus: currentVideo?.upscaleStatus || "",
          reason: "continue_existing_runninghub_task",
        });
      }
      videosRepository.update(created.id, {
        upscaleStatus: "processing",
        upscaleTaskId: existingTaskId || currentVideo?.upscaleTaskId || "",
        upscaleErrorMessage: "",
      });
      let upscaleResult: UpscalePollResult;
      try {
        upscaleResult = await runUpscaleWithRetries(created.originalVideoUrl!, {
          existingTaskId,
          videoId: created.id,
          onTaskId: (runningHubTaskId) => {
            videosRepository.update(created.id, { upscaleTaskId: runningHubTaskId });
          },
        });
      } catch (error) {
        upscaleResult = {
          success: false as const,
          errorMessage: stringifyUnknownError(error) || "超分任务异常",
        } as UpscalePollResult;
      }
      if (upscaleResult.success) {
        const upscaledVideoUrl = upscaleResult.upscaledVideoUrl || "";
        const latestVideo = videosRepository.getById(created.id);
        const coverFallback = pickCoverFallback({ upscaledCoverUrl: upscaleResult.upscaledCoverUrl }, latestVideo, created);
        videosRepository.update(created.id, {
          upscaledVideoUrl,
          upscaledCoverUrl: upscaleResult.upscaledCoverUrl,
          upscaleStatus: "success",
          upscaleTaskId: upscaleResult.taskId,
          upscaleErrorMessage: "",
          upscaleConsumeMoney: upscaleResult.consumeMoney ?? 0,
          upscaleTaskCostTime: upscaleResult.taskCostTime ?? 0,
          videoUrl: upscaledVideoUrl,
          coverUrl: coverFallback,
          previewImageUrl: upscaledVideoUrl,
        });
        if (!coverFallback && upscaledVideoUrl) {
          void (async () => {
            runnerLog("VIDEO_COVER_ASYNC_START", {
              taskId: task.id,
              videoId: created.id,
              stage: "upscaled",
            });
            try {
              const extracted = await extractCoverAt015FromVideoUrl({
                videoId: created.id,
                sourceVideoUrl: upscaledVideoUrl,
                kind: "upscaled",
              });
              videosRepository.updateCoverFields(created.id, {
                upscaledCoverUrl: extracted.coverUrl,
                coverUrl: extracted.coverUrl,
              });
            } catch (error) {
              runnerLog("VIDEO_COVER_EXTRACT_FAILED", {
                taskId: task.id,
                videoId: created.id,
                stage: "upscaled",
                errorMessage: stringifyUnknownError(error),
              });
            }
          })();
        }
        return;
      }
      videosRepository.update(created.id, {
        upscaleStatus: "failed",
        upscaleTaskId: upscaleResult.taskId,
        upscaleErrorMessage: formatUpscaleErrorMessage(upscaleResult.errorMessage),
        upscaleConsumeMoney: upscaleResult.consumeMoney ?? 0,
        upscaleTaskCostTime: upscaleResult.taskCostTime ?? 0,
        videoUrl: created.originalVideoUrl,
        coverUrl: created.originalCoverUrl || "",
        previewImageUrl: created.originalVideoUrl,
      });
    }).then(
      () => undefined,
      (error) => {
        runnerLog("UPSCALE_JOB_ERROR", {
          taskId: task.id,
          videoId: created.id,
          errorMessage: stringifyUnknownError(error),
        });
      }
    );
    upscaleJobs.push(upscaleJob);
    return upscaleJob;
  };
  const enqueueMediumVideoOriginalCover = (created: Video, providerCoverUrl?: string) => {
    void (async () => {
      runnerLog("VIDEO_COVER_ASYNC_START", {
        taskId: task.id,
        videoId: created.id,
        stage: "original",
        hasProviderCover: Boolean(providerCoverUrl),
      });
      try {
        const sourceVideoUrl = created.originalVideoUrl || created.videoUrl || created.previewImageUrl || "";
        let cover: Awaited<ReturnType<typeof extractCoverAt015FromVideoUrl>>;
        if (providerCoverUrl) {
          try {
            cover = await saveCoverFromImageUrl({
              videoId: created.id,
              sourceImageUrl: providerCoverUrl,
              kind: "original",
            });
          } catch (providerCoverError) {
            console.log("[VIDEO_COVER][PROVIDER_COVER_FAILED_FALLBACK_EXTRACT]", JSON.stringify({
              videoId: created.id,
              providerCoverUrlPreview: providerCoverUrl.slice(0, 140),
              reason: stringifyUnknownError(providerCoverError),
              sourceVideoUrlPreview: sourceVideoUrl.slice(0, 140),
            }));
            try {
              cover = await extractCoverAt015FromVideoUrl({
                videoId: created.id,
                sourceVideoUrl,
                kind: "original",
              });
              console.log("[VIDEO_COVER][FALLBACK_EXTRACT_SUCCESS]", JSON.stringify({
                videoId: created.id,
                coverUrl: cover.coverUrl,
              }));
            } catch (fallbackError) {
              console.log("[VIDEO_COVER][FALLBACK_EXTRACT_FAILED]", JSON.stringify({
                videoId: created.id,
                reason: stringifyUnknownError(fallbackError),
              }));
              throw fallbackError;
            }
          }
        } else {
          cover = await extractCoverAt015FromVideoUrl({
            videoId: created.id,
            sourceVideoUrl,
            kind: "original",
          });
        }
        videosRepository.updateCoverFields(created.id, {
          originalCoverUrl: cover.coverUrl,
          coverUrl: cover.coverUrl,
        });
      } catch (error) {
        runnerLog("VIDEO_COVER_EXTRACT_FAILED", {
          taskId: task.id,
          videoId: created.id,
          stage: "original",
          errorMessage: stringifyUnknownError(error),
        });
      }
    })();
  };
  const enqueueMergedStitchCover = (created: Video, fallbackProviderCoverUrl?: string) => {
    void (async () => {
      console.log("[GROK_VIDEO][STITCH_MERGED_COVER_EXTRACT_START]", JSON.stringify({
        taskId: task.id,
        finalVideoUrl: created.originalVideoUrl || created.videoUrl || "",
      }));
      try {
        const extracted = await extractCoverAt015FromVideoUrl({
          videoId: created.id,
          sourceVideoUrl: created.originalVideoUrl || created.videoUrl || created.previewImageUrl || "",
          kind: "original",
        });
        videosRepository.updateCoverFields(created.id, {
          originalCoverUrl: extracted.coverUrl,
          coverUrl: extracted.coverUrl,
        });
        console.log("[GROK_VIDEO][STITCH_MERGED_COVER_EXTRACT_SUCCESS]", JSON.stringify({
          taskId: task.id,
          coverUrl: extracted.coverUrl,
        }));
      } catch (error) {
        const reason = stringifyUnknownError(error);
        console.log("[GROK_VIDEO][STITCH_MERGED_COVER_EXTRACT_FAILED]", JSON.stringify({
          taskId: task.id,
          reason,
          fallbackCoverUrl: fallbackProviderCoverUrl || "",
        }));
        if (fallbackProviderCoverUrl) {
          enqueueMediumVideoOriginalCover(created, fallbackProviderCoverUrl);
        }
      }
    })();
  };
  if (task.mode === "image") {
    for (let index = 0; index < task.count; index += 1) {
      const latestTask = tasksRepository.getById(taskId);
      if (!latestTask || latestTask.status === "cancelled") {
        runnerLog("TASK_ABORTED", { taskId, reason: "image task removed or cancelled during execution" });
        return;
      }
      const targetRatio = task.ratio === "1:1" || task.ratio === "16:9" ? task.ratio : "9:16";
      const targetImageSize = task.imageSize === "1K" || task.imageSize === "4K" ? task.imageSize : "2K";
      try {
        const result = await generateYunwuImage({
          prompt: effectivePrompt,
          referenceImageUrl: task.referenceImageUrl,
          ratio: task.ratio,
          imageSize: targetImageSize,
          imageModel: task.imageModel,
        });
        successCount += 1;
        const created = videosRepository.createMany([
          {
            kind: "image" as const,
            taskId: task.id,
            providerTaskId: result.providerTaskId,
            title: `图片${index + 1}：${task.prompt.slice(0, 32)}`,
            content: `图片${index + 1}：${task.prompt}${task.referenceImageName ? `｜参考图：${task.referenceImageName}` : ""}`,
            script: [],
            prompt: effectivePrompt,
            status: "success" as const,
            originalCoverUrl: result.imageUrl,
            originalVideoUrl: "",
            upscaledVideoUrl: "",
            upscaledCoverUrl: "",
            upscaleStatus: "idle" as const,
            upscaleTaskId: "",
            upscaleErrorMessage: "",
            upscaleConsumeMoney: 0,
            upscaleTaskCostTime: 0,
            coverUrl: result.imageUrl,
            videoUrl: result.imageUrl,
            previewImageUrl: result.imageUrl,
            referenceImageUrl: task.referenceImageUrl,
            referenceImageName: task.referenceImageName,
            cost: 0,
            duration: "",
            ratio: targetRatio,
            size: targetImageSize,
            imageSize: targetImageSize,
            imageModel: task.imageModel,
            displayModel: result.displayModel,
            imageModelLabel: result.imageModelLabel,
            apiModel: result.apiModel,
          },
        ])[0];
        successfulRecordIds.push(created.id);
        runnerLog("IMAGE_SUCCESS_WRITE", {
          taskId: task.id,
          videoId: created.id,
          index: index + 1,
          providerTaskId: result.providerTaskId || "",
          model: result.model,
          endpoint: result.endpoint,
          imageUrl: result.imageUrl,
        });
      } catch (error) {
        failedCount += 1;
        const errorMessage = stringifyUnknownError(error) || "图片生成异常";
        videosRepository.createMany([
          {
            kind: "image" as const,
            taskId: task.id,
            providerTaskId: "",
            title: `图片${index + 1}（失败）`,
            content: `图片${index + 1}：生成失败｜${errorMessage}`,
            script: [],
            prompt: effectivePrompt,
            status: "failed" as const,
            originalCoverUrl: "",
            originalVideoUrl: "",
            upscaledVideoUrl: "",
            upscaledCoverUrl: "",
            upscaleStatus: "idle" as const,
            upscaleTaskId: "",
            upscaleErrorMessage: "",
            upscaleConsumeMoney: 0,
            upscaleTaskCostTime: 0,
            coverUrl: "",
            previewImageUrl: "",
            errorMessage,
            referenceImageUrl: task.referenceImageUrl,
            referenceImageName: task.referenceImageName,
            cost: 0,
            duration: "",
            ratio: targetRatio,
            size: targetImageSize,
            imageSize: targetImageSize,
            imageModel: task.imageModel,
            displayModel: task.imageModel,
            imageModelLabel: getImageModelLabel(task.imageModel),
            apiModel: getImageApiModel(task.imageModel),
          },
        ]);
        runnerLog("IMAGE_FAILED_WRITE", {
          taskId: task.id,
          index: index + 1,
          finalReason: errorMessage,
        });
      }
    }
    const latestTaskAfterImages = tasksRepository.getById(taskId);
    if (!latestTaskAfterImages || latestTaskAfterImages.status === "cancelled") {
      runnerLog("TASK_ABORTED", { taskId, reason: "image task removed before final status" });
      return;
    }
    const finalStatus = successCount > 0 ? "success" : "failed";
    const chargedUnitPrice = await chargeSuccessfulGenerations(task, successCount, unitPrice);
    updateSuccessfulRecordCosts(successfulRecordIds, chargedUnitPrice);
    tasksRepository.update(taskId, { status: finalStatus });
    runnerLog("TASK_SUMMARY", {
      taskId: task.id,
      phase: "image_generation_complete",
      total: task.count,
      successCount,
      failedCount,
      upscaleSuccessCount: 0,
      upscaleFailedCount: 0,
      finalStatus,
    });
    return;
  }

  if (task.mode === "medium_video") {
    const targetDurationSeconds = (() => {
      const numeric = Number(String(task.duration || "").replace(/[^\d]/g, ""));
      return [10, 20, 30, 40, 50, 60].includes(numeric) ? numeric : Math.max(1, Math.min(6, Math.floor(task.mediumVideoSegments ?? task.count ?? 1))) * 10;
    })();
    const totalUnits = Math.max(1, Math.min(6, targetDurationSeconds / 10));
    const extendCount = Math.max(0, totalUnits - 1);
    const targetSize = task.ratio === "9:16" ? "720x1280" : "1280x720";
    const targetRatio = task.ratio === "9:16" ? "9:16" : "16:9";
    const chainId = `medium-video-${task.id}`;
    let chargedHandled = false;

    const settleSuccessfulMediumCharges = async () => {
      if (chargedHandled) return;
      chargedHandled = true;
      const chargedUnitPrice = await chargeSuccessfulGenerations(task, successCount, unitPrice);
      if (chargedUnitPrice === null) return;
      const totalCost = Number((chargedUnitPrice * successCount).toFixed(2));
      successfulRecordIds.forEach((videoId) => {
        videosRepository.update(videoId, { cost: totalCost });
      });
    };

    mediumVideoLog("TASK_START", {
      taskId: task.id,
      userId: task.userId,
      targetDurationSeconds,
      totalUnits,
      extendCount,
      ratio: targetRatio,
      provider: task.mediumVideoProvider || "grok",
      strategy: task.mediumVideoStrategy || "extend",
      referenceImageSupport: task.referenceImageUrl ? "images" : "none",
    });

    try {
      const latestTask = tasksRepository.getById(taskId);
      if (!latestTask || latestTask.status === "cancelled") {
        runnerLog("TASK_ABORTED", { taskId, reason: "medium video task removed or cancelled before Grok execution" });
        return;
      }

      const plan = await generateGrokMediumVideoPlan({
        theme: effectivePrompt,
        targetDurationSeconds,
        ratio: targetRatio,
        agentName: task.agentName,
        agentDescription: agent?.description,
      });
      mediumVideoLog("GROK_PLAN_CREATED", {
        taskId: task.id,
        title: plan.title,
        targetDurationSeconds,
        outline: plan.outline,
        basePromptPreview: plan.basePrompt.slice(0, 160),
        extensionPromptCount: plan.extensionPrompts.length,
      });

      if (task.mediumVideoProvider === "sora2") {
        throw new Error("当前中视频 Sora2 模式暂不可用，请在后台切换为 Grok。");
      }

      const mediumVideoStrategy = task.mediumVideoStrategy === "stitch" ? "stitch" : "extend";
      const referenceImages = task.referenceImageUrl ? [task.referenceImageUrl] : [];

      if (mediumVideoStrategy === "stitch") {
        const stitchPrompts = [plan.basePrompt, ...plan.extensionPrompts].map((promptText, index) =>
          `${promptText}\n\n硬性要求：这是 Grok 分段拼接模式第 ${index + 1}/${totalUnits} 段；每段约 10 秒；承接上一段最后动作继续，不要重新开头；主体、场景、动作、情绪连续；不要字幕、水印、Logo。`
        );
        const grokResult = await runGrokVideoSegments({
          prompts: stitchPrompts,
          ratio: targetRatio,
          targetDurationSeconds,
          getReferenceImagesForSegment: async (segmentIndex, previousVideoUrl) => {
            if (segmentIndex === 1) return referenceImages;
            if (!previousVideoUrl) return undefined;
            const frame = await extractMediumVideoReferenceFrame({
              taskId: task.id,
              segmentIndex,
              sourceVideoUrl: previousVideoUrl,
            });
            console.log("[GROK_VIDEO][STITCH_FRAME_EXTRACT_SUCCESS]", JSON.stringify({ taskId: task.id, segmentIndex, referenceUrl: frame.referenceUrl }));
            return [frame.referenceUrl];
          },
        });
        successCount = grokResult.successfulUnits;
        failedCount = Math.max(0, totalUnits - successCount);
        let finalVideoUrl = "";
        let completeness = "分段展示";
        let concatError = "";
        if (grokResult.segmentVideoUrls && grokResult.segmentVideoUrls.length > 1 && successCount === totalUnits) {
          console.log("[GROK_VIDEO][STITCH_CONCAT_START]", JSON.stringify({ taskId: task.id, segments: grokResult.segmentVideoUrls.length }));
          try {
            const merged = await concatMediumVideoSegments({ taskId: task.id, segmentUrls: grokResult.segmentVideoUrls, targetDurationSeconds });
            finalVideoUrl = merged.mergedVideoUrl;
            completeness = merged.normalized ? "已拼接" : "已拼接但未规整";
            console.log("[GROK_VIDEO][STITCH_CONCAT_SUCCESS]", JSON.stringify({ taskId: task.id, mergedVideoUrl: merged.mergedVideoUrl }));
          } catch (error) {
            concatError = stringifyUnknownError(error);
            completeness = "拼接失败";
            console.log("[GROK_VIDEO][STITCH_CONCAT_FAILED]", JSON.stringify({ taskId: task.id, reason: concatError }));
          }
        } else if (grokResult.finalVideoUrl && successCount === 1) {
          finalVideoUrl = grokResult.finalVideoUrl;
          completeness = "单段";
        }

        const createdRecords = finalVideoUrl
          ? videosRepository.createMany([
              {
                taskId: task.id,
                providerTaskId: grokResult.finalTaskId || grokResult.providerTaskIds.join(","),
                title: `中视频：${targetDurationSeconds}秒 - ${plan.title}`,
                content: `中视频：${targetDurationSeconds}秒｜模型：Grok｜策略：分段拼接｜目标时长：${targetDurationSeconds}秒｜成功时长：${successCount * 10}秒｜完整性：${completeness}${concatError ? `｜拼接失败：${concatError}` : ""}`,
                script: plan.outline.map((item) => `${item.start}-${item.end}s：${item.summary}`),
                prompt: stitchPrompts.join("\n\n--- SEGMENT ---\n\n"),
                status: "success" as const,
                originalCoverUrl: "",
                originalVideoUrl: finalVideoUrl,
                upscaledVideoUrl: "",
                upscaledCoverUrl: "",
                upscaleStatus: "queued" as const,
                upscaleTaskId: "",
                upscaleErrorMessage: "",
                upscaleConsumeMoney: 0,
                upscaleTaskCostTime: 0,
                coverUrl: "",
                videoUrl: finalVideoUrl,
                previewImageUrl: finalVideoUrl,
                referenceImageUrl: task.referenceImageUrl || "",
                referenceImageName: task.referenceImageName || "",
                cost: 0,
                seconds: successCount * 10,
                duration: `${successCount * 10}s`,
                ratio: targetRatio,
                size: targetSize,
                displayModel: "Grok",
                apiModel: process.env.YUNWU_GROK_VIDEO_MODEL || "grok-video-3-10s",
                mediumVideo: true,
                mediumVideoTaskId: task.id,
                chainId,
                providerTaskIds: grokResult.providerTaskIds,
                segmentVideoUrls: grokResult.segmentVideoUrls,
                isFinalVideoLikelyComplete: completeness === "已拼接",
                mediumVideoProvider: "grok",
                mediumVideoStrategy: "stitch",
                videoModelLabel: "Grok",
                mediumVideoCompleteness: completeness,
                segmentIndex: 1,
                totalSegments: 1,
                segmentTitle: `Grok 中视频 ${completeness}`,
              },
            ])
          : (grokResult.segmentVideoUrls || []).map((url, index) =>
              videosRepository.createMany([
                {
                  taskId: task.id,
                  providerTaskId: grokResult.providerTaskIds[index] || "",
                  title: `中视频片段 ${index + 1}/${totalUnits} - ${plan.title}`,
                  content: `中视频片段 ${index + 1}/${totalUnits}｜模型：Grok｜策略：分段拼接｜完整性：${completeness}${concatError ? `｜拼接失败：${concatError}` : ""}`,
                  script: plan.outline.map((item) => `${item.start}-${item.end}s：${item.summary}`),
                  prompt: stitchPrompts[index] || "",
                  status: "success" as const,
                  originalCoverUrl: "",
                  originalVideoUrl: url,
                  upscaledVideoUrl: "",
                  upscaledCoverUrl: "",
                  upscaleStatus: "idle" as const,
                  upscaleTaskId: "",
                  upscaleErrorMessage: "",
                  upscaleConsumeMoney: 0,
                  upscaleTaskCostTime: 0,
                  coverUrl: "",
                  videoUrl: url,
                  previewImageUrl: url,
                  referenceImageUrl: "",
                  referenceImageName: "",
                  cost: 0,
                  seconds: 10,
                  duration: "10s",
                  ratio: targetRatio,
                  size: targetSize,
                  displayModel: "Grok",
                  apiModel: process.env.YUNWU_GROK_VIDEO_MODEL || "grok-video-3-10s",
                  mediumVideo: true,
                  mediumVideoTaskId: task.id,
                  chainId,
                  providerTaskIds: grokResult.providerTaskIds,
                  segmentVideoUrls: grokResult.segmentVideoUrls,
                  isFinalVideoLikelyComplete: false,
                  mediumVideoProvider: "grok",
                  mediumVideoStrategy: "stitch",
                  videoModelLabel: "Grok",
                  mediumVideoCompleteness: completeness,
                  segmentIndex: index + 1,
                  totalSegments: successCount,
                  segmentTitle: `Grok 中视频片段 ${index + 1}/${successCount}`,
                },
              ])[0]
            );
        createdRecords.forEach((record) => successfulRecordIds.push(record.id));
        createdRecords.forEach((record, index) => {
          if (finalVideoUrl) {
            enqueueMergedStitchCover(record, grokResult.finalCoverUrl);
            return;
          }
          enqueueMediumVideoOriginalCover(record, grokResult.segmentCoverUrls?.[index] || undefined);
        });
        if (finalVideoUrl && createdRecords[0]) {
          enqueueMediumVideoUpscale(createdRecords[0]);
          void Promise.allSettled(upscaleJobs);
        }
        await settleSuccessfulMediumCharges();
        tasksRepository.update(taskId, {
          status: failedCount === 0 && completeness !== "拼接失败" ? "success" : successCount > 0 ? "failed" : "failed",
          mediumVideoSuccessUnits: successCount,
          mediumVideoFailedUnits: failedCount,
          mediumVideoFailedStage: concatError ? "拼接视频" : successCount > 0 ? "分段生成" : "创建视频",
          mediumVideoErrorMessage: concatError || grokResult.error || "",
        });
        return;
      }

      const grokResult = await runGrokVideoWithExtensions({
        basePrompt: plan.basePrompt,
        extensionPrompts: plan.extensionPrompts,
        ratio: targetRatio,
        targetDurationSeconds,
        referenceImages,
      });
      successCount = grokResult.successfulUnits;

      if (!grokResult.ok || !grokResult.finalVideoUrl) {
        failedCount = Math.max(1, totalUnits - successCount);
        const rawErrorMessage = grokResult.error || "Grok 中视频生成失败";
        const errorMessage = successCount > 0 ? `扩展视频失败：${rawErrorMessage}` : rawErrorMessage;
        if (grokResult.finalVideoUrl) {
          const partial = videosRepository.createMany([
            {
              taskId: task.id,
              providerTaskId: grokResult.finalTaskId || grokResult.providerTaskIds.join(","),
              title: `中视频部分完成：${successCount * 10}秒 - ${plan.title}`,
              content: `中视频部分完成：目标 ${targetDurationSeconds} 秒，已成功 ${successCount * 10} 秒｜模型：${process.env.YUNWU_GROK_VIDEO_MODEL || "grok-video-3-10s"}｜providerTaskIds：${grokResult.providerTaskIds.join(", ")}｜是否疑似完整视频：未知｜${task.agentName ? `智能体：${task.agentName}｜` : ""}${errorMessage}`,
              script: plan.outline.map((item) => `${item.start}-${item.end}s：${item.summary}`),
              prompt: [plan.basePrompt, ...plan.extensionPrompts].join("\n\n--- EXTEND ---\n\n"),
              status: "success" as const,
              originalCoverUrl: "",
              originalVideoUrl: grokResult.finalVideoUrl,
              upscaledVideoUrl: "",
              upscaledCoverUrl: "",
              upscaleStatus: "idle" as const,
              upscaleTaskId: "",
              upscaleErrorMessage: "",
              upscaleConsumeMoney: 0,
              upscaleTaskCostTime: 0,
              coverUrl: "",
              videoUrl: grokResult.finalVideoUrl,
              previewImageUrl: grokResult.finalVideoUrl,
              referenceImageUrl: "",
              referenceImageName: "",
              cost: 0,
              seconds: successCount * 10,
              duration: `${successCount * 10}s`,
              ratio: targetRatio,
              size: targetSize,
              displayModel: "Grok",
              apiModel: process.env.YUNWU_GROK_VIDEO_MODEL || "grok-video-3-10s",
              mediumVideo: true,
              mediumVideoTaskId: task.id,
              chainId,
              providerTaskIds: grokResult.providerTaskIds,
              segmentVideoUrls: grokResult.segmentVideoUrls,
              isFinalVideoLikelyComplete: false,
              mediumVideoProvider: "grok",
              mediumVideoStrategy: "extend",
              videoModelLabel: "Grok",
              mediumVideoCompleteness: "待验证",
              segmentIndex: 1,
              totalSegments: 1,
              segmentTitle: `Grok 中视频部分完成 ${successCount * 10}秒`,
            },
          ])[0];
          successfulRecordIds.push(partial.id);
          enqueueMediumVideoOriginalCover(partial, grokResult.finalCoverUrl);
        }
        await settleSuccessfulMediumCharges();
        tasksRepository.update(taskId, {
          status: "failed",
          mediumVideoSuccessUnits: successCount,
          mediumVideoFailedUnits: failedCount,
          mediumVideoFailedStage: successCount > 0 ? "扩展视频" : "创建视频",
          mediumVideoErrorMessage: errorMessage,
        });
        mediumVideoLog("TASK_FAILED", {
          taskId: task.id,
          targetDurationSeconds,
          successUnits: successCount,
          failedUnits: failedCount,
          providerTaskIds: grokResult.providerTaskIds,
          reason: errorMessage,
        });
        return;
      }

      successCount = grokResult.successfulUnits;
      const created = videosRepository.createMany([
        {
          taskId: task.id,
          providerTaskId: grokResult.finalTaskId || grokResult.providerTaskIds.join(","),
          title: `中视频：${targetDurationSeconds}秒 - ${plan.title}`,
          content: `中视频：${targetDurationSeconds}秒｜模型：${process.env.YUNWU_GROK_VIDEO_MODEL || "grok-video-3-10s"}｜目标时长：${targetDurationSeconds}秒｜扩展次数：${extendCount}｜providerTaskIds：${grokResult.providerTaskIds.join(", ")}｜是否疑似完整视频：${grokResult.isFinalVideoLikelyComplete === true ? "是" : "未知"}｜片段/阶段URL数：${grokResult.segmentVideoUrls?.length ?? 0}${task.agentName ? `｜智能体：${task.agentName}` : ""}`,
          script: plan.outline.map((item) => `${item.start}-${item.end}s：${item.summary}`),
          prompt: [plan.basePrompt, ...plan.extensionPrompts].join("\n\n--- EXTEND ---\n\n"),
          status: "success" as const,
          originalCoverUrl: "",
          originalVideoUrl: grokResult.finalVideoUrl,
          upscaledVideoUrl: "",
          upscaledCoverUrl: "",
          upscaleStatus: "queued" as const,
          upscaleTaskId: "",
          upscaleErrorMessage: "",
          upscaleConsumeMoney: 0,
          upscaleTaskCostTime: 0,
          coverUrl: "",
          videoUrl: grokResult.finalVideoUrl,
          previewImageUrl: grokResult.finalVideoUrl,
          referenceImageUrl: "",
          referenceImageName: "",
          cost: 0,
          seconds: targetDurationSeconds,
          duration: `${targetDurationSeconds}s`,
          ratio: targetRatio,
          size: targetSize,
          displayModel: "Grok",
          apiModel: process.env.YUNWU_GROK_VIDEO_MODEL || "grok-video-3-10s",
          mediumVideo: true,
          mediumVideoTaskId: task.id,
          chainId,
          providerTaskIds: grokResult.providerTaskIds,
          segmentVideoUrls: grokResult.segmentVideoUrls,
          isFinalVideoLikelyComplete: grokResult.isFinalVideoLikelyComplete,
          mediumVideoProvider: "grok",
          mediumVideoStrategy: "extend",
          videoModelLabel: "Grok",
          mediumVideoCompleteness: grokResult.isFinalVideoLikelyComplete === true ? "已确认" : "待验证",
          segmentIndex: 1,
          totalSegments: 1,
          segmentTitle: `Grok 中视频 ${targetDurationSeconds}秒`,
        },
      ])[0];
      successfulRecordIds.push(created.id);

      mediumVideoLog("GROK_SUCCESS_WRITE", {
        taskId: task.id,
        videoId: created.id,
        providerTaskIds: grokResult.providerTaskIds,
        finalTaskId: grokResult.finalTaskId,
        targetDurationSeconds,
        isFinalVideoLikelyComplete: grokResult.isFinalVideoLikelyComplete ?? "unknown",
      });

      enqueueMediumVideoOriginalCover(created, grokResult.finalCoverUrl);

      const upscaleJob = enqueueUpscaleJob(task.userId, { videoId: created.id, taskId: task.id }, async () => {
        const currentVideo = videosRepository.getById(created.id);
        if (currentVideo?.upscaledVideoUrl) {
          upscalePipelineLog("SKIP_DUPLICATE", {
            videoId: created.id,
            existingTaskId: currentVideo.upscaleTaskId || "",
            upscaleStatus: currentVideo.upscaleStatus || "",
            reason: "already_has_upscaled_url",
          });
          return;
        }
        const existingTaskId = currentVideo?.upscaleTaskId && ["queued", "pending", "processing"].includes(String(currentVideo.upscaleStatus || ""))
          ? currentVideo.upscaleTaskId
          : "";
        if (existingTaskId) {
          upscalePipelineLog("SKIP_DUPLICATE", {
            videoId: created.id,
            existingTaskId,
            upscaleStatus: currentVideo?.upscaleStatus || "",
            reason: "continue_existing_runninghub_task",
          });
        }
        videosRepository.update(created.id, {
          upscaleStatus: "processing",
          upscaleTaskId: existingTaskId || currentVideo?.upscaleTaskId || "",
          upscaleErrorMessage: "",
        });
        let upscaleResult: UpscalePollResult;
        try {
          upscaleResult = await runUpscaleWithRetries(created.originalVideoUrl!, {
            existingTaskId,
            videoId: created.id,
            onTaskId: (taskId) => {
              videosRepository.update(created.id, { upscaleTaskId: taskId });
            },
          });
        } catch (error) {
          upscaleResult = {
            success: false as const,
            errorMessage: stringifyUnknownError(error) || "超分任务异常",
          } as UpscalePollResult;
        }
        if (upscaleResult.success) {
          const upscaledVideoUrl = upscaleResult.upscaledVideoUrl || "";
          const latestVideo = videosRepository.getById(created.id);
          const coverFallback = pickCoverFallback({ upscaledCoverUrl: upscaleResult.upscaledCoverUrl }, latestVideo, created);
          videosRepository.update(created.id, {
            upscaledVideoUrl,
            upscaledCoverUrl: upscaleResult.upscaledCoverUrl,
            upscaleStatus: "success",
            upscaleTaskId: upscaleResult.taskId,
            upscaleErrorMessage: "",
            upscaleConsumeMoney: upscaleResult.consumeMoney ?? 0,
            upscaleTaskCostTime: upscaleResult.taskCostTime ?? 0,
            videoUrl: upscaledVideoUrl,
            coverUrl: coverFallback,
            previewImageUrl: upscaledVideoUrl,
          });
          if (!coverFallback && upscaledVideoUrl) {
            void (async () => {
              runnerLog("VIDEO_COVER_ASYNC_START", {
                taskId: task.id,
                videoId: created.id,
                stage: "upscaled",
              });
              try {
                const extracted = await extractCoverAt015FromVideoUrl({
                  videoId: created.id,
                  sourceVideoUrl: upscaledVideoUrl,
                  kind: "upscaled",
                });
                videosRepository.updateCoverFields(created.id, {
                  upscaledCoverUrl: extracted.coverUrl,
                  coverUrl: extracted.coverUrl,
                });
              } catch (error) {
                runnerLog("VIDEO_COVER_EXTRACT_FAILED", {
                  taskId: task.id,
                  videoId: created.id,
                  stage: "upscaled",
                  errorMessage: stringifyUnknownError(error),
                });
              }
            })();
          }
          return;
        }
        videosRepository.update(created.id, {
          upscaleStatus: "failed",
          upscaleTaskId: upscaleResult.taskId,
          upscaleErrorMessage: formatUpscaleErrorMessage(upscaleResult.errorMessage),
          upscaleConsumeMoney: upscaleResult.consumeMoney ?? 0,
          upscaleTaskCostTime: upscaleResult.taskCostTime ?? 0,
          videoUrl: created.originalVideoUrl,
          coverUrl: created.originalCoverUrl || "",
          previewImageUrl: created.originalVideoUrl,
        });
      }).then(
        () => undefined,
        (error) => {
          runnerLog("UPSCALE_JOB_ERROR", {
            taskId: task.id,
            videoId: created.id,
            errorMessage: stringifyUnknownError(error),
          });
        }
      );
      upscaleJobs.push(upscaleJob);

      const latestMediumTask = tasksRepository.getById(taskId);
      if (!latestMediumTask || latestMediumTask.status === "cancelled") {
        runnerLog("TASK_ABORTED", { taskId, reason: "medium video task removed before final status" });
        return;
      }
      void Promise.allSettled(upscaleJobs);
      await settleSuccessfulMediumCharges();
      tasksRepository.update(taskId, {
        status: "success",
        mediumVideoSuccessUnits: successCount,
        mediumVideoFailedUnits: 0,
        mediumVideoFailedStage: "",
        mediumVideoErrorMessage: "",
      });
      mediumVideoLog("TASK_SUCCESS", {
        taskId: task.id,
        targetDurationSeconds,
        successUnits: successCount,
        finalVideoId: created.id,
      });
      return;
    } catch (error) {
      const reason = stringifyUnknownError(error) || "中视频任务异常";
      await settleSuccessfulMediumCharges();
      tasksRepository.update(taskId, {
        status: "failed",
        mediumVideoSuccessUnits: successCount,
        mediumVideoFailedUnits: Math.max(0, totalUnits - successCount),
        mediumVideoFailedStage: successCount > 0 ? "扩展视频" : "创建视频",
        mediumVideoErrorMessage: reason,
      });
      mediumVideoLog("TASK_FAILED", {
        taskId: task.id,
        targetDurationSeconds,
        successUnits: successCount,
        reason,
      });
      return;
    }
  }

  for (let index = 0; index < task.count; index += 1) {
    const targetSize = task.ratio === "9:16" ? "720x1280" : "1280x720";
    const targetRatio = task.ratio === "9:16" ? "9:16" : "16:9";
    let scriptResult: Awaited<ReturnType<typeof generateVideoScript>> | null = null;
    try {
      scriptResult = await generateVideoScript({
        theme: effectivePrompt,
        duration: task.duration,
        agentName: task.agentName,
        agentDescription: agent?.description,
        hasReferenceImage: Boolean(task.referenceImageUrl),
        referenceImageName: task.referenceImageName,
        index,
      });
      runnerLog("SCRIPT_READY", {
        taskId: task.id,
        index: index + 1,
        title: scriptResult.title,
        promptPreview: scriptResult.prompt.slice(0, 120),
        scenesCount: scriptResult.scenes.length,
      });
      const latestTask = tasksRepository.getById(taskId);
      if (!latestTask || latestTask.status === "cancelled") {
        runnerLog("TASK_ABORTED", { taskId, reason: "task removed or cancelled during execution" });
        return;
      }
      const soraResult = await runSora2GenerationWithRetry(scriptResult.prompt, task.duration, task.ratio, task.referenceImageUrl);
      if (!soraResult.success) {
        failedCount += 1;
        videosRepository.createMany([
          {
            taskId: task.id,
            providerTaskId: soraResult.providerTaskId,
            title: `${scriptResult.title}（失败）`,
            content: `视频${index + 1}：生成失败｜${soraResult.errorMessage || "未知错误"}`,
            script: scriptResult.scenes,
            prompt: scriptResult.prompt,
            status: "failed" as const,
            originalCoverUrl: "",
            originalVideoUrl: "",
            upscaledVideoUrl: "",
            upscaledCoverUrl: "",
            upscaleStatus: "idle" as const,
            upscaleTaskId: "",
            upscaleErrorMessage: "",
            upscaleConsumeMoney: 0,
            upscaleTaskCostTime: 0,
            coverUrl: "",
            previewImageUrl: "",
            errorMessage: soraResult.errorMessage || "生成失败",
            referenceImageUrl: task.referenceImageUrl,
            referenceImageName: task.referenceImageName,
            cost: 0,
            seconds: soraResult.seconds,
            duration: task.duration,
            ratio: targetRatio,
            size: targetSize,
          },
        ]);
        runnerLog("VIDEO_FAILED_WRITE", {
          taskId: task.id,
          index: index + 1,
          providerTaskId: soraResult.providerTaskId,
          finalReason: soraResult.errorMessage || "生成失败",
        });
        continue;
      }
      successCount += 1;
      const created = videosRepository.createMany([
        {
          taskId: task.id,
          providerTaskId: soraResult.providerTaskId,
          title: scriptResult.title,
          content: `视频${index + 1}：${task.prompt}｜灵感参考：${scriptResult.scenes.join("｜")}${task.agentName ? `｜智能体：${task.agentName}` : ""}`,
          script: scriptResult.scenes,
          prompt: scriptResult.prompt,
          status: "success" as const,
          originalCoverUrl: soraResult.coverUrl || "",
          originalVideoUrl: soraResult.videoUrl || "",
          upscaledVideoUrl: "",
          upscaledCoverUrl: "",
          upscaleStatus: "queued" as const,
          upscaleTaskId: "",
          upscaleErrorMessage: "",
          upscaleConsumeMoney: 0,
          upscaleTaskCostTime: 0,
          coverUrl: soraResult.coverUrl || "",
          videoUrl: soraResult.videoUrl || "",
          previewImageUrl: soraResult.videoUrl || "",
          referenceImageUrl: task.referenceImageUrl,
          referenceImageName: task.referenceImageName,
          cost: 0,
          seconds: soraResult.seconds,
          duration: task.duration,
          ratio: soraResult.ratio || targetRatio,
          size: soraResult.size || targetSize,
        },
      ])[0];
      successfulRecordIds.push(created.id);

      runnerLog("VIDEO_SUCCESS_WRITE", {
        taskId: task.id,
        videoId: created.id,
        index: index + 1,
        providerTaskId: soraResult.providerTaskId,
        enqueueUpscale: true,
      });
      void (async () => {
        runnerLog("VIDEO_COVER_ASYNC_START", {
          taskId: task.id,
          videoId: created.id,
          stage: "original",
        });
        try {
          const sourceForCover = created.originalVideoUrl || created.videoUrl || created.previewImageUrl;
          if (sourceForCover) {
            const extracted = await extractCoverAt015FromVideoUrl({
              videoId: created.id,
              sourceVideoUrl: sourceForCover,
              kind: "original",
            });
            videosRepository.updateCoverFields(created.id, {
              originalCoverUrl: extracted.coverUrl,
              coverUrl: extracted.coverUrl,
            });
          }
        } catch (error) {
          runnerLog("VIDEO_COVER_EXTRACT_FAILED", {
            taskId: task.id,
            videoId: created.id,
            stage: "original",
            errorMessage: error instanceof Error ? error.message : "封面抽帧失败",
          });
        }
      })();

      const upscaleJob = enqueueUpscaleJob(task.userId, { videoId: created.id, taskId: task.id }, async () => {
        const currentVideo = videosRepository.getById(created.id);
        if (currentVideo?.upscaledVideoUrl) {
          upscalePipelineLog("SKIP_DUPLICATE", {
            videoId: created.id,
            existingTaskId: currentVideo.upscaleTaskId || "",
            upscaleStatus: currentVideo.upscaleStatus || "",
            reason: "already_has_upscaled_url",
          });
          return;
        }
        const existingTaskId = currentVideo?.upscaleTaskId && ["queued", "pending", "processing"].includes(String(currentVideo.upscaleStatus || ""))
          ? currentVideo.upscaleTaskId
          : "";
        if (existingTaskId) {
          upscalePipelineLog("SKIP_DUPLICATE", {
            videoId: created.id,
            existingTaskId,
            upscaleStatus: currentVideo?.upscaleStatus || "",
            reason: "continue_existing_runninghub_task",
          });
        }
        videosRepository.update(created.id, {
          upscaleStatus: "processing",
          upscaleTaskId: existingTaskId || currentVideo?.upscaleTaskId || "",
          upscaleErrorMessage: "",
        });
        let upscaleResult: UpscalePollResult;
        try {
          upscaleResult = await runUpscaleWithRetries(created.originalVideoUrl!, {
            existingTaskId,
            videoId: created.id,
            onTaskId: (taskId) => {
              videosRepository.update(created.id, { upscaleTaskId: taskId });
            },
          });
        } catch (error) {
          upscaleResult = {
            success: false as const,
            errorMessage: error instanceof Error ? error.message : "超分任务异常",
          } as UpscalePollResult;
        }
        if (upscaleResult.success) {
          const upscaledVideoUrl = upscaleResult.upscaledVideoUrl || "";
          const latestVideo = videosRepository.getById(created.id);
          const coverFallback = pickCoverFallback({ upscaledCoverUrl: upscaleResult.upscaledCoverUrl }, latestVideo, created);
          videosRepository.update(created.id, {
            upscaledVideoUrl,
            upscaledCoverUrl: upscaleResult.upscaledCoverUrl,
            upscaleStatus: "success",
            upscaleTaskId: upscaleResult.taskId,
            upscaleErrorMessage: "",
            upscaleConsumeMoney: upscaleResult.consumeMoney ?? 0,
            upscaleTaskCostTime: upscaleResult.taskCostTime ?? 0,
            videoUrl: upscaledVideoUrl,
            coverUrl: coverFallback,
            previewImageUrl: upscaledVideoUrl,
          });
          if (!upscaledVideoUrl) return;
          void (async () => {
            runnerLog("VIDEO_COVER_ASYNC_START", {
              taskId: task.id,
              videoId: created.id,
              stage: "upscaled",
            });
            try {
              const extracted = await extractCoverAt015FromVideoUrl({
                videoId: created.id,
                sourceVideoUrl: upscaledVideoUrl,
                kind: "upscaled",
              });
              videosRepository.updateCoverFields(created.id, {
                upscaledCoverUrl: extracted.coverUrl,
                coverUrl: extracted.coverUrl,
              });
            } catch (error) {
              runnerLog("VIDEO_COVER_EXTRACT_FAILED", {
                taskId: task.id,
                videoId: created.id,
                stage: "upscaled",
                errorMessage: error instanceof Error ? error.message : "封面抽帧失败",
              });
            }
          })();
          return;
        }
        videosRepository.update(created.id, {
          upscaleStatus: "failed",
          upscaleTaskId: upscaleResult.taskId,
          upscaleErrorMessage: formatUpscaleErrorMessage(upscaleResult.errorMessage),
          upscaleConsumeMoney: upscaleResult.consumeMoney ?? 0,
          upscaleTaskCostTime: upscaleResult.taskCostTime ?? 0,
          videoUrl: created.originalVideoUrl,
          coverUrl: created.originalCoverUrl || "",
          previewImageUrl: created.originalVideoUrl,
        });
      }).then(
        () => undefined,
        (error) => {
          runnerLog("UPSCALE_JOB_ERROR", {
            taskId: task.id,
            videoId: created.id,
            errorMessage: error instanceof Error ? error.message : "超分队列任务异常",
          });
        }
      );
      upscaleJobs.push(upscaleJob);
    } catch (error) {
      failedCount += 1;
      const errMsg = error instanceof Error ? error.message : String(error);
      const sr = scriptResult;
      const titleBase = sr?.title ?? `视频${index + 1}`;
      const scenes = sr?.scenes ?? [];
      const promptText = sr?.prompt ?? "";
      videosRepository.createMany([
        {
          taskId: task.id,
          providerTaskId: "",
          title: `${titleBase}（失败）`,
          content: `视频${index + 1}：生成异常｜${errMsg}`,
          script: scenes,
          prompt: promptText,
          status: "failed" as const,
          originalCoverUrl: "",
          originalVideoUrl: "",
          upscaledVideoUrl: "",
          upscaledCoverUrl: "",
          upscaleStatus: "idle" as const,
          upscaleTaskId: "",
          upscaleErrorMessage: "",
          upscaleConsumeMoney: 0,
          upscaleTaskCostTime: 0,
          coverUrl: "",
          previewImageUrl: "",
          errorMessage: errMsg,
          referenceImageUrl: task.referenceImageUrl,
          referenceImageName: task.referenceImageName,
          cost: 0,
          seconds: resolveSoraSeconds(task.duration),
          duration: task.duration,
          ratio: targetRatio,
          size: targetSize,
        },
      ]);
      runnerLog("VIDEO_FAILED_WRITE", {
        taskId: task.id,
        index: index + 1,
        providerTaskId: "",
        finalReason: errMsg,
      });
    }
  }

  const latestTaskAfterLoop = tasksRepository.getById(taskId);
  if (!latestTaskAfterLoop || latestTaskAfterLoop.status === "cancelled") {
    runnerLog("TASK_ABORTED", { taskId, reason: "task removed before final status" });
    return;
  }

  void Promise.allSettled(upscaleJobs);

  const taskVideos = videosRepository.listByTaskId(taskId);
  const upscaleSuccessCount = taskVideos.filter((v) => v.status === "success" && v.upscaleStatus === "success").length;
  const upscaleFailedCount = taskVideos.filter((v) => v.status === "success" && v.upscaleStatus === "failed").length;

  const finalStatus = successCount > 0 ? "success" : "failed";
  const chargedUnitPrice = await chargeSuccessfulGenerations(task, successCount, unitPrice);
  updateSuccessfulRecordCosts(successfulRecordIds, chargedUnitPrice);
  tasksRepository.update(taskId, { status: finalStatus });

  runnerLog("TASK_SUMMARY", {
    taskId: task.id,
    phase: "generation_complete",
    total: task.count,
    successCount,
    failedCount,
    upscaleSuccessCount,
    upscaleFailedCount,
    finalStatus,
  });
}

export function scheduleTask(task: Task) {
  const store = getStore();
  if (store.timers.has(task.id)) {
    clearTimeout(store.timers.get(task.id)!);
    store.timers.delete(task.id);
  }

  const run = () => {
    void executeTask(task.id);
    store.timers.delete(task.id);
  };

  if (task.status === "waiting" && task.scheduledAt) {
    const waitMs = Math.max(0, Date.parse(task.scheduledAt) - Date.now());
    const timer = setTimeout(run, waitMs);
    store.timers.set(task.id, timer);
    return;
  }

  const timer = setTimeout(run, 10);
  store.timers.set(task.id, timer);
}

export function cancelScheduledTask(taskId: string) {
  const store = getStore();
  const timer = store.timers.get(taskId);
  if (timer) {
    clearTimeout(timer);
    store.timers.delete(taskId);
  }
}

export function removeTaskTimer(taskId: string) {
  const store = getStore();
  const timer = store.timers.get(taskId);
  if (timer) {
    clearTimeout(timer);
    store.timers.delete(taskId);
  }
}
