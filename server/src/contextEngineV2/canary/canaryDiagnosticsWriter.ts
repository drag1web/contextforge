import type {
  TaskPackCanaryDecision,
  TaskPackCanaryDiagnosticsWriter,
} from "./canaryTypes.js";
import { validateTaskPackCanaryDecision } from "./canaryInvariant.js";

export function createTaskPackCanaryDiagnosticsWriter(input: {
  persist(record: TaskPackCanaryDecision): Promise<unknown>;
  maxQueueLength?: number;
}): TaskPackCanaryDiagnosticsWriter {
  const maximum = Math.max(1, Math.min(input.maxQueueLength ?? 50, 200));
  const pending: TaskPackCanaryDecision[] = [];
  let closed = false;
  let inFlight = false;
  let dropped = 0;
  let workerPromise: Promise<void> | null = null;

  const flush = async (timeoutMs: number): Promise<boolean> => {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 300_000) return false;
    if (workerPromise === null) return pending.length === 0 && !inFlight;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      workerPromise.then(() => true),
      new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); }),
    ]);
    if (timer) clearTimeout(timer);
    return result && pending.length === 0 && !inFlight;
  };

  const startWorker = (): void => {
    if (workerPromise !== null || closed || pending.length === 0) return;
    workerPromise = (async () => {
      try {
        while (!closed && pending.length > 0) {
          const record = pending.shift();
          if (!record) continue;
          inFlight = true;
          try {
            await input.persist(record);
          } catch {
            // Canary diagnostics are non-authoritative and failure-contained.
          } finally {
            inFlight = false;
          }
        }
      } finally {
        workerPromise = null;
        if (!closed && pending.length > 0) startWorker();
      }
    })();
  };

  return {
    enqueue(record) {
      if (closed) return "closed";
      const enqueueStarted = performance.now();
      const validated = validateTaskPackCanaryDecision(record);
      if (pending.length >= maximum) {
        dropped += 1;
        return "dropped";
      }
      pending.push(validated);
      const enqueueMs = Math.max(0, performance.now() - enqueueStarted);
      pending[pending.length - 1] = validateTaskPackCanaryDecision({
        ...structuredClone(validated),
        timing: {
          ...validated.timing,
          totalMs: Math.min(300_000, validated.timing.totalMs + enqueueMs),
        },
      });
      startWorker();
      return "enqueued";
    },
    flush,
    async close(timeoutMs) {
      closed = true;
      dropped += pending.length;
      pending.length = 0;
      return flush(timeoutMs);
    },
    state() {
      return Object.freeze({ closed, inFlight, queued: pending.length, dropped, workerTracked: workerPromise !== null });
    },
  };
}
