import { NextRequest, NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/server/auth";
import { getModelConfig, updateModelConfig } from "@/lib/server/model-config";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireAdminUser();
    const config = await getModelConfig();
    return NextResponse.json({ success: true, data: { config } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "无权限";
    return NextResponse.json({ success: false, message }, { status: message === "请先登录" ? 401 : 403 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requireAdminUser();
    const config = await updateModelConfig(await req.json());
    return NextResponse.json({ success: true, data: { config } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存模型配置失败";
    return NextResponse.json({ success: false, message }, { status: 400 });
  }
}
