import { Router } from "express";
import { getSettingValue } from "../settings/settingsService.js";
import { config } from "../config/index.js";

export const ollamaRouter = Router();

async function getOllamaUrl() {
  return getSettingValue("ollama_url", config.ollamaUrl);
}

ollamaRouter.get("/health", async (_req, res) => {
  const ollamaUrl = await getOllamaUrl();

  try {
    const response = await fetch(`${ollamaUrl}/api/tags`);

    if (!response.ok) {
      res.status(200).json({
        ok: true,
        ollama: {
          online: false,
          url: ollamaUrl,
          message: `Ollama responded with status ${response.status}`
        }
      });
      return;
    }

    res.json({
      ok: true,
      ollama: {
        online: true,
        url: ollamaUrl,
        message: "Ollama is available"
      }
    });
  } catch (error) {
    res.status(200).json({
      ok: true,
      ollama: {
        online: false,
        url: ollamaUrl,
        message: error instanceof Error ? error.message : "Ollama is not available"
      }
    });
  }
});

ollamaRouter.get("/models", async (_req, res) => {
  const ollamaUrl = await getOllamaUrl();

  try {
    const response = await fetch(`${ollamaUrl}/api/tags`);

    if (!response.ok) {
      res.json({
        ok: true,
        models: []
      });
      return;
    }

    const data = await response.json();

    res.json({
      ok: true,
      models: Array.isArray(data.models) ? data.models : []
    });
  } catch {
    res.json({
      ok: true,
      models: []
    });
  }
});