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

export async function GET(_: Request, ctx: { params: Promise<{ filename: string }> }) {
  const { filename } = await ctx.params;
  const safeName = path.basename(filename);
  if (!safeName || safeName !== filename) {
    return new NextResponse("Invalid filename", { status: 400 });
  }

  const filePath = path.join(DEPLOY_UPLOADS_DIR, safeName);

  try {
    const bytes = await readFile(filePath);
    const ext = path.extname(safeName).toLowerCase();
    const contentType = contentTypeByExt[ext] || "application/octet-stream";
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new NextResponse("Not Found", { status: 404 });
  }
}

