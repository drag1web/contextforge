import assert from "node:assert/strict";
import path from "node:path";

import type { TaskIntentAnalysis } from "../ollama/taskIntentAnalyzer.js";
import type {
  ProjectInventory,
  ProjectInventoryFile,
} from "../scanner/projectInventoryScanner.js";
import type { AppSettings } from "../settings/settingsService.js";
import { runSelectorPipeline } from "./selectorPipelineOrchestrator.js";

const settings: AppSettings = {
  ollamaUrl: "http://127.0.0.1:11434",
  generationMode: "template",
  aiProvider: "ollama",
  defaultTargetTool: "codex",
  defaultTaskType: "general",
  defaultOllamaModel: null,
  openAiCompatibleBaseUrl: "http://localhost:1234/v1",
  openAiCompatibleModel: null,
  openAiCompatibleApiKeyConfigured: false,
  geminiBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
  geminiModel: "gemini-1.5-flash",
  geminiApiKeyConfigured: false,
  anthropicBaseUrl: "https://api.anthropic.com/v1",
  anthropicModel: "claude-3-5-sonnet-latest",
  anthropicApiKeyConfigured: false,
  language: "en",
  theme: "dark",
  composerFileLimits: {
    default: 8,
    ui: 7,
    backend: 8,
    fullstack: 10,
    build: 7,
    bugfix: 7,
    refactor: 8,
    docs: 6,
    tests: 7,
  },
  contextQualityMode: "balanced",
  selectorPipelineMode: "shadow_primary",
  taskUnderstandingInteractionMode: "balanced",
  sidebarShowDescriptions: false,
  onboardingEnabled: true,
  onboardingShowEveryLaunch: true,
  onboardingCompleted: false,
};

function file(
  pathValue: string,
  patch: Partial<ProjectInventoryFile> = {},
): ProjectInventoryFile {
  const name = pathValue.split("/").pop() ?? pathValue;
  return {
    path: pathValue,
    name,
    extension: path.extname(name).toLowerCase(),
    kind: "source",
    role: "unknown",
    imports: [],
    exports: [],
    symbols: [],
    textHints: [],
    sizeBytes: 1000,
    depth: pathValue.split("/").length,
    canReadText: true,
    isLikelyGenerated: false,
    ...patch,
  };
}

function inventory(files: ProjectInventoryFile[]): ProjectInventory {
  return {
    rootPath: "C:/canonical-core-fixture",
    files,
    totalFiles: files.length,
    scannedFiles: files.length,
    truncated: false,
    notes: [],
  };
}

function intent(
  patch: Partial<TaskIntentAnalysis> = {},
): TaskIntentAnalysis {
  return {
    taskArea: "general",
    intentTags: [],
    domainTerms: [],
    mentionedEntities: [],
    fileRoleHints: [],
    recommendedSearchTerms: [],
    riskLevel: "low",
    confidence: 0.9,
    notes: [],
    taskUnderstanding: {
      schemaVersion: 1,
      goal: "Canonical core smoke task.",
      action: "update",
      targetHints: [],
      requestedChanges: [],
      constraints: [],
      interpretationRisk: "objective",
      changeDefinition: "bounded",
      explicitValues: [],
      missingInformation: [],
      readiness: "ready",
      canProceed: true,
      clarificationQuestion: null,
      confidence: 0.9,
      source: "fallback",
      reviewStatus: "not_required",
      reasons: [],
    },
    structuredIntent: {
      schemaVersion: 1,
      primaryTargets: [],
      positiveActions: [],
      protectedScopes: [],
      allowedEditScope: "target_with_supporting_context",
      needsStyles: null,
      needsBackend: null,
      ambiguities: [],
      modelNotes: [],
    },
    source: "ollama",
    durationMs: 1,
    ...patch,
  };
}

