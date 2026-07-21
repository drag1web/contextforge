import assert from "node:assert/strict";

import type { TaskIntentAnalysis } from "../ollama/taskIntentAnalyzer.js";
import type { ProjectInventory } from "../scanner/projectInventoryScanner.js";
import {
  clearTaskUnderstandingSnapshotsForTests,
  createTaskUnderstandingSnapshot,
  isTaskUnderstandingSnapshotReviewAccepted,
  resolveTaskUnderstandingSnapshot,
} from "./taskUnderstandingSnapshot.js";

const inventory: ProjectInventory = {
  rootPath: "<fixture>",
  totalFiles: 1,
  scannedFiles: 1,
  truncated: false,
  notes: [],
  files: [
    {
      path: "src/pages/SettingsPage.tsx",
      name: "SettingsPage.tsx",
      extension: ".tsx",
      kind: "source",
      role: "page",
      imports: [],
      exports: ["SettingsPage"],
      symbols: ["SettingsPage"],
      textHints: ["Experimental AI Core"],
      sizeBytes: 1200,
      depth: 3,
      canReadText: true,
      isLikelyGenerated: false,
    },
  ],
};

const taskIntent: TaskIntentAnalysis = {
  taskArea: "ui",
  intentTags: [],
  domainTerms: ["settings"],
  mentionedEntities: ["Settings"],
  fileRoleHints: ["page"],
  recommendedSearchTerms: ["SettingsPage"],
  riskLevel: "low",
  confidence: 0.9,
  notes: [],
  source: "ollama",
  durationMs: 10,
  structuredIntent: {
    schemaVersion: 1,
    primaryTargets: [],
    positiveActions: ["replace explanation"],
    protectedScopes: [],
    allowedEditScope: "target_with_supporting_context",
    needsStyles: false,
    needsBackend: false,
    ambiguities: [],
    modelNotes: [],
  },
  taskUnderstanding: {
    schemaVersion: 1,
    goal: "Change the Settings explanation",
    action: "replace",
    targetHints: ["Settings", "Experimental AI Core"],
    requestedChanges: ["Change the explanation"],
    constraints: [],
    interpretationRisk: "objective",
    changeDefinition: "bounded",
    explicitValues: [],
    missingInformation: [
      {
        code: "replacement_value",
        description: "Replacement value is required",
        required: true,
      },
    ],
    readiness: "needs_clarification",
    canProceed: false,
    clarificationQuestion: "What exact text should be used?",
    confidence: 0.8,
    source: "merged",
    reasons: [],
  },
};

clearTaskUnderstandingSnapshotsForTests();
const id = createTaskUnderstandingSnapshot({
  projectId: 1,
  rawTask: "Change Settings explanation",
  taskType: "general",
  targetTool: "codex",
  analysisSignature: "ollama:gemma4:v1",
  inventory,
  taskIntent,
});

const exact = resolveTaskUnderstandingSnapshot({
  snapshotId: id,
  projectId: 1,
  rawTask: "Change Settings explanation",
  taskType: "general",
  targetTool: "codex",
  analysisSignature: "ollama:gemma4:v1",
  inventory,
});
assert.equal(exact.hit, true);
assert.equal(exact.appendedClarifications.length, 0);
assert.equal(isTaskUnderstandingSnapshotReviewAccepted(exact, id), true);
assert.equal(
  isTaskUnderstandingSnapshotReviewAccepted(
    exact,
    "00000000-0000-4000-8000-000000000000",
  ),
  false,
);

const cachedWithoutId = resolveTaskUnderstandingSnapshot({
  snapshotId: undefined,
  projectId: 1,
  rawTask: "Change Settings explanation",
  taskType: "general",
  targetTool: "codex",
  analysisSignature: "ollama:gemma4:v1",
  inventory,
  allowCacheLookup: true,
});
assert.equal(cachedWithoutId.hit, true);
assert.equal(cachedWithoutId.lookupSource, "cache");
assert.equal(cachedWithoutId.snapshot?.id, id);

