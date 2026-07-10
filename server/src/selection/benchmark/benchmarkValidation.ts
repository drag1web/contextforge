import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { ProjectInventory } from "../../scanner/projectInventoryScanner.js";
import { fingerprintProjectInventory } from "./benchmarkFingerprint.js";
import type {
  BenchmarkLanguage,
  BenchmarkMetrics,
  BenchmarkSeverity,
  SelectorBenchmarkCase,
  ValidationCoverageSummary,
  ValidationGateProfile,
  ValidationGateResult,
  ValidationIntegritySummary,
  ValidationPackLock,
} from "./benchmarkTypes.js";

const LOCK_SCHEMA_VERSION = 2 as const;

const GATE_THRESHOLDS = {
  standard: {
    minimumCases: 24,
    minimumFamilies: 12,
    minimumProjects: 3,
    minimumTaskTypes: 5,
    minimumAreas: 4,
    minimumLanguageCases: { en: 6, ru: 6, mixed: 2 },
    minimumPrimaryCases: 8,
    minimumSupportCases: 6,
    minimumEditScopeCases: 8,
    minimumRoleCases: 4,
    minimumSafetyCases: 2,
    minimumManualReviewCases: 2,
    minimumMissingTargetCases: 1,
    minimumAbstentionCases: 4,
    minimumPassedRate: 0.9,
    minimumWeightedScore: 90,
    minimumPrimaryAccuracy: 0.9,
    minimumSupportRecall: 0.85,
    minimumEditPrecision: 0.85,
    minimumRoleAccuracy: 0.9,
    minimumSafetyAccuracy: 1,
    minimumMissingTargetAccuracy: 1,
    minimumManualReviewCorrectness: 0.95,
    minimumAreaAccuracy: 0.9,
    minimumCandidateRecall: 0.95,
    maximumUnsafeSelectionRate: 0,
    maximumCriticalFailures: 0,
    maximumHighFailures: 0,
    maximumMediumFailures: 4,
    maximumCandidateSetSize: 40,
  },
  strict: {
    minimumCases: 40,
    minimumFamilies: 20,
    minimumProjects: 4,
    minimumTaskTypes: 7,
    minimumAreas: 5,
    minimumLanguageCases: { en: 10, ru: 10, mixed: 4 },
    minimumPrimaryCases: 14,
    minimumSupportCases: 10,
    minimumEditScopeCases: 14,
    minimumRoleCases: 8,
    minimumSafetyCases: 4,
    minimumManualReviewCases: 4,
    minimumMissingTargetCases: 2,
    minimumAbstentionCases: 8,
    minimumPassedRate: 0.95,
    minimumWeightedScore: 95,
    minimumPrimaryAccuracy: 0.93,
    minimumSupportRecall: 0.9,
    minimumEditPrecision: 0.9,
    minimumRoleAccuracy: 0.95,
    minimumSafetyAccuracy: 1,
    minimumMissingTargetAccuracy: 1,
    minimumManualReviewCorrectness: 1,
    minimumAreaAccuracy: 0.95,
    minimumCandidateRecall: 0.97,
    maximumUnsafeSelectionRate: 0,
    maximumCriticalFailures: 0,
    maximumHighFailures: 0,
    maximumMediumFailures: 2,
    maximumCandidateSetSize: 40,
  },
} as const;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value;
}

function canonicalValidationCases(cases: SelectorBenchmarkCase[]) {
  return [...cases]
    .filter((item) => item.split === "validation")
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((item) => stableValue(item));
}

export function hashValidationCases(cases: SelectorBenchmarkCase[]) {
  const canonical = JSON.stringify(canonicalValidationCases(cases));
  return createHash("sha256").update(canonical).digest("hex");
}

