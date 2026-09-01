import type {
  ClaimId,
  ClaimRecord,
  ContradictionId,
  ContradictionRecord,
  EvidenceId,
  EvidenceRecord,
  FactRecord,
  SnapshotId,
} from "../contracts/index.js";
import {
  assertEvidenceEvaluationConsistency,
  assertFactEvaluationConsistency,
} from "./evaluationInvariants.js";
import { assertClaimLedgerConsistency } from "./claimEvaluator.js";
import {
  InvestigationDomainError,
  assertCanonicalUtcTimestamp,
  assertClosedRecord,
  assertPortableIdentifier,
  assertSafeText,
  assertSortedUniqueStrings,
  cloneDomainValue,
  indexDomainRecordsById,
  safeRecordId,
  sameDomainRecord,
  sortedUnique,
  stableCompare,
  stableSerialize,
} from "./investigationDomainSupport.js";
import {
  type ValidatedDomainContext,
} from "./validatedDomainContext.js";
import {
  cloneValidatedContradictionDetectionEnvelope,
  cloneValidatedContradictionRegistryEnvelope,
} from "./validatedDomainEnvelope.js";

const RECORD_FIELDS = [
  "id",
  "snapshotId",
  "claimId",
  "evidenceIds",
  "type",
  "severity",
  "status",
  "resolution",
] as const;
const RESOLUTION_FIELDS = ["summary", "evidenceIds", "resolvedAt"] as const;
const TYPES = new Set([
  "mutually_exclusive_claims",
  "stale_vs_current",
  "declared_vs_implemented",
  "multiple_owners",
  "parser_disagreement",
  "unresolved_alias",
  "custom",
]);
const SEVERITIES = new Set(["blocking", "material", "informational"]);
const STATUSES = new Set(["open", "resolved", "accepted_ambiguity"]);

function assertClaimCompatibleEvidence(
  item: EvidenceRecord,
  claimId: ClaimId,
  snapshotId: SnapshotId,
): void {
  if (
    item.snapshotId !== snapshotId ||
    item.freshness.snapshotId !== snapshotId
  ) {
    throw new InvestigationDomainError(
      "snapshot_mismatch",
      "Contradiction evidence belongs to another snapshot.",
    );
  }
  if (item.claimId !== undefined && item.claimId !== claimId) {
    throw new InvestigationDomainError(
      "unknown_reference",
      "Contradiction evidence belongs to another claim.",
    );
  }
}

export interface ContradictionRegistry {
  add(record: ContradictionRecord): ContradictionRecord;
  resolve(input: {
    id: ContradictionId;
    summary: string;
    evidenceIds: readonly EvidenceId[];
    resolvedAt: string;
  }): ContradictionRecord;
  acceptAmbiguity(input: {
    id: ContradictionId;
    summary: string;
    evidenceIds: readonly EvidenceId[];
    resolvedAt: string;
  }): ContradictionRecord;
  get(id: ContradictionId): ContradictionRecord | null;
  listOpen(): ContradictionRecord[];
  listBlocking(): ContradictionRecord[];
  snapshot(): ContradictionRecord[];
}

export interface ContradictionDetection {
  claimId: ClaimId;
  type: ContradictionRecord["type"];
  severity: ContradictionRecord["severity"];
  evidenceIds: EvidenceId[];
}

