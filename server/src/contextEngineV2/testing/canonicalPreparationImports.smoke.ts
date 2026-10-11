import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Static source audit only. No investigated production module is imported here.
const root = fileURLToPath(new URL("../../", import.meta.url));
const canonical = "contextEngineV2/shadow/shadowInputPreparation.ts";
const adapter = "contextEngineV2/adapters/legacyInventory/legacyInventorySnapshotAdapter.ts";
const configuration = ts.readConfigFile(path.join(root, "../tsconfig.json"), ts.sys.readFile);
assert.equal(configuration.error, undefined);
const options = ts.parseJsonConfigFileContent(configuration.config, ts.sys, path.join(root, "..")).options;
assert.equal(options.module, ts.ModuleKind.NodeNext);
assert.equal(JSON.parse(fs.readFileSync(path.join(root, "../package.json"), "utf8")).type, "module");
const sources = new Map<string, { text: string; ast: ts.SourceFile; emitted: ts.SourceFile }>();
function source(relative: string) {
  assert.ok(/^[A-Za-z0-9_./-]+\.ts$/u.test(relative) && !relative.includes(".."));
  const cached = sources.get(relative);
  if (cached) return cached;
  assert.ok(sources.size < 350, "bounded_source_audit");
  const text = fs.readFileSync(path.join(root, relative), "utf8").replaceAll("\r\n", "\n");
  assert.ok(text.length <= 700000, "bounded_module");
  const ast = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true);
  // Native ESM emission matches the enclosing type:module package. Resolution uses
  // the actual NodeNext project options; a program.emit check below confirms it.
  const output = ts.transpileModule(text, { fileName: path.join(root, relative),
    compilerOptions: { ...options, module: ts.ModuleKind.ESNext } }).outputText;
  const emitted = ts.createSourceFile(relative, output, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const value = { text, ast, emitted };
  sources.set(relative, value);
  return value;
}
function edges(ast: ts.SourceFile): string[] {
  return ast.statements.flatMap((node) => (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
    node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) ? [node.moduleSpecifier.text] : []);
}
function resolve(from: string, specifier: string): string {
  const result = ts.resolveModuleName(specifier, path.join(root, from), options, ts.sys).resolvedModule;
  assert.ok(result && !result.isExternalLibraryImport && !result.resolvedFileName.endsWith(".d.ts"), "unresolved_runtime_edge");
  const relative = path.relative(root, result.resolvedFileName).replaceAll("\\", "/");
  assert.ok(!relative.startsWith("../") && !path.isAbsolute(relative), "out_of_source_edge");
  return relative;
}
function closure(entry: string, previous = false) {
  const local = new Set<string>();
  const external = new Set<string>();
  function visit(relative: string) {
    if (local.has(relative)) return;
    local.add(relative);
    for (let edge of edges(source(relative).emitted)) {
      if (previous && relative === canonical && edge.endsWith("/legacyInventorySnapshotAdapter.js")) edge = "../adapters/legacyInventory/index.js";
      if (previous && relative === adapter && edge === "../../domain/invariant.js") edge = "../../domain/index.js";
      if (edge.startsWith(".")) visit(resolve(relative, edge));
      else external.add(edge);
    }
  }
  visit(entry);
  return { local: [...local].sort(), external: [...external].sort() };
}
const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
let scenarios = 0;
function check(name: string, run: () => void) { run(); scenarios += 1; process.stdout.write(`PASS ${name}\n`); }
const safe = closure(canonical);
const before = closure(canonical, true);
const reviewed: Readonly<Record<string, string>> = {
  "contextEngineV2/shadow/shadowExecutionBasis.ts": "7eb000cb77403227faf7e9af0c82cb20d33b3bac8691c4037075140792266ce6",
  "contextEngineV2/planner/plannerMode.ts": "d1281ed1fd1ff7a540507dfa5dcd97d452ad3cfd781889a18d393ff71e35e7ac",
  "contextEngineV2/adapters/legacyInventory/legacyInventoryFileMapper.ts": "e93dd0b9878904c1fac4d79c451106020607a65d84a43b855bd92ae687984aec",
  "contextEngineV2/adapters/legacyInventory/legacyInventoryPath.ts": "abac346ae00c43c7802f7876002bd3339d6dec85777375f95e32aeb5b8f6ea06",
  "contextEngineV2/adapters/legacyInventory/legacyInventorySupport.ts": "55f6b6a3a13b89d0594df5e8f328f3013de997a7830b18ab6e625531f1a4846f",
  "contextEngineV2/domain/invariant.ts": "1c28d44c656d8efeb4c59748493d2485439da4897beb347a957da5b611195aaf",
  "contextEngineV2/domain/semanticLiteralSafety.ts": "60ead479c1567bb238ef55bfe22e97f98e55e9774d4959938753865560824dda",
};
check("complete resolved closure: nine reviewed modules, crypto/path only", () => {
  assert.deepEqual(safe.local, [...Object.keys(reviewed), canonical, adapter].sort());
  assert.deepEqual(safe.external, ["node:crypto", "node:path"]);
  for (const [file, digest] of Object.entries(reviewed)) assert.equal(sha(source(file).text), digest, "reviewed_source_drift");
});
check("before graph retains concrete filesystem/scanner witnesses, never executes them", () => {
  assert.equal(before.local.length, 30);
  assert.deepEqual(before.external, ["node:crypto", "node:fs", "node:fs/promises", "node:path"]);
  for (const file of ["scanner/projectInventoryScanner.ts", "contextEngineV2/adapters/legacyInventory/legacyInventorySnapshotPort.ts",
    "contextEngineV2/adapters/legacyInventory/index.ts", "contextEngineV2/domain/index.ts"]) {
    assert.ok(before.local.includes(file)); assert.ok(!safe.local.includes(file));
  }
});
check("actual NodeNext program emission agrees with audited ESM runtime edges", () => {
  const program = ts.createProgram(safe.local.map((file) => path.join(root, file)), { ...options, noEmit: false });
  for (const file of safe.local) {
    const node = program.getSourceFile(path.join(root, file));
    assert.ok(node);
    let emitted: string | undefined;
    program.emit(node, (name, text) => { if (name.endsWith(".js")) emitted = text; });
    assert.ok(emitted);
    assert.deepEqual(edges(ts.createSourceFile(file, emitted, ts.ScriptTarget.Latest, true)), edges(source(file).emitted));
  }
});
function capabilities(ast: ts.SourceFile): void {
  const forbidden = new Set(["fetch", "require", "eval", "Function", "process", "globalThis", "global", "window", "Deno", "Bun",
    "XMLHttpRequest", "WebSocket", "setTimeout", "setInterval"]);
  function visit(node: ts.Node) {
    assert.ok(!ts.isImportEqualsDeclaration(node), "commonjs_rejected");
    if (ts.isCallExpression(node)) assert.notEqual(node.expression.kind, ts.SyntaxKind.ImportKeyword, "dynamic_import_rejected");
    if (ts.isIdentifier(node)) assert.ok(!forbidden.has(node.text), "ambient_capability_rejected");
    ts.forEachChild(node, visit);
  }
  visit(ast);
}
check("whole emitted closure excludes ambient/external/write capabilities", () => {
  for (const file of safe.local) capabilities(source(file).emitted);
});
check("capability checks reject dynamic loads and requests, not only filenames", () => {
  for (const text of ['fetch("inert")', 'import("inert")', 'require("inert")', 'globalThis["fetch"]("inert")', 'new Function("inert")']) {
    assert.throws(() => capabilities(ts.createSourceFile("inert.js", text, ts.ScriptTarget.Latest, true)));
  }
});
check("permitted Node imports expose only existing hashing and lexical path helpers", () => {
  for (const file of safe.local) for (const node of source(file).emitted.statements) {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) continue;
    if (node.moduleSpecifier.text === "node:crypto") {
      assert.ok(node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings));
      assert.deepEqual(node.importClause.namedBindings.elements.map((item) => item.name.text), ["createHash"]);
    }
    if (node.moduleSpecifier.text === "node:path") assert.equal(node.importClause?.name?.text, "path");
  }
});
check("module initialization is definitions/data and the original private WeakSet only", () => {
  function initializer(node: ts.Node): void {
    assert.ok(!ts.isArrowFunction(node) && !ts.isFunctionExpression(node), "module_callback_rejected");
    if (ts.isCallExpression(node)) assert.ok(ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "Object" && ["freeze", "keys"].includes(node.expression.name.text), "module_call_rejected");
    if (ts.isNewExpression(node)) assert.ok(ts.isIdentifier(node.expression) && ["Set", "WeakSet", "RegExp"].includes(node.expression.text), "module_instance_rejected");
    ts.forEachChild(node, initializer);
  }
  for (const file of safe.local) for (const node of source(file).emitted.statements) {
    assert.ok(ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isVariableStatement(node));
    if (ts.isVariableStatement(node)) {
      assert.ok(node.declarationList.flags & ts.NodeFlags.Const);
      for (const declaration of node.declarationList.declarations) if (declaration.initializer) initializer(declaration.initializer);
    }
    if (ts.isClassDeclaration(node)) assert.ok(!node.members.some((member) => ts.isClassStaticBlockDeclaration(member) ||
      (ts.canHaveModifiers(member) && ts.getModifiers(member)?.some((item) => item.kind === ts.SyntaxKind.StaticKeyword))));
  }
});
check("scanner/contracts type-only imports do not enter emitted runtime closure", () => {
  assert.ok(source(canonical).text.includes('import type { ProjectInventory }'));
  assert.ok(source(adapter).text.includes('import type { ProjectInventory }'));
  for (const file of safe.local) assert.ok(!edges(source(file).emitted).some((edge) => edge.includes("scanner") || edge.includes("contracts")));
});
// Baseline 1b2ed32: exact non-import AST statements include function bodies,
// comments, private issuer, interfaces and exported signatures; LF/CRLF only.
const identities = [
  [canonical, "8231877043b0dec7e129f5e300e832c6add0e3d263e6eef225903af25fb0767b", "f7496b03a01f1f35f46a71ef3b291f165c5e74364e7919d374e099a9f30132f5"],
  [adapter, "7369ae1e424888caa6df15b4f8e197a8ee8ce179c5db5f5117025659b448f984", "2150c8139da5be121d83b016d4a3a3a5f88c120bc24d9523df9f1ca0e6b207db"],
] as const;
for (const [file, bodyDigest, previousDigest] of identities) {
  check(`${file}: all non-import AST declarations/signatures are baseline-identical`, () => {
    const parsed = source(file);
    assert.equal(sha(parsed.ast.statements.filter((node) => !ts.isImportDeclaration(node)).map((node) => node.getFullText(parsed.ast)).join("")), bodyDigest);
  });
  check(`${file}: complete source differs from baseline only by the approved import`, () => {
    const previous = source(file).text.replace(file === canonical ? '../adapters/legacyInventory/legacyInventorySnapshotAdapter.js' : '../../domain/invariant.js',
      file === canonical ? '../adapters/legacyInventory/index.js' : '../../domain/index.js');
    assert.equal(sha(previous), previousDigest);
  });
}
check("production barrel re-exports the original issuer binding, not another registry", () => {
  const barrel = "contextEngineV2/shadow/index.ts";
  const declaration = source(barrel).ast.statements.find((node): node is ts.ExportDeclaration => ts.isExportDeclaration(node) &&
    ts.isStringLiteral(node.moduleSpecifier!) && node.moduleSpecifier.text === "./shadowInputPreparation.js" && !node.isTypeOnly);
  assert.ok(declaration?.exportClause && ts.isNamedExports(declaration.exportClause));
  for (const name of ["prepareContextEngineShadowInput", "isPreparedContextEngineShadowInput", "assertContextEngineShadowInputEquivalent"]) {
    assert.ok(declaration.exportClause.elements.some((item) => item.name.text === name && !item.propertyName));
  }
  assert.equal(resolve(barrel, "./shadowInputPreparation.js"), canonical);
  for (const [entry, specifier] of [["contextEngineV2/retirement/taskPackPrimaryService.ts", "../shadow/index.js"],
    ["routes/taskPacks.ts", "../contextEngineV2/shadow/index.js"]]) {
    assert.ok(edges(source(entry).emitted).includes(specifier));
    assert.equal(resolve(entry, specifier), barrel);
  }
  const domainExport = source("contextEngineV2/domain/index.ts").ast.statements.find((node): node is ts.ExportDeclaration =>
    ts.isExportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier!) && node.moduleSpecifier.text === "./invariant.js");
  assert.ok(domainExport?.exportClause && ts.isNamedExports(domainExport.exportClause));
  assert.ok(domainExport.exportClause.elements.some((item) => item.name.text === "validateRepositorySnapshot" && !item.propertyName));
  assert.equal(resolve("contextEngineV2/domain/index.ts", "./invariant.js"), "contextEngineV2/domain/invariant.ts");
  assert.equal(resolve(canonical, "./../shadow/shadowInputPreparation.js"), canonical);
  assert.equal((source(canonical).text.match(/new WeakSet<object>\(\)/gu) ?? []).length, 1);
});
check("broad shadow barrel remains unsafe and must not be imported for an identity test", () => {
  const barrelEdges = edges(source("contextEngineV2/shadow/index.ts").emitted);
  assert.ok(barrelEdges.includes("./shadowExecutionService.js") && barrelEdges.includes("./shadowDiagnosticsWriter.js"));
  assert.ok(!safe.local.includes("contextEngineV2/shadow/index.ts"));
});
process.stdout.write(`Canonical preparation import/compatibility smoke passed: ${scenarios} scenarios; before ${before.local.length}, after ${safe.local.length} modules; node:crypto + node:path only; zero investigated modules executed.\n`);
