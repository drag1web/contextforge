import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";

import {
  POSTGRES_TASK_PACK_GITHUB_CREATED_ISSUE_LINK_DDL,
  SQLITE_MIGRATIONS,
  TASK_PACK_GITHUB_CREATED_ISSUE_LINK_MIGRATION_ID,
  TASK_PACK_LIFECYCLE_MIGRATION_ID,
  applyPostgresTaskPackGitHubCreatedIssueLinkMigration,
  applySqliteMigrationTransaction,
} from "../storage/migrations.js";
import { SqliteStorageAdapter } from "../storage/SqliteStorageAdapter.js";
import {
  TaskPackGitHubCreatedIssueLinkStorageError,
  type TaskPackGitHubCreatedIssueLinkRecord,
} from "../storage/types.js";
import {
  createTaskPackApplicationService,
  TaskPackGitHubCreatedIssueAlreadyLinkedError,
} from "./taskPackApplicationService.js";

interface SmokeScenario {
  readonly name: string;
  readonly run: () => void | Promise<void>;
}

const scenarios: SmokeScenario[] = [];
const scenario = (name: string, run: SmokeScenario["run"]) =>
  scenarios.push({ name, run });
const require = createRequire(import.meta.url);
const temporaryRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "contextforge-tp-lc-03f-"),
);
const databasePath = path.join(temporaryRoot, "github-link-v3.sqlite");
const rollbackDatabasePath = path.join(temporaryRoot, "rollback-v3.sqlite");
const timestamp = "2026-09-22T10:00:00.000Z";
const validCompatibilityLink = {
  type: "github-created-issue",
  owner: "contextforge-fixture",
  repo: "product",
  fullName: "contextforge-fixture/product",
  issueNumber: 41,
  issueTitle: "Track Task Pack lifecycle",
  issueUrl: "https://github.com/contextforge-fixture/product/issues/41",
  issueState: "open",
  labels: ["task-pack", "lifecycle"],
  repositoryUrl: "https://github.com/contextforge-fixture/product",
  createdAt: timestamp,
  createdFromTaskPackId: 1,
} as const;

let SQL: SqlJsStatic;
let adapter: SqliteStorageAdapter;
let newTaskPackId = 0;
let newRevisionBefore = "";

function rows<T>(db: Database, sql: string): T[] {
  const statement = db.prepare(sql);
  try {
    const result: T[] = [];
    while (statement.step()) result.push(statement.getAsObject() as T);
    return result;
  } finally {
    statement.free();
  }
}

function scalar(db: Database, sql: string): unknown {
  return rows<{ value: unknown }>(db, sql)[0]?.value;
}

