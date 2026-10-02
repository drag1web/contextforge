import assert from "node:assert/strict";
import fs from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getCurrentTaskPackWorkflowSummaries, ApiRequestError } from "../src/api/client";
import { TaskPackWorkflowBadges } from "../src/components/taskPacks/TaskPackWorkflowCard";
import type { TaskPack, TaskPackWorkflowSummary } from "../src/types";
import { createTaskPackWorkflowIndexController, filterTaskPacksByLifecycle, getTaskPackLifecycleCounts,
  pairTaskPacksWithWorkflowSummaries, parseTaskPackWorkflowIndex, taskPackWorkflowCollectionSignature } from "../src/utils/taskPackWorkflowIndex";
import i18n from "../src/i18n";

let passed = 0;
async function scenario(name: string, run: () => void | Promise<void>) {
  await run(); passed++; process.stdout.write(`PASS ${name}\n`);
}
const summary = (overrides: Partial<TaskPackWorkflowSummary> = {}): TaskPackWorkflowSummary => ({
  taskPackId: 1, currentRevisionId: 10, lifecycle: { state: "active", archivedFromState: null }, currentReviewState: "unreviewed", ...overrides,
});
const envelope = (workflows: unknown[] = [summary()]) => ({ ok: true, workflows });
const index = (...items: TaskPackWorkflowSummary[]) => new Map(items.map(item => [item.taskPackId, item]));
const pack = { id: 1, currentRevisionId: 10 };
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture(read: () => Promise<readonly TaskPackWorkflowSummary[]> = async () => [summary()]) {
  let calls = 0;
  const controller = createTaskPackWorkflowIndexController({ getCurrentTaskPackWorkflowSummaries: () => { calls++; return read(); } });
  return { controller, calls: () => calls };
}
const source = (path: string) => fs.readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const page = source("pages/TaskPacksPage.tsx");
const helper = source("utils/taskPackWorkflowIndex.ts");
const hook = source("hooks/useTaskPackWorkflowIndex.ts");
const badge = source("components/taskPacks/TaskPackWorkflowCard.tsx");