async function run(input: {
  rawTask: string;
  files: ProjectInventoryFile[];
  taskIntent: TaskIntentAnalysis;
  taskType?: string;
}) {
  const result = await runSelectorPipeline({
    rawTask: input.rawTask,
    taskType: input.taskType ?? "general",
    targetTool: "codex",
    inventory: inventory(input.files),
    taskIntent: input.taskIntent,
    settings,
    projectRef: "canonical-core-smoke",
    mode: "shadow_primary",
  });
  assert.equal(result.diagnostics.effectivePipeline, "shadow");
  assert.ok(result.selection.diagnostics?.executionContract, "canonical contract is required");
  assert.notEqual(
    result.selection.diagnostics?.executionContract?.mode,
    undefined,
    "execution mode must never be null/undefined",
  );
  return result.selection;
}

async function testLiteralExistingTarget() {
  const target = "src/config/appMeta.ts";
  const selection = await run({
    rawTask: `In ${target} change phaseTitle to Core Validation.`,
    files: [file(target, { exports: ["appMeta"], symbols: ["appMeta"] })],
    taskIntent: intent({
      taskArea: "ui",
      taskUnderstanding: {
        ...intent().taskUnderstanding,
        targetHints: [target],
        changeDefinition: "exact",
      },
    }),
  });
  assert.equal(selection.diagnostics?.executionContract?.mode, "implementation");
  assert.deepEqual(selection.diagnostics?.executionContract?.authorization?.authorizedTargets, [
    target,
  ]);
}

async function testMissingCreateTarget() {
  const target = "server/src/routes/projectSearch.ts";
  const selection = await run({
    rawTask: `Create ${target} with a GET search endpoint. Do not change UI.`,
    files: [
      file("server/src/routes/search.ts", {
        role: "api-route",
        exports: ["searchRouter"],
        symbols: ["searchRouter"],
        textHints: ["GET", "search", "query"],
      }),
    ],
    taskIntent: intent({
      taskArea: "backend",
      taskUnderstanding: {
        ...intent().taskUnderstanding,
        action: "create",
        targetHints: [target],
        requestedChanges: [`Create ${target}`],
      },
      structuredIntent: {
        ...intent().structuredIntent,
        needsBackend: true,
        protectedScopes: ["ui"],
      },
    }),
  });
  assert.equal(selection.diagnostics?.executionContract?.mode, "implementation");
  assert.deepEqual(selection.diagnostics?.executionContract?.authorization?.authorizedTargets, [
    target,
  ]);
  assert.equal(
    selection.selectedFiles.find((selected) => selected.path === target)?.usage,
    "create-and-edit",
  );
}

async function testConfigTarget() {
  const target = "docker-compose.yml";
  const selection = await run({
    rawTask: `In ${target} add a healthcheck only for postgres.`,
    files: [file(target, { kind: "config", role: "config" })],
    taskIntent: intent({
      taskArea: "build",
      taskUnderstanding: {
        ...intent().taskUnderstanding,
        targetHints: [target],
        changeDefinition: "exact",
      },
    }),
    taskType: "build",
  });
  assert.equal(selection.diagnostics?.executionContract?.mode, "implementation");
  assert.equal(selection.effectiveTaskArea, "build");
  assert.deepEqual(selection.diagnostics?.executionContract?.authorization?.authorizedTargets, [
    target,
  ]);
}

async function testBoundedUiWithExistingApi() {
  const settingsPage = "src/pages/SettingsPage.tsx";
  const apiClient = "src/api/client.ts";
  const selection = await run({
    rawTask:
      "On the Settings page add a connection-check button. Use the existing status API and do not create a backend route.",
    files: [
      file(settingsPage, {
        role: "page",
        imports: ["../api/client"],
        exports: ["SettingsPage"],
        symbols: ["SettingsPage"],
        textHints: ["settings", "model", "button"],
      }),
      file(apiClient, {
        role: "client-api",
        exports: ["getOllamaStatus"],
        symbols: ["getOllamaStatus"],
        textHints: ["ollama", "status"],
      }),
      file("server/src/routes/ollama.ts", {
        role: "api-route",
        textHints: ["ollama", "status"],
      }),
    ],
    taskIntent: intent({
      taskArea: "ui",
      taskUnderstanding: {
        ...intent().taskUnderstanding,
        targetHints: [settingsPage],
        readiness: "review",
        reviewStatus: "accepted",
        changeDefinition: "open_ended",
      },
      structuredIntent: {
        ...intent().structuredIntent,
        primaryTargets: [
          {
            kind: "explicit_file",
            value: settingsPage,
            path: settingsPage,
            confidence: 0.9,
            evidence: "Settings surface resolved from task text.",
            provenance: "inventory_exact",
          },
        ],
        protectedScopes: ["backend/api"],
        needsBackend: false,
      },
    }),
  });
  assert.equal(selection.diagnostics?.executionContract?.mode, "implementation");
  assert.deepEqual(selection.diagnostics?.executionContract?.authorization?.authorizedTargets, [
    settingsPage,
  ]);
  assert.equal(
    selection.selectedFiles.find((selected) => selected.path === apiClient)?.usage,
    "inspect-only",
  );
  assert.equal(
    selection.selectedFiles.some((selected) => selected.path.startsWith("server/")),
    false,
  );
}

