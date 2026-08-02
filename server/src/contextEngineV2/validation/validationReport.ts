import fs from "node:fs/promises";
import path from "node:path";

import {
  assertClosedRecord,
  assertPortableIdentifier,
  assertSafeText,
  cloneDomainValue,
  stableCompare,
} from "../domain/investigationDomainSupport.js";
import { validateGoldenTraceSummary } from "./goldenTraceSummary.js";
import { evaluateValidationGate } from "./validationMetrics.js";
import {
  containsAbsolutePathOrFileUri,
  normalizeValidationErrorCode,
  validateStageTimings,
} from "./validationPrivacy.js";
import type {
  ContextEngineValidationReport,
  ValidationVerdict,
} from "./validationTypes.js";

const REPORT_FIELDS = [
  "schemaVersion", "manifest", "run", "projects", "cases", "metrics", "gate",
  "unavailableProjects", "redaction", "knownLimitations",
] as const;
const VERDICT_ORDER: ValidationVerdict[] = [
  "PASS", "ACCEPTABLE", "SAFE_FAIL", "CRITICAL_FAIL", "ENGINE_ERROR", "NOT_RUN",
];
const VERDICTS = new Set(VERDICT_ORDER);
const SEVERITIES = new Set(["critical", "high", "medium", "low"]);
const FAILURE_CATEGORIES = new Set(["safety", "knowledge", "projection", "efficiency", "compatibility"]);
const EXECUTION_MARKERS = new Set(["real_engine", "fixture_result"]);
const COMPARISON_OUTCOMES = new Set(["equivalent_supported", "v2_better_supported", "legacy_better_supported", "both_safe_unresolved", "v2_safe_legacy_risky", "legacy_safe_v2_risky", "different_but_both_acceptable", "insufficient_evaluation_data", "v2_execution_failure"]);
const STOP_REASONS = new Set(["sufficient_evidence", "clarification_required", "no_grounded_lead", "contradictory_evidence", "operation_budget_exhausted", "file_budget_exhausted", "byte_budget_exhausted", "time_budget_exhausted", "planner_round_budget_exhausted", "repository_snapshot_truncated", "repository_changed", "safety_blocked", "internal_error"]);
const PATH_ARRAY_FIELDS = ["selectedPaths", "implementationTargetPaths", "testPaths", "editablePaths", "targetPaths", "supportingPaths", "referencePaths"] as const;

function denseArray(value: unknown, label: string): asserts value is unknown[] {
  if (!Array.isArray(value)) throw new ValidationReportError(`${label} must be an array.`);
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) throw new ValidationReportError(`${label} must be dense.`);
  }
}

function strictClosedRecord(
  value: unknown,
  allowedFields: readonly string[],
  requiredFields: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  assertClosedRecord(value, allowedFields, requiredFields, label);
  const allowed = new Set(allowedFields);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== "string" || !allowed.has(key))) {
    throw new ValidationReportError(`${label} contains unsupported fields.`);
  }
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!("value" in descriptor) || !descriptor.enumerable) {
      throw new ValidationReportError(`${label}.${key} must be an enumerable data property.`);
    }
  }
}

function enumValue(value: unknown, allowed: ReadonlySet<string>, label: string): asserts value is string {
  if (typeof value !== "string" || !allowed.has(value)) throw new ValidationReportError(`${label} is unsupported.`);
}

function finite(value: unknown, label: string, maximum?: number): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || (maximum !== undefined && value > maximum)) {
    throw new ValidationReportError(`${label} must be a finite non-negative number.`);
  }
}

function integer(value: unknown, label: string): asserts value is number {
  finite(value, label);
  if (!Number.isSafeInteger(value)) throw new ValidationReportError(`${label} must be a safe integer.`);
}

function normalizedPath(value: unknown, label: string): asserts value is string {
  assertSafeText(value, label);
  if (value.startsWith("/") || /^[A-Za-z]:/u.test(value) || value.includes("\\") || value.includes("//") || value.endsWith("/") ||
    value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new ValidationReportError(`${label} must be repository-relative.`);
  }
}

function stringArray(value: unknown, label: string, portable = true): asserts value is string[] {
  denseArray(value, label);
  value.forEach((entry) => portable ? assertPortableIdentifier(entry, label) : assertSafeText(entry, label));
  if (new Set(value).size !== value.length) throw new ValidationReportError(`${label} contains duplicates.`);
}

