import type {
  ModelPlannerContainmentMetrics,
  ModelPlannerObservation,
  ModelPlannerUsefulnessComparison,
  ModelPlannerUsefulnessRunMetrics,
} from "../contracts/index.js";
import type { InvestigationRunnerResult } from "../application/index.js";

function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function record(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_model_planner_usefulness_comparison");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) ||
    Reflect.ownKeys(descriptors).some((key) => typeof key !== "string") ||
    Object.values(descriptors).some(
      (entry) => entry.get || entry.set || !("value" in entry) || !entry.enumerable,
    )
  ) throw new Error("invalid_model_planner_usefulness_comparison");
  const keys = Object.keys(descriptors).sort();
  const expected = [...fields].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error("invalid_model_planner_usefulness_comparison");
  }
  return Object.fromEntries(
    Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]),
  );
}

function nonNegativeInteger(value: unknown): void {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error("invalid_model_planner_usefulness_comparison");
  }
}

const RUN_FIELDS = [
  "operationCount", "factCount", "evidenceCount", "findingCount",
  "blockingGapsResolved", "finalStopReason", "sufficientEvidenceReached",
  "duplicateProposalCount", "rejectedProposalCount", "deterministicFallbackCount",
] as const;
const CONTAINMENT_FIELDS = [
  "acceptedProposals", "schemaRejected", "semanticRejected", "privacyRejected",
  "budgetRejected", "duplicateRejected", "timeoutOrProviderFallback",
  "unsafeActionExecutions",
] as const;
const STOP_REASONS = new Set([
  "sufficient_evidence", "clarification_required", "no_grounded_lead",
  "contradictory_evidence", "operation_budget_exhausted", "file_budget_exhausted",
  "byte_budget_exhausted", "time_budget_exhausted", "planner_round_budget_exhausted",
  "repository_snapshot_truncated", "repository_changed", "safety_blocked", "internal_error",
]);

function validateRun(value: unknown): ModelPlannerUsefulnessRunMetrics {
  const item = record(value, RUN_FIELDS);
  for (const field of RUN_FIELDS.filter((field) =>
    field !== "finalStopReason" && field !== "sufficientEvidenceReached"
  )) nonNegativeInteger(item[field]);
  if (
    typeof item.finalStopReason !== "string" ||
    !STOP_REASONS.has(item.finalStopReason) ||
    typeof item.sufficientEvidenceReached !== "boolean"
  ) {
    throw new Error("invalid_model_planner_usefulness_comparison");
  }
  return item as unknown as ModelPlannerUsefulnessRunMetrics;
}

function validateContainment(value: unknown): ModelPlannerContainmentMetrics {
  const item = record(value, CONTAINMENT_FIELDS);
  for (const field of CONTAINMENT_FIELDS) nonNegativeInteger(item[field]);
  return item as unknown as ModelPlannerContainmentMetrics;
}

export function validateModelPlannerUsefulnessComparison(
  value: unknown,
): ModelPlannerUsefulnessComparison {
  const item = record(value, [
    "schemaVersion", "caseId", "deterministic", "modelAssisted",
    "containment", "assessment", "safetyRegression",
  ]);
  if (
    item.schemaVersion !== 1 ||
    typeof item.caseId !== "string" ||
    !/^[a-z0-9][a-z0-9._:-]{0,120}$/iu.test(item.caseId) ||
    !["strict_improvement", "not_worse", "regression"].includes(item.assessment as string) ||
    typeof item.safetyRegression !== "boolean"
  ) throw new Error("invalid_model_planner_usefulness_comparison");
  return freeze({
    schemaVersion: 1,
    caseId: item.caseId,
    deterministic: validateRun(item.deterministic),
    modelAssisted: validateRun(item.modelAssisted),
    containment: validateContainment(item.containment),
    assessment: item.assessment,
    safetyRegression: item.safetyRegression,
  } as ModelPlannerUsefulnessComparison);
}

function count(
  observations: readonly ModelPlannerObservation[],
  reason: ModelPlannerObservation["fallbackReason"],
): number {
  return observations.filter((entry) => entry.fallbackReason === reason).length;
}

