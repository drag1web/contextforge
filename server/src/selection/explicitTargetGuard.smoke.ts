import assert from "node:assert/strict";

import type { TaskIntentAnalysis } from "../ollama/taskIntentAnalyzer.js";
import type { TaskFileSelection } from "../ollama/taskFileSelector.js";
import type { ProjectInventory } from "../scanner/projectInventoryScanner.js";
import {
  applyExplicitTargetGuard,
  resolveExplicitTargetFastPath,
} from "./explicitTargetGuard.js";
import { evaluateContextSelectionQuality } from "./contextQuality.js";

const inventory: ProjectInventory = {
  rootPath: "<fixture>",
  totalFiles: 5,
  scannedFiles: 5,
  truncated: false,
  notes: [],
  files: [
    {
      path: "apps/renderer/src/pages/SettingsPage.tsx",
      name: "SettingsPage.tsx",
      extension: ".tsx",
      kind: "source",
      role: "page",
      routePath: "/settings",
      imports: [],
      exports: ["SettingsPage"],
      symbols: ["SettingsPage"],
      textHints: ["Experimental AI Core"],
      contentPreview: "Experimental AI Core",
      sizeBytes: 9000,
      depth: 4,
      canReadText: true,
      isLikelyGenerated: false,
    },
    {
      path: "apps/renderer/src/pages/DashboardHomePage.tsx",
      name: "DashboardHomePage.tsx",
      extension: ".tsx",
      kind: "source",
      role: "page",
      routePath: "/",
      imports: [],
      exports: ["DashboardHomePage"],
      symbols: ["DashboardHomePage", "onOpenSettings"],
      textHints: ["dashboard", "settings shortcut"],
      sizeBytes: 8000,
      depth: 4,
      canReadText: true,
      isLikelyGenerated: false,
    },
    {
      path: "apps/renderer/src/components/layout/AppHeader.tsx",
      name: "AppHeader.tsx",
      extension: ".tsx",
      kind: "source",
      role: "layout",
      imports: ["../ui/Button"],
      exports: ["AppHeader"],
      symbols: ["AppHeader"],
      textHints: ["header"],
      sizeBytes: 1200,
      depth: 5,
      canReadText: true,
      isLikelyGenerated: false,
    },
    {
      path: "apps/renderer/src/components/ui/Button.tsx",
      name: "Button.tsx",
      extension: ".tsx",
      kind: "source",
      role: "ui-component",
      imports: [],
      exports: ["Button"],
      symbols: ["Button"],
      textHints: ["button"],
      sizeBytes: 700,
      depth: 5,
      canReadText: true,
      isLikelyGenerated: false,
    },
    {
      path: "apps/renderer/src/App.css",
      name: "App.css",
      extension: ".css",
      kind: "style",
      role: "style",
      imports: [],
      exports: [],
      symbols: [],
      textHints: [],
      sizeBytes: 1300,
      depth: 3,
      canReadText: true,
      isLikelyGenerated: false,
    },
  ],
};

const taskIntent: TaskIntentAnalysis = {
  taskArea: "general",
  intentTags: [],
  domainTerms: [],
  mentionedEntities: [],
  fileRoleHints: [],
  recommendedSearchTerms: [],
  riskLevel: "low",
  confidence: 0.8,
  notes: [],
  source: "ollama",
  durationMs: 10,
  structuredIntent: {
    schemaVersion: 1,
    primaryTargets: [],
    positiveActions: [],
    protectedScopes: [],
    allowedEditScope: "unknown",
    needsStyles: null,
    needsBackend: null,
    ambiguities: [],
    modelNotes: [],
  },
  taskUnderstanding: {
    schemaVersion: 1,
    goal: "Replace Settings explanation",
    action: "replace",
    targetHints: ["Settings", "Experimental AI Core"],
    requestedChanges: [],
    constraints: [],
    interpretationRisk: "objective",
    changeDefinition: "exact",
    explicitValues: [
      { kind: "text", value: "New text", exact: true, source: "user" },
    ],
    missingInformation: [],
    readiness: "ready",
    canProceed: true,
    clarificationQuestion: null,
    confidence: 0.9,
    source: "merged",
    reasons: [],
  },
};

