import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

import type { StorageDriver } from "../storage/types.js";

function loadLocalEnv() {
  const cwd = process.cwd();
  const candidates = [
    path.resolve(cwd, ".env"),
    path.resolve(cwd, "..", ".env")
  ];

  const loaded = new Set<string>();

  for (const envPath of candidates) {
    if (!fs.existsSync(envPath) || loaded.has(envPath)) {
      continue;
    }

    dotenv.config({
      path: envPath,
      override: true
    });
    loaded.add(envPath);
  }
}

loadLocalEnv();

function readStorageDriver(): StorageDriver {
  return process.env.STORAGE_DRIVER === "postgres" ? "postgres" : "sqlite";
}

export const config = {
  appVersion: process.env.APP_VERSION ?? "0.6.5-alpha",
  port: Number(process.env.SERVER_PORT ?? 4000),
  storageDriver: readStorageDriver(),
  sqliteDatabasePath:
    process.env.SQLITE_DB_PATH ?? path.resolve(process.cwd(), "data", "contextforge.sqlite"),
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgresql://contextforge:contextforge@127.0.0.1:5433/contextforge",
  ollamaUrl: process.env.OLLAMA_URL ?? "http://localhost:11434",
  githubOAuthClientId: process.env.GITHUB_OAUTH_CLIENT_ID ?? "",
  githubOAuthScopes: process.env.GITHUB_OAUTH_SCOPES ?? "read:user repo",
  githubApiBaseUrl: process.env.GITHUB_API_BASE_URL ?? "https://api.github.com",
  githubApiVersion: process.env.GITHUB_API_VERSION ?? "2022-11-28"
};
