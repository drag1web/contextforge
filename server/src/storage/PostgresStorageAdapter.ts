import { pool } from "../db/pool.js";
import type { ScannedProject } from "../scanner/projectScanner.js";
import { TaskPackCurrentStateStorageError } from "./types.js";
import {
  assertTaskPackAggregateLifecycleEvent,
  assertTaskPackRevision,
  assertTaskPackRevisionReviewEvent,
  computeTaskPackRevisionContentHash,
  type TaskPackRevisionContent,
} from "../taskPacks/taskPackLifecycle.js";
import {
  applyPostgresTaskPackLifecycleMigration,
  TASK_PACK_LIFECYCLE_MIGRATION_ID,
} from "./migrations.js";
import {
  buildCreatedTaskPackRevisionContent,
  mapTaskPackAggregatePersistenceRow,
  mapTaskPackLifecycleEventPersistenceRow,
  mapTaskPackReviewEventPersistenceRow,
  mapTaskPackRevisionPersistenceRow,
  type TaskPackAggregatePersistenceRow,
  type TaskPackLifecycleEventPersistenceRow,
  type TaskPackReviewEventPersistenceRow,
  type TaskPackRevisionPersistenceRow,
} from "./taskPackLifecyclePersistence.js";
import type {
  AppendTaskPackRevisionInput,
  CreateProjectMemoryInput,
  CreateTaskPackInput,
  CreateTaskPackWithInitialRevisionInput,
  ProjectMemoryRecord,
  ProjectRecord,
  StorageAdapter,
  StorageHealth,
  StorageSchemaInfo,
  TaskPackAggregateLifecycleEventRecord,
  TaskPackAggregateRecord,
  TaskPackCurrentRecord,
  TaskPackRecord,
  TaskPackRevisionRecord,
  TaskPackRevisionReviewEventRecord,
  UpdateProjectMemoryInput,
  UpdateTaskPackContentInput
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

function revisionContentFromAppendInput(
  input: AppendTaskPackRevisionInput,
): TaskPackRevisionContent {
  return {
    sourceKind: input.sourceKind,
    rawTask: input.rawTask,
    taskType: input.taskType,
    targetTool: input.targetTool,
    generatedPrompt: input.generatedPrompt,
    generationMode: input.generationMode,
    generationModel: input.generationModel,
    generationMessage: input.generationMessage,
    generationUsedFallback: input.generationUsedFallback,
    generationDurationMs: input.generationDurationMs,
    generationRecipe: input.generationRecipe,
    diagnostics: input.diagnostics,
    groundedContextSnapshot: input.groundedContextSnapshot,
    freshnessBasis: input.freshnessBasis,
  };
}

function mapTaskPackCurrentRow(row: any): TaskPackCurrentRecord {
  const currentRevisionId = Number(row.currentRevisionId);
  if (
    !Number.isSafeInteger(currentRevisionId) ||
    currentRevisionId <= 0 ||
    Number(row.resolvedCurrentRevisionId) !== currentRevisionId ||
    Number(row.currentRevisionTaskPackId) !== Number(row.id)
  ) {
    throw new TaskPackCurrentStateStorageError();
  }
  return {
    ...mapTaskPackRow(row),
    currentRevisionId,
  };
}

function jsonParameter(value: unknown | null): string | null {
  return value === null ? null : JSON.stringify(value);
}

function mapProjectMemoryRow(row: any): ProjectMemoryRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    content: row.content,
    category: row.category ?? "custom",
    isEnabled: Boolean(row.isEnabled),
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
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL
      );
    `);

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
      CREATE TABLE IF NOT EXISTS project_memories (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'custom',
        is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
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
        ('ai_provider', to_jsonb('ollama'::text)),
        ('default_target_tool', to_jsonb('codex'::text)),
        ('default_task_type', to_jsonb('general'::text)),
        ('default_ollama_model', 'null'::jsonb),
        ('openai_compatible_base_url', to_jsonb('http://localhost:1234/v1'::text)),
        ('openai_compatible_model', 'null'::jsonb),
        ('openai_compatible_api_key', 'null'::jsonb),
        ('gemini_base_url', to_jsonb('https://generativelanguage.googleapis.com/v1beta'::text)),
        ('gemini_model', to_jsonb('gemini-1.5-flash'::text)),
        ('gemini_api_key', 'null'::jsonb),
        ('language', to_jsonb('system'::text)),
        ('theme', to_jsonb('dark'::text)),
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

    const lifecycleMigration = await pool.query(
      "SELECT id FROM schema_migrations WHERE id = $1;",
      [TASK_PACK_LIFECYCLE_MIGRATION_ID],
    );
    if (lifecycleMigration.rowCount === 0) {
      const client = await pool.connect();
      try {
        await applyPostgresTaskPackLifecycleMigration(
          {
            query: async <T>(text: string, values?: readonly unknown[]) => {
              const result = await client.query(text, values ? [...values] : undefined);
              return { rows: result.rows as T[], rowCount: result.rowCount };
            },
          },
          new Date().toISOString(),
        );
      } finally {
        client.release();
      }
    }
  }

  async getSchemaInfo(): Promise<StorageSchemaInfo> {
    await this.ensureSchema();
    const result = await pool.query(`
      SELECT id, version, name, description, checksum,
             applied_at AS "appliedAt"
      FROM schema_migrations
      ORDER BY version ASC, applied_at ASC;
    `);
    const appliedMigrations = result.rows.map((row) => ({
      id: row.id as string,
      version: Number(row.version),
      name: row.name as string,
      description: (row.description as string | null) ?? null,
      checksum: row.checksum as string,
      appliedAt:
        row.appliedAt instanceof Date
          ? row.appliedAt.toISOString()
          : String(row.appliedAt),
    }));
    const applied = appliedMigrations.some(
      (migration) => migration.id === TASK_PACK_LIFECYCLE_MIGRATION_ID,
    );
    return {
      currentVersion: applied ? 3 : 0,
      latestVersion: 3,
      status: applied ? "ready" : "needs_migration",
      pendingCount: applied ? 0 : 1,
      appliedMigrations,
      pendingMigrations: applied
        ? []
        : [
            {
              id: TASK_PACK_LIFECYCLE_MIGRATION_ID,
              version: 3,
              name: "Task Pack lifecycle and immutable revisions",
              description:
                "Adds aggregate lifecycle projection, immutable revisions, append-only lifecycle/review events, and legacy revision backfill.",
            },
          ],
    };
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


  async getTaskPackById(taskPackId: number): Promise<TaskPackRecord | null> {
    const result = await pool.query(
      `
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
      WHERE tp.id = $1;
      `,
      [taskPackId]
    );

    return result.rows[0] ? mapTaskPackRow(result.rows[0]) : null;
  }

  async listTaskPackCurrentRecords(): Promise<TaskPackCurrentRecord[]> {
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
        tp.updated_at AS "updatedAt",
        tp.current_revision_id AS "currentRevisionId",
        current_revision.id AS "resolvedCurrentRevisionId",
        current_revision.task_pack_id AS "currentRevisionTaskPackId"
      FROM task_packs tp
      JOIN projects p ON p.id = tp.project_id
      LEFT JOIN task_pack_revisions current_revision
        ON current_revision.id = tp.current_revision_id
      ORDER BY tp.created_at DESC;
    `);

    return result.rows.map(mapTaskPackCurrentRow);
  }

  async getTaskPackCurrentRecordById(
    taskPackId: number,
  ): Promise<TaskPackCurrentRecord | null> {
    const result = await pool.query(
      `
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
        tp.updated_at AS "updatedAt",
        tp.current_revision_id AS "currentRevisionId",
        current_revision.id AS "resolvedCurrentRevisionId",
        current_revision.task_pack_id AS "currentRevisionTaskPackId"
      FROM task_packs tp
      JOIN projects p ON p.id = tp.project_id
      LEFT JOIN task_pack_revisions current_revision
        ON current_revision.id = tp.current_revision_id
      WHERE tp.id = $1;
      `,
      [taskPackId],
    );

    return result.rows[0] ? mapTaskPackCurrentRow(result.rows[0]) : null;
  }

  async createTaskPack(input: CreateTaskPackInput): Promise<TaskPackRecord> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `INSERT INTO task_packs (
          project_id, title, raw_task, task_type, target_tool, generated_prompt,
          generation_mode, generation_model, generation_message,
          generation_used_fallback, generation_duration_ms, generation_recipe
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
        RETURNING
          id, project_id AS "projectId", title, raw_task AS "rawTask",
          task_type AS "taskType", target_tool AS "targetTool",
          generated_prompt AS "generatedPrompt", generation_mode AS "generationMode",
          generation_model AS "generationModel", generation_message AS "generationMessage",
          generation_used_fallback AS "generationUsedFallback",
          generation_duration_ms AS "generationDurationMs",
          generation_recipe AS "generationRecipe", created_at AS "createdAt",
          updated_at AS "updatedAt";`,
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
          JSON.stringify(input.generationRecipe ?? null),
        ],
      );
      const taskPack = mapTaskPackRow(result.rows[0]);
      const content = buildCreatedTaskPackRevisionContent(input);
      const generatedAt = content.sourceKind === "generated" ? taskPack.createdAt : null;
      const revision = await client.query(
        `INSERT INTO task_pack_revisions (
          task_pack_id, revision_number, base_revision_id, source_kind,
          raw_task, task_type, target_tool, generated_prompt,
          generation_mode, generation_model, generation_message,
          generation_used_fallback, generation_duration_ms, generation_recipe,
          diagnostics, grounded_context_snapshot, freshness_basis,
          content_hash, created_at, generated_at
        ) VALUES (
          $1, 1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
          $12::jsonb, NULL, NULL, NULL, $13, $14, $15
        ) RETURNING id;`,
        [
          taskPack.id,
          content.sourceKind,
          content.rawTask,
          content.taskType,
          content.targetTool,
          content.generatedPrompt,
          content.generationMode,
          content.generationModel,
          content.generationMessage,
          content.generationUsedFallback,
          content.generationDurationMs,
          content.generationRecipe === null ? null : JSON.stringify(content.generationRecipe),
          computeTaskPackRevisionContentHash(content),
          taskPack.createdAt,
          generatedAt,
        ],
      );
      await client.query(
        "UPDATE task_packs SET current_revision_id = $1 WHERE id = $2;",
        [revision.rows[0]!.id, taskPack.id],
      );
      await client.query("COMMIT");
      return taskPack;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async createTaskPackWithInitialRevision(
    input: CreateTaskPackWithInitialRevisionInput,
  ): Promise<TaskPackRecord> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const content = input.revisionContent;
      const taskPackResult = await client.query(
        `INSERT INTO task_packs (
          project_id, title, raw_task, task_type, target_tool, generated_prompt,
          generation_mode, generation_model, generation_message,
          generation_used_fallback, generation_duration_ms, generation_recipe,
          lifecycle_state, lifecycle_version
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb,
          'active', 1
        ) RETURNING
          id, project_id AS "projectId", title, raw_task AS "rawTask",
          task_type AS "taskType", target_tool AS "targetTool",
          generated_prompt AS "generatedPrompt", generation_mode AS "generationMode",
          generation_model AS "generationModel", generation_message AS "generationMessage",
          generation_used_fallback AS "generationUsedFallback",
          generation_duration_ms AS "generationDurationMs",
          generation_recipe AS "generationRecipe", created_at AS "createdAt",
          updated_at AS "updatedAt";`,
        [
          input.projectId,
          input.title,
          content.rawTask,
          content.taskType,
          content.targetTool,
          content.generatedPrompt,
          content.generationMode,
          content.generationModel,
          content.generationMessage,
          content.generationUsedFallback,
          content.generationDurationMs,
          JSON.stringify(input.compatibilityGenerationRecipe),
        ],
      );
      const taskPack = mapTaskPackRow(taskPackResult.rows[0]);
      const createdAtValue = taskPackResult.rows[0]!.createdAt as string | Date;
      const createdAt =
        createdAtValue instanceof Date
          ? createdAtValue.toISOString()
          : createdAtValue;
      const revisionResult = await client.query(
        `INSERT INTO task_pack_revisions (
          task_pack_id, revision_number, base_revision_id, source_kind,
          raw_task, task_type, target_tool, generated_prompt,
          generation_mode, generation_model, generation_message,
          generation_used_fallback, generation_duration_ms, generation_recipe,
          diagnostics, grounded_context_snapshot, freshness_basis,
          content_hash, created_at, generated_at
        ) VALUES (
          $1, 1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
          $12::jsonb, $13::jsonb, $14::jsonb, $15::jsonb, $16, $17, $18
        ) RETURNING *;`,
        [
          taskPack.id,
          content.sourceKind,
          content.rawTask,
          content.taskType,
          content.targetTool,
          content.generatedPrompt,
          content.generationMode,
          content.generationModel,
          content.generationMessage,
          content.generationUsedFallback,
          content.generationDurationMs,
          jsonParameter(content.generationRecipe),
          jsonParameter(content.diagnostics),
          jsonParameter(content.groundedContextSnapshot),
          jsonParameter(content.freshnessBasis),
          computeTaskPackRevisionContentHash(content),
          createdAt,
          input.generatedAt,
        ],
      );
      const revision = mapTaskPackRevisionPersistenceRow(
        revisionResult.rows[0] as TaskPackRevisionPersistenceRow,
      );
      await client.query(
        `UPDATE task_packs
         SET current_revision_id = $1
         WHERE id = $2 AND current_revision_id IS NULL;`,
        [revision.id, taskPack.id],
      );
      const aggregateResult = await client.query(
        `SELECT id, project_id, title, lifecycle_state, archived_from_state,
                current_revision_id, accepted_revision_id, lifecycle_version,
                created_at, updated_at, completed_at, archived_at
         FROM task_packs WHERE id = $1;`,
        [taskPack.id],
      );
      const aggregate = mapTaskPackAggregatePersistenceRow(
        aggregateResult.rows[0] as TaskPackAggregatePersistenceRow,
      );
      assertTaskPackRevision(revision, {
        aggregate,
        verifyContentHash: true,
      });
      await client.query("COMMIT");
      return taskPack;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }


  async updateTaskPackGenerationRecipe(
    taskPackId: number,
    generationRecipe: unknown | null
  ): Promise<TaskPackRecord | null> {
    const result = await pool.query(
      `
      UPDATE task_packs
      SET generation_recipe = $1, updated_at = NOW()
      WHERE id = $2
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
      [JSON.stringify(generationRecipe ?? null), taskPackId]
    );

    if (!result.rows[0]) {
      return null;
    }

    return this.getTaskPackById(taskPackId);
  }


  async updateTaskPackContent(
    taskPackId: number,
    input: UpdateTaskPackContentInput
  ): Promise<TaskPackRecord | null> {
    const current = await this.getTaskPackById(taskPackId);

    if (!current) {
      return null;
    }

    await pool.query(
      `
      UPDATE task_packs
      SET raw_task = $1, generated_prompt = $2, updated_at = NOW()
      WHERE id = $3;
      `,
      [
        input.rawTask ?? current.rawTask,
        input.generatedPrompt ?? current.generatedPrompt,
        taskPackId
      ]
    );

    return this.getTaskPackById(taskPackId);
  }

  async getTaskPackAggregate(taskPackId: number): Promise<TaskPackAggregateRecord | null> {
    const result = await pool.query(
      `SELECT id, project_id, title, lifecycle_state, archived_from_state,
              current_revision_id, accepted_revision_id, lifecycle_version,
              created_at, updated_at, completed_at, archived_at
       FROM task_packs
       WHERE id = $1 AND current_revision_id IS NOT NULL;`,
      [taskPackId],
    );
    return result.rows[0]
      ? mapTaskPackAggregatePersistenceRow(result.rows[0] as TaskPackAggregatePersistenceRow)
      : null;
  }

  async getCurrentTaskPackRevision(taskPackId: number): Promise<TaskPackRevisionRecord | null> {
    const result = await pool.query(
      `SELECT r.*
       FROM task_packs tp
       JOIN task_pack_revisions r ON r.id = tp.current_revision_id
       WHERE tp.id = $1 AND r.task_pack_id = tp.id;`,
      [taskPackId],
    );
    return result.rows[0]
      ? mapTaskPackRevisionPersistenceRow(result.rows[0] as TaskPackRevisionPersistenceRow)
      : null;
  }

  async getTaskPackRevisionById(
    taskPackId: number,
    revisionId: number,
  ): Promise<TaskPackRevisionRecord | null> {
    const result = await pool.query(
      "SELECT * FROM task_pack_revisions WHERE task_pack_id = $1 AND id = $2;",
      [taskPackId, revisionId],
    );
    return result.rows[0]
      ? mapTaskPackRevisionPersistenceRow(result.rows[0] as TaskPackRevisionPersistenceRow)
      : null;
  }

  async listTaskPackRevisions(taskPackId: number): Promise<TaskPackRevisionRecord[]> {
    const result = await pool.query(
      `SELECT * FROM task_pack_revisions
       WHERE task_pack_id = $1 ORDER BY revision_number ASC;`,
      [taskPackId],
    );
    return result.rows.map((row) =>
      mapTaskPackRevisionPersistenceRow(row as TaskPackRevisionPersistenceRow),
    );
  }

  async appendTaskPackRevision(
    input: AppendTaskPackRevisionInput,
  ): Promise<TaskPackRevisionRecord> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const aggregateResult = await client.query(
        `SELECT id, project_id, title, lifecycle_state, archived_from_state,
                current_revision_id, accepted_revision_id, lifecycle_version,
                created_at, updated_at, completed_at, archived_at
         FROM task_packs WHERE id = $1 FOR UPDATE;`,
        [input.taskPackId],
      );
      if (!aggregateResult.rows[0]) throw new Error("Task Pack aggregate not found.");
      const aggregate = mapTaskPackAggregatePersistenceRow(
        aggregateResult.rows[0] as TaskPackAggregatePersistenceRow,
      );
      if (aggregate.lifecycle.state !== "active") {
        throw new Error("Only an active Task Pack can receive a revision.");
      }
      if (aggregate.currentRevisionId !== input.baseRevisionId) {
        throw new Error("Task Pack base revision is stale.");
      }
      const baseResult = await client.query(
        "SELECT * FROM task_pack_revisions WHERE task_pack_id = $1 AND id = $2;",
        [input.taskPackId, input.baseRevisionId],
      );
      if (!baseResult.rows[0]) {
        throw new Error("Task Pack base revision does not belong to the aggregate.");
      }
      const base = mapTaskPackRevisionPersistenceRow(
        baseResult.rows[0] as TaskPackRevisionPersistenceRow,
      );
      const nextNumberResult = await client.query(
        `SELECT COALESCE(MAX(revision_number), 0) + 1 AS revision_number
         FROM task_pack_revisions WHERE task_pack_id = $1;`,
        [input.taskPackId],
      );
      const nextRevisionNumber = Number(nextNumberResult.rows[0]!.revision_number);
      const content = revisionContentFromAppendInput(input);
      const inserted = await client.query(
        `INSERT INTO task_pack_revisions (
          task_pack_id, revision_number, base_revision_id, source_kind,
          raw_task, task_type, target_tool, generated_prompt,
          generation_mode, generation_model, generation_message,
          generation_used_fallback, generation_duration_ms, generation_recipe,
          diagnostics, grounded_context_snapshot, freshness_basis,
          content_hash, created_at, generated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
          $14::jsonb, $15::jsonb, $16::jsonb, $17::jsonb, $18, $19, $20
        ) RETURNING *;`,
        [
          input.taskPackId,
          nextRevisionNumber,
          input.baseRevisionId,
          content.sourceKind,
          content.rawTask,
          content.taskType,
          content.targetTool,
          content.generatedPrompt,
          content.generationMode,
          content.generationModel,
          content.generationMessage,
          content.generationUsedFallback,
          content.generationDurationMs,
          jsonParameter(content.generationRecipe),
          jsonParameter(content.diagnostics),
          jsonParameter(content.groundedContextSnapshot),
          jsonParameter(content.freshnessBasis),
          computeTaskPackRevisionContentHash(content),
          input.createdAt,
          input.generatedAt,
        ],
      );
      const revision = mapTaskPackRevisionPersistenceRow(
        inserted.rows[0] as TaskPackRevisionPersistenceRow,
      );
      assertTaskPackRevision(revision, { aggregate, baseRevision: base });
      await client.query(
        `UPDATE task_packs
         SET current_revision_id = $1, lifecycle_version = lifecycle_version + 1,
             raw_task = $2, task_type = $3, target_tool = $4, generated_prompt = $5,
             generation_mode = $6, generation_model = $7, generation_message = $8,
             generation_used_fallback = $9, generation_duration_ms = $10,
             generation_recipe = $11::jsonb, updated_at = $12
         WHERE id = $13 AND current_revision_id = $14;`,
        [
          revision.id,
          content.rawTask,
          content.taskType,
          content.targetTool,
          content.generatedPrompt,
          content.generationMode,
          content.generationModel,
          content.generationMessage,
          content.generationUsedFallback,
          content.generationDurationMs,
          jsonParameter(content.generationRecipe),
          input.createdAt,
          input.taskPackId,
          input.baseRevisionId,
        ],
      );
      await client.query("COMMIT");
      return revision;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async appendTaskPackAggregateLifecycleEvent(
    event: TaskPackAggregateLifecycleEventRecord,
  ): Promise<void> {
    const aggregate = await this.getTaskPackAggregate(event.taskPackId);
    if (!aggregate) throw new Error("Task Pack aggregate not found.");
    const revision =
      event.revisionId === null
        ? undefined
        : (await this.getTaskPackRevisionById(event.taskPackId, event.revisionId)) ?? undefined;
    if (event.revisionId !== null && revision === undefined) {
      throw new Error("Task Pack lifecycle event revision ownership is invalid.");
    }
    assertTaskPackAggregateLifecycleEvent(event, { aggregate, revision });
    await pool.query(
      `INSERT INTO task_pack_lifecycle_events (
        id, task_pack_id, revision_id, event_type, from_state, to_state,
        source, actor_id, created_at, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb);`,
      [
        event.id,
        event.taskPackId,
        event.revisionId,
        event.eventType,
        event.fromState,
        event.toState,
        event.source,
        event.actorId,
        event.createdAt,
        jsonParameter(event.metadata),
      ],
    );
  }

  async listTaskPackAggregateLifecycleEvents(
    taskPackId: number,
  ): Promise<TaskPackAggregateLifecycleEventRecord[]> {
    const result = await pool.query(
      `SELECT * FROM task_pack_lifecycle_events
       WHERE task_pack_id = $1 ORDER BY created_at ASC, id ASC;`,
      [taskPackId],
    );
    return result.rows.map((row) =>
      mapTaskPackLifecycleEventPersistenceRow(row as TaskPackLifecycleEventPersistenceRow),
    );
  }

  async appendTaskPackRevisionReviewEvent(
    event: TaskPackRevisionReviewEventRecord,
  ): Promise<void> {
    const aggregate = await this.getTaskPackAggregate(event.taskPackId);
    const revision = await this.getTaskPackRevisionById(event.taskPackId, event.revisionId);
    if (!aggregate || !revision) throw new Error("Task Pack revision ownership is invalid.");
    assertTaskPackRevisionReviewEvent(event, { aggregate, revision });
    await pool.query(
      `INSERT INTO task_pack_revision_review_events (
        id, task_pack_id, revision_id, event_type, from_state, to_state,
        source, actor_id, created_at, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb);`,
      [
        event.id,
        event.taskPackId,
        event.revisionId,
        event.eventType,
        event.fromState,
        event.toState,
        event.source,
        event.actorId,
        event.createdAt,
        jsonParameter(event.metadata),
      ],
    );
  }

  async listTaskPackRevisionReviewEvents(
    taskPackId: number,
    revisionId?: number,
  ): Promise<TaskPackRevisionReviewEventRecord[]> {
    const result = await pool.query(
      revisionId === undefined
        ? `SELECT * FROM task_pack_revision_review_events
           WHERE task_pack_id = $1 ORDER BY created_at ASC, id ASC;`
        : `SELECT * FROM task_pack_revision_review_events
           WHERE task_pack_id = $1 AND revision_id = $2 ORDER BY created_at ASC, id ASC;`,
      revisionId === undefined ? [taskPackId] : [taskPackId, revisionId],
    );
    return result.rows.map((row) =>
      mapTaskPackReviewEventPersistenceRow(row as TaskPackReviewEventPersistenceRow),
    );
  }

  async listProjectMemories(projectId: number): Promise<ProjectMemoryRecord[]> {
    const result = await pool.query(
      `
      SELECT
        id,
        project_id AS "projectId",
        title,
        content,
        category,
        is_enabled AS "isEnabled",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM project_memories
      WHERE project_id = $1
      ORDER BY is_enabled DESC, updated_at DESC, id DESC;
      `,
      [projectId]
    );

    return result.rows.map(mapProjectMemoryRow);
  }

  async createProjectMemory(input: CreateProjectMemoryInput): Promise<ProjectMemoryRecord> {
    const result = await pool.query(
      `
      INSERT INTO project_memories (
        project_id,
        title,
        content,
        category,
        is_enabled
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING
        id,
        project_id AS "projectId",
        title,
        content,
        category,
        is_enabled AS "isEnabled",
        created_at AS "createdAt",
        updated_at AS "updatedAt";
      `,
      [
        input.projectId,
        input.title,
        input.content,
        input.category,
        input.isEnabled !== false
      ]
    );

    return mapProjectMemoryRow(result.rows[0]);
  }

  async updateProjectMemory(
    projectId: number,
    memoryId: number,
    input: UpdateProjectMemoryInput
  ): Promise<ProjectMemoryRecord | null> {
    const existing = await pool.query(
      `
      SELECT id
      FROM project_memories
      WHERE id = $1 AND project_id = $2;
      `,
      [memoryId, projectId]
    );

    if (existing.rowCount === 0) {
      return null;
    }

    const result = await pool.query(
      `
      UPDATE project_memories
      SET
        title = COALESCE($3, title),
        content = COALESCE($4, content),
        category = COALESCE($5, category),
        is_enabled = COALESCE($6, is_enabled),
        updated_at = NOW()
      WHERE id = $1 AND project_id = $2
      RETURNING
        id,
        project_id AS "projectId",
        title,
        content,
        category,
        is_enabled AS "isEnabled",
        created_at AS "createdAt",
        updated_at AS "updatedAt";
      `,
      [
        memoryId,
        projectId,
        input.title ?? null,
        input.content ?? null,
        input.category ?? null,
        typeof input.isEnabled === "boolean" ? input.isEnabled : null
      ]
    );

    return result.rows[0] ? mapProjectMemoryRow(result.rows[0]) : null;
  }

  async deleteProjectMemory(projectId: number, memoryId: number): Promise<boolean> {
    const result = await pool.query(
      `
      DELETE FROM project_memories
      WHERE id = $1 AND project_id = $2;
      `,
      [memoryId, projectId]
    );

    return (result.rowCount ?? 0) > 0;
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
