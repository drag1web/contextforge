import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { createTypeScriptJavaScriptFactExtractorCore } from "../adapters/extraction/typescriptJavaScriptFactExtractorCore.js";
import { createTypeScriptJavaScriptFactExtractor } from "../adapters/extraction/typescriptJavaScriptFactExtractor.js";
import { createTypeScriptJavaScriptFactExtractor as createBaseline } from "./fixtures/typescriptJavaScriptFactExtractorBaseline.js";
import type { EntityId, SnapshotId } from "../contracts/index.js";
import type { ClockPort, ExtractionResult, ExtractorInput } from "../ports/index.js";

// Extraction-level testing ONLY. Fixture strings are parsed, never executed.
// No Investigation Runner, live adapter, provider, database or real project input.
const root = fileURLToPath(new URL("../../", import.meta.url));
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const baselineText = fs.readFileSync(new URL("./fixtures/typescriptJavaScriptFactExtractorBaseline.ts", import.meta.url), "utf8")
  .replaceAll("\r\n", "\n").replace('from "../../adapters/extraction/extractionSupport.js";', 'from "./extractionSupport.js";');
assert.equal(sha(baselineText), "5648d652f200a982e6b7d0696566b0c55d1133ff2b7e3694a99c3f138d5847a4");
for (const [file, digest] of [
  ["contextEngineV2/adapters/extraction/extractionSupport.ts", "e7dc3122ad5cd4d9d875ca9c55318444e1ba0f1fccf5094ef2b2d6b2fb6baa74"],
  ["contextEngineV2/domain/semanticLiteralSafety.ts", "60ead479c1567bb238ef55bfe22e97f98e55e9774d4959938753865560824dda"],
]) assert.equal(sha(fs.readFileSync(path.join(root, file), "utf8").replaceAll("\r\n", "\n")), digest);
const compiler = createRequire(import.meta.url).resolve("typescript");
assert.equal(path.relative(path.join(root, ".."), compiler).replaceAll("\\", "/"), "node_modules/typescript/lib/typescript.js");
assert.equal(ts.version, "6.0.3");
assert.equal(sha(fs.readFileSync(compiler)), "569177652966bd528c319171c7dd22860dbf72bde116cbc4f644f1d02bb12e39");

const observedAt = "2026-01-01T00:00:00.000Z";
const clock: ClockPort = { nowIso: () => observedAt, monotonicMs: () => 0 };
const original = createBaseline(clock), shared = createTypeScriptJavaScriptFactExtractorCore(clock, ts), production = createTypeScriptJavaScriptFactExtractor(clock);
type Fixture = { name: string; path: string; content: string; verify?: (result: ExtractionResult) => void };
const fixtures: Fixture[] = [];
function add(name: string, filePath: string, content: string, verify?: Fixture["verify"]): void {
  assert.ok(Buffer.byteLength(content, "utf8") <= 2000);
  fixtures.push({ name, path: filePath, content, verify });
}
function relation(result: ExtractionResult, predicate: string) { return result.facts.filter(f => f.kind === "relation" && f.predicate === predicate); }
const unsupported = (r: ExtractionResult) => assert.ok(r.limitations.some(l => l.code === "unsupported_construct"));
const syntax = (r: ExtractionResult) => { assert.deepEqual(r.entities, []); assert.deepEqual(r.facts, []); assert.equal(r.limitations[0]?.code, "syntax_error"); };
const unsupportedExtension = (r: ExtractionResult) => { assert.deepEqual(r.entities, []); assert.deepEqual(r.facts, []); assert.equal(r.limitations[0]?.code, "unsupported_language"); };
for (const extension of ["ts", "tsx", "js", "jsx", "mts", "cts", "mjs", "cjs"]) {
  add(`supported-${extension}`, `src/module.${extension}`, "export function target() { return 1; }\nexport const execute = () => target();",
    r => { assert.equal(relation(r, "calls").length, 1); assert.equal(relation(r, "exports").length, 2); });
}
add("react-function", "src/page.tsx", 'import { Panel } from "./Panel"; export function Page() { return <Panel />; }',
  r => { assert.equal(relation(r, "renders").length, 1); assert.ok(r.entities.some(e => e.kind === "component" && e.displayName === "Page")); });