async function testStateBugIsInvestigation() {
  const selection = await run({
    rawTask:
      "After rescan the ProjectCard sometimes shows a stale readiness score. Find the real owner and fix it.",
    files: [
      file("src/components/projects/ProjectCard.tsx", {
        role: "component",
        exports: ["ProjectCard"],
        symbols: ["ProjectCard"],
        imports: ["../../hooks/useDashboardController"],
        textHints: ["readiness", "project", "score"],
      }),
      file("src/hooks/useDashboardController.ts", {
        role: "hook",
        exports: ["useDashboardController"],
        symbols: ["useDashboardController"],
        textHints: ["rescan", "readiness", "state"],
      }),
    ],
    taskIntent: intent({
      taskArea: "bugfix",
      taskUnderstanding: {
        ...intent().taskUnderstanding,
        action: "fix",
        targetHints: ["src/components/projects/ProjectCard.tsx"],
        readiness: "review",
        reviewStatus: "accepted",
        changeDefinition: "open_ended",
      },
    }),
    taskType: "bugfix",
  });
  assert.equal(selection.diagnostics?.executionContract?.mode, "investigation");
  assert.deepEqual(selection.diagnostics?.executionContract?.authorization?.authorizedTargets, []);
}

async function testContradictionIsInvestigation() {
  const selection = await run({
    rawTask:
      "Remove Validation Lab completely, but keep Validation Lab available on Reports without changing its behavior.",
    files: [
      file("src/components/reports/ValidationLab.tsx", {
        role: "component",
        exports: ["ValidationLab"],
        symbols: ["ValidationLab"],
      }),
      file("src/pages/ReportsPage.tsx", {
        role: "page",
        exports: ["ReportsPage"],
        symbols: ["ReportsPage"],
      }),
    ],
    taskIntent: intent({
      taskArea: "ui",
      taskUnderstanding: {
        ...intent().taskUnderstanding,
        action: "remove",
        targetHints: [
          "src/components/reports/ValidationLab.tsx",
          "src/pages/ReportsPage.tsx",
        ],
      },
    }),
  });
  assert.equal(selection.diagnostics?.executionContract?.mode, "investigation");
  assert.deepEqual(selection.diagnostics?.executionContract?.authorization?.authorizedTargets, []);
  assert.equal(selection.effectiveTaskArea, "ui");
}


