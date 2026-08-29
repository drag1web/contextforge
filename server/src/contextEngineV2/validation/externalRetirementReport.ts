import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { containsSecretLikeSemanticValue } from "../domain/semanticLiteralSafety.js";
import { containsAbsolutePathOrFileUri } from "./validationPrivacy.js";

export type ExternalRetirementVerdict = "PASS" | "ACCEPTABLE" | "SAFE_FAIL" | "CRITICAL_FAIL" | "ENGINE_ERROR";

export interface ExternalRetirementCaseObservation {
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
}

export interface ExternalRetirementValidationReport {
  schemaVersion: 1;
  manifestId: string;
  runId: string;
  createdAt: string;
  cases: ExternalRetirementCaseObservation[];
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
  };
  limitations: string[];
}

const ID = /^[a-z0-9][a-z0-9._:-]{0,100}$/u;
const HASH_ID = /^external-[a-f0-9]{32}$/u;
const RELATIVE_PATH = /^(?!\/)(?![A-Za-z]:)(?!.*(?:^|\/)\.\.(?:\/|$))[^\\\u0000-\u001f]+$/u;
const ERROR_CODE = /^[a-z][a-z0-9_.:-]{0,80}$/u;
const STATUSES = new Set(["v2_applied", "v2_no_selection", "clarification_required", "review_required", "safe_fail", "legacy_rollback", "engine_error"]);
const VERDICTS: ExternalRetirementVerdict[] = ["PASS", "ACCEPTABLE", "SAFE_FAIL", "CRITICAL_FAIL", "ENGINE_ERROR"];
const ROLLBACKS = ["capacity_exhausted", "execution_timeout", "execution_error"] as const;
const BLOCKERS = new Set(["no_executed_cases", "incomplete_execution", "critical_failures", "engine_errors", "unsafe_automatic_adoption", "negative_constraint_violations", "semantic_legacy_fallback", "deterministic_replay_failures", "unsupported_grounded_roles"]);

export class ExternalRetirementReportError extends Error {
  readonly code = "invalid_external_retirement_report" as const;
  constructor() {
    super("External retirement report failed privacy-safe runtime validation.");
    this.name = "ExternalRetirementReportError";
  }
}

function closedRecord(value: unknown, fields: readonly string[]): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw new ExternalRetirementReportError();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== fields.length || keys.some((key) => typeof key !== "string" || !fields.includes(key)) ||
      Object.values(descriptors).some((descriptor) => descriptor.get || descriptor.set || !("value" in descriptor) || !descriptor.enumerable)) {
    throw new ExternalRetirementReportError();
  }
}

function denseArray(value: unknown): asserts value is unknown[] {
  if (!Array.isArray(value)) throw new ExternalRetirementReportError();
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) throw new ExternalRetirementReportError();
  }
}

function assertClosedReportShape(raw: ExternalRetirementValidationReport): void {
  closedRecord(raw, ["schemaVersion", "manifestId", "runId", "createdAt", "cases", "metrics", "readiness", "redaction", "limitations"]);
  denseArray(raw.cases);
  raw.cases.forEach((item) => {
    closedRecord(item, ["projectId", "caseId", "repositoryShape", "availability", "actualStatus", "actualPaths", "reasonCodes", "rollbackReason", "verdict", "unsafeAutomaticAdoption", "negativeConstraintViolation", "restrictedEditableSelection", "silentHybridSelection", "modelPlannerUsed", "deterministicReplayEquivalent", "semanticAmbiguityHandledSafely", "groundedRolesSupported"]);
    denseArray(item.actualPaths);
    denseArray(item.reasonCodes);
  });
  closedRecord(raw.metrics, ["totalCases", "executedCases", "notRunCases", "verdicts", "groundedApplied", "safeNoSelection", "clarificationRequired", "reviewRequired", "infrastructureRollbackCount", "infrastructureRollbackRate", "rollbackReasons", "semanticLegacyFallbackCount", "unsafeAutomaticAdoptionCount", "negativeConstraintViolations", "deterministicReplayFailures", "unsupportedGroundedRoles", "criticalDisagreements", "acceptableOrBetterRate"]);
  closedRecord(raw.metrics.verdicts, VERDICTS);
  closedRecord(raw.metrics.rollbackReasons, ROLLBACKS);
  closedRecord(raw.readiness, ["hardSafetyGatesPassed", "blockers", "proposedAcceptableOrBetterThreshold", "proposedThresholdEvaluated", "candidateFallbackRateThreshold", "candidateFallbackThresholdEvaluated"]);
  denseArray(raw.readiness.blockers);
  closedRecord(raw.redaction, ["absoluteRootsExcluded", "sourceContentExcluded", "secretsExcluded"]);
  denseArray(raw.limitations);
  raw.limitations.forEach((value) => {
    if (typeof value !== "string" || value.length === 0 || value.length > 240 || containsAbsolutePathOrFileUri(value) || containsSecretLikeSemanticValue(value) || /[\0-\x1f\x7f]/u.test(value)) {
      throw new ExternalRetirementReportError();
    }
  });
}

