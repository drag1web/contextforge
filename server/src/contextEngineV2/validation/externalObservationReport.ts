import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { containsSecretLikeSemanticValue } from "../domain/semanticLiteralSafety.js";
import type { ExternalRetirementVerdict } from "./externalRetirementReport.js";
import { containsAbsolutePathOrFileUri } from "./validationPrivacy.js";

export const EXTERNAL_OBSERVATION_SCHEMA_VERSION = 2 as const;

export type ExternalObservationUnavailableReason =
  | "case_not_executed"
  | "decision_not_produced"
  | "downstream_contract_not_exposed"
  | "legacy_selector_not_invoked"
  | "legacy_comparison_not_executed"
  | "git_metadata_unavailable"
  | "source_identity_unavailable";

export type ExternalObservationProofKind =
  | "direct_definition"
  | "direct_document_identity"
  | "direct_configuration_identity"
  | "direct_source_identity"
  | "exact_relationship_chain";
export type ExternalObservationRole = "target" | "test" | "supporting" | "reference";
export type ExternalObservationUsage =
  | "inspect-and-edit"
  | "create-and-edit"
  | "inspect-only"
  | "asset-reference"
  | "config-reference";

export interface ExternalObservationOperationMetrics {
  operations: number;
  fileReads: number;
  fileBytes: number;
  parsedFiles: number;
  relationshipHops: number;
  plannerRounds: number;
}

export interface ExternalObservationDecisionTiming {
  executionMs: number;
  projectionMs: number;
  downstreamValidationMs: number;
  totalMs: number;
  timeoutCeilingMs: number;
}

export interface ExternalObservationFile {
  path: string;
  role: ExternalObservationRole;
  usage: ExternalObservationUsage;
}

export interface ExternalObservationExecutionIdentity {
  taskFingerprint: string;
  clarificationFingerprint: string;
  inventoryFingerprint: string;
  snapshotFingerprint: string;
  configurationFingerprint: string;
}

export interface ExternalObservationAuthorization {
  authorizedEditPaths: string[];
  referenceOnlyPaths: string[];
  projectedAuthorizationMatchesApplied: boolean | null;
  unauthorizedEditableTarget: boolean;
  unavailableReason: ExternalObservationUnavailableReason | null;
}

export interface ExternalObservationCase {
  projectId: string;
  caseId: string;
  repositoryShape: string;
  availability: "available" | "not_run";
  actualStatus: "v2_applied" | "v2_no_selection" | "clarification_required" | "review_required" | "safe_fail" | "legacy_rollback" | "engine_error" | null;
  actualPaths: string[];
  reasonCodes: string[];
  rollbackReason: "capacity_exhausted" | "execution_timeout" | "execution_error" | null;
  verdict: ExternalRetirementVerdict | null;
  unsafeAutomaticAdoption: boolean;
  negativeConstraintViolation: boolean;
  restrictedEditableSelection: boolean;
  silentHybridSelection: boolean;
  modelPlannerUsed: boolean;
  deterministicReplayEquivalent: boolean;
  semanticAmbiguityHandledSafely: boolean;
  groundedRolesSupported: boolean;
  identity: ExternalObservationExecutionIdentity | null;
  selection: {
    projectedFiles: ExternalObservationFile[];
    appliedFiles: ExternalObservationFile[];
  };
  proofs: {
    counts: Record<ExternalObservationProofKind, number>;
    appliedGroundedTargetCount: number;
  };
  authorization: ExternalObservationAuthorization;
  contradictions: {
    count: number | null;
    unresolvedCount: number | null;
    blocked: boolean;
    unavailableReason: ExternalObservationUnavailableReason | null;
  };
  operations: {
    first: ExternalObservationOperationMetrics | null;
    replay: ExternalObservationOperationMetrics | null;
    searchOperations: number | null;
    uniqueFilesRead: number | null;
    uniqueFilesParsed: number | null;
    unavailableReason: ExternalObservationUnavailableReason | null;
  };
  timing: {
    firstPreparationMs: number | null;
    replayPreparationMs: number | null;
    firstExecutionMs: number | null;
    replayExecutionMs: number | null;
    firstDecision: ExternalObservationDecisionTiming | null;
    replayDecision: ExternalObservationDecisionTiming | null;
    totalCaseMs: number;
  };
  determinism: {
    scope: "same_process_same_snapshot";
    executionBasisEquivalent: boolean;
    resultEquivalent: boolean;
    equivalent: boolean;
    firstExecutionIdentity: ExternalObservationExecutionIdentity | null;
    replayExecutionIdentity: ExternalObservationExecutionIdentity | null;
    firstResultIdentity: string | null;
    replayResultIdentity: string | null;
  };
  fallback: {
    infrastructureRollback: boolean;
    semanticLegacyFallback: boolean;
    legacySelectorInvoked: false;
    legacySelectorUsedFallback: null;
  };
}

export interface ExternalObservationRepositoryIdentity {
  projectId: string;
  gitHead: string | null;
  workingTreeClean: boolean | null;
  gitIdentityUnavailableReason: ExternalObservationUnavailableReason | null;
  inventoryFingerprints: string[];
  snapshotFingerprints: string[];
  scanDurationMs: number | null;
}

