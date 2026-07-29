import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  FactExtractionConflictError,
  createFactExtractorRegistry,
  createManifestFactExtractor,
  createTypeScriptJavaScriptFactExtractor,
} from "../adapters/index.js";
import type {
  EntityId,
  FactId,
  FactRecord,
  RepositoryEntity,
  RepositoryRelation,
  SnapshotId,
} from "../contracts/index.js";
import type {
  ExtractionResult,
  ExtractorInput,
  FactExtractorPort,
} from "../ports/index.js";
import { FixedClock } from "./fakes.js";

const snapshotId = "snapshot-extraction-fixture" as SnapshotId;
const fileId = "file-extraction-fixture" as EntityId;
const observedAt = "2026-01-01T00:00:00.000Z";

function fingerprint(content: string): string {
  return `content-sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function input(content: string, filePath = "src/module.tsx"): ExtractorInput {
  return {
    snapshotId,
    fileId,
    path: filePath,
    content,
    contentFingerprint: fingerprint(content),
    language: filePath.endsWith(".json") ? "json" : "typescript",
  };
}

function registry(): FactExtractorPort {
  const clock = new FixedClock(observedAt);
  return createFactExtractorRegistry([
    createManifestFactExtractor(clock),
    createTypeScriptJavaScriptFactExtractor(clock),
  ]);
}

function relations(
  result: ExtractionResult,
  predicate: string,
): RepositoryRelation[] {
  return result.facts.filter(
    (fact): fact is RepositoryRelation =>
      fact.kind === "relation" && fact.predicate === predicate,
  );
}

function assertSortedIds(records: readonly { id: string }[]): void {
  assert.deepEqual(
    records.map((record) => record.id),
    records.map((record) => record.id).sort(),
  );
}

async function testNamedImportCreatesExactRelation(): Promise<void> {
  const result = await registry().extract(
    input('import { saveUser } from "./service.js";'),
  );
  const imports = relations(result, "imports");
  assert.equal(imports.length, 1);
  assert.equal(imports[0]?.strength, "exact");
  assert.equal(imports[0]?.object.displayName, "saveUser");
  assert.equal(imports[0]?.attributes.bindingKind, "named");
}

async function testDefaultImport(): Promise<void> {
  const result = await registry().extract(
    input('import saveUser from "./service.js";'),
  );
  const relation = relations(result, "imports")[0];
  assert.equal(relation?.object.canonicalName, "./service.js#default");
  assert.equal(relation?.attributes.bindingKind, "default");
}

async function testNamespaceImport(): Promise<void> {
  const result = await registry().extract(
    input('import * as service from "./service.js";'),
  );
  const relation = relations(result, "imports")[0];
  assert.equal(relation?.object.displayName, "service");
  assert.equal(relation?.attributes.bindingKind, "namespace");
}

async function testSideEffectImport(): Promise<void> {
  const result = await registry().extract(input('import "./setup.js";'));
  const relation = relations(result, "imports")[0];
  assert.equal(relation?.object.kind, "module");
  assert.equal(relation?.attributes.bindingKind, "side_effect");
}

async function testExportDeclaration(): Promise<void> {
  const result = await registry().extract(
    input("const value = 1;\nexport { value };", "src/module.ts"),
  );
  assert.equal(relations(result, "exports").some((fact) => fact.object.displayName === "value"), true);
}

async function testReExport(): Promise<void> {
  const result = await registry().extract(
    input('export { saveUser } from "./service.js";', "src/module.ts"),
  );
  const relation = relations(result, "re_exports")[0];
  assert.equal(relation?.object.canonicalName, "./service.js#saveUser");
}

async function testTopLevelFunctionAndContains(): Promise<void> {
  const result = await registry().extract(
    input("function execute() { return true; }", "src/module.ts"),
  );
  const functionEntity = result.entities.find((entity) => entity.kind === "function");
  assert.equal(functionEntity?.displayName, "execute");
  assert.equal(relations(result, "contains").some((fact) => fact.object.id === functionEntity?.id), true);
}

async function testClassInterfaceAndTypeDeclarations(): Promise<void> {
  const result = await registry().extract(
    input(
      "class Service {}\ninterface Options {}\ntype Result = string;",
      "src/module.ts",
    ),
  );
  assert.deepEqual(
    result.entities
      .filter((entity) => ["class", "interface", "type"].includes(entity.kind))
      .map((entity) => entity.kind)
      .sort(),
    ["class", "interface", "type"],
  );
}

async function testDirectFunctionCall(): Promise<void> {
  const result = await registry().extract(
    input(
      "function saveUser() {}\nfunction execute() { saveUser(); }",
      "src/module.ts",
    ),
  );
  const call = relations(result, "calls")[0];
  assert.equal(call?.subject.displayName, "execute");
  assert.equal(call?.object.displayName, "saveUser");
}

async function testJsxComponentRender(): Promise<void> {
  const result = await registry().extract(
    input(
      'import { ProjectCard } from "./ProjectCard.js";\nexport function Page() { return <ProjectCard />; }',
    ),
  );
  const render = relations(result, "renders")[0];
  assert.equal(render?.subject.displayName, "Page");
  assert.equal(render?.subject.kind, "component");
  assert.equal(render?.object.displayName, "ProjectCard");
}

async function testStrictRouteSyntax(): Promise<void> {
  const result = await registry().extract(
    input(
      'function handler() {}\nrouter.get("/items", handler);',
      "src/routes.ts",
    ),
  );
  const endpoint = relations(result, "defines_endpoint")[0];
  assert.equal(endpoint?.object.kind, "endpoint");
  assert.equal(endpoint?.object.displayName, "GET /items");
}

async function testTestCaseAndTestsRelation(): Promise<void> {
  const result = await registry().extract(
    input(
      'import { saveUser } from "./service.js";\ntest("saves user", () => saveUser());',
      "src/module.test.ts",
    ),
  );
  const relation = relations(result, "tests")[0];
  assert.equal(relation?.subject.kind, "test_case");
  assert.equal(relation?.subject.displayName, "saves user");
  assert.equal(relation?.object.displayName, "saveUser");
}

async function testSyntaxErrorReturnsLimitation(): Promise<void> {
  const result = await registry().extract(
    input("export function broken(", "src/module.ts"),
  );
  assert.deepEqual(result.entities, []);
  assert.deepEqual(result.facts, []);
  assert.equal(result.limitations[0]?.code, "syntax_error");
  assert.equal(result.limitations[0]?.extractorId, "typescript-javascript-fact-extractor");
}

async function testUnsupportedExtensionIsNotSelected(): Promise<void> {
  const extractor = registry();
  const unsupported = input("plain text", "docs/guide.md");
  assert.equal(extractor.supports(unsupported), false);
  const result = await extractor.extract(unsupported);
  assert.equal(result.limitations[0]?.code, "unsupported_language");
}

async function testStableIdsForIdenticalInput(): Promise<void> {
  const extractor = registry();
  const fixture = input(
    'import { saveUser } from "./service.js";\nfunction execute() { saveUser(); }',
    "src/module.ts",
  );
  const first = await extractor.extract(fixture);
  const second = await extractor.extract(structuredClone(fixture));
  assert.deepEqual(
    first.entities.map((entity) => entity.id),
    second.entities.map((entity) => entity.id),
  );
  assert.deepEqual(
    first.facts.map((fact) => fact.id),
    second.facts.map((fact) => fact.id),
  );
}

async function testIndependentDeclarationOrderRemainsSorted(): Promise<void> {
  const first = await registry().extract(
    input("function alpha() {}\nfunction beta() {}", "src/module.ts"),
  );
  const second = await registry().extract(
    input("function beta() {}\nfunction alpha() {}", "src/module.ts"),
  );
  assertSortedIds(first.entities);
  assertSortedIds(first.facts);
  assertSortedIds(second.entities);
  assertSortedIds(second.facts);
}

async function testRelevantChangeChangesFactIds(): Promise<void> {
  const before = await registry().extract(
    input('import { alpha } from "./service.js";', "src/module.ts"),
  );
  const after = await registry().extract(
    input('import { beta } from "./service.js";', "src/module.ts"),
  );
  assert.notDeepEqual(
    before.facts.map((fact) => fact.id),
    after.facts.map((fact) => fact.id),
  );
}

async function testSourceSpanIsExact(): Promise<void> {
  const fixture = input(
    '\nimport { saveUser } from "./service.js";',
    "src/module.ts",
  );
  const result = await registry().extract(fixture);
  const span = relations(result, "imports")[0]?.source;
  assert.equal(span?.kind, "source_span");
  if (span?.kind !== "source_span") throw new Error("Expected source span.");
  assert.deepEqual(
    [span.startLine, span.startColumn, span.endLine, span.endColumn],
    [2, 10, 2, 18],
  );
  assert.equal(span.path, fixture.path);
}

async function testContentFingerprintIsPreserved(): Promise<void> {
  const fixture = input("function execute() {}", "src/module.ts");
  const result = await registry().extract(fixture);
  assert.equal(result.facts.every((fact) => fact.source.kind !== "source_span" || fact.source.contentFingerprint === fixture.contentFingerprint), true);
}

async function testRawSourceIsNotReturned(): Promise<void> {
  const secret = "fixture-private-literal";
  const source = `// ${secret}\nfunction execute() { return true; }`;
  const serialized = JSON.stringify(await registry().extract(input(source, "src/module.ts")));
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes(source), false);
}

