import { config } from "../config/index.js";
import { pool } from "../db/pool.js";

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
}

const defaultSettings: AppSettings = {
  ollamaUrl: config.ollamaUrl,
  generationMode: "template",
  defaultTargetTool: "codex",
  defaultTaskType: "general",
  defaultOllamaModel: null
};

const settingKeyMap = {
  ollamaUrl: "ollama_url",
  generationMode: "generation_mode",
  defaultTargetTool: "default_target_tool",
  defaultTaskType: "default_task_type",
  defaultOllamaModel: "default_ollama_model"
} as const;

export async function getSettingValue<T>(key: string, fallback: T): Promise<T> {
  const result = await pool.query(
    `
    SELECT value
    FROM app_settings
    WHERE key = $1;
    `,
    [key]
  );

  if (result.rowCount === 0) {
    return fallback;
  }

  return result.rows[0].value as T;
}

export async function getAppSettings(): Promise<AppSettings> {
  return {
    ollamaUrl: await getSettingValue(settingKeyMap.ollamaUrl, defaultSettings.ollamaUrl),
    generationMode: await getSettingValue(settingKeyMap.generationMode, defaultSettings.generationMode),
    defaultTargetTool: await getSettingValue(settingKeyMap.defaultTargetTool, defaultSettings.defaultTargetTool),
    defaultTaskType: await getSettingValue(settingKeyMap.defaultTaskType, defaultSettings.defaultTaskType),
    defaultOllamaModel: await getSettingValue(settingKeyMap.defaultOllamaModel, defaultSettings.defaultOllamaModel)
  };
}

export async function updateAppSettings(input: Partial<AppSettings>) {
  const entries = Object.entries(input) as Array<
    [keyof AppSettings, AppSettings[keyof AppSettings]]
  >;

  for (const [key, value] of entries) {
    const databaseKey = settingKeyMap[key];

    await pool.query(
      `
      INSERT INTO app_settings (key, value, updated_at)
      VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (key)
      DO UPDATE SET
        value = EXCLUDED.value,
        updated_at = NOW();
      `,
      [databaseKey, JSON.stringify(value)]
    );
  }

  return getAppSettings();
}
