import type {
  ClaimId,
  ClaimRecord,
  EvidenceId,
  EvidenceRecord,
  InvestigationHypothesis,
  KnowledgeGap,
  OperationId,
  SnapshotId,
} from "../contracts/index.js";
import {
  assertClaimLedgerConsistency,
  type ClaimEvaluation,
} from "./claimEvaluator.js";
import { evaluateEvidenceRequirement } from "./evidenceRequirementEvaluator.js";
import {
  InvestigationDomainError,
  assertCanonicalUtcTimestamp,
  assertClosedRecord,
  assertPortableIdentifier,
  assertSafeInteger,
  assertSafeText,
  assertSortedUniqueStrings,
  cloneDomainValue,
  indexDomainRecordsById,
  safeRecordId,
  sameDomainRecord,
  sortedUnique,
  stableCompare,
} from "./investigationDomainSupport.js";
import {
  type ValidatedDomainContext,
} from "./validatedDomainContext.js";
import { cloneValidatedHypothesisLedgerEnvelope } from "./validatedDomainEnvelope.js";

const HYPOTHESIS_FIELDS = [
  "id",
  "claimId",
  "priority",
  "status",
  "requiredEvidence",
  "supportingEvidenceIds",
  "contradictingEvidenceIds",
  "openQuestionIds",
  "revision",
  "history",
] as const;
const TRANSITION_FIELDS = [
  "from",
  "to",
  "reason",
  "evidenceIds",
  "operationId",
  "occurredAt",
] as const;
const STATUSES = new Set(["open", "supported", "rejected", "unresolved"]);
const PRIORITIES = new Set(["critical", "high", "normal", "low"]);
const EVIDENCE_STRENGTHS = new Set([
  "conclusive",
  "substantial",
  "corroborating",
  "lead",
]);
const ALLOWED_TRANSITIONS = new Set([
  "open:supported",
  "open:rejected",
  "open:unresolved",
  "supported:open",
  "supported:rejected",
  "unresolved:open",
  "rejected:open",
]);

export interface HypothesisTransitionInput {
  hypothesisId: InvestigationHypothesis["id"];
  reason: string;
  occurredAt: string;
  operationId?: OperationId;
}

export interface HypothesisClaimEvaluationInput extends HypothesisTransitionInput {
  evaluation: ClaimEvaluation;
  blockingContradictionIds?: readonly string[];
}

export interface HypothesisReopenInput extends HypothesisTransitionInput {
  evidenceIds: readonly EvidenceId[];
}

export interface HypothesisLedger {
  add(hypothesis: InvestigationHypothesis): InvestigationHypothesis;
  get(id: InvestigationHypothesis["id"]): InvestigationHypothesis | null;
  getClaim(id: ClaimId): ClaimRecord | null;
  applyClaimEvaluation(input: HypothesisClaimEvaluationInput): InvestigationHypothesis;
  markUnresolved(input: HypothesisTransitionInput & { evidenceIds?: readonly EvidenceId[] }): InvestigationHypothesis;
  reopen(input: HypothesisReopenInput): InvestigationHypothesis;
  listOpen(): InvestigationHypothesis[];
  listBlocking(): InvestigationHypothesis[];
  snapshot(): InvestigationHypothesis[];
}

