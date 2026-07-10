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

export async function fingerprintProjectInventory(inventory: ProjectInventory) {
  const hash = createHash("sha256");
  const metadata = publicInventoryFiles(inventory);
  hash.update(JSON.stringify({
    totalFiles: inventory.totalFiles,
    scannedFiles: inventory.scannedFiles,
    truncated: inventory.truncated,
    files: metadata,
  }));

  for (const file of metadata) {
    hash.update("\0");
    hash.update(file.path);
    const absolutePath = safeInventoryFilePath(inventory, file.path);
    if (!absolutePath) {
      hash.update("<unsafe-path>");
      continue;
    }
    try {
      const data = await fs.readFile(absolutePath);
      hash.update(createHash("sha256").update(data).digest());
    } catch {
      hash.update("<unreadable>");
    }
  }
  return hash.digest("hex");
}