function portableId(value: string): void {
  if (!ID.test(value)) throw new ExternalRetirementReportError();
}

function finite(value: number, maximum = Number.MAX_SAFE_INTEGER): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > maximum) throw new ExternalRetirementReportError();
}

function assertObservation(item: ExternalRetirementCaseObservation): void {
  portableId(item.projectId); portableId(item.caseId); portableId(item.repositoryShape);
  if (item.availability !== "available" && item.availability !== "not_run") throw new ExternalRetirementReportError();
  if (item.actualStatus !== null && !STATUSES.has(item.actualStatus)) throw new ExternalRetirementReportError();
  if (item.verdict !== null && !VERDICTS.includes(item.verdict)) throw new ExternalRetirementReportError();
  if (item.rollbackReason !== null && !ROLLBACKS.includes(item.rollbackReason)) throw new ExternalRetirementReportError();
  const pathKeys = new Set<string>();
  item.actualPaths.forEach((value) => {
    if (!RELATIVE_PATH.test(value) || value.includes("//") || pathKeys.has(value.toLowerCase())) throw new ExternalRetirementReportError();
    pathKeys.add(value.toLowerCase());
  });
  const reasons = new Set<string>();
  item.reasonCodes.forEach((value) => {
    if (!ERROR_CODE.test(value) || containsSecretLikeSemanticValue(value) || containsAbsolutePathOrFileUri(value) || reasons.has(value)) throw new ExternalRetirementReportError();
    reasons.add(value);
  });
  ["unsafeAutomaticAdoption", "negativeConstraintViolation", "restrictedEditableSelection", "silentHybridSelection", "modelPlannerUsed", "deterministicReplayEquivalent", "semanticAmbiguityHandledSafely", "groundedRolesSupported"].forEach((key) => {
    if (typeof item[key as keyof ExternalRetirementCaseObservation] !== "boolean") throw new ExternalRetirementReportError();
  });
  if (item.availability === "not_run" && (item.actualStatus !== null || item.verdict !== null || item.actualPaths.length > 0 || item.reasonCodes.length > 0)) {
    throw new ExternalRetirementReportError();
  }
}

function totals(cases: readonly ExternalRetirementCaseObservation[]) {
  const executed = cases.filter((item) => item.availability === "available");
  const verdicts = Object.fromEntries(VERDICTS.map((verdict) => [verdict, executed.filter((item) => item.verdict === verdict).length])) as Record<ExternalRetirementVerdict, number>;
  const rollbackReasons = Object.fromEntries(ROLLBACKS.map((reason) => [reason, executed.filter((item) => item.rollbackReason === reason).length])) as Record<typeof ROLLBACKS[number], number>;
  const infrastructureRollbackCount = ROLLBACKS.reduce((sum, reason) => sum + rollbackReasons[reason], 0);
  const metric = {
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
    semanticLegacyFallbackCount: executed.filter((item) => item.actualStatus === "legacy_rollback" && item.rollbackReason === null).length,
    unsafeAutomaticAdoptionCount: executed.filter((item) => item.unsafeAutomaticAdoption).length,
    negativeConstraintViolations: executed.filter((item) => item.negativeConstraintViolation).length,
    deterministicReplayFailures: executed.filter((item) => !item.deterministicReplayEquivalent).length,
    unsupportedGroundedRoles: executed.filter((item) => !item.groundedRolesSupported).length,
    criticalDisagreements: verdicts.CRITICAL_FAIL,
    acceptableOrBetterRate: executed.length === 0 ? 0 : (verdicts.PASS + verdicts.ACCEPTABLE) / executed.length,
  };
  const blockers = [
    ...(executed.length === 0 ? ["no_executed_cases"] : []),
    ...(cases.length > executed.length ? ["incomplete_execution"] : []),
    ...(verdicts.CRITICAL_FAIL > 0 ? ["critical_failures"] : []),
    ...(verdicts.ENGINE_ERROR > 0 ? ["engine_errors"] : []),
    ...(metric.unsafeAutomaticAdoptionCount > 0 ? ["unsafe_automatic_adoption"] : []),
    ...(metric.negativeConstraintViolations > 0 ? ["negative_constraint_violations"] : []),
    ...(metric.semanticLegacyFallbackCount > 0 ? ["semantic_legacy_fallback"] : []),
    ...(metric.deterministicReplayFailures > 0 ? ["deterministic_replay_failures"] : []),
    ...(metric.unsupportedGroundedRoles > 0 ? ["unsupported_grounded_roles"] : []),
  ];
  return { metric, blockers };
}

