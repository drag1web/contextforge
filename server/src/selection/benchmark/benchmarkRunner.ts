import path from "node:path";
import { fileURLToPath } from "node:url";

import { selectTaskFiles } from "../../ollama/taskFileSelector.js";
import { evaluateContextSelectionQuality } from "../contextQuality.js";
import { deterministicCandidateRanking } from "../constrainedCandidateRanking.js";
import { retrieveCandidates } from "../candidateRetrieval.js";
import { getAppSettings } from "../../settings/settingsService.js";
import { selectorBenchmarkCases } from "./benchmarkCases.js";
import { getBenchmarkFixture, benchmarkFixtureInventories } from "./benchmarkFixtures.js";
import { calculateBenchmarkMetrics } from "./benchmarkMetrics.js";
import { loadBenchmarkProjectManifest } from "./benchmarkProjectManifest.js";
import { writeBenchmarkReport } from "./benchmarkReporter.js";
import type { BenchmarkOutcome, BenchmarkSplit, SelectorBenchmarkCase, SelectorBenchmarkReport } from "./benchmarkTypes.js";
import { validateBenchmarkCases } from "./benchmarkTypes.js";

interface RunnerOptions {
  split: BenchmarkSplit | "all";
  family: string | null;
  live: boolean;
  outputDirectory: string;
  manifestPath?: string;
}

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

function parseArgs(argv: string[]): RunnerOptions {
  const readValue = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const splitValue = readValue("--split") ?? "all";
  if (!["all", "development", "regression", "validation"].includes(splitValue)) throw new Error(`Unknown benchmark split: ${splitValue}`);
  return {
    split: splitValue as RunnerOptions["split"],
    family: readValue("--family") ?? null,
    live: argv.includes("--live"),
    outputDirectory: path.resolve(readValue("--output") ?? path.join(repoRoot, "reports", "selector-benchmark")),
    manifestPath: readValue("--manifest"),
  };
}

