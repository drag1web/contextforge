import { createHash } from "node:crypto";

import {
  createLegacyTaskFileSelectionProjection,
  createOfflineCompatibilityComparison,
  LegacyProjectionError,
} from "../adapters/index.js";
import {
  ContextProjectionError,
  createContextProjectionService,
} from "../application/index.js";
import type {
  InvestigationId,
  InvestigationRequestId,
} from "../contracts/index.js";
import { createLiveContextEngineExecution } from "../facade/liveContextEngineRuntime.js";
import {
  defaultContextComposerExecutionTracker,
} from "./composerExecutionTracker.js";
import {
  assertContextComposerCanonicalInput,
  contextComposerSnapshotsEquivalent,
  contextComposerStableSerialize,
  prepareContextComposerCanonicalInput,
  type ContextComposerV2ExecutionInput,
} from "./composerCanonicalInput.js";
import { validateContextComposerEngineView } from "./composerInvariant.js";
import type {
  ContextComposerEngineFileView,
  ContextComposerEngineMode,
  ContextComposerEngineReasonCode,
  ContextComposerEngineResolution,
  ContextComposerEngineView,
  ContextComposerEvidenceView,
  ContextComposerCanonicalExecutionInput,
  ContextComposerV2ExecutionResult,
} from "./composerTypes.js";
import { CONTEXT_COMPOSER_MODEL_PLANNER_IDENTIFIER } from "./composerCanonicalInput.js";

const clock = {
  nowIso: () => new Date().toISOString(),
  monotonicMs: () => Math.floor(performance.now()),
};

export type ContextComposerV2Executor = (
  input: ContextComposerCanonicalExecutionInput,
) => Promise<ContextComposerV2ExecutionResult>;

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function assertDataRecord(value: unknown, allowedFields: readonly string[], requiredFields: readonly string[] = allowedFields): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_composer_runtime_input");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error("invalid_composer_runtime_input");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== "string")) throw new Error("invalid_composer_runtime_input");
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!allowedFields.includes(key) || descriptor.get || descriptor.set || !("value" in descriptor) || !descriptor.enumerable) {
      throw new Error("invalid_composer_runtime_input");
    }
  }
  if (requiredFields.some((key) => !descriptors[key])) throw new Error("invalid_composer_runtime_input");
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
}

function stableId(prefix: string, values: readonly string[]): string {
  return `${prefix}-${hash(values.join("\0")).slice(0, 32)}`;
}

export function deriveContextComposerTraceIdentity(input: ContextComposerCanonicalExecutionInput): Readonly<{
  investigationId: InvestigationId;
  requestId: InvestigationRequestId;
}> {
  assertContextComposerCanonicalInput(input);
  const basis = [input.snapshot.id, input.projectId, input.taskFingerprint, input.constraintFingerprint, input.configurationFingerprint];
  return Object.freeze({
    investigationId: stableId("composer-investigation", basis) as InvestigationId,
    requestId: stableId("composer-request", basis) as InvestigationRequestId,
  });
}

function uniqueSorted<T>(values: readonly T[], key: (value: T) => string): T[] {
  return [...new Map(values.map((value) => [key(value), value])).values()]
    .sort((left, right) => key(left).localeCompare(key(right)));
}

