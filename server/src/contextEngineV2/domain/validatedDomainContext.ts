import type {
  EvidenceRecord,
  FactRecord,
  RepositoryEntity,
  RepositorySnapshot,
  SnapshotId,
} from "../contracts/index.js";
import {
  assertEntityEvaluationConsistency,
  assertEvidenceEvaluationConsistency,
  assertFactEvaluationConsistency,
} from "./evaluationInvariants.js";
import {
  InvariantViolationError,
  assertEvidenceSnapshotConsistency,
  assertFactSnapshotConsistency,
} from "./invariant.js";
import { assertRepositoryEntitySnapshotConsistency } from "./knowledgeGraphInvariant.js";
import {
  InvestigationDomainError,
  cloneDomainValue,
  safeRecordId,
  sameDomainRecord,
  stableCompare,
} from "./investigationDomainSupport.js";

export interface ValidatedDomainContextMetrics {
  entityValidations: number;
  factValidations: number;
  evidenceValidations: number;
  compatibleRecordsReused: number;
}

export interface ValidatedDomainContextExtension {
  entities?: readonly RepositoryEntity[];
  facts?: readonly FactRecord[];
  evidence?: readonly EvidenceRecord[];
}

export interface ValidatedDomainContext {
  readonly snapshotId: SnapshotId;
  readonly entities: readonly RepositoryEntity[];
  readonly facts: readonly FactRecord[];
  readonly evidence: readonly EvidenceRecord[];
  readonly entitiesById: ReadonlyMap<RepositoryEntity["id"], RepositoryEntity>;
  readonly factsById: ReadonlyMap<FactRecord["id"], FactRecord>;
  readonly evidenceById: ReadonlyMap<EvidenceRecord["id"], EvidenceRecord>;
  extend(input: ValidatedDomainContextExtension, checkpoint?: () => void): ValidatedDomainContext;
  assertCanonical(input: {
    entities?: readonly RepositoryEntity[];
    facts?: readonly FactRecord[];
    evidence?: readonly EvidenceRecord[];
  }): void;
  assertCanonicalFactMembers(records: readonly FactRecord[]): void;
  assertCanonicalEvidenceMembers(records: readonly EvidenceRecord[]): void;
  metrics(): Readonly<ValidatedDomainContextMetrics>;
}

interface MutableMetrics extends ValidatedDomainContextMetrics {}

class ReadonlyIndex<K, V> implements ReadonlyMap<K, V> {
  constructor(private readonly valuesByKey: Map<K, V>) {
    Object.freeze(this);
  }

  get size(): number {
    return this.valuesByKey.size;
  }

  get(key: K): V | undefined {
    return this.valuesByKey.get(key);
  }

  has(key: K): boolean {
    return this.valuesByKey.has(key);
  }

  entries(): MapIterator<[K, V]> {
    return this.valuesByKey.entries();
  }

  keys(): MapIterator<K> {
    return this.valuesByKey.keys();
  }

  values(): MapIterator<V> {
    return this.valuesByKey.values();
  }

  forEach(callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown): void {
    for (const [key, value] of this.valuesByKey) callbackfn.call(thisArg, value, key, this);
  }

  [Symbol.iterator](): MapIterator<[K, V]> {
    return this.entries();
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  return Object.freeze(value);
}

function sortedValues<T extends { id: string }>(records: ReadonlyMap<T["id"], T>): readonly T[] {
  return Object.freeze(
    [...records.values()].sort((left, right) => stableCompare(left.id, right.id)),
  );
}

function indexCanonicalValues<T extends { id: string }>(
  records: readonly T[],
): Map<T["id"], T> {
  return new Map(records.map((record) => [record.id, record]));
}

function invariantError(
  error: InvariantViolationError,
  label: string,
  recordId: unknown,
): InvestigationDomainError {
  return new InvestigationDomainError(
    error.issues.some((issue) => issue.code === "unknown_reference")
      ? "unknown_reference"
      : error.issues.some((issue) => issue.code === "snapshot_mismatch")
        ? "snapshot_mismatch"
        : "invalid_record",
    `${label} failed active snapshot consistency validation.`,
    safeRecordId(recordId),
  );
}

function addRecord<T extends { id: string }>(
  records: Map<T["id"], T>,
  candidate: T,
  label: string,
  metrics: MutableMetrics,
): void {
  const existing = records.get(candidate.id);
  if (existing && !sameDomainRecord(existing, candidate)) {
    throw new InvestigationDomainError(
      "record_conflict",
      `${label} id has conflicting context records.`,
      safeRecordId(candidate.id),
    );
  }
  if (existing) {
    metrics.compatibleRecordsReused += 1;
    return;
  }
  records.set(candidate.id, deepFreeze(candidate));
}

class ValidatedDomainContextImpl implements ValidatedDomainContext {
  readonly entities: readonly RepositoryEntity[];
  readonly facts: readonly FactRecord[];
  readonly evidence: readonly EvidenceRecord[];
  readonly entitiesById: ReadonlyMap<RepositoryEntity["id"], RepositoryEntity>;
  readonly factsById: ReadonlyMap<FactRecord["id"], FactRecord>;
  readonly evidenceById: ReadonlyMap<EvidenceRecord["id"], EvidenceRecord>;
  private readonly canonicalFacts: ReadonlySet<FactRecord>;
  private readonly canonicalEvidence: ReadonlySet<EvidenceRecord>;
  private readonly counters: Readonly<MutableMetrics>;

