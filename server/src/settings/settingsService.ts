import path from "node:path";

import { config } from "../config/index.js";
import { storage } from "../storage/index.js";
import {
  sanitizeSelectorDiagnosticMessage,
  type SelectorPipelineDiagnostics,
  type SelectorFallbackReasonCode,
  type SelectorAbstentionReasonCode,
} from "../selection/selectorPipelineOrchestrator.js";
import {
  createContextEngineShadowHistory,
  createContextEngineShadowDiagnosticsWriter,
  closeContextEngineShadowExecutionTracker,
  normalizeContextEngineMode,
  type ContextEngineMode,
  type ContextEngineShadowComparison,
} from "../contextEngineV2/shadow/index.js";
import {
  closeContextComposerExecutionTracker,
  normalizeContextComposerEngineMode,
  type ContextComposerEngineMode,
} from "../contextEngineV2/composer/index.js";
import {
  closeTaskPackCanaryExecutionTracker,
  createTaskPackCanaryDiagnosticsWriter,
  createTaskPackCanaryHistory,
  normalizeContextEngineCanaryConfiguration,
  type TaskPackCanaryDecision,
} from "../contextEngineV2/canary/index.js";

export type SelectorPipelineMode = "legacy" | "shadow_compare" | "shadow_primary";
export type TaskUnderstandingInteractionMode = "automatic" | "balanced" | "confirm_all";

function normalizeSelectorPipelineMode(value: unknown): SelectorPipelineMode {
  return value === "shadow_compare" || value === "shadow_primary" ? value : "legacy";
}

function normalizeTaskUnderstandingInteractionMode(
  value: unknown,
): TaskUnderstandingInteractionMode {
  return value === "automatic" || value === "confirm_all"
    ? value
    : "balanced";
}

export async function readTaskUnderstandingInteractionMode(
  read: <T>(key: string, fallback: T) => Promise<T> = getSettingValue,
) {
  return normalizeTaskUnderstandingInteractionMode(
    await read(
      "task_understanding_interaction_mode",
      "balanced" as TaskUnderstandingInteractionMode,
    ),
  );
}

export async function readSelectorPipelineMode(
  read: <T>(key: string, fallback: T) => Promise<T> = getSettingValue,
) {
  return normalizeSelectorPipelineMode(
    await read("selector_pipeline_mode", "legacy" as SelectorPipelineMode),
  );
}

export async function readContextEngineMode(
  read: <T>(key: string, fallback: T) => Promise<T> = getSettingValue,
): Promise<ContextEngineMode> {
  return normalizeContextEngineMode(
    await read("context_engine_mode", "disabled" as ContextEngineMode),
  );
}

export async function readContextEngineCanaryConfiguration(
  read: <T>(key: string, fallback: T) => Promise<T> = getSettingValue,
) {
  return normalizeContextEngineCanaryConfiguration({
    percent: await read("context_engine_canary_percent", 0),
    projectIds: await read("context_engine_canary_project_ids", [] as string[]),
  });
}

export async function readContextComposerEngineMode(
  read: <T>(key: string, fallback: T) => Promise<T> = getSettingValue,
): Promise<ContextComposerEngineMode> {
  return normalizeContextComposerEngineMode(
    await read("context_composer_engine_mode", "legacy" as ContextComposerEngineMode),
  );
}

export interface AppSettings {
  ollamaUrl: string;
  generationMode: "template" | "ollama";
  aiProvider: "ollama" | "openai-compatible" | "anthropic" | "gemini";
  defaultTargetTool: "codex" | "cursor" | "claude" | "gemini" | "generic";
  defaultTaskType:
    | "general"
    | "ui"
    | "backend"
    | "fullstack"
    | "build"
    | "bugfix"
    | "refactor"
    | "docs"
    | "tests";
  defaultOllamaModel: string | null;
  openAiCompatibleBaseUrl: string;
  openAiCompatibleModel: string | null;
  openAiCompatibleApiKeyConfigured: boolean;
  geminiBaseUrl: string;
  geminiModel: string | null;
  geminiApiKeyConfigured: boolean;
  anthropicBaseUrl: string;
  anthropicModel: string | null;
  anthropicApiKeyConfigured: boolean;
  language: "system" | "en" | "ru";
  theme: "system" | "dark" | "light";
  composerFileLimits: ComposerFileLimits;
  contextQualityMode: ContextQualityMode;
  selectorPipelineMode: SelectorPipelineMode;
  contextEngineMode?: ContextEngineMode;
  contextEngineCanaryPercent?: number;
  contextEngineCanaryProjectIds?: string[];
  contextComposerEngineMode?: ContextComposerEngineMode;
  taskUnderstandingInteractionMode: TaskUnderstandingInteractionMode;
  sidebarShowDescriptions: boolean;
  onboardingEnabled: boolean;
  onboardingShowEveryLaunch: boolean;
  onboardingCompleted: boolean;
}

