import type {
  EngineTaskInput,
  ExplicitTargetConstraint,
  FactRecord,
  InvestigationBudget,
  InvestigationPurpose,
  InvestigationRequest,
  KnowledgeGap,
  NegativeConstraint,
  RepositorySnapshot,
  StopReason,
} from "../contracts/index.js";
import type {
  ContextProjectionResult,
  InvestigationRunnerResult,
} from "../application/index.js";
import type {
  CompatibilityComparisonSummary,
  LegacyProjectionResult,
} from "../adapters/index.js";

export type ValidationSeverity = "critical" | "high" | "medium" | "low";
export type ValidationVerdict =
  | "PASS"
  | "ACCEPTABLE"
  | "SAFE_FAIL"
  | "CRITICAL_FAIL"
  | "ENGINE_ERROR"
  | "NOT_RUN";

export type ValidationExpectedOutcome =
  | "grounded_success"
  | "safe_unresolved"
  | "clarification"
  | "safety_block"
  | "budget_exhausted"
  | "contradiction_block";

export type ValidationProjectSource =
  | { kind: "synthetic"; fixtureId: string }
  | { kind: "local"; rootKey: string };

export interface ValidationProjectDefinition {
  id: string;
  title: string;
  source: ValidationProjectSource;
  labels: string[];
}

export type ValidationEntityMatcher =
  | { kind: "path"; path: string }
  | { kind: "path_pattern"; pattern: string }
  | { kind: "entity_id"; entityId: string }
  | { kind: "entity_kind"; entityKind: string };

export interface ValidationLegacyComparisonExpectation {
  basis?: {
    kind: "manifest" | "expert";
    referenceId: string;
    outcome: Exclude<
      CompatibilityComparisonSummary["outcome"],
      "insufficient_evaluation_data" | "v2_execution_failure"
    >;
  };
  requireSafeBlockAgreement?: boolean;
  requireExactTargetOverlap?: boolean;
}

export interface ValidationExpectations {
  allowedStopReasons: StopReason[];
  requiredImplementationTargets?: ValidationEntityMatcher[];
  requiredSupporting?: ValidationEntityMatcher[];
  requiredTests?: ValidationEntityMatcher[];
  requiredReferences?: ValidationEntityMatcher[];
  forbiddenEditableTargets?: ValidationEntityMatcher[];
  allowedAdditionalEditableTargets?: ValidationEntityMatcher[];
  requiredPredicates?: string[];
  forbiddenPredicates?: string[];
  requiredGapCategories?: KnowledgeGap["category"][];
  forbiddenGapCategories?: KnowledgeGap["category"][];
  minimumCriticalQuestionCoverage?: number;
  maximumOperations?: number;
  requireExplicitTargetPreservation?: boolean;
  requireNegativeConstraintCompliance?: boolean;
  expectedSafety: "safe" | "blocked";
  expectedOutcome: ValidationExpectedOutcome;
  legacyComparison?: ValidationLegacyComparisonExpectation;
}

export interface ContextEngineValidationCase {
  id: string;
  title: string;
  projectId: string;
  task: EngineTaskInput;
  purpose: InvestigationPurpose;
  budget?: Partial<InvestigationBudget>;
  explicitTargets?: ExplicitTargetConstraint[];
  negativeConstraints?: NegativeConstraint[];
  expectations: ValidationExpectations;
  labels: string[];
  severityIfFailed: ValidationSeverity;
}

export interface ContextEngineValidationManifest {
  schemaVersion: 1;
  manifestId: string;
  title: string;
  createdAt?: string;
  projects: ValidationProjectDefinition[];
  cases: ContextEngineValidationCase[];
}

export interface LoadedValidationProject {
  status: "available";
  snapshot: RepositorySnapshot;
  projectFingerprint: string;
  verifyUnchanged?: () => boolean | Promise<boolean>;
}

export interface UnavailableValidationProject {
  status: "unavailable";
  reasonCode: "project_unavailable" | "fixture_unavailable" | "execution_unavailable";
  message: string;
}

export type ValidationProjectLoadResult =
  | LoadedValidationProject
  | UnavailableValidationProject;