export interface ExternalObservationValidationReport {
  schemaVersion: typeof EXTERNAL_OBSERVATION_SCHEMA_VERSION;
  manifestId: string;
  runId: string;
  createdAt: string;
  run: {
    contextForgeVersion: string;
    contextForgeGitCommit: string | null;
    contextForgeWorkingTreeClean: boolean | null;
    ce2SourceFingerprint: string | null;
    observationToolingFingerprint: string | null;
    harnessMode: "external_primary_observation";
  };
  engine: {
    ce2Mode: "primary";
    plannerMode: "deterministic";
    globalDefaultState: "disabled";
    configurationFingerprints: string[];
  };
  manifest: {
    id: string;
    schemaVersion: 1;
    normalizedContentHash: string;
    hashNormalization: "utf8_bom_removed_lf_newlines";
  };
  repositories: ExternalObservationRepositoryIdentity[];
  cases: ExternalObservationCase[];
  metrics: {
    totalCases: number;
    executedCases: number;
    notRunCases: number;
    verdicts: Record<ExternalRetirementVerdict, number>;
    groundedApplied: number;
    safeNoSelection: number;
    clarificationRequired: number;
    reviewRequired: number;
    infrastructureRollbackCount: number;
    infrastructureRollbackRate: number;
    rollbackReasons: Record<"capacity_exhausted" | "execution_timeout" | "execution_error", number>;
    semanticLegacyFallbackCount: number;
    unsafeAutomaticAdoptionCount: number;
    negativeConstraintViolations: number;
    deterministicReplayFailures: number;
    unsupportedGroundedRoles: number;
    criticalDisagreements: number;
    acceptableOrBetterRate: number;
  };
  summary: {
    proofClassCounts: Record<ExternalObservationProofKind, number>;
    projectedRoleCounts: Record<ExternalObservationRole, number>;
    appliedRoleCounts: Record<ExternalObservationRole, number>;
    projectedUsageCounts: Record<ExternalObservationUsage, number>;
    appliedUsageCounts: Record<ExternalObservationUsage, number>;
    projectedPathCount: number;
    appliedPathCount: number;
    appliedTargetCount: number;
    authorizedEditTargetCount: number;
    unauthorizedEditableTargetCount: number;
    projectedAuthorizationMismatchCount: number;
    contradictionCount: number | null;
    unresolvedContradictionCount: number | null;
    contradictionMetricsUnavailableReason: ExternalObservationUnavailableReason | null;
    primaryOperations: ExternalObservationOperationMetrics;
    replayOperations: ExternalObservationOperationMetrics;
    searchOperations: number | null;
    uniqueFilesRead: number | null;
    uniqueFilesParsed: number | null;
    detailedOperationMetricsUnavailableReason: ExternalObservationUnavailableReason | null;
  };
  determinism: {
    scope: "same_process_same_snapshot";
    comparedCases: number;
    matchingCases: number;
    failureCount: number;
    crossProcessEstablished: false;
  };
  performance: {
    scanPreparationMs: number;
    firstExecutionMs: number;
    replayExecutionMs: number;
    caseTotalMs: number;
    runTotalMs: number;
    coldWarmClassification: null;
    coldWarmUnavailableReason: "cold_warm_not_qualified";
  };
  fallback: {
    infrastructureRollbackCount: number;
    infrastructureRollbackRate: number;
    semanticLegacyFallbackCount: number;
    semanticLegacyFallbackRate: number;
    legacySelectorInvocationCount: 0;
    legacySelectorUsedFallbackCount: null;
    legacySelectorFallbackRate: null;
    legacySelectorFallbackUnavailableReason: "legacy_selector_not_invoked";
    legacyComparisonInvocationCount: 0;
    legacyComparisonEligibleCount: null;
    legacyComparisonUnavailableReason: "legacy_comparison_not_executed";
  };
  readiness: {
    hardSafetyGatesPassed: boolean;
    blockers: string[];
    proposedAcceptableOrBetterThreshold: number;
    proposedThresholdEvaluated: false;
    candidateFallbackRateThreshold: number | null;
    candidateFallbackThresholdEvaluated: false;
  };
  redaction: {
    absoluteRootsExcluded: true;
    sourceContentExcluded: true;
    secretsExcluded: true;
    taskTextExcluded: true;
    promptsExcluded: true;
  };
  limitations: string[];
}

const ID = /^[a-z0-9][a-z0-9._:-]{0,100}$/u;
const HASH = /^sha256:[a-f0-9]{64}$/u;
const RUN_ID = /^external-[a-f0-9]{32}$/u;
const COMMIT = /^[a-f0-9]{7,64}$/u;
const RELATIVE_PATH = /^(?!\/)(?![A-Za-z]:)(?!.*(?:^|\/)\.\.(?:\/|$))[^\\\u0000-\u001f]+$/u;
const ERROR_CODE = /^[a-z][a-z0-9_.:-]{0,80}$/u;
const STATUSES = new Set(["v2_applied", "v2_no_selection", "clarification_required", "review_required", "safe_fail", "legacy_rollback", "engine_error"]);
const VERDICTS: ExternalRetirementVerdict[] = ["PASS", "ACCEPTABLE", "SAFE_FAIL", "CRITICAL_FAIL", "ENGINE_ERROR"];
const ROLLBACKS = ["capacity_exhausted", "execution_timeout", "execution_error"] as const;
const PROOF_KINDS: ExternalObservationProofKind[] = ["direct_definition", "direct_document_identity", "direct_configuration_identity", "direct_source_identity", "exact_relationship_chain"];
const ROLES: ExternalObservationRole[] = ["target", "test", "supporting", "reference"];
const USAGES: ExternalObservationUsage[] = ["inspect-and-edit", "create-and-edit", "inspect-only", "asset-reference", "config-reference"];
const BLOCKERS = new Set(["no_executed_cases", "incomplete_execution", "critical_failures", "engine_errors", "unsafe_automatic_adoption", "negative_constraint_violations", "semantic_legacy_fallback", "deterministic_replay_failures", "unsupported_grounded_roles", "authorization_mismatch"]);

export class ExternalObservationReportError extends Error {
  readonly code = "invalid_external_observation_report" as const;
  constructor() {
    super("External observation report failed privacy-safe runtime validation.");
    this.name = "ExternalObservationReportError";
  }
}

function hash(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function stableStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function zeroRecord<T extends string>(keys: readonly T[]): Record<T, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>;
}