export function createModelPlannerUsefulnessRunMetrics(input: {
  result: InvestigationRunnerResult;
  observations?: readonly ModelPlannerObservation[];
  initialOpenBlockingGaps?: number;
}): ModelPlannerUsefulnessRunMetrics {
  const observations = input.observations ?? [];
  const openBlockingGaps = input.result.knowledgeGaps.filter(
    (gap) => gap.status === "open" && gap.blocks.length > 0,
  ).length;
  return freeze({
    operationCount: input.result.operationRecords.length,
    factCount: input.result.facts.length,
    evidenceCount: input.result.evidence.length,
    findingCount: input.result.findings.length,
    blockingGapsResolved: Math.max(
      0,
      (input.initialOpenBlockingGaps ?? 0) - openBlockingGaps,
    ),
    finalStopReason: input.result.stop.reason,
    sufficientEvidenceReached: input.result.stop.reason === "sufficient_evidence",
    duplicateProposalCount: count(observations, "duplicate_rejected"),
    rejectedProposalCount: observations.filter((entry) => !entry.accepted).length,
    deterministicFallbackCount: observations.filter(
      (entry) => !entry.accepted && entry.fallbackReason !== "disabled",
    ).length,
  });
}

export function createModelPlannerContainmentMetrics(input: {
  observations: readonly ModelPlannerObservation[];
  unsafeActionExecutions?: number;
}): ModelPlannerContainmentMetrics {
  const unsafeActionExecutions = input.unsafeActionExecutions ?? 0;
  if (!Number.isSafeInteger(unsafeActionExecutions) || unsafeActionExecutions < 0) {
    throw new Error("invalid_model_planner_containment_metrics");
  }
  return freeze({
    acceptedProposals: input.observations.filter((entry) => entry.accepted).length,
    schemaRejected: count(input.observations, "schema_rejected") +
      count(input.observations, "malformed_output") +
      count(input.observations, "unsupported_action"),
    semanticRejected: count(input.observations, "semantic_rejected"),
    privacyRejected: count(input.observations, "privacy_rejected"),
    budgetRejected: count(input.observations, "budget_rejected"),
    duplicateRejected: count(input.observations, "duplicate_rejected"),
    timeoutOrProviderFallback:
      count(input.observations, "timeout") +
      count(input.observations, "provider_error") +
      count(input.observations, "unavailable") +
      count(input.observations, "capacity_exhausted"),
    unsafeActionExecutions,
  });
}

function knowledgeNoWorse(
  baseline: ModelPlannerUsefulnessRunMetrics,
  assisted: ModelPlannerUsefulnessRunMetrics,
): boolean {
  return assisted.factCount >= baseline.factCount &&
    assisted.evidenceCount >= baseline.evidenceCount &&
    assisted.findingCount >= baseline.findingCount &&
    assisted.blockingGapsResolved >= baseline.blockingGapsResolved &&
    (!baseline.sufficientEvidenceReached || assisted.sufficientEvidenceReached);
}

export function compareModelPlannerUsefulness(input: {
  caseId: string;
  deterministic: ModelPlannerUsefulnessRunMetrics;
  modelAssisted: ModelPlannerUsefulnessRunMetrics;
  containment: ModelPlannerContainmentMetrics;
}): ModelPlannerUsefulnessComparison {
  if (!/^[a-z0-9][a-z0-9._:-]{0,120}$/iu.test(input.caseId)) {
    throw new Error("invalid_model_planner_usefulness_case");
  }
  const safetyRegression = input.containment.unsafeActionExecutions > 0;
  const reachesEvidenceBaselineMissed =
    !input.deterministic.sufficientEvidenceReached &&
    input.modelAssisted.sufficientEvidenceReached;
  const comparableKnowledge = knowledgeNoWorse(
    input.deterministic,
    input.modelAssisted,
  );
  const strictImprovement = !safetyRegression && (
    reachesEvidenceBaselineMissed ||
    (comparableKnowledge &&
      input.modelAssisted.operationCount < input.deterministic.operationCount &&
      input.modelAssisted.sufficientEvidenceReached ===
        input.deterministic.sufficientEvidenceReached)
  );
  const noWorse = strictImprovement || (!safetyRegression && comparableKnowledge);
  return validateModelPlannerUsefulnessComparison({
    schemaVersion: 1,
    caseId: input.caseId,
    deterministic: input.deterministic,
    modelAssisted: input.modelAssisted,
    containment: input.containment,
    assessment: strictImprovement
      ? "strict_improvement"
      : noWorse
        ? "not_worse"
        : "regression",
    safetyRegression,
  });
}