export interface ValidationProjectLoader {
  load(input: {
    project: ValidationProjectDefinition;
    runtimeRoots: Readonly<Record<string, string>>;
  }): Promise<ValidationProjectLoadResult>;
}

export interface ValidationExecutionInput {
  project: ValidationProjectDefinition;
  validationCase: ContextEngineValidationCase;
  snapshot: RepositorySnapshot;
  request: InvestigationRequest;
  budget: InvestigationBudget;
}

export interface ValidationInvestigationExecution {
  result: InvestigationRunnerResult;
  legacySelection?: LegacyProjectionResult["selection"];
  durationMs?: number;
  stageTimingsMs?: Partial<Record<
    "snapshot" | "interpretation" | "search" | "read_parse" | "graph" | "evaluation" | "projection",
    number
  >>;
}

export interface ValidationInvestigationExecutor {
  /** Untrusted compatibility hint. Classification is assigned by validation infrastructure. */
  readonly executionMarker: "real_engine" | "fixture_result";
  execute(input: ValidationExecutionInput): Promise<ValidationInvestigationExecution>;
}

export interface ValidationExecutionArtifacts {
  snapshot: RepositorySnapshot;
  investigation: InvestigationRunnerResult;
  projection: ContextProjectionResult;
  legacyProjection?: LegacyProjectionResult;
  compatibility?: CompatibilityComparisonSummary;
  durationMs: number;
  stageTimingsMs: Record<string, number>;
}

export interface NormalizedOperationTrace {
  type: string;
  status: string;
  target?: string;
  actualCost?: {
    operations: number;
    fileReads: number;
    fileBytes: number;
    parsedFiles: number;
    relationshipHops: number;
    plannerRounds: number;
  };
}

export interface GoldenTraceSummary {
  schemaVersion: 1;
  caseId: string;
  snapshotFingerprint: string;
  stopReason: StopReason;
  safeToProject: boolean;
  questions: Array<{ category: string; status: string }>;
  hypotheses: Array<{ id: string; status: string }>;
  entityIds: string[];
  factIds: string[];
  findingIds: string[];
  operations: NormalizedOperationTrace[];
  factPredicates: string[];
  evidence: Array<{ role: string; strength: string }>;
  openBlockingGaps: Array<{ category: string; blocks: string[] }>;
  openContradictions: Array<{ type: string; severity: string }>;
  findings: Array<{ type: string; status: string }>;
  projected: Array<{ path: string; role: string }>;
  excludedReasonCodes: string[];
  budgetUsage: Omit<InvestigationRunnerResult["budgetState"]["usage"], "wallTimeMs">;
  limitations: string[];
}

export interface GoldenComparison {
  equivalent: boolean;
  changedFields: string[];
}

export interface ValidationExpectationFailure {
  code: string;
  category: "safety" | "knowledge" | "projection" | "efficiency" | "compatibility";
  severity: ValidationSeverity;
  message: string;
}

export interface ValidationCaseMetrics {
  safety: {
    criticalFailures: number;
    negativeConstraintViolations: number;
    unsafeEditableAuthorizations: number;
    explicitTargetViolations: number;
    mixedSnapshotRecords: number;
  };
  knowledge: {
    confirmedFindings: number;
    confirmedFindingsWithCompleteEvidence: number;
    unsupportedConfirmedFindings: number;
    criticalQuestionCoverage: number;
    stopReasonCorrect: boolean;
  };
  projection: {
    requiredTargetHits: number;
    requiredTargetCount: number;
    projectedTargetCount: number;
    requiredTestHits: number;
    requiredTestCount: number;
    unexpectedEditablePaths: number;
    explicitTargetsPreserved: number;
    explicitTargetCount: number;
  };
  efficiency: {
    operations: number;
    searches: number;
    reads: number;
    bytes: number;
    parsedFiles: number;
    relationshipHops: number;
    plannerRounds: number;
    durationMs: number;
    stageTimingsMs: Record<string, number>;
  };
}

export interface ValidationCaseResult {
  caseId: string;
  projectId: string;
  title: string;
  verdict: ValidationVerdict;
  executionMarker: "real_engine" | "fixture_result";
  severityIfFailed: ValidationSeverity;
  failures: ValidationExpectationFailure[];
  compatibilityNotes: string[];
  trace?: GoldenTraceSummary;
  metrics?: ValidationCaseMetrics;
  compatibility?: CompatibilityComparisonSummary;
  errorCode?: string;
  redactions: string[];
}

