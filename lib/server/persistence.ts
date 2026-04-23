import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Task, Video } from "./types";

type PersistedStore = {
  tasks: Task[];
  videos: Video[];
  counters: {
    task: number;
    video: number;
  };
};

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "store.json");

export async function loadPersistedStore(): Promise<PersistedStore | null> {
  try {
    const text = await readFile(DATA_FILE, "utf-8");
    const parsed = JSON.parse(text) as Partial<PersistedStore>;
    if (!Array.isArray(parsed.tasks) || !Array.isArray(parsed.videos) || !parsed.counters) return null;
    return {
      tasks: parsed.tasks,
      videos: parsed.videos,
      counters: {
        task: Number(parsed.counters.task || 1),
        video: Number(parsed.counters.video || 1),
      },
    };
  } catch {
    return null;
  }
}

let writing = false;
let pending: PersistedStore | null = null;

export async function persistStoreSnapshot(snapshot: PersistedStore) {
  pending = snapshot;
  if (writing) return;
  writing = true;
  await mkdir(DATA_DIR, { recursive: true });
  while (pending) {
    const next = pending;
    pending = null;
    await writeFile(DATA_FILE, JSON.stringify(next, null, 2), "utf-8");
  }
  writing = false;
}
