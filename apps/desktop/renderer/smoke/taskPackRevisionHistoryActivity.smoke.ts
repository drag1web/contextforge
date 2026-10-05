import assert from "node:assert/strict";
import fs from "node:fs";
import { ApiRequestError } from "../src/api/client";
import type { TaskPack, TaskPackRevisionDetail, TaskPackRevisionHistory, TaskPackWorkflowState } from "../src/types";
import { createTaskPackRevisionHistoryController } from "../src/utils/taskPackRevisionHistory";
import { captureTaskPackResultActivity, createTaskPackResultActivityOwner,
  invalidateTaskPackHistoryAfterReview, saveTaskPackResultContent } from "../src/utils/taskPackResultActivity";
import { captureTaskPackWorkflowOperation, createTaskPackWorkflowController,
  type TaskPackWorkflowAction } from "../src/utils/taskPackWorkflow";
import { createTaskPackWorkflowIndexController, refreshTaskPackWorkflowProjectionAfterActivity } from "../src/utils/taskPackWorkflowIndex";

let scenarios = 0;
async function scenario(name: string, run: () => void | Promise<void>) { await run(); scenarios++; process.stdout.write(`PASS ${name}\n`); }
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const pack = (id = 7, currentRevisionId = 187): TaskPack => ({ id, currentRevisionId, projectId: 3,
  title: "Current Task Pack", rawTask: "CURRENT_TASK", taskType: "general", targetTool: "generic",
  generatedPrompt: "CURRENT_DOCUMENT", createdAt: "2026-01-03T12:00:00.000Z", updatedAt: "2026-01-03T12:00:00.000Z" });
const history = (id = 7, reviewState: TaskPackWorkflowState["currentReviewState"] = "unreviewed"): TaskPackRevisionHistory => ({
  taskPackId: id, currentRevisionId: 187, revisions: [187, 102].map((revisionId, i) => ({
    id: revisionId, revisionNumber: 3 - i, baseRevisionId: i === 0 ? 102 : null, sourceKind: "manual_edit",
    createdAt: "2026-01-03T12:00:00.000Z", generatedAt: null, contentHash: `sha256:${"a".repeat(64)}`,
    generationMode: "template", generationModel: null, generationUsedFallback: false, reviewState,
  })),
});
const detail = (id: number, revisionId: number): TaskPackRevisionDetail => ({ taskPackId: id, currentRevisionId: 187,
  revision: { ...history(id).revisions.find(row => row.id === revisionId)!, rawTask: "HISTORICAL_TASK\t\r\n",
    generatedPrompt: "HISTORICAL_PROMPT  \r", taskType: "general", targetTool: "generic" } });
