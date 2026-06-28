import fs from "node:fs/promises";
import path from "node:path";

import { pool } from "../db/pool.js";
import {
  analyzeTaskIntent,
  type TaskIntentAnalysis
} from "../ollama/taskIntentAnalyzer.js";
import {
  selectTaskFiles,
  type SelectedTaskFileUsage,
  type TaskFileSelection
} from "../ollama/taskFileSelector.js";
import {
  scanProjectInventory,
  type ProjectInventory,
  type ProjectInventoryFile,
  type ProjectInventoryFileKind
} from "../scanner/projectInventoryScanner.js";

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

export interface ComposerFileReference {
  path: string;
  kind: ProjectInventoryFileKind;
  usage: SelectedTaskFileUsage;
  reason: string;
  confidence: number;
  canReadText: boolean;
  sizeBytes: number;
}

export interface ComposerSnippet {
  relativePath: string;
  language: string;
  content: string;
  truncated: boolean;
}

export interface ContextComposerPreview {
  project: {
    id: number;
    name: string;
    localPath: string;
    packageManager: string | null;
    detectedStack: string[];
    readinessScore: number;
  };
  task: {
    rawTask: string;
    requestedTaskType: string;
    effectiveTaskArea: string;
    targetTool: string;
  };
  taskIntent: TaskIntentAnalysis;
  fileSelection: TaskFileSelection;
  selectedFiles: ComposerFileReference[];
  snippets: ComposerSnippet[];
  inventorySummary: {
    totalFiles: number;
    scannedFiles: number;
    truncated: boolean;
    notes: string[];
  };
  notes: string[];
}

const MAX_SNIPPET_FILES = 6;
const MAX_SNIPPET_CHARS = 1800;
const MAX_TEXT_FILE_SIZE_BYTES = 120_000;

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

function shouldReadSnippet(file: ProjectInventoryFile) {
  if (!file.canReadText) return false;
  if (file.kind === "asset") return false;
  if (file.kind === "runtime") return false;
  if (file.kind === "data") return false;
  if (file.sizeBytes > MAX_TEXT_FILE_SIZE_BYTES) return false;

  return true;
}

function getEffectiveTaskArea({
  taskType,
  taskIntent,
  fileSelection
}: {
  taskType: string;
  taskIntent: TaskIntentAnalysis;
  fileSelection: TaskFileSelection;
}) {
  if ("effectiveTaskArea" in fileSelection && fileSelection.effectiveTaskArea) {
    return fileSelection.effectiveTaskArea;
  }

  if (taskIntent.taskArea && taskIntent.taskArea !== "general") {
    return taskIntent.taskArea;
  }

  return taskType;
}

function buildFileReferences({
  inventory,
  fileSelection
}: {
  inventory: ProjectInventory;
  fileSelection: TaskFileSelection;
}): ComposerFileReference[] {
  const references: ComposerFileReference[] = [];

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

async function readFileSnippet(
  projectRoot: string,
  file: ProjectInventoryFile
): Promise<ComposerSnippet | null> {
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

async function buildSnippets({
  projectRoot,
  inventory,
  fileSelection
}: {
  projectRoot: string;
  inventory: ProjectInventory;
  fileSelection: TaskFileSelection;
}) {
  const snippets: ComposerSnippet[] = [];

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

function buildComposerNotes({
  inventory,
  taskIntent,
  fileSelection,
  selectedFiles,
  snippets
}: {
  inventory: ProjectInventory;
  taskIntent: TaskIntentAnalysis;
  fileSelection: TaskFileSelection;
  selectedFiles: ComposerFileReference[];
  snippets: ComposerSnippet[];
}) {
  const notes: string[] = [];

  notes.push("Project inventory was collected before selecting files.");
  notes.push("Selected files were validated against real inventory paths.");
  notes.push("Only safe text snippets were read into the preview.");

  notes.push(
    `Task intent source: ${taskIntent.source}; area: ${taskIntent.taskArea}; risk: ${taskIntent.riskLevel}; confidence: ${taskIntent.confidence}.`
  );

  notes.push(
    `File selection source: ${fileSelection.source}; selected files: ${selectedFiles.length}; snippets: ${snippets.length}.`
  );

  if (fileSelection.usedFallback) {
    notes.push("File selector used fallback logic.");
  }

  if (fileSelection.rejectedModelPaths.length > 0) {
    notes.push(
      `Rejected model-selected paths: ${fileSelection.rejectedModelPaths.join(", ")}.`
    );
  }

  if ("assetMode" in fileSelection) {
    notes.push(`Asset mode: ${fileSelection.assetMode}.`);
  }

  if ("conflictNote" in fileSelection && fileSelection.conflictNote) {
    notes.push(fileSelection.conflictNote);
  }

  if (inventory.truncated) {
    notes.push("Project inventory was truncated because of scanner limits.");
  }

  notes.push(...inventory.notes);
  notes.push(...fileSelection.notes);

  return Array.from(new Set(notes.filter(Boolean)));
}

async function getProjectById(projectId: number): Promise<ProjectRow | null> {
  const result = await pool.query(
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

  return result.rows[0] ?? null;
}

export async function buildContextComposerPreview(input: {
  projectId: number;
  rawTask: string;
  taskType: string;
  targetTool: string;
}): Promise<ContextComposerPreview> {
  const project = await getProjectById(input.projectId);

  if (!project) {
    throw new Error("Project not found");
  }

  const inventory = await scanProjectInventory(project.localPath);

  const taskIntent = await analyzeTaskIntent({
    rawTask: input.rawTask,
    taskType: input.taskType,
    targetTool: input.targetTool,
    project,
    projectTree: inventory.files.map((file) => file.path)
  });

  const fileSelection = await selectTaskFiles({
    rawTask: input.rawTask,
    taskType: input.taskType,
    targetTool: input.targetTool,
    inventory,
    taskIntent
  });

  const selectedFiles = buildFileReferences({
    inventory,
    fileSelection
  });

  const snippets = await buildSnippets({
    projectRoot: project.localPath,
    inventory,
    fileSelection
  });

  const effectiveTaskArea = getEffectiveTaskArea({
    taskType: input.taskType,
    taskIntent,
    fileSelection
  });

  return {
    project: {
      id: project.id,
      name: project.name,
      localPath: project.localPath,
      packageManager: project.packageManager,
      detectedStack: project.detectedStack,
      readinessScore: project.readinessScore
    },
    task: {
      rawTask: input.rawTask,
      requestedTaskType: input.taskType,
      effectiveTaskArea,
      targetTool: input.targetTool
    },
    taskIntent,
    fileSelection,
    selectedFiles,
    snippets,
    inventorySummary: {
      totalFiles: inventory.totalFiles,
      scannedFiles: inventory.scannedFiles,
      truncated: inventory.truncated,
      notes: inventory.notes
    },
    notes: buildComposerNotes({
      inventory,
      taskIntent,
      fileSelection,
      selectedFiles,
      snippets
    })
  };
}