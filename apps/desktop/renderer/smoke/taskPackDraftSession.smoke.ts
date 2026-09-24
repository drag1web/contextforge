import assert from "node:assert/strict";

import type {
  TaskPackDraft,
  TaskPackDraftLifecycle,
  TaskPackPersistedDraftContent,
  TaskPackPersistedDraftView,
} from "../src/types";
import {
  canPersistTaskPackDraft,
  createTaskPackDraftSessionFromPersisted,
  createTransientTaskPackDraftSession,
  deserializeTaskPackDraftContent,
  isPersistedTaskPackDraftSession,
  isTaskPackDraftSessionDirty,
  serializeTaskPackDraftContent,
  updateTaskPackDraftSavedBaseline,
} from "../src/utils/taskPackDraftSession";

let scenarios = 0;
function scenario(name: string, run: () => void) {
  run();
  scenarios += 1;
  process.stdout.write(`PASS ${name}\n`);
}

function editable(): TaskPackDraft {
  return {
    projectId: 3,
    projectName: "Local project",
    rawTask: "  Author task\r\nsecond line\rthird line  ",
    taskType: " general ",
    targetTool: " codex ",
    templateId: "",
    ruleProfileId: "   ",
    enabledRuleIds: ["second", "first", "second"],
    customRulesText: "  rule\r\nrule\n  ",
    acceptanceCriteriaText: "",
    clarifications: [
      { question: "  question?\r\n", answer: "" },
      { question: "other?", answer: "  answer\r\n  " },
    ],
    performanceSessionId: "performance-session",
    understandingSnapshotId: "snapshot",
    reviewedUnderstandingSnapshotId: "snapshot",
  };
}

function view(): TaskPackPersistedDraftView {
  return {
    id: "opaque/server draft",
    projectId: 3,
    projectName: "Local project",
    taskPackId: null,
    baseRevisionId: null,
    lifecycle: { state: "active", materializedRevisionId: null },
    draftVersion: 7,
    createdAt: "2026-09-23T10:00:00.000Z",
    updatedAt: "2026-09-23T11:00:00.000Z",
    expiresAt: null,
    content: serializeTaskPackDraftContent(editable()),
  };
}

scenario("serializer preserves exact authored strings without generation normalization", () => {
  const source = editable();
  const content = serializeTaskPackDraftContent(source);
  for (const key of ["rawTask", "taskType", "targetTool", "customRulesText"] as const) {
    assert.equal(content[key], source[key]);
  }
});

scenario("all undefined nullable fields become null and missing arrays become concrete", () => {
  const content = serializeTaskPackDraftContent({
    projectId: 1, projectName: "Project", rawTask: "x", taskType: "general", targetTool: "codex",
  });
  for (const key of [
    "templateId", "ruleProfileId", "customRulesText", "acceptanceCriteriaPresetId",
    "acceptanceCriteriaText", "performanceSessionId", "understandingSnapshotId",
    "reviewedUnderstandingSnapshotId",
  ] as const) assert.equal(content[key], null);
  assert.deepEqual(content.enabledRuleIds, []);
  assert.deepEqual(content.clarifications, []);
});

scenario("authored empty strings remain empty strings", () => {
  const content = serializeTaskPackDraftContent(editable());
  assert.equal(content.templateId, "");
  assert.equal(content.acceptanceCriteriaText, "");
});

scenario("whitespace-only optional strings are preserved", () => {
  assert.equal(serializeTaskPackDraftContent(editable()).ruleProfileId, "   ");
});

scenario("arrays preserve order and duplicates in independent copies", () => {
  const source = editable();
  const content = serializeTaskPackDraftContent(source);
  assert.deepEqual(content.enabledRuleIds, ["second", "first", "second"]);
  assert.notEqual(content.enabledRuleIds, source.enabledRuleIds);
});

scenario("clarifications preserve unanswered rows and exact text in deep copies", () => {
  const source = editable();
  const content = serializeTaskPackDraftContent(source);
  assert.deepEqual(content.clarifications, source.clarifications);
  assert.notEqual(content.clarifications, source.clarifications);
  assert.notEqual(content.clarifications[0], source.clarifications![0]);
});