function normalizedFiles(files: readonly ExternalObservationFile[]): ExternalObservationFile[] {
  return [...files].map((file) => ({ ...file, path: file.path.replaceAll("\\", "/").replace(/^\.\//u, "") }))
    .sort((left, right) => left.path.localeCompare(right.path) || left.role.localeCompare(right.role) || left.usage.localeCompare(right.usage));
}

function addMetrics(target: ExternalObservationOperationMetrics, source: ExternalObservationOperationMetrics | null): void {
  if (!source) return;
  target.operations += source.operations;
  target.fileReads += source.fileReads;
  target.fileBytes += source.fileBytes;
  target.parsedFiles += source.parsedFiles;
  target.relationshipHops += source.relationshipHops;
  target.plannerRounds += source.plannerRounds;
}

function aggregate(cases: readonly ExternalObservationCase[]) {
  const executed = cases.filter((item) => item.availability === "available");
  const verdicts = zeroRecord(VERDICTS);
  const rollbackReasons = zeroRecord(ROLLBACKS);
  const proofClassCounts = zeroRecord(PROOF_KINDS);
  const projectedRoleCounts = zeroRecord(ROLES);
  const appliedRoleCounts = zeroRecord(ROLES);
  const projectedUsageCounts = zeroRecord(USAGES);
  const appliedUsageCounts = zeroRecord(USAGES);
  const primaryOperations = { operations: 0, fileReads: 0, fileBytes: 0, parsedFiles: 0, relationshipHops: 0, plannerRounds: 0 };
  const replayOperations = { ...primaryOperations };
  executed.forEach((item) => {
    if (item.verdict) verdicts[item.verdict] += 1;
    if (item.rollbackReason) rollbackReasons[item.rollbackReason] += 1;
    PROOF_KINDS.forEach((kind) => { proofClassCounts[kind] += item.proofs.counts[kind]; });
    item.selection.projectedFiles.forEach((file) => {
      projectedRoleCounts[file.role] += 1;
      projectedUsageCounts[file.usage] += 1;
    });
    item.selection.appliedFiles.forEach((file) => {
      appliedRoleCounts[file.role] += 1;
      appliedUsageCounts[file.usage] += 1;
    });
    addMetrics(primaryOperations, item.operations.first);
    addMetrics(replayOperations, item.operations.replay);
  });
  const infrastructureRollbackCount = ROLLBACKS.reduce((sum, reason) => sum + rollbackReasons[reason], 0);
  const semanticLegacyFallbackCount = executed.filter((item) => item.fallback.semanticLegacyFallback).length;
  const unauthorizedEditableTargetCount = executed.filter((item) => item.authorization.unauthorizedEditableTarget).length;
  const projectedAuthorizationMismatchCount = executed.filter((item) => item.authorization.projectedAuthorizationMatchesApplied === false).length;
  const metrics = {
    totalCases: cases.length,
    executedCases: executed.length,
    notRunCases: cases.length - executed.length,
    verdicts,
    groundedApplied: executed.filter((item) => item.actualStatus === "v2_applied").length,
    safeNoSelection: executed.filter((item) => ["v2_no_selection", "safe_fail"].includes(item.actualStatus ?? "")).length,
    clarificationRequired: executed.filter((item) => item.actualStatus === "clarification_required").length,
    reviewRequired: executed.filter((item) => item.actualStatus === "review_required").length,
    infrastructureRollbackCount,
    infrastructureRollbackRate: executed.length === 0 ? 0 : infrastructureRollbackCount / executed.length,
    rollbackReasons,
    semanticLegacyFallbackCount,
    unsafeAutomaticAdoptionCount: executed.filter((item) => item.unsafeAutomaticAdoption).length,
    negativeConstraintViolations: executed.filter((item) => item.negativeConstraintViolation).length,
    deterministicReplayFailures: executed.filter((item) => !item.deterministicReplayEquivalent).length,
    unsupportedGroundedRoles: executed.filter((item) => !item.groundedRolesSupported).length,
    criticalDisagreements: verdicts.CRITICAL_FAIL,
    acceptableOrBetterRate: executed.length === 0 ? 0 : (verdicts.PASS + verdicts.ACCEPTABLE) / executed.length,
  };
  const knownContradictions = executed.every((item) => item.contradictions.count !== null && item.contradictions.unresolvedCount !== null);
  const detailedOperationsKnown = executed.every((item) => item.operations.searchOperations !== null && item.operations.uniqueFilesRead !== null && item.operations.uniqueFilesParsed !== null);
  const summary = {
    proofClassCounts,
    projectedRoleCounts,
    appliedRoleCounts,
    projectedUsageCounts,
    appliedUsageCounts,
    projectedPathCount: executed.reduce((sum, item) => sum + item.selection.projectedFiles.length, 0),
    appliedPathCount: executed.reduce((sum, item) => sum + item.selection.appliedFiles.length, 0),
    appliedTargetCount: executed.reduce((sum, item) => sum + item.proofs.appliedGroundedTargetCount, 0),
    authorizedEditTargetCount: executed.reduce((sum, item) => sum + item.authorization.authorizedEditPaths.length, 0),
    unauthorizedEditableTargetCount,
    projectedAuthorizationMismatchCount,
    contradictionCount: knownContradictions ? executed.reduce((sum, item) => sum + item.contradictions.count!, 0) : null,
    unresolvedContradictionCount: knownContradictions ? executed.reduce((sum, item) => sum + item.contradictions.unresolvedCount!, 0) : null,
    contradictionMetricsUnavailableReason: knownContradictions ? null : "downstream_contract_not_exposed" as const,
    primaryOperations,
    replayOperations,
    searchOperations: detailedOperationsKnown ? executed.reduce((sum, item) => sum + item.operations.searchOperations!, 0) : null,
    uniqueFilesRead: detailedOperationsKnown ? executed.reduce((sum, item) => sum + item.operations.uniqueFilesRead!, 0) : null,
    uniqueFilesParsed: detailedOperationsKnown ? executed.reduce((sum, item) => sum + item.operations.uniqueFilesParsed!, 0) : null,
    detailedOperationMetricsUnavailableReason: detailedOperationsKnown ? null : "downstream_contract_not_exposed" as const,
  };
  const blockers = [
    ...(executed.length === 0 ? ["no_executed_cases"] : []),
    ...(cases.length > executed.length ? ["incomplete_execution"] : []),
    ...(verdicts.CRITICAL_FAIL > 0 ? ["critical_failures"] : []),
    ...(verdicts.ENGINE_ERROR > 0 ? ["engine_errors"] : []),
    ...(metrics.unsafeAutomaticAdoptionCount > 0 ? ["unsafe_automatic_adoption"] : []),
    ...(metrics.negativeConstraintViolations > 0 ? ["negative_constraint_violations"] : []),
    ...(semanticLegacyFallbackCount > 0 ? ["semantic_legacy_fallback"] : []),
    ...(metrics.deterministicReplayFailures > 0 ? ["deterministic_replay_failures"] : []),
    ...(metrics.unsupportedGroundedRoles > 0 ? ["unsupported_grounded_roles"] : []),
    ...(unauthorizedEditableTargetCount > 0 || projectedAuthorizationMismatchCount > 0 ? ["authorization_mismatch"] : []),
  ];
  return { executed, metrics, summary, blockers };
}

function runIdentityBasis(report: Pick<ExternalObservationValidationReport, "schemaVersion" | "createdAt" | "run" | "engine" | "manifest" | "repositories" | "cases">): string {
  return JSON.stringify({
    schemaVersion: report.schemaVersion,
    createdAt: report.createdAt,
    run: report.run,
    engine: report.engine,
    manifest: report.manifest,
    repositories: report.repositories.map(({ scanDurationMs: _duration, ...identity }) => identity),
    cases: report.cases.map((item) => ({
      projectId: item.projectId,
      caseId: item.caseId,
      firstExecutionIdentity: item.determinism.firstExecutionIdentity,
      replayExecutionIdentity: item.determinism.replayExecutionIdentity,
    })),
  });
}

export function createExternalObservationReport(input: {
  manifestId: string;
  manifestContentHash: string;
  createdAt: string;
  contextForgeVersion: string;
  contextForgeGitCommit: string | null;
  contextForgeWorkingTreeClean: boolean | null;
  ce2SourceFingerprint: string | null;
  observationToolingFingerprint: string | null;
  repositories: readonly ExternalObservationRepositoryIdentity[];
  cases: readonly ExternalObservationCase[];
  runTotalMs: number;
  candidateFallbackRateThreshold?: number;
}): ExternalObservationValidationReport {
  const cases: ExternalObservationCase[] = structuredClone([...input.cases]);
  cases.sort((left, right) => left.projectId.localeCompare(right.projectId) || left.caseId.localeCompare(right.caseId));
  cases.forEach((item) => {
    item.actualPaths = stableStrings(item.actualPaths);
    item.reasonCodes = stableStrings(item.reasonCodes);
    item.selection.projectedFiles = normalizedFiles(item.selection.projectedFiles);
    item.selection.appliedFiles = normalizedFiles(item.selection.appliedFiles);
    item.authorization.authorizedEditPaths = stableStrings(item.authorization.authorizedEditPaths);
    item.authorization.referenceOnlyPaths = stableStrings(item.authorization.referenceOnlyPaths);
  });
  const repositories: ExternalObservationRepositoryIdentity[] = structuredClone([...input.repositories]);
  repositories.sort((left, right) => left.projectId.localeCompare(right.projectId));
  repositories.forEach((item) => {
    item.inventoryFingerprints = stableStrings(item.inventoryFingerprints);
    item.snapshotFingerprints = stableStrings(item.snapshotFingerprints);
  });
  const { executed, metrics, summary, blockers } = aggregate(cases);
  const configurationFingerprints = stableStrings(cases.flatMap((item) => [
    ...(item.determinism.firstExecutionIdentity ? [item.determinism.firstExecutionIdentity.configurationFingerprint] : []),
    ...(item.determinism.replayExecutionIdentity ? [item.determinism.replayExecutionIdentity.configurationFingerprint] : []),
  ]));
  const reportWithoutId = {
    schemaVersion: EXTERNAL_OBSERVATION_SCHEMA_VERSION,
    manifestId: input.manifestId,
    createdAt: input.createdAt,
    run: {
      contextForgeVersion: input.contextForgeVersion,
      contextForgeGitCommit: input.contextForgeGitCommit,
      contextForgeWorkingTreeClean: input.contextForgeWorkingTreeClean,
      ce2SourceFingerprint: input.ce2SourceFingerprint,
      observationToolingFingerprint: input.observationToolingFingerprint,
      harnessMode: "external_primary_observation" as const,
    },
    engine: {
      ce2Mode: "primary" as const,
      plannerMode: "deterministic" as const,
      globalDefaultState: "disabled" as const,
      configurationFingerprints,
    },
    manifest: {
      id: input.manifestId,
      schemaVersion: 1 as const,
      normalizedContentHash: input.manifestContentHash,
      hashNormalization: "utf8_bom_removed_lf_newlines" as const,
    },
    repositories,
    cases,
  };
  const runId = `external-${hash(runIdentityBasis(reportWithoutId)).slice("sha256:".length, "sha256:".length + 32)}`;
  const matchingCases = executed.filter((item) => item.determinism.equivalent).length;
  return validateExternalObservationReport({
    ...reportWithoutId,
    runId,
    metrics,
    summary,
    determinism: {
      scope: "same_process_same_snapshot",
      comparedCases: executed.length,
      matchingCases,
      failureCount: executed.length - matchingCases,
      crossProcessEstablished: false,
    },
    performance: {
      scanPreparationMs: repositories.reduce((sum, item) => sum + (item.scanDurationMs ?? 0), 0),
      firstExecutionMs: executed.reduce((sum, item) => sum + (item.timing.firstExecutionMs ?? 0), 0),
      replayExecutionMs: executed.reduce((sum, item) => sum + (item.timing.replayExecutionMs ?? 0), 0),
      caseTotalMs: executed.reduce((sum, item) => sum + item.timing.totalCaseMs, 0),
      runTotalMs: input.runTotalMs,
      coldWarmClassification: null,
      coldWarmUnavailableReason: "cold_warm_not_qualified",
    },
    fallback: {
      infrastructureRollbackCount: metrics.infrastructureRollbackCount,
      infrastructureRollbackRate: metrics.infrastructureRollbackRate,
      semanticLegacyFallbackCount: metrics.semanticLegacyFallbackCount,
      semanticLegacyFallbackRate: executed.length === 0 ? 0 : metrics.semanticLegacyFallbackCount / executed.length,
      legacySelectorInvocationCount: 0,
      legacySelectorUsedFallbackCount: null,
      legacySelectorFallbackRate: null,
      legacySelectorFallbackUnavailableReason: "legacy_selector_not_invoked",
      legacyComparisonInvocationCount: 0,
      legacyComparisonEligibleCount: null,
      legacyComparisonUnavailableReason: "legacy_comparison_not_executed",
    },
    readiness: {
      hardSafetyGatesPassed: blockers.length === 0,
      blockers,
      proposedAcceptableOrBetterThreshold: 0.85,
      proposedThresholdEvaluated: false,
      candidateFallbackRateThreshold: input.candidateFallbackRateThreshold ?? null,
      candidateFallbackThresholdEvaluated: false,
    },
    redaction: {
      absoluteRootsExcluded: true,
      sourceContentExcluded: true,
      secretsExcluded: true,
      taskTextExcluded: true,
      promptsExcluded: true,
    },
    limitations: [
      "Cross-process and cold-versus-warm determinism remain unqualified.",
      "Contradiction cardinality and detailed operation uniqueness are unavailable at the external primary boundary.",
      "The harness does not invoke Legacy; Legacy fallback rate and comparison eligibility are unavailable.",
    ],
  });
}

function assertPlainRecord(value: unknown): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw new ExternalObservationReportError();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.values(descriptors).some((descriptor) => descriptor.get || descriptor.set || !("value" in descriptor) || !descriptor.enumerable)) {
    throw new ExternalObservationReportError();
  }
}

function assertClosed(value: unknown, fields: readonly string[]): asserts value is Record<string, unknown> {
  assertPlainRecord(value);
  const keys = Object.keys(value);
  if (keys.length !== fields.length || keys.some((key) => !fields.includes(key))) throw new ExternalObservationReportError();
}

function assertDenseArray(value: unknown): asserts value is unknown[] {
  if (!Array.isArray(value)) throw new ExternalObservationReportError();
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) throw new ExternalObservationReportError();
  }
}

