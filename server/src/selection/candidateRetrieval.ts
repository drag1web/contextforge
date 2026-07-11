import { createHash } from "node:crypto";

import type { SelectedTaskFileUsage } from "../ollama/taskFileSelector.js";
import type { TaskArea, TaskIntentAnalysis } from "../ollama/taskIntentAnalyzer.js";
import type {
  ProjectInventory,
  ProjectInventoryFile,
  ProjectInventoryFileRole,
} from "../scanner/projectInventoryScanner.js";
import { resolveExplicitFileMentions } from "./explicitFileMentions.js";
import {
  buildProjectSemanticGraph,
  type ProjectSemanticGraph,
  type SemanticGraphEdgeKind,
} from "./projectSemanticGraph.js";
import { detectHardTaskSafetyIssue, isSecretLikePath } from "./safetyPolicy.js";

export type CandidateRetrievalChannel =
  | "explicit-target"
  | "exact-filename"
  | "symbol-match"
  | "lexical-path"
  | "technical-role"
  | "semantic-graph"
  | "import-relation"
  | "layer-relation"
  | "test-relation"
  | "docs-config"
  | "core-responsibility";

export type CandidateTechnicalRole = "primary" | "support" | "reference";

export interface RetrievedCandidate {
  candidateId: string;
  path: string;
  file: ProjectInventoryFile;
  score: number;
  matchScore: number;
  evidence: string[];
  channels: CandidateRetrievalChannel[];
  proposedUsage: SelectedTaskFileUsage;
  proposedTechnicalRole: CandidateTechnicalRole;
  graphRelationships: Array<{
    kind: SemanticGraphEdgeKind;
    relatedPath: string;
  }>;
  identityMatchCount: number;
  filenameMatchCount: number;
  roleIntentMatch: boolean;
  explicit: boolean;
}

export interface CandidateRetrievalOptions {
  maxCandidates?: number;
  graph?: ProjectSemanticGraph;
}

export interface CandidateRetrievalInput {
  rawTask: string;
  requestedTaskType: string;
  inventory: ProjectInventory;
  taskIntent?: TaskIntentAnalysis;
  options?: CandidateRetrievalOptions;
}

export interface CandidateRetrievalResult {
  candidates: RetrievedCandidate[];
  candidateIds: string[];
  rawTask: string;
  requestedTaskType: string;
  inventory: ProjectInventory;
  graph?: ProjectSemanticGraph;
  implementationArea: TaskArea;
  reviewOnly: boolean;
  blocked: boolean;
  manualReview: boolean;
  warnings: string[];
  explicitExistingPaths: string[];
  explicitMissingPaths: string[];
  candidateLimit: number;
}

const STOP_TOKENS = new Set([
  "the", "and", "for", "with", "from", "this", "that", "into", "add", "edit",
  "update", "change", "improve", "make", "project", "file", "files", "code", "screen",
  "app", "application",
  "для", "или", "это", "как", "чтобы", "надо", "нужно", "добавь", "измени",
  "обнови", "улучши", "сделай", "файл", "файлы", "код", "проект",
]);

const EDIT_ROLES = new Set<ProjectInventoryFileRole>([
  "page", "component", "ui-component", "style", "api-route", "service", "repository",
  "db-schema", "store", "types", "utility", "hook", "client-api", "test", "docs", "config",
  "app-entry", "server-entry",
]);

const PRIMARY_IMPLEMENTATION_ROLES = new Set<ProjectInventoryFileRole>([
  "page", "api-route", "service", "repository", "db-schema", "store",
  "utility", "client-api", "test", "docs", "app-entry", "server-entry",
]);

function normalizePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

function normalizeText(value: string) {
  return normalizePath(value).toLowerCase();
}

function isDocumentationSupportFile(file: ProjectInventoryFile) {
  const name = normalizeText(file.name);
  return (
    name === "package.json" ||
    /^(?:\.env|env)[._-](?:example|sample|template)$/.test(name) ||
    /^(?:pyproject\.toml|cargo\.toml|go\.mod|pom\.xml|composer\.json|gemfile|requirements(?:-dev)?\.txt)$/.test(name) ||
    /^docker-compose(?:\.[^.]+)?\.ya?ml$/.test(name)
  );
}

function isRootDocumentationSupportFile(file: ProjectInventoryFile) {
  if (!isDocumentationSupportFile(file)) return false;
  return normalizePath(file.path).split("/").filter(Boolean).length === 1;
}

function isPersistenceFile(file: ProjectInventoryFile) {
  if (["repository", "db-schema", "store"].includes(file.role)) return true;
  const pathValue = normalizeText(file.path);
  const name = normalizeText(file.name);
  return (
    /(?:^|\/)(?:db|database|storage|repositories?|persistence)(?:\/|$)/.test(pathValue) &&
    /(?:quer(?:y|ies)|repository|database|storage|schema|model|adapter)/.test(name)
  );
}

function workspaceRootForPath(pathValue: string) {
  const parts = normalizePath(pathValue).split("/").filter(Boolean);
  const srcIndex = parts.lastIndexOf("src");
  if (srcIndex > 0) return parts.slice(0, srcIndex).join("/").toLowerCase();
  if ((parts[0] === "apps" || parts[0] === "packages") && parts.length > 1) {
    return parts.slice(0, 2).join("/").toLowerCase();
  }
  return (parts[0] ?? "").toLowerCase();
}

function hasNavigationTaskIntent(rawTask: string) {
  const text = normalizeText(rawTask);
  return /\b(?:navigation|navbar|header|menu|active state|keyboard focus|focus)\b|(?:навигац|меню|хедер|активн|клавиатур|фокус)/iu.test(text);
}

