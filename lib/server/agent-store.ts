import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppUser } from "./auth-store";

export type ManagedAgent = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  type: "video" | "image" | "both";
  visibility: "public" | "private";
  enabled: boolean;
  scenePrompt: string;
  characterPrompt: string;
  languagePrompt: string;
  cameraPrompt: string;
  stylePrompt: string;
  negativePrompt: string;
  extraPrompt: string;
  createdAt: string;
  updatedAt: string;
};

const DATA_DIR = path.join(process.cwd(), "data");
const AGENTS_FILE = path.join(DATA_DIR, "agents.json");

const defaultAgents = (): ManagedAgent[] => {
  const now = new Date().toISOString();
  return [
    {
      id: "video-sales",
      name: "视频带货智能体",
      description: "适合商品卖点拆解、转化型短视频脚本和下单引导场景。",
      tags: ["视频", "带货", "公开"],
      type: "video",
      visibility: "public",
      enabled: true,
      scenePrompt: "围绕商品使用场景，突出痛点、卖点和结果对比。",
      characterPrompt: "人物表达自然，动作明确，适合短视频带货。",
      languagePrompt: "语言简短有转化力，避免长句。",
      cameraPrompt: "镜头包含开场钩子、产品特写、使用效果和行动引导。",
      stylePrompt: "节奏快，商业感清晰，画面干净。",
      negativePrompt: "避免夸大承诺、虚假功效、低清晰度和杂乱背景。",
      extraPrompt: "",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "image-product",
      name: "商品图智能体",
      description: "适合生成商品展示图、海报风格图和电商素材。",
      tags: ["图片", "商品图", "公开"],
      type: "image",
      visibility: "public",
      enabled: true,
      scenePrompt: "生成清晰的商品展示场景，主体明确，构图完整。",
      characterPrompt: "如有人物，人物姿态自然且不遮挡主体。",
      languagePrompt: "画面不包含乱码文字，除非用户明确要求。",
      cameraPrompt: "使用干净构图、产品特写和柔和光线。",
      stylePrompt: "商业摄影质感，高清，细节丰富。",
      negativePrompt: "避免畸形、模糊、水印、乱码、低质感和多余肢体。",
      extraPrompt: "",
      createdAt: now,
      updatedAt: now,
    },
  ];
};

async function ensureDataDir() {
  await mkdir(DATA_DIR, { recursive: true });
}

async function writeAgents(agents: ManagedAgent[]) {
  await ensureDataDir();
  await writeFile(AGENTS_FILE, JSON.stringify(agents, null, 2), "utf-8");
}

export async function listManagedAgents() {
  try {
    const text = await readFile(AGENTS_FILE, "utf-8");
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return (parsed as Partial<ManagedAgent>[]).map((agent) => ({
        ...agent,
        tags: Array.isArray(agent.tags) ? agent.tags.filter((tag): tag is string => typeof tag === "string") : [],
      })) as ManagedAgent[];
    }
  } catch {
    // fall through to defaults
  }
  const agents = defaultAgents();
  await writeAgents(agents);
  return agents;
}

export async function getManagedAgentById(id: string) {
  const agents = await listManagedAgents();
  return agents.find((agent) => agent.id === id) ?? null;
}

export function canUserUseAgent(user: AppUser | null, agent: ManagedAgent) {
  if (!agent.enabled) return false;
  if (agent.visibility === "public") return true;
  if (!user) return false;
  return (user.authorizedAgentIds ?? []).includes(agent.id);
}

export async function listAgentsForUser(user: AppUser | null) {
  const agents = await listManagedAgents();
  return agents.filter((agent) => canUserUseAgent(user, agent));
}

export function composeAgentPrompt(agent: ManagedAgent | null, userPrompt: string) {
  if (!agent) return userPrompt;
  const parts = [
    agent.scenePrompt && `场景提示：${agent.scenePrompt}`,
    agent.characterPrompt && `人物提示：${agent.characterPrompt}`,
    agent.languagePrompt && `语言/对白提示：${agent.languagePrompt}`,
    agent.cameraPrompt && `机位/镜头提示：${agent.cameraPrompt}`,
    agent.stylePrompt && `风格提示：${agent.stylePrompt}`,
    agent.extraPrompt && `补充提示：${agent.extraPrompt}`,
    `用户输入：${userPrompt}`,
    agent.negativePrompt && `负面提示：${agent.negativePrompt}`,
  ].filter(Boolean);
  return parts.join("\n");
}

export async function createManagedAgent(payload: Partial<ManagedAgent>) {
  const agents = await listManagedAgents();
  const now = new Date().toISOString();
  const id = `agent_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const agent: ManagedAgent = {
    id,
    name: payload.name?.trim() || "未命名智能体",
    description: payload.description?.trim() || "",
    tags: Array.isArray(payload.tags) ? payload.tags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0) : [],
    type: payload.type === "video" || payload.type === "image" ? payload.type : "both",
    visibility: payload.visibility === "private" ? "private" : "public",
    enabled: payload.enabled ?? true,
    scenePrompt: payload.scenePrompt || "",
    characterPrompt: payload.characterPrompt || "",
    languagePrompt: payload.languagePrompt || "",
    cameraPrompt: payload.cameraPrompt || "",
    stylePrompt: payload.stylePrompt || "",
    negativePrompt: payload.negativePrompt || "",
    extraPrompt: payload.extraPrompt || "",
    createdAt: now,
    updatedAt: now,
  };
  await writeAgents([agent, ...agents]);
  return agent;
}

export async function updateManagedAgent(id: string, patch: Partial<ManagedAgent>) {
  const agents = await listManagedAgents();
  const index = agents.findIndex((agent) => agent.id === id);
  if (index < 0) return null;
  const current = agents[index];
  const next: ManagedAgent = {
    ...current,
    ...patch,
    id: current.id,
    tags: Array.isArray(patch.tags) ? patch.tags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0) : current.tags,
    type: patch.type === "video" || patch.type === "image" || patch.type === "both" ? patch.type : current.type,
    visibility: patch.visibility === "private" || patch.visibility === "public" ? patch.visibility : current.visibility,
    updatedAt: new Date().toISOString(),
  };
  agents[index] = next;
  await writeAgents(agents);
  return next;
}

export async function deleteManagedAgent(id: string) {
  const agents = await listManagedAgents();
  const next = agents.filter((agent) => agent.id !== id);
  if (next.length === agents.length) return false;
  await writeAgents(next);
  return true;
}
