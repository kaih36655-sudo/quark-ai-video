export type User = {
  id: string;
  name: string;
  role: "user" | "admin";
  status: "active" | "disabled";
};

export type Agent = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  accessType: "public" | "restricted";
  workflowKey: string;
  status: "active" | "inactive";
  isAuthorized: boolean;
};

export type TaskStatus = "waiting" | "queued" | "running" | "success" | "failed" | "cancelled";
export type VideoStatus = "success" | "failed";

export type Task = {
  id: string;
  userId: string;
  agentId?: string;
  agentName?: string;
  agentAccessType?: "public" | "restricted";
  prompt: string;
  mode: "agent" | "normal" | "image";
  duration: string;
  ratio: string;
  imageSize?: "1K" | "2K" | "4K";
  imageModel?: "image2" | "banana2";
  count: number;
  status: TaskStatus;
  referenceImageUrl?: string;
  referenceImageName?: string;
  promptSnapshot?: string;
  scheduledAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type Video = {
  id: string;
  taskId: string;
  kind?: "video" | "image";
  providerTaskId?: string;
  title: string;
  content: string;
  script: string[];
  prompt: string;
  status: VideoStatus;
  originalVideoUrl?: string;
  originalCoverUrl?: string;
  upscaledVideoUrl?: string;
  upscaledCoverUrl?: string;
  upscaleStatus?: "idle" | "queued" | "pending" | "processing" | "success" | "failed";
  upscaleTaskId?: string;
  upscaleErrorMessage?: string;
  upscaleConsumeMoney?: number;
  upscaleTaskCostTime?: number;
  coverUrl?: string;
  videoUrl?: string;
  previewImageUrl?: string;
  errorMessage?: string;
  referenceImageUrl?: string;
  referenceImageName?: string;
  cost: number;
  seconds?: number;
  duration: string;
  ratio: string;
  size?: string;
  imageSize?: "1K" | "2K" | "4K";
  imageModel?: "image2" | "banana2";
  createdAt: string;
};

export type ApiResponse<T> = {
  success: boolean;
  message?: string;
  data?: T;
};
