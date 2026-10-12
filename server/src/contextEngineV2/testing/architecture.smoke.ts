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

function testTaskPackRouteCanImportOnlyPublicCanaryFacade(): void {
  const allowed = evaluateArchitectureImports({
    repositoryRoot,
    modules: [fixtureModule(
      "server/src/routes/taskPacks.ts",
      'import { runLiveTaskPackCanary } from "../contextEngineV2/canary/index.js";',
    )],
  });
  assert.deepEqual(allowed, []);
}

function testCanaryCanReuseNeutralRuntimeAndShadowCanonicalBoundary(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [fixtureModule(
      "server/src/contextEngineV2/canary/runtime.ts",
      [
        'import { createLiveContextEngineExecution } from "../facade/liveContextEngineRuntime.js";',
        'import { assertContextEngineShadowInputEquivalent } from "../shadow/index.js";',
        'import { createLegacyTaskFileSelectionProjection } from "../adapters/legacySelection/index.js";',
      ].join("\n"),
    )],
  });
  assert.deepEqual(violations, []);
}

function testCanaryCannotImportProductComposerOrValidation(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule("server/src/contextEngineV2/canary/routeLeak.ts", 'import { route } from "../../routes/taskPacks.js";'),
      fixtureModule("server/src/contextEngineV2/canary/composerLeak.ts", 'import { run } from "../composer/index.js";'),
      fixtureModule("server/src/contextEngineV2/canary/validationLeak.ts", 'import { run } from "../validation/index.js";'),
    ],
  });
  assert.equal(violations.length, 3);
  assert.ok(violations.every((violation) => violation.rule === "adapter_boundary_escape" || violation.rule === "layer_direction"));
}

function testCoreAndSelectorCannotImportCanary(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule("server/src/contextEngineV2/application/leak.ts", 'import { run } from "../canary/index.js";'),
      fixtureModule("server/src/selection/leak.ts", 'import { run } from "../contextEngineV2/canary/index.js";'),
    ],
  });
  assert.equal(violations.length, 2);
  assert.equal(violations[0]?.rule, "layer_direction");
  assert.equal(violations[1]?.rule, "production_isolation");
}

function testPlannerCompositionCanUseApplicationPortAndAdapter(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [fixtureModule(
      "server/src/contextEngineV2/planner/assembly.ts",
      [
        'import type { InvestigationPlanner } from "../application/index.js";',
        'import type { ModelPlannerPort } from "../ports/index.js";',
        'import { createConfiguredAiModelPlannerAdapter } from "../adapters/modelPlanner/index.js";',
      ].join("\n"),
    )],
  });
  assert.deepEqual(violations, []);
}

function testModelAdapterMayUseOnlyApprovedProviderBoundary(): void {
  const allowed = evaluateArchitectureImports({
    repositoryRoot,
    modules: [fixtureModule(
      "server/src/contextEngineV2/adapters/modelPlanner/provider.ts",
      'import { generateWithConfiguredAi } from "../../../ai/providerService.js";',
    )],
  });
  assert.deepEqual(allowed, []);
  const forbidden = evaluateArchitectureImports({
    repositoryRoot,
    modules: [fixtureModule(
      "server/src/contextEngineV2/adapters/modelPlanner/routeLeak.ts",
      'import { route } from "../../../routes/taskPacks.js";',
    )],
  });
  assert.equal(forbidden[0]?.rule, "adapter_boundary_escape");
}

function testDomainAndProjectionCannotImportModelPlanner(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule("server/src/contextEngineV2/domain/leak.ts", 'import { planner } from "../planner/index.js";'),
      fixtureModule("server/src/contextEngineV2/application/contextProjectionService.ts", 'import { planner } from "../planner/index.js";'),
    ],
  });
  assert.equal(violations.length, 2);
  assert.ok(violations.every((violation) => violation.rule === "layer_direction"));
}

