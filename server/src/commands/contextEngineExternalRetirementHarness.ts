import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { applicationRoot, config, serverRoot } from "../config/index.js";
import { getGitStatus } from "../git/gitStatusService.js";
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
import { groundTaskCurrentState } from "../taskPacks/taskCurrentStateGrounding.js";
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
  createExternalObservationReport,
  validateExternalRetirementManifest,
  writeExternalObservationReport,
  type ExternalRetirementCaseManifest,
  type ExternalRetirementProjectManifest,
  type ExternalRetirementValidationManifest,
  type ExternalObservationCase,
  type ExternalObservationExecutionIdentity,
  type ExternalObservationFile,
  type ExternalObservationRepositoryIdentity,
  type ExternalObservationValidationReport,
} from "../contextEngineV2/validation/index.js";

const FIXED_SNAPSHOT_TIME = "2026-01-01T00:00:00.000Z";
const SHA256 = /^sha256:[a-f0-9]{64}$/u;

function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function normalizedDuration(started: number, finished: number): number {
  return Number.isFinite(started) && Number.isFinite(finished) && finished >= started
    ? finished - started
    : 0;
}

async function sourceFiles(root: string, excludedDirectories = new Set<string>()): Promise<string[]> {
  const result: string[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory() && !excludedDirectories.has(entry.name)) await visit(absolute);
      else if (entry.isFile() && /\.(?:ts|json)$/iu.test(entry.name)) result.push(absolute);
    }
  }
  await visit(root);
  return result;
}

async function fingerprintFiles(root: string, files: readonly string[]): Promise<string> {
  const digest = createHash("sha256");
  for (const file of [...files].sort((left, right) => left.localeCompare(right))) {
    digest.update(path.relative(root, file).replaceAll("\\", "/"), "utf8");
    digest.update("\0", "utf8");
    digest.update(await fs.readFile(file));
    digest.update("\0", "utf8");
  }
  return `sha256:${digest.digest("hex")}`;
}

async function fingerprintCe2Source(): Promise<string | null> {
  try {
    const root = path.join(serverRoot, "src", "contextEngineV2");
    return fingerprintFiles(root, await sourceFiles(root, new Set(["testing"])));
  } catch {
    return null;
  }
}

async function fingerprintObservationTooling(): Promise<string | null> {
  try {
    const files = [
      path.join(serverRoot, "src", "commands", "contextEngineExternalRetirementHarness.ts"),
      path.join(serverRoot, "src", "commands", "contextEngineExternalRetirementValidation.ts"),
      path.join(serverRoot, "src", "contextEngineV2", "validation", "externalObservationReport.ts"),
      path.join(serverRoot, "src", "contextEngineV2", "validation", "externalRetirementManifest.ts"),
      path.join(serverRoot, "src", "contextEngineV2", "validation", "externalRetirementReport.ts"),
    ];
    return fingerprintFiles(applicationRoot, files);
  } catch {
    return null;
  }
}

export interface ExternalObservationRunProvenance {
  gitCommit: string | null;
  workingTreeClean: boolean | null;
  ce2SourceFingerprint: string | null;
  observationToolingFingerprint: string | null;
}

async function contextForgeIdentity(): Promise<ExternalObservationRunProvenance> {
  const [git, ce2SourceFingerprint, observationToolingFingerprint] = await Promise.all([
    getGitStatus(applicationRoot),
    fingerprintCe2Source(),
    fingerprintObservationTooling(),
  ]);
  return {
    gitCommit: git.isGitRepo ? git.latestCommit?.hash ?? null : null,
    workingTreeClean: git.isGitRepo ? !git.dirty : null,
    ce2SourceFingerprint,
    observationToolingFingerprint,
  };
}

function decodeManifestBytes(bytes: Uint8Array): string {
  const utf8BomLength = bytes.byteLength >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(utf8BomLength));
  } catch {
    throw new Error("invalid_external_retirement_manifest");
  }
}

export function hashNormalizedExternalRetirementManifestBytes(bytes: Uint8Array): string {
  return sha256(decodeManifestBytes(bytes).replace(/\r\n?|\n/gu, "\n"));
}

