import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import { z } from "zod";

import { storage } from "../storage/index.js";
import {
  appendSelectorDiagnostics,
  getAppSettings,
} from "../settings/settingsService.js";
import {
  buildTaskPackRulesTemplatePrompt,
  RulesServiceError,
} from "../rules/rulesService.js";
import {
  analyzeTaskIntent,
  type TaskIntentAnalysis,
} from "../ollama/taskIntentAnalyzer.js";
import {
  generateReliableTaskPack,
  type TaskPackGenerationDiagnostics,
} from "../ollama/taskPackGenerationReliability.js";
import {
  type TaskFileSelection,
  type SelectedTaskFileUsage,
} from "../ollama/taskFileSelector.js";
import {
  scanProjectInventory,
  type ProjectInventory,
  type ProjectInventoryFile,
  type ProjectInventoryFileKind,
} from "../scanner/projectInventoryScanner.js";
import {
  evaluateContextSelectionQuality,
  type ContextSelectionQuality,
} from "../selection/contextQuality.js";
import { isSecretLikePath } from "../selection/safetyPolicy.js";
import type { FileSelectionEvidence } from "../selection/repositorySemanticIndex.js";
import { buildExportSafeProjectMetadata } from "../taskPacks/taskPackPrivacy.js";
import { resolveTaskUnderstandingInteraction } from "../taskPacks/taskUnderstandingInteraction.js";
import { groundTaskCurrentState } from "../taskPacks/taskCurrentStateGrounding.js";
import { applyTaskUnderstandingReviewAcceptance } from "../ollama/taskUnderstanding.js";
import {
  applySelectionEvidenceGate,
  buildTaskExecutionContractFromIntent,
  type TaskExecutionContract,
} from "../taskPacks/taskExecutionContract.js";
import {
  applyTaskClarificationsToUnderstanding,
  buildClarifiedTaskText,
  buildSelectionTaskText,
  normalizeTaskClarifications,
  taskClarificationsSchema,
  type TaskClarification,
} from "../taskPacks/taskClarifications.js";
import type { ProjectMemoryRecord, ProjectRecord } from "../storage/types.js";
import type {
  GitHubCreatedIssueLink,
  GitHubIssueTaskPackSource,
} from "../github/githubTypes.js";
import { createGitHubIssueForProject } from "../github/githubIssuesService.js";
import {
  createExplicitTargetFastPathPipelineResult,
  finalizeSelectorDiagnostics,
  runSelectorPipeline,
  type SelectorPipelineDiagnostics,
} from "../selection/selectorPipelineOrchestrator.js";
import {
  createPerformanceSessionId,
  measurePerformanceStage,
  runWithPerformanceTrace,
  setPerformanceMetadata,
  recordPerformanceCacheEvent,
  type PerformanceSessionDiagnostics,
} from "../performance/performanceTrace.js";
import {
  applyExplicitTargetGuard,
  resolveExplicitTargetFastPath,
} from "../selection/explicitTargetGuard.js";
import {
  buildTaskUnderstandingAnalysisSignature,
  createTaskUnderstandingSnapshot,
  isTaskUnderstandingSnapshotReviewAccepted,
  resolveTaskUnderstandingSnapshot,
} from "../taskPacks/taskUnderstandingSnapshot.js";

export const taskPacksRouter = Router();

function buildStableTaskPackRefinementCacheIdentity(input: {
  projectId: number;
  project: {
    name: string;
    packageManager: string | null;
    detectedStack: string[];
    readinessScore: number;
    scripts: Record<string, string>;
  };
  rawTask: string;
  taskType: string;
  targetTool: string;
  effectiveTaskArea: string;
  relevantFiles: TaskContextFileReference[];
  fileSnippets: TaskContextSnippet[];
  projectMemories: ProjectMemoryRecord[];
  taskIntent: TaskIntentAnalysis;
  selectionQuality: ContextSelectionQuality;
  recipe: {
    templateId?: string;
    ruleProfileId?: string;
    enabledRuleIds?: string[];
    customRules?: string[];
    acceptanceCriteriaPresetId?: string;
    acceptanceCriteria?: string[];
  };
}) {
  const understanding = input.taskIntent.taskUnderstanding;
  const payload = {
    version: "task-pack-refinement-cache-v6",
    projectId: input.projectId,
    project: {
      ...input.project,
      detectedStack: [...input.project.detectedStack].sort(),
      scripts: Object.fromEntries(
        Object.entries(input.project.scripts).sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      ),
    },
    rawTask: input.rawTask.trim().replace(/\r\n/g, "\n"),
    taskType: input.taskType,
    targetTool: input.targetTool,
    effectiveTaskArea: input.effectiveTaskArea,
    relevantFiles: input.relevantFiles
      .map((file) => ({ path: file.path, usage: file.usage }))
      .sort((left, right) => left.path.localeCompare(right.path)),
    fileSnippets: input.fileSnippets
      .map((snippet) => ({
        path: snippet.relativePath,
        content: snippet.content,
        truncated: snippet.truncated,
      }))
      .sort((left, right) => left.path.localeCompare(right.path)),
    projectMemories: input.projectMemories
      .filter((memory) => memory.isEnabled)
      .map((memory) => ({
        title: memory.title,
        content: memory.content,
        category: memory.category,
      }))
      .sort((left, right) =>
        `${left.category}:${left.title}`.localeCompare(
          `${right.category}:${right.title}`,
        ),
      ),
    taskIntent: {
      taskArea: input.taskIntent.taskArea,
      riskLevel: input.taskIntent.riskLevel,
      structuredIntent: {
        primaryTargets: input.taskIntent.structuredIntent.primaryTargets.map(
          (target) => ({
            kind: target.kind,
            value: target.value,
            path: target.path ?? null,
            routePath: target.routePath ?? null,
          }),
        ),
        positiveActions: input.taskIntent.structuredIntent.positiveActions,
        protectedScopes: input.taskIntent.structuredIntent.protectedScopes,
        allowedEditScope: input.taskIntent.structuredIntent.allowedEditScope,
        needsStyles: input.taskIntent.structuredIntent.needsStyles,
        needsBackend: input.taskIntent.structuredIntent.needsBackend,
      },
      understanding: {
        goal: understanding.goal,
        action: understanding.action,
        targetHints: understanding.targetHints,
        requestedChanges: understanding.requestedChanges,
        constraints: understanding.constraints,
        interpretationRisk: understanding.interpretationRisk,
        changeDefinition: understanding.changeDefinition,
        explicitValues: understanding.explicitValues.map((value) => ({
          kind: value.kind,
          value: value.value,
          exact: value.exact,
        })),
        missingInformation: understanding.missingInformation.map((item) => ({
          code: item.code,
          description: item.description,
          required: item.required,
        })),
        readiness: understanding.readiness,
        canProceed: understanding.canProceed,
      },
    },
    selectionQuality: {
      status: input.selectionQuality.status,
      requiredManualReview: input.selectionQuality.requiredManualReview,
      blockingReasons: input.selectionQuality.blockingReasons,
    },
    recipe: {
      templateId: input.recipe.templateId ?? null,
      ruleProfileId: input.recipe.ruleProfileId ?? null,
      enabledRuleIds: [...(input.recipe.enabledRuleIds ?? [])].sort(),
      customRules: input.recipe.customRules ?? [],
      acceptanceCriteriaPresetId:
        input.recipe.acceptanceCriteriaPresetId ?? null,
      acceptanceCriteria: input.recipe.acceptanceCriteria ?? [],
    },
  };

  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

const githubIssueTaskPackSourceSchema = z.object({
  type: z.literal("github-issue"),
  owner: z.string().trim().min(1).max(120),
  repo: z.string().trim().min(1).max(120),
  fullName: z.string().trim().min(3).max(260),
  issueNumber: z.number().int().positive(),
  issueTitle: z.string().trim().min(1).max(260),
  issueUrl: z.string().url().max(700),
  issueState: z.enum(["open", "closed"]),
  labels: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
  authorLogin: z.string().trim().min(1).max(120).nullable().default(null),
  repositoryUrl: z.string().url().max(700),
  linkedAt: z.string().trim().min(1).max(80),
});

const createGitHubIssueFromTaskPackSchema = z.object({
  title: z.string().trim().min(3).max(256),
  body: z.string().trim().min(3).max(60000),
  labels: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
});

const understandTaskPackSchema = z.object({
  projectId: z.number().int().positive(),
  rawTask: z.string().trim().min(3).max(6000),
  taskType: z.string().trim().min(1).default("general"),
  targetTool: z.string().trim().min(1).default("generic"),
  clarifications: taskClarificationsSchema.optional(),
  performanceSessionId: z.string().trim().min(8).max(120).optional(),
  understandingSnapshotId: z.string().trim().uuid().optional(),
});

const createTaskPackSchema = z.object({
  projectId: z.number().int().positive(),
  rawTask: z.string().min(3),
  taskType: z.string().default("general"),
  targetTool: z.string().default("generic"),
  selectedFilePaths: z
    .array(z.string().trim().min(1).max(500))
    .max(48)
    .optional(),
  clarifications: taskClarificationsSchema.optional(),
  performanceSessionId: z.string().trim().min(8).max(120).optional(),
  understandingSnapshotId: z.string().trim().uuid().optional(),
  reviewedUnderstandingSnapshotId: z.string().trim().uuid().optional(),

  templateId: z.string().trim().min(1).max(180).optional(),
  ruleProfileId: z.string().trim().min(1).max(180).optional(),
  enabledRuleIds: z.array(z.string().trim().min(1).max(180)).max(80).optional(),
  customRules: z.array(z.string().trim().min(1).max(700)).max(20).optional(),
  acceptanceCriteriaPresetId: z.string().trim().min(1).max(180).optional(),
  acceptanceCriteria: z
    .array(z.string().trim().min(1).max(700))
    .max(30)
    .optional(),
  githubIssueSource: githubIssueTaskPackSourceSchema.optional(),
});

interface ProjectReadinessReport {
  issues: string[];
}

type ProjectRow = ProjectRecord;

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
  evidenceLevel?: string;
  selectionEvidence?: FileSelectionEvidence;
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
  selectionQuality: ContextSelectionQuality;
  executionContract: TaskExecutionContract;
  projectMemories: ProjectMemoryRecord[];
  inventorySummary: {
    totalFiles: number;
    scannedFiles: number;
    truncated: boolean;
    notes: string[];
  };
  notes: string[];
}

