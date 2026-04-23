import type { Video } from "./types";

export type PlaybackVariant = "video" | "cover";
export type PlaybackSourceKind = "upscaled" | "original" | "fallback";
export type PlaybackSource = {
  url: string | null;
  kind: PlaybackSourceKind;
};

/**
 * 解析用于代理拉流的远端地址（不返回给浏览器，避免暴露受保护直链）。
 */
export function resolvePlaybackSourceUrl(video: Video, variant: PlaybackVariant): string | null {
  return resolvePlaybackSource(video, variant).url;
}

export function resolvePlaybackSource(video: Video, variant: PlaybackVariant): PlaybackSource {
  if (variant === "cover") {
    if (video.upscaleStatus === "success" && video.upscaledCoverUrl) {
      return { url: video.upscaledCoverUrl, kind: "upscaled" };
    }
    if (video.originalCoverUrl) {
      return { url: video.originalCoverUrl, kind: "original" };
    }
    if (video.coverUrl && !video.coverUrl.startsWith("/api/")) {
      return { url: video.coverUrl, kind: "fallback" };
    }
    return { url: null, kind: "fallback" };
  }
  if (video.upscaleStatus === "success" && video.upscaledVideoUrl) {
    return { url: video.upscaledVideoUrl, kind: "upscaled" };
  }
  if (video.originalVideoUrl) {
    return { url: video.originalVideoUrl, kind: "original" };
  }
  if (video.videoUrl && !video.videoUrl.startsWith("/api/")) {
    return { url: video.videoUrl, kind: "fallback" };
  }
  if (video.previewImageUrl && !video.previewImageUrl.startsWith("/api/")) {
    return { url: video.previewImageUrl, kind: "fallback" };
  }
  return { url: null, kind: "fallback" };
}
