import assert from "node:assert/strict";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

import express, { Router } from "express";
import type { Database } from "sql.js";

import { SqliteStorageAdapter } from "../storage/SqliteStorageAdapter.js";
import type { TaskPackCurrentRecord, TaskPackRevisionRecord } from "../storage/types.js";
import {
  computeTaskPackRevisionContentHash,
  type TaskPackRevisionContent,
} from "../taskPacks/taskPackLifecycle.js";
import {
  createTaskPackApplicationService,
  TaskPackCurrentStateError,
  TaskPackNotEditableError,
  TaskPackNotFoundError,
  TaskPackRevisionConflictError,
} from "../taskPacks/taskPackApplicationService.js";
import {
  registerTaskPackContentEditRoute,
  type TaskPackContentEditService,
} from "./taskPacks.js";

interface SmokeScenario {
  readonly name: string;
  readonly run: () => void | Promise<void>;
}

const scenarios: SmokeScenario[] = [];
const scenario = (name: string, run: SmokeScenario["run"]) =>
  scenarios.push({ name, run });
const temporaryRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "contextforge-tp-lc-03d-"),
);

function revisionContent(revision: TaskPackRevisionRecord): TaskPackRevisionContent {
  return {
    sourceKind: revision.sourceKind,
    rawTask: revision.rawTask,
    taskType: revision.taskType,
    targetTool: revision.targetTool,
    generatedPrompt: revision.generatedPrompt,
    generationMode: revision.generationMode,
    generationModel: revision.generationModel,
    generationMessage: revision.generationMessage,
    generationUsedFallback: revision.generationUsedFallback,
    generationDurationMs: revision.generationDurationMs,
    generationRecipe: revision.generationRecipe,
    diagnostics: revision.diagnostics,
    groundedContextSnapshot: revision.groundedContextSnapshot,
    freshnessBasis: revision.freshnessBasis,
  };
}

function rawStoredRecipe(
  adapter: SqliteStorageAdapter,
  taskPackId: number,
): Record<string, unknown> | null {
  const db = (adapter as unknown as { db: Database | null }).db;
  assert.ok(db);
  const statement = db.prepare(
    "SELECT generation_recipe FROM task_packs WHERE id = ?;",
  );
  try {
    statement.bind([taskPackId]);
    assert.equal(statement.step(), true);
    const value = statement.getAsObject().generation_recipe;
    return value === null ? null : (JSON.parse(String(value)) as Record<string, unknown>);
  } finally {
    statement.free();
  }
}

const adapter = new SqliteStorageAdapter(
  path.join(temporaryRoot, "manual-edit.sqlite"),
);
const applicationService = createTaskPackApplicationService(adapter);
let taskPackId = 0;
let revisionOne: TaskPackRevisionRecord;
let revisionTwo: TaskPackRevisionRecord;
let currentAfterEdit: TaskPackCurrentRecord;

