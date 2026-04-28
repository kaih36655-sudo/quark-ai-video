import { NextRequest, NextResponse } from "next/server";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { requireCurrentUser } from "@/lib/server/auth";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const MODEL = "gemini-3.1-pro-preview";
const ENDPOINT = `https://yunwu.ai/v1beta/models/${MODEL}:generateContent`;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [3000, 8000];
const NORMAL_TIMEOUT_MS = 300_000;
const LARGE_VIDEO_TIMEOUT_MS = 600_000;

const mimeByExt: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
};

const durationRanges: Record<4 | 8 | 12, { min: number; max: number; message: string }> = {
  4: { min: 3, max: 6, message: "请上传 3-6 秒的视频用于复刻 4 秒视频" },
  8: { min: 6, max: 10, message: "请上传 6-10 秒的视频用于复刻 8 秒视频" },
  12: { min: 10, max: 16, message: "请上传 10-16 秒的视频用于复刻 12 秒视频" },
};

const log = (stage: string, payload: Record<string, unknown>) => {
  console.log(`[VIDEO_REMIX][${stage}]`, JSON.stringify(payload));
};

class LoggedAnalyzeError extends Error {
  finalLogged = true;
}

const asObject = (value: unknown): Record<string, unknown> | null => {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
};

const pickText = (value: unknown) => (typeof value === "string" ? value : "");

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const stringifyUnknown = (value: unknown) => {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  if (value === null || typeof value === "undefined") return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const shouldRetryGeminiError = (params: { status?: number | null; reason: string }) => {
  const status = params.status ?? null;
  const lower = params.reason.toLowerCase();
  if (status === 400 || status === 401 || status === 403 || status === 404) return false;
  return (
    status === 429 ||
    (typeof status === "number" && status >= 500) ||
    lower.includes("429") ||
    lower.includes("status=429") ||
    lower.includes("上游已饱和") ||
    lower.includes("too many requests") ||
    lower.includes("rate limit") ||
    lower.includes("status=5") ||
    lower.includes("fetch failed") ||
    lower.includes("network") ||
    lower.includes("timeout") ||
    lower.includes("aborterror") ||
    lower.includes("空内容") ||
    lower.includes("未返回 prompt") ||
    lower.includes("未返回复刻提示词") ||
    lower.includes("json 解析失败")
  );
};

const parseTargetSeconds = (value: FormDataEntryValue | null): 4 | 8 | 12 | null => {
  const num = Number(value);
  return num === 4 || num === 8 || num === 12 ? num : null;
};

const normalizeRatio = (value: FormDataEntryValue | null) => {
  return value === "9:16" ? "9:16" : "16:9";
};

const resolveMimeType = (file: File) => {
  const ext = path.extname(file.name).toLowerCase();
  const mimeFromExt = mimeByExt[ext];
  if (!mimeFromExt) return null;
  if (file.type && !["video/mp4", "video/quicktime", "video/webm", "video/x-m4v"].includes(file.type)) {
    return null;
  }
  return mimeFromExt;
};

async function probeDuration(filePath: string) {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    const duration = Number(stdout.trim());
    return {
      duration: Number.isFinite(duration) ? duration : null,
      ffprobeAvailable: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`[VIDEO_REMIX][FFPROBE_SKIPPED]`, JSON.stringify({ reason: message }));
    return {
      duration: null,
      ffprobeAvailable: false,
    };
  }
}

