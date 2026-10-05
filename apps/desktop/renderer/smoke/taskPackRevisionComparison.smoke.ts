import assert from "node:assert/strict";
import fs from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ApiRequestError, getTaskPackRevisionDetail, getTaskPackRevisionHistory } from "../src/api/client";
import { TaskPackRevisionComparison } from "../src/components/taskPacks/TaskPackRevisionComparison";
import { TaskPackRevisionHistoryPanel } from "../src/components/taskPacks/TaskPackRevisionHistoryPanel";
import { TASK_PACK_WORKSPACE_VIEWS } from "../src/components/taskPacks/TaskPackWorkspaceHeader";
import { compareTaskPackRevisionText, compareTaskPackRevisions, TASK_PACK_TEXT_DIFF_LIMITS, TASK_PACK_REVISION_SCALAR_FIELDS,
  type RevisionTextComparison } from "../src/utils/taskPackRevisionComparison";
import { createTaskPackRevisionHistoryController, emptyTaskPackRevisionComparison,
  type TaskPackRevisionComparisonState, type TaskPackRevisionHistorySnapshot } from "../src/utils/taskPackRevisionHistory";
import type { TaskPackRevisionDetail, TaskPackRevisionDetailItem, TaskPackRevisionHistory, TaskPackRevisionHistoryItem } from "../src/types";
import i18n from "../src/i18n";

