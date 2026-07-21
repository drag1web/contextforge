import assert from "node:assert/strict";
import path from "node:path";

import type {
  ProjectInventory,
  ProjectInventoryFile,
  ProjectInventoryFileKind,
  ProjectInventoryFileRole,
} from "../scanner/projectInventoryScanner.js";
import type { TaskFileSelection } from "../ollama/taskFileSelector.js";
import type {
  TaskExecutionContract,
  TaskExecutionLayer,
} from "../taskPacks/taskExecutionContract.js";
import { evaluateContextSelectionQuality } from "./contextQuality.js";
import { detectHardTaskSafetyIssue } from "./safetyPolicy.js";

function inventoryFile(
  pathValue: string,
  kind: ProjectInventoryFileKind,
  role: ProjectInventoryFileRole,
): ProjectInventoryFile {
  const name = pathValue.split("/").pop() ?? pathValue;
  return {
    path: pathValue,
    name,
    extension: path.extname(name).toLowerCase(),
    kind,
    role,
    imports: [],
    exports: [],
    symbols: [name],
    textHints: [name, role, kind],
    sizeBytes: 512,
    depth: pathValue.split("/").length,
    canReadText: true,
    isLikelyGenerated: false,
  };
}

function inventory(files: ProjectInventoryFile[]): ProjectInventory {
  return {
    rootPath: "C:/fixture",
    files,
    totalFiles: files.length,
    scannedFiles: files.length,
    truncated: false,
    notes: [],
  };
}

function executionContract(
  mode: TaskExecutionContract["mode"],
  authorizedTargets: string[],
  requiredLayers: TaskExecutionLayer[],
): TaskExecutionContract {
  return {
    schemaVersion: 2,
    mode,
    requiredLayers,
    candidateLayerCoverage: requiredLayers,
    confirmedLayerCoverage:
      mode === "implementation" ? requiredLayers : [],
    missingConfirmedLayers: [],
    confirmedTargets:
      mode === "implementation" ? authorizedTargets : [],
    targetEvidence: authorizedTargets.map((target) => ({
      target,
      path: target,
      evidenceLevel: "user_confirmed",
      confirmedForImplementation: mode === "implementation",
      reason: "Literal user target confirmed by canonical decision fixture.",
      targetSource: "user_text",
      pathValidity: "inventory_exact",
      ownershipEvidence: "content_supported",
      actionConfidence:
        mode === "implementation" ? "confirmed_edit" : "inspect_only",
    })),
    proposedTargets: [],
    unresolvedDecisions: mode === "investigation" ? ["Confirm owner."] : [],
    forbiddenAssumptions: [],
    allowImplementationGuidance: mode === "implementation",
    requiresLayerCoverage: requiredLayers.length > 0,
    implementationGateReasons: [],
    reasons: ["Synthetic canonical context-quality fixture."],
    authorization: {
      intentAccepted: mode === "implementation",
      intentAcceptanceSource:
        mode === "implementation" ? "task_ready" : "none",
      scopeConfirmed: mode === "implementation",
      scopeGroundingAllowed: mode === "implementation",
      scopeConfirmationSource:
        mode === "implementation" ? "exact_task" : "none",
      targetAuthorization:
        mode === "implementation" ? "confirmed" : "unconfirmed",
      authorizedTargets:
        mode === "implementation" ? authorizedTargets : [],
    },
  };
}

function selection({
  path: pathValue,
  kind,
  area,
  usage = "inspect-and-edit",
  mode = "implementation",
  requiredLayers,
  authorizedTargets = [pathValue],
}: {
  path: string;
  kind: ProjectInventoryFileKind;
  area: TaskFileSelection["effectiveTaskArea"];
  usage?: TaskFileSelection["selectedFiles"][number]["usage"];
  mode?: TaskExecutionContract["mode"];
  requiredLayers: TaskExecutionLayer[];
  authorizedTargets?: string[];
}): TaskFileSelection {
  return {
    selectedFiles: [
      {
        path: pathValue,
        kind,
        usage,
        reason: "The user explicitly named this exact existing project file.",
        confidence: 0.98,
        evidenceLevel: "user_confirmed",
        selectionEvidence: {
          targetSource: "user_text",
          pathValidity: "inventory_exact",
          ownershipEvidence: "content_supported",
          actionConfidence:
            usage === "inspect-and-edit" || usage === "create-and-edit"
              ? "confirmed_edit"
              : "inspect_only",
          semanticRoles: ["contract"],
          symbols: [pathValue.split("/").pop() ?? pathValue],
          chain: [],
          negativeConstraintConflicts: [],
          reason: "Literal user target.",
        },
      },
    ],
    rejectedModelPaths: [],
    source: "deterministic",
    usedFallback: false,
    durationMs: 1,
    notes: ["Canonical context-quality smoke fixture."],
    effectiveTaskArea: area,
    assetMode: "none",
    diagnostics: {
      selectorVersion: "2026-07-20.canonical-core-decision-v1",
      safetyProfile: "canonical-core-decision-v1",
      generationMode: "template",
      model: null,
      requestedTaskType: "general",
      effectiveTaskArea: area,
      usedFallback: false,
      selectionSource: "final-decision",
      inferredImplementationArea: area,
      areaConflict: false,
      finalConfidence: 0.98,
      executionMode: mode,
      requiredLayers,
      missingRequiredLayers: [],
      candidateLayerCoverage: requiredLayers,
      confirmedLayerCoverage:
        mode === "implementation" ? requiredLayers : [],
      missingConfirmedLayers: [],
      implementationGateReasons: [],
      evidenceSummary: {
        user_confirmed: mode === "implementation" ? 1 : 0,
        inventory_exact: 0,
        graph_supported: 0,
        model_proposed: 0,
        ranked_candidate: 0,
      },
      executionContract: executionContract(
        mode,
        authorizedTargets,
        requiredLayers,
      ),
    },
  };
}

