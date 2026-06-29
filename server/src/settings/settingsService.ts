import { config } from "../config/index.js";
import { storage } from "../storage/index.js";

export interface AppSettings {
  ollamaUrl: string;
  generationMode: "template" | "ollama";
  defaultTargetTool: "codex" | "cursor" | "claude" | "generic";
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
  language: "system" | "en" | "ru";
  composerFileLimits: ComposerFileLimits;
  contextQualityMode: ContextQualityMode;
  sidebarShowDescriptions: boolean;
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
  defaultTargetTool: "codex",
  defaultTaskType: "general",
  defaultOllamaModel: null,
  language: "system",
  composerFileLimits: {
    default: 8,
    ui: 7,
    backend: 8,
    fullstack: 10,
    build: 7,
    bugfix: 7,
    refactor: 8,
    docs: 6,
    tests: 7
  },
  contextQualityMode: "balanced",
  sidebarShowDescriptions: false
};

const settingKeyMap = {
  ollamaUrl: "ollama_url",
  generationMode: "generation_mode",
  defaultTargetTool: "default_target_tool",
  defaultTaskType: "default_task_type",
  defaultOllamaModel: "default_ollama_model",
  language: "language",
  composerFileLimits: "composer_file_limits",
  contextQualityMode: "context_quality_mode",
  sidebarShowDescriptions: "sidebar_show_descriptions"
} as const;

export async function getSettingValue<T>(key: string, fallback: T): Promise<T> {
  return storage.getSettingValue(key, fallback);
}

export async function getAppSettings(): Promise<AppSettings> {
  return {
    ollamaUrl: await getSettingValue(settingKeyMap.ollamaUrl, defaultSettings.ollamaUrl),
    generationMode: await getSettingValue(settingKeyMap.generationMode, defaultSettings.generationMode),
    defaultTargetTool: await getSettingValue(settingKeyMap.defaultTargetTool, defaultSettings.defaultTargetTool),
    defaultTaskType: await getSettingValue(settingKeyMap.defaultTaskType, defaultSettings.defaultTaskType),
    defaultOllamaModel: await getSettingValue(settingKeyMap.defaultOllamaModel, defaultSettings.defaultOllamaModel),
    language: await getSettingValue(settingKeyMap.language, defaultSettings.language),
    composerFileLimits: await getSettingValue(
      settingKeyMap.composerFileLimits,
      defaultSettings.composerFileLimits
    ),
    contextQualityMode: await getSettingValue(
      settingKeyMap.contextQualityMode,
      defaultSettings.contextQualityMode
    ),
    sidebarShowDescriptions: await getSettingValue(
      settingKeyMap.sidebarShowDescriptions,
      defaultSettings.sidebarShowDescriptions
    )
  };
}

export async function updateAppSettings(input: Partial<AppSettings>) {
  const entries = Object.entries(input) as Array<
    [keyof AppSettings, AppSettings[keyof AppSettings]]
  >;

  for (const [key, value] of entries) {
    const databaseKey = settingKeyMap[key];

    await storage.setSettingValue(databaseKey, value);
  }

  return getAppSettings();
}
