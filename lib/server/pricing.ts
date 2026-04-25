import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Task } from "./types";

export type PricingConfig = {
  video_4s: number;
  video_8s: number;
  video_12s: number;
  image_1K: number;
  image_2K: number;
  image_4K: number;
};

const DATA_DIR = path.join(process.cwd(), "data");
const PRICING_FILE = path.join(DATA_DIR, "pricing.json");

export const DEFAULT_PRICING: PricingConfig = {
  video_4s: 0.8,
  video_8s: 1.6,
  video_12s: 2.4,
  image_1K: 0.5,
  image_2K: 0.8,
  image_4K: 1.5,
};

async function writePricing(config: PricingConfig) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(PRICING_FILE, JSON.stringify(config, null, 2), "utf-8");
}

export async function getPricingConfig() {
  try {
    const text = await readFile(PRICING_FILE, "utf-8");
    const parsed = JSON.parse(text) as Partial<PricingConfig>;
    const config: PricingConfig = {
      video_4s: Number(parsed.video_4s ?? DEFAULT_PRICING.video_4s),
      video_8s: Number(parsed.video_8s ?? DEFAULT_PRICING.video_8s),
      video_12s: Number(parsed.video_12s ?? DEFAULT_PRICING.video_12s),
      image_1K: Number(parsed.image_1K ?? DEFAULT_PRICING.image_1K),
      image_2K: Number(parsed.image_2K ?? DEFAULT_PRICING.image_2K),
      image_4K: Number(parsed.image_4K ?? DEFAULT_PRICING.image_4K),
    };
    return config;
  } catch {
    await writePricing(DEFAULT_PRICING);
    return DEFAULT_PRICING;
  }
}

export async function updatePricingConfig(patch: Partial<PricingConfig>) {
  const current = await getPricingConfig();
  const next: PricingConfig = { ...current };
  (Object.keys(DEFAULT_PRICING) as (keyof PricingConfig)[]).forEach((key) => {
    if (typeof patch[key] === "number" && Number.isFinite(patch[key]) && patch[key]! >= 0) {
      next[key] = Number(patch[key]);
    }
  });
  await writePricing(next);
  return next;
}

export async function getUnitPrice(input: Pick<Task, "mode" | "duration" | "imageSize">) {
  const pricing = await getPricingConfig();
  if (input.mode === "image") {
    if (input.imageSize === "1K") return pricing.image_1K;
    if (input.imageSize === "4K") return pricing.image_4K;
    return pricing.image_2K;
  }
  if (input.duration === "8s") return pricing.video_8s;
  if (input.duration === "12s") return pricing.video_12s;
  return pricing.video_4s;
}

export async function estimateTaskCost(input: Pick<Task, "mode" | "duration" | "imageSize" | "count">) {
  return Number(((await getUnitPrice(input)) * input.count).toFixed(2));
}