function assertHypothesisEvidenceCompatibility(
  record: EvidenceRecord,
  claimId: ClaimId,
  snapshotId: SnapshotId,
): void {
  if (
    record.snapshotId !== snapshotId ||
    record.freshness.snapshotId !== snapshotId
  ) {
    throw new InvestigationDomainError(
      "snapshot_mismatch",
      "Hypothesis evidence belongs to another snapshot.",
    );
  }
  if (record.claimId !== undefined && record.claimId !== claimId) {
    throw new InvestigationDomainError(
      "unknown_reference",
      "Hypothesis evidence belongs to another claim.",
    );
  }
  if (
    record.role !== "supports" &&
    record.role !== "contradicts" &&
    record.role !== "context_only"
  ) {
    throw new InvestigationDomainError(
      "invalid_record",
      "Hypothesis evidence role is not supported.",
    );
  }
  if (!EVIDENCE_STRENGTHS.has(record.strength)) {
    throw new InvestigationDomainError(
      "invalid_record",
      "Hypothesis evidence strength is not supported.",
    );
  }
  if (typeof record.freshness.current !== "boolean") {
    throw new InvestigationDomainError(
      "invalid_record",
      "Hypothesis evidence freshness is malformed.",
    );
  }
  const currentReason =
    record.freshness.reason === "snapshot_match" ||
    record.freshness.reason === "fingerprint_match";
  const staleReason =
    record.freshness.reason === "stale" ||
    record.freshness.reason === "unknown";
  if (
    (record.freshness.current && !currentReason) ||
    (!record.freshness.current && currentReason) ||
    (record.freshness.reason !== undefined && !currentReason && !staleReason)
  ) {
    throw new InvestigationDomainError(
      "invalid_record",
      "Hypothesis evidence freshness flags are inconsistent.",
    );
  }
}

function validateTransition(
  transition: InvestigationHypothesis["history"][number],
  knownEvidence: ReadonlyMap<EvidenceId, EvidenceRecord>,
  claimId: ClaimId,
  snapshotId: SnapshotId,
): void {
  assertClosedRecord(
    transition,
    TRANSITION_FIELDS,
    ["from", "to", "reason", "evidenceIds", "occurredAt"],
    "Hypothesis transition",
  );
  if (!STATUSES.has(transition.from) || !STATUSES.has(transition.to)) {
    throw new InvestigationDomainError(
      "invalid_record",
      "Hypothesis transition status is not supported.",
    );
  }
  if (!ALLOWED_TRANSITIONS.has(`${transition.from}:${transition.to}`)) {
    throw new InvestigationDomainError(
      "invalid_transition",
      "Hypothesis transition is not allowed.",
    );
  }
  assertSafeText(transition.reason, "Hypothesis transition reason");
  assertCanonicalUtcTimestamp(
    transition.occurredAt,
    "Hypothesis transition occurredAt",
  );
  assertSortedUniqueStrings(
    transition.evidenceIds,
    "Hypothesis transition evidence ids",
  );
  const transitionEvidence: EvidenceRecord[] = [];
  for (const evidenceId of transition.evidenceIds) {
    const record = knownEvidence.get(evidenceId);
    if (!record) {
      throw new InvestigationDomainError(
        "unknown_reference",
        "Hypothesis transition references unknown evidence.",
      );
    }
    assertHypothesisEvidenceCompatibility(record, claimId, snapshotId);
    transitionEvidence.push(record);
  }
  if (
    (transition.to === "supported" &&
      !transitionEvidence.some((record) => record.role === "supports")) ||
    (transition.to === "rejected" &&
      !transitionEvidence.some((record) => record.role === "contradicts"))
  ) {
    throw new InvestigationDomainError(
      "invalid_record",
      "Hypothesis transition lacks role-compatible evidence.",
    );
  }
  if (transition.operationId !== undefined) {
    assertPortableIdentifier(
      transition.operationId,
      "Hypothesis transition operation id",
    );
  }
}

