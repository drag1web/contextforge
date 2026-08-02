import assert from "node:assert/strict";
import fs from "node:fs";
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

function testTestingLayerAllowsTestDependencies(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule(
        "server/src/contextEngineV2/testing/example.smoke.ts",
        'import assert from "node:assert/strict";',
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

function testInvestigationRunnerCanImportCoreBoundaries(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule(
        "server/src/contextEngineV2/application/investigationRunner.ts",
        [
          'import type { FactRecord } from "../contracts/index.js";',
          'import { createStopPolicy } from "../domain/index.js";',
          'import type { RepositoryReaderPort } from "../ports/index.js";',
        ].join("\n"),
      ),
    ],
  });
  assert.deepEqual(violations, []);
}

function testInterpreterCanImportContractsAndDomain(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule(
        "server/src/contextEngineV2/application/deterministicInvestigationInterpreter.ts",
        [
          'import type { InvestigationRequest } from "../contracts/index.js";',
          'import { assertValidInvestigationRequest } from "../domain/index.js";',
        ].join("\n"),
      ),
    ],
  });
  assert.deepEqual(violations, []);
}

function testInterpreterCannotImportLegacyTaskUnderstandingImplementation(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule(
        "server/src/contextEngineV2/application/deterministicInvestigationInterpreter.ts",
        'import { understand } from "../../understanding/taskUnderstanding.js";',
      ),
    ],
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.rule, "core_boundary_escape");
}

function testPlannerCanImportContractsAndDomain(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule(
        "server/src/contextEngineV2/application/deterministicInvestigationPlanner.ts",
        [
          'import type { InvestigationOperation } from "../contracts/index.js";',
          'import { evaluateEvidenceRequirement } from "../domain/index.js";',
        ].join("\n"),
      ),
    ],
  });
  assert.deepEqual(violations, []);
}

function testPlannerCannotImportConcreteRepositoryAdapter(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule(
        "server/src/contextEngineV2/application/deterministicInvestigationPlanner.ts",
        'import { createLegacyInventorySnapshotPort } from "../adapters/index.js";',
      ),
    ],
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.rule, "layer_direction");
}

function testDomainCannotImportInvestigationRunner(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule(
        "server/src/contextEngineV2/domain/leak.ts",
        'import { createInvestigationRunner } from "../application/investigationRunner.js";',
      ),
    ],
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.rule, "layer_direction");
}

function testProductionRouteCannotImportInvestigationRunner(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule(
        "server/src/routes/example.ts",
        'import { createInvestigationRunner } from "../contextEngineV2/application/investigationRunner.js";',
      ),
    ],
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.rule, "production_isolation");
}

function testProductionServiceCannotImportInterpreter(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule(
        "server/src/services/example.ts",
        'import { createDeterministicInvestigationInterpreter } from "../contextEngineV2/application/index.js";',
      ),
    ],
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.rule, "production_isolation");
}

function testLegacySelectorCannotImportInvestigationRunner(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule(
        "server/src/ollama/taskFileSelector.ts",
        'import { createInvestigationRunner } from "../contextEngineV2/application/investigationRunner.js";',
      ),
    ],
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.rule, "production_isolation");
}

function testRunnerCannotImportProductOrUiLayers(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule(
        "server/src/contextEngineV2/application/investigationRunner.ts",
        [
          'import { compose } from "../../contextComposer/example.js";',
          'import { generate } from "../../taskPacks/example.js";',
          'import { render } from "../../../../../apps/desktop/renderer/src/example.js";',
        ].join("\n"),
      ),
    ],
  });
  assert.equal(violations.length, 3);
  assert.ok(violations.every((violation) => violation.rule === "core_boundary_escape"));
}

function testTestingRepositoryAdapterCanImportPortsAndContracts(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule(
        "server/src/contextEngineV2/testing/inMemoryRepositoryInvestigationAdapter.ts",
        [
          'import type { RepositorySnapshot } from "../contracts/index.js";',
          'import type { RepositoryReaderPort } from "../ports/index.js";',
        ].join("\n"),
      ),
    ],
  });
  assert.deepEqual(violations, []);
}

function testTransactionTestAdapterCanImportGraphPortAndContracts(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule(
        "server/src/contextEngineV2/testing/atomicKnowledgeGraphFixture.ts",
        [
          'import type { FactRecord } from "../contracts/index.js";',
          'import type { KnowledgeGraphStorePort } from "../ports/index.js";',
        ].join("\n"),
      ),
    ],
  });
  assert.deepEqual(violations, []);
}

function testProductFacingFacadeRemainsNotImplemented(): void {
  const servicePath = path.join(
    repositoryRoot,
    "server",
    "src",
    "contextEngineV2",
    "application",
    "contextEngineService.ts",
  );
  const source = fs.readFileSync(servicePath, "utf8");
  assert.equal(source.includes("createInvestigationRunner"), false);
  assert.equal(source.includes("investigationRunner"), false);
  assert.equal(source.includes("ContextEngineNotImplementedError"), true);
}

