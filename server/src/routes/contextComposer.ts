import { Router } from "express";
import { z } from "zod";

import { buildContextComposerPreview } from "../contextComposer/contextComposerService.js";

export const contextComposerRouter = Router();

const previewSchema = z.object({
  projectId: z.number().int().positive(),
  rawTask: z.string().trim().min(3).max(6000),
  taskType: z.string().trim().min(1).default("general"),
  targetTool: z.string().trim().min(1).default("generic")
});

contextComposerRouter.post("/preview", async (req, res) => {
  const parsed = previewSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      message: "Invalid context composer payload",
      issues: parsed.error.issues
    });
    return;
  }

  try {
    const preview = await buildContextComposerPreview(parsed.data);

    res.json({
      ok: true,
      preview
    });
  } catch (error) {
    console.error("Context composer preview failed:", error);

    const message = error instanceof Error ? error.message : "Context composer preview failed";

    res.status(message === "Project not found" ? 404 : 500).json({
      ok: false,
      message,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});