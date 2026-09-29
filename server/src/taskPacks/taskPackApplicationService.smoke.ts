import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { SqliteStorageAdapter } from "../storage/SqliteStorageAdapter.js";
import type {
  CreateTaskPackWithInitialRevisionInput,
  TaskPackCurrentRecord,
  TaskPackRecord,
  TaskPackRevisionRecord,
  TaskPackLifecycleStorageErrorCode,
  TaskPackReviewStorageErrorCode,
} from "../storage/types.js";
import {
  TaskPackCurrentStateStorageError,
  TaskPackRevisionAppendStorageError,
  TaskPackLifecycleStorageError,
  TaskPackReviewStorageError,
} from "../storage/types.js";
import {
  createTaskPackApplicationService,
  TaskPackCurrentStateError,
  TaskPackGeneratedCreateInputError,
  TaskPackRevisionConflictError,
  TaskPackWorkflowApplicationError,
  type TaskPackLifecycleCommandInput,
  type TaskPackRevisionReviewCommandInput,
  type CreateGeneratedTaskPackInput,
  type TaskPackApplicationServiceStorage,
} from "./taskPackApplicationService.js";

interface SmokeScenario {
  readonly name: string;
  readonly run: () => void | Promise<void>;
}

const scenarios: SmokeScenario[] = [];
const scenario = (name: string, run: SmokeScenario["run"]) =>
  scenarios.push({ name, run });

const temporaryRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "contextforge-tp-lc-03c-"),
);
const databasePath = path.join(temporaryRoot, "current-read.sqlite");
const adapter = new SqliteStorageAdapter(databasePath);

let taskPack: TaskPackRecord;
let secondTaskPack: TaskPackRecord;
let currentRecord: TaskPackCurrentRecord;
let revision: TaskPackRevisionRecord;

scenario("SQLite current reads expose the current revision pointer", async () => {
  await adapter.ensureSchema();
  const project = await adapter.upsertScannedProject({
    name: "Current read fixture",
    localPath: path.join(temporaryRoot, "project"),
    packageManager: "npm",
    detectedStack: ["typescript"],
    scripts: { build: "tsc" },
    readinessScore: 100,
    readinessReport: { score: 100, checks: [], issues: [] },
  });
  taskPack = await adapter.createTaskPack({
    projectId: project.id,
    title: "Read boundary",
    rawTask: "Verify the current Task Pack read boundary.",
    taskType: "tests",
    targetTool: "codex",
    generatedPrompt: "Add a focused current-read smoke test.",
    generationMode: "template",
    generationModel: null,
    generationMessage: null,
    generationUsedFallback: false,
    generationDurationMs: 4,
    generationRecipe: { policy: "original" },
  });
  secondTaskPack = await adapter.createTaskPack({
    projectId: project.id,
    title: "Ordering boundary",
    rawTask: "Preserve legacy Task Pack ordering.",
    taskType: "tests",
    targetTool: "codex",
    generatedPrompt: "Compare ordered Task Pack identities.",
    generationMode: "template",
    generationModel: null,
    generationMessage: null,
    generationUsedFallback: false,
    generationDurationMs: 2,
    generationRecipe: { policy: "ordering" },
  });
  const list = await adapter.listTaskPackCurrentRecords();
  const legacyList = await adapter.listTaskPacks();
  assert.deepEqual(
    list.map((candidate) => candidate.id),
    legacyList.map((candidate) => candidate.id),
  );
  assert.equal(list.length, 2);
  for (const candidate of list) {
    assert.equal(candidate.projectName, project.name);
    assert.ok(Number.isSafeInteger(candidate.currentRevisionId));
    assert.ok(candidate.currentRevisionId > 0);
  }
  currentRecord = list.find((candidate) => candidate.id === taskPack.id)!;
  assert.ok(currentRecord);
  assert.ok(Number.isSafeInteger(currentRecord.currentRevisionId));
  assert.ok(currentRecord.currentRevisionId > 0);

  const detail = await adapter.getTaskPackCurrentRecordById(taskPack.id);
  assert.deepEqual(detail, currentRecord);
  assert.equal(detail?.projectName, project.name);
});

scenario("application service returns current flat, aggregate, and owned revision reads", async () => {
  const service = createTaskPackApplicationService(adapter);
  assert.deepEqual(await service.getCurrentTaskPack(taskPack.id), currentRecord);
  assert.equal((await service.listCurrentTaskPacks()).length, 2);

  const aggregate = await service.getTaskPackAggregate(taskPack.id);
  assert.ok(aggregate);
  revision = (await service.getCurrentTaskPackRevision(taskPack.id))!;
  assert.ok(revision);
  assert.equal(revision.id, aggregate.currentRevisionId);
  assert.equal(revision.taskPackId, aggregate.id);
});

scenario("nonexistent Task Pack returns null from current service reads", async () => {
  const service = createTaskPackApplicationService(adapter);
  assert.equal(await service.getCurrentTaskPack(999_999), null);
  assert.equal(await service.getTaskPackAggregate(999_999), null);
  assert.equal(await service.getCurrentTaskPackRevision(999_999), null);
});

