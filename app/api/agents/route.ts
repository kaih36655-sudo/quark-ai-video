import { NextResponse } from "next/server";
import { ApiResponse } from "@/lib/server/types";
import { getCurrentUser } from "@/lib/server/auth";
import { listAgentsForUser } from "@/lib/server/agent-store";

export const runtime = "nodejs";

export async function GET() {
  const currentUser = await getCurrentUser();
  const agents = await listAgentsForUser(currentUser);
  const data = agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    description: agent.description,
    tags: [agent.type === "both" ? "全部" : agent.type === "image" ? "图片" : "视频", agent.visibility === "public" ? "公开" : "授权"],
    accessType: agent.visibility === "public" ? "public" : "restricted",
    isAuthorized: agent.visibility === "public" || Boolean(currentUser?.authorizedAgentIds?.includes(agent.id)),
    workflowKey: agent.id,
    type: agent.type,
  }));

  return NextResponse.json<ApiResponse<typeof data>>({
    success: true,
    data,
  });
}
