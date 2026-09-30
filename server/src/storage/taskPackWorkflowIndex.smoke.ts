import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Database } from "sql.js";
import { pool } from "../db/pool.js";
import { SqliteStorageAdapter } from "./SqliteStorageAdapter.js";
import { PostgresStorageAdapter } from "./PostgresStorageAdapter.js";
import { TASK_PACK_CURRENT_WORKFLOW_SQL, mapTaskPackCurrentWorkflowRows } from "./taskPackWorkflowIndex.js";
import { deriveTaskPackRevisionReviewState } from "./taskPackLifecyclePersistence.js";
import { TaskPackCurrentStateStorageError, type TaskPackCurrentWorkflowSnapshot } from "./types.js";
import type { TaskPackReviewState, TaskPackReviewTransitionEvent } from "../taskPacks/taskPackLifecycle.js";

const scenarios: { name: string; run: () => void | Promise<void> }[] = [];
const scenario = (name: string, run: () => void | Promise<void>) => scenarios.push({ name, run });
const root = fs.mkdtempSync(path.join(os.tmpdir(), "contextforge-workflow-index-"));
const databasePath = path.join(root, "index.sqlite");
const adapter = new SqliteStorageAdapter(databasePath);
let db: Database, projectId: number, serial = 0;
type Row = Record<string, unknown>;
type Ids = { taskPackId: number; revisionId: number };
const stateOf = ({ aggregate, revision, reviewEvents }: TaskPackCurrentWorkflowSnapshot) =>
  deriveTaskPackRevisionReviewState(aggregate, revision, reviewEvents);
