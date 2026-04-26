import { NextRequest, NextResponse } from "next/server";
import { tasksRepository, videosRepository } from "@/lib/server/repositories";
import { scheduleTask } from "@/lib/server/task-runner";
import { ApiResponse } from "@/lib/server/types";
import { getCurrentUser, requireCurrentUser } from "@/lib/server/auth";
import { estimateTaskCost, getPricingConfig } from "@/lib/server/pricing";
import { canUserUseAgent, composeAgentPrompt, getManagedAgentById } from "@/lib/server/agent-store";

export const runtime = "nodejs";

type CreateTaskBody = {
  prompt?: string;
  mode?: "agent" | "normal" | "image";
  duration?: string;
  ratio?: string;
  imageSize?: "1K" | "2K" | "4K";
  imageModel?: "image2" | "banana2";
  count?: number;
  agentId?: string;
  referenceImageUrl?: string;
  referenceImageName?: string;
  scheduledAt?: string;
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
  const mode = body.mode ?? "normal";
  const duration = body.duration ?? "12s";
  const ratio = body.ratio ?? "16:9";
  const imageSize = body.imageSize === "1K" || body.imageSize === "4K" ? body.imageSize : "2K";
  const imageModel = body.imageModel === "banana2" ? "banana2" : "image2";
  const count = Number(body.count ?? 1);

  if (!prompt) {
    return NextResponse.json<ApiResponse<null>>({ success: false, message: "prompt 不能为空" }, { status: 400 });
  }
  if (!Number.isFinite(count) || count < 1 || count > 10) {
    return NextResponse.json<ApiResponse<null>>({ success: false, message: "count 必须在 1~10" }, { status: 400 });
  }
  const pricing = await getPricingConfig();
  if (mode === "image" && !pricing.image_enabled) {
    return NextResponse.json<ApiResponse<null>>({ success: false, message: "通道维护升级中请稍后再试" }, { status: 503 });
  }
  if (mode !== "image" && !pricing.video_enabled) {
    return NextResponse.json<ApiResponse<null>>({ success: false, message: "通道维护升级中请稍后再试" }, { status: 503 });
  }
  const estimateCost = await estimateTaskCost({ mode, duration, imageSize, imageModel, count });
  if (currentUser.balance < estimateCost) {
    return NextResponse.json<ApiResponse<null>>({ success: false, message: `余额不足，预计需要 ¥${estimateCost.toFixed(2)}` }, { status: 402 });
  }

  let agentName: string | undefined;
  let accessType: "public" | "restricted" | undefined;
  let promptSnapshot = prompt;
  if (mode === "agent") {
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
    agentName = agent.name;
    accessType = agent.visibility === "public" ? "public" : "restricted";
    promptSnapshot = composeAgentPrompt(agent, prompt);
  }

  const isScheduled = Boolean(body.scheduledAt && Date.parse(body.scheduledAt));
  const task = tasksRepository.create({
    userId: currentUser.id,
    agentId: body.agentId,
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
