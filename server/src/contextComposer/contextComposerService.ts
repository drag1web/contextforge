import fs from "node:fs/promises";
import path from "node:path";

import { storage } from "../storage/index.js";
import { getAppSettings } from "../settings/settingsService.js";
import {
  analyzeTaskIntent,
  type TaskIntentAnalysis
} from "../ollama/taskIntentAnalyzer.js";
import {
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
import { isSecretLikePath } from "../selection/safetyPolicy.js";
import {
  finalizeSelectorDiagnostics,
  runSelectorPipeline,
  type SelectorPipelineDiagnostics,
} from "../selection/selectorPipelineOrchestrator.js";
import {
  applyTaskClarificationsToUnderstanding,
  buildSelectionTaskText,
  normalizeTaskClarifications,
  type TaskClarification,
} from "../taskPacks/taskClarifications.js";
import {
  buildTaskUnderstandingAnalysisSignature,
  isTaskUnderstandingSnapshotReviewAccepted,
  resolveTaskUnderstandingSnapshot,
} from "../taskPacks/taskUnderstandingSnapshot.js";
import { applyExplicitTargetGuard } from "../selection/explicitTargetGuard.js";
import { enforceExecutionAuthorizationAuthority } from "../selection/executionAuthorizationAuthority.js";
import { applyTaskUnderstandingReviewAcceptance } from "../ollama/taskUnderstanding.js";
import { groundTaskCurrentState } from "../taskPacks/taskCurrentStateGrounding.js";
import {
  resolveContextComposerEngine,
  type ContextComposerEngineFileView,
  type ContextComposerEngineView,
} from "../contextEngineV2/composer/index.js";

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
  confidence?: number;
  source?: "legacy" | "v2" | "manual";
  confidenceDisplay?: "legacy" | "unavailable";
  engineReasonCode?: ContextComposerEngineFileView["reasonCode"];
  contextRole?: ContextComposerEngineFileView["role"];
  evidenceState?: "confirmed" | "review_required" | "unavailable";
  reviewRequired?: boolean;
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
    originalRawTask: string;
    clarifications: TaskClarification[];
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
  selectorDiagnostics?: SelectorPipelineDiagnostics;
  contextEngine?: ContextComposerEngineView;
  qualitySource?: "legacy_quality" | "v2_grounded" | "review_required" | "blocked";
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
  if (isSecretLikePath(file.path)) return false;
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
  fileSelection,
  source = "legacy",
  engineView,
}: {
  inventory: ProjectInventory;
  fileSelection: TaskFileSelection;
  source?: "legacy" | "v2";
  engineView?: ContextComposerEngineView;
}): ComposerFileReference[] {
  const references: ComposerFileReference[] = [];

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
        ...(source === "legacy" ? { confidence: selectedFile.confidence } : {}),
        source,
        confidenceDisplay: source === "v2" ? "unavailable" : "legacy",
        canReadText: false,
        sizeBytes: 0
      });
      continue;
    }

    const engineFile = engineView?.files.find((file) => normalizePath(file.path).toLowerCase() === normalizePath(inventoryFile.path).toLowerCase());
    references.push({
      path: inventoryFile.path,
      kind: inventoryFile.kind,
      usage: selectedFile.usage,
      reason: selectedFile.reason,
      ...(source === "legacy" ? { confidence: selectedFile.confidence } : {}),
      source,
      confidenceDisplay: source === "v2" ? "unavailable" : "legacy",
      ...(engineFile ? {
        engineReasonCode: engineFile.reasonCode,
        contextRole: engineFile.role,
        evidenceState: engineFile.reviewRequired ? "review_required" as const : "confirmed" as const,
        reviewRequired: engineFile.reviewRequired,
      } : {}),
      canReadText: inventoryFile.canReadText,
      sizeBytes: inventoryFile.sizeBytes
    });
  }

  return references;
}

