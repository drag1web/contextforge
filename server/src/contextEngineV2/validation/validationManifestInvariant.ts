import type {
  InvestigationBudget,
  StopReason,
} from "../contracts/index.js";
import {
  assertCanonicalUtcTimestamp,
  assertClosedRecord,
  assertPortableIdentifier,
  assertSafeText,
  cloneDomainValue,
} from "../domain/investigationDomainSupport.js";
import type {
  ContextEngineValidationCase,
  ContextEngineValidationManifest,
  ValidationEntityMatcher,
  ValidationExpectations,
  ValidationProjectDefinition,
} from "./validationTypes.js";

const MANIFEST_FIELDS = ["schemaVersion", "manifestId", "title", "createdAt", "projects", "cases"] as const;
const PROJECT_FIELDS = ["id", "title", "source", "labels"] as const;
const CASE_FIELDS = [
  "id", "title", "projectId", "task", "purpose", "budget", "explicitTargets",
  "negativeConstraints", "expectations", "labels", "severityIfFailed",
] as const;
const EXPECTATION_FIELDS = [
  "allowedStopReasons", "requiredImplementationTargets", "requiredSupporting",
  "requiredTests", "requiredReferences", "forbiddenEditableTargets",
  "allowedAdditionalEditableTargets",
  "requiredPredicates", "forbiddenPredicates", "requiredGapCategories",
  "forbiddenGapCategories", "minimumCriticalQuestionCoverage", "maximumOperations",
  "requireExplicitTargetPreservation", "requireNegativeConstraintCompliance",
  "expectedSafety", "expectedOutcome", "legacyComparison",
] as const;
const BUDGET_FIELDS = [
  "maxOperations", "maxFileReads", "maxFileBytes", "maxParsedFiles",
  "maxRelationshipHops", "maxWallTimeMs", "maxPlannerRounds",
  "maxConcurrentOperations",
] as const satisfies readonly (keyof InvestigationBudget)[];
const STOP_REASONS = new Set<StopReason>([
  "sufficient_evidence", "clarification_required", "no_grounded_lead",
  "contradictory_evidence", "operation_budget_exhausted", "file_budget_exhausted",
  "byte_budget_exhausted", "time_budget_exhausted", "planner_round_budget_exhausted",
  "repository_snapshot_truncated", "repository_changed", "safety_blocked", "internal_error",
]);
const PURPOSES = new Set([
  "implementation_context", "review_context", "clarification", "shadow_comparison",
]);
const SEVERITIES = new Set(["critical", "high", "medium", "low"]);
const OUTCOMES = new Set([
  "grounded_success", "safe_unresolved", "clarification", "safety_block",
  "budget_exhausted", "contradiction_block",
]);
const GAP_CATEGORIES = new Set([
  "missing_owner", "missing_behavior", "missing_relationship", "missing_runtime_variant",
  "missing_test_evidence", "ambiguous_user_intent", "snapshot_truncated",
  "unreadable_source", "safety_restricted", "custom",
]);

export class ValidationManifestError extends Error {
  readonly code = "invalid_validation_manifest" as const;
  readonly stage = "CE2-06" as const;

  constructor(message = "Context Engine validation manifest failed safe runtime validation.") {
    super(message);
    this.name = "ValidationManifestError";
  }
}

function denseArray(value: unknown, field: string): asserts value is unknown[] {
  if (!Array.isArray(value)) throw new ValidationManifestError(`${field} must be an array.`);
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      throw new ValidationManifestError(`${field} must be dense.`);
    }
  }
}

function uniqueStrings(value: unknown, field: string, portable = false): asserts value is string[] {
  denseArray(value, field);
  const seen = new Set<string>();
  value.forEach((entry) => {
    if (portable) assertPortableIdentifier(entry, field);
    else assertSafeText(entry, field);
    if (seen.has(entry)) throw new ValidationManifestError(`${field} contains duplicates.`);
    seen.add(entry);
  });
}

