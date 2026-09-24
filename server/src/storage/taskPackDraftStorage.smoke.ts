import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";

import { pool } from "../db/pool.js";
import type { TaskPackDraftContent } from "../taskPacks/taskPackLifecycle.js";
import {
  POSTGRES_TASK_PACK_DRAFTS_DDL,
  SQLITE_MIGRATIONS,
  TASK_PACK_DRAFTS_MIGRATION_ID,
  applyPostgresTaskPackDraftsMigration,
  applySqliteMigrationTransaction,
} from "./migrations.js";
import { PostgresStorageAdapter } from "./PostgresStorageAdapter.js";
import { SqliteStorageAdapter } from "./SqliteStorageAdapter.js";
import { mapTaskPackDraftPersistenceRow } from "./taskPackDraftPersistence.js";
import {
  TaskPackDraftStorageError,
  type TaskPackDraftStorageErrorCode,
  type TaskPackRecord,
} from "./types.js";

interface SmokeScenario {
  readonly name: string;
  readonly run: () => void | Promise<void>;
}

const scenarios: SmokeScenario[] = [];
const scenario = (name: string, run: SmokeScenario["run"]): void => {
  scenarios.push({ name, run });
};
const require = createRequire(import.meta.url);
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "contextforge-tp-lc-04c-"));
let SQL: SqlJsStatic;

function sqlJsDistPath(): string {
  return path.dirname(require.resolve("sql.js/dist/sql-wasm.js"));
}

function content(overrides: Partial<TaskPackDraftContent> = {}): TaskPackDraftContent {
  return {
    rawTask: "Prepare a bounded persisted draft.",
    taskType: "tests",
    targetTool: "codex",
    templateId: "default",
    ruleProfileId: null,
    enabledRuleIds: ["safe-edit", "verify"],
    customRulesText: null,
    acceptanceCriteriaPresetId: null,
    acceptanceCriteriaText: "Draft remains local and versioned.",
    clarifications: [{ question: "Scope?", answer: "Storage only" }],
    performanceSessionId: null,
    understandingSnapshotId: null,
    reviewedUnderstandingSnapshotId: null,
    ...overrides,
  };
}

async function createProject(adapter: SqliteStorageAdapter, suffix: string) {
  return adapter.upsertScannedProject({
    name: `Draft fixture ${suffix}`,
    localPath: path.join(temporaryRoot, `project-${suffix}`),
    packageManager: "npm",
    detectedStack: ["typescript"],
    scripts: { build: "tsc" },
    readinessScore: 100,
    readinessReport: { score: 100, checks: [], issues: [] },
  });
}

async function createTaskPack(
  adapter: SqliteStorageAdapter,
  projectId: number,
  suffix: string,
): Promise<TaskPackRecord> {
  return adapter.createTaskPack({
    projectId,
    title: `Draft ownership ${suffix}`,
    rawTask: `Create ownership fixture ${suffix}.`,
    taskType: "tests",
    targetTool: "codex",
    generatedPrompt: `Verify ownership fixture ${suffix}.`,
    generationMode: "template",
    generationModel: null,
    generationMessage: null,
    generationUsedFallback: false,
    generationDurationMs: 1,
    generationRecipe: { policy: "guarded" },
  });
}

function rawDatabase(adapter: SqliteStorageAdapter): Database {
  const db = (adapter as unknown as { db: Database | null }).db;
  assert.ok(db);
  return db;
}

function rows(db: Database, sql: string): Record<string, unknown>[] {
  const statement = db.prepare(sql);
  try {
    const result: Record<string, unknown>[] = [];
    while (statement.step()) result.push(statement.getAsObject());
    return result;
  } finally {
    statement.free();
  }
}

function scalar(db: Database, sql: string): unknown {
  return rows(db, sql)[0]?.value;
}

function persist(db: Database, filePath: string): void {
  fs.writeFileSync(filePath, Buffer.from(db.export()));
}

async function createSchemaV4Database(filePath: string): Promise<void> {
  const adapter = new SqliteStorageAdapter(filePath);
  await adapter.ensureSchema();
  const project = await createProject(adapter, `v4-${path.basename(filePath)}`);
  await createTaskPack(adapter, project.id, "legacy-v4");
  const db = rawDatabase(adapter);
  db.run(`
    DROP TABLE task_pack_drafts;
    DELETE FROM schema_migrations WHERE id = '${TASK_PACK_DRAFTS_MIGRATION_ID}';
    UPDATE app_storage_metadata SET value = '4'
      WHERE key IN ('schema_version', 'schema_latest_version');
  `);
  persist(db, filePath);
}

