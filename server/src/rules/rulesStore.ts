import fs from "node:fs/promises";
import path from "node:path";

import { getStorageAdapter } from "../storage/index.js";
import type { StorageAdapter } from "../storage/types.js";
import type { RulesAndTemplatesStore } from "./types.js";

const STORE_VERSION = 1;

const DEFAULT_STORE: RulesAndTemplatesStore = {
  version: STORE_VERSION,
  templates: [],
  ruleItems: [],
  ruleProfiles: [],
  acceptanceCriteriaPresets: []
};

type RulesTemplatesStorageAdapter = StorageAdapter & {
  readRulesAndTemplatesCatalog: NonNullable<StorageAdapter["readRulesAndTemplatesCatalog"]>;
  writeRulesAndTemplatesCatalog: NonNullable<StorageAdapter["writeRulesAndTemplatesCatalog"]>;
  importRulesAndTemplatesCatalog: NonNullable<StorageAdapter["importRulesAndTemplatesCatalog"]>;
};

function getStorePath() {
  return path.resolve(process.cwd(), "data", "rules-and-templates.json");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeStore(value: unknown): RulesAndTemplatesStore {
  if (!isObject(value)) {
    return DEFAULT_STORE;
  }

  return {
    version: Number(value.version) || STORE_VERSION,
    templates: Array.isArray(value.templates) ? value.templates : [],
    ruleItems: Array.isArray(value.ruleItems) ? value.ruleItems : [],
    ruleProfiles: Array.isArray(value.ruleProfiles) ? value.ruleProfiles : [],
    acceptanceCriteriaPresets: Array.isArray(value.acceptanceCriteriaPresets)
      ? value.acceptanceCriteriaPresets
      : []
  } as RulesAndTemplatesStore;
}

function hasCatalogStorage(adapter: StorageAdapter): adapter is RulesTemplatesStorageAdapter {
  return (
    typeof adapter.readRulesAndTemplatesCatalog === "function" &&
    typeof adapter.writeRulesAndTemplatesCatalog === "function" &&
    typeof adapter.importRulesAndTemplatesCatalog === "function"
  );
}

async function readLegacyRulesAndTemplatesStore(): Promise<RulesAndTemplatesStore> {
  const storePath = getStorePath();

  try {
    const raw = await fs.readFile(storePath, "utf8");
    return normalizeStore(JSON.parse(raw));
  } catch {
    return DEFAULT_STORE;
  }
}

async function writeLegacyRulesAndTemplatesStore(store: RulesAndTemplatesStore) {
  const storePath = getStorePath();
  const storeDirectory = path.dirname(storePath);
  const temporaryPath = `${storePath}.tmp`;

  await fs.mkdir(storeDirectory, { recursive: true });

  await fs.writeFile(
    temporaryPath,
    JSON.stringify(
      {
        ...store,
        version: STORE_VERSION
      },
      null,
      2
    ),
    "utf8"
  );

  await fs.rename(temporaryPath, storePath);
}

export async function readRulesAndTemplatesStore(): Promise<RulesAndTemplatesStore> {
  const adapter = getStorageAdapter();

  if (!hasCatalogStorage(adapter)) {
    return readLegacyRulesAndTemplatesStore();
  }

  const legacyStore = await readLegacyRulesAndTemplatesStore();
  await adapter.importRulesAndTemplatesCatalog(legacyStore);

  return adapter.readRulesAndTemplatesCatalog();
}

export async function writeRulesAndTemplatesStore(store: RulesAndTemplatesStore) {
  const nextStore = {
    ...store,
    version: STORE_VERSION
  };
  const adapter = getStorageAdapter();

  if (hasCatalogStorage(adapter)) {
    await adapter.writeRulesAndTemplatesCatalog(nextStore);
  }

  // Keep the legacy JSON catalog as a human-readable backup during the 12.x
  // transition. Later backup/export work can decide when it is safe to retire it.
  await writeLegacyRulesAndTemplatesStore(nextStore);
}
