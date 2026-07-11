import { createHash } from "node:crypto";
import path from "node:path";

import {
  selectTaskFiles,
  type SelectedTaskFile,
  type SelectedTaskFileUsage,
  type TaskFileSelection,
} from "../ollama/taskFileSelector.js";
import type { TaskIntentAnalysis } from "../ollama/taskIntentAnalyzer.js";
import type { ProjectInventory } from "../scanner/projectInventoryScanner.js";
import type { AppSettings } from "../settings/settingsService.js";
import { retrieveCandidates, type CandidateRetrievalResult } from "./candidateRetrieval.js";
import {
  deterministicCandidateRanking,
  type ValidatedCandidateRanking,
} from "./constrainedCandidateRanking.js";
import { isSecretLikePath } from "./safetyPolicy.js";

export type SelectorPipelineMode = "legacy" | "shadow_compare" | "shadow_primary";
export type EffectiveSelectorPipeline = "legacy" | "shadow";
export type SelectorExecutionStatus = "success" | "fallback";
export type SelectorQualityStatus = "ready" | "warning" | "blocked";
export type SelectorSelectionOrigin = "pipeline" | "manual_override";

export type SelectorFallbackReasonCode =
  | "shadow_exception"
  | "shadow_timeout"
  | "shadow_invalid_result"
  | "shadow_unknown_candidate"
  | "shadow_unknown_path"
  | "shadow_contract_violation";

export interface SelectorSelectionSummary {
  pipeline: EffectiveSelectorPipeline;
  selectedFiles: Array<{ path: string; usage: SelectedTaskFileUsage }>;
  primaryTarget: string | null;
  implementationArea: string;
  confidence: number;
  quality: number | null;
  blocked: boolean;
  manualReview: boolean;
  missingTarget: boolean;
  candidateCount: number;
}

export interface SelectorComparisonDiagnostics {
  primaryTargetAgreement: boolean;
  implementationAreaAgreement: boolean;
  selectedPathOverlap: number;
  editTargetOverlap: number;
  legacyOnlyPaths: string[];
  shadowOnlyPaths: string[];
  safetyDecisionAgreement: boolean;
  manualReviewAgreement: boolean;
}

export interface SelectorPipelineDiagnostics {
  id: string;
  timestamp: string;
  projectRef: string;
  taskHash: string;
  requestedMode: SelectorPipelineMode;
  effectivePipeline: EffectiveSelectorPipeline;
  status: "success" | "fallback" | "blocked" | "manual-review";
  executionStatus: SelectorExecutionStatus;
  qualityStatus: SelectorQualityStatus;
  selectionOrigin: SelectorSelectionOrigin;
  fallback: {
    code: SelectorFallbackReasonCode;
    message: string;
  } | null;
  shadowFailure: {
    code: SelectorFallbackReasonCode;
    message: string;
  } | null;
  timings: {
    totalMs: number;
    legacyMs: number | null;
    shadowMs: number | null;
  };
  actual: SelectorSelectionSummary;
  legacy: SelectorSelectionSummary | null;
  shadow: SelectorSelectionSummary | null;
  comparison: SelectorComparisonDiagnostics | null;
}

export interface ShadowPipelineResult {
  retrieval: CandidateRetrievalResult;
  ranking: ValidatedCandidateRanking;
}

export interface SelectorPipelineDependencies {
  runLegacy: typeof selectTaskFiles;
  runShadow: (input: SelectorPipelineInput) => Promise<ShadowPipelineResult>;
  now: () => Date;
  shadowTimeoutMs: number;
}

export interface SelectorPipelineInput {
  rawTask: string;
  taskType: string;
  targetTool: string;
  inventory: ProjectInventory;
  taskIntent?: TaskIntentAnalysis;
  settings: AppSettings;
  projectRef: string;
  mode?: SelectorPipelineMode;
}

export interface SelectorPipelineResult {
  selection: TaskFileSelection;
  diagnostics: SelectorPipelineDiagnostics;
}

const VALID_USAGES = new Set<SelectedTaskFileUsage>([
  "inspect-and-edit",
  "create-and-edit",
  "inspect-only",
  "asset-reference",
  "config-reference",
]);
const DEFAULT_SHADOW_TIMEOUT_MS = 5_000;
const MAX_SELECTED_FILES = 14;

class ShadowTechnicalError extends Error {
  constructor(
    readonly code: SelectorFallbackReasonCode,
    message: string,
  ) {
    super(message);
  }
}

function normalizeRelativePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

