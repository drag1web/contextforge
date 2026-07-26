import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";

import { SqliteStorageAdapter } from "../storage/SqliteStorageAdapter.js";
import type { StorageAdapter } from "../storage/types.js";
import { createContextForgeMcpServer } from "./createContextForgeMcpServer.js";
import {
  CONTEXTFORGE_MCP_PROMPT_NAMES,
  CONTEXTFORGE_MCP_TOOL_NAMES,
} from "./mcpContracts.js";
import { testContextForgeMcpConnection } from "./mcpIntegrationService.js";
import { silentMcpAuditLogger } from "./mcpAudit.js";
import type { TaskPackCreator } from "./mcpServices.js";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

function callEnvelope(result: Awaited<ReturnType<Client["callTool"]>>) {
  assert.ok(result.structuredContent, "tool result must include structuredContent");
  return result.structuredContent as {
    ok: boolean;
    operation: string;
    data?: Record<string, unknown>;
    error?: { code: string; message: string };
  };
}

async function createFixture() {
  const tempDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "contextforge-mcp-smoke-"),
  );
  const databasePath = path.join(tempDirectory, "contextforge.sqlite");
  const projectPath = path.join(tempDirectory, "fixture-project");
  await fs.mkdir(projectPath, { recursive: true });
  const storage = new SqliteStorageAdapter(databasePath);
  await storage.ensureSchema();
  const project = await storage.upsertScannedProject({
    name: "MCP fixture",
    localPath: projectPath,
    packageManager: "npm",
    detectedStack: ["TypeScript", "Node.js"],
    scripts: { build: "tsc", test: "node test.js" },
    readinessScore: 86,
    readinessReport: {
      score: 86,
      checks: [
        {
          key: "tests",
          label: "Tests",
          passed: true,
          points: 10,
          message: "Tests detected",
        },
      ],
      issues: [],
      signals: {
        packageFiles: ["package.json"],
        docs: ["README.md"],
        envExamples: [".env.example", "C:\\private\\.env"],
        testFiles: ["src/example.test.ts"],
        testConfigs: [],
        ciFiles: [],
        lockFiles: ["package-lock.json"],
        configs: ["tsconfig.json"],
        directories: ["src"],
        commands: {
          dev: null,
          build: "npm run build",
          test: "npm test",
          typecheck: "tsc --noEmit",
          lint: null,
        },
        packages: [],
        inventory: {
          totalFiles: 5,
          totalDirectories: 1,
          truncated: false,
          maxDepth: 5,
          maxEntries: 100,
        },
      },
    },
  });
  await storage.createProjectMemory({
    projectId: project.id,
    title: "Architecture",
    content: "Use the existing storage adapter.",
    category: "architecture",
    isEnabled: true,
  });
  await storage.createProjectMemory({
    projectId: project.id,
    title: "Disabled note",
    content: "This record must remain hidden.",
    category: "custom",
    isEnabled: false,
  });
  const longPrompt = `BEGIN_PROMPT\n${"verified context ".repeat(1_000)}END_PROMPT`;
  const taskPack = await storage.createTaskPack({
    projectId: project.id,
    title: "Fixture Task Pack",
    rawTask: "Implement the fixture MCP integration safely.",
    taskType: "backend",
    targetTool: "codex",
    generatedPrompt: longPrompt,
    generationMode: "template",
    generationModel: null,
    generationMessage: null,
    generationUsedFallback: false,
    generationDurationMs: 25,
    generationRecipe: {
      selectorDiagnostics: {
        actual: { outcome: "selected" },
        contextQuality: { status: "ready" },
      },
      enabledRules: [{ id: "safe", title: "Safe", category: "general" }],
    },
  });
  await storage.setSettingValue("mcp_enabled", true);
  await storage.setSettingValue("mcp_allow_create_task_packs", false);

  return {
    tempDirectory,
    databasePath,
    storage,
    project,
    taskPack,
    longPrompt,
  };
}