interface TaskPackGenerationRecipe {
  template: {
    id: string;
    name: string;
    targetTool: string;
    taskType: string;
    isBuiltin: boolean;
  } | null;
  ruleProfile: {
    id: string;
    name: string;
    taskType: string;
    isBuiltin: boolean;
  } | null;
  enabledRules: Array<{
    id: string;
    title: string;
    category: string;
  }>;
  customRules: string[];
  acceptanceCriteriaPreset: {
    id: string;
    name: string;
    taskType: string;
    isBuiltin: boolean;
  } | null;
  acceptanceCriteria: string[];
  counts: {
    enabledRules: number;
    customRules: number;
    acceptanceCriteria: number;
  };
  githubIssue?: GitHubIssueTaskPackSource;
  githubCreatedIssue?: GitHubCreatedIssueLink;
  taskClarifications?: TaskClarification[];
  selectorDiagnostics?: SelectorPipelineDiagnostics;
  generationDiagnostics?: TaskPackGenerationDiagnostics;
  performanceDiagnostics?: PerformanceSessionDiagnostics;
}

const MAX_SNIPPET_FILES = 5;
const MAX_SNIPPET_CHARS = 1600;
const MAX_TEXT_FILE_SIZE_BYTES = 120_000;

const PROTECTED_SECTION_TITLES = new Set([
  "Project Memory",
  "Relevant File Candidates",
  "Code Context Snippets",
  "Non-Text / Asset References",
  "ContextForge Assisted Notes",
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
  ".svg": "xml",
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
    (file) => normalizePath(file.path).toLowerCase() === normalized,
  );
}

function getUniqueStrings(values: string[]) {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  );
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

  return (
    isServerFolder ||
    isBackendRoleFolder ||
    isFrameworkApiRoute ||
    isBackendEntry
  );
}

function inventoryHasBackendRouteFiles(inventory: ProjectInventory) {
  return inventory.files.some((file) => isBackendRouteLikePath(file.path));
}

function normalizeTaskTypeSection(
  markdown: string,
  context: UniversalTaskPackContext,
) {
  const requestedTaskType =
    String(context.taskType || "general").trim() || "general";
  const taskTypeSectionPattern =
    /(## Task Type\s*\n+)([\s\S]*?)(\n+## Task\s*\n)/;

  if (!taskTypeSectionPattern.test(markdown)) {
    return markdown;
  }

  return markdown.replace(taskTypeSectionPattern, `$1${requestedTaskType}$3`);
}

function shouldReadSnippet(file: ProjectInventoryFile) {
  if (!file.canReadText) {
    return false;
  }

  if (isSecretLikePath(file.path)) {
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
  file: ProjectInventoryFile,
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
      truncated,
    };
  } catch {
    return null;
  }
}

async function buildSelectedFileSnippets({
  projectRoot,
  inventory,
  fileSelection,
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
  fileSelection,
}: {
  inventory: ProjectInventory;
  fileSelection: TaskFileSelection;
}): TaskContextFileReference[] {
  const references: TaskContextFileReference[] = [];

  for (const selectedFile of fileSelection.selectedFiles) {
    const inventoryFile = findInventoryFile(inventory, selectedFile.path);

    if (!inventoryFile) {
      if (selectedFile.usage !== "create-and-edit") {
        continue;
      }

      references.push({
        path: selectedFile.path,
        kind: selectedFile.kind,
        usage: selectedFile.usage,
        reason: selectedFile.reason,
        confidence: selectedFile.confidence,
        evidenceLevel: selectedFile.evidenceLevel,
        selectionEvidence: selectedFile.selectionEvidence,
        canReadText: false,
        sizeBytes: 0,
      });
      continue;
    }

    references.push({
      path: inventoryFile.path,
      kind: inventoryFile.kind,
      usage: selectedFile.usage,
      reason: selectedFile.reason,
      confidence: selectedFile.confidence,
      evidenceLevel: selectedFile.evidenceLevel,
      selectionEvidence: selectedFile.selectionEvidence,
      canReadText: inventoryFile.canReadText,
      sizeBytes: inventoryFile.sizeBytes,
    });
  }

  return references;
}

function getManualUsageForFile(
  file: ProjectInventoryFile,
  context?: {
    rawTask: string;
    effectiveTaskArea: string;
  },
): SelectedTaskFileUsage {
  if (
    context &&
    shouldUseInspectOnlyForComposerSelection({
      file,
      rawTask: context.rawTask,
      effectiveTaskArea: context.effectiveTaskArea,
    })
  ) {
    return "inspect-only";
  }

  if (file.kind === "asset") {
    return "asset-reference";
  }

  if (file.kind === "config") {
    return "config-reference";
  }

  if (file.kind === "docs" || file.kind === "data" || file.kind === "runtime") {
    return "inspect-only";
  }

  return "inspect-and-edit";
}

function normalizeComposerPath(path: string) {
  return path.replace(/\\/g, "/").toLowerCase();
}

function hasNoBackendMutationConstraint(task: string) {
  const normalized = task.toLowerCase();

  return [
    "do not change backend",
    "don't change backend",
    "without changing backend",
    "keep backend behavior",
    "backend behavior",
    "backend unchanged",
    "do not change api",
    "don't change api",
    "keep api",
    "api unchanged",
    "не менять backend",
    "не менять бэк",
    "не трогать бэк",
    "не менять api",
    "не трогать api",
    "без изменения backend",
    "без изменения бэка",
  ].some((phrase) => normalized.includes(phrase));
}

function isBackendOrApiReferencePath(path: string) {
  const normalized = normalizeComposerPath(path);

  return (
    normalized.includes("/server/") ||
    normalized.includes("/routes/") ||
    normalized.includes("/controllers/") ||
    normalized.includes("/services/") ||
    normalized.includes("/repositories/") ||
    normalized.includes("/db/") ||
    normalized.includes("/database/") ||
    normalized.includes("/api/") ||
    normalized.startsWith("server/") ||
    normalized.startsWith("api/") ||
    normalized.endsWith("/api.ts") ||
    normalized.endsWith("/api.js") ||
    normalized.endsWith("/client.ts") ||
    normalized.endsWith("/client.js")
  );
}

function shouldUseInspectOnlyForComposerSelection(input: {
  file: ProjectInventoryFile;
  rawTask: string;
  effectiveTaskArea: string;
}) {
  if (input.file.kind !== "source") {
    return false;
  }

  if (input.effectiveTaskArea !== "ui") {
    return false;
  }

  if (!hasNoBackendMutationConstraint(input.rawTask)) {
    return false;
  }

  return isBackendOrApiReferencePath(input.file.path);
}

