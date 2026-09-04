import type { ContextProjectionResult, InvestigationRunnerResult } from "../application/index.js";
import type { LegacyProjectionResult } from "../adapters/legacySelection/index.js";
import type {
  ContextEngineShadowCanonicalInput,
  ContextEngineShadowExecutionTracker,
} from "../shadow/index.js";

export type TaskPackPrimaryDecisionStatus =
  | "v2_applied"
  | "v2_no_selection"
  | "clarification_required"
  | "review_required"
  | "safe_fail"
  | "legacy_rollback"
  | "engine_error";

export type TaskPackPrimaryReasonCode =
  | "primary_disabled"
  | "manual_selection_authoritative"
  | "canonical_input_mismatch"
  | "preparation_limit_exceeded"
  | "capacity_exhausted"
  | "execution_timeout"
  | "execution_error"
  | "projection_invalid"
  | "compatibility_invalid"
  | "clarification_required"
  | "stop_not_sufficient"
  | "result_not_safe"
  | "blocking_gap"
  | "blocking_contradiction"
  | "unsupported_confirmed_finding"
  | "evidence_incomplete"
  | "no_editable_target"
  | "explicit_target_not_preserved"
  | "negative_constraint_violation"
  | "repository_safety_violation"
  | "unknown_inventory_path"
  | "role_usage_mismatch"
  | "review_required"
  | "snapshot_mismatch"
  | "repository_changed"
  | "ambiguous_targets"
  | "downstream_explicit_target_rejected"
  | "downstream_selection_mutated"
  | "downstream_quality_blocked"
  | "downstream_manual_review"
  | "downstream_authorization_rejected"
  | "downstream_context_ineligible"
  | "v2_applied";

export type TaskPackPrimaryRollbackReason =
  | "capacity_exhausted"
  | "execution_timeout"
  | "execution_error";

export type TaskPackPrimaryRole = "target" | "test" | "supporting" | "reference";
export type TaskPackPrimaryUsage =
  | "inspect-and-edit"
  | "create-and-edit"
  | "inspect-only"
  | "asset-reference"
  | "config-reference";

export interface TaskPackPrimaryMappedFile {
  path: string;
  kind: "source" | "test" | "style" | "config" | "docs" | "asset" | "data" | "runtime" | "unknown";
  role: TaskPackPrimaryRole;
  usage: TaskPackPrimaryUsage;
}

export interface GroundedSelectionProof {
  schemaVersion: 1;
  path: string;
  role: "target" | "test";
  evidenceCurrent: true;
  findingConfirmed: true;
  targetRoleSupported: true;
  snapshotCurrent: true;
  ambiguityResolved: true;
  constraintsSatisfied: true;
  proofKind: "direct_definition" | "direct_document_identity" | "direct_configuration_identity" | "exact_relationship_chain";
}

export interface TaskPackPrimaryDownstreamValidation {
  passed: boolean;
  qualityStatus: "ready" | "warning" | "blocked";
  explicitTargetStatus: "matched" | "unresolved" | "not-applicable";
  authorizationPreserved: boolean;
  contextAssemblyEligible: boolean;
  reasonCodes: TaskPackPrimaryReasonCode[];
}

export interface TaskPackPrimaryDownstreamValidationResult {
  validatedFiles: TaskPackPrimaryMappedFile[];
  validation: TaskPackPrimaryDownstreamValidation;
}

export interface TaskPackPrimaryMetrics {
  operations: number;
  fileReads: number;
  fileBytes: number;
  parsedFiles: number;
  relationshipHops: number;
  plannerRounds: number;
}

export interface TaskPackPrimaryTiming {
  executionMs: number;
  projectionMs: number;
  downstreamValidationMs: number;
  totalMs: number;
  timeoutCeilingMs: number;
}

export interface TaskPackPrimaryDecision {
  schemaVersion: 1;
  decisionId: string;
  projectId: string;
  taskFingerprint: string;
  clarificationFingerprint: string;
  inventoryFingerprint: string;
  snapshotFingerprint: string;
  configurationFingerprint: string;
  status: TaskPackPrimaryDecisionStatus;
  reasonCodes: TaskPackPrimaryReasonCode[];
  rollbackReason: TaskPackPrimaryRollbackReason | null;
  selectedFiles: TaskPackPrimaryMappedFile[];
  groundedProofs: GroundedSelectionProof[];
  downstreamValidation: TaskPackPrimaryDownstreamValidation | null;
  metrics: TaskPackPrimaryMetrics | null;
  timing: TaskPackPrimaryTiming;
  modelPlannerUsed: false;
  createdAt: string;
}