function validateHypothesis(
  hypothesis: InvestigationHypothesis,
  claims: ReadonlyMap<ClaimId, ClaimRecord>,
  evidence: ReadonlyMap<EvidenceId, EvidenceRecord>,
  gaps: ReadonlyMap<KnowledgeGap["id"], KnowledgeGap>,
  snapshotId: SnapshotId,
): void {
  assertClosedRecord(
    hypothesis,
    HYPOTHESIS_FIELDS,
    HYPOTHESIS_FIELDS,
    "Investigation hypothesis",
  );
  assertPortableIdentifier(hypothesis.id, "Hypothesis id");
  assertPortableIdentifier(hypothesis.claimId, "Hypothesis claim id");
  const claim = claims.get(hypothesis.claimId);
  if (!claim) {
    throw new InvestigationDomainError(
      "unknown_reference",
      "Hypothesis references an unknown claim.",
      safeRecordId(hypothesis.id),
    );
  }
  if (claim.snapshotId !== snapshotId) {
    throw new InvestigationDomainError(
      "snapshot_mismatch",
      "Hypothesis claim belongs to another snapshot.",
      safeRecordId(hypothesis.id),
    );
  }
  if (!STATUSES.has(hypothesis.status) || !PRIORITIES.has(hypothesis.priority)) {
    throw new InvestigationDomainError(
      "invalid_record",
      "Hypothesis status or priority is not supported.",
    );
  }
  if (!Array.isArray(hypothesis.requiredEvidence)) {
    throw new InvestigationDomainError(
      "invalid_record",
      "Hypothesis evidence requirements must be an array.",
    );
  }
  const requirementIds = hypothesis.requiredEvidence.map((requirement) => {
    evaluateEvidenceRequirement({
      requirement,
      evidence: [],
      facts: [],
      snapshotId,
    });
    return requirement.id;
  });
  if (
    new Set(requirementIds).size !== requirementIds.length ||
    requirementIds.some(
      (id, index) => id !== [...requirementIds].sort(stableCompare)[index],
    )
  ) {
    throw new InvestigationDomainError(
      "invalid_record",
      "Hypothesis evidence requirement ids must be unique and sorted.",
    );
  }
  for (const [field, ids] of [
    ["supporting", hypothesis.supportingEvidenceIds],
    ["contradicting", hypothesis.contradictingEvidenceIds],
  ] as const) {
    assertSortedUniqueStrings(ids, `Hypothesis ${field} evidence ids`);
    for (const id of ids) {
      const record = evidence.get(id);
      if (!record) {
        throw new InvestigationDomainError(
          "unknown_reference",
          "Hypothesis references unknown evidence.",
        );
      }
      if (
        record.snapshotId !== snapshotId ||
        (record.claimId !== undefined && record.claimId !== claim.id)
      ) {
        throw new InvestigationDomainError(
          "snapshot_mismatch",
          "Hypothesis evidence belongs to another claim or snapshot.",
        );
      }
      assertHypothesisEvidenceCompatibility(record, claim.id, snapshotId);
      if (
        (field === "supporting" && record.role !== "supports") ||
        (field === "contradicting" && record.role !== "contradicts")
      ) {
        throw new InvestigationDomainError(
          "invalid_record",
          "Hypothesis evidence role is incompatible with its basis.",
        );
      }
    }
  }
  assertSortedUniqueStrings(
    hypothesis.openQuestionIds,
    "Hypothesis open knowledge gap ids",
  );
  for (const gapId of hypothesis.openQuestionIds) {
    const gap = gaps.get(gapId);
    if (!gap) {
      throw new InvestigationDomainError(
        "unknown_reference",
        "Hypothesis references an unknown knowledge gap.",
      );
    }
    if (gap.snapshotId !== snapshotId) {
      throw new InvestigationDomainError(
        "snapshot_mismatch",
        "Hypothesis knowledge gap belongs to another snapshot.",
      );
    }
  }
  assertSafeInteger(hypothesis.revision, "Hypothesis revision");
  if (!Array.isArray(hypothesis.history) || hypothesis.revision !== hypothesis.history.length) {
    throw new InvestigationDomainError(
      "invalid_record",
      "Hypothesis revision must equal its append-only transition count.",
    );
  }
  hypothesis.history.forEach((transition) =>
    validateTransition(transition, evidence, claim.id, snapshotId),
  );
  for (let index = 0; index < hypothesis.history.length; index += 1) {
    const transition = hypothesis.history[index]!;
    if (
      (index > 0 && hypothesis.history[index - 1]!.to !== transition.from) ||
      (index === hypothesis.history.length - 1 && transition.to !== hypothesis.status)
    ) {
      throw new InvestigationDomainError(
        "invalid_record",
        "Hypothesis transition history is not contiguous.",
      );
    }
  }
  if (hypothesis.status === "supported" && claim.status !== "supported") {
    throw new InvestigationDomainError(
      "invalid_record",
      "Supported hypothesis requires a supported claim.",
    );
  }
  if (
    hypothesis.status === "rejected" &&
    hypothesis.contradictingEvidenceIds.length === 0
  ) {
    throw new InvestigationDomainError(
      "invalid_record",
      "Rejected hypothesis requires contradicting evidence.",
    );
  }
}

