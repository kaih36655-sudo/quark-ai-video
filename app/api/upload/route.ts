import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ApiResponse } from "@/lib/server/types";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 4 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json<ApiResponse<null>>({ success: false, message: "缺少上传文件" }, { status: 400 });
  }
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json<ApiResponse<null>>({ success: false, message: "仅支持 jpg/png/webp/gif" }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json<ApiResponse<null>>({ success: false, message: "图片大小不能超过 4MB" }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const ext = file.name.split(".").pop() || "png";
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const uploadDir = path.join(process.cwd(), "public", "uploads");
  await mkdir(uploadDir, { recursive: true });
  await writeFile(path.join(uploadDir, filename), bytes);

  const url = `/uploads/${filename}`;
  return NextResponse.json<ApiResponse<{ url: string; name: string }>>({
    success: true,
    data: { url, name: file.name },
  });
}
