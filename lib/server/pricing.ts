import type { Task } from "./types";

export function getUnitPrice(input: Pick<Task, "mode" | "duration" | "imageSize">) {
  if (input.mode === "image") {
    if (input.imageSize === "1K") return 0.5;
    if (input.imageSize === "4K") return 1.5;
    return 0.8;
  }
  if (input.duration === "8s") return 1.6;
  if (input.duration === "12s") return 2.4;
  return 0.8;
}

export function estimateTaskCost(input: Pick<Task, "mode" | "duration" | "imageSize" | "count">) {
  return Number((getUnitPrice(input) * input.count).toFixed(2));
}
