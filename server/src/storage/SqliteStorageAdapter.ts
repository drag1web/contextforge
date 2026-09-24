import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import initSqlJs from "sql.js";
import type { Database, SqlJsStatic, SqlValue } from "sql.js";

import type { ScannedProject } from "../scanner/projectScanner.js";
import type { RulesAndTemplatesStore } from "../rules/types.js";
import {
  assertTaskPackAggregateLifecycleEvent,
  assertTaskPackRevision,
  assertTaskPackRevisionReviewEvent,
  computeTaskPackRevisionContentHash,
  transitionTaskPackDraft,
  type TaskPackRevisionContent,
} from "../taskPacks/taskPackLifecycle.js";
import { parseJsonValue, stringifyJsonValue } from "./json.js";
import {
  assertTaskPackGitHubCreatedIssueLinkInput,
  projectTaskPackGenerationRecipeWithGitHubCreatedIssue,
  TaskPackCurrentStateStorageError,
  TaskPackGitHubCreatedIssueLinkStorageError,
  TaskPackDraftStorageError,
  TaskPackRevisionAppendStorageError,
} from "./types.js";
import {
  applySqliteMigrationTransaction,
  SQLITE_MIGRATIONS,
  SQLITE_SCHEMA_VERSION,
  TASK_PACK_LIFECYCLE_MIGRATION_ID,
  type SqliteMigrationTransactionHooks,
} from "./migrations.js";
import {
  createSqlitePreMigrationBackup,
  type SqlitePreMigrationBackupInput,
  type SqlitePreMigrationBackupResult,
} from "./storageBackupPaths.js";
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
  RulesAndTemplatesCatalogStats,
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
  github_link_task_pack_id?: number | null;
  github_link_owner?: string | null;
  github_link_repo?: string | null;
  github_link_full_name?: string | null;
  github_link_issue_number?: number | null;
  github_link_issue_title?: string | null;
  github_link_issue_url?: string | null;
  github_link_issue_state?: "open" | "closed" | null;
  github_link_labels?: string | null;
  github_link_repository_url?: string | null;
  github_link_created_at?: string | null;
};

