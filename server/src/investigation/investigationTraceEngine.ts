import type { TaskIntentAnalysis } from "../ollama/taskIntentAnalyzer.js";
import type { SelectedTaskFile } from "../ollama/taskFileSelector.js";
import type { ProjectInventory, ProjectInventoryFile } from "../scanner/projectInventoryScanner.js";
import type {
  FileSelectionEvidence,
  SelectionOwnershipEvidence,
  SemanticCodeRole,
} from "../selection/repositorySemanticIndex.js";
import type { TaskExecutionContract } from "../taskPacks/taskExecutionContract.js";
import {
  buildInvestigationRelationshipIndex,
  canonicalInvestigationComponent,
  canonicalInvestigationSymbol,
  normalizeInvestigationPath,
  type InvestigationEdgeType,
  type InvestigationFileFacts,
} from "./typescriptRelationshipAdapter.js";

export type InvestigationSeedSource =
  | "user-confirmed"
  | "selected-file"
  | "model-proposal"
  | "ranked-candidate"
  | "existing-implementation"
  | "required-layer"
  | "graph-seed";

export type InvestigationSemanticRole =
  | "candidate"
  | "reference"
  | "consumer-display"
  | "contract"
  | "state-owner"
  | "route-owner"
  | "producer"
  | "confirmed-edit-owner";

export type InvestigationOwnershipStrength =
  | "none"
  | "weak"
  | "reference"
  | "probable"
  | "confirmed";

export interface InvestigationTraceEdge {
  from: string;
  to: string;
  type: InvestigationEdgeType;
  symbol?: string;
  originPath?: string;
  originSymbol?: string;
  originKind?: InvestigationOriginKind;
  evidence: "semantic_fact" | "import_graph" | "ast";
  note: string;
}

export interface InvestigationTraceNode {
  path: string;
  seedSource?: InvestigationSeedSource;
  originPath?: string;
  originSymbol?: string;
  originKind?: InvestigationOriginKind;
  incomingEdgeType?: InvestigationEdgeType;
  evidenceChain?: string[];
  hypothesis: string;
  inspectedSymbols: string[];
  semanticRole: InvestigationSemanticRole;
  ownershipStrength: InvestigationOwnershipStrength;
  rejectionReason?: string;
  omissionReason?: string;
  hop: number;
}

export interface InvestigationTraceOutcome {
  confirmedOwners: string[];
  probableOwners: string[];
  references: string[];
  unresolved: string[];
  evidenceByPath: Record<string, FileSelectionEvidence>;
}

export interface InvestigationTrace {
  schemaVersion: 1;
  triggered: boolean;
  triggerReasons: string[];
  seedPaths: string[];
  nodes: InvestigationTraceNode[];
  edges: InvestigationTraceEdge[];
  outcome: InvestigationTraceOutcome;
  durationMs: number;
  hopCount: number;
  inspectedFileCount: number;
  cacheReused: boolean;
  limits: {
    maxHops: number;
    maxFiles: number;
    maxSymbols: number;
    timeBudgetMs: number;
  };
}

interface TraceSeed {
  path: string;
  source: InvestigationSeedSource;
  hypothesis: string;
  originPath?: string;
  originSymbol?: string;
  originKind: InvestigationOriginKind;
  incomingEdgeType?: InvestigationEdgeType;
  evidenceChain: string[];
}

export type InvestigationOriginKind =
  | "task_symbol"
  | "user_target"
  | "seed_code_fact"
  | "discovered_symbol"
  | "import_edge"
  | "prop_edge"
  | "translation_edge"
  | "route_edge";

export interface RunInvestigationTraceInput {
  rawTask: string;
  inventory: ProjectInventory;
  taskIntent?: TaskIntentAnalysis;
  contract?: TaskExecutionContract | null;
  selectedFiles: SelectedTaskFile[];
  existingImplementationCandidates?: string[];
  omittedSeeds?: Array<{ path: string; reason: string }>;
  maxHops?: number;
  maxFiles?: number;
  maxSymbols?: number;
  timeBudgetMs?: number;
}

const FILLER_PATH_PATTERN =
  /(?:\.md$|\.css$|\.scss$|\.sass$|package\.json$|taskfileselector\.(?:smoke|replay)\.ts$|\.smoke\.ts$|\.replay\.ts$|\/reports?\/|\/docs?\/|\/__tests__\/|\.test\.|\.spec\.)/i;

const COMMON_SYMBOLS = new Set([
  "model",
  "status",
  "task",
  "data",
  "settings",
  "diagnostics",
  "value",
  "result",
  "get",
  "set",
  "state",
  "props",
  "error",
  "loading",
  "id",
  "name",
  "type",
  "item",
  "items",
  "response",
  "request",
  "config",
  "context",
  "cache",
  "session",
  "metadata",
]);

// These words are useful for semantic ranking, but they are too broad to act as
// ownership evidence on their own. A file may still be reached through a real
// import/prop/route/state edge that contains one of these terms; the term simply
// cannot bootstrap a confirmed owner from the task text alone.
const TASK_CONCEPT_ONLY_SYMBOLS = new Set([
  "api",
  "auth",
  "authorization",
  "authentication",
  "backend",
  "callback",
  "client",
  "clientapi",
  "diagnostic",
  "diagnostics",
  "frontend",
  "github",
  "integration",
  "login",
  "model",
  "oauth",
  "performance",
  "route",
  "server",
  "session",
  "sidebar",
  "snapshot",
  "state",
  "status",
  "storage",
  "timing",
  "understanding",
  "warmup",
]);

function normalizePath(value: string) {
  return normalizeInvestigationPath(value);
}

function unique<T>(values: T[], getKey: (value: T) => string, limit = values.length) {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const value of values) {
    const key = getKey(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= limit) break;
  }
  return result;
}

