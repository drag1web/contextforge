import type { EvidenceRecord, Finding } from "../contracts/index.js";
import { stableCompare } from "../domain/investigationDomainSupport.js";
import { pathMatchesNegativeConstraints } from "../application/negativeConstraintMatcher.js";
import type {
  ContextEngineValidationCase,
  ValidationCaseMetrics,
  ValidationEntityMatcher,
  ValidationExecutionArtifacts,
  ValidationExpectationFailure,
  ValidationVerdict,
} from "./validationTypes.js";

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").toLowerCase();
}

function globMatches(pattern: string, path: string): boolean {
  const escaped = normalizePath(pattern)
    .replace(/[.+^${}()|[\]\\]/gu, "\\$&")
    .replaceAll("**", "\0")
    .replaceAll("*", "[^/]*")
    .replaceAll("\0", ".*");
  return new RegExp(`^${escaped}$`, "u").test(normalizePath(path));
}

interface ProjectedRecord {
  entityId: string;
  path: string;
  role: "target" | "test" | "supporting" | "reference";
}

function projectedRecords(artifacts: ValidationExecutionArtifacts): ProjectedRecord[] {
  return artifacts.projection.decisions
    .filter((decision): decision is typeof decision & { path: string; role: ProjectedRecord["role"] } =>
      decision.included && decision.path !== undefined && decision.role !== undefined)
    .map((decision) => ({ entityId: decision.entityId, path: decision.path, role: decision.role }));
}

function matcherMatches(
  matcher: ValidationEntityMatcher,
  record: ProjectedRecord,
  artifacts: ValidationExecutionArtifacts,
): boolean {
  switch (matcher.kind) {
    case "path": return normalizePath(record.path) === normalizePath(matcher.path);
    case "path_pattern": return globMatches(matcher.pattern, record.path);
    case "entity_id": return record.entityId === matcher.entityId;
    case "entity_kind": return artifacts.investigation.entities.some((entity) =>
      entity.id === record.entityId && entity.kind === matcher.entityKind);
  }
}

function evidenceSupportsFinding(
  finding: Finding,
  evidenceById: ReadonlyMap<string, EvidenceRecord>,
  artifacts: ValidationExecutionArtifacts,
): boolean {
  return finding.evidenceIds.length > 0 && finding.evidenceIds.every((id) => {
    const evidence = evidenceById.get(id);
    if (
      !evidence || evidence.snapshotId !== artifacts.snapshot.id ||
      evidence.freshness.snapshotId !== artifacts.snapshot.id || !evidence.freshness.current
    ) return false;
    const factBasis = evidence.factIds.some((factId) =>
      artifacts.investigation.facts.some((fact) => fact.id === factId && fact.status === "active"));
    return factBasis || evidence.sourceSpans.length > 0;
  });
}

function criticalCoverage(artifacts: ValidationExecutionArtifacts): number {
  const total = artifacts.investigation.coverage.criticalQuestionsTotal;
  return total === 0 ? 1 : artifacts.investigation.coverage.criticalQuestionsAnswered / total;
}

function addFailure(
  failures: ValidationExpectationFailure[],
  input: Omit<ValidationExpectationFailure, "message"> & { message: string },
): void {
  failures.push(input);
}

function classifyVerdict(failures: readonly ValidationExpectationFailure[]): ValidationVerdict {
  if (failures.length === 0) return "PASS";
  if (failures.some((failure) => failure.severity === "critical")) return "CRITICAL_FAIL";
  if (failures.every((failure) =>
    failure.code === "missing_supporting" ||
    failure.code === "missing_reference" ||
    failure.code === "broad_context" ||
    failure.code === "compatibility_mismatch")) return "ACCEPTABLE";
  return "SAFE_FAIL";
}

