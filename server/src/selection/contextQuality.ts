import type { ProjectInventory, ProjectInventoryFile } from "../scanner/projectInventoryScanner.js";
import type { TaskArea } from "../ollama/taskIntentAnalyzer.js";
import type { TaskFileSelection } from "../ollama/taskFileSelector.js";
import { resolveExplicitFileMentions } from "./explicitFileMentions.js";

export type ContextSelectionQualityStatus = "ready" | "warning" | "blocked";
export type ContextQualityMode = "advisory" | "balanced" | "strict";

export interface ContextSelectionQuality {
    status: ContextSelectionQualityStatus;
    score: number;
    warnings: string[];
    blockingReasons: string[];
    requiredManualReview: boolean;
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
    "the", "and", "for", "from", "this", "that", "with", "make", "change", "fix", "add",
    "remove", "update", "current", "existing", "new", "better", "more", "less", "page", "file",
    "files", "component", "components", "project", "app", "src", "need", "needs", "should", "please",
    "нужно", "надо", "мне", "сделать", "сделай", "изменить", "измени", "добавить", "добавь",
    "исправить", "исправь", "чтобы", "это", "как", "что", "там", "для", "при", "или", "если",
    "странице", "страница", "файл", "файлы", "проект", "программа", "программе", "текущий", "текущую"
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

    if (selected.includes("ui") || selected.includes("ux") || selected.includes("front")) return "ui";
    if (selected.includes("backend") || selected.includes("server") || selected.includes("api")) return "backend";
    if (selected.includes("fullstack") || selected.includes("full-stack")) return "fullstack";
    if (selected.includes("build") || selected.includes("config")) return "build";
    if (selected.includes("docs")) return "docs";
    if (selected.includes("test")) return "tests";
    if (selected.includes("bugfix")) return "bugfix";
    if (selected.includes("refactor")) return "refactor";

    return "general";
}

function getSelectedInventoryFiles(inventory: ProjectInventory, selection: TaskFileSelection) {
    const inventoryByPath = new Map(
        inventory.files.map((file) => [normalizeForCompare(file.path), file])
    );

    return selection.selectedFiles
        .map((file) => inventoryByPath.get(normalizeForCompare(file.path)))
        .filter((file): file is ProjectInventoryFile => Boolean(file));
}

