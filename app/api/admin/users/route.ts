import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/server/auth";
import { listUsers, toPublicUser } from "@/lib/server/auth-store";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireAdminUser();
    const users = await listUsers();
    return NextResponse.json({ success: true, data: { users: users.map(toPublicUser) } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "无权限";
    return NextResponse.json({ success: false, message }, { status: message === "请先登录" ? 401 : 403 });
  }
}
