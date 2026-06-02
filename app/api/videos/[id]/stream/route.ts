import { NextRequest, NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { tasksRepository, videosRepository } from "@/lib/server/repositories";
import { fetchProviderVideo } from "@/lib/server/provider-video-fetch";
import { resolvePlaybackSource, type PlaybackVariant } from "@/lib/server/video-playback";
import { resolveLocalUploadsSource } from "@/lib/server/local-uploads";

export const runtime = "nodejs";

const getAbsoluteUrl = (url: string, req: Request) => {
  if (url.startsWith("http")) return url;
  return new URL(url, req.url).toString();
};

const parseRange = (range: string | null, fileSize: number) => {
  if (!range) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match) return { invalid: true as const };
  const startText = match[1];
  const endText = match[2];
  if (!startText && !endText) return { invalid: true as const };

  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return { invalid: true as const };
    }
    return {
      start: suffixLength >= fileSize ? 0 : fileSize - suffixLength,
      end: fileSize - 1,
      invalid: false as const,
    };
  }

  const start = Number(startText);
  let end = endText ? Number(endText) : fileSize - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || start >= fileSize) {
    return { invalid: true as const };
  }
  end = Math.min(end, fileSize - 1);
  return { start, end, invalid: false as const };
};

const streamLocalMp4 = (params: {
  filePath: string;
  fileSize: number;
  rangeHeader: string | null;
}) => {
  const parsedRange = parseRange(params.rangeHeader, params.fileSize);
  if (parsedRange?.invalid) {
    return new NextResponse(null, {
      status: 416,
      headers: {
        "Content-Range": `bytes */${params.fileSize}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=0",
      },
    });
  }

  const start = parsedRange ? parsedRange.start : 0;
  const end = parsedRange ? parsedRange.end : params.fileSize - 1;
  const contentLength = end - start + 1;
  const stream = createReadStream(params.filePath, { start, end });
  const headers: Record<string, string> = {
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Content-Length": String(contentLength),
    "Cache-Control": "private, max-age=0",
  };
  if (parsedRange) {
    headers["Content-Range"] = `bytes ${start}-${end}/${params.fileSize}`;
  }
  return new NextResponse(Readable.toWeb(stream) as unknown as BodyInit, {
    status: parsedRange ? 206 : 200,
    headers,
  });
};

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

  if (variant === "cover" && playbackSource.url.toLowerCase().startsWith("/api/uploads/")) {
    const redirectUrl = new URL(playbackSource.url, req.nextUrl.origin);
    return NextResponse.redirect(redirectUrl, 302);
  }

  const localSource = await resolveLocalUploadsSource(playbackSource.url, {
    currentHost: req.nextUrl.hostname,
    currentOrigin: req.nextUrl.origin,
  });
  if (localSource) {
    console.log(
      `[VIDEO_PROXY][LOCAL_STREAM_SOURCE]`,
      JSON.stringify({
        videoId: id,
        taskId: video.taskId,
        sourcePreview: playbackSource.url.slice(0, 120),
        resolvedPath: localSource.resolvedPath,
        range: Boolean(req.headers.get("range")),
        fileSize: localSource.size,
      })
    );
    if (!localSource.exists) {
      return new NextResponse("Local media not found", { status: 404 });
    }
    if (variant === "cover") {
      const redirectUrl = new URL(playbackSource.url, req.nextUrl.origin);
      return NextResponse.redirect(redirectUrl, 302);
    }
    return streamLocalMp4({
      filePath: localSource.resolvedPath,
      fileSize: localSource.size,
      rangeHeader: req.headers.get("range"),
    });
  }

  const finalUrl = getAbsoluteUrl(playbackSource.url, req);
  const upstream = await fetchProviderVideo(finalUrl);
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