function testCanaryCannotImportModelPlanner(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [fixtureModule(
      "server/src/contextEngineV2/canary/leak.ts",
      'import { createModelAssistedInvestigationPlanner } from "../planner/index.js";',
    )],
  });
  assert.equal(violations[0]?.rule, "layer_direction");
}

function testTaskPackRouteCannotImportModelPlanner(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [fixtureModule(
      "server/src/routes/taskPacks.ts",
      'import { createModelAssistedInvestigationPlanner } from "../contextEngineV2/planner/index.js";',
    )],
  });
  assert.equal(violations[0]?.rule, "production_isolation");
}

function testShadowAndComposerMayUsePlannerModeOnly(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule("server/src/contextEngineV2/shadow/mode.ts", 'import { plannerModeForIdentifier } from "../planner/plannerMode.js";'),
      fixtureModule("server/src/contextEngineV2/composer/mode.ts", 'import { plannerModeForIdentifier } from "../planner/plannerMode.js";'),
    ],
  });
  assert.deepEqual(violations, []);
}

function testValidationCannotImportOnlineProvider(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [fixtureModule(
      "server/src/contextEngineV2/validation/onlineLeak.ts",
      'import { generateWithConfiguredAi } from "../../ai/providerService.js";',
    )],
  });
  assert.equal(violations[0]?.rule, "adapter_boundary_escape");
}

function testTaskPackRouteCanImportPrimaryRetirementFacade(): void {
  assert.deepEqual(evaluateArchitectureImports({
    repositoryRoot,
    modules: [fixtureModule("server/src/routes/taskPacks.ts", 'import { runLiveTaskPackPrimary } from "../contextEngineV2/retirement/index.js";')],
  }), []);
}

function testExternalValidationCommandHasNarrowCompositionAccess(): void {
  assert.deepEqual(evaluateArchitectureImports({
    repositoryRoot,
    modules: [fixtureModule("server/src/commands/contextEngineExternalRetirementHarness.ts", [
      'import { prepareBoundedTaskPackCanaryInput } from "../contextEngineV2/canary/index.js";',
      'import { runLiveTaskPackPrimary } from "../contextEngineV2/retirement/index.js";',
      'import { prepareContextEngineShadowInput } from "../contextEngineV2/shadow/index.js";',
      'import { createExternalRetirementReport } from "../contextEngineV2/validation/index.js";',
    ].join("\n"))],
  }), []);
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [fixtureModule("server/src/commands/unrelated.ts", 'import { runLiveTaskPackPrimary } from "../contextEngineV2/retirement/index.js";')],
  });
  assert.equal(violations[0]?.rule, "production_isolation");
}

function testRetirementCanUseOnlyNeutralPrimaryBoundaries(): void {
  assert.deepEqual(evaluateArchitectureImports({
    repositoryRoot,
    modules: [fixtureModule("server/src/contextEngineV2/retirement/runtime.ts", [
      'import { createContextProjectionService } from "../application/index.js";',
      'import { createLegacyTaskFileSelectionProjection } from "../adapters/legacySelection/index.js";',
      'import { createLiveContextEngineExecution } from "../facade/liveContextEngineRuntime.js";',
      'import { assertContextEngineShadowInputEquivalent } from "../shadow/index.js";',
    ].join("\n"))],
  }), []);
}

function testRetirementCannotImportProductValidationOrModelPlanner(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule("server/src/contextEngineV2/retirement/routeLeak.ts", 'import { route } from "../../routes/taskPacks.js";'),
      fixtureModule("server/src/contextEngineV2/retirement/validationLeak.ts", 'import { run } from "../validation/index.js";'),
      fixtureModule("server/src/contextEngineV2/retirement/modelLeak.ts", 'import { model } from "../planner/index.js";'),
    ],
  });
  assert.equal(violations.length, 3);
}

