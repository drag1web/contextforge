import type {
  ContextComposerComparisonView,
  ContextComposerEngineFileView,
  ContextComposerEngineReasonCode,
  ContextComposerEngineView,
  ContextComposerEvidenceView,
  ContextComposerFindingView,
  ContextComposerInvestigationCoverageView,
  ContextComposerInvestigationEventView,
  ContextComposerInvestigationTimelineView,
} from "./composerTypes.js";

const MODES = new Set(["legacy", "shadow_compare", "v2_primary"]);
const SOURCES = new Set(["legacy", "v2"]);
const STATUSES = new Set(["legacy", "v2_ready", "v2_review_required", "legacy_fallback", "safety_blocked"]);
const ROLES = new Set(["target", "test", "supporting", "reference"]);
const USAGES = new Set(["inspect-and-edit", "inspect-only", "asset-reference", "config-reference"]);
const FILE_SOURCES = new Set(["v2", "legacy", "manual"]);
const EVIDENCE_ROLES = new Set(["supports", "contradicts", "context_only"]);
const STRENGTHS = new Set(["lead", "corroborating", "substantial", "conclusive"]);
const FINDING_TYPES = new Set(["implementation_target", "supporting_context", "behavior_summary", "constraint", "risk", "test_target", "clarification_requirement"]);
const FINDING_STATUSES = new Set(["confirmed", "probable", "unresolved"]);
const AUTHORIZATION_HINTS = new Set(["eligible", "review_required", "not_eligible"]);
const RELATION_KINDS = new Set(["relation", "fact"]);
const PREDICATES = new Set(["calls", "configures", "contains", "defines_endpoint", "exports", "imports", "re_exports", "renders", "source_identity", "tests"]);
const QUESTION_CATEGORIES = new Set(["owner", "behavior", "data_flow", "route_flow", "state_flow", "constraint", "test_coverage", "risk"]);
const QUESTION_STATUSES = new Set(["open", "answered", "partially_answered", "blocked"]);
const TRACE_EVENT_TYPES = new Set([
  "seed_interpreted", "planner_proposal_synthesized", "question_updated", "gap_evaluated",
  "domain_evaluated", "atomic_commit", "stop_checked", "plan_created", "operation_selected",
  "operation_completed", "operation_budget_rejected",
]);
const OPERATION_TYPES = new Set([
  "search_paths", "search_text", "search_symbols", "read_file", "read_range", "parse_file",
  "follow_relationship", "inspect_manifest", "inspect_git_context", "evaluate_absence",
]);
const OPERATION_SOURCES = new Set([
  "explicit_path", "explicit_symbol", "task_token", "snapshot_manifest", "knowledge_gap",
  "graph_fact", "search_lead", "caller_seed",
]);
const TRACE_STATUSES = new Set([
  ...QUESTION_STATUSES,
  "resolved", "kept_open", "committed", "rejected", "cancelled",
  "proposed", "scheduled", "running", "completed", "failed", "skipped", "deduplicated",
]);
const STOP_STAGES = new Set([
  "before_planning", "after_planning", "before_operation", "after_ingestion", "after_budget", "final",
]);
const STOP_DECISIONS = new Set(["continue", "stop"]);
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

function record(
  value: unknown,
  fields: readonly string[],
  requiredFields: readonly string[] = fields,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== "string")) fail();
  for (const descriptor of Object.values(descriptors)) {
    if (descriptor.get || descriptor.set || !("value" in descriptor) || !descriptor.enumerable) fail();
  }
  const actual = Object.keys(descriptors).sort();
  if (actual.some((key) => !fields.includes(key)) || requiredFields.some((key) => !descriptors[key])) fail();
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

function nonNegativeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail();
  return value as number;
}

function nullableInteger(value: unknown, minimum = 0): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) < minimum) fail();
  return value as number;
}

function nullableIdentifier(value: unknown): string | null {
  return value === null ? null : identifier(value);
}

function nullableEnum<T extends string>(value: unknown, values: Set<string>): T | null {
  if (value === null) return null;
  if (!values.has(value as string)) fail();
  return value as T;
}

function nullableTimestamp(value: unknown): string | null {
  if (value === null) return null;
  const result = safeString(value, 40);
  const epoch = Date.parse(result);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== result) fail();
  return result;
}

function finding(value: unknown): ContextComposerFindingView {
  const item = record(value, ["findingId", "type", "statement", "status", "authorizationHint", "limitations", "evidenceIds"]);
  if (!FINDING_TYPES.has(item.type as string) ||
      !FINDING_STATUSES.has(item.status as string) ||
      !AUTHORIZATION_HINTS.has(item.authorizationHint as string)) fail();
  return {
    findingId: identifier(item.findingId),
    type: item.type as ContextComposerFindingView["type"],
    statement: safeString(item.statement, 1_000),
    status: item.status as ContextComposerFindingView["status"],
    authorizationHint: item.authorizationHint as ContextComposerFindingView["authorizationHint"],
    limitations: strings(item.limitations),
    evidenceIds: identifiers(item.evidenceIds),
  };
}

