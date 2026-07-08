import fs from "node:fs/promises";
import path from "node:path";

import { config } from "../config/index.js";
import { storage } from "./index.js";
import { getWorkspaceBackupStats } from "./workspaceBackup.js";

export interface StorageAuditCount {
  key: string;
  label: string;
  count: number | null;
  status: "ready" | "planned" | "external" | "unknown";
  note: string;
}

export interface StorageAuditArtifact {
  key: string;
  label: string;
  path: string;
  exists: boolean;
  sizeBytes: number | null;
  role: string;
  migrationStatus: "primary" | "legacy" | "external" | "planned";
}

export interface StorageAuditGap {
  key: string;
  title: string;
  description: string;
  priority: "now" | "next" | "later";
}

export interface StorageAuditPlanStep {
  id: string;
  title: string;
  description: string;
  status: "done" | "current" | "next" | "later";
}

export interface StorageReleaseCheck {
  key: string;
  label: string;
  status: "pass" | "warning" | "fail";
  note: string;
}

export interface StorageReleaseReadiness {
  status: "ready" | "review" | "blocked";
  passed: number;
  warnings: number;
  failed: number;
  checks: StorageReleaseCheck[];
}

export interface StorageAuditSchema {
  currentVersion: number;
  latestVersion: number;
  status: "ready" | "needs_migration" | "unknown";
  pendingCount: number;
  appliedCount: number;
  latestMigration: {
    id: string;
    name: string;
    appliedAt: string;
  } | null;
}

export interface StorageAuditResult {
  generatedAt: string;
  driver: "sqlite" | "postgres";
  sqliteFirst: boolean;
  databasePath: string | null;
  databaseExists: boolean;
  databaseSizeBytes: number | null;
  workspaceRoot: string;
  schema: StorageAuditSchema | null;
  counts: StorageAuditCount[];
  artifacts: StorageAuditArtifact[];
  gaps: StorageAuditGap[];
  plan: StorageAuditPlanStep[];
  releaseReadiness: StorageReleaseReadiness;
  notes: string[];
}

async function fileStat(filePath: string) {
  try {
    const stat = await fs.stat(filePath);

    return {
      exists: true,
      sizeBytes: stat.size,
    };
  } catch {
    return {
      exists: false,
      sizeBytes: null,
    };
  }
}