export function evaluateValidationExpectations(input: {
  validationCase: ContextEngineValidationCase;
  artifacts: ValidationExecutionArtifacts;
}): {
  verdict: ValidationVerdict;
  failures: ValidationExpectationFailure[];
  metrics: ValidationCaseMetrics;
} {
  const { validationCase, artifacts } = input;
  const expectations = validationCase.expectations;
  const failures: ValidationExpectationFailure[] = [];
  const projected = projectedRecords(artifacts);
  const editable = projected.filter((record) => record.role === "target" || record.role === "test");
  const targets = projected.filter((record) => record.role === "target");
  const tests = projected.filter((record) => record.role === "test");
  const supporting = projected.filter((record) => record.role === "supporting");
  const references = projected.filter((record) => record.role === "reference");
  const evidenceById = new Map(artifacts.investigation.evidence.map((record) => [record.id, record]));
  const requiredTargets = expectations.requiredImplementationTargets ?? [];
  const requiredTests = expectations.requiredTests ?? [];
  const editableAllowlist = [
    ...requiredTargets,
    ...requiredTests,
    ...(expectations.allowedAdditionalEditableTargets ?? []),
  ];

  if (!expectations.allowedStopReasons.includes(artifacts.investigation.stop.reason)) {
    addFailure(failures, {
      code: "stop_reason_mismatch", category: "knowledge", severity: "high",
      message: "Investigation stop reason is outside the manifest allowlist.",
    });
  }
  const expectedSafe = expectations.expectedSafety === "safe";
  if (artifacts.investigation.safeToProject !== expectedSafe) {
    addFailure(failures, {
      code: expectedSafe ? "expected_safe_result_missing" : "unsafe_safe_to_project",
      category: "safety", severity: expectedSafe ? "high" : "critical",
      message: expectedSafe
        ? "Expected safe projection state was not reached."
        : "A case expected to block was marked safe to project.",
    });
  }
  const outcomeMatches = (() => {
    switch (expectations.expectedOutcome) {
      case "grounded_success": return artifacts.investigation.stop.reason === "sufficient_evidence" && artifacts.investigation.safeToProject;
      case "safe_unresolved": return !artifacts.investigation.safeToProject && artifacts.investigation.stop.reason !== "internal_error";
      case "clarification": return artifacts.investigation.stop.reason === "clarification_required";
      case "safety_block": return artifacts.investigation.stop.reason === "safety_blocked";
      case "budget_exhausted": return artifacts.investigation.stop.reason.includes("budget_exhausted");
      case "contradiction_block": return artifacts.investigation.stop.reason === "contradictory_evidence";
    }
  })();
  if (!outcomeMatches) {
    addFailure(failures, {
      code: "outcome_class_mismatch", category: "knowledge", severity: "high",
      message: "Investigation outcome class does not match the manifest expectation.",
    });
  }

  const requireMatchers = (
    matchers: readonly ValidationEntityMatcher[],
    records: readonly ProjectedRecord[],
    code: string,
    category: ValidationExpectationFailure["category"],
  ) => matchers.forEach((matcher) => {
    if (!records.some((record) => matcherMatches(matcher, record, artifacts))) {
      addFailure(failures, {
        code, category, severity: code === "missing_supporting" || code === "missing_reference"
          ? "medium"
          : "high",
        message: "A required projected role matcher was not satisfied.",
      });
    }
  });
  requireMatchers(requiredTargets, targets, "required_target_missing", "projection");
  requireMatchers(requiredTests, tests, "required_test_missing", "projection");
  requireMatchers(expectations.requiredSupporting ?? [], supporting, "missing_supporting", "projection");
  requireMatchers(expectations.requiredReferences ?? [], references, "missing_reference", "projection");
  const unexpectedEditable = editableAllowlist.length === 0
    ? []
    : editable.filter((record) =>
        !editableAllowlist.some((matcher) => matcherMatches(matcher, record, artifacts)));
  unexpectedEditable.forEach(() => addFailure(failures, {
    code: "unexpected_editable_target", category: "safety", severity: "critical",
    message: "Projection contains an editable target outside the manifest allowlist.",
  }));
  const countUnmatched = (
    records: readonly ProjectedRecord[],
    matchers: readonly ValidationEntityMatcher[] | undefined,
  ) => matchers === undefined ? 0 : records.filter((record) =>
    !matchers.some((matcher) => matcherMatches(matcher, record, artifacts))).length;
  const broadContextCount = countUnmatched(supporting, expectations.requiredSupporting) +
    countUnmatched(references, expectations.requiredReferences);
  for (let index = 0; index < broadContextCount; index += 1) addFailure(failures, {
    code: "broad_context", category: "projection", severity: "medium",
    message: "Projection contains context outside the manifest's expected context matchers.",
  });

  for (const matcher of expectations.forbiddenEditableTargets ?? []) {
    if (editable.some((record) => matcherMatches(matcher, record, artifacts))) {
      addFailure(failures, {
        code: "forbidden_editable_target", category: "safety", severity: "critical",
        message: "A forbidden target matcher was projected as editable.",
      });
    }
  }
  const actualPredicates = new Set(artifacts.investigation.facts.map((fact) => fact.predicate));
  (expectations.requiredPredicates ?? []).forEach((predicate) => {
    if (!actualPredicates.has(predicate)) addFailure(failures, {
      code: "required_predicate_missing", category: "knowledge", severity: validationCase.severityIfFailed,
      message: "A required fact predicate is missing.",
    });
  });
  (expectations.forbiddenPredicates ?? []).forEach((predicate) => {
    if (actualPredicates.has(predicate)) addFailure(failures, {
      code: "forbidden_predicate_present", category: "knowledge", severity: validationCase.severityIfFailed,
      message: "A forbidden fact predicate is present.",
    });
  });
  const openGapCategories = new Set(artifacts.investigation.knowledgeGaps
    .filter((gap) => gap.status === "open")
    .map((gap) => gap.category));
  (expectations.requiredGapCategories ?? []).forEach((category) => {
    if (!openGapCategories.has(category)) addFailure(failures, {
      code: "required_gap_missing", category: "knowledge", severity: validationCase.severityIfFailed,
      message: "A required open knowledge-gap category is missing.",
    });
  });
  (expectations.forbiddenGapCategories ?? []).forEach((category) => {
    if (openGapCategories.has(category)) addFailure(failures, {
      code: "forbidden_gap_present", category: "knowledge", severity: validationCase.severityIfFailed,
      message: "A forbidden open knowledge-gap category is present.",
    });
  });

  const coverage = criticalCoverage(artifacts);
  if (coverage < (expectations.minimumCriticalQuestionCoverage ?? 0)) addFailure(failures, {
    code: "critical_question_coverage_low", category: "knowledge", severity: "high",
    message: "Critical-question coverage is below the manifest minimum.",
  });
  if (artifacts.investigation.budgetState.usage.operations > (expectations.maximumOperations ?? Number.MAX_SAFE_INTEGER)) {
    addFailure(failures, {
      code: "operation_budget_expectation_exceeded", category: "efficiency", severity: "high",
      message: "Operation usage exceeds the manifest ceiling.",
    });
  }

  const negativeViolations = expectations.requireNegativeConstraintCompliance === false
    ? []
    : editable.filter((record) => pathMatchesNegativeConstraints(
        record.path,
        validationCase.negativeConstraints ?? [],
      ));
  negativeViolations.forEach(() => addFailure(failures, {
    code: "negative_constraint_violation", category: "safety", severity: "critical",
    message: "An editable projection violates a negative path constraint.",
  }));
  const filesByPath = new Map(artifacts.snapshot.files.map((file) => [normalizePath(file.normalizedPath), file]));
  const unsafeEditable = editable.filter((record) => {
    const file = filesByPath.get(normalizePath(record.path));
    return !file || !file.readable || file.secretRisk === "known" || file.generated;
  });
  unsafeEditable.forEach(() => addFailure(failures, {
    code: "unsafe_editable_authorization", category: "safety", severity: "critical",
    message: "An editable projection references an unsafe, unknown, or generated file.",
  }));

  const explicitDiagnostics = new Map(artifacts.projection.diagnostics
    .filter((diagnostic) => diagnostic.targetKey)
    .map((diagnostic) => [diagnostic.targetKey!, diagnostic]));
  let explicitPreserved = 0;
  if (expectations.requireExplicitTargetPreservation) {
    for (const target of validationCase.explicitTargets ?? []) {
      const key = target.kind === "path"
        ? `path:${normalizePath(target.path)}`
        : `symbol:${target.symbol}`;
      if (explicitDiagnostics.get(key)?.code === "explicit_target_eligible") explicitPreserved += 1;
      else addFailure(failures, {
        code: "explicit_target_violation", category: "safety", severity: "critical",
        message: "An explicit target was not preserved by an eligible keyed diagnostic.",
      });
    }
  }

  const confirmed = artifacts.investigation.findings.filter((finding) => finding.status === "confirmed");
  const completeConfirmed = confirmed.filter((finding) => evidenceSupportsFinding(finding, evidenceById, artifacts));
  confirmed.filter((finding) => !completeConfirmed.includes(finding)).forEach(() => addFailure(failures, {
    code: "unsupported_confirmed_finding", category: "safety", severity: "critical",
    message: "A confirmed finding lacks complete current evidence provenance.",
  }));
  const decisionsByEntity = new Map<string, (typeof artifacts.projection.decisions)[number]>(
    artifacts.projection.decisions.map((decision) => [decision.entityId, decision]),
  );
  projected.forEach((record) => {
    const decision = decisionsByEntity.get(record.entityId)!;
    const traceable = decision.findingIds.length > 0 && decision.evidenceIds.length > 0 &&
      decision.findingIds.some((findingId) => artifacts.investigation.findings.some((finding) =>
        finding.id === findingId && finding.entityIds.includes(decision.entityId) &&
        decision.evidenceIds.some((id) => finding.evidenceIds.includes(id))));
    if (!traceable) addFailure(failures, {
      code: "projection_trace_incomplete", category: "safety", severity: "critical",
      message: "A projected entity lacks a traceable finding/evidence binding.",
    });
  });

  const mixedSnapshotRecords = [
    ...artifacts.investigation.entities,
    ...artifacts.investigation.facts,
    ...artifacts.investigation.evidence,
    ...artifacts.investigation.findings,
    ...artifacts.investigation.contradictions,
    ...artifacts.investigation.knowledgeGaps,
  ].filter((record) => record.snapshotId !== artifacts.snapshot.id).length;
  if (mixedSnapshotRecords > 0) addFailure(failures, {
    code: "mixed_snapshot_records", category: "safety", severity: "critical",
    message: "Validation artifacts contain records from another snapshot.",
  });
  const hiddenBlockingContradictions = artifacts.investigation.contradictions.filter((record) =>
    record.status === "open" && record.severity === "blocking" &&
    artifacts.investigation.stop.reason !== "contradictory_evidence");
  hiddenBlockingContradictions.forEach(() => addFailure(failures, {
    code: "hidden_blocking_contradiction", category: "safety", severity: "critical",
    message: "An open blocking contradiction is hidden by the stop state.",
  }));

  if (expectations.legacyComparison?.requireSafeBlockAgreement &&
    artifacts.compatibility?.safety.safeBlockAgreement !== true) addFailure(failures, {
      code: "compatibility_mismatch", category: "compatibility", severity: "medium",
      message: "Legacy and v2 safe-block decisions disagree.",
    });
  if (expectations.legacyComparison?.requireExactTargetOverlap &&
    (artifacts.compatibility?.overlap.exactTargetPaths.length ?? 0) === 0) addFailure(failures, {
      code: "compatibility_mismatch", category: "compatibility", severity: "medium",
      message: "Legacy and v2 have no exact implementation-target overlap.",
    });

  const actualCost = artifacts.investigation.operationRecords
    .map((record) => record.actualCost)
    .filter((cost): cost is NonNullable<typeof cost> => cost !== undefined);
  const metrics: ValidationCaseMetrics = {
    safety: {
      criticalFailures: failures.filter((failure) => failure.severity === "critical").length,
      negativeConstraintViolations: negativeViolations.length,
      unsafeEditableAuthorizations: unsafeEditable.length,
      explicitTargetViolations: failures.filter((failure) => failure.code === "explicit_target_violation").length,
      mixedSnapshotRecords,
    },
    knowledge: {
      confirmedFindings: confirmed.length,
      confirmedFindingsWithCompleteEvidence: completeConfirmed.length,
      unsupportedConfirmedFindings: confirmed.length - completeConfirmed.length,
      criticalQuestionCoverage: coverage,
      stopReasonCorrect: expectations.allowedStopReasons.includes(artifacts.investigation.stop.reason),
    },
    projection: {
      requiredTargetHits: requiredTargets.filter((matcher) => targets.some((record) => matcherMatches(matcher, record, artifacts))).length,
      requiredTargetCount: requiredTargets.length,
      projectedTargetCount: targets.length,
      requiredTestHits: requiredTests.filter((matcher) => tests.some((record) => matcherMatches(matcher, record, artifacts))).length,
      requiredTestCount: requiredTests.length,
      unexpectedEditablePaths: unexpectedEditable.length,
      explicitTargetsPreserved: explicitPreserved,
      explicitTargetCount: expectations.requireExplicitTargetPreservation
        ? validationCase.explicitTargets?.length ?? 0
        : 0,
    },
    efficiency: {
      operations: artifacts.investigation.budgetState.usage.operations,
      searches: artifacts.investigation.operationRecords.filter((record) => record.operation.type.startsWith("search_")).length,
      reads: artifacts.investigation.budgetState.usage.fileReads,
      bytes: artifacts.investigation.budgetState.usage.fileBytes,
      parsedFiles: artifacts.investigation.budgetState.usage.parsedFiles,
      relationshipHops: artifacts.investigation.budgetState.usage.relationshipHops,
      plannerRounds: artifacts.investigation.budgetState.usage.plannerRounds,
      durationMs: artifacts.durationMs,
      stageTimingsMs: { ...artifacts.stageTimingsMs },
    },
  };
  return {
    verdict: classifyVerdict(failures),
    failures: failures.sort((left, right) => stableCompare(left.code, right.code)),
    metrics,
  };
}
