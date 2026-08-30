import type {
  EvidenceRecord,
  FactRecord,
  RepositoryEntity,
  SnapshotId,
  SourceSpan,
} from "../contracts/index.js";
import { isJsonSafeValue, isRepositoryRelativePath } from "./invariant.js";
import { assertDescriptorSafeFactRecord } from "./rawRecordPreflight.js";
import { containsSecretLikeSemanticValue } from "./semanticLiteralSafety.js";
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
  stableCompare,
  stableSerialize,
} from "./investigationDomainSupport.js";

const ENTITY_FIELDS = [
  "id",
  "snapshotId",
  "kind",
  "displayName",
  "canonicalName",
  "fileId",
  "attributes",
] as const;
const ENTITY_KINDS = new Set([
  "repository", "file", "directory", "module", "symbol", "function",
  "class", "interface", "type", "component", "route", "endpoint",
  "configuration_key", "database_entity", "state_store", "event",
  "test_case", "external_dependency", "literal", "unknown",
]);
const FACT_FIELDS = [
  "kind", "id", "snapshotId", "subject", "predicate", "object", "source",
  "provenance", "strength", "status", "attributes",
] as const;
const SOURCE_SPAN_FIELDS = [
  "kind", "snapshotId", "fileId", "path", "startLine", "startColumn",
  "endLine", "endColumn", "contentFingerprint", "excerptHash",
] as const;
const METADATA_SOURCE_FIELDS = [
  "kind", "snapshotId", "reference", "fingerprint",
] as const;
const PROVENANCE_FIELDS = [
  "extractorId", "extractorVersion", "method", "observedAt",
  "parentFactIds", "operationId",
] as const;
const LITERAL_FIELDS = ["type", "value"] as const;
const FACT_METHODS = new Set([
  "parser", "compiler_api", "manifest_parser", "deterministic_text",
  "repository_metadata", "derived",
]);
const FACT_STRENGTHS = new Set(["exact", "strong", "supporting", "weak"]);
const FACT_STATUSES = new Set(["active", "superseded", "invalidated"]);
const SHA256_FINGERPRINT = /^sha256:[0-9a-f]{64}$/u;

const EVIDENCE_FIELDS = [
  "id", "snapshotId", "claimId", "role", "factIds", "sourceSpans",
  "summary", "strength", "independenceGroup", "freshness", "limitations",
] as const;
const FRESHNESS_FIELDS = ["snapshotId", "current", "reason"] as const;
const EVIDENCE_ROLES = new Set(["supports", "contradicts", "context_only"]);
const EVIDENCE_STRENGTHS = new Set([
  "conclusive", "substantial", "corroborating", "lead",
]);
const FRESHNESS_REASONS = new Set([
  "snapshot_match", "fingerprint_match", "stale", "unknown",
]);

function assertJsonObject(value: unknown, label: string): void {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !isJsonSafeValue(value) ||
    containsSecretLikeSemanticValue(value)
  ) {
    throw new InvestigationDomainError(
      "invalid_record",
      `${label} must be a JSON-safe privacy-safe object.`,
    );
  }
}

export function assertEntityEvaluationConsistency(input: {
  entity: RepositoryEntity;
  snapshotId: SnapshotId;
}): void {
  const { entity, snapshotId } = cloneDomainValue(input);
  assertClosedRecord(
    entity,
    ENTITY_FIELDS,
    ["id", "snapshotId", "kind", "displayName"],
    "Repository entity",
  );
  assertPortableIdentifier(entity.id, "Repository entity id");
  assertPortableIdentifier(entity.snapshotId, "Repository entity snapshot id");
  if (entity.snapshotId !== snapshotId) {
    throw new InvestigationDomainError(
      "snapshot_mismatch",
      "Repository entity belongs to another snapshot.",
      safeRecordId(entity.id),
    );
  }
  if (!ENTITY_KINDS.has(entity.kind)) {
    throw new InvestigationDomainError(
      "invalid_record",
      "Repository entity kind is not supported.",
    );
  }
  assertSafeText(entity.displayName, "Repository entity display name");
  if (entity.canonicalName !== undefined) {
    assertSafeText(entity.canonicalName, "Repository entity canonical name");
  }
  if (entity.fileId !== undefined) {
    assertPortableIdentifier(entity.fileId, "Repository entity file id");
  }
  if (entity.attributes !== undefined) {
    assertJsonObject(entity.attributes, "Repository entity attributes");
  }
  if (containsSecretLikeSemanticValue(entity)) {
    throw new InvestigationDomainError(
      "invalid_record",
      "Repository entity contains unsafe semantic data.",
    );
  }
}