function pathArray(value: unknown, label: string): asserts value is string[] {
  denseArray(value, label);
  value.forEach((entry) => normalizedPath(entry, label));
  if (new Set(value).size !== value.length) throw new ValidationReportError(`${label} contains duplicates.`);
}

function validateVerdictCounts(value: unknown, label: string): void {
  strictClosedRecord(value, VERDICT_ORDER, VERDICT_ORDER, label);
  VERDICT_ORDER.forEach((verdict) => integer(value[verdict], `${label}.${verdict}`));
}

function validateCaseMetrics(value: unknown): void {
  strictClosedRecord(value, ["safety", "knowledge", "projection", "efficiency"], ["safety", "knowledge", "projection", "efficiency"], "Case metrics");
  const numberRecord = (record: unknown, fields: readonly string[], label: string) => {
    strictClosedRecord(record, fields, fields, label);
    fields.forEach((field) => finite(record[field], `${label}.${field}`));
  };
  numberRecord(value.safety, ["criticalFailures", "negativeConstraintViolations", "unsafeEditableAuthorizations", "explicitTargetViolations", "mixedSnapshotRecords"], "Case safety metrics");
  const knowledge = value.knowledge;
  strictClosedRecord(knowledge, ["confirmedFindings", "confirmedFindingsWithCompleteEvidence", "unsupportedConfirmedFindings", "criticalQuestionCoverage", "stopReasonCorrect"], ["confirmedFindings", "confirmedFindingsWithCompleteEvidence", "unsupportedConfirmedFindings", "criticalQuestionCoverage", "stopReasonCorrect"], "Case knowledge metrics");
  ["confirmedFindings", "confirmedFindingsWithCompleteEvidence", "unsupportedConfirmedFindings"].forEach((field) => finite(knowledge[field], `Case knowledge metrics.${field}`));
  finite(knowledge.criticalQuestionCoverage, "Case critical question coverage", 1);
  if (typeof knowledge.stopReasonCorrect !== "boolean") throw new ValidationReportError();
  numberRecord(value.projection, ["requiredTargetHits", "requiredTargetCount", "projectedTargetCount", "requiredTestHits", "requiredTestCount", "unexpectedEditablePaths", "explicitTargetsPreserved", "explicitTargetCount"], "Case projection metrics");
  const efficiency = value.efficiency;
  strictClosedRecord(efficiency, ["operations", "searches", "reads", "bytes", "parsedFiles", "relationshipHops", "plannerRounds", "durationMs", "stageTimingsMs"], ["operations", "searches", "reads", "bytes", "parsedFiles", "relationshipHops", "plannerRounds", "durationMs", "stageTimingsMs"], "Case efficiency metrics");
  ["operations", "searches", "reads", "bytes", "parsedFiles", "relationshipHops", "plannerRounds", "durationMs"].forEach((field) => finite(efficiency[field], `Case efficiency metrics.${field}`));
  validateStageTimings(efficiency.stageTimingsMs);
}