async function testExplicitReuseKeepsSupportingProviderInspectOnly() {
  const createTarget = "server/src/routes/projectDiagnostics.ts";
  const registrationTarget = "server/src/index.ts";
  const supportRoute = "server/src/routes/projects.ts";
  const noisyRoute = "server/src/routes/taskPacks.ts";
  const selection = await run({
    rawTask:
      `Create ${createTarget} exporting projectDiagnosticsRouter with GET /:id that returns { id, name, lastScannedAt }. ` +
      `Register it in ${registrationTarget} at /api/project-diagnostics. ` +
      "Reuse the existing project storage API. Backend only; do not modify renderer files.",
    files: [
      file(registrationTarget, {
        role: "server-entry",
        exports: ["app"],
        symbols: ["app"],
        textHints: ["express", "routes"],
      }),
      file(supportRoute, {
        role: "api-route",
        imports: ["../storage/index.js"],
        exports: ["projectsRouter"],
        symbols: ["projectsRouter", "getProjectById"],
        textHints: ["project", "projects", "storage"],
        sizeBytes: 42_000,
        semanticFacts: {
          declarations: ["projectsRouter", "getProjectById"],
          references: ["storage", "getProjectById", "listProjects"],
          assignments: [],
          objectProperties: ["id", "name", "lastScannedAt"],
          stateSymbols: [],
          translationKeys: [],
          translationEntries: [],
          routePaths: ["/:id"],
        },
      }),
      file(noisyRoute, {
        role: "api-route",
        imports: ["../storage/index.js"],
        exports: ["taskPacksRouter"],
        symbols: ["taskPacksRouter", "getProjectById"],
        textHints: ["task", "pack", "project", "storage"],
        sizeBytes: 156_000,
        semanticFacts: {
          declarations: ["taskPacksRouter", "getProjectById"],
          references: ["storage", "projectId", "project"],
          assignments: [],
          objectProperties: [],
          stateSymbols: [],
          translationKeys: [],
          translationEntries: [],
          routePaths: [],
        },
      }),
      file("server/src/storage/index.ts", {
        role: "service",
        exports: ["storage"],
        symbols: ["storage", "getProjectById", "listProjects"],
        textHints: ["project", "storage"],
      }),
      file("apps/desktop/renderer/src/api/client.ts", {
        role: "client-api",
        exports: ["api"],
        symbols: ["api", "getProject"],
        textHints: ["project", "storage"],
      }),
    ],
    taskIntent: intent({
      taskArea: "backend",
      taskUnderstanding: {
        ...intent().taskUnderstanding,
        goal: "Create and register a project diagnostics route.",
        action: "create",
        targetHints: [createTarget, registrationTarget],
        requestedChanges: [
          `Create ${createTarget}`,
          `Register it in ${registrationTarget}`,
          "Reuse the existing project storage API.",
        ],
      },
      structuredIntent: {
        ...intent().structuredIntent,
        allowedEditScope: "explicit_targets_only",
        protectedScopes: ["renderer"],
        needsBackend: true,
      },
    }),
  });

  assert.equal(selection.diagnostics?.executionContract?.mode, "implementation");
  assert.equal(
    selection.selectedFiles.find((selected) => selected.path === supportRoute)
      ?.usage,
    "inspect-only",
  );
  assert.equal(
    selection.selectedFiles.some((selected) => selected.path === noisyRoute),
    false,
  );
  assert.equal(
    selection.selectedFiles.some((selected) => selected.path.includes("renderer")),
    false,
  );
  assert.deepEqual(
    [...(selection.diagnostics?.executionContract?.authorization?.authorizedTargets ?? [])].sort(),
    [createTarget, registrationTarget].sort(),
  );
}

