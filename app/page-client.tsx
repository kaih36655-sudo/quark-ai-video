"use client";

import { type ChangeEvent, type MouseEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const isClient = typeof window !== "undefined";

type TaskStatus = "waiting" | "queued" | "running" | "success" | "failed" | "cancelled";

type Task = {
  id: number;
  prompt: string;
  mode?: "agent" | "normal" | "image" | "medium_video";
  status: TaskStatus;
  createdAt: number;
  kind: "manual" | "schedule";
  hasReferenceImage: boolean;
  referenceImageName?: string;
  referenceImageThumbData?: string;
  scheduledAt?: number;
  promptSnapshot?: string;
  countSnapshot?: number;
  mediumVideoSegments?: number;
  duration?: string;
  ratio?: "1:1" | "9:16" | "16:9";
  agentId?: string;
  agentName?: string;
  agentAccess?: "public" | "restricted";
  agentAuthorized?: boolean;
  imageSize?: "1K" | "2K" | "4K";
  imageModel?: "image2" | "banana2";
};

type Video = {
  id: number;
  taskId: number;
  mediaType: "video" | "image";
  title?: string;
  content: string;
  script?: string[];
  promptText?: string;
  status: "success" | "failed";
  createdAt: number;
  cost: number;
  seconds?: number;
  duration?: string;
  ratio: "1:1" | "9:16" | "16:9";
  size?: string;
  imageSize?: "1K" | "2K" | "4K";
  imageModel?: "image2" | "banana2";
  displayModel?: string;
  imageModelLabel?: string;
  apiModel?: string;
  originalVideoUrl?: string;
  originalCoverUrl?: string;
  upscaledVideoUrl?: string;
  upscaledCoverUrl?: string;
  upscaleStatus?: "idle" | "queued" | "pending" | "processing" | "success" | "failed";
  upscaleTaskId?: string;
  upscaleErrorMessage?: string;
  upscaleConsumeMoney?: number;
  upscaleTaskCostTime?: number;
  coverData?: string;
  videoUrl?: string;
  hasReferenceImage: boolean;
  referenceImageName?: string;
  mediumVideo?: boolean;
  providerTaskIds?: string[];
  segmentVideoUrls?: string[];
  isFinalVideoLikelyComplete?: boolean;
  segmentIndex?: number;
  totalSegments?: number;
  segmentTitle?: string;
};

type AgentProfile = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  type: "video" | "image" | "both";
  access: "public" | "restricted";
  isAuthorized?: boolean;
};

type PricingConfig = {
  video_enabled: boolean;
  image_enabled: boolean;
  video_4s: number;
  video_8s: number;
  video_12s: number;
  image_1K: number;
  image_2K: number;
  image_4K: number;
  image2_1K: number;
  image2_2K: number;
  image2_4K: number;
};

const DEFAULT_PRICING: PricingConfig = {
  video_enabled: true,
  image_enabled: true,
  video_4s: 0.8,
  video_8s: 1.6,
  video_12s: 2.4,
  image_1K: 0.5,
  image_2K: 0.8,
  image_4K: 1.5,
  image2_1K: 0.5,
  image2_2K: 0.8,
  image2_4K: 1.5,
};

const RESULT_PAGE_SIZE = 30;
const PAGE_SIZE = 50;
const formatMoney = (value: unknown) => Number(value || 0).toFixed(2);
const formatImageModelLabel = (video?: { mediaType?: "video" | "image"; imageModelLabel?: string; imageModel?: "image2" | "banana2"; displayModel?: string; apiModel?: string }) => {
  if (video?.mediaType !== "image") return "";
  if (video.imageModelLabel) return video.imageModelLabel;
  if (video.displayModel === "banana2") return "Nano Banana2";
  if (video.displayModel === "image2") return "image2";
  if (video.imageModel === "banana2" || video.apiModel === "gemini-3.1-flash-image-preview") return "Nano Banana2";
  if (video.imageModel === "image2" || video.apiModel === "gpt-image-2") return "image2";
  return "未记录";
};
const AGENT_PROFILES: AgentProfile[] = [
  {
    id: "mercari-jp",
    name: "日本煤炉智能体",
    description: "适合 Mercari / 日本跨境电商内容，强调日系平台场景与选品表达。",
    tags: ["煤炉", "Mercari", "跨境电商"],
    type: "video",
    access: "restricted",
    isAuthorized: true,
  },
  {
    id: "xiaohongshu-food",
    name: "小红书餐饮智能体",
    description: "适合探店、种草、门店亮点介绍，偏生活方式和消费体验。",
    tags: ["餐饮", "探店", "种草"],
    type: "video",
    access: "restricted",
    isAuthorized: false,
  },
  {
    id: "video-sales",
    name: "视频带货智能体",
    description: "适合商品卖点拆解、转化型短视频脚本和下单引导场景。",
    tags: ["带货", "转化", "卖点"],
    type: "video",
    access: "public",
  },
  {
    id: "douyin-script",
    name: "抖音口播脚本智能体",
    description: "适合口播节奏、话术结构和短时高信息密度表达。",
    tags: ["抖音", "口播", "脚本"],
    type: "video",
    access: "restricted",
    isAuthorized: false,
  },
  {
    id: "ecom-funny",
    name: "电商搞笑短视频智能体",
    description: "适合办公室、电商团队、轻剧情反转的幽默内容。",
    tags: ["搞笑", "电商团队", "剧情反转"],
    type: "video",
    access: "public",
  },
];

