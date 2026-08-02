import type {
  ContextComposerComparisonView,
  ContextComposerEngineFileView,
  ContextComposerEngineReasonCode,
  ContextComposerEngineView,
  ContextComposerEvidenceView,
} from "./composerTypes.js";

const MODES = new Set(["legacy", "shadow_compare", "v2_primary"]);
const SOURCES = new Set(["legacy", "v2"]);
const STATUSES = new Set(["legacy", "v2_ready", "v2_review_required", "legacy_fallback", "safety_blocked"]);
const ROLES = new Set(["target", "test", "supporting", "reference"]);
const USAGES = new Set(["inspect-and-edit", "inspect-only", "asset-reference", "config-reference"]);
const FILE_SOURCES = new Set(["v2", "legacy", "manual"]);
const EVIDENCE_ROLES = new Set(["supports", "contradicts", "context_only"]);
const STRENGTHS = new Set(["lead", "corroborating", "substantial", "conclusive"]);
const RELATION_KINDS = new Set(["relation", "fact"]);
const PREDICATES = new Set(["calls", "configures", "contains", "defines_endpoint", "exports", "imports", "re_exports", "renders", "tests"]);
const QUESTION_CATEGORIES = new Set(["owner", "behavior", "data_flow", "route_flow", "state_flow", "constraint", "test_coverage", "risk"]);
const QUESTION_STATUSES = new Set(["open", "answered", "partially_answered", "blocked"]);
const OUTCOMES = new Set([
  "equivalent_supported", "v2_better_supported", "legacy_better_supported", "both_safe_unresolved",
  "v2_safe_legacy_risky", "legacy_safe_v2_risky", "different_but_both_acceptable",
  "insufficient_evaluation_data", "v2_execution_failure",
]);
const STOP_REASONS = new Set([
  "sufficient_evidence", "clarification_required", "no_grounded_lead", "contradictory_evidence",
  "operation_budget_exhausted", "file_budget_exhausted", "byte_budget_exhausted",
  "time_budget_exhausted", "planner_round_budget_exhausted", "repository_snapshot_truncated",
  "repository_changed", "safety_blocked", "internal_error",
]);
const REASONS = new Set<ContextComposerEngineReasonCode>([
  "legacy_candidate", "confirmed_implementation_target", "confirmed_test_target", "confirmed_supporting_context",
  "explicit_target_eligible", "probable_review_only", "blocking_gap", "blocking_contradiction",
  "negative_constraint", "secret_file", "generated_target_blocked", "unreadable_file",
  "missing_evidence", "evidence_entity_mismatch", "result_not_safe_to_project",
  "stop_reason_blocks_projection", "v2_execution_timeout", "v2_execution_error",
  "v2_capacity_exhausted", "canonical_input_mismatch", "repository_changed",
  "v2_integrity_violation", "v2_not_grounded",
]);

function fail(): never {
  throw new Error("invalid_context_composer_engine_view");
}

function record(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== "string")) fail();
  for (const descriptor of Object.values(descriptors)) {
    if (descriptor.get || descriptor.set || !("value" in descriptor) || !descriptor.enumerable) fail();
  }
  const actual = Object.keys(descriptors).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail();
  return Object.fromEntries(actual.map((key) => [key, descriptors[key]!.value]));
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) fail();
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) fail();
  }
  return value;
}

function safeString(value: unknown, max = 240): string {
  if (typeof value !== "string" || !value || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) fail();
  return value;
}

function safePath(value: unknown): string {
  const normalized = safeString(value, 500).replace(/\\/gu, "/").replace(/^\.\//u, "");
  if (!normalized || normalized.startsWith("/") || /^[a-z]:/iu.test(normalized) || normalized.split("/").some((part) => !part || part === "..")) fail();
  return normalized;
}

function identifier(value: unknown): string {
  const result = safeString(value);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/u.test(result)) fail();
  return result;
}

function strings(value: unknown, pathValues = false): string[] {
  const result = array(value).map((item) => pathValues ? safePath(item) : safeString(item));
  if (new Set(result).size !== result.length || result.some((item, index) => index > 0 && result[index - 1]! > item)) fail();
  return result;
}

function identifiers(value: unknown): string[] {
  const result = array(value).map(identifier);
  if (new Set(result).size !== result.length || result.some((item, index) => index > 0 && result[index - 1]! > item)) fail();
  return result;
}

function reason(value: unknown): ContextComposerEngineReasonCode {
  if (!REASONS.has(value as ContextComposerEngineReasonCode)) fail();
  return value as ContextComposerEngineReasonCode;
}

function evidence(value: unknown): ContextComposerEvidenceView {
  const item = record(value, ["evidenceId", "role", "strength", "predicate", "relationKind", "path", "startLine", "endLine", "reasonCode"]);
  if (!EVIDENCE_ROLES.has(item.role as string) || !STRENGTHS.has(item.strength as string)) fail();
  if (item.predicate !== undefined && !PREDICATES.has(safeString(item.predicate, 120))) fail();
  if (item.relationKind !== undefined && !RELATION_KINDS.has(item.relationKind as string)) fail();
  if (item.path !== undefined) safePath(item.path);
  for (const key of ["startLine", "endLine"] as const) {
    if (item[key] !== undefined && (!Number.isSafeInteger(item[key]) || (item[key] as number) < 1)) fail();
  }
  return {
    evidenceId: identifier(item.evidenceId),
    role: item.role as ContextComposerEvidenceView["role"],
    strength: item.strength as ContextComposerEvidenceView["strength"],
    ...(item.predicate === undefined ? {} : { predicate: item.predicate as string }),
    ...(item.relationKind === undefined ? {} : { relationKind: item.relationKind as ContextComposerEvidenceView["relationKind"] }),
    ...(item.path === undefined ? {} : { path: item.path as string }),
    ...(item.startLine === undefined ? {} : { startLine: item.startLine as number }),
    ...(item.endLine === undefined ? {} : { endLine: item.endLine as number }),
    reasonCode: reason(item.reasonCode),
  };
}