function createV3Database(filePath: string): void {
  const db = new SQL.Database();
  try {
    db.run(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE schema_migrations (
        id TEXT PRIMARY KEY, version INTEGER NOT NULL, name TEXT NOT NULL,
        description TEXT, checksum TEXT NOT NULL, applied_at TEXT NOT NULL
      );
      CREATE TABLE projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
        local_path TEXT NOT NULL UNIQUE, package_manager TEXT,
        detected_stack TEXT NOT NULL DEFAULT '[]', scripts TEXT NOT NULL DEFAULT '{}',
        readiness_score INTEGER NOT NULL DEFAULT 0,
        readiness_report TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL, last_scan_at TEXT
      );
      CREATE TABLE task_packs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL,
        title TEXT NOT NULL, raw_task TEXT NOT NULL,
        task_type TEXT NOT NULL DEFAULT 'general', target_tool TEXT NOT NULL DEFAULT 'generic',
        generated_prompt TEXT NOT NULL, generation_mode TEXT NOT NULL DEFAULT 'template',
        generation_model TEXT, generation_message TEXT,
        generation_used_fallback INTEGER NOT NULL DEFAULT 0,
        generation_duration_ms INTEGER, generation_recipe TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      INSERT INTO schema_migrations VALUES
        ('0001_sqlite_baseline', 1, 'baseline', NULL, 'sqlite-baseline-v1', '${timestamp}'),
        ('0002_rules_templates_catalog', 2, 'catalog', NULL, 'rules-templates-catalog-v1', '${timestamp}');
      INSERT INTO projects (
        id, name, local_path, package_manager, detected_stack, scripts,
        readiness_score, readiness_report, created_at, updated_at
      ) VALUES (
        1, 'GitHub link fixture', '/fixture/github-link', 'npm', '["typescript"]',
        '{}', 100, '{"score":100,"checks":[],"issues":[]}', '${timestamp}', '${timestamp}'
      );
    `);
    const insertTaskPack = (
      id: number,
      title: string,
      generationRecipe: Record<string, unknown>,
    ) => {
      db.run(
        `INSERT INTO task_packs (
          id, project_id, title, raw_task, task_type, target_tool, generated_prompt,
          generation_mode, generation_model, generation_message,
          generation_used_fallback, generation_duration_ms, generation_recipe,
          created_at, updated_at
        ) VALUES (?, 1, ?, ?, 'implementation', 'codex', ?, 'template', NULL, NULL, 0, 5, ?, ?, ?);`,
        [
          id,
          title,
          `Raw task ${id}`,
          `Generated prompt ${id}`,
          JSON.stringify(generationRecipe),
          timestamp,
          timestamp,
        ],
      );
    };
    insertTaskPack(1, "Valid legacy link", {
      policy: { mode: "guarded" },
      githubIssue: { type: "github-issue", issueNumber: 7 },
      githubCreatedIssue: validCompatibilityLink,
    });
    insertTaskPack(2, "Malformed legacy link", {
      policy: { mode: "guarded" },
      githubCreatedIssue: {
        ...validCompatibilityLink,
        createdFromTaskPackId: 999,
      },
    });
    insertTaskPack(3, "Unrelated recipe", { policy: { mode: "bounded" } });
    const lifecycleMigration = SQLITE_MIGRATIONS.find(
      (migration) => migration.id === TASK_PACK_LIFECYCLE_MIGRATION_ID,
    );
    assert.ok(lifecycleMigration);
    applySqliteMigrationTransaction(db, lifecycleMigration, timestamp);
    fs.writeFileSync(filePath, Buffer.from(db.export()));
  } finally {
    db.close();
  }
}

function openDatabase(filePath: string): Database {
  const db = new SQL.Database(fs.readFileSync(filePath));
  db.run("PRAGMA foreign_keys = ON;");
  return db;
}

function revisionSnapshot(db: Database, taskPackId: number): Record<string, unknown> {
  return rows<Record<string, unknown>>(
    db,
    `SELECT * FROM task_pack_revisions WHERE task_pack_id = ${taskPackId};`,
  )[0]!;
}

SQL = await initSqlJs({
  locateFile: (file) =>
    path.join(path.dirname(require.resolve("sql.js/dist/sql-wasm.js")), file),
});
createV3Database(databasePath);
createV3Database(rollbackDatabasePath);

scenario("SQLite v3 to v4 backfills valid linkage and cleans only flat compatibility metadata", async () => {
  const before = openDatabase(databasePath);
  const revisionBefore = revisionSnapshot(before, 1);
  const aggregateBefore = rows<Record<string, unknown>>(
    before,
    "SELECT current_revision_id, accepted_revision_id, lifecycle_state, lifecycle_version FROM task_packs WHERE id = 1;",
  )[0]!;
  before.close();

  adapter = new SqliteStorageAdapter(databasePath);
  await adapter.ensureSchema();
  assert.deepEqual(await adapter.getTaskPackGitHubCreatedIssueLink(1), {
    taskPackId: 1,
    owner: validCompatibilityLink.owner,
    repo: validCompatibilityLink.repo,
    fullName: validCompatibilityLink.fullName,
    issueNumber: validCompatibilityLink.issueNumber,
    issueTitle: validCompatibilityLink.issueTitle,
    issueUrl: validCompatibilityLink.issueUrl,
    issueState: validCompatibilityLink.issueState,
    labels: [...validCompatibilityLink.labels],
    repositoryUrl: validCompatibilityLink.repositoryUrl,
    createdAt: validCompatibilityLink.createdAt,
  });

  const after = openDatabase(databasePath);
  try {
    assert.equal(
      Number(
        scalar(
          after,
          `SELECT COUNT(*) AS value FROM schema_migrations WHERE id = '${TASK_PACK_GITHUB_CREATED_ISSUE_LINK_MIGRATION_ID}';`,
        ),
      ),
      1,
    );
    const link = rows<Record<string, unknown>>(
      after,
      "SELECT * FROM task_pack_github_created_issue_links WHERE task_pack_id = 1;",
    )[0]!;
    assert.equal(link.owner, validCompatibilityLink.owner);
    assert.equal(link.issue_number, validCompatibilityLink.issueNumber);
    assert.deepEqual(JSON.parse(String(link.labels)), validCompatibilityLink.labels);
    const storedRecipe = JSON.parse(
      String(
        scalar(
          after,
          "SELECT generation_recipe AS value FROM task_packs WHERE id = 1;",
        ),
      ),
    ) as Record<string, unknown>;
    assert.equal(Object.hasOwn(storedRecipe, "githubCreatedIssue"), false);
    assert.deepEqual(storedRecipe.policy, { mode: "guarded" });
    assert.deepEqual(storedRecipe.githubIssue, {
      type: "github-issue",
      issueNumber: 7,
    });
    assert.deepEqual(revisionSnapshot(after, 1), revisionBefore);
    assert.deepEqual(
      rows<Record<string, unknown>>(
        after,
        "SELECT current_revision_id, accepted_revision_id, lifecycle_state, lifecycle_version FROM task_packs WHERE id = 1;",
      )[0],
      aggregateBefore,
    );
  } finally {
    after.close();
  }
});

scenario("malformed legacy linkage remains in flat recipe without fabricated row", () => {
  const db = openDatabase(databasePath);
  try {
    assert.equal(
      Number(
        scalar(
          db,
          "SELECT COUNT(*) AS value FROM task_pack_github_created_issue_links WHERE task_pack_id = 2;",
        ),
      ),
      0,
    );
    const recipe = JSON.parse(
      String(
        scalar(db, "SELECT generation_recipe AS value FROM task_packs WHERE id = 2;"),
      ),
    ) as Record<string, unknown>;
    assert.equal(Object.hasOwn(recipe, "githubCreatedIssue"), true);
    assert.equal(
      Number(scalar(db, "SELECT COUNT(*) AS value FROM task_packs;")),
      3,
    );
  } finally {
    db.close();
  }
});

scenario("SQLite 0004 migration rolls back linkage, cleanup, and ledger together", () => {
  const db = openDatabase(rollbackDatabasePath);
  try {
    const migration = SQLITE_MIGRATIONS.find(
      (candidate) =>
        candidate.id === TASK_PACK_GITHUB_CREATED_ISSUE_LINK_MIGRATION_ID,
    );
    assert.ok(migration);
    const recipeBefore = scalar(
      db,
      "SELECT generation_recipe AS value FROM task_packs WHERE id = 1;",
    );
    assert.throws(
      () =>
        applySqliteMigrationTransaction(db, migration, timestamp, {
          beforeRecord: () => {
            throw new Error("injected 0004 failure");
          },
        }),
      /injected 0004 failure/u,
    );
    assert.equal(
      Number(
        scalar(
          db,
          `SELECT COUNT(*) AS value FROM schema_migrations WHERE id = '${TASK_PACK_GITHUB_CREATED_ISSUE_LINK_MIGRATION_ID}';`,
        ),
      ),
      0,
    );
    assert.equal(
      Number(
        scalar(
          db,
          "SELECT COUNT(*) AS value FROM sqlite_master WHERE type = 'table' AND name = 'task_pack_github_created_issue_links';",
        ),
      ),
      0,
    );
    assert.equal(
      scalar(db, "SELECT generation_recipe AS value FROM task_packs WHERE id = 1;"),
      recipeBefore,
    );
  } finally {
    db.close();
  }
});

scenario("SQLite write-once linkage is readable through application service", async () => {
  const created = await adapter.createTaskPack({
    projectId: 1,
    title: "New aggregate linkage",
    rawTask: "Create a GitHub issue.",
    taskType: "implementation",
    targetTool: "codex",
    generatedPrompt: "Create the issue without mutating provenance.",
    generationMode: "template",
    generationModel: null,
    generationMessage: null,
    generationUsedFallback: false,
    generationDurationMs: 4,
    generationRecipe: { policy: "new-link" },
  });
  newTaskPackId = created.id;
  newRevisionBefore = JSON.stringify(
    await adapter.getCurrentTaskPackRevision(newTaskPackId),
  );
  const service = createTaskPackApplicationService(adapter);
  const linked = await service.linkCreatedGitHubIssue({
    taskPackId: newTaskPackId,
    owner: "contextforge-fixture",
    repo: "product",
    fullName: "contextforge-fixture/product",
    issueNumber: 52,
    issueTitle: "New aggregate link",
    issueUrl: "https://github.com/contextforge-fixture/product/issues/52",
    issueState: "open",
    labels: ["task-pack"],
    repositoryUrl: "https://github.com/contextforge-fixture/product",
    createdAt: timestamp,
  });
  assert.equal(linked.createdFromTaskPackId, newTaskPackId);
  assert.deepEqual(await service.getGitHubCreatedIssueLink(newTaskPackId), linked);
});

scenario("all flat read projections reconstruct compatibility metadata without storing it", async () => {
  const expected = await createTaskPackApplicationService(adapter)
    .getGitHubCreatedIssueLink(newTaskPackId);
  assert.ok(expected);
  const projections = [
    (await adapter.listTaskPacks()).find((item) => item.id === newTaskPackId),
    await adapter.getTaskPackById(newTaskPackId),
    (await adapter.listTaskPackCurrentRecords()).find(
      (item) => item.id === newTaskPackId,
    ),
    await adapter.getTaskPackCurrentRecordById(newTaskPackId),
  ];
  for (const projection of projections) {
    assert.deepEqual(
      (projection?.generationRecipe as Record<string, unknown>)
        .githubCreatedIssue,
      expected,
    );
  }
  const db = openDatabase(databasePath);
  try {
    const rawRecipe = JSON.parse(
      String(
        scalar(
          db,
          `SELECT generation_recipe AS value FROM task_packs WHERE id = ${newTaskPackId};`,
        ),
      ),
    ) as Record<string, unknown>;
    assert.equal(Object.hasOwn(rawRecipe, "githubCreatedIssue"), false);
  } finally {
    db.close();
  }
});

scenario("link creation leaves immutable revisions and hashes unchanged", async () => {
  assert.equal(
    JSON.stringify(await adapter.getCurrentTaskPackRevision(newTaskPackId)),
    newRevisionBefore,
  );
  assert.equal((await adapter.listTaskPackRevisions(newTaskPackId)).length, 1);
});

scenario("duplicate, missing aggregate, and invalid linkage writes fail closed", async () => {
  const service = createTaskPackApplicationService(adapter);
  const duplicate: TaskPackGitHubCreatedIssueLinkRecord = {
    taskPackId: newTaskPackId,
    owner: "contextforge-fixture",
    repo: "product",
    fullName: "contextforge-fixture/product",
    issueNumber: 53,
    issueTitle: "Duplicate",
    issueUrl: "https://github.com/contextforge-fixture/product/issues/53",
    issueState: "open",
    labels: [],
    repositoryUrl: "https://github.com/contextforge-fixture/product",
    createdAt: timestamp,
  };
  await assert.rejects(
    () => service.linkCreatedGitHubIssue(duplicate),
    TaskPackGitHubCreatedIssueAlreadyLinkedError,
  );
  await assert.rejects(
    () =>
      adapter.createTaskPackGitHubCreatedIssueLink({
        ...duplicate,
        taskPackId: 999_999,
      }),
    (error: unknown) =>
      error instanceof TaskPackGitHubCreatedIssueLinkStorageError &&
      error.code === "TASK_PACK_NOT_FOUND",
  );
  await assert.rejects(
    () =>
      adapter.createTaskPackGitHubCreatedIssueLink({
        ...duplicate,
        taskPackId: 3,
        issueNumber: 0,
      }),
    (error: unknown) =>
      error instanceof TaskPackGitHubCreatedIssueLinkStorageError &&
      error.code === "TASK_PACK_GITHUB_CREATED_ISSUE_LINK_INVALID",
  );
});

scenario("linkage cascades with aggregate deletion", () => {
  const db = openDatabase(databasePath);
  try {
    db.run(`DELETE FROM task_packs WHERE id = ${newTaskPackId};`);
    assert.equal(
      Number(
        scalar(
          db,
          `SELECT COUNT(*) AS value FROM task_pack_github_created_issue_links WHERE task_pack_id = ${newTaskPackId};`,
        ),
      ),
      0,
    );
  } finally {
    db.close();
  }
});

scenario("PostgreSQL 0004 preserves transaction, JSONB, cleanup, and rollback semantics", async () => {
  for (const token of [
    "CREATE TABLE task_pack_github_created_issue_links",
    "task_pack_id INTEGER PRIMARY KEY REFERENCES task_packs(id) ON DELETE CASCADE",
    "labels JSONB NOT NULL",
    "issue_number INTEGER NOT NULL CHECK (issue_number > 0)",
  ]) {
    assert.ok(POSTGRES_TASK_PACK_GITHUB_CREATED_ISSUE_LINK_DDL.includes(token));
  }
  const queries: string[] = [];
  await applyPostgresTaskPackGitHubCreatedIssueLinkMigration(
    {
      async query<T>(text: string) {
        queries.push(text);
        if (text.includes("SELECT id, generation_recipe")) {
          return {
            rows: [
              {
                id: 1,
                generation_recipe: {
                  policy: "kept",
                  githubCreatedIssue: validCompatibilityLink,
                },
              },
            ] as T[],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 1 };
      },
    },
    timestamp,
  );
  assert.equal(queries[0], "BEGIN");
  assert.equal(queries.at(-1), "COMMIT");
  assert.ok(queries.some((query) => query.includes("$9::jsonb")));
  assert.ok(
    queries.some((query) =>
      query.includes("generation_recipe = generation_recipe - 'githubCreatedIssue'"),
    ),
  );
  assert.ok(
    queries.some(
      (query) =>
        query.includes("schema_migrations") && query.includes("VALUES ($1, 4"),
    ),
  );
  assert.equal(
    queries.some(
      (query) =>
        /UPDATE\s+task_pack_revisions/iu.test(query),
    ),
    false,
  );

  const failedQueries: string[] = [];
  await assert.rejects(() =>
    applyPostgresTaskPackGitHubCreatedIssueLinkMigration(
      {
        async query<T>(text: string) {
          failedQueries.push(text);
          if (text.includes("SELECT id, generation_recipe")) {
            return {
              rows: [
                {
                  id: 1,
                  generation_recipe: {
                    githubCreatedIssue: validCompatibilityLink,
                  },
                },
              ] as T[],
              rowCount: 1,
            };
          }
          if (text.includes("UPDATE task_packs")) {
            throw new Error("injected PostgreSQL 0004 failure");
          }
          return { rows: [], rowCount: 1 };
        },
      },
      timestamp,
    ),
  );
  assert.equal(failedQueries.at(-1), "ROLLBACK");
});

scenario("PostgreSQL adapter has linkage persistence and compatibility read parity", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src", "storage", "PostgresStorageAdapter.ts"),
    "utf8",
  );
  for (const token of [
    "applyPostgresTaskPackGitHubCreatedIssueLinkMigration",
    "getTaskPackGitHubCreatedIssueLink",
    "createTaskPackGitHubCreatedIssueLink",
    "LEFT JOIN task_pack_github_created_issue_links github_link",
    'github_link.labels AS "githubLinkLabels"',
    "TASK_PACK_GITHUB_CREATED_ISSUE_LINK_EXISTS",
    "TASK_PACK_NOT_FOUND",
  ]) {
    assert.ok(source.includes(token), token);
  }
});

scenario("GitHub issue route uses separate linkage and never mutates generation recipe", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src", "routes", "taskPacks.ts"),
    "utf8",
  );
  const route = source
    .split('taskPacksRouter.post("/:id/github/issue"')[1]!
    .split('taskPacksRouter.post("/understand"')[0]!;
  assert.ok(route.includes("getGitHubCreatedIssueLink"));
  assert.ok(route.includes("linkCreatedGitHubIssue"));
  assert.ok(route.includes("storage.getTaskPackById(taskPack.id)"));
  assert.ok(route.includes("res.status(409)"));
  assert.equal(route.includes("updateTaskPackGenerationRecipe"), false);
  assert.equal(route.includes("nextRecipe"), false);
});

let passed = 0;
try {
  for (const entry of scenarios) {
    await entry.run();
    passed += 1;
    process.stdout.write(`PASS ${entry.name}\n`);
  }
  process.stdout.write(
    `Task Pack GitHub-created-issue linkage smoke passed: ${passed} scenarios.\n`,
  );
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