function getFileText(file: ProjectInventoryFile) {
    return normalizeForCompare([
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

function hasTaskOverlap(file: ProjectInventoryFile, tokens: string[]) {
    if (tokens.length === 0) return false;
    const text = getFileText(file);
    return tokens.some((token) => text.includes(token));
}

function getTaskOverlapCount(file: ProjectInventoryFile, tokens: string[]) {
    const text = getFileText(file);
    return tokens.reduce((count, token) => count + (text.includes(token) ? 1 : 0), 0);
}

function isDocsOrConfigOnly(file: ProjectInventoryFile) {
    return file.kind === "docs" || file.kind === "config" || file.kind === "data" || file.kind === "runtime";
}

function isEditableCodeLike(file: ProjectInventoryFile) {
    return file.kind === "source" || file.kind === "style" || file.kind === "test";
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
        ["app.tsx", "app.jsx", "app.js", "main.tsx", "main.jsx", "index.tsx", "index.jsx"].includes(name)
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
        "implement", "connect", "integrate", "add feature", "build feature", "create feature", "wire", "hook up",
        "change ui", "change interface", "replace", "render", "show", "display", "fetch", "call api", "external api",
        "реализ", "подключ", "интегр", "добав", "сделать", "замен", "вывести", "показ", "получать", "запрос", "через api", "внешн"
    ]);
}

function isDocsPrimaryIntent(rawTask: string, area: string) {
    const docsIntent = includesAny(rawTask, [
        "readme", "docs", "documentation", "guide", "manual", "how to run", "setup", "commands",
        "ридми", "документац", "инструкц", "описать команды", "команды запуска", "запуска проекта"
    ]);

    if (!docsIntent) return false;
    if (isImplementationIntent(rawTask) && includesAny(rawTask, ["api", "апи", "интерфейс", "program", "программ", "реализ", "подключ", "интегр"])) return false;
    return area === "docs" || docsIntent;
}

function clampScore(value: number) {
    return Math.min(100, Math.max(0, Math.round(value)));
}

function unique(values: string[]) {
    return Array.from(new Set(values.filter(Boolean)));
}

function getPositiveTaskTextForExplicitMentions(rawTask: string) {
    let text = rawTask;
    const normalized = rawTask.replace(/[—–]/g, " — ");
    const phrases: string[] = [];

    const afterRegexes = [
        /(?:не\s+(?:менять|меняй|трогать|трогай|лезь|лезть|редактировать|редактируй|изменять|изменяй))\s+(?:в\s+|к\s+)?([^.!?\n—]{1,120})/gi,
        /(?:do\s+not|don't|dont)\s+(?:change|touch|edit|modify)\s+([^.!?\n—]{1,120})/gi,
        /(?:without\s+(?:changing|touching|editing|modifying))\s+([^.!?\n—]{1,120})/gi
    ];
    const beforeRegexes = [
        /([^.!?\n—]{1,160})\s+не\s+(?:менять|трогать|редактировать|изменять)/gi,
        /([^.!?\n—]{1,160})\s+(?:do\s+not|don't|dont)\s+(?:change|touch|edit|modify)/gi
    ];

    for (const regex of afterRegexes) {
        for (const match of normalized.matchAll(regex)) {
            const phrase = String(match[1] ?? "").split(/[.!?\n—]/)[0].trim();
            if (phrase) phrases.push(phrase);
        }
    }

    for (const regex of beforeRegexes) {
        for (const match of normalized.matchAll(regex)) {
            const raw = String(match[1] ?? "");
            const phrase = (raw.split(/[.;!?\n—]/).pop() ?? raw).split(/(?:^|\s)(?:но|but|however)(?:\s|$)/gi).pop()?.trim() ?? "";
            // Skip positive task clauses such as "improve navigation and do not change other files".
            if (/(?:улучш|сдел|замен|добав|реализ|подключ|исправ|передел)/i.test(phrase)
                || /\b(?:improve|make|replace|add|implement|connect|fix|change)\b/i.test(phrase)) continue;
            if (phrase) phrases.push(phrase);
        }
    }

    for (const phrase of Array.from(new Set(phrases))) {
        const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
        text = text.replace(new RegExp(escaped, "gi"), " ");
    }

    text = text.replace(/(?:но|but)\s+(?:не\s+)?(?:меняй|трогай|лезь|change|touch|edit)[^.!?\n—]{0,160}/gi, " ");
    return text.replace(/\s+/g, " ").trim();
}

function applyModeToResult({
    mode,
    score,
    warnings,
    blockingReasons,
    manualSelectionConfirmed
}: {
    mode: ContextQualityMode;
    score: number;
    warnings: string[];
    blockingReasons: string[];
    manualSelectionConfirmed: boolean;
}): ContextSelectionQuality {
    let nextScore = clampScore(score);
    let nextWarnings = unique(warnings);
    let nextBlockingReasons = unique(blockingReasons);

    if (manualSelectionConfirmed && nextBlockingReasons.length > 0) {
        nextWarnings = unique([
            ...nextWarnings,
            ...nextBlockingReasons.map((reason) => `Manual selection override: ${reason}`)
        ]);
        nextBlockingReasons = [];
        nextScore = Math.max(nextScore, 58);
    }

    if (mode === "advisory" && nextBlockingReasons.length > 0) {
        nextWarnings = unique([
            ...nextWarnings,
            ...nextBlockingReasons.map((reason) => `Advisory mode: ${reason}`)
        ]);
        nextBlockingReasons = [];
        nextScore = Math.max(nextScore, 52);
    }

    if (mode === "strict" && nextWarnings.length > 0 && nextScore < 62) {
        nextBlockingReasons = unique([
            ...nextBlockingReasons,
            "Strict context safety mode blocks low-score warning selections."
        ]);
    }

    const status: ContextSelectionQualityStatus = nextBlockingReasons.length > 0
        ? "blocked"
        : nextWarnings.length > 0 || nextScore < 78
            ? "warning"
            : "ready";

    return {
        status,
        score: nextScore,
        warnings: nextWarnings,
        blockingReasons: nextBlockingReasons,
        requiredManualReview: status === "blocked" || (mode === "strict" && status === "warning")
    };
}

export function evaluateContextSelectionQuality(input: EvaluateContextSelectionQualityInput): ContextSelectionQuality {
    const area = String(input.effectiveTaskArea || "general") as TaskArea;
    const requestedArea = getRequestedArea(input.requestedTaskType);
    const selectedFiles = getSelectedInventoryFiles(input.inventory, input.fileSelection);
    const warnings: string[] = [];
    const blockingReasons: string[] = [];
    const mode = input.contextQualityMode ?? "balanced";

    const codeTaskAreas = new Set(["ui", "backend", "fullstack", "bugfix", "refactor", "tests", "build"]);
    const implementationIntent = isImplementationIntent(input.rawTask);
    const docsPrimaryIntent = isDocsPrimaryIntent(input.rawTask, area);
    const isCodeTask = codeTaskAreas.has(area) || implementationIntent;

    const hasEditableCode = selectedFiles.some(isEditableCodeLike);
    const hasUi = selectedFiles.some(isUiLike);
    const hasBackend = selectedFiles.some(isBackendLike);
    const docsConfigOnly = selectedFiles.length > 0 && selectedFiles.every(isDocsOrConfigOnly);
    const taskTokens = Array.from(new Set(tokenize(input.rawTask))).slice(0, 18);
    const overlapCounts = selectedFiles.map((file) => getTaskOverlapCount(file, taskTokens));
    const hasOverlappingFile = selectedFiles.some((file) => hasTaskOverlap(file, taskTokens));
    const strongOverlapFileCount = overlapCounts.filter((count) => count >= 2).length;
    const genericOnly = selectedFiles.length > 0 && selectedFiles.every(isGenericShellOrGlobal);
    const selectionNotes = input.fileSelection.notes.join("\n").toLowerCase();
    const explicitResolution = resolveExplicitFileMentions(getPositiveTaskTextForExplicitMentions(input.rawTask), input.inventory);
    const explicitExistingPathTokens = explicitResolution.existingPaths.map(normalizeForCompare);
    const explicitMentionCount = explicitResolution.existingPaths.length + explicitResolution.missingPaths.length;
    const explicitPathSelected = explicitExistingPathTokens.length > 0 && selectedFiles.some((file) => explicitExistingPathTokens.includes(normalizeForCompare(file.path)));
    const plausibleCodeFileCount = selectedFiles.filter((file) => {
        if (!isEditableCodeLike(file)) return false;
        if (explicitExistingPathTokens.includes(normalizeForCompare(file.path))) return true;
        if (hasTaskOverlap(file, taskTokens)) return true;
        if (area === "ui" && isUiLike(file)) return true;
        if (area === "backend" && isBackendLike(file)) return true;
        if (area === "fullstack" && (isUiLike(file) || isBackendLike(file))) return true;
        if ((area === "bugfix" || area === "refactor" || area === "general") && file.kind === "source") return true;
        return false;
    }).length;

    let score = 62;

    if (selectedFiles.length === 0) {
        blockingReasons.push("No real project files were selected for this task.");
        score -= 52;
    } else {
        score += Math.min(18, selectedFiles.length * 2);
    }

    if (explicitPathSelected) {
        score += 34;
        warnings.push("User-mentioned file path was found and selected. ContextForge treated it as the strongest signal.");
    }

    if (hasEditableCode) score += 10;
    if (hasUi && (area === "ui" || area === "fullstack" || requestedArea === "ui")) score += 12;
    if (hasBackend && (area === "backend" || area === "fullstack" || implementationIntent)) score += 10;
    if (hasOverlappingFile) score += 10;
    if (strongOverlapFileCount > 0) score += Math.min(16, strongOverlapFileCount * 5);
    if (plausibleCodeFileCount > 0) score += Math.min(18, plausibleCodeFileCount * 4);

    if (docsPrimaryIntent && docsConfigOnly) {
        score += 12;
    }

    if (isCodeTask && docsConfigOnly && !docsPrimaryIntent && !explicitPathSelected) {
        blockingReasons.push("The task appears to require code/UI work, but the selected context contains only docs/config/data files.");
        score -= 42;
    }

    if (isCodeTask && !hasEditableCode && !docsPrimaryIntent) {
        blockingReasons.push("No editable source/style/test file was selected for a code task.");
        score -= 35;
    }

    if ((area === "ui" || requestedArea === "ui") && !hasUi && !explicitPathSelected && !docsPrimaryIntent) {
        if (hasEditableCode) {
            warnings.push("No clear UI page/component/style file was selected, but editable source files are present.");
            score -= 12;
        } else {
            blockingReasons.push("No UI page/component/style file was selected for a UI-related task.");
            score -= 30;
        }
    }

    if ((area === "backend" || area === "fullstack") && !hasBackend && !explicitPathSelected && !docsPrimaryIntent) {
        if (hasEditableCode) {
            warnings.push("No clear backend route/service file was selected. If this is frontend-only, document the expected API contract instead of inventing server files.");
            score -= 10;
        } else {
            blockingReasons.push("No source file that could support backend/full-stack work was selected.");
            score -= 28;
        }
    }

    if (requestedArea !== "general" && requestedArea !== area) {
        warnings.push(`Selected task type is "${input.requestedTaskType}", but ContextForge inferred "${area}". Review this before generation.`);
        score -= 6;
    }

    if (input.fileSelection.usedFallback) {
        warnings.push("File selection used fallback logic. The selection is allowed when the ranked files look plausible, but review it if the task is high-risk.");
        score -= mode === "strict" ? 10 : 4;
    }

    if (selectionNotes.includes("invalid or empty json") || selectionNotes.includes("ollama file selector failed")) {
        warnings.push("AI file selector failed or returned invalid output; ranked fallback context was used instead.");
        score -= mode === "strict" ? 10 : 5;
    }

    if (taskTokens.length >= 2 && !hasOverlappingFile && isCodeTask && !explicitPathSelected) {
        if (plausibleCodeFileCount > 0) {
            warnings.push("Selected files do not strongly match the task words, but they have plausible technical roles for this task.");
            score -= 10;
        } else {
            blockingReasons.push("Selected files do not clearly match the meaningful words from the task or the dynamic inventory hints.");
            score -= 28;
        }
    }

    if (genericOnly && isCodeTask && !explicitPathSelected && !docsPrimaryIntent) {
        if (hasOverlappingFile) {
            warnings.push("Selected context is mostly generic/global, but it overlaps with the task. Consider adding a more specific page/component/service if available.");
            score -= 12;
        } else {
            blockingReasons.push("Selected context looks generic/global only. A specific page, component, service, route, or state file may be missing.");
            score -= 30;
        }
    }

    if (selectedFiles.length > 12 && mode !== "advisory") {
        warnings.push("Many files were selected. Consider using Context Composer to keep the Task Pack focused.");
        score -= 5;
    }

    if (explicitMentionCount > 0 && !explicitPathSelected) {
        if (explicitResolution.existingPaths.length > 0) {
            blockingReasons.push("The task mentions an explicit file path that exists in inventory, but it was not selected as context.");
            score -= 36;
        } else {
            blockingReasons.push("The task mentions an explicit file path, but ContextForge could not match it to the project inventory.");
            score -= 28;
        }
    }

    return applyModeToResult({
        mode,
        score,
        warnings,
        blockingReasons,
        manualSelectionConfirmed: Boolean(input.manualSelectionConfirmed)
    });
}
