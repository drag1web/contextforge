import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Database } from "sql.js";
import { pool } from "../db/pool.js";
import { TaskPackLifecycleDomainError } from "../taskPacks/taskPackLifecycle.js";
import {
  SQLITE_SCHEMA_VERSION, SQLITE_MIGRATIONS,
  TASK_PACK_LIFECYCLE_MIGRATION_ID, TASK_PACK_GITHUB_CREATED_ISSUE_LINK_MIGRATION_ID,
  TASK_PACK_DRAFTS_MIGRATION_ID, TASK_PACK_LIFECYCLE_VERSION_RANGE_MIGRATION_ID,
  POSTGRES_TASK_PACK_LIFECYCLE_DDL, POSTGRES_TASK_PACK_LIFECYCLE_CONSTRAINTS,
  POSTGRES_TASK_PACK_GITHUB_CREATED_ISSUE_LINK_DDL, POSTGRES_TASK_PACK_DRAFTS_DDL,
  POSTGRES_TASK_PACK_LIFECYCLE_VERSION_RANGE_DDL,
  applyPostgresTaskPackLifecycleVersionRangeMigration, applySqliteMigrationTransaction,
} from "./migrations.js";
import { PostgresStorageAdapter } from "./PostgresStorageAdapter.js";
import { SqliteStorageAdapter } from "./SqliteStorageAdapter.js";
import { mapTaskPackAggregatePersistenceRow, type TaskPackAggregatePersistenceRow } from "./taskPackLifecyclePersistence.js";

