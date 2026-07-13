import { getAppSettings } from "../settings/settingsService.js";
import {
    beginPerformanceAiCall,
    finishPerformanceAiCall
} from "../performance/performanceTrace.js";
import {
    buildFallbackTaskUnderstanding,
    filterTaskUnderstandingAmbiguities,
    normalizeTaskUnderstanding,
    type TaskUnderstanding
} from "./taskUnderstanding.js";

export type TaskArea =
    | "ui"
    | "backend"
    | "fullstack"
    | "build"
    | "bugfix"
    | "refactor"
    | "docs"
    | "tests"
    | "general";

export type TaskRiskLevel = "low" | "medium" | "high";
export type StructuredIntentTargetKind =
    | "explicit_file"
    | "route"
    | "page"
    | "component"
    | "symbol"
    | "entity"
    | "service"
    | "config"
    | "docs"
    | "asset"
    | "unknown";

export type StructuredIntentAllowedEditScope =
    | "explicit_targets_only"
    | "target_with_supporting_context"
    | "broad_but_safe"
    | "unknown";

export type StructuredIntentTargetProvenance =
    | "user_confirmed"
    | "inventory_exact"
    | "graph_supported"
    | "model_proposed"
    | "ranked_candidate";

export interface StructuredIntentTarget {
    kind: StructuredIntentTargetKind;
    value: string;
    path?: string;
    routePath?: string;
    name?: string;
    confidence: number;
    evidence: string;
    provenance?: StructuredIntentTargetProvenance;
}

export interface StructuredTaskIntent {
    schemaVersion: 1;
    primaryTargets: StructuredIntentTarget[];
    positiveActions: string[];
    protectedScopes: string[];
    allowedEditScope: StructuredIntentAllowedEditScope;
    needsStyles: boolean | null;
    needsBackend: boolean | null;
    ambiguities: string[];
    modelNotes: string[];
}

export interface TaskIntentAnalysis {
    taskArea: TaskArea;
    intentTags: string[];
    domainTerms: string[];
    mentionedEntities: string[];
    fileRoleHints: string[];
    recommendedSearchTerms: string[];
    riskLevel: TaskRiskLevel;
    confidence: number;
    notes: string[];
    structuredIntent: StructuredTaskIntent;
    taskUnderstanding: TaskUnderstanding;
    source: "ollama" | "fallback";
    durationMs: number;
}

interface AnalyzeTaskIntentInput {
    rawTask: string;
    taskType: string;
    targetTool: string;
    project: {
        name: string;
        localPath?: string;
        packageManager?: string | null;
        detectedStack?: string[];
        scripts?: Record<string, string>;
        readinessScore?: number;
    };
    projectTree?: string[];
}

interface OllamaGenerateResponse {
    response?: string;
    load_duration?: number;
    prompt_eval_count?: number;
    prompt_eval_duration?: number;
    eval_count?: number;
    eval_duration?: number;
}

type AreaScores = Record<TaskArea, number>;

const ALLOWED_TASK_AREAS: TaskArea[] = [
    "ui",
    "backend",
    "fullstack",
    "build",
    "bugfix",
    "refactor",
    "docs",
    "tests",
    "general"
];

const ALLOWED_STRUCTURED_TARGET_KINDS: StructuredIntentTargetKind[] = [
    "explicit_file",
    "route",
    "page",
    "component",
    "symbol",
    "entity",
    "service",
    "config",
    "docs",
    "asset",
    "unknown"
];

const ALLOWED_EDIT_SCOPES: StructuredIntentAllowedEditScope[] = [
    "explicit_targets_only",
    "target_with_supporting_context",
    "broad_but_safe",
    "unknown"
];

const STOP_WORDS = new Set([
    "это", "как", "что", "там", "или", "если", "нет", "надо", "нужно", "сделай",
    "переделай", "исправь", "почини", "добавь", "замени", "убери", "чтобы",
    "когда", "где", "для", "при", "под", "над", "без", "его", "её", "она",
    "они", "оно", "мне", "тебе", "тут", "всё", "все", "какое", "какая",
    "какой", "после", "сейчас", "слишком", "много", "нового", "новый", "новая",
    "основные", "текущую", "полностью", "the", "and", "for", "with", "from",
    "this", "that", "make", "change", "fix", "add", "remove", "update", "new",
    "current", "better", "more", "less", "after", "before", "when", "where", "what", "how"
]);