async function connectFixtureServer(input: {
  storage: StorageAdapter;
  allowCreateTaskPacks: boolean;
  taskPackCreator?: TaskPackCreator;
}) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const bundle = await createContextForgeMcpServer({
    storage: input.storage,
    permissions: {
      enabled: true,
      readProjects: true,
      readProjectMemory: true,
      readTaskPacks: true,
      allowCreateTaskPacks: input.allowCreateTaskPacks,
    },
    audit: silentMcpAuditLogger,
    taskPackCreator: input.taskPackCreator,
  });
  const client = new Client({ name: "mcp-smoke", version: "1.0.0" });
  await bundle.server.connect(serverTransport);
  await client.connect(clientTransport);

  return {
    client,
    async close() {
      await client.close();
      await bundle.server.close().catch(() => undefined);
    },
  };
}

async function testRoundTrip(fixture: Awaited<ReturnType<typeof createFixture>>) {
  const connection = await connectFixtureServer({
    storage: fixture.storage,
    allowCreateTaskPacks: false,
  });

  try {
    assert.ok(connection.client.getServerVersion(), "initialize must complete");
    assert.ok(
      (connection.client.getInstructions() ?? "").slice(0, 512).includes(
        "contextforge_list_projects",
      ),
      "the first 512 instruction characters must be self-contained",
    );
    const [tools, resources, templates, prompts] = await Promise.all([
      connection.client.listTools(),
      connection.client.listResources(),
      connection.client.listResourceTemplates(),
      connection.client.listPrompts(),
    ]);

    assert.deepEqual(
      tools.tools.map((tool) => tool.name).sort(),
      [...CONTEXTFORGE_MCP_TOOL_NAMES].sort(),
    );
    assert.ok(resources.resources.some((resource) => resource.uri === "contextforge://projects"));
    assert.equal(templates.resourceTemplates.length, 4);
    assert.deepEqual(
      prompts.prompts.map((prompt) => prompt.name).sort(),
      [...CONTEXTFORGE_MCP_PROMPT_NAMES].sort(),
    );
    const projectsResource = await connection.client.readResource({
      uri: "contextforge://projects",
    });
    assert.equal(projectsResource.contents.length, 1);
    const workflowPrompt = await connection.client.getPrompt({
      name: "contextforge_prepare_implementation",
      arguments: {
        projectId: String(fixture.project.id),
        task: "Implement the fixture safely.",
      },
    });
    assert.equal(workflowPrompt.messages.length, 1);

    const listProjects = callEnvelope(
      await connection.client.callTool({
        name: "contextforge_list_projects",
        arguments: {},
      }),
    );
    assert.equal(listProjects.ok, true);
    assert.equal(JSON.stringify(listProjects).includes(fixture.project.localPath), false);

    const overview = callEnvelope(
      await connection.client.callTool({
        name: "contextforge_get_project_overview",
        arguments: { projectId: fixture.project.id },
      }),
    );
    assert.equal(overview.ok, true);
    assert.equal(JSON.stringify(overview).includes("C:\\private\\.env"), false);

    const invalidOverview = callEnvelope(
      await connection.client.callTool({
        name: "contextforge_get_project_overview",
        arguments: { projectId: 999_999 },
      }),
    );
    assert.equal(invalidOverview.error?.code, "MCP_PROJECT_NOT_FOUND");

    const memory = callEnvelope(
      await connection.client.callTool({
        name: "contextforge_list_project_memory",
        arguments: { projectId: fixture.project.id, enabledOnly: true },
      }),
    );
    const memoryJson = JSON.stringify(memory);
    assert.equal(memoryJson.includes("Architecture"), true);
    assert.equal(memoryJson.includes("Disabled note"), false);

    const listTaskPacks = callEnvelope(
      await connection.client.callTool({
        name: "contextforge_list_task_packs",
        arguments: { projectId: fixture.project.id },
      }),
    );
    assert.equal(JSON.stringify(listTaskPacks).includes("BEGIN_PROMPT"), false);

    const hiddenPrompt = callEnvelope(
      await connection.client.callTool({
        name: "contextforge_get_task_pack",
        arguments: {
          taskPackId: fixture.taskPack.id,
          includeGeneratedPrompt: false,
        },
      }),
    );
    assert.equal(JSON.stringify(hiddenPrompt).includes("BEGIN_PROMPT"), false);

    const boundedPrompt = callEnvelope(
      await connection.client.callTool({
        name: "contextforge_get_task_pack",
        arguments: {
          taskPackId: fixture.taskPack.id,
          includeGeneratedPrompt: true,
          maxPromptChars: 1_000,
        },
      }),
    );
    assert.equal(
      (boundedPrompt.data?.truncation as { truncated?: boolean }).truncated,
      true,
    );

    const writeDenied = callEnvelope(
      await connection.client.callTool({
        name: "contextforge_create_task_pack",
        arguments: {
          projectId: fixture.project.id,
          rawTask: "Create a safe Task Pack.",
          confirmCreate: true,
        },
      }),
    );
    assert.equal(writeDenied.error?.code, "MCP_WRITE_DISABLED");
  } finally {
    await connection.close();
  }
}

