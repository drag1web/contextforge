import type {
  EntityId,
  SnapshotId,
} from "../contracts/index.js";

export interface ReadFileRequest {
  snapshotId: SnapshotId;
  fileId: EntityId;
  path: string;
  expectedFingerprint: string;
  maxBytes: number;
}

export interface ReadRangeRequest extends ReadFileRequest {
  startLine: number;
  endLine: number;
}

export interface RepositoryReadSuccess {
  status: "success";
  snapshotId: SnapshotId;
  fileId: EntityId;
  path: string;
  content: string;
  contentFingerprint: string;
  bytesRead: number;
  startLine: number;
  endLine: number;
}

export interface RepositoryReadFailure {
  status: "failure";
  snapshotId: SnapshotId;
  fileId: EntityId;
  path: string;
  reason:
    | "not_found"
    | "unreadable"
    | "binary"
    | "restricted"
    | "fingerprint_mismatch"
    | "range_invalid"
    | "byte_limit";
  message: string;
  retryable?: boolean;
}

export type RepositoryReadResult =
  | RepositoryReadSuccess
  | RepositoryReadFailure;

export interface RepositoryReaderPort {
  readFile(request: ReadFileRequest): Promise<RepositoryReadResult>;
  readRange(request: ReadRangeRequest): Promise<RepositoryReadResult>;
}