export interface UpdateAppSettingsInput extends Partial<AppSettings> {
  openAiCompatibleApiKey?: string | null;
  clearOpenAiCompatibleApiKey?: boolean;
  geminiApiKey?: string | null;
  clearGeminiApiKey?: boolean;
  anthropicApiKey?: string | null;
  clearAnthropicApiKey?: boolean;
}

export type ContextQualityMode = "advisory" | "balanced" | "strict";

export interface ComposerFileLimits {
  default: number;
  ui: number;
  backend: number;
  fullstack: number;
  build: number;
  bugfix: number;
  refactor: number;
  docs: number;
  tests: number;
}

const defaultSettings: AppSettings = {
  ollamaUrl: config.ollamaUrl,
  generationMode: "template",
  aiProvider: "ollama",
  defaultTargetTool: "codex",
  defaultTaskType: "general",
  defaultOllamaModel: null,
  openAiCompatibleBaseUrl: "http://localhost:1234/v1",
  openAiCompatibleModel: null,
  openAiCompatibleApiKeyConfigured: false,
  geminiBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
  geminiModel: "gemini-1.5-flash",
  geminiApiKeyConfigured: false,
  anthropicBaseUrl: "https://api.anthropic.com/v1",
  anthropicModel: "claude-3-5-sonnet-latest",
  anthropicApiKeyConfigured: false,
  language: "system",
  theme: "dark",
  composerFileLimits: {
    default: 8,
    ui: 7,
    backend: 8,
    fullstack: 10,
    build: 7,
    bugfix: 7,
    refactor: 8,
    docs: 6,
    tests: 7,
  },
  contextQualityMode: "balanced",
  selectorPipelineMode: "legacy",
  contextEngineMode: "disabled",
  contextEngineCanaryPercent: 0,
  contextEngineCanaryProjectIds: [],
  contextComposerEngineMode: "legacy",
  taskUnderstandingInteractionMode: "balanced",
  sidebarShowDescriptions: false,
  onboardingEnabled: true,
  onboardingShowEveryLaunch: true,
  onboardingCompleted: false,
};

const settingKeyMap = {
  ollamaUrl: "ollama_url",
  generationMode: "generation_mode",
  aiProvider: "ai_provider",
  defaultTargetTool: "default_target_tool",
  defaultTaskType: "default_task_type",
  defaultOllamaModel: "default_ollama_model",
  openAiCompatibleBaseUrl: "openai_compatible_base_url",
  openAiCompatibleModel: "openai_compatible_model",
  openAiCompatibleApiKeyConfigured: "openai_compatible_api_key_configured",
  geminiBaseUrl: "gemini_base_url",
  geminiModel: "gemini_model",
  geminiApiKeyConfigured: "gemini_api_key_configured",
  anthropicBaseUrl: "anthropic_base_url",
  anthropicModel: "anthropic_model",
  anthropicApiKeyConfigured: "anthropic_api_key_configured",
  language: "language",
  theme: "theme",
  composerFileLimits: "composer_file_limits",
  contextQualityMode: "context_quality_mode",
  selectorPipelineMode: "selector_pipeline_mode",
  contextEngineMode: "context_engine_mode",
  contextEngineCanaryPercent: "context_engine_canary_percent",
  contextEngineCanaryProjectIds: "context_engine_canary_project_ids",
  contextComposerEngineMode: "context_composer_engine_mode",
  taskUnderstandingInteractionMode: "task_understanding_interaction_mode",
  sidebarShowDescriptions: "sidebar_show_descriptions",
  onboardingEnabled: "onboarding_enabled",
  onboardingShowEveryLaunch: "onboarding_show_every_launch",
  onboardingCompleted: "onboarding_completed",
} as const;

