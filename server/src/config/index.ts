import path from "node:path";
import dotenv from "dotenv";

import type { StorageDriver } from "../storage/types.js";

dotenv.config();

function readStorageDriver(): StorageDriver {
  return process.env.STORAGE_DRIVER === "postgres" ? "postgres" : "sqlite";
}

export const config = {
  appVersion: process.env.APP_VERSION ?? "0.5.2-alpha",
  port: Number(process.env.SERVER_PORT ?? 4000),
  storageDriver: readStorageDriver(),
  sqliteDatabasePath:
    process.env.SQLITE_DB_PATH ?? path.resolve(process.cwd(), "data", "contextforge.sqlite"),
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgresql://contextforge:contextforge@127.0.0.1:5433/contextforge",
  ollamaUrl: process.env.OLLAMA_URL ?? "http://localhost:11434"
};
