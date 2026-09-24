import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";

import express, { Router } from "express";

import {
  TaskPackDraftApplicationError,
  type CreateTaskPackDraftApplicationInput,
  type DiscardTaskPackDraftApplicationInput,
  type TaskPackDraftApplicationService,
  type TaskPackDraftSummary,
  type TaskPackDraftView,
  type UpdateTaskPackDraftApplicationInput,
} from "../taskPacks/taskPackDraftApplicationService.js";
import type { TaskPackDraftContent } from "../taskPacks/taskPackLifecycle.js";
import { registerTaskPackDraftRoutes } from "./taskPackDrafts.js";

interface SmokeScenario {
  readonly name: string;
  readonly run: () => void | Promise<void>;
}

const scenarios: SmokeScenario[] = [];
const scenario = (name: string, run: SmokeScenario["run"]): void => {
  scenarios.push({ name, run });
};

function content(overrides: Partial<TaskPackDraftContent> = {}): TaskPackDraftContent {
  return {
    rawTask: "  Preserve authored task text.\r\n",
    taskType: "tests",
    targetTool: "codex",
    templateId: null,
    ruleProfileId: null,
    enabledRuleIds: [],
    customRulesText: null,
    acceptanceCriteriaPresetId: null,
    acceptanceCriteriaText: null,
    clarifications: [{ question: "Scope?", answer: "" }],
    performanceSessionId: null,
    understandingSnapshotId: null,
    reviewedUnderstandingSnapshotId: null,
    ...overrides,
  };
}

const view: TaskPackDraftView = {
  id: "draft-route",
  projectId: 1,
  projectName: "Route project",
  taskPackId: null,
  baseRevisionId: null,
  content: content(),
  lifecycle: { state: "active", materializedRevisionId: null },
  draftVersion: 1,
  createdAt: "2026-09-24T08:00:00.000Z",
  updatedAt: "2026-09-24T08:00:00.000Z",
  expiresAt: null,
};

const summary: TaskPackDraftSummary = {
  id: view.id,
  projectId: view.projectId,
  projectName: view.projectName,
  taskPackId: view.taskPackId,
  baseRevisionId: view.baseRevisionId,
  lifecycle: view.lifecycle,
  draftVersion: view.draftVersion,
  createdAt: view.createdAt,
  updatedAt: view.updatedAt,
  expiresAt: view.expiresAt,
};

let listProjectId: number | undefined;
let lastCreate: CreateTaskPackDraftApplicationInput | null = null;
let lastUpdate: UpdateTaskPackDraftApplicationInput | null = null;
let lastDiscard: DiscardTaskPackDraftApplicationInput | null = null;

const service: TaskPackDraftApplicationService = {
  async listActiveDrafts(projectId) {
    listProjectId = projectId;
    return [summary];
  },
  async getDraft(draftId) {
    if (draftId === "missing") return null;
    if (draftId === "state-invalid") {
      throw new TaskPackDraftApplicationError("TASK_PACK_DRAFT_STATE_INVALID", draftId);
    }
    return { ...view, id: draftId };
  },
  async createDraft(input) {
    lastCreate = input;
    if (input.projectId === 404) {
      throw new TaskPackDraftApplicationError("TASK_PACK_DRAFT_PROJECT_NOT_FOUND");
    }
    if (input.taskPackId === 404) {
      throw new TaskPackDraftApplicationError("TASK_PACK_DRAFT_TASK_PACK_NOT_FOUND");
    }
    if (input.projectId === 409) {
      throw new TaskPackDraftApplicationError("TASK_PACK_DRAFT_OWNERSHIP_INVALID");
    }
    if (input.baseRevisionId === 409) {
      throw new TaskPackDraftApplicationError("TASK_PACK_DRAFT_BASE_REVISION_INVALID");
    }
    if (input.projectId === 500) {
      throw new TaskPackDraftApplicationError("TASK_PACK_DRAFT_STATE_INVALID");
    }
    return { ...view, projectId: input.projectId, content: input.content };
  },
  async updateDraft(input) {
    lastUpdate = input;
    if (input.draftId === "conflict") {
      throw new TaskPackDraftApplicationError(
        "TASK_PACK_DRAFT_CONFLICT",
        input.draftId,
        input.expectedDraftVersion,
        input.expectedDraftVersion + 1,
      );
    }
    if (input.draftId === "terminal") {
      throw new TaskPackDraftApplicationError(
        "TASK_PACK_DRAFT_NOT_EDITABLE",
        input.draftId,
        input.expectedDraftVersion,
        input.expectedDraftVersion,
        "discarded",
      );
    }
    if (input.draftId === "exhausted") {
      throw new TaskPackDraftApplicationError(
        "TASK_PACK_DRAFT_VERSION_EXHAUSTED",
        input.draftId,
      );
    }
    if (input.draftId === "state-invalid") {
      throw new TaskPackDraftApplicationError("TASK_PACK_DRAFT_STATE_INVALID", input.draftId);
    }
    if (input.draftId === "unexpected") {
      throw new Error("private SQL update detail must not leak");
    }
    return {
      ...view,
      id: input.draftId,
      content: input.content,
      draftVersion: input.expectedDraftVersion + 1,
    };
  },
  async discardDraft(input) {
    lastDiscard = input;
    if (input.draftId === "conflict") {
      throw new TaskPackDraftApplicationError(
        "TASK_PACK_DRAFT_CONFLICT",
        input.draftId,
        input.expectedDraftVersion,
        input.expectedDraftVersion + 1,
      );
    }
    if (input.draftId === "terminal") {
      throw new TaskPackDraftApplicationError(
        "TASK_PACK_DRAFT_NOT_EDITABLE",
        input.draftId,
      );
    }
    if (input.draftId === "exhausted") {
      throw new TaskPackDraftApplicationError(
        "TASK_PACK_DRAFT_VERSION_EXHAUSTED",
        input.draftId,
      );
    }
    return {
      ...view,
      id: input.draftId,
      lifecycle: { state: "discarded", materializedRevisionId: null },
      draftVersion: input.expectedDraftVersion + 1,
    };
  },
};

