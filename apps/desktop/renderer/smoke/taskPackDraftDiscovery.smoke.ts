import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { TaskPackPersistedDraftView as View } from "../src/types";
import {
  createTaskPackDraftDiscovery, getProjectActiveDraftCount, needsDraftReplacementConfirmation,
  reconcileActiveDraftSummary, restorableDraftIssue, toActiveDraftSummary,
  type DraftDiscoveryApi, type DraftDiscoveryContext,
} from "../src/utils/taskPackDraftDiscovery";
import {
  createRestoredTaskPackDraftSession, createTaskPackDraftSessionFromPersisted,
  createTransientTaskPackDraftSession, isTaskPackDraftSessionDirty, canOrdinaryGenerateTaskPackDraft,
  serializeTaskPackDraftContent,
} from "../src/utils/taskPackDraftSession";
import i18n from "../src/i18n";

let count = 0;
let wiring = 0;
async function scenario(name: string, run: () => unknown | Promise<unknown>, sourceOnly = false) {
  await run(); count++; if (sourceOnly) wiring++; console.log(`PASS ${name}`);
}
function view(id = "draft-A", projectId = 1, overrides: Partial<View> = {}): View {
  return {
    id, projectId, projectName: `Project ${projectId}`, taskPackId: null, baseRevisionId: null,
    lifecycle: { state: "active", materializedRevisionId: null }, draftVersion: 4,
    createdAt: "2026-09-20T10:00:00.000Z", updatedAt: "2026-09-25T10:00:00.000Z", expiresAt: null,
    content: {
      rawTask: "  task\r\nexact text  ", taskType: "general", targetTool: "codex",
      templateId: "", ruleProfileId: null, enabledRuleIds: ["b", "a", "b"], customRulesText: "  rule\r\n ",
      acceptanceCriteriaPresetId: null, acceptanceCriteriaText: "", clarifications: [{ question: " why? ", answer: "" }],
      performanceSessionId: "old-performance", understandingSnapshotId: "old-understanding",
      reviewedUnderstandingSnapshotId: "old-understanding",
    }, ...overrides,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup(views = [view(), view("draft-B", 2)]) {
  const db = new Map(views.map(item => [item.id, structuredClone(item)]));
  const calls: Array<{ method: string; id?: string; projectId?: number; version?: number }> = [];
  const restored: View[] = [];
  const context: DraftDiscoveryContext = {
    projectIds: [1, 2], session: null, busy: false, canOffer: true,
    restore: item => { restored.push(item); return true; },
  };
  const api: DraftDiscoveryApi = {
    listActiveTaskPackDrafts: async projectId => {
      calls.push({ method: "list", projectId });
      return [...db.values()].filter(item => item.lifecycle.state === "active" &&
        (projectId === undefined || item.projectId === projectId)).map(toActiveDraftSummary);
    },
    getTaskPackDraft: async id => {
      calls.push({ method: "get", id });
      const item = db.get(id);
      if (!item) throw { code: "TASK_PACK_DRAFT_NOT_FOUND" };
      return structuredClone(item);
    },
    discardTaskPackDraft: async (id, version) => {
      calls.push({ method: "discard", id, version });
      const item = db.get(id)!;
      if (version !== item.draftVersion) throw { code: "TASK_PACK_DRAFT_CONFLICT", actualDraftVersion: item.draftVersion };
      const result = { ...item, draftVersion: version + 1, lifecycle: { state: "discarded", materializedRevisionId: null } } as const;
      db.set(id, result); return result;
    },
  };
  const owner = createTaskPackDraftDiscovery(api, () => context);
  return { owner, db, api, calls, restored, context, state: owner.getSnapshot };
}
const local = (rawTask: string) => createTransientTaskPackDraftSession("local-editor", {
  projectId: 1, projectName: "Project 1", rawTask, taskType: "general", targetTool: "codex",
});

await scenario("global startup requests only summaries and never bulk-fetches multiple details", async () => {
  const f = setup(); await f.owner.startup();
  assert.deepEqual(f.calls, [{ method: "list", projectId: undefined }]);
  assert.equal(f.state().open, true); assert.equal(f.restored.length, 0);
});
await scenario("project discovery forwards projectId and preserves server order", async () => {
  const f = setup([view("z"), view("a"), view("other", 2)]); await f.owner.open(1);
  assert.deepEqual(f.calls, [{ method: "list", projectId: 1 }]);
  assert.deepEqual(f.state().summaries.map(item => item.id), ["z", "a"]);
});
await scenario("summary projection never retains author content even from a full view", () => {
  assert.deepEqual(Object.keys(toActiveDraftSummary(view())).sort(), ["id", "projectId", "projectName", "taskPackId", "baseRevisionId", "lifecycle", "draftVersion", "createdAt", "updatedAt", "expiresAt"].sort());
});
await scenario("zero startup drafts does not offer a modal or repeat discovery", async () => {
  const f = setup([]); await f.owner.startup(); await f.owner.startup();
  assert.equal(f.state().open, false); assert.equal(f.calls.length, 1);
});
await scenario("one startup draft preselects one preview but requires explicit Continue", async () => {
  const f = setup([view()]); await f.owner.startup();
  assert.equal(f.state().detail?.id, "draft-A"); assert.equal(f.restored.length, 0);
  assert.equal(f.calls.filter(item => item.method === "get").length, 1);
});
await scenario("startup dismiss consumes offer without discarding and manual scope can reopen", async () => {
  const f = setup(); await f.owner.startup(); f.owner.close(); await f.owner.startup();
  assert.equal(f.state().open, false); assert.equal(f.calls.length, 1);
  await f.owner.open(2); assert.equal(f.state().open, true); assert.equal(f.state().scope, 2);
  assert.equal(f.calls.filter(item => item.method === "discard").length, 0);
});
await scenario("active authoring begun during discovery suppresses automatic offer but keeps cache", async () => {
  const f = setup(); const wait = deferred<View[]>(); f.api.listActiveTaskPackDrafts = () => wait.promise;
  const pending = f.owner.startup(); f.context.canOffer = false; f.context.session = local("writing");
  wait.resolve([view()]); await pending;
  assert.equal(f.state().open, false); assert.equal(f.state().summaries.length, 1); assert.equal(f.restored.length, 0);
});
await scenario("late global list cannot replace newer project chooser scope", async () => {
  const f = setup(); const wait = deferred<View[]>(); const original = f.api.listActiveTaskPackDrafts;
  f.api.listActiveTaskPackDrafts = projectId => projectId === undefined ? wait.promise : original(projectId);
  const pending = f.owner.startup(); await f.owner.open(2); wait.resolve([view()]); await pending;
  assert.equal(f.state().scope, 2); assert.equal(f.state().detail?.id, "draft-B");
  assert.deepEqual(f.state().summaries.map(item => item.id), ["draft-B"]);
});
await scenario("stale detail A cannot become selected B preview", async () => {
  const f = setup(); await f.owner.open(); const wait = deferred<View>(); const get = f.api.getTaskPackDraft;
  f.api.getTaskPackDraft = id => id === "draft-A" ? wait.promise : get(id);
  const a = f.owner.select("draft-A"); await f.owner.select("draft-B"); wait.resolve(view()); await a;
  assert.equal(f.state().selectedId, "draft-B"); assert.equal(f.state().detail?.id, "draft-B");
});
await scenario("select fetches exactly its own ID", async () => {
  const f = setup(); await f.owner.open(); await f.owner.select("draft-B");
  assert.deepEqual(f.calls.filter(item => item.method === "get"), [{ method: "get", id: "draft-B" }]);
});
await scenario("Continue fetches fresh content/version without any write", async () => {
  const f = setup([view()]); await f.owner.open();
  f.db.set("draft-A", view("draft-A", 1, { draftVersion: 9, content: { ...view().content, rawTask: "new server text" } }));
  await f.owner.continueDraft();
  assert.equal(f.restored[0].draftVersion, 9); assert.equal(f.restored[0].content.rawTask, "new server text");
  assert.equal(f.calls.filter(item => item.method === "get").length, 2);
  assert.equal(f.calls.some(item => item.method === "discard"), false); assert.equal(f.state().open, false);
});
for (const state of ["discarded", "materialized"] as const) {
  await scenario(`fresh ${state} detail never restores and removes only its item`, async () => {
    const f = setup(); await f.owner.open(); await f.owner.select("draft-A");
    f.db.set("draft-A", view("draft-A", 1, { lifecycle: state === "discarded" ? { state, materializedRevisionId: null } : { state, materializedRevisionId: 5 } }));
    await f.owner.continueDraft(); assert.equal(f.restored.length, 0);
    assert.equal(f.state().issue, "notActive"); assert.deepEqual(f.state().summaries.map(item => item.id), ["draft-B"]);
  });
}
for (const binding of [{ taskPackId: 7 }, { baseRevisionId: 8 }]) {
  await scenario(`bound draft ${Object.keys(binding)[0]} fails closed`, async () => {
    const f = setup(); await f.owner.open(); f.db.set("draft-A", view("draft-A", 1, binding));
    await f.owner.select("draft-A"); await f.owner.continueDraft();
    assert.equal(f.state().issue, "bound"); assert.equal(f.restored.length, 0);
  });
}
for (const invalid of [{ id: "wrong" }, { projectId: 2 }, { draftVersion: 0 }, { draftVersion: 3 }]) {
  await scenario(`detail rejects incoherent ${Object.keys(invalid)[0]} ${Object.values(invalid)[0]}`, () => {
    assert.equal(restorableDraftIssue(view("draft-A", 1, invalid), view(), [1, 2]), "invalidState");
  });
}
await scenario("missing project fails closed without manufacturing a project", async () => {
  const f = setup([view()]); f.context.projectIds = [2]; await f.owner.open();
  assert.equal(f.state().issue, "projectMissing"); await f.owner.continueDraft(); assert.equal(f.restored.length, 0);
  assert.equal(f.calls.filter(item => item.method === "list").length, 2);
  assert.equal(f.calls.filter(item => item.method === "get").length, 1);
});
await scenario("Continue rejects a version older than the selected preview, not merely the list", async () => {
  const f = setup(); await f.owner.open(); f.db.set("draft-A", view("draft-A", 1, { draftVersion: 9 }));
  await f.owner.select("draft-A"); f.db.set("draft-A", view()); await f.owner.continueDraft();
  assert.equal(f.state().issue, "invalidState"); assert.equal(f.restored.length, 0);
});
await scenario("detail not-found removes only selected summary and keeps chooser stable", async () => {
  const f = setup(); await f.owner.open(); f.db.delete("draft-A"); await f.owner.select("draft-A");
  assert.equal(f.state().open, true); assert.equal(f.state().issue, "notFound");
  assert.deepEqual(f.state().summaries.map(item => item.id), ["draft-B"]);
});
await scenario("list network error preserves known counts and offers safe retry", async () => {
  const f = setup(); await f.owner.open(); f.api.listActiveTaskPackDrafts = async () => { throw new Error("SQL private text"); };
  await f.owner.refresh(); assert.equal(f.state().listIssue, "listFailed");
  assert.equal(f.state().summaries.length, 2); assert.equal(getProjectActiveDraftCount(f.state(), 1), 1);
  assert.ok(!JSON.stringify(f.state()).includes("SQL private"));
});
await scenario("startup error does not trap startup behind a modal or fabricate a known zero", async () => {
  const f = setup(); f.api.listActiveTaskPackDrafts = async () => { throw new Error("offline"); };
  await f.owner.startup(); assert.equal(f.state().open, false); assert.equal(f.state().notice, "listFailed");
  assert.equal(getProjectActiveDraftCount(f.state(), 1), undefined);
});
await scenario("detail network error preserves other list items without leaking messages", async () => {
  const f = setup(); await f.owner.open(); f.api.getTaskPackDraft = async () => { throw new Error("private secret"); };
  await f.owner.select("draft-A"); assert.equal(f.state().summaries.length, 2); assert.equal(f.state().issue, "detailFailed");
});
await scenario("closing while detail loads cannot reopen the chooser", async () => {
  const f = setup(); await f.owner.open(); const wait = deferred<View>(); f.api.getTaskPackDraft = () => wait.promise;
  const pending = f.owner.select("draft-A"); f.owner.close(); wait.resolve(view()); await pending;
  assert.equal(f.state().detail, null); assert.equal(f.state().open, false);
});
await scenario("Continue completion after close never replaces editor", async () => {
  const f = setup([view()]); await f.owner.open(); const wait = deferred<View>(); f.api.getTaskPackDraft = () => wait.promise;
  const pending = f.owner.continueDraft(); f.owner.close(); wait.resolve(view()); await pending;
  assert.equal(f.restored.length, 0);
});
await scenario("Continue completion cannot overwrite a newly active session", async () => {
  const f = setup([view()]); await f.owner.open(); const wait = deferred<View>(); f.api.getTaskPackDraft = () => wait.promise;
  const pending = f.owner.continueDraft(); f.context.session = local("new work"); wait.resolve(view()); await pending;
  assert.equal(f.restored.length, 0); assert.equal(f.state().issue, "localChanged");
});
await scenario("meaningful transient session requires explicit replacement confirmation", async () => {
  const f = setup([view()]); await f.owner.open(); f.context.session = local("work");
  await f.owner.continueDraft(); assert.equal(f.state().confirmation?.kind, "replace"); assert.equal(f.restored.length, 0);
  await f.owner.confirm(); assert.equal(f.restored.length, 1);
  assert.equal(f.calls.filter(item => item.method === "discard").length, 0);
});
await scenario("dirty persisted session requires replacement confirmation", () => {
  assert.equal(needsDraftReplacementConfirmation(createRestoredTaskPackDraftSession("local", view())), true);
});
await scenario("blank transient shell and clean persisted session do not need destructive warning", () => {
  assert.equal(needsDraftReplacementConfirmation(local("  ")), false);
  assert.equal(needsDraftReplacementConfirmation(createTaskPackDraftSessionFromPersisted("local", view())), false);
});
await scenario("cancel replacement leaves local work and server drafts untouched", async () => {
  const f = setup([view()]); await f.owner.open(); const session = local("work"); f.context.session = session;
  await f.owner.continueDraft(); f.owner.cancelConfirmation();
  assert.equal(f.context.session, session); assert.equal(f.restored.length, 0); assert.equal(f.db.size, 1);
});
await scenario("changed editor after confirmation prompt requires fresh consent", async () => {
  const f = setup([view()]); await f.owner.open(); f.context.session = local("work"); await f.owner.continueDraft();
  f.context.session = local("new work"); await f.owner.confirm(); assert.equal(f.state().issue, "localChanged");
  assert.equal(f.restored.length, 0);
});
await scenario("discard captures selected detail version before confirmation", async () => {
  const f = setup([view()]); await f.owner.open(); f.owner.requestDiscard();
  assert.equal(f.state().confirmation?.kind, "discard"); assert.equal(f.calls.some(item => item.method === "discard"), false);
  await f.owner.confirm(); assert.deepEqual(f.calls.find(item => item.method === "discard"), { method: "discard", id: "draft-A", version: 4 });
  assert.equal(f.state().summaries.length, 0); assert.equal(f.state().notice, "discarded");
});
await scenario("discard conflict never adopts actual token or automatically retries", async () => {
  const f = setup([view()]); await f.owner.open(); f.owner.requestDiscard(); f.db.set("draft-A", view("draft-A", 1, { draftVersion: 5 }));
  await f.owner.confirm(); assert.equal(f.state().issue, "conflict"); assert.equal(f.state().detail?.draftVersion, 4);
  assert.equal(f.calls.filter(item => item.method === "discard").length, 1); assert.equal(f.state().open, true);
});
await scenario("chooser cannot request discard for the exact active persisted draft", async () => {
  const f = setup([view()]); await f.owner.open(); f.context.session = createTaskPackDraftSessionFromPersisted("local", view());
  f.owner.requestDiscard(); assert.equal(f.state().confirmation, null); assert.equal(f.state().issue, "activeDraft");
  assert.equal(f.calls.some(item => item.method === "discard"), false);
});
await scenario("active-ID guard is rechecked after discard confirmation", async () => {
  const f = setup([view()]); await f.owner.open(); f.owner.requestDiscard();
  f.context.session = createTaskPackDraftSessionFromPersisted("local", view()); await f.owner.confirm();
  assert.equal(f.state().issue, "activeDraft"); assert.equal(f.calls.some(item => item.method === "discard"), false);
});
await scenario("successful discard selects next row with one preview and retains other project", async () => {
  const f = setup(); await f.owner.open(); await f.owner.select("draft-A"); f.owner.requestDiscard(); await f.owner.confirm();
  assert.equal(f.state().selectedId, "draft-B"); assert.equal(f.state().detail?.id, "draft-B");
  assert.equal(getProjectActiveDraftCount(f.state(), 1), 0);
});
await scenario("invalid discard response identity or lifecycle fails closed", async () => {
  const f = setup([view()]); await f.owner.open(); f.api.discardTaskPackDraft = async () => view("other");
  f.owner.requestDiscard(); await f.owner.confirm(); assert.equal(f.state().summaries.length, 1);
  assert.equal(f.state().issue, "detailFailed");
});
await scenario("duplicate Continue clicks produce one fresh request", async () => {
  const f = setup([view()]); await f.owner.open(); const wait = deferred<View>(); let reads = 0;
  f.api.getTaskPackDraft = () => { reads++; return wait.promise; };
  const pending = f.owner.continueDraft(); await f.owner.continueDraft(); wait.resolve(view()); await pending;
  assert.equal(reads, 1); assert.equal(f.restored.length, 1);
});
await scenario("duplicate confirmed Discard produces one write", async () => {
  const f = setup([view()]); await f.owner.open(); const wait = deferred<View>(); let writes = 0;
  f.api.discardTaskPackDraft = () => { writes++; return wait.promise; };
  f.owner.requestDiscard(); const pending = f.owner.confirm(); await f.owner.confirm();
  wait.resolve(view("draft-A", 1, { draftVersion: 5, lifecycle: { state: "discarded", materializedRevisionId: null } })); await pending;
  assert.equal(writes, 1);
});
await scenario("reconciliation updates count after Save and removes after Discard without reopening", async () => {
  const f = setup([]); await f.owner.startup(); f.owner.reconcile(view());
  assert.equal(getProjectActiveDraftCount(f.state(), 1), 1); assert.equal(f.state().open, false);
  f.owner.reconcile(view("draft-A", 1, { draftVersion: 5, lifecycle: { state: "discarded", materializedRevisionId: null } }));
  assert.equal(getProjectActiveDraftCount(f.state(), 1), 0); await f.owner.startup(); assert.equal(f.state().open, false);
});
await scenario("project refresh does not remove other cached projects", async () => {
  const f = setup(); await f.owner.startup(); f.owner.close(); await f.owner.open(1);
  assert.equal(getProjectActiveDraftCount(f.state(), 2), 1);
});
await scenario("older in-flight discovery cannot undo completed persistence response", async () => {
  const f = setup(); const wait = deferred<View[]>(); f.api.listActiveTaskPackDrafts = () => wait.promise;
  const pending = f.owner.startup(); f.owner.reconcile(view("draft-A", 1, { draftVersion: 7 })); wait.resolve([view()]); await pending;
  assert.equal(f.state().summaries[0].draftVersion, 7);
});
await scenario("local summary reconciliation rejects regressing versions and keeps content out", () => {
  const result = reconcileActiveDraftSummary([toActiveDraftSummary(view("draft-A", 1, { draftVersion: 7 }))], view());
  assert.equal(result[0].draftVersion, 7); assert.equal("content" in result[0], false);
});

const restored = createRestoredTaskPackDraftSession("new-renderer-id", view());
await scenario("restart restoration creates separate local identity and exact persistence metadata", () => {
  assert.equal(restored.sessionId, "new-renderer-id"); assert.equal(restored.persistence?.id, "draft-A");
  assert.equal(restored.persistence?.draftVersion, 4); assert.equal(restored.persistence?.updatedAt, view().updatedAt);
  assert.deepEqual(restored.persistence?.lifecycle, view().lifecycle); assert.equal(restored.persistence?.expiresAt, null);
  assert.throws(() => createRestoredTaskPackDraftSession("draft-A", view()));
});
for (const field of ["rawTask", "taskType", "targetTool", "templateId", "enabledRuleIds", "customRulesText", "acceptanceCriteriaText", "clarifications"] as const) {
  await scenario(`restart restores authored ${field} exactly including whitespace/order`, () => {
    assert.deepEqual(restored.draft[field], view().content[field]);
  });
}
for (const field of ["performanceSessionId", "understandingSnapshotId", "reviewedUnderstandingSnapshotId"] as const) {
  await scenario(`restart clears editable ${field} but keeps exact saved baseline`, () => {
    assert.equal(restored.draft[field], undefined); assert.equal(restored.persistence?.lastSavedContent[field], view().content[field]);
  });
}
await scenario("removed stale analysis IDs intentionally make restored session dirty", () => assert.equal(isTaskPackDraftSessionDirty(restored), true));
await scenario("null analysis IDs restore clean, with empty selections and unanswered clarifications intact", () => {
  const item = view(); const clean = { ...item, content: { ...item.content, templateId: null, ruleProfileId: null, enabledRuleIds: [],
    performanceSessionId: null, understandingSnapshotId: null, reviewedUnderstandingSnapshotId: null } };
  const session = createRestoredTaskPackDraftSession("new", clean);
  assert.equal(isTaskPackDraftSessionDirty(session), false); assert.equal(session.draft.templateId, undefined);
  assert.equal(session.draft.ruleProfileId, undefined); assert.deepEqual(session.draft.enabledRuleIds, []);
  assert.deepEqual(session.draft.clarifications, item.content.clarifications);
});
await scenario("generic persisted helper retains exact round-trip and input is never mutated", () => {
  const item = view(); const before = structuredClone(item);
  createRestoredTaskPackDraftSession("new", item); assert.deepEqual(item, before);
  assert.deepEqual(serializeTaskPackDraftContent(createTaskPackDraftSessionFromPersisted("generic", item).draft), item.content);
});
await scenario("restored persisted Generate remains blocked; transient ordinary Generate unchanged", () => {
  assert.equal(canOrdinaryGenerateTaskPackDraft(restored), false);
  assert.equal(canOrdinaryGenerateTaskPackDraft(local("task")), true);
});
await scenario("busy generation/persistence prevents Continue and Discard writes", async () => {
  const f = setup([view()]); await f.owner.open(); f.context.busy = true;
  await f.owner.continueDraft(); f.owner.requestDiscard(); await f.owner.confirm();
  assert.equal(f.restored.length, 0); assert.equal(f.calls.some(item => item.method === "discard"), false);
});
await scenario("RU/EN discovery copy stays synchronized without technical identifiers", () => {
  const en = i18n.getResource("en", "translation", "taskPackDraftDiscovery");
  const ru = i18n.getResource("ru", "translation", "taskPackDraftDiscovery");
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ru).sort());
  for (const value of [...Object.values(en), ...Object.values(ru)]) assert.doesNotMatch(String(value), /draftVersion|sessionId|SQL|TP-LC/u);
});

