import path from "node:path";
import { stat } from "node:fs/promises";

export const LOCAL_UPLOADS_DIR = "/www/wwwroot/quark-video-git/public/uploads";
const UPLOADS_API_PREFIX = "/api/uploads/";

export type LocalUploadsSource = {
  resolvedPath: string;
  exists: boolean;
  size: number;
};

export type LocalUploadsResolveOptions = {
  currentHost?: string;
  currentOrigin?: string;
  allowedHosts?: string[];
};

const DEFAULT_LOCAL_HOSTS = ["kuake888.com", "www.kuake888.com", "localhost", "127.0.0.1"];

const normalizeHostname = (value?: string) => {
  if (!value) return "";
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return value.split(":")[0]?.toLowerCase() || "";
  }
};

const allowedLocalHosts = (options?: LocalUploadsResolveOptions) => {
  const hosts = new Set(DEFAULT_LOCAL_HOSTS);
  const currentHost = normalizeHostname(options?.currentHost);
  const currentOriginHost = normalizeHostname(options?.currentOrigin);
  if (currentHost) hosts.add(currentHost);
  if (currentOriginHost) hosts.add(currentOriginHost);
  for (const host of options?.allowedHosts || []) {
    const normalized = normalizeHostname(host);
    if (normalized) hosts.add(normalized);
  }
  return hosts;
};

export async function resolveLocalUploadsSource(sourceUrl: string, options?: LocalUploadsResolveOptions): Promise<LocalUploadsSource | null> {
  let pathname = sourceUrl;
  let parsedAsUrl = false;
  let parsedHostname = "";
  try {
    const parsed = new URL(sourceUrl);
    pathname = parsed.pathname;
    parsedHostname = parsed.hostname.toLowerCase();
    parsedAsUrl = true;
  } catch {
    pathname = sourceUrl;
  }

  let resolvedPath = "";
  if (pathname.startsWith(UPLOADS_API_PREFIX)) {
    if (parsedAsUrl && !allowedLocalHosts(options).has(parsedHostname)) {
      return null;
    }
    const relativePath = decodeURIComponent(pathname.slice(UPLOADS_API_PREFIX.length));
    resolvedPath = path.resolve(LOCAL_UPLOADS_DIR, relativePath);
  } else if (!parsedAsUrl && path.isAbsolute(pathname)) {
    resolvedPath = path.resolve(pathname);
  } else {
    return null;
  }

  const uploadsRoot = path.resolve(LOCAL_UPLOADS_DIR);
  if (resolvedPath !== uploadsRoot && !resolvedPath.startsWith(`${uploadsRoot}${path.sep}`)) {
    throw new Error("本地上传路径非法");
  }

  try {
    const fileStat = await stat(resolvedPath);
    return {
      resolvedPath,
      exists: fileStat.isFile(),
      size: fileStat.size,
    };
  } catch {
    return {
      resolvedPath,
      exists: false,
      size: 0,
    };
  }
}
