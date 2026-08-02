export interface ContextComposerExecutionTracker {
  tryTrack<T>(input: {
    abortController: AbortController;
    start(): Promise<T>;
  }): Promise<T> | null;
  flush(timeoutMs: number): Promise<boolean>;
  close(timeoutMs: number): Promise<boolean>;
  state(): Readonly<{ active: number; capacity: number; skipped: number; closed: boolean }>;
}

export function createContextComposerExecutionTracker(input?: {
  maximumActiveExecutions?: number;
}): ContextComposerExecutionTracker {
  const capacity = Math.max(1, Math.min(input?.maximumActiveExecutions ?? 4, 32));
  const active = new Map<Promise<unknown>, AbortController>();
  let skipped = 0;
  let closed = false;

  const flush = async (timeoutMs: number): Promise<boolean> => {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 300_000) return false;
    if (active.size === 0) return true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    const result = await Promise.race([
      Promise.allSettled([...active.keys()]).then(() => true),
      timeout,
    ]);
    if (timer) clearTimeout(timer);
    return result && active.size === 0;
  };

  return {
    tryTrack<T>({ abortController, start }: { abortController: AbortController; start(): Promise<T> }) {
      if (closed || active.size >= capacity) {
        skipped += 1;
        return null;
      }
      const raw = Promise.resolve().then(start);
      let tracked: Promise<T>;
      tracked = raw.finally(() => active.delete(tracked));
      tracked.catch(() => undefined);
      active.set(tracked, abortController);
      return tracked;
    },
    flush,
    async close(timeoutMs) {
      closed = true;
      for (const controller of active.values()) controller.abort();
      return flush(timeoutMs);
    },
    state: () => Object.freeze({ active: active.size, capacity, skipped, closed }),
  };
}

export const defaultContextComposerExecutionTracker =
  createContextComposerExecutionTracker({ maximumActiveExecutions: 4 });

export function closeContextComposerExecutionTracker(timeoutMs = 250): Promise<boolean> {
  return defaultContextComposerExecutionTracker.close(timeoutMs);
}