const inventoryWithRuntimeSizeChange: ProjectInventory = {
  ...inventory,
  files: inventory.files.map((file) => ({
    ...file,
    sizeBytes: file.sizeBytes + 4096,
  })),
};
const cachedAfterRuntimeSizeChange = resolveTaskUnderstandingSnapshot({
  snapshotId: undefined,
  projectId: 1,
  rawTask: "Change Settings explanation",
  taskType: "general",
  targetTool: "codex",
  analysisSignature: "ollama:gemma4:v1",
  inventory: inventoryWithRuntimeSizeChange,
  allowCacheLookup: true,
});
assert.equal(cachedAfterRuntimeSizeChange.hit, true);
assert.equal(cachedAfterRuntimeSizeChange.lookupSource, "cache");
assert.equal(cachedAfterRuntimeSizeChange.snapshot?.id, id);

const inventoryWithPathChange: ProjectInventory = {
  ...inventory,
  totalFiles: 2,
  scannedFiles: 2,
  files: [
    ...inventory.files,
    {
      ...inventory.files[0]!,
      path: "src/pages/ProjectsPage.tsx",
      name: "ProjectsPage.tsx",
      symbols: ["ProjectsPage"],
      exports: ["ProjectsPage"],
      textHints: ["Projects"],
    },
  ],
};
const cacheMissAfterPathChange = resolveTaskUnderstandingSnapshot({
  snapshotId: undefined,
  projectId: 1,
  rawTask: "Change Settings explanation",
  taskType: "general",
  targetTool: "codex",
  analysisSignature: "ollama:gemma4:v1",
  inventory: inventoryWithPathChange,
  allowCacheLookup: true,
});
assert.equal(cacheMissAfterPathChange.hit, false);
assert.equal(cacheMissAfterPathChange.reason, "cache_miss");

const changedAnalysis = resolveTaskUnderstandingSnapshot({
  snapshotId: id,
  projectId: 1,
  rawTask: "Change Settings explanation",
  taskType: "general",
  targetTool: "codex",
  analysisSignature: "ollama:other-model:v1",
  inventory,
});
assert.equal(changedAnalysis.hit, false);
assert.equal(changedAnalysis.reason, "analysis_changed");

const appended = resolveTaskUnderstandingSnapshot({
  snapshotId: id,
  projectId: 1,
  rawTask: "Change Settings explanation",
  taskType: "general",
  targetTool: "codex",
  analysisSignature: "ollama:gemma4:v1",
  inventory,
  clarifications: [
    {
      question: "Какой точный новый текст или значение нужно использовать?",
      answer: "Новый точный текст",
    },
  ],
  allowSafeClarificationAppend: true,
});
assert.equal(appended.hit, true);
assert.equal(appended.appendedClarifications.length, 1);

const changedAnswerCase = resolveTaskUnderstandingSnapshot({
  snapshotId: id,
  projectId: 1,
  rawTask: "Change Settings explanation",
  taskType: "general",
  targetTool: "codex",
  analysisSignature: "ollama:gemma4:v1",
  inventory,
  clarifications: [
    {
      question: "Какой точный новый текст или значение нужно использовать?",
      answer: "новый точный текст",
    },
  ],
  allowSafeClarificationAppend: true,
});
assert.equal(changedAnswerCase.hit, true);
assert.equal(
  changedAnswerCase.appendedClarifications[0]?.answer,
  "новый точный текст",
);

const unsafe = resolveTaskUnderstandingSnapshot({
  snapshotId: id,
  projectId: 1,
  rawTask: "Change Settings explanation",
  taskType: "general",
  targetTool: "codex",
  analysisSignature: "ollama:gemma4:v1",
  inventory,
  clarifications: [
    {
      question: "Какую конкретно страницу нужно изменить?",
      answer: "Projects",
    },
  ],
  allowSafeClarificationAppend: true,
});
assert.equal(unsafe.hit, false);
assert.equal(unsafe.reason, "unsafe_clarification_append");

const changedTask = resolveTaskUnderstandingSnapshot({
  snapshotId: id,
  projectId: 1,
  rawTask: "Change Projects explanation",
  taskType: "general",
  targetTool: "codex",
  analysisSignature: "ollama:gemma4:v1",
  inventory,
});
assert.equal(changedTask.hit, false);
assert.equal(changedTask.reason, "input_changed");
assert.equal(isTaskUnderstandingSnapshotReviewAccepted(changedTask, id), false);

console.log("task understanding snapshot smoke passed: 12 scenarios");