function validateCompatibility(value: unknown): void {
  strictClosedRecord(value, ["legacy", "v2", "overlap", "safety", "evidence", "explicitTargets", "explicitTargetsPreservedByLegacy", "explicitTargetsPreservedByV2", "explicitTargetDisagreements", "outcome", "evaluationBasis"], ["legacy", "v2", "overlap", "safety", "evidence", "explicitTargets", "explicitTargetsPreservedByLegacy", "explicitTargetsPreservedByV2", "explicitTargetDisagreements", "outcome"], "Compatibility summary");
  const legacy = value.legacy;
  strictClosedRecord(legacy, [...PATH_ARRAY_FIELDS, "usedFallback", "source"], [...PATH_ARRAY_FIELDS, "usedFallback", "source"], "Legacy comparison summary");
  PATH_ARRAY_FIELDS.forEach((field) => pathArray(legacy[field], `Legacy ${field}`));
  if (typeof legacy.usedFallback !== "boolean") throw new ValidationReportError();
  enumValue(legacy.source, new Set(["ollama", "fallback", "shadow", "fast-path", "deterministic"]), "Legacy source");
  const v2 = value.v2;
  strictClosedRecord(v2, [...PATH_ARRAY_FIELDS, "snapshotId", "purpose", "traceablePaths", "stopReason", "safeToProject", "blocked"], [...PATH_ARRAY_FIELDS, "snapshotId", "purpose", "traceablePaths", "stopReason", "safeToProject", "blocked"], "V2 comparison summary");
  PATH_ARRAY_FIELDS.forEach((field) => pathArray(v2[field], `V2 ${field}`));
  pathArray(v2.traceablePaths, "V2 traceable paths");
  assertPortableIdentifier(v2.snapshotId, "V2 comparison snapshot");
  enumValue(v2.purpose, new Set(["implementation", "review", "clarification", "legacy_selection"]), "V2 projection purpose");
  enumValue(v2.stopReason, STOP_REASONS, "V2 stop reason");
  if (typeof v2.safeToProject !== "boolean" || typeof v2.blocked !== "boolean") throw new ValidationReportError();
  const overlapFields = ["exactTargetPaths", "legacyOnlyTargetPaths", "v2OnlyTargetPaths", "exactEditablePaths", "legacyOnlyEditablePaths", "v2OnlyEditablePaths", "supportingOrReferenceOverlap", "allSelectedOverlap"];
  const overlap = value.overlap;
  strictClosedRecord(overlap, overlapFields, overlapFields, "Compatibility overlap");
  overlapFields.forEach((field) => pathArray(overlap[field], `Compatibility overlap.${field}`));
  const safetyPaths = ["legacyNegativeConstraintViolations", "v2NegativeConstraintViolations", "legacyRepositorySafetyViolations", "v2RepositorySafetyViolations"];
  const safety = value.safety;
  strictClosedRecord(safety, [...safetyPaths, "legacyBlocked", "v2Blocked", "safeBlockAgreement"], [...safetyPaths, "legacyBlocked", "v2Blocked", "safeBlockAgreement"], "Compatibility safety");
  safetyPaths.forEach((field) => pathArray(safety[field], `Compatibility safety.${field}`));
  ["legacyBlocked", "v2Blocked", "safeBlockAgreement"].forEach((field) => { if (typeof safety[field] !== "boolean") throw new ValidationReportError(); });
  strictClosedRecord(value.evidence, ["v2TraceableSelectedPaths", "v2UntraceableSelectedPaths", "legacyEvidenceAvailability"], ["v2TraceableSelectedPaths", "v2UntraceableSelectedPaths", "legacyEvidenceAvailability"], "Compatibility evidence");
  pathArray(value.evidence.v2TraceableSelectedPaths, "Traceable paths");
  pathArray(value.evidence.v2UntraceableSelectedPaths, "Untraceable paths");
  if (value.evidence.legacyEvidenceAvailability !== "not_evaluated") throw new ValidationReportError();
  denseArray(value.explicitTargets, "Explicit target comparisons");
  value.explicitTargets.forEach((record) => {
    strictClosedRecord(record, ["targetKey", "kind", "resolvedPath", "legacyStatus", "v2Status", "disagreement"], ["targetKey", "kind", "legacyStatus", "v2Status", "disagreement"], "Explicit target comparison");
    assertSafeText(record.targetKey, "Explicit target key");
    enumValue(record.kind, new Set(["path", "symbol"]), "Explicit target kind");
    if (record.resolvedPath !== undefined) normalizedPath(record.resolvedPath, "Explicit target resolved path");
    enumValue(record.legacyStatus, new Set(["preserved", "dropped", "unresolved", "unknown"]), "Explicit target legacy status");
    enumValue(record.v2Status, new Set(["preserved", "dropped", "unresolved", "unknown"]), "Explicit target v2 status");
    if (typeof record.disagreement !== "boolean") throw new ValidationReportError();
  });
  stringArray(value.explicitTargetsPreservedByLegacy, "Legacy explicit targets", false);
  stringArray(value.explicitTargetsPreservedByV2, "V2 explicit targets", false);
  stringArray(value.explicitTargetDisagreements, "Explicit target disagreements", false);
  enumValue(value.outcome, COMPARISON_OUTCOMES, "Compatibility outcome");
  if (value.evaluationBasis !== undefined) {
    strictClosedRecord(value.evaluationBasis, ["kind", "referenceId", "outcome"], ["kind", "referenceId", "outcome"], "Compatibility basis");
    enumValue(value.evaluationBasis.kind, new Set(["manifest", "expert"]), "Compatibility basis kind");
    assertPortableIdentifier(value.evaluationBasis.referenceId, "Compatibility basis reference");
    enumValue(value.evaluationBasis.outcome, COMPARISON_OUTCOMES, "Compatibility basis outcome");
  }
}