const GENERIC_DOMAIN_WORDS = new Set([
    "api", "app", "application", "asset", "assets", "backend", "build", "button", "buttons",
    "client", "code", "component", "components", "config", "dashboard", "design", "docs",
    "documentation", "endpoint", "file", "files", "form", "frontend", "home", "homepage",
    "icon", "image", "layout", "logic", "main", "menu", "modal", "page", "pages",
    "refactor", "route", "screen", "server", "service", "style", "styles", "test",
    "tests", "ui", "ux", "view", "views", "авторизации", "бэкенд", "бекенд",
    "внешний", "вид", "визуального", "главной", "главный", "дизайн", "иконку",
    "инструкцию", "кнопку", "команды", "компонент", "логика", "пользователя",
    "проект", "проекта", "проверки", "серверный", "страница", "странице", "сценарий",
    "формы", "экран", "экране"
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
    return terms.some((term) => normalized.includes(term));
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

function hasNoBackendChangeConstraint(rawTask: string) {
    return hasRuntimeNoBackendConstraint(rawTask) || includesAny(rawTask, [
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
        "не меняй backend api",
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
}

function hasNoFrontendChangeConstraint(rawTask: string) {
    return includesAny(rawTask, [
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
        "ui не менять",
        "ui не меняй",
        "ui не трогать",
        "ui не трогай",
        "frontend не менять",
        "frontend не меняй",
        "frontend не трогать",
        "frontend не трогай",
        "фронт не менять",
        "фронт не меняй",
        "фронт не трогать",
        "фронт не трогай",
        "не менять интерфейс",
        "интерфейс не менять",
        "интерфейс не меняй",
        "интерфейс не трогать",
        "интерфейс не трогай",
        "без изменений ui",
        "без изменений интерфейса",
        "только backend",
        "только бэкенд",
        "только бекенд",
        "только api",
        "только сервер"
    ]);
}

function tokenize(value: string) {
    return normalizeForCompare(value)
        .split(/[^a-zа-яё0-9_.\/-]+/i)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2);
}

function normalizeStringArray(value: unknown) {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .filter((item) => {
            const type = typeof item;
            return type === "string" || type === "number" || type === "boolean";
        })
        .map((item) => String(item).trim())
        .filter((item) => item.length > 0 && item !== "[object Object]")
        .slice(0, 40);
}

function mergeUniqueStrings(...arrays: string[][]) {
    return Array.from(
        new Set(arrays.flat().map((item) => item.trim()).filter(Boolean))
    ).slice(0, 48);
}

function normalizeTaskArea(value: unknown, fallback: TaskArea): TaskArea {
    const rawValue = String(value ?? "").toLowerCase();
    return ALLOWED_TASK_AREAS.includes(rawValue as TaskArea)
        ? (rawValue as TaskArea)
        : fallback;
}

function normalizeRiskLevel(value: unknown, fallback: TaskRiskLevel = "medium"): TaskRiskLevel {
    const rawValue = String(value ?? "").toLowerCase();
    return rawValue === "low" || rawValue === "medium" || rawValue === "high"
        ? rawValue
        : fallback;
}

function normalizeConfidence(value: unknown, fallback = 0.5) {
    const confidence = Number(value);
    return Number.isFinite(confidence)
        ? Math.min(1, Math.max(0, confidence))
        : fallback;
}

function normalizeTargetKind(value: unknown): StructuredIntentTargetKind {
    const normalized = normalizeForCompare(String(value ?? ""));
    return ALLOWED_STRUCTURED_TARGET_KINDS.includes(normalized as StructuredIntentTargetKind)
        ? (normalized as StructuredIntentTargetKind)
        : "unknown";
}

function normalizeAllowedEditScope(value: unknown, fallback: StructuredIntentAllowedEditScope): StructuredIntentAllowedEditScope {
    const normalized = normalizeForCompare(String(value ?? ""));
    return ALLOWED_EDIT_SCOPES.includes(normalized as StructuredIntentAllowedEditScope)
        ? (normalized as StructuredIntentAllowedEditScope)
        : fallback;
}

function normalizeNullableBoolean(value: unknown, fallback: boolean | null = null) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
        const normalized = normalizeForCompare(value);
        if (["true", "yes", "1"].includes(normalized)) return true;
        if (["false", "no", "0"].includes(normalized)) return false;
    }
    return fallback;
}

function normalizeShortString(value: unknown, fallback = "") {
    return String(value ?? fallback).trim().replace(/\s+/g, " ").slice(0, 220);
}

function projectHasPath(projectTree: string[], pathValue: string) {
    const normalized = normalizeForCompare(pathValue);
    return projectTree.some((projectPath) => normalizeForCompare(projectPath) === normalized);
}

function pathAppearsInProject(projectTree: string[], pathValue: string) {
    const normalized = normalizeForCompare(pathValue);
    if (!normalized) return false;
    return projectTree.some((projectPath) => {
        const comparable = normalizeForCompare(projectPath);
        return comparable === normalized || comparable.endsWith(`/${normalized}`) || normalized.endsWith(`/${comparable}`);
    });
}

function extractPathMentionsFromTask(rawTask: string) {
    const mentions: string[] = [];
    const extensions = "ts|tsx|js|jsx|mjs|cjs|css|scss|sass|less|html|json|md|mdx|txt|yml|yaml|toml|sql|prisma|graphql|gql|xml|svg";
    const pathChars = "A-Za-z0-9_ .@()\\[\\]{}+~$!#%&=,;:'`^-";
    const slashPathRegex = new RegExp(
        `(?:^|[\\s(\\[{'"\`])((?:[A-Za-z]:)?[${pathChars}]+(?:[\\\\/][${pathChars}]+)+\\.(?:${extensions}))(?=$|[\\s)\\]}'"\`,;:!?])`,
        "gi"
    );
    const fileNameRegex = new RegExp(`\\b([A-Za-z0-9_@()\\[\\].-]+\\.(?:${extensions}))\\b`, "gi");

    for (const match of rawTask.matchAll(slashPathRegex)) {
        if (match[1]) mentions.push(normalizePath(match[1]));
    }

    for (const match of rawTask.matchAll(fileNameRegex)) {
        if (match[1]) mentions.push(normalizePath(match[1]));
    }

    return Array.from(new Set(mentions)).filter(Boolean).slice(0, 12);
}

function getExistingExplicitPathTargets(rawTask: string, projectTree: string[]): StructuredIntentTarget[] {
    const targets: StructuredIntentTarget[] = [];

    for (const mention of extractPathMentionsFromTask(rawTask)) {
        const matchedPath = projectTree.find((projectPath) => {
            const comparable = normalizeForCompare(projectPath);
            const normalizedMention = normalizeForCompare(mention);
            return comparable === normalizedMention || comparable.endsWith(`/${normalizedMention}`) || normalizedMention.endsWith(`/${comparable}`);
        });

        if (!matchedPath) continue;
        targets.push({
            kind: "explicit_file",
            value: matchedPath,
            path: matchedPath,
            confidence: 0.98,
            evidence: "The user explicitly mentioned this real project path.",
            provenance: "user_confirmed"
        });
    }

    return targets;
}

function mentionsOnlyExplicitScope(rawTask: string) {
    return includesAny(rawTask, [
        "do not change other files",
        "don't change other files",
        "do not touch other files",
        "don't touch other files",
        "only this file",
        "this file only",
        "не менять остальные файлы",
        "не меняй остальные файлы",
        "не трогать остальные файлы",
        "не трогай остальные файлы",
        "остальные файлы не трогать",
        "остальные файлы не менять",
        "только этот файл"
    ]);
}

function inferFallbackProtectedScopes(rawTask: string) {
    const scopes = new Set<string>();
    if (mentionsOnlyExplicitScope(rawTask)) scopes.add("other files");
    if (hasNoBackendChangeConstraint(rawTask)) scopes.add("backend/api");
    if (hasNoFrontendChangeConstraint(rawTask)) scopes.add("frontend/ui");
    return Array.from(scopes);
}

function getDefaultStructuredIntent({
    rawTask,
    taskArea,
    projectTree
}: {
    rawTask: string;
    taskArea: TaskArea;
    projectTree: string[];
}): StructuredTaskIntent {
    const primaryTargets = getExistingExplicitPathTargets(rawTask, projectTree);
    const protectedScopes = inferFallbackProtectedScopes(rawTask);

    return {
        schemaVersion: 1,
        primaryTargets,
        positiveActions: normalizeStringArray([rawTask]).slice(0, 3),
        protectedScopes,
        allowedEditScope: primaryTargets.length > 0 && mentionsOnlyExplicitScope(rawTask)
            ? "explicit_targets_only"
            : primaryTargets.length > 0
                ? "target_with_supporting_context"
                : "unknown",
        needsStyles: taskArea === "ui" ? null : false,
        needsBackend: taskArea === "backend" || taskArea === "fullstack" ? true : hasNoBackendChangeConstraint(rawTask) ? false : null,
        ambiguities: [],
        modelNotes: ["Fallback structured intent was inferred from task text and project paths."]
    };
}

function emptyScores(): AreaScores {
    return {
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
}

function bestArea(scores: AreaScores) {
    const entries = Object.entries(scores) as Array<[TaskArea, number]>;
    entries.sort((a, b) => b[1] - a[1]);
    const [area, score] = entries[0] ?? ["general", 0];
    return score > 0 ? { area, score } : { area: "general" as TaskArea, score: 0 };
}

function getSelectedTaskTypeArea(taskType: string): TaskArea {
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

function scoreTaskMeaning(rawTask: string, taskType: string) {
    const text = normalizeForCompare(rawTask);
    const scores = emptyScores();

    const hasApi = includesAny(text, ["api", "апи", "endpoint", "эндпоинт", "route", "маршрут"]);
    const hasAuth = includesAny(text, ["auth", "authorization", "authentication", "login", "session", "token", "cookie", "авторизац", "аутентиф", "логин", "сесс", "токен", "куки"]);
    const hasServer = includesAny(text, ["server", "backend", "database", "db", "service", "controller", "webhook", "сервер", "серверный", "бэкенд", "бекенд", "база", "бд", "сервис"]);
    const hasUi = hasRuntimeUiSurfaceTerm(rawTask) || includesAny(text, ["ui", "ux", "screen", "page", "layout", "visual", "design", "style", "css", "button", "form", "input", "focus", "modal", "card", "navigation", "header", "frontend", "component", "экран", "страниц", "визуал", "дизайн", "внешний вид", "кноп", "форма", "пол", "фокус", "модал", "карточ", "навигац", "шапк", "дороже", "чище", "деревян", "дефолт"]);
    const hasBuild = includesAny(text, ["build", "npm run build", "pnpm build", "yarn build", "compile", "compilation", "bundl", "import", "imports", "module not found", "resolve", "alias", "path alias", "tsconfig", "vite", "next build", "eslint", "typecheck", "typescript", "сборк", "билд", "компиляц", "импорт", "импортами", "путями", "алиас", "модул", "ошибка с импортами"]);
    const hasDocs = includesAny(text, ["readme", "docs", "documentation", "guide", "manual", "instructions", "how to run", "setup", "onboarding", "документац", "ридми", "инструкц", "запуск", "запуска", "разработчик", "нового разработчика", "описание", "команды"]);

    if (hasApi || hasAuth || hasServer) scores.backend += 5;
    if (hasApi && hasAuth) scores.backend += 7;
    if (hasAuth && includesAny(text, ["слетает", "expires", "expired", "invalid", "lost", "reset", "перезапуск", "перезапуска", "logout", "logged out"])) {
        scores.backend += 5;
        scores.bugfix += 3;
    }
    if (hasUi) scores.ui += 5;
    if (hasBuild) {
        scores.build += 9;
        scores.bugfix += 2;
    }
    if (hasDocs) scores.docs += 8;
    if (includesAny(text, ["test", "tests", "unit", "e2e", "spec", "coverage", "jest", "vitest", "playwright", "тест", "тесты", "покрытие"])) scores.tests += 7;
    if (includesAny(text, ["bug", "fix", "broken", "error", "crash", "fails", "doesn't work", "not working", "ошибка", "баг", "слом", "падает", "не работает", "краш", "исправь", "почини"])) scores.bugfix += 3;
    if (includesAny(text, ["refactor", "cleanup", "restructure", "rewrite without changing behavior", "рефактор", "почисти", "переструктур", "не меняй логику", "не меняй бизнес-логику"])) scores.refactor += 3;

    const uiAndBackend =
        hasUi &&
        (hasApi || hasServer) &&
        includesAny(text, ["button", "form", "screen", "page", "показывает результат", "кноп", "форма", "экран", "страниц"]) &&
        includesAny(text, ["api", "endpoint", "server", "route", "вызывает сервер", "сервер", "эндпоинт", "маршрут"]);

    if (uiAndBackend) scores.fullstack += 12;

    const noBackendChanges = hasNoBackendChangeConstraint(rawTask);
    const noFrontendChanges = hasNoFrontendChangeConstraint(rawTask);

    if (noBackendChanges) {
        scores.backend -= 12;
        scores.fullstack -= 16;

        if (hasUi) {
            scores.ui += 7;
        }
    }

    if (noFrontendChanges) {
        scores.ui -= 12;
        scores.fullstack -= 12;

        if (hasApi || hasServer) {
            scores.backend += 7;
        }
    }

    const selectedArea = getSelectedTaskTypeArea(taskType);

    if (selectedArea !== "general") {
        scores[selectedArea] += 1;
    }

    if (selectedArea === "ui" && noBackendChanges) {
        scores.ui += 4;
    }

    if (selectedArea === "backend" && noFrontendChanges) {
        scores.backend += 4;
    }

    if (noBackendChanges && hasUi) {
        scores.ui += 10;
        scores.backend -= 10;
        scores.fullstack -= 8;
    }

    return scores;
}

function getFallbackConfidence(area: TaskArea, score: number) {
    if (area === "general" || score <= 0) return 0.45;
    if (score >= 14) return 0.9;
    if (score >= 10) return 0.82;
    if (score >= 7) return 0.72;
    if (score >= 5) return 0.62;
    return 0.5;
}

function getFallbackRiskLevel(area: TaskArea, rawTask: string): TaskRiskLevel {
    const text = normalizeForCompare(rawTask);
    if (area === "docs") return "low";
    if (area === "build") return "high";
    if (area === "backend" || area === "fullstack") {
        return includesAny(text, ["auth", "session", "payment", "database", "авторизац", "сесс", "оплат", "база", "бд"])
            ? "high"
            : "medium";
    }
    return "medium";
}

function extractTaskDomainTerms(rawTask: string) {
    return Array.from(
        new Set(
            tokenize(rawTask).filter((token) => {
                const normalized = normalizeForCompare(token);
                if (normalized.includes("/") || normalized.includes(".")) return false;
                if (STOP_WORDS.has(normalized)) return false;
                if (GENERIC_DOMAIN_WORDS.has(normalized)) return false;
                if (/^\d+$/.test(normalized)) return false;
                return normalized.length >= 3;
            })
        )
    ).slice(0, 12);
}

function termAppearsInTaskOrProject(term: string, rawTask: string, projectTree: string[]) {
    const normalizedTerm = normalizeForCompare(term);
    if (normalizedTerm.length < 2) return false;
    if (normalizeForCompare(rawTask).includes(normalizedTerm)) return true;
    return projectTree.some((projectPath) => normalizeForCompare(projectPath).includes(normalizedTerm));
}

function groundTermsToTaskOrProject(terms: string[], rawTask: string, projectTree: string[]) {
    return terms.filter((term) => termAppearsInTaskOrProject(term, rawTask, projectTree)).slice(0, 24);
}

function groundRecommendedSearchTerms(terms: string[], projectTree: string[]) {
    if (projectTree.length === 0) return terms.slice(0, 24);
    return terms.filter((term) => projectTree.some((projectPath) => normalizeForCompare(projectPath).includes(normalizeForCompare(term)))).slice(0, 24);
}

function taskMentionsPath(rawTask: string, filePath: string) {
    const task = normalizeForCompare(rawTask);
    const pathValue = normalizeForCompare(filePath);
    const fileName = pathValue.split("/").pop() ?? pathValue;
    const baseName = fileName.replace(/\.[^.]+$/, "");

    return task.includes(pathValue) || task.includes(fileName) || (baseName.length >= 4 && task.includes(baseName));
}

function meaningfulTaskTokens(rawTask: string) {
    return new Set(
        tokenize(rawTask)
            .map((token) => token.replace(/\.[a-z0-9]+$/i, ""))
            .filter((token) => token.length >= 4)
            .filter((token) => !STOP_WORDS.has(token))
            .filter((token) => !GENERIC_DOMAIN_WORDS.has(token))
    );
}

function hasMeaningfulTaskOverlap(candidateText: string, rawTask: string) {
    const taskTokens = meaningfulTaskTokens(rawTask);
    if (taskTokens.size === 0) {
        return false;
    }

    const candidateTokens = tokenize(candidateText)
        .map((token) => token.replace(/\.[a-z0-9]+$/i, ""))
        .filter((token) => token.length >= 4)
        .filter((token) => !STOP_WORDS.has(token))
        .filter((token) => !GENERIC_DOMAIN_WORDS.has(token));

    return candidateTokens.some((token) => taskTokens.has(token));
}

function getStructuredObject(data: Record<string, unknown>) {
    const structured = data.structuredIntent ?? data.structured ?? data.intent;
    return structured && typeof structured === "object" && !Array.isArray(structured)
        ? structured as Record<string, unknown>
        : data;
}

function normalizeStructuredTarget(value: unknown, rawTask: string, projectTree: string[]): StructuredIntentTarget | null {
    if (!value || typeof value !== "object") {
        if (typeof value === "string" && value.trim()) {
            const existsInInventory = pathAppearsInProject(projectTree, value);
            const userConfirmed = taskMentionsPath(rawTask, value) ||
                normalizeForCompare(rawTask).includes(normalizeForCompare(value));
            return {
                kind: existsInInventory ? "explicit_file" : "entity",
                value: normalizeShortString(value),
                path: existsInInventory ? normalizePath(value) : undefined,
                confidence: userConfirmed ? 0.9 : 0.58,
                evidence: userConfirmed
                    ? "The user explicitly named this target."
                    : "Model returned a target that still needs project evidence.",
                provenance: userConfirmed
                    ? "user_confirmed"
                    : existsInInventory
                        ? "inventory_exact"
                        : "model_proposed"
            };
        }
        return null;
    }

    const row = value as Record<string, unknown>;
    const rawPath = normalizeShortString(row.path ?? row.file ?? row.filePath ?? row.relativePath);
    const rawRoute = normalizeShortString(row.routePath ?? row.route);
    const rawValue = normalizeShortString(row.value ?? row.name ?? row.target ?? row.label ?? rawPath ?? rawRoute);
    const kind = rawPath ? "explicit_file" : normalizeTargetKind(row.kind ?? row.type);
    const confidence = normalizeConfidence(row.confidence, 0.62);
    const evidence = normalizeShortString(row.evidence ?? row.reason, "Model identified this target from the task.");

    if (!rawValue && !rawPath && !rawRoute) return null;

    if (rawPath && !pathAppearsInProject(projectTree, rawPath)) {
        return null;
    }

    if (
        rawPath &&
        !taskMentionsPath(rawTask, rawPath) &&
        !hasMeaningfulTaskOverlap([rawValue, rawRoute, normalizeShortString(row.name), evidence].join(" "), rawTask)
    ) {
        return null;
    }

    const groundedValue =
        rawPath ||
        rawRoute ||
        (termAppearsInTaskOrProject(rawValue, rawTask, projectTree) ? rawValue : "");

    if (!groundedValue) return null;

    const userNamedPath = Boolean(rawPath && taskMentionsPath(rawTask, rawPath));
    const userNamedRoute = Boolean(
        rawRoute && normalizeForCompare(rawTask).includes(normalizeForCompare(rawRoute)),
    );
    const userNamedValue = Boolean(
        rawValue && normalizeForCompare(rawTask).includes(normalizeForCompare(rawValue)),
    );
    const provenance: StructuredIntentTargetProvenance =
        userNamedPath || userNamedRoute || userNamedValue
            ? "user_confirmed"
            : rawPath
                ? "inventory_exact"
                : "model_proposed";

    return {
        kind,
        value: groundedValue,
        path: rawPath || undefined,
        routePath: rawRoute || undefined,
        name: normalizeShortString(row.name) || undefined,
        confidence: provenance === "model_proposed" ? Math.min(confidence, 0.62) : confidence,
        evidence,
        provenance
    };
}

function normalizeStructuredTargets(value: unknown, rawTask: string, projectTree: string[]) {
    const rawTargets = Array.isArray(value) ? value : [];
    const seen = new Set<string>();
    const targets: StructuredIntentTarget[] = [];

    for (const item of rawTargets) {
        const target = normalizeStructuredTarget(item, rawTask, projectTree);
        if (!target) continue;

        const key = normalizeForCompare([target.kind, target.path, target.routePath, target.value].filter(Boolean).join(":"));
        if (!key || seen.has(key)) continue;
        seen.add(key);
        targets.push(target);
    }

    return targets.slice(0, 8);
}

function mergeStructuredTargets(...groups: StructuredIntentTarget[][]) {
    const seen = new Set<string>();
    const targets: StructuredIntentTarget[] = [];

    for (const group of groups) {
        for (const target of group) {
            const key = normalizeForCompare([target.kind, target.path, target.routePath, target.value].filter(Boolean).join(":"));
            if (!key || seen.has(key)) continue;
            seen.add(key);
            targets.push(target);
        }
    }

    return targets
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 10);
}

function normalizeStructuredIntent(
    data: Record<string, unknown>,
    fallback: StructuredTaskIntent,
    rawTask: string,
    projectTree: string[]
): StructuredTaskIntent {
    const structured = getStructuredObject(data);
    const modelTargets = normalizeStructuredTargets(
        structured.primaryTargets ?? structured.targets ?? structured.targetFiles ?? structured.relevantTargets,
        rawTask,
        projectTree
    );
    const fallbackTargets = getExistingExplicitPathTargets(rawTask, projectTree);
    const allowedEditScope = normalizeAllowedEditScope(structured.allowedEditScope ?? structured.editScope, fallback.allowedEditScope);
    const protectedScopes = mergeUniqueStrings(
        fallback.protectedScopes,
        normalizeStringArray(structured.protectedScopes ?? structured.constraints ?? structured.doNotTouch)
    );

    return {
        schemaVersion: 1,
        primaryTargets: mergeStructuredTargets(fallbackTargets, modelTargets, fallback.primaryTargets),
        positiveActions: mergeUniqueStrings(
            normalizeStringArray(structured.positiveActions ?? structured.actions),
            fallback.positiveActions
        ).slice(0, 12),
        protectedScopes,
        allowedEditScope,
        needsStyles: normalizeNullableBoolean(structured.needsStyles, fallback.needsStyles),
        needsBackend: normalizeNullableBoolean(structured.needsBackend, fallback.needsBackend),
        ambiguities: filterTaskUnderstandingAmbiguities(
            mergeUniqueStrings(
                fallback.ambiguities,
                normalizeStringArray(structured.ambiguities ?? structured.questions)
            )
        ).slice(0, 12),
        modelNotes: mergeUniqueStrings(
            normalizeStringArray(structured.modelNotes ?? structured.notes),
            fallback.modelNotes
        ).slice(0, 12)
    };
}

function addIfTaskMatches(task: string, terms: string[], onMatch: () => void) {
    if (includesAny(task, terms)) onMatch();
}

function buildFallbackIntent({ rawTask, taskType, projectTree = [] }: Pick<AnalyzeTaskIntentInput, "rawTask" | "taskType"> & { projectTree?: string[] }): TaskIntentAnalysis {
    const startedAt = Date.now();
    const task = rawTask.toLowerCase();
    const scores = scoreTaskMeaning(rawTask, taskType);
    const best = bestArea(scores);

    const intentTags = new Set<string>();
    const fileRoleHints = new Set<string>();
    const recommendedSearchTerms = new Set<string>();
    const notes = ["Fallback keyword intent analysis was used.", `Fallback inferred task area: ${best.area}.`];

    addIfTaskMatches(task, ["homepage", "home page", "landing", "main page", "главная", "главную", "главной", "главный экран", "лендинг"], () => {
        intentTags.add("homepage"); fileRoleHints.add("page"); fileRoleHints.add("layout");
        ["home", "layout", "page"].forEach((item) => recommendedSearchTerms.add(item));
    });

    addIfTaskMatches(task, ["design", "visual", "redesign", "cleaner", "premium", "default template", "дизайн", "визуал", "дороже", "чище", "деревян", "дефолт", "освежи"], () => {
        intentTags.add("visual-redesign"); fileRoleHints.add("component"); fileRoleHints.add("layout"); fileRoleHints.add("style");
        ["style", "css", "layout"].forEach((item) => recommendedSearchTerms.add(item));
    });

    addIfTaskMatches(task, ["navigation", "nav", "menu", "button", "buttons", "link", "links", "header", "topbar", "navbar", "навигац", "меню", "кноп", "ссыл", "хедер", "шапк"], () => {
        intentTags.add("navigation-ui"); fileRoleHints.add("component"); fileRoleHints.add("style");
        ["nav", "menu", "button", "header", "topbar", "style"].forEach((item) => recommendedSearchTerms.add(item));
    });

    addIfTaskMatches(task, ["image", "picture", "photo", "asset", "logo", "icon", "favicon", "background", "wallpaper", "screenshot", "media", "banner", "cover", "картин", "изображ", "фото", "логотип", "лого", "икон", "фон", "облож", "баннер"], () => {
        intentTags.add("asset-change"); fileRoleHints.add("asset"); fileRoleHints.add("component"); fileRoleHints.add("style");
        ["public", "assets", "image", "logo", "icon", "favicon", "background", "banner"].forEach((item) => recommendedSearchTerms.add(item));
    });

    addIfTaskMatches(task, ["filter", "filters", "search", "sort", "select", "dropdown", "фильтр", "фильтры", "фильтрация", "поиск", "сортировка", "выбор", "селект"], () => {
        intentTags.add("filtering"); fileRoleHints.add("component"); fileRoleHints.add("state");
        ["filter", "search", "sort", "select", "dropdown"].forEach((item) => recommendedSearchTerms.add(item));
    });

    addIfTaskMatches(task, ["form", "input", "modal", "dialog", "submit", "focus", "форма", "поле", "поля", "инпут", "модал", "окно", "фокус"], () => {
        intentTags.add("form-flow"); fileRoleHints.add("component"); fileRoleHints.add("state"); fileRoleHints.add("style");
        ["form", "input", "modal", "dialog", "focus"].forEach((item) => recommendedSearchTerms.add(item));
    });

    addIfTaskMatches(task, ["backend", "server", "api", "route", "endpoint", "database", "db", "auth", "session", "validation", "бэкенд", "бекенд", "сервер", "апи", "эндпоинт", "маршрут", "база", "бд", "авторизация", "сессия"], () => {
        intentTags.add("backend-flow"); fileRoleHints.add("api"); fileRoleHints.add("route"); fileRoleHints.add("service");
        ["server", "api", "routes", "route", "db", "database", "auth", "session", "validation"].forEach((item) => recommendedSearchTerms.add(item));
    });

    addIfTaskMatches(task, ["build", "npm run build", "compile", "import", "imports", "module not found", "resolve", "alias", "vite", "next", "tsconfig", "eslint", "сборк", "билд", "импорт", "импортами", "путями", "модул", "алиас"], () => {
        intentTags.add("build-config"); fileRoleHints.add("config"); fileRoleHints.add("entry");
        ["package.json", "vite", "next", "tsconfig", "eslint", "config"].forEach((item) => recommendedSearchTerms.add(item));
    });

    addIfTaskMatches(task, ["readme", "docs", "documentation", "guide", "setup", "how to run", "документация", "ридми", "описание", "инструкция", "запуск", "команды", "разработчика"], () => {
        intentTags.add("docs"); fileRoleHints.add("docs"); fileRoleHints.add("config");
        ["README", "package.json", "docs", "AGENTS", "config"].forEach((item) => recommendedSearchTerms.add(item));
    });

    addIfTaskMatches(task, ["test", "tests", "unit", "e2e", "coverage", "тест", "тесты", "покрытие"], () => {
        intentTags.add("tests"); fileRoleHints.add("test");
        ["test", "spec", "__tests__", "tests"].forEach((item) => recommendedSearchTerms.add(item));
    });

    addIfTaskMatches(task, ["fix", "bug", "error", "crash", "broken", "сломалось", "ошибка", "баг", "почини", "не работает", "краш", "падает"], () => {
        intentTags.add("bugfix"); fileRoleHints.add("test");
    });

    const structuredIntent = getDefaultStructuredIntent({
        rawTask,
        taskArea: best.area,
        projectTree
    });
    const confidence = getFallbackConfidence(best.area, best.score);
    const taskUnderstanding = buildFallbackTaskUnderstanding({
        rawTask,
        taskArea: best.area,
        taskType,
        confidence,
        projectTree,
        structuredIntent
    });
    const understandingSearchTerms = groundRecommendedSearchTerms(
        taskUnderstanding.targetHints,
        projectTree
    );

    return {
        taskArea: best.area,
        intentTags: Array.from(intentTags),
        domainTerms: extractTaskDomainTerms(rawTask),
        mentionedEntities: [],
        fileRoleHints: Array.from(fileRoleHints),
        recommendedSearchTerms: mergeUniqueStrings(
            Array.from(recommendedSearchTerms),
            understandingSearchTerms
        ),
        riskLevel: getFallbackRiskLevel(best.area, rawTask),
        confidence,
        notes,
        structuredIntent,
        taskUnderstanding,
        source: "fallback",
        durationMs: getDurationMs(startedAt)
    };
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
    if (direct && typeof direct === "object" && !Array.isArray(direct)) return direct;

    const fenced = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)]
        .map((match) => match[1])
        .map(parseJsonCandidate)
        .find((item) => item && typeof item === "object" && !Array.isArray(item));
    if (fenced) return fenced;

    for (const fragment of extractBalancedJsonFragments(trimmed)) {
        const parsed = parseJsonCandidate(fragment);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    }

    return null;
}

