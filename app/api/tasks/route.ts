import { NextRequest, NextResponse } from "next/server";
import { tasksRepository, videosRepository } from "@/lib/server/repositories";
import { scheduleTask } from "@/lib/server/task-runner";
import { ApiResponse } from "@/lib/server/types";
import { getCurrentUser, requireCurrentUser } from "@/lib/server/auth";
import { estimateMediumVideoCost, estimateTaskCost, getPricingConfig } from "@/lib/server/pricing";
import { canUserUseAgent, composeAgentPrompt, getManagedAgentById } from "@/lib/server/agent-store";
import { getModelConfig } from "@/lib/server/model-config";

export const runtime = "nodejs";

type CreateTaskBody = {
  prompt?: string;
  mode?: "agent" | "normal" | "image" | "medium_video";
  duration?: string;
  ratio?: string;
  imageSize?: "1K" | "2K" | "4K";
  imageModel?: "image2" | "banana2";
  count?: number;
  mediumVideoSegments?: number;
  mediumVideoStrategy?: "extend" | "stitch";
  agentId?: string;
  referenceImageUrl?: string;
  referenceImageName?: string;
  scheduledAt?: string;
};

const parseMediumVideoDuration = (value: unknown, provider?: string) => {
  const seconds = Number(String(value ?? "").replace(/[^\d]/g, ""));
  const allowedSeconds = provider === "sora2" ? [12, 24, 36, 48, 60] : [10, 20, 30, 40, 50, 60];
  return allowedSeconds.includes(seconds) ? seconds : null;
};

export async function GET() {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json<ApiResponse<{ tasks: never[]; videos: never[] }>>({
      success: true,
      data: { tasks: [], videos: [] },
    });
  }
  const allTasks = tasksRepository.list();
  const tasks = currentUser.role === "admin" ? allTasks : allTasks.filter((task) => task.userId === currentUser.id);
  const taskIds = new Set(tasks.map((task) => task.id));
  const videos = videosRepository.listAll().filter((video) => taskIds.has(video.taskId));
  return NextResponse.json<ApiResponse<{ tasks: typeof tasks; videos: typeof videos }>>({
    success: true,
    data: { tasks, videos },
  });
}