export function summarizeValidationCoverage(cases: SelectorBenchmarkCase[]): ValidationCoverageSummary {
  const validationCases = cases.filter((item) => item.split === "validation");
  const languageCounts: Record<BenchmarkLanguage, number> = { en: 0, ru: 0, mixed: 0 };
  const severityCounts: Record<BenchmarkSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  const families = new Set<string>();
  const projects = new Set<string>();
  const taskTypes = new Set<string>();
  const areas = new Set<string>();
  let primaryExpectationCases = 0;
  let supportExpectationCases = 0;
  let editScopeCases = 0;
  let roleExpectationCases = 0;
  let safetyExpectationCases = 0;
  let manualReviewExpectationCases = 0;
  let missingTargetExpectationCases = 0;
  let abstentionExpectationCases = 0;

  for (const item of validationCases) {
    languageCounts[item.language] += 1;
    severityCounts[item.severity] += 1;
    families.add(item.family);
    projects.add(item.projectFixture);
    taskTypes.add(item.taskType);
    if (item.expected.implementationArea) areas.add(item.expected.implementationArea);
    if ((item.expected.primaryAnyOf?.length ?? 0) + (item.expected.primaryAllOf?.length ?? 0) > 0) primaryExpectationCases += 1;
    if ((item.expected.requiredSupportAnyOf?.length ?? 0) + (item.expected.requiredSupportAllOf?.length ?? 0) > 0) supportExpectationCases += 1;
    if (
      (item.expected.allowedEdit?.length ?? 0) > 0 ||
      item.expected.maxUnexpectedEditTargets != null ||
      (item.expected.forbiddenEdit?.length ?? 0) > 0 ||
      Object.values(item.expected.usageByPath ?? {}).some((usage) => usage === "inspect-and-edit" || usage === "create-and-edit")
    ) {
      editScopeCases += 1;
    }
    if (Object.keys(item.expected.usageByPath ?? {}).length > 0) roleExpectationCases += 1;
    if (item.expected.blocked != null) safetyExpectationCases += 1;
    if (item.expected.manualReview != null) manualReviewExpectationCases += 1;
    if (
      item.expected.blocked !== true &&
      item.expected.manualReview === true &&
      (item.expected.primaryAnyOf?.length ?? 0) === 0 &&
      (item.expected.primaryAllOf?.length ?? 0) === 0
    ) {
      missingTargetExpectationCases += 1;
    }
    if (item.expected.blocked === true || item.expected.manualReview === true) abstentionExpectationCases += 1;
  }

  return {
    caseCount: validationCases.length,
    familyCount: families.size,
    projectCount: projects.size,
    projectFixtures: [...projects].sort(),
    taskTypeCount: taskTypes.size,
    taskTypes: [...taskTypes].sort(),
    areaCount: areas.size,
    implementationAreas: [...areas].sort(),
    languageCounts,
    severityCounts,
    primaryExpectationCases,
    supportExpectationCases,
    editScopeCases,
    roleExpectationCases,
    safetyExpectationCases,
    manualReviewExpectationCases,
    missingTargetExpectationCases,
    abstentionExpectationCases,
  };
}

export async function fingerprintValidationProjects(
  cases: SelectorBenchmarkCase[],
  inventories: Record<string, ProjectInventory>,
) {
  const projectIds = summarizeValidationCoverage(cases).projectFixtures;
  return Object.fromEntries(await Promise.all(projectIds.map(async (projectId) => {
    const inventory = inventories[projectId];
    if (!inventory) throw new Error(`Validation project inventory is unavailable: ${projectId}`);
    return [projectId, await fingerprintProjectInventory(inventory)] as const;
  })));
}

export async function createValidationPackLock(
  cases: SelectorBenchmarkCase[],
  inventories: Record<string, ProjectInventory>,
): Promise<ValidationPackLock> {
  const coverage = summarizeValidationCoverage(cases);
  return {
    schemaVersion: LOCK_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    digest: hashValidationCases(cases),
    caseCount: coverage.caseCount,
    familyCount: coverage.familyCount,
    projectFixtures: coverage.projectFixtures,
    projectFingerprints: await fingerprintValidationProjects(cases, inventories),
  };
}