async function expectDraftError(
  run: Promise<unknown>,
  code: TaskPackDraftStorageErrorCode,
  check?: (error: TaskPackDraftStorageError) => void,
): Promise<void> {
  await assert.rejects(run, (error: unknown) => {
    assert.ok(error instanceof TaskPackDraftStorageError);
    assert.equal(error.code, code);
    check?.(error);
    return true;
  });
}

const migrationPath = path.join(temporaryRoot, "migration-v4.sqlite");

scenario("SQLite schema-v4 database migrates additively to version 5", async () => {
  await createSchemaV4Database(migrationPath);
  const before = new SQL.Database(fs.readFileSync(migrationPath));
  const historicBefore = JSON.stringify({
    projects: rows(before, "SELECT * FROM projects ORDER BY id;"),
    taskPacks: rows(before, "SELECT * FROM task_packs ORDER BY id;"),
    revisions: rows(before, "SELECT * FROM task_pack_revisions ORDER BY id;"),
    links: rows(before, "SELECT * FROM task_pack_github_created_issue_links ORDER BY task_pack_id;"),
  });
  before.close();

  const adapter = new SqliteStorageAdapter(migrationPath);
  await adapter.ensureSchema();
  const info = await adapter.getSchemaInfo();
  assert.equal(info.currentVersion, 5);
  assert.equal(info.latestVersion, 5);
  assert.equal(info.pendingCount, 0);
  const db = rawDatabase(adapter);
  assert.equal(Number(scalar(db, "SELECT COUNT(*) AS value FROM task_pack_drafts;")), 0);
  assert.deepEqual(
    rows(db, `SELECT id, version, checksum FROM schema_migrations
              WHERE id = '${TASK_PACK_DRAFTS_MIGRATION_ID}';`),
    [{ id: TASK_PACK_DRAFTS_MIGRATION_ID, version: 5, checksum: "task-pack-drafts-v1" }],
  );
  const historicAfter = JSON.stringify({
    projects: rows(db, "SELECT * FROM projects ORDER BY id;"),
    taskPacks: rows(db, "SELECT * FROM task_packs ORDER BY id;"),
    revisions: rows(db, "SELECT * FROM task_pack_revisions ORDER BY id;"),
    links: rows(db, "SELECT * FROM task_pack_github_created_issue_links ORDER BY task_pack_id;"),
  });
  assert.equal(historicAfter, historicBefore);
});

scenario("SQLite draft schema has exact columns indexes and ownership foreign keys", () => {
  const db = new SQL.Database(fs.readFileSync(migrationPath));
  try {
    const columns = rows(db, "PRAGMA table_info(task_pack_drafts);").map((row) => row.name);
    assert.deepEqual(columns, [
      "id", "project_id", "task_pack_id", "base_revision_id", "content",
      "lifecycle_state", "materialized_revision_id", "draft_version",
      "created_at", "updated_at", "expires_at",
    ]);
    const indexes = rows(db, "PRAGMA index_list(task_pack_drafts);").map((row) => row.name);
    assert.ok(indexes.includes("idx_task_pack_drafts_active_updated"));
    assert.ok(indexes.includes("idx_task_pack_drafts_project_active_updated"));
    assert.equal(indexes.some((name) => String(name).includes("expires")), false);
    const foreignKeys = rows(db, "PRAGMA foreign_key_list(task_pack_drafts);");
    assert.ok(foreignKeys.some((row) => row.table === "projects" && row.on_delete === "CASCADE"));
    assert.ok(foreignKeys.some((row) => row.table === "task_packs" && row.on_delete === "CASCADE"));
    assert.equal(foreignKeys.filter((row) => row.table === "task_pack_revisions").length, 4);
  } finally {
    db.close();
  }
});