scenario("SQLite manual edit creates exactly one immutable revision 2", async () => {
  await adapter.ensureSchema();
  const project = await adapter.upsertScannedProject({
    name: "Manual edit fixture",
    localPath: path.join(temporaryRoot, "project"),
    packageManager: "npm",
    detectedStack: ["typescript"],
    scripts: { build: "tsc" },
    readinessScore: 100,
    readinessReport: { score: 100, checks: [], issues: [] },
  });
  const created = await applicationService.createGeneratedTaskPack({
    projectId: project.id,
    title: "Revision-safe editing",
    generatedAt: "2026-09-22T10:00:00.000Z",
    revisionContent: {
      rawTask: "Original task text",
      taskType: "tests",
      targetTool: "codex",
      generatedPrompt: "Original generated prompt",
      generationMode: "ollama",
      generationModel: "qwen-model",
      generationMessage: "Generated successfully",
      generationUsedFallback: true,
      generationDurationMs: 123,
    },
    generationRecipe: {
      template: { id: "template-1" },
      ruleProfile: { id: "profile-1" },
      enabledRules: ["rule-a"],
      customRules: ["keep tests focused"],
      acceptanceCriteriaPreset: { id: "preset-1" },
      acceptanceCriteria: ["passes"],
      counts: { enabledRules: 1 },
      githubIssue: { issueNumber: 4 },
      taskClarifications: [{ question: "Scope?", answer: "Tests" }],
      legacyUnknown: { keepOut: true },
    },
    selectorDiagnostics: { score: 91 },
    generationDiagnostics: { attempts: 1 },
    performanceDiagnostics: { totalMs: 145 },
  });
  taskPackId = created.id;
  const originalCurrent = await applicationService.getCurrentTaskPack(taskPackId);
  assert.ok(originalCurrent);
  revisionOne = (await applicationService.getCurrentTaskPackRevision(taskPackId))!;
  const revisionOneHash = revisionOne.contentHash;

  await applicationService.linkCreatedGitHubIssue({
    taskPackId,
    owner: "contextforge",
    repo: "fixture",
    fullName: "contextforge/fixture",
    issueNumber: 17,
    issueTitle: "Revision-safe edit",
    issueUrl: "https://github.com/contextforge/fixture/issues/17",
    issueState: "open",
    labels: ["task-pack"],
    repositoryUrl: "https://github.com/contextforge/fixture",
    createdAt: "2026-09-22T10:01:00.000Z",
  });

  currentAfterEdit = await applicationService.editTaskPackContent({
    taskPackId,
    expectedCurrentRevisionId: originalCurrent.currentRevisionId,
    rawTask: "Manually edited task text",
  });
  const revisions = await adapter.listTaskPackRevisions(taskPackId);
  assert.equal(revisions.length, 2);
  revisionTwo = revisions[1]!;
  assert.equal(revisionTwo.revisionNumber, 2);
  assert.equal(revisionTwo.sourceKind, "manual_edit");
  assert.equal(revisionTwo.baseRevisionId, revisionOne.id);
  assert.equal(revisionTwo.taskPackId, taskPackId);
  assert.equal(revisionTwo.generatedAt, null);
  assert.equal(currentAfterEdit.currentRevisionId, revisionTwo.id);
  const aggregate = await adapter.getTaskPackAggregate(taskPackId);
  assert.equal(aggregate?.currentRevisionId, revisionTwo.id);
  assert.equal(aggregate?.lifecycleVersion, 2);
  assert.equal(
    (await adapter.getTaskPackRevisionById(taskPackId, revisionOne.id))?.contentHash,
    revisionOneHash,
  );
});

scenario("manual revision keeps only applicable configuration provenance", () => {
  assert.equal(revisionTwo.rawTask, "Manually edited task text");
  assert.equal(revisionTwo.generatedPrompt, revisionOne.generatedPrompt);
  assert.equal(revisionTwo.taskType, revisionOne.taskType);
  assert.equal(revisionTwo.targetTool, revisionOne.targetTool);
  assert.equal(revisionTwo.generationMode, revisionOne.generationMode);
  assert.equal(revisionTwo.generationModel, null);
  assert.equal(revisionTwo.generationMessage, null);
  assert.equal(revisionTwo.generationUsedFallback, false);
  assert.equal(revisionTwo.generationDurationMs, null);
  assert.equal(revisionTwo.diagnostics, null);
  assert.equal(revisionTwo.groundedContextSnapshot, null);
  assert.equal(revisionTwo.freshnessBasis, null);
  assert.deepEqual(revisionTwo.generationRecipe, {
    template: { id: "template-1" },
    ruleProfile: { id: "profile-1" },
    enabledRules: ["rule-a"],
    customRules: ["keep tests focused"],
    acceptanceCriteriaPreset: { id: "preset-1" },
    acceptanceCriteria: ["passes"],
    counts: { enabledRules: 1 },
  });
  for (const excluded of [
    "selectorDiagnostics",
    "generationDiagnostics",
    "performanceDiagnostics",
    "githubIssue",
    "githubCreatedIssue",
    "taskClarifications",
    "legacyUnknown",
  ]) {
    assert.equal(Object.hasOwn(revisionTwo.generationRecipe!, excluded), false);
  }
});

scenario("prompt-only manual edit copies the unchanged raw task", async () => {
  const project = (await adapter.listProjects())[0]!;
  const created = await applicationService.createGeneratedTaskPack({
    projectId: project.id,
    title: "Prompt-only edit",
    generatedAt: "2026-09-22T10:03:00.000Z",
    revisionContent: {
      rawTask: "Raw task stays unchanged",
      taskType: "docs",
      targetTool: "codex",
      generatedPrompt: "Prompt before edit",
      generationMode: "template",
      generationModel: null,
      generationMessage: null,
      generationUsedFallback: false,
      generationDurationMs: 4,
    },
    generationRecipe: { template: { id: "docs" } },
    selectorDiagnostics: null,
    generationDiagnostics: null,
    performanceDiagnostics: null,
  });
  const base = (await applicationService.getCurrentTaskPackRevision(created.id))!;
  await applicationService.editTaskPackContent({
    taskPackId: created.id,
    expectedCurrentRevisionId: base.id,
    generatedPrompt: "Prompt after manual edit",
  });
  const edited = (await applicationService.getCurrentTaskPackRevision(created.id))!;
  assert.equal(edited.revisionNumber, 2);
  assert.equal(edited.rawTask, base.rawTask);
  assert.equal(edited.generatedPrompt, "Prompt after manual edit");
});

