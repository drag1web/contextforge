import fs from "node:fs";
import path from "node:path";

import { applicationRoot, config, serverRoot } from "../config/index.js";
import { ContextForgeMcpError } from "./mcpErrors.js";

function fileExists(filePath: string) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function shellQuote(value: string) {
  if (/^[A-Za-z0-9_./:\\-]+$/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '\\"')}"`;
}

function tomlString(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export interface ContextForgeMcpLaunchConfiguration {
  command: string;
  args: string[];
  env: Record<string, string>;
  envKeys: string[];
  builtEntrypoint: string;
  sourceEntrypoint: string;
  builtEntrypointReady: boolean;
  sourceEntrypointReady: boolean;
  databasePathConfigured: boolean;
  codexRegistrationCommand: string;
  codexConfigSnippet: string;
  warnings: string[];
}

export function getContextForgeMcpLaunchConfiguration(): ContextForgeMcpLaunchConfiguration {
  const builtEntrypoint = path.join(serverRoot, "dist", "mcp", "index.js");
  const sourceEntrypoint = path.join(serverRoot, "src", "mcp", "index.ts");
  const builtEntrypointReady = fileExists(builtEntrypoint);
  const sourceEntrypointReady = fileExists(sourceEntrypoint);
  const databasePathConfigured =
    config.storageDriver === "postgres" || fileExists(config.sqliteDatabasePath);
  const env: Record<string, string> = {};

  if (config.storageDriver === "postgres") {
    env.STORAGE_DRIVER = "postgres";
    env.DATABASE_URL = config.databaseUrl;
  } else {
    env.STORAGE_DRIVER = "sqlite";
    env.SQLITE_DB_PATH = config.sqliteDatabasePath;
  }
  const args = [builtEntrypoint];
  const displayedEnv =
    config.storageDriver === "postgres"
      ? { STORAGE_DRIVER: "postgres" }
      : env;
  const commandParts = [
    "codex",
    "mcp",
    "add",
    "contextforge",
    ...Object.entries(displayedEnv).flatMap(([key, value]) => [
      "--env",
      shellQuote(`${key}=${value}`),
    ]),
    "--",
    shellQuote(process.execPath),
    shellQuote(builtEntrypoint),
  ];
  const envToml = Object.entries(displayedEnv)
    .map(([key, value]) => `${tomlString(key)} = ${tomlString(value)}`)
    .join(", ");
  const warnings: string[] = [];

  if (!builtEntrypointReady) {
    warnings.push("MCP_BUILD_REQUIRED");
  }
  if (!databasePathConfigured) {
    warnings.push("MCP_DATABASE_NOT_FOUND");
  }
  if (config.storageDriver === "postgres") {
    warnings.push("MCP_POSTGRES_DATABASE_URL_MUST_BE_FORWARDED");
  }

  return {
    command: process.execPath,
    args,
    env,
    envKeys: Object.keys(env),
    builtEntrypoint,
    sourceEntrypoint,
    builtEntrypointReady,
    sourceEntrypointReady,
    databasePathConfigured,
    codexRegistrationCommand: commandParts.join(" "),
    codexConfigSnippet: [
      "[mcp_servers.contextforge]",
      "enabled = true",
      `command = ${tomlString(process.execPath)}`,
      `args = [${tomlString(builtEntrypoint)}]`,
      `env = { ${envToml} }`,
      ...(config.storageDriver === "postgres"
        ? ['env_vars = ["DATABASE_URL"]']
        : []),
      "startup_timeout_sec = 15.0",
      "tool_timeout_sec = 120.0",
    ].join("\n"),
    warnings,
  };
}

export function assertContextForgeMcpDatabaseAvailable() {
  if (config.storageDriver === "postgres") {
    return;
  }

  if (!path.isAbsolute(config.sqliteDatabasePath)) {
    throw new ContextForgeMcpError(
      "MCP_STORAGE_UNAVAILABLE",
      "SQLITE_DB_PATH must resolve to an absolute path for MCP startup.",
    );
  }

  if (!fileExists(config.sqliteDatabasePath)) {
    throw new ContextForgeMcpError(
      "MCP_STORAGE_UNAVAILABLE",
      "The configured ContextForge SQLite database does not exist. Start ContextForge once or set SQLITE_DB_PATH to the existing database.",
    );
  }
}

export const contextForgeApplicationRoot = applicationRoot;