function normalizedRelativePath(value: unknown, field: string): asserts value is string {
  assertSafeText(value, field);
  if (
    value.startsWith("/") ||
    /^[A-Za-z]:/u.test(value) ||
    value.includes("\\") ||
    value.endsWith("/") ||
    value.includes("//") ||
    value.split("/").some((segment) => segment === "" || segment === "." || segment === "..") ||
    /[\0-\x1f\x7f]/u.test(value)
  ) {
    throw new ValidationManifestError(`${field} must be a normalized repository-relative path.`);
  }
}

function validateMatcher(matcher: ValidationEntityMatcher, field: string): void {
  if (matcher.kind === "path") {
    assertClosedRecord(matcher, ["kind", "path"], ["kind", "path"], field);
    normalizedRelativePath(matcher.path, `${field}.path`);
  } else if (matcher.kind === "path_pattern") {
    assertClosedRecord(matcher, ["kind", "pattern"], ["kind", "pattern"], field);
    assertSafeText(matcher.pattern, `${field}.pattern`);
    if (matcher.pattern.startsWith("/") || /^[A-Za-z]:/u.test(matcher.pattern) || matcher.pattern.includes("\\")) {
      throw new ValidationManifestError(`${field}.pattern must be repository-relative POSIX syntax.`);
    }
  } else if (matcher.kind === "entity_id") {
    assertClosedRecord(matcher, ["kind", "entityId"], ["kind", "entityId"], field);
    assertPortableIdentifier(matcher.entityId, `${field}.entityId`);
  } else if (matcher.kind === "entity_kind") {
    assertClosedRecord(matcher, ["kind", "entityKind"], ["kind", "entityKind"], field);
    assertSafeText(matcher.entityKind, `${field}.entityKind`);
  } else {
    throw new ValidationManifestError(`${field} has an unsupported matcher kind.`);
  }
}

function validateMatcherArray(value: unknown, field: string): void {
  if (value === undefined) return;
  denseArray(value, field);
  value.forEach((matcher, index) => validateMatcher(matcher as ValidationEntityMatcher, `${field}[${index}]`));
}

function validateExpectations(value: ValidationExpectations, field: string): void {
  assertClosedRecord(value, EXPECTATION_FIELDS, [
    "allowedStopReasons", "expectedSafety", "expectedOutcome",
  ], field);
  uniqueStrings(value.allowedStopReasons, `${field}.allowedStopReasons`);
  if (value.allowedStopReasons.length === 0 || value.allowedStopReasons.some((reason) => !STOP_REASONS.has(reason))) {
    throw new ValidationManifestError(`${field}.allowedStopReasons contains unsupported values.`);
  }
  [
    "requiredImplementationTargets", "requiredSupporting", "requiredTests",
    "requiredReferences", "forbiddenEditableTargets", "allowedAdditionalEditableTargets",
  ].forEach((key) => validateMatcherArray(value[key as keyof ValidationExpectations], `${field}.${key}`));
  ["requiredPredicates", "forbiddenPredicates"].forEach((key) => {
    const entry = value[key as "requiredPredicates" | "forbiddenPredicates"];
    if (entry !== undefined) uniqueStrings(entry, `${field}.${key}`);
  });
  ["requiredGapCategories", "forbiddenGapCategories"].forEach((key) => {
    const entry = value[key as "requiredGapCategories" | "forbiddenGapCategories"];
    if (entry === undefined) return;
    uniqueStrings(entry, `${field}.${key}`);
    if (entry.some((category) => !GAP_CATEGORIES.has(category))) {
      throw new ValidationManifestError(`${field}.${key} contains unsupported categories.`);
    }
  });
  if (
    value.minimumCriticalQuestionCoverage !== undefined &&
    (typeof value.minimumCriticalQuestionCoverage !== "number" ||
      !Number.isFinite(value.minimumCriticalQuestionCoverage) ||
      value.minimumCriticalQuestionCoverage < 0 || value.minimumCriticalQuestionCoverage > 1)
  ) {
    throw new ValidationManifestError(`${field}.minimumCriticalQuestionCoverage must be within 0..1.`);
  }
  if (
    value.maximumOperations !== undefined &&
    (!Number.isSafeInteger(value.maximumOperations) || value.maximumOperations < 0)
  ) {
    throw new ValidationManifestError(`${field}.maximumOperations must be a non-negative safe integer.`);
  }
  ["requireExplicitTargetPreservation", "requireNegativeConstraintCompliance"].forEach((key) => {
    const entry = value[key as "requireExplicitTargetPreservation" | "requireNegativeConstraintCompliance"];
    if (entry !== undefined && typeof entry !== "boolean") {
      throw new ValidationManifestError(`${field}.${key} must be boolean.`);
    }
  });
  if (value.expectedSafety !== "safe" && value.expectedSafety !== "blocked") {
    throw new ValidationManifestError(`${field}.expectedSafety is unsupported.`);
  }
  if (!OUTCOMES.has(value.expectedOutcome)) {
    throw new ValidationManifestError(`${field}.expectedOutcome is unsupported.`);
  }
  if (value.legacyComparison !== undefined) {
    assertClosedRecord(
      value.legacyComparison,
      ["basis", "requireSafeBlockAgreement", "requireExactTargetOverlap"],
      [],
      `${field}.legacyComparison`,
    );
    if (value.legacyComparison.basis !== undefined) {
      assertClosedRecord(
        value.legacyComparison.basis,
        ["kind", "referenceId", "outcome"],
        ["kind", "referenceId", "outcome"],
        `${field}.legacyComparison.basis`,
      );
      if (value.legacyComparison.basis.kind !== "manifest" && value.legacyComparison.basis.kind !== "expert") {
        throw new ValidationManifestError(`${field}.legacyComparison.basis.kind is unsupported.`);
      }
      assertPortableIdentifier(value.legacyComparison.basis.referenceId, `${field}.legacyComparison.basis.referenceId`);
    }
  }
}

