import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import initSqlJs from "sql.js";
import type { Database, SqlJsStatic, SqlValue } from "sql.js";

import type { ScannedProject } from "../scanner/projectScanner.js";
import { parseJsonValue, stringifyJsonValue } from "./json.js";
import type {
  CreateTaskPackInput,
  ProjectRecord,
  StorageAdapter,
  StorageHealth,
  TaskPackRecord
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

export class SqliteStorageAdapter implements StorageAdapter {
  readonly driver = "sqlite" as const;

  private sqlJs: SqlJsStatic | null = null;
  private db: Database | null = null;

  constructor(private readonly databasePath: string) {}

  async ensureSchema() {
    const db = await this.getDatabase();

    db.run(`
      PRAGMA foreign_keys = ON;

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
        category TEXT NOT NULL DEFAULT 'Custom',
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

    this.insertDefaultSetting("ollama_url", "http://localhost:11434");
    this.insertDefaultSetting("generation_mode", "template");
    this.insertDefaultSetting("default_target_tool", "codex");
    this.insertDefaultSetting("default_task_type", "general");
    this.insertDefaultSetting("default_ollama_model", null);
    this.insertDefaultSetting("language", "system");
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
