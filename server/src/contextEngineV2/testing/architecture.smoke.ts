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
console.log("Context Engine v2 architecture smoke passed: 12 scenarios.");
