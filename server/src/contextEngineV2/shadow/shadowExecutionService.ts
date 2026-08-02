import { createHash } from "node:crypto";

import {
  createContextProjectionService,
} from "../application/index.js";
import {
  createLegacyTaskFileSelectionProjection,
} from "../adapters/index.js";
import type { OfflineCompatibilityComparisonInput } from "../adapters/legacySelection/index.js";
import type { InvestigationId, InvestigationRequestId } from "../contracts/index.js";
import { createLiveContextEngineExecution } from "../facade/liveContextEngineRuntime.js";
import { assertContextEngineShadowInputEquivalent, isPreparedContextEngineShadowInput } from "./shadowInputPreparation.js";
import { DEFAULT_CONTEXT_ENGINE_SHADOW_POLICY, normalizeContextEngineShadowExecutionBasis } from "./shadowExecutionBasis.js";
import { settleContextEngineShadowExecution } from "./shadowDeadline.js";
import { createContextEngineShadowComparison, createFailedContextEngineShadowComparison } from "./shadowComparison.js";
import type { ContextEngineShadowCanonicalInput, ContextEngineShadowClock, ContextEngineShadowComparison, ContextEngineShadowTiming } from "./shadowTypes.js";

const systemClock: ContextEngineShadowClock = {
  nowIso: () => new Date().toISOString(),
  monotonicMs: () => Math.floor(performance.now()),
};

function stableId(prefix: string, values: readonly string[]): string {
  return `${prefix}-${createHash("sha256").update(values.join("\0"), "utf8").digest("hex").slice(0, 32)}`;
}

function timing(input: { clock: ContextEngineShadowClock; start: number; legacyMs?: number; v2Ms?: number; comparisonMs?: number; timeoutMs: number }): ContextEngineShadowTiming {
  return {
    legacyMs: Math.max(0, input.legacyMs ?? 0),
    v2Ms: Math.max(0, input.v2Ms ?? 0),
    comparisonMs: Math.max(0, input.comparisonMs ?? 0),
    persistenceMs: null,
    totalShadowOverheadMs: Math.max(0, input.clock.monotonicMs() - input.start),
    timeoutCeilingMs: input.timeoutMs,
  };
}

