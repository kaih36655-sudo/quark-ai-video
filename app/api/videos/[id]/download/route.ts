import { NextResponse } from "next/server";
import { tasksRepository, videosRepository } from "@/lib/server/repositories";
import { fetchProviderVideo } from "@/lib/server/provider-video-fetch";
import { resolvePlaybackSource } from "@/lib/server/video-playback";

export const runtime = "nodejs";

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const video = videosRepository.getById(id);
  if (!video || video.status !== "success") {
    return new NextResponse("Not Found", { status: 404 });
  }

  const task = tasksRepository.getById(video.taskId);
  const userId = task?.userId ?? "unknown";

  try {
    const playbackSource = resolvePlaybackSource(video, "video");
    console.log(
      `[VIDEO_PROXY][DOWNLOAD_REQUEST]`,
      JSON.stringify({ userId, videoId: id, taskId: video.taskId })
    );
    if (!playbackSource.url) {
      throw new Error("未解析到可下载的视频源地址");
    }
    console.log(
      `[VIDEO_PROXY][DOWNLOAD_SOURCE]`,
      JSON.stringify({
        userId,
        videoId: id,
        taskId: video.taskId,
        sourceKind: playbackSource.kind,
        sourcePreview: playbackSource.url.slice(0, 120),
      })
    );

    const upstream = await fetchProviderVideo(playbackSource.url);
    const upstreamContentType = upstream.headers.get("content-type") || "";
    const upstreamContentLength = upstream.headers.get("content-length") || "";
    console.log(
      `[VIDEO_PROXY][DOWNLOAD_UPSTREAM_RESPONSE]`,
      JSON.stringify({
        userId,
        videoId: id,
        taskId: video.taskId,
        ok: upstream.ok,
        status: upstream.status,
        contentType: upstreamContentType,
        contentLength: upstreamContentLength,
      })
    );

    if (!upstream.ok || !upstream.body) {
      throw new Error(`上游下载失败 status=${upstream.status}`);
    }
    if (/text\/html|application\/json|text\/plain/i.test(upstreamContentType)) {
      throw new Error(`上游返回非视频内容 contentType=${upstreamContentType || "unknown"}`);
    }

    const filename = `task-${video.taskId}-video-${id}.mp4`;
    const contentType = upstreamContentType || "video/mp4";
    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
    };
    if (upstreamContentLength) {
      headers["Content-Length"] = upstreamContentLength;
    }
    console.log(
      `[VIDEO_PROXY][DOWNLOAD_HEADERS]`,
      JSON.stringify({
        userId,
        videoId: id,
        taskId: video.taskId,
        contentType: headers["Content-Type"],
        contentDisposition: headers["Content-Disposition"],
        contentLength: headers["Content-Length"] || "",
      })
    );

    return new NextResponse(upstream.body, {
      status: 200,
      headers,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "下载代理失败";
    console.error(
      `[VIDEO_PROXY][DOWNLOAD_ERROR]`,
      JSON.stringify({
        userId,
        videoId: id,
        taskId: video.taskId,
        message,
      })
    );
    return NextResponse.json({ success: false, message }, { status: 502 });
  }
}