export interface TaskPackPrimaryResolution {
  status: TaskPackPrimaryDecisionStatus;
  adoptedFiles: TaskPackPrimaryMappedFile[] | null;
  groundedProofs: readonly GroundedSelectionProof[];
  rollbackEligible: boolean;
  rollbackReason: TaskPackPrimaryRollbackReason | null;
  decision: TaskPackPrimaryDecision;
}

export interface TaskPackPrimaryRuntimeInput {
  canonical: ContextEngineShadowCanonicalInput;
  manualSelectionRequested?: boolean;
  parentAbortSignal?: AbortSignal;
  requestStartedMonotonicMs: number;
  requestDeadlineMonotonicMs: number;
  validateDownstream(
    candidate: readonly TaskPackPrimaryMappedFile[],
    proofs: readonly GroundedSelectionProof[],
  ): TaskPackPrimaryDownstreamValidationResult;
}

export interface TaskPackPrimaryRuntimeDependencies {
  execute(input: {
    canonical: ContextEngineShadowCanonicalInput;
    abortSignal: AbortSignal;
    deadlineMonotonicMs: number;
  }): Promise<InvestigationRunnerResult>;
  tracker: ContextEngineShadowExecutionTracker;
  project?(input: {
    result: InvestigationRunnerResult;
    canonical: ContextEngineShadowCanonicalInput;
  }): ContextProjectionResult;
  map?(input: {
    projection: ContextProjectionResult;
    canonical: ContextEngineShadowCanonicalInput;
  }): LegacyProjectionResult;
  nowIso(): string;
  monotonicMs(): number;
}

export interface TaskPackPrimaryHistoryStore {
  get(): Promise<TaskPackPrimaryDecision[]>;
  append(record: TaskPackPrimaryDecision): Promise<TaskPackPrimaryDecision[]>;
  clear(): Promise<void>;
}

export interface TaskPackPrimaryDiagnosticsWriterState {
  closed: boolean;
  inFlight: boolean;
  queued: number;
  dropped: number;
  workerTracked: boolean;
}

export interface TaskPackPrimaryDiagnosticsWriter {
  enqueue(record: TaskPackPrimaryDecision): "enqueued" | "dropped" | "closed";
  flush(timeoutMs: number): Promise<boolean>;
  close(timeoutMs: number): Promise<boolean>;
  state(): TaskPackPrimaryDiagnosticsWriterState;
}

export type RetirementCaseVerdict =
  | "PASS"
  | "ACCEPTABLE"
  | "SAFE_FAIL"
  | "CRITICAL_FAIL"
  | "ENGINE_ERROR";

export type LegacyRetirementExpectedOutcome =
  | "grounded_selection"
  | "safe_no_selection"
  | "typed_infrastructure_rollback";

export interface LegacyRetirementCaseDefinition {
  schemaVersion: 1;
  caseId: string;
  repositoryShape: string;
  expectedOutcome: LegacyRetirementExpectedOutcome;
  allowedStatuses: TaskPackPrimaryDecisionStatus[];
  requiredPaths: string[];
  forbiddenPaths: string[];
  ambiguityExpected: boolean;
  expectedRollbackReason: TaskPackPrimaryRollbackReason | null;
}

export interface LegacyRetirementCaseExecution {
  canonical: ContextEngineShadowCanonicalInput;
  resolution: TaskPackPrimaryResolution;
  effectiveFiles: TaskPackPrimaryMappedFile[];
  legacyBaselinePaths: string[];
}

export interface LegacyRetirementCaseResult {
  caseId: string;
  repositoryShape: string;
  actualStatus: TaskPackPrimaryDecisionStatus;
  actualPaths: string[];
  reasonCodes: TaskPackPrimaryReasonCode[];
  verdict: RetirementCaseVerdict;
  unsafeAutomaticAdoption: boolean;
  negativeConstraintViolation: boolean;
  restrictedEditableSelection: boolean;
  silentHybridSelection: boolean;
  modelPlannerUsed: boolean;
  deterministicReplayEquivalent: boolean;
  semanticAmbiguityHandledSafely: boolean;
  groundedRolesSupported: boolean;
}

export interface LegacyRetirementGateResult {
  schemaVersion: 1;
  ready: boolean;
  totals: Record<RetirementCaseVerdict, number>;
  criticalFailures: number;
  unsafeAutomaticAdoptions: number;
  negativeConstraintViolations: number;
  restrictedEditableSelections: number;
  silentHybridSelections: number;
  modelPlannerUses: number;
  deterministicReplayFailures: number;
  unsafeAmbiguityOutcomes: number;
  unsupportedGroundedRoles: number;
}
