import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveLocalUploadsSource } from "../local-uploads";
import { extractTailReferenceFrameForContinuation } from "../medium-video-frame";
import {
  DEFAULT_GROK_PROVIDER_SOURCE,
  GrokReferenceImageRole,
  GrokVideoResult,
  GrokVideoSegmentsInput,
  GrokVideoWithExtensionsInput,
} from "./types";

type GrokTaskStatus = "pending" | "processing" | "succeeded" | "failed" | "cancelled" | "timeout" | "unknown";

type GrokTaskQueryResult = {
  taskId: string;
  status: GrokTaskStatus;
  rawStatus: string;
  videoUrl?: string;
  coverUrl?: string;
  duration?: number;
  errorMessage?: string;
  raw?: Record<string, unknown>;
  apiModel?: string;
  actualModel?: string;
  modelRole?: "primary" | "fallback";
  usedFallback?: boolean;
};

type YunwuQueryMode = "official_videos" | "legacy_video_query";
type YunwuResponseShape = "top_level" | "data" | "result" | "task" | "response" | "unknown";
type YunwuCreateUncertainReason = "parse_failed" | "task_id_missing" | "network_state_uncertain";

const CREATE_PATH = "/v1/videos/generations";
const QUERY_PATH = "/v1/video/query";
const GROK_UNIT_SECONDS = 10;
const MAX_ATTEMPTS = 5;
const RETRY_BACKOFF_MS = [5000, 15000, 30000, 60000];
const QUERY_FETCH_MAX_ATTEMPTS = 3;
const QUERY_FETCH_BACKOFF_MS = [3000, 5000];
const YUNWU_OFFICIAL_EXTEND_UNSUPPORTED_MESSAGE = "云雾 Grok 官方接口暂未接入扩展视频，请切换为分段拼接。";
const DEFAULT_TEXT_TO_VIDEO_MODEL = "grok-imagine-video";
const DEFAULT_IMAGE_TO_VIDEO_MODEL = "grok-imagine-video-1.5-preview";
const PRIMARY_CREATE_BACKOFF_MS = 5000;
const FALLBACK_CREATE_BACKOFF_MS = 10000;
const CREATE_MAX_ATTEMPTS_LIMIT = 3;

type PreparedGrokImage = {
  url: string;
  mimeType: string;
  mode: "image.url.public_url" | "image.url.data_url";
};

const REFERENCE_ONLY_PROMPT_INSTRUCTION =
  "参考图仅作为视觉参考、主体参考、构图参考或品牌参考；不要静态展示参考图；0.0 秒立即开始动作；不要把参考图长时间作为静态开场。";

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const log = (stage: string, payload: Record<string, unknown>) => {
  console.log(`[YUNWU_GROK][${stage}]`, JSON.stringify({ providerSource: DEFAULT_GROK_PROVIDER_SOURCE, ...payload }));
};

class YunwuCreateUncertainError extends Error {
  readonly reason: YunwuCreateUncertainReason;
  readonly httpStatus?: number;
  readonly responseShape?: YunwuResponseShape;
  readonly rawPreview?: unknown;

  constructor(params: { message: string; reason: YunwuCreateUncertainReason; httpStatus?: number; responseShape?: YunwuResponseShape; rawPreview?: unknown }) {
    super(params.message);
    this.name = "YunwuCreateUncertainError";
    this.reason = params.reason;
    this.httpStatus = params.httpStatus;
    this.responseShape = params.responseShape;
    this.rawPreview = params.rawPreview;
  }
}

const getBaseUrl = () => (process.env.YUNWU_GROK_VIDEO_BASE_URL || "https://yunwu.ai").replace(/\/$/, "");
const legacyModelWarningCache = new Set<string>();
const isLegacyYunwuGrokModel = (value: string) => /^grok-video-3(?:-|$)/i.test(value) || value === "grok-video-3-10s";
type YunwuGrokModelEnvName =
  | "YUNWU_GROK_PRIMARY_MODEL"
  | "YUNWU_GROK_FALLBACK_MODEL"
  | "YUNWU_GROK_VIDEO_MODEL"
  | "YUNWU_GROK_IMAGE_TO_VIDEO_MODEL"
  | "YUNWU_GROK_REFERENCE_IMAGES_MODEL";
const sanitizeConfiguredYunwuGrokModel = (envName: YunwuGrokModelEnvName, configured: string, fallback: string) => {
  if (!configured) return fallback;
  if (isLegacyYunwuGrokModel(configured)) {
    const cacheKey = `${envName}:${configured}`;
    if (!legacyModelWarningCache.has(cacheKey)) {
      legacyModelWarningCache.add(cacheKey);
      log("LEGACY_MODEL_IGNORED", { envName, configuredModel: configured, fallbackModel: fallback });
    }
    return fallback;
  }
  return configured;
};
const getConfiguredYunwuGrokModel = (envName: YunwuGrokModelEnvName, fallback: string) =>
  sanitizeConfiguredYunwuGrokModel(envName, (process.env[envName] || "").trim(), fallback);
const getPrimaryModel = () => {
  const primary = (process.env.YUNWU_GROK_PRIMARY_MODEL || "").trim();
  if (primary) return sanitizeConfiguredYunwuGrokModel("YUNWU_GROK_PRIMARY_MODEL", primary, DEFAULT_TEXT_TO_VIDEO_MODEL);
  return getConfiguredYunwuGrokModel("YUNWU_GROK_VIDEO_MODEL", DEFAULT_TEXT_TO_VIDEO_MODEL);
};
const getFallbackModel = () => {
  const fallback = (process.env.YUNWU_GROK_FALLBACK_MODEL || "").trim();
  if (fallback) return sanitizeConfiguredYunwuGrokModel("YUNWU_GROK_FALLBACK_MODEL", fallback, DEFAULT_IMAGE_TO_VIDEO_MODEL);
  return getConfiguredYunwuGrokModel("YUNWU_GROK_IMAGE_TO_VIDEO_MODEL", DEFAULT_IMAGE_TO_VIDEO_MODEL);
};
const parseClampedAttemptCount = (value: string | undefined, fallback: number) => {
  const parsed = Number(value || 0);
  const effective = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
  return Math.min(CREATE_MAX_ATTEMPTS_LIMIT, Math.max(1, effective));
};
const getCreateMaxAttempts = (envName: "YUNWU_GROK_PRIMARY_MAX_ATTEMPTS" | "YUNWU_GROK_FALLBACK_MAX_ATTEMPTS", fallback: number) =>
  parseClampedAttemptCount(process.env[envName], fallback);
const getPromptMaxBytes = (mode: "text-to-video" | "image-to-video") => {
  const configured = Number(process.env.YUNWU_GROK_PROMPT_MAX_BYTES || 0);
  if (Number.isFinite(configured) && configured > 0) return configured;
  return mode === "image-to-video" ? 2800 : 3500;
};

const getApiKey = () => {
  const key = process.env.YUNWU_GROK_VIDEO_API_KEY;
  if (!key) {
    throw new Error("缺少 YUNWU_GROK_VIDEO_API_KEY，请在服务端环境变量配置 Grok 视频 API Key。");
  }
  return key;
};

const safeResponsePreview = (value: unknown) => {
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const video = source.video && typeof source.video === "object" ? (source.video as Record<string, unknown>) : undefined;
  return {
    id: source.id,
    request_id: source.request_id,
    task_id: source.task_id,
    status: source.status,
    type: source.type,
    model: source.model,
    progress: source.progress,
    hasVideoUrl: (typeof source.video_url === "string" && source.video_url.length > 0) || (typeof video?.url === "string" && video.url.length > 0),
    hasThumbnailUrl: typeof source.thumbnail_url === "string" && source.thumbnail_url.length > 0,
    error: source.error,
    status_update_time: source.status_update_time,
  };
};

const parseJsonResponse = async (response: Response) => {
  const rawText = await response.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : null;
  } catch {
    json = null;
  }
  return { ok: response.ok, status: response.status, rawText, json };
};

const parseCreateJsonResponse = async (response: Response) => {
  const rawText = await response.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : null;
  } catch {
    if (response.ok) {
      throw new YunwuCreateUncertainError({
        message: "云雾任务可能已创建，但响应解析失败，为避免重复生成，已停止自动重试。",
        reason: "parse_failed",
        httpStatus: response.status,
        responseShape: "unknown",
        rawPreview: rawText.slice(0, 500),
      });
    }
  }
  return { ok: response.ok, status: response.status, rawText, json };
};

const buildHeaders = () => ({
  Authorization: `Bearer ${getApiKey()}`,
  "Content-Type": "application/json",
  Accept: "application/json",
});

const truncateUtf8Text = (value: string, maxBytes: number) => {
  let result = "";
  let bytes = 0;
  for (const char of Array.from(value)) {
    const charBytes = Buffer.byteLength(char, "utf8");
    if (bytes + charBytes > maxBytes) break;
    result += char;
    bytes += charBytes;
  }
  return result.trim();
};

