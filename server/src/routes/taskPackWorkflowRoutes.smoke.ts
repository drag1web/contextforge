import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import express, { Router } from "express";
import { registerTaskPackWorkflowRoutes, type TaskPackWorkflowService } from "./taskPackWorkflowRoutes.js";
import { registerTaskPackCurrentReadRoutes, registerTaskPackContentEditRoute } from "./taskPacks.js";
import {
  createTaskPackApplicationService, TaskPackCurrentStateError, TaskPackWorkflowApplicationError,
  type TaskPackWorkflowApplicationErrorCode, type TaskPackLifecycleCommandInput,
  type TaskPackRevisionReviewCommandInput,
  type TaskPackApplicationServiceStorage,
} from "../taskPacks/taskPackApplicationService.js";
import { SqliteStorageAdapter } from "../storage/SqliteStorageAdapter.js";

const scenarios: { name: string; run: () => void | Promise<void> }[] = [];
const scenario = (name: string, run: () => void | Promise<void>) => scenarios.push({ name, run });
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "contextforge-workflow-http-"));
const storage = new SqliteStorageAdapter(path.join(temporaryRoot, "workflow.sqlite"));
await storage.ensureSchema();
const project = await storage.upsertScannedProject({ name: "HTTP workflow fixture", localPath: temporaryRoot,
  packageManager: "npm", detectedStack: [], scripts: {}, readinessScore: 100,
  readinessReport: { score: 100, checks: [], issues: [] } });
const pack = await storage.createTaskPack({ projectId: project.id, title: "Workflow HTTP fixture",
  rawTask: "Private authored task", taskType: "tests", targetTool: "codex", generatedPrompt: "Private prompt",
  generationMode: "template", generationModel: null, generationMessage: null, generationUsedFallback: false,
  generationDurationMs: null, generationRecipe: { template: "private recipe" } });
const current = (await storage.getTaskPackCurrentRecordById(pack.id))!;
const aggregate = (await storage.getTaskPackAggregate(pack.id))!;
const revision = (await storage.getTaskPackRevisionById(pack.id, current.currentRevisionId))!;
const workflow = { taskPackId: pack.id, lifecycle: aggregate.lifecycle, lifecycleVersion: 1,
  currentRevisionId: revision.id, acceptedRevisionId: null, completedAt: null, archivedAt: null,
  currentReviewState: "unreviewed" as const };
const at = "2030-01-01T00:00:00.000Z";
const eventFields = { id: "server-event", taskPackId: pack.id, source: "user" as const,
  actorId: null, metadata: null, createdAt: at };
let failure: Error | null = null;
let missing = false;
const calls: unknown[] = [];
const service: TaskPackWorkflowService = {
  async getCurrentTaskPackWorkflowState(id) {
    calls.push(id);
    if (failure) throw failure;
    return missing ? null : workflow;
  },
  async transitionTaskPackLifecycle(input) {
    calls.push(input);
    if (failure) throw failure;
    const state = input.action === "complete" ? "completed" : input.action === "archive" ? "archived" : "active";
    const lifecycle = state === "archived" ? { state, archivedFromState: "active" } as const : { state, archivedFromState: null } as const;
    return { aggregate: { ...aggregate, lifecycle, lifecycleVersion: input.expectedLifecycleVersion + 1 },
      event: { ...eventFields, eventType: ({ complete: "completed", reopen: "reopened", archive: "archived", unarchive: "unarchived" } as const)[input.action],
        fromState: "active", toState: state, revisionId: input.action === "complete" ? revision.id : null } };
  },
  async transitionTaskPackRevisionReview(input) {
    calls.push(input);
    if (failure) throw failure;
    const reviewState = ({ start_review: "in_review", accept: "accepted", request_changes: "changes_requested" } as const)[input.action];
    return { aggregate, revision, reviewState, event: { ...eventFields, revisionId: revision.id,
      eventType: ({ start_review: "review_started", accept: "accepted", request_changes: "changes_requested" } as const)[input.action],
      fromState: input.expectedReviewState, toState: reviewState } };
  },
};
const app = express();
app.use(express.json({ strict: false }));
const router = Router();
registerTaskPackCurrentReadRoutes(router, { listCurrentTaskPacks: async () => [current], getCurrentTaskPack: async () => current });
registerTaskPackContentEditRoute(router, { editTaskPackContent: async input => {
  assert.equal(input.expectedCurrentRevisionId, current.currentRevisionId);
  return { ...current, rawTask: input.rawTask ?? current.rawTask };
} });
registerTaskPackWorkflowRoutes(router, service);
app.use("/api/task-packs", router);
let sequence = 0;
const realService = createTaskPackApplicationService(storage, {
  now: () => new Date(Date.UTC(2030, 0, 1) + sequence * 1000).toISOString(),
  createEventId: () => `http-event-${++sequence}`,
});
const realRouter = Router();
registerTaskPackWorkflowRoutes(realRouter, realService);
app.use("/real/task-packs", realRouter);
// Real application boundary with controlled storage reads (not a throwing fake service).
const readDependencies = ["getTaskPackCurrentRecordById", "getTaskPackAggregate",
  "getTaskPackRevisionById", "listTaskPackRevisionReviewEvents"] as const;
