import path from "node:path";

import type {
  ProjectRecord,
  StorageAdapter,
  TaskPackRecord,
} from "../storage/types.js";
import { isSecretLikePath } from "../selection/safetyPolicy.js";
import type { CreateTaskPackRequest } from "../routes/taskPacks.js";
import {
  ContextForgeMcpError,
} from "./mcpErrors.js";
import { createMcpSuccess } from "./mcpContracts.js";
import type { ContextForgeMcpPermissions } from "./mcpPermissions.js";

const DEFAULT_LIST_LIMIT = 25;
const MAX_LIST_LIMIT = 100;
const MAX_MEMORY_CONTENT_CHARS = 12_000;
const MAX_TASK_PROMPT_CHARS = 120_000;
const MAX_RAW_TASK_CHARS = 12_000;
const MAX_SANITIZED_ARRAY_ITEMS = 100;

function normalizeLimit(limit?: number) {
  if (!Number.isInteger(limit)) return DEFAULT_LIST_LIMIT;
  return Math.min(Math.max(limit ?? DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT);
}

function normalizeOffset(offset?: number) {
  return Number.isInteger(offset) && (offset ?? 0) > 0 ? offset! : 0;
}

function truncateText(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return { value, truncated: false, originalChars: value.length };
  }

  return {
    value: value.slice(0, maxChars),
    truncated: true,
    originalChars: value.length,
  };
}

function isAbsolutePathString(value: string) {
  return path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value);
}

function redactSensitiveText(value: string) {
  return value
    .replace(/\b(bearer)\s+[a-z0-9._~+/=-]+/gi, "$1 [redacted]")
    .replace(
      /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\b\s*[:=]\s*([^\s,;]+)/gi,
      "$1=[redacted]",
    );
}

function sanitizeStoredValue(value: unknown, key = ""): unknown {
  const normalizedKey = key.toLowerCase();

  if (
    normalizedKey.includes("apikey") ||
    normalizedKey.includes("api_key") ||
    normalizedKey.includes("token") ||
    normalizedKey.includes("password") ||
    normalizedKey.includes("secret")
  ) {
    return "[redacted]";
  }

  if (typeof value === "string") {
    if (isAbsolutePathString(value)) return "<local-path>";
    if (isSecretLikePath(value) && /[\\/]|^\./.test(value)) {
      return "[redacted-secret-path]";
    }
    return redactSensitiveText(value);
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_SANITIZED_ARRAY_ITEMS)
      .map((item) => sanitizeStoredValue(item, key));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        sanitizeStoredValue(childValue, childKey),
      ]),
    );
  }

  return value;
}

function readinessStatus(score: number) {
  if (score >= 80) return "ready";
  if (score >= 50) return "needs_review";
  return "blocked";
}

function projectSummary(project: ProjectRecord, includeLocalPath: boolean) {
  return {
    projectId: project.id,
    name: project.name,
    ...(includeLocalPath ? { localPath: project.localPath } : {}),
    detectedStack: project.detectedStack.slice(0, 30),
    packageManager: project.packageManager,
    readiness: {
      score: project.readinessScore,
      status: readinessStatus(project.readinessScore),
    },
    lastScanAt: project.lastScanAt,
    updatedAt: project.updatedAt,
    warnings: sanitizeStoredValue(
      project.readinessReport?.issues?.slice(0, 20) ?? [],
    ) as string[],
  };
}

