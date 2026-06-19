import {
  runGrokVideoSegmentsWithProviderRouter,
  runGrokVideoWithProviderRouter,
} from "./video-providers/grok-provider-router";
import {
  DEFAULT_GROK_PROVIDER_SOURCE,
  GrokVideoResult,
  GrokVideoSegmentsInput,
  GrokVideoWithExtensionsInput,
} from "./video-providers/types";

export type { GrokProviderSource, GrokVideoResult } from "./video-providers/types";
export {
  AVAILABLE_GROK_PROVIDER_SOURCES,
  DEFAULT_GROK_PROVIDER_SOURCE,
  getGrokProviderSourceLabel,
  GROK_PROVIDER_SOURCE_LABELS,
  normalizeGrokProviderSource,
} from "./video-providers/types";
export { createGrokVideoTask, extendGrokVideoTask, queryGrokVideoTask } from "./video-providers/grok-yunwu";
export { createJiekouGrokVideoTask, queryJiekouGrokVideoTask } from "./video-providers/grok-jiekou";
export { createXaiGrokVideoTask, extendXaiGrokVideoTask, queryXaiGrokVideoTask } from "./video-providers/grok-xai";

export async function runGrokVideoWithExtensions(params: GrokVideoWithExtensionsInput): Promise<GrokVideoResult> {
  return runGrokVideoWithProviderRouter({
    ...params,
    providerSource: params.providerSource || DEFAULT_GROK_PROVIDER_SOURCE,
  });
}

export async function runGrokVideoSegments(params: GrokVideoSegmentsInput): Promise<GrokVideoResult> {
  return runGrokVideoSegmentsWithProviderRouter({
    ...params,
    providerSource: params.providerSource || DEFAULT_GROK_PROVIDER_SOURCE,
  });
}