const app = express();
app.use(express.json());
const router = Router();
registerTaskPackDraftRoutes(router, service);
app.use("/api/task-pack-drafts", router);

const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve, reject) => {
  server.once("listening", resolve);
  server.once("error", reject);
});
const address = server.address() as AddressInfo;
const baseUrl = `http://127.0.0.1:${address.port}/api/task-pack-drafts`;

async function request(
  requestPath = "",
  options: { readonly method?: string; readonly body?: unknown } = {},
): Promise<{ readonly status: number; readonly body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${requestPath}`, {
    method: options.method,
    headers: options.body === undefined ? undefined : { "content-type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

function createBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    projectId: 1,
    taskPackId: null,
    baseRevisionId: null,
    content: content(),
    ...overrides,
  };
}

function updateBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { expectedDraftVersion: 1, content: content(), ...overrides };
}

scenario("POST creates a normalized draft and preserves authored text", async () => {
  const response = await request("", { method: "POST", body: createBody() });
  assert.equal(response.status, 201);
  assert.equal(response.body.ok, true);
  assert.equal(lastCreate?.content.rawTask, "  Preserve authored task text.\r\n");
  assert.equal(lastCreate?.content.customRulesText, null);
});

scenario("POST rejects unknown outer and content fields", async () => {
  const outer = await request("", { method: "POST", body: createBody({ id: "caller-id" }) });
  assert.equal(outer.status, 400);
  const nested = await request("", {
    method: "POST",
    body: createBody({ content: { ...content(), unexpected: true } }),
  });
  assert.equal(nested.status, 400);
});

scenario("POST rejects whitespace authored identity fields without trimming valid text", async () => {
  for (const invalidContent of [
    content({ rawTask: " \t" }),
    content({ taskType: " " }),
    content({ targetTool: "\n" }),
    content({ clarifications: [{ question: " ", answer: "" }] }),
  ]) {
    assert.equal((await request("", {
      method: "POST",
      body: createBody({ content: invalidContent }),
    })).status, 400);
  }
});

scenario("POST rejects invalid project and nullable reference inputs", async () => {
  for (const body of [
    createBody({ projectId: 0 }),
    createBody({ taskPackId: 0 }),
    createBody({ baseRevisionId: 1.5 }),
    createBody({ content: { ...content(), templateId: 4 } }),
  ]) {
    assert.equal((await request("", { method: "POST", body })).status, 400);
  }
});

scenario("POST maps missing project and Task Pack to 404", async () => {
  const project = await request("", { method: "POST", body: createBody({ projectId: 404 }) });
  assert.equal(project.status, 404);
  assert.equal(project.body.code, "TASK_PACK_DRAFT_PROJECT_NOT_FOUND");
  const taskPack = await request("", { method: "POST", body: createBody({ taskPackId: 404 }) });
  assert.equal(taskPack.status, 404);
  assert.equal(taskPack.body.code, "TASK_PACK_DRAFT_TASK_PACK_NOT_FOUND");
});

scenario("POST maps ownership and base conflicts to 409", async () => {
  const ownership = await request("", { method: "POST", body: createBody({ projectId: 409 }) });
  assert.equal(ownership.status, 409);
  assert.equal(ownership.body.code, "TASK_PACK_DRAFT_OWNERSHIP_INVALID");
  const base = await request("", {
    method: "POST",
    body: createBody({ taskPackId: 1, baseRevisionId: 409 }),
  });
  assert.equal(base.status, 409);
  assert.equal(base.body.code, "TASK_PACK_DRAFT_BASE_REVISION_INVALID");
});

scenario("POST maps invalid persisted state to privacy-safe 500", async () => {
  const response = await request("", { method: "POST", body: createBody({ projectId: 500 }) });
  assert.equal(response.status, 500);
  assert.deepEqual(response.body, {
    ok: false,
    code: "TASK_PACK_DRAFT_STATE_INVALID",
    message: "Task Pack draft state is invalid.",
  });
});

scenario("GET list defaults to active and excludes content", async () => {
  listProjectId = 99;
  const response = await request();
  assert.equal(response.status, 200);
  assert.equal(listProjectId, undefined);
  assert.deepEqual(response.body.drafts, [summary]);
  assert.equal(JSON.stringify(response.body).includes("content"), false);
  assert.equal(JSON.stringify(response.body).includes("rawTask"), false);
});

scenario("GET list accepts active and forwards a valid project filter", async () => {
  const response = await request("?state=active&projectId=41");
  assert.equal(response.status, 200);
  assert.equal(listProjectId, 41);
});

scenario("GET list rejects unsupported state invalid project and unknown query", async () => {
  for (const query of ["?state=discarded", "?projectId=0", "?projectId=1e2", "?extra=x"]) {
    assert.equal((await request(query)).status, 400);
  }
});

scenario("GET detail returns full view and missing maps to 404", async () => {
  const found = await request("/draft-route");
  assert.equal(found.status, 200);
  assert.deepEqual(found.body.draft, view);
  const missing = await request("/missing");
  assert.equal(missing.status, 404);
  assert.equal(missing.body.code, "TASK_PACK_DRAFT_NOT_FOUND");
});

scenario("GET detail rejects malformed opaque draft identity", async () => {
  assert.equal((await request(`/${"x".repeat(201)}`)).status, 400);
});

scenario("GET detail maps invalid state to safe 500", async () => {
  const response = await request("/state-invalid");
  assert.equal(response.status, 500);
  assert.deepEqual(response.body, {
    ok: false,
    code: "TASK_PACK_DRAFT_STATE_INVALID",
    message: "Task Pack draft state is invalid.",
  });
});

scenario("PATCH replaces full content and forwards the optimistic token", async () => {
  const response = await request("/draft-route", { method: "PATCH", body: updateBody() });
  assert.equal(response.status, 200);
  assert.equal(lastUpdate?.draftId, "draft-route");
  assert.equal(lastUpdate?.expectedDraftVersion, 1);
  assert.equal((response.body.draft as { draftVersion: number }).draftVersion, 2);
});

scenario("PATCH missing version returns the stable 428 contract", async () => {
  const response = await request("/draft-route", {
    method: "PATCH",
    body: { content: content() },
  });
  assert.equal(response.status, 428);
  assert.deepEqual(response.body, {
    ok: false,
    code: "TASK_PACK_DRAFT_VERSION_REQUIRED",
    message: "The current draft version is required before saving.",
  });
});

scenario("PATCH rejects invalid version and strict unknown fields", async () => {
  assert.equal((await request("/draft-route", {
    method: "PATCH",
    body: updateBody({ expectedDraftVersion: 0 }),
  })).status, 400);
  assert.equal((await request("/draft-route", {
    method: "PATCH",
    body: updateBody({ unexpected: true }),
  })).status, 400);
  assert.equal((await request("/draft-route", {
    method: "PATCH",
    body: updateBody({ content: { ...content(), unexpected: true } }),
  })).status, 400);
});

scenario("PATCH conflict returns expected and actual versions", async () => {
  const response = await request("/conflict", { method: "PATCH", body: updateBody({ expectedDraftVersion: 4 }) });
  assert.equal(response.status, 409);
  assert.equal(response.body.code, "TASK_PACK_DRAFT_CONFLICT");
  assert.equal(response.body.draftId, "conflict");
  assert.equal(response.body.expectedDraftVersion, 4);
  assert.equal(response.body.actualDraftVersion, 5);
});

scenario("PATCH terminal exhausted and invalid-state errors are stable", async () => {
  const terminal = await request("/terminal", { method: "PATCH", body: updateBody() });
  assert.equal(terminal.status, 409);
  assert.equal(terminal.body.code, "TASK_PACK_DRAFT_NOT_EDITABLE");
  const exhausted = await request("/exhausted", { method: "PATCH", body: updateBody() });
  assert.equal(exhausted.status, 409);
  assert.equal(exhausted.body.code, "TASK_PACK_DRAFT_VERSION_EXHAUSTED");
  const invalid = await request("/state-invalid", { method: "PATCH", body: updateBody() });
  assert.equal(invalid.status, 500);
  assert.equal(invalid.body.code, "TASK_PACK_DRAFT_STATE_INVALID");
});

scenario("PATCH unexpected failure hides private details", async () => {
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    const response = await request("/unexpected", { method: "PATCH", body: updateBody() });
    assert.equal(response.status, 500);
    assert.equal(JSON.stringify(response.body).includes("private"), false);
    assert.deepEqual(response.body, { ok: false, message: "Task Pack draft request failed." });
  } finally {
    console.error = originalConsoleError;
  }
});

scenario("POST discard succeeds without hard deletion", async () => {
  const response = await request("/draft-route/discard", {
    method: "POST",
    body: { expectedDraftVersion: 2 },
  });
  assert.equal(response.status, 200);
  assert.equal(lastDiscard?.draftId, "draft-route");
  assert.equal(lastDiscard?.expectedDraftVersion, 2);
  assert.equal((response.body.draft as { lifecycle: { state: string } }).lifecycle.state, "discarded");
});

scenario("POST discard missing version returns 428 and invalid version returns 400", async () => {
  const missing = await request("/draft-route/discard", { method: "POST", body: {} });
  assert.equal(missing.status, 428);
  assert.equal(missing.body.code, "TASK_PACK_DRAFT_VERSION_REQUIRED");
  const invalid = await request("/draft-route/discard", {
    method: "POST",
    body: { expectedDraftVersion: -1 },
  });
  assert.equal(invalid.status, 400);
});

scenario("POST discard maps conflict terminal and exhaustion to 409", async () => {
  for (const [draftId, code] of [
    ["conflict", "TASK_PACK_DRAFT_CONFLICT"],
    ["terminal", "TASK_PACK_DRAFT_NOT_EDITABLE"],
    ["exhausted", "TASK_PACK_DRAFT_VERSION_EXHAUSTED"],
  ] as const) {
    const response = await request(`/${draftId}/discard`, {
      method: "POST",
      body: { expectedDraftVersion: 1 },
    });
    assert.equal(response.status, 409);
    assert.equal(response.body.code, code);
  }
});

scenario("production registration is isolated and has no materialization route or direct draft storage calls", () => {
  const indexSource = fs.readFileSync(path.join(process.cwd(), "src", "index.ts"), "utf8");
  const routeSource = fs.readFileSync(path.join(process.cwd(), "src", "routes", "taskPackDrafts.ts"), "utf8");
  assert.ok(indexSource.includes('app.use("/api/task-pack-drafts", taskPackDraftsRouter)'));
  assert.equal(routeSource.includes("materialize"), false);
  for (const directCall of [
    "storage.listActiveTaskPackDrafts",
    "storage.getTaskPackDraftById",
    "storage.createTaskPackDraft",
    "storage.updateTaskPackDraft",
    "storage.discardTaskPackDraft",
    "createTaskPackWithInitialRevision",
    "appendTaskPackRevision",
    "generateReliableTaskPack",
  ]) {
    assert.equal(routeSource.includes(directCall), false, directCall);
  }
});

let passed = 0;
try {
  for (const entry of scenarios) {
    await entry.run();
    passed += 1;
    process.stdout.write(`PASS ${entry.name}\n`);
  }
  process.stdout.write(`Task Pack draft route smoke passed: ${passed} scenarios.\n`);
} finally {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