const secretSettingKeys = {
  openAiCompatibleApiKey: "openai_compatible_api_key",
  geminiApiKey: "gemini_api_key",
  anthropicApiKey: "anthropic_api_key",
} as const;

export async function getSettingValue<T>(key: string, fallback: T): Promise<T> {
  return storage.getSettingValue(key, fallback);
}

export async function getAppSettings(): Promise<AppSettings> {
  const openAiCompatibleApiKey = await getSettingValue<string | null>(
    secretSettingKeys.openAiCompatibleApiKey,
    null,
  );
  const geminiApiKey = await getSettingValue<string | null>(
    secretSettingKeys.geminiApiKey,
    null,
  );
  const anthropicApiKey = await getSettingValue<string | null>(
    secretSettingKeys.anthropicApiKey,
    null,
  );

  const canary = await readContextEngineCanaryConfiguration();
  return {
    ollamaUrl: await getSettingValue(
      settingKeyMap.ollamaUrl,
      defaultSettings.ollamaUrl,
    ),
    generationMode: await getSettingValue(
      settingKeyMap.generationMode,
      defaultSettings.generationMode,
    ),
    aiProvider: await getSettingValue(
      settingKeyMap.aiProvider,
      defaultSettings.aiProvider,
    ),
    defaultTargetTool: await getSettingValue(
      settingKeyMap.defaultTargetTool,
      defaultSettings.defaultTargetTool,
    ),
    defaultTaskType: await getSettingValue(
      settingKeyMap.defaultTaskType,
      defaultSettings.defaultTaskType,
    ),
    defaultOllamaModel: await getSettingValue(
      settingKeyMap.defaultOllamaModel,
      defaultSettings.defaultOllamaModel,
    ),
    openAiCompatibleBaseUrl: await getSettingValue(
      settingKeyMap.openAiCompatibleBaseUrl,
      defaultSettings.openAiCompatibleBaseUrl,
    ),
    openAiCompatibleModel: await getSettingValue(
      settingKeyMap.openAiCompatibleModel,
      defaultSettings.openAiCompatibleModel,
    ),
    openAiCompatibleApiKeyConfigured: Boolean(openAiCompatibleApiKey),
    geminiBaseUrl: await getSettingValue(
      settingKeyMap.geminiBaseUrl,
      defaultSettings.geminiBaseUrl,
    ),
    geminiModel: await getSettingValue(
      settingKeyMap.geminiModel,
      defaultSettings.geminiModel,
    ),
    geminiApiKeyConfigured: Boolean(geminiApiKey),
    anthropicBaseUrl: await getSettingValue(
      settingKeyMap.anthropicBaseUrl,
      defaultSettings.anthropicBaseUrl,
    ),
    anthropicModel: await getSettingValue(
      settingKeyMap.anthropicModel,
      defaultSettings.anthropicModel,
    ),
    anthropicApiKeyConfigured: Boolean(anthropicApiKey),
    language: await getSettingValue(
      settingKeyMap.language,
      defaultSettings.language,
    ),
    theme: await getSettingValue(settingKeyMap.theme, defaultSettings.theme),
    composerFileLimits: await getSettingValue(
      settingKeyMap.composerFileLimits,
      defaultSettings.composerFileLimits,
    ),
    contextQualityMode: await getSettingValue(
      settingKeyMap.contextQualityMode,
      defaultSettings.contextQualityMode,
    ),
    selectorPipelineMode: await readSelectorPipelineMode(),
    contextEngineMode: await readContextEngineMode(),
    contextEngineCanaryPercent: canary.percent,
    contextEngineCanaryProjectIds: [...canary.projectIds],
    contextComposerEngineMode: await readContextComposerEngineMode(),
    taskUnderstandingInteractionMode:
      await readTaskUnderstandingInteractionMode(),
    sidebarShowDescriptions: await getSettingValue(
      settingKeyMap.sidebarShowDescriptions,
      defaultSettings.sidebarShowDescriptions,
    ),
    onboardingEnabled: await getSettingValue(
      settingKeyMap.onboardingEnabled,
      defaultSettings.onboardingEnabled,
    ),
    onboardingShowEveryLaunch: await getSettingValue(
      settingKeyMap.onboardingShowEveryLaunch,
      defaultSettings.onboardingShowEveryLaunch,
    ),
    onboardingCompleted: await getSettingValue(
      settingKeyMap.onboardingCompleted,
      defaultSettings.onboardingCompleted,
    ),
  };
}