async function testManifestDependenciesAreDeterministic(): Promise<void> {
  const content = JSON.stringify({
    name: "fixture-package",
    version: "1.0.0",
    type: "module",
    scripts: { test: "runner" },
    dependencies: { "safe-lib": "^1.0.0" },
    devDependencies: { "dev-lib": "^2.0.0" },
    workspaces: ["packages/*"],
  });
  const result = await registry().extract(input(content, "package.json"));
  assertSortedIds(result.entities);
  assertSortedIds(result.facts);
  assert.deepEqual(
    result.entities
      .filter((entity) => entity.kind === "external_dependency")
      .map((entity) => entity.displayName)
      .sort(),
    ["dev-lib", "safe-lib"],
  );
  assert.equal(
    result.facts.some(
      (fact) => fact.kind === "fact" && fact.attributes.key === "name",
    ),
    true,
  );
  assert.equal(
    result.facts.some(
      (fact) => fact.kind === "fact" && fact.attributes.key === "version",
    ),
    true,
  );
  assert.equal(
    result.entities.some(
      (entity) =>
        entity.kind === "configuration_key" && entity.displayName === "test",
    ),
    true,
  );
  assert.equal(
    result.entities.some(
      (entity) =>
        entity.kind === "configuration_key" &&
        entity.displayName === "packages/*",
    ),
    true,
  );
  const nameFact = result.facts.find(
    (fact) => fact.kind === "fact" && fact.attributes.key === "name",
  );
  assert.equal(nameFact?.source.kind, "source_span");
  if (nameFact?.source.kind !== "source_span") {
    throw new Error("Expected manifest source span.");
  }
  assert.equal(nameFact.source.contentFingerprint, fingerprint(content));
  assert.equal(
    nameFact.source.startColumn,
    content.indexOf('"fixture-package"') + 1,
  );
}

