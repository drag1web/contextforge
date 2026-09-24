import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Database } from "sql.js";

import {
  computeTaskPackRevisionContentHash,
  type TaskPackJsonObject,
  type TaskPackRevisionContent,
} from "../taskPacks/taskPackLifecycle.js";
import { SqliteStorageAdapter } from "./SqliteStorageAdapter.js";
import {
  TaskPackDraftStorageError,
  type MaterializeTaskPackDraftInput,
  type TaskPackDraftRecord,
  type TaskPackDraftStorageErrorCode,
} from "./types.js";

interface SmokeScenario {
  readonly name: string;
  readonly run: () => void | Promise<void>;
}

interface Fixture {
  readonly adapter: SqliteStorageAdapter;
  readonly projectId: number;
  readonly draft: TaskPackDraftRecord;
}

const scenarios: SmokeScenario[] = [];
const scenario = (name: string, run: SmokeScenario["run"]): void => {
  scenarios.push({ name, run });
};
const temporaryRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "contextforge-tp-lc-04e-b-"),
);
let fixtureCounter = 0;

function revisionContent(
  overrides: Partial<TaskPackRevisionContent> = {},
): TaskPackRevisionContent {
  return {
    sourceKind: "generated",
    rawTask: "Materialize this persisted draft atomically.",
    taskType: "tests",
    targetTool: "codex",
    generatedPrompt: "Implement only the bounded storage transaction.",
    generationMode: "template",
    generationModel: null,
    generationMessage: "Generated safely.",
    generationUsedFallback: false,
    generationDurationMs: 42,
    generationRecipe: {
      template: { id: "default", name: "Default" },
      counts: { enabledRules: 1 },
    },
    diagnostics: {
      selector: { selectedPathCount: 2 },
      generation: { attempts: 1 },
      performance: { operationCount: 4 },
    },
    groundedContextSnapshot: null,
    freshnessBasis: null,
    ...overrides,
  };
}

function compatibilityRecipe(): TaskPackJsonObject {
  return {
    template: { id: "default", name: "Default" },
    counts: { enabledRules: 1 },
    selectorDiagnostics: { selectedPathCount: 2 },
    generationDiagnostics: { attempts: 1 },
    performanceDiagnostics: { operationCount: 4 },
  };
}

function materializeInput(
  draft: TaskPackDraftRecord,
  overrides: Partial<MaterializeTaskPackDraftInput> = {},
): MaterializeTaskPackDraftInput {
  return {
    draftId: draft.id,
    expectedDraftVersion: draft.draftVersion,
    title: "Atomic draft materialization",
    revisionContent: revisionContent(),
    generatedAt: "2026-01-01T00:00:00.000Z",
    compatibilityGenerationRecipe: compatibilityRecipe(),
    ...overrides,
  };
}

async function createFixture(label: string): Promise<Fixture> {
  fixtureCounter += 1;
  const adapter = new SqliteStorageAdapter(
    path.join(temporaryRoot, `${fixtureCounter}-${label}.sqlite`),
  );
  await adapter.ensureSchema();
  const project = await adapter.upsertScannedProject({
    name: `Materialization ${label}`,
    localPath: path.join(temporaryRoot, `project-${fixtureCounter}-${label}`),
    packageManager: "npm",
    detectedStack: ["typescript"],
    scripts: { build: "tsc" },
    readinessScore: 100,
    readinessReport: { score: 100, checks: [], issues: [] },
  });
  const draft = await adapter.createTaskPackDraft({
    id: `draft-${fixtureCounter}-${label}`,
    projectId: project.id,
    taskPackId: null,
    baseRevisionId: null,
    content: {
      rawTask: "Materialize this persisted draft atomically.",
      taskType: "tests",
      targetTool: "codex",
      templateId: "default",
      ruleProfileId: null,
      enabledRuleIds: ["safe-edit"],
      customRulesText: "Keep the transaction bounded.",
      acceptanceCriteriaPresetId: null,
      acceptanceCriteriaText: "No partial rows survive.",
      clarifications: [{ question: "Scope?", answer: "Storage only." }],
      performanceSessionId: "session-materialization",
      understandingSnapshotId: null,
      reviewedUnderstandingSnapshotId: null,
    },
    expiresAt: "2027-01-01T00:00:00.000Z",
  });
  return { adapter, projectId: project.id, draft };
}

