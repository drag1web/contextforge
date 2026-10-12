import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Static repository-source audit only. These modules are NEVER imported/executed.
const sourceRoot = fileURLToPath(new URL("../../", import.meta.url));
const readModules = new Map<string, ts.SourceFile>();
function source(relative: string): ts.SourceFile {
  if (!/^[A-Za-z0-9_./-]+\.ts$/u.test(relative) || relative.includes("..")) throw new Error("invalid_audit_source_path");
  const existing = readModules.get(relative);
  if (existing) return existing;
  assert.ok(readModules.size < 40, "bounded_source_audit");
  const text = fs.readFileSync(path.join(sourceRoot, relative), "utf8");
  assert.ok(text.length <= 300000, "bounded_source_module");
  const ast = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true);
  readModules.set(relative, ast);
  return ast;
}
function runtimeImports(ast: ts.SourceFile): string[] {
  const imports: string[] = [];
  for (const node of ast.statements) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const allTypeOnly = clause?.isTypeOnly || (!clause?.name && clause?.namedBindings &&
        ts.isNamedImports(clause.namedBindings) && clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every((item) => item.isTypeOnly));
      if (!allTypeOnly) imports.push(node.moduleSpecifier.text);
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const allTypeOnly = node.isTypeOnly || (node.exportClause && ts.isNamedExports(node.exportClause) &&
        node.exportClause.elements.length > 0 && node.exportClause.elements.every((item) => item.isTypeOnly));
      if (!allTypeOnly) imports.push(node.moduleSpecifier.text);
    }
  }
  return imports;
}
function edge(from: string, to: string): void {
  assert.ok(runtimeImports(source(from)).some((specifier) => specifier.startsWith(".") &&
    path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier)).replace(/\.js$/u, ".ts") === to), `missing_runtime_edge:${from}:${to}`);
}
function functionSource(relative: string, name: string): ts.FunctionDeclaration {
  const declaration = source(relative).statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration?.body, `missing_production_function:${name}`);
  return declaration;
}
function calls(node: ts.Node, name: string): boolean {
  let hit = false;
  function visit(child: ts.Node) {
    if (ts.isCallExpression(child) && ((ts.isIdentifier(child.expression) && child.expression.text === name) ||
        (ts.isPropertyAccessExpression(child.expression) && child.expression.name.text === name))) hit = true;
    ts.forEachChild(child, visit);
  }
  visit(node);
  return hit;
}
let scenarios = 0;
function check(name: string, test: () => void) { test(); scenarios += 1; process.stdout.write(`PASS ${name}\n`); }
const service = "contextEngineV2/retirement/taskPackPrimaryService.ts";
const facade = "contextEngineV2/facade/liveContextEngineRuntime.ts";
const route = "routes/taskPacks.ts";

