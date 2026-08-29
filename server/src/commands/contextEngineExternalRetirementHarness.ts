import fs from "node:fs/promises";

import {
  buildDeterministicTaskIntentFallback,
  type TaskIntentAnalysis,
} from "../ollama/taskIntentAnalyzer.js";
import type { TaskFileSelection } from "../ollama/taskFileSelector.js";
import {
  applyTaskPackPrimaryProductionResolution,
  validateTaskPackPrimaryCandidate,
} from "../routes/taskPacks.js";
import { scanProjectInventory, type ProjectInventory } from "../scanner/projectInventoryScanner.js";
import {
  prepareBoundedTaskPackCanaryInput,
  TaskPackCanaryPreparationError,
  type TaskPackCanaryPreparationErrorCode,
} from "../contextEngineV2/canary/index.js";
import {
  DEFAULT_TASK_PACK_PRIMARY_POLICY,
  runLegacyRetirementCase,
  runLiveTaskPackPrimary,
  type LegacyRetirementCaseDefinition,
  type LegacyRetirementCaseExecution,
  type TaskPackPrimaryMappedFile,
} from "../contextEngineV2/retirement/index.js";
import {
  createContextEngineShadowExecutionBasis,
  prepareContextEngineShadowInput,
} from "../contextEngineV2/shadow/index.js";
import {
  createExternalRetirementReport,
  validateExternalRetirementManifest,
  writeExternalRetirementReport,
  type ExternalRetirementCaseManifest,
  type ExternalRetirementCaseObservation,
  type ExternalRetirementProjectManifest,
  type ExternalRetirementValidationManifest,
  type ExternalRetirementValidationReport,
} from "../contextEngineV2/validation/index.js";

const FIXED_SNAPSHOT_TIME = "2026-01-01T00:00:00.000Z";

export interface ExternalRetirementHarnessOptions {
  projectFilter?: readonly string[];
  caseFilter?: readonly string[];
  nowIso?: () => string;
  scanInventory?: (rootPath: string) => Promise<ProjectInventory>;
  runPrimary?: typeof runLiveTaskPackPrimary;
  monotonicMs?: () => number;
}

function emptySelection(area: TaskFileSelection["effectiveTaskArea"]): TaskFileSelection {
  return {
    selectedFiles: [], rejectedModelPaths: [], source: "deterministic", usedFallback: false,
    durationMs: 0, notes: [], effectiveTaskArea: area, assetMode: "none",
  };
}

function definition(item: ExternalRetirementCaseManifest): LegacyRetirementCaseDefinition {
  return {
    schemaVersion: 1,
    caseId: item.id,
    repositoryShape: item.repositoryShape,
    expectedOutcome: item.expectations.expectedOutcome,
    allowedStatuses: [...item.expectations.allowedStatuses],
    requiredPaths: [...item.expectations.requiredPaths],
    forbiddenPaths: [...item.expectations.forbiddenPaths],
    ambiguityExpected: item.expectations.ambiguityExpected,
    expectedRollbackReason: item.expectations.expectedRollbackReason,
  };
}

export interface ExternalRetirementDerivedExecutionInput {
  taskIntent: TaskIntentAnalysis;
  effectiveTaskArea: TaskIntentAnalysis["taskArea"];
  structuredTargets: TaskIntentAnalysis["structuredIntent"]["primaryTargets"];
  protectedScopes: string[];
}

export function deriveExternalRetirementExecutionInput(
  item: ExternalRetirementCaseManifest,
  inventory: ProjectInventory,
): ExternalRetirementDerivedExecutionInput {
  const taskIntent = buildDeterministicTaskIntentFallback({
    rawTask: item.task,
    taskType: item.requestedTaskType,
    projectTree: inventory.files.map((file) => file.path),
  });
  return {
    taskIntent,
    effectiveTaskArea: taskIntent.taskArea,
    structuredTargets: structuredClone(taskIntent.structuredIntent.primaryTargets),
    protectedScopes: structuredClone(taskIntent.structuredIntent.protectedScopes),
  };
}

function rollbackFromReasons(reasons: readonly string[]) {
  return (["capacity_exhausted", "execution_timeout", "execution_error"] as const)
    .find((reason) => reasons.includes(reason)) ?? null;
}

