import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Audit source DATA only. Never import the live runtime or execute a runner.
const root = fileURLToPath(new URL("../../", import.meta.url));
const entry = "contextEngineV2/assembly/productionInvestigationRunner.ts";
const live = "contextEngineV2/facade/liveContextEngineRuntime.ts";
const options = ts.parseJsonConfigFileContent(ts.readConfigFile(path.join(root, "../tsconfig.json"), ts.sys.readFile).config, ts.sys, path.join(root, "..")).options;
assert.equal(options.module, ts.ModuleKind.NodeNext);
assert.equal(JSON.parse(fs.readFileSync(path.join(root, "../package.json"), "utf8")).type, "module");
const pins: Record<string, string> = {
  "contextEngineV2/adapters/extraction/extractionSupport.ts": "e7dc3122ad5cd4d9d875ca9c55318444e1ba0f1fccf5094ef2b2d6b2fb6baa74",
  "contextEngineV2/adapters/extraction/factExtractorRegistry.ts": "d65f1090fdf78247bcef57368fa72f1a088da8d847310a45f4f19119fbe9924a",
  "contextEngineV2/adapters/knowledge/inMemoryKnowledgeGraphStore.ts": "5ff8fa701c27984325e4b0389179cafdab99e486c0e0e869cf8de4d6de993384",
  "contextEngineV2/application/configurationIdentity.ts": "713d293a37a3254e8848e8105926ec0a9fa38d613c89f8e7c5441c9c603b45d8",
  "contextEngineV2/application/deterministicInvestigationInterpreter.ts": "881ff93d736d2cdedb981d02b21dd43f187c2296f98e289391767474eb6298e1",
  "contextEngineV2/application/deterministicInvestigationPlanner.ts": "ad30106f26831981fd84933ff5f50ecc25688ae1b33c63d8275e44bc71c2fef9",
  "contextEngineV2/application/deterministicOperationQueue.ts": "e0655488e6594257ab4312e464168216c179571bde7e56223bc33ad9ebae8660",
  "contextEngineV2/application/deterministicQuestionEvaluator.ts": "7453bf25ced1e968108ba93bfb01cf48b28a261ed444e440b776d514742d2637",
  "contextEngineV2/application/documentIdentity.ts": "09e80b05c943655218d424706ea01ed6620c813425d3bcb808f0a9aa1c3ac289",
  "contextEngineV2/application/entityRolePolicy.ts": "1beac203838519f7502035217dbb4b8f25099940a27e92ec623791bba05b9606",
  "contextEngineV2/application/extractionResultBoundary.ts": "05395e8dea61404afec2a9d84dafa94f869dbe98fe8db653104233c6e3524c0d",
  "contextEngineV2/application/factClaimEligibility.ts": "64d6af78ffc37b21de1206e5d32b96d8e48ba7d9eecc3b4036714e0a47d1b6c6",
  "contextEngineV2/application/investigationRunner.ts": "fa7496bbaf88799295a35bf2d9283ce7a812464a472b3746818494373ee00bb1",
  "contextEngineV2/application/investigationRunnerTypes.ts": "d449cd6e586e2f0e6d2b0147fee39f1bea781c355a692338ad08f70c189dc139",
  "contextEngineV2/application/negativeConstraintMatcher.ts": "80c8cd44ae325e6f830dfac88ff68914209bdd89a11228d37a40d8588e61096d",
  "contextEngineV2/application/operationCost.ts": "48237bb05e3f7d83fa9143433f1f43a945ca05a88045e0f389fee9c0d2d38b7a",
  "contextEngineV2/application/operationIdentity.ts": "8370e9eb5cd17229cbb901bcaa2ed106a73ec6b9624e25299ce867aff7378114",
  "contextEngineV2/application/operationRetryPolicy.ts": "375492a3d8d660d75ff98a4bca292fe543cd9435c66be4e78e826a629567e67b",
  "contextEngineV2/application/sourceIdentity.ts": "479bd27e5128172dfa8c593f506a514c48d93909fb3ad7a435b81a367deb6ca6",
  "contextEngineV2/application/strictRelationshipChain.ts": "d17986ff08d1a842f19287382d677ef8411b0dffaa5345b215c0081a51efd8f4",
  "contextEngineV2/application/truthfulGapEvaluator.ts": "02b6b217fd14d7110188b39467b00dce733dc6a35ef005f04ea7fc6d55215733",
  "contextEngineV2/domain/claimEvaluator.ts": "6b31f01c5dc2224fc0fac37f3736e230dbcb2f3bf069ae0a4884600a7d35aabe",
  "contextEngineV2/domain/contradictionRegistry.ts": "7cac4d9bd705581a581dd18672c9402a46e890d39623fb793820234f4ff13c3a",
  "contextEngineV2/domain/evaluationInvariants.ts": "b17a837c132926ba569db7dca59520172aae2d8b9079e6391c224b4121217a14",
  "contextEngineV2/domain/evidenceLedger.ts": "002f618f1827651f7186b5a2ae9e34aced71034cfa97529dfbe3e3aa365c421c",
  "contextEngineV2/domain/evidenceRequirementEvaluator.ts": "96e73d91eb9d2c423c4de8c8db326c7a6c98118a29cd2c734d21ff69c95d0eec",
  "contextEngineV2/domain/findingEligibility.ts": "5f87e22bfea4276dead1733e000f4d0441372f2db60738bc713e1fa16ad6f786",
  "contextEngineV2/domain/hypothesisLedger.ts": "008e417497f982ccea1bceaa0378ad0901a57fef8e9ba050903d7af43312f799",
  "contextEngineV2/domain/index.ts": "0c925ce63f7e2cdcd8ff5d1a7c8ebf0ffb630ef1e13c896f1d29a2160826e5fb",
  "contextEngineV2/domain/invariant.ts": "1c28d44c656d8efeb4c59748493d2485439da4897beb347a957da5b611195aaf",
  "contextEngineV2/domain/investigationBudget.ts": "87dcee1d3d0f35d69745431b6c91ab374a38021b37b42ccf814ae516569443d5",
  "contextEngineV2/domain/investigationCoverage.ts": "f7751bb57f2b1d8d4d04caa2e012ef5b740134f149244f2f3bbdd07179b9d0fd",
  "contextEngineV2/domain/investigationDomainSupport.ts": "43b042cc4e28d2e062cf10ebc60b271f50016438e88ec03ed057f38d92833607",
  "contextEngineV2/domain/knowledgeGapRegistry.ts": "e8bae3d617e02a04be517b197c5a2d4cf4e6831a92cd59df5b555096d71fb74f",
  "contextEngineV2/domain/knowledgeGraphInvariant.ts": "f475e07e8151ed2297eaa25e4af22c297bdc7e134e4e86589d4c862cf3c25db1",
  "contextEngineV2/domain/negativeConstraintMatcher.ts": "e0d10e4ff88ca623b0de8213ffe256ad064b1e4887969f5390f831b8c3b09f97",
  "contextEngineV2/domain/rawRecordPreflight.ts": "3e0dee29004b1de7b3e6892fb6c50c86d849c86bed1cd5618a67c93f1b9c6f74",
  "contextEngineV2/domain/semanticLiteralSafety.ts": "60ead479c1567bb238ef55bfe22e97f98e55e9774d4959938753865560824dda",
  "contextEngineV2/domain/stopPolicy.ts": "bf3162f5dac3e3d6afdea2d024489984498ad6247f6b9d556d633fd94aa44006",
  "contextEngineV2/domain/validatedDomainContext.ts": "a3c4737525e954ada19f021342824f83208cda31ebb16d1dfce70f87271b0dd1",
  "contextEngineV2/domain/validatedDomainEnvelope.ts": "52ece013652221fce9b39f9a6e1207a8e83249133c37696801aef51d146739d1"
};
const sources = new Map<string, { text: string; ast: ts.SourceFile; emitted: ts.SourceFile }>();
function source(relative: string) {
  assert.ok(/^[A-Za-z0-9_./-]+\.ts$/u.test(relative) && !relative.includes(".."));
  const cached = sources.get(relative); if (cached) return cached;
  assert.ok(sources.size < 60);
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
function closure(start: string) {
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
  visit(start); return { local: [...local].sort(), external: [...external].sort() };
}
function factory(file: string, name: string) {
  const node = source(file).ast.statements.find((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.ok(node?.body); return node;
}
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
let scenarios = 0;
function check(name: string, test: () => void) { test(); scenarios++; process.stdout.write(`PASS ${name}\n`); }
const safe = closure(entry);
check("complete runtime closure is exactly 42 reviewed modules and two bounded Node bindings", () => {
  assert.deepEqual(safe.local, [entry, ...Object.keys(pins)].sort());
  assert.deepEqual(safe.external, ["node:crypto", "node:util/types"]);
  for (const [file, hash] of Object.entries(pins)) assert.equal(sha(source(file).text), hash, file);
});
check("actual NodeNext program emission agrees for every runtime module; type imports are erased", () => {
  const program = ts.createProgram(safe.local.map(f => path.join(root, f)), { ...options, noEmit: false });
  for (const file of safe.local) {
    const node = program.getSourceFile(path.join(root, file)); assert.ok(node); let output: string | undefined;
    program.emit(node, (name, text) => { if (name.endsWith(".js")) output = text; }); assert.ok(output);
    assert.deepEqual(edges(ts.createSourceFile(file, output, ts.ScriptTarget.Latest, true)), edges(source(file).emitted));
  }
});
function capabilities(ast: ts.SourceFile) {
  const forbidden = new Set(["fetch", "require", "eval", "Function", "process", "globalThis", "global", "window", "Deno", "Bun", "XMLHttpRequest", "WebSocket", "setTimeout", "setInterval"]);
  function visit(n: ts.Node) {
    assert.ok(!ts.isImportEqualsDeclaration(n));
    if (ts.isCallExpression(n)) assert.notEqual(n.expression.kind, ts.SyntaxKind.ImportKeyword);
    if (ts.isIdentifier(n)) assert.ok(!forbidden.has(n.text), "ambient_capability_rejected");
    if (ts.isIdentifier(n) && n.text === "setImmediate") assert.ok(ts.isCallExpression(n.parent) &&
      n.parent.expression === n && n.parent.arguments.length === 1 && ts.isIdentifier(n.parent.arguments[0]) &&
      n.parent.arguments[0].text === "resolve", "unexpected_scheduler_capability");
    ts.forEachChild(n, visit);
  }
  visit(ast);
}
check("emitted closure excludes ambient network/process/filesystem and dynamic loads", () => {
  for (const file of safe.local) capabilities(source(file).emitted);
});
check("capability audit rejects executable loads and requests, not just filenames", () => {
  for (const text of ['fetch("x")', 'import("x")', 'require("x")', 'process.exit()', 'globalThis["fetch"]("x")', 'setImmediate(arbitrary)'])
    assert.throws(() => capabilities(ts.createSourceFile("inert.js", text, ts.ScriptTarget.Latest, true)));
});
check("module initialization is reviewed declarations and local constant data only", () => {
  function init(n: ts.Node) {
    if (ts.isCallExpression(n)) {
      assert.ok(ts.isPropertyAccessExpression(n.expression));
      assert.ok(["freeze", "keys", "filter"].includes(n.expression.name.text));
    }
    if (ts.isNewExpression(n)) assert.ok(ts.isIdentifier(n.expression) && ["Set", "Map", "WeakMap", "WeakSet", "RegExp"].includes(n.expression.text));
    ts.forEachChild(n, init);
  }
  for (const file of safe.local) for (const n of source(file).emitted.statements) {
    assert.ok(ts.isImportDeclaration(n) || ts.isExportDeclaration(n) || ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n) || ts.isVariableStatement(n));
    if (ts.isVariableStatement(n)) {
      assert.ok(n.declarationList.flags & ts.NodeFlags.Const);
      for (const d of n.declarationList.declarations) if (d.initializer) init(d.initializer);
    }
    if (ts.isClassDeclaration(n)) assert.ok(!n.members.some(m => ts.isClassStaticBlockDeclaration(m) ||
      (ts.canHaveModifiers(m) && ts.getModifiers(m)?.some(mod => mod.kind === ts.SyntaxKind.StaticKeyword))));
  }
});
check("safe entry imports only actual runner registry graph and native Proxy predicate", () => {
  assert.deepEqual(edges(source(entry).emitted), ["node:util/types", "../application/investigationRunner.js", "../adapters/extraction/factExtractorRegistry.js", "../adapters/knowledge/inMemoryKnowledgeGraphStore.js"]);
  assert.ok(!safe.local.some(f => /typescriptJavaScript|manifestFactExtractor|liveContextEngineRuntime|scanner|storage|settings|diagnostics|modelPlanner/u.test(f)));
});
check("constructor wiring passes exact port references, optional planner/signal and per-call registry/graph", () => {
  const body = factory(entry, "createProductionInvestigationRunner").body!;
  const result = body.statements.at(-1); assert.ok(result && ts.isReturnStatement(result));
  assert.ok(result.expression && ts.isCallExpression(result.expression));
  assert.equal(result.expression.expression.getText(), "createInvestigationRunner");
  assert.ok(ts.isObjectLiteralExpression(result.expression.arguments[0]));
  assert.deepEqual(result.expression.arguments[0].properties.map(n => n.getText()), [
    "clock: dependencies.clock", "cancellation: dependencies.cancellation", "repositoryReader: dependencies.repositoryReader",
    "repositorySearch: dependencies.repositorySearch", "factExtractor: createFactExtractorRegistry(extractors)",
    "graphStore: createInMemoryKnowledgeGraphStore()", "planner: undefined", "actionPlanner: dependencies.actionPlanner", "plannerSignal: dependencies.plannerSignal"
  ]);
});
check("actual runner constructor defaults remain deterministic and do not run", () => {
  const body = factory("contextEngineV2/application/investigationRunner.ts", "createInvestigationRunner").body!;
  assert.equal(body.statements.length, 3);
  assert.ok(body.statements[0].getText().includes("dependencies.planner ?? createDeterministicInvestigationPlanner()"));
  assert.ok(body.statements[1].getText().includes("dependencies.actionPlanner ??"));
  assert.ok(ts.isReturnStatement(body.statements[2]));
});
check("per-request graph state and genuine registry sort/duplicate behavior remain unchanged", () => {
  assert.equal(factory("contextEngineV2/adapters/knowledge/inMemoryKnowledgeGraphStore.ts", "createInMemoryKnowledgeGraphStore").body!.statements[0].getText(), "const graphs = new Map<SnapshotId, SnapshotGraph>();");
  const registry = factory("contextEngineV2/adapters/extraction/factExtractorRegistry.ts", "createFactExtractorRegistry").body!;
  assert.ok(registry.statements[0].getText().includes("[...registeredExtractors].sort"));
  assert.ok(registry.statements[0].getText().includes("stableCompare"));
});
check("reverse ONLY delegation reconstructs the entire original live source", () => {
  const old = source(live).text
    .replace('import { createProductionInvestigationRunner } from "../assembly/productionInvestigationRunner.js";', 'import {\n  createInvestigationRunner,\n} from "../application/index.js";')
    .replace('import {\n  createLiveRepositoryAdapter,', 'import {\n  createFactExtractorRegistry,\n  createInMemoryKnowledgeGraphStore,\n  createLiveRepositoryAdapter,')
    .replace("const runner = createProductionInvestigationRunner({", "const runner = createInvestigationRunner({")
    .replace("    extractors: [", "    factExtractor: createFactExtractorRegistry([")
    .replace('    ],\n    ...(actionPlanner', '    ]),\n    graphStore: createInMemoryKnowledgeGraphStore(),\n    ...(actionPlanner');
  assert.equal(sha(old), "7430c49849aca50fd4f6f6ad48e1afb5daeeec03d3aded05e9e06c47c16a1635");
});
check("live public signature and interface are byte-equivalent", () => {
  const declaration = factory(live, "createLiveContextEngineExecution");
  const signature = source(live).text.slice(declaration.getStart(), declaration.body!.getStart());
  assert.equal(sha(signature), "bc795f5e6ebad9447e89859fb7694675c9c6b890a04dd712416318b99466bcd1");
  const contract = source(live).ast.statements.find(n => ts.isInterfaceDeclaration(n) && n.name.text === "LiveContextEngineExecutionInput");
  assert.ok(contract); assert.equal(sha(contract.getText()), "e0333f030b5ea35bd1391163d404ccbb154ae0d56c87ad0498b857394a2236e7");
});
check("live constructs genuine extractors in original order and retains model behavior/cancellation", () => {
  const text = factory(live, "createLiveContextEngineExecution").getText();
  assert.ok(text.includes("extractors: [\n      createTypeScriptJavaScriptFactExtractor(input.clock),\n      createManifestFactExtractor(input.clock),\n    ]"));
  for (const s of ["createConfiguredAiModelPlannerAdapter", "input.modelPlannerPolicy ?? DEFAULT_MODEL_PLANNER_POLICY", "input.modelPlannerTracker", "input.observeModelPlanner", "plannerSignal: input.abortSignal", "isCancellationRequested: () => input.abortSignal.aborted", "return runner.run(input.runnerInput)"]) assert.ok(text.includes(s));
});
check("safe assembly cannot issue B1 authority and contains no run/extract/read/search invocation", () => {
  const calls: string[] = [];
  function visit(n: ts.Node) { if (ts.isCallExpression(n)) calls.push(n.expression.getText()); ts.forEachChild(n, visit); }
  visit(source(entry).ast);
  assert.ok(!calls.some(n => /(?:^|\.)(run|extract|supports|readFile|readRange|searchPaths|searchText|searchSymbols|requestPrimaryExecutionPermit)$/u.test(n)));
  const boundary = source("contextEngineV2/validation/realWorld/primaryReadOnlyBoundary.ts").text;
  assert.ok(boundary.includes("requestPrimaryExecutionPermit"));
  assert.ok(boundary.includes('status: "blocked", technicalStatus: "not_run", code: "production_adapter_not_connected"'));
});
process.stdout.write(`Production runner import/compatibility smoke passed: ${scenarios} scenarios; ${safe.local.length} runtime modules; ${safe.external.join(", ")}; zero production modules executed.\n`);
