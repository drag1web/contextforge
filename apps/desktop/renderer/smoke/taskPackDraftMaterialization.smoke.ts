import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import type {
  ContextComposerPreview, MaterializeTaskPackDraftResponse, TaskPackDraft,
  TaskPackDraftSession, TaskPackPersistedDraftView,
} from "../src/types";
import { ApiRequestError, materializeTaskPackDraft, updateTaskPackDraft } from "../src/api/client";
import {
  canMaterializeTaskPackDraft, captureTaskPackDraftMaterialization,
  executeTaskPackDraftMaterialization, ownsTaskPackDraftMaterialization,
  taskPackDraftMaterializationIssue, TaskPackDraftMaterializationError,
  upsertMaterializedTaskPack, validateTaskPackDraftMaterializationResult,
  type TaskPackDraftMaterializationApi, type TaskPackDraftMaterializationOperation,
} from "../src/utils/taskPackDraftMaterialization";
import {
  applyTaskPackDraftOperationResult, createRestoredTaskPackDraftSession,
  createTaskPackDraftSessionFromPersisted, createTransientTaskPackDraftSession,
  editTaskPackDraftSession, isTaskPackDraftSessionDirty, serializeTaskPackDraftContent,
} from "../src/utils/taskPackDraftSession";
import {
  applyDraftOperationToHistory, invalidateDraftSessionHistory,
  type WorkspaceNavigationHistoryState,
} from "../src/hooks/useWorkspaceNavigationHistory";
import { createTaskPackDraftDiscovery } from "../src/utils/taskPackDraftDiscovery";
import { useDashboardController } from "../src/hooks/useDashboardController";
import i18n from "../src/i18n";

let scenarios = 0, wiring = 0;
async function scenario(name: string, run: () => void | Promise<void>, sourceOnly = false) {
  await run(); scenarios++; if (sourceOnly) wiring++;
  console.log(`PASS ${name}`);
}
const source = (name: string) => readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");
const controller = source("hooks/useDashboardController.ts");
const builder = source("pages/TaskPackBuilderPage.tsx");
const dashboard = source("pages/DashboardPage.tsx");
const composer = source("pages/ContextComposerPage.tsx");
function section(text: string, start: string, end: string) {
  const first = text.indexOf(start), last = text.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first); return text.slice(first, last);
}
const time = "2026-09-26T10:00:00.000Z";
function editable(): TaskPackDraft {
  return {
    projectId: 3, projectName: "Local project", rawTask: "  exact task\r\n  ", taskType: "general", targetTool: "codex",
    templateId: "", ruleProfileId: "profile", enabledRuleIds: ["b", "a", "b"], customRulesText: " rule\r\nrule ",
    acceptanceCriteriaText: "", clarifications: [{ question: " question ", answer: "" }],
    performanceSessionId: "performance", understandingSnapshotId: "snapshot", reviewedUnderstandingSnapshotId: "snapshot",
  };
}
function view(overrides: Partial<TaskPackPersistedDraftView> = {}): TaskPackPersistedDraftView {
  return {
    id: "opaque draft/A", projectId: 3, projectName: "Local project", taskPackId: null, baseRevisionId: null,
    lifecycle: { state: "active", materializedRevisionId: null }, draftVersion: 4,
    createdAt: time, updatedAt: time, expiresAt: null, content: serializeTaskPackDraftContent(editable()), ...overrides,
  };
}
const persisted = () => createTaskPackDraftSessionFromPersisted("session-A", view());
const dirty = () => editTaskPackDraftSession(persisted(), { ...editable(), rawTask: " unsaved exact task\r\n" });
function capture(session = persisted(), draft = session.draft) {
  const operation = captureTaskPackDraftMaterialization(session, session.sessionId, draft);
  assert.ok(operation); return operation;
}
function result(operation: TaskPackDraftMaterializationOperation, version = operation.expectedDraftVersion): MaterializeTaskPackDraftResponse {
  return {
    ok: true,
    taskPack: { id: 20, currentRevisionId: 30, projectId: 3, projectName: "Local project", title: "Task",
      rawTask: operation.content.rawTask, taskType: "general", targetTool: "codex", generatedPrompt: "prompt", createdAt: time, updatedAt: time },
    revision: { id: 30, taskPackId: 20, revisionNumber: 1, contentHash: `sha256:${"a".repeat(64)}`, createdAt: time, generatedAt: time },
    draft: view({ taskPackId: 20, lifecycle: { state: "materialized", materializedRevisionId: 30 },
      draftVersion: version + 1, content: operation.content }),
  };
}
function fake(operation: TaskPackDraftMaterializationOperation, returnedVersion = 7) {
  const calls: { method: string; args: unknown[] }[] = [];
  const api: TaskPackDraftMaterializationApi = {
    async updateTaskPackDraft(...args) { calls.push({ method: "PATCH", args });
      return view({ content: operation.content, draftVersion: returnedVersion, updatedAt: "2026-09-26T10:01:00.000Z" }); },
    async materializeTaskPackDraft(...args) { calls.push({ method: "POST", args }); return result(operation, args[1]); },
  };
  return { api, calls };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve };
}
const conflict = () => new ApiRequestError("private SQL text", 409, {
  code: "TASK_PACK_DRAFT_CONFLICT", actualDraftVersion: 90,
});

