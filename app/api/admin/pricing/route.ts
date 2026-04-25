import { NextRequest, NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/server/auth";
import { getPricingConfig, updatePricingConfig } from "@/lib/server/pricing";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireAdminUser();
    const pricing = await getPricingConfig();
    return NextResponse.json({ success: true, data: { pricing } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "无权限";
    return NextResponse.json({ success: false, message }, { status: message === "请先登录" ? 401 : 403 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requireAdminUser();
    const body = await req.json();
    const pricing = await updatePricingConfig(body);
    return NextResponse.json({ success: true, data: { pricing } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存价格失败";
    return NextResponse.json({ success: false, message }, { status: 400 });
  }
}