async function executePreparedContextComposerV2(
  input: ContextComposerCanonicalExecutionInput,
  runtime?: Pick<ContextComposerV2ExecutionInput,
    "tracker" | "modelPlanner" | "modelPlannerTracker" | "observeModelPlanner">,
): Promise<ContextComposerV2ExecutionResult> {
  assertContextComposerCanonicalInput(input);
  const { executionBasis, explicitTargets, negativeConstraints, snapshot } = input;
  const { budget, timeoutMs } = executionBasis.policy;
  const traceIdentity = deriveContextComposerTraceIdentity(input);
  const abortController = new AbortController();
  const started = clock.monotonicMs();
  const execution = (runtime?.tracker ?? defaultContextComposerExecutionTracker).tryTrack({
    abortController,
    start: () => createLiveContextEngineExecution({
      projectRoot: input.projectRoot,
      inventory: input.inventory,
      snapshot,
      negativeConstraints,
      clock,
      abortSignal: abortController.signal,
      plannerMode: executionBasis.plannerIdentifier === CONTEXT_COMPOSER_MODEL_PLANNER_IDENTIFIER
        ? "model_assisted"
        : "deterministic",
      ...(runtime?.modelPlanner ? { modelPlanner: runtime.modelPlanner } : {}),
      ...(runtime?.modelPlannerTracker ? { modelPlannerTracker: runtime.modelPlannerTracker } : {}),
      ...(runtime?.observeModelPlanner ? { observeModelPlanner: runtime.observeModelPlanner } : {}),
      runnerInput: {
        investigationId: traceIdentity.investigationId,
        snapshot,
        purpose: "implementation_context",
        request: {
          requestId: traceIdentity.requestId,
          projectId: input.projectId,
          task: { normalizedTask: input.normalizedTask },
          snapshot,
          explicitTargets: [...explicitTargets],
          negativeConstraints: [...negativeConstraints],
          budget,
          purpose: "implementation_context",
        },
        questions: [], claims: [], hypotheses: [], entities: [], facts: [], evidence: [], findings: [],
        contradictions: [], knowledgeGaps: [], operationCandidates: [], budget,
        plannerPolicy: executionBasis.plannerPolicy,
        deadlineMonotonicMs: Math.ceil(started + Math.min(timeoutMs, budget.maxWallTimeMs)),
      },
    }),
  });
  if (!execution) throw new Error("v2_capacity_exhausted");

  let timer: ReturnType<typeof setTimeout> | undefined;
  const settled = await Promise.race([
    execution.then((value) => ({ status: "completed" as const, value }), () => ({ status: "error" as const })),
    new Promise<{ status: "timeout" }>((resolve) => {
      timer = setTimeout(() => {
        abortController.abort();
        resolve({ status: "timeout" });
      }, timeoutMs);
    }),
  ]);
  if (timer) clearTimeout(timer);
  if (settled.status !== "completed") {
    abortController.abort();
    throw new Error(settled.status === "timeout" ? "v2_execution_timeout" : "v2_execution_error");
  }
  const result = settled.value;
  const projection = createContextProjectionService().project({
    result,
    snapshot,
    purpose: "legacy_selection",
    explicitTargets,
    negativeConstraints,
  });
  const legacyProjection = createLegacyTaskFileSelectionProjection().project(projection, snapshot, {
    effectiveTaskArea: executionBasis.effectiveTaskArea as Parameters<ReturnType<typeof createLegacyTaskFileSelectionProjection>["project"]>[2]["effectiveTaskArea"],
    requestedTaskType: executionBasis.requestedTaskType,
    negativeConstraints,
  });
  return Object.freeze({ result, projection, legacyProjection, snapshot });
}

export async function executeContextComposerV2(input: ContextComposerV2ExecutionInput): Promise<ContextComposerV2ExecutionResult> {
  const prepared = prepareContextComposerCanonicalInput(input);
  return executePreparedContextComposerV2(prepared, input);
}

const BLOCKING_CODES = new Set([
  "blocking_gap", "blocking_contradiction", "negative_constraint", "secret_file", "generated_target_blocked",
  "unreadable_file", "missing_evidence", "evidence_entity_mismatch", "result_not_safe_to_project", "stop_reason_blocks_projection",
  "canonical_input_mismatch", "repository_changed", "v2_integrity_violation",
]);

