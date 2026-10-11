import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Source-only audit: never import the live assembly or the investigated modules.
const root = fileURLToPath(new URL("../../", import.meta.url));
const core = "contextEngineV2/retirement/taskPackPrimaryCore.ts";
const assembly = "contextEngineV2/retirement/taskPackPrimaryService.ts";
const modules = new Map<string, { text: string; ast: ts.SourceFile; emitted: ts.SourceFile }>();
function source(relative: string) {
  assert.ok(/^[A-Za-z0-9_./-]+\.ts$/u.test(relative) && !relative.includes(".."));
  const cached = modules.get(relative);
  if (cached) return cached;
  assert.ok(modules.size < 350, "bounded_import_audit");
  const text = fs.readFileSync(path.join(root, relative), "utf8").replaceAll("\r\n", "\n");
  assert.ok(text.length <= 700000, "bounded_source_module");
  const ast = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true);
  const output = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const emitted = ts.createSourceFile(relative, output, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const value = { text, ast, emitted };
  modules.set(relative, value);
  return value;
}
function runtimeEdges(ast: ts.SourceFile): string[] {
  const edges: string[] = [];
  for (const statement of ast.statements) {
    if ((ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
        statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
      edges.push(statement.moduleSpecifier.text);
    }
  }
  return edges;
}
function resolve(from: string, specifier: string): string {
  assert.ok(specifier.startsWith("."), "external_edge_is_not_local");
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier)).replace(/\.js$/u, ".ts");
  assert.ok(!resolved.startsWith("../") && fs.existsSync(path.join(root, resolved)), "unresolved_import");
  return resolved;
}
function closure(entry: string) {
  const local = new Set<string>();
  const external = new Set<string>();
  function visit(relative: string) {
    if (local.has(relative)) return;
    local.add(relative);
    for (const edge of runtimeEdges(source(relative).emitted)) {
      if (edge.startsWith(".")) visit(resolve(relative, edge));
      else external.add(edge);
    }
  }
  visit(entry);
  return { local: [...local].sort(), external: [...external].sort() };
}
function sha(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function functionNode(relative: string, name: string): ts.FunctionDeclaration {
  const found = source(relative).ast.statements.find((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(found?.body, "missing_function");
  return found;
}
function tokenIdentity(value: string): string {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, value);
  const tokens: [number, string][] = [];
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    tokens.push([token, scanner.getTokenText()]);
  }
  return sha(JSON.stringify(tokens));
}
let scenarios = 0;
function check(name: string, run: () => void) { run(); scenarios += 1; process.stdout.write(`PASS ${name}\n`); }

const safe = closure(core);
// Closure pins accompany AST capability/initialization checks, not a filename blacklist.
// Only LF/CRLF is normalized for these review identities.
const REVIEWED_IMPORTS: Readonly<Record<string, string>> = {
  "contextEngineV2/adapters/legacySelection/legacyProjectionTypes.ts": "ce1843fb20064511172d83e5f0bb3c8a407e9af44043b8f09413681f58db8fa7",
  "contextEngineV2/application/configurationIdentity.ts": "713d293a37a3254e8848e8105926ec0a9fa38d613c89f8e7c5441c9c603b45d8",
  "contextEngineV2/application/documentIdentity.ts": "09e80b05c943655218d424706ea01ed6620c813425d3bcb808f0a9aa1c3ac289",
  "contextEngineV2/application/investigationRunnerTypes.ts": "d449cd6e586e2f0e6d2b0147fee39f1bea781c355a692338ad08f70c189dc139",
  "contextEngineV2/application/negativeConstraintMatcher.ts": "80c8cd44ae325e6f830dfac88ff68914209bdd89a11228d37a40d8588e61096d",
  "contextEngineV2/application/operationIdentity.ts": "8370e9eb5cd17229cbb901bcaa2ed106a73ec6b9624e25299ce867aff7378114",
  "contextEngineV2/application/projectionTypes.ts": "32d06bd6991dca7dd3fd77451f050bc7b08abd3a0cd1c2374a34396b92261330",
  "contextEngineV2/application/sourceIdentity.ts": "479bd27e5128172dfa8c593f506a514c48d93909fb3ad7a435b81a367deb6ca6",
  "contextEngineV2/application/strictRelationshipChain.ts": "d17986ff08d1a842f19287382d677ef8411b0dffaa5345b215c0081a51efd8f4",
  "contextEngineV2/domain/invariant.ts": "1c28d44c656d8efeb4c59748493d2485439da4897beb347a957da5b611195aaf",
  "contextEngineV2/domain/investigationDomainSupport.ts": "43b042cc4e28d2e062cf10ebc60b271f50016438e88ec03ed057f38d92833607",
  "contextEngineV2/domain/negativeConstraintMatcher.ts": "e0d10e4ff88ca623b0de8213ffe256ad064b1e4887969f5390f831b8c3b09f97",
  "contextEngineV2/domain/rawRecordPreflight.ts": "3e0dee29004b1de7b3e6892fb6c50c86d849c86bed1cd5618a67c93f1b9c6f74",
  "contextEngineV2/domain/semanticLiteralSafety.ts": "60ead479c1567bb238ef55bfe22e97f98e55e9774d4959938753865560824dda",
  "contextEngineV2/retirement/groundedSelectionProof.ts": "027725cd82b44b5a8ebf3d0d67f3fac3541985b7ae8bde2205f969445f0bf952",
  "contextEngineV2/retirement/primaryInvariant.ts": "f016f5ec347e59e72bad6f2158df46dc7593c4622031fd358b0cb1439d4797d0",
  "contextEngineV2/shadow/shadowPrivacy.ts": "15c6100c346eb2a2fe8497db9659a8217c2b2eb570634d250437bfbd7b816b22",
};
check("exact resolved runtime closure is reviewed; unknown dependencies fail closed", () => {
  assert.deepEqual(safe.local, [...Object.keys(REVIEWED_IMPORTS), core].sort());
  for (const [relative, digest] of Object.entries(REVIEWED_IMPORTS)) assert.equal(sha(source(relative).text), digest, "source_review_drift");
  assert.deepEqual(safe.external, ["node:crypto"]);
});
function assertCapabilities(ast: ts.SourceFile): void {
  const forbidden = new Set(["fetch", "require", "eval", "Function", "process", "globalThis", "global", "window",
    "Deno", "Bun", "XMLHttpRequest", "WebSocket", "setTimeout", "setInterval"]);
  function visit(node: ts.Node) {
    assert.ok(!ts.isImportEqualsDeclaration(node), "commonjs_import_rejected");
    if (ts.isCallExpression(node)) assert.notEqual(node.expression.kind, ts.SyntaxKind.ImportKeyword, "dynamic_import_rejected");
    if (ts.isIdentifier(node)) assert.ok(!forbidden.has(node.text), "ambient_capability_rejected");
    ts.forEachChild(node, visit);
  }
  visit(ast);
}
check("entire safe closure has no ambient external/write or dynamic-load capability", () => {
  for (const relative of safe.local) assertCapabilities(source(relative).emitted);
});
check("module evaluation is definitions/data only, no tracker or assembly initialization", () => {
  function initializer(node: ts.Node): void {
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) throw new Error("unexpected_module_callback");
    if (ts.isCallExpression(node)) {
      assert.ok(ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === "Object" && ["freeze", "keys"].includes(node.expression.name.text), "unexpected_module_call");
    }
    if (ts.isNewExpression(node)) {
      assert.ok(ts.isIdentifier(node.expression) && ["Set", "WeakSet", "RegExp"].includes(node.expression.text), "unexpected_module_instance");
    }
    ts.forEachChild(node, initializer);
  }
  for (const relative of safe.local) {
    for (const statement of source(relative).emitted.statements) {
      assert.ok(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement) || ts.isClassDeclaration(statement) ||
        ts.isFunctionDeclaration(statement) || ts.isVariableStatement(statement), "unexpected_module_statement");
      if (ts.isVariableStatement(statement)) {
        assert.ok(statement.declarationList.flags & ts.NodeFlags.Const, "module_mutable_binding");
        for (const declaration of statement.declarationList.declarations) if (declaration.initializer) initializer(declaration.initializer);
      }
      if (ts.isClassDeclaration(statement)) {
        assert.ok(!statement.members.some((member) => ts.isClassStaticBlockDeclaration(member) ||
          (ts.canHaveModifiers(member) && ts.getModifiers(member)?.some((item) => item.kind === ts.SyntaxKind.StaticKeyword))), "class_evaluation_capability");
      }
    }
  }
});
check("type-only control dependencies and barrels are genuinely erased", () => {
  const erased = ["../shadow/shadowInputPreparation.js", "../shadow/shadowDeadline.js",
    "../application/contextProjectionService.js", "../adapters/legacySelection/legacyTaskFileSelectionProjection.js", "./retirementTypes.js"];
  const imports = runtimeEdges(source(core).emitted);
  for (const edge of erased) assert.ok(!imports.includes(edge));
  const fixture = ts.transpileModule('import type { X } from "unsafe"; export type { X } from "unsafe"; import { type Y } from "unsafe"; export { type Y } from "unsafe"; import "side-effect";',
    { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
  assert.deepEqual(runtimeEdges(ts.createSourceFile("fixture.js", fixture, ts.ScriptTarget.Latest, true)), ["side-effect"]);
});
check("capability audit rejects new dynamic loads and ambient requests, not only filenames", () => {
  for (const text of ['fetch("inert")', 'import("inert")', 'globalThis["fetch"]("inert")', 'require("inert")', 'new Function("inert")']) {
    assert.throws(() => assertCapabilities(ts.createSourceFile("fixture.js", text, ts.ScriptTarget.Latest, true)));
  }
});
const HELPERS: Readonly<Record<string, string>> = {
  uniqueReasons: "5fe29e29b4b606c03c9c6f10f08e85f9e9f4925b5f02720b72c0d1cda87356dd",
  metrics: "dd31e6eee974b88bbff24e86e63f212611c8303dfc65e34a7e387316b9015615",
  createDecision: "d301012b2998bade1a75089739185a7d228a6315e0a5fbef0a0797ecbf2ef3b8",
  resolution: "3caea98603c478cc0672e0d579e66024dc0b74e6c18521143b6683ece12f032f",
  semanticStatus: "afad9f43e83460bcdd78b5e0a882b7f3dda962facd94ad37f8ddea7b86609ff4",
};
check("production decision helpers match the pinned baseline token for token", () => {
  for (const [name, digest] of Object.entries(HELPERS)) {
    assert.equal(tokenIdentity(functionNode(core, name).body!.getText()), digest);
  }
});
check("whole primary decision body is unchanged except explicit DI references and admission", () => {
  const declaration = functionNode(core, "createTaskPackPrimaryServiceCore");
  const body = declaration.body!.getText()
    .replace("assertCoreDependencies(dependencies, controls);", "")
    .replaceAll("controls.isPrepared", "isPreparedContextEngineShadowInput")
    .replaceAll("controls.assertCanonicalEquivalent", "assertContextEngineShadowInputEquivalent")
    .replaceAll("controls.settle", "settleContextEngineShadowExecution")
    .replaceAll("controls.createProjection", "createContextProjectionService")
    .replaceAll("controls.createMapping", "createLegacyTaskFileSelectionProjection");
  assert.equal(tokenIdentity(body), "d7594ac38f95c237c97e25cf987f786f0833c2a78b82d51c31a6d4bc854458e2");
});
check("production assembly supplies the original functions and same dependency object", () => {
  const expected = '{ return createTaskPackPrimaryServiceCore(dependencies, { isPrepared: isPreparedContextEngineShadowInput, assertCanonicalEquivalent: assertContextEngineShadowInputEquivalent, settle: settleContextEngineShadowExecution, createProjection: createContextProjectionService, createMapping: createLegacyTaskFileSelectionProjection, }); }';
  const declaration = functionNode(assembly, "createTaskPackPrimaryService");
  assert.equal(tokenIdentity(declaration.body!.getText()), tokenIdentity(expected));
  assert.equal(declaration.parameters.length, 1);
  assert.equal(declaration.parameters[0].type!.getText(), "TaskPackPrimaryRuntimeDependencies");
});
check("live execution, preparation failure and tracker cleanup bodies are unchanged", () => {
  const expected: Readonly<Record<string, string>> = {
    stableId: "bd2cc69d2a874106b3402a40f2938dbbb2911f6e36212e9d7794958c7d15854e",
    executeLiveTaskPackPrimaryInvestigation: "6d1c6a35e48a8e3b15e64f42aca12b9c80f5fce94834ec513d04d170cc297706",
    closeTaskPackPrimaryExecutionTracker: "cbf0efa0a866938487d2b90c4381cf4bf08b60a6604e752814347d0c154f26ae",
    unavailableFingerprint: "cb190d726379bf3f698a8d5f607528377e9a640074521a8ec707e2da522632ff",
    createTaskPackPrimaryPreparationFailure: "df4154dc5edbd1518823ade8ef8dac312b274733f95df8d7714a819b6b2b5a05",
  };
  for (const [name, digest] of Object.entries(expected)) assert.equal(tokenIdentity(functionNode(assembly, name).body!.getText()), digest);
});
check("default clock, capacity 4 tracker, default dependencies and run exports are unchanged", () => {
  const expected: Readonly<Record<string, string>> = {
    defaultClock: "550bad000ed88a0b4ff2ceb9330f4fb5f701718c7b0cadbf1045ba7dcf02a57f",
    defaultTaskPackPrimaryExecutionTracker: "4b80cf9f07e34de8e1222381f88d338ee95fde86beffed7ed759df3d63434ad8",
    defaultDependencies: "cfc0af2985ed02f4169a36f61295fb9042cc770b923f4046f8fed3d1b1cbf6d7",
    runLiveTaskPackPrimary: "9d3e51b9aa37d847f6145aa58444c6f16d5347df097fd72b1731211976165b7e",
  };
  for (const [name, digest] of Object.entries(expected)) {
    const declaration = source(assembly).ast.statements.filter(ts.isVariableStatement)
      .flatMap((statement) => [...statement.declarationList.declarations])
      .find((node) => ts.isIdentifier(node.name) && node.name.text === name);
    assert.ok(declaration);
    assert.equal(tokenIdentity(declaration.getText()), digest);
  }
});
function edge(from: string, target: string): void {
  assert.ok(runtimeEdges(source(from).emitted).some((specifier) => specifier.startsWith(".") && resolve(from, specifier) === target));
}
check("live entry/barrels still have explicit unsafe assembly; evaluation must use core directly", () => {
  const chain = [assembly, "contextEngineV2/facade/liveContextEngineRuntime.ts", "contextEngineV2/adapters/modelPlanner/index.ts",
    "contextEngineV2/adapters/modelPlanner/configuredAiModelPlannerAdapter.ts", "ai/providerService.ts", "settings/settingsService.ts", "storage/index.ts"];
  for (let index = 1; index < chain.length; index += 1) edge(chain[index - 1], chain[index]);
  edge("contextEngineV2/retirement/index.ts", assembly);
  edge("contextEngineV2/shadow/index.ts", "contextEngineV2/shadow/shadowExecutionService.ts");
});
check("canonical direct imports exclude the filesystem barrel; core still does not connect preparation", () => {
  edge("contextEngineV2/shadow/shadowInputPreparation.ts", "contextEngineV2/adapters/legacyInventory/legacyInventorySnapshotAdapter.ts");
  edge("contextEngineV2/adapters/legacyInventory/legacyInventorySnapshotAdapter.ts", "contextEngineV2/domain/invariant.ts");
  edge("contextEngineV2/adapters/legacyInventory/index.ts", "contextEngineV2/adapters/legacyInventory/legacyInventorySnapshotPort.ts");
  edge("contextEngineV2/adapters/legacyInventory/legacyInventorySnapshotPort.ts", "scanner/projectInventoryScanner.ts");
  assert.ok(!safe.local.includes("contextEngineV2/shadow/shadowInputPreparation.ts"));
});
check("production exported API names are preserved", () => {
  const names = source(assembly).ast.statements.filter((node) => ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some((item) => item.kind === ts.SyntaxKind.ExportKeyword))
    .flatMap((node) => ts.isFunctionDeclaration(node) ? [node.name!.text] :
      ts.isVariableStatement(node) ? node.declarationList.declarations.map((item) => item.name.getText()) : []).sort();
  assert.deepEqual(names, ["closeTaskPackPrimaryExecutionTracker", "createTaskPackPrimaryPreparationFailure", "createTaskPackPrimaryService",
    "defaultTaskPackPrimaryExecutionTracker", "executeLiveTaskPackPrimaryInvestigation", "runLiveTaskPackPrimary"].sort());
});
process.stdout.write(`Primary core import smoke passed: ${scenarios} scenarios; safe runtime closure ${safe.local.length} modules, node:crypto only; zero production modules executed.\n`);