async function testMalformedManifestReturnsLimitation(): Promise<void> {
  const result = await registry().extract(input('{"name":', "package.json"));
  assert.deepEqual(result.entities, []);
  assert.equal(result.limitations[0]?.code, "malformed_manifest");
}

async function testCredentialLikeManifestFieldIsNotExported(): Promise<void> {
  const secret = "fixture-registry-secret";
  const content = JSON.stringify({
    name: "fixture-package",
    scripts: { publish: `publish --token=${secret}` },
    registryToken: secret,
    dependencies: { "safe-lib": `https://user:${secret}@registry.invalid/pkg` },
  });
  const serialized = JSON.stringify(
    await registry().extract(input(content, "package.json")),
  );
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes("registryToken"), false);
}

async function testNestedFunctionDoesNotLeakCallsToOuterOwner(): Promise<void> {
  const result = await registry().extract(
    input(
      "function target() {}\nfunction outer() { function inner() { target(); } }",
      "src/module.ts",
    ),
  );
  assert.equal(relations(result, "calls").length, 0);
  assert.equal(result.limitations.some((entry) => entry.code === "unsupported_construct"), true);
}

async function testNestedArrowDoesNotLeakCallsToOuterOwner(): Promise<void> {
  const result = await registry().extract(
    input(
      "function target() {}\nfunction outer() { const inner = () => target(); return 1; }",
      "src/module.ts",
    ),
  );
  assert.equal(relations(result, "calls").length, 0);
}