function file(value: unknown): ContextComposerEngineFileView {
  const item = record(value, ["path", "role", "usage", "source", "reviewRequired", "reasonCode", "reasonCodes", "findingIds", "findings", "evidenceIds", "evidence"]);
  if (!ROLES.has(item.role as string) || !USAGES.has(item.usage as string) || !FILE_SOURCES.has(item.source as string) || typeof item.reviewRequired !== "boolean") fail();
  const evidenceItems = array(item.evidence).map(evidence);
  if (new Set(evidenceItems.map((entry) => entry.evidenceId)).size !== evidenceItems.length) fail();
  const reasonCodes = array(item.reasonCodes).map(reason);
  if (new Set(reasonCodes).size !== reasonCodes.length || reasonCodes.some((value, index) => index > 0 && reasonCodes[index - 1]! > value)) fail();
  const findingIds = identifiers(item.findingIds);
  const findings = array(item.findings).map(finding);
  const evidenceIds = identifiers(item.evidenceIds);
  if (findings.length !== findingIds.length || findings.some((entry, index) => entry.findingId !== findingIds[index])) fail();
  if (findings.some((entry) => entry.evidenceIds.some((evidenceId) => !evidenceIds.includes(evidenceId)))) fail();
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
    findings,
    evidenceIds,
    evidence: evidenceItems.sort((left, right) => left.evidenceId.localeCompare(right.evidenceId)),
  };
}

function investigationEvent(value: unknown): ContextComposerInvestigationEventView {
  const item = record(value, [
    "sequence", "type", "round", "operationId", "operationType", "operationSource", "status",
    "previousStatus", "stage", "decision", "stopReason", "reasonCode", "paths", "startLine",
    "endLine", "startedAt", "completedAt", "durationMs", "findingIds", "evidenceIds",
  ]);
  if (!TRACE_EVENT_TYPES.has(item.type as string)) fail();
  const sequence = nullableInteger(item.sequence, 1);
  if (sequence === null) fail();
  const startLine = nullableInteger(item.startLine, 1);
  const endLine = nullableInteger(item.endLine, 1);
  if ((startLine === null) !== (endLine === null) || (startLine !== null && endLine! < startLine)) fail();
  const startedAt = nullableTimestamp(item.startedAt);
  const completedAt = nullableTimestamp(item.completedAt);
  if ((startedAt === null) !== (completedAt === null)) fail();
  const result: ContextComposerInvestigationEventView = {
    sequence,
    type: item.type as ContextComposerInvestigationEventView["type"],
    round: nullableInteger(item.round),
    operationId: nullableIdentifier(item.operationId),
    operationType: nullableEnum(item.operationType, OPERATION_TYPES),
    operationSource: nullableEnum(item.operationSource, OPERATION_SOURCES),
    status: nullableEnum(item.status, TRACE_STATUSES),
    previousStatus: nullableEnum(item.previousStatus, QUESTION_STATUSES),
    stage: nullableEnum(item.stage, STOP_STAGES),
    decision: nullableEnum(item.decision, STOP_DECISIONS),
    stopReason: nullableEnum(item.stopReason, STOP_REASONS),
    reasonCode: nullableIdentifier(item.reasonCode),
    paths: strings(item.paths, true),
    startLine,
    endLine,
    startedAt,
    completedAt,
    durationMs: nullableInteger(item.durationMs),
    findingIds: identifiers(item.findingIds),
    evidenceIds: identifiers(item.evidenceIds),
  };
  const operationEvent = new Set([
    "planner_proposal_synthesized", "atomic_commit", "operation_selected",
    "operation_completed", "operation_budget_rejected",
  ]).has(result.type);
  if ((result.round === null) !== (result.type === "seed_interpreted")) fail();
  if (operationEvent) {
    if (result.operationId === null || result.operationType === null) fail();
  } else if (result.operationId !== null || result.operationType !== null) fail();
  if ((result.operationSource !== null) !== (result.type === "planner_proposal_synthesized")) fail();
  if ((result.previousStatus !== null) !== (result.type === "question_updated")) fail();
  if ((result.stage !== null || result.decision !== null || result.stopReason !== null) !== (result.type === "stop_checked")) fail();
  if (result.type === "stop_checked") {
    if (result.stage === null || result.decision === null) fail();
    if ((result.stopReason !== null) !== (result.decision === "stop")) fail();
  }
  const statusEvent = new Set([
    "question_updated", "gap_evaluated", "atomic_commit", "operation_completed",
    "operation_budget_rejected",
  ]).has(result.type);
  if (statusEvent !== (result.status !== null)) fail();
  if (result.type === "question_updated" && !QUESTION_STATUSES.has(result.status!)) fail();
  if (result.type === "gap_evaluated" && !new Set(["resolved", "kept_open"]).has(result.status!)) fail();
  if (result.type === "atomic_commit" && !new Set(["committed", "rejected", "cancelled"]).has(result.status!)) fail();
  if (result.type === "operation_budget_rejected" && result.status !== "skipped") fail();
  const reasonEvent = new Set([
    "gap_evaluated", "operation_completed", "operation_budget_rejected",
  ]).has(result.type);
  if (!reasonEvent && result.reasonCode !== null) fail();
  if (result.type === "gap_evaluated" && result.reasonCode === null) fail();
  if (result.type === "operation_budget_rejected" && result.reasonCode === null) fail();
  if ((result.startedAt !== null || result.completedAt !== null || result.durationMs !== null) !== (result.type === "operation_completed")) fail();
  if (result.type === "operation_completed" && (result.startedAt === null || result.completedAt === null || result.durationMs === null)) fail();
  if (result.startLine !== null && result.operationType !== "read_range") fail();
  if (!operationEvent && (result.paths.length > 0 || result.startLine !== null || result.endLine !== null)) fail();
  if (!["question_updated", "domain_evaluated"].includes(result.type) && result.findingIds.length > 0) fail();
  if (!["gap_evaluated", "operation_completed"].includes(result.type) && result.evidenceIds.length > 0) fail();
  return result;
}