scenario("serialization does not mutate even frozen input", () => {
  const source = editable();
  const before = structuredClone(source);
  source.clarifications!.forEach(Object.freeze);
  Object.freeze(source.clarifications);
  Object.freeze(source.enabledRuleIds);
  Object.freeze(source);
  serializeTaskPackDraftContent(source);
  assert.deepEqual(source, before);
});

scenario("serialized content has exactly the server fields and no identity/display metadata", () => {
  assert.deepEqual(Object.keys(serializeTaskPackDraftContent(editable())), [
    "rawTask", "taskType", "targetTool", "templateId", "ruleProfileId", "enabledRuleIds",
    "customRulesText", "acceptanceCriteriaPresetId", "acceptanceCriteriaText", "clarifications",
    "performanceSessionId", "understandingSnapshotId", "reviewedUnderstandingSnapshotId",
  ]);
});

scenario("deserializer maps every nullable null to undefined", () => {
  const emptyOptionalContent = serializeTaskPackDraftContent({
    projectId: 3, projectName: "Local project", rawTask: "x", taskType: "general", targetTool: "codex",
  });
  const draft = deserializeTaskPackDraftContent({ ...view(), content: emptyOptionalContent });
  for (const [key, value] of Object.entries(emptyOptionalContent)) {
    if (value === null) assert.equal(draft[key as keyof TaskPackDraft], undefined);
  }
});

scenario("deserializer preserves empty/whitespace strings and exact content round-trip", () => {
  const original = view();
  const draft = deserializeTaskPackDraftContent(original);
  assert.equal(draft.templateId, "");
  assert.equal(draft.ruleProfileId, "   ");
  assert.equal(draft.projectName, original.projectName);
  assert.deepEqual(serializeTaskPackDraftContent(draft), original.content);
});

scenario("deserializer copies arrays/rows without mutating the server view", () => {
  const original = view();
  const before = structuredClone(original);
  const draft = deserializeTaskPackDraftContent(original);
  draft.enabledRuleIds!.reverse();
  draft.clarifications![0].answer = "new local answer";
  assert.deepEqual(original, before);
});

scenario("persisted session captures identity version lifecycle binding and timestamps", () => {
  const original = { ...view(), taskPackId: 5, baseRevisionId: 9, expiresAt: "2026-10-01T00:00:00.000Z" };
  const session = createTaskPackDraftSessionFromPersisted("local-session", original);
  const { content, projectId: _projectId, projectName: _projectName, ...metadata } = original;
  assert.deepEqual(session.persistence, { ...metadata, lastSavedContent: content });
  assert.equal(session.sessionId, "local-session");
  assert.notEqual(session.sessionId, session.persistence!.id);
});

scenario("lastSavedContent and lifecycle are independent from both view and editable draft", () => {
  const original = view();
  const session = createTaskPackDraftSessionFromPersisted("local-session", original);
  assert.notEqual(session.persistence!.lifecycle, original.lifecycle);
  assert.notEqual(session.persistence!.lastSavedContent, original.content);
  assert.notEqual(session.persistence!.lastSavedContent.clarifications[0], original.content.clarifications[0]);
  session.draft.clarifications![0].answer = "local change";
  session.draft.enabledRuleIds!.push("new-rule");
  assert.deepEqual(session.persistence!.lastSavedContent, original.content);
});

scenario("exact restored content is initially clean", () => {
  assert.equal(isTaskPackDraftSessionDirty(createTaskPackDraftSessionFromPersisted("local", view())), false);
});

scenario("edited rawTask including whitespace or line endings becomes dirty", () => {
  for (const transform of [(s: string) => `${s} `, (s: string) => s.replace(/\r\n/g, "\n")]) {
    const session = createTaskPackDraftSessionFromPersisted("local", view());
    session.draft.rawTask = transform(session.draft.rawTask);
    assert.equal(isTaskPackDraftSessionDirty(session), true);
  }
});