export interface ValidationAggregateMetrics {
  totalCases: number;
  realEngineCaseCount: number;
  fixtureCaseCount: number;
  baselineEligible: boolean;
  verdicts: Record<ValidationVerdict, number>;
  baselineVerdicts: Record<ValidationVerdict, number>;
  acceptableOrBetterPercentage: number;
  allCasesAcceptableOrBetterPercentage: number;
  safety: {
    criticalFailures: number;
    negativeConstraintViolations: number;
    unsafeEditableAuthorizations: number;
    explicitTargetViolations: number;
    mixedSnapshotRecords: number;
  };
  knowledge: {
    confirmedFindings: number;
    confirmedFindingEvidenceCompleteness: number;
    unsupportedConfirmedFindings: number;
    averageCriticalQuestionCoverage: number;
    stopReasonCorrectness: number;
  };
  projection: {
    requiredTargetPrecision: number;
    requiredTargetRecall: number;
    requiredTestRecall: number;
    unexpectedEditablePaths: number;
    explicitTargetPreservation: number;
  };
  efficiency: {
    operations: number;
    searches: number;
    reads: number;
    bytes: number;
    parsedFiles: number;
    relationshipHops: number;
    plannerRounds: number;
    durationMs: number;
  };
  deterministicReplayEquivalence: number;
}

export interface ValidationGateDecision {
  passed: boolean;
  blockingReasons: string[];
  proposedAcceptableOrBetterThreshold: number;
  proposedThresholdEvaluated: boolean;
}

export interface ValidationProjectSummary {
  projectId: string;
  available: boolean;
  cases: number;
  verdicts: Record<ValidationVerdict, number>;
}

export interface ContextEngineValidationReport {
  schemaVersion: 1;
  manifest: {
    schemaVersion: 1;
    manifestId: string;
    title: string;
  };
  run: {
    runId: string;
    mode: "verify" | "update_golden";
    repeatCount: number;
    projectFilter: string[];
    caseFilter: string[];
  };
  projects: ValidationProjectSummary[];
  cases: ValidationCaseResult[];
  metrics: ValidationAggregateMetrics;
  gate: ValidationGateDecision;
  unavailableProjects: string[];
  redaction: {
    absoluteRootsExcluded: true;
    sourceContentExcluded: true;
    secretsExcluded: true;
    redactedFields: string[];
  };
  knownLimitations: string[];
}

export interface GoldenStore {
  read(caseId: string): Promise<GoldenTraceSummary | null>;
  write(caseId: string, summary: GoldenTraceSummary, reason: string): Promise<void>;
}

export interface ValidationRunOptions {
  mode?: "verify" | "update_golden";
  updateReason?: string;
  repeatCount?: number;
  projectFilter?: readonly string[];
  caseFilter?: readonly string[];
  runtimeRoots?: Readonly<Record<string, string>>;
  failOnCritical?: boolean;
  failOnEngineError?: boolean;
  goldenStore?: GoldenStore;
}

export interface ValidationRunnerDependencies {
  projectLoader: ValidationProjectLoader;
  executor: ValidationInvestigationExecutor;
}

export interface ContextEngineValidationRunner {
  run(
    manifest: ContextEngineValidationManifest,
    options?: ValidationRunOptions,
  ): Promise<ContextEngineValidationReport>;
}

export interface LegacyValidationCaseLike {
  id: string;
  task: string;
  projectId?: string;
  expected?: {
    blocked?: boolean;
    manualReview?: boolean;
    primaryAnyOf?: string[];
    primaryAllOf?: string[];
    forbiddenSelected?: string[];
    forbiddenEdit?: string[];
    explicitTargets?: ExplicitTargetConstraint[];
    [key: string]: unknown;
  };
  labels?: string[];
  severity?: ValidationSeverity;
  [key: string]: unknown;
}

export interface TranslatedValidationCase {
  validationCase: ContextEngineValidationCase;
  compatibilityNotes: string[];
}

export type ValidationFactPredicate = FactRecord["predicate"];
