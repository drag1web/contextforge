import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";

import { computeTaskPackRevisionContentHash } from "../taskPacks/taskPackLifecycle.js";
import {
  POSTGRES_TASK_PACK_LIFECYCLE_CONSTRAINTS,
  POSTGRES_TASK_PACK_LIFECYCLE_DDL,
  SQLITE_MIGRATIONS,
  TASK_PACK_DRAFTS_MIGRATION_ID,
  TASK_PACK_GITHUB_CREATED_ISSUE_LINK_MIGRATION_ID,
  TASK_PACK_LIFECYCLE_MIGRATION_ID,
  applyPostgresTaskPackLifecycleMigration,
  applySqliteMigrationTransaction,
} from "./migrations.js";
import { SqliteStorageAdapter } from "./SqliteStorageAdapter.js";
import { createSqlitePreMigrationBackup } from "./storageBackupPaths.js";
import { TaskPackRevisionAppendStorageError } from "./types.js";

interface SmokeScenario {
  readonly name: string;
  readonly run: () => void | Promise<void>;
}

const scenarios: SmokeScenario[] = [];
const scenario = (name: string, run: SmokeScenario["run"]) => scenarios.push({ name, run });
const require = createRequire(import.meta.url);
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "contextforge-tp-lc-02-"));
const legacyDatabasePath = path.join(temporaryRoot, "legacy.sqlite");
const emptyDatabasePath = path.join(temporaryRoot, "empty.sqlite");
const freshDatabasePath = path.join(temporaryRoot, "fresh.sqlite");
const migrationBackupDirectory = path.join(temporaryRoot, "backups");
let SQL: SqlJsStatic;
let adapter: SqliteStorageAdapter;
let firstTaskPackId = 1;
let secondTaskPackId = 2;
let preflightObservedBeforeSchemaChange = false;

function sqlJsDistPath(): string {
  return path.dirname(require.resolve("sql.js/dist/sql-wasm.js"));
}

