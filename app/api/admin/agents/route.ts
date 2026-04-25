import { NextRequest, NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/server/auth";
import { createManagedAgent, listManagedAgents } from "@/lib/server/agent-store";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireAdminUser();
    const agents = await listManagedAgents();
    return NextResponse.json({ success: true, data: { agents } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "无权限";
    return NextResponse.json({ success: false, message }, { status: message === "请先登录" ? 401 : 403 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdminUser();
    const body = await req.json();
    const agent = await createManagedAgent(body);
    return NextResponse.json({ success: true, data: { agent } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "创建智能体失败";
    return NextResponse.json({ success: false, message }, { status: 400 });
  }
}
