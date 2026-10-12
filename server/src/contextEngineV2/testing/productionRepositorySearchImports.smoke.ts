import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Source DATA only. Neither live reader nor audited search is executed here.
const root = fileURLToPath(new URL("../../", import.meta.url));
const search = "contextEngineV2/adapters/liveShadow/liveRepositorySearch.ts";
const live = "contextEngineV2/adapters/liveShadow/liveRepositoryAdapter.ts";
const matcher = "contextEngineV2/domain/negativeConstraintMatcher.ts";
const parity = "contextEngineV2/testing/productionRepositorySearch.smoke.ts";
const options = ts.parseJsonConfigFileContent(ts.readConfigFile(path.join(root, "../tsconfig.json"), ts.sys.readFile).config,
  ts.sys, path.join(root, "..")).options;
assert.equal(options.module, ts.ModuleKind.NodeNext);
assert.equal(JSON.parse(fs.readFileSync(path.join(root, "../package.json"), "utf8")).type, "module");
const sources = new Map<string, { text: string; ast: ts.SourceFile; emitted: ts.SourceFile }>();
function source(relative: string) {
  assert.ok(/^[A-Za-z0-9_./-]+\.ts$/u.test(relative) && !relative.includes(".."));
  const cached = sources.get(relative); if (cached) return cached;
  assert.ok(sources.size < 40, "bounded_source_audit");
  const text = fs.readFileSync(path.join(root, relative), "utf8").replaceAll("\r\n", "\n");
  assert.ok(text.length <= 700000, "bounded_module");
  const ast = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true);
  const output = ts.transpileModule(text, { fileName: path.join(root, relative), compilerOptions: { ...options, module: ts.ModuleKind.ESNext } }).outputText;
  const value = { text, ast, emitted: ts.createSourceFile(relative, output, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS) };
  sources.set(relative, value); return value;
}
function edges(ast: ts.SourceFile): string[] {
  return ast.statements.flatMap((node) => (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier &&
    ts.isStringLiteral(node.moduleSpecifier) ? [node.moduleSpecifier.text] : []);
}
function resolve(from: string, specifier: string): string {
  const result = ts.resolveModuleName(specifier, path.join(root, from), options, ts.sys).resolvedModule;
  assert.ok(result && !result.isExternalLibraryImport && !result.resolvedFileName.endsWith(".d.ts"));
  const relative = path.relative(root, result.resolvedFileName).replaceAll("\\", "/");
  assert.ok(!relative.startsWith("../") && !path.isAbsolute(relative)); return relative;
}
function closure(entry: string) {
  const local = new Set<string>(), external = new Set<string>();
  function visit(file: string) {
    if (local.has(file)) return; local.add(file);
    for (const edge of edges(source(file).emitted)) { if (edge.startsWith(".")) visit(resolve(file, edge)); else external.add(edge); }
  }
  visit(entry); return { local: [...local].sort(), external: [...external].sort() };
}
function factory(file: string, name: string) {
  const value = source(file).ast.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(value?.body); return value;
}
function inner(file: string, outer: string, name: string) {
  const value = factory(file, outer).body!.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(value?.body); return value;
}
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const baselineSearchSha = "082f820662de0505210cb54685a8ff563cb8e395eda6fd20df7f83c5acdf5d84";
let scenarios = 0;
function check(name: string, run: () => void) { run(); scenarios += 1; process.stdout.write(`PASS ${name}\n`); }
const safe = closure(search);
check("exact complete search runtime closure: shared production function + reviewed matcher only", () => {
  assert.deepEqual(safe.local, [search, matcher].sort()); assert.deepEqual(safe.external, []);
  assert.equal(sha(source(matcher).text), "e0d10e4ff88ca623b0de8213ffe256ad064b1e4887969f5390f831b8c3b09f97");
});
check("actual NodeNext program emission agrees with resolved ESM edges", () => {
  const program = ts.createProgram(safe.local.map((file) => path.join(root, file)), { ...options, noEmit: false });
  for (const file of safe.local) {
    const node = program.getSourceFile(path.join(root, file)); assert.ok(node); let output: string | undefined;
    program.emit(node, (name, text) => { if (name.endsWith(".js")) output = text; }); assert.ok(output);
    assert.deepEqual(edges(ts.createSourceFile(file, output, ts.ScriptTarget.Latest, true)), edges(source(file).emitted));
  }
});
function capabilities(ast: ts.SourceFile): void {
  const forbidden = new Set(["fetch", "require", "eval", "Function", "process", "globalThis", "global", "window", "Deno", "Bun",
    "XMLHttpRequest", "WebSocket", "setTimeout", "setInterval"]);
  function visit(node: ts.Node) {
    assert.ok(!ts.isImportEqualsDeclaration(node));
    if (ts.isCallExpression(node)) assert.notEqual(node.expression.kind, ts.SyntaxKind.ImportKeyword);
    if (ts.isIdentifier(node)) assert.ok(!forbidden.has(node.text), "ambient_capability_rejected");
    if (ts.isIdentifier(node) && node.text === "setImmediate") {
      assert.ok(ts.isCallExpression(node.parent) && node.parent.expression === node && node.parent.arguments.length === 1 &&
        ts.isIdentifier(node.parent.arguments[0]) && node.parent.arguments[0].text === "resolve", "unexpected_scheduler_capability");
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
}
check("whole emitted closure excludes filesystem provider storage network process and dynamic loads", () => {
  for (const file of safe.local) capabilities(source(file).emitted);
});
check("capability check rejects requests and arbitrary scheduling, not only filenames", () => {
  for (const text of ['fetch("inert")', 'import("inert")', 'globalThis["fetch"]("inert")', 'require("inert")', 'setImmediate(arbitrary)'])
    assert.throws(() => capabilities(ts.createSourceFile("inert.js", text, ts.ScriptTarget.Latest, true)));
});
check("module import evaluates function definitions only, no indexes caches callbacks or execution", () => {
  for (const file of safe.local) for (const node of source(file).emitted.statements)
    assert.ok(ts.isImportDeclaration(node) || ts.isFunctionDeclaration(node), "module_initialization_rejected");
});
check("scanner and contracts are type-only, the live adapter is not a dependency", () => {
  assert.ok(source(search).text.includes('import type { ProjectInventory }'));
  assert.ok(!safe.local.includes(live)); assert.deepEqual(edges(source(search).emitted), ["../../domain/negativeConstraintMatcher.js"]);
});
check("entire extracted search declaration is exact bea42cf baseline source", () => {
  assert.equal(sha(inner(search, "createLiveRepositorySearch", "search").getText()), baselineSearchSha);
  assert.equal(sha(inner(parity, "createBaselineSearch", "search").getText()), baselineSearchSha);
});
check("path normalization matches original reader and baseline exactly", () => {
  for (const file of [search, live, parity]) assert.equal(sha(factory(file, "normalizePath").getText()), "702fc1d69410e5f8a0e5eb66477031ef13e081a905ad01f1067625bc6a246f96");
});
check("all three public search wrappers use exact original field arrays", () => {
  const expected = [
    'searchPaths(query) { return search(query, ["path", "name"]); }',
    'searchText(query) { return search(query, ["path", "textHints", "semanticFacts"]); }',
    'searchSymbols(query) { return search(query, ["path", "symbols", "exports", "imports"]); }',
  ];
  for (const [file, name] of [[search, "createLiveRepositorySearch"], [parity, "createBaselineSearch"]]) {
    const statement = factory(file, name).body!.statements.at(-1); assert.ok(statement && ts.isReturnStatement(statement));
    assert.ok(statement.expression && ts.isObjectLiteralExpression(statement.expression));
    assert.deepEqual(statement.expression.properties.map((node) => node.getText()), expected);
  }
});
check("factory captures the original descriptor map first; cancellation is not polled at construction", () => {
  const body = factory(search, "createLiveRepositorySearch").body!;
  assert.equal(body.statements.length, 3);
  assert.equal(body.statements[0].getText(), "const descriptorsByPath = new Map(input.snapshot.files.map((file) => [file.normalizedPath, file]));");
  assert.ok(ts.isFunctionDeclaration(body.statements[1]) && ts.isReturnStatement(body.statements[2]));
});
check("live reader and helpers retain full original declarations/signatures", () => {
  assert.equal(sha(inner(live, "createLiveShadowRepositoryAdapter", "read").getText()), "16ed4269de918a59fb21a35f3a1a1d8dfe119127bd4d40261f63ae9777128b25");
  const expected = { inventoryContentPreview: "b1dc033ccc73c2630847ab9f1be659926fc20da2d45c02eedc89d0a732f45459",
    failure: "32c5230a0fe5d34228891184ae8405a0ade56a72e3975a563898985fc323a60b", resolveInsideRoot: "b00c7570ebab9adfcd4a7423f69d8944422e02c0021195700090008f0eca31f3",
    lineCount: "12c0ac4671367e57b00db292a8ed31b94ea46939fc1355b9ca3c7a15e8f6ffa6" };
  for (const [name, digest] of Object.entries(expected)) assert.equal(sha(factory(live, name).getText()), digest);
});
check("reverse ONLY extraction wiring reconstructs the full original live adapter byte identity", () => {
  const oldSearch = inner(search, "createLiveRepositorySearch", "search").getText();
  const footer = '  return {\n    reader: { readFile: read, readRange: read },\n    search,\n  };';
  const originalFooter = '  return {\n    reader: { readFile: read, readRange: read },\n    search: {\n' +
    '      searchPaths(query) { return search(query, ["path", "name"]); },\n' +
    '      searchText(query) { return search(query, ["path", "textHints", "semanticFacts"]); },\n' +
    '      searchSymbols(query) { return search(query, ["path", "symbols", "exports", "imports"]); },\n    },\n  };';
  assert.ok(source(live).text.includes(footer));
  const reconstructed = source(live).text.replace('import { createLiveRepositorySearch } from "./liveRepositorySearch.js";\n', "")
    .replace('  RepositorySearchPort,\n', '  RepositorySearchPort,\n  SearchResult,\n')
    .replace('  const search = createLiveRepositorySearch(input);', '  const descriptorsByPath = new Map(input.snapshot.files.map((file) => [file.normalizedPath, file]));')
    .replace(footer, `  ${oldSearch}\n\n${originalFooter}`);
  assert.equal(sha(reconstructed), "c0f13dd1cab049c62b58329b6bd0f1024dea4d55151d6e2532664e248e495407");
});
check("production wrapper forwards the exact input reference and preserves reader/search public shape", () => {
  assert.ok(edges(source(live).emitted).includes("./liveRepositorySearch.js"));
  const first = factory(live, "createLiveShadowRepositoryAdapter").body!.statements[0];
  assert.equal(first.getText(), "const search = createLiveRepositorySearch(input);");
  assert.ok(edges(source(live).emitted).includes("node:fs/promises"));
  assert.equal(resolve(live, "./liveRepositorySearch.js"), search);
});
check("B3 remains disconnected, permits cannot become search metadata or Primary authority", () => {
  const synthetic = source("contextEngineV2/validation/realWorld/primarySyntheticRepositoryPorts.ts");
  assert.ok(synthetic.text.includes("throw new ProductionSearchNotConnectedError()"));
  assert.ok(!closure("contextEngineV2/validation/realWorld/primarySyntheticRepositoryPorts.ts").local.includes(search));
  assert.ok(source("contextEngineV2/validation/realWorld/primaryReadOnlyBoundary.ts").text.includes("requestPrimaryExecutionPermit"));
});
process.stdout.write(`Production repository search import/compatibility smoke passed: ${scenarios} scenarios; two reviewed runtime modules; no runtime external imports; setImmediate yield only; zero audited modules executed.\n`);
