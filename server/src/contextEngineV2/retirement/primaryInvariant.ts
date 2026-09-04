import { assertPrivacySafeShadowArtifact } from "../shadow/shadowPrivacy.js";
import type {
  GroundedSelectionProof,
  TaskPackPrimaryDecision,
  TaskPackPrimaryReasonCode,
  TaskPackPrimaryRollbackReason,
} from "./retirementTypes.js";

const STATUSES = new Set([
  "v2_applied", "v2_no_selection", "clarification_required", "review_required",
  "safe_fail", "legacy_rollback", "engine_error",
]);
const REASONS = new Set<TaskPackPrimaryReasonCode>([
  "primary_disabled", "manual_selection_authoritative", "canonical_input_mismatch",
  "preparation_limit_exceeded", "capacity_exhausted", "execution_timeout",
  "execution_error", "projection_invalid", "compatibility_invalid",
  "clarification_required", "stop_not_sufficient", "result_not_safe",
  "blocking_gap", "blocking_contradiction", "unsupported_confirmed_finding",
  "evidence_incomplete", "no_editable_target", "explicit_target_not_preserved",
  "negative_constraint_violation", "repository_safety_violation",
  "unknown_inventory_path", "role_usage_mismatch", "review_required",
  "snapshot_mismatch", "repository_changed", "ambiguous_targets",
  "downstream_explicit_target_rejected", "downstream_selection_mutated",
  "downstream_quality_blocked", "downstream_manual_review",
  "downstream_authorization_rejected", "downstream_context_ineligible", "v2_applied",
]);
const ROLLBACKS = new Set<TaskPackPrimaryRollbackReason>([
  "capacity_exhausted", "execution_timeout", "execution_error",
]);
const ROLES = new Set(["target", "test", "supporting", "reference"]);
const USAGES = new Set([
  "inspect-and-edit", "create-and-edit", "inspect-only", "asset-reference", "config-reference",
]);
const KINDS = new Set([
  "source", "test", "style", "config", "docs", "asset", "data", "runtime", "unknown",
]);

function fail(): never {
  throw new Error("Context Engine primary decision failed runtime validation.");
}

function assertDescriptorSafe(value: unknown, seen = new Set<object>()): void {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return;
  if (typeof value !== "object" || seen.has(value)) fail();
  seen.add(value);
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) fail();
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail();
  }
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (Array.isArray(value) && key === "length") continue;
    if (descriptor.get || descriptor.set || !("value" in descriptor) || !descriptor.enumerable) fail();
    assertDescriptorSafe(descriptor.value, seen);
  }
  seen.delete(value);
}

function assertKeys(value: object, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) fail();
}

function safePath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 500 &&
    value === value.replace(/\\/gu, "/") && !value.startsWith("/") &&
    !/^[a-z]:/iu.test(value) && !value.split("/").some((part) => !part || part === "..");
}

function fingerprint(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 300_000;
}

function portable(value: unknown, max = 160): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max &&
    /^[a-z0-9_.:@/-]+$/iu.test(value);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function assertReasons(value: unknown): asserts value is TaskPackPrimaryReasonCode[] {
  if (!Array.isArray(value) || Object.keys(value).length !== value.length || value.length === 0 ||
      value.length > 32 || value.some((reason) => !REASONS.has(reason)) ||
      new Set(value).size !== value.length) fail();
}

function assertFiles(value: unknown): void {
  if (!Array.isArray(value) || Object.keys(value).length !== value.length || value.length > 64) fail();
  const paths = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) fail();
    assertKeys(item, ["path", "kind", "role", "usage"]);
    const record = item as Record<string, unknown>;
    if (!safePath(record.path) || !KINDS.has(String(record.kind)) || !ROLES.has(String(record.role)) ||
        !USAGES.has(String(record.usage)) || paths.has(record.path)) fail();
    const editable = record.usage === "inspect-and-edit" || record.usage === "create-and-edit";
    if ((record.role === "target" || record.role === "test") !== editable) fail();
    paths.add(record.path);
  }
}