async function executeCase(input: {
  project: ExternalRetirementProjectManifest;
  item: ExternalRetirementCaseManifest;
  inventory: ProjectInventory;
  runPrimary: typeof runLiveTaskPackPrimary;
  monotonicMs: () => number;
}): Promise<LegacyRetirementCaseExecution> {
  const derived = deriveExternalRetirementExecutionInput(input.item, input.inventory);
  const primaryStarted = input.monotonicMs();
  const primaryDeadline = primaryStarted + DEFAULT_TASK_PACK_PRIMARY_POLICY.timeoutMs;
  const basis = createContextEngineShadowExecutionBasis({
    policy: DEFAULT_TASK_PACK_PRIMARY_POLICY,
    requestedTaskType: input.item.requestedTaskType,
    effectiveTaskArea: derived.effectiveTaskArea,
    plannerMode: "deterministic",
  });
  const canonical = prepareBoundedTaskPackCanaryInput({
    deadlineMonotonicMs: primaryDeadline,
    monotonicMs: input.monotonicMs,
    prepare: prepareContextEngineShadowInput,
    preparationInput: {
      projectId: input.project.id,
      projectRoot: input.project.rootPath,
      inventory: input.inventory,
      normalizedTask: input.item.task,
      clarificationBasis: [],
      structuredTargets: derived.structuredTargets,
      protectedScopes: derived.protectedScopes,
      executionBasis: basis,
      createdAt: FIXED_SNAPSHOT_TIME,
    },
  });
  let productionSelection: TaskFileSelection | null = null;
  const resolution = await input.runPrimary({
    canonical,
    requestStartedMonotonicMs: primaryStarted,
    requestDeadlineMonotonicMs: primaryDeadline,
    validateDownstream: (candidate, proofs) => {
      const validated = validateTaskPackPrimaryCandidate({
        rawTask: input.item.task,
        requestedTaskType: input.item.requestedTaskType,
        effectiveTaskArea: derived.effectiveTaskArea,
        inventory: input.inventory,
        taskIntent: derived.taskIntent,
        contextQualityMode: "balanced",
        candidate,
        proofs,
      });
      if (validated.validation.passed) productionSelection = validated.productionSelection;
      return { validatedFiles: validated.validatedFiles, validation: validated.validation };
    },
  });
  const authority = applyTaskPackPrimaryProductionResolution({
    resolution,
    productionSelection,
    emptySelection: emptySelection(derived.effectiveTaskArea),
  });
  const effectiveFiles: TaskPackPrimaryMappedFile[] = authority.authority === "v2"
    ? structuredClone(resolution.adoptedFiles ?? [])
    : [];
  return { canonical, resolution, effectiveFiles, legacyBaselinePaths: [] };
}

type ObservedExecution =
  | { kind: "completed"; value: LegacyRetirementCaseExecution }
  | { kind: "preparation_failure"; code: TaskPackCanaryPreparationErrorCode }
  | { kind: "execution_failure"; code: "execution_error" };

async function observeExecution(run: () => Promise<LegacyRetirementCaseExecution>): Promise<ObservedExecution> {
  try {
    return { kind: "completed", value: await run() };
  } catch (error) {
    return error instanceof TaskPackCanaryPreparationError
      ? { kind: "preparation_failure", code: error.code }
      : { kind: "execution_failure", code: "execution_error" };
  }
}

function failedExecutionObservation(input: {
  project: ExternalRetirementProjectManifest;
  item: ExternalRetirementCaseManifest;
  actual: Exclude<ObservedExecution, { kind: "completed" }>;
  replay: ObservedExecution;
}): ExternalRetirementCaseObservation {
  const replayEquivalent = input.actual.kind === "preparation_failure"
    ? input.replay.kind === "preparation_failure" && input.replay.code === input.actual.code
    : input.replay.kind === "execution_failure" && input.replay.code === input.actual.code;
  return {
    projectId: input.project.id, caseId: input.item.id, repositoryShape: input.item.repositoryShape,
    availability: "available", actualStatus: "engine_error", actualPaths: [],
    reasonCodes: [input.actual.code], rollbackReason: null, verdict: "ENGINE_ERROR",
    unsafeAutomaticAdoption: false, negativeConstraintViolation: false, restrictedEditableSelection: false,
    silentHybridSelection: false, modelPlannerUsed: false, deterministicReplayEquivalent: replayEquivalent,
    semanticAmbiguityHandledSafely: !input.item.expectations.ambiguityExpected,
    groundedRolesSupported: false,
  };
}

function notRun(project: ExternalRetirementProjectManifest, item: ExternalRetirementCaseManifest): ExternalRetirementCaseObservation {
  return {
    projectId: project.id, caseId: item.id, repositoryShape: item.repositoryShape,
    availability: "not_run", actualStatus: null, actualPaths: [], reasonCodes: [], rollbackReason: null, verdict: null,
    unsafeAutomaticAdoption: false, negativeConstraintViolation: false, restrictedEditableSelection: false,
    silentHybridSelection: false, modelPlannerUsed: false, deterministicReplayEquivalent: false,
    semanticAmbiguityHandledSafely: false, groundedRolesSupported: false,
  };
}