function normalizeTaskTokens(rawTask: string, taskIntent?: TaskIntentAnalysis) {
  const values = [
    rawTask,
    ...(taskIntent?.domainTerms ?? []),
    ...(taskIntent?.mentionedEntities ?? []),
    ...(taskIntent?.recommendedSearchTerms ?? []),
    ...(taskIntent?.taskUnderstanding.targetHints ?? []),
    ...(taskIntent?.taskUnderstanding.requestedChanges ?? []),
    ...((taskIntent?.structuredIntent.primaryTargets ?? []).flatMap((target) => [
      target.value,
      target.name ?? "",
      target.path ?? "",
      target.routePath ?? "",
    ])),
  ];
  const symbols = new Set<string>();
  for (const value of values) {
    for (const match of String(value).matchAll(/\b[A-Za-z_$][A-Za-z0-9_$]{2,}\b/g)) {
      symbols.add(canonicalInvestigationSymbol(match[0]));
    }
    const compact = canonicalInvestigationSymbol(String(value));
    if (compact.length >= 4 && compact.length <= 48) symbols.add(compact);
  }
  return [...symbols].filter((symbol) => symbol.length >= 4).slice(0, 32);
}

function negativeClauses(rawTask: string, taskIntent?: TaskIntentAnalysis) {
  const clauses = [
    ...[...rawTask.matchAll(/\b(?:do not|don't|dont|without|separate from|not the existing)\b[^.!?\n]{1,180}/giu)].map((m) => m[0]),
    ...[...rawTask.matchAll(/(?<!\p{L})(?:не|без|отдельн\p{L}*)(?!\p{L})[^.!?\n]{1,180}/giu)].map((m) => m[0]),
    ...(taskIntent?.structuredIntent.protectedScopes ?? []),
    ...(taskIntent?.taskUnderstanding.constraints ?? []),
  ];
  return unique(clauses.map((value) => value.trim()).filter(Boolean), (value) => value.toLowerCase(), 12);
}

function semanticTokenAliases(token: string) {
  const lower = token.toLowerCase();
  const aliases = [lower];
  if (/^репозитор/u.test(lower)) aliases.push("repository");
  if (/^подключ/u.test(lower)) aliases.push("connect", "connection", "integration");
  if (/^интеграц/u.test(lower)) aliases.push("integration");
  if (/^авторизац|^аутентификац|^вход$/u.test(lower)) aliases.push("auth", "login", "session");
  if (/^статус/u.test(lower)) aliases.push("status");
  if (/^к[еэ]ш/u.test(lower)) aliases.push("cache", "cached");
  if (/^диагност/u.test(lower)) aliases.push("diagnostics");
  return aliases;
}

function splitIdentityWords(value: string) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9_\p{L}]+/u)
    .flatMap((token) => semanticTokenAliases(token))
    .map((token) => token.toLowerCase())
    .filter((token) => token.length >= 4);
}

function isCommonSymbol(symbol: string) {
  const normalized = canonicalInvestigationSymbol(symbol);
  return COMMON_SYMBOLS.has(normalized) || /^(?:set)?(?:status|data|value|result|model|task|settings)$/i.test(normalized);
}

function isOwnershipTaskSymbol(symbol: string) {
  const normalized = canonicalInvestigationSymbol(symbol);
  return isSpecificSymbol(normalized) && !TASK_CONCEPT_ONLY_SYMBOLS.has(normalized);
}

function isSpecificSymbol(symbol: string) {
  const normalized = canonicalInvestigationSymbol(symbol);
  if (normalized.length < 7) return false;
  if (isCommonSymbol(normalized)) return false;
  if (/^(?:get|set|use|is|has|can)[a-z]{0,6}$/i.test(normalized)) return false;
  return true;
}

function isTaskLinkedSymbol(symbol: string, taskSymbols: string[]) {
  const normalized = canonicalInvestigationSymbol(symbol);
  if (!isOwnershipTaskSymbol(normalized)) return false;
  return taskSymbols.some((taskSymbol) => {
    if (!isOwnershipTaskSymbol(taskSymbol)) return false;
    return normalized === taskSymbol || normalized.includes(taskSymbol) || taskSymbol.includes(normalized);
  });
}

function seedCodeSymbols(facts: InvestigationFileFacts) {
  return unique([
    ...facts.declarations,
    ...facts.assignments,
    ...facts.objectProperties,
    ...facts.stateSymbols,
    ...facts.translationKeys,
  ].filter(isSpecificSymbol), (symbol) => symbol, 24);
}

function seedAllowsOwnership(seed: TraceSeed, symbol: string, taskSymbols: string[]) {
  if (seed.source === "user-confirmed" || seed.originKind === "user_target") return true;
  if (seed.originKind === "task_symbol") return isTaskLinkedSymbol(symbol, taskSymbols);
  if (seed.originKind === "seed_code_fact") return isTaskLinkedSymbol(symbol, taskSymbols);
  const originSymbol = seed.originSymbol;
  if (!originSymbol) return false;
  return ["prop_edge", "translation_edge", "route_edge", "import_edge"].includes(seed.originKind) &&
    isSpecificSymbol(originSymbol);
}

function edgeAllowsConfirmedOwnership(edgeType: InvestigationEdgeType | undefined) {
  return Boolean(edgeType && [
    "passes_prop",
    "receives_prop",
    "state_setter",
    "translation_key_use",
    "translation_entry",
    "route_registration",
    "router_mount",
    "api_request",
    "calls_function",
    "type_field",
  ].includes(edgeType));
}

function identityTokens(file: ProjectInventoryFile) {
  return new Set(
    [
      file.path,
      file.name,
      file.role,
      file.kind,
      file.contentPreview ?? "",
      ...(file.exports ?? []),
      ...(file.symbols ?? []),
      ...(file.textHints ?? []),
    ]
      .flatMap(splitIdentityWords),
  );
}

function negativeConflict(file: ProjectInventoryFile, clauses: string[]) {
  const identity = identityTokens(file);
  return clauses.find((clause) => {
    const tokens = splitIdentityWords(clause);
    if (tokens.length === 0) return false;
    const overlap = tokens.filter((token) => identity.has(token));
    return overlap.length >= Math.min(2, tokens.length) || overlap.some((token) => token.length >= 8);
  });
}

function conceptsOverlap(taskConcepts: string[], candidateConcepts: string[]) {
  const task = new Set(taskConcepts);
  const candidate = new Set(candidateConcepts);
  if (taskConcepts.some((token) => candidate.has(token))) return true;
  return (task.has("status") || task.has("cache") || task.has("cached")) && candidate.has("diagnostics");
}