const buildInstruction = (params: { targetSeconds: 4 | 8 | 12; ratio: string; userHint: string }) => {
  const ratioLabel = params.ratio === "9:16" ? "9:16竖屏" : "16:9横屏";
  const userHint = params.userHint ? `\n用户主动填写的复刻补充要求：${params.userHint}` : "\n用户没有填写复刻补充要求。";
  return `你是短视频提示词复刻专家。请先忠实识别用户上传视频本身的内容，再生成适配 Sora2 的最终视频生成提示词。目标生成时长为 ${params.targetSeconds} 秒，比例为 ${ratioLabel}。

核心规则：
1. 默认不要改变原视频主题、商品类别、场景类别或叙事主体。
2. 必须保留原视频的核心主体、商品类型、场景类型、商业目的、带货逻辑和卖点表达方式。
3. 如果原视频是厨房工具带货视频，输出也必须是厨房工具带货视频的复刻提示词；如果是其他商品/场景，也应保持原商品类别和场景类别。
4. 只复刻镜头结构、节奏、画面风格、运动方式、卖点呈现、情绪氛围和叙事结构。
5. 不复制品牌、Logo、水印、原字幕、人脸身份、明确版权元素。
6. 不要把主题改成外部旧文案或用户输入框里的其他内容。
7. 只有当“复刻补充要求”明确要求改成某个主题/品类时，才允许主题迁移；否则必须忠实保持原视频核心主体和业务类型。
8. 最终提示词必须完整适配目标秒数，避免叙事未完就结束，也避免叙事过早结束后画面无持续价值。

最终 prompt 必须包含：目标秒数、比例、0-1s/1-3s 等分段镜头节奏、画面主体、商品/人物/场景、动作、风格、构图、光线、情绪、卖点结构，以及禁止字幕/水印/Logo/品牌/原人物身份的约束。
4秒要快速闭环；8秒要有清晰起承转合；12秒可以有更完整的递进。${userHint}

请只输出 JSON：{"analysis":"string","prompt":"string"}`;
};

const extractTextFromGemini = (payload: Record<string, unknown> | null) => {
  const candidates = payload?.candidates;
  if (!Array.isArray(candidates)) return "";
  for (const candidate of candidates) {
    const parts = asObject(asObject(candidate)?.content)?.parts;
    if (!Array.isArray(parts)) continue;
    const text = parts.map((part) => pickText(asObject(part)?.text)).filter(Boolean).join("\n");
    if (text) return text;
  }
  return "";
};

const parseAnalysisJson = (text: string) => {
  const trimmed = text.trim();
  const withoutFence = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const match = withoutFence.match(/\{[\s\S]*\}/);
  const jsonText = match ? match[0] : withoutFence;
  let parsed: { analysis?: unknown; prompt?: unknown };
  try {
    parsed = JSON.parse(jsonText) as { analysis?: unknown; prompt?: unknown };
  } catch {
    const promptMatch =
      withoutFence.match(/"prompt"\s*:\s*"([\s\S]*?)"\s*(?:[,}])/i) ||
      withoutFence.match(/prompt\s*[:：]\s*([\s\S]+)$/i);
    const analysisMatch =
      withoutFence.match(/"analysis"\s*:\s*"([\s\S]*?)"\s*,\s*"prompt"/i) ||
      withoutFence.match(/analysis\s*[:：]\s*([\s\S]*?)(?:prompt\s*[:：]|$)/i);
    const fallbackPrompt = promptMatch?.[1]?.replace(/\\"/g, "\"").trim() || "";
    if (!fallbackPrompt) {
      throw new Error("Gemini 输出 JSON 解析失败且未提取到 prompt");
    }
    parsed = {
      analysis: analysisMatch?.[1]?.replace(/\\"/g, "\"").trim() || "",
      prompt: fallbackPrompt,
    };
  }
  return {
    analysis: pickText(parsed.analysis).trim(),
    prompt: pickText(parsed.prompt).trim(),
  };
};