function normalizeIntentResult(value: unknown, fallback: TaskIntentAnalysis, rawTask: string, taskType: string, projectTree: string[]): TaskIntentAnalysis {
    if (!value || typeof value !== "object") return fallback;

    const data = value as Record<string, unknown>;
    const modelTaskArea = normalizeTaskArea(data.taskArea, fallback.taskArea);
    const modelConfidence = normalizeConfidence(data.confidence, fallback.confidence);

    const trustFallbackArea =
        fallback.taskArea !== "general" &&
        (
            fallback.confidence >= 0.7 ||
            fallback.taskArea === "backend" ||
            fallback.taskArea === "build" ||
            fallback.taskArea === "fullstack" ||
            fallback.taskArea === "docs"
        );

    const finalTaskArea = trustFallbackArea ? fallback.taskArea : modelTaskArea;
    const mergedDomainTerms = mergeUniqueStrings(fallback.domainTerms, normalizeStringArray(data.domainTerms));
    const mergedMentionedEntities = mergeUniqueStrings(fallback.mentionedEntities, normalizeStringArray(data.mentionedEntities));
    const mergedRecommendedSearchTerms = mergeUniqueStrings(fallback.recommendedSearchTerms, normalizeStringArray(data.recommendedSearchTerms));
    const groundedRecommendedSearchTerms = groundRecommendedSearchTerms(mergedRecommendedSearchTerms, projectTree);
    const structuredIntent = normalizeStructuredIntent(data, fallback.structuredIntent, rawTask, projectTree);
    const taskUnderstanding = normalizeTaskUnderstanding({
        modelValue: data,
        fallback: fallback.taskUnderstanding,
        rawTask,
        taskArea: finalTaskArea,
        taskType,
        confidence: Math.max(fallback.confidence, modelConfidence),
        projectTree,
        structuredIntent
    });
    const understandingSearchTerms = groundRecommendedSearchTerms(
        taskUnderstanding.targetHints,
        projectTree
    );

    return {
        taskArea: finalTaskArea,
        intentTags: mergeUniqueStrings(fallback.intentTags, normalizeStringArray(data.intentTags)),
        domainTerms: groundTermsToTaskOrProject(mergedDomainTerms, rawTask, projectTree),
        mentionedEntities: groundTermsToTaskOrProject(mergedMentionedEntities, rawTask, projectTree),
        fileRoleHints: mergeUniqueStrings(fallback.fileRoleHints, normalizeStringArray(data.fileRoleHints)),
        recommendedSearchTerms: mergeUniqueStrings(
            groundedRecommendedSearchTerms.length > 0
                ? groundedRecommendedSearchTerms
                : fallback.recommendedSearchTerms,
            understandingSearchTerms
        ),
        riskLevel: normalizeRiskLevel(data.riskLevel, fallback.riskLevel),
        confidence: Math.max(fallback.confidence, modelConfidence),
        structuredIntent,
        taskUnderstanding,
        notes: mergeUniqueStrings(
            normalizeStringArray(data.notes),
            fallback.notes,
            [
                structuredIntent.primaryTargets.length > 0
                    ? `Structured intent contains ${structuredIntent.primaryTargets.length} validated primary target(s).`
                    : "Structured intent did not contain validated primary targets.",
                `Task understanding readiness: ${taskUnderstanding.readiness}; action: ${taskUnderstanding.action}.`,
                trustFallbackArea && modelTaskArea !== fallback.taskArea
                ? `Model taskArea "${modelTaskArea}" was overridden by stronger task-text inference "${fallback.taskArea}".`
                : "Ollama intent was merged with grounded fallback analysis."
            ]
        ),
        source: "ollama",
        durationMs: fallback.durationMs
    };
}

