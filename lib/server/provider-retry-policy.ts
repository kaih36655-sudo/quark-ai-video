/** 视频生成 / 超分外层重试：错误分类与退避（不替代 Sora/RH 内部轮询） */

export const PIPELINE_RETRY_MAX_ATTEMPTS = 5;
export const PIPELINE_RETRY_BACKOFF_MS = [30_000, 60_000, 120_000, 180_000] as const;

const norm = (s: string) => s.toLowerCase();

export function extractHttpStatusFromText(message: string): number | undefined {
  const m = message.match(/\b(?:status|http)\s*[=:]?\s*(\d{3})\b/i) || message.match(/\b(429|50[234]|504)\b/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return n >= 100 && n <= 599 ? n : undefined;
}

export function isSora2GenerationNonRetryable(message: string): boolean {
  const m = norm(message);
  if (!m) return false;
  if (/缺少\s*sora2_api_key|sora2_api_key|api[_\s]?key.*缺失|api key.*missing/i.test(message)) return true;
  if (/鉴权|authentication|unauthorized|\b401\b|invalid.*key|apikey|密钥无效|invalid_api_key/i.test(m)) return true;
  if (/余额|balance|insufficient|额度|欠费|credits?\s*exhausted|quota/i.test(m)) return true;
  if (/参数错误|invalid.*param|bad\s*request|\b400\b|parameter|参数无效/i.test(m)) return true;
  if (/模型不存在|model.*not\s*found|model_not_found|unknown model/i.test(m)) return true;
  if (/图片格式|unsupported.*image|format.*not.*support|格式不支持|image.*invalid/i.test(m)) return true;
  if (/违规|moderation|content.?policy|policy violation|safety|提示词|blocked|content_filter/i.test(m)) return true;
  const st = extractHttpStatusFromText(message);
  if (st === 400 || st === 401 || st === 403 || st === 404) return true;
  return false;
}

export function isSora2GenerationRetryable(message: string, error?: unknown): boolean {
  if (isSora2GenerationNonRetryable(message)) return false;
  const m = norm(message);
  if (/负载已饱和|上游负载|饱和|saturation|rate.?limit|\b429\b|\b50[234]\b|\b504\b/i.test(m)) return true;
  if (/稍后再试|try\s*again|retry\s*later|do_request_failed|get_channel_failed/i.test(m)) return true;
  if (/timeout|timed\s*out|超时|etimedout|socket|econnreset|connection\s*reset|network|fetch\s*failed|load\s*failed|enotfound/i.test(m))
    return true;
  if (error instanceof TypeError && /fetch|network|load failed/i.test(String(error.message))) return true;
  if (/视频生成超时|达到轮询上限/.test(message)) return true;
  const st = extractHttpStatusFromText(message);
  if (st === 429 || st === 500 || st === 502 || st === 503 || st === 504) return true;
  return false;
}

export function isUpscaleNonRetryable(message: string): boolean {
  const m = norm(message);
  if (!m) return false;
  if (/url.*无效|invalid\s*url|视频.*地址|remote.*url|download.*fail|无法下载|404/.test(m)) return true;
  if (/余额|balance|insufficient|额度|欠费/i.test(m)) return true;
  if (/鉴权|authentication|unauthorized|\b401\b|forbidden|\b403\b/i.test(m)) return true;
  if (/参数错误|bad\s*request|\b400\b|invalid.*param/i.test(m)) return true;
  if (/格式不支持|unsupported.*format|文件格式|mime|not\s*mp4/i.test(m)) return true;
  if (/缺少\s*runninghub_api_key|run.?ning.?hub.*key/i.test(message)) return true;
  const st = extractHttpStatusFromText(message);
  if (st === 400 || st === 401 || st === 403 || st === 404) return true;
  return false;
}

export function isUpscaleRetryable(message: string, error?: unknown): boolean {
  if (isUpscaleNonRetryable(message)) return false;
  const m = norm(message);
  if (/繁忙|busy|排队|queue|负载|饱和|稍后再试|\b429\b|\b50[234]\b|\b504\b/i.test(m)) return true;
  if (/timeout|timed\s*out|超时|etimedout|econnreset|connection\s*reset|network|fetch\s*failed|load\s*failed/i.test(m))
    return true;
  if (error instanceof TypeError && /fetch|network|load failed/i.test(String(error.message))) return true;
  if (/超分任务超时|time\s*out/i.test(m)) return true;
  const st = extractHttpStatusFromText(message);
  if (st === 429 || st === 500 || st === 502 || st === 503 || st === 504) return true;
  return false;
}

export function pickLogCode(message: string): string {
  const m = message.match(/\bcode[=:]?\s*([A-Za-z0-9_.-]+)\b/i);
  return m ? m[1] : "";
}
