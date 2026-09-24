import { pool } from "../db/pool.js";
import type { ScannedProject } from "../scanner/projectScanner.js";
import {
  assertTaskPackGitHubCreatedIssueLinkInput,
  projectTaskPackGenerationRecipeWithGitHubCreatedIssue,
  TaskPackCurrentStateStorageError,
  TaskPackDraftStorageError,
  TaskPackGitHubCreatedIssueLinkStorageError,
  TaskPackRevisionAppendStorageError,
} from "./types.js";
import {
  assertTaskPackAggregateLifecycleEvent,
  assertTaskPackRevision,
  assertTaskPackRevisionReviewEvent,
  computeTaskPackRevisionContentHash,
  transitionTaskPackDraft,
  type TaskPackRevisionContent,
} from "../taskPacks/taskPackLifecycle.js";
import {
  applyPostgresTaskPackLifecycleMigration,
  applyPostgresTaskPackGitHubCreatedIssueLinkMigration,
  applyPostgresTaskPackDraftsMigration,
  TASK_PACK_DRAFTS_MIGRATION_ID,
  TASK_PACK_GITHUB_CREATED_ISSUE_LINK_MIGRATION_ID,
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
import {
  assertTaskPackDraftRecordForStorage,
  assertTaskPackDraftVersionToken,
  mapTaskPackDraftPersistenceRow,
  nextTaskPackDraftUpdatedAt,
  serializeTaskPackDraftContent,
  taskPackDraftContentsEqual,
  type TaskPackDraftPersistenceRow,
} from "./taskPackDraftPersistence.js";
import type {
  AppendTaskPackRevisionInput,
  CreateTaskPackDraftInput,
  CreateTaskPackGitHubCreatedIssueLinkInput,
  CreateProjectMemoryInput,
  CreateTaskPackInput,
  CreateTaskPackWithInitialRevisionInput,
  DiscardTaskPackDraftInput,
  MaterializeTaskPackDraftInput,
  MaterializeTaskPackDraftResult,
  ProjectMemoryRecord,
  ProjectRecord,
  StorageAdapter,
  StorageHealth,
  StorageSchemaInfo,
  TaskPackAggregateLifecycleEventRecord,
  TaskPackAggregateRecord,
  TaskPackCurrentRecord,
  TaskPackDraftRecord,
  TaskPackGitHubCreatedIssueLinkRecord,
  TaskPackRecord,
  TaskPackRevisionRecord,
  TaskPackRevisionReviewEventRecord,
  UpdateProjectMemoryInput,
  UpdateTaskPackDraftInput,
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

function mapTaskPackGitHubCreatedIssueLinkRow(
  row: any,
): TaskPackGitHubCreatedIssueLinkRecord | null {
  if (row.githubLinkTaskPackId === null || row.githubLinkTaskPackId === undefined) {
    return null;
  }
  const link: TaskPackGitHubCreatedIssueLinkRecord = {
    taskPackId: Number(row.githubLinkTaskPackId),
    owner: row.githubLinkOwner,
    repo: row.githubLinkRepo,
    fullName: row.githubLinkFullName,
    issueNumber: Number(row.githubLinkIssueNumber),
    issueTitle: row.githubLinkIssueTitle,
    issueUrl: row.githubLinkIssueUrl,
    issueState: row.githubLinkIssueState,
    labels: row.githubLinkLabels,
    repositoryUrl: row.githubLinkRepositoryUrl,
    createdAt:
      row.githubLinkCreatedAt instanceof Date
        ? row.githubLinkCreatedAt.toISOString()
        : String(row.githubLinkCreatedAt),
  };
  assertTaskPackGitHubCreatedIssueLinkInput(link);
  return link;
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
    generationRecipe: projectTaskPackGenerationRecipeWithGitHubCreatedIssue(
      row.generationRecipe ?? null,
      mapTaskPackGitHubCreatedIssueLinkRow(row),
    ),
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

const ISO_UTC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

function validateMaterializeTaskPackDraftInput(
  input: MaterializeTaskPackDraftInput,
): string {
  assertTaskPackDraftVersionToken(input.draftId, input.expectedDraftVersion);
  if (typeof input.title !== "string" || input.title.trim().length === 0) {
    throw new TaskPackDraftStorageError("TASK_PACK_DRAFT_STATE_INVALID", input.draftId);
  }
  if (
    typeof input.generatedAt !== "string" ||
    !ISO_UTC_TIMESTAMP_PATTERN.test(input.generatedAt) ||
    Number.isNaN(Date.parse(input.generatedAt))
  ) {
    throw new TaskPackDraftStorageError("TASK_PACK_DRAFT_STATE_INVALID", input.draftId);
  }
  const contentHash = computeTaskPackRevisionContentHash(input.revisionContent);
  if (input.revisionContent.sourceKind !== "generated") {
    throw new TaskPackDraftStorageError("TASK_PACK_DRAFT_STATE_INVALID", input.draftId);
  }
  return contentHash;
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

    const githubLinkMigration = await pool.query(
      "SELECT id FROM schema_migrations WHERE id = $1;",
      [TASK_PACK_GITHUB_CREATED_ISSUE_LINK_MIGRATION_ID],
    );
    if (githubLinkMigration.rowCount === 0) {
      const client = await pool.connect();
      try {
        await applyPostgresTaskPackGitHubCreatedIssueLinkMigration(
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

    const draftsMigration = await pool.query(
      "SELECT id FROM schema_migrations WHERE id = $1;",
      [TASK_PACK_DRAFTS_MIGRATION_ID],
    );
    if (draftsMigration.rowCount === 0) {
      const client = await pool.connect();
      try {
        await applyPostgresTaskPackDraftsMigration(
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
    const lifecycleApplied = appliedMigrations.some(
      (migration) => migration.id === TASK_PACK_LIFECYCLE_MIGRATION_ID,
    );
    const githubLinkApplied = appliedMigrations.some(
      (migration) =>
        migration.id === TASK_PACK_GITHUB_CREATED_ISSUE_LINK_MIGRATION_ID,
    );
    const draftsApplied = appliedMigrations.some(
      (migration) => migration.id === TASK_PACK_DRAFTS_MIGRATION_ID,
    );
    const currentVersion = draftsApplied ? 5 : githubLinkApplied ? 4 : lifecycleApplied ? 3 : 0;
    const pendingMigrations = [
      ...(!lifecycleApplied
        ? [{
            id: TASK_PACK_LIFECYCLE_MIGRATION_ID,
            version: 3,
            name: "Task Pack lifecycle and immutable revisions",
            description:
              "Adds aggregate lifecycle projection, immutable revisions, append-only lifecycle/review events, and legacy revision backfill.",
          }]
        : []),
      ...(!githubLinkApplied
        ? [{
            id: TASK_PACK_GITHUB_CREATED_ISSUE_LINK_MIGRATION_ID,
            version: 4,
            name: "Task Pack created GitHub issue linkage",
            description:
              "Moves valid aggregate-owned created GitHub issue linkage out of the flat generation recipe.",
          }]
        : []),
      ...(!draftsApplied
        ? [{
            id: TASK_PACK_DRAFTS_MIGRATION_ID,
            version: 5,
            name: "Persisted Task Pack drafts",
            description:
              "Adds local persisted Task Pack drafts with optimistic concurrency and terminal draft lifecycle state.",
          }]
        : []),
    ];
    return {
      currentVersion,
      latestVersion: 5,
      status: pendingMigrations.length === 0 ? "ready" : "needs_migration",
      pendingCount: pendingMigrations.length,
      appliedMigrations,
      pendingMigrations,
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

  async listActiveTaskPackDrafts(projectId?: number): Promise<TaskPackDraftRecord[]> {
    const result = await pool.query(
      projectId === undefined
        ? `SELECT * FROM task_pack_drafts
           WHERE lifecycle_state = 'active'
           ORDER BY updated_at DESC, id ASC;`
        : `SELECT * FROM task_pack_drafts
           WHERE lifecycle_state = 'active' AND project_id = $1
           ORDER BY updated_at DESC, id ASC;`,
      projectId === undefined ? undefined : [projectId],
    );
    return result.rows.map((row) =>
      mapTaskPackDraftPersistenceRow(row as TaskPackDraftPersistenceRow),
    );
  }

  async getTaskPackDraftById(draftId: string): Promise<TaskPackDraftRecord | null> {
    const result = await pool.query("SELECT * FROM task_pack_drafts WHERE id = $1;", [draftId]);
    return result.rows[0]
      ? mapTaskPackDraftPersistenceRow(result.rows[0] as TaskPackDraftPersistenceRow)
      : null;
  }

  async createTaskPackDraft(input: CreateTaskPackDraftInput): Promise<TaskPackDraftRecord> {
    const timestamp = new Date().toISOString();
    const candidate: TaskPackDraftRecord = {
      id: input.id,
      projectId: input.projectId,
      taskPackId: input.taskPackId,
      baseRevisionId: input.baseRevisionId,
      content: input.content,
      lifecycle: { state: "active", materializedRevisionId: null },
      draftVersion: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      expiresAt: input.expiresAt,
    };
    assertTaskPackDraftRecordForStorage(candidate);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const project = await client.query("SELECT id FROM projects WHERE id = $1;", [input.projectId]);
      if (project.rowCount !== 1) {
        throw new TaskPackDraftStorageError("TASK_PACK_DRAFT_PROJECT_NOT_FOUND", input.id);
      }
      if (input.taskPackId !== null) {
        const taskPack = await client.query(
          "SELECT id, project_id FROM task_packs WHERE id = $1;",
          [input.taskPackId],
        );
        if (taskPack.rowCount !== 1) {
          throw new TaskPackDraftStorageError("TASK_PACK_DRAFT_TASK_PACK_NOT_FOUND", input.id);
        }
        if (Number(taskPack.rows[0]!.project_id) !== input.projectId) {
          throw new TaskPackDraftStorageError("TASK_PACK_DRAFT_OWNERSHIP_INVALID", input.id);
        }
      }
      if (input.baseRevisionId !== null) {
        const revision = await client.query(
          "SELECT id FROM task_pack_revisions WHERE id = $1 AND task_pack_id = $2;",
          [input.baseRevisionId, input.taskPackId],
        );
        if (revision.rowCount !== 1) {
          throw new TaskPackDraftStorageError("TASK_PACK_DRAFT_BASE_REVISION_INVALID", input.id);
        }
      }
      const existing = await client.query("SELECT id FROM task_pack_drafts WHERE id = $1;", [input.id]);
      if (existing.rowCount !== 0) {
        throw new TaskPackDraftStorageError("TASK_PACK_DRAFT_ALREADY_EXISTS", input.id);
      }
      const inserted = await client.query(
        `INSERT INTO task_pack_drafts (
          id, project_id, task_pack_id, base_revision_id, content,
          lifecycle_state, materialized_revision_id, draft_version,
          created_at, updated_at, expires_at
        ) VALUES ($1, $2, $3, $4, $5::jsonb, 'active', NULL, 1, $6, $7, $8)
        RETURNING *;`,
        [
          candidate.id,
          candidate.projectId,
          candidate.taskPackId,
          candidate.baseRevisionId,
          serializeTaskPackDraftContent(candidate.content),
          candidate.createdAt,
          candidate.updatedAt,
          candidate.expiresAt,
        ],
      );
      if (inserted.rowCount !== 1 || !inserted.rows[0]) {
        throw new TaskPackDraftStorageError("TASK_PACK_DRAFT_STATE_INVALID", input.id);
      }
      const created = mapTaskPackDraftPersistenceRow(
        inserted.rows[0] as TaskPackDraftPersistenceRow,
      );
      await client.query("COMMIT");
      return created;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original storage error.
      }
      if ((error as { code?: unknown })?.code === "23505") {
        throw new TaskPackDraftStorageError("TASK_PACK_DRAFT_ALREADY_EXISTS", input.id);
      }
      if ((error as { code?: unknown })?.code === "23503") {
        throw new TaskPackDraftStorageError("TASK_PACK_DRAFT_OWNERSHIP_INVALID", input.id);
      }
      if ((error as { code?: unknown })?.code === "23514") {
        throw new TaskPackDraftStorageError("TASK_PACK_DRAFT_STATE_INVALID", input.id);
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async updateTaskPackDraft(input: UpdateTaskPackDraftInput): Promise<TaskPackDraftRecord> {
    assertTaskPackDraftVersionToken(input.draftId, input.expectedDraftVersion);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query(
        "SELECT * FROM task_pack_drafts WHERE id = $1 FOR UPDATE;",
        [input.draftId],
      );
      if (selected.rowCount !== 1 || !selected.rows[0]) {
        throw new TaskPackDraftStorageError("TASK_PACK_DRAFT_NOT_FOUND", input.draftId);
      }
      const current = mapTaskPackDraftPersistenceRow(
        selected.rows[0] as TaskPackDraftPersistenceRow,
      );
      if (current.draftVersion !== input.expectedDraftVersion) {
        throw new TaskPackDraftStorageError(
          "TASK_PACK_DRAFT_CONFLICT",
          input.draftId,
          input.expectedDraftVersion,
          current.draftVersion,
        );
      }
      if (current.lifecycle.state !== "active") {
        throw new TaskPackDraftStorageError(
          "TASK_PACK_DRAFT_NOT_EDITABLE",
          input.draftId,
          input.expectedDraftVersion,
          current.draftVersion,
          current.lifecycle.state,
        );
      }
      const proposed: TaskPackDraftRecord = { ...current, content: input.content };
      assertTaskPackDraftRecordForStorage(proposed);
      if (taskPackDraftContentsEqual(current.content, proposed.content)) {
        await client.query("COMMIT");
        return current;
      }
      if (current.draftVersion === Number.MAX_SAFE_INTEGER) {
        throw new TaskPackDraftStorageError(
          "TASK_PACK_DRAFT_VERSION_EXHAUSTED",
          input.draftId,
          input.expectedDraftVersion,
          current.draftVersion,
        );
      }
      const updatedAt = nextTaskPackDraftUpdatedAt(current.updatedAt);
      const updated = await client.query(
        `UPDATE task_pack_drafts
         SET content = $1::jsonb, draft_version = draft_version + 1, updated_at = $2
         WHERE id = $3 AND lifecycle_state = 'active' AND draft_version = $4
         RETURNING *;`,
        [
          serializeTaskPackDraftContent(proposed.content),
          updatedAt,
          input.draftId,
          input.expectedDraftVersion,
        ],
      );
      if (updated.rowCount !== 1 || !updated.rows[0]) {
        throw new TaskPackDraftStorageError("TASK_PACK_DRAFT_STATE_INVALID", input.draftId);
      }
      const result = mapTaskPackDraftPersistenceRow(
        updated.rows[0] as TaskPackDraftPersistenceRow,
      );
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original storage error.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async discardTaskPackDraft(input: DiscardTaskPackDraftInput): Promise<TaskPackDraftRecord> {
    assertTaskPackDraftVersionToken(input.draftId, input.expectedDraftVersion);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query(
        "SELECT * FROM task_pack_drafts WHERE id = $1 FOR UPDATE;",
        [input.draftId],
      );
      if (selected.rowCount !== 1 || !selected.rows[0]) {
        throw new TaskPackDraftStorageError("TASK_PACK_DRAFT_NOT_FOUND", input.draftId);
      }
      const current = mapTaskPackDraftPersistenceRow(
        selected.rows[0] as TaskPackDraftPersistenceRow,
      );
      if (current.draftVersion !== input.expectedDraftVersion) {
        throw new TaskPackDraftStorageError(
          "TASK_PACK_DRAFT_CONFLICT",
          input.draftId,
          input.expectedDraftVersion,
          current.draftVersion,
        );
      }
      if (current.lifecycle.state !== "active") {
        throw new TaskPackDraftStorageError(
          "TASK_PACK_DRAFT_NOT_EDITABLE",
          input.draftId,
          input.expectedDraftVersion,
          current.draftVersion,
          current.lifecycle.state,
        );
      }
      if (current.draftVersion === Number.MAX_SAFE_INTEGER) {
        throw new TaskPackDraftStorageError(
          "TASK_PACK_DRAFT_VERSION_EXHAUSTED",
          input.draftId,
          input.expectedDraftVersion,
          current.draftVersion,
        );
      }
      const proposed: TaskPackDraftRecord = {
        ...current,
        lifecycle: transitionTaskPackDraft(current.lifecycle, { type: "discard" }),
        draftVersion: current.draftVersion + 1,
        updatedAt: nextTaskPackDraftUpdatedAt(current.updatedAt),
      };
      assertTaskPackDraftRecordForStorage(proposed);
      const updated = await client.query(
        `UPDATE task_pack_drafts
         SET lifecycle_state = 'discarded', materialized_revision_id = NULL,
             draft_version = draft_version + 1, updated_at = $1
         WHERE id = $2 AND lifecycle_state = 'active' AND draft_version = $3
         RETURNING *;`,
        [
          proposed.updatedAt,
          input.draftId,
          input.expectedDraftVersion,
        ],
      );
      if (updated.rowCount !== 1 || !updated.rows[0]) {
        throw new TaskPackDraftStorageError("TASK_PACK_DRAFT_STATE_INVALID", input.draftId);
      }
      const result = mapTaskPackDraftPersistenceRow(
        updated.rows[0] as TaskPackDraftPersistenceRow,
      );
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original storage error.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async materializeTaskPackDraft(
    input: MaterializeTaskPackDraftInput,
  ): Promise<MaterializeTaskPackDraftResult> {
    const expectedContentHash = validateMaterializeTaskPackDraftInput(input);
    const content = input.revisionContent;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query(
        "SELECT * FROM task_pack_drafts WHERE id = $1 FOR UPDATE;",
        [input.draftId],
      );
      if (selected.rowCount !== 1 || !selected.rows[0]) {
        throw new TaskPackDraftStorageError("TASK_PACK_DRAFT_NOT_FOUND", input.draftId);
      }
      const current = mapTaskPackDraftPersistenceRow(
        selected.rows[0] as TaskPackDraftPersistenceRow,
      );
      if (current.draftVersion !== input.expectedDraftVersion) {
        throw new TaskPackDraftStorageError(
          "TASK_PACK_DRAFT_CONFLICT",
          input.draftId,
          input.expectedDraftVersion,
          current.draftVersion,
        );
      }
      if (current.lifecycle.state !== "active") {
        throw new TaskPackDraftStorageError(
          "TASK_PACK_DRAFT_NOT_EDITABLE",
          input.draftId,
          input.expectedDraftVersion,
          current.draftVersion,
          current.lifecycle.state,
        );
      }
      if (current.draftVersion === Number.MAX_SAFE_INTEGER) {
        throw new TaskPackDraftStorageError(
          "TASK_PACK_DRAFT_VERSION_EXHAUSTED",
          input.draftId,
          input.expectedDraftVersion,
          current.draftVersion,
        );
      }
      if (current.taskPackId !== null || current.baseRevisionId !== null) {
        throw new TaskPackDraftStorageError(
          "TASK_PACK_DRAFT_ALREADY_BOUND",
          input.draftId,
        );
      }

      const project = await client.query(
        "SELECT id FROM projects WHERE id = $1 FOR KEY SHARE;",
        [current.projectId],
      );
      if (project.rowCount !== 1 || !project.rows[0]) {
        throw new TaskPackDraftStorageError(
          "TASK_PACK_DRAFT_PROJECT_NOT_FOUND",
          input.draftId,
        );
      }

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
          current.projectId,
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
      if (taskPackResult.rowCount !== 1 || !taskPackResult.rows[0]) {
        throw new TaskPackDraftStorageError(
          "TASK_PACK_DRAFT_STATE_INVALID",
          input.draftId,
        );
      }
      const taskPack = mapTaskPackRow(taskPackResult.rows[0]);
      const createdAtValue = taskPackResult.rows[0].createdAt as string | Date;
      const persistenceCreatedAt = createdAtValue instanceof Date
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
          expectedContentHash,
          persistenceCreatedAt,
          input.generatedAt,
        ],
      );
      if (revisionResult.rowCount !== 1 || !revisionResult.rows[0]) {
        throw new TaskPackDraftStorageError(
          "TASK_PACK_DRAFT_STATE_INVALID",
          input.draftId,
        );
      }
      const revision = mapTaskPackRevisionPersistenceRow(
        revisionResult.rows[0] as TaskPackRevisionPersistenceRow,
      );

      const pointerUpdate = await client.query(
        `UPDATE task_packs
         SET current_revision_id = $1
         WHERE id = $2 AND current_revision_id IS NULL;`,
        [revision.id, taskPack.id],
      );
      if (pointerUpdate.rowCount !== 1) {
        throw new TaskPackDraftStorageError(
          "TASK_PACK_DRAFT_STATE_INVALID",
          input.draftId,
        );
      }

      const updatedAt = nextTaskPackDraftUpdatedAt(current.updatedAt);
      const draftUpdate = await client.query(
        `UPDATE task_pack_drafts
         SET task_pack_id = $1, lifecycle_state = 'materialized',
             materialized_revision_id = $2, draft_version = draft_version + 1,
             updated_at = $3
         WHERE id = $4 AND lifecycle_state = 'active' AND draft_version = $5
           AND task_pack_id IS NULL AND base_revision_id IS NULL
           AND materialized_revision_id IS NULL
         RETURNING *;`,
        [
          taskPack.id,
          revision.id,
          updatedAt,
          input.draftId,
          input.expectedDraftVersion,
        ],
      );
      if (draftUpdate.rowCount !== 1 || !draftUpdate.rows[0]) {
        throw new TaskPackDraftStorageError(
          "TASK_PACK_DRAFT_STATE_INVALID",
          input.draftId,
        );
      }
      const draft = mapTaskPackDraftPersistenceRow(
        draftUpdate.rows[0] as TaskPackDraftPersistenceRow,
      );

      const aggregateResult = await client.query(
        `SELECT id, project_id, title, lifecycle_state, archived_from_state,
                current_revision_id, accepted_revision_id, lifecycle_version,
                created_at, updated_at, completed_at, archived_at
         FROM task_packs WHERE id = $1;`,
        [taskPack.id],
      );
      if (aggregateResult.rowCount !== 1 || !aggregateResult.rows[0]) {
        throw new TaskPackDraftStorageError(
          "TASK_PACK_DRAFT_STATE_INVALID",
          input.draftId,
        );
      }
      const aggregate = mapTaskPackAggregatePersistenceRow(
        aggregateResult.rows[0] as TaskPackAggregatePersistenceRow,
      );
      if (
        aggregate.id !== taskPack.id ||
        aggregate.projectId !== current.projectId ||
        aggregate.lifecycle.state !== "active" ||
        aggregate.lifecycleVersion !== 1 ||
        aggregate.currentRevisionId !== revision.id ||
        aggregate.acceptedRevisionId !== null ||
        revision.taskPackId !== aggregate.id ||
        revision.revisionNumber !== 1 ||
        revision.baseRevisionId !== null ||
        revision.sourceKind !== "generated" ||
        revision.generatedAt !== input.generatedAt ||
        revision.contentHash !== expectedContentHash ||
        draft.taskPackId !== aggregate.id ||
        draft.baseRevisionId !== null ||
        draft.lifecycle.state !== "materialized" ||
        draft.lifecycle.materializedRevisionId !== revision.id ||
        draft.draftVersion !== current.draftVersion + 1 ||
        draft.createdAt !== current.createdAt ||
        draft.expiresAt !== current.expiresAt ||
        !taskPackDraftContentsEqual(draft.content, current.content)
      ) {
        throw new TaskPackDraftStorageError(
          "TASK_PACK_DRAFT_STATE_INVALID",
          input.draftId,
        );
      }
      assertTaskPackRevision(revision, {
        aggregate,
        verifyContentHash: true,
      });
      assertTaskPackDraftRecordForStorage(draft);

      await client.query("COMMIT");
      return { taskPack, revision, draft };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original storage error.
      }
      throw error;
    } finally {
      client.release();
    }
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
        github_link.task_pack_id AS "githubLinkTaskPackId",
        github_link.owner AS "githubLinkOwner",
        github_link.repo AS "githubLinkRepo",
        github_link.full_name AS "githubLinkFullName",
        github_link.issue_number AS "githubLinkIssueNumber",
        github_link.issue_title AS "githubLinkIssueTitle",
        github_link.issue_url AS "githubLinkIssueUrl",
        github_link.issue_state AS "githubLinkIssueState",
        github_link.labels AS "githubLinkLabels",
        github_link.repository_url AS "githubLinkRepositoryUrl",
        github_link.created_at AS "githubLinkCreatedAt",
        tp.created_at AS "createdAt",
        tp.updated_at AS "updatedAt"
      FROM task_packs tp
      JOIN projects p ON p.id = tp.project_id
      LEFT JOIN task_pack_github_created_issue_links github_link
        ON github_link.task_pack_id = tp.id
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
        github_link.task_pack_id AS "githubLinkTaskPackId",
        github_link.owner AS "githubLinkOwner",
        github_link.repo AS "githubLinkRepo",
        github_link.full_name AS "githubLinkFullName",
        github_link.issue_number AS "githubLinkIssueNumber",
        github_link.issue_title AS "githubLinkIssueTitle",
        github_link.issue_url AS "githubLinkIssueUrl",
        github_link.issue_state AS "githubLinkIssueState",
        github_link.labels AS "githubLinkLabels",
        github_link.repository_url AS "githubLinkRepositoryUrl",
        github_link.created_at AS "githubLinkCreatedAt",
        tp.created_at AS "createdAt",
        tp.updated_at AS "updatedAt"
      FROM task_packs tp
      JOIN projects p ON p.id = tp.project_id
      LEFT JOIN task_pack_github_created_issue_links github_link
        ON github_link.task_pack_id = tp.id
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
        github_link.task_pack_id AS "githubLinkTaskPackId",
        github_link.owner AS "githubLinkOwner",
        github_link.repo AS "githubLinkRepo",
        github_link.full_name AS "githubLinkFullName",
        github_link.issue_number AS "githubLinkIssueNumber",
        github_link.issue_title AS "githubLinkIssueTitle",
        github_link.issue_url AS "githubLinkIssueUrl",
        github_link.issue_state AS "githubLinkIssueState",
        github_link.labels AS "githubLinkLabels",
        github_link.repository_url AS "githubLinkRepositoryUrl",
        github_link.created_at AS "githubLinkCreatedAt",
        tp.created_at AS "createdAt",
        tp.updated_at AS "updatedAt",
        tp.current_revision_id AS "currentRevisionId",
        current_revision.id AS "resolvedCurrentRevisionId",
        current_revision.task_pack_id AS "currentRevisionTaskPackId"
      FROM task_packs tp
      JOIN projects p ON p.id = tp.project_id
      LEFT JOIN task_pack_revisions current_revision
        ON current_revision.id = tp.current_revision_id
      LEFT JOIN task_pack_github_created_issue_links github_link
        ON github_link.task_pack_id = tp.id
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
        github_link.task_pack_id AS "githubLinkTaskPackId",
        github_link.owner AS "githubLinkOwner",
        github_link.repo AS "githubLinkRepo",
        github_link.full_name AS "githubLinkFullName",
        github_link.issue_number AS "githubLinkIssueNumber",
        github_link.issue_title AS "githubLinkIssueTitle",
        github_link.issue_url AS "githubLinkIssueUrl",
        github_link.issue_state AS "githubLinkIssueState",
        github_link.labels AS "githubLinkLabels",
        github_link.repository_url AS "githubLinkRepositoryUrl",
        github_link.created_at AS "githubLinkCreatedAt",
        tp.created_at AS "createdAt",
        tp.updated_at AS "updatedAt",
        tp.current_revision_id AS "currentRevisionId",
        current_revision.id AS "resolvedCurrentRevisionId",
        current_revision.task_pack_id AS "currentRevisionTaskPackId"
      FROM task_packs tp
      JOIN projects p ON p.id = tp.project_id
      LEFT JOIN task_pack_revisions current_revision
        ON current_revision.id = tp.current_revision_id
      LEFT JOIN task_pack_github_created_issue_links github_link
        ON github_link.task_pack_id = tp.id
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

  async getTaskPackGitHubCreatedIssueLink(
    taskPackId: number,
  ): Promise<TaskPackGitHubCreatedIssueLinkRecord | null> {
    const result = await pool.query(
      `SELECT task_pack_id AS "githubLinkTaskPackId",
              owner AS "githubLinkOwner",
              repo AS "githubLinkRepo",
              full_name AS "githubLinkFullName",
              issue_number AS "githubLinkIssueNumber",
              issue_title AS "githubLinkIssueTitle",
              issue_url AS "githubLinkIssueUrl",
              issue_state AS "githubLinkIssueState",
              labels AS "githubLinkLabels",
              repository_url AS "githubLinkRepositoryUrl",
              created_at AS "githubLinkCreatedAt"
       FROM task_pack_github_created_issue_links
       WHERE task_pack_id = $1;`,
      [taskPackId],
    );
    return result.rows[0]
      ? mapTaskPackGitHubCreatedIssueLinkRow(result.rows[0])
      : null;
  }

  async createTaskPackGitHubCreatedIssueLink(
    input: CreateTaskPackGitHubCreatedIssueLinkInput,
  ): Promise<TaskPackGitHubCreatedIssueLinkRecord> {
    assertTaskPackGitHubCreatedIssueLinkInput(input);
    try {
      const result = await pool.query(
        `INSERT INTO task_pack_github_created_issue_links (
          task_pack_id, owner, repo, full_name, issue_number, issue_title,
          issue_url, issue_state, labels, repository_url, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
        RETURNING task_pack_id AS "githubLinkTaskPackId",
                  owner AS "githubLinkOwner",
                  repo AS "githubLinkRepo",
                  full_name AS "githubLinkFullName",
                  issue_number AS "githubLinkIssueNumber",
                  issue_title AS "githubLinkIssueTitle",
                  issue_url AS "githubLinkIssueUrl",
                  issue_state AS "githubLinkIssueState",
                  labels AS "githubLinkLabels",
                  repository_url AS "githubLinkRepositoryUrl",
                  created_at AS "githubLinkCreatedAt";`,
        [
          input.taskPackId,
          input.owner,
          input.repo,
          input.fullName,
          input.issueNumber,
          input.issueTitle,
          input.issueUrl,
          input.issueState,
          JSON.stringify(input.labels),
          input.repositoryUrl,
          input.createdAt,
        ],
      );
      const created = mapTaskPackGitHubCreatedIssueLinkRow(result.rows[0]);
      if (!created) {
        throw new Error("Failed to read created Task Pack GitHub issue linkage.");
      }
      return created;
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (code === "23505") {
        throw new TaskPackGitHubCreatedIssueLinkStorageError(
          "TASK_PACK_GITHUB_CREATED_ISSUE_LINK_EXISTS",
        );
      }
      if (code === "23503") {
        throw new TaskPackGitHubCreatedIssueLinkStorageError(
          "TASK_PACK_NOT_FOUND",
        );
      }
      throw error;
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
      if (!aggregateResult.rows[0]) {
        throw new TaskPackRevisionAppendStorageError(
          "TASK_PACK_NOT_FOUND",
          input.taskPackId,
        );
      }
      const aggregate = mapTaskPackAggregatePersistenceRow(
        aggregateResult.rows[0] as TaskPackAggregatePersistenceRow,
      );
      if (aggregate.lifecycle.state !== "active") {
        throw new TaskPackRevisionAppendStorageError(
          "TASK_PACK_NOT_ACTIVE",
          input.taskPackId,
        );
      }
      if (aggregate.currentRevisionId !== input.baseRevisionId) {
        throw new TaskPackRevisionAppendStorageError(
          "TASK_PACK_REVISION_CONFLICT",
          input.taskPackId,
          input.baseRevisionId,
          aggregate.currentRevisionId,
        );
      }
      const baseResult = await client.query(
        "SELECT * FROM task_pack_revisions WHERE task_pack_id = $1 AND id = $2;",
        [input.taskPackId, input.baseRevisionId],
      );
      if (!baseResult.rows[0]) {
        throw new TaskPackRevisionAppendStorageError(
          "TASK_PACK_BASE_REVISION_INVALID",
          input.taskPackId,
          input.baseRevisionId,
          aggregate.currentRevisionId,
        );
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
      const pointerUpdate = await client.query(
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
      if (pointerUpdate.rowCount !== 1) {
        throw new TaskPackCurrentStateStorageError();
      }
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
