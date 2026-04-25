import { NextRequest, NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/server/auth";
import { deleteManagedAgent, updateManagedAgent } from "@/lib/server/agent-store";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminUser();
    const { id } = await ctx.params;
    const body = await req.json();
    const agent = await updateManagedAgent(id, body);
    if (!agent) return NextResponse.json({ success: false, message: "智能体不存在" }, { status: 404 });
    return NextResponse.json({ success: true, data: { agent } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "更新智能体失败";
    return NextResponse.json({ success: false, message }, { status: 400 });
  }
}

export async function DELETE(_: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminUser();
    const { id } = await ctx.params;
    const ok = await deleteManagedAgent(id);
    if (!ok) return NextResponse.json({ success: false, message: "智能体不存在" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "删除智能体失败";
    return NextResponse.json({ success: false, message }, { status: 400 });
  }
}
