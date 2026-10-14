import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import type { RepositoryReaderPort, ReadFileRequest, RepositoryReadResult, RepositoryReadSuccess } from "../ports/repositoryReaderPort.js";
import type { EntityId, SnapshotId } from "../contracts/ids.js";
import {
  createSyntheticPrimarySource, authorizeSyntheticPrimarySource, createRestrictedPrimaryCapabilities,
  createPrimaryReadOnlyBoundary, describeSyntheticSourceReadBasis, PRIMARY_BOUNDARY_PROFILE,
} from "../validation/realWorld/primaryReadOnlyBoundary.js";
import { inspectPrimaryPolicySource } from "../validation/realWorld/primaryBoundaryPolicy.js";
import { boundaryHash } from "../validation/realWorld/primaryBoundaryData.js";
import { createPrimarySyntheticRepositoryPorts, PRODUCTION_SEARCH_STATUS } from "../validation/realWorld/primarySyntheticRepositoryPorts.js";

// Only audited ContextForge policy source is read as DATA. No real project is read.
const policy = inspectPrimaryPolicySource(fs.readFileSync(new URL("../retirement/primaryPolicy.ts", import.meta.url), "utf8"));
const evidenceDigest = `sha256:${"a".repeat(64)}`;
const authored = "α\t🙂\r\nsecond\rthird\n";
function fixture(files = [{ path: "src/a.ts", content: authored }, { path: "src/empty.ts", content: "" }, { path: "src/bom.ts", content: "\ufeffx" }]) {
  const source = createSyntheticPrimarySource({ kind: "synthetic_in_memory", files });
  const authorization = authorizeSyntheticPrimarySource({ source, sourceDigest: source.sourceDigest, scope: "synthetic_boundary_only", approved: true, evidenceDigest });
  const capabilities = createRestrictedPrimaryCapabilities({ source, authorization });
  const packet = { profileId: PRIMARY_BOUNDARY_PROFILE, source, sourceDigest: source.sourceDigest, authorization, capabilities, policy, plannerMode: "deterministic" as const };
  const boundary = createPrimaryReadOnlyBoundary();
  const admission = boundary.requestSourceReadPermit(packet);
  if (admission.status !== "source_read_permitted") throw new Error("mechanical_admission_failed");
  const input = { boundary, permit: admission.permit, sourceDigest: source.sourceDigest };
  return { source, packet, input, ports: createPrimarySyntheticRepositoryPorts(input) };
}
const f = fixture();
const reader: RepositoryReaderPort = f.ports.reader; // Actual production port type, not a test facsimile.
function request(path = "src/a.ts", basis = f): ReadFileRequest {
  const file = basis.ports.snapshot.files.find((item) => item.path === path)!;
  return { snapshotId: file.snapshotId, fileId: file.id, path: file.path, expectedFingerprint: file.contentFingerprint, maxBytes: file.sizeBytes };
}
function success(value: RepositoryReadResult): RepositoryReadSuccess {
  assert.equal(value.status, "success");
  if (value.status !== "success") throw new Error("mechanical_read_failed");
  return value;
}
async function failed(raw: ReadFileRequest, reason: string) {
  const value = await reader.readFile(raw);
  assert.equal(value.status, "failure");
  if (value.status !== "failure") throw new Error("mechanical_failure_expected");
  assert.equal(value.reason, reason);
  assert.equal(value.message, `Repository read failed: ${reason}.`);
  assert.deepEqual(Object.keys(value).sort(), ["status", "snapshotId", "fileId", "path", "reason", "message"].sort());
}
let scenarios = 0;
async function check(name: string, run: () => void | Promise<void>) { await run(); scenarios += 1; process.stdout.write(`PASS ${name}\n`); }

