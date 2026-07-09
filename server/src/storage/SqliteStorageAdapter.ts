import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import initSqlJs from "sql.js";
import type { Database, SqlJsStatic, SqlValue } from "sql.js";

import type { ScannedProject } from "../scanner/projectScanner.js";
import type { RulesAndTemplatesStore } from "../rules/types.js";
import { parseJsonValue, stringifyJsonValue } from "./json.js";
import { SQLITE_MIGRATIONS, SQLITE_SCHEMA_VERSION } from "./migrations.js";
import type {
  CreateProjectMemoryInput,
  CreateTaskPackInput,
  ProjectMemoryRecord,
  ProjectRecord,
  StorageAdapter,
  RulesAndTemplatesCatalogStats,
  StorageHealth,
  StorageSchemaInfo,
  TaskPackRecord,
  UpdateProjectMemoryInput
} from "./types.js";

type BindValue = SqlValue;

type ProjectRow = {
  id: number;
  name: string;
  local_path: string;
  package_manager: string | null;
  detected_stack: string;
  scripts: string;
  readiness_score: number;
  readiness_report: string;
  created_at: string;
  updated_at: string;
  last_scan_at: string | null;
};

type TaskPackRow = {
  id: number;
  project_id: number;
  project_name?: string;
  title: string;
  raw_task: string;
  task_type: string;
  target_tool: string;
  generated_prompt: string;
  generation_mode: "template" | "ollama" | null;
  generation_model: string | null;
  generation_message: string | null;
  generation_used_fallback: number | boolean | null;
  generation_duration_ms: number | null;
  generation_recipe: string | null;
  created_at: string;
  updated_at: string;
};


type ProjectMemoryRow = {
  id: number;
  project_id: number;
  title: string;
  content: string;
  category: ProjectMemoryRecord["category"];
  is_enabled: number | boolean;
  created_at: string;
  updated_at: string;
};

const defaultReadinessReport = { score: 0, checks: [], issues: [] };
const require = createRequire(import.meta.url);

function nowIso() {
  return new Date().toISOString();
}

function getSqlJsDistPath() {
  return path.dirname(require.resolve("sql.js/dist/sql-wasm.js"));
}

function mapProjectRow(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    localPath: row.local_path,
    packageManager: row.package_manager,
    detectedStack: parseJsonValue<string[]>(row.detected_stack, []),
    scripts: parseJsonValue<Record<string, string>>(row.scripts, {}),
    readinessScore: row.readiness_score,
    readinessReport: parseJsonValue(row.readiness_report, defaultReadinessReport),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastScanAt: row.last_scan_at
  };
}

