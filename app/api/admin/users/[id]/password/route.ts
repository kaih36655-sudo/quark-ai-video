import { NextRequest, NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/server/auth";
import { toPublicUser, updateUserPassword } from "@/lib/server/auth-store";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminUser();
    const { id } = await ctx.params;
    const body = (await req.json()) as { password?: unknown };
    const password = typeof body.password === "string" ? body.password : "";
    if (!password) {
      return NextResponse.json({ success: false, message: "新密码不能为空" }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ success: false, message: "新密码至少 6 位" }, { status: 400 });
    }
    const user = await updateUserPassword(id, password);
    if (!user) {
      return NextResponse.json({ success: false, message: "用户不存在" }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: { user: toPublicUser(user) } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "修改密码失败";
    return NextResponse.json({ success: false, message }, { status: message === "请先登录" ? 401 : 403 });
  }
}
