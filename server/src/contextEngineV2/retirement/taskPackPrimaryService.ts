import { createHash, randomUUID } from "node:crypto";

import {
  ContextProjectionError,
  createContextProjectionService,
  type InvestigationRunnerResult,
} from "../application/index.js";
import {
  LegacyProjectionError,
  createLegacyTaskFileSelectionProjection,
} from "../adapters/legacySelection/index.js";
import type { InvestigationId, InvestigationRequestId } from "../contracts/index.js";
import { createLiveContextEngineExecution } from "../facade/liveContextEngineRuntime.js";
import {
  assertContextEngineShadowInputEquivalent,
  createContextEngineShadowExecutionTracker,
  isPreparedContextEngineShadowInput,
  settleContextEngineShadowExecution,
} from "../shadow/index.js";
import { contextEngineShadowConfigurationFingerprint } from "../shadow/shadowExecutionBasis.js";
import type { ContextEngineShadowExecutionBasis } from "../shadow/index.js";
import { evaluateGroundedPrimarySelection } from "./groundedSelectionProof.js";
import { validateTaskPackPrimaryDecision } from "./primaryInvariant.js";
import type {
  GroundedSelectionProof,
  TaskPackPrimaryDecision,
  TaskPackPrimaryDownstreamValidation,
  TaskPackPrimaryMappedFile,
  TaskPackPrimaryReasonCode,
  TaskPackPrimaryResolution,
  TaskPackPrimaryRollbackReason,
  TaskPackPrimaryRuntimeDependencies,
  TaskPackPrimaryRuntimeInput,
} from "./retirementTypes.js";

const defaultClock = {
  nowIso: () => new Date().toISOString(),
  monotonicMs: () => Math.floor(performance.now()),
};

export const defaultTaskPackPrimaryExecutionTracker =
  createContextEngineShadowExecutionTracker({ maximumActiveExecutions: 4 });

function stableId(prefix: string, values: readonly string[]): string {
  return `${prefix}-${createHash("sha256").update(values.join("\0"), "utf8").digest("hex").slice(0, 32)}`;
}

