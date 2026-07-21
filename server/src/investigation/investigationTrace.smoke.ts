import assert from "node:assert/strict";
import path from "node:path";

import type { ProjectInventory, ProjectInventoryFile } from "../scanner/projectInventoryScanner.js";
import { scanProjectInventory } from "../scanner/projectInventoryScanner.js";
import type { AppSettings } from "../settings/settingsService.js";
import type { TaskExecutionContract } from "../taskPacks/taskExecutionContract.js";
import type { TaskIntentAnalysis } from "../ollama/taskIntentAnalyzer.js";
import { selectTaskFiles } from "../ollama/taskFileSelector.js";
import { runInvestigationTrace } from "./investigationTraceEngine.js";

const testSettings: AppSettings = {
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
  selectorPipelineMode: "legacy",
  taskUnderstandingInteractionMode: "balanced",
  sidebarShowDescriptions: false,
  onboardingEnabled: true,
  onboardingShowEveryLaunch: true,
  onboardingCompleted: false,
};

function sourceFile(filePath: string, options: Partial<ProjectInventoryFile> = {}): ProjectInventoryFile {
  const name = filePath.split("/").pop() ?? filePath;
  return {
    path: filePath,
    name,
    extension: name.includes(".") ? `.${name.split(".").pop()}` : "",
    kind: "source",
    role: "utility",
    imports: [],
    exports: [],
    symbols: [],
    textHints: [],
    contentPreview: "",
    sizeBytes: 500,
    depth: filePath.split("/").length - 1,
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

function structuredIntent(overrides: Partial<TaskIntentAnalysis> = {}): TaskIntentAnalysis {
  return {
    taskArea: "ui",
    intentTags: [],
    domainTerms: [],
    mentionedEntities: [],
    fileRoleHints: [],
    recommendedSearchTerms: [],
    riskLevel: "medium",
    confidence: 0.86,
    notes: ["Synthetic intent for investigation trace e2e tests."],
    taskUnderstanding: {
      schemaVersion: 1,
      goal: "Synthetic investigation task.",
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
      confidence: 0.86,
      source: "fallback",
      reasons: ["Synthetic task understanding."],
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
    source: "fallback",
    durationMs: 1,
    ...overrides,
  };
}

async function selectE2E(input: {
  rawTask: string;
  files: ProjectInventoryFile[];
  taskType?: string;
  taskIntent?: TaskIntentAnalysis;
}) {
  return selectTaskFiles({
    rawTask: input.rawTask,
    taskType: input.taskType ?? "general",
    targetTool: "codex",
    inventory: inventory(input.files),
    settings: testSettings,
    taskIntent: input.taskIntent,
  });
}

function investigationContract(layers: TaskExecutionContract["requiredLayers"] = []): TaskExecutionContract {
  return {
    schemaVersion: 2,
    mode: "investigation",
    requiredLayers: layers,
    candidateLayerCoverage: [],
    confirmedLayerCoverage: [],
    missingConfirmedLayers: layers,
    confirmedTargets: [],
    targetEvidence: [],
    proposedTargets: [],
    unresolvedDecisions: [],
    forbiddenAssumptions: [],
    allowImplementationGuidance: false,
    requiresLayerCoverage: layers.length > 1,
    implementationGateReasons: ["Synthetic investigation gate."],
    reasons: ["Execution mode: investigation."],
  };
}

function trace(project: ProjectInventory, rawTask: string, seedPath: string, layers: TaskExecutionContract["requiredLayers"] = []) {
  return runInvestigationTrace({
    rawTask,
    inventory: project,
    contract: investigationContract(layers),
    selectedFiles: [{
      path: seedPath,
      kind: project.files.find((file) => file.path === seedPath)?.kind ?? "source",
      usage: "inspect-only",
      reason: "seed",
      confidence: 0.5,
      evidenceLevel: "user_confirmed",
    }],
  });
}

async function run() {
  let scenarios = 0;

  {
    const project = inventory([
      sourceFile("src/components/Child.tsx", {
        role: "component",
        contentPreview: "export function Child({ diagnostics }) { return <div>{diagnostics.status}</div>; }",
      }),
      sourceFile("src/pages/Parent.tsx", {
        role: "page",
        imports: ["../components/Child"],
        contentPreview: "import { Child } from '../components/Child'; export function Parent(){ const [diagnostics,setDiagnostics]=useState(null); return <Child diagnostics={diagnostics}/> }",
      }),
      sourceFile("src/hooks/useController.ts", {
        role: "hook",
        contentPreview: "export function useController(){ const [diagnostics,setDiagnostics]=useState(null); return { diagnostics, setDiagnostics }; }",
      }),
    ]);
    const result = trace(project, "Fix stale diagnostics state after regeneration", "src/components/Child.tsx", ["ui", "state"]);
    assert.ok(result.edges.some((edge) => edge.type === "imported_by" || edge.type === "passes_prop"));
    assert.ok(result.edges.some((edge) => edge.type === "receives_prop"), "received props should be represented as real AST edges");
    assert.ok(result.edges.some((edge) => edge.type === "state_setter"), "state variable/setter pairs should be represented as real AST edges");
    assert.ok(result.nodes.some((node) => node.semanticRole === "consumer-display"));
    assert.ok(!result.outcome.confirmedOwners.includes("src/components/Child.tsx"), "consumer should not become owner");
    scenarios += 1;
  }

  {
    const project = inventory([
      sourceFile("server/src/routes/projects.ts", {
        role: "api-route",
        contentPreview: "router.post('/projects/:id/issues', async (req,res)=> saveIssueMetadata(req.body));",
        semanticFacts: {
          declarations: ["projectsRouter"],
          references: ["saveIssueMetadata", "issueMetadata"],
          assignments: [],
          objectProperties: ["issueMetadata"],
          stateSymbols: [],
          translationKeys: [],
          translationEntries: [],
          routePaths: ["/projects/:id/issues"],
        },
      }),
      sourceFile("server/src/storage/issues.ts", {
        role: "repository",
        contentPreview: "export async function saveIssueMetadata(issueMetadata){ return db.insert(issueMetadata); }",
        semanticFacts: {
          declarations: ["saveIssueMetadata"],
          references: ["issueMetadata", "db"],
          assignments: [],
          objectProperties: ["issueMetadata"],
          stateSymbols: [],
          translationKeys: [],
          translationEntries: [],
          routePaths: [],
        },
      }),
      sourceFile("apps/renderer/src/api/client.ts", {
        role: "client-api",
        contentPreview: "export function saveIssueMetadata(issueMetadata){ return fetch('/projects/1/issues', { method: 'POST', body: JSON.stringify(issueMetadata) }); }",
      }),
    ]);
    const result = trace(project, "Add API endpoint to save issue metadata", "server/src/routes/projects.ts", ["backend", "storage"]);
    assert.ok(result.outcome.confirmedOwners.includes("server/src/storage/issues.ts"));
    assert.ok(result.edges.some((edge) => edge.type === "defines_symbol" || edge.type === "route_registration"));
    assert.ok(result.edges.some((edge) => edge.type === "route_registration"), "route registrations should be real trace edges");
    assert.ok(result.edges.some((edge) => edge.type === "api_request"), "route/API request literals should be real trace edges");
    scenarios += 1;
  }

  {
    const project = inventory([
      sourceFile("src/components/Sidebar.tsx", {
        role: "component",
        contentPreview: "const item = { labelKey: 'nav.settings' }; export function Sidebar(){ return t(item.labelKey); }",
        semanticFacts: {
          declarations: ["Sidebar"],
          references: ["labelKey", "nav.settings", "t"],
          assignments: [],
          objectProperties: ["labelKey"],
          stateSymbols: [],
          translationKeys: ["nav.settings"],
          translationEntries: [],
          routePaths: [],
        },
      }),
      sourceFile("src/i18n/index.ts", {
        role: "config",
        contentPreview: "export const resources = { en: { nav: { settings: 'Settings' } }, ru: { nav: { settings: 'Настройки' } } };",
        semanticFacts: {
          declarations: ["resources"],
          references: ["nav", "settings"],
          assignments: [],
          objectProperties: ["nav", "settings"],
          stateSymbols: [],
          translationKeys: [],
          translationEntries: [
            { key: "nav.settings", value: "Settings" },
            { key: "nav.settings", value: "Настройки" },
          ],
          routePaths: [],
        },
      }),
    ]);
    const result = trace(project, "В компоненте Sidebar замени подпись Settings на Настройки", "src/components/Sidebar.tsx", ["ui"]);
    assert.ok(result.outcome.confirmedOwners.includes("src/i18n/index.ts"));
    assert.ok(result.outcome.references.includes("src/components/Sidebar.tsx"));
    scenarios += 1;
  }

  {
    const project = inventory([
      sourceFile("src/a.ts", {
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
      sourceFile("src/b.ts", {
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
    const result = trace(project, "Inspect sharedStatus", "src/a.ts", ["state"]);
    assert.equal(result.outcome.confirmedOwners.length, 0, "same property alone is not a data-flow chain");
    scenarios += 1;
  }

  {
    const project = inventory([
      sourceFile("src/performance/performanceTrace.ts", {
        contentPreview: "export const modelLoadMs = 42; export function getDiagnostics(){ return { modelLoadMs }; }",
        semanticFacts: {
          declarations: ["modelLoadMs", "getDiagnostics"],
          references: ["modelLoadMs"],
          assignments: ["modelLoadMs"],
          objectProperties: ["modelLoadMs"],
          stateSymbols: [],
          translationKeys: [],
          translationEntries: [],
          routePaths: [],
        },
      }),
      sourceFile("src/providers/providerService.ts", {
        contentPreview: "export function loadModel(model){ return model.status; }",
        semanticFacts: {
          declarations: ["loadModel"],
          references: ["model", "status"],
          assignments: [],
          objectProperties: ["model", "status"],
          stateSymbols: [],
          translationKeys: [],
          translationEntries: [],
          routePaths: [],
        },
      }),
      sourceFile("src/taskUnderstanding.ts", {
        contentPreview: "export function understandTask(task){ return { model: task.model }; }",
        semanticFacts: {
          declarations: ["understandTask"],
          references: ["task", "model"],
          assignments: [],
          objectProperties: ["task", "model"],
          stateSymbols: [],
          translationKeys: [],
          translationEntries: [],
          routePaths: [],
        },
      }),
    ]);
    const result = trace(project, "Show modelLoadMs in performance diagnostics", "src/performance/performanceTrace.ts", ["backend"]);
    assert.ok(result.outcome.confirmedOwners.includes("src/performance/performanceTrace.ts"));
    assert.ok(!result.outcome.confirmedOwners.includes("src/providers/providerService.ts"), "generic model/status symbols must not confirm provider owner");
    assert.ok(!result.outcome.confirmedOwners.includes("src/taskUnderstanding.ts"), "generic model/task symbols must not confirm understanding owner");
    scenarios += 1;
  }

  {
    const project = inventory([
      sourceFile("src/pages/AuthPage.tsx", {
        role: "page",
        contentPreview: "export function AuthPage(){ return <button>Login</button>; }",
      }),
      sourceFile("src/pages/RepositoryIntegrationPage.tsx", {
        role: "page",
        contentPreview: "export function RepositoryIntegrationPage(){ return <button>Connect repository</button>; }",
      }),
    ]);
    const result = trace(
      project,
      "Добавь вход через OAuth. Это отдельная авторизация в приложение, не существующее подключение репозиториев.",
      "src/pages/RepositoryIntegrationPage.tsx",
      ["ui"],
    );
    const repoNode = result.nodes.find((node) => node.path === "src/pages/RepositoryIntegrationPage.tsx");
    assert.ok(repoNode?.rejectionReason, "negative constraint should keep conflicting repository integration reference-only");
    assert.ok(!result.outcome.confirmedOwners.includes("src/pages/RepositoryIntegrationPage.tsx"));
    scenarios += 1;
  }

  {
    const project = inventory([
      sourceFile("src/notRoutes.ts", {
        contentPreview: `
          const map = new Map();
          map.get("/settings");
          cache.get("key");
          items.find((item) => item.id === "x");
          object.use("value");
        `,
      }),
    ]);
    const result = trace(project, "Inspect settings cache lookup", "src/notRoutes.ts", ["backend"]);
    assert.equal(result.edges.some((edge) => edge.type === "route_registration"), false, "Map.get/cache.get must not become route registrations");
    assert.equal(result.edges.some((edge) => edge.type === "router_mount"), false, "arbitrary object.use must not become router mount");
    scenarios += 1;
  }

  {
    const project = inventory([
      sourceFile("src/ComponentA.tsx", {
        role: "component",
        contentPreview: "export function ComponentA({ status }) { return <div>{status}</div>; }",
      }),
      sourceFile("src/ComponentB.tsx", {
        role: "component",
        contentPreview: "export function ComponentB({ status }) { return <div>{status}</div>; }",
      }),
      sourceFile("src/Page.tsx", {
        role: "page",
        imports: ["./ComponentB"],
        contentPreview: "import { ComponentB } from './ComponentB'; export function Page(){ const status = 'ok'; return <ComponentB status={status}/>; }",
      }),
    ]);
    const result = trace(project, "Review ComponentA status rendering", "src/ComponentA.tsx", ["ui"]);
    assert.equal(
      result.edges.some((edge) => edge.type === "passes_prop" && edge.from === "src/Page.tsx" && edge.to === "src/ComponentA.tsx"),
      false,
      "same prop name on another component must not create passes_prop",
    );
    scenarios += 1;
  }

  {
    const project = inventory([
      sourceFile("src/tuple.ts", {
        contentPreview: "const [value, setValue] = parseTuple(); setValue('x'); export { value, setValue };",
      }),
    ]);
    const result = trace(project, "Fix stale value state", "src/tuple.ts", ["state"]);
    assert.equal(result.edges.some((edge) => edge.type === "state_setter"), false, "arbitrary tuple destructuring must not create state pair");
    assert.equal(result.outcome.confirmedOwners.includes("src/tuple.ts"), false, "arbitrary tuple must not confirm state owner");
    scenarios += 1;
  }

  {
    const project = inventory([
      sourceFile("src/seed.ts", {
        contentPreview: "export const seed = true;",
      }),
      sourceFile("src/statusLabelOwner.ts", {
        contentPreview: "export const statusLabel = 'Ready';",
        semanticFacts: {
          declarations: ["statusLabel"],
          references: ["statusLabel"],
          assignments: ["statusLabel"],
          objectProperties: ["statusLabel"],
          stateSymbols: [],
          translationKeys: [],
          translationEntries: [],
          routePaths: [],
        },
      }),
    ]);
    const result = runInvestigationTrace({
      rawTask: "Review seed behavior",
      inventory: project,
      contract: investigationContract(["ui"]),
      selectedFiles: [{
        path: "src/seed.ts",
        kind: "source",
        usage: "inspect-only",
        reason: "seed",
        confidence: 0.5,
        evidenceLevel: "model_proposed",
      }],
      omittedSeeds: [{ path: "src/statusLabelOwner.ts", reason: "Followed exact symbol owner for statusLabel." }],
    });
    assert.equal(
      result.outcome.confirmedOwners.includes("src/statusLabelOwner.ts"),
      false,
      "hypothesis text must not introduce task evidence",
    );
    scenarios += 1;
  }

  {
    const result = await selectE2E({
      rawTask: "In Sidebar replace label Settings with \"Preferences\".",
      taskType: "ui",
      files: [
        sourceFile("src/components/Sidebar.tsx", {
          role: "component",
          contentPreview: "const item = { labelKey: 'nav.settings' }; export function Sidebar(){ return t(item.labelKey); }",
          semanticFacts: {
            declarations: ["Sidebar"],
            references: ["labelKey", "nav.settings", "t"],
            assignments: [],
            objectProperties: ["labelKey"],
            stateSymbols: [],
            translationKeys: ["nav.settings"],
            translationEntries: [],
            routePaths: [],
          },
        }),
        sourceFile("src/i18n/index.ts", {
          role: "config",
          contentPreview: "export const resources = { en: { nav: { settings: 'Settings' } } };",
          semanticFacts: {
            declarations: ["resources"],
            references: ["nav", "settings"],
            assignments: [],
            objectProperties: ["nav", "settings"],
            stateSymbols: [],
            translationKeys: [],
            translationEntries: [{ key: "nav.settings", value: "Settings" }],
            routePaths: [],
          },
        }),
        sourceFile("src/pages/SettingsPage.tsx", { role: "page", symbols: ["SettingsPage"], contentPreview: "export function SettingsPage(){ return null; }" }),
        sourceFile("src/components/SlidingSelectionIndicator.tsx", { role: "component", contentPreview: "export function SlidingSelectionIndicator(){ return null; }" }),
      ],
      taskIntent: structuredIntent({
        taskArea: "ui",
        taskUnderstanding: {
          ...structuredIntent().taskUnderstanding,
          goal: "Replace the visible Sidebar settings label with Preferences.",
          action: "replace",
          targetHints: ["src/components/Sidebar.tsx"],
          requestedChanges: ["Replace the exact visible label."],
          changeDefinition: "exact",
          explicitValues: [{ kind: "text", value: "Preferences", exact: true, source: "user" }],
        },
        structuredIntent: {
          ...structuredIntent().structuredIntent,
          primaryTargets: [{
            kind: "component",
            value: "Sidebar",
            path: "src/components/Sidebar.tsx",
            confidence: 0.95,
            provenance: "user_confirmed",
            evidence: "User named Sidebar.",
          }],
        },
      }),
    });
    assert.equal(result.diagnostics?.investigationTrace, undefined, "Exact localization should use deterministic final reconciliation instead of a broad trace");
    assert.equal(result.diagnostics?.taskProfile, "exact-text");
    assert.ok(result.selectedFiles.some((file) => file.path === "src/i18n/index.ts" && file.usage === "inspect-and-edit"), "i18n owner should be present");
    assert.ok(result.selectedFiles.some((file) => file.path === "src/components/Sidebar.tsx" && file.usage === "inspect-only"), "Sidebar should be consumer/reference");
    assert.equal(result.selectedFiles.some((file) => /SettingsPage|SlidingSelectionIndicator/.test(file.path)), false);
    assert.ok(result.selectedFiles.length <= 3);
    scenarios += 1;
  }

  {
    const result = await selectE2E({
      rawTask: "Add boolean field showing whether Understanding Snapshot was reused.",
      taskType: "backend",
      files: [
        sourceFile("server/src/routes/taskPacks.ts", {
          role: "api-route",
          contentPreview: "router.post('/task-understanding', async (req,res)=> res.json({ understandingSnapshotReused })); const understandingSnapshotReused = true;",
          semanticFacts: {
            declarations: ["understandingSnapshotReused"],
            references: ["understandingSnapshotReused", "router"],
            assignments: ["understandingSnapshotReused"],
            objectProperties: ["understandingSnapshotReused"],
            stateSymbols: [],
            translationKeys: [],
            translationEntries: [],
            routePaths: ["/task-understanding"],
          },
        }),
        sourceFile("server/src/taskPacks/taskUnderstandingSnapshot.ts", {
          role: "service",
          contentPreview: "export interface PersistedSnapshot { id: string; }",
          semanticFacts: {
            declarations: ["PersistedSnapshot"],
            references: ["snapshot"],
            assignments: [],
            objectProperties: ["id"],
            stateSymbols: [],
            translationKeys: [],
            translationEntries: [],
            routePaths: [],
          },
        }),
        sourceFile("server/src/selection/explicitTargetGuard.ts", { role: "utility", contentPreview: "export function guardUnderstandingTarget(understanding){ return understanding; }" }),
      ],
      taskIntent: structuredIntent({
        taskArea: "backend",
        domainTerms: ["understandingSnapshotReused", "snapshot", "api"],
        taskUnderstanding: {
          ...structuredIntent().taskUnderstanding,
          action: "create",
          targetHints: ["server/src/routes/taskPacks.ts"],
          requestedChanges: ["add understandingSnapshotReused field"],
        },
      }),
    });
    const traceResult = result.diagnostics?.investigationTrace;
    assert.ok(traceResult?.nodes.some((node) => node.inspectedSymbols.some((symbol) => /understandingsnapshotreused/i.test(symbol))));
    assert.equal(traceResult?.outcome.confirmedOwners.some((owner) => /explicitTargetGuard|index\.ts$/.test(owner)), false);
    assert.equal(traceResult?.outcome.confirmedOwners.includes("server/src/taskPacks/taskUnderstandingSnapshot.ts"), false);
    scenarios += 1;
  }

  {
    const result = await selectE2E({
      rawTask: "Show modelLoadMs in performance diagnostics backend and UI.",
      taskType: "fullstack",
      files: [
        sourceFile("server/src/performance/performanceTrace.ts", {
          role: "service",
          contentPreview: "export const modelLoadMs = 42; export function getDiagnostics(){ return { modelLoadMs }; }",
          semanticFacts: {
            declarations: ["modelLoadMs", "getDiagnostics"],
            references: ["modelLoadMs"],
            assignments: ["modelLoadMs"],
            objectProperties: ["modelLoadMs"],
            stateSymbols: [],
            translationKeys: [],
            translationEntries: [],
            routePaths: [],
          },
        }),
        sourceFile("apps/desktop/renderer/src/components/PerformanceDiagnosticsModal.tsx", {
          role: "component",
          contentPreview: "export function PerformanceDiagnosticsModal({ diagnostics }) { return <span>{diagnostics.modelLoadMs}</span>; }",
        }),
        sourceFile("server/src/contextComposer/contextComposerService.ts", { role: "service", contentPreview: "export interface SelectorPipelineDiagnostics { model: string }" }),
        sourceFile("server/src/providerService.ts", { role: "service", contentPreview: "export function loadModel(model){ return model.status; }" }),
        sourceFile("server/src/taskUnderstanding.ts", { role: "service", contentPreview: "export function understandTask(task){ return task.model; }" }),
      ],
      taskIntent: structuredIntent({
        taskArea: "fullstack",
        domainTerms: ["modelLoadMs", "performance", "diagnostics"],
        taskUnderstanding: {
          ...structuredIntent().taskUnderstanding,
          targetHints: ["PerformanceDiagnosticsModal"],
          requestedChanges: ["show modelLoadMs"],
        },
      }),
    });
    assert.ok(result.selectedFiles.some((file) => file.path === "server/src/performance/performanceTrace.ts"));
    assert.equal(result.diagnostics?.investigationTrace?.outcome.confirmedOwners.some((owner) => /contextComposerService|providerService|taskUnderstanding|i18n/.test(owner)), false);
    scenarios += 1;
  }

  {
    const result = await selectE2E({
      rawTask: "Fix stale cache status after regeneration.",
      taskType: "bugfix",
      files: [
        sourceFile("src/components/GenerationDiagnosticsModal.tsx", {
          role: "component",
          contentPreview: "export function GenerationDiagnosticsModal({ diagnostics }) { return <div>{diagnostics.cacheStatus}</div>; }",
        }),
        sourceFile("src/pages/TaskPackResultPage.tsx", {
          role: "page",
          imports: ["../components/GenerationDiagnosticsModal"],
          contentPreview: "import { GenerationDiagnosticsModal } from '../components/GenerationDiagnosticsModal'; export function TaskPackResultPage({ currentTaskPack }){ return <GenerationDiagnosticsModal diagnostics={currentTaskPack.generationDiagnostics}/>; }",
        }),
        sourceFile("src/pages/GitHubPage.tsx", {
          role: "page",
          contentPreview: "export function GitHubPage(){ const [status,setStatus]=useState('idle'); setStatus('ok'); return <div>{status}</div>; }",
        }),
        sourceFile("src/components/GitContextCard.tsx", {
          role: "component",
          contentPreview: "export function GitContextCard(){ const [status,setStatus]=useState('idle'); setStatus('ok'); return <div>{status}</div>; }",
        }),
      ],
      taskIntent: structuredIntent({
        taskArea: "bugfix",
        taskUnderstanding: {
          ...structuredIntent().taskUnderstanding,
          action: "fix",
          targetHints: ["GenerationDiagnosticsModal"],
          requestedChanges: ["fix stale cache status"],
        },
      }),
    });
    const traceResult = result.diagnostics?.investigationTrace;
    assert.ok(traceResult?.nodes.some((node) => node.path === "src/components/GenerationDiagnosticsModal.tsx" && node.semanticRole === "consumer-display"));
    assert.ok(traceResult?.nodes.some((node) => node.path === "src/pages/TaskPackResultPage.tsx"), "JSX caller should be found");
    assert.equal(traceResult?.outcome.confirmedOwners.some((owner) => /GitHubPage|GitContextCard/.test(owner)), false);
    assert.equal(traceResult?.outcome.confirmedOwners.filter((owner) => /GitHubPage|GitContextCard/.test(owner)).length, 0);
    scenarios += 1;
  }

  {
    const result = await selectE2E({
      rawTask: "Добавь вход пользователя в ContextForge через GitHub OAuth. Нужны кнопка входа в UI, backend-обработка OAuth callback и пользовательская сессия. Это отдельная авторизация в приложение, не существующее подключение GitHub-репозиториев.",
      taskType: "fullstack",
      files: [
        sourceFile("src/pages/IntegrationsPage.tsx", { role: "page", contentPreview: "export function IntegrationsPage(){ return <button>Connect GitHub repository</button>; }" }),
        sourceFile("server/src/github/githubAuthService.ts", { role: "service", contentPreview: "export function connectRepository(){ return 'repo'; }" }),
        sourceFile("server/src/ollama/taskFileSelector.smoke.ts", { role: "test", contentPreview: "OAuth callback fixture" }),
        sourceFile("src/appMeta.ts", { role: "config", contentPreview: "export const appMeta = {};" }),
        sourceFile("src/components/ui/Button.tsx", { role: "ui-component", contentPreview: "export function Button(){ return null; }" }),
      ],
      taskIntent: structuredIntent({
        taskArea: "fullstack",
        domainTerms: ["auth", "login", "session", "oauth"],
        taskUnderstanding: {
          ...structuredIntent().taskUnderstanding,
          constraints: ["separate from existing repository connection flow"],
          requestedChanges: ["add app login"],
        },
        structuredIntent: {
          ...structuredIntent().structuredIntent,
          protectedScopes: ["existing repository connection flow"],
        },
      }),
    });
    const traceResult = result.diagnostics?.investigationTrace;
    assert.ok(traceResult?.triggered, "new application OAuth callback flow must not bypass investigation trace");
    assert.equal(result.selectedFiles.some((file) => /taskFileSelector\.smoke|i18n|appMeta|Button|contextComposer/.test(file.path)), false);
    assert.equal(traceResult?.outcome.confirmedOwners.some((owner) => /IntegrationsPage|githubAuthService/.test(owner)), false);
    assert.ok(traceResult?.outcome.unresolved.some((item) => /storage|state|backend|ui/i.test(item)) || result.diagnostics?.executionMode === "investigation");
    scenarios += 1;
  }

  {
    const files = [
      sourceFile("apps/renderer/src/components/projects/ProjectsSection.tsx", {
        role: "component",
        imports: ["../../i18n"],
        exports: ["ProjectsSection"],
        symbols: ["ProjectsSection", "noProjects", "noProjectsDescription"],
        textHints: ["projects", "empty state"],
        contentPreview: "export function ProjectsSection(){ return <div>{t('projectsPage.noProjects')}</div>; }",
        semanticFacts: {
          declarations: ["ProjectsSection"],
          references: ["t", "projectsPage.noProjects"],
          assignments: [],
          objectProperties: [],
          stateSymbols: [],
          translationKeys: ["projectsPage.noProjects"],
          translationEntries: [],
          routePaths: [],
        },
      }),
      sourceFile("apps/renderer/src/i18n/index.ts", {
        role: "config",
        exports: ["resources"],
        symbols: ["resources"],
        textHints: ["No projects yet", "Проектов пока нет"],
        contentPreview: "export const resources = { en: { projectsPage: { noProjects: 'No projects yet' } }, ru: { projectsPage: { noProjects: 'Проектов пока нет' } } };",
        semanticFacts: {
          declarations: ["resources"],
          references: ["projectsPage", "noProjects"],
          assignments: [],
          objectProperties: ["projectsPage", "noProjects"],
          stateSymbols: [],
          translationKeys: [],
          translationEntries: [
            { key: "projectsPage.noProjects", value: "No projects yet" },
            { key: "projectsPage.noProjects", value: "Проектов пока нет" },
          ],
          routePaths: [],
        },
      }),
      sourceFile("apps/renderer/src/hooks/useDashboardController.ts", {
        role: "hook",
        contentPreview: "export function useDashboardController(){ const [projects,setProjects]=useState([]); return { projects, setProjects }; }",
      }),
      sourceFile("apps/renderer/src/types/index.ts", {
        role: "types",
        contentPreview: "export interface Project { id: number; }",
      }),
      sourceFile("server/src/routes/projects.ts", {
        role: "api-route",
        routePath: "/projects",
        contentPreview: "export const projectsRouter = Router();",
      }),
      sourceFile("apps/renderer/src/App.backup.txt", {
        kind: "unknown",
        role: "unknown",
        contentPreview: "old projects backup",
      }),
    ];
    const exactIntent = structuredIntent({
      taskArea: "general",
      fileRoleHints: ["component", "state"],
      taskUnderstanding: {
        ...structuredIntent().taskUnderstanding,
        goal: "Replace the projects empty-state text from English to Russian.",
        action: "replace",
        targetHints: ["Projects"],
        requestedChanges: ["Replace the exact visible empty-state text."],
        changeDefinition: "exact",
        explicitValues: [
          { kind: "text", value: "No projects yet", exact: true, source: "user" },
          { kind: "text", value: "Проектов пока нет", exact: true, source: "user" },
        ],
      },
      structuredIntent: {
        ...structuredIntent().structuredIntent,
        primaryTargets: [
          {
            kind: "entity",
            value: "Projects",
            confidence: 0.95,
            evidence: "Named UI section.",
            provenance: "model_proposed",
          },
        ],
      },
    });

    for (const rawTask of [
      "В разделе Projects замени текст пустого состояния «No projects yet» на «Проектов пока нет».",
      "В разделе проектов замени текст пустого состояния «No projects yet» на «Проектов пока нет».",
    ]) {
      const result = await selectE2E({ rawTask, files, taskIntent: exactIntent });
      assert.deepEqual(
        result.selectedFiles.map((file) => file.path),
        [
          "apps/renderer/src/i18n/index.ts",
          "apps/renderer/src/components/projects/ProjectsSection.tsx",
        ],
        "exact text tasks must rebuild the final selection from the translation owner and its UI consumer",
      );
      assert.equal(result.selectedFiles[0]?.usage, "inspect-and-edit");
      assert.equal(result.selectedFiles[1]?.usage, "inspect-only");
      assert.equal(result.source, "deterministic");
      assert.equal(result.usedFallback, false);
      assert.equal(result.diagnostics?.selectionSource, "final-decision");
      assert.equal(result.diagnostics?.executionMode, "implementation");
      assert.deepEqual(result.diagnostics?.requiredLayers, []);
      assert.equal(result.diagnostics?.taskProfile, "exact-text");
      assert.equal(result.diagnostics?.investigationTrace, undefined);
      assert.deepEqual(
        result.diagnostics?.executionContract?.confirmedTargets,
        ["apps/renderer/src/i18n/index.ts"],
      );
      assert.deepEqual(result.diagnostics?.executionContract?.proposedTargets, []);
      assert.equal(
        result.notes.filter((note) => note.startsWith("Execution mode:")).length,
        1,
      );
      assert.equal(
        result.notes.some((note) => /Fallback file selection|Composer file limit|Concrete page target/i.test(note)),
        false,
      );
      assert.equal(
        result.selectedFiles.some((file) => /routes\/projects|DashboardController|types\/index|backup/i.test(file.path)),
        false,
      );
      scenarios += 1;
    }
  }

  {
    const result = await selectE2E({
      rawTask: "В компоненте EmptyPanel замени текст «Nothing here» на «Здесь пока пусто».",
      files: [
        sourceFile("src/components/EmptyPanel.tsx", {
          role: "component",
          contentPreview: "export function EmptyPanel(){ return t('emptyPanel.title'); }",
          semanticFacts: {
            declarations: ["EmptyPanel"],
            references: ["t", "emptyPanel.title"],
            assignments: [],
            objectProperties: [],
            stateSymbols: [],
            translationKeys: ["emptyPanel.title"],
            translationEntries: [],
            routePaths: [],
          },
        }),
        sourceFile("src/locales/en.json", {
          kind: "config",
          role: "config",
          contentPreview: '{ "emptyPanel": { "title": "Nothing here" } }',
          semanticFacts: {
            declarations: [],
            references: [],
            assignments: [],
            objectProperties: ["emptyPanel", "title"],
            stateSymbols: [],
            translationKeys: [],
            translationEntries: [{ key: "emptyPanel.title", value: "Nothing here" }],
            routePaths: [],
          },
        }),
      ],
      taskIntent: structuredIntent({
        taskArea: "ui",
        taskUnderstanding: {
          ...structuredIntent().taskUnderstanding,
          goal: "Replace the exact EmptyPanel text.",
          action: "replace",
          targetHints: ["EmptyPanel"],
          requestedChanges: ["Replace the exact visible text."],
          changeDefinition: "exact",
          explicitValues: [
            { kind: "text", value: "Nothing here", exact: true, source: "user" },
            { kind: "text", value: "Здесь пока пусто", exact: true, source: "user" },
          ],
        },
      }),
    });
    assert.deepEqual(result.selectedFiles.map((file) => file.path), [
      "src/locales/en.json",
      "src/components/EmptyPanel.tsx",
    ]);
    assert.equal(result.diagnostics?.executionMode, "implementation");
    scenarios += 1;
  }

  {
    const result = await selectE2E({
      rawTask: "Замени текст «No data» на «Нет данных».",
      files: [
        sourceFile("src/components/FirstPanel.tsx", {
          role: "component",
          contentPreview: "export function FirstPanel(){ return <p>No data</p>; }",
          textHints: ["No data"],
        }),
        sourceFile("src/components/SecondPanel.tsx", {
          role: "component",
          contentPreview: "export function SecondPanel(){ return <p>No data</p>; }",
          textHints: ["No data"],
        }),
      ],
      taskIntent: structuredIntent({
        taskArea: "ui",
        taskUnderstanding: {
          ...structuredIntent().taskUnderstanding,
          goal: "Replace the exact visible text.",
          action: "replace",
          requestedChanges: ["Replace No data."],
          changeDefinition: "exact",
          explicitValues: [
            { kind: "text", value: "No data", exact: true, source: "user" },
            { kind: "text", value: "Нет данных", exact: true, source: "user" },
          ],
        },
      }),
    });
    assert.equal(result.diagnostics?.executionMode, "investigation");
    assert.ok(result.selectedFiles.length >= 2);
    assert.ok(result.selectedFiles.every((file) => file.usage === "inspect-only"));
    assert.equal(result.diagnostics?.executionContract?.confirmedTargets.length, 0);
    scenarios += 1;
  }

  {
    const project = inventory([
      sourceFile("src/components/PerformancePanel.tsx", {
        role: "component",
        contentPreview: "import { backend } from '../services/backendConcept'; export function PerformancePanel(){ return <span>{t('performance.status')}</span>; }",
        semanticFacts: {
          declarations: ["PerformancePanel"],
          references: ["backend", "performance.status", "t"],
          assignments: [],
          objectProperties: [],
          stateSymbols: [],
          translationKeys: ["performance.status"],
          translationEntries: [],
          routePaths: [],
        },
      }),
      sourceFile("src/services/backendConcept.ts", {
        role: "service",
        contentPreview: "export const backend = 'server'; export const performance = true;",
        semanticFacts: {
          declarations: ["backend", "performance"],
          references: [],
          assignments: ["backend", "performance"],
          objectProperties: [],
          stateSymbols: [],
          translationKeys: [],
          translationEntries: [],
          routePaths: [],
        },
      }),
      sourceFile("src/i18n/index.ts", {
        role: "config",
        contentPreview: "export const resources = { en: { performance: { status: 'Ready' } } };",
        semanticFacts: {
          declarations: ["resources"],
          references: ["performance", "status"],
          assignments: [],
          objectProperties: ["performance", "status"],
          stateSymbols: [],
          translationKeys: [],
          translationEntries: [{ key: "performance.status", value: "Ready" }],
          routePaths: [],
        },
      }),
    ]);
    const result = trace(
      project,
      "Добавь в диагностику производительности отображение времени прогрева модели в backend и UI.",
      "src/components/PerformancePanel.tsx",
      ["backend", "ui"],
    );
    assert.equal(
      result.outcome.confirmedOwners.includes("src/services/backendConcept.ts"),
      false,
      "broad task concepts such as backend/performance must not confirm owners",
    );
    assert.equal(
      result.edges.some((edge) => edge.type === "translation_key_use" || edge.type === "translation_entry"),
      false,
      "non-localization tasks must not expand through incidental translation keys",
    );
    assert.equal(result.outcome.confirmedOwners.includes("src/i18n/index.ts"), false);
    scenarios += 1;
  }

  {
    const result = await selectE2E({
      rawTask: "Исправь ошибку, из-за которой после повторной генерации показывается устаревший статус кеша.",
      taskType: "bugfix",
      files: [
        sourceFile("src/components/GenerationDiagnosticsModal.tsx", {
          role: "component",
          contentPreview: "export function GenerationDiagnosticsModal({ diagnostics }) { return <div>{diagnostics.cacheStatus}</div>; }",
        }),
        sourceFile("src/assets/contextforge-logo-white.png", {
          kind: "asset",
          role: "asset",
          canReadText: false,
          contentPreview: "",
        }),
      ],
      taskIntent: structuredIntent({
        taskArea: "bugfix",
        taskUnderstanding: {
          ...structuredIntent().taskUnderstanding,
          action: "fix",
          targetHints: ["GenerationDiagnosticsModal"],
          requestedChanges: ["исправить устаревший статус кеша после повторной генерации"],
        },
      }),
    });
    assert.equal(
      result.selectedFiles.some((file) => file.path.endsWith("contextforge-logo-white.png")),
      false,
      "missing state coverage must remain unresolved instead of backfilling an unrelated asset",
    );
    assert.ok(
      result.diagnostics?.missingRequiredLayers?.includes("state") ||
        result.diagnostics?.missingConfirmedLayers?.includes("state"),
      "state should remain explicitly unresolved when no state owner is proven",
    );
    scenarios += 1;
  }

  {
    const result = await selectE2E({
      rawTask: "Исправь ошибку, из-за которой после повторного сканирования проекта карточка продолжает показывать старый readiness score.",
      taskType: "bugfix",
      files: [
        sourceFile("apps/renderer/src/components/projects/ProjectCard.tsx", {
          role: "component",
          symbols: ["ProjectCard", "readinessScore"],
          textHints: ["project card", "readiness score"],
          contentPreview: "export function ProjectCard({ project, onRescan }) { return <button onClick={onRescan}>{project.readinessScore}</button>; }",
          semanticFacts: {
            declarations: ["ProjectCard"],
            references: ["project", "readinessScore", "onRescan"],
            assignments: [],
            objectProperties: ["project", "readinessScore"],
            stateSymbols: [],
            translationKeys: [],
            translationEntries: [],
            routePaths: [],
          },
        }),
        sourceFile("apps/renderer/src/components/projects/ProjectsSection.tsx", {
          role: "component",
          imports: ["./ProjectCard"],
          symbols: ["ProjectsSection", "onRescanProject"],
          contentPreview: "import { ProjectCard } from './ProjectCard'; export function ProjectsSection({ projects, onRescanProject }) { return projects.map(project => <ProjectCard project={project} onRescan={() => onRescanProject(project)} />); }",
          semanticFacts: {
            declarations: ["ProjectsSection"],
            references: ["projects", "project", "ProjectCard", "onRescanProject", "onRescan"],
            assignments: [],
            objectProperties: ["project", "onRescan"],
            stateSymbols: [],
            translationKeys: [],
            translationEntries: [],
            routePaths: [],
          },
        }),
        sourceFile("apps/renderer/src/pages/DashboardPage.tsx", {
          role: "page",
          imports: ["../components/projects/ProjectsSection", "../hooks/useDashboardController"],
          symbols: ["DashboardPage", "handleRescanProject"],
          contentPreview: "import { ProjectsSection } from '../components/projects/ProjectsSection'; import { useDashboardController } from '../hooks/useDashboardController'; export function DashboardPage(){ const dashboard = useDashboardController(); return <ProjectsSection projects={dashboard.projects} onRescanProject={dashboard.handleRescanProject} />; }",
          semanticFacts: {
            declarations: ["DashboardPage"],
            references: ["ProjectsSection", "useDashboardController", "projects", "handleRescanProject", "onRescanProject"],
            assignments: [],
            objectProperties: ["projects", "handleRescanProject", "onRescanProject"],
            stateSymbols: [],
            translationKeys: [],
            translationEntries: [],
            routePaths: [],
          },
        }),
        sourceFile("apps/renderer/src/hooks/useDashboardController.ts", {
          role: "hook",
          imports: ["../api/client"],
          symbols: ["useDashboardController", "handleRescanProject", "refreshDashboard"],
          contentPreview: "export function useDashboardController(){ const [projects,setProjects]=useState([]); async function handleRescanProject(project){ await rescanProject(project.id); await refreshDashboard(); } return { projects, handleRescanProject }; }",
          semanticFacts: {
            declarations: ["useDashboardController", "handleRescanProject", "refreshDashboard", "loadProjects"],
            references: ["projects", "setProjects", "rescanProject", "refreshDashboard", "loadProjects"],
            assignments: ["projects", "setProjects"],
            objectProperties: ["projects", "handleRescanProject"],
            stateSymbols: ["projects"],
            translationKeys: [],
            translationEntries: [],
            routePaths: [],
          },
        }),
        sourceFile("apps/renderer/src/api/client.ts", {
          role: "client-api",
          exports: ["rescanProject"],
          symbols: ["rescanProject", "Project"],
          contentPreview: "export async function rescanProject(projectId){ return request(`/projects/${projectId}/rescan`, { method: 'POST' }); }",
          semanticFacts: {
            declarations: ["rescanProject"],
            references: ["project", "projectId", "request", "rescan"],
            assignments: [],
            objectProperties: ["method"],
            stateSymbols: [],
            translationKeys: [],
            translationEntries: [],
            routePaths: [],
          },
        }),
        sourceFile("server/src/routes/projects.ts", {
          role: "api-route",
          symbols: ["projectsRouter", "upsertScannedProject"],
          contentPreview: "projectsRouter.post('/:id/rescan', async (req,res) => { const project = await upsertScannedProject(); res.json({ project }); });",
          semanticFacts: {
            declarations: ["projectsRouter"],
            references: ["project", "upsertScannedProject", "rescan"],
            assignments: ["project"],
            objectProperties: ["project"],
            stateSymbols: [],
            translationKeys: [],
            translationEntries: [],
            routePaths: ["/:id/rescan"],
          },
        }),
        sourceFile("apps/renderer/src/components/dashboard/DashboardOverview.tsx", {
          role: "component",
          symbols: ["DashboardOverview", "readinessScore"],
          contentPreview: "export function DashboardOverview({ readinessScore }) { return <div>{readinessScore}</div>; }",
        }),
        sourceFile("apps/renderer/src/components/projects/ProjectReadinessReport.tsx", {
          role: "component",
          symbols: ["ProjectReadinessReport", "readinessScore"],
          contentPreview: "export function ProjectReadinessReport({ report }) { return <div>{report.score}</div>; }",
        }),
        sourceFile("server/src/ollama/taskUnderstanding.ts", {
          role: "service",
          symbols: ["TaskUnderstandingReadiness", "deriveReadiness"],
          contentPreview: "export function deriveReadiness(){ return 'review'; }",
        }),
        sourceFile("server/src/taskPacks/taskClarifications.ts", {
          role: "service",
          symbols: ["readiness", "clarification"],
          contentPreview: "export function normalizeClarification(){ return { readiness: 'ready' }; }",
        }),
      ],
      taskIntent: structuredIntent({
        taskArea: "bugfix",
        domainTerms: ["project", "rescan", "readiness score", "stale"],
        recommendedSearchTerms: ["ProjectCard", "rescanProject", "readinessScore"],
        fileRoleHints: ["component", "state", "api", "route"],
        taskUnderstanding: {
          ...structuredIntent().taskUnderstanding,
          goal: "Fix the bug where the project card displays an outdated readiness score after re-scanning a project.",
          action: "fix",
          targetHints: ["apps/renderer/src/components/projects/ProjectReadinessReport.tsx", "readiness score"],
          requestedChanges: ["Trace the rescan result into project state and the project card."],
          readiness: "review",
          changeDefinition: "open_ended",
        },
        structuredIntent: {
          ...structuredIntent().structuredIntent,
          primaryTargets: [{
            kind: "explicit_file",
            value: "apps/renderer/src/components/projects/ProjectReadinessReport.tsx",
            path: "apps/renderer/src/components/projects/ProjectReadinessReport.tsx",
            confidence: 0.62,
            evidence: "Model proposed a display file, owner unconfirmed.",
            provenance: "inventory_exact",
          }, {
            kind: "symbol",
            value: "readiness score",
            name: "readiness score",
            confidence: 0.62,
            evidence: "User-mentioned value.",
            provenance: "user_confirmed",
          }],
        },
      }),
    });

    assert.deepEqual(result.selectedFiles.map((file) => file.path), [
      "apps/renderer/src/hooks/useDashboardController.ts",
      "apps/renderer/src/components/projects/ProjectCard.tsx",
      "apps/renderer/src/components/projects/ProjectsSection.tsx",
      "apps/renderer/src/pages/DashboardPage.tsx",
      "apps/renderer/src/api/client.ts",
      "server/src/routes/projects.ts",
    ]);
    assert.ok(result.selectedFiles.every((file) => file.usage === "inspect-only"));
    assert.equal(result.source, "deterministic");
    assert.equal(result.diagnostics?.selectionSource, "final-decision");
    assert.equal(result.diagnostics?.taskProfile, "state-behavior");
    assert.equal(result.diagnostics?.executionMode, "investigation");
    assert.ok(result.diagnostics?.requiredLayers?.includes("ui"));
    assert.ok(result.diagnostics?.requiredLayers?.includes("state"));
    assert.deepEqual(
      result.diagnostics?.candidateLayerCoverage,
      result.diagnostics?.requiredLayers,
      "the connected chain should cover every candidate layer inferred for the task",
    );
    assert.deepEqual(result.diagnostics?.missingRequiredLayers, []);
    assert.equal(
      result.diagnostics?.executionContract?.implementationGateReasons.some((reason) =>
        reason.startsWith("Required layer coverage is incomplete"),
      ),
      false,
      "final contract must not retain a stale candidate-layer gate after the connected chain is rebuilt",
    );
    assert.equal(
      result.selectedFiles.some((file) => /taskUnderstanding|taskClarifications|DashboardOverview|ProjectReadinessReport/u.test(file.path)),
      false,
      "broad readiness matches outside the project/rescan chain must be discarded",
    );
    assert.ok(result.notes.some((note) => note.includes("connected state-flow chain")));
    scenarios += 1;
  }

  {
    const repoRoot = path.resolve(process.cwd(), "..");
    const scanStartedAt = performance.now();
    const realInventory = await scanProjectInventory(repoRoot);
    const scanMs = performance.now() - scanStartedAt;

    const exactTextUnderstanding = {
      ...structuredIntent().taskUnderstanding,
      goal: "Replace the projects empty-state text from English to Russian.",
      action: "replace" as const,
      targetHints: [],
      requestedChanges: ["Replace the exact visible empty-state text."],
      changeDefinition: "exact" as const,
      explicitValues: [
        { kind: "text" as const, value: "No projects yet", exact: true as const, source: "user" as const },
        { kind: "text" as const, value: "Проектов пока нет", exact: true as const, source: "user" as const },
      ],
    };
    const realExactCases = [
      {
        rawTask: "В разделе Projects замени текст пустого состояния «No projects yet» на «Проектов пока нет».",
        taskIntent: structuredIntent({
          taskArea: "general",
          fileRoleHints: ["component", "state"],
          taskUnderstanding: {
            ...exactTextUnderstanding,
            targetHints: ["server/src/routes/projects.ts"],
          },
          structuredIntent: {
            ...structuredIntent().structuredIntent,
            primaryTargets: [
              {
                kind: "entity",
                value: "Projects",
                path: "server/src/routes/projects.ts",
                confidence: 0.95,
                evidence: "Model proposed a same-stem project target.",
                provenance: "model_proposed",
              },
            ],
          },
        }),
      },
      {
        rawTask: "В разделе проектов замени текст пустого состояния «No projects yet» на «Проектов пока нет».",
        taskIntent: structuredIntent({
          taskArea: "general",
          fileRoleHints: ["component", "state"],
          taskUnderstanding: exactTextUnderstanding,
        }),
      },
    ];
    for (const exactCase of realExactCases) {
      const result = await selectTaskFiles({
        rawTask: exactCase.rawTask,
        taskType: "general",
        targetTool: "codex",
        inventory: realInventory,
        settings: testSettings,
        taskIntent: exactCase.taskIntent,
      });
      assert.deepEqual(
        result.selectedFiles.map((file) => file.path),
        [
          "apps/desktop/renderer/src/i18n/index.ts",
          "apps/desktop/renderer/src/components/projects/ProjectsSection.tsx",
        ],
        "the real repository exact-text task must converge on the translation owner and real UI consumer without a manual seed",
      );
      assert.equal(result.source, "deterministic");
      assert.equal(result.usedFallback, false);
      assert.equal(result.diagnostics?.selectionSource, "final-decision");
      assert.equal(result.diagnostics?.executionMode, "implementation");
      assert.deepEqual(result.diagnostics?.requiredLayers, []);
      assert.equal(result.diagnostics?.taskProfile, "exact-text");
      assert.equal(result.diagnostics?.investigationTrace, undefined);
      assert.deepEqual(
        result.diagnostics?.executionContract?.confirmedTargets,
        ["apps/desktop/renderer/src/i18n/index.ts"],
      );
      assert.deepEqual(result.diagnostics?.executionContract?.proposedTargets, []);
      assert.equal(
        result.notes.some((note) => /Fallback file selection|Composer file limit|Concrete page target/i.test(note)),
        false,
      );
      assert.equal(
        result.selectedFiles.some((file) => /server\/src\/routes\/projects|useDashboardController|types\/index|App\.backup/i.test(file.path)),
        false,
      );
    }

    const apiContractResult = await selectTaskFiles({
      rawTask: "В API генерации Task Pack добавь булево поле, показывающее, был ли refinement получен из кеша.",
      taskType: "general",
      targetTool: "codex",
      inventory: realInventory,
      settings: testSettings,
      taskIntent: structuredIntent({
        taskArea: "backend",
        intentTags: ["backend-flow"],
        domainTerms: ["generation", "Task Pack", "refinement", "cache"],
        recommendedSearchTerms: ["cached", "generationCached", "refinement"],
        fileRoleHints: ["component", "state", "style", "api", "route", "service"],
        taskUnderstanding: {
          ...structuredIntent().taskUnderstanding,
          goal: "Add a boolean field to the Task Pack generation API indicating if refinement was retrieved from cache.",
          action: "update",
          requestedChanges: [
            "Expose whether the existing refinement result came from cache.",
          ],
        },
      }),
    });
    assert.deepEqual(
      apiContractResult.selectedFiles.map((file) => file.path),
      [
        "server/src/routes/taskPacks.ts",
        "server/src/ollama/taskPackGenerationReliability.ts",
        "apps/desktop/renderer/src/types/index.ts",
      ],
      "the real API-contract task must reuse the existing cached producer and select the API boundary instead of inventing a refinement payload field",
    );
    assert.equal(apiContractResult.source, "deterministic");
    assert.equal(apiContractResult.usedFallback, false);
    assert.equal(apiContractResult.diagnostics?.selectionSource, "final-decision");
    assert.equal(apiContractResult.diagnostics?.executionMode, "implementation");
    assert.deepEqual(apiContractResult.diagnostics?.requiredLayers, ["backend"]);
    assert.deepEqual(
      apiContractResult.diagnostics?.executionContract?.confirmedTargets,
      ["server/src/routes/taskPacks.ts"],
    );
    assert.equal(
      apiContractResult.selectedFiles.some((file) =>
        /GlobalSearchModal|GeneratedTaskPackModal|contextComposerService|generationCache\.ts/u.test(file.path),
      ),
      false,
    );
    scenarios += 1;

    const stateBehaviorResult = await selectTaskFiles({
      rawTask: "Исправь ошибку, из-за которой после повторного сканирования проекта карточка продолжает показывать старый readiness score.",
      taskType: "general",
      targetTool: "codex",
      inventory: realInventory,
      settings: testSettings,
      taskIntent: structuredIntent({
        taskArea: "bugfix",
        domainTerms: ["ошибку", "повторного", "сканирования", "карточка", "старый", "readiness"],
        fileRoleHints: ["component", "state", "style", "api", "route", "service"],
        taskUnderstanding: {
          ...structuredIntent().taskUnderstanding,
          goal: "Fix the bug where the project card displays an outdated readiness score after re-scanning a project.",
          action: "fix",
          targetHints: ["apps/desktop/renderer/src/components/projects/ProjectReadinessReport.tsx", "readiness score"],
          requestedChanges: ["Trace the rescan result into project state and the project card."],
          readiness: "review",
          changeDefinition: "open_ended",
        },
        structuredIntent: {
          ...structuredIntent().structuredIntent,
          primaryTargets: [{
            kind: "explicit_file",
            value: "apps/desktop/renderer/src/components/projects/ProjectReadinessReport.tsx",
            path: "apps/desktop/renderer/src/components/projects/ProjectReadinessReport.tsx",
            confidence: 0.62,
            evidence: "Model proposed a display file, owner unconfirmed.",
            provenance: "inventory_exact",
          }, {
            kind: "symbol",
            value: "readiness score",
            name: "readiness score",
            confidence: 0.62,
            evidence: "User-mentioned value.",
            provenance: "user_confirmed",
          }],
        },
      }),
    });
    assert.deepEqual(
      stateBehaviorResult.selectedFiles.map((file) => file.path),
      [
        "apps/desktop/renderer/src/hooks/useDashboardController.ts",
        "apps/desktop/renderer/src/components/projects/ProjectCard.tsx",
        "apps/desktop/renderer/src/components/projects/ProjectsSection.tsx",
        "apps/desktop/renderer/src/pages/DashboardPage.tsx",
        "apps/desktop/renderer/src/api/client.ts",
        "server/src/routes/projects.ts",
      ],
      "the real stale-readiness task must converge on one connected rescan/state/display chain",
    );
    assert.ok(stateBehaviorResult.selectedFiles.every((file) => file.usage === "inspect-only"));
    assert.equal(stateBehaviorResult.source, "deterministic");
    assert.equal(stateBehaviorResult.usedFallback, false);
    assert.equal(stateBehaviorResult.diagnostics?.selectionSource, "final-decision");
    assert.equal(stateBehaviorResult.diagnostics?.taskProfile, "state-behavior");
    assert.equal(stateBehaviorResult.diagnostics?.executionMode, "investigation");
    assert.deepEqual(stateBehaviorResult.diagnostics?.missingRequiredLayers, []);
    assert.equal(
      stateBehaviorResult.selectedFiles.some((file) =>
        /taskUnderstanding|taskClarifications|DashboardOverview|ProjectReadinessReport|benchmarkSmoke/u.test(file.path),
      ),
      false,
    );
    assert.equal(
      stateBehaviorResult.diagnostics?.executionContract?.implementationGateReasons.some((reason) =>
        reason.startsWith("Required layer coverage is incomplete"),
      ),
      false,
      "final state-flow contract must be recomputed from the canonical selection",
    );
    scenarios += 1;

    const runReal = (rawTask: string, seed: string, layers: TaskExecutionContract["requiredLayers"] = []) => {
      const started = performance.now();
      const result = trace(realInventory, rawTask, seed, layers);
      return { result, durationMs: performance.now() - started };
    };

    const sidebar = runReal(
      "В компоненте Sidebar замени подпись Settings на \"Настройки\".",
      "apps/desktop/renderer/src/components/layout/Sidebar.tsx",
      ["ui"],
    );
    assert.ok(sidebar.result.outcome.confirmedOwners.includes("apps/desktop/renderer/src/i18n/index.ts"));
    assert.ok(sidebar.result.outcome.references.includes("apps/desktop/renderer/src/components/layout/Sidebar.tsx"));
    assert.ok(!sidebar.result.outcome.confirmedOwners.some((owner) => /SettingsPage|providerService/i.test(owner)));

    const snapshot = runReal(
      "In the task understanding API, add or verify the understandingSnapshotReused boolean for reused Understanding Snapshot responses.",
      "server/src/routes/taskPacks.ts",
      ["backend"],
    );
    assert.ok(snapshot.result.nodes.some((node) => node.inspectedSymbols.some((symbol) => /understandingsnapshotreused/i.test(symbol))));

    const perf = runReal(
      "Add modelLoadMs warmup timing to performance diagnostics in backend and UI.",
      "apps/desktop/renderer/src/components/performance/PerformanceDiagnosticsModal.tsx",
      ["backend", "client-api", "ui"],
    );
    assert.ok(perf.result.outcome.confirmedOwners.includes("server/src/performance/performanceTrace.ts"));
    assert.ok(!perf.result.outcome.confirmedOwners.some((owner) => /providerService|taskUnderstanding\.ts/i.test(owner)));

    const cache = runReal(
      "Исправь ошибку, из-за которой после повторной генерации показывается устаревший статус кеша.",
      "apps/desktop/renderer/src/components/generation/GenerationDiagnosticsModal.tsx",
      ["ui", "state"],
    );
    assert.ok(
      cache.result.nodes.some((node) => /TaskPackResultPage|DashboardController|controller|hook/i.test(node.path)),
      "cache trace should move from modal display candidate toward parent/controller candidates",
    );
    assert.ok(!cache.result.outcome.confirmedOwners.some((owner) => /GitHubPage|GitContextCard/i.test(owner)), "generic status/setStatus must not confirm unrelated GitHub owners");

    const oauth = runReal(
      "Добавь вход пользователя через GitHub OAuth. Это отдельная авторизация в приложение, не существующее подключение GitHub-репозиториев.",
      "apps/desktop/renderer/src/pages/IntegrationsPage.tsx",
      ["ui", "backend", "state", "storage"],
    );
    const integrationNode = oauth.result.nodes.find((node) => node.path.endsWith("IntegrationsPage.tsx"));
    assert.ok(integrationNode?.rejectionReason || integrationNode?.semanticRole === "reference");
    assert.ok(!oauth.result.outcome.confirmedOwners.some((owner) => /taskFileSelector\.smoke|i18n\/index|appMeta/i.test(owner)));

    const cached = runReal(
      "Добавь в диагностику производительности отображение времени прогрева модели в backend и UI.",
      "apps/desktop/renderer/src/components/performance/PerformanceDiagnosticsModal.tsx",
      ["backend", "client-api", "ui"],
    );
    assert.equal(cached.result.cacheReused, true);
    console.log(
      `investigation real scan: files=${realInventory.files.length}; scan=${scanMs.toFixed(1)}ms; sidebar=${sidebar.durationMs.toFixed(1)}ms; perf=${perf.durationMs.toFixed(1)}ms; cached=${cached.durationMs.toFixed(1)}ms`,
    );
    scenarios += 1;
  }

  console.log(`investigation trace smoke passed: ${scenarios} scenarios`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
