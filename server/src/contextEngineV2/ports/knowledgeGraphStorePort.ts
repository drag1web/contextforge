import type {
  EntityId,
  FactPredicate,
  FactRecord,
  FactStatus,
  RepositoryEntity,
  RepositorySnapshot,
  SnapshotId,
} from "../contracts/index.js";

export interface FactQuery {
  snapshotId: SnapshotId;
  predicate?: FactPredicate;
  subjectId?: EntityId;
  objectEntityId?: EntityId;
  status?: FactStatus;
}

export interface NeighborQuery {
  snapshotId: SnapshotId;
  entityId: EntityId;
  direction: "outgoing" | "incoming";
  predicate?: FactPredicate;
  status?: FactStatus;
}

export interface KnowledgeEdge {
  fact: FactRecord;
  direction: "outgoing" | "incoming";
  source: RepositoryEntity;
  target: RepositoryEntity;
}

export interface KnowledgeTraceExport {
  snapshotId: SnapshotId;
  entities: RepositoryEntity[];
  facts: FactRecord[];
}

export interface KnowledgeGraphBatch {
  snapshotId: SnapshotId;
  entities: RepositoryEntity[];
  facts: FactRecord[];
}

export interface KnowledgeGraphStorePort {
  beginSnapshot(snapshot: RepositorySnapshot): Promise<void>;
  putEntities(entities: RepositoryEntity[]): Promise<void>;
  putFacts(facts: FactRecord[]): Promise<void>;
  putBatch(batch: KnowledgeGraphBatch): Promise<void>;
  getEntity(id: EntityId): Promise<RepositoryEntity | null>;
  getFacts(query: FactQuery): Promise<FactRecord[]>;
  getNeighbors(query: NeighborQuery): Promise<KnowledgeEdge[]>;
  invalidateByFileFingerprint(
    snapshotId: SnapshotId,
    fileId: EntityId,
    previousFingerprint: string,
  ): Promise<void>;
  exportTrace(snapshotId: SnapshotId): Promise<KnowledgeTraceExport>;
}
