import { Router } from "express";
import { z } from "zod";
import { getAppSettings, updateAppSettings } from "../settings/settingsService.js";

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
  tests: z.number().int().min(3).max(24)
});

const updateSettingsSchema = z.object({
  ollamaUrl: z.string().url().optional(),
  generationMode: z.enum(["template", "ollama"]).optional(),
  defaultTargetTool: z.enum(["codex", "cursor", "claude", "generic"]).optional(),
  defaultTaskType: z
    .enum(["general", "ui", "backend", "fullstack", "build", "bugfix", "refactor", "docs", "tests"])
    .optional(),
  defaultOllamaModel: z.string().nullable().optional(),
  language: z.enum(["system", "en", "ru"]).optional(),
  composerFileLimits: composerFileLimitsSchema.optional(),
  contextQualityMode: z.enum(["advisory", "balanced", "strict"]).optional(),
  sidebarShowDescriptions: z.boolean().optional()
});

settingsRouter.get("/", async (_req, res) => {
  try {
    const settings = await getAppSettings();

    res.json({
      ok: true,
      settings
    });
  } catch (error) {
    console.error("Failed to load settings:", error);

    res.status(500).json({
      ok: false,
      message: "Failed to load settings",
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

settingsRouter.patch("/", async (req, res) => {
  const parsed = updateSettingsSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      message: "Invalid settings payload",
      issues: parsed.error.issues
    });
    return;
  }

  try {
    const settings = await updateAppSettings(parsed.data);

    res.json({
      ok: true,
      settings
    });
  } catch (error) {
    console.error("Failed to update settings:", error);

    res.status(500).json({
      ok: false,
      message: "Failed to update settings",
      error: error instanceof Error ? error.message : String(error)
    });
  }
});