export async function POST(req: NextRequest) {
  let currentUser: Awaited<ReturnType<typeof requireCurrentUser>>;
  try {
    currentUser = await requireCurrentUser();
  } catch (error) {
    const message = error instanceof Error ? error.message : "请先登录";
    return NextResponse.json<ApiResponse<null>>({ success: false, message }, { status: 401 });
  }
  const body = (await req.json()) as CreateTaskBody;
  const prompt = body.prompt?.trim() ?? "";
  const mode = body.mode === "agent" || body.mode === "image" || body.mode === "medium_video" ? body.mode : "normal";
  const modelConfig = await getModelConfig();
  const mediumVideoProvider = mode === "medium_video" ? modelConfig.mediumVideo.activeModel : undefined;
  const mediumVideoTargetSeconds = mode === "medium_video" ? parseMediumVideoDuration(body.duration, mediumVideoProvider) : null;
  const mediumVideoUnitSeconds = mediumVideoProvider === "sora2" ? 12 : 10;
  const mediumVideoSegments = mediumVideoTargetSeconds ? mediumVideoTargetSeconds / mediumVideoUnitSeconds : 1;
  const duration = mode === "medium_video" ? `${mediumVideoTargetSeconds ?? 10}s` : body.duration ?? "12s";
  const ratio = body.ratio ?? "16:9";
  const imageSize = body.imageSize === "1K" || body.imageSize === "4K" ? body.imageSize : "2K";
  const requestedImageModel = body.imageModel === "banana2" || body.imageModel === "image2" ? body.imageModel : undefined;
  const imageAvailableModels = (body.agentId ? modelConfig.agentImage.availableModels : modelConfig.plainImage.availableModels)
    .filter((item): item is "image2" | "banana2" => item === "image2" || item === "banana2");
  const imageModel = mode === "image" ? requestedImageModel || imageAvailableModels[0] : requestedImageModel || "image2";
  const count = mode === "medium_video" ? mediumVideoSegments : Number(body.count ?? 1);
  const mediumVideoStrategy = body.mediumVideoStrategy === "stitch" ? "stitch" : "extend";

  if (!prompt) {
    return NextResponse.json<ApiResponse<null>>({ success: false, message: "prompt 不能为空" }, { status: 400 });
  }
  if (mode === "medium_video" && !mediumVideoTargetSeconds) {
    const allowedText = mediumVideoProvider === "sora2" ? "12/24/36/48/60" : "10/20/30/40/50/60";
    return NextResponse.json<ApiResponse<null>>({ success: false, message: `中视频目标时长必须是 ${allowedText} 秒` }, { status: 400 });
  }
  if (mode === "medium_video" && mediumVideoProvider !== "grok" && mediumVideoProvider !== "sora2") {
    return NextResponse.json<ApiResponse<null>>({ success: false, message: "当前中视频模型配置不可用，请联系管理员。" }, { status: 400 });
  }
  if (mode === "medium_video" && mediumVideoProvider === "sora2") {
    return NextResponse.json<ApiResponse<null>>({ success: false, message: "当前中视频 Sora2 模式暂不可用，请在后台切换为 Grok。" }, { status: 400 });
  }
  if (mode === "image") {
    if (!imageAvailableModels.length) {
      return NextResponse.json<ApiResponse<null>>({ success: false, message: "当前图片模型不可用，请联系管理员" }, { status: 400 });
    }
    const rawImageModel = typeof body.imageModel === "string" && body.imageModel.trim() ? body.imageModel.trim() : "";
    if (rawImageModel && (!requestedImageModel || !imageAvailableModels.includes(requestedImageModel))) {
      console.log("[TASK_CREATE][IMAGE_MODEL_BLOCKED]", JSON.stringify({
        userId: currentUser.id,
        requestedModel: rawImageModel,
        allowedModels: imageAvailableModels,
        mode,
        hasAgentId: Boolean(body.agentId),
      }));
      return NextResponse.json<ApiResponse<null>>({ success: false, message: "当前图片模型已被管理员停用，请切换其他模型" }, { status: 400 });
    }
  }
  if (!Number.isFinite(count) || count < 1 || count > (mode === "medium_video" ? 6 : 10)) {
    return NextResponse.json<ApiResponse<null>>({ success: false, message: "count 必须在 1~10" }, { status: 400 });
  }
  const pricing = await getPricingConfig();
  if (mode === "image" && !pricing.image_enabled) {
    return NextResponse.json<ApiResponse<null>>({ success: false, message: "通道维护升级中请稍后再试" }, { status: 503 });
  }
  if (mode !== "image" && !pricing.video_enabled) {
    return NextResponse.json<ApiResponse<null>>({ success: false, message: "通道维护升级中请稍后再试" }, { status: 503 });
  }
  const estimateCost = mode === "medium_video" ? await estimateMediumVideoCost(mediumVideoSegments) : await estimateTaskCost({ mode, duration, imageSize, imageModel, count });
  if (currentUser.balance < estimateCost) {
    return NextResponse.json<ApiResponse<null>>({ success: false, message: `余额不足，预计需要 ¥${estimateCost.toFixed(2)}` }, { status: 402 });
  }

  let agentName: string | undefined;
  let accessType: "public" | "restricted" | undefined;
  let promptSnapshot = prompt;
  const shouldUseAgent = mode === "agent" || mode === "medium_video" || (mode === "image" && Boolean(body.agentId));
  if (shouldUseAgent) {
    if (!body.agentId) {
      return NextResponse.json<ApiResponse<null>>({ success: false, message: "智能体模式必须选择 agentId" }, { status: 400 });
    }
    const agent = await getManagedAgentById(body.agentId);
    if (!agent) {
      return NextResponse.json<ApiResponse<null>>({ success: false, message: "智能体不存在或不可用" }, { status: 400 });
    }
    if (!canUserUseAgent(currentUser, agent)) {
      return NextResponse.json<ApiResponse<null>>({ success: false, message: "当前智能体尚未获得授权，无法执行任务" }, { status: 403 });
    }
    if ((mode === "agent" || mode === "medium_video") && !(agent.type === "video" || agent.type === "both")) {
      return NextResponse.json<ApiResponse<null>>({ success: false, message: "请选择视频智能体" }, { status: 400 });
    }
    if (mode === "image" && !(agent.type === "image" || agent.type === "both")) {
      return NextResponse.json<ApiResponse<null>>({ success: false, message: "请选择图片智能体" }, { status: 400 });
    }
    agentName = agent.name;
    accessType = agent.visibility === "public" ? "public" : "restricted";
    promptSnapshot = composeAgentPrompt(agent, prompt);
  }

  const isScheduled = Boolean(body.scheduledAt && Date.parse(body.scheduledAt));
  const task = tasksRepository.create({
    userId: currentUser.id,
    agentId: shouldUseAgent ? body.agentId : undefined,
    agentName,
    agentAccessType: accessType,
    prompt,
    promptSnapshot,
    mode,
    duration,
    ratio,
    imageSize: mode === "image" ? imageSize : undefined,
    imageModel: mode === "image" ? imageModel : undefined,
    count,
    mediumVideoSegments: mode === "medium_video" ? mediumVideoSegments : undefined,
    mediumVideoProvider: mode === "medium_video" ? (mediumVideoProvider as "grok" | "sora2") : undefined,
    mediumVideoStrategy: mode === "medium_video" ? mediumVideoStrategy : undefined,
    videoModelLabel: mode === "medium_video" ? (mediumVideoProvider === "sora2" ? "Sora2" : "Grok") : undefined,
    status: isScheduled ? "waiting" : "queued",
    referenceImageUrl: body.referenceImageUrl,
    referenceImageName: body.referenceImageName,
    scheduledAt: isScheduled ? new Date(body.scheduledAt!).toISOString() : undefined,
  });

  scheduleTask(task);

  return NextResponse.json<ApiResponse<{ taskId: string }>>({
    success: true,
    data: { taskId: task.id },
  });
}