async function testClassMethodDoesNotUseClassAsCallOwner(): Promise<void> {
  const result = await registry().extract(
    input("function target() {}\nclass Service { run() { target(); } }", "src/module.ts"),
  );
  assert.equal(relations(result, "calls").length, 0);
}

async function testNestedJsxDoesNotClassifyOuterAsComponent(): Promise<void> {
  const result = await registry().extract(
    input(
      "function Utility() { function Nested() { return <div />; } return 1; }",
    ),
  );
  assert.equal(
    result.entities.find((entry) => entry.displayName === "Utility")?.kind,
    "function",
  );
  assert.equal(relations(result, "renders").length, 0);
}

async function testTopLevelArrowComponentStillRenders(): Promise<void> {
  const result = await registry().extract(
    input("const Card = () => <Panel />;"),
  );
  const render = relations(result, "renders")[0];
  assert.equal(render?.subject.displayName, "Card");
  assert.equal(render?.subject.kind, "component");
}

async function testDuplicateManifestNameIsRejected(): Promise<void> {
  const result = await registry().extract(
    input('{"name":"first","name":"second"}', "package.json"),
  );
  assert.deepEqual(result.entities, []);
  assert.deepEqual(result.facts, []);
  assert.equal(result.limitations[0]?.code, "malformed_manifest");
}

async function testDuplicateDependencyKeyIsRejected(): Promise<void> {
  const result = await registry().extract(
    input(
      '{"dependencies":{"safe-lib":"1.0.0","safe-lib":"2.0.0"}}',
      "package.json",
    ),
  );
  assert.deepEqual(result.entities, []);
  assert.deepEqual(result.facts, []);
  assert.equal(result.limitations[0]?.code, "malformed_manifest");
}

async function testDependencyObjectValueIsLimited(): Promise<void> {
  const result = await registry().extract(
    input('{"dependencies":{"safe-lib":{"version":"1.0.0"}}}', "package.json"),
  );
  assert.equal(result.entities.some((entry) => entry.kind === "external_dependency"), false);
  assert.equal(result.limitations.some((entry) => entry.code === "unsupported_construct"), true);
}

async function testScriptObjectValueIsLimited(): Promise<void> {
  const result = await registry().extract(
    input('{"scripts":{"test":{"command":"runner"}}}', "package.json"),
  );
  assert.equal(result.entities.some((entry) => entry.kind === "configuration_key"), false);
  assert.equal(result.limitations.some((entry) => entry.code === "unsupported_construct"), true);
}

async function testSecretLikeTestTitleIsRedacted(): Promise<void> {
  const secret = "Bearer abcdefghijklmnop";
  const serialized = JSON.stringify(
    await registry().extract(
      input(`function target() {}\ntest("${secret}", () => target());`, "src/module.test.ts"),
    ),
  );
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes("[redacted:sha256:"), true);
}

