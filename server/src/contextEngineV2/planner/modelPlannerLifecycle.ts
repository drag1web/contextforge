export type ModelPlannerTrackedResult<T> =
  | { status: "completed"; value: T }
  | { status: "timeout" | "cancelled" | "capacity_exhausted" }
  | { status: "provider_error"; error: unknown };

export interface ModelPlannerRequestTracker {
  run<T>(input: {
    timeoutMs: number;
    parentSignal?: AbortSignal;
    execute(signal: AbortSignal): Promise<T>;
  }): Promise<ModelPlannerTrackedResult<T>>;
  state(): Readonly<{
    active: number;
    capacity: number;
    skipped: number;
    closed: boolean;
  }>;
  flush(timeoutMs: number): Promise<boolean>;
  close(timeoutMs: number): Promise<boolean>;
}

export function createModelPlannerRequestTracker(input?: {
  maximumActiveRequests?: number;
}): ModelPlannerRequestTracker {
  const capacity = Math.max(1, Math.min(input?.maximumActiveRequests ?? 4, 32));
  const active = new Map<Promise<unknown>, AbortController>();
  let skipped = 0;
  let closed = false;

  const flush = async (timeoutMs: number): Promise<boolean> => {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 300_000) {
      return false;
    }
    if (active.size === 0) return true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    const settled = await Promise.race([
      Promise.allSettled([...active.keys()]).then(() => true),
      timeout,
    ]);
    if (timer) clearTimeout(timer);
    return settled && active.size === 0;
  };

  return {
    async run<T>(input: {
      timeoutMs: number;
      parentSignal?: AbortSignal;
      execute(signal: AbortSignal): Promise<T>;
    }): Promise<ModelPlannerTrackedResult<T>> {
      const { timeoutMs, parentSignal, execute } = input;
      if (closed || active.size >= capacity) {
        skipped += 1;
        return { status: "capacity_exhausted" };
      }
      if (parentSignal?.aborted) return { status: "cancelled" };
      const controller = new AbortController();
      let resolveCancellation: (() => void) | undefined;
      const cancellation = new Promise<{ status: "cancelled" }>((resolve) => {
        resolveCancellation = () => resolve({ status: "cancelled" });
      });
      const abortFromParent = (): void => {
        controller.abort();
        resolveCancellation?.();
      };
      parentSignal?.addEventListener("abort", abortFromParent, { once: true });
      let tracked: Promise<T>;
      const raw = Promise.resolve().then(() => execute(controller.signal));
      tracked = raw.finally(() => {
        active.delete(tracked);
        parentSignal?.removeEventListener("abort", abortFromParent);
      });
      tracked.catch(() => undefined);
      active.set(tracked, controller);

      let timer: ReturnType<typeof setTimeout> | undefined;
      const outcome = tracked.then(
        (value) => ({ status: "completed" as const, value }),
        (error) => ({ status: "provider_error" as const, error }),
      );
      const deadline = new Promise<{ status: "timeout" }>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve({ status: "timeout" });
        }, timeoutMs);
      });
      const result = await Promise.race([
        outcome,
        deadline,
        parentSignal ? cancellation : new Promise<never>(() => undefined),
      ]);
      if (timer) clearTimeout(timer);
      parentSignal?.removeEventListener("abort", abortFromParent);
      resolveCancellation = undefined;
      if (result.status !== "completed") controller.abort();
      return result;
    },
    state: () => Object.freeze({ active: active.size, capacity, skipped, closed }),
    flush,
    async close(timeoutMs) {
      closed = true;
      for (const controller of active.values()) controller.abort();
      return flush(timeoutMs);
    },
  };
}

export const defaultModelPlannerRequestTracker =
  createModelPlannerRequestTracker({ maximumActiveRequests: 4 });

export function closeModelPlannerRequestTracker(timeoutMs = 250): Promise<boolean> {
  return defaultModelPlannerRequestTracker.close(timeoutMs);
}
