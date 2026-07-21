import type {
  ContextComposerPreview,
  TaskClarification,
  TaskUnderstandingResponse,
} from "../types";

export const VALIDATION_MANIFEST_FORMAT =
  "contextforge.validation-manifest" as const;
export const VALIDATION_MANIFEST_VERSION = 1 as const;
export const MAX_VALIDATION_CASES = 50;
export const MAX_VALIDATION_MANIFEST_BYTES = 1_000_000;

export type ValidationCaseStatus =
  | "passed"
  | "failed"
  | "observed"
  | "error"
  | "skipped";

export interface ValidationManifestDefaults {
  taskType?: string;
  targetTool?: string;
  acceptReview?: boolean;
}

export interface ValidationExpectation {
  understandingReadiness?: "ready" | "review" | "needs_clarification";
  interactionAction?: "continue" | "review" | "clarify";
  qualityStatus?: "ready" | "warning" | "blocked";
  executionMode?: string;
  effectiveTaskArea?: string;
  selectedPaths?: string[];
  selectedPathsMode?: "contains" | "exact";
  excludedPaths?: string[];
  authorizedTargets?: string[];
  minQualityScore?: number;
  maxQualityScore?: number;
  maxWarnings?: number;
  maxDurationMs?: number;
}

export interface ValidationTestCase {
  id: string;
  title?: string;
  task: string;
  taskType?: string;
  targetTool?: string;
  clarifications?: TaskClarification[];
  acceptReview?: boolean;
  stopAfterUnderstanding?: boolean;
  disabled?: boolean;
  expect?: ValidationExpectation;
}

export interface ValidationManifest {
  format: typeof VALIDATION_MANIFEST_FORMAT;
  version: typeof VALIDATION_MANIFEST_VERSION;
  name: string;
  description?: string;
  defaults: ValidationManifestDefaults;
  tests: ValidationTestCase[];
}

export interface ValidationCheckResult {
  key: string;
  passed: boolean;
  expected: unknown;
  actual: unknown;
  message: string;
}

export interface ValidationActualSummary {
  understandingReadiness: string;
  interactionAction: string;
  qualityStatus: string | null;
  qualityScore: number | null;
  executionMode: string | null;
  effectiveTaskArea: string | null;
  selectedPaths: string[];
  authorizedTargets: string[];
  warnings: string[];
  blockingReasons: string[];
  durationMs: number;
}

export interface ValidationCaseDiagnostics {
  input: ValidationTestCase;
  resolvedInput: {
    projectId: number;
    taskType: string;
    targetTool: string;
    acceptReview: boolean;
  };
  understanding: TaskUnderstandingResponse | null;
  preview: unknown;
}

export interface ValidationCaseResult {
  id: string;
  title: string;
  status: ValidationCaseStatus;
  durationMs: number;
  checks: ValidationCheckResult[];
  actual: ValidationActualSummary | null;
  error: string | null;
  diagnostics: ValidationCaseDiagnostics;
}

export interface ValidationRunResult {
  format: "contextforge.validation-run";
  version: 1;
  runId: string;
  manifest: ValidationManifest;
  sourceFileName: string;
  project: {
    id: number;
    name: string;
    localPath: string;
  };
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  cancelled: boolean;
  results: ValidationCaseResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    observed: number;
    errors: number;
    skipped: number;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown, label: string, maxLength: number) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new Error(`${label} must not exceed ${maxLength} characters.`);
  }

  return normalized;
}

function optionalString(value: unknown, label: string, maxLength: number) {
  if (value === undefined) return undefined;
  return requiredString(value, label, maxLength);
}

