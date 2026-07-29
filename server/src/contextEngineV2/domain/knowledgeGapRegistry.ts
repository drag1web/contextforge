import type {
  EntityId,
  HypothesisId,
  InvestigationOperationProposal,
  InvestigationOperationType,
  KnowledgeGap,
  KnowledgeGapId,
  SnapshotId,
} from "../contracts/index.js";
import {
  InvestigationDomainError,
  assertClosedRecord,
  assertPortableIdentifier,
  assertSafeText,
  assertSortedUniqueStrings,
  cloneDomainValue,
  safeRecordId,
  sameDomainRecord,
  sortedUnique,
  stableCompare,
  stableSerialize,
} from "./investigationDomainSupport.js";

const GAP_FIELDS = [
  "id",
  "snapshotId",
  "category",
  "question",
  "blocks",
  "relatedEntityIds",
  "relatedHypothesisIds",
  "suggestedOperations",
  "status",
] as const;
const PROPOSAL_FIELDS = ["type", "reason", "questionIds", "hypothesisIds"] as const;
const CATEGORIES = new Set([
  "missing_owner",
  "missing_behavior",
  "missing_relationship",
  "missing_runtime_variant",
  "missing_test_evidence",
  "ambiguous_user_intent",
  "snapshot_truncated",
  "unreadable_source",
  "safety_restricted",
  "custom",
]);
const BLOCKS = new Set(["finding", "projection", "authorization"]);
const STATUSES = new Set(["open", "resolved", "accepted_unresolved"]);
const OPERATION_TYPES = new Set<InvestigationOperationType>([
  "search_paths",
  "search_text",
  "search_symbols",
  "read_file",
  "read_range",
  "parse_file",
  "follow_relationship",
  "inspect_manifest",
  "inspect_git_context",
  "evaluate_absence",
]);

export interface KnowledgeGapRegistry {
  add(gap: KnowledgeGap): KnowledgeGap;
  resolve(id: KnowledgeGapId): KnowledgeGap;
  acceptUnresolved(id: KnowledgeGapId): KnowledgeGap;
  get(id: KnowledgeGapId): KnowledgeGap | null;
  listOpen(): KnowledgeGap[];
  listBlocking(): KnowledgeGap[];
  snapshot(): KnowledgeGap[];
}

function validateProposal(proposal: InvestigationOperationProposal): void {
  assertClosedRecord(
    proposal,
    PROPOSAL_FIELDS,
    PROPOSAL_FIELDS,
    "Investigation operation proposal",
  );
  if (!OPERATION_TYPES.has(proposal.type)) {
    throw new InvestigationDomainError(
      "invalid_record",
      "Suggested operation type is not supported.",
    );
  }
  assertSafeText(proposal.reason, "Suggested operation reason");
  assertSortedUniqueStrings(proposal.questionIds, "Suggested operation question ids");
  assertSortedUniqueStrings(
    proposal.hypothesisIds,
    "Suggested operation hypothesis ids",
  );
  proposal.questionIds.forEach((id) =>
    assertPortableIdentifier(id, "Suggested operation question id"),
  );
  proposal.hypothesisIds.forEach((id) =>
    assertPortableIdentifier(id, "Suggested operation hypothesis id"),
  );
}

function canonicalGap(gap: KnowledgeGap): KnowledgeGap {
  const result = cloneDomainValue(gap);
  result.blocks = sortedUnique(result.blocks);
  result.relatedEntityIds = sortedUnique(result.relatedEntityIds);
  result.relatedHypothesisIds = sortedUnique(result.relatedHypothesisIds);
  result.suggestedOperations = [...result.suggestedOperations].sort((left, right) =>
    stableCompare(stableSerialize(left), stableSerialize(right)),
  );
  return result;
}

