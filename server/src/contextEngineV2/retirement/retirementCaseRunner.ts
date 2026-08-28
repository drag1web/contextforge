import { pathMatchesNegativeConstraints } from "../application/negativeConstraintMatcher.js";
import type {
  LegacyRetirementCaseDefinition,
  LegacyRetirementCaseExecution,
  LegacyRetirementCaseResult,
  RetirementCaseVerdict,
  TaskPackPrimaryMappedFile,
} from "./retirementTypes.js";

const derivedResults = new WeakSet<object>();
const CASE_ID = /^[a-z0-9][a-z0-9._:-]{0,100}$/u;
const NORMALIZED_PATH = /^(?!\/)(?![A-Za-z]:)(?!.*(?:^|\/)\.\.(?:\/|$))[^\\\u0000-\u001f]+$/u;

function normalizePath(value: string): string {
  return value.replace(/\\/gu, "/").replace(/^\.\//u, "");
}

function assertDenseUniqueStrings(values: readonly string[], label: string, pathValues = false): void {
  if (!Array.isArray(values)) throw new Error(`invalid_${label}`);
  const seen = new Set<string>();
  for (let index = 0; index < values.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(values, index)) throw new Error(`invalid_${label}`);
    const value = values[index];
    if (typeof value !== "string" || value.length === 0 || (pathValues && !NORMALIZED_PATH.test(value))) {
      throw new Error(`invalid_${label}`);
    }
    const key = pathValues ? normalizePath(value).toLowerCase() : value;
    if (seen.has(key)) throw new Error(`duplicate_${label}`);
    seen.add(key);
  }
}

function validateDefinition(input: LegacyRetirementCaseDefinition): LegacyRetirementCaseDefinition {
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const allowed = new Set([
    "schemaVersion", "caseId", "repositoryShape", "expectedOutcome", "allowedStatuses",
    "requiredPaths", "forbiddenPaths", "ambiguityExpected", "expectedRollbackReason",
  ]);
  if (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) {
    throw new Error("invalid_retirement_case");
  }
  if (Object.values(descriptors).some((descriptor) => descriptor.get || descriptor.set) ||
      Object.keys(descriptors).some((key) => !allowed.has(key))) throw new Error("invalid_retirement_case");
  if (input.schemaVersion !== 1 || !CASE_ID.test(input.caseId) || !CASE_ID.test(input.repositoryShape)) {
    throw new Error("invalid_retirement_case");
  }
  if (!["grounded_selection", "safe_no_selection", "typed_infrastructure_rollback"].includes(input.expectedOutcome)) {
    throw new Error("invalid_retirement_case");
  }
  assertDenseUniqueStrings(input.allowedStatuses, "allowed_statuses");
  assertDenseUniqueStrings(input.requiredPaths, "required_paths", true);
  assertDenseUniqueStrings(input.forbiddenPaths, "forbidden_paths", true);
  if (typeof input.ambiguityExpected !== "boolean") throw new Error("invalid_ambiguity_expectation");
  if (input.expectedRollbackReason !== null &&
      !["capacity_exhausted", "execution_timeout", "execution_error"].includes(input.expectedRollbackReason)) {
    throw new Error("invalid_rollback_expectation");
  }
  return structuredClone(input);
}

function fileSignature(files: readonly TaskPackPrimaryMappedFile[]): string {
  return JSON.stringify(files.map((file) => ({ path: normalizePath(file.path), usage: file.usage, role: file.role }))
    .sort((left, right) => left.path.localeCompare(right.path) || left.usage.localeCompare(right.usage) || left.role.localeCompare(right.role)));
}

function replaySignature(execution: LegacyRetirementCaseExecution): string {
  return JSON.stringify({
    status: execution.resolution.status,
    reasons: [...execution.resolution.decision.reasonCodes].sort(),
    rollbackReason: execution.resolution.rollbackReason,
    selected: fileSignature(execution.effectiveFiles),
    proofs: execution.resolution.groundedProofs.map((proof) => ({ path: normalizePath(proof.path), role: proof.role, kind: proof.proofKind }))
      .sort((left, right) => left.path.localeCompare(right.path) || left.role.localeCompare(right.role)),
  });
}

