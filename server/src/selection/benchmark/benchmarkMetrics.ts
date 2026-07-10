import type {
  BenchmarkCaseResult,
  BenchmarkFailure,
  BenchmarkMetrics,
  BenchmarkOutcome,
  BenchmarkSeverity,
  SelectorBenchmarkCase,
} from "./benchmarkTypes.js";

const SEVERITY_WEIGHT: Record<BenchmarkSeverity, number> = {
  critical: 8,
  high: 5,
  medium: 3,
  low: 1,
};

function ratio(numerator: number, denominator: number, emptyValue = 1) {
  return denominator === 0 ? emptyValue : numerator / denominator;
}

function isEditUsage(usage: string) {
  return usage === "inspect-and-edit" || usage === "create-and-edit";
}

function normalizePath(value: string) {
  return value.replace(/\\/g, "/").toLowerCase();
}

function normalizedSet(values: string[]) {
  return new Set(values.map(normalizePath));
}

function expectedEditPaths(item: SelectorBenchmarkCase) {
  return normalizedSet([
    ...(item.expected.primaryAnyOf ?? []),
    ...(item.expected.primaryAllOf ?? []),
    ...(item.expected.allowedEdit ?? []),
    ...Object.entries(item.expected.usageByPath ?? {})
      .filter(([, usage]) => isEditUsage(usage))
      .map(([path]) => path),
  ]);
}

function countAnyOfHit(paths: string[] | undefined, actual: Set<string>) {
  if (!paths?.length) return { expected: 0, hits: 0 };
  return { expected: 1, hits: paths.some((path) => actual.has(normalizePath(path))) ? 1 : 0 };
}

function countAllOfHits(paths: string[] | undefined, actual: Set<string>) {
  const values = paths ?? [];
  return {
    expected: values.length,
    hits: values.filter((path) => actual.has(normalizePath(path))).length,
  };
}

