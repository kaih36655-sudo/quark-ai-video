import { NextRequest, NextResponse } from "next/server";
import { tasksRepository, videosRepository } from "@/lib/server/repositories";
import { fetchProviderVideo } from "@/lib/server/provider-video-fetch";
import { resolvePlaybackSource, type PlaybackVariant } from "@/lib/server/video-playback";

export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const variantParam = req.nextUrl.searchParams.get("variant");
  const variant: PlaybackVariant = variantParam === "cover" ? "cover" : "video";

  const video = videosRepository.getById(id);
  if (!video || video.status !== "success") {
    return new NextResponse("Not Found", { status: 404 });
  }

  const task = tasksRepository.getById(video.taskId);
  const userId = task?.userId ?? "unknown";

  const playbackSource = resolvePlaybackSource(video, variant);
  if (!playbackSource.url) {
    return new NextResponse("No media", { status: 404 });
  }

  console.log(
    `[VIDEO_PROXY][STREAM_REQUEST]`,
    JSON.stringify({ userId, videoId: id, taskId: video.taskId, variant })
  );
  console.log(
    `[VIDEO_PROXY][STREAM_SOURCE]`,
    JSON.stringify({
      userId,
      videoId: id,
      taskId: video.taskId,
      sourceKind: playbackSource.kind,
      sourcePreview: playbackSource.url.slice(0, 120),
    })
  );

  const upstream = await fetchProviderVideo(playbackSource.url);
  if (!upstream.ok || !upstream.body) {
    return new NextResponse(`Upstream failed: ${upstream.status}`, { status: 502 });
  }

  const contentType =
    upstream.headers.get("content-type") || (variant === "cover" ? "image/jpeg" : "video/mp4");

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
