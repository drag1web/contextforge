import { createHash } from "node:crypto";

import type { InvestigationOperation } from "../contracts/index.js";
import {
  assertClosedRecord,
  assertPortableIdentifier,
  assertSafeText,
  cloneDomainValue,
  sortedUnique,
  stableCompare,
  stableSerialize,
} from "../domain/investigationDomainSupport.js";
import type {
  GoldenComparison,
  GoldenStore,
  GoldenTraceSummary,
  ValidationExecutionArtifacts,
} from "./validationTypes.js";
import {
  assertPrivacySafeReviewReason,
  containsAbsolutePathOrFileUri,
} from "./validationPrivacy.js";

const GOLDEN_FIELDS = [
  "schemaVersion", "caseId", "snapshotFingerprint", "stopReason", "safeToProject",
  "questions", "hypotheses", "entityIds", "factIds", "findingIds", "operations",
  "factPredicates", "evidence", "openBlockingGaps", "openContradictions", "findings",
  "projected", "excludedReasonCodes", "budgetUsage", "limitations",
] as const;

export class GoldenTraceError extends Error {
  readonly code = "invalid_golden_trace" as const;
  readonly stage = "CE2-06" as const;

  constructor(message = "Golden trace failed safe runtime validation.") {
    super(message);
    this.name = "GoldenTraceError";
  }
}

const STOP_REASONS = new Set([
  "sufficient_evidence", "clarification_required", "no_grounded_lead", "contradictory_evidence",
  "operation_budget_exhausted", "file_budget_exhausted", "byte_budget_exhausted",
  "time_budget_exhausted", "planner_round_budget_exhausted", "repository_snapshot_truncated",
  "repository_changed", "safety_blocked", "internal_error",
]);
const QUESTION_CATEGORIES = new Set(["owner", "behavior", "data_flow", "route_flow", "state_flow", "constraint", "test_coverage", "risk"]);
const QUESTION_STATUSES = new Set(["open", "answered", "partially_answered", "blocked"]);
const HYPOTHESIS_STATUSES = new Set(["open", "supported", "rejected", "unresolved"]);
const OPERATION_TYPES = new Set(["search_paths", "search_text", "search_symbols", "read_file", "read_range", "parse_file", "inspect_manifest", "follow_relationship", "inspect_git_context", "evaluate_absence"]);
const OPERATION_STATUSES = new Set(["scheduled", "running", "completed", "failed", "skipped", "blocked", "deduplicated"]);
const EVIDENCE_ROLES = new Set(["supports", "contradicts", "context_only"]);
const EVIDENCE_STRENGTHS = new Set(["conclusive", "substantial", "corroborating", "lead"]);
const GAP_CATEGORIES = new Set(["missing_owner", "missing_behavior", "missing_relationship", "missing_runtime_variant", "missing_test_evidence", "ambiguous_user_intent", "snapshot_truncated", "unreadable_source", "safety_restricted", "custom"]);
const GAP_BLOCKS = new Set(["finding", "projection", "authorization"]);
const CONTRADICTION_TYPES = new Set(["mutually_exclusive_claims", "stale_vs_current", "declared_vs_implemented", "multiple_owners", "parser_disagreement", "unresolved_alias", "custom"]);
const CONTRADICTION_SEVERITIES = new Set(["blocking", "material", "informational"]);
const FINDING_TYPES = new Set(["implementation_target", "supporting_context", "behavior_summary", "constraint", "risk", "test_target", "clarification_requirement"]);
const FINDING_STATUSES = new Set(["confirmed", "probable", "unresolved"]);
const PROJECTION_ROLES = new Set(["target", "test", "supporting", "reference"]);
const COST_FIELDS = ["operations", "fileReads", "fileBytes", "parsedFiles", "relationshipHops", "plannerRounds"] as const;

function denseArray(value: unknown, label: string): asserts value is unknown[] {
  if (!Array.isArray(value)) throw new GoldenTraceError(`${label} must be an array.`);
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) throw new GoldenTraceError(`${label} must be dense.`);
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
    throw new GoldenTraceError(`${label} contains unsupported fields.`);
  }
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!("value" in descriptor) || !descriptor.enumerable) {
      throw new GoldenTraceError(`${label}.${key} must be an enumerable data property.`);
    }
  }
}

function enumValue(value: unknown, allowed: ReadonlySet<string>, label: string): asserts value is string {
  if (typeof value !== "string" || !allowed.has(value)) throw new GoldenTraceError(`${label} is unsupported.`);
}

function nonNegativeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new GoldenTraceError(`${label} must be a non-negative safe integer.`);
}