function validateTransitionInput(input: HypothesisTransitionInput): void {
  assertSafeText(input.reason, "Hypothesis transition reason");
  assertCanonicalUtcTimestamp(
    input.occurredAt,
    "Hypothesis transition occurredAt",
  );
  if (input.operationId !== undefined) {
    assertPortableIdentifier(
      input.operationId,
      "Hypothesis transition operation id",
    );
  }
}

function validateEvaluatedClaim(
  evaluation: ClaimEvaluation,
  hypothesis: InvestigationHypothesis,
  evidence: ReadonlyMap<EvidenceId, EvidenceRecord>,
  snapshotId: SnapshotId,
  validatedContext?: ValidatedDomainContext,
): ClaimRecord {
  const claim = cloneDomainValue(evaluation.claim);
  assertClaimLedgerConsistency({
    claim,
    evidence: validatedContext?.evidence ?? [...evidence.values()],
    snapshotId,
  }, validatedContext);
  if (claim.id !== hypothesis.claimId || claim.snapshotId !== snapshotId) {
    throw new InvestigationDomainError(
      "snapshot_mismatch",
      "Evaluated claim does not belong to the hypothesis snapshot.",
    );
  }
  assertPortableIdentifier(claim.id, "Evaluated claim id");
  assertSortedUniqueStrings(
    claim.supportingEvidenceIds,
    "Evaluated claim supporting evidence ids",
  );
  assertSortedUniqueStrings(
    claim.contradictingEvidenceIds,
    "Evaluated claim contradicting evidence ids",
  );
  for (const [ids, role] of [
    [claim.supportingEvidenceIds, "supports"],
    [claim.contradictingEvidenceIds, "contradicts"],
  ] as const) {
    for (const id of ids) {
      const record = evidence.get(id);
      if (!record) {
        throw new InvestigationDomainError(
          "unknown_reference",
          "Evaluated claim references unknown evidence.",
        );
      }
      if (
        record.snapshotId !== snapshotId ||
        (record.claimId !== undefined && record.claimId !== claim.id) ||
        record.role !== role
      ) {
        throw new InvestigationDomainError(
          "snapshot_mismatch",
          "Evaluated claim evidence is not claim-compatible.",
        );
      }
    }
  }
  const dispositions = new Set(["supported", "rejected", "open", "unresolved"]);
  if (!dispositions.has(evaluation.hypothesisDisposition)) {
    throw new InvestigationDomainError(
      "invalid_record",
      "Claim evaluation disposition is not supported.",
    );
  }
  const expectedDisposition = new Map<ClaimRecord["status"], ClaimEvaluation["hypothesisDisposition"]>([
    ["supported", "supported"],
    ["rejected", "rejected"],
    ["contradicted", "open"],
    ["unresolved", "unresolved"],
    ["proposed", "open"],
  ]).get(claim.status);
  if (expectedDisposition !== evaluation.hypothesisDisposition) {
    throw new InvestigationDomainError(
      "invalid_record",
      "Claim status and hypothesis disposition are inconsistent.",
    );
  }
  for (const [ids, role] of [
    [evaluation.currentSupportingEvidenceIds, "supports"],
    [evaluation.currentContradictingEvidenceIds, "contradicts"],
  ] as const) {
    assertSortedUniqueStrings(ids, `Current ${role} evidence ids`);
    for (const id of ids) {
      const record = evidence.get(id);
      if (
        !record ||
        record.role !== role ||
        !record.freshness.current ||
        record.snapshotId !== snapshotId ||
        (record.claimId !== undefined && record.claimId !== claim.id)
      ) {
        throw new InvestigationDomainError(
          "unknown_reference",
          "Claim evaluation references incompatible current evidence.",
        );
      }
    }
  }
  return claim;
}

