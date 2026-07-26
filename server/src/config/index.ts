import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

import type { StorageDriver } from "../storage/types.js";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

export const applicationRoot = path.resolve(moduleDirectory, "..", "..", "..");
export const serverRoot = path.join(applicationRoot, "server");

function loadLocalEnv() {
  const candidates = [
    path.join(applicationRoot, ".env"),
    path.join(serverRoot, ".env")
  ];

  const loaded = new Set<string>();

  for (const envPath of candidates) {
    if (!fs.existsSync(envPath) || loaded.has(envPath)) {
      continue;
    }

    dotenv.config({
      path: envPath,
      override: false,
      quiet: true
    });
    loaded.add(envPath);
  }
}

loadLocalEnv();

function readStorageDriver(): StorageDriver {
  return process.env.STORAGE_DRIVER === "postgres" ? "postgres" : "sqlite";
}

function resolveFromApplicationRoot(value: string) {
  return path.isAbsolute(value)
    ? path.normalize(value)
    : path.resolve(applicationRoot, value);
}

function resolveContextForgeDataDirectory() {
  const configuredDirectory = process.env.CONTEXTFORGE_DATA_DIR?.trim();

  return configuredDirectory
    ? resolveFromApplicationRoot(configuredDirectory)
    : path.join(applicationRoot, "data");
}

function resolveSqliteDatabasePath() {
  const configuredPath = process.env.SQLITE_DB_PATH?.trim();

  return configuredPath
    ? resolveFromApplicationRoot(configuredPath)
    : path.join(resolveContextForgeDataDirectory(), "contextforge.sqlite");
}

export const config = {
  appVersion: process.env.APP_VERSION ?? "0.7.0-alpha",
  port: Number(process.env.SERVER_PORT ?? 4000),
  storageDriver: readStorageDriver(),
  contextForgeDataDirectory: resolveContextForgeDataDirectory(),
  sqliteDatabasePath: resolveSqliteDatabasePath(),
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgresql://contextforge:contextforge@127.0.0.1:5433/contextforge",
  ollamaUrl: process.env.OLLAMA_URL ?? "http://localhost:11434",
  githubOAuthClientId: process.env.GITHUB_OAUTH_CLIENT_ID ?? "",
  githubOAuthScopes: process.env.GITHUB_OAUTH_SCOPES ?? "read:user repo",
  githubApiBaseUrl: process.env.GITHUB_API_BASE_URL ?? "https://api.github.com",
  githubApiVersion: process.env.GITHUB_API_VERSION ?? "2022-11-28"
};