check("primary transitive provider/settings/storage witness is real runtime imports", () => {
  const chain = [service, facade, "contextEngineV2/adapters/modelPlanner/index.ts",
    "contextEngineV2/adapters/modelPlanner/configuredAiModelPlannerAdapter.ts", "ai/providerService.ts", "settings/settingsService.ts", "storage/index.ts"];
  for (let i = 1; i < chain.length; i++) edge(chain[i - 1], chain[i]);
});
check("adapter barrel also reexports provider-capable module", () => {
  edge(facade, "contextEngineV2/adapters/index.ts");
  edge("contextEngineV2/adapters/index.ts", "contextEngineV2/adapters/modelPlanner/index.ts");
});
check("storage entrypoint constructs configured adapter at module evaluation", () => {
  edge("storage/index.ts", "storage/SqliteStorageAdapter.ts");
  edge("storage/index.ts", "storage/PostgresStorageAdapter.ts");
  const declaration = source("storage/index.ts").statements.filter(ts.isVariableStatement)
    .flatMap((node) => [...node.declarationList.declarations]).find((node) => ts.isIdentifier(node.name) && node.name.text === "storage");
  assert.ok(declaration?.initializer && calls(declaration.initializer, "getStorageAdapter"));
});
check("rules READ can import catalog into storage", () => {
  edge("rules/rulesStore.ts", "storage/index.ts");
  assert.ok(calls(functionSource("rules/rulesStore.ts", "readRulesAndTemplatesStore"), "importRulesAndTemplatesCatalog"));
});
check("preparation enqueues/persists diagnostics BEFORE creation", () => {
  const prepare = functionSource(route, "prepareTaskPackWithPipeline");
  assert.ok(calls(prepare, "enqueueContextEngineTaskPackPrimaryDecision"));
  assert.ok(calls(prepare, "appendSelectorDiagnostics"));
  assert.equal(calls(prepare, "createGeneratedTaskPack"), false);
  assert.ok(calls(functionSource(route, "createTaskPackWithPipeline"), "createGeneratedTaskPack"));
  assert.ok(calls(functionSource("settings/settingsService.ts", "appendSelectorDiagnostics"), "setSettingValue"));
});
check("canonical preparation and exact downstream callback wired in production", () => {
  const prepare = functionSource(route, "prepareTaskPackWithPipeline");
  for (const name of ["prepareBoundedTaskPackCanaryInput", "runLiveTaskPackPrimary", "validateTaskPackPrimaryCandidate", "applyTaskPackPrimaryProductionResolution"]) assert.ok(calls(prepare, name));
  const astText = prepare.getText(source(route));
  assert.ok(astText.includes('prepare: prepareContextEngineShadowInput'));
  assert.ok(astText.includes('plannerMode: "deterministic"'));
});
check("live execution uses real runner and guarded repository ports", () => {
  assert.ok(calls(functionSource(service, "executeLiveTaskPackPrimaryInvestigation"), "createLiveContextEngineExecution"));
  const execution = functionSource(facade, "createLiveContextEngineExecution");
  assert.ok(calls(execution, "createProductionInvestigationRunner"));
  edge(facade, "contextEngineV2/assembly/productionInvestigationRunner.ts");
  assert.ok(calls(functionSource("contextEngineV2/assembly/productionInvestigationRunner.ts", "createProductionInvestigationRunner"), "createInvestigationRunner"));
  assert.ok(calls(execution, "createLiveRepositoryAdapter"));
  edge("contextEngineV2/adapters/liveShadow/index.ts", "contextEngineV2/adapters/liveShadow/liveRepositoryAdapter.ts");
  const repository = source("contextEngineV2/adapters/liveShadow/liveRepositoryAdapter.ts");
  assert.ok(runtimeImports(repository).includes("node:fs/promises"));
  assert.ok(calls(repository, "open"));
});
check("candidate and outer gates remain present, no test substitution", () => {
  const candidate = functionSource(route, "validateTaskPackPrimaryCandidate");
  for (const name of ["applyExplicitTargetGuard", "buildEffectiveExecutionContract", "evaluateContextSelectionQuality", "enforceExecutionAuthorizationAuthority"]) assert.ok(calls(candidate, name));
  const prepare = functionSource(route, "prepareTaskPackWithPipeline");
  assert.ok(calls(prepare, "evaluateContextSelectionQuality"));
  assert.ok(calls(prepare, "enforceExecutionAuthorizationAuthority"));
});
check("external harness remains partial deterministic-intent profile", () => {
  const input = functionSource("commands/contextEngineExternalRetirementHarness.ts", "deriveExternalRetirementExecutionInput");
  assert.ok(calls(input, "buildDeterministicTaskIntentFallback"));
  assert.ok(calls(input, "groundTaskCurrentState"));
  assert.equal(calls(input, "analyzeTaskIntent"), false);
  edge("commands/contextEngineExternalRetirementHarness.ts", route);
});
check("boundary import graph is closed: local modules + crypto DATA only", () => {
  const names = ["primaryBoundaryData", "primaryBoundaryPolicy", "primaryReadOnlyBoundary"];
  const allowed = new Set(["node:crypto", ...names.map((name) => `./${name}.js`)]);
  const forbidden = new Set(["fetch", "require", "eval", "Function", "process", "globalThis", "setTimeout", "setInterval", "sys"]);
  for (const name of names) {
    const ast = source(`contextEngineV2/validation/realWorld/${name}.ts`);
    for (const specifier of runtimeImports(ast)) assert.ok(allowed.has(specifier), `unexpected_boundary_import:${specifier}`);
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node)) assert.notEqual(node.expression.kind, ts.SyntaxKind.ImportKeyword);
      if (ts.isIdentifier(node)) assert.ok(!forbidden.has(node.text), `forbidden_boundary_primitive:${node.text}`);
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
});
check("source custody primitive is not exported as a permit bypass", () => {
  const ast = source("contextEngineV2/validation/realWorld/primaryReadOnlyBoundary.ts");
  const read = functionSource("contextEngineV2/validation/realWorld/primaryReadOnlyBoundary.ts", "readRestrictedSyntheticFile");
  assert.equal(read.modifiers?.some((node) => node.kind === ts.SyntaxKind.ExportKeyword) ?? false, false);
  assert.equal(calls(ast, "createTaskPackPrimaryService"), false);
  assert.equal(calls(ast, "createLiveContextEngineExecution"), false);
});
check("permit registry exists only inside the issuing boundary factory", () => {
  const ast = source("contextEngineV2/validation/realWorld/primaryReadOnlyBoundary.ts");
  const factory = functionSource("contextEngineV2/validation/realWorld/primaryReadOnlyBoundary.ts", "createPrimaryReadOnlyBoundary");
  const local = factory.body!.statements.filter(ts.isVariableStatement).flatMap((node) => [...node.declarationList.declarations])
    .filter((node) => ts.isIdentifier(node.name) && node.name.text === "permits");
  assert.equal(local.length, 1);
  const initializer = local[0].initializer;
  assert.ok(initializer && ts.isNewExpression(initializer) && ts.isIdentifier(initializer.expression) && initializer.expression.text === "WeakMap");
  const declarations: ts.VariableDeclaration[] = [];
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "permits") declarations.push(node);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(declarations.length, 1); // No second module/global issuer registry.
});
check("static import classifier separates erased type imports", () => {
  const fixture = ts.createSourceFile("inert.ts", 'import type { X } from "unsafe"; export type { X } from "unsafe"; import { type Y } from "unsafe"; export { type Y } from "unsafe"; import "side-effect";', ts.ScriptTarget.Latest, true);
  assert.deepEqual(runtimeImports(fixture), ["side-effect"]);
});

process.stdout.write(`Primary dependency static smoke passed: ${scenarios} scenarios; ${readModules.size} repository source modules parsed, zero production modules executed.\n`);