scenario("application service rejects edits to a non-active Task Pack", async () => {
  const project = (await adapter.listProjects())[0]!;
  const created = await applicationService.createGeneratedTaskPack({
    projectId: project.id,
    title: "Completed Task Pack",
    generatedAt: "2026-09-22T10:04:00.000Z",
    revisionContent: {
      rawTask: "Completed task",
      taskType: "tests",
      targetTool: "codex",
      generatedPrompt: "Completed prompt",
      generationMode: "template",
      generationModel: null,
      generationMessage: null,
      generationUsedFallback: false,
      generationDurationMs: 2,
    },
    generationRecipe: {},
    selectorDiagnostics: null,
    generationDiagnostics: null,
    performanceDiagnostics: null,
  });
  const current = (await applicationService.getCurrentTaskPack(created.id))!;
  const db = (adapter as unknown as { db: Database | null }).db;
  assert.ok(db);
  db.run(
    `UPDATE task_packs
     SET lifecycle_state = 'completed', accepted_revision_id = current_revision_id,
         completed_at = ?
     WHERE id = ?;`,
    ["2026-09-22T10:05:00.000Z", created.id],
  );
  await assert.rejects(
    () =>
      applicationService.editTaskPackContent({
        taskPackId: created.id,
        expectedCurrentRevisionId: current.currentRevisionId,
        rawTask: "Must remain unchanged",
      }),
    TaskPackNotEditableError,
  );
  assert.equal((await adapter.listTaskPackRevisions(created.id)).length, 1);
});

scenario("manual revision hash and flat compatibility projection are current", async () => {
  assert.equal(
    revisionTwo.contentHash,
    computeTaskPackRevisionContentHash(revisionContent(revisionTwo)),
  );
  assert.equal(currentAfterEdit.rawTask, revisionTwo.rawTask);
  assert.equal(currentAfterEdit.generatedPrompt, revisionTwo.generatedPrompt);
  assert.equal(currentAfterEdit.generationModel, null);
  assert.equal(currentAfterEdit.generationUsedFallback, false);
  const compatibilityRecipe = currentAfterEdit.generationRecipe as Record<string, unknown>;
  assert.ok(compatibilityRecipe.githubCreatedIssue);
  assert.equal(
    (compatibilityRecipe.githubCreatedIssue as { createdFromTaskPackId: number })
      .createdFromTaskPackId,
    taskPackId,
  );
  const storedRecipe = rawStoredRecipe(adapter, taskPackId)!;
  assert.equal(Object.hasOwn(storedRecipe, "githubCreatedIssue"), false);
  assert.deepEqual(storedRecipe, revisionTwo.generationRecipe);
});

scenario("stale editor is rejected before no-op handling", async () => {
  const revisionOneHash = revisionOne.contentHash;
  const revisionTwoHash = revisionTwo.contentHash;
  await assert.rejects(
    () =>
      applicationService.editTaskPackContent({
        taskPackId,
        expectedCurrentRevisionId: revisionOne.id,
        rawTask: revisionTwo.rawTask,
      }),
    (error: unknown) => {
      assert.ok(error instanceof TaskPackRevisionConflictError);
      assert.equal(error.taskPackId, taskPackId);
      assert.equal(error.expectedCurrentRevisionId, revisionOne.id);
      assert.equal(error.actualCurrentRevisionId, revisionTwo.id);
      return true;
    },
  );
  assert.equal((await adapter.listTaskPackRevisions(taskPackId)).length, 2);
  assert.equal(
    (await adapter.getTaskPackRevisionById(taskPackId, revisionOne.id))?.contentHash,
    revisionOneHash,
  );
  assert.equal(
    (await adapter.getTaskPackRevisionById(taskPackId, revisionTwo.id))?.contentHash,
    revisionTwoHash,
  );
  assert.equal(
    (await applicationService.getCurrentTaskPack(taskPackId))?.rawTask,
    revisionTwo.rawTask,
  );
});

