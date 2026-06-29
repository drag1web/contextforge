import fs from "node:fs/promises";
import path from "node:path";

import { storage } from "../storage/index.js";
import { getAppSettings } from "../settings/settingsService.js";
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
import {
  evaluateContextSelectionQuality,
  type ContextSelectionQuality
} from "../selection/contextQuality.js";

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
  selectionQuality: ContextSelectionQuality;
  selectedFiles: ComposerFileReference[];
  suggestedFileGroups: ContextComposerSuggestedFileGroup[];
  clarifyingQuestions: string[];
  snippets: ComposerSnippet[];
  inventorySummary: {
    totalFiles: number;
    scannedFiles: number;
    truncated: boolean;
    notes: string[];
  };
  notes: string[];
}

export interface ContextComposerFileSearchResult extends ComposerFileReference {
  score: number;
  alreadySelected: boolean;
}

export interface ContextComposerFileSearchResponse {
  project: {
    id: number;
    name: string;
    localPath: string;
  };
  query: string;
  results: ContextComposerFileSearchResult[];
}

export interface ContextComposerSuggestedFileGroup {
  id: string;
  title: string;
  caption: string;
  files: ComposerFileReference[];
}

export interface ContextComposerFileSnippetResponse {
  file: ComposerFileReference;
  snippet: ComposerSnippet | null;
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
  selectionQuality,
  selectedFiles,
  suggestedFileGroups,
  clarifyingQuestions,
  snippets
}: {
  inventory: ProjectInventory;
  taskIntent: TaskIntentAnalysis;
  fileSelection: TaskFileSelection;
  selectionQuality: ContextSelectionQuality;
  selectedFiles: ComposerFileReference[];
  suggestedFileGroups: ContextComposerSuggestedFileGroup[];
  clarifyingQuestions: string[];
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

  if (suggestedFileGroups.length > 0) {
    notes.push(`Suggested file groups: ${suggestedFileGroups.map((group) => `${group.title} (${group.files.length})`).join("; ")}.`);
  }

  if (clarifyingQuestions.length > 0) {
    notes.push(`Clarifying question(s): ${clarifyingQuestions.join("; ")}.`);
  }

  notes.push(`Context quality: ${selectionQuality.status}; score: ${selectionQuality.score}/100.`);

  if (selectionQuality.blockingReasons.length > 0) {
    notes.push(`Context blocking reason(s): ${selectionQuality.blockingReasons.join("; ")}.`);
  }

  if (selectionQuality.warnings.length > 0) {
    notes.push(`Context warning(s): ${selectionQuality.warnings.join("; ")}.`);
  }

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
  return storage.getProjectById(projectId);
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
  const settings = await getAppSettings();

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

  const effectiveTaskArea = getEffectiveTaskArea({
    taskType: input.taskType,
    taskIntent,
    fileSelection
  });

  const selectionQuality = evaluateContextSelectionQuality({
    rawTask: input.rawTask,
    requestedTaskType: input.taskType,
    effectiveTaskArea,
    inventory,
    fileSelection,
    manualSelectionConfirmed: false,
    contextQualityMode: settings.contextQualityMode
  });

  const suggestedFileGroups = buildSuggestedFileGroups({
    inventory,
    rawTask: input.rawTask,
    taskIntent,
    effectiveTaskArea,
    selectedFiles
  });

  const clarifyingQuestions = buildClarifyingQuestions({
    rawTask: input.rawTask,
    effectiveTaskArea,
    selectionQuality,
    suggestedFileGroups
  });

  const snippets = await buildSnippets({
    projectRoot: project.localPath,
    inventory,
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
    selectionQuality,
    selectedFiles,
    suggestedFileGroups,
    clarifyingQuestions,
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
      selectionQuality,
      selectedFiles,
      suggestedFileGroups,
      clarifyingQuestions,
      snippets
    })
  };
}

function getUniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function normalizeForSearch(value: string) {
  return normalizePath(value)
    .toLowerCase()
    .replace(/[_\-./\\]+/g, " ");
}

function getSearchTokens(query: string) {
  return normalizeForSearch(query)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .slice(0, 12);
}

