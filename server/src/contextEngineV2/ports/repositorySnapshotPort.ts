import type {
  RepositorySnapshot,
  SnapshotId,
} from "../contracts/index.js";

export interface SnapshotRequest {
  projectId: string;
  rootUri: string;
}

export interface RepositorySnapshotPort {
  createSnapshot(request: SnapshotRequest): Promise<RepositorySnapshot>;
  getSnapshot(id: SnapshotId): Promise<RepositorySnapshot | null>;
}