function assertFinite(value: unknown, maximum = Number.MAX_SAFE_INTEGER): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > maximum) throw new ExternalObservationReportError();
}

function assertHash(value: unknown): asserts value is string {
  if (typeof value !== "string" || !HASH.test(value)) throw new ExternalObservationReportError();
}

function assertSortedUniqueHashes(value: unknown): asserts value is string[] {
  assertDenseArray(value);
  value.forEach(assertHash);
  if (JSON.stringify(value) !== JSON.stringify(stableStrings(value as string[]))) throw new ExternalObservationReportError();
}

function assertPathArray(value: unknown): asserts value is string[] {
  assertDenseArray(value);
  const seen = new Set<string>();
  value.forEach((item) => {
    if (typeof item !== "string" || !RELATIVE_PATH.test(item) || item.includes("//") || seen.has(item.toLowerCase())) throw new ExternalObservationReportError();
    seen.add(item.toLowerCase());
  });
}

function assertNumberRecord(value: unknown, keys: readonly string[]): void {
  assertClosed(value, keys);
  keys.forEach((key) => assertFinite(value[key]));
}

function assertFileArray(value: unknown): void {
  assertDenseArray(value);
  value.forEach((file) => {
    assertClosed(file, ["path", "role", "usage"]);
    assertPathArray([file.path]);
    if (!ROLES.includes(file.role as ExternalObservationRole) || !USAGES.includes(file.usage as ExternalObservationUsage)) throw new ExternalObservationReportError();
  });
}