export const TASK_UNDERSTANDING_INITIAL_NUM_PREDICT = 520;
export const TASK_UNDERSTANDING_REPAIR_NUM_PREDICT = 360;
export const TASK_UNDERSTANDING_PROJECT_PATH_LIMIT = 40;

function isRepresentativeIntentProjectPath(filePath: string) {
    const path = normalizeForCompare(filePath);
    if (!path) return false;
    if (/(?:^|\/)(?:node_modules|dist|build|coverage|\.git|\.vite)(?:\/|$)/u.test(path)) {
        return false;
    }
    if (/(?:^|\/)\.env(?:\.|$)/u.test(path)) return false;
    if (/\.(?:sqlite|sqlite3|db|png|jpe?g|gif|webp|ico|pdf|zip|7z|tar|gz|exe|dll|so|dylib)$/u.test(path)) {
        return false;
    }
    return true;
}

function isUiIntentProjectPath(filePath: string) {
    const path = normalizeForCompare(filePath);
    return /(?:^|\/)(?:apps?\/desktop\/renderer|renderer|frontend|client|pages?|components?|styles?)(?:\/|$)/u.test(path);
}

function isBackendIntentProjectPath(filePath: string) {
    const path = normalizeForCompare(filePath);
    return /(?:^|\/)(?:server|backend|api|routes?|services?|controllers?|database|db|models?|schemas?)(?:\/|$)/u.test(path);
}

