import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs";
import path from "node:path";

import { config } from "../config/index.js";
import { storage as defaultStorage } from "../storage/index.js";
import type { StorageAdapter } from "../storage/types.js";
import {
  CONTEXTFORGE_MCP_PROMPT_NAMES,
  CONTEXTFORGE_MCP_SERVER_NAME,
  CONTEXTFORGE_MCP_TOOL_NAMES,
} from "./mcpContracts.js";
import {
  contextForgeApplicationRoot,
  getContextForgeMcpLaunchConfiguration,
} from "./mcpConfig.js";
import {
  readContextForgeMcpPermissions,
  updateContextForgeMcpPermissions,
} from "./mcpPermissions.js";

export interface ContextForgeMcpTestResult {
  ok: boolean;
  testedAt: string;
  durationMs: number;
  protocolVersion: string | null;
  server: { name: string; version: string } | null;
  tools: string[];
  resources: string[];
  resourceTemplates: string[];
  prompts: string[];
  message: string;
}

const LAST_TEST_SETTING_KEY = "mcp_last_test";

function inheritedEnvironment() {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

export async function getContextForgeMcpStatus(
  storage: StorageAdapter = defaultStorage,
) {
  const [permissions, lastTest] = await Promise.all([
    readContextForgeMcpPermissions(storage),
    storage.getSettingValue<ContextForgeMcpTestResult | null>(
      LAST_TEST_SETTING_KEY,
      null,
    ),
  ]);
  const launch = getContextForgeMcpLaunchConfiguration();

  return {
    supported: true,
    enabled: permissions.enabled,
    transport: "stdio" as const,
    serverName: CONTEXTFORGE_MCP_SERVER_NAME,
    version: config.appVersion,
    readOnly: !permissions.allowCreateTaskPacks,
    permissions: {
      readProjects: permissions.readProjects,
      readProjectMemory: permissions.readProjectMemory,
      readTaskPacks: permissions.readTaskPacks,
      allowCreateTaskPacks: permissions.allowCreateTaskPacks,
    },
    allowCreateTaskPacks: permissions.allowCreateTaskPacks,
    entrypoint: {
      ready: launch.builtEntrypointReady,
      sourceReady: launch.sourceEntrypointReady,
      status: launch.builtEntrypointReady ? "ready" : "needs_build",
    },
    databasePathConfigured: launch.databasePathConfigured,
    command: launch.command,
    args: launch.args,
    envKeys: launch.envKeys,
    codexRegistrationCommand: launch.codexRegistrationCommand,
    codexConfigSnippet: launch.codexConfigSnippet,
    warnings: launch.warnings,
    expected: {
      tools: [...CONTEXTFORGE_MCP_TOOL_NAMES],
      prompts: [...CONTEXTFORGE_MCP_PROMPT_NAMES],
    },
    lastTest,
  };
}

export async function updateContextForgeMcpSettings(
  input: { enabled?: boolean; allowCreateTaskPacks?: boolean },
  storage: StorageAdapter = defaultStorage,
) {
  await updateContextForgeMcpPermissions(storage, input);
  return getContextForgeMcpStatus(storage);
}

export async function testContextForgeMcpConnection(
  storage: StorageAdapter = defaultStorage,
  options: {
    timeoutMs?: number;
    environment?: Record<string, string>;
    forceSource?: boolean;
  } = {},
) {
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 12_000, 1_000), 30_000);
  const permissions = await readContextForgeMcpPermissions(storage);
  const launch = getContextForgeMcpLaunchConfiguration();
  const startedAt = Date.now();

  if (!permissions.enabled) {
    throw new Error("ContextForge MCP is disabled.");
  }
  const overriddenSqlitePath = options.environment?.SQLITE_DB_PATH;
  const databasePathConfigured = overriddenSqlitePath
    ? fs.existsSync(overriddenSqlitePath)
    : launch.databasePathConfigured;

  if (!databasePathConfigured) {
    throw new Error("The configured ContextForge database is unavailable.");
  }
  if (!launch.builtEntrypointReady && !launch.sourceEntrypointReady) {
    throw new Error("ContextForge MCP entrypoint is unavailable.");
  }

  const tsxCli = path.join(
    contextForgeApplicationRoot,
    "node_modules",
    "tsx",
    "dist",
    "cli.mjs",
  );
  const args = launch.builtEntrypointReady && !options.forceSource
    ? [launch.builtEntrypoint]
    : [tsxCli, launch.sourceEntrypoint];
  const transport = new StdioClientTransport({
    command: process.execPath,
    args,
    env: {
      ...inheritedEnvironment(),
      ...launch.env,
      ...options.environment,
      CONTEXTFORGE_MCP_ENABLED: "true",
      CONTEXTFORGE_MCP_ALLOW_CREATE_TASK_PACKS: "false",
    },
    stderr: "pipe",
  });
  const client = new Client({
    name: "contextforge-desktop-handshake",
    version: config.appVersion,
  });
  transport.stderr?.on("data", () => undefined);

  try {
    await client.connect(transport, { timeout: timeoutMs });
    const [toolsResult, resourcesResult, templatesResult, promptsResult] =
      await Promise.all([
        client.listTools({}, { timeout: timeoutMs }),
        client.listResources({}, { timeout: timeoutMs }),
        client.listResourceTemplates({}, { timeout: timeoutMs }),
        client.listPrompts({}, { timeout: timeoutMs }),
      ]);
    const serverVersion = client.getServerVersion();
    const result: ContextForgeMcpTestResult = {
      ok: true,
      testedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      protocolVersion: LATEST_PROTOCOL_VERSION,
      server: serverVersion
        ? { name: serverVersion.name, version: serverVersion.version }
        : null,
      tools: toolsResult.tools.map((tool) => tool.name),
      resources: resourcesResult.resources.map((resource) => resource.uri),
      resourceTemplates: templatesResult.resourceTemplates.map(
        (template) => template.uriTemplate,
      ),
      prompts: promptsResult.prompts.map((prompt) => prompt.name),
      message: "MCP initialize and capability discovery completed.",
    };

    await storage.setSettingValue(LAST_TEST_SETTING_KEY, result);
    return result;
  } catch (error) {
    const result: ContextForgeMcpTestResult = {
      ok: false,
      testedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      protocolVersion: null,
      server: null,
      tools: [],
      resources: [],
      resourceTemplates: [],
      prompts: [],
      message:
        error instanceof Error
          ? error.message
          : "ContextForge MCP connection test failed.",
    };
    await storage.setSettingValue(LAST_TEST_SETTING_KEY, result);
    throw new Error(result.message);
  } finally {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
  }
}
