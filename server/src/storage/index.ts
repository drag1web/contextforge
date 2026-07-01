import { config } from "../config/index.js";
import { PostgresStorageAdapter } from "./PostgresStorageAdapter.js";
import { SqliteStorageAdapter } from "./SqliteStorageAdapter.js";
import type { StorageAdapter } from "./types.js";

let adapter: StorageAdapter | null = null;

export function getStorageAdapter(): StorageAdapter {
  if (!adapter) {
    adapter =
      config.storageDriver === "postgres"
        ? new PostgresStorageAdapter()
        : new SqliteStorageAdapter(config.sqliteDatabasePath);
  }

  return adapter;
}

export const storage = getStorageAdapter();
