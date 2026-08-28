import type { TaskPackPrimaryDecision, TaskPackPrimaryDiagnosticsWriter } from "./retirementTypes.js";
import { validateTaskPackPrimaryDecision } from "./primaryInvariant.js";

export function createTaskPackPrimaryDiagnosticsWriter(input: {
  persist(record: TaskPackPrimaryDecision): Promise<unknown>;
  maxQueueLength?: number;
}): TaskPackPrimaryDiagnosticsWriter {
  const maximum = Math.max(1, Math.min(input.maxQueueLength ?? 50, 200));
  const pending: TaskPackPrimaryDecision[] = [];
  let closed = false;
  let inFlight = false;
  let dropped = 0;
  let worker: Promise<void> | null = null;
  const start = (): void => {
    if (worker || closed || pending.length === 0) return;
    worker = (async () => {
      try {
        while (!closed && pending.length > 0) {
          const record = pending.shift();
          if (!record) continue;
          inFlight = true;
          try { await input.persist(record); } catch { /* Diagnostics never own production. */ }
          finally { inFlight = false; }
        }
      } finally {
        worker = null;
        if (!closed && pending.length > 0) start();
      }
    })();
  };
  const flush = async (timeoutMs: number): Promise<boolean> => {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 300_000) return false;
    if (!worker) return pending.length === 0 && !inFlight;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      worker.then(() => true),
      new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); }),
    ]);
    if (timer) clearTimeout(timer);
    return result && !worker && pending.length === 0 && !inFlight;
  };
  return {
    enqueue(record) {
      if (closed) return "closed";
      const validated = validateTaskPackPrimaryDecision(record);
      if (pending.length >= maximum) { dropped += 1; return "dropped"; }
      pending.push(validated);
      start();
      return "enqueued";
    },
    flush,
    async close(timeoutMs) {
      closed = true;
      dropped += pending.length;
      pending.length = 0;
      return flush(timeoutMs);
    },
    state() { return Object.freeze({ closed, inFlight, queued: pending.length, dropped, workerTracked: worker !== null }); },
  };
}
