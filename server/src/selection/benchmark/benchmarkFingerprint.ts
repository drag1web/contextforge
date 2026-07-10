import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { ProjectInventory, ProjectInventoryFile } from "../../scanner/projectInventoryScanner.js";

export interface PublicInventoryFileMetadata {
  path: string;
  name: string;
  extension: string;
  kind: ProjectInventoryFile["kind"];
  role: ProjectInventoryFile["role"];
  routePath?: string;
  imports: string[];
  exports: string[];
  symbols: string[];
  sizeBytes: number;
  depth: number;
  canReadText: boolean;
  isLikelyGenerated: boolean;
}

export const PROJECT_FINGERPRINT_ALGORITHM = "path-content-v1" as const;

function sanitizeSpecifier(value: string) {
  return path.isAbsolute(value) || /^[a-zA-Z]:[\\/]/.test(value) ? "<absolute-path-redacted>" : value;
}

export function publicInventoryFileMetadata(file: ProjectInventoryFile): PublicInventoryFileMetadata {
  return {
    path: file.path,
    name: file.name,
    extension: file.extension,
    kind: file.kind,
    role: file.role,
    ...(file.routePath ? { routePath: file.routePath } : {}),
    imports: file.imports.map(sanitizeSpecifier),
    exports: [...file.exports],
    symbols: [...file.symbols],
    sizeBytes: file.sizeBytes,
    depth: file.depth,
    canReadText: file.canReadText,
    isLikelyGenerated: file.isLikelyGenerated,
  };
}

export function publicInventoryFiles(inventory: ProjectInventory) {
  return inventory.files
    .map(publicInventoryFileMetadata)
    .sort((left, right) => left.path.localeCompare(right.path));
}

function safeInventoryFilePath(inventory: ProjectInventory, relativePath: string) {
  const root = path.resolve(inventory.rootPath);
  const absolute = path.resolve(root, relativePath);
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return absolute;
}

/**
 * Fingerprints project source state without depending on scanner-derived roles,
 * symbols, imports, routes, or other metadata that can legitimately change when
 * the scanner implementation improves.
 */
export async function fingerprintProjectInventory(inventory: ProjectInventory) {
  const hash = createHash("sha256");
  hash.update(PROJECT_FINGERPRINT_ALGORITHM);
  const files = [...inventory.files]
    .map((file) => ({ path: file.path.replace(/\\/g, "/"), file }))
    .sort((left, right) => left.path.localeCompare(right.path));

  for (const entry of files) {
    hash.update("\0path\0");
    hash.update(entry.path);
    const absolutePath = safeInventoryFilePath(inventory, entry.file.path);
    if (!absolutePath) {
      hash.update("\0<unsafe-path>");
      continue;
    }
    try {
      const data = await fs.readFile(absolutePath);
      hash.update("\0content\0");
      hash.update(createHash("sha256").update(data).digest());
    } catch {
      hash.update("\0<unreadable>");
      hash.update(String(entry.file.sizeBytes));
    }
  }
  return hash.digest("hex");
}