function assertMetrics(value: unknown): void {
  assertClosed(value, ["operations", "fileReads", "fileBytes", "parsedFiles", "relationshipHops", "plannerRounds"]);
  Object.values(value).forEach((item) => assertFinite(item));
}

function assertTiming(value: unknown): void {
  assertClosed(value, ["executionMs", "projectionMs", "downstreamValidationMs", "totalMs", "timeoutCeilingMs"]);
  Object.values(value).forEach((item) => assertFinite(item));
}

function assertUnavailableReason(value: unknown): void {
  const allowed: ExternalObservationUnavailableReason[] = ["case_not_executed", "decision_not_produced", "downstream_contract_not_exposed", "legacy_selector_not_invoked", "legacy_comparison_not_executed", "git_metadata_unavailable", "source_identity_unavailable"];
  if (value !== null && !allowed.includes(value as ExternalObservationUnavailableReason)) throw new ExternalObservationReportError();
}

function assertExecutionIdentity(value: unknown): asserts value is ExternalObservationExecutionIdentity {
  assertClosed(value, ["taskFingerprint", "clarificationFingerprint", "inventoryFingerprint", "snapshotFingerprint", "configurationFingerprint"]);
  Object.values(value).forEach(assertHash);
}

function executionIdentityEquivalent(
  first: ExternalObservationExecutionIdentity | null,
  replay: ExternalObservationExecutionIdentity | null,
): boolean {
  return first !== null && replay !== null &&
    first.taskFingerprint === replay.taskFingerprint &&
    first.clarificationFingerprint === replay.clarificationFingerprint &&
    first.inventoryFingerprint === replay.inventoryFingerprint &&
    first.snapshotFingerprint === replay.snapshotFingerprint &&
    first.configurationFingerprint === replay.configurationFingerprint;
}