scenario("current flat recipe may be newer than immutable revision 1", async () => {
  await adapter.updateTaskPackGenerationRecipe(taskPack.id, {
    policy: "original",
    performanceDiagnostics: { totalMs: 42 },
  });
  const service = createTaskPackApplicationService(adapter);
  const flat = await service.getCurrentTaskPack(taskPack.id);
  const immutable = await service.getCurrentTaskPackRevision(taskPack.id);
  assert.deepEqual(flat?.generationRecipe, {
    policy: "original",
    performanceDiagnostics: { totalMs: 42 },
  });
  assert.deepEqual(immutable?.generationRecipe, { policy: "original" });
  assert.equal(flat?.currentRevisionId, immutable?.id);
  assert.deepEqual(
    (await service.listCurrentTaskPacks()).find(
      (candidate) => candidate.id === taskPack.id,
    )?.generationRecipe,
    flat?.generationRecipe,
  );
});

scenario("legacy TaskPackRecord reads retain their original shape", async () => {
  const legacyList = await adapter.listTaskPacks();
  const legacyDetail = await adapter.getTaskPackById(taskPack.id);
  assert.equal(
    Object.hasOwn(
      legacyList.find((candidate) => candidate.id === secondTaskPack.id)!,
      "currentRevisionId",
    ),
    false,
  );
  assert.equal(Object.hasOwn(legacyDetail!, "currentRevisionId"), false);
  assert.deepEqual(legacyDetail?.generationRecipe, {
    policy: "original",
    performanceDiagnostics: { totalMs: 42 },
  });
});

scenario("PostgreSQL current-read mapping mirrors pointer ownership checks", () => {
  const source = fs.readFileSync(
    path.join(
      process.cwd(),
      "src",
      "storage",
      "PostgresStorageAdapter.ts",
    ),
    "utf8",
  );
  for (const required of [
    "listTaskPackCurrentRecords",
    "getTaskPackCurrentRecordById",
    "JOIN projects p ON p.id = tp.project_id",
    "ORDER BY tp.created_at DESC",
    'tp.current_revision_id AS "currentRevisionId"',
    'current_revision.id AS "resolvedCurrentRevisionId"',
    'current_revision.task_pack_id AS "currentRevisionTaskPackId"',
    "LEFT JOIN task_pack_revisions current_revision",
    "Number(row.resolvedCurrentRevisionId) !== currentRevisionId",
    "Number(row.currentRevisionTaskPackId) !== Number(row.id)",
    "TaskPackCurrentStateStorageError",
  ]) {
    assert.ok(source.includes(required), required);
  }
});

function storageFixture(
  overrides: Partial<TaskPackApplicationServiceStorage>,
): TaskPackApplicationServiceStorage {
  return {
    listTaskPackCurrentRecords: async () => [currentRecord],
    getTaskPackCurrentRecordById: async () => currentRecord,
    getTaskPackAggregate: async () => ({
      id: taskPack.id,
      projectId: taskPack.projectId,
      title: taskPack.title,
      lifecycle: { state: "active", archivedFromState: null },
      currentRevisionId: revision.id,
      acceptedRevisionId: null,
      lifecycleVersion: 1,
      createdAt: taskPack.createdAt,
      updatedAt: taskPack.updatedAt,
      completedAt: null,
      archivedAt: null,
    }),
    getTaskPackRevisionById: async () => revision,
    appendTaskPackRevision: async () => revision,
    createTaskPackWithInitialRevision: async () => taskPack,
    getTaskPackGitHubCreatedIssueLink: async () => null,
    createTaskPackGitHubCreatedIssueLink: async (input) => input,
    listTaskPackRevisionReviewEvents: async () => [],
    transitionTaskPackAggregateLifecycle: async () => { throw new Error("Unexpected lifecycle write"); },
    transitionTaskPackRevisionReview: async () => { throw new Error("Unexpected review write"); },
    ...overrides,
  };
}

function generatedCreateInput(
  overrides: Partial<CreateGeneratedTaskPackInput> = {},
): CreateGeneratedTaskPackInput {
  return {
    projectId: taskPack.projectId,
    title: "Generated material parity",
    generatedAt: "2026-09-24T09:00:00.000Z",
    revisionContent: {
      rawTask: "Prepare generated material once.",
      taskType: "tests",
      targetTool: "codex",
      generatedPrompt: "Preserve generated-create behavior.",
      generationMode: "template",
      generationModel: null,
      generationMessage: null,
      generationUsedFallback: false,
      generationDurationMs: 12,
    },
    generationRecipe: {
      template: { id: "default" },
      enabledRules: ["bounded"],
      omitted: undefined,
    },
    selectorDiagnostics: { selectedPathCount: 1, omitted: undefined },
    generationDiagnostics: { attempts: 1, omitted: undefined },
    performanceDiagnostics: { operationCount: 3, omitted: undefined },
    ...overrides,
  };
}

