import type {
  ContextProjectionResult,
  ExplicitTargetConstraint,
  NegativeConstraint,
  ProjectionReasonCode,
  RepositorySnapshot,
} from "../../contracts/index.js";
import type {
  EffectiveTaskArea,
  TaskFileSelection,
} from "../../../ollama/taskFileSelector.js";

export interface LegacyProjectionOptions {
  effectiveTaskArea: EffectiveTaskArea;
  requestedTaskType: string;
  durationMs?: number;
  negativeConstraints: readonly NegativeConstraint[];
}

export interface LegacyProjectionFileTrace {
  role: "target" | "supporting" | "reference" | "test";
  findingIds: string[];
  evidenceIds: string[];
  reviewRequired: boolean;
  compatibilityDerivedConfidence: number;
}

export interface LegacyProjectionDiagnostic {
  code:
    | "compatibility_confidence_derived"
    | "excluded_projection_path"
    | "offline_projection"
    | "unsupported_legacy_field";
  message: string;
  path?: string;
  reasonCode?: ProjectionReasonCode;
}

export interface LegacyProjectionExclusion {
  path?: string;
  entityId: string;
  reasons: ProjectionReasonCode[];
}

export interface LegacyProjectionResult {
  selection: TaskFileSelection;
  diagnostics: LegacyProjectionDiagnostic[];
  files: Record<string, LegacyProjectionFileTrace>;
  excluded: LegacyProjectionExclusion[];
  unsupportedFields: string[];
}

export interface LegacyTaskFileSelectionProjection {
  project(
    projectionResult: ContextProjectionResult,
    snapshot: RepositorySnapshot,
    options: LegacyProjectionOptions,
  ): LegacyProjectionResult;
}

export type LegacyProjectionErrorCode =
  | "invalid_projection"
  | "snapshot_mismatch";

export class LegacyProjectionError extends Error {
  readonly stage = "CE2-05" as const;

  constructor(
    readonly code: LegacyProjectionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LegacyProjectionError";
  }
}

export interface LegacySelectionSummary {
  selectedPaths: string[];
  implementationTargetPaths: string[];
  testPaths: string[];
  editablePaths: string[];
  targetPaths: string[];
  supportingPaths: string[];
  referencePaths: string[];
  usedFallback: boolean;
  source: TaskFileSelection["source"];
}

export interface V2ProjectionSummary {
  snapshotId: string;
  purpose: ContextProjectionResult["projection"]["purpose"];
  selectedPaths: string[];
  implementationTargetPaths: string[];
  testPaths: string[];
  editablePaths: string[];
  targetPaths: string[];
  supportingPaths: string[];
  referencePaths: string[];
  traceablePaths: string[];
  stopReason: ContextProjectionResult["source"]["stopReason"];
  safeToProject: boolean;
  blocked: boolean;
}

export interface SelectionOverlap {
  exactTargetPaths: string[];
  legacyOnlyTargetPaths: string[];
  v2OnlyTargetPaths: string[];
  exactEditablePaths: string[];
  legacyOnlyEditablePaths: string[];
  v2OnlyEditablePaths: string[];
  supportingOrReferenceOverlap: string[];
  allSelectedOverlap: string[];
}

export interface SafetyComparison {
  legacyNegativeConstraintViolations: string[];
  v2NegativeConstraintViolations: string[];
  legacyRepositorySafetyViolations: string[];
  v2RepositorySafetyViolations: string[];
  legacyBlocked: boolean;
  v2Blocked: boolean;
  safeBlockAgreement: boolean;
}

export type ExplicitTargetComparisonStatus =
  | "preserved"
  | "dropped"
  | "unresolved"
  | "unknown";

export interface ExplicitTargetComparison {
  targetKey: string;
  kind: ExplicitTargetConstraint["kind"];
  resolvedPath?: string;
  legacyStatus: ExplicitTargetComparisonStatus;
  v2Status: ExplicitTargetComparisonStatus;
  disagreement: boolean;
}

export interface EvidenceComparison {
  v2TraceableSelectedPaths: string[];
  v2UntraceableSelectedPaths: string[];
  legacyEvidenceAvailability: "not_evaluated";
}

export type ComparisonOutcome =
  | "equivalent_supported"
  | "v2_better_supported"
  | "legacy_better_supported"
  | "both_safe_unresolved"
  | "v2_safe_legacy_risky"
  | "legacy_safe_v2_risky"
  | "different_but_both_acceptable"
  | "insufficient_evaluation_data"
  | "v2_execution_failure";

export interface CompatibilityEvaluationBasis {
  kind: "manifest" | "expert";
  referenceId: string;
  outcome: Exclude<ComparisonOutcome, "insufficient_evaluation_data" | "v2_execution_failure">;
}

export interface CompatibilityComparisonSummary {
  legacy: LegacySelectionSummary;
  v2: V2ProjectionSummary;
  overlap: SelectionOverlap;
  safety: SafetyComparison;
  evidence: EvidenceComparison;
  explicitTargets: ExplicitTargetComparison[];
  explicitTargetsPreservedByLegacy: string[];
  explicitTargetsPreservedByV2: string[];
  explicitTargetDisagreements: string[];
  outcome: ComparisonOutcome;
  evaluationBasis?: CompatibilityEvaluationBasis;
}

export interface OfflineCompatibilityComparisonInput {
  legacySelection: TaskFileSelection;
  v2Projection: ContextProjectionResult;
  snapshot: RepositorySnapshot;
  negativeConstraints: readonly NegativeConstraint[];
  explicitTargets: readonly ExplicitTargetConstraint[];
  evaluationBasis?: CompatibilityEvaluationBasis;
  v2ExecutionFailed?: boolean;
}

export interface OfflineCompatibilityComparison {
  compare(input: OfflineCompatibilityComparisonInput): CompatibilityComparisonSummary;
}

export class CompatibilityComparisonError extends Error {
  readonly stage = "CE2-05" as const;
  readonly code = "invalid_comparison_input" as const;

  constructor() {
    super("Offline compatibility comparison input failed safe runtime validation.");
    this.name = "CompatibilityComparisonError";
  }
}
