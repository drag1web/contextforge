import type {
  EvidenceRecord,
  InvestigationCoverage,
  InvestigationHypothesis,
  InvestigationQuestion,
  SnapshotId,
} from "../contracts/index.js";
import { assertEvidenceEvaluationConsistency } from "./evaluationInvariants.js";
import {
  InvestigationDomainError,
  assertCanonicalUtcTimestamp,
  assertClosedRecord,
  assertPortableIdentifier,
  assertSafeInteger,
  assertSafeText,
  assertSortedUniqueStrings,
  cloneDomainValue,
  indexDomainRecordsById,
  sortedUnique,
  stableCompare,
  stableSerialize,
} from "./investigationDomainSupport.js";
import { evaluateEvidenceRequirement } from "./evidenceRequirementEvaluator.js";

const QUESTION_FIELDS = [
  "id", "text", "category", "priority", "status", "answerFindingIds",
] as const;
const QUESTION_CATEGORIES = new Set([
  "owner", "behavior", "data_flow", "route_flow", "state_flow",
  "constraint", "test_coverage", "risk",
]);
const QUESTION_STATUSES = new Set([
  "open", "answered", "partially_answered", "blocked",
]);
const PRIORITIES = new Set(["critical", "high", "normal", "low"]);
const HYPOTHESIS_FIELDS = [
  "id", "claimId", "priority", "status", "requiredEvidence",
  "supportingEvidenceIds", "contradictingEvidenceIds", "openQuestionIds",
  "revision", "history",
] as const;
const HYPOTHESIS_STATUSES = new Set([
  "open", "supported", "rejected", "unresolved",
]);
const TRANSITION_FIELDS = [
  "from", "to", "reason", "evidenceIds", "operationId", "occurredAt",
] as const;
const COVERAGE_INPUT_FIELDS = [
  "snapshotId", "questions", "hypotheses", "evidence", "filesConsidered",
  "filesRead", "filesParsed", "relationshipHops", "snapshotTruncated",
  "blockedScopes",
] as const;

function validateQuestion(question: InvestigationQuestion): void {
  assertClosedRecord(question, QUESTION_FIELDS, QUESTION_FIELDS, "Coverage question");
  assertPortableIdentifier(question.id, "Coverage question id");
  assertSafeText(question.text, "Coverage question text");
  if (
    !QUESTION_CATEGORIES.has(question.category) ||
    !PRIORITIES.has(question.priority) ||
    !QUESTION_STATUSES.has(question.status)
  ) {
    throw new InvestigationDomainError("invalid_record", "Coverage question semantics are unsupported.");
  }
  assertSortedUniqueStrings(question.answerFindingIds, "Coverage answer finding ids");
  question.answerFindingIds.forEach((id) => assertPortableIdentifier(id, "Coverage finding id"));
}

function validateHypothesis(hypothesis: InvestigationHypothesis, snapshotId: SnapshotId): void {
  assertClosedRecord(hypothesis, HYPOTHESIS_FIELDS, HYPOTHESIS_FIELDS, "Coverage hypothesis");
  assertPortableIdentifier(hypothesis.id, "Coverage hypothesis id");
  assertPortableIdentifier(hypothesis.claimId, "Coverage hypothesis claim id");
  if (!PRIORITIES.has(hypothesis.priority) || !HYPOTHESIS_STATUSES.has(hypothesis.status)) {
    throw new InvestigationDomainError("invalid_record", "Coverage hypothesis semantics are unsupported.");
  }
  if (!Array.isArray(hypothesis.requiredEvidence) || !Array.isArray(hypothesis.history)) {
    throw new InvestigationDomainError("invalid_record", "Coverage hypothesis arrays are malformed.");
  }
  const requirementIds = hypothesis.requiredEvidence.map((requirement) => {
    evaluateEvidenceRequirement({ requirement, evidence: [], facts: [], snapshotId });
    return requirement.id;
  });
  assertSortedUniqueStrings(requirementIds, "Coverage requirement ids");
  for (const ids of [
    hypothesis.supportingEvidenceIds,
    hypothesis.contradictingEvidenceIds,
    hypothesis.openQuestionIds,
  ]) {
    assertSortedUniqueStrings(ids, "Coverage hypothesis reference ids");
    ids.forEach((id) => assertPortableIdentifier(id, "Coverage hypothesis reference id"));
  }
  assertSafeInteger(hypothesis.revision, "Coverage hypothesis revision");
  if (hypothesis.revision !== hypothesis.history.length) {
    throw new InvestigationDomainError("invalid_record", "Coverage hypothesis revision is inconsistent.");
  }
  hypothesis.history.forEach((transition) => {
    assertClosedRecord(
      transition,
      TRANSITION_FIELDS,
      ["from", "to", "reason", "evidenceIds", "occurredAt"],
      "Coverage hypothesis transition",
    );
    if (!HYPOTHESIS_STATUSES.has(transition.from) || !HYPOTHESIS_STATUSES.has(transition.to)) {
      throw new InvestigationDomainError("invalid_record", "Coverage transition status is unsupported.");
    }
    assertSafeText(transition.reason, "Coverage transition reason");
    assertSortedUniqueStrings(transition.evidenceIds, "Coverage transition evidence ids");
    transition.evidenceIds.forEach((id) => assertPortableIdentifier(id, "Coverage transition evidence id"));
    assertCanonicalUtcTimestamp(transition.occurredAt, "Coverage transition timestamp");
    if (transition.operationId !== undefined) assertPortableIdentifier(transition.operationId, "Coverage operation id");
  });
}

