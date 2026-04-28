"use client";

import { type ChangeEvent, type MouseEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const isClient = typeof window !== "undefined";

type TaskStatus = "waiting" | "queued" | "running" | "success" | "failed" | "cancelled";

type Task = {
  id: number;
  prompt: string;
  status: TaskStatus;
  createdAt: number;
  kind: "manual" | "schedule";
  hasReferenceImage: boolean;
  referenceImageName?: string;
  referenceImageThumbData?: string;
  scheduledAt?: number;
  promptSnapshot?: string;
  countSnapshot?: number;
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
  const [agentSearch, setAgentSearch] = useState("");
  const [agentProfiles, setAgentProfiles] = useState<AgentProfile[]>(AGENT_PROFILES);
  const [pricing, setPricing] = useState<PricingConfig>(DEFAULT_PRICING);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [duration, setDuration] = useState("12s");
  const [ratio, setRatio] = useState("16:9");
  const [imageSize, setImageSize] = useState<"1K" | "2K" | "4K">("2K");
  const [imageModel, setImageModel] = useState<"image2" | "banana2">("image2");
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
  const [remixAnalysisLoading, setRemixAnalysisLoading] = useState(false);
  const [remixAnalysisResult, setRemixAnalysisResult] = useState<{ analysis: string; prompt: string; duration: number | null } | null>(null);
  const [timingDate, setTimingDate] = useState("");
  const [timingTime, setTimingTime] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const remixVideoInputRef = useRef<HTMLInputElement | null>(null);
  const timingDateInputRef = useRef<HTMLInputElement | null>(null);
  const timingTimeInputRef = useRef<HTMLInputElement | null>(null);
  const scheduleTimersRef = useRef<Record<number, number>>({});
  const taskPollersRef = useRef<Record<string, number>>({});
  const storageWarningShownRef = useRef(false);
  const promptTemplates = [
    "新员工入职第一天手足无措，办公室搞笑短视频",
    "老板临时加需求，全员加班到深夜的反转剧情",
    "实习生一句话点醒团队，轻喜剧职场短视频",
  ];

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
    status: toTaskStatus(String(task.status ?? "success")),
    createdAt: Date.parse(String(task.createdAt ?? new Date().toISOString())),
    kind: task.scheduledAt ? "schedule" : "manual",
    hasReferenceImage: Boolean(task.referenceImageUrl),
    referenceImageName: typeof task.referenceImageName === "string" ? task.referenceImageName : undefined,
    referenceImageThumbData: normalizeDisplayUrl(typeof task.referenceImageUrl === "string" ? task.referenceImageUrl : undefined),
    scheduledAt: typeof task.scheduledAt === "string" ? Date.parse(task.scheduledAt) : undefined,
    promptSnapshot: typeof task.promptSnapshot === "string" ? task.promptSnapshot : typeof task.prompt === "string" ? task.prompt : undefined,
    countSnapshot: typeof task.count === "number" ? task.count : undefined,
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

    const effectiveCount = countValue ?? generateCount;
    const useReference = typeof refEnabled === "boolean" ? refEnabled : hasReferenceImage;
    const useReferenceName = refName ?? referenceImageName;
    const useReferenceThumbData = refThumbData ?? referenceImageThumbData;
    const isCurrentRemixMode = mode === "remix";
    const isCurrentAgentMode = mode === "agent" || mode === "agent_image";
    const isCurrentImageMode = mode === "image" || mode === "agent_image";
    const submitMode = mode === "agent_image" ? "image" : isCurrentRemixMode ? "normal" : mode;
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
      mode: submitMode as "agent" | "normal" | "image",
      duration,
      ratio: isCurrentImageMode ? ratio : ratio === "9:16" ? "9:16" : "16:9",
      imageSize: isCurrentImageMode ? imageSize : undefined,
      imageModel: isCurrentImageMode ? imageModel : undefined,
      count: effectiveCount,
      agentId: activeAgentId,
      referenceImageUrl: useReference && !isCurrentRemixMode ? referenceImageData ?? undefined : undefined,
      referenceImageName: useReference && !isCurrentRemixMode ? useReferenceName || undefined : undefined,
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
            showToast(isCurrentImageMode ? `已生成${videosCount}张图片` : `已生成${videosCount}条视频`);
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
    if (mode === "agent" && (!selectedAgent || !selectedAgentApplicable)) {
      showToast("请先选择视频智能体");
      return;
    }
    if (mode === "agent_image" && (!selectedAgent || !selectedAgentApplicable)) {
      showToast("请先选择图片智能体");
      return;
    }
    if ((mode === "agent" || mode === "agent_image") && selectedAgent?.access === "restricted" && !selectedAgent.isAuthorized) {
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
    if (mode === "agent" && (!selectedAgent || !selectedAgentApplicable)) {
      showToast("请先选择视频智能体");
      return;
    }
    if (mode === "agent_image" && (!selectedAgent || !selectedAgentApplicable)) {
      showToast("请先选择图片智能体");
      return;
    }
    if ((mode === "agent" || mode === "agent_image") && selectedAgent?.access === "restricted" && !selectedAgent.isAuthorized) {
      showToast("当前智能体尚未获得授权，无法执行任务");
      return;
    }
    const isCurrentRemixMode = mode === "remix";
    const isCurrentImageMode = mode === "image" || mode === "agent_image";
    const submitMode = mode === "agent_image" ? "image" : isCurrentRemixMode ? "normal" : mode;
    const createRes = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: prompt.trim(),
        mode: submitMode as "agent" | "normal" | "image",
        duration,
        ratio,
        imageSize: isCurrentImageMode ? imageSize : undefined,
        imageModel: isCurrentImageMode ? imageModel : undefined,
        count: generateCount,
        agentId: mode === "agent" || mode === "agent_image" ? selectedAgent?.id : undefined,
        referenceImageUrl: hasReferenceImage && !isCurrentRemixMode ? referenceImageData ?? undefined : undefined,
        referenceImageName: hasReferenceImage && !isCurrentRemixMode ? referenceImageName || undefined : undefined,
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
    status?: "success" | "failed";
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
    if (remixVideoInputRef.current) {
      remixVideoInputRef.current.value = "";
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
    if (prompt.trim()) {
      formData.append("userHint", prompt.trim());
    }
    setRemixAnalysisLoading(true);
    void (async () => {
      try {
        const res = await fetch("/api/video-remix/analyze", { method: "POST", body: formData });
        const json = await res.json();
        if (!res.ok || !json?.ok || !json?.prompt) {
          showToast(json?.message || "分析视频失败");
          return;
        }
        const nextPrompt = String(json.prompt);
        setPrompt(nextPrompt);
        setRemixAnalysisResult({
          analysis: String(json.analysis || ""),
          prompt: nextPrompt,
          duration: typeof json.duration === "number" ? json.duration : null,
        });
        showToast("AI已生成复刻提示词，可编辑后点击开始生成视频。");
      } catch {
        showToast("分析视频失败");
      } finally {
        setRemixAnalysisLoading(false);
      }
    })();
  };

  const handleRemoveReferenceImage = () => {
    setReferenceImageData(null);
    setReferenceImageThumbData(null);
    setReferenceImageName("");
    setHasReferenceImage(false);
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
  const isImageMode = mode === "image" || mode === "agent_image";
  const isAgentMode = mode === "agent" || mode === "agent_image";
  const modeLabel =
    isRemixMode
      ? "爆款视频复刻"
      : mode === "agent"
      ? "智能体批量视频"
      : mode === "normal"
        ? "通用视频"
        : mode === "agent_image"
          ? "智能体批量图片"
          : "通用图片";
  const selectedAgentApplicable =
    !selectedAgent ||
    (mode === "agent" && (selectedAgent.type === "video" || selectedAgent.type === "both")) ||
    (mode === "agent_image" && (selectedAgent.type === "image" || selectedAgent.type === "both")) ||
    !isAgentMode;

  const estimatedCost = (() => {
    const imagePrefix: "image" | "image2" = imageModel === "banana2" ? "image" : "image2";
    const imagePriceKey = `${imagePrefix}_${imageSize}` as "image_1K" | "image_2K" | "image_4K" | "image2_1K" | "image2_2K" | "image2_4K";
    const unit =
      isImageMode
        ? pricing[imagePriceKey]
        : duration === "4s"
          ? pricing.video_4s
          : duration === "8s"
            ? pricing.video_8s
            : pricing.video_12s;
    return Number((unit * generateCount).toFixed(2));
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
    if (mode === "agent" && !(agent.type === "video" || agent.type === "both")) return false;
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
      return "rounded-full border border-gray-400/60 bg-gray-500/90 px-3 py-1 text-xs font-medium tracking-wide text-white";
    }
    if (status === "queued" || status === "running") {
      return "rounded-full border border-amber-400/70 bg-amber-500/90 px-3 py-1 text-xs font-medium tracking-wide text-white";
    }
    if (status === "failed") {
      return "rounded-full border border-rose-400/70 bg-rose-500/90 px-3 py-1 text-xs font-medium tracking-wide text-white";
    }
    if (status === "cancelled") {
      return "rounded-full border border-gray-300/70 bg-gray-400/90 px-3 py-1 text-xs font-medium tracking-wide text-white";
    }
    return "rounded-full border border-emerald-400/70 bg-emerald-500/90 px-3 py-1 text-xs font-medium tracking-wide text-white";
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

  const videoRecords = [...videos]
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
        isFavorite: favorites.includes(video.id),
        isLatestDone: video.status === "success" && !videos.some((item) => item.status === "success" && item.createdAt > video.createdAt),
        taskStatus: parentTask?.status ?? "success",
      };
    });

  const detailTask = taskDetailId ? taskRecords.find((task) => task.id === taskDetailId) ?? null : null;
  const detailVideos = detailTask ? videoRecords.filter((video) => video.taskId === detailTask.id) : [];
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
    video: { id?: number; mediaType?: "video" | "image"; coverData?: string; coverUrl?: string; previewImageUrl?: string; videoUrl?: string; ratio?: "1:1" | "9:16" | "16:9"; seconds?: number; duration?: string } | null
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
          {hasCover ? (
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
  const resultTotalPages = Math.max(1, Math.ceil(visibleResults.length / PAGE_SIZE));
  const drawerTotalPages = Math.max(1, Math.ceil(filteredTaskRecords.length / PAGE_SIZE));
  const pagedVisibleResults = visibleResults.slice((resultPage - 1) * PAGE_SIZE, resultPage * PAGE_SIZE);
  const pagedDrawerRecords = filteredTaskRecords.slice((drawerPage - 1) * PAGE_SIZE, drawerPage * PAGE_SIZE);

  useEffect(() => {
    setResultPage(1);
  }, [resultFilter, resultSort, resultSearch, favorites.length, videos.length]);

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
    active ? "bg-black text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200";

  if (!mounted) return null;

  return (
    <main className={isDark ? "min-h-screen bg-[#0b0b0c] text-white" : "min-h-screen bg-[#f7f7f8] text-black"}>
      <header
        className={
          isDark
            ? "sticky top-0 z-20 border-b border-gray-800 bg-black/85 backdrop-blur"
            : "sticky top-0 z-20 border-b border-gray-200 bg-white/85 backdrop-blur"
        }
      >
        <div className="flex items-center justify-between px-4 py-4 md:px-6">
          {/* 左侧 Logo */}
          <div className="flex items-center gap-3">
            <div
              className={
                isDark
                  ? "flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-sm font-bold text-black shadow-sm"
                  : "flex h-10 w-10 items-center justify-center rounded-2xl bg-black text-sm font-bold text-white shadow-sm"
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
              className={
                isDark
                  ? "rounded-full bg-gray-800 px-4 py-2 text-sm font-medium text-white"
                  : "rounded-full bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700"
              }
            >
              {isDark ? "☀️" : "🌙"}
            </button>
            {isLoggedIn ? (
              <>
                <div className={isDark ? "rounded-full bg-gray-800 px-4 py-2 text-sm font-medium text-gray-100" : "rounded-full bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700"}>
                  余额 ¥{balance}
                </div>

                <a
                  href="https://work.weixin.qq.com/ca/cawcde87c5c2d49c7f"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={
                    isDark
                      ? "rounded-full bg-gray-800 px-4 py-2 text-sm font-medium text-gray-100"
                      : "rounded-full bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700"
                  }
                >
                  充值
                </a>

                <button
                  onClick={() => setIsTaskDrawerOpen(true)}
                  className={
                    isDark
                      ? "rounded-full bg-gray-800 px-4 py-2 text-sm font-medium text-gray-100"
                      : "rounded-full bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700"
                  }
                >
                  任务记录 {tasks.length > 0 ? `(${tasks.length})` : ""}
                </button>

                {currentUserRole === "admin" && (
                  <button
                    onClick={() => router.push("/admin")}
                    className={
                      isDark
                        ? "rounded-full bg-gray-800 px-4 py-2 text-sm font-medium text-gray-100"
                        : "rounded-full bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700"
                    }
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
                  className={isDark ? "rounded-full bg-white px-6 py-2 text-sm font-medium text-black" : "rounded-full bg-black px-6 py-2 text-sm font-medium text-white"}
                >
                  退出登录
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => router.push("/login")}
                  className={isDark ? "rounded-full bg-gray-800 px-6 py-2 text-sm font-medium text-gray-100" : "rounded-full bg-gray-100 px-6 py-2 text-sm font-medium text-gray-700"}
                >
                  登录
                </button>

                <button
                  onClick={() => router.push("/register")}
                  className={isDark ? "rounded-full bg-white px-6 py-2 text-sm font-medium text-black" : "rounded-full bg-black px-6 py-2 text-sm font-medium text-white"}
                >
                  注册
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <section className="mx-auto flex max-w-7xl flex-col items-center px-4 pb-16 pt-16 md:px-6 md:pt-20">
        <h1 className="mb-3 text-4xl font-semibold tracking-tight md:text-5xl">
          批量视频生成 Agent
        </h1>
        <p className={isDark ? "mb-8 text-sm text-gray-400 md:text-base" : "mb-8 text-sm text-gray-500 md:text-base"}>
          一句话生成多个视频，支持批量与定时任务
        </p>

        <div className={isDark ? "w-full max-w-4xl rounded-[28px] border border-gray-800 bg-[#121214] p-4 shadow-sm md:p-5" : "w-full max-w-4xl rounded-[28px] border border-gray-200 bg-white p-4 shadow-sm md:p-5"}>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleReferenceUpload} className="hidden" />
          <input ref={remixVideoInputRef} type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" onChange={handleRemixVideoUpload} className="hidden" />
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={isRemixMode ? "上传参考视频并分析后，AI 会在这里填入适用于 Sora2 的复刻提示词..." : "输入你的创意，例如：新员工入职手足无措，生成 3 条搞笑办公室短视频..."}
            className={isDark ? "h-44 w-full resize-none rounded-2xl border border-gray-800 bg-[#18181b] p-5 text-sm leading-6 outline-none placeholder:text-gray-500 md:h-48" : "h-44 w-full resize-none rounded-2xl border border-gray-200 bg-gray-50 p-5 text-sm leading-6 outline-none placeholder:text-gray-400 md:h-48"}
          />
          <div className="mt-2 flex justify-end">
            <button
              onClick={() => setPrompt("")}
              className={
                isDark
                  ? "rounded-full bg-gray-800 px-4 py-2 text-xs text-gray-200"
                  : "rounded-full bg-gray-100 px-4 py-2 text-xs text-gray-700"
              }
            >
              清空输入
            </button>
          </div>

          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                {!isRemixMode && (
                  <button
                    onClick={handleToggleReferenceImage}
                    className={
                      hasReferenceImage
                        ? isDark
                          ? "rounded-full bg-white px-4 py-2 text-sm font-medium text-black"
                          : "rounded-full bg-black px-4 py-2 text-sm font-medium text-white"
                        : isDark
                          ? "rounded-full bg-gray-800 px-4 py-2 text-sm font-medium text-gray-100"
                          : "rounded-full bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700"
                    }
                  >
                    {hasReferenceImage ? "已添加参考图" : "上传参考图"}
                  </button>
                )}

                <div className={isDark ? "rounded-full bg-gray-800 px-4 py-2 text-sm text-gray-100" : "rounded-full bg-gray-100 px-4 py-2 text-sm text-gray-700"}>
                  {isRemixMode ? "复刻视频模式" : isImageMode ? "图像模式" : "视频模式"}
                </div>
              </div>

              <div className={isDark ? "text-sm text-gray-400" : "text-sm text-gray-500"}>
                已输入 {prompt.length} 字 {prompt.length === 0 ? "｜建议先输入提示词" : "｜可直接开始生成"}
              </div>
            </div>

            {!isRemixMode && hasReferenceImage && referenceImageData && (
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

            <div className="flex flex-wrap items-center gap-2">
              {promptTemplates.map((template) => (
                <button
                  key={template}
                  onClick={() => setPrompt(template)}
                  className={
                    isDark
                      ? "rounded-full bg-gray-800 px-4 py-2 text-xs text-gray-200"
                      : "rounded-full bg-gray-100 px-4 py-2 text-xs text-gray-700"
                  }
                >
                  {template}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => {
                  setMode("remix");
                  setSelectedAgentId(null);
                  if (ratio === "1:1") setRatio("16:9");
                }}
                className={`rounded-full px-4 py-2 text-sm transition ${pillClass(mode === "remix")}`}
              >
                爆款视频复刻
              </button>

              <button
                onClick={() => {
                  setMode("agent");
                  setSelectedAgentId(null);
                  if (ratio === "1:1") setRatio("16:9");
                }}
                className={`rounded-full px-4 py-2 text-sm transition ${pillClass(mode === "agent")}`}
              >
                智能体批量视频
              </button>

              <button
                onClick={() => {
                  setMode("normal");
                  setSelectedAgentId(null);
                  if (ratio === "1:1") setRatio("16:9");
                }}
                className={`rounded-full px-4 py-2 text-sm transition ${pillClass(mode === "normal")}`}
              >
                通用视频
              </button>

              <button
                onClick={() => {
                  setMode("agent_image");
                  setSelectedAgentId(null);
                }}
                className={`rounded-full px-4 py-2 text-sm transition ${pillClass(mode === "agent_image")}`}
              >
                智能体批量图片
              </button>

              <button
                onClick={() => {
                  setMode("image");
                  setSelectedAgentId(null);
                }}
                className={`rounded-full px-4 py-2 text-sm transition ${pillClass(mode === "image")}`}
              >
                通用图片
              </button>
            </div>

            {isRemixMode && (
              <div className={isDark ? "rounded-2xl border border-gray-800 bg-[#18181b] p-4" : "rounded-2xl border border-gray-200 bg-gray-50 p-4"}>
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">上传参考视频</div>
                    <p className={isDark ? "mt-1 max-w-2xl text-xs leading-5 text-gray-400" : "mt-1 max-w-2xl text-xs leading-5 text-gray-500"}>
                      上传参考视频，AI 将分析镜头节奏、画面风格、人物动作和叙事结构，生成适用于 Sora2 的复刻提示词。
                    </p>
                    <p className={isDark ? "mt-1 text-xs text-gray-400" : "mt-1 text-xs text-gray-500"}>
                      支持 mp4 / mov / webm，最大 50MB。当前目标 {duration}，{getRemixDurationRange().hint}。
                    </p>
                  </div>
                  <button
                    onClick={() => remixVideoInputRef.current?.click()}
                    className={isDark ? "rounded-full bg-white px-4 py-2 text-sm font-medium text-black" : "rounded-full bg-black px-4 py-2 text-sm font-medium text-white"}
                  >
                    选择参考视频
                  </button>
                </div>

                {remixVideoFile ? (
                  <div className={isDark ? "mb-3 rounded-2xl border border-gray-700 bg-[#141417] p-3 text-sm text-gray-200" : "mb-3 rounded-2xl border border-gray-200 bg-white p-3 text-sm text-gray-700"}>
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{remixVideoFile.name}</div>
                        <div className={isDark ? "mt-1 text-xs text-gray-400" : "mt-1 text-xs text-gray-500"}>
                          {(remixVideoFile.size / 1024 / 1024).toFixed(2)} MB
                          {remixVideoDuration !== null ? ` / ${remixVideoDuration.toFixed(1)} 秒` : " / 时长将在后端校验"}
                        </div>
                      </div>
                      <button
                        onClick={handleRemoveRemixVideo}
                        className={isDark ? "rounded-full bg-gray-700 px-3 py-1.5 text-xs text-gray-100" : "rounded-full bg-gray-100 px-3 py-1.5 text-xs text-gray-700"}
                      >
                        移除
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className={isDark ? "mb-3 rounded-2xl border border-dashed border-gray-700 p-4 text-sm text-gray-400" : "mb-3 rounded-2xl border border-dashed border-gray-300 p-4 text-sm text-gray-500"}>
                    还未上传参考视频，请先选择文件后点击分析。
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={handleAnalyzeRemixVideo}
                    disabled={remixAnalysisLoading}
                    className={
                      remixAnalysisLoading
                        ? "cursor-not-allowed rounded-full bg-gray-300 px-4 py-2 text-sm font-medium text-gray-500"
                        : isDark
                          ? "rounded-full bg-white px-4 py-2 text-sm font-medium text-black"
                          : "rounded-full bg-black px-4 py-2 text-sm font-medium text-white"
                    }
                  >
                    {remixAnalysisLoading ? "分析中..." : "分析并生成复刻提示词"}
                  </button>
                  {remixAnalysisResult && (
                    <span className={isDark ? "text-sm text-emerald-300" : "text-sm text-emerald-600"}>
                      AI已生成复刻提示词，可编辑后点击开始生成视频。
                    </span>
                  )}
                </div>

                {remixAnalysisResult?.analysis && (
                  <div className={isDark ? "mt-3 rounded-2xl border border-gray-700 bg-[#141417] p-3 text-xs leading-5 text-gray-300" : "mt-3 rounded-2xl border border-gray-200 bg-white p-3 text-xs leading-5 text-gray-600"}>
                    <div className="mb-1 font-semibold">AI 分析摘要</div>
                    <div>{remixAnalysisResult.analysis}</div>
                  </div>
                )}
              </div>
            )}

            {isAgentMode && (
              <div className={isDark ? "rounded-2xl border border-gray-800 bg-[#18181b] p-3" : "rounded-2xl border border-gray-200 bg-gray-50 p-3"}>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold">{mode === "agent_image" ? "选择图片智能体" : "选择视频智能体"}</div>
                  {selectedAgent && selectedAgentApplicable ? (
                    <div className="flex items-center gap-2">
                      <span className={isDark ? "rounded-full bg-gray-800 px-3 py-1 text-xs text-gray-200" : "rounded-full bg-white px-3 py-1 text-xs text-gray-700"}>
                        当前已选：{selectedAgent.name}
                      </span>
                      <button
                        onClick={() => setSelectedAgentId(null)}
                        className={isDark ? "rounded-full bg-gray-700 px-3 py-1 text-xs text-gray-100 transition hover:brightness-110" : "rounded-full bg-white px-3 py-1 text-xs text-gray-700 transition hover:brightness-95"}
                      >
                        取消选择
                      </button>
                    </div>
                  ) : (
                    <span className={isDark ? "text-xs text-gray-400" : "text-xs text-gray-500"}>请选择 1 个智能体</span>
                  )}
                </div>

                <input
                  value={agentSearch}
                  onChange={(e) => setAgentSearch(e.target.value)}
                  placeholder="搜索智能体，例如：煤炉 / 餐饮 / 带货"
                  className={
                    isDark
                      ? "mb-2 w-full rounded-xl border border-gray-700 bg-[#141417] px-3 py-2 text-xs text-gray-100 outline-none placeholder:text-gray-500"
                      : "mb-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700 outline-none placeholder:text-gray-400"
                  }
                />

                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
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
                              ? "rounded-xl border border-white/60 bg-[#202028] p-2.5 text-left transition"
                              : "rounded-xl border border-black/70 bg-white p-2.5 text-left transition"
                            : isRestrictedLocked
                              ? isDark
                                ? "rounded-xl border border-gray-800 bg-[#151519] p-2.5 text-left opacity-65 transition"
                                : "rounded-xl border border-gray-200 bg-white p-2.5 text-left opacity-70 transition"
                            : isDark
                              ? "rounded-xl border border-gray-700 bg-[#151519] p-2.5 text-left transition hover:border-gray-600 hover:bg-[#1a1a1f]"
                              : "rounded-xl border border-gray-200 bg-white p-2.5 text-left transition hover:border-gray-300 hover:bg-gray-50"
                        }
                      >
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <span className="text-sm font-medium">{agent.name}</span>
                          {lockIcon ? <span className="text-xs">{lockIcon}</span> : null}
                        </div>
                        <div className={isDark ? "mb-2 text-xs text-gray-400" : "mb-2 text-xs text-gray-500"}>{agent.description}</div>
                        <div className="flex flex-wrap items-center gap-1">
                          {agent.tags.slice(0, 2).map((tag) => (
                            <span key={tag} className={isDark ? "rounded-full bg-gray-800 px-2 py-0.5 text-[10px] text-gray-300" : "rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600"}>
                              {tag}
                            </span>
                          ))}
                          <span className={isDark ? "rounded-full bg-gray-700 px-2 py-0.5 text-[10px] text-gray-200" : "rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600"}>
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

            <div className="flex flex-wrap items-center gap-3">
              {!isImageMode &&
                ["4s", "8s", "12s"].map((item) => (
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

              {isImageMode ? (
                <>
                  <div className="flex items-center gap-2">
                    <span className={isDark ? "text-sm text-gray-400" : "text-sm text-gray-500"}>模型</span>
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
                  <div className="flex items-center gap-2">
                    <span className={isDark ? "text-sm text-gray-400" : "text-sm text-gray-500"}>分辨率</span>
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
                </>
              ) : (
                <div className={isDark ? "rounded-full bg-gray-800 px-4 py-2 text-sm text-gray-100" : "rounded-full bg-gray-100 px-4 py-2 text-sm text-gray-700"}>
                  超清1080P
                </div>
              )}

              <div className="flex items-center gap-2">
                <span className={isDark ? "text-sm text-gray-400" : "text-sm text-gray-500"}>
                  {isImageMode ? "生成张数" : "生成条数"}
                </span>
                <select
                  value={generateCount}
                  onChange={(e) => setGenerateCount(Number(e.target.value))}
                  className={
                    isDark
                      ? "rounded-full border border-gray-700 bg-gray-800 px-4 py-2 text-sm text-gray-100 outline-none"
                      : "rounded-full border border-gray-200 bg-gray-50 px-4 py-2 text-sm text-gray-700 outline-none"
                  }
                >
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((count) => (
                    <option key={count} value={count}>
                      {count}{isImageMode ? "张" : "条"}
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={() => setTimingEnabled((prev) => !prev)}
                className={`rounded-full px-4 py-2 text-sm transition ${pillClass(timingEnabled)}`}
              >
                {timingEnabled ? "已开启定时" : "定时生成"}
              </button>

              <div className={isDark ? "ml-auto rounded-full border border-gray-700 bg-gray-800 px-4 py-2 text-sm text-gray-100" : "ml-auto rounded-full border border-gray-200 bg-gray-50 px-4 py-2 text-sm text-gray-700"}>
                <span className="mr-1">🪙</span>
                预计消耗 ¥{formatMoney(estimatedCost)}
                {!currentChannelEnabled && <span className="ml-2 text-rose-500">通道维护升级中请稍后再试</span>}
                {imageModelRestrictionMessage && <span className="ml-2 text-rose-500">{imageModelRestrictionMessage}</span>}
                {isBalanceInsufficient && <span className="ml-2 text-rose-500">余额不足，请充值</span>}
              </div>

              <button
                onClick={handleGenerate}
                className={
                  isDark
                    ? "rounded-full bg-white px-6 py-2 text-sm font-medium text-black"
                    : "rounded-full bg-black px-6 py-2 text-sm font-medium text-white"
                }
              >
                {isGenerating ? "生成中..." : "开始生成"}
              </button>
            </div>

            {timingEnabled && (
              <div className={isDark ? "rounded-2xl border border-gray-800 bg-[#18181b] p-4" : "rounded-2xl border border-gray-200 bg-gray-50 p-4"}>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-1">
                    <div className={isDark ? "text-xs text-gray-400" : "text-xs text-gray-500"}>定时日期</div>
                    <div
                      onClick={() => {
                        if (timingDateInputRef.current?.showPicker) {
                          timingDateInputRef.current.showPicker();
                        } else {
                          timingDateInputRef.current?.focus();
                        }
                      }}
                    >
                      <input
                        ref={timingDateInputRef}
                        type="date"
                        value={timingDate}
                        onChange={(e) => setTimingDate(e.target.value)}
                        className={isDark ? "w-full cursor-pointer rounded-full border border-gray-700 bg-gray-800 px-4 py-2 text-sm text-gray-100 outline-none" : "w-full cursor-pointer rounded-full border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 outline-none"}
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className={isDark ? "text-xs text-gray-400" : "text-xs text-gray-500"}>定时时间</div>
                    <div
                      onClick={() => {
                        if (timingTimeInputRef.current?.showPicker) {
                          timingTimeInputRef.current.showPicker();
                        } else {
                          timingTimeInputRef.current?.focus();
                        }
                      }}
                    >
                      <input
                        ref={timingTimeInputRef}
                        type="time"
                        value={timingTime}
                        onChange={(e) => setTimingTime(e.target.value)}
                        className={isDark ? "w-full cursor-pointer rounded-full border border-gray-700 bg-gray-800 px-4 py-2 text-sm text-gray-100 outline-none" : "w-full cursor-pointer rounded-full border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 outline-none"}
                      />
                    </div>
                  </div>
                  <div className="flex items-end">
                    <button
                      onClick={handleCreateScheduledTask}
                      className={isDark ? "w-full rounded-full bg-white px-4 py-2 text-sm font-medium text-black" : "w-full rounded-full bg-black px-4 py-2 text-sm font-medium text-white"}
                    >
                      确认创建定时任务
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {(isGenerating || videos.length > 0) && (
          <div className="mt-6 w-full max-w-4xl space-y-3 max-h-[680px] overflow-y-auto pr-1">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className={isDark ? "text-sm font-medium text-gray-200" : "text-sm font-medium text-gray-700"}>
                  作品管理区
                </div>
                <div className={isDark ? "mt-1 text-sm text-gray-400" : "mt-1 text-sm text-gray-500"}>
                  当前显示 {pagedVisibleResults.length} / 筛选后 {visibleResults.length} / 总计 {videos.length} 条作品，当前收藏 {visibleFavoriteCount} 条，模式：{modeLabel}，参考图：{hasReferenceImage ? "已添加" : "未添加"}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={resultSearch}
                  onChange={(e) => setResultSearch(e.target.value)}
                  placeholder="搜索作品关键词"
                  className={
                    isDark
                      ? "rounded-full border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-100 outline-none placeholder:text-gray-500"
                      : "rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-700 outline-none placeholder:text-gray-400"
                  }
                />
                <select
                  value={resultSort}
                  onChange={(e) => setResultSort(e.target.value as "latest" | "earliest" | "successOnly" | "failedOnly")}
                  className={
                    isDark
                      ? "rounded-full border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-100 outline-none"
                      : "rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-700 outline-none"
                  }
                >
                  <option value="latest">最新优先</option>
                  <option value="earliest">最早优先</option>
                  <option value="successOnly">仅成功</option>
                  <option value="failedOnly">仅失败</option>
                </select>
                <button
                  onClick={() => setResultFilter("all")}
                  className={
                    resultFilter === "all"
                      ? isDark
                        ? "rounded-full bg-white px-4 py-2 text-xs font-medium text-black"
                        : "rounded-full bg-black px-4 py-2 text-xs font-medium text-white"
                      : isDark
                        ? "rounded-full bg-gray-800 px-4 py-2 text-xs font-medium text-gray-100"
                        : "rounded-full bg-gray-100 px-4 py-2 text-xs font-medium text-gray-700"
                  }
                >
                  全部
                </button>

                <button
                  onClick={() => setResultFilter("favorites")}
                  className={
                    resultFilter === "favorites"
                      ? "rounded-full bg-yellow-400 px-4 py-2 text-xs font-medium text-black"
                      : isDark
                        ? "rounded-full bg-gray-800 px-4 py-2 text-xs font-medium text-gray-100"
                        : "rounded-full bg-gray-100 px-4 py-2 text-xs font-medium text-gray-700"
                  }
                >
                  已收藏
                </button>

                {videos.length > 0 && (
                  <button
                    onClick={handleClearResults}
                    className={
                      isDark
                        ? "rounded-full bg-gray-800 px-4 py-2 text-xs font-medium text-gray-100"
                        : "rounded-full bg-gray-100 px-4 py-2 text-xs font-medium text-gray-700"
                    }
                  >
                    清空记录
                  </button>
                )}
              </div>
            </div>
            {isGenerating && (
              <div className={isDark ? "rounded-2xl border border-gray-800 bg-[#121214] p-4" : "rounded-2xl border border-gray-200 bg-white p-4"}>
                <div className={isDark ? "mb-2 text-sm text-gray-300" : "mb-2 text-sm text-gray-600"}>
                  正在生成，请稍候... 当前进度 {generateProgress}%
                </div>
                <div className={isDark ? "h-2 overflow-hidden rounded-full bg-gray-800" : "h-2 overflow-hidden rounded-full bg-gray-200"}>
                  <div
                    className="h-full rounded-full bg-black transition-all duration-300"
                    style={{ width: `${generateProgress}%` }}
                  />
                </div>
              </div>
            )}

            {pagedVisibleResults.length === 0 ? (
              <div className={isDark ? "rounded-2xl border border-gray-800 bg-[#121214] p-4 text-sm text-gray-400" : "rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-500"}>
                {resultSearchKeyword
                  ? "没有匹配到相关记录"
                  : resultFilter === "favorites"
                    ? "暂无收藏记录"
                    : resultSort === "failedOnly"
                      ? "暂无失败任务"
                      : "暂无任务记录"}
              </div>
            ) : pagedVisibleResults.map(({ item, id, taskId, mediaType, title, prompt: fromTaskPrompt, isFavorite, status, isLatestDone, cost, seconds, duration: videoDuration, upscaleStatus, upscaleErrorMessage, hasReferenceImage: taskHasRef, referenceImageName, referenceImageThumbData: taskRefThumbData, coverData, videoUrl, ratio: videoRatio, size: videoSize, imageSize: resultImageSize, imageModel, displayModel, imageModelLabel, apiModel, kind, scheduledAt, createdAt, taskStatus, agentName }) => (
              <div
                key={id}
                className={
                  isDark
                    ? "relative rounded-2xl border border-gray-800/90 bg-[#121214] p-3 text-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-gray-700 hover:shadow-[0_16px_30px_rgba(0,0,0,0.28)]"
                    : "relative rounded-2xl border border-gray-200 bg-white p-3 text-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-[0_14px_24px_rgba(17,24,39,0.1)]"
                }
              >
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div className="flex items-start gap-3">
                    <div className={`relative group shrink-0 overflow-hidden rounded-2xl ${videoRatio === "9:16" ? "h-20 w-14" : videoRatio === "1:1" ? "h-16 w-16" : "h-16 w-28"}`}>
                      {renderVideoCover({ id, mediaType, coverData, videoUrl, ratio: videoRatio, seconds, duration: videoDuration })}
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
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
                        <span className={isDark ? "rounded-full bg-gray-800/90 px-2.5 py-1 text-[11px] font-medium text-gray-300" : "rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-600"}>
                          {makeTaskId(taskId)}
                        </span>
                        <span className={isDark ? "rounded-full bg-gray-800/90 px-2.5 py-1 text-[11px] font-medium text-gray-300" : "rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-600"}>
                          消耗：¥{formatMoney(cost)}
                        </span>
                        <span className={getStatusClass(status)}>
                          {statusLabelMap[status]}
                        </span>
                        {mediaType === "video" && (
                          <span className={upscaleStatus === "success" ? "rounded-full border border-emerald-400/70 bg-emerald-500/90 px-2.5 py-1 text-[11px] font-medium text-white" : upscaleStatus === "failed" ? "rounded-full border border-rose-400/70 bg-rose-500/90 px-2.5 py-1 text-[11px] font-medium text-white" : upscaleStatus === "processing" || upscaleStatus === "pending" || upscaleStatus === "queued" ? "rounded-full border border-amber-400/70 bg-amber-500/90 px-2.5 py-1 text-[11px] font-medium text-white" : isDark ? "rounded-full border border-gray-700/70 bg-gray-800/90 px-2.5 py-1 text-[11px] font-medium text-gray-300" : "rounded-full border border-gray-200 bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-600"}>
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
                        {isLatestDone && <span className="rounded-full border border-indigo-400/70 bg-indigo-500/90 px-2.5 py-1 text-[11px] font-medium text-white">最新完成</span>}
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
                              {singleLineTitle}
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
                        <span className={isDark ? "rounded-full border border-gray-700/70 bg-gray-800/80 px-2 py-0.5 text-[10px] font-medium text-gray-400" : "rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-500"}>
                          {mediaType === "image" ? `分辨率：${getImageSizeLabel(resultImageSize || videoSize)}` : `时长：${getDurationLabel(seconds, videoDuration)}`}
                        </span>
                        {mediaType === "image" && (
                          <span className={isDark ? "rounded-full border border-gray-700/70 bg-gray-800/80 px-2 py-0.5 text-[10px] font-medium text-gray-400" : "rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-500"}>
                            模型：{formatImageModelLabel({ mediaType, imageModel, displayModel, imageModelLabel, apiModel })}
                          </span>
                        )}
                        <span className={isDark ? "rounded-full border border-gray-700/70 bg-gray-800/80 px-2 py-0.5 text-[10px] font-medium text-gray-400" : "rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-500"}>
                          比例：{getRatioLabel(videoRatio, videoSize)}
                        </span>
                        <span className={isDark ? "rounded-full border border-gray-700/70 bg-gray-800/80 px-2 py-0.5 text-[10px] font-medium text-gray-400" : "rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-500"}>
                          发布时间：{formatTaskPublishTime(createdAt)}
                        </span>
                        <span className={isDark ? "rounded-full border border-gray-700/70 bg-gray-800/80 px-2 py-0.5 text-[10px] font-medium text-gray-400" : "rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-500"}>
                          来源任务：{fromTaskPrompt}
                        </span>
                        <span className={isDark ? "rounded-full border border-gray-700/70 bg-gray-800/80 px-2 py-0.5 text-[10px] font-medium text-gray-400" : "rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-500"}>
                          类型：{kind === "schedule" ? "定时任务" : "普通任务"}
                        </span>
                        {agentName && (
                          <span className={isDark ? "rounded-full border border-gray-700/70 bg-gray-800/80 px-2 py-0.5 text-[10px] font-medium text-gray-400" : "rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-500"}>
                            智能体：{agentName}
                          </span>
                        )}
                        {scheduledAt && (
                          <span className={isDark ? "rounded-full border border-gray-700/70 bg-gray-800/80 px-2 py-0.5 text-[10px] font-medium text-gray-400" : "rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-500"}>
                            {taskStatus === "waiting" ? `预计执行：${new Date(scheduledAt).toLocaleString()}` : `执行时间：${new Date(scheduledAt).toLocaleString()}`}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex w-full max-w-[360px] flex-col items-end gap-2.5 md:w-[360px]">
                    <div className={isDark ? "w-full rounded-2xl border border-gray-800/90 bg-[#151519] p-2 shadow-inner shadow-black/15" : "w-full rounded-2xl border border-gray-200 bg-gray-50/80 p-2 shadow-inner shadow-gray-200/60"}>
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
                          });
                        }}
                        className={
                          isDark
                            ? "w-full whitespace-nowrap rounded-full border border-gray-700 bg-gray-800 px-3 py-1.5 text-center text-xs font-medium text-gray-100 transition-all duration-200 hover:bg-gray-700 hover:shadow-sm"
                            : "w-full whitespace-nowrap rounded-full border border-gray-200 bg-gray-100 px-3 py-1.5 text-center text-xs font-medium text-gray-700 transition-all duration-200 hover:bg-white hover:shadow-sm"
                        }
                      >
                        预览
                      </button>

                      <button
                        onClick={() => handleRegenerate(taskId)}
                        className={
                          isDark
                            ? "w-full whitespace-nowrap rounded-full border border-gray-700 bg-gray-800 px-3 py-1.5 text-center text-xs font-medium text-gray-100 transition-all duration-200 hover:bg-gray-700 hover:shadow-sm"
                            : "w-full whitespace-nowrap rounded-full border border-gray-200 bg-gray-100 px-3 py-1.5 text-center text-xs font-medium text-gray-700 transition-all duration-200 hover:bg-white hover:shadow-sm"
                        }
                      >
                        重新生成
                      </button>

                      <button
                        onClick={() => void handleDownload({ id, item, title, taskId, mediaType, videoUrl, status })}
                        className={
                          isDark
                            ? "w-full whitespace-nowrap rounded-full border border-white/15 bg-white px-3 py-1.5 text-center text-xs font-semibold text-black transition-all duration-200 hover:bg-gray-100 hover:shadow-sm"
                            : "w-full whitespace-nowrap rounded-full bg-black px-3 py-1.5 text-center text-xs font-semibold text-white transition-all duration-200 hover:bg-gray-900 hover:shadow-sm"
                        }
                      >
                        下载
                      </button>

                      <button
                        onClick={() => handleCopy(item, id)}
                        className={
                          isDark
                            ? "w-full whitespace-nowrap rounded-full border border-gray-700 bg-gray-800 px-3 py-1.5 text-center text-xs font-medium text-gray-100 transition duration-200 hover:bg-gray-700 hover:shadow-sm"
                            : "w-full whitespace-nowrap rounded-full border border-gray-200 bg-gray-100 px-3 py-1.5 text-center text-xs font-medium text-gray-700 transition duration-200 hover:bg-white hover:shadow-sm"
                        }
                      >
                        {copiedTaskId === id ? "已复制✓" : "复制文案"}
                      </button>

                      <button
                        onClick={() => handleToggleFavorite(id)}
                        className={
                          isFavorite
                            ? "w-full whitespace-nowrap rounded-full bg-yellow-400 px-3 py-1.5 text-center text-xs font-medium text-black transition duration-200 hover:brightness-95 hover:shadow-sm"
                            : isDark
                              ? "w-full whitespace-nowrap rounded-full border border-gray-700 bg-gray-800 px-3 py-1.5 text-center text-xs font-medium text-gray-100 transition duration-200 hover:bg-gray-700 hover:shadow-sm"
                              : "w-full whitespace-nowrap rounded-full border border-gray-200 bg-gray-100 px-3 py-1.5 text-center text-xs font-medium text-gray-700 transition duration-200 hover:bg-white hover:shadow-sm"
                        }
                      >
                        {isFavorite ? "已收藏" : "收藏"}
                      </button>

                      <button
                        onClick={() => handleDeleteResult(id)}
                        className={
                          isDark
                            ? "w-full whitespace-nowrap rounded-full border border-gray-700 bg-gray-800 px-3 py-1.5 text-center text-xs font-medium text-gray-100 transition duration-200 hover:bg-gray-700 hover:shadow-sm"
                            : "w-full whitespace-nowrap rounded-full border border-gray-200 bg-gray-100 px-3 py-1.5 text-center text-xs font-medium text-gray-700 transition duration-200 hover:bg-white hover:shadow-sm"
                        }
                      >
                        删除
                      </button>
                    </div>
                    </div>

                    {kind === "schedule" && taskStatus === "waiting" && (
                      <button
                        onClick={() => handleCancelScheduledTask(taskId)}
                        className={isDark ? "rounded-full bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-100 transition hover:brightness-125" : "rounded-full bg-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:brightness-95"}
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
            {visibleResults.length > PAGE_SIZE && (
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setResultPage((prev) => Math.max(1, prev - 1))}
                  disabled={resultPage <= 1}
                  className={isDark ? "rounded-full bg-gray-800 px-3 py-2 text-xs text-gray-100 disabled:opacity-40" : "rounded-full bg-gray-100 px-3 py-2 text-xs text-gray-700 disabled:opacity-40"}
                >
                  上一页
                </button>
                <span className={isDark ? "text-xs text-gray-400" : "text-xs text-gray-500"}>
                  第 {resultPage} / {resultTotalPages} 页
                </span>
                <button
                  onClick={() => setResultPage((prev) => Math.min(resultTotalPages, prev + 1))}
                  disabled={resultPage >= resultTotalPages}
                  className={isDark ? "rounded-full bg-gray-800 px-3 py-2 text-xs text-gray-100 disabled:opacity-40" : "rounded-full bg-gray-100 px-3 py-2 text-xs text-gray-700 disabled:opacity-40"}
                >
                  下一页
                </button>
              </div>
            )}
          </div>
        )}

        {isTaskDrawerOpen && (
          <div
            className="fixed inset-0 z-40 flex justify-end bg-black/40"
            onClick={() => setIsTaskDrawerOpen(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className={
                isDark
                  ? "flex h-full w-full max-w-lg flex-col overflow-hidden border-l border-gray-800 bg-[#121214] p-4 shadow-[0_24px_48px_rgba(0,0,0,0.38)] transition-all duration-300"
                  : "flex h-full w-full max-w-lg flex-col overflow-hidden border-l border-gray-200 bg-white p-4 shadow-[0_20px_38px_rgba(15,23,42,0.16)] transition-all duration-300"
              }
            >
              <div className="mb-3 shrink-0 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-base font-semibold">任务记录</div>
                    <div className={isDark ? "mt-0.5 text-xs text-gray-400" : "mt-0.5 text-xs text-gray-500"}>
                      共 {tasks.length} 条任务，收藏 {favorites.length} 条
                    </div>
                  </div>
                  <button
                    onClick={() => setIsTaskDrawerOpen(false)}
                    className={
                      isDark
                        ? "rounded-full bg-gray-800 px-3 py-1.5 text-xs text-gray-100"
                        : "rounded-full bg-gray-100 px-3 py-1.5 text-xs text-gray-700"
                    }
                  >
                    关闭
                  </button>
                </div>

                <div className={isDark ? "rounded-2xl border border-gray-800 bg-[#18181b] p-3 shadow-inner shadow-black/10" : "rounded-2xl border border-gray-200 bg-gray-50 p-3 shadow-inner shadow-gray-200/70"}>
                  <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
                    <div className={isDark ? "rounded-xl border border-gray-800/70 bg-[#141417] px-2.5 py-2" : "rounded-xl border border-gray-200 bg-white px-2.5 py-2"}>
                      <div className={isDark ? "text-[11px] text-gray-400" : "text-[11px] text-gray-500"}>今日生成</div>
                      <div className="mt-0.5 text-base font-semibold tracking-wide">{todayGeneratedCount}</div>
                    </div>
                    <div className={isDark ? "rounded-xl border border-gray-800/70 bg-[#141417] px-2.5 py-2" : "rounded-xl border border-gray-200 bg-white px-2.5 py-2"}>
                      <div className={isDark ? "text-[11px] text-gray-400" : "text-[11px] text-gray-500"}>累计生成</div>
                      <div className="mt-0.5 text-base font-semibold tracking-wide">{totalGeneratedCount}</div>
                    </div>
                    <div className={isDark ? "rounded-xl border border-gray-800/70 bg-[#141417] px-2.5 py-2" : "rounded-xl border border-gray-200 bg-white px-2.5 py-2"}>
                      <div className={isDark ? "text-[11px] text-gray-400" : "text-[11px] text-gray-500"}>已收藏</div>
                      <div className="mt-0.5 text-base font-semibold tracking-wide">{favorites.length}</div>
                    </div>
                    <div className={isDark ? "rounded-xl border border-gray-800/70 bg-[#141417] px-2.5 py-2" : "rounded-xl border border-gray-200 bg-white px-2.5 py-2"}>
                      <div className={isDark ? "text-[11px] text-gray-400" : "text-[11px] text-gray-500"}>累计消耗</div>
                      <div className="mt-0.5 text-base font-semibold tracking-wide">¥{totalCost}</div>
                    </div>
                    <div className={isDark ? "rounded-xl border border-gray-800/70 bg-[#141417] px-2.5 py-2" : "rounded-xl border border-gray-200 bg-white px-2.5 py-2"}>
                      <div className={isDark ? "text-[11px] text-gray-400" : "text-[11px] text-gray-500"}>成功任务</div>
                      <div className="mt-0.5 text-base font-semibold tracking-wide">{successTaskCount}</div>
                    </div>
                    <div className={isDark ? "rounded-xl border border-gray-800/70 bg-[#141417] px-2.5 py-2" : "rounded-xl border border-gray-200 bg-white px-2.5 py-2"}>
                      <div className={isDark ? "text-[11px] text-gray-400" : "text-[11px] text-gray-500"}>失败任务</div>
                      <div className="mt-0.5 text-base font-semibold tracking-wide">{failedTaskCount}</div>
                    </div>
                    <div className={isDark ? "rounded-xl border border-gray-800/70 bg-[#141417] px-2.5 py-2" : "rounded-xl border border-gray-200 bg-white px-2.5 py-2"}>
                      <div className={isDark ? "text-[11px] text-gray-400" : "text-[11px] text-gray-500"}>定时任务</div>
                      <div className="mt-0.5 text-base font-semibold tracking-wide">{scheduledTaskCount}</div>
                    </div>
                    <div className={isDark ? "rounded-xl border border-gray-800/70 bg-[#141417] px-2.5 py-2" : "rounded-xl border border-gray-200 bg-white px-2.5 py-2"}>
                      <div className={isDark ? "text-[11px] text-gray-400" : "text-[11px] text-gray-500"}>成功率</div>
                      <div className="mt-0.5 text-base font-semibold tracking-wide">{successRate}</div>
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
                    className={
                      isDark
                        ? "flex-1 rounded-xl border border-gray-800 bg-[#18181b] px-3 py-1.5 text-xs text-gray-100 outline-none placeholder:text-gray-500"
                        : "flex-1 rounded-xl border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-700 outline-none placeholder:text-gray-400"
                    }
                  />

                  <button
                    onClick={() => {
                      setTaskSearch("");
                      showToast("已显示全部任务");
                    }}
                    className={
                      isDark
                        ? "rounded-full bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-100"
                        : "rounded-full bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700"
                    }
                  >
                    清空
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => setTaskDrawerFilter("all")}
                    className={
                      taskDrawerFilter === "all"
                        ? isDark
                          ? "rounded-full bg-white px-3 py-1.5 text-xs font-medium text-black"
                          : "rounded-full bg-black px-3 py-1.5 text-xs font-medium text-white"
                        : isDark
                          ? "rounded-full bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-100"
                          : "rounded-full bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700"
                    }
                  >
                    全部
                  </button>
                  <button
                    onClick={() => setTaskDrawerFilter("favorites")}
                    className={
                      taskDrawerFilter === "favorites"
                        ? "rounded-full bg-yellow-400 px-3 py-1.5 text-xs font-medium text-black"
                        : isDark
                          ? "rounded-full bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-100"
                          : "rounded-full bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700"
                    }
                  >
                    仅收藏
                  </button>
                  <button
                    onClick={() => setTaskDrawerFilter("generating")}
                    className={
                      taskDrawerFilter === "generating"
                        ? "rounded-full bg-yellow-400 px-3 py-1.5 text-xs font-medium text-black"
                        : isDark
                          ? "rounded-full bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-100"
                          : "rounded-full bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700"
                    }
                  >
                    生成中
                  </button>
                  <button
                    onClick={() => setTaskDrawerFilter("success")}
                    className={
                      taskDrawerFilter === "success"
                        ? "rounded-full bg-green-500 px-3 py-1.5 text-xs font-medium text-white"
                        : isDark
                          ? "rounded-full bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-100"
                          : "rounded-full bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700"
                    }
                  >
                    已完成
                  </button>
                  <button
                    onClick={() => setTaskDrawerFilter("failed")}
                    className={
                      taskDrawerFilter === "failed"
                        ? "rounded-full bg-red-500 px-3 py-1.5 text-xs font-medium text-white"
                        : isDark
                          ? "rounded-full bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-100"
                          : "rounded-full bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700"
                    }
                  >
                    失败
                  </button>
                  <button
                    onClick={() => setTaskDrawerFilter("waiting")}
                    className={
                      taskDrawerFilter === "waiting"
                        ? "rounded-full bg-gray-500 px-3 py-1.5 text-xs font-medium text-white"
                        : isDark
                          ? "rounded-full bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-100"
                          : "rounded-full bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700"
                    }
                  >
                    定时中
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className={isDark ? "rounded-full bg-gray-800 px-3 py-1.5 text-xs text-gray-200" : "rounded-full bg-gray-100 px-3 py-1.5 text-xs text-gray-700"}>
                    已选 {selectedTaskIds.length} 条
                  </span>
                  <button
                    onClick={handleBatchDelete}
                    className={isDark ? "rounded-full border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-100 transition hover:bg-gray-700" : "rounded-full border border-gray-200 bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-white"}
                  >
                    批量删除
                  </button>
                  <button
                    onClick={() => handleBatchFavorite(true)}
                    className={isDark ? "rounded-full bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-100" : "rounded-full bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700"}
                  >
                    批量收藏
                  </button>
                  <button
                    onClick={() => handleBatchFavorite(false)}
                    className={isDark ? "rounded-full bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-100" : "rounded-full bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700"}
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
                  pagedDrawerRecords.map(({ item, id, isFavorite, status, isLatestDone, cost, hasReferenceImage: taskHasRef, referenceImageName, referenceImageThumbData: taskRefThumbData, kind, scheduledAt, createdAt, totalVideos, successVideos, failedVideos, agentName, agentAccess }) => (
                    <div key={id} className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={selectedTaskIds.includes(id)}
                        onChange={() => handleToggleSelectedTask(id)}
                        className="mt-3 h-4 w-4 rounded border-gray-400"
                      />
                      <div
                        onClick={() => setTaskDetailId(id)}
                        className={
                          isDark
                            ? "flex-1 cursor-pointer rounded-2xl border border-gray-800 bg-[#18181b] p-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-gray-700 hover:bg-[#1f1f24] hover:shadow-[0_10px_20px_rgba(0,0,0,0.22)]"
                            : "flex-1 cursor-pointer rounded-2xl border border-gray-200 bg-gray-50 p-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-gray-300 hover:bg-white hover:shadow-[0_10px_18px_rgba(15,23,42,0.08)]"
                        }
                      >
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={isDark ? "rounded-full bg-gray-700 px-2.5 py-1 text-xs text-gray-200" : "rounded-full bg-white px-2.5 py-1 text-xs text-gray-600"}>
                            {makeTaskId(id)}
                          </span>
                          <span className={isDark ? "rounded-full bg-gray-700 px-2.5 py-1 text-xs text-gray-200" : "rounded-full bg-white px-2.5 py-1 text-xs text-gray-600"}>
                            {isFavorite ? "已收藏" : "未收藏"}
                          </span>
                          <span className={getStatusClass(status)}>
                            {statusLabelMap[status]}
                          </span>
                          <span className={isDark ? "rounded-full bg-gray-700 px-2.5 py-1 text-xs text-gray-200" : "rounded-full bg-white px-2.5 py-1 text-xs text-gray-600"}>
                            {kind === "schedule" ? "定时任务" : "普通任务"}
                          </span>
                          <span className={isDark ? "rounded-full bg-gray-700 px-2.5 py-1 text-xs text-gray-200" : "rounded-full bg-white px-2.5 py-1 text-xs text-gray-600"}>
                            消耗 ¥{formatMoney(cost)}
                          </span>
                          <span className={isDark ? "rounded-full bg-gray-700 px-2.5 py-1 text-xs text-gray-200" : "rounded-full bg-white px-2.5 py-1 text-xs text-gray-600"}>
                            作品：{totalVideos}（成功 {successVideos} / 失败 {failedVideos}）
                          </span>
                          {agentName && (
                            <span className={isDark ? "rounded-full bg-gray-700 px-2.5 py-1 text-xs text-gray-200" : "rounded-full bg-white px-2.5 py-1 text-xs text-gray-600"}>
                              智能体：{agentName}
                            </span>
                          )}
                          {agentName && (
                            <span className={isDark ? "rounded-full bg-gray-700 px-2.5 py-1 text-xs text-gray-200" : "rounded-full bg-white px-2.5 py-1 text-xs text-gray-600"}>
                              权限：{agentAccess === "restricted" ? "授权智能体" : "公开可用"}
                            </span>
                          )}
                          <span className={isDark ? "rounded-full bg-gray-700 px-2.5 py-1 text-xs text-gray-200" : "rounded-full bg-white px-2.5 py-1 text-xs text-gray-600"}>
                            参考图：{taskHasRef ? "已添加" : "未添加"}
                          </span>
                          {isLatestDone && <span className="rounded-full border border-indigo-400/70 bg-indigo-500/90 px-3 py-1 text-xs font-medium text-white">最新完成</span>}
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
                            <span className={isDark ? "rounded-full bg-gray-700 px-2.5 py-1 text-xs text-gray-200" : "rounded-full bg-white px-2.5 py-1 text-xs text-gray-600"}>
                              发布时间：{formatTaskPublishTime(createdAt)}
                            </span>
                            {scheduledAt && (
                              <span className={isDark ? "rounded-full bg-gray-700 px-2.5 py-1 text-xs text-gray-200" : "rounded-full bg-white px-2.5 py-1 text-xs text-gray-600"}>
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
                              className={
                                isDark
                                  ? "rounded-full bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-100 transition hover:brightness-125"
                                  : "rounded-full bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:brightness-95"
                              }
                            >
                              预览
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleCopy(item, id);
                              }}
                              className={
                                isDark
                                  ? "rounded-full bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-100 transition hover:brightness-125"
                                  : "rounded-full bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:brightness-95"
                              }
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
                                  ? "rounded-full bg-yellow-400 px-3 py-1.5 text-xs font-medium text-black"
                                  : isDark
                                    ? "rounded-full bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-100"
                                    : "rounded-full bg-white px-3 py-1.5 text-xs font-medium text-gray-700"
                              }
                            >
                              {isFavorite ? "取消收藏" : "收藏"}
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteTask(id);
                              }}
                              className={isDark ? "rounded-full border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-100 transition hover:bg-gray-700" : "rounded-full border border-gray-200 bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-white"}
                            >
                              删除
                            </button>
                            {kind === "schedule" && status === "waiting" && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCancelScheduledTask(id);
                                }}
                                className={isDark ? "rounded-full bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-100 transition hover:brightness-125" : "rounded-full bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:brightness-95"}
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
              <div className={isDark ? "shrink-0 border-t border-gray-800/90 bg-[#121214] pb-[max(8px,env(safe-area-inset-bottom))] pt-3" : "shrink-0 border-t border-gray-200 bg-white pb-[max(8px,env(safe-area-inset-bottom))] pt-3"}>
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => setDrawerPage((prev) => Math.max(1, prev - 1))}
                    disabled={drawerPage <= 1}
                    className={isDark ? "rounded-full bg-gray-800 px-3 py-2 text-xs text-gray-100 disabled:opacity-40" : "rounded-full bg-gray-100 px-3 py-2 text-xs text-gray-700 disabled:opacity-40"}
                  >
                    上一页
                  </button>
                  <span className={isDark ? "text-xs text-gray-400" : "text-xs text-gray-500"}>
                    第 {Math.min(drawerPage, drawerTotalPages)} / {drawerTotalPages} 页
                  </span>
                  <button
                    onClick={() => setDrawerPage((prev) => Math.min(drawerTotalPages, prev + 1))}
                    disabled={drawerPage >= drawerTotalPages}
                    className={isDark ? "rounded-full bg-gray-800 px-3 py-2 text-xs text-gray-100 disabled:opacity-40" : "rounded-full bg-gray-100 px-3 py-2 text-xs text-gray-700 disabled:opacity-40"}
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
            className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 px-4"
            onClick={() => setPreviewVideo(null)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className={
                isDark
                  ? `w-full ${previewVideo.mediaType === "image" ? "max-h-[90vh] max-w-[70vw] overflow-hidden p-4" : "max-w-lg p-6"} rounded-3xl border border-gray-800 bg-[#121214] shadow-xl`
                  : `w-full ${previewVideo.mediaType === "image" ? "max-h-[90vh] max-w-[70vw] overflow-hidden p-4" : "max-w-lg p-6"} rounded-3xl border border-gray-200 bg-white shadow-xl`
              }
            >
              {!previewVideo ? (
                <div className="space-y-4">
                  <div className="text-lg font-semibold">{previewVideo.mediaType === "image" ? "图片预览" : "视频预览"}</div>
                  <div className={isDark ? "text-sm text-gray-300" : "text-sm text-gray-600"}>未找到对应视频数据，请稍后重试。</div>
                  <div className="flex justify-end">
                    <button
                      onClick={() => setPreviewVideo(null)}
                      className={
                        isDark
                          ? "rounded-full bg-gray-800 px-3 py-1 text-sm text-gray-100"
                          : "rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700"
                      }
                    >
                      关闭
                    </button>
                  </div>
                </div>
              ) : (
                <>
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="text-lg font-semibold">{previewVideo.mediaType === "image" ? "图片预览" : "视频预览"}</div>
                  <span className={isDark ? "rounded-full bg-gray-800 px-2 py-1 text-xs text-gray-300" : "rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600"}>
                    {makeTaskId(previewVideo.taskId)}
                  </span>
                  <span className={getStatusClass(previewVideo.status as TaskStatus)}>
                    {statusLabelMap[previewVideo.status as TaskStatus]}
                  </span>
                  {previewVideo.mediaType !== "image" && (
                    <span className={previewVideo.upscaleStatus === "success" ? "rounded-full border border-emerald-400/70 bg-emerald-500/90 px-2 py-1 text-xs font-medium text-white" : previewVideo.upscaleStatus === "failed" ? "rounded-full border border-rose-400/70 bg-rose-500/90 px-2 py-1 text-xs font-medium text-white" : previewVideo.upscaleStatus === "processing" || previewVideo.upscaleStatus === "pending" || previewVideo.upscaleStatus === "queued" ? "rounded-full border border-amber-400/70 bg-amber-500/90 px-2 py-1 text-xs font-medium text-white" : isDark ? "rounded-full border border-gray-700/70 bg-gray-800/90 px-2 py-1 text-xs font-medium text-gray-300" : "rounded-full border border-gray-200 bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600"}>
                      {getUpscaleStatusLabel(previewVideo.upscaleStatus)}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setPreviewVideo(null)}
                  className={
                    isDark
                      ? "rounded-full bg-gray-800 px-3 py-1 text-sm text-gray-100"
                      : "rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700"
                  }
                >
                  关闭
                </button>
              </div>

              <div className={previewVideo.mediaType === "image" ? "max-h-[calc(90vh-5.5rem)] space-y-4 overflow-y-auto pr-1" : "space-y-4"}>
                {previewVideo.mediaType === "image" && (
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <span className={isDark ? "text-xs text-gray-400" : "text-xs text-gray-500"}>
                      缩放：{Math.round(imagePreviewScale * 100)}%
                    </span>
                    <button
                      onClick={() => setImagePreviewScale((prev) => Math.min(3, Number((prev + 0.25).toFixed(2))))}
                      className={isDark ? "rounded-full bg-gray-800 px-3 py-1 text-xs text-gray-100" : "rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700"}
                    >
                      放大
                    </button>
                    <button
                      onClick={() => setImagePreviewScale((prev) => Math.max(0.5, Number((prev - 0.25).toFixed(2))))}
                      className={isDark ? "rounded-full bg-gray-800 px-3 py-1 text-xs text-gray-100" : "rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700"}
                    >
                      缩小
                    </button>
                    <button
                      onClick={() => setImagePreviewScale(1)}
                      className={isDark ? "rounded-full bg-gray-800 px-3 py-1 text-xs text-gray-100" : "rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700"}
                    >
                      重置
                    </button>
                    <span className={isDark ? "mx-1 h-5 w-px bg-gray-700" : "mx-1 h-5 w-px bg-gray-200"} />
                    <button
                      onClick={() => void handleDownload(previewVideo)}
                      className={isDark ? "rounded-full border border-white/15 bg-white px-3 py-1 text-xs font-semibold text-black" : "rounded-full bg-black px-3 py-1 text-xs font-semibold text-white"}
                    >
                      下载
                    </button>
                    <button
                      onClick={() => handleCopy(previewVideo.item)}
                      className={isDark ? "rounded-full border border-gray-700 bg-gray-800 px-3 py-1 text-xs font-medium text-gray-100" : "rounded-full border border-gray-200 bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700"}
                    >
                      {isPreviewCopied ? "已复制✓" : "复制文案"}
                    </button>
                  </div>
                )}
                <div
                  className={
                    previewVideo.mediaType === "image"
                      ? isDark
                        ? "relative max-h-[60vh] overflow-auto rounded-2xl border border-gray-800 bg-[#18181b]"
                        : "relative max-h-[60vh] overflow-auto rounded-2xl border border-gray-200 bg-gray-50"
                      : isDark
                        ? "relative h-52 overflow-hidden rounded-2xl border border-gray-800 bg-[#18181b]"
                        : "relative h-52 overflow-hidden rounded-2xl border border-gray-200 bg-gray-50"
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
                    <span className={isDark ? "rounded-full bg-gray-800 px-3 py-1 text-xs text-gray-300" : "rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600"}>
                      预览状态：可查看
                    </span>
                    <span className={isDark ? "rounded-full bg-gray-800 px-3 py-1 text-xs text-gray-300" : "rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600"}>
                      消耗：¥{formatMoney(previewVideo.cost)}
                    </span>
                    {previewVideo.mediaType === "image" ? (
                      <>
                        <span className={isDark ? "rounded-full bg-gray-800 px-3 py-1 text-xs text-gray-300" : "rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600"}>
                          分辨率：{getImageSizeLabel(previewVideo.imageSize || previewVideo.size)}
                        </span>
                        <span className={isDark ? "rounded-full bg-gray-800 px-3 py-1 text-xs text-gray-300" : "rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600"}>
                          模型：{formatImageModelLabel(previewVideo)}
                        </span>
                      </>
                    ) : (
                      <span className={isDark ? "rounded-full bg-gray-800 px-3 py-1 text-xs text-gray-300" : "rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600"}>
                        时长：{getDurationLabel(previewVideo.seconds, previewVideo.duration)}
                      </span>
                    )}
                    <span className={isDark ? "rounded-full bg-gray-800 px-3 py-1 text-xs text-gray-300" : "rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600"}>
                      比例：{getRatioLabel(previewVideo.ratio, previewVideo.size)}
                    </span>
                    <span className={isDark ? "rounded-full bg-gray-800 px-3 py-1 text-xs text-gray-300" : "rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600"}>
                      参考图：{previewVideo.hasReferenceImage ? `已添加${previewVideo.referenceImageName ? `（${previewVideo.referenceImageName}）` : ""}` : "未添加"}
                    </span>
                    {previewVideo.mediaType !== "image" && previewVideo.upscaleStatus === "failed" && (
                      <button
                        onClick={() => handleRetryUpscale(previewVideo.id)}
                        title={previewVideo.upscaleErrorMessage || "仅重试超分"}
                        className="rounded-full bg-emerald-500 px-3 py-1 text-xs font-medium text-white transition hover:brightness-110"
                      >
                        重试超分
                      </button>
                    )}
                  </div>

                  <div
                    className={
                      isDark
                        ? "rounded-2xl border border-gray-800 bg-[#18181b] p-4 text-sm leading-6 text-gray-100"
                        : "rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm leading-6 text-gray-700"
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
                        ? "rounded-full border border-white/15 bg-white px-4 py-2 text-sm font-semibold text-black"
                        : "rounded-full bg-black px-4 py-2 text-sm font-semibold text-white"
                    }
                  >
                    下载
                  </button>
                  <button
                    onClick={() => handleCopy(previewVideo.item)}
                    className={
                      isDark
                        ? "rounded-full border border-gray-700 bg-gray-800 px-4 py-2 text-sm font-medium text-gray-100"
                        : "rounded-full border border-gray-200 bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700"
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
            className="fixed inset-0 z-[95] flex items-center justify-center bg-black/60 px-4"
            onClick={() => {
              setReferencePreviewOpen(false);
              setReferencePreviewData(null);
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className={isDark ? "w-full max-w-3xl rounded-3xl border border-gray-800 bg-[#121214] p-5 shadow-xl" : "w-full max-w-3xl rounded-3xl border border-gray-200 bg-white p-5 shadow-xl"}
            >
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-medium">{referencePreviewTitle || "参考图预览"}</div>
                <button
                  onClick={() => {
                    setReferencePreviewOpen(false);
                    setReferencePreviewData(null);
                  }}
                  className={isDark ? "rounded-full bg-gray-800 px-3 py-1.5 text-xs text-gray-100" : "rounded-full bg-gray-100 px-3 py-1.5 text-xs text-gray-700"}
                >
                  关闭
                </button>
              </div>
              <div className={isDark ? "max-h-[72vh] overflow-auto rounded-2xl border border-gray-800 bg-[#18181b] p-2" : "max-h-[72vh] overflow-auto rounded-2xl border border-gray-200 bg-gray-50 p-2"}>
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
            className="fixed inset-0 z-40 flex items-center justify-center bg-black/55 px-4 transition-all duration-200"
            onClick={() => setTaskDetailId(null)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className={
                isDark
                  ? "flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-gray-800/90 bg-[#121214] shadow-[0_28px_58px_rgba(0,0,0,0.4)]"
                  : "flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-[0_24px_50px_rgba(15,23,42,0.16)]"
              }
            >
              <div className={isDark ? "sticky top-0 z-10 flex items-center justify-between border-b border-gray-800 bg-[#121214]/95 px-6 py-4 backdrop-blur" : "sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white/95 px-6 py-4 backdrop-blur"}>
                <div className="flex items-center gap-2">
                  <div className="text-lg font-semibold">任务详情</div>
                  <span className={isDark ? "rounded-full bg-gray-800 px-2 py-1 text-xs text-gray-300" : "rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600"}>
                    {makeTaskId(detailTask.id)}
                  </span>
                </div>
                <button
                  onClick={() => setTaskDetailId(null)}
                  className={isDark ? "rounded-full bg-gray-800 px-3 py-1.5 text-xs text-gray-100" : "rounded-full bg-gray-100 px-3 py-1.5 text-xs text-gray-700"}
                >
                  关闭
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-4">
                <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={getStatusClass(detailTask.status)}>{statusLabelMap[detailTask.status]}</span>
                      <span className={isDark ? "rounded-full bg-gray-800 px-3 py-1 text-xs text-gray-300" : "rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600"}>
                        类型：{detailTask.kind === "schedule" ? "定时任务" : "普通任务"}
                      </span>
                      <span className={isDark ? "rounded-full bg-gray-800 px-3 py-1 text-xs text-gray-300" : "rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600"}>
                        发布时间：{formatTaskPublishTime(detailTask.createdAt)}
                      </span>
                      <span className={isDark ? "rounded-full bg-gray-800 px-3 py-1 text-xs text-gray-300" : "rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600"}>
                        消耗：¥{formatMoney(detailTask.cost)}
                      </span>
                      {activeDetailVideo?.mediaType === "image" ? (
                        <>
                          <span className={isDark ? "rounded-full bg-gray-800 px-3 py-1 text-xs text-gray-300" : "rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600"}>
                            分辨率：{getImageSizeLabel(activeDetailVideo.imageSize || activeDetailVideo.size)}
                          </span>
                          <span className={isDark ? "rounded-full bg-gray-800 px-3 py-1 text-xs text-gray-300" : "rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600"}>
                            模型：{formatImageModelLabel(activeDetailVideo)}
                          </span>
                        </>
                      ) : (
                        <span className={isDark ? "rounded-full bg-gray-800 px-3 py-1 text-xs text-gray-300" : "rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600"}>
                          时长：{getDurationLabel(activeDetailVideo?.seconds, activeDetailVideo?.duration)}
                        </span>
                      )}
                      <span className={isDark ? "rounded-full bg-gray-800 px-3 py-1 text-xs text-gray-300" : "rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600"}>
                        比例：{getRatioLabel(activeDetailVideo?.ratio, activeDetailVideo?.size)}
                      </span>
                      {detailTask.agentName && (
                        <span className={isDark ? "rounded-full bg-gray-800 px-3 py-1 text-xs text-gray-300" : "rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600"}>
                          智能体：{detailTask.agentName}
                        </span>
                      )}
                      {detailTask.agentName && (
                        <span className={isDark ? "rounded-full bg-gray-800 px-3 py-1 text-xs text-gray-300" : "rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600"}>
                          智能体权限：{detailTask.agentAccess === "restricted" ? "授权智能体" : "公开可用"}
                        </span>
                      )}
                      <span className={isDark ? "rounded-full bg-gray-800 px-3 py-1 text-xs text-gray-300" : "rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600"}>
                        收藏：{detailVideos.some((video) => favorites.includes(video.id)) ? "是" : "否"}
                      </span>
                      <span className={isDark ? "rounded-full bg-gray-800 px-3 py-1 text-xs text-gray-300" : "rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600"}>
                        参考图：{detailTask.hasReferenceImage ? "已启用" : "未启用"}
                      </span>
                      {detailTask.scheduledAt && (
                        <span className={isDark ? "rounded-full bg-gray-800 px-3 py-1 text-xs text-gray-300" : "rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600"}>
                          {detailTask.status === "waiting" ? `预计执行：${new Date(detailTask.scheduledAt).toLocaleString()}` : `执行时间：${new Date(detailTask.scheduledAt).toLocaleString()}`}
                        </span>
                      )}
                    </div>
                    <div className={isDark ? "rounded-2xl border border-gray-800/90 bg-[#18181b] p-4 text-sm leading-6 text-gray-100 shadow-inner shadow-black/15" : "rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm leading-6 text-gray-700 shadow-inner shadow-gray-200/70"}>
                      {detailTask.item}
                    </div>
                    <div className={isDark ? "rounded-2xl border border-gray-800/90 bg-[#18181b] p-3" : "rounded-2xl border border-gray-200 bg-gray-50 p-3"}>
                      <div className="mb-2 text-xs font-medium">任务作品（{detailVideos.length}）</div>
                      {detailVideos.length === 0 ? (
                        <div className={isDark ? "text-xs text-gray-400" : "text-xs text-gray-500"}>该任务暂无生成作品</div>
                      ) : (
                        <div className="space-y-3">
                          {detailVideos.map((video) => (
                            <div
                              key={video.id}
                              onClick={() => setDetailVideoId(video.id)}
                              className={isDark ? `cursor-pointer rounded-2xl border p-2.5 transition-all duration-200 ${detailVideoId === video.id ? "border-indigo-400/70 bg-[#1a1a20] shadow-[0_8px_18px_rgba(79,70,229,0.16)]" : "border-gray-700 hover:-translate-y-0.5 hover:border-gray-600 hover:bg-[#1d1d23] hover:shadow-[0_8px_16px_rgba(0,0,0,0.2)]"}` : `cursor-pointer rounded-2xl border p-2.5 transition-all duration-200 ${detailVideoId === video.id ? "border-indigo-300 bg-indigo-50/40 shadow-[0_8px_16px_rgba(99,102,241,0.1)]" : "border-gray-200 bg-white hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-[0_8px_16px_rgba(15,23,42,0.08)]"}`}
                            >
                              <div className="flex items-start gap-2">
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setPreviewVideo(video);
                                  }}
                                  className={`group shrink-0 cursor-pointer overflow-hidden rounded-2xl ${video.ratio === "9:16" ? "h-20 w-14" : video.ratio === "1:1" ? "h-16 w-16" : "h-16 w-28"}`}
                                >
                                  {renderVideoCover({ id: video.id, mediaType: video.mediaType, coverData: video.coverData, videoUrl: video.videoUrl, ratio: video.ratio, seconds: video.seconds, duration: video.duration })}
                                </button>
                                <div className="min-w-0 flex-1">
                                  <div className="mb-1 flex flex-wrap items-center gap-2">
                                    <span className={isDark ? "rounded-full bg-gray-700 px-2 py-0.5 text-xs font-medium text-gray-200" : "rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600"}>
                                      {video.mediaType === "image" ? "IMAGE" : "VIDEO"}-{String(video.id).padStart(3, "0")}
                                    </span>
                                    <span className={video.status === "success" ? "rounded-full border border-emerald-400/70 bg-emerald-500/90 px-2 py-0.5 text-xs font-medium text-white" : "rounded-full border border-rose-400/70 bg-rose-500/90 px-2 py-0.5 text-xs font-medium text-white"}>
                                      {video.status === "success" ? "已完成" : "失败"}
                                    </span>
                                    {video.mediaType !== "image" && (
                                      <span className={video.upscaleStatus === "success" ? "rounded-full border border-emerald-400/70 bg-emerald-500/90 px-2 py-0.5 text-xs font-medium text-white" : video.upscaleStatus === "failed" ? "rounded-full border border-rose-400/70 bg-rose-500/90 px-2 py-0.5 text-xs font-medium text-white" : video.upscaleStatus === "processing" || video.upscaleStatus === "pending" || video.upscaleStatus === "queued" ? "rounded-full border border-amber-400/70 bg-amber-500/90 px-2 py-0.5 text-xs font-medium text-white" : isDark ? "rounded-full border border-gray-600 bg-gray-700 px-2 py-0.5 text-xs font-medium text-gray-200" : "rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600"}>
                                        {getUpscaleStatusLabel(video.upscaleStatus)}
                                      </span>
                                    )}
                                    {video.mediaType !== "image" && video.upscaleStatus === "success" && (
                                      <span className={isDark ? "rounded-full bg-emerald-900/50 px-2 py-0.5 text-xs text-emerald-200" : "rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700"}>
                                        预览/下载：超分视频优先
                                      </span>
                                    )}
                                    {video.mediaType !== "image" && video.upscaleStatus === "failed" && (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleRetryUpscale(video.id);
                                        }}
                                        title={video.upscaleErrorMessage || "仅重试超分"}
                                        className="rounded-full bg-emerald-500 px-2 py-0.5 text-xs font-medium text-white transition hover:brightness-110"
                                      >
                                        重试超分
                                      </button>
                                    )}
                                    <span className={isDark ? "rounded-full bg-gray-700 px-2 py-0.5 text-xs text-gray-200" : "rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"}>
                                      比例：{getRatioLabel(video.ratio, video.size)}
                                    </span>
                                    {video.mediaType === "image" && (
                                      <span className={isDark ? "rounded-full bg-gray-700 px-2 py-0.5 text-xs text-gray-200" : "rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"}>
                                        分辨率：{getImageSizeLabel(video.imageSize || video.size)}
                                      </span>
                                    )}
                                  </div>
                                  <div className="mb-2 text-xs leading-5">{video.item}</div>
                                  {video.script && video.script.length > 0 && (
                                    <div className={isDark ? "mb-2 rounded-xl border border-gray-700 bg-[#141417] p-2" : "mb-2 rounded-xl border border-gray-200 bg-gray-50 p-2"}>
                                      <div className="mb-1 text-[11px] font-medium">分镜脚本</div>
                                      <div className="space-y-1">
                                        {video.script.map((scene, sceneIndex) => (
                                          <div key={`${video.id}-scene-${sceneIndex}`} className={isDark ? "text-[11px] text-gray-300" : "text-[11px] text-gray-600"}>
                                            {sceneIndex + 1}. {scene}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {video.promptText && (
                                    <div className={isDark ? "mb-2 rounded-xl border border-gray-700 bg-[#141417] p-2" : "mb-2 rounded-xl border border-gray-200 bg-gray-50 p-2"}>
                                      <div className="mb-1 flex items-center justify-between gap-2">
                                        <span className="text-[11px] font-medium">{video.mediaType === "image" ? "图片提示词" : "视频提示词"}</span>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            void handleCopy(video.promptText ?? "", video.id);
                                          }}
                                          className={isDark ? "rounded-full bg-gray-700 px-2 py-0.5 text-[10px] text-gray-100" : "rounded-full bg-white px-2 py-0.5 text-[10px] text-gray-700"}
                                        >
                                          复制提示词
                                        </button>
                                      </div>
                                      <div className={isDark ? "text-[11px] leading-5 text-gray-300" : "text-[11px] leading-5 text-gray-600"}>{video.promptText}</div>
                                    </div>
                                  )}
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <button onClick={(e) => { e.stopPropagation(); setPreviewVideo(video); }} className={isDark ? "rounded-full bg-gray-700 px-3 py-1 text-xs text-gray-100" : "rounded-full bg-white px-3 py-1 text-xs text-gray-700"}>预览</button>
                                    <button onClick={(e) => { e.stopPropagation(); handleCopy(video.item, video.id); }} className={isDark ? "rounded-full bg-gray-700 px-3 py-1 text-xs text-gray-100" : "rounded-full bg-white px-3 py-1 text-xs text-gray-700"}>复制</button>
                                    <button onClick={(e) => { e.stopPropagation(); void handleDownload(video); }} className={isDark ? "rounded-full bg-gray-700 px-3 py-1 text-xs text-gray-100" : "rounded-full bg-white px-3 py-1 text-xs text-gray-700"}>下载</button>
                                    <button onClick={(e) => { e.stopPropagation(); handleToggleFavorite(video.id); }} className={favorites.includes(video.id) ? "rounded-full bg-yellow-400 px-3 py-1 text-xs text-black" : isDark ? "rounded-full bg-gray-700 px-3 py-1 text-xs text-gray-100" : "rounded-full bg-white px-3 py-1 text-xs text-gray-700"}>{favorites.includes(video.id) ? "已收藏" : "收藏"}</button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    {detailTask.hasReferenceImage && renderReferencePreview(detailTask.referenceImageName, false, detailTask.referenceImageThumbData)}
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
            <div className={isDark ? "rounded-3xl border border-gray-800 bg-[#121214] p-5 transition duration-200 hover:bg-[#18181b] md:p-6" : "rounded-3xl border border-gray-200 bg-white p-5 transition duration-200 hover:bg-gray-50 md:p-6"}>
              <div className="mb-3 text-2xl">🎬</div>
              <div className="mb-1 text-base font-semibold">通用视频</div>
              <div className={isDark ? "text-sm text-gray-400" : "text-sm text-gray-500"}>
                支持文生视频、图生视频，直接输入完整提示词生成。
              </div>
            </div>

            <div className={isDark ? "rounded-3xl border border-gray-800 bg-[#121214] p-5 transition duration-200 hover:bg-[#18181b] md:p-6" : "rounded-3xl border border-gray-200 bg-white p-5 transition duration-200 hover:bg-gray-50 md:p-6"}>
              <div className="mb-3 text-2xl">🧠</div>
              <div className="mb-1 text-base font-semibold">智能体批量视频</div>
              <div className={isDark ? "text-sm text-gray-400" : "text-sm text-gray-500"}>
                选择智能体模板，一句话批量生成最多 10 条视频任务。
              </div>
            </div>

            <div className={isDark ? "rounded-3xl border border-gray-800 bg-[#121214] p-5 transition duration-200 hover:bg-[#18181b] md:p-6" : "rounded-3xl border border-gray-200 bg-white p-5 transition duration-200 hover:bg-gray-50 md:p-6"}>
              <div className="mb-3 text-2xl">🖼️</div>
              <div className="mb-1 text-base font-semibold">通用图片</div>
              <div className={isDark ? "text-sm text-gray-400" : "text-sm text-gray-500"}>
                支持文生图、图生图，成功可下载后再扣费。
              </div>
            </div>

            <div className={isDark ? "rounded-3xl border border-gray-800 bg-[#121214] p-5 transition duration-200 hover:bg-[#18181b] md:p-6" : "rounded-3xl border border-gray-200 bg-white p-5 transition duration-200 hover:bg-gray-50 md:p-6"}>
              <div className="mb-3 text-2xl">⏰</div>
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