let scenarios = 0;
async function scenario(name: string, run: () => void | Promise<void>) { await run(); scenarios++; process.stdout.write(`PASS ${name}\n`); }
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const ids = [810, 25, 187, 9]; // intentionally not sorted like their domain ordinals
const detail = (id = 810, patch: Partial<TaskPackRevisionDetailItem> = {}, taskPackId = 7): TaskPackRevisionDetail => ({
  taskPackId, currentRevisionId: 9, revision: { id, revisionNumber: ids.indexOf(id) + 1,
    baseRevisionId: id === 810 ? null : ids[ids.indexOf(id) - 1], sourceKind: "generated",
    createdAt: "2026-01-03T12:00:00.000Z", generatedAt: "2026-01-03T11:59:00Z", contentHash: `sha256:${"a".repeat(64)}`,
    generationMode: "template", generationModel: null, generationUsedFallback: false, reviewState: "unreviewed",
    rawTask: "RAW_BASE\n", taskType: "general", targetTool: "generic", generatedPrompt: "DOCUMENT_BASE\n", ...patch,
  },
});
const metadata = (id: number): TaskPackRevisionHistoryItem => {
  const { rawTask: _raw, taskType: _type, targetTool: _tool, generatedPrompt: _prompt, ...row } = detail(id).revision;
  return row;
};
const history = (taskPackId = 7): TaskPackRevisionHistory => ({ taskPackId, currentRevisionId: 9, revisions: [...ids].reverse().map(metadata) });
function fixture(read?: (id: number, taskPackId: number) => Promise<unknown>) {
  const calls: string[] = [];
  const controller = createTaskPackRevisionHistoryController(7, {
    getTaskPackRevisionHistory: async id => { calls.push(`history:${id}`); return history(id); },
    getTaskPackRevisionDetail: async (pack, id) => { calls.push(`detail:${pack}:${id}`); return read ? read(id, pack) : detail(id, {}, pack); },
  });
  return { controller, calls };
}
function pair(f: ReturnType<typeof fixture>, left = 810, right = 25) {
  f.controller.startComparison(left); f.controller.chooseComparisonRevision("right", right);
}
const reconstruct = (value: RevisionTextComparison, side: "left" | "right") => {
  assert.equal(value.mode, "line_diff");
  return value.mode === "line_diff" ? value.rows.map(row => row[side] ? row[side]!.content + row[side]!.ending : "").join("") : "";
};
async function textCase(name: string, left: string, right: string, kind?: string) {
  await scenario(name, () => {
    const value = compareTaskPackRevisionText(left, right);
    assert.equal(value.mode, "line_diff"); assert.equal(value.changed, left !== right);
    assert.equal(reconstruct(value, "left"), left); assert.equal(reconstruct(value, "right"), right);
    if (kind && value.mode === "line_diff") assert.ok(value.rows.some(row => row.kind === kind));
    assert.deepEqual(value, compareTaskPackRevisionText(left, right));
  });
}
await scenario("identical raw task remains unchanged", () => {
  assert.equal(compareTaskPackRevisions(detail(), detail(25)).rawTask.changed, false);
});
await scenario("identical generated prompt remains unchanged", () => {
  assert.equal(compareTaskPackRevisions(detail(), detail(25)).generatedPrompt.changed, false);
});
await textCase("single-line replacement becomes changed region", "before\n", "after\n", "changed");
await textCase("added line retains surrounding equal lines", "a\nz\n", "a\nb\nz\n", "added");
await textCase("removed line retains surrounding equal lines", "a\nb\nz\n", "a\nz\n", "removed");
await textCase("blank lines are authored differences", "a\n\nz\n", "a\nz\n", "removed");
await textCase("spaces-only difference is significant", " \n", "  \n", "changed");
await textCase("tabs-only difference is significant", "\t\n", "\t\t\n", "changed");
await textCase("trailing spaces are significant", "task \n", "task\n", "changed");
await textCase("LF versus CRLF is a real change", "same\n", "same\r\n", "changed");
await textCase("CR versus LF is a real change", "same\r", "same\n", "changed");
await textCase("Unicode emoji and Cyrillic survive exact line diff", "привет 👩‍💻\n終\r\n", "привет 🧑‍💻\n終\r\n", "changed");
await textCase("Unicode normalization is not silently applied", "é\n", "e\u0301\n", "changed");
await textCase("empty to non-empty produces added text", "", "task", "added");
await textCase("non-empty to empty produces removed text", "task", "", "removed");
await textCase("both empty are unchanged with no fabricated lines", "", "");
await textCase("final line ending is not discarded", "task", "task\n", "changed");
await textCase("mixed CRLF/CR/LF endings retain their order", "\r\n\r\na\rb\nc", "\na\rb\r\nc\n");
await scenario("empty/non-empty text fields have added/removed semantics", () => {
  assert.equal(compareTaskPackRevisionText("", "x").kind, "added");
  assert.equal(compareTaskPackRevisionText("x", "").kind, "removed");
  assert.equal(compareTaskPackRevisionText("", "").kind, "unchanged");
});
for (const [field, value] of Object.entries({ taskType: "bugfix", targetTool: "other-tool", sourceKind: "manual_edit",
  generationMode: "ollama", generationModel: "fixture-model", generationUsedFallback: true })) {
  await scenario(`scalar ${field} is compared exactly`, () => {
    const model = compareTaskPackRevisions(detail(), detail(25, { [field]: value }));
    assert.equal(model.hasContentChanges, true);
    assert.deepEqual(model.scalarChanges.filter(change => change.changed).map(change => change.field), [field]);
    assert.equal(model.rawTask.changed, false); assert.equal(model.generatedPrompt.changed, false);
  });
}
await scenario("model null/value/empty transitions are added or removed, not truthiness-normalized", () => {
  for (const value of ["model", ""]) {
    assert.equal(compareTaskPackRevisions(detail(), detail(25, { generationModel: value })).scalarChanges.find(change => change.field === "generationModel")?.kind, "added");
    assert.equal(compareTaskPackRevisions(detail(25, { generationModel: value }), detail()).scalarChanges.find(change => change.field === "generationModel")?.kind, "removed");
  }
});
await scenario("review state changes are metadata, not authored/content differences", () => {
  const model = compareTaskPackRevisions(detail(), detail(25, { reviewState: "accepted" }));
  assert.equal(model.hasContentChanges, false); assert.ok(!model.scalarChanges.some(change => String(change.field) === "reviewState"));
});
await scenario("created/generated timestamps and ancestry do not count as content changes", () => {
  const model = compareTaskPackRevisions(detail(), detail(25, { createdAt: "2026-02-01T12:00:00Z", generatedAt: null, baseRevisionId: 187 }));
  assert.equal(model.hasContentChanges, false);
});
await scenario("equal hash never short-circuits actual authored field comparison", () => {
  const model = compareTaskPackRevisions(detail(), detail(25, { rawTask: "different\r\n", generatedPrompt: "different document" }));
  assert.equal(model.rawTask.changed, true); assert.equal(model.generatedPrompt.changed, true);
});
await scenario("different hashes alone do not invent a content change", () => {
  assert.equal(compareTaskPackRevisions(detail(), detail(25, { contentHash: `sha256:${"b".repeat(64)}` })).hasContentChanges, false);
});
await scenario("only six safe scalars are compared, no lifecycle/event/private metadata fields", () => {
  assert.deepEqual(TASK_PACK_REVISION_SCALAR_FIELDS, ["taskType", "targetTool", "sourceKind", "generationMode", "generationModel", "generationUsedFallback"]);
  assert.deepEqual(compareTaskPackRevisions(detail(), detail(25)).scalarChanges.map(change => change.field), TASK_PACK_REVISION_SCALAR_FIELDS);
});
await scenario("input details are never mutated; immutable output is deterministic", () => {
  const left = detail(), right = detail(25, { rawTask: "  exact\t\r\n", generationModel: "" });
  const before = JSON.stringify([left, right]); Object.freeze(left.revision); Object.freeze(right.revision); Object.freeze(left); Object.freeze(right);
  const result = compareTaskPackRevisions(left, right);
  assert.equal(JSON.stringify([left, right]), before); assert.deepEqual(result, compareTaskPackRevisions(left, right));
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.scalarChanges) && Object.isFrozen(result.rawTask));
});
await scenario("explicit sides are preserved, never sorted by identity or ordinal", () => {
  const model = compareTaskPackRevisions(detail(187), detail(810));
  assert.equal(model.leftRevisionId, 187); assert.equal(model.rightRevisionId, 810);
});
await scenario("pure self-comparison is deterministic and unchanged", () => {
  const input = detail(); const model = compareTaskPackRevisions(input, input);
  assert.equal(model.hasContentChanges, false); assert.equal(model.leftRevisionId, model.rightRevisionId);
});
await scenario("cross-Task-Pack comparison is rejected", () => {
  assert.throws(() => compareTaskPackRevisions(detail(), detail(25, {}, 8)), /same Task Pack/);
});
await scenario("normal content uses bounded detailed diff", () => {
  const result = compareTaskPackRevisionText("a\nb\n", "a\nc\n");
  assert.equal(result.mode, "line_diff"); assert.equal(result.matrixCells, 9);
  assert.ok(result.matrixCells <= TASK_PACK_TEXT_DIFF_LIMITS.matrixCells);
});
await scenario("character budget fallback preserves both exact full texts and real inequality", () => {
  const left = "LEFT\t\r\n" + " ".repeat(TASK_PACK_TEXT_DIFF_LIMITS.totalCharacters) + "END_LEFT";
  const right = "RIGHT\r\nEND_RIGHT";
  const result = compareTaskPackRevisionText(left, right);
  assert.equal(result.mode, "side_by_side"); if (result.mode === "side_by_side") assert.equal(result.reason, "characters");
  assert.equal(result.leftText, left); assert.equal(result.rightText, right); assert.equal(result.changed, true); assert.equal(result.matrixCells, 0);
});
await scenario("line budget stops token growth and uses exact fallback", () => {
  const left = "\n".repeat(TASK_PACK_TEXT_DIFF_LIMITS.totalLines + 1);
  const result = compareTaskPackRevisionText(left, "\r\n");
  assert.equal(result.mode, "side_by_side"); if (result.mode === "side_by_side") assert.equal(result.reason, "lines");
  assert.equal(result.leftText, left); assert.equal(result.rightText, "\r\n"); assert.equal(result.matrixCells, 0);
});
await scenario("matrix work budget fails before allocation even below character and line limits", () => {
  const left = "a\n".repeat(500), right = "b\n".repeat(500);
  const result = compareTaskPackRevisionText(left, right);
  assert.equal(result.mode, "side_by_side"); if (result.mode === "side_by_side") assert.equal(result.reason, "matrix");
  assert.equal(result.matrixCells, 0); assert.equal(result.changed, true); assert.equal(result.leftText, left); assert.equal(result.rightText, right);
});
await scenario("actual typed-matrix allocation is bounded and absent for every fallback", () => {
  const original = globalThis.Uint16Array, sizes: number[] = [];
  globalThis.Uint16Array = new Proxy(original, { construct(target, args) { sizes.push(Number(args[0])); return Reflect.construct(target, args); } });
  try {
    compareTaskPackRevisionText("x".repeat(120_001), "");
    compareTaskPackRevisionText("\n".repeat(1201), "");
    compareTaskPackRevisionText("a\n".repeat(500), "b\n".repeat(500));
    assert.deepEqual(sizes, []);
    compareTaskPackRevisionText("a\nb\n", "a\nc\n"); assert.deepEqual(sizes, [9]);
    assert.ok(sizes.every(size => size <= TASK_PACK_TEXT_DIFF_LIMITS.matrixCells));
  } finally { globalThis.Uint16Array = original; }
});
await scenario("oversized identical texts do not become false changes", () => {
  const text = "same\r\n".repeat(25_000), result = compareTaskPackRevisionText(text, text);
  assert.equal(result.mode, "side_by_side"); assert.equal(result.changed, false); assert.equal(result.leftText, text);
});
await scenario("seeded exact-text reconstruction preserves source order across 256 diverse pairs", () => {
  let seed = 17;
  const random = (size: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % size; };
  const pieces = ["a", "b", " ", "\t", "\n", "\r", "\r\n", "👩‍💻", "Я", "e\u0301", ""];
  const text = () => Array.from({ length: random(30) }, () => pieces[random(pieces.length)]).join("");
  for (let i = 0; i < 256; i++) {
    const left = text(), right = text(), value = compareTaskPackRevisionText(left, right);
    assert.equal(reconstruct(value, "left"), left); assert.equal(reconstruct(value, "right"), right); assert.equal(value.changed, left !== right);
    if (value.mode === "line_diff") for (const row of value.rows) {
      assert.ok(row.left || row.right);
      if (row.kind === "equal") assert.equal(row.left!.content + row.left!.ending, row.right!.content + row.right!.ending);
    }
  }
});

