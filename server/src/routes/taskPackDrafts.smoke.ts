import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";

import express, { Router } from "express";

import { RulesServiceError } from "../rules/rulesService.js";
import type {
  TaskPackCurrentRecord,
  TaskPackRevisionRecord,
} from "../storage/types.js";
import {
  TaskPackDraftApplicationError,
  type CreateTaskPackDraftApplicationInput,
  type DiscardTaskPackDraftApplicationInput,
  type MaterializeGeneratedTaskPackDraftApplicationInput,
  type TaskPackDraftApplicationService,
  type TaskPackDraftSummary,
  type TaskPackDraftView,
  type UpdateTaskPackDraftApplicationInput,
} from "../taskPacks/taskPackDraftApplicationService.js";
import type { TaskPackDraftContent } from "../taskPacks/taskPackLifecycle.js";
import type {
  CreateTaskPackRequest,
  PrepareTaskPackPipelineResult,
} from "./taskPacks.js";
import {
  registerTaskPackDraftRoutes,
  type PrepareTaskPackForDraft,
  type ValidateCreateTaskPackRequest,
} from "./taskPackDrafts.js";

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

const taskPack: TaskPackCurrentRecord = {
  id: 71,
  projectId: view.projectId,
  title: "Materialized persisted draft",
  rawTask: view.content.rawTask,
  taskType: view.content.taskType,
  targetTool: view.content.targetTool,
  generatedPrompt: "Prepared immutable prompt.",
  generationMode: "template",
  generationModel: null,
  generationMessage: null,
  generationUsedFallback: false,
  generationDurationMs: 12,
  generationRecipe: { template: null },
  createdAt: "2026-09-24T09:00:00.000Z",
  updatedAt: "2026-09-24T09:00:00.000Z",
  currentRevisionId: 81,
};

const revision: TaskPackRevisionRecord = {
  id: taskPack.currentRevisionId,
  taskPackId: taskPack.id,
  revisionNumber: 1,
  baseRevisionId: null,
  sourceKind: "generated",
  rawTask: taskPack.rawTask,
  taskType: taskPack.taskType,
  targetTool: taskPack.targetTool,
  generatedPrompt: taskPack.generatedPrompt,
  generationMode: taskPack.generationMode,
  generationModel: taskPack.generationModel,
  generationMessage: taskPack.generationMessage,
  generationUsedFallback: taskPack.generationUsedFallback,
  generationDurationMs: taskPack.generationDurationMs,
  generationRecipe: { template: null },
  diagnostics: { selector: {}, generation: {}, performance: {} },
  groundedContextSnapshot: null,
  freshnessBasis: null,
  contentHash: `sha256:${"a".repeat(64)}`,
  createdAt: taskPack.createdAt,
  generatedAt: "2026-09-24T08:59:59.000Z",
};

const materializedView: TaskPackDraftView = {
  ...view,
  taskPackId: taskPack.id,
  lifecycle: {
    state: "materialized",
    materializedRevisionId: revision.id,
  },
  draftVersion: view.draftVersion + 1,
  updatedAt: taskPack.createdAt,
};

const preparedFixture: Extract<
  PrepareTaskPackPipelineResult,
  { readonly kind: "prepared" }
> = {
  kind: "prepared",
  projectId: view.projectId,
  projectName: view.projectName,
  title: taskPack.title,
  generatedAt: revision.generatedAt!,
  revisionContent: {
    rawTask: taskPack.rawTask,
    taskType: taskPack.taskType,
    targetTool: taskPack.targetTool,
    generatedPrompt: taskPack.generatedPrompt,
    generationMode: taskPack.generationMode,
    generationModel: taskPack.generationModel,
    generationMessage: taskPack.generationMessage,
    generationUsedFallback: taskPack.generationUsedFallback,
    generationDurationMs: taskPack.generationDurationMs,
  },
  generationRecipe: {
    template: null,
    ruleProfile: null,
    enabledRules: [],
    customRules: [],
    acceptanceCriteriaPreset: null,
    acceptanceCriteria: [],
    counts: {
      enabledRules: 0,
      customRules: 0,
      acceptanceCriteria: 0,
    },
  },
  selectorDiagnostics: {} as never,
  generationDiagnostics: {} as never,
  performanceDiagnostics: {} as never,
};