scenario("ordinary generated create preserves semantic and compatibility material", async () => {
  const captured: { value: CreateTaskPackWithInitialRevisionInput | null } = {
    value: null,
  };
  const service = createTaskPackApplicationService(
    storageFixture({
      createTaskPackWithInitialRevision: async (input) => {
        captured.value = input;
        return taskPack;
      },
    }),
  );
  assert.deepEqual(await service.createGeneratedTaskPack(generatedCreateInput()), taskPack);
  assert.ok(captured.value);
  assert.equal(captured.value.projectId, taskPack.projectId);
  assert.equal(captured.value.title, "Generated material parity");
  assert.equal(captured.value.generatedAt, "2026-09-24T09:00:00.000Z");
  assert.equal(captured.value.revisionContent.sourceKind, "generated");
  assert.deepEqual(captured.value.revisionContent.generationRecipe, {
    template: { id: "default" },
    enabledRules: ["bounded"],
  });
  assert.deepEqual(captured.value.revisionContent.diagnostics, {
    selector: { selectedPathCount: 1 },
    generation: { attempts: 1 },
    performance: { operationCount: 3 },
  });
  assert.equal(captured.value.revisionContent.groundedContextSnapshot, null);
  assert.equal(captured.value.revisionContent.freshnessBasis, null);
  assert.deepEqual(captured.value.compatibilityGenerationRecipe, {
    template: { id: "default" },
    enabledRules: ["bounded"],
    selectorDiagnostics: { selectedPathCount: 1 },
    generationDiagnostics: { attempts: 1 },
    performanceDiagnostics: { operationCount: 3 },
  });
});

scenario("ordinary generated create rejects non-JSON-safe material before storage", async () => {
  let writes = 0;
  const service = createTaskPackApplicationService(
    storageFixture({
      createTaskPackWithInitialRevision: async () => {
        writes += 1;
        return taskPack;
      },
    }),
  );
  await assert.rejects(
    () =>
      service.createGeneratedTaskPack(
        generatedCreateInput({ generationRecipe: { invalid: Number.NaN } }),
      ),
    (error: unknown) => {
      assert.ok(error instanceof TaskPackGeneratedCreateInputError);
      assert.equal(error.code, "TASK_PACK_GENERATED_CREATE_INVALID");
      assert.equal(
        error.message,
        "Task Pack generation recipe cannot contain non-finite numbers.",
      );
      return true;
    },
  );
  assert.equal(writes, 0);
});

scenario("ordinary generated create rejects workflow and diagnostic recipe fields", async () => {
  let writes = 0;
  const service = createTaskPackApplicationService(
    storageFixture({
      createTaskPackWithInitialRevision: async () => {
        writes += 1;
        return taskPack;
      },
    }),
  );
  for (const field of [
    "selectorDiagnostics",
    "generationDiagnostics",
    "performanceDiagnostics",
    "githubCreatedIssue",
  ] as const) {
    await assert.rejects(
      () =>
        service.createGeneratedTaskPack(
          generatedCreateInput({ generationRecipe: { [field]: {} } }),
        ),
      (error: unknown) => {
        assert.ok(error instanceof TaskPackGeneratedCreateInputError);
        assert.equal(
          error.message,
          `Task Pack generation recipe cannot contain ${field}.`,
        );
        return true;
      },
    );
  }
  assert.equal(writes, 0);
});

scenario("malformed current pointers fail closed", async () => {
  const service = createTaskPackApplicationService(
    storageFixture({
      getTaskPackCurrentRecordById: async () => ({
        ...currentRecord,
        currentRevisionId: 0,
      }),
    }),
  );
  await assert.rejects(
    () => service.getCurrentTaskPack(taskPack.id),
    TaskPackCurrentStateError,
  );
});

scenario("storage pointer failures become service current-state errors", async () => {
  const service = createTaskPackApplicationService(
    storageFixture({
      listTaskPackCurrentRecords: async () => {
        throw new TaskPackCurrentStateStorageError();
      },
    }),
  );
  await assert.rejects(
    () => service.listCurrentTaskPacks(),
    TaskPackCurrentStateError,
  );
});

scenario("missing current revision fails closed", async () => {
  const service = createTaskPackApplicationService(
    storageFixture({ getTaskPackRevisionById: async () => null }),
  );
  await assert.rejects(
    () => service.getCurrentTaskPackRevision(taskPack.id),
    TaskPackCurrentStateError,
  );
});

scenario("foreign current revision fails closed", async () => {
  const service = createTaskPackApplicationService(
    storageFixture({
      getTaskPackRevisionById: async () => ({
        ...revision,
        taskPackId: taskPack.id + 1,
      }),
    }),
  );
  await assert.rejects(
    () => service.getCurrentTaskPackRevision(taskPack.id),
    TaskPackCurrentStateError,
  );
});

