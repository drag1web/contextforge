import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";

import express, { Router } from "express";

import {
  registerTaskPackCurrentReadRoutes,
  type TaskPackCurrentReadService,
} from "./taskPacks.js";
import { TaskPackCurrentStateError } from "../taskPacks/taskPackApplicationService.js";
import type { TaskPackCurrentRecord } from "../storage/types.js";

interface SmokeScenario {
  readonly name: string;
  readonly run: () => void | Promise<void>;
}

const scenarios: SmokeScenario[] = [];
const scenario = (name: string, run: SmokeScenario["run"]) =>
  scenarios.push({ name, run });

const currentTaskPack: TaskPackCurrentRecord = {
  id: 1,
  projectId: 2,
  projectName: "Route fixture",
  title: "Current route fixture",
  rawTask: "Read the current Task Pack.",
  taskType: "tests",
  targetTool: "codex",
  generatedPrompt: "Return the flat current projection.",
  generationMode: "template",
  generationModel: null,
  generationMessage: null,
  generationUsedFallback: false,
  generationDurationMs: 3,
  generationRecipe: { performanceDiagnostics: { totalMs: 12 } },
  createdAt: "2026-09-22T08:00:00.000Z",
  updatedAt: "2026-09-22T08:01:00.000Z",
  currentRevisionId: 11,
};

let listFailure: "current-state" | "unexpected" | null = null;
const service: TaskPackCurrentReadService = {
  async listCurrentTaskPacks() {
    if (listFailure === "current-state") {
      throw new TaskPackCurrentStateError();
    }
    if (listFailure === "unexpected") {
      throw new Error("private list database details must not leak");
    }
    return [currentTaskPack];
  },
  async getCurrentTaskPack(taskPackId) {
    if (taskPackId === 77) throw new TaskPackCurrentStateError();
    if (taskPackId === 88) {
      throw new Error("private database details must not leak");
    }
    return taskPackId === currentTaskPack.id ? currentTaskPack : null;
  },
};

const app = express();
const router = Router();
registerTaskPackCurrentReadRoutes(router, service);
app.use("/api/task-packs", router);

const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve, reject) => {
  server.once("listening", resolve);
  server.once("error", reject);
});
const address = server.address() as AddressInfo;
const baseUrl = `http://127.0.0.1:${address.port}/api/task-packs`;

async function request(path = ""): Promise<{
  readonly status: number;
  readonly body: Record<string, unknown>;
}> {
  const response = await fetch(`${baseUrl}${path}`);
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

scenario("GET list preserves its envelope and adds currentRevisionId", async () => {
  const response = await request();
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.deepEqual(response.body.taskPacks, [currentTaskPack]);
});

scenario("GET list maps broken current state to the stable code", async () => {
  listFailure = "current-state";
  try {
    const response = await request();
    assert.equal(response.status, 500);
    assert.deepEqual(response.body, {
      ok: false,
      code: "TASK_PACK_CURRENT_STATE_INVALID",
      message: "Task Pack current state is invalid.",
    });
    assert.equal(JSON.stringify(response.body).includes("database"), false);
  } finally {
    listFailure = null;
  }
});

scenario("GET list hides unexpected storage failure details", async () => {
  listFailure = "unexpected";
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    const response = await request();
    assert.equal(response.status, 500);
    assert.deepEqual(response.body, {
      ok: false,
      message: "Failed to read Task Packs",
    });
    assert.equal(JSON.stringify(response.body).includes("private"), false);
  } finally {
    listFailure = null;
    console.error = originalConsoleError;
  }
});

scenario("GET detail returns the current flat projection", async () => {
  const response = await request("/1");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ok: true, taskPack: currentTaskPack });
});

for (const invalidId of ["0", "-1", "not-a-number", "1.5", "1e2", "01"]) {
  scenario(`GET detail rejects invalid id ${invalidId}`, async () => {
    const response = await request(`/${invalidId}`);
    assert.equal(response.status, 400);
    assert.equal(response.body.ok, false);
  });
}

scenario("GET detail returns 404 for a missing Task Pack", async () => {
  const response = await request("/999");
  assert.equal(response.status, 404);
  assert.deepEqual(response.body, { ok: false, message: "Task Pack not found" });
});

scenario("GET detail maps broken current state to the stable code", async () => {
  const response = await request("/77");
  assert.equal(response.status, 500);
  assert.deepEqual(response.body, {
    ok: false,
    code: "TASK_PACK_CURRENT_STATE_INVALID",
    message: "Task Pack current state is invalid.",
  });
  assert.equal(JSON.stringify(response.body).includes("database"), false);
});

scenario("GET detail hides unexpected storage failure details", async () => {
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    const response = await request("/88");
    assert.equal(response.status, 500);
    assert.deepEqual(response.body, {
      ok: false,
      message: "Failed to read Task Pack",
    });
    assert.equal(JSON.stringify(response.body).includes("private"), false);
  } finally {
    console.error = originalConsoleError;
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
    `Task Pack current-read route smoke passed: ${passed} scenarios.\n`,
  );
} finally {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
