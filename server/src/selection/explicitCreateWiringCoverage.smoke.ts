import assert from "node:assert/strict";
import path from "node:path";

import type {
  ProjectInventory,
  ProjectInventoryFile,
} from "../scanner/projectInventoryScanner.js";
import { verifyExplicitCreateWiringCoverage } from "./explicitCreateWiringCoverage.js";

function sourceFile(pathValue: string): ProjectInventoryFile {
  const name = path.basename(pathValue);
  return {
    path: pathValue,
    name,
    extension: path.extname(name).toLowerCase(),
    kind: "source",
    role: pathValue.endsWith("Page.tsx") ? "page" : "component",
    imports: [],
    exports: [],
    symbols: [],
    textHints: [],
    sizeBytes: 1000,
    depth: pathValue.split("/").length,
    canReadText: true,
    isLikelyGenerated: false,
  };
}

function inventory(paths: string[]): ProjectInventory {
  return {
    rootPath: "C:/fixture",
    files: paths.map(sourceFile),
    totalFiles: paths.length,
    scannedFiles: paths.length,
    truncated: false,
    notes: [],
  };
}

function selected(pathValue: string, usage: string) {
  return { path: pathValue, usage };
}

function testCompleteCreateAndWiring() {
  const result = verifyExplicitCreateWiringCoverage({
    rawTask:
      "Create src/components/StatusBadge.tsx and render it in src/pages/GameDetailsPage.tsx.",
    inventory: inventory(["src/pages/GameDetailsPage.tsx"]),
    selectedFiles: [
      selected("src/components/StatusBadge.tsx", "create-and-edit"),
      selected("src/pages/GameDetailsPage.tsx", "inspect-and-edit"),
    ],
  });

  assert.equal(result.status, "complete");
  assert.equal(result.requirements.length, 2);
  assert.deepEqual(result.gaps, []);
}

function testMissingWiringSelectionIsIncomplete() {
  const result = verifyExplicitCreateWiringCoverage({
    rawTask:
      "Create src/components/StatusBadge.tsx and render it in src/pages/GameDetailsPage.tsx.",
    inventory: inventory(["src/pages/GameDetailsPage.tsx"]),
    selectedFiles: [
      selected("src/components/StatusBadge.tsx", "create-and-edit"),
    ],
  });

  assert.equal(result.status, "incomplete");
  assert.equal(result.gaps[0]?.path, "src/pages/GameDetailsPage.tsx");
}

function testAbsentNamedWiringTargetIsIncomplete() {
  const result = verifyExplicitCreateWiringCoverage({
    rawTask:
      "Create src/components/StatusBadge.tsx and render it in src/pages/MissingPage.tsx.",
    inventory: inventory([]),
    selectedFiles: [
      selected("src/components/StatusBadge.tsx", "create-and-edit"),
    ],
  });

  assert.equal(result.status, "incomplete");
  assert.equal(result.gaps[0]?.reason.includes("absent"), true);
}

function testProtectedReferenceDoesNotBecomeWiringTarget() {
  const result = verifyExplicitCreateWiringCoverage({
    rawTask:
      "Create src/components/StatusBadge.tsx and render it in src/pages/GameDetailsPage.tsx. Use src/api/client.ts only as an API reference; do not modify it.",
    inventory: inventory([
      "src/pages/GameDetailsPage.tsx",
      "src/api/client.ts",
    ]),
    selectedFiles: [
      selected("src/components/StatusBadge.tsx", "create-and-edit"),
      selected("src/pages/GameDetailsPage.tsx", "inspect-and-edit"),
      selected("src/api/client.ts", "inspect-only"),
    ],
  });

  assert.equal(result.status, "complete");
  assert.equal(
    result.requirements.some((item) => item.path === "src/api/client.ts"),
    false,
  );
}

function testCreateWithoutExplicitDestinationIsNotApplicable() {
  const result = verifyExplicitCreateWiringCoverage({
    rawTask: "Create StatusBadge.tsx and render it in GameDetailsPage.tsx.",
    inventory: inventory(["src/pages/GameDetailsPage.tsx"]),
    selectedFiles: [],
  });

  assert.equal(result.status, "not-applicable");
}

function testExplicitCreateWithoutWiringIsNotApplicable() {
  const result = verifyExplicitCreateWiringCoverage({
    rawTask: "Create src/components/StatusBadge.tsx.",
    inventory: inventory([]),
    selectedFiles: [
      selected("src/components/StatusBadge.tsx", "create-and-edit"),
    ],
  });

  assert.equal(result.status, "not-applicable");
}

function testAmbiguousWiringFilenameIsIncomplete() {
  const result = verifyExplicitCreateWiringCoverage({
    rawTask:
      "Create src/components/StatusBadge.tsx and render it in DetailsPage.tsx.",
    inventory: inventory([
      "src/pages/DetailsPage.tsx",
      "src/admin/DetailsPage.tsx",
    ]),
    selectedFiles: [
      selected("src/components/StatusBadge.tsx", "create-and-edit"),
      selected("src/pages/DetailsPage.tsx", "inspect-and-edit"),
    ],
  });

  assert.equal(result.status, "incomplete");
  assert.equal(result.gaps[0]?.reason.includes("more than one"), true);
}

function testRussianCreateAndWiring() {
  const result = verifyExplicitCreateWiringCoverage({
    rawTask:
      "Создай src/components/StatusBadge.tsx и подключи его в src/pages/GameDetailsPage.tsx.",
    inventory: inventory(["src/pages/GameDetailsPage.tsx"]),
    selectedFiles: [
      selected("src/components/StatusBadge.tsx", "create-and-edit"),
      selected("src/pages/GameDetailsPage.tsx", "inspect-and-edit"),
    ],
  });

  assert.equal(result.status, "complete");
}

function main() {
  testCompleteCreateAndWiring();
  testMissingWiringSelectionIsIncomplete();
  testAbsentNamedWiringTargetIsIncomplete();
  testProtectedReferenceDoesNotBecomeWiringTarget();
  testCreateWithoutExplicitDestinationIsNotApplicable();
  testExplicitCreateWithoutWiringIsNotApplicable();
  testAmbiguousWiringFilenameIsIncomplete();
  testRussianCreateAndWiring();
  console.log("explicit create+wiring coverage smoke passed: 8 scenarios");
}

main();