export async function writeValidationPackLock(
  lockPath: string,
  cases: SelectorBenchmarkCase[],
  inventories: Record<string, ProjectInventory>,
) {
  const absolutePath = path.resolve(lockPath);
  const lock = await createValidationPackLock(cases, inventories);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
  return { lock, absolutePath };
}

export async function readValidationPackLock(lockPath: string): Promise<ValidationPackLock> {
  const absolutePath = path.resolve(lockPath);
  const parsed = JSON.parse(await fs.readFile(absolutePath, "utf8")) as ValidationPackLock;
  if (parsed.schemaVersion !== LOCK_SCHEMA_VERSION) {
    throw new Error(`Unsupported validation lock schema: ${String(parsed.schemaVersion)}`);
  }
  if (!parsed.digest || !Number.isInteger(parsed.caseCount) || !Number.isInteger(parsed.familyCount) || !parsed.projectFingerprints) {
    throw new Error("Validation lock is missing required fields.");
  }
  return parsed;
}

export async function verifyValidationPackLock(
  lockPath: string,
  cases: SelectorBenchmarkCase[],
  inventories: Record<string, ProjectInventory>,
): Promise<ValidationIntegritySummary> {
  const absolutePath = path.resolve(lockPath);
  const lock = await readValidationPackLock(absolutePath);
  const actualDigest = hashValidationCases(cases);
  const coverage = summarizeValidationCoverage(cases);
  const actualProjectFingerprints = await fingerprintValidationProjects(cases, inventories);
  const caseDigestVerified =
    lock.digest === actualDigest &&
    lock.caseCount === coverage.caseCount &&
    lock.familyCount === coverage.familyCount &&
    JSON.stringify([...lock.projectFixtures].sort()) === JSON.stringify(coverage.projectFixtures);
  const projectFingerprintsVerified =
    JSON.stringify(Object.entries(lock.projectFingerprints).sort(([left], [right]) => left.localeCompare(right))) ===
    JSON.stringify(Object.entries(actualProjectFingerprints).sort(([left], [right]) => left.localeCompare(right)));
  return {
    lockPath: absolutePath,
    expectedDigest: lock.digest,
    actualDigest,
    caseDigestVerified,
    projectFingerprintsVerified,
    verified: caseDigestVerified && projectFingerprintsVerified,
    caseCount: coverage.caseCount,
    familyCount: coverage.familyCount,
  };
}

export function unverifiedValidationIntegrity(cases: SelectorBenchmarkCase[]): ValidationIntegritySummary {
  const coverage = summarizeValidationCoverage(cases);
  return {
    lockPath: null,
    expectedDigest: null,
    actualDigest: hashValidationCases(cases),
    caseDigestVerified: false,
    projectFingerprintsVerified: false,
    verified: false,
    caseCount: coverage.caseCount,
    familyCount: coverage.familyCount,
  };
}