const extractPromptValue = (prompt: string, label: string) => {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}[:：]([^\\n]+)`).exec(prompt);
  return match?.[1]?.trim() || "";
};

const findPromptLine = (lines: string[], prefix: string) => lines.find((line) => line.startsWith(`${prefix}：`) || line.startsWith(`${prefix}:`)) || "";

const compactPromptLine = (lines: string[], prefix: string, maxBytes: number) => {
  const line = findPromptLine(lines, prefix);
  if (!line) return "";
  return truncateUtf8Text(line, maxBytes);
};

const extractAgentConstraintsFromPrompt = (prompt: string) => {
  const marker = /智能体约束\s*[:：]/.exec(prompt);
  if (!marker || marker.index === undefined) return "";
  const start = marker.index + marker[0].length;
  const rest = prompt.slice(start);
  const nextLabelPattern =
    /(?:\n|\r|。|；|;)\s*(?:全片主题|用户主题|当前段|当前段任务|storyBeat|visualAction|voiceoverPart|continuityIn|continuityOut|mustNotRepeat|连续性要求|基础约束|硬性要求)\s*[:：]/;
  const nextLabel = nextLabelPattern.exec(rest);
  const value = rest.slice(0, nextLabel?.index ?? rest.length).replace(/\s+/g, " ").trim();
  return value ? `智能体约束：${value}` : "";
};

const getAgentConstraintFlags = (value: string) => ({
  hasPositiveConstraints: /正向约束\s*[:：]/.test(value),
  hasNegativeConstraints: /负面约束\s*[:：]/.test(value),
});

const extractConstraintSection = (value: string, label: "正向约束" | "负面约束") => {
  const otherLabel = label === "正向约束" ? "负面约束" : "正向约束";
  const match = new RegExp(`${label}\\s*[:：]([\\s\\S]*?)(?=${otherLabel}\\s*[:：]|$)`).exec(value);
  return match?.[1]?.replace(/\s+/g, " ").replace(/[。；;\s]+$/g, "").trim() || "";
};

const buildCompactAgentConstraintLine = (constraints: string, maxBytes: number) => {
  if (!constraints || maxBytes < 80) return "";
  const positive = extractConstraintSection(constraints, "正向约束");
  const negative = extractConstraintSection(constraints, "负面约束");
  const parts: string[] = [];
  const halfBudget = Math.max(60, Math.floor((maxBytes - Buffer.byteLength("智能体约束：", "utf8")) / 2));
  if (positive) parts.push(`正向约束：${truncateUtf8Text(positive, halfBudget)}`);
  if (negative) parts.push(`负面约束：${truncateUtf8Text(negative, halfBudget)}`);
  const line = parts.length ? `智能体约束：${parts.join("；")}` : truncateUtf8Text(constraints, maxBytes);
  return truncateUtf8Text(line, maxBytes);
};

const validateAgentConstraintsPreservation = (before: string, afterPrompt: string) => {
  if (!before) {
    return {
      preservationStatus: "none" as const,
      hasAgentConstraintsAfterCompact: false,
      agentConstraintsFinalBytes: 0,
      hasPositiveConstraintsAfterCompact: false,
      hasNegativeConstraintsAfterCompact: false,
    };
  }
  const after = extractAgentConstraintsFromPrompt(afterPrompt);
  const beforeFlags = getAgentConstraintFlags(before);
  const afterFlags = getAgentConstraintFlags(after);
  const hasAgentConstraintsAfterCompact = Boolean(after);
  const lostPositive = beforeFlags.hasPositiveConstraints && !afterFlags.hasPositiveConstraints;
  const lostNegative = beforeFlags.hasNegativeConstraints && !afterFlags.hasNegativeConstraints;
  const preservationStatus = !hasAgentConstraintsAfterCompact ? "omitted_due_to_budget" : lostPositive || lostNegative ? "partial" : "full";
  return {
    preservationStatus,
    hasAgentConstraintsAfterCompact,
    agentConstraintsFinalBytes: Buffer.byteLength(after, "utf8"),
    hasPositiveConstraintsAfterCompact: afterFlags.hasPositiveConstraints,
    hasNegativeConstraintsAfterCompact: afterFlags.hasNegativeConstraints,
  };
};

const logAgentConstraintCompaction = (result: ReturnType<typeof validateAgentConstraintsPreservation>, originalBytes: number, flags: ReturnType<typeof getAgentConstraintFlags>) => {
  if (result.preservationStatus !== "partial" && result.preservationStatus !== "omitted_due_to_budget") return;
  log("AGENT_CONSTRAINTS_COMPACTED", {
    preservationStatus: result.preservationStatus,
    originalBytes,
    finalBytes: result.agentConstraintsFinalBytes,
    hadPositiveConstraints: flags.hasPositiveConstraints,
    hadNegativeConstraints: flags.hasNegativeConstraints,
    hasPositiveConstraintsAfterCompact: result.hasPositiveConstraintsAfterCompact,
    hasNegativeConstraintsAfterCompact: result.hasNegativeConstraintsAfterCompact,
  });
};

type StitchContinuationSource = "硬性要求" | "连续性要求" | "continuity_fields" | "none";

const TAIL_REFERENCE_PATTERN = /(上一段(?:视频)?的?最后可用非黑帧|上一段(?:视频)?的?最后一帧|上一段尾帧|上一段最后画面|上一段最后的画面|本段输入参考图|输入参考图|参考图)/;
const TAIL_CONTINUATION_PATTERN = /(从该画面状态|从该状态|无缝继续|直接继续|立即继续|立即延续|延续上一帧|延续上一段|不要重复上一段|不要重新开头|不要重新开始|不要回到更早)/;

const hasStitchContinuationInstruction = (value: string) => TAIL_REFERENCE_PATTERN.test(value) && TAIL_CONTINUATION_PATTERN.test(value);

const compactStitchContinuationInstruction = (value: string) => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return truncateUtf8Text(
    `连续性硬性要求：参考图是上一段最后可用非黑帧，从该画面状态立即继续，不重复上一段动作，不重新开头，不回到更早状态。${normalized.includes("0.0") ? "0.0 秒立即延续动作。" : ""}`,
    360
  );
};

const extractStitchContinuationInstruction = (prompt: string): { instruction: string; source: StitchContinuationSource } => {
  const lines = prompt.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const labeledCandidates: Array<{ source: StitchContinuationSource; line: string }> = [];
  lines.forEach((line) => {
    if (/^硬性要求\s*[:：]/.test(line)) labeledCandidates.push({ source: "硬性要求", line });
    if (/^连续性要求\s*[:：]/.test(line)) labeledCandidates.push({ source: "连续性要求", line });
  });
  for (const candidate of labeledCandidates) {
    if (hasStitchContinuationInstruction(candidate.line)) {
      return { instruction: compactStitchContinuationInstruction(candidate.line), source: candidate.source };
    }
  }

  const continuityFields = lines.filter((line) => /^(continuityIn|continuityOut)\s*[:：]/i.test(line)).join("；");
  const hardRequirement = lines.find((line) => /^硬性要求\s*[:：]/.test(line)) || "";
  const combinedContinuity = [continuityFields, hardRequirement].filter(Boolean).join("；");
  if (hasStitchContinuationInstruction(combinedContinuity)) {
    return { instruction: compactStitchContinuationInstruction(combinedContinuity), source: "continuity_fields" };
  }
  return { instruction: "", source: "none" };
};

const getYunwuPromptCorePresence = (prompt: string) => ({
  hasStoryBeat: /storyBeat[:：]\s*\S/.test(prompt),
  hasVisualAction: /visualAction[:：]\s*\S/.test(prompt),
  hasVoiceoverPart: /voiceoverPart[:：]\s*\S/.test(prompt),
});

const assertCompactedYunwuPrompt = (prompt: string) => {
  const presence = getYunwuPromptCorePresence(prompt);
  if (!presence.hasStoryBeat || !presence.hasVisualAction || !presence.hasVoiceoverPart) {
    throw new Error("云雾 Grok 分段提示词压缩失败：缺少当前段核心内容");
  }
  return presence;
};

const compactPromptForYunwu = (prompt: string, mode: "text-to-video" | "image-to-video") => {
  const maxBytes = getPromptMaxBytes(mode);
  const originalBytes = Buffer.byteLength(prompt, "utf8");
  const userTheme = extractPromptValue(prompt, "全片主题");
  const originalCore = getYunwuPromptCorePresence(prompt);
  const hasCompleteStructuredSegment = originalCore.hasStoryBeat && originalCore.hasVisualAction && originalCore.hasVoiceoverPart;
  const stitchContinuation = extractStitchContinuationInstruction(prompt);
  const stitchContinuationInstruction = stitchContinuation.instruction;
  const stitchContinuationSource = stitchContinuation.source;
  const hadStitchContinuationInstruction = Boolean(stitchContinuationInstruction);
  const agentConstraints = extractAgentConstraintsFromPrompt(prompt);
  const hadAgentConstraints = Boolean(agentConstraints);
  const agentConstraintFlags = getAgentConstraintFlags(agentConstraints);
  const agentConstraintsOriginalBytes = Buffer.byteLength(agentConstraints, "utf8");
  if (originalBytes <= maxBytes) {
    const agentConstraintResult = validateAgentConstraintsPreservation(agentConstraints, prompt);
    logAgentConstraintCompaction(agentConstraintResult, agentConstraintsOriginalBytes, agentConstraintFlags);
    log("PROMPT_COMPACTED", {
      originalBytes,
      finalBytes: originalBytes,
      maxBytes,
      wasCompacted: false,
      promptShape: hasCompleteStructuredSegment ? "structured_segment" : "plain",
      hasUserTheme: Boolean(userTheme),
      userThemePreview: userTheme.slice(0, 120),
      hasStoryBeat: originalCore.hasStoryBeat,
      hasVisualAction: originalCore.hasVisualAction,
      hasVoiceoverPart: originalCore.hasVoiceoverPart,
      hasCompleteStructuredSegment,
      hadStitchContinuationInstruction,
      hasStitchContinuationInstructionAfterCompact: hadStitchContinuationInstruction ? hasStitchContinuationInstruction(prompt) : false,
      stitchContinuationSource,
      stitchContinuationOriginalBytes: Buffer.byteLength(stitchContinuationInstruction, "utf8"),
      stitchContinuationFinalBytes: hadStitchContinuationInstruction ? Buffer.byteLength(stitchContinuationInstruction, "utf8") : 0,
      hadAgentConstraints,
      hasAgentConstraintsAfterCompact: agentConstraintResult.hasAgentConstraintsAfterCompact,
      agentConstraintsPreservationStatus: agentConstraintResult.preservationStatus,
      agentConstraintsOriginalBytes,
      agentConstraintsFinalBytes: agentConstraintResult.agentConstraintsFinalBytes,
      hadPositiveConstraints: agentConstraintFlags.hasPositiveConstraints,
      hadNegativeConstraints: agentConstraintFlags.hasNegativeConstraints,
      hasPositiveConstraintsAfterCompact: agentConstraintResult.hasPositiveConstraintsAfterCompact,
      hasNegativeConstraintsAfterCompact: agentConstraintResult.hasNegativeConstraintsAfterCompact,
      includedFullTheme: Boolean(extractPromptValue(prompt, "全片主题")),
      includedCurrentSegmentTask: Boolean(extractPromptValue(prompt, "当前段任务")),
    });
    return prompt;
  }

  const lines = prompt.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!hasCompleteStructuredSegment) {
    const fallbackSuffix = "\n硬性限制：不要字幕、水印、Logo。";
    const compactAgentConstraintLine = buildCompactAgentConstraintLine(agentConstraints, Math.max(180, Math.floor(maxBytes * 0.3)));
    const suffixLines = [
      compactAgentConstraintLine,
      hadStitchContinuationInstruction ? truncateUtf8Text(stitchContinuationInstruction, Math.max(120, Math.floor(maxBytes * 0.3))) : "",
      fallbackSuffix.trim(),
    ].filter(Boolean);
    const suffix = `\n${suffixLines.join("\n")}`;
    const compacted = `${truncateUtf8Text(prompt, Math.max(0, maxBytes - Buffer.byteLength(suffix, "utf8")))}${suffix}`;
    const hasStitchContinuationInstructionAfterCompact = hadStitchContinuationInstruction ? hasStitchContinuationInstruction(compacted) : false;
    if (hadStitchContinuationInstruction && !hasStitchContinuationInstructionAfterCompact) {
      throw new Error("云雾 Grok 分段提示词压缩失败：缺少尾帧连续性指令");
    }
    const agentConstraintResult = validateAgentConstraintsPreservation(agentConstraints, compacted);
    logAgentConstraintCompaction(agentConstraintResult, agentConstraintsOriginalBytes, agentConstraintFlags);
    log("PROMPT_COMPACTED", {
      originalBytes,
      finalBytes: Buffer.byteLength(compacted, "utf8"),
      maxBytes,
      wasCompacted: true,
      promptShape: "plain",
      hasUserTheme: Boolean(userTheme),
      userThemePreview: userTheme.slice(0, 120),
      hasStoryBeat: originalCore.hasStoryBeat,
      hasVisualAction: originalCore.hasVisualAction,
      hasVoiceoverPart: originalCore.hasVoiceoverPart,
      hasCompleteStructuredSegment,
      hadStitchContinuationInstruction,
      hasStitchContinuationInstructionAfterCompact,
      stitchContinuationSource,
      stitchContinuationOriginalBytes: Buffer.byteLength(stitchContinuationInstruction, "utf8"),
      stitchContinuationFinalBytes: hasStitchContinuationInstructionAfterCompact ? Buffer.byteLength(stitchContinuationInstruction, "utf8") : 0,
      hadAgentConstraints,
      hasAgentConstraintsAfterCompact: agentConstraintResult.hasAgentConstraintsAfterCompact,
      agentConstraintsPreservationStatus: agentConstraintResult.preservationStatus,
      agentConstraintsOriginalBytes,
      agentConstraintsFinalBytes: agentConstraintResult.agentConstraintsFinalBytes,
      hadPositiveConstraints: agentConstraintFlags.hasPositiveConstraints,
      hadNegativeConstraints: agentConstraintFlags.hasNegativeConstraints,
      hasPositiveConstraintsAfterCompact: agentConstraintResult.hasPositiveConstraintsAfterCompact,
      hasNegativeConstraintsAfterCompact: agentConstraintResult.hasNegativeConstraintsAfterCompact,
      includedFullTheme: Boolean(extractPromptValue(compacted, "全片主题")),
      includedCurrentSegmentTask: Boolean(extractPromptValue(compacted, "当前段任务")),
    });
    return compacted;
  }
  const coreLines = [
    compactPromptLine(lines, "当前段", 220),
    stitchContinuationInstruction,
    compactPromptLine(lines, "storyBeat", 520),
    compactPromptLine(lines, "visualAction", 520),
    compactPromptLine(lines, "voiceoverPart", 620),
    compactPromptLine(lines, "continuityIn", 260),
    compactPromptLine(lines, "continuityOut", 260),
    compactPromptLine(lines, "mustNotRepeat", 260),
    compactPromptLine(lines, "连续性要求", 420),
    compactPromptLine(lines, "基础约束", 240),
    "硬性限制：不要字幕、水印、Logo；保留当前段剧情、画面动作和口播；不要朗读内部提示字段。",
  ].filter(Boolean);
  const compactedAgentConstraintLine = buildCompactAgentConstraintLine(agentConstraints, 420);
  const optionalLines = [
    { key: "agentConstraints", line: compactedAgentConstraintLine },
    { key: "fullTheme", line: compactPromptLine(lines, "全片主题", 260) },
    { key: "currentSegmentTask", line: compactPromptLine(lines, "当前段任务", 120) },
  ].filter((item) => Boolean(item.line));
  const compactedLines = [...coreLines];
  const omittedOptionalFields: string[] = [];
  for (const item of optionalLines) {
    const next = [...compactedLines, item.line].join("\n");
    if (Buffer.byteLength(next, "utf8") <= maxBytes) {
      compactedLines.push(item.line);
    } else {
      omittedOptionalFields.push(item.key);
    }
  }
  let compacted = compactedLines.join("\n");
  if (Buffer.byteLength(compacted, "utf8") > maxBytes) {
    omittedOptionalFields.push("fullTheme", "currentSegmentTask");
    const smallerCoreLines = [
      compactPromptLine(lines, "当前段", 180),
      stitchContinuationInstruction,
      compactPromptLine(lines, "storyBeat", 360),
      compactPromptLine(lines, "visualAction", 360),
      compactPromptLine(lines, "voiceoverPart", 420),
      compactPromptLine(lines, "continuityIn", 180),
      compactPromptLine(lines, "continuityOut", 180),
      compactPromptLine(lines, "mustNotRepeat", 180),
      buildCompactAgentConstraintLine(agentConstraints, 320),
      "硬性限制：不要字幕、水印、Logo；不要重复上一段；不要重新开头。",
    ].filter(Boolean);
    compacted = smallerCoreLines.join("\n");
  }
  if (Buffer.byteLength(compacted, "utf8") > maxBytes) {
    throw new Error("云雾 Grok 分段提示词压缩失败：缺少当前段核心内容");
  }
  const compactedCore = assertCompactedYunwuPrompt(compacted);
  const hasStitchContinuationInstructionAfterCompact = hadStitchContinuationInstruction ? hasStitchContinuationInstruction(compacted) : false;
  if (hadStitchContinuationInstruction && !hasStitchContinuationInstructionAfterCompact) {
    throw new Error("云雾 Grok 分段提示词压缩失败：缺少尾帧连续性指令");
  }
  const agentConstraintResult = validateAgentConstraintsPreservation(agentConstraints, compacted);
  logAgentConstraintCompaction(agentConstraintResult, agentConstraintsOriginalBytes, agentConstraintFlags);
  const includedFullTheme = Boolean(compactPromptLine(compacted.split(/\r?\n/).map((line) => line.trim()).filter(Boolean), "全片主题", 40));
  const includedCurrentSegmentTask = Boolean(compactPromptLine(compacted.split(/\r?\n/).map((line) => line.trim()).filter(Boolean), "当前段任务", 40));
  if (omittedOptionalFields.length > 0) {
    log("OPTIONAL_PROMPT_FIELDS_OMITTED", {
      omittedFields: Array.from(new Set(omittedOptionalFields)),
      reason: "preserve_agent_constraints",
      remainingBytes: Math.max(0, maxBytes - Buffer.byteLength(compacted, "utf8")),
    });
  }
  log("PROMPT_COMPACTED", {
    originalBytes,
    finalBytes: Buffer.byteLength(compacted, "utf8"),
    maxBytes,
    wasCompacted: true,
    promptShape: "structured_segment",
    hasUserTheme: Boolean(userTheme),
    userThemePreview: userTheme.slice(0, 120),
    hasStoryBeat: compactedCore.hasStoryBeat,
    hasVisualAction: compactedCore.hasVisualAction,
    hasVoiceoverPart: compactedCore.hasVoiceoverPart,
    hasCompleteStructuredSegment: true,
    hadStitchContinuationInstruction,
    hasStitchContinuationInstructionAfterCompact,
    stitchContinuationSource,
    stitchContinuationOriginalBytes: Buffer.byteLength(stitchContinuationInstruction, "utf8"),
    stitchContinuationFinalBytes: hasStitchContinuationInstructionAfterCompact ? Buffer.byteLength(stitchContinuationInstruction, "utf8") : 0,
    hadAgentConstraints,
    hasAgentConstraintsAfterCompact: agentConstraintResult.hasAgentConstraintsAfterCompact,
    agentConstraintsPreservationStatus: agentConstraintResult.preservationStatus,
    agentConstraintsOriginalBytes,
    agentConstraintsFinalBytes: agentConstraintResult.agentConstraintsFinalBytes,
    hadPositiveConstraints: agentConstraintFlags.hasPositiveConstraints,
    hadNegativeConstraints: agentConstraintFlags.hasNegativeConstraints,
    hasPositiveConstraintsAfterCompact: agentConstraintResult.hasPositiveConstraintsAfterCompact,
    hasNegativeConstraintsAfterCompact: agentConstraintResult.hasNegativeConstraintsAfterCompact,
    includedFullTheme,
    includedCurrentSegmentTask,
  });
  return compacted;
};

const normalizeStatus = (value: unknown): GrokTaskStatus => {
  const status = String(value || "").toLowerCase();
  if (["succeeded", "success", "completed", "complete", "done"].includes(status)) return "succeeded";
  if (["pending", "queued", "queue", "created"].includes(status)) return "pending";
  if (["running", "processing", "generating", "in_progress"].includes(status)) return "processing";
  if (["failed", "failure", "error", "expired"].includes(status)) return "failed";
  if (["cancelled", "canceled"].includes(status)) return "cancelled";
  if (status === "timeout") return "timeout";
  return "unknown";
};

const asRecord = (value: unknown): Record<string, unknown> | undefined => (value && typeof value === "object" ? (value as Record<string, unknown>) : undefined);

const responseRecords = (json: Record<string, unknown> | null) => {
  const top = json ?? undefined;
  const data = asRecord(json?.data);
  const result = asRecord(json?.result);
  const task = asRecord(json?.task);
  const response = asRecord(json?.response);
  return [top, data, result, task, response].filter(Boolean) as Record<string, unknown>[];
};

const responseShape = (json: Record<string, unknown> | null): YunwuResponseShape => {
  const data = asRecord(json?.data);
  const result = asRecord(json?.result);
  const task = asRecord(json?.task);
  const response = asRecord(json?.response);
  if (data && (data.status || data.video || data.video_url || data.url || data.output)) return "data";
  if (result && (result.status || result.video || result.video_url || result.url || result.output)) return "result";
  if (task && (task.request_id || task.requestId || task.task_id || task.taskId || task.id || task.status)) return "task";
  if (response && (response.request_id || response.task_id || response.id || response.status)) return "response";
  if (json) return "top_level";
  return "unknown";
};

const extractRawStatus = (json: Record<string, unknown> | null) => {
  const found = responseRecords(json).map((record) => record.status).find((value) => typeof value === "string" && value.trim().length > 0);
  return typeof found === "string" ? found : "";
};

const extractTaskId = (json: Record<string, unknown> | null) => {
  const candidates = responseRecords(json).flatMap((record) => [record.request_id, record.requestId, record.task_id, record.taskId, record.id]);
  const found = candidates.find((value) => (typeof value === "string" && value.trim().length > 0) || (typeof value === "number" && Number.isFinite(value)));
  return typeof found === "string" ? found.trim() : typeof found === "number" ? String(found) : "";
};

const extractVideoUrl = (json: Record<string, unknown> | null) => {
  const candidates = responseRecords(json).flatMap((record) => {
    const output = asRecord(record.output);
    const video = asRecord(record.video);
    const firstVideo = Array.isArray(record.videos) && record.videos[0] && typeof record.videos[0] === "object" ? (record.videos[0] as Record<string, unknown>) : undefined;
    return [
      video?.url,
      video?.video_url,
      firstVideo?.video_url,
      firstVideo?.url,
      record.video_url,
      record.url,
      record.content_url,
      record.videoUrl,
      output?.video_url,
      output?.url,
      typeof record.output === "string" ? record.output : undefined,
      Array.isArray(record.videos) ? record.videos[0] : undefined,
    ];
  });
  const found = candidates.find((value) => typeof value === "string" && /^https?:\/\//i.test(value));
  return typeof found === "string" ? found : "";
};

const extractCoverUrl = (json: Record<string, unknown> | null) => {
  const candidates = responseRecords(json).flatMap((record) => [record.thumbnail_url, record.cover_url, record.coverUrl]);
  const found = candidates.find((value) => typeof value === "string" && /^https?:\/\//i.test(value));
  return typeof found === "string" ? found : "";
};

const extractVideoDuration = (json: Record<string, unknown> | null) => {
  const candidates = responseRecords(json).flatMap((record) => {
    const video = asRecord(record.video);
    return [video?.duration, record.duration];
  });
  const found = candidates.find((value) => (typeof value === "number" && Number.isFinite(value)) || (typeof value === "string" && Number.isFinite(Number(value))));
  return typeof found === "number" ? found : typeof found === "string" ? Number(found) : undefined;
};

const extractErrorMessage = (json: Record<string, unknown> | null, fallback = "") => {
  const value = responseRecords(json)
    .flatMap((record) => {
      const error = asRecord(record.error);
      return [
        record.code,
        record.error_code,
        record.message,
        record.reason,
        typeof record.error === "string" ? record.error : undefined,
        error?.code,
        error?.type,
        error?.message,
      ];
    })
    .filter((item): item is string => typeof item === "string" && item.length > 0)
    .join(" ");
  return value || fallback;
};

const extractHttpStatusFromMessage = (message: string) => {
  const match = /(?:status=|status:\s*)(\d{3})/i.exec(message);
  return match ? Number(match[1]) : undefined;
};

const extractErrorCodeFromMessage = (message: string) => {
  const text = message.toLowerCase();
  const knownCodes = ["invalid-argument", "invalid_argument", "invalid_request_error", "invalid_request", "bad_request"];
  return knownCodes.find((code) => text.includes(code)) || "";
};

const stringifyNetworkError = (error: unknown) => {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause && typeof error.cause === "object" ? (error.cause as Record<string, unknown>) : undefined;
  return [
    error.name,
    error.message,
    typeof cause?.code === "string" ? cause.code : "",
    typeof cause?.message === "string" ? cause.message : "",
    typeof cause?.name === "string" ? cause.name : "",
  ]
    .filter(Boolean)
    .join(" ");
};

const isClearlyBeforeResponseNetworkError = (error: unknown) => {
  const text = stringifyNetworkError(error).toLowerCase();
  return (
    text.includes("enotfound") ||
    text.includes("eai_again") ||
    text.includes("dns") ||
    text.includes("econnrefused") ||
    text.includes("connection refused") ||
    text.includes("invalid url") ||
    text.includes("err_invalid_url") ||
    text.includes("certificate") ||
    text.includes("tls") ||
    text.includes("ssl") ||
    text.includes("handshake")
  );
};

const isYunwuRequestSizeLimitError = (message: string, status = extractHttpStatusFromMessage(message), code = "") => {
  const text = `${message} ${code}`.toLowerCase();
  return (
    status === 413 ||
    text.includes("status=413") ||
    text.includes("413 payload too large") ||
    text.includes("request body size") ||
    text.includes("request body too large") ||
    text.includes("request body exceeds") ||
    text.includes("request body limit") ||
    text.includes("payload size") ||
    text.includes("payload too large") ||
    text.includes("payload exceeds") ||
    text.includes("request entity too large") ||
    text.includes("entity too large") ||
    text.includes("content length") ||
    text.includes("body size exceeds") ||
    text.includes("maximum allowed request body") ||
    text.includes("maximum allowed payload") ||
    text.includes("image too large") ||
    text.includes("base64 too large") ||
    text.includes("file too large")
  );
};

const isYunwuCapacityOrRateLimitError = (message: string, code = "") => {
  const text = `${message} ${code}`.toLowerCase();
  return (
    text.includes("maximum allowed requests") ||
    text.includes("maximum allowed concurrent") ||
    text.includes("maximum allowed concurrency") ||
    text.includes("maximum allowed jobs") ||
    text.includes("maximum allowed tasks") ||
    text.includes("maximum allowed queue") ||
    text.includes("too many requests") ||
    text.includes("rate limit") ||
    text.includes("rate-limit") ||
    text.includes("throttled") ||
    text.includes("throttling") ||
    text.includes("capacity") ||
    text.includes("overload") ||
    text.includes("service unavailable") ||
    text.includes("model unavailable") ||
    text.includes("model temporarily unavailable") ||
    text.includes("no available channel") ||
    text.includes("no distributor") ||
    text.includes("无可用渠道") ||
    text.includes("模型无可用渠道") ||
    text.includes("服务暂时不可用") ||
    text.includes("上游繁忙") ||
    text.includes("上游负载") ||
    text.includes("当前分组上游负载已饱和")
  );
};

const isYunwuParameterLimitError = (message: string, code = "") => {
  const text = `${message} ${code}`.toLowerCase();
  return (
    text.includes("unsupported duration") ||
    text.includes("invalid duration") ||
    /duration[\s\S]{0,120}(?:exceeds|maximum allowed)/.test(text) ||
    /maximum allowed[\s\S]{0,80}duration/.test(text) ||
    /prompt[\s\S]{0,120}(?:exceeds|too long|maximum allowed)/.test(text) ||
    /maximum allowed[\s\S]{0,80}prompt/.test(text) ||
    /input[\s\S]{0,120}(?:exceeds|too long|maximum allowed)/.test(text) ||
    /maximum allowed[\s\S]{0,80}input/.test(text) ||
    /context[\s\S]{0,80}(?:length exceeded|maximum allowed)/.test(text) ||
    /token[\s\S]{0,80}maximum allowed/.test(text) ||
    /length[\s\S]{0,80}maximum allowed/.test(text) ||
    /reference-to-video[\s\S]{0,120}maximum allowed/.test(text) ||
    text.includes("prompt too long") ||
    text.includes("input too long") ||
    text.includes("context length exceeded")
  );
};

const isYunwuRequiredImageError = (message: string, code = "") => {
  const text = `${message} ${code}`.toLowerCase();
  return (
    text.includes("image is required") ||
    text.includes("missing image") ||
    text.includes("required image") ||
    text.includes("only supports image-to-video")
  );
};

const isYunwuInvalidImageError = (message: string, code = "") => {
  const text = `${message} ${code}`.toLowerCase();
  return (
    text.includes("invalid image") ||
    text.includes("invalid base64") ||
    text.includes("invalid reference image")
  );
};

const isYunwuExplicitParameterError = (message: string, code = "") => {
  const text = `${message} ${code}`.toLowerCase();
  return (
    text.includes("参数错误") ||
    text.includes("参数无效") ||
    text.includes("invalid parameter") ||
    text.includes("invalid params") ||
    text.includes("bad parameter")
  );
};

const isYunwuInvalidRequestCodeError = (message: string, code = "") => {
  const text = `${message} ${code}`.toLowerCase();
  return (
    text.includes("invalid-argument") ||
    text.includes("invalid_argument") ||
    text.includes("invalid_request") ||
    text.includes("invalid request") ||
    text.includes("bad_request") ||
    text.includes("invalid_request_error") ||
    isYunwuRequiredImageError(message, code) ||
    isYunwuInvalidImageError(message, code)
  );
};

const isNonRetryableError = (message: string) => {
  const text = message.toLowerCase();
  const status = extractHttpStatusFromMessage(message);
  if (isYunwuRequestSizeLimitError(message, status)) return true;
  if (isYunwuCapacityOrRateLimitError(message)) return false;
  if (status === 429) {
    return isYunwuParameterLimitError(message) || isYunwuRequiredImageError(message) || isYunwuInvalidImageError(message) || isYunwuExplicitParameterError(message);
  }
  if (isYunwuParameterLimitError(message)) return true;
  if (isYunwuInvalidRequestCodeError(message)) return true;
  if (isYunwuExplicitParameterError(message)) return true;
  return (
    text.includes("yunwu_grok_video_api_key") ||
    text.includes("api key") ||
    text.includes("为避免重复生成") ||
    text.includes("提交状态不确定") ||
    text.includes("401") ||
    text.includes("403") ||
    text.includes("status=400") ||
    text.includes("unauthorized") ||
    text.includes("forbidden") ||
    text.includes("参考图读取失败") ||
    text.includes("failed to decode base64 image") ||
    text.includes("illegal base64 data") ||
    text.includes("invalid image base64") ||
    text.includes("image decode failed")
  );
};

const isRetryableError = (message: string) => !isNonRetryableError(message);

const isYunwuModelFallbackEligibleError = (message: string) => {
  const text = message.toLowerCase();
  const status = extractHttpStatusFromMessage(message);
  if (isNonRetryableError(message)) return false;
  return (
    isYunwuCapacityOrRateLimitError(message) ||
    status === 429 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    text.includes("model unavailable") ||
    text.includes("model temporarily unavailable") ||
    text.includes("no available channel") ||
    text.includes("no distributor") ||
    text.includes("无可用渠道") ||
    text.includes("模型无可用渠道") ||
    text.includes("timeout") ||
    text.includes("network timeout") ||
    text.includes("fetch failed")
  );
};

const isQueryFetchRetryableError = (message: string) => {
  const text = message.toLowerCase();
  return (
    text.includes("fetch failed") ||
    text.includes("network") ||
    text.includes("timeout") ||
    text.includes("aborterror") ||
    text.includes("status=429") ||
    /status=5\d\d/.test(text)
  );
};

const mimeFromPathOrUrl = (value: string) => {
  const ext = (() => {
    try {
      return path.extname(new URL(value).pathname).toLowerCase();
    } catch {
      return path.extname(value).toLowerCase();
    }
  })();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
};

const getConfiguredPublicSiteUrl = () => (process.env.PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");

const isLocalDevHost = (hostname: string) => {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "0.0.0.0" || normalized === "::1" || normalized === "[::1]";
};

const isPrivateIpv4Host = (hostname: string) => {
  const parts = hostname.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [first, second] = parts;
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254) ||
    (first === 100 && second >= 64 && second <= 127)
  );
};

const isPrivateOrInternalHost = (hostname: string) => {
  const normalized = hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  return (
    isLocalDevHost(normalized) ||
    isPrivateIpv4Host(normalized) ||
    (normalized.includes(":") && (normalized.startsWith("fc") || normalized.startsWith("fd"))) ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized.endsWith(".lan") ||
    !normalized.includes(".")
  );
};

const isPublicSiteUrlUsableForYunwu = (siteUrl = getConfiguredPublicSiteUrl()) => {
  if (!siteUrl) return false;
  try {
    const parsed = new URL(siteUrl);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && !isPrivateOrInternalHost(parsed.hostname);
  } catch {
    return false;
  }
};

async function readLocalUploadImageAsDataUrl(source: string): Promise<PreparedGrokImage> {
  const localSource = await resolveLocalUploadsSource(source);
  if (!localSource || !localSource.exists) {
    throw new Error("本地参考图文件不存在");
  }
  const bytes = await readFile(localSource.resolvedPath);
  const mimeType = mimeFromPathOrUrl(localSource.resolvedPath);
  return { url: `data:${mimeType};base64,${bytes.toString("base64")}`, mimeType, mode: "image.url.data_url" };
}

async function fetchImageAsDataUrl(source: string): Promise<PreparedGrokImage> {
  const response = await fetch(source);
  if (!response.ok) {
    throw new Error(`参考图服务端读取失败 status=${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() || mimeFromPathOrUrl(source);
  return { url: `data:${mimeType};base64,${bytes.toString("base64")}`, mimeType, mode: "image.url.data_url" };
}

