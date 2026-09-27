import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Database } from "sql.js";
import { pool } from "../db/pool.js";
import { assertTaskPackAggregate, assertTaskPackAggregateLifecycleEvent, assertTaskPackRevision,
  type TaskPackLifecycleTransitionEvent } from "../taskPacks/taskPackLifecycle.js";
import { PostgresStorageAdapter } from "./PostgresStorageAdapter.js";
import { SqliteStorageAdapter } from "./SqliteStorageAdapter.js";
import { TaskPackLifecycleStorageError, type TaskPackLifecycleStorageErrorCode,
  type TransitionTaskPackAggregateLifecycleInput as Input,
  type TransitionTaskPackAggregateLifecycleResult as Result } from "./types.js";

const scenarios: { name: string; run: () => void | Promise<void> }[] = [];
const scenario = (name: string, run: () => void | Promise<void>) => scenarios.push({ name, run });
const root = fs.mkdtempSync(path.join(os.tmpdir(), "contextforge-tp-lc-05a-"));
const databasePath = path.join(root, "lifecycle.sqlite");
const adapter = new SqliteStorageAdapter(databasePath);
const databases: Database[] = [];
const stamp = "2026-09-27T12:00:00.000Z";
const previousStamp = "2026-09-26T12:00:00.000Z";
let db: Database;
let projectId: number;
let serial = 0;
type Row = Record<string, unknown>;
type State = "active" | "completed" | "archived-active" | "archived-completed";
const code = (suffix: string) => `TASK_PACK_LIFECYCLE_${suffix}` as TaskPackLifecycleStorageErrorCode;
function rows(sql: string): Row[] {
  const statement = db.prepare(sql);
  try {
    const result: Row[] = [];
    while (statement.step()) result.push(statement.getAsObject());
    return result;
  } finally { statement.free(); }
}
function snapshot() {
  return ["task_packs", "task_pack_revisions", "task_pack_lifecycle_events", "task_pack_revision_review_events"]
    .map(table => rows(`SELECT * FROM ${table} ORDER BY 1`));
}
function input(taskPackId: number, type: TaskPackLifecycleTransitionEvent["type"] = "archive", version = 1): Input {
  return { taskPackId, transition: { type }, expectedLifecycleVersion: version, eventId: `event-${++serial}`,
    source: "user", actorId: "local-user", createdAt: stamp, metadata: { action: "explicit", flags: [true, null] } };
}
async function fixture(state: State = "active", accepted = true, completedAt: string | null = null) {
  const pack = await adapter.createTaskPack({ projectId, title: `Fixture ${++serial}`, rawTask: "Private task fixture",
    taskType: "tests", targetTool: "generic", generatedPrompt: "Private prompt fixture", generationMode: "template",
    generationModel: null, generationMessage: null, generationUsedFallback: false,
    generationDurationMs: null, generationRecipe: { template: "fixture" } });
  const archived = state.startsWith("archived-");
  const completed = state === "completed" || state === "archived-completed";
  // Test-only seeding of already accepted/reviewed aggregates; no review workflow added.
  db.run(`UPDATE task_packs SET accepted_revision_id = ?, lifecycle_state = ?, archived_from_state = ?,
    completed_at = ?, archived_at = ? WHERE id = ?`,
  [accepted ? (await adapter.getTaskPackAggregate(pack.id))!.currentRevisionId : null,
    archived ? "archived" : state, archived ? state.slice("archived-".length) : null,
    completed ? previousStamp : completedAt, archived ? previousStamp : null, pack.id]);
  return pack.id;
}
async function expectFailure(operation: () => Promise<unknown>, expected: TaskPackLifecycleStorageErrorCode) {
  let captured: TaskPackLifecycleStorageError | undefined;
  await assert.rejects(operation, error => {
    assert.ok(error instanceof TaskPackLifecycleStorageError);
    assert.equal(error.code, expected);
    assert.equal(error.message, expected);
    assert.equal("cause" in error, false);
    assert.doesNotMatch(JSON.stringify(error), /private|constraint|SELECT|INSERT|UPDATE/);
    captured = error;
    return true;
  });
  return captured!;
}
async function unchangedFailure(value: Input, expected: TaskPackLifecycleStorageErrorCode) {
  const before = snapshot();
  const file = fs.readFileSync(databasePath);
  const error = await expectFailure(() => adapter.transitionTaskPackAggregateLifecycle(value), expected);
  assert.deepEqual(snapshot(), before, "rollback preserves all aggregates, revisions and events");
  assert.deepEqual(fs.readFileSync(databasePath), file, "failed operation never persists");
  assert.equal(rows("PRAGMA foreign_keys")[0].foreign_keys, 1);
  return error;
}

