import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

const DEPLOY_UPLOADS_DIR = "/www/wwwroot/quark-video-git/public/uploads";

const contentTypeByExt: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export async function GET(
  _: Request,
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
    const bytes = await readFile(resolvedFilePath);
    const ext = path.extname(resolvedFilePath).toLowerCase();
    const contentType = contentTypeByExt[ext] || "application/octet-stream";
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

