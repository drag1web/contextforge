import assert from "node:assert/strict";
import fs from "node:fs";
import { prepareContextEngineShadowInput, isPreparedContextEngineShadowInput, assertContextEngineShadowInputEquivalent } from "../shadow/shadowInputPreparation.js";
import { createContextEngineShadowExecutionBasis } from "../shadow/shadowExecutionBasis.js";
import type { ContextEngineShadowPolicy } from "../shadow/shadowTypes.js";
import type { EntityId } from "../contracts/ids.js";
import { createSyntheticPrimarySource, authorizeSyntheticPrimarySource, createRestrictedPrimaryCapabilities,
  createPrimaryReadOnlyBoundary, PRIMARY_BOUNDARY_PROFILE } from "../validation/realWorld/primaryReadOnlyBoundary.js";
import { inspectPrimaryPolicySource } from "../validation/realWorld/primaryBoundaryPolicy.js";
import { boundaryHash } from "../validation/realWorld/primaryBoundaryData.js";
import { createPrimarySyntheticRepositoryPorts } from "../validation/realWorld/primarySyntheticRepositoryPorts.js";
import { createSyntheticCanonicalSourceBinding } from "./syntheticCanonicalSourceBinding.js";

// Run the import-closure smoke FIRST. Policy source is read only as audited DATA.
const policy = inspectPrimaryPolicySource(fs.readFileSync(new URL("../retirement/primaryPolicy.ts", import.meta.url), "utf8"));
const files = [{ path: "src/zeta.ts", content: "body-only" }, { path: "src/a.tsx", content: "α🙂\r\nx" }, { path: "lib/empty.json", content: "" }];
function fixture(sourceFiles = files, protectedScopes: string[] = []) {
  const source = createSyntheticPrimarySource({ kind: "synthetic_in_memory", files: sourceFiles });
  const authorization = authorizeSyntheticPrimarySource({ source, sourceDigest: source.sourceDigest, scope: "synthetic_boundary_only", approved: true,
    evidenceDigest: boundaryHash("mechanical source approval") });
  const capabilities = createRestrictedPrimaryCapabilities({ source, authorization }), boundary = createPrimaryReadOnlyBoundary();
  const packet = { profileId: PRIMARY_BOUNDARY_PROFILE, source, sourceDigest: source.sourceDigest, authorization, capabilities, policy, plannerMode: "deterministic" };
  const admission = boundary.requestSourceReadPermit(packet);
  if (admission.status !== "source_read_permitted") throw new Error("fixture_admission_failed");
  const authority = { boundary, permit: admission.permit, sourceDigest: source.sourceDigest };
  const request = { normalizedTask: "Inspect inert fixture metadata.", clarificationBasis: [{ questionId: "a", answer: "inert" }],
    structuredTargets: [], protectedScopes, createdAt: "2026-01-01T00:00:00.000Z",
    executionBasis: createContextEngineShadowExecutionBasis({ policy: admission.productionPolicy as unknown as ContextEngineShadowPolicy,
      requestedTaskType: "general", effectiveTaskArea: "backend", plannerMode: "deterministic" }) };
  const session = createSyntheticCanonicalSourceBinding(authority), prepared = session.prepare(request);
  return { source, packet, authority, request, session, ...prepared };
}
type Fixture = ReturnType<typeof fixture>;
function verify(value: Fixture, changes: Record<string, unknown> = {}) {
  return value.session.verify({ ...value.authority, canonical: value.canonical, witness: value.witness, ...changes });
}
function changed(mutate: (value: Fixture) => void) {
  const value = fixture(); mutate(value);
  assert.equal(isPreparedContextEngineShadowInput(value.canonical), true);
  assert.throws(() => verify(value));
}
let scenarios = 0;
async function check(name: string, run: () => void | Promise<void>) { await run(); scenarios += 1; process.stdout.write(`PASS ${name}\n`); }
const f = fixture();
await check("genuine production issuer and equivalence accept owned synthetic preparation", () => {
  assert.equal(isPreparedContextEngineShadowInput(f.canonical), true); assertContextEngineShadowInputEquivalent(f.canonical);
  assert.equal(verify(f), f.witness); assert.equal(f.witness.provenance, "authenticated_synthetic_bytes_to_owned_inventory");
});
await check("three identities stay distinct and metadata is never a byte seal", () => {
  assert.equal(f.witness.metadataIsByteSeal, false); assert.equal(f.canonical.snapshot.metadata.fingerprintKind, "metadata_derived");
  assert.notEqual(f.witness.sourceSnapshotId, f.witness.canonicalSnapshotId);
  assert.notEqual(f.canonical.snapshotFingerprint, f.witness.sourceDigest);
  for (const row of f.witness.files) {
    assert.match(row.metadataFingerprint, /^metadata-sha256:/u); assert.match(row.byteDigest, /^sha256:/u);
    assert.notEqual(row.metadataFingerprint, row.byteDigest); assert.notEqual(row.canonicalFileId, row.sourceFileId);
  }
});
await check("complete file coverage uses actual UTF-8 bytes and both generated entity sets", () => {
  assert.deepEqual(f.witness.files.map((row) => row.path), ["lib/empty.json", "src/a.tsx", "src/zeta.ts"]);
  const ports = createPrimarySyntheticRepositoryPorts(f.authority);
  for (const row of f.witness.files) {
    const source = files.find((file) => file.path === row.path)!, metadata = f.canonical.snapshot.files.find((file) => file.normalizedPath === row.path)!;
    assert.equal(row.bytes, Buffer.byteLength(source.content)); assert.equal(row.byteDigest, boundaryHash(source.content));
    assert.equal(row.canonicalFileId, metadata.id); assert.equal(row.sourceFileId, ports.snapshot.files.find((file) => file.path === row.path)!.id);
  }
});
await check("reconstructed serialized and spread canonical objects are rejected", () => {
  for (const canonical of [structuredClone(f.canonical), JSON.parse(JSON.stringify(f.canonical)), { ...f.canonical }])
    assert.throws(() => verify(f, { canonical }), { code: "canonical_not_issued" });
});
await check("unowned genuinely issued object with identical metadata has no byte provenance", () => {
  const canonical = prepareContextEngineShadowInput({ projectId: f.canonical.projectId, projectRoot: f.canonical.projectRoot,
    inventory: structuredClone(f.canonical.inventory), ...f.request });
  assert.equal(isPreparedContextEngineShadowInput(canonical), true); assert.equal(canonical.snapshot.id, f.canonical.snapshot.id);
  assert.throws(() => verify(f, { canonical }), { code: "provenance_unavailable" });
});
await check("another preparation call cannot substitute canonical object identity", () => {
  const other = f.session.prepare(f.request); assert.notEqual(other.canonical, f.canonical); assert.notEqual(other.witness, f.witness);
  assert.throws(() => verify(f, { canonical: other.canonical }), { code: "provenance_unavailable" });
  assert.equal(f.session.verify({ ...f.authority, ...other }), other.witness);
});
await check("genuine changed file metadata fails original production equivalence", () => { changed((value) => { value.canonical.inventory.files[0].sizeBytes += 1; }); });
await check("mutated fields not covered by production equivalence fail the association seal", () => {
  const value = fixture(); value.canonical.inventory.notes.push("changed"); assertContextEngineShadowInputEquivalent(value.canonical);
  assert.throws(() => verify(value), { code: "canonical_changed" });
});
await check("changed clarification contents are rejected while issuer identity remains genuine", () => { changed((value) => { value.canonical.clarificationBasis[0].answer = "changed"; }); });
await check("missing inventory and snapshot files are rejected", () => {
  changed((value) => { value.canonical.inventory.files.pop(); }); changed((value) => { value.canonical.snapshot.files.pop(); });
});
await check("additional inventory and snapshot files are rejected", () => {
  changed((value) => { value.canonical.inventory.files.push({ ...value.canonical.inventory.files[0], path: "src/extra.ts" }); });
  changed((value) => { value.canonical.snapshot.files.push({ ...value.canonical.snapshot.files[0], normalizedPath: "src/extra.ts" }); });
});
await check("duplicate paths and duplicate entity mappings are rejected", () => {
  changed((value) => { value.canonical.inventory.files[1].path = value.canonical.inventory.files[0].path; });
  changed((value) => { value.canonical.snapshot.files[1].id = value.canonical.snapshot.files[0].id; });
});
await check("source input reordering is deterministic without cross-session authority reuse", () => {
  const other = fixture([...files].reverse()); assert.equal(other.source.sourceDigest, f.source.sourceDigest);
  assert.deepEqual(other.witness.files, f.witness.files);
  assert.throws(() => other.session.verify({ ...other.authority, canonical: other.canonical, witness: f.witness }), { code: "capability_rejected" });
});
await check("post-issuance inventory reordering is mutation, not new provenance", () => {
  const value = fixture(); value.canonical.inventory.files.reverse(); assertContextEngineShadowInputEquivalent(value.canonical);
  assert.throws(() => verify(value), { code: "canonical_changed" });
});
await check("contradictory production size snapshot ID and entity identity are rejected", () => {
  changed((value) => { value.canonical.snapshot.files[0].sizeBytes += 1; });
  changed((value) => { value.canonical.snapshot.files[0].snapshotId = f.witness.sourceSnapshotId; });
  changed((value) => { value.canonical.snapshot.files[0].id = "file_contradiction" as EntityId; });
});
await check("case-only path changes and separator aliases cannot be reconciled by assumption", () => {
  changed((value) => { value.canonical.inventory.files[1].path = "src/A.tsx"; });
  changed((value) => { value.canonical.inventory.files[1].path = "src\\a.tsx"; });
  changed((value) => { value.canonical.snapshot.files[1].normalizedPath = "./src/a.tsx"; });
  assert.throws(() => fixture([{ path: "src/a.ts", content: "x" }, { path: "src/A.ts", content: "x" }]), { code: "invalid_input" });
});
await check("same-instance real read permit is required for construction and verification", () => {
  assert.throws(() => createSyntheticCanonicalSourceBinding({ ...f.authority, boundary: createPrimaryReadOnlyBoundary() }), { code: "capability_rejected" });
  assert.throws(() => verify(f, { boundary: createPrimaryReadOnlyBoundary() }), { code: "source_mismatch" });
});
await check("copied serialized forged and null permits are rejected without callbacks", () => {
  for (const permit of [{}, null, { ...f.authority.permit }, JSON.parse(JSON.stringify(f.authority.permit))]) {
    assert.throws(() => createSyntheticCanonicalSourceBinding({ ...f.authority, permit }), { code: "capability_rejected" });
    assert.throws(() => verify(f, { permit }), { code: "source_mismatch" });
  }
});
await check("a second genuine permit for the same source is not the recorded permit", () => {
  const next = f.authority.boundary.requestSourceReadPermit(f.packet); assert.equal(next.status, "source_read_permitted");
  if (next.status !== "source_read_permitted") throw new Error("fixture_admission_failed");
  assert.throws(() => verify(f, { permit: next.permit }), { code: "source_mismatch" });
});
await check("source digest mismatch and a stale old-source permit cannot be admitted", () => {
  const other = fixture([{ path: "src/zeta.ts", content: "changed!!" }]);
  assert.throws(() => createSyntheticCanonicalSourceBinding({ ...f.authority, sourceDigest: other.source.sourceDigest }), { code: "source_mismatch" });
  assert.throws(() => verify(f, { sourceDigest: other.source.sourceDigest }), { code: "source_mismatch" });
  assert.throws(() => createSyntheticCanonicalSourceBinding({ ...other.authority, permit: f.authority.permit }), { code: "capability_rejected" });
});
await check("same-length changed content cannot reuse any prior binding", () => {
  const a = fixture([{ path: "src/a.ts", content: "one" }]), b = fixture([{ path: "src/a.ts", content: "two" }]);
  assert.equal(a.witness.files[0].bytes, b.witness.files[0].bytes); assert.notEqual(a.witness.sourceDigest, b.witness.sourceDigest);
  assert.notEqual(a.witness.files[0].byteDigest, b.witness.files[0].byteDigest);
  assert.throws(() => b.session.verify({ ...b.authority, canonical: b.canonical, witness: a.witness }), { code: "capability_rejected" });
  assert.throws(() => verify(a, { ...b.authority }), { code: "source_mismatch" });
});
await check("immutable witness copies and fabricated file mappings have no custody record", () => {
  assert.ok(Object.isFrozen(f.witness) && Object.isFrozen(f.witness.files) && Object.isFrozen(f.witness.files[0]));
  assert.throws(() => Object.assign(f.witness.files[0], { byteDigest: boundaryHash("changed") }), TypeError);
  for (const witness of [{ ...f.witness }, structuredClone(f.witness), { ...f.witness, files: [] }, {}])
    assert.throws(() => verify(f, { witness }), { code: "capability_rejected" });
});
await check("request closure invalidates witnesses but does not pretend to revoke B1 source permits", () => {
  const value = fixture(); value.session.close();
  assert.throws(() => verify(value), { code: "binding_closed" }); assert.throws(() => value.session.prepare(value.request), { code: "binding_closed" });
  assert.ok(value.authority.boundary.readSource(value.authority.permit, "src/zeta.ts"));
});
await check("caller source and preparation request mutation cannot alter captured provenance", () => {
  const source = files.map((file) => ({ ...file })), value = fixture(source);
  source[0].content = "changed!!"; value.request.clarificationBasis[0].answer = "changed";
  assert.equal(verify(value), value.witness); assert.equal(value.canonical.clarificationBasis[0].answer, "inert");
});
await check("S1 reader still verifies real synthetic bytes under source IDs only", async () => {
  const ports = createPrimarySyntheticRepositoryPorts(f.authority);
  for (const row of f.witness.files) {
    const result = await ports.reader.readFile({ snapshotId: f.witness.sourceSnapshotId, fileId: row.sourceFileId,
      path: row.path, expectedFingerprint: row.byteDigest, maxBytes: row.bytes });
    assert.equal(result.status, "success"); if (result.status === "success") assert.equal(result.content, files.find((file) => file.path === row.path)!.content);
    await assert.rejects(ports.reader.readFile({ snapshotId: f.witness.canonicalSnapshotId, fileId: row.canonicalFileId,
      path: row.path, expectedFingerprint: row.metadataFingerprint, maxBytes: row.bytes }), { code: "invalid_input" });
  }
});
await check("S1 search still uses path-only metadata with correct source results", async () => {
  const ports = createPrimarySyntheticRepositoryPorts(f.authority), row = f.witness.files.find((file) => file.path === "src/zeta.ts")!;
  for (const method of [ports.search.searchPaths, ports.search.searchText, ports.search.searchSymbols]) {
    assert.deepEqual(await method({ snapshotId: f.witness.sourceSnapshotId, query: "zeta", limit: 1 }),
      [{ kind: "lead", snapshotId: f.witness.sourceSnapshotId, entityId: row.sourceFileId, path: row.path }]);
    assert.deepEqual(await method({ snapshotId: f.witness.sourceSnapshotId, query: "body-only", limit: 1 }), []);
    assert.deepEqual(await method({ snapshotId: f.witness.canonicalSnapshotId, query: "zeta", limit: 1 }), []);
  }
  assert.equal(ports.searchCoverage.noMatchIsAbsenceEvidence, false);
});
await check("negative constraints retain genuine derivation and S1 production matcher behavior", async () => {
  const value = fixture(files, ["src/zeta.ts", "behavior"]);
  assert.deepEqual(value.canonical.negativeConstraints, [{ kind: "path", pattern: "src/zeta.ts" }, { kind: "semantic", description: "behavior" }]);
  assert.equal(verify(value), value.witness);
  const ports = createPrimarySyntheticRepositoryPorts({ ...value.authority, negativeConstraints: value.canonical.negativeConstraints });
  assert.deepEqual(await ports.search.searchPaths({ snapshotId: ports.snapshot.id, query: "zeta", limit: 10 }), []);
  assert.equal((await ports.search.searchPaths({ snapshotId: ports.snapshot.id, query: "src/a", limit: 10 })).length, 1);
});
await check("unsupported S1 negative-constraint envelope fails closed, never removes constraints", () => {
  const value = fixture(); assert.throws(() => value.session.prepare({ ...value.request, protectedScopes: ["src/?.ts"] }), { code: "invalid_input" });
});
await check("the supplied Primary policy remains explicit and unchanged", () => {
  assert.equal(f.canonical.executionBasis.policy.budget.maxParsedFiles, 7);
  assert.equal(f.canonical.executionBasis.policy.budget.maxWallTimeMs, 1500); assert.equal(f.canonical.executionBasis.policy.timeoutMs, 1750);
});
await check("accessor data and injected inventory roots callbacks or oracles are rejected", () => {
  let calls = 0; const request = { ...f.request };
  Object.defineProperty(request, "normalizedTask", { enumerable: true, get() { calls += 1; return "inert"; } });
  assert.throws(() => f.session.prepare(request), { code: "invalid_input" });
  for (const field of ["inventory", "projectRoot", "oracle", "evaluator", "expectedOwners", "readSource", "executor"])
    assert.throws(() => f.session.prepare({ ...f.request, [field]: () => { calls += 1; } }), { code: "invalid_input" });
  assert.equal(calls, 0);
});
await check("canonical accessors introduced after issuance are rejected without invocation", () => {
  const value = fixture(); let calls = 0;
  Object.defineProperty(value.canonical.inventory.files[0], "name", { enumerable: true, get() { calls += 1; return "empty.json"; } });
  assert.throws(() => verify(value), { code: "invalid_input" }); assert.equal(calls, 0);
});
await check("witness exposes no source task root execution callback or read authority", () => {
  const output = JSON.stringify(f.witness);
  for (const text of ["body-only", "Inspect inert", "__synthetic_canonical_only__", "contentPreview"]) assert.ok(!output.includes(text));
  assert.equal(f.witness.executionAuthority, "none");
  assert.throws(() => f.authority.boundary.readSource(f.witness, "src/zeta.ts"), { code: "capability_rejected" });
  assert.equal(f.authority.boundary.requestPrimaryExecutionPermit(f.witness).permit, null);
  assert.equal(f.authority.boundary.requestPrimaryExecutionPermit(f.packet).code, "production_adapter_not_connected");
  assert.equal(f.authority.boundary.requestPrimaryExecutionPermit({ ...f.packet, capabilities: f.witness }).code, "capability_rejected");
});
process.stdout.write(`Synthetic canonical source binding smoke passed: ${scenarios} scenarios; genuine issuer + authenticated byte provenance; zero extractor/Runner/Primary calls.\n`);
