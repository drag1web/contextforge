import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Database } from "sql.js";
import { SqliteStorageAdapter } from "../storage/SqliteStorageAdapter.js";
import { TaskPackRevisionHistoryStorageError, type TaskPackRevisionHistorySnapshot } from "../storage/types.js";
import { computeTaskPackRevisionContentHash, type TaskPackRevisionContent,
  type TaskPackRevisionReviewEvent } from "./taskPackLifecycle.js";
import { createTaskPackRevisionHistoryApplicationService, TaskPackRevisionHistoryApplicationError,
  type TaskPackRevisionHistoryApplicationServiceStorage } from "./taskPackRevisionHistoryApplicationService.js";

const scenarios: { name: string; run: () => void | Promise<void> }[] = [];
const scenario = (name: string, run: () => void | Promise<void>) => scenarios.push({ name, run });
const stamp = "2030-01-01T00:00:00.000Z";
const later = "2030-01-01T00:00:01.000Z";
const packId = 17;
function content(sourceKind: TaskPackRevisionContent["sourceKind"]): TaskPackRevisionContent {
  return {
    sourceKind, rawTask: "PRIVATE_RAW_TASK\r\nExact authored text.", taskType: "tests", targetTool: "generic",
    generatedPrompt: "PRIVATE_GENERATED_PROMPT", generationMode: "ollama", generationModel: "fixture-model",
    generationMessage: "PRIVATE_GENERATION_MESSAGE", generationUsedFallback: false, generationDurationMs: 15,
    generationRecipe: { secretMarker: "PRIVATE_RECIPE" },
    diagnostics: { selector: { private: "PRIVATE_SELECTOR" }, generation: { private: "PRIVATE_GENERATION" },
      performance: { private: "PRIVATE_PERFORMANCE" } },
    groundedContextSnapshot: { schemaVersion: 1, selectorEngine: "legacy", selectorConfigurationFingerprint: null,
      repositoryObservationFingerprint: null, repositorySnapshotFingerprint: null, selectorSnapshotFingerprint: null,
      selectedFiles: [{ path: "src/private.ts", role: "reference", usage: "inspect-only", evidenceStrength: "reference",
        proofClasses: ["inventory_exact"] }] },
    freshnessBasis: { schemaVersion: 1, stateAtCreation: "unknown", projectAwarenessFingerprint: null,
      inventoryFingerprint: null, policyVersion: "PRIVATE_POLICY", comparisonLimited: true, observedAt: null, previousObservedAt: null },
  };
}
function event(revisionId: number, id: string, eventType: TaskPackRevisionReviewEvent["eventType"],
  fromState: TaskPackRevisionReviewEvent["fromState"], toState: TaskPackRevisionReviewEvent["toState"],
  createdAt = stamp): TaskPackRevisionReviewEvent {
  return { id, taskPackId: packId, revisionId, eventType, fromState, toState, createdAt,
    source: "user", actorId: "PRIVATE_ACTOR", metadata: { private: "PRIVATE_EVENT_METADATA" } };
}
function fixture(): TaskPackRevisionHistorySnapshot {
  const revisions = [101, 205, 309].map((id, index) => {
    const fields = content(index === 0 ? "generated" : "manual_edit");
    return { revision: { ...fields, id, taskPackId: packId, revisionNumber: index + 1,
      baseRevisionId: index === 0 ? null : [101, 205][index - 1], contentHash: computeTaskPackRevisionContentHash(fields),
      createdAt: stamp, generatedAt: index === 0 ? stamp : null }, reviewEvents: [] as TaskPackRevisionReviewEvent[] };
  });
  revisions[0].reviewEvents.push(event(101, "a-start", "review_started", "unreviewed", "in_review"),
    event(101, "a-accepted", "accepted", "in_review", "accepted", later));
  revisions[1].reviewEvents.push(event(205, "b-accepted", "accepted", "unreviewed", "accepted"));
  revisions[2].reviewEvents.push(event(309, "c-start", "review_started", "unreviewed", "in_review"),
    event(309, "c-changes", "changes_requested", "in_review", "changes_requested", later));
  return { aggregate: { id: packId, projectId: 7, title: "PRIVATE_TITLE", lifecycle: { state: "active", archivedFromState: null },
    currentRevisionId: 309, acceptedRevisionId: 205, lifecycleVersion: 6, createdAt: stamp, updatedAt: later,
    completedAt: null, archivedAt: null }, revisions };
}
function service(snapshot: TaskPackRevisionHistorySnapshot | null) {
  return createTaskPackRevisionHistoryApplicationService({ getTaskPackRevisionHistorySnapshot: async () => snapshot });
}
const topKeys = ["taskPackId", "currentRevisionId", "revisions"];
const rowKeys = ["id", "revisionNumber", "baseRevisionId", "sourceKind", "createdAt", "generatedAt", "contentHash",
  "generationMode", "generationModel", "generationUsedFallback", "reviewState"];