function fixture(id = 7, read: () => unknown | Promise<unknown> = () => history(id)) {
  const calls: string[] = [];
  const owner = createTaskPackResultActivityOwner(id);
  let currentOwner = owner;
  let currentTaskPack = pack(id);
  const parentUpdates: TaskPack[] = [];
  const controller = createTaskPackRevisionHistoryController(id, {
    getTaskPackRevisionHistory: async packId => { calls.push(`history:${packId}`); return read(); },
    getTaskPackRevisionDetail: async (packId, revisionId) => { calls.push(`detail:${packId}:${revisionId}`); return detail(packId, revisionId); },
  });
  const activity = () => captureTaskPackResultActivity(owner, () => currentOwner);
  const save = (mutate: () => Promise<TaskPack>) => saveTaskPackResultContent(activity(), mutate, next => {
    currentTaskPack = next; parentUpdates.push(next);
  }, controller.invalidateAndRefresh);
  const prepareNavigation = (next: number) => createTaskPackResultActivityOwner(next);
  const commitNavigation = (nextOwner: ReturnType<typeof prepareNavigation>) => {
    currentOwner.dispose(); // old layout cleanup, then new layout setup, without an async gap
    currentOwner = nextOwner;
    currentOwner.activate();
    currentTaskPack = pack(nextOwner.taskPackId);
  };
  return { owner, controller, calls, activity, save, parentUpdates, current: () => currentTaskPack,
    prepareNavigation, commitNavigation, navigate: (next: number) => commitNavigation(prepareNavigation(next)),
  };
}
async function inspectAndCompare(f: ReturnType<typeof fixture>) {
  await f.controller.selectRevision(102); f.controller.startComparison(102);
  f.controller.chooseComparisonRevision("right", 187); await f.controller.compareSelectedRevisions();
}
await scenario("successful content save commits current document/parent and exactly one authoritative list, no details", async () => {
  const authoritative = { ...history(), currentRevisionId: 555,
    revisions: [{ ...history().revisions[0], id: 555, revisionNumber: 4, baseRevisionId: 187 }, ...history().revisions] };
  let edited = false;
  const f = fixture(7, () => edited ? authoritative : history()); await f.controller.activate(); await inspectAndCompare(f);
  const before = f.calls.length, next = { ...pack(), currentRevisionId: 555, generatedPrompt: "Edited current document" };
  assert.equal(await f.save(async () => { edited = true; return next; }), next); await tick();
  assert.equal(f.current(), next); assert.deepEqual(f.parentUpdates, [next]); assert.deepEqual(f.calls.slice(before), ["history:7"]);
  assert.deepEqual(f.controller.getSnapshot().history, authoritative);
  assert.equal(f.controller.getSnapshot().detail, null); assert.equal(f.controller.getSnapshot().comparison.active, false); f.controller.dispose();
});
await scenario("content edit does not fabricate revision rows while authoritative read is pending", async () => {
  const pending = deferred<unknown>(); let reads = 0;
  const f = fixture(7, () => ++reads === 1 ? history() : pending.promise); await f.controller.activate();
  await f.save(async () => pack(7, 555));
  assert.equal(f.current().currentRevisionId, 555); assert.equal(f.controller.getSnapshot().history, null);
  assert.equal(f.controller.getSnapshot().status, "loading"); assert.equal(reads, 2);
  pending.resolve({ ...history(), currentRevisionId: 666, revisions: [{ ...history().revisions[0], id: 666, revisionNumber: 9 }] });
  await tick(); assert.equal(f.controller.getSnapshot().history?.currentRevisionId, 666); f.controller.dispose();
});
await scenario("failed content mutation preserves ready list, single detail, comparison and parent", async () => {
  const f = fixture(); await f.controller.activate(); await inspectAndCompare(f);
  const before = f.controller.getSnapshot(), calls = [...f.calls];
  await assert.rejects(f.save(async () => { throw new Error("private"); }));
  assert.equal(f.controller.getSnapshot(), before); assert.deepEqual(f.calls, calls); assert.equal(f.parentUpdates.length, 0); f.controller.dispose();
});
await scenario("successful save stays successful even if post-mutation history fails; Retry recovers", async () => {
  let reads = 0; const f = fixture(7, () => { if (++reads === 2) throw new Error("private SQL"); return history(); });
  await f.controller.activate(); await inspectAndCompare(f); const next = pack(7, 555);
  assert.equal(await f.save(async () => next), next); await tick();
  assert.equal(f.current(), next); assert.deepEqual(f.parentUpdates, [next]); assert.equal(f.controller.getSnapshot().status, "failed");
  assert.equal(f.controller.getSnapshot().history, null); assert.equal(f.controller.getSnapshot().detail, null);
  assert.equal(f.controller.getSnapshot().comparison.active, false);
  await f.controller.retryHistory(); assert.equal(reads, 3); assert.equal(f.controller.getSnapshot().status, "ready"); f.controller.dispose();
});
for (const target of [8, 7]) await scenario(`A editor completion after A -> B${target === 7 ? " -> A" : ""} cannot update the new owner or parent`, async () => {
  const pending = deferred<TaskPack>(), f = fixture(); await f.controller.activate();
  const before = [...f.calls], waiting = f.save(() => pending.promise);
  f.navigate(8); if (target === 7) f.navigate(7); // committed layout cleanup/setup for each owner instance
  pending.resolve(pack(7, 555)); assert.equal(await waiting, null);
  assert.equal(f.current().id, target); assert.equal(f.current().currentRevisionId, 187);
  assert.equal(f.parentUpdates.length, 0); assert.deepEqual(f.calls, before); f.controller.dispose();
});
await scenario("abandoned speculative B owner does not discard a legitimate committed A editor completion", async () => {
  const pending = deferred<TaskPack>(), f = fixture(); await f.controller.activate();
  const waiting = f.save(() => pending.promise), committedActivity = f.activity();
  const speculativeB = f.prepareNavigation(8); // render prepares B but never commits it
  assert.notEqual(speculativeB, f.owner); assert.equal(committedActivity.isCurrent(), true);
  const next = pack(7, 555); pending.resolve(next); assert.equal(await waiting, next); await tick();
  assert.equal(f.current(), next); assert.deepEqual(f.parentUpdates, [next]); assert.deepEqual(f.calls, ["history:7", "history:7"]);
  f.controller.dispose();
});
await scenario("StrictMode reactivation does not authorize an earlier editor-save generation", async () => {
  const pending = deferred<TaskPack>(), f = fixture(); await f.controller.activate();
  const waiting = f.save(() => pending.promise); f.owner.dispose(); f.owner.activate();
  pending.resolve(pack(7, 555)); assert.equal(await waiting, null); assert.equal(f.parentUpdates.length, 0);
  assert.deepEqual(f.calls, ["history:7"]);
  await f.save(async () => pack(7, 777)); await tick(); assert.equal(f.current().currentRevisionId, 777); f.controller.dispose();
});
await scenario("disposed/current-owner mismatch rejects editor work before a mutation starts", async () => {
  const f = fixture(); f.owner.dispose(); let writes = 0;
  assert.equal(await f.save(async () => { writes++; return pack(); }), null); assert.equal(writes, 0);
});
await scenario("foreign content response never updates Result/parent or triggers a history read", async () => {
  const f = fixture(); await f.controller.activate(); assert.equal(await f.save(async () => pack(8)), null);
  assert.equal(f.current().id, 7); assert.equal(f.parentUpdates.length, 0); assert.deepEqual(f.calls, ["history:7"]); f.controller.dispose();
});

