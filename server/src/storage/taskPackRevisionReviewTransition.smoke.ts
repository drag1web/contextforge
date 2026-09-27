import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Database } from "sql.js";
import { pool } from "../db/pool.js";
import { assertTaskPackRevision, type TaskPackReviewState, type TaskPackReviewTransitionEvent,
  type TaskPackRevisionReviewEvent } from "../taskPacks/taskPackLifecycle.js";
import { SqliteStorageAdapter } from "./SqliteStorageAdapter.js";
import { PostgresStorageAdapter } from "./PostgresStorageAdapter.js";
import { deriveTaskPackRevisionReviewState } from "./taskPackLifecyclePersistence.js";
import { TaskPackReviewStorageError, type TaskPackReviewStorageErrorCode,
  type TransitionTaskPackRevisionReviewInput as Input,
  type TransitionTaskPackRevisionReviewResult as Result } from "./types.js";

const scenarios: { name: string; run: () => void | Promise<void> }[] = [];
const scenario = (name: string, run: () => void | Promise<void>) => scenarios.push({ name, run });
const root = fs.mkdtempSync(path.join(os.tmpdir(), "contextforge-tp-lc-05b-"));
const databasePath = path.join(root, "review.sqlite");
const adapter = new SqliteStorageAdapter(databasePath);
const databases: Database[] = [];
const stamp = "2026-09-27T12:00:00.000Z", later = "2026-09-27T12:00:01.000Z";
let db: Database, projectId: number, serial = 0;
type Row = Record<string, unknown>;
const code = (suffix: string) => `TASK_PACK_REVIEW_${suffix}` as TaskPackReviewStorageErrorCode;
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
async function fixture() {
  const pack = await adapter.createTaskPack({ projectId, title: `Review ${++serial}`, rawTask: "Private task fixture",
    taskType: "tests", targetTool: "generic", generatedPrompt: "Private prompt fixture", generationMode: "template",
    generationModel: null, generationMessage: null, generationUsedFallback: false, generationDurationMs: null,
    generationRecipe: { template: "fixture" } });
  return { taskPackId: pack.id, revisionId: (await adapter.getCurrentTaskPackRevision(pack.id))!.id };
}
function input(ids: { taskPackId: number; revisionId: number }, type: TaskPackReviewTransitionEvent["type"] = "accept",
  state: TaskPackReviewState = "unreviewed", version = 1): Input {
  return { ...ids, expectedReviewState: state, expectedLifecycleVersion: version, transition: { type },
    eventId: `review-${++serial}`, source: "user", actorId: "local-user", createdAt: stamp,
    metadata: { action: "explicit", flags: [true, null] } };
}
async function currentState(ids: { taskPackId: number; revisionId: number }) {
  return deriveTaskPackRevisionReviewState((await adapter.getTaskPackAggregate(ids.taskPackId))!,
    (await adapter.getTaskPackRevisionById(ids.taskPackId, ids.revisionId))!,
    await adapter.listTaskPackRevisionReviewEvents(ids.taskPackId, ids.revisionId));
}
async function expectFailure(operation: () => Promise<unknown>, expected: TaskPackReviewStorageErrorCode) {
  let captured: TaskPackReviewStorageError | undefined;
  await assert.rejects(operation, error => {
    assert.ok(error instanceof TaskPackReviewStorageError);
    assert.equal(error.code, expected); assert.equal(error.message, expected);
    assert.equal("cause" in error, false);
    assert.doesNotMatch(JSON.stringify(error), /private|constraint|SELECT|INSERT|UPDATE/);
    captured = error; return true;
  });
  return captured!;
}
async function unchangedFailure(request: Input, suffix: string) {
  const before = snapshot(), file = fs.readFileSync(databasePath);
  const error = await expectFailure(() => adapter.transitionTaskPackRevisionReview(request), code(suffix));
  assert.deepEqual(snapshot(), before);
  assert.deepEqual(fs.readFileSync(databasePath), file, "failed workflow never persists");
  assert.equal(rows("PRAGMA foreign_keys")[0].foreign_keys, 1);
  return error;
}
async function appendRevision(ids: { taskPackId: number; revisionId: number }) {
  const base = (await adapter.getCurrentTaskPackRevision(ids.taskPackId))!;
  const { id: _id, taskPackId: _pack, revisionNumber: _number, baseRevisionId: _base,
    contentHash: _hash, createdAt: _created, generatedAt: _generated, ...content } = base;
  const revision = await adapter.appendTaskPackRevision({ ...content, taskPackId: ids.taskPackId,
    baseRevisionId: base.id, sourceKind: "manual_edit", rawTask: "Second revision", createdAt: stamp, generatedAt: null });
  return { taskPackId: ids.taskPackId, revisionId: revision.id };
}
async function lifecycle(taskPackId: number, type: "complete" | "archive") {
  const aggregate = (await adapter.getTaskPackAggregate(taskPackId))!;
  return adapter.transitionTaskPackAggregateLifecycle({ taskPackId, expectedLifecycleVersion: aggregate.lifecycleVersion,
    transition: { type }, eventId: `lifecycle-${++serial}`, source: "user", actorId: null, createdAt: later, metadata: null });
}
function lowEvent(ids: { taskPackId: number; revisionId: number }, eventId = `legacy-${++serial}`): TaskPackRevisionReviewEvent {
  return { ...ids, id: eventId, eventType: "review_started", fromState: "unreviewed", toState: "in_review",
    source: "migration", actorId: null, createdAt: stamp, metadata: null };
}
const parity: { aggregate: Row; revision: Row; history: Row[]; input: Input; result: Result }[] = [];
scenario("SQLite empty review history derives unreviewed without fabricated events", async () => {
  const ids = await fixture(); assert.equal(await currentState(ids), "unreviewed");
  assert.deepEqual(await adapter.listTaskPackRevisionReviewEvents(ids.taskPackId, ids.revisionId), []);
});
for (const [state, type, target] of [
  ["unreviewed", "start_review", "in_review"], ["unreviewed", "accept", "accepted"],
  ["in_review", "accept", "accepted"], ["in_review", "request_changes", "changes_requested"],
] as const) scenario(`SQLite ${state} -> ${type}: exact projection/event and immutable revision`, async () => {
  const ids = await fixture();
  if (state === "in_review") await adapter.transitionTaskPackRevisionReview(input(ids, "start_review"));
  const old = (await adapter.getTaskPackAggregate(ids.taskPackId))!;
  const revision = (await adapter.getTaskPackRevisionById(ids.taskPackId, ids.revisionId))!;
  const before = snapshot();
  const aggregateRow = rows(`SELECT * FROM task_packs WHERE id = ${ids.taskPackId}`)[0];
  const revisionRow = rows(`SELECT * FROM task_pack_revisions WHERE id = ${ids.revisionId}`)[0];
  const history = rows(`SELECT * FROM task_pack_revision_review_events WHERE revision_id = ${ids.revisionId} ORDER BY created_at, id`);
  const request = { ...input(ids, type, state), createdAt: later };
  const result = await adapter.transitionTaskPackRevisionReview(request);
  assert.deepEqual(result.aggregate, type === "accept" ? { ...old, acceptedRevisionId: ids.revisionId,
    lifecycleVersion: old.lifecycleVersion + 1, updatedAt: later } : old);
  assert.equal(result.reviewState, target);
  const types = { start_review: "review_started", accept: "accepted", request_changes: "changes_requested" };
  assert.deepEqual(result.event, { id: request.eventId, ...ids, eventType: types[type], fromState: state, toState: target,
    source: request.source, actorId: request.actorId, createdAt: later, metadata: request.metadata });
  assert.deepEqual(result.revision, revision);
  assertTaskPackRevision(result.revision, { aggregate: result.aggregate, verifyContentHash: true });
  assert.deepEqual(snapshot()[1], before[1], "all revision rows/hash bytes unchanged");
  assert.deepEqual(snapshot()[3], before[3], "review never emits lifecycle events");
  const afterRow = rows(`SELECT * FROM task_packs WHERE id = ${ids.taskPackId}`)[0];
  for (const field of Object.keys(aggregateRow)) {
    if (type !== "accept" || !["accepted_revision_id", "lifecycle_version", "updated_at"].includes(field)) {
      assert.deepEqual(afterRow[field], aggregateRow[field], field);
    }
  }
  assert.equal((await adapter.listTaskPackRevisionReviewEvents(ids.taskPackId, ids.revisionId)).length, history.length + 1);
  assert.equal(await currentState(ids), target);
  assert.equal(result.aggregate.lifecycle.state, "active", "accept never completes");
  assert.equal(rows("PRAGMA foreign_keys")[0].foreign_keys, 1);
  parity.push({ aggregate: aggregateRow, revision: revisionRow, history, input: request, result });
});
for (const state of ["unreviewed", "in_review", "accepted", "changes_requested"] as const) {
  const illegal = state === "unreviewed" ? ["request_changes"] : state === "in_review" ? ["start_review"] :
    ["start_review", "accept", "request_changes"];
  for (const type of illegal) scenario(`SQLite illegal/terminal ${state} + ${type} leaves history and projection unchanged`, async () => {
    const ids = await fixture(); let version = 1;
    if (state === "in_review" || state === "changes_requested") await adapter.transitionTaskPackRevisionReview(input(ids, "start_review"));
    if (state === "accepted") { await adapter.transitionTaskPackRevisionReview(input(ids)); version = 2; }
    if (state === "changes_requested") await adapter.transitionTaskPackRevisionReview({ ...input(ids, "request_changes", "in_review"), createdAt: later });
    await unchangedFailure({ ...input(ids, type as TaskPackReviewTransitionEvent["type"], state, version), createdAt: "2026-09-27T12:00:02.000Z" }, "INVALID_TRANSITION");
  });
}
scenario("SQLite state conflict protects non-accept workflow despite unchanged lifecycleVersion", async () => {
  const ids = await fixture(); await adapter.transitionTaskPackRevisionReview(input(ids, "start_review"));
  const error = await unchangedFailure(input(ids, "accept", "unreviewed"), "CONFLICT");
  assert.deepEqual([error.taskPackId, error.revisionId, error.expectedReviewState, error.actualReviewState],
    [ids.taskPackId, ids.revisionId, "unreviewed", "in_review"]);
});
scenario("SQLite lifecycle conflict exposes expected/actual before any event insert", async () => {
  const ids = await fixture();
  const error = await unchangedFailure(input(ids, "start_review", "unreviewed", 2), "CONFLICT");
  assert.deepEqual([error.taskPackId, error.revisionId, error.expectedLifecycleVersion, error.actualLifecycleVersion],
    [ids.taskPackId, ids.revisionId, 2, 1]);
});
scenario("SQLite new revision is unreviewed; older accepted history survives later pointer movement", async () => {
  const first = await fixture(); await adapter.transitionTaskPackRevisionReview(input(first));
  const oldHistory = await adapter.listTaskPackRevisionReviewEvents(first.taskPackId, first.revisionId);
  const second = await appendRevision(first);
  assert.equal(await currentState(second), "unreviewed");
  assert.equal(await currentState(first), "accepted");
  assert.equal((await adapter.getTaskPackAggregate(first.taskPackId))!.acceptedRevisionId, first.revisionId);
  const accepted = await adapter.transitionTaskPackRevisionReview(input(second, "accept", "unreviewed", 3));
  assert.equal(accepted.aggregate.acceptedRevisionId, second.revisionId);
  assert.equal(accepted.aggregate.lifecycleVersion, 4);
  assert.deepEqual(await adapter.listTaskPackRevisionReviewEvents(first.taskPackId, first.revisionId), oldHistory);
  assert.equal(await currentState(first), "accepted");
  const completed = await lifecycle(first.taskPackId, "complete");
  assert.equal(completed.aggregate.lifecycle.state, "completed");
  assert.equal(completed.event.revisionId, second.revisionId);
});
scenario("SQLite active historical acceptance moves recognized pointer without erasing current acceptance", async () => {
  const first = await fixture(), second = await appendRevision(first);
  await adapter.transitionTaskPackRevisionReview(input(second, "accept", "unreviewed", 2));
  const accepted = await adapter.transitionTaskPackRevisionReview(input(first, "accept", "unreviewed", 3));
  assert.equal(accepted.aggregate.acceptedRevisionId, first.revisionId);
  assert.equal(accepted.aggregate.currentRevisionId, second.revisionId);
  assert.equal(await currentState(second), "accepted");
  assert.equal(await currentState(first), "accepted");
});
for (const archive of [false, true]) scenario(`SQLite ${archive ? "archived-completed" : "completed"} historical acceptance rejected before writes`, async () => {
  const first = await fixture(), second = await appendRevision(first);
  await adapter.transitionTaskPackRevisionReview(input(second, "accept", "unreviewed", 2));
  await lifecycle(first.taskPackId, "complete");
  if (archive) await lifecycle(first.taskPackId, "archive");
  const version = (await adapter.getTaskPackAggregate(first.taskPackId))!.lifecycleVersion;
  await unchangedFailure(input(first, "accept", "unreviewed", version), "INVALID_TRANSITION");
  await adapter.transitionTaskPackRevisionReview(input(first, "start_review", "unreviewed", version));
  const result = await adapter.transitionTaskPackRevisionReview({ ...input(first, "request_changes", "in_review", version), createdAt: later });
  assert.equal(result.aggregate.lifecycleVersion, version);
  assert.equal(result.aggregate.acceptedRevisionId, second.revisionId);
});
scenario("SQLite missing aggregate, missing revision and foreign revision fail safely", async () => {
  const first = await fixture(), second = await fixture();
  await unchangedFailure(input({ ...first, taskPackId: Number.MAX_SAFE_INTEGER }), "NOT_FOUND");
  await unchangedFailure(input({ ...first, revisionId: Number.MAX_SAFE_INTEGER }), "REVISION_NOT_FOUND");
  await unchangedFailure(input({ ...first, revisionId: second.revisionId }), "REVISION_NOT_FOUND");
});
for (const field of ["taskPackId", "revisionId", "expectedLifecycleVersion"] as const) scenario(`SQLite invalid ${field} rejected`, async () => {
  const ids = await fixture();
  for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1", null, undefined]) {
    await unchangedFailure({ ...input(ids), [field]: value } as Input, "STATE_INVALID");
  }
});
for (const [field, values] of [
  ["expectedReviewState", ["active", "", 1, null]],
  ["eventId", ["", "  ", "control\n", "x".repeat(201), null]],
  ["source", ["external", null]], ["actorId", [1, {}, undefined]],
  ["createdAt", ["bad", "2026-09-27", "2026-09-27T12:00:00+01:00", null]],
  ["metadata", [[], "private", { bad: undefined }, { bad: NaN }, { bad: new Date() }]],
] as const) scenario(`SQLite invalid ${field} fails before mutation`, async () => {
  const ids = await fixture();
  for (const value of values) await unchangedFailure({ ...input(ids), [field]: value } as Input, "STATE_INVALID");
});
scenario("SQLite closed transition rejects arbitrary destinations and lifecycle actions", async () => {
  const ids = await fixture();
  for (const transition of [null, {}, { type: "complete" }, { type: "accept", targetState: "accepted" }, { type: "start_review", extra: true }]) {
    await unchangedFailure({ ...input(ids), transition } as Input, "INVALID_TRANSITION");
  }
});
scenario("SQLite MAX_SAFE permits non-pointer review transitions but rejects accept", async () => {
  const ids = await fixture();
  db.run("UPDATE task_packs SET lifecycle_version = ? WHERE id = ?", [Number.MAX_SAFE_INTEGER, ids.taskPackId]);
  await unchangedFailure(input(ids, "accept", "unreviewed", Number.MAX_SAFE_INTEGER), "VERSION_EXHAUSTED");
  const before = await adapter.getTaskPackAggregate(ids.taskPackId);
  const started = await adapter.transitionTaskPackRevisionReview(input(ids, "start_review", "unreviewed", Number.MAX_SAFE_INTEGER));
  assert.deepEqual(started.aggregate, before);
  await unchangedFailure({ ...input(ids, "accept", "in_review", Number.MAX_SAFE_INTEGER), createdAt: later }, "VERSION_EXHAUSTED");
  const changed = await adapter.transitionTaskPackRevisionReview({ ...input(ids, "request_changes", "in_review", Number.MAX_SAFE_INTEGER), createdAt: later });
  assert.deepEqual(changed.aggregate, before);
});
for (const version of [2147483647, Number.MAX_SAFE_INTEGER - 1]) scenario(`SQLite accept version ${version} increments once`, async () => {
  const ids = await fixture(); db.run("UPDATE task_packs SET lifecycle_version = ? WHERE id = ?", [version, ids.taskPackId]);
  assert.equal((await adapter.transitionTaskPackRevisionReview(input(ids, "accept", "unreviewed", version))).aggregate.lifecycleVersion, version + 1);
});
for (const type of ["accept", "start_review"] as const) scenario(`SQLite duplicate review PK during ${type} rolls back all projection/event changes`, async () => {
  const first = input(await fixture(), "start_review"); await adapter.transitionTaskPackRevisionReview(first);
  await unchangedFailure({ ...input(await fixture(), type), eventId: first.eventId }, "EVENT_EXISTS");
});
for (const [label, newTime, newId, allowed] of [
  ["earlier timestamp", "2026-09-27T11:59:59.999Z", "z-tail", false],
  ["equal timestamp smaller ID", stamp, "a-tail", false],
  ["equal timestamp larger ID", stamp, "z-tail", true],
  ["later timestamp smaller ID", later, "a-tail", true],
] as const) scenario(`SQLite append ordering: ${label}`, async () => {
  const ids = await fixture(); const tailId = `m-tail-${ids.taskPackId}`;
  await adapter.appendTaskPackRevisionReviewEvent(lowEvent(ids, tailId));
  const request = { ...input(ids, "accept", "in_review"), eventId: `${newId}-${ids.taskPackId}`, createdAt: newTime };
  if (!allowed) await unchangedFailure(request, "CONFLICT");
  else {
    await adapter.transitionTaskPackRevisionReview(request);
    assert.deepEqual((await adapter.listTaskPackRevisionReviewEvents(ids.taskPackId, ids.revisionId)).map(e => e.id), [tailId, request.eventId]);
  }
});
scenario("SQLite timestamp spelling cannot silently reorder history or bypass equal-instant ID ordering", async () => {
  const ids = await fixture();
  await adapter.appendTaskPackRevisionReviewEvent({ ...lowEvent(ids, `m-${ids.taskPackId}`), createdAt: "2026-09-27T12:00:00Z" });
  // Later instant, but TEXT order would put .001Z before Z. Fail closed without rewriting old history.
  await unchangedFailure({ ...input(ids, "accept", "in_review"), createdAt: "2026-09-27T12:00:00.001Z" }, "CONFLICT");
  await unchangedFailure({ ...input(ids, "accept", "in_review"), eventId: `z-${ids.taskPackId}`, createdAt: stamp }, "CONFLICT");
  const second = await fixture(); await adapter.appendTaskPackRevisionReviewEvent(lowEvent(second, `m-${second.taskPackId}`));
  // TEXT sorts Z later than .000Z, but the actual instant is equal and this ID is earlier.
  await unchangedFailure({ ...input(second, "accept", "in_review"), eventId: `a-${second.taskPackId}`, createdAt: "2026-09-27T12:00:00Z" }, "CONFLICT");
});
scenario("SQLite opaque non-ASCII event IDs follow SQL binary ordering, not JS UTF-16 ordering", async () => {
  const ids = await fixture(); await adapter.appendTaskPackRevisionReviewEvent(lowEvent(ids, `\uE000-${ids.taskPackId}`));
  const request = { ...input(ids, "accept", "in_review"), eventId: `\u{10000}-${ids.taskPackId}` };
  await adapter.transitionTaskPackRevisionReview(request);
  assert.equal((await adapter.listTaskPackRevisionReviewEvents(ids.taskPackId, ids.revisionId)).at(-1)!.id, request.eventId);
});
for (const kind of ["from-state", "to-state", "illegal-transition", "disconnected-chain", "time-reversal"] as const) {
  scenario(`SQLite malformed existing ${kind} fails closed, not last-toState trust`, async () => {
    const ids = await fixture();
    if (kind === "disconnected-chain" || kind === "time-reversal") {
      await adapter.appendTaskPackRevisionReviewEvent({ ...lowEvent(ids), createdAt: kind === "time-reversal" ? "2026-09-27T12:00:00.001Z" : stamp });
    }
    const event = { ...lowEvent(ids), eventType: "accepted", fromState: "in_review", toState: "accepted", createdAt: later };
    if (kind === "to-state") event.toState = "in_review";
    if (kind === "illegal-transition") event.fromState = "accepted";
    if (kind === "disconnected-chain") event.fromState = "unreviewed";
    if (kind === "time-reversal") event.createdAt = "2026-09-27T12:00:00Z";
    db.run(`INSERT INTO task_pack_revision_review_events
      (id, task_pack_id, revision_id, event_type, from_state, to_state, source, actor_id, created_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, 'migration', NULL, ?, NULL)`,
    [event.id, ids.taskPackId, ids.revisionId, event.eventType, event.fromState, event.toState, event.createdAt]);
    await unchangedFailure({ ...input(ids, "accept", "accepted"), createdAt: "2026-09-27T12:00:02.000Z" }, "STATE_INVALID");
  });
}
for (const [name, trigger, suffix] of [
  ["event abort", "BEFORE INSERT ON task_pack_revision_review_events BEGIN SELECT RAISE(ABORT, 'private SQL failure'); END", "STATE_INVALID"],
  ["projection zero-row CAS", "BEFORE UPDATE OF accepted_revision_id ON task_packs BEGIN SELECT RAISE(IGNORE); END", "CONFLICT"],
  ["projection abort", "BEFORE UPDATE OF accepted_revision_id ON task_packs BEGIN SELECT RAISE(ABORT, 'private SQL failure'); END", "STATE_INVALID"],
  ["event ignore", "BEFORE INSERT ON task_pack_revision_review_events BEGIN SELECT RAISE(IGNORE); END", "STATE_INVALID"],
  ["final aggregate corruption", "AFTER INSERT ON task_pack_revision_review_events BEGIN UPDATE task_packs SET title = 'unexpected' WHERE id = NEW.task_pack_id; END", "STATE_INVALID"],
] as const) scenario(`SQLite injected ${name}: event and accepted pointer roll back together`, async () => {
  const ids = await fixture(); db.run(`CREATE TEMP TRIGGER review_failure ${trigger}`);
  try { await unchangedFailure(input(ids), suffix); } finally { db.run("DROP TRIGGER review_failure"); }
});
scenario("SQLite non-accept insertion failure leaves aggregate unchanged", async () => {
  const ids = await fixture();
  db.run("CREATE TEMP TRIGGER review_failure BEFORE INSERT ON task_pack_revision_review_events BEGIN SELECT RAISE(ABORT, 'private'); END");
  try { await unchangedFailure(input(ids, "start_review"), "STATE_INVALID"); } finally { db.run("DROP TRIGGER review_failure"); }
});
scenario("SQLite low-level append/read compatibility, immutable event, persisted-file reopen", async () => {
  const ids = await fixture(), old = await adapter.getTaskPackAggregate(ids.taskPackId), event = lowEvent(ids);
  await adapter.appendTaskPackRevisionReviewEvent(event);
  assert.deepEqual(await adapter.listTaskPackRevisionReviewEvents(ids.taskPackId, ids.revisionId), [event]);
  assert.deepEqual(await adapter.getTaskPackAggregate(ids.taskPackId), old);
  assert.throws(() => db.run("UPDATE task_pack_revision_review_events SET actor_id = 'changed' WHERE id = ?", [event.id]));
  const accepted = await adapter.transitionTaskPackRevisionReview({ ...input(ids, "accept", "in_review"), createdAt: later, metadata: null, actorId: null });
  const reopened = new SqliteStorageAdapter(databasePath); await reopened.ensureSchema();
  databases.push((reopened as unknown as { db: Database }).db);
  assert.deepEqual(await reopened.getTaskPackAggregate(ids.taskPackId), accepted.aggregate);
  assert.deepEqual(await reopened.listTaskPackRevisionReviewEvents(ids.taskPackId, ids.revisionId), [event, accepted.event]);
});

