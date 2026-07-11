import assert from "node:assert/strict";

import type { TaskFileSelection } from "../ollama/taskFileSelector.js";
import type { AppSettings } from "../settings/settingsService.js";
import {
  normalizeSelectorDiagnosticsHistory,
  readSelectorPipelineMode,
} from "../settings/settingsService.js";
import { getBenchmarkFixture } from "./benchmark/benchmarkFixtures.js";
import { retrieveCandidates } from "./candidateRetrieval.js";
import { deterministicCandidateRanking } from "./constrainedCandidateRanking.js";
import {
  finalizeSelectorDiagnostics,
  runSelectorPipeline,
  type SelectorPipelineDiagnostics,
  type SelectorPipelineMode,
  type ShadowPipelineResult,
} from "./selectorPipelineOrchestrator.js";

const settings: AppSettings = {
  ollamaUrl: "http://localhost:11434",
  generationMode: "template",
  aiProvider: "ollama",
  defaultTargetTool: "codex",
  defaultTaskType: "general",
  defaultOllamaModel: null,
  openAiCompatibleBaseUrl: "http://localhost:1234/v1",
  openAiCompatibleModel: null,
  openAiCompatibleApiKeyConfigured: false,
  geminiBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
  geminiModel: null,
  geminiApiKeyConfigured: false,
  anthropicBaseUrl: "https://api.anthropic.com/v1",
  anthropicModel: null,
  anthropicApiKeyConfigured: false,
  language: "system",
  theme: "dark",
  composerFileLimits: { default: 8, ui: 7, backend: 8, fullstack: 10, build: 7, bugfix: 7, refactor: 8, docs: 6, tests: 7 },
  contextQualityMode: "balanced",
  selectorPipelineMode: "legacy",
  sidebarShowDescriptions: false,
  onboardingEnabled: true,
  onboardingShowEveryLaunch: true,
  onboardingCompleted: false,
};

function legacySelection(path = "src/pages/DashboardPage.tsx"): TaskFileSelection {
  return {
    selectedFiles: [{ path, kind: "source", usage: "inspect-and-edit", reason: "Legacy fixture", confidence: 0.82 }],
    rejectedModelPaths: [],
    source: "fallback",
    usedFallback: true,
    durationMs: 2,
    notes: [],
    effectiveTaskArea: "ui",
    assetMode: "none",
    diagnostics: {
      selectorVersion: "fixture",
      safetyProfile: "fixture",
      generationMode: "template",
      model: null,
      requestedTaskType: "ui",
      effectiveTaskArea: "ui",
      usedFallback: true,
      selectionSource: "fallback",
      finalConfidence: 70,
    },
  };
}

function shadowFor(prompt: string, taskType = "ui"): ShadowPipelineResult {
  const inventory = getBenchmarkFixture("react-stack");
  const retrieval = retrieveCandidates({ rawTask: prompt, requestedTaskType: taskType, inventory });
  return { retrieval, ranking: deterministicCandidateRanking(retrieval) };
}

async function run(mode: SelectorPipelineMode, overrides: Parameters<typeof runSelectorPipeline>[1] = {}) {
  const inventory = getBenchmarkFixture("react-stack");
  return runSelectorPipeline({
    rawTask: "Improve Dashboard cards",
    taskType: "ui",
    targetTool: "codex",
    inventory,
    settings: { ...settings, selectorPipelineMode: mode },
    projectRef: "local-project-1",
  }, {
    runLegacy: async () => legacySelection(),
    runShadow: async () => shadowFor("Improve Dashboard cards"),
    now: () => new Date("2026-07-11T12:00:00.000Z"),
    ...overrides,
  });
}