function rawDatabase(adapter: SqliteStorageAdapter): Database {
  const db = (adapter as unknown as { db: Database | null }).db;
  assert.ok(db);
  return db;
}

function rows(db: Database, sql: string): Record<string, unknown>[] {
  const statement = db.prepare(sql);
  try {
    const result: Record<string, unknown>[] = [];
    while (statement.step()) result.push(statement.getAsObject());
    return result;
  } finally {
    statement.free();
  }
}

function scalar(db: Database, sql: string): number {
  return Number(rows(db, sql)[0]?.value ?? 0);
}

function counts(db: Database): { taskPacks: number; revisions: number } {
  return {
    taskPacks: scalar(db, "SELECT COUNT(*) AS value FROM task_packs;"),
    revisions: scalar(db, "SELECT COUNT(*) AS value FROM task_pack_revisions;"),
  };
}

function foreignKeysEnabled(db: Database): number {
  const row = rows(db, "PRAGMA foreign_keys;")[0] ?? {};
  return Number(Object.values(row)[0] ?? 0);
}

async function expectDraftError(
  operation: Promise<unknown>,
  code: TaskPackDraftStorageErrorCode,
): Promise<void> {
  await assert.rejects(operation, (error: unknown) => {
    assert.ok(error instanceof TaskPackDraftStorageError);
    assert.equal((error as TaskPackDraftStorageError<TaskPackDraftStorageErrorCode>).code, code);
    return true;
  });
}

async function assertRollback(
  label: string,
  triggerSql: string,
): Promise<void> {
  const fixture = await createFixture(label);
  const db = rawDatabase(fixture.adapter);
  const beforeDraft = await fixture.adapter.getTaskPackDraftById(fixture.draft.id);
  const beforeCounts = counts(db);
  db.run(triggerSql);
  await assert.rejects(
    fixture.adapter.materializeTaskPackDraft(materializeInput(fixture.draft)),
  );
  db.run(`DROP TRIGGER rollback_${label};`);
  assert.deepEqual(counts(db), beforeCounts);
  assert.deepEqual(
    await fixture.adapter.getTaskPackDraftById(fixture.draft.id),
    beforeDraft,
  );
  assert.equal(foreignKeysEnabled(db), 1);
}

scenario("successful materialization creates the active aggregate projection", async () => {
  const fixture = await createFixture("aggregate");
  const result = await fixture.adapter.materializeTaskPackDraft(
    materializeInput(fixture.draft),
  );
  const aggregate = await fixture.adapter.getTaskPackAggregate(result.taskPack.id);
  assert.ok(aggregate);
  assert.equal(aggregate.projectId, fixture.projectId);
  assert.equal(aggregate.lifecycle.state, "active");
  assert.equal(aggregate.lifecycleVersion, 1);
  assert.equal(aggregate.currentRevisionId, result.revision.id);
  assert.equal(aggregate.acceptedRevisionId, null);
});

scenario("Revision 1 has generated identity, ownership, and canonical content hash", async () => {
  const fixture = await createFixture("revision");
  const input = materializeInput(fixture.draft);
  const result = await fixture.adapter.materializeTaskPackDraft(input);
  assert.equal(result.revision.taskPackId, result.taskPack.id);
  assert.equal(result.revision.revisionNumber, 1);
  assert.equal(result.revision.baseRevisionId, null);
  assert.equal(result.revision.sourceKind, "generated");
  assert.equal(result.revision.generatedAt, input.generatedAt);
  assert.equal(
    result.revision.contentHash,
    computeTaskPackRevisionContentHash(input.revisionContent),
  );
});