scenario("current-token no-op does not create a revision or increment lifecycle", async () => {
  const before = await adapter.getTaskPackAggregate(taskPackId);
  const result = await applicationService.editTaskPackContent({
    taskPackId,
    expectedCurrentRevisionId: revisionTwo.id,
    generatedPrompt: revisionTwo.generatedPrompt,
  });
  const after = await adapter.getTaskPackAggregate(taskPackId);
  assert.equal(result.currentRevisionId, revisionTwo.id);
  assert.equal((await adapter.listTaskPackRevisions(taskPackId)).length, 2);
  assert.equal(after?.lifecycleVersion, before?.lifecycleVersion);
});

scenario("SQLite append rollback removes an inserted revision and flat mutation", async () => {
  const db = (adapter as unknown as { db: Database | null }).db;
  assert.ok(db);
  db.run(`CREATE TRIGGER tp_lc_03d_fail_pointer_update
    BEFORE UPDATE OF current_revision_id ON task_packs
    WHEN OLD.id = ${taskPackId}
    BEGIN SELECT RAISE(ABORT, 'injected append failure'); END;`);
  const beforeAggregate = await adapter.getTaskPackAggregate(taskPackId);
  const beforeFlat = await applicationService.getCurrentTaskPack(taskPackId);
  try {
    await assert.rejects(() =>
      applicationService.editTaskPackContent({
        taskPackId,
        expectedCurrentRevisionId: revisionTwo.id,
        generatedPrompt: "This transaction must roll back.",
      }),
    );
  } finally {
    db.run("DROP TRIGGER tp_lc_03d_fail_pointer_update;");
  }
  const afterAggregate = await adapter.getTaskPackAggregate(taskPackId);
  const afterFlat = await applicationService.getCurrentTaskPack(taskPackId);
  assert.equal((await adapter.listTaskPackRevisions(taskPackId)).length, 2);
  assert.equal(afterAggregate?.currentRevisionId, beforeAggregate?.currentRevisionId);
  assert.equal(afterAggregate?.lifecycleVersion, beforeAggregate?.lifecycleVersion);
  assert.deepEqual(afterFlat, beforeFlat);
});

scenario("PostgreSQL append retains transactional optimistic concurrency guards", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src", "storage", "PostgresStorageAdapter.ts"),
    "utf8",
  );
  const lockIndex = source.indexOf("FROM task_packs WHERE id = $1 FOR UPDATE");
  const staleIndex = source.indexOf(
    "aggregate.currentRevisionId !== input.baseRevisionId",
    lockIndex,
  );
  const insertIndex = source.indexOf("INSERT INTO task_pack_revisions", staleIndex);
  assert.ok(lockIndex >= 0 && staleIndex > lockIndex && insertIndex > staleIndex);
  for (const required of [
    "TASK_PACK_REVISION_CONFLICT",
    "WHERE id = $13 AND current_revision_id = $14",
    "const pointerUpdate = await client.query",
    "pointerUpdate.rowCount !== 1",
    'client.query("COMMIT")',
    'client.query("ROLLBACK")',
  ]) {
    assert.ok(source.includes(required), required);
  }
});

const routeRecord: TaskPackCurrentRecord = {
  id: 1,
  projectId: 2,
  projectName: "Route fixture",
  title: "Revision-safe route",
  rawTask: "Current task",
  taskType: "tests",
  targetTool: "codex",
  generatedPrompt: "Current prompt",
  generationMode: "template",
  generationModel: null,
  generationMessage: null,
  generationUsedFallback: false,
  generationDurationMs: null,
  generationRecipe: null,
  createdAt: "2026-09-22T10:00:00.000Z",
  updatedAt: "2026-09-22T10:02:00.000Z",
  currentRevisionId: 12,
};
let routeFailure:
  | "missing"
  | "conflict"
  | "not-editable"
  | "current-state"
  | "unexpected"
  | null = null;
let routeCalls = 0;
const routeService: TaskPackContentEditService = {
  async editTaskPackContent(input) {
    routeCalls += 1;
    if (routeFailure === "missing") throw new TaskPackNotFoundError(input.taskPackId);
    if (routeFailure === "conflict") {
      throw new TaskPackRevisionConflictError(
        input.taskPackId,
        input.expectedCurrentRevisionId,
        routeRecord.currentRevisionId,
      );
    }
    if (routeFailure === "not-editable") {
      throw new TaskPackNotEditableError(input.taskPackId);
    }
    if (routeFailure === "current-state") throw new TaskPackCurrentStateError();
    if (routeFailure === "unexpected") throw new Error("private database detail");
    assert.equal(input.taskPackId, routeRecord.id);
    assert.equal(input.expectedCurrentRevisionId, 11);
    return routeRecord;
  },
};