scenario("mismatched current revision identity fails closed", async () => {
  const service = createTaskPackApplicationService(
    storageFixture({
      getTaskPackRevisionById: async () => ({ ...revision, id: revision.id + 1 }),
    }),
  );
  await assert.rejects(
    () => service.getCurrentTaskPackRevision(taskPack.id),
    TaskPackCurrentStateError,
  );
});

scenario("transaction-level stale append becomes a typed service conflict", async () => {
  const expected = currentRecord.currentRevisionId;
  const actual = expected + 1;
  const service = createTaskPackApplicationService(
    storageFixture({
      appendTaskPackRevision: async () => {
        throw new TaskPackRevisionAppendStorageError(
          "TASK_PACK_REVISION_CONFLICT",
          taskPack.id,
          expected,
          actual,
        );
      },
    }),
  );
  await assert.rejects(
    () =>
      service.editTaskPackContent({
        taskPackId: taskPack.id,
        expectedCurrentRevisionId: expected,
        rawTask: "Concurrent edit",
      }),
    (error: unknown) => {
      assert.ok(error instanceof TaskPackRevisionConflictError);
      assert.equal(error.taskPackId, taskPack.id);
      assert.equal(error.expectedCurrentRevisionId, expected);
      assert.equal(error.actualCurrentRevisionId, actual);
      return true;
    },
  );
});

// 05C: real SQLite workflows, with deterministic server-owned event fields.
let workflowPack: TaskPackRecord;
let workflowRevisionId: number;
let eventSequence = 0;
const workflowRuntime = {
  now: () => new Date(Date.UTC(2030, 0, 1) + eventSequence * 1000).toISOString(),
  createEventId: () => `workflow-service-${++eventSequence}`,
};
const workflowService = createTaskPackApplicationService(adapter, workflowRuntime);

scenario("workflow fresh read is compact active/unreviewed with authoritative version", async () => {
  workflowPack = await workflowService.createGeneratedTaskPack(generatedCreateInput());
  const state = await workflowService.getCurrentTaskPackWorkflowState(workflowPack.id);
  assert.ok(state);
  workflowRevisionId = state.currentRevisionId;
  assert.deepEqual(state, {
    taskPackId: workflowPack.id, lifecycle: { state: "active", archivedFromState: null },
    lifecycleVersion: 1, currentRevisionId: workflowRevisionId, acceptedRevisionId: null,
    completedAt: null, archivedAt: null, currentReviewState: "unreviewed",
  });
});

scenario("workflow missing read returns null", async () => {
  assert.equal(await workflowService.getCurrentTaskPackWorkflowState(999999), null);
});

scenario("review forwards exact CAS/state/identity and server fields without any pre-read", async () => {
  const forbiddenRead = async (): Promise<never> => { throw new Error("Command must not pre-read"); };
  const service = createTaskPackApplicationService(storageFixture({
    getTaskPackAggregate: forbiddenRead, getTaskPackRevisionById: forbiddenRead,
    getTaskPackCurrentRecordById: forbiddenRead, listTaskPackRevisionReviewEvents: forbiddenRead,
    transitionTaskPackRevisionReview: async input => {
      assert.deepEqual(input, {
        taskPackId: workflowPack.id, revisionId: workflowRevisionId,
        expectedLifecycleVersion: 1, expectedReviewState: "unreviewed", transition: { type: "start_review" },
        eventId: "workflow-service-1", createdAt: "2030-01-01T00:00:00.000Z",
        source: "user", actorId: null, metadata: null,
      });
      return adapter.transitionTaskPackRevisionReview(input);
    },
  }), workflowRuntime);
  const result = await service.transitionTaskPackRevisionReview({
    taskPackId: workflowPack.id, revisionId: workflowRevisionId,
    expectedLifecycleVersion: 1, expectedReviewState: "unreviewed", action: "start_review",
  });
  assert.equal(result.reviewState, "in_review");
  assert.equal(result.aggregate.lifecycleVersion, 1);
});

scenario("workflow replays full current revision chain, not accepted pointer", async () => {
  // changes_requested is terminal in the frozen domain: use a separate revision.
  let sequence = 0;
  const service = createTaskPackApplicationService(adapter, {
    now: () => new Date(Date.UTC(2030, 0, 1) + sequence * 1000).toISOString(),
    createEventId: () => `changes-requested-${++sequence}`,
  });
  const pack = await service.createGeneratedTaskPack(generatedCreateInput());
  const revisionId = (await service.getCurrentTaskPackRevision(pack.id))!.id;
  await service.transitionTaskPackRevisionReview({ taskPackId: pack.id, revisionId,
    expectedLifecycleVersion: 1, expectedReviewState: "unreviewed", action: "start_review" });
  await service.transitionTaskPackRevisionReview({
    taskPackId: pack.id, revisionId,
    expectedLifecycleVersion: 1, expectedReviewState: "in_review", action: "request_changes",
  });
  const state = await service.getCurrentTaskPackWorkflowState(pack.id);
  assert.equal(state?.currentReviewState, "changes_requested");
  assert.equal(state?.acceptedRevisionId, null);
  assert.equal((await adapter.listTaskPackRevisionReviewEvents(pack.id, revisionId)).length, 2);
});