function buildManualComposerFileSelection({
  inventory,
  baseSelection,
  selectedFilePaths,
  rawTask,
  effectiveTaskArea,
}: {
  inventory: ProjectInventory;
  baseSelection: TaskFileSelection;
  selectedFilePaths: string[];
  rawTask: string;
  effectiveTaskArea: string;
}): TaskFileSelection {
  const selectedByPath = new Map(
    baseSelection.selectedFiles.map((file) => [
      normalizePath(file.path).toLowerCase(),
      file,
    ]),
  );

  const rejectedManualPaths: string[] = [];
  const manualSelectedFiles: TaskFileSelection["selectedFiles"] = [];

  for (const candidatePath of getUniqueStrings(
    selectedFilePaths.map(normalizePath),
  )) {
    const inventoryFile = findInventoryFile(inventory, candidatePath);

    if (!inventoryFile) {
      rejectedManualPaths.push(candidatePath);
      continue;
    }

    const existingSelection = selectedByPath.get(
      normalizePath(inventoryFile.path).toLowerCase(),
    );

    const usage = getManualUsageForFile(inventoryFile, {
      rawTask,
      effectiveTaskArea,
    });

    if (existingSelection) {
      manualSelectedFiles.push({
        ...existingSelection,
        path: inventoryFile.path,
        usage,
        reason:
          usage === "inspect-only" && existingSelection.usage !== "inspect-only"
            ? `Manually confirmed in Context Composer as reference-only context. ${existingSelection.reason}`
            : `Manually confirmed in Context Composer. ${existingSelection.reason}`,
      });

      continue;
    }

    manualSelectedFiles.push({
      path: inventoryFile.path,
      kind: inventoryFile.kind,
      usage,
      reason:
        usage === "inspect-only"
          ? "Manually included from Context Composer review as reference-only context."
          : "Manually included from Context Composer review.",
      confidence: 0.95,
    });
  }

  if (manualSelectedFiles.length === 0) {
    return {
      ...baseSelection,
      selectedFiles: [],
      diagnostics: baseSelection.diagnostics
        ? { ...baseSelection.diagnostics, executionContract: undefined }
        : undefined,
      rejectedModelPaths: [
        ...baseSelection.rejectedModelPaths,
        ...rejectedManualPaths,
      ],
      notes: [
        ...baseSelection.notes,
        "Composer selection was requested, but no selected paths passed backend validation.",
      ],
    };
  }

  return {
    ...baseSelection,
    selectedFiles: manualSelectedFiles,
    diagnostics: baseSelection.diagnostics
      ? { ...baseSelection.diagnostics, executionContract: undefined }
      : undefined,
    rejectedModelPaths: [
      ...baseSelection.rejectedModelPaths,
      ...rejectedManualPaths,
    ],
    notes: [
      ...baseSelection.notes,
      `Composer confirmed selection applied: ${manualSelectedFiles.length} file(s).`,
      rejectedManualPaths.length > 0
        ? `Rejected manual Composer path(s): ${rejectedManualPaths.join(", ")}.`
        : "",
    ].filter(Boolean),
  };
}

function buildContextNotes({
  inventory,
  taskIntent,
  fileSelection,
  selectionQuality,
}: {
  inventory: ProjectInventory;
  taskIntent?: TaskIntentAnalysis;
  fileSelection: TaskFileSelection;
  selectionQuality: ContextSelectionQuality;
}) {
  const notes: string[] = [];
  const uniqueRejectedModelPaths = getUniqueStrings(
    fileSelection.rejectedModelPaths,
  );

  notes.push(
    "Project inventory was collected by ContextForge before selecting files.",
  );
  notes.push(
    "Files were selected from real inventory paths and validated before being added to this Task Pack.",
  );
  notes.push(
    "Protected context sections were generated by the backend and restored after local AI generation.",
  );

  if (taskIntent) {
    notes.push(
      `Task intent source: ${taskIntent.source}; area: ${taskIntent.taskArea}; confidence: ${taskIntent.confidence}.`,
    );

    if (taskIntent.structuredIntent) {
      notes.push(
        `Structured intent: ${taskIntent.structuredIntent.primaryTargets.length} primary target(s); edit scope ${taskIntent.structuredIntent.allowedEditScope}.`,
      );
    }

    if (taskIntent.taskUnderstanding) {
      notes.push(
        `Task understanding: ${taskIntent.taskUnderstanding.readiness}; action ${taskIntent.taskUnderstanding.action}; can proceed ${taskIntent.taskUnderstanding.canProceed ? "yes" : "no"}.`,
      );
    }
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
    `File selection source: ${fileSelection.source}; selection origin: ${fileSelection.diagnostics?.selectionSource ?? "unknown"}; selected files: ${fileSelection.selectedFiles.length}.`,
  );
  notes.push(
    `Context quality: ${selectionQuality.status}; score: ${selectionQuality.score}/100.`,
  );
  if (selectionQuality.blockingReasons.length > 0) {
    notes.push(
      `Context blocking reason(s): ${selectionQuality.blockingReasons.join("; ")}.`,
    );
  }
  if (selectionQuality.warnings.length > 0) {
    notes.push(`Context warning(s): ${selectionQuality.warnings.join("; ")}.`);
  }

  if (uniqueRejectedModelPaths.length > 0) {
    notes.push(
      `Rejected ${uniqueRejectedModelPaths.length} model-selected path(s) because they were not present in inventory or were blocked by safety rules.`,
    );
  }

  if (
    "effectiveTaskArea" in fileSelection &&
    fileSelection.effectiveTaskArea === "fullstack" &&
    !inventoryHasBackendRouteFiles(inventory)
  ) {
    notes.push(
      "No backend/server route files were found in the scanned project inventory. This appears to be a frontend-only or client-only project, so the Task Pack selected available UI/client API files and the external agent should document the expected backend endpoint contract instead of inventing server files.",
    );
  }

  if (inventory.truncated) {
    notes.push(
      "Project inventory was truncated, so some deep/extra files may be missing.",
    );
  }

  notes.push(...inventory.notes);
  notes.push(...fileSelection.notes);

  return Array.from(new Set(notes.filter(Boolean)));
}


function buildEffectiveExecutionContract({
  rawTask,
  inventory,
  taskIntent,
  fileSelection,
}: {
  rawTask: string;
  inventory: ProjectInventory;
  taskIntent?: TaskIntentAnalysis;
  fileSelection: TaskFileSelection;
}): TaskExecutionContract {
  const canonicalContract = fileSelection.diagnostics?.executionContract;
  if (canonicalContract) return canonicalContract;

  if (!taskIntent) {
    return {
      schemaVersion: 2,
      mode: "investigation",
      requiredLayers: [],
      confirmedTargets: [],
      targetEvidence: [],
      proposedTargets: [],
      unresolvedDecisions: [],
      forbiddenAssumptions: [
        "Do not infer implementation details without Task Understanding.",
      ],
      allowImplementationGuidance: false,
      requiresLayerCoverage: false,
      implementationGateReasons: [
        "Task execution contract was unavailable.",
      ],
      reasons: ["Task execution contract was unavailable."],
    };
  }

  const base = buildTaskExecutionContractFromIntent({
    rawTask,
    projectTree: inventory.files.map((file) => file.path),
    taskIntent,
    effectiveTaskArea: fileSelection.effectiveTaskArea,
  });

  return applySelectionEvidenceGate({
    contract: base,
    rawTask,
    selectedFiles: fileSelection.selectedFiles,
    missingRequiredLayers:
      fileSelection.diagnostics?.missingRequiredLayers ?? [],
    existingImplementationCandidates:
      fileSelection.diagnostics?.existingImplementationCandidates ?? [],
    existingImplementationRequiresReview:
      fileSelection.diagnostics?.existingImplementationRequiresReview ?? false,
  });
}