type TaskPackCurrentRow = TaskPackRow & {
  current_revision_id: number | null;
  resolved_current_revision_id: number | null;
  current_revision_task_pack_id: number | null;
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

export interface SqliteStorageAdapterOptions {
  readonly migrationBackupDirectory?: string;
  readonly createPreMigrationBackup?: (
    input: SqlitePreMigrationBackupInput,
  ) => SqlitePreMigrationBackupResult;
  /** Narrow failure-injection seam used by migration transaction smoke tests. */
  readonly migrationTransactionHooks?: SqliteMigrationTransactionHooks;
}

function nowIso() {
  return new Date().toISOString();
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

function mapTaskPackGitHubCreatedIssueLinkRow(
  row: TaskPackRow,
): TaskPackGitHubCreatedIssueLinkRecord | null {
  if (row.github_link_task_pack_id === null || row.github_link_task_pack_id === undefined) {
    return null;
  }
  const link: TaskPackGitHubCreatedIssueLinkRecord = {
    taskPackId: Number(row.github_link_task_pack_id),
    owner: row.github_link_owner as string,
    repo: row.github_link_repo as string,
    fullName: row.github_link_full_name as string,
    issueNumber: Number(row.github_link_issue_number),
    issueTitle: row.github_link_issue_title as string,
    issueUrl: row.github_link_issue_url as string,
    issueState: row.github_link_issue_state as "open" | "closed",
    labels: parseJsonValue<unknown>(row.github_link_labels, null) as string[],
    repositoryUrl: row.github_link_repository_url as string,
    createdAt: row.github_link_created_at as string,
  };
  assertTaskPackGitHubCreatedIssueLinkInput(link);
  return link;
}

function mapTaskPackRow(row: TaskPackRow): TaskPackRecord {
  const storedRecipe = parseJsonValue(row.generation_recipe, null);
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
    generationRecipe: projectTaskPackGenerationRecipeWithGitHubCreatedIssue(
      storedRecipe,
      mapTaskPackGitHubCreatedIssueLinkRow(row),
    ),
    createdAt: row.created_at,
    updatedAt: row.updated_at
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

function mapTaskPackCurrentRow(row: TaskPackCurrentRow): TaskPackCurrentRecord {
  const currentRevisionId = Number(row.current_revision_id);
  if (
    !Number.isSafeInteger(currentRevisionId) ||
    currentRevisionId <= 0 ||
    Number(row.resolved_current_revision_id) !== currentRevisionId ||
    Number(row.current_revision_task_pack_id) !== row.id
  ) {
    throw new TaskPackCurrentStateStorageError();
  }
  return {
    ...mapTaskPackRow(row),
    currentRevisionId,
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
  private loadedPersistedDatabase = false;
  private lifecycleMigrationPreflightComplete = false;

  constructor(
    private readonly databasePath: string,
    private readonly options: SqliteStorageAdapterOptions = {},
  ) {}

  async ensureSchema() {
    const db = await this.getDatabase();

    this.ensureTaskPackLifecycleMigrationPreflight(db);

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

  async listActiveTaskPackDrafts(projectId?: number): Promise<TaskPackDraftRecord[]> {
    const rows = await this.getAll<TaskPackDraftPersistenceRow>(
      projectId === undefined
        ? `SELECT * FROM task_pack_drafts
           WHERE lifecycle_state = 'active'
           ORDER BY updated_at DESC, id ASC;`
        : `SELECT * FROM task_pack_drafts
           WHERE lifecycle_state = 'active' AND project_id = ?
           ORDER BY updated_at DESC, id ASC;`,
      projectId === undefined ? [] : [projectId],
    );
    return rows.map(mapTaskPackDraftPersistenceRow);
  }

  async getTaskPackDraftById(draftId: string): Promise<TaskPackDraftRecord | null> {
    const row = await this.getOne<TaskPackDraftPersistenceRow>(
      "SELECT * FROM task_pack_drafts WHERE id = ?;",
      [draftId],
    );
    return row ? mapTaskPackDraftPersistenceRow(row) : null;
  }

  async createTaskPackDraft(input: CreateTaskPackDraftInput): Promise<TaskPackDraftRecord> {
    const timestamp = nowIso();
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

    return this.withTransaction(async () => {
      const project = await this.getOne<{ id: number }>(
        "SELECT id FROM projects WHERE id = ?;",
        [input.projectId],
      );
      if (!project) {
        throw new TaskPackDraftStorageError("TASK_PACK_DRAFT_PROJECT_NOT_FOUND", input.id);
      }
      if (input.taskPackId !== null) {
        const taskPack = await this.getOne<{ id: number; project_id: number }>(
          "SELECT id, project_id FROM task_packs WHERE id = ?;",
          [input.taskPackId],
        );
        if (!taskPack) {
          throw new TaskPackDraftStorageError("TASK_PACK_DRAFT_TASK_PACK_NOT_FOUND", input.id);
        }
        if (Number(taskPack.project_id) !== input.projectId) {
          throw new TaskPackDraftStorageError("TASK_PACK_DRAFT_OWNERSHIP_INVALID", input.id);
        }
      }
      if (input.baseRevisionId !== null) {
        const revision = await this.getOne<{ id: number }>(
          "SELECT id FROM task_pack_revisions WHERE id = ? AND task_pack_id = ?;",
          [input.baseRevisionId, input.taskPackId],
        );
        if (!revision) {
          throw new TaskPackDraftStorageError("TASK_PACK_DRAFT_BASE_REVISION_INVALID", input.id);
        }
      }
      if (await this.getOne<{ id: string }>("SELECT id FROM task_pack_drafts WHERE id = ?;", [input.id])) {
        throw new TaskPackDraftStorageError("TASK_PACK_DRAFT_ALREADY_EXISTS", input.id);
      }

      try {
        await this.run(
          `INSERT INTO task_pack_drafts (
            id, project_id, task_pack_id, base_revision_id, content,
            lifecycle_state, materialized_revision_id, draft_version,
            created_at, updated_at, expires_at
          ) VALUES (?, ?, ?, ?, ?, 'active', NULL, 1, ?, ?, ?);`,
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
      } catch (error) {
        if (String(error).includes("UNIQUE constraint failed: task_pack_drafts.id")) {
          throw new TaskPackDraftStorageError("TASK_PACK_DRAFT_ALREADY_EXISTS", input.id);
        }
        throw error;
      }
      const created = await this.getTaskPackDraftById(input.id);
      if (!created) throw new TaskPackDraftStorageError("TASK_PACK_DRAFT_STATE_INVALID", input.id);
      return created;
    });
  }

  async updateTaskPackDraft(input: UpdateTaskPackDraftInput): Promise<TaskPackDraftRecord> {
    assertTaskPackDraftVersionToken(input.draftId, input.expectedDraftVersion);
    return this.withTransaction(async () => {
      const current = await this.getTaskPackDraftById(input.draftId);
      if (!current) {
        throw new TaskPackDraftStorageError("TASK_PACK_DRAFT_NOT_FOUND", input.draftId);
      }
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
      if (taskPackDraftContentsEqual(current.content, proposed.content)) return current;
      if (current.draftVersion === Number.MAX_SAFE_INTEGER) {
        throw new TaskPackDraftStorageError(
          "TASK_PACK_DRAFT_VERSION_EXHAUSTED",
          input.draftId,
          input.expectedDraftVersion,
          current.draftVersion,
        );
      }
      const updatedAt = nextTaskPackDraftUpdatedAt(current.updatedAt);
      await this.run(
        `UPDATE task_pack_drafts
         SET content = ?, draft_version = draft_version + 1, updated_at = ?
         WHERE id = ? AND lifecycle_state = 'active' AND draft_version = ?;`,
        [
          serializeTaskPackDraftContent(proposed.content),
          updatedAt,
          input.draftId,
          input.expectedDraftVersion,
        ],
      );
      const changed = await this.getOne<{ changed: number }>("SELECT changes() AS changed;");
      if (Number(changed?.changed ?? 0) !== 1) {
        throw new TaskPackDraftStorageError("TASK_PACK_DRAFT_STATE_INVALID", input.draftId);
      }
      const updated = await this.getTaskPackDraftById(input.draftId);
      if (!updated) throw new TaskPackDraftStorageError("TASK_PACK_DRAFT_STATE_INVALID", input.draftId);
      return updated;
    });
  }

  async discardTaskPackDraft(input: DiscardTaskPackDraftInput): Promise<TaskPackDraftRecord> {
    assertTaskPackDraftVersionToken(input.draftId, input.expectedDraftVersion);
    return this.withTransaction(async () => {
      const current = await this.getTaskPackDraftById(input.draftId);
      if (!current) {
        throw new TaskPackDraftStorageError("TASK_PACK_DRAFT_NOT_FOUND", input.draftId);
      }
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
      await this.run(
        `UPDATE task_pack_drafts
         SET lifecycle_state = 'discarded', materialized_revision_id = NULL,
             draft_version = draft_version + 1, updated_at = ?
         WHERE id = ? AND lifecycle_state = 'active' AND draft_version = ?;`,
        [proposed.updatedAt, input.draftId, input.expectedDraftVersion],
      );
      const changed = await this.getOne<{ changed: number }>("SELECT changes() AS changed;");
      if (Number(changed?.changed ?? 0) !== 1) {
        throw new TaskPackDraftStorageError("TASK_PACK_DRAFT_STATE_INVALID", input.draftId);
      }
      const discarded = await this.getTaskPackDraftById(input.draftId);
      if (!discarded) throw new TaskPackDraftStorageError("TASK_PACK_DRAFT_STATE_INVALID", input.draftId);
      return discarded;
    });
  }

  async materializeTaskPackDraft(
    input: MaterializeTaskPackDraftInput,
  ): Promise<MaterializeTaskPackDraftResult> {
    const expectedContentHash = validateMaterializeTaskPackDraftInput(input);
    const content = input.revisionContent;

    return this.withTransaction(async () => {
      const current = await this.getTaskPackDraftById(input.draftId);
      if (!current) {
        throw new TaskPackDraftStorageError("TASK_PACK_DRAFT_NOT_FOUND", input.draftId);
      }
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

      const project = await this.getOne<{ id: number }>(
        "SELECT id FROM projects WHERE id = ?;",
        [current.projectId],
      );
      if (!project) {
        throw new TaskPackDraftStorageError(
          "TASK_PACK_DRAFT_PROJECT_NOT_FOUND",
          input.draftId,
        );
      }

      const persistenceTimestamp = nowIso();
      await this.run(
        `INSERT INTO task_packs (
          project_id, title, raw_task, task_type, target_tool, generated_prompt,
          generation_mode, generation_model, generation_message,
          generation_used_fallback, generation_duration_ms, generation_recipe,
          lifecycle_state, lifecycle_version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?);`,
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
          content.generationUsedFallback ? 1 : 0,
          content.generationDurationMs,
          stringifyJsonValue(input.compatibilityGenerationRecipe),
          persistenceTimestamp,
          persistenceTimestamp,
        ],
      );
      const taskPackId = await this.getLastInsertRowId();

      await this.insertTaskPackRevision({
        taskPackId,
        revisionNumber: 1,
        baseRevisionId: null,
        content,
        createdAt: persistenceTimestamp,
        generatedAt: input.generatedAt,
      });
      const revisionId = await this.getLastInsertRowId();

      await this.run(
        `UPDATE task_packs
         SET current_revision_id = ?
         WHERE id = ? AND current_revision_id IS NULL;`,
        [revisionId, taskPackId],
      );
      const pointerChange = await this.getOne<{ changed: number }>(
        "SELECT changes() AS changed;",
      );
      if (Number(pointerChange?.changed ?? 0) !== 1) {
        throw new TaskPackDraftStorageError(
          "TASK_PACK_DRAFT_STATE_INVALID",
          input.draftId,
        );
      }

      const updatedAt = nextTaskPackDraftUpdatedAt(current.updatedAt);
      await this.run(
        `UPDATE task_pack_drafts
         SET task_pack_id = ?, lifecycle_state = 'materialized',
             materialized_revision_id = ?, draft_version = draft_version + 1,
             updated_at = ?
         WHERE id = ? AND lifecycle_state = 'active' AND draft_version = ?
           AND task_pack_id IS NULL AND base_revision_id IS NULL
           AND materialized_revision_id IS NULL;`,
        [taskPackId, revisionId, updatedAt, input.draftId, input.expectedDraftVersion],
      );
      const draftChange = await this.getOne<{ changed: number }>(
        "SELECT changes() AS changed;",
      );
      if (Number(draftChange?.changed ?? 0) !== 1) {
        throw new TaskPackDraftStorageError(
          "TASK_PACK_DRAFT_STATE_INVALID",
          input.draftId,
        );
      }

      const aggregate = await this.getTaskPackAggregate(taskPackId);
      const revision = await this.getTaskPackRevisionById(taskPackId, revisionId);
      const draft = await this.getTaskPackDraftById(input.draftId);
      const taskPackRow = await this.getOne<TaskPackRow>(
        `SELECT tp.*, p.name AS project_name
         FROM task_packs tp
         JOIN projects p ON p.id = tp.project_id
         WHERE tp.id = ?;`,
        [taskPackId],
      );
      if (!aggregate || !revision || !draft || !taskPackRow) {
        throw new TaskPackDraftStorageError(
          "TASK_PACK_DRAFT_STATE_INVALID",
          input.draftId,
        );
      }
      if (
        aggregate.id !== taskPackId ||
        aggregate.projectId !== current.projectId ||
        aggregate.lifecycle.state !== "active" ||
        aggregate.lifecycleVersion !== 1 ||
        aggregate.currentRevisionId !== revision.id ||
        aggregate.acceptedRevisionId !== null ||
        revision.id !== revisionId ||
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

      return {
        taskPack: mapTaskPackRow(taskPackRow),
        revision,
        draft,
      };
    });
  }

  async listTaskPacks(): Promise<TaskPackRecord[]> {
    const rows = await this.getAll<TaskPackRow>(`
      SELECT
        tp.*,
        p.name AS project_name,
        github_link.task_pack_id AS github_link_task_pack_id,
        github_link.owner AS github_link_owner,
        github_link.repo AS github_link_repo,
        github_link.full_name AS github_link_full_name,
        github_link.issue_number AS github_link_issue_number,
        github_link.issue_title AS github_link_issue_title,
        github_link.issue_url AS github_link_issue_url,
        github_link.issue_state AS github_link_issue_state,
        github_link.labels AS github_link_labels,
        github_link.repository_url AS github_link_repository_url,
        github_link.created_at AS github_link_created_at
      FROM task_packs tp
      JOIN projects p ON p.id = tp.project_id
      LEFT JOIN task_pack_github_created_issue_links github_link
        ON github_link.task_pack_id = tp.id
      ORDER BY tp.created_at DESC;
    `);

    return rows.map(mapTaskPackRow);
  }


  async getTaskPackById(taskPackId: number): Promise<TaskPackRecord | null> {
    const row = await this.getOne<TaskPackRow>(
      `
      SELECT
        tp.*,
        p.name AS project_name,
        github_link.task_pack_id AS github_link_task_pack_id,
        github_link.owner AS github_link_owner,
        github_link.repo AS github_link_repo,
        github_link.full_name AS github_link_full_name,
        github_link.issue_number AS github_link_issue_number,
        github_link.issue_title AS github_link_issue_title,
        github_link.issue_url AS github_link_issue_url,
        github_link.issue_state AS github_link_issue_state,
        github_link.labels AS github_link_labels,
        github_link.repository_url AS github_link_repository_url,
        github_link.created_at AS github_link_created_at
      FROM task_packs tp
      JOIN projects p ON p.id = tp.project_id
      LEFT JOIN task_pack_github_created_issue_links github_link
        ON github_link.task_pack_id = tp.id
      WHERE tp.id = ?;
      `,
      [taskPackId]
    );

    return row ? mapTaskPackRow(row) : null;
  }

  async listTaskPackCurrentRecords(): Promise<TaskPackCurrentRecord[]> {
    const rows = await this.getAll<TaskPackCurrentRow>(`
      SELECT
        tp.*,
        p.name AS project_name,
        current_revision.id AS resolved_current_revision_id,
        current_revision.task_pack_id AS current_revision_task_pack_id,
        github_link.task_pack_id AS github_link_task_pack_id,
        github_link.owner AS github_link_owner,
        github_link.repo AS github_link_repo,
        github_link.full_name AS github_link_full_name,
        github_link.issue_number AS github_link_issue_number,
        github_link.issue_title AS github_link_issue_title,
        github_link.issue_url AS github_link_issue_url,
        github_link.issue_state AS github_link_issue_state,
        github_link.labels AS github_link_labels,
        github_link.repository_url AS github_link_repository_url,
        github_link.created_at AS github_link_created_at
      FROM task_packs tp
      JOIN projects p ON p.id = tp.project_id
      LEFT JOIN task_pack_revisions current_revision
        ON current_revision.id = tp.current_revision_id
      LEFT JOIN task_pack_github_created_issue_links github_link
        ON github_link.task_pack_id = tp.id
      ORDER BY tp.created_at DESC;
    `);

    return rows.map(mapTaskPackCurrentRow);
  }

  async getTaskPackCurrentRecordById(
    taskPackId: number,
  ): Promise<TaskPackCurrentRecord | null> {
    const row = await this.getOne<TaskPackCurrentRow>(
      `
      SELECT
        tp.*,
        p.name AS project_name,
        current_revision.id AS resolved_current_revision_id,
        current_revision.task_pack_id AS current_revision_task_pack_id,
        github_link.task_pack_id AS github_link_task_pack_id,
        github_link.owner AS github_link_owner,
        github_link.repo AS github_link_repo,
        github_link.full_name AS github_link_full_name,
        github_link.issue_number AS github_link_issue_number,
        github_link.issue_title AS github_link_issue_title,
        github_link.issue_url AS github_link_issue_url,
        github_link.issue_state AS github_link_issue_state,
        github_link.labels AS github_link_labels,
        github_link.repository_url AS github_link_repository_url,
        github_link.created_at AS github_link_created_at
      FROM task_packs tp
      JOIN projects p ON p.id = tp.project_id
      LEFT JOIN task_pack_revisions current_revision
        ON current_revision.id = tp.current_revision_id
      LEFT JOIN task_pack_github_created_issue_links github_link
        ON github_link.task_pack_id = tp.id
      WHERE tp.id = ?;
      `,
      [taskPackId],
    );

    return row ? mapTaskPackCurrentRow(row) : null;
  }

  async createTaskPack(input: CreateTaskPackInput): Promise<TaskPackRecord> {
    const timestamp = nowIso();
    const content = buildCreatedTaskPackRevisionContent(input);
    const createdTaskPackId = await this.withTransaction(async () => {
      await this.run(
        `
        INSERT INTO task_packs (
          project_id, title, raw_task, task_type, target_tool, generated_prompt,
          generation_mode, generation_model, generation_message,
          generation_used_fallback, generation_duration_ms, generation_recipe,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
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
          timestamp,
        ],
      );

      const taskPackId = await this.getLastInsertRowId();
      await this.insertTaskPackRevision({
        taskPackId,
        revisionNumber: 1,
        baseRevisionId: null,
        content,
        createdAt: timestamp,
        generatedAt: content.sourceKind === "generated" ? timestamp : null,
      });
      const revisionId = await this.getLastInsertRowId();
      await this.run(
        `UPDATE task_packs
         SET current_revision_id = ?, lifecycle_state = 'active', lifecycle_version = 1
         WHERE id = ?;`,
        [revisionId, taskPackId],
      );
      return taskPackId;
    });

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

  async createTaskPackWithInitialRevision(
    input: CreateTaskPackWithInitialRevisionInput,
  ): Promise<TaskPackRecord> {
    const timestamp = nowIso();
    const content = input.revisionContent;
    const createdTaskPackId = await this.withTransaction(async () => {
      await this.run(
        `INSERT INTO task_packs (
          project_id, title, raw_task, task_type, target_tool, generated_prompt,
          generation_mode, generation_model, generation_message,
          generation_used_fallback, generation_duration_ms, generation_recipe,
          lifecycle_state, lifecycle_version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?);`,
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
          content.generationUsedFallback ? 1 : 0,
          content.generationDurationMs,
          stringifyJsonValue(input.compatibilityGenerationRecipe),
          timestamp,
          timestamp,
        ],
      );

      const taskPackId = await this.getLastInsertRowId();
      await this.insertTaskPackRevision({
        taskPackId,
        revisionNumber: 1,
        baseRevisionId: null,
        content,
        createdAt: timestamp,
        generatedAt: input.generatedAt,
      });
      const revisionId = await this.getLastInsertRowId();
      await this.run(
        `UPDATE task_packs
         SET current_revision_id = ?
         WHERE id = ? AND current_revision_id IS NULL;`,
        [revisionId, taskPackId],
      );

      const aggregate = await this.getTaskPackAggregate(taskPackId);
      const revision = await this.getCurrentTaskPackRevision(taskPackId);
      if (!aggregate || !revision) {
        throw new Error("Failed to validate the initial Task Pack revision.");
      }
      assertTaskPackRevision(revision, {
        aggregate,
        verifyContentHash: true,
      });
      return taskPackId;
    });

    const row = await this.getOne<TaskPackRow>(
      `SELECT tp.*, p.name AS project_name
       FROM task_packs tp
       JOIN projects p ON p.id = tp.project_id
       WHERE tp.id = ?;`,
      [createdTaskPackId],
    );
    if (!row) {
      throw new Error("Failed to read the created Task Pack.");
    }
    return mapTaskPackRow(row);
  }

  async getTaskPackGitHubCreatedIssueLink(
    taskPackId: number,
  ): Promise<TaskPackGitHubCreatedIssueLinkRecord | null> {
    const row = await this.getOne<{
      task_pack_id: number;
      owner: string;
      repo: string;
      full_name: string;
      issue_number: number;
      issue_title: string;
      issue_url: string;
      issue_state: "open" | "closed";
      labels: string;
      repository_url: string;
      created_at: string;
    }>(
      `SELECT task_pack_id, owner, repo, full_name, issue_number, issue_title,
              issue_url, issue_state, labels, repository_url, created_at
       FROM task_pack_github_created_issue_links
       WHERE task_pack_id = ?;`,
      [taskPackId],
    );
    if (!row) return null;
    const link: TaskPackGitHubCreatedIssueLinkRecord = {
      taskPackId: Number(row.task_pack_id),
      owner: row.owner,
      repo: row.repo,
      fullName: row.full_name,
      issueNumber: Number(row.issue_number),
      issueTitle: row.issue_title,
      issueUrl: row.issue_url,
      issueState: row.issue_state,
      labels: parseJsonValue<unknown>(row.labels, null) as string[],
      repositoryUrl: row.repository_url,
      createdAt: row.created_at,
    };
    assertTaskPackGitHubCreatedIssueLinkInput(link);
    return link;
  }

  async createTaskPackGitHubCreatedIssueLink(
    input: CreateTaskPackGitHubCreatedIssueLinkInput,
  ): Promise<TaskPackGitHubCreatedIssueLinkRecord> {
    assertTaskPackGitHubCreatedIssueLinkInput(input);
    await this.withTransaction(async () => {
      const taskPack = await this.getOne<{ id: number }>(
        "SELECT id FROM task_packs WHERE id = ?;",
        [input.taskPackId],
      );
      if (!taskPack) {
        throw new TaskPackGitHubCreatedIssueLinkStorageError(
          "TASK_PACK_NOT_FOUND",
        );
      }
      const existing = await this.getOne<{ task_pack_id: number }>(
        "SELECT task_pack_id FROM task_pack_github_created_issue_links WHERE task_pack_id = ?;",
        [input.taskPackId],
      );
      if (existing) {
        throw new TaskPackGitHubCreatedIssueLinkStorageError(
          "TASK_PACK_GITHUB_CREATED_ISSUE_LINK_EXISTS",
        );
      }
      try {
        await this.run(
          `INSERT INTO task_pack_github_created_issue_links (
            task_pack_id, owner, repo, full_name, issue_number, issue_title,
            issue_url, issue_state, labels, repository_url, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          [
            input.taskPackId,
            input.owner,
            input.repo,
            input.fullName,
            input.issueNumber,
            input.issueTitle,
            input.issueUrl,
            input.issueState,
            stringifyJsonValue(input.labels),
            input.repositoryUrl,
            input.createdAt,
          ],
        );
      } catch (error) {
        if (String(error).includes("UNIQUE constraint failed")) {
          throw new TaskPackGitHubCreatedIssueLinkStorageError(
            "TASK_PACK_GITHUB_CREATED_ISSUE_LINK_EXISTS",
          );
        }
        throw error;
      }
    });
    const created = await this.getTaskPackGitHubCreatedIssueLink(input.taskPackId);
    if (!created) {
      throw new Error("Failed to read created Task Pack GitHub issue linkage.");
    }
    return created;
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


  async updateTaskPackContent(
    taskPackId: number,
    input: UpdateTaskPackContentInput
  ): Promise<TaskPackRecord | null> {
    const current = await this.getTaskPackById(taskPackId);

    if (!current) {
      return null;
    }

    const timestamp = nowIso();
    const rawTask = input.rawTask ?? current.rawTask;
    const generatedPrompt = input.generatedPrompt ?? current.generatedPrompt;

    await this.run(
      `
      UPDATE task_packs
      SET raw_task = ?, generated_prompt = ?, updated_at = ?
      WHERE id = ?;
      `,
      [rawTask, generatedPrompt, timestamp, taskPackId],
      false
    );

    this.persist();

    return this.getTaskPackById(taskPackId);
  }

  async getTaskPackAggregate(taskPackId: number): Promise<TaskPackAggregateRecord | null> {
    const row = await this.getOne<TaskPackAggregatePersistenceRow>(
      `SELECT id, project_id, title, lifecycle_state, archived_from_state,
              current_revision_id, accepted_revision_id, lifecycle_version,
              created_at, updated_at, completed_at, archived_at
       FROM task_packs
       WHERE id = ? AND current_revision_id IS NOT NULL;`,
      [taskPackId],
    );
    return row ? mapTaskPackAggregatePersistenceRow(row) : null;
  }

  async getCurrentTaskPackRevision(taskPackId: number): Promise<TaskPackRevisionRecord | null> {
    const row = await this.getOne<TaskPackRevisionPersistenceRow>(
      `SELECT r.*
       FROM task_packs tp
       JOIN task_pack_revisions r ON r.id = tp.current_revision_id
       WHERE tp.id = ? AND r.task_pack_id = tp.id;`,
      [taskPackId],
    );
    return row ? mapTaskPackRevisionPersistenceRow(row) : null;
  }

  async getTaskPackRevisionById(
    taskPackId: number,
    revisionId: number,
  ): Promise<TaskPackRevisionRecord | null> {
    const row = await this.getOne<TaskPackRevisionPersistenceRow>(
      `SELECT * FROM task_pack_revisions WHERE task_pack_id = ? AND id = ?;`,
      [taskPackId, revisionId],
    );
    return row ? mapTaskPackRevisionPersistenceRow(row) : null;
  }

  async listTaskPackRevisions(taskPackId: number): Promise<TaskPackRevisionRecord[]> {
    const rows = await this.getAll<TaskPackRevisionPersistenceRow>(
      `SELECT * FROM task_pack_revisions
       WHERE task_pack_id = ?
       ORDER BY revision_number ASC;`,
      [taskPackId],
    );
    return rows.map(mapTaskPackRevisionPersistenceRow);
  }

  async appendTaskPackRevision(
    input: AppendTaskPackRevisionInput,
  ): Promise<TaskPackRevisionRecord> {
    return this.withTransaction(async () => {
      const aggregate = await this.getTaskPackAggregate(input.taskPackId);
      if (!aggregate) {
        throw new TaskPackRevisionAppendStorageError(
          "TASK_PACK_NOT_FOUND",
          input.taskPackId,
        );
      }
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
      const base = await this.getTaskPackRevisionById(input.taskPackId, input.baseRevisionId);
      if (!base) {
        throw new TaskPackRevisionAppendStorageError(
          "TASK_PACK_BASE_REVISION_INVALID",
          input.taskPackId,
          input.baseRevisionId,
          aggregate.currentRevisionId,
        );
      }

      const content = revisionContentFromAppendInput(input);
      const nextRevisionRow = await this.getOne<{ revision_number: number }>(
        `SELECT COALESCE(MAX(revision_number), 0) + 1 AS revision_number
         FROM task_pack_revisions WHERE task_pack_id = ?;`,
        [input.taskPackId],
      );
      const nextRevisionNumber = Number(nextRevisionRow?.revision_number ?? 0);
      await this.insertTaskPackRevision({
        taskPackId: input.taskPackId,
        revisionNumber: nextRevisionNumber,
        baseRevisionId: input.baseRevisionId,
        content,
        createdAt: input.createdAt,
        generatedAt: input.generatedAt,
      });
      const revisionId = await this.getLastInsertRowId();
      const revision = await this.getTaskPackRevisionById(input.taskPackId, revisionId);
      if (!revision) throw new Error("Failed to read appended Task Pack revision.");
      assertTaskPackRevision(revision, { aggregate, baseRevision: base });

      await this.run(
        `UPDATE task_packs
         SET current_revision_id = ?, lifecycle_version = lifecycle_version + 1,
             raw_task = ?, task_type = ?, target_tool = ?, generated_prompt = ?,
             generation_mode = ?, generation_model = ?, generation_message = ?,
             generation_used_fallback = ?, generation_duration_ms = ?,
             generation_recipe = ?, updated_at = ?
         WHERE id = ? AND current_revision_id = ?;`,
        [
          revision.id,
          content.rawTask,
          content.taskType,
          content.targetTool,
          content.generatedPrompt,
          content.generationMode,
          content.generationModel,
          content.generationMessage,
          content.generationUsedFallback ? 1 : 0,
          content.generationDurationMs,
          content.generationRecipe === null ? null : stringifyJsonValue(content.generationRecipe),
          input.createdAt,
          input.taskPackId,
          input.baseRevisionId,
        ],
      );
      const changed = await this.getOne<{ changed: number }>(
        "SELECT changes() AS changed;",
      );
      if (Number(changed?.changed ?? 0) !== 1) {
        throw new TaskPackCurrentStateStorageError();
      }
      return revision;
    });
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
    await this.run(
      `INSERT INTO task_pack_lifecycle_events (
        id, task_pack_id, revision_id, event_type, from_state, to_state,
        source, actor_id, created_at, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
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
        event.metadata === null ? null : stringifyJsonValue(event.metadata),
      ],
      true,
    );
  }

  async listTaskPackAggregateLifecycleEvents(
    taskPackId: number,
  ): Promise<TaskPackAggregateLifecycleEventRecord[]> {
    const rows = await this.getAll<TaskPackLifecycleEventPersistenceRow>(
      `SELECT * FROM task_pack_lifecycle_events
       WHERE task_pack_id = ?
       ORDER BY created_at ASC, id ASC;`,
      [taskPackId],
    );
    return rows.map(mapTaskPackLifecycleEventPersistenceRow);
  }

  async appendTaskPackRevisionReviewEvent(
    event: TaskPackRevisionReviewEventRecord,
  ): Promise<void> {
    const aggregate = await this.getTaskPackAggregate(event.taskPackId);
    const revision = await this.getTaskPackRevisionById(event.taskPackId, event.revisionId);
    if (!aggregate || !revision) throw new Error("Task Pack revision ownership is invalid.");
    assertTaskPackRevisionReviewEvent(event, { aggregate, revision });
    await this.run(
      `INSERT INTO task_pack_revision_review_events (
        id, task_pack_id, revision_id, event_type, from_state, to_state,
        source, actor_id, created_at, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
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
        event.metadata === null ? null : stringifyJsonValue(event.metadata),
      ],
      true,
    );
  }

  async listTaskPackRevisionReviewEvents(
    taskPackId: number,
    revisionId?: number,
  ): Promise<TaskPackRevisionReviewEventRecord[]> {
    const rows = await this.getAll<TaskPackReviewEventPersistenceRow>(
      revisionId === undefined
        ? `SELECT * FROM task_pack_revision_review_events
           WHERE task_pack_id = ? ORDER BY created_at ASC, id ASC;`
        : `SELECT * FROM task_pack_revision_review_events
           WHERE task_pack_id = ? AND revision_id = ? ORDER BY created_at ASC, id ASC;`,
      revisionId === undefined ? [taskPackId] : [taskPackId, revisionId],
    );
    return rows.map(mapTaskPackReviewEventPersistenceRow);
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

      applySqliteMigrationTransaction(
        db,
        migration,
        appliedAt,
        this.options.migrationTransactionHooks,
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

    const databaseExists = fs.existsSync(this.databasePath);
    const databaseBytes = databaseExists ? fs.readFileSync(this.databasePath) : null;
    this.loadedPersistedDatabase = Boolean(databaseBytes?.length);

    this.db = new this.sqlJs.Database(databaseBytes);
    this.db.run("PRAGMA foreign_keys = ON;");

    return this.db;
  }

  private ensureTaskPackLifecycleMigrationPreflight(db: Database): void {
    if (
      this.lifecycleMigrationPreflightComplete ||
      !this.loadedPersistedDatabase ||
      this.isMigrationApplied(db, TASK_PACK_LIFECYCLE_MIGRATION_ID)
    ) {
      this.lifecycleMigrationPreflightComplete = true;
      return;
    }

    const createBackup =
      this.options.createPreMigrationBackup ?? createSqlitePreMigrationBackup;
    createBackup({
      databasePath: this.databasePath,
      migrationId: TASK_PACK_LIFECYCLE_MIGRATION_ID,
      backupDirectory: this.options.migrationBackupDirectory,
    });
    this.lifecycleMigrationPreflightComplete = true;
  }

  private isMigrationApplied(db: Database, migrationId: string): boolean {
    const ledger = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations' LIMIT 1;",
    );
    try {
      if (!ledger.step()) {
        return false;
      }
    } finally {
      ledger.free();
    }

    const migration = db.prepare(
      "SELECT 1 FROM schema_migrations WHERE id = ? LIMIT 1;",
    );
    try {
      migration.bind([migrationId]);
      return migration.step();
    } finally {
      migration.free();
    }
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

  private async insertTaskPackRevision(input: {
    taskPackId: number;
    revisionNumber: number;
    baseRevisionId: number | null;
    content: TaskPackRevisionContent;
    createdAt: string;
    generatedAt: string | null;
  }): Promise<void> {
    const contentHash = computeTaskPackRevisionContentHash(input.content);
    await this.run(
      `INSERT INTO task_pack_revisions (
        task_pack_id, revision_number, base_revision_id, source_kind,
        raw_task, task_type, target_tool, generated_prompt,
        generation_mode, generation_model, generation_message,
        generation_used_fallback, generation_duration_ms, generation_recipe,
        diagnostics, grounded_context_snapshot, freshness_basis,
        content_hash, created_at, generated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        input.taskPackId,
        input.revisionNumber,
        input.baseRevisionId,
        input.content.sourceKind,
        input.content.rawTask,
        input.content.taskType,
        input.content.targetTool,
        input.content.generatedPrompt,
        input.content.generationMode,
        input.content.generationModel,
        input.content.generationMessage,
        input.content.generationUsedFallback ? 1 : 0,
        input.content.generationDurationMs,
        input.content.generationRecipe === null
          ? null
          : stringifyJsonValue(input.content.generationRecipe),
        input.content.diagnostics === null
          ? null
          : stringifyJsonValue(input.content.diagnostics),
        input.content.groundedContextSnapshot === null
          ? null
          : stringifyJsonValue(input.content.groundedContextSnapshot),
        input.content.freshnessBasis === null
          ? null
          : stringifyJsonValue(input.content.freshnessBasis),
        contentHash,
        input.createdAt,
        input.generatedAt,
      ],
    );
  }

  private async withTransaction<T>(work: () => Promise<T>): Promise<T> {
    const db = await this.getDatabase();
    db.run("BEGIN IMMEDIATE;");
    try {
      const result = await work();
      db.run("COMMIT;");
      this.persist();
      return result;
    } catch (error) {
      try {
        db.run("ROLLBACK;");
      } catch {
        // Preserve the original storage error.
      }
      throw error;
    }
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
    const exported = Buffer.from(this.db.export());
    // sql.js export resets connection-local PRAGMA state; keep ownership/cascade enforcement active.
    this.db.run("PRAGMA foreign_keys = ON;");
    fs.writeFileSync(this.databasePath, exported);
  }
}
