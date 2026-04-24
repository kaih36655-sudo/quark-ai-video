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

  if (variant === "cover") {
    const source = playbackSource.url;
    const isLocalUploadsCover = (() => {
      if (!source) return false;
      const lower = source.toLowerCase();
      if (lower.startsWith("/api/uploads/")) return true;
      try {
        const parsed = new URL(source);
        return parsed.pathname.toLowerCase().startsWith("/api/uploads/");
      } catch {
        return false;
      }
    })();
    if (isLocalUploadsCover) {
      if (source.startsWith("http://") || source.startsWith("https://")) {
        return NextResponse.redirect(source, 302);
      }
      return new NextResponse(null, {
        status: 302,
        headers: {
          Location: source,
        },
      });
    }
  }

  const upstream = await fetchProviderVideo(playbackSource.url);
  if (!upstream.ok || !upstream.body) {
    return new NextResponse(`Upstream failed: ${upstream.status}`, { status: 502 });
  }

  const contentType =
    upstream.headers.get("content-type") || (variant === "cover" ? "image/jpeg" : "video/mp4");
  const contentLength = upstream.headers.get("content-length") || "";
  const cacheControl =
    variant === "cover"
      ? "public, max-age=300, s-maxage=600, stale-while-revalidate=86400"
      : "private, max-age=3600";
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Cache-Control": cacheControl,
  };
  if (contentLength) {
    headers["Content-Length"] = contentLength;
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers,
  });
}
