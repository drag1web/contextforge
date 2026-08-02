import type { ContextEngineShadowExecutionTracker } from "./shadowTypes.js";

export type SettledShadowExecution<T> =
  | { status: "completed"; value: T }
  | { status: "timeout" }
  | { status: "execution_error" };

export async function settleContextEngineShadowExecution<T>(input: {
  execution: Promise<T>;
  abortController: AbortController;
  timeoutMs: number;
}): Promise<SettledShadowExecution<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  type ExecutionOutcome = { kind: "completed"; value: T } | { kind: "execution_error" };
  const execution = input.execution.then(
    (value): ExecutionOutcome => ({ kind: "completed", value }),
    (): ExecutionOutcome => ({ kind: "execution_error" }),
  );
  const timeout = new Promise<{ kind: "timeout" }>((resolve) => {
    timer = setTimeout(() => {
      input.abortController.abort();
      resolve({ kind: "timeout" });
    }, input.timeoutMs);
  });
  const settled = await Promise.race([execution, timeout]);
  if (timer) clearTimeout(timer);
  if (settled.kind === "completed") return { status: "completed", value: settled.value };
  if (settled.kind === "timeout") return { status: "timeout" };
  input.abortController.abort();
  return { status: "execution_error" };
}

export function createContextEngineShadowExecutionTracker(input?: {
  maximumActiveExecutions?: number;
}): ContextEngineShadowExecutionTracker {
  const capacity = Math.max(1, Math.min(input?.maximumActiveExecutions ?? 8, 64));
  const active = new Map<Promise<unknown>, {
    abortController: AbortController;
    observed: Promise<unknown>;
  }>();
  let skipped = 0;
  let closed = false;

  const flush = async (timeoutMs: number): Promise<boolean> => {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 300_000) return false;
    if (active.size === 0) return true;
    const drain = Promise.allSettled([...active.keys()]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    const result = await Promise.race([drain.then(() => true), timeout]);
    if (timer) clearTimeout(timer);
    return result && active.size === 0;
  };

  return {
    tryTrack<T>({ abortController, start }: {
      abortController: AbortController;
      start(): Promise<T>;
    }): Promise<T> | null {
      if (closed || active.size >= capacity) {
        skipped += 1;
        return null;
      }
      const raw = Promise.resolve().then(start);
      let tracked: Promise<T>;
      tracked = raw.finally(() => {
        active.delete(tracked);
      });
      const observed = tracked.catch(() => undefined);
      active.set(tracked, { abortController, observed });
      return tracked;
    },
    flush,
    async close(timeoutMs) {
      closed = true;
      for (const entry of active.values()) entry.abortController.abort();
      return flush(timeoutMs);
    },
    state() {
      return Object.freeze({ active: active.size, capacity, skipped, closed });
    },
  };
}

export const defaultContextEngineShadowExecutionTracker =
  createContextEngineShadowExecutionTracker({ maximumActiveExecutions: 8 });

export function closeContextEngineShadowExecutionTracker(timeoutMs = 250): Promise<boolean> {
  return defaultContextEngineShadowExecutionTracker.close(timeoutMs);
}
