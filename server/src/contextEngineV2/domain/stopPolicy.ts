import type {
  ContradictionRecord,
  EvidenceRecord,
  FactRecord,
  InvestigationBudgetLimit,
  InvestigationBudgetState,
  InvestigationCoverage,
  InvestigationPurpose,
  InvestigationStop,
  KnowledgeGap,
} from "../contracts/index.js";
import type { FindingEligibilityEvaluation } from "./findingEligibility.js";
import { assertContradictionEvaluationConsistency } from "./contradictionRegistry.js";
import {
  assertEvidenceEvaluationConsistency,
  assertFactEvaluationConsistency,
  hasActiveEvidenceBasis,
} from "./evaluationInvariants.js";
import { assertKnowledgeGapEvaluationConsistency } from "./knowledgeGapRegistry.js";
import {
  InvestigationDomainError,
  assertClosedRecord,
  assertPortableIdentifier,
  assertSafeInteger,
  assertSafeText,
  assertSortedUniqueStrings,
  cloneDomainValue,
  indexDomainRecordsById,
  sortedUnique,
} from "./investigationDomainSupport.js";
import { snapshotInvestigationBudget } from "./investigationBudget.js";
import {
  assertValidatedDomainContext,
  type ValidatedDomainContext,
} from "./validatedDomainContext.js";

export type StopDecision =
  | { action: "continue"; reason: string }
  | { action: "stop"; stop: InvestigationStop };

export interface StopPolicyState {
  snapshotId: EvidenceRecord["snapshotId"];
  purpose: InvestigationPurpose;
  coverage: InvestigationCoverage;
  budgetState: InvestigationBudgetState;
  evidence: readonly EvidenceRecord[];
  facts: readonly FactRecord[];
  findingEvaluations: readonly FindingEligibilityEvaluation[];
  contradictions: readonly ContradictionRecord[];
  knowledgeGaps: readonly KnowledgeGap[];
  criticalQuestionsNonApplicable: number;
  allRequiredEvidenceSatisfied: boolean;
  internalInvariantFailure: boolean;
  repositoryChanged: boolean;
  safetyBlocked: boolean;
  deterministicResolutionAvailable: boolean;
  snapshotTruncationBlocksCritical: boolean;
  searchExhausted: boolean;
  openDeterministicOperationCount: number;
  repositoryResolvableGapIds: readonly KnowledgeGap["id"][];
}

export interface StopPolicy {
  evaluate(
    state: Readonly<StopPolicyState>,
    validatedContext?: ValidatedDomainContext,
  ): StopDecision;
}

const COVERAGE_FIELDS = [
  "criticalQuestionsTotal",
  "criticalQuestionsAnswered",
  "questionsTotal",
  "questionsAnswered",
  "hypothesesTotal",
  "hypothesesSupported",
  "hypothesesRejected",
  "hypothesesUnresolved",
  "filesConsidered",
  "filesRead",
  "filesParsed",
  "relationshipHops",
  "evidenceIndependentGroups",
  "snapshotTruncated",
  "blockedScopes",
] as const;
const STOP_STATE_FIELDS = [
  "snapshotId", "purpose", "coverage", "budgetState", "evidence", "facts",
  "findingEvaluations", "contradictions", "knowledgeGaps",
  "criticalQuestionsNonApplicable", "allRequiredEvidenceSatisfied",
  "internalInvariantFailure", "repositoryChanged", "safetyBlocked",
  "deterministicResolutionAvailable", "snapshotTruncationBlocksCritical",
  "searchExhausted", "openDeterministicOperationCount",
  "repositoryResolvableGapIds",
] as const;
const FINDING_EVALUATION_FIELDS = [
  "finding", "eligible", "safeToProject", "limitations",
] as const;
const FINDING_FIELDS = [
  "id", "snapshotId", "type", "statement", "entityIds", "evidenceIds",
  "status", "limitations", "authorizationHint",
] as const;
const FINDING_TYPES = new Set([
  "implementation_target",
  "supporting_context",
  "behavior_summary",
  "constraint",
  "risk",
  "test_target",
  "clarification_requirement",
]);
const FINDING_STATUSES = new Set(["confirmed", "probable", "unresolved"]);
const FINDING_AUTHORIZATION = new Set([
  "eligible",
  "review_required",
  "not_eligible",
]);
const EVIDENCE_ROLES = new Set([
  "supports",
  "contradicts",
  "context_only",
]);
const EVIDENCE_STRENGTHS = new Set([
  "conclusive",
  "substantial",
  "corroborating",
  "lead",
]);