function validateBudget(value: Partial<InvestigationBudget> | undefined, field: string): void {
  if (value === undefined) return;
  assertClosedRecord(value, BUDGET_FIELDS, [], field);
  Object.entries(value).forEach(([key, limit]) => {
    if (!Number.isSafeInteger(limit) || (limit as number) < 0) {
      throw new ValidationManifestError(`${field}.${key} must be a non-negative safe integer.`);
    }
    if (key === "maxConcurrentOperations" && limit === 0) {
      throw new ValidationManifestError(`${field}.maxConcurrentOperations must be positive.`);
    }
  });
}

function validateProject(project: ValidationProjectDefinition, index: number): void {
  const field = `projects[${index}]`;
  assertClosedRecord(project, PROJECT_FIELDS, PROJECT_FIELDS, field);
  assertPortableIdentifier(project.id, `${field}.id`);
  assertSafeText(project.title, `${field}.title`);
  uniqueStrings(project.labels, `${field}.labels`);
  if (project.source.kind === "synthetic") {
    assertClosedRecord(project.source, ["kind", "fixtureId"], ["kind", "fixtureId"], `${field}.source`);
    assertPortableIdentifier(project.source.fixtureId, `${field}.source.fixtureId`);
  } else if (project.source.kind === "local") {
    assertClosedRecord(project.source, ["kind", "rootKey"], ["kind", "rootKey"], `${field}.source`);
    assertPortableIdentifier(project.source.rootKey, `${field}.source.rootKey`);
  } else {
    throw new ValidationManifestError(`${field}.source.kind is unsupported.`);
  }
}

