import { NextResponse } from "next/server";
import { cancelScheduledTask } from "@/lib/server/task-runner";
import { tasksRepository } from "@/lib/server/repositories";
import { ApiResponse } from "@/lib/server/types";

export const runtime = "nodejs";

export async function POST(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const task = tasksRepository.getById(id);
  if (!task) {
    return NextResponse.json<ApiResponse<null>>({ success: false, message: "任务不存在" }, { status: 404 });
  }
  if (!["waiting", "queued", "running"].includes(task.status)) {
    return NextResponse.json<ApiResponse<null>>({ success: false, message: "该任务状态不可取消" }, { status: 400 });
  }
  cancelScheduledTask(id);
  const updated = tasksRepository.update(id, { status: "cancelled" });
  return NextResponse.json<ApiResponse<{ task: typeof updated }>>({
    success: true,
    data: { task: updated },
  });
}