// Actual SQLite results are reused for cross-adapter comparison below.
const parity: { row: Row; input: Input; result: Result }[] = [];
const legal: [State, TaskPackLifecycleTransitionEvent["type"], string, string | null][] = [
  ["active", "complete", "completed", null], ["completed", "reopen", "active", null],
  ["active", "archive", "archived", "active"], ["completed", "archive", "archived", "completed"],
  ["archived-active", "unarchive", "active", null], ["archived-completed", "unarchive", "completed", null],
];
for (const [state, transition, target, archivedFrom] of legal) scenario(`SQLite ${state} -> ${transition}: projection, event, timestamps and unchanged evidence`, async () => {
  const id = await fixture(state);
  const old = (await adapter.getTaskPackAggregate(id))!;
  const before = snapshot();
  const row = rows(`SELECT * FROM task_packs WHERE id = ${id}`)[0];
  const request = input(id, transition);
  const result = await adapter.transitionTaskPackAggregateLifecycle(request);
  const { aggregate, event } = result;
  assertTaskPackAggregate(aggregate);
  assertTaskPackAggregateLifecycleEvent(event, { aggregate: old });
  assert.deepEqual(aggregate, { ...old, lifecycle: { state: target, archivedFromState: archivedFrom },
    lifecycleVersion: old.lifecycleVersion + 1, updatedAt: stamp,
    completedAt: transition === "complete" ? stamp : old.completedAt,
    archivedAt: transition === "archive" ? stamp : null });
  const eventTypes = { complete: "completed", reopen: "reopened", archive: "archived", unarchive: "unarchived" };
  assert.deepEqual(event, { id: request.eventId, taskPackId: id, eventType: eventTypes[transition],
    fromState: old.lifecycle.state, toState: target, revisionId: transition === "complete" ? old.currentRevisionId : null,
    source: request.source, actorId: request.actorId, createdAt: stamp, metadata: request.metadata });
  assert.deepEqual(await adapter.listTaskPackAggregateLifecycleEvents(id), [event]);
  assert.deepEqual(await adapter.getTaskPackAggregate(id), aggregate);
  const changed = new Set(["lifecycle_state", "archived_from_state", "lifecycle_version", "updated_at", "completed_at", "archived_at"]);
  const finalRow = rows(`SELECT * FROM task_packs WHERE id = ${id}`)[0];
  for (const key of Object.keys(row)) if (!changed.has(key)) assert.deepEqual(finalRow[key], row[key], key);
  assert.deepEqual(snapshot()[1], before[1], "immutable revisions and hashes untouched");
  assert.deepEqual(snapshot()[3], before[3], "review events untouched");
  const revision = (await adapter.getCurrentTaskPackRevision(id))!;
  assertTaskPackRevision(revision, { aggregate, verifyContentHash: true });
  assert.ok((await adapter.listTaskPacks()).some(pack => pack.id === id), "archived items still listed");
  assert.ok(await adapter.getTaskPackById(id));
  assert.equal(rows("PRAGMA foreign_keys")[0].foreign_keys, 1);
  parity.push({ row, input: request, result });
});
scenario("SQLite reopen/archive/unarchive uses prior state, preserving historical completion evidence", async () => {
  const id = await fixture("completed");
  await adapter.transitionTaskPackAggregateLifecycle(input(id, "reopen"));
  const archived = await adapter.transitionTaskPackAggregateLifecycle(input(id, "archive", 2));
  assert.deepEqual(archived.aggregate.lifecycle, { state: "archived", archivedFromState: "active" });
  const restored = await adapter.transitionTaskPackAggregateLifecycle(input(id, "unarchive", 3));
  assert.equal(restored.aggregate.lifecycle.state, "active");
  assert.equal(restored.aggregate.completedAt, previousStamp);
  assert.equal(restored.aggregate.archivedAt, null);
  assert.equal(restored.aggregate.lifecycleVersion, 4);
  assert.equal((await adapter.listTaskPackAggregateLifecycleEvents(id)).length, 3);
});
scenario("SQLite completion without acceptance fails without mutation", async () => {
  await unchangedFailure(input(await fixture("active", false), "complete"), code("INVALID_TRANSITION"));
});
async function appendRevision(id: number) {
  const base = (await adapter.getCurrentTaskPackRevision(id))!;
  const { id: _id, taskPackId: _pack, revisionNumber: _number, baseRevisionId: _base,
    contentHash: _hash, createdAt: _created, generatedAt: _generated, ...content } = base;
  return adapter.appendTaskPackRevision({ ...content, taskPackId: id, baseRevisionId: base.id,
    sourceKind: "manual_edit", rawTask: "Second revision", createdAt: stamp, generatedAt: null });
}
scenario("SQLite historical acceptance cannot complete; revision append advances aggregate CAS token", async () => {
  const id = await fixture();
  const old = (await adapter.getTaskPackAggregate(id))!;
  const revision = await appendRevision(id);
  const current = (await adapter.getTaskPackAggregate(id))!;
  assert.equal(revision.revisionNumber, 2);
  assert.equal(current.lifecycleVersion, 2);
  assert.equal(current.currentRevisionId, revision.id);
  assert.equal(current.acceptedRevisionId, old.currentRevisionId);
  const conflict = await unchangedFailure(input(id, "archive", 1), code("CONFLICT"));
  assert.deepEqual([conflict.taskPackId, conflict.expectedLifecycleVersion, conflict.actualLifecycleVersion], [id, 1, 2]);
  await unchangedFailure(input(id, "complete", 2), code("INVALID_TRANSITION"));
});
for (const [state, transition] of [
  ["active", "reopen"], ["active", "unarchive"], ["completed", "complete"], ["completed", "unarchive"],
  ["archived-active", "archive"], ["archived-active", "complete"], ["archived-completed", "reopen"],
] as const) scenario(`SQLite illegal ${state} + ${transition} is not a no-op`, async () => {
  await unchangedFailure(input(await fixture(state), transition), code("INVALID_TRANSITION"));
});
scenario("SQLite stale version returns safe expected/actual and no event", async () => {
  const id = await fixture();
  const error = await unchangedFailure(input(id, "archive", 2), code("CONFLICT"));
  assert.deepEqual([error.taskPackId, error.expectedLifecycleVersion, error.actualLifecycleVersion], [id, 2, 1]);
});
for (const version of [2147483647, Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER]) {
  scenario(`SQLite lifecycleVersion range boundary ${version}`, async () => {
    const id = await fixture();
    db.run("UPDATE task_packs SET lifecycle_version = ? WHERE id = ?", [version, id]);
    if (version === Number.MAX_SAFE_INTEGER) {
      await unchangedFailure(input(id, "archive", version), code("VERSION_EXHAUSTED"));
    } else {
      assert.equal((await adapter.transitionTaskPackAggregateLifecycle(input(id, "archive", version))).aggregate.lifecycleVersion, version + 1);
    }
  });
}
for (const key of ["taskPackId", "expectedLifecycleVersion"] as const) scenario(`SQLite invalid ${key} rejected before mutation`, async () => {
  const id = await fixture();
  for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, "1", null, undefined]) {
    await unchangedFailure({ ...input(id), [key]: value } as Input, code("STATE_INVALID"));
  }
});
scenario("SQLite missing aggregate is distinct from invalid current pointer", async () => {
  await unchangedFailure(input(Number.MAX_SAFE_INTEGER), code("NOT_FOUND"));
  const id = await fixture();
  db.run("UPDATE task_packs SET current_revision_id = NULL WHERE id = ?", [id]);
  await unchangedFailure(input(id), code("STATE_INVALID"));
});
for (const [field, values] of [
  ["eventId", ["", "  ", "bad\nidentity", "x".repeat(201), 1, null]],
  ["source", ["external", "", null]], ["actorId", [1, {}, undefined]],
  ["createdAt", ["bad", "2026-09-27", "2026-09-27T12:00:00+01:00", null]],
  ["metadata", [[], "private", { bad: undefined }, { bad: NaN }, { bad: new Date() }]],
] as const) scenario(`SQLite invalid ${field} uses existing domain validation before writes`, async () => {
  const id = await fixture();
  for (const value of values) await unchangedFailure({ ...input(id), [field]: value } as Input, code("STATE_INVALID"));
});
scenario("SQLite rejects unknown transitions and caller-supplied unarchive destinations", async () => {
  const id = await fixture("archived-active");
  for (const transition of [null, {}, { type: "accept" }, { type: "unarchive", targetState: "completed" },
    { type: "unarchive", archivedFromState: "completed" }, { type: "unarchive", unarchiveTo: "completed" }]) {
    await unchangedFailure({ ...input(id), transition } as Input, code("INVALID_TRANSITION"));
  }
});
scenario("SQLite duplicate event PK rolls back version, timestamps and projection across aggregates", async () => {
  const first = input(await fixture());
  await adapter.transitionTaskPackAggregateLifecycle(first);
  const second = { ...input(await fixture()), eventId: first.eventId };
  await unchangedFailure(second, code("EVENT_EXISTS"));
});
for (const [name, trigger, suffix] of [
  ["event insert abort", "BEFORE INSERT ON task_pack_lifecycle_events BEGIN SELECT RAISE(ABORT, 'private SQL failure'); END", "STATE_INVALID"],
  ["projection zero-row CAS", "BEFORE UPDATE OF lifecycle_version ON task_packs BEGIN SELECT RAISE(IGNORE); END", "CONFLICT"],
  ["projection abort", "BEFORE UPDATE OF lifecycle_version ON task_packs BEGIN SELECT RAISE(ABORT, 'private SQL failure'); END", "STATE_INVALID"],
  ["missing inserted event", "BEFORE INSERT ON task_pack_lifecycle_events BEGIN SELECT RAISE(IGNORE); END", "STATE_INVALID"],
  ["incoherent final projection after event insert", "AFTER INSERT ON task_pack_lifecycle_events BEGIN UPDATE task_packs SET title = 'unexpected' WHERE id = NEW.task_pack_id; END", "STATE_INVALID"],
] as const) scenario(`SQLite injected ${name}: full rollback`, async () => {
  const id = await fixture();
  db.run(`CREATE TEMP TRIGGER lifecycle_failure ${trigger}`);
  try { await unchangedFailure(input(id), code(suffix)); }
  finally { db.run("DROP TRIGGER lifecycle_failure"); }
});
scenario("SQLite low-level append compatibility and event immutability remain intact", async () => {
  const id = await fixture();
  const event = { id: `low-level-${++serial}`, taskPackId: id, revisionId: null, eventType: "archived" as const,
    fromState: "active" as const, toState: "archived" as const, source: "system" as const,
    actorId: null, createdAt: stamp, metadata: null };
  const old = await adapter.getTaskPackAggregate(id);
  await adapter.appendTaskPackAggregateLifecycleEvent(event);
  assert.deepEqual(await adapter.listTaskPackAggregateLifecycleEvents(id), [event]);
  assert.deepEqual(await adapter.getTaskPackAggregate(id), old);
  assert.throws(() => db.run("UPDATE task_pack_lifecycle_events SET actor_id = 'changed' WHERE id = ?", [event.id]));
});
scenario("SQLite persisted-file reopen observes committed projection and event together", async () => {
  const id = await fixture();
  const result = await adapter.transitionTaskPackAggregateLifecycle({ ...input(id), metadata: null, actorId: null });
  const reopened = new SqliteStorageAdapter(databasePath);
  await reopened.ensureSchema();
  databases.push((reopened as unknown as { db: Database }).db);
  assert.deepEqual(await reopened.getTaskPackAggregate(id), result.aggregate);
  assert.deepEqual(await reopened.listTaskPackAggregateLifecycleEvents(id), [result.event]);
});

