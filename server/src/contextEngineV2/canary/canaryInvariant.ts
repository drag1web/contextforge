import { assertPrivacySafeShadowArtifact } from "../shadow/shadowPrivacy.js";
import type {
  TaskPackCanaryDecision,
  TaskPackCanaryReasonCode,
} from "./canaryTypes.js";

const STATUSES = new Set([
  "not_enabled", "not_in_cohort", "v2_ineligible", "v2_confirmed_no_change", "v2_applied",
  "legacy_fallback", "critical_disagreement",
]);
const MODES = new Set(["disabled", "shadow", "canary"]);
const REASONS = new Set<TaskPackCanaryReasonCode>([
  "canary_disabled", "project_not_in_cohort", "manual_selection_authoritative",
  "canonical_input_mismatch", "capacity_exhausted", "execution_timeout",
  "execution_error", "projection_invalid", "compatibility_invalid",
  "stop_not_sufficient", "result_not_safe", "blocking_gap",
  "blocking_contradiction", "unsupported_confirmed_finding",
  "evidence_incomplete", "no_editable_target", "explicit_target_not_preserved",
  "explicit_target_only_canary", "preparation_limit_exceeded",
  "negative_constraint_violation", "repository_safety_violation",
  "unknown_inventory_path", "role_usage_mismatch", "review_required",
  "snapshot_mismatch", "repository_changed", "critical_safety_disagreement",
  "downstream_explicit_target_rejected", "downstream_selection_mutated",
  "downstream_quality_blocked", "downstream_manual_review",
  "downstream_authorization_rejected", "downstream_context_ineligible",
  "v2_no_selection_delta", "v2_applied",
]);
const USAGES = new Set([
  "inspect-and-edit", "create-and-edit", "inspect-only", "asset-reference",
  "config-reference",
]);

function fail(): never {
  throw new Error("Context Engine Task Pack canary decision failed runtime validation.");
}

function assertDescriptorSafe(value: unknown, seen = new Set<object>()): void {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return;
  if (typeof value !== "object" || seen.has(value)) fail();
  seen.add(value);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null && !Array.isArray(value)) fail();
  if (Array.isArray(value) && Object.keys(value).length !== value.length) fail();
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (descriptor.get || descriptor.set || !("value" in descriptor) ||
        (!descriptor.enumerable && !(Array.isArray(value) && key === "length"))) fail();
    if (Array.isArray(value) && key === "length") continue;
    assertDescriptorSafe(descriptor.value, seen);
  }
  seen.delete(value);
}

function assertKeys(value: object, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  if (actual.length !== sorted.length || actual.some((key, index) => key !== sorted[index])) fail();
}

function fingerprint(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
}

function portable(value: unknown, max = 160): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max &&
    /^[a-z0-9_.:@/-]+$/iu.test(value);
}

function safePath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 500 &&
    value === value.replace(/\\/gu, "/") && !value.startsWith("/") &&
    !/^[a-z]:/iu.test(value) && !value.split("/").some((part) => !part || part === "..");
}

function finiteDuration(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 300_000;
}

function assertReasonCodes(value: unknown): asserts value is TaskPackCanaryReasonCode[] {
  if (!Array.isArray(value) || Object.keys(value).length !== value.length ||
      value.length === 0 || value.length > 32 || value.some((item) => !REASONS.has(item))) fail();
  if (new Set(value).size !== value.length) fail();
}

function assertSummary(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  assertKeys(value, ["files", "editablePaths"]);
  const summary = value as Record<string, unknown>;
  if (!Array.isArray(summary.files) || Object.keys(summary.files).length !== summary.files.length ||
      !Array.isArray(summary.editablePaths) || Object.keys(summary.editablePaths).length !== summary.editablePaths.length) fail();
  const paths = new Set<string>();
  for (const file of summary.files) {
    if (!file || typeof file !== "object" || Array.isArray(file)) fail();
    assertKeys(file, ["path", "usage"]);
    const record = file as Record<string, unknown>;
    if (!safePath(record.path) || !USAGES.has(String(record.usage))) fail();
    if (paths.has(record.path as string)) fail();
    paths.add(record.path as string);
  }
  if (new Set(summary.editablePaths).size !== summary.editablePaths.length) fail();
  for (const path of summary.editablePaths) {
    if (!safePath(path) || !paths.has(path as string)) fail();
  }
  const expectedEditable = (summary.files as Array<Record<string, unknown>>)
    .filter((file) => file.usage === "inspect-and-edit" || file.usage === "create-and-edit")
    .map((file) => file.path);
  if (JSON.stringify(summary.editablePaths) !== JSON.stringify(expectedEditable)) fail();
}