await scenario("history activation remains one list GET with no comparison/single prefetch", async () => {
  const f = fixture(); await f.controller.activate(); assert.deepEqual(f.calls, ["history:7"]);
  assert.equal(f.controller.getSnapshot().comparison.active, false); f.controller.dispose();
});
await scenario("staging two revisions makes no GET; explicit Compare reads exactly those two", async () => {
  const f = fixture(); await f.controller.activate(); pair(f); assert.deepEqual(f.calls, ["history:7"]);
  await f.controller.compareSelectedRevisions(); assert.deepEqual(f.calls, ["history:7", "detail:7:810", "detail:7:25"]);
  assert.equal(f.controller.getSnapshot().comparison.status, "ready"); f.controller.dispose();
});
await scenario("same-revision selection is blocked without duplicate reads", async () => {
  const f = fixture(); await f.controller.activate(); pair(f, 810, 810); await f.controller.compareSelectedRevisions();
  assert.equal(f.controller.getSnapshot().comparison.rightRevisionId, null); assert.deepEqual(f.calls, ["history:7"]); f.controller.dispose();
});
await scenario("unlisted identities are ineligible and first-side changes are local only", async () => {
  const f = fixture(); await f.controller.activate(); f.controller.startComparison(999); assert.equal(f.controller.getSnapshot().comparison.active, false);
  f.controller.startComparison(810); f.controller.chooseComparisonRevision("left", 187); f.controller.chooseComparisonRevision("right", 999);
  assert.equal(f.controller.getSnapshot().comparison.leftRevisionId, 187); assert.equal(f.controller.getSnapshot().comparison.rightRevisionId, null);
  assert.deepEqual(f.calls, ["history:7"]); f.controller.dispose();
});
await scenario("side order follows explicit selection, not global IDs or chronological sorting", async () => {
  const f = fixture(); await f.controller.activate(); pair(f, 187, 810); await f.controller.compareSelectedRevisions();
  assert.equal(f.controller.getSnapshot().comparison.leftDetail?.revision.revisionNumber, 3);
  assert.equal(f.controller.getSnapshot().comparison.rightDetail?.revision.revisionNumber, 1); f.controller.dispose();
});
await scenario("swapping ready sides requires no GET and preserves metadata alignment", async () => {
  const f = fixture(); await f.controller.activate(); pair(f); await f.controller.compareSelectedRevisions();
  const calls = [...f.calls]; f.controller.swapComparisonSides();
  assert.deepEqual(f.calls, calls); assert.equal(f.controller.getSnapshot().comparison.leftRevisionId, 25);
  assert.equal(f.controller.getSnapshot().comparison.leftDetail?.revision.id, 25);
  assert.equal(f.controller.getSnapshot().comparison.rightDetail?.revision.id, 810); f.controller.dispose();
});
await scenario("starting comparison retains prior single inspection, exit returns without GET", async () => {
  const f = fixture(); await f.controller.activate(); await f.controller.selectRevision(187);
  const single = f.controller.getSnapshot().detail; pair(f); await f.controller.compareSelectedRevisions(); const calls = [...f.calls];
  assert.equal(f.controller.getSnapshot().detail, single); f.controller.clearComparison();
  assert.deepEqual(f.calls, calls); assert.equal(f.controller.getSnapshot().detail, single); assert.equal(f.controller.getSnapshot().selectedRevisionId, 187); f.controller.dispose();
});
await scenario("duplicate pending Compare and Retry cannot exceed two GETs", async () => {
  const pending = deferred<unknown>(); const f = fixture(id => id === 810 ? pending.promise : Promise.resolve(detail(id)));
  await f.controller.activate(); pair(f); const waiting = f.controller.compareSelectedRevisions(); await f.controller.compareSelectedRevisions(); await f.controller.retryComparison();
  assert.deepEqual(f.calls, ["history:7", "detail:7:810", "detail:7:25"]);
  f.controller.swapComparisonSides(); assert.equal(f.controller.getSnapshot().comparison.leftRevisionId, 810);
  pending.resolve(detail()); await waiting; f.controller.dispose();
});
await scenario("changing pair A/B to C/D invalidates earlier comparison responses", async () => {
  const pending = new Map(ids.map(id => [id, deferred<unknown>()])); const f = fixture(id => pending.get(id)!.promise);
  await f.controller.activate(); pair(f); const first = f.controller.compareSelectedRevisions();
  f.controller.chooseComparisonRevision("left", 187); f.controller.chooseComparisonRevision("right", 9);
  const next = f.controller.compareSelectedRevisions(); pending.get(187)!.resolve(detail(187)); pending.get(9)!.resolve(detail(9)); await next;
  pending.get(810)!.resolve(detail(810)); pending.get(25)!.resolve(detail(25)); await first;
  const state = f.controller.getSnapshot().comparison;
  assert.equal(state.status, "ready"); assert.equal(state.leftDetail?.revision.id, 187); assert.equal(state.rightDetail?.revision.id, 9); f.controller.dispose();
});
await scenario("changing staged pair invalidates old results even without launching the new read", async () => {
  const pending = deferred<unknown>(); const f = fixture(id => id === 810 ? pending.promise : Promise.resolve(detail(id)));
  await f.controller.activate(); pair(f); const waiting = f.controller.compareSelectedRevisions(); f.controller.chooseComparisonRevision("left", 187);
  pending.resolve(detail()); await waiting;
  assert.equal(f.controller.getSnapshot().comparison.status, "idle"); assert.equal(f.controller.getSnapshot().comparison.leftDetail, null); f.controller.dispose();
});
await scenario("late Task Pack A comparison cannot populate B", async () => {
  const pending = deferred<unknown>(); const a = fixture(id => id === 810 ? pending.promise : Promise.resolve(detail(id)));
  await a.controller.activate(); pair(a); const waiting = a.controller.compareSelectedRevisions(); a.controller.dispose();
  const b = createTaskPackRevisionHistoryController(8, { getTaskPackRevisionHistory: async () => history(8),
    getTaskPackRevisionDetail: async (_pack, id) => detail(id, {}, 8) });
  await b.activate(); b.startComparison(187); b.chooseComparisonRevision("right", 9); await b.compareSelectedRevisions();
  pending.resolve(detail()); await waiting;
  assert.equal(a.controller.getSnapshot().comparison.leftDetail, null); assert.equal(b.getSnapshot().comparison.leftDetail?.taskPackId, 8); b.dispose();
});
await scenario("clearing comparison invalidates pending ownership and retains single history", async () => {
  const pending = deferred<unknown>(); const f = fixture(id => id === 810 ? pending.promise : Promise.resolve(detail(id)));
  await f.controller.activate(); await f.controller.selectRevision(187); const single = f.controller.getSnapshot().detail;
  pair(f); const waiting = f.controller.compareSelectedRevisions(); f.controller.clearComparison(); pending.resolve(detail()); await waiting;
  assert.deepEqual(f.controller.getSnapshot().comparison, emptyTaskPackRevisionComparison()); assert.equal(f.controller.getSnapshot().detail, single); f.controller.dispose();
});
await scenario("late single-detail response cannot corrupt ready comparison state", async () => {
  const pending = deferred<unknown>(); const f = fixture(id => id === 810 ? pending.promise : Promise.resolve(detail(id)));
  await f.controller.activate(); const singleRead = f.controller.selectRevision(810); pair(f, 187, 25); await f.controller.compareSelectedRevisions();
  const comparison = f.controller.getSnapshot().comparison; pending.resolve(detail()); await singleRead;
  assert.equal(f.controller.getSnapshot().comparison, comparison); assert.equal(f.controller.getSnapshot().detail?.revision.id, 810); f.controller.dispose();
});
await scenario("explicit inspection leaves comparison and ignores its late responses", async () => {
  const pending = deferred<unknown>(); const f = fixture(id => id === 810 ? pending.promise : Promise.resolve(detail(id)));
  await f.controller.activate(); pair(f); const waiting = f.controller.compareSelectedRevisions(); await f.controller.selectRevision(187);
  pending.reject(new Error("private SQL")); await waiting;
  assert.equal(f.controller.getSnapshot().comparison.active, false); assert.equal(f.controller.getSnapshot().detail?.revision.id, 187); f.controller.dispose();
});
await scenario("returning to an already pending inspection exits comparison without duplicate detail GET", async () => {
  const pending = deferred<unknown>(); const f = fixture(id => id === 810 ? pending.promise : Promise.resolve(detail(id)));
  await f.controller.activate(); const waiting = f.controller.selectRevision(810); pair(f, 187, 25); await f.controller.compareSelectedRevisions();
  const calls = [...f.calls]; await f.controller.selectRevision(810);
  assert.equal(f.controller.getSnapshot().comparison.active, false); assert.deepEqual(f.calls, calls);
  pending.resolve(detail()); await waiting; assert.equal(f.controller.getSnapshot().detail?.revision.id, 810); f.controller.dispose();
});
await scenario("StrictMode reactivation invalidates prior comparison even for the same owner", async () => {
  const pending = deferred<unknown>(); const f = fixture(id => id === 810 ? pending.promise : Promise.resolve(detail(id)));
  await f.controller.activate(); pair(f); const old = f.controller.compareSelectedRevisions();
  f.controller.dispose(); await f.controller.activate(); assert.equal(f.controller.getSnapshot().comparison.active, false);
  pair(f, 187, 9); await f.controller.compareSelectedRevisions(); pending.resolve(detail()); await old;
  assert.equal(f.controller.getSnapshot().comparison.leftRevisionId, 187); assert.equal(f.controller.getSnapshot().comparison.rightDetail?.revision.id, 9); f.controller.dispose();
});
await scenario("failed comparison preserves list and selected inspection; Retry reads only its two sides", async () => {
  let fail = true; const f = fixture(async id => { if (id === 25 && fail) throw new Error("private SQL driver details"); return detail(id); });
  await f.controller.activate(); await f.controller.selectRevision(187); const single = f.controller.getSnapshot().detail, list = f.controller.getSnapshot().history;
  pair(f); await f.controller.compareSelectedRevisions();
  assert.equal(f.controller.getSnapshot().status, "ready"); assert.equal(f.controller.getSnapshot().history, list);
  assert.equal(f.controller.getSnapshot().comparison.status, "failed"); assert.equal(f.controller.getSnapshot().comparison.rightIssue, "failed");
  assert.equal(f.controller.getSnapshot().detail, single); const before = f.calls.length; fail = false; await f.controller.retryComparison();
  assert.deepEqual(f.calls.slice(before), ["detail:7:810", "detail:7:25"]); assert.equal(f.controller.getSnapshot().comparison.status, "ready"); f.controller.dispose();
});
await scenario("404 is unavailable per side; operational/parse errors stay generic and private data is discarded", async () => {
  const f = fixture(async id => { if (id === 810) throw new ApiRequestError("private SQL", 404, { cause: "secret" }); return { ...detail(id), diagnostics: "private" }; });
  await f.controller.activate(); pair(f); await f.controller.compareSelectedRevisions();
  const state = f.controller.getSnapshot(); assert.equal(state.comparison.leftIssue, "unavailable"); assert.equal(state.comparison.rightIssue, "failed");
  assert.doesNotMatch(JSON.stringify(state), /SQL|private|secret|cause|stack|diagnostics/); f.controller.dispose();
});
await scenario("history refresh clears pair and invalidates comparison reads", async () => {
  const pending = deferred<unknown>(); const f = fixture(id => id === 810 ? pending.promise : Promise.resolve(detail(id)));
  await f.controller.activate(); pair(f); const waiting = f.controller.compareSelectedRevisions(); await f.controller.refresh(); pending.resolve(detail()); await waiting;
  assert.equal(f.controller.getSnapshot().comparison.active, false); assert.equal(f.controller.getSnapshot().status, "ready"); f.controller.dispose();
});
await scenario("disposed owner cannot start/read/swap/retry comparison", async () => {
  const f = fixture(); await f.controller.activate(); pair(f); f.controller.dispose();
  f.controller.startComparison(187); f.controller.chooseComparisonRevision("right", 9); f.controller.swapComparisonSides();
  await f.controller.compareSelectedRevisions(); await f.controller.retryComparison(); assert.deepEqual(f.calls, ["history:7"]);
});
await scenario("one-revision history cannot form a pair or trigger detail reads", async () => {
  let reads = 0; const controller = createTaskPackRevisionHistoryController(7, { getTaskPackRevisionHistory: async () => ({ ...history(), revisions: [metadata(810)] }),
    getTaskPackRevisionDetail: async () => { reads++; return detail(); } });
  await controller.activate(); controller.startComparison(810); await controller.compareSelectedRevisions();
  assert.equal(controller.getSnapshot().comparison.active, false); assert.equal(reads, 0); controller.dispose();
});
await scenario("comparison with 1000 history rows still requires only two detail reads", async () => {
  let lists = 0, reads = 0;
  const controller = createTaskPackRevisionHistoryController(7, { getTaskPackRevisionHistory: async () => { lists++; return { ...history(),
    revisions: Array.from({ length: 1000 }, (_, i) => ({ ...metadata(810), id: i + 1, revisionNumber: i + 1 })) }; },
    getTaskPackRevisionDetail: async (_pack, id) => { reads++; return detail(810, { id, revisionNumber: id }); } });
  await controller.activate(); controller.startComparison(400); controller.chooseComparisonRevision("right", 900); await controller.compareSelectedRevisions();
  assert.equal(lists, 1); assert.equal(reads, 2); controller.dispose();
});
await scenario("real existing API clients use two detail GETs and no compare endpoint", async () => {
  const original = globalThis.fetch, requests: string[] = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(init?.method ?? "GET", "GET"); assert.equal(init?.body, undefined); requests.push(String(url));
    const match = String(url).match(/\/revisions\/(\d+)$/);
    return new Response(JSON.stringify(match ? { ok: true, revision: detail(Number(match[1])) } : { ok: true, history: history() }));
  };
  try {
    const controller = createTaskPackRevisionHistoryController(7, { getTaskPackRevisionHistory, getTaskPackRevisionDetail });
    await controller.activate(); controller.startComparison(810); controller.chooseComparisonRevision("right", 25); await controller.compareSelectedRevisions();
    assert.deepEqual(requests, ["http://localhost:4000/api/task-packs/7/revisions", "http://localhost:4000/api/task-packs/7/revisions/810", "http://localhost:4000/api/task-packs/7/revisions/25"]);
    controller.dispose();
  } finally { globalThis.fetch = original; }
});

