import type { EntityId, SnapshotId } from "./ids.js";
import type { JsonObject } from "./json.js";

export type SnapshotSource =
  | "legacy_inventory_adapter"
  | "local_repository"
  | "remote_repository"
  | "test_fixture";

export interface SnapshotLimits {
  maxFiles?: number;
  maxBytes?: number;
  excludedPatterns: string[];
}

export type SnapshotTruncationReason =
  | "file_limit"
  | "byte_limit"
  | "permission_denied"
  | "unsupported_source"
  | "adapter_limit";

export interface SnapshotTruncation {
  truncated: boolean;
  reasons: SnapshotTruncationReason[];
  omittedPathCount?: number;
}

export type FileKind =
  | "source"
  | "test"
  | "configuration"
  | "documentation"
  | "asset"
  | "generated"
  | "data"
  | "unknown";

export interface FileDescriptor {
  id: EntityId;
  snapshotId: SnapshotId;
  path: string;
  normalizedPath: string;
  extension: string | null;
  language: string | null;
  kind: FileKind;
  sizeBytes: number;
  contentFingerprint: string;
  readable: boolean;
  generated: boolean;
  secretRisk: "none" | "possible" | "known";
  attributes: JsonObject;
}

export interface RepositorySnapshot {
  id: SnapshotId;
  projectId: string;
  rootUri: string;
  rootFingerprint: string;
  createdAt: string;
  source: SnapshotSource;
  files: FileDescriptor[];
  limits: SnapshotLimits;
  truncation: SnapshotTruncation;
  metadata: JsonObject;
}

export type EntityKind =
  | "repository"
  | "file"
  | "directory"
  | "module"
  | "symbol"
  | "function"
  | "class"
  | "interface"
  | "type"
  | "component"
  | "route"
  | "endpoint"
  | "configuration_key"
  | "database_entity"
  | "state_store"
  | "event"
  | "test_case"
  | "external_dependency"
  | "literal"
  | "unknown";

export interface RepositoryEntity {
  id: EntityId;
  snapshotId: SnapshotId;
  kind: EntityKind;
  displayName: string;
  canonicalName?: string;
  fileId?: EntityId;
  attributes?: JsonObject;
}

export type EntityRef = RepositoryEntity;

export interface SourceSpan {
  kind: "source_span";
  snapshotId: SnapshotId;
  fileId: EntityId;
  path: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  contentFingerprint: string;
  excerptHash?: string;
}

export interface RepositoryMetadataSource {
  kind: "repository_metadata";
  snapshotId: SnapshotId;
  reference: string;
  fingerprint: string;
}

export type SourceLocation = SourceSpan | RepositoryMetadataSource;