scenario("SQLite migration 0005 rolls back DDL indexes and ledger on injected failure", async () => {
  const filePath = path.join(temporaryRoot, "migration-rollback-v4.sqlite");
  await createSchemaV4Database(filePath);
  const db = new SQL.Database(fs.readFileSync(filePath));
  try {
    db.run("PRAGMA foreign_keys = ON;");
    const migration = SQLITE_MIGRATIONS.find((item) => item.id === TASK_PACK_DRAFTS_MIGRATION_ID);
    assert.ok(migration);
    const taskPackCount = Number(scalar(db, "SELECT COUNT(*) AS value FROM task_packs;"));
    assert.throws(() =>
      applySqliteMigrationTransaction(db, migration, "2026-09-22T08:00:00.000Z", {
        beforeRecord: () => {
          throw new Error("injected 0005 failure");
        },
      }),
    );
    assert.equal(Number(scalar(db, "SELECT COUNT(*) AS value FROM task_packs;")), taskPackCount);
    assert.equal(
      Number(scalar(db, "SELECT COUNT(*) AS value FROM sqlite_master WHERE type = 'table' AND name = 'task_pack_drafts';")),
      0,
    );
    assert.equal(
      Number(scalar(db, "SELECT COUNT(*) AS value FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_task_pack_drafts_%';")),
      0,
    );
    assert.equal(
      Number(scalar(db, `SELECT COUNT(*) AS value FROM schema_migrations WHERE id = '${TASK_PACK_DRAFTS_MIGRATION_ID}';`)),
      0,
    );
  } finally {
    db.close();
  }
});

const crudPath = path.join(temporaryRoot, "draft-crud.sqlite");
const adapter = new SqliteStorageAdapter(crudPath);
let projectOneId = 0;
let projectTwoId = 0;
let taskPackOne: TaskPackRecord;
let taskPackTwo: TaskPackRecord;
let taskPackOneRevisionId = 0;
let taskPackTwoRevisionId = 0;

scenario("SQLite fixture establishes two project-owned Task Packs", async () => {
  await adapter.ensureSchema();
  const projectOne = await createProject(adapter, "one");
  const projectTwo = await createProject(adapter, "two");
  projectOneId = projectOne.id;
  projectTwoId = projectTwo.id;
  taskPackOne = await createTaskPack(adapter, projectOneId, "one");
  taskPackTwo = await createTaskPack(adapter, projectTwoId, "two");
  taskPackOneRevisionId = (await adapter.getCurrentTaskPackRevision(taskPackOne.id))!.id;
  taskPackTwoRevisionId = (await adapter.getCurrentTaskPackRevision(taskPackTwo.id))!.id;
});

scenario("new-aggregate draft creates active version 1 without Task Pack side effects", async () => {
  const db = rawDatabase(adapter);
  const taskPacksBefore = Number(scalar(db, "SELECT COUNT(*) AS value FROM task_packs;"));
  const revisionsBefore = Number(scalar(db, "SELECT COUNT(*) AS value FROM task_pack_revisions;"));
  const created = await adapter.createTaskPackDraft({
    id: "draft-new-aggregate",
    projectId: projectOneId,
    taskPackId: null,
    baseRevisionId: null,
    content: content(),
    expiresAt: "2026-12-31T00:00:00.000Z",
  });
  assert.equal(created.lifecycle.state, "active");
  assert.equal(created.lifecycle.materializedRevisionId, null);
  assert.equal(created.draftVersion, 1);
  assert.deepEqual(created.content, content());
  assert.ok(Number.isFinite(Date.parse(created.createdAt)));
  assert.equal(created.createdAt, created.updatedAt);
  assert.equal(created.expiresAt, "2026-12-31T00:00:00.000Z");
  assert.equal(Number(scalar(db, "SELECT COUNT(*) AS value FROM task_packs;")), taskPacksBefore);
  assert.equal(Number(scalar(db, "SELECT COUNT(*) AS value FROM task_pack_revisions;")), revisionsBefore);
});

scenario("draft creation rejects missing project", async () => {
  await expectDraftError(
    adapter.createTaskPackDraft({
      id: "draft-missing-project", projectId: 999999, taskPackId: null,
      baseRevisionId: null, content: content(), expiresAt: null,
    }),
    "TASK_PACK_DRAFT_PROJECT_NOT_FOUND",
  );
});

scenario("draft creation rejects missing Task Pack", async () => {
  await expectDraftError(
    adapter.createTaskPackDraft({
      id: "draft-missing-task-pack", projectId: projectOneId, taskPackId: 999999,
      baseRevisionId: null, content: content(), expiresAt: null,
    }),
    "TASK_PACK_DRAFT_TASK_PACK_NOT_FOUND",
  );
});

