import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";

import { scanProjectInventory } from "../../../scanner/projectInventoryScanner.js";
import type { RepositorySnapshot, SnapshotId } from "../../contracts/index.js";
import type {
  ClockPort,
  RepositorySnapshotPort,
  SnapshotRequest,
} from "../../ports/index.js";
import { adaptLegacyInventoryToRepositorySnapshot } from "./legacyInventorySnapshotAdapter.js";
import {
  LEGACY_INVENTORY_MAX_DEPTH,
  LegacyInventorySnapshotError,
} from "./legacyInventorySupport.js";

export interface LegacyInventorySnapshotPortOptions {
  clock: ClockPort;
  repositoryRoot: string;
}

const LEGACY_SCANNER_MAX_FILES = 800;
// The legacy contract does not export its scan profile, so the boundary pins
// the audited CE2-01 values without changing the scanner implementation.
const LEGACY_SCANNER_EXCLUDED_PATTERNS = [
  "**/.cache/**",
  "**/.git/**",
  "**/.idea/**",
  "**/.next/**",
  "**/.nuxt/**",
  "**/.svelte-kit/**",
  "**/.turbo/**",
  "**/.vercel/**",
  "**/.vscode/**",
  "**/build/**",
  "**/coverage/**",
  "**/dist/**",
  "**/node_modules/**",
  "**/out/**",
  "**/temp/**",
  "**/tmp/**",
] as const;

function cloneSnapshot(snapshot: RepositorySnapshot): RepositorySnapshot {
  return structuredClone(snapshot);
}

async function assertRepositoryRootAvailable(
  repositoryRoot: string,
): Promise<void> {
  let stats: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stats = await fs.stat(repositoryRoot);
  } catch {
    throw new LegacyInventorySnapshotError([
      {
        path: "repositoryRoot",
        code: "repository_unavailable",
        message: "Repository root does not exist or cannot be inspected.",
      },
    ]);
  }
  if (!stats.isDirectory()) {
    throw new LegacyInventorySnapshotError([
      {
        path: "repositoryRoot",
        code: "repository_unavailable",
        message: "Repository root must be a directory.",
      },
    ]);
  }
  try {
    await fs.access(repositoryRoot, fsConstants.R_OK);
    const directory = await fs.opendir(repositoryRoot);
    await directory.close();
  } catch {
    throw new LegacyInventorySnapshotError([
      {
        path: "repositoryRoot",
        code: "repository_unavailable",
        message: "Repository root directory cannot be read.",
      },
    ]);
  }
}

export function createLegacyInventorySnapshotPort(
  options: LegacyInventorySnapshotPortOptions,
): RepositorySnapshotPort {
  const snapshots = new Map<SnapshotId, RepositorySnapshot>();

  return {
    async createSnapshot(request: SnapshotRequest) {
      await assertRepositoryRootAvailable(options.repositoryRoot);
      const inventory = await scanProjectInventory(options.repositoryRoot);
      const snapshot = adaptLegacyInventoryToRepositorySnapshot({
        inventory,
        projectId: request.projectId,
        rootUri: request.rootUri,
        createdAt: options.clock.nowIso(),
        excludedPatterns: LEGACY_SCANNER_EXCLUDED_PATTERNS,
        maxFiles: LEGACY_SCANNER_MAX_FILES,
        maxDepth: LEGACY_INVENTORY_MAX_DEPTH,
      });
      const existingSnapshot = snapshots.get(snapshot.id);
      if (existingSnapshot) {
        return cloneSnapshot(existingSnapshot);
      }
      const storedSnapshot = cloneSnapshot(snapshot);
      snapshots.set(snapshot.id, storedSnapshot);
      return cloneSnapshot(storedSnapshot);
    },

    async getSnapshot(id: SnapshotId) {
      const snapshot = snapshots.get(id);
      return snapshot ? cloneSnapshot(snapshot) : null;
    },
  };
}