// PostgreSQL fake exercises actual adapter orchestration; this is NOT live PG SQL execution.
const binaryCompare = (a: string, b: string): number => Buffer.compare(Buffer.from(a), Buffer.from(b));
class PgTransaction {
  aggregate: Row | undefined;
  revision: Row | undefined;
  events: Row[];
  queries: { sql: string; parameters: unknown[] }[] = [];
  releases = 0; connections = 0; private snapshot?: { aggregate: Row | undefined; revision: Row | undefined; events: Row[] };
  private historyReads = 0; private revisionReads = 0;
  constructor(fixture: typeof parity[number], readonly failure = "", readonly rollbackFails = false,
    readonly compareIds = binaryCompare) {
    const dates = (row: Row) => {
      const copy = structuredClone(row);
      for (const key of ["created_at", "updated_at", "completed_at", "archived_at", "generated_at"]) {
        if (typeof copy[key] === "string") copy[key] = new Date(copy[key] as string);
      }
      return copy;
    };
    this.aggregate = dates(fixture.aggregate); this.aggregate.lifecycle_version = String(this.aggregate.lifecycle_version);
    this.revision = dates(fixture.revision); this.events = fixture.history.map(dates);
  }
  async query(sql: string, parameters: unknown[] = []) {
    const text = sql.replace(/\s+/g, " ").trim().replace(/;$/, "");
    this.queries.push({ sql: text, parameters: structuredClone(parameters) });
    const result = (rows: Row[]) => ({ rows: structuredClone(rows), rowCount: rows.length });
    if (text === "BEGIN") { this.snapshot = structuredClone({ aggregate: this.aggregate, revision: this.revision, events: this.events }); return result([]); }
    if (text === "ROLLBACK") {
      Object.assign(this, this.snapshot!);
      if (this.rollbackFails) throw new Error("private rollback details");
      return result([]);
    }
    if (text === "COMMIT") { if (this.failure === "commit") throw new Error("private commit"); return result([]); }
    if (text === "SELECT * FROM task_packs WHERE id = $1 FOR UPDATE") return result(this.aggregate ? [this.aggregate] : []);
    if (text === "SELECT * FROM task_pack_revisions WHERE task_pack_id = $1 AND id = $2") {
      this.revisionReads++;
      if (this.failure === "revision-readback" && this.revisionReads > 1 && this.revision) return result([{ ...this.revision, raw_task: "altered" }]);
      return result(this.revision && this.revision.task_pack_id === parameters[0] && this.revision.id === parameters[1] ? [this.revision] : []);
    }
    if (text.startsWith("SELECT * FROM task_pack_revision_review_events")) {
      this.historyReads++; assert.match(text, /WHERE task_pack_id = \$1 AND revision_id = \$2 ORDER BY created_at ASC, id ASC$/);
      let history = this.events.filter(e => e.task_pack_id === parameters[0] && e.revision_id === parameters[1]);
      history = history.sort((a, b) => Number(new Date(a.created_at as string)) - Number(new Date(b.created_at as string)) || this.compareIds(a.id as string, b.id as string));
      if (this.historyReads > 1 && this.failure === "missing-event") history = history.slice(0, -1);
      if (this.historyReads > 1 && this.failure === "event-readback") history = history.map((e, i) => i === history.length - 1 ? { ...e, actor_id: "unexpected" } : e);
      return result(history);
    }
    if (text.startsWith("SELECT (created_at < $1::timestamptz")) {
      const tail = this.events.find(e => e.id === parameters[2]);
      if (!tail) return result([]);
      const current = Number(new Date(tail.created_at as string)), next = Date.parse(parameters[0] as string);
      const idAfter = this.compareIds(tail.id as string, parameters[1] as string) < 0;
      return result([{ append_order: next > current || (next === current && idAfter), id_after: idAfter }]);
    }
    if (text.startsWith("UPDATE task_packs SET accepted_revision_id")) {
      assert.match(text, /WHERE id = \$3 AND lifecycle_version = \$4$/);
      assert.match(text, /lifecycle_version = lifecycle_version \+ 1/);
      if (this.failure === "projection") throw new Error("private projection");
      if (this.failure === "cas" || !this.aggregate || this.aggregate.id !== parameters[2] || Number(this.aggregate.lifecycle_version) !== parameters[3]) return result([]);
      Object.assign(this.aggregate, { accepted_revision_id: parameters[0], lifecycle_version: String(Number(this.aggregate.lifecycle_version) + 1), updated_at: new Date(parameters[1] as string) });
      return result([this.aggregate]);
    }
    if (text === "SELECT lifecycle_version FROM task_packs WHERE id = $1") return result(this.aggregate ? [{ lifecycle_version: this.aggregate.lifecycle_version }] : []);
    if (text.startsWith("INSERT INTO task_pack_revision_review_events")) {
      assert.match(text, /\$10::jsonb/);
      if (this.failure === "event") throw new Error("private insert");
      if (this.failure === "other-unique") throw { code: "23505", constraint: "other_private_constraint" };
      if (this.events.some(e => e.id === parameters[0])) throw { code: "23505", constraint: "task_pack_revision_review_events_pkey" };
      const [id, task_pack_id, revision_id, event_type, from_state, to_state, source, actor_id, created_at, metadata] = parameters;
      const json = metadata === null ? null : JSON.parse(metadata as string);
      this.events.push({ id, task_pack_id, revision_id, event_type, from_state, to_state, source, actor_id,
        created_at: new Date(created_at as string), metadata: json && Object.fromEntries(Object.entries(json).reverse()) });
      return result([this.events.at(-1)!]);
    }
    if (text === "SELECT * FROM task_packs WHERE id = $1") {
      if (this.failure === "missing-aggregate") return result([]);
      if (this.failure === "aggregate-readback" && this.aggregate) return result([{ ...this.aggregate, title: "unexpected" }]);
      return result(this.aggregate ? [this.aggregate] : []);
    }
    throw new Error(`Unexpected fake-client query: ${text}`);
  }
  release() { this.releases++; }
}
async function withPg<T>(transaction: PgTransaction, run: (pg: PostgresStorageAdapter) => Promise<T>) {
  const connect = pool.connect, query = pool.query;
  pool.connect = (async () => { transaction.connections++; return transaction; }) as unknown as typeof pool.connect;
  pool.query = (() => { throw new Error("pool.query forbidden inside review transaction"); }) as typeof pool.query;
  try { return await run(new PostgresStorageAdapter()); } finally { pool.connect = connect; pool.query = query; }
}
for (let index = 0; index < 4; index++) scenario(`PostgreSQL legal transition parity ${index + 1}: row lock, one client, history and exact result`, async () => {
  const expected = parity[index], transaction = new PgTransaction(expected);
  const result = await withPg(transaction, pg => pg.transitionTaskPackRevisionReview(expected.input));
  assert.deepEqual(result, expected.result);
  assert.equal(transaction.connections, 1); assert.equal(transaction.releases, 1);
  const queries = transaction.queries.map(q => q.sql);
  assert.equal(queries[0], "BEGIN"); assert.match(queries[1], /FOR UPDATE$/);
  assert.match(queries[2], /task_pack_revisions WHERE task_pack_id/);
  assert.match(queries[3], /ORDER BY created_at ASC, id ASC$/);
  assert.equal(queries.at(-1), "COMMIT");
  const updates = queries.filter(q => q.startsWith("UPDATE"));
  assert.equal(updates.length, expected.input.transition.type === "accept" ? 1 : 0);
  if (updates.length) assert.ok(queries.indexOf(updates[0]) < queries.findIndex(q => q.startsWith("INSERT")));
});
for (const [failure, suffix] of [
  ["projection", "STATE_INVALID"], ["cas", "CONFLICT"], ["event", "STATE_INVALID"], ["duplicate", "EVENT_EXISTS"],
  ["other-unique", "STATE_INVALID"], ["commit", "STATE_INVALID"], ["aggregate-readback", "STATE_INVALID"],
  ["revision-readback", "STATE_INVALID"], ["event-readback", "STATE_INVALID"], ["missing-event", "STATE_INVALID"], ["missing-aggregate", "STATE_INVALID"],
] as const) scenario(`PostgreSQL ${failure}: accept pointer/event rollback and release`, async () => {
  const expected = parity[1], transaction = new PgTransaction(expected, failure);
  if (failure === "duplicate") transaction.events.push({ id: expected.input.eventId, task_pack_id: -1, revision_id: -1 });
  const before = structuredClone({ aggregate: transaction.aggregate, revision: transaction.revision, events: transaction.events });
  await withPg(transaction, pg => expectFailure(() => pg.transitionTaskPackRevisionReview(expected.input), code(suffix)));
  assert.deepEqual({ aggregate: transaction.aggregate, revision: transaction.revision, events: transaction.events }, before);
  assert.equal(transaction.releases, 1); assert.equal(transaction.queries.at(-1)!.sql, "ROLLBACK");
  if (failure === "projection" || failure === "cas") assert.equal(transaction.queries.some(q => q.sql.startsWith("INSERT")), false);
});
scenario("PostgreSQL rollback failure preserves duplicate safe error and releases client", async () => {
  const expected = parity[1], transaction = new PgTransaction(expected, "", true);
  transaction.events.push({ id: expected.input.eventId, task_pack_id: -1, revision_id: -1 });
  await withPg(transaction, pg => expectFailure(() => pg.transitionTaskPackRevisionReview(expected.input), code("EVENT_EXISTS")));
  assert.equal(transaction.releases, 1);
});
for (const [name, suffix] of [
  ["missing", "NOT_FOUND"], ["revision-missing", "REVISION_NOT_FOUND"], ["foreign", "REVISION_NOT_FOUND"],
  ["version-conflict", "CONFLICT"], ["state-conflict", "CONFLICT"], ["exhausted", "VERSION_EXHAUSTED"],
  ["invalid-event", "STATE_INVALID"], ["corrupt-chain", "STATE_INVALID"], ["illegal", "INVALID_TRANSITION"],
  ["corrupt-pointer", "STATE_INVALID"], ["historical-completed", "INVALID_TRANSITION"],
] as const) scenario(`PostgreSQL ${name} fails before writes`, async () => {
  const expected = parity[1], transaction = new PgTransaction(expected);
  const request = { ...structuredClone(expected.input) };
  if (name === "missing") transaction.aggregate = undefined;
  if (name === "revision-missing") transaction.revision = undefined;
  if (name === "foreign") transaction.revision!.task_pack_id = -1;
  if (name === "version-conflict") request.expectedLifecycleVersion = 2;
  if (name === "state-conflict") request.expectedReviewState = "in_review";
  if (name === "exhausted") { transaction.aggregate!.lifecycle_version = String(Number.MAX_SAFE_INTEGER); request.expectedLifecycleVersion = Number.MAX_SAFE_INTEGER; }
  if (name === "invalid-event") request.source = "wrong" as Input["source"];
  if (name === "corrupt-chain") transaction.events.push({ id: "broken", task_pack_id: request.taskPackId, revision_id: request.revisionId,
    event_type: "accepted", from_state: "in_review", to_state: "accepted", source: "migration", actor_id: null, created_at: new Date(stamp), metadata: null });
  if (name === "illegal") request.transition = { type: "request_changes" };
  if (name === "corrupt-pointer") transaction.aggregate!.current_revision_id = null;
  if (name === "historical-completed") Object.assign(transaction.aggregate!, { current_revision_id: 9999, accepted_revision_id: 9999,
    lifecycle_state: "completed", completed_at: new Date(stamp) });
  await withPg(transaction, pg => expectFailure(() => pg.transitionTaskPackRevisionReview(request), code(suffix)));
  assert.equal(transaction.queries.some(q => /^(UPDATE|INSERT)/.test(q.sql)), false);
  assert.equal(transaction.releases, 1); assert.equal(transaction.queries.at(-1)!.sql, "ROLLBACK");
});
for (const type of ["start_review", "request_changes"] as const) scenario(`PostgreSQL MAX_SAFE ${type} leaves aggregate unchanged`, async () => {
  const expected = parity[type === "start_review" ? 0 : 3], transaction = new PgTransaction(expected);
  transaction.aggregate!.lifecycle_version = String(Number.MAX_SAFE_INTEGER);
  const before = structuredClone(transaction.aggregate);
  const result = await withPg(transaction, pg => pg.transitionTaskPackRevisionReview({ ...expected.input, expectedLifecycleVersion: Number.MAX_SAFE_INTEGER }));
  assert.equal(result.aggregate.lifecycleVersion, Number.MAX_SAFE_INTEGER);
  assert.deepEqual(transaction.aggregate, before);
  assert.equal(transaction.queries.some(q => q.sql.startsWith("UPDATE")), false);
});
for (const version of [2147483647, Number.MAX_SAFE_INTEGER - 1]) scenario(`PostgreSQL BIGINT accept ${version} increments numerically`, async () => {
  const expected = parity[1], transaction = new PgTransaction(expected);
  transaction.aggregate!.lifecycle_version = String(version);
  assert.equal((await withPg(transaction, pg => pg.transitionTaskPackRevisionReview({ ...expected.input, expectedLifecycleVersion: version }))).aggregate.lifecycleVersion, version + 1);
});
for (const [name, createdAt, eventId, allowed] of [
  ["earlier", "2026-09-27T11:59:59.999Z", "z", false], ["equal smaller", stamp, "a", false],
  ["equal larger", stamp, "z", true], ["later", later, "a", true],
] as const) scenario(`PostgreSQL append order ${name} uses timestamp instant and SQL ID comparison`, async () => {
  const expected = parity[2], transaction = new PgTransaction(expected);
  transaction.events[0].id = "m";
  const request = { ...expected.input, createdAt, eventId };
  if (allowed) await withPg(transaction, pg => pg.transitionTaskPackRevisionReview(request));
  else {
    await withPg(transaction, pg => expectFailure(() => pg.transitionTaskPackRevisionReview(request), code("CONFLICT")));
    assert.equal(transaction.queries.some(q => /^(UPDATE|INSERT)/.test(q.sql)), false);
  }
});
scenario("PostgreSQL equal-instant ID tie-break delegates to database collation, not JS comparator", async () => {
  const expected = parity[2], transaction = new PgTransaction(expected, "", false, (a, b) => -binaryCompare(a, b));
  transaction.events[0].id = "m";
  await withPg(transaction, pg => pg.transitionTaskPackRevisionReview({ ...expected.input, createdAt: stamp, eventId: "a" }));
});
scenario("PostgreSQL whole-second timestamps return exact input spelling after instant validation", async () => {
  const expected = parity[1], transaction = new PgTransaction(expected), createdAt = "2026-09-27T12:00:00Z";
  const result = await withPg(transaction, pg => pg.transitionTaskPackRevisionReview({ ...expected.input, createdAt }));
  assert.equal(result.event.createdAt, createdAt); assert.equal(result.aggregate.updatedAt, createdAt);
});
scenario("source guards: shared domain workflow, CAS only on accept, no independent append or event mutation API", () => {
  const types = fs.readFileSync(new URL("./types.ts", import.meta.url), "utf8");
  assert.doesNotMatch(types, /(?:update|delete)TaskPackRevisionReviewEvent/);
  for (const name of ["SqliteStorageAdapter", "PostgresStorageAdapter"]) {
    const source = fs.readFileSync(new URL(`./${name}.ts`, import.meta.url), "utf8");
    const operation = source.slice(source.indexOf("  async transitionTaskPackRevisionReview("), source.indexOf("  async appendTaskPackRevisionReviewEvent("));
    assert.match(operation, /prepareTaskPackRevisionReviewTransition/); assert.match(operation, /validateTaskPackRevisionReviewTransitionResult/);
    assert.match(operation, /if \(input\.transition\.type === "accept"\)/);
    assert.doesNotMatch(operation, /this\.appendTaskPackRevisionReviewEvent|UPDATE task_pack_revisions|DELETE FROM|SET review_state|transitionTaskPackAggregateLifecycle/);
    if (name === "SqliteStorageAdapter") {
      assert.match(source, /BEGIN IMMEDIATE/); assert.match(operation, /this\.withTransaction/);
      assert.match(operation, /SELECT changes\(\) AS changed/); assert.match(operation, /changed\?\.changed !== 1/);
    } else { assert.doesNotMatch(operation, /pool\.query/); assert.match(operation, /updated\.rowCount !== 1/); }
  }
});

try {
  await adapter.ensureSchema(); db = (adapter as unknown as { db: Database }).db; databases.push(db);
  projectId = (await adapter.upsertScannedProject({ name: "Review transitions", localPath: path.join(root, "project"), packageManager: "npm",
    detectedStack: [], scripts: {}, readinessScore: 100, readinessReport: { score: 100, checks: [], issues: [] } })).id;
  for (const { name, run } of scenarios) { await run(); console.log(`PASS ${name}`); }
  console.log(`Task Pack revision review transition smoke: ${scenarios.length}/${scenarios.length} passed (real SQLite; PostgreSQL fake-client/source, no live PostgreSQL).`);
} finally {
  for (const database of databases) database.close();
  fs.rmSync(root, { recursive: true, force: true });
}
