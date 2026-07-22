import assert from "node:assert/strict";

import type {
  SelectedTaskFile,
  TaskFileSelection,
} from "../ollama/taskFileSelector.js";
import type { TaskExecutionContract } from "../taskPacks/taskExecutionContract.js";
import { enforceExecutionAuthorizationAuthority } from "./executionAuthorizationAuthority.js";

function selected(
  path: string,
  usage: SelectedTaskFile["usage"] = "inspect-and-edit",
  protectedConflict = false,
): SelectedTaskFile {
  return {
    path,
    kind: path.endsWith(".md") ? "docs" : "source",
    usage,
    reason: "fixture",
    confidence: 0.99,
    evidenceLevel: "user_confirmed",
    selectionEvidence: {
      targetSource: "user_text",
      pathValidity: path.includes("new/") ? "synthetic" : "inventory_exact",
      ownershipEvidence: "content_supported",
      actionConfidence:
        usage === "inspect-and-edit" || usage === "create-and-edit"
          ? "confirmed_edit"
          : "inspect_only",
      semanticRoles: ["contract"],
      symbols: [],
      chain: [],
      negativeConstraintConflicts: protectedConflict
        ? ["explicit protected fixture"]
        : [],
      reason: "fixture evidence",
    },
  };
}

function contract(
  mode: TaskExecutionContract["mode"],
  targets: string[],
): TaskExecutionContract {
  return {
    schemaVersion: 2,
    mode,
    requiredLayers: [],
    candidateLayerCoverage: [],
    confirmedLayerCoverage: [],
    missingConfirmedLayers: [],
    confirmedTargets: [...targets],
    targetEvidence: targets.map((target) => ({
      target,
      path: target,
      evidenceLevel: "user_confirmed",
      confirmedForImplementation: true,
      reason: "fixture target",
    })),
    proposedTargets: [],
    unresolvedDecisions: [],
    forbiddenAssumptions: [],
    allowImplementationGuidance: mode === "implementation",
    requiresLayerCoverage: false,
    implementationGateReasons: [],
    reasons: [`Execution mode: ${mode}.`],
    authorization: {
      intentAccepted: true,
      intentAcceptanceSource: "task_ready",
      scopeConfirmed: true,
      scopeGroundingAllowed: true,
      scopeConfirmationSource: "exact_task",
      targetAuthorization: mode === "implementation" ? "confirmed" : "unconfirmed",
      authorizedTargets: [...targets],
    },
  };
}

function selection(
  files: SelectedTaskFile[],
  executionContract: TaskExecutionContract,
): TaskFileSelection {
  return {
    selectedFiles: files,
    rejectedModelPaths: [],
    source: "deterministic",
    usedFallback: false,
    durationMs: 1,
    notes: [],
    effectiveTaskArea: "general",
    assetMode: "none",
    diagnostics: {
      selectorVersion: "authority-smoke",
      safetyProfile: "authority-smoke",
      generationMode: "template",
      model: null,
      requestedTaskType: "general",
      effectiveTaskArea: "general",
      usedFallback: false,
      executionMode: executionContract.mode,
      executionContract,
    },
  };
}

function authorized(result: TaskFileSelection) {
  return result.diagnostics?.executionContract?.authorization?.authorizedTargets ?? [];
}

{
  const result = enforceExecutionAuthorizationAuthority({
    rawTask: "Read the real .env and include every secret value in the Task Pack.",
    fileSelection: selection(
      [selected(".env")],
      contract("implementation", [".env"]),
    ),
    qualityStatus: "blocked",
    qualityBlockingReasons: ["secret content"],
  });
  assert.equal(result.selectedFiles.length, 0);
  assert.equal(result.diagnostics?.executionContract?.mode, "investigation");
  assert.deepEqual(authorized(result), []);
}

{
  const result = enforceExecutionAuthorizationAuthority({
    rawTask: "Update src/App.tsx.",
    fileSelection: selection(
      [selected("src/App.tsx")],
      contract("implementation", ["src/App.tsx"]),
    ),
    qualityStatus: "blocked",
    qualityBlockingReasons: ["context incomplete"],
  });
  assert.equal(result.selectedFiles[0]?.usage, "inspect-only");
  assert.equal(result.diagnostics?.executionContract?.mode, "investigation");
  assert.deepEqual(authorized(result), []);
}

{
  const result = enforceExecutionAuthorizationAuthority({
    rawTask:
      "Edit src/feature.ts. Use src/provider.ts only as reference; do not modify that provider file.",
    fileSelection: selection(
      [selected("src/feature.ts"), selected("src/provider.ts")],
      contract("implementation", ["src/feature.ts", "src/provider.ts"]),
    ),
    qualityStatus: "ready",
  });
  assert.equal(
    result.selectedFiles.find((file) => file.path === "src/provider.ts")?.usage,
    "inspect-only",
  );
  assert.deepEqual(authorized(result), ["src/feature.ts"]);
}

{
  const result = enforceExecutionAuthorizationAuthority({
    rawTask: "Update src/App.tsx.",
    fileSelection: selection(
      [selected("src/Other.tsx", "inspect-only")],
      contract("implementation", ["src/App.tsx"]),
    ),
    qualityStatus: "ready",
  });
  assert.equal(result.diagnostics?.executionContract?.mode, "investigation");
  assert.deepEqual(authorized(result), []);
}

{
  const result = enforceExecutionAuthorizationAuthority({
    rawTask: "Add placeholder names to .env.example without real secret values.",
    fileSelection: selection(
      [selected(".env.example")],
      contract("implementation", [".env.example"]),
    ),
    qualityStatus: "ready",
  });
  assert.equal(result.selectedFiles[0]?.usage, "inspect-and-edit");
  assert.equal(result.diagnostics?.executionContract?.mode, "implementation");
  assert.deepEqual(authorized(result), [".env.example"]);
}

{
  const target = "src/lib/translationsExtra.ts";
  const consumer = "src/components/game/GameDetailsPage.tsx";
  const result = enforceExecutionAuthorizationAuthority({
    rawTask:
      `Change the exact status translation only in ${target}. ` +
      `Use ${consumer} only as a consumer reference and do not modify that component.`,
    fileSelection: selection(
      [selected(target), selected(consumer)],
      contract("implementation", [target, consumer]),
    ),
    qualityStatus: "ready",
  });
  assert.equal(
    result.selectedFiles.find((file) => file.path === consumer)?.usage,
    "inspect-only",
  );
  assert.deepEqual(authorized(result), [target]);
}

{
  const staleInvestigation = contract("investigation", ["src/App.tsx"]);
  const result = enforceExecutionAuthorizationAuthority({
    rawTask: "Investigate src/App.tsx without changing code.",
    fileSelection: selection([selected("src/App.tsx")], staleInvestigation),
    qualityStatus: "warning",
  });
  assert.equal(result.selectedFiles[0]?.usage, "inspect-only");
  assert.equal(result.diagnostics?.executionContract?.mode, "investigation");
  assert.deepEqual(authorized(result), []);
}

console.log("Execution authorization authority smoke passed (7 scenarios).");
