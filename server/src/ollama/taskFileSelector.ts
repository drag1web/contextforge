import { getAppSettings } from "../settings/settingsService.js";
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
}

interface OllamaGenerateResponse {
    response?: string;
}

interface TokenContext {
    strongTokens: string[];
    broadTokens: string[];
    explicitExistingPaths: string[];
    explicitMissingPaths: string[];
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
    return terms.some((term) => normalized.includes(term));
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
        input.rawTask,
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
        input.rawTask,
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

    const hasApi = includesAny(text, ["api", "апи", "endpoint", "эндпоинт", "route", "маршрут"]);
    const hasAuth = includesAny(text, ["auth", "authorization", "authentication", "login", "session", "token", "cookie", "авторизац", "логин", "сесс", "токен", "куки"]);
    const hasServer = includesAny(text, ["server", "backend", "database", "db", "service", "controller", "сервер", "серверный", "бэкенд", "бекенд", "база", "бд", "сервис"]);
    const hasUi = includesAny(text, ["ui", "ux", "screen", "page", "layout", "visual", "design", "style", "css", "button", "form", "input", "focus", "modal", "card", "navigation", "header", "frontend", "component", "экран", "страниц", "визуал", "дизайн", "кноп", "форма", "пол", "фокус", "модал", "карточ", "навигац", "шапк", "дороже", "чище", "деревян", "дефолт"]);

    if (hasApi || hasAuth || hasServer) scores.backend += 5;
    if (hasApi && hasAuth) scores.backend += 8;
    if (hasUi) scores.ui += 5;
    if (includesAny(text, ["build", "npm run build", "compile", "compilation", "bundl", "import", "imports", "module not found", "resolve", "alias", "tsconfig", "vite", "next build", "eslint", "typecheck", "typescript", "сборк", "билд", "компиляц", "импорт", "импортами", "путями", "алиас", "модул"])) scores.build += 9;
    if (includesAny(text, ["readme", "docs", "documentation", "guide", "manual", "instructions", "how to run", "setup", "onboarding", "документац", "ридми", "инструкц", "запуск", "запуска", "разработчик", "команды"])) scores.docs += 8;
    if (includesAny(text, ["test", "tests", "unit", "e2e", "spec", "coverage", "jest", "vitest", "playwright", "тест", "тесты", "покрытие"])) scores.tests += 7;
    if (includesAny(text, ["bug", "fix", "broken", "error", "crash", "fails", "not working", "ошибка", "баг", "слом", "падает", "не работает", "краш", "исправь", "почини"])) scores.bugfix += 3;
    if (includesAny(text, ["refactor", "cleanup", "restructure", "рефактор", "почисти", "не меняй логику", "не меняй бизнес-логику"])) scores.refactor += 3;

    if (hasUi && (hasApi || hasServer) && includesAny(text, ["button", "form", "screen", "page", "показывает результат", "кноп", "форма", "экран", "страниц"]) && includesAny(text, ["api", "endpoint", "server", "route", "вызывает сервер", "сервер", "эндпоинт", "маршрут"])) {
        scores.fullstack += 12;
    }

    if (input.taskIntent?.taskArea && input.taskIntent.taskArea !== "general") {
        scores[input.taskIntent.taskArea] += input.taskIntent.confidence >= 0.65 ? 2.5 : 1.2;
    }

    const selectedArea = getSelectedTaskTypeArea(input.taskType);
    if (selectedArea !== "general") scores[selectedArea] += 1;

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
    const taskText = normalizeForCompare([input.rawTask, ...(input.taskIntent?.intentTags ?? []), ...(input.taskIntent?.fileRoleHints ?? [])].join(" "));
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

