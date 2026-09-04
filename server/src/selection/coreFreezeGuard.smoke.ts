import assert from "node:assert/strict";

import type {
  SelectedTaskFile,
  TaskFileSelection,
} from "../ollama/taskFileSelector.js";
import type { ProjectInventory } from "../scanner/projectInventoryScanner.js";
import type { TaskExecutionContract } from "../taskPacks/taskExecutionContract.js";
import { enforceExecutionAuthorizationAuthority } from "./executionAuthorizationAuthority.js";

function selected(
  path: string,
  usage: SelectedTaskFile["usage"] = "inspect-and-edit",
): SelectedTaskFile {
  return {
    path,
    kind: path.endsWith(".md") ? "docs" : "source",
    usage,
    reason: "core-freeze fixture",
    confidence: 0.99,
    evidenceLevel: "user_confirmed",
    selectionEvidence: {
      targetSource: "user_text",
      pathValidity: usage === "create-and-edit" ? "synthetic" : "inventory_exact",
      ownershipEvidence: "content_supported",
      actionConfidence:
        usage === "inspect-and-edit" || usage === "create-and-edit"
          ? "confirmed_edit"
          : "inspect_only",
      semanticRoles: ["contract"],
      symbols: [],
      chain: [],
      negativeConstraintConflicts: [],
      reason: "core-freeze fixture evidence",
    },
  };
}

function contract(targets: string[]): TaskExecutionContract {
  return {
    schemaVersion: 2,
    mode: "implementation",
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
      reason: "core-freeze fixture target",
    })),
    proposedTargets: [],
    unresolvedDecisions: [],
    forbiddenAssumptions: [],
    allowImplementationGuidance: true,
    requiresLayerCoverage: false,
    implementationGateReasons: [],
    reasons: ["Execution mode: implementation."],
    authorization: {
      intentAccepted: true,
      intentAcceptanceSource: "task_ready",
      scopeConfirmed: true,
      scopeGroundingAllowed: true,
      scopeConfirmationSource: "exact_task",
      targetAuthorization: "confirmed",
      authorizedTargets: [...targets],
    },
  };
}

