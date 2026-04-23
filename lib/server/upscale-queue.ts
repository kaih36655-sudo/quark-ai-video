type UserQueueState = { waiting: number; inflight: number };

const tails = new Map<string, Promise<void>>();
const stateByUser = new Map<string, UserQueueState>();

const getState = (userId: string): UserQueueState => {
  let s = stateByUser.get(userId);
  if (!s) {
    s = { waiting: 0, inflight: 0 };
    stateByUser.set(userId, s);
  }
  return s;
};

const log = (stage: string, payload: Record<string, unknown>) => {
  console.log(`[RUNNINGHUB][${stage}]`, JSON.stringify(payload));
};

/**
 * 同一 userId 下 RunningHub 超分严格串行：后提交的任务排队等待前一个完成（成功或失败）。
 */
export function enqueueUpscaleJob<T>(
  userId: string,
  meta: { videoId: string; taskId: string },
  job: () => Promise<T>
): Promise<T> {
  const s = getState(userId);
  s.waiting += 1;
  const queueLength = s.waiting + s.inflight;
  const hasRunning = s.inflight > 0;
  log("QUEUE_ENQUEUE", {
    userId,
    videoId: meta.videoId,
    taskId: meta.taskId,
    queueLength,
    hasRunning,
  });

  const prev = tails.get(userId) ?? Promise.resolve();
  const run = async (): Promise<T> => {
    if (queueLength > 1 || hasRunning) {
      log("QUEUE_WAIT", {
        userId,
        videoId: meta.videoId,
        taskId: meta.taskId,
        queueLength: s.waiting + s.inflight,
        hasRunning: s.inflight > 0,
      });
    }
    s.waiting = Math.max(0, s.waiting - 1);
    s.inflight += 1;
    log("QUEUE_START", {
      userId,
      videoId: meta.videoId,
      taskId: meta.taskId,
      queueLength: s.waiting + s.inflight,
      hasRunning: true,
    });
    try {
      return await job();
    } finally {
      s.inflight = Math.max(0, s.inflight - 1);
      log("QUEUE_FINISH", {
        userId,
        videoId: meta.videoId,
        taskId: meta.taskId,
        queueLength: s.waiting + s.inflight,
        hasRunning: s.inflight > 0,
      });
    }
  };

  const next = prev.then(run, run);
  tails.set(
    userId,
    next.then(
      () => {},
      () => {}
    )
  );
  return next;
}