scenario("draft creation rejects Task Pack from another project", async () => {
  await expectDraftError(
    adapter.createTaskPackDraft({
      id: "draft-foreign-task-pack", projectId: projectOneId, taskPackId: taskPackTwo.id,
      baseRevisionId: null, content: content(), expiresAt: null,
    }),
    "TASK_PACK_DRAFT_OWNERSHIP_INVALID",
  );
});

scenario("draft creation rejects missing and foreign base revisions", async () => {
  await expectDraftError(
    adapter.createTaskPackDraft({
      id: "draft-missing-base", projectId: projectOneId, taskPackId: taskPackOne.id,
      baseRevisionId: 999999, content: content(), expiresAt: null,
    }),
    "TASK_PACK_DRAFT_BASE_REVISION_INVALID",
  );
  await expectDraftError(
    adapter.createTaskPackDraft({
      id: "draft-foreign-base", projectId: projectOneId, taskPackId: taskPackOne.id,
      baseRevisionId: taskPackTwoRevisionId, content: content(), expiresAt: null,
    }),
    "TASK_PACK_DRAFT_BASE_REVISION_INVALID",
  );
});

scenario("valid Task Pack and base revision ownership creates a bound draft", async () => {
  const created = await adapter.createTaskPackDraft({
    id: "draft-valid-bound",
    projectId: projectOneId,
    taskPackId: taskPackOne.id,
    baseRevisionId: taskPackOneRevisionId,
    content: content({ rawTask: "Edit from an exact base revision." }),
    expiresAt: null,
  });
  assert.equal(created.taskPackId, taskPackOne.id);
  assert.equal(created.baseRevisionId, taskPackOneRevisionId);
});

scenario("draft identifiers are write-once", async () => {
  await expectDraftError(
    adapter.createTaskPackDraft({
      id: "draft-valid-bound",
      projectId: projectOneId,
      taskPackId: taskPackOne.id,
      baseRevisionId: taskPackOneRevisionId,
      content: content({ rawTask: "Duplicate identifier must fail." }),
      expiresAt: null,
    }),
    "TASK_PACK_DRAFT_ALREADY_EXISTS",
  );
});

scenario("multiple active drafts list globally and by project with deterministic ordering", async () => {
  await adapter.createTaskPackDraft({
    id: "draft-order-b", projectId: projectOneId, taskPackId: null,
    baseRevisionId: null, content: content({ rawTask: "Order B" }), expiresAt: null,
  });
  await adapter.createTaskPackDraft({
    id: "draft-order-a", projectId: projectOneId, taskPackId: null,
    baseRevisionId: null, content: content({ rawTask: "Order A" }), expiresAt: null,
  });
  await adapter.createTaskPackDraft({
    id: "draft-project-two", projectId: projectTwoId, taskPackId: null,
    baseRevisionId: null, content: content({ rawTask: "Project two" }), expiresAt: null,
  });
  rawDatabase(adapter).run(
    "UPDATE task_pack_drafts SET updated_at = '2026-09-22T10:00:00.000Z' WHERE id IN ('draft-order-a', 'draft-order-b');",
  );
  const projectDrafts = await adapter.listActiveTaskPackDrafts(projectOneId);
  const tied = projectDrafts.filter((draft) => draft.id.startsWith("draft-order-")).map((draft) => draft.id);
  assert.deepEqual(tied, ["draft-order-a", "draft-order-b"]);
  const global = await adapter.listActiveTaskPackDrafts();
  assert.ok(global.some((draft) => draft.projectId === projectOneId));
  assert.ok(global.some((draft) => draft.projectId === projectTwoId));
  assert.ok(projectDrafts.every((draft) => draft.projectId === projectOneId));
});

scenario("successful update atomically changes content version and updatedAt", async () => {
  const before = (await adapter.getTaskPackDraftById("draft-new-aggregate"))!;
  const updated = await adapter.updateTaskPackDraft({
    draftId: before.id,
    expectedDraftVersion: before.draftVersion,
    content: content({ rawTask: "Updated persisted draft." }),
  });
  assert.equal(updated.draftVersion, 2);
  assert.equal(updated.content.rawTask, "Updated persisted draft.");
  assert.equal(updated.createdAt, before.createdAt);
  assert.notEqual(updated.updatedAt, before.updatedAt);
  assert.equal(updated.lifecycle.state, "active");
});

