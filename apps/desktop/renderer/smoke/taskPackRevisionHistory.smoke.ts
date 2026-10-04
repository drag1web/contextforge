import assert from "node:assert/strict";
import fs from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ApiRequestError, getTaskPackRevisionHistory, getTaskPackRevisionDetail } from "../src/api/client";
import { TaskPackRevisionHistoryPanel } from "../src/components/taskPacks/TaskPackRevisionHistoryPanel";
import { TASK_PACK_WORKSPACE_VIEWS } from "../src/components/taskPacks/TaskPackWorkspaceHeader";
import { createTaskPackRevisionHistoryController, parseTaskPackRevisionHistoryResponse, parseTaskPackRevisionDetailResponse,
  emptyTaskPackRevisionComparison,
  type TaskPackRevisionHistoryApi, type TaskPackRevisionHistorySnapshot } from "../src/utils/taskPackRevisionHistory";
import type { TaskPackRevisionDetail, TaskPackRevisionHistory, TaskPackRevisionHistoryItem } from "../src/types";
import i18n from "../src/i18n";

let scenarios = 0;
async function scenario(name: string, run: () => void | Promise<void>) {
  await run(); scenarios++; process.stdout.write(`PASS ${name}\n`);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const metadataKeys = ["id", "revisionNumber", "baseRevisionId", "sourceKind", "createdAt", "generatedAt", "contentHash",
  "generationMode", "generationModel", "generationUsedFallback", "reviewState"];
const bodyKeys = ["rawTask", "taskType", "targetTool", "generatedPrompt"];
const row = (id = 187, revisionNumber = 3): TaskPackRevisionHistoryItem => ({ id, revisionNumber, baseRevisionId: 102,
  sourceKind: "manual_edit", createdAt: "2026-01-03T12:00:00.000Z", generatedAt: null,
  contentHash: `sha256:${"a".repeat(64)}`, generationMode: "template", generationModel: null,
  generationUsedFallback: false, reviewState: "unreviewed" });
const history = (taskPackId = 7): TaskPackRevisionHistory => ({ taskPackId, currentRevisionId: 187,
  revisions: [row(), { ...row(102, 2), baseRevisionId: 91, sourceKind: "generated", reviewState: "accepted",
    generatedAt: "2026-01-02T12:00:00Z", generationMode: "ollama", generationModel: "fixture-model", generationUsedFallback: true },
    { ...row(91, 1), baseRevisionId: null, sourceKind: "imported", reviewState: "changes_requested" }] });
const rawTask = "  EXACT_RAW\ttext\r\n\r\nlast line  \n";
const generatedPrompt = "\t# EXACT_DOCUMENT\r\n\r\n  **authored**  \r\n<script>private content</script>\n";
const detail = (revisionId = 102, taskPackId = 7): TaskPackRevisionDetail => ({ taskPackId, currentRevisionId: 187,
  revision: { ...history(taskPackId).revisions.find(item => item.id === revisionId)!, rawTask,
    taskType: "bugfix", targetTool: "generic", generatedPrompt } });
const envelope = () => ({ ok: true, history: history() });
const detailEnvelope = (id = 102) => ({ ok: true, revision: detail(id) });
const fixture = (overrides: Partial<TaskPackRevisionHistoryApi> = {}) => {
  const calls: string[] = [];
  const api: TaskPackRevisionHistoryApi = {
    getTaskPackRevisionHistory: async id => { calls.push(`history:${id}`); return history(id); },
    getTaskPackRevisionDetail: async (id, revisionId) => { calls.push(`detail:${id}:${revisionId}`); return detail(revisionId, id); },
    ...overrides,
  };
  return { calls, api, controller: createTaskPackRevisionHistoryController(7, api) };
};
const source = (file: string) => fs.readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
const pageSource = source("pages/TaskPackResultPage.tsx");
const panelSource = source("components/taskPacks/TaskPackRevisionHistoryPanel.tsx");
const ownerSource = source("utils/taskPackRevisionHistory.ts");
const hookSource = source("hooks/useTaskPackRevisionHistory.ts");
const navigationSource = source("hooks/useWorkspaceNavigationHistory.ts");
const actions = { onRefresh: async () => {}, onRetryHistory: async () => {},
  onSelectRevision: async () => {}, onRetryDetail: async () => {}, onStartComparison: () => {}, onChooseComparisonRevision: () => {},
  onCompareSelectedRevisions: async () => {}, onSwapComparisonSides: () => {}, onClearComparison: () => {}, onRetryComparison: async () => {} };
const ready = (patch: Partial<TaskPackRevisionHistorySnapshot> = {}): TaskPackRevisionHistorySnapshot => ({
  taskPackId: 7, status: "ready", history: history(), selectedRevisionId: null, detailStatus: "idle", detail: null,
  detailUnavailable: false, comparison: emptyTaskPackRevisionComparison(), ...patch,
});
const render = (state = ready()) => renderToStaticMarkup(createElement(TaskPackRevisionHistoryPanel, { ...state, ...actions }));

await scenario("closed valid history envelope parses, copying all safe metadata", () => {
  const input = envelope(), parsed = parseTaskPackRevisionHistoryResponse(input, 7);
  assert.deepEqual(parsed, input.history);
  assert.deepEqual(Object.keys(parsed.revisions[0]).sort(), [...metadataKeys].sort());
  assert.notEqual(parsed, input.history); assert.notEqual(parsed.revisions[0], input.history.revisions[0]);
  assert.ok(Object.isFrozen(parsed) && Object.isFrozen(parsed.revisions) && Object.isFrozen(parsed.revisions[0]));
});
await scenario("closed detail envelope copies exact allowed fields", () => {
  const parsed = parseTaskPackRevisionDetailResponse(detailEnvelope(), 7, 102);
  assert.deepEqual(parsed, detail());
  assert.deepEqual(Object.keys(parsed).sort(), ["taskPackId", "currentRevisionId", "revision"].sort());
  assert.deepEqual(Object.keys(parsed.revision).sort(), [...metadataKeys, ...bodyKeys].sort());
});
await scenario("nullable metadata and authored empty model parse without coercion", () => {
  const input = { ok: true, history: { ...history(), revisions: [{ ...row(), baseRevisionId: null, generationModel: "" }] } };
  const parsed = parseTaskPackRevisionHistoryResponse(input, 7).revisions[0];
  assert.equal(parsed.baseRevisionId, null); assert.equal(parsed.generatedAt, null); assert.equal(parsed.generationModel, "");
});
await scenario("ordinal is not the global identity", () => {
  const parsed = parseTaskPackRevisionHistoryResponse(envelope(), 7).revisions[0];
  assert.equal(parsed.id, 187); assert.equal(parsed.revisionNumber, 3);
});
await scenario("raw task preserves spaces, tabs, CRLF, blank lines and trailing newline", () => {
  assert.equal(parseTaskPackRevisionDetailResponse(detailEnvelope(), 7, 102).revision.rawTask, rawTask);
});
await scenario("generated prompt preserves exact Markdown and authored line endings", () => {
  assert.equal(parseTaskPackRevisionDetailResponse(detailEnvelope(), 7, 102).revision.generatedPrompt, generatedPrompt);
});
await scenario("empty authored strings remain strings", () => {
  const input = { ok: true, revision: { ...detail(), revision: { ...detail().revision, rawTask: "", generatedPrompt: "" } } };
  const parsed = parseTaskPackRevisionDetailResponse(input, 7, 102);
  assert.equal(parsed.revision.rawTask, ""); assert.equal(parsed.revision.generatedPrompt, "");
});
await scenario("malformed envelopes and task ownership are rejected", () => {
  for (const input of [null, [], {}, { ok: false, history: history() }, { ok: true },
    { ...envelope(), message: "private" }, { ok: true, history: history(8) }]) {
    assert.throws(() => parseTaskPackRevisionHistoryResponse(input, 7));
  }
  for (const input of [null, [], {}, { ok: false, revision: detail() }, { ok: true },
    { ...detailEnvelope(), stack: "private" }, { ok: true, revision: detail(102, 8) }]) {
    assert.throws(() => parseTaskPackRevisionDetailResponse(input, 7, 102));
  }
});
await scenario("wrapper IDs, missing fields and payload collections are strictly validated", () => {
  for (const id of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "187", null]) {
    assert.throws(() => parseTaskPackRevisionHistoryResponse({ ok: true, history: { ...history(), currentRevisionId: id } }, 7));
    assert.throws(() => parseTaskPackRevisionDetailResponse({ ok: true, revision: { ...detail(), currentRevisionId: id } }, 7, 102));
  }
  for (const revisions of [null, {}, "rows"]) assert.throws(() =>
    parseTaskPackRevisionHistoryResponse({ ok: true, history: { ...history(), revisions } }, 7));
  for (const key of ["taskPackId", "currentRevisionId", "revisions"]) {
    const value: Record<string, unknown> = { ...history() }; delete value[key];
    assert.throws(() => parseTaskPackRevisionHistoryResponse({ ok: true, history: value }, 7));
  }
  for (const key of ["taskPackId", "currentRevisionId", "revision"]) {
    const value: Record<string, unknown> = { ...detail() }; delete value[key];
    assert.throws(() => parseTaskPackRevisionDetailResponse({ ok: true, revision: value }, 7, 102));
  }
});
for (const [field, values] of Object.entries({
  id: [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "187"], revisionNumber: [0, "3", 1.5],
  baseRevisionId: [undefined, 0, "102"], sourceKind: ["unknown", ["generated"], 3],
  createdAt: [null, "2026-02-30T12:00:00Z", "2026-01-03", "2026-01-03T12:00:00+00:00"],
  generatedAt: [undefined, "invalid"], contentHash: ["private", `sha256:${"A".repeat(64)}`],
  generationMode: ["unknown", null], generationModel: [undefined, 3, {}], generationUsedFallback: [0, "false"],
  reviewState: ["unknown", ["accepted"], null],
})) await scenario(`metadata rejects invalid ${field}`, () => {
  for (const value of values) assert.throws(() => parseTaskPackRevisionHistoryResponse({ ok: true,
    history: { ...history(), revisions: [{ ...row(), [field]: value }] } }, 7));
});
await scenario("missing metadata and duplicate identity/ordinal are rejected", () => {
  for (const field of metadataKeys) {
    const item: Record<string, unknown> = { ...row() }; delete item[field];
    assert.throws(() => parseTaskPackRevisionHistoryResponse({ ok: true, history: { ...history(), revisions: [item] } }, 7));
  }
  for (const revisions of [[row(), row()], [row(), row(200, 3)]]) assert.throws(() =>
    parseTaskPackRevisionHistoryResponse({ ok: true, history: { ...history(), revisions } }, 7));
});
await scenario("detail validates requested identity and body field types", () => {
  assert.throws(() => parseTaskPackRevisionDetailResponse(detailEnvelope(), 7, 187));
  for (const field of bodyKeys) {
    const input = detailEnvelope(); const revision: Record<string, unknown> = { ...input.revision.revision, [field]: null };
    assert.throws(() => parseTaskPackRevisionDetailResponse({ ...input, revision: { ...input.revision, revision } }, 7, 102));
    delete revision[field];
    assert.throws(() => parseTaskPackRevisionDetailResponse({ ...input, revision: { ...input.revision, revision } }, 7, 102));
  }
});
const forbidden = ["lifecycle", "lifecycleVersion", "acceptedRevisionId", "completedAt", "archivedAt", "diagnostics",
  "generationRecipe", "groundedContextSnapshot", "freshnessBasis", "reviewEvents", "actorId", "eventId", "metadata", "cause", "stack"];
