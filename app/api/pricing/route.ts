import { NextResponse } from "next/server";
import { getPricingConfig } from "@/lib/server/pricing";

export const runtime = "nodejs";

export async function GET() {
  const pricing = await getPricingConfig();
  return NextResponse.json({ success: true, data: { pricing } });
}
