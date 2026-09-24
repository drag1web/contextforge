import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { SqliteStorageAdapter } from "../storage/SqliteStorageAdapter.js";
import type { TaskPackJsonObject, TaskPackRevisionContent } from "./taskPackLifecycle.js";
import { computeTaskPackRevisionContentHash } from "./taskPackLifecycle.js";
import {
  createTaskPackApplicationService,
  TaskPackGeneratedCreateInputError,
} from "./taskPackApplicationService.js";

interface SmokeScenario {
  readonly name: string;
  readonly run: () => void | Promise<void>;
}

const scenarios: SmokeScenario[] = [];
const scenario = (name: string, run: SmokeScenario["run"]) =>
  scenarios.push({ name, run });
const temporaryRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "contextforge-tp-lc-03e-"),
);
const adapter = new SqliteStorageAdapter(
  path.join(temporaryRoot, "generated-create.sqlite"),
);
const service = createTaskPackApplicationService(adapter);

let projectId = 0;
let generatedTaskPackId = 0;
const generatedAt = new Date(Date.now() - 1_000).toISOString();

scenario("SQLite atomically creates a generated aggregate and Revision 1", async () => {
  await adapter.ensureSchema();
  const project = await adapter.upsertScannedProject({
    name: "Generated create fixture",
    localPath: path.join(temporaryRoot, "project"),
    packageManager: "npm",
    detectedStack: ["typescript"],
    scripts: { build: "tsc" },
    readinessScore: 100,
    readinessReport: { score: 100, checks: [], issues: [] },
  });
  projectId = project.id;

  const created = await service.createGeneratedTaskPack({
    projectId,
    title: "Atomic generated Task Pack",
    generatedAt,
    revisionContent: {
      rawTask: "Create a complete immutable initial revision.",
      taskType: "implementation",
      targetTool: "codex",
      generatedPrompt: "Implement the bounded atomic create path.",
      generationMode: "ollama",
      generationModel: "fixture-model",
      generationMessage: "Generated successfully",
      generationUsedFallback: false,
      generationDurationMs: 37,
    },
    generationRecipe: {
      template: { id: "template-1", name: "Default" },
      enabledRules: ["bounded"],
      optionalMetadata: undefined,
    },
    selectorDiagnostics: {
      engine: "legacy",
      selectedCount: 2,
      optionalReason: undefined,
    },
    generationDiagnostics: {
      attempts: 1,
      usedFallback: false,
      optionalWarning: undefined,
    },
    performanceDiagnostics: {
      requestCount: 1,
      totalMs: 18,
      optionalStage: undefined,
    },
  });
  generatedTaskPackId = created.id;

  const aggregate = await adapter.getTaskPackAggregate(created.id);
  const revisions = await adapter.listTaskPackRevisions(created.id);
  assert.ok(aggregate);
  assert.equal(revisions.length, 1);
  const revision = revisions[0]!;
  assert.equal(revision.revisionNumber, 1);
  assert.equal(revision.baseRevisionId, null);
  assert.equal(revision.sourceKind, "generated");
  assert.equal(revision.taskPackId, aggregate.id);
  assert.equal(aggregate.currentRevisionId, revision.id);
  assert.equal(revision.generatedAt, generatedAt);
  assert.ok(generatedAt <= revision.createdAt);
});

scenario("Revision 1 stores complete JSON-safe immutable provenance", async () => {
  const revision = (await adapter.listTaskPackRevisions(generatedTaskPackId))[0]!;
  assert.deepEqual(revision.generationRecipe, {
    template: { id: "template-1", name: "Default" },
    enabledRules: ["bounded"],
  });
  for (const key of [
    "selectorDiagnostics",
    "generationDiagnostics",
    "performanceDiagnostics",
  ]) {
    assert.equal(Object.hasOwn(revision.generationRecipe!, key), false);
  }
  assert.deepEqual(revision.diagnostics, {
    selector: { engine: "legacy", selectedCount: 2 },
    generation: { attempts: 1, usedFallback: false },
    performance: { requestCount: 1, totalMs: 18 },
  });
  assert.equal(revision.groundedContextSnapshot, null);
  assert.equal(revision.freshnessBasis, null);
  const {
    id: _id,
    taskPackId: _taskPackId,
    revisionNumber: _revisionNumber,
    baseRevisionId: _baseRevisionId,
    contentHash: _contentHash,
    createdAt: _createdAt,
    generatedAt: _generatedAt,
    ...revisionContent
  } = revision;
  assert.equal(
    revision.contentHash,
    computeTaskPackRevisionContentHash(revisionContent),
  );
});

