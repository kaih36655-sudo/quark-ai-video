import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type VideoRemixJobStatus = "pending" | "running" | "success" | "failed";
export type VideoRemixOutputLanguage = "zh" | "en" | "ja";

export type VideoRemixJob = {
  id: string;
  userId: string;
  status: VideoRemixJobStatus;
  fileName: string;
  filePath: string;
  mimeType: string;
  fileSize: number;
  duration: number | null;
  targetSeconds: 4 | 8 | 12;
  ratio: "9:16" | "16:9";
  outputLanguage: VideoRemixOutputLanguage;
  hasUserHint: boolean;
  userHint: string;
  generateReferenceImage: boolean;
  analysis: string;
  prompt: string;
  referenceImageUrl: string;
  referenceImageError: string;
  error: string;
  createdAt: string;
  updatedAt: string;
};

const DATA_DIR = path.join(process.cwd(), "data", "video-remix");
const JOBS_FILE = path.join(DATA_DIR, "jobs.json");
export const VIDEO_REMIX_UPLOADS_DIR = path.join(DATA_DIR, "uploads");

let writing = false;
let pending: VideoRemixJob[] | null = null;

async function ensureDirs() {
  await mkdir(VIDEO_REMIX_UPLOADS_DIR, { recursive: true });
}

export async function readVideoRemixJobs() {
  try {
    const text = await readFile(JOBS_FILE, "utf-8");
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? (parsed as VideoRemixJob[]) : [];
  } catch {
    return [];
  }
}

async function writeVideoRemixJobs(jobs: VideoRemixJob[]) {
  await ensureDirs();
  pending = jobs;
  if (writing) return;
  writing = true;
  while (pending) {
    const next = pending;
    pending = null;
    await writeFile(JOBS_FILE, JSON.stringify(next, null, 2), "utf-8");
  }
  writing = false;
}

export async function getVideoRemixJob(id: string) {
  const jobs = await readVideoRemixJobs();
  return jobs.find((job) => job.id === id) ?? null;
}

export async function createVideoRemixJob(job: VideoRemixJob) {
  const jobs = await readVideoRemixJobs();
  await writeVideoRemixJobs([job, ...jobs]);
  return job;
}

export async function updateVideoRemixJob(id: string, patch: Partial<Omit<VideoRemixJob, "id" | "createdAt">>) {
  const jobs = await readVideoRemixJobs();
  const index = jobs.findIndex((job) => job.id === id);
  if (index < 0) return null;
  const next: VideoRemixJob = {
    ...jobs[index],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  jobs[index] = next;
  await writeVideoRemixJobs(jobs);
  return next;
}