const COMPOSER_ENGINE_REASON_COPY: Readonly<Record<ContextComposerEngineFileView["reasonCode"], string>> = {
  legacy_candidate: "Candidate provided by the legacy Context Composer path.",
  confirmed_implementation_target: "Confirmed implementation target with current repository evidence.",
  confirmed_test_target: "Confirmed test target with current repository evidence.",
  confirmed_supporting_context: "Confirmed supporting context for the investigated target.",
  explicit_target_eligible: "Exact explicit target resolved in the active repository snapshot.",
  probable_review_only: "Probable repository candidate; review is required.",
  blocking_gap: "A blocking knowledge gap prevents automatic authorization.",
  blocking_contradiction: "Blocking evidence contradiction requires review.",
  negative_constraint: "Excluded by a task constraint.",
  secret_file: "Excluded by repository secret safety policy.",
  generated_target_blocked: "Generated files cannot be editable targets.",
  unreadable_file: "The repository source could not be safely read.",
  missing_evidence: "Current traceable evidence is missing.",
  evidence_entity_mismatch: "Evidence does not resolve to this repository entity.",
  result_not_safe_to_project: "The investigation result is not safe to project.",
  stop_reason_blocks_projection: "The investigation stop state blocks projection.",
  v2_execution_timeout: "Context Engine v2 reached its preview deadline.",
  v2_execution_error: "Context Engine v2 preview failed safely.",
  v2_capacity_exhausted: "Context Engine v2 preview capacity is currently exhausted.",
  canonical_input_mismatch: "The Composer request did not match its verified repository execution basis.",
  repository_changed: "The repository changed after the Composer inventory was prepared.",
  v2_integrity_violation: "Context Engine v2 output failed the Composer integrity boundary.",
  v2_not_grounded: "Context Engine v2 did not establish a grounded editable target.",
};

function emptyComposerSelection(
  legacy: TaskFileSelection,
): TaskFileSelection {
  return {
    ...legacy,
    selectedFiles: [],
    source: "deterministic",
    usedFallback: false,
    notes: [...legacy.notes, "Context Engine v2 blocked automatic preview candidates."],
  };
}