function getComposerUsageForFile(file: ProjectInventoryFile): SelectedTaskFileUsage {
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


const COMPOSER_STOP_WORDS = new Set([
  "the", "and", "for", "from", "this", "that", "with", "without", "make", "change", "fix", "add", "update", "remove",
  "page", "file", "files", "component", "components", "project", "app", "src", "need", "needs", "should",
  "нужно", "надо", "мне", "сделать", "сделай", "изменить", "измени", "добавить", "добавь", "исправить", "исправь",
  "чтобы", "это", "как", "что", "там", "для", "при", "или", "если", "странице", "страница", "файл", "файлы", "проект", "программа", "программе"
]);

function splitMeaningfulTokens(value: string) {
  return normalizePath(value)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-zа-яё0-9_.\/-]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && token.length <= 32)
    .filter((token) => !COMPOSER_STOP_WORDS.has(token))
    .filter((token) => !/^\d+$/.test(token));
}

function addComposerSemanticTokens(target: Set<string>, sourceTokens: Set<string>) {
  const text = Array.from(sourceTokens).join(" ");
  const add = (...tokens: string[]) => tokens.forEach((token) => target.add(token));

  // Universal technical/UI meanings only. Business terms come from the task/inventory itself.
  if (/таблиц|table/.test(text)) add("table", "row", "rows", "grid");
  if (/спис|list/.test(text)) add("list", "item", "items", "row", "rows");
  if (/каталог|catalog/.test(text)) add("catalog", "catalogue", "list", "grid");
  if (/карточ|card/.test(text)) add("card", "cards", "item");
  if (/форм|form|input/.test(text)) add("form", "input", "field");
  if (/кноп|button|action/.test(text)) add("button", "buttons", "action", "actions");
  if (/api|апи|endpoint|route|service|интегр|подключ/.test(text)) add("api", "client", "service", "services", "route", "routes");
  if (/страниц|page|screen|экран/.test(text)) add("page", "screen", "view");
  if (/стил|дизайн|style|visual|css/.test(text)) add("style", "styles", "css");
}

function getTaskMeaningTokens({
  rawTask,
  taskIntent
}: {
  rawTask: string;
  taskIntent: TaskIntentAnalysis;
}) {
  const tokens = new Set<string>();

  for (const token of splitMeaningfulTokens([
    rawTask,
    taskIntent.taskArea,
    ...(taskIntent.intentTags ?? []),
    ...(taskIntent.domainTerms ?? []),
    ...(taskIntent.mentionedEntities ?? []),
    ...(taskIntent.fileRoleHints ?? []),
    ...(taskIntent.recommendedSearchTerms ?? [])
  ].join(" "))) {
    tokens.add(token);
  }

  addComposerSemanticTokens(tokens, tokens);

  return Array.from(tokens).slice(0, 40);
}

function getInventorySearchText(file: ProjectInventoryFile) {
  return normalizeForSearch([
    file.path,
    file.name,
    file.kind,
    file.role,
    file.routePath ?? "",
    ...(file.imports ?? []),
    ...(file.exports ?? []),
    ...(file.symbols ?? []),
    ...(file.textHints ?? []),
    file.contentPreview ?? ""
  ].join(" "));
}

function isGenericComposerShell(file: ProjectInventoryFile) {
  const normalized = normalizePath(file.path).toLowerCase();
  const name = normalized.split("/").pop() ?? normalized;

  return (
    file.kind === "docs" ||
    file.kind === "config" ||
    name === "layout.tsx" ||
    name === "layout.jsx" ||
    name === "layout.ts" ||
    name === "layout.js" ||
    name === "globals.css" ||
    name === "index.css" ||
    name === "app.css" ||
    name === "main.tsx" ||
    name === "main.jsx" ||
    name === "index.tsx" ||
    name === "index.jsx" ||
    name === "app.tsx" ||
    name === "app.jsx"
  );
}

function areaRoleWeight(file: ProjectInventoryFile, effectiveTaskArea: string) {
  if (effectiveTaskArea === "docs") {
    if (file.kind === "docs") return 38;
    if (file.kind === "config") return 28;
    return -8;
  }

  if (effectiveTaskArea === "backend") {
    if (["api-route", "client-api", "service", "repository", "db-schema", "server-entry"].includes(file.role)) return 44;
    if (file.kind === "source") return 18;
    if (file.kind === "config") return 8;
    return -12;
  }

  if (effectiveTaskArea === "fullstack") {
    if (["api-route", "client-api", "service"].includes(file.role)) return 34;
    if (["page", "component", "ui-component", "app-entry"].includes(file.role)) return 30;
    if (file.kind === "style") return 12;
    return file.kind === "source" ? 16 : -10;
  }

  if (effectiveTaskArea === "ui") {
    if (["page", "component", "ui-component"].includes(file.role)) return 44;
    if (file.kind === "style") return 28;
    if (file.role === "layout" || file.role === "app-entry") return 12;
    if (file.kind === "source") return 20;
    return -14;
  }

  if (effectiveTaskArea === "build") {
    if (file.kind === "config") return 42;
    if (file.kind === "source") return 12;
    return -8;
  }

  if (file.kind === "source") return 24;
  if (file.kind === "style") return 14;
  if (file.kind === "docs" || file.kind === "config") return 8;
  return 0;
}

