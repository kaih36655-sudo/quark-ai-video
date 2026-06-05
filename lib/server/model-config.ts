import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type ModelKey = "sora2" | "grok" | "image2" | "banana2" | "user_select" | "gemini-3.1-pro-preview";
export type ModelConfig = {
  normalVideo: { activeModel: ModelKey; availableModels: ModelKey[] };
  agentVideo: { activeModel: ModelKey; availableModels: ModelKey[] };
  mediumVideo: { activeModel: ModelKey; availableModels: ModelKey[] };
  plainImage: { activeModel: ModelKey; availableModels: ModelKey[] };
  agentImage: { activeModel: ModelKey; availableModels: ModelKey[] };
  videoRemixAnalysis: { activeModel: ModelKey; availableModels: ModelKey[] };
  videoRemixGeneration: { activeModel: ModelKey; availableModels: ModelKey[] };
};

const DATA_DIR = path.join(process.cwd(), "data");
const MODEL_CONFIG_FILE = path.join(DATA_DIR, "model-config.json");

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  normalVideo: { activeModel: "sora2", availableModels: ["sora2"] },
  agentVideo: { activeModel: "sora2", availableModels: ["sora2"] },
  mediumVideo: { activeModel: "grok", availableModels: ["grok", "sora2"] },
  plainImage: { activeModel: "user_select", availableModels: ["image2", "banana2"] },
  agentImage: { activeModel: "user_select", availableModels: ["image2", "banana2"] },
  videoRemixAnalysis: { activeModel: "gemini-3.1-pro-preview", availableModels: ["gemini-3.1-pro-preview"] },
  videoRemixGeneration: { activeModel: "sora2", availableModels: ["sora2"] },
};

const allowed: Record<keyof ModelConfig, ModelKey[]> = {
  normalVideo: ["sora2"],
  agentVideo: ["sora2"],
  mediumVideo: ["grok", "sora2"],
  plainImage: ["image2", "banana2", "user_select"],
  agentImage: ["image2", "banana2", "user_select"],
  videoRemixAnalysis: ["gemini-3.1-pro-preview"],
  videoRemixGeneration: ["sora2"],
};

const normalizeSection = <K extends keyof ModelConfig>(key: K, value: unknown): ModelConfig[K] => {
  const fallback = DEFAULT_MODEL_CONFIG[key];
  const input: Partial<ModelConfig[K]> = value && typeof value === "object" ? (value as Partial<ModelConfig[K]>) : {};
  const available = Array.isArray(input.availableModels)
    ? input.availableModels.filter((item): item is ModelKey => allowed[key].includes(item as ModelKey))
    : fallback.availableModels;
  const availableModels = available.length ? available : fallback.availableModels;
  const activeModel = allowed[key].includes(input.activeModel as ModelKey) ? (input.activeModel as ModelKey) : fallback.activeModel;
  return {
    activeModel: activeModel === "user_select" || availableModels.includes(activeModel) ? activeModel : availableModels[0],
    availableModels,
  } as ModelConfig[K];
};

async function writeModelConfig(config: ModelConfig) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(MODEL_CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

export async function getModelConfig() {
  try {
    const parsed = JSON.parse(await readFile(MODEL_CONFIG_FILE, "utf-8")) as Partial<ModelConfig> & {
      videoRemix?: { activeModel?: ModelKey; availableModels?: ModelKey[] };
    };
    return {
      normalVideo: normalizeSection("normalVideo", parsed.normalVideo),
      agentVideo: normalizeSection("agentVideo", parsed.agentVideo),
      mediumVideo: normalizeSection("mediumVideo", parsed.mediumVideo),
      plainImage: normalizeSection("plainImage", parsed.plainImage),
      agentImage: normalizeSection("agentImage", parsed.agentImage),
      videoRemixAnalysis: normalizeSection("videoRemixAnalysis", parsed.videoRemixAnalysis ?? parsed.videoRemix),
      videoRemixGeneration: normalizeSection("videoRemixGeneration", parsed.videoRemixGeneration),
    };
  } catch {
    await writeModelConfig(DEFAULT_MODEL_CONFIG);
    return DEFAULT_MODEL_CONFIG;
  }
}

export async function updateModelConfig(patch: Partial<ModelConfig>) {
  const current = await getModelConfig();
  const next: ModelConfig = {
    normalVideo: normalizeSection("normalVideo", patch.normalVideo ?? current.normalVideo),
    agentVideo: normalizeSection("agentVideo", patch.agentVideo ?? current.agentVideo),
    mediumVideo: normalizeSection("mediumVideo", patch.mediumVideo ?? current.mediumVideo),
    plainImage: normalizeSection("plainImage", patch.plainImage ?? current.plainImage),
    agentImage: normalizeSection("agentImage", patch.agentImage ?? current.agentImage),
    videoRemixAnalysis: normalizeSection("videoRemixAnalysis", patch.videoRemixAnalysis ?? current.videoRemixAnalysis),
    videoRemixGeneration: normalizeSection("videoRemixGeneration", patch.videoRemixGeneration ?? current.videoRemixGeneration),
  };
  await writeModelConfig(next);
  return next;
}
