import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";
import { toPublicUser } from "@/lib/server/auth-store";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  return NextResponse.json({
    success: true,
    data: { user: user ? toPublicUser(user) : null },
  });
}
