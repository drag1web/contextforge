import fs from "node:fs/promises";
import path from "node:path";

import type { BenchmarkMetrics, SelectorBenchmarkReport } from "./benchmarkTypes.js";

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function metricsMarkdown(title: string, metrics: BenchmarkMetrics) {
  return [
    `## ${title}`,
    "",
    `- Passed: ${metrics.passedCases}/${metrics.totalCases}`,
    `- Weighted assertion pass score: ${metrics.weightedScore.toFixed(1)}`,
    `- Primary target accuracy: ${percent(metrics.primaryTargetAccuracy)}`,
    `- Required support recall: ${percent(metrics.requiredSupportRecall)}`,
    `- Required support precision: ${percent(metrics.requiredSupportPrecision)}`,
    `- Edit-target precision: ${percent(metrics.editTargetPrecision)}`,
    `- Unexpected edit-target rate: ${percent(metrics.unexpectedEditTargetRate)}`,
    `- Average unexpected edit targets: ${metrics.averageUnexpectedEditTargets.toFixed(2)}`,
    `- Forbidden selected rate: ${percent(metrics.forbiddenSelectedRate)}`,
    `- Forbidden edit-target rate: ${percent(metrics.forbiddenEditTargetRate)}`,
    `- Role accuracy: ${percent(metrics.roleAccuracy)}`,
    `- Safety block accuracy: ${percent(metrics.safetyBlockAccuracy)}`,
    `- Manual-review correctness: ${percent(metrics.manualReviewCorrectness)}`,
    `- Implementation-area accuracy: ${percent(metrics.implementationAreaAccuracy)}`,
    `- Candidate recall: ${percent(metrics.candidateRecall)}`,
    `- Candidate set average / max: ${metrics.averageCandidateSetSize.toFixed(1)} / ${metrics.maximumCandidateSetSize}`,
    `- Actionable selection cases: ${metrics.actionableSelectionCases}`,
    `- Abstention cases / correct: ${metrics.abstentionCases} / ${metrics.correctAbstentions}`,
    `- Abstention decision accuracy: ${percent(metrics.abstentionDecisionAccuracy)}`,
    `- Selection confidence calibration error: ${metrics.confidenceCalibrationError.toFixed(3)}`,
    `- Failures: critical=${metrics.failuresBySeverity.critical}, high=${metrics.failuresBySeverity.high}, medium=${metrics.failuresBySeverity.medium}, low=${metrics.failuresBySeverity.low}`,
    "",
  ].join("\n");
}

export function renderBenchmarkMarkdown(report: SelectorBenchmarkReport) {
  const failureRows = [
    ...report.results.legacy
      .filter((result) => !result.passed)
      .map((result) => `- [legacy] ${result.case.id}: ${result.failures.map((failure) => `[${failure.severity}] ${failure.reason}`).join("; ")}`),
    ...report.results.shadow
      .filter((result) => !result.passed)
      .map((result) => `- [shadow] ${result.case.id}: ${result.failures.map((failure) => `[${failure.severity}] ${failure.reason}`).join("; ")}`),
  ];
  return [
    "# Selector Benchmark Report",
    "",
    `- Timestamp: ${report.timestamp}`,
    `- Selector version: ${report.selectorVersion}`,
    `- Overall mode: ${report.mode}`,
    `- Legacy mode / model: ${report.legacyMode} / ${report.legacyModel ?? "none"}`,
    `- Shadow mode / model: ${report.shadowMode} / ${report.shadowModel ?? "none"}`,
    `- Cases / families: ${report.totalCases} / ${report.familyCount}`,
    `- Split filter: ${report.split}`,
    `- Family filter: ${report.family ?? "all"}`,
    `- Split counts: development=${report.splitCounts.development}, regression=${report.splitCounts.regression}, validation=${report.splitCounts.validation}`,
    `- Case source: ${report.caseSource}`,
    `- Available external projects: ${report.availableProjects.join(", ") || "none"}`,
    `- Skipped external projects: ${report.skippedProjects.join(", ") || "none"}`,
    "",
    metricsMarkdown("Legacy selector", report.legacy),
    metricsMarkdown("Shadow candidate pipeline", report.shadow),
    "## Selection confidence buckets (shadow)",
    "",
    ...report.shadow.confidenceBuckets.map((bucket) => `- ${bucket.label}: n=${bucket.count}, success=${percent(bucket.observedSuccessRate)}, avg confidence=${bucket.averageConfidence.toFixed(1)}, error=${bucket.calibrationError.toFixed(3)}`),
    "",
    ...(report.validation
      ? [
          "## Closed validation",
          "",
          `- Validation digest: ${report.validation.integrity.actualDigest}`,
          `- Lock status: ${report.validation.integrity.verified ? "verified" : "unverified"}`,
          `- Case digest / project fingerprints: ${report.validation.integrity.caseDigestVerified ? "verified" : "unverified"} / ${report.validation.integrity.projectFingerprintsVerified ? "verified" : "unverified"}`,
          `- Cases / families / projects: ${report.validation.coverage.caseCount} / ${report.validation.coverage.familyCount} / ${report.validation.coverage.projectCount}`,
          `- Languages: en=${report.validation.coverage.languageCounts.en}, ru=${report.validation.coverage.languageCounts.ru}, mixed=${report.validation.coverage.languageCounts.mixed}`,
          `- Task types / implementation areas: ${report.validation.coverage.taskTypeCount} / ${report.validation.coverage.areaCount}`,
          `- Primary / support / edit-scope expectations: ${report.validation.coverage.primaryExpectationCases} / ${report.validation.coverage.supportExpectationCases} / ${report.validation.coverage.editScopeCases}`,
          `- Role / safety expectations: ${report.validation.coverage.roleExpectationCases} / ${report.validation.coverage.safetyExpectationCases}`,
          `- Manual-review / missing-target / abstention expectations: ${report.validation.coverage.manualReviewExpectationCases} / ${report.validation.coverage.missingTargetExpectationCases} / ${report.validation.coverage.abstentionExpectationCases}`,
          ...(report.validation.gate
            ? [
                `- Gate: ${report.validation.gate.profile} — ${report.validation.gate.passed ? "passed" : "failed"}`,
                ...report.validation.gate.failures.map((failure) => `  - ${failure}`),
              ]
            : ["- Gate: not requested"]),
          "",
        ]
      : []),
    "## Failed cases",
    "",
    ...(failureRows.length ? failureRows : ["- None"]),
    "",
    "> Weighted score is an assertion pass score, not a claim of real-world selector accuracy. A closed-validation claim additionally requires an external-only validation split, a matching validation lock, and a passing coverage/quality gate. Confidence calibration uses actionable selections only; blocked, manual-review, and empty-selection outcomes are reported separately as abstentions. Reports contain fixture-relative paths and metrics only; they do not include local absolute paths, file contents, secrets, or raw model responses.",
    "",
  ].join("\n");
}

export async function writeBenchmarkReport(report: SelectorBenchmarkReport, outputDirectory: string) {
  await fs.mkdir(outputDirectory, { recursive: true });
  const stamp = report.timestamp.replace(/[:.]/g, "-");
  const baseName = `selector-benchmark-${stamp}`;
  const jsonPath = path.join(outputDirectory, `${baseName}.json`);
  const markdownPath = path.join(outputDirectory, `${baseName}.md`);
  await Promise.all([
    fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
    fs.writeFile(markdownPath, renderBenchmarkMarkdown(report), "utf8"),
  ]);
  return { jsonPath, markdownPath };
}
