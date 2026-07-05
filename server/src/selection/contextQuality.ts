import type {
  ProjectInventory,
  ProjectInventoryFile,
} from "../scanner/projectInventoryScanner.js";
import type { TaskArea } from "../ollama/taskIntentAnalyzer.js";
import type { TaskFileSelection } from "../ollama/taskFileSelector.js";
import { resolveExplicitFileMentions } from "./explicitFileMentions.js";
import {
  detectHardTaskSafetyIssue,
  isSecretLikePath,
} from "./safetyPolicy.js";

export type ContextSelectionQualityStatus = "ready" | "warning" | "blocked";
export type ContextQualityMode = "advisory" | "balanced" | "strict";

export interface ContextSelectionQuality {
  status: ContextSelectionQualityStatus;
  score: number;
  warnings: string[];
  blockingReasons: string[];
  requiredManualReview: boolean;
  signals: ContextSelectionQualitySignals;
}

export interface ContextSelectionQualitySignals {
  targetConfidence: number;
  scopeSafety: number;
  contextCompleteness: number;
  protectedScopeRisk: number;
  manualReviewReason: string | null;
  nextActions: string[];
}

interface EvaluateContextSelectionQualityInput {
  rawTask: string;
  requestedTaskType: string;
  effectiveTaskArea: TaskArea | string;
  inventory: ProjectInventory;
  fileSelection: TaskFileSelection;
  manualSelectionConfirmed?: boolean;
  contextQualityMode?: ContextQualityMode;
}

const TASK_STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "from",
  "this",
  "that",
  "with",
  "make",
  "change",
  "fix",
  "add",
  "remove",
  "update",
  "current",
  "existing",
  "new",
  "better",
  "more",
  "less",
  "page",
  "file",
  "files",
  "component",
  "components",
  "project",
  "app",
  "src",
  "need",
  "needs",
  "should",
  "please",
  "нужно",
  "надо",
  "мне",
  "сделать",
  "сделай",
  "изменить",
  "измени",
  "добавить",
  "добавь",
  "исправить",
  "исправь",
  "чтобы",
  "это",
  "как",
  "что",
  "там",
  "для",
  "при",
  "или",
  "если",
  "странице",
  "страница",
  "файл",
  "файлы",
  "проект",
  "программа",
  "программе",
  "текущий",
  "текущую",
]);

function normalizePath(value: string) {
  return value.replace(/\\/g, "/").trim();
}

function normalizeForCompare(value: string) {
  return normalizePath(value).toLowerCase();
}

function includesAny(value: string, terms: string[]) {
  const normalized = normalizeForCompare(value);
  return terms.some((term) => normalized.includes(normalizeForCompare(term)));
}

function tokenize(value: string) {
  return normalizeForCompare(value)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[^a-zа-яё0-9_.\/-]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && token.length <= 32)
    .filter((token) => !TASK_STOP_WORDS.has(token))
    .filter((token) => !/^\d+$/.test(token));
}

function getRequestedArea(taskType: string): TaskArea | "general" {
  const selected = normalizeForCompare(taskType);

  if (
    selected.includes("ui") ||
    selected.includes("ux") ||
    selected.includes("front")
  )
    return "ui";
  if (
    selected.includes("backend") ||
    selected.includes("server") ||
    selected.includes("api")
  )
    return "backend";
  if (selected.includes("fullstack") || selected.includes("full-stack"))
    return "fullstack";
  if (selected.includes("build") || selected.includes("config")) return "build";
  if (selected.includes("docs")) return "docs";
  if (selected.includes("test")) return "tests";
  if (selected.includes("bugfix")) return "bugfix";
  if (selected.includes("refactor")) return "refactor";

  return "general";
}

function getSelectedInventoryFiles(
  inventory: ProjectInventory,
  selection: TaskFileSelection,
) {
  const inventoryByPath = new Map(
    inventory.files.map((file) => [normalizeForCompare(file.path), file]),
  );

  return selection.selectedFiles
    .map((file) => inventoryByPath.get(normalizeForCompare(file.path)))
    .filter((file): file is ProjectInventoryFile => Boolean(file));
}

function getSelectedCreateTargets(selection: TaskFileSelection) {
  return selection.selectedFiles.filter(
    (file) => file.usage === "create-and-edit",
  );
}

function createTargetHasTaskOverlap(pathValue: string, tokens: string[]) {
  if (tokens.length === 0) return false;
  const comparable = normalizeForCompare(pathValue);
  return tokens.some((token) => comparable.includes(token));
}