function assertProofs(value: unknown, selected: unknown): void {
  if (!Array.isArray(value) || Object.keys(value).length !== value.length || value.length > 64) fail();
  const selectedPaths = new Set((selected as Array<Record<string, unknown>>)
    .filter((file) => file.role === "target" || file.role === "test").map((file) => file.path));
  const proofPaths = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) fail();
    assertKeys(item, [
      "schemaVersion", "path", "role", "evidenceCurrent", "findingConfirmed",
      "targetRoleSupported", "snapshotCurrent", "ambiguityResolved", "constraintsSatisfied", "proofKind",
    ]);
    const proof = item as unknown as GroundedSelectionProof;
    if (proof.schemaVersion !== 1 || !safePath(proof.path) || !["target", "test"].includes(proof.role) ||
        proof.evidenceCurrent !== true || proof.findingConfirmed !== true ||
        proof.targetRoleSupported !== true || proof.snapshotCurrent !== true ||
        proof.ambiguityResolved !== true || proof.constraintsSatisfied !== true ||
        !["direct_definition", "direct_document_identity", "direct_configuration_identity", "exact_relationship_chain"].includes(proof.proofKind) ||
        !selectedPaths.has(proof.path) || proofPaths.has(proof.path)) fail();
    proofPaths.add(proof.path);
  }
  if (proofPaths.size !== selectedPaths.size) fail();
}

export function validateTaskPackPrimaryDecision(value: unknown): TaskPackPrimaryDecision {
  assertDescriptorSafe(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  assertKeys(value, [
    "schemaVersion", "decisionId", "projectId", "taskFingerprint", "clarificationFingerprint",
    "inventoryFingerprint", "snapshotFingerprint", "configurationFingerprint", "status", "reasonCodes",
    "rollbackReason", "selectedFiles", "groundedProofs", "downstreamValidation", "metrics", "timing",
    "modelPlannerUsed", "createdAt",
  ]);
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1 || !portable(record.decisionId) || !portable(record.projectId) ||
      !STATUSES.has(String(record.status)) || !fingerprint(record.taskFingerprint) ||
      !fingerprint(record.clarificationFingerprint) || !fingerprint(record.inventoryFingerprint) ||
      !fingerprint(record.snapshotFingerprint) || !fingerprint(record.configurationFingerprint) ||
      record.modelPlannerUsed !== false || typeof record.createdAt !== "string" ||
      !Number.isFinite(Date.parse(record.createdAt))) fail();
  assertReasons(record.reasonCodes);
  assertFiles(record.selectedFiles);
  assertProofs(record.groundedProofs, record.selectedFiles);
  if (record.rollbackReason !== null && !ROLLBACKS.has(record.rollbackReason as TaskPackPrimaryRollbackReason)) fail();
  if (record.status === "legacy_rollback") {
    if (!record.rollbackReason || !(record.reasonCodes as string[]).includes(record.rollbackReason as string) ||
        (record.selectedFiles as unknown[]).length > 0) fail();
  } else if (record.rollbackReason !== null) fail();
  if (record.status === "v2_applied" &&
      ((record.selectedFiles as unknown[]).length === 0 || (record.groundedProofs as unknown[]).length === 0 ||
       !(record.reasonCodes as string[]).includes("v2_applied"))) fail();
  if (record.status !== "v2_applied" && (record.reasonCodes as string[]).includes("v2_applied")) fail();
  if (record.downstreamValidation !== null) {
    if (!record.downstreamValidation || typeof record.downstreamValidation !== "object" || Array.isArray(record.downstreamValidation)) fail();
    assertKeys(record.downstreamValidation, [
      "passed", "qualityStatus", "explicitTargetStatus", "authorizationPreserved", "contextAssemblyEligible", "reasonCodes",
    ]);
    const downstream = record.downstreamValidation as Record<string, unknown>;
    if (typeof downstream.passed !== "boolean" || !["ready", "warning", "blocked"].includes(String(downstream.qualityStatus)) ||
        !["matched", "unresolved", "not-applicable"].includes(String(downstream.explicitTargetStatus)) ||
        typeof downstream.authorizationPreserved !== "boolean" || typeof downstream.contextAssemblyEligible !== "boolean") fail();
    assertReasons(downstream.reasonCodes);
  }
  if (record.metrics !== null) {
    if (!record.metrics || typeof record.metrics !== "object" || Array.isArray(record.metrics)) fail();
    assertKeys(record.metrics, ["operations", "fileReads", "fileBytes", "parsedFiles", "relationshipHops", "plannerRounds"]);
    if (Object.values(record.metrics).some((item) => !Number.isSafeInteger(item) || (item as number) < 0)) fail();
  }
  if (!record.timing || typeof record.timing !== "object" || Array.isArray(record.timing)) fail();
  assertKeys(record.timing, ["executionMs", "projectionMs", "downstreamValidationMs", "totalMs", "timeoutCeilingMs"]);
  if (Object.values(record.timing).some((item) => !finite(item))) fail();
  assertPrivacySafeShadowArtifact(record);
  return deepFreeze(structuredClone(record) as unknown as TaskPackPrimaryDecision);
}
