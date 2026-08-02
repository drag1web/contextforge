import fs from "node:fs/promises";
import path from "node:path";

import { pathMatchesNegativeConstraints } from "../../domain/negativeConstraintMatcher.js";
import type { NegativeConstraint, RepositorySnapshot } from "../../contracts/index.js";
import type {
  InvestigationCancellationPort,
  ReadFileRequest,
  ReadRangeRequest,
  RepositoryReaderPort,
  RepositoryReadFailure,
  RepositoryReadResult,
  RepositorySearchPort,
  SearchResult,
} from "../../ports/index.js";
import type { ProjectInventory } from "../../../scanner/projectInventoryScanner.js";

export interface LiveShadowRepositoryAdapterInput {
  projectRoot: string;
  inventory: ProjectInventory;
  snapshot: RepositorySnapshot;
  negativeConstraints: readonly NegativeConstraint[];
  cancellation: InvestigationCancellationPort;
  abortSignal?: AbortSignal;
}

function inventoryContentPreview(content: string): string {
  return content
    .replace(/\/\*[\s\S]*?\*\//gu, " ")
    .replace(/\/\/.*$/gmu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 360);
}

function failure(request: ReadFileRequest, reason: RepositoryReadFailure["reason"]): RepositoryReadFailure {
  return {
    status: "failure",
    snapshotId: request.snapshotId,
    fileId: request.fileId,
    path: request.path,
    reason,
    message: `Repository read failed: ${reason}.`,
  };
}

function normalizePath(value: string): string {
  return value.replace(/\\/gu, "/").replace(/^\.\//u, "");
}

function resolveInsideRoot(root: string, relativePath: string): string | null {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  return resolved.startsWith(`${resolvedRoot}${path.sep}`) ? resolved : null;
}

function lineCount(content: string): number {
  return content.split(/\r\n|\n|\r/u).length;
}

const MAX_PHYSICAL_READ_BYTES = 16 * 1024 * 1024;

export function createLiveShadowRepositoryAdapter(
  input: LiveShadowRepositoryAdapterInput,
): { reader: RepositoryReaderPort; search: RepositorySearchPort } {
  const descriptorsByPath = new Map(input.snapshot.files.map((file) => [file.normalizedPath, file]));
  const descriptorsById = new Map(input.snapshot.files.map((file) => [file.id, file]));
  const inventoryByPath = new Map(
    input.inventory.files.map((file) => [normalizePath(file.path), file]),
  );

  async function read(request: ReadFileRequest | ReadRangeRequest): Promise<RepositoryReadResult> {
    if (input.cancellation.isCancellationRequested()) return failure(request, "restricted");
    const normalized = normalizePath(request.path);
    const descriptor = descriptorsById.get(request.fileId);
    if (
      request.snapshotId !== input.snapshot.id ||
      !descriptor ||
      descriptor.normalizedPath !== normalized ||
      descriptor.contentFingerprint !== request.expectedFingerprint
    ) {
      return failure(request, descriptor ? "fingerprint_mismatch" : "not_found");
    }
    if (
      !descriptor.readable || descriptor.generated || descriptor.secretRisk !== "none" ||
      pathMatchesNegativeConstraints(normalized, input.negativeConstraints)
    ) {
      return failure(request, "restricted");
    }
    const absolute = resolveInsideRoot(input.projectRoot, normalized);
    if (!absolute) return failure(request, "restricted");
    if (!Number.isSafeInteger(request.maxBytes) || request.maxBytes < 0 || request.maxBytes > MAX_PHYSICAL_READ_BYTES) {
      return failure(request, "byte_limit");
    }
    const rangeRead = "startLine" in request;
    if (descriptor.sizeBytes > request.maxBytes) {
      return failure(request, "byte_limit");
    }
    if (input.cancellation.isCancellationRequested() || input.abortSignal?.aborted) {
      return failure(request, "restricted");
    }
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      handle = await fs.open(absolute, "r");
      if (input.cancellation.isCancellationRequested() || input.abortSignal?.aborted) return failure(request, "restricted");
      const stat = await handle.stat();
      if (input.cancellation.isCancellationRequested() || input.abortSignal?.aborted) return failure(request, "restricted");
      if (!stat.isFile() || stat.size !== descriptor.sizeBytes) return failure(request, "fingerprint_mismatch");
      const physicalLimit = descriptor.sizeBytes;
      const bytes = Buffer.alloc(physicalLimit);
      if (input.cancellation.isCancellationRequested() || input.abortSignal?.aborted) return failure(request, "restricted");
      const readResult = physicalLimit === 0
        ? { bytesRead: 0 }
        : await handle.read(bytes, 0, physicalLimit, 0);
      if (input.cancellation.isCancellationRequested() || input.abortSignal?.aborted) return failure(request, "restricted");
      if (readResult.bytesRead !== descriptor.sizeBytes) return failure(request, "fingerprint_mismatch");
      const decoder = new TextDecoder("utf-8", { fatal: true });
      const content = decoder.decode(bytes.subarray(0, readResult.bytesRead));
      const inventoryFile = inventoryByPath.get(normalized);
      if (
        (rangeRead && inventoryFile?.contentPreview === undefined) ||
        (
        inventoryFile?.contentPreview !== undefined &&
        inventoryContentPreview(content) !== inventoryFile.contentPreview
        )
      ) {
        return failure(request, "fingerprint_mismatch");
      }
      if (rangeRead) {
        const lines = content.split(/\r\n|\n|\r/u);
        if (request.startLine < 1 || request.endLine < request.startLine) {
          return failure(request, "range_invalid");
        }
        if (request.endLine > lines.length) {
          return failure(request, "range_invalid");
        }
        const selected = lines.slice(request.startLine - 1, request.endLine).join("\n");
        const selectedBytes = new TextEncoder().encode(selected).byteLength;
        if (selectedBytes > request.maxBytes) return failure(request, "byte_limit");
        return {
          status: "success", snapshotId: input.snapshot.id, fileId: descriptor.id,
          path: normalized, content: selected, contentFingerprint: descriptor.contentFingerprint,
          bytesRead: selectedBytes, startLine: request.startLine, endLine: request.endLine,
        };
      }
      return {
        status: "success", snapshotId: input.snapshot.id, fileId: descriptor.id,
        path: normalized, content, contentFingerprint: descriptor.contentFingerprint,
        bytesRead: readResult.bytesRead, startLine: 1, endLine: lineCount(content),
      };
    } catch {
      return failure(request, "unreadable");
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  function search(query: { snapshotId: string; query: string; limit: number }, fields: string[]): SearchResult[] {
    if (input.cancellation.isCancellationRequested() || query.snapshotId !== input.snapshot.id) return [];
    const needle = query.query.trim().toLocaleLowerCase("en-US");
    if (!needle || !Number.isSafeInteger(query.limit) || query.limit < 1) return [];
    return input.inventory.files.flatMap((file) => {
      const normalized = normalizePath(file.path);
      const descriptor = descriptorsByPath.get(normalized);
      if (!descriptor || pathMatchesNegativeConstraints(normalized, input.negativeConstraints)) return [];
      const values = fields.flatMap((field) => {
        const value = file[field as keyof typeof file];
        return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") :
          typeof value === "string" ? [value] : [];
      });
      return values.some((value) => value.toLocaleLowerCase("en-US").includes(needle))
        ? [{ kind: "lead" as const, snapshotId: input.snapshot.id, path: normalized, entityId: descriptor.id }]
        : [];
    }).sort((left, right) => left.path.localeCompare(right.path)).slice(0, Math.min(query.limit, 100));
  }

  return {
    reader: { readFile: read, readRange: read },
    search: {
      async searchPaths(query) { return search(query, ["path", "name"]); },
      async searchText(query) { return search(query, ["path", "textHints", "semanticFacts"]); },
      async searchSymbols(query) { return search(query, ["path", "symbols", "exports", "imports"]); },
    },
  };
}