const stripDataUrl = (value: string) => {
  const match = /^data:([^;,]+);base64,([\s\S]+)$/i.exec(value.trim());
  if (!match) return null;
  return {
    mimeType: match[1].toLowerCase(),
    base64: match[2].replace(/\s+/g, ""),
  };
};

const assertBase64Image = (value: string) => {
  if (!value || /[^a-zA-Z0-9+/=]/.test(value) || value.length % 4 === 1) {
    throw new Error("invalid image base64");
  }
};

async function prepareGrokReferenceImages(images?: string[]): Promise<PreparedGrokImage[]> {
  const sourceImages = (images || []).filter((item) => typeof item === "string" && item.trim().length > 0);
  const prepared: PreparedGrokImage[] = [];
  for (const source of sourceImages) {
    const trimmed = source.trim();
    try {
      const dataUrl = stripDataUrl(trimmed);
      if (dataUrl) {
        assertBase64Image(dataUrl.base64);
        prepared.push({ url: `data:${dataUrl.mimeType};base64,${dataUrl.base64}`, mimeType: dataUrl.mimeType, mode: "image.url.data_url" });
        continue;
      }

      if (trimmed.startsWith("/api/uploads/")) {
        const publicSiteUrl = getConfiguredPublicSiteUrl();
        if (isPublicSiteUrlUsableForYunwu(publicSiteUrl)) {
          prepared.push({ url: `${publicSiteUrl}${trimmed}`, mimeType: mimeFromPathOrUrl(trimmed), mode: "image.url.public_url" });
        } else {
          prepared.push(await readLocalUploadImageAsDataUrl(trimmed));
        }
        continue;
      }

      if (/^https?:\/\//i.test(trimmed)) {
        let parsedUrl: URL | null = null;
        try {
          parsedUrl = new URL(trimmed);
        } catch {
          parsedUrl = null;
        }
        if (parsedUrl && isPrivateOrInternalHost(parsedUrl.hostname)) {
          const localUploadSource = await resolveLocalUploadsSource(trimmed);
          prepared.push(localUploadSource?.exists ? await readLocalUploadImageAsDataUrl(trimmed) : await fetchImageAsDataUrl(trimmed));
          continue;
        }
        prepared.push({ url: trimmed, mimeType: mimeFromPathOrUrl(trimmed), mode: "image.url.public_url" });
        continue;
      }

      const localSource = await resolveLocalUploadsSource(trimmed);
      if (localSource) {
        prepared.push(await readLocalUploadImageAsDataUrl(trimmed));
        continue;
      }

      const rawBase64 = trimmed.replace(/\s+/g, "");
      assertBase64Image(rawBase64);
      prepared.push({ url: `data:image/jpeg;base64,${rawBase64}`, mimeType: "image/jpeg", mode: "image.url.data_url" });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`云雾 Grok 参考图读取失败：${reason}`);
    }
  }
  return prepared;
}