function extractRecipeSummary(recipe: unknown) {
  if (!recipe || typeof recipe !== "object") return null;
  const record = recipe as Record<string, unknown>;
  const selector =
    record.selectorDiagnostics &&
    typeof record.selectorDiagnostics === "object"
      ? (record.selectorDiagnostics as Record<string, unknown>)
      : null;
  const actual =
    selector?.actual && typeof selector.actual === "object"
      ? (selector.actual as Record<string, unknown>)
      : null;
  const generation = record.generationDiagnostics;

  return sanitizeStoredValue({
    template: record.template ?? null,
    ruleProfile: record.ruleProfile ?? null,
    counts: record.counts ?? null,
    selection:
      selector
        ? {
            status: selector.status ?? null,
            executionStatus: selector.executionStatus ?? null,
            qualityStatus: selector.qualityStatus ?? null,
            selectionOrigin: selector.selectionOrigin ?? null,
            actual: actual
              ? {
                  pipeline: actual.pipeline ?? null,
                  selectedFiles: actual.selectedFiles ?? [],
                  primaryTarget: actual.primaryTarget ?? null,
                  implementationArea: actual.implementationArea ?? null,
                  confidence: actual.confidence ?? null,
                  quality: actual.quality ?? null,
                  blocked: actual.blocked ?? false,
                  manualReview: actual.manualReview ?? false,
                  missingTarget: actual.missingTarget ?? false,
                  outcome: actual.outcome ?? null,
                  abstention: actual.abstention ?? null,
                }
              : null,
          }
        : null,
    generationDiagnostics:
      generation && typeof generation === "object"
        ? {
            status: (generation as Record<string, unknown>).status ?? null,
            fallbackReason:
              (generation as Record<string, unknown>).fallbackReason ?? null,
          }
        : null,
  });
}

function taskPackSafetyWarnings(recipe: unknown) {
  if (!recipe || typeof recipe !== "object") return [];
  const selector = (recipe as Record<string, unknown>).selectorDiagnostics;
  if (!selector || typeof selector !== "object") return [];
  const selectorRecord = selector as Record<string, unknown>;
  const actual =
    selectorRecord.actual && typeof selectorRecord.actual === "object"
      ? (selectorRecord.actual as Record<string, unknown>)
      : null;
  const warnings: string[] = [];

  if (selectorRecord.qualityStatus === "blocked" || actual?.blocked === true) {
    warnings.push("MCP_CONTEXT_SELECTION_BLOCKED");
  }
  if (
    selectorRecord.status === "manual-review" ||
    actual?.manualReview === true
  ) {
    warnings.push("MCP_MANUAL_REVIEW_REQUIRED");
  }

  return warnings;
}

export type TaskPackPipelineResult = Awaited<
  ReturnType<typeof import("../routes/taskPacks.js").createTaskPackWithPipeline>
>;

export type TaskPackCreator = (
  input: CreateTaskPackRequest,
) => Promise<TaskPackPipelineResult>;

async function defaultTaskPackCreator(input: CreateTaskPackRequest) {
  const { createTaskPackWithPipeline } = await import(
    "../routes/taskPacks.js"
  );
  return createTaskPackWithPipeline(input);
}

export class ContextForgeMcpServices {
  constructor(
    private readonly storage: StorageAdapter,
    private readonly permissions: ContextForgeMcpPermissions,
    private readonly createTaskPackUsingPipeline: TaskPackCreator =
      defaultTaskPackCreator,
  ) {}

  async listProjects(input: {
    limit?: number;
    query?: string;
    includeLocalPath?: boolean;
  }) {
    const limit = normalizeLimit(input.limit);
    const query = input.query?.trim().toLowerCase();
    const projects = (await this.storage.listProjects()).filter((project) =>
      query ? project.name.toLowerCase().includes(query) : true,
    );
    const returned = projects.slice(0, limit);

    return createMcpSuccess({
      operation: "contextforge_list_projects",
      data: {
        projects: returned.map((project) =>
          projectSummary(project, input.includeLocalPath === true),
        ),
        returnedCount: returned.length,
        totalCount: projects.length,
        truncated: returned.length < projects.length,
        nextOffset: returned.length < projects.length ? returned.length : null,
      },
      warnings: [
        "Git summary is unavailable in stored Project records and was not recomputed.",
      ],
    });
  }