scenario("terminal draft binds to the aggregate/revision without changing content or expiry", async () => {
  const fixture = await createFixture("draft-binding");
  const result = await fixture.adapter.materializeTaskPackDraft(
    materializeInput(fixture.draft),
  );
  assert.equal(result.draft.taskPackId, result.taskPack.id);
  assert.equal(result.draft.baseRevisionId, null);
  assert.deepEqual(result.draft.lifecycle, {
    state: "materialized",
    materializedRevisionId: result.revision.id,
  });
  assert.equal(result.draft.draftVersion, fixture.draft.draftVersion + 1);
  assert.deepEqual(result.draft.content, fixture.draft.content);
  assert.equal(result.draft.expiresAt, fixture.draft.expiresAt);
  assert.ok(Date.parse(result.draft.updatedAt) > Date.parse(fixture.draft.updatedAt));
});

scenario("flat recipe and immutable semantic evidence remain separate", async () => {
  const fixture = await createFixture("projection");
  const input = materializeInput(fixture.draft);
  const result = await fixture.adapter.materializeTaskPackDraft(input);
  assert.deepEqual(result.taskPack.generationRecipe, input.compatibilityGenerationRecipe);
  assert.deepEqual(
    result.revision.generationRecipe,
    input.revisionContent.generationRecipe,
  );
  assert.deepEqual(result.revision.diagnostics, input.revisionContent.diagnostics);
  assert.notDeepEqual(result.taskPack.generationRecipe, result.revision.generationRecipe);
});

scenario("stale expected version fails before creating aggregate or revision", async () => {
  const fixture = await createFixture("stale");
  const db = rawDatabase(fixture.adapter);
  const before = counts(db);
  await fixture.adapter.updateTaskPackDraft({
    draftId: fixture.draft.id,
    expectedDraftVersion: fixture.draft.draftVersion,
    content: { ...fixture.draft.content, rawTask: "A newer saved draft." },
  });
  const current = await fixture.adapter.getTaskPackDraftById(fixture.draft.id);
  await expectDraftError(
    fixture.adapter.materializeTaskPackDraft(materializeInput(fixture.draft)),
    "TASK_PACK_DRAFT_CONFLICT",
  );
  assert.deepEqual(counts(db), before);
  assert.deepEqual(await fixture.adapter.getTaskPackDraftById(fixture.draft.id), current);
});

scenario("discarded draft is not materialized", async () => {
  const fixture = await createFixture("discarded");
  const db = rawDatabase(fixture.adapter);
  const discarded = await fixture.adapter.discardTaskPackDraft({
    draftId: fixture.draft.id,
    expectedDraftVersion: fixture.draft.draftVersion,
  });
  const before = counts(db);
  await expectDraftError(
    fixture.adapter.materializeTaskPackDraft(materializeInput(discarded)),
    "TASK_PACK_DRAFT_NOT_EDITABLE",
  );
  assert.deepEqual(counts(db), before);
});

scenario("maximum safe draft version fails before mutation", async () => {
  const fixture = await createFixture("exhausted");
  const db = rawDatabase(fixture.adapter);
  db.run("UPDATE task_pack_drafts SET draft_version = ? WHERE id = ?;", [
    Number.MAX_SAFE_INTEGER,
    fixture.draft.id,
  ]);
  const maximum = (await fixture.adapter.getTaskPackDraftById(fixture.draft.id))!;
  const before = counts(db);
  await expectDraftError(
    fixture.adapter.materializeTaskPackDraft(materializeInput(maximum)),
    "TASK_PACK_DRAFT_VERSION_EXHAUSTED",
  );
  assert.deepEqual(counts(db), before);
  assert.deepEqual(await fixture.adapter.getTaskPackDraftById(maximum.id), maximum);
});