await scenario("private fields fail closed at every public DTO nesting boundary", () => {
  for (const field of forbidden) {
    assert.throws(() => parseTaskPackRevisionHistoryResponse({ ...envelope(), [field]: "private" }, 7));
    assert.throws(() => parseTaskPackRevisionHistoryResponse({ ok: true, history: { ...history(), [field]: "private" } }, 7));
    assert.throws(() => parseTaskPackRevisionHistoryResponse({ ok: true, history: { ...history(), revisions: [{ ...row(), [field]: "private" }] } }, 7));
    assert.throws(() => parseTaskPackRevisionDetailResponse({ ...detailEnvelope(), [field]: "private" }, 7, 102));
    assert.throws(() => parseTaskPackRevisionDetailResponse({ ok: true, revision: { ...detail(), [field]: "private" } }, 7, 102));
    assert.throws(() => parseTaskPackRevisionDetailResponse({ ok: true, revision: { ...detail(), revision: { ...detail().revision, [field]: "private" } } }, 7, 102));
  }
  for (const field of bodyKeys) assert.throws(() => parseTaskPackRevisionHistoryResponse({ ok: true,
    history: { ...history(), revisions: [{ ...row(), [field]: "body" }] } }, 7));
});

const originalFetch = globalThis.fetch;
try {
  const requests: { url: string; method: string; body: unknown }[] = [];
  let response: unknown = envelope();
  let status = 200;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), method: init?.method ?? "GET", body: init?.body });
    return new Response(JSON.stringify(response), { status, headers: { "Content-Type": "application/json" } });
  };
  await scenario("client history uses one GET on the existing API path", async () => {
    assert.deepEqual(await getTaskPackRevisionHistory(7), history());
    assert.deepEqual(requests, [{ url: "http://localhost:4000/api/task-packs/7/revisions", method: "GET", body: undefined }]);
  });
  await scenario("client detail requests only the selected global revision ID", async () => {
    requests.length = 0; response = detailEnvelope();
    assert.deepEqual(await getTaskPackRevisionDetail(7, 102), detail());
    assert.deepEqual(requests, [{ url: "http://localhost:4000/api/task-packs/7/revisions/102", method: "GET", body: undefined }]);
  });
  await scenario("invalid caller IDs are rejected before HTTP", async () => {
    requests.length = 0;
    for (const id of [0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      await assert.rejects(getTaskPackRevisionHistory(id));
      await assert.rejects(getTaskPackRevisionDetail(7, id));
      await assert.rejects(getTaskPackRevisionDetail(id, 102));
    }
    assert.equal(requests.length, 0);
  });
  await scenario("client does not return unvalidated response JSON", async () => {
    response = { ...detailEnvelope(), diagnostics: { secret: "private" } };
    await assert.rejects(getTaskPackRevisionDetail(7, 102), /Invalid Task Pack revision history response/);
    response = { ok: true, history: { ...history(), lifecycleVersion: 3 } };
    await assert.rejects(getTaskPackRevisionHistory(7));
  });
  await scenario("API errors reuse ApiRequestError but UI owner retains no backend message/data", async () => {
    status = 500; response = { ok: false, code: "TASK_PACK_REVISION_HISTORY_FAILED", message: "private SQL driver details", cause: "secret" };
    await assert.rejects(getTaskPackRevisionHistory(7), error => error instanceof ApiRequestError && error.status === 500);
    const controller = createTaskPackRevisionHistoryController(7, { getTaskPackRevisionHistory, getTaskPackRevisionDetail });
    await controller.activate();
    assert.equal(controller.getSnapshot().status, "failed");
    assert.doesNotMatch(JSON.stringify(controller.getSnapshot()), /SQL|driver|private|secret|cause|stack|message/);
    assert.doesNotMatch(render(controller.getSnapshot()), /SQL|driver|private|secret|cause|stack/);
    controller.dispose();
  });
} finally { globalThis.fetch = originalFetch; }