export function assertSourceSpanEvaluationConsistency(input: {
  span: SourceSpan;
  snapshotId: SnapshotId;
}): void {
  const { span, snapshotId } = cloneDomainValue(input);
  assertClosedRecord(
    span,
    SOURCE_SPAN_FIELDS,
    SOURCE_SPAN_FIELDS.filter((field) => field !== "excerptHash"),
    "Source span",
  );
  if (span.kind !== "source_span" || span.snapshotId !== snapshotId) {
    throw new InvestigationDomainError(
      span.snapshotId !== snapshotId ? "snapshot_mismatch" : "invalid_record",
      "Source span kind or snapshot is invalid.",
    );
  }
  assertPortableIdentifier(span.fileId, "Source span file id");
  assertSafeText(span.path, "Source span path");
  if (!isRepositoryRelativePath(span.path)) {
    throw new InvestigationDomainError(
      "invalid_record",
      "Source span path must be a normalized repository-relative POSIX path.",
    );
  }
  assertSafeText(span.contentFingerprint, "Source span fingerprint");
  const coordinates = [
    span.startLine, span.startColumn, span.endLine, span.endColumn,
  ];
  if (
    coordinates.some((value) => !Number.isSafeInteger(value) || value < 1) ||
    span.endLine < span.startLine ||
    (span.endLine === span.startLine && span.endColumn < span.startColumn)
  ) {
    throw new InvestigationDomainError("invalid_record", "Source span range is invalid.");
  }
  if (
    span.excerptHash !== undefined &&
    !SHA256_FINGERPRINT.test(span.excerptHash)
  ) {
    throw new InvestigationDomainError("invalid_record", "Source span excerpt hash is invalid.");
  }
}

function assertLiteral(value: FactRecord["object"]): void {
  assertClosedRecord(value, LITERAL_FIELDS, LITERAL_FIELDS, "Fact literal");
  const raw = value as { type: unknown; value: unknown };
  const valid =
    (raw.type === "string" && typeof raw.value === "string") ||
    (raw.type === "number" && typeof raw.value === "number" && Number.isFinite(raw.value)) ||
    (raw.type === "boolean" && typeof raw.value === "boolean") ||
    (raw.type === "null" && raw.value === null) ||
    (raw.type === "json" && isJsonSafeValue(raw.value));
  if (!valid || containsSecretLikeSemanticValue(raw)) {
    throw new InvestigationDomainError(
      "invalid_record",
      "Fact literal is malformed or unsafe.",
    );
  }
}