function isFiller(file: ProjectInventoryFile, rawTask: string) {
  const taskText = rawTask.toLowerCase();
  if (/\b(?:test|tests|docs|readme|style|css|config|package)\b|(?:тест|документ|ридми|стил|конфиг)/iu.test(taskText)) {
    return false;
  }
  return FILLER_PATH_PATTERN.test(file.path);
}

function pathCoversLayer(pathValue: string, layer: string) {
  const pathText = normalizePath(pathValue);
  if (layer === "ui") return /(?:\/pages?\/|\/components?\/|\/renderer\/)/u.test(pathText);
  if (layer === "client-api") return /(?:\/api\/|api\/client|client\.ts$)/u.test(pathText) && /(?:renderer|frontend|client|apps\/desktop)/u.test(pathText);
  if (layer === "backend") return /(?:^|\/)(?:server|backend)(?:\/|$)/u.test(pathText);
  if (layer === "state") return /(?:\/hooks?\/|\/stores?\/|\/state\/|controller|reducer|cache|session)/u.test(pathText);
  if (layer === "storage") return /(?:\/storage\/|\/db\/|\/database\/|\/repositories?\/|schema|migration)/u.test(pathText);
  if (layer === "tests") return /(?:test|spec|smoke|replay|fixture)/u.test(pathText);
  if (layer === "config") return /(?:package\.json|tsconfig|vite|config)/u.test(pathText);
  if (layer === "docs") return /(?:\.md$|\/docs\/|readme)/u.test(pathText);
  return false;
}