scenario("legitimately aggregate-bound active draft rejects first materialization", async () => {
  const fixture = await createFixture("bound-base");
  const existing = await fixture.adapter.createTaskPack({
    projectId: fixture.projectId,
    title: "Existing aggregate",
    rawTask: "Existing aggregate task.",
    taskType: "tests",
    targetTool: "codex",
    generatedPrompt: "Existing aggregate prompt.",
    generationMode: "template",
    generationModel: null,
    generationMessage: null,
    generationUsedFallback: false,
    generationDurationMs: 1,
    generationRecipe: null,
  });
  const aggregate = await fixture.adapter.getTaskPackAggregate(existing.id);
  assert.ok(aggregate);
  const bound = await fixture.adapter.createTaskPackDraft({
    id: "legitimate-bound-draft",
    projectId: fixture.projectId,
    taskPackId: existing.id,
    baseRevisionId: aggregate.currentRevisionId,
    content: fixture.draft.content,
    expiresAt: null,
  });
  const db = rawDatabase(fixture.adapter);
  const before = counts(db);
  await expectDraftError(
    fixture.adapter.materializeTaskPackDraft(materializeInput(bound)),
    "TASK_PACK_DRAFT_ALREADY_BOUND",
  );
  assert.deepEqual(counts(db), before);
  assert.deepEqual(await fixture.adapter.getTaskPackDraftById(bound.id), bound);
});

scenario("project deletion cascades the draft and reports not found without artifacts", async () => {
  const fixture = await createFixture("project-cascade");
  const db = rawDatabase(fixture.adapter);
  db.run("DELETE FROM projects WHERE id = ?;", [fixture.projectId]);
  const before = counts(db);
  await expectDraftError(
    fixture.adapter.materializeTaskPackDraft(materializeInput(fixture.draft)),
    "TASK_PACK_DRAFT_NOT_FOUND",
  );
  assert.deepEqual(counts(db), before);
  assert.equal(await fixture.adapter.getTaskPackDraftById(fixture.draft.id), null);
});

scenario("SQLite contains an explicit project existence guard", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src", "storage", "SqliteStorageAdapter.ts"),
    "utf8",
  );
  const method = source.split("async materializeTaskPackDraft")[1]!
    .split("async listTaskPacks")[0]!;
  assert.ok(method.includes("SELECT id FROM projects WHERE id = ?;"));
  assert.ok(method.includes("TASK_PACK_DRAFT_PROJECT_NOT_FOUND"));
});

scenario("failure before Revision 1 insertion rolls aggregate back", async () => {
  await assertRollback(
    "revision_insert",
    `CREATE TRIGGER rollback_revision_insert
     BEFORE INSERT ON task_pack_revisions
     BEGIN SELECT RAISE(ABORT, 'revision insert blocked'); END;`,
  );
});

scenario("failure after revision insertion at pointer update rolls everything back", async () => {
  await assertRollback(
    "pointer_update",
    `CREATE TRIGGER rollback_pointer_update
     BEFORE UPDATE OF current_revision_id ON task_packs
     BEGIN SELECT RAISE(ABORT, 'pointer update blocked'); END;`,
  );
});

scenario("failure at terminal draft CAS rolls aggregate and revision back", async () => {
  await assertRollback(
    "draft_cas",
    `CREATE TRIGGER rollback_draft_cas
     BEFORE UPDATE OF lifecycle_state, task_pack_id, materialized_revision_id
     ON task_pack_drafts
     BEGIN SELECT RAISE(ABORT, 'draft CAS blocked'); END;`,
  );
});

scenario("controlled generatedAt precedes storage-created timestamp", async () => {
  const fixture = await createFixture("timestamps");
  const input = materializeInput(fixture.draft, {
    generatedAt: "2020-01-01T00:00:00.000Z",
  });
  const result = await fixture.adapter.materializeTaskPackDraft(input);
  assert.equal(result.revision.generatedAt, input.generatedAt);
  assert.ok(Date.parse(result.revision.createdAt) >= Date.parse(input.generatedAt));
  assert.equal(result.taskPack.createdAt, result.revision.createdAt);
});

scenario("SQLite foreign keys remain enabled after successful materialization", async () => {
  const fixture = await createFixture("foreign-keys-success");
  await fixture.adapter.materializeTaskPackDraft(materializeInput(fixture.draft));
  assert.equal(foreignKeysEnabled(rawDatabase(fixture.adapter)), 1);
});

