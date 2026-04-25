import { NextRequest, NextResponse } from "next/server";
import { agentsRepository, tasksRepository, videosRepository } from "@/lib/server/repositories";
import { scheduleTask } from "@/lib/server/task-runner";
import { ApiResponse } from "@/lib/server/types";

export const runtime = "nodejs";

type CreateTaskBody = {
  prompt?: string;
  mode?: "agent" | "normal" | "image";
  duration?: string;
  ratio?: string;
  imageSize?: "1K" | "2K" | "4K";
  count?: number;
  agentId?: string;
  referenceImageUrl?: string;
  referenceImageName?: string;
  scheduledAt?: string;
};

export async function GET() {
  const tasks = tasksRepository.list();
  const videos = videosRepository.listAll();
  return NextResponse.json<ApiResponse<{ tasks: typeof tasks; videos: typeof videos }>>({
    success: true,
    data: { tasks, videos },
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as CreateTaskBody;
  const prompt = body.prompt?.trim() ?? "";
  const mode = body.mode ?? "normal";
  const duration = body.duration ?? "12s";
  const ratio = body.ratio ?? "16:9";
  const imageSize = body.imageSize === "1K" || body.imageSize === "4K" ? body.imageSize : "2K";
  const count = Number(body.count ?? 1);

  if (!prompt) {
    return NextResponse.json<ApiResponse<null>>({ success: false, message: "prompt 不能为空" }, { status: 400 });
  }
  if (!Number.isFinite(count) || count < 1 || count > 10) {
    return NextResponse.json<ApiResponse<null>>({ success: false, message: "count 必须在 1~10" }, { status: 400 });
  }

  let agentName: string | undefined;
  let accessType: "public" | "restricted" | undefined;
  if (mode === "agent") {
    if (!body.agentId) {
      return NextResponse.json<ApiResponse<null>>({ success: false, message: "智能体模式必须选择 agentId" }, { status: 400 });
    }
    const agent = agentsRepository.getById(body.agentId);
    if (!agent) {
      return NextResponse.json<ApiResponse<null>>({ success: false, message: "智能体不存在或不可用" }, { status: 400 });
    }
    if (agent.accessType === "restricted" && !agent.isAuthorized) {
      return NextResponse.json<ApiResponse<null>>({ success: false, message: "当前智能体尚未获得授权，无法执行任务" }, { status: 403 });
    }
    agentName = agent.name;
    accessType = agent.accessType;
  }

  const isScheduled = Boolean(body.scheduledAt && Date.parse(body.scheduledAt));
  const task = tasksRepository.create({
    userId: "10293",
    agentId: body.agentId,
    agentName,
    agentAccessType: accessType,
    prompt,
    mode,
    duration,
    ratio,
    imageSize: mode === "image" ? imageSize : undefined,
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
