import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { config } from "../config/index.js";
import type { RulesAndTemplatesStore } from "../rules/types.js";
import { storage } from "./index.js";
import { getWorkspaceBackupDirectory } from "./storageBackupPaths.js";
import { WORKSPACE_BACKUP_FORMAT, WORKSPACE_BACKUP_SAFE_SETTING_KEYS, type WorkspaceBackupV2 } from "./workspaceBackupFormat.js";
import { parseWorkspaceBackup } from "./workspaceBackupReader.js";
import type { TaskPackJsonValue } from "../taskPacks/taskPackLifecycle.js";

export interface WorkspaceBackupExportResult {
  fileName: string;
  filePath: string;
  sizeBytes: number;
  createdAt: string;
  counts: WorkspaceBackupV2["counts"];
  included: string[];
  excluded: string[];
  warnings: string[];
}

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

function makeBackupFileName(createdAt: string) {
  const safeTimestamp = createdAt.replace(/[:.]/g, "-");
  // Millisecond timestamps alone collide under simultaneous export requests.
  return `contextforge-workspace-backup-${safeTimestamp}-${randomUUID()}.json`;
}

async function collectSafeSettings(): Promise<WorkspaceBackupV2["data"]["safeSettings"]> {
  const settings = {} as Record<typeof WORKSPACE_BACKUP_SAFE_SETTING_KEYS[number], TaskPackJsonValue>;

  for (const key of WORKSPACE_BACKUP_SAFE_SETTING_KEYS) {
    settings[key] = await storage.getSettingValue<TaskPackJsonValue>(key, null);
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
  const snapshot = await storage.getWorkspaceBackupSnapshot();
  const rulesAndTemplates = storage.readRulesAndTemplatesCatalog
    ? await storage.readRulesAndTemplatesCatalog()
    : null;
  const schema = storage.getSchemaInfo ? await storage.getSchemaInfo() : null;
  const safeSettings = await collectSafeSettings();
  const included = [
    "projects",
    "taskPackAggregates",
    "taskPackRevisions",
    "taskPackLifecycleEvents",
    "taskPackReviewEvents",
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
    "standaloneGitHubRepositoryLinks",
    "standaloneTaskPackGitHubCreatedIssueLinks",
    "persistedTaskPackDrafts",
    "node_modules",
    "projectSourceFiles"
  ];
  const warnings = [
    "This private local backup preserves complete authored and historical content, which may contain sensitive information entered or generated during use.",
    "Dedicated provider credentials/endpoints and standalone GitHub auth, account and link stores are excluded; historical GitHub provenance embedded in immutable Task Pack content is preserved.",
    "Project source files are not copied; projects are referenced by their local paths.",
    "Restore/import is not implemented in this foundation stage yet."
  ];

  const payload: WorkspaceBackupV2 = {
    format: WORKSPACE_BACKUP_FORMAT,
    formatVersion: 2,
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
      projects: snapshot.projects.length,
      taskPacks: snapshot.taskPackAggregates.length,
      revisions: snapshot.taskPackRevisions.length,
      lifecycleEvents: snapshot.taskPackLifecycleEvents.length,
      reviewEvents: snapshot.taskPackReviewEvents.length,
      projectMemories: snapshot.projectMemory.reduce(
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
      ...snapshot,
      rulesAndTemplates,
      safeSettings
    }
  };

  // Validate the exact bytes to be published, not a repaired/second projection.
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  if (parseWorkspaceBackup(serialized).formatVersion !== 2) throw new Error("Workspace backup version is invalid.");
  const backupsDir = getWorkspaceBackupDirectory();
  await fs.mkdir(backupsDir, { recursive: true });

  const fileName = makeBackupFileName(createdAt);
  const filePath = path.join(backupsDir, fileName);
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  let temporaryOwned = false;
  try {
    handle = await fs.open(temporaryPath, "wx");
    temporaryOwned = true;
    await handle.writeFile(serialized, "utf8");
    await handle.close();
    handle = null;
    await fs.rename(temporaryPath, filePath);
    temporaryOwned = false;
    const stat = await fs.stat(filePath);
    return { fileName, filePath, sizeBytes: stat.size, createdAt, counts: payload.counts, included, excluded, warnings };
  } catch (error) {
    if (handle) try { await handle.close(); } catch { /* Preserve original failure. */ }
    if (temporaryOwned) try { await fs.unlink(temporaryPath); } catch { /* Best-effort cleanup, never mask the failure. */ }
    throw error;
  }
}

export async function getWorkspaceBackupStats() {
  const backupsDir = getWorkspaceBackupDirectory();

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
