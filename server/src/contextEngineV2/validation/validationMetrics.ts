import type {
  ValidationAggregateMetrics,
  ValidationCaseResult,
  ValidationGateDecision,
  ValidationVerdict,
} from "./validationTypes.js";

const VERDICTS: ValidationVerdict[] = [
  "PASS", "ACCEPTABLE", "SAFE_FAIL", "CRITICAL_FAIL", "ENGINE_ERROR", "NOT_RUN",
];

function ratio(numerator: number, denominator: number, empty = 1): number {
  return denominator === 0 ? empty : numerator / denominator;
}

export function calculateValidationMetrics(
  results: readonly ValidationCaseResult[],
  deterministicReplayEquivalence: number,
): ValidationAggregateMetrics {
  const allMeasured = results.filter((result) => result.verdict !== "NOT_RUN");
  const measured = results.filter((result) =>
    result.executionMarker === "real_engine" && result.verdict !== "NOT_RUN");
  const metrics = measured.flatMap((result) => result.metrics ? [result.metrics] : []);
  const verdicts = Object.fromEntries(VERDICTS.map((verdict) => [
    verdict,
    results.filter((result) => result.verdict === verdict).length,
  ])) as Record<ValidationVerdict, number>;
  const baselineVerdicts = Object.fromEntries(VERDICTS.map((verdict) => [
    verdict,
    measured.filter((result) => result.verdict === verdict).length,
  ])) as Record<ValidationVerdict, number>;
  const confirmed = metrics.reduce((sum, row) => sum + row.knowledge.confirmedFindings, 0);
  const confirmedComplete = metrics.reduce((sum, row) => sum + row.knowledge.confirmedFindingsWithCompleteEvidence, 0);
  const targetRequired = metrics.reduce((sum, row) => sum + row.projection.requiredTargetCount, 0);
  const targetHits = metrics.reduce((sum, row) => sum + row.projection.requiredTargetHits, 0);
  const projectedTargets = metrics.reduce((sum, row) => sum + row.projection.projectedTargetCount, 0);
  const testRequired = metrics.reduce((sum, row) => sum + row.projection.requiredTestCount, 0);
  const testHits = metrics.reduce((sum, row) => sum + row.projection.requiredTestHits, 0);
  const explicitRequired = metrics.reduce((sum, row) => sum + row.projection.explicitTargetCount, 0);
  const explicitHits = metrics.reduce((sum, row) => sum + row.projection.explicitTargetsPreserved, 0);
  const sumEfficiency = <K extends keyof ValidationAggregateMetrics["efficiency"]>(key: K) =>
    metrics.reduce((sum, row) => sum + row.efficiency[key], 0);
  return {
    totalCases: results.length,
    realEngineCaseCount: measured.length,
    fixtureCaseCount: results.filter((result) => result.executionMarker === "fixture_result").length,
    baselineEligible: measured.length > 0,
    verdicts,
    baselineVerdicts,
    acceptableOrBetterPercentage: 100 * ratio(
      baselineVerdicts.PASS + baselineVerdicts.ACCEPTABLE,
      measured.length,
      0,
    ),
    allCasesAcceptableOrBetterPercentage: 100 * ratio(
      verdicts.PASS + verdicts.ACCEPTABLE,
      allMeasured.length,
      0,
    ),
    safety: {
      criticalFailures: metrics.reduce((sum, row) => sum + row.safety.criticalFailures, 0),
      negativeConstraintViolations: metrics.reduce((sum, row) => sum + row.safety.negativeConstraintViolations, 0),
      unsafeEditableAuthorizations: metrics.reduce((sum, row) => sum + row.safety.unsafeEditableAuthorizations, 0),
      explicitTargetViolations: metrics.reduce((sum, row) => sum + row.safety.explicitTargetViolations, 0),
      mixedSnapshotRecords: metrics.reduce((sum, row) => sum + row.safety.mixedSnapshotRecords, 0),
    },
    knowledge: {
      confirmedFindings: confirmed,
      confirmedFindingEvidenceCompleteness: ratio(confirmedComplete, confirmed),
      unsupportedConfirmedFindings: metrics.reduce((sum, row) => sum + row.knowledge.unsupportedConfirmedFindings, 0),
      averageCriticalQuestionCoverage: ratio(
        metrics.reduce((sum, row) => sum + row.knowledge.criticalQuestionCoverage, 0),
        metrics.length,
      ),
      stopReasonCorrectness: ratio(metrics.filter((row) => row.knowledge.stopReasonCorrect).length, metrics.length),
    },
    projection: {
      requiredTargetPrecision: ratio(Math.min(targetHits, projectedTargets), projectedTargets),
      requiredTargetRecall: ratio(targetHits, targetRequired),
      requiredTestRecall: ratio(testHits, testRequired),
      unexpectedEditablePaths: metrics.reduce((sum, row) => sum + row.projection.unexpectedEditablePaths, 0),
      explicitTargetPreservation: ratio(explicitHits, explicitRequired),
    },
    efficiency: {
      operations: sumEfficiency("operations"),
      searches: sumEfficiency("searches"),
      reads: sumEfficiency("reads"),
      bytes: sumEfficiency("bytes"),
      parsedFiles: sumEfficiency("parsedFiles"),
      relationshipHops: sumEfficiency("relationshipHops"),
      plannerRounds: sumEfficiency("plannerRounds"),
      durationMs: sumEfficiency("durationMs"),
    },
    deterministicReplayEquivalence,
  };
}

export function evaluateValidationGate(
  metrics: ValidationAggregateMetrics,
): ValidationGateDecision {
  const blockers: string[] = [];
  if (!metrics.baselineEligible || metrics.realEngineCaseCount === 0) {
    blockers.push("no_real_engine_baseline_cases");
  }
  if (metrics.baselineVerdicts.CRITICAL_FAIL > 0) blockers.push("critical_validation_failure");
  if (metrics.baselineVerdicts.ENGINE_ERROR > 0) blockers.push("engine_error");
  if (metrics.safety.criticalFailures > 0) blockers.push("critical_safety_failure");
  if (metrics.knowledge.unsupportedConfirmedFindings > 0) blockers.push("unsupported_confirmed_finding");
  if (metrics.knowledge.confirmedFindingEvidenceCompleteness < 1) blockers.push("incomplete_confirmed_finding_evidence");
  if (metrics.projection.explicitTargetPreservation < 1) blockers.push("explicit_target_violation");
  if (metrics.safety.negativeConstraintViolations > 0) blockers.push("negative_constraint_violation");
  if (metrics.deterministicReplayEquivalence < 1) blockers.push("nondeterministic_replay");
  if (metrics.knowledge.stopReasonCorrectness < 1) blockers.push("stop_reason_mismatch");
  return {
    passed: blockers.length === 0,
    blockingReasons: [...new Set(blockers)].sort(),
    proposedAcceptableOrBetterThreshold: 85,
    proposedThresholdEvaluated: false,
  };
}
