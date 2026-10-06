import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Database } from "sql.js";
import type { TaskPackRecord } from "../storage/types.js";
import { assertTaskPackRevision } from "../taskPacks/taskPackLifecycle.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "contextforge-cloud-import-")), originalCwd = process.cwd();
process.env.STORAGE_DRIVER = "sqlite";
process.env.SQLITE_DB_PATH = path.join(root, "import.sqlite");
process.chdir(root);
const { storage } = await import("../storage/index.js");
const { taskPacksRouter } = await import("./taskPacks.js");
const { deriveTaskPackRevisionReviewState } = await import("../storage/taskPackLifecyclePersistence.js");
let scenarios = 0;
async function scenario(name: string, run: () => void | Promise<void>) {
  await run(); scenarios++; process.stdout.write(`PASS ${name}\n`);
}
type ResponseBody = { ok: boolean; imported?: boolean; taskPack?: TaskPackRecord; source?: Record<string, unknown>; message?: string };
const app = express(); app.use(express.json()); app.use("/api/task-packs", taskPacksRouter);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/task-packs`;
const original = fs.readFileSync(new URL("./taskPacks.ts", import.meta.url), "utf8");
try {
  await storage.ensureSchema();
  const project = await storage.upsertScannedProject({ name: "Synthetic receiving project", localPath: path.join(root, "project"),
    packageManager: null, detectedStack: [], scripts: {}, readinessScore: 0, readinessReport: { score: 0, checks: [], issues: [] } });
  const requestBody = (deliveryId = "22222222-2222-4222-8222-222222222222") => ({ projectId: project.id, deliveryId,
    source: { taskPackId: "11111111-1111-4111-8111-111111111111", originInstallationId: "cf-origin-a", projectName: "Synthetic origin" },
    taskPack: { title: "Imported fixture", rawTask: "Import the bounded task.", taskType: "general", targetTool: "generic", generatedPrompt: "Read and review." } });
  async function post(body: unknown) {
    const response = await fetch(`${base}/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() as ResponseBody };
  }
  async function assertImported(taskPack: TaskPackRecord, deliveryId: string) {
    const aggregate = (await storage.getTaskPackAggregate(taskPack.id))!;
    assert.deepEqual(aggregate.lifecycle, { state: "active", archivedFromState: null });
    assert.equal(aggregate.acceptedRevisionId, null); assert.equal(aggregate.lifecycleVersion, 1);
    assert.equal(aggregate.completedAt, null); assert.equal(aggregate.archivedAt, null);
    const revisions = await storage.listTaskPackRevisions(taskPack.id);
    assert.equal(revisions.length, 1);
    const revision = revisions[0];
    assert.equal(revision.id, aggregate.currentRevisionId); assert.equal(revision.taskPackId, aggregate.id);
    assert.equal(revision.revisionNumber, 1); assert.equal(revision.baseRevisionId, null); assert.equal(revision.sourceKind, "imported");
    assert.equal(revision.generationMessage, `ContextForge cloud handoff:${deliveryId}`);
    assert.equal(taskPack.generationMessage, revision.generationMessage); assert.equal(revision.generationRecipe, null);
    assertTaskPackRevision(revision, { aggregate, verifyContentHash: true });
    const events = await storage.listTaskPackRevisionReviewEvents(taskPack.id, revision.id);
    assert.deepEqual(events, []); assert.deepEqual(await storage.listTaskPackAggregateLifecycleEvents(taskPack.id), []);
    assert.equal(deriveTaskPackRevisionReviewState(aggregate, revision, events), "unreviewed");
    for (const object of [taskPack, aggregate, revision]) {
      assert.equal(Object.hasOwn(object, "originTaskPackId"), false); assert.equal(Object.hasOwn(object, "originRevisionId"), false);
    }
  }
  const legacy = requestBody();
  await scenario("legacy real HTTP import creates one active aggregate/imported revision 1 with no events", async () => {
    const result = await post(legacy);
    assert.equal(result.status, 201); assert.equal(result.body.imported, true);
    assert.deepEqual(result.body.source, legacy.source);
    await assertImported(result.body.taskPack!, legacy.deliveryId);
  });
  const aware = { ...requestBody("33333333-3333-4333-8333-333333333333"),
    source: { ...legacy.source, originTaskPackId: 17, originRevisionId: 41 } };
  await scenario("revision-aware real HTTP import preserves source pair only at boundary, same initial storage semantics", async () => {
    const result = await post(aware);
    assert.equal(result.status, 201); assert.equal(result.body.imported, true); assert.deepEqual(result.body.source, aware.source);
    await assertImported(result.body.taskPack!, aware.deliveryId);
  });
  for (const input of [legacy, aware]) {
    await scenario(`${input === legacy ? "legacy" : "revision-aware"} delivery retry is idempotent and writes nothing`, async () => {
      const before = await storage.getWorkspaceBackupSnapshot();
      const result = await post(input);
      assert.equal(result.status, 200); assert.equal(result.body.imported, false);
      assert.deepEqual(await storage.getWorkspaceBackupSnapshot(), before);
    });
  }
  await scenario("deliveryId remains authority when retry changes origin tuple", async () => {
    const before = await storage.getWorkspaceBackupSnapshot();
    const result = await post({ ...aware, source: { ...aware.source, originInstallationId: "cf-origin-b", originRevisionId: 42 } });
    assert.equal(result.status, 200); assert.equal(result.body.imported, false);
    assert.deepEqual(await storage.getWorkspaceBackupSnapshot(), before);
  });
  await scenario("same origin tuple with a different delivery is not deduplicated", async () => {
    const input = { ...aware, deliveryId: "44444444-4444-4444-8444-444444444444" };
    const result = await post(input);
    assert.equal(result.status, 201); assert.equal(result.body.imported, true);
    await assertImported(result.body.taskPack!, input.deliveryId);
    assert.equal((await storage.listTaskPacks()).length, 3);
  });
  await scenario("new IDs accept positive safe integer boundaries without coercion", async () => {
    const input = { ...requestBody("55555555-5555-4555-8555-555555555555"),
      source: { ...legacy.source, originTaskPackId: 1, originRevisionId: Number.MAX_SAFE_INTEGER } };
    const result = await post(input);
    assert.equal(result.status, 201); assert.deepEqual(result.body.source, input.source);
    await assertImported(result.body.taskPack!, input.deliveryId);
  });
  const invalidSources: Record<string, unknown>[] = [
    { ...legacy.source, originTaskPackId: 17 }, { ...legacy.source, originRevisionId: 41 },
    ...[0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, null, "17"].map(originTaskPackId => ({ ...legacy.source, originTaskPackId, originRevisionId: 41 })),
    ...[0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, null, "41"].map(originRevisionId => ({ ...legacy.source, originTaskPackId: 17, originRevisionId })),
    { taskPackId: legacy.source.taskPackId }, { originInstallationId: "cf-origin-a" },
    { ...legacy.source, originInstallationId: "" }, { ...legacy.source, taskPackId: "not-a-uuid" }
  ];
  for (const [index, source] of invalidSources.entries()) {
    await scenario(`invalid/partial source ${index + 1} returns 400 and leaves all relational records unchanged`, async () => {
      const before = await storage.getWorkspaceBackupSnapshot();
      const result = await post({ ...legacy, source });
      assert.equal(result.status, 400); assert.equal(result.body.message, "Invalid cloud Task Pack import");
      assert.deepEqual(await storage.getWorkspaceBackupSnapshot(), before);
    });
  }
  await scenario("delivery UUID validation and target-project 404 remain unchanged", async () => {
    const before = await storage.getWorkspaceBackupSnapshot();
    for (const deliveryId of ["", "invalid", null]) assert.equal((await post({ ...legacy, deliveryId })).status, 400);
    assert.equal((await post({ ...legacy, projectId: 999999 })).status, 404);
    assert.deepEqual(await storage.getWorkspaceBackupSnapshot(), before);
  });
  await scenario("source omitted projectName still defaults as before", async () => {
    const result = await post({ ...requestBody("66666666-6666-4666-8666-666666666666"),
      source: { taskPackId: legacy.source.taskPackId, originInstallationId: legacy.source.originInstallationId } });
    assert.equal(result.status, 201); assert.equal(result.body.source!.projectName, "");
  });
  await scenario("actual current read route still returns the imported current projection", async () => {
    const packs = await storage.listTaskPacks();
    const response = await fetch(`${base}/${packs[0].id}`);
    assert.equal(response.status, 200);
    const body = await response.json() as { taskPack: { id: number; currentRevisionId: number } };
    assert.equal(body.taskPack.id, packs[0].id); assert.ok(Number.isSafeInteger(body.taskPack.currentRevisionId));
  });
  await scenario("route source keeps exact marker, delivery lookup and null recipe, never persists source identity", () => {
    const route = original.slice(original.indexOf('taskPacksRouter.post("/import"'), original.indexOf('taskPacksRouter.post("/:id/github/issue"'));
    assert.match(route, /const importMarker = `ContextForge cloud handoff:\$\{deliveryId\}`/);
    assert.match(route, /candidate\.generationMessage === importMarker/);
    const create = route.slice(route.indexOf("storage.createTaskPack({"), route.indexOf("res.status(201)"));
    assert.match(create, /generationRecipe: null/); assert.doesNotMatch(create, /originTaskPackId|originRevisionId|source\./);
    assert.doesNotMatch(route, /transitionTaskPack|appendTaskPack|accept|complete/);
  });
  process.stdout.write(`Task Pack cloud import smoke passed: ${scenarios} scenarios (real HTTP router + real isolated SQLite).\n`);
} finally {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  (storage as unknown as { db: Database | null }).db?.close();
  process.chdir(originalCwd); fs.rmSync(root, { recursive: true, force: true });
}
