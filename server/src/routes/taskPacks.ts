import fs from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import { z } from "zod";

import { pool } from "../db/pool.js";
import { buildTaskPackPrompt } from "../prompt/taskPackBuilder.js";
import { generateWithConfiguredOllama } from "../ollama/ollamaService.js";
import { analyzeTaskIntent, type TaskIntentAnalysis } from "../ollama/taskIntentAnalyzer.js";
import {
    selectTaskFiles,
    type TaskFileSelection,
    type SelectedTaskFileUsage
} from "../ollama/taskFileSelector.js";
import {
    scanProjectInventory,
    type ProjectInventory,
    type ProjectInventoryFile,
    type ProjectInventoryFileKind
} from "../scanner/projectInventoryScanner.js";

export const taskPacksRouter = Router();

const createTaskPackSchema = z.object({
    projectId: z.number().int().positive(),
    rawTask: z.string().min(3),
    taskType: z.string().default("general"),
    targetTool: z.string().default("generic")
});

interface ProjectReadinessReport {
    issues: string[];
}

interface ProjectRow {
    id: number;
    name: string;
    localPath: string;
    packageManager: string | null;
    detectedStack: string[];
    scripts: Record<string, string>;
    readinessScore: number;
    readinessReport: ProjectReadinessReport | null;
}

interface TaskContextSnippet {
    relativePath: string;
    language: string;
    content: string;
    truncated: boolean;
}

interface TaskContextFileReference {
    path: string;
    kind: ProjectInventoryFileKind;
    usage: SelectedTaskFileUsage;
    reason: string;
    confidence: number;
    canReadText: boolean;
    sizeBytes: number;
}

interface UniversalTaskPackContext {
    taskType: string;
    effectiveTaskArea: string;
    projectTree: string[];
    relevantFiles: string[];
    fileSnippets: TaskContextSnippet[];
    fileReferences: TaskContextFileReference[];
    taskIntent?: TaskIntentAnalysis;
    fileSelection: TaskFileSelection;
    inventorySummary: {
        totalFiles: number;
        scannedFiles: number;
        truncated: boolean;
        notes: string[];
    };
    notes: string[];
}

const MAX_SNIPPET_FILES = 5;
const MAX_SNIPPET_CHARS = 1600;
const MAX_TEXT_FILE_SIZE_BYTES = 120_000;

const PROTECTED_SECTION_TITLES = new Set([
    "Relevant File Candidates",
    "Code Context Snippets",
    "Non-Text / Asset References",
    "ContextForge Assisted Notes"
]);

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
    ".ts": "ts",
    ".tsx": "tsx",
    ".js": "js",
    ".jsx": "jsx",
    ".mjs": "js",
    ".cjs": "js",
    ".css": "css",
    ".scss": "scss",
    ".sass": "sass",
    ".less": "less",
    ".html": "html",
    ".json": "json",
    ".md": "md",
    ".mdx": "mdx",
    ".txt": "text",
    ".yml": "yaml",
    ".yaml": "yaml",
    ".toml": "toml",
    ".sql": "sql",
    ".prisma": "prisma",
    ".graphql": "graphql",
    ".gql": "graphql",
    ".xml": "xml",
    ".svg": "xml"
};

function normalizePath(value: string) {
    return value.replace(/\\/g, "/");
}

function getLanguageForFile(relativePath: string) {
    const extension = path.extname(relativePath).toLowerCase();
    return LANGUAGE_BY_EXTENSION[extension] ?? "text";
}

function createTitle(rawTask: string) {
    return rawTask.length > 80 ? `${rawTask.slice(0, 77)}...` : rawTask;
}

function isSafeProjectChild(projectRoot: string, relativePath: string) {
    const root = path.resolve(projectRoot);
    const target = path.resolve(projectRoot, relativePath);

    return target === root || target.startsWith(`${root}${path.sep}`);
}