scenario("changed rule order becomes dirty", () => {
  const session = createTaskPackDraftSessionFromPersisted("local", view());
  session.draft.enabledRuleIds = ["first", "second", "second"];
  assert.equal(isTaskPackDraftSessionDirty(session), true);
});

scenario("removed rule duplicate becomes dirty", () => {
  const session = createTaskPackDraftSessionFromPersisted("local", view());
  session.draft.enabledRuleIds!.pop();
  assert.equal(isTaskPackDraftSessionDirty(session), true);
});

scenario("changed clarification answer becomes dirty", () => {
  const session = createTaskPackDraftSessionFromPersisted("local", view());
  session.draft.clarifications![0].answer = "answer";
  assert.equal(isTaskPackDraftSessionDirty(session), true);
});

scenario("changed clarification order becomes dirty", () => {
  const session = createTaskPackDraftSessionFromPersisted("local", view());
  session.draft.clarifications!.reverse();
  assert.equal(isTaskPackDraftSessionDirty(session), true);
});

scenario("projectName-only change does not become persistence-dirty", () => {
  const session = createTaskPackDraftSessionFromPersisted("local", view());
  session.draft.projectName = "Renamed project";
  assert.equal(isTaskPackDraftSessionDirty(session), false);
});

scenario("timestamps lifecycle and version do not enter dirty comparison", () => {
  const session = createTaskPackDraftSessionFromPersisted("local", view());
  const persistence = { ...session.persistence!, draftVersion: 42, updatedAt: "later",
    lifecycle: { state: "discarded", materializedRevisionId: null } as const };
  assert.equal(isTaskPackDraftSessionDirty({ ...session, persistence }), false);
});

scenario("session and snapshot content IDs each affect dirtiness", () => {
  for (const key of ["performanceSessionId", "understandingSnapshotId", "reviewedUnderstandingSnapshotId"] as const) {
    const session = createTaskPackDraftSessionFromPersisted("local", view());
    session.draft[key] = "changed";
    assert.equal(isTaskPackDraftSessionDirty(session), true);
  }
});

scenario("content key insertion order does not affect dirtiness", () => {
  const original = view();
  const content = Object.fromEntries(Object.entries(original.content).reverse()) as unknown as TaskPackPersistedDraftContent;
  const session = createTaskPackDraftSessionFromPersisted("local", original);
  assert.equal(isTaskPackDraftSessionDirty({ ...session, persistence: { ...session.persistence!, lastSavedContent: content } }), false);
});

scenario("dirty comparison treats undefined as persisted null but distinguishes authored empty strings", () => {
  const session = createTaskPackDraftSessionFromPersisted("local", view());
  assert.equal(session.draft.acceptanceCriteriaPresetId, undefined);
  assert.equal(session.persistence!.lastSavedContent.acceptanceCriteriaPresetId, null);
  assert.equal(isTaskPackDraftSessionDirty(session), false);
  session.draft.acceptanceCriteriaPresetId = "";
  assert.equal(isTaskPackDraftSessionDirty(session), true);
  session.draft.acceptanceCriteriaPresetId = undefined;
  assert.equal(isTaskPackDraftSessionDirty(session), false);
});

scenario("no-op save response may retain version and updatedAt", () => {
  const original = view();
  const session = createTaskPackDraftSessionFromPersisted("local", original);
  const saved = updateTaskPackDraftSavedBaseline(session, original);
  assert.equal(saved.persistence!.draftVersion, 7);
  assert.equal(saved.persistence!.updatedAt, original.updatedAt);
  assert.equal(isTaskPackDraftSessionDirty(saved), false);
  assert.notEqual(saved.persistence!.lastSavedContent, original.content);
});

scenario("successful save uses returned version without assuming plus one", () => {
  const session = createTaskPackDraftSessionFromPersisted("local", view());
  session.draft.rawTask = "saved edit";
  const saved = updateTaskPackDraftSavedBaseline(session, {
    ...view(), draftVersion: 10, content: serializeTaskPackDraftContent(session.draft),
  });
  assert.equal(saved.persistence!.draftVersion, 10);
  assert.equal(isTaskPackDraftSessionDirty(saved), false);
  assert.equal(session.persistence!.draftVersion, 7);
});

