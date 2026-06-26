import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { buildTaskPackPrompt } from "../prompt/taskPackBuilder.js";

export const taskPacksRouter = Router();

const createTaskPackSchema = z.object({
    projectId: z.number().int().positive(),
    rawTask: z.string().min(3),
    taskType: z.string().default("general"),
    targetTool: z.string().default("generic")
});

taskPacksRouter.get("/", async (_req, res) => {
    const result = await pool.query(`
    SELECT
      tp.id,
      tp.project_id AS "projectId",
      p.name AS "projectName",
      tp.title,
      tp.raw_task AS "rawTask",
      tp.task_type AS "taskType",
      tp.target_tool AS "targetTool",
      tp.generated_prompt AS "generatedPrompt",
      tp.created_at AS "createdAt",
      tp.updated_at AS "updatedAt"
    FROM task_packs tp
    JOIN projects p ON p.id = tp.project_id
    ORDER BY tp.created_at DESC;
  `);

    res.json({
        ok: true,
        taskPacks: result.rows
    });
});

taskPacksRouter.post("/", async (req, res) => {
    const parsed = createTaskPackSchema.safeParse(req.body);

    if (!parsed.success) {
        res.status(400).json({
            ok: false,
            message: "Invalid request body",
            issues: parsed.error.issues
        });
        return;
    }

    try {
        const projectResult = await pool.query(
            `
      SELECT
        id,
        name,
        local_path AS "localPath",
        package_manager AS "packageManager",
        detected_stack AS "detectedStack",
        scripts,
        readiness_score AS "readinessScore",
        readiness_report AS "readinessReport"
      FROM projects
      WHERE id = $1;
      `,
            [parsed.data.projectId]
        );

        if (projectResult.rowCount === 0) {
            res.status(404).json({
                ok: false,
                message: "Project not found"
            });
            return;
        }

        const project = projectResult.rows[0];

        const generatedPrompt = buildTaskPackPrompt({
            project,
            rawTask: parsed.data.rawTask,
            taskType: parsed.data.taskType,
            targetTool: parsed.data.targetTool
        });

        const title =
            parsed.data.rawTask.length > 80
                ? `${parsed.data.rawTask.slice(0, 77)}...`
                : parsed.data.rawTask;

        const result = await pool.query(
            `
      INSERT INTO task_packs (
        project_id,
        title,
        raw_task,
        task_type,
        target_tool,
        generated_prompt
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING
        id,
        project_id AS "projectId",
        title,
        raw_task AS "rawTask",
        task_type AS "taskType",
        target_tool AS "targetTool",
        generated_prompt AS "generatedPrompt",
        created_at AS "createdAt",
        updated_at AS "updatedAt";
      `,
            [
                parsed.data.projectId,
                title,
                parsed.data.rawTask,
                parsed.data.taskType,
                parsed.data.targetTool,
                generatedPrompt
            ]
        );

        res.json({
            ok: true,
            taskPack: result.rows[0]
        });
    } catch (error) {
        console.error("Failed to create task pack:", error);

        res.status(500).json({
            ok: false,
            message: "Failed to create task pack",
            error: error instanceof Error ? error.message : String(error)
        });
    }
});