scenario("flat projection retains the existing compatibility recipe", async () => {
  const flat = await adapter.getTaskPackById(generatedTaskPackId);
  const current = await service.getCurrentTaskPack(generatedTaskPackId);
  const revision = await service.getCurrentTaskPackRevision(generatedTaskPackId);
  assert.ok(flat);
  assert.ok(current);
  assert.ok(revision);
  assert.deepEqual(flat.generationRecipe, {
    template: { id: "template-1", name: "Default" },
    enabledRules: ["bounded"],
    selectorDiagnostics: { engine: "legacy", selectedCount: 2 },
    generationDiagnostics: { attempts: 1, usedFallback: false },
    performanceDiagnostics: { requestCount: 1, totalMs: 18 },
  });
  for (const field of [
    "rawTask",
    "taskType",
    "targetTool",
    "generatedPrompt",
    "generationMode",
    "generationModel",
    "generationMessage",
    "generationUsedFallback",
    "generationDurationMs",
  ] as const) {
    assert.deepEqual(flat[field], revision[field], field);
  }
  assert.equal(current.currentRevisionId, revision.id);
});

scenario("unsupported JSON values are rejected before storage", async () => {
  await assert.rejects(
    () =>
      service.createGeneratedTaskPack({
        projectId,
        title: "Invalid JSON",
        generatedAt,
        revisionContent: {
          rawTask: "Reject unsupported JSON.",
          taskType: "tests",
          targetTool: "codex",
          generatedPrompt: "Reject unsupported JSON.",
          generationMode: "template",
          generationModel: null,
          generationMessage: null,
          generationUsedFallback: false,
          generationDurationMs: null,
        },
        generationRecipe: { invalid: BigInt(1) },
        selectorDiagnostics: null,
        generationDiagnostics: null,
        performanceDiagnostics: null,
      }),
    TaskPackGeneratedCreateInputError,
  );
  assert.equal((await adapter.listTaskPacks()).length, 1);
});

scenario("SQLite rolls back a failed initial revision insert", async () => {
  const beforeTaskPacks = await adapter.listTaskPacks();
  const beforeRevisionCounts = await Promise.all(
    beforeTaskPacks.map(async (taskPack) =>
      (await adapter.listTaskPackRevisions(taskPack.id)).length,
    ),
  );
  const validRevision = await service.getCurrentTaskPackRevision(generatedTaskPackId);
  assert.ok(validRevision);
  const invalidContent: TaskPackRevisionContent = {
    sourceKind: "generated",
    rawTask: "Rollback invalid provenance.",
    taskType: "tests",
    targetTool: "codex",
    generatedPrompt: "This row must roll back.",
    generationMode: "template",
    generationModel: null,
    generationMessage: null,
    generationUsedFallback: false,
    generationDurationMs: null,
    generationRecipe: { policy: "rollback" },
    diagnostics: {
      selector: { invalid: undefined } as unknown as TaskPackJsonObject,
      generation: null,
      performance: null,
    },
    groundedContextSnapshot: null,
    freshnessBasis: null,
  };
  await assert.rejects(() =>
    adapter.createTaskPackWithInitialRevision({
      projectId,
      title: "Rolled back Task Pack",
      revisionContent: invalidContent,
      generatedAt,
      compatibilityGenerationRecipe: { policy: "rollback" },
    }),
  );
  const afterTaskPacks = await adapter.listTaskPacks();
  const afterRevisionCounts = await Promise.all(
    afterTaskPacks.map(async (taskPack) =>
      (await adapter.listTaskPackRevisions(taskPack.id)).length,
    ),
  );
  assert.deepEqual(
    afterTaskPacks.map((taskPack) => taskPack.id),
    beforeTaskPacks.map((taskPack) => taskPack.id),
  );
  assert.deepEqual(afterRevisionCounts, beforeRevisionCounts);
});

scenario("legacy and imported create behavior remains available", async () => {
  const legacy = await adapter.createTaskPack({
    projectId,
    title: "Legacy create",
    rawTask: "Keep the legacy create boundary.",
    taskType: "compatibility",
    targetTool: "codex",
    generatedPrompt: "Keep compatibility.",
    generationMode: "template",
    generationModel: null,
    generationMessage: null,
    generationUsedFallback: false,
    generationRecipe: null,
  });
  assert.equal((await adapter.getCurrentTaskPackRevision(legacy.id))?.sourceKind, "generated");

  const imported = await adapter.createTaskPack({
    projectId,
    title: "Imported create",
    rawTask: "Keep imported source identity.",
    taskType: "import",
    targetTool: "codex",
    generatedPrompt: "Imported prompt.",
    generationMode: "template",
    generationModel: null,
    generationMessage: "ContextForge cloud handoff:fixture-delivery",
    generationUsedFallback: false,
    generationRecipe: null,
  });
  const importedRevision = await adapter.getCurrentTaskPackRevision(imported.id);
  assert.equal(importedRevision?.sourceKind, "imported");
  assert.equal(importedRevision?.generatedAt, null);
});

