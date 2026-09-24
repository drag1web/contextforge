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
} from "../storage/types.js";
import {
  TaskPackCurrentStateStorageError,
  TaskPackRevisionAppendStorageError,
} from "../storage/types.js";
import {
  createTaskPackApplicationService,
  TaskPackCurrentStateError,
  TaskPackGeneratedCreateInputError,
  TaskPackRevisionConflictError,
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
