import fs from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import { z } from "zod";
import { storage } from "../storage/index.js";
import { scanProject } from "../scanner/projectScanner.js";
import { buildAgentsMarkdown } from "../context/agentsBuilder.js";
import { generateWithConfiguredOllama } from "../ollama/ollamaService.js";
import { buildAgentsEnhancementPrompt } from "../ollama/promptEnhancers.js";

export const projectsRouter = Router();

const createProjectSchema = z.object({
  localPath: z.string().min(1)
});

const saveAgentsSchema = z.object({
  markdown: z.string().min(1).optional()
});

async function getProjectById(projectId: number) {
  return storage.getProjectById(projectId);
}

async function upsertScannedProject(localPath: string) {
  const scannedProject = await scanProject(localPath);
  return storage.upsertScannedProject(scannedProject);
}

projectsRouter.get("/", async (_req, res) => {
  const projects = await storage.listProjects();

  res.json({
    ok: true,
    projects
  });
});

projectsRouter.post("/", async (req, res) => {
  const parsed = createProjectSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      message: "Invalid request body",
      issues: parsed.error.issues
    });
    return;
  }

  try {
    const project = await upsertScannedProject(parsed.data.localPath);

    res.json({
      ok: true,
      project
    });
  } catch (error) {
    console.error("Project scan failed:", error);

    res.status(500).json({
      ok: false,
      message: "Project scan failed",
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

projectsRouter.post("/:id/rescan", async (req, res) => {
  const projectId = Number(req.params.id);

  if (!Number.isInteger(projectId)) {
    res.status(400).json({
      ok: false,
      message: "Invalid project id"
    });
    return;
  }

  try {
    const existingProject = await getProjectById(projectId);

    if (!existingProject) {
      res.status(404).json({
        ok: false,
        message: "Project not found"
      });
      return;
    }

    const project = await upsertScannedProject(existingProject.localPath);

    res.json({
      ok: true,
      project
    });
  } catch (error) {
    console.error("Project rescan failed:", error);

    res.status(500).json({
      ok: false,
      message: "Project rescan failed",
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

projectsRouter.get("/:id/agents-preview", async (req, res) => {
  const projectId = Number(req.params.id);

  const bypassCache =
    req.query.bypassCache === "true" || req.query.bypassCache === "1";

  if (!Number.isInteger(projectId)) {
    res.status(400).json({
      ok: false,
      message: "Invalid project id"
    });
    return;
  }

  try {
    const project = await getProjectById(projectId);

    if (!project) {
      res.status(404).json({
        ok: false,
        message: "Project not found"
      });
      return;
    }

    const templateMarkdown = buildAgentsMarkdown(project);

    const generation = await generateWithConfiguredOllama({
      fallbackContent: templateMarkdown,
      expectedHeading: "# AGENTS.md",
      numPredict: 1800,
      bypassCache,
      prompt: buildAgentsEnhancementPrompt({
        project,
        templateMarkdown
      })
    });
    res.json({
      ok: true,
      markdown: generation.content,
      generation
    });

  } catch (error) {
    console.error("Failed to build AGENTS.md preview:", error);

    res.status(500).json({
      ok: false,
      message: "Failed to build AGENTS.md preview",
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

projectsRouter.post("/:id/agents-save", async (req, res) => {
  const projectId = Number(req.params.id);

  if (!Number.isInteger(projectId)) {
    res.status(400).json({
      ok: false,
      message: "Invalid project id"
    });
    return;
  }

  const parsed = saveAgentsSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      message: "Invalid request body",
      issues: parsed.error.issues
    });
    return;
  }

  try {
    const project = await getProjectById(projectId);

    if (!project) {
      res.status(404).json({
        ok: false,
        message: "Project not found"
      });
      return;
    }

    const generation =
      parsed.data.markdown && parsed.data.markdown.trim().length > 0
        ? {
          content: parsed.data.markdown,
          mode: "template" as const,
          model: null,
          usedFallback: false,
          message: "Saved existing AGENTS.md preview."
        }
        : await generateWithConfiguredOllama({
          fallbackContent: buildAgentsMarkdown(project),
          prompt: buildAgentsEnhancementPrompt({
            project,
            templateMarkdown: buildAgentsMarkdown(project)
          })
        });

    const markdown = generation.content;
    const agentsPath = path.join(project.localPath, "AGENTS.md");

    await fs.writeFile(agentsPath, markdown, "utf-8");

    const updatedProject = await upsertScannedProject(project.localPath);

    res.json({
      ok: true,
      message: "AGENTS.md saved successfully",
      path: agentsPath,
      project: updatedProject,
      generation
    });
  } catch (error) {
    console.error("Failed to save AGENTS.md:", error);

    res.status(500).json({
      ok: false,
      message: "Failed to save AGENTS.md",
      error: error instanceof Error ? error.message : String(error)
    });
  }
});