function buildContextEngineSuggestedFileGroups(input: {
  inventory: ProjectInventory;
  view: ContextComposerEngineView;
}): ContextComposerSuggestedFileGroup[] {
  const groups: Array<{ id: string; title: string; caption: string; roles: ContextComposerEngineFileView["role"][] }> = [
    { id: "v2-targets", title: "Grounded targets", caption: "Repository-grounded implementation targets from Context Engine v2.", roles: ["target"] },
    { id: "v2-tests", title: "Grounded tests", caption: "Repository-grounded test targets from Context Engine v2.", roles: ["test"] },
    { id: "v2-supporting", title: "Supporting context", caption: "Traceable supporting context; inspect before including.", roles: ["supporting"] },
    { id: "v2-reference", title: "Reference context", caption: "Reference-only repository context.", roles: ["reference"] },
  ];
  return groups.flatMap((group) => {
    const files = input.view.files
      .filter((file) => group.roles.includes(file.role))
      .flatMap((file) => {
        const inventoryFile = findInventoryFile(input.inventory, file.path);
        if (!inventoryFile) return [];
        return [{
          path: inventoryFile.path,
          kind: inventoryFile.kind,
          usage: file.usage,
          reason: COMPOSER_ENGINE_REASON_COPY[file.reasonCode],
          source: "v2" as const,
          confidenceDisplay: "unavailable" as const,
          engineReasonCode: file.reasonCode,
          contextRole: file.role,
          evidenceState: file.reviewRequired ? "review_required" as const : "confirmed" as const,
          reviewRequired: file.reviewRequired,
          canReadText: inventoryFile.canReadText,
          sizeBytes: inventoryFile.sizeBytes,
        } satisfies ComposerFileReference];
      });
    return files.length === 0 ? [] : [{ ...group, files }];
  });
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

  if (taskIntent.structuredIntent) {
    notes.push(
      `Structured intent: ${taskIntent.structuredIntent.primaryTargets.length} primary target(s); edit scope ${taskIntent.structuredIntent.allowedEditScope}.`
    );
  }

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
  clarifications?: TaskClarification[];
  understandingSnapshotId?: string;
  reviewedUnderstandingSnapshotId?: string;
}): Promise<ContextComposerPreview> {
  const project = await getProjectById(input.projectId);

  if (!project) {
    throw new Error("Project not found");
  }

  const inventory = await scanProjectInventory(project.localPath);
  const settings = await getAppSettings();
  const analysisSignature = buildTaskUnderstandingAnalysisSignature(settings);
  const clarifications = normalizeTaskClarifications(input.clarifications);
  const selectionTask = buildSelectionTaskText(input.rawTask, clarifications);

  const snapshotResolution = resolveTaskUnderstandingSnapshot({
    snapshotId: input.understandingSnapshotId,
    projectId: project.id,
    rawTask: input.rawTask,
    taskType: input.taskType,
    targetTool: input.targetTool,
    analysisSignature,
    clarifications,
    inventory,
  });
  const analyzedTaskIntent =
    snapshotResolution.hit && snapshotResolution.snapshot
      ? snapshotResolution.snapshot.taskIntent
      : await analyzeTaskIntent({
          rawTask: selectionTask,
          taskType: input.taskType,
          targetTool: input.targetTool,
          project,
          projectTree: inventory.files.map((file) => file.path),
        });
  let taskIntent = {
    ...analyzedTaskIntent,
    taskUnderstanding: applyTaskClarificationsToUnderstanding(
      analyzedTaskIntent.taskUnderstanding,
      clarifications,
    ),
  };
  taskIntent = groundTaskCurrentState({
    rawTask: selectionTask,
    inventory,
    taskIntent,
  });
  taskIntent = {
    ...taskIntent,
    taskUnderstanding: applyTaskUnderstandingReviewAcceptance(
      taskIntent.taskUnderstanding,
      isTaskUnderstandingSnapshotReviewAccepted(
        snapshotResolution,
        input.reviewedUnderstandingSnapshotId,
      ),
    ),
  };

  const pipeline = await runSelectorPipeline({
    rawTask: selectionTask,
    taskType: input.taskType,
    targetTool: input.targetTool,
    inventory,
    taskIntent,
    settings,
    projectRef: String(project.id),
  });
  const explicitTargetGuard = applyExplicitTargetGuard({
    rawTask: selectionTask,
    inventory,
    taskIntent,
    selection: pipeline.selection,
  });
  taskIntent = explicitTargetGuard.taskIntent;
  const initialFileSelection = explicitTargetGuard.selection;

  const effectiveTaskArea = getEffectiveTaskArea({
    taskType: input.taskType,
    taskIntent,
    fileSelection: initialFileSelection
  });

  const selectionQuality = evaluateContextSelectionQuality({
    rawTask: selectionTask,
    requestedTaskType: input.taskType,
    effectiveTaskArea,
    inventory,
    fileSelection: initialFileSelection,
    manualSelectionConfirmed: false,
    contextQualityMode: settings.contextQualityMode
  });
  const authoritativeFileSelection = enforceExecutionAuthorizationAuthority({
    rawTask: selectionTask,
    inventory,
    taskIntent,
    fileSelection: initialFileSelection,
    qualityStatus: selectionQuality.status,
    qualityBlockingReasons: selectionQuality.blockingReasons,
  });
  const selectionConfidence = selectionQuality.signals.confidence / 100;
  const legacyTaskIntentForPreview = {
    ...taskIntent,
    confidence: selectionConfidence
  };
  const legacyFileSelectionForPreview: TaskFileSelection = {
    ...authoritativeFileSelection,
    diagnostics: {
      ...authoritativeFileSelection.diagnostics,
      modelConfidence: taskIntent.confidence,
      finalConfidence: selectionConfidence
    } as TaskFileSelection["diagnostics"]
  };
  const selectorDiagnostics = finalizeSelectorDiagnostics(
    pipeline.diagnostics,
    selectionQuality,
    legacyFileSelectionForPreview,
  );

  const contextEngineResolution = await resolveContextComposerEngine({
    mode: settings.contextComposerEngineMode ?? "legacy",
    legacySelection: legacyFileSelectionForPreview,
    executionInput: {
      projectId: String(project.id),
      projectRoot: project.localPath,
      inventory,
      normalizedTask: selectionTask,
      structuredTargets: taskIntent.structuredIntent?.primaryTargets ?? [],
      protectedScopes: taskIntent.structuredIntent?.protectedScopes ?? [],
      requestedTaskType: input.taskType,
      effectiveTaskArea,
      plannerMode: settings.contextEnginePlannerMode ?? "deterministic",
    },
  });
  const fileSelectionForPreview = contextEngineResolution.selection ??
    emptyComposerSelection(legacyFileSelectionForPreview);
  const effectiveSelectionQuality = contextEngineResolution.useLegacySelection
    ? selectionQuality
    : evaluateContextSelectionQuality({
        rawTask: selectionTask,
        requestedTaskType: input.taskType,
        effectiveTaskArea,
        inventory,
        fileSelection: fileSelectionForPreview,
        manualSelectionConfirmed: false,
        contextQualityMode: settings.contextQualityMode,
      });
  const qualitySource: NonNullable<ContextComposerPreview["qualitySource"]> =
    contextEngineResolution.view.status === "safety_blocked"
      ? "blocked"
      : contextEngineResolution.view.status === "v2_review_required" && !contextEngineResolution.useLegacySelection
        ? "review_required"
        : contextEngineResolution.view.status === "v2_ready" && !contextEngineResolution.useLegacySelection
          ? "v2_grounded"
          : "legacy_quality";
  const selectionQualityForPreview: ContextSelectionQuality =
    contextEngineResolution.view.status === "safety_blocked"
      ? {
          ...effectiveSelectionQuality,
          status: "blocked",
          requiredManualReview: true,
          blockingReasons: Array.from(new Set([
            ...effectiveSelectionQuality.blockingReasons,
            "Context Engine v2 blocked automatic candidates at the repository safety boundary.",
          ])),
        }
      : contextEngineResolution.view.status === "v2_review_required" &&
          contextEngineResolution.view.requestedMode === "v2_primary"
        ? {
            ...effectiveSelectionQuality,
            status: "warning",
            requiredManualReview: true,
            warnings: Array.from(new Set([
              ...effectiveSelectionQuality.warnings,
              "Context Engine v2 requires manual review of the grounded repository context.",
            ])),
          }
        : contextEngineResolution.view.status === "v2_ready" && !contextEngineResolution.useLegacySelection
          ? {
              ...effectiveSelectionQuality,
              status: "ready",
              requiredManualReview: false,
              blockingReasons: [],
            }
          : effectiveSelectionQuality;
  const taskIntentForPreview = contextEngineResolution.useLegacySelection
    ? legacyTaskIntentForPreview
    : taskIntent;
  const selectedFiles = buildFileReferences({
    inventory,
    fileSelection: fileSelectionForPreview,
    source: contextEngineResolution.useLegacySelection ? "legacy" : "v2",
    engineView: contextEngineResolution.view,
  });

  const suggestedFileGroups = contextEngineResolution.useLegacySelection
    ? buildSuggestedFileGroups({
        inventory,
        rawTask: selectionTask,
        taskIntent,
        effectiveTaskArea,
        selectedFiles,
        selectionQuality: selectionQualityForPreview
      })
    : buildContextEngineSuggestedFileGroups({
        inventory,
        view: contextEngineResolution.view,
      });

  const clarifyingQuestions = buildClarifyingQuestions({
    rawTask: selectionTask,
    effectiveTaskArea,
    taskIntent,
    selectionQuality: selectionQualityForPreview,
    suggestedFileGroups
  });

  const snippets = await buildSnippets({
    projectRoot: project.localPath,
    inventory,
    fileSelection: fileSelectionForPreview
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
      rawTask: selectionTask,
      originalRawTask: input.rawTask,
      clarifications,
      requestedTaskType: input.taskType,
      effectiveTaskArea,
      targetTool: input.targetTool
    },
    taskIntent: taskIntentForPreview,
    fileSelection: fileSelectionForPreview,
    selectionQuality: selectionQualityForPreview,
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
      fileSelection: fileSelectionForPreview,
      selectionQuality: selectionQualityForPreview,
      selectedFiles,
      suggestedFileGroups,
      clarifyingQuestions,
      snippets
    }),
    selectorDiagnostics,
    contextEngine: contextEngineResolution.view,
    qualitySource,
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
    source: "legacy",
    confidenceDisplay: "legacy",
    canReadText: file.canReadText,
    sizeBytes: file.sizeBytes
  };
}