  async getProjectOverview(input: {
    projectId: number;
    includeLocalPath?: boolean;
    includeScripts?: boolean;
    includeReadiness?: boolean;
  }) {
    const project = await this.requireProject(input.projectId);
    const [memories, taskPacks] = await Promise.all([
      this.storage.listProjectMemories(project.id),
      this.storage.listTaskPacks(),
    ]);
    const projectTaskPacks = taskPacks.filter(
      (taskPack) => taskPack.projectId === project.id,
    );

    return createMcpSuccess({
      operation: "contextforge_get_project_overview",
      projectId: project.id,
      data: {
        project: {
          ...projectSummary(project, input.includeLocalPath === true),
          ...(input.includeScripts === false
            ? {}
            : {
                scripts: sanitizeStoredValue(
                  Object.fromEntries(Object.entries(project.scripts).slice(0, 100)),
                ),
              }),
          ...(input.includeReadiness === false
            ? {}
            : {
                readinessReport: sanitizeStoredValue(project.readinessReport),
              }),
        },
        scannerSummary: sanitizeStoredValue(
          (project.readinessReport as { signals?: unknown })?.signals ?? null,
        ),
        enabledMemoryCount: memories.filter((memory) => memory.isEnabled).length,
        taskPackHistory: {
          totalCount: projectTaskPacks.length,
          latestCreatedAt: projectTaskPacks[0]?.createdAt ?? null,
        },
      },
      warnings: [],
    });
  }

  async listProjectMemory(input: {
    projectId: number;
    enabledOnly?: boolean;
    category?: string;
    limit?: number;
    offset?: number;
  }) {
    await this.requireProject(input.projectId);
    const limit = normalizeLimit(input.limit);
    const offset = normalizeOffset(input.offset);
    const enabledOnly = input.enabledOnly !== false;
    const memories = (await this.storage.listProjectMemories(input.projectId))
      .filter((memory) => (enabledOnly ? memory.isEnabled : true))
      .filter((memory) =>
        input.category ? memory.category === input.category : true,
      );
    const returned = memories.slice(offset, offset + limit).map((memory) => {
      const content = truncateText(memory.content, MAX_MEMORY_CONTENT_CHARS);
      return {
        memoryId: memory.id,
        title: memory.title,
        category: memory.category,
        content: content.value,
        contentTruncated: content.truncated,
        enabled: memory.isEnabled,
        createdAt: memory.createdAt,
        updatedAt: memory.updatedAt,
        provenance: "contextforge-project-memory",
      };
    });

    return createMcpSuccess({
      operation: "contextforge_list_project_memory",
      projectId: input.projectId,
      data: {
        memories: returned,
        returnedCount: returned.length,
        totalCount: memories.length,
        truncated: offset + returned.length < memories.length,
        nextOffset:
          offset + returned.length < memories.length
            ? offset + returned.length
            : null,
      },
      warnings: [
        "This storage schema does not include extended memory source or confidence metadata.",
      ],
    });
  }

  async listTaskPacks(input: {
    projectId?: number;
    limit?: number;
    offset?: number;
    taskType?: string;
    targetTool?: string;
  }) {
    if (input.projectId !== undefined) {
      await this.requireProject(input.projectId);
    }
    const limit = normalizeLimit(input.limit);
    const offset = normalizeOffset(input.offset);
    const taskPacks = (await this.storage.listTaskPacks())
      .filter((taskPack) =>
        input.projectId ? taskPack.projectId === input.projectId : true,
      )
      .filter((taskPack) =>
        input.taskType ? taskPack.taskType === input.taskType : true,
      )
      .filter((taskPack) =>
        input.targetTool ? taskPack.targetTool === input.targetTool : true,
      );
    const returned = taskPacks.slice(offset, offset + limit).map((taskPack) => ({
      taskPackId: taskPack.id,
      project: {
        projectId: taskPack.projectId,
        name: taskPack.projectName ?? null,
      },
      title: taskPack.title,
      rawTaskSummary: truncateText(taskPack.rawTask, 280).value,
      taskType: taskPack.taskType,
      targetTool: taskPack.targetTool,
      generationMode: taskPack.generationMode,
      generationModel: taskPack.generationModel,
      generationUsedFallback: taskPack.generationUsedFallback,
      selectionReadinessSummary: extractRecipeSummary(taskPack.generationRecipe),
      createdAt: taskPack.createdAt,
      updatedAt: taskPack.updatedAt,
    }));

    return createMcpSuccess({
      operation: "contextforge_list_task_packs",
      projectId: input.projectId,
      data: {
        taskPacks: returned,
        returnedCount: returned.length,
        totalCount: taskPacks.length,
        truncated: offset + returned.length < taskPacks.length,
        nextOffset:
          offset + returned.length < taskPacks.length
            ? offset + returned.length
            : null,
      },
      warnings: [],
    });
  }