async function projectAvailable(rootPath: string): Promise<boolean> {
  try {
    return (await fs.stat(rootPath)).isDirectory();
  } catch {
    return false;
  }
}

export async function runExternalRetirementValidation(
  rawManifest: unknown,
  options: ExternalRetirementHarnessOptions = {},
): Promise<ExternalRetirementValidationReport> {
  const manifest: ExternalRetirementValidationManifest = validateExternalRetirementManifest(rawManifest);
  const projectFilter = new Set(options.projectFilter ?? []);
  const caseFilter = new Set(options.caseFilter ?? []);
  const observations: ExternalRetirementCaseObservation[] = [];
  const scanner = options.scanInventory ?? scanProjectInventory;
  for (const project of manifest.projects) {
    const selectedCases = project.cases.filter((item) =>
      (projectFilter.size === 0 || projectFilter.has(project.id)) &&
      (caseFilter.size === 0 || caseFilter.has(item.id)));
    if (selectedCases.length === 0) continue;
    if (!await projectAvailable(project.rootPath)) {
      observations.push(...selectedCases.map((item) => notRun(project, item)));
      continue;
    }
    let inventory: ProjectInventory;
    try {
      inventory = await scanner(project.rootPath);
    } catch {
      observations.push(...selectedCases.map((item) => notRun(project, item)));
      continue;
    }
    for (const item of selectedCases) {
      const execute = () => executeCase({
        project, item, inventory,
        runPrimary: options.runPrimary ?? runLiveTaskPackPrimary,
        monotonicMs: options.monotonicMs ?? (() => performance.now()),
      });
      const actual = await observeExecution(execute);
      const replay = await observeExecution(execute);
      if (actual.kind !== "completed") {
        observations.push(failedExecutionObservation({ project, item, actual, replay }));
        continue;
      }
      if (replay.kind !== "completed") {
        observations.push({
          ...failedExecutionObservation({
            project, item,
            actual: { kind: "execution_failure", code: "execution_error" },
            replay,
          }),
          deterministicReplayEquivalent: false,
        });
        continue;
      }
      const cached = [actual.value, replay.value];
      const result = await runLegacyRetirementCase({
        definition: definition(item),
        execute: async () => cached.shift()!,
      });
      observations.push({
        projectId: project.id,
        caseId: result.caseId,
        repositoryShape: result.repositoryShape,
        availability: "available",
        actualStatus: result.actualStatus,
        actualPaths: result.actualPaths,
        reasonCodes: result.reasonCodes,
        rollbackReason: result.actualStatus === "legacy_rollback" ? rollbackFromReasons(result.reasonCodes) : null,
        verdict: result.verdict,
        unsafeAutomaticAdoption: result.unsafeAutomaticAdoption,
        negativeConstraintViolation: result.negativeConstraintViolation,
        restrictedEditableSelection: result.restrictedEditableSelection,
        silentHybridSelection: result.silentHybridSelection,
        modelPlannerUsed: result.modelPlannerUsed,
        deterministicReplayEquivalent: result.deterministicReplayEquivalent,
        semanticAmbiguityHandledSafely: result.semanticAmbiguityHandledSafely,
        groundedRolesSupported: result.groundedRolesSupported,
      });
    }
  }
  return createExternalRetirementReport({
    manifestId: manifest.manifestId,
    createdAt: (options.nowIso ?? (() => new Date().toISOString()))(),
    cases: observations,
    candidateFallbackRateThreshold: manifest.candidateFallbackRateThreshold,
  });
}

export async function runExternalRetirementValidationFile(input: {
  manifestPath: string;
  outputDirectory: string;
  projectFilter?: readonly string[];
  caseFilter?: readonly string[];
}): Promise<ExternalRetirementValidationReport> {
  const metadata = await fs.stat(input.manifestPath);
  if (!metadata.isFile() || metadata.size > 2_000_000) throw new Error("invalid_external_retirement_manifest");
  const manifestBytes = await fs.readFile(input.manifestPath);
  if (manifestBytes.byteLength > 2_000_000) throw new Error("invalid_external_retirement_manifest");
  const raw = JSON.parse(manifestBytes.toString("utf8")) as unknown;
  const report = await runExternalRetirementValidation(raw, input);
  await writeExternalRetirementReport(report, input.outputDirectory);
  return report;
}
