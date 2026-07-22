import { getAppSettings } from "../settings/settingsService.js";
import {
  runInvestigationTrace,
  type InvestigationTrace,
} from "../investigation/investigationTraceEngine.js";
import {
  beginPerformanceAiCall,
  finishPerformanceAiCall,
  measurePerformanceStage,
} from "../performance/performanceTrace.js";
import {
  extractClassifiedFileMentions,
  isExplicitFileCreationForbidden,
  resolveExplicitFileMentions,
} from "../selection/explicitFileMentions.js";
import { buildProjectSemanticGraph } from "../selection/projectSemanticGraph.js";
import {
  resolveRepositorySemanticEvidence,
  type FileSelectionEvidence,
} from "../selection/repositorySemanticIndex.js";
import { retainGraphSeeds } from "../selection/selectionConsistency.js";
import { reconcileFinalSelectionDecision } from "../selection/finalSelectionDecision.js";
import { rankCreateTargetReferenceFiles } from "../selection/createTargetReferenceRanking.js";
import { classifyTaskSelectionProfile } from "../selection/taskSelectionProfile.js";
import { extractSymbolRenameIntent } from "../selection/symbolRename.js";
import {
  detectHardTaskSafetyIssue,
  isSecretLikePath,
} from "../selection/safetyPolicy.js";
import type {
  ProjectInventory,
  ProjectInventoryFile,
  ProjectInventoryFileKind,
} from "../scanner/projectInventoryScanner.js";
import type {
  StructuredIntentTarget,
  TaskIntentAnalysis,
  TaskArea,
} from "./taskIntentAnalyzer.js";
import {
  applySelectionEvidenceGate,
  buildTaskExecutionContractFromIntent,
  type TaskEvidenceLevel,
  type TaskExecutionContract,
  type TaskExecutionLayer,
} from "../taskPacks/taskExecutionContract.js";

export type SelectedTaskFileUsage =
  | "inspect-and-edit"
  | "create-and-edit"
  | "inspect-only"
  | "asset-reference"
  | "config-reference";

export interface SelectedTaskFile {
  path: string;
  kind: ProjectInventoryFileKind;
  usage: SelectedTaskFileUsage;
  reason: string;
  confidence: number;
  evidenceLevel?: TaskEvidenceLevel;
  selectionEvidence?: FileSelectionEvidence;
}

export type EffectiveTaskArea = TaskArea;
export type AssetMode = "none" | "mixed" | "primary";
export type SelectorSelectionSource =
  | "ai"
  | "repaired-ai"
  | "retry-ai"
  | "fallback"
  | "blocked"
  | "manual-review"
  | "shadow-deterministic"
  | "final-decision"
  | "explicit-target-guard";
export type SelectorParseStage =
  | "not-run"
  | "direct-json"
  | "fenced-json"
  | "balanced-json"
  | "repair-json"
  | "retry-json"
  | "failed";

export interface TaskFileSelection {
  selectedFiles: SelectedTaskFile[];
  rejectedModelPaths: string[];
  source: "ollama" | "fallback" | "shadow" | "fast-path" | "deterministic";
  usedFallback: boolean;
  durationMs: number;
  notes: string[];
  effectiveTaskArea: EffectiveTaskArea;
  assetMode: AssetMode;
  conflictNote?: string;
  diagnostics?: {
    selectorVersion: string;
    safetyProfile: string;
    generationMode: "template" | "ollama";
    model: string | null;
    requestedTaskType: string;
    effectiveTaskArea: EffectiveTaskArea;
    usedFallback: boolean;
    selectionSource?: SelectorSelectionSource;
    inferredImplementationArea?: EffectiveTaskArea;
    areaConflict?: boolean;
    conflictReason?: string;
    roleAdjustments?: string[];
    semanticGraphEvidence?: string[];
    rawModelResponseLength?: number;
    parseStage?: SelectorParseStage;
    parseStages?: SelectorParseStage[];
    repairAttempted?: boolean;
    retryAttempted?: boolean;
    schemaValid?: boolean;
    schemaError?: string;
    modelConfidence?: number;
    finalConfidence?: number;
    explicitTargetStatus?: "matched" | "unresolved" | "not-applicable";
    explicitTargetPath?: string;
    explicitTargetLabels?: string[];
    promptInventoryTotalFiles?: number;
    promptCandidateCount?: number;
    promptShortlistApplied?: boolean;
    initialPromptChars?: number;
    retryPromptChars?: number;
    executionMode?: TaskExecutionContract["mode"];
    requiredLayers?: TaskExecutionLayer[];
    missingRequiredLayers?: TaskExecutionLayer[];
    candidateLayerCoverage?: TaskExecutionLayer[];
    confirmedLayerCoverage?: TaskExecutionLayer[];
    missingConfirmedLayers?: TaskExecutionLayer[];
    implementationGateReasons?: string[];
    existingImplementationCandidates?: string[];
    existingImplementationRequiresReview?: boolean;
    evidenceSummary?: Record<TaskEvidenceLevel, number>;
    ownershipEvidenceChains?: FileSelectionEvidence["chain"][];
    semanticIndexBuildMs?: number;
    semanticIndexQueryMs?: number;
    semanticIndexReused?: boolean;
    investigationTrace?: InvestigationTrace;
    executionContract?: TaskExecutionContract;
    taskProfile?: string;
    omittedGraphSeeds?: Array<{ path: string; reason: string }>;
  };
}

function createModelOnlySelectionEvidence(
  file: ProjectInventoryFile,
): FileSelectionEvidence {
  return {
    targetSource: "model_inference",
    pathValidity: "inventory_exact",
    ownershipEvidence: "model_only",
    actionConfidence: "inspect_only",
    semanticRoles: ["reference"],
    symbols: [],
    chain: [],
    negativeConstraintConflicts: [],
    reason:
      "Model selected an existing inventory path; ownership still requires repository evidence.",
  };
}

function createRankingOnlySelectionEvidence(
  file: SelectedTaskFile,
): FileSelectionEvidence {
  return {
    targetSource: "ranking",
    pathValidity: "inventory_exact",
    ownershipEvidence: "rank_only",
    actionConfidence: "inspect_only",
    semanticRoles: ["reference"],
    symbols: [],
    chain: [],
    negativeConstraintConflicts: [],
    reason:
      "Deterministic ranking suggested this real inventory path; ownership still requires repository evidence.",
  };
}

function mergeSelectionEvidence(
  fileEvidence: FileSelectionEvidence | undefined,
  repositoryEvidence: FileSelectionEvidence | undefined,
) {
  if (!fileEvidence) return repositoryEvidence;
  if (!repositoryEvidence) return fileEvidence;

  // Selection-local evidence may contain a proof that is stronger than the
  // generic repository lookup (for example, a complete no-reference proof for
  // a conditional single-file removal). Never replace that proof with a
  // rank-only repository candidate merely because both records exist.
  if (
    evidenceStrengthRank(fileEvidence) >=
    evidenceStrengthRank(repositoryEvidence)
  ) {
    return fileEvidence;
  }
  return {
    ...repositoryEvidence,
    targetSource: fileEvidence.targetSource,
  };
}

function getFallbackSelectionEvidence(
  file: SelectedTaskFile,
  repositoryEvidence: FileSelectionEvidence | undefined,
) {
  if (file.selectionEvidence || repositoryEvidence) {
    return mergeSelectionEvidence(file.selectionEvidence, repositoryEvidence);
  }
  if (isFallbackRankedReason(file.reason))
    return createRankingOnlySelectionEvidence(file);
  return undefined;
}

export interface SelectTaskFilesInput {
  rawTask: string;
  taskType: string;
  targetTool: string;
  inventory: ProjectInventory;
  taskIntent?: TaskIntentAnalysis;
  settings?: Awaited<ReturnType<typeof getAppSettings>>;
}

interface OllamaGenerateResponse {
  response?: string;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

interface TokenContext {
  strongTokens: string[];
  broadTokens: string[];
  explicitExistingPaths: string[];
  explicitMissingPaths: string[];
  routeMentions: string[];
}

const MAX_SELECTED_FILES = 14;
const MIN_MODEL_SELECTED_FILES = 3;
const MAX_SELECTOR_PROMPT_CANDIDATES = 24;
const MAX_SELECTOR_PROMPT_INVENTORY_CHARS = 6_500;
const SELECTOR_ENGINE_VERSION = "2026-07-21.explicit-reference-protection-v1";
const SELECTOR_SAFETY_PROFILE = "canonical-core-decision-v1";

const taskConstraintsCache = new WeakMap<object, TaskConstraints>();
const tokenContextCache = new WeakMap<object, TokenContext>();
const fileSearchTextCache = new WeakMap<ProjectInventoryFile, string>();
const fallbackScoreCache = new WeakMap<object, Map<string, number>>();
const pageSemanticScoreCache = new WeakMap<object, Map<string, number>>();
const executionContractCache = new WeakMap<
  object,
  TaskExecutionContract | null
>();

const VALID_USAGES: SelectedTaskFileUsage[] = [
  "inspect-and-edit",
  "create-and-edit",
  "inspect-only",
  "asset-reference",
  "config-reference",
];

const WEAK_TASK_TOKENS = new Set([
  "сделай",
  "улучши",
  "улучшенный",
  "измени",
  "добавь",
  "исправь",
  "переделай",
  "нужно",
  "надо",
  "мне",
  "чтобы",
  "если",
  "нет",
  "это",
  "там",
  "как",
  "для",
  "при",
  "после",
  "перед",
  "текущую",
  "полностью",
  "with",
  "make",
  "change",
  "improve",
  "better",
  "add",
  "fix",
  "update",
  "current",
  "existing",
]);

const BROAD_PATH_TOKENS = new Set([
  "src",
  "app",
  "apps",
  "client",
  "server",
  "source",
  "file",
  "files",
  "component",
  "components",
  "page",
  "pages",
  "layout",
  "layouts",
  "style",
  "styles",
  "index",
  "main",
  "ui",
  "view",
  "views",
  "screen",
  "screens",
  "common",
  "shared",
  "utils",
  "lib",
  "libs",
  "data",
  "types",
]);

function getDurationMs(startedAt: number) {
  return Date.now() - startedAt;
}

function normalizePath(value: string) {
  return value.replace(/\\/g, "/").trim();
}

function normalizeForCompare(value: string) {
  return normalizePath(value).toLowerCase();
}

function basenameForCompare(value: string) {
  return normalizeForCompare(value).split("/").filter(Boolean).pop() ?? "";
}

function includesAny(value: string, terms: string[]) {
  const normalized = normalizeForCompare(value);

  return terms.some((term) => normalized.includes(normalizeForCompare(term)));
}

function getRoutingNormalizationText(value: string) {
  const text = normalizeForCompare(value);
  const tokens = new Set<string>();
  const addWhen = (patterns: string[], normalizedTokens: string[]) => {
    if (
      patterns.some((pattern) => text.includes(normalizeForCompare(pattern)))
    ) {
      normalizedTokens.forEach((token) => tokens.add(token));
    }
  };

  addWhen(
    [
      "\u0438\u043d\u0442\u0435\u0440\u0444\u0435\u0439\u0441",
      "\u0441\u0442\u0440\u0430\u043d\u0438\u0446",
      "\u043a\u043e\u043c\u043f\u043e\u043d\u0435\u043d\u0442",
      "\u0444\u043e\u0440\u043c",
      "\u043a\u043d\u043e\u043f",
      "\u043c\u043e\u0434\u0430\u043b",
      "\u043a\u0430\u0440\u0442\u043e\u0447",
      "\u0432\u0435\u0440\u0441\u0442",
      "\u0434\u0438\u0437\u0430\u0439\u043d",
      "\u0444\u0440\u043e\u043d\u0442",
      "ui/ux",
    ],
    ["ui", "frontend", "page", "component", "layout", "style"],
  );
  addWhen(
    [
      "\u0431\u044d\u043a",
      "\u0431\u0435\u043a\u0435\u043d\u0434",
      "\u0441\u0435\u0440\u0432\u0435\u0440",
      "\u0440\u043e\u0443\u0442",
      "\u044d\u043d\u0434\u043f\u043e\u0438\u043d\u0442",
      "\u0431\u0430\u0437\u0430",
      "\u0431\u0434",
      "\u0441\u0445\u0435\u043c",
      "storage",
      "repository",
      "service",
    ],
    [
      "backend",
      "server",
      "api",
      "route",
      "endpoint",
      "storage",
      "database",
      "schema",
      "service",
    ],
  );
  addWhen(
    [
      "\u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442",
      "\u043e\u043f\u0438\u0441\u0430\u043d",
      "\u0438\u043d\u0441\u0442\u0440\u0443\u043a",
      "\u0443\u0441\u0442\u0430\u043d\u043e\u0432\u043a",
      "readme",
      "setup",
    ],
    ["docs", "documentation", "readme", "setup", "guide"],
  );
  addWhen(
    [
      "\u0442\u0435\u0441\u0442",
      "\u043f\u043e\u043a\u0440\u044b\u0442",
      "unit",
      "smoke",
      "replay",
      "regression",
    ],
    ["tests", "test", "smoke", "replay", "regression", "coverage"],
  );
  addWhen(
    [
      "\u043f\u043e\u0441\u043c\u043e\u0442\u0440",
      "\u043f\u0440\u043e\u0432\u0435\u0440",
      "\u043f\u0440\u0435\u0434\u043b\u043e\u0436",
      "\u0438\u0434\u0435\u0438",
      "\u043e\u0446\u0435\u043d",
      "\u043d\u0435 \u043c\u0435\u043d\u044f\u0439 \u043a\u043e\u0434",
      "\u0431\u0435\u0437 \u043f\u0440\u0430\u0432\u043e\u043a",
      "\u0442\u043e\u043b\u044c\u043a\u043e review",
      "\u0442\u043e\u043b\u044c\u043a\u043e \u0430\u043d\u0430\u043b\u0438\u0437",
    ],
    ["review", "audit", "suggest", "proposal", "inspect-only", "no-edit"],
  );
  addWhen(
    [
      "\u044f\u0434\u0440\u043e",
      "\u0441\u0435\u043b\u0435\u043a\u0442\u043e\u0440",
      "\u0441\u043a\u0430\u043d\u0435\u0440",
      "\u043a\u043e\u043d\u0442\u0435\u043a\u0441\u0442",
      "scanner",
      "context composer",
      "fallback",
      "scoring",
      "confidence",
      "safety",
      "prompt generation",
      "task pack builder",
    ],
    [
      "core",
      "selector",
      "scanner",
      "context composer",
      "fallback",
      "scoring",
      "safety",
      "task pack",
    ],
  );

  return [...tokens].join(" ");
}

function matchesAny(value: string, patterns: RegExp[]) {
  const normalized = normalizeForCompare(value);
  return patterns.some((pattern) => pattern.test(normalized));
}

function hasRuntimeNoBackendConstraint(rawTask: string) {
  return matchesAny(rawTask, [
    /\b(?:backend|api|server|auth|authorization|authentication|session|token|cookie|database|db|endpoint|route)\b[^.!?\n]{0,120}\b(?:do\s+not|don't|dont)\s+(?:touch|change|edit|modify|create|add|introduce|register)\b/i,
    /\b(?:no|without)\s+(?:new|separate|additional)\s+(?:backend|api|server|endpoint|route)\b/i,
    /без\s+(?:нов\p{L}*|отдельн\p{L}*|дополнительн\p{L}*)\s+(?:бэк\p{L}*|бек\p{L}*|backend|api|апи|сервер\p{L}*|эндпоинт\p{L}*|маршрут\p{L}*)/iu,
    /\b(?:backend|api|server|endpoint|route)\b[^.!?\n]{0,100}\b(?:create|add|introduce|register)(?:ing)?\s+(?:is\s+)?not\s+(?:needed|required)\b/i,
    /(?:бэк\p{L}*|бек\p{L}*|backend|api|апи|сервер\p{L}*|эндпоинт\p{L}*|маршрут\p{L}*)[^.!?\n]{0,100}(?:создавать|добавлять|регистрировать)\s+не\s+(?:нужно|требуется)/iu,
    /\b(?:do\s+not|don't|dont)\s+(?:touch|change|edit|modify|create|add|introduce|register)\b[^.!?\n]{0,120}\b(?:backend|api|server|auth|authorization|authentication|session|token|cookie|database|db|endpoint|route)\b/i,
    /\bapi\b[^.!?\n]{0,120}\u043d\u0435\s+(?:\u043c\u0435\u043d\u044f\u0442\u044c|\u043c\u0435\u043d\u044f\u0439|\u0442\u0440\u043e\u0433\u0430\u0442\u044c|\u0442\u0440\u043e\u0433\u0430\u0439|\u0440\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u0442\u044c|\u0440\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u0443\u0439|\u0438\u0437\u043c\u0435\u043d\u044f\u0442\u044c|\u0438\u0437\u043c\u0435\u043d\u044f\u0439)/i,
    /(?:\u0430\u043f\u0438|\u0437\u0430\u043f\u0440\u043e\u0441[a-z\u0430-\u044f\u04510-9_-]*|\u0437\u0430\u0433\u0440\u0443\u0437[a-z\u0430-\u044f\u04510-9_-]*)[^.!?\n]{0,120}\u043d\u0435\s+(?:\u043c\u0435\u043d\u044f\u0442\u044c|\u043c\u0435\u043d\u044f\u0439|\u0442\u0440\u043e\u0433\u0430\u0442\u044c|\u0442\u0440\u043e\u0433\u0430\u0439|\u0440\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u0442\u044c|\u0440\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u0443\u0439|\u0438\u0437\u043c\u0435\u043d\u044f\u0442\u044c|\u0438\u0437\u043c\u0435\u043d\u044f\u0439)/i,
    /(?:\u0431\u044d\u043a|\u0431\u0435\u043a|\u0431\u044d\u043a\u0435\u043d\u0434|\u0431\u0435\u043a\u0435\u043d\u0434|\u0430\u043f\u0438|api|\u0441\u0435\u0440\u0432\u0435\u0440|\u044d\u043d\u0434\u043f\u043e\u0438\u043d\u0442|\u043c\u0430\u0440\u0448\u0440\u0443\u0442|\u0430\u0432\u0442\u043e\u0440\u0438\u0437\u0430\u0446|\u0430\u0443\u0442\u0435\u043d\u0442\u0438\u0444|\u0441\u0435\u0441\u0441|\u0442\u043e\u043a\u0435\u043d|\u043a\u0443\u043a\u0438|\u0431\u0430\u0437\u0430|\u0431\u0434)[^.!?\n]{0,120}\u043d\u0435\s+(?:\u0442\u0440\u043e\u0433\u0430\u0439|\u0442\u0440\u043e\u0433\u0430\u0442\u044c|\u043c\u0435\u043d\u044f\u0439|\u043c\u0435\u043d\u044f\u0442\u044c|\u0440\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u0443\u0439|\u0440\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u0442\u044c|\u0438\u0437\u043c\u0435\u043d\u044f\u0439|\u0438\u0437\u043c\u0435\u043d\u044f\u0442\u044c|\u0441\u043e\u0437\u0434\u0430\u0432\u0430\u0439|\u0441\u043e\u0437\u0434\u0430\u0432\u0430\u0442\u044c|\u0434\u043e\u0431\u0430\u0432\u043b\u044f\u0439|\u0434\u043e\u0431\u0430\u0432\u043b\u044f\u0442\u044c|\u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0438\u0440\u0443\u0439|\u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0438\u0440\u043e\u0432\u0430\u0442\u044c)/i,
    /\u043d\u0435\s+(?:\u0442\u0440\u043e\u0433\u0430\u0439|\u0442\u0440\u043e\u0433\u0430\u0442\u044c|\u043c\u0435\u043d\u044f\u0439|\u043c\u0435\u043d\u044f\u0442\u044c|\u0440\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u0443\u0439|\u0440\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u0442\u044c|\u0438\u0437\u043c\u0435\u043d\u044f\u0439|\u0438\u0437\u043c\u0435\u043d\u044f\u0442\u044c|\u0441\u043e\u0437\u0434\u0430\u0432\u0430\u0439|\u0441\u043e\u0437\u0434\u0430\u0432\u0430\u0442\u044c|\u0434\u043e\u0431\u0430\u0432\u043b\u044f\u0439|\u0434\u043e\u0431\u0430\u0432\u043b\u044f\u0442\u044c|\u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0438\u0440\u0443\u0439|\u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0438\u0440\u043e\u0432\u0430\u0442\u044c)[^.!?\n]{0,120}(?:\u0431\u044d\u043a|\u0431\u0435\u043a|\u0431\u044d\u043a\u0435\u043d\u0434|\u0431\u0435\u043a\u0435\u043d\u0434|\u0430\u043f\u0438|api|\u0441\u0435\u0440\u0432\u0435\u0440|\u044d\u043d\u0434\u043f\u043e\u0438\u043d\u0442|\u043c\u0430\u0440\u0448\u0440\u0443\u0442|\u0430\u0432\u0442\u043e\u0440\u0438\u0437\u0430\u0446|\u0430\u0443\u0442\u0435\u043d\u0442\u0438\u0444|\u0441\u0435\u0441\u0441|\u0442\u043e\u043a\u0435\u043d|\u043a\u0443\u043a\u0438|\u0431\u0430\u0437\u0430|\u0431\u0434)/i,
  ]);
}

function hasProtectedBackendScopeConstraint(rawTask: string) {
  const backendScope = String.raw`(?:\b(?:backend|back[-\s]?end|api|server|endpoint|route|request|requests|fetch|upload|uploads|loading|load|http|axios|database|db)\b|(?:\u0431\u044d\u043a|\u0431\u0435\u043a|\u0431\u044d\u043a\u0435\u043d\u0434|\u0431\u0435\u043a\u0435\u043d\u0434|\u0430\u043f\u0438|api|\u0441\u0435\u0440\u0432\u0435\u0440|\u044d\u043d\u0434\u043f\u043e\u0438\u043d\u0442|\u043c\u0430\u0440\u0448\u0440\u0443\u0442|\u0437\u0430\u043f\u0440\u043e\u0441|\u0444\u0435\u0442\u0447|\u0437\u0430\u0433\u0440\u0443\u0437|\u0431\u0430\u0437\u0430|\u0431\u0434))`;
  const negativeVerb = String.raw`(?:\b(?:do\s+not|don't|dont)\s+(?:touch|change|edit|modify|rewrite|create|add|introduce|register)\b|\b(?:should|must)\s+not\s+(?:touch|change|edit|modify|rewrite|create|add|introduce|register)\b|\b(?:keep|leave)\b[^.!?\n]{0,32}\b(?:unchanged|alone)\b|\b(?:must|should)\b[^.!?\n]{0,32}\b(?:stay|remain)\b[^.!?\n]{0,16}\b(?:unchanged|intact)\b|\u043d\u0435\s+(?:\u0442\u0440\u043e\u0433\u0430\u0439|\u0442\u0440\u043e\u0433\u0430\u0442\u044c|\u043c\u0435\u043d\u044f\u0439|\u043c\u0435\u043d\u044f\u0442\u044c|\u0440\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u0443\u0439|\u0440\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u0442\u044c|\u043f\u0435\u0440\u0435\u043f\u0438\u0441\u044b\u0432\u0430\u0439|\u043f\u0435\u0440\u0435\u043f\u0438\u0441\u044b\u0432\u0430\u0442\u044c|\u0441\u043e\u0437\u0434\u0430\u0432\u0430\u0439|\u0441\u043e\u0437\u0434\u0430\u0432\u0430\u0442\u044c|\u0434\u043e\u0431\u0430\u0432\u043b\u044f\u0439|\u0434\u043e\u0431\u0430\u0432\u043b\u044f\u0442\u044c)|\u0431\u0435\u0437\s+\u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u0439)`;

  return [
    new RegExp(`${backendScope}[^.!?\\n]{0,140}${negativeVerb}`, "i"),
    new RegExp(`${negativeVerb}[^.!?\\n]{0,140}${backendScope}`, "i"),
  ].some((pattern) => pattern.test(rawTask));
}

function hasDirectProtectedBackendText(rawTask: string) {
  const normalized = normalizePath(rawTask)
    .toLowerCase()
    .replace(/[_./\\-]+/g, " ");
  const backendSurface =
    /(?:\b(?:api|backend|back\s*end|server|endpoint|route|request|requests|fetch|upload|uploads|loading|load|http|axios|database|db|auth|session|token)\b|(?:\u0430\u043f\u0438|\u0431\u044d\u043a|\u0431\u0435\u043a|\u0431\u044d\u043a\u0435\u043d\u0434|\u0431\u0435\u043a\u0435\u043d\u0434|\u0441\u0435\u0440\u0432\u0435\u0440|\u044d\u043d\u0434\u043f\u043e\u0438\u043d\u0442|\u043c\u0430\u0440\u0448\u0440\u0443\u0442|\u0437\u0430\u043f\u0440\u043e\u0441|\u0444\u0435\u0442\u0447|\u0437\u0430\u0433\u0440\u0443\u0437|\u0431\u0430\u0437\u0430|\u0431\u0434|\u0430\u0432\u0442\u043e\u0440\u0438\u0437\u0430\u0446|\u0441\u0435\u0441\u0441|\u0442\u043e\u043a\u0435\u043d))/i;
  const negativeIntent =
    /(?:\b(?:do\s+not|don't|dont|without|avoid|keep|leave|preserve)\b|\u043d\u0435\s+(?:\u043c\u0435\u043d\u044f|\u0442\u0440\u043e\u0433|\u0440\u0435\u0434\u0430\u043a\u0442\u0438\u0440|\u0438\u0437\u043c\u0435\u043d|\u043b\u043e\u043c\u0430|\u043f\u0435\u0440\u0435\u043f\u0438\u0441|\u0441\u043e\u0437\u0434\u0430\u0432|\u0434\u043e\u0431\u0430\u0432\u043b)|\u0431\u0435\u0437\s+\u0438\u0437\u043c\u0435\u043d)/i;

  if (!backendSurface.test(normalized) || !negativeIntent.test(normalized))
    return false;

  return [
    new RegExp(
      `${backendSurface.source}[\\s\\S]{0,180}${negativeIntent.source}`,
      "i",
    ),
    new RegExp(
      `${negativeIntent.source}[\\s\\S]{0,180}${backendSurface.source}`,
      "i",
    ),
  ].some((pattern) => pattern.test(normalized));
}

function hasSimpleProtectedBackendText(rawTask: string) {
  const text = rawTask.toLowerCase().replace(/[_./\\-]+/g, " ");
  const hasBackendSurface =
    /(?:\b(?:api|backend|server|endpoint|request|fetch|upload|loading|database|db|auth|session|token)\b|(?:\u0430\u043f\u0438|\u0431\u044d\u043a|\u0431\u0435\u043a|\u0441\u0435\u0440\u0432\u0435\u0440|\u0437\u0430\u043f\u0440\u043e\u0441|\u0437\u0430\u0433\u0440\u0443\u0437|\u0431\u0430\u0437\u0430|\u0431\u0434|\u0441\u0435\u0441\u0441|\u0442\u043e\u043a\u0435\u043d))/i.test(
      text,
    );
  const hasNegative =
    /(?:\b(?:do not|don't|dont|without|avoid|keep|preserve)\b|\u043d\u0435\s+(?:\u043c\u0435\u043d\u044f|\u0442\u0440\u043e\u0433|\u0440\u0435\u0434\u0430\u043a\u0442\u0438\u0440|\u0438\u0437\u043c\u0435\u043d|\u043b\u043e\u043c\u0430|\u0441\u043e\u0437\u0434\u0430\u0432|\u0434\u043e\u0431\u0430\u0432\u043b)|\u0431\u0435\u0437\s+\u0438\u0437\u043c\u0435\u043d)/i.test(
      text,
    );
  return hasBackendSurface && hasNegative;
}

function hasSimpleUiSurfaceText(rawTask: string) {
  const text = rawTask.toLowerCase().replace(/[_./\\-]+/g, " ");
  return [
    "ui",
    "ux",
    "frontend",
    "front end",
    "screen",
    "page",
    "layout",
    "visual",
    "design",
    "style",
    "css",
    "button",
    "form",
    "input",
    "modal",
    "dialog",
    "card",
    "navigation",
    "navbar",
    "header",
    "topbar",
    "menu",
    "\u044d\u043a\u0440\u0430\u043d",
    "\u0441\u0442\u0440\u0430\u043d\u0438\u0446",
    "\u0432\u0438\u0437\u0443\u0430\u043b",
    "\u0434\u0438\u0437\u0430\u0439\u043d",
    "\u0441\u0442\u0438\u043b",
    "\u043a\u043d\u043e\u043f",
    "\u0444\u043e\u0440\u043c",
    "\u043f\u043e\u043b\u0435",
    "\u0438\u043d\u043f\u0443\u0442",
    "\u043c\u043e\u0434\u0430\u043b",
    "\u0434\u0438\u0430\u043b\u043e\u0433",
    "\u043a\u0430\u0440\u0442\u043e\u0447",
    "\u043d\u0430\u0432\u0438\u0433\u0430\u0446",
    "\u0448\u0430\u043f\u043a",
  ].some((term) => text.includes(term));
}

function hasSimpleProtectedFrontendText(rawTask: string) {
  const text = stripProtectedBackendScopeClauses(rawTask)
    .toLowerCase()
    .replace(/[_./\\-]+/g, " ");
  const frontendScope = String.raw`(?:\b(?:ui|ux|frontend|front\s*end|screen|page|layout|visual|design|style|css|button|form|input|modal|dialog|card|navigation|header|topbar|menu)\b|(?:\u044d\u043a\u0440\u0430\u043d|\u0441\u0442\u0440\u0430\u043d\u0438\u0446|\u0432\u0438\u0437\u0443\u0430\u043b|\u0434\u0438\u0437\u0430\u0439\u043d|\u0441\u0442\u0438\u043b|\u043a\u043d\u043e\u043f|\u0444\u043e\u0440\u043c|\u043a\u0430\u0440\u0442\u043e\u0447|\u0448\u0430\u043f\u043a|\u0438\u043d\u0442\u0435\u0440\u0444\u0435\u0439\u0441))`;
  const negativeIntent = String.raw`(?:\b(?:do\s+not|don't|dont)\s+(?:touch|change|edit|modify)\b|\bwithout\s+(?:changing|touching|editing|modifying)\b|\b(?:keep|leave)\b[^.!?\n]{0,32}\b(?:unchanged|alone|intact)\b|\b(?:not\s+touch|not\s+change)\b|\u043d\u0435\s+(?:\u043c\u0435\u043d|\u0442\u0440\u043e\u0433|\u0440\u0435\u0434\u0430\u043a\u0442\u0438\u0440|\u0438\u0437\u043c\u0435\u043d|\u043b\u043e\u043c\u0430)|\u0431\u0435\u0437\s+\u0438\u0437\u043c\u0435\u043d)`;

  return [
    new RegExp(`${frontendScope}[^.!?\\n]{0,120}${negativeIntent}`, "i"),
    new RegExp(`${negativeIntent}[^.!?\\n]{0,120}${frontendScope}`, "i"),
    /\b(?:backend|server|api)\s+only\b/i,
    /(?:\u0442\u043e\u043b\u044c\u043a\u043e\s+(?:backend|api|\u0431\u044d\u043a\u0435\u043d\u0434|\u0431\u0435\u043a\u0435\u043d\u0434|\u0441\u0435\u0440\u0432\u0435\u0440|\u0430\u043f\u0438))/i,
  ].some((pattern) => pattern.test(text));
}

function stripProtectedBackendScopeClauses(rawTask: string) {
  const backendScope = String.raw`(?:\b(?:backend|back[-\s]?end|api|server|endpoint|route|request|requests|fetch|upload|uploads|loading|load|http|axios|database|db)\b|(?:\u0431\u044d\u043a|\u0431\u0435\u043a|\u0431\u044d\u043a\u0435\u043d\u0434|\u0431\u0435\u043a\u0435\u043d\u0434|\u0430\u043f\u0438|api|\u0441\u0435\u0440\u0432\u0435\u0440|\u044d\u043d\u0434\u043f\u043e\u0438\u043d\u0442|\u043c\u0430\u0440\u0448\u0440\u0443\u0442|\u0437\u0430\u043f\u0440\u043e\u0441|\u0444\u0435\u0442\u0447|\u0437\u0430\u0433\u0440\u0443\u0437|\u0431\u0430\u0437\u0430|\u0431\u0434))`;
  const negativeVerb = String.raw`(?:\b(?:do\s+not|don't|dont)\s+(?:touch|change|edit|modify|rewrite|create|add|introduce|register)\b|\b(?:should|must)\s+not\s+(?:touch|change|edit|modify|rewrite|create|add|introduce|register)\b|\b(?:keep|leave)\b[^.!?\n]{0,32}\b(?:unchanged|alone)\b|\b(?:must|should)\b[^.!?\n]{0,32}\b(?:stay|remain)\b[^.!?\n]{0,16}\b(?:unchanged|intact)\b|\u043d\u0435\s+(?:\u0442\u0440\u043e\u0433\u0430\u0439|\u0442\u0440\u043e\u0433\u0430\u0442\u044c|\u043c\u0435\u043d\u044f\u0439|\u043c\u0435\u043d\u044f\u0442\u044c|\u0440\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u0443\u0439|\u0440\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u0442\u044c|\u043f\u0435\u0440\u0435\u043f\u0438\u0441\u044b\u0432\u0430\u0439|\u043f\u0435\u0440\u0435\u043f\u0438\u0441\u044b\u0432\u0430\u0442\u044c|\u0441\u043e\u0437\u0434\u0430\u0432\u0430\u0439|\u0441\u043e\u0437\u0434\u0430\u0432\u0430\u0442\u044c|\u0434\u043e\u0431\u0430\u0432\u043b\u044f\u0439|\u0434\u043e\u0431\u0430\u0432\u043b\u044f\u0442\u044c)|\u0431\u0435\u0437\s+\u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0438\u0439)`;

  return rawTask
    .replace(
      /\bapi\b[^.!?;\n]{0,160}\u043d\u0435\s+(?:\u043c\u0435\u043d\u044f\u0442\u044c|\u043c\u0435\u043d\u044f\u0439|\u0442\u0440\u043e\u0433\u0430\u0442\u044c|\u0442\u0440\u043e\u0433\u0430\u0439|\u0440\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u0442\u044c|\u0440\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u0443\u0439|\u0438\u0437\u043c\u0435\u043d\u044f\u0442\u044c|\u0438\u0437\u043c\u0435\u043d\u044f\u0439)[^.!?;\n]*/gi,
      " ",
    )
    .replace(
      /(?:\u0430\u043f\u0438|\u0437\u0430\u043f\u0440\u043e\u0441[a-z\u0430-\u044f\u04510-9_-]*|\u0437\u0430\u0433\u0440\u0443\u0437[a-z\u0430-\u044f\u04510-9_-]*)[^.!?;\n]{0,160}\u043d\u0435\s+(?:\u043c\u0435\u043d\u044f\u0442\u044c|\u043c\u0435\u043d\u044f\u0439|\u0442\u0440\u043e\u0433\u0430\u0442\u044c|\u0442\u0440\u043e\u0433\u0430\u0439|\u0440\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u0442\u044c|\u0440\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u0443\u0439|\u0438\u0437\u043c\u0435\u043d\u044f\u0442\u044c|\u0438\u0437\u043c\u0435\u043d\u044f\u0439)[^.!?;\n]*/gi,
      " ",
    )
    .replace(
      new RegExp(
        `${backendScope}[^.!?;\\n]{0,160}${negativeVerb}[^.!?;\\n]*`,
        "gi",
      ),
      " ",
    )
    .replace(
      new RegExp(
        `${negativeVerb}[^.!?;\\n]{0,160}${backendScope}[^.!?;\\n]*`,
        "gi",
      ),
      " ",
    );
}

function hasRuntimeUiSurfaceTerm(rawTask: string) {
  return matchesAny(rawTask, [
    /\b(?:ui|ux|frontend|front-end|screen|page|layout|visual|design|style|css|button|form|input|modal|card|navigation|nav|navbar|header|topbar|menu|theme|account)\b/i,
    /(?:\u044d\u043a\u0440\u0430\u043d|\u0441\u0442\u0440\u0430\u043d\u0438\u0446|\u0432\u0438\u0437\u0443\u0430\u043b|\u0434\u0438\u0437\u0430\u0439\u043d|\u0432\u043d\u0435\u0448\u043d|\u0441\u0442\u0438\u043b|\u043a\u043d\u043e\u043f|\u0444\u043e\u0440\u043c|\u043f\u043e\u043b\u0435|\u043c\u043e\u0434\u0430\u043b|\u043a\u0430\u0440\u0442\u043e\u0447|\u043d\u0430\u0432\u0438\u0433\u0430\u0446|\u0448\u0430\u043f\u043a|\u0432\u0435\u0440\u0445\u043d\u0435\u0435\s+\u043c\u0435\u043d\u044e|\u043f\u0435\u0440\u0435\u043a\u043b\u044e\u0447\u0430\u0442\u0435\u043b\u044c\s+\u0442\u0435\u043c|\u043a\u043d\u043e\u043f\u043a\u0430\s+\u0430\u043a\u043a\u0430\u0443\u043d\u0442|\u0435\u0434\u0435\u0442\s+\u0432\u043f\u0440\u0430\u0432\u043e)/i,
  ]);
}

function hasDirectUiSurfaceText(rawTask: string) {
  return /(?:\b(?:ui|ux|frontend|front\s*end|screen|page|layout|visual|design|style|css|button|form|input|modal|dialog|card|navigation|nav|navbar|header|topbar|menu|theme|account)\b|(?:\u044d\u043a\u0440\u0430\u043d|\u0441\u0442\u0440\u0430\u043d\u0438\u0446|\u0432\u0438\u0437\u0443\u0430\u043b|\u0434\u0438\u0437\u0430\u0439\u043d|\u0432\u043d\u0435\u0448\u043d|\u0441\u0442\u0438\u043b|\u043a\u043d\u043e\u043f|\u0444\u043e\u0440\u043c|\u043f\u043e\u043b\u0435|\u0438\u043d\u043f\u0443\u0442|\u043c\u043e\u0434\u0430\u043b|\u0434\u0438\u0430\u043b\u043e\u0433|\u043a\u0430\u0440\u0442\u043e\u0447|\u043d\u0430\u0432\u0438\u0433\u0430\u0446|\u0448\u0430\u043f\u043a|\u043c\u0435\u043d\u044e|\u0430\u043a\u043a\u0430\u0443\u043d\u0442))/i.test(
    rawTask,
  );
}

interface TaskConstraints {
  noBackendMutation: boolean;
  noFrontendMutation: boolean;
  onlyExplicitFiles: boolean;
  protectOtherPages: boolean;
  runtimeNoBackendConstraint: boolean;
  protectedFileTerms: string[];
  notes: string[];
}

function uniqueNormalizedTokens(values: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const token = normalizeForCompare(value).replace(
      /^[^a-zа-яё0-9]+|[^a-zа-яё0-9]+$/gi,
      "",
    );
    if (!token || token.length < 3 || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }

  return out;
}

const NEGATIVE_CONSTRAINT_STOP_WORDS = new Set([
  "не",
  "no",
  "not",
  "do",
  "dont",
  "don't",
  "менять",
  "меняй",
  "трогать",
  "трогай",
  "редактировать",
  "редактируй",
  "изменять",
  "изменяй",
  "modify",
  "change",
  "touch",
  "edit",
  "create",
  "add",
  "создавать",
  "создавай",
  "добавлять",
  "добавляй",
  "without",
  "keep",
  "and",
  "or",
  "the",
  "a",
  "an",
  "site",
  "page",
  "pages",
  "screen",
  "screens",
  "route",
  "routes",
  "view",
  "views",
  "сайт",
  "сайта",
  "эту",
  "это",
  "там",
  "вот",
  "как",
  "или",
  "и",
  "а",
  "но",
  "при",
  "для",
  "по",
  "на",
  "остальные",
  "остальных",
  "страницы",
  "страниц",
  "файлы",
  "файл",
  "others",
  "other",
  "rest",
]);

function getNegativeConstraintPhrases(rawTask: string) {
  const text = normalizeForCompare(rawTask).replace(/[—–]/g, " — ");
  const phrases: string[] = [];

  const cleanPhrase = (value: string) =>
    value
      .replace(/\s+/g, " ")
      .replace(/^(?:в|in|into|к|to)\s+/i, "")
      .replace(
        /\b(?:не\s+(?:меняй|менять|трогай|трогать|лезь|лезть|редактируй|редактировать|изменяй|изменять|создавай|создавать|добавляй|добавлять)|do\s+not|don't|dont|without|keep)\b.*$/i,
        "",
      )
      .split(/[.!?\n—]/)[0]
      .trim();

  const afterNegativeRegexes = [
    /(?:не\s+(?:менять|меняй|трогать|трогай|лезь|лезть|редактировать|редактируй|изменять|изменяй|создавать|создавай|добавлять|добавляй))\s+(?:в\s+|к\s+)?([^.!?\n—]{1,120})/gi,
    /(?:do\s+not|don't|dont)\s+(?:change|touch|edit|modify|create|add|introduce|register)\s+([^.!?\n—]{1,120})/gi,
    /(?:without\s+(?:changing|touching|editing|modifying|creating|adding|introducing|registering))\s+([^.!?\n—]{1,120})/gi,
    /(?:keep)\s+([^.!?\n—]{1,90})\s+(?:unchanged|intact)/gi,
  ];

  // Handles natural Russian order: "шапку, футер и контакты не трогать".
  // Keep only the last clause before the negation so positive task text earlier in the sentence
  // does not become protected by accident.
  const beforeNegativeRegexes = [
    /([^.!?\n—]{1,160})\s+не\s+(?:менять|трогать|редактировать|изменять|создавать|добавлять)/gi,
    /([^.!?\n—]{1,160})\s+(?:do\s+not|don't|dont)\s+(?:change|touch|edit|modify|create|add|introduce|register)/gi,
  ];

  beforeNegativeRegexes.push(
    /([^.!?\n—]{1,160})\s+(?:should|must)\s+not\s+(?:change|touch|edit|modify|create|add|introduce|register)/gi,
  );

  for (const regex of afterNegativeRegexes) {
    for (const match of text.matchAll(regex)) {
      const cleaned = cleanPhrase(match[1] ?? "");
      if (cleaned) phrases.push(cleaned);
    }
  }

  for (const regex of beforeNegativeRegexes) {
    for (const match of text.matchAll(regex)) {
      const raw = String(match[1] ?? "");
      const clause =
        raw
          .split(/[.;!?\n—]/)
          .pop()
          ?.trim() ?? raw.trim();
      const afterBut =
        clause
          .split(/(?:^|\s)(?:но|but|however)(?:\s|$)/gi)
          .pop()
          ?.trim() ?? clause;
      // Skip positive task clauses such as "improve navigation and do not change other files".
      if (
        /(?:улучш|сдел|замен|добав|реализ|подключ|исправ|передел)/i.test(
          afterBut,
        ) ||
        /\b(?:improve|make|replace|add|implement|connect|fix|change|update)\b/i.test(
          afterBut,
        )
      )
        continue;
      const cleaned = cleanPhrase(afterBut);
      if (cleaned) phrases.push(cleaned);
    }
  }

  return uniqueStrings(phrases).slice(0, 12);
}

function getPositiveTaskText(rawTask: string) {
  let text = stripProtectedBackendScopeClauses(rawTask);

  for (const phrase of getNegativeConstraintPhrases(rawTask)) {
    if (!phrase) continue;
    const escaped = phrase
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\s+/g, "\\s+");
    text = text.replace(new RegExp(escaped, "gi"), " ");
  }

  // Also remove common trailing "only do X" constraint tails from target scoring.
  text = text.replace(
    /(?:но|but)\s+(?:не\s+)?(?:меняй|трогай|лезь|change|touch|edit)[^.!?\n—]{0,160}/gi,
    " ",
  );
  return text.replace(/\s+/g, " ").trim();
}

function extractNegativeConstraintTerms(rawTask: string) {
  const chunks = getNegativeConstraintPhrases(rawTask);

  const tokens = uniqueNormalizedTokens(
    chunks.flatMap((chunk) => chunk.split(/[^a-zа-яё0-9_.\/-]+/i)),
  )
    .filter((token) => !NEGATIVE_CONSTRAINT_STOP_WORDS.has(token))
    .filter((token) => token.length <= 32)
    .slice(0, 24);

  const expanded = new Set(tokens);
  for (const token of tokens) {
    // Universal technical/UI vocabulary, not business-domain project rules.
    if (token.startsWith("шап") || token === "header")
      ["header", "nav", "navigation", "navbar", "topbar"].forEach((item) =>
        expanded.add(item),
      );
    if (token.startsWith("фут") || token.startsWith("footer"))
      ["footer", "foot"].forEach((item) => expanded.add(item));
    if (token.startsWith("контакт") || token.startsWith("contact"))
      ["contact", "contacts", "контакт", "контакты"].forEach((item) =>
        expanded.add(item),
      );
    if (token.startsWith("достав") || token.startsWith("deliver"))
      ["delivery", "deliver", "shipping", "достав", "доставка"].forEach(
        (item) => expanded.add(item),
      );
    if (token.startsWith("роут") || token.startsWith("route"))
      ["route", "routes", "routing", "роут", "роуты"].forEach((item) =>
        expanded.add(item),
      );
    if (token.startsWith("таблиц") || token.startsWith("table"))
      ["table", "tables", "таблица", "таблицы"].forEach((item) =>
        expanded.add(item),
      );
    if (token.startsWith("ридми") || token === "readme")
      ["readme", "readme.md", "docs"].forEach((item) => expanded.add(item));
    if (token === "api" || token === "апи")
      ["api", "endpoint", "service"].forEach((item) => expanded.add(item));
    if (token.startsWith("запрос") || token.startsWith("request"))
      ["api", "request", "requests", "fetch", "axios"].forEach((item) =>
        expanded.add(item),
      );
    if (token.startsWith("юрид") || token.startsWith("legal"))
      ["policy", "privacy", "consent", "terms", "legal"].forEach((item) =>
        expanded.add(item),
      );
    if (token.startsWith("стил") || token === "style" || token === "styles")
      ["style", "styles", "css", "стил"].forEach((item) => expanded.add(item));
  }

  return Array.from(expanded);
}

function mentionsOnlyExplicitFiles(rawTask: string) {
  return includesAny(rawTask, [
    "не менять остальные файлы",
    "не меняй остальные файлы",
    "не трогать остальные файлы",
    "не трогай остальные файлы",
    "остальные файлы не трогать",
    "остальные файлы не менять",
    "другие файлы не трогать",
    "другие файлы не менять",
    "только этот файл",
    "только этот компонент",
    "only this file",
    "this file only",
    "do not change other files",
    "don't change other files",
    "do not touch other files",
    "don't touch other files",
    "leave other files alone",
  ]);
}

function mentionsOtherPagesProtected(rawTask: string) {
  return includesAny(rawTask, [
    "не менять остальные страницы",
    "не меняй остальные страницы",
    "не трогать остальные страницы",
    "не трогай остальные страницы",
    "остальные страницы не трогать",
    "остальные страницы не менять",
    "другие страницы не трогать",
    "другие страницы не менять",
    "остальные страницы",
    "другие страницы",
    "юридические страницы не трогать",
    "юридические страницы не менять",
    "do not change other pages",
    "don't change other pages",
    "do not touch other pages",
    "don't touch other pages",
    "other pages",
    "legal pages",
  ]);
}

function buildTaskConstraintsUncached(
  input: SelectTaskFilesInput,
): TaskConstraints {
  const rawTask = input.rawTask;
  const selectedArea = getSelectedTaskTypeArea(input.taskType);
  const frontendProtectedForBackendTask =
    (selectedArea === "backend" || input.taskIntent?.taskArea === "backend") &&
    hasSimpleProtectedFrontendText(rawTask);
  const runtimeNoBackendConstraint = frontendProtectedForBackendTask
    ? false
    : hasRuntimeNoBackendConstraint(rawTask) ||
      hasProtectedBackendScopeConstraint(rawTask) ||
      hasDirectProtectedBackendText(rawTask) ||
      hasSimpleProtectedBackendText(rawTask);
  const protectedFileTerms = uniqueStrings([
    ...extractNegativeConstraintTerms(rawTask),
    ...extractProtectedRouteTermsFromInventory(rawTask, input.inventory),
    ...(runtimeNoBackendConstraint
      ? [
          "backend",
          "server",
          "api",
          "auth",
          "authorization",
          "authentication",
          "session",
          "token",
          "cookie",
          "database",
          "db",
          "бэк",
          "бек",
          "бэкенд",
          "бекенд",
          "апи",
          "авторизац",
          "аутентиф",
          "сесс",
          "токен",
          "куки",
          "база",
          "бд",
        ]
      : []),
  ]);
  const hasProtectedApiTerms = protectedFileTerms.some((term) => {
    const normalized = normalizeForCompare(term).replace(
      /^[^a-zа-яё0-9]+|[^a-zа-яё0-9]+$/gi,
      "",
    );
    return (
      [
        "api",
        "endpoint",
        "service",
        "request",
        "requests",
        "fetch",
        "axios",
      ].includes(normalized) ||
      normalized.startsWith("api") ||
      normalized.startsWith("апи") ||
      normalized.startsWith("запрос") ||
      normalized.startsWith("загруз") ||
      normalized.startsWith("upload") ||
      normalized.startsWith("load")
    );
  });

  const noBackendMutation =
    runtimeNoBackendConstraint ||
    hasProtectedApiTerms ||
    includesAny(rawTask, [
      "do not change backend",
      "don't change backend",
      "do not modify backend",
      "don't modify backend",
      "keep backend api unchanged",
      "backend api unchanged",
      "keep api unchanged",
      "api unchanged",
      "without changing backend",
      "without backend changes",
      "frontend only",
      "front-end only",
      "ui only",
      "client only",
      "do not touch backend",
      "don't touch backend",
      "do not edit backend",
      "don't edit backend",
      "do not edit api",
      "don't edit api",
      "do not edit server",
      "don't edit server",
      "не редактировать backend",
      "не редактируй backend",
      "не редактировать api",
      "не редактируй api",
      "не редактировать бэк",
      "не редактируй бэк",
      "не редактировать бэкенд",
      "не редактируй бэкенд",
      "не меняй backend",
      "не менять backend",
      "backend не менять",
      "backend не трогать",
      "backend не трогай",
      "backend не редактировать",
      "backend не редактируй",
      "не трогай backend",
      "не трогать backend",
      "не менять backend api",
      "не менять api",
      "не меняй api",
      "api не менять",
      "api не трогать",
      "апи не менять",
      "апи не трогать",
      "не менять бэкенд",
      "не трогать бэкенд",
      "не трогай бэкенд",
      "не менять бекенд",
      "не трогать бекенд",
      "не трогай бэк",
      "не трогать бэк",
      "бэк не трогать",
      "бэкенд не трогать",
      "только ui",
      "только ux",
      "только фронт",
      "только frontend",
      "только визуал",
      "только интерфейс",
    ]);

  const noFrontendMutation =
    hasSimpleProtectedFrontendText(rawTask) ||
    includesAny(rawTask, [
      "do not change frontend",
      "don't change frontend",
      "do not change ui",
      "don't change ui",
      "backend only",
      "server only",
      "api only",
      "without ui changes",
      "without frontend changes",
      "не менять frontend",
      "не трогать frontend",
      "не менять фронт",
      "не трогать фронт",
      "не менять ui",
      "не трогать ui",
      "не менять интерфейс",
      "без изменений ui",
      "без изменений интерфейса",
      "только backend",
      "только бэкенд",
      "только бекенд",
      "только api",
      "только сервер",
    ]);

  const onlyExplicitFiles = mentionsOnlyExplicitFiles(rawTask);
  const protectOtherPages = mentionsOtherPagesProtected(rawTask);

  return {
    noBackendMutation,
    noFrontendMutation,
    onlyExplicitFiles,
    protectOtherPages,
    runtimeNoBackendConstraint,
    protectedFileTerms,
    notes: [
      noBackendMutation
        ? "Constraint detected: backend/API files should not be selected as edit targets."
        : "",
      noFrontendMutation
        ? "Constraint detected: protected frontend/UI infrastructure files should not be selected as edit targets."
        : "",
      onlyExplicitFiles
        ? "Constraint detected: user asked not to change other files; explicit file mentions are treated as the edit boundary."
        : "",
      protectOtherPages
        ? "Constraint detected: user asked not to change other pages; unrelated page/layout files are protected."
        : "",
      protectedFileTerms.length > 0
        ? `Constraint detected: protected terms from task: ${protectedFileTerms.slice(0, 10).join(", ")}.`
        : "",
    ].filter(Boolean),
  };
}

function getTaskConstraints(input: SelectTaskFilesInput): TaskConstraints {
  const cached = taskConstraintsCache.get(input);
  if (cached) return cached;
  const value = buildTaskConstraintsUncached(input);
  taskConstraintsCache.set(input, value);
  return value;
}

function normalizeConfidence(value: unknown) {
  const confidence = Number(value);
  return Number.isFinite(confidence)
    ? Math.min(1, Math.max(0, confidence))
    : 0.5;
}

function normalizeString(value: unknown, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => {
      const type = typeof item;
      return type === "string" || type === "number" || type === "boolean";
    })
    .map((item) => String(item).trim())
    .filter((item) => item.length > 0 && item !== "[object Object]")
    .slice(0, 50);
}

function isValidUsage(value: unknown): value is SelectedTaskFileUsage {
  return VALID_USAGES.includes(value as SelectedTaskFileUsage);
}

function tokenize(value: string) {
  const separators = /[^a-z\u0430-\u044f\u04510-9_.\/-]+/i;
  return normalizeForCompare(value)
    .split(separators)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function tokenizeIdentifierLike(value: string) {
  const separators = /[^a-z\u0430-\u044f\u04510-9]+/i;
  return normalizePath(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(separators)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function uniqueStrings(values: string[]) {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  );
}

function buildTaskText(input: SelectTaskFilesInput) {
  return [
    getPositiveTaskText(input.rawTask),
    input.taskType,
    input.targetTool,
    input.taskIntent?.taskArea ?? "",
    ...(input.taskIntent?.intentTags ?? []),
    ...(input.taskIntent?.domainTerms ?? []),
    ...(input.taskIntent?.mentionedEntities ?? []),
    ...(input.taskIntent?.fileRoleHints ?? []),
    ...(input.taskIntent?.recommendedSearchTerms ?? []),
  ].join(" ");
}

function sanitizeUsageForFile(
  file: ProjectInventoryFile,
  requestedUsage: SelectedTaskFileUsage,
): SelectedTaskFileUsage {
  if (requestedUsage === "create-and-edit") return "create-and-edit";
  if (file.kind === "asset") return "asset-reference";
  if (file.kind === "config")
    return requestedUsage === "inspect-only"
      ? "inspect-only"
      : "config-reference";
  if (file.kind === "docs")
    return requestedUsage === "inspect-and-edit"
      ? "inspect-and-edit"
      : "inspect-only";
  if (file.kind === "data" || file.kind === "runtime") return "inspect-only";
  if (
    requestedUsage === "asset-reference" ||
    requestedUsage === "config-reference"
  )
    return "inspect-and-edit";
  return requestedUsage;
}

function defaultUsageForFile(
  file: ProjectInventoryFile,
): SelectedTaskFileUsage {
  if (file.kind === "asset") return "asset-reference";
  if (file.kind === "config") return "config-reference";
  if (file.kind === "docs" || file.kind === "data" || file.kind === "runtime")
    return "inspect-only";
  return "inspect-and-edit";
}

function isBackendProtectedRole(file: ProjectInventoryFile) {
  return [
    "api-route",
    "client-api",
    "service",
    "repository",
    "db-schema",
    "server-entry",
  ].includes(file.role);
}

function isBackendProtectedPath(file: ProjectInventoryFile) {
  const filePath = normalizeForCompare(file.path);
  return (
    filePath.startsWith("server/") ||
    filePath.includes("/server/") ||
    filePath.startsWith("backend/") ||
    filePath.includes("/backend/") ||
    filePath.startsWith("src/api/") ||
    filePath.includes("/src/api/") ||
    filePath.includes("/api/") ||
    filePath.includes("/routes/") ||
    filePath.includes("/services/")
  );
}

function isAuthProtectedFile(file: ProjectInventoryFile) {
  const fileText = normalizeForCompare(
    [file.path, file.name, file.role, ...(file.exports ?? [])].join(" "),
  );

  if (
    includesAny(fileText, [
      "auth",
      "authorization",
      "authentication",
      "session",
      "token",
      "cookie",
      "авторизац",
      "аутентиф",
      "сесс",
      "токен",
      "куки",
    ])
  ) {
    return true;
  }

  return (
    ["store", "service", "repository"].includes(file.role) &&
    includesAny((file.textHints ?? []).join(" "), [
      "auth",
      "authorization",
      "authentication",
      "session",
      "token",
      "cookie",
      "авторизац",
      "аутентиф",
      "сесс",
      "токен",
      "куки",
    ])
  );
}

function isBackendOrAuthProtectedSupportFile(file: ProjectInventoryFile) {
  return (
    isBackendProtectedRole(file) ||
    isBackendProtectedPath(file) ||
    isAuthProtectedFile(file) ||
    isServerSidePath(file.path) ||
    isClientApiBridgePath(file.path) ||
    (isBackendLeaningPath(file.path) && !isClientUiPath(file.path))
  );
}

function isBehaviorOrStateSupportFile(file: ProjectInventoryFile) {
  const filePath = normalizeForCompare(file.path);
  const fileText = normalizeForCompare(
    [
      file.path,
      file.name,
      file.role,
      ...(file.symbols ?? []),
      ...(file.exports ?? []),
    ].join(" "),
  );

  return (
    isBackendOrAuthProtectedSupportFile(file) ||
    ["hook", "store", "service", "repository", "model", "state"].includes(
      file.role,
    ) ||
    filePath.includes("/contexts/") ||
    filePath.includes("/context/") ||
    filePath.includes("/hooks/") ||
    filePath.includes("/stores/") ||
    filePath.includes("/store/") ||
    filePath.includes("/state/") ||
    filePath.includes("/services/") ||
    filePath.includes("/repositories/") ||
    filePath.includes("/repository/") ||
    filePath.includes("/data/") ||
    includesAny(fileText, [
      "context",
      "store",
      "state",
      "reducer",
      "dispatch",
      "hook",
      "service",
      "repository",
    ])
  );
}

function getSelectedTaskTypeArea(taskType: string): EffectiveTaskArea {
  const selected = normalizeForCompare(taskType);
  if (selected.includes("build") || selected.includes("config")) return "build";
  if (selected.includes("docs")) return "docs";
  if (selected.includes("test")) return "tests";
  if (
    selected.includes("ui") ||
    selected.includes("ux") ||
    selected.includes("front")
  )
    return "ui";
  if (
    selected.includes("backend") ||
    selected.includes("server") ||
    selected.includes("api")
  )
    return "backend";
  if (selected.includes("fullstack") || selected.includes("full-stack"))
    return "fullstack";
  if (selected.includes("bugfix")) return "bugfix";
  if (selected.includes("refactor")) return "refactor";
  return "general";
}

function hasDirectTestTaskIntent(rawTask: string, normalizedText?: string) {
  const text = normalizeForCompare(normalizedText ?? rawTask);
  if (
    /(?:тестов(?:ые|ых|ыми)?\s+(?:данн|запис|набор|баз)|test\s+(?:data|fixtures?))/iu.test(
      text,
    )
  ) {
    const explicitWrite =
      /(?:добавь|напиши|создай|реализуй|покрой)[^.!?\n]{0,90}(?:тест(?:ы)?|проверки)(?=$|[\s,.;:!?])/iu.test(
        text,
      ) ||
      /\b(?:add|write|create|implement)\b[^.!?\n]{0,90}\btests?\b/i.test(text);
    if (!explicitWrite) return false;
  }
  return (
    /\b(?:unit|integration|e2e|smoke|replay|regression)\s+tests?\b/i.test(
      text,
    ) ||
    /\b(?:coverage|assertions?|test suite|test cases?)\b/i.test(text) ||
    /\b(?:add|write|create|implement|update)\b[^.!?\n]{0,90}\btests?\b/i.test(
      text,
    ) ||
    /(?:добавь|напиши|создай|реализуй|покрой)[^.!?\n]{0,90}(?:тест(?:ы)?|проверки)(?=$|[\s,.;:!?])/iu.test(
      text,
    ) ||
    /(?:тест(?:ы)?|проверки)(?=$|[\s,.;:!?])\s+(?:для|на)\b/iu.test(text)
  );
}

function scoreTaskArea(input: SelectTaskFilesInput) {
  const text = normalizeForCompare(
    [
      getPositiveTaskText(input.rawTask),
      getRoutingNormalizationText(input.rawTask),
      ...(input.taskIntent?.intentTags ?? []),
      ...(input.taskIntent?.fileRoleHints ?? []),
    ].join(" "),
  );

  const scores: Record<EffectiveTaskArea, number> = {
    ui: 0,
    backend: 0,
    fullstack: 0,
    build: 0,
    bugfix: 0,
    refactor: 0,
    docs: 0,
    tests: 0,
    general: 0,
  };
  const constraints = getTaskConstraints(input);
  const hasImplementationAction = includesAny(text, [
    "implement",
    "connect",
    "integrate",
    "wire",
    "hook up",
    "create",
    "add feature",
    "build feature",
    "replace",
    "render",
    "show",
    "display",
    "fetch",
    "call",
    "change",
    "edit",
    "modify",
    "реализ",
    "подключ",
    "интегр",
    "добав",
    "созд",
    "замен",
    "вывести",
    "показ",
    "получ",
    "запрос",
    "измен",
    "передел",
  ]);
  const docsAsSecondaryDeliverable =
    hasImplementationAction &&
    includesAny(text, [
      "readme",
      "docs",
      "documentation",
      "guide",
      "manual",
      "документац",
      "ридми",
      "инструкц",
      "дальнейшей разработки",
    ]);

  const hasApi = includesAny(text, [
    "api",
    "апи",
    "endpoint",
    "эндпоинт",
    "route",
    "маршрут",
  ]);
  const hasAuth = includesAny(text, [
    "auth",
    "authorization",
    "authentication",
    "login",
    "session",
    "token",
    "cookie",
    "авторизац",
    "логин",
    "сесс",
    "токен",
    "куки",
  ]);
  const hasServer = includesAny(text, [
    "server",
    "backend",
    "database",
    "db",
    "service",
    "controller",
    "сервер",
    "серверный",
    "бэкенд",
    "бекенд",
    "база",
    "бд",
    "сервис",
  ]);
  const hasUi =
    hasRuntimeUiSurfaceTerm(input.rawTask) ||
    includesAny(text, [
      "ui",
      "ux",
      "screen",
      "page",
      "layout",
      "visual",
      "design",
      "style",
      "css",
      "button",
      "form",
      "input",
      "focus",
      "modal",
      "card",
      "navigation",
      "header",
      "frontend",
      "component",
      "flow",
      "display",
      "empty state",
      "placeholder",
      "экран",
      "страниц",
      "визуал",
      "дизайн",
      "кноп",
      "форма",
      "пол",
      "фокус",
      "модал",
      "карточ",
      "навигац",
      "шапк",
      "дороже",
      "чище",
      "деревян",
      "дефолт",
    ]);

  if (hasApi || hasAuth || hasServer) scores.backend += 5;
  if (hasApi && hasAuth) scores.backend += 8;
  if (hasUi) scores.ui += 5;
  if (isVisualOnlyUiTask(input)) {
    scores.ui += 14;
    scores.backend -= 10;
    scores.fullstack -= 8;
  }

  const positiveExplicitResolution = resolveExplicitFileMentions(
    getPositiveTaskText(input.rawTask),
    input.inventory,
  );
  const positiveExplicitFiles = positiveExplicitResolution.existingPaths
    .map((pathValue) => findInventoryFile(input.inventory, pathValue))
    .filter(Boolean) as ProjectInventoryFile[];
  if (positiveExplicitFiles.some((file) => isClientUiPath(file.path)))
    scores.ui += 12;
  if (
    positiveExplicitFiles.some(
      (file) =>
        isBackendLeaningPath(file.path) || isClientApiBridgePath(file.path),
    )
  )
    scores.backend += 8;
  const explicitRouteMentions = extractRouteMentions(input.rawTask);
  if (
    explicitRouteMentions.length > 0 ||
    extractNaturalRouteMentions(input, explicitRouteMentions).length > 0 ||
    includesAny(getPositiveTaskText(input.rawTask), [
      "на странице",
      "страница",
      "page",
      "route",
    ])
  )
    scores.ui += 7;

  if (hasImplementationAction) {
    scores.general += 2;
    if (hasApi || hasServer || hasAuth) scores.backend += 8;
    if (hasUi) scores.ui += 6;
    if (
      (hasApi || hasServer || hasAuth) &&
      (hasUi ||
        includesAny(text, [
          "interface",
          "ui",
          "frontend",
          "компонент",
          "интерфейс",
          "экран",
          "страниц",
          "программ",
        ]))
    ) {
      scores.fullstack += 11;
    }
  }
  if (
    includesAny(text, [
      "build",
      "npm run build",
      "compile",
      "compilation",
      "bundl",
      "import",
      "imports",
      "module not found",
      "resolve",
      "alias",
      "tsconfig",
      "vite",
      "next build",
      "eslint",
      "typecheck",
      "typescript",
      "proxy",
      "port",
      "configuration",
      "config",
      "dev server",
      "dev proxy",
      "сборк",
      "билд",
      "компиляц",
      "импорт",
      "импортами",
      "путями",
      "алиас",
      "модул",
    ])
  )
    scores.build += 12;
  if (
    includesAny(text, [
      "readme",
      "docs",
      "documentation",
      "guide",
      "manual",
      "instructions",
      "how to run",
      "документац",
      "ридми",
      "инструкц",
    ])
  )
    scores.docs += docsAsSecondaryDeliverable ? 2 : 8;
  if (docsAsSecondaryDeliverable) scores.docs -= 4;
  if (hasDirectTestTaskIntent(input.rawTask, text)) scores.tests += 9;
  if (
    includesAny(text, [
      "bug",
      "fix",
      "broken",
      "error",
      "crash",
      "fails",
      "not working",
      "ошибка",
      "баг",
      "слом",
      "падает",
      "не работает",
      "краш",
      "исправь",
      "почини",
    ])
  )
    scores.bugfix += 3;
  if (
    includesAny(text, [
      "refactor",
      "cleanup",
      "restructure",
      "рефактор",
      "почисти",
      "не меняй логику",
      "не меняй бизнес-логику",
    ])
  )
    scores.refactor += 3;

  if (
    hasUi &&
    (hasApi || hasServer) &&
    includesAny(text, [
      "button",
      "form",
      "screen",
      "page",
      "component",
      "badge",
      "card",
      "click",
      "handler",
      "показывает результат",
      "кноп",
      "форма",
      "экран",
      "страниц",
      "компонент",
      "бейдж",
      "карточ",
      "клик",
      "нажат",
    ]) &&
    includesAny(text, [
      "api",
      "endpoint",
      "server",
      "route",
      "вызывает сервер",
      "сервер",
      "эндпоинт",
      "маршрут",
    ])
  ) {
    scores.fullstack += 12;
  }

  if (
    hasUi &&
    hasApi &&
    includesAny(text, [
      "connect",
      "wire",
      "hook up",
      "click",
      "handler",
      "trigger",
      "call",
      "request",
      "submit",
      "\u043f\u043e\u0434\u043a\u043b\u044e\u0447",
      "\u043a\u043b\u0438\u043a",
      "\u043d\u0430\u0436\u0430\u0442",
      "\u0432\u044b\u0437\u043e\u0432",
      "\u0437\u0430\u043f\u0440\u043e\u0441",
    ])
  ) {
    scores.fullstack += 14;
    scores.backend -= 4;
  }

  if (constraints.noBackendMutation) {
    scores.backend -= 12;
    scores.fullstack -= 16;

    if (hasUi) {
      scores.ui += 7;
    }
  }

  if (constraints.noFrontendMutation) {
    scores.ui -= 12;
    scores.fullstack -= 12;

    if (hasApi || hasServer) {
      scores.backend += 7;
    }
  }

  if (input.taskIntent?.taskArea && input.taskIntent.taskArea !== "general") {
    scores[input.taskIntent.taskArea] +=
      input.taskIntent.confidence >= 0.65 ? 2.5 : 1.2;
  }

  if (
    input.taskIntent?.taskArea === "fullstack" &&
    input.taskIntent.structuredIntent?.needsBackend === true
  ) {
    scores.fullstack += 9;
    scores.backend -= 3;
  }

  if (
    input.taskIntent?.taskArea === "backend" &&
    input.taskIntent.structuredIntent?.needsBackend === true
  ) {
    scores.backend += 10;
    scores.ui -= 5;
    scores.fullstack -= 3;
  }

  if (constraints.noBackendMutation && hasUi) {
    scores.ui += 10;
    scores.backend -= 10;
    scores.fullstack -= 8;
  }

  if (
    hasUi &&
    hasAuth &&
    !hasApi &&
    !hasServer &&
    includesAny(text, [
      "badge",
      "badges",
      "chip",
      "chips",
      "provider",
      "providers",
      "avatar",
      "profile",
      "account",
      "page",
      "screen",
      "visual",
      "style",
      "card",
      "label",
      "\u0431\u0435\u0439\u0434\u0436",
      "\u0431\u0435\u0439\u0434\u0436\u0438",
      "\u043f\u0440\u043e\u0432\u0430\u0439\u0434\u0435\u0440",
      "\u043f\u0440\u043e\u0432\u0430\u0439\u0434\u0435\u0440\u044b",
      "\u0430\u0432\u0430\u0442\u0430\u0440",
      "\u043f\u0440\u043e\u0444\u0438\u043b",
      "\u0430\u043a\u043a\u0430\u0443\u043d\u0442",
      "\u0441\u0442\u0440\u0430\u043d\u0438\u0446",
      "\u0432\u0438\u0437\u0443\u0430\u043b",
      "\u0441\u0442\u0438\u043b",
      "\u043a\u0430\u0440\u0442\u043e\u0447",
    ])
  ) {
    scores.ui += 8;
    scores.backend -= 8;
    scores.fullstack -= 4;
  }

  const selectedArea = getSelectedTaskTypeArea(input.taskType);
  if (selectedArea !== "general")
    scores[selectedArea] +=
      selectedArea === "build" ||
      selectedArea === "docs" ||
      selectedArea === "tests"
        ? 10
        : 6;

  return scores;
}

function getEffectiveTaskArea(input: SelectTaskFilesInput): EffectiveTaskArea {
  const scores = scoreTaskArea(input);
  const selectedArea = getSelectedTaskTypeArea(input.taskType);
  const positiveText = normalizeForCompare(getPositiveTaskText(input.rawTask));
  const constraints = getTaskConstraints(input);
  const explicitExistingFiles = resolveExplicitFileMentions(
    input.rawTask,
    input.inventory,
  )
    .existingPaths.map((pathValue) =>
      findInventoryFile(input.inventory, pathValue),
    )
    .filter((file): file is ProjectInventoryFile => Boolean(file));

  if (
    explicitExistingFiles.length > 0 &&
    explicitExistingFiles.every((file) => file.kind === "docs") &&
    isImplementationIntentText(positiveText) &&
    !isReviewProposeOnlyTask(input)
  ) {
    return "docs";
  }

  if (
    selectedArea === "general" &&
    !hasDirectTestTaskIntent(input.rawTask, positiveText) &&
    /(?:тестов(?:ые|ых|ыми)?\s+(?:данн|запис|набор|баз)|test\s+(?:data|fixtures?))/iu.test(
      positiveText,
    ) &&
    includesAny(positiveText, [
      "sqlite",
      "storage",
      "database",
      "db",
      "repository",
      "хранилищ",
      "база",
      "бд",
      "репозитор",
    ])
  ) {
    return "backend";
  }

  if (
    selectedArea === "general" &&
    isReviewProposeOnlyTask(input) &&
    (hasRuntimeUiSurfaceTerm(input.rawTask) ||
      hasDirectUiSurfaceText(input.rawTask) ||
      hasSimpleUiSurfaceText(input.rawTask))
  ) {
    return "ui";
  }

  if (
    selectedArea === "general" &&
    !constraints.noBackendMutation &&
    !constraints.noFrontendMutation &&
    includesAny(positiveText, [
      "endpoint",
      "api",
      "server",
      "backend",
      "эндпоинт",
      "сервер",
      "бэкенд",
      "бекенд",
    ]) &&
    includesAny(positiveText, [
      "ui",
      "frontend",
      "client",
      "page",
      "screen",
      "interface",
      "интерфейс",
      "фронтенд",
      "клиент",
      "страниц",
      "экран",
    ])
  ) {
    return "fullstack";
  }

  if (selectedArea === "docs" && hasPrimaryDocsIntent(input)) {
    return "docs";
  }

  if (
    selectedArea === "general" &&
    hasPrimaryDocsIntent(input) &&
    resolveExplicitFileMentions(
      positiveText,
      input.inventory,
    ).existingPaths.some(
      (pathValue) =>
        findInventoryFile(input.inventory, pathValue)?.kind === "docs",
    )
  ) {
    return "docs";
  }

  if (
    selectedArea === "backend" &&
    (constraints.noFrontendMutation ||
      hasSimpleProtectedFrontendText(input.rawTask))
  ) {
    return "backend";
  }

  if (
    selectedArea === "general" &&
    (constraints.noBackendMutation ||
      hasSimpleProtectedBackendText(input.rawTask)) &&
    (hasRuntimeUiSurfaceTerm(input.rawTask) ||
      hasDirectUiSurfaceText(input.rawTask) ||
      hasSimpleUiSurfaceText(input.rawTask))
  ) {
    return "ui";
  }

  if (
    selectedArea === "build" &&
    includesAny(positiveText, [
      "vite",
      "proxy",
      "port",
      "configuration",
      "config",
      "tsconfig",
      "build",
      "dev server",
      "alias",
      "eslint",
      "typecheck",
    ])
  ) {
    return "build";
  }
  const sorted = (
    Object.entries(scores) as Array<[EffectiveTaskArea, number]>
  ).sort((a, b) => b[1] - a[1]);
  const [area, score] = sorted[0] ?? ["general", 0];
  return score > 0 ? area : "general";
}

function hasPrimaryDocsIntent(input: SelectTaskFilesInput) {
  const text = normalizeForCompare(
    [
      getPositiveTaskText(input.rawTask),
      getRoutingNormalizationText(input.rawTask),
    ].join(" "),
  );
  const mentionsDocs = includesAny(text, [
    "readme",
    "docs",
    "documentation",
    "guide",
    "instructions",
    "setup",
    "\u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442",
    "\u043e\u043f\u0438\u0441\u0430\u043d",
    "\u0438\u043d\u0441\u0442\u0440\u0443\u043a",
    "\u0443\u0441\u0442\u0430\u043d\u043e\u0432",
  ]);
  const directDocsAction = includesAny(text, [
    "update",
    "edit",
    "write",
    "rewrite",
    "revise",
    "add",
    "create",
    "\u043e\u0431\u043d\u043e\u0432",
    "\u0434\u043e\u0431\u0430\u0432",
    "\u043d\u0430\u043f\u0438\u0448",
    "\u043f\u0435\u0440\u0435\u043f\u0438\u0448",
    "\u043e\u043f\u0438\u0448",
    "\u0441\u043e\u0437\u0434",
  ]);

  return mentionsDocs && directDocsAction;
}

function getConflictNote(
  input: SelectTaskFilesInput,
  effectiveTaskArea: EffectiveTaskArea,
) {
  const selectedArea = getSelectedTaskTypeArea(input.taskType);
  if (selectedArea === "general" || selectedArea === effectiveTaskArea)
    return undefined;
  return `Selected task type was "${input.taskType}", but the task text was inferred as "${effectiveTaskArea}".`;
}

function getAssetMode(input: SelectTaskFilesInput): AssetMode {
  const taskText = normalizeForCompare(
    [
      getPositiveTaskText(input.rawTask),
      ...(input.taskIntent?.intentTags ?? []),
      ...(input.taskIntent?.fileRoleHints ?? []),
    ].join(" "),
  );
  const hasAssetIntent = includesAny(taskText, [
    "image",
    "picture",
    "photo",
    "asset",
    "logo",
    "icon",
    "favicon",
    "background",
    "wallpaper",
    "screenshot",
    "media",
    "banner",
    "cover",
    "artwork",
    "replace-image",
    "asset-change",
    "картин",
    "изображ",
    "фото",
    "логотип",
    "лого",
    "икон",
    "фон",
    "облож",
    "баннер",
    "медиа",
  ]);

  if (!hasAssetIntent) return "none";

  if (
    includesAny(taskText, [
      "release",
      "releases",
      "download",
      "checksum",
      "installer",
      "attached",
      "asset is missing",
      "asset missing",
      "page",
      "empty state",
    ])
  ) {
    return "none";
  }

  const hasNonAssetWork = includesAny(taskText, [
    "filter",
    "search",
    "sort",
    "select",
    "dropdown",
    "navigation",
    "button",
    "menu",
    "layout",
    "form",
    "table",
    "list",
    "grid",
    "catalog",
    "library",
    "collection",
    "api",
    "server",
    "logic",
    "state",
    "calculator",
    "design",
    "фильтр",
    "поиск",
    "сорт",
    "навигац",
    "кноп",
    "меню",
    "форма",
    "список",
    "каталог",
    "библиотек",
    "логик",
    "состояни",
    "калькулятор",
    "дизайн",
  ]);

  return hasNonAssetWork ? "mixed" : "primary";
}

function addSemanticTokenIfIncludes(
  target: Set<string>,
  text: string,
  patterns: string[],
  tokens: string[],
) {
  if (patterns.some((pattern) => text.includes(pattern)))
    tokens.forEach((token) => target.add(token));
}

function buildSemanticTokens(input: SelectTaskFilesInput) {
  const text = normalizeForCompare(buildTaskText(input));
  const tokens = new Set<string>(
    getRoutingNormalizationText(text).split(/\s+/).filter(Boolean),
  );

  // Universal technical/UI meanings only. Business-domain words are not hardcoded here;
  // they are taken dynamically from the user's task and real inventory textHints.
  addSemanticTokenIfIncludes(
    tokens,
    text,
    ["\u0442\u0430\u0431\u043b\u0438\u0446", "table"],
    ["table", "row", "rows", "grid"],
  );
  addSemanticTokenIfIncludes(
    tokens,
    text,
    ["\u0441\u043f\u0438\u0441", "list"],
    ["list", "items", "item", "row", "rows"],
  );
  addSemanticTokenIfIncludes(
    tokens,
    text,
    ["\u0444\u0438\u043b\u044c\u0442\u0440", "filter"],
    ["filter", "filters", "controls", "select", "dropdown"],
  );
  addSemanticTokenIfIncludes(
    tokens,
    text,
    ["\u043f\u043e\u0438\u0441\u043a", "search"],
    ["search", "query"],
  );
  addSemanticTokenIfIncludes(
    tokens,
    text,
    [
      "\u0444\u043e\u0440\u043c",
      "form",
      "input",
      "\u0444\u043e\u043a\u0443\u0441",
    ],
    ["form", "input", "field", "focus"],
  );
  addSemanticTokenIfIncludes(
    tokens,
    text,
    [
      "\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442",
      "\u044e\u0437\u0435\u0440",
      "user",
    ],
    ["user", "users", "account", "profile"],
  );
  addSemanticTokenIfIncludes(
    tokens,
    text,
    ["\u0430\u0434\u043c\u0438\u043d", "admin", "administrator"],
    ["admin", "administrator", "dashboard"],
  );
  addSemanticTokenIfIncludes(
    tokens,
    text,
    [
      "\u0440\u0435\u043b\u0438\u0437",
      "release",
      "version",
      "\u0432\u0435\u0440\u0441",
    ],
    ["release", "releases", "version", "versions", "changelog"],
  );
  addSemanticTokenIfIncludes(
    tokens,
    text,
    [
      "\u043f\u0443\u0441\u0442\u043e\u0435 \u0441\u043e\u0441\u0442\u043e\u044f\u043d\u0438\u0435",
      "empty state",
      "empty",
      "\u043d\u0435\u0442 \u0434\u0430\u043d\u043d\u044b\u0445",
      "\u043d\u0438\u0447\u0435\u0433\u043e \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u043e",
    ],
    ["empty", "state", "placeholder"],
  );
  addSemanticTokenIfIncludes(
    tokens,
    text,
    ["\u0430\u043a\u043a\u0430\u0443\u043d\u0442", "account"],
    ["account", "profile", "user"],
  );
  addSemanticTokenIfIncludes(
    tokens,
    text,
    [
      "\u043f\u0440\u043e\u0432\u0430\u0439\u0434\u0435\u0440",
      "provider",
      "oauth",
    ],
    ["provider", "providers", "oauth"],
  );
  addSemanticTokenIfIncludes(
    tokens,
    text,
    ["\u0431\u0435\u0439\u0434\u0436", "badge", "chip"],
    ["badge", "badges", "chip", "chips", "label"],
  );
  addSemanticTokenIfIncludes(
    tokens,
    text,
    [
      "legal",
      "privacy",
      "policy",
      "terms",
      "\u044e\u0440\u0438\u0434",
      "\u043f\u0440\u0438\u0432\u0430\u0442",
      "\u043f\u043e\u043b\u0438\u0442\u0438\u043a",
    ],
    ["legal", "privacy", "policy", "terms"],
  );
  addSemanticTokenIfIncludes(
    tokens,
    text,
    ["\u0441\u0442\u0440\u0430\u043d\u0438\u0446", "page", "screen", "view"],
    ["page", "screen", "view"],
  );
  addSemanticTokenIfIncludes(
    tokens,
    text,
    [
      "\u043d\u0430\u0432\u0438\u0433\u0430\u0446",
      "navigation",
      "navbar",
      "\u043c\u0435\u043d\u044e",
      "theme",
      "\u0442\u0435\u043c\u0430",
    ],
    ["nav", "navigation", "navbar", "topbar", "header", "menu", "theme"],
  );
  addSemanticTokenIfIncludes(
    tokens,
    text,
    ["\u043a\u043d\u043e\u043f", "button"],
    ["button", "buttons", "actions"],
  );
  addSemanticTokenIfIncludes(
    tokens,
    text,
    ["\u043a\u0430\u0440\u0442\u043e\u0447", "card"],
    ["card", "cards", "item"],
  );
  addSemanticTokenIfIncludes(
    tokens,
    text,
    ["\u0430\u043f\u0438", "api", "endpoint", "route", "service"],
    ["api", "client", "service", "services", "route", "routes"],
  );
  addSemanticTokenIfIncludes(
    tokens,
    text,
    [
      "\u0441\u0435\u0440\u0432\u0435\u0440",
      "server",
      "backend",
      "\u0431\u044d\u043a\u0435\u043d\u0434",
      "\u0431\u0435\u043a\u0435\u043d\u0434",
    ],
    ["server", "backend", "api", "route", "service"],
  );
  addSemanticTokenIfIncludes(
    tokens,
    text,
    ["таблиц", "table"],
    ["table", "row", "rows", "grid"],
  );
  addSemanticTokenIfIncludes(
    tokens,
    text,
    ["спис", "list"],
    ["list", "items", "item", "row", "rows"],
  );
  addSemanticTokenIfIncludes(
    tokens,
    text,
    ["каталог", "catalog"],
    ["catalog", "catalogue", "list", "grid"],
  );
  addSemanticTokenIfIncludes(
    tokens,
    text,
    ["фильтр", "filter"],
    ["filter", "filters", "controls", "select", "dropdown"],
  );
  addSemanticTokenIfIncludes(
    tokens,
    text,
    ["поиск", "search"],
    ["search", "query"],
  );
  addSemanticTokenIfIncludes(
    tokens,
    text,
    ["сорт", "sort"],
    ["sort", "sorting", "order"],
  );
  addSemanticTokenIfIncludes(
    tokens,
    text,
    ["модал", "modal", "dialog"],
    ["modal", "dialog"],
  );
  addSemanticTokenIfIncludes(
    tokens,
    text,
    ["форма", "form", "input", "focus", "фокус"],
    ["form", "input", "field", "focus"],
  );
  addSemanticTokenIfIncludes(
    tokens,
    text,
    ["пользоват", "юзер", "user"],
    ["user", "users", "account", "profile"],
  );
  addSemanticTokenIfIncludes(
    tokens,
    text,
    ["админ", "администратор", "admin", "administrator"],
    ["admin", "administrator", "dashboard"],
  );
  addSemanticTokenIfIncludes(
    tokens,
    text,
    ["релиз", "release", "version", "верс"],
    ["release", "releases", "version", "versions", "changelog"],
  );
  addSemanticTokenIfIncludes(
    tokens,
    text,
    [
      "пустое состояние",
      "empty state",
      "empty",
      "нет данных",
      "ничего не найдено",
    ],
    ["empty", "state", "placeholder"],
  );
  addSemanticTokenIfIncludes(
    tokens,
    text,
    [
      "навигац",
      "navigation",
      "navbar",
      "верхнее меню",
      "меню",
      "theme",
      "account",
      "тема",
      "аккаунт",
    ],
    [
      "nav",
      "navigation",
      "navbar",
      "topbar",
      "header",
      "menu",
      "theme",
      "account",
    ],
  );
  addSemanticTokenIfIncludes(
    tokens,
    text,
    ["кноп", "button"],
    ["button", "buttons", "actions"],
  );
  addSemanticTokenIfIncludes(
    tokens,
    text,
    ["главн", "homepage", "landing"],
    ["home", "homepage", "landing"],
  );
  addSemanticTokenIfIncludes(
    tokens,
    text,
    ["карточ", "card"],
    ["card", "cards", "item"],
  );
  addSemanticTokenIfIncludes(
    tokens,
    text,
    ["api", "апи", "endpoint", "route", "service", "интегр", "подключ"],
    ["api", "client", "service", "services", "route", "routes"],
  );
  addSemanticTokenIfIncludes(
    tokens,
    text,
    ["server", "backend", "бэкенд", "бекенд", "сервер"],
    ["server", "backend", "api", "route", "service"],
  );
  addSemanticTokenIfIncludes(
    tokens,
    text,
    ["database", "db", "schema", "база", "бд"],
    ["db", "database", "schema", "repository"],
  );
  addSemanticTokenIfIncludes(
    tokens,
    text,
    ["логотип", "лого", "logo"],
    ["logo", "brand"],
  );
  addSemanticTokenIfIncludes(tokens, text, ["favicon"], ["favicon", "icon"]);
  addSemanticTokenIfIncludes(
    tokens,
    text,
    ["картин", "изображ", "image", "picture", "photo"],
    ["image", "img", "picture", "photo", "asset", "assets"],
  );
  addSemanticTokenIfIncludes(
    tokens,
    text,
    ["фон", "background"],
    ["background", "hero"],
  );
  addSemanticTokenIfIncludes(
    tokens,
    text,
    ["баннер", "banner", "cover"],
    ["banner", "cover", "hero"],
  );
  addSemanticTokenIfIncludes(
    tokens,
    text,
    [
      "сборк",
      "build",
      "импорт",
      "import",
      "alias",
      "алиас",
      "tsconfig",
      "vite",
      "next",
      "eslint",
    ],
    [
      "package",
      "config",
      "tsconfig",
      "vite",
      "next",
      "eslint",
      "layout",
      "page",
      "app",
    ],
  );
  addSemanticTokenIfIncludes(
    tokens,
    text,
    ["readme", "docs", "инструкц", "запуск", "команды"],
    ["readme", "docs", "package", "config", "env", "docker"],
  );

  return Array.from(tokens);
}

function extractRouteMentions(rawTask: string) {
  const positiveText = getPositiveTaskText(rawTask);
  const routeRegex =
    /(?:^|[\s"'`(\[])(\/[a-zа-яё0-9_@()\[\]-]+(?:\/[a-zа-яё0-9_@()\[\]-]+)*)(?=$|[\s"'`),.;:!?\]])/gi;
  const routes: string[] = [];

  for (const match of positiveText.matchAll(routeRegex)) {
    const route = normalizePath(match[1] ?? "").toLowerCase();
    if (!route || route.includes("//")) continue;
    if (/\.[a-z0-9]+$/i.test(route)) continue;
    routes.push(route);
  }

  return uniqueStrings(routes).slice(0, 8);
}

function getRouteMentionSegments(routeMentions: string[]) {
  return uniqueStrings(
    routeMentions.flatMap((route) =>
      tokenize(route).filter((token) => !BROAD_PATH_TOKENS.has(token)),
    ),
  );
}

interface InventoryRouteCandidate {
  route: string;
  routeSegments: string[];
  evidenceTokens: string[];
  hasPageFile: boolean;
}

function normalizeRouteValue(route: string) {
  const normalized = normalizePath(route).toLowerCase().trim();
  if (!normalized || normalized === "/") return normalized || "/";
  return `/${normalized.replace(/^\/+|\/+$/g, "")}`.replace(/\/+/g, "/");
}

function getRouteSegmentsFromRoute(route: string) {
  return tokenize(route)
    .map((token) => token.replace(/^:/, ""))
    .filter((token) => token.length >= 3 && !BROAD_PATH_TOKENS.has(token));
}

function extractHrefRouteEvidence(text: string) {
  const rows: Array<{ route: string; evidence: string }> = [];
  const patterns = [
    /\b(?:href|to)\s*[:=]\s*["'`]((?:\/[a-zа-яё0-9_@()[\]:.-]+)+)["'`]/gi,
    /<a[^>]+href=["'`]((?:\/[a-zа-яё0-9_@()[\]:.-]+)+)["'`][^>]*>([\s\S]{0,120}?)<\/a>/gi,
    /<Link[^>]+href=["'`]((?:\/[a-zа-яё0-9_@()[\]:.-]+)+)["'`][^>]*>([\s\S]{0,160}?)<\/Link>/gi,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const route = normalizeRouteValue(match[1] ?? "");
      if (!route || route.includes("//") || /\.[a-z0-9]+$/i.test(route))
        continue;
      const start = Math.max(0, (match.index ?? 0) - 90);
      const end = Math.min(
        text.length,
        (match.index ?? 0) + String(match[0] ?? "").length + 90,
      );
      rows.push({
        route,
        evidence: `${text.slice(start, end)} ${match[2] ?? ""}`,
      });
    }
  }

  return rows;
}

function addRouteCandidate(
  map: Map<string, InventoryRouteCandidate>,
  routeValue: string,
  evidenceParts: string[],
  hasPageFile = false,
) {
  const route = normalizeRouteValue(routeValue);
  if (!route || route.includes("//") || /\.[a-z0-9]+$/i.test(route)) return;

  const current = map.get(route) ?? {
    route,
    routeSegments: getRouteSegmentsFromRoute(route),
    evidenceTokens: [],
    hasPageFile: false,
  };

  current.hasPageFile = current.hasPageFile || hasPageFile;
  current.evidenceTokens = uniqueStrings([
    ...current.evidenceTokens,
    ...tokenize(evidenceParts.join(" ")).filter(
      (token) =>
        token.length >= 3 && !NEGATIVE_CONSTRAINT_STOP_WORDS.has(token),
    ),
  ]).slice(0, 80);

  map.set(route, current);
}

function getInventoryRouteCandidates(inventory: ProjectInventory) {
  const map = new Map<string, InventoryRouteCandidate>();

  for (const file of inventory.files) {
    const fileEvidence = [
      file.path,
      file.name,
      file.role,
      file.routePath ?? "",
      ...(file.symbols ?? []),
      ...(file.exports ?? []),
      ...(file.textHints ?? []),
    ];

    if (file.routePath) {
      addRouteCandidate(
        map,
        file.routePath,
        fileEvidence,
        file.role === "page" || file.name.toLowerCase().startsWith("page."),
      );
    }

    const content = [file.contentPreview ?? "", ...(file.textHints ?? [])].join(
      " ",
    );
    for (const row of extractHrefRouteEvidence(content)) {
      addRouteCandidate(
        map,
        row.route,
        [row.evidence, file.path, file.name],
        false,
      );
    }
  }

  return Array.from(map.values()).filter(
    (candidate) => candidate.route !== "/",
  );
}

function routeCandidateMatchesTask(
  candidate: InventoryRouteCandidate,
  taskTokens: string[],
) {
  let score = 0;

  for (const token of taskTokens) {
    if (
      candidate.routeSegments.some(
        (segment) =>
          normalizedTermMatches(segment, token) ||
          normalizedTermMatches(token, segment),
      )
    ) {
      score += 44;
      continue;
    }

    if (
      candidate.evidenceTokens.some(
        (evidence) =>
          normalizedTermMatches(evidence, token) ||
          normalizedTermMatches(token, evidence),
      )
    ) {
      score += 18;
    }
  }

  if (candidate.hasPageFile && score > 0) score += 18;
  return score;
}

function extractNaturalRouteMentions(
  input: SelectTaskFilesInput,
  explicitRoutes: string[],
) {
  const positiveText = getPositiveTaskText(input.rawTask);
  const taskTokens = uniqueStrings(
    tokenize(
      [
        positiveText,
        ...(input.taskIntent?.domainTerms ?? []),
        ...(input.taskIntent?.mentionedEntities ?? []),
        ...(input.taskIntent?.recommendedSearchTerms ?? []),
      ].join(" "),
    ),
  )
    .filter((token) => !WEAK_TASK_TOKENS.has(token))
    .filter((token) => !BROAD_PATH_TOKENS.has(token));

  if (taskTokens.length === 0) return [];

  const hasUnicodePageLanguage =
    /(?:\u0441\u0442\u0440\u0430\u043d\u0438\u0446|\u044d\u043a\u0440\u0430\u043d|\u0440\u0430\u0437\u0434\u0435\u043b|\u0441\u0435\u043a\u0446\u0438|\u0432\u043a\u043b\u0430\u0434\u043a)/i.test(
      positiveText,
    );
  const hasPageLanguage =
    hasUnicodePageLanguage ||
    includesAny(positiveText, [
      "страниц",
      "раздел",
      "route",
      "page",
      "screen",
      "экран",
      "вкладк",
      "секци",
    ]);

  const callbackFlowRequested = includesAny(positiveText, [
    "callback",
    "redirect",
    "return url",
    "oauth callback",
    "auth callback",
    "\u043a\u043e\u043b\u0431\u044d\u043a",
    "\u0440\u0435\u0434\u0438\u0440\u0435\u043a\u0442",
    "\u0432\u043e\u0437\u0432\u0440\u0430\u0442",
    "\u043f\u043e\u0441\u043b\u0435 \u0432\u0445\u043e\u0434\u0430",
  ]);
  const existing = new Set(explicitRoutes.map(normalizeRouteValue));

  return getInventoryRouteCandidates(input.inventory)
    .filter((candidate) => !existing.has(candidate.route))
    .filter(
      (candidate) =>
        callbackFlowRequested ||
        !includesAny(candidate.route, ["callback", "redirect", "return"]),
    )
    .map((candidate) => ({
      candidate,
      score:
        routeCandidateMatchesTask(candidate, taskTokens) +
        (hasPageLanguage ? 10 : 0),
    }))
    .filter((row) => row.score >= 28)
    .sort((a, b) => b.score - a.score)
    .map((row) => row.candidate.route)
    .slice(0, 5);
}

function extractProtectedRouteTermsFromInventory(
  rawTask: string,
  inventory: ProjectInventory,
) {
  const negativeTokens = uniqueStrings(
    tokenize(getNegativeConstraintPhrases(rawTask).join(" ")),
  ).filter((token) => !NEGATIVE_CONSTRAINT_STOP_WORDS.has(token));

  if (negativeTokens.length === 0) return [];
  const negativeText = normalizeForCompare(negativeTokens.join(" "));
  const backendProtectedPhrase = includesAny(negativeText, [
    "backend",
    "server",
    "api",
    "endpoint",
    "service",
    "\u0431\u044d\u043a",
    "\u0431\u0435\u043a",
    "\u0441\u0435\u0440\u0432\u0435\u0440",
    "\u0430\u043f\u0438",
  ]);
  const uiRouteProtectedPhrase = includesAny(negativeText, [
    "page",
    "pages",
    "screen",
    "screens",
    "route",
    "routes",
    "view",
    "views",
    "ui",
    "frontend",
    "component",
    "\u0441\u0442\u0440\u0430\u043d\u0438\u0446",
    "\u044d\u043a\u0440\u0430\u043d",
    "\u0440\u043e\u0443\u0442",
    "\u043c\u0430\u0440\u0448\u0440\u0443\u0442",
    "\u043a\u043e\u043c\u043f\u043e\u043d\u0435\u043d\u0442",
  ]);
  if (backendProtectedPhrase && !uiRouteProtectedPhrase) return [];

  const terms = new Set<string>();
  for (const candidate of getInventoryRouteCandidates(inventory)) {
    const score = routeCandidateMatchesTask(candidate, negativeTokens);
    if (score < 18) continue;

    for (const segment of candidate.routeSegments) terms.add(segment);
    terms.add(candidate.route.replace(/^\//, ""));
  }

  return Array.from(terms).filter(Boolean);
}

function buildTokenContextUncached(input: SelectTaskFilesInput): TokenContext {
  const positiveTaskText = getPositiveTaskText(input.rawTask);
  // Explicit-file extraction already classifies protected/artifact mentions.
  // Use the original task so removing a trailing negative clause cannot also
  // erase the positive target from the same request.
  const explicitResolution = resolveExplicitFileMentions(
    input.rawTask,
    input.inventory,
  );
  const explicitExistingPaths = explicitResolution.existingPaths;
  const explicitMissingPaths = explicitResolution.missingPaths;
  const explicitRouteMentions = extractRouteMentions(input.rawTask);
  const routeMentions = uniqueStrings([
    ...explicitRouteMentions,
    ...extractNaturalRouteMentions(input, explicitRouteMentions),
  ]);
  const routeSegments = getRouteMentionSegments(routeMentions);

  const rawTokens = tokenize(positiveTaskText);
  const semanticTokens = buildSemanticTokens(input);
  const supportedStructuredTargets = (
    input.taskIntent?.structuredIntent?.primaryTargets ?? []
  ).filter((target) => structuredTargetHasTaskSupport(input, target));
  const intentTokens = tokenize(
    [
      ...(input.taskIntent?.domainTerms ?? []),
      ...(input.taskIntent?.mentionedEntities ?? []),
      ...(input.taskIntent?.recommendedSearchTerms ?? []),
      ...supportedStructuredTargets.flatMap((target) => [
        target.value,
        target.path ?? "",
        target.routePath ?? "",
        target.name ?? "",
        target.evidence,
      ]),
      ...(input.taskIntent?.structuredIntent?.positiveActions ?? []),
    ].join(" "),
  ).filter(
    (token) => !extractNegativeConstraintTerms(input.rawTask).includes(token),
  );
  const roleTokens = tokenize(
    [
      input.taskType,
      input.targetTool,
      input.taskIntent?.taskArea ?? "",
      ...(input.taskIntent?.intentTags ?? []),
      ...(input.taskIntent?.fileRoleHints ?? []),
    ].join(" "),
  );

  const strongTokens = uniqueStrings([
    ...rawTokens,
    ...semanticTokens,
    ...intentTokens,
    ...routeSegments,
  ]).filter((token) => {
    if (WEAK_TASK_TOKENS.has(token)) return false;
    if (token.includes("/") || token.includes("\\")) return false;
    if (BROAD_PATH_TOKENS.has(token) && !semanticTokens.includes(token))
      return false;
    return true;
  });

  const broadTokens = uniqueStrings(roleTokens).filter(
    (token) => !strongTokens.includes(token),
  );
  return {
    strongTokens,
    broadTokens,
    explicitExistingPaths,
    explicitMissingPaths,
    routeMentions,
  };
}

function buildTokenContext(input: SelectTaskFilesInput): TokenContext {
  const cached = tokenContextCache.get(input);
  if (cached) return cached;
  const value = buildTokenContextUncached(input);
  tokenContextCache.set(input, value);
  return value;
}

function getPathSegments(pathValue: string) {
  return tokenize(pathValue);
}

function getStrongTokenMatchCount(filePath: string, strongTokens: string[]) {
  const normalizedPath = normalizeForCompare(filePath);
  const pathSegments = getPathSegments(filePath);
  let count = 0;

  for (const token of strongTokens) {
    if (pathSegments.includes(token) || normalizedPath.includes(token))
      count += 1;
  }

  return count;
}

function hasAnyStrongMatch(filePath: string, strongTokens: string[]) {
  return getStrongTokenMatchCount(filePath, strongTokens) > 0;
}

function isClientUiPath(pathValue: string) {
  const filePath = normalizeForCompare(pathValue);
  const fileName = filePath.split("/").pop() ?? filePath;

  if (filePath.startsWith("client/")) return true;
  if (filePath.startsWith("frontend/")) return true;
  if (filePath.startsWith("web/")) return true;

  if (
    filePath.includes("/components/") ||
    filePath.startsWith("src/components/")
  )
    return true;
  if (filePath.includes("/pages/") || filePath.startsWith("src/pages/"))
    return true;
  if (
    filePath.includes("/ui/") ||
    filePath.includes("/styles/") ||
    filePath.includes("/style/")
  )
    return true;

  if (
    [
      "app.tsx",
      "app.jsx",
      "app.js",
      "app.mjs",
      "main.tsx",
      "main.jsx",
      "main.js",
      "index.tsx",
      "index.jsx",
      "index.js",
    ].includes(fileName)
  )
    return true;

  // Treat Next/React app-router files as UI when they are route shell files or TSX/JSX helpers colocated with a route.
  // API route files are excluded by backend checks elsewhere.
  if (
    filePath.startsWith("src/app/") &&
    [
      "page.tsx",
      "page.jsx",
      "layout.tsx",
      "layout.jsx",
      "template.tsx",
      "template.jsx",
      "loading.tsx",
      "loading.jsx",
      "error.tsx",
      "error.jsx",
    ].includes(fileName)
  ) {
    return true;
  }

  if (
    filePath.startsWith("src/app/") &&
    (fileName.endsWith(".tsx") || fileName.endsWith(".jsx")) &&
    !filePath.includes("/api/") &&
    !fileName.startsWith("route.")
  ) {
    return true;
  }

  return false;
}

function isBackendLeaningPath(pathValue: string) {
  const filePath = normalizeForCompare(pathValue);
  return (
    filePath.includes("/server/") ||
    filePath.startsWith("server/") ||
    filePath.includes("/api/") ||
    filePath.includes("/routes/") ||
    filePath.includes("/route") ||
    filePath.includes("/db/") ||
    filePath.includes("/database/") ||
    filePath.includes("/services/") ||
    filePath.includes("/service/") ||
    filePath.includes("/controllers/") ||
    filePath.includes("/electron/") ||
    filePath.endsWith("server.ts") ||
    filePath.endsWith("server.js")
  );
}

function isClientApiBridgePath(pathValue: string) {
  const filePath = normalizeForCompare(pathValue);
  return (
    filePath.endsWith("/api.ts") ||
    filePath.endsWith("/api.js") ||
    filePath.endsWith("/api/client.ts") ||
    filePath.endsWith("/api/client.js") ||
    filePath.endsWith("/api/client.tsx") ||
    filePath.endsWith("/api/client.jsx") ||
    filePath.includes("/lib/api") ||
    filePath.includes("/services/api") ||
    filePath.includes("/cloudapi") ||
    filePath.includes("/clientapi")
  );
}

function isServerSidePath(pathValue: string) {
  const filePath = normalizeForCompare(pathValue);
  return (
    filePath.startsWith("server/") ||
    filePath.includes("/server/") ||
    filePath.startsWith("backend/") ||
    filePath.includes("/backend/")
  );
}

function isClearlyClientSidePath(pathValue: string) {
  const filePath = normalizeForCompare(pathValue);
  if (isServerSidePath(filePath)) return false;

  const clientRoot =
    filePath.startsWith("client/") ||
    filePath.startsWith("frontend/") ||
    filePath.startsWith("web/") ||
    filePath.includes("/renderer/") ||
    filePath.includes("/frontend/") ||
    filePath.includes("/client/");
  if (!clientRoot) return false;

  // Framework API route handlers remain server-side even when colocated under a
  // frontend application tree. Ordinary renderer/frontend API clients do not.
  if (
    /(?:^|\/)app\/api(?:\/|$)/u.test(filePath) ||
    /(?:^|\/)pages\/api(?:\/|$)/u.test(filePath) ||
    /(?:^|\/)api\/route\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)$/u.test(filePath)
  ) {
    return false;
  }

  return true;
}

function isLockFilePath(pathValue: string) {
  const fileName = normalizeForCompare(pathValue).split("/").pop() ?? "";
  return (
    fileName === "package-lock.json" ||
    fileName === "pnpm-lock.yaml" ||
    fileName === "yarn.lock" ||
    fileName === "bun.lockb"
  );
}

function isPackageOrConfigPath(pathValue: string) {
  const filePath = normalizeForCompare(pathValue);
  const fileName = filePath.split("/").pop() ?? filePath;
  return (
    fileName === "package.json" ||
    fileName.startsWith("tsconfig") ||
    fileName.startsWith("jsconfig") ||
    fileName.includes("vite.config") ||
    fileName.includes("next.config") ||
    fileName.includes("eslint.config") ||
    fileName.includes("tailwind.config") ||
    fileName.includes("postcss.config") ||
    fileName.includes("docker-compose") ||
    fileName === "dockerfile" ||
    fileName === ".env.example" ||
    fileName === "env.example"
  );
}

function isSensitiveEnvPath(pathValue: string) {
  const fileName = normalizeForCompare(pathValue).split("/").pop() ?? "";

  if (fileName === ".env") return true;
  if (fileName.startsWith(".env.") && !fileName.includes("example"))
    return true;

  return false;
}

function isSensitivePath(pathValue: string) {
  return isSensitiveEnvPath(pathValue) || isSecretLikePath(pathValue);
}

function isAssetReferenceControllerPath(pathValue: string) {
  const filePath = normalizeForCompare(pathValue);
  const fileName = filePath.split("/").pop() ?? filePath;

  return (
    filePath.endsWith("index.html") ||
    filePath.endsWith("/main.tsx") ||
    filePath.endsWith("/main.jsx") ||
    filePath.endsWith("/main.ts") ||
    filePath.endsWith("/main.js") ||
    filePath.endsWith("/app.tsx") ||
    filePath.endsWith("/app.jsx") ||
    filePath.endsWith("/app.ts") ||
    filePath.endsWith("/app.js") ||
    filePath.endsWith("/layout.tsx") ||
    filePath.endsWith("/layout.jsx") ||
    filePath.endsWith("/layout.ts") ||
    filePath.endsWith("/layout.js") ||
    fileName === "manifest.json" ||
    fileName === "site.webmanifest" ||
    filePath.includes("/layout/") ||
    filePath.includes("/layouts/") ||
    fileName.includes("appshell") ||
    fileName.includes("shell")
  );
}

function isFrontendUiSourceFile(file: ProjectInventoryFile) {
  return (
    file.kind === "source" &&
    isClientUiPath(file.path) &&
    !isClientApiBridgePath(file.path)
  );
}

function isLikelyFullstackUiActionFile(
  file: ProjectInventoryFile,
  input: SelectTaskFilesInput,
) {
  if (!isFrontendUiSourceFile(file)) return false;

  const taskText = normalizeForCompare(buildTaskText(input));
  const fileText = getFileSearchText(file);

  const actionTask = includesAny(taskText, [
    "button",
    "кноп",
    "action",
    "endpoint",
    "server",
    "api",
    "result",
    "результат",
    "show",
    "display",
    "render",
    "вывод",
    "показ",
  ]);
  if (
    actionTask &&
    includesAny(fileText, [
      "page",
      "pages",
      "component",
      "components",
      "actions",
      "button",
      "menu",
      "row",
      "table",
      "list",
      "detail",
      "card",
      "form",
      "modal",
      "api",
      "fetch",
      "axios",
    ])
  )
    return true;

  return includesAny(normalizeForCompare(file.path), [
    "app.tsx",
    "app.jsx",
    "page.tsx",
    "page.jsx",
    "screen",
    "view",
  ]);
}

function scoreFullstackUiSourceCandidate(
  file: ProjectInventoryFile,
  input: SelectTaskFilesInput,
) {
  if (!isFrontendUiSourceFile(file)) return Number.NEGATIVE_INFINITY;

  const taskText = normalizeForCompare(buildTaskText(input));
  const filePath = normalizeForCompare(file.path);
  const fileName = filePath.split("/").pop() ?? filePath;

  let score = 0;

  if (filePath.startsWith("client/src/")) score += 60;
  if (filePath.startsWith("src/pages/") || filePath.includes("/pages/"))
    score += 45;
  if (
    filePath.startsWith("src/components/") ||
    filePath.includes("/components/")
  )
    score += 35;
  if (["app.tsx", "app.jsx"].includes(fileName)) score += 28;

  if (
    includesAny(taskText, [
      "button",
      "кноп",
      "action",
      "endpoint",
      "server",
      "api",
      "result",
      "результат",
      "показывает",
    ])
  ) {
    if (
      includesAny(filePath, [
        "page",
        "pages",
        "component",
        "components",
        "actions",
        "button",
        "menu",
        "row",
        "table",
        "detail",
        "card",
        "form",
        "modal",
      ])
    )
      score += 45;
  }

  const tokenContext = buildTokenContext(input);
  score +=
    getStrongTokenMatchCountForFile(file, tokenContext.strongTokens) * 18;

  if (file.sizeBytes === 0) score -= 80;
  if (file.isLikelyGenerated) score -= 100;
  if (isClientApiBridgePath(file.path)) score -= 100;
  if (file.kind !== "source") score -= 100;

  return score;
}

function isReasonableFullstackUiSourceFile(
  file: ProjectInventoryFile,
  input: SelectTaskFilesInput,
) {
  return scoreFullstackUiSourceCandidate(file, input) >= 20;
}

function isEntryOrFrameworkPath(pathValue: string) {
  const filePath = normalizeForCompare(pathValue);
  return (
    filePath.endsWith("index.html") ||
    filePath.endsWith("/main.tsx") ||
    filePath.endsWith("/main.jsx") ||
    filePath.endsWith("/app.tsx") ||
    filePath.endsWith("/app.jsx") ||
    filePath.endsWith("/layout.tsx") ||
    filePath.endsWith("/layout.jsx") ||
    filePath.endsWith("/page.tsx") ||
    filePath.endsWith("/page.jsx") ||
    filePath.includes("/app/") ||
    filePath.includes("/pages/")
  );
}

function isGeneratedDoNotEditPath(pathValue: string) {
  const filePath = normalizeForCompare(pathValue);
  const fileName = filePath.split("/").pop() ?? filePath;
  return (
    fileName === "next-env.d.ts" ||
    fileName === "vite-env.d.ts" ||
    filePath.includes("/.next/") ||
    filePath.includes("/dist/") ||
    filePath.includes("/build/") ||
    filePath.includes("/coverage/")
  );
}

function isUsefulAssetForTask(
  file: ProjectInventoryFile,
  input: SelectTaskFilesInput,
) {
  const text = normalizeForCompare(buildTaskText(input));
  const filePath = normalizeForCompare(file.path);

  if (includesAny(text, ["favicon"]) && filePath.includes("favicon"))
    return true;
  if (
    includesAny(text, ["logo", "логотип", "лого"]) &&
    includesAny(filePath, ["logo", "brand"])
  )
    return true;
  if (
    includesAny(text, ["icon", "икон"]) &&
    includesAny(filePath, ["icon", "icons", "favicon"])
  )
    return true;
  if (
    includesAny(text, ["banner", "баннер", "cover"]) &&
    includesAny(filePath, ["banner", "cover", "hero"])
  )
    return true;
  if (
    includesAny(text, [
      "image",
      "picture",
      "photo",
      "картин",
      "изображ",
      "фото",
    ]) &&
    file.kind === "asset"
  )
    return true;

  return false;
}

function getKindWeight(
  file: ProjectInventoryFile,
  area: EffectiveTaskArea,
  assetMode: AssetMode,
) {
  if (isLockFilePath(file.path)) return -80;
  if (file.kind === "asset" && assetMode === "none") return -100;

  if (area === "build") {
    if (isPackageOrConfigPath(file.path)) return 60;
    if (isEntryOrFrameworkPath(file.path)) return 36;
    if (file.kind === "source") return 18;
    if (file.kind === "config") return 50;
    if (file.kind === "docs") return 8;
    return 0;
  }

  if (area === "docs") {
    if (file.kind === "docs") return 60;
    if (isPackageOrConfigPath(file.path)) return 48;
    if (file.kind === "config") return 38;
    return 0;
  }

  if (assetMode === "primary") {
    if (file.kind === "asset") return 72;
    if (file.kind === "source") return 30;
    if (file.kind === "style") return 22;
    if (file.kind === "config") return 4;
    return 0;
  }

  if (assetMode === "mixed") {
    if (file.kind === "source") return 42;
    if (file.kind === "style") return 34;
    if (file.kind === "asset") return 18;
    if (file.kind === "config") return 5;
    return 0;
  }

  if (area === "fullstack") {
    if (file.kind === "source") return 38;
    if (file.kind === "style") return 16;
    if (file.kind === "config") return 10;
    if (file.kind === "test") return 8;
    return 0;
  }

  if (area === "ui") {
    if (file.kind === "source") return 34;
    if (file.kind === "style") return 38;
    if (file.kind === "config") return 5;
    if (file.kind === "docs") return 2;
    return 0;
  }

  if (area === "backend") {
    if (file.kind === "source") return 36;
    if (file.kind === "config") return 12;
    if (file.kind === "data") return 4;
    if (file.kind === "docs") return 2;
    return 0;
  }

  if (area === "tests") {
    if (file.kind === "test") return 45;
    if (file.kind === "source") return 28;
    if (file.kind === "config") return 12;
    return 0;
  }

  if (area === "bugfix" || area === "refactor") {
    if (file.kind === "source") return 36;
    if (file.kind === "style") return 14;
    if (file.kind === "test") return 12;
    if (file.kind === "config") return 10;
    return 0;
  }

  if (file.kind === "source") return 28;
  if (file.kind === "style") return 18;
  if (file.kind === "config") return 10;
  if (file.kind === "docs") return 6;
  return 0;
}

function getFileSearchParts(file: ProjectInventoryFile) {
  const identifierParts = [
    file.path,
    file.name,
    ...(file.exports ?? []),
    ...(file.symbols ?? []),
  ].flatMap(tokenizeIdentifierLike);
  return [
    file.path,
    file.name,
    file.extension,
    file.kind,
    file.role,
    file.routePath ?? "",
    ...(file.imports ?? []),
    ...(file.exports ?? []),
    ...(file.symbols ?? []),
    ...(file.textHints ?? []),
    ...identifierParts,
    file.contentPreview ?? "",
  ];
}

function getFileSearchText(file: ProjectInventoryFile) {
  const cached = fileSearchTextCache.get(file);
  if (cached) return cached;
  const value = normalizeForCompare(getFileSearchParts(file).join(" "));
  fileSearchTextCache.set(file, value);
  return value;
}

function normalizedTermMatches(text: string, term: string) {
  const normalizedTerm = normalizeForCompare(term);
  if (!normalizedTerm || normalizedTerm.length < 3) return false;
  if (text.includes(normalizedTerm)) return true;

  // Light stemming for human wording in Russian/English without hardcoding project domains.
  const stem =
    normalizedTerm.length >= 6 ? normalizedTerm.slice(0, 5) : normalizedTerm;
  return stem.length >= 4 && text.includes(stem);
}

function isRouteOrPageLikeFile(file: ProjectInventoryFile) {
  const filePath = normalizeForCompare(file.path);
  const fileName = filePath.split("/").pop() ?? filePath;
  return (
    filePath.includes("/pages/") ||
    filePath.startsWith("src/pages/") ||
    filePath.startsWith("pages/") ||
    filePath.startsWith("src/app/") ||
    fileName === "page.tsx" ||
    fileName === "page.jsx" ||
    fileName === "layout.tsx" ||
    fileName === "layout.jsx"
  );
}

function isGlobalStyleFile(file: ProjectInventoryFile) {
  const filePath = normalizeForCompare(file.path);
  return (
    file.kind === "style" &&
    (filePath.endsWith("globals.css") ||
      filePath.endsWith("global.css") ||
      filePath.endsWith("index.css") ||
      filePath.endsWith("app.css"))
  );
}

function isSystemSeoFile(file: ProjectInventoryFile) {
  const filePath = normalizeForCompare(file.path);
  const fileName = filePath.split("/").pop() ?? filePath;
  return (
    fileName === "robots.ts" ||
    fileName === "robots.js" ||
    fileName === "sitemap.ts" ||
    fileName === "sitemap.js" ||
    fileName === "manifest.json" ||
    fileName === "site.webmanifest" ||
    fileName.startsWith("manifest.") ||
    fileName.startsWith("metadata.")
  );
}

function isSystemSeoRelevantForTask(input: SelectTaskFilesInput) {
  const text = normalizeForCompare(getPositiveTaskText(input.rawTask));
  return includesAny(text, [
    "seo",
    "sitemap",
    "robots",
    "metadata",
    "manifest",
    "indexing",
    "canonical",
    "open graph",
    "opengraph",
    "сео",
    "индексац",
    "робот",
    "сайтмап",
    "карта сайта",
    "метадан",
    "мета-тег",
    "og image",
    "canonical",
  ]);
}

function hasProtectedShellOrGlobalTerms(constraints: TaskConstraints) {
  return constraints.protectedFileTerms.some((term) => {
    const normalized = normalizeForCompare(term);
    return [
      "header",
      "nav",
      "navigation",
      "navbar",
      "topbar",
      "шап",
      "footer",
      "foot",
      "фут",
      "layout",
      "shell",
      "root",
      "global",
      "globals",
      "глобаль",
      "seo",
      "robots",
      "sitemap",
      "metadata",
      "manifest",
      "сео",
    ].some((needle) => normalized.includes(needle));
  });
}

function isAppShellOrEntrypointFile(file: ProjectInventoryFile) {
  const filePath = normalizeForCompare(file.path);
  const fileName = filePath.split("/").pop() ?? filePath;

  return (
    fileName === "layout.tsx" ||
    fileName === "layout.jsx" ||
    fileName === "layout.ts" ||
    fileName === "layout.js" ||
    filePath === "src/index.js" ||
    filePath === "src/index.tsx" ||
    filePath === "src/main.js" ||
    filePath === "src/main.tsx" ||
    filePath === "src/app.js" ||
    filePath === "src/app.jsx" ||
    filePath === "src/app.tsx" ||
    filePath === "app/layout.tsx" ||
    filePath === "app/layout.jsx"
  );
}

function isGenericSharedUiPrimitive(file: ProjectInventoryFile) {
  const filePath = normalizeForCompare(file.path);
  const fileName = filePath.split("/").pop() ?? filePath;

  if (!filePath.includes("/ui/") && !filePath.includes("/shared/"))
    return false;
  return [
    "button",
    "input",
    "textarea",
    "select",
    "checkbox",
    "radio",
    "toast",
    "dropdown",
    "modal",
    "dialog",
    "popover",
    "tooltip",
    "card",
  ].some((part) => fileName.includes(part));
}

function isGlobalStyleRelevantForTask(input: SelectTaskFilesInput) {
  const text = normalizeForCompare(getPositiveTaskText(input.rawTask));
  return includesAny(text, [
    "global style",
    "global styles",
    "globals.css",
    "index.css",
    "app.css",
    "theme",
    "tokens",
    "entire app",
    "whole site",
    "all pages",
    "глобальные стили",
    "общие стили",
    "тема",
    "токены",
    "весь сайт",
    "всё приложение",
    "все страницы",
  ]);
}

function getRouteMatchScore(
  file: ProjectInventoryFile,
  routeMentions: string[],
) {
  if (routeMentions.length === 0) return 0;

  const filePath = normalizeForCompare(file.path);
  const routePath = normalizeForCompare(file.routePath ?? "");
  const fileText = getFileSearchText(file);
  const identifierTokens = new Set([
    ...tokenizeIdentifierLike(file.path),
    ...tokenizeIdentifierLike(file.name),
    ...(file.symbols ?? []).flatMap(tokenizeIdentifierLike),
    ...(file.exports ?? []).flatMap(tokenizeIdentifierLike),
  ]);
  let score = 0;

  for (const route of routeMentions) {
    const normalizedRoute = normalizeForCompare(route).replace(
      /^\/+|\/+$/g,
      "",
    );
    if (!normalizedRoute) continue;
    const routeParts = normalizedRoute.split("/").filter(Boolean);
    const routeTail = routeParts[routeParts.length - 1] ?? normalizedRoute;
    const routeFolderNeedle = `/${routeTail}/`;

    if (
      routePath === `/${normalizedRoute}` ||
      routePath.endsWith(`/${normalizedRoute}`)
    )
      score = Math.max(score, 130);
    if (
      filePath.includes(`/${normalizedRoute}/`) ||
      filePath.endsWith(`/${normalizedRoute}/page.tsx`) ||
      filePath.endsWith(`/${normalizedRoute}/page.jsx`)
    )
      score = Math.max(score, 122);
    if (
      filePath.includes(routeFolderNeedle) &&
      (filePath.endsWith(".tsx") ||
        filePath.endsWith(".jsx") ||
        filePath.endsWith(".ts") ||
        filePath.endsWith(".js"))
    )
      score = Math.max(score, 112);
    if (filePath.includes(routeFolderNeedle)) score = Math.max(score, 88);
    if (
      routeTail.length >= 3 &&
      identifierTokens.has(routeTail) &&
      isPageLikeTargetFile(file)
    )
      score = Math.max(score, 126);
    if (
      routeTail.length >= 3 &&
      (filePath.includes(routeTail) || fileText.includes(routeTail))
    )
      score = Math.max(score, 46);
  }

  return score;
}

function isRouteAwarePrimaryCandidate(
  file: ProjectInventoryFile,
  tokenContext: TokenContext,
) {
  return getRouteMatchScore(file, tokenContext.routeMentions) >= 88;
}

function isRouteScopedTask(
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
  tokenContext: TokenContext,
) {
  return (
    tokenContext.routeMentions.length > 0 &&
    isSpecificPageOrFileTask(input, area)
  );
}

function isDirectRoutePageMatch(
  file: ProjectInventoryFile,
  routeMentions: string[],
) {
  if (routeMentions.length === 0) return false;

  const filePath = normalizeForCompare(file.path);
  const routePath = normalizeForCompare(file.routePath ?? "");
  const fileName = filePath.split("/").pop() ?? filePath;
  const pageLike =
    file.role === "page" ||
    ["page.tsx", "page.jsx", "page.ts", "page.js"].includes(fileName);
  const identifierTokens = new Set([
    ...tokenizeIdentifierLike(file.path),
    ...tokenizeIdentifierLike(file.name),
    ...(file.symbols ?? []).flatMap(tokenizeIdentifierLike),
    ...(file.exports ?? []).flatMap(tokenizeIdentifierLike),
  ]);

  if (!pageLike) return false;

  for (const route of routeMentions) {
    const normalizedRoute = normalizeForCompare(route).replace(
      /^\/+|\/+$/g,
      "",
    );
    if (!normalizedRoute) continue;
    const routeParts = normalizedRoute.split("/").filter(Boolean);
    const routeTail = routeParts[routeParts.length - 1] ?? normalizedRoute;

    if (
      routePath === `/${normalizedRoute}` ||
      routePath.endsWith(`/${normalizedRoute}`)
    )
      return true;
    if (
      filePath.endsWith(`/${normalizedRoute}/page.tsx`) ||
      filePath.endsWith(`/${normalizedRoute}/page.jsx`) ||
      filePath.endsWith(`/${normalizedRoute}/page.ts`) ||
      filePath.endsWith(`/${normalizedRoute}/page.js`)
    )
      return true;
    if (routeParts.length === 1 && identifierTokens.has(routeTail)) return true;
  }

  return false;
}

function isHomePageTask(input: SelectTaskFilesInput) {
  return includesAny(getPositiveTaskText(input.rawTask), [
    "главн",
    "home",
    "homepage",
    "home page",
    "landing",
    "главная",
    "лендинг",
    "main page",
    "root page",
    "index page",
  ]);
}

function isRootPageFile(file: ProjectInventoryFile) {
  const filePath = normalizeForCompare(file.path);
  const routePath = normalizeForCompare(file.routePath ?? "");

  return (
    routePath === "/" ||
    filePath === "src/app/page.tsx" ||
    filePath === "app/page.tsx" ||
    filePath === "src/pages/index.tsx" ||
    filePath === "src/pages/index.jsx" ||
    filePath === "src/pages/index.ts" ||
    filePath === "src/pages/index.js" ||
    filePath === "pages/index.tsx" ||
    filePath === "pages/index.jsx" ||
    filePath === "pages/index.ts" ||
    filePath === "pages/index.js"
  );
}

function isPageLikeTargetFile(file: ProjectInventoryFile) {
  const filePath = normalizeForCompare(file.path);
  const fileName = filePath.split("/").pop() ?? filePath;

  if (
    file.role === "api-route" ||
    ["route.ts", "route.js"].includes(fileName) ||
    filePath.includes("/app/api/")
  ) {
    return false;
  }

  return (
    file.role === "page" ||
    ["page.tsx", "page.jsx", "page.ts", "page.js"].includes(fileName) ||
    Boolean(
      file.routePath &&
      (filePath.includes("/pages/") || filePath.includes("/app/")),
    )
  );
}

function isWeakPageTargetToken(token: string) {
  const normalized = normalizeForCompare(token).replace(
    /^[^a-zа-яё0-9]+|[^a-zа-яё0-9]+$/gi,
    "",
  );
  if (!normalized) return true;
  if (
    WEAK_TASK_TOKENS.has(normalized) ||
    BROAD_PATH_TOKENS.has(normalized) ||
    NEGATIVE_CONSTRAINT_STOP_WORDS.has(normalized)
  )
    return true;

  return [
    "сайт",
    "страниц",
    "компан",
    "клиент",
    "данн",
    "подач",
    "понят",
    "быстро",
    "плохо",
    "формаль",
    "аккурат",
    "выгляд",
    "помог",
    "сдел",
    "нужно",
    "надо",
    "site",
    "client",
    "customer",
    "company",
    "project",
    "projects",
    "workspace",
    "repo",
    "repository",
    "data",
    "info",
    "content",
    "formal",
    "understand",
    "better",
    "improve",
    "improvement",
  ].some((prefix) => normalized.startsWith(prefix));
}

function getPositiveTargetTokens(input: SelectTaskFilesInput) {
  const negativeTerms = new Set(
    extractNegativeConstraintTerms(input.rawTask).map(normalizeForCompare),
  );
  const tokens = uniqueNormalizedTokens(
    tokenize(
      [
        getPositiveTaskText(input.rawTask),
        ...buildSemanticTokens(input),
        ...(input.taskIntent?.domainTerms ?? []),
        ...(input.taskIntent?.mentionedEntities ?? []),
        ...(input.taskIntent?.recommendedSearchTerms ?? []),
        ...(input.taskIntent?.structuredIntent?.primaryTargets ?? []).flatMap(
          (target) => [
            target.value,
            target.path ?? "",
            target.routePath ?? "",
            target.name ?? "",
          ],
        ),
      ].join(" "),
    ),
  );

  return tokens
    .filter((token) => token.length >= 3)
    .filter((token) => !isWeakPageTargetToken(token))
    .filter((token) => !negativeTerms.has(token))
    .filter((token) => !token.includes("/") && !token.includes("\\"))
    .slice(0, 24);
}

function getGroundedPositiveTargetTokens(input: SelectTaskFilesInput) {
  const negativeTerms = new Set(
    extractNegativeConstraintTerms(input.rawTask).map(normalizeForCompare),
  );
  const supportedStructuredTargets = (
    input.taskIntent?.structuredIntent?.primaryTargets ?? []
  ).filter((target) => structuredTargetHasTaskSupport(input, target));
  const tokens = uniqueNormalizedTokens(
    tokenize(
      [
        getPositiveTaskText(input.rawTask),
        ...buildSemanticTokens(input),
        ...supportedStructuredTargets.flatMap((target) => [
          target.value,
          target.path ?? "",
          target.routePath ?? "",
          target.name ?? "",
        ]),
      ].join(" "),
    ),
  );

  return tokens
    .filter((token) => token.length >= 3)
    .filter((token) => !isWeakPageTargetToken(token))
    .filter((token) => !negativeTerms.has(token))
    .filter((token) => !token.includes("/") && !token.includes("\\"))
    .slice(0, 24);
}

function filePartMatchesToken(value: string, token: string) {
  const normalized = normalizeForCompare(value);
  return (
    normalizedTermMatches(normalized, token) ||
    normalizedTermMatches(token, normalized)
  );
}

function countTokenMatchesInValues(
  tokens: string[],
  values: string[],
  weight: number,
) {
  let score = 0;
  let matches = 0;

  for (const token of tokens) {
    if (values.some((value) => filePartMatchesToken(value, token))) {
      score += weight;
      matches += 1;
    }
  }

  return { score, matches };
}

function getFileIdentityConstraintText(file: ProjectInventoryFile) {
  return normalizeForCompare(
    [
      file.path,
      file.name,
      file.extension,
      file.kind,
      file.role,
      file.routePath ?? "",
    ].join(" "),
  );
}

function hasProtectedIdentityTermMatch(
  file: ProjectInventoryFile,
  constraints: TaskConstraints,
  positiveTokens: string[] = [],
) {
  if (constraints.protectedFileTerms.length === 0) return false;
  const fileText = getFileIdentityConstraintText(file);

  return constraints.protectedFileTerms.some((term) => {
    if (!normalizedTermMatches(fileText, term)) return false;

    // If route protection was inferred too broadly from the inventory, do not let it
    // suppress a page that strongly matches the positive task target.
    // Direct path/route constraints still protect unrelated pages because their terms
    // will not be present in positiveTokens.
    return !positiveTokens.some(
      (token) =>
        normalizedTermMatches(term, token) ||
        normalizedTermMatches(token, term),
    );
  });
}

function canUseSemanticPageTargetFile(
  input: SelectTaskFilesInput,
  file: ProjectInventoryFile,
  area: EffectiveTaskArea,
  assetMode: AssetMode,
) {
  const constraints = getTaskConstraints(input);
  const positiveTokens = getPositiveTargetTokens(input);

  if (!isPageLikeTargetFile(file)) return false;
  if (isSensitivePath(file.path)) return false;
  if (isSystemSeoFile(file) && !isSystemSeoRelevantForTask(input)) return false;
  if (file.kind === "runtime" || file.kind === "asset" || file.kind === "data")
    return false;
  if (file.isLikelyGenerated) return false;
  if (isGeneratedDoNotEditPath(file.path) && area !== "build") return false;
  if (isLockFilePath(file.path)) return false;
  if (file.sizeBytes === 0) return false;
  // For page-target discovery, only protect by stable identity: path/name/route.
  // A valid page may contain links to forbidden pages such as contacts/policy,
  // and those links must not make the current page forbidden.
  if (hasProtectedIdentityTermMatch(file, constraints, positiveTokens))
    return false;

  if (
    hasProtectedShellOrGlobalTerms(constraints) &&
    isAppShellOrEntrypointFile(file)
  )
    return false;
  if (
    constraints.protectedFileTerms.some((term) =>
      [
        "style",
        "styles",
        "css",
        "стил",
        "global",
        "globals",
        "глобаль",
      ].includes(normalizeForCompare(term)),
    ) &&
    isGlobalStyleFile(file)
  ) {
    return false;
  }

  if (
    area === "backend" &&
    isClientUiPath(file.path) &&
    !isClientApiBridgePath(file.path)
  )
    return false;
  if (area === "ui" && isServerSidePath(file.path) && !file.routePath)
    return false;

  return true;
}

function getPageSemanticMatchScoreUncached(
  file: ProjectInventoryFile,
  input: SelectTaskFilesInput,
  tokenContext = buildTokenContext(input),
) {
  if (!isPageLikeTargetFile(file)) return 0;
  if (isSystemSeoFile(file)) return 0;

  const positiveTokens = getPositiveTargetTokens(input);
  if (positiveTokens.length === 0) return 0;

  const filePath = normalizeForCompare(file.path);
  const routePath = normalizeForCompare(file.routePath ?? "");
  const routeSegments = tokenize(routePath).filter(
    (token) => !BROAD_PATH_TOKENS.has(token),
  );
  const pathSegments = uniqueStrings([
    ...tokenize(file.path),
    ...tokenizeIdentifierLike(file.path),
    ...tokenizeIdentifierLike(file.name),
  ]).filter((token) => !BROAD_PATH_TOKENS.has(token));
  const symbolValues = [
    ...(file.symbols ?? []),
    ...(file.exports ?? []),
    ...(file.symbols ?? []).flatMap(tokenizeIdentifierLike),
    ...(file.exports ?? []).flatMap(tokenizeIdentifierLike),
  ];
  const hintValues = file.textHints ?? [];
  const previewText = file.contentPreview ?? "";
  const concreteLocationTokens = getConcretePageLocationTokens(input);

  let score = 0;
  let matchedSignals = 0;
  let semanticMatches = 0;

  const routeMatch = countTokenMatchesInValues(
    positiveTokens,
    [...routeSegments, routePath],
    56,
  );
  score += routeMatch.score;
  matchedSignals += routeMatch.matches;

  const pathMatch = countTokenMatchesInValues(
    positiveTokens,
    [...pathSegments, filePath],
    32,
  );
  score += pathMatch.score;
  matchedSignals += pathMatch.matches;

  const hintMatch = countTokenMatchesInValues(positiveTokens, hintValues, 44);
  score += hintMatch.score;
  matchedSignals += hintMatch.matches;
  semanticMatches += hintMatch.matches;

  const symbolMatch = countTokenMatchesInValues(
    positiveTokens,
    symbolValues,
    28,
  );
  score += symbolMatch.score;
  matchedSignals += symbolMatch.matches;
  semanticMatches += symbolMatch.matches;

  if (concreteLocationTokens.length > 0) {
    const locationIdentityValues = [
      filePath,
      file.name,
      routePath,
      ...routeSegments,
      ...pathSegments,
      ...symbolValues,
      ...hintValues,
    ];
    const locationMatch = countTokenMatchesInValues(
      concreteLocationTokens,
      locationIdentityValues,
      72,
    );
    score += locationMatch.score;
    matchedSignals += locationMatch.matches;
    semanticMatches += locationMatch.matches;

    if (locationMatch.matches > 0) {
      score += 54;
    } else if (isSingularConcretePageRequest(input)) {
      score -= 90;
    }
  }

  for (const token of positiveTokens) {
    if (filePartMatchesToken(previewText, token)) {
      score += 26;
      matchedSignals += 1;
      semanticMatches += 1;
    }
  }

  const hasUnicodePageLanguage =
    /(?:\u0441\u0442\u0440\u0430\u043d\u0438\u0446|\u044d\u043a\u0440\u0430\u043d|\u0440\u0430\u0437\u0434\u0435\u043b|\u0441\u0435\u043a\u0446\u0438|\u0432\u043a\u043b\u0430\u0434\u043a)/i.test(
      getPositiveTaskText(input.rawTask),
    );
  const hasPageLanguage =
    hasUnicodePageLanguage ||
    includesAny(getPositiveTaskText(input.rawTask), [
      "страниц",
      "страница",
      "страницу",
      "странице",
      "раздел",
      "секци",
      "экран",
      "page",
      "route",
      "screen",
      "section",
      "view",
    ]);

  if (hasPageLanguage && matchedSignals > 0) score += 34;
  if (semanticMatches >= 1 && matchedSignals >= 1) score += 28;
  if (matchedSignals >= 2) score += 26;
  if (semanticMatches >= 2) score += 22;
  if (file.role === "page") score += 18;
  if (file.routePath) score += 14;

  const callbackFlowRequested = includesAny(
    getPositiveTaskText(input.rawTask),
    [
      "callback",
      "redirect",
      "return url",
      "oauth callback",
      "auth callback",
      "\u043a\u043e\u043b\u0431\u044d\u043a",
      "\u0440\u0435\u0434\u0438\u0440\u0435\u043a\u0442",
      "\u0432\u043e\u0437\u0432\u0440\u0430\u0442",
      "\u043f\u043e\u0441\u043b\u0435 \u0432\u0445\u043e\u0434\u0430",
    ],
  );
  if (
    !callbackFlowRequested &&
    includesAny(
      [
        file.path,
        file.name,
        file.routePath ?? "",
        ...(file.symbols ?? []),
        ...(file.exports ?? []),
      ].join(" "),
      ["callback", "redirect", "return"],
    )
  ) {
    score -= 220;
  }

  if (isRootPageFile(file) && isHomePageTask(input)) {
    score += 220;
  } else if (isRootPageFile(file) && !isHomePageTask(input)) {
    score -= 160;
  }

  return score;
}

function taskAllowsMultipleConcretePageTargets(
  input: SelectTaskFilesInput,
  tokenContext: TokenContext,
) {
  if (
    matchesAny(getPositiveTaskText(input.rawTask), [
      /\b(?:on\s+the\s+page|on\s+page|screen|view)\b/i,
      /(?:\u043d\u0430\s+\u0441\u0442\u0440\u0430\u043d\u0438\u0446(?:\u0443|\u0435)|\u043d\u0430\s+\u044d\u043a\u0440\u0430\u043d(?:\u0435)?|\u0432\s+\u0440\u0430\u0437\u0434\u0435\u043b\u0435)/i,
    ]) &&
    !matchesAny(getPositiveTaskText(input.rawTask), [
      /\b(?:pages|routes|screens|views|both|several|multiple)\b/i,
      /(?:\u0441\u0442\u0440\u0430\u043d\u0438\u0446(?:\u044b|\u0430\u0445|\u0430\u043c\u0438)|\u044d\u043a\u0440\u0430\u043d(?:\u044b|\u0430\u0445|\u0430\u043c\u0438)|\u0440\u0430\u0437\u0434\u0435\u043b(?:\u044b|\u0430\u0445|\u0430\u043c\u0438)|\u043e\u0431\u0435|\u043e\u0431\u0430|\u043d\u0435\u0441\u043a\u043e\u043b\u044c\u043a)/i,
    ])
  ) {
    return false;
  }

  if (tokenContext.routeMentions.length > 1) return true;
  if (
    getStructuredIntentTargets(input).filter(
      (target) => target.kind === "page" || target.kind === "route",
    ).length > 1
  )
    return true;

  return matchesAny(getPositiveTaskText(input.rawTask), [
    /\b(?:pages|routes|screens|views|both|several|multiple)\b/i,
    /(?:\u0441\u0442\u0440\u0430\u043d\u0438\u0446(?:\u044b|\u0430\u0445|\u0430\u043c\u0438)|\u044d\u043a\u0440\u0430\u043d(?:\u044b|\u0430\u0445|\u0430\u043c\u0438)|\u0440\u0430\u0437\u0434\u0435\u043b(?:\u044b|\u0430\u0445|\u0430\u043c\u0438)|\u043e\u0431\u0435|\u043e\u0431\u0430|\u043d\u0435\u0441\u043a\u043e\u043b\u044c\u043a)/i,
  ]);
}

function isSingularConcretePageRequest(input: SelectTaskFilesInput) {
  const text = normalizeForCompare(getPositiveTaskText(input.rawTask));
  return includesAny(text, [
    "on the page",
    "on page",
    "this page",
    "screen",
    "this screen",
    "на страницу",
    "на странице",
    "экране",
    "на экран",
    "в разделе",
    "этот раздел",
  ]);
}

function getPageSemanticMatchScore(
  file: ProjectInventoryFile,
  input: SelectTaskFilesInput,
  tokenContext = buildTokenContext(input),
) {
  let scores = pageSemanticScoreCache.get(input);
  if (!scores) {
    scores = new Map<string, number>();
    pageSemanticScoreCache.set(input, scores);
  }
  const key = normalizeForCompare(file.path);
  const cached = scores.get(key);
  if (cached !== undefined) return cached;
  const value = getPageSemanticMatchScoreUncached(file, input, tokenContext);
  scores.set(key, value);
  return value;
}

function getConcretePageTargetLimit(
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
  tokenContext: TokenContext,
) {
  if (!isSpecificPageOrFileTask(input, area)) return 2;
  if (isSingularConcretePageRequest(input)) return 1;
  return taskAllowsMultipleConcretePageTargets(input, tokenContext) ? 2 : 1;
}

function getSemanticPageTargetCandidates(
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
  assetMode: AssetMode,
  tokenContext: TokenContext,
  selected: SelectedTaskFile[],
) {
  if (!isSpecificPageOrFileTask(input, area)) return [];

  const seen = new Set(selected.map((file) => normalizeForCompare(file.path)));

  return input.inventory.files
    .filter((file) => !seen.has(normalizeForCompare(file.path)))
    .filter((file) => isPageLikeTargetFile(file))
    .filter((file) => !isRootPageFile(file) || isHomePageTask(input))
    .filter((file) =>
      canUseSemanticPageTargetFile(input, file, area, assetMode),
    )
    .map((file) => ({
      file,
      score: getPageSemanticMatchScore(file, input, tokenContext),
    }))
    .filter((item) => item.score >= 82)
    .sort((a, b) => b.score - a.score)
    .slice(0, getConcretePageTargetLimit(input, area, tokenContext));
}

function isConditionalCreateOrEditTargetTask(input: SelectTaskFilesInput) {
  const text = normalizeForCompare(
    [
      getPositiveTaskText(input.rawTask),
      ...(input.taskIntent?.structuredIntent?.positiveActions ?? []),
      ...(input.taskIntent?.structuredIntent?.modelNotes ?? []),
    ].join(" "),
  );

  const hasConditionalLanguage =
    matchesAny(text, [
      /\bif\s+(?:it|this|that|such\s+page|such\s+screen|the\s+page|the\s+screen)?[^.!?\n]{0,80}\b(?:exists?|already\s+exists?)\b/i,
      /\bif\s+not[^.!?\n]{0,80}\b(?:create|add|make|build)\b/i,
      /\b(?:create|add|make|build)[^.!?\n]{0,80}\bif\s+(?:it\s+)?(?:does\s+not|doesn't|doesnt)\s+exist\b/i,
      /(?:\u0435\u0441\u043b\u0438)[^.!?\n]{0,80}(?:\u0443\u0436\u0435\s+)?(?:\u0435\u0441\u0442\u044c|\u0441\u0443\u0449\u0435\u0441\u0442\u0432)/i,
      /(?:\u0435\u0441\u043b\u0438\s+\u043d\u0435\u0442|\u0435\u0441\u043b\u0438\s+\u043d\u0435\s+\u0441\u0443\u0449\u0435\u0441\u0442\u0432)[^.!?\n]{0,80}(?:\u0441\u043e\u0437\u0434|\u0434\u043e\u0431\u0430\u0432|\u0441\u0434\u0435\u043b)/i,
    ]) ||
    (includesAny(text, [
      "if exists",
      "if it exists",
      "already exists",
      "if not",
      "если есть",
      "если нет",
      "уже есть",
    ]) &&
      includesAny(text, [
        "create",
        "add",
        "make",
        "build",
        "созда",
        "добав",
        "сдел",
      ]) &&
      includesAny(text, [
        "improve",
        "update",
        "edit",
        "change",
        "улучш",
        "измени",
        "обнов",
      ]));

  if (!hasConditionalLanguage) return false;

  return includesAny(text, [
    "page",
    "screen",
    "route",
    "view",
    "surface",
    "страниц",
    "экран",
    "роут",
    "маршрут",
    "раздел",
  ]);
}

function getConditionalTargetReviewCandidates(
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
  assetMode: AssetMode,
  tokenContext: TokenContext,
) {
  if (!isConditionalCreateOrEditTargetTask(input)) return [];
  if (tokenContext.explicitExistingPaths.length > 0) return [];
  if (
    tokenContext.explicitMissingPaths.some((pathValue) =>
      isSafePlannedCreatePath(pathValue),
    )
  )
    return [];
  if (extractRouteMentions(input.rawTask).length > 0) return [];
  if (
    getStructuredIntentTargets(input).some(
      (target) => target.path || target.routePath,
    )
  )
    return [];

  return input.inventory.files
    .filter((file) => isPageLikeTargetFile(file))
    .filter((file) => !isRootPageFile(file) || isHomePageTask(input))
    .filter((file) =>
      canUseSemanticPageTargetFile(input, file, area, assetMode),
    )
    .map((file) => ({
      file,
      score: getPageSemanticMatchScore(file, input, tokenContext),
    }))
    .filter((item) => item.score >= 48)
    .sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path))
    .slice(0, 5);
}

function hasSelectedConcretePageTarget(
  selected: SelectedTaskFile[],
  inventory: ProjectInventory,
) {
  return selected.some((selectedFile) => {
    const inventoryFile = findInventoryFile(inventory, selectedFile.path);
    return Boolean(inventoryFile && isPageLikeTargetFile(inventoryFile));
  });
}

function getSelectedConcretePageTargets(
  selected: SelectedTaskFile[],
  inventory: ProjectInventory,
) {
  return selected
    .map((selectedFile) => findInventoryFile(inventory, selectedFile.path))
    .filter((file): file is ProjectInventoryFile =>
      Boolean(file && isPageLikeTargetFile(file)),
    );
}

function getStrongConcretePageTargetsFromInventory(
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
  assetMode: AssetMode,
  tokenContext: TokenContext,
) {
  return input.inventory.files
    .filter((file) =>
      canUseSemanticPageTargetFile(input, file, area, assetMode),
    )
    .map((file) => ({
      file,
      score: getPageSemanticMatchScore(file, input, tokenContext),
    }))
    .filter(
      (item) =>
        item.score >= 82 ||
        hasStrongDomainPageIdentityEvidence(
          item.file,
          input,
          area,
          tokenContext,
        ),
    )
    .sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path))
    .slice(0, 6)
    .map((item) => item.file);
}

function getPrimaryConcretePageTargets(
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
  tokenContext: TokenContext,
  pageTargets: ProjectInventoryFile[],
) {
  const seen = new Set<string>();
  const uniqueTargets = pageTargets.filter((file) => {
    const key = normalizeForCompare(file.path);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return uniqueTargets
    .map((file) => {
      const explicitBoost = tokenContext.explicitExistingPaths.some(
        (pathValue) =>
          normalizeForCompare(pathValue) === normalizeForCompare(file.path),
      )
        ? 600
        : 0;
      const routeBoost = isDirectRoutePageMatch(
        file,
        tokenContext.routeMentions,
      )
        ? 420
        : getRouteMatchScore(file, tokenContext.routeMentions);
      return {
        file,
        score:
          explicitBoost +
          routeBoost +
          getPageSemanticMatchScore(file, input, tokenContext),
      };
    })
    .sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path))
    .slice(0, getConcretePageTargetLimit(input, area, tokenContext))
    .map((item) => item.file);
}

function scopeSelectionToPrimaryPageTargets(
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
  assetMode: AssetMode,
  selected: SelectedTaskFile[],
) {
  if (!isSpecificPageOrFileTask(input, area)) return selected;

  const tokenContext = buildTokenContext(input);
  const pageTargets = getSelectedConcretePageTargets(selected, input.inventory);
  if (pageTargets.length === 0) return selected;

  const primaryPageTargets = getPrimaryConcretePageTargets(
    input,
    area,
    tokenContext,
    pageTargets,
  );
  if (
    primaryPageTargets.length === 0 ||
    primaryPageTargets.length === pageTargets.length
  )
    return selected;

  const primaryPagePaths = new Set(
    primaryPageTargets.map((file) => normalizeForCompare(file.path)),
  );
  const pageScopedSelected = selected.filter((file) => {
    const inventoryFile = findInventoryFile(input.inventory, file.path);
    return Boolean(
      inventoryFile &&
      isPageLikeTargetFile(inventoryFile) &&
      primaryPagePaths.has(normalizeForCompare(inventoryFile.path)),
    );
  });
  for (const pageTarget of primaryPageTargets) {
    if (
      !pageScopedSelected.some(
        (file) =>
          normalizeForCompare(file.path) ===
          normalizeForCompare(pageTarget.path),
      )
    ) {
      pageScopedSelected.push(
        makeSelectedFile(
          pageTarget,
          "Selected as the strongest concrete page target after validating route/page semantics against the real inventory.",
          0.9,
          defaultUsageForFile(pageTarget),
        ),
      );
    }
  }

  pageScopedSelected.push(
    ...getImportedReferenceFilesForPageTargets(
      input,
      primaryPageTargets,
      area,
      assetMode,
      pageScopedSelected,
    ),
  );
  return pageScopedSelected;
}

function scopeFullstackSelectionToPrimaryUiTargets(
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
  selected: SelectedTaskFile[],
) {
  if (area !== "fullstack") return selected;

  const tokenContext = buildTokenContext(input);
  const pageTargets = getSelectedConcretePageTargets(selected, input.inventory);
  if (pageTargets.length <= 1) return selected;

  const primaryPageTargets = getPrimaryConcretePageTargets(
    input,
    "ui",
    tokenContext,
    pageTargets,
  );
  if (
    primaryPageTargets.length === 0 ||
    primaryPageTargets.length === pageTargets.length
  )
    return selected;

  const primaryPagePaths = new Set(
    primaryPageTargets.map((file) => normalizeForCompare(file.path)),
  );
  return selected.filter((selectedFile) => {
    const inventoryFile = findInventoryFile(input.inventory, selectedFile.path);
    if (!inventoryFile) return true;
    if (!isPageLikeTargetFile(inventoryFile)) return true;
    return primaryPagePaths.has(normalizeForCompare(inventoryFile.path));
  });
}

function resolveImportToInventoryFile(
  sourceFile: ProjectInventoryFile,
  importPath: string,
  inventory: ProjectInventory,
) {
  const rawImport = normalizePath(importPath).trim();
  if (!rawImport || rawImport.startsWith("node:")) return undefined;
  if (
    /^[a-z0-9@][a-z0-9_.-]*(?:\/|$)/i.test(rawImport) &&
    !rawImport.startsWith("@/")
  )
    return undefined;

  const sourceDir = sourceFile.path.split("/").slice(0, -1).join("/");
  let basePath = "";

  if (rawImport.startsWith("@/")) {
    basePath = `src/${rawImport.slice(2)}`;
  } else if (rawImport.startsWith("./") || rawImport.startsWith("../")) {
    const stack: string[] = sourceDir.split("/").filter(Boolean);
    for (const part of rawImport.split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") stack.pop();
      else stack.push(part);
    }
    basePath = stack.join("/");
  } else {
    return undefined;
  }

  const normalizedBase = normalizeForCompare(basePath).replace(
    /\.(tsx|jsx|ts|js|mjs|cjs|css|scss|sass|less)$/i,
    "",
  );
  const candidatePaths = [
    basePath,
    `${normalizedBase}.tsx`,
    `${normalizedBase}.jsx`,
    `${normalizedBase}.ts`,
    `${normalizedBase}.js`,
    `${normalizedBase}.css`,
    `${normalizedBase}.scss`,
    `${normalizedBase}/index.tsx`,
    `${normalizedBase}/index.jsx`,
    `${normalizedBase}/index.ts`,
    `${normalizedBase}/index.js`,
  ].map(normalizeForCompare);

  return inventory.files.find((file) =>
    candidatePaths.includes(normalizeForCompare(file.path)),
  );
}

function getImportedReferenceFilesForPageTargets(
  input: SelectTaskFilesInput,
  pageTargets: ProjectInventoryFile[],
  area: EffectiveTaskArea,
  assetMode: AssetMode,
  selected: SelectedTaskFile[],
) {
  const seen = new Set(selected.map((file) => normalizeForCompare(file.path)));
  const references: SelectedTaskFile[] = [];
  const semanticGraph = buildProjectSemanticGraph(input.inventory);
  const graphSupport = semanticGraph.getSupportFiles(
    pageTargets.map((page) => page.path),
    { includeRouteLocal: true, maxPerTarget: 6 },
  );

  const usableGraphSupport = graphSupport
    .map(({ file: imported, edge }) => {
      const page =
        pageTargets.find(
          (target) =>
            normalizeForCompare(target.path) === normalizeForCompare(edge.from),
        ) ?? pageTargets[0];
      if (!page) return undefined;
      if (!canUsePageImportFile(input, page, imported, area)) return undefined;
      if (
        isAppShellOrEntrypointFile(imported) ||
        isGlobalStyleFile(imported) ||
        isSystemSeoFile(imported)
      )
        return undefined;
      if (isServerSidePath(imported.path) && area === "ui") return undefined;

      return {
        edge,
        imported,
        page,
        usage: getPageImportUsage(input, page, imported),
      };
    })
    .filter(Boolean) as Array<{
    edge: ReturnType<typeof semanticGraph.getSupportFiles>[number]["edge"];
    imported: ProjectInventoryFile;
    page: ProjectInventoryFile;
    usage: SelectedTaskFileUsage;
  }>;

  usableGraphSupport.sort((left, right) => {
    const score = (item: (typeof usableGraphSupport)[number]) => {
      let value = item.usage === "inspect-and-edit" ? 40 : 10;
      if (item.edge.kind === "component-import") value += 16;
      if (item.edge.kind === "style-import") value += 12;
      if (isBehaviorOrStateSupportFile(item.imported)) value -= 8;
      if (isGenericSharedUiPrimitive(item.imported)) value -= 6;
      return value;
    };

    return score(right) - score(left);
  });

  for (const { file: imported, edge, page, usage } of usableGraphSupport.map(
    (item) => ({
      file: item.imported,
      edge: item.edge,
      page: item.page,
      usage: item.usage,
    }),
  )) {
    if (references.length >= 5) return references;
    const normalized = normalizeForCompare(imported.path);
    if (seen.has(normalized)) continue;

    references.push(
      makeSelectedFile(
        imported,
        usage === "inspect-and-edit"
          ? `Semantic graph support for selected page target ${page.path} via ${edge.kind}; matched the requested page scope.`
          : `Semantic graph support for selected page target ${page.path} via ${edge.kind}; inspect-only supporting context, not the primary edit target.`,
        usage === "inspect-and-edit"
          ? 0.76
          : isGenericSharedUiPrimitive(imported)
            ? 0.62
            : 0.68,
        usage,
      ),
    );
    seen.add(normalized);
  }

  return references;
}

function getSemanticSupportFilesForSelectedTargets(
  input: SelectTaskFilesInput,
  selected: SelectedTaskFile[],
  area: EffectiveTaskArea,
  assetMode: AssetMode,
) {
  const selectedPaths = new Set(
    selected.map((file) => normalizeForCompare(file.path)),
  );
  const targetFiles = selected
    .filter(
      (file) =>
        file.usage === "inspect-and-edit" || file.usage === "create-and-edit",
    )
    .map((selectedFile) =>
      input.inventory.files.find(
        (file) =>
          normalizeForCompare(file.path) ===
          normalizeForCompare(selectedFile.path),
      ),
    )
    .filter(Boolean) as ProjectInventoryFile[];

  if (targetFiles.length === 0) return [];

  const semanticGraph = buildProjectSemanticGraph(input.inventory);
  const graphSupport = semanticGraph.getSupportFiles(
    targetFiles.map((file) => file.path),
    {
      includeImportedBy: area === "tests",
      includeRouteLocal: true,
      maxPerTarget: 8,
    },
  );
  const supportFiles: SelectedTaskFile[] = [];

  for (const { file, edge } of graphSupport) {
    if (supportFiles.length >= 8) break;
    const normalizedPath = normalizeForCompare(file.path);
    if (selectedPaths.has(normalizedPath)) continue;
    if (!canUseSelectedFile(input, file, area, assetMode)) continue;
    if (isAppShellOrEntrypointFile(file) && area !== "build") continue;
    if (isSystemSeoFile(file) && !isSystemSeoRelevantForTask(input)) continue;
    if (area === "ui" && isServerSidePath(file.path)) continue;

    const target = targetFiles.find(
      (targetFile) =>
        normalizeForCompare(targetFile.path) === normalizeForCompare(edge.from),
    );
    const usage = getSemanticSupportUsage(input, file, edge.kind, area);
    const confidence =
      usage === "inspect-and-edit"
        ? 0.76
        : file.kind === "config"
          ? 0.66
          : 0.62;

    supportFiles.push(
      makeSelectedFile(
        file,
        usage === "inspect-and-edit"
          ? `Semantic graph support for selected target ${target?.path ?? edge.from} via ${edge.kind}; marked editable because the task domain matches this related implementation layer.`
          : `Semantic graph support for selected target ${target?.path ?? edge.from} via ${edge.kind}; inspect-only supporting context, not the primary edit target.`,
        confidence,
        usage,
      ),
    );
    selectedPaths.add(normalizedPath);
  }

  return supportFiles;
}

function getSemanticSupportUsage(
  input: SelectTaskFilesInput,
  file: ProjectInventoryFile,
  edgeKind: string,
  area: EffectiveTaskArea,
): SelectedTaskFileUsage {
  if (file.kind === "asset") return "asset-reference";
  if (file.kind === "config") return "config-reference";
  if (isReviewProposeOnlyTask(input)) return "inspect-only";

  if (area === "docs") {
    return file.kind === "docs" ? "inspect-and-edit" : "inspect-only";
  }

  if (area === "tests") {
    if (file.kind === "test" || edgeKind === "proposed-test") {
      return "inspect-and-edit";
    }
    return "inspect-only";
  }

  if (area === "ui") {
    if (
      edgeKind === "component-import" ||
      edgeKind === "style-import" ||
      edgeKind === "route-local"
    ) {
      return "inspect-only";
    }
    return "inspect-only";
  }

  if (area === "backend" || area === "fullstack") {
    if (isClientUiPath(file.path) && !isClientApiBridgePath(file.path)) {
      return "inspect-only";
    }
    if (
      [
        "service-import",
        "storage-import",
        "types-import",
        "route-local",
      ].includes(edgeKind) &&
      hasDomainSpecificFallbackEvidence(file, input)
    ) {
      return "inspect-and-edit";
    }
    return "inspect-only";
  }

  return "inspect-only";
}

function isRouteLocalPageImport(
  page: ProjectInventoryFile,
  imported: ProjectInventoryFile,
) {
  const pageDir = normalizeForCompare(page.path)
    .split("/")
    .slice(0, -1)
    .join("/");
  const importedPath = normalizeForCompare(imported.path);
  return Boolean(pageDir && importedPath.startsWith(`${pageDir}/`));
}

function canUsePageImportFile(
  input: SelectTaskFilesInput,
  page: ProjectInventoryFile,
  imported: ProjectInventoryFile,
  area: EffectiveTaskArea,
) {
  if (isSensitivePath(imported.path)) return false;
  if (isSystemSeoFile(imported) && !isSystemSeoRelevantForTask(input))
    return false;
  if (
    imported.kind === "runtime" ||
    imported.kind === "asset" ||
    imported.kind === "data"
  )
    return false;
  if (imported.isLikelyGenerated) return false;
  if (isGeneratedDoNotEditPath(imported.path) && area !== "build") return false;
  if (isLockFilePath(imported.path)) return false;
  if (imported.sizeBytes === 0) return false;
  if (area === "ui" && isServerSidePath(imported.path)) return false;

  const constraints = getTaskConstraints(input);
  if (
    constraints.noBackendMutation &&
    isBackendOrAuthProtectedSupportFile(imported)
  )
    return false;

  const routeLocal = isRouteLocalPageImport(page, imported);
  if (routeLocal) return true;

  return !hasProtectedIdentityTermMatch(
    imported,
    constraints,
    getPositiveTargetTokens(input),
  );
}

function getPageImportUsage(
  input: SelectTaskFilesInput,
  page: ProjectInventoryFile,
  imported: ProjectInventoryFile,
): SelectedTaskFileUsage {
  if (isGenericSharedUiPrimitive(imported)) return "inspect-only";
  if (imported.kind !== "source" && imported.kind !== "style")
    return "inspect-only";
  if (isVisualOnlyUiTask(input) && isBehaviorOrStateSupportFile(imported))
    return "inspect-only";
  if (
    getTaskConstraints(input).noBackendMutation &&
    isBackendOrAuthProtectedSupportFile(imported)
  )
    return "inspect-only";
  if (isRouteLocalPageImport(page, imported)) return "inspect-and-edit";

  const positiveTokens = getPositiveTargetTokens(input);
  if (positiveTokens.length === 0) return "inspect-only";

  const importedText = normalizeForCompare(
    [
      imported.path,
      imported.name,
      imported.role,
      imported.routePath ?? "",
      ...(imported.symbols ?? []),
      ...(imported.exports ?? []),
      ...(imported.textHints ?? []),
    ].join(" "),
  );

  return positiveTokens.some(
    (token) =>
      normalizedTermMatches(importedText, token) ||
      normalizedTermMatches(token, importedText),
  )
    ? "inspect-and-edit"
    : "inspect-only";
}

function isVisualOnlyUiTask(input: SelectTaskFilesInput) {
  const positiveText = getPositiveTaskText(input.rawTask);
  const text = normalizeForCompare(
    [
      positiveText,
      input.taskType,
      ...(input.taskIntent?.intentTags ?? []),
      ...(input.taskIntent?.domainTerms ?? []),
      ...(input.taskIntent?.structuredIntent?.positiveActions ?? []),
    ].join(" "),
  );
  const behaviorText = normalizeForCompare(
    [
      positiveText,
      input.taskType,
      ...(input.taskIntent?.structuredIntent?.positiveActions ?? []),
    ].join(" "),
  );
  const hasUiSurface =
    hasRuntimeUiSurfaceTerm(positiveText) ||
    includesAny(text, [
      "ui",
      "ux",
      "frontend",
      "page",
      "screen",
      "view",
      "component",
      "card",
      "badge",
      "badges",
      "chip",
      "chips",
      "layout",
      "visual",
      "style",
      "css",
      "copy",
      "text",
      "label",
      "avatar",
      "icon",
      "animation",
      "responsive",
      "\u0441\u0442\u0440\u0430\u043d\u0438\u0446",
      "\u044d\u043a\u0440\u0430\u043d",
      "\u043a\u043e\u043c\u043f\u043e\u043d\u0435\u043d\u0442",
      "\u043a\u0430\u0440\u0442\u043e\u0447",
      "\u0431\u0435\u0439\u0434\u0436",
      "\u0447\u0438\u043f",
      "\u0432\u0438\u0437\u0443\u0430\u043b",
      "\u0441\u0442\u0438\u043b",
      "\u0442\u0435\u043a\u0441\u0442",
      "\u043b\u0435\u0439\u0431\u043b",
      "\u0430\u0432\u0430\u0442\u0430\u0440",
      "\u0438\u043a\u043e\u043d",
      "\u0430\u043d\u0438\u043c\u0430\u0446",
      "\u0430\u0434\u0430\u043f\u0442\u0438\u0432",
    ]);
  const hasVisualAction = includesAny(text, [
    "beautiful",
    "polish",
    "clean",
    "premium",
    "spacing",
    "align",
    "overflow",
    "wrap",
    "color",
    "typography",
    "hover",
    "focus",
    "loading state",
    "empty state",
    "error state",
    "badge",
    "badges",
    "animation",
    "progress",
    "\u043a\u0440\u0430\u0441\u0438\u0432",
    "\u043f\u043e\u043b\u0438\u0440",
    "\u043f\u0440\u0435\u043c\u0438\u0443\u043c",
    "\u043e\u0442\u0441\u0442\u0443\u043f",
    "\u0432\u044b\u0440\u043e\u0432\u043d",
    "\u043d\u0430\u043b\u0430\u0437",
    "\u043e\u0432\u0435\u0440\u0444\u043b\u043e\u0443",
    "\u043f\u0435\u0440\u0435\u043d\u043e\u0441",
    "\u0446\u0432\u0435\u0442",
    "\u0448\u0440\u0438\u0444\u0442",
    "\u0445\u043e\u0432\u0435\u0440",
    "\u0444\u043e\u043a\u0443\u0441",
    "\u043f\u0443\u0441\u0442\u043e\u0435 \u0441\u043e\u0441\u0442\u043e\u044f\u043d\u0438\u0435",
    "\u0430\u043d\u0438\u043c\u0430\u0446",
    "\u043f\u0440\u043e\u0433\u0440\u0435\u0441\u0441",
  ]);
  const hasBehaviorAction = includesAny(behaviorText, [
    "fetch",
    "call api",
    "api call",
    "request",
    "endpoint",
    "submit",
    "save",
    "persist",
    "create user",
    "update user",
    "delete",
    "connect to api",
    "wire",
    "integrate backend",
    "exchange code",
    "callback",
    "redirect",
    "session",
    "token",
    "cookie",
    "database",
    "db",
    "schema",
    "migration",
    "server",
    "backend",
    "auth flow",
    "login flow",
    "\u0437\u0430\u043f\u0440\u043e\u0441",
    "\u044d\u043d\u0434\u043f\u043e\u0438\u043d\u0442",
    "\u0441\u0430\u0431\u043c\u0438\u0442",
    "\u0441\u043e\u0445\u0440\u0430\u043d",
    "\u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0438 \u043a api",
    "\u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0438\u0442\u044c \u043a api",
    "\u0438\u043d\u0442\u0435\u0433\u0440\u0438\u0440\u0443\u0439 \u0431\u044d\u043a",
    "\u043a\u043e\u043b\u0431\u044d\u043a",
    "\u0440\u0435\u0434\u0438\u0440\u0435\u043a\u0442",
    "\u0441\u0435\u0441\u0441",
    "\u0442\u043e\u043a\u0435\u043d",
    "\u043a\u0443\u043a\u0438",
    "\u0431\u0430\u0437\u0430",
    "\u0431\u0434",
    "\u0441\u0445\u0435\u043c",
    "\u043c\u0438\u0433\u0440\u0430\u0446",
    "\u0441\u0435\u0440\u0432\u0435\u0440",
    "\u0431\u044d\u043a\u0435\u043d\u0434",
    "\u043b\u043e\u0433\u0438\u043d",
  ]);

  return hasUiSurface && hasVisualAction && !hasBehaviorAction;
}

function applyVisualOnlyScopeGuard(
  selectedFiles: SelectedTaskFile[],
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
) {
  if (area !== "ui" || !isVisualOnlyUiTask(input)) return selectedFiles;
  const tokenContext = buildTokenContext(input);

  return selectedFiles.map((selectedFile) => {
    const inventoryFile = findInventoryFile(input.inventory, selectedFile.path);
    if (!inventoryFile) return selectedFile;
    const explicit = isExplicitFilePath(inventoryFile, tokenContext);
    if (explicit) return selectedFile;
    if (!isBehaviorOrStateSupportFile(inventoryFile)) return selectedFile;

    const guardNote =
      "Visual-only UI scope guard downgraded behavior/state support context to inspect-only.";
    return {
      ...selectedFile,
      usage: "inspect-only" as SelectedTaskFileUsage,
      reason: selectedFile.reason.includes(guardNote)
        ? selectedFile.reason
        : `${selectedFile.reason} ${guardNote}`,
    };
  });
}

function hasDependencyPackageIntent(input: SelectTaskFilesInput) {
  const text = normalizeForCompare(getPositiveTaskText(input.rawTask));
  return includesAny(text, [
    "package",
    "packages",
    "dependency",
    "dependencies",
    "library",
    "libraries",
    "npm",
    "yarn",
    "pnpm",
    "bun",
    "install",
    "пакет",
    "пакеты",
    "библиотек",
    "зависимост",
    "npm install",
    "установ",
    "добавь библиотеку",
    "добавить библиотеку",
  ]);
}

function hasAnimationLibraryIntent(input: SelectTaskFilesInput) {
  const text = normalizeForCompare(getPositiveTaskText(input.rawTask));
  return includesAny(text, [
    "animation",
    "animations",
    "motion",
    "animate",
    "анимац",
  ]);
}

function isAgentSkillPath(pathValue: string) {
  const filePath = normalizeForCompare(pathValue);
  return (
    filePath.startsWith(".agents/skills/") ||
    filePath.includes("/.agents/skills/") ||
    filePath.startsWith("agents/skills/")
  );
}

function isLocalStateDataPath(pathValue: string) {
  const filePath = normalizeForCompare(pathValue);
  const fileName = filePath.split("/").pop() ?? filePath;
  return (
    filePath.startsWith("server/data/") ||
    filePath.includes("/server/data/") ||
    fileName.endsWith(".sqlite") ||
    fileName.endsWith(".db") ||
    fileName.endsWith(".sqlite3")
  );
}

function isDangerousAutoEditPath(pathValue: string) {
  return (
    isSensitivePath(pathValue) ||
    isLocalStateDataPath(pathValue) ||
    isAgentSkillPath(pathValue) ||
    isLockFilePath(pathValue)
  );
}

function isOauthCallbackFlowTask(input: SelectTaskFilesInput) {
  const text = normalizeForCompare(getPositiveTaskText(input.rawTask));
  return (
    includesAny(text, [
      "oauth",
      "auth",
      "authorization",
      "authentication",
      "callback",
      "redirect",
      "return url",
      "колбэк",
      "callback",
      "редирект",
      "авторизац",
    ]) &&
    includesAny(text, [
      "callback",
      "redirect",
      "return",
      "колбэк",
      "редирект",
      "возврат",
    ])
  );
}

function isExplicitOauthCallbackRepairTask(
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
) {
  if (!isOauthCallbackFlowTask(input)) return false;
  const text = normalizeForCompare(getPositiveTaskText(input.rawTask));
  const isRepair =
    input.taskType === "bugfix" &&
    includesAny(text, [
      "fix",
      "repair",
      "broken",
      "incorrect",
      "bug",
      "исправ",
      "почин",
      "ошиб",
      "слом",
    ]);
  const createsApplicationAuth = includesAny(text, [
    "add login",
    "new login",
    "new auth",
    "application auth",
    "app auth",
    "user session",
    "session storage",
    "вход пользователя",
    "авторизация в приложение",
    "новый способ авторизац",
    "пользовательская сессия",
    "отдельная авторизац",
  ]);
  return (
    isRepair && !createsApplicationAuth && hasExplicitPrimaryTarget(input, area)
  );
}

function scoreCallbackFlowFile(file: ProjectInventoryFile) {
  const identity = normalizeForCompare(
    [
      file.path,
      file.name,
      file.role,
      file.routePath ?? "",
      ...(file.symbols ?? []),
      ...(file.exports ?? []),
      ...(file.textHints ?? []),
    ].join(" "),
  );
  let score = 0;
  if (
    includesAny(identity, [
      "callback",
      "redirect",
      "return",
      "колбэк",
      "редирект",
    ])
  )
    score += 70;
  if (
    includesAny(identity, [
      "oauth",
      "auth",
      "authorization",
      "authentication",
      "авторизац",
    ])
  )
    score += 52;
  if (isPageLikeTargetFile(file)) score += 32;
  if (file.role === "api-route") score += 26;
  if (isClientApiBridgePath(file.path)) score += 18;
  if (isAgentSkillPath(file.path) || isLocalStateDataPath(file.path))
    score -= 200;
  return score;
}

function getCallbackFlowSeedFiles(
  input: SelectTaskFilesInput,
  selected: SelectedTaskFile[],
) {
  if (!isOauthCallbackFlowTask(input)) return [];
  const seen = new Set(selected.map((file) => normalizeForCompare(file.path)));
  return input.inventory.files
    .filter((file) => !seen.has(normalizeForCompare(file.path)))
    .filter((file) => !isDangerousAutoEditPath(file.path))
    .filter(
      (file) =>
        canUseSelectedFile(input, file, "bugfix", "none") ||
        isClientApiBridgePath(file.path) ||
        isPageLikeTargetFile(file),
    )
    .map((file) => ({ file, score: scoreCallbackFlowFile(file) }))
    .filter((item) => item.score >= 92)
    .sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path))
    .slice(0, 3)
    .map((item) =>
      makeSelectedFile(
        item.file,
        "Added because the task explicitly targets an auth/OAuth callback redirect flow and this real file has callback/auth identity.",
        Math.min(0.94, Math.max(0.78, item.score / 150)),
      ),
    );
}

function getHomePageSeedFiles(
  input: SelectTaskFilesInput,
  selected: SelectedTaskFile[],
) {
  if (!isHomePageTask(input)) return [];
  const seen = new Set(selected.map((file) => normalizeForCompare(file.path)));
  const candidates = input.inventory.files
    .filter((file) => !seen.has(normalizeForCompare(file.path)))
    .filter((file) => isPageLikeTargetFile(file))
    .filter((file) => canUseSemanticPageTargetFile(input, file, "ui", "none"))
    .map((file) => {
      const identity = normalizeForCompare(
        [
          file.path,
          file.name,
          file.routePath ?? "",
          ...(file.symbols ?? []),
          ...(file.exports ?? []),
          ...(file.textHints ?? []),
        ].join(" "),
      );
      let score = 0;
      if (isRootPageFile(file)) score += 150;
      if (
        includesAny(identity, ["home", "homepage", "landing", "index", "главн"])
      )
        score += 90;
      score += getPageSemanticMatchScore(file, input) * 0.25;
      return { file, score };
    })
    .filter((item) => item.score >= 80)
    .sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path))
    .slice(0, 1);

  return candidates.map((item) =>
    makeSelectedFile(
      item.file,
      "Added because the task explicitly targets the home/main/landing page and this real page has root/home identity.",
      Math.min(0.95, Math.max(0.82, item.score / 180)),
    ),
  );
}

function getPackageJsonFile(inventory: ProjectInventory) {
  return inventory.files
    .filter((file) => normalizeForCompare(file.path).endsWith("package.json"))
    .sort(
      (left, right) =>
        left.path.split("/").length - right.path.split("/").length ||
        left.path.localeCompare(right.path),
    )[0];
}

function getLockFiles(inventory: ProjectInventory) {
  return inventory.files.filter((file) => isLockFilePath(file.path));
}

function addDependencyPackageContext(
  selected: SelectedTaskFile[],
  input: SelectTaskFilesInput,
) {
  if (!hasDependencyPackageIntent(input)) return selected;
  if (
    input.taskIntent?.structuredIntent?.allowedEditScope ===
      "explicit_targets_only" &&
    buildTokenContext(input).explicitExistingPaths.length > 0
  ) {
    return selected;
  }
  const next = [...selected];
  const seen = new Set(next.map((file) => normalizeForCompare(file.path)));
  const packageFile = getPackageJsonFile(input.inventory);
  if (packageFile && !seen.has(normalizeForCompare(packageFile.path))) {
    next.push(
      makeSelectedFile(
        packageFile,
        "Added because the task mentions packages/libraries/dependencies, so the coding agent must inspect project dependencies and scripts.",
        0.9,
        "config-reference",
      ),
    );
    seen.add(normalizeForCompare(packageFile.path));
  }

  for (const lockFile of getLockFiles(input.inventory).slice(0, 2)) {
    if (seen.has(normalizeForCompare(lockFile.path))) continue;
    next.push(
      makeSelectedFile(
        lockFile,
        "Added as inspect-only dependency lockfile context for a package/dependency task.",
        0.62,
        "inspect-only",
      ),
    );
    seen.add(normalizeForCompare(lockFile.path));
  }

  return next;
}

function packageJsonMentionsKnownAnimationLibrary(input: SelectTaskFilesInput) {
  if (!hasAnimationLibraryIntent(input)) return false;
  const packageFile = getPackageJsonFile(input.inventory);
  if (!packageFile) return false;
  const packageText = normalizeForCompare(
    [packageFile.contentPreview ?? "", ...(packageFile.textHints ?? [])].join(
      " ",
    ),
  );
  return includesAny(packageText, [
    "framer-motion",
    "motion",
    "react-spring",
    "gsap",
    "animejs",
    "lottie",
  ]);
}

function hasStrictPageIdentityIntent(input: SelectTaskFilesInput) {
  const text = normalizeForCompare(getPositiveTaskText(input.rawTask));
  const asksForConcretePage = includesAny(text, [
    "страница",
    "страницу",
    "странице",
    "page",
    "screen",
    "view",
    "раздел",
    "экран",
  ]);
  const managementLike = includesAny(text, [
    "управлен",
    "management",
    "manage",
    "admin",
    "administrator",
    "админ",
    "администратор",
    "orders",
    "order management",
    "заказ",
    "users",
    "пользовател",
  ]);
  return asksForConcretePage && managementLike;
}

function hasStrongPageIdentityEvidence(
  file: ProjectInventoryFile,
  input: SelectTaskFilesInput,
) {
  const identityValues = [
    file.path,
    file.name,
    file.routePath ?? "",
    ...(file.symbols ?? []),
    ...(file.exports ?? []),
  ];
  const identityText = normalizeForCompare(identityValues.join(" "));
  const locationTokens = getConcretePageLocationTokens(input);
  const positiveTokens = getPositiveTargetTokens(input).filter(
    (token) =>
      !["form", "input", "field", "button", "badge", "badges"].includes(token),
  );
  const tokens = uniqueStrings([...locationTokens, ...positiveTokens]).filter(
    (token) => token.length >= 3,
  );
  if (tokens.length === 0) return false;

  return tokens.some((token) => filePartMatchesToken(identityText, token));
}

function shouldBlockWeakStrictPageSelection(
  input: SelectTaskFilesInput,
  selectedFiles: SelectedTaskFile[],
) {
  if (!hasStrictPageIdentityIntent(input)) return false;
  const pageTargets = selectedFiles
    .map((selectedFile) =>
      findInventoryFile(input.inventory, selectedFile.path),
    )
    .filter((file): file is ProjectInventoryFile =>
      Boolean(file && isPageLikeTargetFile(file)),
    );
  if (pageTargets.length === 0) return true;
  return !pageTargets.some((file) =>
    hasStrongPageIdentityEvidence(file, input),
  );
}

function applyPrimaryPageNarrowingGuard(
  selectedFiles: SelectedTaskFile[],
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
) {
  if (!isSpecificPageOrFileTask(input, area)) return selectedFiles;
  const tokenContext = buildTokenContext(input);
  const pageTargets = getSelectedConcretePageTargets(
    selectedFiles,
    input.inventory,
  );
  if (pageTargets.length <= 1) return selectedFiles;

  let primaryTargets: ProjectInventoryFile[] = [];
  if (isHomePageTask(input)) {
    primaryTargets = pageTargets
      .filter(
        (file) =>
          isRootPageFile(file) ||
          includesAny(
            [
              file.path,
              file.name,
              file.routePath ?? "",
              ...(file.symbols ?? []),
            ].join(" "),
            ["home", "homepage", "landing", "index", "главн"],
          ),
      )
      .slice(0, 1);
  }

  if (primaryTargets.length === 0) {
    if (taskAllowsMultipleConcretePageTargets(input, tokenContext))
      return selectedFiles;
    primaryTargets = getPrimaryConcretePageTargets(
      input,
      area,
      tokenContext,
      pageTargets,
    );
  }

  if (primaryTargets.length === 0) return selectedFiles;

  const primaryPaths = new Set(
    primaryTargets.map((file) => normalizeForCompare(file.path)),
  );
  return selectedFiles.filter((selectedFile) => {
    const inventoryFile = findInventoryFile(input.inventory, selectedFile.path);
    if (!inventoryFile || !isPageLikeTargetFile(inventoryFile)) return true;
    return primaryPaths.has(normalizeForCompare(inventoryFile.path));
  });
}

function applyReferenceOnlySafetyGuard(
  selectedFiles: SelectedTaskFile[],
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
) {
  const tokenContext = buildTokenContext(input);
  const explicitPaths = new Set(
    [
      ...tokenContext.explicitExistingPaths,
      ...getStructuredIntentTargets(input)
        .filter((target) =>
          structuredExplicitTargetLooksGrounded(input, target),
        )
        .map((target) => target.path)
        .filter((pathValue): pathValue is string => Boolean(pathValue)),
    ].map(normalizeForCompare),
  );
  const hasPageTarget = selectedFiles.some((selectedFile) => {
    const inventoryFile = findInventoryFile(input.inventory, selectedFile.path);
    return Boolean(inventoryFile && isPageLikeTargetFile(inventoryFile));
  });
  const visualOnly = isVisualOnlyUiTask(input);

  return selectedFiles
    .filter((selectedFile) => {
      const inventoryFile = findInventoryFile(
        input.inventory,
        selectedFile.path,
      );
      if (!inventoryFile)
        return (
          selectedFile.usage === "create-and-edit" &&
          isSafePlannedCreatePath(selectedFile.path)
        );
      if (explicitPaths.has(normalizeForCompare(inventoryFile.path)))
        return true;
      if (isSensitivePath(inventoryFile.path)) return false;
      if (isLocalStateDataPath(inventoryFile.path)) return false;
      return true;
    })
    .map((selectedFile) => {
      const inventoryFile = findInventoryFile(
        input.inventory,
        selectedFile.path,
      );
      if (!inventoryFile) return selectedFile;
      if (explicitPaths.has(normalizeForCompare(inventoryFile.path))) {
        const provenConditionalRemoval =
          selectedFile.selectionEvidence?.targetSource === "user_text" &&
          selectedFile.selectionEvidence.pathValidity === "inventory_exact" &&
          selectedFile.selectionEvidence.ownershipEvidence ===
            "reference_graph" &&
          selectedFile.selectionEvidence.actionConfidence ===
            "confirmed_edit" &&
          selectedFile.selectionEvidence.negativeConstraintConflicts.length ===
            0;
        const explicitTargetCanBeEdited =
          provenConditionalRemoval ||
          inventoryFile.kind === "source" ||
          inventoryFile.kind === "style" ||
          inventoryFile.kind === "test" ||
          (inventoryFile.kind === "docs" && area === "docs");
        if (
          explicitTargetCanBeEdited &&
          selectedFile.usage === "inspect-only"
        ) {
          return {
            ...selectedFile,
            usage: "inspect-and-edit" as SelectedTaskFileUsage,
            reason: selectedFile.reason.includes(
              "Explicit inventory target kept editable",
            )
              ? selectedFile.reason
              : `${selectedFile.reason} Explicit inventory target kept editable after final safety validation.`,
          };
        }
        return selectedFile;
      }

      const implementationDocsReference =
        (inventoryFile.kind === "docs" ||
          normalizeForCompare(inventoryFile.path).endsWith(".md")) &&
        area !== "docs";
      const schemaReferenceOnly =
        inventoryFile.role === "db-schema" &&
        !includesAny(getPositiveTaskText(input.rawTask), [
          "schema",
          "database",
          "db",
          "migration",
          "migrate",
          "таблиц",
          "схем",
          "база",
          "бд",
          "миграц",
        ]);
      const appShellReferenceOnly =
        isOauthCallbackFlowTask(input) &&
        isAppShellOrEntrypointFile(inventoryFile) &&
        !includesAny(getPositiveTaskText(input.rawTask), [
          "route",
          "routing",
          "router",
          "app",
          "роут",
          "маршрут",
        ]);
      const relatedAuthPageReferenceOnly =
        isOauthCallbackFlowTask(input) &&
        isPageLikeTargetFile(inventoryFile) &&
        !includesAny(
          [
            inventoryFile.path,
            inventoryFile.name,
            inventoryFile.routePath ?? "",
            ...(inventoryFile.symbols ?? []),
          ].join(" "),
          ["callback", "redirect", "return", "колбэк", "редирект"],
        );

      const shouldInspectOnly =
        isAgentSkillPath(inventoryFile.path) ||
        isLockFilePath(inventoryFile.path) ||
        implementationDocsReference ||
        schemaReferenceOnly ||
        appShellReferenceOnly ||
        relatedAuthPageReferenceOnly ||
        (hasPageTarget &&
          (area === "ui" || visualOnly) &&
          isBehaviorOrStateSupportFile(inventoryFile)) ||
        (hasPageTarget &&
          inventoryFile.role === "hook" &&
          !isPageLikeTargetFile(inventoryFile));

      if (
        !shouldInspectOnly ||
        selectedFile.usage === "inspect-only" ||
        selectedFile.usage === "asset-reference"
      )
        return selectedFile;

      const guardNote =
        "Final safety guard marked this support/protected file as inspect-only.";
      return {
        ...selectedFile,
        usage: "inspect-only" as SelectedTaskFileUsage,
        reason: selectedFile.reason.includes(guardNote)
          ? selectedFile.reason
          : `${selectedFile.reason} ${guardNote}`,
      };
    });
}

function dedupeSelectedFilesByPath(selectedFiles: SelectedTaskFile[]) {
  const seen = new Set<string>();
  const result: SelectedTaskFile[] = [];
  for (const file of selectedFiles) {
    const key = normalizeForCompare(file.path);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(file);
  }
  return result;
}

function hasCreateTargetIntent(input: SelectTaskFilesInput) {
  const text = normalizeForCompare(getPositiveTaskText(input.rawTask));
  return (
    input.taskIntent?.taskUnderstanding.action === "create" ||
    includesAny(text, [
      "create",
      "create page",
      "create route",
      "create file",
      "create component",
      "add new page",
      "add new route",
      "add new file",
      "add new component",
      "new page",
      "new route",
      "new file",
      "new component",
      "создай",
      "создать",
      "сгенерируй",
      "сгенерировать",
      "добавь новую",
      "добавить новую",
      "добавь новый",
      "добавить новый",
      "новую страницу",
      "новый компонент",
      "новый файл",
      "новый роут",
      "новый маршрут",
      "сделай новую страницу",
      "сделай новый компонент",
    ]) ||
    /(?:add|create)\s+(?:a\s+)?(?:page|route)\s+(?:at\s+)?\/[a-z0-9/_-]+/i.test(
      text,
    ) ||
    /(?:добавь|создай|сделай)\s+(?:новую\s+)?(?:страницу|роут|маршрут)\s+\/[a-zа-яё0-9/_-]+/i.test(
      text,
    )
  );
}

function isSafePlannedCreatePath(pathValue: string) {
  const normalized = normalizePath(pathValue).replace(/^\.\//, "");
  const comparable = normalizeForCompare(normalized);
  const segments = comparable.split("/").filter(Boolean);
  const extension =
    comparable
      .split("/")
      .pop()
      ?.match(/\.[a-z0-9]+$/i)?.[0] ?? "";

  if (!comparable || comparable.startsWith("/") || /^[a-z]:/i.test(comparable))
    return false;
  if (segments.includes("..") || segments.includes("~")) return false;
  if (
    isDangerousAutoEditPath(comparable) ||
    isGeneratedDoNotEditPath(comparable) ||
    isSensitivePath(comparable)
  )
    return false;
  if (
    comparable.includes("/node_modules/") ||
    comparable.startsWith("node_modules/")
  )
    return false;
  if (comparable.includes("/.git/") || comparable.startsWith(".git/"))
    return false;
  if (
    comparable.includes("/dist/") ||
    comparable.startsWith("dist/") ||
    comparable.includes("/build/") ||
    comparable.startsWith("build/")
  )
    return false;
  if (!/^[-_a-z0-9а-яё./()[\]@]+$/i.test(comparable)) return false;
  if (
    !segments.some((segment) =>
      [
        "src",
        "app",
        "pages",
        "routes",
        "components",
        "ui",
        "lib",
        "styles",
        "hooks",
        "tests",
        "test",
      ].includes(segment),
    )
  )
    return false;

  return [
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".css",
    ".scss",
    ".md",
    ".mdx",
  ].includes(extension);
}

function plannedCreateKindForPath(pathValue: string): ProjectInventoryFileKind {
  const filePath = normalizeForCompare(pathValue);
  if (filePath.endsWith(".css") || filePath.endsWith(".scss")) return "style";
  if (filePath.endsWith(".md") || filePath.endsWith(".mdx")) return "docs";
  if (filePath.match(/\.(png|jpe?g|gif|svg|webp|ico)$/i)) return "asset";
  return "source";
}

function makePlannedCreateFile(
  pathValue: string,
  reason: string,
  confidence = 0.92,
  source: "user_text" | "model_inference" = "model_inference",
): SelectedTaskFile {
  const explicitUserPath = source === "user_text";
  return {
    path: normalizePath(pathValue).replace(/^\.\//, ""),
    kind: plannedCreateKindForPath(pathValue),
    usage: "create-and-edit",
    reason,
    confidence: Math.min(0.98, Math.max(0.5, confidence)),
    evidenceLevel: explicitUserPath ? "user_confirmed" : undefined,
    selectionEvidence: {
      targetSource: source,
      pathValidity: "synthetic",
      ownershipEvidence: explicitUserPath ? "content_supported" : "route_graph",
      actionConfidence: explicitUserPath
        ? "confirmed_edit"
        : "inspect_then_edit",
      semanticRoles: ["producer"],
      symbols: [],
      chain: [],
      negativeConstraintConflicts: [],
      reason: explicitUserPath
        ? "The user explicitly named this safe in-project destination; the file does not exist yet and is authorized only as a create target."
        : "The destination was inferred from an explicit route and real framework structure; review the synthesized path before implementation.",
    },
  };
}

function routeToSegments(routeValue: string) {
  return normalizePath(routeValue)
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/[?#].*$/, "")
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter((segment) => !segment.startsWith(":"));
}

function toPascalCase(value: string) {
  const parts = value
    .split(/[^a-zа-яё0-9]+/i)
    .map((part) => part.trim())
    .filter(Boolean);
  const mapped = parts.map(
    (part) => part.charAt(0).toUpperCase() + part.slice(1),
  );
  return mapped.join("") || "New";
}

function getDominantSourceExtension(
  inventory: ProjectInventory,
  fallback: ".tsx" | ".jsx" | ".ts" | ".js" = ".tsx",
) {
  const counts = new Map<string, number>();
  for (const file of inventory.files) {
    if (![".tsx", ".jsx", ".ts", ".js"].includes(file.extension)) continue;
    counts.set(file.extension, (counts.get(file.extension) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? fallback;
}

function directoryExistsInInventory(
  inventory: ProjectInventory,
  directory: string,
) {
  const normalized = normalizeForCompare(directory).replace(/\/+$/, "");
  return inventory.files.some((file) =>
    normalizeForCompare(file.path).startsWith(`${normalized}/`),
  );
}

function hasNextAppRouter(inventory: ProjectInventory) {
  return inventory.files.some((file) =>
    /(^|\/)app(\/.*)?\/page\.(tsx|jsx|ts|js)$/i.test(normalizePath(file.path)),
  );
}

function hasRemixRoutes(inventory: ProjectInventory) {
  return inventory.files.some((file) =>
    normalizeForCompare(file.path).startsWith("app/routes/"),
  );
}

function hasReactRouterPages(inventory: ProjectInventory) {
  const hasPagesDir =
    directoryExistsInInventory(inventory, "src/pages") ||
    directoryExistsInInventory(inventory, "pages");
  const hasRouterShell = inventory.files.some((file) => {
    const identity = normalizeForCompare(
      [
        file.path,
        file.name,
        ...(file.imports ?? []),
        ...(file.textHints ?? []),
        file.contentPreview ?? "",
      ].join(" "),
    );
    return includesAny(identity, [
      "react-router",
      "react-router-dom",
      "routes",
      "browserrouter",
    ]);
  });
  return hasPagesDir && hasRouterShell;
}

function routeAlreadyExistsInInventory(
  input: SelectTaskFilesInput,
  routePath: string,
) {
  const normalizedRoute = normalizeForCompare(routePath);
  return input.inventory.files.some(
    (file) => normalizeForCompare(file.routePath ?? "") === normalizedRoute,
  );
}

function returnCreatePathIfMissing(
  input: SelectTaskFilesInput,
  pathValue: string,
) {
  const normalized = normalizePath(pathValue).replace(/^\.\//, "");
  if (findInventoryFile(input.inventory, normalized)) return undefined;
  return normalized;
}

function inferCreateTargetFromRoute(
  input: SelectTaskFilesInput,
  routeValue: string,
) {
  const segments = routeToSegments(routeValue);
  if (segments.length === 0) return undefined;
  const routePath = `/${segments.join("/")}`;
  if (routeAlreadyExistsInInventory(input, routePath)) return undefined;

  const extension = getDominantSourceExtension(input.inventory, ".tsx");

  if (hasNextAppRouter(input.inventory)) {
    const base = directoryExistsInInventory(input.inventory, "src/app")
      ? "src/app"
      : "app";
    return returnCreatePathIfMissing(
      input,
      `${base}/${segments.join("/")}/page${extension === ".jsx" || extension === ".js" ? ".jsx" : ".tsx"}`,
    );
  }

  if (hasRemixRoutes(input.inventory)) {
    return returnCreatePathIfMissing(
      input,
      `app/routes/${segments.join(".")}${extension === ".jsx" || extension === ".js" ? ".jsx" : ".tsx"}`,
    );
  }

  const pagesBase = directoryExistsInInventory(input.inventory, "src/pages")
    ? "src/pages"
    : directoryExistsInInventory(input.inventory, "pages")
      ? "pages"
      : "src/pages";
  if (
    hasReactRouterPages(input.inventory) ||
    directoryExistsInInventory(input.inventory, pagesBase)
  ) {
    const name = `${segments.map(toPascalCase).join("")}Page`;
    return returnCreatePathIfMissing(
      input,
      `${pagesBase}/${name}${extension === ".jsx" || extension === ".js" ? ".jsx" : ".tsx"}`,
    );
  }

  return returnCreatePathIfMissing(
    input,
    `src/pages/${segments.map(toPascalCase).join("")}Page${extension === ".jsx" || extension === ".js" ? ".jsx" : ".tsx"}`,
  );
}

function sanitizeCreatePathMention(value: string) {
  return normalizePath(value)
    .trim()
    .replace(/^["'`]+|["'`.,;:!?]+$/g, "")
    .replace(/^\.\//, "");
}

function looksLikeCreatePathMention(value: string) {
  const normalized = sanitizeCreatePathMention(value);
  if (!normalized) return false;
  if (normalized === ".env" || normalized.startsWith(".env.")) return true;
  if (normalized.includes("/") || normalized.startsWith("."))
    return /\.[a-z0-9]+$/i.test(normalized);
  return false;
}

function getStructuredCreatePathMentions(input: SelectTaskFilesInput) {
  if (!hasCreateTargetIntent(input)) return [];
  const targets = input.taskIntent?.structuredIntent?.primaryTargets ?? [];
  const values = targets.flatMap((target) => [
    target.path ?? "",
    target.value ?? "",
    target.name ?? "",
  ]);
  return uniqueStrings(
    values.map(sanitizeCreatePathMention).filter(looksLikeCreatePathMention),
  );
}

function getRawCreatePathMentions(input: SelectTaskFilesInput) {
  if (!hasCreateTargetIntent(input)) return [];
  const text = normalizePath(getPositiveTaskText(input.rawTask));
  const values: string[] = [];
  const pathPattern =
    /(?:^|[\s"'`(\[])((?:(?:\.\.?)?[\/])+[^\s"'`),;!?]+\.[a-z0-9]+|[a-z]:[\/][^\s"'`),;!?]+\.[a-z0-9]+|\.env(?:\.[a-z0-9_-]+)?|(?:src|app|pages|routes|components|ui|lib|styles|hooks|tests|test)[\/][^\s"'`),;!?]+\.[a-z0-9]+)(?=$|[\s"'`),;!?])/gi;

  for (const match of text.matchAll(pathPattern)) {
    const value = sanitizeCreatePathMention(match[1] ?? "");
    if (looksLikeCreatePathMention(value)) values.push(value);
  }

  return uniqueStrings(values);
}

function addCreatePathMentionToPlan({
  input,
  pathValue,
  targets,
  unsafePaths,
  seen,
  reason,
}: {
  input: SelectTaskFilesInput;
  pathValue: string;
  targets: SelectedTaskFile[];
  unsafePaths: string[];
  seen: Set<string>;
  reason: string;
}) {
  const normalized = sanitizeCreatePathMention(pathValue);
  if (!normalized) return;
  if (findInventoryFile(input.inventory, normalized)) return;
  if (isExplicitFileCreationForbidden(input.rawTask, normalized)) return;
  if (!isSafePlannedCreatePath(normalized)) {
    unsafePaths.push(pathValue);
    return;
  }
  const key = normalizeForCompare(normalized);
  if (seen.has(key)) return;
  seen.add(key);
  targets.push(makePlannedCreateFile(normalized, reason, 0.95, "user_text"));
}

function getPlannedCreateTargets(
  input: SelectTaskFilesInput,
  tokenContext = buildTokenContext(input),
) {
  if (!hasCreateTargetIntent(input))
    return { targets: [] as SelectedTaskFile[], unsafePaths: [] as string[] };

  const targets: SelectedTaskFile[] = [];
  const unsafePaths: string[] = [];
  const seen = new Set<string>();

  const explicitCreatePathMentions = uniqueStrings([
    ...tokenContext.explicitMissingPaths,
    ...getRawCreatePathMentions(input),
    ...getStructuredCreatePathMentions(input),
  ]);

  for (const missingPath of explicitCreatePathMentions) {
    addCreatePathMentionToPlan({
      input,
      pathValue: missingPath,
      targets,
      unsafePaths,
      seen,
      reason:
        "User explicitly requested creating this missing file path; it passed safe in-project path validation.",
    });
  }

  for (const route of tokenContext.routeMentions) {
    const inferredPath = inferCreateTargetFromRoute(input, route);
    if (!inferredPath) continue;
    if (!isSafePlannedCreatePath(inferredPath)) {
      unsafePaths.push(inferredPath);
      continue;
    }
    const key = normalizeForCompare(inferredPath);
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(
      makePlannedCreateFile(
        inferredPath,
        `User requested a new route/page (${route}); ContextForge inferred this framework-compatible file path from the project inventory.`,
        0.9,
        "model_inference",
      ),
    );
  }

  const keptTargets = targets.slice(0, 3);
  const keptTargetBasenames = new Set(
    keptTargets
      .map((target) => basenameForCompare(target.path))
      .filter(Boolean),
  );
  const filteredUnsafePaths = uniqueStrings(unsafePaths).filter((pathValue) => {
    const basename = basenameForCompare(pathValue);
    return !basename || !keptTargetBasenames.has(basename);
  });

  return {
    targets: keptTargets,
    unsafePaths: filteredUnsafePaths,
  };
}

function shouldUseEditableRouteRegistrationReference(
  file: ProjectInventoryFile,
  input: SelectTaskFilesInput,
  plannedTargets: SelectedTaskFile[],
) {
  if (plannedTargets.length === 0) return false;
  const routeCreateRequested =
    buildTokenContext(input).routeMentions.length > 0;
  if (!routeCreateRequested) return false;
  if (hasNextAppRouter(input.inventory) || hasRemixRoutes(input.inventory))
    return false;
  const pathValue = normalizeForCompare(file.path);
  return (
    pathValue.endsWith("/app.tsx") ||
    pathValue.endsWith("/app.jsx") ||
    pathValue.endsWith("/app.ts") ||
    pathValue.endsWith("/app.js") ||
    pathValue.endsWith("/routes.tsx") ||
    pathValue.endsWith("/routes.jsx") ||
    pathValue.endsWith("/router.tsx") ||
    pathValue.endsWith("/router.jsx")
  );
}

function getCreateTargetReferenceFiles(
  input: SelectTaskFilesInput,
  plannedTargets: SelectedTaskFile[],
  area: EffectiveTaskArea,
  assetMode: AssetMode,
) {
  if (plannedTargets.length === 0) return [];
  const references: SelectedTaskFile[] = [];
  const seen = new Set(
    plannedTargets.map((file) => normalizeForCompare(file.path)),
  );
  const addReference = (
    file: ProjectInventoryFile,
    reason: string,
    confidence: number,
    usage: SelectedTaskFileUsage = "inspect-only",
  ) => {
    const key = normalizeForCompare(file.path);
    if (seen.has(key)) return;
    if (
      !canUseSelectedFile(input, file, area, assetMode) &&
      !isPackageOrConfigPath(file.path)
    )
      return;
    references.push(makeSelectedFile(file, reason, confidence, usage));
    seen.add(key);
  };

  for (const file of input.inventory.files) {
    if (
      shouldUseEditableRouteRegistrationReference(file, input, plannedTargets)
    ) {
      addReference(
        file,
        "Added because a new client-side route may need registration in the existing router/app shell.",
        0.78,
        "inspect-and-edit",
      );
    }
  }

  const targetDirs = plannedTargets.map((file) =>
    normalizeForCompare(file.path).split("/").slice(0, -1).join("/"),
  );
  const siblingSources = rankCreateTargetReferenceFiles({
    files: input.inventory.files
      .filter((file) => file.kind === "source" || file.kind === "unknown")
      .filter((file) =>
        targetDirs.some((dir) => {
          const fileDir = normalizeForCompare(file.path)
            .split("/")
            .slice(0, -1)
            .join("/");
          return Boolean(dir && fileDir === dir);
        }),
      ),
    rawTask: input.rawTask,
    positiveTaskText: getPositiveTaskText(input.rawTask),
    taskIntent: input.taskIntent,
    plannedTargetPaths: plannedTargets.map((target) => target.path),
  }).slice(0, 2);
  for (const file of siblingSources)
    addReference(
      file,
      "Added as inspect-only reference for behaviorally similar source conventions in the exact destination directory.",
      0.74,
      "inspect-only",
    );

  const siblingPages = input.inventory.files
    .filter((file) => isPageLikeTargetFile(file))
    .filter((file) =>
      targetDirs.some(
        (dir) => dir && normalizeForCompare(file.path).startsWith(`${dir}/`),
      ),
    )
    .slice(0, 2);
  for (const file of siblingPages)
    addReference(
      file,
      "Added as inspect-only reference for nearby page structure and conventions.",
      0.68,
      "inspect-only",
    );

  const styleFile = input.inventory.files.find(
    (file) => file.kind === "style" && !isGeneratedDoNotEditPath(file.path),
  );
  if (styleFile)
    addReference(
      styleFile,
      "Added as inspect-only style reference for the new UI surface.",
      0.62,
      "inspect-only",
    );

  const packageFile = getPackageJsonFile(input.inventory);
  if (packageFile && hasDependencyPackageIntent(input))
    addReference(
      packageFile,
      "Added because the create task also mentions packages/dependencies.",
      0.9,
      "config-reference",
    );

  return references.slice(0, 6);
}

function isConditionalRemovalTask(input: SelectTaskFilesInput) {
  const action = input.taskIntent?.taskUnderstanding.action;
  if (action && action !== "remove") return false;
  const text = normalizeForCompare(input.rawTask);
  const removeAction =
    action === "remove" || /\b(?:delete|remove)\b|(?:удал|убер)/iu.test(text);
  const conditionalUnused =
    /\b(?:if|only\s+if)\b[^.!?\n]{0,100}\b(?:unused|not\s+used|no\s+longer\s+used|unreferenced)\b/iu.test(
      text,
    ) ||
    /(?:если|только\s+если)[^.!?\n]{0,100}(?:не\s+использ|не\s+нуж|нет\s+ссылок|не\s+подключ)/iu.test(
      text,
    );
  return removeAction && conditionalUnused;
}

function fileRuntimeReferencesTarget(
  file: ProjectInventoryFile,
  target: ProjectInventoryFile,
) {
  const targetPath = normalizeForCompare(target.path);
  const targetName = normalizeForCompare(target.name);
  const matchesValue = (rawValue: string) => {
    const value = normalizeForCompare(rawValue).replace(/[?#].*$/, "");
    if (!value) return false;
    return (
      value === targetPath ||
      value.endsWith(`/${targetPath}`) ||
      value === targetName ||
      value.endsWith(`/${targetName}`)
    );
  };
  if (file.imports.some(matchesValue)) return true;
  if ((file.semanticFacts?.stringLiterals ?? []).some(matchesValue))
    return true;
  if (
    (file.semanticFacts?.structuredEntries ?? []).some((entry) =>
      entry.values.some((value) => matchesValue(value.value)),
    )
  ) {
    return true;
  }
  return matchesValue(file.contentPreview ?? "");
}

function getConditionalRemovalPlan(input: SelectTaskFilesInput): {
  target?: SelectedTaskFile;
  references: SelectedTaskFile[];
  protectedReferences: SelectedTaskFile[];
  proofComplete: boolean;
} {
  if (!isConditionalRemovalTask(input)) {
    return { references: [], protectedReferences: [], proofComplete: false };
  }

  const resolution = resolveExplicitFileMentions(
    getPositiveTaskText(input.rawTask),
    input.inventory,
  );
  if (resolution.existingPaths.length !== 1) {
    return { references: [], protectedReferences: [], proofComplete: false };
  }
  const inventoryTarget = findInventoryFile(
    input.inventory,
    resolution.existingPaths[0]!,
  );
  if (
    !inventoryTarget ||
    inventoryTarget.isLikelyGenerated ||
    isSensitivePath(inventoryTarget.path)
  ) {
    return { references: [], protectedReferences: [], proofComplete: false };
  }

  const runtimeReferences = input.inventory.files
    .filter(
      (file) =>
        normalizeForCompare(file.path) !==
        normalizeForCompare(inventoryTarget.path),
    )
    .filter(
      (file) =>
        !["docs", "test", "asset", "data", "runtime"].includes(file.kind),
    )
    .filter((file) => fileRuntimeReferencesTarget(file, inventoryTarget));
  const proofComplete =
    !input.inventory.truncated && runtimeReferences.length === 0;
  const targetEvidence: FileSelectionEvidence = {
    targetSource: "user_text",
    pathValidity: "inventory_exact",
    ownershipEvidence: "reference_graph",
    actionConfidence: proofComplete ? "confirmed_edit" : "inspect_only",
    semanticRoles: ["reference"],
    symbols: [inventoryTarget.name],
    chain: runtimeReferences.slice(0, 8).map((file) => ({
      symbol: inventoryTarget.name,
      role: "reference",
      path: file.path,
      relatedPath: inventoryTarget.path,
      evidence: "reference_graph",
      relation: "identifier_reference",
    })),
    negativeConstraintConflicts: proofComplete
      ? []
      : [
          input.inventory.truncated
            ? "The repository inventory is truncated, so absence of references cannot be proven."
            : "The conditional removal predicate is not satisfied because runtime references were found.",
        ],
    reason: proofComplete
      ? "The user named one exact removal target, the complete current inventory contains no runtime import or literal reference to it, and only this path is authorized for deletion."
      : input.inventory.truncated
        ? "The exact removal target is retained for investigation, but the inventory is truncated and cannot prove that it is unused."
        : `The exact removal target is still referenced by ${runtimeReferences.length} runtime project file(s); deletion is not authorized.`,
  };
  const target: SelectedTaskFile = {
    path: inventoryTarget.path,
    kind: inventoryTarget.kind,
    usage: proofComplete ? "inspect-and-edit" : "inspect-only",
    reason: targetEvidence.reason,
    confidence: proofComplete ? 0.96 : 0.72,
    evidenceLevel: "user_confirmed",
    selectionEvidence: targetEvidence,
  };

  const references = runtimeReferences.slice(0, 5).map((file) => {
    const evidence: FileSelectionEvidence = {
      targetSource: "ranking",
      pathValidity: "inventory_exact",
      ownershipEvidence: "reference_graph",
      actionConfidence: "inspect_only",
      semanticRoles: ["reference"],
      symbols: [inventoryTarget.name],
      chain: [
        {
          symbol: inventoryTarget.name,
          role: "reference",
          path: file.path,
          relatedPath: inventoryTarget.path,
          evidence: "reference_graph",
          relation: "identifier_reference",
        },
      ],
      negativeConstraintConflicts: [],
      reason: `Runtime reference to the conditional removal target ${inventoryTarget.path}; inspect before any deletion.`,
    };
    return {
      path: file.path,
      kind: file.kind,
      usage: "inspect-only" as const,
      reason: evidence.reason,
      confidence: 0.84,
      evidenceLevel: "graph_supported" as const,
      selectionEvidence: evidence,
    };
  });

  const protectedReferences = extractClassifiedFileMentions(input.rawTask)
    .filter((mention) => mention.role === "artifact-reference")
    .map((mention) =>
      findInventoryFileByLoosePath(input.inventory, mention.path),
    )
    .filter((file): file is ProjectInventoryFile => Boolean(file))
    .filter(
      (file) =>
        normalizeForCompare(file.path) !==
        normalizeForCompare(inventoryTarget.path),
    )
    .slice(0, 3)
    .map((file) => {
      const evidence: FileSelectionEvidence = {
        targetSource: "user_text",
        pathValidity: "inventory_exact",
        ownershipEvidence: "reference_graph",
        actionConfidence: "inspect_only",
        semanticRoles: ["reference"],
        symbols: [file.name],
        chain: [],
        negativeConstraintConflicts: [
          "The user explicitly protected this file from modification.",
        ],
        reason:
          "User-protected file retained as inspect-only verification context; it is not an edit or deletion target.",
      };
      return {
        path: file.path,
        kind: file.kind,
        usage: "inspect-only" as const,
        reason: evidence.reason,
        confidence: 0.86,
        evidenceLevel: "user_confirmed" as const,
        selectionEvidence: evidence,
      };
    });

  return { target, references, protectedReferences, proofComplete };
}

function finalizeSelectedFilesForSafety(
  selection: TaskFileSelection,
  input: SelectTaskFilesInput,
) {
  const notes: string[] = [];
  const hardSafety = detectHardTaskSafetyIssue(input.rawTask);
  if (hardSafety.blocked) {
    notes.push(
      "Hard safety policy blocked selected files after validation; no snippets will be included.",
      ...hardSafety.reasons,
    );
    return { selectedFiles: [], notes };
  }

  const createPlan = getPlannedCreateTargets(input);
  const conditionalRemovalPlan = getConditionalRemovalPlan(input);
  let selectedFiles = dedupeSelectedFilesByPath(selection.selectedFiles);
  const terminalManualReview =
    selectedFiles.length === 0 &&
    selection.notes.some((note) =>
      includesAny(normalizeForCompare(note), [
        "stopped automatic selection",
        "manual target selection is required",
        "manual target selection or a more specific task is required",
        "task type conflict stopped automatic selection",
      ]),
    );

  if (terminalManualReview) {
    notes.push(
      "Final safety guard preserved the manual-review/block state and did not add fallback seed files.",
    );
    return { selectedFiles: [], notes };
  }

  if (
    hasCreateTargetIntent(input) &&
    createPlan.targets.length === 0 &&
    createPlan.unsafePaths.length > 0
  ) {
    notes.push(
      `Create-target intent detected, but unsafe/out-of-scope path(s) were requested: ${createPlan.unsafePaths.slice(0, 6).join(", ")}. Auto-selection was blocked instead of falling back to unrelated files.`,
    );
    return { selectedFiles: [], notes };
  }

  if (conditionalRemovalPlan.target) {
    selectedFiles = dedupeSelectedFilesByPath([
      conditionalRemovalPlan.target,
      ...conditionalRemovalPlan.references,
      ...conditionalRemovalPlan.protectedReferences,
    ]);
    notes.push(
      conditionalRemovalPlan.proofComplete
        ? "Conditional single-file removal was bounded to the exact user target after a complete inventory found no runtime references."
        : "Conditional single-file removal remains investigation-only because the unused predicate is not proven.",
    );
  } else if (createPlan.targets.length > 0) {
    const immutableProtectedReferences = selection.selectedFiles.filter(
      (file) =>
        file.evidenceLevel === "user_confirmed" &&
        file.usage === "inspect-only" &&
        Boolean(file.selectionEvidence?.negativeConstraintConflicts.length),
    );
    selectedFiles = dedupeSelectedFilesByPath([
      ...createPlan.targets,
      ...immutableProtectedReferences,
      ...getCreateTargetReferenceFiles(
        input,
        createPlan.targets,
        selection.effectiveTaskArea,
        selection.assetMode,
      ),
    ]);
    notes.push(
      "Create-target intent detected; missing safe in-project path(s) were kept as planned files to create instead of blocking.",
    );
  } else {
    selectedFiles.push(...getHomePageSeedFiles(input, selectedFiles));
    selectedFiles.push(...getCallbackFlowSeedFiles(input, selectedFiles));
    selectedFiles = dedupeSelectedFilesByPath(selectedFiles);
  }

  selectedFiles = addDependencyPackageContext(selectedFiles, input);
  if (createPlan.targets.length === 0 && !conditionalRemovalPlan.target) {
    selectedFiles = applyPrimaryPageNarrowingGuard(
      selectedFiles,
      input,
      selection.effectiveTaskArea,
    );
  }
  selectedFiles = applyVisualOnlyScopeGuard(
    selectedFiles,
    input,
    selection.effectiveTaskArea,
  );
  selectedFiles = applyReferenceOnlySafetyGuard(
    selectedFiles,
    input,
    selection.effectiveTaskArea,
  );
  selectedFiles = dedupeSelectedFilesByPath(selectedFiles);

  if (createPlan.unsafePaths.length > 0) {
    notes.push(
      `Create-target intent detected, but unsafe/out-of-scope path(s) were rejected: ${createPlan.unsafePaths.slice(0, 6).join(", ")}.`,
    );
  }

  if (
    createPlan.targets.length === 0 &&
    shouldBlockWeakStrictPageSelection(input, selectedFiles)
  ) {
    notes.push(
      "Strict page target guard blocked auto-selection because the requested management/admin/order/user page was not grounded by path, route, or component identity.",
    );
    selectedFiles = [];
  }

  if (hasDependencyPackageIntent(input)) {
    if (
      selectedFiles.some((file) =>
        normalizeForCompare(file.path).endsWith("package.json"),
      )
    ) {
      notes.push(
        "Dependency/package intent detected; package.json was included for dependency and script context.",
      );
    } else {
      notes.push(
        "Dependency/package intent detected, but no package.json was found in the project inventory.",
      );
    }
  }

  if (packageJsonMentionsKnownAnimationLibrary(input)) {
    notes.push(
      "Animation library intent detected and package.json already appears to mention an animation library; inspect dependencies before adding another one.",
    );
  }

  if (
    isOauthCallbackFlowTask(input) &&
    selectedFiles.some((file) =>
      includesAny(file.path, ["callback", "redirect"]),
    )
  ) {
    notes.push(
      "OAuth/auth callback flow detected; callback/redirect identity files were preferred over unrelated auth support files.",
    );
  }

  if (
    selectedFiles.some(
      (file) => isAgentSkillPath(file.path) && file.usage === "inspect-only",
    )
  ) {
    notes.push(
      "Agent skill documents are reference-only and must not be edited as task implementation files.",
    );
  }

  return { selectedFiles, notes };
}

function isWithinRequestedRouteScope(
  file: ProjectInventoryFile,
  tokenContext: TokenContext,
) {
  const score = getRouteMatchScore(file, tokenContext.routeMentions);
  if (isDirectRoutePageMatch(file, tokenContext.routeMentions)) return true;

  // For specific page/route tasks, avoid broad UI primitives or app shell files
  // that only mention the route in content. Route scope should be path/route metadata driven.
  return (
    score >= 88 &&
    !isGenericSharedUiPrimitive(file) &&
    !isAppShellOrEntrypointFile(file)
  );
}

function isImplementationIntentText(rawTask: string) {
  return includesAny(rawTask, [
    "implement",
    "connect",
    "integrate",
    "wire",
    "hook up",
    "create",
    "add feature",
    "build feature",
    "replace",
    "render",
    "show",
    "display",
    "fetch",
    "call",
    "change",
    "edit",
    "modify",
    "реализ",
    "подключ",
    "интегр",
    "добав",
    "созд",
    "замен",
    "вывести",
    "показ",
    "получ",
    "запрос",
    "измен",
    "передел",
  ]);
}

function isSecondaryDocumentationMention(
  file: ProjectInventoryFile,
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
) {
  const filePath = normalizeForCompare(file.path);
  const isDocsFile =
    file.kind === "docs" ||
    filePath.endsWith("readme.md") ||
    filePath.includes("/docs/");
  if (!isDocsFile) return false;
  if (area === "docs") return false;

  const positiveTaskText = getPositiveTaskText(input.rawTask);
  return (
    isImplementationIntentText(positiveTaskText) &&
    includesAny(positiveTaskText, [
      "readme",
      "docs",
      "documentation",
      "guide",
      "manual",
      "документац",
      "ридми",
      "инструкц",
      "дальнейшей разработки",
    ])
  );
}

function isExplicitFilePath(
  file: ProjectInventoryFile,
  tokenContext: TokenContext,
) {
  return tokenContext.explicitExistingPaths.some(
    (pathValue) =>
      normalizeForCompare(pathValue) === normalizeForCompare(file.path),
  );
}

function getFileConstraintText(file: ProjectInventoryFile) {
  // Constraints should identify protected files/routes by stable inventory metadata.
  // Do not use full contentPreview here: a delivery page may link to contacts/catalog,
  // but that does not mean the delivery page itself is forbidden.
  return normalizeForCompare(
    [
      file.path,
      file.name,
      file.extension,
      file.kind,
      file.role,
      file.routePath ?? "",
      ...(file.imports ?? []),
      ...(file.exports ?? []),
      ...(file.symbols ?? []),
    ].join(" "),
  );
}

function isBackendProtectionTerm(term: string) {
  return [
    "backend",
    "server",
    "api",
    "auth",
    "authorization",
    "authentication",
    "session",
    "token",
    "cookie",
    "database",
    "db",
    "бэк",
    "бек",
    "бэкенд",
    "бекенд",
    "апи",
    "авторизац",
    "аутентиф",
    "сесс",
    "токен",
    "куки",
    "база",
    "бд",
  ].includes(normalizeForCompare(term));
}

function hasUiProtectionScope(constraints: TaskConstraints) {
  return constraints.protectedFileTerms.some((term) => {
    const normalized = normalizeForCompare(term);
    return [
      "ui",
      "ux",
      "card",
      "cards",
      "component",
      "components",
      "page",
      "pages",
      "screen",
      "screens",
      "visual",
      "style",
      "styles",
    ].includes(normalized);
  });
}

function hasProtectedTermMatch(
  file: ProjectInventoryFile,
  constraints: TaskConstraints,
  area: EffectiveTaskArea,
) {
  if (constraints.protectedFileTerms.length === 0) return false;
  const fileText = getFileConstraintText(file);
  return constraints.protectedFileTerms.some((term) => {
    if (
      constraints.runtimeNoBackendConstraint &&
      !isBackendProtectionTerm(term) &&
      hasRuntimeUiSurfaceTerm(term)
    ) {
      return false;
    }
    if (
      area === "backend" &&
      hasUiProtectionScope(constraints) &&
      !isBackendProtectionTerm(term) &&
      (isBackendProtectedRole(file) ||
        isBackendProtectedPath(file) ||
        isServerSidePath(file.path))
    ) {
      return false;
    }
    if (!normalizedTermMatches(fileText, term)) return false;
    if (!isBackendProtectionTerm(term)) return true;

    return (
      isBackendProtectedRole(file) ||
      isBackendProtectedPath(file) ||
      isAuthProtectedFile(file) ||
      isServerSidePath(file.path) ||
      isClientApiBridgePath(file.path) ||
      (isBackendLeaningPath(file.path) && !isClientUiPath(file.path))
    );
  });
}

function isProtectedByUserConstraint(
  file: ProjectInventoryFile,
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
  tokenContext = buildTokenContext(input),
) {
  const constraints = getTaskConstraints(input);
  const explicit = isExplicitFilePath(file, tokenContext);
  if (explicit) return false;

  if (
    constraints.onlyExplicitFiles &&
    tokenContext.explicitExistingPaths.length > 0
  ) {
    return true;
  }

  if (hasProtectedTermMatch(file, constraints, area)) {
    return true;
  }

  if (
    hasProtectedShellOrGlobalTerms(constraints) &&
    isAppShellOrEntrypointFile(file)
  ) {
    return true;
  }

  if (
    constraints.protectedFileTerms.some((term) =>
      [
        "style",
        "styles",
        "css",
        "стил",
        "global",
        "globals",
        "глобаль",
      ].includes(normalizeForCompare(term)),
    ) &&
    isGlobalStyleFile(file)
  ) {
    return true;
  }

  if (constraints.protectOtherPages) {
    const strongMatches = getStrongTokenMatchCountForFile(
      file,
      tokenContext.strongTokens,
    );
    if (isRouteOrPageLikeFile(file) && strongMatches === 0) return true;
    if (isGlobalStyleFile(file) && area === "ui") return true;
  }

  return false;
}

function hasExplicitPrimaryTarget(
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
) {
  const tokenContext = buildTokenContext(input);
  return tokenContext.explicitExistingPaths.some((pathValue) => {
    const file = findInventoryFile(input.inventory, pathValue);
    return Boolean(file && !isSecondaryDocumentationMention(file, input, area));
  });
}

function isSpecificPageOrFileTask(
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
) {
  const text = normalizeForCompare(input.rawTask);
  if (hasExplicitPrimaryTarget(input, area)) return true;
  if (
    includesAny(text, [
      "в файле",
      "in file",
      "в компоненте",
      "in component",
      "на странице",
      "страница",
      "страницу",
      "странице",
      "страницы",
      "on page",
      "page",
      "page with",
      "раздел",
      "section",
      "screen",
      "экран",
      "вкладк",
      "view",
    ])
  )
    return true;
  if (area === "ui" || area === "general" || area === "bugfix") {
    const tokenContext = buildTokenContext(input);
    const hasConcreteSemanticSurface =
      hasSpecificUiObjectIntent(input) ||
      isHomePageTask(input) ||
      tokenContext.routeMentions.length > 0 ||
      getConcretePageLocationTokens(input).length > 0;
    if (
      hasConcreteSemanticSurface &&
      input.inventory.files
        .filter((file) => isPageLikeTargetFile(file))
        .some(
          (file) => getPageSemanticMatchScore(file, input, tokenContext) >= 82,
        )
    ) {
      return true;
    }
  }
  if (
    mentionsOtherPagesProtected(input.rawTask) ||
    mentionsOnlyExplicitFiles(input.rawTask)
  )
    return true;
  return false;
}

function isBroadUiScopeTask(
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
) {
  if (area !== "ui" && area !== "general" && area !== "fullstack") return false;
  if (hasExplicitPrimaryTarget(input, area)) return false;

  const text = normalizeForCompare(getPositiveTaskText(input.rawTask));
  return (
    includesAny(text, [
      "across the site",
      "whole site",
      "site-wide",
      "all pages",
      "every page",
      "global layout",
      "mobile responsiveness",
      "responsive layout",
      "adaptive layout",
      "\u0432\u0435\u0441\u044c \u0441\u0430\u0439\u0442",
      "\u043f\u043e \u0432\u0441\u0435\u043c\u0443 \u0441\u0430\u0439\u0442\u0443",
      "\u0432\u0441\u0435 \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u044b",
      "\u043d\u0430 \u0432\u0441\u0435\u0445 \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0430\u0445",
      "\u0430\u0434\u0430\u043f\u0442\u0438\u0432\u043d\u043e\u0441\u0442\u044c \u0441\u0430\u0439\u0442\u0430",
      "\u043c\u043e\u0431\u0438\u043b\u044c\u043d\u0430\u044f \u0432\u0435\u0440\u0441\u0438\u044f",
    ]) ||
    (includesAny(text, [
      "responsive",
      "mobile",
      "\u0430\u0434\u0430\u043f\u0442\u0438\u0432",
      "\u043c\u043e\u0431\u0438\u043b",
    ]) &&
      includesAny(text, [
        "site",
        "layout",
        "pages",
        "\u0441\u0430\u0439\u0442",
        "\u043b\u0435\u0439\u0430\u0443\u0442",
        "\u0441\u0442\u0440\u0430\u043d\u0438\u0446",
      ]))
  );
}

function isAmbiguousLowSignalTask(
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
  tokenContext: TokenContext,
) {
  if (area === "docs" || area === "tests" || area === "build") return false;
  if (hasExplicitPrimaryTarget(input, area)) return false;
  if (tokenContext.explicitExistingPaths.length > 0) return false;
  if (tokenContext.explicitMissingPaths.length > 0) return false;
  if (extractRouteMentions(input.rawTask).length > 0) return false;
  if (getConcretePageLocationTokens(input).length > 0) return false;
  if (hasRawConcretePageLocation(input, area, tokenContext)) return false;
  if (hasCreateTargetIntent(input)) return false;

  const text = normalizeForCompare(getPositiveTaskText(input.rawTask));
  const specificTokens = getSpecificPositiveTokens(input).filter(
    (token) =>
      token.length >= 4 &&
      ![
        "make",
        "project",
        "better",
        "good",
        "nice",
        "improve",
        "update",
        "change",
        "fix",
        "code",
        "front",
        "frontend",
        "backend",
        "server",
        "client",
        "page",
        "component",
        "interface",
        "polish",
        "visual",
        "layout",
        "feel",
        "ui",
        "ux",
      ].includes(token),
  );

  return (
    specificTokens.length < 2 &&
    includesAny(text, [
      "make",
      "improve",
      "better",
      "fix",
      "update",
      "change",
      "polish",
      "\u0441\u0434\u0435\u043b\u0430\u0439",
      "\u0443\u043b\u0443\u0447\u0448",
      "\u043b\u0443\u0447\u0448\u0435",
      "\u0438\u0441\u043f\u0440\u0430\u0432",
      "\u043e\u0431\u043d\u043e\u0432",
      "\u0438\u0437\u043c\u0435\u043d",
    ])
  );
}

function isUiTaskWithBackendMutationConflict(input: SelectTaskFilesInput) {
  const selectedType = normalizeForCompare(input.taskType);
  if (selectedType !== "ui" && selectedType !== "frontend") return false;

  const text = normalizeForCompare(getPositiveTaskText(input.rawTask));
  const asksBackendMutation =
    includesAny(text, [
      "backend endpoint",
      "server endpoint",
      "api endpoint",
      "new endpoint",
      "add endpoint",
      "create endpoint",
      "backend route",
      "api route",
      "server route",
      "\u0431\u044d\u043a\u0435\u043d\u0434",
      "\u0431\u0435\u043a\u0435\u043d\u0434",
      "\u044d\u043d\u0434\u043f\u043e\u0438\u043d\u0442",
      "\u0440\u043e\u0443\u0442",
      "\u043c\u0430\u0440\u0448\u0440\u0443\u0442 api",
    ]) &&
    includesAny(text, [
      "add",
      "create",
      "implement",
      "build",
      "write",
      "new",
      "\u0434\u043e\u0431\u0430\u0432",
      "\u0441\u043e\u0437\u0434",
      "\u0440\u0435\u0430\u043b\u0438\u0437",
      "\u043d\u043e\u0432",
    ]);

  return asksBackendMutation;
}

function getStrongTokenMatchCountForFile(
  file: ProjectInventoryFile,
  strongTokens: string[],
) {
  const fileText = getFileSearchText(file);
  const pathSegments = tokenize(file.path);
  let count = 0;

  for (const token of strongTokens) {
    if (pathSegments.includes(token) || fileText.includes(token)) count += 1;
  }

  return count;
}

function hasAnyStrongMatchForFile(
  file: ProjectInventoryFile,
  strongTokens: string[],
) {
  return getStrongTokenMatchCountForFile(file, strongTokens) > 0;
}

function scorePathTokenMatches(
  file: ProjectInventoryFile,
  tokenContext: TokenContext,
) {
  const filePath = normalizeForCompare(file.path);
  const fileText = getFileSearchText(file);
  const pathSegments = tokenize(file.path);
  let score = 0;

  for (const token of tokenContext.strongTokens) {
    if (pathSegments.includes(token)) score += 42;
    else if (filePath.includes(token)) score += 30;
    else if (
      (file.textHints ?? []).some((hint) => normalizeForCompare(hint) === token)
    )
      score += 26;
    else if (fileText.includes(token)) score += 14;
  }

  for (const token of tokenContext.broadTokens) {
    if (BROAD_PATH_TOKENS.has(token)) continue;
    if (pathSegments.includes(token)) score += 8;
    else if (filePath.includes(token)) score += 5;
    else if (fileText.includes(token)) score += 2;
  }

  return score;
}

function scoreFileFallbackUncached(
  file: ProjectInventoryFile,
  tokenContext: TokenContext,
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
  assetMode: AssetMode,
) {
  const filePath = normalizeForCompare(file.path);
  const constraints = getTaskConstraints(input);
  let score = getKindWeight(file, area, assetMode);
  score += scorePathTokenMatches(file, tokenContext);
  const routeScore = getRouteMatchScore(file, tokenContext.routeMentions);
  const pageSemanticScore = getPageSemanticMatchScore(
    file,
    input,
    tokenContext,
  );
  score += routeScore;
  score += Math.min(180, pageSemanticScore);

  const strongMatchCount = getStrongTokenMatchCountForFile(
    file,
    tokenContext.strongTokens,
  );
  const hasStrongTokens = tokenContext.strongTokens.length > 0;
  const hasStrongMatch = strongMatchCount > 0;

  if (strongMatchCount >= 2) score += 20;
  if (strongMatchCount >= 3) score += 20;
  if (file.canReadText) score += 5;
  if (file.depth <= 3) score += 4;
  if (isSystemSeoFile(file) && !isSystemSeoRelevantForTask(input)) score -= 120;
  if (file.isLikelyGenerated) score -= 35;
  if (isGeneratedDoNotEditPath(file.path)) score -= 18;
  if (file.kind === "runtime") score -= 60;
  if (file.sizeBytes === 0) score -= 35;

  if (
    isGlobalStyleFile(file) &&
    isSpecificPageOrFileTask(input, area) &&
    !isGlobalStyleRelevantForTask(input)
  ) {
    score -= 85;
  }

  if (area === "backend") {
    if (isBackendLeaningPath(file.path)) score += 48;
    if (isClientApiBridgePath(file.path)) score += 20;
    if (isClientUiPath(file.path) && !isClientApiBridgePath(file.path))
      score -= 65;
    if (file.kind === "style" || file.kind === "asset") score -= 75;
  }

  if (area === "fullstack") {
    if (isBackendLeaningPath(file.path)) score += 30;
    if (isClientApiBridgePath(file.path)) score += 38;
    if (isLikelyFullstackUiActionFile(file, input)) score += 56;
    else if (isFrontendUiSourceFile(file) && hasStrongMatch) score += 32;
    if (file.kind === "style") score += 4;

    // Avoid treating backend/domain pipeline files as enough UI context for button/action tasks.
    if (filePath.startsWith("src/app/") && !isEntryOrFrameworkPath(file.path))
      score -= 45;
    if (
      includesAny(filePath, ["/core/", "/report/", "/io/"]) &&
      !hasStrongMatch
    )
      score -= 35;
  }

  if (area === "ui") {
    if (file.kind === "style") score += 18;
    if (filePath.includes("/components/")) score += 12;
    if (filePath.includes("/pages/") || filePath.includes("/app/")) score += 12;
    if (isClientUiPath(file.path) && !isClientApiBridgePath(file.path))
      score += 18;
    if (isServerSidePath(file.path) && !hasStrongMatch) score -= 45;

    if (
      constraints.noBackendMutation &&
      (isBackendLeaningPath(file.path) || isClientApiBridgePath(file.path))
    ) {
      score -= hasStrongMatch ? 35 : 95;
    }
  }

  if (area === "docs") {
    if (filePath.endsWith("readme.md")) score += 45;
    if (file.kind === "docs" && hasStrongMatch) score += 90;
    if (
      file.kind === "docs" &&
      tokenContext.strongTokens.some((token) =>
        [
          "api",
          "reference",
          "curl",
          "guide",
          "docs",
          "document",
          "setup",
        ].includes(token),
      )
    ) {
      score += 70;
    }
    if (isPackageOrConfigPath(file.path)) score += 32;
    if (file.kind === "source") score -= 35;
    const hasExplicitMarkdownTarget = tokenContext.explicitExistingPaths.some(
      (pathValue) => {
        const explicitFile = findInventoryFile(input.inventory, pathValue);
        return explicitFile?.kind === "docs";
      },
    );
    if (hasExplicitMarkdownTarget && file.kind === "source") score -= 90;
  }

  if (area === "build") {
    if (isPackageOrConfigPath(file.path)) score += 42;
    if (isEntryOrFrameworkPath(file.path)) score += 18;
    if (filePath.endsWith("next-env.d.ts")) score -= 30;
    if (filePath.includes("/content/") && !hasStrongMatch) score -= 28;
  }

  if (assetMode === "primary" && file.kind === "asset") {
    score += isUsefulAssetForTask(file, input) ? 46 : 8;
  }

  if (assetMode === "primary" && file.kind !== "asset") {
    if (isAssetReferenceControllerPath(file.path)) score += 28;
    else if (file.kind === "style") score -= 18;
    else if (isPackageOrConfigPath(file.path)) score -= 22;
    else score -= 75;
  }

  if (assetMode === "mixed" && file.kind === "asset") score -= 10;
  if (assetMode === "none" && file.kind === "asset") score -= 120;
  if (
    hasStrongTokens &&
    !hasStrongMatch &&
    isClientUiPath(file.path) &&
    area !== "ui" &&
    area !== "fullstack"
  )
    score -= 18;

  return score;
}

function scoreFileFallback(
  file: ProjectInventoryFile,
  tokenContext: TokenContext,
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
  assetMode: AssetMode,
) {
  let scores = fallbackScoreCache.get(input);
  if (!scores) {
    scores = new Map<string, number>();
    fallbackScoreCache.set(input, scores);
  }
  const key = `${normalizeForCompare(file.path)}|${area}|${assetMode}`;
  const cached = scores.get(key);
  if (cached !== undefined) return cached;
  const value = scoreFileFallbackUncached(
    file,
    tokenContext,
    input,
    area,
    assetMode,
  );
  scores.set(key, value);
  return value;
}

function getAssetCap(assetMode: AssetMode) {
  if (assetMode === "primary") return 3;
  if (assetMode === "mixed") return 2;
  return 0;
}

function selectedPriority(
  file: SelectedTaskFile,
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
  assetMode: AssetMode,
) {
  const filePath = normalizeForCompare(file.path);
  const constraints = getTaskConstraints(input);
  let priority = file.confidence * 100;

  if (file.reason.toLowerCase().includes("explicitly mentioned")) {
    priority += 1000;
  }

  if (file.reason.toLowerCase().includes("structured task intent")) {
    priority += 520;
  }

  if (file.reason.toLowerCase().includes("semantic graph support")) {
    priority += file.usage === "inspect-and-edit" ? 190 : 95;
  }

  const tokenContextForPriority = buildTokenContext(input);
  const inventoryFileForPriority = findInventoryFile(
    input.inventory,
    file.path,
  );
  const weakFallbackReason = file.reason
    .toLowerCase()
    .includes("domain-specific graph/token evidence is weak");
  if (inventoryFileForPriority) {
    if (hasDomainSpecificFallbackEvidence(inventoryFileForPriority, input)) {
      priority += 95;
    }
    if (
      area === "backend" &&
      file.usage === "inspect-only" &&
      weakFallbackReason
    ) {
      priority -= 95;
    }
  }
  const pathStrongMatchCount = getStrongTokenMatchCount(
    file.path,
    tokenContextForPriority.strongTokens,
  );
  if (
    area === "ui" &&
    file.kind === "source" &&
    pathStrongMatchCount > 0 &&
    isClientUiPath(file.path)
  ) {
    priority += 110 + Math.min(60, pathStrongMatchCount * 20);
  }
  if (
    area === "ui" &&
    file.kind === "style" &&
    pathStrongMatchCount === 0 &&
    !isGlobalStyleRelevantForTask(input)
  ) {
    priority -= 25;
  }

  const routeScore = getRouteMatchScore(
    {
      path: file.path,
      kind: file.kind,
      sizeBytes: 1,
      canReadText: true,
      isLikelyGenerated: false,
      extension: "",
      depth: 0,
      name: file.path.split("/").pop() ?? file.path,
    } as ProjectInventoryFile,
    tokenContextForPriority.routeMentions,
  );
  if (
    isDirectRoutePageMatch(
      {
        path: file.path,
        kind: file.kind,
        sizeBytes: 1,
        canReadText: true,
        isLikelyGenerated: false,
        extension: "",
        depth: 0,
        name: file.path.split("/").pop() ?? file.path,
      } as ProjectInventoryFile,
      tokenContextForPriority.routeMentions,
    )
  )
    priority += 420;
  else if (routeScore >= 88) priority += 190;
  else if (routeScore > 0) priority += 35;
  if (file.reason.toLowerCase().includes("concrete page target"))
    priority += 360;

  if (isRouteScopedTask(input, area, tokenContextForPriority)) {
    if (
      isAppShellOrEntrypointFile({
        path: file.path,
        kind: file.kind,
      } as ProjectInventoryFile)
    )
      priority -= 260;
    if (
      isGenericSharedUiPrimitive({
        path: file.path,
        kind: file.kind,
      } as ProjectInventoryFile)
    )
      priority -= 120;
  }

  if (assetMode === "primary") {
    if (file.kind === "asset") priority += 140;
    if (includesAny(filePath, ["logo", "favicon", "icon", "brand"]))
      priority += 55;
    if (isAssetReferenceControllerPath(file.path)) priority += 55;
    if (
      file.kind !== "asset" &&
      !isAssetReferenceControllerPath(file.path) &&
      file.kind !== "style"
    )
      priority -= 140;
  }

  if (area === "build") {
    if (normalizeForCompare(file.path).endsWith("package.json"))
      priority += 120;
    else if (isPackageOrConfigPath(file.path)) priority += 90;
    else if (isEntryOrFrameworkPath(file.path)) priority += 55;
  }

  if (area === "docs") {
    if (file.kind === "docs") priority += 130;
    if (normalizeForCompare(file.path).endsWith("package.json"))
      priority += 100;
    else if (isPackageOrConfigPath(file.path)) priority += 60;
    if (file.kind === "source") priority -= 80;
  }

  if (area === "backend") {
    if (isBackendLeaningPath(file.path)) priority += 120;
    if (isClientApiBridgePath(file.path)) priority += 60;
    if (file.kind === "config") priority += 15;
  }

  if (area === "fullstack") {
    if (isClientApiBridgePath(file.path)) priority += 110;
    if (
      isLikelyFullstackUiActionFile(
        {
          path: file.path,
          kind: file.kind,
          sizeBytes: 1,
          canReadText: true,
          isLikelyGenerated: false,
          extension: "",
          depth: 0,
          name: file.path.split("/").pop() ?? file.path,
        } as ProjectInventoryFile,
        input,
      )
    )
      priority += 108;
    else if (
      file.kind === "source" &&
      isClientUiPath(file.path) &&
      !isClientApiBridgePath(file.path)
    )
      priority += 82;
    if (isBackendLeaningPath(file.path)) priority += 88;
    if (file.kind === "style") priority -= 18;
    if (filePath.startsWith("src/app/") && !isEntryOrFrameworkPath(file.path))
      priority -= 65;
  }

  if (area === "ui") {
    if (file.kind === "style")
      priority +=
        isGlobalStyleFile({
          path: file.path,
          kind: file.kind,
        } as ProjectInventoryFile) &&
        isSpecificPageOrFileTask(input, area) &&
        !isGlobalStyleRelevantForTask(input)
          ? -35
          : 58;
    if (isClientUiPath(file.path)) priority += 72;
    if (isServerSidePath(file.path)) priority -= 80;
  }

  if (constraints.noBackendMutation) {
    if (isBackendLeaningPath(file.path) || isClientApiBridgePath(file.path)) {
      priority -= 140;
    }

    if (
      (file.kind === "style" || isClientUiPath(file.path)) &&
      !isClientApiBridgePath(file.path)
    ) {
      priority += 70;
    }
  }

  if (constraints.noFrontendMutation) {
    if (isClientUiPath(file.path) && !isClientApiBridgePath(file.path)) {
      priority -= 120;
    }

    if (isBackendLeaningPath(file.path)) {
      priority += 80;
    }
  }

  if (isLockFilePath(file.path)) priority -= 250;
  if (filePath.endsWith("next-env.d.ts") || filePath.endsWith("vite-env.d.ts"))
    priority -= 100;

  return priority;
}

function clampComposerLimit(value: unknown, fallback: number) {
  const limit = Number(value);

  if (!Number.isFinite(limit)) {
    return fallback;
  }

  return Math.min(24, Math.max(3, Math.round(limit)));
}

function getDefaultSelectionLimit(
  area: EffectiveTaskArea,
  assetMode: AssetMode,
) {
  if (assetMode === "primary") return 7;
  if (area === "build") return 7;
  if (area === "docs") return 6;
  if (area === "backend") return 8;
  if (area === "fullstack") return 10;
  if (area === "ui") return 7;
  if (area === "tests") return 7;
  if (area === "bugfix") return 7;
  if (area === "refactor") return 8;

  return 8;
}

function getSelectionLimitFromSettings(
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
  assetMode: AssetMode,
) {
  const limits = input.settings?.composerFileLimits;
  const fallback = getDefaultSelectionLimit(area, assetMode);

  if (!limits) {
    return fallback;
  }

  const areaLimit = limits[area as keyof typeof limits];

  return clampComposerLimit(areaLimit ?? limits.default, fallback);
}

function getContextAwareSelectionLimit(
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
  assetMode: AssetMode,
) {
  const configuredLimit = getSelectionLimitFromSettings(input, area, assetMode);
  const tokenContext = buildTokenContext(input);
  const constraints = getTaskConstraints(input);
  const explicitPrimaryCount = tokenContext.explicitExistingPaths.filter(
    (pathValue) => {
      const file = findInventoryFile(input.inventory, pathValue);
      return Boolean(
        file && !isSecondaryDocumentationMention(file, input, area),
      );
    },
  ).length;

  if (constraints.onlyExplicitFiles && explicitPrimaryCount > 0) {
    return Math.max(1, explicitPrimaryCount);
  }

  if (explicitPrimaryCount > 0) {
    return Math.min(configuredLimit, Math.max(explicitPrimaryCount + 2, 3));
  }

  if (isSpecificPageOrFileTask(input, area)) {
    return Math.min(configuredLimit, constraints.protectOtherPages ? 5 : 7);
  }

  return configuredLimit;
}

function rankAndCapSelection(
  selectedFiles: SelectedTaskFile[],
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
  assetMode: AssetMode,
) {
  const seen = new Set<string>();
  const scopedFiles = applyVisualOnlyScopeGuard(selectedFiles, input, area);
  const deduped = scopedFiles.filter((file) => {
    const normalized = normalizeForCompare(file.path);
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });

  const sorted = deduped.sort(
    (a, b) =>
      selectedPriority(b, input, area, assetMode) -
      selectedPriority(a, input, area, assetMode),
  );

  if (assetMode === "primary") {
    const assets = sorted
      .filter((file) => file.kind === "asset")
      .slice(0, getAssetCap(assetMode));
    const controllers = sorted
      .filter(
        (file) =>
          file.kind !== "asset" && isAssetReferenceControllerPath(file.path),
      )
      .slice(0, 3);
    const styles = sorted
      .filter((file) => file.kind === "style")
      .slice(0, controllers.length === 0 ? 1 : 0);

    return [...assets, ...controllers, ...styles].slice(0, 7);
  }

  const assetCap = getAssetCap(assetMode);
  let assetCount = 0;

  const selectionLimit = getContextAwareSelectionLimit(input, area, assetMode);

  const capped = sorted
    .filter((file) => {
      if (file.kind !== "asset") return true;
      if (assetCount >= assetCap) return false;
      assetCount += 1;
      return true;
    })
    .slice(0, Math.min(MAX_SELECTED_FILES, selectionLimit));

  return area === "fullstack"
    ? rebalanceFullstackSelection(capped, sorted, input)
    : capped;
}

function rebalanceFullstackSelection(
  capped: SelectedTaskFile[],
  sorted: SelectedTaskFile[],
  input: SelectTaskFilesInput,
) {
  const result = [...capped];
  const hasPath = (pathValue: string) =>
    result.some(
      (file) =>
        normalizeForCompare(file.path) === normalizeForCompare(pathValue),
    );
  const findCandidate = (predicate: (file: SelectedTaskFile) => boolean) => {
    const sortedCandidate = sorted.find(
      (file) => predicate(file) && !hasPath(file.path),
    );
    if (sortedCandidate) return sortedCandidate;

    return input.inventory.files
      .filter((file) => !hasPath(file.path))
      .filter((file) => canUseSelectedFile(input, file, "fullstack", "none"))
      .map((file) =>
        makeSelectedFile(
          file,
          "Added by full-stack layer balancing from validated project inventory.",
          0.76,
        ),
      )
      .find(predicate);
  };
  const replaceWeakest = (candidate: SelectedTaskFile) => {
    if (hasPath(candidate.path)) return;
    const uiSourceCount = result.filter(isUiSource).length;
    const replaceIndex = [...result].reverse().findIndex((file) => {
      if (isClientBridge(file) || isBackend(file)) return false;
      if (isUiSource(file) && uiSourceCount <= 1) return false;
      return true;
    });
    if (replaceIndex === -1) return;
    result[result.length - 1 - replaceIndex] = candidate;
  };
  const isClientBridge = (file: SelectedTaskFile) => {
    const inventoryFile = findInventoryFile(input.inventory, file.path);
    return Boolean(inventoryFile && isClientApiBridgePath(inventoryFile.path));
  };
  const isBackend = (file: SelectedTaskFile) => {
    const inventoryFile = findInventoryFile(input.inventory, file.path);
    return Boolean(
      inventoryFile &&
      isBackendLeaningPath(inventoryFile.path) &&
      !isClientUiPath(inventoryFile.path),
    );
  };
  const isUiSource = (file: SelectedTaskFile) => {
    const inventoryFile = findInventoryFile(input.inventory, file.path);
    return Boolean(inventoryFile && isFrontendUiSourceFile(inventoryFile));
  };
  if (!result.some(isClientBridge)) {
    const candidate = findCandidate(isClientBridge);
    if (candidate) replaceWeakest(candidate);
  }

  if (!result.some(isBackend)) {
    const candidate = findCandidate(isBackend);
    if (candidate) replaceWeakest(candidate);
  }

  if (!result.some(isUiSource)) {
    const candidate = findCandidate(isUiSource);
    if (candidate) replaceWeakest(candidate);
  }

  return result;
}

function ensureRequiredFullstackLayers(
  selected: SelectedTaskFile[],
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
  assetMode: AssetMode,
) {
  if (area !== "fullstack") return selected;

  const result = [...selected];
  const hasPath = (pathValue: string) =>
    result.some(
      (file) =>
        normalizeForCompare(file.path) === normalizeForCompare(pathValue),
    );
  const addLayer = (
    predicate: (file: ProjectInventoryFile) => boolean,
    reason: string,
    confidence: number,
  ) => {
    if (
      result.some((selectedFile) => {
        const inventoryFile = findInventoryFile(
          input.inventory,
          selectedFile.path,
        );
        return Boolean(inventoryFile && predicate(inventoryFile));
      })
    ) {
      return;
    }

    const file = input.inventory.files
      .filter(
        (candidate) =>
          !hasPath(candidate.path) &&
          canUseSelectedFile(input, candidate, area, assetMode) &&
          predicate(candidate),
      )
      .sort((left, right) => {
        const score = (file: ProjectInventoryFile) => {
          let value = 0;
          if (file.kind === "source") value += 30;
          if (
            ["api-route", "server-entry", "service", "controller"].includes(
              file.role,
            )
          )
            value += 24;
          if (normalizeForCompare(file.path).includes("/data/")) value -= 18;
          if (file.kind === "data") value -= 20;
          return value;
        };

        return score(right) - score(left);
      })[0];
    if (file) result.push(makeSelectedFile(file, reason, confidence));
  };

  addLayer(
    (file) => isClientApiBridgePath(file.path),
    "Added to keep the client API bridge in the full-stack context.",
    0.8,
  );
  addLayer(
    (file) =>
      isBackendLeaningPath(file.path) &&
      !isClientApiBridgePath(file.path) &&
      !isClientUiPath(file.path),
    "Added to keep the backend/server layer in the full-stack context.",
    0.78,
  );
  addLayer(
    (file) => isFrontendUiSourceFile(file),
    "Added to keep a concrete UI source in the full-stack context.",
    0.78,
  );

  return pruneFullstackSelection(result, input, assetMode).slice(
    0,
    Math.min(
      MAX_SELECTED_FILES,
      getSelectionLimitFromSettings(input, area, assetMode),
    ),
  );
}

function pruneFullstackSelection(
  selected: SelectedTaskFile[],
  input: SelectTaskFilesInput,
  assetMode: AssetMode,
) {
  const tokenContext = buildTokenContext(input);
  const limit = Math.min(
    MAX_SELECTED_FILES,
    getSelectionLimitFromSettings(input, "fullstack", assetMode),
  );
  const explicitPaths = new Set(
    tokenContext.explicitExistingPaths.map(normalizeForCompare),
  );
  const seen = new Set<string>();
  const uniqueSelected = selected.filter((file) => {
    const key = normalizeForCompare(file.path);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const withInventory = uniqueSelected
    .map((selectedFile) => ({
      selectedFile,
      inventoryFile: findInventoryFile(input.inventory, selectedFile.path),
    }))
    .filter(
      (
        item,
      ): item is {
        selectedFile: SelectedTaskFile;
        inventoryFile: ProjectInventoryFile;
      } => Boolean(item.inventoryFile),
    );

  const isClientBridge = (file: ProjectInventoryFile) =>
    isClientApiBridgePath(file.path);
  const isBackendLayer = (file: ProjectInventoryFile) =>
    isBackendLeaningPath(file.path) &&
    !isClientApiBridgePath(file.path) &&
    !isClientUiPath(file.path);
  const isUiSource = (file: ProjectInventoryFile) =>
    isFrontendUiSourceFile(file);
  const uiTargetLimit = taskAllowsMultipleConcretePageTargets(
    input,
    tokenContext,
  )
    ? 2
    : 1;
  const required: SelectedTaskFile[] = [];
  const addUnique = (file: SelectedTaskFile) => {
    if (
      required.some(
        (item) =>
          normalizeForCompare(item.path) === normalizeForCompare(file.path),
      )
    )
      return;
    required.push(file);
  };

  for (const item of withInventory) {
    if (explicitPaths.has(normalizeForCompare(item.selectedFile.path)))
      addUnique(item.selectedFile);
  }

  const clientBridge = withInventory.find((item) =>
    isClientBridge(item.inventoryFile),
  );
  const backendLayer = withInventory.find((item) =>
    isBackendLayer(item.inventoryFile),
  );
  if (clientBridge) addUnique(clientBridge.selectedFile);
  if (backendLayer) addUnique(backendLayer.selectedFile);

  const uiTargets = withInventory
    .filter((item) => isUiSource(item.inventoryFile))
    .map((item) => ({
      ...item,
      score: scoreFullstackPrimaryUiTarget(
        item.inventoryFile,
        input,
        tokenContext,
      ),
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.inventoryFile.path.localeCompare(b.inventoryFile.path),
    )
    .slice(0, uiTargetLimit);
  for (const item of uiTargets) addUnique(item.selectedFile);

  const support = withInventory
    .filter(
      (item) =>
        !required.some(
          (file) =>
            normalizeForCompare(file.path) ===
            normalizeForCompare(item.selectedFile.path),
        ),
    )
    .filter(
      (item) =>
        !isPageLikeTargetFile(item.inventoryFile) ||
        item.selectedFile.usage === "inspect-only",
    )
    .filter(
      (item) =>
        !isFrontendUiSourceFile(item.inventoryFile) ||
        scoreFullstackPrimaryUiTarget(
          item.inventoryFile,
          input,
          tokenContext,
        ) >= 90,
    )
    .map((item) => ({
      ...item,
      score: selectedPriority(item.selectedFile, input, "fullstack", assetMode),
    }))
    .sort((a, b) => b.score - a.score);

  const finalSelection = [...required];
  for (const item of support) {
    if (finalSelection.length >= limit) break;
    if (
      finalSelection.some(
        (file) =>
          normalizeForCompare(file.path) ===
          normalizeForCompare(item.selectedFile.path),
      )
    )
      continue;
    finalSelection.push(item.selectedFile);
  }

  return finalSelection;
}

function scoreFullstackPrimaryUiTarget(
  file: ProjectInventoryFile,
  input: SelectTaskFilesInput,
  tokenContext = buildTokenContext(input),
) {
  if (!isFrontendUiSourceFile(file)) return Number.NEGATIVE_INFINITY;

  const filePath = normalizeForCompare(file.path);
  const fileName = filePath.split("/").pop() ?? filePath;
  let score = scoreFullstackUiSourceCandidate(file, input);

  score += getPageSemanticMatchScore(file, input, tokenContext) * 0.6;
  score +=
    getSpecificPositiveOverlap(file, getSpecificPositiveTokens(input)) * 42;
  score +=
    getSpecificIdentityOverlap(file, getSpecificPositiveTokens(input)) * 48;

  if (isPageLikeTargetFile(file)) score += 28;
  if (file.role === "component" || file.role === "ui-component") score += 18;
  if (
    file.routePath &&
    tokenContext.routeMentions.some(
      (route) =>
        normalizeForCompare(route) ===
        normalizeForCompare(file.routePath ?? ""),
    )
  )
    score += 120;
  if (
    filePath.includes("/components/") &&
    getSpecificPositiveOverlap(file, getSpecificPositiveTokens(input)) === 0
  )
    score -= 20;
  if (includesAny(fileName, ["skeleton", "placeholder", "fallback", "loading"]))
    score -= 95;
  if (
    includesAny(filePath, ["/onboarding", "/demo", "/example"]) &&
    !hasAnyStrongMatchForFile(file, tokenContext.strongTokens)
  )
    score -= 70;
  if (
    isAppShellOrEntrypointFile(file) &&
    !tokenContext.explicitExistingPaths.some(
      (pathValue) => normalizeForCompare(pathValue) === filePath,
    )
  )
    score -= 60;

  return score;
}

function trimLowValueFallbackCandidates(
  items: Array<{ file: ProjectInventoryFile; score: number }>,
  tokenContext: TokenContext,
  area: EffectiveTaskArea,
) {
  if (items.length === 0) return [];
  const maxScore = items[0]?.score ?? 0;
  const dynamicThreshold = Math.max(
    area === "docs" || area === "build" ? 28 : 38,
    Math.floor(maxScore * 0.5),
  );

  const trimmed = items.filter((item) => {
    if (isRouteAwarePrimaryCandidate(item.file, tokenContext)) return true;
    if (item.score >= dynamicThreshold) return true;
    if (
      tokenContext.strongTokens.length > 0 &&
      hasAnyStrongMatchForFile(item.file, tokenContext.strongTokens) &&
      item.score >= 32
    )
      return true;
    return false;
  });

  return trimmed;
}

function findInventoryFile(inventory: ProjectInventory, filePath: string) {
  const normalized = normalizeForCompare(filePath);
  return inventory.files.find(
    (file) => normalizeForCompare(file.path) === normalized,
  );
}

function findInventoryFileByLoosePath(
  inventory: ProjectInventory,
  filePath: string,
) {
  const normalized = normalizeForCompare(filePath);
  if (!normalized) return undefined;

  return inventory.files.find((file) => {
    const comparable = normalizeForCompare(file.path);
    return (
      comparable === normalized ||
      comparable.endsWith(`/${normalized}`) ||
      normalized.endsWith(`/${comparable}`)
    );
  });
}

function stripKnownExtension(pathValue: string) {
  return pathValue.replace(/\.[a-z0-9]+$/i, "");
}

function extractExplicitSymbolTargetNames(rawTask: string) {
  const rename = extractSymbolRenameIntent(rawTask);
  return uniqueStrings(
    [
      rename?.from ?? "",
      ...Array.from(
        rawTask.matchAll(
          /\b[A-Z][A-Za-z0-9]*(?:Page|Component|Form|Modal|View|Screen|Layout|Provider|Context|Service|Controller|Repository|Store|Hook)\b/g,
        ),
      )
        .map((match) => match[0])
        .filter(Boolean),
    ].filter((value) => value !== rename?.to),
  );
}

function inventoryHasExplicitSymbolTarget(
  inventory: ProjectInventory,
  targetName: string,
) {
  const target = normalizeForCompare(targetName);
  return inventory.files.some((file) => {
    const fileName = normalizeForCompare(stripKnownExtension(file.name));
    if (fileName === target) return true;
    if (normalizeForCompare(file.path).includes(`/${target}.`)) return true;
    return [...(file.symbols ?? []), ...(file.exports ?? [])].some(
      (symbol) => normalizeForCompare(symbol) === target,
    );
  });
}

function getMissingExplicitSymbolTargets(input: SelectTaskFilesInput) {
  if (hasCreateTargetIntent(input)) return [];
  return extractExplicitSymbolTargetNames(input.rawTask).filter(
    (targetName) =>
      !inventoryHasExplicitSymbolTarget(input.inventory, targetName),
  );
}

function getStructuredIntentTargets(input: SelectTaskFilesInput) {
  return input.taskIntent?.structuredIntent?.primaryTargets ?? [];
}

function getStructuredTargetTerms(target: StructuredIntentTarget) {
  return uniqueStrings(
    [
      target.value,
      target.path ?? "",
      target.routePath ?? "",
      target.name ?? "",
      target.evidence,
    ].flatMap((value) => tokenize(value)),
  )
    .filter((token) => token.length >= 2)
    .filter((token) => !WEAK_TASK_TOKENS.has(token))
    .filter((token) => !BROAD_PATH_TOKENS.has(token))
    .slice(0, 12);
}

function taskMentionsStructuredPath(rawTask: string, filePath: string) {
  const task = normalizeForCompare(rawTask);
  const normalizedPath = normalizeForCompare(filePath);
  const fileName = normalizedPath.split("/").pop() ?? normalizedPath;
  const baseName = fileName.replace(/\.[^.]+$/, "");
  const taskTokens = new Set(tokenize(rawTask));
  const baseTokens = uniqueStrings(
    [baseName, ...tokenizeIdentifierLike(baseName)]
      .map(normalizeForCompare)
      .filter((token) => token.length >= 4),
  );

  return (
    task.includes(normalizedPath) ||
    task.includes(fileName) ||
    baseTokens.some((token) => taskTokens.has(token))
  );
}

function structuredExplicitTargetLooksGrounded(
  input: SelectTaskFilesInput,
  target: StructuredIntentTarget,
) {
  if (!target.path) return false;
  if (
    !["explicit_file", "page", "route", "component", "symbol"].includes(
      target.kind,
    )
  )
    return false;

  const inventoryFile = findInventoryFileByLoosePath(
    input.inventory,
    target.path,
  );
  if (!inventoryFile) return false;

  const positiveText = getPositiveTaskText(input.rawTask);
  const taskTokens = uniqueStrings(
    [
      ...tokenize(positiveText),
      ...(input.taskIntent?.structuredIntent?.positiveActions ?? []).flatMap(
        tokenize,
      ),
      ...(input.taskIntent?.domainTerms ?? []).flatMap(tokenize),
      ...(input.taskIntent?.mentionedEntities ?? []).flatMap(tokenize),
      ...(input.taskIntent?.recommendedSearchTerms ?? []).flatMap(tokenize),
      target.evidence ? tokenize(target.evidence) : [],
    ].flat(),
  )
    .map((token) => token.replace(/\.[a-z0-9]+$/i, ""))
    .filter((token) => token.length >= 4)
    .filter((token) => !WEAK_TASK_TOKENS.has(token))
    .filter((token) => !BROAD_PATH_TOKENS.has(token));

  const locationTokens = getConcretePageLocationTokens(input);
  const identityValues = [
    inventoryFile.path,
    inventoryFile.name,
    inventoryFile.role,
    inventoryFile.routePath ?? "",
    ...(inventoryFile.symbols ?? []),
    ...(inventoryFile.exports ?? []),
    ...(inventoryFile.textHints ?? []),
  ];
  const identityText = normalizeForCompare(identityValues.join(" "));
  const identityTokens = uniqueStrings(
    identityValues.flatMap((value) => [
      ...tokenize(value),
      ...tokenizeIdentifierLike(value),
    ]),
  )
    .map((token) => token.replace(/\.[a-z0-9]+$/i, ""))
    .filter((token) => token.length >= 4)
    .filter((token) => !WEAK_TASK_TOKENS.has(token))
    .filter((token) => !BROAD_PATH_TOKENS.has(token));

  const hasTaskIdentityOverlap = taskTokens.some((token) =>
    identityTokens.some(
      (identityToken) =>
        normalizedTermMatches(identityToken, token) ||
        normalizedTermMatches(token, identityToken),
    ),
  );
  if (hasTaskIdentityOverlap) return true;

  const hasLocationIdentityOverlap = locationTokens.some(
    (token) =>
      normalizedTermMatches(identityText, token) ||
      normalizedTermMatches(token, identityText),
  );
  if (hasLocationIdentityOverlap) return true;

  const surfaceText = [input.rawTask, positiveText, target.evidence ?? ""].join(
    " ",
  );
  if (
    matchesAny(surfaceText, [
      /\b(?:header|topbar|navbar|nav|navigation|menu|theme|locale|language)\b/i,
      /(?:\u0448\u0430\u043f\u043a|\u0432\u0435\u0440\u0445\u043d\u0435\u0435\s+\u043c\u0435\u043d\u044e|\u043d\u0430\u0432\u0438\u0433\u0430\u0446|\u0441\u043c\u0435\u043d\u044b\s+\u044f\u0437\u044b\u043a|\u044f\u0437\u044b\u043a|\u043b\u043e\u043a\u0430\u043b)/i,
    ]) &&
    getHeaderSurfaceScore(inventoryFile) >= 70
  )
    return true;
  if (
    matchesAny(surfaceText, [
      /\b(?:footer|site\s+footer|bottom\s+nav|legal\s+links|footer\s+links)\b/i,
      /(?:\u0444\u0443\u0442\u0435\u0440|\u043d\u0438\u0436\u043d\u0435\u0435\s+\u043c\u0435\u043d\u044e|\u0441\u0441\u044b\u043b\u043a\u0438\s+\u0432\s+\u0444\u0443\u0442\u0435\u0440\u0435)/i,
    ]) &&
    getFooterSurfaceScore(inventoryFile) >= 70
  )
    return true;
  if (
    matchesAny(surfaceText, [
      /\b(?:search|searchbox|search\s+box|search\s+input|filter\s+input|query\s+input)\b/i,
      /(?:\u043f\u043e\u0438\u0441\u043a|\u0441\u0442\u0440\u043e\u043a\u0430\s+\u043f\u043e\u0438\u0441\u043a\u0430|\u043f\u043e\u043b\u0435\s+\u043f\u043e\u0438\u0441\u043a\u0430)/i,
    ]) &&
    getSearchSurfaceScore(inventoryFile) >= 70
  )
    return true;

  return false;
}

function structuredTargetHasTaskSupport(
  input: SelectTaskFilesInput,
  target: StructuredIntentTarget,
) {
  if (!target.path) return true;
  if (taskMentionsStructuredPath(input.rawTask, target.path)) return true;
  if (structuredExplicitTargetLooksGrounded(input, target)) return true;

  const taskTokens = new Set(
    tokenize(getPositiveTaskText(input.rawTask))
      .map((token) => token.replace(/\.[a-z0-9]+$/i, ""))
      .filter((token) => token.length >= 4)
      .filter((token) => !WEAK_TASK_TOKENS.has(token))
      .filter((token) => !BROAD_PATH_TOKENS.has(token)),
  );

  if (taskTokens.size === 0) return false;

  return uniqueStrings(
    [
      target.value,
      target.path ?? "",
      target.routePath ?? "",
      target.name ?? "",
    ].flatMap((value) => tokenize(value)),
  )
    .filter((token) => token.length >= 4)
    .filter((token) => !WEAK_TASK_TOKENS.has(token))
    .filter((token) => !BROAD_PATH_TOKENS.has(token))
    .map((token) => token.replace(/\.[a-z0-9]+$/i, ""))
    .some((token) => taskTokens.has(token));
}

function isUnsupportedStructuredTargetPath(
  input: SelectTaskFilesInput,
  file: ProjectInventoryFile,
) {
  const filePath = normalizeForCompare(file.path);
  return getStructuredIntentTargets(input).some((target) => {
    if (!target.path) return false;
    const targetPath = normalizeForCompare(target.path);
    if (
      filePath !== targetPath &&
      !filePath.endsWith(`/${targetPath}`) &&
      !targetPath.endsWith(`/${filePath}`)
    )
      return false;
    if (hasIndependentTaskSupportForFile(input, file)) return false;
    return !structuredTargetHasTaskSupport(input, target);
  });
}

function hasIndependentTaskSupportForFile(
  input: SelectTaskFilesInput,
  file: ProjectInventoryFile,
) {
  const positiveText = getPositiveTaskText(input.rawTask);
  const surfaceText = [input.rawTask, positiveText].join(" ");
  const identityText = normalizeForCompare(
    [
      file.path,
      file.name,
      file.role,
      file.routePath ?? "",
      ...(file.symbols ?? []),
      ...(file.exports ?? []),
      ...(file.textHints ?? []),
    ].join(" "),
  );

  if (
    matchesAny(surfaceText, [
      /\b(?:header|topbar|navbar|nav|navigation|menu|theme|locale|language)\b/i,
      /(?:\u0448\u0430\u043f\u043a|\u0432\u0435\u0440\u0445\u043d\u0435\u0435\s+\u043c\u0435\u043d\u044e|\u043d\u0430\u0432\u0438\u0433\u0430\u0446|\u0441\u043c\u0435\u043d\u044b\s+\u044f\u0437\u044b\u043a|\u044f\u0437\u044b\u043a|\u043b\u043e\u043a\u0430\u043b)/i,
    ]) &&
    getHeaderSurfaceScore(file) >= 70
  )
    return true;
  if (
    matchesAny(surfaceText, [
      /\b(?:footer|site\s+footer|bottom\s+nav|legal\s+links|footer\s+links)\b/i,
      /(?:\u0444\u0443\u0442\u0435\u0440|\u043d\u0438\u0436\u043d\u0435\u0435\s+\u043c\u0435\u043d\u044e|\u0441\u0441\u044b\u043b\u043a\u0438\s+\u0432\s+\u0444\u0443\u0442\u0435\u0440\u0435)/i,
    ]) &&
    getFooterSurfaceScore(file) >= 70
  )
    return true;
  if (
    matchesAny(surfaceText, [
      /\b(?:search|searchbox|search\s+box|search\s+input|filter\s+input|query\s+input)\b/i,
      /(?:\u043f\u043e\u0438\u0441\u043a|\u0441\u0442\u0440\u043e\u043a\u0430\s+\u043f\u043e\u0438\u0441\u043a\u0430|\u043f\u043e\u043b\u0435\s+\u043f\u043e\u0438\u0441\u043a\u0430)/i,
    ]) &&
    getSearchSurfaceScore(file) >= 70
  )
    return true;

  if (
    getConcretePageLocationTokens(input).some(
      (token) =>
        normalizedTermMatches(identityText, token) ||
        normalizedTermMatches(token, identityText),
    )
  )
    return true;

  const taskTokens = uniqueStrings(tokenize(positiveText))
    .filter((token) => token.length >= 4)
    .filter((token) => !WEAK_TASK_TOKENS.has(token))
    .filter((token) => !BROAD_PATH_TOKENS.has(token));
  return taskTokens.some(
    (token) =>
      normalizedTermMatches(identityText, token) ||
      normalizedTermMatches(token, identityText),
  );
}

function getStructuredTargetFileScore(
  file: ProjectInventoryFile,
  target: StructuredIntentTarget,
) {
  const filePath = normalizeForCompare(file.path);
  const routePath = normalizeForCompare(file.routePath ?? "");
  const targetPath = normalizeForCompare(target.path ?? "");
  const targetRoute = normalizeForCompare(target.routePath ?? "");
  let score = 0;

  if (
    targetPath &&
    (filePath === targetPath ||
      filePath.endsWith(`/${targetPath}`) ||
      targetPath.endsWith(`/${filePath}`))
  ) {
    score += 260;
  }

  if (
    targetRoute &&
    routePath &&
    normalizeRouteValue(targetRoute) === normalizeRouteValue(routePath)
  ) {
    score += 230;
  }

  const terms = getStructuredTargetTerms(target);
  const values = [
    file.path,
    file.name,
    file.role,
    file.routePath ?? "",
    ...(file.symbols ?? []),
    ...(file.exports ?? []),
    ...(file.textHints ?? []),
    file.contentPreview ?? "",
  ];

  for (const term of terms) {
    if (
      values.some(
        (value) =>
          normalizedTermMatches(value, term) ||
          normalizedTermMatches(term, value),
      )
    ) {
      score +=
        target.kind === "entity" ||
        target.kind === "page" ||
        target.kind === "route"
          ? 36
          : 28;
    }
  }

  if (
    (target.kind === "page" || target.kind === "route") &&
    isPageLikeTargetFile(file)
  )
    score += 70;
  if (target.kind === "component" && isClientUiPath(file.path)) score += 55;
  if (
    target.kind === "service" &&
    (isBackendLeaningPath(file.path) || isClientApiBridgePath(file.path))
  )
    score += 55;
  if (target.kind === "config" && file.kind === "config") score += 60;
  if (target.kind === "docs" && file.kind === "docs") score += 60;
  if (target.kind === "asset" && file.kind === "asset") score += 60;

  return score;
}

function findStructuredTargetFile(
  input: SelectTaskFilesInput,
  target: StructuredIntentTarget,
) {
  if (target.path) {
    return findInventoryFileByLoosePath(input.inventory, target.path);
  }

  if (target.routePath) {
    const normalizedRoute = normalizeRouteValue(target.routePath);
    const routeFile = input.inventory.files.find(
      (file) =>
        file.routePath &&
        normalizeRouteValue(file.routePath) === normalizedRoute,
    );
    if (routeFile) return routeFile;
  }

  const scored = input.inventory.files
    .map((file) => ({
      file,
      score: getStructuredTargetFileScore(file, target),
    }))
    .filter((row) => row.score >= 42)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.file;
}

function getStructuredIntentSeedFiles(
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
  assetMode: AssetMode,
  selected: SelectedTaskFile[],
) {
  const seeds: SelectedTaskFile[] = [];
  const seen = new Set(selected.map((file) => normalizeForCompare(file.path)));

  for (const target of getStructuredIntentTargets(input).sort(
    (a, b) => b.confidence - a.confidence,
  )) {
    if (!structuredTargetHasTaskSupport(input, target)) continue;
    const inventoryFile = findStructuredTargetFile(input, target);
    if (!inventoryFile) continue;
    const normalizedPath = normalizeForCompare(inventoryFile.path);
    if (seen.has(normalizedPath)) continue;
    if (!canUseSelectedFile(input, inventoryFile, area, assetMode)) continue;

    seen.add(normalizedPath);
    seeds.push(
      makeSelectedFile(
        inventoryFile,
        `Selected from structured task intent target "${target.value}" and validated against project inventory. ${target.evidence}`.slice(
          0,
          320,
        ),
        Math.max(0.72, Math.min(0.97, target.confidence)),
        defaultUsageForFile(inventoryFile),
      ),
    );
  }

  return seeds.slice(0, 6);
}

function hasRawHeaderSurfaceIntent(input: SelectTaskFilesInput) {
  return matchesAny(
    [input.rawTask, getPositiveTaskText(input.rawTask)].join(" "),
    [
      /\b(?:header|topbar|navbar|nav|navigation|menu|theme|locale|language)\b/i,
      /\baccount\s+(?:button|menu|control|switcher)\b/i,
      /(?:\u0448\u0430\u043f\u043a|\u0432\u0435\u0440\u0445\u043d\u0435\u0435\s+\u043c\u0435\u043d\u044e|\u043d\u0430\u0432\u0438\u0433\u0430\u0446|\u043c\u0435\u043d\u044e|\u043f\u0435\u0440\u0435\u043a\u043b\u044e\u0447\u0430\u0442\u0435\u043b\u044c\s+\u0442\u0435\u043c|\u043a\u043d\u043e\u043f\u043a\u0430\s+\u0430\u043a\u043a\u0430\u0443\u043d\u0442|\u0441\u043c\u0435\u043d\u044b\s+\u044f\u0437\u044b\u043a|\u044f\u0437\u044b\u043a|\u043b\u043e\u043a\u0430\u043b)/i,
    ],
  );
}

function hasHeaderSurfaceIntent(input: SelectTaskFilesInput) {
  const groundedStructuredTargetText = getStructuredIntentTargets(input)
    .filter((target) => structuredTargetHasTaskSupport(input, target))
    .flatMap((target) => [
      target.value,
      target.path ?? "",
      target.routePath ?? "",
      target.name ?? "",
      target.evidence,
    ])
    .join(" ");

  if (hasRawHeaderSurfaceIntent(input)) return true;

  return matchesAny([groundedStructuredTargetText].join(" "), [
    /\b(?:header|topbar|navbar|nav|navigation|menu|theme|locale|language)\b/i,
    /\baccount\s+(?:button|menu|control|switcher)\b/i,
    /(?:\u0448\u0430\u043f\u043a|\u0432\u0435\u0440\u0445\u043d\u0435\u0435\s+\u043c\u0435\u043d\u044e|\u043d\u0430\u0432\u0438\u0433\u0430\u0446|\u043c\u0435\u043d\u044e|\u043f\u0435\u0440\u0435\u043a\u043b\u044e\u0447\u0430\u0442\u0435\u043b\u044c\s+\u0442\u0435\u043c|\u043a\u043d\u043e\u043f\u043a\u0430\s+\u0430\u043a\u043a\u0430\u0443\u043d\u0442|\u0441\u043c\u0435\u043d\u044b\s+\u044f\u0437\u044b\u043a|\u044f\u0437\u044b\u043a|\u043b\u043e\u043a\u0430\u043b)/i,
  ]);
}

function getHeaderSurfaceScore(file: ProjectInventoryFile) {
  const values = [
    file.path,
    file.name,
    file.role,
    file.routePath ?? "",
    ...(file.symbols ?? []),
    ...(file.exports ?? []),
    ...(file.textHints ?? []),
    file.contentPreview ?? "",
  ];
  const text = normalizeForCompare(values.join(" "));
  let score = 0;

  if (
    includesAny(file.path, ["header", "topbar", "navbar", "navigation", "nav"])
  )
    score += 95;
  if (
    includesAny(file.name, ["header", "topbar", "navbar", "navigation", "nav"])
  )
    score += 90;
  if (
    (file.symbols ?? []).some((symbol) =>
      includesAny(symbol, ["Header", "Topbar", "Navbar", "Navigation"]),
    )
  )
    score += 85;
  if (
    (file.exports ?? []).some((exportName) =>
      includesAny(exportName, ["Header", "Topbar", "Navbar", "Navigation"]),
    )
  )
    score += 80;
  if (file.role === "layout" || file.role === "app-entry") score += 20;
  if (
    file.kind === "style" &&
    includesAny(text, ["topbar", "header", "navbar", "nav", "navigation"])
  )
    score += 62;
  if (file.kind === "source" && isClientUiPath(file.path)) score += 24;
  if (
    includesAny(text, [
      "topbar",
      "header",
      "navbar",
      "navigation",
      "nav",
      "menu",
      "theme",
      "locale",
      "language",
      "account",
    ])
  )
    score += 36;
  if (includesAny(text, ["authcontext", "api", "server", "schema", "database"]))
    score -= 60;
  if (includesAny(file.path, ["button", "footer", "modal", "page"]))
    score -= 35;

  return score;
}

function getHeaderSurfaceSeedFiles(
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
  assetMode: AssetMode,
  selected: SelectedTaskFile[],
) {
  if (
    area !== "ui" &&
    area !== "fullstack" &&
    area !== "general" &&
    area !== "bugfix"
  )
    return [];
  if (!hasHeaderSurfaceIntent(input)) return [];

  const seen = new Set(selected.map((file) => normalizeForCompare(file.path)));
  const scored = input.inventory.files
    .filter((file) => !seen.has(normalizeForCompare(file.path)))
    .filter((file) => canUseSelectedFile(input, file, area, assetMode))
    .map((file) => ({ file, score: getHeaderSurfaceScore(file) }))
    .filter((item) => item.score >= 70)
    .sort((a, b) => b.score - a.score);

  return scored
    .slice(0, 2)
    .map((item) =>
      makeSelectedFile(
        item.file,
        "Selected as a likely header/navigation surface by matching the task against real inventory names, symbols, exports, and UI text hints.",
        Math.max(0.78, Math.min(0.94, item.score / 170)),
      ),
    );
}

function hasFooterSurfaceIntent(input: SelectTaskFilesInput) {
  const groundedStructuredTargetText = getStructuredIntentTargets(input)
    .filter((target) => structuredTargetHasTaskSupport(input, target))
    .flatMap((target) => [
      target.value,
      target.path ?? "",
      target.routePath ?? "",
      target.name ?? "",
      target.evidence,
    ])
    .join(" ");

  return matchesAny(
    [
      input.rawTask,
      getPositiveTaskText(input.rawTask),
      groundedStructuredTargetText,
    ].join(" "),
    [
      /\b(?:footer|site\s+footer|bottom\s+nav|legal\s+links|footer\s+links)\b/i,
      /(?:\u0444\u0443\u0442\u0435\u0440|\u043d\u0438\u0436\u043d\u0435\u0435\s+\u043c\u0435\u043d\u044e|\u043d\u0438\u0436\u043d\u044f\u044f\s+\u043d\u0430\u0432\u0438\u0433\u0430\u0446|\u0441\u0441\u044b\u043b\u043a\u0438\s+\u0432\s+\u0444\u0443\u0442\u0435\u0440\u0435)/i,
    ],
  );
}

function getFooterSurfaceScore(file: ProjectInventoryFile) {
  const values = [
    file.path,
    file.name,
    file.role,
    file.routePath ?? "",
    ...(file.symbols ?? []),
    ...(file.exports ?? []),
    ...(file.textHints ?? []),
    file.contentPreview ?? "",
  ];
  const text = normalizeForCompare(values.join(" "));
  let score = 0;

  if (includesAny(file.path, ["footer", "bottom-nav", "bottomnav"]))
    score += 95;
  if (includesAny(file.name, ["footer", "bottom-nav", "bottomnav"]))
    score += 90;
  if (
    (file.symbols ?? []).some((symbol) =>
      includesAny(symbol, ["Footer", "SiteFooter", "FooterLinks"]),
    )
  )
    score += 85;
  if (
    (file.exports ?? []).some((exportName) =>
      includesAny(exportName, ["Footer", "SiteFooter", "FooterLinks"]),
    )
  )
    score += 80;
  if (
    file.kind === "style" &&
    includesAny(text, ["footer", "bottom nav", "legal links"])
  )
    score += 56;
  if (file.kind === "source" && isClientUiPath(file.path)) score += 22;
  if (
    includesAny(text, [
      "footer",
      "legal",
      "links",
      "company",
      "developers",
      "product",
    ])
  )
    score += 34;
  if (includesAny(text, ["authcontext", "api", "server", "schema", "database"]))
    score -= 70;
  if (
    includesAny(file.path, ["header", "modal", "skeleton", "api/", "server/"])
  )
    score -= 35;
  if (file.role === "page") score -= 24;

  return score;
}

function getFooterSurfaceSeedFiles(
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
  assetMode: AssetMode,
  selected: SelectedTaskFile[],
) {
  if (
    area !== "ui" &&
    area !== "fullstack" &&
    area !== "general" &&
    area !== "bugfix"
  )
    return [];
  if (!hasFooterSurfaceIntent(input)) return [];

  const seen = new Set(selected.map((file) => normalizeForCompare(file.path)));
  const scored = input.inventory.files
    .filter((file) => !seen.has(normalizeForCompare(file.path)))
    .filter((file) => canUseSelectedFile(input, file, area, assetMode))
    .map((file) => ({ file, score: getFooterSurfaceScore(file) }))
    .filter((item) => item.score >= 70)
    .sort((a, b) => b.score - a.score);

  return scored
    .slice(0, 2)
    .map((item) =>
      makeSelectedFile(
        item.file,
        "Selected as a likely footer/link surface by matching the task against real inventory names, symbols, exports, and UI text hints.",
        Math.max(0.76, Math.min(0.93, item.score / 170)),
      ),
    );
}

function hasSearchSurfaceIntent(input: SelectTaskFilesInput) {
  return matchesAny(
    [input.rawTask, getPositiveTaskText(input.rawTask)].join(" "),
    [
      /\b(?:search|searchbox|search\s+box|search\s+input|filter\s+input|query\s+input)\b/i,
      /(?:\u043f\u043e\u0438\u0441\u043a|\u0441\u0442\u0440\u043e\u043a\u0430\s+\u043f\u043e\u0438\u0441\u043a\u0430|\u043f\u043e\u043b\u0435\s+\u043f\u043e\u0438\u0441\u043a\u0430)/i,
    ],
  );
}

function getSearchSurfaceScore(file: ProjectInventoryFile) {
  const values = [
    file.path,
    file.name,
    file.role,
    file.routePath ?? "",
    ...(file.symbols ?? []),
    ...(file.exports ?? []),
    ...(file.textHints ?? []),
    file.contentPreview ?? "",
  ];
  const text = normalizeForCompare(values.join(" "));
  let score = 0;

  if (includesAny(file.path, ["search", "filter"])) score += 95;
  if (includesAny(file.name, ["search", "filter"])) score += 90;
  if (
    (file.symbols ?? []).some((symbol) =>
      includesAny(symbol, ["Search", "SearchBox", "SearchInput", "Filter"]),
    )
  )
    score += 85;
  if (
    (file.exports ?? []).some((exportName) =>
      includesAny(exportName, ["Search", "SearchBox", "SearchInput", "Filter"]),
    )
  )
    score += 80;
  if (
    file.kind === "source" &&
    ["component", "ui-component"].includes(file.role)
  )
    score += 32;
  if (
    includesAny(text, [
      "search",
      "query",
      "filter",
      "input",
      "empty results",
      "no results",
    ])
  )
    score += 38;
  if (isPageLikeTargetFile(file)) score -= 36;
  if (includesAny(text, ["api", "server", "schema", "database"])) score -= 60;

  return score;
}

function getSearchSurfaceSeedFiles(
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
  assetMode: AssetMode,
  selected: SelectedTaskFile[],
) {
  if (
    area !== "ui" &&
    area !== "fullstack" &&
    area !== "general" &&
    area !== "bugfix"
  )
    return [];
  if (!hasSearchSurfaceIntent(input)) return [];

  const seen = new Set(selected.map((file) => normalizeForCompare(file.path)));
  const scored = input.inventory.files
    .filter((file) => !seen.has(normalizeForCompare(file.path)))
    .filter((file) => canUseSelectedFile(input, file, area, assetMode))
    .map((file) => ({ file, score: getSearchSurfaceScore(file) }))
    .filter((item) => item.score >= 70)
    .sort((a, b) => b.score - a.score);

  return scored
    .slice(0, 2)
    .map((item) =>
      makeSelectedFile(
        item.file,
        "Selected as a likely search/input surface by matching the task against real inventory names, symbols, exports, and UI text hints.",
        Math.max(0.76, Math.min(0.93, item.score / 170)),
      ),
    );
}

function hasLoadingSurfaceIntent(input: SelectTaskFilesInput) {
  const protectedTerms =
    getTaskConstraints(input).protectedFileTerms.map(normalizeForCompare);
  if (
    protectedTerms.some((term) =>
      includesAny(term, [
        "loading",
        "loader",
        "skeleton",
        "spinner",
        "fallback",
        "\u0437\u0430\u0433\u0440\u0443\u0437",
        "\u0441\u043a\u0435\u043b\u0435\u0442",
        "\u043b\u043e\u0430\u0434\u0435\u0440",
        "\u0441\u043f\u0438\u043d\u043d\u0435\u0440",
      ]),
    )
  ) {
    return false;
  }

  return matchesAny(
    [input.rawTask, getPositiveTaskText(input.rawTask)].join(" "),
    [
      /\b(?:skeleton|loading\s+state|loading\s+screen|route\s+skeleton|page\s+skeleton|fallback\s+loader|spinner)\b/i,
      /(?:\u0441\u043a\u0435\u043b\u0435\u0442\u043e\u043d|\u0437\u0430\u0433\u0440\u0443\u0437\u043a|\u043b\u043e\u0430\u0434\u0435\u0440|\u0441\u043f\u0438\u043d\u043d\u0435\u0440)/i,
    ],
  );
}

function getLoadingSurfaceScore(file: ProjectInventoryFile) {
  const values = [
    file.path,
    file.name,
    file.role,
    file.routePath ?? "",
    ...(file.symbols ?? []),
    ...(file.exports ?? []),
    ...(file.textHints ?? []),
    file.contentPreview ?? "",
  ];
  const text = normalizeForCompare(values.join(" "));
  let score = 0;

  if (
    includesAny(file.path, [
      "skeleton",
      "loading",
      "loader",
      "spinner",
      "fallback",
    ])
  )
    score += 95;
  if (
    includesAny(file.name, [
      "skeleton",
      "loading",
      "loader",
      "spinner",
      "fallback",
    ])
  )
    score += 90;
  if (
    (file.symbols ?? []).some((symbol) =>
      includesAny(symbol, [
        "Skeleton",
        "Loader",
        "Loading",
        "Fallback",
        "Spinner",
      ]),
    )
  )
    score += 85;
  if (
    (file.exports ?? []).some((exportName) =>
      includesAny(exportName, [
        "Skeleton",
        "Loader",
        "Loading",
        "Fallback",
        "Spinner",
      ]),
    )
  )
    score += 80;
  if (file.kind === "source" && isClientUiPath(file.path)) score += 26;
  if (
    includesAny(text, ["skeleton", "loading", "loader", "spinner", "fallback"])
  )
    score += 42;
  if (isClientApiBridgePath(file.path) || isBackendLeaningPath(file.path))
    score -= 80;
  if (
    file.role === "page" &&
    !includesAny(file.path, ["skeleton", "loading", "loader", "fallback"])
  )
    score -= 38;

  return score;
}

function getLoadingSurfaceSeedFiles(
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
  assetMode: AssetMode,
  selected: SelectedTaskFile[],
) {
  if (
    area !== "ui" &&
    area !== "fullstack" &&
    area !== "general" &&
    area !== "bugfix"
  )
    return [];
  if (!hasLoadingSurfaceIntent(input)) return [];

  const seen = new Set(selected.map((file) => normalizeForCompare(file.path)));
  const scored = input.inventory.files
    .filter((file) => !seen.has(normalizeForCompare(file.path)))
    .filter((file) => canUseSelectedFile(input, file, area, assetMode))
    .map((file) => ({ file, score: getLoadingSurfaceScore(file) }))
    .filter((item) => item.score >= 70)
    .sort((a, b) => b.score - a.score);

  return scored
    .slice(0, 2)
    .map((item) =>
      makeSelectedFile(
        item.file,
        "Selected as a likely loading/skeleton surface by matching the task against real inventory names, symbols, exports, and UI text hints.",
        Math.max(0.76, Math.min(0.93, item.score / 170)),
      ),
    );
}

function hasSpecificUiObjectIntent(input: SelectTaskFilesInput) {
  return matchesAny(getPositiveTaskText(input.rawTask), [
    /\b(?:form|input|field|modal|dialog|table|list|card|profile|settings|user|account|checkout|search|filter)\b/i,
    /(?:^|[^\p{L}\p{N}_])(?:\u0444\u043e\u0440\u043c(?:\u0430|\u0443|\u044b|\u0435|\u043e\u0439|\u0430\u043c\u0438|\u0430\u0445)?|\u043f\u043e\u043b\u0435|\u0438\u043d\u043f\u0443\u0442|\u043c\u043e\u0434\u0430\u043b|\u0434\u0438\u0430\u043b\u043e\u0433|\u0442\u0430\u0431\u043b\u0438\u0446|\u0441\u043f\u0438\u0441|\u043a\u0430\u0440\u0442\u043e\u0447|\u043f\u0440\u043e\u0444\u0438\u043b|\u043d\u0430\u0441\u0442\u0440\u043e\u0439\u043a|\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442|\u0430\u043a\u043a\u0430\u0443\u043d\u0442|\u043f\u043e\u0438\u0441\u043a|\u0444\u0438\u043b\u044c\u0442\u0440)(?=$|[^\p{L}\p{N}_])/iu,
  ]);
}

function getSpecificPositiveTokens(input: SelectTaskFilesInput) {
  const protectedTerms = new Set(
    getTaskConstraints(input).protectedFileTerms.map(normalizeForCompare),
  );
  return getGroundedPositiveTargetTokens(input)
    .filter((token) => token.length >= 4)
    .filter(
      (token) =>
        ![
          "api",
          "backend",
          "server",
          "auth",
          "route",
          "routes",
          "service",
          "services",
          "client",
        ].includes(normalizeForCompare(token)),
    )
    .filter((token) => !protectedTerms.has(normalizeForCompare(token)))
    .slice(0, 12);
}

function getRawSpecificPositiveTokens(input: SelectTaskFilesInput) {
  const protectedTerms = new Set(
    getTaskConstraints(input).protectedFileTerms.map(normalizeForCompare),
  );
  return uniqueNormalizedTokens(tokenize(getPositiveTaskText(input.rawTask)))
    .filter((token) => token.length >= 4)
    .filter((token) => !isWeakPageTargetToken(token))
    .filter(
      (token) =>
        ![
          "api",
          "backend",
          "server",
          "auth",
          "route",
          "routes",
          "service",
          "services",
          "client",
        ].includes(normalizeForCompare(token)),
    )
    .filter((token) => !protectedTerms.has(normalizeForCompare(token)))
    .filter((token) => !token.includes("/") && !token.includes("\\"))
    .slice(0, 12);
}

function getSpecificPositiveOverlap(
  file: ProjectInventoryFile,
  tokens: string[],
) {
  if (tokens.length === 0) return 0;
  const values = [
    file.path,
    file.name,
    file.role,
    file.routePath ?? "",
    ...(file.symbols ?? []),
    ...(file.exports ?? []),
    ...(file.textHints ?? []),
    file.contentPreview ?? "",
  ];

  return tokens.reduce(
    (count, token) =>
      count +
      (values.some(
        (value) =>
          normalizedTermMatches(value, token) ||
          normalizedTermMatches(token, value),
      )
        ? 1
        : 0),
    0,
  );
}

function getSpecificIdentityOverlap(
  file: ProjectInventoryFile,
  tokens: string[],
) {
  if (tokens.length === 0) return 0;
  const values = [
    file.path,
    file.name,
    file.role,
    file.routePath ?? "",
    ...(file.symbols ?? []),
    ...(file.exports ?? []),
  ];

  return tokens.reduce(
    (count, token) =>
      count +
      (values.some(
        (value) =>
          normalizedTermMatches(value, token) ||
          normalizedTermMatches(token, value),
      )
        ? 1
        : 0),
    0,
  );
}

function getDomainSpecificFallbackTokens(input: SelectTaskFilesInput) {
  const genericTechnicalTokens = new Set([
    "add",
    "create",
    "change",
    "update",
    "fix",
    "handle",
    "handling",
    "implement",
    "improve",
    "backend",
    "server",
    "route",
    "routes",
    "endpoint",
    "endpoints",
    "api",
    "service",
    "services",
    "client",
    "frontend",
    "front",
    "code",
    "logic",
    "project",
    "projects",
    "workspace",
    "repo",
    "repository",
    "better",
    "improve",
    "improvement",
  ]);

  return getSpecificPositiveTokens(input).filter(
    (token) =>
      !genericTechnicalTokens.has(normalizeForCompare(token)) &&
      !isWeakPageTargetToken(token),
  );
}

function hasDomainSpecificFallbackEvidence(
  file: ProjectInventoryFile,
  input: SelectTaskFilesInput,
) {
  const tokens = getDomainSpecificFallbackTokens(input);
  if (tokens.length === 0) return false;

  const identityOverlap = getSpecificIdentityOverlap(file, tokens);
  const positiveOverlap = getSpecificPositiveOverlap(file, tokens);

  return (
    identityOverlap >= 2 ||
    positiveOverlap >= 2 ||
    (identityOverlap >= 1 && positiveOverlap >= 1)
  );
}

function hasStrongDomainPageIdentityEvidence(
  file: ProjectInventoryFile,
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
  tokenContext: TokenContext,
) {
  if (!isPageLikeTargetFile(file)) return false;
  if (isSensitivePath(file.path) || isGeneratedDoNotEditPath(file.path))
    return false;
  if (area === "ui" && isServerSidePath(file.path)) return false;
  if (area === "backend" && isClientUiPath(file.path)) return false;

  const tokens = getDomainSpecificFallbackTokens(input).filter(
    (token) => !["frontend", "front"].includes(normalizeForCompare(token)),
  );
  if (tokens.length === 0) return false;

  const identityText = normalizeForCompare(
    [
      file.path,
      file.name,
      file.role,
      file.routePath ?? "",
      ...(file.symbols ?? []),
      ...(file.exports ?? []),
    ].join(" "),
  );
  const identityOverlap = tokens.reduce(
    (count, token) =>
      count + (filePartMatchesToken(identityText, token) ? 1 : 0),
    0,
  );
  if (identityOverlap >= 2) return true;

  return (
    identityOverlap >= 1 &&
    getPageSemanticMatchScore(file, input, tokenContext) >= 60
  );
}

function getFallbackCandidateUsage(
  input: SelectTaskFilesInput,
  effectiveTaskArea: EffectiveTaskArea,
  file: ProjectInventoryFile,
) {
  if (isReviewProposeOnlyTask(input)) return "inspect-only";

  if (effectiveTaskArea === "docs" && file.kind === "docs")
    return "inspect-and-edit";

  if (
    isBroadUiScopeTask(input, effectiveTaskArea) &&
    isPageLikeTargetFile(file)
  )
    return "inspect-only";

  const requestedUsage = defaultUsageForFile(file);

  if (
    (effectiveTaskArea === "backend" || effectiveTaskArea === "fullstack") &&
    requestedUsage === "inspect-and-edit"
  ) {
    if (isClientApiBridgePath(file.path)) return "inspect-only";

    if (
      isServerSidePath(file.path) &&
      !hasDomainSpecificFallbackEvidence(file, input)
    ) {
      return "inspect-only";
    }
  }

  if (
    effectiveTaskArea === "ui" &&
    (isServerSidePath(file.path) || isClientApiBridgePath(file.path))
  ) {
    return "inspect-only";
  }

  return requestedUsage;
}

function hasGroundedStructuredConcreteTarget(
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
  assetMode: AssetMode,
) {
  return getStructuredIntentTargets(input)
    .filter((target) => structuredTargetHasTaskSupport(input, target))
    .some((target) => {
      if (
        !["explicit_file", "route", "page", "component", "symbol"].includes(
          target.kind,
        )
      )
        return false;
      const file = findStructuredTargetFile(input, target);
      if (!file || !canUseSelectedFile(input, file, area, assetMode))
        return false;

      if (target.path || target.routePath) return true;

      const terms = getStructuredTargetTerms(target);
      if (terms.length === 0) return false;
      return getSpecificIdentityOverlap(file, terms) >= 1;
    });
}

function hasConcreteUiLocationHint(
  input: SelectTaskFilesInput,
  tokenContext: TokenContext,
) {
  if (
    tokenContext.explicitExistingPaths.length > 0 ||
    extractRouteMentions(input.rawTask).length > 0
  )
    return true;
  if (
    hasGroundedStructuredConcreteTarget(
      input,
      getEffectiveTaskArea(input),
      getAssetMode(input),
    )
  )
    return true;

  return matchesAny(getPositiveTaskText(input.rawTask), [
    /\b(?:in\s+file|in\s+component|on\s+page|on\s+the\s+page|page|screen|view|route)\b/i,
    /(?:\u0432\s+\u0444\u0430\u0439\u043b\u0435|\u0432\s+\u043a\u043e\u043c\u043f\u043e\u043d\u0435\u043d\u0442\u0435|\u043d\u0430\s+\u0441\u0442\u0440\u0430\u043d\u0438\u0446|\u0441\u0442\u0440\u0430\u043d\u0438\u0446|\u044d\u043a\u0440\u0430\u043d|\u0440\u0430\u0437\u0434\u0435\u043b|\u0432\u043a\u043b\u0430\u0434\u043a)/i,
  ]);
}

function getSpecificUiObjectTokens(input: SelectTaskFilesInput) {
  const positiveText = getPositiveTaskText(input.rawTask);
  if (
    matchesAny(positiveText, [
      /\b(?:form|input|field)\b/i,
      /(?:^|[^\p{L}\p{N}_])(?:\u0444\u043e\u0440\u043c(?:\u0430|\u0443|\u044b|\u0435|\u043e\u0439|\u0430\u043c\u0438|\u0430\u0445)?|\u043f\u043e\u043b\u0435|\u0438\u043d\u043f\u0443\u0442)(?=$|[^\p{L}\p{N}_])/iu,
    ])
  ) {
    return getSpecificPositiveTokens(input).filter((token) =>
      ["form", "input", "field"].includes(normalizeForCompare(token)),
    );
  }

  const objectTokens = new Set([
    "form",
    "input",
    "field",
    "modal",
    "dialog",
    "table",
    "list",
    "card",
    "profile",
    "settings",
    "checkout",
    "search",
    "filter",
  ]);

  return getSpecificPositiveTokens(input).filter((token) =>
    objectTokens.has(normalizeForCompare(token)),
  );
}

function hasRawFormObjectIntent(input: SelectTaskFilesInput) {
  return matchesAny(getPositiveTaskText(input.rawTask), [
    /\b(?:form|input|field)\b/i,
    /(?:^|[^\p{L}\p{N}_])(?:\u0444\u043e\u0440\u043c(?:\u0430|\u0443|\u044b|\u0435|\u043e\u0439|\u0430\u043c\u0438|\u0430\u0445)?|\u043f\u043e\u043b\u0435|\u0438\u043d\u043f\u0443\u0442)(?=$|[^\p{L}\p{N}_])/iu,
  ]);
}

function hasGroundedFormIdentityTarget(
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
) {
  const rawTokens = getRawSpecificPositiveTokens(input);
  const formTokens = [
    "form",
    "input",
    "field",
    "\u0444\u043e\u0440\u043c",
    "\u043f\u043e\u043b\u0435",
    "\u0438\u043d\u043f\u0443\u0442",
  ];
  const locationTokens = rawTokens.filter(
    (token) =>
      !formTokens.some(
        (formToken) =>
          normalizedTermMatches(token, formToken) ||
          normalizedTermMatches(formToken, token),
      ),
  );
  const hasLocationToken = locationTokens.length > 0;

  return input.inventory.files
    .filter((file) => canUseSelectedFile(input, file, area, "none"))
    .some((file) => {
      const identity = normalizeForCompare(
        [
          file.path,
          file.name,
          file.role,
          file.routePath ?? "",
          ...(file.symbols ?? []),
          ...(file.exports ?? []),
        ].join(" "),
      );
      const searchText = getFileSearchText(file);
      const identityHasForm = formTokens.some((token) =>
        normalizedTermMatches(identity, token),
      );
      const searchHasForm = formTokens.some((token) =>
        normalizedTermMatches(searchText, token),
      );

      if (!identityHasForm && !searchHasForm) return false;
      if (!hasLocationToken) return identityHasForm;
      return locationTokens.some((token) =>
        normalizedTermMatches(identity, token),
      );
    });
}

function shouldBlockUngroundedFormTarget(
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
  tokenContext: TokenContext,
) {
  if (!hasRawFormObjectIntent(input)) return false;
  if (
    tokenContext.explicitExistingPaths.length > 0 ||
    extractRouteMentions(input.rawTask).length > 0
  )
    return false;
  if (hasRawConcretePageLocation(input, area, tokenContext)) return false;
  if (hasStrongGroundedPageTarget(input, area, tokenContext)) return false;
  return !hasGroundedFormIdentityTarget(input, area);
}

function hasGroundedSpecificUiObjectFile(
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
  tokenContext: TokenContext,
  tokens: string[],
) {
  const objectTokens = getSpecificUiObjectTokens(input);
  if (objectTokens.length === 0) return false;
  const hasLocationHint = hasConcreteUiLocationHint(input, tokenContext);

  return input.inventory.files
    .filter((file) => canUseSelectedFile(input, file, area, "none"))
    .filter((file) => hasLocationHint || !isPageLikeTargetFile(file))
    .some(
      (file) =>
        (getSpecificIdentityOverlap(file, objectTokens) >= 1 &&
          getSpecificPositiveOverlap(file, tokens) >= 2) ||
        (!isPageLikeTargetFile(file) &&
          getSpecificPositiveOverlap(file, objectTokens) >= 1 &&
          getSpecificPositiveOverlap(file, tokens) >= 2),
    );
}

function hasStrongGroundedPageTarget(
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
  tokenContext: TokenContext,
) {
  const tokens = getSpecificPositiveTokens(input);
  const objectTokens =
    getSpecificUiObjectTokens(input).map(normalizeForCompare);
  const semanticIdentityTokens = buildSemanticTokens(input)
    .map(normalizeForCompare)
    .filter(
      (token) =>
        token.length >= 3 &&
        ![
          "ui",
          "ux",
          "frontend",
          "backend",
          "server",
          "api",
          "page",
          "component",
          "layout",
          "style",
          "form",
          "input",
          "field",
        ].includes(token),
    );
  const rawLocationTokens = getRawSpecificPositiveTokens(input).filter(
    (token) => !objectTokens.includes(normalizeForCompare(token)),
  );

  return input.inventory.files
    .filter((file) => canUseSelectedFile(input, file, area, "none"))
    .filter((file) => isPageLikeTargetFile(file))
    .some((file) => {
      if (hasStrongDomainPageIdentityEvidence(file, input, area, tokenContext))
        return true;
      if (
        semanticIdentityTokens.length > 0 &&
        getSpecificIdentityOverlap(file, semanticIdentityTokens) >= 1 &&
        getPageSemanticMatchScore(file, input, tokenContext) >= 60
      )
        return true;
      if (getPageSemanticMatchScore(file, input, tokenContext) < 70)
        return false;
      if (getSpecificIdentityOverlap(file, tokens) < 1) return false;
      if (objectTokens.length === 0) return true;
      if (getSpecificIdentityOverlap(file, objectTokens) >= 1) return true;
      return (
        rawLocationTokens.length > 0 &&
        getSpecificIdentityOverlap(file, rawLocationTokens) >= 1
      );
    });
}

const CONCRETE_PAGE_LOCATION_STOP_TOKENS = new Set([
  "page",
  "screen",
  "view",
  "route",
  "section",
  "tab",
  "form",
  "input",
  "field",
  "button",
  "user",
  "users",
  "add",
  "create",
  "update",
  "improve",
  "fix",
  "make",
  "change",
  "\u0441\u0442\u0440\u0430\u043d\u0438\u0446",
  "\u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0430",
  "\u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0443",
  "\u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0435",
  "\u044d\u043a\u0440\u0430\u043d",
  "\u044d\u043a\u0440\u0430\u043d\u0435",
  "\u0440\u0430\u0437\u0434\u0435\u043b",
  "\u0432\u043a\u043b\u0430\u0434\u043a",
  "\u0444\u043e\u0440\u043c",
  "\u0444\u043e\u0440\u043c\u0443",
  "\u043f\u043e\u043b\u0435",
  "\u043a\u043d\u043e\u043f\u043a",
  "\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442",
  "\u0434\u043e\u0431\u0430\u0432",
  "\u0441\u043e\u0437\u0434\u0430",
  "\u0443\u043b\u0443\u0447\u0448",
  "\u0438\u0441\u043f\u0440\u0430\u0432",
]);

function getConcretePageLocationTokens(input: SelectTaskFilesInput) {
  const positiveText = getPositiveTaskText(input.rawTask);
  const chunks: string[] = [];

  const addMatches = (patterns: RegExp[]) => {
    for (const pattern of patterns) {
      for (const match of positiveText.matchAll(pattern)) {
        const chunk = String(match[1] ?? match[2] ?? "").trim();
        if (chunk) chunks.push(chunk);
      }
    }
  };

  addMatches([
    /\b(?:on|in|to)\s+(?:the\s+)?([a-z0-9 _-]{2,70}?)\s+(?:page|screen|view|route|section|tab)\b/gi,
    /\b(?:page|screen|view|route|section|tab)\s+(?:for|of|called|named)?\s*([a-z0-9 _-]{2,70})/gi,
    /(?:\u043d\u0430|\u0432)\s+(?:\u0441\u0442\u0440\u0430\u043d\u0438\u0446(?:\u0443|\u0435|\u0435\u0439|\u0430)|\u044d\u043a\u0440\u0430\u043d(?:\u0435|\u0430)?|\u0440\u0430\u0437\u0434\u0435\u043b(?:\u0435|\u0430)?|\u0432\u043a\u043b\u0430\u0434\u043a(?:\u0435|\u0443))\s+([^.!?,;\n]{2,70})/giu,
    /(?:\u0441\u0442\u0440\u0430\u043d\u0438\u0446(?:\u0430|\u0443|\u0435|\u044b)|\u044d\u043a\u0440\u0430\u043d|\u0440\u0430\u0437\u0434\u0435\u043b|\u0432\u043a\u043b\u0430\u0434\u043a\u0430)\s+([^.!?,;\n]{2,70})/giu,
  ]);

  const directText = normalizeForCompare(positiveText);
  if (
    /(?:\u0430\u0434\u043c\u0438\u043d|\u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442|admin|administrator)/i.test(
      directText,
    )
  ) {
    chunks.push("admin administrator");
  }
  if (
    /(?:\u043b\u043e\u0433\u0438\u043d|\u0432\u0445\u043e\u0434|\u0430\u0432\u0442\u043e\u0440\u0438\u0437|login|signin|sign-in|auth)/i.test(
      directText,
    )
  ) {
    chunks.push("login auth");
  }
  if (
    /(?:\u0434\u0430\u0448\u0431\u043e\u0440\u0434|\u043f\u0430\u043d\u0435\u043b|dashboard)/i.test(
      directText,
    )
  ) {
    chunks.push("dashboard");
  }
  if (
    /(?:\u0430\u043a\u043a\u0430\u0443\u043d\u0442|\u043f\u0440\u043e\u0444\u0438\u043b|account|profile)/i.test(
      directText,
    )
  ) {
    chunks.push("account profile");
  }
  if (
    /(?:\u0443\u0441\u0442\u0440\u043e\u0439\u0441\u0442\u0432|devices?|connected\s+apps?)/i.test(
      directText,
    )
  ) {
    chunks.push("devices connected");
  }

  return uniqueNormalizedTokens(chunks.flatMap((chunk) => tokenize(chunk)))
    .filter((token) => token.length >= 3)
    .filter(
      (token) =>
        !CONCRETE_PAGE_LOCATION_STOP_TOKENS.has(normalizeForCompare(token)),
    )
    .filter(
      (token) =>
        ![
          "api",
          "backend",
          "server",
          "loading",
          "request",
          "requests",
        ].includes(normalizeForCompare(token)),
    )
    .slice(0, 10);
}

function hasRawConcretePageLocation(
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
  tokenContext: TokenContext,
) {
  const tokens = getConcretePageLocationTokens(input);
  if (tokens.length === 0) return false;

  return input.inventory.files
    .filter((file) => canUseSelectedFile(input, file, area, "none"))
    .filter((file) => isPageLikeTargetFile(file))
    .some(
      (file) =>
        getPageSemanticMatchScore(file, input, tokenContext) >= 50 &&
        getSpecificIdentityOverlap(file, tokens) >= 1,
    );
}

function isVagueUiPolishTask(
  input: SelectTaskFilesInput,
  tokenContext: TokenContext,
) {
  if (tokenContext.explicitExistingPaths.length > 0) return false;
  if (extractRouteMentions(input.rawTask).length > 0) return false;
  if (getConcretePageLocationTokens(input).length > 0) return false;
  if (hasHeaderSurfaceIntent(input) || hasFooterSurfaceIntent(input))
    return false;
  if (isHomePageTask(input)) return false;
  if (
    extractExplicitSymbolTargetNames(input.rawTask).some((targetName) =>
      inventoryHasExplicitSymbolTarget(input.inventory, targetName),
    )
  )
    return false;
  if (hasSpecificUiObjectIntent(input)) return false;
  if (
    getStructuredIntentTargets(input).some(
      (target) => target.path || target.routePath,
    )
  )
    return false;
  if (
    input.inventory.files.some((file) =>
      hasStrongDomainPageIdentityEvidence(
        file,
        input,
        getEffectiveTaskArea(input),
        tokenContext,
      ),
    )
  )
    return false;

  return matchesAny(getPositiveTaskText(input.rawTask), [
    /\b(?:ui|ux|interface|visual|polish|design|make\s+it\s+feel|feel\s+better|look\s+better)\b/i,
    /(?:\u0438\u043d\u0442\u0435\u0440\u0444\u0435\u0439\u0441|\u0432\u0438\u0437\u0443\u0430\u043b|\u0434\u0438\u0437\u0430\u0439\u043d|\u043a\u0440\u0430\u0441\u0438\u0432|\u0441\u043e\u0432\u0440\u0435\u043c\u0435\u043d|\u0434\u043e\u0440\u043e\u0436|\u043f\u043e\u043b\u0438\u0440)/i,
  ]);
}

function shouldRequireManualTargetReview(
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
  selected: SelectedTaskFile[],
  tokenContext: TokenContext,
) {
  if (selected.length > 0) return false;
  if (area !== "ui" && area !== "general" && area !== "bugfix") return false;
  if (isVagueUiPolishTask(input, tokenContext)) return true;
  if (!hasSpecificUiObjectIntent(input)) return false;
  if (
    extractExplicitSymbolTargetNames(input.rawTask).some((targetName) =>
      inventoryHasExplicitSymbolTarget(input.inventory, targetName),
    )
  )
    return false;
  if (hasHeaderSurfaceIntent(input)) return false;
  if (hasFooterSurfaceIntent(input)) return false;
  const tokens = getSpecificPositiveTokens(input);
  if (shouldBlockUngroundedFormTarget(input, area, tokenContext)) return true;
  if (
    getSpecificUiObjectTokens(input).length > 0 &&
    tokenContext.explicitExistingPaths.length === 0 &&
    extractRouteMentions(input.rawTask).length === 0 &&
    !hasRawConcretePageLocation(input, area, tokenContext) &&
    !hasGroundedSpecificUiObjectFile(input, area, tokenContext, tokens)
  ) {
    return true;
  }
  if (hasStrongGroundedPageTarget(input, area, tokenContext)) return false;
  if (
    tokenContext.explicitExistingPaths.length > 0 ||
    extractRouteMentions(input.rawTask).length > 0
  )
    return false;
  if (hasGroundedStructuredConcreteTarget(input, area, "none")) return false;

  if (tokens.length === 0) return false;
  if (
    !hasConcreteUiLocationHint(input, tokenContext) &&
    !hasGroundedSpecificUiObjectFile(input, area, tokenContext, tokens)
  )
    return true;

  return !input.inventory.files
    .filter((file) => canUseSelectedFile(input, file, area, "none"))
    .some((file) => getSpecificPositiveOverlap(file, tokens) >= 2);
}

function getHeaderSurfaceStyleSeedFile(
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
  assetMode: AssetMode,
  selected: SelectedTaskFile[],
) {
  if (!hasHeaderSurfaceIntent(input)) return undefined;
  const seen = new Set(selected.map((file) => normalizeForCompare(file.path)));

  return input.inventory.files
    .filter((file) => file.kind === "style")
    .filter((file) => !seen.has(normalizeForCompare(file.path)))
    .filter((file) => canUseSelectedFile(input, file, area, assetMode))
    .map((file) => {
      const filePath = normalizeForCompare(file.path);
      const score =
        getHeaderSurfaceScore(file) +
        (includesAny(filePath, [
          "global.css",
          "globals.css",
          "app.css",
          "index.css",
        ])
          ? 46
          : 0);
      return { file, score };
    })
    .filter((item) => item.score >= 42)
    .sort((a, b) => b.score - a.score)[0]?.file;
}

function structuredIntentWantsExplicitOnly(input: SelectTaskFilesInput) {
  return (
    input.taskIntent?.structuredIntent?.allowedEditScope ===
      "explicit_targets_only" && getStructuredIntentTargets(input).length > 0
  );
}

function makeSelectedFile(
  file: ProjectInventoryFile,
  reason: string,
  confidence: number,
  requestedUsage = defaultUsageForFile(file),
): SelectedTaskFile {
  return {
    path: file.path,
    kind: file.kind,
    usage: sanitizeUsageForFile(file, requestedUsage),
    reason,
    confidence: Math.min(0.98, Math.max(0.3, confidence)),
  };
}

function canUseSelectedFile(
  input: SelectTaskFilesInput,
  file: ProjectInventoryFile,
  area = getEffectiveTaskArea(input),
  assetMode = getAssetMode(input),
) {
  const taskText = normalizeForCompare(buildTaskText(input));
  const constraints = getTaskConstraints(input);

  if (isProtectedByUserConstraint(file, input, area)) return false;
  if (isUnsupportedStructuredTargetPath(input, file)) return false;
  if (isSensitivePath(file.path)) return false;
  if (isSystemSeoFile(file) && !isSystemSeoRelevantForTask(input)) return false;
  if (file.kind === "runtime") return false;
  if (file.isLikelyGenerated) return false;
  if (isGeneratedDoNotEditPath(file.path) && area !== "build") return false;
  if (
    isLockFilePath(file.path) &&
    !includesAny(taskText, ["lock", "package-lock", "pnpm-lock", "yarn.lock"])
  )
    return false;
  if (file.kind === "asset" && assetMode === "none") return false;
  if (
    file.sizeBytes === 0 &&
    !includesAny(input.rawTask, [file.name, file.path])
  )
    return false;

  if (
    constraints.noBackendMutation &&
    (isBackendProtectedRole(file) ||
      isBackendProtectedPath(file) ||
      isAuthProtectedFile(file) ||
      isServerSidePath(file.path) ||
      isClientApiBridgePath(file.path) ||
      (isBackendLeaningPath(file.path) && !isClientUiPath(file.path)))
  ) {
    return false;
  }

  if (area === "ui" && constraints.noBackendMutation) {
    if (isServerSidePath(file.path)) return false;
    if (isBackendLeaningPath(file.path) && !isClientUiPath(file.path))
      return false;
  }

  if (area === "backend") {
    if (file.kind === "asset" || file.kind === "style") return false;
    if (isClientUiPath(file.path) && !isClientApiBridgePath(file.path))
      return false;
  }

  if (area === "docs") {
    return file.kind === "docs" || isPackageOrConfigPath(file.path);
  }

  return true;
}

function isModelFileSemanticallyUseful(
  file: ProjectInventoryFile,
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
  assetMode: AssetMode,
  tokenContext: TokenContext,
) {
  const constraints = getTaskConstraints(input);

  if (!canUseSelectedFile(input, file, area, assetMode)) return false;

  if (
    area === "ui" &&
    constraints.noBackendMutation &&
    (isBackendLeaningPath(file.path) || isClientApiBridgePath(file.path))
  ) {
    return false;
  }

  if (
    area === "backend" &&
    constraints.noFrontendMutation &&
    isClientUiPath(file.path) &&
    !isClientApiBridgePath(file.path)
  ) {
    return false;
  }

  const score = scoreFileFallback(file, tokenContext, input, area, assetMode);
  const explicit = tokenContext.explicitExistingPaths.some(
    (pathValue) =>
      normalizeForCompare(pathValue) === normalizeForCompare(file.path),
  );
  if (explicit) return true;

  if (assetMode === "primary") {
    if (file.kind === "asset")
      return isUsefulAssetForTask(file, input) || score >= 70;
    return isAssetReferenceControllerPath(file.path) || file.kind === "style";
  }

  if (area === "docs") {
    return file.kind === "docs" || isPackageOrConfigPath(file.path);
  }

  if (area === "build") {
    return (
      isPackageOrConfigPath(file.path) ||
      isEntryOrFrameworkPath(file.path) ||
      score >= 58
    );
  }

  if (area === "backend") {
    return (
      isBackendLeaningPath(file.path) ||
      isClientApiBridgePath(file.path) ||
      score >= 60
    );
  }

  if (area === "fullstack") {
    if (isBackendLeaningPath(file.path)) return true;
    if (isClientApiBridgePath(file.path)) return true;
    if (isLikelyFullstackUiActionFile(file, input)) return true;
    if (file.kind === "style" && score >= 50) return true;

    // A real path is not automatically useful. Full-stack tasks need layer coverage, not random source files.
    return (
      score >= 82 &&
      !includesAny(normalizeForCompare(file.path), [
        "/core/",
        "/report/",
        "/io/",
      ])
    );
  }

  if (area === "ui") {
    return !isServerSidePath(file.path) && score >= 34;
  }

  return score >= 42;
}

function getScoredCandidates(
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
  assetMode: AssetMode,
  tokenContext: TokenContext,
  selected: SelectedTaskFile[],
) {
  const seen = new Set(selected.map((file) => normalizeForCompare(file.path)));
  const routeScoped = isRouteScopedTask(input, area, tokenContext);

  return input.inventory.files
    .filter(
      (file) =>
        !seen.has(normalizeForCompare(file.path)) &&
        canUseSelectedFile(input, file, area, assetMode),
    )
    .filter(
      (file) => !routeScoped || isWithinRequestedRouteScope(file, tokenContext),
    )
    .map((file) => ({
      file,
      score: scoreFileFallback(file, tokenContext, input, area, assetMode),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
}

function addBestMatchingFile(
  selected: SelectedTaskFile[],
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
  assetMode: AssetMode,
  predicate: (file: ProjectInventoryFile) => boolean,
  reason: string,
  confidence = 0.72,
) {
  const tokenContext = buildTokenContext(input);
  const best = getScoredCandidates(
    input,
    area,
    assetMode,
    tokenContext,
    selected,
  )
    .filter((item) => predicate(item.file))
    .sort((a, b) => b.score - a.score)[0]?.file;

  if (best) {
    selected.push(makeSelectedFile(best, reason, confidence));
  }
}

function addBestRequiredLayerFile(
  selected: SelectedTaskFile[],
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
  assetMode: AssetMode,
  predicate: (file: ProjectInventoryFile) => boolean,
  reason: string,
  confidence = 0.78,
) {
  const seen = new Set(selected.map((file) => normalizeForCompare(file.path)));
  const tokenContext = buildTokenContext(input);
  const best = input.inventory.files
    .filter((file) => !seen.has(normalizeForCompare(file.path)))
    .filter((file) => canUseSelectedFile(input, file, area, assetMode))
    .filter(predicate)
    .map((file) => ({
      file,
      score: scoreFileFallback(file, tokenContext, input, area, assetMode),
    }))
    .sort((a, b) => b.score - a.score)[0]?.file;

  if (best) {
    selected.push(makeSelectedFile(best, reason, confidence));
  }
}

function addBestFullstackUiSourceFile(
  selected: SelectedTaskFile[],
  input: SelectTaskFilesInput,
  reason: string,
  confidence = 0.84,
) {
  const seen = new Set(selected.map((file) => normalizeForCompare(file.path)));

  const best = input.inventory.files
    .filter((file) => !seen.has(normalizeForCompare(file.path)))
    .filter((file) => canUseSelectedFile(input, file, "fullstack", "none"))
    .filter((file) => isFrontendUiSourceFile(file))
    .map((file) => ({
      file,
      score: scoreFullstackUiSourceCandidate(file, input),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)[0];

  if (best) {
    selected.push(
      makeSelectedFile(
        best.file,
        reason,
        Math.max(confidence, Math.min(0.9, best.score / 120)),
      ),
    );
  }
}

function ensureHelpfulCoverage(
  selected: SelectedTaskFile[],
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
  assetMode: AssetMode,
) {
  const taskText = normalizeForCompare(buildTaskText(input));
  const hasStyle = selected.some((file) => file.kind === "style");
  const hasDocs = selected.some((file) => file.kind === "docs");
  const hasPackage = selected.some((file) =>
    normalizeForCompare(file.path).endsWith("package.json"),
  );
  const hasConfig = selected.some(
    (file) => file.kind === "config" || isPackageOrConfigPath(file.path),
  );
  const hasBackend = selected.some(
    (file) =>
      isBackendLeaningPath(file.path) && !isClientApiBridgePath(file.path),
  );
  const hasClientBridge = selected.some((file) =>
    isClientApiBridgePath(file.path),
  );
  const hasUiFile = selected.some(
    (file) =>
      file.kind === "source" &&
      isClientUiPath(file.path) &&
      !isClientApiBridgePath(file.path),
  );
  const hasAsset = selected.some((file) => file.kind === "asset");
  const wantsRedesign = includesAny(taskText, [
    "redesign",
    "design",
    "visual",
    "style",
    "css",
    "внешний вид",
    "дизайн",
    "визуал",
    "дороже",
    "чище",
    "деревян",
    "дефолт",
    "освежи",
  ]);

  if (assetMode === "primary") {
    if (!hasAsset) {
      addBestMatchingFile(
        selected,
        input,
        area,
        assetMode,
        (file) => file.kind === "asset" && isUsefulAssetForTask(file, input),
        "Added because asset-primary tasks should include matching real asset files from inventory.",
        0.9,
      );
    }

    if (!selected.some((file) => file.kind === "asset")) {
      addBestMatchingFile(
        selected,
        input,
        area,
        assetMode,
        (file) => file.kind === "asset",
        "Added because asset-primary tasks should include at least one real asset file from inventory.",
        0.78,
      );
    }

    addBestMatchingFile(
      selected,
      input,
      area,
      assetMode,
      (file) => isAssetReferenceControllerPath(file.path),
      "Added because logo/favicon usage is often controlled by app entry, shell, layout, manifest, or HTML files.",
      0.72,
    );
  }

  if (
    (area === "ui" || area === "fullstack") &&
    wantsRedesign &&
    !hasStyle &&
    (!isSpecificPageOrFileTask(input, area) ||
      isGlobalStyleRelevantForTask(input))
  ) {
    addBestMatchingFile(
      selected,
      input,
      area,
      assetMode,
      (file) => file.kind === "style",
      "Added to cover visual styling for the requested UI change.",
      0.72,
    );
  }

  if (area === "docs") {
    const docsTokenContext = buildTokenContext(input);
    const hasStrongDocs = selected.some((file) => {
      const inventoryFile = findInventoryFile(input.inventory, file.path);
      return (
        inventoryFile?.kind === "docs" &&
        getStrongTokenMatchCountForFile(
          inventoryFile,
          docsTokenContext.strongTokens,
        ) > 0
      );
    });
    if (!hasDocs)
      addBestMatchingFile(
        selected,
        input,
        area,
        assetMode,
        (file) => file.kind === "docs",
        "Added because documentation tasks should inspect existing docs first.",
        0.78,
      );
    if (hasDocs && !hasStrongDocs)
      addBestMatchingFile(
        selected,
        input,
        area,
        assetMode,
        (file) =>
          file.kind === "docs" &&
          getStrongTokenMatchCountForFile(file, docsTokenContext.strongTokens) >
            0,
        "Added because documentation tasks should include docs whose hints match the requested subject.",
        0.82,
      );
    if (!hasPackage)
      addBestMatchingFile(
        selected,
        input,
        area,
        assetMode,
        (file) => normalizeForCompare(file.path).endsWith("package.json"),
        "Added because setup documentation should reflect actual package scripts.",
        0.84,
      );
    if (!hasConfig)
      addBestMatchingFile(
        selected,
        input,
        area,
        assetMode,
        (file) => isPackageOrConfigPath(file.path),
        "Added because setup documentation may depend on project configuration.",
        0.68,
      );
  }

  if (area === "build") {
    if (!hasPackage)
      addBestMatchingFile(
        selected,
        input,
        area,
        assetMode,
        (file) => normalizeForCompare(file.path).endsWith("package.json"),
        "Added because build problems usually depend on package scripts and dependencies.",
        0.86,
      );
    if (!hasConfig)
      addBestMatchingFile(
        selected,
        input,
        area,
        assetMode,
        (file) => isPackageOrConfigPath(file.path),
        "Added because build problems often depend on framework or TypeScript config.",
        0.8,
      );
    addBestMatchingFile(
      selected,
      input,
      area,
      assetMode,
      (file) => isEntryOrFrameworkPath(file.path),
      "Added because build/import errors may originate from app entry, layout, page, or route files.",
      0.7,
    );
  }

  if (area === "backend") {
    if (!hasBackend)
      addBestMatchingFile(
        selected,
        input,
        area,
        assetMode,
        (file) => isBackendLeaningPath(file.path),
        "Added to cover the server/API side of the backend task.",
        0.82,
      );
  }

  if (area === "fullstack") {
    if (!hasBackend)
      addBestRequiredLayerFile(
        selected,
        input,
        area,
        assetMode,
        (file) =>
          isBackendLeaningPath(file.path) && !isClientApiBridgePath(file.path),
        "Added to cover the server/API side of the full-stack task.",
        0.8,
      );
    if (!hasClientBridge)
      addBestRequiredLayerFile(
        selected,
        input,
        area,
        assetMode,
        (file) => isClientApiBridgePath(file.path),
        "Added to cover the client API bridge for the full-stack task.",
        0.84,
      );

    const hasConcreteUiSource = selected.some(
      (file) =>
        file.kind === "source" &&
        isClientUiPath(file.path) &&
        !isClientApiBridgePath(file.path),
    );

    if (!hasConcreteUiSource) {
      addBestFullstackUiSourceFile(
        selected,
        input,
        "Added to cover the concrete UI page/component that should trigger the server endpoint and show the result.",
        0.84,
      );
    }

    if (
      !selected.some(
        (file) =>
          file.kind === "source" &&
          isClientUiPath(file.path) &&
          !isClientApiBridgePath(file.path),
      )
    ) {
      addBestMatchingFile(
        selected,
        input,
        area,
        assetMode,
        (file) => isFrontendUiSourceFile(file),
        "Added as a fallback UI source file for the full-stack task.",
        0.72,
      );
    }

    // A style file is useful, but it must not be the only UI coverage for full-stack actions.
    if (
      !selected.some((file) => file.kind === "style") &&
      selected.some(
        (file) =>
          file.kind === "source" &&
          isClientUiPath(file.path) &&
          !isClientApiBridgePath(file.path),
      )
    ) {
      addBestMatchingFile(
        selected,
        input,
        area,
        assetMode,
        (file) => file.kind === "style",
        "Added as optional styling context after a concrete UI source file was selected.",
        0.62,
      );
    }
  }

  return rankAndCapSelection(selected, input, area, assetMode);
}

function getRouteAwareSeedFiles(
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
  assetMode: AssetMode,
  tokenContext: TokenContext,
  selected: SelectedTaskFile[],
) {
  if (area === "docs") return [];
  if (isBroadUiScopeTask(input, area)) return [];
  if (tokenContext.routeMentions.length === 0) return [];

  const seen = new Set(selected.map((file) => normalizeForCompare(file.path)));
  const positiveTaskText = getPositiveTaskText(input.rawTask);
  const callbackFlowRequested = includesAny(positiveTaskText, [
    "callback",
    "redirect",
    "return url",
    "oauth callback",
    "auth callback",
    "\u043a\u043e\u043b\u0431\u044d\u043a",
    "\u0440\u0435\u0434\u0438\u0440\u0435\u043a\u0442",
    "\u0432\u043e\u0437\u0432\u0440\u0430\u0442",
    "\u043f\u043e\u0441\u043b\u0435 \u0432\u0445\u043e\u0434\u0430",
  ]);
  const getCallbackPenalty = (file: ProjectInventoryFile) => {
    if (callbackFlowRequested) return 0;
    const identity = normalizeForCompare(
      [
        file.path,
        file.name,
        file.routePath ?? "",
        ...(file.symbols ?? []),
        ...(file.exports ?? []),
      ].join(" "),
    );
    return includesAny(identity, ["callback", "redirect", "return"]) ? 180 : 0;
  };
  const available = input.inventory.files
    .filter((file) => !seen.has(normalizeForCompare(file.path)))
    .filter((file) => canUseSelectedFile(input, file, area, assetMode));

  const directPageCandidates = available
    .filter((file) => isDirectRoutePageMatch(file, tokenContext.routeMentions))
    .map((file) => ({
      file,
      score:
        getRouteMatchScore(file, tokenContext.routeMentions) +
        getPageSemanticMatchScore(file, input, tokenContext) * 0.45 +
        scoreFileFallback(file, tokenContext, input, area, assetMode) * 0.2 -
        getCallbackPenalty(file),
    }))
    .sort((a, b) => b.score - a.score);

  if (directPageCandidates.length > 0) {
    return directPageCandidates
      .slice(0, getConcretePageTargetLimit(input, area, tokenContext))
      .map((item) =>
        makeSelectedFile(
          item.file,
          "Selected as the concrete route/page target matched from the task and real project inventory.",
          Math.min(0.95, Math.max(0.84, item.score / 180)),
        ),
      );
  }

  const candidates = available
    .map((file) => ({
      file,
      score:
        getRouteMatchScore(file, tokenContext.routeMentions) +
        getPageSemanticMatchScore(file, input, tokenContext) * 0.35 +
        scoreFileFallback(file, tokenContext, input, area, assetMode) * 0.25 -
        getCallbackPenalty(file),
    }))
    .filter((item) => item.score >= 88)
    .filter(
      (item) =>
        !isGenericSharedUiPrimitive(item.file) &&
        !isAppShellOrEntrypointFile(item.file),
    )
    .sort((a, b) => b.score - a.score)
    .slice(
      0,
      isSpecificPageOrFileTask(input, area)
        ? getConcretePageTargetLimit(input, area, tokenContext)
        : 4,
    );

  return candidates.map((item) =>
    makeSelectedFile(
      item.file,
      "Selected by route-aware inventory matching from a route/page mention in the task.",
      Math.min(0.9, Math.max(0.72, item.score / 180)),
      isSpecificPageOrFileTask(input, area)
        ? "inspect-only"
        : defaultUsageForFile(item.file),
    ),
  );
}

function isTestPlanningTask(
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
) {
  if (area !== "tests" && area !== "general") return false;
  const text = normalizeForCompare(buildTaskText(input));
  const testIntent =
    /\b(?:test|tests|testing|coverage|scenarios|strategy)\b/i.test(text) ||
    /(?:\u0442\u0435\u0441\u0442|\u0442\u0435\u0441\u0442\u044b|\u0441\u0446\u0435\u043d\u0430\u0440)/i.test(
      text,
    );
  const planningIntent =
    /\b(?:find|where|recommend|prepare|plan|strategy|describe|outline|review)\b/i.test(
      text,
    ) ||
    /(?:\u043d\u0430\u0439\u0434\u0438|\u0433\u0434\u0435|\u043b\u0443\u0447\u0448\u0435|\u043f\u043e\u0434\u0433\u043e\u0442\u043e\u0432|\u043e\u043f\u0438\u0448\u0438|\u0441\u0446\u0435\u043d\u0430\u0440|\u0441\u0442\u0440\u0430\u0442\u0435\u0433)/i.test(
      text,
    );
  const directTestWrite =
    /\b(?:write|implement|create)\s+(?:unit\s+|e2e\s+|integration\s+)?tests?\b/i.test(
      text,
    ) ||
    /(?:\u043d\u0430\u043f\u0438\u0448\u0438|\u0441\u043e\u0437\u0434\u0430\u0439)\s+[^.!?\n]{0,80}\u0442\u0435\u0441\u0442/i.test(
      text,
    );

  return testIntent && planningIntent && !directTestWrite;
}

function getTestPlanningReferenceFiles(
  input: SelectTaskFilesInput,
): SelectedTaskFile[] {
  const tokenContext = buildTokenContext(input);
  const infraCandidates = input.inventory.files
    .filter((file) => {
      const filePath = normalizeForCompare(file.path);
      const fileName = filePath.split("/").pop() ?? filePath;
      return (
        file.kind === "test" ||
        file.kind === "docs" ||
        file.kind === "config" ||
        fileName === "package.json" ||
        fileName.startsWith("vitest.config") ||
        fileName.startsWith("jest.config") ||
        fileName.startsWith("playwright.config") ||
        fileName.startsWith("cypress.config") ||
        fileName.startsWith("tsconfig") ||
        fileName === "readme.md" ||
        fileName === "agents.md"
      );
    })
    .filter((file) => canUseSelectedFile(input, file, "tests", "none"))
    .map((file) => {
      const filePath = normalizeForCompare(file.path);
      const fileName = filePath.split("/").pop() ?? filePath;
      let priority = 20;
      if (fileName === "package.json") priority += 100;
      if (file.kind === "test") priority += 90;
      if (fileName.includes("vitest") || fileName.includes("jest"))
        priority += 84;
      if (fileName.includes("playwright") || fileName.includes("cypress"))
        priority += 76;
      if (file.kind === "docs") priority += 58;
      if (file.kind === "config") priority += 36;
      if (fileName === "agents.md") priority += 24;
      return { file, priority };
    })
    .sort((a, b) => b.priority - a.priority)
    .slice(
      0,
      Math.max(2, getSelectionLimitFromSettings(input, "tests", "none") - 3),
    );

  const sourceCandidates = input.inventory.files
    .filter((file) => canUseSelectedFile(input, file, "tests", "none"))
    .filter((file) => file.kind === "source")
    .filter((file) => !isSensitivePath(file.path))
    .map((file) => ({
      file,
      score: scoreFileFallback(file, tokenContext, input, "tests", "none"),
      strongMatches: getStrongTokenMatchCountForFile(
        file,
        tokenContext.strongTokens,
      ),
    }))
    .filter((item) => {
      if (isPageLikeTargetFile(item.file) && item.strongMatches === 0)
        return false;
      return item.score >= 48 || item.strongMatches >= 2;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((item) => ({
      file: item.file,
      priority: Math.min(118, Math.max(54, item.score)),
    }));

  const candidates = [...sourceCandidates, ...infraCandidates]
    .filter(
      (item, index, all) =>
        all.findIndex(
          (other) =>
            normalizeForCompare(other.file.path) ===
            normalizeForCompare(item.file.path),
        ) === index,
    )
    .slice(0, getSelectionLimitFromSettings(input, "tests", "none"));

  return candidates.map(({ file, priority }) =>
    makeSelectedFile(
      file,
      "Selected as test-planning reference context. Planning tasks should inspect scripts, test config, docs, and existing tests before choosing edit targets.",
      Math.min(0.88, Math.max(0.58, priority / 150)),
      file.kind === "config" ||
        normalizeForCompare(file.path).endsWith("package.json")
        ? "config-reference"
        : "inspect-only",
    ),
  );
}

function isReviewProposeOnlyTask(input: SelectTaskFilesInput) {
  const text = normalizeForCompare(buildTaskText(input));
  const hasReviewIntent =
    /\b(?:review|audit|assess|analyze|analyse|suggest|recommend|proposal|propose|ideas|feedback|critique)\b/i.test(
      text,
    ) ||
    /(?:\u043f\u0440\u043e\u0432\u0435\u0440|\u043e\u0446\u0435\u043d|\u0430\u0443\u0434\u0438\u0442|\u043f\u0440\u0435\u0434\u043b\u043e\u0436|\u0438\u0434\u0435\u0438|\u0440\u0435\u0432\u044c\u044e|\u0441\u043e\u0432\u0435\u0442)/i.test(
      text,
    );
  const explicitNoEdit =
    /\b(?:do\s+not|don't|dont|without)\s+(?:edit|change|modify|touch|rewrite|implement)\b/i.test(
      text,
    ) ||
    /\b(?:no|only)\s+(?:code\s+)?(?:changes|edits|implementation)\b/i.test(
      text,
    ) ||
    /(?:\u043d\u0435\s+(?:\u0440\u0435\u0434\u0430\u043a\u0442\u0438\u0440|\u043c\u0435\u043d\u044f|\u0442\u0440\u043e\u0433|\u0438\u0437\u043c\u0435\u043d)|\u0431\u0435\u0437\s+(?:\u0438\u0437\u043c\u0435\u043d|\u043f\u0440\u0430\u0432\u043e\u043a)|\u0442\u043e\u043b\u044c\u043a\u043e\s+(?:\u043f\u0440\u0435\u0434\u043b\u043e\u0436|\u0440\u0435\u0432\u044c\u044e|\u043e\u0446\u0435\u043d))/i.test(
      text,
    );
  const directEditIntent =
    /\b(?:edit|change|fix|implement|add|create|update|rewrite|refactor|build)\b/i.test(
      text,
    ) ||
    /(?:\u0441\u0434\u0435\u043b|\u0443\u043b\u0443\u0447\u0448|\u0438\u0437\u043c\u0435\u043d|\u0438\u0441\u043f\u0440\u0430\u0432|\u0440\u0435\u0430\u043b\u0438\u0437|\u0434\u043e\u0431\u0430\u0432|\u0441\u043e\u0437\u0434|\u043f\u0435\u0440\u0435\u043f\u0438\u0448|\u0440\u0435\u0444\u0430\u043a\u0442\u043e\u0440)/i.test(
      text,
    ) ||
    /(?:\u043e\u0431\u043d\u043e\u0432|\u043d\u0430\u043f\u0438\u0448|\u043e\u043f\u0438\u0448|\u0434\u043e\u0440\u0430\u0431\u043e\u0442|\u043f\u043e\u0447\u0438\u043d)/i.test(
      text,
    );

  if (explicitNoEdit && directEditIntent && !hasReviewIntent) return false;

  return explicitNoEdit || (hasReviewIntent && !directEditIntent);
}

function isCoreSelfTask(input: SelectTaskFilesInput) {
  const text = normalizeForCompare(buildTaskText(input));
  return includesAny(text, [
    "\u044f\u0434\u0440\u043e",
    "\u0441\u0435\u043b\u0435\u043a\u0442\u043e\u0440",
    "\u0441\u043a\u0430\u043d\u0435\u0440",
    "\u043a\u043e\u043d\u0442\u0435\u043a\u0441\u0442",
    "\u043e\u0446\u0435\u043d\u043a\u0430",
    "\u0441\u043a\u043e\u0440\u0438\u043d\u0433",
    "\u0431\u0435\u0437\u043e\u043f\u0430\u0441",
    "selector",
    "file selector",
    "task file selector",
    "fallback",
    "scoring",
    "context quality",
    "manual review",
    "safety policy",
    "safety validator",
    "inventory scanner",
    "scanner",
    "context composer",
    "composer",
    "task pack builder",
    "taskpack builder",
    "prompt generation",
    "ollama json",
    "json repair",
    "replay test",
    "smoke test",
  ]);
}

function getAreaConflictDiagnostics(
  selection: TaskFileSelection,
  input?: SelectTaskFilesInput,
) {
  const requestedTaskType =
    input?.taskType ?? selection.diagnostics?.requestedTaskType ?? "general";
  const requestedArea = getSelectedTaskTypeArea(requestedTaskType);
  const inferredImplementationArea = selection.effectiveTaskArea;
  const areaConflict =
    requestedArea !== "general" && requestedArea !== inferredImplementationArea;
  const conflictReason =
    selection.conflictNote ??
    (areaConflict
      ? `Requested task type "${requestedTaskType}" maps to ${requestedArea}, but implementation files route to ${inferredImplementationArea}.`
      : undefined);

  return {
    inferredImplementationArea,
    areaConflict,
    conflictReason,
  };
}

function getSelectionRoleAdjustments(
  selection: TaskFileSelection,
  input?: SelectTaskFilesInput,
) {
  const reviewOnly = input ? isReviewProposeOnlyTask(input) : false;
  const adjustments: string[] = [];

  for (const file of selection.selectedFiles) {
    if (reviewOnly && file.usage !== "inspect-only") {
      adjustments.push(
        `${file.path}: review/propose-only task should keep this as inspect-only.`,
      );
      continue;
    }
    if (file.usage === "inspect-only") {
      adjustments.push(`${file.path}: inspect-only support/reference context.`);
    } else if (file.usage === "config-reference") {
      adjustments.push(
        `${file.path}: config reference, not implementation edit target.`,
      );
    } else if (file.usage === "asset-reference") {
      adjustments.push(`${file.path}: asset reference, not code edit target.`);
    } else if (file.usage === "create-and-edit") {
      adjustments.push(
        `${file.path}: planned new file from explicit in-project target.`,
      );
    }
  }

  return [...new Set(adjustments)].slice(0, 12);
}

function getSemanticGraphEvidence(
  selection: TaskFileSelection,
  input?: SelectTaskFilesInput,
) {
  if (!input || selection.selectedFiles.length < 2) return [];

  const selectedPaths = new Set(
    selection.selectedFiles.map((file) => normalizeForCompare(file.path)),
  );
  const graph = buildProjectSemanticGraph(input.inventory);
  const evidence: string[] = [];

  for (const selectedFile of selection.selectedFiles) {
    const node = graph.getNode(selectedFile.path);
    if (!node) continue;
    const edges = [...node.imports, ...node.importedBy, ...node.routeLocal];
    for (const edge of edges) {
      const relatedPath = edge.kind === "imported-by" ? edge.from : edge.to;
      if (!selectedPaths.has(normalizeForCompare(relatedPath))) continue;
      evidence.push(`${edge.from} -> ${edge.to} (${edge.kind})`);
    }
  }

  for (const selectedFile of selection.selectedFiles) {
    if (/semantic graph/i.test(selectedFile.reason)) {
      evidence.push(`${selectedFile.path}: ${selectedFile.reason}`);
    }
  }

  return [...new Set(evidence)].slice(0, 16);
}

function isInternalCoreSelectorFile(file: ProjectInventoryFile) {
  const filePath = normalizeForCompare(file.path);
  return (
    filePath.includes("server/src/ollama/taskfileselector") ||
    filePath.includes("server/src/selection/") ||
    filePath.includes("server/src/contextcomposer/") ||
    filePath.includes("server/src/scanner/") ||
    filePath.includes("server/src/routes/taskpacks")
  );
}

function getCoreSelfReferenceFiles(
  input: SelectTaskFilesInput,
  reviewOnly = false,
): SelectedTaskFile[] {
  const text = normalizeForCompare(buildTaskText(input));
  const selectedArea = getSelectedTaskTypeArea(input.taskType);
  const testsMode = selectedArea === "tests";
  const candidates = input.inventory.files
    .filter(
      (file) =>
        isInternalCoreSelectorFile(file) &&
        (reviewOnly
          ? canUseCoreSelfReferenceFile(file)
          : canUseSelectedFile(input, file, "backend", "none")),
    )
    .map((file) => {
      const filePath = normalizeForCompare(file.path);
      let score = 0;
      const isSelector = filePath.includes(
        "server/src/ollama/taskfileselector",
      );
      const isSelectorTest =
        filePath.includes("taskfileselector.replay") ||
        filePath.includes("taskfileselector.smoke");
      const isQuality = filePath.includes(
        "server/src/selection/contextquality",
      );
      const isSafety = filePath.includes("server/src/selection/safetypolicy");
      const isGraph = filePath.includes(
        "server/src/selection/projectsemanticgraph",
      );
      const isExplicitMentions = filePath.includes(
        "server/src/selection/explicitfilementions",
      );

      if (isSelector && !isSelectorTest) score += 92;
      if (isSelectorTest) score += testsMode ? 118 : 76;
      if (
        isQuality &&
        includesAny(text, [
          "scoring",
          "quality",
          "confidence",
          "fallback",
          "manual review",
        ])
      )
        score += 116;
      if (
        isSafety &&
        includesAny(text, ["safety", "policy", "secret", "blocked"])
      )
        score += 116;
      if (isGraph && includesAny(text, ["semantic graph", "graph", "imports"]))
        score += 104;
      if (
        isExplicitMentions &&
        includesAny(text, ["explicit target", "missing target", "file mention"])
      )
        score += 104;
      if (
        filePath.includes("server/src/contextcomposer/") &&
        text.includes("composer")
      )
        score += 96;
      if (
        filePath.includes("server/src/routes/taskpacks") &&
        includesAny(text, ["task pack", "prompt generation"])
      )
        score += 92;
      if (
        filePath.includes("server/src/scanner/") &&
        includesAny(text, ["scanner", "inventory"])
      )
        score += 96;
      return { file, score };
    })
    .filter((item) => item.score >= 70)
    .sort((a, b) => b.score - a.score)
    .slice(0, getSelectionLimitFromSettings(input, "backend", "none"));

  return candidates.map(({ file, score }) =>
    makeSelectedFile(
      file,
      "Selected by generic core/self routing because the task mentions ContextForge selector, safety, scanner, context composer, scoring, prompt generation, or Task Pack core behavior.",
      Math.min(0.9, Math.max(0.62, score / 150)),
      reviewOnly ||
        file.kind === "docs" ||
        file.kind === "config" ||
        (testsMode &&
          !normalizeForCompare(file.path).includes(".replay") &&
          !normalizeForCompare(file.path).includes(".smoke"))
        ? file.kind === "config"
          ? "config-reference"
          : "inspect-only"
        : defaultUsageForFile(file),
    ),
  );
}

function canUseCoreSelfReferenceFile(file: ProjectInventoryFile) {
  if (isSensitivePath(file.path)) return false;
  if (file.kind === "runtime" || file.kind === "asset") return false;
  if (file.isLikelyGenerated) return false;
  if (isLockFilePath(file.path)) return false;
  if (isGeneratedDoNotEditPath(file.path)) return false;
  return isInternalCoreSelectorFile(file);
}

function getReviewOnlyReferenceFiles(
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
  assetMode: AssetMode,
  tokenContext: TokenContext,
): SelectedTaskFile[] {
  const relaxedReferenceCandidates = input.inventory.files
    .filter((file) => {
      if (isSensitivePath(file.path)) return false;
      if (file.kind === "runtime") return false;
      if (file.isLikelyGenerated) return false;
      if (file.kind === "asset" && assetMode === "none") return false;
      return area === "ui"
        ? file.kind === "source" || file.kind === "style"
        : canUseSelectedFile(input, file, area, assetMode);
    })
    .map((file) => ({
      file,
      score:
        scoreFileFallback(file, tokenContext, input, area, assetMode) +
        (taskMentionsStructuredPath(input.rawTask, file.path) ? 90 : 0) +
        (file.routePath &&
        normalizeForCompare(input.rawTask).includes(
          normalizeForCompare(file.routePath).replace(/^\//, ""),
        )
          ? 70
          : 0),
    }))
    .filter((item) => item.score >= 38);
  const scored = [
    ...relaxedReferenceCandidates,
    ...getScoredCandidates(input, area, assetMode, tokenContext, []),
  ];
  const trimmed = trimLowValueFallbackCandidates(scored, tokenContext, area)
    .sort((a, b) => b.score - a.score)
    .slice(
      0,
      Math.max(3, getSelectionLimitFromSettings(input, area, assetMode)),
    )
    .filter((item) => item.score >= 38);

  return trimmed.map(({ file, score }) =>
    makeSelectedFile(
      file,
      "Selected as inspect-only review context because the task asks for suggestions, review, or proposal rather than code edits.",
      Math.min(0.78, Math.max(0.42, score / 130)),
      file.kind === "config" ? "config-reference" : "inspect-only",
    ),
  );
}

function buildFallbackSelection(
  input: SelectTaskFilesInput,
): TaskFileSelection {
  const startedAt = Date.now();
  const inferredTaskArea = getEffectiveTaskArea(input);
  const rawTaskText = input.rawTask.toLowerCase().replace(/[_./\\-]+/g, " ");
  const protectedBackendUiOverride =
    inferredTaskArea === "backend" &&
    getSelectedTaskTypeArea(input.taskType) === "general" &&
    [
      "api",
      "backend",
      "server",
      "endpoint",
      "request",
      "fetch",
      "upload",
      "loading",
      "\u0430\u043f\u0438",
      "\u0431\u044d\u043a",
      "\u0431\u0435\u043a",
      "\u0441\u0435\u0440\u0432\u0435\u0440",
      "\u0437\u0430\u043f\u0440\u043e\u0441",
      "\u0437\u0430\u0433\u0440\u0443\u0437",
    ].some((term) => rawTaskText.includes(term)) &&
    [
      "do not",
      "don't",
      "dont",
      "without",
      "avoid",
      "keep",
      "preserve",
      "\u043d\u0435 \u043c\u0435\u043d",
      "\u043d\u0435 \u0442\u0440\u043e\u0433",
      "\u043d\u0435 \u0440\u0435\u0434\u0430\u043a\u0442\u0438\u0440",
      "\u043d\u0435 \u0438\u0437\u043c\u0435\u043d",
      "\u0431\u0435\u0437 \u0438\u0437\u043c\u0435\u043d",
    ].some((term) => rawTaskText.includes(term)) &&
    [
      "ui",
      "ux",
      "frontend",
      "front end",
      "screen",
      "page",
      "layout",
      "visual",
      "design",
      "style",
      "css",
      "button",
      "form",
      "input",
      "modal",
      "dialog",
      "card",
      "navigation",
      "header",
      "menu",
      "\u044d\u043a\u0440\u0430\u043d",
      "\u0441\u0442\u0440\u0430\u043d\u0438\u0446",
      "\u0432\u0438\u0437\u0443\u0430\u043b",
      "\u0434\u0438\u0437\u0430\u0439\u043d",
      "\u0441\u0442\u0438\u043b",
      "\u043a\u043d\u043e\u043f",
      "\u0444\u043e\u0440\u043c",
      "\u043f\u043e\u043b\u0435",
      "\u0438\u043d\u043f\u0443\u0442",
      "\u043c\u043e\u0434\u0430\u043b",
      "\u043a\u0430\u0440\u0442\u043e\u0447",
      "\u043d\u0430\u0432\u0438\u0433\u0430\u0446",
      "\u0448\u0430\u043f\u043a",
    ].some((term) => rawTaskText.includes(term));
  const effectiveTaskArea: EffectiveTaskArea = protectedBackendUiOverride
    ? "ui"
    : inferredTaskArea;
  const assetMode = getAssetMode(input);
  const conflictNote = getConflictNote(input, effectiveTaskArea);
  const tokenContext = buildTokenContext(input);
  const constraints = getTaskConstraints(input);
  const selected: SelectedTaskFile[] = [];
  const hardSafety = detectHardTaskSafetyIssue(input.rawTask);
  const missingExplicitSymbolTargets = getMissingExplicitSymbolTargets(input);

  if (hardSafety.blocked) {
    return {
      selectedFiles: [],
      rejectedModelPaths: tokenContext.explicitMissingPaths,
      source: "fallback",
      usedFallback: true,
      durationMs: getDurationMs(startedAt),
      effectiveTaskArea,
      assetMode,
      conflictNote,
      notes: [
        "Fallback file selection was used.",
        "Hard safety policy stopped automatic file selection before reading snippets.",
        ...hardSafety.reasons,
        `Effective task area: ${effectiveTaskArea}.`,
        `Asset mode: ${assetMode}.`,
        conflictNote ?? "No task type conflict detected.",
        ...constraints.notes,
      ],
    };
  }

  if (isUiTaskWithBackendMutationConflict(input)) {
    return {
      selectedFiles: [],
      rejectedModelPaths: tokenContext.explicitMissingPaths,
      source: "fallback",
      usedFallback: true,
      durationMs: getDurationMs(startedAt),
      effectiveTaskArea,
      assetMode,
      conflictNote:
        conflictNote ??
        "Selected task type is UI, but the task text asks for backend/API mutation.",
      notes: [
        "Fallback file selection was used.",
        "Task type conflict stopped automatic selection: UI-only mode was selected, but the request asks to add or modify backend/API behavior.",
        "Choose a full-stack/backend task type or remove the backend/API request before generating.",
        `Effective task area: ${effectiveTaskArea}.`,
        `Asset mode: ${assetMode}.`,
        conflictNote ??
          "Selected task type is UI, but backend/API mutation was requested.",
        ...constraints.notes,
      ],
    };
  }

  const creationForbiddenMissingPaths = tokenContext.explicitMissingPaths.filter(
    (pathValue) => isExplicitFileCreationForbidden(input.rawTask, pathValue),
  );
  if (creationForbiddenMissingPaths.length > 0) {
    return {
      selectedFiles: [],
      rejectedModelPaths: creationForbiddenMissingPaths,
      source: "fallback",
      usedFallback: true,
      durationMs: getDurationMs(startedAt),
      effectiveTaskArea,
      assetMode,
      conflictNote,
      notes: [
        "Fallback file selection was used.",
        "The user explicitly forbade creating the missing named path, so ContextForge stopped before synthesizing or substituting any target.",
        `Creation-forbidden missing path(s): ${creationForbiddenMissingPaths.slice(0, 6).join(", ")}.`,
        `Effective task area: ${effectiveTaskArea}.`,
        `Asset mode: ${assetMode}.`,
        conflictNote ?? "No task type conflict detected.",
        ...constraints.notes,
      ],
      diagnostics: {
        selectionSource: "manual-review",
      } as TaskFileSelection["diagnostics"],
    };
  }

  if (
    tokenContext.explicitMissingPaths.length > 0 &&
    !hasCreateTargetIntent(input)
  ) {
    return {
      selectedFiles: [],
      rejectedModelPaths: tokenContext.explicitMissingPaths,
      source: "fallback",
      usedFallback: true,
      durationMs: getDurationMs(startedAt),
      effectiveTaskArea,
      assetMode,
      conflictNote,
      notes: [
        "Fallback file selection was used.",
        "Explicit target path was mentioned by the user but was not found in the project inventory. ContextForge blocked automatic substitution with similar files.",
        "Manual target selection or a corrected path is required before generation.",
        `Missing explicit path(s): ${tokenContext.explicitMissingPaths.slice(0, 6).join(", ")}.`,
        `Effective task area: ${effectiveTaskArea}.`,
        `Asset mode: ${assetMode}.`,
        conflictNote ?? "No task type conflict detected.",
        ...constraints.notes,
      ],
      diagnostics: {
        selectionSource: "manual-review",
      } as TaskFileSelection["diagnostics"],
    };
  }

  if (missingExplicitSymbolTargets.length > 0) {
    return {
      selectedFiles: [],
      rejectedModelPaths: [
        ...tokenContext.explicitMissingPaths,
        ...missingExplicitSymbolTargets,
      ],
      source: "fallback",
      usedFallback: true,
      durationMs: getDurationMs(startedAt),
      effectiveTaskArea,
      assetMode,
      conflictNote,
      notes: [
        "Fallback file selection was used.",
        `Explicit target name(s) were mentioned but not found in the real project inventory: ${missingExplicitSymbolTargets.join(", ")}.`,
        "Manual target selection is required; ContextForge will not replace a missing explicit target with a similar page or component.",
        `Effective task area: ${effectiveTaskArea}.`,
        `Asset mode: ${assetMode}.`,
        conflictNote ?? "No task type conflict detected.",
        ...constraints.notes,
      ],
    };
  }

  if (
    isCoreSelfTask(input) &&
    tokenContext.explicitExistingPaths.length === 0
  ) {
    const reviewOnly = isReviewProposeOnlyTask(input);
    const coreFiles = getCoreSelfReferenceFiles(input, reviewOnly);
    const coreEffectiveTaskArea =
      getSelectedTaskTypeArea(input.taskType) === "tests" ? "tests" : "backend";
    return {
      selectedFiles: coreFiles,
      rejectedModelPaths: tokenContext.explicitMissingPaths,
      source: "fallback",
      usedFallback: true,
      durationMs: getDurationMs(startedAt),
      effectiveTaskArea: coreEffectiveTaskArea,
      assetMode,
      conflictNote:
        conflictNote ??
        (effectiveTaskArea !== coreEffectiveTaskArea
          ? `Core/self routing selected server core files while preserving requested task type "${input.taskType}".`
          : undefined),
      notes: [
        "Fallback file selection was used.",
        "Core/self routing profile detected selector, safety, scanner, context composer, scoring, prompt generation, or Task Pack core behavior.",
        reviewOnly
          ? "Review/propose-only intent detected; selected files are inspect-only references."
          : "Core files were selected by generic technical role, not by project-specific rules.",
        "Selected task type is preserved separately from implementation area diagnostics.",
        `Effective task area: ${coreEffectiveTaskArea}.`,
        `Asset mode: ${assetMode}.`,
        conflictNote ?? "No task type conflict detected.",
        ...constraints.notes,
        coreFiles.length > 0
          ? "Core/self candidates were grounded in real inventory paths."
          : "No core/self files matching selector, safety, scanner, composer, or Task Pack builder roles were found.",
      ],
    };
  }

  if (isAmbiguousLowSignalTask(input, effectiveTaskArea, tokenContext)) {
    return {
      selectedFiles: [],
      rejectedModelPaths: tokenContext.explicitMissingPaths,
      source: "fallback",
      usedFallback: true,
      durationMs: getDurationMs(startedAt),
      effectiveTaskArea,
      assetMode,
      conflictNote,
      notes: [
        "Fallback file selection was used.",
        "Automatic selection stopped because the task is too broad and does not name a concrete page, component, file, route, feature, test target, or documentation target.",
        "Manual target selection or a more specific task is required before generating a Task Pack.",
        `Effective task area: ${effectiveTaskArea}.`,
        `Asset mode: ${assetMode}.`,
        conflictNote ?? "No task type conflict detected.",
        ...constraints.notes,
      ],
    };
  }

  if (isReviewProposeOnlyTask(input)) {
    const reviewFiles = getReviewOnlyReferenceFiles(
      input,
      effectiveTaskArea,
      assetMode,
      tokenContext,
    );
    return {
      selectedFiles: reviewFiles,
      rejectedModelPaths: tokenContext.explicitMissingPaths,
      source: "fallback",
      usedFallback: true,
      durationMs: getDurationMs(startedAt),
      effectiveTaskArea,
      assetMode,
      conflictNote,
      notes: [
        "Fallback file selection was used.",
        "Review/propose-only routing detected; ContextForge selected reference context without edit targets.",
        `Effective task area: ${effectiveTaskArea}.`,
        `Asset mode: ${assetMode}.`,
        conflictNote ?? "No task type conflict detected.",
        ...constraints.notes,
        reviewFiles.length > 0
          ? "No inspect-and-edit files were selected because the task asks for review, suggestions, or proposal only."
          : "No safe reference files were found for this review/propose-only task.",
      ],
    };
  }

  if (
    isTestPlanningTask(input, effectiveTaskArea) &&
    tokenContext.explicitExistingPaths.length === 0
  ) {
    const referenceFiles = getTestPlanningReferenceFiles(input);
    return {
      selectedFiles: referenceFiles,
      rejectedModelPaths: tokenContext.explicitMissingPaths,
      source: "fallback",
      usedFallback: true,
      durationMs: getDurationMs(startedAt),
      effectiveTaskArea,
      assetMode,
      conflictNote,
      notes: [
        "Fallback file selection was used.",
        "Test-planning intent detected; ContextForge selected scripts, test config, docs, and existing tests as reference context instead of editing random production pages.",
        `Effective task area: ${effectiveTaskArea}.`,
        `Asset mode: ${assetMode}.`,
        conflictNote ?? "No task type conflict detected.",
        ...constraints.notes,
        referenceFiles.length > 0
          ? "No direct edit target was selected because the task asks for planning/review rather than implementing tests."
          : "No package, docs, test, or test-config context was found for this planning task.",
      ],
    };
  }

  for (const explicitPath of tokenContext.explicitExistingPaths) {
    const inventoryFile = findInventoryFile(input.inventory, explicitPath);
    if (
      inventoryFile &&
      canUseSelectedFile(input, inventoryFile, effectiveTaskArea, assetMode)
    ) {
      const secondaryDocs = isSecondaryDocumentationMention(
        inventoryFile,
        input,
        effectiveTaskArea,
      );
      const primaryExplicitDocs =
        effectiveTaskArea === "docs" && inventoryFile.kind === "docs";
      selected.push(
        makeSelectedFile(
          inventoryFile,
          primaryExplicitDocs
            ? "Explicit documentation target validated against the inventory; markdown documentation is the primary edit surface."
            : secondaryDocs
              ? "Mentioned as a secondary documentation deliverable; include as reference after source/API context."
              : "Explicitly mentioned by the user and validated against the real project inventory.",
          primaryExplicitDocs ? 0.97 : secondaryDocs ? 0.72 : 0.95,
          primaryExplicitDocs
            ? "inspect-and-edit"
            : secondaryDocs
              ? "inspect-only"
              : defaultUsageForFile(inventoryFile),
        ),
      );
    }
  }

  for (const structuredFile of getStructuredIntentSeedFiles(
    input,
    effectiveTaskArea,
    assetMode,
    selected,
  )) {
    selected.push(structuredFile);
  }

  const headerSurfaceSeedFiles = getHeaderSurfaceSeedFiles(
    input,
    effectiveTaskArea,
    assetMode,
    selected,
  );
  for (const surfaceFile of headerSurfaceSeedFiles) {
    selected.push(surfaceFile);
  }

  const hasSelectedHeaderSurface =
    hasHeaderSurfaceIntent(input) &&
    selected.some((selectedFile) => {
      const inventoryFile = findInventoryFile(
        input.inventory,
        selectedFile.path,
      );
      return Boolean(
        inventoryFile && getHeaderSurfaceScore(inventoryFile) >= 70,
      );
    });

  if (headerSurfaceSeedFiles.length > 0 || hasSelectedHeaderSurface) {
    const styleFile = getHeaderSurfaceStyleSeedFile(
      input,
      effectiveTaskArea,
      assetMode,
      selected,
    );
    if (styleFile) {
      selected.push(
        makeSelectedFile(
          styleFile,
          "Added as style/layout context for the selected header/navigation surface.",
          0.72,
        ),
      );
    }

    const finalSelectedFiles = rankAndCapSelection(
      selected,
      input,
      effectiveTaskArea,
      assetMode,
    );
    return {
      selectedFiles: finalSelectedFiles,
      rejectedModelPaths: tokenContext.explicitMissingPaths,
      source: "fallback",
      usedFallback: true,
      durationMs: getDurationMs(startedAt),
      effectiveTaskArea,
      assetMode,
      conflictNote,
      notes: [
        "Fallback file selection was used.",
        "Fallback selection is universal and does not rely on project-specific domain rules.",
        "Header/navigation surface target detected; broad generic UI fallback candidates were skipped.",
        `Effective task area: ${effectiveTaskArea}.`,
        `Asset mode: ${assetMode}.`,
        conflictNote ?? "No task type conflict detected.",
        ...constraints.notes,
        tokenContext.explicitMissingPaths.length > 0
          ? `Explicit path(s) mentioned by the user but not found in inventory: ${tokenContext.explicitMissingPaths.join(", ")}.`
          : "No missing explicit user paths detected.",
      ],
    };
  }

  const footerSurfaceSeedFiles = getFooterSurfaceSeedFiles(
    input,
    effectiveTaskArea,
    assetMode,
    selected,
  );
  if (footerSurfaceSeedFiles.length > 0) {
    selected.push(...footerSurfaceSeedFiles);
    const finalSelectedFiles = rankAndCapSelection(
      selected,
      input,
      effectiveTaskArea,
      assetMode,
    );
    return {
      selectedFiles: finalSelectedFiles,
      rejectedModelPaths: tokenContext.explicitMissingPaths,
      source: "fallback",
      usedFallback: true,
      durationMs: getDurationMs(startedAt),
      effectiveTaskArea,
      assetMode,
      conflictNote,
      notes: [
        "Fallback file selection was used.",
        "Fallback selection is universal and does not rely on project-specific domain rules.",
        "Footer/link surface target detected; broad generic UI fallback candidates were skipped.",
        `Effective task area: ${effectiveTaskArea}.`,
        `Asset mode: ${assetMode}.`,
        conflictNote ?? "No task type conflict detected.",
        ...constraints.notes,
        tokenContext.explicitMissingPaths.length > 0
          ? `Explicit path(s) mentioned by the user but not found in inventory: ${tokenContext.explicitMissingPaths.join(", ")}.`
          : "No missing explicit user paths detected.",
      ],
    };
  }

  const searchSurfaceSeedFiles = getSearchSurfaceSeedFiles(
    input,
    effectiveTaskArea,
    assetMode,
    selected,
  );
  if (searchSurfaceSeedFiles.length > 0) {
    selected.push(...searchSurfaceSeedFiles);
    const finalSelectedFiles = rankAndCapSelection(
      selected,
      input,
      effectiveTaskArea,
      assetMode,
    );
    return {
      selectedFiles: finalSelectedFiles,
      rejectedModelPaths: tokenContext.explicitMissingPaths,
      source: "fallback",
      usedFallback: true,
      durationMs: getDurationMs(startedAt),
      effectiveTaskArea,
      assetMode,
      conflictNote,
      notes: [
        "Fallback file selection was used.",
        "Fallback selection is universal and does not rely on project-specific domain rules.",
        "Search/input surface target detected; broad generic UI fallback candidates were skipped.",
        `Effective task area: ${effectiveTaskArea}.`,
        `Asset mode: ${assetMode}.`,
        conflictNote ?? "No task type conflict detected.",
        ...constraints.notes,
        tokenContext.explicitMissingPaths.length > 0
          ? `Explicit path(s) mentioned by the user but not found in inventory: ${tokenContext.explicitMissingPaths.join(", ")}.`
          : "No missing explicit user paths detected.",
      ],
    };
  }

  const loadingSurfaceSeedFiles = getLoadingSurfaceSeedFiles(
    input,
    effectiveTaskArea,
    assetMode,
    selected,
  );
  if (loadingSurfaceSeedFiles.length > 0) {
    selected.push(...loadingSurfaceSeedFiles);
    const finalSelectedFiles = rankAndCapSelection(
      selected,
      input,
      effectiveTaskArea,
      assetMode,
    );
    return {
      selectedFiles: finalSelectedFiles,
      rejectedModelPaths: tokenContext.explicitMissingPaths,
      source: "fallback",
      usedFallback: true,
      durationMs: getDurationMs(startedAt),
      effectiveTaskArea,
      assetMode,
      conflictNote,
      notes: [
        "Fallback file selection was used.",
        "Fallback selection is universal and does not rely on project-specific domain rules.",
        "Loading/skeleton surface target detected; broad generic UI fallback candidates were skipped.",
        `Effective task area: ${effectiveTaskArea}.`,
        `Asset mode: ${assetMode}.`,
        conflictNote ?? "No task type conflict detected.",
        ...constraints.notes,
        tokenContext.explicitMissingPaths.length > 0
          ? `Explicit path(s) mentioned by the user but not found in inventory: ${tokenContext.explicitMissingPaths.join(", ")}.`
          : "No missing explicit user paths detected.",
      ],
    };
  }

  const conditionalReviewCandidates = getConditionalTargetReviewCandidates(
    input,
    effectiveTaskArea,
    assetMode,
    tokenContext,
  );
  if (conditionalReviewCandidates.length > 0) {
    return {
      selectedFiles: [],
      rejectedModelPaths: tokenContext.explicitMissingPaths,
      source: "fallback",
      usedFallback: true,
      durationMs: getDurationMs(startedAt),
      effectiveTaskArea,
      assetMode,
      conflictNote,
      notes: [
        "Fallback file selection was used.",
        "Fallback selection stopped because the task asks to edit an existing page if present or create it otherwise, but no explicit path or route was provided.",
        "Manual target review is required instead of choosing a possibly wrong page automatically.",
        `Possible page candidates: ${conditionalReviewCandidates.map((item) => item.file.path).join(", ")}.`,
        `Effective task area: ${effectiveTaskArea}.`,
        `Asset mode: ${assetMode}.`,
        conflictNote ?? "No task type conflict detected.",
        ...constraints.notes,
        tokenContext.explicitMissingPaths.length > 0
          ? `Explicit path(s) mentioned by the user but not found in inventory: ${tokenContext.explicitMissingPaths.join(", ")}.`
          : "No missing explicit user paths detected.",
      ],
    };
  }

  if (
    shouldRequireManualTargetReview(
      input,
      effectiveTaskArea,
      selected,
      tokenContext,
    )
  ) {
    const groundedReviewTokens = getSpecificPositiveTokens(input);
    return {
      selectedFiles: [],
      rejectedModelPaths: tokenContext.explicitMissingPaths,
      source: "fallback",
      usedFallback: true,
      durationMs: getDurationMs(startedAt),
      effectiveTaskArea,
      assetMode,
      conflictNote,
      notes: [
        "Fallback file selection was used.",
        "Fallback selection stopped before route-aware ranking because the task names a specific UI object, but no matching page/component/form target was grounded in the inventory.",
        "Review files manually or add the exact page/component path before generating.",
        `Effective task area: ${effectiveTaskArea}.`,
        `Asset mode: ${assetMode}.`,
        conflictNote ?? "No task type conflict detected.",
        ...constraints.notes,
        groundedReviewTokens.length > 0
          ? `Grounded review tokens: ${groundedReviewTokens.slice(0, 18).join(", ")}.`
          : "No grounded review tokens were extracted.",
        tokenContext.explicitMissingPaths.length > 0
          ? `Explicit path(s) mentioned by the user but not found in inventory: ${tokenContext.explicitMissingPaths.join(", ")}.`
          : "No missing explicit user paths detected.",
      ],
    };
  }

  for (const routeFile of getRouteAwareSeedFiles(
    input,
    effectiveTaskArea,
    assetMode,
    tokenContext,
    selected,
  )) {
    selected.push(routeFile);
  }

  if (
    (constraints.onlyExplicitFiles ||
      structuredIntentWantsExplicitOnly(input)) &&
    selected.length > 0
  ) {
    const finalSelectedFiles = rankAndCapSelection(
      selected,
      input,
      effectiveTaskArea,
      assetMode,
    );

    return {
      selectedFiles: finalSelectedFiles,
      rejectedModelPaths: tokenContext.explicitMissingPaths,
      source: "fallback",
      usedFallback: true,
      durationMs: getDurationMs(startedAt),
      effectiveTaskArea,
      assetMode,
      conflictNote,
      notes: [
        "Fallback file selection was used.",
        "Fallback selection is universal and does not rely on project-specific domain rules.",
        structuredIntentWantsExplicitOnly(input)
          ? "Structured intent constrained the task to explicit target(s), so ContextForge did not add unrelated fallback files."
          : "User constrained the task to explicit file(s), so ContextForge did not add unrelated fallback files.",
        `Effective task area: ${effectiveTaskArea}.`,
        `Asset mode: ${assetMode}.`,
        conflictNote ?? "No task type conflict detected.",
        ...constraints.notes,
        tokenContext.explicitMissingPaths.length > 0
          ? `Explicit path(s) mentioned by the user but not found in inventory: ${tokenContext.explicitMissingPaths.join(", ")}.`
          : "No missing explicit user paths detected.",
      ],
    };
  }

  const explicitPrimaryFiles = tokenContext.explicitExistingPaths
    .map((pathValue) => findInventoryFile(input.inventory, pathValue))
    .filter((file): file is ProjectInventoryFile =>
      Boolean(
        file &&
        !isSecondaryDocumentationMention(file, input, effectiveTaskArea),
      ),
    );

  if (
    explicitPrimaryFiles.length > 0 &&
    isSpecificPageOrFileTask(input, effectiveTaskArea)
  ) {
    if (effectiveTaskArea === "docs") {
      const referenceFiles = input.inventory.files.filter((file) => {
        const filePath = normalizeForCompare(file.path);
        return (
          filePath.endsWith("package.json") ||
          filePath.endsWith(".env.example") ||
          filePath.endsWith(".env.sample") ||
          filePath.endsWith(".env.template")
        );
      });
      for (const referenceFile of referenceFiles) {
        selected.push(
          makeSelectedFile(
            referenceFile,
            "Added as safe setup/config reference for the explicit documentation target.",
            0.82,
            "config-reference",
          ),
        );
      }
    }
    const finalSelectedFiles = ensureHelpfulCoverage(
      selected,
      input,
      effectiveTaskArea,
      assetMode,
    );

    return {
      selectedFiles: finalSelectedFiles,
      rejectedModelPaths: tokenContext.explicitMissingPaths,
      source: "fallback",
      usedFallback: true,
      durationMs: getDurationMs(startedAt),
      effectiveTaskArea,
      assetMode,
      conflictNote,
      notes: [
        "Fallback file selection was used.",
        "Fallback selection is universal and does not rely on project-specific domain rules.",
        "Explicit primary file target detected; broad fallback candidates were skipped to keep the edit scope narrow.",
        `Effective task area: ${effectiveTaskArea}.`,
        `Asset mode: ${assetMode}.`,
        conflictNote ?? "No task type conflict detected.",
        ...constraints.notes,
        tokenContext.explicitMissingPaths.length > 0
          ? `Explicit path(s) mentioned by the user but not found in inventory: ${tokenContext.explicitMissingPaths.join(", ")}.`
          : "No missing explicit user paths detected.",
      ],
    };
  }

  if (
    shouldRequireManualTargetReview(
      input,
      effectiveTaskArea,
      selected,
      tokenContext,
    )
  ) {
    const groundedReviewTokens = getSpecificPositiveTokens(input);
    return {
      selectedFiles: [],
      rejectedModelPaths: tokenContext.explicitMissingPaths,
      source: "fallback",
      usedFallback: true,
      durationMs: getDurationMs(startedAt),
      effectiveTaskArea,
      assetMode,
      conflictNote,
      notes: [
        "Fallback file selection was used.",
        "Fallback selection stopped before semantic page ranking because the task names a specific UI object, but no matching page/component/form target was grounded in the inventory.",
        "Review files manually or add the exact page/component path before generating.",
        `Effective task area: ${effectiveTaskArea}.`,
        `Asset mode: ${assetMode}.`,
        conflictNote ?? "No task type conflict detected.",
        ...constraints.notes,
        groundedReviewTokens.length > 0
          ? `Grounded review tokens: ${groundedReviewTokens.slice(0, 18).join(", ")}.`
          : "No grounded review tokens were extracted.",
        tokenContext.explicitMissingPaths.length > 0
          ? `Explicit path(s) mentioned by the user but not found in inventory: ${tokenContext.explicitMissingPaths.join(", ")}.`
          : "No missing explicit user paths detected.",
      ],
    };
  }

  if (!hasSelectedConcretePageTarget(selected, input.inventory)) {
    for (const item of getSemanticPageTargetCandidates(
      input,
      effectiveTaskArea,
      assetMode,
      tokenContext,
      selected,
    )) {
      selected.push(
        makeSelectedFile(
          item.file,
          "Selected as the concrete page target by matching the task against real page text, headings, metadata hints, route path, and symbols from inventory.",
          Math.min(0.95, Math.max(0.84, item.score / 180)),
        ),
      );
    }
  }

  const selectedPageTargets = [
    ...getSelectedConcretePageTargets(selected, input.inventory),
    ...getStrongConcretePageTargetsFromInventory(
      input,
      effectiveTaskArea,
      assetMode,
      tokenContext,
    ),
  ];
  if (
    selectedPageTargets.length > 0 &&
    isSpecificPageOrFileTask(input, effectiveTaskArea)
  ) {
    const primaryPageTargets = getPrimaryConcretePageTargets(
      input,
      effectiveTaskArea,
      tokenContext,
      selectedPageTargets,
    );
    const pageTargetPaths = new Set(
      primaryPageTargets.map((file) => normalizeForCompare(file.path)),
    );
    const pageScopedSelected = selected.filter((file) =>
      pageTargetPaths.has(normalizeForCompare(file.path)),
    );
    for (const pageTarget of primaryPageTargets) {
      if (
        !pageScopedSelected.some(
          (file) =>
            normalizeForCompare(file.path) ===
            normalizeForCompare(pageTarget.path),
        )
      ) {
        pageScopedSelected.push(
          makeSelectedFile(
            pageTarget,
            "Selected as the strongest concrete page target after validating route/page semantics against the real inventory.",
            0.9,
            defaultUsageForFile(pageTarget),
          ),
        );
      }
    }
    pageScopedSelected.push(
      ...getImportedReferenceFilesForPageTargets(
        input,
        primaryPageTargets,
        effectiveTaskArea,
        assetMode,
        pageScopedSelected,
      ),
    );
    const finalSelectedFiles = rankAndCapSelection(
      pageScopedSelected,
      input,
      effectiveTaskArea,
      assetMode,
    );

    return {
      selectedFiles: finalSelectedFiles,
      rejectedModelPaths: tokenContext.explicitMissingPaths,
      source: "fallback",
      usedFallback: true,
      durationMs: getDurationMs(startedAt),
      effectiveTaskArea,
      assetMode,
      conflictNote,
      notes: [
        "Fallback file selection was used.",
        "Fallback selection is universal and does not rely on project-specific domain rules.",
        "Concrete page target detected from route/page semantics; broad generic UI fallback candidates were skipped.",
        `Effective task area: ${effectiveTaskArea}.`,
        `Asset mode: ${assetMode}.`,
        `Composer file limit for "${effectiveTaskArea}": ${getSelectionLimitFromSettings(input, effectiveTaskArea, assetMode)}.`,
        conflictNote ?? "No task type conflict detected.",
        ...constraints.notes,
        tokenContext.strongTokens.length > 0
          ? `Strong fallback tokens: ${tokenContext.strongTokens.slice(0, 18).join(", ")}.`
          : "No strong fallback tokens were extracted.",
        tokenContext.explicitMissingPaths.length > 0
          ? `Explicit path(s) mentioned by the user but not found in inventory: ${tokenContext.explicitMissingPaths.join(", ")}.`
          : "No missing explicit user paths detected.",
      ],
    };
  }

  if (
    shouldRequireManualTargetReview(
      input,
      effectiveTaskArea,
      selected,
      tokenContext,
    )
  ) {
    const groundedReviewTokens = getSpecificPositiveTokens(input);
    return {
      selectedFiles: [],
      rejectedModelPaths: tokenContext.explicitMissingPaths,
      source: "fallback",
      usedFallback: true,
      durationMs: getDurationMs(startedAt),
      effectiveTaskArea,
      assetMode,
      conflictNote,
      notes: [
        "Fallback file selection was used.",
        "Fallback selection stopped before broad ranking because the task names a specific UI object, but no matching page/component/form target was grounded in the inventory.",
        "Review files manually or add the exact page/component path before generating.",
        `Effective task area: ${effectiveTaskArea}.`,
        `Asset mode: ${assetMode}.`,
        conflictNote ?? "No task type conflict detected.",
        ...constraints.notes,
        groundedReviewTokens.length > 0
          ? `Grounded review tokens: ${groundedReviewTokens.slice(0, 18).join(", ")}.`
          : "No grounded review tokens were extracted.",
        tokenContext.explicitMissingPaths.length > 0
          ? `Explicit path(s) mentioned by the user but not found in inventory: ${tokenContext.explicitMissingPaths.join(", ")}.`
          : "No missing explicit user paths detected.",
      ],
    };
  }

  const scored = getScoredCandidates(
    input,
    effectiveTaskArea,
    assetMode,
    tokenContext,
    selected,
  );
  const trimmed = trimLowValueFallbackCandidates(
    scored,
    tokenContext,
    effectiveTaskArea,
  );

  const allowCoreSelfFallbackCandidates = isCoreSelfTask(input);

  for (const { file, score } of trimmed) {
    if (!allowCoreSelfFallbackCandidates && isInternalCoreSelectorFile(file)) {
      continue;
    }

    const requestedUsage = getFallbackCandidateUsage(
      input,
      effectiveTaskArea,
      file,
    );
    const defaultUsage = defaultUsageForFile(file);
    const usageWasDowngraded =
      defaultUsage === "inspect-and-edit" && requestedUsage === "inspect-only";

    selected.push(
      makeSelectedFile(
        file,
        usageWasDowngraded
          ? "Selected as inspect-only fallback context because its technical role is relevant, but domain-specific graph/token evidence is weak."
          : score > 45
            ? "Selected by universal fallback ranking based on task meaning, file kind, path overlap, and technical role."
            : "Selected by universal fallback ranking as potentially useful context.",
        Math.min(0.84, Math.max(0.35, score / 120)),
        requestedUsage,
      ),
    );
  }

  selected.push(
    ...getSemanticSupportFilesForSelectedTargets(
      input,
      selected,
      effectiveTaskArea,
      assetMode,
    ),
  );

  const finalSelectedFiles = ensureRequiredFullstackLayers(
    rankAndCapSelection(
      scopeFullstackSelectionToPrimaryUiTargets(
        input,
        effectiveTaskArea,
        scopeSelectionToPrimaryPageTargets(
          input,
          effectiveTaskArea,
          assetMode,
          ensureHelpfulCoverage(selected, input, effectiveTaskArea, assetMode),
        ),
      ),
      input,
      effectiveTaskArea,
      assetMode,
    ),
    input,
    effectiveTaskArea,
    assetMode,
  );

  return {
    selectedFiles: finalSelectedFiles,
    rejectedModelPaths: tokenContext.explicitMissingPaths,
    source: "fallback",
    usedFallback: true,
    durationMs: getDurationMs(startedAt),
    effectiveTaskArea,
    assetMode,
    conflictNote,
    notes: [
      "Fallback file selection was used.",
      "Fallback selection is universal and does not rely on project-specific domain rules.",
      `Effective task area: ${effectiveTaskArea}.`,
      `Asset mode: ${assetMode}.`,
      `Composer file limit for "${effectiveTaskArea}": ${getSelectionLimitFromSettings(input, effectiveTaskArea, assetMode)}.`,
      conflictNote ?? "No task type conflict detected.",
      ...constraints.notes,
      tokenContext.strongTokens.length > 0
        ? `Strong fallback tokens: ${tokenContext.strongTokens.slice(0, 18).join(", ")}.`
        : "No strong fallback tokens were extracted.",
      tokenContext.explicitMissingPaths.length > 0
        ? `Explicit path(s) mentioned by the user but not found in inventory: ${tokenContext.explicitMissingPaths.join(", ")}.`
        : "No missing explicit user paths detected.",
    ],
  };
}

interface SelectorPromptPlan {
  files: ProjectInventoryFile[];
  totalInventoryFiles: number;
  shortlistApplied: boolean;
  omittedFiles: number;
  executionContract: TaskExecutionContract | null;
}

function addSelectorPromptCandidate(
  ordered: ProjectInventoryFile[],
  seen: Set<string>,
  file: ProjectInventoryFile | undefined,
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
  assetMode: AssetMode,
) {
  if (!file) return;
  const normalizedPath = normalizeForCompare(file.path);
  if (!normalizedPath || seen.has(normalizedPath)) return;
  if (!canUseSelectedFile(input, file, area, assetMode)) return;
  if (isSecretLikePath(file.path) || file.isLikelyGenerated) return;

  seen.add(normalizedPath);
  ordered.push(file);
}

function getSelectorPromptCoverageScore(
  file: ProjectInventoryFile,
  area: EffectiveTaskArea,
) {
  const pathText = normalizeForCompare(file.path);
  const roleText = normalizeForCompare(file.role);
  let score = 0;

  if (file.canReadText) score += 4;
  if (file.kind === "source") score += 8;
  if (file.kind === "config") score += 5;
  if (file.kind === "docs") score += 4;
  if (file.kind === "style") score += 4;

  if (area === "ui") {
    if (isClientUiPath(file.path)) score += 34;
    if (file.kind === "style") score += 22;
    if (["page", "component", "layout", "ui-component"].includes(roleText))
      score += 20;
    if (isBackendLeaningPath(file.path) && !isClientApiBridgePath(file.path))
      score -= 45;
  } else if (area === "backend") {
    if (isBackendLeaningPath(file.path)) score += 38;
    if (isClientApiBridgePath(file.path)) score += 10;
    if (isClientUiPath(file.path) && !isClientApiBridgePath(file.path))
      score -= 35;
  } else if (area === "fullstack") {
    if (isBackendLeaningPath(file.path)) score += 24;
    if (isClientApiBridgePath(file.path)) score += 28;
    if (isClientUiPath(file.path)) score += 24;
  } else if (area === "build") {
    if (isPackageOrConfigPath(file.path)) score += 36;
    if (includesAny(pathText, ["entry", "main", "vite", "webpack", "tsconfig"]))
      score += 18;
  } else if (area === "docs") {
    if (file.kind === "docs") score += 40;
    if (isPackageOrConfigPath(file.path)) score += 16;
  } else if (area === "tests") {
    if (includesAny(pathText, ["test", "spec", "smoke", "replay", "fixture"]))
      score += 38;
    if (isPackageOrConfigPath(file.path)) score += 12;
  }

  if (includesAny(pathText, ["package-lock", "pnpm-lock", "yarn.lock"]))
    score -= 80;

  return score;
}

function fileMatchesExecutionLayer(
  file: ProjectInventoryFile,
  layer: TaskExecutionLayer,
) {
  const pathText = normalizeForCompare(file.path);
  const roleText = normalizeForCompare(file.role);

  if (layer === "ui") {
    return isClientUiPath(file.path) && !isClientApiBridgePath(file.path);
  }
  if (layer === "client-api") return isClientApiBridgePath(file.path);
  if (layer === "backend") {
    return isBackendLeaningPath(file.path) && !isClientApiBridgePath(file.path);
  }
  if (layer === "state") {
    if (file.kind !== "source") return false;
    return (
      /(?:^|\/)\b(?:hooks?|stores?|state|context)\b(?:\/|$)/iu.test(pathText) ||
      /(?:controller|reducer|store|cache|session)\.(?:ts|tsx|js|jsx)$/iu.test(
        pathText,
      ) ||
      includesAny(roleText, ["state", "controller", "hook", "store"])
    );
  }
  if (layer === "storage") {
    return includesAny(pathText, [
      "/db/",
      "/database/",
      "/storage/",
      "/repositories/",
      "/repository/",
      "schema",
      "migration",
    ]);
  }
  if (layer === "tests") {
    return (
      file.kind === "test" ||
      includesAny(pathText, ["test", "spec", "smoke", "replay", "fixture"])
    );
  }
  if (layer === "config") return isPackageOrConfigPath(file.path);
  if (layer === "docs") return file.kind === "docs";
  return false;
}

function effectiveTaskAreaForRequiredLayers(
  layers: TaskExecutionLayer[],
): EffectiveTaskArea | null {
  const layerSet = new Set(layers);
  const hasUi = ["ui", "client-api", "state"].some((layer) =>
    layerSet.has(layer as TaskExecutionLayer),
  );
  const hasBackend = ["backend", "storage"].some((layer) =>
    layerSet.has(layer as TaskExecutionLayer),
  );
  if (hasUi && hasBackend) return "fullstack";
  if (hasUi) return "ui";
  if (hasBackend) return "backend";
  if (layerSet.has("config")) return "build";
  if (layerSet.has("tests")) return "tests";
  if (layerSet.has("docs")) return "docs";
  return null;
}

function inferDeterministicEffectiveTaskArea(
  selectedFiles: SelectedTaskFile[],
  inventoryByPath: Map<string, ProjectInventoryFile>,
): EffectiveTaskArea | null {
  const files = selectedFiles
    .map((selected) => inventoryByPath.get(normalizeForCompare(selected.path)))
    .filter((file): file is ProjectInventoryFile => Boolean(file));
  const selectedPaths = selectedFiles.map((file) =>
    normalizeForCompare(file.path),
  );
  if (files.length === 0 && selectedPaths.length === 0) return null;

  const hasUi =
    files.some((file) => fileMatchesExecutionLayer(file, "ui")) ||
    selectedPaths.some((pathValue) =>
      /(?:^|\/)(?:renderer|frontend|pages?|components?)(?:\/|$)/u.test(
        pathValue,
      ),
    );
  const hasClientApi = files.some((file) =>
    fileMatchesExecutionLayer(file, "client-api"),
  );
  const hasBackend =
    files.some(
      (file) =>
        fileMatchesExecutionLayer(file, "backend") &&
        !isClearlyClientSidePath(file.path),
    ) ||
    selectedPaths.some((pathValue) =>
      /(?:^|\/)(?:server|backend)(?:\/|$)/u.test(pathValue),
    );
  if ((hasUi || hasClientApi) && hasBackend) return "fullstack";
  if (hasUi || hasClientApi) return "ui";
  if (hasBackend) return "backend";
  if (
    files.length > 0 &&
    files.every((file) => fileMatchesExecutionLayer(file, "docs"))
  ) {
    return "docs";
  }
  if (
    files.length > 0 &&
    files.every((file) => fileMatchesExecutionLayer(file, "tests"))
  ) {
    return "tests";
  }
  if (
    files.length > 0 &&
    files.every((file) => fileMatchesExecutionLayer(file, "config"))
  ) {
    return "build";
  }
  return null;
}

function selectionEvidenceMatchesLayer(
  evidence: FileSelectionEvidence | undefined,
  layer: TaskExecutionLayer,
) {
  if (!evidence) return false;
  const roles = new Set(evidence.semanticRoles);
  if (layer === "state") return roles.has("state-owner");
  if (layer === "storage") return roles.has("storage");
  if (layer === "ui") return roles.has("display");
  if (layer === "client-api") return roles.has("contract");
  if (layer === "backend") return roles.has("route") || roles.has("producer");
  return false;
}

function getExecutionLayerCandidateScore(
  file: ProjectInventoryFile,
  layer: TaskExecutionLayer,
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
  assetMode: AssetMode,
  tokenContext: TokenContext,
) {
  let score =
    scoreFileFallback(file, tokenContext, input, area, assetMode) +
    getSelectorPromptCoverageScore(file, area);
  const pathText = normalizeForCompare(file.path);

  if (fileMatchesExecutionLayer(file, layer)) score += 90;
  if (file.kind === "source" || file.kind === "test") score += 18;
  if (file.exports.length > 0 || file.symbols.length > 0) score += 10;
  if (
    layer !== "config" &&
    (file.kind === "config" || pathText.endsWith("package.json"))
  ) {
    score -= 100;
  }
  if (
    layer !== "ui" &&
    includesAny(pathText, ["index.css", "globals.css", "app.css"])
  ) {
    score -= 90;
  }

  return score;
}

function isExactLocalizedTextTask(input: SelectTaskFilesInput) {
  const understanding = input.taskIntent?.taskUnderstanding;
  if (!understanding || understanding.changeDefinition !== "exact")
    return false;
  if (
    !includesAny(normalizeForCompare(input.rawTask), [
      "text",
      "label",
      "title",
      "heading",
      "copy",
      "translation",
      "translate",
      "текст",
      "подпись",
      "надпись",
      "заголов",
      "перевод",
    ])
  ) {
    return false;
  }

  return understanding.explicitValues.some(
    (value) => value.kind === "text" || value.kind === "literal",
  );
}

function fileUsesLocalizationIndirection(file: ProjectInventoryFile) {
  const searchText = normalizeForCompare(
    [
      file.path,
      file.role,
      ...file.imports,
      ...file.exports,
      ...file.symbols,
      ...file.textHints,
      file.contentPreview ?? "",
    ].join(" "),
  );

  return includesAny(
    searchText,
    [
      "react-i18next",
      "useTranslation",
      "i18next",
      "intl",
      "localization",
      "localisation",
      "labelKey",
      "descriptionKey",
      "titleKey",
      "messageKey",
      " t(",
    ].map(normalizeForCompare),
  );
}

function isLocalizationResourceFile(file: ProjectInventoryFile) {
  const pathText = normalizeForCompare(file.path);
  const roleText = normalizeForCompare(file.role);
  return (
    includesAny(pathText, [
      "/i18n/",
      "/locale/",
      "/locales/",
      "/translation/",
      "/translations/",
      "/messages/",
      "i18n.",
      "locale.",
      "locales.",
      "translation.",
      "translations.",
      "messages.",
    ]) || includesAny(roleText, ["i18n", "locale", "translation", "messages"])
  );
}

function getLocalizationSupportCandidates(
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
  assetMode: AssetMode,
  tokenContext: TokenContext,
  excludedPaths: Set<string>,
) {
  return input.inventory.files
    .filter((file) => !excludedPaths.has(normalizeForCompare(file.path)))
    .filter((file) => isLocalizationResourceFile(file))
    .filter((file) => canUseSelectedFile(input, file, area, assetMode))
    .filter((file) => !isSecretLikePath(file.path) && !file.isLikelyGenerated)
    .map((file) => {
      const strongMatches = getStrongTokenMatchCountForFile(
        file,
        tokenContext.strongTokens,
      );
      const score =
        scoreFileFallback(file, tokenContext, input, area, assetMode) +
        120 +
        Math.min(80, strongMatches * 35) +
        (file.canReadText ? 10 : 0);
      return { file, score, strongMatches };
    })
    .sort((left, right) => right.score - left.score);
}

function addLocalizationSupportPromptCandidates(
  ordered: ProjectInventoryFile[],
  seen: Set<string>,
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
  assetMode: AssetMode,
  tokenContext: TokenContext,
) {
  if (!isExactLocalizedTextTask(input)) return;
  if (!ordered.some((file) => fileUsesLocalizationIndirection(file))) return;

  for (const { file } of getLocalizationSupportCandidates(
    input,
    area,
    assetMode,
    tokenContext,
    seen,
  ).slice(0, 2)) {
    addSelectorPromptCandidate(ordered, seen, file, input, area, assetMode);
  }
}

function augmentLocalizationSupportSelection(
  selectedFiles: SelectedTaskFile[],
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
  assetMode: AssetMode,
) {
  if (!isExactLocalizedTextTask(input)) {
    return { selectedFiles, notes: [] as string[] };
  }

  const inventoryByPath = new Map(
    input.inventory.files.map((file) => [normalizeForCompare(file.path), file]),
  );
  const localizedTargetSelected = selectedFiles.some((selected) => {
    const inventoryFile = inventoryByPath.get(
      normalizeForCompare(selected.path),
    );
    return inventoryFile
      ? fileUsesLocalizationIndirection(inventoryFile)
      : false;
  });
  if (!localizedTargetSelected) {
    return { selectedFiles, notes: [] as string[] };
  }

  const alreadyHasResource = selectedFiles.some((selected) => {
    const inventoryFile = inventoryByPath.get(
      normalizeForCompare(selected.path),
    );
    return inventoryFile ? isLocalizationResourceFile(inventoryFile) : false;
  });
  if (alreadyHasResource) {
    return { selectedFiles, notes: [] as string[] };
  }

  const seen = new Set(
    selectedFiles.map((file) => normalizeForCompare(file.path)),
  );
  const tokenContext = buildTokenContext(input);
  const candidate = getLocalizationSupportCandidates(
    input,
    area,
    assetMode,
    tokenContext,
    seen,
  )[0];
  if (!candidate) {
    return {
      selectedFiles,
      notes: [
        "The selected UI target appears localization-driven, but no real localization resource was grounded from inventory.",
      ],
    };
  }

  const usage: SelectedTaskFileUsage =
    candidate.strongMatches > 0 ? "inspect-and-edit" : "inspect-only";
  return {
    selectedFiles: [
      ...selectedFiles,
      {
        path: candidate.file.path,
        kind: candidate.file.kind,
        usage,
        confidence: candidate.strongMatches > 0 ? 0.72 : 0.64,
        reason:
          "Localization support candidate; exact visible text appears to be resolved indirectly and this real resource should be inspected before changing the UI target. Candidate rank only; needs confirmation.",
      },
    ].slice(0, MAX_SELECTED_FILES),
    notes: [
      "Exact text selection was augmented with a real localization resource because the chosen UI target uses localization indirection.",
    ],
  };
}

function addExecutionContractCandidates(
  ordered: ProjectInventoryFile[],
  seen: Set<string>,
  input: SelectTaskFilesInput,
  area: EffectiveTaskArea,
  assetMode: AssetMode,
  tokenContext: TokenContext,
  contract: TaskExecutionContract | null,
) {
  if (!contract) return;

  // Investigation does not mean "add every architectural layer". The shortlist
  // must follow the task contract; otherwise a simple text change expands into
  // controllers, routes, and API files before any code evidence exists. Missing
  // layers stay unresolved and are discovered by trace only when the task
  // actually requires them.
  const layers = [...contract.requiredLayers];

  for (const layer of layers) {
    const limit = contract.mode === "investigation" ? 2 : 3;
    const candidates = input.inventory.files
      .filter((file) => !seen.has(normalizeForCompare(file.path)))
      .filter((file) => canUseSelectedFile(input, file, area, assetMode))
      .filter((file) => !isSecretLikePath(file.path) && !file.isLikelyGenerated)
      .filter((file) => fileMatchesExecutionLayer(file, layer))
      .map((file) => ({
        file,
        score: getExecutionLayerCandidateScore(
          file,
          layer,
          input,
          area,
          assetMode,
          tokenContext,
        ),
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);

    for (const { file } of candidates) {
      addSelectorPromptCandidate(ordered, seen, file, input, area, assetMode);
    }
  }
}

function buildSelectorPromptPlan(
  input: SelectTaskFilesInput,
  fallback: TaskFileSelection,
): SelectorPromptPlan {
  const area = fallback.effectiveTaskArea;
  const assetMode = fallback.assetMode;
  const tokenContext = buildTokenContext(input);
  const ordered: ProjectInventoryFile[] = [];
  const seen = new Set<string>();
  const inventoryByPath = new Map(
    input.inventory.files.map((file) => [normalizeForCompare(file.path), file]),
  );
  const executionContract = getCachedExecutionContract(input);

  for (const explicitPath of tokenContext.explicitExistingPaths) {
    addSelectorPromptCandidate(
      ordered,
      seen,
      inventoryByPath.get(normalizeForCompare(explicitPath)),
      input,
      area,
      assetMode,
    );
  }

  for (const target of getStructuredIntentTargets(input).sort(
    (left, right) => right.confidence - left.confidence,
  )) {
    if (!structuredTargetHasTaskSupport(input, target)) continue;
    addSelectorPromptCandidate(
      ordered,
      seen,
      findStructuredTargetFile(input, target),
      input,
      area,
      assetMode,
    );
  }

  addLocalizationSupportPromptCandidates(
    ordered,
    seen,
    input,
    area,
    assetMode,
    tokenContext,
  );

  addExecutionContractCandidates(
    ordered,
    seen,
    input,
    area,
    assetMode,
    tokenContext,
    executionContract,
  );

  if (executionContract) {
    for (const pathValue of getExistingImplementationCandidates(
      input,
      executionContract,
    )) {
      addSelectorPromptCandidate(
        ordered,
        seen,
        inventoryByPath.get(normalizeForCompare(pathValue)),
        input,
        area,
        assetMode,
      );
    }
  }

  for (const selectedFile of fallback.selectedFiles) {
    addSelectorPromptCandidate(
      ordered,
      seen,
      inventoryByPath.get(normalizeForCompare(selectedFile.path)),
      input,
      area,
      assetMode,
    );
  }

  const seedPaths = ordered.slice(0, 12).map((file) => file.path);
  if (seedPaths.length > 0) {
    const semanticGraph = buildProjectSemanticGraph(input.inventory);
    const includeImportedBy =
      area === "tests" ||
      area === "fullstack" ||
      area === "bugfix" ||
      executionContract?.mode === "investigation";
    const firstHop = semanticGraph.getSupportFiles(seedPaths, {
      includeImportedBy,
      includeRouteLocal: true,
      maxPerTarget: 5,
    });
    for (const support of firstHop) {
      addSelectorPromptCandidate(
        ordered,
        seen,
        support.file,
        input,
        area,
        assetMode,
      );
    }

    if (
      executionContract?.mode === "investigation" ||
      area === "fullstack" ||
      area === "bugfix"
    ) {
      const secondHopSeeds = firstHop
        .slice(0, 10)
        .map((item) => item.file.path);
      for (const support of semanticGraph.getSupportFiles(secondHopSeeds, {
        includeImportedBy: true,
        includeRouteLocal: true,
        maxPerTarget: 2,
      })) {
        addSelectorPromptCandidate(
          ordered,
          seen,
          support.file,
          input,
          area,
          assetMode,
        );
      }
    }
  }

  const scoredCandidates = getScoredCandidates(
    input,
    area,
    assetMode,
    tokenContext,
    [],
  );
  for (const { file } of scoredCandidates) {
    if (ordered.length >= MAX_SELECTOR_PROMPT_CANDIDATES) break;
    addSelectorPromptCandidate(ordered, seen, file, input, area, assetMode);
  }

  if (ordered.length < MAX_SELECTOR_PROMPT_CANDIDATES) {
    const coverageCandidates = input.inventory.files
      .filter((file) => !seen.has(normalizeForCompare(file.path)))
      .filter((file) => canUseSelectedFile(input, file, area, assetMode))
      .filter((file) => !isSecretLikePath(file.path))
      .filter((file) => !file.isLikelyGenerated)
      .map((file) => ({
        file,
        score:
          getSelectorPromptCoverageScore(file, area) +
          Math.max(
            0,
            scoreFileFallback(file, tokenContext, input, area, assetMode),
          ),
      }))
      .sort((left, right) => right.score - left.score);

    for (const { file } of coverageCandidates) {
      if (ordered.length >= MAX_SELECTOR_PROMPT_CANDIDATES) break;
      addSelectorPromptCandidate(ordered, seen, file, input, area, assetMode);
    }
  }

  const files = ordered.slice(0, MAX_SELECTOR_PROMPT_CANDIDATES);
  return {
    files,
    totalInventoryFiles: input.inventory.files.length,
    shortlistApplied: files.length < input.inventory.files.length,
    omittedFiles: Math.max(0, input.inventory.files.length - files.length),
    executionContract,
  };
}

function truncatePromptText(value: string | undefined, maxLength: number) {
  const normalized = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function compactInventoryForPrompt(plan: SelectorPromptPlan) {
  const compact: Array<Record<string, unknown>> = [];
  let serializedChars = 2;

  for (let index = 0; index < plan.files.length; index += 1) {
    const file = plan.files[index]!;
    const item: Record<string, unknown> = {
      path: file.path,
      kind: file.kind,
    };
    if (file.role) item.role = file.role;
    if (file.routePath) item.route = file.routePath;

    const symbols = uniqueStrings([
      ...file.exports.slice(0, 4),
      ...file.symbols.slice(0, 5),
    ]).slice(0, 6);
    const imports = file.imports.slice(0, 3);
    const hints = file.textHints.slice(0, 5);
    if (symbols.length > 0) item.symbols = symbols;
    if (imports.length > 0) item.imports = imports;
    if (hints.length > 0) item.hints = hints;
    if (index < 10 && file.contentPreview) {
      item.preview = truncatePromptText(file.contentPreview, 180);
    }

    const serialized = JSON.stringify(item);
    if (
      compact.length >= 10 &&
      serializedChars + serialized.length + 1 >
        MAX_SELECTOR_PROMPT_INVENTORY_CHARS
    ) {
      break;
    }

    compact.push(item);
    serializedChars += serialized.length + 1;
  }

  return compact;
}

function compactTaskIntentForPrompt(
  taskIntent: TaskIntentAnalysis | undefined,
) {
  if (!taskIntent) return null;
  return {
    taskArea: taskIntent.taskArea,
    intentTags: taskIntent.intentTags.slice(0, 8),
    fileRoleHints: taskIntent.fileRoleHints.slice(0, 8),
    understanding: {
      action: taskIntent.taskUnderstanding.action,
      readiness: taskIntent.taskUnderstanding.readiness,
      interpretationRisk: taskIntent.taskUnderstanding.interpretationRisk,
      changeDefinition: taskIntent.taskUnderstanding.changeDefinition,
      ambiguities: taskIntent.taskUnderstanding.ambiguities?.slice(0, 6) ?? [],
      targetHints: taskIntent.taskUnderstanding.targetHints.slice(0, 8),
      constraints: taskIntent.taskUnderstanding.constraints.slice(0, 8),
    },
    structuredIntent: {
      primaryTargets: taskIntent.structuredIntent.primaryTargets.slice(0, 8),
      positiveActions: taskIntent.structuredIntent.positiveActions.slice(0, 8),
      protectedScopes: taskIntent.structuredIntent.protectedScopes.slice(0, 8),
      allowedEditScope: taskIntent.structuredIntent.allowedEditScope,
      needsStyles: taskIntent.structuredIntent.needsStyles,
      needsBackend: taskIntent.structuredIntent.needsBackend,
    },
  };
}

function buildSelectorPrompt(
  input: SelectTaskFilesInput,
  plan: SelectorPromptPlan,
) {
  const effectiveTaskArea = getEffectiveTaskArea(input);
  const assetMode = getAssetMode(input);
  const compactInventory = compactInventoryForPrompt(plan);

  return `
You select real project files for an external coding agent. Return one strict JSON object only.

Task: ${input.rawTask}
Requested task type: ${input.taskType}
Implementation area: ${effectiveTaskArea}
Asset mode: ${assetMode}
Target tool: ${input.targetTool}

Intent summary:
${JSON.stringify(compactTaskIntentForPrompt(input.taskIntent))}

Backend execution contract:
${JSON.stringify(plan.executionContract)}

Candidate inventory shortlist (${compactInventory.length} of ${plan.totalInventoryFiles} real files):
${JSON.stringify(compactInventory)}

Rules:
- Select only exact paths from the candidate shortlist. Never invent paths.
- Prefer validated structured targets and direct semantic support before broad candidates.
- UI: prefer page/component/layout/style; avoid server-only files.
- Backend: prefer server/api/routes/db/services; avoid unrelated UI.
- Fullstack: include the relevant UI, client API bridge, and server layer when present.
- Treat requiredLayers in the execution contract as mandatory coverage, not optional hints.
- In investigation mode, select a small traceable ownership/data-flow chain and use inspect-only unless an edit target is confirmed.
- In clarification_required mode, return an empty selection rather than guessing implementation files.
- Never turn candidate rank into certainty: lower confidence for fallback/support candidates and state that confirmation is needed.
- Respect protected scopes and explicit-target-only boundaries.
- Assets use asset-reference; config uses config-reference when it is reference-only.
- Keep the set focused, usually 1-8 files. If no candidate is safe, return an empty list.
- Every item requires path, usage, short grounded reason, and confidence from 0 to 1.

Allowed usage: inspect-and-edit, create-and-edit, inspect-only, asset-reference, config-reference
JSON shape: {"selectedFiles":[{"path":"real/path","usage":"inspect-and-edit","reason":"grounded reason","confidence":0.8}],"notes":[]}
`.trim();
}

function cleanupJsonCandidate(value: string) {
  return value
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1")
    .replace(/,\s*([}\]])/g, "$1")
    .trim();
}

function parseJsonCandidate(value: string) {
  const candidate = cleanupJsonCandidate(value);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function extractBalancedJsonFragments(value: string) {
  const fragments: string[] = [];
  const openers = new Set(["{", "["]);
  const closerFor: Record<string, string> = { "{": "}", "[": "]" };

  for (let start = 0; start < value.length; start += 1) {
    const opener = value[start];
    if (!openers.has(opener)) continue;

    const expectedClosers = [closerFor[opener]];
    let inString = false;
    let quote = "";
    let escaped = false;

    for (let index = start + 1; index < value.length; index += 1) {
      const char = value[index];

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }

        if (char === "\\") {
          escaped = true;
          continue;
        }

        if (char === quote) {
          inString = false;
          quote = "";
        }

        continue;
      }

      if (char === '"') {
        inString = true;
        quote = char;
        continue;
      }

      if (openers.has(char)) {
        expectedClosers.push(closerFor[char]);
        continue;
      }

      const expected = expectedClosers[expectedClosers.length - 1];
      if (char === expected) {
        expectedClosers.pop();
        if (expectedClosers.length === 0) {
          fragments.push(value.slice(start, index + 1));
          break;
        }
      }
    }
  }

  return fragments;
}

function extractJsonObjectWithStage(value: string): {
  json: unknown | null;
  stage: SelectorParseStage;
} {
  const trimmed = value.trim();
  const direct = parseJsonCandidate(trimmed);
  if (direct) return { json: direct, stage: "direct-json" };

  const fenced = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)]
    .map((match) => match[1])
    .map(parseJsonCandidate)
    .find(Boolean);
  if (fenced) return { json: fenced, stage: "fenced-json" };

  for (const fragment of extractBalancedJsonFragments(trimmed)) {
    const parsed = parseJsonCandidate(fragment);
    if (parsed) return { json: parsed, stage: "balanced-json" };
  }

  return { json: null, stage: "failed" };
}

function extractJsonObject(value: string) {
  return extractJsonObjectWithStage(value).json;
}

function redactSelectorResponse(value: string) {
  return value
    .replace(
      /([A-Z0-9_]*(?:SECRET|TOKEN|API[_-]?KEY|PASSWORD|PRIVATE[_-]?KEY)[A-Z0-9_]*\s*[:=]\s*)["']?[^"'\s,}]+["']?/gi,
      "$1[REDACTED]",
    )
    .replace(
      /(sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,})/g,
      "[REDACTED_TOKEN]",
    )
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
      "[REDACTED_PRIVATE_KEY]",
    );
}

function validateSelectorJsonContract(value: unknown): {
  ok: boolean;
  reason?: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "Selector response must be a JSON object." };
  }

  const data = value as Record<string, unknown>;
  if (!Array.isArray(data.selectedFiles)) {
    return {
      ok: false,
      reason: "Selector response must contain selectedFiles array.",
    };
  }

  if (data.selectedFiles.length === 0) {
    const notes = getModelNotes(value);
    if (notes.length === 0) {
      return {
        ok: false,
        reason:
          "Selector returned an empty selectedFiles array without an explanatory notes entry.",
      };
    }
    return { ok: true };
  }

  for (const [index, item] of data.selectedFiles.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return {
        ok: false,
        reason: `selectedFiles[${index}] must be an object.`,
      };
    }
    const row = item as Record<string, unknown>;
    const filePath = normalizeString(row.path);
    if (!filePath) {
      return {
        ok: false,
        reason: `selectedFiles[${index}] is missing a non-empty path.`,
      };
    }
    if (!isValidUsage(row.usage)) {
      return {
        ok: false,
        reason: `selectedFiles[${index}] has missing or invalid usage.`,
      };
    }
    if (!normalizeString(row.reason)) {
      return {
        ok: false,
        reason: `selectedFiles[${index}] is missing a grounded reason.`,
      };
    }
    if (
      typeof row.confidence !== "number" ||
      !Number.isFinite(row.confidence)
    ) {
      return {
        ok: false,
        reason: `selectedFiles[${index}] is missing numeric confidence.`,
      };
    }
    if (row.confidence < 0 || row.confidence > 1) {
      return {
        ok: false,
        reason: `selectedFiles[${index}] confidence must be between 0 and 1.`,
      };
    }
  }

  return { ok: true };
}

function getModelFileItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  const data = value as Record<string, unknown>;
  if (Array.isArray(data.selectedFiles)) return data.selectedFiles;
  if (Array.isArray(data.files)) return data.files;
  if (Array.isArray(data.relevantFiles)) return data.relevantFiles;
  if (Array.isArray(data.paths)) return data.paths;
  return [];
}

function getModelNotes(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return normalizeStringArray((value as Record<string, unknown>).notes);
}

function getPathFromModelItem(item: unknown) {
  if (typeof item === "string") return item;
  if (!item || typeof item !== "object") return "";
  const row = item as Record<string, unknown>;
  return normalizeString(
    row.path ?? row.file ?? row.filePath ?? row.relativePath ?? row.name,
  );
}

function getRequestedUsageFromModelItem(
  item: unknown,
  inventoryFile: ProjectInventoryFile,
): SelectedTaskFileUsage {
  if (!item || typeof item !== "object")
    return defaultUsageForFile(inventoryFile);
  const row = item as Record<string, unknown>;
  return isValidUsage(row.usage)
    ? row.usage
    : defaultUsageForFile(inventoryFile);
}

function getReasonFromModelItem(item: unknown) {
  if (!item || typeof item !== "object")
    return "Selected by Ollama file selector from real project inventory.";
  return normalizeString(
    (item as Record<string, unknown>).reason,
    "Selected by Ollama file selector from real project inventory.",
  ).slice(0, 260);
}

function getConfidenceFromModelItem(item: unknown) {
  if (!item || typeof item !== "object") return 0.65;
  return normalizeConfidence((item as Record<string, unknown>).confidence);
}

function appendFallbackFilesIfNeeded(
  selectedFiles: SelectedTaskFile[],
  input: SelectTaskFilesInput,
  fallback: TaskFileSelection,
) {
  if (selectedFiles.length >= MIN_MODEL_SELECTED_FILES) return selectedFiles;

  const seen = new Set(
    selectedFiles.map((file) => normalizeForCompare(file.path)),
  );
  const next = [...selectedFiles];

  for (const fallbackFile of fallback.selectedFiles) {
    if (next.length >= MIN_MODEL_SELECTED_FILES) break;
    if (seen.has(normalizeForCompare(fallbackFile.path))) continue;
    next.push({
      ...fallbackFile,
      reason: `${fallbackFile.reason} Added because Ollama selected too few valid files after semantic validation.`,
    });
    seen.add(normalizeForCompare(fallbackFile.path));
  }

  return next;
}

function isFallbackRankedReason(reason: string) {
  const text = normalizeForCompare(reason);
  return includesAny(text, [
    "fallback",
    "added because ollama selected too few",
    "added to cover",
    "optional styling context",
    "universal fallback ranking",
    "candidate rank",
  ]);
}

function getCachedExecutionContract(input: SelectTaskFilesInput) {
  if (!input.taskIntent) return null;
  const cached = executionContractCache.get(input);
  if (cached !== undefined) return cached;
  const resolvedArea = getEffectiveTaskArea(input);
  const contractArea = ["ui", "backend", "fullstack"].includes(resolvedArea)
    ? resolvedArea
    : input.taskIntent.taskArea;
  const value = buildTaskExecutionContractFromIntent({
    rawTask: input.rawTask,
    projectTree: input.inventory.files.map((file) => file.path),
    taskIntent: input.taskIntent,
    effectiveTaskArea: contractArea,
  });
  executionContractCache.set(input, value);
  return value;
}

function userTaskLiterallyNamesSelectedFile(
  input: SelectTaskFilesInput,
  selected: SelectedTaskFile,
) {
  const selectedPath = normalizeForCompare(selected.path);
  const resolution = resolveExplicitFileMentions(
    input.rawTask,
    input.inventory,
  );
  return resolution.mentions.some((mention) => {
    if (!mention.matchedPath) return false;
    const classified = extractClassifiedFileMentions(input.rawTask).find(
      (candidate) =>
        normalizeForCompare(candidate.path) ===
        normalizeForCompare(mention.raw),
    );
    return (
      classified?.role !== "artifact-reference" &&
      normalizeForCompare(mention.matchedPath) === selectedPath
    );
  });
}

function userTaskExplicitlyNamesSelectedFile(
  input: SelectTaskFilesInput,
  selected: SelectedTaskFile,
) {
  const inventoryFile = findInventoryFile(input.inventory, selected.path);
  if (!inventoryFile) return false;
  const taskText = normalizeForCompare(input.rawTask);
  const normalizedPath = normalizeForCompare(selected.path);
  const basename = normalizedPath.split("/").pop() ?? normalizedPath;
  if (taskText.includes(normalizedPath) || taskText.includes(basename))
    return true;

  const identityTokens = uniqueStrings([
    ...tokenizeIdentifierLike(inventoryFile.name),
    ...tokenizeIdentifierLike(inventoryFile.path.split("/").pop() ?? ""),
  ]).filter(
    (token) =>
      token.length >= 3 &&
      !BROAD_PATH_TOKENS.has(token) &&
      !["tsx", "jsx", "typescript", "javascript"].includes(token),
  );
  const identityMatch = identityTokens.some((token) =>
    taskText.includes(token),
  );
  const role = normalizeForCompare(inventoryFile.role);
  const roleMatch =
    ((role === "page" || normalizedPath.includes("/pages/")) &&
      includesAny(taskText, ["page", "screen", "страниц", "экран"])) ||
    ((role === "component" ||
      role === "ui-component" ||
      normalizedPath.includes("/components/")) &&
      includesAny(taskText, ["component", "компонент"])) ||
    ((role === "service" || normalizedPath.includes("/services/")) &&
      includesAny(taskText, ["service", "сервис"])) ||
    ((role === "hook" || normalizedPath.includes("/hooks/")) &&
      includesAny(taskText, ["hook", "хук"]));
  const docsRoleMatch =
    (role === "docs" || inventoryFile.kind === "docs") &&
    /\b(?:readme|documentation|docs)\b|(?:\u0440\u0438\u0434\u043c\u0438|\u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442\u0430\u0446)/iu.test(
      taskText,
    );
  return identityMatch && (roleMatch || docsRoleMatch);
}

function inferSelectedFileEvidenceLevel(
  file: SelectedTaskFile,
  contract: TaskExecutionContract,
  input: SelectTaskFilesInput,
): TaskEvidenceLevel {
  const normalizedPath = normalizeForCompare(file.path);
  if (
    contract.confirmedTargets.some(
      (target) => normalizeForCompare(target) === normalizedPath,
    ) &&
    userTaskLiterallyNamesSelectedFile(input, file)
  ) {
    return "user_confirmed";
  }

  const reason = normalizeForCompare(file.reason);
  if (userTaskLiterallyNamesSelectedFile(input, file)) return "user_confirmed";
  if (
    file.selectionEvidence?.actionConfidence === "confirmed_edit" &&
    (file.selectionEvidence.targetSource === "user_text" ||
      file.selectionEvidence.targetSource === "clarification")
  ) {
    return "user_confirmed";
  }
  if (
    file.selectionEvidence?.actionConfidence === "inspect_then_edit" &&
    ["symbol_exact", "route_graph", "state_graph"].includes(
      file.selectionEvidence.ownershipEvidence,
    )
  ) {
    return "graph_supported";
  }
  if (file.usage === "create-and-edit") {
    const taskText = normalizeForCompare(input.rawTask);
    const createTokens = tokenizeIdentifierLike(
      file.path.split("/").pop() ?? "",
    ).filter((token) => token.length >= 4 && !BROAD_PATH_TOKENS.has(token));
    const explicitCreateTarget =
      createTokens.some((token) => taskText.includes(token)) &&
      includesAny(taskText, [
        "page",
        "route",
        "screen",
        "страниц",
        "маршрут",
        "экран",
        "create",
        "add",
        "добав",
        "созд",
      ]);
    if (explicitCreateTarget) return "user_confirmed";
  }
  if (
    includesAny(reason, [
      "explicit target guard",
      "user explicitly",
      "user-named",
    ])
  ) {
    return "user_confirmed";
  }
  if (isFallbackRankedReason(file.reason)) return "ranked_candidate";
  if (file.selectionEvidence?.ownershipEvidence === "rank_only")
    return "ranked_candidate";
  if (
    file.selectionEvidence?.targetSource === "model_inference" &&
    file.selectionEvidence.ownershipEvidence === "model_only"
  ) {
    return "model_proposed";
  }
  if (file.usage === "create-and-edit" && reason.includes("explicit")) {
    return "user_confirmed";
  }
  return input.inventory.files.some(
    (candidate) => normalizeForCompare(candidate.path) === normalizedPath,
  )
    ? "inventory_exact"
    : "model_proposed";
}

function getExistingImplementationCandidates(
  input: SelectTaskFilesInput,
  _contract: TaskExecutionContract,
) {
  return resolveRepositorySemanticEvidence({
    rawTask: input.rawTask,
    inventory: input.inventory,
    taskIntent: input.taskIntent,
  }).existingImplementationPaths;
}

function evidenceStrengthRank(evidence?: FileSelectionEvidence) {
  if (!evidence) return 0;
  const ownershipRank: Record<string, number> = {
    rank_only: 1,
    model_only: 1,
    content_supported: 2,
    reference_graph: 3,
    route_graph: 4,
    state_graph: 4,
    symbol_exact: 5,
  };
  const actionRank: Record<string, number> = {
    inspect_only: 0,
    inspect_then_edit: 2,
    confirmed_edit: 3,
  };
  return (
    (ownershipRank[evidence.ownershipEvidence] ?? 0) * 10 +
    (actionRank[evidence.actionConfidence] ?? 0)
  );
}

function traceEvidenceLevel(
  evidence: FileSelectionEvidence,
): TaskEvidenceLevel {
  if (
    evidence.targetSource === "user_text" ||
    evidence.targetSource === "clarification"
  ) {
    return "user_confirmed";
  }
  if (
    evidence.actionConfidence === "inspect_then_edit" &&
    ["symbol_exact", "route_graph", "state_graph"].includes(
      evidence.ownershipEvidence,
    )
  ) {
    return "graph_supported";
  }
  return evidence.targetSource === "model_inference"
    ? "model_proposed"
    : "ranked_candidate";
}

function filePathMatchesExecutionLayer(
  pathValue: string,
  layer: TaskExecutionLayer,
) {
  const path = normalizeForCompare(pathValue);
  if (layer === "client-api")
    return (
      /(?:^|\/)(?:api|client)\//i.test(path) ||
      /client\.(?:ts|tsx|js|jsx)$/i.test(path)
    );
  if (layer === "backend")
    return /(?:^|\/)(?:server|routes?|services?|controllers?|handlers?)\//i.test(
      path,
    );
  if (layer === "storage")
    return /(?:storage|repository|repositories|db|database|schema|migration)/i.test(
      path,
    );
  if (layer === "state")
    return /(?:hooks?|controllers?|stores?|state|context)/i.test(path);
  if (layer === "config")
    return /(?:package\.json$|config|tsconfig|vite|webpack|jest|vitest)/i.test(
      path,
    );
  if (layer === "tests")
    return /(?:test|spec|smoke|replay|package\.json$|jest|vitest)/i.test(path);
  return false;
}

function addInvestigationTraceFiles(input: {
  files: SelectedTaskFile[];
  trace: InvestigationTrace;
  inventory: ProjectInventory;
  request: SelectTaskFilesInput;
  requiredLayers: TaskExecutionLayer[];
}) {
  if (input.files.length === 0) return [];
  const constraints = getTaskConstraints(input.request);
  const traceTokenContext = buildTokenContext(input.request);
  const inventoryByPath = new Map(
    input.inventory.files.map((file) => [normalizeForCompare(file.path), file]),
  );
  const originalByPath = new Map(
    input.files.map((file) => [normalizeForCompare(file.path), file]),
  );
  const selectedByPath = new Map(
    input.files
      .filter((file) => file.evidenceLevel === "user_confirmed")
      .map((file) => [normalizeForCompare(file.path), file]),
  );
  for (const file of input.files) {
    const key = normalizeForCompare(file.path);
    const inventoryFile = inventoryByPath.get(key);
    if (!inventoryFile || selectedByPath.has(key)) continue;
    if (isUnsupportedStructuredTargetPath(input.request, inventoryFile))
      continue;
    const isDocsLayer = input.requiredLayers.includes("docs");
    const isTestsLayer = input.requiredLayers.includes("tests");
    const isDocsPath = /(?:\.md$|\/docs?\/)/i.test(key);
    const isTestsSupportPath =
      /(?:package\.json$|\.test\.|\.spec\.|\.smoke\.ts$|\.replay\.ts$|vitest|jest)/i.test(
        key,
      );
    const isVerificationSupportPath =
      /(?:package\.json$|vitest|jest|\.test\.|\.spec\.)/i.test(key) &&
      /\b(?:verify|verification|test|tests|coverage|assertion|smoke|regression)\b/i.test(
        input.request.rawTask,
      );
    const isCoreSelectorTestSupport =
      /(?:taskfileselector\.(?:smoke|replay)\.ts$|\.smoke\.ts$|\.replay\.ts$)/i.test(
        key,
      ) &&
      /\b(?:selector|fallback|scoring|manual\s+review|safety\s+policy|replay|smoke)\b/i.test(
        input.request.rawTask,
      );
    const isRequiredLayerSupport = input.requiredLayers.some((layer) =>
      filePathMatchesExecutionLayer(inventoryFile.path, layer),
    );
    const isRequiredTestSubject =
      input.requiredLayers.includes("tests") &&
      inventoryFile.kind !== "test" &&
      inventoryFile.kind !== "config" &&
      inventoryFile.kind !== "docs" &&
      getStrongTokenMatchCountForFile(
        inventoryFile,
        traceTokenContext.strongTokens,
      ) > 0;
    if (
      /(?:\.md$|\.css$|\.scss$|\.sass$|package\.json$|taskfileselector\.(?:smoke|replay)\.ts$|\.smoke\.ts$|\.replay\.ts$|\/reports?\/|\/docs?\/|\/__tests__\/|\.test\.|\.spec\.)/i.test(
        key,
      ) &&
      !(isDocsLayer && isDocsPath) &&
      !(isTestsLayer && isTestsSupportPath) &&
      !isVerificationSupportPath &&
      !isCoreSelectorTestSupport &&
      !isRequiredLayerSupport
    )
      continue;
    if (
      file.selectionEvidence?.targetSource === "model_inference" &&
      file.selectionEvidence.ownershipEvidence === "model_only"
    ) {
      selectedByPath.set(key, file);
    } else if (
      file.usage === "inspect-and-edit" ||
      isRequiredLayerSupport ||
      isRequiredTestSubject
    ) {
      selectedByPath.set(key, file);
    }
  }
  const connectedTracePaths = new Set(
    input.trace.edges.flatMap((edge) => [
      normalizeForCompare(edge.from),
      normalizeForCompare(edge.to),
    ]),
  );
  const nodeByPath = new Map(
    input.trace.nodes.map((node) => [normalizeForCompare(node.path), node]),
  );
  const hasOwnerEvidence =
    input.trace.outcome.confirmedOwners.length > 0 ||
    input.trace.outcome.probableOwners.length > 0;
  const retainedReferences = hasOwnerEvidence
    ? input.trace.outcome.references.filter((pathValue) => {
        const key = normalizeForCompare(pathValue);
        const node = nodeByPath.get(key);
        const incomingEdgeType = node?.incomingEdgeType;
        const isStructuredReferenceEdge = incomingEdgeType
          ? [
              "imports",
              "imported_by",
              "renders_component",
              "passes_prop",
              "receives_prop",
              "state_setter",
              "route_registration",
              "router_mount",
              "api_request",
              "translation_entry",
            ].includes(incomingEdgeType)
          : false;
        return (
          node?.seedSource === "user-confirmed" ||
          node?.seedSource === "existing-implementation" ||
          (connectedTracePaths.has(key) && isStructuredReferenceEdge)
        );
      })
    : input.trace.outcome.references.slice(0, 4);
  const retainedOriginalSupport = Object.entries(
    input.trace.outcome.evidenceByPath,
  )
    .filter(([pathValue, evidence]) => {
      const key = normalizeForCompare(pathValue);
      const inventoryFile = inventoryByPath.get(key);
      if (!inventoryFile || !originalByPath.has(key)) return false;
      if (isUnsupportedStructuredTargetPath(input.request, inventoryFile))
        return false;
      const isDocsLayer = input.requiredLayers.includes("docs");
      const isTestsLayer = input.requiredLayers.includes("tests");
      const isDocsPath = /(?:\.md$|\/docs?\/)/i.test(key);
      const isTestsSupportPath =
        /(?:package\.json$|\.test\.|\.spec\.|\.smoke\.ts$|\.replay\.ts$|vitest|jest)/i.test(
          key,
        );
      const isVerificationSupportPath =
        /(?:package\.json$|vitest|jest|\.test\.|\.spec\.)/i.test(key) &&
        /\b(?:verify|verification|test|tests|coverage|assertion|smoke|regression)\b/i.test(
          input.request.rawTask,
        );
      const isCoreSelectorTestSupport =
        /(?:taskfileselector\.(?:smoke|replay)\.ts$|\.smoke\.ts$|\.replay\.ts$)/i.test(
          key,
        ) &&
        /\b(?:selector|fallback|scoring|manual\s+review|safety\s+policy|replay|smoke)\b/i.test(
          input.request.rawTask,
        );
      const isRequiredLayerSupport = input.requiredLayers.some((layer) =>
        filePathMatchesExecutionLayer(inventoryFile.path, layer),
      );
      if (
        /(?:\.md$|\.css$|\.scss$|\.sass$|package\.json$|taskfileselector\.(?:smoke|replay)\.ts$|\.smoke\.ts$|\.replay\.ts$|\/reports?\/|\/docs?\/|\/__tests__\/|\.test\.|\.spec\.)/i.test(
          normalizeForCompare(inventoryFile.path),
        ) &&
        !(isDocsLayer && isDocsPath) &&
        !(isTestsLayer && isTestsSupportPath) &&
        !isVerificationSupportPath &&
        !isCoreSelectorTestSupport &&
        !isRequiredLayerSupport
      )
        return false;
      return evidence.negativeConstraintConflicts.length === 0;
    })
    .sort(([leftPath, leftEvidence], [rightPath, rightEvidence]) => {
      const score = (pathValue: string, evidence: FileSelectionEvidence) => {
        const key = normalizeForCompare(pathValue);
        const inventoryFile = inventoryByPath.get(key);
        let value = connectedTracePaths.has(key) ? 20 : 0;
        if (inventoryFile) {
          for (const layer of input.requiredLayers) {
            if (
              selectionEvidenceMatchesLayer(evidence, layer) ||
              filePathMatchesExecutionLayer(inventoryFile.path, layer)
            ) {
              value += 30;
            }
          }
        }
        const original = originalByPath.get(key);
        if (original?.evidenceLevel === "graph_supported") value += 12;
        if (original?.evidenceLevel === "inventory_exact") value += 8;
        return value;
      };
      return score(rightPath, rightEvidence) - score(leftPath, leftEvidence);
    })
    .map(([pathValue]) => pathValue);
  const retainedLayerAnchors = input.requiredLayers.flatMap((layer) => {
    const match = retainedOriginalSupport.find((pathValue) => {
      const inventoryFile = inventoryByPath.get(normalizeForCompare(pathValue));
      const evidence = input.trace.outcome.evidenceByPath[pathValue];
      return Boolean(
        inventoryFile &&
        evidence &&
        (selectionEvidenceMatchesLayer(evidence, layer) ||
          filePathMatchesExecutionLayer(inventoryFile.path, layer)),
      );
    });
    return match ? [match] : [];
  });
  const orderedPaths = uniqueStrings([
    ...input.trace.outcome.confirmedOwners,
    ...retainedLayerAnchors,
    ...input.trace.outcome.probableOwners,
    ...retainedOriginalSupport.slice(0, 4),
    ...retainedReferences.slice(0, 4),
  ]).slice(0, 10);
  for (const pathValue of orderedPaths) {
    const key = normalizeForCompare(pathValue);
    const inventoryFile = inventoryByPath.get(key);
    const evidence = input.trace.outcome.evidenceByPath[pathValue];
    if (!inventoryFile || !evidence) continue;
    if (isUnsupportedStructuredTargetPath(input.request, inventoryFile))
      continue;
    const existing = selectedByPath.get(key) ?? originalByPath.get(key);
    if (existing) {
      const alreadySelected = selectedByPath.has(key);
      const traceWouldOnlyAddWeakContent =
        existing.selectionEvidence?.ownershipEvidence === "model_only" &&
        evidence.ownershipEvidence === "content_supported";
      const isRequiredLayerSupport = input.requiredLayers.some((layer) =>
        filePathMatchesExecutionLayer(inventoryFile.path, layer),
      );
      const hasOnlyGenericFillerConflict =
        evidence.negativeConstraintConflicts.length > 0 &&
        evidence.negativeConstraintConflicts.every(
          (conflict) =>
            conflict ===
            "Filler/test/docs/style/config context is reference-only for this task.",
        );
      const shouldReplaceWithTrace =
        !traceWouldOnlyAddWeakContent &&
        !(isRequiredLayerSupport && hasOnlyGenericFillerConflict) &&
        (evidence.negativeConstraintConflicts.length > 0 ||
          evidenceStrengthRank(evidence) >
            evidenceStrengthRank(existing.selectionEvidence));
      if (shouldReplaceWithTrace) {
        selectedByPath.set(key, {
          ...existing,
          selectionEvidence: evidence,
          evidenceLevel: traceEvidenceLevel(evidence),
          usage:
            evidence.actionConfidence === "inspect_then_edit" &&
            existing.usage !== "asset-reference" &&
            existing.usage !== "config-reference"
              ? "inspect-and-edit"
              : evidence.actionConfidence === "inspect_only" &&
                  existing.usage !== "asset-reference" &&
                  existing.usage !== "config-reference"
                ? "inspect-only"
                : existing.usage,
          confidence:
            evidence.actionConfidence === "inspect_then_edit"
              ? Math.max(existing.confidence, 0.78)
              : Math.min(existing.confidence, 0.66),
          reason: `${existing.reason} Investigation trace adjusted code evidence: ${evidence.reason}`,
        });
      } else if (!alreadySelected) {
        selectedByPath.set(key, {
          ...existing,
          usage:
            existing.usage === "asset-reference" ||
            existing.usage === "config-reference"
              ? existing.usage
              : "inspect-only",
          reason: `${existing.reason} Investigation trace retained this connected candidate without promoting ownership.`,
        });
      }
      continue;
    }
    if (selectedByPath.size >= MAX_SELECTED_FILES) continue;
    selectedByPath.set(key, {
      path: inventoryFile.path,
      kind: inventoryFile.kind,
      usage:
        inventoryFile.kind === "asset"
          ? "asset-reference"
          : inventoryFile.kind === "config"
            ? "config-reference"
            : evidence.actionConfidence === "inspect_then_edit"
              ? "inspect-and-edit"
              : "inspect-only",
      reason: `Investigation trace discovered this file through code relationships. ${evidence.reason}`,
      confidence:
        evidence.actionConfidence === "inspect_then_edit" ? 0.78 : 0.62,
      evidenceLevel: traceEvidenceLevel(evidence),
      selectionEvidence: evidence,
    });
  }

  if (hasOwnerEvidence) {
    const allowedTracePaths = new Set(orderedPaths.map(normalizeForCompare));
    for (const [key, file] of selectedByPath) {
      const original = originalByPath.get(key);
      const inventoryFile = inventoryByPath.get(key);
      const traceNode = nodeByPath.get(key);
      const isStrongOriginalEditCandidate = Boolean(
        original &&
        original.usage === "inspect-and-edit" &&
        inventoryFile &&
        !traceNode?.rejectionReason &&
        getStrongTokenMatchCountForFile(
          inventoryFile,
          traceTokenContext.strongTokens,
        ) > 0,
      );
      const isRequiredVerificationSupport = Boolean(
        original &&
        inventoryFile &&
        input.requiredLayers.includes("tests") &&
        /(?:package\.json$|(?:^|\/)(?:tests?|__tests__)(?:\/|$)|\.(?:test|spec)\.|\.(?:smoke|replay)\.ts$|vitest|jest)/i.test(
          normalizeForCompare(inventoryFile.path),
        ),
      );
      const isRequiredLayerSupport = Boolean(
        original &&
        inventoryFile &&
        input.requiredLayers.some((layer) =>
          filePathMatchesExecutionLayer(inventoryFile.path, layer),
        ),
      );
      const isRequiredTestSubject = Boolean(
        original &&
        inventoryFile &&
        input.requiredLayers.includes("tests") &&
        inventoryFile.kind !== "test" &&
        inventoryFile.kind !== "config" &&
        inventoryFile.kind !== "docs" &&
        getStrongTokenMatchCountForFile(
          inventoryFile,
          traceTokenContext.strongTokens,
        ) > 0,
      );
      const isProtectedRetainedFile =
        file.evidenceLevel === "user_confirmed" ||
        file.selectionEvidence?.targetSource === "clarification" ||
        traceNode?.seedSource === "user-confirmed" ||
        isStrongOriginalEditCandidate ||
        isRequiredVerificationSupport ||
        isRequiredLayerSupport ||
        isRequiredTestSubject ||
        (originalByPath.has(key) &&
          file.evidenceLevel === "graph_supported" &&
          !file.selectionEvidence?.negativeConstraintConflicts.length) ||
        (file.selectionEvidence?.targetSource === "model_inference" &&
          file.selectionEvidence.ownershipEvidence === "model_only");
      if (!allowedTracePaths.has(key) && !isProtectedRetainedFile) {
        selectedByPath.delete(key);
      }
    }
  }

  // Missing layers intentionally remain unresolved after investigation. Do not
  // fill them with path/role matches: a random file that merely looks like a
  // state/backend/storage file is less useful than an explicit missing-layer
  // diagnostic and can create false architectural confidence.

  return [...selectedByPath.values()];
}

function shouldRunImplementationTrace(
  contract: TaskExecutionContract,
  files: SelectedTaskFile[],
  input: SelectTaskFilesInput,
) {
  if (contract.mode !== "implementation") return false;
  const rawTask = input.rawTask;
  const hasLiteralChange =
    /["'`«„“”].{3,80}["'`»“”]/u.test(rawTask) ||
    /\b(?:replace|rename|label|text|copy|translation|locali[sz]e)\b|(?:замен|переимен|подпис|текст|перевод|локализац)/iu.test(
      rawTask,
    );
  const hasIndirectionCandidate = files.some((file) => {
    const inventoryFile = input.inventory.files.find(
      (candidate) =>
        normalizeForCompare(candidate.path) === normalizeForCompare(file.path),
    );
    const preview = inventoryFile?.contentPreview ?? "";
    return (
      (file.selectionEvidence?.semanticRoles.includes("display") ||
        inventoryFile?.role === "component" ||
        inventoryFile?.role === "page") &&
      /\bt\s*\(|labelKey|translation|i18n|props\.|useState|useReducer|fetch\(|api\./i.test(
        preview,
      )
    );
  });
  const rawCodeSymbols = Array.from(
    rawTask.matchAll(/\b[A-Za-z_$][A-Za-z0-9_$]*(?:[A-Z][A-Za-z0-9_$]*)+\b/g),
  ).map((match) => match[0]);
  const symbolSourceTexts = [
    ...rawCodeSymbols,
    ...(input.taskIntent?.domainTerms ?? []),
    ...(input.taskIntent?.taskUnderstanding?.targetHints ?? []),
    ...(input.taskIntent?.taskUnderstanding?.requestedChanges ?? []),
  ];
  const exactCodeSymbols = uniqueStrings([
    ...rawCodeSymbols.map(normalizeForCompare),
    ...symbolSourceTexts.flatMap(tokenizeIdentifierLike),
  ]).filter(
    (token) =>
      token.length >= 6 &&
      /[a-z]/.test(token) &&
      !BROAD_PATH_TOKENS.has(token) &&
      ![
        "status",
        "model",
        "task",
        "data",
        "value",
        "result",
        "settings",
        "diagnostics",
      ].includes(token),
  );
  const hasExistingSymbolReview =
    /\b(?:add|create|introduce|show|expose|display|verify|check)\b|(?:Ð´Ð¾Ð±Ð°Ð²|ÑÐ¾Ð·Ð´|Ð¿Ð¾ÐºÐ°Ð¶|Ð²Ñ‹Ð²ÐµÐ´|Ð¿Ñ€Ð¾Ð²ÐµÑ€)/iu.test(
      rawTask,
    ) &&
    /\b(?:field|property|flag|metric|status|boolean|bool|value|timing)\b|(?:Ð¿Ð¾Ð»[ÐµÑ]|ÑÐ²Ð¾Ð¹ÑÑ‚Ð²|Ñ„Ð»Ð°Ð³|Ð¼ÐµÑ‚Ñ€Ð¸Ðº|ÑÑ‚Ð°Ñ‚ÑƒÑ|Ð±ÑƒÐ»|Ð·Ð½Ð°Ñ‡ÐµÐ½|Ð²Ñ€ÐµÐ¼)/iu.test(
      rawTask,
    ) &&
    exactCodeSymbols.some((symbol) =>
      files.some((file) => {
        const inventoryFile = input.inventory.files.find(
          (candidate) =>
            normalizeForCompare(candidate.path) ===
            normalizeForCompare(file.path),
        );
        const facts = inventoryFile?.semanticFacts;
        return [
          ...(facts?.declarations ?? []),
          ...(facts?.assignments ?? []),
          ...(facts?.objectProperties ?? []),
          ...(facts?.references ?? []),
          ...(inventoryFile?.symbols ?? []),
          ...(inventoryFile?.exports ?? []),
        ].some((fact) => normalizeForCompare(fact) === symbol);
      }),
    );
  return (
    (hasLiteralChange && hasIndirectionCandidate) || hasExistingSymbolReview
  );
}

function taskRequestsConcreteMutationForTrace(input: SelectTaskFilesInput) {
  const action = input.taskIntent?.taskUnderstanding.action;
  if (
    action &&
    [
      "create",
      "update",
      "replace",
      "remove",
      "fix",
      "refactor",
      "document",
      "configure",
    ].includes(action)
  )
    return true;
  return /\b(?:add|create|change|replace|update|remove|delete|fix|refactor|rename|move|write|configure|enable|disable)\b|(?:добав|созд|измен|замен|обнов|удал|убер|исправ|почин|рефактор|переимен|перемест|напиш|настрой|включ|отключ)/iu.test(
    input.rawTask,
  );
}

function applyExecutionContractSelectionPolicy(
  selectedFiles: SelectedTaskFile[],
  input?: SelectTaskFilesInput,
  omittedSeeds: Array<{ path: string; reason: string }> = [],
) {
  if (!input?.taskIntent) {
    return {
      selectedFiles,
      contract: null as TaskExecutionContract | null,
      missingRequiredLayers: [] as TaskExecutionLayer[],
      existingImplementationCandidates: [] as string[],
      evidenceSummary: {
        user_confirmed: 0,
        inventory_exact: 0,
        graph_supported: 0,
        model_proposed: 0,
        ranked_candidate: 0,
      } as Record<TaskEvidenceLevel, number>,
      notes: [] as string[],
      repositoryEvidence: null,
      existingImplementationRequiresReview: false,
      taskProfile: null as string | null,
      finalDecisionApplied: false,
      effectiveTaskAreaOverride: null as EffectiveTaskArea | null,
    };
  }

  const baseContract = getCachedExecutionContract(input)!;
  const repositoryEvidence = resolveRepositorySemanticEvidence({
    rawTask: input.rawTask,
    inventory: input.inventory,
    taskIntent: input.taskIntent,
  });
  if (baseContract.mode === "clarification_required") {
    return {
      selectedFiles: [],
      contract: baseContract,
      missingRequiredLayers: baseContract.requiredLayers,
      existingImplementationCandidates: [] as string[],
      evidenceSummary: {
        user_confirmed: 0,
        inventory_exact: 0,
        graph_supported: 0,
        model_proposed: 0,
        ranked_candidate: 0,
      } as Record<TaskEvidenceLevel, number>,
      notes: [
        "Execution contract requires clarification; automatic implementation files were intentionally withheld.",
      ],
      repositoryEvidence,
      existingImplementationRequiresReview: false,
      taskProfile: "clarification",
      finalDecisionApplied: false,
      effectiveTaskAreaOverride: null as EffectiveTaskArea | null,
    };
  }

  const evidenceFiles = selectedFiles.map((file) => {
    const repositoryFileEvidence = repositoryEvidence.byPath.get(
      normalizeForCompare(file.path),
    );
    const selectionEvidence = getFallbackSelectionEvidence(
      file,
      repositoryFileEvidence,
    );
    const normalizedFile = { ...file, selectionEvidence };
    return {
      ...normalizedFile,
      evidenceLevel:
        file.evidenceLevel ??
        inferSelectedFileEvidenceLevel(normalizedFile, baseContract, input),
    };
  });
  const inventoryByPath = new Map(
    input.inventory.files.map((file) => [normalizeForCompare(file.path), file]),
  );
  const missingRequiredLayers = baseContract.requiredLayers.filter(
    (layer) =>
      !evidenceFiles.some((selected) => {
        const inventoryFile = inventoryByPath.get(
          normalizeForCompare(selected.path),
        );
        return (
          selectionEvidenceMatchesLayer(selected.selectionEvidence, layer) ||
          (inventoryFile
            ? fileMatchesExecutionLayer(inventoryFile, layer)
            : false)
        );
      }),
  );
  const existingImplementationCandidates = getExistingImplementationCandidates(
    input,
    baseContract,
  );
  const selectionProfile = classifyTaskSelectionProfile({
    rawTask: input.rawTask,
    taskType: input.taskType,
    taskIntent: input.taskIntent,
  });
  const existingImplementationRequiresReview =
    selectionProfile.kind !== "exact-text" &&
    existingImplementationCandidates.length > 0 &&
    /\b(?:add|create|introduce|expose)\b|(?:добав|созд|введ|вывед)/iu.test(
      input.rawTask,
    ) &&
    /\b(?:field|property|metric|status|flag|endpoint|handler|state|cache|timing|value)\b|(?:пол[ея]|свойств|метрик|статус|флаг|эндпоинт|обработчик|состояни|кеш|кэш|врем|значени)/iu.test(
      input.rawTask,
    );
  const initialContract = applySelectionEvidenceGate({
    contract: baseContract,
    rawTask: input.rawTask,
    selectedFiles: evidenceFiles,
    inventoryFiles: input.inventory.files,
    missingRequiredLayers,
    existingImplementationCandidates,
    existingImplementationRequiresReview,
  });
  const traceArea = getEffectiveTaskArea(input);
  const traceTokenContext = buildTokenContext(input);
  const manualTargetReviewBlocksTrace = shouldBlockUngroundedFormTarget(
    input,
    traceArea,
    traceTokenContext,
  );
  const conditionalTargetReviewBlocksTrace =
    getConditionalTargetReviewCandidates(
      input,
      traceArea,
      getAssetMode(input),
      traceTokenContext,
    ).length > 0;
  const docsOnlyTraceBypass =
    baseContract.requiredLayers.length > 0 &&
    baseContract.requiredLayers.every((layer) => layer === "docs");
  const reviewOnlyTraceBypass = isReviewProposeOnlyTask(input);
  const coreSelfTraceBypass =
    isCoreSelfTask(input) &&
    /\b(?:fallback|scoring|manual\s+review)\b/i.test(input.rawTask);
  const verificationPlanningTraceBypass =
    /\b(?:find\s+likely|likely\s+places|prepare\s+(?:a\s+)?task\s+pack\s+for\s+verification|verification|verify\s+where)\b/i.test(
      input.rawTask,
    );
  const callbackRepairTraceBypass = isExplicitOauthCallbackRepairTask(
    input,
    traceArea,
  );
  const exactTextTraceBypass = selectionProfile.kind === "exact-text";
  const literalFileMentions = extractClassifiedFileMentions(
    input.rawTask,
  ).filter((mention) => mention.role !== "artifact-reference");
  const literalFileTargetTraceBypass =
    taskRequestsConcreteMutationForTrace(input) &&
    literalFileMentions.length > 0 &&
    literalFileMentions.every((mention) =>
      input.inventory.files.some(
        (file) =>
          normalizeForCompare(file.path) ===
          normalizeForCompare(mention.path),
      ),
    );
  const shouldTrace =
    !exactTextTraceBypass &&
    !literalFileTargetTraceBypass &&
    (existingImplementationRequiresReview ||
      (!manualTargetReviewBlocksTrace &&
        !conditionalTargetReviewBlocksTrace &&
        !docsOnlyTraceBypass &&
        !reviewOnlyTraceBypass &&
        !coreSelfTraceBypass &&
        !verificationPlanningTraceBypass &&
        !callbackRepairTraceBypass &&
        (initialContract.mode === "investigation" ||
          shouldRunImplementationTrace(
            initialContract,
            evidenceFiles,
            input,
          ))));
  const investigationTrace = shouldTrace
    ? runInvestigationTrace({
        rawTask: input.rawTask,
        inventory: input.inventory,
        taskIntent: input.taskIntent,
        contract: initialContract,
        selectedFiles: evidenceFiles,
        existingImplementationCandidates,
        omittedSeeds,
      })
    : undefined;
  const tracedEvidenceFiles = investigationTrace?.triggered
    ? addInvestigationTraceFiles({
        files: evidenceFiles,
        trace: investigationTrace,
        inventory: input.inventory,
        request: input,
        requiredLayers: uniqueStrings([
          ...baseContract.requiredLayers,
          ...(selectionProfile.needsConfigContext ? ["config"] : []),
          ...(selectionProfile.needsTestContext ? ["tests"] : []),
        ]) as TaskExecutionLayer[],
      })
    : evidenceFiles;
  const finalDecision = reconcileFinalSelectionDecision({
    rawTask: input.rawTask,
    taskType: input.taskType,
    taskIntent: input.taskIntent,
    inventory: input.inventory,
    selectedFiles: tracedEvidenceFiles,
    investigationTrace,
    contract: initialContract,
    maxFiles: getSelectionLimitFromSettings(
      input,
      getEffectiveTaskArea(input),
      getAssetMode(input),
    ),
  });
  const decisionFiles = finalDecision.selectedFiles;
  const decisionRequiredLayers =
    finalDecision.requiredLayersOverride ?? baseContract.requiredLayers;
  const decisionBaseContract: TaskExecutionContract =
    finalDecision.requiredLayersOverride
      ? {
          ...baseContract,
          requiredLayers: decisionRequiredLayers,
          candidateLayerCoverage: [],
          confirmedLayerCoverage: [],
          missingConfirmedLayers: decisionRequiredLayers,
          requiresLayerCoverage: decisionRequiredLayers.length > 1,
          reasons: uniqueStrings([
            ...baseContract.reasons.filter(
              (reason) => !/^Required technical layers:/iu.test(reason),
            ),
            decisionRequiredLayers.length > 0
              ? `Required technical layers: ${decisionRequiredLayers.join(", ")}.`
              : "No mandatory technical layer was inferred.",
            "Literal user-named file targets replaced model-inferred layer requirements.",
          ]).slice(0, 18),
        }
      : baseContract;
  const tracedMissingRequiredLayers = decisionRequiredLayers.filter(
    (layer) =>
      !decisionFiles.some((selected) => {
        const inventoryFile = inventoryByPath.get(
          normalizeForCompare(selected.path),
        );
        return (
          selectionEvidenceMatchesLayer(selected.selectionEvidence, layer) ||
          (inventoryFile
            ? fileMatchesExecutionLayer(inventoryFile, layer)
            : false)
        );
      }),
  );
  const tracedContract = applySelectionEvidenceGate({
    contract: decisionBaseContract,
    rawTask: input.rawTask,
    selectedFiles: decisionFiles,
    inventoryFiles: input.inventory.files,
    missingRequiredLayers: tracedMissingRequiredLayers,
    existingImplementationCandidates,
    existingImplementationRequiresReview,
  });
  const keepDiagnosticInvestigation =
    finalDecision.forceInvestigation === true ||
    (!finalDecision.deterministicImplementationReady &&
      ((investigationTrace?.triggered &&
        initialContract.mode === "investigation") ||
        finalDecision.profile.kind === "exact-text"));
  const contract = keepDiagnosticInvestigation
    ? {
        ...tracedContract,
        mode: "investigation" as const,
        allowImplementationGuidance: false,
        implementationGateReasons: uniqueStrings([
          ...tracedContract.implementationGateReasons,
          "Investigation trace remains diagnostic until an implementation owner is proven.",
        ]).slice(0, 12),
        reasons: uniqueStrings([
          ...tracedContract.reasons,
          "Final selection was rebuilt from current evidence and remains investigative.",
        ]).slice(0, 18),
      }
    : tracedContract;

  const constraints = getTaskConstraints(input);
  const traceCanPruneWeakCandidates =
    !baseContract.requiredLayers.some(
      (layer) => layer === "docs" || layer === "tests" || layer === "config",
    ) && !["docs", "tests", "build"].includes(input.taskType ?? "");
  const taskNeedsVerificationContext =
    /\b(?:test|tests|verify|verification|validate|coverage)\b|(?:тест|проверк|верификац|покрыти)/iu.test(
      input.rawTask,
    );
  const governedFiles = decisionFiles
    .map((file) => {
      const investigation = contract.mode === "investigation";
      const evidenceLevel = file.evidenceLevel ?? "model_proposed";
      const evidenceRequiresInspection =
        file.selectionEvidence?.actionConfidence === "inspect_only" ||
        Boolean(file.selectionEvidence?.negativeConstraintConflicts.length);
      const usage: SelectedTaskFileUsage =
        investigation || evidenceRequiresInspection
          ? file.usage === "asset-reference" ||
            file.usage === "config-reference"
            ? file.usage
            : "inspect-only"
          : file.usage;
      const confidenceCap: Record<TaskEvidenceLevel, number> = {
        user_confirmed: 0.98,
        graph_supported: 0.86,
        inventory_exact: 0.78,
        model_proposed: 0.72,
        ranked_candidate: 0.64,
      };
      const confidence = investigation
        ? Math.min(
            file.confidence,
            evidenceLevel === "user_confirmed" ? 0.86 : 0.68,
          )
        : Math.min(file.confidence, confidenceCap[evidenceLevel]);
      const prefix = investigation
        ? `Investigation candidate; needs confirmation. Evidence level: ${evidenceLevel.replace(/_/g, " ")}. `
        : evidenceLevel === "ranked_candidate"
          ? "Ranked candidate; needs confirmation. "
          : evidenceLevel === "model_proposed"
            ? "Model-proposed candidate; needs confirmation. "
            : evidenceLevel === "inventory_exact"
              ? "Real inventory path, but ownership needs confirmation. "
              : "";

      return {
        ...file,
        usage,
        confidence,
        evidenceLevel,
        reason:
          prefix &&
          !normalizeForCompare(file.reason).startsWith(
            normalizeForCompare(prefix),
          )
            ? `${prefix}${file.reason}`
            : file.reason,
      };
    })
    .filter((file) => {
      if (
        constraints.noBackendMutation &&
        (isBackendLeaningPath(file.path) || isClientApiBridgePath(file.path)) &&
        file.selectionEvidence?.negativeConstraintConflicts.length
      ) {
        return (
          file.usage === "inspect-only" &&
          file.evidenceLevel === "user_confirmed"
        );
      }
      if (!investigationTrace?.triggered) return true;
      const traceEvidence =
        investigationTrace.outcome.evidenceByPath[file.path];
      const inventoryFile = inventoryByPath.get(normalizeForCompare(file.path));
      if (file.selectionEvidence?.negativeConstraintConflicts.length) {
        return file.evidenceLevel === "user_confirmed";
      }
      if (
        traceCanPruneWeakCandidates &&
        inventoryFile &&
        isGenericSharedUiPrimitive(inventoryFile) &&
        file.evidenceLevel !== "user_confirmed" &&
        !userTaskExplicitlyNamesSelectedFile(input, file) &&
        traceEvidence?.actionConfidence !== "inspect_then_edit"
      ) {
        return false;
      }
      if (contract.mode === "investigation" && traceCanPruneWeakCandidates) {
        if (
          (file.evidenceLevel ?? "model_proposed") === "model_proposed" &&
          !traceEvidence
        )
          return false;
        if (
          (file.evidenceLevel ?? "ranked_candidate") === "ranked_candidate" &&
          !traceEvidence
        )
          return false;
      }
      if (
        traceCanPruneWeakCandidates &&
        traceEvidence &&
        traceEvidence.actionConfidence === "inspect_only" &&
        (file.evidenceLevel === "model_proposed" ||
          file.evidenceLevel === "ranked_candidate") &&
        /(?:\.smoke\.ts$|\.replay\.ts$|\.test\.|\.spec\.|\.md$|\.css$|package\.json$)/i.test(
          file.path,
        )
      ) {
        if (
          taskNeedsVerificationContext &&
          /(?:package\.json$|\.test\.|\.spec\.)/i.test(file.path)
        ) {
          return true;
        }
        return false;
      }
      return true;
    });

  const finalExistingImplementationCandidates =
    finalDecision.deterministicImplementationReady
      ? []
      : existingImplementationCandidates;

  const evidenceSummary: Record<TaskEvidenceLevel, number> = {
    user_confirmed: 0,
    inventory_exact: 0,
    graph_supported: 0,
    model_proposed: 0,
    ranked_candidate: 0,
  };
  for (const file of governedFiles) {
    evidenceSummary[file.evidenceLevel ?? "model_proposed"] += 1;
  }

  const canonicalArea =
    effectiveTaskAreaForRequiredLayers(contract.requiredLayers) ??
    (finalDecision.deterministicImplementationReady
      ? inferDeterministicEffectiveTaskArea(governedFiles, inventoryByPath)
      : null);

  return {
    selectedFiles: governedFiles,
    contract,
    missingRequiredLayers: tracedMissingRequiredLayers,
    existingImplementationCandidates: finalExistingImplementationCandidates,
    existingImplementationRequiresReview:
      finalDecision.deterministicImplementationReady
        ? false
        : existingImplementationRequiresReview,
    evidenceSummary,
    notes: [
      ...finalDecision.notes,
      ...contract.reasons,
      ...(tracedMissingRequiredLayers.length > 0
        ? [
            `Execution contract layer coverage is incomplete: ${tracedMissingRequiredLayers.join(", ")}.`,
          ]
        : []),
      ...(investigationTrace?.triggered &&
      !finalDecision.deterministicImplementationReady
        ? [
            `Investigation trace inspected ${investigationTrace.inspectedFileCount} file(s), ${investigationTrace.edges.length} edge(s), and confirmed ${investigationTrace.outcome.confirmedOwners.length} owner candidate(s).`,
          ]
        : []),
      ...(finalExistingImplementationCandidates.length > 0
        ? [
            `Existing implementation search found ${finalExistingImplementationCandidates.length} candidate file(s): ${finalExistingImplementationCandidates.join(", ")}. Inspect before adding duplicate behavior.`,
          ]
        : []),
    ],
    repositoryEvidence,
    investigationTrace,
    taskProfile: finalDecision.profile.kind,
    finalDecisionApplied:
      finalDecision.canonicalSelectionApplied ??
      finalDecision.deterministicImplementationReady,
    effectiveTaskAreaOverride:
      finalDecision.deterministicImplementationReady &&
      finalDecision.profile.kind === "api-contract"
        ? ("backend" as EffectiveTaskArea)
        : canonicalArea,
  };
}

const CATEGORICAL_MODEL_NOTE_PATTERNS = [
  /\bimplementation requires\b/i,
  /\bmust modify\b/i,
  /\bshould be extended\b/i,
  /\bmust reside\b/i,
  /\bmust be added\b/i,
  /\bedit this component\b/i,
  /\bfix requires changing\b/i,
  /\brequires modifying\b/i,
];

const STALE_DERIVED_SELECTOR_NOTE_PATTERNS = [
  /^Execution mode:/iu,
  /^Confirmed \d+ (?:user-grounded|implementation target)/iu,
  /^No (?:user-grounded|implementation target)/iu,
  /^Retained \d+ (?:model\/inventory|unconfirmed target)/iu,
  /^No unconfirmed target proposal/iu,
  /^Required technical layers:/iu,
  /^No mandatory technical layer/iu,
  /^No unresolved execution decision/iu,
  /^Unresolved decision/iu,
  /^Implementation gate:/iu,
  /^Execution contract layer coverage/iu,
  /^Investigation trace improved evidence/iu,
  /^Final selection was rebuilt/iu,
  /^Translation consumer retained/iu,
  /^Exact text selection was augmented/iu,
  /^Selection was augmented with fallback-ranked files/iu,
  /^Composer file limit for/iu,
];

const EXACT_TEXT_INITIAL_PIPELINE_NOTE_PATTERNS = [
  /^Fallback file selection was used/iu,
  /^Fallback selection is universal/iu,
  /^Concrete page target detected/iu,
  /^Effective task area:/iu,
  /^Asset mode:/iu,
  /^Strong fallback tokens:/iu,
  /^No missing explicit user paths/iu,
  /^No task type conflict detected/iu,
  /^Explicit target guard (?:promoted|discarded|matched)/iu,
];

function keepInheritedSelectorNote(
  note: string,
  taskProfile?: string | null,
  finalDecisionApplied = false,
  executionMode?: TaskExecutionContract["mode"],
) {
  const value = note.trim();
  if (!value) return false;
  if (
    STALE_DERIVED_SELECTOR_NOTE_PATTERNS.some((pattern) => pattern.test(value))
  )
    return false;
  if (
    finalDecisionApplied &&
    executionMode === "implementation" &&
    CATEGORICAL_MODEL_NOTE_PATTERNS.some((pattern) => pattern.test(value))
  )
    return false;
  if (finalDecisionApplied && /^Effective task area:/iu.test(value))
    return false;
  if (
    taskProfile === "exact-text" &&
    EXACT_TEXT_INITIAL_PIPELINE_NOTE_PATTERNS.some((pattern) =>
      pattern.test(value),
    )
  )
    return false;
  return true;
}

function sanitizeSelectorNotesForExecutionMode(
  notes: string[],
  mode: TaskExecutionContract["mode"] | undefined,
) {
  if (mode !== "investigation" && mode !== "clarification_required")
    return notes;
  return notes.map((note) => {
    if (
      !CATEGORICAL_MODEL_NOTE_PATTERNS.some((pattern) => pattern.test(note))
    ) {
      return note;
    }
    return `Untrusted model hypothesis; verify before editing: ${note
      .replace(/\bimplementation requires\b/gi, "implementation may involve")
      .replace(/\brequires modifying\b/gi, "may involve inspecting")
      .replace(/\bmust modify\b/gi, "inspect whether to modify")
      .replace(/\bshould be extended\b/gi, "may need to be inspected")
      .replace(/\bmust reside\b/gi, "may belong")
      .replace(/\bmust be added\b/gi, "may need to be added")
      .replace(/\bedit this component\b/gi, "inspect this component")
      .replace(
        /\bfix requires changing\b/gi,
        "fix may involve investigating",
      )}`;
  });
}

function withSelectorSafetyProfile(
  selection: TaskFileSelection,
  input?: SelectTaskFilesInput,
  settings?: Awaited<ReturnType<typeof getAppSettings>>,
): TaskFileSelection {
  const marker = `Selector safety profile: ${SELECTOR_SAFETY_PROFILE}.`;
  const versionMarker = `Selector engine version: ${SELECTOR_ENGINE_VERSION}.`;
  const finalized = input
    ? finalizeSelectedFilesForSafety(selection, input)
    : { selectedFiles: selection.selectedFiles, notes: [] };
  const localizationSupport = input
    ? augmentLocalizationSupportSelection(
        finalized.selectedFiles,
        input,
        selection.effectiveTaskArea,
        selection.assetMode,
      )
    : { selectedFiles: finalized.selectedFiles, notes: [] as string[] };
  const executionPolicy = applyExecutionContractSelectionPolicy(
    localizationSupport.selectedFiles,
    input,
    selection.diagnostics?.omittedGraphSeeds,
  );
  const inheritedNotes = [
    ...finalized.notes,
    ...localizationSupport.notes,
    ...selection.notes,
  ].filter((note) =>
    keepInheritedSelectorNote(
      note,
      executionPolicy.taskProfile,
      executionPolicy.finalDecisionApplied,
      executionPolicy.contract?.mode,
    ),
  );
  const rawNotes = Array.from(
    new Set([
      versionMarker,
      marker,
      ...executionPolicy.notes,
      ...inheritedNotes,
    ]),
  );
  const notes = sanitizeSelectorNotesForExecutionMode(
    rawNotes,
    executionPolicy.contract?.mode,
  );
  const notesText = notes.join(" ").toLowerCase();
  const finalDecisionApplied = executionPolicy.finalDecisionApplied;
  const effectiveTaskArea =
    executionPolicy.effectiveTaskAreaOverride ?? selection.effectiveTaskArea;
  const inferredSelectionSource: SelectorSelectionSource = finalDecisionApplied
    ? "final-decision"
    : (selection.diagnostics?.selectionSource ??
      (executionPolicy.selectedFiles.length === 0
        ? notesText.includes("hard safety") ||
          notesText.includes("unsafe") ||
          notesText.includes("out-of-project") ||
          notesText.includes("secret") ||
          notesText.includes("blocked")
          ? "blocked"
          : "manual-review"
        : selection.usedFallback
          ? "fallback"
          : "ai"));
  const areaDiagnostics = getAreaConflictDiagnostics(
    { ...selection, effectiveTaskArea },
    input,
  );
  const roleAdjustments = getSelectionRoleAdjustments(selection, input);
  const semanticGraphEvidence = getSemanticGraphEvidence(selection, input);

  return {
    ...selection,
    source: finalDecisionApplied ? "deterministic" : selection.source,
    usedFallback: finalDecisionApplied ? false : selection.usedFallback,
    rejectedModelPaths: finalDecisionApplied
      ? []
      : selection.rejectedModelPaths,
    effectiveTaskArea,
    selectedFiles: executionPolicy.selectedFiles,
    notes,
    diagnostics: {
      ...selection.diagnostics,
      selectorVersion: SELECTOR_ENGINE_VERSION,
      safetyProfile: SELECTOR_SAFETY_PROFILE,
      generationMode:
        settings?.generationMode ??
        selection.diagnostics?.generationMode ??
        "template",
      model:
        settings?.defaultOllamaModel ?? selection.diagnostics?.model ?? null,
      requestedTaskType:
        input?.taskType ??
        selection.diagnostics?.requestedTaskType ??
        "unknown",
      effectiveTaskArea,
      usedFallback: finalDecisionApplied ? false : selection.usedFallback,
      selectionSource: inferredSelectionSource,
      inferredImplementationArea: areaDiagnostics.inferredImplementationArea,
      areaConflict: areaDiagnostics.areaConflict,
      conflictReason: areaDiagnostics.conflictReason,
      roleAdjustments,
      semanticGraphEvidence,
      executionMode: executionPolicy.contract?.mode,
      requiredLayers: executionPolicy.contract?.requiredLayers,
      missingRequiredLayers: executionPolicy.missingRequiredLayers,
      candidateLayerCoverage: executionPolicy.contract?.candidateLayerCoverage,
      confirmedLayerCoverage: executionPolicy.contract?.confirmedLayerCoverage,
      missingConfirmedLayers: executionPolicy.contract?.missingConfirmedLayers,
      implementationGateReasons:
        executionPolicy.contract?.implementationGateReasons,
      existingImplementationCandidates:
        executionPolicy.existingImplementationCandidates,
      existingImplementationRequiresReview:
        executionPolicy.existingImplementationRequiresReview,
      evidenceSummary: executionPolicy.evidenceSummary,
      ownershipEvidenceChains: executionPolicy.repositoryEvidence?.chains ?? [],
      semanticIndexBuildMs: executionPolicy.repositoryEvidence?.buildDurationMs,
      semanticIndexQueryMs: executionPolicy.repositoryEvidence?.queryDurationMs,
      semanticIndexReused: executionPolicy.repositoryEvidence?.indexReused,
      investigationTrace: executionPolicy.investigationTrace,
      executionContract: executionPolicy.contract ?? undefined,
      taskProfile: executionPolicy.taskProfile ?? undefined,
    },
  };
}

export function finalizeTaskFileSelectionWithCanonicalDecision(
  selection: TaskFileSelection,
  input: SelectTaskFilesInput,
  settings: Awaited<ReturnType<typeof getAppSettings>> = input.settings!,
): TaskFileSelection {
  return withSelectorSafetyProfile(selection, input, settings);
}

function normalizeModelSelection(
  value: unknown,
  input: SelectTaskFilesInput,
  fallback: TaskFileSelection,
  startedAt: number,
): TaskFileSelection {
  const modelFiles = getModelFileItems(value);
  const effectiveTaskArea = fallback.effectiveTaskArea;
  const assetMode = fallback.assetMode;
  const tokenContext = buildTokenContext(input);
  const constraints = getTaskConstraints(input);

  if (modelFiles.length === 0) {
    return {
      ...fallback,
      durationMs: getDurationMs(startedAt),
      notes: [
        ...fallback.notes,
        "Ollama file selector returned invalid or empty JSON file list.",
      ],
    };
  }

  const inventoryByPath = new Map(
    input.inventory.files.map((file) => [normalizeForCompare(file.path), file]),
  );
  const selectedFiles: SelectedTaskFile[] = [];
  const rejectedModelPaths = [...fallback.rejectedModelPaths];
  const seen = new Set<string>();

  for (const item of modelFiles) {
    const rawPath = getPathFromModelItem(item);
    const normalizedPath = normalizeForCompare(rawPath);
    if (!normalizedPath) continue;

    const inventoryFile = inventoryByPath.get(normalizedPath);
    if (!inventoryFile) {
      rejectedModelPaths.push(rawPath);
      continue;
    }

    if (
      !isModelFileSemanticallyUseful(
        inventoryFile,
        input,
        effectiveTaskArea,
        assetMode,
        tokenContext,
      )
    ) {
      rejectedModelPaths.push(
        `${inventoryFile.path} (rejected by semantic quality gate)`,
      );
      continue;
    }

    if (seen.has(normalizedPath)) continue;
    seen.add(normalizedPath);

    selectedFiles.push({
      path: inventoryFile.path,
      kind: inventoryFile.kind,
      usage: sanitizeUsageForFile(
        inventoryFile,
        getRequestedUsageFromModelItem(item, inventoryFile),
      ),
      reason: getReasonFromModelItem(item),
      confidence: getConfidenceFromModelItem(item),
      selectionEvidence: createModelOnlySelectionEvidence(inventoryFile),
    });
  }

  const completedBeforeSeedConsistency = ensureRequiredFullstackLayers(
    applyVisualOnlyScopeGuard(
      scopeFullstackSelectionToPrimaryUiTargets(
        input,
        effectiveTaskArea,
        scopeSelectionToPrimaryPageTargets(
          input,
          effectiveTaskArea,
          assetMode,
          ensureHelpfulCoverage(
            appendFallbackFilesIfNeeded(selectedFiles, input, fallback),
            input,
            effectiveTaskArea,
            assetMode,
          ),
        ),
      ),
      input,
      effectiveTaskArea,
    ),
    input,
    effectiveTaskArea,
    assetMode,
  );
  const seedConsistency = retainGraphSeeds({
    selectedFiles: completedBeforeSeedConsistency,
    fallbackSeeds: fallback.selectedFiles,
    inventory: input.inventory,
    maxFiles: getSelectionLimitFromSettings(
      input,
      effectiveTaskArea,
      assetMode,
    ),
  });
  const completedSelection = seedConsistency.selectedFiles;

  if (completedSelection.length === 0) {
    return {
      ...fallback,
      rejectedModelPaths,
      durationMs: getDurationMs(startedAt),
      notes: [
        ...fallback.notes,
        "Ollama file selector did not select any semantically valid inventory paths.",
      ],
    };
  }

  const wasAugmented = completedSelection.length > selectedFiles.length;
  const semanticRejectedCount = rejectedModelPaths.filter((item) =>
    item.includes("semantic quality gate"),
  ).length;
  const modelNotes = getModelNotes(value);
  const groundedModelNotes = selectedFiles.length > 0 ? modelNotes : [];

  return {
    selectedFiles: completedSelection,
    rejectedModelPaths,
    source: "ollama",
    usedFallback: false,
    durationMs: getDurationMs(startedAt),
    effectiveTaskArea,
    assetMode,
    conflictNote: fallback.conflictNote,
    notes: [
      ...groundedModelNotes,
      ...(modelNotes.length > 0 && groundedModelNotes.length === 0
        ? [
            "Discarded AI selector notes because no model-selected path survived semantic validation.",
          ]
        : []),
      `Effective task area: ${effectiveTaskArea}.`,
      `Asset mode: ${assetMode}.`,
      `Composer file limit for "${effectiveTaskArea}": ${getSelectionLimitFromSettings(input, effectiveTaskArea, assetMode)}.`,
      fallback.conflictNote ?? "No task type conflict detected.",
      ...constraints.notes,
      semanticRejectedCount > 0
        ? `Rejected ${semanticRejectedCount} real but semantically weak model-selected path(s).`
        : "No semantically weak model-selected paths were accepted.",
      rejectedModelPaths.length > 0
        ? `Rejected ${rejectedModelPaths.length} model-selected or user-mentioned path(s) because they were invalid, unsafe, generated, absent, or semantically weak.`
        : "All selected paths were validated against project inventory and semantic quality gates.",
      wasAugmented
        ? "Selection was augmented with fallback-ranked files because Ollama selected too few valid files or needed coverage balancing."
        : "Selection was produced by Ollama and validated by ContextForge.",
      ...(seedConsistency.retainedSeeds.length > 0
        ? [
            `Retained central graph seed(s): ${seedConsistency.retainedSeeds.join(", ")}.`,
          ]
        : []),
      ...seedConsistency.omittedSeeds.map(
        (item) => `Graph seed omitted: ${item.path}. ${item.reason}`,
      ),
    ],
    diagnostics: {
      ...fallback.diagnostics,
      omittedGraphSeeds: seedConsistency.omittedSeeds,
    } as TaskFileSelection["diagnostics"],
  };
}

function buildSelectorRepairPrompt(rawResponse: string) {
  return `
Repair this model response into strict JSON only. No Markdown. No code fences.

Keep only this shape:
{
  "selectedFiles": [
    {
      "path": "real/path/from/inventory.ext",
      "usage": "inspect-and-edit|create-and-edit|inspect-only|asset-reference|config-reference",
      "reason": "short grounded reason",
      "confidence": 0.8
    }
  ],
  "notes": []
}

If the response does not contain real file paths, return:
{ "selectedFiles": [], "notes": ["No valid file paths were found in the model response."] }

Invalid response:
${rawResponse.slice(0, 6000)}
`.trim();
}

function buildSelectorRetryPrompt(
  input: SelectTaskFilesInput,
  plan: SelectorPromptPlan,
) {
  const effectiveTaskArea = getEffectiveTaskArea(input);
  const assetMode = getAssetMode(input);
  const compactInventory = compactInventoryForPrompt(plan);

  return `
Return one strict JSON object only. The previous selector response was invalid.

Task: ${input.rawTask}
Area: ${effectiveTaskArea}
Asset mode: ${assetMode}
Candidate shortlist (${compactInventory.length} of ${plan.totalInventoryFiles} real files):
${JSON.stringify(compactInventory)}

Contract:
{"selectedFiles":[{"path":"exact/path/from/shortlist","usage":"inspect-and-edit|create-and-edit|inspect-only|asset-reference|config-reference","reason":"short grounded reason","confidence":0.8}],"notes":[]}

Rules:
- Use only exact paths from the shortlist.
- Every item must include path, usage, reason, and numeric confidence from 0 to 1.
- Prefer the explicit/structured target and its direct support.
- Respect UI/backend/fullstack scope and protected areas.
- If no safe candidate fits, return {"selectedFiles":[],"notes":["No safe high-confidence candidate was found."]}.
`.trim();
}

async function requestSelectorJson({
  ollamaUrl,
  model,
  prompt,
  numPredict,
  purpose,
}: {
  ollamaUrl: string;
  model: string;
  prompt: string;
  numPredict: number;
  purpose: string;
}) {
  const aiCall = beginPerformanceAiCall({
    purpose,
    provider: "ollama",
    model,
    promptChars: prompt.length,
    responseFormat: "json",
    numPredict,
  });

  try {
    const response = await fetch(
      `${ollamaUrl.replace(/\/$/, "")}/api/generate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
          format: "json",
          options: { temperature: 0, num_predict: numPredict },
        }),
      },
    );

    if (!response.ok) {
      finishPerformanceAiCall(aiCall, {
        success: false,
        httpStatus: response.status,
        errorCode: "http_error",
      });
      return {
        ok: false as const,
        status: response.status,
        raw: "",
        rawLength: 0,
        json: null,
        parseStage: "not-run" as SelectorParseStage,
      };
    }

    const data = (await response.json()) as OllamaGenerateResponse;
    const raw = String(data.response ?? "");
    const extracted = extractJsonObjectWithStage(raw);
    const nsToMs = (value: number | undefined) =>
      typeof value === "number" ? value / 1_000_000 : null;

    finishPerformanceAiCall(aiCall, {
      success: Boolean(raw.trim()),
      httpStatus: response.status,
      responseChars: raw.length,
      modelLoadMs: nsToMs(data.load_duration),
      promptEvalMs: nsToMs(data.prompt_eval_duration),
      generationMs: nsToMs(data.eval_duration),
      promptTokens: data.prompt_eval_count ?? null,
      responseTokens: data.eval_count ?? null,
      errorCode: raw.trim() ? null : "empty_response",
    });

    return {
      ok: true as const,
      status: response.status,
      raw,
      rawLength: raw.length,
      json: extracted.json,
      parseStage: extracted.stage,
    };
  } catch (error) {
    finishPerformanceAiCall(aiCall, {
      success: false,
      errorCode:
        error instanceof Error && error.name === "TimeoutError"
          ? "timeout"
          : "request_error",
    });
    throw error;
  }
}

export async function selectTaskFiles(
  input: SelectTaskFilesInput,
): Promise<TaskFileSelection> {
  const startedAt = Date.now();
  const settings = input.settings ?? (await getAppSettings());
  const inputWithSettings: SelectTaskFilesInput = {
    ...input,
    settings,
  };

  const fallback = await measurePerformanceStage(
    "selector_fallback_ranking",
    "Build deterministic selector fallback",
    () => buildFallbackSelection(inputWithSettings),
  );

  if (settings.generationMode !== "ollama" || !settings.defaultOllamaModel) {
    return withSelectorSafetyProfile(
      { ...fallback, durationMs: getDurationMs(startedAt) },
      inputWithSettings,
      settings,
    );
  }

  let promptPlan: SelectorPromptPlan | null = null;
  let initialPromptChars = 0;
  let retryPromptChars = 0;
  const getPromptDiagnostics = () => ({
    promptInventoryTotalFiles: promptPlan?.totalInventoryFiles,
    promptCandidateCount: promptPlan?.files.length,
    promptShortlistApplied: promptPlan?.shortlistApplied,
    initialPromptChars: initialPromptChars || undefined,
    retryPromptChars: retryPromptChars || undefined,
    executionMode: promptPlan?.executionContract?.mode,
    requiredLayers: promptPlan?.executionContract?.requiredLayers,
  });
  const getPromptNotes = () =>
    promptPlan
      ? [
          `Selector prompt shortlist included ${promptPlan.files.length} of ${promptPlan.totalInventoryFiles} real inventory files and omitted ${promptPlan.omittedFiles} lower-ranked candidates.`,
        ]
      : [];

  try {
    promptPlan = await measurePerformanceStage(
      "selector_prompt_shortlist",
      "Build compact selector prompt shortlist",
      () => buildSelectorPromptPlan(inputWithSettings, fallback),
    );
    const initialPrompt = buildSelectorPrompt(inputWithSettings, promptPlan);
    initialPromptChars = initialPrompt.length;

    const firstAttempt = await measurePerformanceStage(
      "selector_ai_initial",
      "Run initial AI file selection",
      () =>
        requestSelectorJson({
          ollamaUrl: settings.ollamaUrl,
          model: settings.defaultOllamaModel!,
          prompt: initialPrompt,
          numPredict: 900,
          purpose: "file_selection_initial",
        }),
    );

    if (!firstAttempt.ok) {
      return withSelectorSafetyProfile(
        {
          ...fallback,
          durationMs: getDurationMs(startedAt),
          diagnostics: {
            selectionSource: "fallback",
            rawModelResponseLength: firstAttempt.rawLength,
            parseStage: firstAttempt.parseStage,
            parseStages: [firstAttempt.parseStage],
            repairAttempted: false,
            retryAttempted: false,
            schemaValid: false,
            schemaError: `Ollama responded with status ${firstAttempt.status}.`,
            ...getPromptDiagnostics(),
          } as TaskFileSelection["diagnostics"],
          notes: [
            ...getPromptNotes(),
            ...fallback.notes,
            `Ollama file selector responded with status ${firstAttempt.status}.`,
          ],
        },
        inputWithSettings,
        settings,
      );
    }

    let json: unknown | null = null;
    let selectionSource: SelectorSelectionSource = "ai";
    let parseStage = firstAttempt.parseStage;
    const parseStages: SelectorParseStage[] = [firstAttempt.parseStage];
    const repairNotes: string[] = [];
    let repairAttempted = false;
    let retryAttempted = false;
    let schema = validateSelectorJsonContract(firstAttempt.json);

    if (firstAttempt.json && schema.ok) {
      json = firstAttempt.json;
    } else {
      repairAttempted = true;
      const repairAttempt = await measurePerformanceStage(
        "selector_ai_repair",
        "Repair AI file selection JSON",
        () =>
          requestSelectorJson({
            ollamaUrl: settings.ollamaUrl,
            model: settings.defaultOllamaModel!,
            prompt: buildSelectorRepairPrompt(
              redactSelectorResponse(firstAttempt.raw),
            ),
            numPredict: 450,
            purpose: "file_selection_repair",
          }),
      );
      parseStages.push(
        repairAttempt.parseStage === "not-run"
          ? "not-run"
          : repairAttempt.parseStage === "failed"
            ? "failed"
            : "repair-json",
      );

      const repairSchema = validateSelectorJsonContract(repairAttempt.json);
      if (repairAttempt.ok && repairAttempt.json && repairSchema.ok) {
        json = repairAttempt.json;
        selectionSource = "repaired-ai";
        parseStage = "repair-json";
        schema = repairSchema;
        repairNotes.push(
          "Ollama file selector JSON was repaired after an invalid first response.",
        );
      } else {
        repairNotes.push(
          repairSchema.reason
            ? `Ollama file selector repair failed schema validation: ${repairSchema.reason}`
            : "Ollama file selector returned invalid JSON and repair did not produce valid JSON.",
        );
      }
    }

    if (!json) {
      retryAttempted = true;
      const retryPrompt = buildSelectorRetryPrompt(
        inputWithSettings,
        promptPlan,
      );
      retryPromptChars = retryPrompt.length;
      const retryAttempt = await measurePerformanceStage(
        "selector_ai_retry",
        "Retry AI file selection with strict contract",
        () =>
          requestSelectorJson({
            ollamaUrl: settings.ollamaUrl,
            model: settings.defaultOllamaModel!,
            prompt: retryPrompt,
            numPredict: 700,
            purpose: "file_selection_retry",
          }),
      );
      parseStages.push(
        retryAttempt.parseStage === "not-run"
          ? "not-run"
          : retryAttempt.parseStage === "failed"
            ? "failed"
            : "retry-json",
      );

      const retrySchema = validateSelectorJsonContract(retryAttempt.json);
      if (retryAttempt.ok && retryAttempt.json && retrySchema.ok) {
        json = retryAttempt.json;
        selectionSource = "retry-ai";
        parseStage = "retry-json";
        schema = retrySchema;
        repairNotes.push(
          "Ollama file selector produced valid JSON after one strict retry.",
        );
      } else {
        schema = retrySchema;
        repairNotes.push(
          retrySchema.reason
            ? `Ollama file selector strict retry failed schema validation: ${retrySchema.reason}`
            : "Ollama file selector strict retry did not produce valid JSON.",
        );
      }
    }

    if (!json) {
      return withSelectorSafetyProfile(
        {
          ...fallback,
          durationMs: getDurationMs(startedAt),
          diagnostics: {
            selectionSource: "fallback",
            rawModelResponseLength: firstAttempt.rawLength,
            parseStage,
            parseStages,
            repairAttempted,
            retryAttempted,
            schemaValid: false,
            schemaError:
              schema.reason ??
              "Ollama selector response did not satisfy the strict JSON contract.",
            ...getPromptDiagnostics(),
          } as TaskFileSelection["diagnostics"],
          notes: [
            ...getPromptNotes(),
            ...fallback.notes,
            ...repairNotes,
            schema.reason
              ? `Ollama file selector failed strict JSON contract: ${schema.reason}`
              : "Ollama file selector failed strict JSON contract.",
          ],
        },
        inputWithSettings,
        settings,
      );
    }

    const normalized = await measurePerformanceStage(
      "selector_normalization",
      "Normalize and validate AI file selection",
      () =>
        normalizeModelSelection(json, inputWithSettings, fallback, startedAt),
    );
    return withSelectorSafetyProfile(
      {
        ...normalized,
        diagnostics: {
          selectionSource: normalized.usedFallback
            ? normalized.selectedFiles.length === 0
              ? "manual-review"
              : "fallback"
            : selectionSource,
          rawModelResponseLength: firstAttempt.rawLength,
          parseStage,
          parseStages,
          repairAttempted,
          retryAttempted,
          schemaValid: true,
          ...getPromptDiagnostics(),
        } as TaskFileSelection["diagnostics"],
        notes: [...getPromptNotes(), ...repairNotes, ...normalized.notes],
      },
      inputWithSettings,
      settings,
    );
  } catch (error) {
    return withSelectorSafetyProfile(
      {
        ...fallback,
        durationMs: getDurationMs(startedAt),
        diagnostics: {
          selectionSource: "fallback",
          rawModelResponseLength: 0,
          parseStage: "failed",
          parseStages: ["failed"],
          repairAttempted: false,
          retryAttempted: false,
          schemaValid: false,
          schemaError:
            error instanceof Error ? error.message : "Ollama selector failed.",
          ...getPromptDiagnostics(),
        } as TaskFileSelection["diagnostics"],
        notes: [
          ...getPromptNotes(),
          ...fallback.notes,
          error instanceof Error
            ? `Ollama file selector failed: ${error.message}`
            : "Ollama file selector failed.",
        ],
      },
      inputWithSettings,
      settings,
    );
  }
}