function mapReason(value: string | undefined): ContextComposerEngineReasonCode {
  const allowed = new Set<ContextComposerEngineReasonCode>([
    "confirmed_implementation_target", "confirmed_test_target", "confirmed_supporting_context", "explicit_target_eligible",
    "probable_review_only", "blocking_gap", "blocking_contradiction", "negative_constraint", "secret_file",
    "generated_target_blocked", "unreadable_file", "missing_evidence", "evidence_entity_mismatch",
    "result_not_safe_to_project", "stop_reason_blocks_projection", "repository_changed",
  ]);
  return allowed.has(value as ContextComposerEngineReasonCode)
    ? value as ContextComposerEngineReasonCode
    : "v2_not_grounded";
}

function evidenceViews(
  execution: ContextComposerV2ExecutionResult,
  evidenceIds: readonly string[],
  reasonCode: ContextComposerEngineReasonCode,
): ContextComposerEvidenceView[] {
  const facts = new Map(execution.result.facts.map((fact) => [fact.id as string, fact]));
  return execution.result.evidence
    .filter((entry) => evidenceIds.includes(entry.id as string))
    .map((entry): ContextComposerEvidenceView => {
      const fact = entry.factIds.map((id) => facts.get(id as string)).find(Boolean);
      const span = entry.sourceSpans[0];
      return {
        evidenceId: entry.id as string,
        role: entry.role,
        strength: entry.strength,
        predicate: fact?.predicate,
        relationKind: fact?.kind,
        path: span?.path,
        startLine: span?.startLine,
        endLine: span?.endLine,
        reasonCode,
      };
    })
    .sort((left, right) => left.evidenceId.localeCompare(right.evidenceId));
}