add("react-arrow-jsx", "src/card.jsx", 'import Panel from "./Panel"; export const Card = () => <Panel />;', r => assert.equal(relation(r, "renders").length, 1));
add("jsx-fragment-repeat", "src/card.tsx", 'const Card = () => <><Panel /><Panel /></>;', r => assert.equal(relation(r, "renders").length, 2));
add("jsx-property-tag", "src/card.tsx", 'const Card = () => <UI.Panel />;', r => assert.equal(relation(r, "renders").length, 0));
add("named-type-imports", "src/module.ts", 'import type { Options } from "./types"; import { save as persist, type Value } from "./service"; function execute() { persist(); }',
  r => { assert.equal(relation(r, "imports").length, 3); assert.equal(relation(r, "calls").length, 1); });
add("namespace-default-import", "src/module.ts", 'import def, * as space from "./library"; export const value = def;', r => assert.equal(relation(r, "imports").length, 2));
add("side-effect-import", "src/module.ts", 'import "./setup";', r => assert.equal(relation(r, "imports").length, 1));
add("re-export-forms", "src/module.ts", 'export { save as persist, type Value } from "./service"; export * from "./all";', r => assert.equal(relation(r, "re_exports").length, 3));
add("local-and-reference-export", "src/module.ts", 'const value = 1; export { value, missing as renamed };', r => assert.equal(relation(r, "exports").length, 2));
add("default-identifier", "src/module.ts", 'const handler = () => true; export default handler;', r => assert.equal(relation(r, "exports").length, 1));
add("anonymous-function", "src/module.ts", 'export default function () {}', unsupported);
add("anonymous-class", "src/module.ts", 'export default class {}', unsupported);
add("default-expression", "src/module.ts", 'export default { value: 1 };', unsupported);
add("export-equals", "src/module.cts", 'const value = 1; export = value;', unsupported);
add("declaration-kinds", "src/module.ts", 'class Service {} interface Options {} type Result = string; enum Choice { A } const value = 1;',
  r => { for (const kind of ["class", "interface", "type", "symbol"]) assert.ok(r.entities.some(e => e.kind === kind)); });
add("known-and-unresolved-calls", "src/module.ts", 'import { imported } from "./service"; function target() {} function execute() { target(); imported(); external(); }', r => assert.equal(relation(r, "calls").length, 3));
add("nested-callable-exclusions", "src/module.ts", 'function target() {} function outer() { function inner() { target(); } const nested = () => target(); } class Service { run() { target(); } }',
  r => { assert.equal(relation(r, "calls").length, 0); unsupported(r); });
add("nested-jsx-exclusion", "src/module.tsx", 'function Utility() { function Inner() { return <Panel />; } return 1; }',
  r => { assert.equal(relation(r, "renders").length, 0); assert.equal(r.entities.find(e => e.displayName === "Utility")?.kind, "function"); });
add("five-route-methods", "src/routes.ts", 'function handler() {} router.get("/a", handler); app.post("/b", handler); server.put("/c", handler); apiRouter.patch("/d", handler); expressRouter.delete("/e", handler);',
  r => assert.equal(relation(r, "defines_endpoint").length, 5));
add("unsupported-route-shapes", "src/routes.ts", 'function handler() {} const route = "/a"; router.get(route, handler); router.post("/a", 42);', unsupported);
add("route-inside-owner", "src/routes.ts", 'function setup() { apiRouter.patch("/things", () => {}); }', r => assert.equal(relation(r, "defines_endpoint").length, 1));
add("non-route-receiver", "src/module.ts", 'function handler() {} widget.get("/a", handler);', r => assert.equal(relation(r, "defines_endpoint").length, 0));
add("test-and-it", "src/module.test.ts", 'function target() {} test("first", () => target()); it("second", function () { target(); expect(true); });', r => assert.equal(relation(r, "tests").length, 2));
add("unsupported-test-shapes", "src/module.test.ts", 'const title = "name"; test(title, () => {}); test("name", "callback");', unsupported);
add("unresolved-test-target", "src/module.test.ts", 'test("unknown target", () => untracked());', r => { assert.equal(relation(r, "tests").length, 0); unsupported(r); });
add("raw-comment-and-string-omission", "src/module.ts", '// SYNTHETIC_RAW_COMMENT_NOT_RESULT\nfunction valid() { return "synthetic-unselected-raw-string"; }',
  r => { assert.ok(!JSON.stringify(r).includes("SYNTHETIC_RAW_COMMENT_NOT_RESULT")); assert.ok(!JSON.stringify(r).includes("synthetic-unselected-raw-string")); });
