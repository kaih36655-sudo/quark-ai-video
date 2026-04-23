import { POST as upscalePost } from "../route";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return upscalePost(req, ctx);
}