scenario("generated Revision 1 rejects created-issue workflow metadata", async () => {
  await assert.rejects(
    () =>
      service.createGeneratedTaskPack({
        projectId,
        title: "Invalid created issue metadata",
        generatedAt,
        revisionContent: {
          rawTask: "Reject workflow metadata from immutable provenance.",
          taskType: "tests",
          targetTool: "codex",
          generatedPrompt: "Keep created issue linkage aggregate-owned.",
          generationMode: "template",
          generationModel: null,
          generationMessage: null,
          generationUsedFallback: false,
          generationDurationMs: null,
        },
        generationRecipe: {
          githubCreatedIssue: { issueNumber: 1 },
        },
        selectorDiagnostics: null,
        generationDiagnostics: null,
        performanceDiagnostics: null,
      }),
    TaskPackGeneratedCreateInputError,
  );
});

scenario("generated Revision 1 retains GitHub source-issue provenance", async () => {
  const created = await service.createGeneratedTaskPack({
    projectId,
    title: "GitHub source provenance",
    generatedAt,
    revisionContent: {
      rawTask: "Generate from an existing source issue.",
      taskType: "implementation",
      targetTool: "codex",
      generatedPrompt: "Preserve source provenance.",
      generationMode: "template",
      generationModel: null,
      generationMessage: null,
      generationUsedFallback: false,
      generationDurationMs: null,
    },
    generationRecipe: {
      githubIssue: {
        type: "github-issue",
        owner: "fixture",
        repo: "source",
        issueNumber: 7,
      },
    },
    selectorDiagnostics: null,
    generationDiagnostics: null,
    performanceDiagnostics: null,
  });
  assert.deepEqual(
    (await service.getCurrentTaskPackRevision(created.id))?.generationRecipe,
    {
      githubIssue: {
        type: "github-issue",
        owner: "fixture",
        repo: "source",
        issueNumber: 7,
      },
    },
  );
});

scenario("generated pipeline separates preparation from one ordinary-create persistence", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src", "routes", "taskPacks.ts"),
    "utf8",
  );
  const preparation = source
    .split("export async function prepareTaskPackWithPipeline")[1]!
    .split("export async function createTaskPackWithPipeline")[0]!;
  const wrapper = source
    .split("export async function createTaskPackWithPipeline")[1]!
    .split('taskPacksRouter.post("/"')[0]!;
  assert.ok(preparation.includes("const generatedAt = new Date().toISOString()"));
  assert.equal(
    preparation.includes("taskPackApplicationService.createGeneratedTaskPack"),
    false,
  );
  assert.ok(
    wrapper.includes("await prepareTaskPackWithPipeline(input)"),
  );
  assert.ok(
    wrapper.includes("taskPackApplicationService.createGeneratedTaskPack"),
  );
  assert.equal(
    source.match(/taskPackApplicationService\.createGeneratedTaskPack/gu)?.length,
    1,
  );
  assert.equal(preparation.includes("storage.createTaskPack({"), false);
  assert.equal(wrapper.includes("storage.createTaskPack({"), false);
  assert.equal(
    preparation.includes("storage.updateTaskPackGenerationRecipe"),
    false,
  );
  assert.equal(wrapper.includes("storage.updateTaskPackGenerationRecipe"), false);
  assert.equal(preparation.includes('"task_pack_storage"'), false);
  assert.equal(wrapper.includes('"task_pack_storage"'), false);
  assert.ok(
    wrapper.indexOf("taskPackApplicationService.createGeneratedTaskPack") >
      wrapper.indexOf("await prepareTaskPackWithPipeline(input)"),
  );
});

scenario("PostgreSQL atomic create has transaction and JSONB parity", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src", "storage", "PostgresStorageAdapter.ts"),
    "utf8",
  );
  const operation = source
    .split("async createTaskPackWithInitialRevision")[1]!
    .split("async updateTaskPackGenerationRecipe")[0]!;
  for (const required of [
    'client.query("BEGIN")',
    "INSERT INTO task_packs",
    "INSERT INTO task_pack_revisions",
    "diagnostics, grounded_context_snapshot, freshness_basis",
    "$13::jsonb, $14::jsonb, $15::jsonb",
    "SET current_revision_id = $1",
    'client.query("COMMIT")',
    'client.query("ROLLBACK")',
    "computeTaskPackRevisionContentHash(content)",
    "assertTaskPackRevision(revision",
  ]) {
    assert.ok(operation.includes(required), required);
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
    `Task Pack generated-create smoke passed: ${passed} scenarios.\n`,
  );
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