const selectorDiagnosticsHistoryKey = "selector_diagnostics_history";
const SELECTOR_DIAGNOSTICS_HISTORY_LIMIT = 50;
const selectorFailureCodes = new Set<SelectorFallbackReasonCode>([
  "shadow_exception",
  "shadow_timeout",
  "shadow_invalid_result",
  "shadow_unknown_candidate",
  "shadow_unknown_path",
  "shadow_contract_violation",
]);
const selectorUsageRoles = new Set([
  "inspect-and-edit",
  "create-and-edit",
  "inspect-only",
  "asset-reference",
  "config-reference",
]);
const selectorEvidenceStrengths = new Set(["strong", "supporting", "reference"]);
const selectorAbstentionCodes = new Set<SelectorAbstentionReasonCode>([
  "explicit_target_missing",
  "no_grounded_candidates",
  "no_ranked_candidates",
  "ambiguous_target",
  "legacy_empty_selection",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteNumber(value: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
}

function isSafeDiagnosticPath(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "").trim();
  if (!normalized || /^[a-z]:/i.test(normalized) || path.posix.isAbsolute(normalized) || path.win32.isAbsolute(normalized)) return false;
  return !normalized.split("/").some((segment) => segment === "..");
}

function normalizeFailure(value: unknown): SelectorPipelineDiagnostics["fallback"] {
  const record = asRecord(value);
  if (!record || !selectorFailureCodes.has(record.code as SelectorFallbackReasonCode)) return null;
  return {
    code: record.code as SelectorFallbackReasonCode,
    message: sanitizeSelectorDiagnosticMessage(record.message),
  };
}

function normalizeSummary(
  value: unknown,
  fallbackPipeline: SelectorPipelineDiagnostics["effectivePipeline"],
): SelectorPipelineDiagnostics["actual"] | null {
  const record = asRecord(value);
  if (!record) return null;
  const pipeline = record.pipeline === "shadow" ? "shadow" : record.pipeline === "legacy" ? "legacy" : fallbackPipeline;
  const selectedFiles = Array.isArray(record.selectedFiles)
    ? record.selectedFiles.flatMap((fileValue) => {
        const file = asRecord(fileValue);
        if (!file || !isSafeDiagnosticPath(file.path) || !selectorUsageRoles.has(file.usage as string)) return [];
        return [{
          path: file.path,
          usage: file.usage as SelectorPipelineDiagnostics["actual"]["selectedFiles"][number]["usage"],
          reason: typeof file.reason === "string" && file.reason.trim()
            ? sanitizeSelectorDiagnosticMessage(file.reason).slice(0, 500)
            : "Selected from grounded project evidence.",
          evidenceStrength: selectorEvidenceStrengths.has(file.evidenceStrength as string)
            ? file.evidenceStrength as SelectorPipelineDiagnostics["actual"]["selectedFiles"][number]["evidenceStrength"]
            : file.usage === "inspect-and-edit" || file.usage === "create-and-edit"
              ? "strong"
              : file.usage === "config-reference" || file.usage === "asset-reference"
                ? "reference"
                : "supporting",
        }];
      })
    : [];
  const abstentionRecord = asRecord(record.abstention);
  const abstention = abstentionRecord && selectorAbstentionCodes.has(abstentionRecord.code as SelectorAbstentionReasonCode)
    ? {
        code: abstentionRecord.code as SelectorAbstentionReasonCode,
        message: sanitizeSelectorDiagnosticMessage(abstentionRecord.message),
        nextActions: Array.isArray(abstentionRecord.nextActions)
          ? abstentionRecord.nextActions
              .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
              .map((value) => sanitizeSelectorDiagnosticMessage(value).slice(0, 240))
              .slice(0, 5)
          : [],
      }
    : null;
  const blocked = record.blocked === true;
  const outcome = record.outcome === "blocked" || blocked
    ? "blocked"
    : record.outcome === "abstained" || (selectedFiles.length === 0 && !blocked)
      ? "abstained"
      : "selected";
  return {
    pipeline,
    selectedFiles,
    primaryTarget: isSafeDiagnosticPath(record.primaryTarget) ? record.primaryTarget : null,
    implementationArea: typeof record.implementationArea === "string" && record.implementationArea.trim()
      ? record.implementationArea.slice(0, 64)
      : "general",
    confidence: Math.round(finiteNumber(record.confidence, 0, 0, 100)),
    quality: typeof record.quality === "number" && Number.isFinite(record.quality)
      ? Math.round(finiteNumber(record.quality, 0, 0, 100))
      : null,
    blocked,
    manualReview: record.manualReview === true,
    missingTarget: record.missingTarget === true,
    candidateCount: Math.round(finiteNumber(record.candidateCount, 0, 0, 10_000)),
    outcome,
    abstention: outcome === "abstained" ? abstention : null,
  };
}

function normalizeComparison(value: unknown): SelectorPipelineDiagnostics["comparison"] {
  const record = asRecord(value);
  if (!record) return null;
  const safePaths = (paths: unknown) => Array.isArray(paths) ? paths.filter(isSafeDiagnosticPath) : [];
  return {
    primaryTargetAgreement: record.primaryTargetAgreement === true,
    implementationAreaAgreement: record.implementationAreaAgreement === true,
    selectedPathOverlap: finiteNumber(record.selectedPathOverlap, 0, 0, 1),
    editTargetOverlap: finiteNumber(record.editTargetOverlap, 0, 0, 1),
    legacyOnlyPaths: safePaths(record.legacyOnlyPaths),
    shadowOnlyPaths: safePaths(record.shadowOnlyPaths),
    safetyDecisionAgreement: record.safetyDecisionAgreement === true,
    manualReviewAgreement: record.manualReviewAgreement === true,
  };
}

function normalizeSelectorDiagnosticsRecord(value: unknown): SelectorPipelineDiagnostics | null {
  const record = asRecord(value);
  if (!record || typeof record.timestamp !== "string" || !Number.isFinite(Date.parse(record.timestamp))) return null;

  const requestedMode = normalizeSelectorPipelineMode(record.requestedMode);
  const effectivePipeline = record.effectivePipeline === "shadow" ? "shadow" : "legacy";
  const oldFailure = normalizeFailure(record.fallback);
  const fallback = requestedMode === "shadow_compare" ? null : oldFailure;
  const shadowFailure = normalizeFailure(record.shadowFailure) ?? (requestedMode === "shadow_compare" ? oldFailure : null);
  const actual = normalizeSummary(record.actual, effectivePipeline);
  if (!actual) return null;

  const executionStatus = fallback || record.executionStatus === "fallback" ? "fallback" : "success";
  const qualityStatus = record.qualityStatus === "blocked" || record.qualityStatus === "warning" || record.qualityStatus === "ready"
    ? record.qualityStatus
    : record.status === "blocked"
      ? "blocked"
      : record.status === "manual-review"
        ? "warning"
        : "ready";
  const status = executionStatus === "fallback"
    ? "fallback"
    : actual.outcome === "abstained"
      ? "manual-review"
      : qualityStatus === "blocked"
        ? "blocked"
        : actual.manualReview
          ? "manual-review"
          : "success";
  const timings = asRecord(record.timings);

  return {
    id: typeof record.id === "string" ? record.id.slice(0, 128) : `${Date.parse(record.timestamp)}`,
    timestamp: record.timestamp,
    projectRef: typeof record.projectRef === "string" ? record.projectRef.slice(0, 64) : "unknown",
    taskHash: typeof record.taskHash === "string" ? record.taskHash.slice(0, 64) : "unknown",
    requestedMode,
    effectivePipeline,
    status,
    executionStatus,
    qualityStatus,
    selectionOrigin: record.selectionOrigin === "manual_override" ? "manual_override" : "pipeline",
    fallback,
    shadowFailure,
    timings: {
      totalMs: Math.round(finiteNumber(timings?.totalMs, 0, 0, 3_600_000)),
      legacyMs: typeof timings?.legacyMs === "number" ? Math.round(finiteNumber(timings.legacyMs, 0, 0, 3_600_000)) : null,
      shadowMs: typeof timings?.shadowMs === "number" ? Math.round(finiteNumber(timings.shadowMs, 0, 0, 3_600_000)) : null,
    },
    actual,
    legacy: normalizeSummary(record.legacy, "legacy"),
    shadow: normalizeSummary(record.shadow, "shadow"),
    comparison: normalizeComparison(record.comparison),
  };
}

function sanitizeSelectorDiagnostics(record: SelectorPipelineDiagnostics): SelectorPipelineDiagnostics {
  const normalized = normalizeSelectorDiagnosticsRecord(record);
  if (!normalized) throw new Error("Selector diagnostics record failed local privacy validation.");
  return normalized;
}

export function normalizeSelectorDiagnosticsHistory(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeSelectorDiagnosticsRecord)
    .filter((record): record is SelectorPipelineDiagnostics => record !== null)
    .slice(0, SELECTOR_DIAGNOSTICS_HISTORY_LIMIT);
}

