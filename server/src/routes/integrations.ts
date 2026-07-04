import { Router } from "express";
import {
  getAiProviderStatus,
  listAiProviderModels
} from "../ai/providerService.js";
import { getAppSettings } from "../settings/settingsService.js";

export const integrationsRouter = Router();

integrationsRouter.get("/ai/status", async (_req, res) => {
  try {
    const settings = await getAppSettings();
    const status = await getAiProviderStatus(settings);

    res.json({
      ok: true,
      status
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: "Failed to check AI integration status",
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

integrationsRouter.get("/ai/models", async (_req, res) => {
  try {
    const settings = await getAppSettings();
    const models = await listAiProviderModels(settings);

    res.json({
      ok: true,
      models
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: "Failed to list AI integration models",
      error: error instanceof Error ? error.message : String(error)
    });
  }
});
