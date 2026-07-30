import type {
  EntityId,
  FactId,
  FactRecord,
  RepositoryEntity,
  RepositorySnapshot,
  SnapshotId,
} from "../../contracts/index.js";
import {
  InvariantViolationError,
  assertFactSnapshotConsistency,
  assertRepositoryEntitySnapshotConsistency,
  validateRepositorySnapshot,
} from "../../domain/index.js";
import {
  assertDescriptorSafeFactRecord,
  assertDescriptorSafeRepositoryEntityRecord,
} from "../../domain/rawRecordPreflight.js";
import { isSecretLikeSemanticLiteral } from "../../domain/semanticLiteralSafety.js";
import type {
  FactQuery,
  KnowledgeEdge,
  KnowledgeGraphStorePort,
  NeighborQuery,
} from "../../ports/index.js";

export type KnowledgeGraphStoreErrorCode =
  | "snapshot_not_started"
  | "record_conflict"
  | "snapshot_mismatch"
  | "unknown_entity"
  | "unknown_fact"
  | "invalid_record";

export class KnowledgeGraphStoreError extends Error {
  readonly stage = "CE2-02" as const;

  constructor(
    readonly code: KnowledgeGraphStoreErrorCode,
    message: string,
    readonly recordId?: string,
  ) {
    super(message);
    this.name = "KnowledgeGraphStoreError";
  }
}

interface SnapshotGraph {
  snapshot: RepositorySnapshot;
  entities: Map<EntityId, RepositoryEntity>;
  facts: Map<FactId, FactRecord>;
}

const SAFE_DIAGNOSTIC_RECORD_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;

function safeErrorRecordId(value: unknown): string | undefined {
  return typeof value === "string" &&
    SAFE_DIAGNOSTIC_RECORD_ID.test(value) &&
    !isSecretLikeSemanticLiteral(value)
    ? value
    : undefined;
}

function clone<T>(value: T, recordId?: unknown): T {
  try {
    return structuredClone(value);
  } catch {
    throw new KnowledgeGraphStoreError(
      "invalid_record",
      "Knowledge record could not be cloned safely.",
      safeErrorRecordId(recordId),
    );
  }
}

function preflightEntity(
  value: unknown,
): asserts value is RepositoryEntity {
  try {
    assertDescriptorSafeRepositoryEntityRecord(value);
  } catch {
    throw new KnowledgeGraphStoreError(
      "invalid_record",
      "Knowledge entity failed descriptor-safe validation.",
    );
  }
}

function preflightFact(value: unknown): asserts value is FactRecord {
  try {
    assertDescriptorSafeFactRecord(value);
  } catch {
    throw new KnowledgeGraphStoreError(
      "invalid_record",
      "Knowledge fact failed descriptor-safe validation.",
    );
  }
}

function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (value === undefined) return '"<undefined>"';
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => stableCompare(left, right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(`<${typeof value}>`);
}

function isSameRecord(left: unknown, right: unknown): boolean {
  return stableSerialize(left) === stableSerialize(right);
}

function sortedParentIds(fact: FactRecord): string[] {
  return [...(fact.provenance.parentFactIds ?? [])].sort(stableCompare);
}

function assertDerivedFactDag(
  facts: ReadonlyMap<FactId, FactRecord>,
): void {
  const visiting = new Set<FactId>();
  const visited = new Set<FactId>();
  const visit = (fact: FactRecord): void => {
    if (visited.has(fact.id)) return;
    if (visiting.has(fact.id)) {
      throw new KnowledgeGraphStoreError(
        "invalid_record",
        "Derived fact dependencies must form an acyclic graph.",
        safeErrorRecordId(fact.id),
      );
    }
    visiting.add(fact.id);
    if (fact.provenance.method === "derived") {
      for (const parentId of fact.provenance.parentFactIds ?? []) {
        const parent = facts.get(parentId);
        if (parent) visit(parent);
      }
    }
    visiting.delete(fact.id);
    visited.add(fact.id);
  };
  for (const fact of facts.values()) visit(fact);
}