function file(value: unknown): ContextComposerEngineFileView {
  const item = record(value, ["path", "role", "usage", "source", "reviewRequired", "reasonCode", "reasonCodes", "findingIds", "evidenceIds", "evidence"]);
  if (!ROLES.has(item.role as string) || !USAGES.has(item.usage as string) || !FILE_SOURCES.has(item.source as string) || typeof item.reviewRequired !== "boolean") fail();
  const evidenceItems = array(item.evidence).map(evidence);
  if (new Set(evidenceItems.map((entry) => entry.evidenceId)).size !== evidenceItems.length) fail();
  const reasonCodes = array(item.reasonCodes).map(reason);
  if (new Set(reasonCodes).size !== reasonCodes.length || reasonCodes.some((value, index) => index > 0 && reasonCodes[index - 1]! > value)) fail();
  const findingIds = identifiers(item.findingIds);
  const evidenceIds = identifiers(item.evidenceIds);
  if (evidenceItems.length !== evidenceIds.length || evidenceItems.some((entry, index) => entry.evidenceId !== evidenceIds[index])) fail();
  if (item.source === "v2" && (item.role === "target" || item.role === "test") && (findingIds.length === 0 || evidenceIds.length === 0)) fail();
  if (item.source === "v2" && (item.role === "target" || item.role === "test") &&
      !evidenceItems.some((entry) => entry.role === "supports" && entry.strength !== "lead")) fail();
  return {
    path: safePath(item.path),
    role: item.role as ContextComposerEngineFileView["role"],
    usage: item.usage as ContextComposerEngineFileView["usage"],
    source: item.source as ContextComposerEngineFileView["source"],
    reviewRequired: item.reviewRequired,
    reasonCode: reason(item.reasonCode),
    reasonCodes,
    findingIds,
    evidenceIds,
    evidence: evidenceItems.sort((left, right) => left.evidenceId.localeCompare(right.evidenceId)),
  };
}

export function validateContextComposerComparisonView(value: unknown): ContextComposerComparisonView {
  const item = record(value, ["outcome", "exactEditablePaths", "legacyOnlyEditablePaths", "v2OnlyEditablePaths", "safeBlockAgreement", "explicitTargetDisagreements"]);
  if (!OUTCOMES.has(item.outcome as string) || typeof item.safeBlockAgreement !== "boolean") fail();
  return deepFreeze({
    outcome: item.outcome as ContextComposerComparisonView["outcome"],
    exactEditablePaths: strings(item.exactEditablePaths, true),
    legacyOnlyEditablePaths: strings(item.legacyOnlyEditablePaths, true),
    v2OnlyEditablePaths: strings(item.v2OnlyEditablePaths, true),
    safeBlockAgreement: item.safeBlockAgreement,
    explicitTargetDisagreements: strings(item.explicitTargetDisagreements),
  });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

export function validateContextComposerEngineView(value: unknown): ContextComposerEngineView {
  const item = record(value, ["schemaVersion", "requestedMode", "effectiveSource", "status", "stopReason", "fallbackReason", "files", "unresolvedQuestions", "limitations", "comparison"]);
  if (item.schemaVersion !== 1 || !MODES.has(item.requestedMode as string) || !SOURCES.has(item.effectiveSource as string) || !STATUSES.has(item.status as string)) fail();
  if (item.stopReason !== null && !STOP_REASONS.has(item.stopReason as string)) fail();
  if (item.fallbackReason !== null) reason(item.fallbackReason);
  const files = array(item.files).map(file);
  if (new Set(files.map((entry) => entry.path.toLocaleLowerCase("en-US"))).size !== files.length) fail();
  const unresolvedQuestions = array(item.unresolvedQuestions).map((value) => {
    const question = record(value, ["category", "status"]);
    if (!QUESTION_CATEGORIES.has(question.category as string) || !QUESTION_STATUSES.has(question.status as string)) fail();
    return { category: question.category, status: question.status } as ContextComposerEngineView["unresolvedQuestions"][number];
  });
  const result: ContextComposerEngineView = {
    schemaVersion: 1,
    requestedMode: item.requestedMode as ContextComposerEngineView["requestedMode"],
    effectiveSource: item.effectiveSource as ContextComposerEngineView["effectiveSource"],
    status: item.status as ContextComposerEngineView["status"],
    stopReason: item.stopReason as ContextComposerEngineView["stopReason"],
    fallbackReason: item.fallbackReason as ContextComposerEngineView["fallbackReason"],
    files: files.sort((left, right) => left.path.localeCompare(right.path)),
    unresolvedQuestions: unresolvedQuestions.sort((left, right) => left.category.localeCompare(right.category) || left.status.localeCompare(right.status)),
    limitations: array(item.limitations).map(reason).sort(),
    comparison: item.comparison === null ? null : validateContextComposerComparisonView(item.comparison),
  };
  return deepFreeze(result);
}