export default function Home() {
  const router = useRouter();

  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userId, setUserId] = useState("10293");
  const [balance, setBalance] = useState("0.00");
  const [currentUserRole, setCurrentUserRole] = useState<"user" | "admin">("user");
  const [mounted, setMounted] = useState(false);
  const [isDark, setIsDark] = useState(false);

  const [mode, setMode] = useState("agent");
  const [showPreferences, setShowPreferences] = useState(false);
  const [agentSearch, setAgentSearch] = useState("");
  const [agentProfiles, setAgentProfiles] = useState<AgentProfile[]>(AGENT_PROFILES);
  const [pricing, setPricing] = useState<PricingConfig>(DEFAULT_PRICING);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [duration, setDuration] = useState("12s");
  const [ratio, setRatio] = useState("16:9");
  const [imageSize, setImageSize] = useState<"1K" | "2K" | "4K">("2K");
  const [imageModel, setImageModel] = useState<"image2" | "banana2">("image2");
  const [mediumVideoSegments, setMediumVideoSegments] = useState(3);
  const [timingEnabled, setTimingEnabled] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateProgress, setGenerateProgress] = useState(0);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [videos, setVideos] = useState<Video[]>([]);
  const [previewVideo, setPreviewVideo] = useState<any>(null);
  const [imagePreviewScale, setImagePreviewScale] = useState(1);
  const [referencePreviewOpen, setReferencePreviewOpen] = useState(false);
  const [referencePreviewTitle, setReferencePreviewTitle] = useState("");
  const [referencePreviewData, setReferencePreviewData] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [generateCount, setGenerateCount] = useState(3);
  const [prompt, setPrompt] = useState("");
  const [favorites, setFavorites] = useState<number[]>([]);
  const [resultFilter, setResultFilter] = useState<"all" | "favorites">("all");
  const [resultSort, setResultSort] = useState<"latest" | "earliest" | "successOnly" | "failedOnly">("latest");
  const [resultSearch, setResultSearch] = useState("");
  const [isTaskDrawerOpen, setIsTaskDrawerOpen] = useState(false);
  const [taskDrawerFilter, setTaskDrawerFilter] = useState<"all" | "favorites" | "generating" | "success" | "failed" | "waiting">("all");
  const [taskSearch, setTaskSearch] = useState("");
  const [selectedTaskIds, setSelectedTaskIds] = useState<number[]>([]);
  const [taskDetailId, setTaskDetailId] = useState<number | null>(null);
  const [detailVideoId, setDetailVideoId] = useState<number | null>(null);
  const [resultPage, setResultPage] = useState(1);
  const [drawerPage, setDrawerPage] = useState(1);
  const [copiedTaskId, setCopiedTaskId] = useState<number | null>(null);
  const [isPreviewCopied, setIsPreviewCopied] = useState(false);
  const [hasReferenceImage, setHasReferenceImage] = useState(false);
  const [referenceImageData, setReferenceImageData] = useState<string | null>(null);
  const [referenceImageThumbData, setReferenceImageThumbData] = useState<string | null>(null);
  const [referenceImageName, setReferenceImageName] = useState("");
  const [remixVideoFile, setRemixVideoFile] = useState<File | null>(null);
  const [remixVideoDuration, setRemixVideoDuration] = useState<number | null>(null);
  const [remixUserHint, setRemixUserHint] = useState("");
  const [remixOutputLanguage, setRemixOutputLanguage] = useState<"zh" | "en" | "ja">("zh");
  const [remixGenerateReferenceImage, setRemixGenerateReferenceImage] = useState(false);
  const [remixAnalysisLoading, setRemixAnalysisLoading] = useState(false);
  const [remixReferenceImageLoading, setRemixReferenceImageLoading] = useState(false);
  const [remixGeneratedReferenceImageUrl, setRemixGeneratedReferenceImageUrl] = useState<string | null>(null);
  const [remixAnalysisResult, setRemixAnalysisResult] = useState<{ analysis: string; prompt: string; duration: number | null } | null>(null);
  const [timingDate, setTimingDate] = useState("");
  const [timingTime, setTimingTime] = useState("");
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const remixVideoInputRef = useRef<HTMLInputElement | null>(null);
  const timingDateInputRef = useRef<HTMLInputElement | null>(null);
  const timingTimeInputRef = useRef<HTMLInputElement | null>(null);
  const scheduleTimersRef = useRef<Record<number, number>>({});
  const taskPollersRef = useRef<Record<string, number>>({});
  const storageWarningShownRef = useRef(false);

  useEffect(() => {
    const savedTheme = localStorage.getItem("quark_theme");
    const savedFavorites = localStorage.getItem("quark_favorites");
    const savedPrompt = localStorage.getItem("quark_prompt");
    const savedGenerateCount = localStorage.getItem("quark_generate_count");
    const savedMode = localStorage.getItem("quark_mode");
    const savedAgentId = localStorage.getItem("quark_selected_agent_id");
    const savedDuration = localStorage.getItem("quark_duration");
    const savedRatio = localStorage.getItem("quark_ratio");
    const savedImageSize = localStorage.getItem("quark_image_size");
    const savedImageModel = localStorage.getItem("quark_image_model");
    const savedMediumVideoSegments = localStorage.getItem("quark_medium_video_segments");
    const savedHasReferenceImage = localStorage.getItem("quark_has_reference_image");
    const savedReferenceImageData = localStorage.getItem("quark_reference_image_data");
    const savedReferenceImageThumbData = localStorage.getItem("quark_reference_image_thumb_data");
    const savedReferenceImageName = localStorage.getItem("quark_reference_image_name");

    if (savedTheme === "dark") {
      setIsDark(true);
    }

    setTasks([]);
    setVideos([]);

    if (savedFavorites) {
      try {
        const parsedFavorites = JSON.parse(savedFavorites);
        if (Array.isArray(parsedFavorites)) {
          const normalizedFavorites = parsedFavorites
            .filter((item): item is number => typeof item === "number")
            .map((item) => item + (parsedFavorites.includes(0) ? 1 : 0));
          setFavorites(normalizedFavorites);
        }
      } catch { }
    }

    if (savedPrompt) {
      setPrompt(savedPrompt);
    }

    if (savedGenerateCount) {
      setGenerateCount(Number(savedGenerateCount));
    }

    if (savedMode) {
      setMode(savedMode);
    }
    if (savedAgentId) {
      setSelectedAgentId(savedAgentId);
    }

    if (savedDuration) {
      setDuration(savedDuration);
    }

    if (savedRatio) {
      setRatio(savedRatio);
    }
    if (savedImageSize === "1K" || savedImageSize === "2K" || savedImageSize === "4K") {
      setImageSize(savedImageSize);
    }
    if (savedImageModel === "banana2" || savedImageModel === "image2") {
      setImageModel(savedImageModel);
    }
    const parsedMediumVideoSegments = Number(savedMediumVideoSegments);
    if ([1, 2, 3, 4, 5, 6].includes(parsedMediumVideoSegments)) {
      setMediumVideoSegments(parsedMediumVideoSegments);
    }

    if (savedHasReferenceImage === "true") {
      setHasReferenceImage(true);
    }
    if (savedReferenceImageData) {
      const restoredImageData = normalizeReferenceImageSrc(savedReferenceImageData);
      setReferenceImageData(restoredImageData);
    }
    if (savedReferenceImageThumbData) {
      const restoredThumbData = normalizeReferenceImageSrc(savedReferenceImageThumbData);
      setReferenceImageThumbData(restoredThumbData);
    }
    if (savedReferenceImageName) {
      setReferenceImageName(savedReferenceImageName);
    }

    setMounted(true);
    void refreshCurrentUser();
    void refreshAgents();
    void refreshPricing();
  }, []);


  const refreshCurrentUser = async () => {
    const res = await fetch("/api/auth/me", { cache: "no-store" });
    const json = await res.json();
    const user = json?.data?.user;
    if (res.ok && user) {
      setIsLoggedIn(true);
      setUserId(String(user.id));
      setBalance(formatMoney(user.balance));
      setCurrentUserRole(user.role === "admin" ? "admin" : "user");
      return;
    }
    setIsLoggedIn(false);
    setBalance("0.00");
    setCurrentUserRole("user");
  };

  const refreshAgents = async () => {
    const res = await fetch("/api/agents", { cache: "no-store" });
    const json = await res.json();
    if (!res.ok || !json?.success || !Array.isArray(json.data)) return;
    const nextAgents = json.data.map((agent: Record<string, unknown>): AgentProfile => ({
      id: String(agent.id ?? ""),
      name: String(agent.name ?? "未命名智能体"),
      description: String(agent.description ?? ""),
      tags: Array.isArray(agent.tags) ? agent.tags.filter((tag): tag is string => typeof tag === "string") : [],
      type: agent.type === "image" || agent.type === "both" ? agent.type : "video",
      access: agent.accessType === "restricted" ? "restricted" : "public",
      isAuthorized: Boolean(agent.isAuthorized),
    }));
    setAgentProfiles(nextAgents);
  };

  const refreshPricing = async () => {
    try {
      const res = await fetch("/api/pricing", { cache: "no-store" });
      const json = await res.json();
      const next = json?.data?.pricing;
      if (!res.ok || !next) return;
      setPricing({
        video_enabled: typeof next.video_enabled === "boolean" ? next.video_enabled : DEFAULT_PRICING.video_enabled,
        image_enabled: typeof next.image_enabled === "boolean" ? next.image_enabled : DEFAULT_PRICING.image_enabled,
        video_4s: Number(next.video_4s ?? DEFAULT_PRICING.video_4s),
        video_8s: Number(next.video_8s ?? DEFAULT_PRICING.video_8s),
        video_12s: Number(next.video_12s ?? DEFAULT_PRICING.video_12s),
        image_1K: Number(next.image_1K ?? DEFAULT_PRICING.image_1K),
        image_2K: Number(next.image_2K ?? DEFAULT_PRICING.image_2K),
        image_4K: Number(next.image_4K ?? DEFAULT_PRICING.image_4K),
        image2_1K: Number(next.image2_1K ?? next.image_1K ?? DEFAULT_PRICING.image2_1K),
        image2_2K: Number(next.image2_2K ?? next.image_2K ?? DEFAULT_PRICING.image2_2K),
        image2_4K: Number(next.image2_4K ?? next.image_4K ?? DEFAULT_PRICING.image2_4K),
      });
    } catch {
      setPricing(DEFAULT_PRICING);
    }
  };

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setIsLoggedIn(false);
    setUserId("");
    setBalance("0.00");
    router.push("/login");
  };

  const toggleTheme = () => {
    const nextDark = !isDark;
    setIsDark(nextDark);
    localStorage.setItem("quark_theme", nextDark ? "dark" : "light");
  };

  const normalizeDisplayUrl = (raw?: string): string | undefined => {
    if (!raw || typeof raw !== "string") return undefined;
    if (!isClient) return raw;
    const value = raw.trim();
    if (!value) return undefined;
    if (value.startsWith("data:") || value.startsWith("blob:")) return value;

    const toRelativePath = (pathLike: string) => (pathLike.startsWith("/") ? pathLike : `/${pathLike}`);
    const toApiUploadProxy = (pathLike: string) => {
      const clean = pathLike.split("?")[0].split("#")[0];
      return clean.startsWith("/uploads/") ? `/api${clean}` : pathLike;
    };

    if (value.startsWith("/uploads/")) return toApiUploadProxy(value);
    if (value.startsWith("uploads/")) return toApiUploadProxy(`/${value}`);
    if (value.startsWith("/")) return value;
    if (!value.startsWith("http://") && !value.startsWith("https://")) return value;
    try {
      const parsed = new URL(value);
      if (parsed.pathname.startsWith("/uploads/")) {
        return toApiUploadProxy(parsed.pathname);
      }
      const host = parsed.hostname.toLowerCase();
      if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0") {
        return toRelativePath(`${parsed.pathname}${parsed.search}${parsed.hash}`);
      }
      return parsed.toString();
    } catch {
      return value;
    }
  };

  const isLocalUploadsApiPath = (url?: string) => {
    if (!url) return false;
    if (!isClient) return url.toLowerCase().startsWith("/api/uploads/");
    const lower = url.toLowerCase();
    if (lower.startsWith("/api/uploads/")) return true;
    try {
      const parsed = new URL(url);
      return parsed.pathname.toLowerCase().startsWith("/api/uploads/");
    } catch {
      return false;
    }
  };

  const shouldUseProxyForCover = (url?: string) => {
    if (!url) return false;
    if (isLocalUploadsApiPath(url)) return false;
    const lower = url.toLowerCase();
    return lower.includes("yunwu.ai") || lower.startsWith("/api/");
  };

  function normalizeReferenceImageSrc(src?: string | null) {
    if (!src) return null;
    if (!isClient) return src;
    return src;
  }

  const toTaskStatus = (status: string): TaskStatus => {
    if (status === "waiting" || status === "queued" || status === "running" || status === "success" || status === "failed" || status === "cancelled") {
      return status;
    }
    if (status === "processing") return "running";
    if (status === "generating") return "running";
    return "success";
  };

  const mapApiTaskToLocal = (task: Record<string, unknown>): Task => ({
    id: Number(task.id ?? 0),
    prompt: String(task.prompt ?? ""),
    mode: task.mode === "agent" || task.mode === "image" || task.mode === "medium_video" ? task.mode : "normal",
    status: toTaskStatus(String(task.status ?? "success")),
    createdAt: Date.parse(String(task.createdAt ?? new Date().toISOString())),
    kind: task.scheduledAt ? "schedule" : "manual",
    hasReferenceImage: Boolean(task.referenceImageUrl),
    referenceImageName: typeof task.referenceImageName === "string" ? task.referenceImageName : undefined,
    referenceImageThumbData: normalizeDisplayUrl(typeof task.referenceImageUrl === "string" ? task.referenceImageUrl : undefined),
    scheduledAt: typeof task.scheduledAt === "string" ? Date.parse(task.scheduledAt) : undefined,
    promptSnapshot: typeof task.promptSnapshot === "string" ? task.promptSnapshot : typeof task.prompt === "string" ? task.prompt : undefined,
    countSnapshot: typeof task.count === "number" ? task.count : undefined,
    mediumVideoSegments: typeof task.mediumVideoSegments === "number" ? task.mediumVideoSegments : task.mode === "medium_video" && typeof task.count === "number" ? task.count : undefined,
    duration: typeof task.duration === "string" ? task.duration : undefined,
    ratio: task.ratio === "1:1" || task.ratio === "9:16" || task.ratio === "16:9" ? task.ratio : undefined,
    agentId: typeof task.agentId === "string" ? task.agentId : undefined,
    agentName: typeof task.agentName === "string" ? task.agentName : undefined,
    agentAccess: task.agentAccessType === "restricted" ? "restricted" : task.agentAccessType === "public" ? "public" : undefined,
    imageSize: task.imageSize === "1K" || task.imageSize === "4K" ? task.imageSize : task.imageSize === "2K" ? "2K" : undefined,
    imageModel: task.imageModel === "banana2" ? "banana2" : task.imageModel === "image2" ? "image2" : undefined,
  });

  const mapApiVideoToLocal = (video: Record<string, unknown>): Video => {
    const mediaType = video.kind === "image" || video.type === "image" ? "image" : "video";
    const rawSize =
      typeof video.size === "string"
        ? video.size
        : typeof video.video_size === "string"
          ? video.video_size
          : undefined;
    const inferredRatio =
      video.ratio === "1:1"
        ? "1:1"
        : rawSize === "720x1280"
          ? "9:16"
          : rawSize === "1280x720"
            ? "16:9"
            : video.ratio === "9:16"
              ? "9:16"
              : "16:9";
    const resolvedVideoUrl = normalizeDisplayUrl(
      typeof video.videoUrl === "string" && video.videoUrl
        ? video.videoUrl
        : typeof video.previewImageUrl === "string" && video.previewImageUrl
          ? video.previewImageUrl
          : typeof video.video_url === "string" && video.video_url
            ? video.video_url
            : undefined
    );
    const resolvedCoverUrl = normalizeDisplayUrl(
      typeof video.coverUrl === "string" && video.coverUrl
        ? video.coverUrl
        : typeof video.cover_url === "string" && video.cover_url
          ? video.cover_url
          : undefined
    );
    const originalVideoUrl = normalizeDisplayUrl(
      (typeof video.originalVideoUrl === "string" && video.originalVideoUrl) ||
        (typeof video.previewImageUrl === "string" && video.previewImageUrl) ||
        (typeof video.videoUrl === "string" && video.videoUrl) ||
        undefined
    );
    const originalCoverUrl =
      (typeof video.originalCoverUrl === "string" && video.originalCoverUrl) ||
      resolvedCoverUrl ||
      undefined;
    const upscaledVideoUrl = normalizeDisplayUrl(typeof video.upscaledVideoUrl === "string" && video.upscaledVideoUrl ? video.upscaledVideoUrl : undefined);
    const upscaledCoverUrl = normalizeDisplayUrl(typeof video.upscaledCoverUrl === "string" && video.upscaledCoverUrl ? video.upscaledCoverUrl : undefined);
    const effectiveVideoUrl = upscaledVideoUrl || resolvedVideoUrl || originalVideoUrl;
    const preferredCoverUrl = upscaledCoverUrl || resolvedCoverUrl || originalCoverUrl;
    const playbackId = String(video.id ?? "");
    const usePlaybackProxy = mediaType === "video" && String(video.status ?? "") !== "failed" && playbackId.length > 0;
    const needProtectedCoverProxy = Boolean(
      preferredCoverUrl &&
        !isLocalUploadsApiPath(preferredCoverUrl) &&
        shouldUseProxyForCover(preferredCoverUrl) &&
        playbackId.length > 0
    );
    const effectiveCoverUrl = needProtectedCoverProxy ? `/api/videos/${playbackId}/stream?variant=cover` : preferredCoverUrl;
    const upscaleStatus = (() => {
      const raw = String(video.upscaleStatus ?? "").toLowerCase();
      if (
        raw === "idle" ||
        raw === "queued" ||
        raw === "pending" ||
        raw === "processing" ||
        raw === "success" ||
        raw === "failed"
      ) {
        return raw as "idle" | "queued" | "pending" | "processing" | "success" | "failed";
      }
      return "idle";
    })();
    const resolvedDuration =
      typeof video.duration === "string"
        ? video.duration
        : typeof video.seconds === "number"
          ? `${Math.round(video.seconds)}s`
          : typeof video.seconds === "string" && Number(video.seconds) > 0
            ? `${Math.round(Number(video.seconds))}s`
            : undefined;
    const resolvedSeconds =
      typeof video.seconds === "number"
        ? video.seconds
        : typeof video.seconds === "string"
          ? Number(video.seconds)
          : resolvedDuration
            ? Number(String(resolvedDuration).replace(/[^\d]/g, "")) || undefined
            : undefined;
    return {
      id: Number(video.id ?? 0),
      taskId: Number(video.taskId ?? 0),
      mediaType,
      title: typeof video.title === "string" ? video.title : undefined,
      content: String(video.content ?? ""),
      script: Array.isArray(video.script) ? (video.script as unknown[]).filter((v): v is string => typeof v === "string") : undefined,
      promptText: typeof video.prompt === "string" ? video.prompt : undefined,
      status: video.status === "failed" ? "failed" : "success",
      createdAt: Date.parse(String(video.createdAt ?? new Date().toISOString())),
      cost: typeof video.cost === "number" ? video.cost : 0,
      seconds: resolvedSeconds,
      duration: resolvedDuration,
      ratio: inferredRatio,
      size: rawSize,
      imageSize: video.imageSize === "1K" || video.imageSize === "4K" ? video.imageSize : video.imageSize === "2K" ? "2K" : rawSize === "1K" || rawSize === "2K" || rawSize === "4K" ? rawSize : undefined,
      imageModel: video.imageModel === "banana2" ? "banana2" : video.imageModel === "image2" ? "image2" : undefined,
      displayModel: typeof video.displayModel === "string" ? video.displayModel : undefined,
      imageModelLabel: typeof video.imageModelLabel === "string" ? video.imageModelLabel : undefined,
      apiModel: typeof video.apiModel === "string" ? video.apiModel : undefined,
      originalVideoUrl,
      originalCoverUrl,
      upscaledVideoUrl,
      upscaledCoverUrl,
      upscaleStatus,
      upscaleTaskId: typeof video.upscaleTaskId === "string" ? video.upscaleTaskId : undefined,
      upscaleErrorMessage: typeof video.upscaleErrorMessage === "string" ? video.upscaleErrorMessage : undefined,
      upscaleConsumeMoney: typeof video.upscaleConsumeMoney === "number" ? video.upscaleConsumeMoney : undefined,
      upscaleTaskCostTime: typeof video.upscaleTaskCostTime === "number" ? video.upscaleTaskCostTime : undefined,
      coverData: effectiveCoverUrl,
      videoUrl: mediaType === "image" ? effectiveVideoUrl : usePlaybackProxy ? `/api/videos/${playbackId}/stream` : effectiveVideoUrl,
      hasReferenceImage: Boolean(video.referenceImageUrl),
      referenceImageName: typeof video.referenceImageName === "string" ? video.referenceImageName : undefined,
      mediumVideo: Boolean(video.mediumVideo),
      providerTaskIds: Array.isArray(video.providerTaskIds) ? video.providerTaskIds.filter((item): item is string => typeof item === "string") : undefined,
      segmentVideoUrls: Array.isArray(video.segmentVideoUrls) ? video.segmentVideoUrls.filter((item): item is string => typeof item === "string") : undefined,
      isFinalVideoLikelyComplete: typeof video.isFinalVideoLikelyComplete === "boolean" ? video.isFinalVideoLikelyComplete : undefined,
      segmentIndex: typeof video.segmentIndex === "number" ? video.segmentIndex : undefined,
      totalSegments: typeof video.totalSegments === "number" ? video.totalSegments : undefined,
      segmentTitle: typeof video.segmentTitle === "string" ? video.segmentTitle : undefined,
    };
  };

  const syncFromServer = async () => {
    const listRes = await fetch("/api/tasks", { cache: "no-store" });
    const listJson = await listRes.json();
    if (!listRes.ok || !listJson?.success || !listJson?.data) {
      throw new Error(listJson?.message || "获取任务列表失败");
    }
    const taskPayload = Array.isArray(listJson.data.tasks) ? (listJson.data.tasks as Record<string, unknown>[]) : [];
    const videoPayload = Array.isArray(listJson.data.videos) ? (listJson.data.videos as Record<string, unknown>[]) : [];
    const nextTasks = taskPayload.map(mapApiTaskToLocal);
    const nextVideos = videoPayload.map(mapApiVideoToLocal);
    setTasks(nextTasks);
    setVideos(nextVideos);
    return { tasks: nextTasks, videos: nextVideos };
  };

  const runGenerateFlow = async (
    seedPrompt: string,
    source: "manual" | "schedule",
    scheduleId?: number,
    countValue?: number,
    refEnabled?: boolean,
    refName?: string,
    refThumbData?: string,
    taskAgentId?: string,
    taskAgentName?: string,
    taskAgentAccess?: "public" | "restricted",
    taskAgentAuthorized?: boolean
  ) => {
    if (!seedPrompt.trim()) {
      showToast("请先输入提示词");
      return false;
    }

    const isCurrentMediumVideoMode = mode === "medium_video";
    const effectiveCount = isCurrentMediumVideoMode ? mediumVideoSegments : countValue ?? generateCount;
    const useReference = isCurrentMediumVideoMode ? false : typeof refEnabled === "boolean" ? refEnabled : hasReferenceImage;
    const useReferenceName = refName ?? referenceImageName;
    const useReferenceThumbData = refThumbData ?? referenceImageThumbData;
    const isCurrentRemixMode = mode === "remix";
    const isCurrentAgentMode = mode === "agent" || mode === "agent_image" || isCurrentMediumVideoMode;
    const isCurrentImageMode = mode === "image" || mode === "agent_image";
    const submitMode = mode === "agent_image" ? "image" : isCurrentRemixMode ? "normal" : mode;
    const shouldSubmitReference = useReference;
    const activeAgentId = taskAgentId ?? (isCurrentAgentMode ? selectedAgent?.id : undefined);
    const activeAgentName = taskAgentName ?? (isCurrentAgentMode ? selectedAgent?.name : undefined);
    const activeAgentAccess = taskAgentAccess ?? (isCurrentAgentMode ? selectedAgent?.access : undefined);
    const activeAgentAuthorized = taskAgentAuthorized ?? (isCurrentAgentMode ? selectedAgent?.isAuthorized : undefined);
    if (activeAgentAccess === "restricted" && activeAgentAuthorized === false) {
      showToast("当前智能体尚未获得授权，无法执行任务");
      if (source === "schedule" && scheduleId) {
        setTasks((prev) => prev.map((task) => (task.id === scheduleId ? { ...task, status: "failed" } : task)));
      }
      return false;
    }
    const payload = {
      prompt: seedPrompt.trim(),
      mode: submitMode as "agent" | "normal" | "image" | "medium_video",
      duration: isCurrentMediumVideoMode ? `${mediumVideoSegments * 10}s` : duration,
      ratio: isCurrentImageMode ? ratio : ratio === "9:16" ? "9:16" : "16:9",
      imageSize: isCurrentImageMode ? imageSize : undefined,
      imageModel: isCurrentImageMode ? imageModel : undefined,
      count: effectiveCount,
      mediumVideoSegments: isCurrentMediumVideoMode ? mediumVideoSegments : undefined,
      agentId: activeAgentId,
      referenceImageUrl: shouldSubmitReference ? referenceImageData ?? undefined : undefined,
      referenceImageName: shouldSubmitReference ? useReferenceName || undefined : undefined,
    };
    setIsGenerating(true);
    setGenerateProgress(10);
    const createRes = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const createJson = await createRes.json();
    if (!createRes.ok || !createJson?.success || !createJson?.data?.taskId) {
      setIsGenerating(false);
      setGenerateProgress(0);
      showToast(createJson?.message || "创建任务失败");
      return false;
    }
    const createdTaskId = String(createJson.data.taskId);
    setResultPage(1);
    await syncFromServer();
    if (taskPollersRef.current[createdTaskId]) {
      window.clearInterval(taskPollersRef.current[createdTaskId]);
    }
    taskPollersRef.current[createdTaskId] = window.setInterval(async () => {
      try {
        const snapshot = await syncFromServer();
        const latestTask = snapshot.tasks.find((task) => String(task.id) === createdTaskId);
        const taskStatus = latestTask?.status ?? "success";
        setGenerateProgress((prev) => Math.min(95, prev + 12));
        if (["success", "failed", "cancelled"].includes(taskStatus)) {
          window.clearInterval(taskPollersRef.current[createdTaskId]);
          delete taskPollersRef.current[createdTaskId];
          setGenerateProgress(100);
          setTimeout(() => {
            setIsGenerating(false);
            setGenerateProgress(0);
          }, 200);
          if (taskStatus === "success") {
            const videosCount = snapshot.videos.filter((video) => String(video.taskId) === createdTaskId).length;
            showToast(isCurrentImageMode ? `已生成${videosCount}张图片` : isCurrentMediumVideoMode ? "中视频已生成" : `已生成${videosCount}条视频`);
            void refreshCurrentUser();
          } else if (taskStatus === "failed") {
            showToast("任务执行失败");
          } else {
            showToast("任务已取消");
          }
        }
      } catch {
        // keep polling to tolerate transient errors
      }
    }, 2500);
    return true;
  };

  const handleGenerate = () => {
    if (!isLoggedIn) {
      showToast("请先登录后再创建任务");
      router.push("/login");
      return;
    }
    if (!currentChannelEnabled) {
      showToast("通道维护升级中请稍后再试");
      return;
    }
    if (imageModelRestrictionMessage) {
      showToast(imageModelRestrictionMessage);
      return;
    }
    if (mode === "remix" && !remixAnalysisResult) {
      showToast("请先分析并生成复刻提示词");
      return;
    }
    if ((mode === "agent" || mode === "medium_video") && (!selectedAgent || !selectedAgentApplicable)) {
      showToast("请先选择视频智能体");
      return;
    }
    if (mode === "agent_image" && (!selectedAgent || !selectedAgentApplicable)) {
      showToast("请先选择图片智能体");
      return;
    }
    if ((mode === "agent" || mode === "agent_image" || mode === "medium_video") && selectedAgent?.access === "restricted" && !selectedAgent.isAuthorized) {
      showToast("当前智能体尚未获得授权，无法执行任务");
      return;
    }
    void runGenerateFlow(prompt, "manual");
  };

  const handleCreateScheduledTask = async () => {
    if (!prompt.trim()) {
      showToast("请先输入提示词");
      return;
    }
    if (mode === "remix" && !remixAnalysisResult) {
      showToast("请先分析并生成复刻提示词");
      return;
    }
    if (!timingDate || !timingTime) {
      showToast("请先选择定时日期和时间");
      return;
    }
    const targetTs = new Date(`${timingDate}T${timingTime}`).getTime();
    if (!Number.isFinite(targetTs) || targetTs <= Date.now()) {
      showToast("请选择未来时间");
      return;
    }
    if ((mode === "agent" || mode === "medium_video") && (!selectedAgent || !selectedAgentApplicable)) {
      showToast("请先选择视频智能体");
      return;
    }
    if (mode === "agent_image" && (!selectedAgent || !selectedAgentApplicable)) {
      showToast("请先选择图片智能体");
      return;
    }
    if ((mode === "agent" || mode === "agent_image" || mode === "medium_video") && selectedAgent?.access === "restricted" && !selectedAgent.isAuthorized) {
      showToast("当前智能体尚未获得授权，无法执行任务");
      return;
    }
    const isCurrentRemixMode = mode === "remix";
    const isCurrentMediumVideoMode = mode === "medium_video";
    const isCurrentImageMode = mode === "image" || mode === "agent_image";
    const submitMode = mode === "agent_image" ? "image" : isCurrentRemixMode ? "normal" : mode;
    const shouldSubmitReference = isCurrentMediumVideoMode ? false : hasReferenceImage;
    const createRes = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: prompt.trim(),
        mode: submitMode as "agent" | "normal" | "image" | "medium_video",
        duration: isCurrentMediumVideoMode ? `${mediumVideoSegments * 10}s` : duration,
        ratio,
        imageSize: isCurrentImageMode ? imageSize : undefined,
        imageModel: isCurrentImageMode ? imageModel : undefined,
        count: isCurrentMediumVideoMode ? mediumVideoSegments : generateCount,
        mediumVideoSegments: isCurrentMediumVideoMode ? mediumVideoSegments : undefined,
        agentId: mode === "agent" || mode === "agent_image" || mode === "medium_video" ? selectedAgent?.id : undefined,
        referenceImageUrl: shouldSubmitReference ? referenceImageData ?? undefined : undefined,
        referenceImageName: shouldSubmitReference ? referenceImageName || undefined : undefined,
        scheduledAt: new Date(targetTs).toISOString(),
      }),
    });
    const createJson = await createRes.json();
    if (!createRes.ok || !createJson?.success) {
      showToast(createJson?.message || "创建定时任务失败");
      return;
    }
    await syncFromServer();
    showToast("已创建定时任务");
  };

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => {
      setToast(null);
    }, 1800);
  };

  const getRatioLabel = (ratioValue?: string, sizeValue?: string) => {
    const resolvedRatio = ratioValue === "1:1" ? "1:1" : sizeValue === "720x1280" ? "9:16" : sizeValue === "1280x720" ? "16:9" : ratioValue;
    if (resolvedRatio === "1:1") return "1:1方屏";
    return resolvedRatio === "9:16" ? "9:16竖屏" : "16:9横屏";
  };

  const getImageSizeLabel = (value?: string) => (value === "1K" || value === "4K" ? value : "2K");

  const getDurationLabel = (secondsValue?: number, durationValue?: string) => {
    if (typeof secondsValue === "number" && Number.isFinite(secondsValue) && secondsValue > 0) {
      return `${Math.round(secondsValue)}s`;
    }
    if (durationValue && /^\d+s$/.test(durationValue)) {
      return durationValue;
    }
    return "--";
  };

  const truncateTitleByHanWidth = (text: string, maxHanWidth = 25) => {
    let width = 0;
    let output = "";
    for (const char of text) {
      const code = char.charCodeAt(0);
      const isAscii = code <= 0x7f;
      const next = width + (isAscii ? 0.5 : 1);
      if (next > maxHanWidth) {
        return `${output}...`;
      }
      output += char;
      width = next;
    }
    return output;
  };

  const truncateSourceTaskText = (text: string, maxLength = 20) => {
    const chars = Array.from(text.trim());
    return chars.length > maxLength ? `${chars.slice(0, maxLength).join("")}...` : chars.join("");
  };

  const getUpscaleStatusLabel = (status?: "idle" | "queued" | "pending" | "processing" | "success" | "failed") => {
    if (status === "success") return "超分成功";
    if (status === "failed") return "超分失败";
    if (status === "queued") return "超分排队中";
    if (status === "processing" || status === "pending") return "超分处理中";
    return "待超分";
  };

  const resolveTaskIdForDelete = (videoId: number) => videos.find((video) => video.id === videoId)?.taskId ?? null;

  const removeTaskLocally = (taskId: number) => {
    const relatedVideoIds = videos.filter((video) => video.taskId === taskId).map((video) => video.id);
    setTasks((prev) => prev.filter((task) => task.id !== taskId));
    setVideos((prev) => prev.filter((video) => video.taskId !== taskId));
    setFavorites((prev) => prev.filter((id) => !relatedVideoIds.includes(id)));
    setSelectedTaskIds((prev) => prev.filter((id) => id !== taskId));
    if (taskDetailId === taskId) {
      setTaskDetailId(null);
    }
    if (previewVideo && relatedVideoIds.includes(previewVideo.id)) {
      setPreviewVideo(null);
    }
  };

  const deleteTaskOnServer = async (taskId: number) => {
    const res = await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });
    const json = await res.json();
    if (!res.ok || !json?.success) {
      throw new Error(json?.message || "删除任务失败");
    }
  };

  const handleDownload = async (video: {
    id?: number;
    item: string;
    title?: string;
    taskId: number;
    videoUrl?: string;
    status?: TaskStatus;
    mediaType?: "video" | "image";
  }) => {
    const safeName = (video.title || `task-${video.taskId}`)
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/\s+/g, "-")
      .slice(0, 50);
    if (video.status === "success" && typeof video.id === "number") {
      try {
        const link = document.createElement("a");
        link.href = `/api/videos/${video.id}/download`;
        link.rel = "noopener noreferrer";
        link.download = video.mediaType === "image" ? `${safeName || "image-task"}.jpg` : `${safeName || "video-task"}.mp4`;
        link.click();
        showToast(video.mediaType === "image" ? "已开始下载图片" : "已开始下载视频");
        return;
      } catch {
        showToast("视频下载失败，已回退文本下载");
      }
    }
    const blob = new Blob([video.item], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeName || "video-task"}.txt`;
    link.click();
    URL.revokeObjectURL(url);
    showToast("已开始下载");
  };

  const handleCopy = async (item: string, taskId?: number) => {
    await navigator.clipboard.writeText(item);
    if (typeof taskId === "number") {
      setCopiedTaskId(taskId);
      setTimeout(() => {
        setCopiedTaskId(null);
      }, 1000);
      return;
    }
    setIsPreviewCopied(true);
    setTimeout(() => {
      setIsPreviewCopied(false);
    }, 1000);
  };

  const handleClearResults = () => {
    const confirmed = window.confirm("确认清除将删除所有记录且不可找回，请谨慎操作！");
    if (!confirmed) return;
    setTasks([]);
    setVideos([]);
    setPreviewVideo(null);
    setCopiedTaskId(null);
    setIsPreviewCopied(false);
    setFavorites([]);
    setSelectedTaskIds([]);
    setTaskDetailId(null);
    setResultPage(1);
    setDrawerPage(1);
    showToast("记录已清空");
  };

  const handleRegenerate = (taskId: number) => {
    setPreviewVideo(null);
    showToast(`已重新生成 ${makeTaskId(taskId)}`);
  };

  const handleDeleteResult = (videoId: number) => {
    const target = videos.find((video) => video.id === videoId);
    if (!target) return;
    const taskId = resolveTaskIdForDelete(videoId);
    if (!taskId) return;
    if (!window.confirm(`确认删除 ${makeTaskId(taskId)} 及其所有作品吗？`)) return;
    removeTaskLocally(taskId);
    void (async () => {
      try {
        await deleteTaskOnServer(taskId);
        await syncFromServer();
        showToast("已删除任务");
      } catch {
        await syncFromServer();
        showToast("删除任务失败");
      }
    })();
  };

  const handleOpenPreviewFromDrawer = (taskId: number) => {
    const taskVideos = videos.filter((video) => video.taskId === taskId).sort((a, b) => b.createdAt - a.createdAt);
    if (taskVideos.length === 0) {
      showToast("该任务暂无可预览作品");
      return;
    }
    setIsTaskDrawerOpen(false);
    setPreviewVideo(taskVideos[0]);
  };

  const handleToggleFavorite = (taskId: number) => {
    setFavorites((prev) =>
      prev.includes(taskId)
        ? prev.filter((i) => i !== taskId)
        : [...prev, taskId]
    );
    showToast(favorites.includes(taskId) ? "已取消收藏" : "已加入收藏");
  };

  const handleToggleTaskFavorite = (taskId: number) => {
    const relatedVideoIds = videos.filter((video) => video.taskId === taskId).map((video) => video.id);
    if (relatedVideoIds.length === 0) return;
    const allFavorited = relatedVideoIds.every((id) => favorites.includes(id));
    setFavorites((prev) => {
      if (allFavorited) {
        return prev.filter((id) => !relatedVideoIds.includes(id));
      }
      return Array.from(new Set([...prev, ...relatedVideoIds]));
    });
    showToast(allFavorited ? "已取消收藏" : "已加入收藏");
  };

  const handleDeleteTask = (taskId: number) => {
    if (!window.confirm(`确认删除 ${makeTaskId(taskId)} 及其所有作品吗？`)) return;
    if (scheduleTimersRef.current[taskId]) {
      window.clearTimeout(scheduleTimersRef.current[taskId]);
      delete scheduleTimersRef.current[taskId];
    }
    removeTaskLocally(taskId);
    void (async () => {
      try {
        await deleteTaskOnServer(taskId);
        await syncFromServer();
        showToast("已删除任务");
      } catch {
        await syncFromServer();
        showToast("删除任务失败");
      }
    })();
  };

  const handleToggleSelectedTask = (taskId: number) => {
    setSelectedTaskIds((prev) => (prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId]));
  };

  const handleBatchDelete = () => {
    if (selectedTaskIds.length === 0) return;
    if (!window.confirm(`确认删除已选 ${selectedTaskIds.length} 条任务吗？`)) return;
    const selectedIds = [...selectedTaskIds];
    const selectedSet = new Set(selectedIds);
    selectedTaskIds.forEach((id) => {
      if (scheduleTimersRef.current[id]) {
        window.clearTimeout(scheduleTimersRef.current[id]);
        delete scheduleTimersRef.current[id];
      }
    });
    setTasks((prev) => prev.filter((task) => !selectedSet.has(task.id)));
    setVideos((prev) => prev.filter((video) => !selectedSet.has(video.taskId)));
    setFavorites((prev) => prev.filter((id) => !selectedSet.has(id) && !videos.some((video) => video.id === id && selectedSet.has(video.taskId))));
    setSelectedTaskIds([]);
    void (async () => {
      try {
        await Promise.all(selectedIds.map((id) => deleteTaskOnServer(id)));
        await syncFromServer();
        showToast(`已删除 ${selectedSet.size} 条任务`);
      } catch {
        await syncFromServer();
        showToast("批量删除存在失败，请重试");
      }
    })();
  };

  const handleBatchFavorite = (nextFavorite: boolean) => {
    if (selectedTaskIds.length === 0) return;
    const selectedSet = new Set(selectedTaskIds);
    const selectedVideoIds = videos.filter((video) => selectedSet.has(video.taskId)).map((video) => video.id);
    setFavorites((prev) => {
      if (nextFavorite) {
        const merged = new Set([...prev, ...selectedVideoIds]);
        return Array.from(merged);
      }
      return prev.filter((id) => !selectedVideoIds.includes(id));
    });
    showToast(nextFavorite ? `已加入收藏（${selectedTaskIds.length}条）` : `已取消收藏（${selectedTaskIds.length}条）`);
  };

  const handleRetryUpscale = (videoId: number) => {
    void (async () => {
      try {
        const res = await fetch(`/api/videos/${videoId}/upscale/retry`, { method: "POST" });
        const json = await res.json();
        if (!res.ok || !json?.success) {
          showToast(json?.message || "超分重试失败");
          await syncFromServer();
          return;
        }
        await syncFromServer();
        showToast("超分重试完成");
      } catch {
        showToast("超分重试失败");
      }
    })();
  };

  const handleCancelScheduledTask = (taskId: number) => {
    const task = tasks.find((item) => item.id === taskId);
    if (!task || task.status !== "waiting") return;
    void (async () => {
      try {
        const res = await fetch(`/api/tasks/${taskId}/cancel`, { method: "POST" });
        const json = await res.json();
        if (!res.ok || !json?.success) {
          showToast(json?.message || "取消任务失败");
          return;
        }
        await syncFromServer();
        showToast("已取消定时任务");
      } catch {
        showToast("取消任务失败");
      }
    })();
  };

  const handleReferenceUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showToast("请选择图片文件");
      return;
    }
    const formData = new FormData();
    formData.append("file", file);
    void (async () => {
      try {
        const res = await fetch("/api/upload", { method: "POST", body: formData });
        const json = await res.json();
        if (!res.ok || !json?.success || !json?.data?.url) {
          showToast(json?.message || "上传参考图失败");
          return;
        }
        const rawUrl = String(json.data.url);
        const normalizedUrl = rawUrl;
        setReferenceImageData(normalizedUrl);
        setReferenceImageThumbData(normalizedUrl);
        setReferenceImageName(String(json.data.name || file.name));
        setHasReferenceImage(true);
        setRemixGeneratedReferenceImageUrl(null);
        showToast("参考图已添加");
      } catch {
        showToast("上传参考图失败");
      }
    })();
  };

  const getRemixTargetSeconds = () => {
    if (duration === "4s") return 4;
    if (duration === "8s") return 8;
    return 12;
  };

  const getRemixDurationRange = () => {
    const targetSeconds = getRemixTargetSeconds();
    if (targetSeconds === 4) return { min: 3, max: 6, hint: "建议上传 3-6 秒视频", message: "请上传 3-6 秒的视频用于复刻 4 秒视频" };
    if (targetSeconds === 8) return { min: 6, max: 10, hint: "建议上传 6-10 秒视频", message: "请上传 6-10 秒的视频用于复刻 8 秒视频" };
    return { min: 10, max: 16, hint: "建议上传 10-16 秒视频", message: "请上传 10-16 秒的视频用于复刻 12 秒视频" };
  };

  const isValidRemixVideoFile = (file: File) => {
    const name = file.name.toLowerCase();
    const allowedByName = name.endsWith(".mp4") || name.endsWith(".mov") || name.endsWith(".webm");
    const allowedByType = ["video/mp4", "video/quicktime", "video/webm"].includes(file.type);
    return allowedByName && (!file.type || allowedByType);
  };

  const readVideoDuration = (file: File) => {
    return new Promise<number | null>((resolve) => {
      const url = URL.createObjectURL(file);
      const video = document.createElement("video");
      const cleanup = () => URL.revokeObjectURL(url);
      video.preload = "metadata";
      video.onloadedmetadata = () => {
        const seconds = Number(video.duration);
        cleanup();
        resolve(Number.isFinite(seconds) ? seconds : null);
      };
      video.onerror = () => {
        cleanup();
        resolve(null);
      };
      video.src = url;
    });
  };

  const handleRemixVideoUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setRemixAnalysisResult(null);
    setRemixVideoDuration(null);
    if (!isValidRemixVideoFile(file)) {
      showToast("仅支持 mp4 / mov / webm 视频");
      event.target.value = "";
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      showToast("参考视频最大 50MB");
      event.target.value = "";
      return;
    }
    setRemixVideoFile(file);
    void (async () => {
      const seconds = await readVideoDuration(file);
      setRemixVideoDuration(seconds);
      if (seconds !== null) {
        const range = getRemixDurationRange();
        if (seconds < range.min || seconds > range.max) {
          showToast(range.message);
        } else {
          showToast("参考视频已选择");
        }
      } else {
        showToast("参考视频已选择，时长将在后端校验");
      }
    })();
  };

  const handleRemoveRemixVideo = () => {
    setRemixVideoFile(null);
    setRemixVideoDuration(null);
    setRemixAnalysisResult(null);
    setRemixGeneratedReferenceImageUrl(null);
    if (remixVideoInputRef.current) {
      remixVideoInputRef.current.value = "";
    }
  };

  const getRemixAnalyzeErrorMessage = (message: string) => {
    const lower = message.toLowerCase();
    if (lower.includes("429") || message.includes("上游已饱和") || lower.includes("rate limit")) {
      return "当前视频分析通道繁忙，请稍后重试，或换一个更短的视频。";
    }
    if (lower.includes("timeout")) {
      return "视频分析等待超时，请换一个更短的视频或稍后重试。";
    }
    return message || "分析视频失败";
  };

  const generateRemixReferenceImage = async (sourcePrompt: string) => {
    if (!remixVideoFile) return;
    const formData = new FormData();
    formData.append("video", remixVideoFile);
    formData.append("targetSeconds", String(getRemixTargetSeconds()));
    formData.append("ratio", ratio === "9:16" ? "9:16" : "16:9");
    if (sourcePrompt.trim()) {
      formData.append("prompt", sourcePrompt.trim());
    }
    setRemixReferenceImageLoading(true);
    try {
      const res = await fetch("/api/video-remix/frame-reference", { method: "POST", body: formData });
      const json = await res.json();
      if (!res.ok || !json?.ok || !json?.imageUrl) {
        throw new Error(String(json?.message || "参考图生成失败"));
      }
      const imageUrl = String(json.imageUrl);
      setRemixGeneratedReferenceImageUrl(imageUrl);
      setReferenceImageData(imageUrl);
      setReferenceImageThumbData(imageUrl);
      setReferenceImageName("原视频抽帧参考图");
      setHasReferenceImage(true);
      showToast("参考图已生成，可直接用于图生视频");
    } catch {
      showToast("复刻提示词已生成，但参考图生成失败，可手动上传参考图继续生成");
    } finally {
      setRemixReferenceImageLoading(false);
    }
  };

  const handleAnalyzeRemixVideo = () => {
    if (!isLoggedIn) {
      showToast("请先登录后再分析视频");
      router.push("/login");
      return;
    }
    if (!remixVideoFile) {
      showToast("请先上传参考视频");
      return;
    }
    if (!isValidRemixVideoFile(remixVideoFile)) {
      showToast("仅支持 mp4 / mov / webm 视频");
      return;
    }
    if (remixVideoFile.size > 50 * 1024 * 1024) {
      showToast("参考视频最大 50MB");
      return;
    }
    const targetSeconds = getRemixTargetSeconds();
    const range = getRemixDurationRange();
    if (remixVideoDuration !== null && (remixVideoDuration < range.min || remixVideoDuration > range.max)) {
      showToast(range.message);
      return;
    }
    const formData = new FormData();
    formData.append("video", remixVideoFile);
    formData.append("targetSeconds", String(targetSeconds));
    formData.append("ratio", ratio === "9:16" ? "9:16" : "16:9");
    formData.append("outputLanguage", remixOutputLanguage);
    if (remixUserHint.trim()) {
      formData.append("userHint", remixUserHint.trim());
    }
    formData.append("generateReferenceImage", remixGenerateReferenceImage ? "true" : "false");
    setRemixAnalysisLoading(true);
    setRemixReferenceImageLoading(remixGenerateReferenceImage);
    void (async () => {
      try {
        const res = await fetch("/api/video-remix/analyze", { method: "POST", body: formData });
        const json = await res.json();
        if (!res.ok || !json?.ok || !json?.jobId) {
          showToast(getRemixAnalyzeErrorMessage(String(json?.message || "")));
          return;
        }
        const jobId = String(json.jobId);
        const startedAt = Date.now();
        while (Date.now() - startedAt < 600_000) {
          await new Promise((resolve) => window.setTimeout(resolve, 5000));
          const pollRes = await fetch(`/api/video-remix/jobs/${encodeURIComponent(jobId)}`, { cache: "no-store" });
          const pollJson = await pollRes.json();
          if (!pollRes.ok || !pollJson?.ok || !pollJson?.job) {
            throw new Error(String(pollJson?.message || "查询分析任务失败"));
          }
          const job = pollJson.job as {
            status?: string;
            analysis?: string;
            prompt?: string;
            referenceImageUrl?: string;
            referenceImageError?: string;
            error?: string;
          };
          if (job.status === "success" && job.prompt) {
            const nextPrompt = String(job.prompt);
            setPrompt(nextPrompt);
            setRemixAnalysisResult({
              analysis: String(job.analysis || ""),
              prompt: nextPrompt,
              duration: remixVideoDuration,
            });
            if (job.referenceImageUrl) {
              const imageUrl = String(job.referenceImageUrl);
              setRemixGeneratedReferenceImageUrl(imageUrl);
              setReferenceImageData(imageUrl);
              setReferenceImageThumbData(imageUrl);
              setReferenceImageName("原视频抽帧参考图");
              setHasReferenceImage(true);
              showToast("参考图已生成，可直接用于图生视频");
            } else if (job.referenceImageError) {
              showToast("复刻提示词已生成，但参考图生成失败，可手动上传参考图继续生成");
            } else {
              showToast("AI已生成复刻提示词，可编辑后点击开始生成视频。");
            }
            return;
          }
          if (job.status === "failed") {
            showToast(getRemixAnalyzeErrorMessage(String(job.error || "分析视频失败")));
            return;
          }
        }
        showToast("视频分析等待超时，请稍后刷新或换一个更短的视频重试。");
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        showToast(getRemixAnalyzeErrorMessage(message));
      } finally {
        setRemixAnalysisLoading(false);
        setRemixReferenceImageLoading(false);
      }
    })();
  };

  const handleUseRemixPrompt = () => {
    if (!remixAnalysisResult?.prompt) return;
    setPrompt(remixAnalysisResult.prompt);
    requestAnimationFrame(() => {
      promptInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      promptInputRef.current?.focus();
    });
  };

  const handleCopyRemixPrompt = () => {
    if (!remixAnalysisResult?.prompt) return;
    void navigator.clipboard.writeText(remixAnalysisResult.prompt).then(
      () => showToast("复刻提示词已复制"),
      () => showToast("复制失败，请手动复制")
    );
  };

  const handleRemoveReferenceImage = () => {
    setReferenceImageData(null);
    setReferenceImageThumbData(null);
    setReferenceImageName("");
    setHasReferenceImage(false);
    setRemixGeneratedReferenceImageUrl(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    showToast("已移除参考图");
  };

  const handleToggleReferenceImage = () => {
    if (hasReferenceImage && referenceImageData) {
      handleRemoveReferenceImage();
      return;
    }
    fileInputRef.current?.click();
  };

  const selectedAgent = agentProfiles.find((agent) => agent.id === selectedAgentId) ?? null;
  const isRemixMode = mode === "remix";
  const isMediumVideoMode = mode === "medium_video";
  const isImageMode = mode === "image" || mode === "agent_image";
  const isAgentMode = mode === "agent" || mode === "agent_image" || isMediumVideoMode;
  const modeLabel =
    isRemixMode
      ? "爆款视频复刻"
      : isMediumVideoMode
        ? "中视频"
      : mode === "agent"
      ? "智能体批量视频"
      : mode === "normal"
        ? "通用视频"
        : mode === "agent_image"
          ? "智能体批量图片"
          : "通用图片";
  const selectedAgentApplicable =
    !selectedAgent ||
    ((mode === "agent" || isMediumVideoMode) && (selectedAgent.type === "video" || selectedAgent.type === "both")) ||
    (mode === "agent_image" && (selectedAgent.type === "image" || selectedAgent.type === "both")) ||
    !isAgentMode;

  const estimatedCost = (() => {
    const imagePrefix: "image" | "image2" = imageModel === "banana2" ? "image" : "image2";
    const imagePriceKey = `${imagePrefix}_${imageSize}` as "image_1K" | "image_2K" | "image_4K" | "image2_1K" | "image2_2K" | "image2_4K";
    const unit =
      isMediumVideoMode
        ? pricing.video_12s
        : isImageMode
        ? pricing[imagePriceKey]
        : duration === "4s"
          ? pricing.video_4s
          : duration === "8s"
            ? pricing.video_8s
            : pricing.video_12s;
    return Number((unit * (isMediumVideoMode ? mediumVideoSegments : generateCount)).toFixed(2));
  })();
  const isBalanceInsufficient = isLoggedIn && Number(balance) < estimatedCost;
  const currentChannelEnabled = isImageMode ? pricing.image_enabled : pricing.video_enabled;
  const imageModelRestrictionMessage =
    isImageMode && imageModel === "image2" && imageSize === "2K" && ratio === "9:16"
      ? "image2模型暂不支持该比例/分辨率组合"
      : isImageMode && imageModel === "image2" && imageSize === "4K" && ratio === "1:1"
        ? "image2模型暂不支持该比例/分辨率组合"
        : "";

  const makeTaskId = (taskId: number) => `TASK-${String(taskId).padStart(3, "0")}`;
  const agentSearchKeyword = agentSearch.trim().toLowerCase();
  const visibleAgents = agentProfiles.filter((agent) => {
    if ((mode === "agent" || isMediumVideoMode) && !(agent.type === "video" || agent.type === "both")) return false;
    if (mode === "agent_image" && !(agent.type === "image" || agent.type === "both")) return false;
    if (!agentSearchKeyword) return true;
    return (
      agent.name.toLowerCase().includes(agentSearchKeyword) ||
      agent.description.toLowerCase().includes(agentSearchKeyword) ||
      agent.tags.some((tag) => tag.toLowerCase().includes(agentSearchKeyword))
    );
  });

  const statusLabelMap: Record<TaskStatus, string> = {
    waiting: "待执行",
    queued: "排队中",
    running: "执行中",
    success: "已完成",
    failed: "生成失败",
    cancelled: "已取消",
  };

  const getStatusClass = (status: TaskStatus) => {
    if (status === "waiting") {
      return "rounded-full border border-slate-300/80 bg-slate-100 px-3 py-1 text-xs font-semibold tracking-wide text-slate-600 shadow-sm";
    }
    if (status === "queued" || status === "running") {
      return "rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-semibold tracking-wide text-violet-700 shadow-sm";
    }
    if (status === "failed") {
      return "rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold tracking-wide text-rose-700 shadow-sm";
    }
    if (status === "cancelled") {
      return "rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold tracking-wide text-slate-500 shadow-sm";
    }
    return "rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold tracking-wide text-emerald-700 shadow-sm";
  };

  const taskRecords = [...tasks]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((task) => {
      const relatedVideos = videos.filter((video) => video.taskId === task.id);
      const successCount = relatedVideos.filter((video) => video.status === "success").length;
      const failedCount = relatedVideos.filter((video) => video.status === "failed").length;
      const taskCost = relatedVideos.reduce((sum, video) => sum + video.cost, 0);
      const relatedVideoIds = relatedVideos.map((video) => video.id);
      return {
        ...task,
        item: task.prompt,
        isFavorite: relatedVideoIds.some((id) => favorites.includes(id)),
        isLatestDone: task.status === "success" && !tasks.some((item) => item.status === "success" && item.createdAt > task.createdAt),
        totalVideos: relatedVideos.length,
        successVideos: successCount,
        failedVideos: failedCount,
        cost: taskCost,
        agentId: task.agentId,
        agentName: task.agentName,
        agentAccess: task.agentAccess,
        agentAuthorized: task.agentAuthorized,
      };
    });

  const realVideoRecords = [...videos]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((video) => {
      const parentTask = tasks.find((task) => task.id === video.taskId);
      return {
        id: video.id,
        taskId: video.taskId,
        mediaType: video.mediaType,
        title: video.title,
        item: video.content,
        script: video.script,
        promptText: video.promptText,
        status: video.status,
        createdAt: video.createdAt,
        cost: video.cost,
        seconds: video.seconds,
        duration: typeof video.duration === "string" ? video.duration : undefined,
        upscaleStatus: video.upscaleStatus,
        upscaleErrorMessage: video.upscaleErrorMessage,
        hasReferenceImage: video.hasReferenceImage,
        referenceImageName: video.referenceImageName,
        referenceImageThumbData: parentTask?.referenceImageThumbData,
        ratio: video.ratio,
        size: video.size,
        imageSize: video.imageSize ?? parentTask?.imageSize,
        imageModel: video.imageModel ?? parentTask?.imageModel,
        displayModel: video.displayModel,
        imageModelLabel: video.imageModelLabel,
        apiModel: video.apiModel,
        coverData: video.coverData,
        videoUrl: video.videoUrl,
        kind: parentTask?.kind === "schedule" ? "schedule" : "video",
        scheduledAt: parentTask?.scheduledAt,
        prompt: parentTask?.prompt ?? "未知任务",
        agentName: parentTask?.agentName,
        mediumVideo: video.mediumVideo,
        isFinalVideoLikelyComplete: video.isFinalVideoLikelyComplete,
        segmentIndex: video.segmentIndex,
        totalSegments: video.totalSegments,
        segmentTitle: video.segmentTitle,
        isFavorite: favorites.includes(video.id),
        isLatestDone: video.status === "success" && !videos.some((item) => item.status === "success" && item.createdAt > video.createdAt),
        taskStatus: parentTask?.status ?? "success",
        isPlaceholder: false,
      };
    });

  const placeholderRecords = taskRecords.flatMap((task) => {
    if (!["waiting", "queued", "running", "failed", "cancelled"].includes(task.status)) return [];
    const relatedVideos = videos.filter((video) => video.taskId === task.id);
    const expectedCount = Math.max(1, task.mode === "medium_video" ? 1 : task.countSnapshot ?? relatedVideos.length);
    const missingCount = Math.max(0, expectedCount - relatedVideos.length);
    if (missingCount === 0) return [];
    const mediaType: "video" | "image" = task.mode === "image" ? "image" : "video";
    const placeholderStatus: TaskStatus = task.status === "cancelled" ? "cancelled" : task.status;
    const placeholderText =
      placeholderStatus === "waiting"
        ? "任务已创建，等待定时执行"
        : placeholderStatus === "failed"
          ? "任务生成失败，暂无作品记录"
          : placeholderStatus === "cancelled"
            ? "任务已取消，暂无作品记录"
            : mediaType === "image"
              ? "图片生成中，请稍候"
              : "视频生成中，请稍候";
    return Array.from({ length: missingCount }, (_, index) => ({
      id: -1 * (task.id * 100 + index + 1),
      taskId: task.id,
      mediaType,
      title: task.mode === "medium_video" ? `中视频生成中：${task.duration || `${(task.mediumVideoSegments ?? 1) * 10}s`}` : `${mediaType === "image" ? "图片" : "视频"}占位 ${index + 1}`,
      item: task.mode === "medium_video" ? `中视频生成中：${placeholderText}` : placeholderText,
      script: [] as string[],
      promptText: task.promptSnapshot ?? task.prompt,
      status: placeholderStatus,
      createdAt: task.createdAt + index,
      cost: 0,
      seconds: mediaType === "video" ? Number((task.duration || duration).replace(/[^\d]/g, "")) || undefined : undefined,
      duration: mediaType === "video" ? task.duration || duration : undefined,
      upscaleStatus: mediaType === "video" ? "idle" as const : undefined,
      upscaleErrorMessage: undefined,
      hasReferenceImage: task.hasReferenceImage,
      referenceImageName: task.referenceImageName,
      referenceImageThumbData: task.referenceImageThumbData,
      ratio: mediaType === "image" ? task.ratio || ratio as "1:1" | "9:16" | "16:9" : task.ratio === "9:16" || ratio === "9:16" ? "9:16" as const : "16:9" as const,
      size: mediaType === "image" ? task.imageSize : undefined,
      imageSize: task.imageSize,
      imageModel: task.imageModel,
      displayModel: undefined,
      imageModelLabel: undefined,
      apiModel: undefined,
      coverData: undefined,
      videoUrl: undefined,
      kind: task.kind === "schedule" ? "schedule" : "video",
      scheduledAt: task.scheduledAt,
      prompt: task.prompt,
      agentName: task.agentName,
      mediumVideo: task.mode === "medium_video",
      isFinalVideoLikelyComplete: undefined,
      segmentIndex: task.mode === "medium_video" ? 1 : undefined,
      totalSegments: task.mode === "medium_video" ? expectedCount : undefined,
      segmentTitle: task.mode === "medium_video" ? "Grok 中视频" : undefined,
      isFavorite: false,
      isLatestDone: false,
      taskStatus: task.status,
      isPlaceholder: true,
    }));
  });

  const videoRecords = [...placeholderRecords, ...realVideoRecords]
    .sort((a, b) => b.createdAt - a.createdAt);

  const detailTask = taskDetailId ? taskRecords.find((task) => task.id === taskDetailId) ?? null : null;
  const rawDetailVideos = detailTask ? videoRecords.filter((video) => video.taskId === detailTask.id) : [];
  const shouldSortDetailVideosBySegment = Boolean(
    detailTask?.mode === "medium_video" ||
      rawDetailVideos.some((video) => video.mediumVideo || typeof video.segmentIndex === "number" || typeof video.totalSegments === "number")
  );
  const detailVideos = shouldSortDetailVideosBySegment
    ? [...rawDetailVideos].sort((a, b) => {
        const aSegmentIndex = typeof a.segmentIndex === "number" ? a.segmentIndex : Number.POSITIVE_INFINITY;
        const bSegmentIndex = typeof b.segmentIndex === "number" ? b.segmentIndex : Number.POSITIVE_INFINITY;
        if (aSegmentIndex !== bSegmentIndex) return aSegmentIndex - bSegmentIndex;
        return a.createdAt - b.createdAt;
      })
    : rawDetailVideos;
  const activeDetailVideo = detailVideos.find((video) => video.id === detailVideoId) ?? detailVideos[0] ?? null;

  const resultSearchKeyword = resultSearch.trim().toLowerCase();
  const sortedVideoRecords = [...videoRecords].sort((a, b) => (resultSort === "earliest" ? a.createdAt - b.createdAt : b.createdAt - a.createdAt));
  const visibleResults = sortedVideoRecords.filter((record) => {
    const passFavorite = resultFilter === "favorites" ? record.isFavorite : true;
    const passSortStatus = resultSort === "successOnly" ? record.status === "success" : resultSort === "failedOnly" ? record.status === "failed" : true;
    const passSearch = resultSearchKeyword ? record.item.toLowerCase().includes(resultSearchKeyword) : true;
    return passFavorite && passSortStatus && passSearch;
  });

  const taskSearchKeyword = taskSearch.trim().toLowerCase();

  const filteredTaskRecords = taskRecords.filter((record) => {
    const passSearch = taskSearchKeyword ? record.item.toLowerCase().includes(taskSearchKeyword) : true;
    const passFilter =
      taskDrawerFilter === "favorites"
        ? record.isFavorite
        : taskDrawerFilter === "generating"
          ? record.status === "queued" || record.status === "running"
          : taskDrawerFilter === "success"
            ? record.status === "success"
            : taskDrawerFilter === "failed"
              ? record.status === "failed" || record.status === "cancelled"
              : taskDrawerFilter === "waiting"
                ? record.status === "waiting"
                : true;
    return passSearch && passFilter;
  });

  const visibleFavoriteCount = visibleResults.filter((record) => record.isFavorite).length;
  const totalCost = formatMoney(videos.reduce((sum, video) => sum + video.cost, 0));
  const totalGeneratedCount = videos.length;
  const successTaskCount = videos.filter((video) => video.status === "success").length;
  const failedTaskCount = videos.filter((video) => video.status === "failed").length;
  const scheduledTaskCount = tasks.filter((task) => task.kind === "schedule").length;
  const finishedTaskCount = videos.length;
  const successRate = finishedTaskCount > 0 ? `${Math.round((successTaskCount / finishedTaskCount) * 100)}%` : "0%";
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayGeneratedCount = videos.filter((video) => video.createdAt >= todayStart.getTime()).length;

  const formatTaskPublishTime = (timestamp: number) => {
    const now = Date.now();
    const diffMs = Math.max(0, now - timestamp);
    const minuteMs = 60 * 1000;
    const hourMs = 60 * minuteMs;
    const dayMs = 24 * hourMs;
    if (diffMs < minuteMs) {
      return "刚刚";
    }
    if (diffMs < hourMs) {
      return `${Math.floor(diffMs / minuteMs)}分钟前`;
    }
    if (diffMs < dayMs) {
      return `${Math.floor(diffMs / hourMs)}小时前`;
    }
    const date = new Date(timestamp);
    const pad = (num: number) => String(num).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  };

  const renderVideoCover = (
    video: { id?: number; mediaType?: "video" | "image"; coverData?: string; coverUrl?: string; previewImageUrl?: string; videoUrl?: string; ratio?: "1:1" | "9:16" | "16:9"; seconds?: number; duration?: string; isPlaceholder?: boolean; status?: TaskStatus } | null
  ) => {
    const finalCoverSrc = normalizeReferenceImageSrc(video?.coverData);
    const hasCover = Boolean(finalCoverSrc);
    const isPortrait = video?.ratio === "9:16";
    const outerClass = isDark
      ? `relative flex h-full w-full items-center justify-center overflow-hidden rounded-2xl border border-gray-700/90 bg-gradient-to-br from-[#1d1d22] via-[#23232a] to-[#101014]`
      : `relative flex h-full w-full items-center justify-center overflow-hidden rounded-2xl border border-gray-200 bg-gradient-to-br from-gray-100 via-white to-gray-200`;
    return (
      <div className={outerClass}>
        {video?.mediaType !== "image" && (
          <div className="absolute right-1.5 top-1.5 z-10 rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] text-white">
            {getDurationLabel(video?.seconds, video?.duration)}
          </div>
        )}
        <div className="h-full w-full overflow-hidden rounded-2xl">
          {video?.isPlaceholder ? (
            <div className={isDark ? "relative flex h-full w-full items-center justify-center overflow-hidden bg-[#17171d]" : "relative flex h-full w-full items-center justify-center overflow-hidden bg-gray-100"}>
              <div className={isDark ? "absolute inset-0 animate-pulse bg-gradient-to-r from-[#181820] via-[#242430] to-[#181820]" : "absolute inset-0 animate-pulse bg-gradient-to-r from-gray-100 via-white to-gray-200"} />
              <div className="relative z-10 px-2 text-center text-[10px] font-medium text-gray-500">
                {video.status === "waiting" ? "待执行" : video.status === "failed" || video.status === "cancelled" ? "暂无作品" : video.mediaType === "image" ? "图片生成中" : "视频生成中"}
              </div>
            </div>
          ) : hasCover ? (
            <img src={finalCoverSrc ?? ""} alt={video?.mediaType === "image" ? "图片封面" : "视频封面"} className="h-full w-full object-cover object-center" draggable={false} />
          ) : (
            <div className={isDark ? "flex h-full w-full items-center justify-center bg-black/35 text-[10px] text-gray-300" : "flex h-full w-full items-center justify-center bg-white/70 text-[10px] text-gray-600"}>
              {video?.mediaType === "image" ? "图片封面" : "视频封面"}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderReferencePreview = (referenceName?: string, compact = false, previewData?: string | null) => {
    const displayImageData = referenceImageData ?? previewData;
    if (!displayImageData) return null;
    const finalSrc = normalizeReferenceImageSrc(displayImageData);
    if (compact) {
      return (
        <img
          src={finalSrc ?? ""}
          alt={referenceName || "参考图缩略图"}
          className="h-10 w-14 shrink-0 rounded-lg border border-gray-300/60 object-cover transition duration-200 hover:scale-[1.03] hover:shadow-sm dark:border-gray-700/70"
        />
      );
    }
    return (
      <div className={isDark ? "rounded-2xl border border-gray-800 bg-[#18181b] p-3" : "rounded-2xl border border-gray-200 bg-gray-50 p-3"}>
        <div className="mb-2 text-xs">{referenceName || "参考图预览"}</div>
        <div className={isDark ? "flex max-h-64 items-center justify-center overflow-hidden rounded-xl border border-gray-700 bg-[#121214] p-2" : "flex max-h-64 items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-white p-2"}>
          <img src={finalSrc ?? ""} alt={referenceName || "参考图预览"} className="max-h-60 w-full rounded-lg object-contain" />
        </div>
      </div>
    );
  };
  const resultTotalPages = Math.max(1, Math.ceil(visibleResults.length / RESULT_PAGE_SIZE));
  const drawerTotalPages = Math.max(1, Math.ceil(filteredTaskRecords.length / PAGE_SIZE));
  const pagedVisibleResults = visibleResults.slice((resultPage - 1) * RESULT_PAGE_SIZE, resultPage * RESULT_PAGE_SIZE);
  const pagedDrawerRecords = filteredTaskRecords.slice((drawerPage - 1) * PAGE_SIZE, drawerPage * PAGE_SIZE);

  useEffect(() => {
    setResultPage(1);
  }, [resultFilter, resultSort, resultSearch, mode, favorites.length, videos.length]);

  useEffect(() => {
    setDrawerPage(1);
  }, [taskDrawerFilter, taskSearch, favorites.length, tasks.length, videos.length]);

  useEffect(() => {
    setSelectedTaskIds((prev) => prev.filter((id) => tasks.some((task) => task.id === id)));
  }, [tasks]);

  useEffect(() => {
    if (!detailTask) {
      setDetailVideoId(null);
      return;
    }
    const firstVideo = detailVideos[0];
    if (!firstVideo) {
      setDetailVideoId(null);
      return;
    }
    setDetailVideoId((prev) => (prev && detailVideos.some((video) => video.id === prev) ? prev : firstVideo.id));
  }, [detailTask, detailVideos]);

  useEffect(() => {
    if (resultPage > resultTotalPages) {
      setResultPage(resultTotalPages);
    }
  }, [resultPage, resultTotalPages]);

  useEffect(() => {
    if (drawerPage > drawerTotalPages) {
      setDrawerPage(drawerTotalPages);
    }
  }, [drawerPage, drawerTotalPages]);

  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem("quark_favorites", JSON.stringify(favorites));
  }, [favorites, mounted]);

  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem("quark_prompt", prompt);
  }, [prompt, mounted]);

  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem("quark_generate_count", String(generateCount));
  }, [generateCount, mounted]);

  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem("quark_medium_video_segments", String(mediumVideoSegments));
  }, [mediumVideoSegments, mounted]);

  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem("quark_mode", mode);
  }, [mode, mounted]);

  useEffect(() => {
    if (!mounted) return;
    if (selectedAgentId) {
      localStorage.setItem("quark_selected_agent_id", selectedAgentId);
    } else {
      localStorage.removeItem("quark_selected_agent_id");
    }
  }, [selectedAgentId, mounted]);

  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem("quark_duration", duration);
  }, [duration, mounted]);

  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem("quark_ratio", ratio);
  }, [ratio, mounted]);

  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem("quark_image_size", imageSize);
  }, [imageSize, mounted]);

  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem("quark_image_model", imageModel);
  }, [imageModel, mounted]);

  useEffect(() => {
    if (!mounted || !isImageMode || imageModel !== "image2") return;
    const unsupported = (imageSize === "2K" && ratio === "9:16") || (imageSize === "4K" && ratio === "1:1");
    if (unsupported) {
      setImageSize("1K");
      setRatio("9:16");
    }
  }, [imageModel, imageSize, isImageMode, mounted, ratio]);

  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem("quark_has_reference_image", hasReferenceImage ? "true" : "false");
  }, [hasReferenceImage, mounted]);

  useEffect(() => {
    if (!mounted) return;
    try {
      if (referenceImageData) {
        localStorage.setItem("quark_reference_image_data", referenceImageData);
      } else {
        localStorage.removeItem("quark_reference_image_data");
      }
      localStorage.setItem("quark_reference_image_name", referenceImageName);
    } catch {
      localStorage.removeItem("quark_reference_image_data");
      localStorage.setItem("quark_reference_image_name", referenceImageName);
      if (!storageWarningShownRef.current) {
        storageWarningShownRef.current = true;
        showToast("参考图过大，已启用轻量存储模式");
      }
    }
  }, [referenceImageData, referenceImageName, mounted]);

  useEffect(() => {
    if (!mounted) return;
    try {
      if (referenceImageThumbData) {
        localStorage.setItem("quark_reference_image_thumb_data", referenceImageThumbData);
      } else {
        localStorage.removeItem("quark_reference_image_thumb_data");
      }
    } catch {
      localStorage.removeItem("quark_reference_image_thumb_data");
    }
  }, [referenceImageThumbData, mounted]);

  useEffect(() => {
    if (!mounted) return;
    void syncFromServer();
    const interval = window.setInterval(() => {
      void syncFromServer();
    }, 4000);
    return () => {
      window.clearInterval(interval);
    };
  }, [mounted]);

  useEffect(() => {
    return () => {
      Object.values(scheduleTimersRef.current).forEach((timer) => {
        window.clearTimeout(timer);
      });
      Object.values(taskPollersRef.current).forEach((timer) => {
        window.clearInterval(timer);
      });
    };
  }, []);

  useEffect(() => {
    if (previewVideo?.mediaType === "image") {
      setImagePreviewScale(1);
    }
  }, [previewVideo?.id, previewVideo?.mediaType]);

  const pillClass = (active: boolean) =>
    active
      ? "bg-gradient-to-r from-indigo-500 via-violet-500 to-sky-500 text-white shadow-sm shadow-indigo-200"
      : isDark
        ? "border border-gray-700 bg-[#18181d] text-gray-200 hover:border-indigo-500/60 hover:bg-[#20202a]"
        : "border border-indigo-100 bg-white/85 text-slate-700 shadow-sm shadow-slate-200/50 hover:border-indigo-200 hover:bg-indigo-50/60";
  const modeTabClass = (active: boolean) =>
    active
      ? "rounded-2xl bg-gradient-to-r from-indigo-500 via-violet-500 to-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-200/60 transition hover:-translate-y-0.5"
      : isDark
        ? "rounded-2xl border border-gray-800 bg-white/[0.04] px-4 py-2 text-sm font-medium text-gray-300 transition hover:-translate-y-0.5 hover:border-indigo-500/50 hover:bg-indigo-500/10"
        : "rounded-2xl border border-indigo-100 bg-white/70 px-4 py-2 text-sm font-medium text-slate-600 shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-200 hover:bg-indigo-50/80 hover:text-indigo-700";
  const toolButtonClass = (active = false) =>
    active
      ? "rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-indigo-200 transition hover:-translate-y-0.5 hover:bg-indigo-700"
      : isDark
        ? "rounded-full border border-gray-700 bg-white/[0.05] px-4 py-2 text-sm font-medium text-gray-100 transition hover:-translate-y-0.5 hover:border-indigo-400/60 hover:bg-indigo-500/10"
        : "rounded-full border border-indigo-100 bg-white/80 px-4 py-2 text-sm font-medium text-slate-700 shadow-sm shadow-slate-200/60 transition hover:-translate-y-0.5 hover:border-indigo-200 hover:bg-indigo-50";
  const primaryActionClass = isDark
    ? "rounded-full bg-gradient-to-r from-indigo-400 via-violet-400 to-sky-400 px-7 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-950/40 transition hover:-translate-y-0.5 hover:brightness-110 disabled:opacity-60"
    : "rounded-full bg-gradient-to-r from-indigo-500 via-violet-500 to-sky-500 px-7 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-200/80 transition hover:-translate-y-0.5 hover:brightness-105 disabled:opacity-60";
  const secondaryButtonClass = isDark
    ? "rounded-full border border-gray-700 bg-white/[0.05] px-4 py-2 text-sm font-medium text-gray-100 transition hover:bg-white/[0.08]"
    : "rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50";
  const dangerButtonClass = isDark
    ? "rounded-full border border-rose-900/70 bg-rose-950/30 px-3 py-1.5 text-xs font-medium text-rose-200 transition hover:bg-rose-900/50"
    : "rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-100";
  const agentTagClass = (tag: string) => {
    if (tag.includes("视频")) return isDark ? "rounded-full border border-sky-400/20 bg-sky-400/10 px-2 py-0.5 text-[10px] font-medium text-sky-200" : "rounded-full border border-sky-100 bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700";
    if (tag.includes("图片") || tag.includes("商品图")) return isDark ? "rounded-full border border-violet-400/20 bg-violet-400/10 px-2 py-0.5 text-[10px] font-medium text-violet-200" : "rounded-full border border-violet-100 bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700";
    if (tag.includes("带货") || tag.includes("转化")) return isDark ? "rounded-full border border-amber-300/20 bg-amber-300/10 px-2 py-0.5 text-[10px] font-medium text-amber-200" : "rounded-full border border-amber-100 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700";
    if (tag.includes("公开")) return isDark ? "rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2 py-0.5 text-[10px] font-medium text-emerald-200" : "rounded-full border border-emerald-100 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700";
    return isDark ? "rounded-full border border-slate-400/20 bg-slate-400/10 px-2 py-0.5 text-[10px] font-medium text-slate-300" : "rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-600";
  };
  const glassPanelClass = isDark
    ? "rounded-[30px] border border-white/10 bg-white/[0.045] shadow-[0_24px_70px_rgba(0,0,0,0.34)] backdrop-blur-xl"
    : "rounded-[30px] border border-white/80 bg-white/76 shadow-[0_24px_70px_rgba(79,70,229,0.12)] backdrop-blur-xl";
  const surfaceCardClass = isDark
    ? "rounded-[24px] border border-white/10 bg-white/[0.055] shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-400/40 hover:bg-white/[0.075] hover:shadow-[0_18px_42px_rgba(0,0,0,0.34)]"
    : "rounded-[24px] border border-white/75 bg-white/86 shadow-md shadow-indigo-100/50 backdrop-blur transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-[0_18px_42px_rgba(79,70,229,0.15)]";
  const softChipClass = isDark
    ? "rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[11px] font-medium text-gray-300"
    : "rounded-full border border-indigo-100 bg-white/85 px-2.5 py-1 text-[11px] font-medium text-slate-600 shadow-sm shadow-indigo-100/40";
  const inputPillClass = isDark
    ? "rounded-full border border-white/10 bg-white/[0.06] px-4 py-2 text-xs text-gray-100 outline-none placeholder:text-gray-500 transition focus:border-indigo-400/60 focus:ring-4 focus:ring-indigo-400/10"
    : "rounded-full border border-indigo-100 bg-white/85 px-4 py-2 text-xs text-slate-700 outline-none shadow-sm placeholder:text-slate-400 transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100/70";
  const smallSecondaryButtonClass = isDark
    ? "rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-gray-100 transition hover:-translate-y-0.5 hover:border-indigo-400/40 hover:bg-white/[0.09]"
    : "rounded-full border border-indigo-100 bg-white/85 px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm shadow-indigo-100/50 transition hover:-translate-y-0.5 hover:border-indigo-200 hover:bg-indigo-50/70";
  const primaryMiniButtonClass = isDark
    ? "rounded-full bg-gradient-to-r from-indigo-400 via-violet-400 to-sky-400 px-3 py-1.5 text-xs font-semibold text-white shadow-md shadow-indigo-950/30 transition hover:-translate-y-0.5 hover:brightness-110"
    : "rounded-full bg-gradient-to-r from-indigo-500 via-violet-500 to-sky-500 px-3 py-1.5 text-xs font-semibold text-white shadow-md shadow-indigo-200/70 transition hover:-translate-y-0.5 hover:brightness-105";
  const filterChipClass = (active: boolean) =>
    active ? primaryMiniButtonClass : smallSecondaryButtonClass;
  const upscaleBadgeClass = (status?: string) => {
    if (status === "success") return isDark ? "rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2.5 py-1 text-[11px] font-medium text-emerald-200" : "rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700";
    if (status === "failed") return isDark ? "rounded-full border border-rose-300/20 bg-rose-300/10 px-2.5 py-1 text-[11px] font-medium text-rose-200" : "rounded-full border border-rose-100 bg-rose-50 px-2.5 py-1 text-[11px] font-medium text-rose-700";
    if (status === "processing" || status === "pending" || status === "queued") return isDark ? "rounded-full border border-amber-300/20 bg-amber-300/10 px-2.5 py-1 text-[11px] font-medium text-amber-200" : "rounded-full border border-amber-100 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700";
    return softChipClass;
  };

  if (!mounted) return null;

  return (
    <main className={isDark ? "relative min-h-screen overflow-hidden bg-[#090a12] text-white" : "relative min-h-screen overflow-hidden bg-gradient-to-b from-slate-50 via-white to-indigo-50 text-slate-950"}>
      <div className="pointer-events-none absolute inset-0 -z-0">
        <div className={isDark ? "absolute left-[-10rem] top-[-12rem] h-[30rem] w-[30rem] rounded-full bg-violet-500/18 blur-3xl" : "absolute left-[-10rem] top-[-12rem] h-[34rem] w-[34rem] rounded-full bg-violet-200/45 blur-3xl"} />
        <div className={isDark ? "absolute right-[-12rem] top-16 h-[34rem] w-[34rem] rounded-full bg-sky-500/12 blur-3xl" : "absolute right-[-12rem] top-12 h-[34rem] w-[34rem] rounded-full bg-sky-200/45 blur-3xl"} />
        <div className={isDark ? "absolute bottom-8 left-1/2 h-[28rem] w-[42rem] -translate-x-1/2 rounded-full bg-indigo-500/8 blur-3xl" : "absolute bottom-8 left-1/2 h-[28rem] w-[42rem] -translate-x-1/2 rounded-full bg-white/90 blur-3xl"} />
      </div>
      <header
        className={
          isDark
            ? "sticky top-0 z-20 border-b border-white/10 bg-[#090a12]/75 shadow-sm backdrop-blur-xl"
            : "sticky top-0 z-20 border-b border-white/70 bg-white/70 shadow-sm shadow-indigo-100/50 backdrop-blur-xl"
        }
      >
        <div className="flex items-center justify-between px-4 py-4 md:px-6">
          {/* 左侧 Logo */}
          <div className="flex items-center gap-3">
            <div
              className={
                isDark
                  ? "flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-300 via-violet-300 to-sky-300 text-sm font-bold text-black shadow-lg shadow-indigo-950/30"
                  : "flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-sky-500 text-sm font-bold text-white shadow-lg shadow-indigo-200/80"
              }
            >
              QK
            </div>
            <div>
              <div className="text-base font-semibold md:text-lg">夸克AI视频</div>
              <div className={isDark ? "text-xs text-gray-400" : "text-xs text-gray-500"}>批量视频生成 Agent</div>
            </div>
          </div>

          {/* 右侧 */}
          <div className="flex items-center gap-2 md:gap-3">
            <button
              onClick={toggleTheme}
              className={toolButtonClass()}
            >
              {isDark ? "☀️" : "🌙"}
            </button>
            {isLoggedIn ? (
              <>
                <div className={isDark ? "rounded-full border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-sm font-semibold text-emerald-100" : "rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 shadow-sm"}>
                  余额 ¥{balance}
                </div>

                <a
                  href="https://work.weixin.qq.com/ca/cawcde87c5c2d49c7f"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={toolButtonClass()}
                >
                  充值
                </a>

                <button
                  onClick={() => setIsTaskDrawerOpen(true)}
                  className={toolButtonClass()}
                >
                  任务记录 {tasks.length > 0 ? `(${tasks.length})` : ""}
                </button>

                {currentUserRole === "admin" && (
                  <button
                    onClick={() => router.push("/admin")}
                    className={toolButtonClass()}
                  >
                    管理后台
                  </button>
                )}

                <div className="flex items-center gap-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 via-violet-500 to-pink-500 text-sm font-semibold text-white">
                    QK
                  </div>
                  <span className={isDark ? "text-sm font-medium text-gray-100" : "text-sm font-medium text-gray-700"}>ID: {userId}</span>
                </div>

                <button
                  onClick={handleLogout}
                  className={secondaryButtonClass}
                >
                  退出登录
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => router.push("/login")}
                  className={secondaryButtonClass}
                >
                  登录
                </button>

                <button
                  onClick={() => router.push("/register")}
                  className={primaryActionClass}
                >
                  注册
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <section className="relative z-10 mx-auto flex max-w-7xl flex-col items-center px-4 pb-16 pt-14 md:px-6 md:pt-18">
        <h1 className="mb-3 text-center text-4xl font-semibold tracking-tight md:text-5xl">
          批量视频生成 <span className="bg-gradient-to-r from-indigo-500 via-violet-500 to-sky-500 bg-clip-text text-transparent">Agent</span>
        </h1>
        <p className={isDark ? "mb-8 text-sm text-gray-400 md:text-base" : "mb-8 text-sm text-gray-500 md:text-base"}>
          一句话生成多个视频，支持批量与定时任务
        </p>

        <div className={isDark ? "relative w-full max-w-5xl overflow-hidden rounded-[34px] border border-white/10 bg-white/[0.065] p-4 shadow-[0_30px_90px_rgba(0,0,0,0.42)] backdrop-blur-2xl ring-1 ring-indigo-400/10 md:p-5" : "relative w-full max-w-5xl overflow-hidden rounded-[34px] border border-white/80 bg-white/84 p-4 shadow-[0_30px_90px_rgba(79,70,229,0.18)] backdrop-blur-2xl ring-1 ring-indigo-100/70 md:p-5"}>
          <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-indigo-400/70 to-transparent" />
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleReferenceUpload} className="hidden" />
          <input ref={remixVideoInputRef} type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" onChange={handleRemixVideoUpload} className="hidden" />
          <textarea
            ref={promptInputRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={isRemixMode ? "上传参考视频并分析后，AI 会在这里填入适用于 Sora2 的复刻提示词..." : "输入你的创意，例如：新员工入职手足无措，生成 3 条搞笑办公室短视频..."}
            className={isDark ? "h-40 w-full resize-none rounded-[26px] border border-white/10 bg-[#12131b]/82 p-5 text-sm leading-6 text-gray-100 outline-none ring-0 transition focus:border-indigo-400/70 focus:shadow-[0_0_0_5px_rgba(99,102,241,0.13)] placeholder:text-gray-500 md:h-44" : "h-40 w-full resize-none rounded-[26px] border border-indigo-100 bg-slate-50/70 p-5 text-sm leading-6 text-slate-800 outline-none ring-0 transition focus:border-indigo-300 focus:bg-white focus:shadow-[0_0_0_5px_rgba(99,102,241,0.13)] placeholder:text-slate-400 md:h-44"}
          />
          <div className="mt-2 flex justify-end">
            <button
              onClick={() => setPrompt("")}
              className={
                isDark
                  ? "rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-gray-300 transition hover:bg-white/[0.08]"
                  : "rounded-full border border-transparent bg-transparent px-3 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
              }
            >
              清空输入
            </button>
          </div>

          <div className="mt-4 flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className={isDark ? "rounded-full bg-gray-800 px-4 py-2 text-sm text-gray-100" : "rounded-full bg-gray-100 px-4 py-2 text-sm text-gray-700"}>
                {modeLabel}
              </div>
              <div className={isDark ? "text-sm text-gray-400" : "text-sm text-gray-500"}>
                已输入 {prompt.length} 字 {prompt.length === 0 ? "｜建议先输入提示词" : "｜可直接开始生成"}
              </div>
            </div>

            {!isRemixMode && !isMediumVideoMode && hasReferenceImage && referenceImageData && (
              <div className={isDark ? "rounded-2xl border border-gray-800 bg-[#18181b] p-3" : "rounded-2xl border border-gray-200 bg-gray-50 p-3"}>
                <div className="flex flex-wrap items-center gap-3">
                  {(() => {
                    const finalSrc = normalizeReferenceImageSrc(referenceImageData);
                    return <img src={finalSrc ?? ""} alt="参考图" className="h-14 w-14 rounded-xl object-cover" />;
                  })()}
                  <div className="space-y-1">
                    <div className="text-xs font-medium">{referenceImageName || "已上传参考图"}</div>
                    <div className={isDark ? "text-xs text-gray-400" : "text-xs text-gray-500"}>参考图：已添加</div>
                  </div>
                  <button
                    onClick={handleRemoveReferenceImage}
                    className={isDark ? "ml-auto rounded-full bg-gray-700 px-3 py-2 text-xs text-gray-100" : "ml-auto rounded-full bg-white px-3 py-2 text-xs text-gray-700"}
                  >
                    移除参考图
                  </button>
                </div>
              </div>
            )}

            <div className={isDark ? "order-2 flex flex-wrap items-center gap-2 rounded-[24px] border border-white/10 bg-white/[0.045] p-1.5 shadow-inner shadow-black/20" : "order-2 flex flex-wrap items-center gap-1.5 rounded-[24px] border border-white/80 bg-slate-100/80 p-1.5 shadow-inner shadow-white/90"}>
              <button
                onClick={() => {
                  setMode("remix");
                  setSelectedAgentId(null);
                  setReferenceImageData(null);
                  setReferenceImageThumbData(null);
                  setReferenceImageName("");
                  setHasReferenceImage(false);
                  setRemixGeneratedReferenceImageUrl(null);
                  if (ratio === "1:1") setRatio("16:9");
                }}
                className={modeTabClass(mode === "remix")}
              >
                <span className="mr-1 text-xs">✨</span>爆款视频复刻
              </button>

              <button
                onClick={() => {
                  setMode("medium_video");
                  setDuration(`${mediumVideoSegments * 10}s`);
                  setReferenceImageData(null);
                  setReferenceImageThumbData(null);
                  setReferenceImageName("");
                  setHasReferenceImage(false);
                  if (ratio === "1:1") setRatio("16:9");
                }}
                className={modeTabClass(mode === "medium_video")}
              >
                <span className="mr-1 text-xs">🎬</span>中视频
              </button>

              <button
                onClick={() => {
                  setMode("agent");
                  setSelectedAgentId(null);
                  if (ratio === "1:1") setRatio("16:9");
                }}
                className={modeTabClass(mode === "agent")}
              >
                <span className="mr-1 text-xs">🤖</span>智能体批量视频
              </button>

              <button
                onClick={() => {
                  setMode("normal");
                  setSelectedAgentId(null);
                  if (ratio === "1:1") setRatio("16:9");
                }}
                className={modeTabClass(mode === "normal")}
              >
                <span className="mr-1 text-xs">🎞️</span>通用视频
              </button>

              <button
                onClick={() => {
                  setMode("agent_image");
                  setSelectedAgentId(null);
                }}
                className={modeTabClass(mode === "agent_image")}
              >
                <span className="mr-1 text-xs">🧠</span>智能体批量图片
              </button>

              <button
                onClick={() => {
                  setMode("image");
                  setSelectedAgentId(null);
                }}
                className={modeTabClass(mode === "image")}
              >
                <span className="mr-1 text-xs">🖼️</span>通用图片
              </button>
            </div>

            {isRemixMode && (
              <div className={isDark ? "order-4 rounded-3xl border border-violet-400/20 bg-violet-400/[0.04] p-4 shadow-sm" : "order-4 rounded-3xl border border-violet-100 bg-violet-50/60 p-4 shadow-sm shadow-violet-100/60"}>
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">爆款视频复刻</div>
                    <p className={isDark ? "mt-1 max-w-2xl text-xs leading-5 text-gray-400" : "mt-1 max-w-2xl text-xs leading-5 text-gray-500"}>
                      上传参考视频，AI 将分析镜头节奏、画面风格、人物动作和叙事结构，生成适用于 Sora2 的复刻提示词。
                    </p>
                    <p className={isDark ? "mt-1 text-xs text-gray-400" : "mt-1 text-xs text-gray-500"}>
                      支持 mp4 / mov / webm，最大 50MB。当前目标 {duration}，{getRemixDurationRange().hint}。
                    </p>
                  </div>
                  <button
                    onClick={() => remixVideoInputRef.current?.click()}
                    disabled={remixAnalysisLoading || remixReferenceImageLoading}
                    className={`${toolButtonClass(Boolean(remixVideoFile))} disabled:cursor-not-allowed disabled:opacity-60`}
                  >
                    选择参考视频
                  </button>
                </div>

                {remixVideoFile ? (
                  <div className={isDark ? "mb-3 rounded-2xl border border-violet-400/20 bg-[#14151d] p-3 text-sm text-gray-200 shadow-sm" : "mb-3 rounded-2xl border border-violet-100 bg-white/90 p-3 text-sm text-slate-700 shadow-sm"}>
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-sky-500 text-sm font-bold text-white shadow-md shadow-indigo-200">
                        MP4
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{remixVideoFile.name}</div>
                        <div className={isDark ? "mt-1 text-xs text-gray-400" : "mt-1 text-xs text-gray-500"}>
                          {(remixVideoFile.size / 1024 / 1024).toFixed(2)} MB
                          {remixVideoDuration !== null ? ` / ${remixVideoDuration.toFixed(1)} 秒` : " / 时长将在后端校验"}
                        </div>
                      </div>
                      <button
                        onClick={handleRemoveRemixVideo}
                        disabled={remixAnalysisLoading || remixReferenceImageLoading}
                        className={dangerButtonClass}
                      >
                        移除
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => remixVideoInputRef.current?.click()}
                    className={isDark ? "mb-3 flex w-full items-center justify-center gap-3 rounded-2xl border border-dashed border-violet-400/35 bg-white/[0.03] p-5 text-sm text-gray-300 transition hover:border-violet-300/60 hover:bg-violet-400/10" : "mb-3 flex w-full items-center justify-center gap-3 rounded-2xl border border-dashed border-violet-200 bg-white/70 p-5 text-sm text-slate-600 transition hover:border-violet-300 hover:bg-white"}
                  >
                    <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-sky-500 text-white shadow-md shadow-indigo-200">↥</span>
                    <span>还未上传参考视频，请先选择文件后点击分析。</span>
                  </button>
                )}

                <label className="mb-3 block">
                  <span className={isDark ? "mb-1 block text-xs font-medium text-gray-300" : "mb-1 block text-xs font-medium text-gray-600"}>复刻补充要求（可选）</span>
                  <input
                    value={remixUserHint}
                    onChange={(event) => setRemixUserHint(event.target.value)}
                    disabled={remixAnalysisLoading}
                    placeholder="例如：保持原视频卖点结构，但改成更适合小红书风格"
                    className={
                      isDark
                      ? "w-full rounded-2xl border border-white/10 bg-[#14151d] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-violet-400/60 placeholder:text-gray-500 disabled:opacity-60"
                      : "w-full rounded-2xl border border-violet-100 bg-white/90 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-violet-300 placeholder:text-slate-400 disabled:opacity-60"
                    }
                  />
                  <span className={isDark ? "mt-1 block text-[11px] text-gray-500" : "mt-1 block text-[11px] text-gray-400"}>
                    不填写时，AI 将只依据上传视频本身识别主体、商品、场景和带货结构。
                  </span>
                </label>

                <label className="mb-3 block">
                  <span className={isDark ? "mb-1 block text-xs font-medium text-gray-300" : "mb-1 block text-xs font-medium text-gray-600"}>输出语言</span>
                  <select
                    value={remixOutputLanguage}
                    onChange={(event) => setRemixOutputLanguage(event.target.value as "zh" | "en" | "ja")}
                    disabled={remixAnalysisLoading || remixReferenceImageLoading}
                    className={
                      isDark
                      ? "w-full rounded-2xl border border-white/10 bg-[#14151d] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-violet-400/60 disabled:opacity-60"
                      : "w-full rounded-2xl border border-violet-100 bg-white/90 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-violet-300 disabled:opacity-60"
                    }
                  >
                    <option value="zh">中文</option>
                    <option value="en">英文</option>
                    <option value="ja">日文</option>
                  </select>
                </label>

                <label className={isDark ? "mb-3 flex items-start gap-3 rounded-2xl border border-violet-400/20 bg-[#14151d] p-3 text-sm text-gray-200 shadow-sm" : "mb-3 flex items-start gap-3 rounded-2xl border border-violet-100 bg-white/90 p-3 text-sm text-slate-700 shadow-sm"}>
                  <input
                    type="checkbox"
                    checked={remixGenerateReferenceImage}
                    disabled={remixAnalysisLoading || remixReferenceImageLoading}
                    onChange={(event) => setRemixGenerateReferenceImage(event.target.checked)}
                    className="mt-1"
                  />
                  <span>
                    <span className="block font-medium">原视频抽帧生成参考图</span>
                    <span className={isDark ? "mt-1 block text-xs leading-5 text-gray-400" : "mt-1 block text-xs leading-5 text-gray-500"}>
                      从原视频中提取关键画面，并使用 Nano Banana2 按当前比例生成一张新的参考图，可直接用于后续图生视频。
                    </span>
                  </span>
                </label>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={handleAnalyzeRemixVideo}
                    disabled={remixAnalysisLoading || remixReferenceImageLoading}
                    className={primaryActionClass}
                  >
                    {remixAnalysisLoading ? (
                      <span className="inline-flex items-center gap-2">
                        <span>分析中请稍后</span>
                        <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      </span>
                    ) : "分析并生成复刻提示词"}
                  </button>
                  {remixAnalysisResult && (
                    <span className={isDark ? "text-sm text-emerald-300" : "text-sm text-emerald-600"}>
                      AI已生成复刻提示词，可编辑后点击开始生成视频。
                    </span>
                  )}
                </div>
                {remixAnalysisLoading && (
                  <div className={isDark ? "mt-2 text-xs leading-5 text-amber-300" : "mt-2 text-xs leading-5 text-amber-600"}>
                    视频理解通常需要 2-5 分钟，复杂视频最长可能需要 10 分钟，请勿重复点击或刷新页面。
                  </div>
                )}
                {remixReferenceImageLoading && (
                  <div className={isDark ? "mt-2 text-xs leading-5 text-amber-300" : "mt-2 text-xs leading-5 text-amber-600"}>
                    正在生成参考图，请稍候...
                  </div>
                )}

                {(remixGeneratedReferenceImageUrl || (hasReferenceImage && referenceImageData)) ? (
                  <div className={isDark ? "mt-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.05] p-3 text-sm text-gray-200" : "mt-3 rounded-2xl border border-emerald-100 bg-emerald-50/80 p-3 text-sm text-slate-700"}>
                    <div className="flex flex-wrap items-center gap-3">
                      <img src={remixGeneratedReferenceImageUrl || referenceImageData || ""} alt="复刻参考图" className={ratio === "9:16" ? "h-24 w-16 rounded-xl object-cover" : "h-16 w-28 rounded-xl object-cover"} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{remixGeneratedReferenceImageUrl ? "原视频参考图已生成" : "已添加参考图"}</div>
                        <div className={isDark ? "mt-1 text-xs text-gray-400" : "mt-1 text-xs text-gray-500"}>开始生成时会作为 Sora2 图生视频参考图使用。</div>
                      </div>
                      <button onClick={handleRemoveReferenceImage} className={dangerButtonClass}>
                        移除
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3">
                    <button
                      onClick={handleToggleReferenceImage}
                      disabled={remixAnalysisLoading || remixReferenceImageLoading}
                      className={`${secondaryButtonClass} disabled:opacity-50`}
                    >
                      手动上传参考图
                    </button>
                  </div>
                )}

                {remixAnalysisResult && (
                  <div className={isDark ? "mt-4 rounded-3xl border border-emerald-400/30 bg-emerald-400/[0.06] p-4 text-sm text-gray-200 shadow-sm" : "mt-4 rounded-3xl border border-emerald-100 bg-gradient-to-br from-emerald-50 via-white to-sky-50 p-4 text-sm text-slate-700 shadow-md shadow-emerald-100/70"}>
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="text-base font-semibold">AI复刻提示词已生成</div>
                      <div className="flex flex-wrap gap-2">
                        <button onClick={handleUseRemixPrompt} className={primaryActionClass}>
                          使用此提示词
                        </button>
                        <button onClick={handleCopyRemixPrompt} className={secondaryButtonClass}>
                          复制提示词
                        </button>
                      </div>
                    </div>
                    {remixAnalysisResult.analysis && (
                      <div className="mb-3">
                        <div className="mb-1 text-xs font-semibold">analysis 摘要</div>
                        <div className={isDark ? "text-xs leading-5 text-gray-300" : "text-xs leading-5 text-gray-600"}>{remixAnalysisResult.analysis}</div>
                      </div>
                    )}
                    <div>
                      <div className="mb-1 text-xs font-semibold">最终 prompt</div>
                      <pre className={isDark ? "max-h-56 overflow-y-auto whitespace-pre-wrap rounded-xl bg-[#111114] p-3 text-xs leading-5 text-gray-200" : "max-h-56 overflow-y-auto whitespace-pre-wrap rounded-xl bg-white p-3 text-xs leading-5 text-gray-700"}>
                        {remixAnalysisResult.prompt}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            )}

            {isAgentMode && (
              <div id="agent-picker" className={isDark ? "order-4 rounded-[28px] border border-indigo-400/15 bg-white/[0.045] p-4 shadow-lg shadow-black/20" : "order-4 rounded-[28px] border border-white/80 bg-white/78 p-4 shadow-lg shadow-indigo-100/70 backdrop-blur"}>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">{mode === "agent_image" ? "选择图片智能体" : "选择视频智能体"}</div>
                    <div className={isDark ? "mt-1 text-xs text-gray-400" : "mt-1 text-xs text-slate-500"}>智能体会将固定创作策略叠加到你的提示词中。</div>
                  </div>
                  {selectedAgent && selectedAgentApplicable ? (
                    <div className="flex items-center gap-2">
                      <span className={isDark ? "rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-xs font-semibold text-emerald-200" : "rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700"}>
                        已选：{selectedAgent.name}
                      </span>
                      <button
                        onClick={() => setSelectedAgentId(null)}
                        className={secondaryButtonClass}
                      >
                        取消选择
                      </button>
                    </div>
                  ) : (
                    <span className={isDark ? "rounded-full border border-slate-400/20 bg-slate-400/10 px-3 py-1 text-xs font-medium text-slate-300" : "rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600"}>请选择 1 个智能体</span>
                  )}
                </div>

                <input
                  value={agentSearch}
                  onChange={(e) => setAgentSearch(e.target.value)}
                  placeholder="搜索智能体，例如：煤炉 / 餐饮 / 带货"
                  className={
                    isDark
                      ? "mb-3 w-full rounded-2xl border border-white/10 bg-[#12131b]/80 px-4 py-2.5 text-xs text-gray-100 outline-none transition focus:border-indigo-400/60 focus:shadow-[0_0_0_4px_rgba(99,102,241,0.12)] placeholder:text-gray-500"
                      : "mb-3 w-full rounded-2xl border border-indigo-100 bg-white/85 px-4 py-2.5 text-xs text-slate-700 shadow-sm outline-none transition focus:border-indigo-300 focus:shadow-[0_0_0_4px_rgba(99,102,241,0.12)] placeholder:text-slate-400"
                  }
                />

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {visibleAgents.map((agent) => {
                    const isSelected = selectedAgentId === agent.id;
                    const isRestrictedLocked = agent.access === "restricted" && !agent.isAuthorized;
                    const lockIcon = agent.access === "restricted" ? (agent.isAuthorized ? "🔓" : "🔒") : null;
                    return (
                      <button
                        key={agent.id}
                        type="button"
                        onClick={() => {
                          if (isRestrictedLocked) {
                            showToast("该智能体需管理员授权后方可使用");
                            return;
                          }
                          setSelectedAgentId((prev) => (prev === agent.id ? null : agent.id));
                        }}
                        className={
                          isSelected
                            ? isDark
                              ? "relative overflow-hidden rounded-[22px] border border-indigo-300/70 bg-gradient-to-br from-indigo-400/12 via-white/[0.05] to-sky-400/10 p-4 text-left shadow-xl shadow-indigo-950/30 ring-2 ring-indigo-400/20 transition-all duration-200"
                              : "relative overflow-hidden rounded-[22px] border border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-sky-50 p-4 text-left shadow-xl shadow-indigo-100/80 ring-2 ring-indigo-100 transition-all duration-200"
                            : isRestrictedLocked
                              ? isDark
                                ? "relative overflow-hidden rounded-[22px] border border-gray-800 bg-[#151519] p-4 text-left opacity-55 transition"
                                : "relative overflow-hidden rounded-[22px] border border-slate-200/80 bg-white/70 p-4 text-left opacity-60 transition"
                            : isDark
                              ? "relative cursor-pointer overflow-hidden rounded-[22px] border border-gray-700 bg-[#151519] p-4 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-400/50 hover:bg-[#1a1b24] hover:shadow-lg hover:shadow-indigo-950/20"
                              : "relative cursor-pointer overflow-hidden rounded-[22px] border border-slate-200/80 bg-gradient-to-br from-white via-white to-slate-50 p-4 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-200 hover:bg-white hover:shadow-lg hover:shadow-indigo-100/60"
                        }
                      >
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <span className={isSelected ? "h-2.5 w-2.5 rounded-full bg-gradient-to-r from-indigo-500 to-sky-500 shadow-[0_0_14px_rgba(99,102,241,0.75)]" : isRestrictedLocked ? "h-2.5 w-2.5 rounded-full bg-slate-300" : "h-2.5 w-2.5 rounded-full bg-gradient-to-r from-sky-400 to-violet-400 shadow-[0_0_10px_rgba(56,189,248,0.45)]"} />
                            <span className="text-sm font-semibold">{agent.name}</span>
                          </div>
                          {isSelected ? (
                            <span className="rounded-full bg-gradient-to-r from-indigo-500 to-sky-500 px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm">已选 ✓</span>
                          ) : isRestrictedLocked ? (
                            <span className="rounded-full border border-rose-100 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-600">🔒 需授权</span>
                          ) : lockIcon ? (
                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-600">{lockIcon}</span>
                          ) : null}
                        </div>
                        <div className={isDark ? "mb-3 text-xs leading-5 text-gray-400" : "mb-3 text-xs leading-5 text-slate-500"}>{isRestrictedLocked ? `${agent.description} 后台授权后可用。` : agent.description}</div>
                        <div className="flex flex-wrap items-center gap-1">
                          {agent.tags.slice(0, 2).map((tag) => (
                            <span key={tag} className={agentTagClass(tag)}>
                              {tag}
                            </span>
                          ))}
                          <span className={agent.access === "public" ? agentTagClass("公开") : agent.isAuthorized ? agentTagClass("授权") : "rounded-full border border-rose-100 bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-600"}>
                            {agent.access === "public" ? "公开" : agent.isAuthorized ? "已授权" : "需授权"}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
                {visibleAgents.length === 0 && (
                  <div className={isDark ? "mt-2 text-xs text-gray-400" : "mt-2 text-xs text-gray-500"}>未找到匹配智能体</div>
                )}
              </div>
            )}

            <div className={isDark ? "order-3 rounded-3xl border border-white/10 bg-[#11121a]/80 p-3 shadow-inner shadow-black/20" : "order-3 rounded-3xl border border-indigo-100 bg-white/70 p-3 shadow-sm shadow-indigo-100/60"}>
              <div className="flex flex-wrap items-center gap-2">
                {!isRemixMode && !isMediumVideoMode && (
                  <button
                    onClick={handleToggleReferenceImage}
                    className={toolButtonClass(hasReferenceImage)}
                  >
                    {hasReferenceImage ? "参考图已添加" : "上传参考图"}
                  </button>
                )}
                {isRemixMode && (
                  <button
                    onClick={() => remixVideoInputRef.current?.click()}
                    disabled={remixAnalysisLoading || remixReferenceImageLoading}
                    className={`${toolButtonClass(Boolean(remixVideoFile))} disabled:opacity-50`}
                  >
                    {remixVideoFile ? "更换参考视频" : "上传参考视频"}
                  </button>
                )}
                <button
                  onClick={() => setShowPreferences((prev) => !prev)}
                  className={toolButtonClass(showPreferences)}
                >
                  ✦ 生成偏好
                </button>
                {isAgentMode && (
                  <button
                    onClick={() => document.getElementById("agent-picker")?.scrollIntoView({ behavior: "smooth", block: "center" })}
                    className={toolButtonClass(Boolean(selectedAgent))}
                  >
                    {selectedAgent ? selectedAgent.name : "选择智能体"}
                  </button>
                )}
                <div className={isDark ? "rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-medium text-gray-300" : "rounded-full border border-sky-100 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-700 shadow-sm"}>
                  {isMediumVideoMode
                    ? `${mediumVideoSegments * 10}s / Grok / ${ratio === "9:16" ? "竖屏" : "横屏"}`
                    : isImageMode
                      ? `${imageModel === "banana2" ? "Nano Banana2" : "image2"} / ${imageSize} / ${generateCount}张`
                      : `${duration} / ${ratio === "9:16" ? "竖屏" : "横屏"} / ${generateCount}条`}
                </div>
                <div className={isDark ? "ml-auto rounded-full border border-amber-300/20 bg-amber-300/10 px-4 py-2 text-sm font-semibold text-amber-100" : "ml-auto rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700 shadow-sm"}>
                  预计消耗 ¥{formatMoney(estimatedCost)}
                  {!currentChannelEnabled && <span className="ml-2 text-rose-500">通道维护升级中请稍后再试</span>}
                  {imageModelRestrictionMessage && <span className="ml-2 text-rose-500">{imageModelRestrictionMessage}</span>}
                  {isBalanceInsufficient && <span className="ml-2 text-rose-500">余额不足，请充值</span>}
                </div>
                <button
                  onClick={handleGenerate}
                  className={primaryActionClass}
                >
                  {isGenerating ? "生成中..." : "开始生成"}
                </button>
              </div>

              {showPreferences && (
                <div className={isDark ? "mt-3 rounded-3xl border border-indigo-400/20 bg-[#0f1018]/95 p-4 shadow-2xl shadow-black/30" : "mt-3 rounded-3xl border border-indigo-100 bg-white/95 p-4 shadow-xl shadow-indigo-100/70"}>
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">生成偏好</div>
                      <div className={isDark ? "mt-1 text-xs text-gray-400" : "mt-1 text-xs text-gray-500"}>设置会实时影响预计消耗和本次提交参数。</div>
                    </div>
                    {!isImageMode && (
                      <span className={isDark ? "rounded-full border border-sky-400/20 bg-sky-400/10 px-3 py-1 text-xs font-semibold text-sky-200" : "rounded-full border border-sky-100 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700"}>超清1080P</span>
                    )}
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    {isMediumVideoMode ? (
                      <div className="md:col-span-2">
                        <div className={isDark ? "mb-2 text-xs font-medium text-gray-400" : "mb-2 text-xs font-medium text-gray-500"}>目标时长</div>
                        <div className="flex flex-wrap gap-2">
                          {[1, 2, 3, 4, 5, 6].map((segments) => (
                            <button
                              key={segments}
                              onClick={() => setMediumVideoSegments(segments)}
                              className={`rounded-full px-4 py-2 text-sm transition ${pillClass(mediumVideoSegments === segments)}`}
                            >
                              {segments * 10}秒
                            </button>
                          ))}
                        </div>
                        <div className={isDark ? "mt-2 text-xs text-gray-400" : "mt-2 text-xs text-slate-500"}>
                          Grok 中视频会先生成 10 秒视频，再按目标时长逐步扩展，每次扩展约 10 秒。当前先固定一次只生成 1 个中视频任务。
                        </div>
                      </div>
                    ) : !isImageMode && (
                      <div>
                        <div className={isDark ? "mb-2 text-xs font-medium text-gray-400" : "mb-2 text-xs font-medium text-gray-500"}>视频时长</div>
                        <div className="flex flex-wrap gap-2">
                          {["4s", "8s", "12s"].map((item) => (
                            <button
                              key={item}
                              onClick={() => {
                                setDuration(item);
                                if (isRemixMode) setRemixAnalysisResult(null);
                              }}
                              className={`rounded-full px-4 py-2 text-sm transition ${pillClass(duration === item)}`}
                            >
                              {item}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div>
                      <div className={isDark ? "mb-2 text-xs font-medium text-gray-400" : "mb-2 text-xs font-medium text-gray-500"}>{isImageMode ? "图片比例" : "视频比例"}</div>
                      <div className="flex flex-wrap gap-2">
                        {[
                          ...(isImageMode ? [{ label: "1:1方屏", value: "1:1" }] : []),
                          { label: "9:16竖屏", value: "9:16" },
                          { label: "16:9横屏", value: "16:9" },
                        ].map((item) => {
                          const disabled = isImageMode && imageModel === "image2" && ((item.value === "9:16" && imageSize === "2K") || (item.value === "1:1" && imageSize === "4K"));
                          return (
                            <button
                              key={item.value}
                              onClick={() => {
                                if (disabled) {
                                  showToast("image2模型暂不支持该比例/分辨率组合");
                                  return;
                                }
                                setRatio(item.value);
                                if (isRemixMode) setRemixAnalysisResult(null);
                              }}
                              className={`rounded-full px-4 py-2 text-sm transition ${disabled ? "cursor-not-allowed bg-gray-100 text-gray-400 opacity-60" : pillClass(ratio === item.value)}`}
                            >
                              {item.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {isImageMode && (
                      <>
                        <div>
                          <div className={isDark ? "mb-2 text-xs font-medium text-gray-400" : "mb-2 text-xs font-medium text-gray-500"}>图片模型</div>
                          <div className="flex flex-wrap gap-2">
                            {[
                              { label: "image2", value: "image2" },
                              { label: "Nano Banana2", value: "banana2" },
                            ].map((item) => (
                              <button
                                key={item.value}
                                onClick={() => setImageModel(item.value as "image2" | "banana2")}
                                className={`rounded-full px-4 py-2 text-sm transition ${pillClass(imageModel === item.value)}`}
                              >
                                {item.label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <div className={isDark ? "mb-2 text-xs font-medium text-gray-400" : "mb-2 text-xs font-medium text-gray-500"}>分辨率</div>
                          <div className="flex flex-wrap gap-2">
                            {(["1K", "2K", "4K"] as const).map((item) => {
                              const disabled = imageModel === "image2" && ((item === "2K" && ratio === "9:16") || (item === "4K" && ratio === "1:1"));
                              return (
                                <button
                                  key={item}
                                  onClick={() => {
                                    if (disabled) {
                                      showToast("image2模型暂不支持该比例/分辨率组合");
                                      return;
                                    }
                                    setImageSize(item);
                                  }}
                                  className={`rounded-full px-4 py-2 text-sm transition ${disabled ? "cursor-not-allowed bg-gray-100 text-gray-400 opacity-60" : pillClass(imageSize === item)}`}
                                >
                                  {item}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </>
                    )}

                    {!isMediumVideoMode && (
                      <div>
                        <div className={isDark ? "mb-2 text-xs font-medium text-gray-400" : "mb-2 text-xs font-medium text-gray-500"}>{isImageMode ? "生成张数" : "生成条数"}</div>
                        <select
                          value={generateCount}
                          onChange={(e) => setGenerateCount(Number(e.target.value))}
                          className={isDark ? "w-full rounded-full border border-gray-700 bg-gray-800 px-4 py-2 text-sm text-gray-100 outline-none" : "w-full rounded-full border border-gray-200 bg-gray-50 px-4 py-2 text-sm text-gray-700 outline-none"}
                        >
                          {Array.from({ length: 10 }, (_, i) => i + 1).map((count) => (
                            <option key={count} value={count}>
                              {count}{isImageMode ? "张" : "条"}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {!isMediumVideoMode && (
                      <div>
                        <div className={isDark ? "mb-2 text-xs font-medium text-gray-400" : "mb-2 text-xs font-medium text-gray-500"}>参考图状态</div>
                        <div className={isDark ? "rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-gray-300" : "rounded-2xl border border-indigo-100 bg-indigo-50/50 px-4 py-3 text-sm text-slate-600"}>
                          {hasReferenceImage ? `已添加${referenceImageName ? `：${referenceImageName}` : ""}` : "未添加参考图"}
                        </div>
                      </div>
                    )}

                    {!isImageMode && (
                      <div className="md:col-span-2">
                        <button
                          onClick={() => setTimingEnabled((prev) => !prev)}
                          className={`rounded-full px-4 py-2 text-sm transition ${pillClass(timingEnabled)}`}
                        >
                          {timingEnabled ? "已开启定时" : "定时生成"}
                        </button>
                      </div>
                    )}
                  </div>

                  {timingEnabled && (
                    <div className={isDark ? "mt-4 rounded-2xl border border-violet-400/20 bg-violet-400/[0.04] p-4" : "mt-4 rounded-2xl border border-violet-100 bg-violet-50/60 p-4"}>
                      <div className="grid gap-3 md:grid-cols-3">
                        <div className="space-y-1">
                          <div className={isDark ? "text-xs text-gray-400" : "text-xs text-gray-500"}>定时日期</div>
                          <div onClick={() => timingDateInputRef.current?.showPicker ? timingDateInputRef.current.showPicker() : timingDateInputRef.current?.focus()}>
                            <input ref={timingDateInputRef} type="date" value={timingDate} onChange={(e) => setTimingDate(e.target.value)} className={isDark ? "w-full cursor-pointer rounded-full border border-gray-700 bg-gray-800 px-4 py-2 text-sm text-gray-100 outline-none" : "w-full cursor-pointer rounded-full border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 outline-none"} />
                          </div>
                        </div>
                        <div className="space-y-1">
                          <div className={isDark ? "text-xs text-gray-400" : "text-xs text-gray-500"}>定时时间</div>
                          <div onClick={() => timingTimeInputRef.current?.showPicker ? timingTimeInputRef.current.showPicker() : timingTimeInputRef.current?.focus()}>
                            <input ref={timingTimeInputRef} type="time" value={timingTime} onChange={(e) => setTimingTime(e.target.value)} className={isDark ? "w-full cursor-pointer rounded-full border border-gray-700 bg-gray-800 px-4 py-2 text-sm text-gray-100 outline-none" : "w-full cursor-pointer rounded-full border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 outline-none"} />
                          </div>
                        </div>
                        <div className="flex items-end">
                          <button onClick={handleCreateScheduledTask} className={primaryActionClass}>
                            确认创建定时任务
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {(isGenerating || videoRecords.length > 0) && (
          <div className={`mt-8 w-full max-w-5xl p-4 md:p-5 ${glassPanelClass}`}>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-sky-500 text-sm font-semibold text-white shadow-md shadow-indigo-200/60">
                    库
                  </div>
                  <div>
                    <div className="text-base font-semibold">作品管理区</div>
                    <div className={isDark ? "mt-0.5 text-xs text-gray-400" : "mt-0.5 text-xs text-slate-500"}>
                      生成结果、占位状态和历史作品集中管理
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className={softChipClass}>当前显示 {pagedVisibleResults.length}</span>
                  <span className={softChipClass}>筛选后 {visibleResults.length}</span>
                  <span className={softChipClass}>总计 {videoRecords.length}</span>
                  <span className={softChipClass}>收藏 {visibleFavoriteCount}</span>
                  <span className={softChipClass}>模式：{modeLabel}</span>
                  {!isMediumVideoMode && <span className={softChipClass}>参考图：{hasReferenceImage ? "已添加" : "未添加"}</span>}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={resultSearch}
                  onChange={(e) => setResultSearch(e.target.value)}
                  placeholder="搜索作品关键词"
                  className={inputPillClass}
                />
                <select
                  value={resultSort}
                  onChange={(e) => setResultSort(e.target.value as "latest" | "earliest" | "successOnly" | "failedOnly")}
                  className={inputPillClass}
                >
                  <option value="latest">最新优先</option>
                  <option value="earliest">最早优先</option>
                  <option value="successOnly">仅成功</option>
                  <option value="failedOnly">仅失败</option>
                </select>
                <button
                  onClick={() => setResultFilter("all")}
                  className={filterChipClass(resultFilter === "all")}
                >
                  全部
                </button>

                <button
                  onClick={() => setResultFilter("favorites")}
                  className={resultFilter === "favorites" ? "rounded-full border border-amber-200 bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-800 shadow-sm shadow-amber-100 transition hover:-translate-y-0.5" : smallSecondaryButtonClass}
                >
                  已收藏
                </button>

                {videos.length > 0 && (
                  <button onClick={handleClearResults} className={dangerButtonClass}>
                    清空记录
                  </button>
                )}
              </div>
            </div>
            {isGenerating && (
              <div className={isDark ? "mb-3 rounded-2xl border border-violet-400/20 bg-violet-400/[0.06] p-4" : "mb-3 rounded-2xl border border-violet-100 bg-violet-50/70 p-4 shadow-sm shadow-violet-100/60"}>
                <div className={isDark ? "mb-2 text-sm text-gray-300" : "mb-2 text-sm text-gray-600"}>
                  正在生成，请稍候... 当前进度 {generateProgress}%
                </div>
                <div className={isDark ? "h-2 overflow-hidden rounded-full bg-gray-800" : "h-2 overflow-hidden rounded-full bg-gray-200"}>
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-violet-500 to-sky-500 transition-all duration-300"
                    style={{ width: `${generateProgress}%` }}
                  />
                </div>
              </div>
            )}

            {pagedVisibleResults.length === 0 ? (
              <div className={isDark ? "rounded-2xl border border-white/10 bg-white/[0.05] p-4 text-sm text-gray-400" : "rounded-2xl border border-white/70 bg-white/75 p-4 text-sm text-slate-500 shadow-sm"}>
                {resultSearchKeyword
                  ? "没有匹配到相关记录"
                  : resultFilter === "favorites"
                    ? "暂无收藏记录"
                    : resultSort === "failedOnly"
                      ? "暂无失败任务"
                      : "暂无任务记录"}
              </div>
            ) : (
              <div className="space-y-4">
                {pagedVisibleResults.map(({ item, id, taskId, mediaType, title, prompt: fromTaskPrompt, isFavorite, status, isLatestDone, cost, seconds, duration: videoDuration, upscaleStatus, upscaleErrorMessage, hasReferenceImage: taskHasRef, referenceImageName, referenceImageThumbData: taskRefThumbData, coverData, videoUrl, ratio: videoRatio, size: videoSize, imageSize: resultImageSize, imageModel, displayModel, imageModelLabel, apiModel, kind, scheduledAt, createdAt, taskStatus, agentName, isPlaceholder, mediumVideo, isFinalVideoLikelyComplete, segmentIndex, totalSegments, segmentTitle }) => (
              <div
                key={id}
                className={`relative p-3 text-sm ${surfaceCardClass}`}
              >
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div className="flex items-start gap-3">
                    <div className={`relative group shrink-0 overflow-hidden rounded-2xl ${videoRatio === "9:16" ? "h-20 w-14" : videoRatio === "1:1" ? "h-16 w-16" : "h-16 w-28"}`}>
                      {renderVideoCover({ id, mediaType, coverData, videoUrl, ratio: videoRatio, seconds, duration: videoDuration, isPlaceholder, status })}
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (isPlaceholder) {
                            showToast(status === "waiting" ? "任务待执行，暂不可预览" : "作品生成中，稍后可预览");
                            return;
                          }
                          setPreviewVideo({
                            id,
                            item,
                            taskId,
                            title,
                            mediaType,
                            videoUrl,
                            status,
                            ratio: videoRatio,
                            size: videoSize,
                            seconds,
                            duration: videoDuration,
                            cost,
                            imageSize: resultImageSize,
                            imageModel,
                            displayModel,
                            imageModelLabel,
                            apiModel,
                            upscaleStatus,
                            upscaleErrorMessage,
                            hasReferenceImage: taskHasRef,
                            referenceImageName,
                            mediumVideo,
                            isFinalVideoLikelyComplete,
                            segmentIndex,
                            totalSegments,
                            segmentTitle,
                          });
                        }}
                        className="absolute inset-0 z-30 flex items-center justify-center play-preview-btn"
                        aria-label={mediaType === "image" ? "预览图片" : "预览视频"}
                      >
                        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white shadow-lg transition-transform duration-200 group-hover:scale-110">
                          ▶
                        </span>
                      </button>
                    </div>

                    <div className="min-w-0 space-y-2.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={softChipClass}>
                          {makeTaskId(taskId)}
                        </span>
                        <span className={softChipClass}>
                          消耗：¥{formatMoney(cost)}
                        </span>
                        <span className={getStatusClass(status)}>
                          {statusLabelMap[status]}
                        </span>
                        {mediaType === "video" && (
                          <span className={upscaleBadgeClass(upscaleStatus)}>
                            {getUpscaleStatusLabel(upscaleStatus)}
                          </span>
                        )}
                        {mediaType === "video" && upscaleStatus === "failed" && (
                          <button
                            onClick={() => handleRetryUpscale(id)}
                            title={upscaleErrorMessage || "仅重试超分"}
                            className="rounded-full bg-emerald-500 px-2 py-1 text-[11px] font-medium text-white transition hover:brightness-110"
                          >
                            ↻
                          </button>
                        )}
                        {isLatestDone && <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 shadow-sm">最新完成</span>}
                        {mediumVideo && <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-700 shadow-sm">中视频</span>}
                        {mediumVideo && <span className={softChipClass}>完整性：{isFinalVideoLikelyComplete ? "已确认" : "待验证"}</span>}
                        {mediumVideo && segmentIndex && totalSegments && <span className={softChipClass}>片段 {segmentIndex}/{totalSegments}</span>}
                      </div>

                      {(() => {
                        const cleanedText = item
                          .replace(/[｜|]\s*参考图已启用(?:（[^）]*）)?/g, "")
                          .replace(/[｜|]\s*智能体：[^｜|]+/g, "")
                          .replace(/[｜|]\s*风格：[^｜|]+/g, "")
                          .trim();
                        const splitToken = "｜灵感参考：";
                        const splitIndex = cleanedText.indexOf(splitToken);
                        const titleText = splitIndex >= 0 ? cleanedText.slice(0, splitIndex).trim() : cleanedText;
                        const singleLineTitle = truncateTitleByHanWidth(titleText, 25);
                        const inspirationRaw = splitIndex >= 0 ? cleanedText.slice(splitIndex + splitToken.length).trim() : "";
                        const inspirationText = inspirationRaw
                          .split("｜")
                          .map((part) => part.trim())
                          .filter(Boolean)
                          .join(" · ");
                        return (
                          <div className="space-y-1">
                            <p
                              className={isDark ? "text-sm font-semibold leading-6 text-gray-100" : "text-sm font-semibold leading-6 text-gray-800"}
                              style={{
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {mediumVideo ? truncateTitleByHanWidth(segmentTitle || title || "Grok 中视频", 25) : singleLineTitle}
                            </p>
                            {inspirationText ? (
                              <p className={isDark ? "truncate text-xs leading-tight text-gray-400" : "truncate text-xs leading-tight text-gray-500"}>
                                灵感参考：
                                {inspirationText.length > 30 ? `${inspirationText.slice(0, 30)}...` : inspirationText}
                              </p>
                            ) : null}
                          </div>
                        );
                      })()}

                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={softChipClass}>
                          {mediaType === "image" ? `分辨率：${getImageSizeLabel(resultImageSize || videoSize)}` : `时长：${getDurationLabel(seconds, videoDuration)}`}
                        </span>
                        {mediaType === "image" && (
                          <span className={softChipClass}>
                            模型：{formatImageModelLabel({ mediaType, imageModel, displayModel, imageModelLabel, apiModel })}
                          </span>
                        )}
                        <span className={softChipClass}>
                          比例：{getRatioLabel(videoRatio, videoSize)}
                        </span>
                        <span className={softChipClass}>
                          发布时间：{formatTaskPublishTime(createdAt)}
                        </span>
                        <span
                          title={`来源任务：${fromTaskPrompt}`}
                          className={`inline-block max-w-[180px] truncate whitespace-nowrap ${softChipClass}`}
                        >
                          来源任务：{truncateSourceTaskText(fromTaskPrompt)}
                        </span>
                        <span className={softChipClass}>
                          类型：{kind === "schedule" ? "定时任务" : "普通任务"}
                        </span>
                        {agentName && (
                          <span className={softChipClass}>
                            智能体：{agentName}
                          </span>
                        )}
                        {scheduledAt && (
                          <span className={softChipClass}>
                            {taskStatus === "waiting" ? `预计执行：${new Date(scheduledAt).toLocaleString()}` : `执行时间：${new Date(scheduledAt).toLocaleString()}`}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex w-full max-w-[360px] flex-col items-end gap-2.5 md:w-[360px]">
                    <div className={isDark ? "w-full rounded-2xl border border-white/10 bg-black/15 p-2 shadow-inner shadow-black/15" : "w-full rounded-2xl border border-indigo-100 bg-indigo-50/45 p-2 shadow-inner shadow-indigo-100/50"}>
                    <div className="grid w-full grid-cols-3 gap-2.5">
                      <button
                        onClick={() => {
                          setPreviewVideo({
                            id,
                            item,
                            taskId,
                            title,
                            mediaType,
                            videoUrl,
                            status,
                            ratio: videoRatio,
                            size: videoSize,
                            seconds,
                            duration: videoDuration,
                            cost,
                            imageSize: resultImageSize,
                            imageModel,
                            displayModel,
                            imageModelLabel,
                            apiModel,
                            upscaleStatus,
                            upscaleErrorMessage,
                            hasReferenceImage: taskHasRef,
                            referenceImageName,
                            mediumVideo,
                            segmentIndex,
                            totalSegments,
                            segmentTitle,
                          });
                        }}
                        className={`w-full whitespace-nowrap text-center ${isPlaceholder ? "cursor-not-allowed rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-400" : smallSecondaryButtonClass}`}
                      >
                        预览
                      </button>

                      <button
                        onClick={() => handleRegenerate(taskId)}
                        className={`w-full whitespace-nowrap text-center ${smallSecondaryButtonClass}`}
                      >
                        重新生成
                      </button>

                      <button
                        onClick={() => {
                          if (isPlaceholder) {
                            showToast("作品生成完成后可下载");
                            return;
                          }
                          void handleDownload({ id, item, title, taskId, mediaType, videoUrl, status });
                        }}
                        className={`w-full whitespace-nowrap text-center ${isPlaceholder ? "cursor-not-allowed rounded-full bg-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-400" : primaryMiniButtonClass}`}
                      >
                        下载
                      </button>

                      <button
                        onClick={() => handleCopy(item, id)}
                        className={`w-full whitespace-nowrap text-center ${smallSecondaryButtonClass}`}
                      >
                        {copiedTaskId === id ? "已复制✓" : "复制文案"}
                      </button>

                      <button
                        onClick={() => {
                          if (isPlaceholder) {
                            showToast("作品生成完成后可收藏");
                            return;
                          }
                          handleToggleFavorite(id);
                        }}
                        className={
                          isFavorite
                            ? "w-full whitespace-nowrap rounded-full border border-amber-200 bg-amber-100 px-3 py-1.5 text-center text-xs font-semibold text-amber-800 shadow-sm transition hover:-translate-y-0.5"
                            : `w-full whitespace-nowrap text-center ${smallSecondaryButtonClass}`
                        }
                      >
                        {isFavorite ? "已收藏" : "收藏"}
                      </button>

                      <button
                        onClick={() => {
                          if (isPlaceholder) {
                            handleDeleteTask(taskId);
                            return;
                          }
                          handleDeleteResult(id);
                        }}
                        className={`w-full whitespace-nowrap text-center ${dangerButtonClass}`}
                      >
                        删除
                      </button>
                    </div>
                    </div>

                    {kind === "schedule" && taskStatus === "waiting" && (
                      <button
                        onClick={() => handleCancelScheduledTask(taskId)}
                        className={dangerButtonClass}
                      >
                        取消定时
                      </button>
                    )}

                    {taskHasRef && taskRefThumbData && (
                      <button
                        type="button"
                        onClick={() => {
                          const normalizedPreview = normalizeReferenceImageSrc(taskRefThumbData);
                          setReferencePreviewTitle(referenceImageName || "参考图预览");
                          setReferencePreviewData(normalizedPreview);
                          setReferencePreviewOpen(true);
                        }}
                        className={
                          isDark
                            ? "overflow-hidden rounded-xl border border-gray-700/70 bg-[#17171a]/85 shadow-sm transition duration-200 hover:scale-[1.03] hover:brightness-110 hover:shadow-md"
                            : "overflow-hidden rounded-xl border border-gray-200/80 bg-white/90 shadow-sm transition duration-200 hover:scale-[1.03] hover:brightness-95 hover:shadow-md"
                        }
                      >
                        {(() => {
                          const finalSrc = normalizeReferenceImageSrc(taskRefThumbData);
                          return (
                        <img
                          src={finalSrc ?? ""}
                          alt={referenceImageName || "参考图缩略图"}
                          className="h-9 w-9 object-cover object-center"
                        />
                          );
                        })()}
                      </button>
                    )}
                  </div>
                </div>
              </div>
                ))}
              </div>
            )}
            {visibleResults.length > RESULT_PAGE_SIZE && (
              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  onClick={() => setResultPage((prev) => Math.max(1, prev - 1))}
                  disabled={resultPage <= 1}
                  className={`${smallSecondaryButtonClass} disabled:cursor-not-allowed disabled:opacity-40`}
                >
                  上一页
                </button>
                <span className={softChipClass}>
                  第 {resultPage} / {resultTotalPages} 页 · 共 {visibleResults.length} 个作品
                </span>
                <button
                  onClick={() => setResultPage((prev) => Math.min(resultTotalPages, prev + 1))}
                  disabled={resultPage >= resultTotalPages}
                  className={`${smallSecondaryButtonClass} disabled:cursor-not-allowed disabled:opacity-40`}
                >
                  下一页
                </button>
              </div>
            )}
          </div>
        )}

        {isTaskDrawerOpen && (
          <div
            className="fixed inset-0 z-40 flex justify-end bg-slate-950/50 backdrop-blur-sm"
            onClick={() => setIsTaskDrawerOpen(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className={
                isDark
                  ? "flex h-full w-full max-w-xl flex-col overflow-hidden border-l border-white/10 bg-[#0d0e16]/90 p-4 shadow-[0_30px_90px_rgba(0,0,0,0.5)] backdrop-blur-xl transition-all duration-300"
                  : "flex h-full w-full max-w-xl flex-col overflow-hidden border-l border-white/70 bg-white/90 p-4 shadow-[0_30px_90px_rgba(79,70,229,0.18)] backdrop-blur-xl transition-all duration-300"
              }
            >
              <div className="mb-3 shrink-0 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-sky-500 text-sm font-semibold text-white shadow-md shadow-indigo-200/60">
                      记
                    </div>
                    <div>
                      <div className="text-base font-semibold">任务记录</div>
                      <div className={isDark ? "mt-0.5 text-xs text-gray-400" : "mt-0.5 text-xs text-slate-500"}>
                        共 {tasks.length} 条任务，收藏 {favorites.length} 条
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setIsTaskDrawerOpen(false)}
                    className={smallSecondaryButtonClass}
                  >
                    关闭
                  </button>
                </div>

                <div className={isDark ? "rounded-3xl border border-white/10 bg-white/[0.045] p-3 shadow-inner shadow-black/10" : "rounded-3xl border border-white/80 bg-white/70 p-3 shadow-inner shadow-indigo-100/70"}>
                  <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
                    <div className={isDark ? "rounded-2xl border border-indigo-300/15 bg-indigo-300/10 px-2.5 py-2" : "rounded-2xl border border-indigo-100 bg-indigo-50/80 px-2.5 py-2 shadow-sm"}>
                      <div className={isDark ? "text-[11px] text-gray-400" : "text-[11px] text-gray-500"}>今日生成</div>
                      <div className="mt-0.5 text-lg font-semibold tracking-wide">{todayGeneratedCount}</div>
                    </div>
                    <div className={isDark ? "rounded-2xl border border-sky-300/15 bg-sky-300/10 px-2.5 py-2" : "rounded-2xl border border-sky-100 bg-sky-50/80 px-2.5 py-2 shadow-sm"}>
                      <div className={isDark ? "text-[11px] text-gray-400" : "text-[11px] text-gray-500"}>累计生成</div>
                      <div className="mt-0.5 text-lg font-semibold tracking-wide">{totalGeneratedCount}</div>
                    </div>
                    <div className={isDark ? "rounded-2xl border border-amber-300/15 bg-amber-300/10 px-2.5 py-2" : "rounded-2xl border border-amber-100 bg-amber-50/80 px-2.5 py-2 shadow-sm"}>
                      <div className={isDark ? "text-[11px] text-gray-400" : "text-[11px] text-gray-500"}>已收藏</div>
                      <div className="mt-0.5 text-lg font-semibold tracking-wide">{favorites.length}</div>
                    </div>
                    <div className={isDark ? "rounded-2xl border border-violet-300/15 bg-violet-300/10 px-2.5 py-2" : "rounded-2xl border border-violet-100 bg-violet-50/80 px-2.5 py-2 shadow-sm"}>
                      <div className={isDark ? "text-[11px] text-gray-400" : "text-[11px] text-gray-500"}>累计消耗</div>
                      <div className="mt-0.5 text-lg font-semibold tracking-wide">¥{totalCost}</div>
                    </div>
                    <div className={isDark ? "rounded-2xl border border-emerald-300/15 bg-emerald-300/10 px-2.5 py-2" : "rounded-2xl border border-emerald-100 bg-emerald-50/80 px-2.5 py-2 shadow-sm"}>
                      <div className={isDark ? "text-[11px] text-gray-400" : "text-[11px] text-gray-500"}>成功任务</div>
                      <div className="mt-0.5 text-lg font-semibold tracking-wide">{successTaskCount}</div>
                    </div>
                    <div className={isDark ? "rounded-2xl border border-rose-300/15 bg-rose-300/10 px-2.5 py-2" : "rounded-2xl border border-rose-100 bg-rose-50/80 px-2.5 py-2 shadow-sm"}>
                      <div className={isDark ? "text-[11px] text-gray-400" : "text-[11px] text-gray-500"}>失败任务</div>
                      <div className="mt-0.5 text-lg font-semibold tracking-wide">{failedTaskCount}</div>
                    </div>
                    <div className={isDark ? "rounded-2xl border border-slate-300/15 bg-slate-300/10 px-2.5 py-2" : "rounded-2xl border border-slate-200 bg-slate-50/80 px-2.5 py-2 shadow-sm"}>
                      <div className={isDark ? "text-[11px] text-gray-400" : "text-[11px] text-gray-500"}>定时任务</div>
                      <div className="mt-0.5 text-lg font-semibold tracking-wide">{scheduledTaskCount}</div>
                    </div>
                    <div className={isDark ? "rounded-2xl border border-cyan-300/15 bg-cyan-300/10 px-2.5 py-2" : "rounded-2xl border border-cyan-100 bg-cyan-50/80 px-2.5 py-2 shadow-sm"}>
                      <div className={isDark ? "text-[11px] text-gray-400" : "text-[11px] text-gray-500"}>成功率</div>
                      <div className="mt-0.5 text-lg font-semibold tracking-wide">{successRate}</div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={taskSearch}
                    onChange={(e) => setTaskSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        showToast(taskSearch.trim() ? `正在搜索：${taskSearch.trim()}` : "已显示全部任务");
                      }
                    }}
                    placeholder="搜索任务内容"
                    className={`flex-1 ${inputPillClass}`}
                  />

                  <button
                    onClick={() => {
                      setTaskSearch("");
                      showToast("已显示全部任务");
                    }}
                    className={smallSecondaryButtonClass}
                  >
                    清空
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => setTaskDrawerFilter("all")}
                    className={filterChipClass(taskDrawerFilter === "all")}
                  >
                    全部
                  </button>
                  <button
                    onClick={() => setTaskDrawerFilter("favorites")}
                    className={taskDrawerFilter === "favorites" ? "rounded-full border border-amber-200 bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-800 shadow-sm" : smallSecondaryButtonClass}
                  >
                    仅收藏
                  </button>
                  <button
                    onClick={() => setTaskDrawerFilter("generating")}
                    className={taskDrawerFilter === "generating" ? "rounded-full border border-violet-200 bg-violet-100 px-3 py-1.5 text-xs font-semibold text-violet-800 shadow-sm" : smallSecondaryButtonClass}
                  >
                    生成中
                  </button>
                  <button
                    onClick={() => setTaskDrawerFilter("success")}
                    className={taskDrawerFilter === "success" ? "rounded-full border border-emerald-200 bg-emerald-100 px-3 py-1.5 text-xs font-semibold text-emerald-800 shadow-sm" : smallSecondaryButtonClass}
                  >
                    已完成
                  </button>
                  <button
                    onClick={() => setTaskDrawerFilter("failed")}
                    className={taskDrawerFilter === "failed" ? "rounded-full border border-rose-200 bg-rose-100 px-3 py-1.5 text-xs font-semibold text-rose-800 shadow-sm" : smallSecondaryButtonClass}
                  >
                    失败
                  </button>
                  <button
                    onClick={() => setTaskDrawerFilter("waiting")}
                    className={taskDrawerFilter === "waiting" ? "rounded-full border border-slate-200 bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm" : smallSecondaryButtonClass}
                  >
                    定时中
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className={softChipClass}>
                    已选 {selectedTaskIds.length} 条
                  </span>
                  <button
                    onClick={handleBatchDelete}
                    className={dangerButtonClass}
                  >
                    批量删除
                  </button>
                  <button
                    onClick={() => handleBatchFavorite(true)}
                    className={smallSecondaryButtonClass}
                  >
                    批量收藏
                  </button>
                  <button
                    onClick={() => handleBatchFavorite(false)}
                    className={smallSecondaryButtonClass}
                  >
                    批量取消收藏
                  </button>
                </div>
              </div>

              <div className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 pb-3">
                {tasks.length === 0 ? (
                  <div className={isDark ? "text-sm text-gray-400" : "text-sm text-gray-500"}>
                    暂无任务记录
                  </div>
                ) : filteredTaskRecords.length === 0 ? (
                  <div className={isDark ? "text-sm text-gray-400" : "text-sm text-gray-500"}>
                    {taskSearchKeyword
                      ? "没有匹配到搜索结果"
                      : taskDrawerFilter === "favorites"
                        ? "暂无收藏记录"
                        : taskDrawerFilter === "failed"
                          ? "暂无失败任务"
                          : taskDrawerFilter === "waiting"
                            ? "暂无定时任务"
                            : "暂无任务记录"}
                  </div>
                ) : (
                  pagedDrawerRecords.map(({ item, id, isFavorite, status, isLatestDone, cost, hasReferenceImage: taskHasRef, referenceImageName, referenceImageThumbData: taskRefThumbData, kind, scheduledAt, createdAt, totalVideos, successVideos, failedVideos, agentName, agentAccess, mode: recordMode, mediumVideoSegments: recordMediumSegments }) => (
                    <div key={id} className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={selectedTaskIds.includes(id)}
                        onChange={() => handleToggleSelectedTask(id)}
                        className="mt-3 h-4 w-4 rounded border-indigo-200 accent-indigo-500"
                      />
                      <div
                        onClick={() => setTaskDetailId(id)}
                        className={`flex-1 cursor-pointer p-3 ${surfaceCardClass}`}
                      >
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={softChipClass}>
                            {makeTaskId(id)}
                          </span>
                          <span className={isFavorite ? "rounded-full border border-amber-200 bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800" : softChipClass}>
                            {isFavorite ? "已收藏" : "未收藏"}
                          </span>
                          <span className={getStatusClass(status)}>
                            {statusLabelMap[status]}
                          </span>
                          <span className={softChipClass}>
                            {kind === "schedule" ? "定时任务" : "普通任务"}
                          </span>
                          <span className={softChipClass}>
                            消耗 ¥{formatMoney(cost)}
                          </span>
                          <span className={softChipClass}>
                            作品：{totalVideos}（成功 {successVideos} / 失败 {failedVideos}）
                          </span>
                          {recordMode === "medium_video" && (
                            <>
                              <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700">中视频</span>
                              <span className={softChipClass}>模型：Grok</span>
                              <span className={softChipClass}>目标时长：{(recordMediumSegments ?? 1) * 10}s</span>
                              <span className={softChipClass}>扩展次数：{Math.max(0, (recordMediumSegments ?? 1) - 1)}</span>
                            </>
                          )}
                          {agentName && (
                            <span className={softChipClass}>
                              智能体：{agentName}
                            </span>
                          )}
                          {agentName && (
                            <span className={softChipClass}>
                              权限：{agentAccess === "restricted" ? "授权智能体" : "公开可用"}
                            </span>
                          )}
                          {recordMode !== "medium_video" && (
                            <span className={softChipClass}>
                              参考图：{taskHasRef ? "已添加" : "未添加"}
                            </span>
                          )}
                          {isLatestDone && <span className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 shadow-sm">最新完成</span>}
                        </div>
                        <div className="flex items-start gap-2">
                          <div
                            className="flex-1 text-xs leading-5"
                            style={{
                              display: "-webkit-box",
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical",
                              overflow: "hidden",
                            }}
                          >
                            {item}
                          </div>
                          {taskHasRef && renderReferencePreview(referenceImageName, true, taskRefThumbData)}
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={softChipClass}>
                              发布时间：{formatTaskPublishTime(createdAt)}
                            </span>
                            {scheduledAt && (
                              <span className={softChipClass}>
                                {status === "waiting" ? `预计执行：${new Date(scheduledAt).toLocaleString()}` : `执行：${formatTaskPublishTime(scheduledAt)}`}
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenPreviewFromDrawer(id);
                              }}
                              className={smallSecondaryButtonClass}
                            >
                              预览
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleCopy(item, id);
                              }}
                              className={smallSecondaryButtonClass}
                            >
                              {copiedTaskId === id ? "已复制✓" : "复制"}
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleTaskFavorite(id);
                              }}
                              className={
                                isFavorite
                                  ? "rounded-full border border-amber-200 bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-800"
                                  : smallSecondaryButtonClass
                              }
                            >
                              {isFavorite ? "取消收藏" : "收藏"}
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteTask(id);
                              }}
                              className={dangerButtonClass}
                            >
                              删除
                            </button>
                            {kind === "schedule" && status === "waiting" && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCancelScheduledTask(id);
                                }}
                                className={dangerButtonClass}
                              >
                                取消定时
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                    </div>
                  ))
                )}
              </div>
              <div className={isDark ? "shrink-0 border-t border-white/10 bg-[#0d0e16]/80 pb-[max(8px,env(safe-area-inset-bottom))] pt-3 backdrop-blur" : "shrink-0 border-t border-white/70 bg-white/75 pb-[max(8px,env(safe-area-inset-bottom))] pt-3 backdrop-blur"}>
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => setDrawerPage((prev) => Math.max(1, prev - 1))}
                    disabled={drawerPage <= 1}
                    className={`${smallSecondaryButtonClass} disabled:cursor-not-allowed disabled:opacity-40`}
                  >
                    上一页
                  </button>
                  <span className={softChipClass}>
                    第 {Math.min(drawerPage, drawerTotalPages)} / {drawerTotalPages} 页
                  </span>
                  <button
                    onClick={() => setDrawerPage((prev) => Math.min(drawerTotalPages, prev + 1))}
                    disabled={drawerPage >= drawerTotalPages}
                    className={`${smallSecondaryButtonClass} disabled:cursor-not-allowed disabled:opacity-40`}
                  >
                    下一页
                  </button>
                </div>
              </div>
              </div>
            </div>
          </div>
        )}
        {previewVideo && (
          <div
            className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/55 px-4 backdrop-blur-sm"
            onClick={() => setPreviewVideo(null)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className={
                isDark
                  ? `w-full ${previewVideo.mediaType === "image" ? "max-h-[90vh] max-w-[min(92vw,980px)] overflow-hidden p-5" : "max-w-xl p-6"} rounded-[28px] border border-white/10 bg-[#10111a]/92 shadow-[0_30px_100px_rgba(0,0,0,0.55)] backdrop-blur-xl`
                  : `w-full ${previewVideo.mediaType === "image" ? "max-h-[90vh] max-w-[min(92vw,980px)] overflow-hidden p-5" : "max-w-xl p-6"} rounded-[28px] border border-white/75 bg-white/92 shadow-[0_30px_100px_rgba(79,70,229,0.22)] backdrop-blur-xl`
              }
            >
              {!previewVideo ? (
                <div className="space-y-4">
                  <div className="text-lg font-semibold">{previewVideo.mediaType === "image" ? "图片预览" : "视频预览"}</div>
                  <div className={isDark ? "text-sm text-gray-300" : "text-sm text-gray-600"}>未找到对应视频数据，请稍后重试。</div>
                  <div className="flex justify-end">
                    <button
                      onClick={() => setPreviewVideo(null)}
                      className={smallSecondaryButtonClass}
                    >
                      关闭
                    </button>
                  </div>
                </div>
              ) : (
                <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-sky-500 text-sm font-semibold text-white shadow-md shadow-indigo-200/60">
                    {previewVideo.mediaType === "image" ? "图" : "播"}
                  </div>
                  <div className="mr-1 text-lg font-semibold">{previewVideo.mediaType === "image" ? "图片预览" : "视频预览"}</div>
                  <span className={softChipClass}>
                    {makeTaskId(previewVideo.taskId)}
                  </span>
                  <span className={getStatusClass(previewVideo.status as TaskStatus)}>
                    {statusLabelMap[previewVideo.status as TaskStatus]}
                  </span>
                  {previewVideo.mediaType !== "image" && (
                    <span className={upscaleBadgeClass(previewVideo.upscaleStatus)}>
                      {getUpscaleStatusLabel(previewVideo.upscaleStatus)}
                    </span>
                  )}
                  {previewVideo.mediumVideo && (
                    <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-700 shadow-sm">
                      Grok 中视频
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setPreviewVideo(null)}
                  className={smallSecondaryButtonClass}
                >
                  关闭
                </button>
              </div>

              <div className={previewVideo.mediaType === "image" ? "max-h-[calc(90vh-5.5rem)] space-y-4 overflow-y-auto pr-1" : "space-y-4"}>
                {previewVideo.mediaType === "image" && (
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <span className={softChipClass}>
                      缩放：{Math.round(imagePreviewScale * 100)}%
                    </span>
                    <button
                      onClick={() => setImagePreviewScale((prev) => Math.min(3, Number((prev + 0.25).toFixed(2))))}
                      className={smallSecondaryButtonClass}
                    >
                      放大
                    </button>
                    <button
                      onClick={() => setImagePreviewScale((prev) => Math.max(0.5, Number((prev - 0.25).toFixed(2))))}
                      className={smallSecondaryButtonClass}
                    >
                      缩小
                    </button>
                    <button
                      onClick={() => setImagePreviewScale(1)}
                      className={smallSecondaryButtonClass}
                    >
                      重置
                    </button>
                    <span className={isDark ? "mx-1 h-5 w-px bg-gray-700" : "mx-1 h-5 w-px bg-gray-200"} />
                    <button
                      onClick={() => void handleDownload(previewVideo)}
                      className={primaryMiniButtonClass}
                    >
                      下载
                    </button>
                    <button
                      onClick={() => handleCopy(previewVideo.item)}
                      className={smallSecondaryButtonClass}
                    >
                      {isPreviewCopied ? "已复制✓" : "复制文案"}
                    </button>
                  </div>
                )}
                <div
                  className={
                    previewVideo.mediaType === "image"
                      ? isDark
                        ? "relative max-h-[60vh] overflow-auto rounded-2xl border border-white/10 bg-[#171822] shadow-inner shadow-black/20"
                        : "relative max-h-[60vh] overflow-auto rounded-2xl border border-indigo-100 bg-[linear-gradient(45deg,rgba(226,232,240,.55)_25%,transparent_25%,transparent_75%,rgba(226,232,240,.55)_75%),linear-gradient(45deg,rgba(226,232,240,.55)_25%,transparent_25%,transparent_75%,rgba(226,232,240,.55)_75%)] bg-[length:20px_20px] bg-[position:0_0,10px_10px] shadow-inner shadow-indigo-100/60"
                      : isDark
                        ? "relative h-60 overflow-hidden rounded-2xl border border-white/10 bg-[#080910] shadow-lg shadow-black/30"
                        : "relative h-60 overflow-hidden rounded-2xl border border-slate-900/10 bg-slate-950 shadow-lg shadow-indigo-200/30"
                  }
                >
                  {previewVideo.videoUrl ? (
                    previewVideo.mediaType === "image" ? (
                      <div className="flex min-h-full min-w-full items-center justify-center p-2">
                        <img
                          src={previewVideo.videoUrl}
                          alt={previewVideo.title || "生成图片"}
                          className="object-contain transition-all duration-150"
                          style={{
                            maxHeight: imagePreviewScale === 1 ? "60vh" : "none",
                            maxWidth: imagePreviewScale === 1 ? "100%" : "none",
                            width: imagePreviewScale === 1 ? "auto" : `${imagePreviewScale * 100}%`,
                            height: "auto",
                          }}
                        />
                      </div>
                    ) : (
                      <video src={previewVideo.videoUrl} controls className="h-full w-full object-contain" />
                    )
                  ) : (
                    <>
                      <div className={isDark ? "absolute inset-0 animate-pulse bg-gradient-to-r from-[#1f1f22] via-[#2a2a31] to-[#1f1f22]" : "absolute inset-0 animate-pulse bg-gradient-to-r from-gray-100 via-gray-200 to-gray-100"} />
                      <div className="relative z-10 flex h-full items-center justify-center text-sm">
                        <div className={isDark ? "rounded-full bg-black/50 px-3 py-1 text-xs text-gray-300" : "rounded-full bg-white/80 px-3 py-1 text-xs text-gray-600"}>
                          {previewVideo.mediaType === "image" ? "图片资源加载中..." : "视频资源加载中..."}
                        </div>
                      </div>
                    </>
                  )}
                </div>

                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={softChipClass}>
                      预览状态：可查看
                    </span>
                    <span className={softChipClass}>
                      消耗：¥{formatMoney(previewVideo.cost)}
                    </span>
                    {previewVideo.mediaType === "image" ? (
                      <>
                        <span className={softChipClass}>
                          分辨率：{getImageSizeLabel(previewVideo.imageSize || previewVideo.size)}
                        </span>
                        <span className={softChipClass}>
                          模型：{formatImageModelLabel(previewVideo)}
                        </span>
                      </>
                    ) : (
                      <span className={softChipClass}>
                        时长：{getDurationLabel(previewVideo.seconds, previewVideo.duration)}
                      </span>
                    )}
                    <span className={softChipClass}>
                      比例：{getRatioLabel(previewVideo.ratio, previewVideo.size)}
                    </span>
                    {previewVideo.mediumVideo && (
                      <span className={softChipClass}>
                        目标时长：{getDurationLabel(previewVideo.seconds, previewVideo.duration)}
                      </span>
                    )}
                    {previewVideo.mediumVideo && (
                      <span className={softChipClass}>
                        Grok返回结果完整性：{previewVideo.isFinalVideoLikelyComplete ? "已确认" : "未知"}
                      </span>
                    )}
                    {!previewVideo.mediumVideo && (
                      <span className={softChipClass}>
                        参考图：{previewVideo.hasReferenceImage ? `已添加${previewVideo.referenceImageName ? `（${previewVideo.referenceImageName}）` : ""}` : "未添加"}
                      </span>
                    )}
                    {previewVideo.mediaType !== "image" && previewVideo.upscaleStatus === "failed" && (
                      <button
                        onClick={() => handleRetryUpscale(previewVideo.id)}
                        title={previewVideo.upscaleErrorMessage || "仅重试超分"}
                        className={primaryMiniButtonClass}
                      >
                        重试超分
                      </button>
                    )}
                  </div>

                  <div
                    className={
                      isDark
                        ? "rounded-2xl border border-white/10 bg-white/[0.045] p-4 text-sm leading-6 text-gray-100 shadow-inner shadow-black/15"
                        : "rounded-2xl border border-indigo-100 bg-slate-50/80 p-4 text-sm leading-6 text-slate-700 shadow-inner shadow-indigo-100/40"
                    }
                  >
                    <div className={isDark ? "mb-2 text-xs font-medium text-gray-400" : "mb-2 text-xs font-medium text-gray-500"}>
                      {previewVideo.mediaType === "image" ? "图片提示词" : "视频提示词"}
                    </div>
                    {previewVideo.item}
                  </div>
                </div>

                {previewVideo.mediaType !== "image" && <div className="flex flex-wrap items-center justify-end gap-2">
                  <button
                    onClick={() => void handleDownload(previewVideo)}
                    className={
                      isDark
                        ? primaryActionClass
                        : primaryActionClass
                    }
                  >
                    下载
                  </button>
                  <button
                    onClick={() => handleCopy(previewVideo.item)}
                    className={
                      isDark
                        ? secondaryButtonClass
                        : secondaryButtonClass
                    }
                  >
                    {isPreviewCopied ? "已复制✓" : "复制文案"}
                  </button>
                </div>}
              </div>
                </>
              )}
            </div>
          </div>
        )}

        {referencePreviewOpen && referencePreviewData && (
          <div
            className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/60 px-4 backdrop-blur-sm"
            onClick={() => {
              setReferencePreviewOpen(false);
              setReferencePreviewData(null);
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className={isDark ? "w-full max-w-3xl rounded-3xl border border-white/10 bg-[#10111a]/92 p-5 shadow-[0_30px_90px_rgba(0,0,0,0.5)] backdrop-blur-xl" : "w-full max-w-3xl rounded-3xl border border-white/75 bg-white/92 p-5 shadow-[0_30px_90px_rgba(79,70,229,0.2)] backdrop-blur-xl"}
            >
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-medium">{referencePreviewTitle || "参考图预览"}</div>
                <button
                  onClick={() => {
                    setReferencePreviewOpen(false);
                    setReferencePreviewData(null);
                  }}
                  className={smallSecondaryButtonClass}
                >
                  关闭
                </button>
              </div>
              <div className={isDark ? "max-h-[72vh] overflow-auto rounded-2xl border border-white/10 bg-[#171822] p-2 shadow-inner shadow-black/20" : "max-h-[72vh] overflow-auto rounded-2xl border border-indigo-100 bg-slate-50/80 p-2 shadow-inner shadow-indigo-100/50"}>
                {(() => {
                  const finalSrc = normalizeReferenceImageSrc(referencePreviewData);
                  return <img src={finalSrc ?? ""} alt="参考图大图预览" className="max-h-[68vh] w-full rounded-xl object-contain" />;
                })()}
              </div>
            </div>
          </div>
        )}

        {detailTask && (
          <div
            className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/55 px-4 backdrop-blur-sm transition-all duration-200"
            onClick={() => setTaskDetailId(null)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className={
                isDark
                  ? "flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#10111a]/92 shadow-[0_30px_100px_rgba(0,0,0,0.52)] backdrop-blur-xl"
                  : "flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-white/75 bg-white/92 shadow-[0_30px_100px_rgba(79,70,229,0.2)] backdrop-blur-xl"
              }
            >
              <div className={isDark ? "sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-[#10111a]/90 px-6 py-4 backdrop-blur-xl" : "sticky top-0 z-10 flex items-center justify-between border-b border-white/70 bg-white/82 px-6 py-4 backdrop-blur-xl"}>
                <div className="flex items-center gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-sky-500 text-sm font-semibold text-white shadow-md shadow-indigo-200/60">
                    详
                  </div>
                  <div className="text-lg font-semibold">任务详情</div>
                  <span className={softChipClass}>
                    {makeTaskId(detailTask.id)}
                  </span>
                  <span className={getStatusClass(detailTask.status)}>{statusLabelMap[detailTask.status]}</span>
                </div>
                <button
                  onClick={() => setTaskDetailId(null)}
                  className={smallSecondaryButtonClass}
                >
                  关闭
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-4">
                <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={getStatusClass(detailTask.status)}>{statusLabelMap[detailTask.status]}</span>
                      <span className={softChipClass}>
                        类型：{detailTask.kind === "schedule" ? "定时任务" : "普通任务"}
                      </span>
                      {detailTask.mode === "medium_video" && (
                        <>
                          <span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700">中视频任务</span>
                          <span className={softChipClass}>模型：Grok</span>
                          <span className={softChipClass}>目标时长：{detailTask.duration || `${(detailTask.mediumVideoSegments ?? detailTask.countSnapshot ?? 1) * 10}s`}</span>
                          <span className={softChipClass}>扩展次数：{Math.max(0, (detailTask.mediumVideoSegments ?? detailTask.countSnapshot ?? 1) - 1)}</span>
                          <span className={softChipClass}>完整性：{activeDetailVideo?.isFinalVideoLikelyComplete ? "已确认" : "待验证"}</span>
                        </>
                      )}
                      <span className={softChipClass}>
                        发布时间：{formatTaskPublishTime(detailTask.createdAt)}
                      </span>
                      <span className={softChipClass}>
                        消耗：¥{formatMoney(detailTask.cost)}
                      </span>
                      {activeDetailVideo?.mediaType === "image" ? (
                        <>
                          <span className={softChipClass}>
                            分辨率：{getImageSizeLabel(activeDetailVideo.imageSize || activeDetailVideo.size)}
                          </span>
                          <span className={softChipClass}>
                            模型：{formatImageModelLabel(activeDetailVideo)}
                          </span>
                        </>
                      ) : (
                        <span className={softChipClass}>
                          时长：{getDurationLabel(activeDetailVideo?.seconds, activeDetailVideo?.duration)}
                        </span>
                      )}
                      <span className={softChipClass}>
                        比例：{getRatioLabel(activeDetailVideo?.ratio, activeDetailVideo?.size)}
                      </span>
                      {detailTask.agentName && (
                        <span className={softChipClass}>
                          智能体：{detailTask.agentName}
                        </span>
                      )}
                      {detailTask.agentName && (
                        <span className={softChipClass}>
                          智能体权限：{detailTask.agentAccess === "restricted" ? "授权智能体" : "公开可用"}
                        </span>
                      )}
                      <span className={softChipClass}>
                        收藏：{detailVideos.some((video) => favorites.includes(video.id)) ? "是" : "否"}
                      </span>
                      {detailTask.mode !== "medium_video" && (
                        <span className={softChipClass}>
                          参考图：{detailTask.hasReferenceImage ? "已启用" : "未启用"}
                        </span>
                      )}
                      {detailTask.scheduledAt && (
                        <span className={softChipClass}>
                          {detailTask.status === "waiting" ? `预计执行：${new Date(detailTask.scheduledAt).toLocaleString()}` : `执行时间：${new Date(detailTask.scheduledAt).toLocaleString()}`}
                        </span>
                      )}
                    </div>
                    <div className={isDark ? "rounded-2xl border border-white/10 bg-white/[0.045] p-4 text-sm leading-6 text-gray-100 shadow-inner shadow-black/15" : "rounded-2xl border border-indigo-100 bg-slate-50/80 p-4 text-sm leading-6 text-slate-700 shadow-inner shadow-indigo-100/50"}>
                      <div className={isDark ? "mb-2 text-xs font-medium text-gray-400" : "mb-2 text-xs font-medium text-slate-500"}>任务主题 / Prompt</div>
                      {detailTask.item}
                    </div>
                    <div className={isDark ? "rounded-3xl border border-white/10 bg-white/[0.045] p-3" : "rounded-3xl border border-white/75 bg-white/70 p-3 shadow-inner shadow-indigo-100/50"}>
                      <div className="mb-2 flex items-center justify-between">
                        <div className="text-xs font-semibold">任务作品（{detailVideos.length}）</div>
                        <span className={softChipClass}>点击作品可切换详情</span>
                      </div>
                      {detailVideos.length === 0 ? (
                        <div className={isDark ? "text-xs text-gray-400" : "text-xs text-gray-500"}>该任务暂无生成作品</div>
                      ) : (
                        <div className="space-y-3">
                          {detailVideos.map((video) => (
                            <div
                              key={video.id}
                              onClick={() => setDetailVideoId(video.id)}
                              className={isDark ? `cursor-pointer rounded-2xl border p-2.5 transition-all duration-200 ${detailVideoId === video.id ? "border-indigo-300/60 bg-indigo-300/10 shadow-[0_12px_28px_rgba(79,70,229,0.2)]" : "border-white/10 bg-white/[0.04] hover:-translate-y-0.5 hover:border-indigo-300/35 hover:bg-white/[0.065] hover:shadow-[0_10px_22px_rgba(0,0,0,0.24)]"}` : `cursor-pointer rounded-2xl border p-2.5 transition-all duration-200 ${detailVideoId === video.id ? "border-indigo-200 bg-gradient-to-r from-indigo-50 via-white to-sky-50 shadow-[0_12px_26px_rgba(99,102,241,0.13)]" : "border-white/80 bg-white/85 hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-[0_10px_22px_rgba(79,70,229,0.11)]"}`}
                            >
                              <div className="flex items-start gap-2">
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    if (video.isPlaceholder) {
                                      showToast(video.status === "waiting" ? "任务待执行，暂不可预览" : "作品生成中，稍后可预览");
                                      return;
                                    }
                                    setPreviewVideo(video);
                                  }}
                                  className={`group shrink-0 cursor-pointer overflow-hidden rounded-2xl ${video.ratio === "9:16" ? "h-20 w-14" : video.ratio === "1:1" ? "h-16 w-16" : "h-16 w-28"}`}
                                >
                                  {renderVideoCover({ id: video.id, mediaType: video.mediaType, coverData: video.coverData, videoUrl: video.videoUrl, ratio: video.ratio, seconds: video.seconds, duration: video.duration, isPlaceholder: video.isPlaceholder, status: video.status })}
                                </button>
                                <div className="min-w-0 flex-1">
                                  <div className="mb-1 flex flex-wrap items-center gap-2">
                                    <span className={softChipClass}>
                                      {video.mediaType === "image" ? "IMAGE" : "VIDEO"}-{String(video.id).padStart(3, "0")}
                                    </span>
                                    <span className={getStatusClass(video.status)}>
                                      {statusLabelMap[video.status]}
                                    </span>
                                    {video.mediaType !== "image" && (
                                      <span className={upscaleBadgeClass(video.upscaleStatus)}>
                                        {getUpscaleStatusLabel(video.upscaleStatus)}
                                      </span>
                                    )}
                                    {video.mediaType !== "image" && video.upscaleStatus === "success" && (
                                      <span className={isDark ? "rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2 py-0.5 text-xs text-emerald-200" : "rounded-full border border-emerald-100 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700"}>
                                        预览/下载：超分视频优先
                                      </span>
                                    )}
                                    {video.mediumVideo && (
                                      <>
                                        <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-xs font-semibold text-violet-700">中视频</span>
                                        <span className={softChipClass}>完整性：{video.isFinalVideoLikelyComplete ? "已确认" : "待验证"}</span>
                                        {video.segmentIndex && video.totalSegments && <span className={softChipClass}>片段 {video.segmentIndex}/{video.totalSegments}</span>}
                                      </>
                                    )}
                                    {video.mediaType !== "image" && video.upscaleStatus === "failed" && (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleRetryUpscale(video.id);
                                        }}
                                        title={video.upscaleErrorMessage || "仅重试超分"}
                                        className={primaryMiniButtonClass}
                                      >
                                        重试超分
                                      </button>
                                    )}
                                    <span className={softChipClass}>
                                      比例：{getRatioLabel(video.ratio, video.size)}
                                    </span>
                                    {video.mediaType === "image" && (
                                      <span className={softChipClass}>
                                        分辨率：{getImageSizeLabel(video.imageSize || video.size)}
                                      </span>
                                    )}
                                  </div>
                                  <div className="mb-2 text-xs leading-5">{video.item}</div>
                                  {video.script && video.script.length > 0 && (
                                    <div className={isDark ? "mb-2 rounded-2xl border border-white/10 bg-white/[0.04] p-2.5" : "mb-2 rounded-2xl border border-indigo-100 bg-slate-50/80 p-2.5"}>
                                      <div className="mb-2 text-[11px] font-semibold">分镜脚本</div>
                                      <div className="space-y-1.5">
                                        {video.script.map((scene, sceneIndex) => (
                                          <div key={`${video.id}-scene-${sceneIndex}`} className={isDark ? "rounded-xl border border-white/10 bg-black/10 px-2 py-1.5 text-[11px] text-gray-300" : "rounded-xl border border-white/80 bg-white/80 px-2 py-1.5 text-[11px] text-slate-600"}>
                                            <span className="mr-1 font-semibold text-indigo-500">{sceneIndex + 1}.</span>{scene}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {video.promptText && (
                                    <div className={isDark ? "mb-2 rounded-2xl border border-white/10 bg-white/[0.04] p-2.5" : "mb-2 rounded-2xl border border-indigo-100 bg-slate-50/80 p-2.5"}>
                                      <div className="mb-1 flex items-center justify-between gap-2">
                                        <span className="text-[11px] font-medium">{video.mediaType === "image" ? "图片提示词" : "视频提示词"}</span>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            void handleCopy(video.promptText ?? "", video.id);
                                          }}
                                          className={smallSecondaryButtonClass}
                                        >
                                          复制提示词
                                        </button>
                                      </div>
                                      <div className={isDark ? "text-[11px] leading-5 text-gray-300" : "text-[11px] leading-5 text-gray-600"}>{video.promptText}</div>
                                    </div>
                                  )}
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <button onClick={(e) => { e.stopPropagation(); if (video.isPlaceholder) { showToast("作品生成完成后可预览"); return; } setPreviewVideo(video); }} className={smallSecondaryButtonClass}>预览</button>
                                    <button onClick={(e) => { e.stopPropagation(); handleCopy(video.item, video.id); }} className={smallSecondaryButtonClass}>复制</button>
                                    <button onClick={(e) => { e.stopPropagation(); if (video.isPlaceholder) { showToast("作品生成完成后可下载"); return; } void handleDownload(video); }} className={primaryMiniButtonClass}>下载</button>
                                    <button onClick={(e) => { e.stopPropagation(); if (video.isPlaceholder) { showToast("作品生成完成后可收藏"); return; } handleToggleFavorite(video.id); }} className={favorites.includes(video.id) ? "rounded-full border border-amber-200 bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-800" : smallSecondaryButtonClass}>{favorites.includes(video.id) ? "已收藏" : "收藏"}</button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    {detailTask.mode !== "medium_video" && detailTask.hasReferenceImage && renderReferencePreview(detailTask.referenceImageName, false, detailTask.referenceImageThumbData)}
                </div>
              </div>
            </div>
          </div>
        )}

        {toast && (
          <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
            <div
              className={
                isDark
                  ? "rounded-full bg-white px-4 py-2 text-sm font-medium text-black shadow-lg"
                  : "rounded-full bg-black px-4 py-2 text-sm font-medium text-white shadow-lg"
              }
            >
              {toast}
            </div>
          </div>
        )}

        <div className="mt-12 w-full max-w-6xl">
          <div className={isDark ? "mb-4 text-sm font-medium text-gray-400" : "mb-4 text-sm font-medium text-gray-500"}>常用功能</div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className={isDark ? "rounded-3xl border border-white/10 bg-white/[0.05] p-5 shadow-sm transition duration-200 hover:-translate-y-1 hover:border-indigo-400/40 hover:bg-white/[0.07] md:p-6" : "rounded-3xl border border-white/80 bg-white/82 p-5 shadow-md shadow-indigo-100/50 backdrop-blur transition duration-200 hover:-translate-y-1 hover:border-indigo-200 hover:shadow-lg md:p-6"}>
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-sky-500 text-xl shadow-md shadow-indigo-200">🎬</div>
              <div className="mb-1 text-base font-semibold">通用视频</div>
              <div className={isDark ? "text-sm text-gray-400" : "text-sm text-gray-500"}>
                支持文生视频、图生视频，直接输入完整提示词生成。
              </div>
            </div>

            <div className={isDark ? "rounded-3xl border border-white/10 bg-white/[0.05] p-5 shadow-sm transition duration-200 hover:-translate-y-1 hover:border-indigo-400/40 hover:bg-white/[0.07] md:p-6" : "rounded-3xl border border-white/80 bg-white/82 p-5 shadow-md shadow-indigo-100/50 backdrop-blur transition duration-200 hover:-translate-y-1 hover:border-indigo-200 hover:shadow-lg md:p-6"}>
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 via-fuchsia-500 to-indigo-500 text-xl shadow-md shadow-violet-200">🧠</div>
              <div className="mb-1 text-base font-semibold">智能体批量视频</div>
              <div className={isDark ? "text-sm text-gray-400" : "text-sm text-gray-500"}>
                选择智能体模板，一句话批量生成最多 10 条视频任务。
              </div>
            </div>

            <div className={isDark ? "rounded-3xl border border-white/10 bg-white/[0.05] p-5 shadow-sm transition duration-200 hover:-translate-y-1 hover:border-indigo-400/40 hover:bg-white/[0.07] md:p-6" : "rounded-3xl border border-white/80 bg-white/82 p-5 shadow-md shadow-indigo-100/50 backdrop-blur transition duration-200 hover:-translate-y-1 hover:border-indigo-200 hover:shadow-lg md:p-6"}>
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 via-cyan-400 to-emerald-400 text-xl shadow-md shadow-sky-200">🖼️</div>
              <div className="mb-1 text-base font-semibold">通用图片</div>
              <div className={isDark ? "text-sm text-gray-400" : "text-sm text-gray-500"}>
                支持文生图、图生图，成功可下载后再扣费。
              </div>
            </div>

            <div className={isDark ? "rounded-3xl border border-white/10 bg-white/[0.05] p-5 shadow-sm transition duration-200 hover:-translate-y-1 hover:border-indigo-400/40 hover:bg-white/[0.07] md:p-6" : "rounded-3xl border border-white/80 bg-white/82 p-5 shadow-md shadow-indigo-100/50 backdrop-blur transition duration-200 hover:-translate-y-1 hover:border-indigo-200 hover:shadow-lg md:p-6"}>
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 via-orange-400 to-rose-400 text-xl shadow-md shadow-amber-200">⏰</div>
              <div className="mb-1 text-base font-semibold">定时生成</div>
              <div className={isDark ? "text-sm text-gray-400" : "text-sm text-gray-500"}>
                支持指定时间执行一次任务，适合夜间批量生产。
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