export function createExternalRetirementReport(input: {
  manifestId: string;
  createdAt: string;
  cases: readonly ExternalRetirementCaseObservation[];
  candidateFallbackRateThreshold?: number;
}): ExternalRetirementValidationReport {
  portableId(input.manifestId);
  const cases = [...structuredClone(input.cases)].sort((left, right) => left.projectId.localeCompare(right.projectId) || left.caseId.localeCompare(right.caseId));
  cases.forEach(assertObservation);
  const seen = new Set<string>();
  cases.forEach((item) => {
    if (seen.has(item.caseId)) throw new ExternalRetirementReportError();
    seen.add(item.caseId);
  });
  const { metric, blockers } = totals(cases);
  const runId = `external-${createHash("sha256").update(JSON.stringify({ manifestId: input.manifestId, cases }), "utf8").digest("hex").slice(0, 32)}`;
  return validateExternalRetirementReport({
    schemaVersion: 1,
    manifestId: input.manifestId,
    runId,
    createdAt: input.createdAt,
    cases,
    metrics: metric,
    readiness: {
      hardSafetyGatesPassed: blockers.length === 0,
      blockers,
      proposedAcceptableOrBetterThreshold: 0.85,
      proposedThresholdEvaluated: false,
      candidateFallbackRateThreshold: input.candidateFallbackRateThreshold ?? null,
      candidateFallbackThresholdEvaluated: false,
    },
    redaction: { absoluteRootsExcluded: true, sourceContentExcluded: true, secretsExcluded: true },
    limitations: [
      "Cross-project observation window and human retirement approval remain pending.",
      "Fallback-rate and acceptable-or-better thresholds remain candidate policies until approved.",
      "Portable reports contain identifiers, relative paths, reason codes and counters only.",
    ],
  });
}

