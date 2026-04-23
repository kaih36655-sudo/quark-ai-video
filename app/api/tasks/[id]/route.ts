import { NextResponse } from "next/server";
import { tasksRepository, videosRepository } from "@/lib/server/repositories";
import { ApiResponse } from "@/lib/server/types";
import { removeTaskTimer } from "@/lib/server/task-runner";

export const runtime = "nodejs";

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const task = tasksRepository.getById(id);
  if (!task) {
    return NextResponse.json<ApiResponse<null>>({ success: false, message: "任务不存在" }, { status: 404 });
  }
  const videos = videosRepository.listByTaskId(id);
  return NextResponse.json<ApiResponse<{ task: typeof task; videos: typeof videos }>>({
    success: true,
    data: { task, videos },
  });
}

export async function DELETE(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const task = tasksRepository.getById(id);
  if (!task) {
    return NextResponse.json<ApiResponse<null>>({ success: false, message: "任务不存在" }, { status: 404 });
  }
  removeTaskTimer(id);
  videosRepository.removeByTaskId(id);
  tasksRepository.removeById(id);
  return NextResponse.json<ApiResponse<{ taskId: string }>>({
    success: true,
    data: { taskId: id },
  });
}