function validateCase(item: ContextEngineValidationCase, index: number, projectIds: Set<string>): void {
  const field = `cases[${index}]`;
  assertClosedRecord(item, CASE_FIELDS, [
    "id", "title", "projectId", "task", "purpose", "expectations", "labels", "severityIfFailed",
  ], field);
  assertPortableIdentifier(item.id, `${field}.id`);
  assertSafeText(item.title, `${field}.title`);
  assertPortableIdentifier(item.projectId, `${field}.projectId`);
  if (!projectIds.has(item.projectId)) throw new ValidationManifestError(`${field}.projectId is unknown.`);
  assertClosedRecord(item.task, ["taskText"], ["taskText"], `${field}.task`);
  assertSafeText(item.task.taskText, `${field}.task.taskText`);
  if (!PURPOSES.has(item.purpose)) throw new ValidationManifestError(`${field}.purpose is unsupported.`);
  validateBudget(item.budget, `${field}.budget`);
  if (item.explicitTargets !== undefined) {
    denseArray(item.explicitTargets, `${field}.explicitTargets`);
    item.explicitTargets.forEach((target, targetIndex) => {
      if (target.kind === "path") {
        assertClosedRecord(target, ["kind", "path"], ["kind", "path"], `${field}.explicitTargets[${targetIndex}]`);
        normalizedRelativePath(target.path, `${field}.explicitTargets[${targetIndex}].path`);
      } else if (target.kind === "symbol") {
        assertClosedRecord(target, ["kind", "symbol"], ["kind", "symbol"], `${field}.explicitTargets[${targetIndex}]`);
        assertSafeText(target.symbol, `${field}.explicitTargets[${targetIndex}].symbol`);
      } else throw new ValidationManifestError(`${field}.explicitTargets contains unsupported values.`);
    });
  }
  if (item.negativeConstraints !== undefined) {
    denseArray(item.negativeConstraints, `${field}.negativeConstraints`);
    item.negativeConstraints.forEach((constraint, constraintIndex) => {
      if (constraint.kind === "path") {
        assertClosedRecord(constraint, ["kind", "pattern"], ["kind", "pattern"], `${field}.negativeConstraints[${constraintIndex}]`);
        assertSafeText(constraint.pattern, `${field}.negativeConstraints[${constraintIndex}].pattern`);
      } else if (constraint.kind === "semantic") {
        assertClosedRecord(constraint, ["kind", "description"], ["kind", "description"], `${field}.negativeConstraints[${constraintIndex}]`);
        assertSafeText(constraint.description, `${field}.negativeConstraints[${constraintIndex}].description`);
      } else throw new ValidationManifestError(`${field}.negativeConstraints contains unsupported values.`);
    });
  }
  validateExpectations(item.expectations, `${field}.expectations`);
  uniqueStrings(item.labels, `${field}.labels`);
  if (!SEVERITIES.has(item.severityIfFailed)) throw new ValidationManifestError(`${field}.severityIfFailed is unsupported.`);
}

export function validateContextEngineValidationManifest(
  raw: ContextEngineValidationManifest,
): ContextEngineValidationManifest {
  try {
    const manifest = cloneDomainValue(raw);
    assertClosedRecord(manifest, MANIFEST_FIELDS, ["schemaVersion", "manifestId", "title", "projects", "cases"], "Validation manifest");
    if (manifest.schemaVersion !== 1) throw new ValidationManifestError("Validation manifest schemaVersion must be 1.");
    assertPortableIdentifier(manifest.manifestId, "Validation manifest id");
    assertSafeText(manifest.title, "Validation manifest title");
    if (manifest.createdAt !== undefined) assertCanonicalUtcTimestamp(manifest.createdAt, "Validation manifest createdAt");
    denseArray(manifest.projects, "Validation manifest projects");
    denseArray(manifest.cases, "Validation manifest cases");
    if (manifest.projects.length === 0 || manifest.cases.length === 0) {
      throw new ValidationManifestError("Validation manifest requires projects and cases.");
    }
    const projectIds = new Set<string>();
    manifest.projects.forEach((project, index) => {
      validateProject(project, index);
      if (projectIds.has(project.id)) throw new ValidationManifestError("Validation manifest contains duplicate project ids.");
      projectIds.add(project.id);
    });
    const caseIds = new Set<string>();
    manifest.cases.forEach((item, index) => {
      validateCase(item, index, projectIds);
      if (caseIds.has(item.id)) throw new ValidationManifestError("Validation manifest contains duplicate case ids.");
      caseIds.add(item.id);
    });
    return manifest;
  } catch (error) {
    if (error instanceof ValidationManifestError) throw error;
    throw new ValidationManifestError();
  }
}
