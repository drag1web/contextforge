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
import type { Database } from "sql.js";

import { SqliteStorageAdapter } from "../storage/SqliteStorageAdapter.js";
import type { StorageAdapter } from "../storage/types.js";
import type { TaskPackRevisionContent } from "../taskPacks/taskPackLifecycle.js";
import { createContextForgeMcpServer } from "./createContextForgeMcpServer.js";
import {
  CONTEXTFORGE_MCP_PROMPT_NAMES,
  CONTEXTFORGE_MCP_TOOL_NAMES,
  type McpResultEnvelope,
} from "./mcpContracts.js";
import { testContextForgeMcpConnection } from "./mcpIntegrationService.js";
import { silentMcpAuditLogger } from "./mcpAudit.js";
import type { TaskPackCreator } from "./mcpServices.js";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

function callEnvelope(result: Awaited<ReturnType<Client["callTool"]>>) {
  assert.ok(result.structuredContent, "tool result must include structuredContent");
  return result.structuredContent as unknown as McpResultEnvelope<Record<string, unknown>>;
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
    assert.equal(templates.resourceTemplates.length, 5);
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
    assert.equal(Object.hasOwn(created.provenance, "revisionId"), false);
    assert.equal(
      (created.data?.taskPack as { id?: number }).id,
      fixture.taskPack.id,
    );
  } finally {
    await successConnection.close();
  }
}

