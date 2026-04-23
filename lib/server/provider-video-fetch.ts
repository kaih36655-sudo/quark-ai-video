/**
 * 从云雾等受保护地址拉取视频/封面时，在服务端携带 SORA2 鉴权。
 */
export function shouldUseSora2AuthForUrl(url: string): boolean {
  const key = process.env.SORA2_API_KEY;
  if (!key) return false;
  try {
    const u = new URL(url);
    const base = (process.env.SORA2_BASE_URL || "https://yunwu.ai").replace(/\/$/, "");
    const host = u.hostname.toLowerCase();
    if (host.includes("yunwu.ai")) return true;
    const baseHost = new URL(base.startsWith("http") ? base : `https://${base}`).hostname.toLowerCase();
    return host === baseHost || host.endsWith(`.${baseHost}`);
  } catch {
    return url.includes("yunwu.ai");
  }
}

export function providerVideoHeaders(url: string): Record<string, string> {
  if (!shouldUseSora2AuthForUrl(url)) return {};
  const key = process.env.SORA2_API_KEY;
  if (!key) return {};
  return { Authorization: `Bearer ${key}` };
}

export async function fetchProviderVideo(url: string): Promise<Response> {
  return fetch(url, {
    method: "GET",
    headers: providerVideoHeaders(url),
    redirect: "follow",
  });
}
