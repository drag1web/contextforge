import assert from "node:assert/strict";

import { analyzeJavaScriptTypeScriptSymbols } from "./sourceSymbolSyntax.js";

function analyze(source: string, extension = ".ts") {
  const result = analyzeJavaScriptTypeScriptSymbols(source, extension);
  if (!result) {
    throw new Error(`Expected ${extension} source to be supported.`);
  }
  return result.facts;
}

function testRealDeclarationAndReference() {
  const facts = analyze(`
    export interface WorkspaceSearchResponse { results: string[] }
    const value: WorkspaceSearchResponse = { results: [] };
  `);
  assert.ok(facts.declarations.includes("WorkspaceSearchResponse"));
  assert.ok(facts.references.includes("WorkspaceSearchResponse"));
}

function testStringAndCommentFixturesAreIgnored() {
  const facts = analyze(`
    const fixture = "interface MissingSearchResponse {}";
    // type MissingSearchResponse = string;
    /* class MissingSearchResponse {} */
    const diagnostics = { declarations: ["MissingSearchResponse"] };
  `);
  assert.ok(!facts.declarations.includes("MissingSearchResponse"));
  assert.ok(!facts.references.includes("MissingSearchResponse"));
}

function testTemplateAndRegexFixturesAreIgnored() {
  const facts = analyze(`
    const template = \`WorkspaceSearchResponse MissingSearchResponse\`;
    const pattern = /WorkspaceSearchResponse|MissingSearchResponse/g;
  `);
  assert.ok(!facts.references.includes("WorkspaceSearchResponse"));
  assert.ok(!facts.references.includes("MissingSearchResponse"));
}

function testJsxTextIsIgnoredButComponentReferenceRemains() {
  const facts = analyze(`
    function Demo() {
      return <WorkspaceSearchResponse>MissingSearchResponse</WorkspaceSearchResponse>;
    }
  `, ".tsx");
  assert.ok(facts.references.includes("WorkspaceSearchResponse"));
  assert.ok(!facts.references.includes("MissingSearchResponse"));
}

function testNamedTypeImportBinding() {
  const facts = analyze(`
    import type {
      WorkspaceSearchResponse,
      WorkspaceSearchResult as SearchResult,
    } from "../types";
    export function read(value: WorkspaceSearchResponse): SearchResult | null {
      return value.results[0] ?? null;
    }
  `);
  assert.deepEqual(
    facts.imports.filter((binding) => binding.moduleSpecifier === "../types"),
    [
      {
        moduleSpecifier: "../types",
        importedName: "WorkspaceSearchResponse",
        localName: "WorkspaceSearchResponse",
        kind: "named",
        typeOnly: true,
      },
      {
        moduleSpecifier: "../types",
        importedName: "WorkspaceSearchResult",
        localName: "SearchResult",
        kind: "named",
        typeOnly: true,
      },
    ],
  );
}

function testReexportBinding() {
  const facts = analyze(`
    export type { WorkspaceSearchResponse as PublicSearchResponse } from "./types";
  `);
  assert.deepEqual(facts.imports, [
    {
      moduleSpecifier: "./types",
      importedName: "WorkspaceSearchResponse",
      localName: "PublicSearchResponse",
      kind: "reexport",
      typeOnly: true,
    },
  ]);
}

function testUnrelatedDivisionIsNotRegex() {
  const facts = analyze(`
    const WorkspaceSearchResponse = total / count;
  `);
  assert.ok(facts.declarations.includes("WorkspaceSearchResponse"));
}

function testUnsupportedFileReturnsNull() {
  assert.equal(
    analyzeJavaScriptTypeScriptSymbols("class WorkspaceSearchResponse {}", ".py"),
    null,
  );
}

function main() {
  testRealDeclarationAndReference();
  testStringAndCommentFixturesAreIgnored();
  testTemplateAndRegexFixturesAreIgnored();
  testJsxTextIsIgnoredButComponentReferenceRemains();
  testNamedTypeImportBinding();
  testReexportBinding();
  testUnrelatedDivisionIsNotRegex();
  testUnsupportedFileReturnsNull();
  console.log("source symbol syntax smoke passed: 8 scenarios");
}

main();