await scenario("activation performs exactly one list request and no detail prefetch", async () => {
  const f = fixture(); assert.equal(f.controller.getSnapshot().status, "idle");
  await f.controller.activate(); await f.controller.activate();
  assert.deepEqual(f.calls, ["history:7"]); assert.equal(f.controller.getSnapshot().selectedRevisionId, null);
  assert.equal(f.controller.getSnapshot().detail, null); f.controller.dispose();
});
await scenario("large history still costs one request, not one per row", async () => {
  let reads = 0, details = 0;
  const f = fixture({ getTaskPackRevisionHistory: async () => { reads++; return { ...history(),
    revisions: Array.from({ length: 1000 }, (_, i) => row(i + 1, i + 1)) }; },
    getTaskPackRevisionDetail: async () => { details++; return detail(); } });
  await f.controller.activate(); assert.equal(reads, 1); assert.equal(details, 0);
  assert.equal(f.controller.getSnapshot().history?.revisions.length, 1000); f.controller.dispose();
});
await scenario("one selection gives one detail read without unrelated row reads", async () => {
  const f = fixture(); await f.controller.activate(); await f.controller.selectRevision(102);
  assert.deepEqual(f.calls, ["history:7", "detail:7:102"]);
  assert.equal(f.controller.getSnapshot().detail?.revision.id, 102);
  await f.controller.selectRevision(91);
  assert.deepEqual(f.calls, ["history:7", "detail:7:102", "detail:7:91"]); f.controller.dispose();
});
await scenario("selection never accepts an unrelated/unlisted identity", async () => {
  const f = fixture(); await f.controller.activate(); await f.controller.selectRevision(999); await f.controller.selectRevision(0);
  assert.deepEqual(f.calls, ["history:7"]); f.controller.dispose();
});
await scenario("current revision selection still uses read-only detail", async () => {
  const f = fixture(); await f.controller.activate(); await f.controller.selectRevision(187);
  assert.equal(f.controller.getSnapshot().detail?.revision.id, 187);
  assert.deepEqual(f.calls, ["history:7", "detail:7:187"]); f.controller.dispose();
});
await scenario("history refresh performs one reread and no automatic detail request", async () => {
  const f = fixture(); await f.controller.activate(); await f.controller.selectRevision(102); await f.controller.refresh();
  assert.deepEqual(f.calls, ["history:7", "detail:7:102", "history:7"]);
  assert.equal(f.controller.getSnapshot().selectedRevisionId, null); f.controller.dispose();
});
await scenario("failed history has one explicit retry and no automatic retry", async () => {
  let count = 0;
  const f = fixture({ getTaskPackRevisionHistory: async () => { if (++count === 1) throw new Error("private"); return history(); } });
  await f.controller.activate(); assert.equal(count, 1); assert.equal(f.controller.getSnapshot().status, "failed");
  await f.controller.retryHistory(); assert.equal(count, 2); assert.equal(f.controller.getSnapshot().status, "ready"); f.controller.dispose();
});
await scenario("detail failure preserves ready history and retry reads only the selected detail", async () => {
  let count = 0;
  const f = fixture({ getTaskPackRevisionDetail: async () => { if (++count === 1) throw new Error("private SQL"); return detail(); } });
  await f.controller.activate(); const list = f.controller.getSnapshot().history;
  await f.controller.selectRevision(102);
  assert.equal(f.controller.getSnapshot().status, "ready"); assert.equal(f.controller.getSnapshot().history, list);
  assert.equal(f.controller.getSnapshot().detailStatus, "failed"); assert.equal(count, 1);
  await f.controller.retryDetail(); assert.equal(count, 2); assert.equal(f.controller.getSnapshot().history, list);
  assert.equal(f.controller.getSnapshot().detailStatus, "ready"); assert.deepEqual(f.calls, ["history:7"]); f.controller.dispose();
});
await scenario("detail 404 has safe unavailable state without replacing the current pack", async () => {
  const f = fixture({ getTaskPackRevisionDetail: async () => { throw new ApiRequestError("private SQL", 404, { cause: "secret" }); } });
  await f.controller.activate(); await f.controller.selectRevision(102);
  assert.equal(f.controller.getSnapshot().detailUnavailable, true); assert.equal(f.controller.getSnapshot().status, "ready");
  assert.equal(f.controller.getSnapshot().detail, null); assert.doesNotMatch(JSON.stringify(f.controller.getSnapshot()), /private|SQL|cause/);
  f.controller.dispose();
});
await scenario("late Task Pack A history cannot populate new Task Pack B owner", async () => {
  const pending = deferred<unknown>();
  const a = fixture({ getTaskPackRevisionHistory: () => pending.promise });
  const waiting = a.controller.activate(); a.controller.dispose();
  const b = createTaskPackRevisionHistoryController(8, { getTaskPackRevisionHistory: async () => history(8), getTaskPackRevisionDetail: async () => detail(102, 8) });
  assert.equal(b.getSnapshot().history, null); await b.activate(); pending.resolve(history()); await waiting;
  assert.equal(a.controller.getSnapshot().history, null); assert.equal(b.getSnapshot().history?.taskPackId, 8); b.dispose();
});
await scenario("late Task Pack A detail cannot populate B after disposal", async () => {
  const pending = deferred<unknown>(); const a = fixture({ getTaskPackRevisionDetail: () => pending.promise });
  await a.controller.activate(); const waiting = a.controller.selectRevision(102); a.controller.dispose();
  const b = createTaskPackRevisionHistoryController(8, { getTaskPackRevisionHistory: async () => history(8), getTaskPackRevisionDetail: async () => detail(187, 8) });
  await b.activate(); await b.selectRevision(187); pending.resolve(detail()); await waiting;
  assert.equal(a.controller.getSnapshot().detail, null); assert.equal(b.getSnapshot().detail?.taskPackId, 8);
  assert.equal(b.getSnapshot().selectedRevisionId, 187); b.dispose();
});
await scenario("late revision 2 cannot replace selected revision 3", async () => {
  const older = deferred<unknown>(), newer = deferred<unknown>();
  const f = fixture({ getTaskPackRevisionDetail: async (_id, revisionId) => revisionId === 102 ? older.promise : newer.promise });
  await f.controller.activate(); const waiting = f.controller.selectRevision(102); const selected = f.controller.selectRevision(187);
  newer.resolve(detail(187)); await selected; older.resolve(detail(102)); await waiting;
  assert.equal(f.controller.getSnapshot().selectedRevisionId, 187); assert.equal(f.controller.getSnapshot().detail?.revision.revisionNumber, 3);
  f.controller.dispose();
});
await scenario("late failure from an older selection cannot clear successful newer detail", async () => {
  const older = deferred<unknown>();
  const f = fixture({ getTaskPackRevisionDetail: async (_id, revisionId) => revisionId === 102 ? older.promise : detail(187) });
  await f.controller.activate(); const waiting = f.controller.selectRevision(102); await f.controller.selectRevision(187);
  older.reject(new Error("private")); await waiting;
  assert.equal(f.controller.getSnapshot().detailStatus, "ready"); assert.equal(f.controller.getSnapshot().detail?.revision.id, 187); f.controller.dispose();
});
await scenario("duplicate pending clicks cost one read; clearing selection invalidates pending detail", async () => {
  const pending = deferred<unknown>(); let count = 0;
  const f = fixture({ getTaskPackRevisionDetail: () => { count++; return pending.promise; } });
  await f.controller.activate(); const waiting = f.controller.selectRevision(102); await f.controller.selectRevision(102);
  assert.equal(count, 1); f.controller.clearSelection(); pending.resolve(detail()); await waiting;
  assert.equal(f.controller.getSnapshot().detailStatus, "idle"); assert.equal(f.controller.getSnapshot().detail, null); f.controller.dispose();
});
await scenario("history refresh invalidates pending selected detail", async () => {
  const pending = deferred<unknown>(); const f = fixture({ getTaskPackRevisionDetail: () => pending.promise });
  await f.controller.activate(); const waiting = f.controller.selectRevision(102); await f.controller.refresh();
  pending.resolve(detail()); await waiting;
  assert.equal(f.controller.getSnapshot().selectedRevisionId, null); assert.equal(f.controller.getSnapshot().detail, null); f.controller.dispose();
});
await scenario("reactivation ignores preceding disposed reads (StrictMode ownership)", async () => {
  const pending = deferred<unknown>(); let count = 0;
  const f = fixture({ getTaskPackRevisionHistory: async () => ++count === 1 ? pending.promise : history() });
  const waiting = f.controller.activate(); f.controller.dispose(); await f.controller.activate();
  pending.reject(new Error("private")); await waiting;
  assert.equal(f.controller.getSnapshot().status, "ready"); assert.equal(count, 2); f.controller.dispose();
});
await scenario("disposed owner and idle retry cannot issue reads", async () => {
  const f = fixture(); await f.controller.retryHistory(); await f.controller.retryDetail(); assert.equal(f.calls.length, 0);
  await f.controller.activate(); f.controller.dispose(); await f.controller.refresh(); await f.controller.selectRevision(102);
  assert.deepEqual(f.calls, ["history:7"]);
});
await scenario("observable owner notifies subscribers and supports cleanup", async () => {
  const f = fixture(); let notifications = 0; const unsubscribe = f.controller.subscribe(() => { notifications++; });
  await f.controller.activate(); assert.ok(notifications >= 2); unsubscribe(); const saved = notifications;
  await f.controller.selectRevision(102); assert.equal(notifications, saved); f.controller.dispose();
});
await scenario("no polling, per-row Promise.all, current-workflow reads or mutation capability", () => {
  assert.doesNotMatch(ownerSource + hookSource, /setInterval|setTimeout|Promise\.all\([^\n]*\.map\(|getTaskPackWorkflow|transitionTaskPack|updateTaskPack|createTaskPackEditorSession/);
  assert.match(ownerSource, /Promise\.all\(\[readSide\(leftRevisionId\), readSide\(rightRevisionId\)\]\)/); // fixed two-side 06D read, not N+1
  assert.match(hookSource, /\[taskPackId\]/); assert.match(hookSource, /return controller.dispose/);
  assert.match(hookSource, /useSyncExternalStore/);
});

await i18n.changeLanguage("en");
await scenario("history renders inside Review without introducing a fourth mode", () => {
  assert.deepEqual(TASK_PACK_WORKSPACE_VIEWS, ["document", "review", "details"]);
  const review = pageSource.slice(pageSource.indexOf('data-task-pack-view="review"'), pageSource.indexOf('hidden={workspaceView !== "details"}'));
  assert.match(review, /<TaskPackRevisionHistoryPanel/); assert.match(review, /<TaskPackWorkflowCard/);
  assert.equal((pageSource.match(/useTaskPackRevisionHistory\(/g) ?? []).length, 1);
  assert.equal((pageSource.match(/useTaskPackWorkflow\(/g) ?? []).length, 1);
});
await scenario("Result history has separate owner, no current document/editor/navigation writes", () => {
  assert.match(pageSource, /useTaskPackRevisionHistory\(taskPack.id\)/);
  const binding = pageSource.match(/<TaskPackRevisionHistoryPanel[\s\S]*?\/>/)![0];
  assert.doesNotMatch(binding, /currentTaskPack|onTaskPackUpdated|editorSession|workflowController|onOpenInBuilder/);
  assert.doesNotMatch(navigationSource, /TaskPackRevisionDetail|selectedRevisionId|revisionHistory/);
  assert.doesNotMatch(panelSource, /fetch\(|api\/|useTaskPackWorkflow|currentReviewState|acceptedRevisionId|\blifecycle\s*[:=.]|onSave|onEdit|onExecute|onExport/);
});
await scenario("row labels use revisionNumber, current marker uses identity and review uses each DTO", () => {
  const html = render();
  for (const label of ["Revision 3", "Revision 2", "Revision 1", "Current", "Accepted", "Changes requested", "Unreviewed"]) assert.ok(html.includes(label));
  assert.doesNotMatch(html, /Revision 187|Revision 102|Revision 91|Active|Completed/);
  assert.match(panelSource, /revision.id === history.currentRevisionId/);
  assert.match(panelSource, /number: revision.revisionNumber/);
  assert.match(panelSource, /<RevisionReviewBadge state=\{revision.reviewState\}/);
  assert.equal((html.match(/>Current<\/span>/g) ?? []).length, 1);
});
await scenario("row metadata includes source, timestamps, mode/model and no bodies until selection", () => {
  const html = render();
  for (const label of ["Manual edit", "Generated", "Created", "Generation mode", "Generation model", "fixture-model"]) assert.ok(html.includes(label));
  assert.doesNotMatch(html, /EXACT_RAW|EXACT_DOCUMENT/); assert.match(html, /Select a revision/);
});
await scenario("history loading is local and has no detail surface", () => {
  const html = render(ready({ status: "loading", history: null }));
  assert.match(html, /Loading history/); assert.match(html, /role="status"/); assert.doesNotMatch(html, /data-historical-revision/);
});
await scenario("history failure renders localized retry without raw error", () => {
  const html = render(ready({ status: "failed", history: null }));
  assert.match(html, /Revision history is unavailable/); assert.match(html, />Retry<\/button>/);
  assert.doesNotMatch(html, /SQL|driver|stack|cause/);
});
await scenario("empty history is safe, no-selection state is localized", () => {
  assert.match(render(ready({ history: { ...history(), revisions: [] } })), /No revisions available/);
  assert.match(render(), /Select a revision to inspect its content/);
});
await scenario("detail loading preserves usable history list", () => {
  const html = render(ready({ selectedRevisionId: 102, detailStatus: "loading" }));
  assert.match(html, /Loading revision/); assert.match(html, /Revision 3/); assert.match(html, /aria-pressed="true"/);
  assert.doesNotMatch(html, /data-historical-revision/);
});
await scenario("detail failure and 404 retain rows with safe retry", () => {
  const html = render(ready({ selectedRevisionId: 102, detailStatus: "failed" }));
  assert.match(html, /Revision could not be loaded/); assert.match(html, /Revision 3/); assert.match(html, />Retry<\/button>/);
  assert.match(render(ready({ selectedRevisionId: 102, detailStatus: "failed", detailUnavailable: true })), /This revision is no longer available/);
});
const selected = () => ready({ selectedRevisionId: 102, detailStatus: "ready", detail: detail() });
await scenario("historical viewer renders ordinal, read-only status, metadata and its own review", () => {
  const html = render(selected());
  for (const label of ["Revision 2", "Historical revision", "Read only", "Accepted", "bugfix", "generic",
    "fixture-model", "Fallback used", "Content hash", "Base revision ID"]) assert.ok(html.includes(label), label);
  assert.doesNotMatch(html, /Revision 102/);
});
await scenario("authored content is escaped and rendered without trimming, tabs/CRLF normalization", () => {
  const html = render(selected());
  const task = html.match(/<pre data-historical-raw-task[^>]*>([\s\S]*?)<\/pre>/)![1];
  const document = html.match(/<pre data-historical-generated-document[^>]*>([\s\S]*?)<\/pre>/)![1];
  assert.equal(task, rawTask);
  assert.equal(document, generatedPrompt.replace(/</g, "&lt;").replace(/>/g, "&gt;"));
  assert.doesNotMatch(html, /<script>/); assert.match(html, /whitespace-pre-wrap/);
});
await scenario("selecting current revision still renders only a read-only history document", () => {
  const html = render(ready({ selectedRevisionId: 187, detailStatus: "ready", detail: detail(187) }));
  assert.match(html, /Current revision, shown read-only/); assert.match(html, /Read only/);
  assert.doesNotMatch(html, /<textarea|contenteditable/);
});
await scenario("historical article contains no mutation, export or comparison controls", () => {
  const html = render(selected()), article = html.slice(html.indexOf("<article"), html.indexOf("</article>") + 10);
  assert.doesNotMatch(article, /<button|<input|<textarea|contenteditable|<a\b/);
  assert.doesNotMatch(panelSource, /onSave|onEdit|onComplete|onArchive|onAccept|onRestore|onRevert|onPromote|onPublish|\.\.\/api\//i);
  assert.doesNotMatch(article, />Save<|>Edit<|>Archive<|>Complete<|>Accept<|>Compare<|>Export</);
});
await scenario("current Result editor and workflow wiring remain authoritative", () => {
  assert.match(pageSource, /workflow.lifecycle.state === "active"/);
  assert.match(pageSource, /setCurrentTaskPack\(nextTaskPack\);\s*onTaskPackUpdated\?\.\(nextTaskPack\)/);
  assert.match(pageSource, /<TaskPackDocumentView taskPack=\{currentTaskPack\}/);
  assert.match(pageSource, /taskPackForSession.currentRevisionId !== editAuthority.current.revisionId/);
  assert.doesNotMatch(pageSource, /setCurrentTaskPack\([^)]*(?:revisionHistory|\.detail)/);
});
await scenario("EN/RU keysets match recursively and every source kind is localized", () => {
  const en = i18n.getResourceBundle("en", "translation"), ru = i18n.getResourceBundle("ru", "translation");
  function keys(value: Record<string, unknown>, prefix = ""): string[] {
    return Object.entries(value).flatMap(([key, item]) => typeof item === "object" && item !== null
      ? keys(item as Record<string, unknown>, `${prefix}${key}.`) : [`${prefix}${key}`]).sort();
  }
  assert.deepEqual(keys(en.taskPackRevisionHistory), keys(ru.taskPackRevisionHistory));
  // Check the entire new namespace, including nested labels. Other namespaces
  // have existing locale-specific plural categories and are not changed here.
  for (const sourceKind of ["generated", "manual_edit", "regenerated", "imported", "split", "legacy_snapshot"]) {
    assert.ok(en.taskPackRevisionHistory.sources[sourceKind]); assert.ok(ru.taskPackRevisionHistory.sources[sourceKind]);
  }
  assert.equal(ru.taskPackRevisionHistory.revision, "Ревизия {{number}}");
});
await i18n.changeLanguage("ru");
await scenario("Russian viewer and failure states are localized and read-only", () => {
  const html = render(selected());
  for (const label of ["История ревизий", "Ревизия 2", "Только чтение", "Исходная задача", "Сгенерированный документ", "Принят"]) assert.ok(html.includes(label));
  assert.match(render(ready({ status: "failed", history: null })), /Повторить/);
  assert.match(render(ready({ selectedRevisionId: 102, detailStatus: "failed", detailUnavailable: true })), /Эта ревизия больше недоступна/);
});

process.stdout.write(`Task Pack revision history smoke passed: ${scenarios} scenarios (runtime parsing, HTTP client, read ownership/races, rendered markup and narrow wiring guards; not visual Desktop QA).\n`);
