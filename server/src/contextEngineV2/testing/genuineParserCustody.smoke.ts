import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import {
  createGenuineTypeScriptParserCustodian,
  GenuineParserAdmissionError,
  type GenuineParserSessionHandle,
  type GenuineParserCustodyHandle,
} from "../adapters/extraction/genuineTypeScriptParserAdmission.js";
import { TYPESCRIPT_PARSER_FUNCTIONS } from "../adapters/extraction/typescriptParserCapabilities.js";
import { createTypeScriptJavaScriptFactExtractor } from "../adapters/extraction/typescriptJavaScriptFactExtractor.js";
import { createTypeScriptJavaScriptFactExtractor as createBaseline } from "./fixtures/typescriptJavaScriptFactExtractorBaseline.js";
import type { ExtractorInput } from "../ports/factExtractorPort.js";

// Synthetic extraction only. No runner, provider, real source or substituted parser invocation.
const clock = { nowIso: () => "2026-01-01T00:00:00.000Z", monotonicMs: () => 0 };
const input = {
  snapshotId: "synthetic-custody-snapshot", fileId: "synthetic-custody-file",
  path: "src/unit.ts", content: "export function target() { return 1; }",
  contentFingerprint: "synthetic-custody-bytes", language: "typescript",
} as ExtractorInput;
const owner = createGenuineTypeScriptParserCustodian();
const grant = owner.admit();
const caps = owner.capabilities(grant.session, grant.custody);
let scenarios = 0;
async function check(name: string, action: () => void | Promise<void>) {
  await action(); scenarios++; process.stdout.write(`PASS ${name}\n`);
}
const code = (expected: GenuineParserAdmissionError["code"]) => (error: unknown) => error instanceof GenuineParserAdmissionError && error.code === expected;
const session = (value: unknown) => value as GenuineParserSessionHandle;
const custody = (value: unknown) => value as GenuineParserCustodyHandle;

