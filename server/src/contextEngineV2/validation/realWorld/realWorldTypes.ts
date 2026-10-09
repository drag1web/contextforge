/** RW-02A metadata only. No roots, credentials, oracle records or executable ports. */
export const REAL_WORLD_FOUNDATION_PROFILE = "rw02a-isolation-foundation" as const;

export const REAL_WORLD_STAGES = Object.freeze([
  "understanding", "grounding_policy", "ce2_primary", "owner_projection",
  "candidate_validation", "final_gates", "preparation_output",
] as const);
export type RealWorldStage = typeof REAL_WORLD_STAGES[number];

export const REAL_WORLD_EFFECTS = Object.freeze([
  "task_pack_mutation", "database_access", "persistent_diagnostics",
  "workspace_settings", "project_source_write", "git_mutation",
  "shell_execution", "external_request", "oracle_access",
] as const);
export type RealWorldEffect = typeof REAL_WORLD_EFFECTS[number];

export const REAL_WORLD_TECHNICAL_STATUSES = Object.freeze([
  "completed", "not_run", "skipped", "timeout", "engine_error",
  "invalid_input", "source_changed", "oracle_pending",
] as const);
export type RealWorldTechnicalStatus = typeof REAL_WORLD_TECHNICAL_STATUSES[number];
export type RealWorldSemanticVerdict =
  | "PASS" | "ACCEPTABLE" | "SAFE_FAIL" | "WRONG_CONTEXT"
  | "DANGEROUS_FALSE_CONFIDENCE";

export type RealWorldReason =
  | "adapters_not_wired" | "dependency_unresolved" | "write_capability_rejected"
  | "invalid_task_input" | "not_requested" | "explicit_skip";

export interface RealWorldDependencyAssessment {
  effect: RealWorldEffect;
  /** Documentary evidence only, never a capability or permission to execute. */
  disposition: "unresolved" | "excluded" | "isolated" | "write_capable";
  evidenceDigest: string | null;
}

export interface RealWorldFoundationPlan {
  profileId: typeof REAL_WORLD_FOUNDATION_PROFILE;
  runId: string;
  protocolDigest: string;
  sourceBasis: {
    kind: "synthetic_inert";
    projectAlias: string;
    manifestDigest: string;
    authorization: "mechanical_only";
    authorizationEvidenceDigest: string;
  };
  runtimeIdentity: {
    contextforgeCommit: string;
    toolingDigest: string;
    /** Never loaded from main-workspace settings; this is a synthetic declaration. */
    settingsBasis: "synthetic_inert";
    safeSettingsDigest: string;
    productionPolicyDigest: string;
    intendedEngineMode: "primary";
    intendedPlannerMode: "deterministic";
    understandingAvailability: "unresolved";
  };
  plannedCaseIds: readonly string[];
  dependencies: readonly RealWorldDependencyAssessment[];
}

/** Private runner-visible data; not an evaluator case with expectations attached. */
export interface RealWorldRunnerTask {
  rawTask: string;
  taskType: string;
  targetTool: string;
}

export interface RealWorldStageParity {
  stage: RealWorldStage;
  status: "blocked";
  reason: "adapters_not_wired";
}

export interface RealWorldFoundationCaseResult {
  caseId: string;
  technicalStatus: "not_run" | "invalid_input" | "skipped";
  reasonCodes: readonly RealWorldReason[];
  unresolvedEffects: readonly RealWorldEffect[];
  writeCapableEffects: readonly RealWorldEffect[];
  engineInvoked: false;
  semanticVerdict: null;
  engineOutcome: null;
  durationMs: null;
}

export interface RealWorldDiagnosticRecord {
  sequence: number;
  caseId: string;
  technicalStatus: RealWorldFoundationCaseResult["technicalStatus"];
  code: RealWorldReason;
}

export interface RealWorldFoundationReport {
  profileId: typeof REAL_WORLD_FOUNDATION_PROFILE;
  identity: RealWorldFoundationPlan;
  parity: readonly RealWorldStageParity[];
  cases: readonly RealWorldFoundationCaseResult[];
  accounting: {
    planned: number;
    accounted: number;
    statusCounts: Readonly<Record<RealWorldTechnicalStatus, number>>;
    engineInvocations: 0;
    semanticEvaluations: 0;
    qualityMeasurement: null;
  };
  diagnostics: {
    records: readonly RealWorldDiagnosticRecord[];
    droppedRecords: number;
    persistence: "memory_only";
  };
  executionEnabled: false;
  fullProductionParity: false;
}

export interface RealWorldFoundation {
  assessCase(caseId: string, task: unknown): RealWorldFoundationCaseResult;
  skipCase(caseId: string): RealWorldFoundationCaseResult;
  /** Accounts for untouched slots as not_run; seals the session, never runs CE2. */
  finalize(): RealWorldFoundationReport;
}
