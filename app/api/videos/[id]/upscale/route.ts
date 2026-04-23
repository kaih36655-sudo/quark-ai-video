import { NextResponse } from "next/server";
import { ApiResponse } from "@/lib/server/types";
import { tasksRepository, videosRepository } from "@/lib/server/repositories";
import { retryVideoUpscale } from "@/lib/server/runninghub";
import { enqueueUpscaleJob } from "@/lib/server/upscale-queue";

export const runtime = "nodejs";

async function runUpscaleCore(videoId: string): Promise<NextResponse> {
  const video = videosRepository.getById(videoId);
  if (!video) {
    return NextResponse.json<ApiResponse<null>>({ success: false, message: "视频不存在" }, { status: 404 });
  }
  if (video.status !== "success") {
    return NextResponse.json<ApiResponse<null>>({ success: false, message: "仅成功视频可超分" }, { status: 400 });
  }
  const originalVideoUrl = video.originalVideoUrl || video.videoUrl || video.previewImageUrl;
  if (!originalVideoUrl || originalVideoUrl.startsWith("/api/")) {
    return NextResponse.json<ApiResponse<null>>({ success: false, message: "缺少原始视频地址，无法超分" }, { status: 400 });
  }

  videosRepository.update(videoId, {
    originalVideoUrl,
    originalCoverUrl: video.originalCoverUrl || video.coverUrl || "",
    upscaleStatus: "processing",
    upscaleErrorMessage: "",
  });

  let result: Awaited<ReturnType<typeof retryVideoUpscale>>;
  try {
    result = await retryVideoUpscale(originalVideoUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : "超分任务异常";
    const updated = videosRepository.update(videoId, {
      upscaleStatus: "failed",
      upscaleErrorMessage: message,
      videoUrl: originalVideoUrl,
      coverUrl: video.originalCoverUrl || video.coverUrl || "",
      previewImageUrl: originalVideoUrl,
    });
    return NextResponse.json<ApiResponse<{ video: typeof updated }>>({
      success: false,
      message,
      data: { video: updated },
    });
  }
  if (result.success) {
    const updated = videosRepository.update(videoId, {
      upscaledVideoUrl: result.upscaledVideoUrl,
      upscaledCoverUrl: result.upscaledCoverUrl,
      upscaleStatus: "success",
      upscaleTaskId: result.taskId,
      upscaleErrorMessage: "",
      upscaleConsumeMoney: result.consumeMoney ?? 0,
      upscaleTaskCostTime: result.taskCostTime ?? 0,
      videoUrl: result.upscaledVideoUrl,
      coverUrl: result.upscaledCoverUrl || video.originalCoverUrl || video.coverUrl || "",
      previewImageUrl: result.upscaledVideoUrl,
    });
    return NextResponse.json<ApiResponse<{ video: typeof updated }>>({
      success: true,
      data: { video: updated },
    });
  }

  const updated = videosRepository.update(videoId, {
    upscaleStatus: "failed",
    upscaleTaskId: result.taskId,
    upscaleErrorMessage: result.errorMessage,
    upscaleConsumeMoney: result.consumeMoney ?? 0,
    upscaleTaskCostTime: result.taskCostTime ?? 0,
    videoUrl: originalVideoUrl,
    coverUrl: video.originalCoverUrl || video.coverUrl || "",
    previewImageUrl: originalVideoUrl,
  });
  return NextResponse.json<ApiResponse<{ video: typeof updated }>>({
    success: false,
    message: result.errorMessage || "超分失败",
    data: { video: updated },
  });
}

export async function POST(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const video = videosRepository.getById(id);
  if (!video) {
    return NextResponse.json<ApiResponse<null>>({ success: false, message: "视频不存在" }, { status: 404 });
  }
  if (video.status !== "success") {
    return NextResponse.json<ApiResponse<null>>({ success: false, message: "仅成功视频可超分" }, { status: 400 });
  }
  const task = tasksRepository.getById(video.taskId);
  if (!task) {
    return NextResponse.json<ApiResponse<null>>({ success: false, message: "任务不存在" }, { status: 404 });
  }

  videosRepository.update(id, {
    upscaleStatus: "queued",
    upscaleErrorMessage: "",
  });

  return enqueueUpscaleJob(task.userId, { videoId: id, taskId: video.taskId }, () => runUpscaleCore(id));
}