scenario("accept updates accepted pointer but does not complete Task Pack", async () => {
  const result = await workflowService.transitionTaskPackRevisionReview({
    taskPackId: workflowPack.id, revisionId: workflowRevisionId,
    expectedLifecycleVersion: 1, expectedReviewState: "in_review", action: "accept",
  });
  assert.equal(result.reviewState, "accepted");
  assert.equal(result.aggregate.lifecycle.state, "active");
  assert.equal(result.aggregate.acceptedRevisionId, workflowRevisionId);
  assert.equal(result.aggregate.lifecycleVersion, 2);
  assert.equal((await workflowService.getCurrentTaskPackWorkflowState(workflowPack.id))?.currentReviewState, "accepted");
});

scenario("complete forwards exact token and server fields without pre-read", async () => {
  const forbiddenRead = async (): Promise<never> => { throw new Error("Command must not pre-read"); };
  const service = createTaskPackApplicationService(storageFixture({
    getTaskPackAggregate: forbiddenRead, getTaskPackRevisionById: forbiddenRead,
    getTaskPackCurrentRecordById: forbiddenRead, listTaskPackRevisionReviewEvents: forbiddenRead,
    transitionTaskPackAggregateLifecycle: async input => {
      assert.deepEqual(input, {
        taskPackId: workflowPack.id, expectedLifecycleVersion: 2, transition: { type: "complete" },
        eventId: "workflow-service-3", createdAt: "2030-01-01T00:00:02.000Z",
        source: "user", actorId: null, metadata: null,
      });
      return adapter.transitionTaskPackAggregateLifecycle(input);
    },
  }), workflowRuntime);
  const result = await service.transitionTaskPackLifecycle({
    taskPackId: workflowPack.id, expectedLifecycleVersion: 2, action: "complete",
  });
  assert.equal(result.aggregate.lifecycle.state, "completed");
  assert.equal(result.aggregate.lifecycleVersion, 3);
  assert.equal(result.event.revisionId, workflowRevisionId);
  assert.equal((await workflowService.getCurrentTaskPackWorkflowState(workflowPack.id))?.lifecycle.state, "completed");
});

scenario("reopen/archive/unarchive use authoritative storage and preserve current flat reads", async () => {
  const flatBefore = await workflowService.getCurrentTaskPack(workflowPack.id);
  for (const [action, version, state] of [["reopen", 3, "active"], ["archive", 4, "archived"], ["unarchive", 5, "active"]] as const) {
    const result = await workflowService.transitionTaskPackLifecycle({ taskPackId: workflowPack.id, expectedLifecycleVersion: version, action });
    assert.equal(result.aggregate.lifecycle.state, state);
    assert.equal(result.event.revisionId, null);
    assert.ok((await workflowService.listCurrentTaskPacks()).some(pack => pack.id === workflowPack.id));
  }
  assert.equal((await workflowService.getCurrentTaskPack(workflowPack.id))?.rawTask, flatBefore?.rawTask);
});

scenario("workflow follows appended current revision and queries only its exact history", async () => {
  const edited = await workflowService.editTaskPackContent({ taskPackId: workflowPack.id,
    expectedCurrentRevisionId: workflowRevisionId, rawTask: "New current revision after review." });
  const queries: number[][] = [];
  const service = createTaskPackApplicationService({
    ...storageFixture({}),
    getTaskPackCurrentRecordById: id => adapter.getTaskPackCurrentRecordById(id),
    getTaskPackAggregate: id => adapter.getTaskPackAggregate(id),
    getTaskPackRevisionById: (id, revisionId) => adapter.getTaskPackRevisionById(id, revisionId),
    listTaskPackRevisionReviewEvents: async (id, revisionId) => {
      assert.ok(revisionId);
      queries.push([id, revisionId]);
      return adapter.listTaskPackRevisionReviewEvents(id, revisionId);
    },
  });
  const state = await service.getCurrentTaskPackWorkflowState(workflowPack.id);
  assert.equal(state?.currentRevisionId, edited.currentRevisionId);
  assert.equal(state?.acceptedRevisionId, workflowRevisionId);
  assert.equal(state?.currentReviewState, "unreviewed");
  assert.deepEqual(queries, [[workflowPack.id, edited.currentRevisionId]]);
});