const getReferenceOnlyMode = (image?: PreparedGrokImage) =>
  image?.mode === "image.url.public_url"
    ? "reference_images.public_url"
    : image?.mode === "image.url.data_url"
      ? "reference_images.data_url"
      : "none";

export async function createGrokVideoTask(params: { prompt: string; ratio: string; images?: PreparedGrokImage[]; referenceImageRole?: GrokReferenceImageRole; attempt?: number; durationSeconds?: number }) {
  const image = params.images?.[0];
  const hasReferenceImage = Boolean(image);
  const referenceImageRole: GrokReferenceImageRole = image ? params.referenceImageRole || "first_frame" : "reference_only";
  const requestedDuration = Number(params.durationSeconds);
  const duration = Number.isFinite(requestedDuration) && requestedDuration >= 1 && requestedDuration <= 15
    ? Math.floor(requestedDuration)
    : GROK_UNIT_SECONDS;
  const usesFirstFrameImage = Boolean(image && referenceImageRole === "first_frame");
  const usesSingleImageForReferenceOnly = Boolean(image && referenceImageRole === "reference_only" && duration > GROK_UNIT_SECONDS);
  const usesImagePayload = usesFirstFrameImage || usesSingleImageForReferenceOnly;
  const usesReferenceImages = Boolean(image && !usesImagePayload);
  const mode = usesImagePayload ? "image-to-video" : usesReferenceImages ? "reference-to-video" : "text-to-video";
  const promptMode = usesImagePayload ? "image-to-video" : "text-to-video";
  const rawPrompt =
    image && referenceImageRole === "reference_only" && !params.prompt.includes(REFERENCE_ONLY_PROMPT_INSTRUCTION)
      ? `${params.prompt.trim()}\n${REFERENCE_ONLY_PROMPT_INSTRUCTION}`
      : params.prompt.trim();
  const prompt = compactPromptForYunwu(rawPrompt, promptMode);
  const aspectRatio = params.ratio === "9:16" ? "9:16" : "16:9";
  const payload: {
    model: string;
    prompt: string;
    resolution: string;
    aspect_ratio: string;
    duration: number;
    image?: { url: string };
    reference_images?: Array<{ url: string }>;
  } = {
    model: "",
    prompt,
    resolution: "720p",
    aspect_ratio: aspectRatio,
    duration,
  };
  if (image && usesImagePayload) {
    payload.image = { url: image.url };
  } else if (image && usesReferenceImages) {
    payload.reference_images = params.images?.map((item) => ({ url: item.url }));
  }
  const referenceImageMode = usesImagePayload ? image?.mode || "none" : getReferenceOnlyMode(image);
  const primaryModel = getPrimaryModel();
  const fallbackCandidate = getFallbackModel();
  const fallbackModel = fallbackCandidate && fallbackCandidate !== primaryModel ? fallbackCandidate : "";
  const primaryMaxAttempts = getCreateMaxAttempts("YUNWU_GROK_PRIMARY_MAX_ATTEMPTS", 2);
  const fallbackMaxAttempts = getCreateMaxAttempts("YUNWU_GROK_FALLBACK_MAX_ATTEMPTS", 2);
  const modelPlan: Array<{ role: "primary" | "fallback"; model: string; maxAttempts: number; backoffMs: number }> = [
    { role: "primary", model: primaryModel, maxAttempts: primaryMaxAttempts, backoffMs: PRIMARY_CREATE_BACKOFF_MS },
    ...(fallbackModel ? [{ role: "fallback" as const, model: fallbackModel, maxAttempts: fallbackMaxAttempts, backoffMs: FALLBACK_CREATE_BACKOFF_MS }] : []),
  ];
  let totalAttempt = 0;
  let primaryFailureReason = "";

  for (const plan of modelPlan) {
    if (plan.role === "primary") {
      log("PRIMARY_MODEL_START", {
        model: plan.model,
        duration,
        mode,
        hasReferenceImage,
        referenceImageRole: image ? referenceImageRole : "none",
        referenceImageMode,
        maxAttempts: plan.maxAttempts,
      });
    } else {
      log("FALLBACK_MODEL_START", {
        primaryModel,
        fallbackModel: plan.model,
        primaryFailureReason,
        duration,
        mode,
        referenceImageRole: image ? referenceImageRole : "none",
        referenceImageMode,
        maxAttempts: plan.maxAttempts,
      });
    }

    let lastReason = "";
    for (let modelAttempt = 1; modelAttempt <= plan.maxAttempts; modelAttempt += 1) {
      totalAttempt += 1;
      const requestPayload = { ...payload, model: plan.model };
      try {
        log("CREATE_REQUEST", {
          attempt: totalAttempt,
          modelRole: plan.role,
          modelAttempt,
          totalAttempt,
          endpoint: CREATE_PATH,
          baseUrl: getBaseUrl(),
          model: plan.model,
          mode,
          promptBytes: Buffer.byteLength(prompt, "utf8"),
          duration: requestPayload.duration,
          resolution: requestPayload.resolution,
          aspectRatio: requestPayload.aspect_ratio,
          hasReferenceImage,
          referenceImageRole: image ? referenceImageRole : "none",
          referenceImageMode,
          referenceImageCompatibilityMode: usesSingleImageForReferenceOnly ? "single_image_required_for_15s_reference" : "none",
          imageUrlPreview: image?.mode === "image.url.public_url" ? image.url.slice(0, 140) : "",
          imagePayloadPreviewLength: image?.mode === "image.url.data_url" ? image.url.length : 0,
          mimeType: image?.mimeType || "",
        });
        let response: Response;
        try {
          response = await fetch(`${getBaseUrl()}${CREATE_PATH}`, {
            method: "POST",
            headers: buildHeaders(),
            body: JSON.stringify(requestPayload),
          });
        } catch (fetchError) {
          if (!isClearlyBeforeResponseNetworkError(fetchError)) {
            throw new YunwuCreateUncertainError({
              message: "云雾任务提交状态不确定，为避免重复生成，已停止自动重试。",
              reason: "network_state_uncertain",
              rawPreview: stringifyNetworkError(fetchError).slice(0, 500),
            });
          }
          throw new Error(stringifyNetworkError(fetchError));
        }
        const parsed = await parseCreateJsonResponse(response);
        const taskId = extractTaskId(parsed.json);
        log("CREATE_RESPONSE", {
          attempt: totalAttempt,
          modelRole: plan.role,
          modelAttempt,
          totalAttempt,
          status: parsed.status,
          ok: parsed.ok,
          taskId,
          requestId: typeof parsed.json?.request_id === "string" ? parsed.json.request_id : "",
          id: typeof parsed.json?.id === "string" ? parsed.json.id : "",
          apiModel: plan.model,
          actualModel: plan.model,
          rawPreview: safeResponsePreview(parsed.json),
        });
        if (!parsed.ok) {
          throw new Error(`Grok 创建视频失败 status=${parsed.status} ${extractErrorMessage(parsed.json, parsed.rawText.slice(0, 120))}`);
        }
        if (!taskId) {
          const shape = responseShape(parsed.json);
          const rawPreview = parsed.json ? safeResponsePreview(parsed.json) : parsed.rawText.slice(0, 500);
          log("CREATE_RESPONSE_UNCERTAIN", {
            model: plan.model,
            modelRole: plan.role,
            modelAttempt,
            totalAttempt,
            httpStatus: parsed.status,
            responseShape: shape,
            reason: "task_id_missing",
            retryable: false,
            fallbackEligible: false,
            rawPreview,
          });
          throw new YunwuCreateUncertainError({
            message: "云雾任务可能已创建，但响应未返回可识别的任务ID，为避免重复生成，已停止自动重试。",
            reason: "task_id_missing",
            httpStatus: parsed.status,
            responseShape: shape,
            rawPreview,
          });
        }
        if (plan.role === "fallback") {
          log("FALLBACK_MODEL_SUCCESS", { primaryModel, fallbackModel: plan.model, taskId, requestId: typeof parsed.json?.request_id === "string" ? parsed.json.request_id : "", attempts: modelAttempt });
        }
        return {
          taskId,
          queryMode: "official_videos" as const,
          raw: parsed.json,
          apiModel: plan.model,
          actualModel: plan.model,
          modelRole: plan.role,
          usedFallback: plan.role === "fallback",
        };
      } catch (error) {
        if (error instanceof YunwuCreateUncertainError) {
          if (error.reason !== "task_id_missing") {
            log("CREATE_RESPONSE_UNCERTAIN", {
              model: plan.model,
              modelRole: plan.role,
              modelAttempt,
              totalAttempt,
              httpStatus: error.httpStatus ?? "",
              responseShape: error.responseShape || "unknown",
              reason: error.reason,
              retryable: false,
              fallbackEligible: false,
              rawPreview: error.rawPreview || "",
            });
          }
          log("AUTO_RETRY_STOPPED", {
            model: plan.model,
            modelRole: plan.role,
            reason: "avoid_duplicate_create",
            attemptsUsed: modelAttempt,
          });
          throw new Error(error.message);
        }
        const reason = error instanceof Error ? error.message : String(error);
        lastReason = reason;
        const retryable = isRetryableError(reason);
        const status = extractHttpStatusFromMessage(reason);
        const code = extractErrorCodeFromMessage(reason);
        const canRetryModel = retryable && modelAttempt < plan.maxAttempts;
        if (canRetryModel) {
          log("RETRY", {
            stage: "create",
            model: plan.model,
            modelRole: plan.role,
            modelAttempt,
            maxAttempts: plan.maxAttempts,
            totalAttempt,
            delayMs: plan.backoffMs,
            reason,
            retryable: true,
            retryReason: isYunwuCapacityOrRateLimitError(reason) || status === 429 ? "capacity_or_rate_limit" : "transient_or_unknown",
          });
          await delay(plan.backoffMs);
          continue;
        }
        if (plan.role === "primary") {
          primaryFailureReason = reason;
          const fallbackEligible = Boolean(fallbackModel) && isYunwuModelFallbackEligibleError(reason);
          log("PRIMARY_MODEL_FAILED", {
            model: plan.model,
            attempts: modelAttempt,
            reason,
            retryable,
            fallbackEligible,
            status,
            code,
          });
          if (fallbackEligible) break;
          throw new Error(reason);
        }
        log("FALLBACK_MODEL_FAILED", {
          primaryModel,
          fallbackModel: plan.model,
          attempts: modelAttempt,
          reason,
          retryable,
          status,
          code,
        });
        throw new Error(primaryFailureReason ? `云雾 Grok 当前主模型与备用模型均不可用，请稍后重试。主模型失败：${primaryFailureReason}；备用模型失败：${reason}` : reason);
      }
    }

    if (plan.role === "fallback") {
      log("FALLBACK_MODEL_FAILED", {
        primaryModel,
        fallbackModel: plan.model,
        attempts: plan.maxAttempts,
        reason: lastReason,
        retryable: isRetryableError(lastReason),
        status: extractHttpStatusFromMessage(lastReason),
        code: extractErrorCodeFromMessage(lastReason),
      });
      throw new Error(primaryFailureReason ? `云雾 Grok 当前主模型与备用模型均不可用，请稍后重试。主模型失败：${primaryFailureReason}；备用模型失败：${lastReason}` : lastReason);
    }
  }
  throw new Error(primaryFailureReason || "Grok 创建视频失败");
}