await scenario("empty envelope parses as frozen empty index", () => {
  const result = parseTaskPackWorkflowIndex(envelope([])); assert.deepEqual(result, []); assert.ok(Object.isFrozen(result));
});
for (const [lifecycle, review] of [
  [{ state: "active", archivedFromState: null }, "unreviewed"],
  [{ state: "active", archivedFromState: null }, "in_review"],
  [{ state: "active", archivedFromState: null }, "changes_requested"],
  [{ state: "completed", archivedFromState: null }, "accepted"],
  [{ state: "archived", archivedFromState: "active" }, "unreviewed"],
  [{ state: "archived", archivedFromState: "completed" }, "accepted"],
] as const) await scenario(`parse ${lifecycle.state}/${lifecycle.archivedFromState}/${review}`, () => {
  const item = summary({ lifecycle, currentReviewState: review });
  const result = parseTaskPackWorkflowIndex(envelope([item]));
  assert.deepEqual(result, [item]); assert.notEqual(result[0], item);
  assert.ok(Object.isFrozen(result[0])); assert.ok(Object.isFrozen(result[0].lifecycle));
});
for (const value of [null, [], {}, { ok: false, workflows: [] }, { ok: true, workflows: null },
  { ...envelope(), extra: "private" }, { workflows: [] }]) await scenario(`reject malformed envelope ${JSON.stringify(value)}`, () => {
  assert.throws(() => parseTaskPackWorkflowIndex(value));
});
for (const key of ["taskPackId", "currentRevisionId", "lifecycle", "currentReviewState"]) await scenario(`reject missing summary ${key}`, () => {
  const item = { ...summary() } as Record<string, unknown>; delete item[key];
  assert.throws(() => parseTaskPackWorkflowIndex(envelope([item])));
});
for (const key of ["lifecycleVersion", "acceptedRevisionId", "event", "rawTask", "stack", "metadata"]) await scenario(`reject extra summary ${key}, never retain it`, () => {
  assert.throws(() => parseTaskPackWorkflowIndex(envelope([{ ...summary(), [key]: "PRIVATE" }])));
});
for (const id of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1", null]) await scenario(`reject invalid identity ${id}`, () => {
  for (const key of ["taskPackId", "currentRevisionId"]) assert.throws(() => parseTaskPackWorkflowIndex(envelope([{ ...summary(), [key]: id }])));
});
await scenario("positive MAX_SAFE identity parses without coercion", () => {
  assert.equal(parseTaskPackWorkflowIndex(envelope([summary({ taskPackId: Number.MAX_SAFE_INTEGER })]))[0].taskPackId, Number.MAX_SAFE_INTEGER);
});
for (const lifecycle of [null, { state: "active" }, { state: "active", archivedFromState: "active" },
  { state: "completed", archivedFromState: "completed" }, { state: "archived", archivedFromState: null },
  { state: "unknown", archivedFromState: null }, { state: "archived", archivedFromState: "archived" },
  { state: "active", archivedFromState: null, extra: "private" }]) await scenario(`reject invalid lifecycle ${JSON.stringify(lifecycle)}`, () => {
  assert.throws(() => parseTaskPackWorkflowIndex(envelope([{ ...summary(), lifecycle }])));
});
await scenario("reject invalid review state", () => {
  for (const state of ["ready", "Accepted", null, "", 1]) assert.throws(() => parseTaskPackWorkflowIndex(envelope([{ ...summary(), currentReviewState: state }])));
});
await scenario("duplicate Task Pack id fails whole index, including different revision", () => {
  assert.throws(() => parseTaskPackWorkflowIndex(envelope([summary(), summary({ currentRevisionId: 11 })])));
});
await scenario("parser retains exactly public keys and independent frozen lifecycle", () => {
  const input = summary(); const result = parseTaskPackWorkflowIndex(envelope([input]))[0];
  input.lifecycle.state = "completed";
  assert.equal(result.lifecycle.state, "active");
  assert.deepEqual(Object.keys(result).sort(), ["currentRevisionId", "currentReviewState", "lifecycle", "taskPackId"].sort());
  assert.deepEqual(Object.keys(result.lifecycle).sort(), ["archivedFromState", "state"]);
});

await scenario("same id and current revision safely pair", () => {
  assert.equal(pairTaskPacksWithWorkflowSummaries([pack], index(summary())).get(1)?.currentRevisionId, 10);
});
await scenario("id-only pairing cannot classify a different revision", () => {
  assert.equal(pairTaskPacksWithWorkflowSummaries([pack], index(summary({ currentRevisionId: 11 }))).size, 0);
});
await scenario("missing summary or missing flat revision remain unresolved", () => {
  assert.equal(pairTaskPacksWithWorkflowSummaries([pack], new Map()).size, 0);
  assert.equal(pairTaskPacksWithWorkflowSummaries([{ id: 1 }], index(summary())).size, 0);
});
await scenario("extra server summaries are ignored", () => {
  assert.equal(pairTaskPacksWithWorkflowSummaries([pack], index(summary(), summary({ taskPackId: 2 }))).size, 1);
});
await scenario("both archived origins classify archived; review does not affect lifecycle", () => {
  for (const archivedFromState of ["active", "completed"] as const) for (const currentReviewState of ["unreviewed", "in_review", "accepted", "changes_requested"] as const) {
    const paired = pairTaskPacksWithWorkflowSummaries([pack], index(summary({ lifecycle: { state: "archived", archivedFromState }, currentReviewState })));
    assert.deepEqual(filterTaskPacksByLifecycle([pack], paired, "archived"), [pack]);
    assert.deepEqual(filterTaskPacksByLifecycle([pack], paired, "active"), []);
  }
});
await scenario("unresolved stays in All, excluded from every lifecycle, counted only in total", () => {
  const items = [pack, { id: 2, currentRevisionId: 20 }, { id: 3, currentRevisionId: 30 }];
  const paired = pairTaskPacksWithWorkflowSummaries(items, index(summary(), summary({ taskPackId: 2, currentRevisionId: 21 })));
  assert.deepEqual(filterTaskPacksByLifecycle(items, paired, "all"), items);
  assert.deepEqual(getTaskPackLifecycleCounts(items, paired), { all: 3, active: 1, completed: 0, archived: 0 });
  for (const state of ["active", "completed", "archived"] as const) assert.ok(filterTaskPacksByLifecycle(items, paired, state).every(item => item.id === 1));
});
await scenario("lifecycle filtering composes with other filters/sort without mutating input", () => {
  const items = [{ ...pack, title: "auth", taskType: "backend", targetTool: "codex", generationMode: "template" },
    { id: 2, currentRevisionId: 20, title: "auth", taskType: "ui", targetTool: "codex", generationMode: "template" }];
  const paired = index(summary({ lifecycle: { state: "archived", archivedFromState: "active" } }),
    summary({ taskPackId: 2, currentRevisionId: 20, lifecycle: { state: "archived", archivedFromState: "completed" } }));
  const result = filterTaskPacksByLifecycle(items, paired, "archived").filter(item => item.title.includes("auth") && item.taskType === "backend" &&
    item.targetTool === "codex" && item.generationMode === "template").sort((a, b) => a.title.localeCompare(b.title));
  assert.deepEqual(result, [items[0]]); assert.equal(items.length, 2);
});
await scenario("collection signature stable across recreated/reordered arrays; revision/import invalidate", () => {
  const a = [pack, { id: 2, currentRevisionId: 20 }];
  assert.equal(taskPackWorkflowCollectionSignature(a), taskPackWorkflowCollectionSignature([...a].reverse().map(item => ({ ...item }))));
  assert.notEqual(taskPackWorkflowCollectionSignature(a), taskPackWorkflowCollectionSignature([{ ...pack, currentRevisionId: 11 }, a[1]]));
  assert.notEqual(taskPackWorkflowCollectionSignature(a), taskPackWorkflowCollectionSignature([...a, { id: 3, currentRevisionId: 30 }]));
});