export async function getSelectorDiagnosticsHistory(): Promise<SelectorPipelineDiagnostics[]> {
  const value = await getSettingValue<unknown>(selectorDiagnosticsHistoryKey, []);
  return normalizeSelectorDiagnosticsHistory(value);
}

export async function appendSelectorDiagnostics(record: SelectorPipelineDiagnostics) {
  const history = await getSelectorDiagnosticsHistory();
  const next = [sanitizeSelectorDiagnostics(record), ...history]
    .slice(0, SELECTOR_DIAGNOSTICS_HISTORY_LIMIT);
  await storage.setSettingValue(selectorDiagnosticsHistoryKey, next);
  return next;
}

export async function clearSelectorDiagnosticsHistory() {
  await storage.setSettingValue(selectorDiagnosticsHistoryKey, []);
}

const contextEngineShadowDiagnosticsHistoryKey =
  "context_engine_shadow_diagnostics_history";
const contextEngineShadowHistory = createContextEngineShadowHistory({
  read: () =>
    getSettingValue<unknown>(contextEngineShadowDiagnosticsHistoryKey, []),
  write: (value) =>
    storage.setSettingValue(contextEngineShadowDiagnosticsHistoryKey, value),
  limit: 50,
});
const contextEngineShadowDiagnosticsWriter = createContextEngineShadowDiagnosticsWriter({
  persist: (record) => contextEngineShadowHistory.append(record),
  maxQueueLength: 50,
});

