import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  evaluateArchitectureImports,
  scanContextEngineV2Architecture,
  type ArchitectureSourceModule,
} from "./architectureGuard.js";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));

function fixtureModule(
  relativePath: string,
  sourceText: string,
): ArchitectureSourceModule {
  return {
    filePath: path.join(repositoryRoot, ...relativePath.split("/")),
    sourceText,
  };
}

function testCurrentArchitecturePasses(): void {
  const violations = scanContextEngineV2Architecture(repositoryRoot);
  assert.deepEqual(
    violations,
    [],
    violations
      .map(
        (violation) =>
          `${violation.rule}: ${violation.filePath} -> ${violation.importPath}`,
      )
      .join("\n"),
  );
}

function testLayerDirectionViolationIsDetected(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule(
        "server/src/contextEngineV2/domain/leak.ts",
        'import { run } from "../application/run.js";',
      ),
    ],
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.rule, "layer_direction");
}

function testProductionImportIsDetected(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule(
        "server/src/routes/example.ts",
        'import { engine } from "../contextEngineV2/index.js";',
      ),
    ],
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.rule, "production_isolation");
}

function testAllowedApplicationDependenciesPass(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule(
        "server/src/contextEngineV2/application/useCase.ts",
        [
          'import type { Finding } from "../contracts/evidence.js";',
          'import { assertFact } from "../domain/invariant.js";',
          'import type { Reader } from "../ports/reader.js";',
        ].join("\n"),
      ),
    ],
  });
  assert.deepEqual(violations, []);
}

function testPolicyCannotImportProductionRoute(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule(
        "server/src/contextEngineV2/policy/leak.ts",
        'import { route } from "../../routes/example.js";',
      ),
    ],
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.rule, "core_boundary_escape");
}

function testUnknownLayerIsRejected(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule(
        "server/src/contextEngineV2/domian/leak.ts",
        'import type { Finding } from "../contracts/evidence.js";',
      ),
    ],
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.rule, "unknown_layer");
}

function testAllowedPolicyDependenciesPass(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule(
        "server/src/contextEngineV2/policy/accessPolicy.ts",
        [
          'import type { RepositorySnapshot } from "../contracts/repository.js";',
          'import { validateRepositorySnapshot } from "../domain/invariant.js";',
        ].join("\n"),
      ),
    ],
  });
  assert.deepEqual(violations, []);
}

function testTestOnlyLayersAllowTestDependencies(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule(
        "server/src/contextEngineV2/testing/example.smoke.ts",
        'import assert from "node:assert/strict";',
      ),
      fixtureModule(
        "server/src/contextEngineV2/validation/example.smoke.ts",
        'import ts from "typescript";',
      ),
    ],
  });
  assert.deepEqual(violations, []);
}

function testDomainInlineTypeImportFromApplicationIsRejected(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule(
        "server/src/contextEngineV2/domain/leak.ts",
        'type Leak = import("../application/run.js").Runner;',
      ),
    ],
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.rule, "layer_direction");
}

function testDomainInlineTypeImportFromProductionIsRejected(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule(
        "server/src/contextEngineV2/domain/leak.ts",
        'type Leak = import("../../routes/example.js").Route;',
      ),
    ],
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.rule, "core_boundary_escape");
}

function testPolicyInlineTypeImportFromProductionIsRejected(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule(
        "server/src/contextEngineV2/policy/leak.ts",
        'type Leak = import("../../routes/example.js").Route;',
      ),
    ],
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.rule, "core_boundary_escape");
}

function testAllowedInlineTypeImportFromContractsPasses(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule(
        "server/src/contextEngineV2/domain/typeReference.ts",
        'type Snapshot = import("../contracts/repository.js").RepositorySnapshot;',
      ),
    ],
  });
  assert.deepEqual(violations, []);
}

function testAdapterCanImportLegacyScannerContract(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule(
        "server/src/contextEngineV2/adapters/legacyInventory/example.ts",
        'import type { ProjectInventory } from "../../../scanner/projectInventoryScanner.js";',
      ),
    ],
  });
  assert.deepEqual(violations, []);
}

function testAdapterCannotImportScannerSuffixFromEvilDirectory(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule(
        "server/src/contextEngineV2/adapters/legacyInventory/leak.ts",
        'import type { ProjectInventory } from "../../../evil/scanner/projectInventoryScanner.js";',
      ),
    ],
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.rule, "adapter_boundary_escape");
}

function testAdapterCannotImportScannerSuffixOutsideRepository(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule(
        "server/src/contextEngineV2/adapters/legacyInventory/leak.ts",
        'import type { ProjectInventory } from "../../../../../../outside/scanner/projectInventoryScanner.js";',
      ),
    ],
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.rule, "adapter_boundary_escape");
}