const wrongSelection: TaskFileSelection = {
  selectedFiles: [
    {
      path: "apps/renderer/src/pages/DashboardHomePage.tsx",
      kind: "source",
      usage: "inspect-and-edit",
      reason: "weak settings reference",
      confidence: 0.95,
    },
    {
      path: "apps/renderer/src/components/layout/AppHeader.tsx",
      kind: "source",
      usage: "inspect-and-edit",
      reason: "generic UI fallback",
      confidence: 0.9,
    },
  ],
  rejectedModelPaths: [],
  source: "ollama",
  usedFallback: false,
  durationMs: 100,
  notes: [],
  effectiveTaskArea: "ui",
  assetMode: "none",
};

const settings = {
  ollamaUrl: "http://127.0.0.1:11434",
  generationMode: "ollama" as const,
  aiProvider: "ollama" as const,
  defaultTargetTool: "codex" as const,
  defaultTaskType: "general" as const,
  defaultOllamaModel: "gemma4:latest",
  openAiCompatibleBaseUrl: "http://localhost:1234/v1",
  openAiCompatibleModel: null,
  openAiCompatibleApiKeyConfigured: false,
  geminiBaseUrl: "https://example.invalid",
  geminiModel: null,
  geminiApiKeyConfigured: false,
  anthropicBaseUrl: "https://example.invalid",
  anthropicModel: null,
  anthropicApiKeyConfigured: false,
  language: "en" as const,
  theme: "dark" as const,
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
  contextQualityMode: "balanced" as const,
  selectorPipelineMode: "shadow_primary" as const,
  taskUnderstandingInteractionMode: "balanced" as const,
  sidebarShowDescriptions: false,
  onboardingEnabled: true,
  onboardingShowEveryLaunch: true,
  onboardingCompleted: false,
};

const fastPath = resolveExplicitTargetFastPath({
  rawTask:
    "На странице Settings замени пояснение под заголовком Experimental AI Core на «Новый текст».",
  taskType: "general",
  inventory,
  taskIntent,
  settings,
});
assert.equal(fastPath.status, "matched");
assert.equal(
  fastPath.selection?.selectedFiles[0]?.path,
  "apps/renderer/src/pages/SettingsPage.tsx",
);
assert.equal(fastPath.selection?.source, "fast-path");

assert.ok(fastPath.selection);
const fastPathQuality = evaluateContextSelectionQuality({
  rawTask:
    "На странице Settings замени пояснение под заголовком Experimental AI Core на «Новый текст».",
  requestedTaskType: "general",
  effectiveTaskArea: "ui",
  inventory,
  fileSelection: fastPath.selection!,
  contextQualityMode: "balanced",
});
assert.equal(fastPathQuality.status, "ready");
assert.equal(fastPathQuality.requiredManualReview, false);

const localizedInventory: ProjectInventory = {
  ...inventory,
  files: inventory.files.map((file) =>
    file.path === "apps/renderer/src/pages/SettingsPage.tsx"
      ? {
          ...file,
          imports: ["react-i18next"],
          textHints: ["Experimental AI Core", "nav.settings", "labelKey"],
          contentPreview:
            "const { t } = useTranslation(); return <span>{t(item.labelKey)}</span>;",
        }
      : file,
  ),
};
const localizedTextFastPath = resolveExplicitTargetFastPath({
  rawTask:
    "На странице Settings замени пояснение под заголовком Experimental AI Core на «Новый текст».",
  taskType: "general",
  inventory: localizedInventory,
  taskIntent,
  settings,
});
assert.equal(localizedTextFastPath.status, "ineligible");
assert.equal(localizedTextFastPath.selection, null);

const localizedSingleWordLiteralIntent = {
  ...taskIntent,
  taskUnderstanding: {
    ...taskIntent.taskUnderstanding,
    goal: "Replace the Settings label with Настройки.",
    explicitValues: [
      {
        kind: "literal" as const,
        value: "Настройки",
        exact: true as const,
        source: "user" as const,
      },
    ],
  },
};
const localizedSingleWordFastPath = resolveExplicitTargetFastPath({
  rawTask: 'В компоненте Settings замени подпись Settings на «Настройки».',
  taskType: "general",
  inventory: localizedInventory,
  taskIntent: localizedSingleWordLiteralIntent,
  settings,
});
assert.equal(localizedSingleWordFastPath.status, "ineligible");
assert.equal(localizedSingleWordFastPath.selection, null);