function buildUniversalTaskPackContext({
  rawTask,
  taskType,
  inventory,
  taskIntent,
  fileSelection,
  selectionQuality,
  fileSnippets,
  fileReferences,
  projectMemories,
}: {
  rawTask: string;
  taskType: string;
  inventory: ProjectInventory;
  taskIntent?: TaskIntentAnalysis;
  fileSelection: TaskFileSelection;
  selectionQuality: ContextSelectionQuality;
  fileSnippets: TaskContextSnippet[];
  fileReferences: TaskContextFileReference[];
  projectMemories: ProjectMemoryRecord[];
}): UniversalTaskPackContext {
  return {
    taskType,
    effectiveTaskArea:
      "effectiveTaskArea" in fileSelection
        ? fileSelection.effectiveTaskArea
        : (taskIntent?.taskArea ?? taskType),
    projectTree: inventory.files.map((file) => file.path),
    relevantFiles: fileSelection.selectedFiles.map((file) => file.path),
    fileSnippets,
    fileReferences,
    projectMemories,
    taskIntent,
    fileSelection,
    selectionQuality,
    executionContract: buildEffectiveExecutionContract({
      rawTask,
      inventory,
      taskIntent,
      fileSelection,
    }),
    inventorySummary: {
      totalFiles: inventory.totalFiles,
      scannedFiles: inventory.scannedFiles,
      truncated: inventory.truncated,
      notes: inventory.notes,
    },
    notes: buildContextNotes({
      inventory,
      taskIntent,
      fileSelection,
      selectionQuality,
    }),
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

function formatProjectMemoryCategory(
  category: ProjectMemoryRecord["category"],
) {
  switch (category) {
    case "architecture":
      return "Architecture";
    case "do_not_change":
      return "Do not change";
    case "style":
      return "Style";
    case "verification":
      return "Verification";
    case "workflow":
      return "Workflow";
    default:
      return "Custom";
  }
}

function buildProjectMemorySection(context: UniversalTaskPackContext) {
  const enabledMemories = context.projectMemories.filter(
    (memory) => memory.isEnabled,
  );

  if (enabledMemories.length === 0) {
    return "";
  }

  const rows = enabledMemories.map((memory) => {
    const contentLines = memory.content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const content =
      contentLines.length > 0
        ? contentLines.map((line) => `  - ${line}`).join("\n")
        : `  - ${memory.title}`;

    return [
      `- [${formatProjectMemoryCategory(memory.category)}] ${memory.title}`,
      content,
    ].join("\n");
  });

  return `
## Project Memory

Persistent decisions and rules saved for this project. Treat them as stable context unless the user explicitly overrides them.

${rows.join("\n")}
`.trim();
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
    const evidenceLabel = (() => {
      switch (file.evidenceLevel) {
        case "user_confirmed":
          return `user-confirmed target signal: ${confidence}%`;
        case "graph_supported":
          return `code-graph support signal: ${confidence}%`;
        case "inventory_exact":
          return `real inventory path signal: ${confidence}% (owner unconfirmed)`;
        case "model_proposed":
          return `model proposal: ${confidence}% (needs confirmation)`;
        case "ranked_candidate":
          return `candidate rank: ${confidence}% (needs confirmation)`;
        default:
          return /needs confirmation|candidate/i.test(file.reason)
            ? `candidate rank: ${confidence}% (needs confirmation)`
            : `selection signal: ${confidence}%`;
      }
    })();
    const selectionSignal = `  - evidence: ${evidenceLabel}`;
    const createNote =
      file.usage === "create-and-edit"
        ? "  - status: planned new file; it does not exist yet"
        : "";

    return [
      `- ${file.path}`,
      `  - kind: ${file.kind}`,
      `  - usage: ${file.usage}`,
      createNote,
      selectionSignal,
      `  - size: ${formatFileSize(file.sizeBytes)}`,
      `  - reason: ${file.reason}`,
    ]
      .filter(Boolean)
      .join("\n");
  });
  const hasCreateTargets = context.fileReferences.some(
    (file) => file.usage === "create-and-edit",
  );
  const intro = hasCreateTargets
    ? "Inspect existing reference files first. Files marked create-and-edit are planned new files that should be created as part of this task."
    : "Inspect these files before modifying code:";

  return `
## Relevant File Candidates

${intro}

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
      file.usage !== "create-and-edit" &&
      (file.kind === "asset" ||
        file.kind === "data" ||
        file.kind === "runtime" ||
        !file.canReadText),
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
      `  - note: binary/non-text content was not read into the prompt`,
    ].join("\n");
  });

  return `
## Non-Text / Asset References

These files may be relevant, but their binary or non-text content was not embedded.

${rows.join("\n")}
`.trim();
}

export function buildContextForgeNotesSection(context: UniversalTaskPackContext) {
  const rejectedModelPaths = getUniqueStrings(
    context.fileSelection.rejectedModelPaths,
  );
  const intent = context.taskIntent
    ? [
        `- Source: ${context.taskIntent.source}`,
        `- Task area: ${context.taskIntent.taskArea}`,
        `- Risk level: ${context.taskIntent.riskLevel}`,
        `- Intent confidence: ${context.taskIntent.confidence}`,
        context.taskIntent.intentTags.length > 0
          ? `- Intent tags: ${context.taskIntent.intentTags.join(", ")}`
          : null,
        context.taskIntent.domainTerms.length > 0
          ? `- Domain terms: ${context.taskIntent.domainTerms.join(", ")}`
          : null,
        context.taskIntent.fileRoleHints.length > 0
          ? `- File role hints: ${context.taskIntent.fileRoleHints.join(", ")}`
          : null,
        context.taskIntent.structuredIntent
          ? `- Structured targets: ${context.taskIntent.structuredIntent.primaryTargets.map((target) => `${target.kind}:${target.path ?? target.routePath ?? target.value} [${target.provenance ?? "model_proposed"}]`).join(", ") || "none"}`
          : null,
        context.taskIntent.structuredIntent
          ? `- Edit scope: ${context.taskIntent.structuredIntent.allowedEditScope}`
          : null,
        context.taskIntent.taskUnderstanding
          ? `- Understanding readiness: ${context.taskIntent.taskUnderstanding.readiness}`
          : null,
        context.taskIntent.taskUnderstanding
          ? `- Understanding action: ${context.taskIntent.taskUnderstanding.action}`
          : null,
        context.taskIntent.taskUnderstanding
          ? `- Understanding goal: ${context.taskIntent.taskUnderstanding.goal}`
          : null,
        context.taskIntent.taskUnderstanding
          ? `- Interpretation risk: ${context.taskIntent.taskUnderstanding.interpretationRisk}`
          : null,
        context.taskIntent.taskUnderstanding
          ? `- Change definition: ${context.taskIntent.taskUnderstanding.changeDefinition}`
          : null,
        context.taskIntent.taskUnderstanding?.ambiguities?.length
          ? `- Understanding ambiguities: ${context.taskIntent.taskUnderstanding.ambiguities.join("; ")}`
          : null,
        context.taskIntent.taskUnderstanding?.missingInformation.length
          ? `- Missing information: ${context.taskIntent.taskUnderstanding.missingInformation.map((item) => item.code).join(", ")}`
          : null,
      ]
        .filter(Boolean)
        .join("\n")
    : "- Task intent analysis was not available.";

  const executionContract = [
    `- Mode: ${context.executionContract.mode}`,
    `- Implementation guidance allowed: ${context.executionContract.allowImplementationGuidance ? "yes" : "no"}`,
    context.executionContract.requiredLayers.length > 0
      ? `- Required layers: ${context.executionContract.requiredLayers.join(", ")}`
      : "- Required layers: none",
    context.executionContract.confirmedTargets.length > 0
      ? `- Confirmed targets: ${context.executionContract.confirmedTargets.join(", ")}`
      : "- Confirmed targets: none",
    context.executionContract.proposedTargets.length > 0
      ? `- Proposed targets (not confirmed): ${context.executionContract.proposedTargets.join(", ")}`
      : "- Proposed targets: none",
    context.executionContract.targetEvidence.length > 0
      ? `- Target evidence: ${context.executionContract.targetEvidence.map((item) => `${item.path ?? item.target}=${item.evidenceLevel}`).join(", ")}`
      : "- Target evidence: none",
    context.executionContract.implementationGateReasons.length > 0
      ? `- Implementation gate reasons: ${context.executionContract.implementationGateReasons.join("; ")}`
      : "- Implementation gate reasons: none",
    context.executionContract.unresolvedDecisions.length > 0
      ? `- Unresolved decisions: ${context.executionContract.unresolvedDecisions.join("; ")}`
      : "- Unresolved decisions: none",
    context.fileSelection.diagnostics?.candidateLayerCoverage?.length
      ? `- Candidate layer coverage: ${context.fileSelection.diagnostics.candidateLayerCoverage.join(", ")}`
      : "- Candidate layer coverage: none",
    context.fileSelection.diagnostics?.confirmedLayerCoverage?.length
      ? `- Confirmed layer coverage: ${context.fileSelection.diagnostics.confirmedLayerCoverage.join(", ")}`
      : "- Confirmed layer coverage: none",
    context.fileSelection.diagnostics?.missingConfirmedLayers?.length
      ? `- Missing confirmed layers: ${context.fileSelection.diagnostics.missingConfirmedLayers.join(", ")}`
      : "- Missing confirmed layers: none",
    context.fileSelection.diagnostics?.missingRequiredLayers?.length
      ? `- Missing required layers (candidate-level): ${context.fileSelection.diagnostics.missingRequiredLayers.join(", ")}`
      : "- Missing required layers (candidate-level): none",
  ].join("\n");

  const quality = [
    `- Status: ${context.selectionQuality.status}`,
    `- Score: ${context.selectionQuality.score}/100`,
    context.selectionQuality.requiredManualReview
      ? "- Manual review required: yes"
      : "- Manual review required: no",
    context.selectionQuality.blockingReasons.length > 0
      ? `- Blocking reasons: ${context.selectionQuality.blockingReasons.join("; ")}`
      : "- Blocking reasons: none",
    context.selectionQuality.warnings.length > 0
      ? `- Warnings: ${context.selectionQuality.warnings.join("; ")}`
      : "- Warnings: none",
  ].join("\n");

  const fileSelection = [
    `- Source: ${context.fileSelection.source}`,
    `- Selection origin: ${context.fileSelection.diagnostics?.selectionSource ?? "unknown"}`,
    `- Used fallback: ${context.fileSelection.usedFallback ? "yes" : "no"}`,
    context.fileSelection.diagnostics?.explicitTargetStatus
      ? `- Explicit target guard: ${context.fileSelection.diagnostics.explicitTargetStatus}${context.fileSelection.diagnostics.explicitTargetPath ? ` (${context.fileSelection.diagnostics.explicitTargetPath})` : ""}`
      : null,
    `- Duration: ${context.fileSelection.durationMs} ms`,
    `- Effective task area: ${context.effectiveTaskArea}`,
    "assetMode" in context.fileSelection
      ? `- Asset mode: ${context.fileSelection.assetMode}`
      : null,
    "conflictNote" in context.fileSelection &&
    context.fileSelection.conflictNote
      ? `- Task type conflict: ${context.fileSelection.conflictNote}`
      : null,
    rejectedModelPaths.length > 0
      ? `- Rejected model paths: ${rejectedModelPaths.join(", ")}`
      : "- Rejected model paths: none",
    context.fileSelection.diagnostics?.evidenceSummary
      ? `- Evidence summary: ${Object.entries(context.fileSelection.diagnostics.evidenceSummary).map(([key, value]) => `${key}=${value}`).join(", ")}`
      : null,
    context.fileSelection.diagnostics?.existingImplementationCandidates?.length
      ? `- Existing implementation candidates: ${context.fileSelection.diagnostics.existingImplementationCandidates.join(", ")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const inventory = [
    `- Total files found: ${context.inventorySummary.totalFiles}`,
    `- Files kept in inventory: ${context.inventorySummary.scannedFiles}`,
    `- Truncated: ${context.inventorySummary.truncated ? "yes" : "no"}`,
  ].join("\n");

  const notes =
    context.notes.length > 0
      ? context.notes.map((note) => `- ${note}`).join("\n")
      : "- No additional notes.";
  const investigationTrace = context.fileSelection.diagnostics?.investigationTrace;
  const traceSection = investigationTrace?.triggered
    ? `
### Investigation Trace

- Trigger: ${investigationTrace.triggerReasons.join("; ")}
- Seeds: ${investigationTrace.seedPaths.length > 0 ? investigationTrace.seedPaths.join(", ") : "none"}
- Inspected files: ${investigationTrace.inspectedFileCount}; edges followed: ${investigationTrace.edges.length}; hops: ${investigationTrace.hopCount}; duration: ${investigationTrace.durationMs.toFixed(1)} ms; cache reused: ${investigationTrace.cacheReused ? "yes" : "no"}
- Confirmed owner candidates: ${investigationTrace.outcome.confirmedOwners.length > 0 ? investigationTrace.outcome.confirmedOwners.join(", ") : "none"}
- Probable owner candidates: ${investigationTrace.outcome.probableOwners.length > 0 ? investigationTrace.outcome.probableOwners.join(", ") : "none"}
- Reference/display candidates: ${investigationTrace.outcome.references.length > 0 ? investigationTrace.outcome.references.slice(0, 8).join(", ") : "none"}
- Unresolved trace points: ${investigationTrace.outcome.unresolved.length > 0 ? investigationTrace.outcome.unresolved.join("; ") : "none"}

${investigationTrace.nodes.slice(0, 10).map((node) =>
  `- ${node.path}: ${node.semanticRole}, ${node.ownershipStrength}; symbols=${node.inspectedSymbols.join(", ") || "none"}${node.rejectionReason ? `; reference-only because ${node.rejectionReason}` : ""}${node.omissionReason ? `; omitted because ${node.omissionReason}` : ""}`,
).join("\n")}

${investigationTrace.edges.slice(0, 10).map((edge) =>
  `- ${edge.type}: ${edge.from} -> ${edge.to}${edge.symbol ? ` (${edge.symbol})` : ""}`,
).join("\n")}
`.trim()
    : "";

  return `
## ContextForge Assisted Notes

### Task Intent Analysis

${intent}

### Execution Contract

${executionContract}

### AI File Selection

${fileSelection}

### Project Inventory

${inventory}

${traceSection}

### Notes

${notes}
`.trim();
}

function buildProtectedContextBlock(context: UniversalTaskPackContext) {
  return [
    buildProjectMemorySection(context),
    buildRelevantFilesSection(context),
    buildCodeSnippetsSection(context),
    buildAssetReferenceSection(context),
    buildContextForgeNotesSection(context),
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

  return output
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function insertBeforeSection(
  markdown: string,
  sectionTitle: string,
  content: string,
) {
  const marker = `\n${sectionTitle}`;

  if (!markdown.includes(marker)) {
    return `${markdown.trim()}\n\n---\n\n${content}`;
  }

  return markdown.replace(marker, `\n${content}\n\n---\n\n${sectionTitle}`);
}

function restoreProtectedSections(
  markdown: string,
  context: UniversalTaskPackContext,
) {
  const withoutProtectedSections = removeProtectedSections(markdown);
  const protectedBlock = buildProtectedContextBlock(context);

  return insertBeforeSection(
    withoutProtectedSections,
    "## Agent Instructions",
    protectedBlock,
  )
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function buildContextAwareTemplatePrompt(
  templatePrompt: string,
  context: UniversalTaskPackContext,
) {
  return normalizeTaskTypeSection(
    restoreProtectedSections(templatePrompt, context),
    context,
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeGitHubIssueLabels(labels: string[]) {
  return Array.from(
    new Set(labels.map((label) => label.trim()).filter(Boolean)),
  ).slice(0, 20);
}

async function getProjectById(projectId: number): Promise<ProjectRow | null> {
  return storage.getProjectById(projectId);
}

function buildGenerationRecipeMetadata(
  recipe: Awaited<
    ReturnType<typeof buildTaskPackRulesTemplatePrompt>
  >["recipe"],
  githubIssue?: GitHubIssueTaskPackSource,
  taskClarifications?: TaskClarification[],
): TaskPackGenerationRecipe {
  return {
    template: recipe.template
      ? {
          id: recipe.template.id,
          name: recipe.template.name,
          targetTool: recipe.template.targetTool,
          taskType: recipe.template.taskType,
          isBuiltin: recipe.template.isBuiltin,
        }
      : null,
    ruleProfile: recipe.profile
      ? {
          id: recipe.profile.id,
          name: recipe.profile.name,
          taskType: recipe.profile.taskType,
          isBuiltin: recipe.profile.isBuiltin,
        }
      : null,
    enabledRules: recipe.ruleItems.map((rule) => ({
      id: rule.id,
      title: rule.title,
      category: rule.category,
    })),
    customRules: recipe.customRules,
    acceptanceCriteriaPreset: recipe.acceptanceCriteriaPreset
      ? {
          id: recipe.acceptanceCriteriaPreset.id,
          name: recipe.acceptanceCriteriaPreset.name,
          taskType: recipe.acceptanceCriteriaPreset.taskType,
          isBuiltin: recipe.acceptanceCriteriaPreset.isBuiltin,
        }
      : null,
    acceptanceCriteria: recipe.acceptanceCriteria,
    counts: {
      enabledRules: recipe.ruleItems.length,
      customRules: recipe.customRules.length,
      acceptanceCriteria: recipe.acceptanceCriteria.length,
    },
    githubIssue,
    taskClarifications:
      taskClarifications && taskClarifications.length > 0
        ? taskClarifications
        : undefined,
  };
}

taskPacksRouter.get("/", async (_req, res) => {
  const taskPacks = await storage.listTaskPacks();

  res.json({
    ok: true,
    taskPacks,
  });
});

taskPacksRouter.post("/:id/github/issue", async (req, res) => {
  const taskPackId = Number(req.params.id);
  const parsed = createGitHubIssueFromTaskPackSchema.safeParse(req.body ?? {});

  if (!Number.isInteger(taskPackId) || taskPackId <= 0) {
    res.status(400).json({
      ok: false,
      message: "Invalid task pack id",
    });
    return;
  }

  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      message: "Invalid request body",
      issues: parsed.error.issues,
    });
    return;
  }

  try {
    const taskPack = await storage.getTaskPackById(taskPackId);

    if (!taskPack) {
      res.status(404).json({
        ok: false,
        message: "Task Pack not found",
      });
      return;
    }

    const project = await getProjectById(taskPack.projectId);

    if (!project) {
      res.status(404).json({
        ok: false,
        message: "Project not found",
      });
      return;
    }

    const existingRecipe = isPlainObject(taskPack.generationRecipe)
      ? taskPack.generationRecipe
      : {};

    const existingCreatedIssue = existingRecipe.githubCreatedIssue;

    if (isPlainObject(existingCreatedIssue)) {
      res.status(409).json({
        ok: false,
        message: "This Task Pack is already linked to a created GitHub issue.",
        githubCreatedIssue: existingCreatedIssue,
      });
      return;
    }

    const { repository, issue } = await createGitHubIssueForProject(project, {
      title: parsed.data.title,
      body: parsed.data.body,
      labels: normalizeGitHubIssueLabels(parsed.data.labels),
    });

    const githubCreatedIssue: GitHubCreatedIssueLink = {
      type: "github-created-issue",
      owner: repository.owner,
      repo: repository.repo,
      fullName: repository.fullName,
      issueNumber: issue.number,
      issueTitle: issue.title,
      issueUrl: issue.htmlUrl,
      issueState: issue.state,
      labels: issue.labels.map((label) => label.name),
      repositoryUrl: repository.htmlUrl,
      createdAt: new Date().toISOString(),
      createdFromTaskPackId: taskPack.id,
    };

    const nextRecipe = {
      ...existingRecipe,
      githubCreatedIssue,
    };

    const updatedTaskPack = await storage.updateTaskPackGenerationRecipe(
      taskPack.id,
      nextRecipe,
    );

    res.json({
      ok: true,
      repository,
      issue,
      githubCreatedIssue,
      taskPack: updatedTaskPack
        ? {
            ...updatedTaskPack,
            projectName: project.name,
          }
        : null,
    });
  } catch (error) {
    console.error("Failed to create GitHub issue from Task Pack:", error);

    const errorMessage = error instanceof Error ? error.message : String(error);

    res.status(500).json({
      ok: false,
      message: errorMessage,
      error: errorMessage,
    });
  }
});

taskPacksRouter.post("/understand", async (req, res) => {
  const parsed = understandTaskPackSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      message: "Invalid task understanding payload",
      issues: parsed.error.issues,
    });
    return;
  }

  try {
    const project = await getProjectById(parsed.data.projectId);
    if (!project) {
      res.status(404).json({ ok: false, message: "Project not found" });
      return;
    }

    const sessionId =
      parsed.data.performanceSessionId ?? createPerformanceSessionId();
    const traced = await runWithPerformanceTrace(
      {
        operation: "task_understanding_preflight",
        sessionId,
        metadata: {
          projectId: project.id,
          rawTaskChars: parsed.data.rawTask.length,
          clarificationCount: parsed.data.clarifications?.length ?? 0,
        },
      },
      async () => {
        const inventory = await measurePerformanceStage(
          "project_inventory",
          "Scan project inventory",
          () => scanProjectInventory(project.localPath),
        );
        setPerformanceMetadata({
          inventoryTotalFiles: inventory.totalFiles,
          inventoryScannedFiles: inventory.scannedFiles,
          inventoryTruncated: inventory.truncated,
        });

        const settings = await measurePerformanceStage(
          "settings_read",
          "Read app settings",
          () => getAppSettings(),
        );
        const analysisSignature =
          buildTaskUnderstandingAnalysisSignature(settings);
        const clarifications = await measurePerformanceStage(
          "clarification_grounding",
          "Normalize clarifications",
          () => normalizeTaskClarifications(parsed.data.clarifications),
        );
        const selectionTask = buildSelectionTaskText(
          parsed.data.rawTask,
          clarifications,
        );
        const snapshotResolution = await measurePerformanceStage(
          "task_understanding_snapshot",
          "Resolve reusable Task Understanding snapshot",
          () =>
            resolveTaskUnderstandingSnapshot({
              snapshotId: parsed.data.understandingSnapshotId,
              projectId: project.id,
              rawTask: parsed.data.rawTask,
              taskType: parsed.data.taskType,
              targetTool: parsed.data.targetTool,
              analysisSignature,
              clarifications,
              inventory,
              allowSafeClarificationAppend: true,
              allowCacheLookup: true,
            }),
        );

        let taskIntent: TaskIntentAnalysis;
        if (snapshotResolution.hit && snapshotResolution.snapshot) {
          recordPerformanceCacheEvent({
            layer: "task_understanding_snapshot",
            outcome: "hit",
          });
          const reusedIntent = snapshotResolution.snapshot.taskIntent;
          taskIntent = {
            ...reusedIntent,
            taskUnderstanding: applyTaskClarificationsToUnderstanding(
              reusedIntent.taskUnderstanding,
              clarifications,
            ),
          };
          setPerformanceMetadata({
            understandingReuse:
              snapshotResolution.appendedClarifications.length > 0
                ? "safe_clarification_append"
                : snapshotResolution.lookupSource === "cache"
                  ? "snapshot_cache"
                  : "snapshot",
            understandingSnapshotLookup: snapshotResolution.lookupSource,
          });
        } else {
          recordPerformanceCacheEvent({
            layer: "task_understanding_snapshot",
            outcome: "miss",
          });
          const analyzedTaskIntent = await measurePerformanceStage(
            "task_understanding",
            "Analyze task understanding",
            () =>
              analyzeTaskIntent({
                rawTask: selectionTask,
                taskType: parsed.data.taskType,
                targetTool: parsed.data.targetTool,
                project,
                projectTree: inventory.files.map((file) => file.path),
              }),
            { selectionTaskChars: selectionTask.length },
          );
          taskIntent = {
            ...analyzedTaskIntent,
            taskUnderstanding: applyTaskClarificationsToUnderstanding(
              analyzedTaskIntent.taskUnderstanding,
              clarifications,
            ),
          };
          setPerformanceMetadata({
            understandingReuse: "none",
            understandingSnapshotMissReason: snapshotResolution.reason,
          });
        }
        taskIntent = groundTaskCurrentState({
          rawTask: selectionTask,
          inventory,
          taskIntent,
        });

        const interaction = await measurePerformanceStage(
          "interaction_resolution",
          "Resolve clarification interaction",
          () =>
            resolveTaskUnderstandingInteraction(
              taskIntent.taskUnderstanding,
              settings.taskUnderstandingInteractionMode,
            ),
        );

        const understandingSnapshotId =
          snapshotResolution.hit &&
          snapshotResolution.snapshot &&
          snapshotResolution.appendedClarifications.length === 0
            ? snapshotResolution.snapshot.id
            : createTaskUnderstandingSnapshot({
                projectId: project.id,
                rawTask: parsed.data.rawTask,
                taskType: parsed.data.taskType,
                targetTool: parsed.data.targetTool,
                analysisSignature,
                clarifications,
                inventory,
                taskIntent,
              });

        const reusedExistingSnapshot =
          snapshotResolution.hit &&
          snapshotResolution.snapshot &&
          snapshotResolution.appendedClarifications.length === 0;
        setPerformanceMetadata({
          understandingReadiness: taskIntent.taskUnderstanding.readiness,
          understandingSource: taskIntent.source,
          interactionAction: interaction.action,
          understandingSnapshotCreated: !reusedExistingSnapshot,
          understandingSnapshotReused: Boolean(reusedExistingSnapshot),
        });

        return {
          understandingSnapshotId,
          understandingSnapshotReused: Boolean(reusedExistingSnapshot),
          taskUnderstanding: taskIntent.taskUnderstanding,
          interaction,
          taskIntent: {
            source: taskIntent.source,
            taskArea: taskIntent.taskArea,
            riskLevel: taskIntent.riskLevel,
            confidence: taskIntent.confidence,
            structuredIntent: taskIntent.structuredIntent,
          },
          clarifications,
          inventorySummary: {
            totalFiles: inventory.totalFiles,
            scannedFiles: inventory.scannedFiles,
            truncated: inventory.truncated,
          },
        };
      },
    );

    res.json({
      ok: true,
      ...traced.value,
      performanceDiagnostics: traced.sessionDiagnostics,
    });
  } catch (error) {
    console.error("Task understanding preflight failed:", error);
    const message =
      error instanceof Error
        ? error.message
        : "Task understanding preflight failed";
    res.status(500).json({
      ok: false,
      message,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

taskPacksRouter.post("/", async (req, res) => {
  const parsed = createTaskPackSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      message: "Invalid request body",
      issues: parsed.error.issues,
    });
    return;
  }

  try {
    const project = await getProjectById(parsed.data.projectId);

    if (!project) {
      res.status(404).json({
        ok: false,
        message: "Project not found",
      });
      return;
    }

    const sessionId =
      parsed.data.performanceSessionId ?? createPerformanceSessionId();
    const traced = await runWithPerformanceTrace(
      {
        operation: "task_pack_generation",
        sessionId,
        metadata: {
          projectId: project.id,
          rawTaskChars: parsed.data.rawTask.length,
          clarificationCount: parsed.data.clarifications?.length ?? 0,
          manualSelectionRequested: Array.isArray(
            parsed.data.selectedFilePaths,
          ),
        },
      },
      async () => {
        const inventory = await measurePerformanceStage(
          "project_inventory",
          "Scan project inventory",
          () => scanProjectInventory(project.localPath),
        );
        setPerformanceMetadata({
          inventoryTotalFiles: inventory.totalFiles,
          inventoryScannedFiles: inventory.scannedFiles,
          inventoryTruncated: inventory.truncated,
        });

        const settings = await measurePerformanceStage(
          "settings_read",
          "Read app settings",
          () => getAppSettings(),
        );
        const analysisSignature =
          buildTaskUnderstandingAnalysisSignature(settings);
        const projectMemories = await measurePerformanceStage(
          "project_memory_read",
          "Load project memory",
          () => storage.listProjectMemories(project.id),
        );
        const clarifications = await measurePerformanceStage(
          "clarification_grounding",
          "Normalize clarifications",
          () => normalizeTaskClarifications(parsed.data.clarifications),
        );
        const selectionTask = buildSelectionTaskText(
          parsed.data.rawTask,
          clarifications,
        );
        const effectiveTask = buildClarifiedTaskText(
          parsed.data.rawTask,
          clarifications,
        );

        const snapshotResolution = await measurePerformanceStage(
          "task_understanding_snapshot",
          "Resolve reusable Task Understanding snapshot",
          () =>
            resolveTaskUnderstandingSnapshot({
              snapshotId: parsed.data.understandingSnapshotId,
              projectId: project.id,
              rawTask: parsed.data.rawTask,
              taskType: parsed.data.taskType,
              targetTool: parsed.data.targetTool,
              analysisSignature,
              clarifications,
              inventory,
              allowCacheLookup: true,
            }),
        );

        let taskIntent: TaskIntentAnalysis;
        if (snapshotResolution.hit && snapshotResolution.snapshot) {
          recordPerformanceCacheEvent({
            layer: "task_understanding_snapshot",
            outcome: "hit",
          });
          const reusedIntent = snapshotResolution.snapshot.taskIntent;
          taskIntent = {
            ...reusedIntent,
            taskUnderstanding: applyTaskClarificationsToUnderstanding(
              reusedIntent.taskUnderstanding,
              clarifications,
            ),
          };
          setPerformanceMetadata({
            understandingReuse:
              snapshotResolution.lookupSource === "cache"
                ? "snapshot_cache"
                : "snapshot",
            understandingSnapshotLookup: snapshotResolution.lookupSource,
          });
        } else {
          recordPerformanceCacheEvent({
            layer: "task_understanding_snapshot",
            outcome: "miss",
          });
          const analyzedTaskIntent = await measurePerformanceStage(
            "task_understanding",
            "Analyze task understanding",
            () =>
              analyzeTaskIntent({
                rawTask: selectionTask,
                taskType: parsed.data.taskType,
                targetTool: parsed.data.targetTool,
                project,
                projectTree: inventory.files.map((file) => file.path),
              }),
            { selectionTaskChars: selectionTask.length },
          );
          taskIntent = {
            ...analyzedTaskIntent,
            taskUnderstanding: applyTaskClarificationsToUnderstanding(
              analyzedTaskIntent.taskUnderstanding,
              clarifications,
            ),
          };
          setPerformanceMetadata({
            understandingReuse: "none",
            understandingSnapshotMissReason: snapshotResolution.reason,
          });
        }

        taskIntent = groundTaskCurrentState({
          rawTask: selectionTask,
          inventory,
          taskIntent,
        });

        const reviewedSnapshotAccepted =
          isTaskUnderstandingSnapshotReviewAccepted(
            snapshotResolution,
            parsed.data.reviewedUnderstandingSnapshotId,
          );
        taskIntent = {
          ...taskIntent,
          taskUnderstanding: applyTaskUnderstandingReviewAcceptance(
            taskIntent.taskUnderstanding,
            reviewedSnapshotAccepted,
          ),
        };

        const manualSelectionRequested = Array.isArray(
          parsed.data.selectedFilePaths,
        );
        const selectorInput = {
          rawTask: selectionTask,
          taskType: parsed.data.taskType,
          targetTool: parsed.data.targetTool,
          inventory,
          taskIntent,
          settings,
          projectRef: String(project.id),
        };
        const explicitTargetFastPath = await measurePerformanceStage(
          "explicit_target_fast_path",
          "Check strict explicit-target fast path",
          () =>
            resolveExplicitTargetFastPath({
              rawTask: selectionTask,
              taskType: parsed.data.taskType,
              inventory,
              taskIntent,
              settings,
            }),
        );

        let selectorPipeline: Awaited<ReturnType<typeof runSelectorPipeline>>;
        let automaticFileSelection: TaskFileSelection;

        if (
          !manualSelectionRequested &&
          explicitTargetFastPath.status === "matched" &&
          explicitTargetFastPath.selection
        ) {
          taskIntent = explicitTargetFastPath.taskIntent;
          selectorPipeline = await measurePerformanceStage(
            "selector_pipeline",
            "Use explicit-target fast path",
            () =>
              createExplicitTargetFastPathPipelineResult(
                { ...selectorInput, taskIntent },
                explicitTargetFastPath.selection!,
              ),
          );
          automaticFileSelection = explicitTargetFastPath.selection;
          setPerformanceMetadata({
            selectorFastPath: "explicit_target",
            explicitTargetGuardStatus: "matched",
            explicitTargetGuardPath: explicitTargetFastPath.matchedPath,
          });
        } else {
          selectorPipeline = await measurePerformanceStage(
            "selector_pipeline",
            "Run selector pipeline",
            () => runSelectorPipeline(selectorInput),
          );
          const explicitTargetGuard = await measurePerformanceStage(
            "explicit_target_guard",
            "Ground explicit user target against project inventory",
            () =>
              applyExplicitTargetGuard({
                rawTask: selectionTask,
                inventory,
                taskIntent,
                selection: selectorPipeline.selection,
              }),
          );
          taskIntent = explicitTargetGuard.taskIntent;
          automaticFileSelection = explicitTargetGuard.selection;
          setPerformanceMetadata({
            selectorFastPath: explicitTargetFastPath.status,
            explicitTargetGuardStatus: explicitTargetGuard.status,
            explicitTargetGuardPath: explicitTargetGuard.matchedPath,
          });
        }

        const effectiveSelectionArea =
          "effectiveTaskArea" in automaticFileSelection
            ? automaticFileSelection.effectiveTaskArea
            : taskIntent.taskArea;

        const fileSelection = await measurePerformanceStage(
          "selection_resolution",
          "Resolve final file selection",
          () =>
            manualSelectionRequested
              ? buildManualComposerFileSelection({
                  inventory,
                  baseSelection: automaticFileSelection,
                  selectedFilePaths: parsed.data.selectedFilePaths ?? [],
                  rawTask: selectionTask,
                  effectiveTaskArea: effectiveSelectionArea,
                })
              : automaticFileSelection,
        );

        const fileReferences = buildFileReferences({
          inventory,
          fileSelection,
        });

        const selectionQuality = await measurePerformanceStage(
          "selection_quality",
          "Evaluate context quality",
          () =>
            evaluateContextSelectionQuality({
              rawTask: selectionTask,
              requestedTaskType: parsed.data.taskType,
              effectiveTaskArea: effectiveSelectionArea,
              inventory,
              fileSelection,
              manualSelectionConfirmed: manualSelectionRequested,
              contextQualityMode: settings.contextQualityMode,
              taskIntent,
            }),
        );
        const selectorDiagnostics = finalizeSelectorDiagnostics(
          selectorPipeline.diagnostics,
          selectionQuality,
          fileSelection,
          { manualSelectionApplied: manualSelectionRequested },
        );

        const executionContract = buildEffectiveExecutionContract({
          rawTask: selectionTask,
          inventory,
          taskIntent,
          fileSelection,
        });

        setPerformanceMetadata({
          understandingReadiness: taskIntent.taskUnderstanding.readiness,
          understandingSource: taskIntent.source,
          executionMode: executionContract.mode,
          selectedFileCount: fileReferences.length,
          selectionQuality: selectionQuality.status,
        });

        const requiredClarificationBlocksGeneration =
          executionContract.mode === "clarification_required";
        const shouldBlockAutomaticGeneration =
          requiredClarificationBlocksGeneration ||
          (settings.contextQualityMode !== "advisory" &&
            selectionQuality.status === "blocked" &&
            !manualSelectionRequested);

        if (shouldBlockAutomaticGeneration) {
          const selectionBlockedMessage = requiredClarificationBlocksGeneration
            ? taskIntent.taskUnderstanding.clarificationQuestion ??
              "ContextForge needs one required implementation decision before generating a Task Pack."
            : selectorDiagnostics.actual.outcome === "abstained"
              ? "ContextForge understood the task area but could not confirm a safe implementation target. Open Full Review, clarify the task, or choose files manually."
              : "ContextForge could not select safe/relevant files automatically. Review files in Context Composer and generate from the confirmed selection.";

          return {
            kind: "blocked" as const,
            message: selectionBlockedMessage,
            selectionQuality,
            selectorDiagnostics,
          };
        }

        const fileSnippets = await measurePerformanceStage(
          "context_snippets",
          "Read selected file snippets",
          () =>
            buildSelectedFileSnippets({
              projectRoot: project.localPath,
              inventory,
              fileSelection,
            }),
          { selectedFileCount: fileReferences.length },
        );

        const universalContext = await measurePerformanceStage(
          "context_assembly",
          "Assemble grounded project context",
          () =>
            buildUniversalTaskPackContext({
              rawTask: selectionTask,
              taskType: parsed.data.taskType,
              inventory,
              taskIntent,
              fileSelection,
              selectionQuality,
              fileSnippets,
              fileReferences,
              projectMemories: projectMemories.filter(
                (memory) => memory.isEnabled,
              ),
            }),
        );

        const projectForPrompt = {
          ...project,
          readinessReport: project.readinessReport ?? { issues: [] },
        };

        const effectiveTaskType = parsed.data.taskType;

        const taskPackTemplate = await measurePerformanceStage(
          "template_build",
          "Build rules and template prompt",
          () =>
            buildTaskPackRulesTemplatePrompt({
              project: projectForPrompt,
              rawTask: effectiveTask,
              taskType: parsed.data.taskType,
              targetTool: parsed.data.targetTool,
              templateId: parsed.data.templateId,
              ruleProfileId: parsed.data.ruleProfileId,
              enabledRuleIds: parsed.data.enabledRuleIds,
              customRules: parsed.data.customRules,
              acceptanceCriteriaPresetId:
                parsed.data.acceptanceCriteriaPresetId,
              acceptanceCriteria: parsed.data.acceptanceCriteria,
            }),
        );

        const templatePrompt = taskPackTemplate.prompt;

        const contextAwareTemplatePrompt = await measurePerformanceStage(
          "prompt_assembly",
          "Assemble final generation prompt",
          () =>
            buildContextAwareTemplatePrompt(templatePrompt, universalContext),
          {
            templateChars: templatePrompt.length,
          },
        );

        const refinementCacheIdentity =
          buildStableTaskPackRefinementCacheIdentity({
            projectId: project.id,
            project: {
              name: project.name,
              packageManager: project.packageManager,
              detectedStack: project.detectedStack,
              readinessScore: project.readinessScore,
              scripts: project.scripts,
            },
            rawTask: effectiveTask,
            taskType: parsed.data.taskType,
            targetTool: parsed.data.targetTool,
            effectiveTaskArea: universalContext.effectiveTaskArea,
            relevantFiles: universalContext.fileReferences,
            fileSnippets,
            projectMemories,
            taskIntent,
            selectionQuality,
            recipe: {
              templateId: parsed.data.templateId,
              ruleProfileId: parsed.data.ruleProfileId,
              enabledRuleIds: parsed.data.enabledRuleIds,
              customRules: parsed.data.customRules,
              acceptanceCriteriaPresetId:
                parsed.data.acceptanceCriteriaPresetId,
              acceptanceCriteria: parsed.data.acceptanceCriteria,
            },
          });

        const generation = await measurePerformanceStage(
          "task_pack_refinement",
          "Generate validated Task Pack refinement",
          () =>
            generateReliableTaskPack({
              fallbackContent: contextAwareTemplatePrompt,
              cacheIdentity: refinementCacheIdentity,
              project: {
                name: project.name,
                packageManager: project.packageManager,
                detectedStack: project.detectedStack,
                readinessScore: project.readinessScore,
                scripts: project.scripts,
              },
              rawTask: effectiveTask,
              taskType: parsed.data.taskType,
              targetTool: parsed.data.targetTool,
              effectiveTaskArea: universalContext.effectiveTaskArea,
              relevantFiles: universalContext.fileReferences.map((file) => ({
                path: file.path,
                usage: file.usage,
                reason: file.reason,
                evidenceLevel: file.evidenceLevel,
                selectionEvidence: file.selectionEvidence,
              })),
              taskIntent: universalContext.taskIntent,
              selectionQuality: universalContext.selectionQuality,
              executionContract: universalContext.executionContract,
              templatePrompt: contextAwareTemplatePrompt,
            }),
          { finalPromptChars: contextAwareTemplatePrompt.length },
        );

        const generationRecipe: TaskPackGenerationRecipe = {
          ...buildGenerationRecipeMetadata(
            taskPackTemplate.recipe,
            parsed.data.githubIssueSource,
            clarifications,
          ),
          selectorDiagnostics,
          generationDiagnostics: generation.diagnostics,
        };

        const generatedPrompt = generation.content;

        const title = parsed.data.githubIssueSource
          ? createTitle(
              `Issue #${parsed.data.githubIssueSource.issueNumber}: ${parsed.data.githubIssueSource.issueTitle}`,
            )
          : createTitle(parsed.data.rawTask);

        const taskPack = await measurePerformanceStage(
          "task_pack_storage",
          "Store generated Task Pack",
          () =>
            storage.createTaskPack({
              projectId: project.id,
              title,
              rawTask: parsed.data.rawTask,
              taskType: effectiveTaskType,
              targetTool: parsed.data.targetTool,
              generatedPrompt,
              generationMode: generation.mode,
              generationModel: generation.model,
              generationMessage: generation.message,
              generationUsedFallback: generation.usedFallback,
              generationDurationMs: generation.durationMs,
              generationRecipe,
            }),
        );

        await measurePerformanceStage(
          "selector_history",
          "Persist selector diagnostics",
          async () => {
            try {
              await appendSelectorDiagnostics(selectorDiagnostics);
            } catch (error) {
              console.warn(
                "Failed to persist selector diagnostics history:",
                error,
              );
            }
          },
        );

        return {
          kind: "created" as const,
          taskPack,
          generationRecipe,
        };
      },
    );

    if (traced.value.kind === "blocked") {
      res.status(422).json({
        ok: false,
        code: "CONTEXT_SELECTION_BLOCKED",
        message: traced.value.message,
        selectionQuality: traced.value.selectionQuality,
        selectorDiagnostics: traced.value.selectorDiagnostics,
        performanceDiagnostics: traced.sessionDiagnostics,
      });
      return;
    }

    const finalGenerationRecipe: TaskPackGenerationRecipe = {
      ...traced.value.generationRecipe,
      performanceDiagnostics: traced.sessionDiagnostics,
    };
    const updatedTaskPack = await storage.updateTaskPackGenerationRecipe(
      traced.value.taskPack.id,
      finalGenerationRecipe,
    );
    const taskPack = updatedTaskPack ?? traced.value.taskPack;

    res.json({
      ok: true,
      taskPack: {
        ...taskPack,
        generationRecipe: finalGenerationRecipe,
        projectName: project.name,
      },
    });
  } catch (error) {
    console.error("Failed to create task pack:", error);

    if (error instanceof RulesServiceError) {
      res.status(error.statusCode).json({
        ok: false,
        message: error.message,
      });
      return;
    }

    res.status(500).json({
      ok: false,
      message: "Failed to create task pack",
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
