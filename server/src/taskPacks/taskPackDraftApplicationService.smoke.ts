import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { SqliteStorageAdapter } from "../storage/SqliteStorageAdapter.js";
import {
  TaskPackDraftStorageError,
  type CreateTaskPackDraftInput,
  type ProjectRecord,
} from "../storage/types.js";
import {
  createTaskPackDraftApplicationService,
  TaskPackDraftApplicationError,
  type CreateTaskPackDraftApplicationInput,
  type TaskPackDraftApplicationService,
  type TaskPackDraftApplicationServiceStorage,
} from "./taskPackDraftApplicationService.js";
import type {
  PersistedTaskPackDraft,
  TaskPackDraftContent,
} from "./taskPackLifecycle.js";

interface SmokeScenario {
  readonly name: string;
  readonly run: () => void | Promise<void>;
}

const scenarios: SmokeScenario[] = [];
const scenario = (name: string, run: SmokeScenario["run"]): void => {
  scenarios.push({ name, run });
};

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "contextforge-tp-lc-04d-service-"));
const adapter = new SqliteStorageAdapter(path.join(temporaryRoot, "draft-service.sqlite"));
const service = createTaskPackDraftApplicationService(adapter);

function content(rawTask = "Persist this author text.\r\nExactly."): TaskPackDraftContent {
  return {
    rawTask,
    taskType: "tests",
    targetTool: "codex",
    templateId: null,
    ruleProfileId: null,
    enabledRuleIds: ["safe-edit"],
    customRulesText: "  preserve authored spacing  ",
    acceptanceCriteriaPresetId: null,
    acceptanceCriteriaText: "Keep the draft private.",
    clarifications: [{ question: "Scope?", answer: "" }],
    performanceSessionId: null,
    understandingSnapshotId: null,
    reviewedUnderstandingSnapshotId: null,
  };
}

const projectFixture: ProjectRecord = {
  id: 41,
  name: "Draft project",
  localPath: "C:/private/not-serialized",
  packageManager: "npm",
  detectedStack: ["typescript"],
  scripts: {},
  readinessScore: 100,
  readinessReport: { score: 100, checks: [], issues: [] },
  createdAt: "2026-09-24T08:00:00.000Z",
  updatedAt: "2026-09-24T08:00:00.000Z",
  lastScanAt: null,
};

const draftFixture: PersistedTaskPackDraft = {
  id: "draft-fixture",
  projectId: projectFixture.id,
  taskPackId: null,
  baseRevisionId: null,
  content: content(),
  lifecycle: { state: "active", materializedRevisionId: null },
  draftVersion: 1,
  createdAt: "2026-09-24T08:00:00.000Z",
  updatedAt: "2026-09-24T08:00:00.000Z",
  expiresAt: null,
};

function fakeStorage(
  overrides: Partial<TaskPackDraftApplicationServiceStorage> = {},
): TaskPackDraftApplicationServiceStorage {
  return {
    async listActiveTaskPackDrafts() { return [draftFixture]; },
    async getTaskPackDraftById(draftId) { return draftId === draftFixture.id ? draftFixture : null; },
    async createTaskPackDraft(input) { return { ...draftFixture, id: input.id }; },
    async updateTaskPackDraft() { return { ...draftFixture, draftVersion: 2 }; },
    async discardTaskPackDraft() {
      return {
        ...draftFixture,
        lifecycle: { state: "discarded", materializedRevisionId: null },
        draftVersion: 2,
      };
    },
    async getProjectById(projectId) { return projectId === projectFixture.id ? projectFixture : null; },
    ...overrides,
  };
}

async function expectApplicationError(
  run: Promise<unknown>,
  code: TaskPackDraftApplicationError["code"],
  check?: (error: TaskPackDraftApplicationError) => void,
): Promise<void> {
  await assert.rejects(run, (error: unknown) => {
    assert.ok(error instanceof TaskPackDraftApplicationError);
    assert.equal(error.code, code);
    check?.(error);
    return true;
  });
}

let projectId = 0;
let firstDraftId = "";

scenario("SQLite fixture creates a project without a Task Pack", async () => {
  await adapter.ensureSchema();
  const project = await adapter.upsertScannedProject({
    name: "Persisted draft service",
    localPath: path.join(temporaryRoot, "project"),
    packageManager: "npm",
    detectedStack: ["typescript"],
    scripts: {},
    readinessScore: 100,
    readinessReport: { score: 100, checks: [], issues: [] },
  });
  projectId = project.id;
});

scenario("create owns opaque identity, expiresAt null, and reconstructs projectName", async () => {
  const created = await service.createDraft({
    projectId,
    taskPackId: null,
    baseRevisionId: null,
    content: content(),
  });
  firstDraftId = created.id;
  assert.ok(created.id.length > 0);
  assert.equal(created.projectName, "Persisted draft service");
  assert.equal(created.expiresAt, null);
  assert.equal(created.draftVersion, 1);
  assert.deepEqual(created.lifecycle, { state: "active", materializedRevisionId: null });
  assert.equal(created.content.rawTask, "Persist this author text.\r\nExactly.");
});

