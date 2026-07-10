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
  "для", "или", "это", "как", "чтобы", "надо", "нужно", "добавь", "измени",
  "обнови", "улучши", "сделай", "файл", "файлы", "код", "проект",
]);

const EDIT_ROLES = new Set<ProjectInventoryFileRole>([
  "page", "component", "ui-component", "style", "api-route", "service", "repository",
  "db-schema", "store", "hook", "client-api", "test", "docs", "config",
  "app-entry", "server-entry",
]);

const PRIMARY_IMPLEMENTATION_ROLES = new Set<ProjectInventoryFileRole>([
  "page", "api-route", "service", "repository", "db-schema", "store",
  "client-api", "test", "docs", "app-entry", "server-entry",
]);

function normalizePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

function normalizeText(value: string) {
  return normalizePath(value).toLowerCase();
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
  return expanded;
}

function tokenize(value: string) {
  const tokens = normalizeText(value)
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
  const backendProtected = matches(text, [/(?:do not touch|without changing|don't change)[^.!?]{0,50}(?:backend|server|api)/i, /(?:backend|бэкенд|бекенд|сервер|api)[^.!?]{0,40}(?:не трогай|не менять|без изменений)/iu]);
  const frontendProtected = matches(text, [/(?:do not touch|without changing|don't change)[^.!?]{0,50}(?:frontend|ui|client)/i, /(?:frontend|фронтенд|интерфейс|ui|client)[^.!?]{0,40}(?:не трогай|не менять|без изменений)/iu]);
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

  if (area === "backend" || area === "fullstack") {
    if (routeIntent && ["api-route", "server-entry"].includes(file.role)) return true;
    if (storageIntent && ["repository", "db-schema", "store"].includes(file.role)) return true;
    if (serviceIntent && file.role === "service") return true;
  }
  if (area === "fullstack" && clientIntent && file.role === "client-api") return true;
  if (area === "tests" && hasDirectTestIntent(text) && isTestLikeFile(file)) return true;
  return false;
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
]);

function isPrimaryRoleForArea(file: ProjectInventoryFile, area: TaskArea, hasIdentityEvidence: boolean) {
  if (area === "docs") return file.kind === "docs" || file.role === "docs";
  if (!hasIdentityEvidence) return false;
  if (area === "ui") {
    return ["page", "component", "ui-component", "style"].includes(file.role);
  }
  if (area === "backend") {
    return ["api-route", "service", "repository", "db-schema", "store", "server-entry"].includes(file.role);
  }
  if (area === "fullstack") {
    return [
      "page", "component", "ui-component", "hook", "client-api",
      "api-route", "service", "repository", "db-schema", "store", "server-entry",
    ].includes(file.role);
  }
  if (area === "tests") return isTestLikeFile(file);
  if (area === "build") return file.kind === "config" || ["config", "app-entry", "server-entry"].includes(file.role);
  if (area === "bugfix" || area === "refactor" || area === "general") {
    return EDIT_ROLES.has(file.role) && file.kind !== "config";
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
    if (["api-route", "service", "repository", "db-schema", "store", "server-entry"].includes(file.role)) return 68;
    if (/(?:^|\/)(?:server|api|routes|services|repositories|storage|db|types)(?:\/|$)/.test(pathValue)) return 46;
    if (["page", "component", "ui-component", "style"].includes(file.role)) return -48;
  }
  if (area === "fullstack") {
    if (["api-route", "service", "repository", "db-schema", "store", "server-entry", "client-api"].includes(file.role)) return 62;
    if (["page", "component", "ui-component", "hook"].includes(file.role)) return 44;
    if (file.kind === "style") return 22;
  }
  if (area === "ui") {
    if (["page", "component", "ui-component", "style"].includes(file.role)) return 64;
    if (["hook", "client-api"].includes(file.role)) return 34;
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
    const isExplicit = explicitSet.has(pathValue);
    const roleIntentMatch = hasRoleIntentForFile(file, input.rawTask, area);
    const roleWeight = roleScore(file, area, coreTask);
    let score = roleWeight + overlap.length * 18 + filenameMatches.length * 18 + (roleIntentMatch ? 42 : 0);
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
    if (coreTask && roleWeight >= 50) {
      evidence.push("core-responsibility-match");
      channels.add("core-responsibility");
    }
    if (area === "docs" && (file.kind === "config" || pathValue.endsWith("readme.md"))) {
      evidence.push("docs-config-support");
      channels.add("docs-config");
    }
    if (area === "build" && normalizeText(file.name) === "package.json") {
      score += 34;
      evidence.push("build-package-support");
      channels.add("technical-role");
    }

    if (score < 18 && !isExplicit) continue;
    const proposedUsage = usageFor(file, area, reviewOnly);
    const strongIdentityEvidence =
      isExplicit ||
      filenameMatches.length > 0 ||
      meaningfulOverlap.length >= 2 ||
      (meaningfulOverlap.length >= 1 && PRIMARY_IMPLEMENTATION_ROLES.has(file.role)) ||
      roleIntentMatch;
    const primaryRole = isExplicit || isPrimaryRoleForArea(file, area, strongIdentityEvidence);
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
        : file.kind === "config" || file.kind === "docs"
          ? "reference"
          : "support",
      graphRelationships: [],
      identityMatchCount: meaningfulOverlap.length,
      filenameMatchCount: filenameMatches.length,
      roleIntentMatch,
      explicit: isExplicit,
    });
  }

  const seeds = [...scored.values()]
    .filter((candidate) => candidate.explicit || candidate.channels.some((channel) => ["exact-filename", "lexical-path", "core-responsibility"].includes(channel)))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
  for (const seed of seeds) {
    for (const related of graph.getSupportFiles([seed.path], { includeImportedBy: true, maxPerTarget: 5 })) {
      if (isSecretLikePath(related.file.path) || isGeneratedOrRuntime(related.file)) continue;
      const key = normalizeText(related.file.path);
      const current = scored.get(key);
      const graphBoost = ["service-import", "storage-import", "types-import", "test-target", "proposed-test"].includes(related.edge.kind) ? 38 : 26;
      const relationship = { kind: related.edge.kind, relatedPath: seed.path };
      if (current) {
        current.score += graphBoost;
        current.matchScore = Math.max(current.matchScore, Math.min(100, Math.round(current.score / 2.4)));
        current.evidence.push(`${related.edge.kind}:${seed.path}`);
        current.channels = Array.from(new Set([...current.channels, related.edge.kind.includes("test") ? "test-relation" : related.edge.kind.includes("import") ? "import-relation" : "semantic-graph"]));
        current.graphRelationships.push(relationship);
      } else {
        const usage = usageFor(related.file, area, reviewOnly);
        scored.set(key, {
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
        });
      }
    }
  }

  const candidates = [...scored.values()]
    .sort((a, b) => Number(b.explicit) - Number(a.explicit) || b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, candidateLimit);

  const weakAmbiguousResult = area === "general" && explicit.existingPaths.length === 0 && (candidates[0]?.score ?? 0) < 75;
  if (candidates.length === 0) warnings.push("No grounded candidates were retrieved; manual review is required.");
  if (weakAmbiguousResult) warnings.push("Candidate evidence is too weak to select an implementation target without manual review.");
  return {
    candidates,
    candidateIds: candidates.map((candidate) => candidate.candidateId),
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