function investigationCoverage(value: unknown): ContextComposerInvestigationCoverageView {
  const item = record(value, [
    "criticalQuestionsTotal", "criticalQuestionsAnswered", "questionsTotal", "questionsAnswered",
    "hypothesesTotal", "hypothesesSupported", "hypothesesRejected", "hypothesesUnresolved",
    "filesConsidered", "filesRead", "filesParsed", "relationshipHops",
    "evidenceIndependentGroups", "snapshotTruncated",
  ]);
  if (typeof item.snapshotTruncated !== "boolean") fail();
  const result: ContextComposerInvestigationCoverageView = {
    criticalQuestionsTotal: nonNegativeInteger(item.criticalQuestionsTotal),
    criticalQuestionsAnswered: nonNegativeInteger(item.criticalQuestionsAnswered),
    questionsTotal: nonNegativeInteger(item.questionsTotal),
    questionsAnswered: nonNegativeInteger(item.questionsAnswered),
    hypothesesTotal: nonNegativeInteger(item.hypothesesTotal),
    hypothesesSupported: nonNegativeInteger(item.hypothesesSupported),
    hypothesesRejected: nonNegativeInteger(item.hypothesesRejected),
    hypothesesUnresolved: nonNegativeInteger(item.hypothesesUnresolved),
    filesConsidered: nonNegativeInteger(item.filesConsidered),
    filesRead: nonNegativeInteger(item.filesRead),
    filesParsed: nonNegativeInteger(item.filesParsed),
    relationshipHops: nonNegativeInteger(item.relationshipHops),
    evidenceIndependentGroups: nonNegativeInteger(item.evidenceIndependentGroups),
    snapshotTruncated: item.snapshotTruncated,
  };
  if (
    result.criticalQuestionsAnswered > result.criticalQuestionsTotal ||
    result.criticalQuestionsTotal > result.questionsTotal ||
    result.questionsAnswered > result.questionsTotal ||
    result.hypothesesSupported + result.hypothesesRejected + result.hypothesesUnresolved > result.hypothesesTotal ||
    result.filesRead > result.filesConsidered ||
    result.filesParsed > result.filesRead
  ) fail();
  return result;
}

function investigationTimeline(value: unknown): ContextComposerInvestigationTimelineView {
  const item = record(value, ["events", "coverage"]);
  const events = array(item.events).map(investigationEvent);
  if (events.some((event, index) => event.sequence !== index + 1)) fail();
  return {
    events,
    coverage: investigationCoverage(item.coverage),
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
  const viewFields = ["schemaVersion", "requestedMode", "effectiveSource", "status", "stopReason", "fallbackReason", "files", "unresolvedQuestions", "limitations", "comparison"] as const;
  const item = record(value, [...viewFields, "timeline"], viewFields);
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
  const timeline = item.timeline === undefined ? undefined : investigationTimeline(item.timeline);
  if (timeline) {
    const filePaths = new Set(files.map((entry) => entry.path.toLocaleLowerCase("en-US")));
    const findingIds = new Set(files.flatMap((entry) => entry.findingIds));
    const evidenceIds = new Set(files.flatMap((entry) => entry.evidenceIds));
    if (timeline.events.some((event) =>
      event.paths.some((path) => !filePaths.has(path.toLocaleLowerCase("en-US"))) ||
      event.findingIds.some((findingId) => !findingIds.has(findingId)) ||
      event.evidenceIds.some((evidenceId) => !evidenceIds.has(evidenceId)))) fail();
    if (timeline.events.length > 0) {
      const finalEvent = timeline.events[timeline.events.length - 1]!;
      if (
        finalEvent.type !== "stop_checked" ||
        finalEvent.stage !== "final" ||
        finalEvent.decision !== "stop" ||
        finalEvent.stopReason !== item.stopReason
      ) fail();
    }
  }
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
    ...(timeline === undefined ? {} : { timeline }),
  };
  return deepFreeze(result);
}