const actions = { onChooseRevision: () => {}, onCompare: async () => {}, onSwap: () => {}, onExit: () => {}, onRetry: async () => {} };
const readyComparison = (left = detail(), right = detail(25, { rawTask: "RAW_TARGET\n", generatedPrompt: "DOCUMENT_TARGET\r\n", reviewState: "accepted" })): TaskPackRevisionComparisonState => ({
  active: true, status: "ready", leftRevisionId: left.revision.id, rightRevisionId: right.revision.id,
  leftDetail: left, rightDetail: right, leftIssue: null, rightIssue: null,
});
const snapshot = (comparison = emptyTaskPackRevisionComparison()): TaskPackRevisionHistorySnapshot => ({ taskPackId: 7, status: "ready", history: history(),
  selectedRevisionId: 187, detailStatus: "ready", detail: detail(187), detailUnavailable: false, comparison });
const panelActions = { onRefresh: async () => {}, onRetryHistory: async () => {}, onSelectRevision: async () => {}, onRetryDetail: async () => {},
  onStartComparison: () => {}, onChooseComparisonRevision: () => {}, onCompareSelectedRevisions: async () => {},
  onSwapComparisonSides: () => {}, onClearComparison: () => {}, onRetryComparison: async () => {} };
const render = (comparison = readyComparison()) => renderToStaticMarkup(createElement(TaskPackRevisionComparison, { history: history(), comparison, ...actions }));
const renderPanel = (state = snapshot()) => renderToStaticMarkup(createElement(TaskPackRevisionHistoryPanel, { ...state, ...panelActions }));
const source = (file: string) => fs.readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
const comparisonSource = source("components/taskPacks/TaskPackRevisionComparison.tsx"), panelSource = source("components/taskPacks/TaskPackRevisionHistoryPanel.tsx");
const ownerSource = source("utils/taskPackRevisionHistory.ts"), helperSource = source("utils/taskPackRevisionComparison.ts");
const pageSource = source("pages/TaskPackResultPage.tsx"), clientSource = source("api/client.ts");
await i18n.changeLanguage("en");
await scenario("comparison stays inside existing History/Review and modes remain unchanged", () => {
  assert.deepEqual(TASK_PACK_WORKSPACE_VIEWS, ["document", "review", "details"]);
  const branch = pageSource.slice(pageSource.indexOf('data-task-pack-view="review"'), pageSource.indexOf('hidden={workspaceView !== "details"}'));
  assert.match(branch, /<TaskPackRevisionHistoryPanel/); assert.match(panelSource, /<TaskPackRevisionComparison/);
  assert.match(renderPanel(snapshot(readyComparison())), /data-task-pack-revision-history[\s\S]*data-revision-comparison/);
});
await scenario("single inspection remains mounted only outside comparison and still shows exact authored text", () => {
  assert.match(renderPanel(), /data-historical-revision/); assert.doesNotMatch(renderPanel(), /data-revision-comparison/);
  assert.match(renderPanel(snapshot(readyComparison())), /data-revision-comparison/);
  assert.doesNotMatch(renderPanel(snapshot(readyComparison())), /data-historical-revision/);
  assert.match(renderPanel(), /RAW_BASE/);
});
await scenario("each row has a narrow keyboard button with an ordinal-based Compare name", () => {
  const html = renderPanel();
  assert.equal((html.match(/aria-label="Compare revision \d+"/g) ?? []).length, 4);
  assert.match(html, /aria-label="Compare revision 1"/); assert.doesNotMatch(html, /aria-label="Compare revision 810"/);
});
await scenario("comparison exposes exactly two labelled native selectors and excludes the same ID", () => {
  const html = render(); assert.equal((html.match(/<select\b/g) ?? []).length, 2);
  assert.match(html, /aria-label="Left \/ Base"/); assert.match(html, /aria-label="Right \/ Target"/);
  assert.match(html, /<option value="25" disabled="">Revision 2<\/option>/);
  assert.match(html, /<option value="810" disabled="">Revision 1<\/option>/);
});
await scenario("partial pair offers Select second revision and cannot issue Compare", () => {
  const html = render({ ...emptyTaskPackRevisionComparison(), active: true, leftRevisionId: 810 });
  assert.match(html, /Select second revision/); assert.match(html, /disabled=""[^>]*>Compare<\/button>/);
});
await scenario("loading keeps pair selection usable and disables duplicate Compare/Swap", () => {
  const html = render({ ...readyComparison(), status: "loading", leftDetail: null, rightDetail: null });
  assert.match(html, /Comparing revisions/); assert.equal((html.match(/<select\b/g) ?? []).length, 2);
  assert.match(html, /disabled=""[^>]*>Compare<\/button>/);
});
await scenario("headers use revisionNumber and explicit base/target rather than global identity", () => {
  const html = render(); const visible = html.replace(/<[^>]*>/g, "");
  assert.match(visible, /Revision 1/); assert.match(visible, /Revision 2/); assert.doesNotMatch(visible, /Revision 810|Revision 25/);
  assert.match(html, /data-comparison-side="left"/); assert.match(html, /data-comparison-side="right"/);
  assert.match(html, /Left \/ Base/); assert.match(html, /Right \/ Target/);
});
await scenario("review/source/timestamps/hash remain revision metadata without fake lifecycle", () => {
  const html = render();
  for (const label of ["Unreviewed", "Accepted", "Historical", "Source", "Created", "Generated", "Content hash"]) assert.ok(html.includes(label), label);
  assert.doesNotMatch(comparisonSource, /currentReviewState|acceptedRevisionId|TaskPackWorkflowBadges|\.lifecycle|lifecycleVersion/);
  assert.doesNotMatch(html, />Active<|>Completed<|>Archived</);
});
await scenario("current selected revision header is metadata-only with the correct current marker", () => {
  const html = render(readyComparison(detail(), detail(9))); assert.match(html, />Current<\/span>/);
  assert.match(html, /Revision 4/); assert.doesNotMatch(html, /Revision 9/);
});
await scenario("raw task and generated document have distinct comparison sections", () => {
  const html = render(); assert.match(html, /data-comparison-field="rawTask"/); assert.match(html, /data-comparison-field="generatedPrompt"/);
  for (const label of ["RAW_BASE", "RAW_TARGET", "DOCUMENT_BASE", "DOCUMENT_TARGET"]) assert.ok(html.includes(label));
});
await scenario("exact line endings and semantic Added/Removed labels do not rely on color", () => {
  const html = render(); assert.match(html, /data-diff-kind="changed"/); assert.match(html, />Removed<\/span>/); assert.match(html, />Added<\/span>/);
  assert.match(html, />CRLF<\/span>/); assert.match(html, />LF<\/span>/);
  assert.match(render(readyComparison(detail(), detail(25, { rawTask: "RAW_BASE" }))), /No line ending/);
});
await scenario("detailed rendering preserves authored whitespace by default and offers explicit markers", () => {
  const html = render(readyComparison(detail(810, { rawTask: " \tspace  \r\n" }), detail(25, { rawTask: "\tspace \n" })));
  assert.ok(html.includes(" \tspace  ")); assert.ok(html.includes("\tspace "));
  assert.match(html, /Show whitespace in detailed diff/); assert.match(html, /type="checkbox"/);
});
await scenario("all six scalar fields render with changed/unchanged/added/removed semantics", () => {
  const html = render(readyComparison(detail(810, { generationModel: "before" }), detail(25, { generationModel: null, taskType: "bugfix" })));
  for (const field of TASK_PACK_REVISION_SCALAR_FIELDS) assert.ok(html.includes(`data-scalar-field="${field}"`));
  assert.match(html, /Changed/); assert.match(html, /Unchanged/); assert.match(html, /Removed/); assert.match(html, /Not set/);
  assert.match(render(readyComparison(detail(), detail(25, { generationModel: "model" }))), /Added/);
});
await scenario("review-only changes still truthfully show no content differences", () => {
  const html = render(readyComparison(detail(), detail(25, { reviewState: "accepted" })));
  assert.match(html, /No content differences/); assert.match(html, /Accepted/); assert.match(html, /Unreviewed/);
});
await scenario("large fallback renders exact complete left/right text with a truthful notice", () => {
  const left = "LARGE_LEFT_START\t\r\n" + "x".repeat(120_001) + "\r\nLARGE_LEFT_END";
  const right = "LARGE_RIGHT_START  \r\nLARGE_RIGHT_END";
  const html = render(readyComparison(detail(810, { rawTask: left }), detail(25, { rawTask: right })));
  assert.match(html, /Detailed line diff is unavailable for this size/); assert.match(html, /nothing is truncated/);
  assert.match(html, /data-diff-mode="side_by_side"/);
  assert.equal(html.match(/<pre data-full-text="left"[^>]*>([\s\S]*?)<\/pre>/)![1], left);
  assert.equal(html.match(/<pre data-full-text="right"[^>]*>([\s\S]*?)<\/pre>/)![1], right);
  assert.doesNotMatch(html, /No content differences/);
});
await scenario("large comparison fallback keeps only one bounded keyboard-scrollable full-text block per side/field", () => {
  const left = "\tLARGE_LEFT\r\n" + "x".repeat(150_000) + "\r\nEND_LEFT  ";
  const right = "\tLARGE_RIGHT\r\n" + "y".repeat(150_000) + "\r\nEND_RIGHT  ";
  const html = renderPanel(snapshot(readyComparison(detail(810, { rawTask: left, generatedPrompt: left }), detail(25, { rawTask: right, generatedPrompt: right }))));
  assert.doesNotMatch(html, /data-historical-revision/);
  const blocks = [...html.matchAll(/<pre data-full-text="(left|right)"([^>]*)>([\s\S]*?)<\/pre>/gu)];
  assert.equal(blocks.length, 4); assert.equal((html.match(/<pre\b/gu) ?? []).length, 4);
  for (const block of blocks) {
    assert.equal(block[3], block[1] === "left" ? left : right);
    for (const css of ["max-h-96", "min-w-0", "overflow-auto", "whitespace-pre-wrap"]) assert.ok(block[2].includes(css));
    assert.match(block[2], /tabindex="0"/); assert.match(block[2], /aria-label=/);
  }
});
await scenario("detailed comparison regions are bounded/scrollable and render per line, never per character", () => {
  const html = render(readyComparison(detail(810, { rawTask: "a\n".repeat(200) }), detail(25, { rawTask: "b\n".repeat(200) })));
  const regions = [...html.matchAll(/<div class="([^"]*)" data-diff-mode="line_diff"([^>]*)>/gu)];
  assert.equal(regions.length, 2);
  for (const region of regions) {
    for (const css of ["max-h-96", "min-w-0", "overflow-auto"]) assert.ok(region[1].includes(css));
    assert.match(region[2], /tabindex="0"/); assert.match(region[2], /role="region"/); assert.match(region[2], /aria-label=/);
  }
  assert.doesNotMatch(comparisonSource, /ReactMarkdown|\.split\(""\)|Array\.from\(value\.|\.substring\(|\.slice\(/);
  assert.match(comparisonSource, /value.rows.map/);
});
await scenario("comparison failure is safe/localized with usable History and Retry", () => {
  const state = { ...readyComparison(), status: "failed" as const, leftDetail: null, rightDetail: null,
    leftIssue: "unavailable" as const, rightIssue: "failed" as const };
  const html = renderPanel(snapshot(state));
  for (const label of ["Comparison is unavailable", "This revision is no longer available", "Revision could not be loaded", "Retry comparison", "Revision 4"]) assert.ok(html.includes(label));
  assert.doesNotMatch(html, /SQL|driver|secret|stack|cause/);
});
await scenario("exit is accessible, restores source-row focus, and does not add a focus trap", () => {
  assert.match(render(), />Exit comparison<\/button>/);
  assert.match(panelSource, /onClearComparison\(\);\s*comparisonTrigger.current\?\.focus\(\)/);
  assert.match(comparisonSource, /rightSelect.current\?\.focus\(\)/);
  assert.doesNotMatch(comparisonSource, /focusTrap|createPortal|<Modal|role="dialog"/);
});
await scenario("comparison controls have no edit/review/lifecycle/restore/export authority", () => {
  const html = render();
  assert.doesNotMatch(html, />Save<|>Edit<|>Accept<|>Complete<|>Archive<|>Reopen<|>Restore<|>Revert<|>Promote<|>Publish<|>Open in builder</);
  assert.doesNotMatch(comparisonSource, /onSave|onEdit|onAccept|onArchive|onComplete|onRestore|onExport|onPublish|onOpenInBuilder|api\/client|fetch\(/);
});
await scenario("pure helper has no React/network/Composer diff/dependency/mutation imports", () => {
  assert.doesNotMatch(helperSource, /from "react|fetch\(|api\/|contextDiff|diff-match-patch|\.normalize\(|\.trim\(/);
  assert.doesNotMatch(ownerSource, /setInterval|setTimeout|Promise\.all\([^\n]*\.map\(/);
  assert.match(ownerSource, /Promise\.all\(\[readSide\(leftRevisionId\), readSide\(rightRevisionId\)\]\)/);
});
await scenario("Result ownership remains isolated from current TaskPack/editor/workflow and client has no compare API", () => {
  assert.equal((pageSource.match(/useTaskPackRevisionHistory\(/g) ?? []).length, 1);
  assert.equal((pageSource.match(/useTaskPackWorkflow\(/g) ?? []).length, 1);
  const binding = pageSource.match(/<TaskPackRevisionHistoryPanel[\s\S]*?\/>/)![0];
  assert.doesNotMatch(binding, /currentTaskPack|editorSession|workflowController|onTaskPackUpdated|onOpenInBuilder/);
  assert.doesNotMatch(pageSource, /setCurrentTaskPack\([^)]*(?:comparison|revisionHistory)/);
  assert.doesNotMatch(clientSource, /\/compare|compareTaskPack|comparisonEndpoint/i);
});
await scenario("EN/RU comparison keysets synchronize recursively without duplicate review labels", () => {
  const en = i18n.getResourceBundle("en", "translation"), ru = i18n.getResourceBundle("ru", "translation");
  function keys(value: Record<string, unknown>, prefix = ""): string[] {
    return Object.entries(value).flatMap(([key, item]) => typeof item === "object" && item !== null
      ? keys(item as Record<string, unknown>, `${prefix}${key}.`) : [`${prefix}${key}`]).sort();
  }
  assert.deepEqual(keys(en.taskPackRevisionComparison), keys(ru.taskPackRevisionComparison));
  assert.ok(!Object.hasOwn(en.taskPackRevisionComparison, "review"));
});
await i18n.changeLanguage("ru");
await scenario("Russian comparison, semantics and failure actions are translated", () => {
  const html = render(); for (const text of ["Сравнение ревизий", "Слева / База", "Справа / Цель", "Ревизия 1", "Удалено", "Добавлено", "Выйти из сравнения"]) assert.ok(html.includes(text));
  assert.match(render({ ...readyComparison(), status: "failed", leftIssue: "unavailable" }), /Повторить сравнение/);
});
process.stdout.write(`Task Pack revision comparison smoke passed: ${scenarios} scenarios (pure exact/bounded diff, runtime requests/races, rendered read-only UI and narrow wiring; not visual Desktop QA).\n`);
