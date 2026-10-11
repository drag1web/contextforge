import assert from "node:assert/strict";
import fs from "node:fs";
import {
  createPrimaryReadOnlyBoundary, createSyntheticPrimarySource, authorizeSyntheticPrimarySource,
  createRestrictedPrimaryCapabilities, PRIMARY_BOUNDARY_PROFILE, MAX_SYNTHETIC_PRIMARY_BYTES,
  MAX_SYNTHETIC_PRIMARY_FILES,
} from "../validation/realWorld/primaryReadOnlyBoundary.js";
import { PrimaryBoundaryError, boundaryHash } from "../validation/realWorld/primaryBoundaryData.js";
import { inspectPrimaryPolicySource, verifiedPrimaryBudgetIdentity, AUDITED_PRIMARY_POLICY_SHA256, AUDITED_PRIMARY_POLICY_CRLF_SHA256 } from "../validation/realWorld/primaryBoundaryPolicy.js";
import { createRealWorldFoundation } from "../validation/realWorld/realWorldFoundation.js";
import { REAL_WORLD_EFFECTS, REAL_WORLD_FOUNDATION_PROFILE } from "../validation/realWorld/realWorldTypes.js";

let scenarios = 0;
function check(name: string, test: () => void) { test(); scenarios += 1; process.stdout.write(`PASS ${name}\n`); }
const policyText = fs.readFileSync(new URL("../retirement/primaryPolicy.ts", import.meta.url), "utf8");
const policyLfText = policyText.replaceAll("\r\n", "\n");
const policyCrlfText = policyLfText.replaceAll("\n", "\r\n");
const policy = inspectPrimaryPolicySource(policyText); // Parse source as data, never import it.
const digest = `sha256:${"a".repeat(64)}`;
const boundary = createPrimaryReadOnlyBoundary();
function packet() {
  const source = createSyntheticPrimarySource({ kind: "synthetic_in_memory", files: [{ path: "src/inert.ts", content: "// inert fixture\r\nЖ 🙂\t\n" }] });
  const authorization = authorizeSyntheticPrimarySource({ source, sourceDigest: source.sourceDigest, scope: "synthetic_boundary_only", approved: true, evidenceDigest: digest });
  const capabilities = createRestrictedPrimaryCapabilities({ source, authorization });
  return { profileId: PRIMARY_BOUNDARY_PROFILE, source, sourceDigest: source.sourceDigest, authorization, capabilities, policy, plannerMode: "deterministic" as const };
}
function rejected(raw: unknown, code: string) {
  const result = boundary.requestSourceReadPermit(raw);
  assert.equal(result.status, "blocked");
  if (result.status !== "blocked") throw new Error("expected_boundary_rejection");
  assert.equal(result.code, code);
  assert.equal(result.permit, null);
  assert.equal(result.engineInvoked, false);
  assert.equal(result.semanticVerdict, null);
}