function scoreRepresentativeIntentProjectPath(
    filePath: string,
    taskArea: TaskArea,
) {
    const path = normalizeForCompare(filePath);
    let score = 0;
    if (path.includes("/src/") || path.startsWith("src/")) score += 45;
    if (/\.(?:ts|tsx|js|jsx|mjs|cjs|svelte|vue|py|go|rs|java|kt|cs)$/u.test(path)) score += 30;
    if (/(?:^|\/)(?:pages?|components?|routes?|services?|controllers?|models?|schemas?|stores?|state|config|tests?)(?:\/|$)/u.test(path)) score += 18;

    const isUi = isUiIntentProjectPath(path);
    const isBackend = isBackendIntentProjectPath(path);
    const isBuild = /(?:^|\/)(?:package\.json|tsconfig[^/]*\.json|vite\.config\.[^/]+|eslint[^/]*|docker-compose\.ya?ml|\.github)(?:\/|$)/u.test(path);
    const isDocs = /(?:^|\/)(?:docs?|readme\.md|agents\.md|changelog\.md)(?:\/|$)/u.test(path);
    const isTest = /(?:^|\/)(?:tests?|__tests__)(?:\/|$)|\.(?:test|spec)\.[^.]+$/u.test(path);

    if (taskArea === "ui" && isUi) score += 130;
    if (taskArea === "backend" && isBackend) score += 130;
    if (taskArea === "fullstack" && (isUi || isBackend)) score += 72;
    if (taskArea === "build" && isBuild) score += 110;
    if (taskArea === "docs" && isDocs) score += 110;
    if (taskArea === "tests" && isTest) score += 110;
    if (taskArea === "bugfix" && (isTest || isUi || isBackend)) score += 32;
    if (taskArea === "refactor" && (isUi || isBackend)) score += 32;

    if (/(?:^|\/)(?:package\.json|tsconfig[^/]*\.json|vite\.config\.[^/]+|readme\.md|agents\.md)$/u.test(path)) score += 10;
    return score;
}

