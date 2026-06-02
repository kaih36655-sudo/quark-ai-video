import { NextResponse } from "next/server";
import { getModelConfig } from "@/lib/server/model-config";

export const runtime = "nodejs";

export async function GET() {
  const config = await getModelConfig();
  return NextResponse.json({ success: true, data: { config } });
}
