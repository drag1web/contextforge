import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Database } from "sql.js";
import { pool } from "../db/pool.js";
import type { TaskPackReviewState, TaskPackReviewTransitionEvent } from "../taskPacks/taskPackLifecycle.js";
import { SqliteStorageAdapter } from "./SqliteStorageAdapter.js";
import { PostgresStorageAdapter } from "./PostgresStorageAdapter.js";
import { taskPackRevisionHistorySql, mapTaskPackRevisionHistoryRows,
  validateTaskPackRevisionHistorySnapshot } from "./taskPackRevisionHistory.js";
import { TaskPackRevisionHistoryStorageError, type TaskPackRevisionHistorySnapshot } from "./types.js";

const scenarios: { name: string; run: () => void | Promise<void> }[] = [];
const scenario = (name: string, run: () => void | Promise<void>) => scenarios.push({ name, run });
const root = fs.mkdtempSync(path.join(os.tmpdir(), "contextforge-revision-history-"));
const databasePath = path.join(root, "history.sqlite");
const adapter = new SqliteStorageAdapter(databasePath);
let db: Database, projectId: number, serial = 0;
type Row = Record<string, unknown>;
type Ids = { taskPackId: number; revisionId: number };
const sql = taskPackRevisionHistorySql("?");
function rows(query: string, values: number[] = []): Row[] {
  const statement = db.prepare(query);
  try {
    statement.bind(values);
    const result: Row[] = [];
    while (statement.step()) result.push(statement.getAsObject());
    return result;
  } finally { statement.free(); }
}
function persisted() {
  return ["task_packs", "task_pack_revisions", "task_pack_revision_review_events", "task_pack_lifecycle_events"]
    .map(table => rows(`SELECT * FROM ${table} ORDER BY 1`));
}
async function fixture(): Promise<Ids> {
  const pack = await adapter.createTaskPack({ projectId, title: `History ${++serial}`, rawTask: "Private original task",
    taskType: "tests", targetTool: "generic", generatedPrompt: "Private document", generationMode: "template",
    generationModel: null, generationMessage: "Private generation message", generationUsedFallback: false,
    generationDurationMs: 12, generationRecipe: { private: "recipe" } });
  return { taskPackId: pack.id, revisionId: (await adapter.getCurrentTaskPackRevision(pack.id))!.id };
}
async function append(taskPackId: number): Promise<Ids> {
  const base = (await adapter.getCurrentTaskPackRevision(taskPackId))!;
  const { id, taskPackId: _pack, revisionNumber, baseRevisionId, contentHash, createdAt, generatedAt, ...content } = base;
  const next = await adapter.appendTaskPackRevision({ ...content, taskPackId, baseRevisionId: id,
    sourceKind: "manual_edit", rawTask: `Appended authored task ${++serial}`,
    createdAt: new Date(Date.UTC(2030, 0, 1) + serial * 1000).toISOString(), generatedAt: null });
  return { taskPackId, revisionId: next.id };
}
async function review(ids: Ids, type: TaskPackReviewTransitionEvent["type"], state: TaskPackReviewState) {
  const aggregate = (await adapter.getTaskPackAggregate(ids.taskPackId))!;
  return adapter.transitionTaskPackRevisionReview({ ...ids, expectedReviewState: state,
    expectedLifecycleVersion: aggregate.lifecycleVersion, transition: { type }, eventId: `history-event-${++serial}`,
    source: "user", actorId: "private actor", metadata: { private: "metadata" },
    createdAt: new Date(Date.UTC(2030, 0, 1) + serial * 1000).toISOString() });
}
const read = (taskPackId: number) => adapter.getTaskPackRevisionHistorySnapshot(taskPackId);
const states = (snapshot: TaskPackRevisionHistorySnapshot) => validateTaskPackRevisionHistorySnapshot(snapshot.aggregate.id, snapshot);
let fresh: Ids, multi: Ids, foreign: Ids;
scenario("missing aggregate is null, not corrupt/empty history", async () => {
  assert.equal(await read(987654), null);
});
scenario("one generated Revision 1 has null base and zero-event unreviewed state", async () => {
  fresh = await fixture();
  const snapshot = (await read(fresh.taskPackId))!;
  assert.equal(snapshot.aggregate.currentRevisionId, fresh.revisionId);
  assert.equal(snapshot.revisions.length, 1);
  assert.equal(snapshot.revisions[0].revision.revisionNumber, 1);
  assert.equal(snapshot.revisions[0].revision.baseRevisionId, null);
  assert.deepEqual(snapshot.revisions[0].reviewEvents, []);
  assert.deepEqual(states(snapshot), ["unreviewed"]);
});
scenario("global revision ID differs from revisionNumber, without inferred ordinals", async () => {
  multi = await fixture(); foreign = await fixture();
  assert.notEqual(multi.revisionId, 1);
  assert.equal((await read(multi.taskPackId))!.revisions[0].revision.revisionNumber, 1);
});
scenario("start_review replays historical chain to in_review", async () => {
  await review(multi, "start_review", "unreviewed");
  assert.deepEqual(states((await read(multi.taskPackId))!), ["in_review"]);
});
scenario("accepted chain includes the start event, not merely its tail", async () => {
  await review(multi, "accept", "in_review");
  const snapshot = (await read(multi.taskPackId))!;
  assert.deepEqual(snapshot.revisions[0].reviewEvents.map(e => e.eventType), ["review_started", "accepted"]);
  assert.deepEqual(states(snapshot), ["accepted"]);
  assert.equal(snapshot.aggregate.acceptedRevisionId, multi.revisionId);
});
scenario("multiple appended revisions are revisionNumber ordered with exact ancestry/current ownership", async () => {
  const next = await append(multi.taskPackId);
  const last = await append(multi.taskPackId);
  const snapshot = (await read(multi.taskPackId))!;
  assert.deepEqual(snapshot.revisions.map(i => i.revision.revisionNumber), [1, 2, 3]);
  assert.deepEqual(snapshot.revisions.map(i => i.revision.id), [multi.revisionId, next.revisionId, last.revisionId]);
  assert.deepEqual(snapshot.revisions.map(i => i.revision.baseRevisionId), [null, multi.revisionId, next.revisionId]);
  assert.equal(snapshot.aggregate.currentRevisionId, last.revisionId);
  assert.deepEqual(states(snapshot), ["accepted", "unreviewed", "unreviewed"]);
});
scenario("multiple historical accepted revisions are independent of the aggregate accepted pointer", async () => {
  const snapshot = (await read(multi.taskPackId))!;
  await review({ taskPackId: multi.taskPackId, revisionId: snapshot.revisions[1].revision.id }, "accept", "unreviewed");
  const result = (await read(multi.taskPackId))!;
  assert.deepEqual(states(result), ["accepted", "accepted", "unreviewed"]);
  assert.equal(result.aggregate.acceptedRevisionId, result.revisions[1].revision.id);
});
scenario("changes_requested is replayed per revision, not inferred from current/accepted pointers", async () => {
  const last = (await read(multi.taskPackId))!.aggregate.currentRevisionId;
  await review({ taskPackId: multi.taskPackId, revisionId: last }, "start_review", "unreviewed");
  await review({ taskPackId: multi.taskPackId, revisionId: last }, "request_changes", "in_review");
  assert.deepEqual(states((await read(multi.taskPackId))!), ["accepted", "accepted", "changes_requested"]);
});
scenario("same-timestamp review events retain database id ASC order", async () => {
  const ids = await fixture();
  const common = { ...ids, createdAt: "2030-02-01T00:00:00.000Z", source: "migration" as const, actorId: null, metadata: null };
  await adapter.appendTaskPackRevisionReviewEvent({ ...common, id: "tie-z", eventType: "accepted", fromState: "in_review", toState: "accepted" });
  await adapter.appendTaskPackRevisionReviewEvent({ ...common, id: "tie-a", eventType: "review_started", fromState: "unreviewed", toState: "in_review" });
  const snapshot = (await read(ids.taskPackId))!;
  assert.deepEqual(snapshot.revisions[0].reviewEvents.map(e => e.id), ["tie-a", "tie-z"]);
  assert.deepEqual(states(snapshot), ["accepted"]);
});
async function corrupt(query: string, taskPackId = multi.taskPackId) {
  const before = persisted(), file = fs.readFileSync(databasePath);
  db.run("PRAGMA foreign_keys = OFF; PRAGMA ignore_check_constraints = ON; SAVEPOINT history_corruption;");
  try {
    db.run("DROP TRIGGER task_packs_revision_pointer_ownership_update; DROP TRIGGER task_packs_lifecycle_projection_update; DROP TRIGGER task_pack_revisions_immutable; DROP TRIGGER task_pack_revision_review_events_immutable;");
    db.run(query);
    const broken = persisted();
    await assert.rejects(() => read(taskPackId), TaskPackRevisionHistoryStorageError);
    assert.deepEqual(persisted(), broken, "read must never repair a corrupt history");
    assert.deepEqual(fs.readFileSync(databasePath), file, "read must not persist sql.js");
  } finally {
    db.run("ROLLBACK TO history_corruption; RELEASE history_corruption; PRAGMA ignore_check_constraints = OFF; PRAGMA foreign_keys = ON;");
  }
  assert.deepEqual(persisted(), before); assert.equal(rows("PRAGMA foreign_keys")[0].foreign_keys, 1);
}
scenario("broken historical (non-current) hash fails the whole snapshot", async () => {
  await corrupt(`UPDATE task_pack_revisions SET raw_task = 'Corrupted private content' WHERE id = ${multi.revisionId}`);
});
scenario("malformed historical JSON fails with a safe history error", async () => {
  await corrupt(`UPDATE task_pack_revisions SET generation_recipe = 'not JSON' WHERE id = ${multi.revisionId}`);
});
scenario("missing base revision fails even when current row exists", async () => {
  await corrupt(`UPDATE task_pack_revisions SET base_revision_id = 987654 WHERE task_pack_id = ${multi.taskPackId} AND revision_number = 2`);
});
scenario("foreign base revision ownership fails", async () => {
  await corrupt(`UPDATE task_pack_revisions SET base_revision_id = ${foreign.revisionId} WHERE task_pack_id = ${multi.taskPackId} AND revision_number = 2`);
});
scenario("forward ancestry fails authoritative domain validation", async () => {
  const current = (await read(multi.taskPackId))!.aggregate.currentRevisionId;
  await corrupt(`UPDATE task_pack_revisions SET base_revision_id = ${current} WHERE task_pack_id = ${multi.taskPackId} AND revision_number = 2`);
});
scenario("self ancestry fails", async () => {
  await corrupt(`UPDATE task_pack_revisions SET base_revision_id = id WHERE task_pack_id = ${multi.taskPackId} AND revision_number = 2`);
});
scenario("Revision 1 cannot acquire a base", async () => {
  await corrupt(`UPDATE task_pack_revisions SET base_revision_id = ${foreign.revisionId} WHERE id = ${multi.revisionId}`);
});
scenario("later revision cannot lose its base", async () => {
  await corrupt(`UPDATE task_pack_revisions SET base_revision_id = NULL WHERE task_pack_id = ${multi.taskPackId} AND revision_number = 2`);
});
scenario("missing current pointer fails, not not-found", async () => {
  await corrupt(`UPDATE task_packs SET current_revision_id = NULL WHERE id = ${multi.taskPackId}`);
});
scenario("missing current revision fails", async () => {
  await corrupt(`DELETE FROM task_pack_revisions WHERE task_pack_id = ${multi.taskPackId} AND revision_number = 3`);
});
scenario("foreign current revision fails", async () => {
  await corrupt(`UPDATE task_packs SET current_revision_id = ${foreign.revisionId} WHERE id = ${multi.taskPackId}`);
});
scenario("invalid accepted pointer fails", async () => {
  await corrupt(`UPDATE task_packs SET accepted_revision_id = 987654 WHERE id = ${multi.taskPackId}`);
});
scenario("foreign accepted pointer fails", async () => {
  await corrupt(`UPDATE task_packs SET accepted_revision_id = ${foreign.revisionId} WHERE id = ${multi.taskPackId}`);
});
scenario("malformed aggregate lifecycle fails without normalizing away corruption", async () => {
  await corrupt(`UPDATE task_packs SET archived_from_state = 'active' WHERE id = ${multi.taskPackId}`);
});
scenario("missing Revision 1 fails even if other pointers remain valid", async () => {
  await corrupt(`DELETE FROM task_pack_revisions WHERE id = ${multi.revisionId}`);
});
scenario("historical invalid review prefix fails even when tail looks accepted", async () => {
  await corrupt(`UPDATE task_pack_revision_review_events SET from_state = 'in_review' WHERE revision_id = ${multi.revisionId} AND event_type = 'review_started'`);
});
scenario("invalid review toState is rejected, never trusted as the historical result", async () => {
  await corrupt(`UPDATE task_pack_revision_review_events SET to_state = 'changes_requested' WHERE revision_id = ${multi.revisionId} AND event_type = 'accepted'`);
});
scenario("malformed review metadata fails instead of being discarded by the public projection", async () => {
  await corrupt(`UPDATE task_pack_revision_review_events SET metadata = 'not JSON' WHERE revision_id = ${multi.revisionId}`);
});
scenario("review event with foreign Task Pack owner is not filtered out", async () => {
  await corrupt(`UPDATE task_pack_revision_review_events SET task_pack_id = ${foreign.taskPackId} WHERE revision_id = ${multi.revisionId}`);
});
scenario("orphan review event with a missing revision is not silently omitted", async () => {
  await corrupt(`UPDATE task_pack_revision_review_events SET revision_id = 987654 WHERE revision_id = ${multi.revisionId}`);
});
scenario("review event owned by this pack but referencing a foreign revision is not omitted", async () => {
  await corrupt(`UPDATE task_pack_revision_review_events SET revision_id = ${foreign.revisionId} WHERE revision_id = ${multi.revisionId}`);
});
scenario("zero persisted revisions is corruption, not an empty successful history", async () => {
  await corrupt(`DELETE FROM task_pack_revisions WHERE task_pack_id = ${fresh.taskPackId}`, fresh.taskPackId);
});
scenario("read is one SQLite SELECT at small and large revision counts, with no writes/persist", async () => {
  async function measured(taskPackId: number) {
    const prepare = db.prepare, run = db.run;
    const queries: string[] = [], before = persisted(), file = fs.readFileSync(databasePath);
    db.prepare = ((query, ...args) => { queries.push(String(query)); return prepare.call(db, query, ...args); }) as typeof db.prepare;
    db.run = (() => { throw new Error("history read must not execute writes or transaction commands"); }) as typeof db.run;
    let snapshot: TaskPackRevisionHistorySnapshot;
    try { snapshot = (await read(taskPackId))!; }
    finally { db.prepare = prepare; db.run = run; }
    assert.deepEqual(queries, [sql]); assert.deepEqual(persisted(), before);
    assert.deepEqual(fs.readFileSync(databasePath), file);
    console.log(`QUERY COUNT SQLite: ${snapshot.revisions.length} revisions -> ${queries.length} statement`);
  }
  await measured(fresh.taskPackId);
  for (let n = 0; n < 30; n++) await append(fresh.taskPackId);
  await measured(fresh.taskPackId);
});
scenario("SQLite snapshot remains coherent when append/review commits after SELECT but before mapping", async () => {
  const ids = await fixture(), old = (await read(ids.taskPackId))!;
  const internal = adapter as unknown as { getAll: (query: string, params: number[]) => Promise<Row[]> };
  const getAll = internal.getAll;
  let writes = false;
  internal.getAll = async function(query, params) {
    const result = await getAll.call(adapter, query, params);
    if (query === sql && !writes) {
      writes = true;
      await review(ids, "accept", "unreviewed"); await append(ids.taskPackId);
    }
    return result;
  };
  try { assert.deepEqual(await read(ids.taskPackId), old); assert.equal(writes, true); }
  finally { internal.getAll = getAll; }
  const after = (await read(ids.taskPackId))!;
  assert.equal(after.revisions.length, 2); assert.deepEqual(states(after), ["accepted", "unreviewed"]);
  assert.notEqual(after.aggregate.currentRevisionId, old.aggregate.currentRevisionId);
});
function pgRows(taskPackId: number): Row[] {
  return rows(sql, [taskPackId]).map(row => ({ ...row,
    aggregate_lifecycle_version: String(row.aggregate_lifecycle_version),
    aggregate_created_at: new Date(row.aggregate_created_at as string), aggregate_updated_at: new Date(row.aggregate_updated_at as string),
    created_at: new Date(row.created_at as string), generated_at: row.generated_at === null ? null : new Date(row.generated_at as string),
    review_created_at: row.review_created_at === null ? null : new Date(row.review_created_at as string),
  }));
}
async function withPg(taskPackId: number, data: Row[] | Error, check: (pg: PostgresStorageAdapter) => Promise<void>) {
  const query = pool.query, connect = pool.connect;
  let calls = 0;
  pool.query = (async (querySql: string, values: unknown[]) => {
    calls++; assert.equal(querySql, taskPackRevisionHistorySql("$1")); assert.deepEqual(values, [taskPackId]);
    if (data instanceof Error) throw data;
    return { rows: data, rowCount: data.length };
  }) as typeof pool.query;
  pool.connect = (() => { throw new Error("one MVCC statement needs no read transaction client"); }) as typeof pool.connect;
  try { await check(new PostgresStorageAdapter()); assert.equal(calls, 1); }
  finally { pool.query = query; pool.connect = connect; }
}
scenario("PostgreSQL missing aggregate is one statement returning null", async () => {
  await withPg(987654, [], async pg => assert.equal(await pg.getTaskPackRevisionHistorySnapshot(987654), null));
});
scenario("PostgreSQL fake pool matches SQLite complete ordered history and review chains", async () => {
  const expected = await read(multi.taskPackId);
  await withPg(multi.taskPackId, pgRows(multi.taskPackId), async pg =>
    assert.deepEqual(await pg.getTaskPackRevisionHistorySnapshot(multi.taskPackId), expected));
});
scenario("PostgreSQL fake statement returns one coherent payload despite append/review before response delivery", async () => {
  const ids = await fixture(), expected = (await read(ids.taskPackId))!, data = pgRows(ids.taskPackId);
  const query = pool.query, connect = pool.connect;
  let calls = 0;
  pool.query = (async (querySql: string, values: unknown[]) => {
    calls++; assert.equal(querySql, taskPackRevisionHistorySql("$1")); assert.deepEqual(values, [ids.taskPackId]);
    // Emulate delivering an already captured MVCC statement result after a writer
    // committed. This tests adapter wiring, not a claim of live PG concurrency QA.
    await review(ids, "accept", "unreviewed"); await append(ids.taskPackId);
    return { rows: data, rowCount: data.length };
  }) as typeof pool.query;
  pool.connect = (() => { throw new Error("one statement must not acquire a second read snapshot"); }) as typeof pool.connect;
  try {
    assert.deepEqual(await new PostgresStorageAdapter().getTaskPackRevisionHistorySnapshot(ids.taskPackId), expected);
    assert.equal(calls, 1);
  } finally { pool.query = query; pool.connect = connect; }
  assert.equal((await read(ids.taskPackId))!.revisions.length, 2);
});
scenario("PostgreSQL query count stays one at 1 and 31 revisions", async () => {
  for (const ids of [foreign, fresh]) {
    await withPg(ids.taskPackId, pgRows(ids.taskPackId), async pg => {
      const snapshot = (await pg.getTaskPackRevisionHistorySnapshot(ids.taskPackId))!;
      console.log(`QUERY COUNT PostgreSQL fake pool: ${snapshot.revisions.length} revisions -> 1 statement`);
    });
  }
});
for (const value of ["2147483648", "9007199254740991"]) scenario(`PostgreSQL BIGINT lifecycle ${value} retains safe mapper semantics`, async () => {
  const data = pgRows(multi.taskPackId).map(row => ({ ...row, aggregate_lifecycle_version: value }));
  await withPg(multi.taskPackId, data, async pg =>
    assert.equal((await pg.getTaskPackRevisionHistorySnapshot(multi.taskPackId))!.aggregate.lifecycleVersion, Number(value)));
});
scenario("PostgreSQL unsafe lifecycle BIGINT is corruption", async () => {
  const data = pgRows(multi.taskPackId).map(row => ({ ...row, aggregate_lifecycle_version: "9007199254740992" }));
  await withPg(multi.taskPackId, data, async pg => {
    await assert.rejects(() => pg.getTaskPackRevisionHistorySnapshot(multi.taskPackId), TaskPackRevisionHistoryStorageError);
  });
});
scenario("PostgreSQL duplicate review rows fail the complete snapshot", async () => {
  const data = pgRows(multi.taskPackId);
  await withPg(multi.taskPackId, [data[0], ...data], async pg => {
    await assert.rejects(() => pg.getTaskPackRevisionHistorySnapshot(multi.taskPackId), TaskPackRevisionHistoryStorageError);
  });
});
scenario("foreign revision row ownership fails shared mapping", () => {
  const data = rows(sql, [fresh.taskPackId]).map(row => ({ ...row, task_pack_id: foreign.taskPackId }));
  assert.throws(() => mapTaskPackRevisionHistoryRows(fresh.taskPackId, data), TaskPackRevisionHistoryStorageError);
});
scenario("requested aggregate identity is validated, not taken from arbitrary rows", () => {
  assert.throws(() => mapTaskPackRevisionHistoryRows(foreign.taskPackId, rows(sql, [multi.taskPackId])), TaskPackRevisionHistoryStorageError);
});
scenario("duplicate zero-event revision rows cannot be silently collapsed", () => {
  const data = rows(sql, [foreign.taskPackId]);
  assert.throws(() => mapTaskPackRevisionHistoryRows(foreign.taskPackId, [...data, ...data]), TaskPackRevisionHistoryStorageError);
});
scenario("out-of-order revision rows fail instead of hiding malformed ordering", () => {
  const data = rows(sql, [fresh.taskPackId]).reverse();
  assert.throws(() => mapTaskPackRevisionHistoryRows(fresh.taskPackId, data), TaskPackRevisionHistoryStorageError);
});
scenario("duplicate revision numbers are rejected in the shared snapshot validator", async () => {
  const snapshot = structuredClone((await read(multi.taskPackId))!);
  // Both rows remain individually domain-valid; uniqueness/order is a history invariant.
  (snapshot.revisions[2].revision as { revisionNumber: number }).revisionNumber = 2;
  assert.throws(() => validateTaskPackRevisionHistorySnapshot(multi.taskPackId, snapshot), TaskPackRevisionHistoryStorageError);
});
scenario("PostgreSQL unexpected driver error propagates unchanged, without retry/corruption relabeling", async () => {
  const error = new Error("private SQL driver details");
  await withPg(multi.taskPackId, error, async pg => {
    await assert.rejects(() => pg.getTaskPackRevisionHistorySnapshot(multi.taskPackId), e => e === error);
  });
});
scenario("SQLite unexpected prepare error propagates unchanged without retry", async () => {
  const prepare = db.prepare, error = new Error("private SQLite driver details"); let calls = 0;
  db.prepare = (() => { calls++; throw error; }) as typeof db.prepare;
  try { await assert.rejects(() => read(multi.taskPackId), e => e === error); assert.equal(calls, 1); }
  finally { db.prepare = prepare; }
});
scenario("shared SQL is scoped, deterministic and read-only; adapters contain no per-revision query loop", () => {
  assert.match(sql, /WHERE tp.id = \?/); assert.match(sql, /ORDER BY r.revision_number ASC, r.id ASC, e.created_at ASC, e.id ASC/);
  assert.match(sql, /e.revision_id = r.id/); assert.match(sql, /e.task_pack_id = tp.id AND NOT EXISTS/);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|BEGIN|COMMIT|LIMIT|FOR UPDATE)\b/);
  for (const file of ["SqliteStorageAdapter", "PostgresStorageAdapter"]) {
    const source = fs.readFileSync(new URL(`./${file}.ts`, import.meta.url), "utf8");
    const start = source.indexOf("  async getTaskPackRevisionHistorySnapshot(");
    const method = source.slice(start, source.indexOf("  async appendTaskPackRevision(", start));
    assert.equal((method.match(/(?:this.getAll|pool.query)/g) ?? []).length, 1);
    assert.doesNotMatch(method, /for\s*\(|Promise.all|\.map\(|getTaskPackAggregate|listTaskPackRevisions|listTaskPackRevisionReviewEvents|persist\(/);
  }
});

try {
  await adapter.ensureSchema(); db = (adapter as unknown as { db: Database }).db;
  projectId = (await adapter.upsertScannedProject({ name: "Revision history", localPath: root, packageManager: "npm",
    detectedStack: [], scripts: {}, readinessScore: 100, readinessReport: { score: 100, checks: [], issues: [] } })).id;
  for (const { name, run } of scenarios) { await run(); console.log(`PASS ${name}`); }
  console.log(`Task Pack revision history storage smoke: ${scenarios.length}/${scenarios.length} passed (real SQLite; PostgreSQL fake pool/source, no live PostgreSQL).`);
} finally {
  (adapter as unknown as { db: Database | null }).db?.close();
  fs.rmSync(root, { recursive: true, force: true });
}