export async function queryGrokVideoTask(taskId: string, queryMode: YunwuQueryMode = "official_videos"): Promise<GrokTaskQueryResult> {
  const endpoint = queryMode === "official_videos" ? `/v1/videos/${encodeURIComponent(taskId)}` : `${QUERY_PATH}?id=${encodeURIComponent(taskId)}`;
  log("QUERY_REQUEST", {
    endpoint: `${getBaseUrl()}${endpoint}`,
    requestId: taskId,
    taskId,
    queryMode,
  });
  const response = await fetch(`${getBaseUrl()}${endpoint}`, {
    method: "GET",
    headers: buildHeaders(),
  });
  const parsed = await parseJsonResponse(response);
  const rawStatus = extractRawStatus(parsed.json);
  const normalizedStatus = normalizeStatus(rawStatus);
  const videoUrl = extractVideoUrl(parsed.json);
  const mappedStatus: GrokTaskStatus =
    normalizedStatus === "unknown" && videoUrl
      ? "succeeded"
      : normalizedStatus === "cancelled"
        ? "failed"
        : queryMode === "official_videos" && normalizedStatus === "pending"
          ? "processing"
          : normalizedStatus;
  const duration = extractVideoDuration(parsed.json);
  const mappedStatusLabel = mappedStatus === "succeeded" ? "success" : mappedStatus;
  log("QUERY_RESPONSE", {
    requestId: taskId,
    taskId,
    rawStatus,
    status: rawStatus,
    mappedStatus: mappedStatusLabel,
    responseShape: responseShape(parsed.json),
    ok: parsed.ok,
    httpStatus: parsed.status,
    hasVideoUrl: Boolean(videoUrl),
    videoUrlPreview: videoUrl ? videoUrl.slice(0, 140) : "",
    duration,
    queryMode,
    rawPreview: safeResponsePreview(parsed.json),
  });
  if (!parsed.ok) {
    throw new Error(`Grok 查询任务失败 status=${parsed.status} ${extractErrorMessage(parsed.json, parsed.rawText.slice(0, 120))}`);
  }
  return {
    taskId: extractTaskId(parsed.json) || taskId,
    status: mappedStatus,
    rawStatus,
    videoUrl,
    coverUrl: extractCoverUrl(parsed.json),
    duration,
    errorMessage: extractErrorMessage(parsed.json, ""),
    raw: parsed.json ?? undefined,
  };
}