export function getContextEngineShadowDiagnosticsHistory(): Promise<ContextEngineShadowComparison[]> {
  return contextEngineShadowHistory.get();
}

export function appendContextEngineShadowDiagnostics(
  record: ContextEngineShadowComparison,
): Promise<ContextEngineShadowComparison[]> {
  return contextEngineShadowHistory.append(record);
}

export function enqueueContextEngineShadowDiagnostics(
  record: ContextEngineShadowComparison,
) {
  return contextEngineShadowDiagnosticsWriter.enqueue(record);
}

export function getContextEngineShadowDiagnosticsWriterState() {
  return contextEngineShadowDiagnosticsWriter.state();
}

export function flushContextEngineShadowDiagnostics(timeoutMs = 250): Promise<boolean> {
  return contextEngineShadowDiagnosticsWriter.flush(timeoutMs);
}

export function closeContextEngineShadowDiagnosticsWriter(timeoutMs = 250): Promise<boolean> {
  return contextEngineShadowDiagnosticsWriter.close(timeoutMs);
}

export async function closeContextEngineShadowRuntime(timeoutMs = 250): Promise<boolean> {
  const [executionsClosed, diagnosticsClosed] = await Promise.all([
    closeContextEngineShadowExecutionTracker(timeoutMs),
    closeContextEngineShadowDiagnosticsWriter(timeoutMs),
  ]);
  return executionsClosed && diagnosticsClosed;
}

const contextEngineTaskPackCanaryHistoryKey =
  "context_engine_task_pack_canary_history";