export function createInMemoryKnowledgeGraphStore(): KnowledgeGraphStorePort {
  const graphs = new Map<SnapshotId, SnapshotGraph>();

  const graphFor = (snapshotId: SnapshotId): SnapshotGraph => {
    const graph = graphs.get(snapshotId);
    if (!graph) {
      throw new KnowledgeGraphStoreError(
        "snapshot_not_started",
        "Knowledge graph snapshot has not been initialized.",
        safeErrorRecordId(snapshotId),
      );
    }
    return graph;
  };

  const findEntity = (id: EntityId): RepositoryEntity | undefined => {
    for (const graph of graphs.values()) {
      const entity = graph.entities.get(id);
      if (entity) return entity;
    }
    return undefined;
  };

  const findFact = (id: FactId): FactRecord | undefined => {
    for (const graph of graphs.values()) {
      const fact = graph.facts.get(id);
      if (fact) return fact;
    }
    return undefined;
  };

  const validateEntity = (
    entity: RepositoryEntity,
    graph: SnapshotGraph,
  ): void => {
    try {
      assertRepositoryEntitySnapshotConsistency(entity, graph.snapshot);
    } catch (error) {
      if (error instanceof InvariantViolationError) {
        throw new KnowledgeGraphStoreError(
          "invalid_record",
          error.message,
          safeErrorRecordId(entity.id),
        );
      }
      throw error;
    }
  };

  const validateRawFact = (
    fact: FactRecord,
    graph: SnapshotGraph,
  ): void => {
    try {
      assertFactSnapshotConsistency(fact, graph.snapshot);
      assertRepositoryEntitySnapshotConsistency(fact.subject, graph.snapshot);
      if (fact.kind === "relation") {
        assertRepositoryEntitySnapshotConsistency(fact.object, graph.snapshot);
      }
    } catch (error) {
      if (error instanceof InvariantViolationError) {
        throw new KnowledgeGraphStoreError(
          "invalid_record",
          error.message,
          safeErrorRecordId(fact.id),
        );
      }
      throw error;
    }
  };

  const validateFact = (
    fact: FactRecord,
    graph: SnapshotGraph,
    availableEntities: ReadonlyMap<EntityId, RepositoryEntity>,
    availableFacts: ReadonlyMap<FactId, FactRecord>,
  ): void => {
    const subject = availableEntities.get(fact.subject.id);
    if (!subject) {
      throw new KnowledgeGraphStoreError(
        "unknown_entity",
        "Fact subject does not exist in the active snapshot graph.",
        safeErrorRecordId(fact.subject.id),
      );
    }
    if (!isSameRecord(subject, fact.subject)) {
      throw new KnowledgeGraphStoreError(
        "record_conflict",
        "Fact subject conflicts with the stored entity.",
        safeErrorRecordId(fact.subject.id),
      );
    }
    if (fact.kind === "relation") {
      const object = availableEntities.get(fact.object.id);
      if (!object) {
        throw new KnowledgeGraphStoreError(
          "unknown_entity",
          "Relation object does not exist in the active snapshot graph.",
          safeErrorRecordId(fact.object.id),
        );
      }
      if (!isSameRecord(object, fact.object)) {
        throw new KnowledgeGraphStoreError(
          "record_conflict",
          "Relation object conflicts with the stored entity.",
          safeErrorRecordId(fact.object.id),
        );
      }
    }
    if (fact.provenance.method === "derived") {
      const parentIds = fact.provenance.parentFactIds ?? [];
      if (
        new Set(parentIds).size !== parentIds.length ||
        parentIds.some((id, index) => id !== sortedParentIds(fact)[index])
      ) {
        throw new KnowledgeGraphStoreError(
          "invalid_record",
          "Derived fact parent ids must be unique and deterministically sorted.",
          safeErrorRecordId(fact.id),
        );
      }
      for (const parentId of parentIds) {
        if (parentId === fact.id) {
          throw new KnowledgeGraphStoreError(
            "invalid_record",
            "Derived facts cannot reference themselves as parents.",
            safeErrorRecordId(fact.id),
          );
        }
        const parent = availableFacts.get(parentId) ?? findFact(parentId);
        if (!parent) {
          throw new KnowledgeGraphStoreError(
            "unknown_fact",
            "Derived fact references an unknown parent fact.",
            safeErrorRecordId(parentId),
          );
        }
        if (parent.snapshotId !== fact.snapshotId) {
          throw new KnowledgeGraphStoreError(
            "snapshot_mismatch",
            "Derived fact parent belongs to another snapshot.",
            safeErrorRecordId(parentId),
          );
        }
        if (parent.status !== "active") {
          throw new KnowledgeGraphStoreError(
            "invalid_record",
            "Derived fact parents must be active.",
            safeErrorRecordId(parentId),
          );
        }
      }
    }
  };

  const commitBatch = (
    snapshotId: SnapshotId,
    rawEntities: readonly RepositoryEntity[],
    rawFacts: readonly FactRecord[],
  ): void => {
    const graph = graphFor(snapshotId);
    const candidateEntities = new Map(graph.entities);
    const candidateFacts = new Map(graph.facts);

    for (const rawEntity of rawEntities) {
      preflightEntity(rawEntity);
      if (rawEntity.snapshotId !== snapshotId) {
        throw new KnowledgeGraphStoreError(
          "snapshot_mismatch",
          "Atomic entity batch belongs to another snapshot.",
          safeErrorRecordId(rawEntity.id),
        );
      }
      validateEntity(rawEntity, graph);
      const entity = clone(rawEntity, rawEntity.id);
      validateEntity(entity, graph);
      const existing = candidateEntities.get(entity.id) ?? findEntity(entity.id);
      if (existing && !isSameRecord(existing, entity)) {
        throw new KnowledgeGraphStoreError(
          "record_conflict",
          "Entity id is already associated with different content.",
          safeErrorRecordId(entity.id),
        );
      }
      candidateEntities.set(entity.id, entity);
    }

    for (const rawFact of rawFacts) {
      preflightFact(rawFact);
      if (rawFact.snapshotId !== snapshotId) {
        throw new KnowledgeGraphStoreError(
          "snapshot_mismatch",
          "Atomic fact batch belongs to another snapshot.",
          safeErrorRecordId(rawFact.id),
        );
      }
      validateRawFact(rawFact, graph);
      const fact = clone(rawFact, rawFact.id);
      validateRawFact(fact, graph);
      const existing = candidateFacts.get(fact.id) ?? findFact(fact.id);
      if (existing && !isSameRecord(existing, fact)) {
        throw new KnowledgeGraphStoreError(
          "record_conflict",
          "Fact id is already associated with different content.",
          safeErrorRecordId(fact.id),
        );
      }
      candidateFacts.set(fact.id, fact);
    }

    for (const rawFact of rawFacts) {
      const fact = candidateFacts.get(rawFact.id)!;
      validateFact(fact, graph, candidateEntities, candidateFacts);
    }
    assertDerivedFactDag(candidateFacts);

    graph.entities = candidateEntities;
    graph.facts = candidateFacts;
  };

  return {
    async beginSnapshot(snapshot) {
      const validation = validateRepositorySnapshot(snapshot);
      if (!validation.valid) {
        throw new KnowledgeGraphStoreError(
          "invalid_record",
          validation.issues
            .map((issue) => `${issue.path}: ${issue.message}`)
            .join("; "),
          safeErrorRecordId(snapshot.id),
        );
      }
      const existing = graphs.get(snapshot.id);
      if (existing) {
        if (!isSameRecord(existing.snapshot, snapshot)) {
          throw new KnowledgeGraphStoreError(
            "record_conflict",
            "Snapshot id is already associated with different content.",
            safeErrorRecordId(snapshot.id),
          );
        }
        return;
      }
      graphs.set(snapshot.id, {
        snapshot: clone(snapshot, snapshot.id),
        entities: new Map(),
        facts: new Map(),
      });
    },

    async putEntities(entities) {
      const bySnapshot = new Map<SnapshotId, RepositoryEntity[]>();
      for (const entity of entities) {
        preflightEntity(entity);
        bySnapshot.set(entity.snapshotId, [...(bySnapshot.get(entity.snapshotId) ?? []), entity]);
      }
      for (const [snapshotId, values] of bySnapshot) commitBatch(snapshotId, values, []);
    },

    async putFacts(facts) {
      const factsBySnapshot = new Map<SnapshotId, FactRecord[]>();
      for (const rawFact of facts) {
        preflightFact(rawFact);
        const group = factsBySnapshot.get(rawFact.snapshotId) ?? [];
        group.push(rawFact);
        factsBySnapshot.set(rawFact.snapshotId, group);
      }
      for (const [snapshotId, values] of factsBySnapshot) commitBatch(snapshotId, [], values);
    },

    async putBatch(batch) {
      commitBatch(batch.snapshotId, batch.entities, batch.facts);
    },

    async getEntity(id) {
      for (const snapshotId of [...graphs.keys()].sort(stableCompare)) {
        const entity = graphs.get(snapshotId)?.entities.get(id);
        if (entity) return clone(entity);
      }
      return null;
    },

    async getFacts(query: FactQuery) {
      const graph = graphFor(query.snapshotId);
      const status = query.status ?? "active";
      return [...graph.facts.values()]
        .filter(
          (fact) =>
            fact.status === status &&
            (query.predicate === undefined || fact.predicate === query.predicate) &&
            (query.subjectId === undefined || fact.subject.id === query.subjectId) &&
            (query.objectEntityId === undefined ||
              (fact.kind === "relation" && fact.object.id === query.objectEntityId)),
        )
        .sort((left, right) => stableCompare(left.id, right.id))
        .map(clone);
    },

    async getNeighbors(query: NeighborQuery): Promise<KnowledgeEdge[]> {
      const graph = graphFor(query.snapshotId);
      const status = query.status ?? "active";
      const edges: KnowledgeEdge[] = [];
      for (const fact of graph.facts.values()) {
        if (
          fact.kind !== "relation" ||
          fact.status !== status ||
          (query.predicate !== undefined && fact.predicate !== query.predicate)
        ) {
          continue;
        }
        const matches =
          query.direction === "outgoing"
            ? fact.subject.id === query.entityId
            : fact.object.id === query.entityId;
        if (!matches) continue;
        const source = graph.entities.get(fact.subject.id);
        const target = graph.entities.get(fact.object.id);
        if (!source || !target) continue;
        edges.push({ fact, direction: query.direction, source, target });
      }
      return edges
        .sort((left, right) =>
          stableCompare(
            `${left.fact.id}\0${left.source.id}\0${left.target.id}`,
            `${right.fact.id}\0${right.source.id}\0${right.target.id}`,
          ),
        )
        .map(clone);
    },

    async invalidateByFileFingerprint(
      snapshotId,
      fileId,
      previousFingerprint,
    ) {
      const graph = graphFor(snapshotId);
      if (!graph.snapshot.files.some((file) => file.id === fileId)) {
        throw new KnowledgeGraphStoreError(
          "unknown_entity",
          "Invalidation file does not exist in the snapshot.",
          safeErrorRecordId(fileId),
        );
      }
      for (const [factId, fact] of graph.facts) {
        if (
          fact.status === "active" &&
          fact.source.kind === "source_span" &&
          fact.source.fileId === fileId &&
          fact.source.contentFingerprint === previousFingerprint
        ) {
          graph.facts.set(factId, { ...clone(fact), status: "invalidated" });
        }
      }
      let changed = true;
      while (changed) {
        changed = false;
        for (const [factId, fact] of graph.facts) {
          if (
            fact.status !== "active" ||
            fact.provenance.method !== "derived" ||
            !(fact.provenance.parentFactIds ?? []).some(
              (parentId) => graph.facts.get(parentId)?.status === "invalidated",
            )
          ) {
            continue;
          }
          graph.facts.set(factId, { ...clone(fact), status: "invalidated" });
          changed = true;
        }
      }
    },

    async exportTrace(snapshotId) {
      const graph = graphFor(snapshotId);
      return {
        snapshotId,
        entities: [...graph.entities.values()]
          .sort((left, right) => stableCompare(left.id, right.id))
          .map(clone),
        facts: [...graph.facts.values()]
          .sort((left, right) => stableCompare(left.id, right.id))
          .map(clone),
      };
    },
  };
}
