import { getStore } from "./store";
import { agentsRepository, tasksRepository, videosRepository } from "./repositories";
import { Task } from "./types";
import { generateVideoScript } from "./gpt";
import { createSora2Task, downloadSora2Video, querySora2Task } from "./sora2";
import { runRunningHubUpscaleWithPolling } from "./runninghub";
import { generateYunwuImage } from "./yunwu-image";
import { enqueueUpscaleJob } from "./upscale-queue";
import { extractCoverAt015FromVideoUrl } from "./video-cover-extractor";
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

const sora2PipelineLog = (stage: "CREATE_RETRY" | "CREATE_FINAL_FAILED", payload: Record<string, unknown>) => {
  console.log(`[SORA2][${stage}]`, JSON.stringify(payload));
};

const upscalePipelineLog = (stage: "RETRY" | "FINAL_FAILED", payload: Record<string, unknown>) => {
  console.log(`[UPSCALE][${stage}]`, JSON.stringify(payload));
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
      if (r.success) return r;
      last = r;
      const msg = r.errorMessage || "视频生成失败";
      if (isSora2GenerationNonRetryable(msg) || !isSora2GenerationRetryable(msg)) {
        sora2PipelineLog("CREATE_FINAL_FAILED", {
          attempt,
          maxAttempts: max,
          delayMs: 0,
          status: String(extractHttpStatusFromText(msg) ?? "non_retryable"),
          code: pickLogCode(msg),
          message: msg,
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
          attempt,
          maxAttempts: max,
          delayMs: 0,
          status: String(extractHttpStatusFromText(msg) ?? "non_retryable"),
          code: pickLogCode(msg),
          message: msg,
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
      });
      await delay(delayMs);
    }
  }
  const msg = last.errorMessage || "视频生成失败";
  sora2PipelineLog("CREATE_FINAL_FAILED", {
    attempt: max,
    maxAttempts: max,
    delayMs: 0,
    status: String(extractHttpStatusFromText(msg) ?? "exhausted"),
    code: pickLogCode(msg),
    message: msg,
  });
  return last;
}

