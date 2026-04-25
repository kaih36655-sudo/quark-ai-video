import { NextRequest, NextResponse } from "next/server";
import { authenticateUser, createSessionCookie, sessionCookieName, sessionCookieOptions, toPublicUser } from "@/lib/server/auth-store";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { email?: string; password?: string };
    const email = body.email?.trim().toLowerCase() ?? "";
    const password = body.password ?? "";
    const user = await authenticateUser(email, password);
    if (!user) {
      return NextResponse.json({ success: false, message: "邮箱或密码错误" }, { status: 401 });
    }
    const res = NextResponse.json({ success: true, data: { user: toPublicUser(user) } });
    res.cookies.set(sessionCookieName, createSessionCookie(user.id), sessionCookieOptions);
    return res;
  } catch (error) {
    const message = error instanceof Error ? error.message : "登录失败";
    return NextResponse.json({ success: false, message }, { status: 403 });
  }
}
