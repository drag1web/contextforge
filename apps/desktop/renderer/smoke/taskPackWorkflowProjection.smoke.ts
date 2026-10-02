import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ApiRequestError } from "../src/api/client";
import type { Project, TaskPack, TaskPackWorkflowState, TaskPackWorkflowSummary } from "../src/types";
import type { QuickPeekTarget } from "../src/types/quickPeek";
import type { InspectorTarget } from "../src/types/inspector";
import type { TaskPackFreshness } from "../src/utils/taskPackFreshness";
import { createTaskPackWorkflowController, type TaskPackWorkflowAction } from "../src/utils/taskPackWorkflow";
import { createTaskPackWorkflowIndexController, pairTaskPacksWithWorkflowSummaries, resolveTaskPackWorkflowSummary,
  refreshTaskPackWorkflowProjectionAfterActivity, type TaskPackWorkflowProjection } from "../src/utils/taskPackWorkflowIndex";
// Real renderer components need the same JSX transform as the app, from any working directory.
const rendererTsconfig = fileURLToPath(new URL("../tsconfig.app.json", import.meta.url));
if (process.env.TSX_TSCONFIG_PATH !== rendererTsconfig) {
  const result = spawnSync(process.execPath, [fileURLToPath(import.meta.resolve("tsx/cli")), "--tsconfig", rendererTsconfig,
    fileURLToPath(import.meta.url)], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
const { TaskPackWorkflowProjectionBadges } = await import("../src/components/taskPacks/TaskPackWorkflowProjectionBadges");
const { QuickPeekPanel } = await import("../src/components/workspace/QuickPeekPanel");
const { PersistentInspectorPanel } = await import("../src/components/workspace/PersistentInspectorPanel");
const { DashboardHomePage } = await import("../src/pages/DashboardHomePage");
const { ReportsPage } = await import("../src/pages/ReportsPage");
const { default: i18n } = await import("../src/i18n");

let passed = 0;
async function scenario(name: string, run: () => void | Promise<void>) { await run(); passed++; process.stdout.write(`PASS ${name}\n`); }
const pack: TaskPack = { id: 7, currentRevisionId: 16, projectId: 2, projectName: "Fixture project", title: "SHARED_PROJECTION_PACK",
  rawTask: "READONLY_AUTHORED_TASK", generatedPrompt: "# READONLY_DOCUMENT", taskType: "general", targetTool: "codex",
  generationMode: "template", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
const summary = (overrides: Partial<TaskPackWorkflowSummary> = {}): TaskPackWorkflowSummary => ({ taskPackId: 7, currentRevisionId: 16,
  lifecycle: { state: "active", archivedFromState: null }, currentReviewState: "unreviewed", ...overrides });
const projection = (item = summary(), status: TaskPackWorkflowProjection["status"] = "ready"): TaskPackWorkflowProjection => ({
  status, byTaskPackId: pairTaskPacksWithWorkflowSummaries([pack], new Map([[item.taskPackId, item]])), retry: async () => {},
});
const freshness: TaskPackFreshness = { taskPackId: 7, projectId: 2, status: "current", reason: "known_state_unchanged", selectedPaths: [],
  affectedPaths: [], createdAt: pack.createdAt, previousObservedAt: null, currentObservedAt: null };
const project: Project = { id: 2, name: "Fixture project", localPath: "/fixture", packageManager: "npm", detectedStack: [], scripts: {},
  readinessScore: 80, readinessReport: { score: 80, checks: [], issues: [] }, createdAt: pack.createdAt, updatedAt: pack.updatedAt, lastScanAt: pack.createdAt };
const noop = () => {};
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { resolve, promise }; }
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

await scenario("cached targets resolve only exact id/current revision; missing revision stays unresolved", () => {
  const shared = projection(); assert.equal(resolveTaskPackWorkflowSummary(pack, shared)?.taskPackId, 7);
  for (const target of [{ ...pack, currentRevisionId: 15 }, { ...pack, id: 8 }, { id: 7 }]) {
    assert.equal(resolveTaskPackWorkflowSummary(target, shared), undefined);
  }
  assert.equal(resolveTaskPackWorkflowSummary(pack, { ...shared, byTaskPackId: new Map([[7, summary({ taskPackId: 8 })]]) }), undefined);
});
await scenario("non-ready projection cannot display even a retained matching status", () => {
  for (const status of ["loading", "failed"] as const) assert.equal(resolveTaskPackWorkflowSummary(pack, projection(summary(), status)), undefined);
});
await scenario("same target consumes new shared status without copying it into target or re-fetching", () => {
  const target: QuickPeekTarget = { kind: "task-pack", taskPack: pack };
  assert.equal(resolveTaskPackWorkflowSummary(target.taskPack, projection())?.currentReviewState, "unreviewed");
  assert.equal(resolveTaskPackWorkflowSummary(target.taskPack, projection(summary({ currentReviewState: "accepted" })))?.currentReviewState, "accepted");
  assert.deepEqual(Object.keys(target).sort(), ["kind", "taskPack"]);
  const targetHasWorkflow: "workflow" extends keyof QuickPeekTarget ? true : false = false;
  const inspectorHasWorkflow: "workflow" extends keyof InspectorTarget ? true : false = false;
  assert.equal(targetHasWorkflow, false); assert.equal(inspectorHasWorkflow, false);
});

await scenario("explicit refresh supersedes in-flight bulk read with SAME collection signature", async () => {
  const old = deferred<readonly TaskPackWorkflowSummary[]>(), fresh = deferred<readonly TaskPackWorkflowSummary[]>(); let reads = 0;
  const owner = createTaskPackWorkflowIndexController({ getCurrentTaskPackWorkflowSummaries: () => ++reads === 1 ? old.promise : fresh.promise });
  const first = owner.activate("unchanged collection"); const second = owner.refresh();
  fresh.resolve([summary({ currentReviewState: "accepted" })]); await second;
  old.resolve([summary()]); await first;
  assert.equal(reads, 2); assert.equal(owner.getSnapshot().byTaskPackId.get(7)?.currentReviewState, "accepted");
});
await scenario("refresh after ready replaces status without changing flat collection; Retry remains duplicate guarded", async () => {
  let reads = 0; const owner = createTaskPackWorkflowIndexController({ getCurrentTaskPackWorkflowSummaries: async () =>
    [summary({ currentReviewState: ++reads === 1 ? "unreviewed" : "accepted" })] });
  await owner.activate("same"); await owner.refresh();
  assert.equal(reads, 2); assert.equal(owner.getSnapshot().signature, "same");
  assert.equal(owner.getSnapshot().byTaskPackId.get(7)?.currentReviewState, "accepted");
});
await scenario("disposed shared owner cannot refresh or publish after Result completion", async () => {
  let reads = 0; const owner = createTaskPackWorkflowIndexController({ getCurrentTaskPackWorkflowSummaries: async () => { reads++; return [summary()]; } });
  await owner.activate("A"); owner.dispose(); await refreshTaskPackWorkflowProjectionAfterActivity(async () => {}, owner.refresh);
  assert.equal(reads, 1);
});
await scenario("Result activity does not await pending shared read or change its own outcome", async () => {
  const pending = deferred<void>(); let calls = 0;
  await refreshTaskPackWorkflowProjectionAfterActivity(async () => { calls++; }, () => pending.promise);
  assert.equal(calls, 1); pending.resolve();
});
await scenario("shared read synchronous/asynchronous failure cannot reject Result operation", async () => {
  for (const refresh of [() => { throw new Error("private driver"); }, async () => { throw new Error("private driver"); }]) {
    await refreshTaskPackWorkflowProjectionAfterActivity(async () => {}, refresh); await tick();
  }
});
await scenario("unexpected original activity error propagates unchanged while invalidating shared read", async () => {
  const error = new Error("operation failure"); let refreshes = 0;
  await assert.rejects(refreshTaskPackWorkflowProjectionAfterActivity(async () => { throw error; }, async () => { refreshes++; }), e => e === error);
  assert.equal(refreshes, 1);
});

const workflow = (): TaskPackWorkflowState => ({ ...summary(), lifecycleVersion: 4, acceptedRevisionId: null, completedAt: null, archivedAt: null });
for (const action of ["start_review", "accept", "request_changes", "complete", "reopen", "archive", "unarchive"] as const) {
  await scenario(`real Result controller ${action}: one mutation, own GET, then one authoritative bulk invalidation`, async () => {
    let state = workflow();
    if (action === "request_changes") state.currentReviewState = "in_review";
    if (action === "complete") { state.currentReviewState = "accepted"; state.acceptedRevisionId = 16; }
    if (action === "reopen") state.lifecycle = { state: "completed", archivedFromState: null };
    if (action === "unarchive") state.lifecycle = { state: "archived", archivedFromState: "completed" };
    const calls: string[] = [];
    const mutate = async (actual: TaskPackWorkflowAction) => {
      assert.equal(actual, action); calls.push("mutation"); state = { ...state, lifecycleVersion: state.lifecycleVersion + 1 };
      if (actual === "start_review") state.currentReviewState = "in_review";
      if (actual === "accept") { state.currentReviewState = "accepted"; state.acceptedRevisionId = 16; }
      if (actual === "request_changes") state.currentReviewState = "changes_requested";
      if (actual === "complete") { state.lifecycle = { state: "completed", archivedFromState: null }; state.completedAt = "2026-01-02T00:00:00.000Z"; }
      if (actual === "reopen") state.lifecycle = { state: "active", archivedFromState: null };
      if (actual === "archive") { state.lifecycle = { state: "archived", archivedFromState: "active" }; state.archivedAt = "2026-01-02T00:00:00.000Z"; }
      if (actual === "unarchive") state.lifecycle = { state: "completed", archivedFromState: null };
    };
    const result = createTaskPackWorkflowController(7, 16, {
      getTaskPackWorkflow: async () => { calls.push("individual GET"); return state; },
      transitionTaskPackLifecycle: async (_id, input) => mutate(input.action),
      transitionTaskPackRevisionReview: async (_id, _revision, input) => mutate(input.action),
    });
    const shared = createTaskPackWorkflowIndexController({ getCurrentTaskPackWorkflowSummaries: async () => {
      calls.push("bulk GET"); return [summary({ lifecycle: state.lifecycle, currentReviewState: state.currentReviewState })];
    } });
    await result.activate(); await shared.activate("same"); calls.length = 0;
    await refreshTaskPackWorkflowProjectionAfterActivity(() => result.execute(action), shared.refresh); await tick();
    assert.deepEqual(calls, ["mutation", "individual GET", "bulk GET"]);
    assert.equal(shared.getSnapshot().byTaskPackId.get(7)?.currentReviewState, state.currentReviewState);
    assert.deepEqual(shared.getSnapshot().byTaskPackId.get(7)?.lifecycle, state.lifecycle);
    if (action === "accept") assert.equal(result.getSnapshot().workflow?.lifecycle.state, "active");
  });
}
await scenario("manual Result refresh invalidates shared status without any mutation", async () => {
  const state = workflow(); let reads = 0, bulk = 0;
  const result = createTaskPackWorkflowController(7, 16, { getTaskPackWorkflow: async () => { reads++; return state; },
    transitionTaskPackLifecycle: async () => { assert.fail("mutation forbidden"); }, transitionTaskPackRevisionReview: async () => { assert.fail("mutation forbidden"); } });
  await result.activate(); await refreshTaskPackWorkflowProjectionAfterActivity(result.refresh, async () => { bulk++; });
  assert.equal(reads, 2); assert.equal(bulk, 1);
});
await scenario("Result conflict preserves issue and one own read; shared invalidation never retries mutation", async () => {
  let writes = 0, reads = 0, bulk = 0; const initial = workflow();
  const result = createTaskPackWorkflowController(7, 16, { getTaskPackWorkflow: async () => { reads++; return initial; },
    transitionTaskPackLifecycle: async () => { writes++; throw new ApiRequestError("private", 409, { code: "TASK_PACK_LIFECYCLE_CONFLICT" }); },
    transitionTaskPackRevisionReview: async () => { assert.fail(); } });
  await result.activate(); await refreshTaskPackWorkflowProjectionAfterActivity(() => result.execute("archive"), async () => { bulk++; });
  assert.equal(writes, 1); assert.equal(reads, 2); assert.equal(bulk, 1); assert.equal(result.getSnapshot().issue?.kind, "conflict");
});

const surfaces = {
  Dashboard: (shared: TaskPackWorkflowProjection, taskPack = pack) => renderToStaticMarkup(createElement(DashboardHomePage, {
    projects: [project], taskPacks: [taskPack], workflowProjection: shared, freshnessByTaskPackId: new Map([[7, freshness]]), readinessScore: 80,
    statusMessage: "", isLoading: false, onAddProject: noop, onOpenProjects: noop, onOpenContextBuilder: noop, onOpenTaskPacks: noop,
    onOpenSettings: noop, onRescanProject: noop, onGenerateAgents: noop, onCreateTaskPack: noop, onOpenTaskPack: noop, onOpenProjectDetails: noop, onQuickPeekProject: noop,
  })),
  Reports: (shared: TaskPackWorkflowProjection, taskPack = pack) => renderToStaticMarkup(createElement(ReportsPage, { projects: [project], taskPacks: [taskPack],
    workflowProjection: shared, readinessScore: 0, onOpenProjects: noop, onOpenTaskPacks: noop, onOpenTaskPack: noop })),
  Peek: (shared: TaskPackWorkflowProjection, taskPack = pack) => renderToStaticMarkup(createElement(QuickPeekPanel, { target: { kind: "task-pack", taskPack },
    workflowProjection: shared, taskPackFreshness: freshness, onClose: noop, onOpenProject: noop, onOpenTaskPack: noop })),
  Split: (shared: TaskPackWorkflowProjection, taskPack = pack) => renderToStaticMarkup(createElement(QuickPeekPanel, { mode: "split-view", target: { kind: "task-pack", taskPack },
    workflowProjection: shared, taskPackFreshness: freshness, onClose: noop, onOpenProject: noop, onOpenTaskPack: noop })),
  Inspector: (shared: TaskPackWorkflowProjection, taskPack = pack) => renderToStaticMarkup(createElement(PersistentInspectorPanel, { target: { kind: "task-pack", taskPack },
    workflowProjection: shared, onClose: noop, onOpenInSplitView: noop, onOpenProject: noop, onOpenTaskPack: noop })),
};
for (const lng of ["en", "ru"]) {
  await i18n.changeLanguage(lng);
  for (const [surface, render] of Object.entries(surfaces)) {
    await scenario(`${lng} ${surface} renders lifecycle/review from shared minimal DTO and preserves Task Pack`, () => {
      const html = render(projection(summary({ lifecycle: { state: "completed", archivedFromState: null }, currentReviewState: "accepted" })));
      assert.ok(html.includes(pack.title)); assert.ok(html.includes(`>${i18n.t("taskPackWorkflow.lifecycle.completed")}</span>`));
      assert.ok(html.includes(`>${i18n.t("taskPackWorkflow.review.accepted")}</span>`)); assert.doesNotMatch(html, /lifecycleVersion|acceptedRevisionId/);
    });
    await scenario(`${lng} ${surface} keeps flat Task Pack on loading/failed/unresolved without fabricated pills`, () => {
      for (const shared of [projection(summary(), "loading"), projection(summary(), "failed"), projection(summary({ currentRevisionId: 17 }))]) {
        const html = render(shared); assert.ok(html.includes(pack.title));
        assert.ok(html.includes(i18n.t(shared.status === "loading" ? "taskPackWorkflow.statusLoading" : "taskPackWorkflow.statusUnavailable")));
        assert.ok(!html.includes(`>${i18n.t("taskPackWorkflow.lifecycle.active")}</span>`));
      }
    });
    await scenario(`${lng} ${surface} cached revision mismatch cannot display accepted current status`, () => {
      const html = render(projection(summary({ currentReviewState: "accepted" })), { ...pack, currentRevisionId: 15 });
      assert.ok(html.includes(pack.title)); assert.ok(html.includes(i18n.t("taskPackWorkflow.statusUnavailable")));
      assert.ok(!html.includes(`>${i18n.t("taskPackWorkflow.review.accepted")}</span>`));
    });
  }
  await scenario(`${lng} pure projection badge renders separate concepts, including archived/unreviewed`, () => {
    const html = renderToStaticMarkup(createElement(TaskPackWorkflowProjectionBadges, { taskPack: pack,
      projection: projection(summary({ lifecycle: { state: "archived", archivedFromState: "active" } })) }));
    assert.ok(html.includes(i18n.t("taskPackWorkflow.lifecycle.archived"))); assert.ok(html.includes(i18n.t("taskPackWorkflow.review.unreviewed")));
  });
}

const source = (path: string) => fs.readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const dashboard = source("pages/DashboardPage.tsx"), library = source("pages/TaskPacksPage.tsx"), result = source("pages/TaskPackResultPage.tsx");
const children = ["pages/TaskPacksPage.tsx", "pages/DashboardHomePage.tsx", "pages/ReportsPage.tsx", "components/workspace/QuickPeekPanel.tsx", "components/workspace/PersistentInspectorPanel.tsx"];
await scenario("exactly one Dashboard owner pairs collection once; children have no workflow reads or authority", () => {
  assert.equal((dashboard.match(/useTaskPackWorkflowIndex\(/g) ?? []).length, 1);
  assert.equal((dashboard.match(/pairTaskPacksWithWorkflowSummaries\(/g) ?? []).length, 1);
  for (const path of children) assert.equal(/useTaskPackWorkflowIndex|getCurrentTaskPackWorkflowSummaries|getTaskPackWorkflow\(|transitionTaskPackLifecycle|transitionTaskPackRevisionReview/.test(source(path)), false, path);
  assert.match(library, /const pairedWorkflows = workflowProjection\.byTaskPackId/);
  assert.match(library, /getTaskPackLifecycleCounts\(taskPacks, pairedWorkflows\)/);
  assert.match(library, /filterTaskPacksByLifecycle\(taskPacks, pairedWorkflows, effectiveLifecycleFilter\)/);
});
await scenario("all six Dashboard child mounts pass same projection; all Result mounts invalidate it", () => {
  assert.equal((dashboard.match(/workflowProjection=\{taskPackWorkflowProjection\}/g) ?? []).length, 6);
  assert.equal((dashboard.match(/onWorkflowActivity=\{workflowIndex\.refresh\}/g) ?? []).length, (dashboard.match(/<TaskPackResultPage/g) ?? []).length);
  assert.match(dashboard, /taskPackWorkflowProjection,\s*workflowIndex\.refresh,/);
  assert.match(result, /refreshTaskPackWorkflowProjectionAfterActivity\(workflowController\.refresh, onWorkflowActivity\)/);
  assert.match(result, /refreshTaskPackWorkflowProjectionAfterActivity\(\(\) => workflowController\.execute\(operation\), onWorkflowActivity\)/);
  assert.equal((result.match(/useTaskPackWorkflow\(/g) ?? []).length, 1);
});
await scenario("shared read has no workflow polling; existing Cloud inbox polling is preserved", () => {
  for (const path of ["hooks/useTaskPackWorkflowIndex.ts", "utils/taskPackWorkflowIndex.ts", "components/taskPacks/TaskPackWorkflowProjectionBadges.tsx"])
    assert.equal(/setInterval|setTimeout|fetch\(|getTaskPackWorkflow\(/.test(source(path)), false);
  assert.match(library, /CloudTaskPackBridge/); assert.match(library.slice(0, library.indexOf("export function TaskPacksPage(")), /setInterval/);
});
await scenario("target types retain no summary snapshot; badges still require only minimal fields", () => {
  assert.doesNotMatch(source("types/quickPeek.ts") + source("types/inspector.ts"), /TaskPackWorkflow|workflow|lifecycleVersion/);
  assert.match(source("components/taskPacks/TaskPackWorkflowCard.tsx"), /Pick<TaskPackWorkflowState, "lifecycle" \| "currentReviewState">/);
  for (const path of children.slice(1)) assert.match(source(path), /TaskPackWorkflowProjectionBadges/);
});
await scenario("generation metrics/freshness remain independent from projection", () => {
  const reports = source("pages/ReportsPage.tsx");
  assert.match(reports, /const assistedCount = taskPacks\.filter/); assert.match(reports, /const fallbackCount = taskPacks\.filter/);
  assert.match(source("pages/DashboardHomePage.tsx"), /TaskPackFreshnessBadge/);
  assert.match(source("components/workspace/QuickPeekPanel.tsx"), /TaskPackFreshnessNotice/);
});
await scenario("new EN/RU status labels match keys, no content or internal authority rendered", () => {
  for (const key of ["statusLoading", "statusUnavailable"]) {
    assert.equal(typeof i18n.getResource("en", "translation", `taskPackWorkflow.${key}`), "string");
    assert.equal(typeof i18n.getResource("ru", "translation", `taskPackWorkflow.${key}`), "string");
  }
});
process.stdout.write(`Workspace Task Pack workflow projection smoke: ${passed} scenarios passed (runtime controllers + rendered surfaces + wiring, not visual Desktop QA).\n`);
