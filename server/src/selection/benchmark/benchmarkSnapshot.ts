import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ProjectInventory } from "../../scanner/projectInventoryScanner.js";
import { loadBenchmarkProjectManifest } from "./benchmarkProjectManifest.js";
import { fingerprintProjectInventory, publicInventoryFiles, type PublicInventoryFileMetadata } from "./benchmarkFingerprint.js";

type SnapshotFile = PublicInventoryFileMetadata;

interface ProjectSnapshot {
  id: string;
  fingerprint: string;
  totalFiles: number;
  scannedFiles: number;
  truncated: boolean;
  roleCounts: Record<string, number>;
  kindCounts: Record<string, number>;
  files: SnapshotFile[];
}

export interface SelectorInventorySnapshot {
  schemaVersion: 1;
  createdAt: string;
  projects: ProjectSnapshot[];
  skippedProjects: string[];
  privacy: {
    containsAbsolutePaths: false;
    containsFileContents: false;
    containsTextHints: false;
  };
}

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

function countBy<T extends string>(values: T[]) {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}


export async function createProjectSnapshot(id: string, inventory: ProjectInventory): Promise<ProjectSnapshot> {
  const files = publicInventoryFiles(inventory);
  const fingerprint = await fingerprintProjectInventory(inventory);
  return {
    id,
    fingerprint,
    totalFiles: inventory.totalFiles,
    scannedFiles: inventory.scannedFiles,
    truncated: inventory.truncated,
    roleCounts: countBy(files.map((file) => file.role)),
    kindCounts: countBy(files.map((file) => file.kind)),
    files,
  };
}

export async function createSelectorInventorySnapshot(manifestPath: string): Promise<SelectorInventorySnapshot> {
  const loaded = await loadBenchmarkProjectManifest(manifestPath);
  const projects = (await Promise.all(
    Object.entries(loaded.inventories).map(([id, inventory]) => createProjectSnapshot(id, inventory)),
  )).sort((left, right) => left.id.localeCompare(right.id));
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    projects,
    skippedProjects: [...loaded.skippedProjects],
    privacy: {
      containsAbsolutePaths: false,
      containsFileContents: false,
      containsTextHints: false,
    },
  };
}

function parseArgs(argv: string[]) {
  const readValue = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const manifestPath = readValue("--manifest");
  if (!manifestPath) throw new Error("--manifest is required.");
  return {
    manifestPath: path.resolve(manifestPath),
    outputPath: path.resolve(readValue("--output") ?? path.join(repoRoot, "reports", "selector-inventory-snapshot.json")),
  };
}

export async function runSelectorInventorySnapshot(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const snapshot = await createSelectorInventorySnapshot(options.manifestPath);
  await fs.mkdir(path.dirname(options.outputPath), { recursive: true });
  await fs.writeFile(options.outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  console.log(`selector inventory snapshot: ${snapshot.projects.length} projects`);
  console.log(`skipped projects: ${snapshot.skippedProjects.join(", ") || "none"}`);
  console.log(`output: ${path.relative(repoRoot, options.outputPath)}`);
  return snapshot;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSelectorInventorySnapshot().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
