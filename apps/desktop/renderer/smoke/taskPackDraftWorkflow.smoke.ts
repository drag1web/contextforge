import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import type { ContextComposerPreview, TaskPackDraft, TaskPackDraftSession, TaskPackPersistedDraftView } from "../src/types";
import {
  applyTaskPackDraftOperationResult, canOrdinaryGenerateTaskPackDraft,
  captureTaskPackDraftOperation, createTaskPackDraftSessionFromPersisted,
  createTransientTaskPackDraftSession, editTaskPackDraftSession,
  executeTaskPackDraftOperation, isTaskPackDraftSessionDirty,
  serializeTaskPackDraftContent, taskPackDraftPersistenceIssue, taskPackDraftSessionKey,
  type TaskPackDraftPersistenceApi,
} from "../src/utils/taskPackDraftSession";
import {
  applyDraftOperationToHistory, invalidateDraftSessionHistory, synchronizeDraftSessionHistory,
  type WorkspaceNavigationHistoryState,
} from "../src/hooks/useWorkspaceNavigationHistory";
import i18n from "../src/i18n";
import { getDropdownMenuPosition } from "../src/components/ui/DropdownMenu";

let scenarios = 0;
let wiringScenarios = 0;
async function scenario(name: string, run: () => void | Promise<void>, wiring = false) {
  await run();
  scenarios += 1;
  if (wiring) wiringScenarios += 1;
  process.stdout.write(`PASS ${name}\n`);
}
const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const controller = source("hooks/useDashboardController.ts");
const dashboard = source("pages/DashboardPage.tsx");
const builder = source("pages/TaskPackBuilderPage.tsx");
const composer = source("pages/ContextComposerPage.tsx");
const dropdown = source("components/ui/DropdownMenu.tsx");
const confirmDialog = source("components/ui/ConfirmDialog.tsx");
function section(text: string, start: string, end: string) {
  const offset = text.indexOf(start);
  const stop = text.indexOf(end, offset + start.length);
  assert.ok(offset >= 0 && stop > offset, `Missing wiring boundary: ${start}`);
  return text.slice(offset, stop);
}
function draft(): TaskPackDraft {
  return {
    projectId: 3, projectName: "Local project", rawTask: "  task\r\ntext  ", taskType: "general", targetTool: "codex",
    templateId: "", ruleProfileId: "", enabledRuleIds: ["b", "a", "b"],
    customRulesText: " rule\r\nrule ", acceptanceCriteriaText: "",
    clarifications: [{ question: " question? ", answer: "" }],
    performanceSessionId: "performance", understandingSnapshotId: "understanding",
    reviewedUnderstandingSnapshotId: "understanding",
  };
}
function view(overrides: Partial<TaskPackPersistedDraftView> = {}): TaskPackPersistedDraftView {
  return {
    id: "server-opaque", projectId: 3, projectName: "Local project", taskPackId: null, baseRevisionId: null,
    lifecycle: { state: "active", materializedRevisionId: null }, draftVersion: 4,
    createdAt: "2026-09-24T10:00:00.000Z", updatedAt: "2026-09-24T11:00:00.000Z", expiresAt: null,
    content: serializeTaskPackDraftContent(draft()), ...overrides,
  };
}
const transient = (id = "local-A") => createTransientTaskPackDraftSession(id, draft());
const persisted = () => createTaskPackDraftSessionFromPersisted("local-A", view());
const edited = () => editTaskPackDraftSession(persisted(), { ...draft(), rawTask: " unsaved\r\ntext " });
function apiReturning(result: TaskPackPersistedDraftView) {
  const calls: { method: string; args: unknown[] }[] = [];
  const api: TaskPackDraftPersistenceApi = {
    async createTaskPackDraft(...args) { calls.push({ method: "POST", args }); return result; },
    async updateTaskPackDraft(...args) { calls.push({ method: "PATCH", args }); return result; },
    async discardTaskPackDraft(...args) { calls.push({ method: "DISCARD", args }); return result; },
    async getTaskPackDraft(...args) { calls.push({ method: "GET", args }); return result; },
  };
  return { api, calls };
}
function history(session: TaskPackDraftSession): WorkspaceNavigationHistoryState {
  // History only carries this opaque preview; no fake generation or selector output is exercised.
  const preview = {} as ContextComposerPreview;
  return { index: 1, entries: [
    { page: "projects", surface: "project-details", projectId: 3 },
    { page: "projects", surface: "task-pack-builder", session },
    { page: "projects", surface: "context-composer", session, preview },
    { page: "dashboard", surface: "page" },
    { page: "projects", surface: "task-pack-builder", session: transient("local-B") },
  ] };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

await scenario("new transient session has independent stable renderer identity", () => {
  const session = transient();
  assert.equal(session.sessionId, "local-A"); assert.equal(session.persistence, null);
  assert.notEqual(session.sessionId, view().id);
});
await scenario("edits preserve session identity, token and saved baseline", () => {
  const current = persisted();
  const next = editTaskPackDraftSession(current, { ...current.draft, rawTask: "changed" });
  assert.equal(next.sessionId, current.sessionId); assert.equal(next.persistence, current.persistence);
  assert.equal(current.draft.rawTask, draft().rawTask);
});
await scenario("editing cannot move a session into another project", () => {
  assert.throws(() => editTaskPackDraftSession(persisted(), { ...draft(), projectId: 9 }));
});
await scenario("first Save serializes exact content and explicitly null aggregate binding", async () => {
  const { api, calls } = apiReturning(view({ draftVersion: 1 }));
  const operation = captureTaskPackDraftOperation(transient(), "saving")!;
  await executeTaskPackDraftOperation(operation, api);
  assert.deepEqual(calls, [{ method: "POST", args: [{
    projectId: 3, taskPackId: null, baseRevisionId: null, content: serializeTaskPackDraftContent(draft()),
  }] }]);
});
await scenario("first Save attaches server metadata to the SAME local session", () => {
  const current = transient();
  const next = applyTaskPackDraftOperationResult(current, captureTaskPackDraftOperation(current, "saving")!, view())!;
  assert.equal(next.sessionId, current.sessionId);
  assert.equal(next.persistence?.id, view().id); assert.equal(next.persistence?.draftVersion, 4);
  assert.deepEqual(next.persistence?.lifecycle, view().lifecycle);
});
await scenario("Save retains newer local text typed while request was pending", async () => {
  const before = transient();
  const operation = captureTaskPackDraftOperation(before, "saving")!;
  const response = deferred<TaskPackPersistedDraftView>();
  const api = apiReturning(view()).api;
  api.createTaskPackDraft = () => response.promise;
  const pending = executeTaskPackDraftOperation(operation, api);
  const current = editTaskPackDraftSession(before, { ...before.draft, rawTask: "newer local text" });
  response.resolve(view());
  const next = applyTaskPackDraftOperationResult(current, operation, await pending)!;
  assert.equal(next.draft.rawTask, "newer local text");
  assert.deepEqual(next.persistence?.lastSavedContent, view().content);
  assert.ok(isTaskPackDraftSessionDirty(next));
});
await scenario("subsequent Save uses captured version and full immutable request snapshot", async () => {
  const current = edited();
  const operation = captureTaskPackDraftOperation(current, "saving")!;
  const snapshot = structuredClone(operation.content);
  current.draft.rawTask = "typing later";
  current.draft.enabledRuleIds!.push("later");
  const { api, calls } = apiReturning(view({ draftVersion: 8 }));
  await executeTaskPackDraftOperation(operation, api);
  assert.deepEqual(calls, [{ method: "PATCH", args: [view().id, { expectedDraftVersion: 4, content: snapshot }] }]);
});
await scenario("Save uses returned version rather than inventing version plus one", () => {
  const current = edited();
  const next = applyTaskPackDraftOperationResult(current, captureTaskPackDraftOperation(current, "saving")!, view({ draftVersion: 8 }))!;
  assert.equal(next.persistence?.draftVersion, 8);
});
await scenario("semantic no-op Save with unchanged server version succeeds", () => {
  const current = persisted();
  const next = applyTaskPackDraftOperationResult(current, captureTaskPackDraftOperation(current, "saving")!, view())!;
  assert.equal(next.persistence?.draftVersion, 4); assert.ok(!isTaskPackDraftSessionDirty(next));
});
await scenario("persisted clean content becomes dirty on edit and clean after matching save", () => {
  assert.ok(!isTaskPackDraftSessionDirty(persisted()));
  const current = edited(); assert.ok(isTaskPackDraftSessionDirty(current));
  const next = applyTaskPackDraftOperationResult(current, captureTaskPackDraftOperation(current, "saving")!,
    view({ draftVersion: 5, content: serializeTaskPackDraftContent(current.draft) }))!;
  assert.ok(!isTaskPackDraftSessionDirty(next));
});
await scenario("late async Save cannot attach A metadata to active B", async () => {
  const operation = captureTaskPackDraftOperation(transient(), "saving")!;
  const response = deferred<TaskPackPersistedDraftView>();
  const api = apiReturning(view()).api; api.createTaskPackDraft = () => response.promise;
  const pending = executeTaskPackDraftOperation(operation, api);
  const active = transient("local-B"); const snapshot = structuredClone(active);
  response.resolve(view());
  assert.equal(applyTaskPackDraftOperationResult(active, operation, await pending), active);
  assert.deepEqual(active, snapshot);
});
await scenario("late Save after leaving Builder cannot resurrect an active session", () => {
  assert.equal(applyTaskPackDraftOperationResult(null, captureTaskPackDraftOperation(transient(), "saving")!, view()), null);
});
await scenario("conflict retains exact local content, baseline and expected token; no retry", async () => {
  const current = edited(); const before = structuredClone(current);
  const operation = captureTaskPackDraftOperation(current, "saving")!;
  let calls = 0;
  const api = apiReturning(view()).api;
  api.updateTaskPackDraft = async () => { calls += 1; throw new Error("private storage failure"); };
  await assert.rejects(executeTaskPackDraftOperation(operation, api));
  const issue = taskPackDraftPersistenceIssue(operation, "TASK_PACK_DRAFT_CONFLICT", {
    draftId: "untrusted-id", expectedDraftVersion: 90, actualDraftVersion: 9, message: "private storage failure",
  });
  assert.deepEqual(issue, { sessionId: "local-A", code: "TASK_PACK_DRAFT_CONFLICT",
    conflict: { draftId: view().id, expectedDraftVersion: 4, actualDraftVersion: 9 } });
  assert.deepEqual(current, before); assert.equal(calls, 1);
});
await scenario("invalid conflict actual version is never treated as a token", () => {
  const operation = captureTaskPackDraftOperation(edited(), "saving")!;
  for (const value of ["5", 0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(taskPackDraftPersistenceIssue(operation, "TASK_PACK_DRAFT_CONFLICT", { actualDraftVersion: value }).conflict?.actualDraftVersion, undefined);
  }
});
await scenario("dismiss wiring only clears issue, not content/version", () => {
  const body = section(controller, "function dismissDraftPersistenceIssue", "async function loadProjects");
  assert.match(body, /draftSessionRef.current\?\.sessionId === sessionId/);
  assert.match(body, /setDraftPersistenceIssue\(null\)/);
  assert.doesNotMatch(body, /setTaskPackDraft|commitDraftSession|actualDraftVersion/);
}, true);
await scenario("confirmed reload replaces text and baseline with server detail, retaining local ID", async () => {
  const current = edited(); const operation = captureTaskPackDraftOperation(current, "reloading")!;
  const server = view({ draftVersion: 9, content: { ...view().content, rawTask: "server text" } });
  const { api, calls } = apiReturning(server);
  const next = applyTaskPackDraftOperationResult(current, operation, await executeTaskPackDraftOperation(operation, api))!;
  assert.deepEqual(calls, [{ method: "GET", args: [server.id] }]);
  assert.equal(next.sessionId, current.sessionId); assert.equal(next.draft.rawTask, "server text");
  assert.equal(next.persistence?.draftVersion, 9); assert.ok(!isTaskPackDraftSessionDirty(next));
});
await scenario("cancelled/stale confirmation cannot call persistence; shared Modal used", () => {
  assert.match(builder, /persistenceConfirmation\?\.sessionId === session.sessionId && \(\s*<ConfirmDialog/);
  assert.match(builder, /onClose=\{\(\) => setPersistenceConfirmation\(null\)\}/);
  assert.match(builder, /cancelLabel=\{t\("taskPackDraftPersistence.cancel"\)\}/);
  assert.match(confirmDialog, /variant="secondary" onClick=\{onClose\}>\s*\{cancelLabel\}/);
  assert.match(confirmDialog, /<Modal[\s\S]*onClose=\{onClose\}/);
  assert.match(builder, /if \(confirmation.sessionId === session.sessionId\)/);
}, true);
await scenario("late reload cannot replace another active session", async () => {
  const operation = captureTaskPackDraftOperation(edited(), "reloading")!;
  const response = deferred<TaskPackPersistedDraftView>();
  const api = apiReturning(view()).api; api.getTaskPackDraft = () => response.promise;
  const pending = executeTaskPackDraftOperation(operation, api);
  const active = transient("local-B"); response.resolve(view());
  assert.equal(applyTaskPackDraftOperationResult(active, operation, await pending), active);
});
await scenario("discard sends captured token once and clears matching active session", async () => {
  const current = persisted(); const operation = captureTaskPackDraftOperation(current, "discarding")!;
  const server = view({ draftVersion: 5, lifecycle: { state: "discarded", materializedRevisionId: null } });
  const { api, calls } = apiReturning(server);
  assert.equal(applyTaskPackDraftOperationResult(current, operation, await executeTaskPackDraftOperation(operation, api)), null);
  assert.deepEqual(calls, [{ method: "DISCARD", args: [server.id, 4] }]);
});
await scenario("discard conflict preserves the active draft unchanged", async () => {
  const current = edited(); const before = structuredClone(current);
  const operation = captureTaskPackDraftOperation(current, "discarding")!;
  const api = apiReturning(view()).api; let calls = 0;
  api.discardTaskPackDraft = async () => { calls += 1; throw new Error("conflict"); };
  await assert.rejects(executeTaskPackDraftOperation(operation, api));
  assert.deepEqual(current, before); assert.equal(calls, 1);
  assert.equal(taskPackDraftPersistenceIssue(operation, "TASK_PACK_DRAFT_CONFLICT", { actualDraftVersion: 9 }).conflict?.expectedDraftVersion, 4);
});
await scenario("late discard cannot clear session B", () => {
  const b = transient("local-B");
  assert.equal(applyTaskPackDraftOperationResult(b, captureTaskPackDraftOperation(persisted(), "discarding")!,
    view({ lifecycle: { state: "discarded", materializedRevisionId: null } })), b);
});
await scenario("transient discard/reload and terminal mutations are ineligible", () => {
  assert.equal(captureTaskPackDraftOperation(transient(), "discarding"), null);
  assert.equal(captureTaskPackDraftOperation(transient(), "reloading"), null);
  for (const lifecycle of [{ state: "discarded", materializedRevisionId: null }, { state: "materialized", materializedRevisionId: 7 }] as const) {
    const terminal = createTaskPackDraftSessionFromPersisted("local-A", view({ lifecycle }));
    assert.equal(captureTaskPackDraftOperation(terminal, "saving"), null);
    assert.equal(captureTaskPackDraftOperation(terminal, "discarding"), null);
    assert.ok(captureTaskPackDraftOperation(terminal, "reloading"));
  }
});
await scenario("history carries identity/version/baseline together with editable content", () => {
  const current = persisted(); const entry = history(current).entries[1];
  assert.ok("session" in entry); assert.equal(entry.session, current);
  assert.deepEqual(entry.session.persistence?.lastSavedContent, view().content);
});
await scenario("save updates ALL matching history entries, including pre-save Back/Forward entries", () => {
  const current = transient(); const previous = history(current);
  const next = applyDraftOperationToHistory(previous, captureTaskPackDraftOperation(current, "saving")!, view());
  for (const entry of next.entries) {
    if ("session" in entry && entry.session.sessionId === "local-A") {
      assert.equal(entry.session.persistence?.draftVersion, 4);
      assert.equal(entry.session.persistence?.id, view().id);
    }
  }
  assert.equal(next.entries[0], previous.entries[0]); assert.equal(next.entries[4], previous.entries[4]);
  assert.equal(next.index, previous.index);
});
await scenario("editing synchronizes all history text while preserving last saved baseline", () => {
  const current = edited(); const next = synchronizeDraftSessionHistory(history(persisted()), current);
  for (const entry of next.entries) if ("session" in entry && entry.session.sessionId === "local-A") {
    assert.equal(entry.session, current); assert.equal(entry.session.persistence?.draftVersion, 4);
  }
  assert.equal(next.entries[2].surface, "task-pack-builder", "old context preview must be invalidated by text edit");
});
await scenario("saving unchanged context preserves Composer preview and authoring analysis", () => {
  const current = transient(); const previous = history(current);
  const next = applyDraftOperationToHistory(previous, captureTaskPackDraftOperation(current, "saving")!, view());
  const before = previous.entries[2]; const after = next.entries[2];
  assert.ok(before.surface === "context-composer" && after.surface === "context-composer");
  assert.equal(after.preview, before.preview);
  assert.deepEqual(after.session.draft.clarifications, current.draft.clarifications);
});
await scenario("late Save seals inactive A history while active B remains untouched", () => {
  const current = transient(); const previous = history(current); previous.index = 4;
  const next = applyDraftOperationToHistory(previous, captureTaskPackDraftOperation(current, "saving")!, view());
  assert.equal(next.entries[next.index], previous.entries[previous.index]);
  const a = next.entries[1]; assert.ok("session" in a); assert.equal(a.session.persistence?.draftVersion, 4);
});
await scenario("discard invalidates every matching Builder/Composer entry without unrelated loss", () => {
  const previous = history(persisted());
  const next = invalidateDraftSessionHistory(previous, "local-A", 3);
  assert.deepEqual(next.entries[next.index], { page: "projects", surface: "project-details", projectId: 3 });
  assert.equal(next.entries.length, 4);
  assert.ok(next.entries.includes(previous.entries[0]));
  assert.ok(next.entries.includes(previous.entries[3])); assert.ok(next.entries.includes(previous.entries[4]));
  assert.ok(next.entries.every((entry) => !("session" in entry) || entry.session.sessionId !== "local-A"));
});
await scenario("Back/Forward cannot resurrect discarded session for ANY active history index", () => {
  const previous = history(persisted());
  for (let index = 0; index < previous.entries.length; index += 1) {
    const next = invalidateDraftSessionHistory({ ...previous, index }, "local-A", 3);
    assert.ok(next.index >= 0 && next.index < next.entries.length);
    const active = previous.entries[index];
    if (!("session" in active) || active.session.sessionId !== "local-A") {
      assert.equal(next.entries[next.index], active);
    }
    for (const destination of next.entries) assert.ok(!("session" in destination) || destination.session.sessionId !== "local-A");
  }
});
await scenario("offscreen discard removes A snapshots while B stays active", () => {
  const previous = history(persisted()); previous.index = 4;
  const next = applyDraftOperationToHistory(previous, captureTaskPackDraftOperation(persisted(), "discarding")!,
    view({ lifecycle: { state: "discarded", materializedRevisionId: null } }));
  assert.equal(next.entries[next.index], previous.entries[4]);
  assert.equal(next.entries.length, 3);
});
await scenario("explicit reload replaces all session history and drops obsolete context preview", () => {
  const next = applyDraftOperationToHistory(history(edited()), captureTaskPackDraftOperation(edited(), "reloading")!, view({ draftVersion: 9 }));
  for (const entry of next.entries) if ("session" in entry && entry.session.sessionId === "local-A") {
    assert.equal(entry.surface, "task-pack-builder"); assert.equal(entry.session.persistence?.draftVersion, 9);
    assert.ok(!isTaskPackDraftSessionDirty(entry.session));
  }
});
await scenario("same-project sessions have different component keys, stable through Save", () => {
  assert.notEqual(taskPackDraftSessionKey(transient()), taskPackDraftSessionKey(transient("local-B")));
  assert.equal(taskPackDraftSessionKey(transient()), taskPackDraftSessionKey(persisted()));
  assert.match(dashboard, /return taskPackDraftSessionKey\(dashboard.taskPackDraftSession\)/);
});
await scenario("all creation paths including Open in Builder use transient factory without bindings", () => {
  for (const [start, end] of [
    ["async function handleCreateTaskPackDraft(", "async function handleCreateTaskPackDraftFromChanges("],
    ["async function handleCreateTaskPackDraftFromChanges(", "async function createTaskContextPreview("],
    ["function handleOpenTaskPackInBuilder(", "function handleToggleProject("],
  ]) {
    const body = section(controller, start, end);
    assert.match(body, /startTransientDraft\(nextDraft\)/);
    assert.doesNotMatch(body, /taskPackId:|baseRevisionId:|createTaskPackDraft\(/);
  }
  assert.match(controller, /createTransientTaskPackDraftSession\(crypto.randomUUID\(\), draft\)/);
}, true);
await scenario("ordinary generation allows transient sessions only", () => {
  assert.ok(canOrdinaryGenerateTaskPackDraft(transient()));
  assert.ok(!canOrdinaryGenerateTaskPackDraft(persisted()));
  assert.ok(!canOrdinaryGenerateTaskPackDraft(null));
});
await scenario("controller guards persisted and stale sessions BEFORE ordinary create API", () => {
  const body = section(controller, "async function generateTaskPackFromDraft(", "async function handleCreateTaskPackDraft(");
  assert.ok(body.indexOf("canOrdinaryGenerateTaskPackDraft(generationSession)") < body.indexOf("await createTaskPack({"));
  assert.ok(body.indexOf("generationSession?.sessionId !== expectedSessionId") < body.indexOf("await createTaskPack({"));
  assert.match(body, /!canOrdinaryGenerateTaskPackDraft\(draftSessionRef.current\)/);
  assert.match(body, /selectedFilePaths,/); // Existing transient manual-basket path remains.
  assert.doesNotMatch(controller, /materializeTaskPackDraft|listActiveTaskPackDrafts/);
}, true);
await scenario("persisted Composer and Builder generation are disabled with controller backstop", () => {
  assert.match(builder, /const canGenerate = canAnalyze && !persisted/);
  assert.match(dashboard, /generationDisabled=\{!canOrdinaryGenerateTaskPackDraft\(dashboard.taskPackDraftSession\)/);
  assert.match(composer, /const canGenerate =\s*!generationDisabled/);
  assert.match(composer, /if \(canGenerate\) onGenerate\(selectedPaths\)/);
  assert.match(controller, /return generateTaskPackFromDraft\(selectedFilePaths\)/);
}, true);
await scenario("one-character nonblank text eligible; blank shells cannot save", () => {
  for (const rawTask of ["x", "ab"]) assert.ok(captureTaskPackDraftOperation(editTaskPackDraftSession(transient(), { ...draft(), rawTask }), "saving"));
  for (const rawTask of ["", " \r\n\t"]) assert.equal(captureTaskPackDraftOperation(editTaskPackDraftSession(transient(), { ...draft(), rawTask }), "saving"), null);
});
await scenario("persisted empty selections remain empty and defaults effect is gated", () => {
  const current = transient(); const operation = captureTaskPackDraftOperation(current, "saving")!;
  const saved = applyTaskPackDraftOperationResult(current, operation, view())!;
  assert.equal(saved.draft.templateId, ""); assert.equal(saved.draft.ruleProfileId, "");
  const body = section(builder, "if (session.persistence !== null) return;", "}, [templates, ruleProfiles, session.persistence]);");
  assert.ok(body.indexOf("session.persistence !== null") < body.indexOf("onChange({"));
});
await scenario("RU/EN persistence key sets match; labels contain no slice IDs or storage internals", () => {
  const en = i18n.getResourceBundle("en", "translation").taskPackDraftPersistence;
  const ru = i18n.getResourceBundle("ru", "translation").taskPackDraftPersistence;
  assert.ok(en && ru); assert.deepEqual(Object.keys(en).sort(), Object.keys(ru).sort());
  for (const copy of [...Object.values(en), ...Object.values(ru)]) {
    assert.equal(typeof copy, "string"); assert.ok(String(copy).trim());
    assert.doesNotMatch(String(copy), /04F|draftVersion|SQL|TaskPackDraft/);
  }
});
await scenario("not-found, terminal and unexpected errors never overwrite or disclose private text", () => {
  const current = edited(); const before = structuredClone(current);
  for (const code of [undefined, "TASK_PACK_DRAFT_NOT_FOUND", "TASK_PACK_DRAFT_NOT_EDITABLE", "TASK_PACK_DRAFT_VERSION_EXHAUSTED", "TASK_PACK_DRAFT_STATE_INVALID"]) {
    const issue = taskPackDraftPersistenceIssue(captureTaskPackDraftOperation(current, "saving")!, code, { message: "SQL private raw task", stack: "private" });
    assert.doesNotMatch(JSON.stringify(issue), /SQL|private/); assert.deepEqual(current, before);
  }
});
await scenario("response identity/project mismatch and invalid discard result fail closed", async () => {
  const operation = captureTaskPackDraftOperation(persisted(), "saving")!;
  for (const result of [view({ id: "foreign" }), view({ projectId: 10 })]) {
    await assert.rejects(executeTaskPackDraftOperation(operation, apiReturning(result).api));
  }
  await assert.rejects(executeTaskPackDraftOperation(captureTaskPackDraftOperation(persisted(), "discarding")!, apiReturning(view()).api));
});
await scenario("pending operation ref prevents duplicate writes and stale errors do not affect active B", () => {
  const body = section(controller, "async function handleDraftPersistence(", "function dismissDraftPersistenceIssue(");
  assert.match(body, /current.sessionId !== expectedSessionId \|\| draftOperationRef.current \|\| isLoading/);
  assert.ok(body.indexOf("draftOperationRef.current = operation") < body.indexOf("await executeTaskPackDraftOperation"));
  assert.match(body, /if \(draftSessionRef.current\?\.sessionId !== operation.sessionId\) return false/);
  assert.match(body, /if \(draftOperationRef.current === operation\)/);
}, true);
await scenario("Save completion does not clear preview, understanding or clarifications", () => {
  const body = section(controller, 'if (kind === "saving") {', "} else {");
  assert.match(body, /commitDraftSession\(next\)/);
  assert.doesNotMatch(body, /setTaskPackContextPreview|setContextComposerPreview|setGeneratedTaskPack|clearUnderstanding|clarifications/);
  assert.match(builder, /if \(applied && confirmation.kind === "reloading"\) clearUnderstandingState\(\)/);
}, true);
await scenario("one authoritative React session; history wiring carries whole sessions", () => {
  assert.match(controller, /useState<TaskPackDraftSession \| null>\(\s*null,?\s*\)/);
  assert.match(controller, /const taskPackDraft = taskPackDraftSession\?\.draft \?\? null/);
  assert.doesNotMatch(controller, /setTaskPackDraftState|useState<TaskPackDraft \| null>/);
  assert.match(dashboard, /onSessionChange: navigation.synchronizeTaskPackDraftSession/);
  assert.match(dashboard, /navigation.applyTaskPackDraftPersistenceResult\(operation, view\)/);
  assert.match(dashboard, /setTaskPackDraftSession\(location.session\)/);
}, true);
await scenario("Back/navigation has no persistence side effects and no autosave is wired", () => {
  const body = section(dashboard, "const handleNavigate =", "const toggleFocusMode =");
  assert.doesNotMatch(body, /handleDraftPersistence|discardTaskPackDraft|createTaskPackDraft\(/);
  const edits = section(controller, "function setTaskPackDraft(", "function startTransientDraft(");
  assert.doesNotMatch(edits, /executeTaskPackDraftOperation|createTaskPackDraft\(|updateTaskPackDraft\(/);
}, true);
await scenario("visible controls have localized status, persistent alert and explicit confirmation", () => {
  assert.match(builder, /role="status" aria-live="polite"/); assert.match(builder, /role="alert"/);
  assert.match(builder, /disabled=\{!canSave\}/); assert.match(builder, /persisted && editable && \(\s*<DropdownMenu/);
  assert.match(builder, /onPersistenceAction\("saving", session.sessionId\)/);
  assert.match(builder, /onDismissPersistenceIssue\(session.sessionId\)/);
  assert.doesNotMatch(builder, /currentIssue\.message|currentIssue\.conflict\?\.actualDraftVersion/);
}, true);
await scenario("snapshot IDs affect dirty state but project display name does not", () => {
  assert.ok(isTaskPackDraftSessionDirty(editTaskPackDraftSession(persisted(), { ...draft(), understandingSnapshotId: "new" })));
  assert.ok(!isTaskPackDraftSessionDirty(editTaskPackDraftSession(persisted(), { ...draft(), projectName: "Renamed" })));
});
await scenario("terminal detail reload is visible but cannot become editable or ordinary-generate", () => {
  const current = edited();
  const next = applyTaskPackDraftOperationResult(current, captureTaskPackDraftOperation(current, "reloading")!,
    view({ lifecycle: { state: "discarded", materializedRevisionId: null } }))!;
  assert.equal(next.persistence?.lifecycle.state, "discarded");
  assert.equal(captureTaskPackDraftOperation(next, "saving"), null);
  assert.ok(!canOrdinaryGenerateTaskPackDraft(next));
});
await scenario("discard/reload clear only their own Composer diff cache; Save leaves it intact", () => {
  const body = section(dashboard, "onPersistenceResult: (operation, view) =>", "const workspaceZoom =");
  assert.match(body, /operation.kind !== "saving" && contextDiffSessionOwner.current === operation.sessionId/);
  assert.match(body, /setContextDiffSession\(null\)/);
  assert.match(dashboard, /advanceContextDiffSession\(sameSession \? current : null, preview\)/);
}, true);

await scenario("default dropdown retains 220px width, right alignment and existing below-trigger gap", () => {
  assert.deepEqual(getDropdownMenuPosition({ top: 100, bottom: 132, right: 900 }, 1, { width: 1200, height: 800 }),
    { width: 220, left: 680, top: 140, openUp: false });
});
await scenario("wide dropdown is opt-in, compact, and aligned to the same trigger", () => {
  const rect = { top: 100, bottom: 132, right: 900 };
  const normal = getDropdownMenuPosition(rect, 1, { width: 1200, height: 800 });
  const wide = getDropdownMenuPosition(rect, 1, { width: 1200, height: 800 }, "wide");
  assert.equal(wide.width, 320); assert.ok(wide.width > normal.width);
  assert.equal(wide.left + wide.width, rect.right); assert.equal(wide.top, normal.top);
});
await scenario("wide dropdown clamps to both viewport edges and shrinks in zoomed layouts", () => {
  for (const viewportWidth of [240, 320, 500, 1200]) {
    for (const right of [32, 200, viewportWidth, viewportWidth + 100]) {
      const position = getDropdownMenuPosition({ top: 100, bottom: 132, right }, 1, { width: viewportWidth, height: 800 }, "wide");
      assert.ok(position.left >= 12);
      assert.ok(position.left + position.width <= viewportWidth - 12);
      assert.equal(position.width, Math.min(320, viewportWidth - 24));
    }
  }
});
await scenario("wrapped wide menu uses measured height to open upward without clipping the action", () => {
  const position = getDropdownMenuPosition({ top: 700, bottom: 732, right: 900 }, 1, { width: 1200, height: 800 }, "wide", 88);
  assert.equal(position.openUp, true); assert.equal(position.top, 604);
  assert.equal(position.top + 88 + 8, 700);
});
await scenario("persisted discard uses shared wide dropdown, Trash icon and explicit danger tone", () => {
  const action = section(builder, '<DropdownMenu size="wide"', "]} />");
  assert.match(action, /taskPackDraftPersistence.discard/);
  assert.match(action, /icon: <Trash2/); assert.match(action, /tone: "danger"/);
  assert.match(dropdown, /size = "default"/);
  assert.match(dropdown, /size === "wide" \? "min-w-0 whitespace-normal break-words leading-5" : "truncate"/);
  assert.match(dropdown, /width: position.width/);
  assert.match(dropdown, /menuRef.current\?\.offsetHeight/);
  assert.match(dropdown, /focus-visible:ring-red-300\/30/);
}, true);
await scenario("confirmation body has intentional padding, readable spacing and quiet risk icon", () => {
  assert.match(confirmDialog, /<Modal/); assert.match(confirmDialog, /maxWidth="max-w-lg"/);
  assert.match(confirmDialog, /items-start gap-4 px-6 py-6/);
  assert.match(confirmDialog, /text-sm leading-6 text-neutral-300/);
  assert.match(confirmDialog, /danger \? Trash2 : RotateCcw/);
  assert.match(confirmDialog, /border-red-400\/15/);
  assert.doesNotMatch(confirmDialog, /createPortal|role="dialog"|fixed inset|addEventListener/);
}, true);
await scenario("discard confirmation uses danger button while reload keeps primary and amber intent", () => {
  assert.match(builder, /intent=\{persistenceConfirmation.kind === "discarding" \? "danger" : "warning"\}/);
  assert.match(confirmDialog, /variant=\{danger \? "secondary" : "primary"\}/);
  assert.match(confirmDialog, /hover:!bg-red-500\/15/);
  assert.match(confirmDialog, /focus-visible:ring-red-300\/40/);
  assert.match(confirmDialog, /border-amber-400\/15/);
  assert.match(confirmDialog, /disabled=\{confirmDisabled\}/);
  assert.match(confirmDialog, /onClick=\{onConfirm\}/);
}, true);
await scenario("shared menu portal and dismiss handling remain and Builder trigger is vertically aligned", () => {
  assert.match(dropdown, /createPortal\(/); assert.match(dropdown, /document.body/);
  assert.match(dropdown, /onClick=\{closeMenu\}/); assert.match(dropdown, /event.key === "Escape"/);
  assert.match(dropdown, /removeEventListener\("resize", handleWindowChange\)/);
  assert.match(dropdown, /removeEventListener\("scroll", handleWindowChange, true\)/);
  assert.match(builder, /flex shrink-0 flex-wrap items-center gap-2/);
}, true);

await scenario("confirmation starts on Cancel and menu restores focus to its surviving trigger before opening it", () => {
  assert.match(confirmDialog, /ref=\{actionsRef\}/);
  assert.match(confirmDialog, /querySelector<HTMLButtonElement>\("button"\)\?\.focus\(\)/);
  assert.ok(confirmDialog.indexOf("{cancelLabel}") < confirmDialog.indexOf("{confirmLabel}"));
  assert.ok(dropdown.indexOf("buttonRef.current?.focus()") < dropdown.indexOf("action.onClick()"));
}, true);

process.stdout.write(`Task Pack draft workflow smoke passed: ${scenarios} scenarios (${scenarios - wiringScenarios} executable behavior, ${wiringScenarios} React wiring).\n`);
