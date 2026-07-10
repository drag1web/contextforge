import fs from "node:fs/promises";
import path from "node:path";

import { scanProjectInventory } from "../../scanner/projectInventoryScanner.js";
import type { ProjectInventory } from "../../scanner/projectInventoryScanner.js";
import type { SelectorBenchmarkCase } from "./benchmarkTypes.js";
import { validateBenchmarkCases } from "./benchmarkTypes.js";

export interface BenchmarkProjectManifestEntry {
  id: string;
  localPath: string;
  enabled?: boolean;
  tags?: string[];
  caseFile?: string;
}

export interface LoadedBenchmarkProjects {
  inventories: Record<string, ProjectInventory>;
  cases: SelectorBenchmarkCase[];
  availableProjects: string[];
  skippedProjects: string[];
}

async function pathExists(pathValue: string) {
  try {
    await fs.access(pathValue);
    return true;
  } catch {
    return false;
  }
}

export async function loadBenchmarkProjectManifest(manifestPath?: string): Promise<LoadedBenchmarkProjects> {
  if (!manifestPath) return { inventories: {}, cases: [], availableProjects: [], skippedProjects: [] };
  const absoluteManifestPath = path.resolve(manifestPath);
  const manifestDir = path.dirname(absoluteManifestPath);
  const raw = JSON.parse(await fs.readFile(absoluteManifestPath, "utf8")) as { projects?: BenchmarkProjectManifestEntry[] };
  const entries = Array.isArray(raw.projects) ? raw.projects : [];
  const result: LoadedBenchmarkProjects = { inventories: {}, cases: [], availableProjects: [], skippedProjects: [] };

  for (const entry of entries) {
    if (!entry || entry.enabled === false || !String(entry.id ?? "").trim()) continue;
    const localPath = path.resolve(manifestDir, String(entry.localPath ?? ""));
    if (!entry.localPath || !(await pathExists(localPath))) {
      result.skippedProjects.push(entry.id);
      continue;
    }
    result.inventories[entry.id] = await scanProjectInventory(localPath);
    result.availableProjects.push(entry.id);
    if (entry.caseFile) {
      const casePath = path.resolve(manifestDir, entry.caseFile);
      if (!(await pathExists(casePath))) {
        result.skippedProjects.push(`${entry.id}:cases`);
        continue;
      }
      const cases = JSON.parse(await fs.readFile(casePath, "utf8")) as SelectorBenchmarkCase[];
      validateBenchmarkCases(cases);
      result.cases.push(...cases.map((item) => ({ ...item, projectFixture: entry.id })));
    }
  }
  return result;
}
