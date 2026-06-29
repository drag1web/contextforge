import fs from "node:fs/promises";
import path from "node:path";

import type { RulesAndTemplatesStore } from "./types.js";

const STORE_VERSION = 1;

const DEFAULT_STORE: RulesAndTemplatesStore = {
  version: STORE_VERSION,
  templates: [],
  ruleItems: [],
  ruleProfiles: [],
  acceptanceCriteriaPresets: []
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

export async function readRulesAndTemplatesStore(): Promise<RulesAndTemplatesStore> {
  const storePath = getStorePath();

  try {
    const raw = await fs.readFile(storePath, "utf8");
    return normalizeStore(JSON.parse(raw));
  } catch {
    return DEFAULT_STORE;
  }
}

export async function writeRulesAndTemplatesStore(store: RulesAndTemplatesStore) {
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