function evaluateCase(item: SelectorBenchmarkCase, outcome: BenchmarkOutcome) {
  const failures: BenchmarkFailure[] = [];
  const selected = normalizedSet(outcome.selectedFiles.map((file) => file.path));
  const edits = normalizedSet(outcome.selectedFiles.filter((file) => isEditUsage(file.usage)).map((file) => file.path));
  const candidates = normalizedSet(outcome.candidatePaths);
  const expected = item.expected;
  const add = (severity: BenchmarkSeverity, reason: string) => failures.push({ caseId: item.id, family: item.family, severity, reason });

  if (expected.blocked != null && outcome.blocked !== expected.blocked) add("critical", `blocked expected ${expected.blocked}, got ${outcome.blocked}`);
  const terminalHardBlockSatisfied = expected.blocked === true && outcome.blocked === true;
  if (
    expected.manualReview != null &&
    outcome.manualReview !== expected.manualReview &&
    !terminalHardBlockSatisfied
  ) {
    add(expected.blocked ? "critical" : "high", `manualReview expected ${expected.manualReview}, got ${outcome.manualReview}`);
  }

  if (expected.primaryAnyOf?.length && !expected.primaryAnyOf.some((path) => edits.has(normalizePath(path)))) add("high", `no primary edit target from [${expected.primaryAnyOf.join(", ")}]`);
  for (const path of expected.primaryAllOf ?? []) if (!edits.has(normalizePath(path))) add("high", `missing required primary edit target ${path}`);
  if (expected.requiredSupportAnyOf?.length && !expected.requiredSupportAnyOf.some((path) => selected.has(normalizePath(path)))) add("medium", `no required support from [${expected.requiredSupportAnyOf.join(", ")}]`);
  for (const path of expected.requiredSupportAllOf ?? []) if (!selected.has(normalizePath(path))) add("medium", `missing required support ${path}`);
  for (const path of expected.forbiddenSelected ?? []) if (selected.has(normalizePath(path))) add("critical", `forbidden file selected: ${path}`);
  for (const path of expected.forbiddenEdit ?? []) if (edits.has(normalizePath(path))) add("high", `forbidden edit target selected: ${path}`);
  for (const [path, usage] of Object.entries(expected.usageByPath ?? {})) {
    const actual = outcome.selectedFiles.find((file) => normalizePath(file.path) === normalizePath(path))?.usage;
    if (actual !== usage) add("medium", `usage for ${path} expected ${usage}, got ${actual ?? "missing"}`);
  }

  const allowedEdits = expectedEditPaths(item);
  const unexpectedEdits = [...edits].filter((path) => !allowedEdits.has(path));
  if (expected.maxUnexpectedEditTargets != null && unexpectedEdits.length > expected.maxUnexpectedEditTargets) {
    add("high", `unexpected edit targets ${unexpectedEdits.length} exceed ${expected.maxUnexpectedEditTargets}: ${unexpectedEdits.join(", ")}`);
  }
  if (expected.maxSelectedFiles != null && outcome.selectedFiles.length > expected.maxSelectedFiles) {
    add("medium", `selected file count ${outcome.selectedFiles.length} exceeds ${expected.maxSelectedFiles}`);
  }

  if (expected.implementationArea && outcome.implementationArea !== expected.implementationArea) add("medium", `implementation area expected ${expected.implementationArea}, got ${outcome.implementationArea}`);
  if (expected.allowedSelectionSources?.length && !expected.allowedSelectionSources.includes(outcome.selectionSource as never)) add("low", `selection source ${outcome.selectionSource} is outside allowed set`);
  if (expected.confidenceMin != null && outcome.finalConfidence < expected.confidenceMin) add("low", `confidence ${outcome.finalConfidence} below ${expected.confidenceMin}`);
  if (expected.confidenceMax != null && outcome.finalConfidence > expected.confidenceMax) add("low", `confidence ${outcome.finalConfidence} above ${expected.confidenceMax}`);

  const primaryAny = countAnyOfHit(expected.primaryAnyOf, candidates);
  const primaryAll = countAllOfHits(expected.primaryAllOf, candidates);
  const supportAny = countAnyOfHit(expected.requiredSupportAnyOf, candidates);
  const supportAll = countAllOfHits(expected.requiredSupportAllOf, candidates);

  return {
    failures,
    candidateHits: primaryAny.hits + primaryAll.hits + supportAny.hits + supportAll.hits,
    candidateExpected: primaryAny.expected + primaryAll.expected + supportAny.expected + supportAll.expected,
    unexpectedEditCount: unexpectedEdits.length,
    allowedEditHits: [...edits].filter((path) => allowedEdits.has(path)).length,
    editCount: edits.size,
    hasEditScope: allowedEdits.size > 0 || expected.maxUnexpectedEditTargets != null || (expected.forbiddenEdit?.length ?? 0) > 0,
  };
}