function stop(
  state: StopPolicyState,
  reason: InvestigationStop["reason"],
  message: string,
  safeToProject: boolean,
  blockingGaps: readonly KnowledgeGap[],
  contradictions: readonly ContradictionRecord[],
): StopDecision {
  return {
    action: "stop",
    stop: {
      reason,
      message,
      blockingGapIds: sortedUnique(blockingGaps.map((gap) => gap.id)),
      contradictionIds: sortedUnique(
        contradictions.map((contradiction) => contradiction.id),
      ),
      budgetState: snapshotInvestigationBudget(state.budgetState),
      safeToProject,
    },
  };
}

function budgetStopReason(
  exhausted: readonly InvestigationBudgetLimit[],
): InvestigationStop["reason"] | null {
  if (exhausted.includes("operations")) return "operation_budget_exhausted";
  if (exhausted.includes("file_reads")) return "file_budget_exhausted";
  if (exhausted.includes("file_bytes")) return "byte_budget_exhausted";
  if (exhausted.includes("wall_time")) return "time_budget_exhausted";
  if (exhausted.includes("planner_rounds")) {
    return "planner_round_budget_exhausted";
  }
  if (
    exhausted.includes("parsed_files") ||
    exhausted.includes("relationship_hops")
  ) {
    return "operation_budget_exhausted";
  }
  return null;
}

function budgetMessage(reason: InvestigationStop["reason"]): string {
  switch (reason) {
    case "file_budget_exhausted":
      return "The investigation reached its file-read budget.";
    case "byte_budget_exhausted":
      return "The investigation reached its byte-read budget.";
    case "time_budget_exhausted":
      return "The investigation reached its caller-measured time budget.";
    case "planner_round_budget_exhausted":
      return "The investigation reached its planner-round budget.";
    default:
      return "The investigation reached an operation capacity budget.";
  }
}

