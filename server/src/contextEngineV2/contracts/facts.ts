import type { FactId, OperationId, SnapshotId } from "./ids.js";
import type { JsonObject, JsonValue } from "./json.js";
import type {
  EntityRef,
  RepositoryEntity,
  SourceLocation,
} from "./repository.js";

export type ExtractionMethod =
  | "parser"
  | "compiler_api"
  | "manifest_parser"
  | "deterministic_text"
  | "repository_metadata"
  | "derived"
  | "model_proposed";

export type FactExtractionMethod = Exclude<ExtractionMethod, "model_proposed">;

export interface ExtractionProvenance {
  extractorId: string;
  extractorVersion: string;
  method: FactExtractionMethod;
  observedAt: string;
  parentFactIds?: FactId[];
  operationId?: OperationId;
}

export type LiteralValue =
  | { type: "string"; value: string }
  | { type: "number"; value: number }
  | { type: "boolean"; value: boolean }
  | { type: "null"; value: null }
  | { type: "json"; value: JsonValue };

export type FactStrength = "exact" | "strong" | "supporting" | "weak";
export type FactStatus = "active" | "superseded" | "invalidated";
export type FactPredicate = string;

interface FactRecordBase {
  id: FactId;
  snapshotId: SnapshotId;
  subject: EntityRef;
  predicate: FactPredicate;
  source: SourceLocation;
  provenance: ExtractionProvenance;
  strength: FactStrength;
  status: FactStatus;
  attributes: JsonObject;
}

export interface RepositoryFact extends FactRecordBase {
  kind: "fact";
  object: LiteralValue;
}

export interface RepositoryRelation extends FactRecordBase {
  kind: "relation";
  object: RepositoryEntity;
}

export type FactRecord = RepositoryFact | RepositoryRelation;