export function assertFactEvaluationConsistency(input: {
  fact: FactRecord;
  snapshotId: SnapshotId;
}): void {
  try {
    assertDescriptorSafeFactRecord(input.fact);
  } catch {
    throw new InvestigationDomainError(
      "invalid_record",
      "Fact failed descriptor-safe runtime validation.",
    );
  }
  const { fact, snapshotId } = cloneDomainValue(input);
  assertClosedRecord(fact, FACT_FIELDS, FACT_FIELDS, "Fact record");
  if (fact.kind !== "fact" && fact.kind !== "relation") {
    throw new InvestigationDomainError("invalid_record", "Fact kind is not supported.");
  }
  assertPortableIdentifier(fact.id, "Fact id");
  assertPortableIdentifier(fact.snapshotId, "Fact snapshot id");
  if (fact.snapshotId !== snapshotId) {
    throw new InvestigationDomainError("snapshot_mismatch", "Fact belongs to another snapshot.");
  }
  assertEntityEvaluationConsistency({ entity: fact.subject, snapshotId });
  assertSafeText(fact.predicate, "Fact predicate");
  if (fact.kind === "relation") {
    assertEntityEvaluationConsistency({ entity: fact.object, snapshotId });
  } else {
    assertLiteral(fact.object);
  }
  if (fact.source.kind === "source_span") {
    assertSourceSpanEvaluationConsistency({ span: fact.source, snapshotId });
  } else if (fact.source.kind === "repository_metadata") {
    assertClosedRecord(
      fact.source,
      METADATA_SOURCE_FIELDS,
      METADATA_SOURCE_FIELDS,
      "Repository metadata source",
    );
    if (fact.source.snapshotId !== snapshotId) {
      throw new InvestigationDomainError("snapshot_mismatch", "Fact source belongs to another snapshot.");
    }
    assertSafeText(fact.source.reference, "Repository metadata reference");
    assertSafeText(fact.source.fingerprint, "Repository metadata fingerprint");
    if (containsSecretLikeSemanticValue(fact.source)) {
      throw new InvestigationDomainError("invalid_record", "Fact source contains unsafe semantic data.");
    }
  } else {
    throw new InvestigationDomainError("invalid_record", "Fact source kind is not supported.");
  }
  assertClosedRecord(
    fact.provenance,
    PROVENANCE_FIELDS,
    ["extractorId", "extractorVersion", "method", "observedAt"],
    "Fact provenance",
  );
  assertPortableIdentifier(fact.provenance.extractorId, "Fact extractor id");
  assertPortableIdentifier(fact.provenance.extractorVersion, "Fact extractor version");
  if (!FACT_METHODS.has(fact.provenance.method)) {
    throw new InvestigationDomainError("invalid_record", "Fact extraction method is not supported.");
  }
  assertCanonicalUtcTimestamp(fact.provenance.observedAt, "Fact observedAt");
  if (fact.provenance.operationId !== undefined) {
    assertPortableIdentifier(fact.provenance.operationId, "Fact operation id");
  }
  if (fact.provenance.parentFactIds !== undefined) {
    assertSortedUniqueStrings(fact.provenance.parentFactIds, "Fact parent ids");
    fact.provenance.parentFactIds.forEach((id) => assertPortableIdentifier(id, "Fact parent id"));
  }
  if (
    fact.provenance.method === "derived" &&
    (!fact.provenance.parentFactIds || fact.provenance.parentFactIds.length === 0)
  ) {
    throw new InvestigationDomainError("invalid_record", "Derived fact requires parent fact ids.");
  }
  if (
    fact.provenance.parentFactIds?.includes(fact.id) ||
    (fact.provenance.method !== "derived" && fact.provenance.parentFactIds !== undefined)
  ) {
    throw new InvestigationDomainError("invalid_record", "Fact parent semantics are invalid.");
  }
  if (!FACT_STRENGTHS.has(fact.strength) || !FACT_STATUSES.has(fact.status)) {
    throw new InvestigationDomainError("invalid_record", "Fact strength or status is not supported.");
  }
  assertJsonObject(fact.attributes, "Fact attributes");
  if (containsSecretLikeSemanticValue(fact)) {
    throw new InvestigationDomainError("invalid_record", "Fact contains unsafe semantic data.");
  }
}