function testApplicationProjectionCannotImportLegacyContracts(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule(
        "server/src/contextEngineV2/application/contextProjectionService.ts",
        'import type { TaskFileSelection } from "../../ollama/taskFileSelector.js";',
      ),
      fixtureModule(
        "server/src/contextEngineV2/application/contextProjectionService.ts",
        'import type { ProjectInventory } from "../../scanner/projectInventoryScanner.js";',
      ),
    ],
  });
  assert.equal(violations.length, 2);
  assert.ok(violations.every((violation) => violation.rule === "core_boundary_escape" || violation.rule === "forbidden_legacy_dependency"));
}

function testLegacySelectionAdapterCanImportOnlyAllowedContractTypes(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule(
        "server/src/contextEngineV2/adapters/legacySelection/projection.ts",
        [
          'import type { TaskFileSelection, SelectedTaskFileUsage } from "../../../ollama/taskFileSelector.js";',
          'import type { ProjectInventoryFileKind } from "../../../scanner/projectInventoryScanner.js";',
        ].join("\n"),
      ),
    ],
  });
  assert.deepEqual(violations, []);
}

function testLegacySelectionAdapterCannotImportSelectorHelpers(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule(
        "server/src/contextEngineV2/adapters/legacySelection/leak.ts",
        'import { selectTaskFiles } from "../../../ollama/taskFileSelector.js";',
      ),
      fixtureModule(
        "server/src/contextEngineV2/adapters/legacySelection/typeLeak.ts",
        'import type { SelectorSelectionOptions } from "../../../ollama/taskFileSelector.js";',
      ),
    ],
  });
  assert.equal(violations.length, 2);
  assert.ok(violations.every((violation) => violation.rule === "forbidden_legacy_dependency"));
}

function testProductionClientsCannotImportProjection(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule(
        "server/src/ollama/taskFileSelector.ts",
        'import { createContextProjectionService } from "../contextEngineV2/application/index.js";',
      ),
      fixtureModule(
        "server/src/routes/example.ts",
        'import { createContextProjectionService } from "../contextEngineV2/application/index.js";',
      ),
      fixtureModule(
        "server/src/contextComposer/example.ts",
        'import { createLegacyTaskFileSelectionProjection } from "../contextEngineV2/adapters/index.js";',
      ),
    ],
  });
  assert.equal(violations.length, 3);
  assert.ok(violations.every((violation) => violation.rule === "production_isolation"));
}

function testDomainCannotImportProjectionOrLegacyAdapter(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule(
        "server/src/contextEngineV2/domain/leak.ts",
        [
          'import { createContextProjectionService } from "../application/contextProjectionService.js";',
          'import { createLegacyTaskFileSelectionProjection } from "../adapters/legacySelection/index.js";',
        ].join("\n"),
      ),
    ],
  });
  assert.equal(violations.length, 2);
  assert.ok(violations.every((violation) => violation.rule === "layer_direction"));
}

function testValidationCanImportOfflineBoundaries(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [fixtureModule(
      "server/src/contextEngineV2/validation/offline.ts",
      [
        'import type { InvestigationRunnerResult } from "../application/index.js";',
        'import { createLegacyTaskFileSelectionProjection } from "../adapters/index.js";',
        'import { writeFile } from "node:fs/promises";',
      ].join("\n"),
    )],
  });
  assert.deepEqual(violations, []);
}

function testCoreCannotImportValidation(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [fixtureModule(
      "server/src/contextEngineV2/application/leak.ts",
      'import { runValidation } from "../validation/index.js";',
    )],
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.rule, "layer_direction");
}

function testValidationCannotImportProductionOrSelector(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule(
        "server/src/contextEngineV2/validation/routeLeak.ts",
        'import { route } from "../../routes/example.js";',
      ),
      fixtureModule(
        "server/src/contextEngineV2/validation/selectorLeak.ts",
        'import { selectTaskFiles } from "../../ollama/taskFileSelector.js";',
      ),
    ],
  });
  assert.equal(violations.length, 2);
  assert.ok(violations.every((violation) =>
    violation.rule === "adapter_boundary_escape" || violation.rule === "forbidden_legacy_dependency"));
}

function testTaskPackRouteCanImportOnlyPublicShadowFacade(): void {
  const allowed = evaluateArchitectureImports({
    repositoryRoot,
    modules: [fixtureModule(
      "server/src/routes/taskPacks.ts",
      'import { runLiveContextEngineShadow } from "../contextEngineV2/shadow/index.js";',
    )],
  });
  assert.deepEqual(allowed, []);
  const forbidden = evaluateArchitectureImports({
    repositoryRoot,
    modules: [fixtureModule(
      "server/src/routes/taskPacks.ts",
      'import { createInvestigationRunner } from "../contextEngineV2/application/index.js";',
    )],
  });
  assert.equal(forbidden[0]?.rule, "production_isolation");
}