export function createHypothesisLedger(input: {
  snapshotId: SnapshotId;
  claims: readonly ClaimRecord[];
  evidence: readonly EvidenceRecord[];
  knowledgeGaps?: readonly KnowledgeGap[];
}, validatedContext?: ValidatedDomainContext): HypothesisLedger {
  const safeInput = validatedContext
    ? cloneValidatedHypothesisLedgerEnvelope(input, validatedContext)
    : cloneDomainValue(input);
  if (validatedContext && safeInput.snapshotId !== validatedContext.snapshotId) {
    throw new InvestigationDomainError(
      "snapshot_mismatch",
      "Hypothesis ledger context belongs to another snapshot.",
    );
  }
  const claims = indexDomainRecordsById(
    safeInput.claims,
    "Hypothesis ledger claim",
  );
  const evidence = validatedContext?.evidenceById ??
    indexDomainRecordsById(safeInput.evidence, "Hypothesis ledger evidence");
  const gaps = indexDomainRecordsById(
    safeInput.knowledgeGaps ?? [],
    "Hypothesis ledger knowledge gap",
  );
  const hypotheses = new Map<InvestigationHypothesis["id"], InvestigationHypothesis>();

  const ordered = (predicate?: (record: InvestigationHypothesis) => boolean) =>
    [...hypotheses.values()]
      .filter((record) => predicate?.(record) ?? true)
      .sort((left, right) => stableCompare(left.id, right.id))
      .map(cloneDomainValue);

  const buildTransition = (
    hypothesis: InvestigationHypothesis,
    to: InvestigationHypothesis["status"],
    input: HypothesisTransitionInput,
    evidenceIds: readonly EvidenceId[],
    evaluatedEvidence?: {
      supporting: readonly EvidenceId[];
      contradicting: readonly EvidenceId[];
    },
    claimsForValidation: ReadonlyMap<ClaimId, ClaimRecord> = claims,
  ): InvestigationHypothesis => {
    validateTransitionInput(input);
    if (hypothesis.status === to) return cloneDomainValue(hypothesis);
    if (!ALLOWED_TRANSITIONS.has(`${hypothesis.status}:${to}`)) {
      throw new InvestigationDomainError(
        "invalid_transition",
        "Hypothesis transition is not allowed.",
        safeRecordId(hypothesis.id),
      );
    }
    const transitionEvidenceIds = sortedUnique(evidenceIds);
    const next = cloneDomainValue(hypothesis);
    next.history.push({
      from: hypothesis.status,
      to,
      reason: input.reason,
      evidenceIds: transitionEvidenceIds,
      ...(input.operationId === undefined ? {} : { operationId: input.operationId }),
      occurredAt: input.occurredAt,
    });
    next.status = to;
    next.revision += 1;
    if (evaluatedEvidence) {
      next.supportingEvidenceIds = sortedUnique(evaluatedEvidence.supporting);
      next.contradictingEvidenceIds = sortedUnique(
        evaluatedEvidence.contradicting,
      );
    }
    validateHypothesis(next, claimsForValidation, evidence, gaps, inputSnapshotId);
    return next;
  };
  const inputSnapshotId = safeInput.snapshotId;

  return {
    add(rawHypothesis) {
      validateHypothesis(rawHypothesis, claims, evidence, gaps, inputSnapshotId);
      const hypothesis = cloneDomainValue(rawHypothesis);
      const existing = hypotheses.get(hypothesis.id);
      if (existing && !sameDomainRecord(existing, hypothesis)) {
        throw new InvestigationDomainError(
          "record_conflict",
          "Hypothesis id is already associated with different content.",
          safeRecordId(hypothesis.id),
        );
      }
      if (!existing) hypotheses.set(hypothesis.id, hypothesis);
      return cloneDomainValue(existing ?? hypothesis);
    },
    get(id) {
      const record = hypotheses.get(id);
      return record ? cloneDomainValue(record) : null;
    },
    getClaim(id) {
      const record = claims.get(id);
      return record ? cloneDomainValue(record) : null;
    },
    applyClaimEvaluation(rawEvaluationInput) {
      const evaluationInput = cloneDomainValue(rawEvaluationInput);
      const hypothesis = hypotheses.get(evaluationInput.hypothesisId);
      if (!hypothesis) {
        throw new InvestigationDomainError(
          "unknown_reference",
          "Hypothesis does not exist.",
        );
      }
      validateTransitionInput(evaluationInput);
      const candidateClaim = validateEvaluatedClaim(
        evaluationInput.evaluation,
        hypothesis,
        evidence,
        inputSnapshotId,
        validatedContext,
      );
      const blocking = sortedUnique(evaluationInput.blockingContradictionIds ?? []);
      let target = hypothesis.status;
      if (
        evaluationInput.evaluation.hypothesisDisposition === "supported" &&
        blocking.length === 0
      ) {
        target = hypothesis.status === "open" ? "supported" : hypothesis.status;
      } else if (evaluationInput.evaluation.hypothesisDisposition === "rejected") {
        target = hypothesis.status === "open" || hypothesis.status === "supported"
          ? "rejected"
          : hypothesis.status;
      } else if (
        evaluationInput.evaluation.hypothesisDisposition === "open" &&
        hypothesis.status === "supported"
      ) {
        target = "open";
      } else if (
        evaluationInput.evaluation.hypothesisDisposition === "unresolved" &&
        hypothesis.status === "open"
      ) {
        target = "unresolved";
      } else if (
        evaluationInput.evaluation.hypothesisDisposition === "unresolved" &&
        hypothesis.status === "supported"
      ) {
        target = "open";
      }
      if (target === "supported" && blocking.length > 0) {
        throw new InvestigationDomainError(
          "invalid_transition",
          "Blocking contradiction prevents a supported hypothesis.",
        );
      }
      const transitionEvidence = sortedUnique([
        ...evaluationInput.evaluation.currentSupportingEvidenceIds,
        ...evaluationInput.evaluation.currentContradictingEvidenceIds,
      ]);
      const candidateClaims = new Map(claims);
      candidateClaims.set(candidateClaim.id, candidateClaim);
      if (target === hypothesis.status) {
        const candidateHypothesis = cloneDomainValue(hypothesis);
        candidateHypothesis.supportingEvidenceIds = sortedUnique(
          evaluationInput.evaluation.currentSupportingEvidenceIds,
        );
        candidateHypothesis.contradictingEvidenceIds = sortedUnique(
          evaluationInput.evaluation.currentContradictingEvidenceIds,
        );
        validateHypothesis(
          candidateHypothesis,
          candidateClaims,
          evidence,
          gaps,
          inputSnapshotId,
        );
        const existingClaim = claims.get(candidateClaim.id)!;
        if (
          sameDomainRecord(existingClaim, candidateClaim) &&
          sameDomainRecord(hypothesis, candidateHypothesis)
        ) {
          return cloneDomainValue(hypothesis);
        }
        claims.set(candidateClaim.id, candidateClaim);
        hypotheses.set(candidateHypothesis.id, candidateHypothesis);
        return cloneDomainValue(candidateHypothesis);
      }
      const candidateHypothesis = buildTransition(hypothesis, target, evaluationInput, transitionEvidence, {
        supporting: evaluationInput.evaluation.currentSupportingEvidenceIds,
        contradicting: evaluationInput.evaluation.currentContradictingEvidenceIds,
      }, candidateClaims);
      claims.set(candidateClaim.id, candidateClaim);
      hypotheses.set(candidateHypothesis.id, candidateHypothesis);
      return cloneDomainValue(candidateHypothesis);
    },
    markUnresolved(rawMarkInput) {
      const markInput = cloneDomainValue(rawMarkInput);
      const hypothesis = hypotheses.get(markInput.hypothesisId);
      if (!hypothesis) {
        throw new InvestigationDomainError("unknown_reference", "Hypothesis does not exist.");
      }
      validateTransitionInput(markInput);
      const basis = sortedUnique(markInput.evidenceIds ?? []);
      const supporting = [...hypothesis.supportingEvidenceIds];
      const contradicting = [...hypothesis.contradictingEvidenceIds];
      const unrepresentedContext: EvidenceId[] = [];
      for (const evidenceId of basis) {
        const record = evidence.get(evidenceId);
        if (!record) {
          throw new InvestigationDomainError(
            "unknown_reference",
            "Hypothesis transition references unknown evidence.",
          );
        }
        assertHypothesisEvidenceCompatibility(
          record,
          hypothesis.claimId,
          inputSnapshotId,
        );
        if (record.role === "supports") supporting.push(evidenceId);
        else if (record.role === "contradicts") contradicting.push(evidenceId);
        else unrepresentedContext.push(evidenceId);
      }
      if (hypothesis.status === "unresolved") {
        const priorTransitionEvidence = new Set(
          hypothesis.history.at(-1)?.evidenceIds ?? [],
        );
        if (unrepresentedContext.some((id) => !priorTransitionEvidence.has(id))) {
          throw new InvestigationDomainError(
            "invalid_transition",
            "Same-status unresolved update cannot discard new context evidence.",
          );
        }
        const candidate = cloneDomainValue(hypothesis);
        candidate.supportingEvidenceIds = sortedUnique(supporting);
        candidate.contradictingEvidenceIds = sortedUnique(contradicting);
        validateHypothesis(candidate, claims, evidence, gaps, inputSnapshotId);
        if (!sameDomainRecord(candidate, hypothesis)) {
          hypotheses.set(candidate.id, candidate);
        }
        return cloneDomainValue(candidate);
      }
      const candidate = buildTransition(
        hypothesis,
        "unresolved",
        markInput,
        basis,
        { supporting, contradicting },
      );
      if (candidate !== hypothesis && !sameDomainRecord(candidate, hypothesis)) {
        hypotheses.set(candidate.id, candidate);
      }
      return cloneDomainValue(candidate);
    },
    reopen(rawReopenInput) {
      const reopenInput = cloneDomainValue(rawReopenInput);
      const hypothesis = hypotheses.get(reopenInput.hypothesisId);
      if (!hypothesis) {
        throw new InvestigationDomainError("unknown_reference", "Hypothesis does not exist.");
      }
      if (hypothesis.status !== "unresolved" && hypothesis.status !== "rejected") {
        throw new InvestigationDomainError(
          "invalid_transition",
          "Only unresolved or rejected hypotheses can be reopened explicitly.",
        );
      }
      const basis = sortedUnique(reopenInput.evidenceIds);
      if (basis.length === 0 || basis.some((id) => !evidence.has(id))) {
        throw new InvestigationDomainError(
          "invalid_transition",
          "Reopening a hypothesis requires a known new evidence basis.",
        );
      }
      const existing = new Set([
        ...hypothesis.supportingEvidenceIds,
        ...hypothesis.contradictingEvidenceIds,
      ]);
      if (basis.every((id) => existing.has(id))) {
        throw new InvestigationDomainError(
          "invalid_transition",
          "Reopening a hypothesis requires new evidence.",
        );
      }
      const supporting = [...hypothesis.supportingEvidenceIds];
      const contradicting = [...hypothesis.contradictingEvidenceIds];
      for (const evidenceId of basis) {
        const record = evidence.get(evidenceId)!;
        if (record.role === "supports") supporting.push(evidenceId);
        if (record.role === "contradicts") contradicting.push(evidenceId);
      }
      const candidate = buildTransition(hypothesis, "open", reopenInput, basis, {
        supporting,
        contradicting,
      });
      hypotheses.set(candidate.id, candidate);
      return cloneDomainValue(candidate);
    },
    listOpen: () => ordered((record) => record.status === "open"),
    listBlocking: () =>
      ordered(
        (record) =>
          (record.status === "open" || record.status === "unresolved") &&
          record.priority === "critical",
      ),
    snapshot: () => ordered(),
  };
}
