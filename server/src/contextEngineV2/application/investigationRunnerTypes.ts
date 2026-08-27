import type {
  ClaimRecord,
  ContradictionRecord,
  EvidenceRecord,
  FactRecord,
  Finding,
  InvestigationBudget,
  InvestigationBudgetState,
  InvestigationCoverage,
  InvestigationHypothesis,
  InvestigationId,
  InvestigationRequest,
  InvestigationOperation,
  InvestigationOperationRecord,
  InvestigationPhase,
  InvestigationPurpose,
  InvestigationQuestion,
  InvestigationStop,
  KnowledgeGap,
  RepositoryEntity,
  RepositorySnapshot,
  SnapshotId,
  EngineTaskUnderstanding,
  ExplicitTargetConstraint,
  NegativeConstraint,
} from "../contracts/index.js";
import type {
  ClockPort,
  FactExtractorPort,
  InvestigationCancellationPort,
  KnowledgeGraphStorePort,
  RepositoryReaderPort,
  RepositorySearchPort,
} from "../ports/index.js";

export interface DeterministicPlannerPolicy {
  maxOperationsPerRound: number;
  searchResultLimit: number;
  maxFailedOperationRetries: number;
}

export interface DeterministicPlannerState {
  snapshotId: SnapshotId;
  snapshot: RepositorySnapshot;
  taskUnderstanding?: EngineTaskUnderstanding;
  explicitTargets: readonly ExplicitTargetConstraint[];
  negativeConstraints: readonly NegativeConstraint[];
  questions: readonly InvestigationQuestion[];
  claims: readonly ClaimRecord[];
  hypotheses: readonly InvestigationHypothesis[];
  evidence: readonly EvidenceRecord[];
  facts: readonly FactRecord[];
  contradictions: readonly ContradictionRecord[];
  knowledgeGaps: readonly KnowledgeGap[];
  findings: readonly Finding[];
  entities: readonly RepositoryEntity[];
  coverage: InvestigationCoverage;
  budgetState: InvestigationBudgetState;
  operationCandidates: readonly InvestigationOperation[];
  operationRecords: readonly InvestigationOperationRecord[];
  policy: DeterministicPlannerPolicy;
  repositoryChanged: boolean;
}

export type GroundedOperationSource =
  | "explicit_path"
  | "explicit_symbol"
  | "task_token"
  | "snapshot_manifest"
  | "knowledge_gap"
  | "graph_fact"
  | "search_lead"
  | "caller_seed";

export interface InvestigationSeedRationale {
  source:
    | GroundedOperationSource
    | "generic_question"
    | "unknown_explicit_target"
    | "prior_knowledge_reference";
  questionIds: InvestigationQuestion["id"][];
  hypothesisIds: InvestigationHypothesis["id"][];
  knowledgeGapIds: KnowledgeGap["id"][];
  operationIds: InvestigationOperation["id"][];
  reason: string;
}

export interface DeterministicInvestigationSeed {
  questions: InvestigationQuestion[];
  claims: ClaimRecord[];
  hypotheses: InvestigationHypothesis[];
  knowledgeGaps: KnowledgeGap[];
  operationCandidates: InvestigationOperation[];
  rationale: InvestigationSeedRationale[];
}

export interface DeterministicInvestigationInterpreter {
  interpret(request: InvestigationRequest): DeterministicInvestigationSeed;
}

export interface DeterministicInvestigationPlan {
  rationale: string;
  operations: InvestigationOperation[];
  skippedDuplicateOperationIds: InvestigationOperation["id"][];
  consideredQuestionIds: InvestigationQuestion["id"][];
  consideredHypothesisIds: InvestigationHypothesis["id"][];
  consideredKnowledgeGapIds: KnowledgeGap["id"][];
  synthesizedOperationSources: Array<{
    operationId: InvestigationOperation["id"];
    source: GroundedOperationSource;
  }>;
  productive: boolean;
}

export interface DeterministicInvestigationPlanner {
  proposeNextOperations(
    state: Readonly<DeterministicPlannerState>,
  ): DeterministicInvestigationPlan;
}

export interface InvestigationPlanner {
  proposeNextOperations(
    state: Readonly<DeterministicPlannerState>,
    signal?: AbortSignal,
  ): Promise<DeterministicInvestigationPlan>;
}