async function testExplicitReferenceOnlyPathCannotBeAuthorized() {
  const createTarget = "server/src/routes/projectDiagnostics.ts";
  const registrationTarget = "server/src/index.ts";
  const supportRoute = "server/src/routes/projects.ts";
  const noisyRoute = "server/src/routes/taskPacks.ts";
  const selection = await run({
    rawTask:
      `Create ${createTarget} exporting projectDiagnosticsRouter with GET /:id and register it in ${registrationTarget}. ` +
      `Reuse the existing project storage API demonstrated in ${supportRoute}. ` +
      "Use that file only as reference and do not modify it. Backend only; do not modify renderer files.",
    files: [
      file(registrationTarget, {
        role: "server-entry",
        exports: ["app"],
        symbols: ["app"],
        textHints: ["express", "routes"],
      }),
      file(supportRoute, {
        role: "api-route",
        imports: ["../storage/index.js"],
        exports: ["projectsRouter"],
        symbols: ["projectsRouter", "getProjectById"],
        textHints: ["project", "projects", "storage"],
        semanticFacts: {
          declarations: ["projectsRouter", "getProjectById"],
          references: ["storage", "getProjectById", "listProjects"],
          assignments: [],
          objectProperties: ["id", "name", "lastScannedAt"],
          stateSymbols: [],
          translationKeys: [],
          translationEntries: [],
          routePaths: ["/:id"],
        },
      }),
      file(noisyRoute, {
        role: "api-route",
        imports: ["../storage/index.js"],
        exports: ["taskPacksRouter"],
        symbols: ["taskPacksRouter", "getProjectById"],
        textHints: ["task", "pack", "project", "storage"],
        sizeBytes: 156_000,
      }),
    ],
    taskIntent: intent({
      taskArea: "backend",
      taskUnderstanding: {
        ...intent().taskUnderstanding,
        goal: "Create and register a project diagnostics route.",
        action: "create",
        targetHints: [createTarget, registrationTarget, supportRoute],
        requestedChanges: [
          `Create ${createTarget}`,
          `Register it in ${registrationTarget}`,
          `Reuse ${supportRoute} as reference only.`,
        ],
      },
      structuredIntent: {
        ...intent().structuredIntent,
        primaryTargets: [
          {
            kind: "explicit_file",
            value: supportRoute,
            path: supportRoute,
            confidence: 0.98,
            evidence: "The model preserved the literal path from user text.",
            provenance: "user_confirmed",
          },
          {
            kind: "explicit_file",
            value: registrationTarget,
            path: registrationTarget,
            confidence: 0.98,
            evidence: "The user named the registration target.",
            provenance: "user_confirmed",
          },
        ],
        allowedEditScope: "explicit_targets_only",
        protectedScopes: [
          `${supportRoute} (reference only)`,
          "renderer files (do not modify)",
        ],
        needsBackend: true,
      },
    }),
  });

  assert.equal(selection.diagnostics?.executionContract?.mode, "implementation");
  assert.equal(
    selection.selectedFiles.find((selected) => selected.path === supportRoute)
      ?.usage,
    "inspect-only",
  );
  assert.equal(
    selection.selectedFiles.some((selected) => selected.path === noisyRoute),
    false,
  );
  assert.deepEqual(
    [...(selection.diagnostics?.executionContract?.authorization?.authorizedTargets ?? [])].sort(),
    [createTarget, registrationTarget].sort(),
  );
}

async function testUiApiClientOutranksConsumerPages() {
  const target = "apps/desktop/renderer/src/pages/SettingsPage.tsx";
  const client = "apps/desktop/renderer/src/api/client.ts";
  const unrelatedConsumer =
    "apps/desktop/renderer/src/pages/ContextBuilderPage.tsx";
  const selection = await run({
    rawTask:
      `In ${target} add a connection check button next to the Ollama model selector. ` +
      "Use the existing Ollama status API client. UI only; do not modify server files.",
    files: [
      file(target, {
        role: "page",
        imports: ["../api/client.js"],
        exports: ["SettingsPage"],
        symbols: ["SettingsPage", "getOllamaStatus"],
        textHints: ["ollama", "status", "model"],
      }),
      file(client, {
        role: "client-api",
        exports: ["getOllamaStatus"],
        symbols: ["getOllamaStatus"],
        textHints: ["ollama", "status", "api", "client"],
      }),
      file(unrelatedConsumer, {
        role: "page",
        imports: ["../api/client.js"],
        exports: ["ContextBuilderPage"],
        symbols: ["ContextBuilderPage", "getOllamaStatus"],
        textHints: ["ollama", "status", "api", "client"],
      }),
      file("server/src/routes/ollama.ts", {
        role: "api-route",
        exports: ["ollamaRouter"],
        symbols: ["ollamaRouter"],
        textHints: ["ollama", "status"],
      }),
    ],
    taskIntent: intent({
      taskArea: "ui",
      taskUnderstanding: {
        ...intent().taskUnderstanding,
        goal: "Add a bounded Ollama connection check control.",
        action: "update",
        targetHints: [target],
        requestedChanges: [
          "Add a connection check button.",
          "Reuse the existing Ollama status API client.",
        ],
      },
      structuredIntent: {
        ...intent().structuredIntent,
        allowedEditScope: "explicit_targets_only",
        protectedScopes: ["server", "backend"],
        needsBackend: false,
      },
    }),
  });

  assert.equal(selection.diagnostics?.executionContract?.mode, "implementation");
  assert.equal(
    selection.selectedFiles.find((selected) => selected.path === client)?.usage,
    "inspect-only",
  );
  assert.equal(
    selection.selectedFiles.some(
      (selected) => selected.path === unrelatedConsumer,
    ),
    false,
  );
  assert.equal(
    selection.selectedFiles.some((selected) => selected.path.startsWith("server/")),
    false,
  );
  assert.deepEqual(
    selection.diagnostics?.executionContract?.authorization?.authorizedTargets,
    [target],
  );
}

