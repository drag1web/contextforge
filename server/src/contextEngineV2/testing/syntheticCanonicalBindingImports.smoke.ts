import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { evaluateArchitectureImports, extractModuleSpecifiers } from "./architectureGuard.js";

// Static SOURCE DATA audit; no production module is imported/executed here.
const root = fileURLToPath(new URL("../", import.meta.url));
const entry = "testing/syntheticCanonicalSourceBinding.ts";
const reviewed: Readonly<Record<string, string>> = {
  "shadow/shadowInputPreparation.ts": "76dd55971828e3cbf1958197f9ffe949001ae503e6e04b6fddf11c9340a89877",
  "shadow/shadowExecutionBasis.ts": "7eb000cb77403227faf7e9af0c82cb20d33b3bac8691c4037075140792266ce6",
  "planner/plannerMode.ts": "d1281ed1fd1ff7a540507dfa5dcd97d452ad3cfd781889a18d393ff71e35e7ac",
  "adapters/legacyInventory/legacyInventorySnapshotAdapter.ts": "4d8e8ca4933eee77f14adf7af0dd2f9fbccbd8a6b2cb1fec001656f760cb21f2",
  "adapters/legacyInventory/legacyInventoryFileMapper.ts": "e93dd0b9878904c1fac4d79c451106020607a65d84a43b855bd92ae687984aec",
  "adapters/legacyInventory/legacyInventoryPath.ts": "abac346ae00c43c7802f7876002bd3339d6dec85777375f95e32aeb5b8f6ea06",
  "adapters/legacyInventory/legacyInventorySupport.ts": "55f6b6a3a13b89d0594df5e8f328f3013de997a7830b18ab6e625531f1a4846f",
  "domain/invariant.ts": "1c28d44c656d8efeb4c59748493d2485439da4897beb347a957da5b611195aaf",
  "domain/semanticLiteralSafety.ts": "60ead479c1567bb238ef55bfe22e97f98e55e9774d4959938753865560824dda",
  "validation/realWorld/primarySyntheticRepositoryPorts.ts": "3f5f9dbe39114c3c27aa1615d5d264568c27da531d1bdc1af6c55789a87ea09a",
  "validation/realWorld/primaryReadOnlyBoundary.ts": "3aecbc856b756b2994d264a19dcd4985ad69321a4db29fc9ad2d3eb22f3be3e4",
  "validation/realWorld/primaryBoundaryData.ts": "ed9eff5a4612aeecc4d18e9c148a1e575cec1297e01b23888d71dffd86aa1096",
  "validation/realWorld/primaryBoundaryPolicy.ts": "5149c1d64e2d9dbc4012e37b1332bcf460d6287cadf590f1d8dbda2e229c147e",
  "adapters/liveShadow/liveRepositorySearch.ts": "1cfa29fa9a5a9c965ce2009a63f011ca3aa8a75746607dc843b1ae017a9d4538",
  "domain/negativeConstraintMatcher.ts": "e0d10e4ff88ca623b0de8213ffe256ad064b1e4887969f5390f831b8c3b09f97",
};
const options = ts.parseJsonConfigFileContent(ts.readConfigFile(path.join(root, "../../tsconfig.json"), ts.sys.readFile).config,
  ts.sys, path.join(root, "../..")).options;
