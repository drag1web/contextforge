import { createHash, randomUUID } from "node:crypto";

import { ContextProjectionError, createContextProjectionService } from "../application/index.js";
import {
  LegacyProjectionError,
  createLegacyTaskFileSelectionProjection,
  createOfflineCompatibilityComparison,
} from "../adapters/legacySelection/index.js";
import type { LegacyProjectionResult } from "../adapters/legacySelection/index.js";
import type { InvestigationId, InvestigationRequestId } from "../contracts/index.js";
import { createLiveContextEngineExecution } from "../facade/liveContextEngineRuntime.js";
import {
  assertContextEngineShadowInputEquivalent,
  contextEngineShadowConfigurationFingerprint,
  createContextEngineShadowExecutionTracker,
  isPreparedContextEngineShadowInput,
  normalizeContextEngineMode,
  settleContextEngineShadowExecution,
} from "../shadow/index.js";
import { decideTaskPackCanaryCohort } from "./canaryCohort.js";
import { validateTaskPackCanaryDecision } from "./canaryInvariant.js";
import type {
  ContextEngineCanaryConfiguration,
  TaskPackCanaryCohortDecision,
  TaskPackCanaryDecision,
  TaskPackCanaryDownstreamValidation,
  TaskPackCanaryMappedFile,
  TaskPackCanaryPreparationFailureBasis,
  TaskPackCanaryReasonCode,
  TaskPackCanaryResolution,
  TaskPackCanaryRuntimeDependencies,
  TaskPackCanaryRuntimeInput,
  TaskPackCanarySelectionSummary,
} from "./canaryTypes.js";
import type { ContextEngineShadowExecutionBasis } from "../shadow/index.js";

type Selection = LegacyProjectionResult["selection"];

const CRITICAL_REASONS = new Set<TaskPackCanaryReasonCode>([
  "canonical_input_mismatch", "blocking_gap", "blocking_contradiction",
  "projection_invalid", "compatibility_invalid",
  "unsupported_confirmed_finding", "evidence_incomplete",
  "explicit_target_not_preserved", "negative_constraint_violation",
  "repository_safety_violation", "unknown_inventory_path", "role_usage_mismatch",
  "snapshot_mismatch", "repository_changed", "critical_safety_disagreement",
]);

const defaultClock = {
  nowIso: () => new Date().toISOString(),
  monotonicMs: () => Math.floor(performance.now()),
};

export const defaultTaskPackCanaryExecutionTracker =
  createContextEngineShadowExecutionTracker({ maximumActiveExecutions: 4 });

function stableId(prefix: string, values: readonly string[]): string {
  return `${prefix}-${createHash("sha256").update(values.join("\0"), "utf8").digest("hex").slice(0, 32)}`;
}