function importMentionsFile(importPath: string, file: ProjectInventoryFile) {
  const importStem = normalizeText(importPath).split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
  const fileStem = normalizeText(file.name).replace(/\.[^.]+$/, "");
  return importStem === fileStem || importStem.endsWith(fileStem) || fileStem.endsWith(importStem);
}

function expandTechnicalToken(token: string) {
  const expanded = [token];
  if (/^главн/u.test(token)) expanded.push("home", "landing");
  if (/^документац/u.test(token)) expanded.push("docs", "documentation");
  if (/^сопостав/u.test(token) || /^мапп/u.test(token)) expanded.push("mapping");
  if (/^словар/u.test(token)) expanded.push("dictionary", "dictionaries");
  if (/^настро/u.test(token)) expanded.push("settings");
  if (/^хранилищ/u.test(token)) expanded.push("storage", "database", "db");
  if (/^сводн/u.test(token)) expanded.push("summary", "status");
  if (/^библиотек/u.test(token)) expanded.push("library");
  if (/^сортир/u.test(token)) expanded.push("sort", "sorting");
  if (/^расч[её]т/u.test(token)) expanded.push("calculation", "calculate", "calculator");
  if (/^нулев/u.test(token)) expanded.push("zero", "invalid");
  if (/^отриц/u.test(token)) expanded.push("negative", "invalid");
  if (/^навигац/u.test(token)) expanded.push("navigation", "nav", "header", "menu");
  if (/^мобил/u.test(token)) expanded.push("mobile", "responsive", "breakpoint");
  if (/^брейкпоинт/u.test(token)) expanded.push("breakpoint", "responsive");
  if (/^формул/u.test(token)) expanded.push("formula", "calculation");
  if (/^фильтр/u.test(token)) expanded.push("filter", "filtering");
  if (/^зависим/u.test(token)) expanded.push("dependency", "dependencies");
  if (/^очеред/u.test(token)) expanded.push("queue", "queues");
  if (/^каталог/u.test(token)) expanded.push("catalog");
  if (/^валидац/u.test(token)) expanded.push("validation", "validate");
  if (/^авторизац/u.test(token) || /^аутентификац/u.test(token)) expanded.push("auth", "authentication");
  if (/^документ/u.test(token)) expanded.push("docs", "documentation");
  if (/^адаптив/u.test(token)) expanded.push("responsive", "breakpoint");
  if (/^оформлен/u.test(token) || /^внешн/u.test(token)) expanded.push("appearance", "style", "theme");
  if (/^глобальн/u.test(token)) expanded.push("global");
  if (/^анализ/u.test(token)) expanded.push("analysis");

  if (/^[a-z0-9]+$/i.test(token)) {
    if (token.endsWith("ies") && token.length > 4) expanded.push(`${token.slice(0, -3)}y`);
    if (token.endsWith("s") && !token.endsWith("ss") && token.length > 4) expanded.push(token.slice(0, -1));
    if (token.endsWith("ing") && token.length > 6) expanded.push(token.slice(0, -3));
    if (token === "navigation") expanded.push("nav", "header", "menu");
    if (token === "authentication") expanded.push("auth");
    if (token === "calculation" || token === "calculator") expanded.push("calculate");
    if (token === "responsive") expanded.push("breakpoint", "mobile");
    if (token === "appearance") expanded.push("theme", "style");
    if (token === "pull") expanded.push("pr");
  }
  return expanded;
}

function tokenize(value: string) {
  const prepared = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ");
  const tokens = normalizeText(prepared)
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOP_TOKENS.has(token));
  return Array.from(new Set(tokens.flatMap(expandTechnicalToken)));
}

