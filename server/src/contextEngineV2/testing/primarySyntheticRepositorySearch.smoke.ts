import assert from "node:assert/strict";
import fs from "node:fs";
import type { RepositorySearchPort } from "../ports/repositorySearchPort.js";
import type { NegativeConstraint } from "../contracts/task.js";
import {
  createSyntheticPrimarySource, authorizeSyntheticPrimarySource, createRestrictedPrimaryCapabilities,
  createPrimaryReadOnlyBoundary, describeSyntheticSourceReadBasis, PRIMARY_BOUNDARY_PROFILE,
} from "../validation/realWorld/primaryReadOnlyBoundary.js";
import { inspectPrimaryPolicySource } from "../validation/realWorld/primaryBoundaryPolicy.js";
import { boundaryHash } from "../validation/realWorld/primaryBoundaryData.js";
import { createPrimarySyntheticRepositoryPorts, PRODUCTION_SEARCH_STATUS } from "../validation/realWorld/primarySyntheticRepositoryPorts.js";
import { createLiveRepositorySearch } from "../adapters/liveShadow/liveRepositorySearch.js";

// The single repository read is audited policy SOURCE DATA, never project input.
// No extractor, scanner, runner, live reader, provider or storage is imported.
const policy = inspectPrimaryPolicySource(fs.readFileSync(new URL("../retirement/primaryPolicy.ts", import.meta.url), "utf8"));
const evidenceDigest = boundaryHash("synthetic-search-authorization-reference");
const sourceFiles = [
  { path: "src/zeta.ts", content: "export const ContentOnlyToken = 1;" },
  { path: "src/Alpha.tsx", content: "import UnindexedImport from './zeta';" },
  { path: "lib/empty.json", content: "" },
];
function fixture(files = sourceFiles, negativeConstraints?: readonly NegativeConstraint[]) {
  const source = createSyntheticPrimarySource({ kind: "synthetic_in_memory", files });
  const authorization = authorizeSyntheticPrimarySource({ source, sourceDigest: source.sourceDigest, scope: "synthetic_boundary_only", approved: true, evidenceDigest });
  const capabilities = createRestrictedPrimaryCapabilities({ source, authorization });
  const packet = { profileId: PRIMARY_BOUNDARY_PROFILE, source, sourceDigest: source.sourceDigest, authorization, capabilities, policy, plannerMode: "deterministic" };
  const boundary = createPrimaryReadOnlyBoundary();
  const admission = boundary.requestSourceReadPermit(packet);
  if (admission.status !== "source_read_permitted") throw new Error("fixture_admission_failed");
  const input = { boundary, permit: admission.permit, sourceDigest: source.sourceDigest,
    ...(negativeConstraints === undefined ? {} : { negativeConstraints }) };
  return { source, packet, input, ports: createPrimarySyntheticRepositoryPorts(input) };
}
const operations: (keyof RepositorySearchPort)[] = ["searchPaths", "searchText", "searchSymbols"];
let scenarios = 0, comparisons = 0;
async function check(name: string, run: () => void | Promise<void>) { await run(); scenarios += 1; process.stdout.write(`PASS ${name}\n`); }
function baseline(f: ReturnType<typeof fixture>, negativeConstraints: readonly NegativeConstraint[] = []) {
  // Independently reconstruct the exact path-only INPUT, not a search algorithm.
  // The existing production parity smoke separately runs the frozen B5 baseline.
  return createLiveRepositorySearch({
    inventory: { files: f.ports.snapshot.files.map((file) => ({
      path: file.path, name: file.path.split("/").at(-1)!, textHints: [], symbols: [], imports: [], exports: [],
    })) },
    snapshot: { id: f.ports.snapshot.id, files: f.ports.snapshot.files.map((file) => ({ ...file })) },
    negativeConstraints, cancellation: f.ports.cancellation,
  });
}
function query(f: ReturnType<typeof fixture>, text = "src/", limit = 10) { return { snapshotId: f.ports.snapshot.id, query: text, limit }; }
async function differential(f: ReturnType<typeof fixture>, operation: keyof RepositorySearchPort, text: string, limit = 10,
  constraints: readonly NegativeConstraint[] = []) {
  const q = query(f, text, limit);
  const actual = await f.ports.search[operation](q), expected = await baseline(f, constraints)[operation](q);
  assert.deepEqual(actual, expected); comparisons += 1; return actual;
}
const f = fixture();
await check("path search connects the genuine production implementation", async () => {
  assert.deepEqual(await differential(f, "searchPaths", "src/"), f.ports.snapshot.files.filter((file) => file.path.startsWith("src/")).map((file) =>
    ({ kind: "lead", snapshotId: file.snapshotId, path: file.path, entityId: file.id })).sort((a, b) => a.path.localeCompare(b.path)));
});
await check("derived filename search preserves production casing and query trimming", async () => {
  const results = await differential(f, "searchPaths", "  ALPHA.TSX  ");
  assert.equal(results.length, 1); assert.equal(results[0].path, "src/Alpha.tsx");
});
await check("all three production methods match paths within declared available fields", async () => {
  for (const operation of operations) {
    const results = await differential(f, operation, "zeta.ts");
    assert.equal(results.length, 1); assert.equal(results[0].path, "src/zeta.ts");
  }
});
await check("content symbols imports and empty source are not invented scanner metadata", async () => {
  for (const operation of operations) for (const token of ["ContentOnlyToken", "UnindexedImport", "export const", "not-present"]) {
    assert.deepEqual(await differential(f, operation, token), []);
  }
  assert.equal((await differential(f, "searchText", "empty.json")).length, 1);
});
await check("coverage explicitly forbids full text/symbol parity and absence inference", () => {
  assert.equal(f.ports.searchStatus, PRODUCTION_SEARCH_STATUS);
  assert.deepEqual(f.ports.searchCoverage, {
    searchPaths: "path_and_derived_name", searchText: "path_only", searchSymbols: "path_only",
    unavailableFields: ["textHints", "semanticFacts", "symbols", "exports", "imports"], noMatchIsAbsenceEvidence: false,
  });
  assert.ok(Object.isFrozen(f.ports.searchCoverage) && Object.isFrozen(f.ports.searchCoverage.unavailableFields));
});
await check("source digest snapshot entity path and byte fingerprint remain bound", async () => {
  const basis = describeSyntheticSourceReadBasis(f.input.boundary, f.input.permit);
  assert.equal(f.source.sourceDigest, boundaryHash(JSON.stringify(basis.files.map(({ path, bytes: size, digest }) => ({ path, bytes: size, digest })))));
  assert.equal(f.ports.snapshot.id, `synthetic_snapshot_${f.source.sourceDigest.slice(7)}`);
  for (const result of await differential(f, "searchPaths", ".")) {
    const file = f.ports.snapshot.files.find((item) => item.id === result.entityId)!;
    assert.ok(file); assert.equal(result.snapshotId, file.snapshotId); assert.equal(result.path, file.path);
    assert.equal(file.id, `synthetic_file_${boundaryHash(`${file.snapshotId}\0${file.path}`).slice(7)}`);
    assert.equal(file.contentFingerprint, boundaryHash(sourceFiles.find((item) => item.path === file.path)!.content));
  }
});
await check("wrong source digest cannot construct any searchable port", () => {
  assert.throws(() => createPrimarySyntheticRepositoryPorts({ ...f.input, sourceDigest: evidenceDigest }), { code: "source_mismatch" });
});
await check("malformed digest and missing authorization fail before search construction", () => {
  assert.throws(() => createPrimarySyntheticRepositoryPorts({ ...f.input, sourceDigest: "bad" }), { code: "invalid_input" });
  const denied = f.input.boundary.requestSourceReadPermit({ ...f.packet, authorization: null });
  assert.equal(denied.status, "blocked");
  if (denied.status !== "blocked") throw new Error("expected_admission_rejection");
  assert.equal(denied.code, "authorization_missing");
});
await check("same bytes do not permit boundary A authority at boundary B", () => {
  assert.throws(() => createPrimarySyntheticRepositoryPorts({ ...f.input, boundary: createPrimaryReadOnlyBoundary() }), { code: "capability_rejected" });
});
await check("forged copied serialized and null permits reject construction", () => {
  for (const permit of [{}, null, { ...f.input.permit }, JSON.parse(JSON.stringify(f.input.permit))])
    assert.throws(() => createPrimarySyntheticRepositoryPorts({ ...f.input, permit }), { code: "capability_rejected" });
});
await check("forged issuers cannot invoke source callbacks", () => {
  let calls = 0;
  assert.throws(() => createPrimarySyntheticRepositoryPorts({ ...f.input, boundary: { readSource() { calls += 1; } } }), { code: "capability_rejected" });
  assert.equal(calls, 0);
});
await check("caller inventories snapshots indexes and callbacks cannot contradict captured source", () => {
  for (const extra of ["inventory", "snapshot", "files", "symbols", "textHints", "scanner", "search", "cancellation", "abortSignal"])
    assert.throws(() => createPrimarySyntheticRepositoryPorts({ ...f.input, [extra]: { files: [{ path: "src/foreign.ts" }] } }), { code: "invalid_input" });
});
await check("published identity descriptors cannot be changed to contradictory mappings", () => {
  for (const field of ["id", "snapshotId", "path", "normalizedPath", "contentFingerprint", "sizeBytes"])
    assert.throws(() => Object.assign(f.ports.snapshot.files[0], { [field]: "contradiction" }), TypeError);
});
await check("snapshot mismatch retains production empty-result behavior without aliasing", async () => {
  const other = fixture([{ path: "src/Alpha.tsx", content: "different bytes" }]);
  for (const operation of operations) assert.deepEqual(await f.ports.search[operation]({ ...query(f), snapshotId: other.ports.snapshot.id }), []);
  assert.notEqual(other.ports.snapshot.id, f.ports.snapshot.id);
});
await check("same path under changed bytes has a different result entity and snapshot", async () => {
  const a = fixture([{ path: "src/a.ts", content: "one" }]), b = fixture([{ path: "src/a.ts", content: "two" }]);
  const left = (await a.ports.search.searchPaths(query(a, "a.ts")))[0], right = (await b.ports.search.searchPaths(query(b, "a.ts")))[0];
  assert.equal(left.path, right.path); assert.notEqual(left.snapshotId, right.snapshotId); assert.notEqual(left.entityId, right.entityId);
});
await check("stable source/result identity is independent of input order", async () => {
  const other = fixture([...sourceFiles].reverse());
  assert.equal(other.ports.snapshot.id, f.ports.snapshot.id);
  assert.deepEqual(await other.ports.search.searchPaths(query(other, ".")), await f.ports.search.searchPaths(query(f, ".")));
});
await check("request cancellation preserves genuine production empty-result contract", async () => {
  const value = fixture(); value.ports.cancel();
  for (const operation of operations) assert.deepEqual(await differential(value, operation, "."), []);
  assert.equal(value.ports.cancellation.isCancellationRequested(), true);
});
await check("path negative constraints use the exact production matcher", async () => {
  for (const pattern of ["SRC", "src/*.ts", "src\\zeta.ts", "src/Alpha.tsx"]) {
    const constraints: NegativeConstraint[] = [{ kind: "path", pattern }], value = fixture(sourceFiles, constraints);
    for (const operation of operations) await differential(value, operation, ".", 10, constraints);
    assert.ok(!(await value.ports.search.searchPaths(query(value, "."))).some((item) => item.path === "src/zeta.ts" && pattern === "SRC"));
  }
});
await check("semantic constraints are explicitly not evaluated by production path search", async () => {
  const constraints: NegativeConstraint[] = [{ kind: "semantic", description: "zeta" }], value = fixture(sourceFiles, constraints);
  for (const operation of operations) assert.equal((await differential(value, operation, "zeta", 10, constraints)).length, 1);
});
await check("constraint caller mutation cannot widen a captured search restriction", async () => {
  const constraints: NegativeConstraint[] = [{ kind: "path", pattern: "src" }], value = fixture(sourceFiles, constraints);
  constraints[0] = { kind: "path", pattern: "other" }; constraints.length = 0;
  for (const operation of operations) assert.deepEqual(await value.ports.search[operation](query(value, "src")), []);
});
await check("malformed constraints and accessors cannot invoke supplied functions", () => {
  let calls = 0;
  const accessor = { kind: "path" }; Object.defineProperty(accessor, "pattern", { enumerable: true, get() { calls += 1; return "src"; } });
  for (const constraints of [null, [accessor], [{ kind: "path", pattern: "../src" }], [{ kind: "path", pattern: "/src" }], [{ kind: "path", pattern: "src", oracle: "answer" }]])
    assert.throws(() => createPrimarySyntheticRepositoryPorts({ ...f.input, negativeConstraints: constraints }), { code: "invalid_input" });
  assert.equal(calls, 0);
});
await check("sorting and limits match production with the entire permitted 16-file set", async () => {
  const value = fixture(Array.from({ length: 16 }, (_, index) => ({ path: `src/file-${String(index).padStart(2, "0")}.ts`, content: "" })).reverse());
  for (const operation of operations) for (const limit of [1, 2, 16, 101]) {
    const result = await differential(value, operation, "src/", limit);
    assert.equal(result.length, Math.min(limit, 16)); assert.equal(result[0].path, "src/file-00.ts");
  }
});
await check("invalid limits and empty queries keep production behavior", async () => {
  for (const operation of operations) {
    for (const limit of [0, -1, 1.5, NaN, Infinity]) assert.deepEqual(await differential(f, operation, "src", limit), []);
    for (const text of ["", " \t\r\n "]) assert.deepEqual(await differential(f, operation, text), []);
    await assert.rejects(f.ports.search[operation]({ ...query(f), query: 7 as unknown as string }), TypeError);
  }
});
await check("oracle/evaluator/owner fields are rejected in construction and search requests", async () => {
  for (const field of ["oracle", "evaluator", "expectedOwners", "ownerPaths", "rawTask", "sourceDigest"]) {
    if (field !== "sourceDigest") assert.throws(() => createPrimarySyntheticRepositoryPorts({ ...f.input, [field]: "inert" }), { code: "invalid_input" });
    for (const operation of operations) await assert.rejects(f.ports.search[operation]({ ...query(f), [field]: "inert" }), { code: "invalid_input" });
  }
});
await check("query accessors are never invoked and request mutation cannot alter completed leads", async () => {
  let calls = 0;
  const accessor = query(f); Object.defineProperty(accessor, "query", { enumerable: true, get() { calls += 1; return "."; } });
  await assert.rejects(f.ports.search.searchPaths(accessor), { code: "invalid_input" }); assert.equal(calls, 0);
  const q = query(f, "zeta"), pending = f.ports.search.searchPaths(q); q.query = "empty";
  assert.deepEqual((await pending).map((item) => item.path), ["src/zeta.ts"]);
});
await check("admitted source input and constructor packet mutation cannot swap search identity", async () => {
  const authored = sourceFiles.map((item) => ({ ...item })), value = fixture(authored);
  authored[0].path = "src/foreign.ts"; authored[0].content = "changed"; authored.push({ path: "other/new.ts", content: "new" });
  const other = fixture([{ path: "src/foreign.ts", content: "changed" }]); Object.assign(value.input, other.input);
  assert.equal((await value.ports.search.searchPaths(query(value, "zeta")))[0].path, "src/zeta.ts");
  assert.deepEqual(await value.ports.search.searchPaths(query(value, "foreign")), []);
});
await check("construction and search accept no callable source acquisition or persistence", () => {
  let calls = 0;
  for (const field of ["reader", "readSource", "projectRoot", "persist", "fetch", "executor"])
    assert.throws(() => createPrimarySyntheticRepositoryPorts({ ...f.input, [field]: () => { calls += 1; } }), { code: "invalid_input" });
  assert.equal(calls, 0);
  assert.ok(!("inventory" in f.ports || "diagnostics" in f.ports || "records" in f.ports));
});
await check("source bodies are absent from search output and coverage metadata", async () => {
  const output = JSON.stringify({ results: await f.ports.search.searchPaths(query(f, ".")), coverage: f.ports.searchCoverage });
  for (const token of ["ContentOnlyToken", "UnindexedImport"]) assert.ok(!output.includes(token));
  assert.deepEqual(Object.keys((await f.ports.search.searchPaths(query(f, "zeta")))[0]).sort(), ["entityId", "kind", "path", "snapshotId"]);
});
await check("search cannot create a Primary execution permit", () => {
  const denied = f.input.boundary.requestPrimaryExecutionPermit(f.packet);
  assert.equal(denied.status, "blocked"); assert.equal(denied.engineInvoked, false); assert.equal(denied.permit, null);
  assert.equal(denied.code, "production_adapter_not_connected");
});
process.stdout.write(`Synthetic production search smoke passed: ${scenarios} scenarios; ${comparisons} exact production-input comparisons; path metadata only; zero extractor/Runner/Primary calls.\n`);