async function testRevisionReads(fixture: Awaited<ReturnType<typeof createFixture>>) {
  const { storage, project } = fixture;
  const content = (marker: string): TaskPackRevisionContent => ({
    sourceKind: "generated", rawTask: `  ${marker}_TASK\t\r\nпроверка  `,
    taskType: "backend", targetTool: "codex", generatedPrompt: `${marker}_PROMPT\n${"context ".repeat(250)}`,
    generationMode: "ollama", generationModel: `${marker}_MODEL`, generationMessage: `${marker}_MESSAGE`,
    generationUsedFallback: false, generationDurationMs: 27,
    generationRecipe: {
      template: { id: marker }, ruleProfile: { id: marker }, enabledRules: [marker],
      customRules: [marker], acceptanceCriteria: [marker], executionContract: { marker },
      selectorDiagnostics: { qualityStatus: marker === "REVISION_ONE" ? "blocked" : "ready",
        status: marker === "REVISION_ONE" ? "manual-review" : "ready",
        actual: { outcome: marker, selectedFiles: ["src/safe.ts"] } },
      generationDiagnostics: { marker, status: marker },
      localRoot: project.localPath, envFile: ".env.private", apiKey: "CREDENTIAL_SENTINEL",
      note: "password=TEXT_SECRET_SENTINEL", evidence: Array.from({ length: 105 }, (_, i) => i),
    },
    diagnostics: { selector: { marker }, generation: { marker, accessToken: "DIAGNOSTIC_SECRET_SENTINEL" },
      performance: { marker, localRoot: project.localPath } },
    groundedContextSnapshot: null, freshnessBasis: null,
  });
  const firstContent = content("REVISION_ONE"), secondContent = content("REVISION_TWO");
  const pack = await storage.createTaskPackWithInitialRevision({ projectId: project.id, title: "Revision fixture",
    revisionContent: firstContent, generatedAt: "2030-01-01T00:00:00.000Z", compatibilityGenerationRecipe: firstContent.generationRecipe! });
  const first = (await storage.getCurrentTaskPackRevision(pack.id))!;
  for (const [type, expectedReviewState, eventId, createdAt] of [
    ["start_review", "unreviewed", "mcp-review-a", "2030-01-02T00:00:00.000Z"],
    ["accept", "in_review", "mcp-review-b", "2030-01-03T00:00:00.000Z"],
  ] as const) {
    const aggregate = (await storage.getTaskPackAggregate(pack.id))!;
    await storage.transitionTaskPackRevisionReview({ taskPackId: pack.id, revisionId: first.id, expectedReviewState,
      expectedLifecycleVersion: aggregate.lifecycleVersion, transition: { type }, eventId, createdAt, source: "user",
      actorId: "REVIEW_ACTOR_SENTINEL", metadata: { marker: "REVIEW_EVENT_SENTINEL" } });
  }
  const second = await storage.appendTaskPackRevision({ ...secondContent, sourceKind: "manual_edit",
    taskPackId: pack.id, baseRevisionId: first.id, createdAt: "2030-01-04T00:00:00.000Z", generatedAt: null });
  await storage.createTaskPackGitHubCreatedIssueLink({ taskPackId: pack.id, owner: "fixture", repo: "example",
    fullName: "fixture/example", issueNumber: 9, issueTitle: "CURRENT_OVERLAY_SENTINEL", issueState: "open", labels: [],
    issueUrl: "https://github.com/fixture/example/issues/9", repositoryUrl: "https://github.com/fixture/example",
    createdAt: "2030-01-05T00:00:00.000Z" });
  const foreignPack = await storage.createTaskPack({ projectId: project.id, title: "FOREIGN_TITLE_SENTINEL",
    rawTask: "FOREIGN_BODY_SENTINEL", taskType: "general", targetTool: "generic", generatedPrompt: "FOREIGN_PROMPT_SENTINEL",
    generationMode: "template", generationModel: null, generationMessage: null, generationUsedFallback: false });
  const foreign = (await storage.getCurrentTaskPackRevision(foreignPack.id))!;
  const longContent = { ...content("LARGE"), rawTask: "x".repeat(12_010), generatedPrompt: "y".repeat(120_010) };
  const largePack = await storage.createTaskPackWithInitialRevision({ projectId: project.id, title: "Large revision",
    revisionContent: longContent, generatedAt: "2030-01-01T00:00:00.000Z", compatibilityGenerationRecipe: longContent.generationRecipe! });
  const large = (await storage.getCurrentTaskPackRevision(largePack.id))!;
  await storage.appendTaskPackRevision({ ...content("SMALL_CURRENT"), sourceKind: "manual_edit", taskPackId: largePack.id,
    baseRevisionId: large.id, createdAt: "2030-01-06T00:00:00.000Z", generatedAt: null });
  const aggregate = (await storage.getTaskPackAggregate(pack.id))!;
  await storage.transitionTaskPackAggregateLifecycle({ taskPackId: pack.id, expectedLifecycleVersion: aggregate.lifecycleVersion,
    transition: { type: "archive" }, eventId: "mcp-archive", source: "user", actorId: "LIFECYCLE_ACTOR_SENTINEL",
    metadata: { marker: "LIFECYCLE_EVENT_SENTINEL" }, createdAt: "2030-01-07T00:00:00.000Z" });
  await storage.createTaskPackDraft({ id: "mcp-private-draft", projectId: project.id, taskPackId: pack.id, baseRevisionId: second.id,
    expiresAt: null, content: { rawTask: "DRAFT_BODY_SENTINEL", taskType: "general", targetTool: "generic", templateId: null,
      ruleProfileId: null, enabledRuleIds: [], customRulesText: null, acceptanceCriteriaPresetId: null,
      acceptanceCriteriaText: null, clarifications: [], performanceSessionId: null, understandingSnapshotId: null,
      reviewedUnderstandingSnapshotId: null } });
  await fs.writeFile(path.join(project.localPath, "private-source.ts"), "SOURCE_BODY_SENTINEL");
  const db = (storage as unknown as { db: Database }).db;
  const persistedRows = () => ["projects", "project_memories", "task_packs", "task_pack_revisions",
    "task_pack_revision_review_events", "task_pack_lifecycle_events", "task_pack_drafts",
    "task_pack_github_created_issue_links", "app_settings"].map(table => db.exec(`SELECT * FROM ${table} ORDER BY 1`));
  // Compare logical records: the deliberate DROP TRIGGER/rollback corruption
  // probe can change sql.js's schema counter even though all data is restored.
  const before = persistedRows(), persistedBefore = await fs.readFile(fixture.databasePath);
  const originalHistoryRead = storage.getTaskPackRevisionHistorySnapshot;
  const originalCurrentRead = storage.getTaskPackById;
  const originalGlobalRead = storage.getTaskPackRevisionById;
  let historyReads = 0, currentReads = 0, globalReads = 0, scenarios = 0;
  storage.getTaskPackRevisionHistorySnapshot = async id => { historyReads++; return originalHistoryRead.call(storage, id); };
  storage.getTaskPackById = async id => { currentReads++; return originalCurrentRead.call(storage, id); };
  storage.getTaskPackRevisionById = async () => { globalReads++; throw new Error("Global revision lookup forbidden"); };
  const connection = await connectFixtureServer({ storage, allowCreateTaskPacks: false });
  type Envelope = McpResultEnvelope<Record<string, unknown>>;
  const get = async (args: Record<string, unknown> = {}) => callEnvelope(await connection.client.callTool({
    name: "contextforge_get_task_pack", arguments: { taskPackId: pack.id, ...args } }));
  const explain = async (args: Record<string, unknown> = {}) => callEnvelope(await connection.client.callTool({
    name: "contextforge_explain_task_pack", arguments: { taskPackId: pack.id, ...args } }));
  const task = (result: Envelope) => result.data!.taskPack as Record<string, unknown>;
  const readResource = async (uri: string): Promise<Envelope> => {
    const result = await connection.client.readResource({ uri });
    const entry = result.contents[0];
    assert.ok("text" in entry);
    return JSON.parse(entry.text) as Envelope;
  };
  const check = async (name: string, run: () => void | Promise<void>) => {
    await run(); scenarios++; console.log(`MCP revision ${scenarios}: ${name}`);
  };
  const assertPrivate = (result: unknown) => {
    const json = JSON.stringify(result);
    for (const forbidden of [project.localPath, "CREDENTIAL_SENTINEL", "TEXT_SECRET_SENTINEL", "DIAGNOSTIC_SECRET_SENTINEL",
      ".env.private", "SOURCE_BODY_SENTINEL", "REVIEW_EVENT_SENTINEL", "REVIEW_ACTOR_SENTINEL", "LIFECYCLE_EVENT_SENTINEL",
      "LIFECYCLE_ACTOR_SENTINEL", "DRAFT_BODY_SENTINEL", "mcp-private-draft", "FOREIGN_BODY_SENTINEL", "FOREIGN_TITLE_SENTINEL"]) {
      assert.equal(json.includes(forbidden), false, forbidden);
    }
    for (const forbidden of ["lifecycleVersion", "acceptedRevisionId", "reviewEvents", "lifecycleEvents", "revisions", "draftVersion"]) {
      assert.equal(json.includes(`"${forbidden}":`), false, forbidden);
    }
  };
  try {
    await check("legacy get retains current-only compatibility overlay, no revision provenance", async () => {
      const h = historyReads, c = currentReads, result = await get();
      assert.equal(result.ok, true); assert.equal(task(result).rawTask, second.rawTask);
      assert.equal(task(result).generatedPrompt, second.generatedPrompt);
      assert.ok(JSON.stringify(task(result).generationRecipe).includes("CURRENT_OVERLAY_SENTINEL"));
      assert.equal(Object.hasOwn(result.provenance, "revisionId"), false);
      assert.equal(Object.hasOwn(result.data!, "revision"), false);
      assert.equal(historyReads, h); assert.equal(currentReads, c + 1);
    });
    await check("legacy prompt/diagnostic controls unchanged", async () => {
      const hidden = await get({ includeGeneratedPrompt: false, includeDiagnostics: false });
      assert.equal(Object.hasOwn(task(hidden), "generatedPrompt"), false);
      assert.equal(Object.hasOwn(task(hidden).generationRecipe as object, "selectorDiagnostics"), false);
      const shown = await get({ includeDiagnostics: true, maxPromptChars: 1000 });
      assert.equal((task(shown).generationRecipe as Record<string, unknown>).generationDiagnostics !== undefined, true);
      assert.equal((shown.data!.truncation as Record<string, unknown>).returnedPromptChars, 1000);
    });
    await check("pinned old revision uses immutable body/generation, never current overlay", async () => {
      const h = historyReads, c = currentReads, result = await get({ revisionId: first.id, includeDiagnostics: true });
      assert.equal(result.ok, true); assert.equal(task(result).rawTask, first.rawTask);
      assert.equal(task(result).generatedPrompt, first.generatedPrompt);
      assert.deepEqual(task(result).generation, { mode: first.generationMode, model: first.generationModel,
        message: first.generationMessage, usedFallback: first.generationUsedFallback, durationMs: first.generationDurationMs });
      assert.equal(JSON.stringify(result).includes("REVISION_TWO"), false);
      assert.equal(JSON.stringify(result).includes("CURRENT_OVERLAY_SENTINEL"), false);
      assert.equal(historyReads, h + 1); assert.equal(currentReads, c); assertPrivate(result);
    });
    await check("closed exact revision metadata and full historical accepted replay", async () => {
      const result = await get({ revisionId: first.id });
      assert.notEqual(first.id, first.revisionNumber);
      assert.deepEqual(result.data!.revision, { revisionId: first.id, revisionNumber: 1, currentRevisionId: second.id,
        isCurrentRevision: false, baseRevisionId: null, sourceKind: first.sourceKind, reviewState: "accepted",
        contentHash: first.contentHash, createdAt: first.createdAt, generatedAt: first.generatedAt });
      assert.equal(result.provenance.taskPackId, pack.id); assert.equal(result.provenance.revisionId, first.id);
      assert.equal(result.provenance.projectId, project.id);
    });
    await check("explicit current revision is pinned, unreviewed independently of accepted history", async () => {
      const result = await get({ revisionId: second.id });
      assert.equal(task(result).rawTask, second.rawTask);
      assert.deepEqual(result.data!.revision, { revisionId: second.id, revisionNumber: 2, currentRevisionId: second.id,
        isCurrentRevision: true, baseRevisionId: first.id, sourceKind: "manual_edit", reviewState: "unreviewed",
        contentHash: second.contentHash, createdAt: second.createdAt, generatedAt: null });
      assert.equal(JSON.stringify(result).includes("CURRENT_OVERLAY_SENTINEL"), false);
    });
    await check("taskPack timestamps keep aggregate meaning, revision timestamp is separate", async () => {
      const result = await get({ revisionId: first.id }), a = (await storage.getTaskPackAggregate(pack.id))!;
      assert.equal(task(result).createdAt, a.createdAt); assert.equal(task(result).updatedAt, a.updatedAt);
      assert.equal((result.data!.revision as Record<string, unknown>).createdAt, first.createdAt);
      assert.notEqual(task(result).updatedAt, first.createdAt);
    });
    await check("missing and foreign revisions have identical safe error, no ownership leak", async () => {
      const missing = await get({ revisionId: 999999 }), cross = await get({ revisionId: foreign.id });
      assert.deepEqual(cross.error, missing.error);
      assert.deepEqual(cross.error, { code: "MCP_TASK_PACK_REVISION_NOT_FOUND",
        message: "Task Pack revision does not exist for the requested Task Pack." });
      assert.equal(cross.provenance.taskPackId, pack.id); assert.equal(cross.provenance.revisionId, foreign.id);
      assertPrivate(cross);
      assert.deepEqual((await explain({ revisionId: foreign.id })).error, missing.error);
    });
    await check("missing aggregate retains old error on current/pinned get/explain", async () => {
      for (const read of [get, explain]) for (const ids of [{ taskPackId: 999999 }, { taskPackId: 999999, revisionId: first.id }]) {
        assert.equal((await read(ids)).error?.code, "MCP_TASK_PACK_NOT_FOUND");
      }
    });
    await check("historical prompt omission and accurate truncation counters", async () => {
      const result = await get({ revisionId: first.id, includeGeneratedPrompt: false });
      assert.equal(Object.hasOwn(task(result), "generatedPrompt"), false);
      const t = result.data!.truncation as Record<string, unknown>;
      assert.equal(t.truncated, false); assert.equal(t.returnedPromptChars, 0); assert.equal(t.originalPromptChars, first.generatedPrompt.length);
    });
    await check("historical raw/prompt limits share existing helper and warnings", async () => {
      const result = await get({ taskPackId: largePack.id, revisionId: large.id, maxPromptChars: 1000 });
      assert.deepEqual(result.data!.truncation, { truncated: true, returnedPromptChars: 1000, originalPromptChars: 120010,
        maxPromptChars: 1000, rawTaskTruncated: true, returnedRawTaskChars: 12000, originalRawTaskChars: 12010 });
      assert.equal(task(result).rawTask, longContent.rawTask.slice(0, 12000));
      assert.equal(task(result).generatedPrompt, longContent.generatedPrompt.slice(0, 1000));
      assert.ok(result.warnings.includes("MCP_TASK_PACK_PROMPT_TRUNCATED")); assert.ok(result.warnings.includes("MCP_TASK_PACK_RAW_TASK_TRUNCATED"));
      const max = await get({ taskPackId: largePack.id, revisionId: large.id, maxPromptChars: 120000 });
      assert.equal((task(max).generatedPrompt as string).length, 120000);
    });
    await check("historical recipe diagnostics suppressed by default/false, exact own diagnostics opt-in", async () => {
      for (const includeDiagnostics of [undefined, false]) {
        const result = await get({ revisionId: first.id, ...(includeDiagnostics === undefined ? {} : { includeDiagnostics }) });
        assert.equal(Object.hasOwn(task(result), "diagnostics"), false);
        assert.equal(Object.hasOwn(task(result).generationRecipe as object, "generationDiagnostics"), false);
        assert.equal(Object.hasOwn(task(result).generationRecipe as object, "selectorDiagnostics"), false);
      }
      for (const revision of [first, second]) {
        const result = await get({ revisionId: revision.id, includeDiagnostics: true });
        const marker = revision === first ? "REVISION_ONE" : "REVISION_TWO";
        assert.equal((task(result).diagnostics as { selector: { marker: string } }).selector.marker, marker);
        assert.ok(JSON.stringify(task(result).generationRecipe).includes(marker));
        assertPrivate(result);
      }
    });
    await check("historical sanitizer redacts secrets/paths and bounds arrays without new source reads", async () => {
      const result = await get({ revisionId: first.id, includeDiagnostics: true }); assertPrivate(result);
      const recipe = task(result).generationRecipe as Record<string, unknown>;
      assert.equal(recipe.localRoot, "<local-path>"); assert.equal(recipe.envFile, "[redacted-secret-path]");
      assert.equal(recipe.apiKey, "[redacted]"); assert.equal(recipe.note, "password=[redacted]");
      assert.equal((recipe.evidence as unknown[]).length, 100);
    });
    await check("each pinned explain uses its own recipe/selection/quality, not current workflow", async () => {
      for (const revision of [first, second]) {
        const result = await explain({ revisionId: revision.id }), marker = revision === first ? "REVISION_ONE" : "REVISION_TWO";
        assert.equal(result.ok, true); assert.deepEqual(result.data!.template, { id: marker });
        assert.deepEqual(result.data!.ruleProfile, { id: marker }); assert.deepEqual(result.data!.executionContract, { marker });
        assert.deepEqual(result.data!.enabledRules, [marker]); assert.deepEqual(result.data!.customRules, [marker]);
        assert.deepEqual(result.data!.acceptanceCriteria, [marker]);
        assert.equal(result.data!.qualityStatus, revision === first ? "blocked" : "ready");
        assert.equal(result.warnings.includes("MCP_CONTEXT_SELECTION_BLOCKED"), revision === first);
        assert.equal(result.warnings.includes("MCP_MANUAL_REVIEW_REQUIRED"), revision === first);
        assert.equal((result.data!.generationDiagnostics as Record<string, unknown>).marker, marker);
        assert.equal((result.data!.revision as Record<string, unknown>).revisionId, revision.id);
        assert.equal(result.provenance.revisionId, revision.id); assert.equal(result.data!.usedProjectMemories, "unavailable");
        assert.ok(result.warnings.includes("Project Memory usage was not persisted for this Task Pack.")); assertPrivate(result);
      }
    });
    await check("legacy explain uses current compatibility read with no fabricated revision", async () => {
      const h = historyReads, c = currentReads, result = await explain();
      assert.deepEqual(result.data!.template, { id: "REVISION_TWO" });
      assert.equal(Object.hasOwn(result.data!, "revision"), false); assert.equal(Object.hasOwn(result.provenance, "revisionId"), false);
      assert.equal(historyReads, h); assert.equal(currentReads, c + 1);
    });
    await check("legacy/no-recipe pinned explain preserves unavailable warnings", async () => {
      const result = await explain({ taskPackId: foreignPack.id, revisionId: foreign.id });
      assert.equal(result.data!.selection, "unavailable"); assert.equal(result.data!.executionContract, "unavailable");
      assert.ok(result.warnings.includes("This Task Pack predates stored generation recipe metadata."));
      assert.ok(result.warnings.includes("Execution contract metadata is unavailable for this Task Pack."));
      assert.ok(result.warnings.includes("Project Memory usage was not persisted for this Task Pack."));
    });
    await check("current resource remains compatibility/current, pinned resource is exact historical", async () => {
      const current = await readResource(`contextforge://task-packs/${pack.id}`);
      assert.equal(task(current).rawTask, second.rawTask); assert.equal(Object.hasOwn(current.provenance, "revisionId"), false);
      assert.ok(JSON.stringify(current).includes("CURRENT_OVERLAY_SENTINEL"));
      const historical = await readResource(`contextforge://task-packs/${pack.id}/revisions/${first.id}`);
      assert.equal(task(historical).rawTask, first.rawTask); assert.equal(historical.provenance.revisionId, first.id);
      assert.equal(Object.hasOwn(task(historical), "diagnostics"), false); assertPrivate(historical);
    });
    await check("foreign/absent revision resources share safe protocol InvalidRequest", async () => {
      const failures: string[] = [];
      for (const id of [foreign.id, 999999]) await assert.rejects(
        () => readResource(`contextforge://task-packs/${pack.id}/revisions/${id}`), (error: unknown) => {
          assert.ok(error instanceof Error); assert.equal((error as Error & { code: number }).code, -32600);
          assert.ok(error.message.includes("MCP_TASK_PACK_REVISION_NOT_FOUND"));
          assert.equal(error.message.includes("FOREIGN"), false); failures.push(error.message); return true;
        });
      assert.equal(failures[0], failures[1]);
    });
    await check("discovery keeps seven tools, five templates, only aggregate/current listed URIs", async () => {
      const tools = await connection.client.listTools(), templates = await connection.client.listResourceTemplates();
      assert.deepEqual(tools.tools.map(t => t.name).sort(), [...CONTEXTFORGE_MCP_TOOL_NAMES].sort());
      assert.equal(tools.tools.length, 7); assert.equal(templates.resourceTemplates.length, 5);
      assert.ok(templates.resourceTemplates.some(t => t.uriTemplate === "contextforge://task-packs/{taskPackId}/revisions/{revisionId}"));
      for (const name of ["contextforge_create_task_pack", "contextforge_list_task_packs"]) {
        assert.equal(Object.hasOwn(tools.tools.find(t => t.name === name)!.inputSchema.properties!, "revisionId"), false);
      }
      const listed = await connection.client.listResources();
      assert.ok(listed.resources.some(r => r.uri === `contextforge://task-packs/${pack.id}`));
      assert.equal(listed.resources.some(r => r.uri.includes("/revisions/")), false);
    });
    await check("existing valid project/memory/task-pack resource templates remain readable", async () => {
      for (const suffix of ["", "/memory", "/task-packs"]) {
        assert.equal((await readResource(`contextforge://projects/${project.id}${suffix}`)).ok, true);
      }
    });
    for (const invalid of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "41", NaN, Infinity]) {
      await check(`tool revisionId ${String(invalid)} rejected before storage`, async () => {
        const h = historyReads, c = currentReads;
        for (const name of ["contextforge_get_task_pack", "contextforge_explain_task_pack"]) {
          const result = await connection.client.callTool({ name, arguments: { taskPackId: pack.id, revisionId: invalid } });
          assert.equal(result.isError, true); assert.equal(result.structuredContent, undefined);
        }
        assert.equal(historyReads, h); assert.equal(currentReads, c);
      });
    }
    for (const invalid of ["0", "-1", "1.5", String(Number.MAX_SAFE_INTEGER + 1), "12abc", "1e2"]) {
      await check(`resource identities ${invalid} rejected strictly before storage`, async () => {
        const h = historyReads, c = currentReads;
        for (const uri of [`contextforge://task-packs/${pack.id}/revisions/${invalid}`,
          `contextforge://task-packs/${invalid}/revisions/${first.id}`, `contextforge://task-packs/${invalid}`]) {
          // URI parsing rejects before lookup with safe protocol InvalidParams.
          await assert.rejects(() => readResource(uri), (error: unknown) => {
            assert.ok(error instanceof Error); assert.equal((error as Error & { code: number }).code, -32602);
            assert.ok(error.message.includes("MCP_INVALID_INPUT")); return true;
          });
        }
        assert.equal(historyReads, h); assert.equal(currentReads, c);
      });
    }
    await check("current list remains body/history/draft-free and requires no history reads", async () => {
      const h = historyReads, result = callEnvelope(await connection.client.callTool({ name: "contextforge_list_task_packs", arguments: {} }));
      assert.equal(historyReads, h); assert.equal(result.provenance.revisionId, undefined);
      for (const key of ["generatedPrompt", "revision", "revisions", "reviewEvents", "lifecycleEvents", "draftId", "diagnostics"]) {
        assert.equal(JSON.stringify(result).includes(`"${key}":`), false);
      }
      assert.equal(JSON.stringify(result).includes("DRAFT_BODY_SENTINEL"), false);
    });
    await check("corrupt OTHER history row fails whole get/explain/resource, not revision-not-found", async () => {
      db.run("SAVEPOINT mcp_corruption; DROP TRIGGER task_pack_revisions_immutable;");
      try {
        db.run("UPDATE task_pack_revisions SET content_hash = ? WHERE id = ?", [`sha256:${"0".repeat(64)}`, second.id]);
        for (const result of [await get({ revisionId: first.id }), await explain({ revisionId: first.id }),
          await get({ revisionId: 999999 }), await readResource(`contextforge://task-packs/${pack.id}/revisions/${first.id}`)]) {
          assert.equal(result.error?.code, "MCP_INTERNAL_ERROR");
          assert.equal(result.error?.message, "ContextForge could not complete the MCP operation.");
          assertPrivate(result); assert.equal(JSON.stringify(result).includes("content_hash"), false);
        }
      } finally { db.run("ROLLBACK TO mcp_corruption; RELEASE mcp_corruption;"); }
    });
    await check("unexpected driver failure is safe internal, never absence or raw error", async () => {
      storage.getTaskPackRevisionHistorySnapshot = async () => {
        throw new Error(`SQL PRIVATE_FAILURE at ${project.localPath}`, { cause: new Error("PRIVATE_CAUSE") });
      };
      try {
        for (const result of [await get({ revisionId: first.id }), await explain({ revisionId: first.id }),
          await readResource(`contextforge://task-packs/${pack.id}/revisions/${first.id}`)]) {
          assert.deepEqual(result.error, { code: "MCP_INTERNAL_ERROR", message: "ContextForge could not complete the MCP operation." });
          for (const forbidden of ["PRIVATE_FAILURE", "PRIVATE_CAUSE", "SQL", "stack", "cause"]) {
            assert.equal(JSON.stringify(result).includes(forbidden), false);
          }
          assertPrivate(result);
        }
      } finally { storage.getTaskPackRevisionHistorySnapshot = async id => { historyReads++; return originalHistoryRead.call(storage, id); }; }
    });
    await check("complete review replay required even when selected current revision has zero events", async () => {
      db.run("SAVEPOINT mcp_review_corruption; DROP TRIGGER task_pack_revision_review_events_immutable;");
      try {
        // The accepted tail alone is not a valid chain; an unrelated current
        // revision may not hide that corruption in the requested pack history.
        db.run("DELETE FROM task_pack_revision_review_events WHERE id = 'mcp-review-a'");
        for (const result of [await get({ revisionId: second.id }), await explain({ revisionId: second.id })]) {
          assert.equal(result.error?.code, "MCP_INTERNAL_ERROR"); assertPrivate(result);
        }
      } finally { db.run("ROLLBACK TO mcp_review_corruption; RELEASE mcp_review_corruption;"); }
    });
    await check("revision reads never use global revision lookup, mutate or persist", async () => {
      assert.equal(globalReads, 0); assert.deepEqual(persistedRows(), before);
      assert.deepEqual(await fs.readFile(fixture.databasePath), persistedBefore);
      const source = await fs.readFile(path.join(moduleDirectory, "mcpServices.ts"), "utf8");
      const resolver = source.slice(source.indexOf("private async resolveTaskPackRead"), source.indexOf("private async requireTaskPack"));
      assert.ok(resolver.indexOf("validateTaskPackRevisionHistorySnapshot") < resolver.indexOf(".findIndex("));
      for (const forbidden of ["getTaskPackRevisionById", "listActiveTaskPackDrafts", "readFile", "writeFile", "child_process"]) {
        assert.equal(source.includes(forbidden), false);
      }
    });
    console.log(`ContextForge MCP revision smoke passed: ${scenarios} scenarios (real SQLite + MCP SDK transport).`);
  } finally {
    storage.getTaskPackRevisionHistorySnapshot = originalHistoryRead;
    storage.getTaskPackById = originalCurrentRead;
    storage.getTaskPackRevisionById = originalGlobalRead;
    await connection.close();
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
    await testRevisionReads(fixture);
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