function validateStringCollection(value: readonly string[], label: string): string[] {
  if (!Array.isArray(value)) {
    throw new InvestigationDomainError("invalid_record", `${label} must be a dense array.`);
  }
  value.forEach((entry) => assertSafeText(entry, `${label} entry`));
  return sortedUnique(value);
}

export interface InvestigationCoverageInput {
  snapshotId: SnapshotId;
  questions: readonly InvestigationQuestion[];
  hypotheses: readonly InvestigationHypothesis[];
  evidence: readonly EvidenceRecord[];
  filesConsidered: readonly string[];
  filesRead: readonly string[];
  filesParsed: readonly string[];
  relationshipHops: number;
  snapshotTruncated: boolean;
  blockedScopes: readonly string[];
}

export function calculateInvestigationCoverage(
  rawInput: InvestigationCoverageInput,
): InvestigationCoverage {
  const input = cloneDomainValue(rawInput);
  assertClosedRecord(
    input,
    COVERAGE_INPUT_FIELDS,
    COVERAGE_INPUT_FIELDS,
    "Investigation coverage input",
  );
  assertPortableIdentifier(input.snapshotId, "Coverage snapshot id");
  const questions = [
    ...indexDomainRecordsById(input.questions, "Coverage question").values(),
  ];
  const hypotheses = [
    ...indexDomainRecordsById(
      input.hypotheses,
      "Coverage hypothesis",
    ).values(),
  ];
  const evidence = [
    ...indexDomainRecordsById(input.evidence, "Coverage evidence").values(),
  ];
  questions.forEach(validateQuestion);
  hypotheses.forEach((hypothesis) => validateHypothesis(hypothesis, input.snapshotId));
  const filesConsidered = validateStringCollection(input.filesConsidered, "Files considered");
  const filesRead = validateStringCollection(input.filesRead, "Files read");
  const filesParsed = validateStringCollection(input.filesParsed, "Files parsed");
  const consideredSet = new Set(filesConsidered);
  const readSet = new Set(filesRead);
  if (filesRead.some((file) => !consideredSet.has(file))) {
    throw new InvestigationDomainError("invalid_record", "Files read must be a subset of files considered.");
  }
  if (filesParsed.some((file) => !readSet.has(file))) {
    throw new InvestigationDomainError("invalid_record", "Files parsed must be a subset of files read.");
  }
  const blockedScopes = validateStringCollection(input.blockedScopes, "Coverage blocked scopes");
  evidence.forEach((record) =>
    assertEvidenceEvaluationConsistency({
      evidence: record,
      snapshotId: input.snapshotId,
    }),
  );
  assertSafeInteger(input.relationshipHops, "Coverage relationship hops");
  if (typeof input.snapshotTruncated !== "boolean") {
    throw new InvestigationDomainError(
      "invalid_record",
      "Coverage snapshot truncation flag must be boolean.",
    );
  }
  for (const scope of input.blockedScopes) {
    assertSafeText(scope, "Coverage blocked scope");
  }
  for (const record of evidence) {
    if (
      record.snapshotId !== input.snapshotId ||
      record.freshness.snapshotId !== input.snapshotId
    ) {
      throw new InvestigationDomainError(
        "snapshot_mismatch",
        "Coverage cannot combine evidence from different snapshots.",
      );
    }
  }
  const criticalQuestions = questions.filter(
    (question) => question.priority === "critical",
  );
  const currentEvidenceGroups = new Map<string, string>();
  const observedSourceChains = new Set<string>();
  for (const evidenceRecord of evidence.sort((left, right) =>
    stableCompare(left.id, right.id),
  )) {
    if (
      !evidenceRecord.freshness.current ||
      evidenceRecord.role === "context_only"
    ) {
      continue;
    }
    const sourceChain = stableSerialize({
      factIds: [...evidenceRecord.factIds].sort(stableCompare),
      sourceSpans: evidenceRecord.sourceSpans
        .map(stableSerialize)
        .sort(stableCompare),
    });
    if (
      observedSourceChains.has(sourceChain) ||
      currentEvidenceGroups.has(evidenceRecord.independenceGroup)
    ) {
      continue;
    }
    observedSourceChains.add(sourceChain);
    currentEvidenceGroups.set(
      evidenceRecord.independenceGroup,
      evidenceRecord.id,
    );
  }
  return cloneDomainValue({
    criticalQuestionsTotal: criticalQuestions.length,
    criticalQuestionsAnswered: criticalQuestions.filter(
      (question) => question.status === "answered",
    ).length,
    questionsTotal: questions.length,
    questionsAnswered: questions.filter(
      (question) => question.status === "answered",
    ).length,
    hypothesesTotal: hypotheses.length,
    hypothesesSupported: hypotheses.filter(
      (hypothesis) => hypothesis.status === "supported",
    ).length,
    hypothesesRejected: hypotheses.filter(
      (hypothesis) => hypothesis.status === "rejected",
    ).length,
    hypothesesUnresolved: hypotheses.filter(
      (hypothesis) => hypothesis.status === "unresolved",
    ).length,
    filesConsidered: filesConsidered.length,
    filesRead: filesRead.length,
    filesParsed: filesParsed.length,
    relationshipHops: input.relationshipHops,
    evidenceIndependentGroups: currentEvidenceGroups.size,
    snapshotTruncated: input.snapshotTruncated,
    blockedScopes,
  });
}