const lifecycleCodes: TaskPackLifecycleStorageErrorCode[] = [
  "TASK_PACK_LIFECYCLE_NOT_FOUND", "TASK_PACK_LIFECYCLE_CONFLICT", "TASK_PACK_LIFECYCLE_VERSION_EXHAUSTED",
  "TASK_PACK_LIFECYCLE_INVALID_TRANSITION", "TASK_PACK_LIFECYCLE_STATE_INVALID", "TASK_PACK_LIFECYCLE_EVENT_EXISTS",
];
const reviewCodes: TaskPackReviewStorageErrorCode[] = [
  "TASK_PACK_REVIEW_NOT_FOUND", "TASK_PACK_REVIEW_REVISION_NOT_FOUND", "TASK_PACK_REVIEW_CONFLICT",
  "TASK_PACK_REVIEW_VERSION_EXHAUSTED", "TASK_PACK_REVIEW_INVALID_TRANSITION", "TASK_PACK_REVIEW_STATE_INVALID", "TASK_PACK_REVIEW_EVENT_EXISTS",
];
for (const code of lifecycleCodes) scenario(`lifecycle translates ${code} without storage details or retry`, async () => {
  let calls = 0;
  const storageError = new TaskPackLifecycleStorageError(code, 12, 4, 5);
  storageError.message = "private SQL constraint details";
  const service = createTaskPackApplicationService(storageFixture({
    transitionTaskPackAggregateLifecycle: async () => { calls++; throw storageError; },
  }), workflowRuntime);
  await assert.rejects(() => service.transitionTaskPackLifecycle({ taskPackId: 12, expectedLifecycleVersion: 4, action: "complete" }), error => {
    assert.ok(error instanceof TaskPackWorkflowApplicationError);
    assert.equal(error.code, code);
    assert.deepEqual(error.evidence, { taskPackId: 12, expectedLifecycleVersion: 4, actualLifecycleVersion: 5 });
    assert.doesNotMatch(error.message, /private|SQL|constraint/);
    assert.equal(Object.hasOwn(error, "cause"), false);
    return true;
  });
  assert.equal(calls, 1);
});
for (const code of reviewCodes) scenario(`review translates ${code} with safe evidence and no retry`, async () => {
  let calls = 0;
  const evidence = { taskPackId: 12, revisionId: 18, expectedLifecycleVersion: 4, actualLifecycleVersion: 5,
    expectedReviewState: "unreviewed", actualReviewState: "in_review" } as const;
  const storageError = new TaskPackReviewStorageError(code, evidence);
  storageError.message = "private driver message";
  const service = createTaskPackApplicationService(storageFixture({
    transitionTaskPackRevisionReview: async () => { calls++; throw storageError; },
  }), workflowRuntime);
  await assert.rejects(() => service.transitionTaskPackRevisionReview({ taskPackId: 12, revisionId: 18,
    expectedLifecycleVersion: 4, expectedReviewState: "unreviewed", action: "accept" }), error => {
    assert.ok(error instanceof TaskPackWorkflowApplicationError);
    assert.equal(error.code, code);
    assert.deepEqual(error.evidence, evidence);
    assert.doesNotMatch(error.message, /private|driver/);
    assert.equal(Object.hasOwn(error, "cause"), false);
    return true;
  });
  assert.equal(calls, 1);
});

scenario("workflow rejects invalid public commands and caller event authority before runtime/write", async () => {
  let calls = 0;
  const fail = (): never => { calls++; throw new Error("Must not be reached"); };
  const service = createTaskPackApplicationService(storageFixture({
    transitionTaskPackAggregateLifecycle: async () => fail(), transitionTaskPackRevisionReview: async () => fail(),
  }), { now: fail, createEventId: fail });
  const lifecycle = { taskPackId: 1, expectedLifecycleVersion: 1, action: "archive" };
  const review = { ...lifecycle, revisionId: 2, expectedReviewState: "unreviewed", action: "accept" };
  const invalidNumbers = [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, "1", null, undefined];
  const invalidLifecycle = invalidNumbers.flatMap(value => [ { ...lifecycle, taskPackId: value }, { ...lifecycle, expectedLifecycleVersion: value } ]);
  const invalidReview = invalidNumbers.flatMap(value => [ { ...review, taskPackId: value }, { ...review, revisionId: value }, { ...review, expectedLifecycleVersion: value } ]);
  for (const key of ["eventId", "createdAt", "source", "actorId", "metadata", "toState", "archivedFromState", "acceptedRevisionId"]) {
    invalidLifecycle.push({ ...lifecycle, [key]: "forbidden" });
    invalidReview.push({ ...review, [key]: "forbidden" });
  }
  for (const input of [...invalidLifecycle, { ...lifecycle, action: "accept" }]) {
    await assert.rejects(() => service.transitionTaskPackLifecycle(input as TaskPackLifecycleCommandInput),
      { code: "TASK_PACK_WORKFLOW_INVALID" });
  }
  for (const input of [...invalidReview, { ...review, action: "complete" }, { ...review, expectedReviewState: "unknown" }]) {
    await assert.rejects(() => service.transitionTaskPackRevisionReview(input as TaskPackRevisionReviewCommandInput),
      { code: "TASK_PACK_WORKFLOW_INVALID" });
  }
  for (const id of invalidNumbers) await assert.rejects(() => service.getCurrentTaskPackWorkflowState(id as number), { code: "TASK_PACK_WORKFLOW_INVALID" });
  assert.equal(calls, 0);
});