export type InvestigationRunnerTraceEvent =
  | {
      type: "seed_interpreted";
      questionIds: InvestigationQuestion["id"][];
      hypothesisIds: InvestigationHypothesis["id"][];
      knowledgeGapIds: KnowledgeGap["id"][];
      operationIds: InvestigationOperation["id"][];
      rationaleCount: number;
      negativeConstraintCount: number;
      semanticNegativeConstraintCount: number;
    }
  | {
      type: "planner_proposal_synthesized";
      round: number;
      operationId: InvestigationOperation["id"];
      operationType: InvestigationOperation["type"];
      source: GroundedOperationSource;
      questionIds: InvestigationQuestion["id"][];
      hypothesisIds: InvestigationHypothesis["id"][];
    }
  | {
      type: "question_updated";
      round: number;
      questionId: InvestigationQuestion["id"];
      previousStatus: InvestigationQuestion["status"];
      status: InvestigationQuestion["status"];
      answerFindingIds: Finding["id"][];
    }
  | {
      type: "gap_evaluated";
      round: number;
      knowledgeGapId: KnowledgeGap["id"];
      outcome: "resolved" | "kept_open";
      reasonCode: string;
      evidenceIds: EvidenceRecord["id"][];
    }
  | {
      type: "domain_evaluated";
      round: number;
      supportedHypothesisIds: InvestigationHypothesis["id"][];
      confirmedFindingIds: Finding["id"][];
      openGapIds: KnowledgeGap["id"][];
    }
  | {
      type: "atomic_commit";
      round: number;
      operationId: InvestigationOperation["id"];
      status: "committed" | "rejected" | "cancelled";
      entityIds: RepositoryEntity["id"][];
      factIds: FactRecord["id"][];
    }
  | {
      type: "stop_checked";
      round: number;
      stage: "before_planning" | "after_planning" | "before_operation" | "after_ingestion" | "after_budget" | "final";
      decision: "continue" | "stop";
      stopReason?: InvestigationStop["reason"];
    }
  | {
      type: "plan_created";
      round: number;
      rationale: string;
      consideredQuestionIds: InvestigationQuestion["id"][];
      consideredHypothesisIds: InvestigationHypothesis["id"][];
      consideredKnowledgeGapIds: KnowledgeGap["id"][];
      proposedOperationIds: InvestigationOperation["id"][];
      skippedDuplicateOperationIds: InvestigationOperation["id"][];
    }
  | {
      type: "operation_selected";
      round: number;
      operationId: InvestigationOperation["id"];
      operationType: InvestigationOperation["type"];
    }
  | {
      type: "operation_completed";
      round: number;
      operationId: InvestigationOperation["id"];
      status: InvestigationOperationRecord["status"];
      producedEntityIds: RepositoryEntity["id"][];
      producedFactIds: FactRecord["id"][];
      producedEvidenceIds: EvidenceRecord["id"][];
    }
  | {
      type: "operation_budget_rejected";
      round: number;
      operationId: InvestigationOperation["id"];
    };

export interface InvestigationRunnerInput {
  investigationId: InvestigationId;
  snapshot: RepositorySnapshot;
  purpose: InvestigationPurpose;
  request?: InvestigationRequest;
  questions: readonly InvestigationQuestion[];
  claims: readonly ClaimRecord[];
  hypotheses: readonly InvestigationHypothesis[];
  entities: readonly RepositoryEntity[];
  facts: readonly FactRecord[];
  evidence: readonly EvidenceRecord[];
  findings: readonly Finding[];
  contradictions: readonly ContradictionRecord[];
  knowledgeGaps: readonly KnowledgeGap[];
  operationCandidates: readonly InvestigationOperation[];
  budget: InvestigationBudget;
  plannerPolicy: DeterministicPlannerPolicy;
  deadlineMonotonicMs?: number;
}

export interface InvestigationRunnerDependencies {
  clock: ClockPort;
  cancellation: InvestigationCancellationPort;
  repositoryReader: RepositoryReaderPort;
  repositorySearch: RepositorySearchPort;
  factExtractor: FactExtractorPort;
  graphStore: KnowledgeGraphStorePort;
  planner?: DeterministicInvestigationPlanner;
  actionPlanner?: InvestigationPlanner;
  plannerSignal?: AbortSignal;
}

export interface InvestigationRunnerResult {
  investigationId: InvestigationId;
  snapshotId: SnapshotId;
  phase: Extract<InvestigationPhase, "stopped">;
  questions: InvestigationQuestion[];
  claims: ClaimRecord[];
  hypotheses: InvestigationHypothesis[];
  entities: RepositoryEntity[];
  facts: FactRecord[];
  evidence: EvidenceRecord[];
  findings: Finding[];
  contradictions: ContradictionRecord[];
  knowledgeGaps: KnowledgeGap[];
  coverage: InvestigationCoverage;
  budgetState: InvestigationBudgetState;
  operationRecords: InvestigationOperationRecord[];
  trace: InvestigationRunnerTraceEvent[];
  stop: InvestigationStop;
  safeToProject: boolean;
}

export interface InvestigationRunner {
  run(input: InvestigationRunnerInput): Promise<InvestigationRunnerResult>;
}

export type InvestigationRunnerErrorCode =
  | "invalid_input"
  | "operation_conflict"
  | "operation_failed"
  | "cancelled";

export class InvestigationRunnerError extends Error {
  readonly stage = "CE2-04" as const;

  constructor(
    readonly code: InvestigationRunnerErrorCode,
    message: string,
    readonly recordId?: string,
  ) {
    super(message);
    this.name = "InvestigationRunnerError";
  }
}