function testCoreSelectorCannotImportRetirement(): void {
  const violations = evaluateArchitectureImports({
    repositoryRoot,
    modules: [
      fixtureModule("server/src/contextEngineV2/application/leak.ts", 'import { run } from "../retirement/index.js";'),
      fixtureModule("server/src/selection/leak.ts", 'import { run } from "../contextEngineV2/retirement/index.js";'),
    ],
  });
  assert.equal(violations.length, 2);
  assert.equal(violations[0]?.rule, "layer_direction");
  assert.equal(violations[1]?.rule, "production_isolation");
}

function testAssemblyArchitectureBoundaries(): void {
  const assembly = "server/src/contextEngineV2/assembly/productionInvestigationRunner.ts";
  let positive = 0, negative = 0;
  function accepted(name: string, file: string, source: string): void {
    assert.deepEqual(evaluateArchitectureImports({ repositoryRoot, modules: [fixtureModule(file, source)] }), [], name);
    positive++;
    console.log(`PASS assembly positive: ${name}`);
  }
  function rejected(name: string, file: string, source: string, rule: string, importPath: string): void {
    const violations = evaluateArchitectureImports({ repositoryRoot, modules: [fixtureModule(file, source)] });
    assert.equal(violations.length, 1, name);
    assert.equal(violations[0].rule, rule, name);
    assert.equal(violations[0].importPath, importPath, name);
    assert.equal(violations[0].filePath, path.join(repositoryRoot, ...file.split("/")), name);
    negative++;
    console.log(`PASS assembly negative: ${name} (${rule})`);
  }
  accepted("facade delegates to specific assembly", "server/src/contextEngineV2/facade/liveContextEngineRuntime.ts",
    'import { createProductionInvestigationRunner } from "../assembly/productionInvestigationRunner.js";');
  accepted("assembly uses actual application runner", assembly,
    'import { createInvestigationRunner } from "../application/investigationRunner.js";');
  accepted("assembly uses real registry and graph factories", assembly,
    'import { createFactExtractorRegistry } from "../adapters/extraction/factExtractorRegistry.js"; import { createInMemoryKnowledgeGraphStore } from "../adapters/knowledge/inMemoryKnowledgeGraphStore.js";');
  accepted("assembly uses contracts and domain", assembly,
    'import type { SnapshotId } from "../contracts/index.js"; import { validateRepositorySnapshot } from "../domain/invariant.js";');
  accepted("assembly uses port and application types", assembly,
    'import type { FactExtractorPort } from "../ports/factExtractorPort.js"; import type { InvestigationRunner } from "../application/investigationRunnerTypes.js";');
  accepted("exact named native import", assembly, 'import { isProxy } from "node:util/types";');
  accepted("named binding alias keeps same native capability", assembly, 'import { isProxy as detectProxy } from "node:util/types";');

  rejected("facade self dependency still forbidden", "server/src/contextEngineV2/facade/other.ts",
    'import { runtime } from "./liveContextEngineRuntime.js";', "layer_direction", "./liveContextEngineRuntime.js");
  rejected("facade native import still forbidden", "server/src/contextEngineV2/facade/other.ts",
    'import { isProxy } from "node:util/types";', "core_external_dependency", "node:util/types");
  for (const file of ["server/src/contextEngineV2/assembly/other.ts", "server/src/contextEngineV2/assembly/productionInvestigationRunnerExtra.ts",
    "server/src/contextEngineV2/assembly/nested/productionInvestigationRunner.ts"]) {
    rejected(`exact module exception rejects ${file}`, file, 'import { isProxy } from "node:util/types";', "core_external_dependency", "node:util/types");
  }
  for (const external of ["node:fs", "node:fs/promises", "node:child_process", "node:worker_threads", "node:crypto", "node:path", "typescript", "arbitrary-package"]) {
    rejected(`assembly external ${external}`, assembly, `import { value } from "${external}";`, "core_external_dependency", external);
  }
  for (const layer of ["facade", "planner", "shadow", "retirement", "validation", "composer", "canary", "testing", "assembly"]) {
    const target = `../${layer}/index.js`;
    rejected(`assembly cannot import ${layer}`, assembly, `import { value } from "${target}";`, "layer_direction", target);
  }
  for (const form of [
    'import { isProxy, isDate } from "node:util/types";',
    'import { isProxy, type Extra } from "node:util/types";',
    'import * as types from "node:util/types";',
    'import types from "node:util/types";',
    'import types, { isProxy } from "node:util/types";',
    'import "node:util/types";',
    'import type { isProxy } from "node:util/types";',
    'export { isProxy } from "node:util/types";',
    'const types = import("node:util/types");',
    'const types = import("node:util/types", { with: { type: "json" } });',
    'const types = require("node:util/types");',
    'const types = (require)("node:util/types");',
    'const types = module.require("node:util/types");',
    'import types = require("node:util/types");',
  ]) rejected(`native shape rejected: ${form}`, assembly, form, "core_external_dependency", "node:util/types");
  for (const form of ['const types = import(target);', 'const types = require(target);', 'const types = import("node:" + "util/types");'])
    rejected(`unresolved load rejected: ${form}`, assembly, form, "core_external_dependency", "<dynamic-load>");
  rejected("assembly cannot leave CE2 for routes", assembly, 'import { route } from "../../routes/taskPacks.js";', "core_boundary_escape", "../../routes/taskPacks.js");
  rejected("assembly cannot use adapter scanner exception", assembly, 'import type { ProjectInventory } from "../../scanner/projectInventoryScanner.js";',
    "core_boundary_escape", "../../scanner/projectInventoryScanner.js");
  rejected("assembly cannot use legacy selector exception", assembly, 'import type { TaskFileSelection } from "../../ollama/taskFileSelector.js";',
    "forbidden_legacy_dependency", "../../ollama/taskFileSelector.js");
  rejected("outside product cannot import internal assembly", "server/src/routes/assemblyLeak.ts",
    'import { createProductionInvestigationRunner } from "../contextEngineV2/assembly/productionInvestigationRunner.js";',
    "production_isolation", "../contextEngineV2/assembly/productionInvestigationRunner.js");
  rejected("unknown layers remain rejected", "server/src/contextEngineV2/unknownLayer/module.ts",
    'import { value } from "../assembly/productionInvestigationRunner.js";', "unknown_layer", "<module>");
  assert.deepEqual(scanContextEngineV2Architecture(repositoryRoot), []);
  positive++;
  console.log(`Assembly architecture smoke passed: ${positive} positive + ${negative} negative scenarios.`);
}

