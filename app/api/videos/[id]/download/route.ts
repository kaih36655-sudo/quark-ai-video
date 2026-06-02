import { NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { tasksRepository, videosRepository } from "@/lib/server/repositories";
import { fetchProviderVideo } from "@/lib/server/provider-video-fetch";
import { resolvePlaybackSource } from "@/lib/server/video-playback";

export const runtime = "nodejs";

const DEPLOY_UPLOADS_DIR = "/www/wwwroot/quark-video-git/public/uploads";

const contentTypeByExt: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
};

const localUploadPathFromUrl = (url?: string, baseUrl?: string) => {
  if (!url) return null;
  let pathname = "";
  if (url.startsWith("/api/uploads/")) {
    pathname = url;
  } else {
    try {
      const parsed = new URL(url, baseUrl);
      pathname = parsed.pathname;
    } catch {
      return null;
    }
  }
  if (!pathname.startsWith("/api/uploads/")) return null;
  const relative = pathname.slice("/api/uploads/".length);
  const parts = relative.split("/").map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return "";
    }
  });
  if (parts.some((part) => !part || part === "." || part === ".." || part.includes("/") || part.includes("\\"))) return null;
  const resolvedBase = path.resolve(DEPLOY_UPLOADS_DIR);
  const resolvedFilePath = path.resolve(DEPLOY_UPLOADS_DIR, ...parts);
  if (!resolvedFilePath.startsWith(`${resolvedBase}${path.sep}`) && resolvedFilePath !== resolvedBase) return null;
  return resolvedFilePath;
};

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const video = videosRepository.getById(id);
  if (!video || video.status !== "success") {
    return new NextResponse("Not Found", { status: 404 });
  }

  const task = tasksRepository.getById(video.taskId);
  const userId = task?.userId ?? "unknown";

  try {
    if (video.kind === "image") {
      const imageUrl = video.videoUrl || video.previewImageUrl || video.coverUrl || video.originalCoverUrl;
      const imagePath = localUploadPathFromUrl(imageUrl, req.url);
      if (!imagePath) {
        throw new Error("未解析到可下载的图片源地址");
      }
      const bytes = await readFile(imagePath);
      const ext = path.extname(imagePath).toLowerCase();
      const filename = `task-${video.taskId}-image-${id}${ext || ".jpg"}`;
      return new NextResponse(bytes, {
        status: 200,
        headers: {
          "Content-Type": contentTypeByExt[ext] || "image/jpeg",
          "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
          "Cache-Control": "private, no-store",
        },
      });
    }
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

    const filename = `task-${video.taskId}-video-${id}.mp4`;
    const localVideoPath = localUploadPathFromUrl(playbackSource.url, req.url);
    if (localVideoPath) {
      try {
        const fileStat = await stat(localVideoPath);
        const ext = path.extname(localVideoPath).toLowerCase();
        const contentType = contentTypeByExt[ext] || "application/octet-stream";
        const stream = Readable.toWeb(createReadStream(localVideoPath)) as ReadableStream;
        return new NextResponse(stream, {
          status: 200,
          headers: {
            "Content-Type": contentType,
            "Content-Length": String(fileStat.size),
            "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
            "Cache-Control": "private, max-age=0",
          },
        });
      } catch {
        return new NextResponse("Not Found", { status: 404 });
      }
    }

    const sourceUrl = /^https?:\/\//i.test(playbackSource.url) ? playbackSource.url : new URL(playbackSource.url, req.url).toString();
    const upstream = await fetchProviderVideo(sourceUrl);
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