const app = express();
app.use(express.json());
const router = Router();
registerTaskPackContentEditRoute(router, routeService);
app.use("/api/task-packs", router);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve, reject) => {
  server.once("listening", resolve);
  server.once("error", reject);
});
const address = server.address() as AddressInfo;
const baseUrl = `http://127.0.0.1:${address.port}`;

async function patch(
  body: unknown,
  id = "1",
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}/api/task-packs/${id}/content`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

scenario("PATCH returns current compatibility projection with its new token", async () => {
  const response = await patch({
    expectedCurrentRevisionId: 11,
    rawTask: "Edited route task",
  });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ok: true, taskPack: routeRecord });
});

scenario("PATCH without a revision token returns 428 before service execution", async () => {
  const before = routeCalls;
  const response = await patch({ rawTask: "Edited route task" });
  assert.equal(response.status, 428);
  assert.deepEqual(response.body, {
    ok: false,
    code: "TASK_PACK_REVISION_REQUIRED",
    message: "The current Task Pack revision is required before editing.",
  });
  assert.equal(routeCalls, before);
});

for (const token of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "11"]) {
  scenario(`PATCH rejects invalid revision token ${String(token)}`, async () => {
    const before = routeCalls;
    const response = await patch({
      expectedCurrentRevisionId: token,
      rawTask: "Edited route task",
    });
    assert.equal(response.status, 400);
    assert.equal(routeCalls, before);
  });
}

scenario("PATCH rejects a request without editable content", async () => {
  const response = await patch({ expectedCurrentRevisionId: 11 });
  assert.equal(response.status, 400);
});

scenario("PATCH rejects an invalid Task Pack id", async () => {
  const response = await patch(
    { expectedCurrentRevisionId: 11, rawTask: "Edited route task" },
    "0",
  );
  assert.equal(response.status, 400);
});

scenario("PATCH maps missing Task Pack to 404", async () => {
  routeFailure = "missing";
  try {
    const response = await patch({
      expectedCurrentRevisionId: 11,
      rawTask: "Edited route task",
    });
    assert.equal(response.status, 404);
  } finally {
    routeFailure = null;
  }
});

scenario("PATCH conflict returns expected and actual revision identities", async () => {
  routeFailure = "conflict";
  try {
    const response = await patch({
      expectedCurrentRevisionId: 11,
      rawTask: "Edited route task",
    });
    assert.equal(response.status, 409);
    assert.deepEqual(response.body, {
      ok: false,
      code: "TASK_PACK_REVISION_CONFLICT",
      message:
        "Task Pack changed after this editor was opened. Close and reopen the editor to edit the latest revision.",
      taskPackId: 1,
      expectedCurrentRevisionId: 11,
      actualCurrentRevisionId: 12,
    });
  } finally {
    routeFailure = null;
  }
});

scenario("PATCH maps non-active Task Pack to stable 409", async () => {
  routeFailure = "not-editable";
  try {
    const response = await patch({
      expectedCurrentRevisionId: 11,
      generatedPrompt: "Edited route prompt",
    });
    assert.equal(response.status, 409);
    assert.equal(response.body.code, "TASK_PACK_NOT_EDITABLE");
  } finally {
    routeFailure = null;
  }
});

scenario("PATCH maps broken current state without leaking details", async () => {
  routeFailure = "current-state";
  try {
    const response = await patch({
      expectedCurrentRevisionId: 11,
      rawTask: "Edited route task",
    });
    assert.equal(response.status, 500);
    assert.equal(response.body.code, "TASK_PACK_CURRENT_STATE_INVALID");
  } finally {
    routeFailure = null;
  }
});

scenario("PATCH hides unexpected storage failure details", async () => {
  routeFailure = "unexpected";
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    const response = await patch({
      expectedCurrentRevisionId: 11,
      rawTask: "Edited route task",
    });
    assert.equal(response.status, 500);
    assert.equal(JSON.stringify(response.body).includes("private"), false);
  } finally {
    routeFailure = null;
    console.error = originalConsoleError;
  }
});

scenario("public PATCH route no longer calls legacy mutable storage", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src", "routes", "taskPacks.ts"),
    "utf8",
  );
  assert.equal(source.includes("storage.updateTaskPackContent("), false);
  assert.ok(source.includes("service.editTaskPackContent("));
});

let passed = 0;
try {
  for (const entry of scenarios) {
    await entry.run();
    passed += 1;
    process.stdout.write(`PASS ${entry.name}\n`);
  }
  process.stdout.write(
    `Task Pack revision-safe content edit smoke passed: ${passed} scenarios.\n`,
  );
} finally {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
