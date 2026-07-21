import assert from "node:assert/strict";

import { buildStoredZipBytes } from "../apps/desktop/renderer/src/utils/validationRunExport.ts";
import {
  buildValidationActualSummary,
  evaluateValidationExpectation,
  parseValidationManifest,
  type ValidationActualSummary,
} from "../apps/desktop/renderer/src/validation/validationManifest.ts";

const manifest = parseValidationManifest(
  JSON.stringify({
    format: "contextforge.validation-manifest",
    version: 1,
    name: "Smoke suite",
    defaults: { taskType: "general", targetTool: "codex" },
    tests: [
      {
        id: "CASE-01",
        task: "Update the exact target file.",
        expect: {
          qualityStatus: "ready",
          selectedPaths: ["src/target.ts"],
          excludedPaths: ["src/protected.ts"],
          authorizedTargets: ["src/target.ts"],
        },
      },
    ],
  }),
);

assert.equal(manifest.tests.length, 1);
assert.equal(manifest.tests[0]?.id, "CASE-01");

assert.throws(
  () =>
    parseValidationManifest(
      JSON.stringify({
        format: "contextforge.validation-manifest",
        version: 1,
        name: "Duplicate suite",
        tests: [
          { id: "same", task: "First task" },
          { id: "SAME", task: "Second task" },
        ],
      }),
    ),
  /Duplicate test id/u,
);

const actual: ValidationActualSummary = {
  understandingReadiness: "ready",
  interactionAction: "continue",
  qualityStatus: "ready",
  qualityScore: 92,
  executionMode: "implementation",
  effectiveTaskArea: "backend",
  selectedPaths: ["src/target.ts", "src/reference.ts"],
  authorizedTargets: ["src/target.ts"],
  warnings: [],
  blockingReasons: [],
  durationMs: 250,
};

const passing = evaluateValidationExpectation(
  manifest.tests[0]?.expect,
  actual,
);
assert.equal(passing.status, "passed");
assert.ok(passing.checks.every((check) => check.passed));

const failing = evaluateValidationExpectation(
  {
    selectedPaths: ["src/missing.ts"],
    executionMode: "investigation",
  },
  actual,
);
assert.equal(failing.status, "failed");
assert.equal(failing.checks.filter((check) => !check.passed).length, 2);

const productionContractSummary = buildValidationActualSummary({
  understanding: {
    taskUnderstanding: { readiness: "ready" },
    interaction: { action: "continue" },
  } as unknown as Parameters<typeof buildValidationActualSummary>[0]["understanding"],
  preview: {
    task: { effectiveTaskArea: "ui" },
    selectedFiles: [{ path: "src/target.ts" }],
    selectionQuality: {
      status: "ready",
      score: 100,
      warnings: [],
      blockingReasons: [],
    },
    fileSelection: {
      diagnostics: {
        executionContract: {
          mode: "implementation",
          confirmedTargets: ["src/target.ts"],
          authorization: {
            authorizedTargets: ["src/target.ts"],
          },
        },
      },
    },
  } as unknown as Parameters<typeof buildValidationActualSummary>[0]["preview"],
  durationMs: 1,
});
assert.deepEqual(productionContractSummary.authorizedTargets, ["src/target.ts"]);
assert.equal(productionContractSummary.executionMode, "implementation");

const zip = buildStoredZipBytes([
  { name: "report.txt", content: "ok" },
  { name: "diagnostics/CASE-01.json", content: "{\"ok\":true}" },
]);
const zipView = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
assert.equal(zipView.getUint32(0, true), 0x04034b50);
assert.equal(zipView.getUint32(zip.byteLength - 22, true), 0x06054b50);

console.log("Validation Lab smoke tests passed (manifest, expectations, ZIP). ");