function testAdapterCannotImportLegacySelector(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule(
        "server/src/contextEngineV2/adapters/legacyInventory/leak.ts",
        'import { selectTaskFiles } from "../../../ollama/taskFileSelector.js";',
      ),
    ],
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.rule, "forbidden_legacy_dependency");
}

function testTypeScriptExtractorCanImportCompilerApi(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule(
        "server/src/contextEngineV2/adapters/extraction/example.ts",
        'import ts from "typescript";',
      ),
    ],
  });
  assert.deepEqual(violations, []);
}

function testExtractorCannotImportLegacySelector(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule(
        "server/src/contextEngineV2/adapters/extraction/leak.ts",
        'import { selectTaskFiles } from "../../../ollama/taskFileSelector.js";',
      ),
    ],
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.rule, "forbidden_legacy_dependency");
}

function testGraphAdapterCanImportContractsAndPorts(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule(
        "server/src/contextEngineV2/adapters/knowledge/example.ts",
        [
          'import type { FactRecord } from "../../contracts/index.js";',
          'import type { KnowledgeGraphStorePort } from "../../ports/index.js";',
        ].join("\n"),
      ),
    ],
  });
  assert.deepEqual(violations, []);
}

function testDomainCannotImportGraphAdapter(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule(
        "server/src/contextEngineV2/domain/leak.ts",
        'import { createInMemoryKnowledgeGraphStore } from "../adapters/knowledge/index.js";',
      ),
    ],
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.rule, "layer_direction");
}

function testProductionRouteCannotImportGraphAdapter(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule(
        "server/src/routes/example.ts",
        'import { createInMemoryKnowledgeGraphStore } from "../contextEngineV2/adapters/knowledge/index.js";',
      ),
    ],
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.rule, "production_isolation");
}

function testEvidenceLedgerCanImportContracts(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule(
        "server/src/contextEngineV2/domain/evidenceLedger.ts",
        'import type { EvidenceRecord } from "../contracts/evidence.js";',
      ),
    ],
  });
  assert.deepEqual(violations, []);
}

function testStopPolicyCanImportContractsAndDomain(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule(
        "server/src/contextEngineV2/domain/stopPolicy.ts",
        [
          'import type { InvestigationStop } from "../contracts/investigation.js";',
          'import { snapshotInvestigationBudget } from "./investigationBudget.js";',
        ].join("\n"),
      ),
    ],
  });
  assert.deepEqual(violations, []);
}

function testEvidenceLedgerCannotImportKnowledgeAdapter(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule(
        "server/src/contextEngineV2/domain/evidenceLedger.ts",
        'import { createInMemoryKnowledgeGraphStore } from "../adapters/knowledge/index.js";',
      ),
    ],
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.rule, "layer_direction");
}

function testStopPolicyCannotImportRepositoryReaderPort(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule(
        "server/src/contextEngineV2/domain/stopPolicy.ts",
        'import type { RepositoryReaderPort } from "../ports/repositoryReaderPort.js";',
      ),
    ],
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.rule, "layer_direction");
}

function testProductionRouteCannotImportDomainService(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule(
        "server/src/routes/example.ts",
        'import { createStopPolicy } from "../contextEngineV2/domain/stopPolicy.js";',
      ),
    ],
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.rule, "production_isolation");
}

function testDomainServiceCannotImportLegacySelector(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule(
        "server/src/contextEngineV2/domain/evidenceLedger.ts",
        'import { selectTaskFiles } from "../../ollama/taskFileSelector.js";',
      ),
    ],
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.rule, "forbidden_legacy_dependency");
}

testCurrentArchitecturePasses();
testLayerDirectionViolationIsDetected();
testProductionImportIsDetected();
testAllowedApplicationDependenciesPass();
testPolicyCannotImportProductionRoute();
testUnknownLayerIsRejected();
testAllowedPolicyDependenciesPass();
testTestOnlyLayersAllowTestDependencies();
testDomainInlineTypeImportFromApplicationIsRejected();
testDomainInlineTypeImportFromProductionIsRejected();
testPolicyInlineTypeImportFromProductionIsRejected();
testAllowedInlineTypeImportFromContractsPasses();
testAdapterCanImportLegacyScannerContract();
testAdapterCannotImportScannerSuffixFromEvilDirectory();
testAdapterCannotImportScannerSuffixOutsideRepository();
testAdapterCannotImportLegacySelector();
testTypeScriptExtractorCanImportCompilerApi();
testExtractorCannotImportLegacySelector();
testGraphAdapterCanImportContractsAndPorts();
testDomainCannotImportGraphAdapter();
testProductionRouteCannotImportGraphAdapter();
testEvidenceLedgerCanImportContracts();
testStopPolicyCanImportContractsAndDomain();
testEvidenceLedgerCannotImportKnowledgeAdapter();
testStopPolicyCannotImportRepositoryReaderPort();
testProductionRouteCannotImportDomainService();
testDomainServiceCannotImportLegacySelector();
console.log("Context Engine v2 architecture smoke passed: 27 scenarios.");