async function testModelProposalIsNotUserConfirmation() {
  const proposed = "src/pages/DashboardPage.tsx";
  const selection = await run({
    rawTask: "Make the overview more useful and modern.",
    files: [
      file(proposed, {
        role: "page",
        exports: ["DashboardPage"],
        symbols: ["DashboardPage"],
        textHints: ["overview", "dashboard"],
      }),
    ],
    taskIntent: intent({
      taskArea: "ui",
      taskUnderstanding: {
        ...intent().taskUnderstanding,
        readiness: "review",
        reviewStatus: "accepted",
        changeDefinition: "open_ended",
      },
      structuredIntent: {
        ...intent().structuredIntent,
        primaryTargets: [
          {
            kind: "explicit_file",
            value: proposed,
            path: proposed,
            confidence: 0.8,
            evidence: "Model proposal only.",
            provenance: "model_proposed",
          },
        ],
        needsStyles: true,
      },
    }),
  });
  assert.equal(selection.diagnostics?.executionContract?.mode, "investigation");
  assert.deepEqual(selection.diagnostics?.executionContract?.authorization?.authorizedTargets, []);
  assert.equal(
    selection.selectedFiles.some(
      (selected) => selected.evidenceLevel === "user_confirmed",
    ),
    false,
  );
}


async function testGroupedReferenceOnlyProvidersRemainInspectOnly() {
  const createTarget = "src/app/runSummary.ts";
  const registrationTarget = "src/server.ts";
  const providerOne = "src/db/queries.ts";
  const providerTwo = "src/db/database.ts";
  const selection = await run({
    rawTask:
      `Create ${createTarget} exporting buildRunSummary and add GET /api/runs/:id/summary in ${registrationTarget}. ` +
      `Use ${providerOne} and ${providerTwo} only as reference providers; do not modify those provider files.`,
    files: [
      file(registrationTarget, {
        role: "server-entry",
        exports: ["app"],
        symbols: ["app"],
      }),
      file(providerOne, {
        role: "repository",
        exports: ["getRunResults"],
        symbols: ["getRunResults"],
      }),
      file(providerTwo, {
        role: "db-schema",
        exports: ["initDatabase"],
        symbols: ["initDatabase"],
      }),
    ],
    taskIntent: intent({
      taskArea: "backend",
      taskUnderstanding: {
        ...intent().taskUnderstanding,
        action: "create",
        targetHints: [
          createTarget,
          registrationTarget,
          providerOne,
          providerTwo,
        ],
        requestedChanges: [
          `Create ${createTarget}`,
          `Update ${registrationTarget}`,
        ],
      },
      structuredIntent: {
        ...intent().structuredIntent,
        allowedEditScope: "explicit_targets_only",
        protectedScopes: [
          `${providerOne} (reference only)`,
          `${providerTwo} (reference only)`,
        ],
        needsBackend: true,
      },
    }),
  });

  assert.equal(selection.diagnostics?.executionContract?.mode, "implementation");
  assert.equal(
    selection.selectedFiles.find((selected) => selected.path === providerOne)
      ?.usage,
    "inspect-only",
  );
  assert.equal(
    selection.selectedFiles.find((selected) => selected.path === providerTwo)
      ?.usage,
    "inspect-only",
  );
  assert.deepEqual(
    [...(selection.diagnostics?.executionContract?.authorization?.authorizedTargets ?? [])].sort(),
    [createTarget, registrationTarget].sort(),
  );
}