assert.equal(options.module, ts.ModuleKind.NodeNext);
const modules = new Map<string, { text: string; ast: ts.SourceFile; emitted: ts.SourceFile }>();
function source(relative: string) {
  const previous = modules.get(relative); if (previous) return previous;
  assert.ok(modules.size < 32 && /^[A-Za-z0-9_./-]+\.ts$/u.test(relative) && !relative.includes(".."));
  const text = fs.readFileSync(path.join(root, relative), "utf8").replaceAll("\r\n", "\n");
  const output = ts.transpileModule(text, { fileName: path.join(root, relative), compilerOptions: { ...options, module: ts.ModuleKind.ESNext } }).outputText;
  const value = { text, ast: ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true),
    emitted: ts.createSourceFile(relative, output, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS) };
  modules.set(relative, value); return value;
}
function edges(ast: ts.SourceFile) {
  return ast.statements.flatMap((node) => (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
    ? [node.moduleSpecifier.text] : []);
}
const local = new Set<string>(), external = new Set<string>();
function visit(file: string) {
  if (local.has(file)) return; local.add(file);
  for (const specifier of edges(source(file).emitted)) {
    if (!specifier.startsWith(".")) { external.add(specifier); continue; }
    const resolved = ts.resolveModuleName(specifier, path.join(root, file), options, ts.sys).resolvedModule;
    assert.ok(resolved && !resolved.isExternalLibraryImport && !resolved.resolvedFileName.endsWith(".d.ts"));
    const relative = path.relative(root, resolved.resolvedFileName).replaceAll("\\", "/");
    assert.ok(!relative.startsWith("../") && !path.isAbsolute(relative)); visit(relative);
  }
}
visit(entry);
let scenarios = 0;
function check(name: string, run: () => void) { run(); scenarios += 1; process.stdout.write(`PASS ${name}\n`); }
check("complete runtime closure is 15 unchanged reviewed modules plus one association module", () => {
  assert.deepEqual([...local].sort(), [entry, ...Object.keys(reviewed)].sort()); assert.deepEqual([...external].sort(), ["node:crypto", "node:path"]);
  for (const [file, hash] of Object.entries(reviewed)) assert.equal(createHash("sha256").update(source(file).text).digest("hex"), hash);
});
check("actual NodeNext program emission matches audited runtime edges", () => {
  const program = ts.createProgram([...local].map((file) => path.join(root, file)), { ...options, noEmit: false });
  for (const file of local) {
    const node = program.getSourceFile(path.join(root, file)); assert.ok(node); let output: string | undefined;
    program.emit(node, (name, text) => { if (name.endsWith(".js")) output = text; }); assert.ok(output);
    assert.deepEqual(edges(ts.createSourceFile(file, output, ts.ScriptTarget.Latest, true)), edges(source(file).emitted));
  }
});
check("entire emitted closure has no external requests dynamic loads or execution factories", () => {
  const forbidden = new Set(["fetch", "require", "eval", "Function", "process", "globalThis", "global", "window", "Deno", "Bun",
    "XMLHttpRequest", "WebSocket", "setTimeout", "setInterval", "createInvestigationRunner", "createLiveContextEngineExecution",
    "createTaskPackPrimaryService", "createTaskPackPrimaryServiceCore", "createGeneratedTaskPack", "scanProjectInventory"]);
  for (const file of local) {
    function inspect(node: ts.Node) {
      assert.ok(!ts.isImportEqualsDeclaration(node));
      if (ts.isCallExpression(node)) assert.notEqual(node.expression.kind, ts.SyntaxKind.ImportKeyword);
      if (ts.isIdentifier(node)) assert.ok(!forbidden.has(node.text));
      if (ts.isIdentifier(node) && node.text === "setImmediate") assert.ok(file === "adapters/liveShadow/liveRepositorySearch.ts" &&
        ts.isCallExpression(node.parent) && node.parent.expression === node && node.parent.arguments.length === 1 &&
        ts.isIdentifier(node.parent.arguments[0]) && node.parent.arguments[0].text === "resolve");
      ts.forEachChild(node, inspect);
    }
    inspect(source(file).emitted);
  }
});
check("new module import initializes no custody maps callbacks or source acquisition", () => {
  for (const node of source(entry).emitted.statements) {
    assert.ok(ts.isImportDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isVariableStatement(node));
    if (ts.isVariableStatement(node)) for (const declaration of node.declarationList.declarations)
      assert.ok(declaration.initializer && ts.isStringLiteral(declaration.initializer));
  }
  assert.ok(source(entry).text.includes('const witnesses = new WeakMap<object,'));
  assert.equal(source(entry).text.includes("new WeakSet"), false);
  assert.equal((source("shadow/shadowInputPreparation.ts").text.match(/new WeakSet<object>\(\)/gu) ?? []).length, 1);
});
check("the genuine issuer and equivalence guards are direct imports, not alternate canonical logic", () => {
  assert.ok(edges(source(entry).emitted).includes("../shadow/shadowInputPreparation.js"));
  for (const name of ["prepareContextEngineShadowInput", "isPreparedContextEngineShadowInput", "assertContextEngineShadowInputEquivalent"])
    assert.ok(source(entry).text.includes(name));
  assert.equal(source(entry).text.includes("ReadOnlyPrimaryExecutionPermit"), false);
  assert.ok(source(entry).text.includes("metadataIsByteSeal: false"));
});
check("source-byte provenance calls authenticated B1 data reads and keeps S1 unchanged", () => {
  assert.ok(source(entry).text.includes("describeSyntheticSourceReadBasis(input.boundary, input.permit)"));
  assert.ok(source(entry).text.includes("boundary.readSource(permit, boundaryPath(path))"));
  assert.ok(source(entry).text.includes("boundaryHash(file.content) !== digest"));
  assert.ok(source(entry).text.includes("supplied.boundary !== boundary || supplied.permit !== permit"));
});
check("original validation placement still has exactly three forbidden shadow imports", () => {
  // Reconstruct only the pre-relocation import paths; all declarations stay intact.
  const original = source(entry).text
    .replaceAll('"../shadow/', '"../../shadow/')
    .replaceAll('"../contracts/', '"../../contracts/')
    .replaceAll('"../validation/realWorld/', '"./');
  const violations = evaluateArchitectureImports({ repositoryRoot: path.resolve(root, "../../.."), modules: [{
    filePath: path.join(root, "validation/realWorld/syntheticCanonicalSourceBinding.ts"), sourceText: original,
  }] });
  assert.deepEqual(violations.map(({ rule, importPath }) => ({ rule, importPath })), [
    { rule: "layer_direction", importPath: "../../shadow/shadowInputPreparation.js" },
    { rule: "layer_direction", importPath: "../../shadow/shadowInputPreparation.js" },
    { rule: "layer_direction", importPath: "../../shadow/shadowTypes.js" },
  ]);
});
check("relocated helper passes existing testing-layer rules without a new exception", () => {
  assert.deepEqual(evaluateArchitectureImports({ repositoryRoot: path.resolve(root, "../../.."), modules: [{
    filePath: path.join(root, entry), sourceText: source(entry).text,
  }] }), []);
  assert.equal(fs.existsSync(path.join(root, "validation/realWorld/syntheticCanonicalSourceBinding.ts")), false);
});
check("production imports of this helper remain forbidden in CE2 and product layers", () => {
  for (const [file, specifier, rule] of [
    ["validation/realWorld/rejectedFixture.ts", "../../testing/syntheticCanonicalSourceBinding.js", "layer_direction"],
    ["../routes/rejectedFixture.ts", "../contextEngineV2/testing/syntheticCanonicalSourceBinding.js", "production_isolation"],
  ]) {
    const violations = evaluateArchitectureImports({ repositoryRoot: path.resolve(root, "../../.."), modules: [{
      filePath: path.join(root, file), sourceText: `import { createSyntheticCanonicalSourceBinding } from "${specifier}";`,
    }] });
    assert.deepEqual(violations.map((violation) => violation.rule), [rule]);
  }
});
check("actual server desktop shared and script sources have no production importers", () => {
  const repositoryRoot = path.resolve(root, "../../.."), target = path.resolve(root, entry);
  const importers: string[] = [];
  function inspect(directory: string) {
    if (!fs.existsSync(directory)) return;
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name);
      // Never follow links or inspect dependency/generated/runtime directories.
      if (item.isSymbolicLink()) continue;
      if (item.isDirectory()) {
        if (!["node_modules", "dist", "build", "coverage", ".git", "data"].includes(item.name)) inspect(file);
      } else if (item.isFile() && /\.(?:[cm]?[jt]sx?)$/u.test(item.name)) {
        for (const specifier of extractModuleSpecifiers(fs.readFileSync(file, "utf8"), file)) {
          const resolved = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule;
          if (resolved && path.resolve(resolved.resolvedFileName) === target) importers.push(path.relative(repositoryRoot, file).replaceAll("\\", "/"));
        }
      }
    }
  }
  for (const directory of ["server/src", "apps/desktop/electron", "apps/desktop/renderer/src", "packages", "scripts"])
    inspect(path.join(repositoryRoot, directory));
  assert.deepEqual(importers.sort(), [
    "server/src/contextEngineV2/testing/syntheticCanonicalSourceBinding.smoke.ts",
  ]);
});
process.stdout.write(`Synthetic canonical binding import smoke passed: ${scenarios} scenarios; 16 modules; crypto/path only; zero investigated modules executed.\n`);
