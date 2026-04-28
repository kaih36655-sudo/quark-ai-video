import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/server/auth";
import { getVideoRemixJob } from "@/lib/server/video-remix-store";

export const runtime = "nodejs";

const log = (stage: string, payload: Record<string, unknown>) => {
  console.log(`[VIDEO_REMIX][${stage}]`, JSON.stringify(payload));
};

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireCurrentUser();
    const { id } = await ctx.params;
    const job = await getVideoRemixJob(id);
    if (!job) {
      return NextResponse.json({ ok: false, message: "任务不存在" }, { status: 404 });
    }
    if (job.userId !== user.id && user.role !== "admin") {
      return NextResponse.json({ ok: false, message: "无权限查看该任务" }, { status: 403 });
    }
    log("JOB_POLL", {
      jobId: job.id,
      userId: user.id,
      status: job.status,
    });
    if (job.status === "success") {
      return NextResponse.json({
        ok: true,
        job: {
          id: job.id,
          status: job.status,
          analysis: job.analysis,
          prompt: job.prompt,
          referenceImageUrl: job.referenceImageUrl,
          referenceImageError: job.referenceImageError,
        },
      });
    }
    if (job.status === "failed") {
      return NextResponse.json({
        ok: true,
        job: {
          id: job.id,
          status: job.status,
          error: job.error || "分析失败",
        },
      });
    }
    return NextResponse.json({
      ok: true,
      job: {
        id: job.id,
        status: job.status,
        message: "正在分析视频，请耐心等待...",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "查询任务失败";
    return NextResponse.json({ ok: false, message }, { status: message === "请先登录" ? 401 : 500 });
  }
}