function scoreInventoryFileAgainstTask(file: ProjectInventoryFile, taskTokens: string[], effectiveTaskArea: string) {
  const normalizedPath = normalizePath(file.path).toLowerCase();
  const pathSegments = splitMeaningfulTokens(file.path);
  const text = getInventorySearchText(file);
  let score = areaRoleWeight(file, effectiveTaskArea);

  if (file.isLikelyGenerated || file.kind === "runtime" || isNoisySearchPath(file.path)) score -= 100;
  if (file.canReadText) score += 5;
  if (file.routePath) score += 8;
  if (file.symbols.length > 0) score += 6;
  if (file.textHints.length > 0) score += 10;
  if (isGenericComposerShell(file)) score -= effectiveTaskArea === "docs" || effectiveTaskArea === "build" ? 0 : 26;

  for (const token of taskTokens) {
    if (pathSegments.includes(token)) score += 52;
    else if (normalizedPath.includes(token)) score += 38;
    else if ((file.textHints ?? []).some((hint) => normalizePath(hint).toLowerCase() === token)) score += 34;
    else if ((file.symbols ?? []).some((symbol) => normalizePath(symbol).toLowerCase().includes(token))) score += 26;
    else if (text.includes(token)) score += 13;
  }

  return score;
}

function toComposerFileReference(file: ProjectInventoryFile, reason: string, confidence: number): ComposerFileReference {
  return {
    path: file.path,
    kind: file.kind,
    usage: getComposerUsageForFile(file),
    reason,
    confidence,
    canReadText: file.canReadText,
    sizeBytes: file.sizeBytes
  };
}

function buildSuggestedFileGroups({
  inventory,
  rawTask,
  taskIntent,
  effectiveTaskArea,
  selectedFiles
}: {
  inventory: ProjectInventory;
  rawTask: string;
  taskIntent: TaskIntentAnalysis;
  effectiveTaskArea: string;
  selectedFiles: ComposerFileReference[];
}): ContextComposerSuggestedFileGroup[] {
  const selectedPathSet = new Set(selectedFiles.map((file) => normalizePath(file.path).toLowerCase()));
  const taskTokens = getTaskMeaningTokens({ rawTask, taskIntent });
  const scored = inventory.files
    .filter((file) => file.kind !== "asset" && file.kind !== "runtime" && file.kind !== "data")
    .map((file) => ({ file, score: scoreInventoryFileAgainstTask(file, taskTokens, effectiveTaskArea) }))
    .filter((item) => item.score > 30)
    .sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path));

  const makeGroupFiles = (items: Array<{ file: ProjectInventoryFile; score: number }>, reason: string, limit: number) => {
    const seen = new Set<string>();
    return items
      .filter((item) => {
        const key = normalizePath(item.file.path).toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, limit)
      .map((item) => toComposerFileReference(
        item.file,
        selectedPathSet.has(normalizePath(item.file.path).toLowerCase())
          ? `${reason} Also selected by the automatic selector.`
          : reason,
        Math.max(0.45, Math.min(0.96, item.score / 130))
      ));
  };

  const targetItems = scored.filter(({ file }) => {
    if (effectiveTaskArea === "backend") return ["api-route", "client-api", "service", "repository", "db-schema", "server-entry"].includes(file.role);
    if (effectiveTaskArea === "docs") return file.kind === "docs" || file.kind === "config";
    if (effectiveTaskArea === "build") return file.kind === "config" || file.role === "app-entry" || file.role === "layout";
    if (effectiveTaskArea === "fullstack") return ["page", "component", "ui-component", "client-api", "api-route", "service"].includes(file.role);
    return ["page", "component", "ui-component"].includes(file.role) || file.kind === "style";
  });

  const relatedItems = scored.filter(({ file }) => !targetItems.some((item) => item.file.path === file.path));
  const referenceItems = scored.filter(({ file }) => file.kind === "docs" || file.kind === "config" || file.role === "layout" || file.role === "app-entry");

  const groups: ContextComposerSuggestedFileGroup[] = [];
  const likelyFiles = makeGroupFiles(targetItems.length > 0 ? targetItems : scored, "Suggested by task-aware inventory ranking using real file paths, roles, symbols, text hints, and content preview.", 8);

  if (likelyFiles.length > 0) {
    groups.push({
      id: "likely-targets",
      title: "Likely target files",
      caption: "Most likely files to inspect/edit for this task. Review and include the right ones.",
      files: likelyFiles
    });
  }

  const relatedFiles = makeGroupFiles(relatedItems, "Related project file suggested as supporting context by task-aware inventory ranking.", 6);
  if (relatedFiles.length > 0) {
    groups.push({
      id: "related-context",
      title: "Related context",
      caption: "Useful supporting files. Include only if they explain data flow, styles, or wiring.",
      files: relatedFiles
    });
  }

  const referenceFiles = makeGroupFiles(referenceItems, "Reference-only file that may explain setup, routing, app shell, or commands.", 4).map((file) => ({
    ...file,
    usage: file.kind === "config" ? "config-reference" as SelectedTaskFileUsage : "inspect-only" as SelectedTaskFileUsage
  }));
  if (referenceFiles.length > 0) {
    groups.push({
      id: "reference-files",
      title: "Reference files",
      caption: "Usually inspect-only. Do not include unless the task needs setup, routing, or shell context.",
      files: referenceFiles
    });
  }

  return groups;
}