function getFileText(file: ProjectInventoryFile) {
  return normalizeForCompare(
    [
      file.path,
      file.name,
      file.kind,
      file.role,
      file.routePath ?? "",
      ...(file.imports ?? []),
      ...(file.exports ?? []),
      ...(file.symbols ?? []),
      ...(file.textHints ?? []),
      file.contentPreview ?? "",
    ].join(" "),
  );
}

function hasTaskOverlap(file: ProjectInventoryFile, tokens: string[]) {
  if (tokens.length === 0) return false;
  const text = getFileText(file);
  return tokens.some((token) => text.includes(token));
}

function getTaskOverlapCount(file: ProjectInventoryFile, tokens: string[]) {
  const text = getFileText(file);
  return tokens.reduce(
    (count, token) => count + (text.includes(token) ? 1 : 0),
    0,
  );
}

function isDocsOrConfigOnly(file: ProjectInventoryFile) {
  return (
    file.kind === "docs" ||
    file.kind === "config" ||
    file.kind === "data" ||
    file.kind === "runtime"
  );
}

function isEditableCodeLike(file: ProjectInventoryFile) {
  return (
    file.kind === "source" || file.kind === "style" || file.kind === "test"
  );
}

function isUiLike(file: ProjectInventoryFile) {
  const path = normalizeForCompare(file.path);
  const name = path.split("/").pop() ?? path;

  return (
    file.kind === "style" ||
    file.role === "page" ||
    file.role === "layout" ||
    file.role === "component" ||
    file.role === "ui-component" ||
    file.role === "app-entry" ||
    path.includes("/components/") ||
    path.includes("/pages/") ||
    path.startsWith("src/app/") ||
    [
      "app.tsx",
      "app.jsx",
      "app.js",
      "main.tsx",
      "main.jsx",
      "index.tsx",
      "index.jsx",
    ].includes(name)
  );
}

function isBackendLike(file: ProjectInventoryFile) {
  const path = normalizeForCompare(file.path);

  return (
    file.role === "api-route" ||
    file.role === "server-entry" ||
    file.role === "service" ||
    file.role === "repository" ||
    file.role === "db-schema" ||
    path.includes("/server/") ||
    path.startsWith("server/") ||
    path.includes("/api/") ||
    path.includes("/routes/") ||
    path.includes("/services/") ||
    path.includes("/service/") ||
    path.endsWith("/api.ts") ||
    path.endsWith("/api.js")
  );
}

function isGenericShellOrGlobal(file: ProjectInventoryFile) {
  const path = normalizeForCompare(file.path);
  const fileName = path.split("/").pop() ?? path;

  return (
    file.kind === "config" ||
    file.kind === "docs" ||
    fileName === "globals.css" ||
    fileName === "index.css" ||
    fileName === "app.css" ||
    fileName === "layout.tsx" ||
    fileName === "layout.jsx" ||
    fileName === "layout.ts" ||
    fileName === "layout.js" ||
    fileName === "main.tsx" ||
    fileName === "main.jsx" ||
    fileName === "index.tsx" ||
    fileName === "index.jsx" ||
    path.endsWith("package.json")
  );
}

function isImplementationIntent(rawTask: string) {
  return includesAny(rawTask, [
    "implement",
    "connect",
    "integrate",
    "add feature",
    "build feature",
    "create feature",
    "wire",
    "hook up",
    "change ui",
    "change interface",
    "replace",
    "render",
    "show",
    "display",
    "fetch",
    "call api",
    "external api",
    "реализ",
    "подключ",
    "интегр",
    "добав",
    "сделать",
    "замен",
    "вывести",
    "показ",
    "получать",
    "запрос",
    "через api",
    "внешн",
  ]);
}