function testShadowCannotImportValidationOrProductAssembly(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule(
        "server/src/contextEngineV2/shadow/validationLeak.ts",
        'import { runValidation } from "../validation/index.js";',
      ),
      fixtureModule(
        "server/src/contextEngineV2/shadow/promptLeak.ts",
        'import { buildPrompt } from "../../routes/taskPacks.js";',
      ),
    ],
  });
  assert.equal(violations.length, 2);
  assert.ok(violations.every((violation) =>
    violation.rule === "layer_direction" || violation.rule === "adapter_boundary_escape"));
}

function testCoreAndSelectorCannotImportShadow(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule(
        "server/src/contextEngineV2/application/leak.ts",
        'import { runLiveContextEngineShadow } from "../shadow/index.js";',
      ),
      fixtureModule(
        "server/src/selection/selectorLeak.ts",
        'import { runLiveContextEngineShadow } from "../contextEngineV2/shadow/index.js";',
      ),
    ],
  });
  assert.equal(violations.length, 2);
  assert.equal(violations[0]?.rule, "layer_direction");
  assert.equal(violations[1]?.rule, "production_isolation");
}

function testContextComposerCanImportOnlyComposerFacade(): void {
  const allowed = evaluateArchitectureImports({
    repositoryRoot,
    modules: [fixtureModule(
      "server/src/contextComposer/contextComposerService.ts",
      'import { resolveContextComposerEngine } from "../contextEngineV2/composer/index.js";',
    )],
  });
  assert.deepEqual(allowed, []);
  const forbidden = evaluateArchitectureImports({
    repositoryRoot,
    modules: [fixtureModule(
      "server/src/contextComposer/contextComposerService.ts",
      'import { createInvestigationRunner } from "../contextEngineV2/application/index.js";',
    )],
  });
  assert.equal(forbidden[0]?.rule, "production_isolation");
}

function testComposerCannotImportShadowValidationOrSelector(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule("server/src/contextEngineV2/composer/shadowLeak.ts", 'import { run } from "../shadow/index.js";'),
      fixtureModule("server/src/contextEngineV2/composer/validationLeak.ts", 'import { run } from "../validation/index.js";'),
      fixtureModule("server/src/contextEngineV2/composer/selectorLeak.ts", 'import { run } from "../../ollama/taskFileSelector.js";'),
    ],
  });
  assert.equal(violations.length, 3);
  assert.ok(violations.every((violation) => violation.rule === "layer_direction" || violation.rule === "forbidden_legacy_dependency"));
}

function testComposerCanUseNeutralLiveFacade(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [fixtureModule(
      "server/src/contextEngineV2/composer/runtime.ts",
      'import { createLiveContextEngineExecution } from "../facade/liveContextEngineRuntime.js";',
    )],
  });
  assert.deepEqual(violations, []);
}

function testCoreAndSelectorCannotImportComposer(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule("server/src/contextEngineV2/application/leak.ts", 'import { run } from "../composer/index.js";'),
      fixtureModule("server/src/selection/leak.ts", 'import { run } from "../contextEngineV2/composer/index.js";'),
    ],
  });
  assert.equal(violations.length, 2);
  assert.equal(violations[0]?.rule, "layer_direction");
  assert.equal(violations[1]?.rule, "production_isolation");
}

testCurrentArchitecturePasses();
testLayerDirectionViolationIsDetected();
testProductionImportIsDetected();
testAllowedApplicationDependenciesPass();
testPolicyCannotImportProductionRoute();
testUnknownLayerIsRejected();
testAllowedPolicyDependenciesPass();
testTestingLayerAllowsTestDependencies();
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
testInvestigationRunnerCanImportCoreBoundaries();
testInterpreterCanImportContractsAndDomain();
testInterpreterCannotImportLegacyTaskUnderstandingImplementation();
testPlannerCanImportContractsAndDomain();
testPlannerCannotImportConcreteRepositoryAdapter();
testDomainCannotImportInvestigationRunner();
testProductionRouteCannotImportInvestigationRunner();
testProductionServiceCannotImportInterpreter();
testLegacySelectorCannotImportInvestigationRunner();
testRunnerCannotImportProductOrUiLayers();
testTestingRepositoryAdapterCanImportPortsAndContracts();
testTransactionTestAdapterCanImportGraphPortAndContracts();
testProductFacingFacadeRemainsNotImplemented();
testApplicationProjectionCannotImportLegacyContracts();
testLegacySelectionAdapterCanImportOnlyAllowedContractTypes();
testLegacySelectionAdapterCannotImportSelectorHelpers();
testProductionClientsCannotImportProjection();
testDomainCannotImportProjectionOrLegacyAdapter();
testValidationCanImportOfflineBoundaries();
testCoreCannotImportValidation();
testValidationCannotImportProductionOrSelector();
testTaskPackRouteCanImportOnlyPublicShadowFacade();
testShadowCannotImportValidationOrProductAssembly();
testCoreAndSelectorCannotImportShadow();
testContextComposerCanImportOnlyComposerFacade();
testComposerCannotImportShadowValidationOrSelector();
testComposerCanUseNeutralLiveFacade();
testCoreAndSelectorCannotImportComposer();
console.log("Context Engine v2 architecture smoke passed: 55 scenarios.");
