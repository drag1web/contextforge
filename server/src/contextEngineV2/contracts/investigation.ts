import type {
  ContradictionRecord,
  EvidenceRecord,
  Finding,
  InvestigationHypothesis,
  KnowledgeGap,
} from "./evidence.js";
import type {
  ContradictionId,
  InvestigationId,
  InvestigationRequestId,
  KnowledgeGapId,
  QuestionId,
  SnapshotId,
} from "./ids.js";
import type { InvestigationOperationRecord } from "./operations.js";
import type { ContextProjection } from "./projection.js";
import type { RepositorySnapshot } from "./repository.js";
import type {
  EngineTaskUnderstanding,
  ExplicitTargetConstraint,
  NegativeConstraint,
  PriorKnowledgeReference,
} from "./task.js";

export type InvestigationPurpose =
  | "implementation_context"
  | "review_context"
  | "clarification"
  | "shadow_comparison";

export interface InvestigationBudget {
  maxOperations: number;
  maxFileReads: number;
  maxFileBytes: number;
  maxParsedFiles: number;
  maxRelationshipHops: number;
  maxWallTimeMs: number;
  maxPlannerRounds: number;
  maxConcurrentOperations: number;
}

export interface InvestigationBudgetUsage {
  operations: number;
  fileReads: number;
  fileBytes: number;
  parsedFiles: number;
  relationshipHops: number;
  wallTimeMs: number;
  plannerRounds: number;
}

export type InvestigationBudgetLimit =
  | "operations"
  | "file_reads"
  | "file_bytes"
  | "parsed_files"
  | "relationship_hops"
  | "wall_time"
  | "planner_rounds";

export interface InvestigationBudgetState {
  budget: InvestigationBudget;
  usage: InvestigationBudgetUsage;
  exhausted: InvestigationBudgetLimit[];
}

export interface InvestigationRequest {
  requestId: InvestigationRequestId;
  projectId: string;
  task: EngineTaskUnderstanding;
  snapshot: RepositorySnapshot;
  explicitTargets: ExplicitTargetConstraint[];
  negativeConstraints: NegativeConstraint[];
  priorKnowledge?: PriorKnowledgeReference[];
  budget: InvestigationBudget;
  purpose: InvestigationPurpose;
}

export type InvestigationPhase =
  | "initialized"
  | "interpreting"
  | "planning"
  | "executing"
  | "evaluating"
  | "projecting"
  | "stopped";

export interface InvestigationQuestion {
  id: QuestionId;
  text: string;
  category:
    | "owner"
    | "behavior"
    | "data_flow"
    | "route_flow"
    | "state_flow"
    | "constraint"
    | "test_coverage"
    | "risk";
  priority: "critical" | "high" | "normal" | "low";
  status: "open" | "answered" | "partially_answered" | "blocked";
  answerFindingIds: Finding["id"][];
}

export interface InvestigationCoverage {
  criticalQuestionsTotal: number;
  criticalQuestionsAnswered: number;
  questionsTotal: number;
  questionsAnswered: number;
  hypothesesTotal: number;
  hypothesesSupported: number;
  hypothesesRejected: number;
  hypothesesUnresolved: number;
  filesConsidered: number;
  filesRead: number;
  filesParsed: number;
  relationshipHops: number;
  evidenceIndependentGroups: number;
  snapshotTruncated: boolean;
  blockedScopes: string[];
}

export type StopReason =
  | "sufficient_evidence"
  | "clarification_required"
  | "no_grounded_lead"
  | "contradictory_evidence"
  | "operation_budget_exhausted"
  | "file_budget_exhausted"
  | "byte_budget_exhausted"
  | "time_budget_exhausted"
  | "planner_round_budget_exhausted"
  | "repository_snapshot_truncated"
  | "repository_changed"
  | "safety_blocked"
  | "internal_error";

export interface InvestigationStop {
  reason: StopReason;
  message: string;
  blockingGapIds: KnowledgeGapId[];
  contradictionIds: ContradictionId[];
  budgetState: InvestigationBudgetState;
  safeToProject: boolean;
}

export interface InvestigationResult {
  investigationId: InvestigationId;
  requestId: InvestigationRequestId;
  snapshotId: SnapshotId;
  taskUnderstanding: EngineTaskUnderstanding;
  hypotheses: InvestigationHypothesis[];
  evidence: EvidenceRecord[];
  findings: Finding[];
  contradictions: ContradictionRecord[];
  knowledgeGaps: KnowledgeGap[];
  operationLog: InvestigationOperationRecord[];
  coverage: InvestigationCoverage;
  stop: InvestigationStop;
  projection: ContextProjection;
}