const workflow = (action: TaskPackWorkflowAction): TaskPackWorkflowState => ({ taskPackId: 7, currentRevisionId: 187,
  lifecycle: action === "reopen" ? { state: "completed", archivedFromState: null }
    : action === "unarchive" ? { state: "archived", archivedFromState: "active" } : { state: "active", archivedFromState: null },
  lifecycleVersion: 4, acceptedRevisionId: action === "complete" ? 187 : null, completedAt: null, archivedAt: null,
  currentReviewState: action === "request_changes" ? "in_review" : action === "complete" ? "accepted" : "unreviewed" });
function reviewFixture(f: ReturnType<typeof fixture>, action: TaskPackWorkflowAction, options: {
  mutate?: () => Promise<unknown>; read?: () => unknown | Promise<unknown>; refreshProjection?: () => Promise<void>;
} = {}) {
  const calls: string[] = []; let reads = 0;
  const controller = createTaskPackWorkflowController(7, 187, {
    getTaskPackWorkflow: async () => { calls.push("workflow GET"); return ++reads === 1 ? workflow(action) : options.read ? options.read() : workflow(action); },
    transitionTaskPackRevisionReview: async () => { calls.push("review POST"); return options.mutate?.(); },
    transitionTaskPackLifecycle: async () => { calls.push("lifecycle POST"); return options.mutate?.(); },
  });
  let projectionRefreshes = 0;
  const execute = () => {
    const activity = f.activity(), operation = captureTaskPackWorkflowOperation(controller.getSnapshot().workflow!, action);
    if (!activity.isCurrent()) return Promise.resolve();
    return refreshTaskPackWorkflowProjectionAfterActivity(() => controller.execute(operation, () =>
      invalidateTaskPackHistoryAfterReview(activity, operation, f.controller.invalidateAndRefresh)),
    async () => { projectionRefreshes++; await options.refreshProjection?.(); });
  };
  return { controller, calls, execute, projectionRefreshes: () => projectionRefreshes };
}
for (const action of ["start_review", "accept", "request_changes", "complete", "reopen", "archive", "unarchive"] as const) {
  await scenario(`${action} actual workflow controller: one POST/GET; ${["start_review", "accept", "request_changes"].includes(action) ? "one" : "zero"} history reread`, async () => {
    let changed = false;
    const f = fixture(7, () => history(7, changed ? "changes_requested" : "unreviewed")); await f.controller.activate(); await inspectAndCompare(f);
    const before = f.controller.getSnapshot(), calls = f.calls.length;
    const w = reviewFixture(f, action, { mutate: async () => { changed = true; }, read: () => ({ ...workflow(action), currentReviewState: "accepted" }) });
    await w.controller.activate(); await w.execute(); await tick();
    const review = ["start_review", "accept", "request_changes"].includes(action);
    assert.deepEqual(w.calls, ["workflow GET", review ? "review POST" : "lifecycle POST", "workflow GET"]);
    assert.equal(w.projectionRefreshes(), 1); assert.deepEqual(f.calls.slice(calls), review ? ["history:7"] : []);
    if (review) {
      assert.equal(f.controller.getSnapshot().history?.revisions[0].reviewState, "changes_requested"); // history endpoint, NOT workflow accepted
      assert.equal(f.controller.getSnapshot().detail, null); assert.equal(f.controller.getSnapshot().comparison.active, false);
      assert.equal(w.controller.getSnapshot().workflow?.currentReviewState, "accepted");
    } else assert.equal(f.controller.getSnapshot(), before);
    f.controller.dispose(); w.controller.dispose();
  });
}
for (const status of [400, 404, 409, 428, 500]) await scenario(`failed review HTTP ${status} preserves history; conflict refresh is not mutation success`, async () => {
  const f = fixture(); await f.controller.activate(); await inspectAndCompare(f);
  const before = f.controller.getSnapshot(), calls = [...f.calls];
  const w = reviewFixture(f, "accept", { mutate: async () => { throw new ApiRequestError("private SQL", status, { code: "TASK_PACK_REVIEW_CONFLICT" }); } });
  await w.controller.activate(); await w.execute(); await tick();
  assert.equal(f.controller.getSnapshot(), before); assert.deepEqual(f.calls, calls);
  assert.equal(w.projectionRefreshes(), 1); // preserve shared reread-after-activity semantics, including failed mutations
  assert.equal(w.calls.filter(call => call === "review POST").length, 1);
  assert.equal(w.calls.filter(call => call === "workflow GET").length, status === 409 ? 2 : 1);
  f.controller.dispose(); w.controller.dispose();
});
await scenario("successful review invalidates immediately before a pending workflow GET completes", async () => {
  const pending = deferred<unknown>(), f = fixture(); await f.controller.activate(); await inspectAndCompare(f);
  const w = reviewFixture(f, "accept", { read: () => pending.promise }); await w.controller.activate();
  const calls = f.calls.length, waiting = w.execute(); await tick();
  assert.deepEqual(f.calls.slice(calls), ["history:7"]); assert.equal(f.controller.getSnapshot().detail, null);
  pending.resolve(workflow("accept")); await waiting; assert.deepEqual(f.calls.slice(calls), ["history:7"]);
  f.controller.dispose(); w.controller.dispose();
});
await scenario("successful review plus failed own workflow GET still invalidates history once", async () => {
  const f = fixture(); await f.controller.activate(); const w = reviewFixture(f, "accept", { read: () => { throw new Error("private"); } });
  await w.controller.activate(); await w.execute(); await tick();
  assert.deepEqual(f.calls, ["history:7", "history:7"]); assert.equal(w.controller.getSnapshot().issue?.phase, "refresh");
  assert.equal(w.controller.getSnapshot().blocked, true); f.controller.dispose(); w.controller.dispose();
});
await scenario("successful review with failed history keeps successful workflow and has safe history Retry", async () => {
  let reads = 0; const f = fixture(7, () => { if (++reads === 2) throw new Error("private"); return history(); });
  await f.controller.activate(); const w = reviewFixture(f, "accept", { read: () => ({ ...workflow("accept"), currentReviewState: "accepted" }) });
  await w.controller.activate(); await w.execute(); await tick();
  assert.equal(w.controller.getSnapshot().issue, null); assert.equal(w.controller.getSnapshot().workflow?.currentReviewState, "accepted");
  assert.equal(f.controller.getSnapshot().status, "failed"); assert.equal(f.controller.getSnapshot().history, null);
  await f.controller.retryHistory(); assert.equal(reads, 3); f.controller.dispose(); w.controller.dispose();
});
for (const target of [8, 7]) await scenario(`late A review cannot invalidate B${target === 7 ? " or a new A" : ""}, even before workflow disposal`, async () => {
  const pending = deferred<unknown>(), f = fixture(); await f.controller.activate();
  const w = reviewFixture(f, "accept", { mutate: () => pending.promise }); await w.controller.activate();
  const before = [...f.calls], waiting = w.execute(); f.navigate(8); if (target === 7) f.navigate(7);
  pending.resolve(undefined); await waiting; assert.deepEqual(f.calls, before); assert.equal(w.projectionRefreshes(), 1);
  assert.equal(f.current().id, target); f.controller.dispose(); w.controller.dispose();
});
await scenario("abandoned speculative B owner leaves committed A review/history/projection refresh valid", async () => {
  const pending = deferred<unknown>(), f = fixture(); await f.controller.activate();
  const w = reviewFixture(f, "accept", { mutate: () => pending.promise }); await w.controller.activate();
  const waiting = w.execute(); f.prepareNavigation(8); // no commit, therefore no owner installation/cleanup
  pending.resolve(undefined); await waiting; await tick();
  assert.equal(f.current().id, 7); assert.deepEqual(f.calls, ["history:7", "history:7"]); assert.equal(w.projectionRefreshes(), 1);
  f.controller.dispose(); w.controller.dispose();
});
for (const target of [8, 7]) await scenario(`late A review refreshes real shared index once after A -> B${target === 7 ? " -> A" : ""}, without touching new local owners`, async () => {
  const pending = deferred<unknown>(), f = fixture(); await f.controller.activate();
  let accepted = false, indexReads = 0;
  const shared = createTaskPackWorkflowIndexController({ getCurrentTaskPackWorkflowSummaries: async () => {
    indexReads++;
    return [7, 8].map(taskPackId => ({ taskPackId, currentRevisionId: 187, lifecycle: { state: "active" as const, archivedFromState: null },
      currentReviewState: taskPackId === 7 && accepted ? "accepted" as const : "unreviewed" as const }));
  } });
  await shared.activate("unchanged-revision-identity");
  const w = reviewFixture(f, "accept", { mutate: async () => { await pending.promise; accepted = true; }, refreshProjection: shared.refresh });
  await w.controller.activate(); const oldCalls = [...f.calls], waiting = w.execute();
  f.navigate(8); if (target === 7) f.navigate(7); w.controller.dispose();
  const next = fixture(target); await next.controller.activate();
  const nextWorkflow = createTaskPackWorkflowController(target, 187, {
    getTaskPackWorkflow: async () => ({ ...workflow("accept"), taskPackId: target }),
    transitionTaskPackLifecycle: async () => { throw new Error("No local mutation expected"); },
    transitionTaskPackRevisionReview: async () => { throw new Error("No local mutation expected"); },
  });
  await nextWorkflow.activate();
  const localHistory = next.controller.getSnapshot(), localWorkflow = nextWorkflow.getSnapshot();
  pending.resolve(undefined); await waiting; await tick();
  assert.equal(indexReads, 2); assert.equal(w.projectionRefreshes(), 1);
  assert.equal(shared.getSnapshot().byTaskPackId.get(7)?.currentReviewState, "accepted");
  assert.equal(shared.getSnapshot().byTaskPackId.get(7)?.currentRevisionId, 187); // pairing alone could not reject stale review
  assert.equal(next.controller.getSnapshot(), localHistory); assert.equal(nextWorkflow.getSnapshot(), localWorkflow);
  assert.deepEqual(next.calls, [`history:${target}`]); assert.deepEqual(f.calls, oldCalls);
  assert.equal(f.current().id, target); assert.equal(next.current().id, target); assert.equal(f.parentUpdates.length, 0);
  shared.dispose(); f.controller.dispose(); next.controller.dispose(); nextWorkflow.dispose();
});
await scenario("disposed workflow suppresses success observer even if Result identity stays the same", async () => {
  const pending = deferred<unknown>(), f = fixture(); await f.controller.activate();
  const w = reviewFixture(f, "accept", { mutate: () => pending.promise }); await w.controller.activate();
  const waiting = w.execute(); w.controller.dispose(); pending.resolve(undefined); await waiting;
  assert.deepEqual(f.calls, ["history:7"]); f.controller.dispose();
});
await scenario("StrictMode workflow/Result reactivation cannot revive old mutation observers", async () => {
  const pending = deferred<unknown>(), f = fixture(); await f.controller.activate();
  const w = reviewFixture(f, "accept", { mutate: () => pending.promise }); await w.controller.activate();
  const waiting = w.execute(); f.owner.dispose(); w.controller.dispose(); f.owner.activate(); await w.controller.activate();
  pending.resolve(undefined); await waiting; assert.deepEqual(f.calls, ["history:7"]); f.controller.dispose(); w.controller.dispose();
});
await scenario("duplicate review clicks cannot cause duplicate success observers/history reads", async () => {
  const pending = deferred<unknown>(), f = fixture(); await f.controller.activate();
  const w = reviewFixture(f, "accept", { mutate: () => pending.promise }); await w.controller.activate();
  const first = w.execute(), second = w.execute(); pending.resolve(undefined); await Promise.all([first, second]); await tick();
  assert.equal(w.calls.filter(call => call === "review POST").length, 1); assert.deepEqual(f.calls, ["history:7", "history:7"]);
  f.controller.dispose(); w.controller.dispose();
});
await scenario("post-mutation A history cannot populate B/new A during rapid navigation", async () => {
  const pending = deferred<unknown>(); let reads = 0;
  const a = fixture(7, () => ++reads === 1 ? history() : pending.promise); await a.controller.activate();
  await a.save(async () => pack(7, 555)); a.owner.dispose(); a.controller.dispose();
  const b = fixture(8); await b.controller.activate(); const newA = fixture(); await newA.controller.activate();
  const bState = b.controller.getSnapshot(), newAState = newA.controller.getSnapshot();
  pending.resolve({ ...history(), currentRevisionId: 555 }); await tick();
  assert.equal(b.controller.getSnapshot(), bState); assert.equal(newA.controller.getSnapshot(), newAState);
  assert.equal(a.controller.getSnapshot().history, null); b.controller.dispose(); newA.controller.dispose();
});
await scenario("real content-save wiring supersedes an old pending list, not the loading-guarded refresh", async () => {
  const old = deferred<unknown>(), fresh = deferred<unknown>(); let reads = 0;
  const f = fixture(7, () => ++reads === 1 ? old.promise : fresh.promise); const activation = f.controller.activate();
  await f.save(async () => pack(7, 555)); assert.equal(reads, 2);
  fresh.resolve({ ...history(), currentRevisionId: 555 }); await tick(); old.resolve(history()); await activation;
  assert.equal(f.controller.getSnapshot().history?.currentRevisionId, 555); f.controller.dispose();
});
await scenario("invalidation has no detail prefetch; subsequent explicit comparison still reads exactly its two sides", async () => {
  const f = fixture(); await f.controller.activate(); await f.save(async () => pack(7, 555)); await tick();
  assert.deepEqual(f.calls, ["history:7", "history:7"]); const before = f.calls.length;
  f.controller.startComparison(102); f.controller.chooseComparisonRevision("right", 187); await f.controller.compareSelectedRevisions();
  assert.deepEqual(f.calls.slice(before), ["detail:7:102", "detail:7:187"]); f.controller.dispose();
});
await scenario("review invalidation rejects a mismatched operation owner", async () => {
  const f = fixture(); await f.controller.activate();
  invalidateTaskPackHistoryAfterReview(f.activity(), { ...captureTaskPackWorkflowOperation(workflow("accept"), "accept"), taskPackId: 8 }, f.controller.invalidateAndRefresh);
  assert.deepEqual(f.calls, ["history:7"]); f.controller.dispose();
});
await scenario("observer failure cannot change successful workflow outcome or add retries", async () => {
  const f = fixture(); const w = reviewFixture(f, "accept"); await w.controller.activate();
  await w.controller.execute("accept", () => { throw new Error("observer failure"); });
  assert.equal(w.controller.getSnapshot().issue, null); assert.equal(w.calls.length, 3); w.controller.dispose();
});