const source = (name: string) => readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");
const page = source("pages/DashboardPage.tsx");
const hook = source("hooks/useTaskPackDraftDiscovery.ts");
const modal = source("components/modals/TaskPackDraftChooserModal.tsx");
const controller = source("hooks/useDashboardController.ts");
await scenario("startup waits for splash/settings/onboarding and BOTH desktop launch checks", () => {
  assert.match(page, /startupReady: !isWelcomeVisible && minimumSplashDone && shellSettingsReady/);
  assert.match(page, /desktopLaunchReady.sync && desktopLaunchReady.navigation/);
  assert.match(page, /!shouldShowFirstRunOnboarding && !dashboard.isLoading/);
  assert.match(page, /!specialStartupNavigation.current/); assert.match(page, /!dashboard.taskPackDraftSession/);
  assert.match(hook, /document.querySelector\('\[role="dialog"\]\[aria-modal="true"\]'/);
}, true);
await scenario("shared Modal owns chooser; one confirmation shell at a time with padded body", () => {
  assert.match(modal, /if \(state.confirmation\) \{/); assert.match(modal, /return <ConfirmDialog/);
  assert.match(modal, /return <Modal/); assert.match(modal, /space-y-4 px-6 py-5/);
  assert.match(modal, /intent=\{discard \? "danger" : "warning"\}/);
  assert.doesNotMatch(modal, /createPortal|fixed inset|addEventListener/);
}, true);
await scenario("chooser uses plain text preview, wrapped long labels and accessible state", () => {
  assert.match(modal, /whitespace-pre-wrap break-words/); assert.match(modal, /state.detail.content.rawTask/);
  assert.doesNotMatch(modal, /dangerouslySetInnerHTML|ReactMarkdown|truncate|line-clamp/);
  assert.match(modal, /aria-pressed=/); assert.match(modal, /role="status"/); assert.match(modal, /role="alert"/);
  assert.match(modal, /Intl.DateTimeFormat\(i18n.language/); assert.match(modal, /activeSelected/);
}, true);
await scenario("project entry is secondary and count remains unknown before authoritative discovery", () => {
  const project = source("pages/ProjectDetailsPage.tsx");
  assert.match(project, /variant="secondary" disabled=\{isLoading\}\s*onClick=\{\(\) => onOpenSavedDrafts\(project.id\)\}/);
  assert.match(project, /savedDraftCount === undefined/);
  assert.match(page, /draftDiscovery.owner.open\(projectId\)/);
}, true);
await scenario("restore cleanup and complete-session navigation are explicit with no generation API", () => {
  const body = controller.slice(controller.indexOf("function restorePersistedTaskPackDraft"), controller.indexOf("async function handleDraftPersistence"));
  for (const setter of ["setDraftPersistenceIssue", "setTaskPackContextPreview", "setContextComposerPreview", "setGeneratedTaskPack"]) assert.match(body, new RegExp(`${setter}\\(null\\)`));
  assert.match(body, /createRestoredTaskPackDraftSession\(crypto.randomUUID\(\), view\)/);
  assert.match(body, /draftSessionRef.current !== taskPackDraftSession/);
  assert.match(body, /commitDraftSession\(session\)/); assert.doesNotMatch(body, /await|fetch|createTaskPack\(/);
  const restore = page.slice(page.indexOf("restore: (view) =>"), page.indexOf("discoveryOwnerRef.current = draftDiscovery.owner"));
  assert.match(restore, /contextDiffSessionOwner.current = null/); assert.match(restore, /setContextDiffSession\(null\)/);
  assert.match(restore, /openTaskPackBuilderLocation\(session\)/);
  assert.doesNotMatch(source("utils/taskPackDraftDiscovery.ts") + hook, /materializeTaskPackDraft|createTaskPack\(|updateTaskPackDraft\(/);
}, true);
await scenario("Save/Discard/Reload reconcile discovery without changing automatic offer", () => {
  assert.match(page, /onPersistenceResult:[\s\S]*?discoveryOwnerRef.current\?\.reconcile\(view\)/);
  assert.match(hook, /useSyncExternalStore\(owner.subscribe, owner.getSnapshot\)/);
}, true);
await scenario("Builder defaults and persisted Composer generation gate remain unchanged", () => {
  assert.match(source("pages/TaskPackBuilderPage.tsx"), /if \(session.persistence !== null\) return/);
  assert.match(page, /generationDisabled=\{!canOrdinaryGenerateTaskPackDraft\(dashboard.taskPackDraftSession\)/);
  assert.match(page, /return taskPackDraftSessionKey\(dashboard.taskPackDraftSession\)/);
}, true);
console.log(`Task Pack draft discovery smoke passed: ${count} scenarios (${count - wiring} executable behavior, ${wiring} React wiring).`);