const detailKeys = [...rowKeys, "rawTask", "taskType", "targetTool", "generatedPrompt"];
function detailFixture(): TaskPackRevisionHistorySnapshot {
  const snapshot = fixture();
  return { ...snapshot, revisions: snapshot.revisions.map((item, index) => {
    const fields = { ...content(item.revision.sourceKind), rawTask: ` \tHistorical task ${index + 1}\r\nKeep this text.\n  `,
      generatedPrompt: `\n  Historical document ${index + 1}\r\n\tEnd.  ` };
    return { ...item, revision: { ...item.revision, ...fields, contentHash: computeTaskPackRevisionContentHash(fields) } };
  }) };
}
async function expectCorrupt(snapshot: TaskPackRevisionHistorySnapshot) {
  await assert.rejects(() => service(snapshot).getTaskPackRevisionHistoryList(packId), error => {
    assert.ok(error instanceof TaskPackRevisionHistoryApplicationError);
    assert.equal(error.code, "TASK_PACK_REVISION_HISTORY_STATE_INVALID");
    assert.equal(error.message, "Task Pack revision history is invalid.");
    assert.equal("cause" in error, false); assert.doesNotMatch(JSON.stringify(error), /PRIVATE|SQL|driver|constraint/);
    return true;
  });
}
scenario("missing aggregate returns null distinct from corrupt history", async () => {
  assert.equal(await service(null).getTaskPackRevisionHistoryList(packId), null);
});
scenario("service calls only the narrow bulk snapshot primitive exactly once", async () => {
  let calls = 0;
  const storage = new Proxy({ getTaskPackRevisionHistorySnapshot: async (id: number) => {
    calls++; assert.equal(id, packId); return fixture();
  } }, { get(target, key, receiver) {
    if (key !== "getTaskPackRevisionHistorySnapshot") throw new Error("per-item/mutation storage access is forbidden");
    return Reflect.get(target, key, receiver);
  } });
  await createTaskPackRevisionHistoryApplicationService(storage).getTaskPackRevisionHistoryList(packId);
  assert.equal(calls, 1);
});
scenario("closed whitelist DTO has exactly allowed outer and revision fields", async () => {
  const list = (await service(fixture()).getTaskPackRevisionHistoryList(packId))!;
  assert.deepEqual(Object.keys(list).sort(), [...topKeys].sort());
  for (const row of list.revisions) assert.deepEqual(Object.keys(row).sort(), [...rowKeys].sort());
});
scenario("currentRevisionId and actual revisionNumber remain separate from global identity", async () => {
  const list = (await service(fixture()).getTaskPackRevisionHistoryList(packId))!;
  assert.equal(list.taskPackId, packId); assert.equal(list.currentRevisionId, 309);
  assert.deepEqual(list.revisions.map(r => r.id), [101, 205, 309]);
  assert.deepEqual(list.revisions.map(r => r.revisionNumber), [1, 2, 3]);
  assert.deepEqual(list.revisions.map(r => r.baseRevisionId), [null, 101, 205]);
});
scenario("historical states use independent complete replay with multiple accepted revisions", async () => {
  const list = (await service(fixture()).getTaskPackRevisionHistoryList(packId))!;
  assert.deepEqual(list.revisions.map(r => r.reviewState), ["accepted", "accepted", "changes_requested"]);
});
scenario("changing accepted pointer is not a substitute for historical review state", async () => {
  const snapshot = fixture();
  const list = await service(snapshot).getTaskPackRevisionHistoryList(packId);
  const other = { ...snapshot, aggregate: { ...snapshot.aggregate, acceptedRevisionId: 101 } };
  assert.deepEqual(await service(other).getTaskPackRevisionHistoryList(packId), list);
});
scenario("zero review events derive unreviewed even with an accepted aggregate pointer", async () => {
  const snapshot = fixture();
  const withoutEvents = { ...snapshot, revisions: snapshot.revisions.map(item => ({ ...item, reviewEvents: [] })) };
  assert.deepEqual((await service(withoutEvents).getTaskPackRevisionHistoryList(packId))!.revisions.map(r => r.reviewState),
    ["unreviewed", "unreviewed", "unreviewed"]);
});
scenario("start_review derives in_review independently", async () => {
  const snapshot = fixture();
  const inReview = { ...snapshot, revisions: snapshot.revisions.map(item => ({ ...item,
    reviewEvents: item.reviewEvents.filter(e => e.eventType === "review_started") })) };
  assert.deepEqual((await service(inReview).getTaskPackRevisionHistoryList(packId))!.revisions.map(r => r.reviewState),
    ["in_review", "unreviewed", "in_review"]);
});
for (const fields of [
  ["rawTask", "generatedPrompt"], ["generationMessage", "generationDurationMs"], ["diagnostics"], ["generationRecipe"],
  ["groundedContextSnapshot", "freshnessBasis"], ["reviewEvents", "actorId", "metadata", "eventId"],
  ["lifecycleVersion", "expectedLifecycleVersion", "expectedReviewState"],
  ["lifecycle", "acceptedRevisionId", "completedAt", "archivedAt", "title", "projectId"],
]) scenario(`list excludes ${fields.join(" / ")}`, async () => {
  const list = (await service(fixture()).getTaskPackRevisionHistoryList(packId))!;
  for (const row of [list, ...list.revisions]) for (const key of fields) assert.equal(Object.hasOwn(row, key), false);
  assert.doesNotMatch(JSON.stringify(list), /PRIVATE|src\/private/);
});
scenario("read does not modify a frozen input or share mutable projection objects", async () => {
  const snapshot = fixture(), before = structuredClone(snapshot);
  function freeze(value: unknown) {
    if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  }
  freeze(snapshot);
  const list = (await service(snapshot).getTaskPackRevisionHistoryList(packId))!;
  assert.deepEqual(snapshot, before); assert.notEqual(list.revisions, snapshot.revisions);
  (list.revisions[0] as { generationModel: string | null }).generationModel = "changed output only";
  assert.equal(snapshot.revisions[0].revision.generationModel, "fixture-model");
});
scenario("same canonical hash never collapses distinct immutable revisions", async () => {
  const snapshot = fixture();
  // Revisions 2/3 have identical semantic content; ancestry/identity/timestamps are not hashed.
  assert.equal(snapshot.revisions[1].revision.contentHash, snapshot.revisions[2].revision.contentHash);
  const list = (await service(snapshot).getTaskPackRevisionHistoryList(packId))!;
  assert.equal(list.revisions.length, 3); assert.notEqual(list.revisions[1].id, list.revisions[2].id);
});
for (const [name, change] of [
  ["wrong aggregate identity", (s: TaskPackRevisionHistorySnapshot) => ({ ...s, aggregate: { ...s.aggregate, id: 99 } })],
  ["invalid aggregate version", (s: TaskPackRevisionHistorySnapshot) => ({ ...s, aggregate: { ...s.aggregate, lifecycleVersion: 0 } })],
  ["missing current revision", (s: TaskPackRevisionHistorySnapshot) => ({ ...s, aggregate: { ...s.aggregate, currentRevisionId: 987 } })],
  ["foreign accepted pointer", (s: TaskPackRevisionHistorySnapshot) => ({ ...s, aggregate: { ...s.aggregate, acceptedRevisionId: 987 } })],
  ["no revisions", (s: TaskPackRevisionHistorySnapshot) => ({ ...s, revisions: [] })],
  ["foreign revision", (s: TaskPackRevisionHistorySnapshot) => ({ ...s, revisions: s.revisions.map((i, n) => n === 1
    ? { ...i, revision: { ...i.revision, taskPackId: 99 } } : i) })],
  ["invalid content hash", (s: TaskPackRevisionHistorySnapshot) => ({ ...s, revisions: s.revisions.map((i, n) => n === 1
    ? { ...i, revision: { ...i.revision, generatedPrompt: "Tampered private prompt" } } : i) })],
  ["missing base", (s: TaskPackRevisionHistorySnapshot) => ({ ...s, revisions: s.revisions.map((i, n) => n === 1
    ? { ...i, revision: { ...i.revision, baseRevisionId: 987 } } : i) })],
  ["forward base", (s: TaskPackRevisionHistorySnapshot) => ({ ...s, revisions: s.revisions.map((i, n) => n === 1
    ? { ...i, revision: { ...i.revision, baseRevisionId: 309 } } : i) })],
  ["duplicate revision ID", (s: TaskPackRevisionHistorySnapshot) => ({ ...s, revisions: [s.revisions[0], ...s.revisions] })],
  ["out-of-order revisions", (s: TaskPackRevisionHistorySnapshot) => ({ ...s, revisions: [...s.revisions].reverse() })],
  ["foreign review owner", (s: TaskPackRevisionHistorySnapshot) => ({ ...s, revisions: s.revisions.map((i, n) => n === 0
    ? { ...i, reviewEvents: i.reviewEvents.map(e => ({ ...e, taskPackId: 99 })) } : i) })],
  ["foreign review revision", (s: TaskPackRevisionHistorySnapshot) => ({ ...s, revisions: s.revisions.map((i, n) => n === 0
    ? { ...i, reviewEvents: i.reviewEvents.map(e => ({ ...e, revisionId: 309 })) } : i) })],
  ["invalid review prefix despite plausible tail", (s: TaskPackRevisionHistorySnapshot) => ({ ...s, revisions: s.revisions.map((i, n) => n === 0
    ? { ...i, reviewEvents: [{ ...i.reviewEvents[0], fromState: "in_review" as const }, i.reviewEvents[1]] } : i) })],
  ["duplicate event across revisions", (s: TaskPackRevisionHistorySnapshot) => ({ ...s, revisions: s.revisions.map((i, n) => n === 1
    ? { ...i, reviewEvents: i.reviewEvents.map(e => ({ ...e, id: "a-accepted" })) } : i) })],
] as const) scenario(`corrupt ${name} fails the entire application read safely`, async () => {
  await expectCorrupt(change(fixture()));
});
scenario("typed storage corruption becomes application-owned error without leaking storage class/cause", async () => {
  const storage: TaskPackRevisionHistoryApplicationServiceStorage = { getTaskPackRevisionHistorySnapshot: async () => {
    throw new TaskPackRevisionHistoryStorageError();
  } };
  await assert.rejects(() => createTaskPackRevisionHistoryApplicationService(storage).getTaskPackRevisionHistoryList(packId), error => {
    assert.ok(error instanceof TaskPackRevisionHistoryApplicationError);
    assert.equal(error instanceof TaskPackRevisionHistoryStorageError, false);
    assert.equal(error.code, "TASK_PACK_REVISION_HISTORY_STATE_INVALID"); assert.equal("cause" in error, false);
    return true;
  });
});
scenario("unexpected storage/driver error propagates by identity without relabeling/retry", async () => {
  const error = new Error("private SQL driver details"); let calls = 0;
  const storage = { getTaskPackRevisionHistorySnapshot: async () => { calls++; throw error; } };
  await assert.rejects(() => createTaskPackRevisionHistoryApplicationService(storage).getTaskPackRevisionHistoryList(packId), e => e === error);
  assert.equal(calls, 1);
});
scenario("invalid public identity rejects before storage read", async () => {
  let calls = 0;
  const sut = createTaskPackRevisionHistoryApplicationService({ getTaskPackRevisionHistorySnapshot: async () => { calls++; return null; } });
  for (const id of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, "17" as unknown as number]) {
    await assert.rejects(() => sut.getTaskPackRevisionHistoryList(id), e =>
      e instanceof TaskPackRevisionHistoryApplicationError && e.code === "TASK_PACK_REVISION_HISTORY_INPUT_INVALID");
  }
  assert.equal(calls, 0);
});
scenario("detail reads the current revision using its exact identity and real ordinal", async () => {
  const snapshot = detailFixture();
  const result = (await service(snapshot).getTaskPackRevisionDetail(packId, 309))!;
  assert.equal(result.taskPackId, packId); assert.equal(result.currentRevisionId, 309);
  assert.equal(result.revision.id, 309); assert.equal(result.revision.revisionNumber, 3);
  assert.equal(result.revision.reviewState, "changes_requested");
});
scenario("historical detail returns historical bodies, not current content", async () => {
  const snapshot = detailFixture(), historical = snapshot.revisions[0].revision;
  const result = (await service(snapshot).getTaskPackRevisionDetail(packId, 101))!;
  assert.equal(result.currentRevisionId, 309); assert.equal(result.revision.id, 101);
  assert.equal(result.revision.revisionNumber, 1); assert.equal(result.revision.baseRevisionId, null);
  assert.equal(result.revision.rawTask, historical.rawTask); assert.equal(result.revision.generatedPrompt, historical.generatedPrompt);
  assert.notEqual(result.revision.rawTask, snapshot.revisions[2].revision.rawTask);
});
scenario("detail preserves leading/trailing whitespace, tabs and CRLF authored strings exactly", async () => {
  const snapshot = detailFixture();
  for (const { revision } of snapshot.revisions) {
    const result = (await service(snapshot).getTaskPackRevisionDetail(packId, revision.id))!;
    assert.equal(result.revision.rawTask, revision.rawTask); assert.equal(result.revision.generatedPrompt, revision.generatedPrompt);
    assert.notEqual(result.revision.rawTask, result.revision.rawTask.trim());
    assert.ok(result.revision.generatedPrompt.includes("\r\n"));
  }
});
scenario("detail exposes exactly the closed outer/detail whitelist", async () => {
  const result = (await service(fixture()).getTaskPackRevisionDetail(packId, 101))!;
  assert.deepEqual(Object.keys(result).sort(), ["taskPackId", "currentRevisionId", "revision"].sort());
  assert.deepEqual(Object.keys(result.revision).sort(), [...detailKeys].sort());
  assert.equal(result.revision.taskType, "tests"); assert.equal(result.revision.targetTool, "generic");
});
scenario("detail recursive runtime privacy excludes diagnostics, recipe, review events, actors and CAS", async () => {
  const result = (await service(fixture()).getTaskPackRevisionDetail(packId, 101))!;
  const forbidden = new Set(["diagnostics", "generationRecipe", "groundedContextSnapshot", "freshnessBasis",
    "generationMessage", "generationDurationMs", "reviewEvents", "actorId", "metadata", "eventId", "lifecycleVersion",
    "expectedLifecycleVersion", "expectedReviewState", "lifecycle", "acceptedRevisionId", "completedAt", "archivedAt", "stack", "cause"]);
  function inspect(value: unknown) {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) { assert.equal(forbidden.has(key), false, key); inspect(child); }
  }
  inspect(result);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_(?:ACTOR|EVENT|RECIPE|SELECTOR|GENERATION|PERFORMANCE|POLICY)|src\/private/);
});
scenario("detail derives each historical chain independently, including multiple accepted revisions", async () => {
  const snapshot = fixture();
  for (const [id, expected] of [[101, "accepted"], [205, "accepted"], [309, "changes_requested"]] as const) {
    assert.equal((await service(snapshot).getTaskPackRevisionDetail(packId, id))!.revision.reviewState, expected);
  }
});
scenario("detail zero-event review is unreviewed, not inferred from accepted pointer", async () => {
  const snapshot = fixture();
  const withoutEvents = { ...snapshot, revisions: snapshot.revisions.map(item => ({ ...item, reviewEvents: [] })) };
  assert.equal((await service(withoutEvents).getTaskPackRevisionDetail(packId, 205))!.revision.reviewState, "unreviewed");
});
scenario("detail ignores which legitimate historical revision the accepted pointer recognizes", async () => {
  const snapshot = fixture();
  const original = await service(snapshot).getTaskPackRevisionDetail(packId, 101);
  assert.deepEqual(await service({ ...snapshot, aggregate: { ...snapshot.aggregate, acceptedRevisionId: 101 } })
    .getTaskPackRevisionDetail(packId, 101), original);
});
scenario("detail missing pack, missing revision and out-of-pack identity all return null", async () => {
  assert.equal(await service(null).getTaskPackRevisionDetail(packId, 101), null);
  assert.equal(await service(fixture()).getTaskPackRevisionDetail(packId, 987654), null);
  // Only the requested pack's snapshot is consulted; global identities are not looked up.
  assert.equal(await service(fixture()).getTaskPackRevisionDetail(packId, 777), null);
});
scenario("detail performs exactly one snapshot call, with no per-revision lookup/write", async () => {
  let calls = 0;
  const storage = new Proxy({ getTaskPackRevisionHistorySnapshot: async (id: number) => {
    calls++; assert.equal(id, packId); return fixture();
  } }, { get(target, key, receiver) {
    if (key !== "getTaskPackRevisionHistorySnapshot") throw new Error("detail may only read the snapshot");
    return Reflect.get(target, key, receiver);
  } });
  await createTaskPackRevisionHistoryApplicationService(storage).getTaskPackRevisionDetail(packId, 101);
  assert.equal(calls, 1);
});
scenario("detail validates both identities before reading storage", async () => {
  let calls = 0;
  const sut = createTaskPackRevisionHistoryApplicationService({ getTaskPackRevisionHistorySnapshot: async () => { calls++; return null; } });
  for (const id of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, "101" as unknown as number]) {
    for (const [taskPackId, revisionId] of [[id, 101], [packId, id]]) {
      await assert.rejects(() => sut.getTaskPackRevisionDetail(taskPackId, revisionId), e =>
        e instanceof TaskPackRevisionHistoryApplicationError && e.code === "TASK_PACK_REVISION_HISTORY_INPUT_INVALID");
    }
  }
  assert.equal(calls, 0);
});
scenario("detail rejects corruption elsewhere in the full history, even for a missing requested revision", async () => {
  const snapshot = fixture();
  const corrupt = { ...snapshot, revisions: snapshot.revisions.map((item, index) => index === 2
    ? { ...item, revision: { ...item.revision, rawTask: "Tampered private text" } } : item) };
  for (const id of [101, 987654]) await assert.rejects(() => service(corrupt).getTaskPackRevisionDetail(packId, id), e =>
    e instanceof TaskPackRevisionHistoryApplicationError && e.code === "TASK_PACK_REVISION_HISTORY_STATE_INVALID");
});
scenario("detail rejects a broken historical prefix despite a plausible accepted tail", async () => {
  const snapshot = fixture();
  const corrupt = { ...snapshot, revisions: snapshot.revisions.map((item, index) => index === 0
    ? { ...item, reviewEvents: [{ ...item.reviewEvents[0], fromState: "in_review" as const }, item.reviewEvents[1]] } : item) };
  await assert.rejects(() => service(corrupt).getTaskPackRevisionDetail(packId, 101), e =>
    e instanceof TaskPackRevisionHistoryApplicationError && e.code === "TASK_PACK_REVISION_HISTORY_STATE_INVALID");
});
scenario("detail translates typed storage corruption without attaching cause/message evidence", async () => {
  const sut = createTaskPackRevisionHistoryApplicationService({ getTaskPackRevisionHistorySnapshot: async () => {
    throw new TaskPackRevisionHistoryStorageError();
  } });
  await assert.rejects(() => sut.getTaskPackRevisionDetail(packId, 101), e =>
    e instanceof TaskPackRevisionHistoryApplicationError && e.code === "TASK_PACK_REVISION_HISTORY_STATE_INVALID" && !("cause" in e));
});
scenario("detail operational driver failure propagates unchanged and is never retried", async () => {
  const error = new Error("private SQL driver details", { cause: new Error("private cause") }); let calls = 0;
  const sut = createTaskPackRevisionHistoryApplicationService({ getTaskPackRevisionHistorySnapshot: async () => { calls++; throw error; } });
  await assert.rejects(() => sut.getTaskPackRevisionDetail(packId, 101), e => e === error);
  assert.equal(calls, 1);
});
scenario("detail does not mutate historical authored content, pointers, events or timestamps", async () => {
  const snapshot = detailFixture(), before = structuredClone(snapshot);
  const result = (await service(snapshot).getTaskPackRevisionDetail(packId, 101))!;
  assert.deepEqual(snapshot, before); assert.notEqual(result.revision, snapshot.revisions[0].revision);
  (result.revision as { rawTask: string }).rawTask = "Output changed independently";
  assert.deepEqual(snapshot, before);
});
scenario("real SQLite -> actual application service returns validated metadata without writing persistence", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "contextforge-history-service-"));
  const databasePath = path.join(root, "service.sqlite");
  const adapter = new SqliteStorageAdapter(databasePath);
  try {
    await adapter.ensureSchema();
    const project = await adapter.upsertScannedProject({ name: "History service", localPath: root, packageManager: "npm",
      detectedStack: [], scripts: {}, readinessScore: 100, readinessReport: { score: 100, checks: [], issues: [] } });
    const pack = await adapter.createTaskPack({ projectId: project.id, title: "Integration", rawTask: "Private authored task",
      taskType: "tests", targetTool: "generic", generatedPrompt: "Private generated document", generationMode: "template",
      generationModel: null, generationMessage: null, generationUsedFallback: false, generationDurationMs: null,
      generationRecipe: { private: "recipe" } });
    const before = fs.readFileSync(databasePath);
    const result = (await createTaskPackRevisionHistoryApplicationService(adapter).getTaskPackRevisionHistoryList(pack.id))!;
    assert.equal(result.revisions.length, 1); assert.equal(result.revisions[0].reviewState, "unreviewed");
    assert.equal(result.currentRevisionId, result.revisions[0].id);
    assert.deepEqual(Object.keys(result.revisions[0]).sort(), [...rowKeys].sort());
    assert.deepEqual(fs.readFileSync(databasePath), before);
  } finally {
    (adapter as unknown as { db: Database | null }).db?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

for (const { name, run } of scenarios) { await run(); console.log(`PASS ${name}`); }
console.log(`Task Pack revision history application smoke: ${scenarios.length}/${scenarios.length} passed.`);
