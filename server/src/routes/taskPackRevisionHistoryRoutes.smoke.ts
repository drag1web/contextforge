import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import express, { Router } from "express";
import type { Database } from "sql.js";
import { SqliteStorageAdapter } from "../storage/SqliteStorageAdapter.js";
import { taskPackRevisionHistorySql } from "../storage/taskPackRevisionHistory.js";
import type { TaskPackRevisionContent, TaskPackRevision, TaskPackReviewState } from "../taskPacks/taskPackLifecycle.js";
import { createTaskPackApplicationService } from "../taskPacks/taskPackApplicationService.js";
import { createTaskPackRevisionHistoryApplicationService } from "../taskPacks/taskPackRevisionHistoryApplicationService.js";
import { registerTaskPackCurrentReadRoutes, registerTaskPackContentEditRoute } from "./taskPacks.js";
import { registerTaskPackWorkflowRoutes } from "./taskPackWorkflowRoutes.js";
import { registerTaskPackRevisionHistoryRoutes } from "./taskPackRevisionHistoryRoutes.js";

const scenarios: { name: string; run: () => void | Promise<void> }[] = [];
const scenario = (name: string, run: () => void | Promise<void>) => scenarios.push({ name, run });
const root = fs.mkdtempSync(path.join(os.tmpdir(), "contextforge-history-http-"));
const databasePath = path.join(root, "history.sqlite");
const storage = new SqliteStorageAdapter(databasePath);
await storage.ensureSchema();
const db = (storage as unknown as { db: Database }).db;
const project = await storage.upsertScannedProject({ name: "History HTTP fixture", localPath: root,
  packageManager: "npm", detectedStack: [], scripts: {}, readinessScore: 100,
  readinessReport: { score: 100, checks: [], issues: [] } });
const generatedAt = "2020-01-01T00:00:00.000Z";
const authored = { rawTask: " \tHistorical original task.\r\nPreserve spaces.\n  ",
  generatedPrompt: "\n  # Historical document\r\n\tKeep exact Markdown.  " };
function content(): TaskPackRevisionContent {
  return { ...authored, sourceKind: "generated", taskType: "tests", targetTool: "generic",
    generationMode: "template", generationModel: "fixture-model", generationMessage: "PRIVATE_MESSAGE",
    generationUsedFallback: false, generationDurationMs: 15, generationRecipe: { private: "PRIVATE_RECIPE" },
    diagnostics: { selector: { private: "PRIVATE_SELECTOR" }, generation: { private: "PRIVATE_GENERATION" },
      performance: { private: "PRIVATE_PERFORMANCE" } },
    groundedContextSnapshot: { schemaVersion: 1, selectorEngine: "legacy", selectorConfigurationFingerprint: null,
      repositoryObservationFingerprint: null, repositorySnapshotFingerprint: null, selectorSnapshotFingerprint: null,
      selectedFiles: [{ path: "src/private.ts", role: "reference", usage: "inspect-only", evidenceStrength: "reference",
        proofClasses: ["inventory_exact"] }] },
    freshnessBasis: { schemaVersion: 1, stateAtCreation: "unknown", projectAwarenessFingerprint: null,
      inventoryFingerprint: null, policyVersion: "PRIVATE_POLICY", comparisonLimited: true, observedAt: null, previousObservedAt: null },
  };
}
async function create(title: string) {
  const pack = await storage.createTaskPackWithInitialRevision({ projectId: project.id, title, generatedAt,
    revisionContent: content(), compatibilityGenerationRecipe: { private: "PRIVATE_FLAT_RECIPE" } });
  return { pack, revision: (await storage.getCurrentTaskPackRevision(pack.id))! };
}
// Interleaving global identities makes revisionNumber !== revision.id observable.
const foreign = await create("Foreign pack");
const { pack, revision: historical } = await create("Requested pack");
let reviewSequence = 0;
async function review(revisionId: number, action: "start_review" | "accept", state: TaskPackReviewState) {
  const aggregate = (await storage.getTaskPackAggregate(pack.id))!;
  await storage.transitionTaskPackRevisionReview({ taskPackId: pack.id, revisionId, transition: { type: action },
    expectedLifecycleVersion: aggregate.lifecycleVersion, expectedReviewState: state, eventId: `fixture-review-${++reviewSequence}`,
    source: "user", actorId: "PRIVATE_ACTOR", metadata: { private: "PRIVATE_METADATA" },
    createdAt: new Date(Date.UTC(2030, 0, 1) + reviewSequence * 1000).toISOString() });
}
await review(historical.id, "start_review", "unreviewed");
await review(historical.id, "accept", "in_review");
const current = await storage.appendTaskPackRevision({ ...content(), taskPackId: pack.id, baseRevisionId: historical.id,
  sourceKind: "manual_edit", rawTask: "  Current task\n ", generatedPrompt: " Current document\r\n ",
  createdAt: "2031-01-01T00:00:00.000Z", generatedAt: null });