  async getTaskPack(input: {
    taskPackId: number;
    includeGeneratedPrompt?: boolean;
    includeDiagnostics?: boolean;
    maxPromptChars?: number;
  }) {
    const taskPack = await this.requireTaskPack(input.taskPackId);
    const maxPromptChars = Math.min(
      Math.max(input.maxPromptChars ?? 60_000, 1_000),
      MAX_TASK_PROMPT_CHARS,
    );
    const prompt = truncateText(taskPack.generatedPrompt, maxPromptChars);
    const rawTask = truncateText(taskPack.rawTask, MAX_RAW_TASK_CHARS);
    const recipe = sanitizeStoredValue(taskPack.generationRecipe) as
      | Record<string, unknown>
      | null;
    const recipeWithoutDiagnostics =
      recipe && input.includeDiagnostics === false
        ? Object.fromEntries(
            Object.entries(recipe).filter(
              ([key]) => !key.toLowerCase().includes("diagnostic"),
            ),
          )
        : recipe;

    return createMcpSuccess({
      operation: "contextforge_get_task_pack",
      projectId: taskPack.projectId,
      taskPackId: taskPack.id,
      data: {
        taskPack: {
          taskPackId: taskPack.id,
          project: {
            projectId: taskPack.projectId,
            name: taskPack.projectName ?? null,
          },
          title: taskPack.title,
          rawTask: sanitizeStoredValue(rawTask.value),
          taskType: taskPack.taskType,
          targetTool: taskPack.targetTool,
          ...(input.includeGeneratedPrompt === false
            ? {}
            : { generatedPrompt: sanitizeStoredValue(prompt.value) }),
          generation: {
            mode: taskPack.generationMode,
            model: taskPack.generationModel,
            message: sanitizeStoredValue(taskPack.generationMessage),
            usedFallback: taskPack.generationUsedFallback,
            durationMs: taskPack.generationDurationMs,
          },
          generationRecipe: recipeWithoutDiagnostics,
          selectedContextSummary: extractRecipeSummary(taskPack.generationRecipe),
          createdAt: taskPack.createdAt,
          updatedAt: taskPack.updatedAt,
        },
        truncation: {
          truncated:
            input.includeGeneratedPrompt !== false && prompt.truncated,
          returnedPromptChars:
            input.includeGeneratedPrompt === false ? 0 : prompt.value.length,
          originalPromptChars: prompt.originalChars,
          maxPromptChars,
          rawTaskTruncated: rawTask.truncated,
          returnedRawTaskChars: rawTask.value.length,
          originalRawTaskChars: rawTask.originalChars,
        },
      },
      warnings: [
        ...(prompt.truncated ? ["MCP_TASK_PACK_PROMPT_TRUNCATED"] : []),
        ...(rawTask.truncated ? ["MCP_TASK_PACK_RAW_TASK_TRUNCATED"] : []),
        ...taskPackSafetyWarnings(taskPack.generationRecipe),
      ],
    });
  }

  async explainTaskPack(input: { taskPackId: number }) {
    const taskPack = await this.requireTaskPack(input.taskPackId);
    const recipe = sanitizeStoredValue(taskPack.generationRecipe) as
      | Record<string, unknown>
      | null;

    return createMcpSuccess({
      operation: "contextforge_explain_task_pack",
      projectId: taskPack.projectId,
      taskPackId: taskPack.id,
      data: {
        taskPackId: taskPack.id,
        selection: extractRecipeSummary(taskPack.generationRecipe) ?? "unavailable",
        executionContract: recipe?.executionContract ?? "unavailable",
        template: recipe?.template ?? "unavailable",
        ruleProfile: recipe?.ruleProfile ?? "unavailable",
        enabledRules: recipe?.enabledRules ?? "unavailable",
        customRules: recipe?.customRules ?? "unavailable",
        acceptanceCriteria:
          recipe?.acceptanceCriteria ?? "unavailable",
        generationDiagnostics:
          recipe?.generationDiagnostics ?? "unavailable",
        usedProjectMemories: "unavailable",
        qualityStatus:
          (recipe?.selectorDiagnostics as { qualityStatus?: unknown } | undefined)
            ?.qualityStatus ?? "unavailable",
      },
      warnings: [
        ...(recipe
          ? []
          : ["This Task Pack predates stored generation recipe metadata."]),
        ...(recipe?.executionContract
          ? []
          : ["Execution contract metadata is unavailable for this Task Pack."]),
        "Project Memory usage was not persisted for this Task Pack.",
        ...taskPackSafetyWarnings(taskPack.generationRecipe),
      ],
    });
  }