const source = (file: string) => fs.readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
await scenario("actual Result handlers use tested owner/content/success helpers and preserve editor/projection guards", () => {
  const page = source("pages/TaskPackResultPage.tsx");
  assert.match(page, /currentResultOwner.current = resultOwner/); assert.match(page, /return resultOwner.dispose/);
  assert.match(page, /saveTaskPackResultContent\(activity,[\s\S]*?updateTaskPackContent\(session.taskPackId, input\), handleTaskPackUpdated, revisionHistory.invalidateAndRefresh/);
  assert.match(page, /if \(!nextTaskPack\) throw/);
  assert.match(page, /workflowController.execute\(operation, \(\) =>\s*invalidateTaskPackHistoryAfterReview\(activity, operation, revisionHistory.invalidateAndRefresh\)/);
  assert.match(page, /onExecute=\{handleExecuteWorkflow\}/); assert.match(page, /refreshTaskPackWorkflowProjectionAfterActivity/);
  assert.match(page, /invalidateTaskPackHistoryAfterReview\(activity, operation, revisionHistory.invalidateAndRefresh\)\),\s*onWorkflowActivity\)/);
  assert.match(page, /editAuthority.current.revisionId !== session.expectedCurrentRevisionId/);
  assert.match(page, /editorOwner.current === resultOwner && editorSession.taskPackId === taskPack.id/);
  assert.match(page, /if \(currentResultOwner.current === resultOwner\) setEditorSession\(null\)/);
  assert.doesNotMatch(page, /history\.revisions\.push|revisionNumber\s*\+\s*1|revisionHistory\.history\s*=/);
});
await scenario("authoritative Result owner installation happens only in commit-phase layout setup with cleanup", () => {
  const page = source("pages/TaskPackResultPage.tsx");
  assert.match(page, /import \{[^}]*useLayoutEffect[^}]*\} from "react"/);
  const installation = page.match(/useLayoutEffect\(\(\) => \{[\s\S]*?\}, \[resultOwner\]\);/)![0];
  assert.match(installation, /currentResultOwner.current = resultOwner;\s*resultOwner.activate\(\);\s*return resultOwner.dispose;/);
  assert.doesNotMatch(page.replace(installation, ""), /currentResultOwner\.current\s*=(?!=)/); // no bare speculative-render assignment (not === comparison)
  assert.match(page, /createTaskPackResultActivityOwner\(taskPack.id\), \[taskPack.id\]/);
  assert.match(page, /const editorOwner = useRef\(resultOwner\)/);
});
await scenario("new ownership/invalidation paths have no timer workaround/polling or history workflow authority", () => {
  const helper = source("utils/taskPackResultActivity.ts"), historySource = source("utils/taskPackRevisionHistory.ts");
  assert.doesNotMatch(helper + historySource + source("hooks/useTaskPackRevisionHistory.ts"), /setTimeout|setInterval|\.normalize\(|\.trim\(/);
  assert.doesNotMatch(historySource, /updateTaskPackContent|transitionTaskPack|createTaskPackEditorSession/);
  assert.match(source("hooks/useTaskPackRevisionHistory.ts"), /invalidateAndRefresh: controller.invalidateAndRefresh/);
  assert.match(helper, /currentOwner\(\) === owner && owner.owns\(token\)/);
});
process.stdout.write(`Task Pack revision history activity smoke passed: ${scenarios} scenarios (actual read/workflow controllers, Result ownership and mutation coordination; not visual Desktop QA).\n`);