scenario("save response updates baseline without replacing later local edits", () => {
  const session = createTaskPackDraftSessionFromPersisted("local", view());
  session.draft.rawTask = "newer unsaved local text";
  const before = structuredClone(session);
  const saved = updateTaskPackDraftSavedBaseline(session, { ...view(), draftVersion: 8 });
  assert.equal(saved.draft.rawTask, "newer unsaved local text");
  assert.equal(isTaskPackDraftSessionDirty(saved), true);
  assert.deepEqual(session, before);
});

scenario("first save attaches metadata to a transient session without changing local identity", () => {
  const session = createTransientTaskPackDraftSession("local", editable());
  const saved = updateTaskPackDraftSavedBaseline(session, { ...view(), draftVersion: 1 });
  assert.equal(saved.sessionId, session.sessionId);
  assert.equal(saved.persistence!.draftVersion, 1);
  assert.equal(isTaskPackDraftSessionDirty(saved), false);
  assert.equal(session.persistence, null);
});

scenario("wrong draft/project and regressing responses cannot replace a baseline", () => {
  const session = createTaskPackDraftSessionFromPersisted("local", view());
  for (const invalid of [{ ...view(), id: "other" }, { ...view(), projectId: 9 }, { ...view(), draftVersion: 6 }]) {
    assert.throws(() => updateTaskPackDraftSavedBaseline(session, invalid));
  }
});

scenario("save eligibility accepts one and two non-whitespace characters", () => {
  for (const rawTask of ["x", "ab", " x "]) assert.equal(canPersistTaskPackDraft({ ...editable(), rawTask }), true);
});

scenario("save eligibility rejects blank and whitespace without rewriting input", () => {
  for (const rawTask of ["", "   ", "\r\n\t"]) {
    const draft = { ...editable(), rawTask };
    assert.equal(canPersistTaskPackDraft(draft), false);
    assert.equal(draft.rawTask, rawTask);
  }
});

scenario("transient and persisted sessions are distinguished without UI state", () => {
  const source = editable();
  const transient = createTransientTaskPackDraftSession("local", source);
  assert.equal(isPersistedTaskPackDraftSession(transient), false);
  assert.equal(isTaskPackDraftSessionDirty(transient), true);
  assert.notEqual(transient.draft.clarifications![0], source.clarifications![0]);
  assert.equal(isPersistedTaskPackDraftSession(createTaskPackDraftSessionFromPersisted("local", view())), true);
});

scenario("session identity cannot reuse persisted identity", () => {
  assert.throws(() => createTaskPackDraftSessionFromPersisted(view().id, view()));
  assert.throws(() => createTransientTaskPackDraftSession(" ", editable()));
});

scenario("terminal lifecycle metadata is represented without reopen or review/reset behavior", () => {
  const lifecycles: TaskPackDraftLifecycle[] = [
    { state: "discarded", materializedRevisionId: null },
    { state: "materialized", materializedRevisionId: 12 },
  ];
  for (const lifecycle of lifecycles) {
    const session = createTaskPackDraftSessionFromPersisted("local", { ...view(), lifecycle });
    assert.deepEqual(session.persistence!.lifecycle, lifecycle);
    assert.equal(session.draft.reviewedUnderstandingSnapshotId, "snapshot");
  }
});

scenario("editable type and deserialized object contain no persisted metadata", () => {
  const editableHasPersistedMetadata: Extract<keyof TaskPackDraft, "id" | "draftVersion" | "lifecycle" | "taskPackId" | "baseRevisionId" | "createdAt" | "updatedAt" | "expiresAt"> extends never ? false : true = false;
  assert.equal(editableHasPersistedMetadata, false);
  const draft = deserializeTaskPackDraftContent(view());
  for (const key of ["id", "draftVersion", "lifecycle", "taskPackId", "baseRevisionId", "createdAt", "updatedAt", "expiresAt"]) {
    assert.equal(Object.hasOwn(draft, key), false);
  }
});

process.stdout.write(`Task Pack draft session smoke passed: ${scenarios} scenarios.\n`);