function isSafeRelativePath(value: string) {
  const normalized = normalizeRelativePath(value);
  if (!normalized) return false;
  if (/^[a-z]:/i.test(normalized) || path.posix.isAbsolute(normalized) || path.win32.isAbsolute(normalized)) return false;
  return !normalized.split("/").some((segment) => segment === "..");
}

function isEditableUsage(usage: SelectedTaskFileUsage) {
  return usage === "inspect-and-edit" || usage === "create-and-edit";
}

function getSelectionLimit(settings: AppSettings, implementationArea: string) {
  const limits = settings.composerFileLimits;
  const key = implementationArea as keyof typeof limits;
  const configured = key in limits ? limits[key] : limits.default;
  return Math.max(1, Math.min(MAX_SELECTED_FILES, configured));
}

function getSelectionFlags(selection: TaskFileSelection) {
  const source = selection.diagnostics?.selectionSource;
  return {
    blocked: source === "blocked",
    manualReview: source === "manual-review" || (selection.selectedFiles.length === 0 && source !== "blocked"),
  };
}

function getPrimaryTarget(files: SelectedTaskFile[]) {
  return files.find((file) => isEditableUsage(file.usage))?.path ?? files[0]?.path ?? null;
}

function selectionConfidence(selection: TaskFileSelection) {
  const explicit = selection.diagnostics?.finalConfidence;
  if (typeof explicit === "number" && Number.isFinite(explicit)) {
    return Math.max(0, Math.min(100, Math.round(explicit <= 1 ? explicit * 100 : explicit)));
  }
  if (selection.selectedFiles.length === 0) return 0;
  const average = selection.selectedFiles.reduce((sum, file) => sum + file.confidence, 0) / selection.selectedFiles.length;
  return Math.max(0, Math.min(100, Math.round(average * 100)));
}

function buildSummary(
  pipeline: EffectiveSelectorPipeline,
  selection: TaskFileSelection,
  candidateCount: number,
  missingTarget: boolean,
): SelectorSelectionSummary {
  const flags = getSelectionFlags(selection);
  return {
    pipeline,
    selectedFiles: selection.selectedFiles.map((file) => ({ path: normalizeRelativePath(file.path), usage: file.usage })),
    primaryTarget: getPrimaryTarget(selection.selectedFiles),
    implementationArea: selection.effectiveTaskArea,
    confidence: flags.blocked ? 0 : selectionConfidence(selection),
    quality: null,
    blocked: flags.blocked,
    manualReview: flags.manualReview,
    missingTarget,
    candidateCount,
  };
}

function jaccard(leftValues: string[], rightValues: string[]) {
  const left = new Set(leftValues);
  const right = new Set(rightValues);
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 1;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  return Number((intersection / union.size).toFixed(3));
}

function compareSummaries(
  legacy: SelectorSelectionSummary,
  shadow: SelectorSelectionSummary,
): SelectorComparisonDiagnostics {
  const legacyPaths = legacy.selectedFiles.map((file) => file.path);
  const shadowPaths = shadow.selectedFiles.map((file) => file.path);
  const legacyEdits = legacy.selectedFiles.filter((file) => isEditableUsage(file.usage)).map((file) => file.path);
  const shadowEdits = shadow.selectedFiles.filter((file) => isEditableUsage(file.usage)).map((file) => file.path);
  const shadowPathSet = new Set(shadowPaths);
  const legacyPathSet = new Set(legacyPaths);
  return {
    primaryTargetAgreement: legacy.primaryTarget === shadow.primaryTarget,
    implementationAreaAgreement: legacy.implementationArea === shadow.implementationArea,
    selectedPathOverlap: jaccard(legacyPaths, shadowPaths),
    editTargetOverlap: jaccard(legacyEdits, shadowEdits),
    legacyOnlyPaths: legacyPaths.filter((value) => !shadowPathSet.has(value)),
    shadowOnlyPaths: shadowPaths.filter((value) => !legacyPathSet.has(value)),
    safetyDecisionAgreement: legacy.blocked === shadow.blocked,
    manualReviewAgreement: legacy.manualReview === shadow.manualReview,
  };
}

async function defaultShadowPipeline(input: SelectorPipelineInput): Promise<ShadowPipelineResult> {
  const retrieval = retrieveCandidates({
    rawTask: input.rawTask,
    requestedTaskType: input.taskType,
    inventory: input.inventory,
    taskIntent: input.taskIntent,
  });
  return {
    retrieval,
    ranking: deterministicCandidateRanking(
      retrieval,
      getSelectionLimit(input.settings, retrieval.implementationArea),
    ),
  };
}