function v2Files(execution: ContextComposerV2ExecutionResult): ContextComposerEngineFileView[] {
  const precedence = { reference: 0, supporting: 1, test: 2, target: 3 } as const;
  const files = new Map<string, ContextComposerEngineFileView>();
  for (const decision of execution.projection.decisions
    .filter((entry) => entry.included && entry.path && entry.role)) {
      const reasonCodes = uniqueSorted(decision.reasonCodes.map(mapReason), (value) => value);
      const reasonCode = reasonCodes.find((value) => !BLOCKING_CODES.has(value)) ?? reasonCodes[0] ?? "v2_not_grounded";
      const next: ContextComposerEngineFileView = {
        path: decision.path!,
        role: decision.role!,
        usage: decision.role === "target" || decision.role === "test" ? "inspect-and-edit" : "inspect-only",
        source: "v2",
        reviewRequired: decision.reviewRequired,
        reasonCode,
        reasonCodes,
        findingIds: uniqueSorted(decision.findingIds as string[], (value) => value),
        evidenceIds: uniqueSorted(decision.evidenceIds as string[], (value) => value),
        evidence: evidenceViews(execution, decision.evidenceIds as string[], reasonCode),
      };
      const key = next.path.toLocaleLowerCase("en-US");
      const existing = files.get(key);
      if (!existing) {
        files.set(key, next);
        continue;
      }
      const role = precedence[next.role] > precedence[existing.role] ? next.role : existing.role;
      const mergedReasonCodes = uniqueSorted([...existing.reasonCodes, ...next.reasonCodes], (value) => value);
      const mergedReason = mergedReasonCodes.find((value) => !BLOCKING_CODES.has(value)) ?? mergedReasonCodes[0] ?? "v2_not_grounded";
      const mergedEvidence = uniqueSorted([...existing.evidence, ...next.evidence], (value) => value.evidenceId);
      files.set(key, {
        path: existing.path,
        role,
        usage: role === "target" || role === "test" ? "inspect-and-edit" : "inspect-only",
        source: "v2",
        reviewRequired: existing.reviewRequired || next.reviewRequired,
        reasonCode: mergedReason,
        reasonCodes: mergedReasonCodes,
        findingIds: uniqueSorted([...existing.findingIds, ...next.findingIds], (value) => value),
        evidenceIds: uniqueSorted([...existing.evidenceIds, ...next.evidenceIds], (value) => value),
        evidence: mergedEvidence,
      });
  }
  return [...files.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function legacyFiles(selection: ContextComposerEngineResolution["selection"]): ContextComposerEngineFileView[] {
  return (selection?.selectedFiles ?? []).map((file) => ({
    path: file.path,
    role: file.usage === "inspect-and-edit" || file.usage === "create-and-edit" ? "target" as const : "reference" as const,
    usage: file.usage === "create-and-edit" ? "inspect-and-edit" as const : file.usage,
    source: "legacy" as const,
    reviewRequired: file.usage !== "inspect-and-edit" && file.usage !== "create-and-edit",
    reasonCode: "legacy_candidate" as const,
    reasonCodes: ["legacy_candidate" as const],
    findingIds: [], evidenceIds: [], evidence: [],
  })).sort((left, right) => left.path.localeCompare(right.path));
}

function comparisonView(summary: ReturnType<ReturnType<typeof createOfflineCompatibilityComparison>["compare"]>) {
  return {
    outcome: summary.outcome,
    exactEditablePaths: [...summary.overlap.exactEditablePaths].sort(),
    legacyOnlyEditablePaths: [...summary.overlap.legacyOnlyEditablePaths].sort(),
    v2OnlyEditablePaths: [...summary.overlap.v2OnlyEditablePaths].sort(),
    safeBlockAgreement: summary.safety.safeBlockAgreement,
    explicitTargetDisagreements: summary.explicitTargetDisagreements
      .map((value) => `target-sha256:${hash(value)}`)
      .sort(),
  };
}

function makeView(input: Omit<ContextComposerEngineView, "schemaVersion">): ContextComposerEngineView {
  return validateContextComposerEngineView({ schemaVersion: 1, ...input });
}

export function createLegacyContextComposerEngineResolution(input: {
  mode: ContextComposerEngineMode;
  legacySelection: ContextComposerEngineResolution["selection"];
}): ContextComposerEngineResolution {
  return Object.freeze({
    view: makeView({
      requestedMode: input.mode,
      effectiveSource: "legacy",
      status: "legacy",
      stopReason: null,
      fallbackReason: null,
      files: legacyFiles(input.legacySelection),
      unresolvedQuestions: [], limitations: [], comparison: null,
    }),
    selection: input.legacySelection,
    useLegacySelection: true,
  });
}

function transientFallback(input: {
  mode: ContextComposerEngineMode;
  legacySelection: NonNullable<ContextComposerEngineResolution["selection"]>;
  reason: "v2_execution_timeout" | "v2_capacity_exhausted" | "v2_execution_error";
}): ContextComposerEngineResolution {
  return Object.freeze({
    view: makeView({
      requestedMode: input.mode,
      effectiveSource: "legacy",
      status: "legacy_fallback",
      stopReason: null,
      fallbackReason: input.reason,
      files: legacyFiles(input.legacySelection),
      unresolvedQuestions: [],
      limitations: [input.reason],
      comparison: null,
    }),
    selection: input.legacySelection,
    useLegacySelection: true,
  });
}

function integrityBlock(input: {
  mode: ContextComposerEngineMode;
  reason: "canonical_input_mismatch" | "repository_changed" | "v2_integrity_violation";
  stopReason?: ContextComposerEngineView["stopReason"];
}): ContextComposerEngineResolution {
  return Object.freeze({
    view: makeView({
      requestedMode: input.mode,
      effectiveSource: "v2",
      status: "safety_blocked",
      stopReason: input.stopReason ?? null,
      fallbackReason: null,
      files: [],
      unresolvedQuestions: [],
      limitations: [input.reason],
      comparison: null,
    }),
    selection: null,
    useLegacySelection: false,
  });
}

function assertExecutionBoundToCanonicalInput(
  value: ContextComposerV2ExecutionResult,
  canonical: ContextComposerCanonicalExecutionInput,
): ContextComposerV2ExecutionResult {
  const item = assertDataRecord(value, ["result", "projection", "legacyProjection", "snapshot"]);
  const snapshot = item.snapshot as ContextComposerV2ExecutionResult["snapshot"];
  if (!contextComposerSnapshotsEquivalent(snapshot, canonical.snapshot)) {
    throw new Error("v2_integrity_violation");
  }
  const result = item.result as ContextComposerV2ExecutionResult["result"];
  const projection = createContextProjectionService().project({
    result,
    snapshot: canonical.snapshot,
    purpose: "legacy_selection",
    explicitTargets: canonical.explicitTargets,
    negativeConstraints: canonical.negativeConstraints,
  });
  const legacyProjection = createLegacyTaskFileSelectionProjection().project(projection, canonical.snapshot, {
    effectiveTaskArea: canonical.executionBasis.effectiveTaskArea as Parameters<ReturnType<typeof createLegacyTaskFileSelectionProjection>["project"]>[2]["effectiveTaskArea"],
    requestedTaskType: canonical.executionBasis.requestedTaskType,
    negativeConstraints: canonical.negativeConstraints,
  });
  if (
    contextComposerStableSerialize(item.projection) !== contextComposerStableSerialize(projection) ||
    contextComposerStableSerialize(item.legacyProjection) !== contextComposerStableSerialize(legacyProjection)
  ) {
    throw new Error("v2_integrity_violation");
  }
  return Object.freeze({ result, projection, legacyProjection, snapshot: canonical.snapshot });
}

function executionFailureReason(error: unknown): "v2_execution_timeout" | "v2_capacity_exhausted" | "v2_execution_error" {
  if (error instanceof Error && error.message === "v2_execution_timeout") return "v2_execution_timeout";
  if (error instanceof Error && error.message === "v2_capacity_exhausted") return "v2_capacity_exhausted";
  return "v2_execution_error";
}

function isIntegrityFailure(error: unknown): boolean {
  return error instanceof ContextProjectionError || error instanceof LegacyProjectionError ||
    (error instanceof Error && ["canonical_input_mismatch", "v2_integrity_violation", "snapshot_mismatch", "repository_changed"].includes(error.message));
}

export async function resolveContextComposerEngine(input: {
  mode: ContextComposerEngineMode;
  executionInput: ContextComposerV2ExecutionInput;
  legacySelection: NonNullable<ContextComposerEngineResolution["selection"]>;
  executor?: ContextComposerV2Executor;
}): Promise<ContextComposerEngineResolution> {
  if (input.mode === "legacy") return createLegacyContextComposerEngineResolution({ mode: input.mode, legacySelection: input.legacySelection });
  let canonical: ContextComposerCanonicalExecutionInput;
  try {
    canonical = prepareContextComposerCanonicalInput(input.executionInput);
    assertContextComposerCanonicalInput(canonical);
  } catch {
    return integrityBlock({ mode: input.mode, reason: "canonical_input_mismatch" });
  }
  let rawExecution: ContextComposerV2ExecutionResult;
  try {
    rawExecution = await (input.executor
      ? input.executor(canonical)
      : executePreparedContextComposerV2(canonical, input.executionInput));
  } catch (error) {
    if (isIntegrityFailure(error)) {
      const reason = error instanceof Error && error.message === "canonical_input_mismatch"
        ? "canonical_input_mismatch" as const
        : "v2_integrity_violation" as const;
      return integrityBlock({ mode: input.mode, reason });
    }
    return transientFallback({ mode: input.mode, legacySelection: input.legacySelection, reason: executionFailureReason(error) });
  }
  let execution: ContextComposerV2ExecutionResult;
  try {
    execution = assertExecutionBoundToCanonicalInput(rawExecution, canonical);
  } catch {
    return integrityBlock({ mode: input.mode, reason: "v2_integrity_violation" });
  }
  try {
    const summary = createOfflineCompatibilityComparison().compare({
    legacySelection: input.legacySelection,
    v2Projection: execution.projection,
    snapshot: canonical.snapshot,
    negativeConstraints: canonical.negativeConstraints,
    explicitTargets: canonical.explicitTargets,
  });
    const files = v2Files(execution);
    const unresolvedQuestions = execution.result.questions
    .filter((question) => question.status !== "answered")
    .map((question) => ({ category: question.category, status: question.status }));
    const intrinsicSafetyBlocked = execution.result.stop.reason === "safety_blocked" ||
    execution.result.stop.reason === "contradictory_evidence" ||
    execution.result.stop.reason === "repository_changed" ||
    summary.safety.v2NegativeConstraintViolations.length > 0 ||
    summary.safety.v2RepositorySafetyViolations.length > 0 ||
    execution.result.knowledgeGaps.some((gap) => gap.status === "open" && gap.category === "safety_restricted" && gap.blocks.some((block) => block === "projection" || block === "authorization")) ||
    execution.result.contradictions.some((item) => item.status === "open" && item.severity === "blocking");
    const editable = files.filter((file) => (file.role === "target" || file.role === "test") && !file.reviewRequired && !file.reasonCodes.some((code) => BLOCKING_CODES.has(code)));
    const ready = execution.result.safeToProject && execution.result.stop.safeToProject &&
    execution.result.stop.reason === "sufficient_evidence" && execution.projection.source.safeToProject && editable.length > 0;
    const comparison = comparisonView(summary);
    const legacyUnsafe = summary.safety.legacyNegativeConstraintViolations.length > 0 ||
      summary.safety.legacyRepositorySafetyViolations.length > 0;
    const safetyBlocked = intrinsicSafetyBlocked || (!ready && legacyUnsafe);

    if (input.mode === "shadow_compare") {
    const status = safetyBlocked || legacyUnsafe ? "safety_blocked" : ready ? "v2_ready" : "v2_review_required";
    return Object.freeze({
      view: makeView({ requestedMode: input.mode, effectiveSource: "legacy", status, stopReason: execution.result.stop.reason,
        fallbackReason: null, files, unresolvedQuestions, limitations: [], comparison }),
      selection: input.legacySelection,
      useLegacySelection: true,
    });
  }
    if (safetyBlocked) {
    const limitation: ContextComposerEngineReasonCode = execution.result.stop.reason === "repository_changed"
      ? "repository_changed"
      : execution.result.stop.reason === "contradictory_evidence" ? "blocking_contradiction" : "blocking_gap";
    return Object.freeze({
      view: makeView({ requestedMode: input.mode, effectiveSource: "v2", status: "safety_blocked", stopReason: execution.result.stop.reason,
        fallbackReason: null, files: [], unresolvedQuestions, limitations: [limitation], comparison }),
      selection: null,
      useLegacySelection: false,
    });
  }
    if (ready) {
    return Object.freeze({
      view: makeView({ requestedMode: input.mode, effectiveSource: "v2", status: "v2_ready", stopReason: execution.result.stop.reason,
        fallbackReason: null, files, unresolvedQuestions, limitations: [], comparison }),
      selection: execution.legacyProjection.selection,
      useLegacySelection: false,
    });
  }
    if (files.length > 0) {
    return Object.freeze({
      view: makeView({ requestedMode: input.mode, effectiveSource: "v2", status: "v2_review_required", stopReason: execution.result.stop.reason,
        fallbackReason: null, files, unresolvedQuestions, limitations: ["v2_not_grounded"], comparison }),
      selection: execution.legacyProjection.selection,
      useLegacySelection: false,
    });
  }
    return Object.freeze({
      view: makeView({ requestedMode: input.mode, effectiveSource: "v2", status: "v2_review_required", stopReason: execution.result.stop.reason,
        fallbackReason: null, files: [], unresolvedQuestions,
        limitations: ["v2_not_grounded"], comparison }),
      selection: null,
      useLegacySelection: false,
    });
  } catch {
    return integrityBlock({ mode: input.mode, reason: "v2_integrity_violation" });
  }
}
