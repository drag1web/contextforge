import type {
  ContextEngineShadowComparison,
  ContextEngineShadowDiagnosticsWriter,
} from "./shadowTypes.js";
import { validateContextEngineShadowComparison } from "./shadowTypesInvariant.js";

/**
 * Request paths only enqueue validated records. A single tracked worker owns
 * persistence, bounds pending memory, and absorbs storage failures.
 */
export function createContextEngineShadowDiagnosticsWriter(input: {
  persist(record: ContextEngineShadowComparison): Promise<unknown>;
  maxQueueLength?: number;
}): ContextEngineShadowDiagnosticsWriter {
  const maximum = Math.max(1, Math.min(input.maxQueueLength ?? 50, 200));
  const pending: ContextEngineShadowComparison[] = [];
  let closed = false;
  let inFlight = false;
  let dropped = 0;
  let workerPromise: Promise<void> | null = null;

  const flush = async (timeoutMs: number): Promise<boolean> => {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 300_000) return false;
    const worker = workerPromise;
    if (worker === null) return pending.length === 0 && !inFlight;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    const completed = worker.then(() => true);
    const result = await Promise.race([completed, timedOut]);
    if (timer) clearTimeout(timer);
    return result && pending.length === 0 && !inFlight;
  };

  const startWorker = (): void => {
    if (workerPromise !== null || closed || pending.length === 0) return;
    const worker = async (): Promise<void> => {
      try {
        while (!closed && pending.length > 0) {
          const record = pending.shift();
          if (!record) continue;
          inFlight = true;
          try {
            await input.persist(record);
          } catch {
            // Diagnostics persistence is non-authoritative and failure-contained.
          } finally {
            inFlight = false;
          }
        }
      } finally {
        workerPromise = null;
        if (!closed && pending.length > 0) startWorker();
      }
    };
    workerPromise = worker();
  };

  return {
    enqueue(record) {
      if (closed) return "closed";
      const validated = validateContextEngineShadowComparison(record);
      if (pending.length >= maximum) {
        dropped += 1;
        return "dropped";
      }
      pending.push(validated);
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
      return Object.freeze({
        closed,
        inFlight,
        queued: pending.length,
        dropped,
        workerTracked: workerPromise !== null,
      });
    },
  };
}