add("syntax-error-ts", "src/broken.ts", 'export function broken(', syntax);
add("syntax-error-jsx", "src/broken.tsx", 'const Page = () => <div>', syntax);
add("empty-file", "src/empty.ts", '', r => { assert.equal(r.entities.length, 1); assert.equal(r.facts.length, 0); assert.equal(r.limitations.length, 0); });
add("unicode-utf16", "src/unicode.ts", 'const café = "😀"; export { café }; function 使用() { return café; }', r => assert.ok(r.entities.some(e => e.displayName === "使用")));
add("crlf-source-spans", "src/crlf.tsx", '\r\nimport { Panel } from "./Panel";\r\nexport function Page() { return <Panel />; }\r\n',
  r => { const span = relation(r, "imports")[0].source; assert.equal(span.kind, "source_span"); if (span.kind === "source_span") assert.deepEqual([span.startLine, span.startColumn], [2, 10]); });
add("unsupported-extension", "docs/file.md", 'export function target() {}', unsupportedExtension);
add("missing-extension", "src/module", 'export function target() {}', unsupportedExtension);
add("uppercase-extension", "src/module.TS", 'export function target() {}', r => assert.ok(r.entities.some(e => e.displayName === "target")));
const syntheticSecret = "Bearer syntheticFixtureToken123";
function redacted(r: ExtractionResult, literal: string): void { const text = JSON.stringify(r); assert.ok(!text.includes(literal)); assert.ok(text.includes("[redacted:sha256:")); }
add("secret-like-test-title", "src/module.test.ts", `function target() {} test("${syntheticSecret}", () => target());`, r => redacted(r, syntheticSecret));
const syntheticRoute = "/items?token=syntheticFixtureToken123";
add("secret-like-route", "src/routes.ts", `function handler() {} router.get("${syntheticRoute}", handler);`, r => redacted(r, syntheticRoute));
const syntheticImport = "./service?token=syntheticFixtureToken123";
add("secret-like-import", "src/module.ts", `import { save } from "${syntheticImport}";`, r => redacted(r, syntheticImport));
add("unselected-secret-like-value", "src/module.ts", `const value = "${syntheticSecret}";`, r => assert.ok(!JSON.stringify(r).includes(syntheticSecret)));
add("shadowed-name-existing-policy", "src/module.ts", 'function target() {} function execute(target: () => void) { target(); }');
add("duplicate-binding-existing-policy", "src/module.ts", 'import { value } from "./first"; import { value } from "./second"; function execute() { value(); }');
add("optional-call-existing-policy", "src/module.ts", 'function target() {} const execute = () => { target?.(); object.method(); new Thing(); };');
add("import-equals-existing-policy", "src/module.cts", 'import module = require("./library"); export { module };');
add("async-generator", "src/module.ts", 'function target() {} export async function* execute() { yield target(); }', r => assert.equal(relation(r, "calls").length, 1));
add("ambient-declarations", "src/module.ts", 'export declare function declared(): void; export interface Options { value: string } export type Alias = Options;');

