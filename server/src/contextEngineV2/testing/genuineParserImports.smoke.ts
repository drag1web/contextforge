import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// AST/emitted source DATA only; no audited production imports or invocations.
const root = fileURLToPath(new URL("../../", import.meta.url));
const base = "contextEngineV2/adapters/extraction/";
const core = base + "typescriptJavaScriptFactExtractorCore.ts";
const admission = base + "genuineTypeScriptParserAdmission.ts";
const contract = base + "typescriptParserCapabilities.ts";
const wrapper = base + "typescriptJavaScriptFactExtractor.ts";
const helper = base + "extractionSupport.ts";
const semantic = "contextEngineV2/domain/semanticLiteralSafety.ts";
const options = ts.parseJsonConfigFileContent(ts.readConfigFile(path.join(root, "../tsconfig.json"), ts.sys.readFile).config, ts.sys, path.join(root, "..")).options;
const program = ts.createProgram([core, admission, wrapper, contract].map(f => path.join(root, f)), { ...options, noEmit: false });
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
function source(file: string) {
  const text = fs.readFileSync(path.join(root, file), "utf8").replaceAll("\r\n", "\n");
  return { text, ast: ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true) };
}
const graphs: Record<string, { local: string[]; external: string[]; modules: unknown[] }> = {};
function closure(entry: string) {
  const local = new Set<string>(), external = new Set<string>(), modules: unknown[] = [];
  function visit(file: string) {
    if (local.has(file)) return; local.add(file);
    const node = program.getSourceFile(path.join(root, file)); assert.ok(node);
    let emitted: string | undefined;
    program.emit(node, (name, text) => { if (name.endsWith(".js")) emitted = text; }); assert.ok(emitted);
    const ast = ts.createSourceFile(file, emitted, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const edges = ast.statements.flatMap(n => (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier) ? [n.moduleSpecifier.text] : []);
    modules.push({ path: file, sha256LF: sha(source(file).text), runtimeEdges: edges });
    function dynamic(n: ts.Node) {
      if (ts.isCallExpression(n)) {
        assert.notEqual(n.expression.kind, ts.SyntaxKind.ImportKeyword);
        if (ts.isIdentifier(n.expression)) assert.ok(!["eval", "Function", "fetch", "require"].includes(n.expression.text));
      }
      ts.forEachChild(n, dynamic);
    }
    dynamic(ast);
    for (const edge of edges) {
      if (!edge.startsWith(".")) { external.add(edge); continue; }
      const resolved = ts.resolveModuleName(edge, path.join(root, file), options, ts.sys).resolvedModule;
      assert.ok(resolved && !resolved.isExternalLibraryImport && !resolved.resolvedFileName.endsWith(".d.ts"));
      const relative = path.relative(root, resolved.resolvedFileName).replaceAll("\\", "/");
      assert.ok(!relative.startsWith("../") && !path.isAbsolute(relative)); visit(relative);
    }
  }
  visit(entry); const graph = { local: [...local].sort(), external: [...external].sort(), modules };
  graphs[entry] = graph; return graph;
}
let scenarios = 0;
function check(name: string, fn: () => void) { fn(); scenarios++; process.stdout.write(`PASS ${name}\n`); }
const safe = closure(core), normal = closure(wrapper), issuer = source(admission), contractSource = source(contract);
check("exact import-safe core closure unchanged with actual NodeNext emission", () => {
  assert.deepEqual(safe.local, [core, helper, semantic].sort()); assert.deepEqual(safe.external, ["node:crypto"]);
});
check("explicit trusted production closure has no scanner provider DB runner or live runtime", () => {
  assert.deepEqual(normal.local, [wrapper, admission, contract, ...safe.local].sort());
  assert.deepEqual(normal.external, ["node:crypto", "node:fs", "node:module", "node:path", "typescript"]);
  assert.ok(!normal.local.some(f => /investigationRunner|facade|retirement|scanner|settings|storage|provider/u.test(f)));
});
check("capability type erases runtime TypeScript while exact enum behavior is retained", () => {
  assert.ok(contractSource.text.includes('typeof import("typescript")'));
  assert.ok(!contractSource.ast.statements.some(ts.isImportDeclaration));
  assert.ok(issuer.text.includes("captureEnum(ts.SyntaxKind, APPROVED_ENUM_SHA256.SyntaxKind)"));
});
check("all issued names match every runtime TS access in unchanged core", () => {
  const runtimeNames = new Set<string>();
  const fn = source(core).ast.statements.find((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === "createTypeScriptJavaScriptFactExtractorCore"); assert.ok(fn?.body);
  function visit(n: ts.Node) {
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "ts") runtimeNames.add(n.name.text);
    ts.forEachChild(n, visit);
  }
  visit(fn.body);
  const declaration = contractSource.ast.statements.filter(ts.isVariableStatement)[0].declarationList.declarations[0].initializer; assert.ok(declaration);
  const names: string[] = [];
  function strings(n: ts.Node) { if (ts.isStringLiteral(n)) names.push(n.text); ts.forEachChild(n, strings); } strings(declaration);
  assert.equal(names.length, 31); assert.equal(new Set(names).size, 31);
  assert.deepEqual([...runtimeNames].sort(), [...names, "ScriptTarget", "ScriptKind", "SyntaxKind"].sort());
});
check("trusted issuer has fixed static TS import and no caller loader/parser arguments", () => {
  assert.ok(issuer.text.includes('import ts from "typescript";'));
  const fn = issuer.ast.statements.find((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === "createGenuineTypeScriptParserCustodian"); assert.ok(fn?.body);
  assert.equal(fn.parameters.length, 0);
  assert.equal(fn.body.statements[0].getText(), 'if (arguments.length !== 0) fail("parser_admission_evidence_invalid");');
  assert.ok(issuer.text.includes('require.resolve("typescript")')); assert.ok(!issuer.text.includes("import("));
});
check("physical identity checks include actual bytes version cache and metadata", () => {
  for (const witness of ['metadata.name !== "typescript"', 'metadata.version !== APPROVED_VERSION', 'ts.version !== APPROVED_VERSION',
    'require.cache[runtimePath]?.exports !== ts', 'sha256(runtimeBytes) !== APPROVED_RUNTIME_SHA256']) assert.ok(issuer.text.includes(witness));
  assert.ok(issuer.text.includes('catch { fail("parser_admission_evidence_invalid"); }'));
});
check("no module-global mutable authorization map or evaluator singleton", () => {
  const top = issuer.ast.statements.filter(ts.isVariableStatement);
  for (const n of top) assert.ok(!/WeakMap|new Map|new Set/u.test(n.getText()));
  const fn = issuer.ast.statements.find((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === "createGenuineTypeScriptParserCustodian")!;
  assert.ok(fn.body!.getText().includes("new WeakMap<object, Record>()"));
});
check("untrusted handles use private identity without getter or Proxy reflection", () => {
  const fn = issuer.ast.statements.find((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === "createGenuineTypeScriptParserCustodian")!;
  const record = fn.body!.statements.find((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === "record")!;
  assert.ok(record.getText().includes("sessions.get(session)"));
  assert.ok(record.getText().includes("admitted.custody !== custody"));
  assert.ok(!/getOwn|Reflect|session\.|custody\./u.test(record.getText()));
});
check("genuine members captured not replaced; state checked before invocation", () => {
  assert.ok(issuer.text.includes("const implementation = ts[name]"));
  assert.ok(issuer.text.includes("active(admitted);\n        return Reflect.apply(implementation, ts, args)"));
  assert.ok(!/ts\.\w+\s*=(?!=)|setObjectAllocator\(|setSys\(|startTracing\(/u.test(issuer.text));
});
check("wrapper exact public signature and owned-session wiring", () => {
  const current = source(wrapper).ast.statements.find((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n))!;
  const old = source("contextEngineV2/testing/fixtures/typescriptJavaScriptFactExtractorBaseline.ts").ast.statements.find((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === "createTypeScriptJavaScriptFactExtractor")!;
  assert.equal(current.getText().slice(0, current.body!.getStart()-current.getStart()), old.getText().slice(0, old.body!.getStart()-old.getStart()));
  assert.deepEqual(current.body!.statements.map(n=>n.getText()), ["const custodian = createGenuineTypeScriptParserCustodian();", "const grant = custodian.admit();", "return custodian.createExtractor(grant.session, grant.custody, clock);"]);
});
check("live TS then manifest order and public FactExtractorPort unchanged", () => {
  const live = source("contextEngineV2/facade/liveContextEngineRuntime.ts").text;
  assert.ok(live.includes("extractors: [\n      createTypeScriptJavaScriptFactExtractor(input.clock),\n      createManifestFactExtractor(input.clock),\n    ]"));
  assert.equal(sha(source("contextEngineV2/ports/factExtractorPort.ts").text), "a8eb7205456b5f864abd5ad0ee027d7d2ccbec5d9136aa73ad245ccbb3a9c24d");
});
check("new admission is not publicly exported through existing product barrel", () => {
  assert.ok(!source(base+"index.ts").text.includes("ParserAdmission"));
});
process.stdout.write(`Genuine parser import/capability smoke passed: ${scenarios} scenarios; zero audited production module execution.\n`);
process.stdout.write(`IMPORT_GRAPH ${JSON.stringify(graphs)}\n`);
