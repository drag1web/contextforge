import { Router } from "express";
import { z } from "zod";

import {
  buildContextComposerPreview,
  readContextComposerFileSnippet,
  searchContextComposerFiles
} from "../contextComposer/contextComposerService.js";

export const contextComposerRouter = Router();

const previewSchema = z.object({
  projectId: z.number().int().positive(),
  rawTask: z.string().trim().min(3).max(6000),
  taskType: z.string().trim().min(1).default("general"),
  targetTool: z.string().trim().min(1).default("generic")
});

const fileSearchSchema = z.object({
  projectId: z.number().int().positive(),
  query: z.string().trim().max(240).default(""),
  limit: z.number().int().min(5).max(80).default(30),
  excludePaths: z.array(z.string().trim().min(1).max(500)).max(100).optional()
});

const fileSnippetSchema = z.object({
  projectId: z.number().int().positive(),
  filePath: z.string().trim().min(1).max(500)
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

contextComposerRouter.post("/files", async (req, res) => {
  const parsed = fileSearchSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      message: "Invalid context composer file search payload",
      issues: parsed.error.issues
    });
    return;
  }

  try {
    const result = await searchContextComposerFiles(parsed.data);

    res.json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Context composer file search failed:", error);

    const message =
      error instanceof Error ? error.message : "Context composer file search failed";

    res.status(message === "Project not found" ? 404 : 500).json({
      ok: false,
      message,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

contextComposerRouter.post("/snippet", async (req, res) => {
  const parsed = fileSnippetSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      message: "Invalid context composer snippet payload",
      issues: parsed.error.issues
    });
    return;
  }

  try {
    const result = await readContextComposerFileSnippet(parsed.data);

    res.json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("Context composer snippet failed:", error);

    const message =
      error instanceof Error ? error.message : "Context composer snippet failed";

    res.status(
      message === "Project not found" || message === "File not found in project inventory"
        ? 404
        : 500
    ).json({
      ok: false,
      message,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});