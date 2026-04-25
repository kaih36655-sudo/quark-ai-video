import { cookies } from "next/headers";
import { getUserById, parseSessionCookie, sessionCookieName } from "./auth-store";

export async function getCurrentUser() {
  const cookieStore = await cookies();
  const userId = parseSessionCookie(cookieStore.get(sessionCookieName)?.value);
  if (!userId) return null;
  return getUserById(userId);
}

export async function requireCurrentUser() {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("请先登录");
  }
  if (user.disabled) {
    throw new Error("账号已被禁用");
  }
  return user;
}

export async function requireAdminUser() {
  const user = await requireCurrentUser();
  if (user.role !== "admin") {
    throw new Error("无管理员权限");
  }
  return user;
}
