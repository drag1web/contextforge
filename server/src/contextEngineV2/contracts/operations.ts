import type {
  EntityId,
  EvidenceId,
  FactId,
  HypothesisId,
  OperationId,
  QuestionId,
} from "./ids.js";

export type InvestigationOperationType =
  | "search_paths"
  | "search_text"
  | "search_symbols"
  | "read_file"
  | "read_range"
  | "parse_file"
  | "follow_relationship"
  | "inspect_manifest"
  | "inspect_git_context"
  | "evaluate_absence";

export interface OperationCost {
  operations: number;
  fileReads: number;
  fileBytes: number;
  parsedFiles: number;
  relationshipHops: number;
  plannerRounds: number;
  wallTimeMs: number;
}

interface InvestigationOperationBase {
  id: OperationId;
  type: InvestigationOperationType;
  reason: string;
  questionIds: QuestionId[];
  hypothesisIds: HypothesisId[];
  priority: number;
  estimatedCost: OperationCost;
  deduplicationKey: string;
  safetyClassification: "safe" | "restricted" | "blocked";
}

export interface SearchPathsOperation extends InvestigationOperationBase {
  type: "search_paths";
  query: string;
}

export interface SearchTextOperation extends InvestigationOperationBase {
  type: "search_text";
  query: string;
}

export interface SearchSymbolsOperation extends InvestigationOperationBase {
  type: "search_symbols";
  query: string;
}

export interface ReadFileOperation extends InvestigationOperationBase {
  type: "read_file";
  path: string;
}

export interface ReadRangeOperation extends InvestigationOperationBase {
  type: "read_range";
  path: string;
  startLine: number;
  endLine: number;
}

export interface ParseFileOperation extends InvestigationOperationBase {
  type: "parse_file";
  path: string;
}

export interface FollowRelationshipOperation
  extends InvestigationOperationBase {
  type: "follow_relationship";
  fromEntityId: EntityId;
  predicates: string[];
  maxHops: number;
}

export interface InspectManifestOperation extends InvestigationOperationBase {
  type: "inspect_manifest";
  path: string;
}

export interface InspectGitContextOperation extends InvestigationOperationBase {
  type: "inspect_git_context";
  paths: string[];
}

export interface EvaluateAbsenceOperation extends InvestigationOperationBase {
  type: "evaluate_absence";
  query: string;
  scopes: string[];
}

export type InvestigationOperation =
  | SearchPathsOperation
  | SearchTextOperation
  | SearchSymbolsOperation
  | ReadFileOperation
  | ReadRangeOperation
  | ParseFileOperation
  | FollowRelationshipOperation
  | InspectManifestOperation
  | InspectGitContextOperation
  | EvaluateAbsenceOperation;

export interface InvestigationOperationProposal {
  type: InvestigationOperationType;
  reason: string;
  questionIds: QuestionId[];
  hypothesisIds: HypothesisId[];
}

export type OperationStatus =
  | "proposed"
  | "scheduled"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "blocked"
  | "deduplicated";

export interface SafeOperationError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface InvestigationOperationRecord {
  operation: InvestigationOperation;
  status: OperationStatus;
  startedAt?: string;
  completedAt?: string;
  actualCost?: OperationCost;
  producedEntityIds: EntityId[];
  producedFactIds: FactId[];
  producedEvidenceIds: EvidenceId[];
  error?: SafeOperationError;
}