function uniqueReasons(values: readonly TaskPackPrimaryReasonCode[]): TaskPackPrimaryReasonCode[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function metrics(result: Awaited<ReturnType<TaskPackPrimaryRuntimeDependencies["execute"]>>) {
  const usage = result.budgetState.usage;
  return {
    operations: usage.operations,
    fileReads: usage.fileReads,
    fileBytes: usage.fileBytes,
    parsedFiles: usage.parsedFiles,
    relationshipHops: usage.relationshipHops,
    plannerRounds: usage.plannerRounds,
  };
}

function createDecision(input: {
  runtime: TaskPackPrimaryRuntimeInput;
  dependencies: TaskPackPrimaryRuntimeDependencies;
  status: TaskPackPrimaryDecision["status"];
  reasons: readonly TaskPackPrimaryReasonCode[];
  rollbackReason?: TaskPackPrimaryRollbackReason | null;
  selectedFiles?: readonly TaskPackPrimaryMappedFile[];
  proofs?: readonly GroundedSelectionProof[];
  downstream?: TaskPackPrimaryDownstreamValidation | null;
  result?: Awaited<ReturnType<TaskPackPrimaryRuntimeDependencies["execute"]>> | null;
  executionMs?: number;
  projectionMs?: number;
  downstreamMs?: number;
}): TaskPackPrimaryDecision {
  const canonical = input.runtime.canonical;
  return validateTaskPackPrimaryDecision({
    schemaVersion: 1,
    decisionId: `primary-${randomUUID()}`,
    projectId: canonical.projectId,
    taskFingerprint: canonical.taskFingerprint,
    clarificationFingerprint: canonical.clarificationFingerprint,
    inventoryFingerprint: canonical.inventoryFingerprint,
    snapshotFingerprint: canonical.snapshotFingerprint,
    configurationFingerprint: canonical.configurationFingerprint,
    status: input.status,
    reasonCodes: uniqueReasons(input.reasons),
    rollbackReason: input.rollbackReason ?? null,
    selectedFiles: structuredClone(input.selectedFiles ?? []),
    groundedProofs: structuredClone(input.proofs ?? []),
    downstreamValidation: input.downstream ? structuredClone(input.downstream) : null,
    metrics: input.result ? metrics(input.result) : null,
    timing: {
      executionMs: Math.max(0, input.executionMs ?? 0),
      projectionMs: Math.max(0, input.projectionMs ?? 0),
      downstreamValidationMs: Math.max(0, input.downstreamMs ?? 0),
      totalMs: Math.max(0, input.dependencies.monotonicMs() - input.runtime.requestStartedMonotonicMs),
      timeoutCeilingMs: canonical.executionBasis.policy.timeoutMs,
    },
    modelPlannerUsed: false,
    createdAt: input.dependencies.nowIso(),
  });
}

function resolution(input: Parameters<typeof createDecision>[0]): TaskPackPrimaryResolution {
  const decision = createDecision(input);
  return Object.freeze({
    status: decision.status,
    adoptedFiles: decision.status === "v2_applied" ? structuredClone(decision.selectedFiles) : null,
    groundedProofs: Object.freeze([...(input.proofs ?? [])]),
    rollbackEligible: decision.status === "legacy_rollback",
    rollbackReason: decision.rollbackReason,
    decision,
  });
}

function semanticStatus(reasons: readonly TaskPackPrimaryReasonCode[]): TaskPackPrimaryDecision["status"] {
  if (reasons.includes("clarification_required")) return "clarification_required";
  if (reasons.includes("ambiguous_targets") || reasons.includes("review_required")) return "review_required";
  if (reasons.includes("no_editable_target")) return "v2_no_selection";
  return "safe_fail";
}

export function createTaskPackPrimaryService(
  dependencies: TaskPackPrimaryRuntimeDependencies,
): (input: TaskPackPrimaryRuntimeInput) => Promise<TaskPackPrimaryResolution> {
  return async (runtime) => {
    try {
      if (!isPreparedContextEngineShadowInput(runtime.canonical)) throw new Error("canonical_input_mismatch");
      assertContextEngineShadowInputEquivalent(runtime.canonical);
      if (!Number.isFinite(runtime.requestStartedMonotonicMs) ||
          !Number.isFinite(runtime.requestDeadlineMonotonicMs) ||
          runtime.requestDeadlineMonotonicMs !== runtime.requestStartedMonotonicMs + runtime.canonical.executionBasis.policy.timeoutMs) {
        throw new Error("canonical_input_mismatch");
      }
    } catch {
      return resolution({ runtime, dependencies, status: "engine_error", reasons: ["canonical_input_mismatch"] });
    }
    if (runtime.manualSelectionRequested) {
      return resolution({ runtime, dependencies, status: "review_required", reasons: ["manual_selection_authoritative"] });
    }
    const deadline = runtime.requestDeadlineMonotonicMs;
    if (dependencies.monotonicMs() >= deadline) {
      return resolution({ runtime, dependencies, status: "legacy_rollback", reasons: ["execution_timeout"], rollbackReason: "execution_timeout" });
    }
    const abortController = new AbortController();
    const abortFromParent = (): void => abortController.abort();
    runtime.parentAbortSignal?.addEventListener("abort", abortFromParent, { once: true });
    const executionStarted = dependencies.monotonicMs();
    const tracked = dependencies.tracker.tryTrack({
      abortController,
      start: () => dependencies.execute({
        canonical: runtime.canonical,
        abortSignal: abortController.signal,
        deadlineMonotonicMs: Math.min(deadline, executionStarted + runtime.canonical.executionBasis.policy.budget.maxWallTimeMs),
      }),
    });
    if (!tracked) {
      runtime.parentAbortSignal?.removeEventListener("abort", abortFromParent);
      return resolution({ runtime, dependencies, status: "legacy_rollback", reasons: ["capacity_exhausted"], rollbackReason: "capacity_exhausted" });
    }
    const settled = await settleContextEngineShadowExecution({
      execution: tracked,
      abortController,
      timeoutMs: Math.max(1, Math.ceil(deadline - dependencies.monotonicMs())),
    });
    runtime.parentAbortSignal?.removeEventListener("abort", abortFromParent);
    const executionMs = Math.max(0, dependencies.monotonicMs() - executionStarted);
    if (settled.status !== "completed") {
      const reason: TaskPackPrimaryRollbackReason = settled.status === "timeout" ? "execution_timeout" : "execution_error";
      return resolution({ runtime, dependencies, status: "legacy_rollback", reasons: [reason], rollbackReason: reason, executionMs });
    }
    if (dependencies.monotonicMs() >= deadline) {
      return resolution({ runtime, dependencies, status: "legacy_rollback", reasons: ["execution_timeout"], rollbackReason: "execution_timeout", result: settled.value, executionMs });
    }

    const projectionStarted = dependencies.monotonicMs();
    let projection;
    try {
      projection = dependencies.project
        ? dependencies.project({ result: settled.value, canonical: runtime.canonical })
        : createContextProjectionService().project({
            result: settled.value,
            snapshot: runtime.canonical.snapshot,
            purpose: "legacy_selection",
            explicitTargets: runtime.canonical.explicitTargets,
            negativeConstraints: runtime.canonical.negativeConstraints,
          });
    } catch (error) {
      const reason: TaskPackPrimaryReasonCode = error instanceof ContextProjectionError
        ? error.code === "snapshot_mismatch" ? "snapshot_mismatch" : "projection_invalid"
        : "projection_invalid";
      return resolution({ runtime, dependencies, status: "engine_error", reasons: [reason], result: settled.value, executionMs,
        projectionMs: Math.max(0, dependencies.monotonicMs() - projectionStarted) });
    }
    let mapped;
    try {
      mapped = dependencies.map
        ? dependencies.map({ projection, canonical: runtime.canonical })
        : createLegacyTaskFileSelectionProjection().project(
            projection,
            runtime.canonical.snapshot,
            {
              effectiveTaskArea: runtime.canonical.executionBasis.effectiveTaskArea as "ui" | "backend" | "fullstack" | "tests" | "docs" | "build" | "bugfix" | "refactor" | "general",
              requestedTaskType: runtime.canonical.executionBasis.requestedTaskType,
              negativeConstraints: runtime.canonical.negativeConstraints,
            },
          );
    } catch (error) {
      const reason: TaskPackPrimaryReasonCode = error instanceof LegacyProjectionError && error.code === "snapshot_mismatch"
        ? "snapshot_mismatch"
        : "compatibility_invalid";
      return resolution({ runtime, dependencies, status: "engine_error", reasons: [reason], result: settled.value, executionMs,
        projectionMs: Math.max(0, dependencies.monotonicMs() - projectionStarted) });
    }
    const evaluation = evaluateGroundedPrimarySelection({ result: settled.value, projection, mapped, canonical: runtime.canonical });
    const projectionMs = Math.max(0, dependencies.monotonicMs() - projectionStarted);
    if (dependencies.monotonicMs() >= deadline) {
      return resolution({ runtime, dependencies, status: "legacy_rollback", reasons: ["execution_timeout"], rollbackReason: "execution_timeout", result: settled.value, executionMs, projectionMs });
    }
    if (evaluation.reasons.length > 0) {
      return resolution({ runtime, dependencies, status: semanticStatus(evaluation.reasons), reasons: evaluation.reasons,
        result: settled.value, executionMs, projectionMs });
    }

    const downstreamStarted = dependencies.monotonicMs();
    let downstream;
    try {
      downstream = runtime.validateDownstream(
        structuredClone(evaluation.files),
        Object.freeze([...evaluation.proofs]),
      );
    } catch {
      return resolution({ runtime, dependencies, status: "safe_fail", reasons: ["downstream_context_ineligible"],
        result: settled.value, executionMs, projectionMs,
        downstreamMs: Math.max(0, dependencies.monotonicMs() - downstreamStarted) });
    }
    const downstreamMs = Math.max(0, dependencies.monotonicMs() - downstreamStarted);
    if (dependencies.monotonicMs() >= deadline) {
      return resolution({ runtime, dependencies, status: "legacy_rollback", reasons: ["execution_timeout"], rollbackReason: "execution_timeout",
        result: settled.value, executionMs, projectionMs, downstreamMs });
    }
    const expected = JSON.stringify(evaluation.files.map(({ path, usage }) => ({ path, usage })));
    const actual = JSON.stringify(downstream.validatedFiles.map(({ path, usage }) => ({ path, usage })));
    const downstreamReasons = uniqueReasons(downstream.validation.reasonCodes.filter((reason) => reason !== "v2_applied"));
    const passed = downstream.validation.passed && downstream.validation.qualityStatus === "ready" &&
      downstream.validation.authorizationPreserved && downstream.validation.contextAssemblyEligible && expected === actual;
    if (!passed || downstreamReasons.length > 0) {
      const reasons = expected !== actual ? ["downstream_selection_mutated" as const, ...downstreamReasons] : downstreamReasons;
      return resolution({ runtime, dependencies, status: "safe_fail",
        reasons: reasons.length > 0 ? reasons : ["downstream_context_ineligible"], downstream: downstream.validation,
        result: settled.value, executionMs, projectionMs, downstreamMs });
    }
    return resolution({ runtime, dependencies, status: "v2_applied", reasons: ["v2_applied"],
      selectedFiles: downstream.validatedFiles, proofs: evaluation.proofs, downstream: downstream.validation,
      result: settled.value, executionMs, projectionMs, downstreamMs });
  };
}

export function executeLiveTaskPackPrimaryInvestigation(
  input: Parameters<TaskPackPrimaryRuntimeDependencies["execute"]>[0],
): Promise<InvestigationRunnerResult> {
  const { canonical, abortSignal, deadlineMonotonicMs } = input;
  return createLiveContextEngineExecution({
    projectRoot: canonical.projectRoot,
    inventory: canonical.inventory,
    snapshot: canonical.snapshot,
    negativeConstraints: canonical.negativeConstraints,
    clock: defaultClock,
    abortSignal,
    plannerMode: "deterministic",
    runnerInput: {
      investigationId: stableId("primary-investigation", [canonical.snapshot.id, canonical.taskFingerprint, canonical.clarificationFingerprint, canonical.configurationFingerprint]) as InvestigationId,
      snapshot: canonical.snapshot,
      purpose: "implementation_context",
      request: {
        requestId: stableId("primary-request", [canonical.projectId, canonical.taskFingerprint, canonical.clarificationFingerprint, canonical.configurationFingerprint]) as InvestigationRequestId,
        projectId: canonical.projectId,
        task: { normalizedTask: canonical.normalizedTask },
        snapshot: canonical.snapshot,
        explicitTargets: canonical.explicitTargets,
        negativeConstraints: canonical.negativeConstraints,
        budget: canonical.executionBasis.policy.budget,
        purpose: "implementation_context",
      },
      questions: [], claims: [], hypotheses: [], entities: [], facts: [], evidence: [], findings: [],
      contradictions: [], knowledgeGaps: [], operationCandidates: [],
      budget: canonical.executionBasis.policy.budget,
      plannerPolicy: canonical.executionBasis.plannerPolicy,
      deadlineMonotonicMs: Math.ceil(deadlineMonotonicMs),
    },
  });
}

const defaultDependencies: TaskPackPrimaryRuntimeDependencies = {
  tracker: defaultTaskPackPrimaryExecutionTracker,
  ...defaultClock,
  execute: executeLiveTaskPackPrimaryInvestigation,
};

export const runLiveTaskPackPrimary = createTaskPackPrimaryService(defaultDependencies);

export function closeTaskPackPrimaryExecutionTracker(timeoutMs = 250): Promise<boolean> {
  return defaultTaskPackPrimaryExecutionTracker.close(timeoutMs);
}

function unavailableFingerprint(label: string): string {
  return `sha256:${createHash("sha256").update(label, "utf8").digest("hex")}`;
}

export function createTaskPackPrimaryPreparationFailure(input: {
  projectId: string;
  reason: "canonical_input_mismatch" | "preparation_limit_exceeded" | "execution_timeout";
  executionBasis: ContextEngineShadowExecutionBasis;
  createdAt: string;
  totalMs?: number;
}): TaskPackPrimaryDecision {
  return validateTaskPackPrimaryDecision({
    schemaVersion: 1,
    decisionId: `primary-${randomUUID()}`,
    projectId: input.projectId,
    taskFingerprint: unavailableFingerprint("primary-task-unavailable"),
    clarificationFingerprint: unavailableFingerprint("primary-clarification-unavailable"),
    inventoryFingerprint: unavailableFingerprint("primary-inventory-unavailable"),
    snapshotFingerprint: unavailableFingerprint("primary-snapshot-unavailable"),
    configurationFingerprint: contextEngineShadowConfigurationFingerprint(input.executionBasis),
    status: "engine_error",
    reasonCodes: [input.reason],
    rollbackReason: null,
    selectedFiles: [],
    groundedProofs: [],
    downstreamValidation: null,
    metrics: null,
    timing: {
      executionMs: 0,
      projectionMs: 0,
      downstreamValidationMs: 0,
      totalMs: Math.max(0, input.totalMs ?? 0),
      timeoutCeilingMs: input.executionBasis.policy.timeoutMs,
    },
    modelPlannerUsed: false,
    createdAt: input.createdAt,
  });
}
