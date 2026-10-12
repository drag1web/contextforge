import assert from "node:assert/strict";
import { pathMatchesNegativeConstraints } from "../domain/negativeConstraintMatcher.js";
import { createLiveRepositorySearch, type LiveRepositorySearchInput } from "../adapters/liveShadow/liveRepositorySearch.js";
import { adaptLegacyInventoryToRepositorySnapshot } from "../adapters/legacyInventory/legacyInventorySnapshotAdapter.js";
import type { ProjectInventoryFile } from "../../scanner/projectInventoryScanner.js";
import type { RepositorySearchPort, SearchResult } from "../ports/repositorySearchPort.js";

// Frozen TEST-ONLY baseline extraction from bea42cf's live adapter. The import
// smoke checks its entire nested search declaration against the pre-edit SHA.
// Independent expected assertions below complement differential comparisons.
function normalizePath(value: string): string {
  return value.replace(/\\/gu, "/").replace(/^\.\//u, "");
}
function createBaselineSearch(input: LiveRepositorySearchInput): RepositorySearchPort {
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

function file(path = "src/inert.ts", patch: Partial<ProjectInventoryFile> = {}): ProjectInventoryFile {
  return { path, name: path.split(/[\\/]/u).at(-1)!, extension: ".ts", kind: "source", role: "service", sizeBytes: 0, depth: 2,
    imports: ["import-only"], exports: ["export-only"], symbols: ["symbol-only"], textHints: ["hint-only"], contentPreview: "preview-only",
    canReadText: true, isLikelyGenerated: false, ...patch };
}
function fixture(files = [file()]): LiveRepositorySearchInput {
  const inventory = { rootPath: "/__rw02b5_inert_inventory__", files, totalFiles: files.length, scannedFiles: files.length, truncated: false, notes: [] };
  const snapshot = adaptLegacyInventoryToRepositorySnapshot({ inventory, projectId: "rw02b5-inert", rootUri: "repository://rw02b5-inert",
    createdAt: "2026-01-01T00:00:00.000Z" });
  return { inventory, snapshot, negativeConstraints: [], cancellation: { isCancellationRequested: () => false } };
}
type Operation = keyof RepositorySearchPort;
const operations: Operation[] = ["searchPaths", "searchText", "searchSymbols"];
async function differential(make = fixture, operation: Operation = "searchPaths", query = "inert", limit = 20): Promise<SearchResult[]> {
  const fresh = make(), original = make();
  const actual = await createLiveRepositorySearch(fresh)[operation]({ snapshotId: fresh.snapshot.id, query, limit });
  const expected = await createBaselineSearch(original)[operation]({ snapshotId: original.snapshot.id, query, limit });
  assert.deepEqual(actual, expected); return actual;
}
const paths = (results: SearchResult[]) => results.map((item) => item.path);
let scenarios = 0;
async function check(name: string, run: () => void | Promise<void>) { await run(); scenarios += 1; process.stdout.write(`PASS ${name}\n`); }

await check("valid path search and exact production result identity", async () => {
  const input = fixture(); const results = await differential();
  assert.deepEqual(results, [{ kind: "lead", snapshotId: input.snapshot.id, path: "src/inert.ts", entityId: input.snapshot.files[0].id }]);
});
await check("valid text search", async () => { assert.deepEqual(paths(await differential(fixture, "searchText", "hint-only")), ["src/inert.ts"]); });
await check("valid symbol search", async () => { assert.deepEqual(paths(await differential(fixture, "searchSymbols", "symbol-only")), ["src/inert.ts"]); });
await check("path is searched by all three operations", async () => {
  for (const operation of operations) assert.equal((await differential(fixture, operation, "src/inert")).length, 1);
});
await check("name-only metadata belongs to path search exclusively", async () => {
  const make = () => fixture([file("src/inert.ts", { name: "name-only" })]);
  for (const operation of operations) assert.equal((await differential(make, operation, "name-only")).length, operation === "searchPaths" ? 1 : 0);
});
await check("textHints belong to text search exclusively", async () => {
  for (const operation of operations) assert.equal((await differential(fixture, operation, "hint-only")).length, operation === "searchText" ? 1 : 0);
});
await check("symbols exports and imports belong to symbol search exclusively", async () => {
  for (const needle of ["symbol-only", "export-only", "import-only"]) for (const operation of operations)
    assert.equal((await differential(fixture, operation, needle)).length, operation === "searchSymbols" ? 1 : 0);
});
await check("contentPreview role and unrelated metadata are not searched", async () => {
  for (const needle of ["preview-only", "service"]) for (const operation of operations) assert.deepEqual(await differential(fixture, operation, needle), []);
});
await check("production semanticFacts objects are NOT recursively stringified or flattened", async () => {
  const make = () => fixture([file("src/inert.ts", { semanticFacts: { declarations: ["semantic-only"], references: [], assignments: [], objectProperties: [],
    stateSymbols: [], translationKeys: [], translationEntries: [], routePaths: [] } })]);
  assert.deepEqual(await differential(make, "searchText", "semantic-only"), []);
});
await check("existing string/array scalar extraction is preserved for atypical semanticFacts", async () => {
  for (const value of ["semantic-only", ["semantic-only", 7, { private: "ignored-only" }]]) {
    const make = () => { const input = fixture(); input.inventory.files[0].semanticFacts = value as unknown as ProjectInventoryFile["semanticFacts"]; return input; };
    assert.equal((await differential(make, "searchText", "semantic-only")).length, 1);
    assert.deepEqual(await differential(make, "searchText", "ignored-only"), []);
    for (const operation of ["searchPaths", "searchSymbols"] as const) assert.deepEqual(await differential(make, operation, "semantic-only"), []);
  }
});
await check("en-US lowercase and query trim preserve Unicode/case behavior", async () => {
  assert.equal((await differential(fixture, "searchPaths", "  INERT  ")).length, 1);
  const make = () => fixture([file("src/İnert.ts")]);
  assert.equal((await differential(make, "searchPaths", "i\u0307nert")).length, 1);
});
await check("missing descriptor skips matching inventory rows", async () => {
  const make = () => { const input = fixture(); input.snapshot.files = []; return input; };
  assert.deepEqual(await differential(make), []);
});
await check("snapshot mismatch retains empty-result behavior", async () => {
  for (const factory of [createLiveRepositorySearch, createBaselineSearch]) {
    const input = fixture(); assert.deepEqual(await factory(input).searchPaths({ snapshotId: "snapshot_other" as typeof input.snapshot.id, query: "inert", limit: 10 }), []);
  }
});
await check("negative paths preserve case separators exact prefix and wildcard matcher", async () => {
  for (const pattern of ["SRC", "src/inert.ts", "src/*.ts", "src\\inert.ts"]) {
    const make = () => { const input = fixture(); input.negativeConstraints = [{ kind: "path", pattern }]; return input; };
    assert.deepEqual(await differential(make), []);
  }
});
await check("semantic negative constraints remain ignored by the production path matcher", async () => {
  const make = () => { const input = fixture(); input.negativeConstraints = [{ kind: "semantic", description: "inert" }]; return input; };
  assert.equal((await differential(make)).length, 1);
});
await check("empty or whitespace-only queries retain empty results", async () => {
  for (const query of ["", " \t\r\n "]) for (const operation of operations) assert.deepEqual(await differential(fixture, operation, query), []);
});
await check("invalid limits retain empty results without coercion", async () => {
  for (const limit of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "4", null])
    assert.deepEqual(await differential(fixture, "searchPaths", "inert", limit as number), []);
});
await check("non-string query rejection is not converted into no-match", async () => {
  for (const factory of [createLiveRepositorySearch, createBaselineSearch]) {
    const input = fixture(); await assert.rejects(factory(input).searchPaths({ snapshotId: input.snapshot.id, query: 7 as unknown as string, limit: 10 }), TypeError);
  }
});
await check("limits above 100 cap results only after traversal and sorting", async () => {
  const make = () => fixture(Array.from({ length: 130 }, (_, index) => file(`src/inert-${String(index).padStart(3, "0")}.ts`)).reverse());
  const result = await differential(make, "searchPaths", "inert", 1000); assert.equal(result.length, 100); assert.equal(result[0].path, "src/inert-000.ts");
  assert.equal((await differential(make, "searchPaths", "inert", 2)).length, 2);
});
await check("stable sorting uses existing localeCompare, not a replacement ranker", async () => {
  const names = ["src/z-inert.ts", "src/A-inert.ts", "src/a-inert.ts"];
  assert.deepEqual(paths(await differential(() => fixture(names.map((name) => file(name))))), [...names].sort((a, b) => a.localeCompare(b)));
});
await check("multiple matching fields yield one lead per inventory row", async () => {
  const make = () => fixture([file("src/inert.ts", { symbols: ["inert", "inert"], imports: ["inert"], exports: ["inert"] })]);
  assert.equal((await differential(make, "searchSymbols")).length, 1);
});
await check("empty inventory returns empty results", async () => { assert.deepEqual(await differential(() => fixture([])), []); });
await check("duplicate normalized inventory paths are not silently deduplicated", async () => {
  // Deliberately contradictory fixture, not a valid scanner/canonical snapshot.
  const make = () => { const input = fixture(); input.inventory.files.push(file("src\\inert.ts")); return input; };
  const result = await differential(make); assert.equal(result.length, 2); assert.equal(result[0].entityId, result[1].entityId);
});
await check("duplicate descriptor paths retain Map last-entry-wins behavior", async () => {
  const make = () => { const input = fixture(); input.snapshot.files.push({ ...input.snapshot.files[0], id: "file_last" as (typeof input.snapshot.files)[number]["id"] }); return input; };
  assert.equal((await differential(make))[0].entityId, "file_last");
});
await check("case-ambiguous paths retain distinct descriptor identities", async () => {
  const result = await differential(() => fixture([file("src/Inert.ts"), file("src/inert.ts")]));
  assert.equal(result.length, 2); assert.notEqual(result[0].entityId, result[1].entityId);
});
await check("cancellation before search returns no partial leads", async () => {
  const make = () => { const input = fixture(); input.cancellation = { isCancellationRequested: () => true }; return input; };
  assert.deepEqual(await differential(make), []);
});
await check("cancellation during traversal is checked every 32 rows", async () => {
  const make = () => { const input = fixture(Array.from({ length: 100 }, (_, i) => file(`src/inert-${i}.ts`))); let calls = 0;
    input.cancellation = { isCancellationRequested: () => ++calls === 3 }; return input; };
  assert.deepEqual(await differential(make), []);
});
await check("abort during synchronous traversal rejects partial leads", async () => {
  const make = () => { const input = fixture(Array.from({ length: 100 }, (_, i) => file(`src/inert-${i}.ts`))); const controller = new AbortController(); let calls = 0;
    input.abortSignal = controller.signal; input.cancellation = { isCancellationRequested: () => { if (++calls === 3) controller.abort(); return false; } }; return input; };
  assert.deepEqual(await differential(make), []);
});
await check("cancellation/abort arriving at asynchronous yield is observed", async () => {
  for (const factory of [createLiveRepositorySearch, createBaselineSearch]) for (const abort of [false, true]) {
    const input = fixture(Array.from({ length: 300 }, (_, i) => file(`src/inert-${i}.ts`))); const controller = new AbortController(); let cancelled = false;
    input.abortSignal = controller.signal; input.cancellation = { isCancellationRequested: () => cancelled };
    setImmediate(() => { if (abort) controller.abort(); else cancelled = true; });
    assert.deepEqual(await factory(input).searchPaths({ snapshotId: input.snapshot.id, query: "inert", limit: 20 }), []);
  }
});
await check("periodic yielding occurs at 256 and 512, not during short traversal", async () => {
  for (const factory of [createLiveRepositorySearch, createBaselineSearch]) for (const count of [256, 513]) {
    const input = fixture(Array.from({ length: count }, (_, i) => file(`src/inert-${i}.ts`))); let turns = 0, active = true;
    const tick = () => { if (active) { turns += 1; setImmediate(tick); } }; setImmediate(tick);
    try { const result = await factory(input).searchPaths({ snapshotId: input.snapshot.id, query: "inert", limit: 20 });
      assert.equal(result.length, 20); assert.equal(turns, count === 256 ? 0 : 2); }
    finally { active = false; await new Promise<void>((resolve) => setImmediate(resolve)); }
  }
});
await check("construction does not poll cancellation or execute search", () => {
  for (const factory of [createLiveRepositorySearch, createBaselineSearch]) {
    const input = fixture(); input.cancellation = { isCancellationRequested: () => { throw new Error("unexpected_poll"); } };
    assert.deepEqual(Object.keys(factory(input)).sort(), [...operations].sort());
  }
});
await check("existing caller mutation and captured descriptor-map lifetime remain explicit", async () => {
  for (const factory of [createLiveRepositorySearch, createBaselineSearch]) {
    const input = fixture(); const port = factory(input);
    input.inventory.files[0].textHints.push("later-hint");
    assert.equal((await port.searchText({ snapshotId: input.snapshot.id, query: "later-hint", limit: 10 })).length, 1);
    input.inventory.files.push(file("src/later.ts")); input.snapshot.files.push({ ...input.snapshot.files[0], normalizedPath: "src/later.ts", path: "src/later.ts" });
    assert.deepEqual(await port.searchPaths({ snapshotId: input.snapshot.id, query: "later.ts", limit: 10 }), []);
    input.negativeConstraints = [{ kind: "path", pattern: "src" }];
    assert.deepEqual(await port.searchPaths({ snapshotId: input.snapshot.id, query: "inert", limit: 10 }), []);
  }
});
await check("search does not mutate synthetic inventory snapshot constraints or query", async () => {
  const input = fixture(), before = structuredClone({ inventory: input.inventory, snapshot: input.snapshot, constraints: input.negativeConstraints });
  const query = { snapshotId: input.snapshot.id, query: "inert", limit: 10 }; const originalQuery = { ...query };
  await createLiveRepositorySearch(input).searchPaths(query);
  assert.deepEqual({ inventory: input.inventory, snapshot: input.snapshot, constraints: input.negativeConstraints }, before); assert.deepEqual(query, originalQuery);
});
await check("ordinary search leads do not expose private hints or execution permission", async () => {
  const make = () => fixture([file("src/inert.ts", { textHints: ["PRIVATE_INERT_HINT"] })]);
  const result = await differential(make, "searchText", "PRIVATE_INERT_HINT");
  assert.ok(!JSON.stringify(result).includes("PRIVATE_INERT_HINT")); assert.deepEqual(Object.keys(result[0]).sort(), ["entityId", "kind", "path", "snapshotId"]);
});
process.stdout.write(`Production repository search parity smoke passed: ${scenarios} scenarios; baseline SHA-pinned extraction + independent assertions; zero filesystem operations, providers, DB or Primary investigations.\n`);