scenario("default runtime supplies fresh server UUID and canonical ISO milliseconds", async () => {
  const identities = new Set<string>();
  const service = createTaskPackApplicationService(storageFixture({
    transitionTaskPackAggregateLifecycle: async input => {
      assert.match(input.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      assert.equal(new Date(input.createdAt).toISOString(), input.createdAt);
      assert.match(input.eventId, /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/);
      identities.add(input.eventId);
      throw new TaskPackLifecycleStorageError("TASK_PACK_LIFECYCLE_NOT_FOUND");
    },
  }));
  for (let n = 0; n < 2; n++) await assert.rejects(() => service.transitionTaskPackLifecycle({ taskPackId: 999999, expectedLifecycleVersion: 1, action: "archive" }), { code: "TASK_PACK_LIFECYCLE_NOT_FOUND" });
  assert.equal(identities.size, 2);
});

scenario("noncanonical injected timestamp is rejected without mutation", async () => {
  const service = createTaskPackApplicationService(storageFixture({}), {
    now: () => "2030-01-01T00:00:00Z", createEventId: () => "test-event",
  });
  await assert.rejects(() => service.transitionTaskPackLifecycle({ taskPackId: 1, expectedLifecycleVersion: 1, action: "archive" }), TaskPackCurrentStateError);
});

scenario("workflow corrupt revision hash fails closed", async () => {
  const service = createTaskPackApplicationService(storageFixture({
    getTaskPackRevisionById: async () => ({ ...revision, rawTask: "tampered" }),
  }));
  await assert.rejects(() => service.getCurrentTaskPackWorkflowState(taskPack.id), TaskPackCurrentStateError);
});

for (const dependency of [
  "getTaskPackCurrentRecordById", "getTaskPackAggregate",
  "getTaskPackRevisionById", "listTaskPackRevisionReviewEvents",
] as const) scenario(`workflow ${dependency} operational error propagates unchanged without retry`, async () => {
  const unexpected = new Error("private SQL driver details");
  let reads = 0;
  const service = createTaskPackApplicationService(storageFixture({
    [dependency]: async () => { reads++; throw unexpected; },
  }));
  await assert.rejects(() => service.getCurrentTaskPackWorkflowState(taskPack.id), error => {
    assert.equal(error, unexpected);
    assert.equal(error instanceof TaskPackCurrentStateError, false);
    return true;
  });
  assert.equal(reads, 1);
});

scenario("workflow known current-state and review corruption errors remain classified", async () => {
  for (const known of [new TaskPackCurrentStateError(), new TaskPackCurrentStateStorageError(),
    new TaskPackReviewStorageError("TASK_PACK_REVIEW_STATE_INVALID")]) {
    const service = createTaskPackApplicationService(storageFixture({
      listTaskPackRevisionReviewEvents: async () => { throw known; },
    }));
    await assert.rejects(() => service.getCurrentTaskPackWorkflowState(taskPack.id), TaskPackCurrentStateError);
  }
});

scenario("workflow invalid aggregate and revision domain shapes remain current-state errors", async () => {
  const validAggregate = (await storageFixture({}).getTaskPackAggregate(taskPack.id))!;
  for (const overrides of [
    { getTaskPackAggregate: async () => ({ ...validAggregate, lifecycleVersion: 0 }) },
    { getTaskPackRevisionById: async () => ({ ...revision, rawTask: "" }) },
  ]) {
    await assert.rejects(() => createTaskPackApplicationService(storageFixture(overrides))
      .getCurrentTaskPackWorkflowState(taskPack.id), TaskPackCurrentStateError);
  }
});

scenario("workflow corrupt full history fails closed even with valid tail event", async () => {
  const history = await adapter.listTaskPackRevisionReviewEvents(workflowPack.id, workflowRevisionId);
  const service = createTaskPackApplicationService(storageFixture({
    listTaskPackRevisionReviewEvents: async () => history.map(event => ({ ...event, taskPackId: taskPack.id, revisionId: revision.id } )).slice(1),
  }));
  await assert.rejects(() => service.getCurrentTaskPackWorkflowState(taskPack.id), TaskPackCurrentStateError);
});

scenario("workflow missing/foreign current revision or aggregate fails closed", async () => {
  for (const overrides of [
    { getTaskPackAggregate: async () => null },
    { getTaskPackRevisionById: async () => null },
    { getTaskPackRevisionById: async () => ({ ...revision, taskPackId: taskPack.id + 1 }) },
    { getTaskPackRevisionById: async () => ({ ...revision, id: revision.id + 1 }) },
  ]) await assert.rejects(() => createTaskPackApplicationService(storageFixture(overrides)).getCurrentTaskPackWorkflowState(taskPack.id), TaskPackCurrentStateError);
});

scenario("unknown mutation failures bubble without wrapping storage internals", async () => {
  const unexpected = new Error("private SQL driver details");
  const service = createTaskPackApplicationService(storageFixture({
    transitionTaskPackAggregateLifecycle: async () => { throw unexpected; },
    transitionTaskPackRevisionReview: async () => { throw unexpected; },
  }));
  await assert.rejects(() => service.transitionTaskPackLifecycle({ taskPackId: 1, expectedLifecycleVersion: 1, action: "archive" }), error => error === unexpected);
  await assert.rejects(() => service.transitionTaskPackRevisionReview({ taskPackId: 1, revisionId: 1, expectedLifecycleVersion: 1, expectedReviewState: "unreviewed", action: "accept" }), error => error === unexpected);
});

scenario("malformed returned workflow records become application state errors", async () => {
  const service = createTaskPackApplicationService(storageFixture({
    transitionTaskPackAggregateLifecycle: async () => null as never,
    transitionTaskPackRevisionReview: async () => null as never,
  }));
  await assert.rejects(() => service.transitionTaskPackLifecycle({ taskPackId: 1, expectedLifecycleVersion: 1, action: "archive" }), { code: "TASK_PACK_LIFECYCLE_STATE_INVALID" });
  await assert.rejects(() => service.transitionTaskPackRevisionReview({ taskPackId: 1, revisionId: 1, expectedLifecycleVersion: 1, expectedReviewState: "unreviewed", action: "accept" }), { code: "TASK_PACK_REVIEW_STATE_INVALID" });
});

scenario("application error evidence omits absent and unsafe values", () => {
  const error = new TaskPackWorkflowApplicationError("TASK_PACK_REVIEW_CONFLICT", {
    taskPackId: 1, revisionId: NaN, actualLifecycleVersion: Infinity, expectedReviewState: "private SQL" as never,
  });
  assert.deepEqual(error.evidence, { taskPackId: 1 });
});

scenario("lifecycle response validation rejects valid-shaped but mismatched storage results", async () => {
  const old = (await storageFixture({}).getTaskPackAggregate(taskPack.id))!;
  const at = "2030-01-01T00:00:00.000Z";
  const valid = {
    aggregate: { ...old, lifecycle: { state: "archived", archivedFromState: "active" } as const,
      lifecycleVersion: 2, updatedAt: at, archivedAt: at },
    event: { id: "response-event", taskPackId: old.id, revisionId: null,
      eventType: "archived", fromState: "active", toState: "archived", source: "user",
      actorId: null, metadata: null, createdAt: at } as const,
  };
  for (const result of [
    { ...valid, aggregate: { ...valid.aggregate, lifecycleVersion: 3 } },
    { ...valid, event: { ...valid.event, id: "different-event" } },
    { ...valid, event: { ...valid.event, metadata: { private: "must not reach the response" } } },
    { ...valid, event: { ...valid.event, source: "system" as const } },
  ]) {
    const service = createTaskPackApplicationService(storageFixture({ transitionTaskPackAggregateLifecycle: async () => result }),
      { now: () => at, createEventId: () => "response-event" });
    await assert.rejects(() => service.transitionTaskPackLifecycle({ taskPackId: old.id, expectedLifecycleVersion: 1, action: "archive" }),
      { code: "TASK_PACK_LIFECYCLE_STATE_INVALID" });
  }
});

scenario("review response validation rejects hash, identity, version and privacy mismatches", async () => {
  const old = (await storageFixture({}).getTaskPackAggregate(taskPack.id))!;
  const at = "2030-01-01T00:00:00.000Z";
  const valid = {
    aggregate: { ...old, acceptedRevisionId: revision.id, lifecycleVersion: 2, updatedAt: at },
    revision, reviewState: "accepted" as const,
    event: { id: "response-event", taskPackId: old.id, revisionId: revision.id,
      eventType: "accepted", fromState: "unreviewed", toState: "accepted", source: "user",
      actorId: null, metadata: null, createdAt: at } as const,
  };
  for (const result of [
    { ...valid, revision: { ...revision, generatedPrompt: "tampered" } },
    { ...valid, aggregate: { ...valid.aggregate, lifecycleVersion: 3 } },
    { ...valid, event: { ...valid.event, id: "different-event" } },
    { ...valid, event: { ...valid.event, metadata: { private: "must not reach the response" } } },
    { ...valid, event: { ...valid.event, actorId: "unexpected-actor" } },
  ]) {
    const service = createTaskPackApplicationService(storageFixture({ transitionTaskPackRevisionReview: async () => result }),
      { now: () => at, createEventId: () => "response-event" });
    await assert.rejects(() => service.transitionTaskPackRevisionReview({ taskPackId: old.id, revisionId: revision.id,
      expectedLifecycleVersion: 1, expectedReviewState: "unreviewed", action: "accept" }), { code: "TASK_PACK_REVIEW_STATE_INVALID" });
  }
});

let passed = 0;
try {
  for (const entry of scenarios) {
    await entry.run();
    passed += 1;
    process.stdout.write(`PASS ${entry.name}\n`);
  }
  process.stdout.write(
    `Task Pack application service smoke passed: ${passed} scenarios.\n`,
  );
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