export class ValidationReportError extends Error {
  readonly code = "invalid_validation_report" as const;
  readonly stage = "CE2-06" as const;

  constructor(message = "Validation report failed privacy-safe runtime validation.") {
    super(message);
    this.name = "ValidationReportError";
  }
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function assertReportShape(report: ContextEngineValidationReport): void {
    strictClosedRecord(report, REPORT_FIELDS, REPORT_FIELDS, "Validation report");
    if (report.schemaVersion !== 1) throw new ValidationReportError();
    strictClosedRecord(report.manifest, ["schemaVersion", "manifestId", "title"], ["schemaVersion", "manifestId", "title"], "Report manifest");
    if (report.manifest.schemaVersion !== 1) throw new ValidationReportError();
    assertPortableIdentifier(report.manifest.manifestId, "Report manifest id");
    assertSafeText(report.manifest.title, "Report manifest title");
    strictClosedRecord(report.run, ["runId", "mode", "repeatCount", "projectFilter", "caseFilter"], ["runId", "mode", "repeatCount", "projectFilter", "caseFilter"], "Report run");
    assertPortableIdentifier(report.run.runId, "Report run id");
    enumValue(report.run.mode, new Set(["verify", "update_golden"]), "Report run mode");
    integer(report.run.repeatCount, "Report repeat count");
    if (report.run.repeatCount < 1) throw new ValidationReportError();
    stringArray(report.run.projectFilter, "Report project filter");
    stringArray(report.run.caseFilter, "Report case filter");
    denseArray(report.projects, "Report projects");
    const projectIds = new Set<string>();
    report.projects.forEach((project) => {
      strictClosedRecord(project, ["projectId", "available", "cases", "verdicts"], ["projectId", "available", "cases", "verdicts"], "Report project");
      assertPortableIdentifier(project.projectId, "Report project id");
      if (projectIds.has(project.projectId)) throw new ValidationReportError("Report contains duplicate project ids.");
      projectIds.add(project.projectId);
      if (typeof project.available !== "boolean") throw new ValidationReportError();
      integer(project.cases, "Report project case count");
      validateVerdictCounts(project.verdicts, "Report project verdicts");
    });
    denseArray(report.cases, "Report cases");
    const caseIds = new Set<string>();
    report.cases.forEach((row) => {
      strictClosedRecord(row, ["caseId", "projectId", "title", "verdict", "executionMarker", "severityIfFailed", "failures", "compatibilityNotes", "trace", "metrics", "compatibility", "errorCode", "redactions"], ["caseId", "projectId", "title", "verdict", "executionMarker", "severityIfFailed", "failures", "compatibilityNotes", "redactions"], "Report case");
      assertPortableIdentifier(row.caseId, "Report case id");
      if (caseIds.has(row.caseId)) throw new ValidationReportError("Report contains duplicate case ids.");
      caseIds.add(row.caseId);
      assertPortableIdentifier(row.projectId, "Report case project id");
      if (!projectIds.has(row.projectId)) throw new ValidationReportError("Report case project is unknown.");
      assertSafeText(row.title, "Report case title");
      enumValue(row.verdict, VERDICTS, "Report case verdict");
      enumValue(row.executionMarker, EXECUTION_MARKERS, "Report execution marker");
      enumValue(row.severityIfFailed, SEVERITIES, "Report case severity");
      denseArray(row.failures, "Report failures");
      row.failures.forEach((failure) => {
        strictClosedRecord(failure, ["code", "category", "severity", "message"], ["code", "category", "severity", "message"], "Report failure");
        if (normalizeValidationErrorCode(failure.code) !== failure.code) throw new ValidationReportError();
        enumValue(failure.category, FAILURE_CATEGORIES, "Report failure category");
        enumValue(failure.severity, SEVERITIES, "Report failure severity");
        assertSafeText(failure.message, "Report failure message");
      });
      stringArray(row.compatibilityNotes, "Report compatibility notes", false);
      stringArray(row.redactions, "Report redactions");
      if (row.trace !== undefined) validateGoldenTraceSummary(row.trace);
      if (row.metrics !== undefined) validateCaseMetrics(row.metrics);
      if (row.compatibility !== undefined) validateCompatibility(row.compatibility);
      if (row.errorCode !== undefined && normalizeValidationErrorCode(row.errorCode) !== row.errorCode) throw new ValidationReportError();
    });
    const aggregateFields = [
      "totalCases", "realEngineCaseCount", "fixtureCaseCount", "baselineEligible",
      "verdicts", "baselineVerdicts", "acceptableOrBetterPercentage",
      "allCasesAcceptableOrBetterPercentage", "safety", "knowledge", "projection",
      "efficiency", "deterministicReplayEquivalence",
    ];
    strictClosedRecord(report.metrics, aggregateFields, aggregateFields, "Aggregate metrics");
    integer(report.metrics.totalCases, "Aggregate total cases");
    integer(report.metrics.realEngineCaseCount, "Aggregate real-engine case count");
    integer(report.metrics.fixtureCaseCount, "Aggregate fixture case count");
    if (typeof report.metrics.baselineEligible !== "boolean") throw new ValidationReportError();
    validateVerdictCounts(report.metrics.verdicts, "Aggregate verdicts");
    validateVerdictCounts(report.metrics.baselineVerdicts, "Aggregate baseline verdicts");
    finite(report.metrics.acceptableOrBetterPercentage, "Acceptable-or-better percentage", 100);
    finite(report.metrics.allCasesAcceptableOrBetterPercentage, "All-case acceptable-or-better percentage", 100);
    const expectedRealEngineCount = report.cases.filter((row) =>
      row.executionMarker === "real_engine" && row.verdict !== "NOT_RUN").length;
    const expectedFixtureCount = report.cases.filter((row) => row.executionMarker === "fixture_result").length;
    if (
      report.metrics.totalCases !== report.cases.length ||
      report.metrics.realEngineCaseCount !== expectedRealEngineCount ||
      report.metrics.fixtureCaseCount !== expectedFixtureCount ||
      report.metrics.baselineEligible !== (expectedRealEngineCount > 0)
    ) {
      throw new ValidationReportError("Aggregate execution classification is inconsistent.");
    }
    VERDICT_ORDER.forEach((verdict) => {
      const allCount = report.cases.filter((row) => row.verdict === verdict).length;
      const baselineCount = report.cases.filter((row) =>
        row.executionMarker === "real_engine" && row.verdict !== "NOT_RUN" && row.verdict === verdict).length;
      if (
        report.metrics.verdicts[verdict] !== allCount ||
        report.metrics.baselineVerdicts[verdict] !== baselineCount
      ) {
        throw new ValidationReportError("Aggregate verdict counts are inconsistent.");
      }
    });
    const numericRecord = (record: unknown, fields: readonly string[], label: string, ratios: readonly string[] = []) => {
      strictClosedRecord(record, fields, fields, label);
      fields.forEach((field) => finite(record[field], `${label}.${field}`, ratios.includes(field) ? 1 : undefined));
    };
    numericRecord(report.metrics.safety, ["criticalFailures", "negativeConstraintViolations", "unsafeEditableAuthorizations", "explicitTargetViolations", "mixedSnapshotRecords"], "Aggregate safety");
    numericRecord(report.metrics.knowledge, ["confirmedFindings", "confirmedFindingEvidenceCompleteness", "unsupportedConfirmedFindings", "averageCriticalQuestionCoverage", "stopReasonCorrectness"], "Aggregate knowledge", ["confirmedFindingEvidenceCompleteness", "averageCriticalQuestionCoverage", "stopReasonCorrectness"]);
    numericRecord(report.metrics.projection, ["requiredTargetPrecision", "requiredTargetRecall", "requiredTestRecall", "unexpectedEditablePaths", "explicitTargetPreservation"], "Aggregate projection", ["requiredTargetPrecision", "requiredTargetRecall", "requiredTestRecall", "explicitTargetPreservation"]);
    numericRecord(report.metrics.efficiency, ["operations", "searches", "reads", "bytes", "parsedFiles", "relationshipHops", "plannerRounds", "durationMs"], "Aggregate efficiency");
    finite(report.metrics.deterministicReplayEquivalence, "Replay equivalence", 1);
    strictClosedRecord(report.gate, ["passed", "blockingReasons", "proposedAcceptableOrBetterThreshold", "proposedThresholdEvaluated"], ["passed", "blockingReasons", "proposedAcceptableOrBetterThreshold", "proposedThresholdEvaluated"], "Validation gate");
    if (typeof report.gate.passed !== "boolean" || typeof report.gate.proposedThresholdEvaluated !== "boolean") throw new ValidationReportError();
    stringArray(report.gate.blockingReasons, "Gate blocking reasons");
    finite(report.gate.proposedAcceptableOrBetterThreshold, "Proposed threshold", 100);
    const canonicalGate = evaluateValidationGate(report.metrics);
    if (
      report.gate.passed !== canonicalGate.passed ||
      report.gate.proposedAcceptableOrBetterThreshold !== canonicalGate.proposedAcceptableOrBetterThreshold ||
      report.gate.proposedThresholdEvaluated !== canonicalGate.proposedThresholdEvaluated ||
      report.gate.blockingReasons.length !== canonicalGate.blockingReasons.length ||
      report.gate.blockingReasons.some((reason, index) => reason !== canonicalGate.blockingReasons[index])
    ) {
      throw new ValidationReportError("Validation gate is inconsistent with trusted baseline metrics.");
    }
    stringArray(report.unavailableProjects, "Unavailable projects");
    strictClosedRecord(report.redaction, ["absoluteRootsExcluded", "sourceContentExcluded", "secretsExcluded", "redactedFields"], ["absoluteRootsExcluded", "sourceContentExcluded", "secretsExcluded", "redactedFields"], "Report redaction");
    if (report.redaction.absoluteRootsExcluded !== true || report.redaction.sourceContentExcluded !== true || report.redaction.secretsExcluded !== true) throw new ValidationReportError();
    stringArray(report.redaction.redactedFields, "Report redacted fields");
    stringArray(report.knownLimitations, "Known limitations", false);
    const serialized = JSON.stringify(report);
    if (
      containsAbsolutePathOrFileUri(serialized) ||
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u.test(serialized) ||
      /(?:Bearer\s+[A-Za-z0-9._~+\/-]{8,}|gh[pousr]_[A-Za-z0-9]{8,}|sk-(?:proj-)?[A-Za-z0-9_-]{8,}|(?:AKIA|ASIA)[A-Z0-9]{12,}|(?:rk|sk)_live_[A-Za-z0-9]{8,})/u.test(serialized)
    ) {
      throw new ValidationReportError();
    }
}

export function validateContextEngineValidationReport(
  raw: ContextEngineValidationReport,
): ContextEngineValidationReport {
  try {
    assertReportShape(raw);
    const report = cloneDomainValue(raw);
    assertReportShape(report);
    return report;
  } catch (error) {
    if (error instanceof ValidationReportError) throw error;
    throw new ValidationReportError();
  }
}

export function serializeValidationReportJson(report: ContextEngineValidationReport): string {
  return `${JSON.stringify(validateContextEngineValidationReport(report), null, 2)}\n`;
}

export function renderValidationReportMarkdown(raw: ContextEngineValidationReport): string {
  const report = validateContextEngineValidationReport(raw);
  const verdictRows = VERDICT_ORDER.map((verdict) =>
    `- ${verdict}: ${report.metrics.verdicts[verdict]}`);
  const baselineVerdictRows = VERDICT_ORDER.map((verdict) =>
    `- ${verdict}: ${report.metrics.baselineVerdicts[verdict]}`);
  const projectRows = report.projects
    .sort((left, right) => stableCompare(left.projectId, right.projectId))
    .map((project) =>
      `| ${project.projectId} | ${project.available ? "available" : "unavailable"} | ${project.cases} | ${VERDICT_ORDER.map((verdict) => project.verdicts[verdict]).join(" / ")} |`);
  const caseRows = report.cases
    .sort((left, right) => stableCompare(left.caseId, right.caseId))
    .map((row) =>
      `| ${row.caseId} | ${row.projectId} | ${row.executionMarker} | ${row.verdict} | ${row.failures.map((failure) => failure.code).join(", ") || "none"} |`);
  return [
    "# Context Engine v2 Offline Validation Report",
    "",
    `- Manifest: ${report.manifest.manifestId} — ${report.manifest.title}`,
    `- Run: ${report.run.runId}`,
    `- Gate: ${report.gate.passed ? "PASS" : "FAIL"}`,
    `- Trusted real-engine cases: ${report.metrics.realEngineCaseCount}`,
    `- Fixture cases: ${report.metrics.fixtureCaseCount}`,
    `- Baseline eligible: ${report.metrics.baselineEligible ? "yes" : "no"}`,
    `- Baseline acceptable-or-better: ${report.metrics.acceptableOrBetterPercentage.toFixed(1)}%`,
    `- All-case acceptable-or-better: ${report.metrics.allCasesAcceptableOrBetterPercentage.toFixed(1)}%`,
    `- Proposed later threshold: ≥ ${report.gate.proposedAcceptableOrBetterThreshold}% (not evaluated as a cross-project gate)`,
    "",
    "## Verdict totals",
    "",
    ...verdictRows,
    "",
    "## Trusted real-engine baseline verdicts",
    "",
    ...baselineVerdictRows,
    "",
    "## Safety metrics",
    "",
    `- Critical failures: ${report.metrics.safety.criticalFailures}`,
    `- Negative-constraint violations: ${report.metrics.safety.negativeConstraintViolations}`,
    `- Unsafe editable authorizations: ${report.metrics.safety.unsafeEditableAuthorizations}`,
    `- Explicit-target violations: ${report.metrics.safety.explicitTargetViolations}`,
    `- Mixed-snapshot records: ${report.metrics.safety.mixedSnapshotRecords}`,
    "",
    "## Knowledge metrics",
    "",
    `- Confirmed finding evidence completeness: ${percent(report.metrics.knowledge.confirmedFindingEvidenceCompleteness)}`,
    `- Unsupported confirmed findings: ${report.metrics.knowledge.unsupportedConfirmedFindings}`,
    `- Critical-question coverage: ${percent(report.metrics.knowledge.averageCriticalQuestionCoverage)}`,
    `- Stop-reason correctness: ${percent(report.metrics.knowledge.stopReasonCorrectness)}`,
    "",
    "## Projection metrics",
    "",
    `- Required target precision / recall: ${percent(report.metrics.projection.requiredTargetPrecision)} / ${percent(report.metrics.projection.requiredTargetRecall)}`,
    `- Required test recall: ${percent(report.metrics.projection.requiredTestRecall)}`,
    `- Unexpected editable paths: ${report.metrics.projection.unexpectedEditablePaths}`,
    `- Explicit-target preservation: ${percent(report.metrics.projection.explicitTargetPreservation)}`,
    "",
    "## Performance",
    "",
    `- Operations/searches/reads: ${report.metrics.efficiency.operations} / ${report.metrics.efficiency.searches} / ${report.metrics.efficiency.reads}`,
    `- Bytes/parsed files/hops: ${report.metrics.efficiency.bytes} / ${report.metrics.efficiency.parsedFiles} / ${report.metrics.efficiency.relationshipHops}`,
    `- Planning rounds: ${report.metrics.efficiency.plannerRounds}`,
    `- Measured duration: ${report.metrics.efficiency.durationMs} ms`,
    "",
    "## Projects",
    "",
    "| Project | Availability | Cases | PASS / ACCEPTABLE / SAFE_FAIL / CRITICAL_FAIL / ENGINE_ERROR / NOT_RUN |",
    "|---|---:|---:|---|",
    ...projectRows,
    "",
    "## Cases",
    "",
    "| Case | Project | Execution | Verdict | Findings |",
    "|---|---|---|---|---|",
    ...caseRows,
    "",
    "## Gate blockers",
    "",
    ...(report.gate.blockingReasons.length > 0
      ? report.gate.blockingReasons.map((reason) => `- ${reason}`)
      : ["- None"]),
    "",
    "## Unavailable / not run",
    "",
    ...(report.unavailableProjects.length > 0
      ? report.unavailableProjects.map((project) => `- ${project}`)
      : ["- None"]),
    "",
    "## Known limitations",
    "",
    ...report.knownLimitations.map((limitation) => `- ${limitation}`),
    "",
    "> Export contains normalized repository-relative paths, fingerprints, IDs, reason codes and counters only. Absolute roots, source contents, prompts, secrets and environment values are excluded.",
    "",
  ].join("\n");
}

export async function writeValidationReport(
  report: ContextEngineValidationReport,
  outputDirectory: string,
): Promise<{ jsonPath: string; markdownPath: string }> {
  await fs.mkdir(outputDirectory, { recursive: true });
  const jsonPath = path.join(outputDirectory, "results.json");
  const markdownPath = path.join(outputDirectory, "report.md");
  await Promise.all([
    fs.writeFile(jsonPath, serializeValidationReportJson(report), "utf8"),
    fs.writeFile(markdownPath, renderValidationReportMarkdown(report), "utf8"),
  ]);
  return { jsonPath, markdownPath };
}
