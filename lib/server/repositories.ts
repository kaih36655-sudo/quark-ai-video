import { getStore } from "./store";
import { persistStoreSnapshot } from "./persistence";
import { Agent, Task, Video } from "./types";

const save = () => {
  const store = getStore();
  void persistStoreSnapshot({
    tasks: store.tasks,
    videos: store.videos,
    counters: store.counters,
  });
};

export const agentsRepository = {
  listVisible() {
    return getStore().agents.filter((agent) => agent.status === "active");
  },
  getById(id: string) {
    return getStore().agents.find((agent) => agent.id === id && agent.status === "active") ?? null;
  },
};

export const tasksRepository = {
  create(payload: Omit<Task, "id" | "createdAt" | "updatedAt">) {
    const store = getStore();
    const now = new Date().toISOString();
    const nextId = String(store.counters.task++);
    const task: Task = {
      ...payload,
      id: nextId,
      createdAt: now,
      updatedAt: now,
    };
    store.tasks.unshift(task);
    save();
    return task;
  },
  list() {
    return [...getStore().tasks].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  },
  getById(id: string) {
    return getStore().tasks.find((task) => task.id === id) ?? null;
  },
  update(id: string, patch: Partial<Task>) {
    const store = getStore();
    const index = store.tasks.findIndex((task) => task.id === id);
    if (index < 0) return null;
    const nextTask: Task = {
      ...store.tasks[index],
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    store.tasks[index] = nextTask;
    save();
    return nextTask;
  },
  removeById(id: string) {
    const store = getStore();
    const before = store.tasks.length;
    store.tasks = store.tasks.filter((task) => task.id !== id);
    if (store.tasks.length === before) return false;
    save();
    return true;
  },
};

export const videosRepository = {
  createMany(items: Omit<Video, "id" | "createdAt">[]) {
    const store = getStore();
    const created: Video[] = items.map((item) => ({
      ...item,
      id: String(store.counters.video++),
      createdAt: new Date().toISOString(),
    }));
    store.videos.unshift(...created);
    save();
    return created;
  },
  listByTaskId(taskId: string) {
    return getStore().videos.filter((video) => video.taskId === taskId).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  },
  listAll() {
    return [...getStore().videos].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  },
  getById(id: string) {
    return getStore().videos.find((video) => video.id === id) ?? null;
  },
  update(id: string, patch: Partial<Video>) {
    const store = getStore();
    const index = store.videos.findIndex((video) => video.id === id);
    if (index < 0) return null;
    const nextVideo: Video = {
      ...store.videos[index],
      ...patch,
    };
    store.videos[index] = nextVideo;
    save();
    return nextVideo;
  },
  updateCoverFields(id: string, patch: Partial<Pick<Video, "coverUrl" | "originalCoverUrl" | "upscaledCoverUrl">>) {
    const store = getStore();
    const index = store.videos.findIndex((video) => video.id === id);
    if (index < 0) return null;
    const nextVideo: Video = {
      ...store.videos[index],
      ...patch,
    };
    store.videos[index] = nextVideo;
    save();
    return nextVideo;
  },
  removeByTaskId(taskId: string) {
    const store = getStore();
    const before = store.videos.length;
    store.videos = store.videos.filter((video) => video.taskId !== taskId);
    if (store.videos.length === before) return 0;
    save();
    return before - store.videos.length;
  },
};