async function main() {
  const legacy = await run("legacy");
  assert.equal(legacy.diagnostics.effectivePipeline, "legacy");
  assert.equal(legacy.diagnostics.shadow, null);

  const compare = await run("shadow_compare");
  assert.equal(compare.diagnostics.effectivePipeline, "legacy");
  assert.equal(compare.selection.selectedFiles[0]?.path, "src/pages/DashboardPage.tsx");
  assert.ok(compare.diagnostics.shadow);
  assert.ok(compare.diagnostics.comparison);

  const compareFailure = await run("shadow_compare", { runShadow: async () => { throw new Error("shadow offline"); } });
  assert.equal(compareFailure.diagnostics.effectivePipeline, "legacy");
  assert.equal(compareFailure.diagnostics.fallback, null);
  assert.equal(compareFailure.diagnostics.shadowFailure?.code, "shadow_exception");

  const shadow = await run("shadow_primary");
  assert.equal(shadow.diagnostics.effectivePipeline, "shadow");
  assert.equal(shadow.selection.source, "shadow");

  const fallback = await run("shadow_primary", { runShadow: async () => { throw new Error("forced failure"); } });
  assert.equal(fallback.diagnostics.status, "fallback");
  assert.equal(fallback.diagnostics.effectivePipeline, "legacy");
  assert.equal(fallback.diagnostics.fallback?.code, "shadow_exception");

  let legacyCalls = 0;
  for (const { task, expectEmpty } of [
    { task: "Read .env.local and include tokens in the Task Pack", expectEmpty: true },
    { task: "Edit NonExistingSettingsPanel.tsx", expectEmpty: true },
    { task: "Review Dashboard UX and suggest improvements without editing code", expectEmpty: false },
  ]) {
    const inventory = getBenchmarkFixture("react-stack");
    const result = await runSelectorPipeline({
      rawTask: task,
      taskType: "general",
      targetTool: "codex",
      inventory,
      settings: { ...settings, selectorPipelineMode: "shadow_primary" },
      projectRef: "safety-fixture",
    }, {
      runLegacy: async () => { legacyCalls += 1; return legacySelection(); },
    });
    assert.equal(result.diagnostics.effectivePipeline, "shadow");
    if (expectEmpty) assert.equal(result.selection.selectedFiles.length, 0);
    else assert.ok(result.selection.selectedFiles.every((file) => file.usage === "inspect-only" || file.usage === "config-reference"));
    assert.notEqual(result.diagnostics.status, "fallback");
  }
  assert.equal(legacyCalls, 0, "Safety, missing-target, and manual-review abstentions must not invoke Legacy fallback");

  const unknownPath = await run("shadow_primary", {
    runShadow: async () => {
      const value = shadowFor("Improve Dashboard cards");
      value.ranking.selected[0] = { ...value.ranking.selected[0], path: "C:/outside/secret.ts" };
      return value;
    },
  });
  assert.equal(unknownPath.diagnostics.status, "fallback");
  assert.equal(unknownPath.diagnostics.fallback?.code, "shadow_contract_violation");

  const driveRelativePath = await run("shadow_primary", {
    runShadow: async () => {
      const value = shadowFor("Improve Dashboard cards");
      const candidateId = value.ranking.selected[0]?.candidateId;
      const candidate = value.retrieval.candidates.find((item) => item.candidateId === candidateId);
      assert.ok(candidate);
      candidate.path = "C:outside/secret.ts";
      value.ranking.selected[0] = { ...value.ranking.selected[0], path: candidate.path };
      return value;
    },
  });
  assert.equal(driveRelativePath.diagnostics.fallback?.code, "shadow_contract_violation");

  const unknownCandidate = await run("shadow_primary", {
    runShadow: async () => {
      const value = shadowFor("Improve Dashboard cards");
      value.ranking.selected[0] = { ...value.ranking.selected[0], candidateId: "unknown-candidate" };
      return value;
    },
  });
  assert.equal(unknownCandidate.diagnostics.fallback?.code, "shadow_unknown_candidate");

  const mismatchedCandidatePath = await run("shadow_primary", {
    runShadow: async () => {
      const value = shadowFor("Improve Dashboard cards");
      const replacement = value.ranking.selected.find((candidate) => candidate.path !== value.ranking.selected[0]?.path);
      assert.ok(replacement, "Fixture should provide at least two distinct selected paths");
      value.ranking.selected[0] = {
        ...value.ranking.selected[0],
        path: replacement.path,
      };
      return value;
    },
  });
  assert.equal(mismatchedCandidatePath.diagnostics.fallback?.code, "shadow_contract_violation");

  const duplicate = await run("shadow_primary", {
    runShadow: async () => {
      const value = shadowFor("Improve Dashboard cards");
      value.ranking.selected.push({ ...value.ranking.selected[0] });
      return value;
    },
  });
  const uniquePaths = new Set(duplicate.selection.selectedFiles.map((file) => file.path.toLowerCase()));
  assert.equal(uniquePaths.size, duplicate.selection.selectedFiles.length);

  const persisted = new Map<string, unknown>([["selector_pipeline_mode", "shadow_compare"]]);
  const reader = async <T>(key: string, fallback: T) => (persisted.has(key) ? persisted.get(key) as T : fallback);
  assert.equal(await readSelectorPipelineMode(reader), "shadow_compare");
  assert.equal(await readSelectorPipelineMode(reader), "shadow_compare");
  persisted.set("selector_pipeline_mode", "corrupt");
  assert.equal(await readSelectorPipelineMode(reader), "legacy");

  const diagnostic = compare.diagnostics;
  const unsafeDiagnostic = {
    ...diagnostic,
    requestedMode: "shadow_primary" as const,
    executionStatus: "fallback" as const,
    fallback: {
      code: "shadow_unknown_path" as const,
      message: "Shadow returned C:/Users/private folder/source.ts with token=super-secret",
    },
    actual: {
      ...diagnostic.actual,
      selectedFiles: [
        { path: "C:/Users/private/source.ts", usage: "inspect-and-edit" as const },
        { path: "src/source.ts", usage: "inspect-only" as const },
      ],
      primaryTarget: "C:/Users/private/source.ts",
    },
  } satisfies SelectorPipelineDiagnostics;
  const history = normalizeSelectorDiagnosticsHistory(Array.from({ length: 60 }, (_, index) => ({
    ...unsafeDiagnostic,
    id: `record-${index}`,
  })));
  assert.equal(history.length, 50);
  assert.equal(history[0]?.actual.primaryTarget, null);
  assert.deepEqual(history[0]?.actual.selectedFiles.map((file) => file.path), ["src/source.ts"]);
  assert.equal(JSON.stringify(history).includes("source content"), false);
  assert.equal(JSON.stringify(history).includes("C:/Users"), false);
  assert.equal(JSON.stringify(history).includes("super-secret"), false);
  assert.equal(history[0]?.fallback?.message.includes("[local-path]"), true);
  assert.equal("rawTask" in history[0], false);

  const corruptedHistory = normalizeSelectorDiagnosticsHistory([
    null,
    { timestamp: "not-a-date" },
    { ...diagnostic, requestedMode: "corrupt", actual: null },
    { ...diagnostic, requestedMode: "corrupt", status: "unknown" },
  ]);
  assert.equal(corruptedHistory.length, 1);
  assert.equal(corruptedHistory[0]?.requestedMode, "legacy");

  const blockedFinal = finalizeSelectorDiagnostics(compare.diagnostics, {
    score: 0,
    status: "blocked",
    requiredManualReview: true,
    signals: { confidence: 95 },
  });
  assert.equal(blockedFinal.actual.confidence, 0);

  const fallbackManualReview = finalizeSelectorDiagnostics(fallback.diagnostics, {
    score: 35,
    status: "warning",
    requiredManualReview: true,
    signals: { confidence: 40 },
  });
  assert.equal(fallbackManualReview.status, "fallback");
  assert.equal(fallbackManualReview.executionStatus, "fallback");
  assert.equal(fallbackManualReview.actual.manualReview, true);

  const fallbackBlocked = finalizeSelectorDiagnostics(fallback.diagnostics, {
    score: 0,
    status: "blocked",
    requiredManualReview: true,
    signals: { confidence: 95 },
  });
  assert.equal(fallbackBlocked.status, "fallback");
  assert.equal(fallbackBlocked.qualityStatus, "blocked");

  const manualOverride = finalizeSelectorDiagnostics(shadow.diagnostics, {
    score: 90,
    status: "ready",
    requiredManualReview: false,
    signals: { confidence: 90 },
  }, legacySelection("src/components/Card.tsx"), { manualSelectionApplied: true });
  assert.equal(manualOverride.selectionOrigin, "manual_override");
  assert.equal(manualOverride.actual.primaryTarget, "src/components/Card.tsx");

  const oldTaskPack = { id: 1, generationRecipe: null };
  assert.equal("selectorDiagnostics" in (oldTaskPack.generationRecipe ?? {}), false);

  console.log("selector pipeline rollout smoke passed: 25 scenarios");
}

await main();