scenario("create input has no caller-owned id and service exposes no materialize operation", () => {
  const createInputHasId: "id" extends keyof CreateTaskPackDraftApplicationInput ? true : false = false;
  const serviceHasMaterialize: "materializeDraft" extends keyof TaskPackDraftApplicationService ? true : false = false;
  assert.equal(createInputHasId, false);
  assert.equal(serviceHasMaterialize, false);
  assert.equal("materializeDraft" in service, false);
});

scenario("create always forwards a generated id and expiresAt null", async () => {
  const captured: { value: CreateTaskPackDraftInput | null } = { value: null };
  const isolated = createTaskPackDraftApplicationService(fakeStorage({
    async createTaskPackDraft(input) {
      captured.value = input;
      return { ...draftFixture, id: input.id, expiresAt: input.expiresAt };
    },
  }));
  const created = await isolated.createDraft({
    projectId: projectFixture.id,
    taskPackId: null,
    baseRevisionId: null,
    content: content(),
  });
  assert.ok(captured.value);
  assert.equal(captured.value.id, created.id);
  assert.equal(captured.value.expiresAt, null);
  assert.notEqual(captured.value.id, firstDraftId);
});

scenario("active discovery returns multiple privacy-safe summaries", async () => {
  const second = await service.createDraft({
    projectId,
    taskPackId: null,
    baseRevisionId: null,
    content: content("Second persisted draft."),
  });
  const drafts = await service.listActiveDrafts();
  assert.equal(drafts.length, 2);
  assert.ok(drafts.some((draft) => draft.id === firstDraftId));
  assert.ok(drafts.some((draft) => draft.id === second.id));
  assert.ok(drafts.every((draft) => draft.projectName === "Persisted draft service"));
  assert.ok(drafts.every((draft) => !("content" in draft)));
  assert.equal(JSON.stringify(drafts).includes("rawTask"), false);
  assert.equal(JSON.stringify(drafts).includes("clarifications"), false);
});

scenario("active discovery preserves the project filter", async () => {
  const drafts = await service.listActiveDrafts(projectId);
  assert.equal(drafts.length, 2);
  assert.ok(drafts.every((draft) => draft.projectId === projectId));
});

scenario("detail returns full content plus projectName and missing returns null", async () => {
  const found = await service.getDraft(firstDraftId);
  assert.equal(found?.projectName, "Persisted draft service");
  assert.deepEqual(found?.content, content());
  assert.equal(await service.getDraft("missing-draft"), null);
});

scenario("update increments version while semantic no-op preserves version and timestamp", async () => {
  const current = (await service.getDraft(firstDraftId))!;
  const updated = await service.updateDraft({
    draftId: current.id,
    expectedDraftVersion: current.draftVersion,
    content: content("Updated draft author text."),
  });
  assert.equal(updated.draftVersion, current.draftVersion + 1);
  const noOp = await service.updateDraft({
    draftId: updated.id,
    expectedDraftVersion: updated.draftVersion,
    content: updated.content,
  });
  assert.equal(noOp.draftVersion, updated.draftVersion);
  assert.equal(noOp.updatedAt, updated.updatedAt);
});

scenario("discard returns the terminal persisted draft", async () => {
  const current = (await service.getDraft(firstDraftId))!;
  const discarded = await service.discardDraft({
    draftId: current.id,
    expectedDraftVersion: current.draftVersion,
  });
  assert.equal(discarded.lifecycle.state, "discarded");
  assert.equal(discarded.draftVersion, current.draftVersion + 1);
});

scenario("conflict translation preserves expected and actual versions", async () => {
  const conflict = createTaskPackDraftApplicationService(fakeStorage({
    async updateTaskPackDraft(input) {
      throw new TaskPackDraftStorageError(
        "TASK_PACK_DRAFT_CONFLICT",
        input.draftId,
        input.expectedDraftVersion,
        input.expectedDraftVersion + 1,
      );
    },
  }));
  await expectApplicationError(
    conflict.updateDraft({
      draftId: draftFixture.id,
      expectedDraftVersion: 4,
      content: content(),
    }),
    "TASK_PACK_DRAFT_CONFLICT",
    (error) => {
      assert.equal(error.draftId, draftFixture.id);
      assert.equal(error.expectedDraftVersion, 4);
      assert.equal(error.actualDraftVersion, 5);
    },
  );
});

