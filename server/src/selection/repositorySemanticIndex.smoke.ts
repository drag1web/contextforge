import assert from "node:assert/strict";
import path from "node:path";

import { enforceTaskPackRefinementPolicy } from "../ollama/taskPackGenerationReliability.js";
import { scanProjectInventory, type ProjectInventory, type ProjectInventoryFile } from "../scanner/projectInventoryScanner.js";
import { applySelectionEvidenceGate, type TaskExecutionContract } from "../taskPacks/taskExecutionContract.js";
import { retrieveCandidates } from "./candidateRetrieval.js";
import { resolveRepositorySemanticEvidence } from "./repositorySemanticIndex.js";
import { retainGraphSeeds } from "./selectionConsistency.js";

function sourceFile(
  path: string,
  options: Partial<ProjectInventoryFile> = {},
): ProjectInventoryFile {
  const name = path.split("/").pop() ?? path;
  return {
    path,
    name,
    extension: name.includes(".") ? `.${name.split(".").pop()}` : "",
    kind: "source",
    role: "utility",
    routePath: undefined,
    imports: [],
    exports: [],
    symbols: [],
    textHints: [],
    contentPreview: "",
    sizeBytes: 500,
    depth: path.split("/").length - 1,
    canReadText: true,
    isLikelyGenerated: false,
    ...options,
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

function implementationContract(): TaskExecutionContract {
  return {
    schemaVersion: 2,
    mode: "implementation",
    requiredLayers: [],
    confirmedTargets: [],
    targetEvidence: [],
    proposedTargets: [],
    unresolvedDecisions: [],
    forbiddenAssumptions: [],
    allowImplementationGuidance: true,
    requiresLayerCoverage: false,
    implementationGateReasons: [],
    reasons: [],
  };
}

function exactSymbolInventory() {
  return inventory([
    sourceFile("server/src/performance/trace.ts", {
      role: "service",
      exports: ["finishTrace"],
      semanticFacts: {
        declarations: ["finishTrace"],
        references: ["modelLoadMs"],
        assignments: ["modelLoadMs"],
        objectProperties: ["modelLoadMs"],
        stateSymbols: [],
        translationKeys: [],
        translationEntries: [],
        routePaths: [],
      },
    }),
    sourceFile("apps/client/src/api/client.ts", {
      role: "client-api",
      semanticFacts: {
        declarations: [],
        references: ["modelLoadMs"],
        assignments: [],
        objectProperties: ["modelLoadMs"],
        stateSymbols: [],
        translationKeys: [],
        translationEntries: [],
        routePaths: [],
      },
    }),
    sourceFile("apps/client/src/components/Diagnostics.tsx", {
      role: "component",
      imports: ["../api/client"],
      semanticFacts: {
        declarations: ["Diagnostics"],
        references: ["modelLoadMs"],
        assignments: [],
        objectProperties: [],
        stateSymbols: [],
        translationKeys: [],
        translationEntries: [],
        routePaths: [],
      },
    }),
  ]);
}

async function run() {
  let scenarios = 0;
  let syntheticIndexMs = 0;

  {
    const project = exactSymbolInventory();
    const result = resolveRepositorySemanticEvidence({
      rawTask: "Expose modelLoadMs in backend diagnostics and UI.",
      inventory: project,
    });
    assert.ok(result.existingImplementationPaths.includes("server/src/performance/trace.ts"));
    assert.equal(
      result.byPath.get("server/src/performance/trace.ts")?.ownershipEvidence,
      "symbol_exact",
    );
    assert.notEqual(
      result.byPath.get("apps/client/src/components/Diagnostics.tsx")?.ownershipEvidence,
      "reference_graph",
    );
    scenarios += 1;
  }

  {
    const repoRoot = path.resolve(process.cwd(), "..");
    const scanStartedAt = performance.now();
    const realInventory = await scanProjectInventory(repoRoot);
    const scanMs = performance.now() - scanStartedAt;
    const taskPacksRoute = realInventory.files.find((file) =>
      file.path === "server/src/routes/taskPacks.ts"
    );
    const performanceTrace = realInventory.files.find((file) =>
      file.path === "server/src/performance/performanceTrace.ts"
    );
    const performanceModal = realInventory.files.find((file) =>
      file.path.endsWith("PerformanceDiagnosticsModal.tsx")
    );
    const taskPackResultPage = realInventory.files.find((file) =>
      file.path.endsWith("TaskPackResultPage.tsx")
    );
    const sidebar = realInventory.files.find((file) =>
      file.path.endsWith("components/layout/Sidebar.tsx")
    );
    const i18nIndex = realInventory.files.find((file) =>
      file.path === "apps/desktop/renderer/src/i18n/index.ts"
    );
    assert.ok(taskPacksRoute, "real inventory should include taskPacks route");
    assert.ok(performanceTrace, "real inventory should include performanceTrace");
    assert.ok(performanceModal, "real inventory should include performance diagnostics UI");
    assert.ok(taskPackResultPage, "real inventory should include TaskPackResultPage");
    assert.ok(sidebar, "real inventory should include Sidebar");
    assert.ok(i18nIndex, "real inventory should include i18n/index.ts");

    const routeFacts = taskPacksRoute.semanticFacts;
    const traceFacts = performanceTrace.semanticFacts;
    const modalFacts = performanceModal.semanticFacts;
    const resultFacts = taskPackResultPage.semanticFacts;
    const sidebarFacts = sidebar.semanticFacts;
    const i18nFacts = i18nIndex.semanticFacts;
    assert.ok(
      [...(routeFacts?.references ?? []), ...(routeFacts?.objectProperties ?? [])].includes(
        "understandingSnapshotReused",
      ),
      "real scanner should retain understandingSnapshotReused from taskPacks.ts",
    );
    assert.ok(
      [...(traceFacts?.references ?? []), ...(traceFacts?.assignments ?? []), ...(traceFacts?.objectProperties ?? [])]
        .includes("modelLoadMs"),
      "real scanner should retain modelLoadMs from performanceTrace.ts",
    );
    assert.ok(
      (modalFacts?.references ?? []).includes("modelLoadMs") ||
        (modalFacts?.objectProperties ?? []).includes("modelLoadMs"),
      "real scanner should retain modelLoadMs from the UI consumer",
    );
    assert.ok(
      [...(resultFacts?.references ?? []), ...(resultFacts?.stateSymbols ?? [])].some((symbol) =>
        /currentTaskPack|diagnostics|generated/i.test(symbol)
      ),
      "real scanner should retain TaskPackResultPage state/diagnostics symbols",
    );
    assert.ok(
      [...(sidebarFacts?.references ?? []), ...(sidebarFacts?.translationKeys ?? [])].some((symbol) =>
        symbol === "labelKey" || symbol === "nav.settings",
      ),
      "real scanner should retain Sidebar labelKey/i18n evidence",
    );
    assert.ok(i18nIndex.sizeBytes > 80_000, "i18n/index.ts should exercise large-file bounded analysis");
    assert.ok(i18nFacts, "large i18n/index.ts should retain semantic facts");
    assert.ok(
      (i18nFacts?.translationEntries ?? []).some((entry) => entry.value === "Settings"),
      "large i18n/index.ts should retain Settings translation entry",
    );
    assert.ok(
      (i18nFacts?.translationEntries ?? []).some((entry) => entry.value === "\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438"),
      "large i18n/index.ts should retain Настройки translation entry",
    );

    const queryStartedAt = performance.now();
    const evidence = resolveRepositorySemanticEvidence({
      rawTask: "Add modelLoadMs to backend and UI performance diagnostics.",
      inventory: realInventory,
    });
    const firstQueryMs = performance.now() - queryStartedAt;
    const cachedStartedAt = performance.now();
    const cached = resolveRepositorySemanticEvidence({
      rawTask: "Add modelLoadMs to backend and UI performance diagnostics.",
      inventory: realInventory,
    });
    const cachedWallMs = performance.now() - cachedStartedAt;
    assert.ok(
      evidence.existingImplementationPaths.includes("server/src/performance/performanceTrace.ts"),
      "real semantic index should identify performanceTrace as modelLoadMs evidence",
    );
    assert.equal(cached.indexReused, true);
    assert.ok(cached.queryDurationMs === 0);
    const sidebarEvidence = resolveRepositorySemanticEvidence({
      rawTask: "\u0412 \u043a\u043e\u043c\u043f\u043e\u043d\u0435\u043d\u0442\u0435 Sidebar \u0437\u0430\u043c\u0435\u043d\u0438 \u043f\u043e\u0434\u043f\u0438\u0441\u044c Settings \u043d\u0430 \"\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438\".",
      inventory: realInventory,
    });
    assert.ok(
      sidebarEvidence.byPath.has("apps/desktop/renderer/src/i18n/index.ts"),
      "real Sidebar/i18n task should include i18n translation contract evidence",
    );
    console.log(
      `real inventory semantic scan: files=${realInventory.files.length}; scan=${scanMs.toFixed(1)}ms; query=${firstQueryMs.toFixed(1)}ms; cached=${cachedWallMs.toFixed(1)}ms`,
    );
    scenarios += 1;
  }

  {
    const gated = applySelectionEvidenceGate({
      contract: implementationContract(),
      selectedFiles: [{
        path: "src/ExistingPanel.tsx",
        usage: "inspect-and-edit",
        evidenceLevel: "model_proposed",
        selectionEvidence: {
          targetSource: "model_inference",
          pathValidity: "inventory_exact",
          ownershipEvidence: "model_only",
          actionConfidence: "inspect_only",
          semanticRoles: ["reference"],
          symbols: [],
          chain: [],
          negativeConstraintConflicts: [],
          reason: "Existing path is not ownership evidence.",
        },
      }],
    });
    assert.equal(gated.mode, "investigation");
    assert.equal(gated.allowImplementationGuidance, false);
    scenarios += 1;
  }

  {
    const project = inventory([
      sourceFile("src/pages/AuthPage.tsx", {
        role: "page",
        symbols: ["AuthPage"],
        textHints: ["auth", "login", "session", "авторизация", "вход"],
      }),
      sourceFile("src/pages/RepositoryIntegrationsPage.tsx", {
        role: "page",
        symbols: ["RepositoryIntegrationsPage"],
        textHints: ["repository", "integration", "github", "подключение", "репозиториев"],
      }),
    ]);
    const result = retrieveCandidates({
      rawTask:
        "Добавь вход пользователя в приложение. Это отдельная авторизация в приложение, не существующее подключение GitHub-репозиториев.",
      requestedTaskType: "ui",
      inventory: project,
    });
    const conflict = result.candidates.find((item) => item.path.includes("RepositoryIntegrations"));
    assert.ok(!conflict || conflict.proposedUsage === "inspect-only");
    assert.ok(result.candidates.some((item) => item.path === "src/pages/AuthPage.tsx"));
    scenarios += 1;
  }

  {
    const project = inventory([
      sourceFile("src/pages/AuthPage.tsx", {
        role: "page",
        symbols: ["AuthPage"],
        textHints: ["auth", "login", "session", "\u0430\u0432\u0442\u043e\u0440\u0438\u0437\u0430\u0446\u0438\u044f", "\u0432\u0445\u043e\u0434"],
      }),
      sourceFile("src/pages/ReportsPage.tsx", {
        role: "page",
        symbols: ["ReportsPage"],
        textHints: ["reports", "analytics", "charts"],
      }),
      sourceFile("src/pages/RepositoryIntegrationsPage.tsx", {
        role: "page",
        symbols: ["RepositoryIntegrationsPage"],
        textHints: ["repository", "integration", "github", "\u0440\u0435\u043f\u043e\u0437\u0438\u0442\u043e\u0440\u0438\u0439"],
      }),
    ]);
    const result = retrieveCandidates({
      rawTask:
        "\u0414\u043e\u0431\u0430\u0432\u044c \u0432\u0445\u043e\u0434 \u0432 \u043f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u0435. \u042d\u0442\u043e \u043e\u0442\u0434\u0435\u043b\u044c\u043d\u0430\u044f \u0430\u0432\u0442\u043e\u0440\u0438\u0437\u0430\u0446\u0438\u044f, \u043d\u0435 \u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u044e\u0449\u0435\u0435 \u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u0435 GitHub-\u0440\u0435\u043f\u043e\u0437\u0438\u0442\u043e\u0440\u0438\u0435\u0432.",
      requestedTaskType: "ui",
      inventory: project,
    });
    const reports = result.candidates.find((item) => item.path === "src/pages/ReportsPage.tsx");
    const conflict = result.candidates.find((item) => item.path === "src/pages/RepositoryIntegrationsPage.tsx");
    assert.ok(!reports || reports.score < 55, "repository wording must not boost ReportsPage through short repo alias");
    assert.ok(!conflict || conflict.proposedUsage === "inspect-only");
    assert.ok(result.candidates.some((item) => item.path === "src/pages/AuthPage.tsx"));
    scenarios += 1;
  }

  {
    const project = inventory([
      sourceFile("src/pages/LoginPage.tsx", {
        role: "page",
        symbols: ["LoginPage"],
        textHints: ["login", "form", "форма", "вход"],
      }),
      sourceFile("server/src/routes/auth.ts", {
        role: "api-route",
        symbols: ["authRoutes"],
        textHints: ["backend", "server", "auth", "сервер", "бэк"],
      }),
    ]);
    const result = retrieveCandidates({
      rawTask: "Улучши форму входа, backend не меняй.",
      requestedTaskType: "ui",
      inventory: project,
    });
    const backend = result.candidates.find((item) => item.path === "server/src/routes/auth.ts");
    assert.ok(!backend || backend.proposedUsage === "inspect-only");
    assert.ok(result.candidates.some((item) => item.path === "src/pages/LoginPage.tsx"));
    scenarios += 1;
  }

  {
    const project = inventory([
      sourceFile("src/alpha.ts", {
        role: "service",
        semanticFacts: {
          declarations: [],
          references: ["sharedStatus"],
          assignments: [],
          objectProperties: ["sharedStatus"],
          stateSymbols: [],
          translationKeys: [],
          translationEntries: [],
          routePaths: [],
        },
      }),
      sourceFile("src/beta.ts", {
        role: "service",
        semanticFacts: {
          declarations: [],
          references: ["sharedStatus"],
          assignments: [],
          objectProperties: ["sharedStatus"],
          stateSymbols: [],
          translationKeys: [],
          translationEntries: [],
          routePaths: [],
        },
      }),
    ]);
    const result = resolveRepositorySemanticEvidence({
      rawTask: "Review sharedStatus behavior.",
      inventory: project,
    });
    assert.equal(result.chains.length, 0);
    assert.equal(result.existingImplementationPaths.length, 0);
    assert.equal(result.byPath.size, 0);
    scenarios += 1;
  }

  {
    const project = inventory([
      sourceFile("src/owner.ts", {
        role: "service",
        exports: ["sharedStatus"],
        semanticFacts: {
          declarations: ["sharedStatus"],
          references: ["sharedStatus"],
          assignments: ["sharedStatus"],
          objectProperties: [],
          stateSymbols: [],
          translationKeys: [],
          translationEntries: [],
          routePaths: [],
        },
      }),
      sourceFile("src/consumer.ts", {
        role: "component",
        imports: ["./owner"],
        semanticFacts: {
          declarations: ["Consumer"],
          references: ["sharedStatus"],
          assignments: [],
          objectProperties: [],
          stateSymbols: [],
          translationKeys: [],
          translationEntries: [],
          routePaths: [],
        },
      }),
    ]);
    const result = resolveRepositorySemanticEvidence({
      rawTask: "Review sharedStatus behavior.",
      inventory: project,
    });
    assert.ok(result.existingImplementationPaths.includes("src/owner.ts"));
    assert.ok(result.chains.some((chain) =>
      chain.some((link) => link.path === "src/consumer.ts" && link.relation === "import_graph"),
    ));
    assert.equal(result.byPath.get("src/consumer.ts")?.ownershipEvidence, "reference_graph");
    assert.equal(result.byPath.get("src/consumer.ts")?.actionConfidence, "inspect_only");
    scenarios += 1;
  }

  {
    const project = inventory([
      sourceFile("server/src/routes/requests.ts", {
        role: "api-route",
        semanticFacts: {
          declarations: ["resolveRequest"],
          references: ["understandingSnapshotReused"],
          assignments: [],
          objectProperties: ["understandingSnapshotReused"],
          stateSymbols: [],
          translationKeys: [],
          translationEntries: [],
          routePaths: ["/api/understanding"],
        },
      }),
      sourceFile("apps/client/src/api/client.ts", {
        role: "client-api",
        semanticFacts: {
          declarations: [],
          references: ["understandingSnapshotReused"],
          assignments: [],
          objectProperties: ["understandingSnapshotReused"],
          stateSymbols: [],
          translationKeys: [],
          translationEntries: [],
          routePaths: [],
        },
      }),
    ]);
    const evidence = resolveRepositorySemanticEvidence({
      rawTask: "Add understandingSnapshotReused to the task understanding API response.",
      inventory: project,
    });
    assert.ok(evidence.existingImplementationPaths.includes("server/src/routes/requests.ts"));
    assert.equal(evidence.chains.length, 0);
    const gated = applySelectionEvidenceGate({
      contract: implementationContract(),
      selectedFiles: [],
      existingImplementationCandidates: evidence.existingImplementationPaths,
      existingImplementationRequiresReview: true,
    });
    assert.equal(gated.mode, "investigation");
    scenarios += 1;
  }

  {
    const gated = applySelectionEvidenceGate({
      contract: { ...implementationContract(), requiredLayers: ["backend", "ui"] },
      selectedFiles: [],
      missingRequiredLayers: ["backend", "ui"],
    });
    assert.equal(gated.mode, "investigation");
    assert.ok(gated.implementationGateReasons.some((reason) => reason.includes("layer coverage")));
    scenarios += 1;
  }

  {
    const gated = applySelectionEvidenceGate({
      contract: { ...implementationContract(), requiredLayers: ["backend", "client-api", "ui"] },
      selectedFiles: [
        { path: "server/src/routes/taskPacks.ts", usage: "inspect-and-edit", evidenceLevel: "model_proposed" },
        { path: "apps/desktop/renderer/src/api/client.ts", usage: "inspect-and-edit", evidenceLevel: "model_proposed" },
        { path: "apps/desktop/renderer/src/pages/DashboardPage.tsx", usage: "inspect-and-edit", evidenceLevel: "model_proposed" },
      ],
    });
    assert.equal(gated.mode, "investigation");
    assert.deepEqual(gated.candidateLayerCoverage, ["backend", "client-api", "ui"]);
    assert.deepEqual(gated.confirmedLayerCoverage, []);
    assert.deepEqual(gated.missingConfirmedLayers, ["backend", "client-api", "ui"]);
    scenarios += 1;
  }

  {
    const gated = applySelectionEvidenceGate({
      contract: { ...implementationContract(), requiredLayers: ["backend", "client-api", "ui"] },
      selectedFiles: [
        {
          path: "server/src/routes/taskPacks.ts",
          usage: "inspect-and-edit",
          evidenceLevel: "model_proposed",
          selectionEvidence: {
            targetSource: "model_inference",
            pathValidity: "inventory_exact",
            ownershipEvidence: "symbol_exact",
            actionConfidence: "inspect_then_edit",
            semanticRoles: ["route"],
            symbols: ["taskPacks"],
            chain: [],
            negativeConstraintConflicts: [],
            reason: "Route evidence.",
          },
        },
        { path: "apps/desktop/renderer/src/api/client.ts", usage: "inspect-and-edit", evidenceLevel: "model_proposed" },
        { path: "apps/desktop/renderer/src/pages/DashboardPage.tsx", usage: "inspect-and-edit", evidenceLevel: "model_proposed" },
      ],
    });
    assert.equal(gated.mode, "investigation");
    assert.deepEqual(gated.confirmedLayerCoverage, ["backend"]);
    assert.deepEqual(gated.missingConfirmedLayers, ["client-api", "ui"]);
    scenarios += 1;
  }

  {
    const selectedFiles = [
      {
        path: "server/src/routes/taskPacks.ts",
        usage: "inspect-and-edit",
        evidenceLevel: "model_proposed" as const,
        selectionEvidence: {
          targetSource: "model_inference" as const,
          pathValidity: "inventory_exact" as const,
          ownershipEvidence: "symbol_exact" as const,
          actionConfidence: "inspect_then_edit" as const,
          semanticRoles: ["route" as const],
          symbols: ["taskPacks"],
          chain: [],
          negativeConstraintConflicts: [],
          reason: "Route evidence.",
        },
      },
      {
        path: "apps/desktop/renderer/src/api/client.ts",
        usage: "inspect-and-edit",
        evidenceLevel: "model_proposed" as const,
        selectionEvidence: {
          targetSource: "model_inference" as const,
          pathValidity: "inventory_exact" as const,
          ownershipEvidence: "symbol_exact" as const,
          actionConfidence: "inspect_then_edit" as const,
          semanticRoles: ["contract" as const],
          symbols: ["taskPacks"],
          chain: [],
          negativeConstraintConflicts: [],
          reason: "Client contract evidence.",
        },
      },
      {
        path: "apps/desktop/renderer/src/pages/DashboardPage.tsx",
        usage: "inspect-and-edit",
        evidenceLevel: "model_proposed" as const,
        selectionEvidence: {
          targetSource: "model_inference" as const,
          pathValidity: "inventory_exact" as const,
          ownershipEvidence: "state_graph" as const,
          actionConfidence: "inspect_then_edit" as const,
          semanticRoles: ["state-owner" as const],
          symbols: ["dashboard"],
          chain: [],
          negativeConstraintConflicts: [],
          reason: "UI state evidence.",
        },
      },
    ];
    const gated = applySelectionEvidenceGate({
      contract: { ...implementationContract(), requiredLayers: ["backend", "client-api", "ui"] },
      selectedFiles,
    });
    assert.equal(gated.mode, "implementation");
    assert.deepEqual(gated.confirmedLayerCoverage, ["backend", "client-api", "ui"]);
    assert.deepEqual(gated.missingConfirmedLayers, []);
    scenarios += 1;
  }

  {
    const project = inventory([
      sourceFile("src/pages/ResultPage.tsx", {
        role: "page",
        imports: ["../state/cacheStatus"],
      }),
      sourceFile("src/state/cacheStatus.ts", { role: "store" }),
    ]);
    const result = retainGraphSeeds({
      selectedFiles: [{
        path: "src/state/cacheStatus.ts",
        kind: "source",
        usage: "inspect-only",
        reason: "Graph support.",
        confidence: 0.7,
      }],
      fallbackSeeds: [{
        path: "src/pages/ResultPage.tsx",
        kind: "source",
        usage: "inspect-and-edit",
        reason: "Central state consumer.",
        confidence: 0.8,
      }],
      inventory: project,
      maxFiles: 5,
    });
    assert.equal(result.retainedSeeds.includes("src/pages/ResultPage.tsx"), false);
    assert.ok(result.omittedSeeds.some((seed) =>
      seed.path === "src/pages/ResultPage.tsx" &&
      seed.reason.includes("confirmed ownership evidence"),
    ));
    scenarios += 1;
  }

  {
    const project = inventory([
      sourceFile("src/pages/ResultPage.tsx", {
        role: "page",
        imports: ["../state/cacheStatus"],
      }),
      sourceFile("src/state/cacheStatus.ts", { role: "store" }),
    ]);
    const result = retainGraphSeeds({
      selectedFiles: [{
        path: "src/state/cacheStatus.ts",
        kind: "source",
        usage: "inspect-only",
        reason: "Graph support.",
        confidence: 0.7,
      }],
      fallbackSeeds: [{
        path: "src/pages/ResultPage.tsx",
        kind: "source",
        usage: "inspect-and-edit",
        reason: "Central state consumer.",
        confidence: 0.8,
        selectionEvidence: {
          targetSource: "user_text",
          pathValidity: "inventory_exact",
          ownershipEvidence: "state_graph",
          actionConfidence: "inspect_then_edit",
          semanticRoles: ["state-owner"],
          symbols: ["cacheStatus"],
          chain: [],
          negativeConstraintConflicts: [],
          reason: "Confirmed state owner evidence.",
        },
      }],
      inventory: project,
      maxFiles: 5,
    });
    assert.ok(result.retainedSeeds.includes("src/pages/ResultPage.tsx"));
    assert.ok(result.selectedFiles.some((file) => file.path === "src/pages/ResultPage.tsx"));
    scenarios += 1;
  }

  {
    const project = inventory([
      sourceFile("src/pages/AuthPage.tsx", {
        role: "page",
        symbols: ["AuthPage"],
        textHints: ["auth", "login", "session"],
      }),
      sourceFile("src/pages/RepositoryIntegrationsPage.tsx", {
        role: "page",
        symbols: ["RepositoryIntegrationsPage"],
        textHints: ["repository", "integration", "github"],
      }),
    ]);
    const result = retrieveCandidates({
      rawTask: "Add a separate authentication flow, not the existing repository integration.",
      requestedTaskType: "ui",
      inventory: project,
    });
    const conflict = result.candidates.find((item) => item.path.includes("RepositoryIntegrations"));
    assert.ok(!conflict || conflict.proposedUsage === "inspect-only");
    assert.ok(result.candidates.some((item) => item.path === "src/pages/AuthPage.tsx"));
    scenarios += 1;
  }

  {
    const policy = enforceTaskPackRefinementPolicy({
      implementationGuidance: ["Update SettingsPanel.tsx and replace its state logic."],
      constraints: [],
      acceptanceCriteria: ["SettingsPanel.tsx must be modified."],
      verificationSteps: [],
      finalResponseRequirements: [],
    }, {
      rawTask: "Review settings behavior.",
      templatePrompt: "",
      relevantFiles: [{
        path: "src/SettingsPanel.tsx",
        usage: "inspect-only",
        reason: "Reference candidate.",
      }],
      executionContract: implementationContract(),
    });
    assert.equal(policy.refinement.implementationGuidance.some((item) => item.includes("SettingsPanel")), false);
    assert.ok(policy.diagnostics.rejectionCodes.includes("inspect_only_promoted_to_edit"));
    scenarios += 1;
  }

  {
    const policy = enforceTaskPackRefinementPolicy({
      implementationGuidance: ["You must modify the guessed controller."],
      constraints: [],
      acceptanceCriteria: ["The service should be extended."],
      verificationSteps: [],
      finalResponseRequirements: [],
    }, {
      rawTask: "Investigate stale state ownership.",
      templatePrompt: "",
      relevantFiles: [],
      executionContract: {
        ...implementationContract(),
        mode: "investigation",
        allowImplementationGuidance: false,
        requiredLayers: ["state", "ui"],
      },
    });
    const text = Object.values(policy.refinement).flat().join(" ");
    assert.equal(/\b(?:must modify|should be extended|requires editing)\b/i.test(text), false);
    scenarios += 1;
  }

  {
    const files = Array.from({ length: 235 }, (_, index) =>
      sourceFile(`src/modules/module-${index}/service-${index}.ts`, {
        role: "service",
        symbols: [`Module${index}Service`],
        semanticFacts: {
          declarations: [`Module${index}Service`],
          references: index === 117 ? ["targetMetricMs"] : [`localValue${index}`],
          assignments: index === 117 ? ["targetMetricMs"] : [],
          objectProperties: index === 117 ? ["targetMetricMs"] : [],
          stateSymbols: [],
          translationKeys: [],
          translationEntries: [],
          routePaths: [],
        },
      }),
    );
    const project = inventory(files);
    const startedAt = performance.now();
    const first = resolveRepositorySemanticEvidence({
      rawTask: "Expose targetMetricMs in diagnostics.",
      inventory: project,
    });
    const second = resolveRepositorySemanticEvidence({
      rawTask: "Expose targetMetricMs in diagnostics.",
      inventory: project,
    });
    const totalMs = performance.now() - startedAt;
    syntheticIndexMs = totalMs;
    assert.ok(first.existingImplementationPaths.includes("src/modules/module-117/service-117.ts"));
    assert.equal(second.indexReused, true);
    assert.equal(second.queryDurationMs, 0);
    assert.ok(totalMs < 250, `Semantic index/query exceeded local bound: ${totalMs.toFixed(1)}ms`);
    scenarios += 1;
  }

  console.log(
    `repository semantic index smoke passed: ${scenarios} scenarios; 235-file build+cached-query ${syntheticIndexMs.toFixed(1)}ms`,
  );
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