function deriveResult(
  definition: LegacyRetirementCaseDefinition,
  actual: LegacyRetirementCaseExecution,
  replay: LegacyRetirementCaseExecution,
): LegacyRetirementCaseResult {
  const actualPaths = actual.effectiveFiles.map((file) => normalizePath(file.path)).sort();
  const adoptedPaths = new Set((actual.resolution.adoptedFiles ?? []).map((file) => normalizePath(file.path).toLowerCase()));
  const requiredSatisfied = definition.requiredPaths.every((path) =>
    actualPaths.some((actualPath) => actualPath.toLowerCase() === normalizePath(path).toLowerCase()));
  const forbiddenSelected = definition.forbiddenPaths.some((path) =>
    actualPaths.some((actualPath) => actualPath.toLowerCase() === normalizePath(path).toLowerCase()));
  const editable = actual.effectiveFiles.filter((file) => file.role === "target" || file.role === "test");
  const restrictedEditableSelection = editable.some((file) => {
    const descriptor = actual.canonical.snapshot.files.find((item) => item.normalizedPath === normalizePath(file.path));
    return !descriptor || !descriptor.readable || descriptor.generated || descriptor.secretRisk !== "none";
  });
  const negativeConstraintViolation = editable.some((file) =>
    pathMatchesNegativeConstraints(file.path, actual.canonical.negativeConstraints));
  const silentHybridSelection = actual.resolution.status === "v2_applied" &&
    (actual.effectiveFiles.some((file) => !adoptedPaths.has(normalizePath(file.path).toLowerCase())) ||
      fileSignature(actual.effectiveFiles) !== fileSignature(actual.resolution.adoptedFiles ?? []));
  const unsafeAutomaticAdoption = forbiddenSelected || restrictedEditableSelection || negativeConstraintViolation ||
    (definition.expectedOutcome === "safe_no_selection" && actual.effectiveFiles.length > 0);
  const deterministicReplayEquivalent = replaySignature(actual) === replaySignature(replay);
  const semanticAmbiguityHandledSafely = !definition.ambiguityExpected ||
    (actual.effectiveFiles.length === 0 && !actual.resolution.rollbackEligible && actual.resolution.status !== "v2_applied");
  const groundedRolesSupported = actual.resolution.status !== "v2_applied" || editable.every((file) =>
    actual.resolution.groundedProofs.some((proof) =>
      normalizePath(proof.path).toLowerCase() === normalizePath(file.path).toLowerCase() &&
      proof.role === file.role && proof.evidenceCurrent && proof.findingConfirmed &&
      proof.targetRoleSupported && proof.snapshotCurrent && proof.ambiguityResolved && proof.constraintsSatisfied));
  const allowedStatus = definition.allowedStatuses.includes(actual.resolution.status);
  const rollbackMatches = definition.expectedOutcome !== "typed_infrastructure_rollback" ||
    (actual.resolution.rollbackEligible && actual.resolution.rollbackReason === definition.expectedRollbackReason);
  const selectionMatches = definition.expectedOutcome === "grounded_selection"
    ? actual.resolution.status === "v2_applied" && requiredSatisfied && actual.effectiveFiles.length > 0
    : definition.expectedOutcome === "safe_no_selection"
      ? actual.effectiveFiles.length === 0 && !actual.resolution.rollbackEligible
      : rollbackMatches;

  let verdict: RetirementCaseVerdict;
  if (actual.resolution.status === "engine_error") verdict = "ENGINE_ERROR";
  else if (unsafeAutomaticAdoption || silentHybridSelection || actual.resolution.decision.modelPlannerUsed ||
      !deterministicReplayEquivalent || !semanticAmbiguityHandledSafely || !groundedRolesSupported ||
      (actual.resolution.status === "v2_applied" && (!allowedStatus || !selectionMatches))) verdict = "CRITICAL_FAIL";
  else if (allowedStatus && selectionMatches) {
    verdict = definition.expectedOutcome === "safe_no_selection" ? "ACCEPTABLE" : "PASS";
  } else if (actual.effectiveFiles.length === 0 && !actual.resolution.rollbackEligible) verdict = "SAFE_FAIL";
  else verdict = "CRITICAL_FAIL";

  const result: LegacyRetirementCaseResult = Object.freeze({
    caseId: definition.caseId,
    repositoryShape: definition.repositoryShape,
    actualStatus: actual.resolution.status,
    actualPaths,
    reasonCodes: [...actual.resolution.decision.reasonCodes].sort(),
    verdict,
    unsafeAutomaticAdoption,
    negativeConstraintViolation,
    restrictedEditableSelection,
    silentHybridSelection,
    modelPlannerUsed: actual.resolution.decision.modelPlannerUsed,
    deterministicReplayEquivalent,
    semanticAmbiguityHandledSafely,
    groundedRolesSupported,
  });
  derivedResults.add(result);
  return result;
}

export async function runLegacyRetirementCase(input: {
  definition: LegacyRetirementCaseDefinition;
  execute(): Promise<LegacyRetirementCaseExecution>;
}): Promise<LegacyRetirementCaseResult> {
  const definition = validateDefinition(input.definition);
  try {
    const actual = await input.execute();
    const replay = await input.execute();
    return deriveResult(definition, actual, replay);
  } catch {
    const result: LegacyRetirementCaseResult = Object.freeze({
      caseId: definition.caseId,
      repositoryShape: definition.repositoryShape,
      actualStatus: "engine_error",
      actualPaths: [],
      reasonCodes: ["execution_error" as const],
      verdict: "ENGINE_ERROR",
      unsafeAutomaticAdoption: false,
      negativeConstraintViolation: false,
      restrictedEditableSelection: false,
      silentHybridSelection: false,
      modelPlannerUsed: false,
      deterministicReplayEquivalent: false,
      semanticAmbiguityHandledSafely: !definition.ambiguityExpected,
      groundedRolesSupported: false,
    });
    derivedResults.add(result);
    return result;
  }
}

export function isDerivedLegacyRetirementCaseResult(value: LegacyRetirementCaseResult): boolean {
  return typeof value === "object" && value !== null && derivedResults.has(value);
}