function createLegacySchemaV2(db: Database): void {
  db.run(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE schema_migrations (
      id TEXT PRIMARY KEY,
      version INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE app_storage_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE projects (
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
    CREATE TABLE task_packs (
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
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE project_scans (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL,
      summary TEXT, created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE TABLE prompt_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, name TEXT NOT NULL,
      content TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE TABLE rule_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, name TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE TABLE rule_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, profile_id INTEGER, title TEXT NOT NULL,
      content TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY (profile_id) REFERENCES rule_profiles(id) ON DELETE CASCADE
    );
    CREATE TABLE acceptance_criteria_presets (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, name TEXT NOT NULL,
      criteria TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE TABLE project_memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL,
      title TEXT NOT NULL, content TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'custom',
      priority TEXT NOT NULL DEFAULT 'normal', is_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE TABLE file_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, scan_id INTEGER,
      file_path TEXT NOT NULL, size INTEGER, modified_at TEXT, hash TEXT, created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (scan_id) REFERENCES project_scans(id) ON DELETE SET NULL
    );
    CREATE TABLE sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT, item_type TEXT NOT NULL, item_id TEXT NOT NULL,
      operation TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE rules_templates_catalog_items (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    INSERT INTO schema_migrations VALUES
      ('0001_sqlite_baseline', 1, 'SQLite baseline schema', NULL, 'sqlite-baseline-v1', '2026-09-01T00:00:00.000Z'),
      ('0002_rules_templates_catalog', 2, 'Rules catalog', NULL, 'rules-templates-catalog-v1', '2026-09-02T00:00:00.000Z');
    INSERT INTO projects (
      id, name, local_path, package_manager, detected_stack, scripts,
      readiness_score, readiness_report, created_at, updated_at, last_scan_at
    ) VALUES (
      1, 'Lifecycle fixture', '/fixture/project', 'npm', '["typescript"]',
      '{"build":"npm run build"}', 90, '{"score":90,"checks":[],"issues":[]}',
      '2026-09-01T08:00:00.000Z', '2026-09-01T08:00:00.000Z', NULL
    );
  `);
}

function insertLegacyTaskPacks(db: Database): void {
  db.run(
    `INSERT INTO task_packs (
      id, project_id, title, raw_task, task_type, target_tool, generated_prompt,
      generation_mode, generation_model, generation_message, generation_used_fallback,
      generation_duration_ms, generation_recipe, created_at, updated_at
    ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      firstTaskPackId,
      "Legacy structured",
      "Edited legacy task\r\nkept exactly",
      "docs",
      "codex",
      "Edited prompt\r\nkept exactly",
      "ollama",
      "model-a",
      "Generated before lifecycle migration",
      1,
      47,
      JSON.stringify({ policy: { mode: "guarded" }, debounceMs: 250 }),
      "2026-09-03T08:00:00.000Z",
      "2026-09-04T08:00:00.000Z",
    ],
  );
  db.run(
    `INSERT INTO task_packs (
      id, project_id, title, raw_task, task_type, target_tool, generated_prompt,
      generation_mode, generation_model, generation_message, generation_used_fallback,
      generation_duration_ms, generation_recipe, created_at, updated_at
    ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      secondTaskPackId,
      "Imported null recipe",
      "Imported task",
      "general",
      "generic",
      "Imported prompt",
      "template",
      null,
      "ContextForge cloud handoff:delivery-1",
      0,
      null,
      JSON.stringify(null),
      "2026-09-05T08:00:00.000Z",
      "2026-09-05T08:00:00.000Z",
    ],
  );
}

function persistDatabase(db: Database, filePath: string): void {
  fs.writeFileSync(filePath, Buffer.from(db.export()));
}

function openPersistedDatabase(filePath: string): Database {
  const db = new SQL.Database(fs.readFileSync(filePath));
  db.run("PRAGMA foreign_keys = ON;");
  return db;
}

function scalar(db: Database, sql: string): unknown {
  const statement = db.prepare(sql);
  try {
    assert.equal(statement.step(), true);
    return statement.getAsObject().value;
  } finally {
    statement.free();
  }
}

function fileSha256(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function createPersistedLegacyDatabase(filePath: string): void {
  const db = new SQL.Database();
  try {
    createLegacySchemaV2(db);
    insertLegacyTaskPacks(db);
    persistDatabase(db, filePath);
  } finally {
    db.close();
  }
}

function sqliteBackupFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter((fileName) => fileName.endsWith(".sqlite"))
    .map((fileName) => path.join(directory, fileName));
}

scenario("empty SQLite database migrates to logical schema version 5", async () => {
  const empty = new SqliteStorageAdapter(emptyDatabasePath);
  await empty.ensureSchema();
  const info = await empty.getSchemaInfo();
  assert.equal(info.currentVersion, 5);
  assert.equal(info.pendingCount, 0);
  assert.equal(
    info.appliedMigrations.at(-1)?.id,
    TASK_PACK_DRAFTS_MIGRATION_ID,
  );
});

scenario("fresh SQLite database does not create a meaningless pre-migration backup", async () => {
  const backupDirectory = path.join(temporaryRoot, "fresh-backups");
  const fresh = new SqliteStorageAdapter(freshDatabasePath, {
    migrationBackupDirectory: backupDirectory,
  });
  await fresh.ensureSchema();
  assert.deepEqual(sqliteBackupFiles(backupDirectory), []);
});

scenario("representative schema-v2 database backfills multiple revisions", async () => {
  createPersistedLegacyDatabase(legacyDatabasePath);
  adapter = new SqliteStorageAdapter(legacyDatabasePath, {
    migrationBackupDirectory,
    createPreMigrationBackup: (input) => {
      const before = openPersistedDatabase(input.databasePath);
      try {
        preflightObservedBeforeSchemaChange =
          Number(scalar(before, `SELECT COUNT(*) AS value FROM schema_migrations WHERE id = '${TASK_PACK_LIFECYCLE_MIGRATION_ID}';`)) === 0 &&
          Number(scalar(before, "SELECT COUNT(*) AS value FROM sqlite_master WHERE type = 'table' AND name = 'task_pack_revisions';")) === 0;
      } finally {
        before.close();
      }
      return createSqlitePreMigrationBackup(input);
    },
  });
  await adapter.ensureSchema();
  assert.equal((await adapter.listTaskPackRevisions(firstTaskPackId)).length, 1);
  assert.equal((await adapter.listTaskPackRevisions(secondTaskPackId)).length, 1);
});

scenario("existing SQLite database is copied before migration 0003 mutates schema", () => {
  assert.equal(preflightObservedBeforeSchemaChange, true);
  const backups = sqliteBackupFiles(migrationBackupDirectory);
  assert.equal(backups.length, 1);
  const backup = openPersistedDatabase(backups[0]!);
  try {
    assert.equal(
      Number(scalar(backup, `SELECT COUNT(*) AS value FROM schema_migrations WHERE id = '${TASK_PACK_LIFECYCLE_MIGRATION_ID}';`)),
      0,
    );
    assert.equal(
      Number(scalar(backup, "SELECT COUNT(*) AS value FROM sqlite_master WHERE type = 'table' AND name = 'task_pack_revisions';")),
      0,
    );
    assert.equal(Number(scalar(backup, "SELECT COUNT(*) AS value FROM task_packs;")), 2);
  } finally {
    backup.close();
  }
});

scenario("pre-migration backup failure prevents migration and preserves the ledger", async () => {
  const databasePath = path.join(temporaryRoot, "backup-failure.sqlite");
  createPersistedLegacyDatabase(databasePath);
  const beforeHash = fileSha256(databasePath);
  const failing = new SqliteStorageAdapter(databasePath, {
    createPreMigrationBackup: () => {
      throw new Error("injected pre-migration backup failure");
    },
  });
  await assert.rejects(
    () => failing.ensureSchema(),
    /injected pre-migration backup failure/u,
  );
  assert.equal(fileSha256(databasePath), beforeHash);
  const db = openPersistedDatabase(databasePath);
  try {
    assert.equal(
      Number(scalar(db, `SELECT COUNT(*) AS value FROM schema_migrations WHERE id = '${TASK_PACK_LIFECYCLE_MIGRATION_ID}';`)),
      0,
    );
    assert.equal(
      Number(scalar(db, "SELECT COUNT(*) AS value FROM sqlite_master WHERE type = 'table' AND name = 'task_pack_revisions';")),
      0,
    );
  } finally {
    db.close();
  }
});

scenario("migration failure retains an exact recoverable pre-migration database", async () => {
  const databasePath = path.join(temporaryRoot, "migration-failure.sqlite");
  const backupDirectory = path.join(temporaryRoot, "migration-failure-backups");
  createPersistedLegacyDatabase(databasePath);
  const beforeHash = fileSha256(databasePath);
  const failing = new SqliteStorageAdapter(databasePath, {
    migrationBackupDirectory: backupDirectory,
    migrationTransactionHooks: {
      beforeRecord: (migration) => {
        if (migration.id === TASK_PACK_LIFECYCLE_MIGRATION_ID) {
          throw new Error("injected adapter migration failure");
        }
      },
    },
  });
  await assert.rejects(
    () => failing.ensureSchema(),
    /injected adapter migration failure/u,
  );
  const backups = sqliteBackupFiles(backupDirectory);
  assert.equal(backups.length, 1);
  assert.equal(fileSha256(databasePath), beforeHash);
  assert.equal(fileSha256(backups[0]!), beforeHash);
  const db = openPersistedDatabase(databasePath);
  try {
    assert.equal(
      Number(scalar(db, `SELECT COUNT(*) AS value FROM schema_migrations WHERE id = '${TASK_PACK_LIFECYCLE_MIGRATION_ID}';`)),
      0,
    );
    assert.equal(
      Number(scalar(db, "SELECT COUNT(*) AS value FROM sqlite_master WHERE type = 'table' AND name = 'task_pack_revisions';")),
      0,
    );
  } finally {
    db.close();
  }
});

scenario("legacy aggregate retains project and title ownership", async () => {
  const aggregate = await adapter.getTaskPackAggregate(firstTaskPackId);
  assert.equal(aggregate?.projectId, 1);
  assert.equal(aggregate?.title, "Legacy structured");
  assert.equal(aggregate?.lifecycle.state, "active");
  assert.equal(aggregate?.acceptedRevisionId, null);
  assert.equal(aggregate?.lifecycleVersion, 1);
});

scenario("legacy first revision has exact ancestry and current pointer", async () => {
  const aggregate = await adapter.getTaskPackAggregate(firstTaskPackId);
  const revision = await adapter.getCurrentTaskPackRevision(firstTaskPackId);
  assert.equal(revision?.revisionNumber, 1);
  assert.equal(revision?.baseRevisionId, null);
  assert.equal(revision?.sourceKind, "legacy_snapshot");
  assert.equal(aggregate?.currentRevisionId, revision?.id);
});

scenario("edited legacy task and prompt values remain byte-for-byte unchanged", async () => {
  const revision = await adapter.getCurrentTaskPackRevision(firstTaskPackId);
  assert.equal(revision?.rawTask, "Edited legacy task\r\nkept exactly");
  assert.equal(revision?.generatedPrompt, "Edited prompt\r\nkept exactly");
});

scenario("structured legacy generation recipe is preserved", async () => {
  const revision = await adapter.getCurrentTaskPackRevision(firstTaskPackId);
  assert.deepEqual(revision?.generationRecipe, {
    policy: { mode: "guarded" },
    debounceMs: 250,
  });
});

scenario("null legacy generation recipe remains null", async () => {
  const revision = await adapter.getCurrentTaskPackRevision(secondTaskPackId);
  assert.equal(revision?.generationRecipe, null);
});

scenario("cloud handoff marker produces imported legacy source kind", async () => {
  const revision = await adapter.getCurrentTaskPackRevision(secondTaskPackId);
  assert.equal(revision?.sourceKind, "imported");
  assert.equal(revision?.generatedAt, null);
});

scenario("backfilled revision hash recomputes from frozen canonical content", async () => {
  const revision = await adapter.getCurrentTaskPackRevision(firstTaskPackId);
  assert.ok(revision);
  const { id, taskPackId, revisionNumber, baseRevisionId, contentHash, createdAt, generatedAt, ...content } = revision;
  assert.equal(computeTaskPackRevisionContentHash(content), contentHash);
  assert.equal(generatedAt, null);
  assert.ok(id > 0 && taskPackId > 0 && revisionNumber === 1 && baseRevisionId === null && createdAt);
});

scenario("revision schema excludes aggregate-owned title and project_id", () => {
  const db = openPersistedDatabase(legacyDatabasePath);
  try {
    const rows = db.exec("PRAGMA table_info(task_pack_revisions);")[0]?.values ?? [];
    const names = rows.map((row) => String(row[1]));
    assert.equal(names.includes("title"), false);
    assert.equal(names.includes("project_id"), false);
  } finally {
    db.close();
  }
});

scenario("migration is idempotent across adapter restart", async () => {
  const reopened = new SqliteStorageAdapter(legacyDatabasePath);
  await reopened.ensureSchema();
  assert.equal((await reopened.listTaskPackRevisions(firstTaskPackId)).length, 1);
  const db = openPersistedDatabase(legacyDatabasePath);
  try {
    assert.equal(
      Number(scalar(db, `SELECT COUNT(*) AS value FROM schema_migrations WHERE id = '${TASK_PACK_LIFECYCLE_MIGRATION_ID}';`)),
      1,
    );
  } finally {
    db.close();
  }
});

scenario("new legacy-compatible create also establishes revision 1", async () => {
  const created = await adapter.createTaskPack({
    projectId: 1,
    title: "New generated pack",
    rawTask: "Add a focused storage test.",
    taskType: "tests",
    targetTool: "codex",
    generatedPrompt: "Implement the storage test.",
    generationMode: "template",
    generationModel: null,
    generationMessage: null,
    generationUsedFallback: false,
    generationDurationMs: 3,
    generationRecipe: { policy: "guarded" },
  });
  const revision = await adapter.getCurrentTaskPackRevision(created.id);
  assert.equal(revision?.revisionNumber, 1);
  assert.equal(revision?.sourceKind, "generated");
  assert.ok(revision?.generatedAt);
});

scenario("legacy content update behavior remains mutable and does not create revision 2", async () => {
  const taskPack = (await adapter.listTaskPacks()).find((item) => item.title === "New generated pack");
  assert.ok(taskPack);
  const before = await adapter.getCurrentTaskPackRevision(taskPack.id);
  const updated = await adapter.updateTaskPackContent(taskPack.id, { rawTask: "Legacy route update" });
  assert.equal(updated?.rawTask, "Legacy route update");
  assert.equal((await adapter.listTaskPackRevisions(taskPack.id)).length, 1);
  assert.equal((await adapter.getCurrentTaskPackRevision(taskPack.id))?.rawTask, before?.rawTask);
});

scenario("append revision allocates monotonic number and advances current pointer", async () => {
  const base = await adapter.getCurrentTaskPackRevision(firstTaskPackId);
  assert.ok(base);
  const revision = await adapter.appendTaskPackRevision({
    taskPackId: firstTaskPackId,
    baseRevisionId: base.id,
    sourceKind: "manual_edit",
    rawTask: "A second immutable task version",
    taskType: base.taskType,
    targetTool: base.targetTool,
    generatedPrompt: "A second immutable prompt",
    generationMode: base.generationMode,
    generationModel: base.generationModel,
    generationMessage: base.generationMessage,
    generationUsedFallback: base.generationUsedFallback,
    generationDurationMs: base.generationDurationMs,
    generationRecipe: base.generationRecipe,
    diagnostics: null,
    groundedContextSnapshot: null,
    freshnessBasis: null,
    createdAt: "2026-09-18T10:00:00.000Z",
    generatedAt: null,
  });
  assert.equal(revision.revisionNumber, 2);
  assert.equal(revision.baseRevisionId, base.id);
  const aggregate = await adapter.getTaskPackAggregate(firstTaskPackId);
  assert.equal(aggregate?.currentRevisionId, revision.id);
  assert.equal(aggregate?.lifecycleVersion, 2);
  const flatProjection = await adapter.getTaskPackById(firstTaskPackId);
  assert.equal(flatProjection?.rawTask, revision.rawTask);
  assert.equal(flatProjection?.generatedPrompt, revision.generatedPrompt);
});

scenario("stale base revision is rejected without another row", async () => {
  const revisions = await adapter.listTaskPackRevisions(firstTaskPackId);
  const stale = revisions[0]!;
  const actualCurrent = revisions[1]!;
  await assert.rejects(
    () =>
      adapter.appendTaskPackRevision({
        taskPackId: firstTaskPackId,
        baseRevisionId: stale.id,
        sourceKind: "manual_edit",
        rawTask: "Stale",
        taskType: stale.taskType,
        targetTool: stale.targetTool,
        generatedPrompt: "Stale",
        generationMode: stale.generationMode,
        generationModel: null,
        generationMessage: null,
        generationUsedFallback: false,
        generationDurationMs: null,
        generationRecipe: null,
        diagnostics: null,
        groundedContextSnapshot: null,
        freshnessBasis: null,
        createdAt: "2026-09-18T10:01:00.000Z",
        generatedAt: null,
      }),
    (error: unknown) => {
      assert.ok(error instanceof TaskPackRevisionAppendStorageError);
      assert.equal(error.code, "TASK_PACK_REVISION_CONFLICT");
      assert.equal(error.taskPackId, firstTaskPackId);
      assert.equal(error.expectedCurrentRevisionId, stale.id);
      assert.equal(error.actualCurrentRevisionId, actualCurrent.id);
      return true;
    },
  );
  assert.equal((await adapter.listTaskPackRevisions(firstTaskPackId)).length, 2);
});

scenario("adapter exposes no revision update or delete operation", () => {
  assert.equal("updateTaskPackRevision" in adapter, false);
  assert.equal("deleteTaskPackRevision" in adapter, false);
});

scenario("database rejects revision payload mutation", () => {
  const db = openPersistedDatabase(legacyDatabasePath);
  try {
    assert.throws(() => db.run("UPDATE task_pack_revisions SET raw_task = 'mutated' WHERE id = 1;"));
  } finally {
    db.close();
  }
});

scenario("database enforces unique taskPackId and revisionNumber", () => {
  const db = openPersistedDatabase(legacyDatabasePath);
  try {
    assert.throws(() =>
      db.run(`INSERT INTO task_pack_revisions (
        task_pack_id, revision_number, base_revision_id, source_kind, raw_task, task_type,
        target_tool, generated_prompt, generation_mode, generation_used_fallback,
        content_hash, created_at
      ) SELECT task_pack_id, revision_number, base_revision_id, source_kind, raw_task, task_type,
               target_tool, generated_prompt, generation_mode, generation_used_fallback,
               content_hash, created_at
        FROM task_pack_revisions WHERE task_pack_id = 2 AND revision_number = 1;`),
    );
  } finally {
    db.close();
  }
});

scenario("SQLite rejects a length-correct content hash outside lowercase SHA-256", () => {
  const db = openPersistedDatabase(legacyDatabasePath);
  try {
    const invalidHash = `sha256:${"a".repeat(63)}g`;
    assert.equal(invalidHash.length, 71);
    assert.throws(() =>
      db.run(`INSERT INTO task_pack_revisions (
        task_pack_id, revision_number, base_revision_id, source_kind, raw_task, task_type,
        target_tool, generated_prompt, generation_mode, generation_model, generation_message,
        generation_used_fallback, generation_duration_ms, generation_recipe, diagnostics,
        grounded_context_snapshot, freshness_basis, content_hash, created_at, generated_at
      ) SELECT task_pack_id, 2, id, source_kind, raw_task, task_type,
               target_tool, generated_prompt, generation_mode, generation_model, generation_message,
               generation_used_fallback, generation_duration_ms, generation_recipe, diagnostics,
               grounded_context_snapshot, freshness_basis, ?, created_at, generated_at
        FROM task_pack_revisions WHERE task_pack_id = 2 AND revision_number = 1;`, [invalidHash]),
    );
  } finally {
    db.close();
  }
});

scenario("database rejects a base revision from another aggregate", () => {
  const db = openPersistedDatabase(legacyDatabasePath);
  try {
    const foreignBase = Number(scalar(db, "SELECT id AS value FROM task_pack_revisions WHERE task_pack_id = 1 LIMIT 1;"));
    assert.throws(() =>
      db.run(`INSERT INTO task_pack_revisions (
        task_pack_id, revision_number, base_revision_id, source_kind, raw_task, task_type,
        target_tool, generated_prompt, generation_mode, generation_used_fallback,
        content_hash, created_at
      ) SELECT 2, 2, ?, 'manual_edit', raw_task, task_type,
               target_tool, generated_prompt, generation_mode, generation_used_fallback,
               content_hash, created_at
        FROM task_pack_revisions WHERE task_pack_id = 2 AND revision_number = 1;`, [foreignBase]),
    );
  } finally {
    db.close();
  }
});

scenario("aggregate current and accepted pointers reject cross-aggregate revisions", () => {
  const db = openPersistedDatabase(legacyDatabasePath);
  try {
    const foreignRevision = Number(scalar(db, "SELECT id AS value FROM task_pack_revisions WHERE task_pack_id = 2 LIMIT 1;"));
    assert.throws(() => db.run("UPDATE task_packs SET current_revision_id = ? WHERE id = 1;", [foreignRevision]));
    assert.throws(() => db.run("UPDATE task_packs SET accepted_revision_id = ? WHERE id = 1;", [foreignRevision]));
  } finally {
    db.close();
  }
});

scenario("lifecycle and review events append and read in order", async () => {
  const current = await adapter.getCurrentTaskPackRevision(firstTaskPackId);
  assert.ok(current);
  await adapter.appendTaskPackAggregateLifecycleEvent({
    id: "lifecycle-event-1",
    taskPackId: firstTaskPackId,
    revisionId: null,
    eventType: "archived",
    fromState: "active",
    toState: "archived",
    source: "user",
    actorId: "local-user",
    createdAt: "2026-09-18T11:00:00.000Z",
    metadata: { reason: "smoke" },
  });
  await adapter.appendTaskPackRevisionReviewEvent({
    id: "review-event-1",
    taskPackId: firstTaskPackId,
    revisionId: current.id,
    eventType: "review_started",
    fromState: "unreviewed",
    toState: "in_review",
    source: "user",
    actorId: null,
    createdAt: "2026-09-18T11:01:00.000Z",
    metadata: null,
  });
  assert.equal((await adapter.listTaskPackAggregateLifecycleEvents(firstTaskPackId))[0]?.id, "lifecycle-event-1");
  assert.equal((await adapter.listTaskPackRevisionReviewEvents(firstTaskPackId, current.id))[0]?.id, "review-event-1");
});

scenario("event rows are append-only through the adapter contract", () => {
  assert.equal("updateTaskPackAggregateLifecycleEvent" in adapter, false);
  assert.equal("updateTaskPackRevisionReviewEvent" in adapter, false);
});

scenario("database rejects lifecycle and review event mutation", () => {
  const db = openPersistedDatabase(legacyDatabasePath);
  try {
    assert.throws(() =>
      db.run("UPDATE task_pack_lifecycle_events SET actor_id = 'changed' WHERE id = 'lifecycle-event-1';"),
    );
    assert.throws(() =>
      db.run("UPDATE task_pack_revision_review_events SET actor_id = 'changed' WHERE id = 'review-event-1';"),
    );
  } finally {
    db.close();
  }
});

scenario("project deletion cascades aggregate revisions and events", () => {
  const db = openPersistedDatabase(legacyDatabasePath);
  try {
    db.run("DELETE FROM projects WHERE id = 1;");
    assert.equal(Number(scalar(db, "SELECT COUNT(*) AS value FROM task_packs;")), 0);
    assert.equal(Number(scalar(db, "SELECT COUNT(*) AS value FROM task_pack_revisions;")), 0);
    assert.equal(Number(scalar(db, "SELECT COUNT(*) AS value FROM task_pack_lifecycle_events;")), 0);
    assert.equal(Number(scalar(db, "SELECT COUNT(*) AS value FROM task_pack_revision_review_events;")), 0);
  } finally {
    db.close();
  }
});

scenario("SQLite migration rolls back DDL, backfill, and ledger on injected failure", () => {
  const db = new SQL.Database();
  try {
    createLegacySchemaV2(db);
    insertLegacyTaskPacks(db);
    const migration = SQLITE_MIGRATIONS.find((item) => item.id === TASK_PACK_LIFECYCLE_MIGRATION_ID);
    assert.ok(migration);
    assert.throws(() =>
      applySqliteMigrationTransaction(db, migration, "2026-09-18T12:00:00.000Z", {
        beforeRecord: () => {
          throw new Error("injected migration failure");
        },
      }),
    );
    assert.equal(Number(scalar(db, "SELECT COUNT(*) AS value FROM task_packs;")), 2);
    assert.equal(
      Number(scalar(db, `SELECT COUNT(*) AS value FROM schema_migrations WHERE id = '${TASK_PACK_LIFECYCLE_MIGRATION_ID}';`)),
      0,
    );
    assert.equal(
      Number(scalar(db, "SELECT COUNT(*) AS value FROM sqlite_master WHERE type = 'table' AND name = 'task_pack_revisions';")),
      0,
    );
    const columnNames = (db.exec("PRAGMA table_info(task_packs);")[0]?.values ?? []).map((row) => String(row[1]));
    assert.equal(columnNames.includes("current_revision_id"), false);
  } finally {
    db.close();
  }
});

scenario("PostgreSQL logical schema carries equivalent lifecycle contracts", () => {
  for (const token of [
    "task_pack_revisions",
    "task_pack_lifecycle_events",
    "task_pack_revision_review_events",
    "current_revision_id",
    "accepted_revision_id",
    "archived_from_state",
    "UNIQUE (task_pack_id, revision_number)",
    "FOREIGN KEY (task_pack_id, base_revision_id)",
    "ON DELETE CASCADE",
  ]) {
    assert.ok(POSTGRES_TASK_PACK_LIFECYCLE_DDL.includes(token), token);
  }
  for (const token of [
    "task_packs_current_revision_ownership_fk",
    "task_packs_accepted_revision_ownership_fk",
    "DEFERRABLE INITIALLY DEFERRED",
    "task_pack_revisions_immutable",
    "task_pack_lifecycle_events_immutable",
    "task_pack_revision_review_events_immutable",
  ]) {
    assert.ok(POSTGRES_TASK_PACK_LIFECYCLE_CONSTRAINTS.includes(token), token);
  }
  const revisionBlock = POSTGRES_TASK_PACK_LIFECYCLE_DDL.split("CREATE TABLE task_pack_revisions")[1]!
    .split("CREATE TABLE task_pack_lifecycle_events")[0]!;
  assert.equal(/\btitle\b/u.test(revisionBlock), false);
  assert.equal(/\bproject_id\b/u.test(revisionBlock), false);
});

scenario("PostgreSQL migration orchestration rolls back on failure", async () => {
  const calls: string[] = [];
  await assert.rejects(() =>
    applyPostgresTaskPackLifecycleMigration(
      {
        query: async (text) => {
          calls.push(text);
          if (text === POSTGRES_TASK_PACK_LIFECYCLE_DDL) {
            throw new Error("injected PostgreSQL migration failure");
          }
          return { rows: [], rowCount: 0 };
        },
      },
      "2026-09-18T12:00:00.000Z",
    ),
  );
  assert.equal(calls[0], "BEGIN");
  assert.equal(calls.at(-1), "ROLLBACK");
  assert.equal(calls.includes("COMMIT"), false);
});

try {
  SQL = await initSqlJs({ locateFile: (file) => path.join(sqlJsDistPath(), file) });
  for (const item of scenarios) {
    try {
      await item.run();
    } catch (error) {
      console.error(`Task Pack lifecycle storage smoke failed: ${item.name}`);
      throw error;
    }
  }
  console.log(`Task Pack lifecycle storage smoke passed: ${scenarios.length} scenarios`);
} finally {
  const resolvedRoot = path.resolve(temporaryRoot);
  if (!resolvedRoot.startsWith(path.resolve(os.tmpdir()) + path.sep)) {
    throw new Error("Refusing to remove a Task Pack lifecycle smoke directory outside the OS temp root.");
  }
  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}