  constructor(
    readonly snapshotId: SnapshotId,
    private readonly snapshot: RepositorySnapshot,
    private readonly entityRecords: Map<RepositoryEntity["id"], RepositoryEntity>,
    private readonly factRecords: Map<FactRecord["id"], FactRecord>,
    private readonly evidenceRecords: Map<EvidenceRecord["id"], EvidenceRecord>,
    counters: MutableMetrics,
  ) {
    this.entities = sortedValues(entityRecords);
    this.facts = sortedValues(factRecords);
    this.evidence = sortedValues(evidenceRecords);
    this.entitiesById = new ReadonlyIndex(indexCanonicalValues(this.entities));
    this.factsById = new ReadonlyIndex(indexCanonicalValues(this.facts));
    this.evidenceById = new ReadonlyIndex(indexCanonicalValues(this.evidence));
    this.canonicalFacts = new Set(this.facts);
    this.canonicalEvidence = new Set(this.evidence);
    this.counters = Object.freeze({ ...counters });
    Object.freeze(this);
  }

  extend(input: ValidatedDomainContextExtension, checkpoint?: () => void): ValidatedDomainContext {
    const entities = new Map(this.entityRecords);
    const facts = new Map(this.factRecords);
    const evidence = new Map(this.evidenceRecords);
    const counters: MutableMetrics = { ...this.counters };

    for (const rawEntity of input.entities ?? []) {
      checkpoint?.();
      const entity = cloneDomainValue(rawEntity);
      assertEntityEvaluationConsistency({ entity, snapshotId: this.snapshotId });
      try {
        assertRepositoryEntitySnapshotConsistency(entity, this.snapshot);
      } catch (error) {
        if (error instanceof InvariantViolationError) {
          throw invariantError(error, "Repository entity", entity.id);
        }
        throw error;
      }
      counters.entityValidations += 1;
      addRecord(entities, entity, "Repository entity", counters);
    }

    for (const rawFact of input.facts ?? []) {
      checkpoint?.();
      const fact = cloneDomainValue(rawFact);
      assertFactEvaluationConsistency({ fact, snapshotId: this.snapshotId });
      try {
        assertFactSnapshotConsistency(fact, this.snapshot);
      } catch (error) {
        if (error instanceof InvariantViolationError) {
          throw invariantError(error, "Fact", fact.id);
        }
        throw error;
      }
      counters.factValidations += 1;
      addRecord(facts, fact, "Fact", counters);
    }

    const canonicalFacts = sortedValues(facts);
    for (const rawEvidence of input.evidence ?? []) {
      checkpoint?.();
      const record = cloneDomainValue(rawEvidence);
      assertEvidenceEvaluationConsistency({
        evidence: record,
        snapshotId: this.snapshotId,
      }, checkpoint);
      try {
        assertEvidenceSnapshotConsistency(record, canonicalFacts, this.snapshot);
      } catch (error) {
        if (error instanceof InvariantViolationError) {
          throw invariantError(error, "Evidence", record.id);
        }
        throw error;
      }
      counters.evidenceValidations += 1;
      addRecord(evidence, record, "Evidence", counters);
    }

    return new ValidatedDomainContextImpl(
      this.snapshotId,
      this.snapshot,
      entities,
      facts,
      evidence,
      counters,
    );
  }

  assertCanonical(input: {
    entities?: readonly RepositoryEntity[];
    facts?: readonly FactRecord[];
    evidence?: readonly EvidenceRecord[];
  }): void {
    if (
      (input.entities !== undefined && input.entities !== this.entities) ||
      (input.facts !== undefined && input.facts !== this.facts) ||
      (input.evidence !== undefined && input.evidence !== this.evidence)
    ) {
      throw new InvestigationDomainError(
        "invalid_record",
        "Validated domain context cannot be reused for non-canonical records.",
      );
    }
  }

  assertCanonicalFactMembers(records: readonly FactRecord[]): void {
    if (records.some((record) => !this.canonicalFacts.has(record))) {
      throw new InvestigationDomainError(
        "invalid_record",
        "Validated fact context cannot be reused for non-canonical records.",
      );
    }
  }

  assertCanonicalEvidenceMembers(records: readonly EvidenceRecord[]): void {
    if (records.some((record) => !this.canonicalEvidence.has(record))) {
      throw new InvestigationDomainError(
        "invalid_record",
        "Validated evidence context cannot be reused for non-canonical records.",
      );
    }
  }

  metrics(): Readonly<ValidatedDomainContextMetrics> {
    return Object.freeze({ ...this.counters });
  }
}

export function assertValidatedDomainContext(
  value: unknown,
): asserts value is ValidatedDomainContext {
  if (!(value instanceof ValidatedDomainContextImpl)) {
    throw new InvestigationDomainError(
      "invalid_record",
      "Validated domain context provenance is not authentic.",
    );
  }
}

export function createValidatedDomainContext(input: {
  snapshot: RepositorySnapshot;
  entities?: readonly RepositoryEntity[];
  facts?: readonly FactRecord[];
  evidence?: readonly EvidenceRecord[];
}, checkpoint?: () => void): ValidatedDomainContext {
  const snapshot = deepFreeze(cloneDomainValue(input.snapshot));
  const counters: MutableMetrics = {
    entityValidations: 0,
    factValidations: 0,
    evidenceValidations: 0,
    compatibleRecordsReused: 0,
  };
  const empty = new ValidatedDomainContextImpl(
    snapshot.id,
    snapshot,
    new Map<RepositoryEntity["id"], RepositoryEntity>(),
    new Map<FactRecord["id"], FactRecord>(),
    new Map<EvidenceRecord["id"], EvidenceRecord>(),
    counters,
  );
  return empty.extend({
    entities: input.entities ?? [],
    facts: input.facts ?? [],
    evidence: input.evidence ?? [],
  }, checkpoint);
}
