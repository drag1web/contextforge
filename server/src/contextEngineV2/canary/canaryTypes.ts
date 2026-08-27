import type { InvestigationRunnerResult } from "../application/index.js";
import type { LegacyProjectionResult } from "../adapters/legacySelection/index.js";
import type { ContextEngineShadowCanonicalInput, ContextEngineShadowExecutionTracker } from "../shadow/index.js";

export type TaskPackCanaryDecisionStatus =
  | "not_enabled"
  | "not_in_cohort"
  | "v2_ineligible"
  | "v2_confirmed_no_change"
  | "v2_applied"
  | "legacy_fallback"
  | "critical_disagreement";

export type TaskPackCanaryReasonCode =
  | "canary_disabled"
  | "project_not_in_cohort"
  | "manual_selection_authoritative"
  | "canonical_input_mismatch"
  | "capacity_exhausted"
  | "execution_timeout"
  | "execution_error"
  | "projection_invalid"
  | "compatibility_invalid"
  | "stop_not_sufficient"
  | "result_not_safe"
  | "blocking_gap"
  | "blocking_contradiction"
  | "unsupported_confirmed_finding"
  | "evidence_incomplete"
  | "no_editable_target"
  | "explicit_target_not_preserved"
  | "explicit_target_only_canary"
  | "preparation_limit_exceeded"
  | "negative_constraint_violation"
  | "repository_safety_violation"
  | "unknown_inventory_path"
  | "role_usage_mismatch"
  | "review_required"
  | "snapshot_mismatch"
  | "repository_changed"
  | "critical_safety_disagreement"
  | "downstream_explicit_target_rejected"
  | "downstream_selection_mutated"
  | "downstream_quality_blocked"
  | "downstream_manual_review"
  | "downstream_authorization_rejected"
  | "downstream_context_ineligible"
  | "v2_no_selection_delta"
  | "v2_applied";

export interface ContextEngineCanaryConfiguration {
  percent: number;
  projectIds: readonly string[];
}

export interface TaskPackCanaryCohortDecision {
  allowlisted: boolean;
  bucket: number;
  configuredPercent: number;
  included: boolean;
  basisFingerprint: string;
}

export interface TaskPackCanarySelectionSummary {
  files: Array<{
    path: string;
    usage:
      | "inspect-and-edit"
      | "create-and-edit"
      | "inspect-only"
      | "asset-reference"
      | "config-reference";
  }>;
  editablePaths: string[];
}

export interface TaskPackCanaryMappedFile {
  path: string;
  kind: LegacyProjectionResult["selection"]["selectedFiles"][number]["kind"];
  usage: LegacyProjectionResult["selection"]["selectedFiles"][number]["usage"];
}

export interface TaskPackCanaryDownstreamValidation {
  passed: boolean;
  qualityStatus: "ready" | "warning" | "blocked";
  explicitTargetStatus: "matched" | "unresolved" | "not-applicable";
  authorizationPreserved: boolean;
  contextAssemblyEligible: boolean;
  reasonCodes: TaskPackCanaryReasonCode[];
}

export interface TaskPackCanaryTiming {
  v2Ms: number;
  downstreamValidationMs: number;
  totalMs: number;
  timeoutCeilingMs: number;
}

export interface TaskPackCanaryDecision {
  schemaVersion: 1;
  decisionId: string;
  mode: "disabled" | "shadow" | "canary";
  cohort: TaskPackCanaryCohortDecision;
  taskFingerprint: string;
  clarificationFingerprint: string;
  inventoryFingerprint: string;
  snapshotFingerprint: string;
  configurationFingerprint: string;
  status: TaskPackCanaryDecisionStatus;
  gatesPassed: boolean;
  selectionDelta: boolean;
  reasonCodes: TaskPackCanaryReasonCode[];
  legacy: TaskPackCanarySelectionSummary;
  v2: TaskPackCanarySelectionSummary | null;
  downstreamValidation: TaskPackCanaryDownstreamValidation | null;
  timing: TaskPackCanaryTiming;
  createdAt: string;
}

export interface TaskPackCanaryDownstreamValidationResult {
  validatedFiles: TaskPackCanaryMappedFile[];
  validation: TaskPackCanaryDownstreamValidation;
}

export interface TaskPackCanaryResolution {
  adoptedFiles: TaskPackCanaryMappedFile[] | null;
  decision: TaskPackCanaryDecision;
  applied: boolean;
  gatesPassed: boolean;
  selectionDelta: boolean;
}

export interface TaskPackCanaryPreparationFailureBasis {
  schemaVersion: 1;
  totalFiles: number;
  configuredFileLimit: number;
  truncated: boolean;
  reasonCode: "canonical_input_mismatch" | "preparation_limit_exceeded" | "execution_timeout";
}

export interface TaskPackCanaryRuntimeInput {
  mode: unknown;
  configuration: ContextEngineCanaryConfiguration;
  canonical: ContextEngineShadowCanonicalInput;
  legacySelection: LegacyProjectionResult["selection"];
  manualSelectionRequested?: boolean;
  parentAbortSignal?: AbortSignal;
  requestStartedMonotonicMs: number;
  requestDeadlineMonotonicMs: number;
  validateDownstream(
    candidate: readonly TaskPackCanaryMappedFile[],
  ): TaskPackCanaryDownstreamValidationResult;
}

export interface TaskPackCanaryRuntimeDependencies {
  execute(input: {
    canonical: ContextEngineShadowCanonicalInput;
    abortSignal: AbortSignal;
    deadlineMonotonicMs: number;
  }): Promise<InvestigationRunnerResult>;
  tracker: ContextEngineShadowExecutionTracker;
  nowIso(): string;
  monotonicMs(): number;
}

export interface TaskPackCanaryHistoryStore {
  get(): Promise<TaskPackCanaryDecision[]>;
  append(record: TaskPackCanaryDecision): Promise<TaskPackCanaryDecision[]>;
  clear(): Promise<void>;
}

export interface TaskPackCanaryDiagnosticsWriterState {
  closed: boolean;
  inFlight: boolean;
  queued: number;
  dropped: number;
  workerTracked: boolean;
}

export interface TaskPackCanaryDiagnosticsWriter {
  enqueue(record: TaskPackCanaryDecision): "enqueued" | "dropped" | "closed";
  flush(timeoutMs: number): Promise<boolean>;
  close(timeoutMs: number): Promise<boolean>;
  state(): TaskPackCanaryDiagnosticsWriterState;
}
