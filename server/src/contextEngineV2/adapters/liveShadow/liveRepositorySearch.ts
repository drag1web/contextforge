import { pathMatchesNegativeConstraints } from "../../domain/negativeConstraintMatcher.js";
import type { NegativeConstraint, RepositorySnapshot } from "../../contracts/index.js";
import type { InvestigationCancellationPort, RepositorySearchPort, SearchResult } from "../../ports/index.js";
import type { ProjectInventory } from "../../../scanner/projectInventoryScanner.js";

export interface LiveRepositorySearchInput {
  inventory: ProjectInventory;
  snapshot: RepositorySnapshot;
  negativeConstraints: readonly NegativeConstraint[];
  cancellation: InvestigationCancellationPort;
  abortSignal?: AbortSignal;
}

function normalizePath(value: string): string {
  return value.replace(/\\/gu, "/").replace(/^\.\//u, "");
}

/** Existing production inventory search; no acquisition or execution authority. */
export function createLiveRepositorySearch(input: LiveRepositorySearchInput): RepositorySearchPort {
  const descriptorsByPath = new Map(input.snapshot.files.map((file) => [file.normalizedPath, file]));

  async function search(
    query: { snapshotId: string; query: string; limit: number },
    fields: string[],
  ): Promise<SearchResult[]> {
    if (input.cancellation.isCancellationRequested() || query.snapshotId !== input.snapshot.id) return [];
    const needle = query.query.trim().toLocaleLowerCase("en-US");
    if (!needle || !Number.isSafeInteger(query.limit) || query.limit < 1) return [];
    const results: SearchResult[] = [];
    for (let index = 0; index < input.inventory.files.length; index += 1) {
      if (index % 32 === 0 && (input.cancellation.isCancellationRequested() || input.abortSignal?.aborted)) {
        return [];
      }
      if (index > 0 && index % 256 === 0) {
        await new Promise<void>((resolve) => setImmediate(resolve));
        if (input.cancellation.isCancellationRequested() || input.abortSignal?.aborted) return [];
      }
      const file = input.inventory.files[index]!;
      const normalized = normalizePath(file.path);
      const descriptor = descriptorsByPath.get(normalized);
      if (!descriptor || pathMatchesNegativeConstraints(normalized, input.negativeConstraints)) continue;
      const values = fields.flatMap((field) => {
        const value = file[field as keyof typeof file];
        return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") :
          typeof value === "string" ? [value] : [];
      });
      if (values.some((value) => value.toLocaleLowerCase("en-US").includes(needle))) {
        results.push({ kind: "lead", snapshotId: input.snapshot.id, path: normalized, entityId: descriptor.id });
      }
    }
    return results.sort((left, right) => left.path.localeCompare(right.path)).slice(0, Math.min(query.limit, 100));
  }

  return {
    searchPaths(query) { return search(query, ["path", "name"]); },
    searchText(query) { return search(query, ["path", "textHints", "semanticFacts"]); },
    searchSymbols(query) { return search(query, ["path", "symbols", "exports", "imports"]); },
  };
}