function selection(files: SelectedTaskFile[], targets: string[]): TaskFileSelection {
  const executionContract = contract(targets);
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
      selectorVersion: "core-freeze-smoke",
      safetyProfile: "core-freeze-smoke",
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

function inventory(
  paths: string[],
  symbolsByPath: Readonly<Record<string, readonly string[]>> = {},
): ProjectInventory {
  return {
    rootPath: "/fixture",
    files: paths.map((filePath) => {
      const name = filePath.split("/").pop() ?? filePath;
      return {
        path: filePath,
        name,
        extension: name.includes(".") ? `.${name.split(".").pop()}` : "",
        kind: "source",
        role: filePath.includes("/api/")
          ? "api-route"
          : name.startsWith("layout.")
            ? "layout"
            : name.startsWith("page.") || filePath.includes("/pages/")
              ? "page"
              : filePath.includes("/components/ui/")
                ? "ui-component"
                : "component",
        imports: [],
        exports: [...(symbolsByPath[filePath] ?? [])],
        symbols: [...(symbolsByPath[filePath] ?? [])],
        textHints: [],
        sizeBytes: 1,
        depth: filePath.split("/").length - 1,
        canReadText: true,
        isLikelyGenerated: false,
      };
    }),
    totalFiles: paths.length,
    scannedFiles: paths.length,
    truncated: false,
    notes: [],
  };
}

function run(input: {
  task: string;
  inventoryPaths: string[];
  files: SelectedTaskFile[];
  authorizedTargets: string[];
  symbolsByPath?: Readonly<Record<string, readonly string[]>>;
}) {
  return enforceExecutionAuthorizationAuthority({
    rawTask: input.task,
    inventory: inventory(input.inventoryPaths, input.symbolsByPath),
    fileSelection: selection(input.files, input.authorizedTargets),
    qualityStatus: "ready",
  });
}

function authorized(result: TaskFileSelection) {
  return result.diagnostics?.executionContract?.authorization?.authorizedTargets ?? [];
}

function assertInvestigation(result: TaskFileSelection) {
  assert.equal(result.diagnostics?.executionContract?.mode, "investigation");
  assert.deepEqual(authorized(result), []);
}

// Exact target was omitted while a role-qualified consumer was proposed for editing.
{
  const result = run({
    task: "In src/pages/LibraryPage.tsx change the shortcut. Use CommandPalette only as consumer reference and do not modify Electron shortcuts.",
    inventoryPaths: [
      "src/pages/LibraryPage.tsx",
      "src/components/ui/CommandPalette.tsx",
      "electron/ipc/shortcuts.ts",
    ],
    files: [selected("src/components/ui/CommandPalette.tsx")],
    authorizedTargets: ["src/components/ui/CommandPalette.tsx"],
  });
  assertInvestigation(result);
  assert.equal(result.selectedFiles[0]?.usage, "inspect-only");
}

// Multiple exact ownership paths were omitted and a protected similarly named page was selected.
{
  const result = run({
    task: "Add page and limit parameters. Keep SQL ownership in src/db/queries.ts, HTTP parsing in src/server.ts and typed parameters in client/src/api.ts. Do not alter schema or RunDetails.",
    inventoryPaths: [
      "src/db/queries.ts",
      "src/server.ts",
      "client/src/api.ts",
      "client/src/pages/Runs.tsx",
      "client/src/pages/RunDetails.tsx",
    ],
    files: [selected("client/src/pages/RunDetails.tsx")],
    authorizedTargets: ["client/src/pages/RunDetails.tsx"],
  });
  assertInvestigation(result);
}

// An exact content owner cannot be replaced by forms or routes.
{
  const result = run({
    task: "In src/content/company.ts change only the public city value. Use layout and page as consumer references and do not modify them, forms or routes.",
    inventoryPaths: [
      "src/content/company.ts",
      "src/app/(site)/layout.tsx",
      "src/app/(site)/page.tsx",
      "src/components/sections/LeadMiniForm.tsx",
      "src/app/api/lead/route.ts",
    ],
    files: [
      selected("src/content/company.ts", "inspect-only"),
      selected("src/components/sections/LeadMiniForm.tsx"),
    ],
    authorizedTargets: ["src/components/sections/LeadMiniForm.tsx"],
  });
  assertInvestigation(result);
}

// Natural-language protected scopes are final over broad fullstack inference.
{
  const result = run({
    task: "Add preferredContact to both lead forms and the lead route. Do not change shared UI components or company data.",
    inventoryPaths: [
      "src/components/sections/LeadMiniForm.tsx",
      "src/components/sections/LeadSection.tsx",
      "src/app/api/lead/route.ts",
      "src/content/company.ts",
      "src/components/ui/Input.tsx",
    ],
    files: [
      selected("src/app/api/lead/route.ts"),
      selected("src/content/company.ts"),
      selected("src/components/ui/Input.tsx"),
    ],
    authorizedTargets: [
      "src/app/api/lead/route.ts",
      "src/content/company.ts",
      "src/components/ui/Input.tsx",
    ],
  });
  assertInvestigation(result);
}

// A home page named only as a consumer reference cannot become editable.
{
  const result = run({
    task: "Send sourcePage from both lead forms to /api/lead. Use the home page only as consumer reference; do not modify company data or layout.",
    inventoryPaths: [
      "src/components/sections/LeadMiniForm.tsx",
      "src/components/sections/LeadSection.tsx",
      "src/app/api/lead/route.ts",
      "src/app/(site)/page.tsx",
      "src/content/company.ts",
      "src/app/(site)/layout.tsx",
    ],
    files: [
      selected("src/app/api/lead/route.ts"),
      selected("src/app/(site)/page.tsx"),
    ],
    authorizedTargets: [
      "src/app/api/lead/route.ts",
      "src/app/(site)/page.tsx",
    ],
  });
  assertInvestigation(result);
}

// Russian trailing negative scopes protect a current literal owner.
{
  const result = run({
    task: "На главной замени старый заголовок на новый. company.ts, layout, forms и API не меняй.",
    inventoryPaths: [
      "src/app/layout.tsx",
      "src/content/company.ts",
      "src/components/LeadForm.tsx",
      "src/app/api/lead/route.ts",
    ],
    files: [selected("src/app/layout.tsx")],
    authorizedTargets: ["src/app/layout.tsx"],
  });
  assertInvestigation(result);
}

// Removing an entity while preserving every entity-dependent branch unchanged is contradictory.
{
  const result = run({
    task: "Remove the viewer role from the application while preserving every viewer-only branch, modal, API response and permission check exactly as they are.",
    inventoryPaths: ["client/src/auth/AuthContext.tsx", "src/server.ts"],
    files: [
      selected("client/src/auth/AuthContext.tsx"),
      selected("src/server.ts"),
    ],
    authorizedTargets: ["client/src/auth/AuthContext.tsx", "src/server.ts"],
  });
  assertInvestigation(result);
}

// A correct exact bounded target remains implementation-authorized.
{
  const target = "src/pages/ROICalculator.jsx";
  const result = run({
    task: `In ${target} replace the subtitle. Formulas, storage, PDF and App must not change.`,
    inventoryPaths: [
      target,
      "src/App.jsx",
      "src/utils/calculations.js",
      "src/utils/pdf.js",
    ],
    files: [selected(target)],
    authorizedTargets: [target],
  });
  assert.equal(result.diagnostics?.executionContract?.mode, "implementation");
  assert.deepEqual(authorized(result), [target]);
}

// Protected evidence that was already inspect-only does not revoke a valid target.
{
  const target = "src/feature.ts";
  const reference = "src/provider.ts";
  const result = run({
    task: `Update ${target}. Use ${reference} only as a consumer reference.`,
    inventoryPaths: [target, reference],
    files: [selected(target), selected(reference, "inspect-only")],
    authorizedTargets: [target],
  });
  assert.equal(result.diagnostics?.executionContract?.mode, "implementation");
  assert.deepEqual(authorized(result), [target]);
  assert.equal(
    result.selectedFiles.find((file) => file.path === reference)?.usage,
    "inspect-only",
  );
}

// A non-destructive rename with preservation requirements remains allowed.
{
  const target = "src/auth.ts";
  const result = run({
    task: `Rename the viewer label in ${target} while preserving all viewer-only branches unchanged.`,
    inventoryPaths: [target],
    files: [selected(target)],
    authorizedTargets: [target],
  });
  assert.equal(result.diagnostics?.executionContract?.mode, "implementation");
  assert.deepEqual(authorized(result), [target]);
}

// Exact file-level negatives remain final over otherwise authorized edits.
{
  const target = "src/feature.ts";
  const protectedFile = "src/config.ts";
  const result = run({
    task: `Change ${target}. Do not edit ${protectedFile}.`,
    inventoryPaths: [target, protectedFile],
    files: [selected(target), selected(protectedFile)],
    authorizedTargets: [target, protectedFile],
  });
  assert.deepEqual(authorized(result), [target]);
  assert.equal(result.selectedFiles.find((file) => file.path === protectedFile)?.usage, "inspect-only");
}

// A unique basename is still a whole-file protection reference.
{
  const target = "src/feature.ts";
  const protectedFile = "src/config.ts";
  const result = run({
    task: `Change ${target}. Do not touch config.ts.`,
    inventoryPaths: [target, protectedFile],
    files: [selected(target), selected(protectedFile)],
    authorizedTargets: [target, protectedFile],
  });
  assert.deepEqual(authorized(result), [target]);
  assert.equal(result.selectedFiles.find((file) => file.path === protectedFile)?.usage, "inspect-only");
}

// Directory-scoped protection remains file-wide for paths under that directory.
{
  const target = "src/feature.ts";
  const protectedFile = "src/private/tokenStore.ts";
  const result = run({
    task: `Change ${target}. Do not change files under src/private.`,
    inventoryPaths: [target, protectedFile],
    files: [selected(target), selected(protectedFile)],
    authorizedTargets: [target, protectedFile],
  });
  assertInvestigation(result);
  assert.equal(result.selectedFiles.find((file) => file.path === protectedFile)?.usage, "inspect-only");
}

// A protected member does not freeze its containing exact editable file.
{
  const target = "src/types/options.ts";
  const result = run({
    task: `In ${target} change OptionA. Do not change OptionB.`,
    inventoryPaths: [target],
    files: [selected(target)],
    authorizedTargets: [target],
    symbolsByPath: { [target]: ["OptionA", "OptionB"] },
  });
  assert.equal(result.diagnostics?.executionContract?.mode, "implementation");
  assert.deepEqual(authorized(result), [target]);
}

// A sibling-member restriction remains granular inside one exact editable file.
{
  const target = "src/types/options.ts";
  const result = run({
    task: `In ${target} change DEFAULT_OPTIONS.pageSize. Do not change any other default option.`,
    inventoryPaths: [target],
    files: [selected(target)],
    authorizedTargets: [target],
    symbolsByPath: { [target]: ["DEFAULT_OPTIONS"] },
  });
  assert.equal(result.diagnostics?.executionContract?.mode, "implementation");
  assert.deepEqual(authorized(result), [target]);
}

// A direct positive/negative file contradiction remains blocked.
{
  const target = "src/types/options.ts";
  const result = run({
    task: `Edit ${target}; do not edit ${target}.`,
    inventoryPaths: [target],
    files: [selected(target)],
    authorizedTargets: [target],
  });
  assertInvestigation(result);
}

// A protected symbol that is not the requested member does not revoke file authority.
{
  const target = "src/types/options.ts";
  const result = run({
    task: `In ${target} change OptionA. Do not change OptionB.`,
    inventoryPaths: [target],
    files: [selected(target)],
    authorizedTargets: [target],
    symbolsByPath: { [target]: ["OptionA", "OptionB"] },
  });
  assert.deepEqual(authorized(result), [target]);
}

// A member requested and forbidden by the same task remains blocked.
{
  const target = "src/types/options.ts";
  const result = run({
    task: `In ${target} change OptionA; do not change OptionA.`,
    inventoryPaths: [target],
    files: [selected(target)],
    authorizedTargets: [target],
    symbolsByPath: { [target]: ["OptionA"] },
  });
  assertInvestigation(result);
}

// Lexical overlap with a file stem is not file-level protection evidence.
{
  const target = "src/types/settings.ts";
  const result = run({
    task: `In ${target} change FeatureFlag. Do not change any other default setting.`,
    inventoryPaths: [target],
    files: [selected(target)],
    authorizedTargets: [target],
    symbolsByPath: { [target]: ["FeatureFlag"] },
  });
  assert.equal(result.diagnostics?.executionContract?.mode, "implementation");
  assert.deepEqual(authorized(result), [target]);
}

// Deliberate category-level protection remains whole-file protection.
{
  const target = "src/feature.ts";
  const protectedFile = "src/components/ui/Button.tsx";
  const result = run({
    task: `Change ${target}. Do not modify shared UI components.`,
    inventoryPaths: [target, protectedFile],
    files: [selected(target), selected(protectedFile)],
    authorizedTargets: [target, protectedFile],
  });
  assertInvestigation(result);
  assert.equal(result.selectedFiles.find((file) => file.path === protectedFile)?.usage, "inspect-only");
}

// A protected member's owner cannot become an implicit editable substitute.
{
  const target = "src/feature.ts";
  const protectedFile = "src/pages/RunDetails.tsx";
  const result = run({
    task: `Change ${target}. Do not change RunDetails.`,
    inventoryPaths: [target, protectedFile],
    files: [selected(target), selected(protectedFile)],
    authorizedTargets: [target, protectedFile],
    symbolsByPath: { [protectedFile]: ["RunDetails"] },
  });
  assertInvestigation(result);
  assert.equal(result.selectedFiles.find((file) => file.path === protectedFile)?.usage, "inspect-only");
}

// File/member classification and final authority are invariant to input ordering.
{
  const target = "src/types/options.ts";
  const reference = "src/types/optionsConsumer.ts";
  const input = {
    task: `In ${target} change OptionA. Do not change OptionB.`,
    inventoryPaths: [target, reference],
    authorizedTargets: [target],
    symbolsByPath: { [target]: ["OptionA", "OptionB"] },
  };
  const first = run({ ...input, files: [selected(target), selected(reference, "inspect-only")] });
  const second = run({ ...input, inventoryPaths: [...input.inventoryPaths].reverse(), files: [selected(reference, "inspect-only"), selected(target)] });
  const summarize = (result: TaskFileSelection) => ({
    authorized: [...authorized(result)].sort(),
    files: result.selectedFiles.map((file) => ({ path: file.path, usage: file.usage })).sort((left, right) => left.path.localeCompare(right.path)),
    mode: result.diagnostics?.executionContract?.mode,
  });
  assert.deepEqual(summarize(first), summarize(second));
}

console.log("Core Freeze Guard smoke passed (22 scenarios).");