await check("approved local bytes and package version admit genuine issuer", () => {
  const runtime = createRequire(import.meta.url).resolve("typescript");
  assert.equal(createHash("sha256").update(fs.readFileSync(runtime)).digest("hex"), grant.identity.runtimeSha256);
  assert.equal(grant.identity.version, "6.0.3"); assert.equal(ts.version, grant.identity.version);
  assert.equal(grant.identity.runtimeBytes, 9144216); assert.equal(owner.state(grant.session, grant.custody), "active");
});
await check("exact minimal 31 functions and three enums", () => {
  assert.equal(TYPESCRIPT_PARSER_FUNCTIONS.length, 31);
  assert.deepEqual(Object.keys(caps).sort(), [...TYPESCRIPT_PARSER_FUNCTIONS, "ScriptTarget", "ScriptKind", "SyntaxKind"].sort());
  for (const name of TYPESCRIPT_PARSER_FUNCTIONS) assert.equal(typeof caps[name], "function");
  for (const name of ["sys", "createProgram", "createCompilerHost", "setSys", "setObjectAllocator", "startTracing"]) assert.ok(!(name in caps));
});
await check("complete enums preserve forward and reverse SyntaxKind behavior", () => {
  for (const name of ["ScriptTarget", "ScriptKind", "SyntaxKind"] as const) {
    assert.deepEqual(Object.entries(caps[name]).sort(), Object.entries(ts[name]).sort());
    assert.notEqual(caps[name], ts[name]); assert.ok(Object.isFrozen(caps[name]));
  }
  assert.equal(caps.SyntaxKind[ts.SyntaxKind.FunctionDeclaration], "FunctionDeclaration");
});
await check("missing session evidence rejects before any parser call", () => {
  for (const value of [null, undefined, "stale-session", 1, {}]) assert.throws(() => owner.capabilities(session(value), grant.custody), code("parser_session_custody_invalid"));
});
await check("missing custody evidence rejects", () => {
  for (const value of [null, undefined, "custody", {}]) assert.throws(() => owner.capabilities(grant.session, custody(value)), code("parser_session_custody_invalid"));
});
await check("copied and serialized handles cannot recreate private issuance", () => {
  for (const value of [{ ...grant.session }, JSON.parse(JSON.stringify(grant.session))]) assert.throws(() => owner.capabilities(session(value), grant.custody), code("parser_session_custody_invalid"));
  assert.throws(() => owner.capabilities(grant.session, custody({ ...grant.custody })), code("parser_session_custody_invalid"));
});
await check("different sessions under same owner have independent custody", () => {
  const other = owner.admit(); assert.notEqual(other.session, grant.session); assert.notEqual(other.custody, grant.custody);
  assert.throws(() => owner.capabilities(grant.session, other.custody), code("parser_session_custody_invalid"));
  assert.throws(() => owner.createExtractor(other.session, grant.custody, clock), code("parser_session_custody_invalid"));
});
await check("cross-owner handles rejected", () => {
  const other = createGenuineTypeScriptParserCustodian();
  assert.throws(() => other.capabilities(grant.session, grant.custody), code("parser_session_custody_invalid"));
});
await check("Proxy and accessor handles rejected without invoking traps", () => {
  let calls = 0;
  const accessor = Object.defineProperty({}, "session", { get() { calls++; return grant.session; } });
  const proxy = new Proxy({}, { get() { calls++; return grant.session; }, getPrototypeOf() { calls++; return null; }, ownKeys() { calls++; return []; } });
  for (const value of [accessor, proxy]) assert.throws(() => owner.capabilities(session(value), grant.custody), code("parser_session_custody_invalid"));
  assert.equal(calls, 0);
});
await check("trusted factory refuses caller parser replacement without reading it", () => {
  let calls = 0;
  const parser = new Proxy({}, { get() { calls++; return () => { calls++; }; } });
  assert.throws(() => Reflect.apply(createGenuineTypeScriptParserCustodian, undefined, [parser]), code("parser_admission_evidence_invalid"));
  assert.equal(calls, 0);
});
await check("caller-supplied admission metadata cannot become issuer authority", () => {
  assert.throws(() => Reflect.apply(createGenuineTypeScriptParserCustodian, undefined, [grant.identity]), code("parser_admission_evidence_invalid"));
});
await check("frozen API resists accidental member and enum replacement", () => {
  assert.ok(Object.isFrozen(caps)); assert.equal(Reflect.set(caps, "createSourceFile", undefined), false);
  assert.equal(Reflect.set(caps.ScriptTarget, "Latest", 0), false); assert.equal(caps.ScriptTarget.Latest, ts.ScriptTarget.Latest);
});
await check("construction does not invoke clock or parse supplied source", () => {
  let calls = 0;
  const inertClock = { nowIso: () => { calls++; return clock.nowIso(); }, monotonicMs: () => { calls++; return 0; } };
  owner.createExtractor(grant.session, grant.custody, inertClock); assert.equal(calls, 0);
});
await check("bound extractor matches complete frozen baseline result", async () => {
  assert.deepEqual(await owner.createExtractor(grant.session, grant.custody, clock).extract(input), await createBaseline(clock).extract(input));
});
await check("normal production wrapper matches complete baseline", async () => {
  assert.deepEqual(await createTypeScriptJavaScriptFactExtractor(clock).extract(input), await createBaseline(clock).extract(input));
});
await check("extractor public metadata and supported extensions preserved", () => {
  const port = owner.createExtractor(grant.session, grant.custody, clock);
  assert.equal(port.id, "typescript-javascript-fact-extractor"); assert.equal(port.version, "1");
  for (const ext of ["ts", "tsx", "js", "jsx", "mts", "cts", "mjs", "cjs"]) assert.equal(port.supports({ ...input, path: `src/unit.${ext}` }), true);
  assert.equal(port.supports({ ...input, path: "src/unit.py" }), false);
});
const revoked = owner.admit();
const revokedAPI = owner.capabilities(revoked.session, revoked.custody);
const savedParse = revokedAPI.createSourceFile;
const revokedPort = owner.createExtractor(revoked.session, revoked.custody, clock);
owner.revoke(revoked.session, revoked.custody);
await check("revoke closes subsequent capability acquisition and binding", () => {
  assert.equal(owner.state(revoked.session, revoked.custody), "revoked");
  assert.throws(() => owner.capabilities(revoked.session, revoked.custody), code("parser_session_revoked"));
  assert.throws(() => owner.createExtractor(revoked.session, revoked.custody, clock), code("parser_session_revoked"));
});
await check("saved parse function remains cooperatively revoked", () => {
  assert.throws(() => savedParse("src/inert.ts", "", ts.ScriptTarget.Latest), code("parser_session_revoked"));
});
await check("all 31 saved operations reject before invoking genuine implementation", () => {
  for (const name of TYPESCRIPT_PARSER_FUNCTIONS) assert.throws(() => Reflect.apply(revokedAPI[name], undefined, []), code("parser_session_revoked"));
});
await check("revoked supports rejects even for unsupported extension", () => {
  assert.throws(() => revokedPort.supports({ ...input, path: "src/unit.py" }), code("parser_session_revoked"));
});
await check("revoked extract is a rejected Promise without parse or clock", async () => {
  await assert.rejects(revokedPort.extract(input), code("parser_session_revoked"));
});
await check("revoke and expire never reactivate terminal session", () => {
  owner.revoke(revoked.session, revoked.custody); owner.expire(revoked.session, revoked.custody);
  assert.equal(owner.state(revoked.session, revoked.custody), "revoked");
});
await check("explicit expiration closes future API and extraction entry points", async () => {
  const expired = owner.admit(), api = owner.capabilities(expired.session, expired.custody), port = owner.createExtractor(expired.session, expired.custody, clock);
  owner.expire(expired.session, expired.custody); owner.revoke(expired.session, expired.custody);
  assert.equal(owner.state(expired.session, expired.custody), "expired");
  assert.throws(() => api.createSourceFile("inert.ts", "", ts.ScriptTarget.Latest), code("parser_session_expired"));
  await assert.rejects(port.extract(input), code("parser_session_expired"));
});
await check("mismatched revocation cannot close another session", () => {
  assert.throws(() => owner.revoke(grant.session, revoked.custody), code("parser_session_custody_invalid"));
  assert.equal(owner.state(grant.session, grant.custody), "active");
});
await check("revoking one session preserves other-session output", async () => {
  assert.deepEqual(await owner.createExtractor(grant.session, grant.custody, clock).extract(input), await createBaseline(clock).extract(input));
});
await check("issued identity stable and metadata immutable", () => {
  assert.ok(Object.isFrozen(grant.identity)); assert.equal(Reflect.set(grant.identity, "version", "other"), false);
  assert.equal(owner.admit().identity, grant.identity);
});
await check("synthetic genuine SourceFile can escape; not a sandbox claim", () => {
  const isolated = owner.admit(), api = owner.capabilities(isolated.session, isolated.custody);
  const ast = api.createSourceFile("unit.ts", "const value = 1;", api.ScriptTarget.Latest, true, api.ScriptKind.TS);
  owner.revoke(isolated.session, isolated.custody);
  assert.equal(ast.text, "const value = 1;"); assert.equal(ast.statements[0].getEnd(), ast.text.length);
  // Genuine AST methods are intentionally NOT reimplemented or revocation-wrapped.
});
process.stdout.write(`Genuine parser admission/custody smoke passed: ${scenarios} scenarios; zero Investigation Runner/Primary executions. Physical dependency corruption, hostile realm and hard termination NOT_RUN.\n`);