check("source read permit requires actual branded isolation capabilities", () => {
  const input = packet();
  const result = boundary.requestSourceReadPermit(input);
  assert.equal(result.status, "source_read_permitted");
  if (result.status !== "source_read_permitted") throw new Error("expected_source_only_permit");
  assert.equal(result.permit.scope, "synthetic_source_read_only");
  assert.equal(result.technicalStatus, "not_run");
  assert.equal(result.engineInvoked, false);
  assert.equal(boundary.readSource(result.permit, "src/inert.ts")?.content, "// inert fixture\r\nЖ 🙂\t\n");
  assert.equal(boundary.readSource(result.permit, "src/missing.ts"), null);
});
check("production execution remains BLOCKED even after source checks pass", () => {
  const result = boundary.requestPrimaryExecutionPermit(packet());
  assert.equal(result.code, "production_adapter_not_connected");
  assert.equal(result.permit, null);
  assert.equal(result.technicalStatus, "not_run");
});
check("source-read permits are private to the exact issuing boundary instance", () => {
  const a = createPrimaryReadOnlyBoundary(), b = createPrimaryReadOnlyBoundary();
  const input = packet();
  const left = a.requestSourceReadPermit(input), right = b.requestSourceReadPermit(input);
  if (left.status !== "source_read_permitted" || right.status !== "source_read_permitted") throw new Error("expected_source_only_permit");
  assert.notEqual(left.permit, right.permit);
  assert.deepEqual(left.permit, right.permit); // Same public metadata is NOT issuer authority.
  assert.deepEqual(Object.keys(left.permit).sort(), ["profileId", "scope", "sourceDigest"]);
  assert.equal(a.readSource(left.permit, "src/inert.ts")?.content, "// inert fixture\r\nЖ 🙂\t\n");
  assert.equal(b.readSource(right.permit, "src/inert.ts")?.content, "// inert fixture\r\nЖ 🙂\t\n");
  assert.throws(() => b.readSource(left.permit, "src/inert.ts"), { code: "capability_rejected" });
  assert.throws(() => a.readSource(right.permit, "src/inert.ts"), { code: "capability_rejected" });
  assert.equal(a.requestPrimaryExecutionPermit(input).code, "production_adapter_not_connected");
  assert.equal(b.requestPrimaryExecutionPermit(input).code, "production_adapter_not_connected");
});
check("copied serialized and forged permits cannot acquire issuer or source authority", () => {
  const a = createPrimaryReadOnlyBoundary(), b = createPrimaryReadOnlyBoundary();
  const result = a.requestSourceReadPermit(packet());
  if (result.status !== "source_read_permitted") throw new Error("expected_source_only_permit");
  for (const permit of [{ ...result.permit }, JSON.parse(JSON.stringify(result.permit)), { scope: "synthetic_source_read_only" }]) {
    for (const issuer of [a, b]) assert.throws(() => issuer.readSource(permit, "src/inert.ts"), { code: "capability_rejected" });
  }
});
check("source mismatch rejects admission and later caller mutation cannot retarget a permit", () => {
  const input = packet();
  const source = createSyntheticPrimarySource({ kind: "synthetic_in_memory", files: [{ path: "src/inert.ts", content: "// different inert source" }] });
  const result = boundary.requestSourceReadPermit(input);
  if (result.status !== "source_read_permitted") throw new Error("expected_source_only_permit");
  rejected({ ...input, source }, "source_mismatch");
  rejected({ ...input, source, sourceDigest: source.sourceDigest }, "authorization_missing");
  input.source = source; input.sourceDigest = source.sourceDigest;
  assert.equal(boundary.readSource(result.permit, "src/inert.ts")?.content, "// inert fixture\r\nЖ 🙂\t\n");
  assert.equal(boundary.requestPrimaryExecutionPermit(input).code, "authorization_missing");
});
check("unresolved capability rejects before any read", () => rejected({ ...packet(), capabilities: null }, "dependency_unresolved"));
check("unresolved production policy rejects", () => rejected({ ...packet(), policy: null }, "dependency_unresolved"));
check("missing authorization rejects", () => rejected({ ...packet(), authorization: null }, "authorization_missing"));
check("unapproved authorization cannot be minted", () => {
  const input = packet();
  assert.throws(() => authorizeSyntheticPrimarySource({ source: input.source, sourceDigest: input.sourceDigest, scope: "synthetic_boundary_only", approved: false, evidenceDigest: digest }), { code: "authorization_missing" });
});
check("wrong source digest rejects", () => rejected({ ...packet(), sourceDigest: digest }, "source_mismatch"));
check("authorization cannot cross source instances with identical bytes", () => {
  const left = packet(); const right = packet();
  assert.equal(left.sourceDigest, right.sourceDigest);
  rejected({ ...left, authorization: right.authorization }, "authorization_missing");
});
check("capabilities cannot cross source instances", () => {
  const left = packet(); const right = packet();
  rejected({ ...left, capabilities: right.capabilities }, "capability_rejected");
});
check("source identity cannot be forged or JSON-roundtripped", () => {
  const input = packet();
  rejected({ ...input, source: { ...input.source } }, "source_mismatch");
  rejected(JSON.parse(JSON.stringify(input)), "source_mismatch");
});
check("authorization and policy metadata cannot forge runtime seals", () => {
  const input = packet();
  rejected({ ...input, authorization: { ...input.authorization } }, "authorization_missing");
  rejected({ ...input, policy: { ...input.policy } }, "policy_unverified");
});
for (const effect of REAL_WORLD_EFFECTS) {
  check(`metadata cannot enable ${effect}`, () => {
    let invoked = 0;
    rejected({ ...packet(), capabilities: { disposition: "isolated", [effect]: () => { invoked += 1; } } }, "capability_rejected");
    rejected({ ...packet(), capabilities: { disposition: "write_capable", effect } }, "capability_rejected");
    assert.equal(invoked, 0);
  });
}
check("provider/network callbacks rejected, never invoked", () => {
  let invoked = 0;
  for (const field of ["provider", "network", "fetch", "executor", "persist", "createTaskPack", "settings", "shell", "git"]) {
    rejected({ ...packet(), [field]: () => { invoked += 1; } }, "invalid_input");
  }
  assert.equal(invoked, 0);
});
check("roots/oracle/evaluator/task fields rejected without private echo", () => {
  for (const field of ["projectRoot", "root", "oracle", "expectations", "evaluator", "ownerPaths", "rawTask"]) {
    const result = boundary.requestPrimaryExecutionPermit({ ...packet(), [field]: "PRIVATE_SENTINEL" });
    assert.equal(result.code, "invalid_input");
    assert.ok(!JSON.stringify(result).includes("PRIVATE_SENTINEL"));
  }
});
check("nested source inputs are closed", () => {
  assert.throws(() => createSyntheticPrimarySource({ kind: "synthetic_in_memory", files: [{ path: "src/inert.ts", content: "inert", oracle: {} }] }), PrimaryBoundaryError);
  assert.throws(() => createSyntheticPrimarySource({ kind: "synthetic_in_memory", files: [{ path: "src/inert.ts", content: "inert" }], root: "PRIVATE_SENTINEL" }), PrimaryBoundaryError);
});
check("absolute/traversal/unsafe/generated paths rejected", () => {
  for (const path of ["/src/a.ts", "C:/src/a.ts", "C:\\src\\a.ts", "../src/a.ts", "src/../a.ts", "\\\\host\\src\\a.ts", "file:///src/a.ts", ".env", ".git/a.ts", "node_modules/a.ts", "secrets/a.json", "AGENTS.md", "src/%2e%2e/a.ts"]) {
    assert.throws(() => createSyntheticPrimarySource({ kind: "synthetic_in_memory", files: [{ path, content: "inert" }] }), { code: "unsupported_path" });
  }
});
check("read rejects forged permit and unsupported path", () => {
  assert.throws(() => boundary.readSource({ scope: "synthetic_source_read_only" }, "src/inert.ts"), { code: "capability_rejected" });
  const result = boundary.requestSourceReadPermit(packet());
  if (result.status !== "source_read_permitted") throw new Error("expected_source_only_permit");
  assert.throws(() => boundary.readSource({ ...result.permit }, "src/inert.ts"), { code: "capability_rejected" });
  assert.throws(() => boundary.readSource(result.permit, "../outside.ts"), { code: "unsupported_path" });
});
check("read permit cannot become a primary execution capability", () => {
  const input = packet(); const result = boundary.requestSourceReadPermit(input);
  if (result.status !== "source_read_permitted") throw new Error("expected_source_only_permit");
  rejected({ ...input, capabilities: result.permit }, "capability_rejected");
  assert.equal(boundary.requestPrimaryExecutionPermit(result.permit).code, "invalid_input");
});
check("production policy is parsed exactly, without budget override", () => {
  assert.equal(policy.sourceDigest, AUDITED_PRIMARY_POLICY_SHA256);
  assert.deepEqual(verifiedPrimaryBudgetIdentity(policy), { budget: {
    maxOperations: 20, maxFileReads: 8, maxFileBytes: 512000, maxParsedFiles: 7,
    maxRelationshipHops: 12, maxWallTimeMs: 1500, maxPlannerRounds: 10, maxConcurrentOperations: 1,
  }, timeoutMs: 1750, maxHistoryRecords: 50 });
  assert.throws(() => inspectPrimaryPolicySource(policyText.replace("maxOperations: 20", "maxOperations: 21")), { code: "policy_unverified" });
  assert.throws(() => inspectPrimaryPolicySource(policyText + "\n"), { code: "policy_unverified" });
  rejected({ ...packet(), budget: { maxOperations: 999 } }, "invalid_input");
  rejected({ ...packet(), plannerMode: "model_assisted" }, "invalid_input");
});
check("audited LF and CRLF policy variants preserve one canonical Git-source identity", () => {
  assert.equal(boundaryHash(policyLfText), "sha256:56eac2206b2af326debdde168b3441ae6d46d749045ca9eaa59767bb227b391b");
  assert.equal(boundaryHash(policyCrlfText), "sha256:19b7918564e5bf0df34e3edd805c247987bd68c388800911619435e36089ef3f");
  const lf = inspectPrimaryPolicySource(policyLfText), crlf = inspectPrimaryPolicySource(policyCrlfText);
  assert.equal(lf.sourceDigest, AUDITED_PRIMARY_POLICY_SHA256);
  assert.equal(crlf.sourceDigest, lf.sourceDigest);
  assert.equal(lf.rawSourceDigest, AUDITED_PRIMARY_POLICY_SHA256);
  assert.equal(crlf.rawSourceDigest, AUDITED_PRIMARY_POLICY_CRLF_SHA256);
  assert.equal(lf.newlineFormat, "lf"); assert.equal(crlf.newlineFormat, "crlf");
  assert.deepEqual(verifiedPrimaryBudgetIdentity(lf), verifiedPrimaryBudgetIdentity(crlf));
  for (const evidence of [lf, crlf]) {
    const input = { ...packet(), policy: evidence };
    assert.equal(boundary.requestSourceReadPermit(input).status, "source_read_permitted");
    assert.equal(boundary.requestPrimaryExecutionPermit(input).code, "production_adapter_not_connected");
  }
});
check("every numeric policy literal change fails in both newline variants", () => {
  const literals = [...policyLfText.matchAll(/\b([A-Za-z][A-Za-z0-9]*):\s*([0-9_]+)/gu)];
  assert.equal(literals.length, 10);
  for (const text of [policyLfText, policyCrlfText]) for (const literal of literals) {
    const changed = text.replace(literal[0], `${literal[1]}: ${Number(literal[2].replaceAll("_", "")) + 1}`);
    assert.notEqual(changed, text);
    assert.throws(() => inspectPrimaryPolicySource(changed), { code: "policy_unverified" });
  }
});
check("extra statements and comment modifications cannot be normalized into policy authority", () => {
  for (const text of [policyLfText, policyCrlfText]) for (const changed of [
    text + "export const unrelated = 1;", text + "\n// unrelated comment\n",
    "// changed source comment\n" + text, text.replace("budget:", "/* added comment */ budget:"),
  ]) assert.throws(() => inspectPrimaryPolicySource(changed), { code: "policy_unverified" });
});
check("policy whitespace BOM trailing-newline and mixed/bare-CR changes fail closed", () => {
  for (const text of [policyLfText, policyCrlfText]) for (const changed of [
    " " + text, text + " ", text + "\n", text.replace(/\r?\n$/u, ""),
    text.replace("maxOperations: 20", "maxOperations:  20"), text.replace("    budget:", "\tbudget:"), "\ufeff" + text,
  ]) assert.throws(() => inspectPrimaryPolicySource(changed), { code: "policy_unverified" });
  for (const changed of [policyLfText.replace("\n", "\r\n"), policyCrlfText.replace("\r\n", "\n"),
    policyLfText.replaceAll("\n", "\r"), policyCrlfText.replace("\r\n", "\r\r\n")]) {
    assert.throws(() => inspectPrimaryPolicySource(changed), { code: "policy_unverified" });
  }
});
check("source identity is deterministic and captures exact immutable input", () => {
  const files = [{ path: "src/b.ts", content: "b\r\n" }, { path: "src/a.ts", content: "a\tЖ\n" }];
  const first = createSyntheticPrimarySource({ kind: "synthetic_in_memory", files });
  const second = createSyntheticPrimarySource({ kind: "synthetic_in_memory", files: [...files].reverse() });
  assert.equal(first.sourceDigest, second.sourceDigest);
  files[0].content = "changed";
  assert.notEqual(first.sourceDigest, createSyntheticPrimarySource({ kind: "synthetic_in_memory", files }).sourceDigest);
});
check("source bounds and duplicates reject without clipping", () => {
  for (const files of [
    Array.from({ length: MAX_SYNTHETIC_PRIMARY_FILES + 1 }, (_, i) => ({ path: `src/a${i}.ts`, content: "a" })),
    [{ path: "src/a.ts", content: "x".repeat(MAX_SYNTHETIC_PRIMARY_BYTES + 1) }],
    [{ path: "src/a.ts", content: "x" }, { path: "src/A.ts", content: "x" }],
    [{ path: "src/a.ts", content: "\ud800" }],
  ]) assert.throws(() => createSyntheticPrimarySource({ kind: "synthetic_in_memory", files }), PrimaryBoundaryError);
});
check("getters/custom iterators rejected without invocation", () => {
  let invoked = 0;
  const input = packet();
  Object.defineProperty(input, "sourceDigest", { enumerable: true, get: () => { invoked += 1; return digest; } });
  rejected(input, "invalid_input");
  const files = [{ path: "src/a.ts", content: "inert" }];
  Object.assign(files, { [Symbol.iterator]: () => { invoked += 1; return [][Symbol.iterator](); } });
  assert.throws(() => createSyntheticPrimarySource({ kind: "synthetic_in_memory", files }), PrimaryBoundaryError);
  assert.equal(invoked, 0);
});
check("diagnostics/results never contain private content, roots or exceptions", () => {
  const input = packet();
  const result = boundary.requestPrimaryExecutionPermit({ ...input, rawTask: "PRIVATE_TASK_SENTINEL" });
  assert.deepEqual(Object.keys(result).sort(), ["code", "engineInvoked", "permit", "semanticVerdict", "status", "technicalStatus"]);
  assert.ok(!JSON.stringify(result).includes("PRIVATE_TASK_SENTINEL"));
  assert.equal("message" in result || "stack" in result || "cause" in result, false);
});
check("construction/handles expose no executable write/primary port", () => {
  const input = packet();
  assert.deepEqual(Object.keys(boundary).sort(), ["readSource", "requestPrimaryExecutionPermit", "requestSourceReadPermit"]);
  assert.deepEqual(Object.keys(input.capabilities), ["scope"]);
  assert.ok(Object.isFrozen(input.source));
  assert.ok(Object.isFrozen(input.authorization));
  assert.ok(Object.isFrozen(input.capabilities));
  assert.ok(Object.isFrozen(verifiedPrimaryBudgetIdentity(policy).budget));
});
check("RW-02A remains non-executing and every mechanical slot is accounted", () => {
  const caseIds = ["mechanical-001", "mechanical-002", "mechanical-003"];
  const session = createRealWorldFoundation({ profileId: REAL_WORLD_FOUNDATION_PROFILE, runId: "mechanical-run-001", protocolDigest: digest,
    sourceBasis: { kind: "synthetic_inert", projectAlias: "fixture-001", manifestDigest: digest, authorization: "mechanical_only", authorizationEvidenceDigest: digest },
    runtimeIdentity: { contextforgeCommit: "b".repeat(40), toolingDigest: digest, settingsBasis: "synthetic_inert", safeSettingsDigest: digest,
      productionPolicyDigest: AUDITED_PRIMARY_POLICY_SHA256, intendedEngineMode: "primary", intendedPlannerMode: "deterministic", understandingAvailability: "unresolved" },
    plannedCaseIds: caseIds, dependencies: REAL_WORLD_EFFECTS.map((effect) => ({ effect, disposition: "isolated", evidenceDigest: digest })),
  });
  const decision = boundary.requestPrimaryExecutionPermit(packet());
  assert.equal(decision.technicalStatus, "not_run");
  session.assessCase(caseIds[0], { rawTask: "PRIVATE_MECHANICAL_SENTINEL", taskType: "general", targetTool: "generic" });
  session.skipCase(caseIds[1]);
  const report = session.finalize();
  assert.equal(report.accounting.planned, 3); assert.equal(report.accounting.accounted, 3);
  assert.equal(report.accounting.statusCounts.not_run, 2); assert.equal(report.accounting.statusCounts.skipped, 1);
  assert.equal(report.accounting.engineInvocations, 0); assert.equal(report.executionEnabled, false);
  assert.ok(!JSON.stringify(report).includes("PRIVATE_MECHANICAL_SENTINEL"));
});

process.stdout.write(`Primary read-only boundary smoke passed: ${scenarios} scenarios; zero production/CE2 execution.\n`);