function assertDownstream(value: unknown): void {
  if (value === null) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  assertKeys(value, [
    "passed", "qualityStatus", "explicitTargetStatus", "authorizationPreserved",
    "contextAssemblyEligible", "reasonCodes",
  ]);
  const record = value as Record<string, unknown>;
  if (typeof record.passed !== "boolean" ||
      !["ready", "warning", "blocked"].includes(String(record.qualityStatus)) ||
      !["matched", "unresolved", "not-applicable"].includes(String(record.explicitTargetStatus)) ||
      typeof record.authorizationPreserved !== "boolean" ||
      typeof record.contextAssemblyEligible !== "boolean") fail();
  assertReasonCodes(record.reasonCodes);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export function validateTaskPackCanaryDecision(value: unknown): TaskPackCanaryDecision {
  assertDescriptorSafe(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  assertKeys(value, [
    "schemaVersion", "decisionId", "mode", "cohort", "taskFingerprint",
    "clarificationFingerprint", "inventoryFingerprint", "snapshotFingerprint",
    "configurationFingerprint", "status", "reasonCodes", "legacy", "v2",
    "gatesPassed", "selectionDelta", "downstreamValidation", "timing", "createdAt",
  ]);
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1 || !portable(record.decisionId) ||
      !MODES.has(String(record.mode)) || !STATUSES.has(String(record.status)) ||
      !fingerprint(record.taskFingerprint) || !fingerprint(record.clarificationFingerprint) ||
      !fingerprint(record.inventoryFingerprint) || !fingerprint(record.snapshotFingerprint) ||
      !fingerprint(record.configurationFingerprint) ||
      typeof record.gatesPassed !== "boolean" || typeof record.selectionDelta !== "boolean" ||
      typeof record.createdAt !== "string" || !Number.isFinite(Date.parse(record.createdAt))) fail();
  assertReasonCodes(record.reasonCodes);
  if (!record.cohort || typeof record.cohort !== "object" || Array.isArray(record.cohort)) fail();
  assertKeys(record.cohort, ["allowlisted", "bucket", "configuredPercent", "included", "basisFingerprint"]);
  const cohort = record.cohort as Record<string, unknown>;
  if (typeof cohort.allowlisted !== "boolean" || typeof cohort.included !== "boolean" ||
      !Number.isSafeInteger(cohort.bucket) || (cohort.bucket as number) < 0 || (cohort.bucket as number) > 9_999 ||
      !Number.isSafeInteger(cohort.configuredPercent) || (cohort.configuredPercent as number) < 0 ||
      (cohort.configuredPercent as number) > 100 || !fingerprint(cohort.basisFingerprint)) fail();
  assertSummary(record.legacy);
  if (record.v2 !== null) assertSummary(record.v2);
  assertDownstream(record.downstreamValidation);
  if (!record.timing || typeof record.timing !== "object" || Array.isArray(record.timing)) fail();
  assertKeys(record.timing, ["v2Ms", "downstreamValidationMs", "totalMs", "timeoutCeilingMs"]);
  if (Object.values(record.timing).some((item) => !finiteDuration(item))) fail();
  const reasons = record.reasonCodes as TaskPackCanaryReasonCode[];
  if (record.status === "v2_applied") {
    const downstream = record.downstreamValidation as TaskPackCanaryDecision["downstreamValidation"];
    if (record.mode !== "canary" || cohort.included !== true || record.v2 === null ||
        record.gatesPassed !== true || record.selectionDelta !== true ||
        reasons.length !== 1 || reasons[0] !== "v2_applied" || downstream === null ||
        !downstream.passed || downstream.qualityStatus !== "ready" ||
        !downstream.authorizationPreserved || !downstream.contextAssemblyEligible) fail();
  } else if (reasons.includes("v2_applied") || record.selectionDelta !== false) {
    fail();
  }
  if (record.status === "v2_confirmed_no_change") {
    const downstream = record.downstreamValidation as TaskPackCanaryDecision["downstreamValidation"];
    if (record.mode !== "canary" || cohort.included !== true || record.v2 === null ||
        record.gatesPassed !== true || record.selectionDelta !== false ||
        reasons.length !== 1 || reasons[0] !== "v2_no_selection_delta" || downstream === null ||
        !downstream.passed || downstream.qualityStatus !== "ready" ||
        !downstream.authorizationPreserved || !downstream.contextAssemblyEligible) fail();
  } else if (record.status !== "v2_applied" && record.gatesPassed !== false) {
    fail();
  }
  if (record.status === "not_enabled" &&
      (record.v2 !== null || record.downstreamValidation !== null || !reasons.includes("canary_disabled"))) fail();
  if (record.status === "not_in_cohort" &&
      (cohort.included !== false || record.v2 !== null || record.downstreamValidation !== null ||
       !reasons.includes("project_not_in_cohort"))) fail();
  assertPrivacySafeShadowArtifact(record);
  return deepFreeze(structuredClone(record) as unknown as TaskPackCanaryDecision);
}