function buildClarifyingQuestions({
  rawTask,
  effectiveTaskArea,
  selectionQuality,
  suggestedFileGroups
}: {
  rawTask: string;
  effectiveTaskArea: string;
  selectionQuality: ContextSelectionQuality;
  suggestedFileGroups: ContextComposerSuggestedFileGroup[];
}) {
  if (selectionQuality.status === "ready") return [];

  const questions: string[] = [];
  const topFiles = suggestedFileGroups[0]?.files.slice(0, 4).map((file) => file.path) ?? [];

  if (topFiles.length > 0) {
    questions.push(`Which of these looks like the real target file: ${topFiles.join(" | ")}?`);
  } else {
    questions.push("Which page, component, route, service, or config file is the real target for this task?");
  }

  if (effectiveTaskArea === "ui" || effectiveTaskArea === "fullstack") {
    questions.push("Should the coding agent edit only the page/component, or also related styles/layout files?");
  }

  if (effectiveTaskArea === "backend" || effectiveTaskArea === "fullstack") {
    questions.push("Is backend/API behavior allowed to change, or should the task stay client-side only?");
  }

  if (/readme|docs?|документ|документац|ридми/i.test(rawTask) && effectiveTaskArea !== "docs") {
    questions.push("Is README/documentation a secondary deliverable after the code change, or the main task?");
  }

  return questions.slice(0, 4);
}

function getBaseSearchScore(file: ProjectInventoryFile) {
  if (file.kind === "source") return 42;
  if (file.kind === "style") return 36;
  if (file.kind === "config") return 28;
  if (file.kind === "docs") return 22;
  if (file.kind === "asset") return 14;
  if (file.kind === "data") return 8;
  if (file.kind === "runtime") return 4;

  return 10;
}

function isNoisySearchPath(relativePath: string) {
  const normalized = normalizePath(relativePath).toLowerCase();

  return (
    normalized.includes("/node_modules/") ||
    normalized.startsWith("node_modules/") ||
    normalized.includes("/dist/") ||
    normalized.startsWith("dist/") ||
    normalized.includes("/build/") ||
    normalized.startsWith("build/") ||
    normalized.endsWith("package-lock.json") ||
    normalized.endsWith("yarn.lock") ||
    normalized.endsWith("pnpm-lock.yaml")
  );
}