function normalizedPath(value: string): string {
  return value.replace(/\\/gu, "/").replace(/^\.\//u, "");
}

function uniqueReasons(values: readonly TaskPackCanaryReasonCode[]): TaskPackCanaryReasonCode[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function summarizeFiles(input: Selection | readonly TaskPackCanaryMappedFile[]): TaskPackCanarySelectionSummary {
  const selectedFiles: readonly TaskPackCanaryMappedFile[] = "selectedFiles" in input
    ? input.selectedFiles
    : input;
  const files = selectedFiles.map((file) => ({
    path: normalizedPath(file.path),
    usage: file.usage,
  }));
  return {
    files,
    editablePaths: files
      .filter((file) => file.usage === "inspect-and-edit" || file.usage === "create-and-edit")
      .map((file) => file.path),
  };
}

type PathUsageSelection = Selection | readonly TaskPackCanaryMappedFile[];

function pathUsageSignature(input: PathUsageSelection): string {
  const files: readonly TaskPackCanaryMappedFile[] = "selectedFiles" in input ? input.selectedFiles : input;
  return JSON.stringify(files.map((file) => ({
    path: normalizedPath(file.path),
    usage: file.usage,
  })).sort((left, right) => left.path.localeCompare(right.path) || left.usage.localeCompare(right.usage)));
}

export function hasTaskPackCanarySelectionDelta(
  legacySelection: Selection,
  validatedV2Selection: readonly TaskPackCanaryMappedFile[],
): boolean {
  return pathUsageSignature(legacySelection) !== pathUsageSignature(validatedV2Selection);
}

function deadlineExpired(deadline: number, dependencies: TaskPackCanaryRuntimeDependencies): boolean {
  return dependencies.monotonicMs() >= deadline;
}

function emptyCohort(canonical: TaskPackCanaryRuntimeInput["canonical"]): TaskPackCanaryCohortDecision {
  return decideTaskPackCanaryCohort({
    projectId: canonical.projectId,
    taskFingerprint: canonical.taskFingerprint,
    snapshotFingerprint: canonical.snapshotFingerprint,
    configuration: { percent: 0, projectIds: [] },
  });
}

function decision(input: {
  runtime: TaskPackCanaryRuntimeInput;
  cohort: TaskPackCanaryCohortDecision;
  status: TaskPackCanaryDecision["status"];
  reasons: readonly TaskPackCanaryReasonCode[];
  v2Files?: readonly TaskPackCanaryMappedFile[] | null;
  downstream?: TaskPackCanaryDownstreamValidation | null;
  started: number;
  v2Ms?: number;
  downstreamMs?: number;
  gatesPassed?: boolean;
  selectionDelta?: boolean;
  dependencies: TaskPackCanaryRuntimeDependencies;
}): TaskPackCanaryDecision {
  const canonical = input.runtime.canonical;
  return validateTaskPackCanaryDecision({
    schemaVersion: 1,
    decisionId: `canary-${randomUUID()}`,
    mode: normalizeContextEngineMode(input.runtime.mode),
    cohort: input.cohort,
    taskFingerprint: canonical.taskFingerprint,
    clarificationFingerprint: canonical.clarificationFingerprint,
    inventoryFingerprint: canonical.inventoryFingerprint,
    snapshotFingerprint: canonical.snapshotFingerprint,
    configurationFingerprint: canonical.configurationFingerprint,
    status: input.status,
    gatesPassed: input.gatesPassed ?? false,
    selectionDelta: input.selectionDelta ?? false,
    reasonCodes: uniqueReasons(input.reasons),
    legacy: summarizeFiles(input.runtime.legacySelection),
    v2: input.v2Files ? summarizeFiles(input.v2Files) : null,
    downstreamValidation: input.downstream ?? null,
    timing: {
      v2Ms: Math.max(0, input.v2Ms ?? 0),
      downstreamValidationMs: Math.max(0, input.downstreamMs ?? 0),
      totalMs: Math.max(0, input.dependencies.monotonicMs() - input.started),
      timeoutCeilingMs: canonical.executionBasis.policy.timeoutMs,
    },
    createdAt: input.dependencies.nowIso(),
  });
}

function fallback(input: {
  runtime: TaskPackCanaryRuntimeInput;
  cohort: TaskPackCanaryCohortDecision;
  status: TaskPackCanaryDecision["status"];
  reasons: readonly TaskPackCanaryReasonCode[];
  started: number;
  dependencies: TaskPackCanaryRuntimeDependencies;
  v2Files?: readonly TaskPackCanaryMappedFile[] | null;
  downstream?: TaskPackCanaryDownstreamValidation | null;
  v2Ms?: number;
  downstreamMs?: number;
}): TaskPackCanaryResolution {
  return {
    adoptedFiles: null,
    applied: false,
    gatesPassed: false,
    selectionDelta: false,
    decision: decision({ ...input }),
  };
}

function confirmedEvidenceProblems(result: Awaited<ReturnType<TaskPackCanaryRuntimeDependencies["execute"]>>): TaskPackCanaryReasonCode[] {
  const evidenceById = new Map(result.evidence.map((record) => [record.id, record]));
  const reasons: TaskPackCanaryReasonCode[] = [];
  for (const finding of result.findings.filter((entry) => entry.status === "confirmed")) {
    if (finding.snapshotId !== result.snapshotId) reasons.push("snapshot_mismatch");
    const evidence = finding.evidenceIds.map((id) => evidenceById.get(id));
    if (evidence.length === 0 || evidence.some((record) =>
      !record || record.snapshotId !== result.snapshotId || record.role !== "supports" || !record.freshness.current,
    )) reasons.push("unsupported_confirmed_finding", "evidence_incomplete");
  }
  return reasons;
}

function mapValidatedCandidateFiles(mapped: LegacyProjectionResult): TaskPackCanaryMappedFile[] {
  return mapped.selection.selectedFiles.map((file) => {
    const trace = mapped.files[normalizedPath(file.path)];
    if (!trace) throw new Error("compatibility_invalid");
    return {
      path: normalizedPath(file.path),
      kind: file.kind,
      usage: file.usage,
    };
  });
}

function evaluateCandidate(input: {
  runtime: TaskPackCanaryRuntimeInput;
  result: Awaited<ReturnType<TaskPackCanaryRuntimeDependencies["execute"]>>;
  projection: ReturnType<ReturnType<typeof createContextProjectionService>["project"]>;
  mapped: LegacyProjectionResult;
}): TaskPackCanaryReasonCode[] {
  const { canonical } = input.runtime;
  const reasons: TaskPackCanaryReasonCode[] = [];
  if (input.result.snapshotId !== canonical.snapshot.id || input.projection.projection.snapshotId !== canonical.snapshot.id) {
    reasons.push("snapshot_mismatch");
  }
  if (input.result.stop.reason === "repository_changed") reasons.push("repository_changed");
  if (input.result.stop.reason !== "sufficient_evidence") reasons.push("stop_not_sufficient");
  if (!input.result.safeToProject || !input.result.stop.safeToProject ||
      !input.projection.source.safeToProject || input.projection.source.stopReason !== "sufficient_evidence") {
    reasons.push("result_not_safe");
  }
  if (input.result.knowledgeGaps.some((gap) => gap.status === "open" && gap.blocks.length > 0)) reasons.push("blocking_gap");
  if (input.result.contradictions.some((record) => record.status === "open" && record.severity === "blocking")) reasons.push("blocking_contradiction");
  reasons.push(...confirmedEvidenceProblems(input.result));

  const comparison = createOfflineCompatibilityComparison().compare({
    legacySelection: input.runtime.legacySelection,
    v2Projection: input.projection,
    snapshot: canonical.snapshot,
    negativeConstraints: canonical.negativeConstraints,
    explicitTargets: canonical.explicitTargets,
  });
  if (comparison.explicitTargets.some((target) => target.v2Status !== "preserved")) reasons.push("explicit_target_not_preserved");
  if (comparison.safety.v2NegativeConstraintViolations.length > 0) reasons.push("negative_constraint_violation");
  if (comparison.safety.v2RepositorySafetyViolations.length > 0) reasons.push("repository_safety_violation");
  if (!comparison.safety.safeBlockAgreement) reasons.push("critical_safety_disagreement");

  const inventoryByPath = new Map(canonical.inventory.files.map((file) => [normalizedPath(file.path), file]));
  const snapshotByPath = new Map(canonical.snapshot.files.map((file) => [file.normalizedPath, file]));
  const preservedExplicitPaths = new Set(comparison.explicitTargets
    .filter((target) => target.v2Status === "preserved" && target.resolvedPath)
    .map((target) => normalizedPath(target.resolvedPath!)));
  let editable = 0;
  const editablePaths: string[] = [];
  for (const selected of input.mapped.selection.selectedFiles) {
    const path = normalizedPath(selected.path);
    const trace = input.mapped.files[path];
    const inventoryFile = inventoryByPath.get(path);
    const descriptor = snapshotByPath.get(path);
    if (!trace || !inventoryFile || !descriptor) {
      reasons.push("unknown_inventory_path");
      continue;
    }
    if (!inventoryFile.canReadText || !descriptor.readable || descriptor.secretRisk === "known" ||
        ((trace.role === "target" || trace.role === "test") && (inventoryFile.isLikelyGenerated || descriptor.generated))) {
      reasons.push("repository_safety_violation");
    }
    const isEditable = selected.usage === "inspect-and-edit" || selected.usage === "create-and-edit";
    if (isEditable) {
      editable += 1;
      editablePaths.push(path);
    }
    if (trace.reviewRequired) reasons.push("review_required");
    if ((trace.role === "target" || trace.role === "test") !== isEditable ||
        ((trace.role === "supporting" || trace.role === "reference") && isEditable)) {
      reasons.push("role_usage_mismatch");
    }
  }
  if (editable === 0) reasons.push("no_editable_target");
  if (preservedExplicitPaths.size === 0 || editablePaths.some((path) => !preservedExplicitPaths.has(path))) {
    reasons.push("explicit_target_only_canary");
  }
  return uniqueReasons(reasons);
}

export function createTaskPackCanaryService(
  dependencies: TaskPackCanaryRuntimeDependencies,
): (input: TaskPackCanaryRuntimeInput) => Promise<TaskPackCanaryResolution> {
  return async (runtime) => {
    const observedStart = dependencies.monotonicMs();
    const started = Number.isFinite(runtime.requestStartedMonotonicMs)
      ? runtime.requestStartedMonotonicMs
      : observedStart;
    const mode = normalizeContextEngineMode(runtime.mode);
    const disabledCohort = emptyCohort(runtime.canonical);
    if (mode !== "canary") {
      return fallback({ runtime, cohort: disabledCohort, status: "not_enabled", reasons: ["canary_disabled"], started, dependencies });
    }
    let cohort: TaskPackCanaryCohortDecision;
    try {
      if (!isPreparedContextEngineShadowInput(runtime.canonical)) throw new Error("canonical_input_mismatch");
      assertContextEngineShadowInputEquivalent(runtime.canonical);
      if (!Number.isFinite(runtime.requestStartedMonotonicMs) ||
          !Number.isFinite(runtime.requestDeadlineMonotonicMs) ||
          runtime.requestStartedMonotonicMs > observedStart ||
          runtime.requestDeadlineMonotonicMs !== runtime.requestStartedMonotonicMs + runtime.canonical.executionBasis.policy.timeoutMs) {
        throw new Error("canonical_input_mismatch");
      }
      cohort = decideTaskPackCanaryCohort({
        projectId: runtime.canonical.projectId,
        taskFingerprint: runtime.canonical.taskFingerprint,
        snapshotFingerprint: runtime.canonical.snapshotFingerprint,
        configuration: runtime.configuration,
      });
    } catch {
      return fallback({ runtime, cohort: disabledCohort, status: "critical_disagreement", reasons: ["canonical_input_mismatch"], started, dependencies });
    }
    if (runtime.manualSelectionRequested) {
      return fallback({ runtime, cohort, status: "v2_ineligible", reasons: ["manual_selection_authoritative"], started, dependencies });
    }
    if (!cohort.included) {
      return fallback({ runtime, cohort, status: "not_in_cohort", reasons: ["project_not_in_cohort"], started, dependencies });
    }

    const policy = runtime.canonical.executionBasis.policy;
    const deadline = runtime.requestDeadlineMonotonicMs;
    if (deadlineExpired(deadline, dependencies)) {
      return fallback({ runtime, cohort, status: "legacy_fallback", reasons: ["execution_timeout"], started, dependencies });
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
        deadlineMonotonicMs: Math.min(deadline, executionStarted + policy.budget.maxWallTimeMs),
      }),
    });
    if (tracked === null) {
      runtime.parentAbortSignal?.removeEventListener("abort", abortFromParent);
      return fallback({ runtime, cohort, status: "legacy_fallback", reasons: ["capacity_exhausted"], started, dependencies });
    }
    const settled = await settleContextEngineShadowExecution({
      execution: tracked,
      abortController,
      timeoutMs: Math.max(1, Math.ceil(deadline - dependencies.monotonicMs())),
    });
    runtime.parentAbortSignal?.removeEventListener("abort", abortFromParent);
    const v2Ms = Math.max(0, dependencies.monotonicMs() - executionStarted);
    if (settled.status !== "completed") {
      return fallback({
        runtime, cohort, status: "legacy_fallback",
        reasons: [settled.status === "timeout" ? "execution_timeout" : "execution_error"],
        started, dependencies, v2Ms,
      });
    }

    let projection: ReturnType<ReturnType<typeof createContextProjectionService>["project"]>;
    let mapped: LegacyProjectionResult;
    try {
      if (deadlineExpired(deadline, dependencies)) throw new Error("execution_timeout");
      projection = createContextProjectionService().project({
        result: settled.value,
        snapshot: runtime.canonical.snapshot,
        purpose: "legacy_selection",
        explicitTargets: runtime.canonical.explicitTargets,
        negativeConstraints: runtime.canonical.negativeConstraints,
      });
      mapped = createLegacyTaskFileSelectionProjection().project(projection, runtime.canonical.snapshot, {
        effectiveTaskArea: runtime.canonical.executionBasis.effectiveTaskArea as Selection["effectiveTaskArea"],
        requestedTaskType: runtime.canonical.executionBasis.requestedTaskType,
        negativeConstraints: runtime.canonical.negativeConstraints,
      });
    } catch (error) {
      const timeout = deadlineExpired(deadline, dependencies) ||
        (error instanceof Error && error.message === "execution_timeout");
      const integrityReason: TaskPackCanaryReasonCode | null = error instanceof ContextProjectionError
        ? error.code === "snapshot_mismatch" ? "snapshot_mismatch" : "projection_invalid"
        : error instanceof LegacyProjectionError
          ? error.code === "snapshot_mismatch" ? "snapshot_mismatch" : "compatibility_invalid"
          : null;
      return fallback({
        runtime, cohort, status: integrityReason ? "critical_disagreement" : "legacy_fallback",
        reasons: [timeout ? "execution_timeout" : integrityReason ?? "execution_error"],
        started, dependencies, v2Ms,
      });
    }

    if (deadlineExpired(deadline, dependencies)) {
      return fallback({ runtime, cohort, status: "legacy_fallback", reasons: ["execution_timeout"], started, dependencies, v2Ms });
    }

    let reasons: TaskPackCanaryReasonCode[];
    try {
      reasons = evaluateCandidate({ runtime, result: settled.value, projection, mapped });
    } catch {
      reasons = ["compatibility_invalid"];
    }
    if (deadlineExpired(deadline, dependencies)) {
      return fallback({ runtime, cohort, status: "legacy_fallback", reasons: ["execution_timeout"], started, dependencies, v2Ms });
    }
    let candidate: TaskPackCanaryMappedFile[];
    try {
      candidate = mapValidatedCandidateFiles(mapped);
    } catch {
      return fallback({
        runtime, cohort, status: "critical_disagreement", reasons: ["compatibility_invalid"],
        started, dependencies, v2Ms,
      });
    }
    if (reasons.length > 0) {
      const critical = reasons.some((reason) => CRITICAL_REASONS.has(reason));
      return fallback({
        runtime, cohort, status: critical ? "critical_disagreement" : "v2_ineligible",
        reasons, started, dependencies, v2Ms, v2Files: candidate,
      });
    }

    const downstreamStarted = dependencies.monotonicMs();
    let downstreamResult;
    try {
      downstreamResult = runtime.validateDownstream(structuredClone(candidate));
    } catch {
      return fallback({
        runtime, cohort, status: "legacy_fallback", reasons: ["downstream_context_ineligible"],
        started, dependencies, v2Ms, v2Files: candidate,
        downstreamMs: Math.max(0, dependencies.monotonicMs() - downstreamStarted),
      });
    }
    const downstreamMs = Math.max(0, dependencies.monotonicMs() - downstreamStarted);
    if (deadlineExpired(deadline, dependencies)) {
      return fallback({
        runtime, cohort, status: "legacy_fallback", reasons: ["execution_timeout"],
        started, dependencies, v2Ms, v2Files: candidate, downstreamMs,
      });
    }
    const downstreamReasons = uniqueReasons(downstreamResult.validation.reasonCodes);
    const downstreamPassed = downstreamResult.validation.passed &&
      downstreamResult.validation.qualityStatus === "ready" &&
      downstreamResult.validation.authorizationPreserved &&
      downstreamResult.validation.contextAssemblyEligible;
    if (pathUsageSignature(downstreamResult.validatedFiles) !== pathUsageSignature(candidate)) {
      downstreamReasons.push("downstream_selection_mutated");
    }
    if (!downstreamPassed || downstreamReasons.some((reason) => reason !== "v2_applied")) {
      return fallback({
        runtime, cohort, status: "v2_ineligible",
        reasons: downstreamReasons.filter((reason) => reason !== "v2_applied").length > 0
          ? downstreamReasons.filter((reason) => reason !== "v2_applied")
          : ["downstream_context_ineligible"],
        started, dependencies, v2Ms, v2Files: candidate,
        downstream: downstreamResult.validation, downstreamMs,
      });
    }
    const selectionDelta = hasTaskPackCanarySelectionDelta(runtime.legacySelection, downstreamResult.validatedFiles);
    const appliedDecision = decision({
      runtime, cohort,
      status: selectionDelta ? "v2_applied" : "v2_confirmed_no_change",
      reasons: [selectionDelta ? "v2_applied" : "v2_no_selection_delta"],
      v2Files: candidate, downstream: downstreamResult.validation,
      started, dependencies, v2Ms, downstreamMs, gatesPassed: true, selectionDelta,
    });
    return {
      adoptedFiles: selectionDelta ? structuredClone(downstreamResult.validatedFiles) : null,
      decision: appliedDecision,
      applied: selectionDelta,
      gatesPassed: true,
      selectionDelta,
    };
  };
}

