import { pool } from "../db/pool.js";
import type { ScannedProject } from "../scanner/projectScanner.js";
import type {
  CreateTaskPackInput,
  ProjectRecord,
  StorageAdapter,
  StorageHealth,
  TaskPackRecord
} from "./types.js";

function mapProjectRow(row: any): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    localPath: row.localPath,
    packageManager: row.packageManager,
    detectedStack: row.detectedStack ?? [],
    scripts: row.scripts ?? {},
    readinessScore: row.readinessScore ?? 0,
    readinessReport: row.readinessReport ?? { score: 0, checks: [], issues: [] },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastScanAt: row.lastScanAt ?? null
  };
}

function mapTaskPackRow(row: any): TaskPackRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    projectName: row.projectName,
    title: row.title,
    rawTask: row.rawTask,
    taskType: row.taskType,
    targetTool: row.targetTool,
    generatedPrompt: row.generatedPrompt,
    generationMode: row.generationMode ?? "template",
    generationModel: row.generationModel ?? null,
    generationMessage: row.generationMessage ?? null,
    generationUsedFallback: Boolean(row.generationUsedFallback),
    generationDurationMs: row.generationDurationMs ?? null,
    generationRecipe: row.generationRecipe ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

const selectProjectsSql = `
  SELECT
    id,
    name,
    local_path AS "localPath",
    package_manager AS "packageManager",
    detected_stack AS "detectedStack",
    scripts,
    readiness_score AS "readinessScore",
    readiness_report AS "readinessReport",
    created_at AS "createdAt",
    updated_at AS "updatedAt",
    last_scan_at AS "lastScanAt"
  FROM projects
`;

export class PostgresStorageAdapter implements StorageAdapter {
  readonly driver = "postgres" as const;

  async ensureSchema() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        local_path TEXT NOT NULL UNIQUE,
        package_manager TEXT,
        detected_stack JSONB NOT NULL DEFAULT '[]'::jsonb,
        scripts JSONB NOT NULL DEFAULT '{}'::jsonb,
        readiness_score INTEGER NOT NULL DEFAULT 0,
        readiness_report JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_scan_at TIMESTAMPTZ
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS task_packs (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        raw_task TEXT NOT NULL,
        task_type TEXT NOT NULL DEFAULT 'general',
        target_tool TEXT NOT NULL DEFAULT 'generic',
        generated_prompt TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await pool.query(`
      INSERT INTO app_settings (key, value)
      VALUES
        ('ollama_url', to_jsonb('http://localhost:11434'::text)),
        ('generation_mode', to_jsonb('template'::text)),
        ('default_target_tool', to_jsonb('codex'::text)),
        ('default_task_type', to_jsonb('general'::text)),
        ('default_ollama_model', 'null'::jsonb),
        ('language', to_jsonb('system'::text)),
        ('composer_file_limits', '{"default":8,"ui":7,"backend":8,"fullstack":10,"build":7,"bugfix":7,"refactor":8,"docs":6,"tests":7}'::jsonb),
        ('sidebar_show_descriptions', 'false'::jsonb)
      ON CONFLICT (key) DO NOTHING;
    `);

    await pool.query(`
      ALTER TABLE projects
      ADD COLUMN IF NOT EXISTS readiness_score INTEGER NOT NULL DEFAULT 0;
    `);

    await pool.query(`
      ALTER TABLE projects
      ADD COLUMN IF NOT EXISTS readiness_report JSONB NOT NULL DEFAULT '{}'::jsonb;
    `);

    await pool.query(`
      ALTER TABLE task_packs
      ADD COLUMN IF NOT EXISTS generation_mode TEXT NOT NULL DEFAULT 'template';
    `);

    await pool.query(`
      ALTER TABLE task_packs
      ADD COLUMN IF NOT EXISTS generation_model TEXT;
    `);

    await pool.query(`
      ALTER TABLE task_packs
      ADD COLUMN IF NOT EXISTS generation_message TEXT;
    `);

    await pool.query(`
      ALTER TABLE task_packs
      ADD COLUMN IF NOT EXISTS generation_used_fallback BOOLEAN NOT NULL DEFAULT FALSE;
    `);

    await pool.query(`
      ALTER TABLE task_packs
      ADD COLUMN IF NOT EXISTS generation_duration_ms INTEGER;
    `);

    await pool.query(`
      ALTER TABLE task_packs
      ADD COLUMN IF NOT EXISTS generation_recipe JSONB;
    `);
  }

