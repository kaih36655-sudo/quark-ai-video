import { readFile } from "node:fs/promises";
import { resolveLocalUploadsSource } from "../local-uploads";
import { GrokVideoResult, GrokVideoWithExtensionsInput } from "./types";

const CREATE_PATH = "/v1/videos/generations";
const MODEL = "grok-imagine-video";
const ALLOWED_DURATIONS = new Set([5, 10, 15]);

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const getBaseUrl = () => (process.env.OPENLUX_API_BASE || "https://api.openlux.ai").replace(/\/$/, "");
const getApiKey = () => {
  const key = process.env.OPENLUX_API_KEY?.trim();
  if (!key) throw new Error("缺少 OPENLUX_API_KEY，请在服务端环境变量配置 OpenLux API Key。");
  return key;
};
const headers = () => ({ Authorization: `Bearer ${getApiKey()}`, "Content-Type": "application/json", Accept: "application/json" });
const log = (stage: string, payload: Record<string, unknown>) => console.log(`[OPENLUX_GROK][${stage}]`, JSON.stringify(payload));

const parseResponse = async (response: Response) => {
  const text = await response.text();
  let json: Record<string, unknown> | null = null;
  try { json = text ? JSON.parse(text) as Record<string, unknown> : null; } catch { json = null; }
  return { response, text, json };
};
const nestedRecords = (json: Record<string, unknown> | null) => {
  const records = [json];
  for (const key of ["data", "result", "task", "response", "video"]) {
    const value = json?.[key];
    if (value && typeof value === "object" && !Array.isArray(value)) records.push(value as Record<string, unknown>);
  }
  return records.filter((item): item is Record<string, unknown> => Boolean(item));
};
const firstString = (json: Record<string, unknown> | null, keys: string[]) => {
  for (const record of nestedRecords(json)) for (const key of keys) if (typeof record[key] === "string" && record[key]) return record[key] as string;
  return "";
};
const extractId = (json: Record<string, unknown> | null) => firstString(json, ["id", "request_id", "task_id"]);
const extractVideoUrl = (json: Record<string, unknown> | null) => firstString(json, ["video_url", "url", "output_url"]);
const extractCoverUrl = (json: Record<string, unknown> | null) => firstString(json, ["thumbnail_url", "cover_url", "preview_image_url"]);
const extractError = (json: Record<string, unknown> | null, fallback = "") => firstString(json, ["error_message", "message", "detail", "error"]) || fallback;

const prepareReferenceImage = async (source?: string) => {
  const value = source?.trim();
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value) || value.startsWith("data:")) return value;
  const local = await resolveLocalUploadsSource(value);
  if (!local) return value;
  const bytes = await readFile(local.resolvedPath);
  const extension = local.resolvedPath.toLowerCase().split(".").pop();
  const mime = extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg";
  return `data:${mime};base64,${bytes.toString("base64")}`;
};

export async function runOpenLuxGrokVideo(params: GrokVideoWithExtensionsInput): Promise<GrokVideoResult> {
  const duration = Math.floor(Number(params.targetDurationSeconds));
  if (!ALLOWED_DURATIONS.has(duration)) throw new Error("OpenLux Grok 仅支持 5秒、10秒、15秒单次生成。");
  const referenceImage = await prepareReferenceImage(params.referenceImages?.[0]);
  const payload: Record<string, unknown> = {
    model: MODEL,
    prompt: params.basePrompt,
    duration,
    aspect_ratio: params.ratio === "9:16" ? "9:16" : "16:9",
    resolution: "720p",
  };
  if (referenceImage) payload.image = { url: referenceImage };
  log("CREATE_REQUEST", { taskId: params.taskId, endpoint: CREATE_PATH, duration, aspectRatio: payload.aspect_ratio, hasReferenceImage: Boolean(referenceImage) });
  const created = await parseResponse(await fetch(`${getBaseUrl()}${CREATE_PATH}`, { method: "POST", headers: headers(), body: JSON.stringify(payload) }));
  const providerTaskId = extractId(created.json);
  log("CREATE_RESPONSE", { taskId: params.taskId, httpStatus: created.response.status, providerTaskId });
  if (!created.response.ok) throw new Error(`OpenLux Grok 创建视频失败 status=${created.response.status} ${extractError(created.json, created.text.slice(0, 200))}`);
  if (!providerTaskId) throw new Error("OpenLux Grok 创建视频失败：未返回任务 ID");

  const pollIntervalMs = Math.max(1000, Number(process.env.OPENLUX_VIDEO_POLL_INTERVAL_MS || 5000));
  const maxAttempts = Math.max(1, Number(process.env.OPENLUX_VIDEO_POLL_MAX_ATTEMPTS || 120));
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const queried = await parseResponse(await fetch(`${getBaseUrl()}/v1/videos/${encodeURIComponent(providerTaskId)}`, { method: "GET", headers: headers() }));
    if (!queried.response.ok) throw new Error(`OpenLux Grok 查询任务失败 status=${queried.response.status} ${extractError(queried.json, queried.text.slice(0, 200))}`);
    const rawStatus = firstString(queried.json, ["status", "state"]).toLowerCase();
    const videoUrl = extractVideoUrl(queried.json);
    log("QUERY_RESPONSE", { taskId: params.taskId, providerTaskId, attempt, rawStatus, hasVideoUrl: Boolean(videoUrl) });
    if (videoUrl || ["succeeded", "success", "completed", "done"].includes(rawStatus)) {
      if (!videoUrl) throw new Error("OpenLux Grok 任务完成但未返回视频 URL");
      return { ok: true, providerSource: "yunwu", providerTaskIds: [providerTaskId], finalTaskId: providerTaskId, finalVideoUrl: videoUrl, finalCoverUrl: extractCoverUrl(queried.json), segmentVideoUrls: [videoUrl], durationSeconds: duration, successfulUnits: 1, failedUnits: 0, isFinalVideoLikelyComplete: true, apiModel: MODEL, actualModel: MODEL };
    }
    if (["failed", "error", "cancelled", "canceled", "timeout"].includes(rawStatus)) throw new Error(extractError(queried.json, `OpenLux Grok 任务失败，status=${rawStatus}`));
    await delay(pollIntervalMs);
  }
  throw new Error(`OpenLux Grok 任务查询超时，taskId=${providerTaskId}`);
}