await scenario("clean final snapshot skips PATCH and creates with captured version", async () => {
  const operation = capture(), { api, calls } = fake(operation);
  assert.equal(operation.needSave, false);
  await executeTaskPackDraftMaterialization(operation, api);
  assert.deepEqual(calls, [{ method: "POST", args: [view().id, 4] }]);
});
await scenario("dirty snapshot saves exact full content and uses server RETURNED version", async () => {
  const operation = capture(dirty()), { api, calls } = fake(operation, 7);
  await executeTaskPackDraftMaterialization(operation, api);
  assert.deepEqual(calls, [
    { method: "PATCH", args: [view().id, { expectedDraftVersion: 4, content: serializeTaskPackDraftContent(dirty().draft) }] },
    { method: "POST", args: [view().id, 7] },
  ]);
});
await scenario("semantic no-op PATCH can return the SAME version", async () => {
  const operation = capture(dirty()), { api, calls } = fake(operation, 4);
  await executeTaskPackDraftMaterialization(operation, api);
  assert.deepEqual(calls[1].args, [view().id, 4]);
});
await scenario("captured content is independent and frozen through pending work", () => {
  const draft = editable(), operation = capture(persisted(), draft);
  draft.rawTask = "later"; draft.enabledRuleIds!.reverse(); draft.clarifications![0].answer = "later";
  assert.deepEqual(operation.content, serializeTaskPackDraftContent(editable()));
  assert.ok(Object.isFrozen(operation.content)); assert.ok(Object.isFrozen(operation.content.enabledRuleIds));
  assert.ok(Object.isFrozen(operation.content.clarifications[0]));
});
for (const [name, patch] of Object.entries({
  "immediate continuation": { understandingSnapshotId: "new-snapshot", reviewedUnderstandingSnapshotId: undefined },
  "explicit reviewed continuation": { understandingSnapshotId: "new-snapshot", reviewedUnderstandingSnapshotId: "new-snapshot" },
  "canonical clarified continuation": { understandingSnapshotId: "clarified", clarifications: [{ question: "canonical question", answer: " exact answer " }] },
  "performance session assignment": { performanceSessionId: "new-performance" },
})) {
  await scenario(`preflight ${name} dirties previously clean draft and saves final evidence`, async () => {
    const finalDraft = { ...editable(), ...patch }, operation = capture(persisted(), finalDraft), { api, calls } = fake(operation);
    assert.equal(operation.needSave, true);
    await executeTaskPackDraftMaterialization(operation, api);
    assert.deepEqual(calls[0].args[1], { expectedDraftVersion: 4, content: serializeTaskPackDraftContent(finalDraft) });
  });
}
await scenario("restart-restored old evidence is replaced by newly reviewed final evidence", async () => {
  const restored = createRestoredTaskPackDraftSession("restored", view());
  assert.equal(restored.draft.understandingSnapshotId, undefined);
  const operation = capture(restored, { ...restored.draft, performanceSessionId: "fresh-perf", understandingSnapshotId: "fresh", reviewedUnderstandingSnapshotId: "fresh" });
  const { api, calls } = fake(operation); await executeTaskPackDraftMaterialization(operation, api);
  assert.deepEqual(calls[0].args[1], { expectedDraftVersion: 4, content: operation.content });
  assert.equal(operation.content.reviewedUnderstandingSnapshotId, "fresh");
});
for (const [name, error] of [["conflict", conflict()], ["network failure", new Error("private details")]] as const) {
  await scenario(`save ${name} prevents materialization and leaves baseline/token unchanged`, async () => {
    const session = dirty(), before = structuredClone(session), operation = capture(session), { api, calls } = fake(operation);
    api.updateTaskPackDraft = async () => { throw error; };
    await assert.rejects(executeTaskPackDraftMaterialization(operation, api), e => e === error);
    assert.equal(calls.length, 0); assert.deepEqual(session, before);
  });
}
const invalidSaves: Array<[string, Partial<TaskPackPersistedDraftView>]> = [
  ["draft identity", { id: "foreign" }], ["project", { projectId: 8 }],
  ["terminal state", { lifecycle: { state: "discarded", materializedRevisionId: null } }],
  ["binding", { taskPackId: 5 }], ["base binding", { baseRevisionId: 5 }],
  ["zero version", { draftVersion: 0 }], ["unsafe version", { draftVersion: Number.MAX_SAFE_INTEGER + 1 }],
  ["regressed version", { draftVersion: 3 }], ["different content", { content: view().content }],
];
for (const [name, override] of invalidSaves) await scenario(`invalid save ${name} fails closed BEFORE POST`, async () => {
  const operation = capture(dirty()), { api, calls } = fake(operation);
  api.updateTaskPackDraft = async () => view({ content: operation.content, draftVersion: 5, ...override });
  await assert.rejects(executeTaskPackDraftMaterialization(operation, api), TaskPackDraftMaterializationError);
  assert.equal(calls.length, 0);
});
for (const code of ["TASK_PACK_DRAFT_CONFLICT", "CONTEXT_SELECTION_BLOCKED", "TASK_PACK_DRAFT_NOT_FOUND", "TASK_PACK_DRAFT_NOT_EDITABLE", "TASK_PACK_DRAFT_VERSION_EXHAUSTED", "TASK_PACK_DRAFT_PROJECT_NOT_FOUND", "TASK_PACK_DRAFT_ALREADY_BOUND", "TASK_PACK_DRAFT_OWNERSHIP_INVALID", "TASK_PACK_DRAFT_BASE_REVISION_INVALID", "TASK_PACK_DRAFT_STATE_INVALID", "UNEXPECTED_FAILURE"]) {
  await scenario(`${code}: successful Save stays applied, no retry or adopted conflict token`, async () => {
    let session = dirty(); const operation = capture(session), { api, calls } = fake(operation, 6);
    let creates = 0;
    api.materializeTaskPackDraft = async (_id, version) => { creates++; assert.equal(version, 6);
      throw new ApiRequestError("private SQL", 409, { code, actualDraftVersion: 99 }); };
    await assert.rejects(executeTaskPackDraftMaterialization(operation, api, { onSaved(_view, saved) { session = saved; } }));
    assert.equal(creates, 1); assert.equal(calls.length, 1);
    assert.equal(session.persistence!.draftVersion, 6); assert.equal(session.persistence!.lifecycle.state, "active");
    assert.equal(session.persistence!.updatedAt, "2026-09-26T10:01:00.000Z");
    assert.equal(isTaskPackDraftSessionDirty(session), false);
    const issue = taskPackDraftMaterializationIssue(operation, "creating", 6, code, { actualDraftVersion: 99, message: "private SQL" });
    assert.doesNotMatch(JSON.stringify(issue), /private|SQL/);
    if (issue.conflict) assert.equal(issue.conflict.expectedDraftVersion, 6);
  });
}
await scenario("duplicate execution of one captured action makes only one POST", async () => {
  const operation = capture(), { api } = fake(operation), pending = deferred<MaterializeTaskPackDraftResponse>();
  let creates = 0; api.materializeTaskPackDraft = () => { creates++; return pending.promise; };
  const first = executeTaskPackDraftMaterialization(operation, api);
  await assert.rejects(executeTaskPackDraftMaterialization(operation, api));
  pending.resolve(result(operation)); await first; assert.equal(creates, 1);
});
const corruptions: Array<[string, (response: MaterializeTaskPackDraftResponse) => void]> = [
  ["ok", r => Object.assign(r, { ok: false })], ["draft ID", r => Object.assign(r.draft, { id: "foreign" })],
  ["draft project", r => Object.assign(r.draft, { projectId: 9 })], ["Task Pack project", r => { r.taskPack.projectId = 9; }],
  ["active lifecycle", r => Object.assign(r.draft, { lifecycle: { state: "active", materializedRevisionId: null } })],
  ["materialized pointer", r => Object.assign(r.draft, { lifecycle: { state: "materialized", materializedRevisionId: 99 } })],
  ["draft aggregate ownership", r => Object.assign(r.draft, { taskPackId: 99 })],
  ["base binding", r => Object.assign(r.draft, { baseRevisionId: 99 })],
  ["revision ownership", r => Object.assign(r.revision, { taskPackId: 99 })],
  ["current pointer", r => Object.assign(r.taskPack, { currentRevisionId: 99 })],
  ["revision number", r => Object.assign(r.revision, { revisionNumber: 2 })],
  ["zero aggregate ID", r => { r.taskPack.id = 0; }], ["unsafe revision ID", r => Object.assign(r.revision, { id: Number.MAX_SAFE_INTEGER + 1 })],
  ["terminal version", r => Object.assign(r.draft, { draftVersion: 4 })],
  ["changed draft content", r => Object.assign(r.draft, { content: { ...r.draft.content, rawTask: "wrong" } })],
];
for (const [name, corrupt] of corruptions) await scenario(`successful HTTP response with incoherent ${name} is rejected`, () => {
  const operation = capture(), response = result(operation); corrupt(response);
  assert.throws(() => validateTaskPackDraftMaterializationResult(operation, 4, response), TaskPackDraftMaterializationError);
});
await scenario("valid aggregate/revision/terminal draft identity is accepted", () => {
  const operation = capture(); validateTaskPackDraftMaterializationResult(operation, 4, result(operation));
});
for (const [name, overrides] of [
  ["discarded", { lifecycle: { state: "discarded", materializedRevisionId: null } }],
  ["materialized", { lifecycle: { state: "materialized", materializedRevisionId: 30 }, taskPackId: 20 }],
  ["bound", { taskPackId: 20 }], ["base-bound", { taskPackId: 20, baseRevisionId: 30 }],
] as const) await scenario(`${name} draft cannot enter first materialization`, () => {
  const session = createTaskPackDraftSessionFromPersisted("A", view(overrides));
  assert.equal(canMaterializeTaskPackDraft(session), false);
  assert.equal(captureTaskPackDraftMaterialization(session, "A", session.draft), null);
});
await scenario("transient, missing, stale session and foreign project cannot capture persisted work", () => {
  assert.equal(canMaterializeTaskPackDraft(null), false);
  assert.equal(canMaterializeTaskPackDraft(createTransientTaskPackDraftSession("local", editable())), false);
  assert.equal(captureTaskPackDraftMaterialization(persisted(), "B", editable()), null);
  assert.equal(captureTaskPackDraftMaterialization(persisted(), "session-A", { ...editable(), projectId: 9 }), null);
});
await scenario("operation ownership excludes replaced session B, foreign ID and foreign project", () => {
  const operation = capture(); assert.equal(ownsTaskPackDraftMaterialization(persisted(), operation), true);
  for (const current of [null, { ...persisted(), sessionId: "B" }, createTaskPackDraftSessionFromPersisted("session-A", view({ id: "other" })),
    createTaskPackDraftSessionFromPersisted("session-A", view({ projectId: 9 }))]) {
    assert.equal(ownsTaskPackDraftMaterialization(current, operation), false);
  }
});
await scenario("late intermediate Save updates A history/baseline but cannot replace active B", () => {
  const operation = capture(dirty()), other = createTransientTaskPackDraftSession("B", editable());
  const saved = view({ content: operation.content, draftVersion: 6 });
  assert.equal(applyTaskPackDraftOperationResult(other, operation.saveOperation, saved), other);
  const history: WorkspaceNavigationHistoryState = { index: 0, entries: [{ page: "projects", surface: "task-pack-builder", session: dirty() }] };
  const updated = applyDraftOperationToHistory(history, operation.saveOperation, saved);
  const entry = updated.entries[0]; assert.ok("session" in entry); assert.equal(entry.session.persistence!.draftVersion, 6);
});
await scenario("upsert uses authoritative Task Pack once and keeps unrelated cached results", () => {
  const pack = result(capture()).taskPack, other = { ...pack, id: 99 };
  assert.deepEqual(upsertMaterializedTaskPack([{ ...pack, title: "old" }, other, pack], pack), [pack, other]);
});
await scenario("terminal reconciliation removes only originating draft without GET or chooser reopening", () => {
  const discovery = createTaskPackDraftDiscovery({
    async listActiveTaskPackDrafts() { throw Error("unexpected GET"); }, async getTaskPackDraft() { throw Error("unexpected GET"); },
    async discardTaskPackDraft() { throw Error("unexpected discard"); },
  }, () => ({ projectIds: [3], session: null, busy: false, canOffer: true, restore: () => false }));
  discovery.reconcile(view()); discovery.reconcile(view({ id: "other" }));
  discovery.reconcile(view({ draftVersion: 7 }));
  assert.equal(discovery.getSnapshot().summaries.find(v => v.id === view().id)!.draftVersion, 7);
  discovery.reconcile(result(capture(), 7).draft);
  assert.deepEqual(discovery.getSnapshot().summaries.map(v => v.id), ["other"]);
  assert.equal(discovery.getSnapshot().open, false);
});
await scenario("materialized history removes ALL Builder/Composer A entries and Back cannot revive A", () => {
  const session = persisted(), other = createTransientTaskPackDraftSession("B", editable());
  const history: WorkspaceNavigationHistoryState = { index: 3, entries: [
    { page: "dashboard", surface: "page" }, { page: "projects", surface: "task-pack-builder", session: other },
    { page: "projects", surface: "context-composer", session, preview: {} as ContextComposerPreview },
    { page: "projects", surface: "task-pack-builder", session },
    { page: "projects", surface: "task-pack-builder", session },
  ] };
  const next = invalidateDraftSessionHistory(history, session.sessionId, 3);
  assert.equal(next.entries.length, 3); assert.deepEqual(next.entries.slice(0, 2), history.entries.slice(0, 2));
  next.entries.push({ page: "projects", surface: "task-pack-result", taskPack: result(capture()).taskPack }); next.index++;
  next.index--; assert.equal(next.entries[next.index].surface, "project-details");
  assert.ok(next.entries.every(e => !("session" in e) || e.session.sessionId !== "session-A"));
});