function optionalBoolean(value: unknown, label: string) {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be true or false.`);
  }
  return value;
}

function optionalNumber(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
) {
  if (value === undefined) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function optionalStringArray(
  value: unknown,
  label: string,
  maxItems = 100,
) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new Error(`${label} must be an array with at most ${maxItems} items.`);
  }

  return value.map((item, index) =>
    requiredString(item, `${label}[${index}]`, 500),
  );
}

function oneOf<T extends string>(
  value: unknown,
  label: string,
  allowed: readonly T[],
): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`${label} must be one of: ${allowed.join(", ")}.`);
  }
  return value as T;
}

function parseClarifications(
  value: unknown,
  label: string,
): TaskClarification[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 20) {
    throw new Error(`${label} must be an array with at most 20 answers.`);
  }

  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`${label}[${index}] must be an object.`);
    }
    return {
      question: requiredString(
        item.question,
        `${label}[${index}].question`,
        1_000,
      ),
      answer: requiredString(
        item.answer,
        `${label}[${index}].answer`,
        4_000,
      ),
    };
  });
}

function parseExpectation(
  value: unknown,
  label: string,
): ValidationExpectation | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }

  const expectation: ValidationExpectation = {
    understandingReadiness: oneOf(
      value.understandingReadiness,
      `${label}.understandingReadiness`,
      ["ready", "review", "needs_clarification"] as const,
    ),
    interactionAction: oneOf(
      value.interactionAction,
      `${label}.interactionAction`,
      ["continue", "review", "clarify"] as const,
    ),
    qualityStatus: oneOf(
      value.qualityStatus,
      `${label}.qualityStatus`,
      ["ready", "warning", "blocked"] as const,
    ),
    executionMode: optionalString(
      value.executionMode,
      `${label}.executionMode`,
      80,
    ),
    effectiveTaskArea: optionalString(
      value.effectiveTaskArea,
      `${label}.effectiveTaskArea`,
      80,
    ),
    selectedPaths: optionalStringArray(
      value.selectedPaths,
      `${label}.selectedPaths`,
    ),
    selectedPathsMode: oneOf(
      value.selectedPathsMode,
      `${label}.selectedPathsMode`,
      ["contains", "exact"] as const,
    ),
    excludedPaths: optionalStringArray(
      value.excludedPaths,
      `${label}.excludedPaths`,
    ),
    authorizedTargets: optionalStringArray(
      value.authorizedTargets,
      `${label}.authorizedTargets`,
    ),
    minQualityScore: optionalNumber(
      value.minQualityScore,
      `${label}.minQualityScore`,
      0,
      100,
    ),
    maxQualityScore: optionalNumber(
      value.maxQualityScore,
      `${label}.maxQualityScore`,
      0,
      100,
    ),
    maxWarnings: optionalNumber(
      value.maxWarnings,
      `${label}.maxWarnings`,
      0,
      1_000,
    ),
    maxDurationMs: optionalNumber(
      value.maxDurationMs,
      `${label}.maxDurationMs`,
      1,
      3_600_000,
    ),
  };

  if (expectation.selectedPathsMode && !expectation.selectedPaths) {
    throw new Error(`${label}.selectedPathsMode requires selectedPaths.`);
  }
  if (
    expectation.minQualityScore !== undefined &&
    expectation.maxQualityScore !== undefined &&
    expectation.minQualityScore > expectation.maxQualityScore
  ) {
    throw new Error(
      `${label}.minQualityScore must not exceed maxQualityScore.`,
    );
  }

  return expectation;
}

function parseDefaults(value: unknown): ValidationManifestDefaults {
  if (value === undefined) return {};
  if (!isRecord(value)) {
    throw new Error("defaults must be an object.");
  }

  return {
    taskType: optionalString(value.taskType, "defaults.taskType", 80),
    targetTool: optionalString(value.targetTool, "defaults.targetTool", 80),
    acceptReview: optionalBoolean(
      value.acceptReview,
      "defaults.acceptReview",
    ),
  };
}

function parseTestCase(value: unknown, index: number): ValidationTestCase {
  const label = `tests[${index}]`;
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return {
    id: requiredString(value.id, `${label}.id`, 80),
    title: optionalString(value.title, `${label}.title`, 240),
    task: requiredString(value.task, `${label}.task`, 6_000),
    taskType: optionalString(value.taskType, `${label}.taskType`, 80),
    targetTool: optionalString(value.targetTool, `${label}.targetTool`, 80),
    clarifications: parseClarifications(
      value.clarifications,
      `${label}.clarifications`,
    ),
    acceptReview: optionalBoolean(
      value.acceptReview,
      `${label}.acceptReview`,
    ),
    stopAfterUnderstanding: optionalBoolean(
      value.stopAfterUnderstanding,
      `${label}.stopAfterUnderstanding`,
    ),
    disabled: optionalBoolean(value.disabled, `${label}.disabled`),
    expect: parseExpectation(value.expect, `${label}.expect`),
  };
}

export function parseValidationManifest(text: string): ValidationManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`The manifest is not valid JSON: ${detail}`);
  }

  if (!isRecord(parsed)) {
    throw new Error("The manifest root must be an object.");
  }

  if (parsed.format !== VALIDATION_MANIFEST_FORMAT) {
    throw new Error(
      `format must be “${VALIDATION_MANIFEST_FORMAT}”.`,
    );
  }
  if (parsed.version !== VALIDATION_MANIFEST_VERSION) {
    throw new Error(
      `version must be ${VALIDATION_MANIFEST_VERSION}.`,
    );
  }
  if (!Array.isArray(parsed.tests) || parsed.tests.length === 0) {
    throw new Error("tests must contain at least one test case.");
  }
  if (parsed.tests.length > MAX_VALIDATION_CASES) {
    throw new Error(
      `A manifest may contain at most ${MAX_VALIDATION_CASES} test cases.`,
    );
  }

  const tests = parsed.tests.map(parseTestCase);
  const seenIds = new Set<string>();
  for (const test of tests) {
    const key = test.id.toLocaleLowerCase();
    if (seenIds.has(key)) {
      throw new Error(`Duplicate test id: ${test.id}.`);
    }
    seenIds.add(key);
  }

  return {
    format: VALIDATION_MANIFEST_FORMAT,
    version: VALIDATION_MANIFEST_VERSION,
    name: requiredString(parsed.name, "name", 240),
    description: optionalString(parsed.description, "description", 2_000),
    defaults: parseDefaults(parsed.defaults),
    tests,
  };
}

function normalizePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\.\//u, "").toLowerCase();
}

function sameStringSet(left: string[], right: string[]) {
  const leftSet = new Set(left.map(normalizePath));
  const rightSet = new Set(right.map(normalizePath));
  return (
    leftSet.size === rightSet.size &&
    [...leftSet].every((value) => rightSet.has(value))
  );
}

function makeCheck(
  key: string,
  passed: boolean,
  expected: unknown,
  actual: unknown,
  message: string,
): ValidationCheckResult {
  return { key, passed, expected, actual, message };
}

export function evaluateValidationExpectation(
  expect: ValidationExpectation | undefined,
  actual: ValidationActualSummary,
) {
  if (!expect || Object.values(expect).every((value) => value === undefined)) {
    return { status: "observed" as const, checks: [] };
  }

  const checks: ValidationCheckResult[] = [];
  const equalityFields = [
    [
      "understandingReadiness",
      expect.understandingReadiness,
      actual.understandingReadiness,
    ],
    ["interactionAction", expect.interactionAction, actual.interactionAction],
    ["qualityStatus", expect.qualityStatus, actual.qualityStatus],
    ["executionMode", expect.executionMode, actual.executionMode],
    ["effectiveTaskArea", expect.effectiveTaskArea, actual.effectiveTaskArea],
  ] as const;

  for (const [key, expectedValue, actualValue] of equalityFields) {
    if (expectedValue === undefined) continue;
    checks.push(
      makeCheck(
        key,
        expectedValue === actualValue,
        expectedValue,
        actualValue,
        `${key}: expected ${String(expectedValue)}, received ${String(actualValue)}.`,
      ),
    );
  }

  if (expect.selectedPaths !== undefined) {
    const mode = expect.selectedPathsMode ?? "contains";
    const actualSet = new Set(actual.selectedPaths.map(normalizePath));
    const passed =
      mode === "exact"
        ? sameStringSet(expect.selectedPaths, actual.selectedPaths)
        : expect.selectedPaths.every((value) =>
            actualSet.has(normalizePath(value)),
          );
    checks.push(
      makeCheck(
        "selectedPaths",
        passed,
        expect.selectedPaths,
        actual.selectedPaths,
        `Selected paths must ${mode === "exact" ? "exactly match" : "contain"} the expected paths.`,
      ),
    );
  }

  if (expect.excludedPaths !== undefined) {
    const actualSet = new Set(actual.selectedPaths.map(normalizePath));
    const unexpected = expect.excludedPaths.filter((value) =>
      actualSet.has(normalizePath(value)),
    );
    checks.push(
      makeCheck(
        "excludedPaths",
        unexpected.length === 0,
        expect.excludedPaths,
        unexpected,
        unexpected.length === 0
          ? "Excluded paths were not selected."
          : `Unexpectedly selected: ${unexpected.join(", ")}.`,
      ),
    );
  }

  if (expect.authorizedTargets !== undefined) {
    checks.push(
      makeCheck(
        "authorizedTargets",
        sameStringSet(expect.authorizedTargets, actual.authorizedTargets),
        expect.authorizedTargets,
        actual.authorizedTargets,
        "Authorized edit targets must match exactly.",
      ),
    );
  }

  if (expect.minQualityScore !== undefined) {
    const passed =
      actual.qualityScore !== null &&
      actual.qualityScore >= expect.minQualityScore;
    checks.push(
      makeCheck(
        "minQualityScore",
        passed,
        expect.minQualityScore,
        actual.qualityScore,
        `Quality score must be at least ${expect.minQualityScore}.`,
      ),
    );
  }

  if (expect.maxQualityScore !== undefined) {
    const passed =
      actual.qualityScore !== null &&
      actual.qualityScore <= expect.maxQualityScore;
    checks.push(
      makeCheck(
        "maxQualityScore",
        passed,
        expect.maxQualityScore,
        actual.qualityScore,
        `Quality score must be at most ${expect.maxQualityScore}.`,
      ),
    );
  }

  if (expect.maxWarnings !== undefined) {
    checks.push(
      makeCheck(
        "maxWarnings",
        actual.warnings.length <= expect.maxWarnings,
        expect.maxWarnings,
        actual.warnings.length,
        `Warning count must not exceed ${expect.maxWarnings}.`,
      ),
    );
  }

  if (expect.maxDurationMs !== undefined) {
    checks.push(
      makeCheck(
        "maxDurationMs",
        actual.durationMs <= expect.maxDurationMs,
        expect.maxDurationMs,
        actual.durationMs,
        `Case duration must not exceed ${expect.maxDurationMs} ms.`,
      ),
    );
  }

  return {
    status: checks.every((check) => check.passed)
      ? ("passed" as const)
      : ("failed" as const),
    checks,
  };
}

function getExecutionContract(preview: ContextComposerPreview | null) {
  if (!preview) return null;
  const diagnostics = preview.fileSelection.diagnostics as
    | {
        executionMode?: unknown;
        executionContract?: {
          mode?: unknown;
          authorizedTargets?: unknown;
          confirmedTargets?: unknown;
          authorization?: {
            authorizedTargets?: unknown;
          };
        };
      }
    | undefined;
  const contract = diagnostics?.executionContract;

  return {
    mode:
      typeof contract?.mode === "string"
        ? contract.mode
        : typeof diagnostics?.executionMode === "string"
          ? diagnostics.executionMode
          : null,
    authorizedTargets: Array.isArray(
      contract?.authorization?.authorizedTargets,
    )
      ? contract.authorization.authorizedTargets.filter(
          (value): value is string => typeof value === "string",
        )
      : Array.isArray(contract?.authorizedTargets)
        ? contract.authorizedTargets.filter(
            (value): value is string => typeof value === "string",
          )
        : Array.isArray(contract?.confirmedTargets)
          ? contract.confirmedTargets.filter(
          (value): value is string => typeof value === "string",
        )
          : [],
  };
}

export function buildValidationActualSummary(input: {
  understanding: TaskUnderstandingResponse;
  preview: ContextComposerPreview | null;
  durationMs: number;
}): ValidationActualSummary {
  const execution = getExecutionContract(input.preview);

  return {
    understandingReadiness: input.understanding.taskUnderstanding.readiness,
    interactionAction: input.understanding.interaction.action,
    qualityStatus: input.preview?.selectionQuality.status ?? null,
    qualityScore: input.preview?.selectionQuality.score ?? null,
    executionMode: execution?.mode ?? null,
    effectiveTaskArea: input.preview?.task.effectiveTaskArea ?? null,
    selectedPaths: input.preview?.selectedFiles.map((file) => file.path) ?? [],
    authorizedTargets: execution?.authorizedTargets ?? [],
    warnings: input.preview?.selectionQuality.warnings ?? [],
    blockingReasons: input.preview?.selectionQuality.blockingReasons ?? [],
    durationMs: input.durationMs,
  };
}

export function sanitizeValidationPreview(
  preview: ContextComposerPreview | null,
) {
  if (!preview) return null;
  return {
    ...preview,
    snippets: preview.snippets.map((snippet) => ({
      relativePath: snippet.relativePath,
      language: snippet.language,
      truncated: snippet.truncated,
      contentLength: snippet.content.length,
      contentIncluded: false,
    })),
  };
}

export function summarizeValidationResults(
  results: ValidationCaseResult[],
): ValidationRunResult["summary"] {
  return {
    total: results.length,
    passed: results.filter((result) => result.status === "passed").length,
    failed: results.filter((result) => result.status === "failed").length,
    observed: results.filter((result) => result.status === "observed").length,
    errors: results.filter((result) => result.status === "error").length,
    skipped: results.filter((result) => result.status === "skipped").length,
  };
}

export function createValidationManifestTemplate(): ValidationManifest {
  return {
    format: VALIDATION_MANIFEST_FORMAT,
    version: VALIDATION_MANIFEST_VERSION,
    name: "Project validation suite",
    description:
      "Sequential, read-only validation cases for one selected project.",
    defaults: {
      taskType: "general",
      targetTool: "codex",
      acceptReview: true,
    },
    tests: [
      {
        id: "CASE-01",
        title: "Replace with a real task and expectations",
        task: "Describe the coding task exactly as a user would enter it.",
        disabled: true,
        expect: {
          interactionAction: "continue",
          qualityStatus: "ready",
          selectedPaths: ["path/from/the/selected/project.ts"],
          selectedPathsMode: "contains",
          excludedPaths: ["path/that/must/not/be/selected.ts"],
        },
      },
    ],
  };
}
