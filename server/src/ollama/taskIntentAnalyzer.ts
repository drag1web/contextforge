import { getAppSettings } from "../settings/settingsService.js";

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

function hasNoBackendChangeConstraint(rawTask: string) {
    return includesAny(rawTask, [
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
        "не менять интерфейс",
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
    const hasUi = includesAny(text, ["ui", "ux", "screen", "page", "layout", "visual", "design", "style", "css", "button", "form", "input", "focus", "modal", "card", "navigation", "header", "frontend", "component", "экран", "страниц", "визуал", "дизайн", "внешний вид", "кноп", "форма", "пол", "фокус", "модал", "карточ", "навигац", "шапк", "дороже", "чище", "деревян", "дефолт"]);
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

function addIfTaskMatches(task: string, terms: string[], onMatch: () => void) {
    if (includesAny(task, terms)) onMatch();
}

function buildFallbackIntent({ rawTask, taskType }: Pick<AnalyzeTaskIntentInput, "rawTask" | "taskType">): TaskIntentAnalysis {
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

    return {
        taskArea: best.area,
        intentTags: Array.from(intentTags),
        domainTerms: extractTaskDomainTerms(rawTask),
        mentionedEntities: [],
        fileRoleHints: Array.from(fileRoleHints),
        recommendedSearchTerms: Array.from(recommendedSearchTerms),
        riskLevel: getFallbackRiskLevel(best.area, rawTask),
        confidence: getFallbackConfidence(best.area, best.score),
        notes,
        source: "fallback",
        durationMs: getDurationMs(startedAt)
    };
}

function extractJsonObject(value: string) {
    const trimmed = value.trim();
    try { return JSON.parse(trimmed); } catch { /* continue */ }
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;
    try { return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)); } catch { return null; }
}

function normalizeIntentResult(value: unknown, fallback: TaskIntentAnalysis, rawTask: string, projectTree: string[]): TaskIntentAnalysis {
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

    return {
        taskArea: finalTaskArea,
        intentTags: mergeUniqueStrings(fallback.intentTags, normalizeStringArray(data.intentTags)),
        domainTerms: groundTermsToTaskOrProject(mergedDomainTerms, rawTask, projectTree),
        mentionedEntities: groundTermsToTaskOrProject(mergedMentionedEntities, rawTask, projectTree),
        fileRoleHints: mergeUniqueStrings(fallback.fileRoleHints, normalizeStringArray(data.fileRoleHints)),
        recommendedSearchTerms: groundedRecommendedSearchTerms.length > 0 ? groundedRecommendedSearchTerms : fallback.recommendedSearchTerms,
        riskLevel: normalizeRiskLevel(data.riskLevel, fallback.riskLevel),
        confidence: Math.max(fallback.confidence, modelConfidence),
        notes: mergeUniqueStrings(
            normalizeStringArray(data.notes),
            fallback.notes,
            [trustFallbackArea && modelTaskArea !== fallback.taskArea
                ? `Model taskArea "${modelTaskArea}" was overridden by stronger task-text inference "${fallback.taskArea}".`
                : "Ollama intent was merged with grounded fallback analysis."]
        ),
        source: "ollama",
        durationMs: fallback.durationMs
    };
}

function buildIntentPrompt({ rawTask, taskType, targetTool, project, projectTree = [] }: AnalyzeTaskIntentInput) {
    return `
You are ContextForge's task intent analyzer.

Return strict JSON only. No Markdown. No code fences.

Rules:
- The selected task type is a hint, not an absolute truth.
- If selected task type conflicts with the actual user task, classify by the actual task text.
- Use "backend" for API, authorization, authentication, session, token, cookie, server, database, endpoint, route, or service tasks.
- Use "fullstack" when the task needs both UI and backend/API changes.
- If the user says "keep backend API unchanged", "do not change backend", "frontend only", or "UI only", classify as "ui" unless the task explicitly asks to implement backend behavior.
- Mentioning API/backend as a constraint does not automatically make the task backend or fullstack.
- If the user says "backend only", "API only", or "do not change UI", classify as "backend" unless the task explicitly asks to change UI behavior.
- Use "build" for build, compiler, import, module resolution, tsconfig, vite, next, eslint, or path alias problems.
- Use "docs" only when the task is actually about README, documentation, setup instructions, or developer guide.
- Do not invent files, components, services, routes, stores, pages, or assets.
- domainTerms must be business/domain nouns from the user's task or visible project paths.
- Do not put generic words like page, screen, button, style, component, api, build, server into domainTerms.
- fileRoleHints should use generic roles: page, component, layout, style, api, route, service, state, store, model, schema, test, docs, config, asset, entry.
- recommendedSearchTerms must be short fragments grounded in the project tree.
- Empty arrays are better than guessed values.

Allowed taskArea values:
ui, backend, fullstack, build, bugfix, refactor, docs, tests, general

Allowed riskLevel values:
low, medium, high

Return JSON shape:
{
  "taskArea": "ui",
  "intentTags": [],
  "domainTerms": [],
  "mentionedEntities": [],
  "fileRoleHints": [],
  "recommendedSearchTerms": [],
  "riskLevel": "medium",
  "confidence": 0.8,
  "notes": []
}

Selected task type:
${taskType}

Target tool:
${targetTool}

User task:
${rawTask}

Project metadata:
${JSON.stringify({
        name: project.name,
        localPath: project.localPath,
        packageManager: project.packageManager,
        detectedStack: project.detectedStack,
        scripts: project.scripts,
        readinessScore: project.readinessScore
    }, null, 2)}

Project tree snapshot:
${projectTree.slice(0, 240).join("\n")}
`.trim();
}

export async function analyzeTaskIntent(input: AnalyzeTaskIntentInput): Promise<TaskIntentAnalysis> {
    const startedAt = Date.now();
    const fallback = buildFallbackIntent(input);
    const settings = await getAppSettings();

    if (settings.generationMode !== "ollama" || !settings.defaultOllamaModel) {
        return { ...fallback, durationMs: getDurationMs(startedAt) };
    }

    try {
        const response = await fetch(`${settings.ollamaUrl.replace(/\/$/, "")}/api/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: settings.defaultOllamaModel,
                prompt: buildIntentPrompt(input),
                stream: false,
                format: "json",
                options: { temperature: 0, num_predict: 700 }
            })
        });

        if (!response.ok) {
            return {
                ...fallback,
                durationMs: getDurationMs(startedAt),
                notes: [...fallback.notes, `Ollama intent analyzer responded with status ${response.status}.`]
            };
        }

        const data = (await response.json()) as OllamaGenerateResponse;
        const json = extractJsonObject(String(data.response ?? ""));
        const normalized = normalizeIntentResult(json, fallback, input.rawTask, input.projectTree ?? []);

        return {
            ...normalized,
            durationMs: getDurationMs(startedAt),
            notes: normalized.notes.length > 0 ? normalized.notes : ["Ollama intent analysis completed."]
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