function isTestPlanningIntent(rawTask: string, area: string) {
  if (area !== "tests" && area !== "general") return false;
  const text = normalizeForCompare(rawTask);
  const testIntent =
    /\b(?:test|tests|testing|coverage|scenarios|strategy|where\s+to\s+add\s+tests)\b/i.test(
      text,
    ) ||
    /(?:\u0442\u0435\u0441\u0442|\u0442\u0435\u0441\u0442\u044b|\u0441\u0446\u0435\u043d\u0430\u0440|\u043f\u0440\u043e\u0432\u0435\u0440|\u0433\u0434\u0435\s+\u0434\u043e\u0431\u0430\u0432\u0438\u0442\u044c\s+\u0442\u0435\u0441\u0442)/i.test(
      text,
    );
  const planningIntent =
    /\b(?:find|where|recommend|prepare|plan|strategy|describe|outline)\b/i.test(
      text,
    ) ||
    /(?:\u043d\u0430\u0439\u0434\u0438|\u0433\u0434\u0435|\u043b\u0443\u0447\u0448\u0435|\u043f\u043e\u0434\u0433\u043e\u0442\u043e\u0432|\u043e\u043f\u0438\u0448\u0438|\u0441\u0446\u0435\u043d\u0430\u0440|\u0441\u0442\u0440\u0430\u0442\u0435\u0433)/i.test(
      text,
    );
  const directImplementation =
    /\b(?:write|implement|add|create)\s+(?:unit\s+|e2e\s+|integration\s+)?tests?\b/i.test(
      text,
    ) ||
    /(?:\u0434\u043e\u0431\u0430\u0432\u044c|\u0441\u043e\u0437\u0434\u0430\u0439|\u043d\u0430\u043f\u0438\u0448\u0438)\s+[^.!?\n]{0,60}\u0442\u0435\u0441\u0442/i.test(
      text,
    );

  return testIntent && planningIntent && !directImplementation;
}

function isDocsPrimaryIntent(rawTask: string, area: string) {
  const docsIntent = includesAny(rawTask, [
    "readme",
    "docs",
    "documentation",
    "guide",
    "manual",
    "how to run",
    "setup",
    "commands",
    "ридми",
    "документац",
    "инструкц",
    "описать команды",
    "команды запуска",
    "запуска проекта",
  ]);

  if (!docsIntent) return false;
  if (
    isImplementationIntent(rawTask) &&
    includesAny(rawTask, [
      "api",
      "апи",
      "интерфейс",
      "program",
      "программ",
      "реализ",
      "подключ",
      "интегр",
    ])
  )
    return false;
  return area === "docs" || docsIntent;
}