function mapTaskPackRow(row: TaskPackRow): TaskPackRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    title: row.title,
    rawTask: row.raw_task,
    taskType: row.task_type,
    targetTool: row.target_tool,
    generatedPrompt: row.generated_prompt,
    generationMode: row.generation_mode ?? "template",
    generationModel: row.generation_model,
    generationMessage: row.generation_message,
    generationUsedFallback: Boolean(row.generation_used_fallback),
    generationDurationMs: row.generation_duration_ms,
    generationRecipe: parseJsonValue(row.generation_recipe, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapProjectMemoryRow(row: ProjectMemoryRow): ProjectMemoryRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    content: row.content,
    category: row.category ?? "custom",
    isEnabled: Boolean(row.is_enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}


type RulesCatalogKind =
  | "template"
  | "rule_item"
  | "rule_profile"
  | "acceptance_criteria_preset";

type RulesCatalogRow = {
  id: string;
  kind: RulesCatalogKind;
  payload: string;
  created_at: string;
  updated_at: string;
};

const EMPTY_RULES_AND_TEMPLATES_STORE: RulesAndTemplatesStore = {
  version: 1,
  templates: [],
  ruleItems: [],
  ruleProfiles: [],
  acceptanceCriteriaPresets: []
};

function countRulesCatalog(store: RulesAndTemplatesStore): RulesAndTemplatesCatalogStats {
  const templates = store.templates.length;
  const ruleItems = store.ruleItems.length;
  const ruleProfiles = store.ruleProfiles.length;
  const acceptanceCriteriaPresets = store.acceptanceCriteriaPresets.length;

  return {
    source: "sqlite",
    importedFromJson: false,
    templates,
    ruleItems,
    ruleProfiles,
    acceptanceCriteriaPresets,
    total: templates + ruleItems + ruleProfiles + acceptanceCriteriaPresets
  };
}

function storeHasRulesCatalogData(store: RulesAndTemplatesStore) {
  return (
    store.templates.length +
      store.ruleItems.length +
      store.ruleProfiles.length +
      store.acceptanceCriteriaPresets.length >
    0
  );
}

export class SqliteStorageAdapter implements StorageAdapter {
  readonly driver = "sqlite" as const;

  private sqlJs: SqlJsStatic | null = null;
  private db: Database | null = null;

  constructor(private readonly databasePath: string) {}

  async ensureSchema() {
    const db = await this.getDatabase();

    db.run(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_storage_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        local_path TEXT NOT NULL UNIQUE,
        package_manager TEXT,
        detected_stack TEXT NOT NULL DEFAULT '[]',
        scripts TEXT NOT NULL DEFAULT '{}',
        readiness_score INTEGER NOT NULL DEFAULT 0,
        readiness_report TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_scan_at TEXT
      );

      CREATE TABLE IF NOT EXISTS task_packs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        raw_task TEXT NOT NULL,
        task_type TEXT NOT NULL DEFAULT 'general',
        target_tool TEXT NOT NULL DEFAULT 'generic',
        generated_prompt TEXT NOT NULL,
        generation_mode TEXT NOT NULL DEFAULT 'template',
        generation_model TEXT,
        generation_message TEXT,
        generation_used_fallback INTEGER NOT NULL DEFAULT 0,
        generation_duration_ms INTEGER,
        generation_recipe TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS project_scans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        summary TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS prompt_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER,
        name TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS rule_profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER,
        name TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS rule_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (profile_id) REFERENCES rule_profiles(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS acceptance_criteria_presets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER,
        name TEXT NOT NULL,
        criteria TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS project_memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'custom',
        priority TEXT NOT NULL DEFAULT 'normal',
        is_enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS file_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        scan_id INTEGER,
        file_path TEXT NOT NULL,
        size INTEGER,
        modified_at TEXT,
        hash TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (scan_id) REFERENCES project_scans(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS sync_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_type TEXT NOT NULL,
        item_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    await this.runMigrations();

    this.insertDefaultSetting("ollama_url", "http://localhost:11434");
    this.insertDefaultSetting("generation_mode", "template");
    this.insertDefaultSetting("ai_provider", "ollama");
    this.insertDefaultSetting("default_target_tool", "codex");
    this.insertDefaultSetting("default_task_type", "general");
    this.insertDefaultSetting("default_ollama_model", null);
    this.insertDefaultSetting("openai_compatible_base_url", "http://localhost:1234/v1");
    this.insertDefaultSetting("openai_compatible_model", null);
    this.insertDefaultSetting("openai_compatible_api_key", null);
    this.insertDefaultSetting("gemini_base_url", "https://generativelanguage.googleapis.com/v1beta");
    this.insertDefaultSetting("gemini_model", "gemini-1.5-flash");
    this.insertDefaultSetting("gemini_api_key", null);
    this.insertDefaultSetting("language", "system");
    this.insertDefaultSetting("theme", "dark");
    this.insertDefaultSetting("composer_file_limits", {
      default: 8,
      ui: 7,
      backend: 8,
      fullstack: 10,
      build: 7,
      bugfix: 7,
      refactor: 8,
      docs: 6,
      tests: 7
    });
    this.insertDefaultSetting("sidebar_show_descriptions", false);
    this.persist();
  }

  async health(): Promise<StorageHealth> {
    const row = await this.getOne<Record<string, unknown>>("SELECT 1 AS ok;");

    return {
      ok: true,
      driver: this.driver,
      database: {
        ...(row ?? { ok: 1 }),
        path: this.databasePath
      }
    };
  }

  async listProjects(): Promise<ProjectRecord[]> {
    const rows = await this.getAll<ProjectRow>(`
      SELECT *
      FROM projects
      ORDER BY updated_at DESC;
    `);

    return rows.map(mapProjectRow);
  }

  async getProjectById(projectId: number): Promise<ProjectRecord | null> {
    const row = await this.getOne<ProjectRow>(
      `
      SELECT *
      FROM projects
      WHERE id = ?;
      `,
      [projectId]
    );

    return row ? mapProjectRow(row) : null;
  }

  async upsertScannedProject(project: ScannedProject): Promise<ProjectRecord> {
    const timestamp = nowIso();
    const existing = await this.getOne<{ id: number; created_at: string }>(
      "SELECT id, created_at FROM projects WHERE local_path = ?;",
      [project.localPath]
    );

    if (existing) {
      await this.run(
        `
        UPDATE projects
        SET
          name = ?,
          package_manager = ?,
          detected_stack = ?,
          scripts = ?,
          readiness_score = ?,
          readiness_report = ?,
          updated_at = ?,
          last_scan_at = ?
        WHERE id = ?;
        `,
        [
          project.name,
          project.packageManager,
          stringifyJsonValue(project.detectedStack),
          stringifyJsonValue(project.scripts),
          project.readinessScore,
          stringifyJsonValue(project.readinessReport),
          timestamp,
          timestamp,
          existing.id
        ],
        true
      );

      const updatedProject = await this.getProjectById(existing.id);

      if (!updatedProject) {
        throw new Error("Failed to read updated project from SQLite.");
      }

      return updatedProject;
    }

    await this.run(
      `
      INSERT INTO projects (
        name,
        local_path,
        package_manager,
        detected_stack,
        scripts,
        readiness_score,
        readiness_report,
        created_at,
        updated_at,
        last_scan_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `,
      [
        project.name,
        project.localPath,
        project.packageManager,
        stringifyJsonValue(project.detectedStack),
        stringifyJsonValue(project.scripts),
        project.readinessScore,
        stringifyJsonValue(project.readinessReport),
        timestamp,
        timestamp,
        timestamp
      ],
      true
    );

    const createdRow = await this.getOne<ProjectRow>(
      "SELECT * FROM projects WHERE local_path = ?;",
      [project.localPath]
    );

    if (!createdRow) {
      throw new Error("Failed to read created project from SQLite.");
    }

    return mapProjectRow(createdRow);
  }

  async listTaskPacks(): Promise<TaskPackRecord[]> {
    const rows = await this.getAll<TaskPackRow>(`
      SELECT
        tp.*,
        p.name AS project_name
      FROM task_packs tp
      JOIN projects p ON p.id = tp.project_id
      ORDER BY tp.created_at DESC;
    `);

    return rows.map(mapTaskPackRow);
  }


  async getTaskPackById(taskPackId: number): Promise<TaskPackRecord | null> {
    const row = await this.getOne<TaskPackRow>(
      `
      SELECT
        tp.*,
        p.name AS project_name
      FROM task_packs tp
      JOIN projects p ON p.id = tp.project_id
      WHERE tp.id = ?;
      `,
      [taskPackId]
    );

    return row ? mapTaskPackRow(row) : null;
  }

  async createTaskPack(input: CreateTaskPackInput): Promise<TaskPackRecord> {
    const timestamp = nowIso();

    await this.run(
      `
      INSERT INTO task_packs (
        project_id,
        title,
        raw_task,
        task_type,
        target_tool,
        generated_prompt,
        generation_mode,
        generation_model,
        generation_message,
        generation_used_fallback,
        generation_duration_ms,
        generation_recipe,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `,
      [
        input.projectId,
        input.title,
        input.rawTask,
        input.taskType,
        input.targetTool,
        input.generatedPrompt,
        input.generationMode,
        input.generationModel,
        input.generationMessage,
        input.generationUsedFallback ? 1 : 0,
        input.generationDurationMs ?? null,
        stringifyJsonValue(input.generationRecipe ?? null),
        timestamp,
        timestamp
      ],
      false
    );

    const createdTaskPackId = await this.getLastInsertRowId();
    this.persist();

    const row = await this.getOne<TaskPackRow>(
      `
      SELECT
        tp.*,
        p.name AS project_name
      FROM task_packs tp
      JOIN projects p ON p.id = tp.project_id
      WHERE tp.id = ?;
      `,
      [createdTaskPackId]
    );

    if (!row) {
      throw new Error("Failed to read created task pack from SQLite.");
    }

    return mapTaskPackRow(row);
  }


  async updateTaskPackGenerationRecipe(
    taskPackId: number,
    generationRecipe: unknown | null
  ): Promise<TaskPackRecord | null> {
    const timestamp = nowIso();

    await this.run(
      `
      UPDATE task_packs
      SET generation_recipe = ?, updated_at = ?
      WHERE id = ?;
      `,
      [stringifyJsonValue(generationRecipe ?? null), timestamp, taskPackId],
      false
    );

    this.persist();

    return this.getTaskPackById(taskPackId);
  }

  async listProjectMemories(projectId: number): Promise<ProjectMemoryRecord[]> {
    const rows = await this.getAll<ProjectMemoryRow>(
      `
      SELECT *
      FROM project_memories
      WHERE project_id = ?
      ORDER BY is_enabled DESC, updated_at DESC, id DESC;
      `,
      [projectId]
    );

    return rows.map(mapProjectMemoryRow);
  }

  async createProjectMemory(input: CreateProjectMemoryInput): Promise<ProjectMemoryRecord> {
    const timestamp = nowIso();

    await this.run(
      `
      INSERT INTO project_memories (
        project_id,
        title,
        content,
        category,
        is_enabled,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?);
      `,
      [
        input.projectId,
        input.title,
        input.content,
        input.category,
        input.isEnabled === false ? 0 : 1,
        timestamp,
        timestamp
      ],
      false
    );

    const memoryId = await this.getLastInsertRowId();
    this.persist();

    const row = await this.getOne<ProjectMemoryRow>(
      `
      SELECT *
      FROM project_memories
      WHERE id = ? AND project_id = ?;
      `,
      [memoryId, input.projectId]
    );

    if (!row) {
      throw new Error("Failed to read created project memory from SQLite.");
    }

    return mapProjectMemoryRow(row);
  }

  async updateProjectMemory(
    projectId: number,
    memoryId: number,
    input: UpdateProjectMemoryInput
  ): Promise<ProjectMemoryRecord | null> {
    const existing = await this.getOne<ProjectMemoryRow>(
      `
      SELECT *
      FROM project_memories
      WHERE id = ? AND project_id = ?;
      `,
      [memoryId, projectId]
    );

    if (!existing) {
      return null;
    }

    await this.run(
      `
      UPDATE project_memories
      SET
        title = ?,
        content = ?,
        category = ?,
        is_enabled = ?,
        updated_at = ?
      WHERE id = ? AND project_id = ?;
      `,
      [
        input.title ?? existing.title,
        input.content ?? existing.content,
        input.category ?? existing.category,
        typeof input.isEnabled === "boolean"
          ? input.isEnabled ? 1 : 0
          : existing.is_enabled ? 1 : 0,
        nowIso(),
        memoryId,
        projectId
      ],
      true
    );

    const updated = await this.getOne<ProjectMemoryRow>(
      `
      SELECT *
      FROM project_memories
      WHERE id = ? AND project_id = ?;
      `,
      [memoryId, projectId]
    );

    return updated ? mapProjectMemoryRow(updated) : null;
  }

  async deleteProjectMemory(projectId: number, memoryId: number): Promise<boolean> {
    const existing = await this.getOne<{ id: number }>(
      `
      SELECT id
      FROM project_memories
      WHERE id = ? AND project_id = ?;
      `,
      [memoryId, projectId]
    );

    if (!existing) {
      return false;
    }

    await this.run(
      `
      DELETE FROM project_memories
      WHERE id = ? AND project_id = ?;
      `,
      [memoryId, projectId],
      true
    );

    return true;
  }

  async getSettingValue<T>(key: string, fallback: T): Promise<T> {
    const row = await this.getOne<{ value: string }>(
      "SELECT value FROM app_settings WHERE key = ?;",
      [key]
    );

    if (!row) {
      return fallback;
    }

    return parseJsonValue(row.value, fallback);
  }

  async setSettingValue(key: string, value: unknown): Promise<void> {
    await this.run(
      `
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key)
      DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at;
      `,
      [key, stringifyJsonValue(value), nowIso()],
      true
    );
  }


  async readRulesAndTemplatesCatalog(): Promise<RulesAndTemplatesStore> {
    await this.ensureSchema();

    const rows = await this.getAll<RulesCatalogRow>(`
      SELECT id, kind, payload, created_at, updated_at
      FROM rules_templates_catalog_items
      ORDER BY kind ASC, updated_at DESC, id ASC;
    `);

    const store: RulesAndTemplatesStore = {
      ...EMPTY_RULES_AND_TEMPLATES_STORE,
      templates: [],
      ruleItems: [],
      ruleProfiles: [],
      acceptanceCriteriaPresets: []
    };

    for (const row of rows) {
      const payload = parseJsonValue<Record<string, unknown> | null>(row.payload, null);

      if (!payload || typeof payload.id !== "string") {
        continue;
      }

      if (row.kind === "template") {
        store.templates.push(payload as unknown as RulesAndTemplatesStore["templates"][number]);
      }

      if (row.kind === "rule_item") {
        store.ruleItems.push(payload as unknown as RulesAndTemplatesStore["ruleItems"][number]);
      }

      if (row.kind === "rule_profile") {
        store.ruleProfiles.push(payload as unknown as RulesAndTemplatesStore["ruleProfiles"][number]);
      }

      if (row.kind === "acceptance_criteria_preset") {
        store.acceptanceCriteriaPresets.push(
          payload as unknown as RulesAndTemplatesStore["acceptanceCriteriaPresets"][number]
        );
      }
    }

    return store;
  }

  async writeRulesAndTemplatesCatalog(store: RulesAndTemplatesStore): Promise<void> {
    await this.ensureSchema();
    await this.run("DELETE FROM rules_templates_catalog_items;", [], false);

    const writeItem = async (
      kind: RulesCatalogKind,
      item: { id: string; createdAt?: string; updatedAt?: string }
    ) => {
      const timestamp = nowIso();

      await this.run(
        `
        INSERT INTO rules_templates_catalog_items (
          id,
          kind,
          payload,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?);
        `,
        [
          item.id,
          kind,
          stringifyJsonValue(item),
          item.createdAt ?? timestamp,
          item.updatedAt ?? item.createdAt ?? timestamp
        ],
        false
      );
    };

    for (const template of store.templates) {
      await writeItem("template", template);
    }

    for (const ruleItem of store.ruleItems) {
      await writeItem("rule_item", ruleItem);
    }

    for (const ruleProfile of store.ruleProfiles) {
      await writeItem("rule_profile", ruleProfile);
    }

    for (const preset of store.acceptanceCriteriaPresets) {
      await writeItem("acceptance_criteria_preset", preset);
    }

    await this.setStorageMetadata("rules_templates_catalog_source", "sqlite");
    await this.setStorageMetadata("rules_templates_catalog_updated_at", nowIso());
    this.persist();
  }

  async importRulesAndTemplatesCatalog(
    store: RulesAndTemplatesStore
  ): Promise<{ imported: boolean; count: number }> {
    await this.ensureSchema();

    const existing = await this.getRulesAndTemplatesCatalogStats();

    if (existing.total > 0 || !storeHasRulesCatalogData(store)) {
      return {
        imported: false,
        count: existing.total
      };
    }

    await this.writeRulesAndTemplatesCatalog(store);
    await this.setStorageMetadata("rules_templates_imported_from", "json");
    await this.setStorageMetadata("rules_templates_imported_at", nowIso());
    this.persist();

    return {
      imported: true,
      count: countRulesCatalog(store).total
    };
  }

  async getRulesAndTemplatesCatalogStats(): Promise<RulesAndTemplatesCatalogStats> {
    await this.ensureSchema();

    const rows = await this.getAll<{ kind: RulesCatalogKind; count: number }>(`
      SELECT kind, COUNT(*) AS count
      FROM rules_templates_catalog_items
      GROUP BY kind;
    `);
    const imported = await this.getOne<{ value: string }>(
      "SELECT value FROM app_storage_metadata WHERE key = ?;",
      ["rules_templates_imported_from"]
    );
    const counts: Record<RulesCatalogKind, number> = {
      template: 0,
      rule_item: 0,
      rule_profile: 0,
      acceptance_criteria_preset: 0
    };

    for (const row of rows) {
      counts[row.kind] = Number(row.count) || 0;
    }

    const templates = counts.template;
    const ruleItems = counts.rule_item;
    const ruleProfiles = counts.rule_profile;
    const acceptanceCriteriaPresets = counts.acceptance_criteria_preset;

    return {
      source: "sqlite",
      importedFromJson: Boolean(imported),
      templates,
      ruleItems,
      ruleProfiles,
      acceptanceCriteriaPresets,
      total: templates + ruleItems + ruleProfiles + acceptanceCriteriaPresets
    };
  }


  async getSchemaInfo(): Promise<StorageSchemaInfo> {
    await this.ensureSchema();

    const appliedRows = await this.getAll<{
      id: string;
      version: number;
      name: string;
      description: string | null;
      checksum: string;
      applied_at: string;
    }>(`
      SELECT id, version, name, description, checksum, applied_at
      FROM schema_migrations
      ORDER BY version ASC, applied_at ASC;
    `);

    const appliedIds = new Set(appliedRows.map((row) => row.id));
    const pendingMigrations = SQLITE_MIGRATIONS
      .filter((migration) => !appliedIds.has(migration.id))
      .map((migration) => ({
        id: migration.id,
        version: migration.version,
        name: migration.name,
        description: migration.description
      }));
    const currentVersion = appliedRows.reduce(
      (maxVersion, row) => Math.max(maxVersion, Number(row.version) || 0),
      0
    );

    return {
      currentVersion,
      latestVersion: SQLITE_SCHEMA_VERSION,
      status: pendingMigrations.length > 0 ? "needs_migration" : "ready",
      pendingCount: pendingMigrations.length,
      appliedMigrations: appliedRows.map((row) => ({
        id: row.id,
        version: Number(row.version) || 0,
        name: row.name,
        description: row.description,
        checksum: row.checksum,
        appliedAt: row.applied_at
      })),
      pendingMigrations
    };
  }

  private async runMigrations() {
    const appliedRows = await this.getAll<{ id: string }>(
      "SELECT id FROM schema_migrations;"
    );
    const appliedIds = new Set(appliedRows.map((row) => row.id));
    let changed = false;

    for (const migration of SQLITE_MIGRATIONS) {
      if (appliedIds.has(migration.id)) {
        continue;
      }

      const appliedAt = nowIso();
      const db = await this.getDatabase();

      migration.run(db);

      await this.run(
        `
        INSERT INTO schema_migrations (id, version, name, description, checksum, applied_at)
        VALUES (?, ?, ?, ?, ?, ?);
        `,
        [
          migration.id,
          migration.version,
          migration.name,
          migration.description,
          migration.checksum,
          appliedAt
        ],
        false
      );

      changed = true;
    }

    await this.setStorageMetadata("schema_version", SQLITE_SCHEMA_VERSION);
    await this.setStorageMetadata("schema_latest_version", SQLITE_SCHEMA_VERSION);
    await this.setStorageMetadata("schema_checked_at", nowIso());
    await this.setStorageMetadata("storage_mode", "sqlite-first");

    if (changed) {
      this.persist();
    }
  }

  private async setStorageMetadata(key: string, value: unknown) {
    await this.run(
      `
      INSERT INTO app_storage_metadata (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key)
      DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at;
      `,
      [key, stringifyJsonValue(value), nowIso()],
      false
    );
  }

  private async getDatabase() {
    if (this.db) {
      return this.db;
    }

    fs.mkdirSync(path.dirname(this.databasePath), { recursive: true });

    if (!this.sqlJs) {
      const sqlJsDistPath = getSqlJsDistPath();

      this.sqlJs = await initSqlJs({
        locateFile: (file: string) => path.join(sqlJsDistPath, file)
      });
    }

    const databaseBytes = fs.existsSync(this.databasePath)
      ? fs.readFileSync(this.databasePath)
      : null;

    this.db = new this.sqlJs.Database(databaseBytes);
    this.db.run("PRAGMA foreign_keys = ON;");

    return this.db;
  }

  private async getAll<T extends Record<string, unknown>>(
    sql: string,
    params: BindValue[] = []
  ): Promise<T[]> {
    const db = await this.getDatabase();
    const statement = db.prepare(sql);

    try {
      statement.bind(params);

      const rows: T[] = [];

      while (statement.step()) {
        rows.push(statement.getAsObject() as T);
      }

      return rows;
    } finally {
      statement.free();
    }
  }

  private async getOne<T extends Record<string, unknown>>(
    sql: string,
    params: BindValue[] = []
  ): Promise<T | null> {
    const rows = await this.getAll<T>(sql, params);
    return rows[0] ?? null;
  }

  private async run(sql: string, params: BindValue[] = [], shouldPersist = false) {
    const db = await this.getDatabase();
    db.run(sql, params);

    if (shouldPersist) {
      this.persist();
    }
  }

  private async getLastInsertRowId() {
    const row = await this.getOne<{ id: number }>("SELECT last_insert_rowid() AS id;");
    return Number(row?.id ?? 0);
  }

  private insertDefaultSetting(key: string, value: unknown) {
    if (!this.db) {
      throw new Error("SQLite database is not initialized.");
    }

    this.db.run(
      `
      INSERT OR IGNORE INTO app_settings (key, value, updated_at)
      VALUES (?, ?, ?);
      `,
      [key, stringifyJsonValue(value), nowIso()]
    );
  }

  private persist() {
    if (!this.db) {
      return;
    }

    fs.mkdirSync(path.dirname(this.databasePath), { recursive: true });
    fs.writeFileSync(this.databasePath, Buffer.from(this.db.export()));
  }
}