scenario("semantic no-op ignores JavaScript key insertion order and retains version timestamp", async () => {
  const before = (await adapter.getTaskPackDraftById("draft-new-aggregate"))!;
  const reordered = Object.fromEntries(
    Object.entries(before.content).reverse(),
  ) as unknown as TaskPackDraftContent;
  const result = await adapter.updateTaskPackDraft({
    draftId: before.id,
    expectedDraftVersion: before.draftVersion,
    content: reordered,
  });
  assert.equal(result.draftVersion, before.draftVersion);
  assert.equal(result.updatedAt, before.updatedAt);
  assert.deepEqual(result.content, before.content);
});

scenario("stale update conflicts before content no-op detection", async () => {
  const current = (await adapter.getTaskPackDraftById("draft-new-aggregate"))!;
  await expectDraftError(
    adapter.updateTaskPackDraft({
      draftId: current.id,
      expectedDraftVersion: 1,
      content: current.content,
    }),
    "TASK_PACK_DRAFT_CONFLICT",
    (error) => {
      assert.equal(error.expectedDraftVersion, 1);
      assert.equal(error.actualDraftVersion, 2);
    },
  );
  assert.deepEqual(await adapter.getTaskPackDraftById(current.id), current);
});

scenario("discard retains content increments once and removes draft from active discovery", async () => {
  const before = (await adapter.getTaskPackDraftById("draft-new-aggregate"))!;
  const discarded = await adapter.discardTaskPackDraft({
    draftId: before.id,
    expectedDraftVersion: before.draftVersion,
  });
  assert.equal(discarded.lifecycle.state, "discarded");
  assert.equal(discarded.lifecycle.materializedRevisionId, null);
  assert.equal(discarded.draftVersion, before.draftVersion + 1);
  assert.deepEqual(discarded.content, before.content);
  assert.notEqual(discarded.updatedAt, before.updatedAt);
  assert.equal((await adapter.listActiveTaskPackDrafts()).some((draft) => draft.id === before.id), false);
  assert.deepEqual(await adapter.getTaskPackDraftById(before.id), discarded);
  await expectDraftError(
    adapter.discardTaskPackDraft({ draftId: before.id, expectedDraftVersion: discarded.draftVersion }),
    "TASK_PACK_DRAFT_NOT_EDITABLE",
  );
  await expectDraftError(
    adapter.updateTaskPackDraft({
      draftId: before.id,
      expectedDraftVersion: discarded.draftVersion,
      content: content({ rawTask: "Cannot edit discarded draft." }),
    }),
    "TASK_PACK_DRAFT_NOT_EDITABLE",
  );
});

scenario("missing draft operations fail with stable NOT_FOUND", async () => {
  await expectDraftError(
    adapter.updateTaskPackDraft({
      draftId: "draft-does-not-exist", expectedDraftVersion: 1, content: content(),
    }),
    "TASK_PACK_DRAFT_NOT_FOUND",
  );
  await expectDraftError(
    adapter.discardTaskPackDraft({ draftId: "draft-does-not-exist", expectedDraftVersion: 1 }),
    "TASK_PACK_DRAFT_NOT_FOUND",
  );
});

scenario("maximum safe draft version permits no-op but rejects mutation and discard", async () => {
  const filePath = path.join(temporaryRoot, "version-max.sqlite");
  const storage = new SqliteStorageAdapter(filePath);
  await storage.ensureSchema();
  const project = await createProject(storage, "version-max");
  const created = await storage.createTaskPackDraft({
    id: "draft-version-max", projectId: project.id, taskPackId: null,
    baseRevisionId: null, content: content(), expiresAt: null,
  });
  rawDatabase(storage).run(
    "UPDATE task_pack_drafts SET draft_version = ? WHERE id = ?;",
    [Number.MAX_SAFE_INTEGER, created.id],
  );
  const maximum = (await storage.getTaskPackDraftById(created.id))!;
  const noOp = await storage.updateTaskPackDraft({
    draftId: maximum.id,
    expectedDraftVersion: Number.MAX_SAFE_INTEGER,
    content: maximum.content,
  });
  assert.equal(noOp.draftVersion, Number.MAX_SAFE_INTEGER);
  await expectDraftError(
    storage.updateTaskPackDraft({
      draftId: maximum.id,
      expectedDraftVersion: Number.MAX_SAFE_INTEGER,
      content: content({ rawTask: "Would overflow." }),
    }),
    "TASK_PACK_DRAFT_VERSION_EXHAUSTED",
  );
  await expectDraftError(
    storage.discardTaskPackDraft({
      draftId: maximum.id,
      expectedDraftVersion: Number.MAX_SAFE_INTEGER,
    }),
    "TASK_PACK_DRAFT_VERSION_EXHAUSTED",
  );
  assert.equal((await storage.getTaskPackDraftById(maximum.id))!.draftVersion, Number.MAX_SAFE_INTEGER);
});

