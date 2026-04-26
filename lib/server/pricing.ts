import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Task } from "./types";

export type PricingConfig = {
  video_enabled: boolean;
  image_enabled: boolean;
  video_4s: number;
  video_8s: number;
  video_12s: number;
  image_1K: number;
  image_2K: number;
  image_4K: number;
  image2_1K: number;
  image2_2K: number;
  image2_4K: number;
  banana2_1K: number;
  banana2_2K: number;
  banana2_4K: number;
};

const DATA_DIR = path.join(process.cwd(), "data");
const PRICING_FILE = path.join(DATA_DIR, "pricing.json");

export const DEFAULT_PRICING: PricingConfig = {
  video_enabled: true,
  image_enabled: true,
  video_4s: 0.8,
  video_8s: 1.6,
  video_12s: 2.4,
  image_1K: 0.5,
  image_2K: 0.8,
  image_4K: 1.5,
  image2_1K: 0.5,
  image2_2K: 0.8,
  image2_4K: 1.5,
  banana2_1K: 0.5,
  banana2_2K: 0.8,
  banana2_4K: 1.5,
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
      video_enabled: typeof parsed.video_enabled === "boolean" ? parsed.video_enabled : DEFAULT_PRICING.video_enabled,
      image_enabled: typeof parsed.image_enabled === "boolean" ? parsed.image_enabled : DEFAULT_PRICING.image_enabled,
      video_4s: Number(parsed.video_4s ?? DEFAULT_PRICING.video_4s),
      video_8s: Number(parsed.video_8s ?? DEFAULT_PRICING.video_8s),
      video_12s: Number(parsed.video_12s ?? DEFAULT_PRICING.video_12s),
      image_1K: Number(parsed.image_1K ?? DEFAULT_PRICING.image_1K),
      image_2K: Number(parsed.image_2K ?? DEFAULT_PRICING.image_2K),
      image_4K: Number(parsed.image_4K ?? DEFAULT_PRICING.image_4K),
      image2_1K: Number(parsed.image2_1K ?? parsed.image_1K ?? DEFAULT_PRICING.image2_1K),
      image2_2K: Number(parsed.image2_2K ?? parsed.image_2K ?? DEFAULT_PRICING.image2_2K),
      image2_4K: Number(parsed.image2_4K ?? parsed.image_4K ?? DEFAULT_PRICING.image2_4K),
      banana2_1K: Number(parsed.banana2_1K ?? DEFAULT_PRICING.banana2_1K),
      banana2_2K: Number(parsed.banana2_2K ?? DEFAULT_PRICING.banana2_2K),
      banana2_4K: Number(parsed.banana2_4K ?? DEFAULT_PRICING.banana2_4K),
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
  const booleanKeys: (keyof Pick<PricingConfig, "video_enabled" | "image_enabled">)[] = ["video_enabled", "image_enabled"];
  const numberKeys = (Object.keys(DEFAULT_PRICING) as (keyof PricingConfig)[]).filter(
    (key) => typeof DEFAULT_PRICING[key] === "number",
  ) as Exclude<keyof PricingConfig, "video_enabled" | "image_enabled">[];
  booleanKeys.forEach((key) => {
    if (typeof patch[key] === "boolean") next[key] = patch[key];
  });
  numberKeys.forEach((key) => {
    const value = patch[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      next[key] = Number(value);
    }
  });
  await writePricing(next);
  return next;
}

export async function getUnitPrice(input: Pick<Task, "mode" | "duration" | "imageSize" | "imageModel">) {
  const pricing = await getPricingConfig();
  if (input.mode === "image") {
    const prefix: "banana2" | "image2" = input.imageModel === "banana2" ? "banana2" : "image2";
    const size = input.imageSize === "1K" || input.imageSize === "4K" ? input.imageSize : "2K";
    const key = `${prefix}_${size}` as "image2_1K" | "image2_2K" | "image2_4K" | "banana2_1K" | "banana2_2K" | "banana2_4K";
    return pricing[key];
  }
  if (input.duration === "8s") return pricing.video_8s;
  if (input.duration === "12s") return pricing.video_12s;
  return pricing.video_4s;
}

export async function estimateTaskCost(input: Pick<Task, "mode" | "duration" | "imageSize" | "imageModel" | "count">) {
  return Number(((await getUnitPrice(input)) * input.count).toFixed(2));
}