function findInventoryFile(inventory: ProjectInventory, relativePath: string) {
    const normalized = normalizePath(relativePath).toLowerCase();

    return inventory.files.find(
        (file) => normalizePath(file.path).toLowerCase() === normalized
    );
}

function getUniqueStrings(values: string[]) {
    return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function isBackendRouteLikePath(relativePath: string) {
    const normalizedPath = normalizePath(relativePath).toLowerCase();
    const fileName = normalizedPath.split("/").pop() ?? normalizedPath;

    const isServerFolder =
        normalizedPath.startsWith("server/") ||
        normalizedPath.includes("/server/") ||
        normalizedPath.startsWith("backend/") ||
        normalizedPath.includes("/backend/");

    const isBackendRoleFolder =
        normalizedPath.startsWith("routes/") ||
        normalizedPath.includes("/routes/") ||
        normalizedPath.startsWith("controllers/") ||
        normalizedPath.includes("/controllers/") ||
        normalizedPath.startsWith("middleware/") ||
        normalizedPath.includes("/middleware/") ||
        normalizedPath.startsWith("middlewares/") ||
        normalizedPath.includes("/middlewares/");

    const isFrameworkApiRoute =
        normalizedPath.startsWith("app/api/") ||
        normalizedPath.includes("/app/api/") ||
        normalizedPath.startsWith("pages/api/") ||
        normalizedPath.includes("/pages/api/") ||
        normalizedPath.endsWith("/route.ts") ||
        normalizedPath.endsWith("/route.tsx") ||
        normalizedPath.endsWith("/route.js") ||
        normalizedPath.endsWith("/route.jsx");

    const isBackendEntry =
        fileName === "server.ts" ||
        fileName === "server.js" ||
        fileName === "server.mjs" ||
        fileName === "server.cjs" ||
        ((fileName === "app.ts" ||
            fileName === "app.js" ||
            fileName === "index.ts" ||
            fileName === "index.js") &&
            isServerFolder);

    return isServerFolder || isBackendRoleFolder || isFrameworkApiRoute || isBackendEntry;
}

function inventoryHasBackendRouteFiles(inventory: ProjectInventory) {
    return inventory.files.some((file) => isBackendRouteLikePath(file.path));
}

function normalizeTaskTypeSection(markdown: string, context: UniversalTaskPackContext) {
    const effectiveTaskArea = String(context.effectiveTaskArea || context.taskType || "general").trim() || "general";
    const taskTypeSectionPattern = /(## Task Type\s*\n+)([\s\S]*?)(\n+## Task\s*\n)/;

    if (!taskTypeSectionPattern.test(markdown)) {
        return markdown;
    }

    return markdown.replace(taskTypeSectionPattern, `$1${effectiveTaskArea}$3`);
}

function shouldReadSnippet(file: ProjectInventoryFile) {
    if (!file.canReadText) {
        return false;
    }

    if (file.kind === "asset") {
        return false;
    }

    if (file.kind === "runtime") {
        return false;
    }

    if (file.kind === "data") {
        return false;
    }

    if (file.sizeBytes > MAX_TEXT_FILE_SIZE_BYTES) {
        return false;
    }

    return true;
}

async function readFileSnippet(
    projectRoot: string,
    file: ProjectInventoryFile
): Promise<TaskContextSnippet | null> {
    if (!shouldReadSnippet(file)) {
        return null;
    }

    if (!isSafeProjectChild(projectRoot, file.path)) {
        return null;
    }

    const absolutePath = path.join(projectRoot, file.path);

    try {
        const content = await fs.readFile(absolutePath, "utf8");
        const truncated = content.length > MAX_SNIPPET_CHARS;

        return {
            relativePath: file.path,
            language: getLanguageForFile(file.path),
            content: truncated ? content.slice(0, MAX_SNIPPET_CHARS) : content,
            truncated
        };
    } catch {
        return null;
    }
}

async function buildSelectedFileSnippets({
    projectRoot,
    inventory,
    fileSelection
}: {
    projectRoot: string;
    inventory: ProjectInventory;
    fileSelection: TaskFileSelection;
}) {
    const snippets: TaskContextSnippet[] = [];

    for (const selectedFile of fileSelection.selectedFiles) {
        if (snippets.length >= MAX_SNIPPET_FILES) {
            break;
        }

        const inventoryFile = findInventoryFile(inventory, selectedFile.path);

        if (!inventoryFile) {
            continue;
        }

        const snippet = await readFileSnippet(projectRoot, inventoryFile);

        if (snippet) {
            snippets.push(snippet);
        }
    }

    return snippets;
}

function buildFileReferences({
    inventory,
    fileSelection
}: {
    inventory: ProjectInventory;
    fileSelection: TaskFileSelection;
}): TaskContextFileReference[] {
    const references: TaskContextFileReference[] = [];

    for (const selectedFile of fileSelection.selectedFiles) {
        const inventoryFile = findInventoryFile(inventory, selectedFile.path);

        if (!inventoryFile) {
            continue;
        }

        references.push({
            path: inventoryFile.path,
            kind: inventoryFile.kind,
            usage: selectedFile.usage,
            reason: selectedFile.reason,
            confidence: selectedFile.confidence,
            canReadText: inventoryFile.canReadText,
            sizeBytes: inventoryFile.sizeBytes
        });
    }

    return references;
}

function buildContextNotes({
    inventory,
    taskIntent,
    fileSelection
}: {
    inventory: ProjectInventory;
    taskIntent?: TaskIntentAnalysis;
    fileSelection: TaskFileSelection;
}) {
    const notes: string[] = [];
    const uniqueRejectedModelPaths = getUniqueStrings(fileSelection.rejectedModelPaths);

    notes.push("Project inventory was collected by ContextForge before selecting files.");
    notes.push(
        "Files were selected from real inventory paths and validated before being added to this Task Pack."
    );
    notes.push(
        "Protected context sections were generated by the backend and restored after local AI generation."
    );

    if (taskIntent) {
        notes.push(
            `Task intent source: ${taskIntent.source}; area: ${taskIntent.taskArea}; confidence: ${taskIntent.confidence}.`
        );
    }

    if ("effectiveTaskArea" in fileSelection) {
        notes.push(`Effective task area: ${fileSelection.effectiveTaskArea}.`);
    }

    if ("assetMode" in fileSelection) {
        notes.push(`Asset mode: ${fileSelection.assetMode}.`);
    }

    if ("conflictNote" in fileSelection && fileSelection.conflictNote) {
        notes.push(fileSelection.conflictNote);
    }

    notes.push(
        `File selection source: ${fileSelection.source}; selected files: ${fileSelection.selectedFiles.length}.`
    );

    if (uniqueRejectedModelPaths.length > 0) {
        notes.push(
            `Rejected ${uniqueRejectedModelPaths.length} model-selected path(s) because they were not present in inventory or were blocked by safety rules.`
        );
    }

    if (
        "effectiveTaskArea" in fileSelection &&
        fileSelection.effectiveTaskArea === "fullstack" &&
        !inventoryHasBackendRouteFiles(inventory)
    ) {
        notes.push(
            "No backend/server route files were found in the scanned project inventory. This appears to be a frontend-only or client-only project, so the Task Pack selected available UI/client API files and the external agent should document the expected backend endpoint contract instead of inventing server files."
        );
    }

    if (inventory.truncated) {
        notes.push("Project inventory was truncated, so some deep/extra files may be missing.");
    }

    notes.push(...inventory.notes);
    notes.push(...fileSelection.notes);

    return Array.from(new Set(notes.filter(Boolean)));
}

function buildUniversalTaskPackContext({
    taskType,
    inventory,
    taskIntent,
    fileSelection,
    fileSnippets,
    fileReferences
}: {
    taskType: string;
    inventory: ProjectInventory;
    taskIntent?: TaskIntentAnalysis;
    fileSelection: TaskFileSelection;
    fileSnippets: TaskContextSnippet[];
    fileReferences: TaskContextFileReference[];
}): UniversalTaskPackContext {
    return {
        taskType,
        effectiveTaskArea:
            "effectiveTaskArea" in fileSelection
                ? fileSelection.effectiveTaskArea
                : taskIntent?.taskArea ?? taskType,
        projectTree: inventory.files.map((file) => file.path),
        relevantFiles: fileSelection.selectedFiles.map((file) => file.path),
        fileSnippets,
        fileReferences,
        taskIntent,
        fileSelection,
        inventorySummary: {
            totalFiles: inventory.totalFiles,
            scannedFiles: inventory.scannedFiles,
            truncated: inventory.truncated,
            notes: inventory.notes
        },
        notes: buildContextNotes({
            inventory,
            taskIntent,
            fileSelection
        })
    };
}

function formatFileSize(sizeBytes: number) {
    if (sizeBytes < 1024) {
        return `${sizeBytes} B`;
    }

    if (sizeBytes < 1024 * 1024) {
        return `${Math.round(sizeBytes / 1024)} KB`;
    }

    return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
}

function buildRelevantFilesSection(context: UniversalTaskPackContext) {
    if (context.fileReferences.length === 0) {
        return `
## Relevant File Candidates

No relevant files were selected. Inspect the project manually before editing.
`.trim();
    }

    const rows = context.fileReferences.map((file) => {
        const confidence = Math.round(file.confidence * 100);

        return [
            `- ${file.path}`,
            `  - kind: ${file.kind}`,
            `  - usage: ${file.usage}`,
            `  - confidence: ${confidence}%`,
            `  - size: ${formatFileSize(file.sizeBytes)}`,
            `  - reason: ${file.reason}`
        ].filter(Boolean).join("\n");
    });

    return `
## Relevant File Candidates

Inspect these files before modifying code:

${rows.join("\n")}
`.trim();
}

function buildCodeSnippetsSection(context: UniversalTaskPackContext) {
    if (context.fileSnippets.length === 0) {
        return `
## Code Context Snippets

No text snippets were included. Selected files may be binary assets, too large, or unavailable for safe text reading.
`.trim();
    }

    const snippets = context.fileSnippets.map((snippet) => {
        const truncationNote = snippet.truncated
            ? "\n\n<!-- Snippet truncated. Inspect the full file before editing. -->"
            : "";

        return `
### ${snippet.relativePath}

\`\`\`${snippet.language}
${snippet.content}
${truncationNote}
\`\`\`
`.trim();
    });

    return `
## Code Context Snippets

These snippets are partial context only. Inspect full files before editing.

${snippets.join("\n\n")}
`.trim();
}

function buildAssetReferenceSection(context: UniversalTaskPackContext) {
    const assetLikeFiles = context.fileReferences.filter(
        (file) =>
            file.kind === "asset" ||
            file.kind === "data" ||
            file.kind === "runtime" ||
            !file.canReadText
    );

    if (assetLikeFiles.length === 0) {
        return "";
    }

    const rows = assetLikeFiles.map((file) => {
        return [
            `- ${file.path}`,
            `  - kind: ${file.kind}`,
            `  - usage: ${file.usage}`,
            `  - size: ${formatFileSize(file.sizeBytes)}`,
            `  - note: binary/non-text content was not read into the prompt`
        ].join("\n");
    });

    return `
## Non-Text / Asset References

These files may be relevant, but their binary or non-text content was not embedded.

${rows.join("\n")}
`.trim();
}

function buildContextForgeNotesSection(context: UniversalTaskPackContext) {
    const rejectedModelPaths = getUniqueStrings(context.fileSelection.rejectedModelPaths);
    const intent = context.taskIntent
        ? [
              `- Source: ${context.taskIntent.source}`,
              `- Task area: ${context.taskIntent.taskArea}`,
              `- Risk level: ${context.taskIntent.riskLevel}`,
              `- Confidence: ${context.taskIntent.confidence}`,
              context.taskIntent.intentTags.length > 0
                  ? `- Intent tags: ${context.taskIntent.intentTags.join(", ")}`
                  : null,
              context.taskIntent.domainTerms.length > 0
                  ? `- Domain terms: ${context.taskIntent.domainTerms.join(", ")}`
                  : null,
              context.taskIntent.fileRoleHints.length > 0
                  ? `- File role hints: ${context.taskIntent.fileRoleHints.join(", ")}`
                  : null
          ]
              .filter(Boolean)
              .join("\n")
        : "- Task intent analysis was not available.";

    const fileSelection = [
        `- Source: ${context.fileSelection.source}`,
        `- Used fallback: ${context.fileSelection.usedFallback ? "yes" : "no"}`,
        `- Duration: ${context.fileSelection.durationMs} ms`,
        `- Effective task area: ${context.effectiveTaskArea}`,
        "assetMode" in context.fileSelection
            ? `- Asset mode: ${context.fileSelection.assetMode}`
            : null,
        "conflictNote" in context.fileSelection && context.fileSelection.conflictNote
            ? `- Task type conflict: ${context.fileSelection.conflictNote}`
            : null,
        rejectedModelPaths.length > 0
            ? `- Rejected model paths: ${rejectedModelPaths.join(", ")}`
            : "- Rejected model paths: none"
    ].filter(Boolean).join("\n");

    const inventory = [
        `- Total files found: ${context.inventorySummary.totalFiles}`,
        `- Files kept in inventory: ${context.inventorySummary.scannedFiles}`,
        `- Truncated: ${context.inventorySummary.truncated ? "yes" : "no"}`
    ].join("\n");

    const notes =
        context.notes.length > 0
            ? context.notes.map((note) => `- ${note}`).join("\n")
            : "- No additional notes.";

    return `
## ContextForge Assisted Notes

### Task Intent Analysis

${intent}

### AI File Selection

${fileSelection}

### Project Inventory

${inventory}

### Notes

${notes}
`.trim();
}

function buildProtectedContextBlock(context: UniversalTaskPackContext) {
    return [
        buildRelevantFilesSection(context),
        buildCodeSnippetsSection(context),
        buildAssetReferenceSection(context),
        buildContextForgeNotesSection(context)
    ]
        .filter(Boolean)
        .join("\n\n---\n\n")
        .trim();
}

function normalizeSectionTitle(value: string) {
    return value.trim().replace(/\s+/g, " ");
}

function removeProtectedSections(markdown: string) {
    const lines = markdown.split(/\r?\n/);
    const output: string[] = [];
    let skipping = false;

    for (const line of lines) {
        const headingMatch = line.match(/^##\s+(.+?)\s*$/);

        if (headingMatch) {
            const title = normalizeSectionTitle(headingMatch[1]);

            if (PROTECTED_SECTION_TITLES.has(title)) {
                skipping = true;
                continue;
            }

            skipping = false;
        }

        if (!skipping) {
            output.push(line);
        }
    }

    return output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function insertBeforeSection(markdown: string, sectionTitle: string, content: string) {
    const marker = `\n${sectionTitle}`;

    if (!markdown.includes(marker)) {
        return `${markdown.trim()}\n\n---\n\n${content}`;
    }

    return markdown.replace(marker, `\n${content}\n\n---\n\n${sectionTitle}`);
}

function ensureHeading(markdown: string) {
    const trimmed = markdown.trim();

    if (trimmed.startsWith("# AI Task Pack")) {
        return trimmed;
    }

    const firstTaskPackIndex = trimmed.indexOf("# AI Task Pack");

    if (firstTaskPackIndex >= 0) {
        return trimmed.slice(firstTaskPackIndex).trim();
    }

    return `# AI Task Pack\n\n${trimmed}`;
}

function restoreProtectedSections(
    markdown: string,
    context: UniversalTaskPackContext
) {
    const withoutProtectedSections = removeProtectedSections(markdown);
    const protectedBlock = buildProtectedContextBlock(context);

    return insertBeforeSection(
        withoutProtectedSections,
        "## Agent Instructions",
        protectedBlock
    )
        .replace(/\n{4,}/g, "\n\n\n")
        .trim();
}

function buildContextAwareTemplatePrompt(
    templatePrompt: string,
    context: UniversalTaskPackContext
) {
    return normalizeTaskTypeSection(restoreProtectedSections(templatePrompt, context), context);
}

function buildTaskPackGenerationPrompt({
    project,
    contextAwareTemplatePrompt,
    rawTask,
    taskType,
    targetTool,
    context
}: {
    project: ProjectRow;
    contextAwareTemplatePrompt: string;
    rawTask: string;
    taskType: string;
    targetTool: string;
    context: UniversalTaskPackContext;
}) {
    const hasTestScript = Boolean(project.scripts?.test);

    return `
You are ContextForge's local AI generation engine.

Your job:
Improve the surrounding Task Pack instructions for an external AI coding agent.

Important:
- The Task Pack is for ${targetTool}.
- The external coding agent will perform the edits, not you.
- Do not claim that you edited files.
- Do not invent files, APIs, scripts, folders, dependencies, or implementation details.
- Use only the project metadata and validated context provided.
- Preserve the user's actual task.
- Keep the document focused, safe, and actionable.
- Do not rewrite or summarize code snippets.
- Do not replace snippets with placeholder comments.
- Do not remove file candidates selected by ContextForge.
- Protected sections are backend-generated and will be restored after your generation:
  - Relevant File Candidates
  - Code Context Snippets
  - Non-Text / Asset References
  - ContextForge Assisted Notes
- Output Markdown only.
- Do not wrap the answer in code fences.
- Do not add commentary before or after the document.
- The first line must be exactly: # AI Task Pack
- The "## Task Type" section must contain the Effective task area value, not the originally requested task type.
- ${
        hasTestScript
            ? "The project has a test script. You may include it in verification."
            : "The project has no detected test script. Do not recommend npm run test."
    }

Required document structure:
# AI Task Pack
## Target Tool
## Task Type
## Task
## Project Context
## Relevant File Candidates
## Code Context Snippets
## Agent Instructions
## Constraints
## Known AI-Readiness Issues
## Acceptance Criteria
## Verification
## ContextForge Assisted Notes
## Expected Final Response

Project metadata:
${JSON.stringify(
        {
            name: project.name,
            localPath: project.localPath,
            packageManager: project.packageManager,
            detectedStack: project.detectedStack,
            scripts: project.scripts,
            readinessScore: project.readinessScore
        },
        null,
        2
    )}

User task:
${rawTask}

Requested task type:
${taskType}

Effective task area:
${context.effectiveTaskArea}

Target tool:
${targetTool}

Validated task context summary:
${JSON.stringify(
        {
            relevantFiles: context.relevantFiles,
            fileReferences: context.fileReferences,
            taskIntent: context.taskIntent,
            fileSelection: {
                source: context.fileSelection.source,
                usedFallback: context.fileSelection.usedFallback,
                rejectedModelPaths: context.fileSelection.rejectedModelPaths,
                notes: context.fileSelection.notes
            },
            inventorySummary: context.inventorySummary
        },
        null,
        2
    )}

Template Task Pack:
${contextAwareTemplatePrompt}
`.trim();
}

function postProcessGeneratedTaskPack(
    generatedPrompt: string,
    fallbackPrompt: string,
    context: UniversalTaskPackContext
) {
    const candidate = generatedPrompt.trim().startsWith("# AI Task Pack")
        ? generatedPrompt
        : fallbackPrompt;

    const withHeading = ensureHeading(candidate);
    const withEffectiveTaskType = normalizeTaskTypeSection(withHeading, context);

    return restoreProtectedSections(withEffectiveTaskType, context);
}

async function getProjectById(projectId: number): Promise<ProjectRow | null> {
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
        [projectId]
    );

    return projectResult.rows[0] ?? null;
}

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
          tp.generation_mode AS "generationMode",
          tp.generation_model AS "generationModel",
          tp.generation_message AS "generationMessage",
          tp.generation_used_fallback AS "generationUsedFallback",
          tp.generation_duration_ms AS "generationDurationMs",
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
        const project = await getProjectById(parsed.data.projectId);

        if (!project) {
            res.status(404).json({
                ok: false,
                message: "Project not found"
            });
            return;
        }

        const inventory = await scanProjectInventory(project.localPath);

        const taskIntent = await analyzeTaskIntent({
            rawTask: parsed.data.rawTask,
            taskType: parsed.data.taskType,
            targetTool: parsed.data.targetTool,
            project,
            projectTree: inventory.files.map((file) => file.path)
        });

        const fileSelection = await selectTaskFiles({
            rawTask: parsed.data.rawTask,
            taskType: parsed.data.taskType,
            targetTool: parsed.data.targetTool,
            inventory,
            taskIntent
        });

        const fileReferences = buildFileReferences({
            inventory,
            fileSelection
        });

        const fileSnippets = await buildSelectedFileSnippets({
            projectRoot: project.localPath,
            inventory,
            fileSelection
        });

        const universalContext = buildUniversalTaskPackContext({
            taskType: parsed.data.taskType,
            inventory,
            taskIntent,
            fileSelection,
            fileSnippets,
            fileReferences
        });

        const projectForPrompt = {
            ...project,
            readinessReport: project.readinessReport ?? { issues: [] }
        };

        const effectiveTaskType =
            "effectiveTaskArea" in fileSelection
                ? fileSelection.effectiveTaskArea
                : taskIntent.taskArea !== "general"
                    ? taskIntent.taskArea
                    : parsed.data.taskType;

        const templatePrompt = buildTaskPackPrompt({
            project: projectForPrompt,
            rawTask: parsed.data.rawTask,
            taskType: effectiveTaskType,
            targetTool: parsed.data.targetTool
        });

        const contextAwareTemplatePrompt = buildContextAwareTemplatePrompt(
            templatePrompt,
            universalContext
        );

        const generation = await generateWithConfiguredOllama({
            fallbackContent: contextAwareTemplatePrompt,
            expectedHeading: "# AI Task Pack",
            numPredict: 2200,
            prompt: buildTaskPackGenerationPrompt({
                project,
                contextAwareTemplatePrompt,
                rawTask: parsed.data.rawTask,
                taskType: parsed.data.taskType,
                targetTool: parsed.data.targetTool,
                context: universalContext
            })
        });

        const generatedPrompt = postProcessGeneratedTaskPack(
            generation.content,
            contextAwareTemplatePrompt,
            universalContext
        );

        const title = createTitle(parsed.data.rawTask);

        const result = await pool.query(
            `
            INSERT INTO task_packs (
              project_id,
              title,
              raw_task,
              task_type,
              target_tool,
              generated_prompt,
              generation_mode,
              generation_model,
              generation_message,
              generation_used_fallback,
              generation_duration_ms
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING
              id,
              project_id AS "projectId",
              title,
              raw_task AS "rawTask",
              task_type AS "taskType",
              target_tool AS "targetTool",
              generated_prompt AS "generatedPrompt",
              generation_mode AS "generationMode",
              generation_model AS "generationModel",
              generation_message AS "generationMessage",
              generation_used_fallback AS "generationUsedFallback",
              generation_duration_ms AS "generationDurationMs",
              created_at AS "createdAt",
              updated_at AS "updatedAt";
            `,
            [
                project.id,
                title,
                parsed.data.rawTask,
                effectiveTaskType,
                parsed.data.targetTool,
                generatedPrompt,
                generation.mode,
                generation.model,
                generation.message,
                generation.usedFallback,
                generation.durationMs
            ]
        );

        res.json({
            ok: true,
            taskPack: {
                ...result.rows[0],
                projectName: project.name
            }
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
