import { NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

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

export async function GET(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const pathParts = (await params).path;
  if (!Array.isArray(pathParts) || pathParts.length === 0) {
    return new NextResponse("Invalid path", { status: 400 });
  }
  if (pathParts.some((part) => !part || part === "." || part === ".." || part.includes("/"))) {
    return new NextResponse("Invalid path", { status: 400 });
  }

  const relativePath = path.join(...pathParts);
  const resolvedBase = path.resolve(DEPLOY_UPLOADS_DIR);
  const resolvedFilePath = path.resolve(DEPLOY_UPLOADS_DIR, relativePath);
  if (!resolvedFilePath.startsWith(`${resolvedBase}${path.sep}`) && resolvedFilePath !== resolvedBase) {
    return new NextResponse("Invalid path", { status: 400 });
  }

  try {
    const ext = path.extname(resolvedFilePath).toLowerCase();
    const contentType = contentTypeByExt[ext] || "application/octet-stream";
    if (ext === ".mp4") {
      const fileStat = await stat(resolvedFilePath);
      const fileSize = fileStat.size;
      const range = req.headers.get("range");
      if (range) {
        const match = range.match(/^bytes=(\d*)-(\d*)$/);
        if (!match) {
          return new NextResponse(null, {
            status: 416,
            headers: { "Content-Range": `bytes */${fileSize}` },
          });
        }
        const [, startText, endText] = match;
        let start = startText ? Number(startText) : 0;
        let end = endText ? Number(endText) : fileSize - 1;
        if (!startText && endText) {
          const suffixLength = Number(endText);
          start = Math.max(0, fileSize - suffixLength);
          end = fileSize - 1;
        }
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= fileSize) {
          return new NextResponse(null, {
            status: 416,
            headers: { "Content-Range": `bytes */${fileSize}` },
          });
        }
        end = Math.min(end, fileSize - 1);
        const chunkSize = end - start + 1;
        const stream = Readable.toWeb(createReadStream(resolvedFilePath, { start, end })) as ReadableStream;
        return new NextResponse(stream, {
          status: 206,
          headers: {
            "Content-Range": `bytes ${start}-${end}/${fileSize}`,
            "Accept-Ranges": "bytes",
            "Content-Length": String(chunkSize),
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
          },
        });
      }
      const stream = Readable.toWeb(createReadStream(resolvedFilePath)) as ReadableStream;
      return new NextResponse(stream, {
        status: 200,
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Length": String(fileSize),
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
        },
      });
    }

    const bytes = await readFile(resolvedFilePath);
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
      },
    });
  } catch {
    return new NextResponse("Not Found", { status: 404 });
  }
}