function assertCase(value: unknown): asserts value is ExternalObservationCase {
  assertClosed(value, ["projectId", "caseId", "repositoryShape", "availability", "actualStatus", "actualPaths", "reasonCodes", "rollbackReason", "verdict", "unsafeAutomaticAdoption", "negativeConstraintViolation", "restrictedEditableSelection", "silentHybridSelection", "modelPlannerUsed", "deterministicReplayEquivalent", "semanticAmbiguityHandledSafely", "groundedRolesSupported", "identity", "selection", "proofs", "authorization", "contradictions", "operations", "timing", "determinism", "fallback"]);
  if (typeof value.projectId !== "string" || !ID.test(value.projectId) || typeof value.caseId !== "string" || !ID.test(value.caseId) || typeof value.repositoryShape !== "string" || !ID.test(value.repositoryShape)) throw new ExternalObservationReportError();
  if (!(["available", "not_run"] as unknown[]).includes(value.availability)) throw new ExternalObservationReportError();
  if (value.actualStatus !== null && !STATUSES.has(value.actualStatus as string)) throw new ExternalObservationReportError();
  if (value.verdict !== null && !VERDICTS.includes(value.verdict as ExternalRetirementVerdict)) throw new ExternalObservationReportError();
  if (value.rollbackReason !== null && !ROLLBACKS.includes(value.rollbackReason as typeof ROLLBACKS[number])) throw new ExternalObservationReportError();
  assertPathArray(value.actualPaths);
  assertDenseArray(value.reasonCodes);
  const reasons = new Set<string>();
  value.reasonCodes.forEach((reason) => {
    if (typeof reason !== "string" || !ERROR_CODE.test(reason) || reasons.has(reason)) throw new ExternalObservationReportError();
    reasons.add(reason);
  });
  ["unsafeAutomaticAdoption", "negativeConstraintViolation", "restrictedEditableSelection", "silentHybridSelection", "modelPlannerUsed", "deterministicReplayEquivalent", "semanticAmbiguityHandledSafely", "groundedRolesSupported"].forEach((key) => {
    if (typeof value[key] !== "boolean") throw new ExternalObservationReportError();
  });
  if (value.identity !== null) {
    assertExecutionIdentity(value.identity);
  }
  assertClosed(value.selection, ["projectedFiles", "appliedFiles"]);
  assertFileArray(value.selection.projectedFiles); assertFileArray(value.selection.appliedFiles);
  assertClosed(value.proofs, ["counts", "appliedGroundedTargetCount"]);
  assertNumberRecord(value.proofs.counts, PROOF_KINDS); assertFinite(value.proofs.appliedGroundedTargetCount);
  assertClosed(value.authorization, ["authorizedEditPaths", "referenceOnlyPaths", "projectedAuthorizationMatchesApplied", "unauthorizedEditableTarget", "unavailableReason"]);
  assertPathArray(value.authorization.authorizedEditPaths); assertPathArray(value.authorization.referenceOnlyPaths);
  if (value.authorization.projectedAuthorizationMatchesApplied !== null && typeof value.authorization.projectedAuthorizationMatchesApplied !== "boolean") throw new ExternalObservationReportError();
  if (typeof value.authorization.unauthorizedEditableTarget !== "boolean") throw new ExternalObservationReportError();
  assertUnavailableReason(value.authorization.unavailableReason);
  assertClosed(value.contradictions, ["count", "unresolvedCount", "blocked", "unavailableReason"]);
  if (value.contradictions.count !== null) assertFinite(value.contradictions.count);
  if (value.contradictions.unresolvedCount !== null) assertFinite(value.contradictions.unresolvedCount);
  if (typeof value.contradictions.blocked !== "boolean") throw new ExternalObservationReportError();
  assertUnavailableReason(value.contradictions.unavailableReason);
  assertClosed(value.operations, ["first", "replay", "searchOperations", "uniqueFilesRead", "uniqueFilesParsed", "unavailableReason"]);
  const operations = value.operations as unknown as ExternalObservationCase["operations"];
  if (operations.first !== null) assertMetrics(operations.first);
  if (operations.replay !== null) assertMetrics(operations.replay);
  (["searchOperations", "uniqueFilesRead", "uniqueFilesParsed"] as const).forEach((key) => { if (operations[key] !== null) assertFinite(operations[key]); });
  assertUnavailableReason(operations.unavailableReason);
  assertClosed(value.timing, ["firstPreparationMs", "replayPreparationMs", "firstExecutionMs", "replayExecutionMs", "firstDecision", "replayDecision", "totalCaseMs"]);
  const timing = value.timing as unknown as ExternalObservationCase["timing"];
  (["firstPreparationMs", "replayPreparationMs", "firstExecutionMs", "replayExecutionMs"] as const).forEach((key) => { if (timing[key] !== null) assertFinite(timing[key]); });
  if (timing.firstDecision !== null) assertTiming(timing.firstDecision);
  if (timing.replayDecision !== null) assertTiming(timing.replayDecision);
  assertFinite(timing.totalCaseMs);
  assertClosed(value.determinism, ["scope", "executionBasisEquivalent", "resultEquivalent", "equivalent", "firstExecutionIdentity", "replayExecutionIdentity", "firstResultIdentity", "replayResultIdentity"]);
  if (value.determinism.scope !== "same_process_same_snapshot" ||
      typeof value.determinism.executionBasisEquivalent !== "boolean" ||
      typeof value.determinism.resultEquivalent !== "boolean" ||
      typeof value.determinism.equivalent !== "boolean") throw new ExternalObservationReportError();
  if (value.determinism.firstExecutionIdentity !== null) assertExecutionIdentity(value.determinism.firstExecutionIdentity);
  if (value.determinism.replayExecutionIdentity !== null) assertExecutionIdentity(value.determinism.replayExecutionIdentity);
  [value.determinism.firstResultIdentity, value.determinism.replayResultIdentity].forEach((identity) => { if (identity !== null) assertHash(identity); });
  assertClosed(value.fallback, ["infrastructureRollback", "semanticLegacyFallback", "legacySelectorInvoked", "legacySelectorUsedFallback"]);
  if (typeof value.fallback.infrastructureRollback !== "boolean" || typeof value.fallback.semanticLegacyFallback !== "boolean" || value.fallback.legacySelectorInvoked !== false || value.fallback.legacySelectorUsedFallback !== null) throw new ExternalObservationReportError();
  const appliedPaths = (value.selection.appliedFiles as unknown as ExternalObservationFile[]).map((file) => file.path).sort();
  const computedExecutionBasisEquivalent = executionIdentityEquivalent(
    value.determinism.firstExecutionIdentity as ExternalObservationExecutionIdentity | null,
    value.determinism.replayExecutionIdentity as ExternalObservationExecutionIdentity | null,
  );
  const resultIdentitiesEquivalent = value.determinism.firstResultIdentity !== null &&
    value.determinism.replayResultIdentity !== null &&
    value.determinism.firstResultIdentity === value.determinism.replayResultIdentity;
  const completeExecutionEvidence = value.determinism.firstExecutionIdentity !== null &&
    value.determinism.replayExecutionIdentity !== null &&
    value.determinism.firstResultIdentity !== null &&
    value.determinism.replayResultIdentity !== null;
  const emptyExecutionEvidence = value.determinism.firstExecutionIdentity === null &&
    value.determinism.replayExecutionIdentity === null &&
    value.determinism.firstResultIdentity === null &&
    value.determinism.replayResultIdentity === null;
  const computedResultEquivalent = resultIdentitiesEquivalent;
  const computedEquivalent = computedExecutionBasisEquivalent && computedResultEquivalent;
  if (JSON.stringify(appliedPaths) !== JSON.stringify([...(value.actualPaths as unknown as string[])].sort()) ||
      (!completeExecutionEvidence && !emptyExecutionEvidence) ||
      value.determinism.executionBasisEquivalent !== computedExecutionBasisEquivalent ||
      value.determinism.resultEquivalent !== computedResultEquivalent ||
      value.determinism.equivalent !== computedEquivalent ||
      value.deterministicReplayEquivalent !== computedEquivalent ||
      value.fallback.infrastructureRollback !== (value.rollbackReason !== null)) throw new ExternalObservationReportError();
  if ((value.identity === null) !== (value.determinism.firstExecutionIdentity === null) ||
      (value.identity !== null && JSON.stringify(value.identity) !== JSON.stringify(value.determinism.firstExecutionIdentity))) throw new ExternalObservationReportError();
  if (value.availability === "not_run" && (value.identity !== null || value.actualStatus !== null || value.verdict !== null || value.actualPaths.length > 0)) throw new ExternalObservationReportError();
}