// Exercise real controller methods with isolated React hook slots. Effects/components are not
// rendered here; preflight/component wiring is asserted separately below. No new UI framework.
function controllerHarness(callbacks: Parameters<typeof useDashboardController>[0] = {}) {
  const slots: unknown[] = []; let cursor = 0;
  const internal = (React as unknown as { __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED:
    { ReactCurrentDispatcher: { current: unknown } } }).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher;
  const dispatcher = {
    useState<T>(initial: T | (() => T)) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
      return [slots[index], (next: T | ((value: T) => T)) => {
        slots[index] = typeof next === "function" ? (next as (value: T) => T)(slots[index] as T) : next;
      }];
    },
    useRef<T>(initial: T) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useEffect() { cursor++; },
  };
  function render() {
    cursor = 0; const previous = internal.current; internal.current = dispatcher;
    try { return useDashboardController(callbacks); } finally { internal.current = previous; }
  }
  return { render };
}
const originalFetch = globalThis.fetch;
try {
  await scenario("real controller persisted path sends ONLY materialize token and needs no follow-up GET", async () => {
    const operation = capture(); const requests: unknown[] = [];
    globalThis.fetch = async (url, init) => { requests.push([String(url), init?.method, JSON.parse(String(init?.body))]);
      return Response.json(result(operation)); };
    const harness = controllerHarness(); harness.render().setTaskPackDraftSession(persisted());
    const outcome = await harness.render().handleCreateTaskPack(editable());
    assert.equal(outcome?.kind, "generated");
    assert.deepEqual(requests, [[`http://localhost:4000/api/task-pack-drafts/${encodeURIComponent(view().id)}/materialize`, "POST", { expectedDraftVersion: 4 }]]);
    assert.equal(harness.render().taskPackDraftSession, null); assert.equal(harness.render().generatedTaskPack!.currentRevisionId, 30);
    assert.equal(harness.render().taskPacks.length, 1);
  });
  await scenario("real controller transient path still ordinary-creates and never materializes", async () => {
    const requests: string[] = [], pack = result(capture()).taskPack;
    globalThis.fetch = async (url, init) => { const path = String(url); requests.push(`${init?.method ?? "GET"} ${path}`);
      return Response.json({ ok: true, ...(path.endsWith("/settings") ? { settings: { generationMode: "template" } }
        : init?.method === "POST" ? { taskPack: pack } : { taskPacks: [pack] }) }); };
    const harness = controllerHarness(); harness.render().setTaskPackDraftSession(createTransientTaskPackDraftSession("T", editable()));
    assert.equal((await harness.render().handleCreateTaskPack(editable()))?.kind, "generated");
    assert.ok(requests.includes("POST http://localhost:4000/api/task-packs"));
    assert.ok(requests.every(r => !r.includes("/task-pack-drafts")));
  });
  await scenario("real controller synchronous guard prevents duplicate capture and blocks authoring/Save", async () => {
    const pending = deferred<Response>(); let requests = 0;
    globalThis.fetch = async () => { requests++; return pending.promise; };
    const harness = controllerHarness(); harness.render().setTaskPackDraftSession(persisted()); const active = harness.render();
    const first = active.handleCreateTaskPack(editable());
    assert.equal(await active.handleCreateTaskPack(editable()), null);
    active.setTaskPackDraft({ ...editable(), rawTask: "must not apply" }, "session-A");
    assert.equal(await active.handleDraftPersistence("saving", "session-A"), false);
    assert.equal(harness.render().taskPackDraft!.rawTask, editable().rawTask);
    pending.resolve(Response.json(result(capture()))); await first; assert.equal(requests, 1);
  });
  await scenario("real controller late A success updates global cache/terminal callback, never active B or focus", async () => {
    const pending = deferred<Response>(); let terminal = 0;
    globalThis.fetch = async () => pending.promise;
    const harness = controllerHarness({ onMaterializationResult() { terminal++; } });
    harness.render().setTaskPackDraftSession(persisted()); const active = harness.render();
    const stale = active.handleCreateTaskPack(editable());
    const other = createTransientTaskPackDraftSession("B", { ...editable(), rawTask: "B unchanged" });
    active.setTaskPackDraftSession(other);
    assert.equal(await active.handleCreateTaskPack(editable()), null); // stale A callback cannot run for B.
    pending.resolve(Response.json(result(capture()))); assert.equal(await stale, null);
    assert.deepEqual(harness.render().taskPackDraftSession, other);
    assert.equal(harness.render().generatedTaskPack, null); assert.equal(terminal, 1); assert.equal(harness.render().taskPacks.length, 1);
  });
  await scenario("real controller navigation away within same session does not open a result", async () => {
    globalThis.fetch = async () => Response.json(result(capture()));
    const harness = controllerHarness({ isDraftBuilderActive: () => false });
    harness.render().setTaskPackDraftSession(persisted());
    assert.equal(await harness.render().handleCreateTaskPack(editable()), null);
    assert.equal(harness.render().generatedTaskPack, null); assert.equal(harness.render().taskPackDraftSession, null);
    assert.equal(harness.render().taskPacks.length, 1);
  });
  await scenario("real controller late A failure cannot put issue or authored text into B", async () => {
    const pending = deferred<Response>(); globalThis.fetch = async () => pending.promise;
    const harness = controllerHarness(); harness.render().setTaskPackDraftSession(persisted()); const active = harness.render();
    const first = active.handleCreateTaskPack(editable());
    const other = createTransientTaskPackDraftSession("B", editable()); active.setTaskPackDraftSession(other);
    pending.resolve(Response.json({ code: "TASK_PACK_DRAFT_CONFLICT", message: "private", actualDraftVersion: 99 }, { status: 409 }));
    await first; assert.deepEqual(harness.render().taskPackDraftSession, other); assert.equal(harness.render().draftMaterializationIssue, null);
  });
  await scenario("real controller save-before-block updates baseline/history/discovery and opens same-session review", async () => {
    const session = dirty(), calls: string[] = []; let saves = 0;
    const preview = {} as ContextComposerPreview;
    globalThis.fetch = async (url, init) => {
      const path = String(url); calls.push(path);
      if (init?.method === "PATCH") return Response.json({ ok: true, draft: view({ content: serializeTaskPackDraftContent(session.draft), draftVersion: 8 }) });
      if (path.endsWith("/materialize")) return Response.json({ code: "CONTEXT_SELECTION_BLOCKED", message: "private" }, { status: 409 });
      return Response.json({ ok: true, preview });
    };
    const harness = controllerHarness({ onPersistenceResult() { saves++; } }); harness.render().setTaskPackDraftSession(session);
    const outcome = await harness.render().handleCreateTaskPack(session.draft);
    assert.equal(outcome?.kind, "context-review"); assert.equal(saves, 1);
    assert.equal(harness.render().taskPackDraftSession!.persistence!.draftVersion, 8);
    assert.equal(isTaskPackDraftSessionDirty(harness.render().taskPackDraftSession!), false);
    assert.equal(harness.render().draftMaterializationIssue!.code, "CONTEXT_SELECTION_BLOCKED");
    assert.ok(calls.every(path => !path.endsWith("/task-packs")));
  });
  await scenario("actual API client sends full final PATCH then token-ONLY materialize with encoded ID", async () => {
    const operation = capture(dirty()), requests: { url: string; body: unknown }[] = [];
    globalThis.fetch = async (url, init) => { requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return Response.json(init?.method === "PATCH" ? { ok: true, draft: view({ content: operation.content, draftVersion: 6 }) } : result(operation, 6)); };
    await executeTaskPackDraftMaterialization(operation, { updateTaskPackDraft, materializeTaskPackDraft });
    assert.deepEqual(requests.map(r => r.body), [{ expectedDraftVersion: 4, content: operation.content }, { expectedDraftVersion: 6 }]);
    assert.ok(requests.every(r => r.url.includes(encodeURIComponent(operation.draftId))));
  });
} finally { globalThis.fetch = originalFetch; }

