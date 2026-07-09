import { Router } from "express";
import { z } from "zod";
import {
  getAiProviderStatus,
  listAiProviderModels
} from "../ai/providerService.js";
import { getAppSettings } from "../settings/settingsService.js";
import {
  clearGitHubConnection,
  getGitHubIntegrationStatus,
  pollGitHubDeviceAuth,
  startGitHubDeviceAuth
} from "../github/githubAuthService.js";

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


const githubPollSchema = z.object({
  sessionId: z.string().min(1)
});

integrationsRouter.get("/github/status", async (_req, res) => {
  try {
    const status = await getGitHubIntegrationStatus();

    res.json({
      ok: true,
      status
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: "Failed to check GitHub integration status",
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

integrationsRouter.post("/github/auth/start", async (_req, res) => {
  try {
    const auth = await startGitHubDeviceAuth();

    res.json({
      ok: true,
      auth
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      code: "github_auth_start_failed",
      message:
        error instanceof Error
          ? error.message
          : "Failed to start GitHub authorization."
    });
  }
});

integrationsRouter.post("/github/auth/poll", async (req, res) => {
  const parsed = githubPollSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      message: "Invalid GitHub auth polling payload",
      issues: parsed.error.issues
    });
    return;
  }

  try {
    const result = await pollGitHubDeviceAuth(parsed.data.sessionId);

    res.json({
      ok: true,
      result
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: "Failed to poll GitHub authorization",
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

integrationsRouter.post("/github/sign-out", async (_req, res) => {
  try {
    await clearGitHubConnection();
    const status = await getGitHubIntegrationStatus();

    res.json({
      ok: true,
      status
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: "Failed to sign out from GitHub",
      error: error instanceof Error ? error.message : String(error)
    });
  }
});