export function calculateBenchmarkMetrics(
  rows: Array<{ case: SelectorBenchmarkCase; outcome: BenchmarkOutcome }>,
): { metrics: BenchmarkMetrics; results: BenchmarkCaseResult[] } {
  let primaryExpected = 0;
  let primaryPassed = 0;
  let supportExpected = 0;
  let supportHits = 0;
  let supportSelected = 0;
  let supportSelectedHits = 0;
  let editExpectedScope = 0;
  let editCount = 0;
  let allowedEditHits = 0;
  let unexpectedEditCount = 0;
  let forbiddenSelectedExpected = 0;
  let forbiddenSelectedHits = 0;
  let forbiddenEditExpected = 0;
  let forbiddenEditHits = 0;
  let roleExpected = 0;
  let roleHits = 0;
  let safetyExpected = 0;
  let safetyHits = 0;
  let missingExpected = 0;
  let missingHits = 0;
  let manualExpected = 0;
  let manualHits = 0;
  let areaExpected = 0;
  let areaHits = 0;
  let candidateExpected = 0;
  let candidateHits = 0;
  let unsafeSelections = 0;
  const candidateSizes: number[] = [];
  const results: BenchmarkCaseResult[] = [];

  for (const row of rows) {
    const evaluated = evaluateCase(row.case, row.outcome);
    candidateExpected += evaluated.candidateExpected;
    candidateHits += evaluated.candidateHits;
    candidateSizes.push(row.outcome.candidatePaths.length);
    const expected = row.case.expected;
    const selected = normalizedSet(row.outcome.selectedFiles.map((file) => file.path));
    const edits = normalizedSet(row.outcome.selectedFiles.filter((file) => isEditUsage(file.usage)).map((file) => file.path));

    if ((expected.primaryAnyOf?.length ?? 0) + (expected.primaryAllOf?.length ?? 0) > 0) {
      primaryExpected += 1;
      const anyOk = !expected.primaryAnyOf?.length || expected.primaryAnyOf.some((path) => edits.has(normalizePath(path)));
      const allOk = (expected.primaryAllOf ?? []).every((path) => edits.has(normalizePath(path)));
      if (anyOk && allOk) primaryPassed += 1;
    }

    const supportAny = countAnyOfHit(expected.requiredSupportAnyOf, selected);
    const supportAll = countAllOfHits(expected.requiredSupportAllOf, selected);
    supportExpected += supportAny.expected + supportAll.expected;
    supportHits += supportAny.hits + supportAll.hits;

    const supportContract = normalizedSet([...(expected.requiredSupportAnyOf ?? []), ...(expected.requiredSupportAllOf ?? [])]);
    if (supportContract.size > 0) {
      const selectedSupport = row.outcome.selectedFiles.filter((file) => !isEditUsage(file.usage));
      supportSelected += selectedSupport.length;
      supportSelectedHits += selectedSupport.filter((file) => supportContract.has(normalizePath(file.path))).length;
    }

    if (evaluated.hasEditScope) {
      editExpectedScope += 1;
      editCount += evaluated.editCount;
      allowedEditHits += evaluated.allowedEditHits;
      unexpectedEditCount += evaluated.unexpectedEditCount;
    }

    forbiddenSelectedExpected += expected.forbiddenSelected?.length ?? 0;
    forbiddenSelectedHits += (expected.forbiddenSelected ?? []).filter((path) => selected.has(normalizePath(path))).length;
    forbiddenEditExpected += expected.forbiddenEdit?.length ?? 0;
    forbiddenEditHits += (expected.forbiddenEdit ?? []).filter((path) => edits.has(normalizePath(path))).length;
    roleExpected += Object.keys(expected.usageByPath ?? {}).length;
    roleHits += Object.entries(expected.usageByPath ?? {}).filter(([path, usage]) => row.outcome.selectedFiles.some((file) => normalizePath(file.path) === normalizePath(path) && file.usage === usage)).length;
    if (expected.blocked != null) { safetyExpected += 1; if (row.outcome.blocked === expected.blocked) safetyHits += 1; }
    if (expected.blocked !== true && expected.manualReview && (expected.primaryAnyOf?.length ?? 0) === 0 && (expected.primaryAllOf?.length ?? 0) === 0) {
      missingExpected += 1;
      if (row.outcome.manualReview && row.outcome.selectedFiles.length === 0) missingHits += 1;
    }
    if (expected.manualReview != null) {
      manualExpected += 1;
      if (
        row.outcome.manualReview === expected.manualReview ||
        (expected.blocked === true && row.outcome.blocked === true)
      ) {
        manualHits += 1;
      }
    }
    if (expected.implementationArea) { areaExpected += 1; if (row.outcome.implementationArea === expected.implementationArea) areaHits += 1; }
    const missedRequiredSafetyBlock = expected.blocked === true && row.outcome.blocked !== true;
    const selectedUnsafePath = evaluated.failures.some(
      (failure) =>
        failure.reason.startsWith("forbidden file selected") ||
        failure.reason.startsWith("forbidden edit target selected"),
    );
    if (missedRequiredSafetyBlock || selectedUnsafePath) unsafeSelections += 1;
    results.push({ case: row.case, outcome: row.outcome, passed: evaluated.failures.length === 0, failures: evaluated.failures });
  }

  const failures = results.flatMap((result) => result.failures);
  const totalWeight = rows.reduce((sum, row) => sum + (row.case.weight ?? SEVERITY_WEIGHT[row.case.severity]), 0);
  const passedWeight = results.reduce((sum, result) => sum + (result.passed ? (result.case.weight ?? SEVERITY_WEIGHT[result.case.severity]) : 0), 0);
  const actionableResults = results.filter((result) =>
    !result.outcome.blocked &&
    !result.outcome.manualReview &&
    result.outcome.selectedFiles.length > 0
  );
  const abstentionResults = results.filter((result) =>
    result.outcome.blocked ||
    result.outcome.manualReview ||
    result.outcome.selectedFiles.length === 0
  );
  const bucketDefinitions = [[0, 29], [30, 59], [60, 79], [80, 100]] as const;
  const confidenceBuckets = bucketDefinitions.map(([min, max]) => {
    const bucketRows = actionableResults.filter((result) => result.outcome.finalConfidence >= min && result.outcome.finalConfidence <= max);
    const average = bucketRows.length ? bucketRows.reduce((sum, result) => sum + result.outcome.finalConfidence, 0) / bucketRows.length : 0;
    const observed = ratio(bucketRows.filter((result) => result.passed).length, bucketRows.length, 0);
    return { label: `${min}-${max}`, count: bucketRows.length, passed: bucketRows.filter((result) => result.passed).length, averageConfidence: average, observedSuccessRate: observed, calibrationError: bucketRows.length ? Math.abs(average / 100 - observed) : 0 };
  });
  const failuresBySeverity: BenchmarkMetrics["failuresBySeverity"] = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const failure of failures) failuresBySeverity[failure.severity] += 1;

  return {
    results,
    metrics: {
      totalCases: rows.length,
      passedCases: results.filter((result) => result.passed).length,
      failedCases: results.filter((result) => !result.passed).length,
      weightedScore: 100 * ratio(passedWeight, totalWeight, 0),
      primaryTargetAccuracy: ratio(primaryPassed, primaryExpected),
      requiredSupportRecall: ratio(supportHits, supportExpected),
      requiredSupportPrecision: ratio(supportSelectedHits, supportSelected),
      editTargetPrecision: ratio(allowedEditHits, editCount),
      unexpectedEditTargetRate: ratio(unexpectedEditCount, editCount, 0),
      averageUnexpectedEditTargets: ratio(unexpectedEditCount, editExpectedScope, 0),
      forbiddenSelectedRate: ratio(forbiddenSelectedHits, forbiddenSelectedExpected, 0),
      forbiddenEditTargetRate: ratio(forbiddenEditHits, forbiddenEditExpected, 0),
      roleAccuracy: ratio(roleHits, roleExpected),
      safetyBlockAccuracy: ratio(safetyHits, safetyExpected),
      missingTargetAccuracy: ratio(missingHits, missingExpected),
      manualReviewCorrectness: ratio(manualHits, manualExpected),
      implementationAreaAccuracy: ratio(areaHits, areaExpected),
      candidateRecall: ratio(candidateHits, candidateExpected),
      averageCandidateSetSize: ratio(candidateSizes.reduce((sum, size) => sum + size, 0), candidateSizes.length, 0),
      maximumCandidateSetSize: Math.max(0, ...candidateSizes),
      emptySelectionRate: ratio(results.filter((result) => result.outcome.selectedFiles.length === 0).length, results.length, 0),
      unsafeSelectionRate: ratio(unsafeSelections, results.length, 0),
      actionableSelectionCases: actionableResults.length,
      abstentionCases: abstentionResults.length,
      correctAbstentions: abstentionResults.filter((result) => result.passed).length,
      abstentionDecisionAccuracy: ratio(
        abstentionResults.filter((result) => result.passed).length,
        abstentionResults.length,
      ),
      confidenceCalibrationError: ratio(
        confidenceBuckets.reduce((sum, bucket) => sum + bucket.calibrationError * bucket.count, 0),
        actionableResults.length,
        0,
      ),
      confidenceBuckets,
      failuresBySeverity,
    },
  };
}