scenario("project and bound Task Pack deletion cascade only owned drafts", async () => {
  const filePath = path.join(temporaryRoot, "cascade.sqlite");
  const storage = new SqliteStorageAdapter(filePath);
  await storage.ensureSchema();
  const project = await createProject(storage, "cascade-owner");
  const unrelatedProject = await createProject(storage, "cascade-unrelated");
  const taskPack = await createTaskPack(storage, project.id, "cascade");
  const revision = (await storage.getCurrentTaskPackRevision(taskPack.id))!;
  await storage.createTaskPackDraft({
    id: "draft-bound-cascade", projectId: project.id, taskPackId: taskPack.id,
    baseRevisionId: revision.id, content: content(), expiresAt: null,
  });
  await storage.createTaskPackDraft({
    id: "draft-project-cascade", projectId: project.id, taskPackId: null,
    baseRevisionId: null, content: content(), expiresAt: null,
  });
  await storage.createTaskPackDraft({
    id: "draft-unrelated", projectId: unrelatedProject.id, taskPackId: null,
    baseRevisionId: null, content: content(), expiresAt: null,
  });
  const db = rawDatabase(storage);
  assert.equal(Number(rows(db, "PRAGMA foreign_keys;")[0]?.foreign_keys), 1);
  db.run("DELETE FROM task_packs WHERE id = ?;", [taskPack.id]);
  assert.equal(Number(scalar(db, "SELECT changes() AS value;")), 1);
  assert.equal(Number(scalar(db, `SELECT COUNT(*) AS value FROM task_packs WHERE id = ${taskPack.id};`)), 0);
  assert.equal(await storage.getTaskPackDraftById("draft-bound-cascade"), null);
  assert.ok(await storage.getTaskPackDraftById("draft-project-cascade"));
  db.run("DELETE FROM projects WHERE id = ?;", [project.id]);
  assert.equal(await storage.getTaskPackDraftById("draft-project-cascade"), null);
  assert.ok(await storage.getTaskPackDraftById("draft-unrelated"));
});

scenario("malformed persisted JSON fails closed instead of being omitted", async () => {
  const filePath = path.join(temporaryRoot, "malformed.sqlite");
  const storage = new SqliteStorageAdapter(filePath);
  await storage.ensureSchema();
  const project = await createProject(storage, "malformed");
  await storage.createTaskPackDraft({
    id: "draft-malformed", projectId: project.id, taskPackId: null,
    baseRevisionId: null, content: content(), expiresAt: null,
  });
  rawDatabase(storage).run(
    "UPDATE task_pack_drafts SET content = '{not-json' WHERE id = 'draft-malformed';",
  );
  await expectDraftError(
    storage.getTaskPackDraftById("draft-malformed"),
    "TASK_PACK_DRAFT_STATE_INVALID",
  );
  await expectDraftError(
    storage.listActiveTaskPackDrafts(project.id),
    "TASK_PACK_DRAFT_STATE_INVALID",
  );
});