let scenarios = 0, extractionCalls = 0;
const predicates = new Set<string>(), limitations = new Set<string>();
for (const [index, fixture] of fixtures.entries()) {
  const input: ExtractorInput = { snapshotId: "snapshot-synthetic-extraction" as SnapshotId, fileId: "file-synthetic-extraction" as EntityId,
    path: fixture.path, content: fixture.content, contentFingerprint: `content-sha256:${sha(fixture.content)}`, language: null };
  const before = structuredClone(input);
  assert.equal(shared.supports(input), original.supports(input)); assert.equal(production.supports(input), original.supports(input));
  const expected = await original.extract(input); extractionCalls++;
  // Complete ordered arrays and all fields compared: no field exclusion/sorting.
  for (const extractor of [shared, production, shared, createTypeScriptJavaScriptFactExtractorCore(clock, ts), createTypeScriptJavaScriptFactExtractor(clock), createBaseline(clock)]) {
    const actual = await extractor.extract(structuredClone(input)); extractionCalls++;
    assert.deepEqual(actual, expected, fixture.name); fixture.verify?.(actual);
  }
  assert.deepEqual(input, before);
  for (const fact of expected.facts) {
    predicates.add(fact.predicate); assert.equal(fact.provenance.observedAt, observedAt);
    assert.equal(fact.provenance.extractorId, "typescript-javascript-fact-extractor"); assert.equal(fact.provenance.extractorVersion, "1");
    if (fact.source.kind === "source_span") assert.equal(fact.source.contentFingerprint, input.contentFingerprint);
  }
  for (const limitation of expected.limitations) limitations.add(limitation.code);
  scenarios++;
  process.stdout.write(`PASS fixture-${String(index + 1).padStart(3, "0")} ${fixture.name}; entities=${expected.entities.length}; facts=${expected.facts.length}; limitations=${expected.limitations.length}; resultSHA=${sha(JSON.stringify(expected))}\n`);
}
async function check(name: string, test: () => void | Promise<void>) { await test(); scenarios++; process.stdout.write(`PASS ${name}\n`); }
await check("non-vacuous supported extensions predicates and limitation coverage", () => {
  for (const p of ["contains", "exports", "imports", "re_exports", "calls", "renders", "tests", "defines_endpoint"]) assert.ok(predicates.has(p));
  for (const c of ["syntax_error", "unsupported_language", "unsupported_construct"]) assert.ok(limitations.has(c));
});
await check("extractor ID version and supported-path contract unchanged", () => {
  for (const extractor of [original, shared, production]) { assert.equal(extractor.id, "typescript-javascript-fact-extractor"); assert.equal(extractor.version, "1"); }
});
await check("returned results cannot mutate state of later extraction", async () => {
  const input: ExtractorInput = { snapshotId: "snapshot-repeat" as SnapshotId, fileId: "file-repeat" as EntityId, path: "src/module.ts",
    content: "function target() {}", contentFingerprint: "repeat-fingerprint", language: null };
  const first = await shared.extract(input), expected = await original.extract(input); extractionCalls += 2;
  first.entities.length = 0; first.facts.length = 0; first.limitations.push({ extractorId: "inert", extractorVersion: "0", code: "partial_parse", message: "synthetic" });
  assert.deepEqual(await shared.extract(input), expected); extractionCalls++;
});
await check("multiple core instances and interleaved inputs share no extraction state", async () => {
  const make = (content: string): ExtractorInput => ({ snapshotId: "snapshot-interleaved" as SnapshotId, fileId: "file-interleaved" as EntityId,
    path: "src/module.ts", content, contentFingerprint: sha(content), language: null });
  const a = make("function alpha() {}"), b = make("function beta() {}"), other = createTypeScriptJavaScriptFactExtractorCore(clock, ts);
  const first = await shared.extract(a); await other.extract(b); const second = await shared.extract(a); extractionCalls += 3;
  assert.deepEqual(first, second);
});
await check("construction and supports do not invoke injected parser or clock", () => {
  let reads = 0;
  const opaque = new Proxy({}, { get() { reads++; throw new Error("unexpected_parser_read"); } }) as typeof ts;
  const clock: ClockPort = { nowIso() { reads++; throw new Error("unexpected_clock_call"); }, monotonicMs() { reads++; throw new Error("unexpected_clock_call"); } };
  const port = createTypeScriptJavaScriptFactExtractorCore(clock, opaque);
  assert.equal(port.supports({ path: "src/file.ts" } as ExtractorInput), true); assert.equal(reads, 0);
  // The opaque port is NEVER used for extraction or treated as trusted.
});
await check("clock failures propagate identically without changed error policy", async () => {
  const failure = new Error("synthetic_clock_failure");
  const failingClock: ClockPort = { nowIso: () => { throw failure; }, monotonicMs: () => 0 };
  const input: ExtractorInput = { snapshotId: "snapshot-error" as SnapshotId, fileId: "file-error" as EntityId, path: "src/file.ts",
    content: "const value = 1;", contentFingerprint: "synthetic-error-fingerprint", language: null };
  for (const port of [createBaseline(failingClock), createTypeScriptJavaScriptFactExtractorCore(failingClock, ts), createTypeScriptJavaScriptFactExtractor(failingClock)]) {
    await assert.rejects(port.extract(input), e => e === failure); extractionCalls++;
  }
});
process.stdout.write(`TypeScript extractor core differential smoke passed: ${scenarios} scenarios; ${fixtures.length} synthetic source fixtures; ${extractionCalls} extraction-level calls; zero Investigation Runner/Primary executions.\n`);