function clampScore(value: number) {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function hasProtectedBackendConstraint(
  rawTask: string,
  selectionNotes: string,
) {
  const text = normalizeForCompare([rawTask, selectionNotes].join(" "));

  return (
    /\b(?:api|endpoint|request|requests|fetch|server|backend|auth|session|token|database|db)\b[^.!?\n]{0,140}\b(?:do\s+not|don't|dont|without|not|avoid|keep|preserve|unchanged)\b/i.test(
      text,
    ) ||
    /\b(?:do\s+not|don't|dont|without|not|avoid|keep|preserve)\b[^.!?\n]{0,140}\b(?:api|endpoint|request|requests|fetch|server|backend|auth|session|token|database|db)\b/i.test(
      text,
    ) ||
    /\bapi\b[^.!?\n]{0,140}\u043d\u0435\s+(?:\u043c\u0435\u043d\u044f\u0442\u044c|\u043c\u0435\u043d\u044f\u0439|\u0442\u0440\u043e\u0433\u0430\u0442\u044c|\u0442\u0440\u043e\u0433\u0430\u0439|\u0440\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u0442\u044c|\u0440\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u0443\u0439|\u0438\u0437\u043c\u0435\u043d\u044f\u0442\u044c|\u0438\u0437\u043c\u0435\u043d\u044f\u0439)/i.test(
      text,
    ) ||
    /(?:\u0430\u043f\u0438|\u0431\u044d\u043a|\u0431\u0435\u043a|\u0431\u044d\u043a\u0435\u043d\u0434|\u0431\u0435\u043a\u0435\u043d\u0434|\u0441\u0435\u0440\u0432\u0435\u0440|\u0437\u0430\u043f\u0440\u043e\u0441|\u0437\u0430\u0433\u0440\u0443\u0437|\u0442\u043e\u043a\u0435\u043d|\u0441\u0435\u0441\u0441|\u0431\u0430\u0437\u0430|\u0431\u0434)[^.!?\n]{0,140}\u043d\u0435\s+(?:\u043c\u0435\u043d\u044f\u0442\u044c|\u043c\u0435\u043d\u044f\u0439|\u0442\u0440\u043e\u0433\u0430\u0442\u044c|\u0442\u0440\u043e\u0433\u0430\u0439|\u0440\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u0442\u044c|\u0440\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u0443\u0439|\u0438\u0437\u043c\u0435\u043d\u044f\u0442\u044c|\u0438\u0437\u043c\u0435\u043d\u044f\u0439)/i.test(
      text,
    ) ||
    text.includes("backend/api files should not be selected")
  );
}

function buildQualitySignals({
  selectedFiles,
  score,
  warnings,
  blockingReasons,
  hasEditableCode,
  hasOverlappingFile,
  strongOverlapFileCount,
  plausibleCodeFileCount,
  genericOnly,
  explicitPathSelected,
  docsConfigOnly,
  docsPrimaryIntent,
  isCodeTask,
  hasBackend,
  protectedBackendConstraint,
  createTargetCount,
}: {
  selectedFiles: ProjectInventoryFile[];
  createTargetCount: number;
  score: number;
  warnings: string[];
  blockingReasons: string[];
  hasEditableCode: boolean;
  hasOverlappingFile: boolean;
  strongOverlapFileCount: number;
  plausibleCodeFileCount: number;
  genericOnly: boolean;
  explicitPathSelected: boolean;
  docsConfigOnly: boolean;
  docsPrimaryIntent: boolean;
  isCodeTask: boolean;
  hasBackend: boolean;
  protectedBackendConstraint: boolean;
}): ContextSelectionQualitySignals {
  const totalContextCount = selectedFiles.length + createTargetCount;
  const targetConfidence = clampScore(
    totalContextCount === 0
      ? 0
      : createTargetCount > 0
        ? 92
        : explicitPathSelected
          ? 95
          : hasOverlappingFile
            ? 48 + strongOverlapFileCount * 14 + plausibleCodeFileCount * 7
            : genericOnly
              ? 24
              : plausibleCodeFileCount > 0
                ? 44 + plausibleCodeFileCount * 6
                : 32,
  );
  const contextCompleteness = clampScore(
    totalContextCount === 0
      ? 0
      : createTargetCount > 0
        ? 76 + Math.min(12, selectedFiles.length * 4)
        : docsPrimaryIntent && docsConfigOnly
          ? 78
          : (hasEditableCode ? 42 : 14) +
            Math.min(34, selectedFiles.length * 7) +
            Math.min(24, plausibleCodeFileCount * 8),
  );
  const protectedScopeRisk = clampScore(
    protectedBackendConstraint && hasBackend
      ? 92
      : protectedBackendConstraint
        ? 18
        : genericOnly && isCodeTask
          ? 32
          : 8,
  );
  const scopeSafety = clampScore(
    100 - protectedScopeRisk - (genericOnly && isCodeTask ? 12 : 0),
  );
  const manualReviewReason =
    blockingReasons[0] ?? (score < 78 ? (warnings[0] ?? null) : null);
  const nextActions: string[] = [];

  if (totalContextCount === 0) {
    nextActions.push(
      "Search for the exact page, component, form, service, or route before generating.",
    );
  } else if (createTargetCount > 0) {
    nextActions.push(
      "Create the planned create-and-edit file(s), then use reference files only for conventions and routing context.",
    );
  }
  if (
    blockingReasons.some((reason) => reason.includes("specific UI object")) ||
    blockingReasons.some((reason) => reason.includes("No UI page"))
  ) {
    nextActions.push(
      "Pick the real UI surface manually, or clarify which screen contains the requested element.",
    );
  }
  if (protectedBackendConstraint) {
    nextActions.push(
      "Keep backend/API files out of inspect-and-edit unless the user explicitly allows backend changes.",
    );
  }
  if (genericOnly && isCodeTask) {
    nextActions.push(
      "Replace generic shell/config files with a concrete page, component, service, or route.",
    );
  }
  if (
    !hasOverlappingFile &&
    totalContextCount > 0 &&
    isCodeTask &&
    createTargetCount === 0
  ) {
    nextActions.push(
      "Add a file whose path, symbols, route, or text hints match the task wording.",
    );
  }
  if (nextActions.length === 0 && score < 78) {
    nextActions.push(
      "Review selected files manually before generating the Task Pack.",
    );
  }

  return {
    targetConfidence,
    scopeSafety,
    contextCompleteness,
    protectedScopeRisk,
    manualReviewReason,
    nextActions: unique(nextActions).slice(0, 4),
  };
}

function getPositiveTaskTextForExplicitMentions(rawTask: string) {
  let text = rawTask;
  const normalized = rawTask.replace(/[—–]/g, " — ");
  const phrases: string[] = [];

  const afterRegexes = [
    /(?:не\s+(?:менять|меняй|трогать|трогай|лезь|лезть|редактировать|редактируй|изменять|изменяй))\s+(?:в\s+|к\s+)?([^.!?\n—]{1,120})/gi,
    /(?:do\s+not|don't|dont)\s+(?:change|touch|edit|modify)\s+([^.!?\n—]{1,120})/gi,
    /(?:without\s+(?:changing|touching|editing|modifying))\s+([^.!?\n—]{1,120})/gi,
  ];
  const beforeRegexes = [
    /([^.!?\n—]{1,160})\s+не\s+(?:менять|трогать|редактировать|изменять)/gi,
    /([^.!?\n—]{1,160})\s+(?:do\s+not|don't|dont)\s+(?:change|touch|edit|modify)/gi,
  ];

  for (const regex of afterRegexes) {
    for (const match of normalized.matchAll(regex)) {
      const phrase = String(match[1] ?? "")
        .split(/[.!?\n—]/)[0]
        .trim();
      if (phrase) phrases.push(phrase);
    }
  }

  for (const regex of beforeRegexes) {
    for (const match of normalized.matchAll(regex)) {
      const raw = String(match[1] ?? "");
      const phrase =
        (raw.split(/[.;!?\n—]/).pop() ?? raw)
          .split(/(?:^|\s)(?:но|but|however)(?:\s|$)/gi)
          .pop()
          ?.trim() ?? "";
      // Skip positive task clauses such as "improve navigation and do not change other files".
      if (
        /(?:улучш|сдел|замен|добав|реализ|подключ|исправ|передел)/i.test(
          phrase,
        ) ||
        /\b(?:improve|make|replace|add|implement|connect|fix|change)\b/i.test(
          phrase,
        )
      )
        continue;
      if (phrase) phrases.push(phrase);
    }
  }

  for (const phrase of Array.from(new Set(phrases))) {
    const escaped = phrase
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\s+/g, "\\s+");
    text = text.replace(new RegExp(escaped, "gi"), " ");
  }

  text = text.replace(
    /(?:но|but)\s+(?:не\s+)?(?:меняй|трогай|лезь|change|touch|edit)[^.!?\n—]{0,160}/gi,
    " ",
  );
  return text.replace(/\s+/g, " ").trim();
}

function applyModeToResult({
  mode,
  score,
  warnings,
  blockingReasons,
  manualSelectionConfirmed,
}: {
  mode: ContextQualityMode;
  score: number;
  warnings: string[];
  blockingReasons: string[];
  manualSelectionConfirmed: boolean;
}): Omit<ContextSelectionQuality, "signals"> {
  let nextScore = clampScore(score);
  let nextWarnings = unique(warnings);
  let nextBlockingReasons = unique(blockingReasons);
  const hardBlockingReasons = nextBlockingReasons.filter(isHardSafetyReason);
  const reviewBlockingReasons = nextBlockingReasons.filter(
    (reason) => !isHardSafetyReason(reason),
  );

  if (manualSelectionConfirmed && reviewBlockingReasons.length > 0) {
    nextWarnings = unique([
      ...nextWarnings,
      ...reviewBlockingReasons.map(
        (reason) => `Manual selection override: ${reason}`,
      ),
    ]);
    nextBlockingReasons = hardBlockingReasons;
    nextScore = Math.max(nextScore, 58);
  }

  if (mode === "advisory" && reviewBlockingReasons.length > 0) {
    nextWarnings = unique([
      ...nextWarnings,
      ...reviewBlockingReasons.map((reason) => `Advisory mode: ${reason}`),
    ]);
    nextBlockingReasons = hardBlockingReasons;
    nextScore = Math.max(nextScore, 52);
  }

  if (mode === "strict" && nextWarnings.length > 0 && nextScore < 62) {
    nextBlockingReasons = unique([
      ...nextBlockingReasons,
      "Strict context safety mode blocks low-score warning selections.",
    ]);
  }

  const status: ContextSelectionQualityStatus =
    nextBlockingReasons.length > 0
      ? "blocked"
      : nextWarnings.length > 0 || nextScore < 78
        ? "warning"
        : "ready";

  return {
    status,
    score: nextScore,
    warnings: nextWarnings,
    blockingReasons: nextBlockingReasons,
    requiredManualReview:
      status === "blocked" || (mode === "strict" && status === "warning"),
  };
}

function isHardSafetyReason(reason: string) {
  const text = reason.toLowerCase();

  return (
    text.includes("unsafe/out-of-scope") ||
    text.includes("unsafe or out-of-scope") ||
    text.includes("outside the project") ||
    text.includes("outside project") ||
    text.includes("outside workspace") ||
    text.includes("path traversal") ||
    text.includes("protected path") ||
    text.includes("requested path escapes") ||
    text.includes("secret or .env content request") ||
    text.includes("secret-like file") ||
    text.includes("prompt-injection request") ||
    text.includes("destructive project-wide") ||
    text.includes("../") ||
    text.includes("..\\")
  );
}

function hasHardSafetyPathSignal(rawTask: string, rejectedPaths: string[]) {
  const text = [rawTask, ...rejectedPaths].join(" ").toLowerCase();

  return (
    /(^|[\s"'`([{])\.\.(?:[\\/]|$)/.test(text) ||
    text.includes("unsafe/out-of-scope") ||
    text.includes("unsafe or out-of-scope") ||
    text.includes("outside the project") ||
    text.includes("outside project") ||
    text.includes("outside workspace") ||
    text.includes("path traversal") ||
    text.includes("requested path escapes")
  );
}

export function evaluateContextSelectionQuality(
  input: EvaluateContextSelectionQualityInput,
): ContextSelectionQuality {
  const area = String(input.effectiveTaskArea || "general") as TaskArea;
  const requestedArea = getRequestedArea(input.requestedTaskType);
  const selectedFiles = getSelectedInventoryFiles(
    input.inventory,
    input.fileSelection,
  );
  const createTargets = getSelectedCreateTargets(input.fileSelection);
  const createTargetCount = createTargets.length;
  const hasCreateTarget = createTargetCount > 0;
  const warnings: string[] = [];
  const blockingReasons: string[] = [];
  const mode = input.contextQualityMode ?? "balanced";

  const codeTaskAreas = new Set([
    "ui",
    "backend",
    "fullstack",
    "bugfix",
    "refactor",
    "tests",
    "build",
  ]);
  const implementationIntent = isImplementationIntent(input.rawTask);
  const docsPrimaryIntent = isDocsPrimaryIntent(input.rawTask, area);
  const testPlanningIntent = isTestPlanningIntent(input.rawTask, area);
  const isCodeTask =
    (codeTaskAreas.has(area) || implementationIntent) && !testPlanningIntent;
  const hardTaskSafety = detectHardTaskSafetyIssue(input.rawTask);

  const hasEditableCode =
    selectedFiles.some(isEditableCodeLike) || hasCreateTarget;
  const hasUi =
    selectedFiles.some(isUiLike) ||
    createTargets.some((file) =>
      /(?:^|\/)(?:src\/)?(?:pages|app|routes|components)\//i.test(file.path),
    );
  const hasBackend = selectedFiles.some(isBackendLike);
  const docsConfigOnly =
    selectedFiles.length > 0 && selectedFiles.every(isDocsOrConfigOnly);
  const taskTokens = Array.from(new Set(tokenize(input.rawTask))).slice(0, 18);
  const overlapCounts = selectedFiles.map((file) =>
    getTaskOverlapCount(file, taskTokens),
  );
  const hasOverlappingFile =
    selectedFiles.some((file) => hasTaskOverlap(file, taskTokens)) ||
    createTargets.some((file) =>
      createTargetHasTaskOverlap(file.path, taskTokens),
    );
  const strongOverlapFileCount =
    overlapCounts.filter((count) => count >= 2).length +
    createTargets.filter((file) =>
      createTargetHasTaskOverlap(file.path, taskTokens),
    ).length;
  const genericOnly =
    selectedFiles.length > 0 &&
    !hasCreateTarget &&
    selectedFiles.every(isGenericShellOrGlobal);
  const selectionNotes = input.fileSelection.notes.join("\n").toLowerCase();
  const protectedBackendConstraint = hasProtectedBackendConstraint(
    input.rawTask,
    selectionNotes,
  );
  const explicitResolution = resolveExplicitFileMentions(
    getPositiveTaskTextForExplicitMentions(input.rawTask),
    input.inventory,
  );
  const explicitExistingPathTokens =
    explicitResolution.existingPaths.map(normalizeForCompare);
  const explicitMentionCount =
    explicitResolution.existingPaths.length +
    explicitResolution.missingPaths.length;
  const explicitMissingPathTokens =
    explicitResolution.missingPaths.map(normalizeForCompare);
  const explicitPathSelected =
    (explicitExistingPathTokens.length > 0 &&
      selectedFiles.some((file) =>
        explicitExistingPathTokens.includes(normalizeForCompare(file.path)),
      )) ||
    (explicitMissingPathTokens.length > 0 &&
      createTargets.some((file) =>
        explicitMissingPathTokens.includes(normalizeForCompare(file.path)),
      ));
  const plausibleCodeFileCount =
    selectedFiles.filter((file) => {
      if (!isEditableCodeLike(file)) return false;
      if (explicitExistingPathTokens.includes(normalizeForCompare(file.path)))
        return true;
      if (hasTaskOverlap(file, taskTokens)) return true;
      if (area === "ui" && isUiLike(file)) return true;
      if (area === "backend" && isBackendLike(file)) return true;
      if (area === "fullstack" && (isUiLike(file) || isBackendLike(file)))
        return true;
      if (
        (area === "bugfix" || area === "refactor" || area === "general") &&
        file.kind === "source"
      )
        return true;
      return false;
    }).length + createTargetCount;

  const selectedSecretFiles = input.fileSelection.selectedFiles.filter((file) =>
    isSecretLikePath(file.path),
  );

  let score = 62;

  if (hardTaskSafety.blocked) {
    blockingReasons.push(...hardTaskSafety.reasons);
    score -= 70;
  }

  if (selectedSecretFiles.length > 0) {
    blockingReasons.push(
      `Secret-like file(s) were selected and must not be included in a Task Pack: ${selectedSecretFiles
        .map((file) => file.path)
        .slice(0, 6)
        .join(", ")}.`,
    );
    score -= 70;
  }

  if (selectedFiles.length === 0 && !hasCreateTarget) {
    blockingReasons.push("No real project files were selected for this task.");
    score -= 52;
  } else {
    score += Math.min(18, (selectedFiles.length + createTargetCount) * 2);
  }

  if (hasCreateTarget) {
    score += 24;
    warnings.push(
      "Task includes planned create-and-edit file(s). Missing safe in-project paths are allowed because the user explicitly requested creation.",
    );
  }

  if (explicitPathSelected) {
    score += 34;
    if (
      hasCreateTarget &&
      createTargets.some((file) =>
        explicitMissingPathTokens.includes(normalizeForCompare(file.path)),
      )
    ) {
      warnings.push(
        "User-mentioned file path was accepted as a planned create target. ContextForge treated it as the strongest signal.",
      );
    } else {
      warnings.push(
        "User-mentioned file path was found and selected. ContextForge treated it as the strongest signal.",
      );
    }
  }

  if (hasEditableCode) score += 10;
  if (
    hasUi &&
    (area === "ui" || area === "fullstack" || requestedArea === "ui")
  )
    score += 12;
  if (
    hasBackend &&
    (area === "backend" || area === "fullstack" || implementationIntent)
  )
    score += 10;
  if (hasOverlappingFile) score += 10;
  if (strongOverlapFileCount > 0)
    score += Math.min(16, strongOverlapFileCount * 5);
  if (plausibleCodeFileCount > 0)
    score += Math.min(18, plausibleCodeFileCount * 4);

  if (docsPrimaryIntent && docsConfigOnly) {
    score += 12;
  }

  if (
    isCodeTask &&
    docsConfigOnly &&
    !docsPrimaryIntent &&
    !explicitPathSelected &&
    !hasCreateTarget
  ) {
    blockingReasons.push(
      "The task appears to require code/UI work, but the selected context contains only docs/config/data files.",
    );
    score -= 42;
  }

  if (
    isCodeTask &&
    !hasEditableCode &&
    !docsPrimaryIntent &&
    !hasCreateTarget
  ) {
    blockingReasons.push(
      "No editable source/style/test file was selected for a code task.",
    );
    score -= 35;
  }

  if (
    (area === "ui" || requestedArea === "ui") &&
    !hasUi &&
    !explicitPathSelected &&
    !docsPrimaryIntent &&
    !hasCreateTarget
  ) {
    if (hasEditableCode) {
      warnings.push(
        "No clear UI page/component/style file was selected, but editable source files are present.",
      );
      score -= 12;
    } else {
      blockingReasons.push(
        "No UI page/component/style file was selected for a UI-related task.",
      );
      score -= 30;
    }
  }

  if (
    (area === "backend" || area === "fullstack") &&
    !hasBackend &&
    !explicitPathSelected &&
    !docsPrimaryIntent
  ) {
    if (hasEditableCode) {
      warnings.push(
        "No clear backend route/service file was selected. If this is frontend-only, document the expected API contract instead of inventing server files.",
      );
      score -= 10;
    } else {
      blockingReasons.push(
        "No source file that could support backend/full-stack work was selected.",
      );
      score -= 28;
    }
  }

  if (requestedArea !== "general" && requestedArea !== area) {
    warnings.push(
      `Selected task type is "${input.requestedTaskType}", but ContextForge inferred "${area}". Review this before generation.`,
    );
    score -= 6;
  }

  if (input.fileSelection.usedFallback) {
    warnings.push(
      "File selection used fallback logic. The selection is allowed when the ranked files look plausible, but review it if the task is high-risk.",
    );
    score -= mode === "strict" ? 22 : 12;
  }

  if (
    selectionNotes.includes("invalid or empty json") ||
    selectionNotes.includes("ollama file selector failed")
  ) {
    warnings.push(
      "AI file selector failed or returned invalid output; ranked fallback context was used instead.",
    );
    score -= mode === "strict" ? 35 : 24;
  }

  if (
    input.fileSelection.selectedFiles.some(
      (file) => file.usage === "inspect-and-edit" && file.confidence < 0.55,
    )
  ) {
    warnings.push(
      "One or more edit targets have low selector confidence. Treat them as manual-review candidates instead of high-confidence context.",
    );
    score -= mode === "strict" ? 24 : 16;
  }

  if (
    taskTokens.length >= 2 &&
    !hasOverlappingFile &&
    isCodeTask &&
    !explicitPathSelected &&
    !hasCreateTarget
  ) {
    if (plausibleCodeFileCount > 0) {
      warnings.push(
        "Selected files do not strongly match the task words, but they have plausible technical roles for this task.",
      );
      score -= 10;
    } else {
      blockingReasons.push(
        "Selected files do not clearly match the meaningful words from the task or the dynamic inventory hints.",
      );
      score -= 28;
    }
  }

  if (
    genericOnly &&
    isCodeTask &&
    !explicitPathSelected &&
    !docsPrimaryIntent &&
    !hasCreateTarget
  ) {
    if (hasOverlappingFile) {
      warnings.push(
        "Selected context is mostly generic/global, but it overlaps with the task. Consider adding a more specific page/component/service if available.",
      );
      score -= 12;
    } else {
      blockingReasons.push(
        "Selected context looks generic/global only. A specific page, component, service, route, or state file may be missing.",
      );
      score -= 30;
    }
  }

  if (selectedFiles.length > 12 && mode !== "advisory") {
    warnings.push(
      "Many files were selected. Consider using Context Composer to keep the Task Pack focused.",
    );
    score -= 5;
  }

  if (explicitMentionCount > 0 && !explicitPathSelected && !hasCreateTarget) {
    if (explicitResolution.existingPaths.length > 0) {
      blockingReasons.push(
        "The task mentions an explicit file path that exists in inventory, but it was not selected as context.",
      );
      score -= 36;
    } else {
      blockingReasons.push(
        "The task mentions an explicit file path, but ContextForge could not match it to the project inventory.",
      );
      score -= 28;
    }
  }

  if (
    hasHardSafetyPathSignal(
      input.rawTask,
      input.fileSelection.rejectedModelPaths,
    )
  ) {
    blockingReasons.push(
      "Unsafe/out-of-scope path was requested. ContextForge will not create, modify, or include files outside the selected project.",
    );
    score -= 45;
  }

  if (input.fileSelection.usedFallback) {
    score = Math.min(score, mode === "advisory" ? 92 : mode === "strict" ? 84 : 88);
  }

  if (
    selectionNotes.includes("invalid or empty json") ||
    selectionNotes.includes("ollama file selector failed")
  ) {
    score = Math.min(score, mode === "advisory" ? 78 : mode === "strict" ? 62 : 70);
  }

  const result = applyModeToResult({
    mode,
    score,
    warnings,
    blockingReasons,
    manualSelectionConfirmed: Boolean(input.manualSelectionConfirmed),
  });

  return {
    ...result,
    signals: buildQualitySignals({
      selectedFiles,
      score: result.score,
      warnings: result.warnings,
      blockingReasons: result.blockingReasons,
      hasEditableCode,
      hasOverlappingFile,
      strongOverlapFileCount,
      plausibleCodeFileCount,
      genericOnly,
      explicitPathSelected,
      docsConfigOnly,
      docsPrimaryIntent,
      isCodeTask,
      hasBackend,
      protectedBackendConstraint,
      createTargetCount,
    }),
  };
}