const historyService = createTaskPackRevisionHistoryApplicationService(storage);
let eventSequence = 0;
const workflowService = createTaskPackApplicationService(storage, {
  now: () => new Date(Date.UTC(2032, 0, 1) + eventSequence * 1000).toISOString(),
  createEventId: () => `http-review-${++eventSequence}`,
});
const app = express(); app.use(express.json());
const router = Router();
// Match production registration order, including the earlier GET /:id route.
registerTaskPackCurrentReadRoutes(router, workflowService);
registerTaskPackContentEditRoute(router, workflowService);
registerTaskPackWorkflowRoutes(router, workflowService);
registerTaskPackRevisionHistoryRoutes(router, historyService);
app.use("/api/task-packs", router);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/task-packs`;
async function request(route: string, method = "GET", body?: unknown) {
  const response = await fetch(`${base}${route}`, { method, headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  return { status: response.status, body: response.headers.get("content-type")?.includes("application/json") ? JSON.parse(text) : text };
}
const listPath = `/${pack.id}/revisions`, oldPath = `${listPath}/${historical.id}`, currentPath = `${listPath}/${current.id}`;
const invalid = { status: 400, body: { ok: false, code: "TASK_PACK_REVISION_HISTORY_INPUT_INVALID",
  message: "Task Pack revision history input is invalid." } };
const missingList = { status: 404, body: { ok: false, code: "TASK_PACK_NOT_FOUND", message: "Task Pack not found." } };
const missingDetail = { status: 404, body: { ok: false, code: "TASK_PACK_REVISION_NOT_FOUND", message: "Task Pack revision not found." } };
const corruptResponse = { status: 500, body: { ok: false, code: "TASK_PACK_REVISION_HISTORY_STATE_INVALID",
  message: "Task Pack revision history is invalid." } };
const failedResponse = { status: 500, body: { ok: false, code: "TASK_PACK_REVISION_HISTORY_FAILED",
  message: "Failed to read Task Pack revision history." } };
const metadataKeys = ["id", "revisionNumber", "baseRevisionId", "sourceKind", "createdAt", "generatedAt", "contentHash",
  "generationMode", "generationModel", "generationUsedFallback", "reviewState"];
const detailKeys = [...metadataKeys, "rawTask", "taskType", "targetTool", "generatedPrompt"];
function metadata(revision: TaskPackRevision, reviewState: TaskPackReviewState) {
  return { id: revision.id, revisionNumber: revision.revisionNumber, baseRevisionId: revision.baseRevisionId,
    sourceKind: revision.sourceKind, createdAt: revision.createdAt, generatedAt: revision.generatedAt, contentHash: revision.contentHash,
    generationMode: revision.generationMode, generationModel: revision.generationModel,
    generationUsedFallback: revision.generationUsedFallback, reviewState };
}
function assertPrivacy(value: unknown, list = false) {
  const forbidden = new Set(["lifecycle", "lifecycleVersion", "acceptedRevisionId", "completedAt", "archivedAt", "expectedLifecycleVersion",
    "expectedReviewState", "expectedCurrentRevisionId", "reviewEvents", "actorId", "metadata", "eventId", "events", "source",
    "diagnostics", "generationRecipe", "groundedContextSnapshot", "freshnessBasis", "generationMessage", "generationDurationMs",
    "stack", "cause", "projectId", "title", ...(list ? ["rawTask", "generatedPrompt"] : [])]);
  function inspect(node: unknown) {
    if (!node || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) { assert.equal(forbidden.has(key), false, `Forbidden public key: ${key}`); inspect(child); }
  }
  inspect(value);
  assert.doesNotMatch(JSON.stringify(value), /PRIVATE_|src\/private/);
}
function rows(sql: string) {
  const stmt = db.prepare(sql);
  try { const result = []; while (stmt.step()) result.push(stmt.getAsObject()); return result; }
  finally { stmt.free(); }
}
function persistence() {
  return ["task_packs", "task_pack_revisions", "task_pack_revision_review_events", "task_pack_lifecycle_events"]
    .map(table => rows(`SELECT * FROM ${table} ORDER BY 1`));
}
scenario("history route returns exact existing 06A metadata-only envelope", async () => {
  assert.deepEqual(await request(listPath), { status: 200, body: { ok: true, history: { taskPackId: pack.id,
    currentRevisionId: current.id, revisions: [metadata(historical, "accepted"), metadata(current, "unreviewed")] } } });
});
scenario("history response runtime whitelist has no document bodies or private nested fields", async () => {
  const { body } = await request(listPath);
  assert.deepEqual(Object.keys(body).sort(), ["ok", "history"].sort());
  assert.deepEqual(Object.keys(body.history).sort(), ["taskPackId", "currentRevisionId", "revisions"].sort());
  for (const revision of body.history.revisions) assert.deepEqual(Object.keys(revision).sort(), [...metadataKeys].sort());
  assertPrivacy(body, true);
});
scenario("historical detail route returns exact closed envelope with authored bodies", async () => {
  assert.deepEqual(await request(oldPath), { status: 200, body: { ok: true, revision: { taskPackId: pack.id,
    currentRevisionId: current.id, revision: { ...metadata(historical, "accepted"), ...authored,
      taskType: "tests", targetTool: "generic" } } } });
});
scenario("current detail route returns current content and unreviewed state, not historical acceptance", async () => {
  const { status, body } = await request(currentPath);
  assert.equal(status, 200); assert.equal(body.revision.revision.rawTask, current.rawTask);
  assert.equal(body.revision.revision.generatedPrompt, current.generatedPrompt);
  assert.equal(body.revision.revision.reviewState, "unreviewed");
  assert.notEqual(body.revision.revision.id, body.revision.revision.revisionNumber);
});
scenario("detail preserves historical whitespace, CRLF and identity versus revisionNumber", async () => {
  const { body } = await request(oldPath), revision = body.revision.revision;
  assert.equal(revision.rawTask, authored.rawTask); assert.equal(revision.generatedPrompt, authored.generatedPrompt);
  assert.equal(revision.id, historical.id); assert.equal(revision.revisionNumber, 1); assert.notEqual(revision.id, revision.revisionNumber);
  assert.notEqual(revision.rawTask, revision.rawTask.trim());
});
scenario("detail response recursive privacy/whitelist excludes lifecycle, CAS, diagnostics, recipe and events", async () => {
  const { body } = await request(oldPath);
  assert.deepEqual(Object.keys(body).sort(), ["ok", "revision"].sort());
  assert.deepEqual(Object.keys(body.revision).sort(), ["taskPackId", "currentRevisionId", "revision"].sort());
  assert.deepEqual(Object.keys(body.revision.revision).sort(), [...detailKeys].sort());
  assertPrivacy(body);
});
const invalidSegments = ["0", "-1", "1.5", "NaN", "12abc", "9007199254740992", "1e2", "+1", "01", " 1", "1 ", " ", "Infinity",
  "1\n", "1\r\n", "\t1", "1\t"];
for (const id of invalidSegments) scenario(`history/detail malformed Task Pack id ${JSON.stringify(id)} is 400 without storage access`, async () => {
  const prepare = db.prepare;
  db.prepare = (() => { throw new Error("malformed IDs must not reach storage"); }) as typeof db.prepare;
  try {
    const encoded = encodeURIComponent(id);
    assert.deepEqual(await request(`/${encoded}/revisions`), invalid);
    assert.deepEqual(await request(`/${encoded}/revisions/${historical.id}`), invalid);
  } finally { db.prepare = prepare; }
});
for (const id of invalidSegments) scenario(`detail malformed revision id ${JSON.stringify(id)} is 400 without storage access`, async () => {
  const prepare = db.prepare;
  db.prepare = (() => { throw new Error("malformed revision IDs must not reach storage"); }) as typeof db.prepare;
  try { assert.deepEqual(await request(`${listPath}/${encodeURIComponent(id)}`), invalid); }
  finally { db.prepare = prepare; }
});
scenario("history missing Task Pack is safe 404", async () => {
  assert.deepEqual(await request("/987654/revisions"), missingList);
});
scenario("detail missing Task Pack is safe 404", async () => {
  assert.deepEqual(await request(`/987654/revisions/${historical.id}`), missingDetail);
});
scenario("detail missing revision is safe 404", async () => {
  assert.deepEqual(await request(`${listPath}/987654`), missingDetail);
});
scenario("cross-pack globally existing revision is indistinguishable from absent revision", async () => {
  assert.deepEqual(await request(`${listPath}/${foreign.revision.id}`), missingDetail);
  assert.deepEqual(await request(`/${foreign.pack.id}/revisions/${historical.id}`), missingDetail);
});
scenario("MAX_SAFE integer paths are valid identities, not malformed inputs", async () => {
  assert.deepEqual(await request(`/${Number.MAX_SAFE_INTEGER}/revisions`), missingList);
  assert.deepEqual(await request(`${listPath}/${Number.MAX_SAFE_INTEGER}`), missingDetail);
});
async function withCorruption(sql: string, check: () => Promise<void>) {
  const before = persistence(), file = fs.readFileSync(databasePath);
  db.run("PRAGMA foreign_keys = OFF; PRAGMA ignore_check_constraints = ON; SAVEPOINT http_history_corruption;");
  try {
    db.run("DROP TRIGGER task_pack_revisions_immutable; DROP TRIGGER task_pack_revision_review_events_immutable; DROP TRIGGER task_packs_revision_pointer_ownership_update;");
    db.run(sql);
    const corrupted = persistence();
    await check(); assert.deepEqual(persistence(), corrupted, "HTTP reads must not repair persistence");
    assert.deepEqual(fs.readFileSync(databasePath), file, "HTTP reads must not persist sql.js");
  } finally {
    db.run("ROLLBACK TO http_history_corruption; RELEASE http_history_corruption; PRAGMA ignore_check_constraints = OFF; PRAGMA foreign_keys = ON;");
  }
  assert.deepEqual(persistence(), before);
}
for (const [kind, sql] of [
  ["historical hash", `UPDATE task_pack_revisions SET raw_task = 'private SQL corruption' WHERE id = ${historical.id}`],
  ["historical review prefix", `UPDATE task_pack_revision_review_events SET from_state = 'in_review' WHERE revision_id = ${historical.id} AND event_type = 'review_started'`],
  ["aggregate current pointer", `UPDATE task_packs SET current_revision_id = 987654 WHERE id = ${pack.id}`],
] as const) scenario(`actual storage/service ${kind} corruption yields safe 500 for list AND detail`, async () => {
  await withCorruption(sql, async () => {
    for (const route of [listPath, oldPath, currentPath]) {
      const response = await request(route); assert.deepEqual(response, corruptResponse);
      assert.doesNotMatch(JSON.stringify(response), /SQL|driver|private|stack|cause|constraint|sha256/i);
    }
  });
});
scenario("actual driver failure stays operational through storage/service and is sanitized at HTTP", async () => {
  const prepare = db.prepare; let calls = 0;
  const error = new Error("private SQL driver constraint details", { cause: new Error("private cause") });
  db.prepare = (() => { calls++; throw error; }) as typeof db.prepare;
  try {
    for (const route of [listPath, oldPath]) {
      const response = await request(route); assert.deepEqual(response, failedResponse);
      assert.doesNotMatch(JSON.stringify(response), /SQL|driver|private|stack|cause|constraint|sha256/i);
    }
    assert.equal(calls, 2, "each HTTP request tries exactly one read, no automatic retry");
  } finally { db.prepare = prepare; }
});
scenario("HTTP list/detail each use one snapshot SQL with no write, event or timestamp changes", async () => {
  const before = persistence(), file = fs.readFileSync(databasePath), prepare = db.prepare, run = db.run;
  const queries: string[] = [];
  db.prepare = ((query, ...args) => { queries.push(String(query)); return prepare.call(db, query, ...args); }) as typeof db.prepare;
  db.run = (() => { throw new Error("history HTTP must not execute writes"); }) as typeof db.run;
  try {
    assert.equal((await request(listPath)).status, 200); assert.equal((await request(oldPath)).status, 200);
    assert.equal((await request(currentPath)).status, 200);
  } finally { db.prepare = prepare; db.run = run; }
  assert.deepEqual(queries, Array(3).fill(taskPackRevisionHistorySql("?")));
  assert.deepEqual(persistence(), before); assert.deepEqual(fs.readFileSync(databasePath), file);
  assert.equal(rows("PRAGMA foreign_keys")[0].foreign_keys, 1);
});
scenario("existing GET collection and current single read remain reachable and unchanged", async () => {
  const single = await request(`/${pack.id}`), collection = await request("");
  assert.deepEqual(single, { status: 200, body: { ok: true, taskPack: await workflowService.getCurrentTaskPack(pack.id) } });
  assert.deepEqual(collection, { status: 200, body: { ok: true, taskPacks: await workflowService.listCurrentTaskPacks() } });
});
scenario("existing current workflow and static workflow index routes coexist with history GETs", async () => {
  const response = await request(`/${pack.id}/workflow`);
  assert.deepEqual(response, { status: 200, body: { ok: true, workflow: await workflowService.getCurrentTaskPackWorkflowState(pack.id) } });
  assert.ok(response.body.workflow);
  assert.equal(response.body.workflow.currentReviewState, "unreviewed");
  assert.equal((await request("/workflows/current")).status, 200);
});
scenario("no historical editing/restoring/promoting/comparison endpoint is introduced", async () => {
  for (const method of ["POST", "PATCH", "PUT", "DELETE"]) assert.equal((await request(oldPath, method)).status, 404);
  const source = fs.readFileSync(new URL("./taskPackRevisionHistoryRoutes.ts", import.meta.url), "utf8");
  assert.equal((source.match(/router\.get\(/g) ?? []).length, 2);
  assert.doesNotMatch(source, /router\.(?:post|patch|put|delete)\(|storage|deriveTaskPack|compare|restore|revert|promote/);
});
scenario("production router registers the focused history service after existing read/workflow routes", () => {
  const source = fs.readFileSync(new URL("./taskPacks.ts", import.meta.url), "utf8");
  assert.match(source, /registerTaskPackRevisionHistoryRoutes\(taskPacksRouter, createTaskPackRevisionHistoryApplicationService\(storage\)\)/);
  assert.ok(source.indexOf("registerTaskPackCurrentReadRoutes(taskPacksRouter") < source.indexOf("registerTaskPackRevisionHistoryRoutes(taskPacksRouter"));
  assert.ok(source.indexOf("registerTaskPackWorkflowRoutes(taskPacksRouter") < source.indexOf("registerTaskPackRevisionHistoryRoutes(taskPacksRouter"));
});
scenario("existing review-event mutation route works after history route registration", async () => {
  const aggregate = (await storage.getTaskPackAggregate(pack.id))!;
  const response = await request(`${currentPath}/review-events`, "POST", {
    expectedLifecycleVersion: aggregate.lifecycleVersion, expectedReviewState: "unreviewed", action: "start_review",
  });
  assert.equal(response.status, 200); assert.equal(response.body.reviewState, "in_review");
  assert.equal(response.body.aggregate.lifecycle.state, "active");
  assert.equal((await request(currentPath)).body.revision.revision.reviewState, "in_review");
});
scenario("accept mutation does not complete and both historical revisions replay accepted independently", async () => {
  const aggregate = (await storage.getTaskPackAggregate(pack.id))!;
  const response = await request(`${currentPath}/review-events`, "POST", {
    expectedLifecycleVersion: aggregate.lifecycleVersion, expectedReviewState: "in_review", action: "accept",
  });
  assert.equal(response.status, 200); assert.equal(response.body.aggregate.lifecycle.state, "active");
  const list = await request(listPath);
  assert.deepEqual(list.body.history.revisions.map((r: { reviewState: string }) => r.reviewState), ["accepted", "accepted"]);
  assert.equal((await request(oldPath)).body.revision.revision.reviewState, "accepted");
  assertPrivacy(list.body, true);
});
scenario("existing content edit route appends a new current revision without changing historical detail", async () => {
  const old = await request(oldPath);
  const response = await request(`/${pack.id}/content`, "PATCH", { expectedCurrentRevisionId: current.id, generatedPrompt: "Updated current document" });
  assert.equal(response.status, 200); assert.notEqual(response.body.taskPack.currentRevisionId, current.id);
  const history = await request(listPath);
  assert.equal(history.body.history.revisions.length, 3); assertPrivacy(history.body, true);
  const after = await request(oldPath);
  assert.equal(after.body.revision.currentRevisionId, response.body.taskPack.currentRevisionId);
  assert.deepEqual(after.body.revision.revision, old.body.revision.revision);
  assert.equal((await request(`/${pack.id}/workflow`)).body.workflow.currentReviewState, "unreviewed");
});

try {
  for (const { name, run } of scenarios) { await run(); console.log(`PASS ${name}`); }
  console.log(`Task Pack revision history HTTP smoke: ${scenarios.length}/${scenarios.length} passed (real HTTP/application/SQLite).`);
} finally {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  db.close(); fs.rmSync(root, { recursive: true, force: true });
}