  async createTaskPack(
    input: CreateTaskPackRequest & { confirmCreate: true },
  ) {
    if (!this.permissions.allowCreateTaskPacks) {
      throw new ContextForgeMcpError(
        "MCP_WRITE_DISABLED",
        "Task Pack creation is disabled. Enable it explicitly in ContextForge MCP settings or with CONTEXTFORGE_MCP_ALLOW_CREATE_TASK_PACKS=true.",
        { projectId: input.projectId },
      );
    }

    if (input.confirmCreate !== true) {
      throw new ContextForgeMcpError(
        "MCP_CONFIRMATION_REQUIRED",
        "confirmCreate=true is required for Task Pack creation.",
        { projectId: input.projectId },
      );
    }

    const result = await this.createTaskPackUsingPipeline(input);

    if (result.kind === "project_not_found") {
      throw new ContextForgeMcpError(
        "MCP_PROJECT_NOT_FOUND",
        `Project ${input.projectId} is not registered in ContextForge.`,
        { projectId: input.projectId },
      );
    }

    if (result.kind === "clarification_required") {
      throw new ContextForgeMcpError(
        "MCP_CLARIFICATION_REQUIRED",
        result.message,
        { projectId: input.projectId },
      );
    }

    if (result.kind === "blocked") {
      throw new ContextForgeMcpError(
        "MCP_CONTEXT_SELECTION_BLOCKED",
        result.message,
        { projectId: input.projectId },
      );
    }

    const taskPack = result.taskPack as TaskPackRecord;
    const prompt = truncateText(taskPack.generatedPrompt, 60_000);
    const rawTask = truncateText(taskPack.rawTask, MAX_RAW_TASK_CHARS);
    const safeTaskPack = sanitizeStoredValue(taskPack) as Record<string, unknown>;
    return createMcpSuccess({
      operation: "contextforge_create_task_pack",
      projectId: taskPack.projectId,
      taskPackId: taskPack.id,
      data: {
        taskPack: {
          ...safeTaskPack,
          rawTask: sanitizeStoredValue(rawTask.value),
          generatedPrompt: sanitizeStoredValue(prompt.value),
        },
        generationStatus: taskPack.generationUsedFallback
          ? "fallback"
          : "generated",
        selectionSummary: extractRecipeSummary(taskPack.generationRecipe),
        truncation: {
          promptTruncated: prompt.truncated,
          returnedPromptChars: prompt.value.length,
          originalPromptChars: prompt.originalChars,
          rawTaskTruncated: rawTask.truncated,
          returnedRawTaskChars: rawTask.value.length,
          originalRawTaskChars: rawTask.originalChars,
        },
      },
      warnings: [
        ...(taskPack.generationUsedFallback
          ? ["Task Pack generation used a validated fallback."]
          : []),
        ...(prompt.truncated ? ["MCP_TASK_PACK_PROMPT_TRUNCATED"] : []),
        ...(rawTask.truncated ? ["MCP_TASK_PACK_RAW_TASK_TRUNCATED"] : []),
        ...taskPackSafetyWarnings(taskPack.generationRecipe),
      ],
    });
  }

  private async requireProject(projectId: number) {
    const project = await this.storage.getProjectById(projectId);
    if (!project) {
      throw new ContextForgeMcpError(
        "MCP_PROJECT_NOT_FOUND",
        `Project ${projectId} is not registered in ContextForge.`,
        { projectId },
      );
    }
    return project;
  }

  private async requireTaskPack(taskPackId: number) {
    const taskPack = await this.storage.getTaskPackById(taskPackId);
    if (!taskPack) {
      throw new ContextForgeMcpError(
        "MCP_TASK_PACK_NOT_FOUND",
        `Task Pack ${taskPackId} does not exist.`,
        { taskPackId },
      );
    }
    return taskPack;
  }
}
