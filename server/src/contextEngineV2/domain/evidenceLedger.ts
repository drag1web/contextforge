import type {
  ClaimId,
  EvidenceId,
  EvidenceRecord,
  FactRecord,
  RepositorySnapshot,
} from "../contracts/index.js";
import {
  assertEvidenceEvaluationConsistency,
  assertFactEvaluationConsistency,
} from "./evaluationInvariants.js";
import {
  assertEvidenceSnapshotConsistency,
  InvariantViolationError,
} from "./invariant.js";
import {
  InvestigationDomainError,
  cloneDomainValue,
  safeRecordId,
  sameDomainRecord,
  stableCompare,
} from "./investigationDomainSupport.js";

function validateEvidenceRecord(
  evidence: EvidenceRecord,
  facts: readonly FactRecord[],
  snapshot: RepositorySnapshot,
): void {
  assertEvidenceEvaluationConsistency({ evidence, facts, snapshotId: snapshot.id });
  try {
    assertEvidenceSnapshotConsistency(evidence, facts, snapshot);
  } catch (error) {
    if (error instanceof InvariantViolationError) {
      throw new InvestigationDomainError(
        error.issues.some((issue) => issue.code === "unknown_reference")
          ? "unknown_reference"
          : error.issues.some((issue) => issue.code === "snapshot_mismatch")
            ? "snapshot_mismatch"
            : "invalid_record",
        "Evidence failed snapshot and source consistency validation.",
        safeRecordId(evidence.id),
      );
    }
    throw error;
  }
}

export interface EvidenceLedger {
  add(evidence: EvidenceRecord): EvidenceRecord;
  addMany(evidence: readonly EvidenceRecord[]): EvidenceRecord[];
  get(id: EvidenceId): EvidenceRecord | null;
  list(): EvidenceRecord[];
  listForClaim(claimId: ClaimId): EvidenceRecord[];
  listSupporting(claimId?: ClaimId): EvidenceRecord[];
  listContradicting(claimId?: ClaimId): EvidenceRecord[];
  listCurrent(): EvidenceRecord[];
  listStale(): EvidenceRecord[];
  snapshot(): EvidenceRecord[];
}

export function createEvidenceLedger(input: {
  snapshot: RepositorySnapshot;
  facts: readonly FactRecord[];
}): EvidenceLedger {
  const safeInput = cloneDomainValue(input);
  const snapshot = safeInput.snapshot;
  const facts = [...safeInput.facts];
  facts.forEach((fact) =>
    assertFactEvaluationConsistency({ fact, snapshotId: snapshot.id }),
  );
  const records = new Map<EvidenceId, EvidenceRecord>();

  const sortedRecords = (predicate?: (record: EvidenceRecord) => boolean) =>
    [...records.values()]
      .filter((record) => predicate?.(record) ?? true)
      .sort((left, right) => stableCompare(left.id, right.id))
      .map((record) => cloneDomainValue(record));

  const addMany = (batch: readonly EvidenceRecord[]): EvidenceRecord[] => {
    const pending = new Map<EvidenceId, EvidenceRecord>();
    for (const rawEvidence of batch) {
      validateEvidenceRecord(rawEvidence, facts, snapshot);
      const evidence = cloneDomainValue(rawEvidence);
      validateEvidenceRecord(evidence, facts, snapshot);
      const existing = pending.get(evidence.id) ?? records.get(evidence.id);
      if (existing && !sameDomainRecord(existing, evidence)) {
        throw new InvestigationDomainError(
          "record_conflict",
          "Evidence id is already associated with different content.",
          safeRecordId(evidence.id),
        );
      }
      pending.set(evidence.id, evidence);
    }
    for (const [id, evidence] of pending) {
      if (!records.has(id)) records.set(id, evidence);
    }
    return [...pending.values()]
      .sort((left, right) => stableCompare(left.id, right.id))
      .map((record) => cloneDomainValue(records.get(record.id)!));
  };

  return {
    add(evidence) {
      return addMany([evidence])[0]!;
    },
    addMany,
    get(id) {
      const record = records.get(id);
      return record ? cloneDomainValue(record) : null;
    },
    list: () => sortedRecords(),
    listForClaim: (claimId) => sortedRecords((record) => record.claimId === claimId),
    listSupporting: (claimId) =>
      sortedRecords(
        (record) =>
          record.role === "supports" &&
          (claimId === undefined || record.claimId === claimId),
      ),
    listContradicting: (claimId) =>
      sortedRecords(
        (record) =>
          record.role === "contradicts" &&
          (claimId === undefined || record.claimId === claimId),
      ),
    listCurrent: () => sortedRecords((record) => record.freshness.current),
    listStale: () => sortedRecords((record) => !record.freshness.current),
    snapshot: () => sortedRecords(),
  };
}