scenario("second materialization is terminal and creates no additional rows", async () => {
  const fixture = await createFixture("second-call");
  const first = await fixture.adapter.materializeTaskPackDraft(
    materializeInput(fixture.draft),
  );
  const db = rawDatabase(fixture.adapter);
  const before = counts(db);
  await expectDraftError(
    fixture.adapter.materializeTaskPackDraft(materializeInput(first.draft)),
    "TASK_PACK_DRAFT_NOT_EDITABLE",
  );
  assert.deepEqual(counts(db), before);
});

scenario("non-generated revision source is rejected before mutation", async () => {
  const fixture = await createFixture("source-kind");
  const db = rawDatabase(fixture.adapter);
  const before = counts(db);
  await expectDraftError(
    fixture.adapter.materializeTaskPackDraft(
      materializeInput(fixture.draft, {
        revisionContent: revisionContent({ sourceKind: "manual_edit" }),
      }),
    ),
    "TASK_PACK_DRAFT_STATE_INVALID",
  );
  assert.deepEqual(counts(db), before);
  assert.deepEqual(await fixture.adapter.getTaskPackDraftById(fixture.draft.id), fixture.draft);
});

scenario("invalid revision content is rejected before mutation", async () => {
  const fixture = await createFixture("invalid-content");
  const db = rawDatabase(fixture.adapter);
  const before = counts(db);
  await assert.rejects(
    fixture.adapter.materializeTaskPackDraft(
      materializeInput(fixture.draft, {
        revisionContent: revisionContent({ rawTask: "" }),
      }),
    ),
  );
  assert.deepEqual(counts(db), before);
  assert.deepEqual(await fixture.adapter.getTaskPackDraftById(fixture.draft.id), fixture.draft);
});

scenario("SQLite source proves authoritative project and both affected-row checks", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src", "storage", "SqliteStorageAdapter.ts"),
    "utf8",
  );
  const method = source.split("async materializeTaskPackDraft")[1]!
    .split("async listTaskPacks")[0]!;
  assert.ok(method.includes("current.projectId"));
  assert.equal(method.includes("input.projectId"), false);
  assert.ok(method.includes("current_revision_id IS NULL"));
  assert.ok(method.includes("materialized_revision_id IS NULL"));
  assert.ok((method.match(/SELECT changes\(\) AS changed/g) ?? []).length >= 2);
});

scenario("PostgreSQL source preserves lock, transaction, ownership, and CAS parity", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src", "storage", "PostgresStorageAdapter.ts"),
    "utf8",
  );
  const method = source.split("async materializeTaskPackDraft")[1]!
    .split("async listTaskPacks")[0]!;
  const ordered = [
    'client.query("BEGIN")',
    "SELECT * FROM task_pack_drafts WHERE id = $1 FOR UPDATE;",
    "SELECT id FROM projects WHERE id = $1 FOR KEY SHARE;",
    "INSERT INTO task_packs",
    "INSERT INTO task_pack_revisions",
    "SET current_revision_id = $1",
    "SET task_pack_id = $1, lifecycle_state = 'materialized'",
    'client.query("COMMIT")',
  ];
  let previous = -1;
  for (const token of ordered) {
    const index = method.indexOf(token);
    assert.ok(index > previous, token);
    previous = index;
  }
  assert.ok(method.includes("pointerUpdate.rowCount !== 1"));
  assert.ok(method.includes("draftUpdate.rowCount !== 1"));
  assert.ok(method.includes('client.query("ROLLBACK")'));
  assert.ok(method.includes("client.release()"));
  assert.ok(method.includes("current.projectId"));
  assert.equal(method.includes("input.projectId"), false);
});

try {
  for (const item of scenarios) {
    try {
      await item.run();
    } catch (error) {
      console.error(`Task Pack draft materialization smoke failed: ${item.name}`);
      throw error;
    }
  }
  console.log(
    `Task Pack draft materialization smoke passed: ${scenarios.length} scenarios`,
  );
} finally {
  const resolvedRoot = path.resolve(temporaryRoot);
  if (!resolvedRoot.startsWith(path.resolve(os.tmpdir()) + path.sep)) {
    throw new Error(
      "Refusing to remove a Task Pack draft materialization directory outside the OS temp root.",
    );
  }
  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}
