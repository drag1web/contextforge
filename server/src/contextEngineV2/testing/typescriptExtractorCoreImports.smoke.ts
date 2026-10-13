import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Repository source DATA / compiler AST only; no audited production module imports.
const root = fileURLToPath(new URL("../../", import.meta.url));
const core = "contextEngineV2/adapters/extraction/typescriptJavaScriptFactExtractorCore.ts";
const wrapper = "contextEngineV2/adapters/extraction/typescriptJavaScriptFactExtractor.ts";
const baseline = "contextEngineV2/testing/fixtures/typescriptJavaScriptFactExtractorBaseline.ts";
const helper = "contextEngineV2/adapters/extraction/extractionSupport.ts";
const semantic = "contextEngineV2/domain/semanticLiteralSafety.ts";
const admission = "contextEngineV2/adapters/extraction/genuineTypeScriptParserAdmission.ts";
const capabilityContract = "contextEngineV2/adapters/extraction/typescriptParserCapabilities.ts";
const options = ts.parseJsonConfigFileContent(ts.readConfigFile(path.join(root, "../tsconfig.json"), ts.sys.readFile).config, ts.sys, path.join(root, "..")).options;
assert.equal(options.module, ts.ModuleKind.NodeNext);
assert.equal(JSON.parse(fs.readFileSync(path.join(root, "../package.json"), "utf8")).type, "module");
const sources = new Map<string, { text: string; ast: ts.SourceFile; emitted: ts.SourceFile }>();
function source(relative: string) {
  assert.ok(/^[A-Za-z0-9_./-]+\.ts$/u.test(relative) && !relative.includes(".."));
  const cached = sources.get(relative); if (cached) return cached;
  assert.ok(sources.size < 30);
  const text = fs.readFileSync(path.join(root, relative), "utf8").replaceAll("\r\n", "\n");
  assert.ok(text.length < 700000);
  const ast = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true);
  const output = ts.transpileModule(text, { fileName: path.join(root, relative), compilerOptions: { ...options, module: ts.ModuleKind.ESNext } }).outputText;
  const value = { text, ast, emitted: ts.createSourceFile(relative, output, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS) };
  sources.set(relative, value); return value;
}
function edges(ast: ts.SourceFile): string[] {
  return ast.statements.flatMap(n => (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier) ? [n.moduleSpecifier.text] : []);
}
function closure(entry: string) {
  const local = new Set<string>(), external = new Set<string>();
  function visit(file: string) {
    if (local.has(file)) return; local.add(file);
    for (const edge of edges(source(file).emitted)) {
      if (!edge.startsWith(".")) { external.add(edge); continue; }
      const resolved = ts.resolveModuleName(edge, path.join(root, file), options, ts.sys).resolvedModule;
      assert.ok(resolved && !resolved.isExternalLibraryImport && !resolved.resolvedFileName.endsWith(".d.ts"));
      const relative = path.relative(root, resolved.resolvedFileName).replaceAll("\\", "/");
      assert.ok(!relative.startsWith("../") && !path.isAbsolute(relative)); visit(relative);
    }
  }
  visit(entry); return { local: [...local].sort(), external: [...external].sort() };
}
function factory(file: string, name: string) {
  const node = source(file).ast.statements.find((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.ok(node?.body); return node;
}
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const print = (node: ts.Node, file: string) => ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printNode(ts.EmitHint.Unspecified, node, source(file).ast);
let scenarios = 0;
function check(name: string, test: () => void) { test(); scenarios++; process.stdout.write(`PASS ${name}\n`); }
const safe = closure(core), normal = closure(wrapper);
check("exact complete safe core runtime closure: core + unchanged extraction helpers only", () => {
  assert.deepEqual(safe.local, [core, helper, semantic].sort());
  assert.deepEqual(safe.external, ["node:crypto"]);
});
check("actual NodeNext program emission erases TypeScript and contract type imports", () => {
  const program = ts.createProgram(safe.local.map(f => path.join(root, f)), { ...options, noEmit: false });
  for (const file of safe.local) {
    const node = program.getSourceFile(path.join(root, file)); assert.ok(node); let output: string | undefined;
    program.emit(node, (name, text) => { if (name.endsWith(".js")) output = text; }); assert.ok(output);
    assert.deepEqual(edges(ts.createSourceFile(file, output, ts.ScriptTarget.Latest, true)), edges(source(file).emitted));
  }
  assert.deepEqual(edges(source(core).emitted), ["./extractionSupport.js"]);
});
function capabilities(ast: ts.SourceFile) {
  const forbidden = new Set(["fetch", "require", "eval", "Function", "process", "globalThis", "global", "window", "Deno", "Bun",
    "XMLHttpRequest", "WebSocket", "setTimeout", "setInterval", "setImmediate", "Worker"]);
  function visit(n: ts.Node) {
    assert.ok(!ts.isImportEqualsDeclaration(n));
    if (ts.isCallExpression(n)) assert.notEqual(n.expression.kind, ts.SyntaxKind.ImportKeyword);
    if (ts.isIdentifier(n)) assert.ok(!forbidden.has(n.text), "ambient_capability_rejected");
    ts.forEachChild(n, visit);
  }
  visit(ast);
}
check("whole emitted core closure excludes dynamic loads and ambient execution capabilities", () => {
  for (const file of safe.local) capabilities(source(file).emitted);
});
check("capability audit rejects dynamic/network/process primitives, not just filenames", () => {
  for (const text of ['import("x")', 'require("x")', 'fetch("x")', 'process.exit()', 'globalThis["fetch"]("x")'])
    assert.throws(() => capabilities(ts.createSourceFile("inert.js", text, ts.ScriptTarget.Latest, true)));
});
check("top-level initialization retains declarations and constant data, not parser calls", () => {
  function init(n: ts.Node) {
    if (ts.isCallExpression(n)) assert.fail("unexpected_top_level_call");
    if (ts.isNewExpression(n)) assert.ok(ts.isIdentifier(n.expression) && n.expression.text === "Set");
    ts.forEachChild(n, init);
  }
  for (const file of safe.local) for (const n of source(file).emitted.statements) {
    assert.ok(ts.isImportDeclaration(n) || ts.isFunctionDeclaration(n) || ts.isVariableStatement(n));
    if (ts.isVariableStatement(n)) {
      assert.ok(n.declarationList.flags & ts.NodeFlags.Const);
      for (const d of n.declarationList.declarations) if (d.initializer) init(d.initializer);
    }
  }
});
check("independent fixture reconstructs exact original HEAD source, not the new core", () => {
  const original = source(baseline).text.replace('from "../../adapters/extraction/extractionSupport.js";', 'from "./extractionSupport.js";');
  assert.equal(sha(original), "5648d652f200a982e6b7d0696566b0c55d1133ff2b7e3694a99c3f138d5847a4");
  assert.ok(!closure(baseline).local.includes(core));
});
check("all seven production constants are identical and retain module-level lifetime", () => {
  const old = source(baseline).ast.statements.filter(ts.isVariableStatement);
  const current = source(core).ast.statements.filter(ts.isVariableStatement);
  assert.equal(old.length, 7);
  assert.deepEqual(current.map(n => print(n, core)), old.map(n => print(n, baseline)));
});
check("all eleven helper bodies signatures parser calls and branches are AST-equivalent", () => {
  const old = source(baseline).ast.statements.filter(ts.isFunctionDeclaration).filter(n => n.name?.text !== "createTypeScriptJavaScriptFactExtractor");
  const body = factory(core, "createTypeScriptJavaScriptFactExtractorCore").body!;
  const current = body.statements.filter(ts.isFunctionDeclaration);
  assert.equal(old.length, 11);
  assert.deepEqual(current.map(n => print(n, core)), old.map(n => print(n, baseline)));
});
check("entire supports/extract object is AST-equivalent including ordering errors IDs provenance and spans", () => {
  const old = factory(baseline, "createTypeScriptJavaScriptFactExtractor").body!;
  const current = factory(core, "createTypeScriptJavaScriptFactExtractorCore").body!;
  assert.equal(old.statements.length, 1); assert.equal(current.statements.length, 12);
  assert.ok(ts.isReturnStatement(old.statements[0]) && ts.isReturnStatement(current.statements[11]));
  assert.equal(print(current.statements[11], core), print(old.statements[0], baseline));
});
check("shared helper semantics registry DTO barrel and live assembly remain HEAD-pinned", () => {
  const pins: Record<string, string> = {
  "contextEngineV2/adapters/extraction/extractionSupport.ts": "e7dc3122ad5cd4d9d875ca9c55318444e1ba0f1fccf5094ef2b2d6b2fb6baa74",
  "contextEngineV2/domain/semanticLiteralSafety.ts": "60ead479c1567bb238ef55bfe22e97f98e55e9774d4959938753865560824dda",
  "contextEngineV2/adapters/extraction/factExtractorRegistry.ts": "d65f1090fdf78247bcef57368fa72f1a088da8d847310a45f4f19119fbe9924a",
  "contextEngineV2/facade/liveContextEngineRuntime.ts": "9ac832ffb6d7773dc60ef23805a0062a850f873dbe9417af568feaf4674783ee",
  "contextEngineV2/adapters/extraction/index.ts": "02b4b420bfdce511fdb6acbbf700a034d043ec6f50f03efb212aab860cf23fd2",
  "contextEngineV2/ports/factExtractorPort.ts": "a8eb7205456b5f864abd5ad0ee027d7d2ccbec5d9136aa73ad245ccbb3a9c24d",
  "contextEngineV2/testing/fakes.ts": "0f7f392713c77a8f253a8d187ad7764d710f0a5596d36c0b21767104eaf92c68"
};
  for (const [file, hash] of Object.entries(pins)) assert.equal(sha(source(file).text), hash, file);
});
check("core parser parameter is required, explicit and contains no runtime parser default", () => {
  const fn = factory(core, "createTypeScriptJavaScriptFactExtractorCore");
  assert.deepEqual(fn.parameters.map(n => n.name.getText()), ["clock", "ts"]);
  assert.ok(fn.parameters.every(n => !n.initializer && !n.questionToken));
  assert.equal(fn.parameters[1].type?.getText(), "TypeScriptParserCapabilities");
  assert.ok(source(core).text.startsWith('import type ts from "typescript";'));
  assert.ok(source(core).text.includes('import type { TypeScriptParserCapabilities } from "./typescriptParserCapabilities.js";'));
});
check("production wrapper retains exact signature and delegates genuine session issuance", () => {
  const old = factory(baseline, "createTypeScriptJavaScriptFactExtractor"), fn = factory(wrapper, "createTypeScriptJavaScriptFactExtractor");
  assert.equal(fn.getText().slice(0, fn.body!.getStart() - fn.getStart()), old.getText().slice(0, old.body!.getStart() - old.getStart()));
  assert.deepEqual(fn.body!.statements.map(n => n.getText()), [
    "const custodian = createGenuineTypeScriptParserCustodian();",
    "const grant = custodian.admit();",
    "return custodian.createExtractor(grant.session, grant.custody, clock);",
  ]);
  assert.deepEqual(edges(source(wrapper).emitted), ["./genuineTypeScriptParserAdmission.js"]);
  assert.ok(source(admission).text.includes('import ts from "typescript";'));
  assert.ok(source(admission).text.includes("createTypeScriptJavaScriptFactExtractorCore(clock, admitted.capabilities)"));
  assert.deepEqual(normal.local, [wrapper, admission, capabilityContract, ...safe.local].sort());
  assert.deepEqual(normal.external, ["node:crypto", "node:fs", "node:module", "node:path", "typescript"]);
});
check("core is not added to product barrel and live extractor order remains genuine TS then manifest", () => {
  const live = source("contextEngineV2/facade/liveContextEngineRuntime.ts").text;
  assert.ok(live.includes("extractors: [\n      createTypeScriptJavaScriptFactExtractor(input.clock),\n      createManifestFactExtractor(input.clock),\n    ]"));
  assert.ok(!source("contextEngineV2/adapters/extraction/index.ts").text.includes("FactExtractorCore"));
});
check("existing extraction smoke uses same factories through narrow safe extraction barrel", () => {
  const text = source("contextEngineV2/testing/factExtraction.smoke.ts").text;
  assert.ok(text.includes('from "../adapters/extraction/index.js"'));
  assert.ok(!edges(source("contextEngineV2/testing/factExtraction.smoke.ts").emitted).includes("../adapters/index.js"));
});
check("core and baseline have no runner or Primary path; construction only defines helpers and returns port", () => {
  const fn = factory(core, "createTypeScriptJavaScriptFactExtractorCore");
  assert.ok(fn.body!.statements.slice(0, -1).every(ts.isFunctionDeclaration));
  assert.ok(!safe.local.some(f => /investigationRunner|retirement|facade|scanner|settings|storage/u.test(f)));
});
process.stdout.write(`TypeScript extractor core import/mechanical smoke passed: ${scenarios} scenarios; runtime closure 3 modules + node:crypto; zero audited production modules executed.\n`);
