export type GrokProviderSource = "yunwu" | "jiekou" | "xai";
export type EnabledGrokProviderSource = GrokProviderSource;

export const DEFAULT_GROK_PROVIDER_SOURCE: EnabledGrokProviderSource = "yunwu";
export const AVAILABLE_GROK_PROVIDER_SOURCES: EnabledGrokProviderSource[] = ["yunwu", "jiekou", "xai"];

export const GROK_PROVIDER_SOURCE_LABELS: Record<GrokProviderSource, string> = {
  yunwu: "云雾 API",
  jiekou: "接口AI",
  xai: "xAI 官方",
};

export const getGrokProviderSourceLabel = (source?: string) =>
  source === "yunwu"
    ? GROK_PROVIDER_SOURCE_LABELS.yunwu
    : source === "jiekou"
      ? GROK_PROVIDER_SOURCE_LABELS.jiekou
      : source === "xai"
        ? GROK_PROVIDER_SOURCE_LABELS.xai
        : source || "";

export const normalizeGrokProviderSource = (source: unknown): EnabledGrokProviderSource =>
  source === "jiekou" || source === "xai" ? source : DEFAULT_GROK_PROVIDER_SOURCE;

export type GrokVideoResult = {
  ok: boolean;
  providerSource: GrokProviderSource;
  providerTaskIds: string[];
  finalTaskId?: string;
  finalVideoUrl?: string;
  finalCoverUrl?: string;
  segmentVideoUrls?: string[];
  segmentCoverUrls?: string[];
  isFinalVideoLikelyComplete?: boolean | "unknown";
  durationSeconds: number;
  successfulUnits: number;
  failedUnits: number;
  stitchConcatFailed?: boolean;
  stitchConcatError?: string;
  apiModel?: string;
  actualModel?: string;
  modelRole?: "primary" | "fallback";
  usedFallback?: boolean;
  error?: string;
};

export type GrokReferenceImageRole = "first_frame" | "reference_only";

export type GrokVideoWithExtensionsInput = {
  providerSource?: GrokProviderSource;
  taskId?: string;
  sourcePrompt?: string;
  basePrompt: string;
  extensionPrompts: string[];
  ratio: string;
  targetDurationSeconds: number;
  referenceImages?: string[];
  referenceImageRole?: GrokReferenceImageRole;
};

export type GrokVideoSegmentsInput = {
  providerSource?: GrokProviderSource;
  taskId?: string;
  sourcePrompt?: string;
  prompts: string[];
  ratio: string;
  targetDurationSeconds: number;
  getReferenceImagesForSegment?: (segmentIndex: number, previousVideoUrl?: string) => Promise<string[] | undefined>;
};

export type GrokVideoRunInput = {
  providerSource: GrokProviderSource;
  prompt: string;
  aspectRatio: "9:16" | "16:9";
  targetDurationSeconds: 10 | 20 | 30 | 40 | 50 | 60;
  strategy?: "extend" | "stitch";
  referenceImageUrl?: string;
  userId?: string;
  taskId?: string;
  logPrefix?: string;
};

export type GrokVideoRunResult = GrokVideoResult;