function resultIdentity(execution: LegacyRetirementCaseExecution): string {
  const files = execution.effectiveFiles.map((file) => ({
    path: file.path.replaceAll("\\", "/").replace(/^\.\//u, ""),
    role: file.role,
    usage: file.usage,
  })).sort((left, right) => left.path.localeCompare(right.path) || left.role.localeCompare(right.role) || left.usage.localeCompare(right.usage));
  const proofs = execution.resolution.groundedProofs.map((proof) => ({
    path: proof.path.replaceAll("\\", "/").replace(/^\.\//u, ""),
    role: proof.role,
    proofKind: proof.proofKind,
  })).sort((left, right) => left.path.localeCompare(right.path) || left.role.localeCompare(right.role) || left.proofKind.localeCompare(right.proofKind));
  return sha256(JSON.stringify({
    status: execution.resolution.status,
    reasonCodes: [...execution.resolution.decision.reasonCodes].sort(),
    rollbackReason: execution.resolution.rollbackReason,
    files,
    proofs,
  }));
}

function observedFiles(files: readonly TaskPackPrimaryMappedFile[]): ExternalObservationFile[] {
  return files.map((file) => ({ path: file.path, role: file.role, usage: file.usage }));
}

export interface ExternalRetirementHarnessOptions {
  projectFilter?: readonly string[];
  caseFilter?: readonly string[];
  nowIso?: () => string;
  scanInventory?: (rootPath: string) => Promise<ProjectInventory>;
  runPrimary?: typeof runLiveTaskPackPrimary;
  monotonicMs?: () => number;
  observationMonotonicMs?: () => number;
  manifestContentHash?: string;
  resolveContextForgeIdentity?: () => Promise<ExternalObservationRunProvenance>;
}

function executionIdentity(decision: {
  taskFingerprint: string;
  clarificationFingerprint: string;
  inventoryFingerprint: string;
  snapshotFingerprint: string;
  configurationFingerprint: string;
}): ExternalObservationExecutionIdentity {
  return {
    taskFingerprint: decision.taskFingerprint,
    clarificationFingerprint: decision.clarificationFingerprint,
    inventoryFingerprint: decision.inventoryFingerprint,
    snapshotFingerprint: decision.snapshotFingerprint,
    configurationFingerprint: decision.configurationFingerprint,
  };
}

function executionBasisEquivalent(
  first: ExternalObservationExecutionIdentity,
  replay: ExternalObservationExecutionIdentity,
): boolean {
  return first.taskFingerprint === replay.taskFingerprint &&
    first.clarificationFingerprint === replay.clarificationFingerprint &&
    first.inventoryFingerprint === replay.inventoryFingerprint &&
    first.snapshotFingerprint === replay.snapshotFingerprint &&
    first.configurationFingerprint === replay.configurationFingerprint;
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
  const taskIntent = groundTaskCurrentState({
    rawTask: item.task,
    inventory,
    taskIntent: buildDeterministicTaskIntentFallback({
      rawTask: item.task,
      taskType: item.requestedTaskType,
      projectTree: inventory.files.map((file) => file.path),
    }),
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

interface InstrumentedCaseExecution {
  execution: LegacyRetirementCaseExecution;
  preparationMs: number;
  executionMs: number;
  authorization: {
    authorizedEditPaths: string[];
    referenceOnlyPaths: string[];
    projectedAuthorizationMatchesApplied: boolean | null;
    unauthorizedEditableTarget: boolean;
    unavailableReason: "downstream_contract_not_exposed" | null;
  };
}

async function executeCase(input: {
  project: ExternalRetirementProjectManifest;
  item: ExternalRetirementCaseManifest;
  inventory: ProjectInventory;
  runPrimary: typeof runLiveTaskPackPrimary;
  monotonicMs: () => number;
  observationMonotonicMs: () => number;
}): Promise<InstrumentedCaseExecution> {
  const derived = deriveExternalRetirementExecutionInput(input.item, input.inventory);
  const primaryStarted = input.monotonicMs();
  const primaryDeadline = primaryStarted + DEFAULT_TASK_PACK_PRIMARY_POLICY.timeoutMs;
  const basis = createContextEngineShadowExecutionBasis({
    policy: DEFAULT_TASK_PACK_PRIMARY_POLICY,
    requestedTaskType: input.item.requestedTaskType,
    effectiveTaskArea: derived.effectiveTaskArea,
    plannerMode: "deterministic",
  });
  const preparationStarted = input.observationMonotonicMs();
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
  const preparationMs = normalizedDuration(preparationStarted, input.observationMonotonicMs());
  let productionSelection: TaskFileSelection | null = null;
  const downstreamObservation: { selection: TaskFileSelection | null } = { selection: null };
  const executionStarted = input.observationMonotonicMs();
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
      downstreamObservation.selection = validated.productionSelection;
      if (validated.validation.passed) productionSelection = validated.productionSelection;
      return { validatedFiles: validated.validatedFiles, validation: validated.validation };
    },
  });
  const executionMs = normalizedDuration(executionStarted, input.observationMonotonicMs());
  const authority = applyTaskPackPrimaryProductionResolution({
    resolution,
    productionSelection,
    emptySelection: emptySelection(derived.effectiveTaskArea),
  });
  const effectiveFiles: TaskPackPrimaryMappedFile[] = authority.authority === "v2"
    ? structuredClone(resolution.adoptedFiles ?? [])
    : [];
  const observedProductionSelection = downstreamObservation.selection;
  const authorization = observedProductionSelection?.diagnostics?.executionContract?.authorization;
  const authorizedEditPaths = [...(authorization?.authorizedTargets ?? [])];
  const referenceOnlyPaths = observedProductionSelection?.selectedFiles
    .filter((file) => file.usage !== "inspect-and-edit" && file.usage !== "create-and-edit")
    .map((file) => file.path) ?? [];
  const authorizedKeys = new Set(authorizedEditPaths.map((value) => value.replaceAll("\\", "/").toLowerCase()));
  const appliedEditablePaths = effectiveFiles
    .filter((file) => file.usage === "inspect-and-edit" || file.usage === "create-and-edit")
    .map((file) => file.path);
  const projectedAuthorizationMatchesApplied = observedProductionSelection === null
    ? null
    : appliedEditablePaths.every((value) => authorizedKeys.has(value.replaceAll("\\", "/").toLowerCase()));
  return {
    execution: { canonical, resolution, effectiveFiles, legacyBaselinePaths: [] },
    preparationMs,
    executionMs,
    authorization: {
      authorizedEditPaths,
      referenceOnlyPaths,
      projectedAuthorizationMatchesApplied,
      unauthorizedEditableTarget: projectedAuthorizationMatchesApplied === false,
      unavailableReason: observedProductionSelection === null ? "downstream_contract_not_exposed" : null,
    },
  };
}

type ObservedExecution =
  | { kind: "completed"; value: InstrumentedCaseExecution }
  | { kind: "preparation_failure"; code: TaskPackCanaryPreparationErrorCode }
  | { kind: "execution_failure"; code: "execution_error" };

async function observeExecution(run: () => Promise<InstrumentedCaseExecution>): Promise<ObservedExecution> {
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
  totalCaseMs: number;
}): ExternalObservationCase {
  return {
    projectId: input.project.id, caseId: input.item.id, repositoryShape: input.item.repositoryShape,
    availability: "available", actualStatus: "engine_error", actualPaths: [],
    reasonCodes: [input.actual.code], rollbackReason: null, verdict: "ENGINE_ERROR",
    unsafeAutomaticAdoption: false, negativeConstraintViolation: false, restrictedEditableSelection: false,
    silentHybridSelection: false, modelPlannerUsed: false, deterministicReplayEquivalent: false,
    semanticAmbiguityHandledSafely: !input.item.expectations.ambiguityExpected,
    groundedRolesSupported: false,
    identity: null,
    selection: { projectedFiles: [], appliedFiles: [] },
    proofs: {
      counts: {
        direct_definition: 0,
        direct_document_identity: 0,
        direct_configuration_identity: 0,
        direct_source_identity: 0,
        exact_relationship_chain: 0,
      },
      appliedGroundedTargetCount: 0,
    },
    authorization: {
      authorizedEditPaths: [], referenceOnlyPaths: [],
      projectedAuthorizationMatchesApplied: null,
      unauthorizedEditableTarget: false,
      unavailableReason: "decision_not_produced",
    },
    contradictions: {
      count: null, unresolvedCount: null, blocked: false,
      unavailableReason: "decision_not_produced",
    },
    operations: {
      first: null, replay: null, searchOperations: null,
      uniqueFilesRead: null, uniqueFilesParsed: null,
      unavailableReason: "decision_not_produced",
    },
    timing: {
      firstPreparationMs: null, replayPreparationMs: null,
      firstExecutionMs: null, replayExecutionMs: null,
      firstDecision: null, replayDecision: null,
      totalCaseMs: input.totalCaseMs,
    },
    determinism: {
      scope: "same_process_same_snapshot",
      executionBasisEquivalent: false,
      resultEquivalent: false,
      equivalent: false,
      firstExecutionIdentity: null,
      replayExecutionIdentity: null,
      firstResultIdentity: null,
      replayResultIdentity: null,
    },
    fallback: {
      infrastructureRollback: false,
      semanticLegacyFallback: false,
      legacySelectorInvoked: false,
      legacySelectorUsedFallback: null,
    },
  };
}

function notRun(project: ExternalRetirementProjectManifest, item: ExternalRetirementCaseManifest): ExternalObservationCase {
  return {
    projectId: project.id, caseId: item.id, repositoryShape: item.repositoryShape,
    availability: "not_run", actualStatus: null, actualPaths: [], reasonCodes: [], rollbackReason: null, verdict: null,
    unsafeAutomaticAdoption: false, negativeConstraintViolation: false, restrictedEditableSelection: false,
    silentHybridSelection: false, modelPlannerUsed: false, deterministicReplayEquivalent: false,
    semanticAmbiguityHandledSafely: false, groundedRolesSupported: false,
    identity: null,
    selection: { projectedFiles: [], appliedFiles: [] },
    proofs: {
      counts: {
        direct_definition: 0,
        direct_document_identity: 0,
        direct_configuration_identity: 0,
        direct_source_identity: 0,
        exact_relationship_chain: 0,
      },
      appliedGroundedTargetCount: 0,
    },
    authorization: {
      authorizedEditPaths: [], referenceOnlyPaths: [], projectedAuthorizationMatchesApplied: null,
      unauthorizedEditableTarget: false, unavailableReason: "case_not_executed",
    },
    contradictions: { count: null, unresolvedCount: null, blocked: false, unavailableReason: "case_not_executed" },
    operations: {
      first: null, replay: null, searchOperations: null,
      uniqueFilesRead: null, uniqueFilesParsed: null, unavailableReason: "case_not_executed",
    },
    timing: {
      firstPreparationMs: null, replayPreparationMs: null,
      firstExecutionMs: null, replayExecutionMs: null,
      firstDecision: null, replayDecision: null, totalCaseMs: 0,
    },
    determinism: {
      scope: "same_process_same_snapshot",
      executionBasisEquivalent: false,
      resultEquivalent: false,
      equivalent: false,
      firstExecutionIdentity: null,
      replayExecutionIdentity: null,
      firstResultIdentity: null, replayResultIdentity: null,
    },
    fallback: {
      infrastructureRollback: false, semanticLegacyFallback: false,
      legacySelectorInvoked: false, legacySelectorUsedFallback: null,
    },
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
): Promise<ExternalObservationValidationReport> {
  const manifest: ExternalRetirementValidationManifest = validateExternalRetirementManifest(rawManifest);
  const observationClock = options.observationMonotonicMs ?? (() => performance.now());
  const runStarted = observationClock();
  const currentIdentity = await (options.resolveContextForgeIdentity ?? contextForgeIdentity)();
  const projectFilter = new Set(options.projectFilter ?? []);
  const caseFilter = new Set(options.caseFilter ?? []);
  const observations: ExternalObservationCase[] = [];
  const repositories: ExternalObservationRepositoryIdentity[] = [];
  const scanner = options.scanInventory ?? scanProjectInventory;
  for (const project of manifest.projects) {
    const selectedCases = project.cases.filter((item) =>
      (projectFilter.size === 0 || projectFilter.has(project.id)) &&
      (caseFilter.size === 0 || caseFilter.has(item.id)));
    if (selectedCases.length === 0) continue;
    if (!await projectAvailable(project.rootPath)) {
      observations.push(...selectedCases.map((item) => notRun(project, item)));
      repositories.push({
        projectId: project.id, gitHead: null, workingTreeClean: null,
        gitIdentityUnavailableReason: "git_metadata_unavailable",
        inventoryFingerprints: [], snapshotFingerprints: [], scanDurationMs: null,
      });
      continue;
    }
    const git = await getGitStatus(project.rootPath);
    let inventory: ProjectInventory;
    const scanStarted = observationClock();
    try {
      inventory = await scanner(project.rootPath);
    } catch {
      observations.push(...selectedCases.map((item) => notRun(project, item)));
      repositories.push({
        projectId: project.id,
        gitHead: git.isGitRepo ? git.latestCommit?.hash ?? null : null,
        workingTreeClean: git.isGitRepo ? !git.dirty : null,
        gitIdentityUnavailableReason: git.isGitRepo && git.latestCommit ? null : "git_metadata_unavailable",
        inventoryFingerprints: [], snapshotFingerprints: [],
        scanDurationMs: normalizedDuration(scanStarted, observationClock()),
      });
      continue;
    }
    const scanDurationMs = normalizedDuration(scanStarted, observationClock());
    for (const item of selectedCases) {
      const caseStarted = observationClock();
      const execute = () => executeCase({
        project, item, inventory,
        runPrimary: options.runPrimary ?? runLiveTaskPackPrimary,
        monotonicMs: options.monotonicMs ?? (() => performance.now()),
        observationMonotonicMs: observationClock,
      });
      const actual = await observeExecution(execute);
      const replay = await observeExecution(execute);
      const totalCaseMs = normalizedDuration(caseStarted, observationClock());
      if (actual.kind !== "completed") {
        observations.push(failedExecutionObservation({ project, item, actual, replay, totalCaseMs }));
        continue;
      }
      if (replay.kind !== "completed") {
        observations.push({
          ...failedExecutionObservation({
            project, item,
            actual: { kind: "execution_failure", code: "execution_error" },
            replay,
            totalCaseMs,
          }),
          deterministicReplayEquivalent: false,
        });
        continue;
      }
      const cached = [actual.value.execution, replay.value.execution];
      const result = await runLegacyRetirementCase({
        definition: definition(item),
        execute: async () => cached.shift()!,
      });
      const firstDecision = actual.value.execution.resolution.decision;
      const replayDecision = replay.value.execution.resolution.decision;
      const firstExecutionIdentity = executionIdentity(firstDecision);
      const replayExecutionIdentity = executionIdentity(replayDecision);
      const firstResultIdentity = resultIdentity(actual.value.execution);
      const replayResultIdentity = resultIdentity(replay.value.execution);
      const basisEquivalent = executionBasisEquivalent(firstExecutionIdentity, replayExecutionIdentity);
      const resultIdentitiesEquivalent = firstResultIdentity === replayResultIdentity;
      const resultEquivalent = resultIdentitiesEquivalent && result.deterministicReplayEquivalent;
      const deterministicReplayEquivalent = basisEquivalent && resultEquivalent;
      const proofCounts = {
        direct_definition: 0,
        direct_document_identity: 0,
        direct_configuration_identity: 0,
        direct_source_identity: 0,
        exact_relationship_chain: 0,
      };
      firstDecision.groundedProofs.forEach((proof) => { proofCounts[proof.proofKind] += 1; });
      const appliedEditable = actual.value.execution.effectiveFiles.filter((file) =>
        file.usage === "inspect-and-edit" || file.usage === "create-and-edit");
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
        deterministicReplayEquivalent,
        semanticAmbiguityHandledSafely: result.semanticAmbiguityHandledSafely,
        groundedRolesSupported: result.groundedRolesSupported,
        identity: firstExecutionIdentity,
        selection: {
          projectedFiles: observedFiles(firstDecision.selectedFiles),
          appliedFiles: observedFiles(actual.value.execution.effectiveFiles),
        },
        proofs: {
          counts: proofCounts,
          appliedGroundedTargetCount: appliedEditable.filter((file) => firstDecision.groundedProofs.some((proof) =>
            proof.path.toLowerCase() === file.path.toLowerCase() && proof.role === file.role)).length,
        },
        authorization: actual.value.authorization,
        contradictions: {
          count: null,
          unresolvedCount: null,
          blocked: firstDecision.reasonCodes.includes("blocking_contradiction"),
          unavailableReason: "downstream_contract_not_exposed",
        },
        operations: {
          first: firstDecision.metrics,
          replay: replayDecision.metrics,
          searchOperations: null,
          uniqueFilesRead: null,
          uniqueFilesParsed: null,
          unavailableReason: "downstream_contract_not_exposed",
        },
        timing: {
          firstPreparationMs: actual.value.preparationMs,
          replayPreparationMs: replay.value.preparationMs,
          firstExecutionMs: actual.value.executionMs,
          replayExecutionMs: replay.value.executionMs,
          firstDecision: firstDecision.timing,
          replayDecision: replayDecision.timing,
          totalCaseMs,
        },
        determinism: {
          scope: "same_process_same_snapshot",
          executionBasisEquivalent: basisEquivalent,
          resultEquivalent,
          equivalent: deterministicReplayEquivalent,
          firstExecutionIdentity,
          replayExecutionIdentity,
          firstResultIdentity,
          replayResultIdentity,
        },
        fallback: {
          infrastructureRollback: firstDecision.rollbackReason !== null,
          semanticLegacyFallback: result.actualStatus === "legacy_rollback" && firstDecision.rollbackReason === null,
          legacySelectorInvoked: false,
          legacySelectorUsedFallback: null,
        },
      });
    }
    const projectCases = observations.filter((item) => item.projectId === project.id);
    repositories.push({
      projectId: project.id,
      gitHead: git.isGitRepo ? git.latestCommit?.hash ?? null : null,
      workingTreeClean: git.isGitRepo ? !git.dirty : null,
      gitIdentityUnavailableReason: git.isGitRepo && git.latestCommit ? null : "git_metadata_unavailable",
      inventoryFingerprints: projectCases.flatMap((item) => [
        ...(item.determinism.firstExecutionIdentity ? [item.determinism.firstExecutionIdentity.inventoryFingerprint] : []),
        ...(item.determinism.replayExecutionIdentity ? [item.determinism.replayExecutionIdentity.inventoryFingerprint] : []),
      ]),
      snapshotFingerprints: projectCases.flatMap((item) => [
        ...(item.determinism.firstExecutionIdentity ? [item.determinism.firstExecutionIdentity.snapshotFingerprint] : []),
        ...(item.determinism.replayExecutionIdentity ? [item.determinism.replayExecutionIdentity.snapshotFingerprint] : []),
      ]),
      scanDurationMs,
    });
  }
  const manifestContentHash = options.manifestContentHash ?? sha256(JSON.stringify(manifest));
  if (!SHA256.test(manifestContentHash)) throw new Error("invalid_external_retirement_manifest_hash");
  return createExternalObservationReport({
    manifestId: manifest.manifestId,
    manifestContentHash,
    createdAt: (options.nowIso ?? (() => new Date().toISOString()))(),
    contextForgeVersion: config.appVersion,
    contextForgeGitCommit: currentIdentity.gitCommit,
    contextForgeWorkingTreeClean: currentIdentity.workingTreeClean,
    ce2SourceFingerprint: currentIdentity.ce2SourceFingerprint,
    observationToolingFingerprint: currentIdentity.observationToolingFingerprint,
    repositories,
    cases: observations,
    runTotalMs: normalizedDuration(runStarted, observationClock()),
    candidateFallbackRateThreshold: manifest.candidateFallbackRateThreshold,
  });
}

export async function runExternalRetirementValidationFile(input: {
  manifestPath: string;
  outputDirectory: string;
  projectFilter?: readonly string[];
  caseFilter?: readonly string[];
}): Promise<ExternalObservationValidationReport> {
  const metadata = await fs.stat(input.manifestPath);
  if (!metadata.isFile() || metadata.size > 2_000_000) throw new Error("invalid_external_retirement_manifest");
  const manifestBytes = await fs.readFile(input.manifestPath);
  if (manifestBytes.byteLength > 2_000_000) throw new Error("invalid_external_retirement_manifest");
  const raw = parseExternalRetirementManifestBytes(manifestBytes);
  const report = await runExternalRetirementValidation(raw, {
    ...input,
    manifestContentHash: hashNormalizedExternalRetirementManifestBytes(manifestBytes),
  });
  await writeExternalObservationReport(report, input.outputDirectory);
  return report;
}

export function parseExternalRetirementManifestBytes(bytes: Uint8Array): unknown {
  const json = decodeManifestBytes(bytes);
  try {
    return JSON.parse(json) as unknown;
  } catch {
    throw new Error("invalid_external_retirement_manifest");
  }
}
