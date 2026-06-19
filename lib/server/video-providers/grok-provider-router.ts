import { runJiekouGrokVideoSegments, runJiekouGrokVideoWithExtensions } from "./grok-jiekou";
import { runXaiGrokVideoSegments, runXaiGrokVideoWithExtensions } from "./grok-xai";
import { runYunwuGrokVideoSegments, runYunwuGrokVideoWithExtensions } from "./grok-yunwu";
import {
  DEFAULT_GROK_PROVIDER_SOURCE,
  GrokProviderSource,
  GrokVideoResult,
  GrokVideoSegmentsInput,
  GrokVideoWithExtensionsInput,
} from "./types";

const unsupportedProviderMessage = "当前 Grok 接口来源暂未接入，请在后台切换为云雾 API、接口AI 或 xAI 官方。";

const resolveProviderSource = (source?: GrokProviderSource) => source || DEFAULT_GROK_PROVIDER_SOURCE;

export async function runGrokVideoWithProviderRouter(params: GrokVideoWithExtensionsInput): Promise<GrokVideoResult> {
  const providerSource = resolveProviderSource(params.providerSource);
  if (providerSource === "yunwu") {
    return runYunwuGrokVideoWithExtensions({ ...params, providerSource });
  }
  if (providerSource === "jiekou") {
    return runJiekouGrokVideoWithExtensions({ ...params, providerSource });
  }
  if (providerSource === "xai") {
    return runXaiGrokVideoWithExtensions({ ...params, providerSource });
  }
  throw new Error(unsupportedProviderMessage);
}

export async function runGrokVideoSegmentsWithProviderRouter(params: GrokVideoSegmentsInput): Promise<GrokVideoResult> {
  const providerSource = resolveProviderSource(params.providerSource);
  if (providerSource === "yunwu") {
    return runYunwuGrokVideoSegments({ ...params, providerSource });
  }
  if (providerSource === "jiekou") {
    return runJiekouGrokVideoSegments({ ...params, providerSource });
  }
  if (providerSource === "xai") {
    return runXaiGrokVideoSegments({ ...params, providerSource });
  }
  throw new Error(unsupportedProviderMessage);
}
