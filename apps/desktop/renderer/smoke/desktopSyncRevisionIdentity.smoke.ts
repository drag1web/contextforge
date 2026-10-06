import assert from "node:assert/strict";
import fs from "node:fs";
import { importCloudTaskPack } from "../src/api/client";
import { getDesktopSyncPublishOriginIdentity, getDesktopSyncImportOriginIdentity } from "../src/utils/desktopSyncTaskPackIdentity";
import type { TaskPack } from "../src/types";
import type { DesktopSyncCloudTaskPack } from "../src/types/desktopSync";

let scenarios = 0;
async function scenario(name: string, run: () => void | Promise<void>) {
  await run(); scenarios++; process.stdout.write(`PASS ${name}\n`);
}
const pack: TaskPack = { id: 17, currentRevisionId: 41, projectId: 2, projectName: "Synthetic project",
  title: "Synthetic Task Pack", rawTask: "Task", taskType: "general", targetTool: "generic", generatedPrompt: "Prompt",
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
const cloud: DesktopSyncCloudTaskPack = { id: "11111111-1111-4111-8111-111111111111", originInstallationId: "cf-origin-a",
  sourceTaskPackId: "17", title: "Synthetic Task Pack", projectName: "Synthetic project", rawTask: "Task", taskType: "general",
  targetTool: "generic", generatedPrompt: "Prompt", contentHash: "a".repeat(64), contentBytes: 6, integrityValid: true,
  sourceCreatedAt: null, createdAt: null, updatedAt: null };
const source = (relative: string) => fs.readFileSync(new URL(`../src/${relative}`, import.meta.url), "utf8");
const page = source("pages/TaskPacksPage.tsx"), types = source("types/desktopSync.ts"), helper = source("utils/desktopSyncTaskPackIdentity.ts");
const publish = page.slice(page.indexOf("async function handlePublish("), page.indexOf("return (", page.indexOf("async function handlePublish(")));
const importItem = page.slice(page.indexOf("async function importItem("), page.indexOf("async function reportIntegrityFailure("));

await scenario("current flat projection supplies exact aggregate/revision IDs, not project identity", () => {
  assert.deepEqual(getDesktopSyncPublishOriginIdentity(pack), { originTaskPackId: 17, originRevisionId: 41 });
  assert.deepEqual(getDesktopSyncPublishOriginIdentity({ ...pack, currentRevisionId: 42 }), { originTaskPackId: 17, originRevisionId: 42 });
});
await scenario("legacy projection without currentRevisionId emits neither new field", () => {
  const legacy = { ...pack }; delete legacy.currentRevisionId;
  assert.deepEqual(getDesktopSyncPublishOriginIdentity(legacy), {});
});
await scenario("unavailable/invalid current revision never causes fabricated origin identity", () => {
  for (const currentRevisionId of [undefined, null, 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "41"]) {
    assert.deepEqual(getDesktopSyncPublishOriginIdentity({ id: 17, currentRevisionId } as unknown as TaskPack), {});
  }
  assert.deepEqual(getDesktopSyncPublishOriginIdentity({ id: 17, currentRevisionId: Number.MAX_SAFE_INTEGER }),
    { originTaskPackId: 17, originRevisionId: Number.MAX_SAFE_INTEGER });
});
await scenario("page publish uses the tested helper and keeps sourceTaskPackId plus bounded current body", () => {
  assert.match(publish, /bridge\.publishTaskPack\(\{\s*sourceTaskPackId: String\(taskPack\.id\),\s*\.\.\.getDesktopSyncPublishOriginIdentity\(taskPack\)/);
  for (const field of ["rawTask", "taskType", "targetTool", "generatedPrompt"]) assert.ok(publish.includes(`${field}: taskPack.${field}`));
  assert.match(publish, /sourceCreatedAt: taskPack\.createdAt/);
  assert.doesNotMatch(publish, /originInstallationId|\.\.\.taskPack\b|generationRecipe|diagnostics|localPath|fetch\(|getTaskPackRevisionHistory|getTaskPackRevisionDetail/);
});
await scenario("legacy inbox source omits pair while revision-aware source preserves origin numbers", () => {
  assert.deepEqual(getDesktopSyncImportOriginIdentity(cloud), {});
  assert.deepEqual(getDesktopSyncImportOriginIdentity({ ...cloud, originTaskPackId: 17, originRevisionId: 41 }),
    { originTaskPackId: 17, originRevisionId: 41 });
});
await scenario("malformed incoming pair fails instead of silently becoming legacy", () => {
  for (const pair of [{ originTaskPackId: 17 }, { originRevisionId: 41 }, { originTaskPackId: null, originRevisionId: 41 },
    { originTaskPackId: 17, originRevisionId: "41" }, { originTaskPackId: 0, originRevisionId: 41 },
    { originTaskPackId: 17, originRevisionId: Number.MAX_SAFE_INTEGER + 1 }]) {
    assert.throws(() => getDesktopSyncImportOriginIdentity(pair as unknown as DesktopSyncCloudTaskPack), /Invalid Task Pack origin identity/);
  }
});
await scenario("page import forwards the tested pair with cloud UUID and installation, never local IDs", () => {
  assert.match(importItem, /source: \{\s*taskPackId: item\.taskPack\.id,\s*originInstallationId: item\.taskPack\.originInstallationId,\s*projectName: item\.taskPack\.projectName,\s*\.\.\.getDesktopSyncImportOriginIdentity\(item\.taskPack\)/);
  assert.match(importItem, /deliveryId: item\.delivery\.id/);
  assert.match(importItem, /acknowledgeTaskPack\(item\.delivery\.id, "imported"/);
});
await scenario("upload type adds only optional numeric pair, never caller-controlled installation", () => {
  const upload = types.slice(types.indexOf("export interface DesktopSyncTaskPackUpload"), types.indexOf("export interface DesktopSyncCloudTaskPack"));
  assert.match(upload, /originTaskPackId\?: number/); assert.match(upload, /originRevisionId\?: number/);
  assert.doesNotMatch(upload, /originInstallationId|payloadVersion|protocolVersion|syncVersion/);
});
await scenario("pure helper has no network/history/controller/mutation dependency", () => {
  assert.doesNotMatch(helper, /fetch\(|api\/|getTaskPackRevisionHistory|getTaskPackRevisionDetail|storage|setInterval|setTimeout|window/);
});

const originalFetch = globalThis.fetch;
try {
  const requests: { url: string; method: string; body: Record<string, unknown> }[] = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), method: init?.method ?? "GET", body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ ok: true, imported: true, taskPack: pack }), { headers: { "Content-Type": "application/json" } });
  };
  for (const revisionAware of [false, true]) {
    await scenario(`real API client forwards ${revisionAware ? "revision-aware" : "legacy"} source in one import POST`, async () => {
      requests.length = 0;
      const item = revisionAware ? { ...cloud, originTaskPackId: 17, originRevisionId: 41 } : cloud;
      const input = { projectId: 2, deliveryId: "22222222-2222-4222-8222-222222222222",
        source: { taskPackId: item.id, originInstallationId: item.originInstallationId, projectName: item.projectName,
          ...getDesktopSyncImportOriginIdentity(item) },
        taskPack: { title: item.title, rawTask: item.rawTask, taskType: item.taskType, targetTool: item.targetTool, generatedPrompt: item.generatedPrompt } };
      assert.deepEqual(await importCloudTaskPack(input), { taskPack: pack, imported: true });
      assert.deepEqual(requests, [{ url: "http://localhost:4000/api/task-packs/import", method: "POST", body: input }]);
      assert.equal(Object.hasOwn(input.source, "originTaskPackId"), revisionAware);
      assert.equal(Object.hasOwn(input.source, "originRevisionId"), revisionAware);
    });
  }
} finally { globalThis.fetch = originalFetch; }
process.stdout.write(`Desktop Sync renderer revision identity smoke passed: ${scenarios} scenarios (pure helper, real API client, narrow page wiring).\n`);