function rows(sql: string): Row[] {
  const statement = db.prepare(sql);
  try {
    const result: Row[] = [];
    while (statement.step()) result.push(statement.getAsObject());
    return result;
  } finally { statement.free(); }
}
function snapshot() {
  return ["task_packs", "task_pack_revisions", "task_pack_revision_review_events", "task_pack_lifecycle_events"]
    .map(table => rows(`SELECT * FROM ${table} ORDER BY 1`));
}
async function fixture(): Promise<Ids> {
  const pack = await adapter.createTaskPack({ projectId, title: `Index fixture ${++serial}`, rawTask: "Private raw task",
    taskType: "tests", targetTool: "generic", generatedPrompt: "Private generated prompt", generationMode: "template",
    generationModel: null, generationMessage: null, generationUsedFallback: false, generationDurationMs: null,
    generationRecipe: { private: "recipe" } });
  return { taskPackId: pack.id, revisionId: (await adapter.getCurrentTaskPackRevision(pack.id))!.id };
}
async function review(ids: Ids, type: TaskPackReviewTransitionEvent["type"], expectedReviewState: TaskPackReviewState) {
  const aggregate = (await adapter.getTaskPackAggregate(ids.taskPackId))!;
  return adapter.transitionTaskPackRevisionReview({ ...ids, expectedReviewState, transition: { type },
    expectedLifecycleVersion: aggregate.lifecycleVersion, eventId: `review-${++serial}`,
    source: "user", actorId: null, metadata: null, createdAt: new Date(Date.UTC(2030, 0, 1) + serial * 1000).toISOString() });
}
async function lifecycle(ids: Ids, type: "complete" | "archive") {
  const aggregate = (await adapter.getTaskPackAggregate(ids.taskPackId))!;
  return adapter.transitionTaskPackAggregateLifecycle({ taskPackId: ids.taskPackId, expectedLifecycleVersion: aggregate.lifecycleVersion,
    transition: { type }, eventId: `life-${++serial}`, source: "user", actorId: null, metadata: null,
    createdAt: new Date(Date.UTC(2030, 0, 1) + serial * 1000).toISOString() });
}
const find = async (ids: Ids) => (await adapter.listTaskPackCurrentWorkflowSnapshots()).find(s => s.aggregate.id === ids.taskPackId)!;
let fresh: Ids, accepted: Ids;
scenario("empty SQLite database returns an empty index", async () => {
  assert.deepEqual(await adapter.listTaskPackCurrentWorkflowSnapshots(), []);
});
scenario("new Task Pack is included with zero events and active/unreviewed state", async () => {
  fresh = await fixture();
  const item = await find(fresh);
  assert.equal(item.aggregate.lifecycle.state, "active"); assert.equal(stateOf(item), "unreviewed");
  assert.deepEqual(item.reviewEvents, []);
  assert.equal(item.revision.id, fresh.revisionId); assert.equal(item.revision.taskPackId, fresh.taskPackId);
});
scenario("current start-review chain derives in_review", async () => {
  const ids = await fixture(); await review(ids, "start_review", "unreviewed");
  assert.equal(stateOf(await find(ids)), "in_review");
});
scenario("current accepted chain includes every event, not only the tail", async () => {
  accepted = await fixture(); await review(accepted, "start_review", "unreviewed"); await review(accepted, "accept", "in_review");
  const item = await find(accepted);
  assert.deepEqual(item.reviewEvents.map(e => e.eventType), ["review_started", "accepted"]);
  assert.equal(stateOf(item), "accepted");
});
scenario("current changes-requested chain derives changes_requested", async () => {
  const ids = await fixture(); await review(ids, "start_review", "unreviewed"); await review(ids, "request_changes", "in_review");
  assert.equal(stateOf(await find(ids)), "changes_requested");
});
scenario("completed aggregate remains completed in the index", async () => {
  const ids = await fixture(); await review(ids, "accept", "unreviewed"); await lifecycle(ids, "complete");
  assert.equal((await find(ids)).aggregate.lifecycle.state, "completed");
});
for (const from of ["active", "completed"] as const) scenario(`archived-from-${from} preserves lifecycle origin`, async () => {
  const ids = await fixture();
  if (from === "completed") { await review(ids, "accept", "unreviewed"); await lifecycle(ids, "complete"); }
  await lifecycle(ids, "archive");
  assert.deepEqual((await find(ids)).aggregate.lifecycle, { state: "archived", archivedFromState: from });
});
scenario("historical accepted events never leak into the new unreviewed current revision", async () => {
  const ids = await fixture(); await review(ids, "accept", "unreviewed");
  const base = (await adapter.getTaskPackRevisionById(ids.taskPackId, ids.revisionId))!;
  const { id, taskPackId, revisionNumber, baseRevisionId, contentHash, createdAt, generatedAt, ...content } = base;
  const next = await adapter.appendTaskPackRevision({ ...content, taskPackId, baseRevisionId: id,
    sourceKind: "manual_edit", rawTask: "Next immutable revision", createdAt: "2031-01-01T00:00:00.000Z", generatedAt: null });
  const item = await find(ids);
  assert.equal(item.revision.id, next.id); assert.equal(item.aggregate.acceptedRevisionId, ids.revisionId);
  assert.deepEqual(item.reviewEvents, []); assert.equal(stateOf(item), "unreviewed");
  assert.equal((await adapter.listTaskPackRevisionReviewEvents(ids.taskPackId, ids.revisionId)).length, 1);
});
scenario("every Task Pack appears exactly once in deterministic createdAt DESC, id ASC order", async () => {
  const actual = await adapter.listTaskPackCurrentWorkflowSnapshots();
  assert.deepEqual(actual.map(s => s.aggregate.id), rows("SELECT id FROM task_packs ORDER BY created_at DESC, id ASC").map(r => r.id));
  assert.equal(new Set(actual.map(s => s.aggregate.id)).size, actual.length);
});
scenario("equal-timestamp events use database id ASC order without JS reordering", async () => {
  const ids = await fixture();
  const common = { ...ids, createdAt: "2030-01-01T00:00:00.000Z", source: "migration" as const, actorId: null, metadata: null };
  // Insert in reverse order intentionally; the query, not insertion order, controls replay.
  await adapter.appendTaskPackRevisionReviewEvent({ ...common, id: "tie-z", eventType: "changes_requested", fromState: "in_review", toState: "changes_requested" });
  await adapter.appendTaskPackRevisionReviewEvent({ ...common, id: "tie-a", eventType: "review_started", fromState: "unreviewed", toState: "in_review" });
  const item = await find(ids);
  assert.deepEqual(item.reviewEvents.map(e => e.id), ["tie-a", "tie-z"]); assert.equal(stateOf(item), "changes_requested");
});
async function corrupt(sql: string) {
  const before = snapshot(), file = fs.readFileSync(databasePath);
  db.run("PRAGMA foreign_keys = OFF; PRAGMA ignore_check_constraints = ON; SAVEPOINT index_corruption;");
  try {
    // Temporary fixture corruption only, restored along with trigger definitions by SAVEPOINT.
    db.run("DROP TRIGGER task_packs_revision_pointer_ownership_update; DROP TRIGGER task_packs_lifecycle_projection_update; DROP TRIGGER task_pack_revisions_immutable; DROP TRIGGER task_pack_revision_review_events_immutable;");
    db.run(sql);
    const corrupted = snapshot();
    await assert.rejects(() => adapter.listTaskPackCurrentWorkflowSnapshots(), TaskPackCurrentStateStorageError);
    assert.deepEqual(snapshot(), corrupted, "read must not repair persistence");
    assert.deepEqual(fs.readFileSync(databasePath), file, "read must not persist sql.js");
  } finally {
    db.run("ROLLBACK TO index_corruption; RELEASE index_corruption; PRAGMA ignore_check_constraints = OFF; PRAGMA foreign_keys = ON;");
  }
  assert.deepEqual(snapshot(), before); assert.equal(rows("PRAGMA foreign_keys")[0].foreign_keys, 1);
}
scenario("missing current pointer fails closed instead of dropping a Task Pack", async () => {
  await corrupt(`UPDATE task_packs SET current_revision_id = NULL WHERE id = ${fresh.taskPackId}`);
});
scenario("missing current revision row fails closed", async () => {
  await corrupt(`DELETE FROM task_pack_revisions WHERE id = ${fresh.revisionId}`);
});
scenario("foreign current revision fails closed", async () => {
  await corrupt(`UPDATE task_packs SET current_revision_id = ${accepted.revisionId} WHERE id = ${fresh.taskPackId}`);
});
scenario("malformed aggregate lifecycle projection fails closed", async () => {
  await corrupt(`UPDATE task_packs SET archived_from_state = 'completed' WHERE id = ${fresh.taskPackId}`);
});
scenario("unsafe aggregate lifecycle version fails closed", async () => {
  await corrupt(`UPDATE task_packs SET lifecycle_version = 9007199254740992 WHERE id = ${fresh.taskPackId}`);
});
scenario("invalid current revision content hash fails closed", async () => {
  await corrupt(`UPDATE task_pack_revisions SET raw_task = 'Tampered content' WHERE id = ${fresh.revisionId}`);
});
scenario("malformed revision JSON maps to safe current-state error", async () => {
  await corrupt(`UPDATE task_pack_revisions SET generation_recipe = 'not JSON' WHERE id = ${fresh.revisionId}`);
});
scenario("invalid prefix of an otherwise valid-looking review tail fails the whole index", async () => {
  await corrupt(`UPDATE task_pack_revision_review_events SET from_state = 'in_review' WHERE revision_id = ${accepted.revisionId} AND event_type = 'review_started'`);
});
scenario("foreign taskPackId on a current review event is not silently filtered out", async () => {
  await corrupt(`UPDATE task_pack_revision_review_events SET task_pack_id = ${fresh.taskPackId} WHERE revision_id = ${accepted.revisionId}`);
});
scenario("one SQLite statement at small and large collection sizes; no mutation or sql.js persist", async () => {
  async function measuredRead() {
    const prepare = db.prepare, run = db.run;
    const queries: string[] = [];
    const before = snapshot(), file = fs.readFileSync(databasePath);
    db.prepare = ((sql, ...args) => { queries.push(String(sql)); return prepare.call(db, sql, ...args); }) as typeof db.prepare;
    db.run = (() => { throw new Error("bulk workflow read must not run a write or transaction"); }) as typeof db.run;
    try { await adapter.listTaskPackCurrentWorkflowSnapshots(); }
    finally { db.prepare = prepare; db.run = run; }
    assert.deepEqual(queries, [TASK_PACK_CURRENT_WORKFLOW_SQL]);
    assert.deepEqual(snapshot(), before); assert.deepEqual(fs.readFileSync(databasePath), file);
    console.log(`QUERY COUNT SQLite: ${before[0].length} Task Packs -> ${queries.length} SELECT`);
  }
  await measuredRead();
  for (let n = 0; n < 30; n++) await fixture();
  await measuredRead();
});
async function withPg(data: Row[] | Error, check: (pg: PostgresStorageAdapter) => Promise<void>) {
  const query = pool.query, connect = pool.connect;
  let calls = 0;
  pool.query = (async (sql: string) => {
    calls++; assert.equal(sql, TASK_PACK_CURRENT_WORKFLOW_SQL);
    if (data instanceof Error) throw data;
    return { rows: data, rowCount: data.length };
  }) as typeof pool.query;
  pool.connect = (() => { throw new Error("single statement needs no transaction client"); }) as typeof pool.connect;
  try { await check(new PostgresStorageAdapter()); assert.equal(calls, 1); }
  finally { pool.query = query; pool.connect = connect; }
}
function pgRows(): Row[] {
  return rows(TASK_PACK_CURRENT_WORKFLOW_SQL).map(row => ({ ...row,
    aggregate_lifecycle_version: String(row.aggregate_lifecycle_version),
    aggregate_created_at: new Date(row.aggregate_created_at as string), aggregate_updated_at: new Date(row.aggregate_updated_at as string),
    created_at: new Date(row.created_at as string), generated_at: row.generated_at === null ? null : new Date(row.generated_at as string),
    review_created_at: row.review_created_at === null ? null : new Date(row.review_created_at as string),
  }));
}
scenario("PostgreSQL fake pool empty index is one statement with no unnecessary locks", async () => {
  await withPg([], async pg => assert.deepEqual(await pg.listTaskPackCurrentWorkflowSnapshots(), []));
});
scenario("PostgreSQL fake pool full index matches SQLite with one statement", async () => {
  const expected = await adapter.listTaskPackCurrentWorkflowSnapshots();
  await withPg(pgRows(), async pg => assert.deepEqual(await pg.listTaskPackCurrentWorkflowSnapshots(), expected));
  console.log(`QUERY COUNT PostgreSQL fake pool: ${expected.length} Task Packs -> 1 SELECT (also 1 when empty)`);
});
for (const value of ["2147483648", "9007199254740991"]) scenario(`PostgreSQL BIGINT ${value} inherits safe numeric mapping`, async () => {
  const data = pgRows().filter(row => row.aggregate_id === fresh.taskPackId).map(row => ({ ...row, aggregate_lifecycle_version: value }));
  await withPg(data, async pg => assert.equal((await pg.listTaskPackCurrentWorkflowSnapshots())[0].aggregate.lifecycleVersion, Number(value)));
});
scenario("PostgreSQL unsafe BIGINT fails closed", async () => {
  const data = pgRows().map(row => ({ ...row, aggregate_lifecycle_version: "9007199254740992" }));
  await withPg(data, async pg => { await assert.rejects(() => pg.listTaskPackCurrentWorkflowSnapshots(), TaskPackCurrentStateStorageError); });
});
scenario("duplicate review event from malformed persistence rows fails complete replay", () => {
  const data = pgRows().filter(row => row.aggregate_id === accepted.taskPackId);
  assert.throws(() => mapTaskPackCurrentWorkflowRows([data[0], data[0], data[1]]), TaskPackCurrentStateStorageError);
});
scenario("PostgreSQL operational failure propagates by identity without corrupt-state relabeling", async () => {
  const error = new Error("private SQL driver details");
  await withPg(error, async pg => { await assert.rejects(() => pg.listTaskPackCurrentWorkflowSnapshots(), e => e === error); });
});
scenario("SQLite operational failure propagates by identity and prepared read is not retried", async () => {
  const prepare = db.prepare, error = new Error("private SQLite read failure");
  let calls = 0;
  db.prepare = (() => { calls++; throw error; }) as typeof db.prepare;
  try { await assert.rejects(() => adapter.listTaskPackCurrentWorkflowSnapshots(), e => e === error); assert.equal(calls, 1); }
  finally { db.prepare = prepare; }
});
scenario("source contract is one portable, read-only joined snapshot with current events and stable ordering", () => {
  assert.equal((TASK_PACK_CURRENT_WORKFLOW_SQL.match(/\bSELECT\b/g) ?? []).length, 1);
  assert.match(TASK_PACK_CURRENT_WORKFLOW_SQL, /LEFT JOIN task_pack_revisions r ON r.id = tp.current_revision_id/);
  assert.match(TASK_PACK_CURRENT_WORKFLOW_SQL, /LEFT JOIN task_pack_revision_review_events e ON e.revision_id = tp.current_revision_id/);
  assert.match(TASK_PACK_CURRENT_WORKFLOW_SQL, /ORDER BY tp.created_at DESC, tp.id ASC, e.created_at ASC, e.id ASC/);
  assert.doesNotMatch(TASK_PACK_CURRENT_WORKFLOW_SQL, /\b(?:INSERT|UPDATE|DELETE|BEGIN|LIMIT|FOR UPDATE)\b/);
  for (const file of ["SqliteStorageAdapter", "PostgresStorageAdapter"]) {
    const source = fs.readFileSync(new URL(`./${file}.ts`, import.meta.url), "utf8");
    const method = source.slice(source.indexOf("  async listTaskPackCurrentWorkflowSnapshots("), source.indexOf("  async getTaskPackAggregate("));
    assert.equal((method.match(/(?:this.getAll|pool.query)/g) ?? []).length, 1);
    assert.doesNotMatch(method, /for\s*\(|Promise.all|\.map\(|getTaskPackRevision|listTaskPackRevisionReviewEvents|persist\(/);
  }
});

try {
  await adapter.ensureSchema(); db = (adapter as unknown as { db: Database }).db;
  projectId = (await adapter.upsertScannedProject({ name: "Workflow index", localPath: root, packageManager: "npm",
    detectedStack: [], scripts: {}, readinessScore: 100, readinessReport: { score: 100, checks: [], issues: [] } })).id;
  for (const { name, run } of scenarios) { await run(); console.log(`PASS ${name}`); }
  console.log(`Task Pack workflow index storage smoke: ${scenarios.length}/${scenarios.length} passed (real SQLite; PostgreSQL fake pool/source, no live PostgreSQL).`);
} finally {
  (adapter as unknown as { db: Database | null }).db?.close();
  fs.rmSync(root, { recursive: true, force: true });
}