export function validateExternalRetirementReport(raw: ExternalRetirementValidationReport): ExternalRetirementValidationReport {
  assertClosedReportShape(raw);
  const clone = structuredClone(raw);
  assertClosedReportShape(clone);
  if (clone.schemaVersion !== 1 || !ID.test(clone.manifestId) || !HASH_ID.test(clone.runId) || Number.isNaN(Date.parse(clone.createdAt))) throw new ExternalRetirementReportError();
  if (!Array.isArray(clone.cases)) throw new ExternalRetirementReportError();
  clone.cases.forEach(assertObservation);
  const caseIds = new Set<string>();
  clone.cases.forEach((item) => {
    if (caseIds.has(item.caseId)) throw new ExternalRetirementReportError();
    caseIds.add(item.caseId);
  });
  const canonical = totals(clone.cases);
  const expectedRunId = `external-${createHash("sha256").update(JSON.stringify({ manifestId: clone.manifestId, cases: clone.cases }), "utf8").digest("hex").slice(0, 32)}`;
  if (clone.runId !== expectedRunId || JSON.stringify(clone.metrics) !== JSON.stringify(canonical.metric) ||
      clone.readiness.hardSafetyGatesPassed !== (canonical.blockers.length === 0) ||
      JSON.stringify(clone.readiness.blockers) !== JSON.stringify(canonical.blockers) ||
      clone.readiness.proposedAcceptableOrBetterThreshold !== 0.85 || clone.readiness.proposedThresholdEvaluated !== false ||
      clone.readiness.candidateFallbackThresholdEvaluated !== false ||
      (clone.readiness.candidateFallbackRateThreshold !== null &&
       (!Number.isFinite(clone.readiness.candidateFallbackRateThreshold) || clone.readiness.candidateFallbackRateThreshold < 0 || clone.readiness.candidateFallbackRateThreshold > 1))) {
    throw new ExternalRetirementReportError();
  }
  Object.values(clone.metrics.verdicts).forEach((value) => finite(value));
  Object.values(clone.metrics.rollbackReasons).forEach((value) => finite(value));
  finite(clone.metrics.infrastructureRollbackRate, 1); finite(clone.metrics.acceptableOrBetterRate, 1);
  if (clone.readiness.blockers.some((value) => !BLOCKERS.has(value)) || clone.redaction.absoluteRootsExcluded !== true ||
      clone.redaction.sourceContentExcluded !== true || clone.redaction.secretsExcluded !== true || !Array.isArray(clone.limitations)) throw new ExternalRetirementReportError();
  const serialized = JSON.stringify(clone);
  if (containsAbsolutePathOrFileUri(serialized) || containsSecretLikeSemanticValue(serialized) || /[\0-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(serialized)) throw new ExternalRetirementReportError();
  return clone;
}

export function serializeExternalRetirementReportJson(report: ExternalRetirementValidationReport): string {
  return `${JSON.stringify(validateExternalRetirementReport(report), null, 2)}\n`;
}

export function renderExternalRetirementReportMarkdown(raw: ExternalRetirementValidationReport): string {
  const report = validateExternalRetirementReport(raw);
  return [
    "# Context Engine v2 External Retirement Validation",
    "",
    `- Run: ${report.runId}`,
    `- Executed / total: ${report.metrics.executedCases} / ${report.metrics.totalCases}`,
    `- Hard safety gates: ${report.readiness.hardSafetyGatesPassed ? "PASS" : "FAIL"}`,
    `- Grounded applied: ${report.metrics.groundedApplied}`,
    `- Safe no-selection: ${report.metrics.safeNoSelection}`,
    `- Clarification / review required: ${report.metrics.clarificationRequired} / ${report.metrics.reviewRequired}`,
    `- Primary infrastructure rollback-eligible outcomes: ${report.metrics.infrastructureRollbackCount} (${(report.metrics.infrastructureRollbackRate * 100).toFixed(1)}%; legacy selector not executed by this harness)`,
    `- Semantic legacy fallback: ${report.metrics.semanticLegacyFallbackCount}`,
    `- Unsafe automatic adoption: ${report.metrics.unsafeAutomaticAdoptionCount}`,
    `- Negative-constraint violations: ${report.metrics.negativeConstraintViolations}`,
    `- Deterministic replay failures: ${report.metrics.deterministicReplayFailures}`,
    `- Unsupported grounded roles: ${report.metrics.unsupportedGroundedRoles}`,
    "",
    "## Verdicts",
    "",
    ...VERDICTS.map((verdict) => `- ${verdict}: ${report.metrics.verdicts[verdict]}`),
    "",
    "## Cases",
    "",
    "| Project | Case | Availability | Status | Verdict | Relative selection |",
    "|---|---|---|---|---|---|",
    ...report.cases.map((item) => `| ${item.projectId} | ${item.caseId} | ${item.availability} | ${item.actualStatus ?? "not_run"} | ${item.verdict ?? "NOT_RUN"} | ${item.actualPaths.join(", ") || "none"} |`),
    "",
    "## Readiness blockers",
    "",
    ...(report.readiness.blockers.length ? report.readiness.blockers.map((item) => `- ${item}`) : ["- None"]),
    "",
    `> The acceptable-or-better threshold (${(report.readiness.proposedAcceptableOrBetterThreshold * 100).toFixed(0)}%) and fallback-rate threshold are candidate policies and are not evaluated without human approval.`,
    "",
  ].join("\n");
}

async function atomicWrite(filePath: string, contents: string): Promise<void> {
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, contents, "utf8");
  await fs.rename(temporary, filePath);
}

export async function writeExternalRetirementReport(report: ExternalRetirementValidationReport, outputDirectory: string): Promise<void> {
  const validated = validateExternalRetirementReport(report);
  await fs.mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    atomicWrite(path.join(outputDirectory, "results.json"), serializeExternalRetirementReportJson(validated)),
    atomicWrite(path.join(outputDirectory, "report.md"), renderExternalRetirementReportMarkdown(validated)),
  ]);
}