async function testGroupedReferenceOnlyProvidersAreRecoveredFromRawTask() {
  const createTarget = "server/routes/profileSummary.ts";
  const registrationTarget = "server/index.ts";
  const providerOne = "server/auth.ts";
  const providerTwo = "server/db.ts";
  const selection = await run({
    rawTask:
      `Create ${createTarget} and wire it in ${registrationTarget}. ` +
      `Use ${providerOne} and ${providerTwo} only as reference providers; do not modify either provider file.`,
    files: [
      file(registrationTarget, {
        role: "server-entry",
        exports: ["server"],
        symbols: ["server"],
      }),
      file(providerOne, {
        role: "service",
        exports: ["requireAuth"],
        symbols: ["requireAuth"],
      }),
      file(providerTwo, {
        role: "repository",
        exports: ["db"],
        symbols: ["db"],
      }),
    ],
    taskIntent: intent({
      taskArea: "backend",
      taskUnderstanding: {
        ...intent().taskUnderstanding,
        action: "create",
        targetHints: [
          createTarget,
          registrationTarget,
          providerOne,
          providerTwo,
        ],
      },
      structuredIntent: {
        ...intent().structuredIntent,
        // Simulate an upstream model that incorrectly promoted the first
        // provider and omitted protection metadata. Raw user wording remains
        // the final authority for the complete protected group.
        primaryTargets: [
          {
            kind: "explicit_file",
            value: registrationTarget,
            path: registrationTarget,
            confidence: 0.98,
            evidence: "The user named the registration file.",
            provenance: "user_confirmed",
          },
          {
            kind: "explicit_file",
            value: providerOne,
            path: providerOne,
            confidence: 0.98,
            evidence: "Upstream fallback misclassified the first provider.",
            provenance: "user_confirmed",
          },
        ],
        protectedScopes: [],
        allowedEditScope: "explicit_targets_only",
        needsBackend: true,
      },
    }),
  });

  assert.equal(selection.diagnostics?.executionContract?.mode, "implementation");
  assert.equal(
    selection.selectedFiles.find((selected) => selected.path === providerOne)
      ?.usage,
    "inspect-only",
  );
  assert.equal(
    selection.selectedFiles.find((selected) => selected.path === providerTwo)
      ?.usage,
    "inspect-only",
  );
  assert.deepEqual(
    [...(selection.diagnostics?.executionContract?.authorization?.authorizedTargets ?? [])].sort(),
    [createTarget, registrationTarget].sort(),
  );
}

async function testExportedTypeRenameDestinationConflictIsInvestigation() {
  const owner = "client/src/api.ts";
  const selection = await run({
    rawTask:
      "Rename the exported TypeScript type User to RunRow and update every import and usage.",
    files: [
      file(owner, {
        role: "client-api",
        exports: ["User", "RunRow"],
        symbols: ["User", "RunRow"],
        semanticFacts: {
          declarations: ["User", "RunRow"],
          references: [],
          assignments: [],
          objectProperties: [],
          stateSymbols: [],
          translationKeys: [],
          translationEntries: [],
          routePaths: [],
          symbolSyntax: {
            parser: "js-ts-lexical-v1",
            declarations: ["User", "RunRow"],
            references: ["User", "RunRow"],
            imports: [],
            exports: ["User", "RunRow"],
            symbols: ["User", "RunRow"],
            moduleSpecifiers: [],
          },
        },
      }),
    ],
    taskIntent: intent({
      taskArea: "ui",
      taskUnderstanding: {
        ...intent().taskUnderstanding,
        action: "refactor",
        targetHints: ["User", "RunRow"],
      },
    }),
  });

  assert.equal(selection.diagnostics?.executionContract?.mode, "investigation");
  assert.deepEqual(
    selection.diagnostics?.executionContract?.authorization?.authorizedTargets,
    [],
  );
  assert.equal(selection.selectedFiles.length, 0);
}