await scenario("one activation one bulk GET, same signature does not fetch", async () => {
  const { controller, calls } = fixture(); await controller.activate("A"); await controller.activate("A");
  assert.equal(calls(), 1); assert.equal(controller.getSnapshot().status, "ready"); assert.equal(controller.getSnapshot().byTaskPackId.size, 1);
});
await scenario("collection growth does not grow reads: one refresh each for 1 and 50 packs", async () => {
  const { controller, calls } = fixture();
  await controller.activate(taskPackWorkflowCollectionSignature([pack]));
  assert.equal(calls(), 1);
  const many = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, currentRevisionId: i + 10 }));
  await controller.activate(taskPackWorkflowCollectionSignature(many));
  assert.equal(calls(), 2);
  await controller.activate(taskPackWorkflowCollectionSignature([...many].reverse())); assert.equal(calls(), 2);
});
await scenario("collection refresh immediately clears previous ready statuses while loading", async () => {
  const d = deferred<readonly TaskPackWorkflowSummary[]>(); let calls = 0;
  const { controller } = fixture(() => ++calls === 1 ? Promise.resolve([summary()]) : d.promise);
  await controller.activate("A"); const next = controller.activate("B");
  assert.equal(controller.getSnapshot().status, "loading"); assert.equal(controller.getSnapshot().byTaskPackId.size, 0);
  d.resolve([summary({ currentRevisionId: 11 })]); await next;
});
await scenario("duplicate Retry/activation while loading does not duplicate request", async () => {
  const d = deferred<readonly TaskPackWorkflowSummary[]>(); const { controller, calls } = fixture(() => d.promise);
  const first = controller.activate("A"); await controller.retry(); await controller.retry(); await controller.activate("A");
  assert.equal(calls(), 1); assert.equal(controller.getSnapshot().status, "loading");
  assert.equal(controller.getSnapshot().byTaskPackId.size, 0); d.resolve([summary()]); await first;
});
await scenario("private request failure publishes only safe failed state; explicit retry recovers", async () => {
  let fail = true; const { controller, calls } = fixture(async () => { if (fail) throw new Error("private SQL driver stack cause"); return [summary()]; });
  await controller.activate("A");
  assert.deepEqual(controller.getSnapshot(), { status: "failed", signature: "A", byTaskPackId: new Map() });
  assert.doesNotMatch(JSON.stringify(controller.getSnapshot()), /SQL|driver|stack|cause|private/);
  fail = false; await controller.retry(); assert.equal(calls(), 2); assert.equal(controller.getSnapshot().status, "ready");
});
await scenario("late A cannot overwrite B after collection revision/import change", async () => {
  const a = deferred<readonly TaskPackWorkflowSummary[]>(), b = deferred<readonly TaskPackWorkflowSummary[]>(); let request = 0;
  const { controller, calls } = fixture(() => ++request === 1 ? a.promise : b.promise);
  const first = controller.activate(taskPackWorkflowCollectionSignature([pack]));
  const signatureB = taskPackWorkflowCollectionSignature([{ ...pack, currentRevisionId: 11 }, { id: 2, currentRevisionId: 12 }]);
  const second = controller.activate(signatureB);
  b.resolve([summary({ currentRevisionId: 11 }), summary({ taskPackId: 2, currentRevisionId: 12 })]); await second;
  const newest = controller.getSnapshot(); a.resolve([summary()]); await first;
  assert.equal(controller.getSnapshot(), newest); assert.equal(controller.getSnapshot().signature, signatureB); assert.equal(calls(), 2);
});
await scenario("late failure A cannot clear ready B", async () => {
  const a = deferred<readonly TaskPackWorkflowSummary[]>(); let request = 0;
  const { controller } = fixture(() => ++request === 1 ? a.promise : Promise.resolve([summary({ currentRevisionId: 11 })]));
  const first = controller.activate("A"); await controller.activate("B"); a.reject(new Error("private")); await first;
  assert.equal(controller.getSnapshot().status, "ready"); assert.equal(controller.getSnapshot().byTaskPackId.get(1)?.currentRevisionId, 11);
});
await scenario("disposed owner ignores late success/failure and cannot retry", async () => {
  for (const fail of [false, true]) {
    const d = deferred<readonly TaskPackWorkflowSummary[]>(); const { controller, calls } = fixture(() => d.promise);
    const first = controller.activate("A"); controller.dispose(); const last = controller.getSnapshot(); await controller.retry();
    if (fail) d.reject(new Error("private")); else d.resolve([summary()]); await first;
    assert.equal(controller.getSnapshot(), last); assert.equal(calls(), 1);
  }
});
await scenario("StrictMode dispose/reactivate preserves new request ownership", async () => {
  const a = deferred<readonly TaskPackWorkflowSummary[]>(); let count = 0;
  const { controller } = fixture(() => ++count === 1 ? a.promise : Promise.resolve([summary({ currentRevisionId: 11 })]));
  const old = controller.activate("A"); controller.dispose(); await controller.activate("A"); a.resolve([summary()]); await old;
  assert.equal(controller.getSnapshot().byTaskPackId.get(1)?.currentRevisionId, 11);
});