function scoreComposerSearchFile(file: ProjectInventoryFile, query: string) {
  const trimmedQuery = query.trim();
  const normalizedPath = normalizePath(file.path).toLowerCase();
  const searchablePath = normalizeForSearch(file.path);
  const fileName = normalizedPath.split("/").pop() ?? normalizedPath;
  const tokens = getSearchTokens(trimmedQuery);
  const inventoryText = getInventorySearchText(file);
  const pathSegments = splitMeaningfulTokens(file.path);

  let score = getBaseSearchScore(file);

  if (file.canReadText) {
    score += 8;
  }

  if (file.routePath) {
    score += 6;
  }

  if (file.textHints.length > 0) {
    score += 6;
  }

  if (isNoisySearchPath(file.path)) {
    score -= 80;
  }

  if (!trimmedQuery) {
    return score;
  }

  const normalizedQuery = normalizeForSearch(trimmedQuery);

  if (normalizedPath.includes(trimmedQuery.toLowerCase())) {
    score += 80;
  }

  if (searchablePath.includes(normalizedQuery)) {
    score += 60;
  }

  if (inventoryText.includes(normalizedQuery)) {
    score += 38;
  }

  if (fileName.includes(trimmedQuery.toLowerCase())) {
    score += 70;
  }

  for (const token of tokens) {
    if (pathSegments.includes(token)) {
      score += 42;
    } else if (searchablePath.includes(token)) {
      score += 18;
    }

    if (fileName.includes(token)) {
      score += 24;
    }

    if ((file.textHints ?? []).some((hint) => normalizeForSearch(hint) === token)) {
      score += 34;
    } else if (inventoryText.includes(token)) {
      score += 10;
    }
  }

  return score;
}

function buildSearchReason(file: ProjectInventoryFile, query: string, alreadySelected: boolean) {
  if (alreadySelected) {
    return "Already included in the current Composer review.";
  }

  if (query.trim()) {
    return `Matched project inventory search for "${query.trim()}".`;
  }

  if (file.kind === "source") {
    return "Source file from project inventory.";
  }

  if (file.kind === "style") {
    return "Style file from project inventory.";
  }

  if (file.kind === "config") {
    return "Configuration file from project inventory.";
  }

  return "Project inventory file.";
}

function toSearchResult({
  file,
  query,
  alreadySelected,
  score
}: {
  file: ProjectInventoryFile;
  query: string;
  alreadySelected: boolean;
  score: number;
}): ContextComposerFileSearchResult {
  const confidence = Math.max(0.35, Math.min(0.98, score / 140));

  return {
    path: file.path,
    kind: file.kind,
    usage: getComposerUsageForFile(file),
    reason: buildSearchReason(file, query, alreadySelected),
    confidence,
    canReadText: file.canReadText,
    sizeBytes: file.sizeBytes,
    score,
    alreadySelected
  };
}

export async function searchContextComposerFiles(input: {
  projectId: number;
  query: string;
  limit?: number;
  excludePaths?: string[];
}): Promise<ContextComposerFileSearchResponse> {
  const project = await getProjectById(input.projectId);

  if (!project) {
    throw new Error("Project not found");
  }

  const inventory = await scanProjectInventory(project.localPath);
  const limit = Math.min(80, Math.max(5, input.limit ?? 30));

  const excludedPathSet = new Set(
    getUniqueStrings(input.excludePaths ?? []).map((item) =>
      normalizePath(item).toLowerCase()
    )
  );

  const results = inventory.files
    .map((file) => {
      const alreadySelected = excludedPathSet.has(normalizePath(file.path).toLowerCase());
      const score = scoreComposerSearchFile(file, input.query);

      return toSearchResult({
        file,
        query: input.query,
        alreadySelected,
        score
      });
    })
    .filter((file) => {
      if (file.alreadySelected) {
        return false;
      }

      if (isNoisySearchPath(file.path)) {
        return false;
      }

      return file.score > 0;
    })
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.path.localeCompare(right.path);
    })
    .slice(0, limit);

  return {
    project: {
      id: project.id,
      name: project.name,
      localPath: project.localPath
    },
    query: input.query,
    results
  };
}

export async function readContextComposerFileSnippet(input: {
  projectId: number;
  filePath: string;
}): Promise<ContextComposerFileSnippetResponse> {
  const project = await getProjectById(input.projectId);

  if (!project) {
    throw new Error("Project not found");
  }

  const inventory = await scanProjectInventory(project.localPath);
  const inventoryFile = findInventoryFile(inventory, input.filePath);

  if (!inventoryFile) {
    throw new Error("File not found in project inventory");
  }

  const file: ComposerFileReference = {
    path: inventoryFile.path,
    kind: inventoryFile.kind,
    usage: getComposerUsageForFile(inventoryFile),
    reason: "Manually added from Composer file search.",
    confidence: 0.95,
    canReadText: inventoryFile.canReadText,
    sizeBytes: inventoryFile.sizeBytes
  };

  const snippet = await readFileSnippet(project.localPath, inventoryFile);

  return {
    file,
    snippet
  };
}