scenario("PostgreSQL migration 0005 has schema ownership indexes ledger and commit parity", async () => {
  for (const token of [
    "CREATE TABLE task_pack_drafts",
    "content JSONB NOT NULL",
    "jsonb_typeof(content) = 'object'",
    "draft_version BIGINT NOT NULL",
    "draft_version <= 9007199254740991",
    "REFERENCES projects(id) ON DELETE CASCADE",
    "REFERENCES task_packs(id) ON DELETE CASCADE",
    "FOREIGN KEY (task_pack_id, base_revision_id)",
    "FOREIGN KEY (task_pack_id, materialized_revision_id)",
    "idx_task_pack_drafts_active_updated",
    "idx_task_pack_drafts_project_active_updated",
    "WHERE lifecycle_state = 'active'",
  ]) {
    assert.ok(POSTGRES_TASK_PACK_DRAFTS_DDL.includes(token), token);
  }
  const calls: Array<{ text: string; values?: readonly unknown[] }> = [];
  await applyPostgresTaskPackDraftsMigration(
    {
      query: async (text, values) => {
        calls.push({ text, values });
        return { rows: [], rowCount: 0 };
      },
    },
    "2026-09-22T12:00:00.000Z",
  );
  assert.equal(calls[0]?.text, "BEGIN");
  assert.equal(calls[1]?.text, POSTGRES_TASK_PACK_DRAFTS_DDL);
  assert.deepEqual(calls[2]?.values?.slice(0, 4), [
    TASK_PACK_DRAFTS_MIGRATION_ID,
    "Persisted Task Pack drafts",
    "Adds local persisted Task Pack drafts with optimistic concurrency and terminal draft lifecycle state.",
    "task-pack-drafts-v1",
  ]);
  assert.equal(calls.at(-1)?.text, "COMMIT");
});

scenario("shared mapper normalizes PostgreSQL BIGINT draft versions beyond int32", () => {
  const persistenceRow = (draftVersion: unknown) => ({
    id: "draft-postgres-bigint",
    project_id: 1,
    task_pack_id: null,
    base_revision_id: null,
    content: content(),
    lifecycle_state: "active",
    materialized_revision_id: null,
    draft_version: draftVersion,
    created_at: "2026-09-22T12:00:00.000Z",
    updated_at: "2026-09-22T12:00:00.000Z",
    expires_at: null,
  });

  assert.equal(
    mapTaskPackDraftPersistenceRow(persistenceRow("2147483648")).draftVersion,
    2147483648,
  );
  assert.equal(
    mapTaskPackDraftPersistenceRow(persistenceRow("9007199254740991")).draftVersion,
    Number.MAX_SAFE_INTEGER,
  );
});

scenario("shared mapper fails closed for invalid PostgreSQL BIGINT draft versions", () => {
  const persistenceRow = (draftVersion: unknown) => ({
    id: "draft-postgres-invalid-bigint",
    project_id: 1,
    task_pack_id: null,
    base_revision_id: null,
    content: content(),
    lifecycle_state: "active",
    materialized_revision_id: null,
    draft_version: draftVersion,
    created_at: "2026-09-22T12:00:00.000Z",
    updated_at: "2026-09-22T12:00:00.000Z",
    expires_at: null,
  });

  for (const invalidDraftVersion of ["9007199254740992", "not-a-number", "1.5", "0", "-1"]) {
    assert.throws(
      () => mapTaskPackDraftPersistenceRow(persistenceRow(invalidDraftVersion)),
      (error: unknown) => {
        assert.ok(error instanceof TaskPackDraftStorageError);
        assert.equal(error.code, "TASK_PACK_DRAFT_STATE_INVALID");
        return true;
      },
      invalidDraftVersion,
    );
  }
});

scenario("PostgreSQL migration 0005 rolls back on failure", async () => {
  const calls: string[] = [];
  await assert.rejects(() =>
    applyPostgresTaskPackDraftsMigration(
      {
        query: async (text) => {
          calls.push(text);
          if (text === POSTGRES_TASK_PACK_DRAFTS_DDL) throw new Error("injected PostgreSQL 0005 failure");
          return { rows: [], rowCount: 0 };
        },
      },
      "2026-09-22T12:00:00.000Z",
    ),
  );
  assert.equal(calls[0], "BEGIN");
  assert.equal(calls.at(-1), "ROLLBACK");
  assert.equal(calls.includes("COMMIT"), false);
});