// PostgreSQL executable orchestration fake, NOT a live SQL engine. It captures
// actual adapter queries and simulates pg Date/int8/JSONB representations.
class PgTransaction {
  row: Row | undefined;
  events: Row[] = [];
  queries: { sql: string; parameters: unknown[] }[] = [];
  releases = 0;
  connections = 0;
  private saved?: { row: Row | undefined; events: Row[] };
  constructor(row: Row | undefined, readonly failure = "", readonly rollbackFails = false) {
    this.row = row && structuredClone(row);
    if (this.row) {
      this.row.lifecycle_version = String(this.row.lifecycle_version);
      for (const field of ["created_at", "updated_at", "completed_at", "archived_at"]) {
        if (typeof this.row[field] === "string") this.row[field] = new Date(this.row[field] as string);
      }
    }
  }
  async query(sql: string, parameters: unknown[] = []) {
    const text = sql.replace(/\s+/g, " ").trim().replace(/;$/, "");
    this.queries.push({ sql: text, parameters: structuredClone(parameters) });
    const result = (row: Row | undefined) => ({ rows: row ? [structuredClone(row)] : [], rowCount: row ? 1 : 0 });
    if (text === "BEGIN") { this.saved = structuredClone({ row: this.row, events: this.events }); return result(undefined); }
    if (text === "ROLLBACK") {
      this.row = this.saved!.row; this.events = this.saved!.events;
      if (this.rollbackFails) throw new Error("private rollback detail");
      return result(undefined);
    }
    if (text === "COMMIT") {
      if (this.failure === "commit") throw new Error("private commit detail");
      return result(undefined);
    }
    if (text === "SELECT * FROM task_packs WHERE id = $1 FOR UPDATE") return result(this.row);
    if (text === "SELECT lifecycle_version FROM task_packs WHERE id = $1") return result(this.row && { lifecycle_version: this.row.lifecycle_version });
    if (text.startsWith("UPDATE task_packs SET")) {
      assert.match(text, /WHERE id = \$6 AND lifecycle_version = \$7$/);
      assert.match(text, /lifecycle_version = lifecycle_version \+ 1/);
      if (this.failure === "projection") throw new Error("private projection detail");
      if (this.failure === "cas" || !this.row || parameters[5] !== this.row.id || parameters[6] !== Number(this.row.lifecycle_version)) return result(undefined);
      Object.assign(this.row, { lifecycle_state: parameters[0], archived_from_state: parameters[1],
        lifecycle_version: String(Number(this.row.lifecycle_version) + 1), updated_at: new Date(parameters[2] as string),
        completed_at: parameters[3] === null ? null : new Date(parameters[3] as string),
        archived_at: parameters[4] === null ? null : new Date(parameters[4] as string) });
      return result(this.row);
    }
    if (text.startsWith("INSERT INTO task_pack_lifecycle_events")) {
      assert.match(text, /\$10::jsonb/);
      if (this.failure === "event") throw new Error("private event detail");
      if (this.failure === "other-unique") throw { code: "23505", constraint: "another_constraint", message: "private detail" };
      if (this.events.some(row => row.id === parameters[0])) throw { code: "23505", constraint: "task_pack_lifecycle_events_pkey" };
      const [id, task_pack_id, revision_id, event_type, from_state, to_state, source, actor_id, created_at, metadata] = parameters;
      const json = metadata === null ? null : JSON.parse(metadata as string);
      this.events.push({ id, task_pack_id, revision_id, event_type, from_state, to_state, source, actor_id,
        created_at: new Date(created_at as string), metadata: json && Object.fromEntries(Object.entries(json).reverse()) });
      return result(this.events.at(-1));
    }
    if (text === "SELECT * FROM task_packs WHERE id = $1") {
      if (this.failure === "missing-aggregate") return result(undefined);
      if (this.failure === "readback" && this.row) return result({ ...this.row, title: "wrong title" });
      return result(this.row);
    }
    if (text === "SELECT * FROM task_pack_lifecycle_events WHERE id = $1") {
      if (this.failure === "missing-event") return result(undefined);
      const event = this.events.find(row => row.id === parameters[0]);
      if (this.failure === "event-readback" && event) return result({ ...event, actor_id: "wrong actor" });
      return result(event);
    }
    throw new Error(`Unexpected fake-client SQL: ${text}`);
  }
  release() { this.releases++; }
}
async function withPg<T>(transaction: PgTransaction, run: (adapter: PostgresStorageAdapter) => Promise<T>) {
  const connect = pool.connect, query = pool.query;
  pool.connect = (async () => { transaction.connections++; return transaction; }) as unknown as typeof pool.connect;
  pool.query = (() => { throw new Error("pool query forbidden inside lifecycle transaction"); }) as typeof pool.query;
  try { return await run(new PostgresStorageAdapter()); }
  finally { pool.connect = connect; pool.query = query; }
}
for (let index = 0; index < legal.length; index++) scenario(`PostgreSQL fake-client parity: ${legal[index][0]} -> ${legal[index][1]}`, async () => {
  const expected = parity[index];
  const transaction = new PgTransaction(expected.row);
  const result = await withPg(transaction, pg => pg.transitionTaskPackAggregateLifecycle(expected.input));
  assert.deepEqual(result, expected.result);
  assert.equal(transaction.connections, 1); assert.equal(transaction.releases, 1);
  const queries = transaction.queries.map(call => call.sql);
  assert.equal(queries[0], "BEGIN");
  assert.match(queries[1], /FOR UPDATE$/);
  assert.match(queries[2], /^UPDATE task_packs/);
  assert.match(queries[3], /^INSERT INTO task_pack_lifecycle_events/);
  assert.match(queries[4], /^SELECT \* FROM task_packs/);
  assert.match(queries[5], /^SELECT \* FROM task_pack_lifecycle_events/);
  assert.equal(queries[6], "COMMIT");
  assert.equal(queries.length, 7);
  assert.equal(transaction.queries[2].parameters[6], expected.input.expectedLifecycleVersion);
});
for (const [failure, suffix] of [
  ["projection", "STATE_INVALID"], ["cas", "CONFLICT"], ["event", "STATE_INVALID"],
  ["duplicate", "EVENT_EXISTS"], ["other-unique", "STATE_INVALID"], ["commit", "STATE_INVALID"],
  ["readback", "STATE_INVALID"], ["event-readback", "STATE_INVALID"],
  ["missing-aggregate", "STATE_INVALID"], ["missing-event", "STATE_INVALID"],
] as const) scenario(`PostgreSQL fake-client ${failure}: rollback, safe error and release`, async () => {
  const expected = parity[2];
  const transaction = new PgTransaction(expected.row, failure);
  if (failure === "duplicate") transaction.events.push({ id: expected.input.eventId });
  const before = structuredClone({ row: transaction.row, events: transaction.events });
  await withPg(transaction, pg => expectFailure(() => pg.transitionTaskPackAggregateLifecycle(expected.input), code(suffix)));
  assert.deepEqual({ row: transaction.row, events: transaction.events }, before);
  assert.equal(transaction.queries.at(-1)!.sql, "ROLLBACK");
  assert.equal(transaction.releases, 1);
  if (failure === "cas" || failure === "projection") assert.equal(transaction.queries.some(call => call.sql.startsWith("INSERT")), false);
});
scenario("PostgreSQL rollback error retains original typed duplicate failure and releases", async () => {
  const expected = parity[2];
  const transaction = new PgTransaction(expected.row, "", true);
  transaction.events.push({ id: expected.input.eventId });
  await withPg(transaction, pg => expectFailure(() => pg.transitionTaskPackAggregateLifecycle(expected.input), code("EVENT_EXISTS")));
  assert.equal(transaction.releases, 1);
});
for (const [name, suffix] of [["missing", "NOT_FOUND"], ["stale", "CONFLICT"], ["exhausted", "VERSION_EXHAUSTED"],
  ["bad-pointer", "STATE_INVALID"], ["bad-prior-state", "STATE_INVALID"], ["illegal", "INVALID_TRANSITION"],
  ["unaccepted", "INVALID_TRANSITION"], ["bad-event", "STATE_INVALID"]] as const) {
  scenario(`PostgreSQL ${name} fails before UPDATE/INSERT`, async () => {
    const expected = parity[2];
    const row = { ...expected.row };
    const request = { ...expected.input };
    if (name === "stale") request.expectedLifecycleVersion = 2;
    if (name === "exhausted") { row.lifecycle_version = Number.MAX_SAFE_INTEGER; request.expectedLifecycleVersion = Number.MAX_SAFE_INTEGER; }
    if (name === "bad-pointer") row.current_revision_id = null;
    if (name === "bad-prior-state") row.archived_from_state = "completed";
    if (name === "illegal") request.transition = { type: "reopen" };
    if (name === "unaccepted") { row.accepted_revision_id = null; request.transition = { type: "complete" }; }
    if (name === "bad-event") request.eventId = "";
    const transaction = new PgTransaction(name === "missing" ? undefined : row);
    await withPg(transaction, pg => expectFailure(() => pg.transitionTaskPackAggregateLifecycle(request), code(suffix)));
    assert.equal(transaction.queries.some(call => /^(UPDATE|INSERT)/.test(call.sql)), false);
    assert.equal(transaction.queries.at(-1)!.sql, "ROLLBACK");
    assert.equal(transaction.releases, 1);
  });
}
for (const version of [2147483647, Number.MAX_SAFE_INTEGER - 1]) scenario(`PostgreSQL BIGINT string ${version} increments numerically`, async () => {
  const expected = parity[2];
  const transaction = new PgTransaction({ ...expected.row, lifecycle_version: version });
  const result = await withPg(transaction, pg => pg.transitionTaskPackAggregateLifecycle({ ...expected.input, expectedLifecycleVersion: version }));
  assert.equal(result.aggregate.lifecycleVersion, version + 1);
});
scenario("PostgreSQL TIMESTAMPTZ normalization preserves valid caller whole-second timestamp", async () => {
  const expected = parity[0];
  const createdAt = "2026-09-27T12:00:00Z";
  const result = await withPg(new PgTransaction(expected.row), pg => pg.transitionTaskPackAggregateLifecycle({ ...expected.input, createdAt }));
  assert.equal(result.aggregate.updatedAt, createdAt);
  assert.equal(result.aggregate.completedAt, createdAt);
  assert.equal(result.event.createdAt, createdAt);
});
scenario("both adapters retain one CAS transaction, shared domain preparation and no event mutation API", () => {
  const types = fs.readFileSync(new URL("./types.ts", import.meta.url), "utf8");
  assert.doesNotMatch(types, /(?:update|delete)TaskPackAggregateLifecycleEvent/);
  for (const name of ["SqliteStorageAdapter", "PostgresStorageAdapter"]) {
    const source = fs.readFileSync(new URL(`./${name}.ts`, import.meta.url), "utf8");
    const operation = source.slice(source.indexOf("  async transitionTaskPackAggregateLifecycle("), source.indexOf("  async appendTaskPackAggregateLifecycleEvent("));
    assert.match(operation, /prepareTaskPackAggregateLifecycleTransition\(current, input\)/);
    assert.match(operation, /validateTaskPackAggregateLifecycleTransitionResult/);
    assert.doesNotMatch(operation, /this\.appendTaskPackAggregateLifecycleEvent|UPDATE task_pack_lifecycle_events|DELETE FROM|accepted_revision_id\s*=/);
    const update = operation.slice(operation.indexOf("`UPDATE task_packs"), operation.indexOf(";`,", operation.indexOf("`UPDATE task_packs")));
    assert.doesNotMatch(update, /raw_task|generated_prompt|generation_recipe|current_revision_id|accepted_revision_id|project_id|title|created_at/);
    if (name === "SqliteStorageAdapter") {
      assert.match(source, /BEGIN IMMEDIATE/); assert.match(operation, /this\.withTransaction/);
      assert.match(operation, /SELECT changes\(\) AS changed/); assert.match(operation, /changed\?\.changed !== 1/);
      assert.match(operation, /WHERE id = \? AND lifecycle_version = \?/);
    } else {
      assert.doesNotMatch(operation, /pool\.query/); assert.match(operation, /updated\.rowCount !== 1/);
    }
  }
});

try {
  await adapter.ensureSchema();
  db = (adapter as unknown as { db: Database }).db;
  databases.push(db);
  projectId = (await adapter.upsertScannedProject({ name: "Lifecycle transitions", localPath: path.join(root, "project"),
    packageManager: "npm", detectedStack: [], scripts: {}, readinessScore: 100,
    readinessReport: { score: 100, checks: [], issues: [] } })).id;
  for (const { name, run } of scenarios) { await run(); console.log(`PASS ${name}`); }
  console.log(`Task Pack aggregate lifecycle transition smoke: ${scenarios.length}/${scenarios.length} passed (real SQLite; PostgreSQL fake-client/source, no live PostgreSQL).`);
} finally {
  for (const database of databases) database.close();
  fs.rmSync(root, { recursive: true, force: true });
}