function matches(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

export function isReviewOnlyTask(rawTask: string) {
  const text = normalizeText(rawTask);
  return matches(text, [
    /\b(?:do not edit|don't edit|no code changes|review only|analysis only|suggest improvements)\b/i,
    /(?:код не меняй|не редактируй|без правок|только анализ|только review|предложи улучшения|посмотри ux)/iu,
  ]);
}

function hasDirectTestIntent(text: string) {
  if (matches(text, [/\b(?:unit|integration|e2e|smoke|replay|regression)\s+tests?\b/i, /\b(?:coverage|assertions?|test suite|test cases?)\b/i])) return true;
  if (matches(text, [/\b(?:add|write|create|implement|update)\b[^.!?\n]{0,90}\btests?\b/i, /(?:добавь|напиши|создай|реализуй|покрой)[^.!?\n]{0,90}(?:тест(?:ы)?|проверки)(?=$|[\s,.;:!?])/iu])) return true;
  if (matches(text, [/\btests?\s+(?:for|of)\b/i, /(?:тест(?:ы)?|проверки)(?=$|[\s,.;:!?])\s+(?:для|на)\b/iu])) return true;
  return false;
}

export function inferRetrievalArea(rawTask: string, requestedTaskType: string): TaskArea {
  const requested = normalizeText(requestedTaskType);
  if (["fullstack", "full-stack"].includes(requested)) return "fullstack";
  if (["docs", "documentation"].includes(requested)) return "docs";
  if (["test", "tests", "testing"].includes(requested)) return "tests";
  if (["backend", "server", "api"].includes(requested)) return "backend";
  if (["ui", "ux", "frontend", "front-end"].includes(requested)) return "ui";
  if (["build", "config", "configuration"].includes(requested)) return "build";
  if (["bugfix", "bug-fix"].includes(requested)) return "bugfix";
  if (requested === "refactor") return "refactor";

  const text = normalizeText(rawTask);
  const uiIntent = matches(text, [/\b(?:ui|ux|page|screen|component|dashboard|modal|button|layout|style|frontend)\b/i, /(?:интерфейс|страниц|компонент|дашборд|модал|кноп|верстк|стил|дизайн|фронтенд)/iu]);
  const backendIntent = matches(text, [/\b(?:endpoint|backend|server|route|service|repository|storage|database|schema|api)\b/i, /(?:эндпоинт|бэкенд|бекенд|сервер|роут|сервис|хранилищ|репозитор|база|схема|апи)/iu]);
  const backendProtected = matches(text, [
    /(?:do not touch|don't change|keep)\s+(?:the\s+)?(?:backend|server|api)\b/i,
    /\b(?:backend|server|api)(?:\s*[/,&+]\s*(?:backend|server|api))*\b[^.!?]{0,24}\b(?:unchanged|untouched|do not touch|don't change)\b/i,
    /(?:не трогай|не меняй|не изменяй)\s+(?:бэкенд|бекенд|сервер|апи|api)\b/iu,
    /(?:бэкенд|бекенд|backend|сервер|server|апи|api)(?:\s*[/,&+]\s*(?:бэкенд|бекенд|backend|сервер|server|апи|api))*\b[^.!?]{0,24}(?:не трогай|не меняй|не изменяй|без изменений)/iu,
  ]);
  const frontendProtected = matches(text, [
    /(?:do not touch|don't change|keep)\s+(?:the\s+)?(?:frontend|web\s+ui|ui|client|react\s+client)\b/i,
    /\b(?:frontend|web\s+ui|ui|client|react\s+client)(?:\s*[/,&+]\s*(?:frontend|web\s+ui|ui|client|react\s+client))*\b[^.!?]{0,24}\b(?:unchanged|untouched|do not touch|don't change)\b/i,
    /(?:не трогай|не меняй|не изменяй)\s+(?:фронтенд|интерфейс|ui|клиент)\b/iu,
    /(?:фронтенд|frontend|интерфейс|ui|клиент|client)(?:\s*[/,&+]\s*(?:фронтенд|frontend|интерфейс|ui|клиент|client))*\b[^.!?]{0,24}(?:не трогай|не меняй|не изменяй|без изменений)/iu,
  ]);
  if (uiIntent && backendProtected) return "ui";
  if (backendIntent && frontendProtected) return "backend";
  if (isReviewOnlyTask(rawTask) && uiIntent) return "ui";
  if (backendIntent && uiIntent) return "fullstack";
  if (matches(text, [/\b(?:readme|documentation|docs?|setup guide)\b/i, /(?:документац|ридми|инструкц|установка)/iu])) return "docs";
  if (hasDirectTestIntent(text)) return "tests";
  if (isCoreTask(rawTask)) return "backend";
  if (matches(text, [/\b(?:bug|broken|incorrect|fails?|nan|fix)\b/i, /(?:баг|ошиб|ломает|неверн|почини)/iu])) return "bugfix";
  if (matches(text, [/\b(?:refactor|cleanup|restructure)\b/i, /(?:рефактор|без изменения логики)/iu])) return "refactor";
  if (backendIntent) return "backend";
  if (matches(text, [/\b(?:build|tsconfig|vite|webpack|compile|bundl|config)\b/i, /(?:сборк|компиляц|конфиг)/iu])) return "build";
  if (uiIntent) return "ui";
  return "general";
}

function isCoreTask(rawTask: string) {
  const text = normalizeText(rawTask);
  return matches(text, [
    /\b(?:selector|scanner|fallback|scoring|confidence|safety policy|context composer|task pack builder|file selection)\b/i,
    /(?:ядро|селектор|сканер|фолбэк|скоринг|контекст композер|выбор файлов)/iu,
  ]);
}

function hasRoleIntentForFile(file: ProjectInventoryFile, rawTask: string, area: TaskArea) {
  const text = normalizeText(rawTask);
  const routeIntent = matches(text, [
    /\b(?:endpoint|route|router|server|api|handler)\b/i,
    /(?:эндпоинт|роут|маршрут|сервер|апи|обработчик)/iu,
  ]);
  const storageIntent = matches(text, [
    /\b(?:sqlite|storage|database|db|repository|persistence|schema|query|queries)\b/i,
    /(?:sqlite|хранилищ|баз[аеуы]|бд|репозитор|персист|схем|запрос)/iu,
  ]);
  const serviceIntent = matches(text, [
    /\b(?:service|business logic|workflow)\b/i,
    /(?:сервис|бизнес[- ]логик|пайплайн)/iu,
  ]);
  const clientIntent = matches(text, [
    /\b(?:frontend|client|ui|screen|page)\b/i,
    /(?:фронтенд|клиент|интерфейс|ui|страниц|экран)/iu,
  ]);
  const utilityIntent = matches(text, [
    /\b(?:calculation|formula|parser|classifier|scoring|risk|validation|utility|helper|appearance)\b/i,
    /(?:расч[её]т|формул|парсер|классифик|скоринг|риск|валидац|утилит|хелпер|оформлен)/iu,
  ]);
  const typesIntent = matches(text, [
    /\b(?:types?|interfaces?|contracts?|payload|dto)\b/i,
    /(?:тип(?:ы)?|интерфейс(?:ы)?|контракт|пейлоад|дто)/iu,
  ]);

  if (area === "backend" || area === "fullstack") {
    if (routeIntent && ["api-route", "server-entry"].includes(file.role)) return true;
    if (storageIntent && isPersistenceFile(file)) return true;
    if (serviceIntent && file.role === "service") return true;
    if (utilityIntent && file.role === "utility") return true;
    if (typesIntent && file.role === "types") return true;
  }
  if (area === "fullstack" && clientIntent && file.role === "client-api") return true;
  if (["bugfix", "refactor", "general"].includes(area) && utilityIntent && file.role === "utility") return true;
  if (area === "tests" && hasDirectTestIntent(text) && isTestLikeFile(file)) return true;
  return false;
}

function hasStorageTaskIntent(rawTask: string) {
  const text = normalizeText(rawTask);
  return matches(text, [
    /\b(?:sqlite|storage|database|db|repository|persistence|schema|query|queries)\b/i,
    /(?:sqlite|хранилищ|баз[аеуы]|бд|репозитор|персист|схем|запрос)/iu,
  ]);
}

function candidateIdForPath(pathValue: string) {
  return `candidate_${createHash("sha256").update(normalizeText(pathValue)).digest("hex").slice(0, 14)}`;
}

function isGeneratedOrRuntime(file: ProjectInventoryFile) {
  const pathValue = normalizeText(file.path);
  return (
    file.isLikelyGenerated ||
    file.kind === "runtime" ||
    /(?:^|\/)(?:dist|build|out|coverage|node_modules|\.next|\.cache)(?:\/|$)/.test(pathValue) ||
    /(?:^|\/)reports\/selector-benchmark(?:[-/]|$)/.test(pathValue) ||
    /(?:^|\/)(?:data|server\/data)\/backups(?:\/|$)/.test(pathValue) ||
    /(?:^|\/)storage\/repositories\/[a-z0-9_-]{12,}(?:\/|$)/.test(pathValue) ||
    /(?:^|\/)selector-benchmark\.projects\.json$/.test(pathValue)
  );
}

function fileIdentity(file: ProjectInventoryFile) {
  return [
    file.path,
    file.name,
    file.role,
    file.kind,
    file.routePath ?? "",
    ...(file.symbols ?? []),
    ...(file.exports ?? []),
    ...(file.textHints ?? []),
  ].join(" ");
}

function isTestLikeFile(file: ProjectInventoryFile) {
  const pathValue = normalizeText(file.path);
  return file.kind === "test" || file.role === "test" || pathValue.includes(".smoke.") || pathValue.includes(".replay.");
}

const GENERIC_IDENTITY_TOKENS = new Set([
  "ui", "ux", "frontend", "backend", "server", "api", "page", "screen",
  "component", "style", "route", "endpoint", "service", "repository", "storage",
  "database", "db", "schema", "query", "queries", "file", "code",
  "change", "update", "improve", "fix", "refactor", "review", "tests", "test",
]);

function isPrimaryRoleForArea(file: ProjectInventoryFile, area: TaskArea, hasIdentityEvidence: boolean) {
  if (area === "docs") return file.kind === "docs" || file.role === "docs";
  if (!hasIdentityEvidence) return false;
  if (area === "ui") {
    return ["page", "component", "ui-component", "style", "hook"].includes(file.role);
  }
  if (area === "backend") {
    return ["api-route", "service", "repository", "db-schema", "store", "utility", "server-entry"].includes(file.role) || isPersistenceFile(file);
  }
  if (area === "fullstack") {
    return [
      "page", "component", "ui-component", "hook", "client-api",
      "api-route", "service", "repository", "db-schema", "store", "utility", "server-entry",
    ].includes(file.role) || isPersistenceFile(file);
  }
  if (area === "tests") return isTestLikeFile(file);
  if (area === "build") {
    return file.kind === "config" || file.kind === "source" || ["config", "app-entry", "server-entry"].includes(file.role);
  }
  if (area === "bugfix" || area === "refactor" || area === "general") {
    return (EDIT_ROLES.has(file.role) || file.kind === "source") && file.kind !== "config";
  }
  return PRIMARY_IMPLEMENTATION_ROLES.has(file.role);
}

function roleScore(file: ProjectInventoryFile, area: TaskArea, coreTask: boolean) {
  const pathValue = normalizeText(file.path);
  if (coreTask) {
    if (/(?:^|\/)(?:selection|ollama|contextcomposer|scanner)(?:\/|$)/.test(pathValue)) return 78;
    if (/(?:replay|smoke|selector|quality|safety)/.test(pathValue)) return 58;
    if (/(?:^|\/)apps\/desktop\//.test(pathValue)) return -55;
  }

  if (area === "docs") {
    if (pathValue.endsWith("readme.md")) return 105;
    if (file.kind === "docs") return 72;
    if (file.kind === "config") return 28;
    if (file.kind === "source") return -38;
  }
  if (area === "tests") {
    if (isTestLikeFile(file)) return 82;
    if (file.kind === "config") return 34;
    if (file.kind === "source") return 26;
  }
  if (area === "backend") {
    if (["api-route", "service", "repository", "db-schema", "store", "utility", "server-entry"].includes(file.role) || isPersistenceFile(file)) return 68;
    if (/(?:^|\/)(?:server|api|routes|services|repositories|storage|db|types)(?:\/|$)/.test(pathValue)) return 46;
    if (["page", "component", "ui-component", "style"].includes(file.role)) return -48;
  }
  if (area === "fullstack") {
    if (["api-route", "service", "repository", "db-schema", "store", "types", "utility", "server-entry", "client-api"].includes(file.role) || isPersistenceFile(file)) return 62;
    if (["page", "component", "ui-component", "hook"].includes(file.role)) return 44;
    if (file.kind === "style") return 22;
  }
  if (area === "ui") {
    if (["page", "component", "ui-component", "style"].includes(file.role)) return 64;
    if (["hook", "client-api"].includes(file.role)) return 34;
    if (["types", "utility"].includes(file.role)) return 24;
    if (/(?:^|\/)(?:server|routes|repositories|storage|db)(?:\/|$)/.test(pathValue)) return -52;
  }
  if (area === "build") {
    if (file.kind === "config" || file.role === "config") return 74;
    if (["app-entry", "server-entry"].includes(file.role)) return 38;
  }
  return EDIT_ROLES.has(file.role) ? 14 : 0;
}

function usageFor(file: ProjectInventoryFile, area: TaskArea, reviewOnly: boolean): SelectedTaskFileUsage {
  if (reviewOnly) return "inspect-only";
  if (file.kind === "asset") return "asset-reference";
  if (file.kind === "config") return area === "build" ? "inspect-and-edit" : "config-reference";
  if (area === "docs") {
    if (file.kind === "docs") return "inspect-and-edit";
    if (isDocumentationSupportFile(file)) return "config-reference";
    return "inspect-only";
  }
  if (area === "tests") return isTestLikeFile(file) ? "inspect-and-edit" : "inspect-only";
  if (area === "backend" && ["page", "component", "ui-component", "style", "client-api"].includes(file.role)) return "inspect-only";
  if (area === "ui" && ["api-route", "service", "repository", "db-schema", "server-entry"].includes(file.role)) return "inspect-only";
  if (area === "fullstack" && file.kind === "style") return "inspect-only";
  return EDIT_ROLES.has(file.role) ? "inspect-and-edit" : "inspect-only";
}

function dynamicLimit(inventorySize: number, ambiguous: boolean, requested?: number) {
  if (requested != null) return Math.max(5, Math.min(80, Math.floor(requested)));
  const base = inventorySize <= 80 ? 18 : inventorySize <= 400 ? 28 : 40;
  return Math.min(52, base + (ambiguous ? 6 : 0));
}

function candidateWindowPriority(candidate: RetrievedCandidate) {
  return (
    Number(candidate.explicit) * 1_000_000 +
    candidate.filenameMatchCount * 120_000 +
    Number(candidate.channels.includes("symbol-match")) * 110_000 +
    candidate.identityMatchCount * 32_000 +
    Number(candidate.roleIntentMatch) * 26_000 +
    Number(candidate.channels.includes("core-responsibility")) * 18_000 +
    candidate.graphRelationships.length * 4_000 +
    candidate.score
  );
}

function configReservationPriority(candidate: RetrievedCandidate) {
  const name = candidate.file.name.toLowerCase();
  const depth = normalizePath(candidate.path).split("/").filter(Boolean).length;
  let priority = Math.max(0, 6_000 - depth * 650);
  if (name === "package.json") priority += depth <= 1 ? 16_000 : 10_000;
  if (/^(?:\.env|env)[._-](?:example|sample|template)$/.test(name)) priority += 18_000;
  if (/^(?:vite|next|webpack|rollup|tsconfig|eslint|postcss|tailwind)/.test(name)) priority += 8_000;
  if (/(?:lock|lockb)$/.test(name)) priority -= 5_000;
  return priority + candidateWindowPriority(candidate);
}

function persistenceReservationPriority(candidate: RetrievedCandidate) {
  const pathValue = normalizeText(candidate.path);
  const name = normalizeText(candidate.file.name).replace(/\.[^.]+$/, "");
  let priority = candidateWindowPriority(candidate);
  if (/(?:^|\/)(?:queries?|repositories?)(?:[.\/]|$)/.test(pathValue)) priority += 24_000;
  if (/(?:query|queries|repository)/.test(name)) priority += 18_000;
  if (/(?:^|\/)(?:db|database|storage|persistence)(?:\/|$)/.test(pathValue)) priority += 10_000;
  if (/(?:migrate|migration)/.test(pathValue)) priority -= 8_000;
  return priority;
}

function directGraphReservationPriority(candidate: RetrievedCandidate) {
  const edgePriority = candidate.graphRelationships.reduce((best, relationship) => {
    const priority = [
      "test-target", "proposed-test",
      "service-import", "utility-import", "storage-import", "types-import",
      "client-api-import", "hook-import", "component-import", "style-import",
    ].includes(relationship.kind)
      ? 10_000
      : relationship.kind === "imported-by" || relationship.kind === "route-local"
        ? 6_000
        : 3_000;
    return Math.max(best, priority);
  }, 0);
  return edgePriority + candidate.graphRelationships.length * 1_500 + candidate.score;
}

function selectCandidateWindow(
  candidates: RetrievedCandidate[],
  limit: number,
  area: TaskArea,
) {
  const base = [...candidates].sort((a, b) =>
    candidateWindowPriority(b) - candidateWindowPriority(a) ||
    b.score - a.score ||
    a.path.localeCompare(b.path),
  );
  const selected: RetrievedCandidate[] = [];
  const seen = new Set<string>();
  const add = (candidate: RetrievedCandidate | undefined) => {
    if (!candidate || seen.has(candidate.candidateId) || selected.length >= limit) return;
    seen.add(candidate.candidateId);
    selected.push(candidate);
  };

  for (const candidate of base.filter((item) => item.explicit)) add(candidate);

  if (area === "backend" || area === "fullstack") {
    const persistence = base
      .filter((candidate) => isPersistenceFile(candidate.file))
      .sort((a, b) =>
        persistenceReservationPriority(b) - persistenceReservationPriority(a) ||
        a.path.localeCompare(b.path),
      );
    for (const candidate of persistence.slice(0, 2)) add(candidate);

    const backendEntries = base
      .filter((candidate) => ["api-route", "server-entry"].includes(candidate.file.role))
      .sort((a, b) => candidateWindowPriority(b) - candidateWindowPriority(a) || a.path.localeCompare(b.path));
    for (const candidate of backendEntries.slice(0, 2)) add(candidate);

    if (area === "fullstack") {
      const clientApis = base
        .filter((candidate) => candidate.file.role === "client-api")
        .sort((a, b) => candidateWindowPriority(b) - candidateWindowPriority(a) || a.path.localeCompare(b.path));
      for (const candidate of clientApis.slice(0, 2)) add(candidate);
    }
  }

  if (area === "ui") {
    for (const candidate of base
      .filter((item) => item.file.role === "layout" && item.channels.includes("layer-relation"))
      .slice(0, 2)) add(candidate);
  }

  if (area === "docs" || area === "build") {
    const configs = base
      .filter((candidate) => candidate.file.kind === "config" || candidate.file.role === "config" || isDocumentationSupportFile(candidate.file))
      .sort((a, b) => configReservationPriority(b) - configReservationPriority(a));
    if (area === "docs") {
      const rootEnvironment = configs.find((candidate) =>
        isRootDocumentationSupportFile(candidate.file) &&
        /^(?:\.env|env)[._-](?:example|sample|template)$/.test(normalizeText(candidate.file.name)),
      );
      const rootManifest = configs.find((candidate) => {
        const name = normalizeText(candidate.file.name);
        return isRootDocumentationSupportFile(candidate.file) &&
          /^(?:package\.json|pyproject\.toml|cargo\.toml|go\.mod|pom\.xml|composer\.json|gemfile|requirements(?:-dev)?\.txt)$/.test(name);
      });
      add(rootEnvironment);
      add(rootManifest);
    }
    const reserve = area === "docs" ? 8 : 10;
    for (const candidate of configs.slice(0, reserve)) add(candidate);
  }

  if (area === "tests") {
    for (const candidate of base.filter((item) => isTestLikeFile(item.file)).slice(0, 6)) add(candidate);
  }

  for (const candidate of base.filter((item) => item.channels.includes("symbol-match")).slice(0, 4)) add(candidate);

  const directGraphSupport = base
    .filter((candidate) => candidate.graphRelationships.length > 0)
    .sort((a, b) =>
      directGraphReservationPriority(b) - directGraphReservationPriority(a) ||
      candidateWindowPriority(b) - candidateWindowPriority(a) ||
      a.path.localeCompare(b.path),
    );
  for (const candidate of directGraphSupport.slice(0, Math.max(6, Math.ceil(limit * 0.32)))) {
    add(candidate);
  }

  for (const candidate of base.filter((item) => item.filenameMatchCount > 0 || item.identityMatchCount > 0).slice(0, Math.ceil(limit * 0.55))) {
    add(candidate);
  }
  for (const candidate of base.filter((item) => item.graphRelationships.length > 0).slice(0, Math.ceil(limit * 0.35))) {
    add(candidate);
  }
  for (const candidate of base) add(candidate);

  return selected.sort((a, b) =>
    candidateWindowPriority(b) - candidateWindowPriority(a) ||
    b.score - a.score ||
    a.path.localeCompare(b.path),
  );
}

export function retrieveCandidates(input: CandidateRetrievalInput): CandidateRetrievalResult {
  const safety = detectHardTaskSafetyIssue(input.rawTask);
  const explicit = resolveExplicitFileMentions(input.rawTask, input.inventory);
  const area = input.taskIntent?.taskArea && input.taskIntent.taskArea !== "general"
    ? input.taskIntent.taskArea
    : inferRetrievalArea(input.rawTask, input.requestedTaskType);
  const reviewOnly = isReviewOnlyTask(input.rawTask);
  const coreTask = isCoreTask(input.rawTask);
  const warnings = [...safety.reasons];
  const manualReview = !safety.blocked && explicit.missingPaths.length > 0;
  const candidateLimit = dynamicLimit(
    input.inventory.files.length,
    area === "general" || explicit.missingPaths.length > 0,
    input.options?.maxCandidates,
  );

  if (safety.blocked || manualReview) {
    if (manualReview) warnings.push(`Explicit target not found: ${explicit.missingPaths.join(", ")}. No substitute was selected.`);
    return {
      candidates: [],
      candidateIds: [],
      rawTask: input.rawTask,
      requestedTaskType: input.requestedTaskType,
      inventory: input.inventory,
      implementationArea: area,
      reviewOnly,
      blocked: safety.blocked,
      manualReview,
      warnings,
      explicitExistingPaths: explicit.existingPaths,
      explicitMissingPaths: explicit.missingPaths,
      candidateLimit,
    };
  }

  const graph = input.options?.graph ?? buildProjectSemanticGraph(input.inventory);
  const taskTokens = tokenize([input.rawTask, ...(input.taskIntent?.domainTerms ?? []), ...(input.taskIntent?.recommendedSearchTerms ?? [])].join(" "));
  const explicitSet = new Set(explicit.existingPaths.map(normalizeText));
  const scored = new Map<string, RetrievedCandidate>();

  for (const file of input.inventory.files) {
    if (isSecretLikePath(file.path) || isGeneratedOrRuntime(file)) continue;
    const pathValue = normalizeText(file.path);
    const identity = normalizeText(fileIdentity(file));
    const fileTokens = new Set(tokenize(identity));
    const overlap = taskTokens.filter((token) => fileTokens.has(token) || identity.includes(token));
    const meaningfulOverlap = overlap.filter((token) => !GENERIC_IDENTITY_TOKENS.has(token));
    const filenameMatches = taskTokens.filter((token) => normalizeText(file.name).includes(token));
    const compactTask = normalizeText(input.rawTask).replace(/[^\p{L}\p{N}]+/gu, "");
    const symbolMatches = [...(file.exports ?? []), ...(file.symbols ?? [])]
      .filter((value) => {
        const compact = normalizeText(value).replace(/[^\p{L}\p{N}]+/gu, "");
        return compact.length >= 5 && compactTask.includes(compact);
      });
    const isExplicit = explicitSet.has(pathValue);
    const roleIntentMatch = hasRoleIntentForFile(file, input.rawTask, area);
    const roleIntentGrounded =
      roleIntentMatch &&
      (
        meaningfulOverlap.length > 0 ||
        filenameMatches.length > 0 ||
        (["server-entry", "repository", "db-schema", "store", "utility", "types"].includes(file.role) || isPersistenceFile(file))
      );
    const storageIntegrationHost =
      (area === "backend" || area === "fullstack") &&
      file.role === "server-entry" &&
      hasStorageTaskIntent(input.rawTask);
    const fullstackLayerFallback =
      area === "fullstack" &&
      (["client-api", "repository", "db-schema", "store"].includes(file.role) || isPersistenceFile(file));
    const docsSupport = area === "docs" && isDocumentationSupportFile(file);
    const roleWeight = roleScore(file, area, coreTask);
    let score = roleWeight + overlap.length * 18 + filenameMatches.length * 18 + symbolMatches.length * 42 +
      (roleIntentMatch ? 42 : 0) + (storageIntegrationHost ? 30 : 0) +
      (fullstackLayerFallback ? 16 : 0) + (docsSupport ? 52 : 0);
    const evidence: string[] = [];
    const channels = new Set<CandidateRetrievalChannel>();

    if (isExplicit) {
      score += 240;
      evidence.push("exact-explicit-target");
      channels.add("explicit-target");
    }
    if (filenameMatches.length > 0) {
      score += 34;
      evidence.push("filename-token-match");
      channels.add("exact-filename");
    }
    if (symbolMatches.length > 0) {
      score += 48;
      evidence.push(`symbol-task-match:${symbolMatches.slice(0, 3).join(",")}`);
      channels.add("symbol-match");
    }
    if (overlap.length > 0) {
      evidence.push(`lexical-match:${overlap.slice(0, 5).join(",")}`);
      channels.add("lexical-path");
    }
    if (roleWeight > 0) {
      evidence.push(`technical-role-match:${file.role}`);
      channels.add("technical-role");
    }
    if (roleIntentMatch) {
      evidence.push(`task-role-intent:${file.role}`);
      channels.add("technical-role");
    }
    if (storageIntegrationHost) {
      evidence.push("storage-integration-host");
      channels.add("layer-relation");
    }
    if (fullstackLayerFallback) {
      evidence.push(`fullstack-layer-support:${file.role}`);
      channels.add("layer-relation");
    }
    if (coreTask && roleWeight >= 50) {
      evidence.push("core-responsibility-match");
      channels.add("core-responsibility");
    }
    if (area === "docs" && (file.kind === "config" || pathValue.endsWith("readme.md") || docsSupport)) {
      evidence.push(docsSupport ? "docs-root-support" : "docs-config-support");
      channels.add("docs-config");
    }
    if (area === "build" && normalizeText(file.name) === "package.json") {
      score += 34;
      evidence.push("build-package-support");
      channels.add("technical-role");
    }

    const hasGroundingEvidence =
      isExplicit ||
      overlap.length > 0 ||
      filenameMatches.length > 0 ||
      symbolMatches.length > 0 ||
      roleIntentGrounded ||
      storageIntegrationHost ||
      fullstackLayerFallback ||
      (coreTask && roleWeight >= 50) ||
      (area === "docs" && (file.kind === "config" || pathValue.endsWith("readme.md") || docsSupport)) ||
      (area === "build" && file.kind === "config");
    if (!hasGroundingEvidence || (score < 18 && !isExplicit)) continue;
    const strongIdentityEvidence =
      isExplicit ||
      filenameMatches.length > 0 ||
      symbolMatches.length > 0 ||
      meaningfulOverlap.length >= 2 ||
      (meaningfulOverlap.length >= 1 && PRIMARY_IMPLEMENTATION_ROLES.has(file.role)) ||
      roleIntentGrounded;
    const primaryRole =
      isExplicit ||
      (area === "build" && (file.kind === "config" || file.role === "config")) ||
      isPrimaryRoleForArea(file, area, strongIdentityEvidence);
    const baseUsage = usageFor(file, area, reviewOnly);
    const proposedUsage =
      primaryRole &&
      !reviewOnly &&
      file.kind === "source" &&
      file.role !== "types" &&
      baseUsage === "inspect-only"
        ? "inspect-and-edit"
        : baseUsage;
    scored.set(pathValue, {
      candidateId: candidateIdForPath(file.path),
      path: normalizePath(file.path),
      file,
      score,
      matchScore: Math.max(0, Math.min(100, Math.round(score / 2.4))),
      evidence,
      channels: [...channels],
      proposedUsage,
      proposedTechnicalRole: primaryRole
        ? "primary"
        : file.kind === "config" || file.kind === "docs" || docsSupport
          ? "reference"
          : "support",
      graphRelationships: [],
      identityMatchCount: meaningfulOverlap.length,
      filenameMatchCount: filenameMatches.length,
      roleIntentMatch,
      explicit: isExplicit,
    });
  }

  let frontier = [...scored.values()]
    .filter((candidate) =>
      candidate.explicit ||
      candidate.filenameMatchCount > 0 ||
      candidate.identityMatchCount > 0 ||
      candidate.roleIntentMatch ||
      candidate.channels.includes("core-responsibility"),
    )
    .sort((a, b) => candidateWindowPriority(b) - candidateWindowPriority(a))
    .slice(0, 10);
  const expandedSeeds = new Set<string>();

  for (let depth = 0; depth < 2 && frontier.length > 0; depth += 1) {
    const nextFrontier: RetrievedCandidate[] = [];
    for (const seed of frontier) {
      if (expandedSeeds.has(seed.candidateId)) continue;
      expandedSeeds.add(seed.candidateId);
      for (const related of graph.getSupportFiles([seed.path], { includeImportedBy: true, maxPerTarget: 8 })) {
        if (isSecretLikePath(related.file.path) || isGeneratedOrRuntime(related.file)) continue;
        const key = normalizeText(related.file.path);
        const current = scored.get(key);
        const highValueEdge = [
          "service-import", "utility-import", "storage-import", "types-import",
          "client-api-import", "test-target", "proposed-test",
        ].includes(related.edge.kind);
        const graphBoost = depth === 0
          ? (highValueEdge ? 42 : 30)
          : (highValueEdge ? 26 : 18);
        const relationship = { kind: related.edge.kind, relatedPath: seed.path };
        if (current) {
          current.score += graphBoost;
          current.matchScore = Math.max(current.matchScore, Math.min(100, Math.round(current.score / 2.4)));
          current.evidence.push(`${related.edge.kind}:${seed.path}`);
          current.channels = Array.from(new Set([
            ...current.channels,
            related.edge.kind.includes("test")
              ? "test-relation"
              : related.edge.kind.includes("import")
                ? "import-relation"
                : "semantic-graph",
          ]));
          current.graphRelationships.push(relationship);
          if (depth === 0) nextFrontier.push(current);
        } else {
          const usage = usageFor(related.file, area, reviewOnly);
          const added: RetrievedCandidate = {
            candidateId: candidateIdForPath(related.file.path),
            path: normalizePath(related.file.path),
            file: related.file,
            score: graphBoost,
            matchScore: Math.round(graphBoost / 2.4),
            evidence: [`${related.edge.kind}:${seed.path}`],
            channels: [related.edge.kind.includes("test") ? "test-relation" : related.edge.kind.includes("import") ? "import-relation" : "semantic-graph"],
            proposedUsage: usage === "inspect-and-edit" ? "inspect-only" : usage,
            proposedTechnicalRole: "support",
            graphRelationships: [relationship],
            identityMatchCount: 0,
            filenameMatchCount: 0,
            roleIntentMatch: false,
            explicit: false,
          };
          scored.set(key, added);
          if (depth === 0) nextFrontier.push(added);
        }
      }
    }
    frontier = nextFrontier
      .sort((a, b) => candidateWindowPriority(b) - candidateWindowPriority(a))
      .slice(0, 16);
  }

  if (area === "ui" && hasNavigationTaskIntent(input.rawTask)) {
    const navigationSeeds = [...scored.values()]
      .filter((candidate) => ["component", "ui-component", "page", "layout"].includes(candidate.file.role))
      .filter((candidate) => candidate.explicit || candidate.filenameMatchCount > 0 || candidate.identityMatchCount > 0 || candidate.roleIntentMatch)
      .sort((a, b) => candidateWindowPriority(b) - candidateWindowPriority(a))
      .slice(0, 4);
    for (const layoutFile of input.inventory.files) {
      if (layoutFile.role !== "layout" && !/^layout\.(?:tsx|jsx|ts|js)$/i.test(layoutFile.name)) continue;
      if (isSecretLikePath(layoutFile.path) || isGeneratedOrRuntime(layoutFile)) continue;
      const relatedSeed = navigationSeeds.find((seed) =>
        workspaceRootForPath(seed.path) === workspaceRootForPath(layoutFile.path) &&
        (layoutFile.imports ?? []).some((specifier) => importMentionsFile(specifier, seed.file)),
      );
      if (!relatedSeed) continue;
      const key = normalizeText(layoutFile.path);
      const current = scored.get(key);
      const relationship = { kind: "imported-by" as const, relatedPath: relatedSeed.path };
      if (current) {
        current.score += 54;
        current.matchScore = Math.max(current.matchScore, Math.min(100, Math.round(current.score / 2.4)));
        current.evidence.push(`navigation-layout:${relatedSeed.path}`);
        current.channels = Array.from(new Set([...current.channels, "layer-relation"]));
        current.graphRelationships.push(relationship);
      } else {
        scored.set(key, {
          candidateId: candidateIdForPath(layoutFile.path),
          path: normalizePath(layoutFile.path),
          file: layoutFile,
          score: 72,
          matchScore: 30,
          evidence: [`navigation-layout:${relatedSeed.path}`],
          channels: ["layer-relation"],
          proposedUsage: "inspect-only",
          proposedTechnicalRole: "support",
          graphRelationships: [relationship],
          identityMatchCount: 0,
          filenameMatchCount: 0,
          roleIntentMatch: false,
          explicit: false,
        });
      }
    }
  }

  const candidates = selectCandidateWindow([...scored.values()], candidateLimit, area);

  const weakAmbiguousResult = area === "general" && explicit.existingPaths.length === 0 && (candidates[0]?.score ?? 0) < 75;
  if (candidates.length === 0) warnings.push("No grounded candidates were retrieved; manual review is required.");
  if (weakAmbiguousResult) warnings.push("Candidate evidence is too weak to select an implementation target without manual review.");
  return {
    candidates,
    candidateIds: candidates.map((candidate) => candidate.candidateId),
    rawTask: input.rawTask,
    requestedTaskType: input.requestedTaskType,
    inventory: input.inventory,
    graph,
    implementationArea: area,
    reviewOnly,
    blocked: false,
    manualReview: candidates.length === 0 || weakAmbiguousResult,
    warnings,
    explicitExistingPaths: explicit.existingPaths,
    explicitMissingPaths: explicit.missingPaths,
    candidateLimit,
  };
}