function validateGap(
  gap: KnowledgeGap,
  snapshotId: SnapshotId,
  knownEntityIds: ReadonlySet<EntityId> | undefined,
  knownHypothesisIds: ReadonlySet<HypothesisId> | undefined,
): void {
  assertClosedRecord(gap, GAP_FIELDS, GAP_FIELDS, "Knowledge gap");
  assertPortableIdentifier(gap.id, "Knowledge gap id");
  if (gap.snapshotId !== snapshotId) {
    throw new InvestigationDomainError(
      "snapshot_mismatch",
      "Knowledge gap belongs to another snapshot.",
      safeRecordId(gap.id),
    );
  }
  if (!CATEGORIES.has(gap.category) || !STATUSES.has(gap.status)) {
    throw new InvestigationDomainError(
      "invalid_record",
      "Knowledge gap category or status is not supported.",
    );
  }
  assertSafeText(gap.question, "Knowledge gap question");
  assertSortedUniqueStrings(gap.blocks, "Knowledge gap blocking scopes");
  if (gap.blocks.some((block) => !BLOCKS.has(block))) {
    throw new InvestigationDomainError(
      "invalid_record",
      "Knowledge gap blocking scope is not supported.",
    );
  }
  assertSortedUniqueStrings(gap.relatedEntityIds, "Knowledge gap entity ids");
  assertSortedUniqueStrings(
    gap.relatedHypothesisIds,
    "Knowledge gap hypothesis ids",
  );
  gap.relatedEntityIds.forEach((id) =>
    assertPortableIdentifier(id, "Knowledge gap entity id"),
  );
  gap.relatedHypothesisIds.forEach((id) =>
    assertPortableIdentifier(id, "Knowledge gap hypothesis id"),
  );
  if (
    knownEntityIds &&
    gap.relatedEntityIds.some((entityId) => !knownEntityIds.has(entityId))
  ) {
    throw new InvestigationDomainError(
      "unknown_reference",
      "Knowledge gap references an unknown entity.",
    );
  }
  if (
    knownHypothesisIds &&
    gap.relatedHypothesisIds.some((hypothesisId) => !knownHypothesisIds.has(hypothesisId))
  ) {
    throw new InvestigationDomainError(
      "unknown_reference",
      "Knowledge gap references an unknown hypothesis.",
    );
  }
  if (!Array.isArray(gap.suggestedOperations)) {
    throw new InvestigationDomainError(
      "invalid_record",
      "Knowledge gap suggested operations must be an array.",
    );
  }
  gap.suggestedOperations.forEach(validateProposal);
}

export function assertKnowledgeGapEvaluationConsistency(input: {
  gap: KnowledgeGap;
  snapshotId: SnapshotId;
}): void {
  const safeInput = cloneDomainValue(input);
  validateGap(safeInput.gap, safeInput.snapshotId, undefined, undefined);
}

export function createKnowledgeGapRegistry(input: {
  snapshotId: SnapshotId;
  knownEntityIds?: readonly EntityId[];
  knownHypothesisIds?: readonly HypothesisId[];
}): KnowledgeGapRegistry {
  const safeInput = cloneDomainValue(input);
  const knownEntityIds = safeInput.knownEntityIds
    ? new Set(safeInput.knownEntityIds)
    : undefined;
  const knownHypothesisIds = safeInput.knownHypothesisIds
    ? new Set(safeInput.knownHypothesisIds)
    : undefined;
  const gaps = new Map<KnowledgeGapId, KnowledgeGap>();
  const ordered = (predicate?: (gap: KnowledgeGap) => boolean) =>
    [...gaps.values()]
      .filter((gap) => predicate?.(gap) ?? true)
      .sort((left, right) => stableCompare(left.id, right.id))
      .map(cloneDomainValue);
  const close = (id: KnowledgeGapId, status: "resolved" | "accepted_unresolved") => {
    const gap = gaps.get(id);
    if (!gap) {
      throw new InvestigationDomainError("unknown_reference", "Knowledge gap does not exist.");
    }
    if (gap.status !== "open") {
      throw new InvestigationDomainError(
        "invalid_transition",
        "Knowledge gap resolution is immutable once recorded.",
      );
    }
    const next = { ...cloneDomainValue(gap), status };
    gaps.set(id, next);
    return cloneDomainValue(next);
  };

  return {
    add(rawGap) {
      validateGap(rawGap, safeInput.snapshotId, knownEntityIds, knownHypothesisIds);
      const normalized = canonicalGap(rawGap);
      const existing = gaps.get(normalized.id);
      if (existing && !sameDomainRecord(existing, normalized)) {
        throw new InvestigationDomainError(
          "record_conflict",
          "Knowledge gap id is already associated with different content.",
          safeRecordId(normalized.id),
        );
      }
      if (!existing) gaps.set(normalized.id, normalized);
      return cloneDomainValue(existing ?? normalized);
    },
    resolve: (id) => close(id, "resolved"),
    acceptUnresolved: (id) => close(id, "accepted_unresolved"),
    get(id) {
      const gap = gaps.get(id);
      return gap ? cloneDomainValue(gap) : null;
    },
    listOpen: () => ordered((gap) => gap.status === "open"),
    listBlocking: () =>
      ordered((gap) => gap.status === "open" && gap.blocks.length > 0),
    snapshot: () => ordered(),
  };
}