function validateState(
  state: StopPolicyState,
  validatedContext?: ValidatedDomainContext,
): StopPolicyState {
  if (validatedContext) assertValidatedDomainContext(validatedContext);
  validatedContext?.assertCanonical({
    facts: state.facts,
    evidence: state.evidence,
  });
  if (validatedContext && state.snapshotId !== validatedContext.snapshotId) {
    throw new InvestigationDomainError(
      "snapshot_mismatch",
      "Stop-policy context belongs to another snapshot.",
    );
  }
  const safe = cloneDomainValue(state);
  assertClosedRecord(safe, STOP_STATE_FIELDS, STOP_STATE_FIELDS, "Stop-policy state");
  assertPortableIdentifier(safe.snapshotId, "Stop-policy snapshot id");
  for (const [value, label] of [
    [safe.evidence, "Stop-policy evidence"],
    [safe.facts, "Stop-policy facts"],
    [safe.findingEvaluations, "Stop-policy finding evaluations"],
    [safe.contradictions, "Stop-policy contradictions"],
    [safe.knowledgeGaps, "Stop-policy knowledge gaps"],
    [safe.repositoryResolvableGapIds, "Stop-policy resolvable gaps"],
  ] as const) {
    if (!Array.isArray(value)) {
      throw new InvestigationDomainError("invalid_record", `${label} must be a dense array.`);
    }
  }
  const evidenceById = validatedContext?.evidenceById ??
    indexDomainRecordsById(safe.evidence, "Stop-policy evidence");
  const factsById = validatedContext?.factsById ??
    indexDomainRecordsById(safe.facts, "Stop-policy fact");
  safe.evidence = [...evidenceById.values()];
  safe.facts = [...factsById.values()];
  safe.contradictions = [
    ...indexDomainRecordsById(
      safe.contradictions,
      "Stop-policy contradiction",
    ).values(),
  ];
  safe.knowledgeGaps = [
    ...indexDomainRecordsById(
      safe.knowledgeGaps,
      "Stop-policy knowledge gap",
    ).values(),
  ];
  const findingEvaluationContexts = safe.findingEvaluations.map(
    (evaluation) => ({ id: evaluation.finding.id, evaluation }),
  );
  safe.findingEvaluations = [
    ...indexDomainRecordsById(
      findingEvaluationContexts,
      "Stop-policy finding evaluation",
    ).values(),
  ].map((context) => context.evaluation);
  if (!validatedContext) {
    safe.facts.forEach((record) =>
      assertFactEvaluationConsistency({
        fact: record,
        snapshotId: safe.snapshotId,
      }),
    );
    safe.evidence.forEach((record) =>
      assertEvidenceEvaluationConsistency({
        evidence: record,
        facts: safe.facts,
        snapshotId: safe.snapshotId,
      }),
    );
  }
  safe.contradictions.forEach((record) =>
    assertContradictionEvaluationConsistency({
      record,
      snapshotId: safe.snapshotId,
    }),
  );
  safe.knowledgeGaps.forEach((gap) =>
    assertKnowledgeGapEvaluationConsistency({
      gap,
      snapshotId: safe.snapshotId,
    }),
  );
  if (
    !new Set([
      "implementation_context",
      "review_context",
      "clarification",
      "shadow_comparison",
    ]).has(safe.purpose)
  ) {
    throw new InvestigationDomainError(
      "invalid_record",
      "Stop-policy purpose is not supported.",
    );
  }
  assertSafeInteger(
    safe.criticalQuestionsNonApplicable,
    "Non-applicable critical question count",
  );
  assertSafeInteger(
    safe.openDeterministicOperationCount,
    "Open deterministic operation count",
  );
  const booleans = [
    safe.allRequiredEvidenceSatisfied,
    safe.internalInvariantFailure,
    safe.repositoryChanged,
    safe.safetyBlocked,
    safe.deterministicResolutionAvailable,
    safe.snapshotTruncationBlocksCritical,
    safe.searchExhausted,
  ];
  if (booleans.some((value) => typeof value !== "boolean")) {
    throw new InvestigationDomainError(
      "invalid_record",
      "Stop-policy flags must be boolean.",
    );
  }
  assertClosedRecord(
    safe.coverage,
    COVERAGE_FIELDS,
    COVERAGE_FIELDS,
    "Investigation coverage",
  );
  for (const [field, value] of Object.entries(safe.coverage)) {
    if (
      field !== "snapshotTruncated" &&
      field !== "blockedScopes" &&
      (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    ) {
      throw new InvestigationDomainError(
        "invalid_record",
        "Stop-policy coverage counters must be non-negative safe integers.",
      );
    }
  }
  if (
    typeof safe.coverage.snapshotTruncated !== "boolean" ||
    !Array.isArray(safe.coverage.blockedScopes)
  ) {
    throw new InvestigationDomainError(
      "invalid_record",
      "Stop-policy coverage flags are malformed.",
    );
  }
  assertSortedUniqueStrings(
    safe.coverage.blockedScopes,
    "Coverage blocked scopes",
  );
  safe.coverage.blockedScopes.forEach((scope) =>
    assertSafeText(scope, "Coverage blocked scope"),
  );
  if (
    safe.coverage.questionsAnswered > safe.coverage.questionsTotal ||
    safe.coverage.criticalQuestionsAnswered >
      safe.coverage.criticalQuestionsTotal ||
    safe.coverage.criticalQuestionsTotal > safe.coverage.questionsTotal ||
    safe.criticalQuestionsNonApplicable >
      safe.coverage.criticalQuestionsTotal -
        safe.coverage.criticalQuestionsAnswered
  ) {
    throw new InvestigationDomainError(
      "invalid_record",
      "Stop-policy question coverage counters are inconsistent.",
    );
  }
  const classifiedHypotheses =
    safe.coverage.hypothesesSupported +
    safe.coverage.hypothesesRejected +
    safe.coverage.hypothesesUnresolved;
  if (
    !Number.isSafeInteger(classifiedHypotheses) ||
    classifiedHypotheses > safe.coverage.hypothesesTotal
  ) {
    throw new InvestigationDomainError(
      "invalid_record",
      "Stop-policy hypothesis coverage counters are inconsistent.",
    );
  }
  if (
    safe.coverage.filesParsed > safe.coverage.filesRead ||
    safe.coverage.filesRead > safe.coverage.filesConsidered
  ) {
    throw new InvestigationDomainError(
      "invalid_record",
      "Stop-policy file coverage counters are inconsistent.",
    );
  }
  if (
    safe.snapshotTruncationBlocksCritical &&
    !safe.coverage.snapshotTruncated
  ) {
    throw new InvestigationDomainError(
      "invalid_record",
      "Critical truncation blocking requires a truncated snapshot.",
    );
  }
  for (const evidence of safe.evidence) {
    if (
      evidence.snapshotId !== safe.snapshotId ||
      evidence.freshness.snapshotId !== safe.snapshotId
    ) {
      throw new InvestigationDomainError(
        "snapshot_mismatch",
        "Stop policy cannot combine evidence from different snapshots.",
      );
    }
    if (
      !EVIDENCE_ROLES.has(evidence.role) ||
      !EVIDENCE_STRENGTHS.has(evidence.strength) ||
      typeof evidence.freshness.current !== "boolean"
    ) {
      throw new InvestigationDomainError(
        "invalid_record",
        "Stop-policy evidence semantics are malformed.",
      );
    }
    const currentReason =
      evidence.freshness.reason === "snapshot_match" ||
      evidence.freshness.reason === "fingerprint_match";
    const nonCurrentReason =
      evidence.freshness.reason === "stale" ||
      evidence.freshness.reason === "unknown";
    if (
      (evidence.freshness.current && !currentReason) ||
      (!evidence.freshness.current && currentReason) ||
      (evidence.freshness.reason !== undefined &&
        !currentReason &&
        !nonCurrentReason)
    ) {
      throw new InvestigationDomainError(
        "invalid_record",
        "Stop-policy evidence freshness flags are inconsistent.",
      );
    }
  }
  if (
    safe.contradictions.some((record) => record.snapshotId !== safe.snapshotId) ||
    safe.knowledgeGaps.some((gap) => gap.snapshotId !== safe.snapshotId) ||
    safe.findingEvaluations.some(
      (evaluation) => evaluation.finding.snapshotId !== safe.snapshotId,
    )
  ) {
    throw new InvestigationDomainError(
      "snapshot_mismatch",
      "Stop policy cannot combine domain records from different snapshots.",
    );
  }
  const contradictionStatuses = new Set(["open", "resolved", "accepted_ambiguity"]);
  const contradictionSeverities = new Set(["blocking", "material", "informational"]);
  const gapStatuses = new Set(["open", "resolved", "accepted_unresolved"]);
  if (
    safe.contradictions.some(
      (record) =>
        !contradictionStatuses.has(record.status) ||
        !contradictionSeverities.has(record.severity),
    ) ||
    safe.knowledgeGaps.some((gap) => !gapStatuses.has(gap.status))
  ) {
    throw new InvestigationDomainError(
      "invalid_record",
      "Stop-policy domain record status is not supported.",
    );
  }
  assertSortedUniqueStrings(
    safe.repositoryResolvableGapIds,
    "Repository-resolvable knowledge gap ids",
  );
  const gapsById = new Map(safe.knowledgeGaps.map((gap) => [gap.id, gap]));
  if (safe.repositoryResolvableGapIds.some((id) => !gapsById.has(id))) {
    throw new InvestigationDomainError(
      "unknown_reference",
      "Repository-resolvable knowledge gap id is unknown.",
    );
  }
  for (const evaluation of safe.findingEvaluations) {
    const finding = evaluation.finding;
    assertClosedRecord(
      evaluation,
      FINDING_EVALUATION_FIELDS,
      FINDING_EVALUATION_FIELDS,
      "Finding eligibility evaluation",
    );
    assertClosedRecord(finding, FINDING_FIELDS, FINDING_FIELDS, "Finding record");
    assertPortableIdentifier(finding.id, "Finding id");
    assertPortableIdentifier(finding.snapshotId, "Finding snapshot id");
    assertSafeText(finding.statement, "Finding statement");
    if (
      typeof evaluation.eligible !== "boolean" ||
      typeof evaluation.safeToProject !== "boolean"
    ) {
      throw new InvestigationDomainError("invalid_record", "Finding evaluation flags must be boolean.");
    }
    if (
      !FINDING_TYPES.has(finding.type) ||
      !FINDING_STATUSES.has(finding.status) ||
      !FINDING_AUTHORIZATION.has(finding.authorizationHint)
    ) {
      throw new InvestigationDomainError(
        "invalid_record",
        "Stop-policy finding semantics are malformed.",
      );
    }
    assertSortedUniqueStrings(finding.entityIds, "Finding entity ids");
    assertSortedUniqueStrings(finding.evidenceIds, "Finding evidence ids");
    assertSortedUniqueStrings(
      evaluation.limitations,
      "Finding evaluation limitations",
    );
    assertSortedUniqueStrings(
      evaluation.finding.limitations,
      "Finding limitations",
    );
    const eligibleHint = evaluation.finding.authorizationHint === "eligible";
    const reviewHint =
      evaluation.finding.authorizationHint === "review_required";
    const crossSnapshotLimitation = [
      ...evaluation.limitations,
      ...finding.limitations,
    ].some(
      (limitation) =>
        limitation === "cross_snapshot_evidence" ||
        limitation === "cross_snapshot_entity",
    );
    const referencedEvidence = finding.evidenceIds.map((id) => {
      const record = evidenceById.get(id);
      if (!record) {
        throw new InvestigationDomainError(
          "unknown_reference",
          "Finding references unknown stop-policy evidence.",
        );
      }
      if (
        record.snapshotId !== safe.snapshotId ||
        record.freshness.snapshotId !== safe.snapshotId
      ) {
        throw new InvestigationDomainError(
          "snapshot_mismatch",
          "Finding evidence belongs to another snapshot.",
        );
      }
      return record;
    });
    if (
      finding.type === "implementation_target" &&
      finding.status === "confirmed" &&
      (finding.entityIds.length === 0 || finding.evidenceIds.length === 0)
    ) {
      throw new InvestigationDomainError(
        "invalid_record",
        "Confirmed implementation target requires entity and evidence references.",
      );
    }
    if (eligibleHint && finding.type === "implementation_target") {
      if (
        finding.status !== "confirmed" ||
        finding.entityIds.length === 0 ||
        referencedEvidence.length === 0 ||
        referencedEvidence.some(
          (record) =>
            !record.freshness.current ||
            record.role !== "supports" ||
            !hasActiveEvidenceBasis(record, factsById),
        ) ||
        !referencedEvidence.some((record) => record.strength !== "lead") ||
        crossSnapshotLimitation
      ) {
        throw new InvestigationDomainError(
          "invalid_record",
          "Eligible implementation target lacks valid current supporting evidence.",
        );
      }
    }
    if (
      evaluation.eligible !== eligibleHint ||
      (evaluation.eligible && !evaluation.safeToProject) ||
      (evaluation.safeToProject && !eligibleHint && !reviewHint) ||
      (evaluation.finding.status === "confirmed" && reviewHint) ||
      (evaluation.finding.status === "probable" && eligibleHint) ||
      (reviewHint && evaluation.eligible) ||
      (crossSnapshotLimitation && evaluation.safeToProject) ||
      (evaluation.finding.status === "unresolved" &&
        (evaluation.eligible ||
          evaluation.safeToProject ||
          evaluation.finding.authorizationHint !== "not_eligible")) ||
      evaluation.limitations.length !== evaluation.finding.limitations.length ||
      evaluation.limitations.some(
        (limitation, index) =>
          limitation !== evaluation.finding.limitations[index],
      )
    ) {
      throw new InvestigationDomainError(
        "invalid_record",
        "Finding evaluation eligibility state is inconsistent.",
      );
    }
  }
  snapshotInvestigationBudget(safe.budgetState);
  return safe;
}

export function createStopPolicy(): StopPolicy {
  return {
    evaluate(rawState, validatedContext) {
      const state = validateState(rawState as StopPolicyState, validatedContext);
      const blockingGaps = state.knowledgeGaps.filter(
        (gap) => gap.status === "open" && gap.blocks.length > 0,
      );
      const blockingContradictions = state.contradictions.filter(
        (record) => record.status === "open" && record.severity === "blocking",
      );
      if (state.internalInvariantFailure) {
        return stop(
          state,
          "internal_error",
          "The investigation stopped because an internal invariant failed.",
          false,
          blockingGaps,
          blockingContradictions,
        );
      }
      if (state.repositoryChanged) {
        return stop(
          state,
          "repository_changed",
          "The repository no longer matches the active snapshot.",
          false,
          blockingGaps,
          blockingContradictions,
        );
      }
      const safetyGaps = blockingGaps.filter(
        (gap) => gap.category === "safety_restricted",
      );
      if (state.safetyBlocked || safetyGaps.length > 0) {
        return stop(
          state,
          "safety_blocked",
          "The investigation is blocked by repository access safety policy.",
          false,
          safetyGaps,
          blockingContradictions,
        );
      }

      const criticalQuestionsComplete =
        state.coverage.criticalQuestionsAnswered +
          state.criticalQuestionsNonApplicable >=
        state.coverage.criticalQuestionsTotal;
      const implementationTargetReady = state.findingEvaluations.some(
        (evaluation) =>
          evaluation.eligible &&
          evaluation.finding.status === "confirmed" &&
          evaluation.finding.type === "implementation_target",
      );
      const purposeHasRequiredFinding =
        state.purpose !== "implementation_context" || implementationTargetReady;
      const confirmedEvidenceCurrent = state.findingEvaluations
        .filter((evaluation) => evaluation.eligible)
        .every((evaluation) =>
          evaluation.finding.evidenceIds.every((id) => {
            const evidence = state.evidence.find((record) => record.id === id);
            return evidence?.freshness.current === true;
          }),
        );
      const sufficient =
        criticalQuestionsComplete &&
        purposeHasRequiredFinding &&
        state.allRequiredEvidenceSatisfied &&
        confirmedEvidenceCurrent &&
        blockingGaps.length === 0 &&
        blockingContradictions.length === 0 &&
        !state.snapshotTruncationBlocksCritical;
      if (sufficient) {
        return stop(
          state,
          "sufficient_evidence",
          "All critical questions and required evidence policies are satisfied.",
          true,
          [],
          [],
        );
      }

      const resolvableGaps = new Set(state.repositoryResolvableGapIds);
      const clarificationGaps = blockingGaps.filter(
        (gap) =>
          gap.category === "ambiguous_user_intent" &&
          !resolvableGaps.has(gap.id) &&
          (gap.blocks.includes("finding") ||
            gap.blocks.includes("projection") ||
            gap.blocks.includes("authorization")),
      );
      if (clarificationGaps.length > 0) {
        return stop(
          state,
          "clarification_required",
          "A material user-intent question requires clarification.",
          false,
          clarificationGaps,
          blockingContradictions,
        );
      }
      if (
        blockingContradictions.length > 0 &&
        !state.deterministicResolutionAvailable
      ) {
        return stop(
          state,
          "contradictory_evidence",
          "Blocking evidence remains contradictory after deterministic resolution options were exhausted.",
          false,
          blockingGaps,
          blockingContradictions,
        );
      }
      const budgetReason = budgetStopReason(state.budgetState.exhausted);
      if (budgetReason) {
        return stop(
          state,
          budgetReason,
          budgetMessage(budgetReason),
          false,
          blockingGaps,
          blockingContradictions,
        );
      }
      if (
        state.coverage.snapshotTruncated &&
        state.snapshotTruncationBlocksCritical
      ) {
        return stop(
          state,
          "repository_snapshot_truncated",
          "Snapshot truncation blocks a critical investigation question.",
          false,
          blockingGaps,
          blockingContradictions,
        );
      }
      const currentSupportingEvidence = state.evidence.some(
        (record) => record.role === "supports" && record.freshness.current,
      );
      const ownerLead = state.findingEvaluations.some(
        (evaluation) =>
          evaluation.finding.type === "implementation_target" &&
          (evaluation.finding.status === "confirmed" ||
            evaluation.finding.status === "probable"),
      );
      const ambiguousIntent = state.knowledgeGaps.some(
        (gap) =>
          gap.status === "open" && gap.category === "ambiguous_user_intent",
      );
      if (
        state.searchExhausted &&
        !currentSupportingEvidence &&
        !ownerLead &&
        state.openDeterministicOperationCount === 0 &&
        !ambiguousIntent &&
        blockingContradictions.length === 0
      ) {
        return stop(
          state,
          "no_grounded_lead",
          "Deterministic repository leads were exhausted without current supporting evidence.",
          false,
          blockingGaps,
          [],
        );
      }
      return {
        action: "continue",
        reason: "More deterministic evidence can still be gathered within policy.",
      };
    },
  };
}