async function requestGeminiWithRetry(params: {
  apiKey: string;
  body: Record<string, unknown>;
  videoBase64Length: number;
  fileName: string;
  fileSize: number;
  targetSeconds: 4 | 8 | 12;
  ratio: string;
  duration: number | null;
}) {
  const timeoutMs = params.fileSize > 20 * 1024 * 1024 ? LARGE_VIDEO_TIMEOUT_MS : NORMAL_TIMEOUT_MS;
  let lastReason = "Gemini 分析失败";
  let lastStatus: number | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      log("GEMINI_REQUEST", {
        attempt,
        maxAttempts: MAX_ATTEMPTS,
        endpoint: ENDPOINT,
        model: MODEL,
        fileSize: params.fileSize,
        targetSeconds: params.targetSeconds,
        ratio: params.ratio,
        timeoutMs,
        hasVideoBase64: true,
        base64PreviewLength: Math.min(params.videoBase64Length, 80),
      });

      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${params.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(params.body),
        signal: controller.signal,
      });
      const rawText = await response.text();
      const contentType = response.headers.get("content-type") || "";
      lastStatus = response.status;
      log("GEMINI_RESPONSE", {
        attempt,
        maxAttempts: MAX_ATTEMPTS,
        ok: response.ok,
        status: response.status,
        contentType,
        rawPreview: rawText.slice(0, 1200),
      });

      if (!response.ok) {
        let parsedError = "";
        try {
          const errorJson = JSON.parse(rawText) as Record<string, unknown>;
          parsedError = stringifyUnknown(asObject(errorJson.error)?.message || errorJson.message || errorJson.error);
        } catch {
          parsedError = rawText.slice(0, 300);
        }
        lastReason = parsedError ? `Gemini 分析失败 status=${response.status}: ${parsedError}` : `Gemini 分析失败 status=${response.status}`;
        throw new Error(lastReason);
      }

      let json: Record<string, unknown> | null = null;
      try {
        json = JSON.parse(rawText) as Record<string, unknown>;
      } catch {
        lastReason = rawText ? "Gemini 响应 JSON 解析失败，raw 内容存在" : "Gemini 响应 JSON 解析失败";
        throw new Error(lastReason);
      }

      const text = extractTextFromGemini(json);
      if (!text) {
        lastReason = "模型返回空内容";
        throw new Error(lastReason);
      }

      try {
        const parsed = parseAnalysisJson(text);
        if (!parsed.prompt) {
          lastReason = "Gemini 未返回 prompt";
          throw new Error(lastReason);
        }
        return { parsed, attempt };
      } catch (error) {
        lastReason = stringifyUnknown(error) || "Gemini 输出 JSON 解析失败";
        if (!lastReason.includes("未返回 prompt")) {
          lastReason = `Gemini 输出 JSON 解析失败: ${lastReason}`;
        }
        throw new Error(lastReason);
      }
    } catch (error) {
      const errorName = error instanceof Error ? error.name : "Error";
      const errorMessage = error instanceof Error ? error.message : stringifyUnknown(error);
      const errorCauseMessage = error instanceof Error ? stringifyUnknown(error.cause) : "";
      const isTimeout = errorName === "AbortError" || controller.signal.aborted;
      lastReason = isTimeout ? `timeout after ${timeoutMs}ms` : errorMessage || lastReason;
      if (isTimeout) {
        log("ANALYZE_TIMEOUT", {
          attempt,
          maxAttempts: MAX_ATTEMPTS,
          timeoutMs,
          fileName: params.fileName,
          fileSize: params.fileSize,
          duration: params.duration,
          targetSeconds: params.targetSeconds,
          ratio: params.ratio,
        });
      }
      if (!lastReason.startsWith("Gemini 分析失败 status=") && !lastReason.includes("JSON 解析失败") && lastReason !== "模型返回空内容" && lastReason !== "Gemini 未返回 prompt") {
        log("FETCH_ERROR", {
          attempt,
          maxAttempts: MAX_ATTEMPTS,
          endpoint: ENDPOINT,
          model: MODEL,
          errorName,
          errorMessage,
          errorCauseMessage,
          timeoutMs,
        });
      }

      const retryable = shouldRetryGeminiError({ status: lastStatus, reason: lastReason || errorMessage });
      if (retryable && attempt < MAX_ATTEMPTS) {
        const delayMs = RETRY_DELAYS_MS[attempt - 1] ?? 0;
        log("RETRY", {
          attempt,
          maxAttempts: MAX_ATTEMPTS,
          delayMs,
          reason: lastReason,
          status: lastStatus,
          retryable: true,
        });
        if (delayMs > 0) {
          await delay(delayMs);
        }
        continue;
      }

      log("ANALYZE_FAILED", {
        maxAttempts: MAX_ATTEMPTS,
        finalReason: lastReason,
        lastStatus,
      });
      throw new LoggedAnalyzeError(lastReason);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  log("ANALYZE_FAILED", {
    maxAttempts: MAX_ATTEMPTS,
    finalReason: lastReason,
    lastStatus,
  });
  throw new LoggedAnalyzeError(lastReason);
}