const originalFetch = globalThis.fetch;
try {
  await scenario("actual API client performs exactly one bulk GET and validates entire envelope", async () => {
    const calls: string[] = [];
    globalThis.fetch = async (input, options) => { calls.push(String(input)); assert.equal(options?.method ?? "GET", "GET");
      assert.equal(options?.body, undefined); return new Response(JSON.stringify(envelope()), { status: 200 }); };
    assert.deepEqual(await getCurrentTaskPackWorkflowSummaries(), [summary()]);
    assert.deepEqual(calls, ["http://localhost:4000/api/task-packs/workflows/current"]);
  });
  await scenario("actual client rejects unknown envelope/summary fields", async () => {
    for (const body of [{ ...envelope(), rawTask: "private" }, envelope([{ ...summary(), lifecycleVersion: 9 }])]) {
      globalThis.fetch = async () => new Response(JSON.stringify(body), { status: 200 });
      await assert.rejects(getCurrentTaskPackWorkflowSummaries());
    }
  });
  await scenario("real client error stays ApiRequestError; controller never retains its private data", async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, code: "TASK_PACK_WORKFLOW_INDEX_FAILED",
      message: "private SQL driver", stack: "private", cause: "private" }), { status: 500 });
    await assert.rejects(getCurrentTaskPackWorkflowSummaries(), ApiRequestError);
    const controller = createTaskPackWorkflowIndexController({ getCurrentTaskPackWorkflowSummaries });
    await controller.activate("A"); assert.equal(controller.getSnapshot().status, "failed");
    assert.doesNotMatch(JSON.stringify(controller.getSnapshot()), /private|SQL|driver|stack|cause/);
  });
  await scenario("real API parser failure becomes safe failed index, never partial ready", async () => {
    globalThis.fetch = async () => new Response(JSON.stringify(envelope([summary(), { ...summary({ taskPackId: 2 }), currentReviewState: "invalid" }])), { status: 200 });
    const controller = createTaskPackWorkflowIndexController({ getCurrentTaskPackWorkflowSummaries });
    await controller.activate("A"); assert.equal(controller.getSnapshot().status, "failed"); assert.equal(controller.getSnapshot().byTaskPackId.size, 0);
  });
} finally { globalThis.fetch = originalFetch; }

