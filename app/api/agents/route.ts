import { NextResponse } from "next/server";
import { agentsRepository } from "@/lib/server/repositories";
import { ApiResponse } from "@/lib/server/types";

export const runtime = "nodejs";

export async function GET() {
  const data = agentsRepository.listVisible().map((agent) => ({
    id: agent.id,
    name: agent.name,
    description: agent.description,
    tags: agent.tags,
    accessType: agent.accessType,
    isAuthorized: agent.isAuthorized,
    workflowKey: agent.workflowKey,
  }));

  return NextResponse.json<ApiResponse<typeof data>>({
    success: true,
    data,
  });
}
