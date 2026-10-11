import { createHash, randomUUID } from "node:crypto";

import {
  createContextProjectionService,
  type InvestigationRunnerResult,
} from "../application/index.js";
import {
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
import { createTaskPackPrimaryServiceCore } from "./taskPackPrimaryCore.js";
import { validateTaskPackPrimaryDecision } from "./primaryInvariant.js";
import type {
  TaskPackPrimaryDecision,
  TaskPackPrimaryResolution,
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

export function createTaskPackPrimaryService(
  dependencies: TaskPackPrimaryRuntimeDependencies,
): (input: TaskPackPrimaryRuntimeInput) => Promise<TaskPackPrimaryResolution> {
  return createTaskPackPrimaryServiceCore(dependencies, {
    isPrepared: isPreparedContextEngineShadowInput,
    assertCanonicalEquivalent: assertContextEngineShadowInputEquivalent,
    settle: settleContextEngineShadowExecution,
    createProjection: createContextProjectionService,
    createMapping: createLegacyTaskFileSelectionProjection,
  });
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