let failedRead: typeof readDependencies[number] | null = null;
let corruptRead: "aggregate" | "revision" | "history" | null = null;
let failedReadCalls = 0;
function checkRead(dependency: typeof readDependencies[number]): void {
  if (failedRead === dependency) {
    failedReadCalls++;
    throw new Error("private SQL driver details", { cause: new Error("private cause") });
  }
}
const unexpectedWrite = async (): Promise<never> => { throw new Error("Read must not write"); };
const readStorage: TaskPackApplicationServiceStorage = {
  listTaskPackCurrentRecords: async () => [current],
  getTaskPackCurrentRecordById: async () => { checkRead("getTaskPackCurrentRecordById"); return current; },
  getTaskPackAggregate: async () => {
    checkRead("getTaskPackAggregate");
    return corruptRead === "aggregate" ? { ...aggregate, lifecycleVersion: 0 } : aggregate;
  },
  getTaskPackRevisionById: async () => {
    checkRead("getTaskPackRevisionById");
    return corruptRead === "revision" ? { ...revision, rawTask: "tampered" } : revision;
  },
  listTaskPackRevisionReviewEvents: async () => {
    checkRead("listTaskPackRevisionReviewEvents");
    return corruptRead === "history" ? [{ ...eventFields, revisionId: revision.id,
      eventType: "accepted", fromState: "in_review", toState: "accepted" }] : [];
  },
  createTaskPackWithInitialRevision: unexpectedWrite,
  appendTaskPackRevision: unexpectedWrite,
  getTaskPackGitHubCreatedIssueLink: async () => null,
  createTaskPackGitHubCreatedIssueLink: unexpectedWrite,
  transitionTaskPackAggregateLifecycle: unexpectedWrite,
  transitionTaskPackRevisionReview: unexpectedWrite,
};
const readBoundaryRouter = Router();
registerTaskPackWorkflowRoutes(readBoundaryRouter, createTaskPackApplicationService(readStorage));
app.use("/read-boundary/task-packs", readBoundaryRouter);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
async function request(route: string, body?: unknown, method = body === undefined ? "GET" : "POST", prefix = "/api/task-packs") {
  const response = await fetch(`${base}${prefix}${route}`, { method,
    headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
const lifecyclePath = `/${pack.id}/transitions`;
const reviewPath = `/${pack.id}/revisions/${revision.id}/review-events`;
const lifecycleBody = { expectedLifecycleVersion: 1, action: "archive" };
const reviewBody = { expectedLifecycleVersion: 1, expectedReviewState: "unreviewed", action: "start_review" };

scenario("workflow GET returns compact projection without authored content", async () => {
  assert.deepEqual(await request(`/${pack.id}/workflow`), { status: 200, body: { ok: true, workflow } });
  assert.deepEqual(Object.keys(workflow).sort(), ["taskPackId", "lifecycle", "lifecycleVersion", "currentRevisionId", "acceptedRevisionId", "completedAt", "archivedAt", "currentReviewState"].sort());
  assert.doesNotMatch(JSON.stringify(workflow), /rawTask|generatedPrompt|generationRecipe|diagnostics|Private/);
});
scenario("workflow GET missing is 404", async () => {
  missing = true;
  try { const response = await request(`/${pack.id}/workflow`); assert.equal(response.status, 404); assert.equal(response.body.code, "TASK_PACK_NOT_FOUND"); }
  finally { missing = false; }
});
for (const action of ["complete", "reopen", "archive", "unarchive"] as const) scenario(`lifecycle ${action} HTTP success forwards exact command`, async () => {
  const response = await request(lifecyclePath, { expectedLifecycleVersion: 3, action });
  assert.equal(response.status, 200);
  assert.deepEqual(calls.at(-1), { taskPackId: pack.id, expectedLifecycleVersion: 3, action } satisfies TaskPackLifecycleCommandInput);
  assert.deepEqual(Object.keys(response.body).sort(), ["ok", "aggregate", "event"].sort());
});
for (const action of ["start_review", "accept", "request_changes"] as const) scenario(`review ${action} HTTP success forwards exact command`, async () => {
  const response = await request(reviewPath, { ...reviewBody, action });
  assert.equal(response.status, 200);
  assert.deepEqual(calls.at(-1), { taskPackId: pack.id, revisionId: revision.id, ...reviewBody, action } as TaskPackRevisionReviewCommandInput);
  assert.deepEqual(Object.keys(response.body).sort(), ["ok", "aggregate", "revision", "reviewState", "event"].sort());
  assert.equal(response.body.aggregate.lifecycle.state, "active");
});

for (const invalid of ["0", "-1", "1.5", "9007199254740992", "1e2", "01", "+1", " 1", "1 ", "junk"]) {
  scenario(`all workflow path IDs reject ${JSON.stringify(invalid)}`, async () => {
    const id = encodeURIComponent(invalid), count = calls.length;
    for (const response of [await request(`/${id}/workflow`), await request(`/${id}/transitions`, lifecycleBody),
      await request(`/${id}/revisions/1/review-events`, reviewBody), await request(`/1/revisions/${id}/review-events`, reviewBody)]) assert.equal(response.status, 400);
    assert.equal(calls.length, count);
  });
}
for (const [route, body] of [[lifecyclePath, lifecycleBody], [reviewPath, reviewBody]] as const) {
  scenario(`${route} rejects invalid provided lifecycle tokens`, async () => {
    const count = calls.length;
    for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1", null, false, {}, []]) {
      const response = await request(route, { ...body, expectedLifecycleVersion: value });
      assert.equal(response.status, 400);
      assert.equal(response.body.code, "TASK_PACK_WORKFLOW_INVALID");
    }
    assert.equal(calls.length, count);
  });
  scenario(`${route} rejects unknown fields and client event authority`, async () => {
    const count = calls.length;
    for (const field of ["eventId", "createdAt", "metadata", "actorId", "source", "targetState", "toState", "acceptedRevisionId", "extra"]) {
      assert.equal((await request(route, { ...body, [field]: "private client value" })).status, 400);
    }
    assert.equal(calls.length, count);
  });
  scenario(`${route} rejects non-object bodies`, async () => {
    const count = calls.length;
    for (const body of [null, [], "text", 3, false]) assert.equal((await request(route, body)).status, 400);
    assert.equal(calls.length, count);
  });
}
scenario("lifecycle missing precondition returns stable 428", async () => {
  const response = await request(lifecyclePath, { action: "archive" });
  assert.equal(response.status, 428);
  assert.equal(response.body.code, "TASK_PACK_LIFECYCLE_PRECONDITION_REQUIRED");
});
scenario("review either or both absent preconditions return stable 428", async () => {
  for (const body of [{ action: "accept" }, { action: "accept", expectedReviewState: "unreviewed" }, { action: "accept", expectedLifecycleVersion: 1 }]) {
    const response = await request(reviewPath, body);
    assert.equal(response.status, 428);
    assert.equal(response.body.code, "TASK_PACK_REVIEW_PRECONDITION_REQUIRED");
  }
});
scenario("malformed review state and unsupported actions return 400", async () => {
  for (const expectedReviewState of [null, 1, "", "unknown", {}, []]) assert.equal((await request(reviewPath, { ...reviewBody, expectedReviewState })).status, 400);
  for (const action of [null, 1, "unknown", {}]) {
    assert.equal((await request(lifecyclePath, { ...lifecycleBody, action })).status, 400);
    assert.equal((await request(reviewPath, { ...reviewBody, action })).status, 400);
  }
});

const statusByCode: Partial<Record<TaskPackWorkflowApplicationErrorCode, number>> = {
  TASK_PACK_WORKFLOW_INVALID: 400,
  TASK_PACK_LIFECYCLE_NOT_FOUND: 404, TASK_PACK_LIFECYCLE_CONFLICT: 409,
  TASK_PACK_LIFECYCLE_INVALID_TRANSITION: 409, TASK_PACK_LIFECYCLE_VERSION_EXHAUSTED: 409,
  TASK_PACK_LIFECYCLE_EVENT_EXISTS: 409, TASK_PACK_LIFECYCLE_STATE_INVALID: 500,
  TASK_PACK_REVIEW_NOT_FOUND: 404, TASK_PACK_REVIEW_REVISION_NOT_FOUND: 404,
  TASK_PACK_REVIEW_CONFLICT: 409, TASK_PACK_REVIEW_INVALID_TRANSITION: 409,
  TASK_PACK_REVIEW_VERSION_EXHAUSTED: 409, TASK_PACK_REVIEW_EVENT_EXISTS: 409, TASK_PACK_REVIEW_STATE_INVALID: 500,
};
for (const [code, status] of Object.entries(statusByCode)) scenario(`HTTP safely maps ${code} to ${status}`, async () => {
  const review = code.startsWith("TASK_PACK_REVIEW_");
  const evidence = code.endsWith("_CONFLICT") ? { taskPackId: pack.id, expectedLifecycleVersion: 4, actualLifecycleVersion: 5,
    ...(review ? { revisionId: revision.id, expectedReviewState: "unreviewed" as const, actualReviewState: "in_review" as const } : {}) } : {};
  failure = new TaskPackWorkflowApplicationError(code as TaskPackWorkflowApplicationErrorCode, evidence);
  Object.assign(failure, { cause: new Error("private SQL constraint"), secret: "private source" });
  try {
    const response = await request(review ? reviewPath : lifecyclePath, review ? reviewBody : lifecycleBody);
    assert.equal(response.status, status);
    assert.deepEqual(response.body, { ok: false, code, message: failure.message, ...evidence });
    assert.doesNotMatch(JSON.stringify(response.body), /SQL|constraint|private|stack|cause|secret/);
  } finally { failure = null; }
});
scenario("workflow GET corrupt current state is safe stable 500", async () => {
  failure = new TaskPackCurrentStateError();
  try { assert.deepEqual(await request(`/${pack.id}/workflow`), { status: 500, body: { ok: false, code: "TASK_PACK_CURRENT_STATE_INVALID", message: "Task Pack current state is invalid." } }); }
  finally { failure = null; }
});
scenario("all workflow routes hide unexpected SQL/driver/stack details", async () => {
  failure = new Error("private SQL constraint driver secret");
  try {
    for (const response of [await request(`/${pack.id}/workflow`), await request(lifecyclePath, lifecycleBody), await request(reviewPath, reviewBody)]) {
      assert.deepEqual(response, { status: 500, body: { ok: false, code: "TASK_PACK_WORKFLOW_FAILED", message: "Task Pack workflow operation failed." } });
    }
  } finally { failure = null; }
});
for (const dependency of readDependencies) scenario(`real service HTTP ${dependency} failure is generic and private`, async () => {
  failedRead = dependency;
  failedReadCalls = 0;
  try {
    const response = await request(`/${pack.id}/workflow`, undefined, "GET", "/read-boundary/task-packs");
    assert.deepEqual(response, { status: 500, body: { ok: false, code: "TASK_PACK_WORKFLOW_FAILED",
      message: "Task Pack workflow operation failed." } });
    assert.doesNotMatch(JSON.stringify(response.body), /SQL|driver|private|stack|cause/i);
    assert.equal(failedReadCalls, 1);
  } finally { failedRead = null; }
});
for (const corruption of ["aggregate", "revision", "history"] as const) scenario(`real service HTTP corrupt ${corruption} is current-state invalid`, async () => {
  corruptRead = corruption;
  try {
    const response = await request(`/${pack.id}/workflow`, undefined, "GET", "/read-boundary/task-packs");
    assert.deepEqual(response, { status: 500, body: { ok: false, code: "TASK_PACK_CURRENT_STATE_INVALID",
      message: "Task Pack current state is invalid." } });
    assert.doesNotMatch(JSON.stringify(response.body), /SQL|driver|private|stack|cause/i);
  } finally { corruptRead = null; }
});
scenario("existing flat list/detail/content edit coexist unchanged", async () => {
  assert.deepEqual((await request("")).body, { ok: true, taskPacks: [current] });
  assert.deepEqual((await request(`/${pack.id}`)).body, { ok: true, taskPack: current });
  const response = await request(`/${pack.id}/content`, { expectedCurrentRevisionId: revision.id, rawTask: "Edited text" }, "PATCH");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ok: true, taskPack: { ...current, rawTask: "Edited text" } });
  assert.equal((await request(`/${pack.id}/content`, { rawTask: "Missing token" }, "PATCH")).status, 428);
});
scenario("real HTTP/service/SQLite review acceptance remains active until explicit complete", async () => {
  const send = (route: string, body?: unknown) => request(route, body, body === undefined ? "GET" : "POST", "/real/task-packs");
  assert.equal((await send(`/${pack.id}/workflow`)).body.workflow.currentReviewState, "unreviewed");
  assert.equal((await send(reviewPath, reviewBody)).status, 200);
  const accepted = await send(reviewPath, { expectedLifecycleVersion: 1, expectedReviewState: "in_review", action: "accept" });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.aggregate.lifecycle.state, "active");
  assert.equal(accepted.body.aggregate.lifecycleVersion, 2);
  assert.equal(accepted.body.event.source, "user");
  assert.equal(accepted.body.event.actorId, null);
  assert.equal(accepted.body.event.metadata, null);
  const reviewConflict = await send(reviewPath, { expectedLifecycleVersion: 2, expectedReviewState: "in_review", action: "accept" });
  assert.equal(reviewConflict.status, 409);
  assert.equal(reviewConflict.body.code, "TASK_PACK_REVIEW_CONFLICT");
  assert.equal(reviewConflict.body.expectedReviewState, "in_review");
  assert.equal(reviewConflict.body.actualReviewState, "accepted");
  assert.equal(reviewConflict.body.revisionId, revision.id);
  assert.equal((await storage.listTaskPackRevisionReviewEvents(pack.id, revision.id)).length, 2);
  const conflict = await send(lifecyclePath, { expectedLifecycleVersion: 1, action: "complete" });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.expectedLifecycleVersion, 1);
  assert.equal(conflict.body.actualLifecycleVersion, 2);
  const completed = await send(lifecyclePath, { expectedLifecycleVersion: 2, action: "complete" });
  assert.equal(completed.status, 200);
  assert.equal(completed.body.aggregate.lifecycle.state, "completed");
  assert.equal(completed.body.event.revisionId, revision.id);
  const state = await send(`/${pack.id}/workflow`);
  assert.equal(state.body.workflow.currentReviewState, "accepted");
  assert.equal(state.body.workflow.lifecycleVersion, 3);
  assert.doesNotMatch(JSON.stringify(state.body), /Private|rawTask|generatedPrompt|generationRecipe|diagnostics/);
});
scenario("production router registers workflow module; module has no storage calls", () => {
  const routes = fs.readFileSync(new URL("./taskPacks.ts", import.meta.url), "utf8");
  assert.match(routes, /registerTaskPackWorkflowRoutes\(taskPacksRouter, taskPackApplicationService\)/);
  const workflowSource = fs.readFileSync(new URL("./taskPackWorkflowRoutes.ts", import.meta.url), "utf8");
  assert.doesNotMatch(workflowSource, /(?:from\s+["'][^"']*storage|storage\.|transitionTaskPackAggregateLifecycle\()/);
});

let passed = 0;
try {
  for (const entry of scenarios) { await entry.run(); passed++; process.stdout.write(`PASS ${entry.name}\n`); }
  process.stdout.write(`Task Pack workflow HTTP smoke passed: ${passed} scenarios.\n`);
} finally {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
