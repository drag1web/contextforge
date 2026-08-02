import type { ContextEngineShadowComparison } from "./shadowTypes.js";
import { assertPrivacySafeShadowArtifact } from "./shadowPrivacy.js";

function fail(): never {
  throw new Error("Context Engine shadow diagnostic failed runtime validation.");
}

function assertDescriptorSafe(value: unknown, seen = new Set<object>()): void {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return;
  if (typeof value !== "object" || seen.has(value)) fail();
  seen.add(value);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null && !Array.isArray(value)) fail();
  if (Array.isArray(value) && Object.keys(value).length !== value.length) fail();
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (descriptor.get || descriptor.set || !("value" in descriptor)) fail();
    assertDescriptorSafe(descriptor.value, seen);
  }
  seen.delete(value);
}

function assertKeys(value: object, allowed: readonly string[]): void {
  const keys = Object.keys(value).sort();
  const expected = [...allowed].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) fail();
}

function portable(value: unknown, max = 200): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && /^[a-z0-9_.:@/-]+$/iu.test(value);
}

function fingerprint(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 86_400_000;
}

function safePath(value: unknown): value is string {
  return typeof value === "string" && Boolean(value) && value === value.replace(/\\/gu, "/") &&
    !value.startsWith("/") && !/^[a-z]:/iu.test(value) && !value.split("/").includes("..");
}

function assertStringArray(value: unknown, pathValues = false): asserts value is string[] {
  if (!Array.isArray(value) || Object.keys(value).length !== value.length ||
      value.some((item) => pathValues ? !safePath(item) : !portable(item, 300))) fail();
}

function assertLegacy(value: unknown): void {
  if (value === null) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  assertKeys(value, ["selectedPaths", "implementationTargetPaths", "testPaths", "editablePaths", "targetPaths", "supportingPaths", "referencePaths", "usedFallback", "source"]);
  for (const key of ["selectedPaths", "implementationTargetPaths", "testPaths", "editablePaths", "targetPaths", "supportingPaths", "referencePaths"] as const) {
    assertStringArray((value as Record<string, unknown>)[key], true);
  }
  if (typeof (value as Record<string, unknown>).usedFallback !== "boolean" || !portable((value as Record<string, unknown>).source)) fail();
}

function assertV2(value: unknown): void {
  if (value === null) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  assertKeys(value, ["snapshotId", "purpose", "selectedPaths", "implementationTargetPaths", "testPaths", "editablePaths", "targetPaths", "supportingPaths", "referencePaths", "traceablePaths", "stopReason", "safeToProject", "blocked"]);
  const record = value as Record<string, unknown>;
  for (const key of ["selectedPaths", "implementationTargetPaths", "testPaths", "editablePaths", "targetPaths", "supportingPaths", "referencePaths", "traceablePaths"] as const) assertStringArray(record[key], true);
  if (!portable(record.snapshotId) || !portable(record.purpose) || !portable(record.stopReason) || typeof record.safeToProject !== "boolean" || typeof record.blocked !== "boolean") fail();
}

function assertPathArrayRecord(value: unknown, keys: readonly string[]): void {
  if (value === null) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  assertKeys(value, keys);
  for (const key of keys) assertStringArray((value as Record<string, unknown>)[key], true);
}

function assertTiming(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  const keys = ["legacyMs", "v2Ms", "comparisonMs", "persistenceMs", "totalShadowOverheadMs", "timeoutCeilingMs"];
  assertKeys(value, keys);
  for (const key of keys) {
    const timing = (value as Record<string, unknown>)[key];
    if (key === "persistenceMs" ? timing !== null : !finiteNonNegative(timing)) fail();
  }
}

function assertBudget(value: unknown): void {
  if (value === null) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  const keys = ["operations", "fileReads", "fileBytes", "parsedFiles", "relationshipHops", "plannerRounds"];
  assertKeys(value, keys);
  if (keys.some((key) => !Number.isSafeInteger((value as Record<string, unknown>)[key]) || ((value as Record<string, number>)[key] ?? -1) < 0)) fail();
}

