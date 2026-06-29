import { getAppSettings } from "../settings/settingsService.js";
import { resolveExplicitFileMentions } from "../selection/explicitFileMentions.js";
import type {
    ProjectInventory,
    ProjectInventoryFile,
    ProjectInventoryFileKind
} from "../scanner/projectInventoryScanner.js";
import type { TaskIntentAnalysis, TaskArea } from "./taskIntentAnalyzer.js";

export type SelectedTaskFileUsage =
    | "inspect-and-edit"
    | "inspect-only"
    | "asset-reference"
    | "config-reference";

export interface SelectedTaskFile {
    path: string;
    kind: ProjectInventoryFileKind;
    usage: SelectedTaskFileUsage;
    reason: string;
    confidence: number;
}

export type EffectiveTaskArea = TaskArea;
export type AssetMode = "none" | "mixed" | "primary";

export interface TaskFileSelection {
    selectedFiles: SelectedTaskFile[];
    rejectedModelPaths: string[];
    source: "ollama" | "fallback";
    usedFallback: boolean;
    durationMs: number;
    notes: string[];
    effectiveTaskArea: EffectiveTaskArea;
    assetMode: AssetMode;
    conflictNote?: string;
}

interface SelectTaskFilesInput {
    rawTask: string;
    taskType: string;
    targetTool: string;
    inventory: ProjectInventory;
    taskIntent?: TaskIntentAnalysis;
    settings?: Awaited<ReturnType<typeof getAppSettings>>;
}

interface OllamaGenerateResponse {
    response?: string;
}

interface TokenContext {
    strongTokens: string[];
    broadTokens: string[];
    explicitExistingPaths: string[];
    explicitMissingPaths: string[];
    routeMentions: string[];
}

const MAX_SELECTED_FILES = 14;
const MIN_MODEL_SELECTED_FILES = 3;
const MAX_INVENTORY_FILES_FOR_PROMPT = 700;

const VALID_USAGES: SelectedTaskFileUsage[] = [
    "inspect-and-edit",
    "inspect-only",
    "asset-reference",
    "config-reference"
];

const WEAK_TASK_TOKENS = new Set([
    "сделай", "улучши", "улучшенный", "измени", "добавь", "исправь", "переделай",
    "нужно", "надо", "мне", "чтобы", "если", "нет", "это", "там", "как", "для",
    "при", "после", "перед", "текущую", "полностью", "with", "make", "change",
    "improve", "better", "add", "fix", "update", "current", "existing"
]);

const BROAD_PATH_TOKENS = new Set([
    "src", "app", "apps", "client", "server", "source", "file", "files", "component",
    "components", "page", "pages", "layout", "layouts", "style", "styles", "index",
    "main", "ui", "view", "views", "screen", "screens", "common", "shared", "utils",
    "lib", "libs", "data", "types"
]);

function getDurationMs(startedAt: number) {
    return Date.now() - startedAt;
}

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

interface TaskConstraints {
    noBackendMutation: boolean;
    noFrontendMutation: boolean;
    onlyExplicitFiles: boolean;
    protectOtherPages: boolean;
    protectedFileTerms: string[];
    notes: string[];
}


function uniqueNormalizedTokens(values: string[]) {
    const seen = new Set<string>();
    const out: string[] = [];

    for (const value of values) {
        const token = normalizeForCompare(value).replace(/^[^a-zа-яё0-9]+|[^a-zа-яё0-9]+$/gi, "");
        if (!token || token.length < 3 || seen.has(token)) continue;
        seen.add(token);
        out.push(token);
    }

    return out;
}

const NEGATIVE_CONSTRAINT_STOP_WORDS = new Set([
    "не", "no", "not", "do", "dont", "don't", "менять", "меняй", "трогать", "трогай", "редактировать", "редактируй",
    "изменять", "изменяй", "modify", "change", "touch", "edit", "without", "keep", "and", "or", "the", "a", "an", "site", "page",
    "сайт", "сайта", "эту", "это", "там", "вот", "как", "или", "и", "а", "но", "при", "для", "по", "на", "остальные", "остальных",
    "страницы", "страниц", "файлы", "файл", "others", "other", "rest"
]);