async function testSecretLikeRoutePathIsRedacted(): Promise<void> {
  const secret = "/items?token=abcdefghijklmnop";
  const serialized = JSON.stringify(
    await registry().extract(
      input(`function handler() {}\nrouter.get("${secret}", handler);`, "src/routes.ts"),
    ),
  );
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes("[redacted:sha256:"), true);
}

async function testSecretLikePackageNameIsRedacted(): Promise<void> {
  const secret = "sk-proj-abcdefghijklmnop";
  const serialized = JSON.stringify(
    await registry().extract(input(JSON.stringify({ name: secret }), "package.json")),
  );
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes("[redacted:sha256:"), true);
}

async function testSecretLikeWorkspaceIsRedacted(): Promise<void> {
  const secret = ["packages/AK", "IA", "ABCDEFGHIJKLMNOP"].join("");
  const serialized = JSON.stringify(
    await registry().extract(
      input(JSON.stringify({ workspaces: [secret] }), "package.json"),
    ),
  );
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes("[redacted:sha256:"), true);
}

async function testDefaultIdentifierExportIsObserved(): Promise<void> {
  const result = await registry().extract(
    input("const handler = () => true;\nexport default handler;", "src/module.ts"),
  );
  assert.equal(
    relations(result, "exports").some(
      (entry) => entry.object.displayName === "handler" && entry.attributes.bindingKind === "default",
    ),
    true,
  );
}

async function testAnonymousDefaultExportsAreLimited(): Promise<void> {
  const functionResult = await registry().extract(
    input("export default function () {}", "src/function.ts"),
  );
  const classResult = await registry().extract(
    input("export default class {}", "src/class.ts"),
  );
  assert.equal(functionResult.limitations.some((entry) => entry.code === "unsupported_construct"), true);
  assert.equal(classResult.limitations.some((entry) => entry.code === "unsupported_construct"), true);
}

async function testExportEqualsIsLimited(): Promise<void> {
  const result = await registry().extract(
    input("const value = 1;\nexport = value;", "src/module.ts"),
  );
  assert.equal(result.limitations.some((entry) => entry.code === "unsupported_construct"), true);
}

function fakeEntity(id: string, displayName: string): RepositoryEntity {
  return {
    id: id as EntityId,
    snapshotId,
    kind: "symbol",
    displayName,
  };
}

function fakeExtractor(
  id: string,
  entity: RepositoryEntity,
  facts: FactRecord[] = [],
): FactExtractorPort {
  return {
    id,
    version: "1",
    supports: () => true,
    async extract() {
      return { entities: [entity], facts, limitations: [] };
    },
  };
}

function fakeFact(
  id: string,
  predicate: string,
  subject: RepositoryEntity,
  object: RepositoryEntity,
): FactRecord {
  return {
    kind: "relation",
    id: id as FactId,
    snapshotId,
    subject,
    predicate,
    object,
    source: {
      kind: "repository_metadata",
      snapshotId,
      reference: "fixture",
      fingerprint: "fixture-fingerprint",
    },
    provenance: {
      extractorId: "fixture-extractor",
      extractorVersion: "1",
      method: "repository_metadata",
      observedAt,
    },
    strength: "exact",
    status: "active",
    attributes: {},
  };
}

async function testRegistryDetectsConflictingFactIds(): Promise<void> {
  const subject = fakeEntity("entity-subject", "Subject");
  const object = fakeEntity("entity-object", "Object");
  const extractor = createFactExtractorRegistry([
    fakeExtractor(
      "a-extractor",
      subject,
      [fakeFact("fact-shared", "imports", subject, object)],
    ),
    fakeExtractor(
      "b-extractor",
      object,
      [fakeFact("fact-shared", "calls", subject, object)],
    ),
  ]);
  await assert.rejects(
    extractor.extract(input("fixture", "fixture.custom")),
    (error: unknown) =>
      error instanceof FactExtractionConflictError &&
      error.recordKind === "fact" &&
      error.recordId === "fact-shared",
  );
}