await scenario("Builder preserves understanding continue/review/clarification ordering before onGenerate", () => {
  const preflight = section(builder, "const runUnderstandingPreflight =", "const handleAnalyzeContext =");
  assert.ok(preflight.indexOf("await understandTaskPack") < preflight.indexOf("await executeUnderstandingAction"));
  assert.ok(preflight.indexOf("onChange(resolvedDraft)") < preflight.indexOf("await executeUnderstandingAction"));
  assert.match(preflight, /response.interaction.action === "continue"/);
  assert.match(section(builder, "const handleGenerateTaskPack =", "const handleSubmitClarification ="), /runUnderstandingPreflight\("generate"\)/);
  assert.match(section(builder, "const handleSubmitClarification =", "const handleContinueUnderstanding ="), /runUnderstandingPreflight\(pendingUnderstandingAction, nextDraft\)/);
  assert.match(section(builder, "const handleContinueUnderstanding =", "const handleEditTaskFromUnderstanding ="), /reviewedUnderstandingSnapshotId:[\s\S]*onChange\(reviewedDraft\);[\s\S]*executeUnderstandingAction\(action, reviewedDraft\)/);
  assert.doesNotMatch(builder, /materializeTaskPackDraft\(/);
}, true);
await scenario("Builder unbound eligibility/critical-section lock and dirty button copy are wired", () => {
  assert.match(builder, /canAnalyze && \(!persisted \|\| canMaterializeTaskPackDraft\(session\)\)/);
  assert.match(builder, /disabled=\{!editable \|\| currentMaterialization !== null/);
  assert.match(builder, /persisted && persistenceDirty[\s\S]*taskPackDraftMaterialization.saveAndCreate/);
  assert.match(builder, /currentMaterialization.phase/);
}, true);
await scenario("Composer persisted manual basket remains blocked at UI AND ordinary controller boundary", () => {
  assert.match(dashboard, /generationDisabled=\{!canOrdinaryGenerateTaskPackDraft/);
  assert.match(composer, /if \(canGenerate\) onGenerate\(selectedPaths\)/);
  const ordinary = section(controller, "async function generateTaskPackFromDraft(", "async function handleCreateTaskPackDraft(");
  assert.ok(ordinary.indexOf("canOrdinaryGenerateTaskPackDraft(generationSession)") < ordinary.indexOf("await createTaskPack("));
  assert.doesNotMatch(section(controller, "async function materializePersistedDraft(", "async function handleCreateTaskPack("), /selectedFilePaths|await createTaskPack\(|loadTaskPacks\(/);
}, true);
await scenario("Dashboard seals terminal history/discovery without fake discard or forced focus", () => {
  const done = section(dashboard, "onMaterializationResult:", "const workspaceZoom =");
  assert.match(done, /invalidateTaskPackDraftSession\(operation.sessionId, operation.projectId\)/);
  assert.match(done, /reconcile\(result.draft\)/);
  assert.doesNotMatch(done, /discardTaskPackDraft|navigateToLocation|handleOpenTaskPackResult/);
  assert.match(controller, /draftCallbacks.isDraftBuilderActive\?\.\(operation.sessionId\) === false/);
}, true);
await scenario("materialization leaves ordinary Save/Reload/Discard and no-autosave wiring intact", () => {
  const ordinary = section(controller, "async function handleDraftPersistence(", "function dismissDraftPersistenceIssue(");
  assert.match(ordinary, /executeTaskPackDraftOperation\(operation, draftPersistenceApi\)/);
  assert.doesNotMatch(section(controller, "function setTaskPackDraft(", "function startTransientDraft("), /updateTaskPackDraft\(|materializeTaskPackDraft\(/);
}, true);
await scenario("new RU/EN product copy is synchronized, populated and excludes storage jargon", () => {
  const en = i18n.getResourceBundle("en", "translation").taskPackDraftMaterialization;
  const ru = i18n.getResourceBundle("ru", "translation").taskPackDraftMaterialization;
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ru).sort());
  for (const text of [...Object.values(en), ...Object.values(ru)]) {
    assert.ok(typeof text === "string" && text.trim()); assert.doesNotMatch(String(text), /CAS|draftVersion|materializ|материализ|SQL|04F|transaction/i);
  }
});
console.log(`Task Pack draft materialization smoke passed: ${scenarios} scenarios (${scenarios - wiring} executable behavior, ${wiring} React wiring).`);
