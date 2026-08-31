import type {
  ContradictionRecord,
  EvidenceRecord,
  FactRecord,
  Finding,
  KnowledgeGap,
  RepositoryEntity,
  SnapshotId,
} from "../contracts/index.js";
import { assertContradictionEvaluationConsistency } from "./contradictionRegistry.js";
import {
  assertEntityEvaluationConsistency,
  assertEvidenceEvaluationConsistency,
  assertFactEvaluationConsistency,
  hasActiveEvidenceBasis,
} from "./evaluationInvariants.js";
import { assertKnowledgeGapEvaluationConsistency } from "./knowledgeGapRegistry.js";
import {
  InvestigationDomainError,
  assertClosedRecord,
  assertPortableIdentifier,
  assertSafeText,
  assertSortedUniqueStrings,
  cloneDomainValue,
  indexDomainRecordsById,
  sortedUnique,
} from "./investigationDomainSupport.js";
import {
  assertValidatedDomainContext,
  type ValidatedDomainContext,
} from "./validatedDomainContext.js";

const FINDING_FIELDS = [
  "id",
  "snapshotId",
  "type",
  "statement",
  "entityIds",
  "evidenceIds",
  "status",
  "limitations",
  "authorizationHint",
] as const;
const TYPES = new Set([
  "implementation_target",
  "supporting_context",
  "behavior_summary",
  "constraint",
  "risk",
  "test_target",
  "clarification_requirement",
]);
const STATUSES = new Set(["confirmed", "probable", "unresolved"]);
const AUTHORIZATION = new Set(["eligible", "review_required", "not_eligible"]);
const DERIVED_LIMITATION_CODES = new Set([
  "blocking_authorization_gap",
  "blocking_contradiction",
  "blocking_finding_gap",
  "blocking_projection_gap",
  "cross_snapshot_entity",
  "cross_snapshot_evidence",
  "current_supporting_evidence_missing",
  "implementation_entity_missing",
  "unknown_entity",
  "unknown_evidence",
]);
const INPUT_FIELDS = [
  "finding",
  "snapshotId",
  "evidence",
  "facts",
  "entities",
  "contradictions",
  "knowledgeGaps",
] as const;

export interface FindingEligibilityEvaluation {
  finding: Finding;
  eligible: boolean;
  safeToProject: boolean;
  limitations: string[];
}

