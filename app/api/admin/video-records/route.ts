import { NextRequest, NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/server/auth";
import { listUsers } from "@/lib/server/auth-store";
import { loadPersistedStore } from "@/lib/server/persistence";
import { tasksRepository, videosRepository } from "@/lib/server/repositories";
import type { Task, Video } from "@/lib/server/types";

export const runtime = "nodejs";

type RawTask = Partial<Task> & Record<string, unknown>;
type RawVideo = Partial<Video> & {
  mediaType?: "video" | "image";
  upscaledUrl?: string;
  upscaleError?: string;
  publishedAt?: string;
};

type VideoRecordItem = {
  id: string;
  taskId: string;
  videoId: string | null;
  userId: string;
  userEmail: string;
  topic: string;
  agentName: string;
  seconds: string;
  publishedAt: string;
  status: "成功" | "生成中" | "失败" | "待处理";
  upscaleStatus: "未超分" | "超分中" | "超分成功" | "超分失败";
  canDownload: boolean;
  downloadUrl: string | null;
};

const toStringValue = (value: unknown) => (typeof value === "string" ? value : "");

const parseTimestamp = (value: string) => {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
};

const isImageVideo = (video: RawVideo) => video.kind === "image" || video.mediaType === "image";

const isImageTask = (task: RawTask) => task.mode === "image";

const statusLabel = (task?: RawTask, video?: RawVideo): VideoRecordItem["status"] => {
  const status = video?.status ?? task?.status;
  if (status === "success") return "成功";
  if (status === "failed" || status === "cancelled") return "失败";
  if (status === "running") return "生成中";
  return "待处理";
};

const upscaleStatusLabel = (video?: RawVideo): VideoRecordItem["upscaleStatus"] => {
  if (!video) return "未超分";
  const upscaledUrl = video.upscaledVideoUrl || video.upscaledUrl;
  if (video.upscaleStatus === "success" && upscaledUrl) return "超分成功";
  if (video.upscaleStatus === "queued" || video.upscaleStatus === "pending" || video.upscaleStatus === "processing") return "超分中";
  if (video.upscaleStatus === "failed" || video.upscaleErrorMessage || video.upscaleError) return "超分失败";
  return "未超分";
};

const resolveTopic = (task: RawTask, video?: RawVideo) => {
  const title = toStringValue(video?.title).trim();
  if (title) return title;
  const prompt = toStringValue(task.prompt || video?.prompt).trim();
  if (prompt) return prompt;
  const snapshot = toStringValue(task.promptSnapshot).trim();
  return snapshot ? snapshot.slice(0, 50) : "无主题";
};

const resolveSeconds = (task: RawTask, video?: RawVideo) => {
  const seconds = typeof video?.seconds === "number" ? video.seconds : undefined;
  if (seconds === 4 || seconds === 8 || seconds === 12) return `${seconds}s`;
  const duration = toStringValue(video?.duration || task.duration);
  const match = duration.match(/(4|8|12)s?/);
  return match ? `${match[1]}s` : duration || "无";
};

const hasDownloadSource = (video?: RawVideo) => {
  if (!video || video.status !== "success" || isImageVideo(video)) return false;
  return Boolean(video.upscaledVideoUrl || video.upscaledUrl || video.originalVideoUrl || video.videoUrl);
};

async function loadStoreSnapshot() {
  const saved = await loadPersistedStore();
  if (saved) return saved;
  return {
    tasks: tasksRepository.list(),
    videos: videosRepository.listAll(),
  };
}

export async function GET(req: NextRequest) {
  try {
    await requireAdminUser();
  } catch (error) {
    const message = error instanceof Error ? error.message : "无管理员权限";
    return NextResponse.json({ success: false, message }, { status: message === "请先登录" ? 401 : 403 });
  }

  const pageParam = Number(req.nextUrl.searchParams.get("page") || 1);
  const pageSizeParam = Number(req.nextUrl.searchParams.get("pageSize") || 20);
  const page = Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;
  const pageSize = Math.min(20, Math.max(1, Number.isFinite(pageSizeParam) ? Math.floor(pageSizeParam) : 20));
  const q = (req.nextUrl.searchParams.get("q") || "").trim().toLowerCase();

  const [{ tasks, videos }, users] = await Promise.all([loadStoreSnapshot(), listUsers()]);
  const emailByUserId = new Map(users.map((user) => [user.id, user.email]));
  const videosByTaskId = new Map<string, RawVideo[]>();
  for (const video of videos as RawVideo[]) {
    if (isImageVideo(video)) continue;
    const taskId = toStringValue(video.taskId);
    if (!taskId) continue;
    videosByTaskId.set(taskId, [...(videosByTaskId.get(taskId) ?? []), video]);
  }

  const items: VideoRecordItem[] = [];
  for (const task of tasks as RawTask[]) {
    if (isImageTask(task)) continue;
    const taskId = toStringValue(task.id);
    if (!taskId) continue;
    const taskVideos = videosByTaskId.get(taskId) ?? [];
    const rows = taskVideos.length > 0 ? taskVideos : [undefined];
    for (const video of rows) {
      const videoId = toStringValue(video?.id);
      const userId = toStringValue(task.userId) || "unknown";
      const publishedAt = toStringValue(video?.publishedAt || video?.createdAt || task.createdAt);
      const canDownload = hasDownloadSource(video);
      items.push({
        id: videoId ? `video:${videoId}` : `task:${taskId}`,
        taskId,
        videoId: videoId || null,
        userId,
        userEmail: emailByUserId.get(userId) || "未知用户",
        topic: resolveTopic(task, video),
        agentName: toStringValue(task.agentName).trim() || "无",
        seconds: resolveSeconds(task, video),
        publishedAt,
        status: statusLabel(task, video),
        upscaleStatus: upscaleStatusLabel(video),
        canDownload,
        downloadUrl: canDownload && videoId ? `/api/videos/${encodeURIComponent(videoId)}/download` : null,
      });
    }
  }

  const searched = q
    ? items.filter((item) => item.userId.toLowerCase().includes(q) || item.userEmail.toLowerCase().includes(q))
    : items;
  searched.sort((a, b) => parseTimestamp(b.publishedAt) - parseTimestamp(a.publishedAt));

  const total = searched.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;

  return NextResponse.json({
    items: searched.slice(start, start + pageSize),
    page: safePage,
    pageSize,
    total,
    totalPages,
  });
}