    addSemanticTokenIfIncludes(tokens, text, ["библиотек", "library"], ["library", "libraries", "collection", "collections"]);
    addSemanticTokenIfIncludes(tokens, text, ["коллекц", "collection"], ["collection", "collections"]);
    addSemanticTokenIfIncludes(tokens, text, ["каталог", "catalog"], ["catalog", "catalogue", "list", "grid"]);
    addSemanticTokenIfIncludes(tokens, text, ["жанр", "genre"], ["genre", "genres", "category", "categories"]);
    addSemanticTokenIfIncludes(tokens, text, ["фильтр", "filter"], ["filter", "filters", "controls", "select", "dropdown"]);
    addSemanticTokenIfIncludes(tokens, text, ["поиск", "search"], ["search", "query"]);
    addSemanticTokenIfIncludes(tokens, text, ["сорт", "sort"], ["sort", "sorting", "order"]);
    addSemanticTokenIfIncludes(tokens, text, ["игра", "игр", "game"], ["game", "games"]);
    addSemanticTokenIfIncludes(tokens, text, ["калькулятор", "calculator", "roi"], ["calculator", "calc", "roi"]);
    addSemanticTokenIfIncludes(tokens, text, ["расчет", "расчёт", "calculation"], ["calculation", "calculate", "calculator"]);
    addSemanticTokenIfIncludes(tokens, text, ["модал", "modal", "dialog"], ["modal", "dialog"]);
    addSemanticTokenIfIncludes(tokens, text, ["форма", "form", "input", "focus", "фокус"], ["form", "input", "field", "focus"]);
    addSemanticTokenIfIncludes(tokens, text, ["навигац", "navigation", "navbar"], ["nav", "navigation", "navbar", "topbar", "header", "menu"]);
    addSemanticTokenIfIncludes(tokens, text, ["кноп", "button"], ["button", "buttons", "actions"]);
    addSemanticTokenIfIncludes(tokens, text, ["главн", "homepage", "landing"], ["home", "homepage", "landing"]);
    addSemanticTokenIfIncludes(tokens, text, ["карточ", "card"], ["card", "cards", "item"]);
    addSemanticTokenIfIncludes(tokens, text, ["товар", "product"], ["product", "products", "item", "items"]);
    addSemanticTokenIfIncludes(tokens, text, ["активац", "activation", "activate"], ["activation", "activate", "license", "key"]);
    addSemanticTokenIfIncludes(tokens, text, ["ключ", "key"], ["key", "license"]);
    addSemanticTokenIfIncludes(tokens, text, ["покуп", "оплат", "purchase", "payment", "checkout"], ["purchase", "payment", "checkout", "order"]);
    addSemanticTokenIfIncludes(tokens, text, ["клиент", "client"], ["client", "customer", "user"]);
    addSemanticTokenIfIncludes(tokens, text, ["логотип", "лого", "logo"], ["logo", "brand"]);
    addSemanticTokenIfIncludes(tokens, text, ["favicon"], ["favicon", "icon"]);
    addSemanticTokenIfIncludes(tokens, text, ["картин", "изображ", "image", "picture", "photo"], ["image", "img", "picture", "photo", "asset", "assets"]);
    addSemanticTokenIfIncludes(tokens, text, ["фон", "background"], ["background", "hero"]);
    addSemanticTokenIfIncludes(tokens, text, ["баннер", "banner", "cover"], ["banner", "cover", "hero"]);
    addSemanticTokenIfIncludes(tokens, text, ["сборк", "build", "импорт", "import", "alias", "алиас", "tsconfig", "vite", "next", "eslint"], ["package", "config", "tsconfig", "vite", "next", "eslint", "layout", "page", "app"]);
    addSemanticTokenIfIncludes(tokens, text, ["readme", "docs", "инструкц", "запуск", "команды"], ["readme", "docs", "package", "config", "env", "docker"]);

    return Array.from(tokens);
}

function extractPathLikeTokens(rawTask: string) {
    return rawTask.match(/[\w.@()\-]+(?:[\\/][\w.@()\-]+)+(?:\.[a-zA-Z0-9]+)?/g) ?? [];
}

