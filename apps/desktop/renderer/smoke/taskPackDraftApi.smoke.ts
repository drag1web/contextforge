import assert from "node:assert/strict";

import {
  ApiRequestError,
  createTaskPackDraft,
  discardTaskPackDraft,
  getTaskPackDraft,
  listActiveTaskPackDrafts,
  materializeTaskPackDraft,
  updateTaskPackDraft,
} from "../src/api/client";
import type {
  CreateTaskPackDraftRequest,
  MaterializeTaskPackDraftResponse,
  TaskPackPersistedDraftView,
  UpdateTaskPackDraftRequest,
} from "../src/types";

const draft: TaskPackPersistedDraftView = {
  id: "opaque /?#% черновик",
  projectId: 3,
  projectName: "Local project",
  taskPackId: null,
  baseRevisionId: null,
  lifecycle: { state: "active", materializedRevisionId: null },
  draftVersion: 4,
  createdAt: "2026-09-23T10:00:00.000Z",
  updatedAt: "2026-09-23T11:00:00.000Z",
  expiresAt: null,
  content: {
    rawTask: "  task\r\ntext  ", taskType: "general", targetTool: "codex",
    templateId: null, ruleProfileId: "", enabledRuleIds: ["b", "a", "b"],
    customRulesText: "  rule\r\nrule", acceptanceCriteriaPresetId: null,
    acceptanceCriteriaText: "", clarifications: [{ question: "question?", answer: "" }],
    performanceSessionId: null, understandingSnapshotId: null, reviewedUnderstandingSnapshotId: null,
  },
};

const { content: _content, ...summary } = draft;
const encodedId = encodeURIComponent(draft.id);
const apiRoot = "http://localhost:4000/api";
const originalFetch = globalThis.fetch;
let pendingReply: { status: number; body: unknown } | null = null;
let calls: { url: string; method: string; headers: Headers; body: unknown }[] = [];
let scenarios = 0;

// Exercise the actual client and request() error surface, with no server or network.
globalThis.fetch = async (input, options) => {
  assert.ok(pendingReply, "Unexpected HTTP request");
  const reply = pendingReply;
  pendingReply = null;
  calls.push({
    url: String(input),
    method: options?.method ?? "GET",
    headers: new Headers(options?.headers),
    body: options?.body === undefined ? undefined : JSON.parse(String(options.body)),
  });
  return new Response(JSON.stringify(reply.body), {
    status: reply.status,
    headers: { "Content-Type": "application/json" },
  });
};

async function scenario(name: string, run: () => Promise<void>) {
  calls = [];
  pendingReply = null;
  await run();
  assert.equal(pendingReply, null, "Expected request was not made");
  assert.equal(calls.length, 1, "Client must not retry or perform extra requests");
  scenarios += 1;
  process.stdout.write(`PASS ${name}\n`);
}

function reply(body: unknown, status = 200) { pendingReply = { body, status }; }
function assertRequest(path: string, method = "GET", body?: unknown) {
  assert.equal(calls[0].url, `${apiRoot}${path}`);
  assert.equal(calls[0].method, method);
  assert.equal(calls[0].headers.get("Content-Type"), "application/json");
  assert.deepEqual(calls[0].body, body);
}

