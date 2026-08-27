import type {
  EntityId,
  HypothesisId,
  KnowledgeGapId,
  SnapshotId,
} from "./ids.js";
import type { InvestigationStop } from "./investigation.js";

export type ContextEnginePlannerMode = "deterministic" | "model_assisted";

export type ModelPlannerActionKind =
  | "search_symbol"
  | "search_text"
  | "read_file"
  | "read_range"
  | "parse_file"
  | "inspect_relationship"
  | "stop";

export type ModelPlannerReasonCode =
  | "inspect_explicit_target"
  | "follow_import_edge"
  | "resolve_blocking_gap"
  | "search_task_symbol"
  | "search_task_text"
  | "inspect_candidate_file"
  | "no_useful_action";

export type ModelPlannerProposalAction =
  | { kind: "search_symbol"; symbol: string }
  | { kind: "search_text"; query: string }
  | { kind: "read_file"; path: string }
  | {
      kind: "read_range";
      path: string;
      startLine: number;
      endLine: number;
    }
  | { kind: "parse_file"; path: string }
  | {
      kind: "inspect_relationship";
      sourceEntityId: EntityId;
      relation: string;
    }
  | {
      kind: "stop";
      reason: "sufficient_information" | "no_useful_action";
    };

export interface ModelPlannerProposal {
  schemaVersion: 1;
  action: ModelPlannerProposalAction;
  reasonCode: ModelPlannerReasonCode;
}

export interface ModelPlannerHypothesisSummary {
  id: HypothesisId;
  status: "open" | "unresolved" | "supported" | "rejected";
}

export interface ModelPlannerGapSummary {
  id: KnowledgeGapId;
  category: string;
  blocking: boolean;
}

export interface ModelPlannerEntitySummary {
  id: EntityId;
  kind: string;
  path?: string;
}

export interface ModelPlannerPriorActionSummary {
  actionKind: string;
  status: string;
  targetHash: string;
}

export interface ModelPlannerBudgetSummary {
  remainingOperations: number;
  remainingFileReads: number;
  remainingFileBytes: number;
  remainingRelationshipHops: number;
  remainingPlannerRounds: number;
}

export interface ModelPlannerContext {
  schemaVersion: 1;
  requestId: string;
  snapshotId: SnapshotId;
  normalizedTask: string;
  explicitTargets: string[];
  negativeConstraints: string[];
  hypotheses: ModelPlannerHypothesisSummary[];
  gaps: ModelPlannerGapSummary[];
  entities: ModelPlannerEntitySummary[];
  candidatePaths: string[];
  priorActions: ModelPlannerPriorActionSummary[];
  budget: ModelPlannerBudgetSummary;
  allowedActionKinds: ModelPlannerActionKind[];
}

export type ModelPlannerFallbackReason =
  | "disabled"
  | "unavailable"
  | "timeout"
  | "cancellation"
  | "provider_error"
  | "malformed_output"
  | "schema_rejected"
  | "semantic_rejected"
  | "budget_rejected"
  | "duplicate_rejected"
  | "privacy_rejected"
  | "unsupported_action"
  | "capacity_exhausted";

export interface ModelPlannerObservation {
  schemaVersion: 1;
  requestId: string;
  plannerMode: ContextEnginePlannerMode;
  attempt: number;
  actionKind: ModelPlannerActionKind | null;
  accepted: boolean;
  fallbackReason: ModelPlannerFallbackReason | null;
  inputBytes: number;
  outputBytes: number;
  durationMs: number;
  providerIdentifier: string | null;
  modelIdentifier: string | null;
}

export interface ModelPlannerUsefulnessRunMetrics {
  operationCount: number;
  factCount: number;
  evidenceCount: number;
  findingCount: number;
  blockingGapsResolved: number;
  finalStopReason: InvestigationStop["reason"];
  sufficientEvidenceReached: boolean;
  duplicateProposalCount: number;
  rejectedProposalCount: number;
  deterministicFallbackCount: number;
}

export interface ModelPlannerContainmentMetrics {
  acceptedProposals: number;
  schemaRejected: number;
  semanticRejected: number;
  privacyRejected: number;
  budgetRejected: number;
  duplicateRejected: number;
  timeoutOrProviderFallback: number;
  unsafeActionExecutions: number;
}

export interface ModelPlannerUsefulnessComparison {
  schemaVersion: 1;
  caseId: string;
  deterministic: ModelPlannerUsefulnessRunMetrics;
  modelAssisted: ModelPlannerUsefulnessRunMetrics;
  containment: ModelPlannerContainmentMetrics;
  assessment: "strict_improvement" | "not_worse" | "regression";
  safetyRegression: boolean;
}
