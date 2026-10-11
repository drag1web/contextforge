import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// Run canonicalPreparationImports.smoke.ts FIRST. Only the reviewed direct
// production modules are exercised; this never imports the broad shadow barrel.
import * as production from "../shadow/shadowInputPreparation.js";
import * as normalizedEntry from "../shadow/../shadow/shadowInputPreparation.js";
import { createContextEngineShadowExecutionBasis, DEFAULT_CONTEXT_ENGINE_SHADOW_POLICY } from "../shadow/shadowExecutionBasis.js";
import { adaptLegacyInventoryToRepositorySnapshot } from "../adapters/legacyInventory/legacyInventorySnapshotAdapter.js";
import { LegacyInventorySnapshotError } from "../adapters/legacyInventory/legacyInventorySupport.js";
import { validateRepositorySnapshot } from "../domain/invariant.js";
import { inspectPrimaryPolicySource, verifiedPrimaryBudgetIdentity } from "../validation/realWorld/primaryBoundaryPolicy.js";
import type { ProjectInventory, ProjectInventoryFile } from "../../scanner/projectInventoryScanner.js";
import type { ContextEngineShadowCanonicalInput, ContextEngineShadowPolicy } from "../shadow/shadowTypes.js";

const { prepareContextEngineShadowInput: prepare, assertContextEngineShadowInputEquivalent: equivalent,
  isPreparedContextEngineShadowInput: issued } = production;
// Read the repository's audited policy as DATA, never import/execute its code.
const policyText = fs.readFileSync(fileURLToPath(new URL("../retirement/primaryPolicy.ts", import.meta.url)), "utf8");
// The exact audited source grammar supplies all eight fields; the evidence API's
// deliberately generic readonly record is narrowed only in this mechanical test.
const primaryPolicy = verifiedPrimaryBudgetIdentity(inspectPrimaryPolicySource(policyText)) as unknown as ContextEngineShadowPolicy;
const executionBasis = createContextEngineShadowExecutionBasis({ policy: primaryPolicy,
  requestedTaskType: "refactor", effectiveTaskArea: "backend", plannerMode: "deterministic" });
// An inert logical root for lexical consistency ONLY. Never create/open/scan it.
const inertRoot = "/__rw02b4_inert_inventory__";
const timestamp = "2026-01-01T00:00:00.000Z";
function file(relative = "src/inert.ts", patch: Partial<ProjectInventoryFile> = {}): ProjectInventoryFile {
  const preview = "export const inert = true;";
  return { path: relative, name: relative.split(/[\\/]/u).at(-1)!, extension: ".ts", kind: "source", role: "service",
    imports: [], exports: ["inert"], symbols: ["inert"], textHints: ["inert"], contentPreview: preview,
    sizeBytes: Buffer.byteLength(preview, "utf8"), depth: 2, canReadText: true, isLikelyGenerated: false, ...patch };
}
function inventory(files = [file()], patch: Partial<ProjectInventory> = {}): ProjectInventory {
  return { rootPath: inertRoot, files, totalFiles: files.length, scannedFiles: files.length, truncated: false, notes: [], ...patch };
}
function fixture(): production.PrepareContextEngineShadowInput {
  return { projectId: "rw02b4-inert", projectRoot: inertRoot, inventory: inventory(), normalizedTask: "  inert\r\nsemantic input  ",
    clarificationBasis: [{ questionId: " z ", answer: " second " }, { questionId: " a ", answer: " first " }],
    structuredTargets: [{ kind: "file", value: "inert", path: "./src/inert.ts", provenance: "user_confirmed" },
      { kind: "symbol", value: " inert ", provenance: "inventory_exact" },
      { kind: "file", value: "unproven", path: "src/unproven.ts", provenance: "model_inferred" }],
    protectedScopes: ["dist/**", " public behavior ", "dist/**"], executionBasis, createdAt: timestamp };
}
const clone = () => structuredClone(prepare(fixture()));
function rejected(mutate: (value: ContextEngineShadowCanonicalInput) => void): void {
  const changed = clone(); mutate(changed); assert.throws(() => equivalent(changed));
}
function adapt(source = inventory(), excludedPatterns?: readonly string[]) {
  return adaptLegacyInventoryToRepositorySnapshot({ inventory: source, projectId: "rw02b4-inert",
    rootUri: "repository://rw02b4-inert", createdAt: timestamp, excludedPatterns });
}
let scenarios = 0;
function check(name: string, run: () => void) { run(); scenarios += 1; process.stdout.write(`PASS ${name}\n`); }