async function testRegistryMergesStablyWithoutMutation(): Promise<void> {
  const firstEntity = fakeEntity("entity-a", "A");
  const secondEntity = fakeEntity("entity-b", "B");
  const forward = await createFactExtractorRegistry([
    fakeExtractor("z-extractor", secondEntity),
    fakeExtractor("a-extractor", firstEntity),
  ]).extract(input("fixture", "fixture.custom"));
  const reverse = await createFactExtractorRegistry([
    fakeExtractor("a-extractor", firstEntity),
    fakeExtractor("z-extractor", secondEntity),
  ]).extract(input("fixture", "fixture.custom"));
  assert.deepEqual(forward, reverse);
  assert.deepEqual(forward.entities.map((entity) => entity.id), ["entity-a", "entity-b"]);
  assert.deepEqual(firstEntity, fakeEntity("entity-a", "A"));
}

async function testRegistryDetectsConflictingIds(): Promise<void> {
  const extractor = createFactExtractorRegistry([
    fakeExtractor("a-extractor", fakeEntity("entity-shared", "First")),
    fakeExtractor("b-extractor", fakeEntity("entity-shared", "Second")),
  ]);
  await assert.rejects(
    extractor.extract(input("fixture", "fixture.custom")),
    (error: unknown) =>
      error instanceof FactExtractionConflictError &&
      error.recordKind === "entity" &&
      error.recordId === "entity-shared",
  );
}

async function main(): Promise<void> {
  await testNamedImportCreatesExactRelation();
  await testDefaultImport();
  await testNamespaceImport();
  await testSideEffectImport();
  await testExportDeclaration();
  await testReExport();
  await testTopLevelFunctionAndContains();
  await testClassInterfaceAndTypeDeclarations();
  await testDirectFunctionCall();
  await testJsxComponentRender();
  await testStrictRouteSyntax();
  await testTestCaseAndTestsRelation();
  await testSyntaxErrorReturnsLimitation();
  await testUnsupportedExtensionIsNotSelected();
  await testStableIdsForIdenticalInput();
  await testIndependentDeclarationOrderRemainsSorted();
  await testRelevantChangeChangesFactIds();
  await testSourceSpanIsExact();
  await testContentFingerprintIsPreserved();
  await testRawSourceIsNotReturned();
  await testManifestDependenciesAreDeterministic();
  await testMalformedManifestReturnsLimitation();
  await testCredentialLikeManifestFieldIsNotExported();
  await testNestedFunctionDoesNotLeakCallsToOuterOwner();
  await testNestedArrowDoesNotLeakCallsToOuterOwner();
  await testClassMethodDoesNotUseClassAsCallOwner();
  await testNestedJsxDoesNotClassifyOuterAsComponent();
  await testTopLevelArrowComponentStillRenders();
  await testDuplicateManifestNameIsRejected();
  await testDuplicateDependencyKeyIsRejected();
  await testDependencyObjectValueIsLimited();
  await testScriptObjectValueIsLimited();
  await testSecretLikeTestTitleIsRedacted();
  await testSecretLikeRoutePathIsRedacted();
  await testSecretLikePackageNameIsRedacted();
  await testSecretLikeWorkspaceIsRedacted();
  await testDefaultIdentifierExportIsObserved();
  await testAnonymousDefaultExportsAreLimited();
  await testExportEqualsIsLimited();
  await testRegistryMergesStablyWithoutMutation();
  await testRegistryDetectsConflictingIds();
  await testRegistryDetectsConflictingFactIds();
  console.log("Context Engine v2 extraction smoke passed: 42 scenarios.");
}

await main();