function scoreIntentProjectPath(rawTask: string, filePath: string) {
    const task = normalizeForCompare(rawTask);
    const path = normalizeForCompare(filePath);
    const fileName = path.split("/").pop() ?? path;
    const baseName = fileName.replace(/\.[^.]+$/, "");
    let score = 0;

    if (path && task.includes(path)) score += 1200;
    if (fileName.length >= 4 && task.includes(fileName)) score += 900;
    if (baseName.length >= 4 && task.includes(baseName)) score += 760;

    const taskTokens = tokenize(rawTask)
        .map((token) => token.replace(/\.[a-z0-9]+$/i, ""))
        .filter((token) => token.length >= 4)
        .filter((token) => !STOP_WORDS.has(token));

    for (const token of taskTokens) {
        if (path.includes(token)) score += 30 + Math.min(token.length, 16);
    }

    return score;
}

export function buildCompactIntentProjectTreeSnapshot(
    rawTask: string,
    projectTree: string[],
    limit = TASK_UNDERSTANDING_PROJECT_PATH_LIMIT,
    taskType = "general",
) {
    const safeLimit = Math.max(1, Math.min(limit, TASK_UNDERSTANDING_PROJECT_PATH_LIMIT));
    const normalized = Array.from(
        new Set(projectTree.map((path) => normalizePath(path)).filter(Boolean))
    );
    const scored = normalized
        .map((path, index) => ({
            path,
            index,
            score: scoreIntentProjectPath(rawTask, path)
        }))
        .sort((left, right) => right.score - left.score || left.index - right.index);
    const scoredArea = bestArea(scoreTaskMeaning(rawTask, taskType)).area;
    const selectedArea = getSelectedTaskTypeArea(taskType);
    const inferredArea =
        selectedArea !== "general" ? selectedArea : scoredArea;
    const representative = normalized
        .map((path, index) => ({
            path,
            index,
            score: scoreRepresentativeIntentProjectPath(path, inferredArea)
        }))
        .sort((left, right) => right.score - left.score || left.index - right.index);

    const result: string[] = [];
    const seen = new Set<string>();
    const add = (path: string) => {
        const key = normalizeForCompare(path);
        if (!key || seen.has(key) || result.length >= safeLimit) return;
        seen.add(key);
        result.push(path);
    };

    for (const item of scored) {
        if (item.score <= 0) break;
        add(item.path);
    }

    // Fullstack understanding should see at least a small sample from both
    // client and server layers even when the project tree is heavily skewed
    // toward one side.
    if (inferredArea === "fullstack") {
        for (const item of representative.filter((entry) =>
            isUiIntentProjectPath(entry.path),
        ).slice(0, 6)) {
            if (isRepresentativeIntentProjectPath(item.path)) add(item.path);
        }
        for (const item of representative.filter((entry) =>
            isBackendIntentProjectPath(entry.path),
        ).slice(0, 6)) {
            if (isRepresentativeIntentProjectPath(item.path)) add(item.path);
        }
    }

    // Understanding is not the file selector. When no path is named directly,
    // keep a small representative tree sample so the model can ground generic
    // page/service/config terms without serializing the entire project. Paths
    // that are secret-like, generated, binary, or runtime data are not useful
    // representative context, but an explicitly named path can still appear in
    // the scored block above.
    for (const item of representative) {
        if (isRepresentativeIntentProjectPath(item.path)) add(item.path);
    }

    return result;
}