async function runUpscaleWithRetries(originalVideoUrl: string): Promise<UpscalePollResult> {
  const max = PIPELINE_RETRY_MAX_ATTEMPTS;
  let last = { success: false as const, errorMessage: "超分失败" } as UpscalePollResult;
  for (let attempt = 1; attempt <= max; attempt += 1) {
    try {
      const r = await runRunningHubUpscaleWithPolling(originalVideoUrl);
      if (r.success) return r;
      last = r;
      const msg = r.errorMessage || "超分失败";
      if (isUpscaleNonRetryable(msg) || !isUpscaleRetryable(msg)) {
        upscalePipelineLog("FINAL_FAILED", {
          attempt,
          maxAttempts: max,
          delayMs: 0,
          status: String(extractHttpStatusFromText(msg) ?? "non_retryable"),
          code: pickLogCode(msg),
          message: msg,
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
      });
      await delay(delayMs);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      last = { success: false as const, errorMessage: msg } as UpscalePollResult;
      if (isUpscaleNonRetryable(msg) || !isUpscaleRetryable(msg, error)) {
        upscalePipelineLog("FINAL_FAILED", {
          attempt,
          maxAttempts: max,
          delayMs: 0,
          status: String(extractHttpStatusFromText(msg) ?? "non_retryable"),
          code: pickLogCode(msg),
          message: msg,
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
      });
      await delay(delayMs);
    }
  }
  const msg = last.errorMessage || "超分失败";
  upscalePipelineLog("FINAL_FAILED", {
    attempt: max,
    maxAttempts: max,
    delayMs: 0,
    status: String(extractHttpStatusFromText(msg) ?? "exhausted"),
    code: pickLogCode(msg),
    message: msg,
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

  const agent = task.agentId ? agentsRepository.getById(task.agentId) : null;
  let successCount = 0;
  let failedCount = 0;
  const upscaleJobs: Promise<void>[] = [];
  if (task.mode === "image") {
    for (let index = 0; index < task.count; index += 1) {
      const latestTask = tasksRepository.getById(taskId);
      if (!latestTask || latestTask.status === "cancelled") {
        runnerLog("TASK_ABORTED", { taskId, reason: "image task removed or cancelled during execution" });
        return;
      }
      const targetRatio = task.ratio === "9:16" ? "9:16" : "16:9";
      const targetSize = task.ratio === "9:16" ? "1024x1792" : "1792x1024";
      try {
        const result = await generateYunwuImage({
          prompt: task.prompt,
          referenceImageUrl: task.referenceImageUrl,
          ratio: task.ratio,
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
            prompt: task.prompt,
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
            seconds: 0,
            duration: task.duration,
            ratio: targetRatio,
            size: targetSize,
          },
        ])[0];
        runnerLog("IMAGE_SUCCESS_WRITE", {
          taskId: task.id,
          videoId: created.id,
          index: index + 1,
          providerTaskId: result.providerTaskId || "",
          model: result.model,
          imageUrl: result.imageUrl,
        });
      } catch (error) {
        failedCount += 1;
        const errorMessage = error instanceof Error ? error.message : "图片生成异常";
        videosRepository.createMany([
          {
            kind: "image" as const,
            taskId: task.id,
            providerTaskId: "",
            title: `图片${index + 1}（失败）`,
            content: `图片${index + 1}：生成失败｜${errorMessage}`,
            script: [],
            prompt: task.prompt,
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
            seconds: 0,
            duration: task.duration,
            ratio: targetRatio,
            size: targetSize,
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
  for (let index = 0; index < task.count; index += 1) {
    const targetSize = task.ratio === "9:16" ? "720x1280" : "1280x720";
    const targetRatio = task.ratio === "9:16" ? "9:16" : "16:9";
    let scriptResult: Awaited<ReturnType<typeof generateVideoScript>> | null = null;
    try {
      scriptResult = await generateVideoScript({
        theme: task.prompt,
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
          cost: 0.8,
          seconds: soraResult.seconds,
          duration: task.duration,
          ratio: soraResult.ratio || targetRatio,
          size: soraResult.size || targetSize,
        },
      ])[0];

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
        videosRepository.update(created.id, {
          upscaleStatus: "processing",
          upscaleErrorMessage: "",
        });
        let upscaleResult: UpscalePollResult;
        try {
          upscaleResult = await runUpscaleWithRetries(created.originalVideoUrl!);
        } catch (error) {
          upscaleResult = {
            success: false as const,
            errorMessage: error instanceof Error ? error.message : "超分任务异常",
          } as UpscalePollResult;
        }
        if (upscaleResult.success) {
          videosRepository.update(created.id, {
            upscaledVideoUrl: upscaleResult.upscaledVideoUrl,
            upscaledCoverUrl: upscaleResult.upscaledCoverUrl,
            upscaleStatus: "success",
            upscaleTaskId: upscaleResult.taskId,
            upscaleErrorMessage: "",
            upscaleConsumeMoney: upscaleResult.consumeMoney ?? 0,
            upscaleTaskCostTime: upscaleResult.taskCostTime ?? 0,
            videoUrl: upscaleResult.upscaledVideoUrl,
            coverUrl: upscaleResult.upscaledCoverUrl || created.originalCoverUrl || "",
            previewImageUrl: upscaleResult.upscaledVideoUrl,
          });
          void (async () => {
            runnerLog("VIDEO_COVER_ASYNC_START", {
              taskId: task.id,
              videoId: created.id,
              stage: "upscaled",
            });
            try {
              const extracted = await extractCoverAt015FromVideoUrl({
                videoId: created.id,
                sourceVideoUrl: upscaleResult.upscaledVideoUrl,
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
          upscaleErrorMessage: upscaleResult.errorMessage,
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