export function assertContradictionEvaluationConsistency(input: {
  record: ContradictionRecord;
  snapshotId: SnapshotId;
}): void {
  const { record, snapshotId } = cloneDomainValue(input);
  assertClosedRecord(
    record,
    RECORD_FIELDS,
    RECORD_FIELDS.filter((field) => field !== "resolution"),
    "Contradiction record",
  );
  assertPortableIdentifier(record.id, "Contradiction id");
  assertPortableIdentifier(record.snapshotId, "Contradiction snapshot id");
  assertPortableIdentifier(record.claimId, "Contradiction claim id");
  if (record.snapshotId !== snapshotId) {
    throw new InvestigationDomainError(
      "snapshot_mismatch",
      "Contradiction belongs to another snapshot.",
    );
  }
  assertSortedUniqueStrings(record.evidenceIds, "Contradiction evidence ids");
  record.evidenceIds.forEach((id) => assertPortableIdentifier(id, "Contradiction evidence id"));
  if (record.evidenceIds.length === 0) {
    throw new InvestigationDomainError("invalid_record", "Contradiction requires evidence.");
  }
  if (!TYPES.has(record.type) || !SEVERITIES.has(record.severity) || !STATUSES.has(record.status)) {
    throw new InvestigationDomainError(
      "invalid_record",
      "Contradiction type, severity, or status is not supported.",
    );
  }
  if (record.status === "open") {
    if (record.resolution !== undefined) {
      throw new InvestigationDomainError("invalid_record", "Open contradiction cannot have a resolution.");
    }
    return;
  }
  if (!record.resolution) {
    throw new InvestigationDomainError("invalid_record", "Closed contradiction requires a resolution.");
  }
  assertClosedRecord(record.resolution, RESOLUTION_FIELDS, RESOLUTION_FIELDS, "Contradiction resolution");
  assertSafeText(record.resolution.summary, "Contradiction resolution summary");
  assertSortedUniqueStrings(record.resolution.evidenceIds, "Contradiction resolution evidence ids");
  record.resolution.evidenceIds.forEach((id) => assertPortableIdentifier(id, "Resolution evidence id"));
  assertCanonicalUtcTimestamp(record.resolution.resolvedAt, "Contradiction resolution timestamp");
}

function validateRecord(
  record: ContradictionRecord,
  snapshotId: SnapshotId,
  claims: ReadonlyMap<ClaimId, ClaimRecord>,
  evidence: ReadonlyMap<EvidenceId, EvidenceRecord>,
): void {
  assertContradictionEvaluationConsistency({ record, snapshotId });
  assertClosedRecord(
    record,
    RECORD_FIELDS,
    RECORD_FIELDS.filter((field) => field !== "resolution"),
    "Contradiction record",
  );
  assertPortableIdentifier(record.id, "Contradiction id");
  assertPortableIdentifier(record.claimId, "Contradiction claim id");
  if (record.snapshotId !== snapshotId) {
    throw new InvestigationDomainError(
      "snapshot_mismatch",
      "Contradiction belongs to another snapshot.",
      safeRecordId(record.id),
    );
  }
  const claim = claims.get(record.claimId);
  if (!claim) {
    throw new InvestigationDomainError(
      "unknown_reference",
      "Contradiction references an unknown claim.",
    );
  }
  if (claim.snapshotId !== snapshotId) {
    throw new InvestigationDomainError(
      "snapshot_mismatch",
      "Contradiction claim belongs to another snapshot.",
    );
  }
  assertSortedUniqueStrings(record.evidenceIds, "Contradiction evidence ids");
  if (record.evidenceIds.length === 0) {
    throw new InvestigationDomainError(
      "invalid_record",
      "Contradiction requires evidence.",
    );
  }
  for (const evidenceId of record.evidenceIds) {
    const item = evidence.get(evidenceId);
    if (!item) {
      throw new InvestigationDomainError(
        "unknown_reference",
        "Contradiction references unknown evidence.",
      );
    }
    assertClaimCompatibleEvidence(item, record.claimId, snapshotId);
  }
  if (!TYPES.has(record.type) || !SEVERITIES.has(record.severity) || !STATUSES.has(record.status)) {
    throw new InvestigationDomainError(
      "invalid_record",
      "Contradiction type, severity, or status is not supported.",
    );
  }
  if (record.status === "open" && record.resolution !== undefined) {
    throw new InvestigationDomainError(
      "invalid_record",
      "Open contradiction cannot have a resolution.",
    );
  }
  const contradictionEvidence = record.evidenceIds.map((id) => evidence.get(id)!);
  if (record.type === "stale_vs_current") {
    const hasCurrent = contradictionEvidence.some((item) => item.freshness.current);
    const hasStale = contradictionEvidence.some(
      (item) => !item.freshness.current && item.freshness.reason === "stale",
    );
    if (!hasCurrent || !hasStale) {
      throw new InvestigationDomainError(
        "invalid_record",
        "Stale-versus-current contradiction requires both evidence states.",
      );
    }
  }
  if (record.type === "multiple_owners") {
    if (
      contradictionEvidence.length < 2 ||
      contradictionEvidence.some(
        (item) => !item.freshness.current || item.role !== "supports",
      )
    ) {
      throw new InvestigationDomainError(
        "invalid_record",
        "Multiple-owner contradiction requires current supporting evidence.",
      );
    }
  }
  if (record.type === "mutually_exclusive_claims") {
    const roles = new Set(contradictionEvidence.map((item) => item.role));
    const opposingRoles = roles.has("supports") && roles.has("contradicts");
    const establishedSingleValueConflict =
      contradictionEvidence.length >= 2 &&
      contradictionEvidence.every((item) => item.role === "supports");
    if (
      contradictionEvidence.length < 2 ||
      contradictionEvidence.some((item) => !item.freshness.current) ||
      contradictionEvidence.some((item) => item.role === "context_only") ||
      (!opposingRoles && !establishedSingleValueConflict)
    ) {
      throw new InvestigationDomainError(
        "invalid_record",
        "Mutually-exclusive contradiction requires opposing current evidence.",
      );
    }
  }
  if (
    (record.type === "declared_vs_implemented" ||
      record.type === "parser_disagreement") &&
    contradictionEvidence.some(
      (item) =>
        !item.freshness.current ||
        (item.role !== "supports" && item.role !== "contradicts"),
    )
  ) {
    throw new InvestigationDomainError(
      "invalid_record",
      "This contradiction type requires current semantic evidence.",
    );
  }
  if (record.status !== "open") {
    if (!record.resolution) {
      throw new InvestigationDomainError(
        "invalid_record",
        "Closed contradiction requires a resolution.",
      );
    }
    assertClosedRecord(
      record.resolution,
      RESOLUTION_FIELDS,
      RESOLUTION_FIELDS,
      "Contradiction resolution",
    );
    assertSafeText(record.resolution.summary, "Contradiction resolution summary");
    assertSortedUniqueStrings(
      record.resolution.evidenceIds,
      "Contradiction resolution evidence ids",
    );
    for (const evidenceId of record.resolution.evidenceIds) {
      const item = evidence.get(evidenceId);
      if (!item) {
        throw new InvestigationDomainError(
          "unknown_reference",
          "Contradiction resolution references unknown evidence.",
        );
      }
      assertClaimCompatibleEvidence(item, record.claimId, snapshotId);
    }
    assertCanonicalUtcTimestamp(
      record.resolution.resolvedAt,
      "Contradiction resolution timestamp",
    );
  }
}

