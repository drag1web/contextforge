import assert from "node:assert/strict";
import fs from "node:fs";
import { ApiRequestError, getTaskPackWorkflow, transitionTaskPackLifecycle, transitionTaskPackRevisionReview } from "../src/api/client";
import type { TaskPack, TaskPackWorkflowState } from "../src/types";
import { captureTaskPackWorkflowOperation, createTaskPackWorkflowController, executeTaskPackWorkflowOperation,
  getTaskPackWorkflowCapabilities, parseTaskPackWorkflow, taskPackWorkflowIssue,
  type TaskPackWorkflowApi, type TaskPackWorkflowAction } from "../src/utils/taskPackWorkflow";
import i18n from "../src/i18n";

let passed = 0;
async function scenario(name: string, run: () => void | Promise<void>) {
  await run(); passed++; process.stdout.write(`PASS ${name}\n`);
}
function workflow(overrides: Partial<TaskPackWorkflowState> = {}): TaskPackWorkflowState {
  return { taskPackId: 7, lifecycle: { state: "active", archivedFromState: null }, lifecycleVersion: 4,
    currentRevisionId: 21, acceptedRevisionId: null, completedAt: null, archivedAt: null,
    currentReviewState: "unreviewed", ...overrides };
}
type Call = { kind: string; args: unknown[] };
function fixture(read: () => unknown | Promise<unknown> = () => workflow()) {
  const calls: Call[] = [];
  const api: TaskPackWorkflowApi = {
    getTaskPackWorkflow: async (...args) => { calls.push({ kind: "GET", args }); return read(); },
    transitionTaskPackLifecycle: async (...args) => { calls.push({ kind: "lifecycle", args }); },
    transitionTaskPackRevisionReview: async (...args) => { calls.push({ kind: "review", args }); },
  };
  return { api, calls };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function apiError(code: string, status = 409) {
  return new ApiRequestError("private SQL driver details", status, { code, message: "private SQL",
    taskPackId: 7, revisionId: 21, expectedLifecycleVersion: 4, actualLifecycleVersion: 900,
    expectedReviewState: "unreviewed", actualReviewState: "in_review", stack: "private stack", cause: "driver cause", rawTask: "secret" });
}
const accepted = () => workflow({ currentReviewState: "accepted", acceptedRevisionId: 21 });

await scenario("flat TaskPack type remains separate from workflow", () => {
  const flatHasLifecycle: "lifecycle" extends keyof TaskPack ? true : false = false;
  assert.equal(flatHasLifecycle, false);
});
for (const [review, actions] of [
  ["unreviewed", ["start_review", "accept"]], ["in_review", ["accept", "request_changes"]],
  ["accepted", []], ["changes_requested", []],
] as const) await scenario(`${review} exposes only its review UI actions`, () => {
  assert.deepEqual(getTaskPackWorkflowCapabilities(workflow({ currentReviewState: review })).review, actions);
});
await scenario("fresh active capabilities allow archive and editing, not completion", () => {
  assert.deepEqual(getTaskPackWorkflowCapabilities(workflow()), { lifecycle: ["archive"], review: ["start_review", "accept"], canEdit: true });
});
await scenario("completion requires both accepted current review and matching accepted pointer", () => {
  for (const state of [workflow({ acceptedRevisionId: 21 }), workflow({ currentReviewState: "accepted", acceptedRevisionId: 20 }),
    workflow({ currentReviewState: "accepted", acceptedRevisionId: null })]) {
    assert.equal(getTaskPackWorkflowCapabilities(state).lifecycle.includes("complete"), false);
  }
  assert.deepEqual(getTaskPackWorkflowCapabilities(accepted()).lifecycle, ["complete", "archive"]);
});
await scenario("completed allows reopen/archive and blocks direct editing", () => {
  assert.deepEqual(getTaskPackWorkflowCapabilities(workflow({ lifecycle: { state: "completed", archivedFromState: null } })).lifecycle, ["reopen", "archive"]);
  assert.equal(getTaskPackWorkflowCapabilities(workflow({ lifecycle: { state: "completed", archivedFromState: null } })).canEdit, false);
});
for (const prior of ["active", "completed"] as const) await scenario(`archived from ${prior} exposes only unarchive, not editing`, () => {
  const available = getTaskPackWorkflowCapabilities(workflow({ lifecycle: { state: "archived", archivedFromState: prior } }));
  assert.deepEqual(available.lifecycle, ["unarchive"]); assert.equal(available.canEdit, false);
});
await scenario("capture freezes all tokens including the exact review revision", () => {
  const state = workflow();
  const operation = captureTaskPackWorkflowOperation(state, "accept");
  state.lifecycleVersion = 99; state.currentReviewState = "accepted"; state.currentRevisionId = 22; state.taskPackId = 8;
  assert.deepEqual(operation, { taskPackId: 7, currentRevisionId: 21, expectedLifecycleVersion: 4, expectedReviewState: "unreviewed", action: "accept" });
  assert.ok(Object.isFrozen(operation));
  assert.throws(() => { (operation as { expectedLifecycleVersion: number }).expectedLifecycleVersion = 99; });
});
await scenario("capture alone (including canceled confirmation) makes no request", () => {
  const { calls } = fixture(); captureTaskPackWorkflowOperation(accepted(), "complete");
  captureTaskPackWorkflowOperation(workflow(), "archive"); assert.equal(calls.length, 0);
});
const actionStates: [TaskPackWorkflowAction, TaskPackWorkflowState][] = [
  ["start_review", workflow()], ["accept", workflow()], ["request_changes", workflow({ currentReviewState: "in_review" })],
  ["complete", accepted()], ["archive", workflow()],
  ["reopen", workflow({ lifecycle: { state: "completed", archivedFromState: null } })],
  ["unarchive", workflow({ lifecycle: { state: "archived", archivedFromState: "completed" } })],
];
for (const [action, state] of actionStates) await scenario(`${action} sends one captured mutation then exactly one authoritative GET`, async () => {
  const returned = workflow({ lifecycleVersion: 51, currentReviewState: "changes_requested" });
  const { api, calls } = fixture(() => returned);
  const operation = captureTaskPackWorkflowOperation(state, action);
  const result = await executeTaskPackWorkflowOperation(operation, api);
  const review = ["start_review", "accept", "request_changes"].includes(action);
  assert.deepEqual(calls, [{ kind: review ? "review" : "lifecycle", args: review
    ? [7, 21, { expectedLifecycleVersion: 4, expectedReviewState: state.currentReviewState, action }]
    : [7, { expectedLifecycleVersion: 4, action }] }, { kind: "GET", args: [7] }]);
  assert.deepEqual(result.workflow, returned); assert.equal(result.issue, null);
  assert.equal(result.workflow?.lifecycleVersion, 51); // not a manufactured increment
  assert.equal(result.workflow?.currentReviewState, "changes_requested"); // not a manufactured next state
});
await scenario("accept does not call lifecycle complete", async () => {
  const { api, calls } = fixture(() => accepted());
  await executeTaskPackWorkflowOperation(captureTaskPackWorkflowOperation(workflow(), "accept"), api);
  assert.equal(calls.filter(c => c.kind === "review").length, 1);
  assert.equal(calls.filter(c => c.kind === "lifecycle").length, 0);
});
for (const status of [400, 404, 409, 428, 500]) await scenario(`HTTP ${status} mutation failure never retries and reads only on 409`, async () => {
  const { api, calls } = fixture(() => workflow({ lifecycleVersion: 6 }));
  api.transitionTaskPackRevisionReview = async (...args) => { calls.push({ kind: "review", args }); throw apiError("TASK_PACK_REVIEW_CONFLICT", status); };
  const operation = captureTaskPackWorkflowOperation(workflow(), "accept");
  const result = await executeTaskPackWorkflowOperation(operation, api);
  assert.equal(calls.filter(c => c.kind === "review").length, 1);
  assert.equal(calls.filter(c => c.kind === "GET").length, status === 409 ? 1 : 0);
  assert.equal(operation.expectedLifecycleVersion, 4);
  if (status === 409) assert.equal(result.workflow?.lifecycleVersion, 6); // GET, never error evidence 900
});
await scenario("conflict refresh failure is safe and attempted only once", async () => {
  const { api, calls } = fixture(() => { throw new Error("SQL driver secret"); });
  api.transitionTaskPackLifecycle = async (...args) => { calls.push({ kind: "lifecycle", args }); throw apiError("TASK_PACK_LIFECYCLE_CONFLICT"); };
  const result = await executeTaskPackWorkflowOperation(captureTaskPackWorkflowOperation(workflow(), "archive"), api);
  assert.equal(result.workflow, null); assert.equal(result.issue?.refreshFailed, true);
  assert.deepEqual(calls.map(c => c.kind), ["lifecycle", "GET"]);
  assert.doesNotMatch(JSON.stringify(result), /SQL|driver|secret|stack|cause/);
});
await scenario("successful mutation with failed GET never synthesizes workflow or retries", async () => {
  const { api, calls } = fixture(() => { throw new Error("private"); });
  const result = await executeTaskPackWorkflowOperation(captureTaskPackWorkflowOperation(workflow(), "accept"), api);
  assert.equal(result.workflow, null); assert.equal(result.issue?.phase, "refresh");
  assert.equal(calls.length, 2);
});
for (const [code, kind] of [
  ["TASK_PACK_REVIEW_CONFLICT", "conflict"], ["TASK_PACK_REVIEW_REVISION_NOT_FOUND", "not_found"],
  ["TASK_PACK_LIFECYCLE_INVALID_TRANSITION", "invalid_transition"], ["TASK_PACK_REVIEW_VERSION_EXHAUSTED", "version_exhausted"],
  ["TASK_PACK_CURRENT_STATE_INVALID", "state_invalid"], ["TASK_PACK_LIFECYCLE_EVENT_EXISTS", "event_exists"],
  ["TASK_PACK_WORKFLOW_FAILED", "request_failed"],
]) await scenario(`safe issue categorizes ${code} and strips private data`, () => {
  const issue = taskPackWorkflowIssue(apiError(code), "mutation");
  assert.equal(issue.kind, kind);
  assert.doesNotMatch(JSON.stringify(issue), /SQL|driver|private|stack|cause|rawTask|secret/);
  assert.deepEqual(issue.evidence, { taskPackId: 7, revisionId: 21, expectedLifecycleVersion: 4, actualLifecycleVersion: 900,
    expectedReviewState: "unreviewed", actualReviewState: "in_review" });
});
await scenario("unknown issue text/code and unsafe evidence are discarded", () => {
  assert.deepEqual(taskPackWorkflowIssue(new Error("private SQL"), "load"), { kind: "request_failed", phase: "load" });
  const issue = taskPackWorkflowIssue(new ApiRequestError("secret", 500, { code: "private SQL", taskPackId: 0,
    revisionId: "21", actualLifecycleVersion: Number.MAX_SAFE_INTEGER + 1, expectedReviewState: "secret" }), "load");
  assert.equal(issue.code, undefined); assert.deepEqual(issue.evidence, {});
  assert.doesNotMatch(JSON.stringify(issue), /private|SQL|secret/);
});
await scenario("response validator rejects malformed/missing fields and foreign pack, without private payload", () => {
  for (const value of [null, [], {}, { ...workflow(), lifecycleVersion: 0 }, { ...workflow(), currentRevisionId: "21" },
    { ...workflow(), lifecycleVersion: Number.MAX_SAFE_INTEGER + 1 }, { ...workflow(), currentReviewState: "secret" },
    { ...workflow(), lifecycle: { state: "archived", archivedFromState: null } }, { ...workflow(), rawTask: "private" },
    { ...workflow(), completedAt: "not a timestamp" }, { ...workflow(), taskPackId: 8 }]) {
    assert.throws(() => parseTaskPackWorkflow(value, 7), error => {
      assert.deepEqual(taskPackWorkflowIssue(error, "load"), { kind: "state_invalid", phase: "load" }); return true;
    });
  }
});
await scenario("initial workflow load is fail-closed, then enables only server state", async () => {
  const pending = deferred<unknown>(), { api, calls } = fixture(() => pending.promise);
  const controller = createTaskPackWorkflowController(7, 21, api);
  const loading = controller.activate();
  await controller.execute("accept");
  assert.equal(controller.getSnapshot().blocked, true); assert.equal(calls.length, 1);
  pending.resolve(workflow()); await loading;
  assert.equal(controller.getSnapshot().blocked, false); assert.deepEqual(controller.getSnapshot().workflow, workflow());
});
await scenario("synchronous duplicate-click lock permits one mutation with no optimistic badges", async () => {
  const pending = deferred<void>(); let reads = 0;
  const { api, calls } = fixture(() => ++reads === 1 ? workflow() : accepted());
  api.transitionTaskPackRevisionReview = async (...args) => { calls.push({ kind: "review", args }); await pending.promise; };
  const controller = createTaskPackWorkflowController(7, 21, api); await controller.activate();
  const first = controller.execute("accept"), second = controller.execute("accept");
  await controller.refresh();
  assert.equal(controller.getSnapshot().workflow?.currentReviewState, "unreviewed");
  assert.equal(controller.getSnapshot().activeAction, "accept");
  assert.equal(calls.filter(c => c.kind === "review").length, 1);
  pending.resolve(); await Promise.all([first, second]);
  assert.equal(controller.getSnapshot().workflow?.currentReviewState, "accepted");
  assert.equal(controller.getSnapshot().activeAction, null); assert.equal(reads, 2);
});
await scenario("conflict retains issue, uses GET state, and requires a fresh explicit click", async () => {
  let reads = 0;
  const { api, calls } = fixture(() => workflow({ lifecycleVersion: ++reads === 1 ? 4 : 6 }));
  api.transitionTaskPackRevisionReview = async (...args) => { calls.push({ kind: "review", args }); throw apiError("TASK_PACK_REVIEW_CONFLICT"); };
  const controller = createTaskPackWorkflowController(7, 21, api); await controller.activate(); await controller.execute("accept");
  assert.equal(controller.getSnapshot().workflow?.lifecycleVersion, 6);
  assert.equal(controller.getSnapshot().issue?.kind, "conflict");
  assert.equal(calls.filter(c => c.kind === "review").length, 1);
  await controller.execute("accept");
  assert.equal((calls.filter(c => c.kind === "review")[1].args[2] as { expectedLifecycleVersion: number }).expectedLifecycleVersion, 6);
});
await scenario("failed conflict refresh retains previous visible state but blocks writes until refresh", async () => {
  let failRead = false;
  const { api, calls } = fixture(() => { if (failRead) throw new Error("private"); return workflow(); });
  api.transitionTaskPackLifecycle = async (...args) => { calls.push({ kind: "lifecycle", args }); failRead = true; throw apiError("TASK_PACK_LIFECYCLE_CONFLICT"); };
  const controller = createTaskPackWorkflowController(7, 21, api); await controller.activate(); await controller.execute("archive");
  assert.deepEqual(controller.getSnapshot().workflow, workflow()); assert.equal(controller.getSnapshot().blocked, true);
  await controller.execute("archive"); assert.equal(calls.filter(c => c.kind === "lifecycle").length, 1);
  controller.clearIssue(); assert.equal(controller.getSnapshot().blocked, true);
  failRead = false; await controller.refresh(); assert.equal(controller.getSnapshot().blocked, false);
});
await scenario("404 cached workflow retains document state but disables mutations", async () => {
  let missing = false;
  const { api, calls } = fixture(() => { if (missing) throw apiError("TASK_PACK_NOT_FOUND", 404); return workflow(); });
  const controller = createTaskPackWorkflowController(7, 21, api); await controller.activate(); missing = true; await controller.refresh();
  assert.equal(controller.getSnapshot().issue?.kind, "not_found"); assert.equal(controller.getSnapshot().blocked, true);
  await controller.execute("archive"); assert.ok(calls.every(c => c.kind === "GET"));
});
await scenario("invalid successful response blocks all workflow controls", async () => {
  const { api, calls } = fixture(() => ({ ...workflow(), lifecycleVersion: "4" }));
  const controller = createTaskPackWorkflowController(7, 21, api); await controller.activate(); await controller.execute("accept");
  assert.equal(controller.getSnapshot().issue?.kind, "state_invalid"); assert.equal(controller.getSnapshot().workflow, null);
  assert.equal(calls.length, 1);
});
await scenario("latest refresh wins over an older late read", async () => {
  const one = deferred<unknown>(), two = deferred<unknown>(); let reads = 0;
  const { api } = fixture(() => ++reads === 1 ? one.promise : two.promise);
  const controller = createTaskPackWorkflowController(7, 21, api);
  const first = controller.activate(), second = controller.refresh();
  two.resolve(workflow({ lifecycleVersion: 6 })); await second; one.resolve(workflow()); await first;
  assert.equal(controller.getSnapshot().workflow?.lifecycleVersion, 6);
});
for (const next of [workflow({ taskPackId: 8, currentRevisionId: 32 }), workflow({ currentRevisionId: 22, acceptedRevisionId: 21 })]) {
  await scenario(`late read for A/R21 cannot replace target ${next.taskPackId}/R${next.currentRevisionId}`, async () => {
    const pending = deferred<unknown>(), first = fixture(() => pending.promise), second = fixture(() => next);
    const oldOwner = createTaskPackWorkflowController(7, 21, first.api), newOwner = createTaskPackWorkflowController(next.taskPackId, next.currentRevisionId, second.api);
    const oldRead = oldOwner.activate(); oldOwner.dispose();
    assert.equal(newOwner.getSnapshot().workflow, null); assert.equal(newOwner.getSnapshot().loading, true);
    await newOwner.activate(); pending.resolve(accepted()); await oldRead;
    assert.deepEqual(newOwner.getSnapshot().workflow, next); assert.equal(oldOwner.getSnapshot().workflow, null);
  });
}
await scenario("late mutation completion after disposal cannot publish even to the old owner", async () => {
  const pending = deferred<void>(), { api } = fixture();
  api.transitionTaskPackRevisionReview = async () => pending.promise;
  const controller = createTaskPackWorkflowController(7, 21, api); await controller.activate();
  const operation = controller.execute("accept"); controller.dispose();
  const snapshot = controller.getSnapshot(); pending.resolve(); await operation;
  assert.equal(controller.getSnapshot(), snapshot);
});
await scenario("StrictMode activate/dispose/activate ignores the first load", async () => {
  const pending = deferred<unknown>(); let reads = 0;
  const { api } = fixture(() => ++reads === 1 ? pending.promise : workflow({ lifecycleVersion: 6 }));
  const controller = createTaskPackWorkflowController(7, 21, api);
  const first = controller.activate(); controller.dispose(); await controller.activate(); pending.resolve(workflow()); await first;
  assert.equal(controller.getSnapshot().workflow?.lifecycleVersion, 6);
});
await scenario("workflow for a different current revision is visible but cannot authorize the cached document", async () => {
  const { api, calls } = fixture(() => workflow({ currentRevisionId: 22 }));
  const controller = createTaskPackWorkflowController(7, 21, api); await controller.activate(); await controller.execute("accept");
  assert.equal(controller.getSnapshot().issue?.kind, "revision_changed"); assert.equal(controller.getSnapshot().blocked, true);
  assert.equal(calls.length, 1);
});
await scenario("confirmation uses original captured CAS even after another refresh", async () => {
  let reads = 0;
  const { api, calls } = fixture(() => workflow({ lifecycleVersion: ++reads === 1 ? 4 : 6 }));
  const controller = createTaskPackWorkflowController(7, 21, api); await controller.activate();
  const confirmation = captureTaskPackWorkflowOperation(controller.getSnapshot().workflow!, "archive");
  await controller.refresh(); await controller.execute(confirmation);
  assert.deepEqual(calls.find(c => c.kind === "lifecycle")?.args, [7, { expectedLifecycleVersion: 4, action: "archive" }]);
});

const originalFetch = globalThis.fetch;
try {
  const calls: { url: string; method: string; body: unknown }[] = [];
  let response: unknown = { ok: true, workflow: workflow() };
  globalThis.fetch = async (input, options) => {
    calls.push({ url: String(input), method: options?.method ?? "GET", body: options?.body ? JSON.parse(String(options.body)) : undefined });
    return new Response(JSON.stringify(response), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  await scenario("API workflow GET uses exact 05C endpoint", async () => {
    assert.deepEqual(await getTaskPackWorkflow(7), workflow());
    assert.deepEqual(calls.pop(), { url: "http://localhost:4000/api/task-packs/7/workflow", method: "GET", body: undefined });
  });
  await scenario("API lifecycle POST sends only CAS/action, ignoring forbidden caller fields", async () => {
    response = { ok: true, aggregate: {}, event: {} };
    await transitionTaskPackLifecycle(7, { expectedLifecycleVersion: 4, action: "archive", eventId: "forbidden", createdAt: "forbidden",
      source: "forbidden", actorId: "forbidden", metadata: {}, acceptedRevisionId: 99, targetState: "forbidden" } as never);
    assert.deepEqual(calls.pop(), { url: "http://localhost:4000/api/task-packs/7/transitions", method: "POST", body: { expectedLifecycleVersion: 4, action: "archive" } });
  });
  await scenario("API review POST sends exact current revision and only CAS/state/action", async () => {
    await transitionTaskPackRevisionReview(7, 21, { expectedLifecycleVersion: 4, expectedReviewState: "unreviewed", action: "accept",
      eventId: "forbidden", createdAt: "forbidden", source: "forbidden", actorId: "forbidden", metadata: {}, acceptedRevisionId: 99 } as never);
    assert.deepEqual(calls.pop(), { url: "http://localhost:4000/api/task-packs/7/revisions/21/review-events", method: "POST",
      body: { expectedLifecycleVersion: 4, expectedReviewState: "unreviewed", action: "accept" } });
    assert.equal(calls.length, 0);
  });
} finally { globalThis.fetch = originalFetch; }

const source = (file: string) => fs.readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
const page = source("pages/TaskPackResultPage.tsx"), hook = source("hooks/useTaskPackWorkflow.ts"), card = source("components/taskPacks/TaskPackWorkflowCard.tsx");
const documentView = source("components/taskPacks/TaskPackDocumentView.tsx"), details = source("components/taskPacks/TaskPackDetailsView.tsx");
const header = source("components/taskPacks/TaskPackWorkspaceHeader.tsx");
await scenario("Result owns one workflow controller across document/review/details surfaces", () => {
  assert.match(page, /useTaskPackWorkflow\(taskPack.id,/);
  assert.match(hook, /\[taskPackId, currentRevisionId\]/);
  assert.match(hook, /useSyncExternalStore/); assert.match(hook, /return controller.dispose/);
  assert.equal((page.match(/useTaskPackWorkflow\(/g) ?? []).length, 1);
  assert.match(page, /data-task-pack-view="review"[\s\S]*?<TaskPackWorkflowCard/);
  assert.doesNotMatch(documentView + details, /TaskPackWorkflowCard/);
  assert.doesNotMatch(card + documentView + details + header, /useTaskPackWorkflow|fetch\(|transitionTaskPackLifecycle\(|transitionTaskPackRevisionReview\(/);
});
await scenario("direct editors gate opening and save on active authoritative workflow", () => {
  assert.match(page, /workflow.lifecycle.state === "active"/);
  assert.match(page, /!workflowController.blocked && !workflowController.loading/);
  assert.match(page, /if \(!canEdit\) \{ setEditorOpenError\(editExplanation\); return; \}/);
  assert.match(documentView, /disabled=\{!canEdit\}/);
  assert.match(details, /disabled=\{!canEdit\}/);
  assert.match(page, /if \(!editAuthority.current.canEdit \|\| editAuthority.current.taskPackId !== session.taskPackId\)/);
  assert.match(page, /setCurrentTaskPack\(nextTaskPack\);\s*onTaskPackUpdated\?\.\(nextTaskPack\)/);
  assert.match(page, /handleTaskPackUpdated\(nextTaskPack\)/);
});
await scenario("shared confirmations only complete/archive, cancel never executes", () => {
  assert.match(card, /action === "complete" \|\| action === "archive"/);
  assert.match(card, /setConfirmation\(captured\)/); assert.match(card, /<ConfirmDialog/);
  assert.match(card, /confirmDisabled=\{busy \|\| blocked \|\| disabled\}/);
  assert.match(card, /onClose=\{\(\) => \{ if \(!activeAction\) setConfirmation\(null\); \}\}/);
});
await scenario("quiet header preserves badges, builder, exports, diagnostics and GitHub", () => {
  assert.match(header, /<TaskPackWorkflowBadges/);
  assert.doesNotMatch(header, /documentReady|TaskPackFreshness|lifecycleVersion/);
  assert.match(documentView, /<TaskPackExportActions/);
  for (const fragment of ["taskPackResult.openInBuilder",
    "onOpenInBuilder(currentTaskPack)", "<CreateGitHubIssueModal", "<SelectorDiagnosticsModal",
    "<GenerationDiagnosticsModal", "<PerformanceDiagnosticsModal", "buildTaskPackEditorUpdate(session, trimmedValue)"]) assert.ok(page.includes(fragment), fragment);
  assert.doesNotMatch(hook, /setInterval|setTimeout/);
});
await scenario("EN/RU workflow keys synchronize and distinguish builder vs lifecycle reopen", () => {
  const en = i18n.getResourceBundle("en", "translation"), ru = i18n.getResourceBundle("ru", "translation");
  function keys(record: Record<string, unknown>, prefix = ""): string[] {
    return Object.entries(record).flatMap(([key, value]) => typeof value === "string" ? [prefix + key] : keys(value as Record<string, unknown>, `${prefix}${key}.`)).sort();
  }
  assert.deepEqual(keys(en.taskPackWorkflow), keys(ru.taskPackWorkflow));
  assert.equal(ru.taskPackWorkflow.actions.reopen, "Вернуть в работу");
  assert.notEqual(en.taskPackResult.openInBuilder, en.taskPackWorkflow.actions.reopen);
  assert.notEqual(ru.taskPackResult.openInBuilder, ru.taskPackWorkflow.actions.reopen);
  for (const language of [en, ru]) for (const group of ["lifecycle", "review", "actions", "issues"]) {
    assert.ok(Object.values(language.taskPackWorkflow[group]).every(value => typeof value === "string" && value.length > 0));
  }
});
process.stdout.write(`Task Pack workflow renderer smoke passed: ${passed} scenarios.\n`);