function countArray(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

async function readRulesAndTemplatesCounts(storePath: string) {
  try {
    const raw = await fs.readFile(storePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    return {
      templates: countArray(parsed.templates),
      ruleItems: countArray(parsed.ruleItems),
      ruleProfiles: countArray(parsed.ruleProfiles),
      acceptanceCriteriaPresets: countArray(parsed.acceptanceCriteriaPresets),
    };
  } catch {
    return {
      templates: 0,
      ruleItems: 0,
      ruleProfiles: 0,
      acceptanceCriteriaPresets: 0,
    };
  }
}

function createReleaseReadiness(input: {
  sqliteFirst: boolean;
  databaseReady: boolean;
  schemaReady: boolean;
  rulesCatalogReady: boolean;
  backupExportReady: boolean;
  backupCreated: boolean;
}): StorageReleaseReadiness {
  const checks: StorageReleaseCheck[] = [
    {
      key: "sqlite_first",
      label: "SQLite-first storage",
      status: input.sqliteFirst ? "pass" : "fail",
      note: input.sqliteFirst
        ? "Normal desktop mode uses the local SQLite adapter."
        : "Switch STORAGE_DRIVER to sqlite before packaging desktop builds.",
    },
    {
      key: "database_ready",
      label: "Workspace database exists",
      status: input.databaseReady ? "pass" : "fail",
      note: input.databaseReady
        ? "The local workspace database is present."
        : "Run the app once with SQLite storage to create the local database.",
    },
    {
      key: "schema_ready",
      label: "Schema migrations are up to date",
      status: input.schemaReady ? "pass" : "fail",
      note: input.schemaReady
        ? "All known SQLite migrations are applied."
        : "Apply pending schema migrations before release checks.",
    },
    {
      key: "rules_catalog_ready",
      label: "Rules/templates are adapter-backed",
      status: input.rulesCatalogReady ? "pass" : "warning",
      note: input.rulesCatalogReady
        ? "Custom rules and templates are stored in the SQLite catalog."
        : "Rules/templates still depend on the legacy JSON catalog.",
    },
    {
      key: "backup_export_ready",
      label: "Workspace backup export is available",
      status: input.backupExportReady ? "pass" : "fail",
      note: input.backupExportReady
        ? "A local secret-safe JSON backup can be created from Settings."
        : "Add a workspace export flow before more storage migrations.",
    },
    {
      key: "backup_created",
      label: "At least one backup was created",
      status: input.backupCreated ? "pass" : "warning",
      note: input.backupCreated
        ? "A recent workspace backup exists."
        : "Create a backup before packaging or running destructive migration tests.",
    },
    {
      key: "restore_guarded",
      label: "Restore/import remains guarded",
      status: "warning",
      note: "Import/restore is intentionally not automatic yet; keep it as a separate guarded flow.",
    },
  ];

  const passed = checks.filter((check) => check.status === "pass").length;
  const warnings = checks.filter((check) => check.status === "warning").length;
  const failed = checks.filter((check) => check.status === "fail").length;

  return {
    status: failed > 0 ? "blocked" : warnings > 0 ? "review" : "ready",
    passed,
    warnings,
    failed,
    checks,
  };
}

export async function getStorageAudit(): Promise<StorageAuditResult> {
  const workspaceRoot = process.cwd();
  const sqlitePath = config.sqliteDatabasePath;
  const rulesStorePath = path.resolve(
    workspaceRoot,
    "data",
    "rules-and-templates.json",
  );
  const sqliteFile = await fileStat(sqlitePath);
  const rulesStoreFile = await fileStat(rulesStorePath);
  const projects = await storage.listProjects();
  const taskPacks = await storage.listTaskPacks();
  const memoryGroups = await Promise.all(
    projects.map((project) => storage.listProjectMemories(project.id)),
  );
  const projectMemoriesCount = memoryGroups.reduce(
    (total, memories) => total + memories.length,
    0,
  );
  const rulesCounts = await readRulesAndTemplatesCounts(rulesStorePath);
  const rulesCatalogStats = storage.getRulesAndTemplatesCatalogStats
    ? await storage.getRulesAndTemplatesCatalogStats()
    : null;
  const schemaInfo = storage.getSchemaInfo
    ? await storage.getSchemaInfo()
    : null;
  const backupStats = await getWorkspaceBackupStats();
  const latestMigration = schemaInfo?.appliedMigrations.at(-1) ?? null;
  const legacyRulesTotal =
    rulesCounts.templates +
    rulesCounts.ruleItems +
    rulesCounts.ruleProfiles +
    rulesCounts.acceptanceCriteriaPresets;
  const rulesTotal = rulesCatalogStats?.total ?? legacyRulesTotal;
  const rulesCatalogIsSqlite = Boolean(rulesCatalogStats);
  const releaseReadiness = createReleaseReadiness({
    sqliteFirst:
      config.storageDriver === "sqlite" && storage.driver === "sqlite",
    databaseReady: storage.driver === "sqlite" && sqliteFile.exists,
    schemaReady: schemaInfo?.status === "ready",
    rulesCatalogReady: rulesCatalogIsSqlite,
    backupExportReady: true,
    backupCreated: backupStats.count > 0,
  });

  return {
    generatedAt: new Date().toISOString(),
    driver: storage.driver,
    sqliteFirst: config.storageDriver === "sqlite",
    databasePath: storage.driver === "sqlite" ? sqlitePath : null,
    databaseExists: storage.driver === "sqlite" ? sqliteFile.exists : false,
    databaseSizeBytes:
      storage.driver === "sqlite" ? sqliteFile.sizeBytes : null,
    workspaceRoot,
    schema: schemaInfo
      ? {
          currentVersion: schemaInfo.currentVersion,
          latestVersion: schemaInfo.latestVersion,
          status: schemaInfo.status,
          pendingCount: schemaInfo.pendingCount,
          appliedCount: schemaInfo.appliedMigrations.length,
          latestMigration: latestMigration
            ? {
                id: latestMigration.id,
                name: latestMigration.name,
                appliedAt: latestMigration.appliedAt,
              }
            : null,
        }
      : null,
    counts: [
      {
        key: "projects",
        label: "Projects",
        count: projects.length,
        status: "ready",
        note: "Local project records are already stored through the active storage adapter.",
      },
      {
        key: "task_packs",
        label: "Task Packs",
        count: taskPacks.length,
        status: "ready",
        note: "Generated Task Pack history is already adapter-backed.",
      },
      {
        key: "project_memories",
        label: "Project Memory",
        count: projectMemoriesCount,
        status: "ready",
        note: "Decision log and long-term project notes are already adapter-backed.",
      },
      {
        key: "schema_migrations",
        label: "Schema migrations",
        count: schemaInfo?.appliedMigrations.length ?? null,
        status: schemaInfo?.status === "ready" ? "ready" : "unknown",
        note: schemaInfo
          ? `SQLite schema is versioned at v${schemaInfo.currentVersion} of v${schemaInfo.latestVersion}.`
          : "Schema migration metadata is not available for this adapter yet.",
      },
      {
        key: "rules_templates",
        label: "Rules & Templates",
        count: rulesTotal,
        status: rulesCatalogIsSqlite ? "ready" : "external",
        note: rulesCatalogIsSqlite
          ? "Custom templates and rule profiles are adapter-backed in the SQLite catalog; legacy JSON remains as a transition backup."
          : "Currently stored in a local JSON catalog; planned to migrate into SQLite tables.",
      },
      {
        key: "exports",
        label: "Report/export history",
        count: null,
        status: "planned",
        note: "Exports are generated as files; history and cleanup controls are planned.",
      },
      {
        key: "backups",
        label: "Workspace backups",
        count: backupStats.count,
        status: "ready",
        note: backupStats.latest
          ? `Latest backup: ${backupStats.latest.fileName}`
          : "Workspace export is available; no backups have been created yet.",
      },
    ],
    artifacts: [
      {
        key: "sqlite_database",
        label: "SQLite workspace database",
        path: sqlitePath,
        exists: sqliteFile.exists,
        sizeBytes: sqliteFile.sizeBytes,
        role: "Primary local persistence target for desktop mode.",
        migrationStatus: storage.driver === "sqlite" ? "primary" : "planned",
      },
      {
        key: "schema_migrations",
        label: "SQLite schema migration ledger",
        path: "schema_migrations / app_storage_metadata",
        exists: Boolean(schemaInfo),
        sizeBytes: null,
        role: "Records applied SQLite schema migrations and current storage metadata for safer upgrades.",
        migrationStatus: schemaInfo?.status === "ready" ? "primary" : "planned",
      },
      {
        key: "rules_templates_sqlite",
        label: "Rules/templates SQLite catalog",
        path: "rules_templates_catalog_items",
        exists: rulesCatalogIsSqlite,
        sizeBytes: null,
        role: "Adapter-backed catalog for custom templates, rule profiles, rule items and acceptance criteria presets.",
        migrationStatus: rulesCatalogIsSqlite ? "primary" : "planned",
      },
      {
        key: "rules_templates_json",
        label: "Rules/templates JSON catalog",
        path: rulesStorePath,
        exists: rulesStoreFile.exists,
        sizeBytes: rulesStoreFile.sizeBytes,
        role: rulesCatalogIsSqlite
          ? "Legacy transition backup for custom templates, rule profiles, rule items and acceptance criteria presets."
          : "Current local catalog for custom templates, rule profiles, rule items and acceptance criteria presets.",
        migrationStatus: rulesStoreFile.exists ? "legacy" : "planned",
      },
      {
        key: "workspace_backups",
        label: "Workspace backup directory",
        path: backupStats.directory,
        exists: backupStats.exists,
        sizeBytes: backupStats.sizeBytes,
        role: "Local JSON workspace backups created from Settings → Storage.",
        migrationStatus: "primary",
      },
      {
        key: "postgres_driver",
        label: "PostgreSQL adapter",
        path: "STORAGE_DRIVER=postgres",
        exists: config.storageDriver === "postgres",
        sizeBytes: null,
        role: "Developer/optional adapter. Not required for normal desktop use.",
        migrationStatus: "external",
      },
    ],
    gaps: [
      ...(rulesCatalogIsSqlite
        ? []
        : [
            {
              key: "rules_templates_sqlite",
              title: "Rules/templates still use JSON storage",
              description:
                "Custom templates and rule profiles should move into the existing SQLite tables before beta.",
              priority: "now" as const,
            },
          ]),
      {
        key: "workspace_restore",
        title: "Backup restore/import is intentionally guarded",
        description:
          "Workspace export is available now; import and safe restore should remain a separate confirmation-heavy flow.",
        priority: "later",
      },
    ],
    plan: [
      {
        id: "12.1.1",
        title: "Storage audit",
        description:
          "Map current local data, persistence gaps, and SQLite-first migration targets.",
        status: "done",
      },
      {
        id: "12.1.2",
        title: "SQLite schema and migration versioning",
        description:
          "Add explicit schema version metadata and prepare safe incremental migrations.",
        status: "done",
      },
      {
        id: "12.2.1",
        title: "Rules/templates SQLite catalog",
        description:
          "Move the custom rules/templates catalog from JSON into adapter-backed SQLite storage.",
        status: rulesCatalogIsSqlite ? "done" : "next",
      },
      {
        id: "12.3.1",
        title: "Workspace backup export",
        description:
          "Export local workspace data to a secret-safe JSON backup before later restore/import work.",
        status: "done",
      },
      {
        id: "12.4",
        title: "Release readiness checks",
        description:
          "Show a compact desktop readiness checklist before onboarding and later packaging work.",
        status: "done",
      },
    ],
    releaseReadiness,
    notes: [
      "Local-first remains the default: normal desktop usage should not require Docker or PostgreSQL.",
      "SQLite schema migration metadata is explicit; future storage changes can run as small incremental migrations.",
      "Custom rules/templates now have a SQLite catalog foundation; the legacy JSON file remains as a transition backup.",
      "Workspace backup export is available as a local JSON file; restore/import remains a later guarded workflow.",
      "Release readiness is now summarized as a compact checklist for desktop persistence work.",
      "Secrets and provider API keys are intentionally excluded from workspace backups.",
    ],
  };
}