await check("same-instance source reading uses the actual reader contract", async () => {
  const result = success(await reader.readFile(request()));
  assert.equal(result.content, authored);
  assert.equal(result.bytesRead, Buffer.byteLength(authored));
  assert.equal(result.startLine, 1); assert.equal(result.endLine, 4);
  assert.equal(result.snapshotId, request().snapshotId); assert.equal(result.fileId, request().fileId);
  assert.equal(result.contentFingerprint, boundaryHash(authored));
});
await check("issuer descriptor seam authenticates the instance and excludes source bodies", () => {
  const basis = describeSyntheticSourceReadBasis(f.input.boundary, f.input.permit);
  assert.equal(basis.sourceDigest, f.source.sourceDigest);
  assert.deepEqual(Object.keys(basis.files[0]).sort(), ["bytes", "digest", "path"]);
  assert.ok(!JSON.stringify(basis).includes(authored));
  assert.ok(Object.isFrozen(basis) && Object.isFrozen(basis.files) && Object.isFrozen(basis.files[0]));
});
await check("boundary A permit is rejected by boundary B even for identical source bytes", () => {
  const b = createPrimaryReadOnlyBoundary();
  assert.throws(() => createPrimarySyntheticRepositoryPorts({ ...f.input, boundary: b }), { code: "capability_rejected" });
  assert.throws(() => describeSyntheticSourceReadBasis(b, f.input.permit), { code: "capability_rejected" });
});
await check("copied serialized forged and null permits are rejected", () => {
  for (const permit of [{ ...f.input.permit }, JSON.parse(JSON.stringify(f.input.permit)), {}, null]) {
    assert.throws(() => createPrimarySyntheticRepositoryPorts({ ...f.input, permit }), { code: "capability_rejected" });
  }
});
await check("copied serialized forged issuers cannot call unexpected callbacks", () => {
  let invoked = 0;
  const forged = { readSource() { invoked += 1; }, describe() { invoked += 1; } };
  for (const boundary of [{ ...f.input.boundary }, JSON.parse(JSON.stringify(f.input.boundary)), forged, null]) {
    assert.throws(() => createPrimarySyntheticRepositoryPorts({ ...f.input, boundary }), { code: "capability_rejected" });
  }
  assert.equal(invoked, 0);
});
await check("source digest mismatch fails construction", () => {
  assert.throws(() => createPrimarySyntheticRepositoryPorts({ ...f.input, sourceDigest: evidenceDigest }), { code: "source_mismatch" });
});
await check("unknown file identity returns not_found", async () => {
  await failed({ ...request(), fileId: `synthetic_file_${"0".repeat(64)}` as EntityId }, "not_found");
});
await check("unknown path with a known file identity is contradictory", async () => {
  await failed({ ...request(), path: "src/unknown.ts" }, "fingerprint_mismatch");
});
await check("known other file path cannot reuse an entity identity", async () => {
  await failed({ ...request(), path: "src/empty.ts" }, "fingerprint_mismatch");
});
await check("snapshot mismatch fails closed", async () => {
  await failed({ ...request(), snapshotId: `synthetic_snapshot_${"0".repeat(64)}` as SnapshotId }, "fingerprint_mismatch");
});
await check("expected fingerprint mismatch fails closed", async () => {
  await failed({ ...request(), expectedFingerprint: evidenceDigest }, "fingerprint_mismatch");
});
await check("stale descriptors from changed bytes cannot read the new source", async () => {
  const changed = fixture([{ path: "src/a.ts", content: authored + "x" }]);
  const value = await changed.ports.reader.readFile(request());
  assert.equal(value.status, "failure");
  assert.notEqual(changed.ports.snapshot.id, f.ports.snapshot.id);
});
await check("absolute traversal unsafe and non-canonical paths are rejected without echo", async () => {
  for (const path of ["../a.ts", "src/../a.ts", "/a.ts", "C:/PRIVATE_SENTINEL/a.ts", "src\\a.ts", "./src/a.ts", "node_modules/a.ts", ".env", "src/%2e%2e/a.ts"]) {
    await assert.rejects(reader.readFile({ ...request(), path }), { code: "unsupported_path", message: "unsupported_path" });
  }
});
await check("malformed identities and hash are rejected", async () => {
  for (const value of [{ ...request(), snapshotId: "PRIVATE_SENTINEL" }, { ...request(), fileId: 1 }, { ...request(), expectedFingerprint: "invalid" }]) {
    await assert.rejects(reader.readFile(value as ReadFileRequest), { code: "invalid_input" });
  }
});
await check("exact full byte budget succeeds; smaller budget never truncates", async () => {
  success(await reader.readFile(request()));
  await failed({ ...request(), maxBytes: request().maxBytes - 1 }, "byte_limit");
  await failed({ ...request(), maxBytes: 0 }, "byte_limit");
});
await check("invalid byte limits and live physical ceiling fail closed", async () => {
  for (const maxBytes of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 16 * 1024 * 1024 + 1, "100"]) {
    await failed({ ...request(), maxBytes: maxBytes as number }, "byte_limit");
  }
  success(await reader.readFile({ ...request(), maxBytes: 16 * 1024 * 1024 }));
});
await check("range preserves live split and LF join semantics and full-file fingerprint", async () => {
  const value = success(await reader.readRange({ ...request(), startLine: 1, endLine: 3 }));
  assert.equal(value.content, "α\t🙂\nsecond\nthird");
  assert.equal(value.bytesRead, Buffer.byteLength(value.content));
  assert.equal(value.contentFingerprint, request().expectedFingerprint);
  assert.equal(value.startLine, 1); assert.equal(value.endLine, 3);
});
await check("range requires full source byte budget even for a small selection", async () => {
  const value = await reader.readRange({ ...request(), maxBytes: 1, startLine: 2, endLine: 2 });
  assert.equal(value.status, "failure"); if (value.status === "failure") assert.equal(value.reason, "byte_limit");
});
await check("zero negative reversed out-of-bounds fractional and non-number line ranges fail", async () => {
  for (const [startLine, endLine] of [[0, 1], [-1, 1], [2, 1], [1, 5], [1.5, 2], [1, NaN], [1, Infinity], ["1", 2]]) {
    const value = await reader.readRange({ ...request(), startLine: startLine as number, endLine: endLine as number });
    assert.equal(value.status, "failure"); if (value.status === "failure") assert.equal(value.reason, "range_invalid");
  }
});
await check("empty file is one empty line and accepts zero bytes", async () => {
  const req = request("src/empty.ts");
  assert.deepEqual(success(await reader.readFile(req)), { status: "success", ...{
    snapshotId: req.snapshotId, fileId: req.fileId, path: req.path, content: "", contentFingerprint: req.expectedFingerprint, bytesRead: 0, startLine: 1, endLine: 1,
  } });
  assert.equal(success(await reader.readRange({ ...req, startLine: 1, endLine: 1 })).content, "");
});
await check("UTF-8 bytes not UTF-16 length drive identity and byte limits", async () => {
  const value = success(await reader.readFile(request()));
  assert.notEqual(value.bytesRead, authored.length);
  assert.equal(value.contentFingerprint, `sha256:${createHash("sha256").update(Buffer.from(authored)).digest("hex")}`);
  await failed({ ...request(), maxBytes: authored.length }, "byte_limit");
});
await check("UTF-8 BOM follows live TextDecoder semantics while identity retains all bytes", async () => {
  const value = success(await reader.readFile(request("src/bom.ts")));
  assert.equal(value.content, "x"); assert.equal(value.bytesRead, 4);
  assert.equal(value.contentFingerprint, boundaryHash("\ufeffx"));
});
await check("invalid UTF-8 representable surrogate input cannot be admitted", () => {
  assert.throws(() => fixture([{ path: "src/a.ts", content: "\ud800" }]), { code: "invalid_input" });
});
await check("caller mutation after source admission cannot change readable bytes", async () => {
  const original = [{ path: "src/a.ts", content: authored }];
  const value = fixture(original);
  original[0].path = "src/other.ts"; original[0].content = "changed"; original.push({ path: "src/new.ts", content: "new" });
  assert.equal(success(await value.ports.reader.readFile(request("src/a.ts", value))).content, authored);
  assert.equal(value.ports.snapshot.files.length, 1);
});
await check("constructor packet mutation cannot swap a source or permit", async () => {
  const value = fixture(), other = fixture([{ path: "src/a.ts", content: "changed" }]);
  Object.assign(value.input, other.input);
  assert.equal(success(await value.ports.reader.readFile(request("src/a.ts", value))).content, authored);
});
await check("published snapshot descriptors and port handles are immutable", () => {
  for (const value of [f.ports, f.ports.reader, f.ports.search, f.ports.snapshot, f.ports.snapshot.files, f.ports.snapshot.files[0], f.ports.cancellation]) assert.ok(Object.isFrozen(value));
  assert.throws(() => Object.assign(f.ports.snapshot.files[0], { contentFingerprint: evidenceDigest }), TypeError);
});
await check("identical file sets have stable identities independent of input order", () => {
  const files = [{ path: "src/b.ts", content: "b" }, { path: "src/a.ts", content: "a" }];
  const a = fixture(files), b = fixture([...files].reverse());
  assert.deepEqual(a.ports.snapshot, b.ports.snapshot);
  assert.deepEqual(a.ports.snapshot.files.map((file) => file.path), ["src/a.ts", "src/b.ts"]);
});
await check("manifest digest commits to paths UTF-8 byte lengths and per-file content digests", () => {
  const basis = describeSyntheticSourceReadBasis(f.input.boundary, f.input.permit);
  assert.equal(boundaryHash(JSON.stringify(basis.files.map(({ path, bytes: size, digest }) => ({ path, bytes: size, digest })))), basis.sourceDigest);
  assert.equal(f.ports.snapshot.source, "test_fixture");
  assert.ok(!("projectRoot" in f.ports.snapshot || "inventory" in f.ports.snapshot || "createdAt" in f.ports.snapshot));
});
await check("changed source bytes paths and line endings produce different identities", () => {
  const original = fixture([{ path: "src/a.ts", content: "x\n" }]);
  for (const files of [[{ path: "src/a.ts", content: "y\n" }], [{ path: "src/b.ts", content: "x\n" }], [{ path: "src/a.ts", content: "x\r\n" }]]) {
    assert.notEqual(original.ports.snapshot.id, fixture(files).ports.snapshot.id);
  }
});
await check("owned cancellation returns restricted on both reads and cannot be reset", async () => {
  const value = fixture();
  assert.equal(value.ports.cancellation.isCancellationRequested(), false);
  value.ports.cancel(); assert.equal(value.ports.cancellation.isCancellationRequested(), true);
  for (const result of [await value.ports.reader.readFile(request("src/a.ts", value)), await value.ports.reader.readRange({ ...request("src/a.ts", value), startLine: 1, endLine: 1 })]) {
    assert.equal(result.status, "failure"); if (result.status === "failure") assert.equal(result.reason, "restricted");
  }
});
await check("oracle evaluator roots task and callback fields rejected at construction", () => {
  let invoked = 0;
  for (const field of ["oracle", "evaluator", "ownerPaths", "rawTask", "projectRoot", "executor", "persist", "fetch", "cancellation", "abortSignal"]) {
    assert.throws(() => createPrimarySyntheticRepositoryPorts({ ...f.input, [field]: () => { invoked += 1; } }), { code: "invalid_input" });
  }
  assert.equal(invoked, 0);
});
await check("oracle evaluator and range extras rejected in reader envelopes", async () => {
  for (const field of ["oracle", "evaluator", "expectedOwners", "startLine", "rawTask"]) {
    await assert.rejects(reader.readFile({ ...request(), [field]: "PRIVATE_SENTINEL" } as ReadFileRequest), { code: "invalid_input", message: "invalid_input" });
  }
  await assert.rejects(reader.readRange(request() as never), { code: "invalid_input" });
});
await check("accessors cannot invoke unexpected callbacks during construction or reads", async () => {
  let invoked = 0;
  const input = { ...f.input }, req = request();
  Object.defineProperty(input, "boundary", { enumerable: true, get() { invoked += 1; return f.input.boundary; } });
  Object.defineProperty(req, "path", { enumerable: true, get() { invoked += 1; return "src/a.ts"; } });
  assert.throws(() => createPrimarySyntheticRepositoryPorts(input), { code: "invalid_input" });
  await assert.rejects(reader.readFile(req), { code: "invalid_input" });
  assert.equal(invoked, 0);
});
await check("production search is connected only for documented path metadata", async () => {
  assert.equal(f.ports.searchStatus, PRODUCTION_SEARCH_STATUS);
  assert.equal(f.ports.searchCoverage.noMatchIsAbsenceEvidence, false);
  const query = { snapshotId: f.ports.snapshot.id, query: "src/a.ts", limit: 1 };
  for (const search of [f.ports.search.searchPaths, f.ports.search.searchText, f.ports.search.searchSymbols]) {
    assert.deepEqual(await search(query), [{ kind: "lead", snapshotId: f.ports.snapshot.id, entityId: request().fileId, path: "src/a.ts" }]);
    assert.deepEqual(await search({ ...query, query: "second" }), []);
  }
});
await check("source reading cannot mint Primary execution authority or construct a session", () => {
  assert.equal(f.input.boundary.requestPrimaryExecutionPermit(f.packet).code, "production_adapter_not_connected");
  assert.equal(f.input.boundary.requestPrimaryExecutionPermit(f.input.permit).code, "invalid_input");
  assert.equal(f.input.boundary.requestPrimaryExecutionPermit({ ...f.packet, capabilities: f.input.permit }).code, "capability_rejected");
  assert.deepEqual(Object.keys(f.ports).sort(), ["profileId", "snapshot", "reader", "search", "searchStatus", "searchCoverage", "cancellation", "cancel"].sort());
});
await check("no source body retained in metadata or diagnostic channel", () => {
  assert.ok(!JSON.stringify(f.ports).includes(authored));
  assert.equal("diagnostics" in f.ports || "records" in f.ports || "persist" in f.ports, false);
  assert.deepEqual(Object.keys(f.input.boundary).sort(), ["readSource", "requestPrimaryExecutionPermit", "requestSourceReadPermit"]);
});
process.stdout.write(`Synthetic repository ports smoke passed: ${scenarios} scenarios; zero Primary/CE2 investigations, real source or persistent operations.\n`);