scenario("PostgreSQL adapter preserves locked guarded CAS and discard parity", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src", "storage", "PostgresStorageAdapter.ts"),
    "utf8",
  );
  const update = source.split("async updateTaskPackDraft")[1]!.split("async discardTaskPackDraft")[0]!;
  const discard = source.split("async discardTaskPackDraft")[1]!.split("async listTaskPacks")[0]!;
  for (const token of [
    "BEGIN",
    "SELECT * FROM task_pack_drafts WHERE id = $1 FOR UPDATE",
    "current.draftVersion !== input.expectedDraftVersion",
    "taskPackDraftContentsEqual",
    "draft_version = draft_version + 1",
    "lifecycle_state = 'active'",
    "draft_version = $4",
    "updated.rowCount !== 1",
    "COMMIT",
    "ROLLBACK",
  ]) assert.ok(update.includes(token), token);
  for (const token of [
    "BEGIN",
    "SELECT * FROM task_pack_drafts WHERE id = $1 FOR UPDATE",
    "current.draftVersion !== input.expectedDraftVersion",
    "lifecycle_state = 'discarded'",
    "draft_version = draft_version + 1",
    "draft_version = $3",
    "updated.rowCount !== 1",
    "COMMIT",
    "ROLLBACK",
  ]) assert.ok(discard.includes(token), token);
});

scenario("PostgreSQL ensureSchema and schema info expose independent version 5 state", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src", "storage", "PostgresStorageAdapter.ts"),
    "utf8",
  );
  assert.ok(source.includes("applyPostgresTaskPackDraftsMigration"));
  assert.ok(source.includes("[TASK_PACK_DRAFTS_MIGRATION_ID]"));
  assert.ok(source.includes("const currentVersion = draftsApplied ? 5 : githubLinkApplied ? 4"));
  assert.ok(source.includes("latestVersion: 5"));
  assert.ok(source.includes("version: 5"));
  assert.ok(source.includes("status: pendingMigrations.length === 0 ? \"ready\" : \"needs_migration\""));
});

scenario("PostgreSQL schema info reports version 4 pending and version 5 ready", async () => {
  const postgres = new PostgresStorageAdapter();
  const originalQuery = pool.query;
  const originalEnsureSchema = postgres.ensureSchema;
  const migrationRows = [
    {
      id: "0003_task_pack_lifecycle_revisions",
      version: 3,
      name: "Task Pack lifecycle and immutable revisions",
      description: null,
      checksum: "task-pack-lifecycle-revisions-v1",
      appliedAt: "2026-09-20T00:00:00.000Z",
    },
    {
      id: "0004_task_pack_github_created_issue_link",
      version: 4,
      name: "Task Pack created GitHub issue linkage",
      description: null,
      checksum: "task-pack-github-created-issue-link-v1",
      appliedAt: "2026-09-21T00:00:00.000Z",
    },
  ];
  try {
    postgres.ensureSchema = async () => {};
    (pool as unknown as { query: (text: string) => Promise<unknown> }).query = async () => ({
      rows: migrationRows,
      rowCount: migrationRows.length,
    });
    const pending = await postgres.getSchemaInfo();
    assert.equal(pending.currentVersion, 4);
    assert.equal(pending.latestVersion, 5);
    assert.equal(pending.status, "needs_migration");
    assert.equal(pending.pendingCount, 1);
    assert.equal(pending.pendingMigrations[0]?.id, TASK_PACK_DRAFTS_MIGRATION_ID);

    migrationRows.push({
      id: TASK_PACK_DRAFTS_MIGRATION_ID,
      version: 5,
      name: "Persisted Task Pack drafts",
      description: null,
      checksum: "task-pack-drafts-v1",
      appliedAt: "2026-09-22T00:00:00.000Z",
    });
    const ready = await postgres.getSchemaInfo();
    assert.equal(ready.currentVersion, 5);
    assert.equal(ready.latestVersion, 5);
    assert.equal(ready.status, "ready");
    assert.equal(ready.pendingCount, 0);
  } finally {
    pool.query = originalQuery;
    postgres.ensureSchema = originalEnsureSchema;
  }
});

try {
  SQL = await initSqlJs({ locateFile: (file) => path.join(sqlJsDistPath(), file) });
  for (const item of scenarios) {
    try {
      await item.run();
    } catch (error) {
      console.error(`Task Pack draft storage smoke failed: ${item.name}`);
      throw error;
    }
  }
  console.log(`Task Pack draft storage smoke passed: ${scenarios.length} scenarios`);
} finally {
  const resolvedRoot = path.resolve(temporaryRoot);
  if (!resolvedRoot.startsWith(path.resolve(os.tmpdir()) + path.sep)) {
    throw new Error("Refusing to remove a Task Pack draft smoke directory outside the OS temp root.");
  }
  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}