async function testExportedTypeRenameWithOwnerPathChecksDestinationFirst() {
  const owner = "client/src/api.ts";
  const unrelated = "client/src/pages/Imports.tsx";
  const selection = await run({
    rawTask:
      `Rename the exported TypeScript type User in ${owner} to RunRow and ` +
      "update all imports and usages without changing any other declaration.",
    files: [
      file(owner, {
        role: "client-api",
        exports: ["User", "RunRow"],
        symbols: ["User", "RunRow"],
        semanticFacts: {
          declarations: ["User", "RunRow"],
          references: [],
          assignments: [],
          objectProperties: [],
          stateSymbols: [],
          translationKeys: [],
          translationEntries: [],
          routePaths: [],
          symbolSyntax: {
            parser: "js-ts-lexical-v1",
            declarations: ["User", "RunRow"],
            references: ["User", "RunRow"],
            imports: [],
            exports: ["User", "RunRow"],
            symbols: ["User", "RunRow"],
            moduleSpecifiers: [],
          },
        },
      }),
      file(unrelated, {
        role: "page",
        exports: ["Imports"],
        symbols: ["Imports", "RunRow"],
        textHints: ["imports", "runs", "rows"],
      }),
    ],
    taskIntent: intent({
      taskArea: "build",
      taskUnderstanding: {
        ...intent().taskUnderstanding,
        action: "replace",
        targetHints: [owner],
        changeDefinition: "exact",
      },
      structuredIntent: {
        ...intent().structuredIntent,
        primaryTargets: [],
      },
    }),
  });

  assert.equal(selection.diagnostics?.executionContract?.mode, "investigation");
  assert.deepEqual(
    selection.diagnostics?.executionContract?.authorization?.authorizedTargets,
    [],
  );
  assert.equal(selection.selectedFiles.length, 0);
}

async function testUntrustedSameStemUiProposalCannotBecomeEditable() {
  const realSurface = "src/pages/DevicesPage.tsx";
  const hallucinatedSurface = "src/pages/ConnectPage.tsx";
  const selection = await run({
    rawTask:
      "On the connected devices pairing code screen, clarify the helper text. Do not change backend behavior.",
    files: [
      file(realSurface, {
        role: "page",
        exports: ["DevicesPage"],
        symbols: ["DevicesPage"],
        textHints: ["connected devices", "pairing code", "helper text"],
      }),
      file(hallucinatedSurface, {
        role: "page",
        exports: ["ConnectPage"],
        symbols: ["ConnectPage"],
        textHints: ["connect account"],
      }),
    ],
    taskIntent: intent({
      taskArea: "ui",
      taskUnderstanding: {
        ...intent().taskUnderstanding,
        goal: "Clarify helper text on the connected devices pairing screen.",
        action: "update",
        changeDefinition: "bounded",
      },
      structuredIntent: {
        ...intent().structuredIntent,
        primaryTargets: [
          {
            kind: "component",
            value: "ConnectPage",
            path: hallucinatedSurface,
            confidence: 0.91,
            evidence: "Model inferred a same-stem page from the word connected.",
            provenance: "model_proposed",
          },
        ],
        protectedScopes: ["backend"],
        needsBackend: false,
      },
    }),
  });

  assert.equal(
    selection.diagnostics?.executionContract?.authorization?.authorizedTargets.includes(
      hallucinatedSurface,
    ),
    false,
  );
  assert.notEqual(
    selection.selectedFiles.find((selected) => selected.path === hallucinatedSurface)
      ?.usage,
    "inspect-and-edit",
  );
}

async function main() {
  await testLiteralExistingTarget();
  await testMissingCreateTarget();
  await testConfigTarget();
  await testBoundedUiWithExistingApi();
  await testStateBugIsInvestigation();
  await testContradictionIsInvestigation();
  await testExplicitReuseKeepsSupportingProviderInspectOnly();
  await testExplicitReferenceOnlyPathCannotBeAuthorized();
  await testUiApiClientOutranksConsumerPages();
  await testModelProposalIsNotUserConfirmation();
  await testGroupedReferenceOnlyProvidersRemainInspectOnly();
  await testGroupedReferenceOnlyProvidersAreRecoveredFromRawTask();
  await testExportedTypeRenameDestinationConflictIsInvestigation();
  await testExportedTypeRenameWithOwnerPathChecksDestinationFirst();
  await testUntrustedSameStemUiProposalCannotBecomeEditable();
  console.log("canonical core decision smoke passed: 15 scenarios");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