function roleFromFacts(
  file: InvestigationFileFacts,
  taskSymbols: string[],
  seed?: TraceSeed,
  ownershipTaskSymbols: string[] = taskSymbols,
  allowTranslationOwnership = false,
) {
  const translationEntrySymbols = new Set(
    file.translationEntries.flatMap((entry) => [
      canonicalInvestigationSymbol(entry.key),
      canonicalInvestigationSymbol(entry.value),
    ]),
  );
  const matchingSymbols = taskSymbols.filter((symbol) =>
    file.declarations.has(symbol) ||
    file.assignments.has(symbol) ||
    file.objectProperties.has(symbol) ||
    file.stateSymbols.has(symbol) ||
    file.references.has(symbol) ||
    file.translationKeys.has(symbol) ||
    translationEntrySymbols.has(symbol)
  );
  const path = file.normalizedPath;
  let semanticRole: InvestigationSemanticRole = "candidate";
  let ownershipStrength: InvestigationOwnershipStrength = "weak";
  let ownershipEvidence: SelectionOwnershipEvidence = "content_supported";
  const roles = new Set<SemanticCodeRole>();
  const isDisplayFile =
    file.jsxComponents.size > 0 ||
    file.receivedProps.size > 0 ||
    file.file.role === "component" ||
    file.file.role === "page" ||
    (/\.(?:tsx|jsx)$/i.test(path) && /(?:^|\/)(?:app|pages?|components?)\//i.test(path));
  const specificMatches = matchingSymbols.filter(isSpecificSymbol);
  const ownershipLinkedSymbols = seed
    ? specificMatches.filter((symbol) =>
        seedAllowsOwnership(seed, symbol, ownershipTaskSymbols)
      )
    : specificMatches;
  const structuredOwnershipEdge = edgeAllowsConfirmedOwnership(seed?.incomingEdgeType);
  const hasSpecificDeclaration = specificMatches.some((symbol) =>
    (file.declarations.has(symbol) || file.assignments.has(symbol)) &&
    (ownershipLinkedSymbols.includes(symbol) || structuredOwnershipEdge)
  );
  const hasOwnershipOrigin = ownershipLinkedSymbols.length > 0 || structuredOwnershipEdge;
  const hasSpecificStateMatch = specificMatches.some((symbol) =>
    file.stateSymbols.has(symbol) ||
    file.statePairs.some((pair) =>
      (pair.state === symbol || pair.setter === symbol) &&
      (
        isTaskLinkedSymbol(pair.state, ownershipTaskSymbols) ||
        isTaskLinkedSymbol(pair.setter, ownershipTaskSymbols) ||
        (seed?.originSymbol
          ? pair.state === canonicalInvestigationSymbol(seed.originSymbol) ||
            pair.setter === canonicalInvestigationSymbol(seed.originSymbol)
          : false)
      ) &&
      (file.callSymbols.has(pair.setter) || edgeAllowsConfirmedOwnership(seed?.incomingEdgeType))
    )
  );
  const hasStatePathHint = /(?:controller|store|state|hook|cache|session)/i.test(path);
  const hasSpecificTranslationMatch = allowTranslationOwnership &&
    specificMatches.some((symbol) => translationEntrySymbols.has(symbol));
  const hasSpecificTranslationKeyUse = specificMatches.some((symbol) => file.translationKeys.has(symbol));

  if (isDisplayFile && (hasSpecificTranslationKeyUse || file.translationKeys.size > 0) && !hasSpecificTranslationMatch) {
    semanticRole = "consumer-display";
    ownershipStrength = "reference";
    ownershipEvidence = "reference_graph";
    roles.add("display");
  } else if (
    hasSpecificStateMatch &&
    hasOwnershipOrigin &&
    (!isDisplayFile || hasStatePathHint || seed?.incomingEdgeType === "state_setter")
  ) {
    semanticRole = "state-owner";
    ownershipStrength = "confirmed";
    ownershipEvidence = "state_graph";
    roles.add("state-owner");
  } else if (hasStatePathHint && file.statePairs.length > 0 && specificMatches.length > 0) {
    semanticRole = "state-owner";
    ownershipStrength = "probable";
    ownershipEvidence = "state_graph";
    roles.add("state-owner");
  } else if (file.routePaths.size > 0 || file.file.role === "api-route") {
    semanticRole = "route-owner";
    ownershipStrength = (ownershipLinkedSymbols.length > 0 || structuredOwnershipEdge) ? "confirmed" : "probable";
    ownershipEvidence = "route_graph";
    roles.add("route");
  } else if (isDisplayFile) {
    semanticRole = "consumer-display";
    ownershipStrength = "reference";
    ownershipEvidence = "reference_graph";
    roles.add("display");
  } else if (hasSpecificDeclaration && hasOwnershipOrigin) {
    semanticRole = "producer";
    ownershipStrength = "confirmed";
    ownershipEvidence = "symbol_exact";
    roles.add("producer");
  } else if (file.file.role === "types" || /(?:types?|schema|contract)/i.test(path)) {
    semanticRole = "contract";
    ownershipStrength = specificMatches.some((symbol) =>
      (file.typeFields.has(symbol) || file.objectProperties.has(symbol)) &&
      (ownershipLinkedSymbols.includes(symbol) || structuredOwnershipEdge)
    )
      ? "confirmed"
      : "probable";
    ownershipEvidence = "symbol_exact";
    roles.add("contract");
  } else if (
    hasSpecificTranslationMatch &&
    specificMatches.some((symbol) =>
      translationEntrySymbols.has(symbol) &&
      (ownershipLinkedSymbols.includes(symbol) || structuredOwnershipEdge)
    )
  ) {
    semanticRole = "producer";
    ownershipStrength = "confirmed";
    ownershipEvidence = "symbol_exact";
    roles.add("producer");
  } else if (specificMatches.some((symbol) => file.objectProperties.has(symbol))) {
    semanticRole = "reference";
    ownershipStrength = "reference";
    ownershipEvidence = "content_supported";
    roles.add("reference");
  } else if (matchingSymbols.length > 0) {
    semanticRole = "reference";
    ownershipStrength = "reference";
    ownershipEvidence = "content_supported";
    roles.add("reference");
  } else {
    roles.add("reference");
  }

  return { semanticRole, ownershipStrength, ownershipEvidence, roles: [...roles], matchingSymbols };
}

function followSymbolScore(symbol: string, localSymbols: string[]) {
  let score = 0;
  if (!isSpecificSymbol(symbol)) return 0;
  for (const taskSymbol of localSymbols) {
    if (!isSpecificSymbol(taskSymbol)) continue;
    if (symbol === taskSymbol) score += 8;
    else if (symbol.includes(taskSymbol) || taskSymbol.includes(symbol)) score += 4;
  }
  if (isActionOrDomainSymbol(symbol)) {
    score += 2;
  }
  return score;
}

function isActionOrDomainSymbol(symbol: string) {
  const normalized = canonicalInvestigationSymbol(symbol);
  return /^(?:save|load|fetch|get|post|set|update|create|delete)[a-z0-9]{3,}$/i.test(normalized) ||
    /(?:metadata|diagnostic|snapshot|cache|status|session|auth|model|performance|reused)/i.test(normalized);
}

function taskLiterals(rawTask: string) {
  const literals = new Set<string>();
  for (const match of rawTask.matchAll(/["'`«„“”](.{3,80}?)["'`»“”]/gu)) {
    const value = canonicalInvestigationSymbol(match[1]);
    if (value.length >= 4 && !isCommonSymbol(value)) literals.add(value);
  }
  for (const match of rawTask.matchAll(/\b(?:to|на|as|как)\s+([A-Za-zА-Яа-яЁё0-9 _.-]{4,60})/giu)) {
    const value = canonicalInvestigationSymbol(match[1]);
    if (value.length >= 4 && value.length <= 40 && !isCommonSymbol(value)) literals.add(value);
  }
  return literals;
}

function taskRequestsTranslationOwnership(rawTask: string, taskIntent?: TaskIntentAnalysis) {
  const text = [
    rawTask,
    taskIntent?.taskUnderstanding.goal ?? "",
    ...(taskIntent?.taskUnderstanding.requestedChanges ?? []),
    ...(taskIntent?.domainTerms ?? []),
    ...(taskIntent?.intentTags ?? []),
  ].join(" ");
  return /\b(?:replace|rename|label|copy|text|translation|translate|locali[sz]e|i18n|locale)\b|(?:замен|переимен|подпис|текст|перевод|локализац)/iu.test(text);
}

function translationKeyMatchesTask(
  key: string,
  owners: InvestigationFileFacts[],
  rawTask: string,
  taskIntent: TaskIntentAnalysis | undefined,
  explicitLiterals: Set<string>,
) {
  if (!taskRequestsTranslationOwnership(rawTask, taskIntent)) return false;

  const canonicalKey = canonicalInvestigationSymbol(key);
  const keyParts = String(key)
    .split(/[._:/-]+/u)
    .map(canonicalInvestigationSymbol)
    .filter((part) => part.length >= 4);
  const taskIdentity = new Set(splitIdentityWords([
    rawTask,
    ...(taskIntent?.domainTerms ?? []),
    ...(taskIntent?.mentionedEntities ?? []),
    ...(taskIntent?.taskUnderstanding.targetHints ?? []),
    ...(taskIntent?.taskUnderstanding.requestedChanges ?? []),
  ].join(" ")));

  if (keyParts.some((part) => taskIdentity.has(part))) return true;
  if (explicitLiterals.has(canonicalKey)) return true;

  return owners.some((owner) =>
    owner.translationEntries.some((entry) =>
      canonicalInvestigationSymbol(entry.key) === canonicalKey &&
      explicitLiterals.has(canonicalInvestigationSymbol(entry.value))
    )
  );
}

function evidenceForNode(node: InvestigationTraceNode, roles: SemanticCodeRole[], symbols: string[]): FileSelectionEvidence {
  const ownership: SelectionOwnershipEvidence =
    node.semanticRole === "state-owner"
      ? "state_graph"
      : node.semanticRole === "route-owner"
        ? "route_graph"
        : node.semanticRole === "producer" || node.semanticRole === "contract" || node.semanticRole === "confirmed-edit-owner"
          ? "symbol_exact"
          : node.semanticRole === "consumer-display"
            ? "reference_graph"
            : "content_supported";
  return {
    targetSource: node.seedSource === "user-confirmed" ? "user_text" : node.seedSource === "model-proposal" ? "model_inference" : "ranking",
    pathValidity: "inventory_exact",
    ownershipEvidence: ownership,
    actionConfidence:
      node.ownershipStrength === "confirmed" &&
      ["producer", "contract", "state-owner", "route-owner", "confirmed-edit-owner"].includes(node.semanticRole)
        ? "inspect_then_edit"
        : "inspect_only",
    semanticRoles: roles.length > 0 ? roles : ["reference"],
    symbols: symbols.slice(0, 12),
    chain: symbols.slice(0, 8).map((symbol) => ({
      symbol,
      role: roles[0] ?? "reference",
      path: node.path,
      evidence: ownership,
      relation: node.semanticRole === "consumer-display" ? "identifier_reference" : "same_file",
    })),
    negativeConstraintConflicts: node.rejectionReason ? [node.rejectionReason] : [],
    reason: node.rejectionReason
      ? `Investigation trace kept this file as reference only: ${node.rejectionReason}`
      : `Investigation trace classified this file as ${node.semanticRole} with ${node.ownershipStrength} ownership evidence.`,
  };
}

function seedPaths(input: RunInvestigationTraceInput, taskSymbols: string[]) {
  const inventoryByPath = new Map(input.inventory.files.map((file) => [normalizePath(file.path), file]));
  const groundingSymbols = normalizeTaskTokens(input.rawTask).slice(0, taskSymbols.length);
  const specificGroundingSymbols = groundingSymbols.filter(isSpecificSymbol);
  const seeds: TraceSeed[] = [];
  const add = (
    path: string,
    source: InvestigationSeedSource,
    hypothesis: string,
    originKind: InvestigationOriginKind =
      source === "user-confirmed"
        ? "user_target"
        : source === "existing-implementation"
          ? "seed_code_fact"
          : "discovered_symbol",
  ) => {
    const file = inventoryByPath.get(normalizePath(path));
    if (!file) return;
    seeds.push({
      path: file.path,
      source,
      hypothesis,
      originPath: file.path,
      originKind,
      evidenceChain: [`${originKind}:${file.path}`],
    });
  };
  const selectedSeedIsGrounded = (selected: SelectedTaskFile) => {
    if (input.contract?.mode === "investigation") return true;
    if (selected.evidenceLevel !== "model_proposed") return true;
    const file = inventoryByPath.get(normalizePath(selected.path));
    if (!file) return false;
    if (negativeConflict(file, negativeClauses(input.rawTask, input.taskIntent))) return true;
    const facts = file.semanticFacts;
    const candidateSymbols = [
      file.path,
      file.name,
      file.contentPreview ?? "",
      ...(file.exports ?? []),
      ...(file.symbols ?? []),
      ...(file.textHints ?? []),
      ...(facts?.declarations ?? []),
      ...(facts?.assignments ?? []),
      ...(facts?.objectProperties ?? []),
      ...(facts?.stateSymbols ?? []),
      ...(facts?.references ?? []),
      ...(facts?.translationKeys ?? []),
    ].map(canonicalInvestigationSymbol);
    return specificGroundingSymbols.some((symbol) =>
      candidateSymbols.some((candidate) => candidate === symbol || candidate.includes(symbol) || symbol.includes(candidate))
    ) || conceptsOverlap(splitIdentityWords(input.rawTask), splitIdentityWords(candidateSymbols.join(" ")));
  };

  for (const selected of input.selectedFiles) {
    if (!selectedSeedIsGrounded(selected)) continue;
    const source: InvestigationSeedSource =
      selected.evidenceLevel === "user_confirmed"
        ? "user-confirmed"
        : selected.evidenceLevel === "model_proposed"
          ? "model-proposal"
          : selected.evidenceLevel === "ranked_candidate"
            ? "ranked-candidate"
            : "selected-file";
    add(selected.path, source, "Initial selected candidate needs ownership tracing.");
  }
  for (const path of input.existingImplementationCandidates ?? []) {
    add(path, "existing-implementation", "Existing implementation candidate should be verified before adding behavior.");
  }
  for (const omitted of input.omittedSeeds ?? []) {
    add(omitted.path, "graph-seed", omitted.reason, "discovered_symbol");
  }

  const broadSeedLimit = input.selectedFiles.length > 0 ? 4 : 12;
  for (const file of input.inventory.files) {
    if (seeds.length >= broadSeedLimit) break;
    if (isFiller(file, input.rawTask)) continue;
    const facts = file.semanticFacts;
    if (!facts) continue;
    const factSymbols = [
      ...(file.exports ?? []),
      ...(file.symbols ?? []),
      ...facts.declarations,
      ...facts.assignments,
      ...facts.objectProperties,
      ...facts.stateSymbols,
      ...facts.references,
    ].map(canonicalInvestigationSymbol);
    if (specificGroundingSymbols.some((symbol) => factSymbols.includes(symbol))) {
      add(file.path, "existing-implementation", "Task symbol appears in repository semantic facts.");
    }
  }

  return unique(seeds, (seed) => normalizePath(seed.path), 12);
}

export function runInvestigationTrace(input: RunInvestigationTraceInput): InvestigationTrace {
  const startedAt = performance.now();
  const limits = {
    maxHops: input.maxHops ?? 3,
    maxFiles: input.maxFiles ?? 16,
    maxSymbols: input.maxSymbols ?? 32,
    timeBudgetMs: input.timeBudgetMs ?? 1_500,
  };
  const triggerReasons = [
    input.contract?.mode === "investigation" ? "Execution Contract is in investigation mode." : "",
    input.contract?.missingConfirmedLayers?.length
      ? `Missing confirmed layers: ${input.contract.missingConfirmedLayers.join(", ")}.`
      : "",
    input.existingImplementationCandidates?.length
      ? "Existing implementation candidates require trace verification."
      : "",
  ].filter(Boolean);
  const shouldTrace = triggerReasons.length > 0;
  if (!shouldTrace) {
    return {
      schemaVersion: 1,
      triggered: false,
      triggerReasons: [],
      seedPaths: [],
      nodes: [],
      edges: [],
      outcome: { confirmedOwners: [], probableOwners: [], references: [], unresolved: [], evidenceByPath: {} },
      durationMs: 0,
      hopCount: 0,
      inspectedFileCount: 0,
      cacheReused: false,
      limits,
    };
  }

  const { index, reused } = buildInvestigationRelationshipIndex(input.inventory);
  const taskSymbols = normalizeTaskTokens(input.rawTask, input.taskIntent).slice(0, limits.maxSymbols);
  const ownershipTaskSymbols = taskSymbols.filter(isOwnershipTaskSymbol);
  const allowTranslationOwnership = taskRequestsTranslationOwnership(input.rawTask, input.taskIntent);
  const explicitTranslationLiterals = taskLiterals(input.rawTask);
  const negatives = negativeClauses(input.rawTask, input.taskIntent);
  const seeds = seedPaths(input, ownershipTaskSymbols);
  const queue = seeds.map((seed) => ({ seed, hop: 0 }));
  const seen = new Set<string>();
  const nodes = new Map<string, InvestigationTraceNode>();
  const edges: InvestigationTraceEdge[] = [];

  const enqueue = (
    path: string,
    source: InvestigationSeedSource,
    hypothesis: string,
    hop: number,
    origin: {
      originPath?: string;
      originSymbol?: string;
      originKind: InvestigationOriginKind;
      incomingEdgeType?: InvestigationEdgeType;
      evidenceChain?: string[];
    },
  ) => {
    if (hop > limits.maxHops) return;
    if (seen.size + queue.length >= limits.maxFiles) return;
    const normalized = normalizePath(path);
    if (!index.byPath.has(normalized)) return;
    if (seen.has(normalized) || queue.some((item) => normalizePath(item.seed.path) === normalized)) return;
    const inventoryFile = index.byPath.get(normalized)?.file;
    if (inventoryFile && source !== "user-confirmed" && isFiller(inventoryFile, input.rawTask)) return;
    const item = {
      seed: {
        path,
        source,
        hypothesis,
        originPath: origin.originPath,
        originSymbol: origin.originSymbol,
        originKind: origin.originKind,
        incomingEdgeType: origin.incomingEdgeType,
        evidenceChain: unique([
          ...(origin.evidenceChain ?? []),
          `${origin.incomingEdgeType ?? origin.originKind}:${origin.originSymbol ?? path}`,
        ], (value) => value, 8),
      },
      hop,
    };
    if (hop > 0 && source === "existing-implementation") queue.unshift(item);
    else queue.push(item);
  };

  while (queue.length > 0 && seen.size < limits.maxFiles) {
    if (performance.now() - startedAt > limits.timeBudgetMs) break;
    const current = queue.shift()!;
    const facts = index.byPath.get(normalizePath(current.seed.path));
    if (!facts || seen.has(facts.normalizedPath)) continue;
    seen.add(facts.normalizedPath);

    const localSymbols = unique(
      [
        ...ownershipTaskSymbols,
        ...(current.seed.originSymbol ? [canonicalInvestigationSymbol(current.seed.originSymbol)] : []),
        ...(current.seed.originKind === "seed_code_fact" || current.seed.source === "user-confirmed" ? seedCodeSymbols(facts) : []),
      ],
      (symbol) => symbol,
      limits.maxSymbols,
    );
    const classified = roleFromFacts(
      facts,
      localSymbols,
      current.seed,
      ownershipTaskSymbols,
      allowTranslationOwnership,
    );
    const conflict = negativeConflict(facts.file, negatives);
    const filler = isFiller(facts.file, input.rawTask);
    const node: InvestigationTraceNode = {
      path: facts.file.path,
      seedSource: current.seed.source,
      originPath: current.seed.originPath,
      originSymbol: current.seed.originSymbol,
      originKind: current.seed.originKind,
      incomingEdgeType: current.seed.incomingEdgeType,
      evidenceChain: current.seed.evidenceChain,
      hypothesis: current.seed.hypothesis,
      inspectedSymbols: classified.matchingSymbols.slice(0, 12),
      semanticRole: conflict || filler ? "reference" : classified.semanticRole,
      ownershipStrength: conflict || filler ? "reference" : classified.ownershipStrength,
      rejectionReason: conflict
        ? `Matches negative constraint: ${conflict}`
        : filler
          ? "Filler/test/docs/style/config context is reference-only for this task."
          : undefined,
      omissionReason: current.seed.source === "graph-seed" && current.seed.hypothesis
        ? current.seed.hypothesis
        : undefined,
      hop: current.hop,
    };
    nodes.set(facts.normalizedPath, node);

    for (const edge of facts.imports.slice(0, 8)) {
      edges.push({
        from: facts.file.path,
        to: edge.to,
        type: "imports",
        originPath: facts.file.path,
        originKind: "import_edge",
        evidence: "import_graph",
        note: `Imports ${edge.kind}.`,
      });
      enqueue(edge.to, "graph-seed", `Followed import edge from ${facts.file.path}.`, current.hop + 1, {
        originPath: facts.file.path,
        originKind: "import_edge",
        incomingEdgeType: "imports",
        evidenceChain: current.seed.evidenceChain,
      });
    }
    for (const edge of facts.importedBy.slice(0, 8)) {
      edges.push({
        from: edge.from,
        to: facts.file.path,
        type: "imported_by",
        originPath: facts.file.path,
        originKind: "import_edge",
        evidence: "import_graph",
        note: `Imported by ${edge.from}.`,
      });
      enqueue(edge.from, "graph-seed", `Found importer/caller of ${facts.file.path}.`, current.hop + 1, {
        originPath: facts.file.path,
        originKind: "import_edge",
        incomingEdgeType: "imported_by",
        evidenceChain: current.seed.evidenceChain,
      });
    }

    const followCandidateSymbols = unique(
      [...facts.callSymbols, ...facts.references, ...facts.objectProperties]
        .filter((symbol) =>
          isSpecificSymbol(symbol) &&
          (isTaskLinkedSymbol(symbol, localSymbols) ||
          localSymbols.includes(symbol) ||
          (current.seed.originSymbol && symbol === current.seed.originSymbol))
        )
        .sort((left, right) => followSymbolScore(right, localSymbols) - followSymbolScore(left, localSymbols)),
      (symbol) => symbol,
      32,
    );
    const followSymbols = unique([
      ...classified.matchingSymbols,
      ...followCandidateSymbols.slice(0, 12),
    ], (symbol) => symbol, 16);
    node.inspectedSymbols = unique([...node.inspectedSymbols, ...followSymbols], (symbol) => symbol, 16);

    for (const symbol of followSymbols.filter(isSpecificSymbol).slice(0, 12)) {
      const declarationOwners = index.declarationsBySymbol.get(symbol) ?? [];
      const referenceOwners = (index.referencesBySymbol.get(symbol) ?? []).filter((file) =>
        file.assignments.has(symbol) ||
        file.stateSymbols.has(symbol) ||
        file.statePairs.some((pair) => pair.state === symbol || pair.setter === symbol)
      );
      for (const owner of unique(declarationOwners, (file) => file.normalizedPath, 4)) {
        if (owner.normalizedPath === facts.normalizedPath) continue;
        edges.push({
          from: facts.file.path,
          to: owner.file.path,
          type: "defines_symbol",
          symbol,
          originPath: facts.file.path,
          originSymbol: symbol,
          originKind: isTaskLinkedSymbol(symbol, ownershipTaskSymbols) ? "task_symbol" : "discovered_symbol",
          evidence: "semantic_fact",
          note: `Symbol ${symbol} has owner evidence in ${owner.file.path}.`,
        });
        enqueue(owner.file.path, "existing-implementation", `Followed exact symbol owner for ${symbol}.`, current.hop + 1, {
          originPath: facts.file.path,
          originSymbol: symbol,
          originKind: isTaskLinkedSymbol(symbol, ownershipTaskSymbols) ? "task_symbol" : "discovered_symbol",
          incomingEdgeType: "defines_symbol",
          evidenceChain: current.seed.evidenceChain,
        });
      }
      for (const owner of unique(referenceOwners, (file) => file.normalizedPath, 4)) {
        if (owner.normalizedPath === facts.normalizedPath) continue;
        const edgeType: InvestigationEdgeType = owner.stateSymbols.has(symbol) ? "state_setter" : "references_symbol";
        edges.push({
          from: facts.file.path,
          to: owner.file.path,
          type: edgeType,
          symbol,
          originPath: facts.file.path,
          originSymbol: symbol,
          originKind: edgeType === "state_setter" ? "prop_edge" : "discovered_symbol",
          evidence: "semantic_fact",
          note: edgeType === "state_setter"
            ? `Specific state symbol ${symbol} has setter/state evidence in ${owner.file.path}.`
            : `Specific symbol ${symbol} is referenced by ${owner.file.path}.`,
        });
        enqueue(owner.file.path, "existing-implementation", `Followed specific ${edgeType} evidence for ${symbol}.`, current.hop + 1, {
          originPath: facts.file.path,
          originSymbol: symbol,
          originKind: edgeType === "state_setter" ? "prop_edge" : "discovered_symbol",
          incomingEdgeType: edgeType,
          evidenceChain: current.seed.evidenceChain,
        });
      }
      for (const owner of unique(index.declarationsBySymbol.get(symbol) ?? [], (file) => file.normalizedPath, 4)) {
        if (owner.normalizedPath === facts.normalizedPath || !facts.callSymbols.has(symbol)) continue;
        edges.push({
          from: facts.file.path,
          to: owner.file.path,
          type: "calls_function",
          symbol,
          originPath: facts.file.path,
          originSymbol: symbol,
          originKind: "discovered_symbol",
          evidence: "ast",
          note: `Call expression references function ${symbol}.`,
        });
      }
    }

    for (const pair of facts.statePairs.slice(0, 8)) {
      if (!isSpecificSymbol(pair.state) && !isSpecificSymbol(pair.setter)) continue;
      edges.push({
        from: facts.file.path,
        to: facts.file.path,
        type: "state_setter",
        symbol: `${pair.state}/${pair.setter}`,
        originPath: facts.file.path,
        originSymbol: pair.state,
        originKind: "seed_code_fact",
        evidence: "ast",
        note: "useState/useReducer-like binding links state variable and setter.",
      });
    }

    const componentName = canonicalInvestigationComponent(facts.file.name.replace(/\.[^.]+$/, ""));
    for (const user of unique(index.jsxUsersByComponent.get(componentName) ?? [], (file) => file.normalizedPath, 4)) {
      if (user.normalizedPath === facts.normalizedPath) continue;
      edges.push({
        from: user.file.path,
        to: facts.file.path,
        type: "renders_component",
        symbol: componentName,
        originPath: facts.file.path,
        originSymbol: componentName,
        originKind: "prop_edge",
        evidence: "ast",
        note: `JSX caller renders component ${componentName}.`,
      });
      enqueue(user.file.path, "graph-seed", `Found JSX caller for ${facts.file.name}.`, current.hop + 1, {
        originPath: facts.file.path,
        originSymbol: componentName,
        originKind: "prop_edge",
        incomingEdgeType: "renders_component",
        evidenceChain: current.seed.evidenceChain,
      });
    }

    for (const prop of facts.receivedProps) {
      edges.push({
        from: facts.file.path,
        to: facts.file.path,
        type: "receives_prop",
        symbol: prop,
        originPath: facts.file.path,
        originSymbol: prop,
        originKind: "prop_edge",
        evidence: "ast",
        note: `Component receives prop ${prop}.`,
      });
      const passers = index.propPassersByComponentProp.get(`${componentName}:${prop}`) ?? [];
      for (const passer of unique(passers, (item) => item.file.normalizedPath, 3)) {
        const user = passer.file;
        if (user.normalizedPath === facts.normalizedPath) continue;
        edges.push({
          from: user.file.path,
          to: facts.file.path,
          type: "passes_prop",
          symbol: prop,
          originPath: facts.file.path,
          originSymbol: passer.value,
          originKind: "prop_edge",
          evidence: "ast",
          note: `JSX caller passes prop ${prop} from ${passer.value}.`,
        });
        enqueue(user.file.path, "graph-seed", `Followed prop ${prop} to possible parent/state owner.`, current.hop + 1, {
          originPath: facts.file.path,
          originSymbol: passer.value,
          originKind: "prop_edge",
          incomingEdgeType: "passes_prop",
          evidenceChain: current.seed.evidenceChain,
        });
      }
    }

    for (const route of facts.routePaths) {
      edges.push({
        from: facts.file.path,
        to: facts.file.path,
        type: "route_registration",
        symbol: route,
        originPath: facts.file.path,
        originSymbol: route,
        originKind: "route_edge",
        evidence: "ast",
        note: `Route registration found for ${route}.`,
      });
    }
    for (const request of facts.apiRequests.slice(0, 8)) {
      edges.push({
        from: facts.file.path,
        to: facts.file.path,
        type: request.method === "use" ? "router_mount" : "api_request",
        symbol: request.route,
        originPath: facts.file.path,
        originSymbol: request.route,
        originKind: "route_edge",
        evidence: "ast",
        note: `${request.method} call references route ${request.route}.`,
      });
    }
    for (const field of facts.typeFields) {
      if (!isSpecificSymbol(field)) continue;
      edges.push({
        from: facts.file.path,
        to: facts.file.path,
        type: "type_field",
        symbol: field,
        originPath: facts.file.path,
        originSymbol: field,
        originKind: "seed_code_fact",
        evidence: "ast",
        note: `Type/interface field ${field} is declared here.`,
      });
    }

    for (const key of facts.translationKeys) {
      const lookupKey = canonicalInvestigationSymbol(key);
      const keyOwners = unique(index.translationOwnersByKey.get(lookupKey) ?? [], (file) => file.normalizedPath, 4);
      if (!translationKeyMatchesTask(
        key,
        keyOwners,
        input.rawTask,
        input.taskIntent,
        explicitTranslationLiterals,
      )) continue;
      for (const owner of keyOwners) {
        if (owner.normalizedPath === facts.normalizedPath) continue;
        edges.push({
          from: facts.file.path,
          to: owner.file.path,
          type: "translation_key_use",
          symbol: key,
          originPath: facts.file.path,
          originSymbol: key,
          originKind: "translation_edge",
          evidence: "semantic_fact",
          note: `Translation key ${key} resolves to resource owner.`,
        });
        enqueue(owner.file.path, "existing-implementation", `Followed translation key ${key} to resource owner.`, current.hop + 1, {
          originPath: facts.file.path,
          originSymbol: key,
          originKind: "translation_edge",
          incomingEdgeType: "translation_key_use",
          evidenceChain: current.seed.evidenceChain,
        });
      }
    }

    for (const [value, owners] of index.translationOwnersByValue) {
      if (
        !allowTranslationOwnership ||
        !value ||
        value.length < 4 ||
        isCommonSymbol(value) ||
        !explicitTranslationLiterals.has(value)
      ) continue;
      for (const owner of unique(owners.map((item) => item.file), (file) => file.normalizedPath, 4)) {
        edges.push({
          from: facts.file.path,
          to: owner.file.path,
          type: "translation_entry",
          originPath: facts.file.path,
          originSymbol: value,
          originKind: "translation_edge",
          evidence: "semantic_fact",
          note: "Visible text in task matches a translation resource entry.",
        });
        enqueue(owner.file.path, "existing-implementation", "Visible text matches translation entry.", current.hop + 1, {
          originPath: facts.file.path,
          originSymbol: value,
          originKind: "translation_edge",
          incomingEdgeType: "translation_entry",
          evidenceChain: current.seed.evidenceChain,
        });
      }
    }
  }

  const nodeList = [...nodes.values()];
  const evidenceByPath: Record<string, FileSelectionEvidence> = {};
  for (const node of nodeList) {
    const facts = index.byPath.get(normalizePath(node.path));
    if (!facts) continue;
    const seed: TraceSeed = {
      path: node.path,
      source: node.seedSource ?? "graph-seed",
      hypothesis: node.hypothesis,
      originPath: node.originPath,
      originSymbol: node.originSymbol,
      originKind: node.originKind ?? "discovered_symbol",
      incomingEdgeType: node.incomingEdgeType,
      evidenceChain: node.evidenceChain ?? [],
    };
    const localSymbols = unique([
      ...ownershipTaskSymbols,
      ...(node.originSymbol ? [canonicalInvestigationSymbol(node.originSymbol)] : []),
      ...(node.originKind === "seed_code_fact" || node.seedSource === "user-confirmed" ? seedCodeSymbols(facts) : []),
    ], (symbol) => symbol, limits.maxSymbols);
    const classified = roleFromFacts(
      facts,
      localSymbols,
      seed,
      ownershipTaskSymbols,
      allowTranslationOwnership,
    );
    evidenceByPath[node.path] = evidenceForNode(node, classified.roles, node.inspectedSymbols);
  }
  const confirmedOwners = nodeList
    .filter((node) => node.ownershipStrength === "confirmed" && !node.rejectionReason)
    .filter((node) => ["producer", "contract", "state-owner", "route-owner", "confirmed-edit-owner"].includes(node.semanticRole))
    .map((node) => node.path);
  const probableOwners = nodeList
    .filter((node) => node.ownershipStrength === "probable" && !node.rejectionReason)
    .map((node) => node.path);
  const references = nodeList
    .filter((node) => node.semanticRole === "reference" || node.semanticRole === "consumer-display")
    .map((node) => node.path);
  const stillMissingLayers = (input.contract?.missingConfirmedLayers ?? []).filter((layer) =>
    !confirmedOwners.some((owner) => pathCoversLayer(owner, layer))
  );
  const unresolved = [
    ...(stillMissingLayers).map((layer) => `Missing confirmed ${layer} owner after bounded trace.`),
    ...(performance.now() - startedAt > limits.timeBudgetMs ? ["Trace stopped at time budget."] : []),
    ...(seen.size >= limits.maxFiles ? ["Trace stopped at file limit."] : []),
  ];

  return {
    schemaVersion: 1,
    triggered: true,
    triggerReasons,
    seedPaths: seeds.map((seed) => seed.path),
    nodes: nodeList,
    edges: edges.slice(0, 64),
    outcome: {
      confirmedOwners: unique(confirmedOwners, (path) => normalizePath(path), 12),
      probableOwners: unique(probableOwners, (path) => normalizePath(path), 12),
      references: unique(references, (path) => normalizePath(path), 16),
      unresolved: unique(unresolved, (value) => value.toLowerCase(), 12),
      evidenceByPath,
    },
    durationMs: performance.now() - startedAt,
    hopCount: Math.max(0, ...nodeList.map((node) => node.hop)),
    inspectedFileCount: nodeList.length,
    cacheReused: reused,
    limits,
  };
}
