import { getAppSettings } from "../settings/settingsService.js";
import { resolveExplicitFileMentions } from "../selection/explicitFileMentions.js";
import type {
    ProjectInventory,
    ProjectInventoryFile,
    ProjectInventoryFileKind
} from "../scanner/projectInventoryScanner.js";
import type { StructuredIntentTarget, TaskIntentAnalysis, TaskArea } from "./taskIntentAnalyzer.js";

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
const SELECTOR_SAFETY_PROFILE = "ui-specific-target-review-v5";

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

function matchesAny(value: string, patterns: RegExp[]) {
    const normalized = normalizeForCompare(value);
    return patterns.some((pattern) => pattern.test(normalized));
}

function hasRuntimeNoBackendConstraint(rawTask: string) {
    return matchesAny(rawTask, [
        /\b(?:backend|api|server|auth|authorization|authentication|session|token|cookie|database|db)\b[^.!?\n]{0,120}\b(?:do\s+not|don't|dont)\s+(?:touch|change|edit|modify)\b/i,
        /\b(?:do\s+not|don't|dont)\s+(?:touch|change|edit|modify)\b[^.!?\n]{0,120}\b(?:backend|api|server|auth|authorization|authentication|session|token|cookie|database|db)\b/i,
        /(?:\u0431\u044d\u043a|\u0431\u0435\u043a|\u0431\u044d\u043a\u0435\u043d\u0434|\u0431\u0435\u043a\u0435\u043d\u0434|\u0430\u043f\u0438|api|\u0441\u0435\u0440\u0432\u0435\u0440|\u0430\u0432\u0442\u043e\u0440\u0438\u0437\u0430\u0446|\u0430\u0443\u0442\u0435\u043d\u0442\u0438\u0444|\u0441\u0435\u0441\u0441|\u0442\u043e\u043a\u0435\u043d|\u043a\u0443\u043a\u0438|\u0431\u0430\u0437\u0430|\u0431\u0434)[^.!?\n]{0,120}\u043d\u0435\s+(?:\u0442\u0440\u043e\u0433\u0430\u0439|\u0442\u0440\u043e\u0433\u0430\u0442\u044c|\u043c\u0435\u043d\u044f\u0439|\u043c\u0435\u043d\u044f\u0442\u044c|\u0440\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u0443\u0439|\u0440\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u0442\u044c|\u0438\u0437\u043c\u0435\u043d\u044f\u0439|\u0438\u0437\u043c\u0435\u043d\u044f\u0442\u044c)/i,
        /\u043d\u0435\s+(?:\u0442\u0440\u043e\u0433\u0430\u0439|\u0442\u0440\u043e\u0433\u0430\u0442\u044c|\u043c\u0435\u043d\u044f\u0439|\u043c\u0435\u043d\u044f\u0442\u044c|\u0440\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u0443\u0439|\u0440\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u0442\u044c|\u0438\u0437\u043c\u0435\u043d\u044f\u0439|\u0438\u0437\u043c\u0435\u043d\u044f\u0442\u044c)[^.!?\n]{0,120}(?:\u0431\u044d\u043a|\u0431\u0435\u043a|\u0431\u044d\u043a\u0435\u043d\u0434|\u0431\u0435\u043a\u0435\u043d\u0434|\u0430\u043f\u0438|api|\u0441\u0435\u0440\u0432\u0435\u0440|\u0430\u0432\u0442\u043e\u0440\u0438\u0437\u0430\u0446|\u0430\u0443\u0442\u0435\u043d\u0442\u0438\u0444|\u0441\u0435\u0441\u0441|\u0442\u043e\u043a\u0435\u043d|\u043a\u0443\u043a\u0438|\u0431\u0430\u0437\u0430|\u0431\u0434)/i
    ]);
}

function hasRuntimeUiSurfaceTerm(rawTask: string) {
    return matchesAny(rawTask, [
        /\b(?:ui|ux|frontend|front-end|screen|page|layout|visual|design|style|css|button|form|input|modal|card|navigation|nav|navbar|header|topbar|menu|theme|account)\b/i,
        /(?:\u044d\u043a\u0440\u0430\u043d|\u0441\u0442\u0440\u0430\u043d\u0438\u0446|\u0432\u0438\u0437\u0443\u0430\u043b|\u0434\u0438\u0437\u0430\u0439\u043d|\u0432\u043d\u0435\u0448\u043d|\u0441\u0442\u0438\u043b|\u043a\u043d\u043e\u043f|\u0444\u043e\u0440\u043c|\u043f\u043e\u043b\u0435|\u043c\u043e\u0434\u0430\u043b|\u043a\u0430\u0440\u0442\u043e\u0447|\u043d\u0430\u0432\u0438\u0433\u0430\u0446|\u0448\u0430\u043f\u043a|\u0432\u0435\u0440\u0445\u043d\u0435\u0435\s+\u043c\u0435\u043d\u044e|\u043f\u0435\u0440\u0435\u043a\u043b\u044e\u0447\u0430\u0442\u0435\u043b\u044c\s+\u0442\u0435\u043c|\u043a\u043d\u043e\u043f\u043a\u0430\s+\u0430\u043a\u043a\u0430\u0443\u043d\u0442|\u0435\u0434\u0435\u0442\s+\u0432\u043f\u0440\u0430\u0432\u043e)/i
    ]);
}

interface TaskConstraints {
    noBackendMutation: boolean;
    noFrontendMutation: boolean;
    onlyExplicitFiles: boolean;
    protectOtherPages: boolean;
    runtimeNoBackendConstraint: boolean;
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
            const afterBut = clause.split(/(?:^|\s)(?:но|but|however)(?:\s|$)/gi).pop()?.trim() ?? clause;
            // Skip positive task clauses such as "improve navigation and do not change other files".
            if (/(?:улучш|сдел|замен|добав|реализ|подключ|исправ|передел)/i.test(afterBut)
                || /\b(?:improve|make|replace|add|implement|connect|fix|change)\b/i.test(afterBut)) continue;
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
        // Universal technical/UI vocabulary, not business-domain project rules.
        if (token.startsWith("шап") || token === "header") ["header", "nav", "navigation", "navbar", "topbar"].forEach((item) => expanded.add(item));
        if (token.startsWith("фут") || token.startsWith("footer")) ["footer", "foot"].forEach((item) => expanded.add(item));
        if (token.startsWith("контакт") || token.startsWith("contact")) ["contact", "contacts", "контакт", "контакты"].forEach((item) => expanded.add(item));
        if (token.startsWith("достав") || token.startsWith("deliver")) ["delivery", "deliver", "shipping", "достав", "доставка"].forEach((item) => expanded.add(item));
        if (token.startsWith("роут") || token.startsWith("route")) ["route", "routes", "routing", "роут", "роуты"].forEach((item) => expanded.add(item));
        if (token.startsWith("таблиц") || token.startsWith("table")) ["table", "tables", "таблица", "таблицы"].forEach((item) => expanded.add(item));
        if (token.startsWith("ридми") || token === "readme") ["readme", "readme.md", "docs"].forEach((item) => expanded.add(item));
        if (token === "api" || token === "апи") ["api", "endpoint", "service"].forEach((item) => expanded.add(item));
        if (token.startsWith("запрос") || token.startsWith("request")) ["api", "request", "requests", "fetch", "axios"].forEach((item) => expanded.add(item));
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
    const runtimeNoBackendConstraint = hasRuntimeNoBackendConstraint(rawTask);
    const protectedFileTerms = uniqueStrings([
        ...extractNegativeConstraintTerms(rawTask),
        ...extractProtectedRouteTermsFromInventory(rawTask, input.inventory),
        ...(runtimeNoBackendConstraint
            ? [
                "backend", "server", "api", "auth", "authorization", "authentication",
                "session", "token", "cookie", "database", "db",
                "бэк", "бек", "бэкенд", "бекенд", "апи", "авторизац", "аутентиф", "сесс", "токен", "куки", "база", "бд"
            ]
            : [])
    ]);
    const hasProtectedApiTerms = protectedFileTerms.some((term) => ["api", "endpoint", "service", "request", "requests", "fetch", "axios"].includes(normalizeForCompare(term)));

    const noBackendMutation = runtimeNoBackendConstraint || hasProtectedApiTerms || includesAny(rawTask, [
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

    return {
        noBackendMutation,
        noFrontendMutation,
        onlyExplicitFiles,
        protectOtherPages,
        runtimeNoBackendConstraint,
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

function isBackendProtectedRole(file: ProjectInventoryFile) {
    return ["api-route", "client-api", "service", "repository", "db-schema", "server-entry"].includes(file.role);
}

function isBackendProtectedPath(file: ProjectInventoryFile) {
    const filePath = normalizeForCompare(file.path);
    return filePath.startsWith("server/")
        || filePath.includes("/server/")
        || filePath.startsWith("backend/")
        || filePath.includes("/backend/")
        || filePath.startsWith("src/api/")
        || filePath.includes("/src/api/")
        || filePath.includes("/api/")
        || filePath.includes("/routes/")
        || filePath.includes("/services/");
}

function isAuthProtectedFile(file: ProjectInventoryFile) {
    const fileText = normalizeForCompare([
        file.path,
        file.name,
        file.role,
        ...(file.exports ?? [])
    ].join(" "));

    if (includesAny(fileText, [
        "auth", "authorization", "authentication", "session", "token", "cookie",
        "авторизац", "аутентиф", "сесс", "токен", "куки"
    ])) {
        return true;
    }

    return ["store", "service", "repository"].includes(file.role) && includesAny((file.textHints ?? []).join(" "), [
        "auth", "authorization", "authentication", "session", "token", "cookie",
        "авторизац", "аутентиф", "сесс", "токен", "куки"
    ]);
}

function isBackendOrAuthProtectedSupportFile(file: ProjectInventoryFile) {
    return isBackendProtectedRole(file)
        || isBackendProtectedPath(file)
        || isAuthProtectedFile(file)
        || isServerSidePath(file.path)
        || isClientApiBridgePath(file.path)
        || (isBackendLeaningPath(file.path) && !isClientUiPath(file.path));
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
    const hasUi = hasRuntimeUiSurfaceTerm(input.rawTask) || includesAny(text, ["ui", "ux", "screen", "page", "layout", "visual", "design", "style", "css", "button", "form", "input", "focus", "modal", "card", "navigation", "header", "frontend", "component", "экран", "страниц", "визуал", "дизайн", "кноп", "форма", "пол", "фокус", "модал", "карточ", "навигац", "шапк", "дороже", "чище", "деревян", "дефолт"]);

    if (hasApi || hasAuth || hasServer) scores.backend += 5;
    if (hasApi && hasAuth) scores.backend += 8;
    if (hasUi) scores.ui += 5;

    const positiveExplicitResolution = resolveExplicitFileMentions(getPositiveTaskText(input.rawTask), input.inventory);
    const positiveExplicitFiles = positiveExplicitResolution.existingPaths
        .map((pathValue) => findInventoryFile(input.inventory, pathValue))
        .filter(Boolean) as ProjectInventoryFile[];
    if (positiveExplicitFiles.some((file) => isClientUiPath(file.path))) scores.ui += 12;
    if (positiveExplicitFiles.some((file) => isBackendLeaningPath(file.path) || isClientApiBridgePath(file.path))) scores.backend += 8;
    const explicitRouteMentions = extractRouteMentions(input.rawTask);
    if (explicitRouteMentions.length > 0 || extractNaturalRouteMentions(input, explicitRouteMentions).length > 0 || includesAny(getPositiveTaskText(input.rawTask), ["на странице", "страница", "page", "route"])) scores.ui += 7;

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

    if (constraints.noBackendMutation && hasUi) {
        scores.ui += 10;
        scores.backend -= 10;
        scores.fullstack -= 8;
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
    addSemanticTokenIfIncludes(tokens, text, ["навигац", "navigation", "navbar", "верхнее меню", "меню", "theme", "account", "тема", "аккаунт"], ["nav", "navigation", "navbar", "topbar", "header", "menu", "theme", "account"]);
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

interface InventoryRouteCandidate {
    route: string;
    routeSegments: string[];
    evidenceTokens: string[];
    hasPageFile: boolean;
}

function normalizeRouteValue(route: string) {
    const normalized = normalizePath(route).toLowerCase().trim();
    if (!normalized || normalized === "/") return normalized || "/";
    return `/${normalized.replace(/^\/+|\/+$/g, "")}`.replace(/\/+/g, "/");
}

function getRouteSegmentsFromRoute(route: string) {
    return tokenize(route)
        .map((token) => token.replace(/^:/, ""))
        .filter((token) => token.length >= 3 && !BROAD_PATH_TOKENS.has(token));
}

function extractHrefRouteEvidence(text: string) {
    const rows: Array<{ route: string; evidence: string }> = [];
    const patterns = [
        /\b(?:href|to)\s*[:=]\s*["'`]((?:\/[a-zа-яё0-9_@()[\]:.-]+)+)["'`]/gi,
        /<a[^>]+href=["'`]((?:\/[a-zа-яё0-9_@()[\]:.-]+)+)["'`][^>]*>([\s\S]{0,120}?)<\/a>/gi,
        /<Link[^>]+href=["'`]((?:\/[a-zа-яё0-9_@()[\]:.-]+)+)["'`][^>]*>([\s\S]{0,160}?)<\/Link>/gi
    ];

    for (const pattern of patterns) {
        for (const match of text.matchAll(pattern)) {
            const route = normalizeRouteValue(match[1] ?? "");
            if (!route || route.includes("//") || /\.[a-z0-9]+$/i.test(route)) continue;
            const start = Math.max(0, (match.index ?? 0) - 90);
            const end = Math.min(text.length, (match.index ?? 0) + String(match[0] ?? "").length + 90);
            rows.push({ route, evidence: `${text.slice(start, end)} ${match[2] ?? ""}` });
        }
    }

    return rows;
}

function addRouteCandidate(
    map: Map<string, InventoryRouteCandidate>,
    routeValue: string,
    evidenceParts: string[],
    hasPageFile = false
) {
    const route = normalizeRouteValue(routeValue);
    if (!route || route.includes("//") || /\.[a-z0-9]+$/i.test(route)) return;

    const current = map.get(route) ?? {
        route,
        routeSegments: getRouteSegmentsFromRoute(route),
        evidenceTokens: [],
        hasPageFile: false
    };

    current.hasPageFile = current.hasPageFile || hasPageFile;
    current.evidenceTokens = uniqueStrings([
        ...current.evidenceTokens,
        ...tokenize(evidenceParts.join(" ")).filter((token) => token.length >= 3 && !NEGATIVE_CONSTRAINT_STOP_WORDS.has(token))
    ]).slice(0, 80);

    map.set(route, current);
}

function getInventoryRouteCandidates(inventory: ProjectInventory) {
    const map = new Map<string, InventoryRouteCandidate>();

    for (const file of inventory.files) {
        const fileEvidence = [
            file.path,
            file.name,
            file.role,
            file.routePath ?? "",
            ...(file.symbols ?? []),
            ...(file.exports ?? []),
            ...(file.textHints ?? [])
        ];

        if (file.routePath) {
            addRouteCandidate(map, file.routePath, fileEvidence, file.role === "page" || file.name.toLowerCase().startsWith("page."));
        }

        const content = [file.contentPreview ?? "", ...(file.textHints ?? [])].join(" ");
        for (const row of extractHrefRouteEvidence(content)) {
            addRouteCandidate(map, row.route, [row.evidence, file.path, file.name], false);
        }
    }

    return Array.from(map.values()).filter((candidate) => candidate.route !== "/");
}

function routeCandidateMatchesTask(candidate: InventoryRouteCandidate, taskTokens: string[]) {
    let score = 0;

    for (const token of taskTokens) {
        if (candidate.routeSegments.some((segment) => normalizedTermMatches(segment, token) || normalizedTermMatches(token, segment))) {
            score += 44;
            continue;
        }

        if (candidate.evidenceTokens.some((evidence) => normalizedTermMatches(evidence, token) || normalizedTermMatches(token, evidence))) {
            score += 18;
        }
    }

    if (candidate.hasPageFile && score > 0) score += 18;
    return score;
}

function extractNaturalRouteMentions(input: SelectTaskFilesInput, explicitRoutes: string[]) {
    const positiveText = getPositiveTaskText(input.rawTask);
    const taskTokens = uniqueStrings(tokenize([
        positiveText,
        ...(input.taskIntent?.domainTerms ?? []),
        ...(input.taskIntent?.mentionedEntities ?? []),
        ...(input.taskIntent?.recommendedSearchTerms ?? [])
    ].join(" ")))
        .filter((token) => !WEAK_TASK_TOKENS.has(token))
        .filter((token) => !BROAD_PATH_TOKENS.has(token));

    if (taskTokens.length === 0) return [];

    const hasPageLanguage = includesAny(positiveText, [
        "страниц", "раздел", "route", "page", "screen", "экран", "вкладк", "секци"
    ]);

    const existing = new Set(explicitRoutes.map(normalizeRouteValue));

    return getInventoryRouteCandidates(input.inventory)
        .filter((candidate) => !existing.has(candidate.route))
        .map((candidate) => ({ candidate, score: routeCandidateMatchesTask(candidate, taskTokens) + (hasPageLanguage ? 10 : 0) }))
        .filter((row) => row.score >= 28)
        .sort((a, b) => b.score - a.score)
        .map((row) => row.candidate.route)
        .slice(0, 5);
}

function extractProtectedRouteTermsFromInventory(rawTask: string, inventory: ProjectInventory) {
    const negativeTokens = uniqueStrings(tokenize(getNegativeConstraintPhrases(rawTask).join(" ")))
        .filter((token) => !NEGATIVE_CONSTRAINT_STOP_WORDS.has(token));

    if (negativeTokens.length === 0) return [];

    const terms = new Set<string>();
    for (const candidate of getInventoryRouteCandidates(inventory)) {
        const score = routeCandidateMatchesTask(candidate, negativeTokens);
        if (score < 18) continue;

        for (const segment of candidate.routeSegments) terms.add(segment);
        terms.add(candidate.route.replace(/^\//, ""));
    }

    return Array.from(terms).filter(Boolean);
}

function buildTokenContext(input: SelectTaskFilesInput): TokenContext {
    const positiveTaskText = getPositiveTaskText(input.rawTask);
    const explicitResolution = resolveExplicitFileMentions(positiveTaskText, input.inventory);
    const explicitExistingPaths = explicitResolution.existingPaths;
    const explicitMissingPaths = explicitResolution.missingPaths;
    const explicitRouteMentions = extractRouteMentions(input.rawTask);
    const routeMentions = uniqueStrings([
        ...explicitRouteMentions,
        ...extractNaturalRouteMentions(input, explicitRouteMentions)
    ]);
    const routeSegments = getRouteMentionSegments(routeMentions);

    const rawTokens = tokenize(positiveTaskText);
    const semanticTokens = buildSemanticTokens(input);
    const supportedStructuredTargets = (input.taskIntent?.structuredIntent?.primaryTargets ?? [])
        .filter((target) => structuredTargetHasTaskSupport(input, target));
    const intentTokens = tokenize([
        ...(input.taskIntent?.domainTerms ?? []),
        ...(input.taskIntent?.mentionedEntities ?? []),
        ...(input.taskIntent?.recommendedSearchTerms ?? []),
        ...supportedStructuredTargets.flatMap((target) => [
            target.value,
            target.path ?? "",
            target.routePath ?? "",
            target.name ?? "",
            target.evidence
        ]),
        ...(input.taskIntent?.structuredIntent?.positiveActions ?? [])
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

function isSystemSeoFile(file: ProjectInventoryFile) {
    const filePath = normalizeForCompare(file.path);
    const fileName = filePath.split("/").pop() ?? filePath;
    return fileName === "robots.ts"
        || fileName === "robots.js"
        || fileName === "sitemap.ts"
        || fileName === "sitemap.js"
        || fileName === "manifest.json"
        || fileName === "site.webmanifest"
        || fileName.startsWith("manifest.")
        || fileName.startsWith("metadata.");
}

function isSystemSeoRelevantForTask(input: SelectTaskFilesInput) {
    const text = normalizeForCompare(getPositiveTaskText(input.rawTask));
    return includesAny(text, [
        "seo", "sitemap", "robots", "metadata", "manifest", "indexing", "canonical", "open graph", "opengraph",
        "сео", "индексац", "робот", "сайтмап", "карта сайта", "метадан", "мета-тег", "og image", "canonical"
    ]);
}

function hasProtectedShellOrGlobalTerms(constraints: TaskConstraints) {
    return constraints.protectedFileTerms.some((term) => {
        const normalized = normalizeForCompare(term);
        return [
            "header", "nav", "navigation", "navbar", "topbar", "шап",
            "footer", "foot", "фут",
            "layout", "shell", "root", "global", "globals", "глобаль",
            "seo", "robots", "sitemap", "metadata", "manifest", "сео"
        ].some((needle) => normalized.includes(needle));
    });
}

function isAppShellOrEntrypointFile(file: ProjectInventoryFile) {
    const filePath = normalizeForCompare(file.path);
    const fileName = filePath.split("/").pop() ?? filePath;

    return fileName === "layout.tsx"
        || fileName === "layout.jsx"
        || fileName === "layout.ts"
        || fileName === "layout.js"
        || filePath === "src/index.js"
        || filePath === "src/index.tsx"
        || filePath === "src/main.js"
        || filePath === "src/main.tsx"
        || filePath === "src/app.js"
        || filePath === "src/app.jsx"
        || filePath === "src/app.tsx"
        || filePath === "app/layout.tsx"
        || filePath === "app/layout.jsx";
}

function isGenericSharedUiPrimitive(file: ProjectInventoryFile) {
    const filePath = normalizeForCompare(file.path);
    const fileName = filePath.split("/").pop() ?? filePath;

    if (!filePath.includes("/ui/") && !filePath.includes("/shared/")) return false;
    return [
        "button", "input", "textarea", "select", "checkbox", "radio", "toast",
        "dropdown", "modal", "dialog", "popover", "tooltip", "card"
    ].some((part) => fileName.includes(part));
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

function isRouteScopedTask(input: SelectTaskFilesInput, area: EffectiveTaskArea, tokenContext: TokenContext) {
    return tokenContext.routeMentions.length > 0 && isSpecificPageOrFileTask(input, area);
}

function isDirectRoutePageMatch(file: ProjectInventoryFile, routeMentions: string[]) {
    if (routeMentions.length === 0) return false;

    const filePath = normalizeForCompare(file.path);
    const routePath = normalizeForCompare(file.routePath ?? "");
    const fileName = filePath.split("/").pop() ?? filePath;
    const pageLike = file.role === "page" || ["page.tsx", "page.jsx", "page.ts", "page.js"].includes(fileName);

    if (!pageLike) return false;

    for (const route of routeMentions) {
        const normalizedRoute = normalizeForCompare(route).replace(/^\/+|\/+$/g, "");
        if (!normalizedRoute) continue;

        if (routePath === `/${normalizedRoute}` || routePath.endsWith(`/${normalizedRoute}`)) return true;
        if (filePath.endsWith(`/${normalizedRoute}/page.tsx`)
            || filePath.endsWith(`/${normalizedRoute}/page.jsx`)
            || filePath.endsWith(`/${normalizedRoute}/page.ts`)
            || filePath.endsWith(`/${normalizedRoute}/page.js`)) return true;
    }

    return false;
}


function isHomePageTask(input: SelectTaskFilesInput) {
    return includesAny(getPositiveTaskText(input.rawTask), [
        "главн", "homepage", "home page", "landing", "главная", "лендинг", "main page", "root page", "index page"
    ]);
}

function isRootPageFile(file: ProjectInventoryFile) {
    const filePath = normalizeForCompare(file.path);
    const routePath = normalizeForCompare(file.routePath ?? "");

    return routePath === "/"
        || filePath === "src/app/page.tsx"
        || filePath === "app/page.tsx"
        || filePath === "src/pages/index.tsx"
        || filePath === "src/pages/index.jsx"
        || filePath === "src/pages/index.ts"
        || filePath === "src/pages/index.js"
        || filePath === "pages/index.tsx"
        || filePath === "pages/index.jsx"
        || filePath === "pages/index.ts"
        || filePath === "pages/index.js";
}

function isPageLikeTargetFile(file: ProjectInventoryFile) {
    const filePath = normalizeForCompare(file.path);
    const fileName = filePath.split("/").pop() ?? filePath;

    if (file.role === "api-route" || ["route.ts", "route.js"].includes(fileName) || filePath.includes("/app/api/")) {
        return false;
    }

    return file.role === "page"
        || ["page.tsx", "page.jsx", "page.ts", "page.js"].includes(fileName)
        || Boolean(file.routePath && (filePath.includes("/pages/") || filePath.includes("/app/")));
}

function isWeakPageTargetToken(token: string) {
    const normalized = normalizeForCompare(token).replace(/^[^a-zа-яё0-9]+|[^a-zа-яё0-9]+$/gi, "");
    if (!normalized) return true;
    if (WEAK_TASK_TOKENS.has(normalized) || BROAD_PATH_TOKENS.has(normalized) || NEGATIVE_CONSTRAINT_STOP_WORDS.has(normalized)) return true;

    return [
        "сайт", "страниц", "компан", "клиент", "данн", "подач", "понят", "быстро",
        "плохо", "формаль", "аккурат", "выгляд", "помог", "сдел", "нужно", "надо",
        "site", "client", "customer", "company", "data", "info", "content", "formal", "understand"
    ].some((prefix) => normalized.startsWith(prefix));
}

function getPositiveTargetTokens(input: SelectTaskFilesInput) {
    const negativeTerms = new Set(extractNegativeConstraintTerms(input.rawTask).map(normalizeForCompare));
    const tokens = uniqueNormalizedTokens(tokenize([
        getPositiveTaskText(input.rawTask),
        ...(input.taskIntent?.domainTerms ?? []),
        ...(input.taskIntent?.mentionedEntities ?? []),
        ...(input.taskIntent?.recommendedSearchTerms ?? []),
        ...(input.taskIntent?.structuredIntent?.primaryTargets ?? []).flatMap((target) => [
            target.value,
            target.path ?? "",
            target.routePath ?? "",
            target.name ?? ""
        ])
    ].join(" ")));

    return tokens
        .filter((token) => token.length >= 3)
        .filter((token) => !isWeakPageTargetToken(token))
        .filter((token) => !negativeTerms.has(token))
        .filter((token) => !token.includes("/") && !token.includes("\\"))
        .slice(0, 24);
}

function getGroundedPositiveTargetTokens(input: SelectTaskFilesInput) {
    const negativeTerms = new Set(extractNegativeConstraintTerms(input.rawTask).map(normalizeForCompare));
    const supportedStructuredTargets = (input.taskIntent?.structuredIntent?.primaryTargets ?? [])
        .filter((target) => structuredTargetHasTaskSupport(input, target));
    const tokens = uniqueNormalizedTokens(tokenize([
        getPositiveTaskText(input.rawTask),
        ...supportedStructuredTargets.flatMap((target) => [
            target.value,
            target.path ?? "",
            target.routePath ?? "",
            target.name ?? ""
        ])
    ].join(" ")));

    return tokens
        .filter((token) => token.length >= 3)
        .filter((token) => !isWeakPageTargetToken(token))
        .filter((token) => !negativeTerms.has(token))
        .filter((token) => !token.includes("/") && !token.includes("\\"))
        .slice(0, 24);
}

function filePartMatchesToken(value: string, token: string) {
    const normalized = normalizeForCompare(value);
    return normalizedTermMatches(normalized, token) || normalizedTermMatches(token, normalized);
}

function countTokenMatchesInValues(tokens: string[], values: string[], weight: number) {
    let score = 0;
    let matches = 0;

    for (const token of tokens) {
        if (values.some((value) => filePartMatchesToken(value, token))) {
            score += weight;
            matches += 1;
        }
    }

    return { score, matches };
}

function getFileIdentityConstraintText(file: ProjectInventoryFile) {
    return normalizeForCompare([
        file.path,
        file.name,
        file.extension,
        file.kind,
        file.role,
        file.routePath ?? ""
    ].join(" "));
}

function hasProtectedIdentityTermMatch(file: ProjectInventoryFile, constraints: TaskConstraints, positiveTokens: string[] = []) {
    if (constraints.protectedFileTerms.length === 0) return false;
    const fileText = getFileIdentityConstraintText(file);

    return constraints.protectedFileTerms.some((term) => {
        if (!normalizedTermMatches(fileText, term)) return false;

        // If route protection was inferred too broadly from the inventory, do not let it
        // suppress a page that strongly matches the positive task target.
        // Direct path/route constraints still protect unrelated pages because their terms
        // will not be present in positiveTokens.
        return !positiveTokens.some((token) => normalizedTermMatches(term, token) || normalizedTermMatches(token, term));
    });
}

function canUseSemanticPageTargetFile(input: SelectTaskFilesInput, file: ProjectInventoryFile, area: EffectiveTaskArea, assetMode: AssetMode) {
    const constraints = getTaskConstraints(input);
    const positiveTokens = getPositiveTargetTokens(input);

    if (!isPageLikeTargetFile(file)) return false;
    if (isSensitiveEnvPath(file.path)) return false;
    if (isSystemSeoFile(file) && !isSystemSeoRelevantForTask(input)) return false;
    if (file.kind === "runtime" || file.kind === "asset" || file.kind === "data") return false;
    if (file.isLikelyGenerated) return false;
    if (isGeneratedDoNotEditPath(file.path) && area !== "build") return false;
    if (isLockFilePath(file.path)) return false;
    if (file.sizeBytes === 0) return false;
    // For page-target discovery, only protect by stable identity: path/name/route.
    // A valid page may contain links to forbidden pages such as contacts/policy,
    // and those links must not make the current page forbidden.
    if (hasProtectedIdentityTermMatch(file, constraints, positiveTokens)) return false;

    if (hasProtectedShellOrGlobalTerms(constraints) && isAppShellOrEntrypointFile(file)) return false;
    if (constraints.protectedFileTerms.some((term) => ["style", "styles", "css", "стил", "global", "globals", "глобаль"].includes(normalizeForCompare(term)))
        && isGlobalStyleFile(file)) {
        return false;
    }

    if (area === "backend" && isClientUiPath(file.path) && !isClientApiBridgePath(file.path)) return false;
    if (area === "ui" && isServerSidePath(file.path) && !file.routePath) return false;

    return true;
}

function getPageSemanticMatchScore(file: ProjectInventoryFile, input: SelectTaskFilesInput, tokenContext = buildTokenContext(input)) {
    if (!isPageLikeTargetFile(file)) return 0;
    if (isSystemSeoFile(file)) return 0;

    const positiveTokens = getPositiveTargetTokens(input);
    if (positiveTokens.length === 0) return 0;

    const filePath = normalizeForCompare(file.path);
    const routePath = normalizeForCompare(file.routePath ?? "");
    const routeSegments = tokenize(routePath).filter((token) => !BROAD_PATH_TOKENS.has(token));
    const pathSegments = tokenize(file.path).filter((token) => !BROAD_PATH_TOKENS.has(token));
    const symbolValues = [...(file.symbols ?? []), ...(file.exports ?? [])];
    const hintValues = file.textHints ?? [];
    const previewText = file.contentPreview ?? "";

    let score = 0;
    let matchedSignals = 0;
    let semanticMatches = 0;

    const routeMatch = countTokenMatchesInValues(positiveTokens, [...routeSegments, routePath], 56);
    score += routeMatch.score;
    matchedSignals += routeMatch.matches;

    const pathMatch = countTokenMatchesInValues(positiveTokens, [...pathSegments, filePath], 32);
    score += pathMatch.score;
    matchedSignals += pathMatch.matches;

    const hintMatch = countTokenMatchesInValues(positiveTokens, hintValues, 44);
    score += hintMatch.score;
    matchedSignals += hintMatch.matches;
    semanticMatches += hintMatch.matches;

    const symbolMatch = countTokenMatchesInValues(positiveTokens, symbolValues, 28);
    score += symbolMatch.score;
    matchedSignals += symbolMatch.matches;
    semanticMatches += symbolMatch.matches;

    for (const token of positiveTokens) {
        if (filePartMatchesToken(previewText, token)) {
            score += 26;
            matchedSignals += 1;
            semanticMatches += 1;
        }
    }

    const hasPageLanguage = includesAny(getPositiveTaskText(input.rawTask), [
        "страниц", "страница", "страницу", "странице", "раздел", "секци", "экран", "page", "route", "screen", "section", "view"
    ]);

    if (hasPageLanguage && matchedSignals > 0) score += 34;
    if (semanticMatches >= 1 && matchedSignals >= 1) score += 28;
    if (matchedSignals >= 2) score += 26;
    if (semanticMatches >= 2) score += 22;
    if (file.role === "page") score += 18;
    if (file.routePath) score += 14;

    if (isRootPageFile(file) && !isHomePageTask(input)) {
        score -= 160;
    }

    return score;
}

function taskAllowsMultipleConcretePageTargets(input: SelectTaskFilesInput, tokenContext: TokenContext) {
    if (tokenContext.routeMentions.length > 1) return true;
    if (getStructuredIntentTargets(input).filter((target) => target.kind === "page" || target.kind === "route").length > 1) return true;

    return matchesAny(getPositiveTaskText(input.rawTask), [
        /\b(?:pages|routes|screens|views|both|several|multiple)\b/i,
        /(?:\u0441\u0442\u0440\u0430\u043d\u0438\u0446(?:\u044b|\u0430\u0445|\u0430\u043c\u0438)|\u044d\u043a\u0440\u0430\u043d(?:\u044b|\u0430\u0445|\u0430\u043c\u0438)|\u0440\u0430\u0437\u0434\u0435\u043b(?:\u044b|\u0430\u0445|\u0430\u043c\u0438)|\u043e\u0431\u0435|\u043e\u0431\u0430|\u043d\u0435\u0441\u043a\u043e\u043b\u044c\u043a)/i
    ]);
}

function getConcretePageTargetLimit(input: SelectTaskFilesInput, area: EffectiveTaskArea, tokenContext: TokenContext) {
    if (!isSpecificPageOrFileTask(input, area)) return 2;
    return taskAllowsMultipleConcretePageTargets(input, tokenContext) ? 2 : 1;
}

function getSemanticPageTargetCandidates(input: SelectTaskFilesInput, area: EffectiveTaskArea, assetMode: AssetMode, tokenContext: TokenContext, selected: SelectedTaskFile[]) {
    if (!isSpecificPageOrFileTask(input, area)) return [];

    const seen = new Set(selected.map((file) => normalizeForCompare(file.path)));

    return input.inventory.files
        .filter((file) => !seen.has(normalizeForCompare(file.path)))
        .filter((file) => isPageLikeTargetFile(file))
        .filter((file) => !isRootPageFile(file) || isHomePageTask(input))
        .filter((file) => canUseSemanticPageTargetFile(input, file, area, assetMode))
        .map((file) => ({ file, score: getPageSemanticMatchScore(file, input, tokenContext) }))
        .filter((item) => item.score >= 112)
        .sort((a, b) => b.score - a.score)
        .slice(0, getConcretePageTargetLimit(input, area, tokenContext));
}

function hasSelectedConcretePageTarget(selected: SelectedTaskFile[], inventory: ProjectInventory) {
    return selected.some((selectedFile) => {
        const inventoryFile = findInventoryFile(inventory, selectedFile.path);
        return Boolean(inventoryFile && isPageLikeTargetFile(inventoryFile));
    });
}

function getSelectedConcretePageTargets(selected: SelectedTaskFile[], inventory: ProjectInventory) {
    return selected
        .map((selectedFile) => findInventoryFile(inventory, selectedFile.path))
        .filter((file): file is ProjectInventoryFile => Boolean(file && isPageLikeTargetFile(file)));
}

function getPrimaryConcretePageTargets(input: SelectTaskFilesInput, area: EffectiveTaskArea, tokenContext: TokenContext, pageTargets: ProjectInventoryFile[]) {
    const seen = new Set<string>();
    const uniqueTargets = pageTargets.filter((file) => {
        const key = normalizeForCompare(file.path);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    return uniqueTargets
        .map((file) => {
            const explicitBoost = tokenContext.explicitExistingPaths.some((pathValue) => normalizeForCompare(pathValue) === normalizeForCompare(file.path)) ? 600 : 0;
            const routeBoost = isDirectRoutePageMatch(file, tokenContext.routeMentions) ? 420 : getRouteMatchScore(file, tokenContext.routeMentions);
            return {
                file,
                score: explicitBoost + routeBoost + getPageSemanticMatchScore(file, input, tokenContext)
            };
        })
        .sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path))
        .slice(0, getConcretePageTargetLimit(input, area, tokenContext))
        .map((item) => item.file);
}

function scopeSelectionToPrimaryPageTargets(input: SelectTaskFilesInput, area: EffectiveTaskArea, assetMode: AssetMode, selected: SelectedTaskFile[]) {
    if (!isSpecificPageOrFileTask(input, area)) return selected;

    const tokenContext = buildTokenContext(input);
    const pageTargets = getSelectedConcretePageTargets(selected, input.inventory);
    if (pageTargets.length === 0) return selected;

    const primaryPageTargets = getPrimaryConcretePageTargets(input, area, tokenContext, pageTargets);
    if (primaryPageTargets.length === 0 || primaryPageTargets.length === pageTargets.length) return selected;

    const primaryPagePaths = new Set(primaryPageTargets.map((file) => normalizeForCompare(file.path)));
    const pageScopedSelected = selected.filter((file) => {
        const inventoryFile = findInventoryFile(input.inventory, file.path);
        return Boolean(inventoryFile && isPageLikeTargetFile(inventoryFile) && primaryPagePaths.has(normalizeForCompare(inventoryFile.path)));
    });

    pageScopedSelected.push(...getImportedReferenceFilesForPageTargets(input, primaryPageTargets, area, assetMode, pageScopedSelected));
    return pageScopedSelected;
}

function resolveImportToInventoryFile(sourceFile: ProjectInventoryFile, importPath: string, inventory: ProjectInventory) {
    const rawImport = normalizePath(importPath).trim();
    if (!rawImport || rawImport.startsWith("node:")) return undefined;
    if (/^[a-z0-9@][a-z0-9_.-]*(?:\/|$)/i.test(rawImport) && !rawImport.startsWith("@/")) return undefined;

    const sourceDir = sourceFile.path.split("/").slice(0, -1).join("/");
    let basePath = "";

    if (rawImport.startsWith("@/")) {
        basePath = `src/${rawImport.slice(2)}`;
    } else if (rawImport.startsWith("./") || rawImport.startsWith("../")) {
        const stack: string[] = sourceDir.split("/").filter(Boolean);
        for (const part of rawImport.split("/")) {
            if (!part || part === ".") continue;
            if (part === "..") stack.pop();
            else stack.push(part);
        }
        basePath = stack.join("/");
    } else {
        return undefined;
    }

    const normalizedBase = normalizeForCompare(basePath).replace(/\.(tsx|jsx|ts|js|mjs|cjs|css|scss|sass|less)$/i, "");
    const candidatePaths = [
        basePath,
        `${normalizedBase}.tsx`,
        `${normalizedBase}.jsx`,
        `${normalizedBase}.ts`,
        `${normalizedBase}.js`,
        `${normalizedBase}.css`,
        `${normalizedBase}.scss`,
        `${normalizedBase}/index.tsx`,
        `${normalizedBase}/index.jsx`,
        `${normalizedBase}/index.ts`,
        `${normalizedBase}/index.js`
    ].map(normalizeForCompare);

    return inventory.files.find((file) => candidatePaths.includes(normalizeForCompare(file.path)));
}

function getImportedReferenceFilesForPageTargets(input: SelectTaskFilesInput, pageTargets: ProjectInventoryFile[], area: EffectiveTaskArea, assetMode: AssetMode, selected: SelectedTaskFile[]) {
    const seen = new Set(selected.map((file) => normalizeForCompare(file.path)));
    const references: SelectedTaskFile[] = [];

    for (const page of pageTargets) {
        for (const importPath of page.imports ?? []) {
            if (references.length >= 4) return references;
            const imported = resolveImportToInventoryFile(page, importPath, input.inventory);
            if (!imported) continue;
            const normalized = normalizeForCompare(imported.path);
            if (seen.has(normalized)) continue;
            if (!canUsePageImportFile(input, page, imported, area)) continue;
            if (isAppShellOrEntrypointFile(imported) || isGlobalStyleFile(imported) || isSystemSeoFile(imported)) continue;
            if (isServerSidePath(imported.path) && area === "ui") continue;

            const usage = getPageImportUsage(input, page, imported);
            references.push(makeSelectedFile(
                imported,
                usage === "inspect-and-edit"
                    ? `Referenced by selected page target ${page.path} and matched the requested page scope; include as an editable supporting target.`
                    : `Referenced by selected page target ${page.path}; include as inspect-only supporting context, not as the primary edit target.`,
                usage === "inspect-and-edit" ? 0.76 : isGenericSharedUiPrimitive(imported) ? 0.62 : 0.68,
                usage
            ));
            seen.add(normalized);
        }
    }

    return references;
}

function isRouteLocalPageImport(page: ProjectInventoryFile, imported: ProjectInventoryFile) {
    const pageDir = normalizeForCompare(page.path).split("/").slice(0, -1).join("/");
    const importedPath = normalizeForCompare(imported.path);
    return Boolean(pageDir && importedPath.startsWith(`${pageDir}/`));
}

function canUsePageImportFile(input: SelectTaskFilesInput, page: ProjectInventoryFile, imported: ProjectInventoryFile, area: EffectiveTaskArea) {
    if (isSensitiveEnvPath(imported.path)) return false;
    if (isSystemSeoFile(imported) && !isSystemSeoRelevantForTask(input)) return false;
    if (imported.kind === "runtime" || imported.kind === "asset" || imported.kind === "data") return false;
    if (imported.isLikelyGenerated) return false;
    if (isGeneratedDoNotEditPath(imported.path) && area !== "build") return false;
    if (isLockFilePath(imported.path)) return false;
    if (imported.sizeBytes === 0) return false;
    if (area === "ui" && isServerSidePath(imported.path)) return false;

    const constraints = getTaskConstraints(input);
    if (constraints.noBackendMutation && isBackendOrAuthProtectedSupportFile(imported)) return false;

    const routeLocal = isRouteLocalPageImport(page, imported);
    if (routeLocal) return true;

    return !hasProtectedIdentityTermMatch(imported, constraints, getPositiveTargetTokens(input));
}

function getPageImportUsage(input: SelectTaskFilesInput, page: ProjectInventoryFile, imported: ProjectInventoryFile): SelectedTaskFileUsage {
    if (isGenericSharedUiPrimitive(imported)) return "inspect-only";
    if (imported.kind !== "source" && imported.kind !== "style") return "inspect-only";
    if (getTaskConstraints(input).noBackendMutation && isBackendOrAuthProtectedSupportFile(imported)) return "inspect-only";
    if (isRouteLocalPageImport(page, imported)) return "inspect-and-edit";

    const positiveTokens = getPositiveTargetTokens(input);
    if (positiveTokens.length === 0) return "inspect-only";

    const importedText = normalizeForCompare([
        imported.path,
        imported.name,
        imported.role,
        imported.routePath ?? "",
        ...(imported.symbols ?? []),
        ...(imported.exports ?? []),
        ...(imported.textHints ?? [])
    ].join(" "));

    return positiveTokens.some((token) => normalizedTermMatches(importedText, token) || normalizedTermMatches(token, importedText))
        ? "inspect-and-edit"
        : "inspect-only";
}

function isWithinRequestedRouteScope(file: ProjectInventoryFile, tokenContext: TokenContext) {
    const score = getRouteMatchScore(file, tokenContext.routeMentions);
    if (isDirectRoutePageMatch(file, tokenContext.routeMentions)) return true;

    // For specific page/route tasks, avoid broad UI primitives or app shell files
    // that only mention the route in content. Route scope should be path/route metadata driven.
    return score >= 88 && !isGenericSharedUiPrimitive(file) && !isAppShellOrEntrypointFile(file);
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

function getFileConstraintText(file: ProjectInventoryFile) {
    // Constraints should identify protected files/routes by stable inventory metadata.
    // Do not use full contentPreview here: a delivery page may link to contacts/catalog,
    // but that does not mean the delivery page itself is forbidden.
    return normalizeForCompare([
        file.path,
        file.name,
        file.extension,
        file.kind,
        file.role,
        file.routePath ?? "",
        ...(file.imports ?? []),
        ...(file.exports ?? []),
        ...(file.symbols ?? [])
    ].join(" "));
}

function isBackendProtectionTerm(term: string) {
    return [
        "backend", "server", "api", "auth", "authorization", "authentication",
        "session", "token", "cookie", "database", "db",
        "бэк", "бек", "бэкенд", "бекенд", "апи", "авторизац", "аутентиф", "сесс", "токен", "куки", "база", "бд"
    ].includes(normalizeForCompare(term));
}

function hasProtectedTermMatch(file: ProjectInventoryFile, constraints: TaskConstraints) {
    if (constraints.protectedFileTerms.length === 0) return false;
    const fileText = getFileConstraintText(file);
    return constraints.protectedFileTerms.some((term) => {
        if (constraints.runtimeNoBackendConstraint && !isBackendProtectionTerm(term) && hasRuntimeUiSurfaceTerm(term)) {
            return false;
        }
        if (!normalizedTermMatches(fileText, term)) return false;
        if (!isBackendProtectionTerm(term)) return true;

        return isBackendProtectedRole(file)
            || isBackendProtectedPath(file)
            || isAuthProtectedFile(file)
            || isServerSidePath(file.path)
            || isClientApiBridgePath(file.path)
            || (isBackendLeaningPath(file.path) && !isClientUiPath(file.path));
    });
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

    if (hasProtectedShellOrGlobalTerms(constraints) && isAppShellOrEntrypointFile(file)) {
        return true;
    }

    if (constraints.protectedFileTerms.some((term) => ["style", "styles", "css", "стил", "global", "globals", "глобаль"].includes(normalizeForCompare(term)))
        && isGlobalStyleFile(file)) {
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
    if (includesAny(text, [
        "в файле", "in file", "в компоненте", "in component",
        "на странице", "страница", "страницу", "странице", "страницы", "on page", "page", "page with",
        "раздел", "section", "screen", "экран", "вкладк", "view"
    ])) return true;
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
    const pageSemanticScore = getPageSemanticMatchScore(file, input, tokenContext);
    score += routeScore;
    score += Math.min(180, pageSemanticScore);

    const strongMatchCount = getStrongTokenMatchCountForFile(file, tokenContext.strongTokens);
    const hasStrongTokens = tokenContext.strongTokens.length > 0;
    const hasStrongMatch = strongMatchCount > 0;

    if (strongMatchCount >= 2) score += 20;
    if (strongMatchCount >= 3) score += 20;
    if (file.canReadText) score += 5;
    if (file.depth <= 3) score += 4;
    if (isSystemSeoFile(file) && !isSystemSeoRelevantForTask(input)) score -= 120;
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

    if (file.reason.toLowerCase().includes("structured task intent")) {
        priority += 520;
    }

    const tokenContextForPriority = buildTokenContext(input);
    const pathStrongMatchCount = getStrongTokenMatchCount(file.path, tokenContextForPriority.strongTokens);
    if (area === "ui" && file.kind === "source" && pathStrongMatchCount > 0 && isClientUiPath(file.path)) {
        priority += 110 + Math.min(60, pathStrongMatchCount * 20);
    }
    if (area === "ui" && file.kind === "style" && pathStrongMatchCount === 0 && !isGlobalStyleRelevantForTask(input)) {
        priority -= 25;
    }

    const routeScore = getRouteMatchScore({ path: file.path, kind: file.kind, sizeBytes: 1, canReadText: true, isLikelyGenerated: false, extension: "", depth: 0, name: file.path.split("/").pop() ?? file.path } as ProjectInventoryFile, tokenContextForPriority.routeMentions);
    if (isDirectRoutePageMatch({ path: file.path, kind: file.kind, sizeBytes: 1, canReadText: true, isLikelyGenerated: false, extension: "", depth: 0, name: file.path.split("/").pop() ?? file.path } as ProjectInventoryFile, tokenContextForPriority.routeMentions)) priority += 420;
    else if (routeScore >= 88) priority += 190;
    else if (routeScore > 0) priority += 35;
    if (file.reason.toLowerCase().includes("concrete page target")) priority += 360;

    if (isRouteScopedTask(input, area, tokenContextForPriority)) {
        if (isAppShellOrEntrypointFile({ path: file.path, kind: file.kind } as ProjectInventoryFile)) priority -= 260;
        if (isGenericSharedUiPrimitive({ path: file.path, kind: file.kind } as ProjectInventoryFile)) priority -= 120;
    }

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

function findInventoryFileByLoosePath(inventory: ProjectInventory, filePath: string) {
    const normalized = normalizeForCompare(filePath);
    if (!normalized) return undefined;

    return inventory.files.find((file) => {
        const comparable = normalizeForCompare(file.path);
        return comparable === normalized || comparable.endsWith(`/${normalized}`) || normalized.endsWith(`/${comparable}`);
    });
}

function getStructuredIntentTargets(input: SelectTaskFilesInput) {
    return input.taskIntent?.structuredIntent?.primaryTargets ?? [];
}

function getStructuredTargetTerms(target: StructuredIntentTarget) {
    return uniqueStrings([
        target.value,
        target.path ?? "",
        target.routePath ?? "",
        target.name ?? "",
        target.evidence
    ].flatMap((value) => tokenize(value)))
        .filter((token) => token.length >= 2)
        .filter((token) => !WEAK_TASK_TOKENS.has(token))
        .filter((token) => !BROAD_PATH_TOKENS.has(token))
        .slice(0, 12);
}

function taskMentionsStructuredPath(rawTask: string, filePath: string) {
    const task = normalizeForCompare(rawTask);
    const normalizedPath = normalizeForCompare(filePath);
    const fileName = normalizedPath.split("/").pop() ?? normalizedPath;
    const baseName = fileName.replace(/\.[^.]+$/, "");

    return task.includes(normalizedPath) || task.includes(fileName) || (baseName.length >= 4 && task.includes(baseName));
}

function structuredTargetHasTaskSupport(input: SelectTaskFilesInput, target: StructuredIntentTarget) {
    if (!target.path) return true;
    if (taskMentionsStructuredPath(input.rawTask, target.path)) return true;

    const taskTokens = new Set(
        tokenize(getPositiveTaskText(input.rawTask))
            .map((token) => token.replace(/\.[a-z0-9]+$/i, ""))
            .filter((token) => token.length >= 4)
            .filter((token) => !WEAK_TASK_TOKENS.has(token))
            .filter((token) => !BROAD_PATH_TOKENS.has(token))
    );

    if (taskTokens.size === 0) return false;

    return getStructuredTargetTerms(target)
        .map((token) => token.replace(/\.[a-z0-9]+$/i, ""))
        .some((token) => taskTokens.has(token));
}

function isUnsupportedStructuredTargetPath(input: SelectTaskFilesInput, file: ProjectInventoryFile) {
    const filePath = normalizeForCompare(file.path);
    return getStructuredIntentTargets(input).some((target) => {
        if (!target.path) return false;
        const targetPath = normalizeForCompare(target.path);
        if (filePath !== targetPath && !filePath.endsWith(`/${targetPath}`) && !targetPath.endsWith(`/${filePath}`)) return false;
        return !structuredTargetHasTaskSupport(input, target);
    });
}

function getStructuredTargetFileScore(file: ProjectInventoryFile, target: StructuredIntentTarget) {
    const filePath = normalizeForCompare(file.path);
    const routePath = normalizeForCompare(file.routePath ?? "");
    const targetPath = normalizeForCompare(target.path ?? "");
    const targetRoute = normalizeForCompare(target.routePath ?? "");
    let score = 0;

    if (targetPath && (filePath === targetPath || filePath.endsWith(`/${targetPath}`) || targetPath.endsWith(`/${filePath}`))) {
        score += 260;
    }

    if (targetRoute && routePath && normalizeRouteValue(targetRoute) === normalizeRouteValue(routePath)) {
        score += 230;
    }

    const terms = getStructuredTargetTerms(target);
    const values = [
        file.path,
        file.name,
        file.role,
        file.routePath ?? "",
        ...(file.symbols ?? []),
        ...(file.exports ?? []),
        ...(file.textHints ?? []),
        file.contentPreview ?? ""
    ];

    for (const term of terms) {
        if (values.some((value) => normalizedTermMatches(value, term) || normalizedTermMatches(term, value))) {
            score += target.kind === "entity" || target.kind === "page" || target.kind === "route" ? 36 : 28;
        }
    }

    if ((target.kind === "page" || target.kind === "route") && isPageLikeTargetFile(file)) score += 70;
    if (target.kind === "component" && isClientUiPath(file.path)) score += 55;
    if (target.kind === "service" && (isBackendLeaningPath(file.path) || isClientApiBridgePath(file.path))) score += 55;
    if (target.kind === "config" && file.kind === "config") score += 60;
    if (target.kind === "docs" && file.kind === "docs") score += 60;
    if (target.kind === "asset" && file.kind === "asset") score += 60;

    return score;
}

function findStructuredTargetFile(input: SelectTaskFilesInput, target: StructuredIntentTarget) {
    if (target.path) {
        return findInventoryFileByLoosePath(input.inventory, target.path);
    }

    if (target.routePath) {
        const normalizedRoute = normalizeRouteValue(target.routePath);
        const routeFile = input.inventory.files.find((file) => file.routePath && normalizeRouteValue(file.routePath) === normalizedRoute);
        if (routeFile) return routeFile;
    }

    const scored = input.inventory.files
        .map((file) => ({ file, score: getStructuredTargetFileScore(file, target) }))
        .filter((row) => row.score >= 42)
        .sort((a, b) => b.score - a.score);

    return scored[0]?.file;
}

function getStructuredIntentSeedFiles(input: SelectTaskFilesInput, area: EffectiveTaskArea, assetMode: AssetMode, selected: SelectedTaskFile[]) {
    const seeds: SelectedTaskFile[] = [];
    const seen = new Set(selected.map((file) => normalizeForCompare(file.path)));

    for (const target of getStructuredIntentTargets(input).sort((a, b) => b.confidence - a.confidence)) {
        if (!structuredTargetHasTaskSupport(input, target)) continue;
        const inventoryFile = findStructuredTargetFile(input, target);
        if (!inventoryFile) continue;
        const normalizedPath = normalizeForCompare(inventoryFile.path);
        if (seen.has(normalizedPath)) continue;
        if (!canUseSelectedFile(input, inventoryFile, area, assetMode)) continue;

        seen.add(normalizedPath);
        seeds.push(makeSelectedFile(
            inventoryFile,
            `Selected from structured task intent target "${target.value}" and validated against project inventory. ${target.evidence}`.slice(0, 320),
            Math.max(0.72, Math.min(0.97, target.confidence)),
            defaultUsageForFile(inventoryFile)
        ));
    }

    return seeds.slice(0, 6);
}

function hasHeaderSurfaceIntent(input: SelectTaskFilesInput) {
    const groundedStructuredTargetText = getStructuredIntentTargets(input)
        .filter((target) => structuredTargetHasTaskSupport(input, target))
        .flatMap((target) => [
            target.value,
            target.path ?? "",
            target.routePath ?? "",
            target.name ?? "",
            target.evidence
        ])
        .join(" ");

    return matchesAny([
        input.rawTask,
        getPositiveTaskText(input.rawTask),
        groundedStructuredTargetText
    ].join(" "), [
        /\b(?:header|topbar|navbar|nav|navigation|menu|theme|account|locale|language)\b/i,
        /(?:\u0448\u0430\u043f\u043a|\u0432\u0435\u0440\u0445\u043d\u0435\u0435\s+\u043c\u0435\u043d\u044e|\u043d\u0430\u0432\u0438\u0433\u0430\u0446|\u043c\u0435\u043d\u044e|\u043f\u0435\u0440\u0435\u043a\u043b\u044e\u0447\u0430\u0442\u0435\u043b\u044c\s+\u0442\u0435\u043c|\u043a\u043d\u043e\u043f\u043a\u0430\s+\u0430\u043a\u043a\u0430\u0443\u043d\u0442|\u0441\u043c\u0435\u043d\u044b\s+\u044f\u0437\u044b\u043a|\u044f\u0437\u044b\u043a|\u043b\u043e\u043a\u0430\u043b)/i
    ]);
}

function getHeaderSurfaceScore(file: ProjectInventoryFile) {
    const values = [
        file.path,
        file.name,
        file.role,
        file.routePath ?? "",
        ...(file.symbols ?? []),
        ...(file.exports ?? []),
        ...(file.textHints ?? []),
        file.contentPreview ?? ""
    ];
    const text = normalizeForCompare(values.join(" "));
    let score = 0;

    if (includesAny(file.path, ["header", "topbar", "navbar", "navigation", "nav"])) score += 95;
    if (includesAny(file.name, ["header", "topbar", "navbar", "navigation", "nav"])) score += 90;
    if ((file.symbols ?? []).some((symbol) => includesAny(symbol, ["Header", "Topbar", "Navbar", "Navigation"]))) score += 85;
    if ((file.exports ?? []).some((exportName) => includesAny(exportName, ["Header", "Topbar", "Navbar", "Navigation"]))) score += 80;
    if (file.role === "layout" || file.role === "app-entry") score += 20;
    if (file.kind === "style" && includesAny(text, ["topbar", "header", "navbar", "nav", "navigation"])) score += 62;
    if (file.kind === "source" && isClientUiPath(file.path)) score += 24;
    if (includesAny(text, ["topbar", "header", "navbar", "navigation", "nav", "menu", "theme", "locale", "language", "account"])) score += 36;
    if (includesAny(text, ["authcontext", "api", "server", "schema", "database"])) score -= 60;
    if (includesAny(file.path, ["button", "footer", "modal", "page"])) score -= 35;

    return score;
}

function getHeaderSurfaceSeedFiles(input: SelectTaskFilesInput, area: EffectiveTaskArea, assetMode: AssetMode, selected: SelectedTaskFile[]) {
    if (area !== "ui" && area !== "fullstack" && area !== "general" && area !== "bugfix") return [];
    if (!hasHeaderSurfaceIntent(input)) return [];

    const seen = new Set(selected.map((file) => normalizeForCompare(file.path)));
    const scored = input.inventory.files
        .filter((file) => !seen.has(normalizeForCompare(file.path)))
        .filter((file) => canUseSelectedFile(input, file, area, assetMode))
        .map((file) => ({ file, score: getHeaderSurfaceScore(file) }))
        .filter((item) => item.score >= 70)
        .sort((a, b) => b.score - a.score);

    return scored.slice(0, 2).map((item) => makeSelectedFile(
        item.file,
        "Selected as a likely header/navigation surface by matching the task against real inventory names, symbols, exports, and UI text hints.",
        Math.max(0.78, Math.min(0.94, item.score / 170))
    ));
}

function hasSpecificUiObjectIntent(input: SelectTaskFilesInput) {
    return matchesAny(getPositiveTaskText(input.rawTask), [
        /\b(?:form|input|field|modal|dialog|table|list|card|profile|settings|user|account|checkout|search|filter)\b/i,
        /(?:\u0444\u043e\u0440\u043c|\u043f\u043e\u043b\u0435|\u0438\u043d\u043f\u0443\u0442|\u043c\u043e\u0434\u0430\u043b|\u0434\u0438\u0430\u043b\u043e\u0433|\u0442\u0430\u0431\u043b\u0438\u0446|\u0441\u043f\u0438\u0441|\u043a\u0430\u0440\u0442\u043e\u0447|\u043f\u0440\u043e\u0444\u0438\u043b|\u043d\u0430\u0441\u0442\u0440\u043e\u0439\u043a|\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442|\u0430\u043a\u043a\u0430\u0443\u043d\u0442|\u043f\u043e\u0438\u0441\u043a|\u0444\u0438\u043b\u044c\u0442\u0440)/i
    ]);
}

function getSpecificPositiveTokens(input: SelectTaskFilesInput) {
    const protectedTerms = new Set(getTaskConstraints(input).protectedFileTerms.map(normalizeForCompare));
    return getGroundedPositiveTargetTokens(input)
        .filter((token) => token.length >= 4)
        .filter((token) => !["api", "backend", "server", "auth", "route", "routes", "service", "services", "client"].includes(normalizeForCompare(token)))
        .filter((token) => !protectedTerms.has(normalizeForCompare(token)))
        .slice(0, 12);
}

function getSpecificPositiveOverlap(file: ProjectInventoryFile, tokens: string[]) {
    if (tokens.length === 0) return 0;
    const values = [
        file.path,
        file.name,
        file.role,
        file.routePath ?? "",
        ...(file.symbols ?? []),
        ...(file.exports ?? []),
        ...(file.textHints ?? []),
        file.contentPreview ?? ""
    ];

    return tokens.reduce(
        (count, token) => count + (values.some((value) => normalizedTermMatches(value, token) || normalizedTermMatches(token, value)) ? 1 : 0),
        0
    );
}

function shouldRequireManualTargetReview(input: SelectTaskFilesInput, area: EffectiveTaskArea, selected: SelectedTaskFile[], tokenContext: TokenContext) {
    if (selected.length > 0) return false;
    if (area !== "ui" && area !== "general" && area !== "bugfix") return false;
    if (!hasSpecificUiObjectIntent(input)) return false;
    if (hasHeaderSurfaceIntent(input)) return false;
    if (tokenContext.explicitExistingPaths.length > 0 || tokenContext.routeMentions.length > 0) return false;
    if ((input.taskIntent?.structuredIntent?.primaryTargets ?? []).some((target) => structuredTargetHasTaskSupport(input, target))) return false;

    const tokens = getSpecificPositiveTokens(input);
    if (tokens.length === 0) return false;

    return !input.inventory.files
        .filter((file) => canUseSelectedFile(input, file, area, "none"))
        .some((file) => getSpecificPositiveOverlap(file, tokens) >= 2);
}

function getHeaderSurfaceStyleSeedFile(input: SelectTaskFilesInput, area: EffectiveTaskArea, assetMode: AssetMode, selected: SelectedTaskFile[]) {
    if (!hasHeaderSurfaceIntent(input)) return undefined;
    const seen = new Set(selected.map((file) => normalizeForCompare(file.path)));

    return input.inventory.files
        .filter((file) => file.kind === "style")
        .filter((file) => !seen.has(normalizeForCompare(file.path)))
        .filter((file) => canUseSelectedFile(input, file, area, assetMode))
        .map((file) => {
            const filePath = normalizeForCompare(file.path);
            const score = getHeaderSurfaceScore(file)
                + (includesAny(filePath, ["global.css", "globals.css", "app.css", "index.css"]) ? 46 : 0);
            return { file, score };
        })
        .filter((item) => item.score >= 42)
        .sort((a, b) => b.score - a.score)[0]?.file;
}

function structuredIntentWantsExplicitOnly(input: SelectTaskFilesInput) {
    return input.taskIntent?.structuredIntent?.allowedEditScope === "explicit_targets_only"
        && getStructuredIntentTargets(input).length > 0;
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
    if (isUnsupportedStructuredTargetPath(input, file)) return false;
    if (isSensitiveEnvPath(file.path)) return false;
    if (isSystemSeoFile(file) && !isSystemSeoRelevantForTask(input)) return false;
    if (file.kind === "runtime") return false;
    if (file.isLikelyGenerated) return false;
    if (isGeneratedDoNotEditPath(file.path) && area !== "build") return false;
    if (isLockFilePath(file.path) && !includesAny(taskText, ["lock", "package-lock", "pnpm-lock", "yarn.lock"])) return false;
    if (file.kind === "asset" && assetMode === "none") return false;
    if (file.sizeBytes === 0 && !includesAny(input.rawTask, [file.name, file.path])) return false;

    if (
        constraints.noBackendMutation &&
        (
            isBackendProtectedRole(file) ||
            isBackendProtectedPath(file) ||
            isAuthProtectedFile(file) ||
            isServerSidePath(file.path) ||
            isClientApiBridgePath(file.path) ||
            (isBackendLeaningPath(file.path) && !isClientUiPath(file.path))
        )
    ) {
        return false;
    }

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
    const routeScoped = isRouteScopedTask(input, area, tokenContext);

    return input.inventory.files
        .filter((file) => !seen.has(normalizeForCompare(file.path)) && canUseSelectedFile(input, file, area, assetMode))
        .filter((file) => !routeScoped || isWithinRequestedRouteScope(file, tokenContext))
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
    const available = input.inventory.files
        .filter((file) => !seen.has(normalizeForCompare(file.path)))
        .filter((file) => canUseSelectedFile(input, file, area, assetMode));

    const directPageCandidates = available
        .filter((file) => isDirectRoutePageMatch(file, tokenContext.routeMentions))
        .map((file) => ({ file, score: getRouteMatchScore(file, tokenContext.routeMentions) + scoreFileFallback(file, tokenContext, input, area, assetMode) * 0.2 }))
        .sort((a, b) => b.score - a.score);

    if (directPageCandidates.length > 0) {
        return directPageCandidates.slice(0, getConcretePageTargetLimit(input, area, tokenContext)).map((item) => makeSelectedFile(
            item.file,
            "Selected as the concrete route/page target matched from the task and real project inventory.",
            Math.min(0.95, Math.max(0.84, item.score / 180))
        ));
    }

    const candidates = available
        .map((file) => ({ file, score: getRouteMatchScore(file, tokenContext.routeMentions) + scoreFileFallback(file, tokenContext, input, area, assetMode) * 0.25 }))
        .filter((item) => item.score >= 88)
        .filter((item) => !isGenericSharedUiPrimitive(item.file) && !isAppShellOrEntrypointFile(item.file))
        .sort((a, b) => b.score - a.score)
        .slice(0, isSpecificPageOrFileTask(input, area) ? getConcretePageTargetLimit(input, area, tokenContext) : 4);

    return candidates.map((item) => makeSelectedFile(
        item.file,
        "Selected by route-aware inventory matching from a route/page mention in the task.",
        Math.min(0.9, Math.max(0.72, item.score / 180)),
        isSpecificPageOrFileTask(input, area) ? "inspect-only" : defaultUsageForFile(item.file)
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

    for (const structuredFile of getStructuredIntentSeedFiles(input, effectiveTaskArea, assetMode, selected)) {
        selected.push(structuredFile);
    }

    const headerSurfaceSeedFiles = getHeaderSurfaceSeedFiles(input, effectiveTaskArea, assetMode, selected);
    for (const surfaceFile of headerSurfaceSeedFiles) {
        selected.push(surfaceFile);
    }

    if (headerSurfaceSeedFiles.length > 0) {
        const styleFile = getHeaderSurfaceStyleSeedFile(input, effectiveTaskArea, assetMode, selected);
        if (styleFile) {
            selected.push(makeSelectedFile(
                styleFile,
                "Added as style/layout context for the selected header/navigation surface.",
                0.72
            ));
        }

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
                "Header/navigation surface target detected; broad generic UI fallback candidates were skipped.",
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

    for (const routeFile of getRouteAwareSeedFiles(input, effectiveTaskArea, assetMode, tokenContext, selected)) {
        selected.push(routeFile);
    }

    if ((constraints.onlyExplicitFiles || structuredIntentWantsExplicitOnly(input)) && selected.length > 0) {
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
                structuredIntentWantsExplicitOnly(input)
                    ? "Structured intent constrained the task to explicit target(s), so ContextForge did not add unrelated fallback files."
                    : "User constrained the task to explicit file(s), so ContextForge did not add unrelated fallback files.",
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

    const explicitPrimaryFiles = tokenContext.explicitExistingPaths
        .map((pathValue) => findInventoryFile(input.inventory, pathValue))
        .filter((file): file is ProjectInventoryFile => Boolean(file && !isSecondaryDocumentationMention(file, input, effectiveTaskArea)));

    if (explicitPrimaryFiles.length > 0 && isSpecificPageOrFileTask(input, effectiveTaskArea)) {
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
                "Explicit primary file target detected; broad fallback candidates were skipped to keep the edit scope narrow.",
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


    if (!hasSelectedConcretePageTarget(selected, input.inventory)) {
        for (const item of getSemanticPageTargetCandidates(input, effectiveTaskArea, assetMode, tokenContext, selected)) {
            selected.push(makeSelectedFile(
                item.file,
                "Selected as the concrete page target by matching the task against real page text, headings, metadata hints, route path, and symbols from inventory.",
                Math.min(0.95, Math.max(0.84, item.score / 180))
            ));
        }
    }

    const selectedPageTargets = getSelectedConcretePageTargets(selected, input.inventory);
    if (selectedPageTargets.length > 0 && isSpecificPageOrFileTask(input, effectiveTaskArea)) {
        const primaryPageTargets = getPrimaryConcretePageTargets(input, effectiveTaskArea, tokenContext, selectedPageTargets);
        const pageTargetPaths = new Set(primaryPageTargets.map((file) => normalizeForCompare(file.path)));
        const pageScopedSelected = selected.filter((file) => pageTargetPaths.has(normalizeForCompare(file.path)));
        pageScopedSelected.push(...getImportedReferenceFilesForPageTargets(input, primaryPageTargets, effectiveTaskArea, assetMode, pageScopedSelected));
        const finalSelectedFiles = rankAndCapSelection(pageScopedSelected, input, effectiveTaskArea, assetMode);

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
                "Concrete page target detected from route/page semantics; broad generic UI fallback candidates were skipped.",
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

    if (shouldRequireManualTargetReview(input, effectiveTaskArea, selected, tokenContext)) {
        const groundedReviewTokens = getSpecificPositiveTokens(input);
        return {
            selectedFiles: [],
            rejectedModelPaths: tokenContext.explicitMissingPaths,
            source: "fallback",
            usedFallback: true,
            durationMs: getDurationMs(startedAt),
            effectiveTaskArea,
            assetMode,
            conflictNote,
            notes: [
                "Fallback file selection was used.",
                "Fallback selection stopped before broad ranking because the task names a specific UI object, but no matching page/component/form target was grounded in the inventory.",
                "Review files manually or add the exact page/component path before generating.",
                `Effective task area: ${effectiveTaskArea}.`,
                `Asset mode: ${assetMode}.`,
                conflictNote ?? "No task type conflict detected.",
                ...constraints.notes,
                groundedReviewTokens.length > 0
                    ? `Grounded review tokens: ${groundedReviewTokens.slice(0, 18).join(", ")}.`
                    : "No grounded review tokens were extracted.",
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
- Treat taskIntent.structuredIntent as the first semantic hypothesis, not as permission to invent paths.
- Validate structuredIntent.primaryTargets against the inventory. If a target path exists and is safe, include it before broad fallback candidates.
- Respect structuredIntent.protectedScopes: protected areas may be inspected only when useful, but should not become edit targets.
- If structuredIntent.allowedEditScope is "explicit_targets_only", keep selectedFiles narrow.
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

function withSelectorSafetyProfile(selection: TaskFileSelection): TaskFileSelection {
    const marker = `Selector safety profile: ${SELECTOR_SAFETY_PROFILE}.`;
    if (selection.notes.some((note) => note === marker)) return selection;

    return {
        ...selection,
        notes: [marker, ...selection.notes]
    };
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

    const completedSelection = scopeSelectionToPrimaryPageTargets(input, effectiveTaskArea, assetMode, ensureHelpfulCoverage(
        appendFallbackFilesIfNeeded(selectedFiles, input, fallback),
        input,
        effectiveTaskArea,
        assetMode
    ));

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
    const settings = input.settings ?? await getAppSettings();
    const inputWithSettings: SelectTaskFilesInput = {
        ...input,
        settings
    };

    const fallback = buildFallbackSelection(inputWithSettings);

    if (settings.generationMode !== "ollama" || !settings.defaultOllamaModel) {
        return withSelectorSafetyProfile({ ...fallback, durationMs: getDurationMs(startedAt) });
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
            return withSelectorSafetyProfile({
                ...fallback,
                durationMs: getDurationMs(startedAt),
                notes: [...fallback.notes, `Ollama file selector responded with status ${response.status}.`]
            });
        }

        const data = (await response.json()) as OllamaGenerateResponse;
        const json = extractJsonObject(String(data.response ?? ""));
        return withSelectorSafetyProfile(normalizeModelSelection(json, inputWithSettings, fallback, startedAt));
    } catch (error) {
        return withSelectorSafetyProfile({
            ...fallback,
            durationMs: getDurationMs(startedAt),
            notes: [
                ...fallback.notes,
                error instanceof Error ? `Ollama file selector failed: ${error.message}` : "Ollama file selector failed."
            ]
        });
    }
}
