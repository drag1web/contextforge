import { normalizeContextEngineMode } from "./shadowMode.js";
import {
  defaultContextEngineShadowExecutionTracker,
  settleContextEngineShadowExecution,
} from "./shadowDeadline.js";
import type {
  ContextEngineShadowExecutionTracker,
  ContextEngineShadowLifecycleContext,
} from "./shadowTypes.js";

/**
 * Executes an awaited diagnostics-only sidecar and deliberately returns no
 * value that a production decision path could consume.
 */
export async function runContextEngineShadowSidecar(
  mode: unknown,
  input: {
    timeoutMs: number;
    execute(context: ContextEngineShadowLifecycleContext): Promise<void>;
    monotonicMs?: () => number;
    tracker?: ContextEngineShadowExecutionTracker;
  },
): Promise<void> {
  if (normalizeContextEngineMode(mode) !== "shadow") return;
  if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > 300_000) return;
  const monotonicMs = input.monotonicMs ?? (() => performance.now());
  const abortController = new AbortController();
  const deadlineMonotonicMs = monotonicMs() + input.timeoutMs;
  const execution = (input.tracker ?? defaultContextEngineShadowExecutionTracker).tryTrack({
    abortController,
    start: () => input.execute({ signal: abortController.signal, deadlineMonotonicMs }),
  });
  if (execution === null) return;
  try {
    await settleContextEngineShadowExecution({
      execution,
      abortController,
      timeoutMs: input.timeoutMs,
    });
  } catch {
    // The legacy production flow is the sole authority in CE2-07.
  }
}