function clampConfidence(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

async function runLegacy(caseItem: SelectorBenchmarkCase, inventory: ReturnType<typeof getBenchmarkFixture>, live: boolean): Promise<BenchmarkOutcome> {
  const settings = live ? undefined : { ...(await getAppSettings()), generationMode: "template" as const, defaultOllamaModel: null };
  const selection = await selectTaskFiles({ rawTask: caseItem.prompt, taskType: caseItem.taskType, targetTool: "codex", inventory, settings });
  const quality = evaluateContextSelectionQuality({ rawTask: caseItem.prompt, requestedTaskType: caseItem.taskType, effectiveTaskArea: selection.effectiveTaskArea, inventory, fileSelection: selection, contextQualityMode: "balanced" });
  return {
    selectedFiles: selection.selectedFiles.map((file) => ({ path: file.path, usage: file.usage })),
    candidatePaths: selection.selectedFiles.map((file) => file.path),
    blocked: quality.status === "blocked" || selection.diagnostics?.selectionSource === "blocked",
    manualReview: quality.requiredManualReview,
    implementationArea: selection.effectiveTaskArea,
    selectionSource: selection.diagnostics?.selectionSource ?? (selection.usedFallback ? "fallback" : "ai"),
    finalConfidence: clampConfidence(selection.diagnostics?.finalConfidence ?? quality.signals.confidence),
    qualityScore: quality.score,
  };
}

function runShadow(caseItem: SelectorBenchmarkCase, inventory: ReturnType<typeof getBenchmarkFixture>): BenchmarkOutcome {
  const retrieval = retrieveCandidates({ rawTask: caseItem.prompt, requestedTaskType: caseItem.taskType, inventory });
  const ranking = deterministicCandidateRanking(retrieval);
  const confidence = retrieval.blocked
    ? 0
    : retrieval.manualReview || ranking.manualReview
      ? 25
      : Math.min(retrieval.reviewOnly ? 75 : 92, clampConfidence((ranking.selected[0]?.confidence ?? 0) * 100));
  return {
    selectedFiles: ranking.selected.map((file) => ({ path: file.path, usage: file.usage })),
    candidatePaths: retrieval.candidates.map((candidate) => candidate.path),
    blocked: retrieval.blocked,
    manualReview: retrieval.manualReview || ranking.manualReview,
    implementationArea: retrieval.implementationArea,
    selectionSource: retrieval.blocked ? "blocked" : retrieval.manualReview ? "manual-review" : "shadow-deterministic",
    finalConfidence: confidence,
    qualityScore: confidence,
  };
}

function printSummary(report: SelectorBenchmarkReport, files: { jsonPath: string; markdownPath: string }) {
  const line = (name: string, value: string | number) => console.log(`${name}: ${value}`);
  line("selector benchmark", `${report.totalCases} cases / ${report.familyCount} families`);
  line("splits", `development=${report.splitCounts.development}, regression=${report.splitCounts.regression}, validation=${report.splitCounts.validation}`);
  line("legacy", `${report.legacy.passedCases}/${report.legacy.totalCases} passed; assertion-score=${report.legacy.weightedScore.toFixed(1)}; primary=${(report.legacy.primaryTargetAccuracy * 100).toFixed(1)}%; edit-precision=${(report.legacy.editTargetPrecision * 100).toFixed(1)}%`);
  line("shadow", `${report.shadow.passedCases}/${report.shadow.totalCases} passed; assertion-score=${report.shadow.weightedScore.toFixed(1)}; primary=${(report.shadow.primaryTargetAccuracy * 100).toFixed(1)}%; edit-precision=${(report.shadow.editTargetPrecision * 100).toFixed(1)}%`);
  line("shadow candidate recall", `${(report.shadow.candidateRecall * 100).toFixed(1)}%`);
  line("pipeline modes", `legacy=${report.legacyMode}${report.legacyModel ? ` (${report.legacyModel})` : ""}; shadow=${report.shadowMode}`);
  line("shadow candidate set avg/max", `${report.shadow.averageCandidateSetSize.toFixed(1)}/${report.shadow.maximumCandidateSetSize}`);
  line("legacy failures", JSON.stringify(report.legacy.failuresBySeverity));
  line("shadow failures", JSON.stringify(report.shadow.failuresBySeverity));
  line("json report", path.relative(repoRoot, files.jsonPath));
  line("markdown report", path.relative(repoRoot, files.markdownPath));
}

export async function runSelectorBenchmark(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const external = await loadBenchmarkProjectManifest(options.manifestPath);
  const allCases = [...selectorBenchmarkCases, ...external.cases];
  validateBenchmarkCases(allCases);
  const filteredCases = allCases.filter((item) => (options.split === "all" || item.split === options.split) && (!options.family || item.family === options.family));
  if (filteredCases.length === 0) throw new Error("No selector benchmark cases matched the supplied filters.");
  const inventories = { ...benchmarkFixtureInventories, ...external.inventories };
  const startedAt = Date.now();
  const legacyRows = [];
  const shadowRows = [];

  for (const caseItem of filteredCases) {
    const inventory = inventories[caseItem.projectFixture];
    if (!inventory) throw new Error(`Benchmark case ${caseItem.id} references unavailable fixture ${caseItem.projectFixture}.`);
    legacyRows.push({ case: caseItem, outcome: await runLegacy(caseItem, inventory, options.live) });
    shadowRows.push({ case: caseItem, outcome: runShadow(caseItem, inventory) });
  }

  const legacy = calculateBenchmarkMetrics(legacyRows);
  const shadow = calculateBenchmarkMetrics(shadowRows);
  const settings = await getAppSettings();
  const splitCounts = { development: 0, regression: 0, validation: 0 };
  for (const item of filteredCases) splitCounts[item.split] += 1;
  const report: SelectorBenchmarkReport = {
    timestamp: new Date().toISOString(),
    selectorVersion: "v0.6.2.3-evidence-role-finalization",
    mode: options.live ? "mixed" : "deterministic",
    model: options.live ? settings.defaultOllamaModel : null,
    legacyMode: options.live ? "live" : "deterministic",
    shadowMode: "deterministic",
    legacyModel: options.live ? settings.defaultOllamaModel : null,
    shadowModel: null,
    durationMs: Date.now() - startedAt,
    split: options.split,
    family: options.family,
    totalCases: filteredCases.length,
    familyCount: new Set(filteredCases.map((item) => item.family)).size,
    splitCounts,
    availableProjects: external.availableProjects,
    skippedProjects: external.skippedProjects,
    legacy: legacy.metrics,
    shadow: shadow.metrics,
    failedCaseIds: { legacy: legacy.results.filter((result) => !result.passed).map((result) => result.case.id), shadow: shadow.results.filter((result) => !result.passed).map((result) => result.case.id) },
    results: { legacy: legacy.results, shadow: shadow.results },
  };
  const files = await writeBenchmarkReport(report, options.outputDirectory);
  printSummary(report, files);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSelectorBenchmark().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
