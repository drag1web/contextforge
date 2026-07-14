import type { TaskIntentAnalysis } from "../ollama/taskIntentAnalyzer.js";
import type {
  ProjectInventory,
  ProjectInventoryFile,
  ProjectInventorySemanticFacts,
} from "../scanner/projectInventoryScanner.js";
import { buildProjectSemanticGraph } from "./projectSemanticGraph.js";

export type SelectionTargetSource =
  | "user_text"
  | "clarification"
  | "model_inference"
  | "ranking";

export type SelectionPathValidity =
  | "inventory_exact"
  | "unresolved"
  | "synthetic";

export type SelectionOwnershipEvidence =
  | "symbol_exact"
  | "reference_graph"
  | "route_graph"
  | "state_graph"
  | "content_supported"
  | "model_only"
  | "rank_only";

export type SelectionActionConfidence =
  | "inspect_only"
  | "inspect_then_edit"
  | "confirmed_edit";

export type SemanticCodeRole =
  | "producer"
  | "contract"
  | "state-owner"
  | "consumer"
  | "display"
  | "route"
  | "storage"
  | "reference";

export interface SemanticEvidenceLink {
  symbol: string;
  role: SemanticCodeRole;
  path: string;
  relatedPath?: string;
  evidence: SelectionOwnershipEvidence;
  relation?: "same_file" | "import_graph" | "route_local" | "translation_key" | "identifier_reference";
}

export interface FileSelectionEvidence {
  targetSource: SelectionTargetSource;
  pathValidity: SelectionPathValidity;
  ownershipEvidence: SelectionOwnershipEvidence;
  actionConfidence: SelectionActionConfidence;
  semanticRoles: SemanticCodeRole[];
  symbols: string[];
  chain: SemanticEvidenceLink[];
  negativeConstraintConflicts: string[];
  reason: string;
}

export interface RepositorySemanticQueryResult {
  byPath: Map<string, FileSelectionEvidence>;
  chains: SemanticEvidenceLink[][];
  existingImplementationPaths: string[];
  negativeConstraints: string[];
  buildDurationMs: number;
  queryDurationMs: number;
  indexReused: boolean;
}

interface IndexedFile {
  file: ProjectInventoryFile;
  normalizedPath: string;
  facts: ProjectInventorySemanticFacts;
  declarations: Set<string>;
  references: Set<string>;
  assignments: Set<string>;
  properties: Set<string>;
  stateSymbols: Set<string>;
  translationKeys: Set<string>;
  routes: Set<string>;
}

interface RepositorySemanticIndex {
  files: IndexedFile[];
  declarationsBySymbol: Map<string, IndexedFile[]>;
  referencesBySymbol: Map<string, IndexedFile[]>;
  translationOwnersByValue: Map<string, Array<{ file: IndexedFile; key: string }>>;
  translationUsersByKey: Map<string, IndexedFile[]>;
  builtAt: number;
  buildDurationMs: number;
  queryCache: Map<string, RepositorySemanticQueryResult>;
}

const INDEX_CACHE = new WeakMap<ProjectInventory, RepositorySemanticIndex>();

const QUERY_STOP_WORDS = new Set([
  "add", "change", "create", "edit", "fix", "improve", "make", "replace",
  "update", "with", "from", "into", "code", "file", "project", "task",
  "добавь", "измени", "замени", "исправь", "улучши", "код", "файл", "проект",
  "нужно", "через", "после", "который", "показывает", "отображение",
]);