const localizedGuardInventory: ProjectInventory = {
  ...localizedInventory,
  totalFiles: localizedInventory.totalFiles + 1,
  scannedFiles: localizedInventory.scannedFiles + 1,
  files: [
    ...localizedInventory.files,
    {
      path: "apps/renderer/src/i18n/index.ts",
      name: "index.ts",
      extension: ".ts",
      kind: "source",
      role: "data",
      imports: [],
      exports: ["resources"],
      symbols: ["resources"],
      textHints: ["nav.settings", "Settings", "Настройки"],
      contentPreview:
        'resources = { en: { nav: { settings: "Settings" } }, ru: { nav: { settings: "Настройки" } } };',
      sizeBytes: 1400,
      depth: 4,
      canReadText: true,
      isLikelyGenerated: false,
    },
  ],
};
const localizedGuardSelection: TaskFileSelection = {
  ...wrongSelection,
  selectedFiles: [
    {
      path: "apps/renderer/src/pages/SettingsPage.tsx",
      kind: "source",
      usage: "inspect-and-edit",
      reason: "Named UI target.",
      confidence: 0.96,
    },
    {
      path: "apps/renderer/src/i18n/index.ts",
      kind: "source",
      usage: "inspect-and-edit",
      reason: "Localization support candidate; needs confirmation.",
      confidence: 0.72,
    },
  ],
};
const localizedGuard = applyExplicitTargetGuard({
  rawTask: 'На странице Settings замени подпись Settings на «Настройки».',
  inventory: localizedGuardInventory,
  taskIntent: localizedSingleWordLiteralIntent,
  selection: localizedGuardSelection,
});
assert.equal(localizedGuard.status, "matched");
assert.deepEqual(
  localizedGuard.selection.selectedFiles.map((file) => file.path),
  [
    "apps/renderer/src/pages/SettingsPage.tsx",
    "apps/renderer/src/i18n/index.ts",
  ],
);
assert.equal(localizedGuard.selection.selectedFiles[1]?.usage, "inspect-and-edit");
assert.ok(
  localizedGuard.selection.selectedFiles[1]?.reason.includes(
    "Localization resource candidate retained",
  ),
);
assert.ok(localizedGuard.selection.selectedFiles[1]!.confidence <= 0.72);

const subjectiveFastPath = resolveExplicitTargetFastPath({
  rawTask:
    "На странице Settings сделай блок Experimental AI Core менее деревянным.",
  taskType: "general",
  inventory,
  taskIntent: {
    ...taskIntent,
    taskUnderstanding: {
      ...taskIntent.taskUnderstanding,
      interpretationRisk: "subjective",
      changeDefinition: "open_ended",
      explicitValues: [],
    },
  },
  settings,
});
assert.equal(subjectiveFastPath.status, "ineligible");
assert.equal(subjectiveFastPath.selection, null);

const guarded = applyExplicitTargetGuard({
  rawTask:
    "На странице Settings замени пояснение под заголовком Experimental AI Core на «Новый текст».",
  inventory,
  taskIntent,
  selection: wrongSelection,
});
assert.equal(guarded.status, "matched");
assert.equal(
  guarded.selection.selectedFiles[0]?.path,
  "apps/renderer/src/pages/SettingsPage.tsx",
);
assert.equal(guarded.selection.selectedFiles[0]?.usage, "inspect-and-edit");
assert.equal(guarded.selection.selectedFiles.length, 1);
assert.equal(guarded.taskIntent.taskArea, "ui");
assert.equal(
  guarded.taskIntent.structuredIntent.primaryTargets[0]?.path,
  "apps/renderer/src/pages/SettingsPage.tsx",
);