const scenarios: { name: string; run: () => void | Promise<void> }[] = [];
const scenario = (name: string, run: () => void | Promise<void>) => scenarios.push({ name, run });
const id = TASK_PACK_LIFECYCLE_VERSION_RANGE_MIGRATION_ID;
const stamp = "2026-09-26T12:00:00.000Z";
const migration = SQLITE_MIGRATIONS.find(item => item.id === id)!;
const source = fs.readFileSync(new URL("./migrations.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "contextforge-tp-lc-05a0-"));
const databases: Database[] = [];
function raw(adapter: SqliteStorageAdapter) {
  const db = (adapter as unknown as { db: Database }).db;
  assert.ok(db); return db;
}
function rows(db: Database, sql: string) {
  const stmt = db.prepare(sql);
  try {
    const result: Record<string, unknown>[] = [];
    while (stmt.step()) result.push(stmt.getAsObject());
    return result;
  } finally { stmt.free(); }
}
function dataSnapshot(db: Database) {
  return ["projects", "task_packs", "task_pack_revisions", "task_pack_lifecycle_events",
    "task_pack_revision_review_events", "task_pack_drafts", "task_pack_github_created_issue_links"]
    .map(table => [table, rows(db, `SELECT * FROM ${table} ORDER BY 1;`)]);
}
function schemaSnapshot(db: Database) {
  return rows(db, "SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name;");
}
function blockHash(start: string, end: string) {
  const first = source.indexOf(start), last = source.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first);
  return createHash("sha256").update(source.slice(first, last)).digest("hex");
}

// Recorded from baseline be6171b, before edits. These include 0003 DDL, backfill
// and validation, not just names. Normalize line endings only for Windows Git.
const historicalBlocks = [
  ["SQLite 0003 DDL/backfill", "const SQLITE_TASK_PACK_LIFECYCLE_DDL =", "const SQLITE_TASK_PACK_GITHUB_CREATED_ISSUE_LINK_DDL =", "06039fcfc48f335142b8af570e60b3a88ecef816ee14a7b8cdf375a7bf606bd6"],
  ["PostgreSQL 0003 DDL/constraints", "export const POSTGRES_TASK_PACK_LIFECYCLE_DDL =", "export const POSTGRES_TASK_PACK_GITHUB_CREATED_ISSUE_LINK_DDL =", "c5b7ab95ddf9b7268ef7adc345534bef61b237dd16e9309dc32b1f71445621ca"],
  ["PostgreSQL 0003 transaction/checksum", "export async function applyPostgresTaskPackLifecycleMigration(", "export async function applyPostgresTaskPackGitHubCreatedIssueLinkMigration(", "85170ff3a9abdfb6a88ee7bd808c00c3028444800c8ec1bea365b2a3d42787fa"],
  ["0003 validation", "function validateSqliteTaskPackLifecycleMigration(", "function readSqliteRows<", "68375d8c4d69dcf5c7238780b823d20663927a8980b937fdc04bcd93f419e066"],
  ["PostgreSQL draft_version DDL", "export const POSTGRES_TASK_PACK_DRAFTS_DDL =", "export async function applyPostgresTaskPackLifecycleMigration(", "1c0c62a0dcbff86b14f284cfaa9a13143bc348369b906afa870e85d0aecf13ee"],
  ["SQLite draft_version DDL", "const SQLITE_TASK_PACK_DRAFTS_DDL =", "export const SQLITE_MIGRATIONS:", "b5dcd85b2da5b9069f76ab9878132fd672247923366cfb9bfcdd8eac46462e4a"],
];
for (const [name, start, end, hash] of historicalBlocks) scenario(`${name} remains unchanged from baseline`, () => {
  assert.equal(blockHash(start!, end!), hash);
});
scenario("logical migration 0006 is independent, version 6, with unchanged 0003 checksum", () => {
  assert.equal(SQLITE_SCHEMA_VERSION, 6);
  assert.equal(id, "0006_task_pack_lifecycle_version_range");
  assert.equal(migration.version, 6);
  assert.equal(migration.checksum, "task-pack-lifecycle-version-range-v1");
  assert.equal(SQLITE_MIGRATIONS.filter(item => item.id === id).length, 1);
  assert.equal(SQLITE_MIGRATIONS.find(item => item.id === TASK_PACK_LIFECYCLE_MIGRATION_ID)!.checksum, "task-pack-lifecycle-revisions-v1");
});
scenario("PostgreSQL 0006 widens only lifecycle_version and adds a validated named safe-range check", () => {
  const ddl = POSTGRES_TASK_PACK_LIFECYCLE_VERSION_RANGE_DDL;
  assert.match(ddl, /ALTER TABLE task_packs\s+ALTER COLUMN lifecycle_version TYPE BIGINT;/);
  assert.match(ddl, /ADD CONSTRAINT task_packs_lifecycle_version_safe_range_check\s+CHECK \(lifecycle_version >= 1 AND lifecycle_version <= 9007199254740991\)/);
  assert.doesNotMatch(ddl, /DROP|RENAME|NOT VALID|draft_version|UPDATE|DELETE/i);
  assert.match(POSTGRES_TASK_PACK_LIFECYCLE_DDL, /lifecycle_version INTEGER NOT NULL DEFAULT 1/);
});

// The mapper's persistence row type historically describes SQLite numeric rows;
// pg int8 supplies strings at runtime. Cast only this intentionally driver-like fixture.
function aggregateRow(version: unknown): TaskPackAggregatePersistenceRow {
  return { id: 1, project_id: 1, title: "Range fixture", lifecycle_state: "active", archived_from_state: null,
    current_revision_id: 1, accepted_revision_id: null, lifecycle_version: version,
    created_at: stamp, updated_at: stamp, completed_at: null, archived_at: null } as TaskPackAggregatePersistenceRow;
}
for (const version of ["1", "2147483648", "9007199254740991"]) scenario(`pg BIGINT string ${version} maps to an exact safe numeric lifecycleVersion`, () => {
  assert.equal(mapTaskPackAggregatePersistenceRow(aggregateRow(version)).lifecycleVersion, Number(version));
});
for (const version of ["9007199254740992", "0", "-1", "1.5", "not-a-number"]) scenario(`mapper rejects invalid lifecycleVersion ${version}`, () => {
  assert.throws(() => mapTaskPackAggregatePersistenceRow(aggregateRow(version)), (error: unknown) =>
    error instanceof TaskPackLifecycleDomainError && error.code === "invalid_identity");
});

let v5: SqliteStorageAdapter, upgraded: SqliteStorageAdapter;
let beforeData: ReturnType<typeof dataSnapshot>, beforeSchema: ReturnType<typeof schemaSnapshot>;
let taskPackId: number;
const sqliteFile = path.join(root, "version-5.sqlite");
scenario("real SQLite version-5 fixture retains projects, revisions, events and a persisted draft", async () => {
  // Stop at the established before-ledger seam: 0001..0005 are committed, 0006 rolls back.
  v5 = new SqliteStorageAdapter(sqliteFile, { migrationTransactionHooks: {
    beforeRecord(item) { if (item.id === id) throw new Error("stop at v5 fixture"); },
  } });
  await assert.rejects(v5.ensureSchema(), /stop at v5 fixture/);
  const db = raw(v5); databases.push(db);
  assert.equal(rows(db, "SELECT MAX(version) AS version FROM schema_migrations;")[0].version, 5);
  const project = await v5.upsertScannedProject({ name: "Range fixture", localPath: path.join(root, "project"),
    packageManager: "npm", detectedStack: [], scripts: {}, readinessScore: 100,
    readinessReport: { score: 100, checks: [], issues: [] } });
  const pack = await v5.createTaskPack({ projectId: project.id, title: "Range fixture", rawTask: "Exact original task",
    taskType: "tests", targetTool: "codex", generatedPrompt: "Exact original prompt", generationMode: "template",
    generationModel: null, generationMessage: null, generationUsedFallback: false, generationRecipe: { preserved: true } });
  taskPackId = pack.id;
  await v5.createTaskPackDraft({ id: "range-draft", projectId: project.id, taskPackId: null, baseRevisionId: null,
    expiresAt: null, content: { rawTask: "Keep draft content", taskType: "tests", targetTool: "codex",
      templateId: null, ruleProfileId: null, enabledRuleIds: [], customRulesText: null,
      acceptanceCriteriaPresetId: null, acceptanceCriteriaText: null, clarifications: [],
      performanceSessionId: null, understandingSnapshotId: null, reviewedUnderstandingSnapshotId: null } });
  await v5.appendTaskPackAggregateLifecycleEvent({ id: "historic-event", taskPackId, revisionId: null,
    eventType: "archived", fromState: "active", toState: "archived", source: "user", actorId: null,
    createdAt: stamp, metadata: null });
  beforeData = dataSnapshot(db); beforeSchema = schemaSnapshot(db);
});
scenario("SQLite 0006 ledger rollback leaves all version-5 data and physical schema unchanged", () => {
  const db = raw(v5);
  assert.throws(() => applySqliteMigrationTransaction(db, migration, stamp, {
    beforeRecord() { throw new Error("injected ledger failure"); },
  }), /injected ledger failure/);
  assert.deepEqual(dataSnapshot(db), beforeData); assert.deepEqual(schemaSnapshot(db), beforeSchema);
  assert.equal(rows(db, `SELECT * FROM schema_migrations WHERE id = '${id}';`).length, 0);
});
scenario("existing SQLite v5 upgrades to v6 without any physical schema/content change", async () => {
  upgraded = new SqliteStorageAdapter(sqliteFile); await upgraded.ensureSchema();
  const db = raw(upgraded); databases.push(db);
  assert.deepEqual(dataSnapshot(db), beforeData); assert.deepEqual(schemaSnapshot(db), beforeSchema);
  const info = await upgraded.getSchemaInfo();
  assert.equal(info.currentVersion, 6); assert.equal(info.latestVersion, 6); assert.equal(info.status, "ready");
  assert.equal(info.pendingCount, 0);
  assert.deepEqual(info.appliedMigrations.filter(item => item.id === id).map(item => [item.id, item.version, item.checksum]),
    [[id, 6, "task-pack-lifecycle-version-range-v1"]]);
  assert.equal(rows(db, "PRAGMA foreign_keys;")[0].foreign_keys, 1);
});
scenario("SQLite ensureSchema rerun is idempotent and retains a single original 0006 ledger entry", async () => {
  const db = raw(upgraded), ledger = rows(db, "SELECT * FROM schema_migrations ORDER BY version;");
  await upgraded.ensureSchema(); await upgraded.ensureSchema();
  assert.deepEqual(rows(db, "SELECT * FROM schema_migrations ORDER BY version;"), ledger);
  assert.deepEqual(dataSnapshot(db), beforeData);
});
scenario("fresh SQLite database also reports logical version 6", async () => {
  const fresh = new SqliteStorageAdapter(path.join(root, "fresh.sqlite")); await fresh.ensureSchema();
  databases.push(raw(fresh)); const info = await fresh.getSchemaInfo();
  assert.equal(info.currentVersion, 6); assert.equal(info.latestVersion, 6); assert.equal(info.pendingCount, 0);
});
scenario("SQLite lifecycle INTEGER and shared mapper represent beyond-int32 and MAX_SAFE values", async () => {
  for (const value of [2147483648, Number.MAX_SAFE_INTEGER]) {
    raw(upgraded).run("UPDATE task_packs SET lifecycle_version = ? WHERE id = ?;", [value, taskPackId]);
    assert.equal((await upgraded.getTaskPackAggregate(taskPackId))!.lifecycleVersion, value);
  }
});
// Execute the EXACT standard SQL CHECK expression from the PostgreSQL DDL in sql.js.
// This proves the predicate boundaries, not a live PostgreSQL ALTER or int8 driver test.
for (const [value, allowed] of [[1, true], [2147483648, true], [Number.MAX_SAFE_INTEGER, true],
  [9007199254740992, false], [0, false], [-1, false]] as const) {
  scenario(`safe-range SQL CHECK predicate ${allowed ? "accepts" : "rejects"} ${value} (SQLite execution)`, () => {
    const db = raw(upgraded), check = POSTGRES_TASK_PACK_LIFECYCLE_VERSION_RANGE_DDL.match(/CHECK \(([^)]+)\)/)![1];
    db.run(`CREATE TEMP TABLE range_predicate (lifecycle_version BIGINT NOT NULL CHECK (${check}));`);
    try {
      const insert = () => db.run("INSERT INTO range_predicate VALUES (?);", [value]);
      if (allowed) { insert(); assert.equal(rows(db, "SELECT * FROM range_predicate;")[0].lifecycle_version, value); }
      else assert.throws(insert, /CHECK constraint failed/);
    } finally { db.run("DROP TABLE range_predicate;"); }
  });
}