function shadowSelectionFromResult(
  result: ShadowPipelineResult,
  inventory: ProjectInventory,
  settings: AppSettings,
): TaskFileSelection {
  const { retrieval, ranking } = result;
  if (ranking.unknownCandidateIds.length > 0) {
    throw new ShadowTechnicalError("shadow_unknown_candidate", "Shadow returned unknown candidate IDs.");
  }
  if (!ranking.valid) {
    throw new ShadowTechnicalError("shadow_invalid_result", "Shadow ranking did not satisfy the candidate contract.");
  }

  const inventoryMap = new Map(inventory.files.map((file) => [normalizeRelativePath(file.path).toLowerCase(), file]));
  const candidateMap = new Map(retrieval.candidates.map((candidate) => [candidate.candidateId, candidate]));
  const seen = new Set<string>();
  const selectedFiles: SelectedTaskFile[] = [];
  const roleAdjustments: string[] = [];

  for (const selected of ranking.selected) {
    const candidate = candidateMap.get(selected.candidateId);
    if (!candidate) {
      throw new ShadowTechnicalError("shadow_unknown_candidate", `Unknown Shadow candidate ID: ${selected.candidateId}`);
    }
    const normalized = normalizeRelativePath(candidate.path);
    const submittedPath = normalizeRelativePath(selected.path);
    if (submittedPath.toLowerCase() !== normalized.toLowerCase()) {
      throw new ShadowTechnicalError(
        "shadow_contract_violation",
        "Shadow returned a candidate ID that does not match its selected path.",
      );
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    if (!isSafeRelativePath(normalized)) {
      throw new ShadowTechnicalError("shadow_contract_violation", "Shadow returned a path outside the project scope.");
    }
    const file = inventoryMap.get(key);
    if (!file) {
      throw new ShadowTechnicalError("shadow_unknown_path", `Shadow returned a path missing from inventory: ${normalized}`);
    }
    if (!VALID_USAGES.has(selected.usage)) {
      throw new ShadowTechnicalError("shadow_contract_violation", `Shadow returned an unsupported usage role for ${normalized}.`);
    }

    let usage = selected.usage;
    if (isEditableUsage(usage) && (file.isLikelyGenerated || isSecretLikePath(file.path))) {
      usage = file.kind === "config" ? "config-reference" : "inspect-only";
      roleAdjustments.push(`${file.path}: protected/generated path was reduced to ${usage}.`);
    }
    if (retrieval.reviewOnly && isEditableUsage(usage)) {
      usage = "inspect-only";
      roleAdjustments.push(`${file.path}: review-only task was reduced to inspect-only.`);
    }

    seen.add(key);
    selectedFiles.push({
      path: file.path,
      kind: file.kind,
      usage,
      reason: selected.reason,
      confidence: selected.confidence,
    });
  }

  if (retrieval.blocked || retrieval.manualReview) selectedFiles.length = 0;
  const selectionLimit = getSelectionLimit(settings, retrieval.implementationArea);
  if (selectedFiles.length > selectionLimit) selectedFiles.length = selectionLimit;

  const selectionSource = retrieval.blocked
    ? "blocked"
    : retrieval.manualReview || selectedFiles.length === 0
      ? "manual-review"
      : "shadow-deterministic";
  const finalConfidence = retrieval.blocked
    ? 0
    : retrieval.manualReview || selectedFiles.length === 0
      ? 25
      : Math.min(92, Math.round(selectedFiles.reduce((sum, file) => sum + file.confidence, 0) / selectedFiles.length * 100));

  return {
    selectedFiles,
    rejectedModelPaths: [],
    source: "shadow",
    usedFallback: false,
    durationMs: 0,
    notes: [...retrieval.warnings, ranking.reason],
    effectiveTaskArea: retrieval.implementationArea,
    assetMode: selectedFiles.some((file) => file.usage === "asset-reference") ? "mixed" : "none",
    diagnostics: {
      selectorVersion: "v0.6.4-shadow-rollout",
      safetyProfile: "shadow-validated",
      generationMode: settings.generationMode,
      model: null,
      requestedTaskType: retrieval.requestedTaskType,
      effectiveTaskArea: retrieval.implementationArea,
      usedFallback: false,
      selectionSource,
      inferredImplementationArea: retrieval.implementationArea,
      areaConflict: retrieval.implementationArea !== retrieval.requestedTaskType && retrieval.requestedTaskType !== "general",
      roleAdjustments,
      finalConfidence,
    },
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      timer = setTimeout(() => reject(new ShadowTechnicalError("shadow_timeout", `Shadow exceeded ${timeoutMs} ms.`)), timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export function sanitizeSelectorDiagnosticMessage(value: unknown) {
  const rawMessage = typeof value === "string"
    ? value
    : value instanceof Error
      ? value.message
      : "Unknown Shadow pipeline error.";
  return rawMessage
    .replace(/[a-z]:[\\/][^\r\n]*/gi, "[local-path]")
    .replace(/\\\\[^\r\n]*/g, "[local-path]")
    .replace(/\/(?:Users|home|var|tmp)\/[^\r\n]*/g, "[local-path]")
    .replace(/(?:api[-_ ]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .slice(0, 300);
}

function technicalError(error: unknown) {
  const code = error instanceof ShadowTechnicalError ? error.code : "shadow_exception";
  const safeMessage = sanitizeSelectorDiagnosticMessage(error);
  return new ShadowTechnicalError(
    code,
    safeMessage,
  );
}

function createDiagnosticBase(input: SelectorPipelineInput, requestedMode: SelectorPipelineMode, now: Date) {
  const taskHash = createHash("sha256").update(input.rawTask).digest("hex");
  const projectRef = createHash("sha256").update(input.projectRef).digest("hex").slice(0, 16);
  return {
    id: `${now.getTime()}-${taskHash.slice(0, 10)}`,
    timestamp: now.toISOString(),
    projectRef,
    taskHash,
    requestedMode,
  };
}

function normalizeMode(value: unknown): SelectorPipelineMode {
  return value === "shadow_compare" || value === "shadow_primary" ? value : "legacy";
}

export function normalizeSelectorPipelineMode(value: unknown): SelectorPipelineMode {
  return normalizeMode(value);
}

export function finalizeSelectorDiagnostics(
  diagnostics: SelectorPipelineDiagnostics,
  quality: { score: number; status: "ready" | "warning" | "blocked"; requiredManualReview: boolean; signals?: { confidence?: number } },
  selection?: TaskFileSelection,
  options: { manualSelectionApplied?: boolean } = {},
) {
  const confidence = quality.status === "blocked"
    ? 0
    : quality.requiredManualReview
      ? Math.min(45, quality.signals?.confidence ?? diagnostics.actual.confidence)
      : quality.signals?.confidence ?? diagnostics.actual.confidence;
  const executionStatus: SelectorExecutionStatus = diagnostics.fallback ? "fallback" : diagnostics.executionStatus;
  const status = executionStatus === "fallback"
    ? "fallback" as const
    : quality.status === "blocked"
      ? "blocked" as const
      : quality.requiredManualReview
        ? "manual-review" as const
        : "success" as const;
  return {
    ...diagnostics,
    status,
    executionStatus,
    qualityStatus: quality.status,
    selectionOrigin: options.manualSelectionApplied ? "manual_override" as const : diagnostics.selectionOrigin,
    actual: {
      ...diagnostics.actual,
      ...(selection
        ? {
            selectedFiles: selection.selectedFiles.map((file) => ({ path: normalizeRelativePath(file.path), usage: file.usage })),
            primaryTarget: getPrimaryTarget(selection.selectedFiles),
            implementationArea: selection.effectiveTaskArea,
          }
        : {}),
      confidence: Math.max(0, Math.min(100, Math.round(confidence))),
      quality: quality.score,
      blocked: quality.status === "blocked",
      manualReview: quality.requiredManualReview,
    },
  };
}

export async function runSelectorPipeline(
  input: SelectorPipelineInput,
  overrides: Partial<SelectorPipelineDependencies> = {},
): Promise<SelectorPipelineResult> {
  const dependencies: SelectorPipelineDependencies = {
    runLegacy: overrides.runLegacy ?? selectTaskFiles,
    runShadow: overrides.runShadow ?? defaultShadowPipeline,
    now: overrides.now ?? (() => new Date()),
    shadowTimeoutMs: overrides.shadowTimeoutMs ?? DEFAULT_SHADOW_TIMEOUT_MS,
  };
  const requestedMode = normalizeMode(input.mode ?? input.settings.selectorPipelineMode);
  const startedAt = performance.now();
  const base = createDiagnosticBase(input, requestedMode, dependencies.now());
  let legacyMs: number | null = null;
  let shadowMs: number | null = null;

  const runLegacy = async () => {
    const start = performance.now();
    const selection = await dependencies.runLegacy({
      rawTask: input.rawTask,
      taskType: input.taskType,
      targetTool: input.targetTool,
      inventory: input.inventory,
      taskIntent: input.taskIntent,
      settings: input.settings,
    });
    legacyMs = Math.round(performance.now() - start);
    return selection;
  };

  const runShadow = async () => {
    const start = performance.now();
    const raw = await withTimeout(dependencies.runShadow(input), dependencies.shadowTimeoutMs);
    const selection = shadowSelectionFromResult(raw, input.inventory, input.settings);
    shadowMs = Math.round(performance.now() - start);
    selection.durationMs = shadowMs;
    return { selection, raw };
  };

  if (requestedMode === "legacy") {
    const selection = await runLegacy();
    const summary = buildSummary("legacy", selection, selection.selectedFiles.length, false);
    return {
      selection,
      diagnostics: {
        ...base,
        effectivePipeline: "legacy",
        status: summary.blocked ? "blocked" : summary.manualReview ? "manual-review" : "success",
        executionStatus: "success",
        qualityStatus: summary.blocked ? "blocked" : summary.manualReview ? "warning" : "ready",
        selectionOrigin: "pipeline",
        fallback: null,
        shadowFailure: null,
        timings: { totalMs: Math.round(performance.now() - startedAt), legacyMs, shadowMs },
        actual: summary,
        legacy: summary,
        shadow: null,
        comparison: null,
      },
    };
  }

  if (requestedMode === "shadow_compare") {
    const [legacySettled, shadowSettled] = await Promise.allSettled([runLegacy(), runShadow()]);
    if (legacySettled.status === "rejected") throw legacySettled.reason;
    const legacySelection = legacySettled.value;
    const legacySummary = buildSummary("legacy", legacySelection, legacySelection.selectedFiles.length, false);
    let shadowSummary: SelectorSelectionSummary | null = null;
    let comparison: SelectorComparisonDiagnostics | null = null;
    let shadowFailure: SelectorPipelineDiagnostics["shadowFailure"] = null;
    if (shadowSettled.status === "fulfilled") {
      shadowSummary = buildSummary(
        "shadow",
        shadowSettled.value.selection,
        shadowSettled.value.raw.retrieval.candidates.length,
        shadowSettled.value.raw.retrieval.explicitMissingPaths.length > 0,
      );
      comparison = compareSummaries(legacySummary, shadowSummary);
    } else {
      const error = technicalError(shadowSettled.reason);
      shadowFailure = { code: error.code, message: error.message };
    }
    return {
      selection: legacySelection,
      diagnostics: {
        ...base,
        effectivePipeline: "legacy",
        status: legacySummary.blocked ? "blocked" : legacySummary.manualReview ? "manual-review" : "success",
        executionStatus: "success",
        qualityStatus: legacySummary.blocked ? "blocked" : legacySummary.manualReview ? "warning" : "ready",
        selectionOrigin: "pipeline",
        fallback: null,
        shadowFailure,
        timings: { totalMs: Math.round(performance.now() - startedAt), legacyMs, shadowMs },
        actual: legacySummary,
        legacy: legacySummary,
        shadow: shadowSummary,
        comparison,
      },
    };
  }

  try {
    const shadow = await runShadow();
    const shadowSummary = buildSummary(
      "shadow",
      shadow.selection,
      shadow.raw.retrieval.candidates.length,
      shadow.raw.retrieval.explicitMissingPaths.length > 0,
    );
    return {
      selection: shadow.selection,
      diagnostics: {
        ...base,
        effectivePipeline: "shadow",
        status: shadowSummary.blocked ? "blocked" : shadowSummary.manualReview ? "manual-review" : "success",
        executionStatus: "success",
        qualityStatus: shadowSummary.blocked ? "blocked" : shadowSummary.manualReview ? "warning" : "ready",
        selectionOrigin: "pipeline",
        fallback: null,
        shadowFailure: null,
        timings: { totalMs: Math.round(performance.now() - startedAt), legacyMs, shadowMs },
        actual: shadowSummary,
        legacy: null,
        shadow: shadowSummary,
        comparison: null,
      },
    };
  } catch (rawError) {
    const error = technicalError(rawError);
    const legacySelection = await runLegacy();
    const legacySummary = buildSummary("legacy", legacySelection, legacySelection.selectedFiles.length, false);
    return {
      selection: legacySelection,
      diagnostics: {
        ...base,
        effectivePipeline: "legacy",
        status: "fallback",
        executionStatus: "fallback",
        qualityStatus: legacySummary.blocked ? "blocked" : legacySummary.manualReview ? "warning" : "ready",
        selectionOrigin: "pipeline",
        fallback: { code: error.code, message: error.message },
        shadowFailure: null,
        timings: { totalMs: Math.round(performance.now() - startedAt), legacyMs, shadowMs },
        actual: legacySummary,
        legacy: legacySummary,
        shadow: null,
        comparison: null,
      },
    };
  }
}