const appHeaderIntent: TaskIntentAnalysis = {
  ...taskIntent,
  taskArea: "general",
  taskUnderstanding: {
    ...taskIntent.taskUnderstanding,
    goal: "Make AppHeader visually lighter and more modern",
    action: "update",
    targetHints: ["AppHeader"],
    interpretationRisk: "subjective",
    changeDefinition: "open_ended",
    explicitValues: [],
    readiness: "review",
  },
};

const recoveredSelection: TaskFileSelection = {
  ...wrongSelection,
  selectedFiles: [
    {
      path: "apps/renderer/src/App.css",
      kind: "style",
      usage: "inspect-and-edit",
      reason: "Generic style fallback. Added because Ollama selected too few valid files after semantic validation.",
      confidence: 0.72,
    },
    {
      path: "apps/renderer/src/components/ui/Button.tsx",
      kind: "source",
      usage: "inspect-and-edit",
      reason: "Possible UI support",
      confidence: 0.7,
    },
  ],
  rejectedModelPaths: [
    "server/src/taskPacks/taskClarifications.ts (rejected by semantic quality gate)",
  ],
  notes: [
    "Selection was augmented with fallback-ranked files because Ollama selected too few valid files or needed coverage balancing.",
    "The user seems to be working on task clarification internals. I've selected the core implementation files.",
    "Effective task area: general.",
    'Composer file limit for "general": 8.',
    "Ollama file selector produced valid JSON after one strict retry.",
  ],
  effectiveTaskArea: "general",
  diagnostics: {
    selectorVersion: "fixture",
    safetyProfile: "fixture",
    generationMode: "ollama",
    model: "gemma4:latest",
    requestedTaskType: "general",
    effectiveTaskArea: "general",
    usedFallback: false,
    selectionSource: "retry-ai",
    repairAttempted: true,
    retryAttempted: true,
    schemaValid: true,
  },
};

const recoveredGuard = applyExplicitTargetGuard({
  rawTask:
    "В компоненте AppHeader сделай верхнюю панель визуально легче и современнее, не меняя её структуру.",
  inventory,
  taskIntent: appHeaderIntent,
  selection: recoveredSelection,
});
assert.equal(recoveredGuard.status, "matched");
assert.equal(
  recoveredGuard.selection.selectedFiles[0]?.path,
  "apps/renderer/src/components/layout/AppHeader.tsx",
);
assert.deepEqual(
  recoveredGuard.selection.selectedFiles.map((file) => file.path),
  [
    "apps/renderer/src/components/layout/AppHeader.tsx",
    "apps/renderer/src/components/ui/Button.tsx",
  ],
);
assert.equal(recoveredGuard.selection.selectedFiles[1]?.usage, "inspect-only");
assert.equal(recoveredGuard.selection.effectiveTaskArea, "ui");
assert.ok(
  recoveredGuard.selection.notes.every(
    (note) => !note.includes("Selection was augmented"),
  ),
);
assert.ok(
  recoveredGuard.selection.notes.every(
    (note) => !note.includes("The user seems"),
  ),
);
assert.ok(
  recoveredGuard.selection.notes.every(
    (note) => !note.startsWith("Effective task area:"),
  ),
);
assert.ok(
  recoveredGuard.selection.notes.every(
    (note) => !note.startsWith("Composer file limit for"),
  ),
);
assert.ok(
  recoveredGuard.selection.notes.some((note) =>
    note.includes("strict retry"),
  ),
);

const recoveredQuality = evaluateContextSelectionQuality({
  rawTask:
    "В компоненте AppHeader сделай верхнюю панель визуально легче и современнее, не меняя её структуру.",
  requestedTaskType: "general",
  effectiveTaskArea: recoveredGuard.selection.effectiveTaskArea,
  inventory,
  fileSelection: recoveredGuard.selection,
  contextQualityMode: "balanced",
});
assert.equal(recoveredQuality.status, "warning");
assert.ok(recoveredQuality.score <= 92);
assert.ok(
  recoveredQuality.warnings.some((warning) =>
    warning.includes("explicit target guard recovered"),
  ),
);

const noTarget = applyExplicitTargetGuard({
  rawTask: "Improve the UI a little",
  inventory,
  taskIntent,
  selection: wrongSelection,
});
assert.equal(noTarget.status, "not-applicable");

console.log("explicit target guard smoke passed: 9 scenarios");