export function validateExternalObservationReport(raw: ExternalObservationValidationReport): ExternalObservationValidationReport {
  assertClosed(raw, ["schemaVersion", "manifestId", "runId", "createdAt", "run", "engine", "manifest", "repositories", "cases", "metrics", "summary", "determinism", "performance", "fallback", "readiness", "redaction", "limitations"]);
  const clone = structuredClone(raw);
  assertClosed(clone.run, ["contextForgeVersion", "contextForgeGitCommit", "contextForgeWorkingTreeClean", "ce2SourceFingerprint", "observationToolingFingerprint", "harnessMode"]);
  if (clone.schemaVersion !== EXTERNAL_OBSERVATION_SCHEMA_VERSION || !ID.test(clone.manifestId) || !RUN_ID.test(clone.runId) || Number.isNaN(Date.parse(clone.createdAt)) || clone.run.harnessMode !== "external_primary_observation") throw new ExternalObservationReportError();
  if (typeof clone.run.contextForgeVersion !== "string" || clone.run.contextForgeVersion.length === 0 || clone.run.contextForgeVersion.length > 80) throw new ExternalObservationReportError();
  if (clone.run.contextForgeGitCommit !== null && !COMMIT.test(clone.run.contextForgeGitCommit)) throw new ExternalObservationReportError();
  if (clone.run.contextForgeWorkingTreeClean !== null && typeof clone.run.contextForgeWorkingTreeClean !== "boolean") throw new ExternalObservationReportError();
  if (clone.run.ce2SourceFingerprint !== null) assertHash(clone.run.ce2SourceFingerprint);
  if (clone.run.observationToolingFingerprint !== null) assertHash(clone.run.observationToolingFingerprint);
  assertClosed(clone.engine, ["ce2Mode", "plannerMode", "globalDefaultState", "configurationFingerprints"]);
  if (clone.engine.ce2Mode !== "primary" || clone.engine.plannerMode !== "deterministic" || clone.engine.globalDefaultState !== "disabled") throw new ExternalObservationReportError();
  assertSortedUniqueHashes(clone.engine.configurationFingerprints);
  assertClosed(clone.manifest, ["id", "schemaVersion", "normalizedContentHash", "hashNormalization"]);
  if (clone.manifest.id !== clone.manifestId || clone.manifest.schemaVersion !== 1 || clone.manifest.hashNormalization !== "utf8_bom_removed_lf_newlines") throw new ExternalObservationReportError();
  assertHash(clone.manifest.normalizedContentHash);
  assertDenseArray(clone.repositories);
  const repositoriesByProject = new Map<string, ExternalObservationRepositoryIdentity>();
  clone.repositories.forEach((repository) => {
    assertClosed(repository, ["projectId", "gitHead", "workingTreeClean", "gitIdentityUnavailableReason", "inventoryFingerprints", "snapshotFingerprints", "scanDurationMs"]);
    if (typeof repository.projectId !== "string" || !ID.test(repository.projectId)) throw new ExternalObservationReportError();
    if (repository.gitHead !== null && !COMMIT.test(repository.gitHead)) throw new ExternalObservationReportError();
    if (repository.workingTreeClean !== null && typeof repository.workingTreeClean !== "boolean") throw new ExternalObservationReportError();
    assertUnavailableReason(repository.gitIdentityUnavailableReason);
    assertSortedUniqueHashes(repository.inventoryFingerprints);
    assertSortedUniqueHashes(repository.snapshotFingerprints);
    if (repository.scanDurationMs !== null) assertFinite(repository.scanDurationMs);
    if (repositoriesByProject.has(repository.projectId)) throw new ExternalObservationReportError();
    repositoriesByProject.set(repository.projectId, repository);
  });
  assertDenseArray(clone.cases); clone.cases.forEach(assertCase);
  const keys = new Set<string>();
  clone.cases.forEach((item) => { const key = `${item.projectId}\0${item.caseId}`; if (keys.has(key)) throw new ExternalObservationReportError(); keys.add(key); });
  clone.cases.forEach((item) => {
    const repository = repositoriesByProject.get(item.projectId);
    const executionIdentities = [item.determinism.firstExecutionIdentity, item.determinism.replayExecutionIdentity]
      .filter((identity): identity is ExternalObservationExecutionIdentity => identity !== null);
    if (!repository || executionIdentities.some((identity) =>
      !repository.inventoryFingerprints.includes(identity.inventoryFingerprint) ||
      !repository.snapshotFingerprints.includes(identity.snapshotFingerprint))) throw new ExternalObservationReportError();
  });
  const expectedConfigurationFingerprints = stableStrings(clone.cases.flatMap((item) => [
    ...(item.determinism.firstExecutionIdentity ? [item.determinism.firstExecutionIdentity.configurationFingerprint] : []),
    ...(item.determinism.replayExecutionIdentity ? [item.determinism.replayExecutionIdentity.configurationFingerprint] : []),
  ]));
  if (JSON.stringify(clone.engine.configurationFingerprints) !== JSON.stringify(expectedConfigurationFingerprints)) throw new ExternalObservationReportError();
  const canonical = aggregate(clone.cases);
  assertClosed(clone.metrics, ["totalCases", "executedCases", "notRunCases", "verdicts", "groundedApplied", "safeNoSelection", "clarificationRequired", "reviewRequired", "infrastructureRollbackCount", "infrastructureRollbackRate", "rollbackReasons", "semanticLegacyFallbackCount", "unsafeAutomaticAdoptionCount", "negativeConstraintViolations", "deterministicReplayFailures", "unsupportedGroundedRoles", "criticalDisagreements", "acceptableOrBetterRate"]);
  assertNumberRecord(clone.metrics.verdicts, VERDICTS); assertNumberRecord(clone.metrics.rollbackReasons, ROLLBACKS);
  Object.entries(clone.metrics).filter(([, value]) => typeof value === "number").forEach(([, value]) => assertFinite(value));
  assertFinite(clone.metrics.infrastructureRollbackRate, 1);
  assertFinite(clone.metrics.acceptableOrBetterRate, 1);
  assertClosed(clone.summary, ["proofClassCounts", "projectedRoleCounts", "appliedRoleCounts", "projectedUsageCounts", "appliedUsageCounts", "projectedPathCount", "appliedPathCount", "appliedTargetCount", "authorizedEditTargetCount", "unauthorizedEditableTargetCount", "projectedAuthorizationMismatchCount", "contradictionCount", "unresolvedContradictionCount", "contradictionMetricsUnavailableReason", "primaryOperations", "replayOperations", "searchOperations", "uniqueFilesRead", "uniqueFilesParsed", "detailedOperationMetricsUnavailableReason"]);
  assertNumberRecord(clone.summary.proofClassCounts, PROOF_KINDS);
  assertNumberRecord(clone.summary.projectedRoleCounts, ROLES); assertNumberRecord(clone.summary.appliedRoleCounts, ROLES);
  assertNumberRecord(clone.summary.projectedUsageCounts, USAGES); assertNumberRecord(clone.summary.appliedUsageCounts, USAGES);
  const summaryNumberKeys = ["projectedPathCount", "appliedPathCount", "appliedTargetCount", "authorizedEditTargetCount", "unauthorizedEditableTargetCount", "projectedAuthorizationMismatchCount", "contradictionCount", "unresolvedContradictionCount", "searchOperations", "uniqueFilesRead", "uniqueFilesParsed"] as const;
  summaryNumberKeys.forEach((key) => { if (clone.summary[key] !== null) assertFinite(clone.summary[key]); });
  assertUnavailableReason(clone.summary.contradictionMetricsUnavailableReason); assertUnavailableReason(clone.summary.detailedOperationMetricsUnavailableReason);
  assertMetrics(clone.summary.primaryOperations); assertMetrics(clone.summary.replayOperations);
  if (JSON.stringify(clone.metrics) !== JSON.stringify(canonical.metrics) || JSON.stringify(clone.summary) !== JSON.stringify(canonical.summary)) throw new ExternalObservationReportError();
  assertClosed(clone.determinism, ["scope", "comparedCases", "matchingCases", "failureCount", "crossProcessEstablished"]);
  if (clone.determinism.scope !== "same_process_same_snapshot" || clone.determinism.crossProcessEstablished !== false) throw new ExternalObservationReportError();
  [clone.determinism.comparedCases, clone.determinism.matchingCases, clone.determinism.failureCount].forEach((value) => assertFinite(value));
  if (clone.determinism.comparedCases !== canonical.executed.length || clone.determinism.matchingCases + clone.determinism.failureCount !== clone.determinism.comparedCases || clone.determinism.failureCount !== canonical.metrics.deterministicReplayFailures) throw new ExternalObservationReportError();
  assertClosed(clone.performance, ["scanPreparationMs", "firstExecutionMs", "replayExecutionMs", "caseTotalMs", "runTotalMs", "coldWarmClassification", "coldWarmUnavailableReason"]);
  [clone.performance.scanPreparationMs, clone.performance.firstExecutionMs, clone.performance.replayExecutionMs, clone.performance.caseTotalMs, clone.performance.runTotalMs].forEach((value) => assertFinite(value));
  if (clone.performance.coldWarmClassification !== null || clone.performance.coldWarmUnavailableReason !== "cold_warm_not_qualified") throw new ExternalObservationReportError();
  assertClosed(clone.fallback, ["infrastructureRollbackCount", "infrastructureRollbackRate", "semanticLegacyFallbackCount", "semanticLegacyFallbackRate", "legacySelectorInvocationCount", "legacySelectorUsedFallbackCount", "legacySelectorFallbackRate", "legacySelectorFallbackUnavailableReason", "legacyComparisonInvocationCount", "legacyComparisonEligibleCount", "legacyComparisonUnavailableReason"]);
  [clone.fallback.infrastructureRollbackCount, clone.fallback.semanticLegacyFallbackCount].forEach((value) => assertFinite(value));
  [clone.fallback.infrastructureRollbackRate, clone.fallback.semanticLegacyFallbackRate].forEach((value) => assertFinite(value, 1));
  if (clone.fallback.infrastructureRollbackCount !== clone.metrics.infrastructureRollbackCount || clone.fallback.infrastructureRollbackRate !== clone.metrics.infrastructureRollbackRate || clone.fallback.semanticLegacyFallbackCount !== clone.metrics.semanticLegacyFallbackCount || clone.fallback.legacySelectorInvocationCount !== 0 || clone.fallback.legacySelectorUsedFallbackCount !== null || clone.fallback.legacySelectorFallbackRate !== null || clone.fallback.legacySelectorFallbackUnavailableReason !== "legacy_selector_not_invoked" || clone.fallback.legacyComparisonInvocationCount !== 0 || clone.fallback.legacyComparisonEligibleCount !== null || clone.fallback.legacyComparisonUnavailableReason !== "legacy_comparison_not_executed") throw new ExternalObservationReportError();
  assertClosed(clone.readiness, ["hardSafetyGatesPassed", "blockers", "proposedAcceptableOrBetterThreshold", "proposedThresholdEvaluated", "candidateFallbackRateThreshold", "candidateFallbackThresholdEvaluated"]);
  assertDenseArray(clone.readiness.blockers);
  if (clone.readiness.blockers.some((value) => typeof value !== "string" || !BLOCKERS.has(value)) || clone.readiness.hardSafetyGatesPassed !== (canonical.blockers.length === 0) || JSON.stringify(clone.readiness.blockers) !== JSON.stringify(canonical.blockers) || clone.readiness.proposedAcceptableOrBetterThreshold !== 0.85 || clone.readiness.proposedThresholdEvaluated !== false || clone.readiness.candidateFallbackThresholdEvaluated !== false) throw new ExternalObservationReportError();
  if (clone.readiness.candidateFallbackRateThreshold !== null) assertFinite(clone.readiness.candidateFallbackRateThreshold, 1);
  assertClosed(clone.redaction, ["absoluteRootsExcluded", "sourceContentExcluded", "secretsExcluded", "taskTextExcluded", "promptsExcluded"]);
  if (Object.values(clone.redaction).some((value) => value !== true)) throw new ExternalObservationReportError();
  assertDenseArray(clone.limitations);
  clone.limitations.forEach((value) => { if (typeof value !== "string" || value.length === 0 || value.length > 240) throw new ExternalObservationReportError(); });
  const expectedRunId = `external-${hash(runIdentityBasis(clone)).slice("sha256:".length, "sha256:".length + 32)}`;
  if (clone.runId !== expectedRunId) throw new ExternalObservationReportError();
  const serialized = JSON.stringify(clone);
  if (containsAbsolutePathOrFileUri(serialized) || containsSecretLikeSemanticValue(serialized) || /[\0-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(serialized)) throw new ExternalObservationReportError();
  return clone;
}

export function serializeExternalObservationReportJson(report: ExternalObservationValidationReport): string {
  return `${JSON.stringify(validateExternalObservationReport(report), null, 2)}\n`;
}

export function renderExternalObservationReportMarkdown(raw: ExternalObservationValidationReport): string {
  const report = validateExternalObservationReport(raw);
  return [
    "# Context Engine v2 External Observation",
    "",
    `- Schema: ${report.schemaVersion}`,
    `- Run: ${report.runId}`,
    `- Manifest: ${report.manifest.id} (${report.manifest.normalizedContentHash})`,
    `- Executed / total: ${report.metrics.executedCases} / ${report.metrics.totalCases}`,
    `- Hard safety gates: ${report.readiness.hardSafetyGatesPassed ? "PASS" : "FAIL"}`,
    `- Same-process / same-snapshot determinism: ${report.determinism.matchingCases} / ${report.determinism.comparedCases}`,
    `- Infrastructure rollback: ${report.fallback.infrastructureRollbackCount}`,
    `- Semantic Legacy fallback: ${report.fallback.semanticLegacyFallbackCount}`,
    "- Legacy selector fallback: unavailable (Legacy selector not invoked)",
    "",
    "## Verdicts",
    "",
    ...VERDICTS.map((verdict) => `- ${verdict}: ${report.metrics.verdicts[verdict]}`),
    "",
    "## Cases",
    "",
    "| Project | Case | Status | Verdict | Applied selection | Duration (ms) |",
    "|---|---|---|---|---|---:|",
    ...report.cases.map((item) => `| ${item.projectId} | ${item.caseId} | ${item.actualStatus ?? "not_run"} | ${item.verdict ?? "NOT_RUN"} | ${item.actualPaths.join(", ") || "none"} | ${item.timing.totalCaseMs.toFixed(1)} |`),
    "",
    "## Known unavailable metrics",
    "",
    ...report.limitations.map((item) => `- ${item}`),
    "",
  ].join("\n");
}

async function atomicWrite(filePath: string, contents: string): Promise<void> {
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, contents, "utf8");
  await fs.rename(temporary, filePath);
}

export async function writeExternalObservationReport(report: ExternalObservationValidationReport, outputDirectory: string): Promise<void> {
  const validated = validateExternalObservationReport(report);
  await fs.mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    atomicWrite(path.join(outputDirectory, "results.json"), serializeExternalObservationReportJson(validated)),
    atomicWrite(path.join(outputDirectory, "report.md"), renderExternalObservationReportMarkdown(validated)),
  ]);
}