export function createContradictionRegistry(input: {
  snapshotId: SnapshotId;
  claims: readonly ClaimRecord[];
  evidence: readonly EvidenceRecord[];
}, checkpoint?: () => void, validatedContext?: ValidatedDomainContext): ContradictionRegistry {
  checkpoint?.();
  const safeInput = validatedContext
    ? cloneValidatedContradictionRegistryEnvelope(input, validatedContext)
    : cloneDomainValue(input);
  if (validatedContext && safeInput.snapshotId !== validatedContext.snapshotId) {
    throw new InvestigationDomainError(
      "snapshot_mismatch",
      "Contradiction registry context belongs to another snapshot.",
    );
  }
  const claims = indexDomainRecordsById(
    safeInput.claims,
    "Contradiction registry claim",
  );
  const evidence = validatedContext?.evidenceById ??
    indexDomainRecordsById(safeInput.evidence, "Contradiction registry evidence");
  if (!validatedContext) {
    evidence.forEach((record) => {
      checkpoint?.();
      assertEvidenceEvaluationConsistency({
        evidence: record,
        snapshotId: safeInput.snapshotId,
      }, checkpoint);
    });
  }
  const records = new Map<ContradictionId, ContradictionRecord>();
  const ordered = (predicate?: (record: ContradictionRecord) => boolean) =>
    [...records.values()]
      .filter((record) => predicate?.(record) ?? true)
      .sort((left, right) => stableCompare(left.id, right.id))
      .map(cloneDomainValue);

  const close = (
    status: "resolved" | "accepted_ambiguity",
    closeInput: {
      id: ContradictionId;
      summary: string;
      evidenceIds: readonly EvidenceId[];
      resolvedAt: string;
    },
  ) => {
    const current = records.get(closeInput.id);
    if (!current) {
      throw new InvestigationDomainError(
        "unknown_reference",
        "Contradiction does not exist.",
      );
    }
    if (current.status !== "open") {
      throw new InvestigationDomainError(
        "invalid_transition",
        "Contradiction resolution is immutable once recorded.",
      );
    }
    const next: ContradictionRecord = {
      ...cloneDomainValue(current),
      status,
      resolution: {
        summary: closeInput.summary,
        evidenceIds: sortedUnique(closeInput.evidenceIds),
        resolvedAt: closeInput.resolvedAt,
      },
    };
    validateRecord(next, safeInput.snapshotId, claims, evidence);
    records.set(next.id, next);
    return cloneDomainValue(next);
  };

  return {
    add(rawRecord) {
      validateRecord(rawRecord, safeInput.snapshotId, claims, evidence);
      const record = cloneDomainValue(rawRecord);
      const existing = records.get(record.id);
      if (existing && !sameDomainRecord(existing, record)) {
        throw new InvestigationDomainError(
          "record_conflict",
          "Contradiction id is already associated with different content.",
          safeRecordId(record.id),
        );
      }
      if (!existing) records.set(record.id, record);
      return cloneDomainValue(existing ?? record);
    },
    resolve: (closeInput) => close("resolved", closeInput),
    acceptAmbiguity: (closeInput) => close("accepted_ambiguity", closeInput),
    get(id) {
      const record = records.get(id);
      return record ? cloneDomainValue(record) : null;
    },
    listOpen: () => ordered((record) => record.status === "open"),
    listBlocking: () =>
      ordered((record) => record.status === "open" && record.severity === "blocking"),
    snapshot: () => ordered(),
  };
}