const NEGATIVE_PATTERNS = [
  /\b(?:do not|don't|without|separate from|not the existing)\b[^.!?\n]{1,180}/giu,
  /(?:не\s+(?:трогай|меняй|изменяй|используй|существующ\w*)|без\s+изменени\w*|отдельн\w*\s+от)[^.!?\n]{1,180}/giu,
];

const TECHNICAL_OWNER_SUFFIXES = new Set([
  "page", "component", "service", "route", "handler", "controller", "hook",
  "store", "context", "provider", "modal", "repository", "adapter", "client",
]);

const BROAD_EXISTING_IMPLEMENTATION_SYMBOLS = new Set([
  "api",
  "backend",
  "client",
  "component",
  "diagnostic",
  "diagnostics",
  "frontend",
  "performance",
  "server",
  "status",
  "ui",
]);

const CYRILLIC_QUERY_STOP_WORDS = new Set([
  "добавь", "измени", "замени", "исправь", "улучши", "код", "файл", "проект",
  "нужно", "через", "после", "который", "показывает", "отображение",
]);

const CYRILLIC_NEGATIVE_PATTERNS = [
  /(?:не\s+(?:трогай|меняй|изменяй|используй|существующ\w*)|без\s+изменени\w*|отдельн\w*\s+от)[^.!?\n]{1,180}/giu,
];

function normalizePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

function normalizeIdentifier(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_./:-]+/g, " ")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function identifierTokens(value: string) {
  return normalizeIdentifier(value)
    .split(/\s+/u)
    .filter((token) =>
      token.length >= 2 &&
      !QUERY_STOP_WORDS.has(token) &&
      !CYRILLIC_QUERY_STOP_WORDS.has(token)
    );
}

function canonicalSymbol(value: string) {
  return identifierTokens(value).join("");
}

function uniqueStrings(values: string[], limit = 32) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= limit) break;
  }
  return result;
}

function emptyFacts(): ProjectInventorySemanticFacts {
  return {
    declarations: [],
    references: [],
    assignments: [],
    objectProperties: [],
    stateSymbols: [],
    translationKeys: [],
    translationEntries: [],
    routePaths: [],
  };
}

