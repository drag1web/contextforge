import fs from "node:fs/promises";
import path from "node:path";

import { config } from "../config/index.js";
import type { RulesAndTemplatesStore } from "../rules/types.js";
import { storage } from "./index.js";

export interface WorkspaceBackupExportResult {
  fileName: string;
  filePath: string;
  sizeBytes: number;
  createdAt: string;
  counts: {
    projects: number;
    taskPacks: number;
    projectMemories: number;
    ruleTemplates: number;
    settings: number;
  };
  included: string[];
  excluded: string[];
  warnings: string[];
}

type SafeSettingsSnapshot = Record<string, unknown>;

const BACKUP_FORMAT = "contextforge.workspace.backup";
const BACKUP_FORMAT_VERSION = 1;

const SAFE_SETTING_KEYS = [
  "generation_mode",
  "ai_provider",
  "default_target_tool",
  "default_task_type",
  "default_ollama_model",
  "language",
  "theme",
  "composer_file_limits",
  "sidebar_show_descriptions"
] as const;

const EXCLUDED_SETTINGS = [
  "openai_compatible_api_key",
  "gemini_api_key",
  "openai_compatible_base_url",
  "gemini_base_url",
  "ollama_url",
  "github_access_token",
  "github_token_scope",
  "github_user_login",
  "github_user_avatar_url",
  "github_user_html_url",
  "github_connected_at",
  "github_last_checked_at"
];

function backupDirectory() {
  return path.resolve(process.cwd(), "data", "backups");
}

function makeBackupFileName(createdAt: string) {
  const safeTimestamp = createdAt.replace(/[:.]/g, "-");
  return `contextforge-workspace-backup-${safeTimestamp}.json`;
}

async function collectProjectMemories(projects: Array<{ id: number }>) {
  const entries = await Promise.all(
    projects.map(async (project) => ({
      projectId: project.id,
      memories: await storage.listProjectMemories(project.id)
    }))
  );

  return entries;
}

async function collectSafeSettings(): Promise<SafeSettingsSnapshot> {
  const settings: SafeSettingsSnapshot = {};

  for (const key of SAFE_SETTING_KEYS) {
    settings[key] = await storage.getSettingValue<unknown>(key, null);
  }

  return settings;
}

function countRulesAndTemplates(store: RulesAndTemplatesStore) {
  return (
    store.templates.length +
    store.ruleItems.length +
    store.ruleProfiles.length +
    store.acceptanceCriteriaPresets.length
  );
}

export async function exportWorkspaceBackup(): Promise<WorkspaceBackupExportResult> {
  const createdAt = new Date().toISOString();
  const projects = await storage.listProjects();
  const taskPacks = await storage.listTaskPacks();
  const projectMemory = await collectProjectMemories(projects);
  const rulesAndTemplates = storage.readRulesAndTemplatesCatalog
    ? await storage.readRulesAndTemplatesCatalog()
    : null;
  const schema = storage.getSchemaInfo ? await storage.getSchemaInfo() : null;
  const safeSettings = await collectSafeSettings();
  const included = [
    "projects",
    "taskPacks",
    "projectMemory",
    "rulesAndTemplates",
    "safeSettings",
    "schemaMetadata"
  ];
  const excluded = [
    "providerApiKeys",
    "providerBaseUrls",
    ...EXCLUDED_SETTINGS.map((key) => `setting:${key}`),
    "rawLocalDiffs",
    "GitHubTokens",
    "GitHubAccountMetadata",
    "GitHubRepositoryLinks",
    "node_modules",
    "projectSourceFiles"
  ];
  const warnings = [
    "Provider API keys, endpoint URLs, GitHub auth data and GitHub repository links are intentionally excluded from this backup.",
    "Project source files are not copied; projects are referenced by their local paths.",
    "Restore/import is not implemented in this foundation stage yet."
  ];

  const payload = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion: config.appVersion,
    exportedAt: createdAt,
    storage: {
      driver: storage.driver,
      sqliteFirst: config.storageDriver === "sqlite",
      schema: schema
        ? {
            currentVersion: schema.currentVersion,
            latestVersion: schema.latestVersion,
            status: schema.status,
            appliedMigrations: schema.appliedMigrations.map((migration) => ({
              id: migration.id,
              version: migration.version,
              name: migration.name,
              appliedAt: migration.appliedAt
            }))
          }
        : null
    },
    counts: {
      projects: projects.length,
      taskPacks: taskPacks.length,
      projectMemories: projectMemory.reduce(
        (total, item) => total + item.memories.length,
        0
      ),
      ruleTemplates: rulesAndTemplates ? countRulesAndTemplates(rulesAndTemplates) : 0,
      settings: Object.keys(safeSettings).length
    },
    included,
    excluded,
    warnings,
    data: {
      projects,
      taskPacks,
      projectMemory,
      rulesAndTemplates,
      safeSettings
    }
  };

  const backupsDir = backupDirectory();
  await fs.mkdir(backupsDir, { recursive: true });

  const fileName = makeBackupFileName(createdAt);
  const filePath = path.join(backupsDir, fileName);
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  const stat = await fs.stat(filePath);

  return {
    fileName,
    filePath,
    sizeBytes: stat.size,
    createdAt,
    counts: payload.counts,
    included,
    excluded,
    warnings
  };
}

export async function getWorkspaceBackupStats() {
  const backupsDir = backupDirectory();

  try {
    const entries = await fs.readdir(backupsDir, { withFileTypes: true });
    const backupFiles = entries.filter(
      (entry) => entry.isFile() && entry.name.endsWith(".json")
    );
    const stats = await Promise.all(
      backupFiles.map(async (entry) => {
        const filePath = path.join(backupsDir, entry.name);
        const stat = await fs.stat(filePath);

        return {
          fileName: entry.name,
          filePath,
          sizeBytes: stat.size,
          createdAt: stat.birthtime.toISOString(),
          modifiedAt: stat.mtime.toISOString()
        };
      })
    );

    const latest = stats
      .slice()
      .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))[0] ?? null;

    return {
      directory: backupsDir,
      exists: true,
      count: stats.length,
      latest,
      sizeBytes: stats.reduce((total, item) => total + item.sizeBytes, 0)
    };
  } catch {
    return {
      directory: backupsDir,
      exists: false,
      count: 0,
      latest: null,
      sizeBytes: null
    };
  }
}
