import { NextRequest, NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/server/auth";
import { adjustUserBalance, getUserById, toPublicUser, updateUser } from "@/lib/server/auth-store";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const operator = await requireAdminUser();
    const { id } = await ctx.params;
    const body = (await req.json()) as {
      role?: "user" | "admin";
      disabled?: boolean;
      balanceDelta?: number;
      reason?: string;
      authorizedAgentIds?: string[];
    };
    const existing = await getUserById(id);
    if (!existing) {
      return NextResponse.json({ success: false, message: "用户不存在" }, { status: 404 });
    }
    let user = existing;
    if (body.role === "user" || body.role === "admin" || typeof body.disabled === "boolean" || Array.isArray(body.authorizedAgentIds)) {
      const patch: Parameters<typeof updateUser>[1] = {};
      if (body.role === "user" || body.role === "admin") patch.role = body.role;
      if (typeof body.disabled === "boolean") patch.disabled = body.disabled;
      if (Array.isArray(body.authorizedAgentIds)) {
        patch.authorizedAgentIds = body.authorizedAgentIds.filter((id): id is string => typeof id === "string");
      }
      user = await updateUser(id, patch) ?? user;
    }
    if (typeof body.balanceDelta === "number" && Number.isFinite(body.balanceDelta) && body.balanceDelta !== 0) {
      user = await adjustUserBalance({
        userId: id,
        amount: body.balanceDelta,
        reason: body.reason || "管理员手动调整余额",
        operatorUserId: operator.id,
      });
    }
    return NextResponse.json({ success: true, data: { user: toPublicUser(user) } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "更新用户失败";
    return NextResponse.json({ success: false, message }, { status: message === "请先登录" ? 401 : 400 });
  }
}