export async function extendGrokVideoTask(params: { prompt: string; taskId: string; ratio: string; startTime: number; attempt?: number }): Promise<{ taskId: string; queryMode: YunwuQueryMode; raw?: Record<string, unknown> }> {
  log("EXTEND_UNSUPPORTED", {
    reason: YUNWU_OFFICIAL_EXTEND_UNSUPPORTED_MESSAGE,
    targetDurationSeconds: params.startTime + GROK_UNIT_SECONDS,
    strategy: "extend",
    taskId: params.taskId,
  });
  throw new Error(YUNWU_OFFICIAL_EXTEND_UNSUPPORTED_MESSAGE);
}

async function queryGrokVideoTaskWithFetchRetry(taskId: string, queryMode: YunwuQueryMode) {
  for (let attempt = 1; attempt <= QUERY_FETCH_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await queryGrokVideoTask(taskId, queryMode);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (!isQueryFetchRetryableError(reason) || attempt === QUERY_FETCH_MAX_ATTEMPTS) {
        throw new Error(reason);
      }
      const delayMs = QUERY_FETCH_BACKOFF_MS[attempt - 1] ?? QUERY_FETCH_BACKOFF_MS[QUERY_FETCH_BACKOFF_MS.length - 1];
      log("QUERY_RETRY", { taskId, queryMode, attempt, maxAttempts: QUERY_FETCH_MAX_ATTEMPTS, delayMs, reason });
      await delay(delayMs);
    }
  }
  throw new Error(`Grok 查询任务失败，taskId=${taskId}`);
}