async function testCreateGuards(
  fixture: Awaited<ReturnType<typeof createFixture>>,
) {
  let creatorCalls = 0;
  const creator = (async () => {
    creatorCalls += 1;
    return { kind: "blocked", message: "Selection is blocked." } as never;
  }) as TaskPackCreator;
  const connection = await connectFixtureServer({
    storage: fixture.storage,
    allowCreateTaskPacks: true,
    taskPackCreator: creator,
  });

  try {
    const confirmation = callEnvelope(
      await connection.client.callTool({
        name: "contextforge_create_task_pack",
        arguments: {
          projectId: fixture.project.id,
          rawTask: "Create a safe Task Pack.",
          confirmCreate: false,
        },
      }),
    );
    assert.equal(confirmation.error?.code, "MCP_CONFIRMATION_REQUIRED");
    assert.equal(creatorCalls, 0);

    const blocked = callEnvelope(
      await connection.client.callTool({
        name: "contextforge_create_task_pack",
        arguments: {
          projectId: fixture.project.id,
          rawTask: "Create a safe Task Pack.",
          confirmCreate: true,
        },
      }),
    );
    assert.equal(blocked.error?.code, "MCP_CONTEXT_SELECTION_BLOCKED");
  } finally {
    await connection.close();
  }

  const clarificationConnection = await connectFixtureServer({
    storage: fixture.storage,
    allowCreateTaskPacks: true,
    taskPackCreator: (async () => ({
      kind: "clarification_required",
      message: "Choose the exact implementation target.",
    })) as unknown as TaskPackCreator,
  });
  try {
    const clarification = callEnvelope(
      await clarificationConnection.client.callTool({
        name: "contextforge_create_task_pack",
        arguments: {
          projectId: fixture.project.id,
          rawTask: "Create a safe Task Pack.",
          confirmCreate: true,
        },
      }),
    );
    assert.equal(clarification.error?.code, "MCP_CLARIFICATION_REQUIRED");
  } finally {
    await clarificationConnection.close();
  }

  const successConnection = await connectFixtureServer({
    storage: fixture.storage,
    allowCreateTaskPacks: true,
    taskPackCreator: (async () => ({
      kind: "created",
      taskPack: fixture.taskPack,
    })) as unknown as TaskPackCreator,
  });
  try {
    const created = callEnvelope(
      await successConnection.client.callTool({
        name: "contextforge_create_task_pack",
        arguments: {
          projectId: fixture.project.id,
          rawTask: "Create a safe Task Pack.",
          confirmCreate: true,
        },
      }),
    );
    assert.equal(created.ok, true);
    assert.equal(
      (created.data?.taskPack as { id?: number }).id,
      fixture.taskPack.id,
    );
  } finally {
    await successConnection.close();
  }
}

