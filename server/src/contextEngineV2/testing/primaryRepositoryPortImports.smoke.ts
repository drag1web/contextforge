import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// AST/emitted-import audit of repository source only; audited modules are NOT executed.
const root = fileURLToPath(new URL("../../", import.meta.url));
const entry = "contextEngineV2/validation/realWorld/primarySyntheticRepositoryPorts.ts";
const boundary = "contextEngineV2/validation/realWorld/primaryReadOnlyBoundary.ts";
const canonical = "contextEngineV2/shadow/shadowInputPreparation.ts";
const live = "contextEngineV2/adapters/liveShadow/liveRepositoryAdapter.ts";
const search = "contextEngineV2/adapters/liveShadow/liveRepositorySearch.ts";
const modules = new Map<string, { text: string; ast: ts.SourceFile; emitted: ts.SourceFile }>();
function source(relative: string) {
  assert.ok(/^[A-Za-z0-9_./-]+\.ts$/u.test(relative) && !relative.includes(".."));
  const existing = modules.get(relative);
  if (existing) return existing;
  assert.ok(modules.size < 350, "bounded_source_audit");
  const text = fs.readFileSync(path.join(root, relative), "utf8");
  assert.ok(text.length <= 700000, "bounded_source_module");
  const ast = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true);
  const js = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const value = { text, ast, emitted: ts.createSourceFile(relative, js, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS) };
  modules.set(relative, value);
  return value;
}
function edges(relative: string) {
  return source(relative).emitted.statements.flatMap((node) =>
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
      ? [node.moduleSpecifier.text] : []);
}
function resolve(from: string, specifier: string) {
  const relative = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier)).replace(/\.js$/u, ".ts");
  assert.ok(!relative.startsWith("../") && fs.existsSync(path.join(root, relative)), "unresolved_runtime_import");
  return relative;
}
function closure(relative: string) {
  const local = new Set<string>(), external = new Set<string>();
  function visit(file: string) {
    if (local.has(file)) return;
    local.add(file);
    for (const specifier of edges(file)) {
      if (specifier.startsWith(".")) visit(resolve(file, specifier)); else external.add(specifier);
    }
  }
  visit(relative);
  return { local: [...local].sort(), external: [...external].sort() };
}
function witness(from: string, to: string) {
  assert.ok(edges(from).some((item) => item.startsWith(".") && resolve(from, item) === to), "missing_source_witness");
}
function capabilityCheck(ast: ts.SourceFile) {
  const forbidden = new Set(["fetch", "require", "eval", "Function", "process", "globalThis", "global", "window", "Deno", "Bun", "XMLHttpRequest", "WebSocket", "setTimeout", "setInterval"]);
  function visit(node: ts.Node) {
    assert.ok(!ts.isImportEqualsDeclaration(node), "commonjs_load_rejected");
    if (ts.isCallExpression(node)) assert.notEqual(node.expression.kind, ts.SyntaxKind.ImportKeyword, "dynamic_load_rejected");
    if (ts.isIdentifier(node)) assert.ok(!forbidden.has(node.text), "ambient_capability_rejected");
    if (ts.isIdentifier(node) && node.text === "setImmediate") {
      assert.ok(ts.isCallExpression(node.parent) && node.parent.expression === node && node.parent.arguments.length === 1 &&
        ts.isIdentifier(node.parent.arguments[0]) && node.parent.arguments[0].text === "resolve", "unexpected_scheduler_capability");
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
}
let scenarios = 0;
function check(name: string, run: () => void) { run(); scenarios += 1; process.stdout.write(`PASS ${name}\n`); }
const safe = closure(entry);
check("complete emitted runtime closure resolves only reviewed synthetic DATA/authority modules", () => {
  assert.deepEqual(safe.local, [entry, boundary, "contextEngineV2/validation/realWorld/primaryBoundaryData.ts", "contextEngineV2/validation/realWorld/primaryBoundaryPolicy.ts",
    search, "contextEngineV2/domain/negativeConstraintMatcher.ts"].sort());
  assert.deepEqual(safe.external, ["node:crypto"]);
});
check("reader search cancellation and snapshot production types are erased runtime edges", () => {
  assert.ok(!edges(entry).some((item) => /ports\/|contracts\//u.test(item)));
  for (const name of ["repositoryReaderPort", "repositorySearchPort", "repositorySnapshotPort", "investigationCancellationPort"]) {
    assert.deepEqual(edges(`contextEngineV2/ports/${name}.ts`), []);
  }
});
check("safe closure has no ambient writes network process shell or dynamic loading", () => {
  for (const file of safe.local) capabilityCheck(source(file).emitted);
  for (const text of ['fetch("inert")', 'import("inert")', 'globalThis["fetch"]("inert")', 'require("inert")', 'new Function("inert")']) {
    assert.throws(() => capabilityCheck(ts.createSourceFile("fixture.js", text, ts.ScriptTarget.Latest, true)));
  }
});
check("module initialization allows only definitions frozen DATA and weak authority registries", () => {
  function initializer(node: ts.Node) {
    assert.ok(!ts.isArrowFunction(node) && !ts.isFunctionExpression(node), "unexpected_module_callback");
    if (ts.isCallExpression(node)) assert.ok(ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "Object" && node.expression.name.text === "freeze", "unexpected_module_call");
    if (ts.isNewExpression(node)) assert.ok(ts.isIdentifier(node.expression) && node.expression.text === "WeakMap", "unexpected_module_instance");
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
check("read admission hashes the actual Buffer not only descriptor metadata", () => {
  const text = source(entry).text;
  assert.ok(text.includes('const bytes = Buffer.from(captured.content, "utf8")'));
  assert.ok(text.includes('createHash("sha256").update(bytes).digest("hex")'));
  assert.ok(text.includes("bytes.byteLength !== file.sizeBytes"));
  assert.ok(text.includes("describeSyntheticSourceReadBasis(boundary, permit)"));
});
check("synthetic adapter exposes no canonical preparation Primary core or live assembly edge", () => {
  assert.ok(!safe.local.includes(canonical) && !safe.local.includes(live));
  const forbiddenCalls = new Set(["createTaskPackPrimaryService", "createTaskPackPrimaryServiceCore", "createLiveContextEngineExecution", "createInvestigationRunner", "prepareContextEngineShadowInput", "createGeneratedTaskPack", "scanProjectInventory"]);
  for (const file of safe.local) {
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node)) {
        const name = ts.isIdentifier(node.expression) ? node.expression.text : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : "";
        assert.ok(!forbiddenCalls.has(name), "execution_path_rejected");
      }
      ts.forEachChild(node, visit);
    }
    visit(source(file).emitted);
  }
});
check("live reader stays excluded; synthetic search imports the exact shared production function", () => {
  assert.ok(edges(live).includes("node:fs/promises"));
  const text = source(live).text;
  assert.ok(text.includes("inventoryContentPreview") && text.includes("const search = createLiveRepositorySearch(input)"));
  witness(live, search);
  witness(entry, search);
  for (const needle of ["async function search", '["path", "textHints", "semanticFacts"]', '["path", "symbols", "exports", "imports"]']) assert.ok(source(search).text.includes(needle));
  assert.ok(safe.local.includes(search) && !safe.local.includes(live));
  assert.ok(source(entry).text.includes("const productionSearch = createLiveRepositorySearch("));
  assert.ok(source(entry).text.includes("SYNTHETIC_PATH_METADATA_ONLY"));
});
check("live read full-file budget range split and BOM decoding witnesses are present", () => {
  const text = source(live).text;
  for (const needle of ["descriptor.sizeBytes > request.maxBytes", 'new TextDecoder("utf-8", { fatal: true })', 'lines.slice(request.startLine - 1, request.endLine).join("\\n")', "MAX_PHYSICAL_READ_BYTES = 16 * 1024 * 1024"]) assert.ok(text.includes(needle));
});
check("canonical direct imports exclude the filesystem barrel; reader still does not connect preparation", () => {
  witness(canonical, "contextEngineV2/adapters/legacyInventory/legacyInventorySnapshotAdapter.ts");
  witness("contextEngineV2/adapters/legacyInventory/legacyInventorySnapshotAdapter.ts", "contextEngineV2/domain/invariant.ts");
  witness("contextEngineV2/adapters/legacyInventory/index.ts", "contextEngineV2/adapters/legacyInventory/legacyInventorySnapshotPort.ts");
  witness("contextEngineV2/adapters/legacyInventory/legacyInventorySnapshotPort.ts", "scanner/projectInventoryScanner.ts");
});
check("canonical prepared identity root checks equivalent reconstruction and execution fingerprints stay production-owned", () => {
  const text = source(canonical).text;
  for (const needle of ["const preparedCanonicalInputs = new WeakSet<object>()", "preparedCanonicalInputs.has(value)", "preparedCanonicalInputs.add(prepared)",
    "path.resolve(input.projectRoot) !== path.resolve(input.inventory.rootPath)", "const rebuiltSnapshot = adaptLegacyInventoryToRepositorySnapshot", "configurationFingerprint: contextEngineShadowConfigurationFingerprint(executionBasis)"])
    assert.ok(text.includes(needle));
  const adapter = source("contextEngineV2/adapters/legacyInventory/legacyInventorySnapshotAdapter.ts").text;
  assert.ok(adapter.includes("inventory-metadata-sha256:") && adapter.includes('fingerprintKind: "metadata_derived"'));
});
process.stdout.write(`Repository port import smoke passed: ${scenarios} scenarios; safe runtime closure ${safe.local.length} modules, node:crypto only; zero production modules executed.\n`);