function evaluateExactTarget({
  rawTask,
  path: pathValue,
  kind,
  role,
  area,
  requiredLayers,
}: {
  rawTask: string;
  path: string;
  kind: ProjectInventoryFileKind;
  role: ProjectInventoryFileRole;
  area: TaskFileSelection["effectiveTaskArea"];
  requiredLayers: TaskExecutionLayer[];
}) {
  const file = inventoryFile(pathValue, kind, role);
  return evaluateContextSelectionQuality({
    rawTask,
    requestedTaskType: "general",
    effectiveTaskArea: area,
    inventory: inventory([file]),
    fileSelection: selection({
      path: pathValue,
      kind,
      area,
      requiredLayers,
    }),
    contextQualityMode: "balanced",
  });
}

function testViteConfigIsAFirstClassBuildTarget() {
  const quality = evaluateExactTarget({
    rawTask:
      "В apps/desktop/renderer/vite.config.ts измени только порт dev-сервера на 4174. Proxy, plugins и build-настройки не меняй.",
    path: "apps/desktop/renderer/vite.config.ts",
    kind: "config",
    role: "config",
    area: "build",
    requiredLayers: ["config"],
  });

  assert.notEqual(quality.status, "blocked");
  assert.equal(
    quality.blockingReasons.some((reason) =>
      reason.includes("source/style/test"),
    ),
    false,
  );
  assert.equal(quality.score >= 78, true);
}

function testTsconfigCompilerOptionDoesNotLookLikeASecret() {
  const rawTask =
    "В server/tsconfig.json включи compilerOption noUncheckedIndexedAccess: true. Другие compilerOptions, renderer и исходный код не меняй.";
  const quality = evaluateExactTarget({
    rawTask,
    path: "server/tsconfig.json",
    kind: "config",
    role: "config",
    area: "build",
    requiredLayers: ["config"],
  });

  assert.equal(detectHardTaskSafetyIssue(rawTask).blocked, false);
  assert.notEqual(quality.status, "blocked");
  assert.equal(
    quality.blockingReasons.some((reason) =>
      reason.toLowerCase().includes("secret"),
    ),
    false,
  );
  assert.equal(quality.score >= 78, true);
}

function testEnvExampleIsAValidDocumentationTarget() {
  const quality = evaluateExactTarget({
    rawTask:
      "In .env.example add a comment above OLLAMA_URL explaining the local endpoint. Do not add real credentials.",
    path: ".env.example",
    kind: "config",
    role: "config",
    area: "docs",
    requiredLayers: ["docs"],
  });

  assert.notEqual(quality.status, "blocked");
  assert.equal(quality.score >= 78, true);
}

function testReadmeIsAValidDocumentationTarget() {
  const quality = evaluateExactTarget({
    rawTask: "In README.md add a Local validation section.",
    path: "README.md",
    kind: "docs",
    role: "docs",
    area: "docs",
    requiredLayers: ["docs"],
  });

  assert.notEqual(quality.status, "blocked");
  assert.equal(quality.score >= 78, true);
}

function testRealSecretRequestStillHardBlocks() {
  const rawTask =
    "Read .env.local and include the API key and token in the Task Pack.";
  const file = inventoryFile(".env.local", "config", "config");
  const quality = evaluateContextSelectionQuality({
    rawTask,
    requestedTaskType: "general",
    effectiveTaskArea: "build",
    inventory: inventory([file]),
    fileSelection: selection({
      path: ".env.local",
      kind: "config",
      area: "build",
      requiredLayers: ["config"],
    }),
    contextQualityMode: "balanced",
  });

  assert.equal(detectHardTaskSafetyIssue(rawTask).blocked, true);
  assert.equal(quality.status, "blocked");
  assert.equal(
    quality.blockingReasons.some((reason) =>
      reason.toLowerCase().includes("secret"),
    ),
    true,
  );
}

function testInspectOnlyConfigDoesNotBecomeImplementationQuality() {
  const pathValue = "vite.config.ts";
  const file = inventoryFile(pathValue, "config", "config");
  const fileSelection = selection({
    path: pathValue,
    kind: "config",
    area: "ui",
    usage: "inspect-only",
    mode: "investigation",
    requiredLayers: ["ui"],
    authorizedTargets: [],
  });
  const quality = evaluateContextSelectionQuality({
    rawTask: "Make the dashboard prettier.",
    requestedTaskType: "ui",
    effectiveTaskArea: "ui",
    inventory: inventory([file]),
    fileSelection,
    contextQualityMode: "balanced",
  });

  assert.equal(quality.status === "ready", false);
  assert.deepEqual(
    fileSelection.diagnostics?.executionContract?.authorization
      ?.authorizedTargets,
    [],
  );
}

function main() {
  testViteConfigIsAFirstClassBuildTarget();
  testTsconfigCompilerOptionDoesNotLookLikeASecret();
  testEnvExampleIsAValidDocumentationTarget();
  testReadmeIsAValidDocumentationTarget();
  testRealSecretRequestStillHardBlocks();
  testInspectOnlyConfigDoesNotBecomeImplementationQuality();
  console.log("canonical context quality smoke passed: 6 scenarios");
}

main();