async function waitForGrokTask(taskId: string, queryMode: YunwuQueryMode): Promise<GrokTaskQueryResult> {
  const pollIntervalMs = Math.max(1000, Number(process.env.YUNWU_GROK_VIDEO_POLL_INTERVAL_MS || 5000));
  const maxPoll = Math.max(1, Number(process.env.YUNWU_GROK_VIDEO_POLL_MAX_ATTEMPTS || 120));
  for (let pollCount = 1; pollCount <= maxPoll; pollCount += 1) {
    const result = await queryGrokVideoTaskWithFetchRetry(taskId, queryMode);
    if (result.status === "succeeded") {
      if (result.videoUrl) return result;
      throw new Error(`Grok 任务已完成但未返回 video_url，taskId=${taskId}`);
    }
    if (result.status === "failed" || result.status === "cancelled" || result.status === "timeout") {
      throw new Error(result.errorMessage || `Grok 任务失败，status=${result.rawStatus || result.status}`);
    }
    if (result.status === "unknown") {
      log("QUERY_RESPONSE", { taskId, queryMode, pollCount, unknownStatus: result.rawStatus, decision: "continue_polling" });
    }
    await delay(pollIntervalMs);
  }
  throw new Error(`Grok 任务查询超时，taskId=${taskId}`);
}

async function runStepWithRetry(params: {
  stage: "create" | "extend";
  prompt: string;
  ratio: string;
  previousTaskId?: string;
  startTime: number;
  images?: PreparedGrokImage[];
  referenceImageRole?: GrokReferenceImageRole;
  durationSeconds?: number;
}) {
  if (params.stage === "create") {
    const created = await createGrokVideoTask({ prompt: params.prompt, ratio: params.ratio, images: params.images, referenceImageRole: params.referenceImageRole, durationSeconds: params.durationSeconds });
    const result = await waitForGrokTask(created.taskId, created.queryMode);
    return {
      ...result,
      apiModel: created.apiModel,
      actualModel: created.actualModel,
      modelRole: created.modelRole,
      usedFallback: created.usedFallback,
    };
  }
  let lastTaskId = "";
  let lastError = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const created = await extendGrokVideoTask({
        prompt: params.prompt,
        ratio: params.ratio,
        taskId: params.previousTaskId || "",
        startTime: params.startTime,
        attempt,
      });
      lastTaskId = created.taskId;
      const result = await waitForGrokTask(created.taskId, created.queryMode);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastError = message;
      const nonRetryable = isNonRetryableError(message);
      if (nonRetryable || !isRetryableError(message) || attempt === MAX_ATTEMPTS) {
        log("FINAL_FAILED", {
          stage: params.stage,
          attempts: attempt,
          finalReason: message,
          lastTaskId,
          retryable: false,
          nonRetryableReason: nonRetryable ? "invalid_or_unsupported_request" : attempt === MAX_ATTEMPTS ? "max_attempts_reached" : "not_retryable",
        });
        throw new Error(message);
      }
      const delayMs = RETRY_BACKOFF_MS[attempt - 1] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1];
      log("RETRY", {
        stage: params.stage,
        attempt,
        maxAttempts: MAX_ATTEMPTS,
        delayMs,
        reason: message,
        taskId: lastTaskId,
        retryable: true,
        retryReason: isYunwuCapacityOrRateLimitError(message) || extractHttpStatusFromMessage(message) === 429 ? "capacity_or_rate_limit" : "transient_or_unknown",
      });
      await delay(delayMs);
    }
  }
  throw new Error(lastError || "Grok 视频生成失败");
}

