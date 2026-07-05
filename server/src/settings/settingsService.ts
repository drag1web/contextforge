import { config } from "../config/index.js";
import { storage } from "../storage/index.js";

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
  sidebarShowDescriptions: boolean;
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
  sidebarShowDescriptions: false,
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
  sidebarShowDescriptions: "sidebar_show_descriptions",
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
    sidebarShowDescriptions: await getSettingValue(
      settingKeyMap.sidebarShowDescriptions,
      defaultSettings.sidebarShowDescriptions,
    ),
  };
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