function getNegativeConstraintPhrases(rawTask: string) {
    const text = normalizeForCompare(rawTask).replace(/[—–]/g, " — ");
    const phrases: string[] = [];

    const cleanPhrase = (value: string) => value
        .replace(/\s+/g, " ")
        .replace(/^(?:в|in|into|к|to)\s+/i, "")
        .replace(/\b(?:не\s+(?:меняй|менять|трогай|трогать|лезь|лезть|редактируй|редактировать|изменяй|изменять)|do\s+not|don't|dont|without|keep)\b.*$/i, "")
        .split(/[.!?\n—]/)[0]
        .trim();

    const afterNegativeRegexes = [
        /(?:не\s+(?:менять|меняй|трогать|трогай|лезь|лезть|редактировать|редактируй|изменять|изменяй))\s+(?:в\s+|к\s+)?([^.!?\n—]{1,120})/gi,
        /(?:do\s+not|don't|dont)\s+(?:change|touch|edit|modify)\s+([^.!?\n—]{1,120})/gi,
        /(?:without\s+(?:changing|touching|editing|modifying))\s+([^.!?\n—]{1,120})/gi,
        /(?:keep)\s+([^.!?\n—]{1,90})\s+(?:unchanged|intact)/gi
    ];

    // Handles natural Russian order: "шапку, футер и контакты не трогать".
    // Keep only the last clause before the negation so positive task text earlier in the sentence
    // does not become protected by accident.
    const beforeNegativeRegexes = [
        /([^.!?\n—]{1,160})\s+не\s+(?:менять|трогать|редактировать|изменять)/gi,
        /([^.!?\n—]{1,160})\s+(?:do\s+not|don't|dont)\s+(?:change|touch|edit|modify)/gi
    ];

    for (const regex of afterNegativeRegexes) {
        for (const match of text.matchAll(regex)) {
            const cleaned = cleanPhrase(match[1] ?? "");
            if (cleaned) phrases.push(cleaned);
        }
    }

    for (const regex of beforeNegativeRegexes) {
        for (const match of text.matchAll(regex)) {
            const raw = String(match[1] ?? "");
            const clause = raw.split(/[.;!?\n—]/).pop()?.trim() ?? raw.trim();
            const afterBut = clause.split(/\b(?:но|but|however)\b/gi).pop()?.trim() ?? clause;
            // Skip positive task clauses such as "improve navigation and do not change other files".
            if (/(?:улучш|сдел|замен|добав|реализ|подключ|исправ|передел|improve|make|replace|add|implement|connect|fix|change)/i.test(afterBut)) continue;
            const cleaned = cleanPhrase(afterBut);
            if (cleaned) phrases.push(cleaned);
        }
    }

    return uniqueStrings(phrases).slice(0, 12);
}

function getPositiveTaskText(rawTask: string) {
    let text = rawTask;

    for (const phrase of getNegativeConstraintPhrases(rawTask)) {
        if (!phrase) continue;
        const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
        text = text.replace(new RegExp(escaped, "gi"), " ");
    }

    // Also remove common trailing "only do X" constraint tails from target scoring.
    text = text.replace(/(?:но|but)\s+(?:не\s+)?(?:меняй|трогай|лезь|change|touch|edit)[^.!?\n—]{0,160}/gi, " ");
    return text.replace(/\s+/g, " ").trim();
}

function extractNegativeConstraintTerms(rawTask: string) {
    const chunks = getNegativeConstraintPhrases(rawTask);

    const tokens = uniqueNormalizedTokens(chunks.flatMap((chunk) => chunk.split(/[^a-zа-яё0-9_.\/-]+/i)))
        .filter((token) => !NEGATIVE_CONSTRAINT_STOP_WORDS.has(token))
        .filter((token) => token.length <= 32)
        .slice(0, 24);

    const expanded = new Set(tokens);
    for (const token of tokens) {
        // Universal UI/website vocabulary, not business-domain project rules.
        if (token.startsWith("шап") || token === "header") ["header", "nav", "navigation", "navbar", "topbar"].forEach((item) => expanded.add(item));
        if (token.startsWith("фут") || token.startsWith("footer")) ["footer", "foot"].forEach((item) => expanded.add(item));
        if (token.startsWith("контакт") || token.startsWith("contact")) ["contact", "contacts", "контакт", "контакты"].forEach((item) => expanded.add(item));
        if (token.startsWith("достав") || token.startsWith("deliver")) ["delivery", "deliver", "достав", "доставка"].forEach((item) => expanded.add(item));
        if (token.startsWith("роут") || token.startsWith("route")) ["route", "routes", "routing", "роут", "роуты"].forEach((item) => expanded.add(item));
        if (token.startsWith("таблиц") || token.startsWith("table")) ["table", "tables", "таблица", "таблицы"].forEach((item) => expanded.add(item));
        if (token.startsWith("ридми") || token === "readme") ["readme", "readme.md", "docs"].forEach((item) => expanded.add(item));
        if (token === "api" || token === "апи") ["api", "endpoint", "service"].forEach((item) => expanded.add(item));
        if (token.startsWith("юрид") || token.startsWith("legal")) ["policy", "privacy", "consent", "terms", "legal"].forEach((item) => expanded.add(item));
        if (token.startsWith("стил") || token === "style" || token === "styles") ["style", "styles", "css", "стил"].forEach((item) => expanded.add(item));
    }

    return Array.from(expanded);
}

function mentionsOnlyExplicitFiles(rawTask: string) {
    return includesAny(rawTask, [
        "не менять остальные файлы",
        "не меняй остальные файлы",
        "не трогать остальные файлы",
        "не трогай остальные файлы",
        "остальные файлы не трогать",
        "остальные файлы не менять",
        "другие файлы не трогать",
        "другие файлы не менять",
        "только этот файл",
        "только этот компонент",
        "only this file",
        "this file only",
        "do not change other files",
        "don't change other files",
        "do not touch other files",
        "don't touch other files",
        "leave other files alone"
    ]);
}

function mentionsOtherPagesProtected(rawTask: string) {
    return includesAny(rawTask, [
        "не менять остальные страницы",
        "не меняй остальные страницы",
        "не трогать остальные страницы",
        "не трогай остальные страницы",
        "остальные страницы не трогать",
        "остальные страницы не менять",
        "другие страницы не трогать",
        "другие страницы не менять",
        "остальные страницы",
        "другие страницы",
        "юридические страницы не трогать",
        "юридические страницы не менять",
        "do not change other pages",
        "don't change other pages",
        "do not touch other pages",
        "don't touch other pages",
        "other pages",
        "legal pages"
    ]);
}

function getTaskConstraints(input: SelectTaskFilesInput): TaskConstraints {
    const rawTask = input.rawTask;

    const noBackendMutation = includesAny(rawTask, [
        "do not change backend",
        "don't change backend",
        "do not modify backend",
        "don't modify backend",
        "keep backend api unchanged",
        "backend api unchanged",
        "keep api unchanged",
        "api unchanged",
        "without changing backend",
        "without backend changes",
        "frontend only",
        "front-end only",
        "ui only",
        "client only",
        "do not touch backend",
        "don't touch backend",
        "do not edit backend",
        "don't edit backend",
        "do not edit api",
        "don't edit api",
        "do not edit server",
        "don't edit server",
        "не редактировать backend",
        "не редактируй backend",
        "не редактировать api",
        "не редактируй api",
        "не редактировать бэк",
        "не редактируй бэк",
        "не редактировать бэкенд",
        "не редактируй бэкенд",
        "не меняй backend",
        "не менять backend",
        "не трогай backend",
        "не трогать backend",
        "не менять backend api",
        "не менять api",
        "не меняй api",
        "api не менять",
        "api не трогать",
        "апи не менять",
        "апи не трогать",
        "не менять бэкенд",
        "не трогать бэкенд",
        "не трогай бэкенд",
        "не менять бекенд",
        "не трогать бекенд",
        "не трогай бэк",
        "не трогать бэк",
        "бэк не трогать",
        "бэкенд не трогать",
        "только ui",
        "только ux",
        "только фронт",
        "только frontend",
        "только визуал",
        "только интерфейс"

    ]);

    const noFrontendMutation = includesAny(rawTask, [
        "do not change frontend",
        "don't change frontend",
        "do not change ui",
        "don't change ui",
        "backend only",
        "server only",
        "api only",
        "without ui changes",
        "without frontend changes",
        "не менять frontend",
        "не трогать frontend",
        "не менять фронт",
        "не трогать фронт",
        "не менять ui",
        "не трогать ui",
        "не менять интерфейс",
        "без изменений ui",
        "без изменений интерфейса",
        "только backend",
        "только бэкенд",
        "только бекенд",
        "только api",
        "только сервер"
    ]);

    const onlyExplicitFiles = mentionsOnlyExplicitFiles(rawTask);
    const protectOtherPages = mentionsOtherPagesProtected(rawTask);
    const protectedFileTerms = extractNegativeConstraintTerms(rawTask);

    return {
        noBackendMutation,
        noFrontendMutation,
        onlyExplicitFiles,
        protectOtherPages,
        protectedFileTerms,
        notes: [
            noBackendMutation
                ? "Constraint detected: backend/API files should not be selected as edit targets."
                : "",
            noFrontendMutation
                ? "Constraint detected: UI/frontend files should not be selected as edit targets."
                : "",
            onlyExplicitFiles
                ? "Constraint detected: user asked not to change other files; explicit file mentions are treated as the edit boundary."
                : "",
            protectOtherPages
                ? "Constraint detected: user asked not to change other pages; unrelated page/layout files are protected."
                : "",
            protectedFileTerms.length > 0
                ? `Constraint detected: protected terms from task: ${protectedFileTerms.slice(0, 10).join(", ")}.`
                : ""
        ].filter(Boolean)
    };
}

function normalizeConfidence(value: unknown) {
    const confidence = Number(value);
    return Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.5;
}

function normalizeString(value: unknown, fallback = "") {
    const normalized = String(value ?? "").trim();
    return normalized || fallback;
}

function normalizeStringArray(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value
        .filter((item) => {
            const type = typeof item;
            return type === "string" || type === "number" || type === "boolean";
        })
        .map((item) => String(item).trim())
        .filter((item) => item.length > 0 && item !== "[object Object]")
        .slice(0, 50);
}

function isValidUsage(value: unknown): value is SelectedTaskFileUsage {
    return VALID_USAGES.includes(value as SelectedTaskFileUsage);
}

function tokenize(value: string) {
    return normalizeForCompare(value)
        .split(/[^a-zа-яё0-9_.\/-]+/i)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2);
}

function uniqueStrings(values: string[]) {
    return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function buildTaskText(input: SelectTaskFilesInput) {
    return [
        getPositiveTaskText(input.rawTask),
        input.taskType,
        input.targetTool,
        input.taskIntent?.taskArea ?? "",
        ...(input.taskIntent?.intentTags ?? []),
        ...(input.taskIntent?.domainTerms ?? []),
        ...(input.taskIntent?.mentionedEntities ?? []),
        ...(input.taskIntent?.fileRoleHints ?? []),
        ...(input.taskIntent?.recommendedSearchTerms ?? [])
    ].join(" ");
}

function sanitizeUsageForFile(file: ProjectInventoryFile, requestedUsage: SelectedTaskFileUsage): SelectedTaskFileUsage {
    if (file.kind === "asset") return "asset-reference";
    if (file.kind === "config") return requestedUsage === "inspect-only" ? "inspect-only" : "config-reference";
    if (file.kind === "docs" || file.kind === "data" || file.kind === "runtime") return "inspect-only";
    if (requestedUsage === "asset-reference" || requestedUsage === "config-reference") return "inspect-and-edit";
    return requestedUsage;
}

function defaultUsageForFile(file: ProjectInventoryFile): SelectedTaskFileUsage {
    if (file.kind === "asset") return "asset-reference";
    if (file.kind === "config") return "config-reference";
    if (file.kind === "docs" || file.kind === "data" || file.kind === "runtime") return "inspect-only";
    return "inspect-and-edit";
}

function getSelectedTaskTypeArea(taskType: string): EffectiveTaskArea {
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

function scoreTaskArea(input: SelectTaskFilesInput) {
    const text = normalizeForCompare([
        getPositiveTaskText(input.rawTask),
        input.taskIntent?.taskArea ?? "",
        ...(input.taskIntent?.intentTags ?? []),
        ...(input.taskIntent?.fileRoleHints ?? [])
    ].join(" "));

    const scores: Record<EffectiveTaskArea, number> = {
        ui: 0,
        backend: 0,
        fullstack: 0,
        build: 0,
        bugfix: 0,
        refactor: 0,
        docs: 0,
        tests: 0,
        general: 0
    };
    const constraints = getTaskConstraints(input);
    const hasImplementationAction = includesAny(text, [
        "implement", "connect", "integrate", "wire", "hook up", "create", "add feature", "build feature",
        "replace", "render", "show", "display", "fetch", "call", "change", "edit", "modify",
        "реализ", "подключ", "интегр", "добав", "созд", "замен", "вывести", "показ", "получ", "запрос", "измен", "передел"
    ]);
    const docsAsSecondaryDeliverable = hasImplementationAction && includesAny(text, [
        "readme", "docs", "documentation", "guide", "manual", "документац", "ридми", "инструкц", "дальнейшей разработки"
    ]);

    const hasApi = includesAny(text, ["api", "апи", "endpoint", "эндпоинт", "route", "маршрут"]);
    const hasAuth = includesAny(text, ["auth", "authorization", "authentication", "login", "session", "token", "cookie", "авторизац", "логин", "сесс", "токен", "куки"]);
    const hasServer = includesAny(text, ["server", "backend", "database", "db", "service", "controller", "сервер", "серверный", "бэкенд", "бекенд", "база", "бд", "сервис"]);
    const hasUi = includesAny(text, ["ui", "ux", "screen", "page", "layout", "visual", "design", "style", "css", "button", "form", "input", "focus", "modal", "card", "navigation", "header", "frontend", "component", "экран", "страниц", "визуал", "дизайн", "кноп", "форма", "пол", "фокус", "модал", "карточ", "навигац", "шапк", "дороже", "чище", "деревян", "дефолт"]);

    if (hasApi || hasAuth || hasServer) scores.backend += 5;
    if (hasApi && hasAuth) scores.backend += 8;
    if (hasUi) scores.ui += 5;

    const positiveExplicitResolution = resolveExplicitFileMentions(getPositiveTaskText(input.rawTask), input.inventory);
    const positiveExplicitFiles = positiveExplicitResolution.existingPaths
        .map((pathValue) => findInventoryFile(input.inventory, pathValue))
        .filter(Boolean) as ProjectInventoryFile[];
    if (positiveExplicitFiles.some((file) => isClientUiPath(file.path))) scores.ui += 12;
    if (positiveExplicitFiles.some((file) => isBackendLeaningPath(file.path) || isClientApiBridgePath(file.path))) scores.backend += 8;
    if (extractRouteMentions(input.rawTask).length > 0 || includesAny(getPositiveTaskText(input.rawTask), ["на странице", "страница", "page", "route"])) scores.ui += 7;

    if (hasImplementationAction) {
        scores.general += 2;
        if (hasApi || hasServer || hasAuth) scores.backend += 8;
        if (hasUi) scores.ui += 6;
        if ((hasApi || hasServer || hasAuth) && (hasUi || includesAny(text, ["interface", "ui", "frontend", "компонент", "интерфейс", "экран", "страниц", "программ"]))) {
            scores.fullstack += 11;
        }
    }
    if (includesAny(text, ["build", "npm run build", "compile", "compilation", "bundl", "import", "imports", "module not found", "resolve", "alias", "tsconfig", "vite", "next build", "eslint", "typecheck", "typescript", "сборк", "билд", "компиляц", "импорт", "импортами", "путями", "алиас", "модул"])) scores.build += 9;
    if (includesAny(text, ["readme", "docs", "documentation", "guide", "manual", "instructions", "how to run", "setup", "onboarding", "документац", "ридми", "инструкц", "запуск", "запуска", "разработчик", "команды"])) scores.docs += docsAsSecondaryDeliverable ? 2 : 8;
    if (docsAsSecondaryDeliverable) scores.docs -= 4;
    if (includesAny(text, ["test", "tests", "unit", "e2e", "spec", "coverage", "jest", "vitest", "playwright", "тест", "тесты", "покрытие"])) scores.tests += 7;
    if (includesAny(text, ["bug", "fix", "broken", "error", "crash", "fails", "not working", "ошибка", "баг", "слом", "падает", "не работает", "краш", "исправь", "почини"])) scores.bugfix += 3;
    if (includesAny(text, ["refactor", "cleanup", "restructure", "рефактор", "почисти", "не меняй логику", "не меняй бизнес-логику"])) scores.refactor += 3;

    if (hasUi && (hasApi || hasServer) && includesAny(text, ["button", "form", "screen", "page", "показывает результат", "кноп", "форма", "экран", "страниц"]) && includesAny(text, ["api", "endpoint", "server", "route", "вызывает сервер", "сервер", "эндпоинт", "маршрут"])) {
        scores.fullstack += 12;
    }

    if (constraints.noBackendMutation) {
        scores.backend -= 12;
        scores.fullstack -= 16;

        if (hasUi) {
            scores.ui += 7;
        }
    }

    if (constraints.noFrontendMutation) {
        scores.ui -= 12;
        scores.fullstack -= 12;

        if (hasApi || hasServer) {
            scores.backend += 7;
        }
    }

    if (input.taskIntent?.taskArea && input.taskIntent.taskArea !== "general") {
        scores[input.taskIntent.taskArea] += input.taskIntent.confidence >= 0.65 ? 2.5 : 1.2;
    }

    const selectedArea = getSelectedTaskTypeArea(input.taskType);
    if (selectedArea !== "general") scores[selectedArea] += 4;

    return scores;
}

function getEffectiveTaskArea(input: SelectTaskFilesInput): EffectiveTaskArea {
    const scores = scoreTaskArea(input);
    const sorted = (Object.entries(scores) as Array<[EffectiveTaskArea, number]>).sort((a, b) => b[1] - a[1]);
    const [area, score] = sorted[0] ?? ["general", 0];
    return score > 0 ? area : "general";
}

function getConflictNote(input: SelectTaskFilesInput, effectiveTaskArea: EffectiveTaskArea) {
    const selectedArea = getSelectedTaskTypeArea(input.taskType);
    if (selectedArea === "general" || selectedArea === effectiveTaskArea) return undefined;
    return `Selected task type was "${input.taskType}", but the task text was inferred as "${effectiveTaskArea}".`;
}

function getAssetMode(input: SelectTaskFilesInput): AssetMode {
    const taskText = normalizeForCompare([getPositiveTaskText(input.rawTask), ...(input.taskIntent?.intentTags ?? []), ...(input.taskIntent?.fileRoleHints ?? [])].join(" "));
    const hasAssetIntent = includesAny(taskText, [
        "image", "picture", "photo", "asset", "logo", "icon", "favicon", "background", "wallpaper",
        "screenshot", "media", "banner", "cover", "artwork", "replace-image", "asset-change",
        "картин", "изображ", "фото", "логотип", "лого", "икон", "фон", "облож", "баннер", "медиа"
    ]);

    if (!hasAssetIntent) return "none";

    const hasNonAssetWork = includesAny(taskText, [
        "filter", "search", "sort", "select", "dropdown", "navigation", "button", "menu", "layout",
        "form", "table", "list", "grid", "catalog", "library", "collection", "api", "server",
        "logic", "state", "calculator", "design", "фильтр", "поиск", "сорт", "навигац",
        "кноп", "меню", "форма", "список", "каталог", "библиотек", "логик", "состояни",
        "калькулятор", "дизайн"
    ]);

    return hasNonAssetWork ? "mixed" : "primary";
}

function addSemanticTokenIfIncludes(target: Set<string>, text: string, patterns: string[], tokens: string[]) {
    if (patterns.some((pattern) => text.includes(pattern))) tokens.forEach((token) => target.add(token));
}

function buildSemanticTokens(input: SelectTaskFilesInput) {
    const text = normalizeForCompare(buildTaskText(input));
    const tokens = new Set<string>();

    // Universal technical/UI meanings only. Business-domain words are not hardcoded here;
    // they are taken dynamically from the user's task and real inventory textHints.
    addSemanticTokenIfIncludes(tokens, text, ["таблиц", "table"], ["table", "row", "rows", "grid"]);
    addSemanticTokenIfIncludes(tokens, text, ["спис", "list"], ["list", "items", "item", "row", "rows"]);
    addSemanticTokenIfIncludes(tokens, text, ["каталог", "catalog"], ["catalog", "catalogue", "list", "grid"]);
    addSemanticTokenIfIncludes(tokens, text, ["фильтр", "filter"], ["filter", "filters", "controls", "select", "dropdown"]);
    addSemanticTokenIfIncludes(tokens, text, ["поиск", "search"], ["search", "query"]);
    addSemanticTokenIfIncludes(tokens, text, ["сорт", "sort"], ["sort", "sorting", "order"]);
    addSemanticTokenIfIncludes(tokens, text, ["модал", "modal", "dialog"], ["modal", "dialog"]);
    addSemanticTokenIfIncludes(tokens, text, ["форма", "form", "input", "focus", "фокус"], ["form", "input", "field", "focus"]);
    addSemanticTokenIfIncludes(tokens, text, ["навигац", "navigation", "navbar"], ["nav", "navigation", "navbar", "topbar", "header", "menu"]);
    addSemanticTokenIfIncludes(tokens, text, ["кноп", "button"], ["button", "buttons", "actions"]);
    addSemanticTokenIfIncludes(tokens, text, ["главн", "homepage", "landing"], ["home", "homepage", "landing"]);
    addSemanticTokenIfIncludes(tokens, text, ["карточ", "card"], ["card", "cards", "item"]);
    addSemanticTokenIfIncludes(tokens, text, ["api", "апи", "endpoint", "route", "service", "интегр", "подключ"], ["api", "client", "service", "services", "route", "routes"]);
    addSemanticTokenIfIncludes(tokens, text, ["server", "backend", "бэкенд", "бекенд", "сервер"], ["server", "backend", "api", "route", "service"]);
    addSemanticTokenIfIncludes(tokens, text, ["database", "db", "schema", "база", "бд"], ["db", "database", "schema", "repository"]);
    addSemanticTokenIfIncludes(tokens, text, ["логотип", "лого", "logo"], ["logo", "brand"]);
    addSemanticTokenIfIncludes(tokens, text, ["favicon"], ["favicon", "icon"]);
    addSemanticTokenIfIncludes(tokens, text, ["картин", "изображ", "image", "picture", "photo"], ["image", "img", "picture", "photo", "asset", "assets"]);
    addSemanticTokenIfIncludes(tokens, text, ["фон", "background"], ["background", "hero"]);
    addSemanticTokenIfIncludes(tokens, text, ["баннер", "banner", "cover"], ["banner", "cover", "hero"]);
    addSemanticTokenIfIncludes(tokens, text, ["сборк", "build", "импорт", "import", "alias", "алиас", "tsconfig", "vite", "next", "eslint"], ["package", "config", "tsconfig", "vite", "next", "eslint", "layout", "page", "app"]);
    addSemanticTokenIfIncludes(tokens, text, ["readme", "docs", "инструкц", "запуск", "команды"], ["readme", "docs", "package", "config", "env", "docker"]);

    return Array.from(tokens);
}

function extractRouteMentions(rawTask: string) {
    const positiveText = getPositiveTaskText(rawTask);
    const routeRegex = /(?:^|[\s"'`(\[])(\/[a-zа-яё0-9_@()\[\]-]+(?:\/[a-zа-яё0-9_@()\[\]-]+)*)(?=$|[\s"'`),.;:!?\]])/gi;
    const routes: string[] = [];

    for (const match of positiveText.matchAll(routeRegex)) {
        const route = normalizePath(match[1] ?? "").toLowerCase();
        if (!route || route.includes("//")) continue;
        if (/\.[a-z0-9]+$/i.test(route)) continue;
        routes.push(route);
    }

    return uniqueStrings(routes).slice(0, 8);
}

function getRouteMentionSegments(routeMentions: string[]) {
    return uniqueStrings(routeMentions.flatMap((route) => tokenize(route).filter((token) => !BROAD_PATH_TOKENS.has(token))));
}

function buildTokenContext(input: SelectTaskFilesInput): TokenContext {
    const positiveTaskText = getPositiveTaskText(input.rawTask);
    const explicitResolution = resolveExplicitFileMentions(positiveTaskText, input.inventory);
    const explicitExistingPaths = explicitResolution.existingPaths;
    const explicitMissingPaths = explicitResolution.missingPaths;
    const routeMentions = extractRouteMentions(input.rawTask);
    const routeSegments = getRouteMentionSegments(routeMentions);

    const rawTokens = tokenize(positiveTaskText);
    const semanticTokens = buildSemanticTokens(input);
    const intentTokens = tokenize([
        ...(input.taskIntent?.domainTerms ?? []),
        ...(input.taskIntent?.mentionedEntities ?? []),
        ...(input.taskIntent?.recommendedSearchTerms ?? [])
    ].join(" ")).filter((token) => !extractNegativeConstraintTerms(input.rawTask).includes(token));
    const roleTokens = tokenize([
        input.taskType,
        input.targetTool,
        input.taskIntent?.taskArea ?? "",
        ...(input.taskIntent?.intentTags ?? []),
        ...(input.taskIntent?.fileRoleHints ?? [])
    ].join(" "));

    const strongTokens = uniqueStrings([...rawTokens, ...semanticTokens, ...intentTokens, ...routeSegments]).filter((token) => {
        if (WEAK_TASK_TOKENS.has(token)) return false;
        if (token.includes("/") || token.includes("\\")) return false;
        if (BROAD_PATH_TOKENS.has(token) && !semanticTokens.includes(token)) return false;
        return true;
    });

    const broadTokens = uniqueStrings(roleTokens).filter((token) => !strongTokens.includes(token));
    return { strongTokens, broadTokens, explicitExistingPaths, explicitMissingPaths, routeMentions };
}
function getPathSegments(pathValue: string) {
    return tokenize(pathValue);
}

function getStrongTokenMatchCount(filePath: string, strongTokens: string[]) {
    const normalizedPath = normalizeForCompare(filePath);
    const pathSegments = getPathSegments(filePath);
    let count = 0;

    for (const token of strongTokens) {
        if (pathSegments.includes(token) || normalizedPath.includes(token)) count += 1;
    }

    return count;
}

function hasAnyStrongMatch(filePath: string, strongTokens: string[]) {
    return getStrongTokenMatchCount(filePath, strongTokens) > 0;
}

function isClientUiPath(pathValue: string) {
    const filePath = normalizeForCompare(pathValue);
    const fileName = filePath.split("/").pop() ?? filePath;

    if (filePath.startsWith("client/")) return true;
    if (filePath.startsWith("frontend/")) return true;
    if (filePath.startsWith("web/")) return true;

    if (filePath.includes("/components/") || filePath.startsWith("src/components/")) return true;
    if (filePath.includes("/pages/") || filePath.startsWith("src/pages/")) return true;
    if (filePath.includes("/ui/") || filePath.includes("/styles/") || filePath.includes("/style/")) return true;

    if (["app.tsx", "app.jsx", "app.js", "app.mjs", "main.tsx", "main.jsx", "main.js", "index.tsx", "index.jsx", "index.js"].includes(fileName)) return true;

    // Treat Next/React app-router files as UI when they are route shell files or TSX/JSX helpers colocated with a route.
    // API route files are excluded by backend checks elsewhere.
    if (filePath.startsWith("src/app/") && ["page.tsx", "page.jsx", "layout.tsx", "layout.jsx", "template.tsx", "template.jsx", "loading.tsx", "loading.jsx", "error.tsx", "error.jsx"].includes(fileName)) {
        return true;
    }

    if (filePath.startsWith("src/app/") && (fileName.endsWith(".tsx") || fileName.endsWith(".jsx")) && !filePath.includes("/api/") && !fileName.startsWith("route.")) {
        return true;
    }

    return false;
}

function isBackendLeaningPath(pathValue: string) {
    const filePath = normalizeForCompare(pathValue);
    return filePath.includes("/server/") || filePath.startsWith("server/") || filePath.includes("/api/") || filePath.includes("/routes/") || filePath.includes("/route") || filePath.includes("/db/") || filePath.includes("/database/") || filePath.includes("/services/") || filePath.includes("/service/") || filePath.includes("/controllers/") || filePath.includes("/electron/") || filePath.endsWith("server.ts") || filePath.endsWith("server.js") || filePath.endsWith("index.ts") || filePath.endsWith("index.js");
}

function isClientApiBridgePath(pathValue: string) {
    const filePath = normalizeForCompare(pathValue);
    return filePath.endsWith("/api.ts") || filePath.endsWith("/api.js") || filePath.includes("/lib/api") || filePath.includes("/services/api") || filePath.includes("/cloudapi") || filePath.includes("/clientapi");
}

function isServerSidePath(pathValue: string) {
    const filePath = normalizeForCompare(pathValue);
    return filePath.startsWith("server/") || filePath.includes("/server/") || filePath.startsWith("backend/") || filePath.includes("/backend/");
}

function isLockFilePath(pathValue: string) {
    const fileName = normalizeForCompare(pathValue).split("/").pop() ?? "";
    return fileName === "package-lock.json" || fileName === "pnpm-lock.yaml" || fileName === "yarn.lock" || fileName === "bun.lockb";
}

function isPackageOrConfigPath(pathValue: string) {
    const filePath = normalizeForCompare(pathValue);
    const fileName = filePath.split("/").pop() ?? filePath;
    return fileName === "package.json" || fileName.startsWith("tsconfig") || fileName.startsWith("jsconfig") || fileName.includes("vite.config") || fileName.includes("next.config") || fileName.includes("eslint.config") || fileName.includes("tailwind.config") || fileName.includes("postcss.config") || fileName.includes("docker-compose") || fileName === "dockerfile" || fileName === ".env.example" || fileName === "env.example";
}

function isSensitiveEnvPath(pathValue: string) {
    const fileName = normalizeForCompare(pathValue).split("/").pop() ?? "";

    if (fileName === ".env") return true;
    if (fileName.startsWith(".env.") && !fileName.includes("example")) return true;

    return false;
}

function isAssetReferenceControllerPath(pathValue: string) {
    const filePath = normalizeForCompare(pathValue);
    const fileName = filePath.split("/").pop() ?? filePath;

    return (
        filePath.endsWith("index.html") ||
        filePath.endsWith("/main.tsx") ||
        filePath.endsWith("/main.jsx") ||
        filePath.endsWith("/main.ts") ||
        filePath.endsWith("/main.js") ||
        filePath.endsWith("/app.tsx") ||
        filePath.endsWith("/app.jsx") ||
        filePath.endsWith("/app.ts") ||
        filePath.endsWith("/app.js") ||
        filePath.endsWith("/layout.tsx") ||
        filePath.endsWith("/layout.jsx") ||
        filePath.endsWith("/layout.ts") ||
        filePath.endsWith("/layout.js") ||
        fileName === "manifest.json" ||
        fileName === "site.webmanifest" ||
        filePath.includes("/layout/") ||
        filePath.includes("/layouts/") ||
        fileName.includes("appshell") ||
        fileName.includes("shell")
    );
}

function isFrontendUiSourceFile(file: ProjectInventoryFile) {
    return file.kind === "source" && isClientUiPath(file.path) && !isClientApiBridgePath(file.path);
}

function isLikelyFullstackUiActionFile(file: ProjectInventoryFile, input: SelectTaskFilesInput) {
    if (!isFrontendUiSourceFile(file)) return false;

    const taskText = normalizeForCompare(buildTaskText(input));
    const fileText = getFileSearchText(file);

    const actionTask = includesAny(taskText, ["button", "кноп", "action", "endpoint", "server", "api", "result", "результат", "show", "display", "render", "вывод", "показ"]);
    if (actionTask && includesAny(fileText, ["page", "pages", "component", "components", "actions", "button", "menu", "row", "table", "list", "detail", "card", "form", "modal", "api", "fetch", "axios"])) return true;

    return includesAny(normalizeForCompare(file.path), ["app.tsx", "app.jsx", "page.tsx", "page.jsx", "screen", "view"]);
}

function scoreFullstackUiSourceCandidate(file: ProjectInventoryFile, input: SelectTaskFilesInput) {
    if (!isFrontendUiSourceFile(file)) return Number.NEGATIVE_INFINITY;

    const taskText = normalizeForCompare(buildTaskText(input));
    const filePath = normalizeForCompare(file.path);
    const fileName = filePath.split("/").pop() ?? filePath;

    let score = 0;

    if (filePath.startsWith("client/src/")) score += 60;
    if (filePath.startsWith("src/pages/") || filePath.includes("/pages/")) score += 45;
    if (filePath.startsWith("src/components/") || filePath.includes("/components/")) score += 35;
    if (["app.tsx", "app.jsx"].includes(fileName)) score += 28;

    if (includesAny(taskText, ["button", "кноп", "action", "endpoint", "server", "api", "result", "результат", "показывает"])) {
        if (includesAny(filePath, ["page", "pages", "component", "components", "actions", "button", "menu", "row", "table", "detail", "card", "form", "modal"])) score += 45;
    }

    const tokenContext = buildTokenContext(input);
    score += getStrongTokenMatchCountForFile(file, tokenContext.strongTokens) * 18;

    if (file.sizeBytes === 0) score -= 80;
    if (file.isLikelyGenerated) score -= 100;
    if (isClientApiBridgePath(file.path)) score -= 100;
    if (file.kind !== "source") score -= 100;

    return score;
}

function isReasonableFullstackUiSourceFile(file: ProjectInventoryFile, input: SelectTaskFilesInput) {
    return scoreFullstackUiSourceCandidate(file, input) >= 20;
}

function isEntryOrFrameworkPath(pathValue: string) {
    const filePath = normalizeForCompare(pathValue);
    return filePath.endsWith("index.html") || filePath.endsWith("/main.tsx") || filePath.endsWith("/main.jsx") || filePath.endsWith("/app.tsx") || filePath.endsWith("/app.jsx") || filePath.endsWith("/layout.tsx") || filePath.endsWith("/layout.jsx") || filePath.endsWith("/page.tsx") || filePath.endsWith("/page.jsx") || filePath.includes("/app/") || filePath.includes("/pages/");
}

function isGeneratedDoNotEditPath(pathValue: string) {
    const filePath = normalizeForCompare(pathValue);
    const fileName = filePath.split("/").pop() ?? filePath;
    return fileName === "next-env.d.ts" || fileName === "vite-env.d.ts" || filePath.includes("/.next/") || filePath.includes("/dist/") || filePath.includes("/build/") || filePath.includes("/coverage/");
}

function isUsefulAssetForTask(file: ProjectInventoryFile, input: SelectTaskFilesInput) {
    const text = normalizeForCompare(buildTaskText(input));
    const filePath = normalizeForCompare(file.path);

    if (includesAny(text, ["favicon"]) && filePath.includes("favicon")) return true;
    if (includesAny(text, ["logo", "логотип", "лого"]) && includesAny(filePath, ["logo", "brand"])) return true;
    if (includesAny(text, ["icon", "икон"]) && includesAny(filePath, ["icon", "icons", "favicon"])) return true;
    if (includesAny(text, ["banner", "баннер", "cover"]) && includesAny(filePath, ["banner", "cover", "hero"])) return true;
    if (includesAny(text, ["image", "picture", "photo", "картин", "изображ", "фото"]) && file.kind === "asset") return true;

    return false;
}

function getKindWeight(file: ProjectInventoryFile, area: EffectiveTaskArea, assetMode: AssetMode) {
    if (isLockFilePath(file.path)) return -80;
    if (file.kind === "asset" && assetMode === "none") return -100;

    if (area === "build") {
        if (isPackageOrConfigPath(file.path)) return 60;
        if (isEntryOrFrameworkPath(file.path)) return 36;
        if (file.kind === "source") return 18;
        if (file.kind === "config") return 50;
        if (file.kind === "docs") return 8;
        return 0;
    }

    if (area === "docs") {
        if (file.kind === "docs") return 60;
        if (isPackageOrConfigPath(file.path)) return 48;
        if (file.kind === "config") return 38;
        return 0;
    }

    if (assetMode === "primary") {
        if (file.kind === "asset") return 72;
        if (file.kind === "source") return 30;
        if (file.kind === "style") return 22;
        if (file.kind === "config") return 4;
        return 0;
    }

    if (assetMode === "mixed") {
        if (file.kind === "source") return 42;
        if (file.kind === "style") return 34;
        if (file.kind === "asset") return 18;
        if (file.kind === "config") return 5;
        return 0;
    }

    if (area === "fullstack") {
        if (file.kind === "source") return 38;
        if (file.kind === "style") return 16;
        if (file.kind === "config") return 10;
        if (file.kind === "test") return 8;
        return 0;
    }

    if (area === "ui") {
        if (file.kind === "source") return 34;
        if (file.kind === "style") return 38;
        if (file.kind === "config") return 5;
        if (file.kind === "docs") return 2;
        return 0;
    }

    if (area === "backend") {
        if (file.kind === "source") return 36;
        if (file.kind === "config") return 12;
        if (file.kind === "data") return 4;
        if (file.kind === "docs") return 2;
        return 0;
    }

    if (area === "tests") {
        if (file.kind === "test") return 45;
        if (file.kind === "source") return 28;
        if (file.kind === "config") return 12;
        return 0;
    }

    if (area === "bugfix" || area === "refactor") {
        if (file.kind === "source") return 36;
        if (file.kind === "style") return 14;
        if (file.kind === "test") return 12;
        if (file.kind === "config") return 10;
        return 0;
    }

    if (file.kind === "source") return 28;
    if (file.kind === "style") return 18;
    if (file.kind === "config") return 10;
    if (file.kind === "docs") return 6;
    return 0;
}

function getFileSearchParts(file: ProjectInventoryFile) {
    return [
        file.path,
        file.name,
        file.extension,
        file.kind,
        file.role,
        file.routePath ?? "",
        ...(file.imports ?? []),
        ...(file.exports ?? []),
        ...(file.symbols ?? []),
        ...(file.textHints ?? []),
        file.contentPreview ?? ""
    ];
}

function getFileSearchText(file: ProjectInventoryFile) {
    return normalizeForCompare(getFileSearchParts(file).join(" "));
}


function normalizedTermMatches(text: string, term: string) {
    const normalizedTerm = normalizeForCompare(term);
    if (!normalizedTerm || normalizedTerm.length < 3) return false;
    if (text.includes(normalizedTerm)) return true;

    // Light stemming for human wording in Russian/English without hardcoding project domains.
    const stem = normalizedTerm.length >= 6 ? normalizedTerm.slice(0, 5) : normalizedTerm;
    return stem.length >= 4 && text.includes(stem);
}

function isRouteOrPageLikeFile(file: ProjectInventoryFile) {
    const filePath = normalizeForCompare(file.path);
    const fileName = filePath.split("/").pop() ?? filePath;
    return filePath.includes("/pages/")
        || filePath.startsWith("src/pages/")
        || filePath.startsWith("pages/")
        || filePath.startsWith("src/app/")
        || fileName === "page.tsx"
        || fileName === "page.jsx"
        || fileName === "layout.tsx"
        || fileName === "layout.jsx";
}

function isGlobalStyleFile(file: ProjectInventoryFile) {
    const filePath = normalizeForCompare(file.path);
    return file.kind === "style" && (
        filePath.endsWith("globals.css")
        || filePath.endsWith("global.css")
        || filePath.endsWith("index.css")
        || filePath.endsWith("app.css")
    );
}

function isGlobalStyleRelevantForTask(input: SelectTaskFilesInput) {
    const text = normalizeForCompare(getPositiveTaskText(input.rawTask));
    return includesAny(text, [
        "global style", "global styles", "globals.css", "index.css", "app.css", "theme", "tokens", "entire app", "whole site", "all pages",
        "глобальные стили", "общие стили", "тема", "токены", "весь сайт", "всё приложение", "все страницы"
    ]);
}

function getRouteMatchScore(file: ProjectInventoryFile, routeMentions: string[]) {
    if (routeMentions.length === 0) return 0;

    const filePath = normalizeForCompare(file.path);
    const routePath = normalizeForCompare(file.routePath ?? "");
    const fileText = getFileSearchText(file);
    let score = 0;

    for (const route of routeMentions) {
        const normalizedRoute = normalizeForCompare(route).replace(/^\/+|\/+$/g, "");
        if (!normalizedRoute) continue;
        const routeParts = normalizedRoute.split("/").filter(Boolean);
        const routeTail = routeParts[routeParts.length - 1] ?? normalizedRoute;
        const routeFolderNeedle = `/${routeTail}/`;

        if (routePath === `/${normalizedRoute}` || routePath.endsWith(`/${normalizedRoute}`)) score = Math.max(score, 130);
        if (filePath.includes(`/${normalizedRoute}/`) || filePath.endsWith(`/${normalizedRoute}/page.tsx`) || filePath.endsWith(`/${normalizedRoute}/page.jsx`)) score = Math.max(score, 122);
        if (filePath.includes(routeFolderNeedle) && (filePath.endsWith(".tsx") || filePath.endsWith(".jsx") || filePath.endsWith(".ts") || filePath.endsWith(".js"))) score = Math.max(score, 112);
        if (filePath.includes(routeFolderNeedle)) score = Math.max(score, 88);
        if (routeTail.length >= 3 && (filePath.includes(routeTail) || fileText.includes(routeTail))) score = Math.max(score, 46);
    }

    return score;
}

function isRouteAwarePrimaryCandidate(file: ProjectInventoryFile, tokenContext: TokenContext) {
    return getRouteMatchScore(file, tokenContext.routeMentions) >= 88;
}

function isImplementationIntentText(rawTask: string) {
    return includesAny(rawTask, [
        "implement", "connect", "integrate", "wire", "hook up", "create", "add feature", "build feature", "replace", "render", "show", "display", "fetch", "call", "change", "edit", "modify",
        "реализ", "подключ", "интегр", "добав", "созд", "замен", "вывести", "показ", "получ", "запрос", "измен", "передел"
    ]);
}

function isSecondaryDocumentationMention(file: ProjectInventoryFile, input: SelectTaskFilesInput, area: EffectiveTaskArea) {
    const filePath = normalizeForCompare(file.path);
    const isDocsFile = file.kind === "docs" || filePath.endsWith("readme.md") || filePath.includes("/docs/");
    if (!isDocsFile) return false;
    if (area === "docs") return false;

    const positiveTaskText = getPositiveTaskText(input.rawTask);
    return isImplementationIntentText(positiveTaskText) && includesAny(positiveTaskText, [
        "readme", "docs", "documentation", "guide", "manual", "документац", "ридми", "инструкц", "дальнейшей разработки"
    ]);
}

function isExplicitFilePath(file: ProjectInventoryFile, tokenContext: TokenContext) {
    return tokenContext.explicitExistingPaths.some((pathValue) => normalizeForCompare(pathValue) === normalizeForCompare(file.path));
}

function hasProtectedTermMatch(file: ProjectInventoryFile, constraints: TaskConstraints) {
    if (constraints.protectedFileTerms.length === 0) return false;
    const fileText = getFileSearchText(file);
    return constraints.protectedFileTerms.some((term) => normalizedTermMatches(fileText, term));
}

function isProtectedByUserConstraint(file: ProjectInventoryFile, input: SelectTaskFilesInput, area: EffectiveTaskArea, tokenContext = buildTokenContext(input)) {
    const constraints = getTaskConstraints(input);
    const explicit = isExplicitFilePath(file, tokenContext);
    if (explicit) return false;

    if (constraints.onlyExplicitFiles && tokenContext.explicitExistingPaths.length > 0) {
        return true;
    }

    if (hasProtectedTermMatch(file, constraints)) {
        return true;
    }

    if (constraints.protectOtherPages) {
        const strongMatches = getStrongTokenMatchCountForFile(file, tokenContext.strongTokens);
        if (isRouteOrPageLikeFile(file) && strongMatches === 0) return true;
        if (isGlobalStyleFile(file) && area === "ui") return true;
    }

    return false;
}

function hasExplicitPrimaryTarget(input: SelectTaskFilesInput, area: EffectiveTaskArea) {
    const tokenContext = buildTokenContext(input);
    return tokenContext.explicitExistingPaths.some((pathValue) => {
        const file = findInventoryFile(input.inventory, pathValue);
        return Boolean(file && !isSecondaryDocumentationMention(file, input, area));
    });
}

function isSpecificPageOrFileTask(input: SelectTaskFilesInput, area: EffectiveTaskArea) {
    const text = normalizeForCompare(input.rawTask);
    if (hasExplicitPrimaryTarget(input, area)) return true;
    if (includesAny(text, ["в файле", "in file", "в компоненте", "in component", "на странице", "on page", "странице с", "page with"])) return true;
    if (mentionsOtherPagesProtected(input.rawTask) || mentionsOnlyExplicitFiles(input.rawTask)) return true;
    return false;
}

function getStrongTokenMatchCountForFile(file: ProjectInventoryFile, strongTokens: string[]) {
    const fileText = getFileSearchText(file);
    const pathSegments = tokenize(file.path);
    let count = 0;

    for (const token of strongTokens) {
        if (pathSegments.includes(token) || fileText.includes(token)) count += 1;
    }

    return count;
}

function hasAnyStrongMatchForFile(file: ProjectInventoryFile, strongTokens: string[]) {
    return getStrongTokenMatchCountForFile(file, strongTokens) > 0;
}

function scorePathTokenMatches(file: ProjectInventoryFile, tokenContext: TokenContext) {
    const filePath = normalizeForCompare(file.path);
    const fileText = getFileSearchText(file);
    const pathSegments = tokenize(file.path);
    let score = 0;

    for (const token of tokenContext.strongTokens) {
        if (pathSegments.includes(token)) score += 42;
        else if (filePath.includes(token)) score += 30;
        else if ((file.textHints ?? []).some((hint) => normalizeForCompare(hint) === token)) score += 26;
        else if (fileText.includes(token)) score += 14;
    }

    for (const token of tokenContext.broadTokens) {
        if (BROAD_PATH_TOKENS.has(token)) continue;
        if (pathSegments.includes(token)) score += 8;
        else if (filePath.includes(token)) score += 5;
        else if (fileText.includes(token)) score += 2;
    }

    return score;
}

function scoreFileFallback(file: ProjectInventoryFile, tokenContext: TokenContext, input: SelectTaskFilesInput, area: EffectiveTaskArea, assetMode: AssetMode) {
    const filePath = normalizeForCompare(file.path);
    const constraints = getTaskConstraints(input);
    let score = getKindWeight(file, area, assetMode);
    score += scorePathTokenMatches(file, tokenContext);
    const routeScore = getRouteMatchScore(file, tokenContext.routeMentions);
    score += routeScore;

    const strongMatchCount = getStrongTokenMatchCountForFile(file, tokenContext.strongTokens);
    const hasStrongTokens = tokenContext.strongTokens.length > 0;
    const hasStrongMatch = strongMatchCount > 0;

    if (strongMatchCount >= 2) score += 20;
    if (strongMatchCount >= 3) score += 20;
    if (file.canReadText) score += 5;
    if (file.depth <= 3) score += 4;
    if (file.isLikelyGenerated) score -= 35;
    if (isGeneratedDoNotEditPath(file.path)) score -= 18;
    if (file.kind === "runtime") score -= 60;
    if (file.sizeBytes === 0) score -= 35;

    if (isGlobalStyleFile(file) && isSpecificPageOrFileTask(input, area) && !isGlobalStyleRelevantForTask(input)) {
        score -= 85;
    }

    if (area === "backend") {
        if (isBackendLeaningPath(file.path)) score += 48;
        if (isClientApiBridgePath(file.path)) score += 20;
        if (isClientUiPath(file.path) && !isClientApiBridgePath(file.path)) score -= 65;
        if (file.kind === "style" || file.kind === "asset") score -= 75;
    }

    if (area === "fullstack") {
        if (isBackendLeaningPath(file.path)) score += 30;
        if (isClientApiBridgePath(file.path)) score += 38;
        if (isLikelyFullstackUiActionFile(file, input)) score += 56;
        else if (isFrontendUiSourceFile(file) && hasStrongMatch) score += 32;
        if (file.kind === "style") score += 4;

        // Avoid treating backend/domain pipeline files as enough UI context for button/action tasks.
        if (filePath.startsWith("src/app/") && !isEntryOrFrameworkPath(file.path)) score -= 45;
        if (includesAny(filePath, ["/core/", "/report/", "/io/"]) && !hasStrongMatch) score -= 35;
    }

    if (area === "ui") {
        if (file.kind === "style") score += 18;
        if (filePath.includes("/components/")) score += 12;
        if (filePath.includes("/pages/") || filePath.includes("/app/")) score += 12;
        if (isClientUiPath(file.path) && !isClientApiBridgePath(file.path)) score += 18;
        if (isServerSidePath(file.path) && !hasStrongMatch) score -= 45;

        if (constraints.noBackendMutation && (isBackendLeaningPath(file.path) || isClientApiBridgePath(file.path))) {
            score -= hasStrongMatch ? 35 : 95;
        }
    }

    if (area === "docs") {
        if (filePath.endsWith("readme.md")) score += 45;
        if (isPackageOrConfigPath(file.path)) score += 32;
        if (file.kind === "source") score -= 35;
    }

    if (area === "build") {
        if (isPackageOrConfigPath(file.path)) score += 42;
        if (isEntryOrFrameworkPath(file.path)) score += 18;
        if (filePath.endsWith("next-env.d.ts")) score -= 30;
        if (filePath.includes("/content/") && !hasStrongMatch) score -= 28;
    }

    if (assetMode === "primary" && file.kind === "asset") {
        score += isUsefulAssetForTask(file, input) ? 46 : 8;
    }

    if (assetMode === "primary" && file.kind !== "asset") {
        if (isAssetReferenceControllerPath(file.path)) score += 28;
        else if (file.kind === "style") score -= 18;
        else if (isPackageOrConfigPath(file.path)) score -= 22;
        else score -= 75;
    }

    if (assetMode === "mixed" && file.kind === "asset") score -= 10;
    if (assetMode === "none" && file.kind === "asset") score -= 120;
    if (hasStrongTokens && !hasStrongMatch && isClientUiPath(file.path) && area !== "ui" && area !== "fullstack") score -= 18;

    return score;
}

function getAssetCap(assetMode: AssetMode) {
    if (assetMode === "primary") return 3;
    if (assetMode === "mixed") return 2;
    return 0;
}

function selectedPriority(file: SelectedTaskFile, input: SelectTaskFilesInput, area: EffectiveTaskArea, assetMode: AssetMode) {
    const filePath = normalizeForCompare(file.path);
    const constraints = getTaskConstraints(input);
    let priority = file.confidence * 100;

    if (file.reason.toLowerCase().includes("explicitly mentioned")) {
        priority += 1000;
    }

    const tokenContextForPriority = buildTokenContext(input);
    const routeScore = getRouteMatchScore({ path: file.path, kind: file.kind, sizeBytes: 1, canReadText: true, isLikelyGenerated: false, extension: "", depth: 0, name: file.path.split("/").pop() ?? file.path } as ProjectInventoryFile, tokenContextForPriority.routeMentions);
    if (routeScore >= 88) priority += 190;
    else if (routeScore > 0) priority += 55;

    if (assetMode === "primary") {
        if (file.kind === "asset") priority += 140;
        if (includesAny(filePath, ["logo", "favicon", "icon", "brand"])) priority += 55;
        if (isAssetReferenceControllerPath(file.path)) priority += 55;
        if (file.kind !== "asset" && !isAssetReferenceControllerPath(file.path) && file.kind !== "style") priority -= 140;
    }

    if (area === "build") {
        if (normalizeForCompare(file.path).endsWith("package.json")) priority += 120;
        else if (isPackageOrConfigPath(file.path)) priority += 90;
        else if (isEntryOrFrameworkPath(file.path)) priority += 55;
    }

    if (area === "docs") {
        if (file.kind === "docs") priority += 130;
        if (normalizeForCompare(file.path).endsWith("package.json")) priority += 100;
        else if (isPackageOrConfigPath(file.path)) priority += 60;
        if (file.kind === "source") priority -= 80;
    }

    if (area === "backend") {
        if (isBackendLeaningPath(file.path)) priority += 120;
        if (isClientApiBridgePath(file.path)) priority += 60;
        if (file.kind === "config") priority += 15;
    }

    if (area === "fullstack") {
        if (isClientApiBridgePath(file.path)) priority += 110;
        if (isLikelyFullstackUiActionFile({ path: file.path, kind: file.kind, sizeBytes: 1, canReadText: true, isLikelyGenerated: false, extension: "", depth: 0, name: file.path.split("/").pop() ?? file.path } as ProjectInventoryFile, input)) priority += 108;
        else if (file.kind === "source" && isClientUiPath(file.path) && !isClientApiBridgePath(file.path)) priority += 82;
        if (isBackendLeaningPath(file.path)) priority += 88;
        if (file.kind === "style") priority -= 18;
        if (filePath.startsWith("src/app/") && !isEntryOrFrameworkPath(file.path)) priority -= 65;
    }

    if (area === "ui") {
        if (file.kind === "style") priority += isGlobalStyleFile({ path: file.path, kind: file.kind } as ProjectInventoryFile) && isSpecificPageOrFileTask(input, area) && !isGlobalStyleRelevantForTask(input) ? -35 : 58;
        if (isClientUiPath(file.path)) priority += 72;
        if (isServerSidePath(file.path)) priority -= 80;
    }

    if (constraints.noBackendMutation) {
        if (isBackendLeaningPath(file.path) || isClientApiBridgePath(file.path)) {
            priority -= 140;
        }

        if ((file.kind === "style" || isClientUiPath(file.path)) && !isClientApiBridgePath(file.path)) {
            priority += 70;
        }
    }

    if (constraints.noFrontendMutation) {
        if (isClientUiPath(file.path) && !isClientApiBridgePath(file.path)) {
            priority -= 120;
        }

        if (isBackendLeaningPath(file.path)) {
            priority += 80;
        }
    }

    if (isLockFilePath(file.path)) priority -= 250;
    if (filePath.endsWith("next-env.d.ts") || filePath.endsWith("vite-env.d.ts")) priority -= 100;

    return priority;
}

function clampComposerLimit(value: unknown, fallback: number) {
    const limit = Number(value);

    if (!Number.isFinite(limit)) {
        return fallback;
    }

    return Math.min(24, Math.max(3, Math.round(limit)));
}

function getDefaultSelectionLimit(area: EffectiveTaskArea, assetMode: AssetMode) {
    if (assetMode === "primary") return 7;
    if (area === "build") return 7;
    if (area === "docs") return 6;
    if (area === "backend") return 8;
    if (area === "fullstack") return 10;
    if (area === "ui") return 7;
    if (area === "tests") return 7;
    if (area === "bugfix") return 7;
    if (area === "refactor") return 8;

    return 8;
}

function getSelectionLimitFromSettings(
    input: SelectTaskFilesInput,
    area: EffectiveTaskArea,
    assetMode: AssetMode
) {
    const limits = input.settings?.composerFileLimits;
    const fallback = getDefaultSelectionLimit(area, assetMode);

    if (!limits) {
        return fallback;
    }

    const areaLimit = limits[area as keyof typeof limits];

    return clampComposerLimit(areaLimit ?? limits.default, fallback);
}


function getContextAwareSelectionLimit(input: SelectTaskFilesInput, area: EffectiveTaskArea, assetMode: AssetMode) {
    const configuredLimit = getSelectionLimitFromSettings(input, area, assetMode);
    const tokenContext = buildTokenContext(input);
    const constraints = getTaskConstraints(input);
    const explicitPrimaryCount = tokenContext.explicitExistingPaths.filter((pathValue) => {
        const file = findInventoryFile(input.inventory, pathValue);
        return Boolean(file && !isSecondaryDocumentationMention(file, input, area));
    }).length;

    if (constraints.onlyExplicitFiles && explicitPrimaryCount > 0) {
        return Math.max(1, explicitPrimaryCount);
    }

    if (explicitPrimaryCount > 0) {
        return Math.min(configuredLimit, Math.max(explicitPrimaryCount + 2, 3));
    }

    if (isSpecificPageOrFileTask(input, area)) {
        return Math.min(configuredLimit, constraints.protectOtherPages ? 5 : 7);
    }

    return configuredLimit;
}

function rankAndCapSelection(selectedFiles: SelectedTaskFile[], input: SelectTaskFilesInput, area: EffectiveTaskArea, assetMode: AssetMode) {
    const seen = new Set<string>();
    const deduped = selectedFiles.filter((file) => {
        const normalized = normalizeForCompare(file.path);
        if (seen.has(normalized)) return false;
        seen.add(normalized);
        return true;
    });

    const sorted = deduped.sort(
        (a, b) => selectedPriority(b, input, area, assetMode) - selectedPriority(a, input, area, assetMode)
    );

    if (assetMode === "primary") {
        const assets = sorted.filter((file) => file.kind === "asset").slice(0, getAssetCap(assetMode));
        const controllers = sorted
            .filter((file) => file.kind !== "asset" && isAssetReferenceControllerPath(file.path))
            .slice(0, 3);
        const styles = sorted
            .filter((file) => file.kind === "style")
            .slice(0, controllers.length === 0 ? 1 : 0);

        return [...assets, ...controllers, ...styles].slice(0, 7);
    }

    const assetCap = getAssetCap(assetMode);
    let assetCount = 0;

    const selectionLimit = getContextAwareSelectionLimit(input, area, assetMode);

    return sorted
        .filter((file) => {
            if (file.kind !== "asset") return true;
            if (assetCount >= assetCap) return false;
            assetCount += 1;
            return true;
        })
        .slice(0, Math.min(MAX_SELECTED_FILES, selectionLimit));
}

function trimLowValueFallbackCandidates(items: Array<{ file: ProjectInventoryFile; score: number }>, tokenContext: TokenContext, area: EffectiveTaskArea) {
    if (items.length === 0) return [];
    const maxScore = items[0]?.score ?? 0;
    const dynamicThreshold = Math.max(area === "docs" || area === "build" ? 28 : 38, Math.floor(maxScore * 0.5));

    const trimmed = items.filter((item) => {
        if (isRouteAwarePrimaryCandidate(item.file, tokenContext)) return true;
        if (item.score >= dynamicThreshold) return true;
        if (tokenContext.strongTokens.length > 0 && hasAnyStrongMatchForFile(item.file, tokenContext.strongTokens) && item.score >= 32) return true;
        return false;
    });

    return trimmed.length > 0 ? trimmed : items.slice(0, MIN_MODEL_SELECTED_FILES);
}

function findInventoryFile(inventory: ProjectInventory, filePath: string) {
    const normalized = normalizeForCompare(filePath);
    return inventory.files.find((file) => normalizeForCompare(file.path) === normalized);
}

function makeSelectedFile(file: ProjectInventoryFile, reason: string, confidence: number, requestedUsage = defaultUsageForFile(file)): SelectedTaskFile {
    return {
        path: file.path,
        kind: file.kind,
        usage: sanitizeUsageForFile(file, requestedUsage),
        reason,
        confidence: Math.min(0.98, Math.max(0.3, confidence))
    };
}

function canUseSelectedFile(input: SelectTaskFilesInput, file: ProjectInventoryFile, area = getEffectiveTaskArea(input), assetMode = getAssetMode(input)) {
    const taskText = normalizeForCompare(buildTaskText(input));
    const constraints = getTaskConstraints(input);

    if (isProtectedByUserConstraint(file, input, area)) return false;
    if (isSensitiveEnvPath(file.path)) return false;
    if (file.kind === "runtime") return false;
    if (file.isLikelyGenerated) return false;
    if (isGeneratedDoNotEditPath(file.path) && area !== "build") return false;
    if (isLockFilePath(file.path) && !includesAny(taskText, ["lock", "package-lock", "pnpm-lock", "yarn.lock"])) return false;
    if (file.kind === "asset" && assetMode === "none") return false;
    if (file.sizeBytes === 0 && !includesAny(input.rawTask, [file.name, file.path])) return false;

    if (area === "ui" && constraints.noBackendMutation) {
        if (isServerSidePath(file.path)) return false;
        if (isBackendLeaningPath(file.path) && !isClientUiPath(file.path)) return false;
    }

    if (area === "backend") {
        if (file.kind === "asset" || file.kind === "style") return false;
        if (isClientUiPath(file.path) && !isClientApiBridgePath(file.path)) return false;
    }

    if (area === "docs") {
        if (file.kind === "asset" || file.kind === "data") return false;
        if (file.kind === "source" && !isEntryOrFrameworkPath(file.path)) return false;
    }

    return true;
}

function isModelFileSemanticallyUseful(file: ProjectInventoryFile, input: SelectTaskFilesInput, area: EffectiveTaskArea, assetMode: AssetMode, tokenContext: TokenContext) {
    const constraints = getTaskConstraints(input);

    if (!canUseSelectedFile(input, file, area, assetMode)) return false;

    if (area === "ui" && constraints.noBackendMutation && (isBackendLeaningPath(file.path) || isClientApiBridgePath(file.path))) {
        return false;
    }

    if (area === "backend" && constraints.noFrontendMutation && isClientUiPath(file.path) && !isClientApiBridgePath(file.path)) {
        return false;
    }

    const score = scoreFileFallback(file, tokenContext, input, area, assetMode);
    const explicit = tokenContext.explicitExistingPaths.some((pathValue) => normalizeForCompare(pathValue) === normalizeForCompare(file.path));
    if (explicit) return true;

    if (assetMode === "primary") {
        if (file.kind === "asset") return isUsefulAssetForTask(file, input) || score >= 70;
        return isAssetReferenceControllerPath(file.path) || file.kind === "style";
    }

    if (area === "docs") {
        return file.kind === "docs" || isPackageOrConfigPath(file.path);
    }

    if (area === "build") {
        return isPackageOrConfigPath(file.path) || isEntryOrFrameworkPath(file.path) || score >= 58;
    }

    if (area === "backend") {
        return isBackendLeaningPath(file.path) || isClientApiBridgePath(file.path) || score >= 60;
    }

    if (area === "fullstack") {
        if (isBackendLeaningPath(file.path)) return true;
        if (isClientApiBridgePath(file.path)) return true;
        if (isLikelyFullstackUiActionFile(file, input)) return true;
        if (file.kind === "style" && score >= 50) return true;

        // A real path is not automatically useful. Full-stack tasks need layer coverage, not random source files.
        return score >= 82 && !includesAny(normalizeForCompare(file.path), ["/core/", "/report/", "/io/"]);
    }

    if (area === "ui") {
        return !isServerSidePath(file.path) && score >= 34;
    }

    return score >= 42;
}

function getScoredCandidates(input: SelectTaskFilesInput, area: EffectiveTaskArea, assetMode: AssetMode, tokenContext: TokenContext, selected: SelectedTaskFile[]) {
    const seen = new Set(selected.map((file) => normalizeForCompare(file.path)));

    return input.inventory.files
        .filter((file) => !seen.has(normalizeForCompare(file.path)) && canUseSelectedFile(input, file, area, assetMode))
        .map((file) => ({ file, score: scoreFileFallback(file, tokenContext, input, area, assetMode) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score);
}

function addBestMatchingFile(selected: SelectedTaskFile[], input: SelectTaskFilesInput, area: EffectiveTaskArea, assetMode: AssetMode, predicate: (file: ProjectInventoryFile) => boolean, reason: string, confidence = 0.72) {
    const tokenContext = buildTokenContext(input);
    const best = getScoredCandidates(input, area, assetMode, tokenContext, selected)
        .filter((item) => predicate(item.file))
        .sort((a, b) => b.score - a.score)[0]?.file;

    if (best) {
        selected.push(makeSelectedFile(best, reason, confidence));
    }
}

function addBestFullstackUiSourceFile(selected: SelectedTaskFile[], input: SelectTaskFilesInput, reason: string, confidence = 0.84) {
    const seen = new Set(selected.map((file) => normalizeForCompare(file.path)));

    const best = input.inventory.files
        .filter((file) => !seen.has(normalizeForCompare(file.path)))
        .filter((file) => canUseSelectedFile(input, file, "fullstack", "none"))
        .filter((file) => isFrontendUiSourceFile(file))
        .map((file) => ({ file, score: scoreFullstackUiSourceCandidate(file, input) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)[0];

    if (best) {
        selected.push(makeSelectedFile(best.file, reason, Math.max(confidence, Math.min(0.9, best.score / 120))));
    }
}

function ensureHelpfulCoverage(selected: SelectedTaskFile[], input: SelectTaskFilesInput, area: EffectiveTaskArea, assetMode: AssetMode) {
    const taskText = normalizeForCompare(buildTaskText(input));
    const hasStyle = selected.some((file) => file.kind === "style");
    const hasDocs = selected.some((file) => file.kind === "docs");
    const hasPackage = selected.some((file) => normalizeForCompare(file.path).endsWith("package.json"));
    const hasConfig = selected.some((file) => file.kind === "config" || isPackageOrConfigPath(file.path));
    const hasBackend = selected.some((file) => isBackendLeaningPath(file.path));
    const hasClientBridge = selected.some((file) => isClientApiBridgePath(file.path));
    const hasUiFile = selected.some((file) => file.kind === "source" && isClientUiPath(file.path) && !isClientApiBridgePath(file.path));
    const hasAsset = selected.some((file) => file.kind === "asset");
    const wantsRedesign = includesAny(taskText, ["redesign", "design", "visual", "style", "css", "внешний вид", "дизайн", "визуал", "дороже", "чище", "деревян", "дефолт", "освежи"]);

    if (assetMode === "primary") {
        if (!hasAsset) {
            addBestMatchingFile(selected, input, area, assetMode, (file) => file.kind === "asset" && isUsefulAssetForTask(file, input), "Added because asset-primary tasks should include matching real asset files from inventory.", 0.9);
        }

        if (!selected.some((file) => file.kind === "asset")) {
            addBestMatchingFile(selected, input, area, assetMode, (file) => file.kind === "asset", "Added because asset-primary tasks should include at least one real asset file from inventory.", 0.78);
        }

        addBestMatchingFile(selected, input, area, assetMode, (file) => isAssetReferenceControllerPath(file.path), "Added because logo/favicon usage is often controlled by app entry, shell, layout, manifest, or HTML files.", 0.72);
    }

    if ((area === "ui" || area === "fullstack") && wantsRedesign && !hasStyle && (!isSpecificPageOrFileTask(input, area) || isGlobalStyleRelevantForTask(input))) {
        addBestMatchingFile(selected, input, area, assetMode, (file) => file.kind === "style", "Added to cover visual styling for the requested UI change.", 0.72);
    }

    if (area === "docs") {
        if (!hasDocs) addBestMatchingFile(selected, input, area, assetMode, (file) => file.kind === "docs", "Added because documentation tasks should inspect existing docs first.", 0.78);
        if (!hasPackage) addBestMatchingFile(selected, input, area, assetMode, (file) => normalizeForCompare(file.path).endsWith("package.json"), "Added because setup documentation should reflect actual package scripts.", 0.84);
        if (!hasConfig) addBestMatchingFile(selected, input, area, assetMode, (file) => isPackageOrConfigPath(file.path), "Added because setup documentation may depend on project configuration.", 0.68);
    }

    if (area === "build") {
        if (!hasPackage) addBestMatchingFile(selected, input, area, assetMode, (file) => normalizeForCompare(file.path).endsWith("package.json"), "Added because build problems usually depend on package scripts and dependencies.", 0.86);
        if (!hasConfig) addBestMatchingFile(selected, input, area, assetMode, (file) => isPackageOrConfigPath(file.path), "Added because build problems often depend on framework or TypeScript config.", 0.8);
        addBestMatchingFile(selected, input, area, assetMode, (file) => isEntryOrFrameworkPath(file.path), "Added because build/import errors may originate from app entry, layout, page, or route files.", 0.7);
    }

    if (area === "backend") {
        if (!hasBackend) addBestMatchingFile(selected, input, area, assetMode, (file) => isBackendLeaningPath(file.path), "Added to cover the server/API side of the backend task.", 0.82);
    }

    if (area === "fullstack") {
        if (!hasBackend) addBestMatchingFile(selected, input, area, assetMode, (file) => isBackendLeaningPath(file.path), "Added to cover the server/API side of the full-stack task.", 0.8);
        if (!hasClientBridge) addBestMatchingFile(selected, input, area, assetMode, (file) => isClientApiBridgePath(file.path), "Added to cover the client API bridge for the full-stack task.", 0.84);

        const hasConcreteUiSource = selected.some((file) => file.kind === "source" && isClientUiPath(file.path) && !isClientApiBridgePath(file.path));

        if (!hasConcreteUiSource) {
            addBestFullstackUiSourceFile(selected, input, "Added to cover the concrete UI page/component that should trigger the server endpoint and show the result.", 0.84);
        }

        if (!selected.some((file) => file.kind === "source" && isClientUiPath(file.path) && !isClientApiBridgePath(file.path))) {
            addBestMatchingFile(selected, input, area, assetMode, (file) => isFrontendUiSourceFile(file), "Added as a fallback UI source file for the full-stack task.", 0.72);
        }

        // A style file is useful, but it must not be the only UI coverage for full-stack actions.
        if (!selected.some((file) => file.kind === "style") && selected.some((file) => file.kind === "source" && isClientUiPath(file.path) && !isClientApiBridgePath(file.path))) {
            addBestMatchingFile(selected, input, area, assetMode, (file) => file.kind === "style", "Added as optional styling context after a concrete UI source file was selected.", 0.62);
        }
    }

    return rankAndCapSelection(selected, input, area, assetMode);
}

function getRouteAwareSeedFiles(input: SelectTaskFilesInput, area: EffectiveTaskArea, assetMode: AssetMode, tokenContext: TokenContext, selected: SelectedTaskFile[]) {
    if (tokenContext.routeMentions.length === 0) return [];

    const seen = new Set(selected.map((file) => normalizeForCompare(file.path)));
    const candidates = input.inventory.files
        .filter((file) => !seen.has(normalizeForCompare(file.path)))
        .filter((file) => canUseSelectedFile(input, file, area, assetMode))
        .map((file) => ({ file, score: getRouteMatchScore(file, tokenContext.routeMentions) + scoreFileFallback(file, tokenContext, input, area, assetMode) * 0.25 }))
        .filter((item) => item.score >= 70)
        .sort((a, b) => b.score - a.score)
        .slice(0, isSpecificPageOrFileTask(input, area) ? 3 : 5);

    return candidates.map((item) => makeSelectedFile(
        item.file,
        "Selected by route-aware inventory matching from a route/page mention in the task.",
        Math.min(0.9, Math.max(0.72, item.score / 180))
    ));
}

function buildFallbackSelection(input: SelectTaskFilesInput): TaskFileSelection {
    const startedAt = Date.now();
    const effectiveTaskArea = getEffectiveTaskArea(input);
    const assetMode = getAssetMode(input);
    const conflictNote = getConflictNote(input, effectiveTaskArea);
    const tokenContext = buildTokenContext(input);
    const constraints = getTaskConstraints(input);
    const selected: SelectedTaskFile[] = [];

    for (const explicitPath of tokenContext.explicitExistingPaths) {
        const inventoryFile = findInventoryFile(input.inventory, explicitPath);
        if (inventoryFile && canUseSelectedFile(input, inventoryFile, effectiveTaskArea, assetMode)) {
            const secondaryDocs = isSecondaryDocumentationMention(inventoryFile, input, effectiveTaskArea);
            selected.push(makeSelectedFile(
                inventoryFile,
                secondaryDocs
                    ? "Mentioned as a secondary documentation deliverable; include as reference after source/API context."
                    : "Explicitly mentioned by the user and validated against the real project inventory.",
                secondaryDocs ? 0.72 : 0.95,
                secondaryDocs ? "inspect-only" : defaultUsageForFile(inventoryFile)
            ));
        }
    }


    for (const routeFile of getRouteAwareSeedFiles(input, effectiveTaskArea, assetMode, tokenContext, selected)) {
        selected.push(routeFile);
    }

    if (constraints.onlyExplicitFiles && selected.length > 0) {
        const finalSelectedFiles = rankAndCapSelection(selected, input, effectiveTaskArea, assetMode);

        return {
            selectedFiles: finalSelectedFiles,
            rejectedModelPaths: tokenContext.explicitMissingPaths,
            source: "fallback",
            usedFallback: true,
            durationMs: getDurationMs(startedAt),
            effectiveTaskArea,
            assetMode,
            conflictNote,
            notes: [
                "Fallback file selection was used.",
                "Fallback selection is universal and does not rely on project-specific domain rules.",
                "User constrained the task to explicit file(s), so ContextForge did not add unrelated fallback files.",
                `Effective task area: ${effectiveTaskArea}.`,
                `Asset mode: ${assetMode}.`,
                conflictNote ?? "No task type conflict detected.",
                ...constraints.notes,
                tokenContext.explicitMissingPaths.length > 0
                    ? `Explicit path(s) mentioned by the user but not found in inventory: ${tokenContext.explicitMissingPaths.join(", ")}.`
                    : "No missing explicit user paths detected."
            ]
        };
    }

    const scored = getScoredCandidates(input, effectiveTaskArea, assetMode, tokenContext, selected);
    const trimmed = trimLowValueFallbackCandidates(scored, tokenContext, effectiveTaskArea);

    for (const { file, score } of trimmed) {
        selected.push(makeSelectedFile(
            file,
            score > 45
                ? "Selected by universal fallback ranking based on task meaning, file kind, path overlap, and technical role."
                : "Selected by universal fallback ranking as potentially useful context.",
            Math.min(0.84, Math.max(0.35, score / 120))
        ));
    }

    const finalSelectedFiles = ensureHelpfulCoverage(selected, input, effectiveTaskArea, assetMode);

    return {
        selectedFiles: finalSelectedFiles,
        rejectedModelPaths: tokenContext.explicitMissingPaths,
        source: "fallback",
        usedFallback: true,
        durationMs: getDurationMs(startedAt),
        effectiveTaskArea,
        assetMode,
        conflictNote,
        notes: [
            "Fallback file selection was used.",
            "Fallback selection is universal and does not rely on project-specific domain rules.",
            `Effective task area: ${effectiveTaskArea}.`,
            `Asset mode: ${assetMode}.`,
            `Composer file limit for "${effectiveTaskArea}": ${getSelectionLimitFromSettings(input, effectiveTaskArea, assetMode)}.`,
            conflictNote ?? "No task type conflict detected.",
            ...constraints.notes,
            tokenContext.strongTokens.length > 0
                ? `Strong fallback tokens: ${tokenContext.strongTokens.slice(0, 18).join(", ")}.`
                : "No strong fallback tokens were extracted.",
            tokenContext.explicitMissingPaths.length > 0
                ? `Explicit path(s) mentioned by the user but not found in inventory: ${tokenContext.explicitMissingPaths.join(", ")}.`
                : "No missing explicit user paths detected."
        ]
    };
}

function compactInventoryForPrompt(inventory: ProjectInventory) {
    return inventory.files.slice(0, MAX_INVENTORY_FILES_FOR_PROMPT).map((file) => ({
        path: file.path,
        kind: file.kind,
        role: file.role,
        routePath: file.routePath,
        extension: file.extension,
        sizeBytes: file.sizeBytes,
        canReadText: file.canReadText,
        isLikelyGenerated: file.isLikelyGenerated,
        imports: file.imports.slice(0, 8),
        exports: file.exports.slice(0, 8),
        symbols: file.symbols.slice(0, 12),
        textHints: file.textHints.slice(0, 14),
        contentPreview: file.contentPreview
    }));
}

function buildSelectorPrompt(input: SelectTaskFilesInput) {
    const effectiveTaskArea = getEffectiveTaskArea(input);
    const assetMode = getAssetMode(input);
    const compactInventory = compactInventoryForPrompt(input.inventory);

    return `
You are ContextForge's AI file selector.

Your job:
Select the most relevant REAL files from the project inventory for a Task Pack that will be used by an external coding agent.

Important:
- You are not editing files.
- You are not generating code changes.
- Select only paths that exist in the provided inventory.
- Never invent file paths, components, services, handlers, stores, pages, or assets.
- The selected task type is the user's requested workflow. The inferred task area is "${effectiveTaskArea}". If they conflict, select files that make the conflict visible instead of silently switching to docs/config only.
- Asset mode is "${assetMode}".
- If asset mode is "none", do not select assets.
- If asset mode is "mixed", select mostly source/style files and at most 1-2 highly relevant assets.
- If asset mode is "primary", select matching real assets such as logo, favicon, icons, images, or files under public/assets, plus source/style files that reference them.
- For build/config tasks, prefer package.json, framework config, TypeScript config, lint config, entry/layout/page/route files that may cause build/import failures.
- For docs tasks, prefer README/docs/package/config files. Avoid unrelated source files. If README/docs is only a secondary deliverable for an implementation task, include README as reference but still select real source files for the main implementation.
- For fullstack tasks, include server/API files, client API bridge files, and the most relevant UI component/page.
- For backend tasks, prefer server/api/routes/db/services/electron files and avoid client UI files unless they are API bridge files.
- For UI tasks, prefer page/component/layout/style files and avoid server-only files.
- If the user says "keep backend API unchanged", "do not change backend", "frontend only", or "UI only", treat backend/API files as protected context and do not select them as edit targets.
- Mentioning API/backend as a constraint does not automatically make the task backend or fullstack.
- If backend/API files are protected by the user instruction, prefer UI page/component/layout/style files instead.
- If the user says "backend only", "API only", or "do not change UI", avoid selecting UI files as edit targets.
- Avoid package-lock.json, pnpm-lock.yaml, yarn.lock, empty files, generated files, and unrelated source files.
- Binary files should usually be "asset-reference" or "inspect-only".
- Style/source files must never use "asset-reference".
- Use inventory role, routePath, imports, exports, symbols, textHints, and contentPreview to understand files dynamically. Do not rely on project-specific assumptions.
- Keep the selection focused and reviewable. Usually select 4 to 12 files.
- Return strict JSON only. No Markdown. No code fences.

Allowed usage values:
inspect-and-edit, inspect-only, asset-reference, config-reference

Return JSON shape:
{
  "selectedFiles": [
    {
      "path": "src/App.tsx",
      "usage": "inspect-and-edit",
      "reason": "This real file is likely related to the requested change.",
      "confidence": 0.86
    }
  ],
  "notes": []
}

User task:
${input.rawTask}

Selected task type:
${input.taskType}

Inferred task area:
${effectiveTaskArea}

Target tool:
${input.targetTool}

Task intent:
${JSON.stringify(input.taskIntent ?? null, null, 2)}

Inventory summary:
${JSON.stringify({
        totalFiles: input.inventory.totalFiles,
        scannedFiles: input.inventory.scannedFiles,
        truncated: input.inventory.truncated,
        notes: input.inventory.notes
    }, null, 2)}

Project inventory:
${JSON.stringify(compactInventory, null, 2)}
`.trim();
}

function cleanupJsonCandidate(value: string) {
    return value
        .replace(/^```(?:json)?/i, "")
        .replace(/```$/i, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|\s)\/\/.*$/gm, "$1")
        .replace(/,\s*([}\]])/g, "$1")
        .trim();
}

function parseJsonCandidate(value: string) {
    const candidate = cleanupJsonCandidate(value);
    try { return JSON.parse(candidate); } catch { return null; }
}

function extractBalancedJsonFragments(value: string) {
    const fragments: string[] = [];
    const openers = new Set(["{", "["]);
    const closerFor: Record<string, string> = { "{": "}", "[": "]" };

    for (let start = 0; start < value.length; start += 1) {
        const opener = value[start];
        if (!openers.has(opener)) continue;

        const expectedClosers = [closerFor[opener]];
        let inString = false;
        let quote = "";
        let escaped = false;

        for (let index = start + 1; index < value.length; index += 1) {
            const char = value[index];

            if (inString) {
                if (escaped) {
                    escaped = false;
                    continue;
                }

                if (char === "\\") {
                    escaped = true;
                    continue;
                }

                if (char === quote) {
                    inString = false;
                    quote = "";
                }

                continue;
            }

            if (char === '"') {
                inString = true;
                quote = char;
                continue;
            }

            if (openers.has(char)) {
                expectedClosers.push(closerFor[char]);
                continue;
            }

            const expected = expectedClosers[expectedClosers.length - 1];
            if (char === expected) {
                expectedClosers.pop();
                if (expectedClosers.length === 0) {
                    fragments.push(value.slice(start, index + 1));
                    break;
                }
            }
        }
    }

    return fragments;
}

function extractJsonObject(value: string) {
    const trimmed = value.trim();
    const direct = parseJsonCandidate(trimmed);
    if (direct) return direct;

    const fenced = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)]
        .map((match) => match[1])
        .map(parseJsonCandidate)
        .find(Boolean);
    if (fenced) return fenced;

    for (const fragment of extractBalancedJsonFragments(trimmed)) {
        const parsed = parseJsonCandidate(fragment);
        if (parsed) return parsed;
    }

    return null;
}

function getModelFileItems(value: unknown): unknown[] {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== "object") return [];
    const data = value as Record<string, unknown>;
    if (Array.isArray(data.selectedFiles)) return data.selectedFiles;
    if (Array.isArray(data.files)) return data.files;
    if (Array.isArray(data.relevantFiles)) return data.relevantFiles;
    if (Array.isArray(data.paths)) return data.paths;
    return [];
}

function getModelNotes(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    return normalizeStringArray((value as Record<string, unknown>).notes);
}

function getPathFromModelItem(item: unknown) {
    if (typeof item === "string") return item;
    if (!item || typeof item !== "object") return "";
    const row = item as Record<string, unknown>;
    return normalizeString(row.path ?? row.file ?? row.filePath ?? row.relativePath ?? row.name);
}

function getRequestedUsageFromModelItem(item: unknown, inventoryFile: ProjectInventoryFile): SelectedTaskFileUsage {
    if (!item || typeof item !== "object") return defaultUsageForFile(inventoryFile);
    const row = item as Record<string, unknown>;
    return isValidUsage(row.usage) ? row.usage : defaultUsageForFile(inventoryFile);
}

function getReasonFromModelItem(item: unknown) {
    if (!item || typeof item !== "object") return "Selected by Ollama file selector from real project inventory.";
    return normalizeString((item as Record<string, unknown>).reason, "Selected by Ollama file selector from real project inventory.").slice(0, 260);
}

function getConfidenceFromModelItem(item: unknown) {
    if (!item || typeof item !== "object") return 0.65;
    return normalizeConfidence((item as Record<string, unknown>).confidence);
}

function appendFallbackFilesIfNeeded(selectedFiles: SelectedTaskFile[], input: SelectTaskFilesInput, fallback: TaskFileSelection) {
    if (selectedFiles.length >= MIN_MODEL_SELECTED_FILES) return selectedFiles;

    const seen = new Set(selectedFiles.map((file) => normalizeForCompare(file.path)));
    const next = [...selectedFiles];

    for (const fallbackFile of fallback.selectedFiles) {
        if (next.length >= MIN_MODEL_SELECTED_FILES) break;
        if (seen.has(normalizeForCompare(fallbackFile.path))) continue;
        next.push({ ...fallbackFile, reason: `${fallbackFile.reason} Added because Ollama selected too few valid files after semantic validation.` });
        seen.add(normalizeForCompare(fallbackFile.path));
    }

    return next;
}

function normalizeModelSelection(value: unknown, input: SelectTaskFilesInput, fallback: TaskFileSelection, startedAt: number): TaskFileSelection {
    const modelFiles = getModelFileItems(value);
    const effectiveTaskArea = fallback.effectiveTaskArea;
    const assetMode = fallback.assetMode;
    const tokenContext = buildTokenContext(input);
    const constraints = getTaskConstraints(input);

    if (modelFiles.length === 0) {
        return {
            ...fallback,
            durationMs: getDurationMs(startedAt),
            notes: [...fallback.notes, "Ollama file selector returned invalid or empty JSON file list."]
        };
    }

    const inventoryByPath = new Map(input.inventory.files.map((file) => [normalizeForCompare(file.path), file]));
    const selectedFiles: SelectedTaskFile[] = [];
    const rejectedModelPaths = [...fallback.rejectedModelPaths];
    const seen = new Set<string>();

    for (const item of modelFiles) {
        const rawPath = getPathFromModelItem(item);
        const normalizedPath = normalizeForCompare(rawPath);
        if (!normalizedPath) continue;

        const inventoryFile = inventoryByPath.get(normalizedPath);
        if (!inventoryFile) {
            rejectedModelPaths.push(rawPath);
            continue;
        }

        if (!isModelFileSemanticallyUseful(inventoryFile, input, effectiveTaskArea, assetMode, tokenContext)) {
            rejectedModelPaths.push(`${inventoryFile.path} (rejected by semantic quality gate)`);
            continue;
        }

        if (seen.has(normalizedPath)) continue;
        seen.add(normalizedPath);

        selectedFiles.push({
            path: inventoryFile.path,
            kind: inventoryFile.kind,
            usage: sanitizeUsageForFile(inventoryFile, getRequestedUsageFromModelItem(item, inventoryFile)),
            reason: getReasonFromModelItem(item),
            confidence: getConfidenceFromModelItem(item)
        });
    }

    const completedSelection = ensureHelpfulCoverage(
        appendFallbackFilesIfNeeded(selectedFiles, input, fallback),
        input,
        effectiveTaskArea,
        assetMode
    );

    if (completedSelection.length === 0) {
        return {
            ...fallback,
            rejectedModelPaths,
            durationMs: getDurationMs(startedAt),
            notes: [...fallback.notes, "Ollama file selector did not select any semantically valid inventory paths."]
        };
    }

    const wasAugmented = completedSelection.length > selectedFiles.length;
    const semanticRejectedCount = rejectedModelPaths.filter((item) => item.includes("semantic quality gate")).length;

    return {
        selectedFiles: completedSelection,
        rejectedModelPaths,
        source: "ollama",
        usedFallback: false,
        durationMs: getDurationMs(startedAt),
        effectiveTaskArea,
        assetMode,
        conflictNote: fallback.conflictNote,
        notes: [
            ...getModelNotes(value),
            `Effective task area: ${effectiveTaskArea}.`,
            `Asset mode: ${assetMode}.`,
            `Composer file limit for "${effectiveTaskArea}": ${getSelectionLimitFromSettings(input, effectiveTaskArea, assetMode)}.`,
            fallback.conflictNote ?? "No task type conflict detected.",
            ...constraints.notes,
            semanticRejectedCount > 0
                ? `Rejected ${semanticRejectedCount} real but semantically weak model-selected path(s).`
                : "No semantically weak model-selected paths were accepted.",
            rejectedModelPaths.length > 0
                ? `Rejected ${rejectedModelPaths.length} model-selected or user-mentioned path(s) because they were invalid, unsafe, generated, absent, or semantically weak.`
                : "All selected paths were validated against project inventory and semantic quality gates.",
            wasAugmented
                ? "Selection was augmented with fallback-ranked files because Ollama selected too few valid files or needed coverage balancing."
                : "Selection was produced by Ollama and validated by ContextForge."
        ]
    };
}

export async function selectTaskFiles(input: SelectTaskFilesInput): Promise<TaskFileSelection> {
    const startedAt = Date.now();
    const settings = await getAppSettings();
    const inputWithSettings: SelectTaskFilesInput = {
        ...input,
        settings
    };

    const fallback = buildFallbackSelection(inputWithSettings);

    if (settings.generationMode !== "ollama" || !settings.defaultOllamaModel) {
        return { ...fallback, durationMs: getDurationMs(startedAt) };
    }

    try {
        const response = await fetch(`${settings.ollamaUrl.replace(/\/$/, "")}/api/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: settings.defaultOllamaModel,
                prompt: buildSelectorPrompt(inputWithSettings),
                stream: false,
                format: "json",
                options: { temperature: 0, num_predict: 1100 }
            })
        });

        if (!response.ok) {
            return {
                ...fallback,
                durationMs: getDurationMs(startedAt),
                notes: [...fallback.notes, `Ollama file selector responded with status ${response.status}.`]
            };
        }

        const data = (await response.json()) as OllamaGenerateResponse;
        const json = extractJsonObject(String(data.response ?? ""));
        return normalizeModelSelection(json, inputWithSettings, fallback, startedAt);
    } catch (error) {
        return {
            ...fallback,
            durationMs: getDurationMs(startedAt),
            notes: [
                ...fallback.notes,
                error instanceof Error ? `Ollama file selector failed: ${error.message}` : "Ollama file selector failed."
            ]
        };
    }
}
