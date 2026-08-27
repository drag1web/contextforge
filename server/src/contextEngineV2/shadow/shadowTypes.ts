import type { CompatibilityComparisonSummary } from "../adapters/legacySelection/legacyProjectionTypes.js";
import type { ContextProjectionResult } from "../contracts/projection.js";
import type { ExplicitTargetConstraint, NegativeConstraint } from "../contracts/task.js";
import type { InvestigationBudget } from "../contracts/investigation.js";
import type { RepositorySnapshot } from "../contracts/repository.js";
import type { InvestigationRunnerResult } from "../application/investigationRunnerTypes.js";

export type ContextEngineMode = "disabled" | "shadow" | "canary";

export type ContextEngineShadowStatus =
  | "completed"
  | "timeout"
  | "cancelled"
  | "execution_error"
  | "input_mismatch";

export type ContextEngineShadowIssueCode =
  | "canonical_input_mismatch"
  | "shadow_timeout"
  | "shadow_cancelled"
  | "shadow_execution_error"
  | "shadow_projection_error"
  | "shadow_comparison_error"
  | "legacy_safe_v2_risky"
  | "v2_safe_legacy_risky"
  | "explicit_target_disagreement"
  | "negative_constraint_disagreement"
  | "repository_safety_disagreement"
  | "unsupported_confirmed_finding"
  | "blocking_state_incoherent";

export interface ContextEngineShadowIssue {
  code: ContextEngineShadowIssueCode;
  severity: "critical" | "warning";
}

export interface ContextEngineShadowTiming {
  legacyMs: number;
  v2Ms: number;
  comparisonMs: number;
  /** Persistence is lifecycle-managed and is not awaited by the request. */
  persistenceMs: number | null;
  totalShadowOverheadMs: number;
  timeoutCeilingMs: number;
}

export interface ContextEngineShadowBudgetUsage {
  operations: number;
  fileReads: number;
  fileBytes: number;
  parsedFiles: number;
  relationshipHops: number;
  plannerRounds: number;
}

export interface ContextEngineShadowComparison {
  schemaVersion: 1;
  comparisonId: string;
  projectId: string;
  taskFingerprint: string;
  clarificationFingerprint: string;
  inventoryFingerprint: string;
  snapshotFingerprint: string;
  configurationFingerprint: string;
  status: ContextEngineShadowStatus;
  legacy: CompatibilityComparisonSummary["legacy"] | null;
  v2: CompatibilityComparisonSummary["v2"] | null;
  overlap: CompatibilityComparisonSummary["overlap"] | null;
  safety: CompatibilityComparisonSummary["safety"] | null;
  evidence: CompatibilityComparisonSummary["evidence"] | null;
  explicitTargets: CompatibilityComparisonSummary["explicitTargets"];
  manualReviewAgreement: boolean | null;
  outcome: CompatibilityComparisonSummary["outcome"];
  stopReason: InvestigationRunnerResult["stop"]["reason"] | null;
  safeToProject: boolean | null;
  openBlockingGapCount: number;
  openContradictionCount: number;
  unsupportedConfirmedFindingCount: number;
  confirmedFindingEvidenceCompleteness: number | null;
  budgetUsage: ContextEngineShadowBudgetUsage | null;
  issues: ContextEngineShadowIssue[];
  timing: ContextEngineShadowTiming;
  createdAt: string;
}

export interface ContextEngineShadowCanonicalInput {
  projectId: string;
  projectRoot: string;
  normalizedTask: string;
  clarificationBasis: readonly {
    questionId: string;
    answer: string;
  }[];
  explicitTargets: ExplicitTargetConstraint[];
  negativeConstraints: NegativeConstraint[];
  inventory: import("../../scanner/projectInventoryScanner.js").ProjectInventory;
  snapshot: RepositorySnapshot;
  taskFingerprint: string;
  clarificationFingerprint: string;
  inventoryFingerprint: string;
  snapshotFingerprint: string;
  configurationFingerprint: string;
  executionBasis: ContextEngineShadowExecutionBasis;
}

export interface ContextEngineShadowPolicy {
  budget: InvestigationBudget;
  timeoutMs: number;
  maxHistoryRecords: number;
}

export interface ContextEngineShadowExecutionBasis {
  policy: ContextEngineShadowPolicy;
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

export interface ContextEngineShadowLifecycleContext {
  signal: AbortSignal;
  deadlineMonotonicMs: number;
}

export interface ContextEngineShadowExecutionTrackerState {
  active: number;
  capacity: number;
  skipped: number;
  closed: boolean;
}

export interface ContextEngineShadowExecutionTracker {
  tryTrack<T>(input: {
    abortController: AbortController;
    start(): Promise<T>;
  }): Promise<T> | null;
  flush(timeoutMs: number): Promise<boolean>;
  close(timeoutMs: number): Promise<boolean>;
  state(): ContextEngineShadowExecutionTrackerState;
}

export interface ContextEngineShadowDiagnosticsWriterState {
  closed: boolean;
  inFlight: boolean;
  queued: number;
  dropped: number;
  workerTracked: boolean;
}

export interface ContextEngineShadowDiagnosticsWriter {
  enqueue(record: ContextEngineShadowComparison): "enqueued" | "dropped" | "closed";
  flush(timeoutMs: number): Promise<boolean>;
  close(timeoutMs: number): Promise<boolean>;
  state(): ContextEngineShadowDiagnosticsWriterState;
}

export interface ContextEngineShadowExecutionResult {
  runnerResult: InvestigationRunnerResult;
  projection: ContextProjectionResult;
}

export interface ContextEngineShadowHistoryStore {
  get(): Promise<ContextEngineShadowComparison[]>;
  append(record: ContextEngineShadowComparison): Promise<ContextEngineShadowComparison[]>;
  clear(): Promise<void>;
}

export interface ContextEngineShadowClock {
  nowIso(): string;
  monotonicMs(): number;
}