export function detectDeterministicContradictions(input: {
  claim: ClaimRecord;
  evidence: readonly EvidenceRecord[];
  facts: readonly FactRecord[];
  claimRequiresSingleValue?: boolean;
  acceptedFactPredicates?: readonly FactRecord["predicate"][];
}, checkpoint?: () => void, validatedContext?: ValidatedDomainContext): ContradictionDetection[] {
  checkpoint?.();
  const safeInput = validatedContext
    ? cloneValidatedContradictionDetectionEnvelope(input, validatedContext)
    : cloneDomainValue(input);
  if (validatedContext && safeInput.claim.snapshotId !== validatedContext.snapshotId) {
    throw new InvestigationDomainError(
      "snapshot_mismatch",
      "Contradiction detection context belongs to another snapshot.",
    );
  }
  const evidenceById = validatedContext?.evidenceById ??
    indexDomainRecordsById(safeInput.evidence, "Contradiction detection evidence");
  const factsById = validatedContext?.factsById ??
    indexDomainRecordsById(safeInput.facts, "Contradiction detection fact");
  const contextEvidence = validatedContext?.evidence ?? [...evidenceById.values()];
  const contextFacts = validatedContext?.facts ?? [...factsById.values()];
  assertClaimLedgerConsistency({
    claim: safeInput.claim,
    evidence: contextEvidence,
    snapshotId: safeInput.claim.snapshotId,
  }, validatedContext);
  if (!validatedContext) {
    contextFacts.forEach((fact) => {
      checkpoint?.();
      assertFactEvaluationConsistency({
        fact,
        snapshotId: safeInput.claim.snapshotId,
      });
    });
  }
  if (
    contextEvidence.some((record) => record.snapshotId !== safeInput.claim.snapshotId) ||
    contextFacts.some((record) => record.snapshotId !== safeInput.claim.snapshotId)
  ) {
    throw new InvestigationDomainError(
      "snapshot_mismatch",
      "Contradiction detection cannot mix snapshots.",
    );
  }
  if (!validatedContext) {
    contextEvidence.forEach((record) => {
      checkpoint?.();
      assertEvidenceEvaluationConsistency({
        evidence: record,
        facts: contextFacts,
        snapshotId: safeInput.claim.snapshotId,
      }, checkpoint);
    });
  }
  const acceptedPredicates = new Set(safeInput.acceptedFactPredicates ?? []);
  const derivationFactIds = new Set(safeInput.claim.derivation.inputFactIds);
  const factIsRelevant = (fact: FactRecord): boolean =>
    derivationFactIds.has(fact.id) || acceptedPredicates.has(fact.predicate);
  const evidence = contextEvidence
    .filter(
      (record) =>
        record.claimId === safeInput.claim.id &&
        record.freshness.current &&
        (record.strength === "substantial" || record.strength === "conclusive"),
    )
    .sort((left, right) => stableCompare(left.id, right.id));
  const supporting = evidence.filter((record) => record.role === "supports");
  const contradicting = evidence.filter((record) => record.role === "contradicts");
  const detections: ContradictionDetection[] = [];
  const semanticFacts = (record: EvidenceRecord) =>
    record.factIds
      .map((id) => factsById.get(id))
      .filter(
        (fact): fact is FactRecord =>
          fact !== undefined && fact.status === "active" && factIsRelevant(fact),
      );
  const basisKey = (fact: FactRecord) =>
    `${fact.subject.id}\u0000${fact.predicate}`;
  const conflictingCurrentEvidence = new Set<EvidenceId>();
  for (const support of supporting) {
    for (const contradiction of contradicting) {
      checkpoint?.();
      if (
        semanticFacts(support).some((supportFact) =>
          semanticFacts(contradiction).some(
            (contradictionFact) => basisKey(contradictionFact) === basisKey(supportFact),
          ),
        )
      ) {
        conflictingCurrentEvidence.add(support.id);
        conflictingCurrentEvidence.add(contradiction.id);
      }
    }
  }
  if (conflictingCurrentEvidence.size > 0) {
    detections.push({
      claimId: safeInput.claim.id,
      type: "mutually_exclusive_claims",
      severity: "blocking",
      evidenceIds: sortedUnique([...conflictingCurrentEvidence]),
    });
  }
  if (safeInput.claimRequiresSingleValue) {
    const valuesByBasis = new Map<string, Map<string, EvidenceId[]>>();
    for (const record of supporting) {
      for (const fact of semanticFacts(record)) {
        checkpoint?.();
        const values = valuesByBasis.get(basisKey(fact)) ?? new Map<string, EvidenceId[]>();
        const valueKey = stableSerialize(fact.object);
        values.set(valueKey, [...(values.get(valueKey) ?? []), record.id]);
        valuesByBasis.set(basisKey(fact), values);
      }
    }
    const conflicting = [...valuesByBasis.values()]
      .filter((values) => values.size > 1)
      .flatMap((values) => [...values.values()].flat());
    if (conflicting.length > 0) {
      detections.push({
        claimId: safeInput.claim.id,
        type:
          safeInput.claim.type === "implementation_owner"
            ? "multiple_owners"
            : "mutually_exclusive_claims",
        severity: "blocking",
        evidenceIds: sortedUnique(conflicting),
      });
    }
  }
  const stale = contextEvidence.filter(
    (record) =>
      record.claimId === safeInput.claim.id &&
      !record.freshness.current &&
      record.freshness.reason === "stale" &&
      record.strength !== "lead",
  );
  const staleConflicts = new Set<EvidenceId>();
  for (const staleRecord of stale) {
    for (const currentRecord of evidence) {
      for (const staleFact of semanticFacts(staleRecord)) {
        for (const currentFact of semanticFacts(currentRecord)) {
          checkpoint?.();
          if (
            basisKey(staleFact) === basisKey(currentFact) &&
            (stableSerialize(staleFact.object) !== stableSerialize(currentFact.object) ||
              staleRecord.role !== currentRecord.role)
          ) {
            staleConflicts.add(staleRecord.id);
            staleConflicts.add(currentRecord.id);
          }
        }
      }
    }
  }
  if (staleConflicts.size > 0) {
    detections.push({
      claimId: safeInput.claim.id,
      type: "stale_vs_current",
      severity: "material",
      evidenceIds: sortedUnique([...staleConflicts]),
    });
  }
  const merged = new Map<
    ContradictionDetection["type"],
    ContradictionDetection
  >();
  for (const detection of detections) {
    checkpoint?.();
    const existing = merged.get(detection.type);
    if (!existing) {
      merged.set(detection.type, detection);
      continue;
    }
    existing.evidenceIds = sortedUnique([
      ...existing.evidenceIds,
      ...detection.evidenceIds,
    ]);
    if (detection.severity === "blocking") existing.severity = "blocking";
  }
  return [...merged.values()].sort((left, right) =>
    stableCompare(`${left.type}:${left.evidenceIds.join(",")}`, `${right.type}:${right.evidenceIds.join(",")}`),
  );
}