const contextEngineTaskPackCanaryHistory = createTaskPackCanaryHistory({
  read: () => getSettingValue<unknown>(contextEngineTaskPackCanaryHistoryKey, []),
  write: (value) => storage.setSettingValue(contextEngineTaskPackCanaryHistoryKey, value),
  limit: 50,
});
const contextEngineTaskPackCanaryWriter = createTaskPackCanaryDiagnosticsWriter({
  persist: (record) => contextEngineTaskPackCanaryHistory.append(record),
  maxQueueLength: 50,
});

export function getContextEngineTaskPackCanaryHistory(): Promise<TaskPackCanaryDecision[]> {
  return contextEngineTaskPackCanaryHistory.get();
}

export function enqueueContextEngineTaskPackCanaryDecision(record: TaskPackCanaryDecision) {
  return contextEngineTaskPackCanaryWriter.enqueue(record);
}

export function getContextEngineTaskPackCanaryWriterState() {
  return contextEngineTaskPackCanaryWriter.state();
}

export function clearContextEngineTaskPackCanaryHistory(): Promise<void> {
  return contextEngineTaskPackCanaryHistory.clear();
}

export async function closeContextEngineTaskPackCanaryRuntime(timeoutMs = 250): Promise<boolean> {
  const [executionsClosed, diagnosticsClosed] = await Promise.all([
    closeTaskPackCanaryExecutionTracker(timeoutMs),
    contextEngineTaskPackCanaryWriter.close(timeoutMs),
  ]);
  return executionsClosed && diagnosticsClosed;
}

export function closeContextComposerEngineRuntime(timeoutMs = 250): Promise<boolean> {
  return closeContextComposerExecutionTracker(timeoutMs);
}

export function clearContextEngineShadowDiagnosticsHistory(): Promise<void> {
  return contextEngineShadowHistory.clear();
}

export async function getOpenAiCompatibleApiKey(): Promise<string | null> {
  return getSettingValue(secretSettingKeys.openAiCompatibleApiKey, null);
}

export async function getGeminiApiKey(): Promise<string | null> {
  return getSettingValue(secretSettingKeys.geminiApiKey, null);
}

export async function getAnthropicApiKey(): Promise<string | null> {
  return getSettingValue(secretSettingKeys.anthropicApiKey, null);
}

export async function updateAppSettings(input: UpdateAppSettingsInput) {
  const {
    openAiCompatibleApiKey,
    openAiCompatibleApiKeyConfigured: _ignoredConfiguredFlag,
    clearOpenAiCompatibleApiKey,
    geminiApiKey,
    geminiApiKeyConfigured: _ignoredGeminiConfiguredFlag,
    clearGeminiApiKey,
    anthropicApiKey,
    anthropicApiKeyConfigured: _ignoredAnthropicConfiguredFlag,
    clearAnthropicApiKey,
    ...publicSettings
  } = input;

  const entries = Object.entries(publicSettings) as Array<
    [keyof AppSettings, AppSettings[keyof AppSettings]]
  >;

  for (const [key, value] of entries) {
    const databaseKey = settingKeyMap[key];

    await storage.setSettingValue(databaseKey, value);
  }

  if (
    typeof openAiCompatibleApiKey === "string" &&
    openAiCompatibleApiKey.trim()
  ) {
    await storage.setSettingValue(
      secretSettingKeys.openAiCompatibleApiKey,
      openAiCompatibleApiKey.trim(),
    );
  }

  if (clearOpenAiCompatibleApiKey) {
    await storage.setSettingValue(
      secretSettingKeys.openAiCompatibleApiKey,
      null,
    );
  }

  if (typeof geminiApiKey === "string" && geminiApiKey.trim()) {
    await storage.setSettingValue(
      secretSettingKeys.geminiApiKey,
      geminiApiKey.trim(),
    );
  }

  if (clearGeminiApiKey) {
    await storage.setSettingValue(secretSettingKeys.geminiApiKey, null);
  }

  if (typeof anthropicApiKey === "string" && anthropicApiKey.trim()) {
    await storage.setSettingValue(
      secretSettingKeys.anthropicApiKey,
      anthropicApiKey.trim(),
    );
  }

  if (clearAnthropicApiKey) {
    await storage.setSettingValue(secretSettingKeys.anthropicApiKey, null);
  }

  return getAppSettings();
}