export function buildIntentPrompt({ rawTask, taskType, targetTool, project, projectTree = [] }: AnalyzeTaskIntentInput) {
    const compactTree = buildCompactIntentProjectTreeSnapshot(
        rawTask,
        projectTree,
        TASK_UNDERSTANDING_PROJECT_PATH_LIMIT,
        taskType,
    );
    const omittedPathCount = Math.max(0, projectTree.length - compactTree.length);

    return `
You are ContextForge's semantic task analyzer.
Return one compact JSON object only. No Markdown, explanations, or extra keys.

Backend authority:
- The backend derives readiness, canProceed, missing information, exact literal values, clarification questions, tags, search terms, and final safety decisions.
- Do not repeat the full task, project tree, or long reasoning.

Rules:
- Classify the actual task: ui, backend, fullstack, build, bugfix, refactor, docs, tests, or general.
- A backend/API mention used only as a "do not change" constraint does not make a UI task fullstack.
- Targets must be present in the user task or relevant project paths. Never invent paths, routes, symbols, or services.
- interpretationRisk: objective for concrete outcomes, subjective for taste/polish/aesthetics, uncertain only when meaning is unclear.
- changeDefinition: exact only for a literal supplied value, bounded for a specific transformation, open_ended for materially different valid implementations.
- Maximums: 2 primaryTargets, 3 targetHints, 4 positiveActions, 4 protectedScopes, 3 ambiguities. Keep every string under 120 characters.
- Use empty arrays instead of guesses. Keep the complete response under 360 tokens.

Return exactly this shape:
{
  "taskArea": "ui|backend|fullstack|build|bugfix|refactor|docs|tests|general",
  "riskLevel": "low|medium|high",
  "confidence": 0.8,
  "taskUnderstanding": {
    "goal": "short grounded goal",
    "action": "create|update|replace|remove|fix|refactor|review|test|document|configure|investigate|unknown",
    "targetHints": [],
    "interpretationRisk": "objective|subjective|uncertain",
    "changeDefinition": "exact|bounded|open_ended"
  },
  "structuredIntent": {
    "primaryTargets": [
      {
        "kind": "explicit_file|route|page|component|symbol|entity|service|config|docs|asset|unknown",
        "value": "grounded target",
        "path": "real relative path or empty string",
        "routePath": "real route or empty string",
        "name": "real name or empty string",
        "confidence": 0.8
      }
    ],
    "positiveActions": [],
    "protectedScopes": [],
    "allowedEditScope": "explicit_targets_only|target_with_supporting_context|broad_but_safe|unknown",
    "needsStyles": null,
    "needsBackend": null,
    "ambiguities": []
  }
}

Selected task type: ${taskType}
Target tool: ${targetTool}
User task: ${rawTask}
Project: ${project.name}
Package manager: ${project.packageManager ?? "unknown"}
Stack: ${(project.detectedStack ?? []).slice(0, 12).join(", ") || "unknown"}
Relevant project paths (${compactTree.length}/${projectTree.length}; ${omittedPathCount} omitted):
${compactTree.join("\n") || "(none)"}
`.trim();
}

