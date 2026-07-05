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

const AGENTS_FILE_NAMES = ["AGENTS.md", "AGENTS.generated.md"] as const;

const saveAgentsSchema = z.object({
  markdown: z.string().min(1).optional(),
  fileName: z.enum(AGENTS_FILE_NAMES).optional()
});

const projectMemoryCategorySchema = z.enum([
  "architecture",
  "do_not_change",
  "style",
  "verification",
  "workflow",
  "custom"
]);

const createProjectMemorySchema = z.object({
  title: z.string().trim().min(1).max(120),
  content: z.string().trim().min(1).max(1200),
  category: projectMemoryCategorySchema.default("custom"),
  isEnabled: z.boolean().optional()
});

const updateProjectMemorySchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  content: z.string().trim().min(1).max(1200).optional(),
  category: projectMemoryCategorySchema.optional(),
  isEnabled: z.boolean().optional()
});

async function pathExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function getAgentsContextFile(projectRoot: string, fileName: typeof AGENTS_FILE_NAMES[number]) {
  const filePath = path.join(projectRoot, fileName);

  try {
    const stats = await fs.stat(filePath);

    if (!stats.isFile()) {
      return {
        fileName,
        path: filePath,
        exists: false,
        sizeBytes: 0,
        updatedAt: null
      };
    }

    return {
      fileName,
      path: filePath,
      exists: true,
      sizeBytes: stats.size,
      updatedAt: stats.mtime.toISOString()
    };
  } catch {
    return {
      fileName,
      path: filePath,
      exists: false,
      sizeBytes: 0,
      updatedAt: null
    };
  }
}

async function listAgentsContextFiles(projectRoot: string) {
  return Promise.all(
    AGENTS_FILE_NAMES.map((fileName) => getAgentsContextFile(projectRoot, fileName))
  );
}

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

projectsRouter.get("/:id/context-files", async (req, res) => {
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

    const files = await listAgentsContextFiles(project.localPath);

    res.json({
      ok: true,
      files
    });
  } catch (error) {
    console.error("Failed to list project context files:", error);

    res.status(500).json({
      ok: false,
      message: "Failed to list project context files",
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

projectsRouter.get("/:id/context-files/:fileName", async (req, res) => {
  const projectId = Number(req.params.id);
  const parsedFileName = z.enum(AGENTS_FILE_NAMES).safeParse(req.params.fileName);

  if (!Number.isInteger(projectId)) {
    res.status(400).json({
      ok: false,
      message: "Invalid project id"
    });
    return;
  }

  if (!parsedFileName.success) {
    res.status(400).json({
      ok: false,
      message: "Unsupported context file"
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

    const contextFile = await getAgentsContextFile(project.localPath, parsedFileName.data);

    if (!contextFile.exists) {
      res.status(404).json({
        ok: false,
        message: "Context file not found"
      });
      return;
    }

    const markdown = await fs.readFile(contextFile.path, "utf-8");

    res.json({
      ok: true,
      markdown,
      contextFile
    });
  } catch (error) {
    console.error("Failed to read project context file:", error);

    res.status(500).json({
      ok: false,
      message: "Failed to read project context file",
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

projectsRouter.get("/:id/memories", async (req, res) => {
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

    const memories = await storage.listProjectMemories(projectId);

    res.json({
      ok: true,
      memories
    });
  } catch (error) {
    console.error("Failed to list project memories:", error);

    res.status(500).json({
      ok: false,
      message: "Failed to list project memories",
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

projectsRouter.post("/:id/memories", async (req, res) => {
  const projectId = Number(req.params.id);

  if (!Number.isInteger(projectId)) {
    res.status(400).json({
      ok: false,
      message: "Invalid project id"
    });
    return;
  }

  const parsed = createProjectMemorySchema.safeParse(req.body ?? {});

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

    const memory = await storage.createProjectMemory({
      projectId,
      ...parsed.data
    });

    res.json({
      ok: true,
      memory
    });
  } catch (error) {
    console.error("Failed to create project memory:", error);

    res.status(500).json({
      ok: false,
      message: "Failed to create project memory",
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

projectsRouter.patch("/:id/memories/:memoryId", async (req, res) => {
  const projectId = Number(req.params.id);
  const memoryId = Number(req.params.memoryId);

  if (!Number.isInteger(projectId) || !Number.isInteger(memoryId)) {
    res.status(400).json({
      ok: false,
      message: "Invalid project or memory id"
    });
    return;
  }

  const parsed = updateProjectMemorySchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      message: "Invalid request body",
      issues: parsed.error.issues
    });
    return;
  }

  try {
    const memory = await storage.updateProjectMemory(projectId, memoryId, parsed.data);

    if (!memory) {
      res.status(404).json({
        ok: false,
        message: "Project memory not found"
      });
      return;
    }

    res.json({
      ok: true,
      memory
    });
  } catch (error) {
    console.error("Failed to update project memory:", error);

    res.status(500).json({
      ok: false,
      message: "Failed to update project memory",
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

projectsRouter.delete("/:id/memories/:memoryId", async (req, res) => {
  const projectId = Number(req.params.id);
  const memoryId = Number(req.params.memoryId);

  if (!Number.isInteger(projectId) || !Number.isInteger(memoryId)) {
    res.status(400).json({
      ok: false,
      message: "Invalid project or memory id"
    });
    return;
  }

  try {
    const deleted = await storage.deleteProjectMemory(projectId, memoryId);

    if (!deleted) {
      res.status(404).json({
        ok: false,
        message: "Project memory not found"
      });
      return;
    }

    res.json({
      ok: true
    });
  } catch (error) {
    console.error("Failed to delete project memory:", error);

    res.status(500).json({
      ok: false,
      message: "Failed to delete project memory",
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
    const agentsPath = path.join(project.localPath, "AGENTS.md");

    res.json({
      ok: true,
      markdown: generation.content,
      generation,
      agentsFile: {
        path: agentsPath,
        exists: await pathExists(agentsPath)
      }
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
    const fileName = parsed.data.fileName ?? "AGENTS.md";
    const agentsPath = path.join(project.localPath, fileName);

    await fs.writeFile(agentsPath, markdown, "utf-8");

    const updatedProject = await upsertScannedProject(project.localPath);

    res.json({
      ok: true,
      message: "AGENTS.md saved successfully",
      path: agentsPath,
      fileName,
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