function sortedUniquePortable(value: unknown, label: string): asserts value is string[] {
  denseArray(value, label);
  value.forEach((entry) => assertPortableIdentifier(entry, label));
  const strings = value as string[];
  const sorted = [...strings].sort(stableCompare);
  if (new Set(strings).size !== strings.length || strings.some((entry, index) => entry !== sorted[index])) {
    throw new GoldenTraceError(`${label} must be sorted and unique.`);
  }
}

function normalizedRelativePath(value: unknown, label: string): asserts value is string {
  assertSafeText(value, label);
  if (value.startsWith("/") || /^[A-Za-z]:/u.test(value) || value.includes("\\") || value.includes("//") || value.endsWith("/") ||
    value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new GoldenTraceError(`${label} must be a normalized repository-relative path.`);
  }
}

function validateCost(value: unknown, label: string): void {
  strictClosedRecord(value, COST_FIELDS, COST_FIELDS, label);
  COST_FIELDS.forEach((field) => nonNegativeInteger(value[field], `${label}.${field}`));
}

function validateOperationTarget(value: unknown): void {
  assertSafeText(value, "Golden operation target");
  if (/^query-sha256:[0-9a-f]{64}$/u.test(value)) return;
  if (value.startsWith("entity:")) {
    assertPortableIdentifier(value.slice("entity:".length), "Golden operation entity target");
    return;
  }
  if (value.startsWith("paths:")) {
    const paths = value.slice("paths:".length).split(",");
    if (paths.length === 0) throw new GoldenTraceError();
    paths.forEach((entry) => normalizedRelativePath(entry, "Golden operation path target"));
    return;
  }
  normalizedRelativePath(value, "Golden operation file target");
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const SNAPSHOT_FINGERPRINT = /^snapshot-sha256:[0-9a-f]{64}$/u;
const PRIVATE_KEY = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u;
const TOKEN = /(?:Bearer\s+[A-Za-z0-9._~+\/-]{8,}|gh[pousr]_[A-Za-z0-9]{8,}|sk-(?:proj-)?[A-Za-z0-9_-]{8,}|(?:AKIA|ASIA)[A-Z0-9]{12,}|(?:rk|sk)_live_[A-Za-z0-9]{8,})/u;
const SERIALIZED_CONTROL_CHARACTER = /(?:[\0-\x1f\x7f]|\\u00(?:0[0-9a-f]|1[0-9a-f]|7f)|\\[bfnrt])/iu;

export function assertGoldenTraceExportPrivacy(serialized: string): void {
  if (
    containsAbsolutePathOrFileUri(serialized) || PRIVATE_KEY.test(serialized) ||
    TOKEN.test(serialized) || SERIALIZED_CONTROL_CHARACTER.test(serialized)
  ) {
    throw new GoldenTraceError("Golden trace failed privacy-safe export validation.");
  }
}

function operationTarget(operation: InvestigationOperation): string | undefined {
  switch (operation.type) {
    case "read_file":
    case "read_range":
    case "parse_file":
    case "inspect_manifest":
      return operation.path.replaceAll("\\", "/").toLowerCase();
    case "follow_relationship":
      return `entity:${operation.fromEntityId}`;
    case "inspect_git_context":
      return `paths:${[...operation.paths].sort(stableCompare).join(",")}`;
    case "search_paths":
    case "search_text":
    case "search_symbols":
    case "evaluate_absence":
      return `query-sha256:${hash(operation.query)}`;
  }
}

function safeLimitation(value: string): boolean {
  return /^[a-z][a-z0-9_.:-]{0,120}$/u.test(value);
}

export function createGoldenTraceSummary(input: {
  caseId: string;
  artifacts: ValidationExecutionArtifacts;
}): GoldenTraceSummary {
  assertPortableIdentifier(input.caseId, "Golden trace case id");
  const { investigation, projection, snapshot } = input.artifacts;
  const projected = projection.decisions
    .filter((decision) => decision.included && decision.path && decision.role)
    .map((decision) => ({ path: decision.path!, role: decision.role! }))
    .sort((left, right) => stableCompare(left.path, right.path) || stableCompare(left.role, right.role));
  return {
    schemaVersion: 1,
    caseId: input.caseId,
    snapshotFingerprint: `snapshot-sha256:${hash(snapshot.rootFingerprint)}`,
    stopReason: investigation.stop.reason,
    safeToProject: investigation.safeToProject,
    questions: investigation.questions
      .map((question) => ({ category: question.category, status: question.status }))
      .sort((left, right) => stableCompare(left.category, right.category) || stableCompare(left.status, right.status)),
    hypotheses: investigation.hypotheses
      .map((hypothesis) => ({ id: hypothesis.id, status: hypothesis.status }))
      .sort((left, right) => stableCompare(left.id, right.id)),
    entityIds: sortedUnique(investigation.entities.map((entity) => entity.id)),
    factIds: sortedUnique(investigation.facts.map((fact) => fact.id)),
    findingIds: sortedUnique(investigation.findings.map((finding) => finding.id)),
    operations: investigation.operationRecords.map((record) => ({
      type: record.operation.type,
      status: record.status,
      ...(operationTarget(record.operation) === undefined
        ? {}
        : { target: operationTarget(record.operation) }),
      ...(record.actualCost === undefined
        ? {}
        : {
            actualCost: {
              operations: record.actualCost.operations,
              fileReads: record.actualCost.fileReads,
              fileBytes: record.actualCost.fileBytes,
              parsedFiles: record.actualCost.parsedFiles,
              relationshipHops: record.actualCost.relationshipHops,
              plannerRounds: record.actualCost.plannerRounds,
            },
          }),
    })),
    factPredicates: sortedUnique(investigation.facts.map((fact) => fact.predicate)),
    evidence: investigation.evidence
      .map((record) => ({ role: record.role, strength: record.strength }))
      .sort((left, right) => stableCompare(left.role, right.role) || stableCompare(left.strength, right.strength)),
    openBlockingGaps: investigation.knowledgeGaps
      .filter((gap) => gap.status === "open" && gap.blocks.length > 0)
      .map((gap) => ({ category: gap.category, blocks: sortedUnique(gap.blocks) }))
      .sort((left, right) => stableCompare(left.category, right.category)),
    openContradictions: investigation.contradictions
      .filter((record) => record.status === "open")
      .map((record) => ({ type: record.type, severity: record.severity }))
      .sort((left, right) => stableCompare(left.type, right.type) || stableCompare(left.severity, right.severity)),
    findings: investigation.findings
      .map((finding) => ({ type: finding.type, status: finding.status }))
      .sort((left, right) => stableCompare(left.type, right.type) || stableCompare(left.status, right.status)),
    projected,
    excludedReasonCodes: sortedUnique(projection.decisions
      .filter((decision) => !decision.included)
      .flatMap((decision) => decision.reasonCodes)),
    budgetUsage: {
      operations: investigation.budgetState.usage.operations,
      fileReads: investigation.budgetState.usage.fileReads,
      fileBytes: investigation.budgetState.usage.fileBytes,
      parsedFiles: investigation.budgetState.usage.parsedFiles,
      relationshipHops: investigation.budgetState.usage.relationshipHops,
      plannerRounds: investigation.budgetState.usage.plannerRounds,
    },
    limitations: sortedUnique([
      ...investigation.evidence.flatMap((record) => record.limitations),
      ...investigation.findings.flatMap((finding) => finding.limitations),
      ...projection.projection.evidenceSummary.limitations,
    ].filter(safeLimitation)),
  };
}

function assertGoldenTraceShape(summary: GoldenTraceSummary): void {
    strictClosedRecord(summary, GOLDEN_FIELDS, GOLDEN_FIELDS, "Golden trace");
    if (summary.schemaVersion !== 1) throw new GoldenTraceError("Golden trace schemaVersion must be 1.");
    assertPortableIdentifier(summary.caseId, "Golden trace case id");
    if (!SNAPSHOT_FINGERPRINT.test(summary.snapshotFingerprint)) {
      throw new GoldenTraceError("Golden trace snapshot fingerprint is not canonical.");
    }
    enumValue(summary.stopReason, STOP_REASONS, "Golden trace stop reason");
    if (typeof summary.safeToProject !== "boolean") throw new GoldenTraceError();
    denseArray(summary.questions, "Golden questions");
    summary.questions.forEach((record) => {
      strictClosedRecord(record, ["category", "status"], ["category", "status"], "Golden question");
      enumValue(record.category, QUESTION_CATEGORIES, "Golden question category");
      enumValue(record.status, QUESTION_STATUSES, "Golden question status");
    });
    denseArray(summary.hypotheses, "Golden hypotheses");
    summary.hypotheses.forEach((record) => {
      strictClosedRecord(record, ["id", "status"], ["id", "status"], "Golden hypothesis");
      assertPortableIdentifier(record.id, "Golden hypothesis id");
      enumValue(record.status, HYPOTHESIS_STATUSES, "Golden hypothesis status");
    });
    sortedUniquePortable(summary.entityIds, "Golden entity ids");
    sortedUniquePortable(summary.factIds, "Golden fact ids");
    sortedUniquePortable(summary.findingIds, "Golden finding ids");
    denseArray(summary.operations, "Golden operations");
    summary.operations.forEach((record) => {
      strictClosedRecord(record, ["type", "status", "target", "actualCost"], ["type", "status"], "Golden operation");
      enumValue(record.type, OPERATION_TYPES, "Golden operation type");
      enumValue(record.status, OPERATION_STATUSES, "Golden operation status");
      if (record.target !== undefined) validateOperationTarget(record.target);
      if (record.actualCost !== undefined) validateCost(record.actualCost, "Golden operation cost");
    });
    sortedUniquePortable(summary.factPredicates, "Golden fact predicates");
    denseArray(summary.evidence, "Golden evidence");
    summary.evidence.forEach((record) => {
      strictClosedRecord(record, ["role", "strength"], ["role", "strength"], "Golden evidence");
      enumValue(record.role, EVIDENCE_ROLES, "Golden evidence role");
      enumValue(record.strength, EVIDENCE_STRENGTHS, "Golden evidence strength");
    });
    denseArray(summary.openBlockingGaps, "Golden gaps");
    summary.openBlockingGaps.forEach((record) => {
      strictClosedRecord(record, ["category", "blocks"], ["category", "blocks"], "Golden gap");
      enumValue(record.category, GAP_CATEGORIES, "Golden gap category");
      denseArray(record.blocks, "Golden gap blocks");
      record.blocks.forEach((entry) => enumValue(entry, GAP_BLOCKS, "Golden gap block"));
      if (new Set(record.blocks).size !== record.blocks.length) throw new GoldenTraceError();
    });
    denseArray(summary.openContradictions, "Golden contradictions");
    summary.openContradictions.forEach((record) => {
      strictClosedRecord(record, ["type", "severity"], ["type", "severity"], "Golden contradiction");
      enumValue(record.type, CONTRADICTION_TYPES, "Golden contradiction type");
      enumValue(record.severity, CONTRADICTION_SEVERITIES, "Golden contradiction severity");
    });
    denseArray(summary.findings, "Golden findings");
    summary.findings.forEach((record) => {
      strictClosedRecord(record, ["type", "status"], ["type", "status"], "Golden finding");
      enumValue(record.type, FINDING_TYPES, "Golden finding type");
      enumValue(record.status, FINDING_STATUSES, "Golden finding status");
    });
    denseArray(summary.projected, "Golden projected records");
    summary.projected.forEach((record) => {
      strictClosedRecord(record, ["path", "role"], ["path", "role"], "Golden projected record");
      normalizedRelativePath(record.path, "Golden projected path");
      enumValue(record.role, PROJECTION_ROLES, "Golden projected role");
    });
    sortedUniquePortable(summary.excludedReasonCodes, "Golden excluded reason codes");
    validateCost(summary.budgetUsage, "Golden budget usage");
    sortedUniquePortable(summary.limitations, "Golden limitations");
}

export function validateGoldenTraceSummary(raw: GoldenTraceSummary): GoldenTraceSummary {
  try {
    assertGoldenTraceShape(raw);
    const summary = cloneDomainValue(raw);
    assertGoldenTraceShape(summary);
    assertGoldenTraceExportPrivacy(JSON.stringify(summary));
    return summary;
  } catch (error) {
    if (error instanceof GoldenTraceError) throw error;
    throw new GoldenTraceError();
  }
}

export function compareGoldenTraces(
  expectedRaw: GoldenTraceSummary,
  actualRaw: GoldenTraceSummary,
): GoldenComparison {
  const expected = validateGoldenTraceSummary(expectedRaw);
  const actual = validateGoldenTraceSummary(actualRaw);
  const changedFields = GOLDEN_FIELDS
    .filter((field) => stableSerialize(expected[field]) !== stableSerialize(actual[field]))
    .sort(stableCompare);
  return { equivalent: changedFields.length === 0, changedFields };
}

export async function applyGoldenMode(input: {
  store: GoldenStore;
  caseId: string;
  summary: GoldenTraceSummary;
  mode: "verify" | "update_golden";
  reason?: string;
}): Promise<GoldenComparison | null> {
  const summary = validateGoldenTraceSummary(input.summary);
  if (input.mode === "update_golden") {
    try {
      assertPrivacySafeReviewReason(input.reason);
    } catch {
      throw new GoldenTraceError("Golden update requires a non-empty reason.");
    }
    await input.store.write(input.caseId, summary, input.reason.trim());
    return null;
  }
  const expected = await input.store.read(input.caseId);
  return expected ? compareGoldenTraces(expected, summary) : null;
}
