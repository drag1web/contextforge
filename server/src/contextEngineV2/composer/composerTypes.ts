import type {
  CompatibilityComparisonSummary,
  LegacyProjectionResult,
} from "../adapters/index.js";
import type {
  ContextProjectionResult,
  InvestigationRunnerResult,
} from "../application/index.js";
import type {
  ExplicitTargetConstraint,
  InvestigationBudget,
  NegativeConstraint,
  RepositorySnapshot,
} from "../contracts/index.js";
import type { ProjectInventory } from "../../scanner/projectInventoryScanner.js";

export type ContextComposerEngineMode = "legacy" | "shadow_compare" | "v2_primary";
export type ContextComposerEngineStatus =
  | "legacy"
  | "v2_ready"
  | "v2_review_required"
  | "legacy_fallback"
  | "safety_blocked";

export type ContextComposerEngineReasonCode =
  | "legacy_candidate"
  | "confirmed_implementation_target"
  | "confirmed_test_target"
  | "confirmed_supporting_context"
  | "explicit_target_eligible"
  | "probable_review_only"
  | "blocking_gap"
  | "blocking_contradiction"
  | "negative_constraint"
  | "secret_file"
  | "generated_target_blocked"
  | "unreadable_file"
  | "missing_evidence"
  | "evidence_entity_mismatch"
  | "result_not_safe_to_project"
  | "stop_reason_blocks_projection"
  | "v2_execution_timeout"
  | "v2_execution_error"
  | "v2_capacity_exhausted"
  | "canonical_input_mismatch"
  | "repository_changed"
  | "v2_integrity_violation"
  | "v2_not_grounded";

export interface ContextComposerExecutionBasis {
  schemaVersion: 1;
  policy: Readonly<{
    budget: Readonly<InvestigationBudget>;
    timeoutMs: number;
  }>;
  requestedTaskType: string;
  effectiveTaskArea: string;
  plannerIdentifier: string;
  plannerPolicy: Readonly<{
    maxOperationsPerRound: number;
    searchResultLimit: number;
    maxFailedOperationRetries: number;
  }>;
  extractorRegistryIdentifier: string;
}

export interface ContextComposerCanonicalExecutionInput {
  schemaVersion: 1;
  projectId: string;
  /** Runtime-only local root. It is never copied into the renderer view. */
  projectRoot: string;
  inventory: ProjectInventory;
  snapshot: RepositorySnapshot;
  normalizedTask: string;
  explicitTargets: readonly ExplicitTargetConstraint[];
  negativeConstraints: readonly NegativeConstraint[];
  executionBasis: ContextComposerExecutionBasis;
  taskFingerprint: string;
  constraintFingerprint: string;
  inventoryFingerprint: string;
  snapshotFingerprint: string;
  configurationFingerprint: string;
}

export interface ContextComposerEvidenceView {
  evidenceId: string;
  role: "supports" | "contradicts" | "context_only";
  strength: "lead" | "corroborating" | "substantial" | "conclusive";
  predicate?: string;
  relationKind?: "relation" | "fact";
  path?: string;
  startLine?: number;
  endLine?: number;
  reasonCode: ContextComposerEngineReasonCode;
}

export interface ContextComposerEngineFileView {
  path: string;
  role: "target" | "test" | "supporting" | "reference";
  usage: "inspect-and-edit" | "inspect-only" | "asset-reference" | "config-reference";
  source: "v2" | "legacy" | "manual";
  reviewRequired: boolean;
  reasonCode: ContextComposerEngineReasonCode;
  reasonCodes: ContextComposerEngineReasonCode[];
  findingIds: string[];
  evidenceIds: string[];
  evidence: ContextComposerEvidenceView[];
}

export interface ContextComposerComparisonView {
  outcome: CompatibilityComparisonSummary["outcome"];
  exactEditablePaths: string[];
  legacyOnlyEditablePaths: string[];
  v2OnlyEditablePaths: string[];
  safeBlockAgreement: boolean;
  explicitTargetDisagreements: string[];
}

export interface ContextComposerParityAggregate {
  comparisonCount: number;
  exactEditableAgreementCount: number;
  safeBlockAgreementCount: number;
  explicitTargetAgreementCount: number;
  insufficientEvaluationDataCount: number;
}

export interface ContextComposerEngineView {
  schemaVersion: 1;
  requestedMode: ContextComposerEngineMode;
  effectiveSource: "legacy" | "v2";
  status: ContextComposerEngineStatus;
  stopReason: InvestigationRunnerResult["stop"]["reason"] | null;
  fallbackReason: ContextComposerEngineReasonCode | null;
  files: ContextComposerEngineFileView[];
  unresolvedQuestions: Array<{
    category: InvestigationRunnerResult["questions"][number]["category"];
    status: InvestigationRunnerResult["questions"][number]["status"];
  }>;
  limitations: ContextComposerEngineReasonCode[];
  comparison: ContextComposerComparisonView | null;
}

export interface ContextComposerV2ExecutionResult {
  result: InvestigationRunnerResult;
  projection: ContextProjectionResult;
  legacyProjection: LegacyProjectionResult;
  snapshot: RepositorySnapshot;
}

export interface ContextComposerEngineResolution {
  view: ContextComposerEngineView;
  selection: LegacyProjectionResult["selection"] | null;
  useLegacySelection: boolean;
}
