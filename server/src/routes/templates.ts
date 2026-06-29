import { Router, type Response } from "express";
import { z } from "zod";

import {
  createTemplate,
  deleteTemplate,
  getTemplates,
  RulesServiceError,
  updateTemplate
} from "../rules/rulesService.js";

export const templatesRouter = Router();

const targetToolSchema = z.enum(["codex", "cursor", "claude", "generic"]);

const taskTypeSchema = z.enum([
  "general",
  "ui",
  "backend",
  "fullstack",
  "build",
  "bugfix",
  "refactor",
  "docs",
  "tests"
]);

const createTemplateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional(),
  targetTool: targetToolSchema,
  taskType: taskTypeSchema,
  content: z.string().trim().min(20).max(20_000)
});

const updateTemplateSchema = createTemplateSchema.partial();

function handleRouteError(res: Parameters<Parameters<typeof templatesRouter.get>[1]>[1], error: unknown) {
  if (error instanceof RulesServiceError) {
    res.status(error.statusCode).json({
      ok: false,
      message: error.message
    });
    return;
  }

  res.status(500).json({
    ok: false,
    message: "Templates request failed",
    error: error instanceof Error ? error.message : String(error)
  });
}

templatesRouter.get("/", async (_req, res) => {
  try {
    const templates = await getTemplates();

    res.json({
      ok: true,
      templates
    });
  } catch (error) {
    handleRouteError(res, error);
  }
});

templatesRouter.post("/", async (req, res) => {
  const parsed = createTemplateSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      message: "Invalid template payload",
      issues: parsed.error.issues
    });
    return;
  }

  try {
    const template = await createTemplate(parsed.data);

    res.json({
      ok: true,
      template
    });
  } catch (error) {
    handleRouteError(res, error);
  }
});

templatesRouter.put("/:id", async (req, res) => {
  const parsed = updateTemplateSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      message: "Invalid template payload",
      issues: parsed.error.issues
    });
    return;
  }

  try {
    const template = await updateTemplate(req.params.id, parsed.data);

    res.json({
      ok: true,
      template
    });
  } catch (error) {
    handleRouteError(res, error);
  }
});

templatesRouter.delete("/:id", async (req, res) => {
  try {
    await deleteTemplate(req.params.id);

    res.json({
      ok: true
    });
  } catch (error) {
    handleRouteError(res, error);
  }
});