  async health(): Promise<StorageHealth> {
    const result = await pool.query("SELECT 1 AS ok");

    return {
      ok: true,
      driver: this.driver,
      database: result.rows[0]
    };
  }

  async listProjects(): Promise<ProjectRecord[]> {
    const result = await pool.query(`
      ${selectProjectsSql}
      ORDER BY updated_at DESC;
    `);

    return result.rows.map(mapProjectRow);
  }

  async getProjectById(projectId: number): Promise<ProjectRecord | null> {
    const result = await pool.query(
      `
      ${selectProjectsSql}
      WHERE id = $1;
      `,
      [projectId]
    );

    return result.rows[0] ? mapProjectRow(result.rows[0]) : null;
  }

  async upsertScannedProject(project: ScannedProject): Promise<ProjectRecord> {
    const result = await pool.query(
      `
      INSERT INTO projects (
        name,
        local_path,
        package_manager,
        detected_stack,
        scripts,
        readiness_score,
        readiness_report,
        last_scan_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (local_path)
      DO UPDATE SET
        name = EXCLUDED.name,
        package_manager = EXCLUDED.package_manager,
        detected_stack = EXCLUDED.detected_stack,
        scripts = EXCLUDED.scripts,
        readiness_score = EXCLUDED.readiness_score,
        readiness_report = EXCLUDED.readiness_report,
        updated_at = NOW(),
        last_scan_at = NOW()
      RETURNING
        id,
        name,
        local_path AS "localPath",
        package_manager AS "packageManager",
        detected_stack AS "detectedStack",
        scripts,
        readiness_score AS "readinessScore",
        readiness_report AS "readinessReport",
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        last_scan_at AS "lastScanAt";
      `,
      [
        project.name,
        project.localPath,
        project.packageManager,
        JSON.stringify(project.detectedStack),
        JSON.stringify(project.scripts),
        project.readinessScore,
        JSON.stringify(project.readinessReport)
      ]
    );

    return mapProjectRow(result.rows[0]);
  }

  async listTaskPacks(): Promise<TaskPackRecord[]> {
    const result = await pool.query(`
      SELECT
        tp.id,
        tp.project_id AS "projectId",
        p.name AS "projectName",
        tp.title,
        tp.raw_task AS "rawTask",
        tp.task_type AS "taskType",
        tp.target_tool AS "targetTool",
        tp.generated_prompt AS "generatedPrompt",
        tp.generation_mode AS "generationMode",
        tp.generation_model AS "generationModel",
        tp.generation_message AS "generationMessage",
        tp.generation_used_fallback AS "generationUsedFallback",
        tp.generation_duration_ms AS "generationDurationMs",
        tp.generation_recipe AS "generationRecipe",
        tp.created_at AS "createdAt",
        tp.updated_at AS "updatedAt"
      FROM task_packs tp
      JOIN projects p ON p.id = tp.project_id
      ORDER BY tp.created_at DESC;
    `);

    return result.rows.map(mapTaskPackRow);
  }

  async createTaskPack(input: CreateTaskPackInput): Promise<TaskPackRecord> {
    const result = await pool.query(
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
        generation_recipe
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING
        id,
        project_id AS "projectId",
        title,
        raw_task AS "rawTask",
        task_type AS "taskType",
        target_tool AS "targetTool",
        generated_prompt AS "generatedPrompt",
        generation_mode AS "generationMode",
        generation_model AS "generationModel",
        generation_message AS "generationMessage",
        generation_used_fallback AS "generationUsedFallback",
        generation_duration_ms AS "generationDurationMs",
        generation_recipe AS "generationRecipe",
        created_at AS "createdAt",
        updated_at AS "updatedAt";
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
        input.generationUsedFallback,
        input.generationDurationMs ?? null,
        JSON.stringify(input.generationRecipe ?? null)
      ]
    );

    return mapTaskPackRow(result.rows[0]);
  }

  async getSettingValue<T>(key: string, fallback: T): Promise<T> {
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

  async setSettingValue(key: string, value: unknown): Promise<void> {
    await pool.query(
      `
      INSERT INTO app_settings (key, value, updated_at)
      VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (key)
      DO UPDATE SET
        value = EXCLUDED.value,
        updated_at = NOW();
      `,
      [key, JSON.stringify(value)]
    );
  }
}