scenario("storage error vocabulary is translated without leaking storage messages", async () => {
  const cases = [
    "TASK_PACK_DRAFT_NOT_FOUND",
    "TASK_PACK_DRAFT_NOT_EDITABLE",
    "TASK_PACK_DRAFT_VERSION_EXHAUSTED",
    "TASK_PACK_DRAFT_PROJECT_NOT_FOUND",
    "TASK_PACK_DRAFT_TASK_PACK_NOT_FOUND",
    "TASK_PACK_DRAFT_OWNERSHIP_INVALID",
    "TASK_PACK_DRAFT_BASE_REVISION_INVALID",
    "TASK_PACK_DRAFT_STATE_INVALID",
  ] as const;
  for (const code of cases) {
    const translated = createTaskPackDraftApplicationService(fakeStorage({
      async updateTaskPackDraft(input) {
        throw new TaskPackDraftStorageError(
          code,
          input.draftId,
          input.expectedDraftVersion,
          input.expectedDraftVersion,
          code === "TASK_PACK_DRAFT_NOT_EDITABLE" ? "discarded" : undefined,
        );
      },
    }));
    await expectApplicationError(
      translated.updateDraft({
        draftId: draftFixture.id,
        expectedDraftVersion: 1,
        content: content(),
      }),
      code,
    );
  }
});

scenario("server-generated identity collision fails closed as invalid state", async () => {
  const collision = createTaskPackDraftApplicationService(fakeStorage({
    async createTaskPackDraft(input) {
      throw new TaskPackDraftStorageError("TASK_PACK_DRAFT_ALREADY_EXISTS", input.id);
    },
  }));
  await expectApplicationError(
    collision.createDraft({
      projectId: projectFixture.id,
      taskPackId: null,
      baseRevisionId: null,
      content: content(),
    }),
    "TASK_PACK_DRAFT_STATE_INVALID",
  );
});

scenario("malformed storage state fails closed", async () => {
  const malformed = createTaskPackDraftApplicationService(fakeStorage({
    async getTaskPackDraftById() {
      throw new TaskPackDraftStorageError("TASK_PACK_DRAFT_STATE_INVALID", draftFixture.id);
    },
  }));
  await expectApplicationError(
    malformed.getDraft(draftFixture.id),
    "TASK_PACK_DRAFT_STATE_INVALID",
  );
});

scenario("missing project projection for an existing draft fails closed", async () => {
  const missingProject = createTaskPackDraftApplicationService(fakeStorage({
    async getProjectById() { return null; },
  }));
  await expectApplicationError(
    missingProject.getDraft(draftFixture.id),
    "TASK_PACK_DRAFT_STATE_INVALID",
  );
  await expectApplicationError(
    missingProject.listActiveDrafts(),
    "TASK_PACK_DRAFT_STATE_INVALID",
  );
});

scenario("invalid identities and versions are rejected before storage writes", async () => {
  let mutations = 0;
  const guarded = createTaskPackDraftApplicationService(fakeStorage({
    async createTaskPackDraft(input) { mutations += 1; return { ...draftFixture, id: input.id }; },
    async updateTaskPackDraft() { mutations += 1; return draftFixture; },
    async discardTaskPackDraft() { mutations += 1; return draftFixture; },
  }));
  for (const projectIdValue of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await expectApplicationError(
      guarded.createDraft({
        projectId: projectIdValue,
        taskPackId: null,
        baseRevisionId: null,
        content: content(),
      }),
      "TASK_PACK_DRAFT_INVALID",
    );
  }
  await expectApplicationError(
    guarded.createDraft({
      projectId: 1,
      taskPackId: null,
      baseRevisionId: 2,
      content: content(),
    }),
    "TASK_PACK_DRAFT_INVALID",
  );
  await expectApplicationError(
    guarded.updateDraft({ draftId: " ", expectedDraftVersion: 1, content: content() }),
    "TASK_PACK_DRAFT_INVALID",
  );
  await expectApplicationError(
    guarded.updateDraft({ draftId: "draft", expectedDraftVersion: 0, content: content() }),
    "TASK_PACK_DRAFT_INVALID",
  );
  await expectApplicationError(
    guarded.discardDraft({ draftId: "draft", expectedDraftVersion: 1.5 }),
    "TASK_PACK_DRAFT_INVALID",
  );
  assert.equal(mutations, 0);
});

scenario("unexpected storage failures remain unexpected for privacy-safe route handling", async () => {
  const unexpected = new Error("private database constraint text");
  const failing = createTaskPackDraftApplicationService(fakeStorage({
    async listActiveTaskPackDrafts() { throw unexpected; },
  }));
  await assert.rejects(failing.listActiveDrafts(), (error) => error === unexpected);
});

let passed = 0;
try {
  for (const entry of scenarios) {
    await entry.run();
    passed += 1;
    process.stdout.write(`PASS ${entry.name}\n`);
  }
  process.stdout.write(`Task Pack draft application-service smoke passed: ${passed} scenarios.\n`);
} finally {
  const resolved = path.resolve(temporaryRoot);
  if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) {
    throw new Error("Refusing to remove a draft smoke directory outside the OS temp root.");
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}
