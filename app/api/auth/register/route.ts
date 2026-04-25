import { NextRequest, NextResponse } from "next/server";
import { createSessionCookie, createUser, sessionCookieName, sessionCookieOptions, toPublicUser } from "@/lib/server/auth-store";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { email?: string; password?: string; name?: string };
    const email = body.email?.trim().toLowerCase() ?? "";
    const password = body.password ?? "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ success: false, message: "请输入有效邮箱" }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ success: false, message: "密码至少 6 位" }, { status: 400 });
    }
    const user = await createUser({ email, password, name: body.name });
    const res = NextResponse.json({ success: true, data: { user: toPublicUser(user) } });
    res.cookies.set(sessionCookieName, createSessionCookie(user.id), sessionCookieOptions);
    return res;
  } catch (error) {
    const message = error instanceof Error ? error.message : "注册失败";
    return NextResponse.json({ success: false, message }, { status: 400 });
  }
}