type LedgerRow = { id: string; version: number; name: string; description: string | null; checksum: string; appliedAt: string };
const previousIds = [TASK_PACK_LIFECYCLE_MIGRATION_ID, TASK_PACK_GITHUB_CREATED_ISSUE_LINK_MIGRATION_ID, TASK_PACK_DRAFTS_MIGRATION_ID];
/** Transaction/ledger orchestration fake. NOT a PostgreSQL SQL engine. */
function postgresFake(existing = true, failure?: "ddl" | "ledger" | "commit") {
  let ledger: LedgerRow[] = existing ? previousIds.map((migrationId, i) => ({ id: migrationId, version: i + 3,
    name: "Historical migration", description: null, checksum: "historical", appliedAt: stamp })) : [];
  let columnType = existing ? "INTEGER" : "absent", safeRange = false, draftReady = existing;
  let snapshot: { ledger: LedgerRow[]; columnType: string; safeRange: boolean; draftReady: boolean } | null = null;
  const calls: { owner: "pool" | "client"; text: string }[] = [];
  let releases = 0;
  async function query(owner: "pool" | "client", text: string, values: readonly unknown[] = []) {
    calls.push({ owner, text });
    const result = (rows: unknown[] = []) => ({ rows, rowCount: rows.length });
    if (text === "BEGIN") { assert.equal(snapshot, null); snapshot = { ledger: structuredClone(ledger), columnType, safeRange, draftReady }; return result(); }
    if (text === "ROLLBACK") {
      assert.ok(snapshot); ({ ledger, columnType, safeRange, draftReady } = snapshot); snapshot = null; return result();
    }
    if (text === "COMMIT") { assert.ok(snapshot); if (failure === "commit") throw new Error("injected commit failure"); snapshot = null; return result(); }
    if (text === POSTGRES_TASK_PACK_LIFECYCLE_DDL) { assert.ok(snapshot); columnType = "INTEGER"; return result(); }
    if (text === POSTGRES_TASK_PACK_DRAFTS_DDL) { assert.ok(snapshot); draftReady = true; return result(); }
    if (text === POSTGRES_TASK_PACK_LIFECYCLE_VERSION_RANGE_DDL) {
      assert.ok(snapshot); assert.equal(columnType, "INTEGER"); assert.equal(draftReady, true);
      columnType = "BIGINT"; if (failure === "ddl") throw new Error("injected range DDL failure"); safeRange = true; return result();
    }
    if (text.includes("INSERT INTO schema_migrations")) {
      assert.ok(snapshot); const version = Number(text.match(/VALUES \(\$1, (\d+)/)![1]);
      assert.equal(ledger.some(row => row.id === values[0]), false);
      ledger.push({ id: String(values[0]), version, name: String(values[1]), description: String(values[2]), checksum: String(values[3]), appliedAt: String(values[4]) });
      if (failure === "ledger") throw new Error("injected ledger failure"); return result();
    }
    if (text === "SELECT id FROM schema_migrations WHERE id = $1;") return result(ledger.filter(row => row.id === values[0]));
    if (text.includes('applied_at AS "appliedAt"')) return result(ledger);
    if (text.includes("AS task_pack_count")) return result([{ task_pack_count: "0", revision_count: "0" }]);
    if (text.includes("SELECT COUNT(*) AS count")) return result([{ count: "0" }]);
    if (text === POSTGRES_TASK_PACK_LIFECYCLE_CONSTRAINTS || text === POSTGRES_TASK_PACK_GITHUB_CREATED_ISSUE_LINK_DDL ||
      /SELECT (id,|task_pack_id, content_hash)/.test(text)) return result();
    if (owner === "pool" && /CREATE TABLE IF NOT EXISTS|ALTER TABLE|INSERT INTO app_settings/.test(text)) return result();
    throw new Error(`Unexpected fake query: ${text}`);
  }
  return { calls, get ledger() { return ledger; }, get columnType() { return columnType; },
    get safeRange() { return safeRange; }, get releases() { return releases; },
    poolQuery: (text: string, values?: readonly unknown[]) => query("pool", text, values),
    client: { query: async <T>(text: string, values?: readonly unknown[]) => {
      const result = await query("client", text, values); return { rows: result.rows as T[], rowCount: result.rowCount };
    }, release() { releases++; } },
  };
}
async function withPool(fake: ReturnType<typeof postgresFake>, run: (adapter: PostgresStorageAdapter) => Promise<void>) {
  const originalQuery = pool.query, originalConnect = pool.connect;
  try {
    pool.query = fake.poolQuery as typeof pool.query;
    pool.connect = (async () => fake.client) as unknown as typeof pool.connect;
    await run(new PostgresStorageAdapter());
  } finally { pool.query = originalQuery; pool.connect = originalConnect; }
}
scenario("PostgreSQL existing v5 ensureSchema runs only 0006 with one acquired/released client", async () => {
  const fake = postgresFake(); const oldLedger = structuredClone(fake.ledger);
  await withPool(fake, async adapter => { await adapter.ensureSchema(); });
  assert.equal(fake.columnType, "BIGINT"); assert.equal(fake.safeRange, true); assert.equal(fake.releases, 1);
  assert.deepEqual(fake.ledger.slice(0, 3), oldLedger);
  assert.deepEqual(fake.ledger.filter(row => row.id === id).map(row => [row.version, row.checksum]), [[6, "task-pack-lifecycle-version-range-v1"]]);
  const tx = fake.calls.filter(call => call.owner === "client").map(call => call.text);
  assert.equal(tx[0], "BEGIN"); assert.equal(tx[1], POSTGRES_TASK_PACK_LIFECYCLE_VERSION_RANGE_DDL);
  assert.match(tx[2], /INSERT INTO schema_migrations/); assert.equal(tx[3], "COMMIT"); assert.equal(tx.length, 4);
});
scenario("PostgreSQL rerun/getSchemaInfo is idempotent and reports version 6 ready", async () => {
  const fake = postgresFake(); await withPool(fake, async adapter => {
    await adapter.ensureSchema(); const ledger = structuredClone(fake.ledger);
    await adapter.ensureSchema(); const info = await adapter.getSchemaInfo();
    assert.deepEqual(fake.ledger, ledger); assert.equal(fake.releases, 1);
    assert.equal(info.currentVersion, 6); assert.equal(info.latestVersion, 6);
    assert.equal(info.status, "ready"); assert.equal(info.pendingCount, 0);
    assert.equal(info.appliedMigrations.filter(row => row.id === id).length, 1);
  });
});
scenario("fresh PostgreSQL ensureSchema executes historical 0003, 0004, 0005 then 0006", async () => {
  const fake = postgresFake(false); await withPool(fake, async adapter => {
    await adapter.ensureSchema(); const info = await adapter.getSchemaInfo(); assert.equal(info.currentVersion, 6);
  });
  assert.deepEqual(fake.ledger.map(row => row.id), [...previousIds, id]);
  assert.equal(fake.releases, 4); assert.equal(fake.columnType, "BIGINT");
  const ddls = fake.calls.map(call => call.text).filter(text => [POSTGRES_TASK_PACK_LIFECYCLE_DDL,
    POSTGRES_TASK_PACK_GITHUB_CREATED_ISSUE_LINK_DDL, POSTGRES_TASK_PACK_DRAFTS_DDL, POSTGRES_TASK_PACK_LIFECYCLE_VERSION_RANGE_DDL].includes(text));
  assert.deepEqual(ddls, [POSTGRES_TASK_PACK_LIFECYCLE_DDL, POSTGRES_TASK_PACK_GITHUB_CREATED_ISSUE_LINK_DDL,
    POSTGRES_TASK_PACK_DRAFTS_DDL, POSTGRES_TASK_PACK_LIFECYCLE_VERSION_RANGE_DDL]);
});
scenario("PostgreSQL schema reporting exposes v5 plus exactly pending migration 0006", async () => {
  const fake = postgresFake(); await withPool(fake, async adapter => {
    adapter.ensureSchema = async () => {}; // Inspect reporting before migrations apply.
    const info = await adapter.getSchemaInfo();
    assert.equal(info.currentVersion, 5); assert.equal(info.latestVersion, 6);
    assert.equal(info.status, "needs_migration"); assert.equal(info.pendingCount, 1);
    assert.deepEqual(info.pendingMigrations.map(row => [row.id, row.version]), [[id, 6]]);
  });
});
for (const failure of ["ddl", "ledger", "commit"] as const) scenario(`PostgreSQL ${failure} failure rolls back range/ledger and releases client`, async () => {
  const fake = postgresFake(true, failure), before = structuredClone(fake.ledger);
  await withPool(fake, async adapter => { await assert.rejects(adapter.ensureSchema(), /injected/); });
  assert.equal(fake.columnType, "INTEGER"); assert.equal(fake.safeRange, false);
  assert.deepEqual(fake.ledger, before); assert.equal(fake.releases, 1);
  assert.equal(fake.calls.at(-1)!.text, "ROLLBACK");
});
scenario("PostgreSQL rollback error preserves original migration failure", async () => {
  const failure = new Error("original DDL failure"); const calls: string[] = [];
  await assert.rejects(applyPostgresTaskPackLifecycleVersionRangeMigration({ query: async text => {
    calls.push(text); if (text === POSTGRES_TASK_PACK_LIFECYCLE_VERSION_RANGE_DDL) throw failure;
    if (text === "ROLLBACK") throw new Error("secondary rollback failure"); return { rows: [], rowCount: 0 };
  } }, stamp), error => error === failure);
  assert.equal(calls.at(-1), "ROLLBACK"); assert.equal(calls.includes("COMMIT"), false);
});

try {
  for (const item of scenarios) { await item.run(); console.log(`PASS ${item.name}`); }
  console.log(`Task Pack lifecycle version range smoke passed: ${scenarios.length} scenarios. PostgreSQL: DDL/mapper/fake-client parity; no live PostgreSQL.`);
} finally {
  for (const db of databases) db.close();
  if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error("Unsafe temporary cleanup path");
  fs.rmSync(root, { recursive: true, force: true });
}