export async function runYunwuGrokVideoWithExtensions(params: GrokVideoWithExtensionsInput): Promise<GrokVideoResult> {
  const providerTaskIds: string[] = [];
  const segmentVideoUrls: string[] = [];
  const segmentCoverUrls: string[] = [];
  let successfulUnits = 0;
  if (params.extensionPrompts.length > 0) {
    log("EXTEND_UNSUPPORTED", {
      reason: YUNWU_OFFICIAL_EXTEND_UNSUPPORTED_MESSAGE,
      targetDurationSeconds: params.targetDurationSeconds,
      strategy: "extend",
    });
    return {
      ok: false,
      providerSource: DEFAULT_GROK_PROVIDER_SOURCE,
      providerTaskIds,
      segmentVideoUrls,
      segmentCoverUrls,
      isFinalVideoLikelyComplete: false,
      durationSeconds: params.targetDurationSeconds,
      successfulUnits,
      failedUnits: Math.max(1, Math.ceil(params.targetDurationSeconds / GROK_UNIT_SECONDS)),
      error: YUNWU_OFFICIAL_EXTEND_UNSUPPORTED_MESSAGE,
    };
  }
  try {
    const baseImages = await prepareGrokReferenceImages(params.referenceImages);
    const createDurationSeconds =
      params.extensionPrompts.length === 0 && params.targetDurationSeconds >= 1 && params.targetDurationSeconds <= 15
        ? params.targetDurationSeconds
        : GROK_UNIT_SECONDS;
    const baseResult = await runStepWithRetry({
      stage: "create",
      prompt: params.basePrompt,
      ratio: params.ratio,
      images: baseImages,
      referenceImageRole: params.referenceImageRole,
      startTime: 0,
      durationSeconds: createDurationSeconds,
    });
    providerTaskIds.push(baseResult.taskId);
    if (baseResult.videoUrl) segmentVideoUrls.push(baseResult.videoUrl);
    if (baseResult.coverUrl) segmentCoverUrls.push(baseResult.coverUrl);
    successfulUnits += 1;

    const finalResult = baseResult;

    const finalVideoUrl = finalResult.videoUrl || segmentVideoUrls[segmentVideoUrls.length - 1] || "";
    const finalCoverUrl = finalResult.coverUrl || segmentCoverUrls[segmentCoverUrls.length - 1] || "";
    const isFinalVideoLikelyComplete = params.extensionPrompts.length === 0 ? true : undefined;
    log("FINAL_SUCCESS", {
      providerTaskIdsCount: providerTaskIds.length,
      finalTaskId: finalResult.taskId,
      finalVideoUrl: Boolean(finalVideoUrl),
      segmentVideoUrlsCount: segmentVideoUrls.length,
      targetDurationSeconds: params.targetDurationSeconds,
      successfulUnits,
      isFinalVideoLikelyComplete: isFinalVideoLikelyComplete ?? "unknown",
    });
    return {
      ok: Boolean(finalVideoUrl),
      providerSource: DEFAULT_GROK_PROVIDER_SOURCE,
      providerTaskIds,
      finalTaskId: finalResult.taskId,
      finalVideoUrl,
      finalCoverUrl,
      segmentVideoUrls,
      segmentCoverUrls,
      isFinalVideoLikelyComplete,
      durationSeconds: params.targetDurationSeconds,
      successfulUnits,
      failedUnits: Math.max(0, (params.extensionPrompts.length === 0 ? 1 : Math.ceil(params.targetDurationSeconds / GROK_UNIT_SECONDS)) - successfulUnits),
      apiModel: finalResult.apiModel,
      actualModel: finalResult.actualModel,
      modelRole: finalResult.modelRole,
      usedFallback: finalResult.usedFallback,
      error: finalVideoUrl ? undefined : "Grok 任务完成但没有可用视频地址",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const nonRetryable = isNonRetryableError(message);
    log("FINAL_FAILED", {
      stage: "run",
      attempts: 1,
      finalReason: message,
      lastTaskId: providerTaskIds[providerTaskIds.length - 1] || "",
      providerTaskIdsCount: providerTaskIds.length,
      segmentVideoUrlsCount: segmentVideoUrls.length,
      targetDurationSeconds: params.targetDurationSeconds,
      successfulUnits,
      retryable: !nonRetryable,
      nonRetryableReason: nonRetryable ? "invalid_or_unsupported_request" : undefined,
    });
    return {
      ok: false,
      providerSource: DEFAULT_GROK_PROVIDER_SOURCE,
      providerTaskIds,
      finalTaskId: providerTaskIds[providerTaskIds.length - 1],
      finalVideoUrl: segmentVideoUrls[segmentVideoUrls.length - 1],
      finalCoverUrl: segmentCoverUrls[segmentCoverUrls.length - 1],
      segmentVideoUrls,
      segmentCoverUrls,
      isFinalVideoLikelyComplete: false,
      durationSeconds: params.targetDurationSeconds,
      successfulUnits,
      failedUnits: Math.max(1, (params.extensionPrompts.length === 0 ? 1 : Math.ceil(params.targetDurationSeconds / GROK_UNIT_SECONDS)) - successfulUnits),
      error: message,
    };
  }
}

export async function runYunwuGrokVideoSegments(params: GrokVideoSegmentsInput): Promise<GrokVideoResult> {
  const providerTaskIds: string[] = [];
  const segmentVideoUrls: string[] = [];
  const segmentCoverUrls: string[] = [];
  let successfulUnits = 0;
  let apiModel = "";
  let actualModel = "";
  let modelRole: "primary" | "fallback" | undefined;
  let usedFallback = false;
  try {
    let previousVideoUrl = "";
    for (let index = 0; index < params.prompts.length; index += 1) {
      const segmentIndex = index + 1;
      log("STITCH_SEGMENT_START", { segmentIndex, totalSegments: params.prompts.length, hasPreviousVideo: Boolean(previousVideoUrl) });
      let imageSources = await params.getReferenceImagesForSegment?.(segmentIndex, previousVideoUrl);
      if (index > 0 && !imageSources?.length && previousVideoUrl) {
        const frame = await extractTailReferenceFrameForContinuation({
          taskId: params.taskId || `yunwu-grok-${Date.now()}`,
          segmentIndex,
          sourceVideoUrl: previousVideoUrl,
        });
        imageSources = [frame.referenceUrl];
        log("STITCH_INTERNAL_TAIL_FRAME_FALLBACK", {
          segmentIndex,
          previousVideoUrlPreview: previousVideoUrl.slice(0, 140),
          referenceImageUrl: frame.referenceUrl,
        });
      }
      const images = await prepareGrokReferenceImages(imageSources);
      const result = await runStepWithRetry({
        stage: "create",
        prompt: params.prompts[index],
        ratio: params.ratio,
        images,
        referenceImageRole: "first_frame",
        startTime: 0,
      });
      providerTaskIds.push(result.taskId);
      if (result.videoUrl) segmentVideoUrls.push(result.videoUrl);
      if (result.videoUrl) segmentCoverUrls.push(result.coverUrl || "");
      apiModel = result.apiModel || apiModel;
      actualModel = result.actualModel || actualModel;
      modelRole = result.modelRole || modelRole;
      usedFallback = Boolean(usedFallback || result.usedFallback);
      previousVideoUrl = result.videoUrl || "";
      successfulUnits += 1;
      log("STITCH_SEGMENT_SUCCESS", { segmentIndex, taskId: result.taskId, hasVideoUrl: Boolean(result.videoUrl), imagesCount: images.length });
    }
    const finalVideoUrl = segmentVideoUrls[segmentVideoUrls.length - 1] || "";
    const finalCoverUrl = segmentCoverUrls[segmentCoverUrls.length - 1] || "";
    log("FINAL_SUCCESS", {
      providerTaskIdsCount: providerTaskIds.length,
      finalTaskId: providerTaskIds[providerTaskIds.length - 1],
      finalVideoUrl: Boolean(finalVideoUrl),
      segmentVideoUrlsCount: segmentVideoUrls.length,
      targetDurationSeconds: params.targetDurationSeconds,
      successfulUnits,
      isFinalVideoLikelyComplete: "segmented",
    });
    return {
      ok: Boolean(finalVideoUrl),
      providerSource: DEFAULT_GROK_PROVIDER_SOURCE,
      providerTaskIds,
      finalTaskId: providerTaskIds[providerTaskIds.length - 1],
      finalVideoUrl,
      finalCoverUrl,
      segmentVideoUrls,
      segmentCoverUrls,
      isFinalVideoLikelyComplete: false,
      durationSeconds: params.targetDurationSeconds,
      successfulUnits,
      failedUnits: Math.max(0, params.prompts.length - successfulUnits),
      apiModel,
      actualModel,
      modelRole,
      usedFallback,
      error: finalVideoUrl ? undefined : "Grok 分段生成完成但没有可用视频地址",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const nonRetryable = isNonRetryableError(message);
    log("FINAL_FAILED", {
      stage: "stitch",
      attempts: 1,
      finalReason: message,
      lastTaskId: providerTaskIds[providerTaskIds.length - 1] || "",
      providerTaskIdsCount: providerTaskIds.length,
      segmentVideoUrlsCount: segmentVideoUrls.length,
      targetDurationSeconds: params.targetDurationSeconds,
      successfulUnits,
      retryable: !nonRetryable,
      nonRetryableReason: nonRetryable ? "invalid_or_unsupported_request" : undefined,
    });
    return {
      ok: false,
      providerSource: DEFAULT_GROK_PROVIDER_SOURCE,
      providerTaskIds,
      finalTaskId: providerTaskIds[providerTaskIds.length - 1],
      finalVideoUrl: segmentVideoUrls[segmentVideoUrls.length - 1],
      finalCoverUrl: segmentCoverUrls[segmentCoverUrls.length - 1],
      segmentVideoUrls,
      segmentCoverUrls,
      isFinalVideoLikelyComplete: false,
      durationSeconds: params.targetDurationSeconds,
      successfulUnits,
      failedUnits: Math.max(1, params.prompts.length - successfulUnits),
      error: message,
    };
  }
}