let listProjectId: number | undefined;
let lastCreate: CreateTaskPackDraftApplicationInput | null = null;
let lastUpdate: UpdateTaskPackDraftApplicationInput | null = null;
let lastDiscard: DiscardTaskPackDraftApplicationInput | null = null;
let lastMaterialize: MaterializeGeneratedTaskPackDraftApplicationInput | null = null;
let materializeCalls = 0;
let prepareCalls = 0;
let validationCalls = 0;
let getDraftCalls = 0;
let lastGenerationCandidate: Record<string, unknown> | null = null;

const service: TaskPackDraftApplicationService = {
  async listActiveDrafts(projectId) {
    listProjectId = projectId;
    return [summary];
  },
  async getDraft(draftId) {
    getDraftCalls += 1;
    if (draftId === "missing") return null;
    if (draftId === "state-invalid") {
      throw new TaskPackDraftApplicationError("TASK_PACK_DRAFT_STATE_INVALID", draftId);
    }
    if (draftId === "preflight-conflict") {
      return { ...materializedView, id: draftId, draftVersion: 2 };
    }
    if (draftId === "preflight-discarded") {
      return {
        ...view,
        id: draftId,
        lifecycle: { state: "discarded", materializedRevisionId: null },
      };
    }
    if (draftId === "preflight-materialized") {
      return { ...materializedView, id: draftId, draftVersion: 1 };
    }
    if (draftId === "preflight-exhausted") {
      return { ...view, id: draftId, draftVersion: Number.MAX_SAFE_INTEGER };
    }
    if (draftId === "preflight-bound") {
      return { ...view, id: draftId, taskPackId: taskPack.id };
    }
    if (draftId === "invalid-generation") {
      return { ...view, id: draftId, content: content({ rawTask: "x" }) };
    }
    if (draftId === "mapping") {
      return {
        ...view,
        id: draftId,
        projectId: 41,
        content: content({
          rawTask: "Generate from persisted draft content.",
          taskType: "implementation",
          targetTool: "claude",
          templateId: null,
          ruleProfileId: "  profile-original  ",
          enabledRuleIds: ["rule-b", "rule-a", "rule-b"],
          customRulesText: " first \r\nsecond\nfirst\n  \n THIRD ",
          acceptanceCriteriaPresetId: " ",
          acceptanceCriteriaText: " pass \npass\r\n verify ",
          clarifications: [
            { question: " Scope? ", answer: "" },
            { question: " Target? ", answer: " api " },
            { question: "Target?", answer: "api" },
          ],
          performanceSessionId: null,
          understandingSnapshotId: " ",
          reviewedUnderstandingSnapshotId: null,
        }),
      };
    }
    const generationRawTask: Record<string, string> = {
      "project-race": "project missing during preparation",
      blocked: "blocked during preparation",
      clarification: "clarification required during preparation",
      "rules-error": "rules service failure",
      "prepare-unexpected": "unexpected preparation failure",
    };
    return {
      ...view,
      id: draftId,
      ...(generationRawTask[draftId]
        ? { content: content({ rawTask: generationRawTask[draftId] }) }
        : {}),
    };
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
  async materializeDraft(input) {
    materializeCalls += 1;
    lastMaterialize = input;
    if (input.draftId === "post-conflict") {
      throw new TaskPackDraftApplicationError(
        "TASK_PACK_DRAFT_CONFLICT",
        input.draftId,
        input.expectedDraftVersion,
        input.expectedDraftVersion + 1,
      );
    }
    if (input.draftId === "post-terminal") {
      throw new TaskPackDraftApplicationError(
        "TASK_PACK_DRAFT_NOT_EDITABLE",
        input.draftId,
      );
    }
    if (input.draftId === "post-bound") {
      throw new TaskPackDraftApplicationError(
        "TASK_PACK_DRAFT_ALREADY_BOUND",
        input.draftId,
      );
    }
    if (input.draftId === "materialize-unexpected") {
      throw new Error("private materialization database detail");
    }
    return {
      taskPack,
      revision,
      draft: { ...materializedView, id: input.draftId },
    };
  },
};

const prepareTaskPack: PrepareTaskPackForDraft = async (input) => {
  prepareCalls += 1;
  if (input.rawTask === "project missing during preparation") {
    return { kind: "project_not_found", projectId: input.projectId };
  }
  if (input.rawTask === "blocked during preparation") {
    return {
      kind: "blocked",
      message: "Selection is blocked.",
      selectionQuality: { status: "blocked" } as never,
      selectorDiagnostics: { outcome: "abstained" } as never,
      performanceDiagnostics: { sessionId: "blocked" } as never,
    };
  }
  if (input.rawTask === "clarification required during preparation") {
    return {
      kind: "clarification_required",
      message: "One decision is required.",
      selectionQuality: { status: "blocked" } as never,
      selectorDiagnostics: { outcome: "clarification_required" } as never,
      performanceDiagnostics: { sessionId: "clarification" } as never,
    };
  }
  if (input.rawTask === "unexpected preparation failure") {
    throw new Error("private generation provider detail");
  }
  if (input.rawTask === "rules service failure") {
    throw new RulesServiceError("Rule profile is unavailable.", 404);
  }
  return {
    ...preparedFixture,
    projectId: input.projectId,
    revisionContent: {
      ...preparedFixture.revisionContent,
      rawTask: input.rawTask,
      taskType: input.taskType,
      targetTool: input.targetTool,
    },
  };
};

const validateTaskPackRequest: ValidateCreateTaskPackRequest = (input) => {
  validationCalls += 1;
  lastGenerationCandidate = input as Record<string, unknown>;
  if (
    !input ||
    typeof input !== "object" ||
    typeof (input as Record<string, unknown>).rawTask !== "string" ||
    ((input as Record<string, unknown>).rawTask as string).length < 3
  ) {
    return { success: false };
  }
  return { success: true, data: input as CreateTaskPackRequest };
};

const app = express();
app.use(express.json());
const router = Router();
registerTaskPackDraftRoutes(
  router,
  service,
  prepareTaskPack,
  validateTaskPackRequest,
);
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

function resetMaterializationTracking(): void {
  lastMaterialize = null;
  materializeCalls = 0;
  prepareCalls = 0;
  validationCalls = 0;
  getDraftCalls = 0;
  lastGenerationCandidate = null;
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

scenario("POST materialize requires a valid strict optimistic version", async () => {
  resetMaterializationTracking();
  const missing = await request("/draft-route/materialize", {
    method: "POST",
    body: {},
  });
  assert.equal(missing.status, 428);
  assert.equal(missing.body.code, "TASK_PACK_DRAFT_VERSION_REQUIRED");
  assert.equal(getDraftCalls, 0);
  assert.equal(prepareCalls, 0);
  assert.equal(materializeCalls, 0);

  for (const body of [
    { expectedDraftVersion: 0 },
    { expectedDraftVersion: 1.5 },
    { expectedDraftVersion: "1" },
    { expectedDraftVersion: 1, extra: true },
  ]) {
    assert.equal(
      (await request("/draft-route/materialize", { method: "POST", body }))
        .status,
      400,
    );
  }
  assert.equal(getDraftCalls, 0);
});

scenario("POST materialize missing draft stops before generation", async () => {
  resetMaterializationTracking();
  const response = await request("/missing/materialize", {
    method: "POST",
    body: { expectedDraftVersion: 1 },
  });
  assert.equal(response.status, 404);
  assert.equal(response.body.code, "TASK_PACK_DRAFT_NOT_FOUND");
  assert.equal(getDraftCalls, 1);
  assert.equal(prepareCalls, 0);
  assert.equal(materializeCalls, 0);
});

scenario("POST materialize stale preflight preserves expected and actual versions", async () => {
  resetMaterializationTracking();
  const response = await request("/preflight-conflict/materialize", {
    method: "POST",
    body: { expectedDraftVersion: 1 },
  });
  assert.equal(response.status, 409);
  assert.equal(response.body.code, "TASK_PACK_DRAFT_CONFLICT");
  assert.equal(response.body.draftId, "preflight-conflict");
  assert.equal(response.body.expectedDraftVersion, 1);
  assert.equal(response.body.actualDraftVersion, 2);
  assert.equal(prepareCalls, 0);
  assert.equal(materializeCalls, 0);
});

scenario("POST materialize fast-fails terminal exhausted and already-bound drafts", async () => {
  for (const [draftId, version, code] of [
    ["preflight-discarded", 1, "TASK_PACK_DRAFT_NOT_EDITABLE"],
    ["preflight-materialized", 1, "TASK_PACK_DRAFT_NOT_EDITABLE"],
    [
      "preflight-exhausted",
      Number.MAX_SAFE_INTEGER,
      "TASK_PACK_DRAFT_VERSION_EXHAUSTED",
    ],
    ["preflight-bound", 1, "TASK_PACK_DRAFT_ALREADY_BOUND"],
  ] as const) {
    resetMaterializationTracking();
    const response = await request(`/${draftId}/materialize`, {
      method: "POST",
      body: { expectedDraftVersion: version },
    });
    assert.equal(response.status, 409);
    assert.equal(response.body.code, code);
    assert.equal(prepareCalls, 0);
    assert.equal(materializeCalls, 0);
  }
});

scenario("POST materialize applies the normal create schema before generation", async () => {
  resetMaterializationTracking();
  const response = await request("/invalid-generation/materialize", {
    method: "POST",
    body: { expectedDraftVersion: 1 },
  });
  assert.equal(response.status, 400);
  assert.equal(response.body.code, "TASK_PACK_DRAFT_INVALID");
  assert.equal(validationCalls, 1);
  assert.equal(prepareCalls, 0);
  assert.equal(materializeCalls, 0);
});

scenario("persisted draft content maps to the normal generation request", async () => {
  resetMaterializationTracking();
  const response = await request("/mapping/materialize", {
    method: "POST",
    body: { expectedDraftVersion: 1 },
  });
  assert.equal(response.status, 200);
  assert.ok(lastGenerationCandidate);
  assert.equal(lastGenerationCandidate.projectId, 41);
  assert.equal(
    lastGenerationCandidate.rawTask,
    "Generate from persisted draft content.",
  );
  assert.equal(lastGenerationCandidate.taskType, "implementation");
  assert.equal(lastGenerationCandidate.targetTool, "claude");
  assert.equal(Object.hasOwn(lastGenerationCandidate, "selectedFilePaths"), false);
  assert.equal(Object.hasOwn(lastGenerationCandidate, "githubIssueSource"), false);
  assert.deepEqual(lastGenerationCandidate.clarifications, [
    { question: "Target?", answer: "api" },
  ]);
  assert.deepEqual(lastGenerationCandidate.customRules, [
    "first",
    "second",
    "THIRD",
  ]);
  assert.deepEqual(lastGenerationCandidate.acceptanceCriteria, [
    "pass",
    "verify",
  ]);
  assert.deepEqual(lastGenerationCandidate.enabledRuleIds, [
    "rule-b",
    "rule-a",
    "rule-b",
  ]);
  assert.equal(Object.hasOwn(lastGenerationCandidate, "templateId"), false);
  assert.equal(
    Object.hasOwn(lastGenerationCandidate, "acceptanceCriteriaPresetId"),
    false,
  );
  assert.equal(
    Object.hasOwn(lastGenerationCandidate, "understandingSnapshotId"),
    false,
  );
  assert.equal(
    Object.hasOwn(lastGenerationCandidate, "performanceSessionId"),
    false,
  );
  assert.equal(
    Object.hasOwn(lastGenerationCandidate, "reviewedUnderstandingSnapshotId"),
    false,
  );
  assert.equal(lastGenerationCandidate.ruleProfileId, "  profile-original  ");
});

scenario("POST materialize maps preparation non-success without mutation", async () => {
  for (const [draftId, status, code] of [
    ["project-race", 404, "TASK_PACK_DRAFT_PROJECT_NOT_FOUND"],
    ["blocked", 422, "CONTEXT_SELECTION_BLOCKED"],
    ["clarification", 422, "CONTEXT_SELECTION_BLOCKED"],
  ] as const) {
    resetMaterializationTracking();
    const response = await request(`/${draftId}/materialize`, {
      method: "POST",
      body: { expectedDraftVersion: 1 },
    });
    assert.equal(response.status, status);
    assert.equal(response.body.code, code);
    assert.equal(prepareCalls, 1);
    assert.equal(materializeCalls, 0);
    if (status === 422) {
      assert.ok(response.body.selectionQuality);
      assert.ok(response.body.selectorDiagnostics);
      assert.ok(response.body.performanceDiagnostics);
    }
  }
});

scenario("POST materialize forwards prepared material once and returns bounded identities", async () => {
  resetMaterializationTracking();
  const response = await request("/draft-route/materialize", {
    method: "POST",
    body: { expectedDraftVersion: 1 },
  });
  assert.equal(response.status, 200);
  assert.equal(prepareCalls, 1);
  assert.equal(materializeCalls, 1);
  assert.ok(lastMaterialize);
  assert.equal(lastMaterialize.draftId, "draft-route");
  assert.equal(lastMaterialize.expectedDraftVersion, 1);
  assert.equal(lastMaterialize.title, preparedFixture.title);
  assert.equal(lastMaterialize.generatedAt, preparedFixture.generatedAt);
  assert.deepEqual(lastMaterialize.revisionContent, preparedFixture.revisionContent);
  assert.deepEqual(lastMaterialize.generationRecipe, preparedFixture.generationRecipe);
  assert.deepEqual(
    lastMaterialize.selectorDiagnostics,
    preparedFixture.selectorDiagnostics,
  );
  assert.deepEqual(
    lastMaterialize.generationDiagnostics,
    preparedFixture.generationDiagnostics,
  );
  assert.deepEqual(
    lastMaterialize.performanceDiagnostics,
    preparedFixture.performanceDiagnostics,
  );
  assert.equal(
    (response.body.taskPack as Record<string, unknown>).currentRevisionId,
    revision.id,
  );
  assert.equal(
    (response.body.taskPack as Record<string, unknown>).projectName,
    view.projectName,
  );
  assert.deepEqual(response.body.revision, {
    id: revision.id,
    taskPackId: revision.taskPackId,
    revisionNumber: revision.revisionNumber,
    contentHash: revision.contentHash,
    createdAt: revision.createdAt,
    generatedAt: revision.generatedAt,
  });
  assert.equal(
    (response.body.draft as { lifecycle: { state: string } }).lifecycle.state,
    "materialized",
  );
  assert.equal(
    Object.hasOwn(response.body.revision as Record<string, unknown>, "rawTask"),
    false,
  );
});

scenario("authoritative post-generation races are not retried", async () => {
  for (const [draftId, code] of [
    ["post-conflict", "TASK_PACK_DRAFT_CONFLICT"],
    ["post-terminal", "TASK_PACK_DRAFT_NOT_EDITABLE"],
    ["post-bound", "TASK_PACK_DRAFT_ALREADY_BOUND"],
  ] as const) {
    resetMaterializationTracking();
    const response = await request(`/${draftId}/materialize`, {
      method: "POST",
      body: { expectedDraftVersion: 1 },
    });
    assert.equal(response.status, 409);
    assert.equal(response.body.code, code);
    assert.equal(prepareCalls, 1);
    assert.equal(materializeCalls, 1);
    assert.equal(lastMaterialize?.expectedDraftVersion, 1);
  }
});

scenario("RulesServiceError preserves its established status and message", async () => {
  resetMaterializationTracking();
  const response = await request("/rules-error/materialize", {
    method: "POST",
    body: { expectedDraftVersion: 1 },
  });
  assert.equal(response.status, 404);
  assert.deepEqual(response.body, {
    ok: false,
    message: "Rule profile is unavailable.",
  });
  assert.equal(prepareCalls, 1);
  assert.equal(materializeCalls, 0);
});

scenario("unexpected preparation and materialization failures are privacy-safe", async () => {
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    resetMaterializationTracking();
    const preparation = await request("/prepare-unexpected/materialize", {
      method: "POST",
      body: { expectedDraftVersion: 1 },
    });
    assert.equal(preparation.status, 500);
    assert.equal(JSON.stringify(preparation.body).includes("provider"), false);
    assert.equal(materializeCalls, 0);

    resetMaterializationTracking();
    const materialization = await request("/materialize-unexpected/materialize", {
      method: "POST",
      body: { expectedDraftVersion: 1 },
    });
    assert.equal(materialization.status, 500);
    assert.equal(JSON.stringify(materialization.body).includes("database"), false);
    assert.equal(prepareCalls, 1);
    assert.equal(materializeCalls, 1);
  } finally {
    console.error = originalConsoleError;
  }
});

scenario("production registration is composed in index without direct draft storage calls", () => {
  const indexSource = fs.readFileSync(path.join(process.cwd(), "src", "index.ts"), "utf8");
  const routeSource = fs.readFileSync(path.join(process.cwd(), "src", "routes", "taskPackDrafts.ts"), "utf8");
  assert.ok(indexSource.includes('app.use("/api/task-pack-drafts", taskPackDraftsRouter)'));
  assert.ok(indexSource.includes("prepareTaskPackWithPipeline"));
  assert.ok(indexSource.includes("createTaskPackSchema.safeParse(input)"));
  assert.ok(indexSource.includes("registerTaskPackDraftRoutes("));
  assert.ok(routeSource.includes('router.post("/:draftId/materialize"'));
  assert.equal(routeSource.includes("createTaskPackDraftApplicationService(storage)"), false);
  assert.equal(
    /import\s+\{[^}]*\}\s+from\s+"\.\/taskPacks\.js"/su.test(routeSource),
    false,
  );
  for (const directCall of [
    "storage.listActiveTaskPackDrafts",
    "storage.getTaskPackDraftById",
    "storage.createTaskPackDraft",
    "storage.updateTaskPackDraft",
    "storage.discardTaskPackDraft",
    "storage.materializeTaskPackDraft",
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