await scenario("flat TaskPack remains separate and summary contains no mutation authority", () => {
  const flat: "lifecycle" extends keyof TaskPack ? true : false = false;
  const cas: "lifecycleVersion" extends keyof TaskPackWorkflowSummary ? true : false = false;
  assert.equal(flat, false); assert.equal(cas, false);
});
await scenario("page owns one bulk hook, no individual reads, polling or transitions", () => {
  assert.equal((page.match(/useTaskPackWorkflowIndex\(taskPacks\)/g) ?? []).length, 1);
  // The existing Cloud bridge has independent inbox synchronization, not workflow polling.
  for (const code of [page.slice(page.indexOf("export function TaskPacksPage(")), hook, helper])
    assert.equal(/getTaskPackWorkflow\(|transitionTaskPackLifecycle|transitionTaskPackRevisionReview|Promise\.all|setInterval/.test(code), false);
  assert.match(hook, /activate\(signature\)/); assert.match(hook, /snapshot\.signature === signature/); assert.match(hook, /return controller\.dispose/);
});
await scenario("lifecycle is primary, generation remains advanced with task type/target/sort", () => {
  const selector = page.slice(page.indexOf("<fieldset"), page.indexOf("</fieldset>"));
  assert.match(selector, /items=\{lifecycleOptions\}/); assert.match(selector, /lifecycleFilter/); assert.match(selector, /disabled=\{!workflowReady\}/);
  assert.doesNotMatch(selector, /truncate/);
  const advanced = page.slice(page.indexOf('animate={{ gridTemplateRows: filtersOpen'), page.indexOf("<main"));
  for (const field of ["bodyModeFilter", "taskTypeFilter", "targetFilter", "sortMode"]) assert.ok(advanced.includes(`value={${field}}`));
  assert.match(page, /const advancedFilterCount = \[[\s\S]*?bodyModeFilter !== "all"/);
});
await scenario("clear resets lifecycle and all original filters", () => {
  const clear = page.slice(page.indexOf("function clearFilters()"), page.indexOf("async function handleCopy"));
  for (const setter of ['setLifecycleFilter("all")', 'setQuery("")', 'setTaskTypeFilter("all")', 'setTargetFilter("all")',
    'setBodyModeFilter("all")', 'setSortMode("newest")']) assert.ok(clear.includes(setter));
});
await scenario("page uses authoritative pair/filter/count helpers and All on loading/failure", () => {
  assert.match(page, /pairTaskPacksWithWorkflowSummaries\(taskPacks, workflowIndex\.byTaskPackId\)/);
  assert.match(page, /filterTaskPacksByLifecycle\(taskPacks, pairedWorkflows, effectiveLifecycleFilter\)/);
  assert.match(page, /effectiveLifecycleFilter = workflowReady \? lifecycleFilter : "all"/);
  assert.match(page, /workflowReady \? lifecycleCounts\[state\] : "—"/);
});
await scenario("cards reuse minimal summary badges without fake full DTO", () => {
  assert.match(page, /workflow=\{pairedWorkflows\.get\(taskPack\.id\)\}/);
  assert.match(page, /<TaskPackWorkflowBadges workflow=\{workflow\}/);
  assert.match(badge, /Pick<TaskPackWorkflowState, "lifecycle" \| "currentReviewState">/);
  assert.doesNotMatch(page, /lifecycleVersion|acceptedRevisionId|TaskPackWorkflowState/);
});
await scenario("failure/retry, unresolved and loading are safely localized/accessibly presented", () => {
  for (const key of ["workflowFailed", "workflowLoading", "workflowUnresolved", "workflowUnavailable"]) assert.ok(page.includes(`taskPacksPage.${key}`));
  assert.match(page, /workflowIndex\.retry\(\)/); assert.match(page, /role=\{workflowIndex\.status === "failed" \? "alert" : "status"\}/);
  assert.match(page, /aria-busy=\{workflowIndex\.status === "loading"\}/);
});
await scenario("freshness, Cloud bridge, import, export, publish, copy, Open/Peek/Inspector preserved", () => {
  for (const feature of ["TaskPackFreshnessBadge", "TaskPackFreshnessNotice", "CloudTaskPackBridge", "importCloudTaskPack",
    "integrityValid", "exportTaskPack", "publishTaskPack", "navigator.clipboard", "onOpenTaskPack(taskPack)",
    "onQuickPeekTaskPack(taskPack)", "onInspectTaskPack(taskPack)"]) assert.ok(page.includes(feature), feature);
});

function leafKeys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object") return [prefix];
  return Object.entries(value).flatMap(([key, child]) => leafKeys(child, prefix ? `${prefix}.${key}` : key));
}
await scenario("EN/RU Library and workflow resource key sets synchronized", () => {
  for (const namespace of ["taskPacksPage", "taskPackWorkflow"]) {
    assert.deepEqual(leafKeys(i18n.getResourceBundle("en", "translation")[namespace]).sort(),
      leafKeys(i18n.getResourceBundle("ru", "translation")[namespace]).sort());
  }
});
for (const lng of ["en", "ru"]) {
  await i18n.changeLanguage(lng);
  await scenario(`${lng} library/header/result/sidebar/shortcut copy no generic Archive terminology`, () => {
    for (const key of ["taskPacksPage.library", "taskPacksPage.archive", "taskPackResult.openArchive", "nav.taskPacksDesc", "settings.shortcut.openTaskPacks.description"]) {
      const value = i18n.t(key); assert.notEqual(value, key); assert.doesNotMatch(value, /\barchive\b|\bархив\b|\bархиву\b/iu, key);
    }
  });
  await scenario(`${lng} primary lifecycle labels, counts, empty/error copy resolve`, () => {
    for (const key of ["lifecycle.all", "lifecycle.active", "lifecycle.completed", "lifecycle.archived", "lifecycleFilter",
      "lifecycleEmpty.active", "lifecycleEmpty.completed", "lifecycleEmpty.archived", "workflowFailed", "workflowLoading", "workflowUnavailable", "retry"]) {
      assert.notEqual(i18n.t(`taskPacksPage.${key}`), `taskPacksPage.${key}`);
    }
  });
  await scenario(`${lng} real lifecycle archive/unarchive semantics remain; minimal badges render separate text`, () => {
    for (const key of ["taskPackWorkflow.lifecycle.archived", "taskPackWorkflow.actions.archive", "taskPackWorkflow.actions.unarchive"]) {
      assert.match(i18n.t(key), lng === "en" ? /archiv/iu : /архив/iu);
    }
    const minimal = summary({ lifecycle: { state: "archived", archivedFromState: "completed" }, currentReviewState: "accepted" });
    const html = renderToStaticMarkup(createElement(TaskPackWorkflowBadges, { workflow: minimal }));
    assert.ok(html.includes(i18n.t("taskPackWorkflow.lifecycle.archived"))); assert.ok(html.includes(i18n.t("taskPackWorkflow.review.accepted")));
    assert.doesNotMatch(html, /lifecycleVersion|acceptedRevisionId|undefined/);
  });
}
process.stdout.write(`Task Pack Library Workflow smoke: ${passed} scenarios passed.\n`);