function buildTokenContext(input: SelectTaskFilesInput): TokenContext {
    const explicitPathTokens = extractPathLikeTokens(input.rawTask).map(normalizePath);
    const inventoryPathSet = new Set(input.inventory.files.map((file) => normalizeForCompare(file.path)));
    const explicitExistingPaths = explicitPathTokens.filter((pathValue) => inventoryPathSet.has(normalizeForCompare(pathValue)));
    const explicitMissingPaths = explicitPathTokens.filter((pathValue) => !inventoryPathSet.has(normalizeForCompare(pathValue)));

    const rawTokens = tokenize(input.rawTask);
    const semanticTokens = buildSemanticTokens(input);
    const intentTokens = tokenize([
        ...(input.taskIntent?.domainTerms ?? []),
        ...(input.taskIntent?.mentionedEntities ?? []),
        ...(input.taskIntent?.recommendedSearchTerms ?? [])
    ].join(" "));
    const roleTokens = tokenize([
        input.taskType,
        input.targetTool,
        input.taskIntent?.taskArea ?? "",
        ...(input.taskIntent?.intentTags ?? []),
        ...(input.taskIntent?.fileRoleHints ?? [])
    ].join(" "));

    const strongTokens = uniqueStrings([...rawTokens, ...semanticTokens, ...intentTokens]).filter((token) => {
        if (WEAK_TASK_TOKENS.has(token)) return false;
        if (token.includes("/") || token.includes("\\")) return false;
        if (BROAD_PATH_TOKENS.has(token) && !semanticTokens.includes(token)) return false;
        return true;
    });

    const broadTokens = uniqueStrings(roleTokens).filter((token) => !strongTokens.includes(token));
    return { strongTokens, broadTokens, explicitExistingPaths, explicitMissingPaths };
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

    if (["app.tsx", "app.jsx", "main.tsx", "main.jsx"].includes(fileName)) return true;

    // Treat Next/React app-router files as UI, but do not classify arbitrary backend files under src/app/* as UI.
    if (filePath.startsWith("src/app/") && ["page.tsx", "page.jsx", "layout.tsx", "layout.jsx", "template.tsx", "template.jsx", "loading.tsx", "loading.jsx", "error.tsx", "error.jsx"].includes(fileName)) {
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
    const filePath = normalizeForCompare(file.path);

    const licenseTask = includesAny(taskText, ["license", "licenses", "лиценз", "ключ"]);
    if (licenseTask && includesAny(filePath, ["license", "licenses", "licence", "licences", "registry", "реестр"])) return true;

    const actionTask = includesAny(taskText, ["button", "кноп", "action", "endpoint", "server", "api", "result", "результат"]);
    if (actionTask && includesAny(filePath, ["page", "pages", "component", "components", "row", "menu", "table", "list", "detail", "card", "form", "modal", "license", "registry"])) return true;

    return includesAny(filePath, ["app.tsx", "app.jsx", "page.tsx", "page.jsx", "screen", "view"]);
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

    if (includesAny(taskText, ["license", "licenses", "лиценз", "ключ"])) {
        if (includesAny(filePath, ["license", "licenses", "licence", "licences", "registry", "реестр"])) score += 85;
        if (includesAny(filePath, ["run", "runs", "check", "checks", "monitor", "registry", "table", "row", "detail"])) score += 20;
    }

    if (includesAny(taskText, ["button", "кноп", "action", "endpoint", "server", "api", "result", "результат", "показывает"])) {
        if (includesAny(filePath, ["page", "pages", "component", "components", "actions", "button", "menu", "row", "table", "detail", "card", "form", "modal"])) score += 45;
    }

    const tokenContext = buildTokenContext(input);
    score += getStrongTokenMatchCount(file.path, tokenContext.strongTokens) * 18;

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

function scorePathTokenMatches(file: ProjectInventoryFile, tokenContext: TokenContext) {
    const filePath = normalizeForCompare(file.path);
    const pathSegments = tokenize(file.path);
    let score = 0;

    for (const token of tokenContext.strongTokens) {
        if (pathSegments.includes(token)) score += 38;
        else if (filePath.includes(token)) score += 24;
    }

    for (const token of tokenContext.broadTokens) {
        if (BROAD_PATH_TOKENS.has(token)) continue;
        if (pathSegments.includes(token)) score += 8;
        else if (filePath.includes(token)) score += 4;
    }

    return score;
}

function scoreFileFallback(file: ProjectInventoryFile, tokenContext: TokenContext, input: SelectTaskFilesInput, area: EffectiveTaskArea, assetMode: AssetMode) {
    const filePath = normalizeForCompare(file.path);
    let score = getKindWeight(file, area, assetMode);
    score += scorePathTokenMatches(file, tokenContext);

    const strongMatchCount = getStrongTokenMatchCount(file.path, tokenContext.strongTokens);
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
        if (filePath.includes("/components/")) score += 8;
        if (filePath.includes("/pages/") || filePath.includes("/app/")) score += 8;
        if (isServerSidePath(file.path) && !hasStrongMatch) score -= 45;
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
    let priority = file.confidence * 100;

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
        if (file.kind === "style") priority += 90;
        if (isClientUiPath(file.path)) priority += 60;
        if (isServerSidePath(file.path)) priority -= 80;
    }

    if (isLockFilePath(file.path)) priority -= 250;
    if (filePath.endsWith("next-env.d.ts") || filePath.endsWith("vite-env.d.ts")) priority -= 100;

    return priority;
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

    return sorted
        .filter((file) => {
            if (file.kind !== "asset") return true;
            if (assetCount >= assetCap) return false;
            assetCount += 1;
            return true;
        })
        .slice(0, MAX_SELECTED_FILES);
}

function trimLowValueFallbackCandidates(items: Array<{ file: ProjectInventoryFile; score: number }>, tokenContext: TokenContext, area: EffectiveTaskArea) {
    if (items.length === 0) return [];
    const maxScore = items[0]?.score ?? 0;
    const dynamicThreshold = Math.max(area === "docs" || area === "build" ? 28 : 38, Math.floor(maxScore * 0.5));

    const trimmed = items.filter((item) => {
        if (item.score >= dynamicThreshold) return true;
        if (tokenContext.strongTokens.length > 0 && hasAnyStrongMatch(item.file.path, tokenContext.strongTokens) && item.score >= 32) return true;
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

    if (isSensitiveEnvPath(file.path)) return false;
    if (file.kind === "runtime") return false;
    if (file.isLikelyGenerated) return false;
    if (isGeneratedDoNotEditPath(file.path) && area !== "build") return false;
    if (isLockFilePath(file.path) && !includesAny(taskText, ["lock", "package-lock", "pnpm-lock", "yarn.lock"])) return false;
    if (file.kind === "asset" && assetMode === "none") return false;
    if (file.sizeBytes === 0 && !includesAny(input.rawTask, [file.name, file.path])) return false;

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
    if (!canUseSelectedFile(input, file, area, assetMode)) return false;

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

    if ((area === "ui" || area === "fullstack") && wantsRedesign && !hasStyle) {
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

function buildFallbackSelection(input: SelectTaskFilesInput): TaskFileSelection {
    const startedAt = Date.now();
    const effectiveTaskArea = getEffectiveTaskArea(input);
    const assetMode = getAssetMode(input);
    const conflictNote = getConflictNote(input, effectiveTaskArea);
    const tokenContext = buildTokenContext(input);
    const selected: SelectedTaskFile[] = [];

    for (const explicitPath of tokenContext.explicitExistingPaths) {
        const inventoryFile = findInventoryFile(input.inventory, explicitPath);
        if (inventoryFile && canUseSelectedFile(input, inventoryFile, effectiveTaskArea, assetMode)) {
            selected.push(makeSelectedFile(inventoryFile, "Explicitly mentioned by the user and validated against the real project inventory.", 0.95));
        }
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
            conflictNote ?? "No task type conflict detected.",
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
        extension: file.extension,
        sizeBytes: file.sizeBytes,
        canReadText: file.canReadText,
        isLikelyGenerated: file.isLikelyGenerated
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
- The selected task type is only a hint. The inferred task area is "${effectiveTaskArea}".
- Asset mode is "${assetMode}".
- If asset mode is "none", do not select assets.
- If asset mode is "mixed", select mostly source/style files and at most 1-2 highly relevant assets.
- If asset mode is "primary", select matching real assets such as logo, favicon, icons, images, or files under public/assets, plus source/style files that reference them.
- For build/config tasks, prefer package.json, framework config, TypeScript config, lint config, entry/layout/page/route files that may cause build/import failures.
- For docs tasks, prefer README/docs/package/config files. Avoid unrelated source files.
- For fullstack tasks, include server/API files, client API bridge files, and the most relevant UI component/page.
- For backend tasks, prefer server/api/routes/db/services/electron files and avoid client UI files unless they are API bridge files.
- For UI tasks, prefer page/component/layout/style files and avoid server-only files.
- Avoid package-lock.json, pnpm-lock.yaml, yarn.lock, empty files, generated files, and unrelated source files.
- Binary files should usually be "asset-reference" or "inspect-only".
- Style/source files must never use "asset-reference".
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

function extractJsonObject(value: string) {
    const trimmed = value.trim();
    try { return JSON.parse(trimmed); } catch { /* continue */ }
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;
    try { return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)); } catch { return null; }
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
            fallback.conflictNote ?? "No task type conflict detected.",
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
    const fallback = buildFallbackSelection(input);
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
                prompt: buildSelectorPrompt(input),
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
        return normalizeModelSelection(json, input, fallback, startedAt);
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