export function evaluateFindingEligibility(input: {
  finding: Finding;
  snapshotId: SnapshotId;
  evidence: readonly EvidenceRecord[];
  facts: readonly FactRecord[];
  entities: readonly RepositoryEntity[];
  contradictions: readonly ContradictionRecord[];
  knowledgeGaps: readonly KnowledgeGap[];
}, validatedContext?: ValidatedDomainContext): FindingEligibilityEvaluation {
  if (validatedContext) assertValidatedDomainContext(validatedContext);
  validatedContext?.assertCanonical({
    entities: input.entities,
    facts: input.facts,
    evidence: input.evidence,
  });
  if (validatedContext && input.snapshotId !== validatedContext.snapshotId) {
    throw new InvestigationDomainError(
      "snapshot_mismatch",
      "Finding eligibility context belongs to another snapshot.",
    );
  }
  const safeInput = cloneDomainValue(input);
  assertClosedRecord(
    safeInput,
    INPUT_FIELDS,
    INPUT_FIELDS,
    "Finding eligibility input",
  );
  for (const [value, label] of [
    [safeInput.evidence, "Finding evaluation evidence"],
    [safeInput.facts, "Finding evaluation facts"],
    [safeInput.entities, "Finding evaluation entities"],
    [safeInput.contradictions, "Finding evaluation contradictions"],
    [safeInput.knowledgeGaps, "Finding evaluation knowledge gaps"],
  ] as const) {
    if (!Array.isArray(value)) {
      throw new InvestigationDomainError(
        "invalid_record",
        `${label} must be a dense array.`,
      );
    }
  }
  assertClosedRecord(
    safeInput.finding,
    FINDING_FIELDS,
    FINDING_FIELDS,
    "Finding record",
  );
  const finding = cloneDomainValue(safeInput.finding);
  assertPortableIdentifier(finding.id, "Finding id");
  assertSafeText(finding.statement, "Finding statement");
  if (finding.snapshotId !== safeInput.snapshotId) {
    throw new InvestigationDomainError(
      "snapshot_mismatch",
      "Finding belongs to another snapshot.",
    );
  }
  if (
    !TYPES.has(finding.type) ||
    !STATUSES.has(finding.status) ||
    !AUTHORIZATION.has(finding.authorizationHint)
  ) {
    throw new InvestigationDomainError(
      "invalid_record",
      "Finding type, status, or authorization hint is not supported.",
    );
  }
  assertSortedUniqueStrings(finding.entityIds, "Finding entity ids");
  assertSortedUniqueStrings(finding.evidenceIds, "Finding evidence ids");
  assertSortedUniqueStrings(finding.limitations, "Finding limitations");
  finding.limitations.forEach((limitation) =>
    assertSafeText(limitation, "Finding limitation"),
  );
  const evidenceById = validatedContext?.evidenceById ??
    indexDomainRecordsById(safeInput.evidence, "Finding evaluation evidence");
  const factsById = validatedContext?.factsById ??
    indexDomainRecordsById(safeInput.facts, "Finding evaluation fact");
  const entitiesById = validatedContext?.entitiesById ??
    indexDomainRecordsById(safeInput.entities, "Finding evaluation entity");
  const contradictions = [
    ...indexDomainRecordsById(
      safeInput.contradictions,
      "Finding evaluation contradiction",
    ).values(),
  ];
  const knowledgeGaps = [
    ...indexDomainRecordsById(
      safeInput.knowledgeGaps,
      "Finding evaluation knowledge gap",
    ).values(),
  ];
  if (!validatedContext) {
    for (const record of factsById.values()) {
      assertFactEvaluationConsistency({
        fact: record,
        snapshotId: safeInput.snapshotId,
      });
    }
    for (const record of evidenceById.values()) {
      assertEvidenceEvaluationConsistency({
        evidence: record,
        snapshotId: record.snapshotId,
      });
      for (const factId of record.factIds) {
        const referencedFact = factsById.get(factId);
        if (!referencedFact) {
          throw new InvestigationDomainError(
            "unknown_reference",
            "Finding evidence references an unknown fact.",
          );
        }
        if (referencedFact.snapshotId !== record.snapshotId) {
          throw new InvestigationDomainError(
            "snapshot_mismatch",
            "Finding evidence fact belongs to another snapshot.",
          );
        }
      }
    }
    for (const record of entitiesById.values()) {
      assertEntityEvaluationConsistency({
        entity: record,
        snapshotId: record.snapshotId,
      });
    }
  }
  contradictions.forEach((record) =>
    assertContradictionEvaluationConsistency({
      record,
      snapshotId: record.snapshotId,
    }),
  );
  knowledgeGaps.forEach((gap) =>
    assertKnowledgeGapEvaluationConsistency({
      gap,
      snapshotId: gap.snapshotId,
    }),
  );
  const referencedEvidence = finding.evidenceIds.map((id) => evidenceById.get(id));
  const unknownEvidence = referencedEvidence.some((record) => !record);
  const crossSnapshotEvidence = referencedEvidence.some(
    (record) =>
      record &&
      (record.snapshotId !== safeInput.snapshotId ||
        record.freshness.snapshotId !== safeInput.snapshotId),
  );
  const currentSupport = referencedEvidence.some((record) => {
    if (
      !record?.freshness.current ||
      record.role !== "supports" ||
      record.strength === "lead"
    ) {
      return false;
    }
    return hasActiveEvidenceBasis(record, factsById);
  });
  const unknownEntity = finding.entityIds.some((id) => !entitiesById.has(id));
  const crossSnapshotEntity = finding.entityIds.some(
    (id) => entitiesById.get(id)?.snapshotId !== safeInput.snapshotId,
  );
  const blockingContradiction = contradictions.some(
    (record) =>
      record.snapshotId === safeInput.snapshotId &&
      record.status === "open" &&
      record.severity === "blocking",
  );
  const openBlockingGaps = knowledgeGaps.filter(
    (gap) =>
      gap.snapshotId === safeInput.snapshotId &&
      gap.status === "open" &&
      gap.blocks.length > 0,
  );
  const blocksFinding = openBlockingGaps.some((gap) =>
    gap.blocks.includes("finding"),
  );
  const blocksProjection = openBlockingGaps.some((gap) =>
    gap.blocks.includes("projection"),
  );
  const blocksAuthorization = openBlockingGaps.some((gap) =>
    gap.blocks.includes("authorization"),
  );
  const hasBlockingGap =
    blocksFinding || blocksProjection || blocksAuthorization;
  const implementationEntityMissing =
    finding.type === "implementation_target" && finding.entityIds.length === 0;
  const intrinsicLimitations = finding.limitations.filter(
    (limitation) => !DERIVED_LIMITATION_CODES.has(limitation),
  );
  const limitations = sortedUnique([
    ...intrinsicLimitations,
    ...(unknownEvidence ? ["unknown_evidence"] : []),
    ...(crossSnapshotEvidence ? ["cross_snapshot_evidence"] : []),
    ...(finding.status === "confirmed" && !currentSupport
      ? ["current_supporting_evidence_missing"]
      : []),
    ...(unknownEntity ? ["unknown_entity"] : []),
    ...(crossSnapshotEntity ? ["cross_snapshot_entity"] : []),
    ...(blockingContradiction ? ["blocking_contradiction"] : []),
    ...(blocksAuthorization ? ["blocking_authorization_gap"] : []),
    ...(blocksFinding ? ["blocking_finding_gap"] : []),
    ...(blocksProjection ? ["blocking_projection_gap"] : []),
    ...(implementationEntityMissing ? ["implementation_entity_missing"] : []),
  ]);
  const confirmedEligible =
    finding.status === "confirmed" &&
    currentSupport &&
    !unknownEvidence &&
    !crossSnapshotEvidence &&
    !unknownEntity &&
    !crossSnapshotEntity &&
    !blockingContradiction &&
    !hasBlockingGap &&
    !implementationEntityMissing;
  finding.authorizationHint = confirmedEligible
    ? "eligible"
    : finding.status === "probable" &&
        !hasBlockingGap &&
        !blockingContradiction &&
        !unknownEvidence &&
        !crossSnapshotEvidence &&
        !unknownEntity &&
        !crossSnapshotEntity
      ? "review_required"
      : "not_eligible";
  finding.limitations = limitations;
  return {
    finding,
    eligible: finding.authorizationHint === "eligible",
    safeToProject:
      !blocksProjection &&
      (finding.authorizationHint === "eligible" ||
        finding.authorizationHint === "review_required"),
    limitations,
  };
}