export function assertEvidenceEvaluationConsistency(input: {
  evidence: EvidenceRecord;
  snapshotId: SnapshotId;
  facts?: readonly FactRecord[];
}, checkpoint?: () => void): void {
  checkpoint?.();
  const { evidence, snapshotId, facts } = cloneDomainValue(input);
  assertClosedRecord(
    evidence,
    EVIDENCE_FIELDS,
    EVIDENCE_FIELDS.filter((field) => field !== "claimId"),
    "Evidence record",
  );
  assertPortableIdentifier(evidence.id, "Evidence id");
  assertPortableIdentifier(evidence.snapshotId, "Evidence snapshot id");
  if (evidence.snapshotId !== snapshotId) {
    throw new InvestigationDomainError("snapshot_mismatch", "Evidence belongs to another snapshot.");
  }
  if (evidence.claimId !== undefined) assertPortableIdentifier(evidence.claimId, "Evidence claim id");
  if (!EVIDENCE_ROLES.has(evidence.role) || !EVIDENCE_STRENGTHS.has(evidence.strength)) {
    throw new InvestigationDomainError("invalid_record", "Evidence role or strength is not supported.");
  }
  assertSafeText(evidence.summary, "Evidence summary");
  assertSafeText(evidence.independenceGroup, "Evidence independence group");
  assertSortedUniqueStrings(evidence.factIds, "Evidence fact ids");
  evidence.factIds.forEach((id) => assertPortableIdentifier(id, "Evidence fact id"));
  assertSortedUniqueStrings(evidence.limitations, "Evidence limitations");
  evidence.limitations.forEach((value) => assertSafeText(value, "Evidence limitation"));
  if (!Array.isArray(evidence.sourceSpans)) {
    throw new InvestigationDomainError("invalid_record", "Evidence source spans must be an array.");
  }
  evidence.sourceSpans.forEach((span) => assertSourceSpanEvaluationConsistency({ span, snapshotId }));
  const spanKeys = evidence.sourceSpans.map(stableSerialize);
  const sortedSpanKeys = [...spanKeys].sort(stableCompare);
  if (
    new Set(spanKeys).size !== spanKeys.length ||
    spanKeys.some((key, index) => key !== sortedSpanKeys[index])
  ) {
    throw new InvestigationDomainError("invalid_record", "Evidence source spans must be unique and sorted.");
  }
  if (evidence.factIds.length === 0 && evidence.sourceSpans.length === 0) {
    throw new InvestigationDomainError("invalid_record", "Evidence requires a fact or source span basis.");
  }
  assertClosedRecord(
    evidence.freshness,
    FRESHNESS_FIELDS,
    ["snapshotId", "current"],
    "Evidence freshness",
  );
  if (
    evidence.freshness.snapshotId !== snapshotId ||
    typeof evidence.freshness.current !== "boolean" ||
    (evidence.freshness.reason !== undefined && !FRESHNESS_REASONS.has(evidence.freshness.reason))
  ) {
    throw new InvestigationDomainError("invalid_record", "Evidence freshness is malformed.");
  }
  const currentReason =
    evidence.freshness.reason === "snapshot_match" ||
    evidence.freshness.reason === "fingerprint_match";
  if (
    (evidence.freshness.current && !currentReason) ||
    (!evidence.freshness.current && currentReason)
  ) {
    throw new InvestigationDomainError("invalid_record", "Evidence freshness flags are inconsistent.");
  }
  if (containsSecretLikeSemanticValue(evidence)) {
    throw new InvestigationDomainError("invalid_record", "Evidence contains unsafe semantic data.");
  }
  if (facts !== undefined) {
    const factsById = indexDomainRecordsById(facts, "Evidence evaluation fact");
    for (const fact of factsById.values()) {
      checkpoint?.();
      assertFactEvaluationConsistency({ fact, snapshotId });
    }
    for (const factId of evidence.factIds) {
      checkpoint?.();
      if (!factsById.has(factId)) {
        throw new InvestigationDomainError(
          "unknown_reference",
          "Evidence references an unknown fact.",
          safeRecordId(evidence.id),
        );
      }
    }
  }
}

export function hasActiveEvidenceBasis(
  evidence: EvidenceRecord,
  factsById: ReadonlyMap<FactRecord["id"], FactRecord>,
): boolean {
  if (evidence.factIds.length === 0) {
    return evidence.sourceSpans.length > 0;
  }
  return evidence.factIds.some(
    (factId) => factsById.get(factId)?.status === "active",
  );
}