try {
  await scenario("list all active drafts returns content-free summaries", async () => {
    reply({ ok: true, drafts: [summary] });
    assert.deepEqual(await listActiveTaskPackDrafts(), [summary]);
    assertRequest("/task-pack-drafts?state=active");
    assert.equal(Object.hasOwn(summary, "content"), false);
  });

  await scenario("list by project uses the active query and project filter", async () => {
    reply({ ok: true, drafts: [] });
    assert.deepEqual(await listActiveTaskPackDrafts(3), []);
    assertRequest("/task-pack-drafts?state=active&projectId=3");
  });

  await scenario("detail accepts and encodes an opaque non-UUID draft ID", async () => {
    reply({ ok: true, draft });
    assert.deepEqual(await getTaskPackDraft(draft.id), draft);
    assertRequest(`/task-pack-drafts/${encodedId}`);
  });

  await scenario("create sends exactly the outer contract with full lossless content", async () => {
    reply({ ok: true, draft }, 201);
    const body: CreateTaskPackDraftRequest = {
      projectId: 3, taskPackId: null, baseRevisionId: null, content: draft.content,
    };
    const withExtraMetadata = { ...body, id: "must-not-send", draftVersion: 99, expiresAt: "must-not-send" };
    assert.deepEqual(await createTaskPackDraft(withExtraMetadata), draft);
    assertRequest("/task-pack-drafts", "POST", body);
  });

  await scenario("generic create preserves caller-provided aggregate/base binding", async () => {
    const body: CreateTaskPackDraftRequest = {
      projectId: 3, taskPackId: 7, baseRevisionId: 8, content: draft.content,
    };
    const result = { ...draft, taskPackId: 7, baseRevisionId: 8 };
    reply({ ok: true, draft: result }, 201);
    assert.deepEqual(await createTaskPackDraft(body), result);
    assertRequest("/task-pack-drafts", "POST", body);
  });

  await scenario("PATCH sends full content and token, encoding the draft ID", async () => {
    reply({ ok: true, draft });
    const body: UpdateTaskPackDraftRequest = { expectedDraftVersion: 4, content: draft.content };
    const withExtraMetadata = { ...body, projectId: 999, lifecycle: "must-not-send" };
    assert.deepEqual(await updateTaskPackDraft(draft.id, withExtraMetadata), draft);
    assertRequest(`/task-pack-drafts/${encodedId}`, "PATCH", body);
  });

  await scenario("no-op PATCH returns the unchanged version without client increment", async () => {
    reply({ ok: true, draft });
    const result = await updateTaskPackDraft(draft.id, { expectedDraftVersion: 4, content: draft.content });
    assert.equal(result.draftVersion, 4);
    assert.equal(result.updatedAt, draft.updatedAt);
  });

  await scenario("discard sends only the version and returns terminal full view", async () => {
    const discarded = { ...draft, draftVersion: 5, lifecycle: { state: "discarded", materializedRevisionId: null } };
    reply({ ok: true, draft: discarded });
    assert.deepEqual(await discardTaskPackDraft(draft.id, 4), discarded);
    assertRequest(`/task-pack-drafts/${encodedId}/discard`, "POST", { expectedDraftVersion: 4 });
  });

  await scenario("materialize sends ONLY expectedDraftVersion and retains the full success envelope", async () => {
    const result: MaterializeTaskPackDraftResponse = {
      ok: true,
      taskPack: {
        id: 11, currentRevisionId: 12, projectId: 3, projectName: draft.projectName,
        title: "Generated", rawTask: draft.content.rawTask, taskType: "general", targetTool: "codex",
        generatedPrompt: "prompt", createdAt: draft.updatedAt, updatedAt: draft.updatedAt,
      },
      revision: {
        id: 12, taskPackId: 11, revisionNumber: 1, contentHash: `sha256:${"a".repeat(64)}`,
        createdAt: draft.updatedAt, generatedAt: draft.updatedAt,
      },
      draft: { ...draft, taskPackId: 11, draftVersion: 5, lifecycle: { state: "materialized", materializedRevisionId: 12 } },
    };
    reply(result);
    assert.deepEqual(await materializeTaskPackDraft(draft.id, 4), result);
    assertRequest(`/task-pack-drafts/${encodedId}/materialize`, "POST", { expectedDraftVersion: 4 });
    assert.deepEqual(Object.keys(calls[0].body as object), ["expectedDraftVersion"]);
  });

  for (const [name, invoke] of [
    ["PATCH", () => updateTaskPackDraft(draft.id, { expectedDraftVersion: 4, content: draft.content })],
    ["discard", () => discardTaskPackDraft(draft.id, 4)],
    ["materialize", () => materializeTaskPackDraft(draft.id, 4)],
  ] as const) {
    await scenario(`${name} preserves conflict status code and expected/actual IDs without retry`, async () => {
      const errorBody = {
        ok: false, code: "TASK_PACK_DRAFT_CONFLICT", message: "Draft changed.",
        draftId: draft.id, expectedDraftVersion: 4, actualDraftVersion: 5,
      };
      reply(errorBody, 409);
      await assert.rejects(invoke, (error: unknown) => {
        assert.ok(error instanceof ApiRequestError);
        assert.equal(error.status, 409);
        assert.equal(error.code, errorBody.code);
        assert.equal(error.message, errorBody.message);
        assert.deepEqual(error.data, errorBody);
        return true;
      });
    });
  }

  await scenario("detail preserves not-found through the existing error surface", async () => {
    reply({ ok: false, code: "TASK_PACK_DRAFT_NOT_FOUND", message: "Not found." }, 404);
    await assert.rejects(() => getTaskPackDraft(draft.id), (error: unknown) => {
      assert.ok(error instanceof ApiRequestError);
      assert.equal(error.status, 404);
      assert.equal(error.code, "TASK_PACK_DRAFT_NOT_FOUND");
      return true;
    });
  });

  await scenario("materialize preserves blocked-generation diagnostics in error data", async () => {
    const body = { ok: false, code: "CONTEXT_SELECTION_BLOCKED", message: "Review required.", selectionQuality: { status: "blocked" } };
    reply(body, 422);
    await assert.rejects(() => materializeTaskPackDraft(draft.id, 4), (error: unknown) => {
      assert.ok(error instanceof ApiRequestError);
      assert.equal(error.status, 422);
      assert.deepEqual(error.data, body);
      return true;
    });
  });

  await scenario("unexpected list failure preserves generic server status and data", async () => {
    const body = { ok: false, message: "Task Pack draft request failed." };
    reply(body, 500);
    await assert.rejects(() => listActiveTaskPackDrafts(), (error: unknown) => {
      assert.ok(error instanceof ApiRequestError);
      assert.equal(error.status, 500);
      assert.equal(error.code, undefined);
      assert.deepEqual(error.data, body);
      return true;
    });
  });

  process.stdout.write(`Task Pack draft API smoke passed: ${scenarios} scenarios.\n`);
} finally {
  globalThis.fetch = originalFetch;
}