export async function POST(req: NextRequest) {
  let tempPath: string | null = null;
  try {
    req.signal.addEventListener("abort", () => {
      log("CLIENT_ABORTED", { endpoint: "/api/video-remix/analyze" });
    }, { once: true });
    const user = await requireCurrentUser();
    const formData = await req.formData();
    const file = formData.get("video");
    const targetSeconds = parseTargetSeconds(formData.get("targetSeconds"));
    const ratio = normalizeRatio(formData.get("ratio"));
    const userHint = pickText(formData.get("userHint")).trim();

    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, message: "请上传参考视频" }, { status: 400 });
    }
    if (!targetSeconds) {
      return NextResponse.json({ ok: false, message: "targetSeconds 必须为 4、8 或 12" }, { status: 400 });
    }
    const mimeType = resolveMimeType(file);
    if (!mimeType) {
      return NextResponse.json({ ok: false, message: "仅支持 mp4 / mov / webm 视频" }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ ok: false, message: "参考视频最大 50MB" }, { status: 400 });
    }

    log("ANALYZE_REQUEST", {
      userId: user.id,
      fileName: file.name,
      mimeType,
      fileSize: file.size,
      targetSeconds,
      ratio,
      hasUserHint: Boolean(userHint),
    });

    const bytes = Buffer.from(await file.arrayBuffer());
    tempPath = path.join(tmpdir(), `quark-remix-${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.name).toLowerCase()}`);
    await writeFile(tempPath, bytes);

    const range = durationRanges[targetSeconds];
    const probe = await probeDuration(tempPath);
    const passed = probe.duration === null || (probe.duration >= range.min && probe.duration <= range.max);
    log("DURATION_CHECK", {
      duration: probe.duration,
      min: range.min,
      max: range.max,
      passed,
      ffprobeAvailable: probe.ffprobeAvailable,
    });
    if (probe.duration !== null && !passed) {
      return NextResponse.json({ ok: false, message: range.message, duration: probe.duration }, { status: 400 });
    }

    const apiKey = process.env.YUNWU_API_KEY || "";
    if (!apiKey) {
      throw new Error("缺少 YUNWU_API_KEY，请在服务端环境变量配置");
    }

    const videoBase64 = bytes.toString("base64");
    const body = {
      contents: [
        {
          role: "user",
          parts: [
            { text: buildInstruction({ targetSeconds, ratio, userHint }) },
            {
              inline_data: {
                mime_type: mimeType,
                data: videoBase64,
              },
            },
          ],
        },
      ],
    };

    const { parsed, attempt } = await requestGeminiWithRetry({
      apiKey,
      body,
      videoBase64Length: videoBase64.length,
      fileName: file.name,
      fileSize: file.size,
      targetSeconds,
      ratio,
      duration: probe.duration,
    });

    log("ANALYZE_SUCCESS", {
      attempt,
      duration: probe.duration,
      targetSeconds,
      promptLength: parsed.prompt.length,
      analysisLength: parsed.analysis.length,
      promptPreview: parsed.prompt.slice(0, 160),
      usedUserHint: Boolean(userHint),
    });

    return NextResponse.json({
      ok: true,
      duration: probe.duration,
      targetSeconds,
      analysis: parsed.analysis,
      prompt: parsed.prompt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "分析失败";
    if (!(error instanceof LoggedAnalyzeError)) {
      log("ANALYZE_FAILED", { maxAttempts: MAX_ATTEMPTS, finalReason: message, lastStatus: null });
    }
    const status = message === "请先登录" || message === "账号已被禁用" ? 401 : 500;
    return NextResponse.json({ ok: false, message }, { status });
  } finally {
    if (tempPath) {
      await unlink(tempPath).catch(() => undefined);
    }
  }
}