let originalScenarios = 0;
function runOriginal(test: () => void): void { test(); originalScenarios++; }
runOriginal(testCurrentArchitecturePasses);
runOriginal(testLayerDirectionViolationIsDetected);
runOriginal(testProductionImportIsDetected);
runOriginal(testAllowedApplicationDependenciesPass);
runOriginal(testPolicyCannotImportProductionRoute);
runOriginal(testUnknownLayerIsRejected);
runOriginal(testAllowedPolicyDependenciesPass);
runOriginal(testTestingLayerAllowsTestDependencies);
runOriginal(testDomainInlineTypeImportFromApplicationIsRejected);
runOriginal(testDomainInlineTypeImportFromProductionIsRejected);
runOriginal(testPolicyInlineTypeImportFromProductionIsRejected);
runOriginal(testAllowedInlineTypeImportFromContractsPasses);
runOriginal(testAdapterCanImportLegacyScannerContract);
runOriginal(testAdapterCannotImportScannerSuffixFromEvilDirectory);
runOriginal(testAdapterCannotImportScannerSuffixOutsideRepository);
runOriginal(testAdapterCannotImportLegacySelector);
runOriginal(testTypeScriptExtractorCanImportCompilerApi);
runOriginal(testExtractorCannotImportLegacySelector);
runOriginal(testGraphAdapterCanImportContractsAndPorts);
runOriginal(testDomainCannotImportGraphAdapter);
runOriginal(testProductionRouteCannotImportGraphAdapter);
runOriginal(testEvidenceLedgerCanImportContracts);
runOriginal(testStopPolicyCanImportContractsAndDomain);
runOriginal(testEvidenceLedgerCannotImportKnowledgeAdapter);
runOriginal(testStopPolicyCannotImportRepositoryReaderPort);
runOriginal(testProductionRouteCannotImportDomainService);
runOriginal(testDomainServiceCannotImportLegacySelector);
runOriginal(testInvestigationRunnerCanImportCoreBoundaries);
runOriginal(testInterpreterCanImportContractsAndDomain);
runOriginal(testInterpreterCannotImportLegacyTaskUnderstandingImplementation);
runOriginal(testPlannerCanImportContractsAndDomain);
runOriginal(testPlannerCannotImportConcreteRepositoryAdapter);
runOriginal(testDomainCannotImportInvestigationRunner);
runOriginal(testProductionRouteCannotImportInvestigationRunner);
runOriginal(testProductionServiceCannotImportInterpreter);
runOriginal(testLegacySelectorCannotImportInvestigationRunner);
runOriginal(testRunnerCannotImportProductOrUiLayers);
runOriginal(testTestingRepositoryAdapterCanImportPortsAndContracts);
runOriginal(testTransactionTestAdapterCanImportGraphPortAndContracts);
runOriginal(testProductFacingFacadeRemainsNotImplemented);
runOriginal(testApplicationProjectionCannotImportLegacyContracts);
runOriginal(testLegacySelectionAdapterCanImportOnlyAllowedContractTypes);
runOriginal(testLegacySelectionAdapterCannotImportSelectorHelpers);
runOriginal(testProductionClientsCannotImportProjection);
runOriginal(testDomainCannotImportProjectionOrLegacyAdapter);
runOriginal(testValidationCanImportOfflineBoundaries);
runOriginal(testCoreCannotImportValidation);
runOriginal(testValidationCannotImportProductionOrSelector);
runOriginal(testTaskPackRouteCanImportOnlyPublicShadowFacade);
runOriginal(testShadowCannotImportValidationOrProductAssembly);
runOriginal(testCoreAndSelectorCannotImportShadow);
runOriginal(testContextComposerCanImportOnlyComposerFacade);
runOriginal(testComposerCannotImportShadowValidationOrSelector);
runOriginal(testComposerCanUseNeutralLiveFacade);
runOriginal(testCoreAndSelectorCannotImportComposer);
runOriginal(testTaskPackRouteCanImportOnlyPublicCanaryFacade);
runOriginal(testCanaryCanReuseNeutralRuntimeAndShadowCanonicalBoundary);
runOriginal(testCanaryCannotImportProductComposerOrValidation);
runOriginal(testCoreAndSelectorCannotImportCanary);
runOriginal(testPlannerCompositionCanUseApplicationPortAndAdapter);
runOriginal(testModelAdapterMayUseOnlyApprovedProviderBoundary);
runOriginal(testDomainAndProjectionCannotImportModelPlanner);
runOriginal(testCanaryCannotImportModelPlanner);
runOriginal(testTaskPackRouteCannotImportModelPlanner);
runOriginal(testShadowAndComposerMayUsePlannerModeOnly);
runOriginal(testValidationCannotImportOnlineProvider);
runOriginal(testTaskPackRouteCanImportPrimaryRetirementFacade);
runOriginal(testExternalValidationCommandHasNarrowCompositionAccess);
runOriginal(testRetirementCanUseOnlyNeutralPrimaryBoundaries);
runOriginal(testRetirementCannotImportProductValidationOrModelPlanner);
runOriginal(testCoreSelectorCannotImportRetirement);
console.log(`Context Engine v2 architecture smoke passed: ${originalScenarios} original test functions (including repository scan).`);
testAssemblyArchitectureBoundaries();
