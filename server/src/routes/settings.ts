import { Router } from "express";
import { z } from "zod";
import {
  getAppSettings,
  getSelectorDiagnosticsHistory,
  clearSelectorDiagnosticsHistory,
  getContextEngineShadowDiagnosticsHistory,
  clearContextEngineShadowDiagnosticsHistory,
  clearContextEngineTaskPackCanaryHistory,
  getContextEngineTaskPackCanaryHistory,
  updateAppSettings,
} from "../settings/settingsService.js";

export const settingsRouter = Router();

const composerFileLimitsSchema = z.object({
  default: z.number().int().min(3).max(24),
  ui: z.number().int().min(3).max(24),
  backend: z.number().int().min(3).max(24),
  fullstack: z.number().int().min(3).max(24),
  build: z.number().int().min(3).max(24),
  bugfix: z.number().int().min(3).max(24),
  refactor: z.number().int().min(3).max(24),
  docs: z.number().int().min(3).max(24),
  tests: z.number().int().min(3).max(24),
});

const updateSettingsSchema = z.object({
  ollamaUrl: z.string().url().optional(),
  generationMode: z.enum(["template", "ollama"]).optional(),
  aiProvider: z
    .enum(["ollama", "openai-compatible", "anthropic", "gemini"])
    .optional(),
  defaultTargetTool: z
    .enum(["codex", "cursor", "claude", "gemini", "generic"])
    .optional(),
  defaultTaskType: z
    .enum([
      "general",
      "ui",
      "backend",
      "fullstack",
      "build",
      "bugfix",
      "refactor",
      "docs",
      "tests",
    ])
    .optional(),
  defaultOllamaModel: z.string().nullable().optional(),
  openAiCompatibleBaseUrl: z.string().url().optional(),
  openAiCompatibleModel: z.string().nullable().optional(),
  openAiCompatibleApiKey: z.string().optional(),
  openAiCompatibleApiKeyConfigured: z.boolean().optional(),
  clearOpenAiCompatibleApiKey: z.boolean().optional(),
  geminiBaseUrl: z.string().url().optional(),
  geminiModel: z.string().nullable().optional(),
  geminiApiKey: z.string().optional(),
  geminiApiKeyConfigured: z.boolean().optional(),
  clearGeminiApiKey: z.boolean().optional(),
  anthropicBaseUrl: z.string().url().optional(),
  anthropicModel: z.string().nullable().optional(),
  anthropicApiKey: z.string().optional(),
  anthropicApiKeyConfigured: z.boolean().optional(),
  clearAnthropicApiKey: z.boolean().optional(),
  language: z.enum(["system", "en", "ru"]).optional(),
  theme: z.enum(["system", "dark", "light"]).optional(),
  composerFileLimits: composerFileLimitsSchema.optional(),
  contextQualityMode: z.enum(["advisory", "balanced", "strict"]).optional(),
  selectorPipelineMode: z.enum(["legacy", "shadow_compare", "shadow_primary"]).optional(),
  contextEngineMode: z.enum(["disabled", "shadow", "canary"]).optional(),
  contextEnginePlannerMode: z.enum(["deterministic", "model_assisted"]).optional(),
  contextEngineCanaryPercent: z.number().int().min(0).max(100).optional(),
  contextEngineCanaryProjectIds: z.array(z.string().trim().min(1).max(80)).max(200).optional(),
  contextComposerEngineMode: z.enum(["legacy", "shadow_compare", "v2_primary"]).optional(),
  taskUnderstandingInteractionMode: z
    .enum(["automatic", "balanced", "confirm_all"])
    .optional(),
  sidebarShowDescriptions: z.boolean().optional(),
  onboardingEnabled: z.boolean().optional(),
  onboardingShowEveryLaunch: z.boolean().optional(),
  onboardingCompleted: z.boolean().optional(),
});

settingsRouter.get("/selector-diagnostics", async (_req, res) => {
  try {
    res.json({ ok: true, history: await getSelectorDiagnosticsHistory() });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: "Failed to load selector diagnostics",
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

settingsRouter.delete("/selector-diagnostics", async (_req, res) => {
  try {
    await clearSelectorDiagnosticsHistory();
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: "Failed to clear selector diagnostics",
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

settingsRouter.get("/context-engine-shadow-diagnostics", async (_req, res) => {
  try {
    res.json({
      ok: true,
      history: await getContextEngineShadowDiagnosticsHistory(),
    });
  } catch {
    res.status(500).json({
      ok: false,
      message: "Failed to load Context Engine shadow diagnostics",
    });
  }
});

settingsRouter.delete("/context-engine-shadow-diagnostics", async (_req, res) => {
  try {
    await clearContextEngineShadowDiagnosticsHistory();
    res.json({ ok: true });
  } catch {
    res.status(500).json({
      ok: false,
      message: "Failed to clear Context Engine shadow diagnostics",
    });
  }
});

settingsRouter.get("/context-engine-task-pack-canary", async (_req, res) => {
  try {
    res.json({ ok: true, history: await getContextEngineTaskPackCanaryHistory() });
  } catch {
    res.status(500).json({ ok: false, message: "Failed to load Context Engine Task Pack canary history" });
  }
});

settingsRouter.delete("/context-engine-task-pack-canary", async (_req, res) => {
  try {
    await clearContextEngineTaskPackCanaryHistory();
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false, message: "Failed to clear Context Engine Task Pack canary history" });
  }
});

settingsRouter.get("/", async (_req, res) => {
  try {
    const settings = await getAppSettings();

    res.json({
      ok: true,
      settings,
    });
  } catch (error) {
    console.error("Failed to load settings:", error);

    res.status(500).json({
      ok: false,
      message: "Failed to load settings",
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

settingsRouter.patch("/", async (req, res) => {
  const parsed = updateSettingsSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      message: "Invalid settings payload",
      issues: parsed.error.issues,
    });
    return;
  }

  try {
    const settings = await updateAppSettings(parsed.data);

    res.json({
      ok: true,
      settings,
    });
  } catch (error) {
    console.error("Failed to update settings:", error);

    res.status(500).json({
      ok: false,
      message: "Failed to update settings",
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