export function validateContextEngineShadowComparison(value: unknown): ContextEngineShadowComparison {
  assertDescriptorSafe(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  const keys = [
    "schemaVersion", "comparisonId", "projectId", "taskFingerprint", "clarificationFingerprint",
    "inventoryFingerprint", "snapshotFingerprint", "configurationFingerprint", "status", "legacy", "v2",
    "overlap", "safety", "evidence", "explicitTargets", "manualReviewAgreement", "outcome", "stopReason", "safeToProject",
    "openBlockingGapCount", "openContradictionCount", "unsupportedConfirmedFindingCount",
    "confirmedFindingEvidenceCompleteness", "budgetUsage", "issues", "timing", "createdAt",
  ];
  assertKeys(value, keys);
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1 || !portable(record.comparisonId) || !portable(record.projectId) ||
      !fingerprint(record.taskFingerprint) || !fingerprint(record.clarificationFingerprint) ||
      !fingerprint(record.inventoryFingerprint) || !fingerprint(record.snapshotFingerprint) ||
      !fingerprint(record.configurationFingerprint) ||
      !["completed", "timeout", "cancelled", "execution_error", "input_mismatch"].includes(String(record.status)) ||
      !Number.isFinite(Date.parse(String(record.createdAt)))) fail();
  assertLegacy(record.legacy);
  assertV2(record.v2);
  assertPathArrayRecord(record.overlap, ["exactTargetPaths", "legacyOnlyTargetPaths", "v2OnlyTargetPaths", "exactEditablePaths", "legacyOnlyEditablePaths", "v2OnlyEditablePaths", "supportingOrReferenceOverlap", "allSelectedOverlap"]);
  if (record.safety !== null) {
    if (!record.safety || typeof record.safety !== "object" || Array.isArray(record.safety)) fail();
    assertKeys(record.safety, ["legacyNegativeConstraintViolations", "v2NegativeConstraintViolations", "legacyRepositorySafetyViolations", "v2RepositorySafetyViolations", "legacyBlocked", "v2Blocked", "safeBlockAgreement"]);
    const safety = record.safety as Record<string, unknown>;
    for (const key of ["legacyNegativeConstraintViolations", "v2NegativeConstraintViolations", "legacyRepositorySafetyViolations", "v2RepositorySafetyViolations"]) assertStringArray(safety[key], true);
    for (const key of ["legacyBlocked", "v2Blocked", "safeBlockAgreement"]) if (typeof safety[key] !== "boolean") fail();
  }
  if (record.evidence !== null) {
    if (!record.evidence || typeof record.evidence !== "object" || Array.isArray(record.evidence)) fail();
    assertKeys(record.evidence, ["v2TraceableSelectedPaths", "v2UntraceableSelectedPaths", "legacyEvidenceAvailability"]);
    const evidence = record.evidence as Record<string, unknown>;
    assertStringArray(evidence.v2TraceableSelectedPaths, true);
    assertStringArray(evidence.v2UntraceableSelectedPaths, true);
    if (evidence.legacyEvidenceAvailability !== "not_evaluated") fail();
  }
  if (!Array.isArray(record.explicitTargets) || !Array.isArray(record.issues)) fail();
  if (record.manualReviewAgreement !== null && typeof record.manualReviewAgreement !== "boolean") fail();
  for (const target of record.explicitTargets) {
    if (!target || typeof target !== "object" || Array.isArray(target)) fail();
    const allowed = (target as Record<string, unknown>).resolvedPath === undefined
      ? ["targetKey", "kind", "legacyStatus", "v2Status", "disagreement"]
      : ["targetKey", "kind", "resolvedPath", "legacyStatus", "v2Status", "disagreement"];
    assertKeys(target, allowed);
    if (!portable((target as Record<string, unknown>).targetKey) ||
        !["path", "symbol"].includes(String((target as Record<string, unknown>).kind)) ||
        ("resolvedPath" in target && !safePath((target as Record<string, unknown>).resolvedPath)) ||
        !["preserved", "dropped", "unresolved", "unknown"].includes(String((target as Record<string, unknown>).legacyStatus)) ||
        !["preserved", "dropped", "unresolved", "unknown"].includes(String((target as Record<string, unknown>).v2Status)) ||
        typeof (target as Record<string, unknown>).disagreement !== "boolean") fail();
  }
  for (const issue of record.issues) {
    if (!issue || typeof issue !== "object" || Array.isArray(issue)) fail();
    assertKeys(issue, ["code", "severity"]);
    if (![
      "canonical_input_mismatch", "shadow_timeout", "shadow_cancelled", "shadow_execution_error",
      "shadow_projection_error", "shadow_comparison_error", "legacy_safe_v2_risky",
      "v2_safe_legacy_risky", "explicit_target_disagreement", "negative_constraint_disagreement",
      "repository_safety_disagreement", "unsupported_confirmed_finding", "blocking_state_incoherent",
    ].includes(String((issue as Record<string, unknown>).code)) ||
        !["critical", "warning"].includes(String((issue as Record<string, unknown>).severity))) fail();
  }
  for (const key of ["openBlockingGapCount", "openContradictionCount", "unsupportedConfirmedFindingCount"]) if (!Number.isSafeInteger(record[key]) || (record[key] as number) < 0) fail();
  if (record.confirmedFindingEvidenceCompleteness !== null && (!finiteNonNegative(record.confirmedFindingEvidenceCompleteness) || (record.confirmedFindingEvidenceCompleteness as number) > 1)) fail();
  if (record.stopReason !== null && !portable(record.stopReason)) fail();
  if (record.safeToProject !== null && typeof record.safeToProject !== "boolean") fail();
  if (!portable(record.outcome)) fail();
  assertBudget(record.budgetUsage);
  assertTiming(record.timing);
  assertPrivacySafeShadowArtifact(record);
  return structuredClone(record) as unknown as ContextEngineShadowComparison;
}
