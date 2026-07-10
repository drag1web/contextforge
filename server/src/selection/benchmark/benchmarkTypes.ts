import type { SelectedTaskFileUsage, SelectorSelectionSource } from "../../ollama/taskFileSelector.js";
import type { TaskArea } from "../../ollama/taskIntentAnalyzer.js";

export type BenchmarkSplit = "development" | "regression" | "validation";
export type BenchmarkLanguage = "en" | "ru" | "mixed";
export type BenchmarkSeverity = "critical" | "high" | "medium" | "low";

export interface BenchmarkExpected {
  blocked?: boolean;
  manualReview?: boolean;
  primaryAnyOf?: string[];
  primaryAllOf?: string[];
  requiredSupportAnyOf?: string[];
  requiredSupportAllOf?: string[];
  forbiddenSelected?: string[];
  forbiddenEdit?: string[];
  usageByPath?: Record<string, SelectedTaskFileUsage>;
  implementationArea?: TaskArea;
  allowedSelectionSources?: SelectorSelectionSource[];
  confidenceMin?: number;
  confidenceMax?: number;
  allowedEdit?: string[];
  maxUnexpectedEditTargets?: number;
  maxSelectedFiles?: number;
}

export interface SelectorBenchmarkCase {
  id: string;
  family: string;
  split: BenchmarkSplit;
  projectFixture: string;
  language: BenchmarkLanguage;
  taskType: string;
  prompt: string;
  expected: BenchmarkExpected;
  severity: BenchmarkSeverity;
  weight?: number;
}

export interface BenchmarkSelectedFile {
  path: string;
  usage: SelectedTaskFileUsage;
}

export interface BenchmarkOutcome {
  selectedFiles: BenchmarkSelectedFile[];
  candidatePaths: string[];
  blocked: boolean;
  manualReview: boolean;
  implementationArea: TaskArea;
  selectionSource: string;
  finalConfidence: number;
  qualityScore: number;
}

export interface BenchmarkFailure {
  caseId: string;
  family: string;
  severity: BenchmarkSeverity;
  reason: string;
}

export interface ConfidenceBucket {
  label: string;
  count: number;
  passed: number;
  averageConfidence: number;
  observedSuccessRate: number;
  calibrationError: number;
}

export interface BenchmarkMetrics {
  totalCases: number;
  passedCases: number;
  failedCases: number;
  weightedScore: number;
  primaryTargetAccuracy: number;
  requiredSupportRecall: number;
  requiredSupportPrecision: number;
  editTargetPrecision: number;
  unexpectedEditTargetRate: number;
  averageUnexpectedEditTargets: number;
  forbiddenSelectedRate: number;
  forbiddenEditTargetRate: number;
  roleAccuracy: number;
  safetyBlockAccuracy: number;
  missingTargetAccuracy: number;
  manualReviewCorrectness: number;
  implementationAreaAccuracy: number;
  candidateRecall: number;
  averageCandidateSetSize: number;
  maximumCandidateSetSize: number;
  emptySelectionRate: number;
  unsafeSelectionRate: number;
  confidenceCalibrationError: number;
  confidenceBuckets: ConfidenceBucket[];
  failuresBySeverity: Record<BenchmarkSeverity, number>;
}

export interface BenchmarkCaseResult {
  case: SelectorBenchmarkCase;
  outcome: BenchmarkOutcome;
  passed: boolean;
  failures: BenchmarkFailure[];
}

export interface SelectorBenchmarkReport {
  timestamp: string;
  selectorVersion: string;
  mode: "deterministic" | "live" | "mixed";
  model: string | null;
  legacyMode: "deterministic" | "live";
  shadowMode: "deterministic" | "live";
  legacyModel: string | null;
  shadowModel: string | null;
  durationMs: number;
  split: BenchmarkSplit | "all";
  family: string | null;
  totalCases: number;
  familyCount: number;
  splitCounts: Record<BenchmarkSplit, number>;
  availableProjects: string[];
  skippedProjects: string[];
  legacy: BenchmarkMetrics;
  shadow: BenchmarkMetrics;
  failedCaseIds: {
    legacy: string[];
    shadow: string[];
  };
  results: {
    legacy: BenchmarkCaseResult[];
    shadow: BenchmarkCaseResult[];
  };
}

const SPLITS = new Set<BenchmarkSplit>(["development", "regression", "validation"]);
const LANGUAGES = new Set<BenchmarkLanguage>(["en", "ru", "mixed"]);
const SEVERITIES = new Set<BenchmarkSeverity>(["critical", "high", "medium", "low"]);

export function validateBenchmarkCases(cases: SelectorBenchmarkCase[]) {
  const errors: string[] = [];
  const ids = new Set<string>();
  const familySplits = new Map<string, BenchmarkSplit>();

  for (const item of cases) {
    if (!item.id.trim()) errors.push("Benchmark case has an empty id.");
    if (ids.has(item.id)) errors.push(`Duplicate benchmark case id: ${item.id}`);
    ids.add(item.id);
    if (!item.family.trim()) errors.push(`Benchmark case ${item.id} has an empty family.`);
    if (!SPLITS.has(item.split)) errors.push(`Benchmark case ${item.id} has unknown split: ${item.split}`);
    if (!LANGUAGES.has(item.language)) errors.push(`Benchmark case ${item.id} has unknown language: ${item.language}`);
    if (!SEVERITIES.has(item.severity)) errors.push(`Benchmark case ${item.id} has unknown severity: ${item.severity}`);
    if (!item.projectFixture.trim()) errors.push(`Benchmark case ${item.id} has no project fixture.`);
    if (!item.prompt.trim()) errors.push(`Benchmark case ${item.id} has an empty prompt.`);

    const priorSplit = familySplits.get(item.family);
    if (priorSplit && priorSplit !== item.split) {
      errors.push(`Task family ${item.family} leaks across ${priorSplit} and ${item.split}.`);
    } else {
      familySplits.set(item.family, item.split);
    }

    const required = new Set([
      ...(item.expected.primaryAnyOf ?? []),
      ...(item.expected.primaryAllOf ?? []),
      ...(item.expected.requiredSupportAnyOf ?? []),
      ...(item.expected.requiredSupportAllOf ?? []),
    ]);
    for (const forbidden of [...(item.expected.forbiddenSelected ?? []), ...(item.expected.forbiddenEdit ?? [])]) {
      if (required.has(forbidden)) errors.push(`Benchmark case ${item.id} requires and forbids ${forbidden}.`);
    }
    if (item.expected.blocked && Object.values(item.expected.usageByPath ?? {}).some((usage) => usage === "inspect-and-edit" || usage === "create-and-edit")) {
      errors.push(`Blocked benchmark case ${item.id} cannot require an edit role.`);
    }
  }

  if (errors.length > 0) throw new Error(`Invalid selector benchmark cases:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  return { caseCount: cases.length, familyCount: familySplits.size };
}