export async function runLiveContextEngineShadow(input: {
  canonical: ContextEngineShadowCanonicalInput;
  legacySelection: OfflineCompatibilityComparisonInput["legacySelection"];
  legacyDurationMs?: number;
  clock?: ContextEngineShadowClock;
  parentAbortSignal?: AbortSignal;
  deadlineMonotonicMs?: number;
}): Promise<ContextEngineShadowComparison> {
  const clock = input.clock ?? systemClock;
  const started = clock.monotonicMs();
  let v2Ms = 0;
  let comparisonMs = 0;
  try {
    if (!isPreparedContextEngineShadowInput(input.canonical)) throw new Error("canonical_input_mismatch");
    assertContextEngineShadowInputEquivalent(input.canonical);
  } catch {
    const policy = DEFAULT_CONTEXT_ENGINE_SHADOW_POLICY;
    return createFailedContextEngineShadowComparison({
      canonical: input.canonical,
      legacySelection: input.legacySelection,
      status: "input_mismatch",
      issue: "canonical_input_mismatch",
      timing: timing({ clock, start: started, legacyMs: input.legacyDurationMs, timeoutMs: policy.timeoutMs }),
      createdAt: clock.nowIso(),
    });
  }

  const basis = normalizeContextEngineShadowExecutionBasis(input.canonical.executionBasis);
  const policy = basis.policy;
  const deadline = Math.min(
    input.deadlineMonotonicMs ?? started + policy.timeoutMs,
    started + policy.timeoutMs,
  );
  const deadlineExceeded = (): boolean => clock.monotonicMs() >= deadline;
  const parentTimedOut = (): boolean => deadlineExceeded() ||
    (input.parentAbortSignal?.aborted === true && clock.monotonicMs() >= deadline);
  const cancelledFailure = (): ContextEngineShadowComparison => createFailedContextEngineShadowComparison({
    canonical: input.canonical,
    legacySelection: input.legacySelection,
    status: parentTimedOut() ? "timeout" : "cancelled",
    issue: parentTimedOut() ? "shadow_timeout" : "shadow_cancelled",
    timing: timing({ clock, start: started, legacyMs: input.legacyDurationMs, v2Ms, comparisonMs, timeoutMs: policy.timeoutMs }),
    createdAt: clock.nowIso(),
  });
  if (input.parentAbortSignal?.aborted || deadlineExceeded()) return cancelledFailure();

  const abortController = new AbortController();
  const abortFromParent = (): void => abortController.abort();
  input.parentAbortSignal?.addEventListener("abort", abortFromParent, { once: true });
  const executionStarted = clock.monotonicMs();
  const execution = createLiveContextEngineExecution({
    projectRoot: input.canonical.projectRoot,
    inventory: input.canonical.inventory,
    snapshot: input.canonical.snapshot,
    negativeConstraints: input.canonical.negativeConstraints,
    clock,
    abortSignal: abortController.signal,
    runnerInput: {
      investigationId: stableId("shadow-investigation", [input.canonical.snapshot.id, input.canonical.taskFingerprint]) as InvestigationId,
      snapshot: input.canonical.snapshot,
      purpose: "shadow_comparison",
      request: {
        requestId: stableId("shadow-request", [input.canonical.projectId, input.canonical.taskFingerprint]) as InvestigationRequestId,
        projectId: input.canonical.projectId,
        task: { normalizedTask: input.canonical.normalizedTask },
        snapshot: input.canonical.snapshot,
        explicitTargets: input.canonical.explicitTargets,
        negativeConstraints: input.canonical.negativeConstraints,
        budget: policy.budget,
        purpose: "shadow_comparison",
      },
      questions: [], claims: [], hypotheses: [], entities: [], facts: [], evidence: [], findings: [],
      contradictions: [], knowledgeGaps: [], operationCandidates: [], budget: policy.budget,
      plannerPolicy: basis.plannerPolicy,
      deadlineMonotonicMs: Math.ceil(
        Math.min(deadline, executionStarted + policy.budget.maxWallTimeMs),
      ),
    },
  });
  const settled = await settleContextEngineShadowExecution({
    execution,
    abortController,
    timeoutMs: Math.max(1, Math.ceil(deadline - clock.monotonicMs())),
  });
  input.parentAbortSignal?.removeEventListener("abort", abortFromParent);
  if (input.parentAbortSignal?.aborted || deadlineExceeded()) {
    v2Ms = clock.monotonicMs() - executionStarted;
    return cancelledFailure();
  }
  if (settled.status !== "completed") {
    v2Ms = clock.monotonicMs() - executionStarted;
    return createFailedContextEngineShadowComparison({
      canonical: input.canonical,
      legacySelection: input.legacySelection,
      status: settled.status === "timeout" ? "timeout" : "execution_error",
      issue: settled.status === "timeout" ? "shadow_timeout" : "shadow_execution_error",
      timing: timing({ clock, start: started, legacyMs: input.legacyDurationMs, v2Ms, comparisonMs, timeoutMs: policy.timeoutMs }),
      createdAt: clock.nowIso(),
    });
  }
  const result = settled.value;
  try {
    v2Ms = clock.monotonicMs() - executionStarted;
    const comparisonStarted = clock.monotonicMs();
    let stage: "projection" | "comparison" = "projection";
    try {
      if (input.parentAbortSignal?.aborted || deadlineExceeded()) return cancelledFailure();
      const projection = createContextProjectionService().project({
        result,
        snapshot: input.canonical.snapshot,
        purpose: "legacy_selection",
        explicitTargets: input.canonical.explicitTargets,
        negativeConstraints: input.canonical.negativeConstraints,
      });
      createLegacyTaskFileSelectionProjection().project(projection, input.canonical.snapshot, {
        effectiveTaskArea: basis.effectiveTaskArea as Parameters<ReturnType<typeof createLegacyTaskFileSelectionProjection>["project"]>[2]["effectiveTaskArea"],
        requestedTaskType: basis.requestedTaskType,
        negativeConstraints: input.canonical.negativeConstraints,
      });
      if (input.parentAbortSignal?.aborted || deadlineExceeded()) return cancelledFailure();
      stage = "comparison";
      comparisonMs = clock.monotonicMs() - comparisonStarted;
      return createContextEngineShadowComparison({
        canonical: input.canonical,
        legacySelection: input.legacySelection,
        result,
        projection,
        snapshot: input.canonical.snapshot,
        timing: timing({ clock, start: started, legacyMs: input.legacyDurationMs, v2Ms, comparisonMs, timeoutMs: policy.timeoutMs }),
        createdAt: clock.nowIso(),
      });
    } catch {
      comparisonMs = clock.monotonicMs() - comparisonStarted;
      return createFailedContextEngineShadowComparison({
        canonical: input.canonical,
        legacySelection: input.legacySelection,
        status: "execution_error",
        issue: stage === "projection" ? "shadow_projection_error" : "shadow_comparison_error",
        timing: timing({ clock, start: started, legacyMs: input.legacyDurationMs, v2Ms, comparisonMs, timeoutMs: policy.timeoutMs }),
        createdAt: clock.nowIso(),
      });
    }
  } catch {
    return createFailedContextEngineShadowComparison({
      canonical: input.canonical,
      legacySelection: input.legacySelection,
      status: "execution_error",
      issue: "shadow_projection_error",
      timing: timing({ clock, start: started, legacyMs: input.legacyDurationMs, v2Ms, comparisonMs, timeoutMs: policy.timeoutMs }),
      createdAt: clock.nowIso(),
    });
  }
}