check("actual production preparation returns a valid metadata snapshot", () => {
  const value = prepare(fixture()); assert.equal(value.normalizedTask, "inert\nsemantic input");
  assert.deepEqual(validateRepositorySnapshot(value.snapshot), { valid: true, issues: [] });
  assert.equal(value.snapshot.source, "legacy_inventory_adapter");
  assert.equal(value.snapshot.metadata.fingerprintKind, "metadata_derived");
});
check("genuine object is accepted by the original private issuer", () => { assert.equal(issued(prepare(fixture())), true); });
check("structurally equal reconstructed object is not issued", () => { assert.equal(issued(clone()), false); });
check("serialized/deserialized copy is not issued", () => { assert.equal(issued(JSON.parse(JSON.stringify(prepare(fixture())))), false); });
check("spread/copied object is not issued", () => { assert.equal(issued({ ...prepare(fixture()) }), false); });
check("distinct preparation calls issue distinct identities with deterministic fingerprints", () => {
  const first = prepare(fixture()), second = prepare(fixture());
  assert.notEqual(first, second); assert.ok(issued(first) && issued(second)); assert.deepEqual(first, second);
});
check("supported direct-import spellings share the exact issuer and functions", () => {
  assert.equal(production.prepareContextEngineShadowInput, normalizedEntry.prepareContextEngineShadowInput);
  assert.equal(production.isPreparedContextEngineShadowInput, normalizedEntry.isPreparedContextEngineShadowInput);
  assert.equal(normalizedEntry.isPreparedContextEngineShadowInput(prepare(fixture())), true);
  assert.equal(issued(normalizedEntry.prepareContextEngineShadowInput(fixture())), true);
});
check("unmodified genuine output passes production equivalence", () => { equivalent(prepare(fixture())); });
check("equivalence intentionally does not replace private identity admission", () => { const copied = clone(); equivalent(copied); assert.equal(issued(copied), false); });
check("preparation rejects inconsistent project/inventory roots", () => {
  const input = fixture(); input.projectRoot = "/__rw02b4_other_inert__";
  assert.throws(() => prepare(input), /canonical_input_mismatch/u);
});
check("equivalence rejects changed project root", () => { rejected((value) => { value.projectRoot = "/__rw02b4_other_inert__"; }); });
check("equivalence rejects changed inventory root", () => { rejected((value) => { value.inventory.rootPath = "/__rw02b4_other_inert__"; }); });
check("changed task fingerprint is rejected", () => { rejected((value) => { value.taskFingerprint = "sha256:changed"; }); });
check("changed semantic task is rejected", () => { rejected((value) => { value.normalizedTask = "changed inert input"; }); });
check("changed clarification fingerprint is rejected", () => { rejected((value) => { value.clarificationFingerprint = "sha256:changed"; }); });
check("changed clarification answer is rejected", () => { rejected((value) => { (value.clarificationBasis[0] as { answer: string }).answer = "changed"; }); });
check("changed inventory fingerprint is rejected", () => { rejected((value) => { value.inventoryFingerprint = "sha256:changed"; }); });
check("changed inventory metadata is rejected", () => { rejected((value) => { value.inventory.files[0].sizeBytes += 1; }); });
check("changed snapshot fingerprint is rejected", () => { rejected((value) => { value.snapshotFingerprint = "sha256:changed"; }); });
check("changed snapshot root fingerprint is rejected", () => { rejected((value) => { value.snapshot.rootFingerprint = "inventory-metadata-sha256:changed"; }); });
check("changed configuration fingerprint is rejected", () => { rejected((value) => { value.configurationFingerprint = "sha256:changed"; }); });
check("changed valid execution configuration is rejected against original fingerprint", () => {
  rejected((value) => { value.executionBasis.policy.budget.maxParsedFiles += 1; });
});
check("changed snapshot file path/mapping is rejected", () => { rejected((value) => { value.snapshot.files[0].normalizedPath = "src/other.ts"; }); });
check("changed snapshot file identity is rejected", () => { rejected((value) => { value.snapshot.files[0].id = "file_other" as ContextEngineShadowCanonicalInput["snapshot"]["files"][number]["id"]; }); });
check("changed project identity is rejected", () => { rejected((value) => { value.projectId = "other-inert"; }); });
check("changed snapshot project identity is rejected", () => { rejected((value) => { value.snapshot.projectId = "other-inert"; }); });
check("changed snapshot identity is rejected", () => { rejected((value) => { value.snapshot.id = "snapshot_other" as typeof value.snapshot.id; }); });
check("invalid execution basis is rejected", () => {
  const input = fixture(); input.executionBasis = structuredClone(executionBasis); input.executionBasis.policy.timeoutMs = 0;
  assert.throws(() => prepare(input), /canonical_input_mismatch/u);
});
check("explicit targets retain only confirmed/exact provenance and normalized values", () => {
  assert.deepEqual(prepare(fixture()).explicitTargets, [{ kind: "path", path: "src/inert.ts" }, { kind: "symbol", symbol: "inert" }]);
});
check("protected scopes preserve production path/semantic derivation and deduplication", () => {
  const value = prepare(fixture());
  assert.deepEqual(value.negativeConstraints, [{ kind: "path", pattern: "dist/**" }, { kind: "semantic", description: "public behavior" }]);
  assert.deepEqual(value.snapshot.limits.excludedPatterns, ["dist/**"]);
});
check("clarifications retain production trim and ordering", () => {
  assert.deepEqual(prepare(fixture()).clarificationBasis, [{ questionId: "a", answer: "first" }, { questionId: "z", answer: "second" }]);
});
check("backend-owned task guard rejects empty or clarification document input", () => {
  for (const normalizedTask of [" \r\n ", "## User Clarifications", "User answer: inert", "Question: inert"]) {
    assert.throws(() => prepare({ ...fixture(), normalizedTask }));
  }
});
check("audited Primary policy stays explicit; Shadow default difference is not repaired", () => {
  assert.deepEqual(executionBasis.policy.budget, { maxOperations: 20, maxFileReads: 8, maxFileBytes: 512000, maxParsedFiles: 7,
    maxRelationshipHops: 12, maxWallTimeMs: 1500, maxPlannerRounds: 10, maxConcurrentOperations: 1 });
  assert.equal(executionBasis.policy.timeoutMs, 1750); assert.equal(executionBasis.policy.maxHistoryRecords, 50);
  assert.equal(prepare(fixture()).executionBasis.policy.budget.maxParsedFiles, 7);
  assert.equal(DEFAULT_CONTEXT_ENGINE_SHADOW_POLICY.budget.maxParsedFiles, 6);
  assert.equal(createContextEngineShadowExecutionBasis({ requestedTaskType: "refactor", effectiveTaskArea: "backend" }).policy.budget.maxParsedFiles, 6);
});
check("production preparation neither mutates inventory nor grants byte/execution authority", () => {
  const input = fixture(), original = structuredClone(input.inventory), value = prepare(input);
  assert.deepEqual(input.inventory, original); assert.equal(value.inventory, input.inventory);
  assert.ok(Object.isFrozen(value) && Object.isFrozen(value.executionBasis.policy.budget));
  for (const key of ["sourceReadPermit", "executionPermit", "byteManifest", "oracle", "expectedOwner"]) assert.equal(key in value, false);
});
check("existing partial immutability/metadata guard limitations remain visible", () => {
  const input = fixture(), value = prepare(input);
  input.inventory.notes.push("inert inventory note"); equivalent(value); assert.ok(issued(value));
  // These fields are not all part of the original equivalence comparison.
  const copied = clone(); copied.snapshot.createdAt = "2026-01-02T00:00:00.000Z";
  copied.snapshot.limits.maxFiles = 99; equivalent(copied); assert.equal(issued(copied), false);
  input.inventory.files[0].sizeBytes += 1; assert.ok(issued(value)); assert.throws(() => equivalent(value));
});
check("snapshot adapter deterministic identity/order and separator normalization remain unchanged", () => {
  const first = adapt(inventory([file("src/z.ts"), file("src/a.ts")]));
  const second = adapt(inventory([file("src/a.ts"), file("src\\z.ts")]));
  assert.equal(first.id, second.id); assert.deepEqual(first.files, second.files);
  assert.deepEqual(first.files.map((item) => item.normalizedPath), ["src/a.ts", "src/z.ts"]);
});
check("snapshot adapter rejects duplicates and traversal without filesystem access", () => {
  for (const source of [inventory([file("src/inert.ts"), file("src\\inert.ts")]), inventory([file("../outside.ts")])]) {
    assert.throws(() => adapt(source), LegacyInventorySnapshotError);
  }
});
check("snapshot adapter preview metadata changes identity, not a complete byte seal", () => {
  const before = adapt(), after = adapt(inventory([file("src/inert.ts", { contentPreview: "export const inert = false;" })]));
  assert.notEqual(before.id, after.id); assert.notEqual(before.files[0].contentFingerprint, after.files[0].contentFingerprint);
  assert.ok(before.files[0].contentFingerprint.startsWith("metadata-sha256:"));
});
check("snapshot adapter exclusions and truncation/omission reporting remain unchanged", () => {
  const value = adapt(inventory(undefined, { totalFiles: 2, scannedFiles: 1, truncated: true }), ["dist/**", "node_modules/**", "dist/**"]);
  assert.deepEqual(value.limits.excludedPatterns, ["dist/**", "node_modules/**"]);
  assert.deepEqual(value.truncation, { truncated: true, reasons: ["adapter_limit", "file_limit"], omittedPathCount: 1 });
});
check("snapshot adapter unreadable files and invalid timestamps retain domain validation", () => {
  const value = adapt(inventory([file("assets/inert.bin", { canReadText: false, contentPreview: undefined, kind: "asset", role: "asset", extension: ".bin" })]));
  assert.equal(value.files[0].readable, false); assert.equal(value.files[0].secretRisk, "possible");
  assert.throws(() => adaptLegacyInventoryToRepositorySnapshot({ inventory: inventory(), projectId: "rw02b4-inert",
    rootUri: "repository://rw02b4-inert", createdAt: "invalid-timestamp" }), LegacyInventorySnapshotError);
});
check("snapshot output does not add physical root or later-stage records", () => {
  const value = adapt(); assert.ok(!JSON.stringify(value).includes(inertRoot));
  for (const key of ["facts", "evidence", "findings", "score", "executionPermit"]) {
    assert.equal(key in value, false); assert.equal(key in value.files[0], false);
  }
});
process.stdout.write(`Canonical preparation identity/snapshot smoke passed: ${scenarios} scenarios; genuine production transformation on inert inventory only; zero scans, Primary executions or real-source reads.\n`);