const defaultDependencies: TaskPackCanaryRuntimeDependencies = {
  tracker: defaultTaskPackCanaryExecutionTracker,
  ...defaultClock,
  execute: ({ canonical, abortSignal, deadlineMonotonicMs }) => createLiveContextEngineExecution({
    projectRoot: canonical.projectRoot,
    inventory: canonical.inventory,
    snapshot: canonical.snapshot,
    negativeConstraints: canonical.negativeConstraints,
    clock: defaultClock,
    abortSignal,
    runnerInput: {
      investigationId: stableId("canary-investigation", [canonical.snapshot.id, canonical.taskFingerprint, canonical.clarificationFingerprint]) as InvestigationId,
      snapshot: canonical.snapshot,
      purpose: "implementation_context",
      request: {
        requestId: stableId("canary-request", [canonical.projectId, canonical.taskFingerprint, canonical.clarificationFingerprint, canonical.configurationFingerprint]) as InvestigationRequestId,
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
  }),
};

export const runLiveTaskPackCanary = createTaskPackCanaryService(defaultDependencies);

function hash(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

export function createTaskPackCanaryPreparationFailure(input: {
  projectId: string;
  failureBasis: TaskPackCanaryPreparationFailureBasis;
  legacySelection: Selection;
  executionBasis: ContextEngineShadowExecutionBasis;
  configuration: ContextEngineCanaryConfiguration;
  createdAt: string;
  totalMs?: number;
}): TaskPackCanaryDecision {
  const taskFingerprint = hash(`preparation-failure:${input.failureBasis.reasonCode}`);
  const snapshotFingerprint = hash("unavailable");
  const cohort = decideTaskPackCanaryCohort({
    projectId: input.projectId,
    taskFingerprint,
    snapshotFingerprint,
    configuration: input.configuration,
  });
  return validateTaskPackCanaryDecision({
    schemaVersion: 1,
    decisionId: `canary-${randomUUID()}`,
    mode: "canary",
    cohort,
    taskFingerprint,
    clarificationFingerprint: hash("unavailable"),
    inventoryFingerprint: hash(JSON.stringify(input.failureBasis)),
    snapshotFingerprint,
    configurationFingerprint: contextEngineShadowConfigurationFingerprint(input.executionBasis),
    status: input.failureBasis.reasonCode === "canonical_input_mismatch"
      ? "critical_disagreement"
      : "legacy_fallback",
    gatesPassed: false,
    selectionDelta: false,
    reasonCodes: [input.failureBasis.reasonCode],
    legacy: { files: [], editablePaths: [] },
    v2: null,
    downstreamValidation: null,
    timing: {
      v2Ms: 0,
      downstreamValidationMs: 0,
      totalMs: Math.max(0, input.totalMs ?? 0),
      timeoutCeilingMs: input.executionBasis.policy.timeoutMs,
    },
    createdAt: input.createdAt,
  });
}

export function withTaskPackCanaryTotalTiming(
  value: TaskPackCanaryDecision,
  totalMs: number,
): TaskPackCanaryDecision {
  return validateTaskPackCanaryDecision({
    ...structuredClone(value),
    timing: {
      ...value.timing,
      totalMs: Math.max(value.timing.totalMs, totalMs),
    },
  });
}

export function createTaskPackCanaryDeadlineFallback(
  value: TaskPackCanaryDecision,
  totalMs: number,
): TaskPackCanaryDecision {
  return validateTaskPackCanaryDecision({
    ...structuredClone(value),
    status: "legacy_fallback",
    gatesPassed: false,
    selectionDelta: false,
    reasonCodes: ["execution_timeout"],
    timing: {
      ...value.timing,
      totalMs: Math.max(value.timing.totalMs, totalMs),
    },
  });
}

export function createTaskPackCanaryNoSelectionDelta(
  value: TaskPackCanaryDecision,
  totalMs: number,
): TaskPackCanaryDecision {
  return validateTaskPackCanaryDecision({
    ...structuredClone(value),
    status: "v2_confirmed_no_change",
    gatesPassed: true,
    selectionDelta: false,
    reasonCodes: ["v2_no_selection_delta"],
    timing: {
      ...value.timing,
      totalMs: Math.max(value.timing.totalMs, totalMs),
    },
  });
}

export function createTaskPackCanaryProductionFallback(
  value: TaskPackCanaryDecision,
  totalMs: number,
  reason: "downstream_selection_mutated" | "execution_timeout",
): TaskPackCanaryDecision {
  return validateTaskPackCanaryDecision({
    ...structuredClone(value),
    status: reason === "execution_timeout" ? "legacy_fallback" : "v2_ineligible",
    gatesPassed: false,
    selectionDelta: false,
    reasonCodes: [reason],
    timing: {
      ...value.timing,
      totalMs: Math.max(value.timing.totalMs, totalMs),
    },
  });
}

export function closeTaskPackCanaryExecutionTracker(timeoutMs = 250): Promise<boolean> {
  return defaultTaskPackCanaryExecutionTracker.close(timeoutMs);
}