function buildSuggestedFileGroups({
  inventory,
  rawTask,
  taskIntent,
  effectiveTaskArea,
  selectedFiles,
  selectionQuality
}: {
  inventory: ProjectInventory;
  rawTask: string;
  taskIntent: TaskIntentAnalysis;
  effectiveTaskArea: string;
  selectedFiles: ComposerFileReference[];
  selectionQuality: ContextSelectionQuality;
}): ContextComposerSuggestedFileGroup[] {
  const selectedPathSet = new Set(selectedFiles.map((file) => normalizePath(file.path).toLowerCase()));
  const weakManualReviewMode = selectionQuality.status === "blocked" && selectedFiles.length === 0;
  const taskTokens = getTaskMeaningTokens({ rawTask, taskIntent });
  const scored = inventory.files
    .filter((file) => file.kind !== "asset" && file.kind !== "runtime" && file.kind !== "data")
    .filter((file) => canShowComposerCandidateForTask(file, rawTask, taskIntent))
    .map((file) => ({ file, score: scoreInventoryFileAgainstTask(file, taskTokens, effectiveTaskArea) }))
    .filter((item) => item.score > 30)
    .sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path));

  const makeGroupFiles = (items: Array<{ file: ProjectInventoryFile; score: number }>, reason: string, limit: number, weak = false) => {
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
        weak
          ? Math.max(0.35, Math.min(0.62, item.score / 180))
          : Math.max(0.45, Math.min(0.96, item.score / 130))
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

  if (weakManualReviewMode) {
    const weakFiles = makeGroupFiles(
      targetItems.length > 0 ? targetItems : scored,
      "Weak manual-review suggestion from inventory ranking. Not auto-selected; include only after confirming this is the real target file.",
      6,
      true
    );

    if (weakFiles.length > 0) {
      groups.push({
        id: "weak-manual-review-candidates",
        title: "Weak manual-review candidates",
        caption: "Automatic selection was blocked. These files are only search hints, not confirmed targets.",
        files: weakFiles
      });
    }

    return groups;
  }

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

function getContextTargetCopy(effectiveTaskArea: string) {
  const normalized = String(effectiveTaskArea || "general").toLowerCase();

  if (normalized === "ui") {
    return {
      target: "UI target file",
      targetExamples: "page, component, layout, style file, or route file",
      weakTarget: "No confirmed UI target file was found. Search for the real page/component/layout file, or include a weak suggestion only if you recognize it.",
      targetScope: "Should the coding agent edit only the UI target, or also related styles/layout files?"
    };
  }

  if (normalized === "backend") {
    return {
      target: "backend target file",
      targetExamples: "endpoint, route, service, database, validation, or API module",
      weakTarget: "No confirmed backend target file was found. Search for the real endpoint/service/module, or include a weak suggestion only if you recognize it.",
      targetScope: "Is backend/API behavior allowed to change, or should backend files stay inspect-only?"
    };
  }

  if (normalized === "tests") {
    return {
      target: "test target",
      targetExamples: "test file, spec file, source file under test, fixture, or test config",
      weakTarget: "No confirmed test target was found. Search for the real spec/source pair, or include a weak suggestion only if you recognize it.",
      targetScope: "Should the coding agent add or update tests, or only identify the best test location?"
    };
  }

  if (normalized === "docs") {
    return {
      target: "documentation target",
      targetExamples: "README, docs page, changelog, guide, config, or source file used as evidence",
      weakTarget: "No confirmed documentation target was found. Search for the real doc/source file, or include a weak suggestion only if you recognize it.",
      targetScope: "Should the coding agent update docs only, or also inspect source files for accuracy?"
    };
  }

  if (normalized === "build") {
    return {
      target: "build target",
      targetExamples: "package script, config file, CI workflow, build entry, or failing source file",
      weakTarget: "No confirmed build target was found. Search for the real config/script/source file, or include a weak suggestion only if you recognize it.",
      targetScope: "Should the coding agent change build/config files, or only document the verification command?"
    };
  }

  if (normalized === "fullstack") {
    return {
      target: "workflow target",
      targetExamples: "UI file, endpoint, service, data module, or shared contract",
      weakTarget: "No confirmed workflow target was found. Search for the real UI/API/data files, or include a weak suggestion only if you recognize it.",
      targetScope: "Should the coding agent update both client and backend files, or keep one side inspect-only?"
    };
  }

  return {
    target: "task target file",
    targetExamples: "page, component, endpoint, service, test, docs, config, or source file",
    weakTarget: "No confirmed task target was found. Search for the real file, or include a weak suggestion only if you recognize it.",
    targetScope: "Should the coding agent edit this target directly, or only inspect it as context?"
  };
}

function buildClarifyingQuestions({
  effectiveTaskArea,
  taskIntent,
  selectionQuality,
  suggestedFileGroups
}: {
  rawTask: string;
  effectiveTaskArea: string;
  taskIntent: TaskIntentAnalysis;
  selectionQuality: ContextSelectionQuality;
  suggestedFileGroups: ContextComposerSuggestedFileGroup[];
}) {
  const understandingQuestion =
    taskIntent.taskUnderstanding?.readiness === "needs_clarification"
      ? taskIntent.taskUnderstanding.clarificationQuestion
      : null;

  if (understandingQuestion) return [understandingQuestion];
  if (selectionQuality.status === "ready") return [];

  const questions: string[] = [];
  const targetCopy = getContextTargetCopy(effectiveTaskArea);
  const topFiles = suggestedFileGroups[0]?.files.slice(0, 4).map((file) => file.path) ?? [];
  const weakReviewOnly = selectionQuality.status === "blocked"
    && suggestedFileGroups.length > 0
    && suggestedFileGroups.every((group) => group.id === "weak-manual-review-candidates");

  if (weakReviewOnly) {
    questions.push(targetCopy.weakTarget);
  } else if (topFiles.length > 0) {
    questions.push(`Which suggested file is the real ${targetCopy.target}: ${topFiles.join(" | ")}?`);
  } else {
    questions.push(`Which ${targetCopy.targetExamples} should the coding agent use for this task?`);
  }

  questions.push(targetCopy.targetScope);

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

function queryLooksLikeExplicitPath(query: string) {
  const normalized = normalizePath(query).toLowerCase().trim();
  return normalized.includes("/") || normalized.includes("\\") || /\.[a-z0-9]{1,8}$/i.test(normalized);
}

function hasComposerProtectedBackendConstraint(rawTask: string, taskIntent?: TaskIntentAnalysis) {
  const text = normalizeForSearch([
    rawTask,
    taskIntent?.taskArea ?? "",
    ...(taskIntent?.intentTags ?? []),
    ...(taskIntent?.domainTerms ?? []),
    ...(taskIntent?.fileRoleHints ?? []),
    ...(taskIntent?.structuredIntent?.protectedScopes ?? [])
  ].join(" "));

  const mentionsBackendSurface = /\b(api|endpoint|request|requests|fetch|server|backend|auth|session|token|database|db)\b/i.test(text);
  const russianProtectedBackend = /\bapi\b[^.!?\n]{0,140}\u043d\u0435\s+(?:\u043c\u0435\u043d\u044f|\u0442\u0440\u043e\u0433|\u0440\u0435\u0434\u0430\u043a\u0442\u0438\u0440|\u0438\u0437\u043c\u0435\u043d)/i.test(text)
    || /(?:\u0430\u043f\u0438|\u0431\u044d\u043a|\u0431\u0435\u043a|\u0431\u044d\u043a\u0435\u043d\u0434|\u0431\u0435\u043a\u0435\u043d\u0434|\u0441\u0435\u0440\u0432\u0435\u0440|\u0437\u0430\u043f\u0440\u043e\u0441|\u0437\u0430\u0433\u0440\u0443\u0437|\u0442\u043e\u043a\u0435\u043d|\u0441\u0435\u0441\u0441|\u0431\u0430\u0437\u0430|\u0431\u0434)[^.!?\n]{0,140}\u043d\u0435\s+(?:\u043c\u0435\u043d\u044f|\u0442\u0440\u043e\u0433|\u0440\u0435\u0434\u0430\u043a\u0442\u0438\u0440|\u0438\u0437\u043c\u0435\u043d)/i.test(text)
    || /\u043d\u0435\s+(?:\u043c\u0435\u043d\u044f|\u0442\u0440\u043e\u0433|\u0440\u0435\u0434\u0430\u043a\u0442\u0438\u0440|\u0438\u0437\u043c\u0435\u043d)[^.!?\n]{0,140}(?:\u0430\u043f\u0438|\u0431\u044d\u043a|\u0431\u0435\u043a|\u0441\u0435\u0440\u0432\u0435\u0440|\u0437\u0430\u043f\u0440\u043e\u0441|\u0437\u0430\u0433\u0440\u0443\u0437|api|backend|server)/i.test(text);
  const protectsSurface = russianProtectedBackend
    || /\b(do not|don't|dont|without|not|avoid|keep|preserve)\b/i.test(text)
    || /(?:не|нельзя|без|сохрани|оставь|не\s+меня|не\s+трог)/i.test(text);

  return (mentionsBackendSurface && protectsSurface)
    || russianProtectedBackend
    || (taskIntent?.structuredIntent?.needsBackend === false && mentionsBackendSurface);
}

function hasDirectProtectedBackendText(rawTask: string) {
  const normalized = normalizePath(rawTask)
    .toLowerCase()
    .replace(/[_./\\-]+/g, " ");

  const backendSurface = /(?:\b(?:api|backend|back\s*end|server|endpoint|route|request|requests|fetch|upload|uploads|loading|load|http|axios|database|db|auth|session|token)\b|(?:\u0430\u043f\u0438|\u0431\u044d\u043a|\u0431\u0435\u043a|\u0431\u044d\u043a\u0435\u043d\u0434|\u0431\u0435\u043a\u0435\u043d\u0434|\u0441\u0435\u0440\u0432\u0435\u0440|\u044d\u043d\u0434\u043f\u043e\u0438\u043d\u0442|\u043c\u0430\u0440\u0448\u0440\u0443\u0442|\u0437\u0430\u043f\u0440\u043e\u0441|\u0444\u0435\u0442\u0447|\u0437\u0430\u0433\u0440\u0443\u0437|\u0431\u0430\u0437\u0430|\u0431\u0434|\u0430\u0432\u0442\u043e\u0440\u0438\u0437\u0430\u0446|\u0441\u0435\u0441\u0441|\u0442\u043e\u043a\u0435\u043d))/i;
  const negativeIntent = /(?:\b(?:do\s+not|don't|dont|without|avoid|keep|leave|preserve)\b|\u043d\u0435\s+(?:\u043c\u0435\u043d\u044f|\u0442\u0440\u043e\u0433|\u0440\u0435\u0434\u0430\u043a\u0442\u0438\u0440|\u0438\u0437\u043c\u0435\u043d|\u043b\u043e\u043c\u0430|\u043f\u0435\u0440\u0435\u043f\u0438\u0441)|\u0431\u0435\u0437\s+\u0438\u0437\u043c\u0435\u043d)/i;

  if (!backendSurface.test(normalized) || !negativeIntent.test(normalized)) {
    return false;
  }

  return [
    new RegExp(`${backendSurface.source}[\\s\\S]{0,180}${negativeIntent.source}`, "i"),
    new RegExp(`${negativeIntent.source}[\\s\\S]{0,180}${backendSurface.source}`, "i")
  ].some((pattern) => pattern.test(normalized));
}

function isComposerBackendOrApiFile(file: ProjectInventoryFile) {
  const normalized = normalizePath(file.path).toLowerCase();
  const identity = normalizeForSearch([
    file.path,
    file.name,
    file.role,
    ...(file.symbols ?? []),
    ...(file.exports ?? []),
    ...(file.textHints ?? [])
  ].join(" "));

  return ["api-route", "client-api", "service", "repository", "db-schema", "server-entry"].includes(file.role)
    || normalized.startsWith("server/")
    || normalized.includes("/server/")
    || normalized.startsWith("backend/")
    || normalized.includes("/backend/")
    || normalized.startsWith("api/")
    || normalized.includes("/api/")
    || normalized.startsWith("src/api/")
    || normalized.includes("/src/api/")
    || normalized.includes("/routes/")
    || normalized.includes("/services/")
    || normalized.endsWith("/api.ts")
    || normalized.endsWith("/api.js")
    || /\b(auth|session|token|cookie|database|db)\b/i.test(identity);
}

function canShowComposerCandidateForTask(file: ProjectInventoryFile, rawTask: string, taskIntent?: TaskIntentAnalysis, allowExplicitPath = false) {
  const backendProtected = hasComposerProtectedBackendConstraint(rawTask, taskIntent)
    || hasDirectProtectedBackendText(rawTask)
    || (taskIntent?.structuredIntent?.protectedScopes ?? []).some((scope) => hasDirectProtectedBackendText(scope));

  if (!backendProtected) return true;
  if (allowExplicitPath) return true;
  return !isComposerBackendOrApiFile(file);
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
    .filter((file) => canShowComposerCandidateForTask(file, input.query, undefined, queryLooksLikeExplicitPath(input.query)))
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
    source: "manual",
    confidenceDisplay: "legacy",
    canReadText: inventoryFile.canReadText,
    sizeBytes: inventoryFile.sizeBytes
  };

  const snippet = await readFileSnippet(project.localPath, inventoryFile);

  return {
    file,
    snippet
  };
}