function percentage(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

export function evaluateValidationGate(
  metrics: BenchmarkMetrics,
  cases: SelectorBenchmarkCase[],
  profile: ValidationGateProfile,
  integrity: ValidationIntegritySummary,
): ValidationGateResult {
  const coverage = summarizeValidationCoverage(cases);
  const threshold = GATE_THRESHOLDS[profile];
  const failures: string[] = [];
  const addMinimum = (label: string, actual: number, minimum: number) => {
    if (actual < minimum) failures.push(`${label} ${actual} is below ${minimum}`);
  };
  const addRatioMinimum = (label: string, actual: number, minimum: number) => {
    if (actual < minimum) failures.push(`${label} ${percentage(actual)} is below ${percentage(minimum)}`);
  };
  const addMaximum = (label: string, actual: number, maximum: number) => {
    if (actual > maximum) failures.push(`${label} ${actual} exceeds ${maximum}`);
  };
  const addRatioMaximum = (label: string, actual: number, maximum: number) => {
    if (actual > maximum) failures.push(`${label} ${percentage(actual)} exceeds ${percentage(maximum)}`);
  };

  if (!integrity.verified) failures.push("validation lock is missing or does not match the case set/project inventories");
  addMinimum("validation cases", coverage.caseCount, threshold.minimumCases);
  addMinimum("validation families", coverage.familyCount, threshold.minimumFamilies);
  addMinimum("validation projects", coverage.projectCount, threshold.minimumProjects);
  addMinimum("task types", coverage.taskTypeCount, threshold.minimumTaskTypes);
  addMinimum("implementation areas", coverage.areaCount, threshold.minimumAreas);
  for (const language of ["en", "ru", "mixed"] as const) {
    addMinimum(`${language} cases`, coverage.languageCounts[language], threshold.minimumLanguageCases[language]);
  }
  addMinimum("primary expectation cases", coverage.primaryExpectationCases, threshold.minimumPrimaryCases);
  addMinimum("support expectation cases", coverage.supportExpectationCases, threshold.minimumSupportCases);
  addMinimum("edit-scope cases", coverage.editScopeCases, threshold.minimumEditScopeCases);
  addMinimum("role expectation cases", coverage.roleExpectationCases, threshold.minimumRoleCases);
  addMinimum("safety expectation cases", coverage.safetyExpectationCases, threshold.minimumSafetyCases);
  addMinimum("manual-review expectation cases", coverage.manualReviewExpectationCases, threshold.minimumManualReviewCases);
  addMinimum("missing-target expectation cases", coverage.missingTargetExpectationCases, threshold.minimumMissingTargetCases);
  addMinimum("abstention expectation cases", coverage.abstentionExpectationCases, threshold.minimumAbstentionCases);

  addRatioMinimum("case pass rate", metrics.passedCases / Math.max(1, metrics.totalCases), threshold.minimumPassedRate);
  addMinimum("weighted assertion score", metrics.weightedScore, threshold.minimumWeightedScore);
  addRatioMinimum("primary target accuracy", metrics.primaryTargetAccuracy, threshold.minimumPrimaryAccuracy);
  addRatioMinimum("required support recall", metrics.requiredSupportRecall, threshold.minimumSupportRecall);
  addRatioMinimum("edit-target precision", metrics.editTargetPrecision, threshold.minimumEditPrecision);
  addRatioMinimum("role accuracy", metrics.roleAccuracy, threshold.minimumRoleAccuracy);
  addRatioMinimum("safety accuracy", metrics.safetyBlockAccuracy, threshold.minimumSafetyAccuracy);
  addRatioMinimum("missing-target accuracy", metrics.missingTargetAccuracy, threshold.minimumMissingTargetAccuracy);
  addRatioMinimum("manual-review correctness", metrics.manualReviewCorrectness, threshold.minimumManualReviewCorrectness);
  addRatioMinimum("implementation-area accuracy", metrics.implementationAreaAccuracy, threshold.minimumAreaAccuracy);
  addRatioMinimum("candidate recall", metrics.candidateRecall, threshold.minimumCandidateRecall);
  addRatioMaximum("unsafe selection rate", metrics.unsafeSelectionRate, threshold.maximumUnsafeSelectionRate);
  addMaximum("critical failures", metrics.failuresBySeverity.critical, threshold.maximumCriticalFailures);
  addMaximum("high failures", metrics.failuresBySeverity.high, threshold.maximumHighFailures);
  addMaximum("medium failures", metrics.failuresBySeverity.medium, threshold.maximumMediumFailures);
  addMaximum("maximum candidate set size", metrics.maximumCandidateSetSize, threshold.maximumCandidateSetSize);

  return {
    profile,
    passed: failures.length === 0,
    failures,
    coverage,
  };
}