async function testRawStdio(
  fixture: Awaited<ReturnType<typeof createFixture>>,
) {
  const sourceEntrypoint = path.join(moduleDirectory, "index.ts");
  const tsxCli = path.resolve(
    moduleDirectory,
    "..",
    "..",
    "..",
    "node_modules",
    "tsx",
    "dist",
    "cli.mjs",
  );
  const child = spawn(
    process.execPath,
    [tsxCli, sourceEntrypoint],
    {
      cwd: os.tmpdir(),
      env: {
        ...process.env,
        STORAGE_DRIVER: "sqlite",
        SQLITE_DB_PATH: fixture.databasePath,
        CONTEXTFORGE_MCP_ENABLED: "true",
        CONTEXTFORGE_MCP_ALLOW_CREATE_TASK_PACKS: "false",
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  child.stdin.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "raw-stdio-smoke", version: "1.0.0" },
      },
    })}\n`,
  );

  const deadline = Date.now() + 8_000;
  while (!stdout.includes("\n") && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(
    stdout.trim(),
    `stdio server must return initialize JSON-RPC; stderr=${stderr}`,
  );
  for (const line of stdout.trim().split(/\r?\n/)) {
    assert.doesNotThrow(() => JSON.parse(line), `stdout contained a non-JSON log: ${line}`);
  }

  const exitPromise = new Promise<number | null>((resolve) => {
    child.once("exit", (code) => resolve(code));
  });
  child.kill("SIGINT");
  const exitCode = await Promise.race([
    exitPromise,
    new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), 5_000),
    ),
  ]);
  if (exitCode === "timeout") {
    child.kill();
  }
  assert.notEqual(exitCode, "timeout", "stdio server must stop after SIGINT");
}

async function reserveTcpPort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

async function testHttpTaskPackContract(
  fixture: Awaited<ReturnType<typeof createFixture>>,
) {
  const port = await reserveTcpPort();
  const tsxCli = path.resolve(
    moduleDirectory,
    "..",
    "..",
    "..",
    "node_modules",
    "tsx",
    "dist",
    "cli.mjs",
  );
  const httpEntrypoint = path.resolve(moduleDirectory, "..", "index.ts");
  const child = spawn(process.execPath, [tsxCli, httpEntrypoint], {
    cwd: os.tmpdir(),
    env: {
      ...process.env,
      SERVER_PORT: String(port),
      STORAGE_DRIVER: "sqlite",
      SQLITE_DB_PATH: fixture.databasePath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    output += chunk;
  });

  try {
    const deadline = Date.now() + 8_000;
    let ready = false;
    while (!ready && Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`);
        ready = response.ok;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
    }
    assert.equal(ready, true, `HTTP fixture server did not start: ${output}`);

    const invalidResponse = await fetch(
      `http://127.0.0.1:${port}/api/task-packs`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    const invalidBody = (await invalidResponse.json()) as {
      ok?: boolean;
      message?: string;
    };
    assert.equal(invalidResponse.status, 400);
    assert.equal(invalidBody.ok, false);
    assert.equal(invalidBody.message, "Invalid request body");

    const notFoundResponse = await fetch(
      `http://127.0.0.1:${port}/api/task-packs`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: 999_999,
          rawTask: "Verify the existing HTTP Task Pack contract.",
          taskType: "general",
          targetTool: "generic",
        }),
      },
    );
    const notFoundBody = (await notFoundResponse.json()) as {
      ok?: boolean;
      message?: string;
    };
    assert.equal(notFoundResponse.status, 404);
    assert.equal(notFoundBody.ok, false);
    assert.equal(notFoundBody.message, "Project not found");
  } finally {
    const exitPromise = new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
    });
    child.kill("SIGTERM");
    await Promise.race([
      exitPromise,
      new Promise<void>((resolve) => setTimeout(resolve, 3_000)),
    ]);
    if (child.exitCode === null) child.kill();
  }
}

async function main() {
  const fixture = await createFixture();

  try {
    await testRoundTrip(fixture);
    await testCreateGuards(fixture);
    await testRawStdio(fixture);
    await testHttpTaskPackContract(fixture);
    const endpointTest = await testContextForgeMcpConnection(fixture.storage, {
      timeoutMs: 10_000,
      forceSource: true,
      environment: {
        STORAGE_DRIVER: "sqlite",
        SQLITE_DB_PATH: fixture.databasePath,
      },
    });
    assert.equal(endpointTest.ok, true);
    assert.deepEqual(
      endpointTest.tools.sort(),
      [...CONTEXTFORGE_MCP_TOOL_NAMES].sort(),
    );
    console.log("ContextForge MCP smoke tests passed.");
  } finally {
    await fs.rm(fixture.tempDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