function factsForFile(file: ProjectInventoryFile): ProjectInventorySemanticFacts {
  if (file.semanticFacts) return file.semanticFacts;
  const text = file.contentPreview ?? "";
  const matches = (pattern: RegExp, limit: number) =>
    uniqueStrings([...text.matchAll(pattern)].map((match) => match[1] ?? ""), limit);
  const translationEntries = [...text.matchAll(/(?:["'`]([^"'`]{2,80})["'`]|\b([A-Za-z_$][\w$]*))\s*:\s*["'`]([^"'`]{2,180})["'`]/g)]
    .slice(0, 80)
    .map((match) => ({ key: match[1] ?? match[2] ?? "", value: match[3] ?? "" }))
    .filter((entry) => entry.key && entry.value);
  return {
    declarations: uniqueStrings([...(file.exports ?? []), ...(file.symbols ?? [])], 160),
    references: matches(/\b([A-Za-z_$][A-Za-z0-9_$]{2,})\b/g, 320),
    assignments: matches(/\b([A-Za-z_$][A-Za-z0-9_$]*)\s*=(?!=|>)/g, 100),
    objectProperties: matches(/(?:^|[{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*:/gm, 120),
    stateSymbols: matches(/\b(?:useState|useReducer|createContext)\s*(?:<[^>]+>)?\s*\([^)]*\)|\bset([A-Z][A-Za-z0-9_$]*)\s*\(/g, 80),
    translationKeys: uniqueStrings([
      ...matches(/\b(?:labelKey|translationKey|i18nKey)\s*:\s*["'`]([^"'`]+)["'`]/g, 80),
      ...matches(/\bt\(\s*["'`]([^"'`]+)["'`]/g, 80),
    ], 120),
    translationEntries,
    routePaths: matches(/\b(?:get|post|put|patch|delete|use)\s*\(\s*["'`]([^"'`]+)["'`]/gi, 80),
  };
}

function normalizedSet(values: string[]) {
  return new Set(values.map(canonicalSymbol).filter((value) => value.length >= 3));
}

function addToIndex<T>(map: Map<string, T[]>, key: string, value: T) {
  if (!key) return;
  const current = map.get(key) ?? [];
  if (!current.includes(value)) current.push(value);
  map.set(key, current);
}

function uniqueIndexedFiles(files: IndexedFile[]) {
  const seen = new Set<string>();
  const result: IndexedFile[] = [];
  for (const file of files) {
    if (seen.has(file.normalizedPath)) continue;
    seen.add(file.normalizedPath);
    result.push(file);
  }
  return result;
}

function buildIndex(inventory: ProjectInventory): RepositorySemanticIndex {
  const startedAt = performance.now();
  const declarationsBySymbol = new Map<string, IndexedFile[]>();
  const referencesBySymbol = new Map<string, IndexedFile[]>();
  const translationOwnersByValue = new Map<string, Array<{ file: IndexedFile; key: string }>>();
  const translationUsersByKey = new Map<string, IndexedFile[]>();
  const files = inventory.files
    .filter((file) => file.canReadText && !file.isLikelyGenerated)
    .map((file) => {
      const facts = factsForFile(file);
      const declarations = normalizedSet([
        ...(file.exports ?? []),
        ...(file.symbols ?? []),
        ...facts.declarations,
        ...facts.assignments,
        ...facts.stateSymbols,
      ]);
      const indexed: IndexedFile = {
        file,
        normalizedPath: normalizePath(file.path).toLowerCase(),
        facts,
        declarations,
        references: normalizedSet(facts.references),
        assignments: normalizedSet(facts.assignments),
        properties: normalizedSet(facts.objectProperties),
        stateSymbols: normalizedSet(facts.stateSymbols),
        translationKeys: new Set(facts.translationKeys.map((value) => value.toLowerCase())),
        routes: new Set([file.routePath, ...facts.routePaths].filter(Boolean).map((value) => String(value).toLowerCase())),
      };
      return indexed;
    });

  for (const file of files) {
    for (const symbol of file.declarations) addToIndex(declarationsBySymbol, symbol, file);
    for (const symbol of file.references) addToIndex(referencesBySymbol, symbol, file);
    for (const key of file.translationKeys) addToIndex(translationUsersByKey, key, file);
    for (const entry of file.facts.translationEntries) {
      const value = normalizeIdentifier(entry.value);
      if (!value) continue;
      const current = translationOwnersByValue.get(value) ?? [];
      current.push({ file, key: entry.key.toLowerCase() });
      translationOwnersByValue.set(value, current);
    }
  }

  return {
    files,
    declarationsBySymbol,
    referencesBySymbol,
    translationOwnersByValue,
    translationUsersByKey,
    builtAt: Date.now(),
    buildDurationMs: performance.now() - startedAt,
    queryCache: new Map(),
  };
}

export function getRepositorySemanticIndex(inventory: ProjectInventory) {
  const cached = INDEX_CACHE.get(inventory);
  if (cached) return { index: cached, reused: true };
  const index = buildIndex(inventory);
  INDEX_CACHE.set(inventory, index);
  return { index, reused: false };
}

function isContractPropertyOwner(file: IndexedFile) {
  const role = String(file.file.role ?? "").toLowerCase();
  return (
    role === "api-route" ||
    role === "client-api" ||
    role === "types" ||
    role === "schema" ||
    role === "db-schema" ||
    /(?:^|\/)(?:routes?|api|types?|schemas?)\//u.test(file.normalizedPath) ||
    /\.(?:d\.ts|schema\.ts|schema\.js)$/iu.test(file.normalizedPath)
  );
}

function graphRelation(
  inventory: ProjectInventory,
  owner: IndexedFile,
  consumer: IndexedFile,
): SemanticEvidenceLink["relation"] | undefined {
  if (owner.normalizedPath === consumer.normalizedPath) return "same_file";
  const graph = buildProjectSemanticGraph(inventory);
  const ownerNode = graph.getNode(owner.file.path);
  const consumerKey = consumer.normalizedPath;
  const direct = ownerNode?.imports.find((edge) => normalizePath(edge.to).toLowerCase() === consumerKey);
  if (direct) return direct.kind === "route-local" ? "route_local" : "import_graph";
  const consumerNode = graph.getNode(consumer.file.path);
  const reverse = consumerNode?.imports.find((edge) => normalizePath(edge.to).toLowerCase() === owner.normalizedPath);
  if (reverse) return reverse.kind === "route-local" ? "route_local" : "import_graph";
  const routeLocal = ownerNode?.routeLocal.find((edge) => normalizePath(edge.to).toLowerCase() === consumerKey);
  return routeLocal ? "route_local" : undefined;
}

function collectQueryTerms(rawTask: string, taskIntent?: TaskIntentAnalysis) {
  const values = uniqueStrings([
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
  ], 48);
  const symbols = new Set<string>();
  for (const value of values) {
    const camelCase = value.match(/\b[A-Za-z_$][A-Za-z0-9_$]{3,}\b/g) ?? [];
    for (const symbol of camelCase) symbols.add(canonicalSymbol(symbol));
    const tokens = identifierTokens(value);
    if (tokens.length > 0 && tokens.length <= 5) symbols.add(tokens.join(""));
  }
  return { values, symbols: [...symbols].filter((value) => value.length >= 4) };
}

function extractNegativeConstraints(rawTask: string, taskIntent?: TaskIntentAnalysis) {
  const clauses = [...NEGATIVE_PATTERNS, ...CYRILLIC_NEGATIVE_PATTERNS]
    .flatMap((pattern) => [...rawTask.matchAll(pattern)].map((match) => match[0]));
  return uniqueStrings([
    ...clauses,
    ...(taskIntent?.structuredIntent.protectedScopes ?? []),
    ...(taskIntent?.taskUnderstanding.constraints ?? []).filter((value) =>
      /\b(?:not|without|separate|avoid|unchanged)\b|(?:\bне\b|без\s+измен|отдельн\w*\s+от)/iu.test(value),
    ),
  ], 12);
}

function negativeConflicts(file: IndexedFile, constraints: string[]) {
  const identity = new Set(identifierTokens([
    file.file.path,
    file.file.name,
    ...(file.file.exports ?? []),
    ...(file.file.symbols ?? []),
    ...(file.file.textHints ?? []),
  ].join(" ")));
  return constraints.filter((constraint) => {
    const tokens = identifierTokens(constraint);
    const overlap = tokens.filter((token) => identity.has(token));
    return overlap.length >= Math.min(2, Math.max(1, tokens.length));
  });
}

function bestOwnership(evidence: SelectionOwnershipEvidence[]) {
  const order: SelectionOwnershipEvidence[] = [
    "symbol_exact",
    "route_graph",
    "state_graph",
    "reference_graph",
    "content_supported",
    "model_only",
    "rank_only",
  ];
  return order.find((item) => evidence.includes(item)) ?? "rank_only";
}

function sourceForFile(file: IndexedFile, rawTask: string, taskIntent?: TaskIntentAnalysis): SelectionTargetSource {
  const task = rawTask.toLowerCase().replace(/\\/g, "/");
  const basename = file.normalizedPath.split("/").pop() ?? file.normalizedPath;
  if (task.includes(file.normalizedPath) || task.includes(basename)) return "user_text";
  if (taskIntent?.structuredIntent.primaryTargets.some((target) =>
    target.provenance === "user_confirmed" &&
    [target.path, target.value, target.name].filter(Boolean).some((value) =>
      file.normalizedPath.includes(String(value).toLowerCase().replace(/\\/g, "/")),
    ),
  )) return "clarification";
  if (taskIntent?.structuredIntent.primaryTargets.some((target) =>
    [target.path, target.value, target.name].filter(Boolean).some((value) =>
      file.normalizedPath.includes(String(value).toLowerCase().replace(/\\/g, "/")),
    ),
  )) return "model_inference";
  return "ranking";
}

function actionForEvidence(
  source: SelectionTargetSource,
  ownership: SelectionOwnershipEvidence,
  roles: SemanticCodeRole[],
  conflicts: string[],
  externalDisplayContract = false,
): SelectionActionConfidence {
  if (
    conflicts.length > 0 ||
    externalDisplayContract ||
    roles.every((role) => ["consumer", "display", "reference"].includes(role))
  ) {
    return "inspect_only";
  }
  if (source === "user_text" && ownership === "symbol_exact") return "confirmed_edit";
  if (["symbol_exact", "route_graph", "state_graph"].includes(ownership)) {
    return "inspect_then_edit";
  }
  return "inspect_only";
}

export function resolveRepositorySemanticEvidence(input: {
  rawTask: string;
  inventory: ProjectInventory;
  taskIntent?: TaskIntentAnalysis;
}): RepositorySemanticQueryResult {
  const { index, reused } = getRepositorySemanticIndex(input.inventory);
  const cacheKey = JSON.stringify({
    rawTask: input.rawTask,
    area: input.taskIntent?.taskArea ?? "",
    terms: input.taskIntent?.recommendedSearchTerms ?? [],
    targets: input.taskIntent?.structuredIntent.primaryTargets ?? [],
    constraints: input.taskIntent?.taskUnderstanding.constraints ?? [],
  });
  const cached = index.queryCache.get(cacheKey);
  if (cached) return { ...cached, indexReused: true, queryDurationMs: 0 };

  const startedAt = performance.now();
  const query = collectQueryTerms(input.rawTask, input.taskIntent);
  const constraints = extractNegativeConstraints(input.rawTask, input.taskIntent);
  const linksByPath = new Map<string, SemanticEvidenceLink[]>();
  const rolesByPath = new Map<string, Set<SemanticCodeRole>>();
  const evidenceByPath = new Map<string, SelectionOwnershipEvidence[]>();
  const chains: SemanticEvidenceLink[][] = [];
  const add = (file: IndexedFile, link: SemanticEvidenceLink) => {
    const key = file.normalizedPath;
    linksByPath.set(key, [...(linksByPath.get(key) ?? []), link]);
    const roles = rolesByPath.get(key) ?? new Set<SemanticCodeRole>();
    roles.add(link.role);
    rolesByPath.set(key, roles);
    evidenceByPath.set(key, [...(evidenceByPath.get(key) ?? []), link.evidence]);
  };

  for (const symbol of query.symbols) {
    const owners = uniqueIndexedFiles([
      ...(index.declarationsBySymbol.get(symbol) ?? []),
      ...index.files.filter((file) => file.properties.has(symbol) && isContractPropertyOwner(file)),
    ]);
    const consumers = index.referencesBySymbol.get(symbol) ?? [];
    for (const owner of owners) {
      const stateOwner = owner.stateSymbols.has(symbol);
      const contractOwner = owner.properties.has(symbol) || owner.file.role === "types";
      const producer: SemanticEvidenceLink = {
        symbol,
        role: stateOwner ? "state-owner" : contractOwner ? "contract" : "producer",
        path: owner.file.path,
        evidence: stateOwner ? "state_graph" : "symbol_exact",
        relation: "same_file",
      };
      add(owner, producer);
      for (const consumer of consumers.filter((item) => item !== owner).slice(0, 8)) {
        const relation = graphRelation(input.inventory, owner, consumer);
        const consumerLink: SemanticEvidenceLink = {
          symbol,
          role: relation ? "consumer" : "reference",
          path: consumer.file.path,
          relatedPath: owner.file.path,
          evidence: relation ? "reference_graph" : "content_supported",
          relation: relation ?? "identifier_reference",
        };
        add(consumer, consumerLink);
        if (relation) chains.push([producer, consumerLink]);
      }
    }
  }

  for (const symbol of query.symbols) {
    if (index.declarationsBySymbol.has(symbol)) continue;
    for (const file of index.files) {
      const relatedDeclaration = [
        ...(file.file.exports ?? []),
        ...(file.file.symbols ?? []),
        ...file.facts.declarations,
      ].find((declaration) => {
        const tokens = identifierTokens(declaration);
        const compact = tokens.join("");
        if (!compact.startsWith(symbol) && !compact.endsWith(symbol)) return false;
        const remaining = tokens.filter((token) => !symbol.includes(token));
        return remaining.length > 0 && remaining.every((token) => TECHNICAL_OWNER_SUFFIXES.has(token));
      });
      if (!relatedDeclaration) continue;
      const role: SemanticCodeRole = file.file.role === "api-route" ? "route" : "producer";
      add(file, {
        symbol: relatedDeclaration,
        role,
        path: file.file.path,
        evidence: "route_graph",
      });
    }
  }

  const normalizedTask = normalizeIdentifier(input.rawTask);
  for (const [value, owners] of index.translationOwnersByValue) {
    if (value.length < 3 || !normalizedTask.includes(value)) continue;
    for (const owner of owners) {
      const producer: SemanticEvidenceLink = {
        symbol: owner.key,
        role: "contract",
        path: owner.file.file.path,
        evidence: "symbol_exact",
        relation: "translation_key",
      };
      add(owner.file, producer);
      const translationConsumers = [...index.translationUsersByKey.entries()]
        .filter(([key]) => key === owner.key || key.endsWith(`.${owner.key}`))
        .flatMap(([, files]) => files);
      for (const consumer of translationConsumers) {
        if (consumer === owner.file) continue;
        const display: SemanticEvidenceLink = {
          symbol: owner.key,
          role: "display",
          path: consumer.file.path,
          relatedPath: owner.file.file.path,
          evidence: "reference_graph",
          relation: "translation_key",
        };
        add(consumer, display);
        chains.push([producer, display]);
      }
    }
  }

  for (const file of index.files) {
    if (file.routes.size === 0) continue;
    const matchedRoute = [...file.routes].find((route) => route.length > 1 && input.rawTask.toLowerCase().includes(route));
    if (!matchedRoute) continue;
    add(file, {
      symbol: matchedRoute,
      role: "route",
      path: file.file.path,
      evidence: "route_graph",
    });
  }

  const byPath = new Map<string, FileSelectionEvidence>();
  for (const file of index.files) {
    const links = linksByPath.get(file.normalizedPath) ?? [];
    const conflicts = negativeConflicts(file, constraints);
    if (links.length === 0 && conflicts.length === 0) continue;
    const roles = [...(rolesByPath.get(file.normalizedPath) ?? new Set<SemanticCodeRole>())];
    const ownership = bestOwnership(evidenceByPath.get(file.normalizedPath) ?? ["rank_only"]);
    const source = sourceForFile(file, input.rawTask, input.taskIntent);
    const symbols = uniqueStrings(links.map((link) => link.symbol), 12);
    const externalDisplayContract = links.some(
      (link) => link.role === "display" && Boolean(link.relatedPath) &&
        normalizePath(link.relatedPath!).toLowerCase() !== file.normalizedPath,
    );
    byPath.set(file.normalizedPath, {
      targetSource: source,
      pathValidity: "inventory_exact",
      ownershipEvidence: ownership,
      actionConfidence: actionForEvidence(
        source,
        ownership,
        roles,
        conflicts,
        externalDisplayContract,
      ),
      semanticRoles: roles,
      symbols,
      chain: links.slice(0, 16),
      negativeConstraintConflicts: conflicts,
      reason: conflicts.length > 0
        ? "Candidate conflicts with a user negative constraint and is reference-only."
        : `Code evidence: ${roles.join(", ")} via ${ownership} (${symbols.join(", ")}).`,
    });
  }

  const existingImplementationPaths = [...byPath.entries()]
    .filter(([, evidence]) =>
      ["symbol_exact", "state_graph"].includes(evidence.ownershipEvidence) &&
      evidence.semanticRoles.some((role) => ["producer", "contract", "state-owner", "route"].includes(role)),
    )
    .filter(([, evidence]) =>
      evidence.symbols.some((symbol) => !BROAD_EXISTING_IMPLEMENTATION_SYMBOLS.has(symbol)),
    )
    .map(([path]) => index.files.find((file) => file.normalizedPath === path)?.file.path ?? path)
    .slice(0, 12);
  const result: RepositorySemanticQueryResult = {
    byPath,
    chains: chains.slice(0, 24),
    existingImplementationPaths,
    negativeConstraints: constraints,
    buildDurationMs: index.buildDurationMs,
    queryDurationMs: performance.now() - startedAt,
    indexReused: reused,
  };
  index.queryCache.set(cacheKey, result);
  return result;
}
