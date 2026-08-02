import {
  assertClosedRecord,
  assertPortableIdentifier,
  assertSafeText,
  cloneDomainValue,
  sortedUnique,
} from "../domain/investigationDomainSupport.js";
import type {
  LegacyValidationCaseLike,
  TranslatedValidationCase,
  ValidationEntityMatcher,
} from "./validationTypes.js";

const MAPPED_EXPECTATION_FIELDS = new Set([
  "blocked", "manualReview", "primaryAnyOf", "primaryAllOf", "forbiddenSelected",
  "forbiddenEdit", "explicitTargets",
]);

export function translateLegacyValidationCase(input: {
  legacyCase: LegacyValidationCaseLike;
  defaultProjectId: string;
}): TranslatedValidationCase {
  const legacyCase = cloneDomainValue(input.legacyCase);
  assertClosedRecord(
    legacyCase,
    Object.keys(legacyCase),
    ["id", "task"],
    "Legacy validation case translation input",
  );
  assertPortableIdentifier(legacyCase.id, "Legacy validation case id");
  assertSafeText(legacyCase.task, "Legacy validation task");
  const projectId = legacyCase.projectId ?? input.defaultProjectId;
  assertPortableIdentifier(projectId, "Translated validation project id");
  const expected = legacyCase.expected ?? {};
  const required = sortedUnique([
    ...(expected.primaryAnyOf ?? []),
    ...(expected.primaryAllOf ?? []),
  ]).map((path): ValidationEntityMatcher => ({ kind: "path", path: path.replaceAll("\\", "/") }));
  const forbidden = sortedUnique([
    ...(expected.forbiddenSelected ?? []),
    ...(expected.forbiddenEdit ?? []),
  ]).map((path): ValidationEntityMatcher => ({ kind: "path", path: path.replaceAll("\\", "/") }));
  const compatibilityNotes = Object.keys(expected)
    .filter((key) => !MAPPED_EXPECTATION_FIELDS.has(key))
    .sort()
    .map((key) => `unsupported_legacy_expectation:${key}`);
  const blocked = expected.blocked === true;
  const review = expected.manualReview === true;
  return {
    validationCase: {
      id: legacyCase.id,
      title: `Translated legacy case ${legacyCase.id}`,
      projectId,
      task: { taskText: legacyCase.task },
      purpose: blocked || review ? "review_context" : "implementation_context",
      explicitTargets: expected.explicitTargets ?? [],
      negativeConstraints: [],
      expectations: {
        allowedStopReasons: blocked
          ? ["safety_blocked", "contradictory_evidence", "clarification_required"]
          : review
            ? ["clarification_required", "no_grounded_lead"]
            : ["sufficient_evidence"],
        requiredImplementationTargets: required,
        forbiddenEditableTargets: forbidden,
        expectedSafety: blocked || review ? "blocked" : "safe",
        expectedOutcome: blocked ? "safety_block" : review ? "safe_unresolved" : "grounded_success",
        requireExplicitTargetPreservation: (expected.explicitTargets?.length ?? 0) > 0,
        requireNegativeConstraintCompliance: true,
      },
      labels: sortedUnique(["translated_legacy", ...(legacyCase.labels ?? [])]),
      severityIfFailed: legacyCase.severity ?? "high",
    },
    compatibilityNotes,
  };
}