export function buildIntentRepairPrompt(rawResponse: string) {
    return `
Repair the response into one compact JSON object only. No Markdown or extra keys.
Keep strings short and arrays small. Do not invent project details.

Required shape:
{
  "taskArea": "ui|backend|fullstack|build|bugfix|refactor|docs|tests|general",
  "riskLevel": "low|medium|high",
  "confidence": 0.8,
  "taskUnderstanding": {
    "goal": "",
    "action": "create|update|replace|remove|fix|refactor|review|test|document|configure|investigate|unknown",
    "targetHints": [],
    "interpretationRisk": "objective|subjective|uncertain",
    "changeDefinition": "exact|bounded|open_ended"
  },
  "structuredIntent": {
    "primaryTargets": [],
    "positiveActions": [],
    "protectedScopes": [],
    "allowedEditScope": "explicit_targets_only|target_with_supporting_context|broad_but_safe|unknown",
    "needsStyles": null,
    "needsBackend": null,
    "ambiguities": []
  }
}

Invalid response:
${rawResponse.slice(0, 3200)}
`.trim();
}

async function requestOllamaJson({
    ollamaUrl,
    model,
    prompt,
    numPredict,
    purpose
}: {
    ollamaUrl: string;
    model: string;
    prompt: string;
    numPredict: number;
    purpose: string;
}) {
    const aiCall = beginPerformanceAiCall({
        purpose,
        provider: "ollama",
        model,
        promptChars: prompt.length,
        responseFormat: "json",
        numPredict
    });

    try {
        const response = await fetch(`${ollamaUrl.replace(/\/$/, "")}/api/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model,
                prompt,
                stream: false,
                format: "json",
                options: { temperature: 0, num_predict: numPredict }
            })
        });

        if (!response.ok) {
            finishPerformanceAiCall(aiCall, {
                success: false,
                httpStatus: response.status,
                errorCode: "http_error"
            });
            return {
                ok: false as const,
                status: response.status,
                raw: ""
            };
        }

        const data = (await response.json()) as OllamaGenerateResponse;
        const raw = String(data.response ?? "");
        const nsToMs = (value: number | undefined) =>
            typeof value === "number" ? value / 1_000_000 : null;

        finishPerformanceAiCall(aiCall, {
            success: Boolean(raw.trim()),
            httpStatus: response.status,
            responseChars: raw.length,
            modelLoadMs: nsToMs(data.load_duration),
            promptEvalMs: nsToMs(data.prompt_eval_duration),
            generationMs: nsToMs(data.eval_duration),
            promptTokens: data.prompt_eval_count ?? null,
            responseTokens: data.eval_count ?? null,
            errorCode: raw.trim() ? null : "empty_response"
        });

        return {
            ok: true as const,
            status: response.status,
            raw,
            json: extractJsonObject(raw)
        };
    } catch (error) {
        finishPerformanceAiCall(aiCall, {
            success: false,
            errorCode:
                error instanceof Error && error.name === "TimeoutError"
                    ? "timeout"
                    : "request_error"
        });
        throw error;
    }
}

export async function analyzeTaskIntent(input: AnalyzeTaskIntentInput): Promise<TaskIntentAnalysis> {
    const startedAt = Date.now();
    const fallback = buildFallbackIntent({
        rawTask: input.rawTask,
        taskType: input.taskType,
        projectTree: input.projectTree ?? []
    });
    const settings = await getAppSettings();

    if (settings.generationMode !== "ollama" || !settings.defaultOllamaModel) {
        return { ...fallback, durationMs: getDurationMs(startedAt) };
    }

    try {
        const firstAttempt = await requestOllamaJson({
            ollamaUrl: settings.ollamaUrl,
            model: settings.defaultOllamaModel,
            prompt: buildIntentPrompt(input),
            numPredict: TASK_UNDERSTANDING_INITIAL_NUM_PREDICT,
            purpose: "task_understanding_initial"
        });

        if (!firstAttempt.ok) {
            return {
                ...fallback,
                durationMs: getDurationMs(startedAt),
                notes: [...fallback.notes, `Ollama intent analyzer responded with status ${firstAttempt.status}.`]
            };
        }

        let json = firstAttempt.json;
        const repairNotes: string[] = [];
        if (!json) {
            const repairAttempt = await requestOllamaJson({
                ollamaUrl: settings.ollamaUrl,
                model: settings.defaultOllamaModel,
                prompt: buildIntentRepairPrompt(firstAttempt.raw),
                numPredict: TASK_UNDERSTANDING_REPAIR_NUM_PREDICT,
                purpose: "task_understanding_repair"
            });

            if (repairAttempt.ok && repairAttempt.json) {
                json = repairAttempt.json;
                repairNotes.push("Ollama intent JSON was repaired after an invalid first response.");
            } else {
                repairNotes.push("Ollama intent analyzer returned invalid JSON and repair did not produce valid JSON.");
            }
        }

        const normalized = normalizeIntentResult(json, fallback, input.rawTask, input.taskType, input.projectTree ?? []);

        return {
            ...normalized,
            durationMs: getDurationMs(startedAt),
            notes: [...repairNotes, ...(normalized.notes.length > 0 ? normalized.notes : ["Ollama intent analysis completed."])]
        };
    } catch (error) {
        return {
            ...fallback,
            durationMs: getDurationMs(startedAt),
            notes: [
                ...fallback.notes,
                error instanceof Error ? `Ollama intent analyzer failed: ${error.message}` : "Ollama intent analyzer failed."
            ]
        };
    }
}
