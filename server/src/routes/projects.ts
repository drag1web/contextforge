import fs from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
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
  const result = await pool.query(
    `
    ${selectProjectsSql()}
    WHERE id = $1;
    `,
    [projectId]
  );

  return result.rows[0] ?? null;
}

function selectProjectsSql() {
  return `
    SELECT
      id,
      name,
      local_path AS "localPath",
      package_manager AS "packageManager",
      detected_stack AS "detectedStack",
      scripts,
      readiness_score AS "readinessScore",
      readiness_report AS "readinessReport",
      created_at AS "createdAt",
      updated_at AS "updatedAt",
      last_scan_at AS "lastScanAt"
    FROM projects
  `;
}

async function upsertScannedProject(localPath: string) {
  const scannedProject = await scanProject(localPath);

  const result = await pool.query(
    `
    INSERT INTO projects (
      name,
      local_path,
      package_manager,
      detected_stack,
      scripts,
      readiness_score,
      readiness_report,
      last_scan_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    ON CONFLICT (local_path)
    DO UPDATE SET
      name = EXCLUDED.name,
      package_manager = EXCLUDED.package_manager,
      detected_stack = EXCLUDED.detected_stack,
      scripts = EXCLUDED.scripts,
      readiness_score = EXCLUDED.readiness_score,
      readiness_report = EXCLUDED.readiness_report,
      updated_at = NOW(),
      last_scan_at = NOW()
    RETURNING
      id,
      name,
      local_path AS "localPath",
      package_manager AS "packageManager",
      detected_stack AS "detectedStack",
      scripts,
      readiness_score AS "readinessScore",
      readiness_report AS "readinessReport",
      created_at AS "createdAt",
      updated_at AS "updatedAt",
      last_scan_at AS "lastScanAt";
    `,
    [
      scannedProject.name,
      scannedProject.localPath,
      scannedProject.packageManager,
      JSON.stringify(scannedProject.detectedStack),
      JSON.stringify(scannedProject.scripts),
      scannedProject.readinessScore,
      JSON.stringify(scannedProject.readinessReport)
    ]
  );

  return result.rows[0];
}

projectsRouter.get("/", async (_req, res) => {
  const result = await pool.query(`
    ${selectProjectsSql()}
    ORDER BY updated_at DESC;
  `);

  res.json({
    ok: true,
    projects: result.rows
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
    const existingProject = await pool.query(
      `
      SELECT id, local_path AS "localPath"
      FROM projects
      WHERE id = $1;
      `,
      [projectId]
    );

    if (existingProject.rowCount === 0) {
      res.status(404).json({
        ok: false,
        message: "Project not found"
      });
      return;
    }

    const project = await upsertScannedProject(existingProject.rows[0].localPath);

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