import type {
  ProjectInventory,
  ProjectInventoryFile,
  ProjectInventoryFileRole,
} from "../scanner/projectInventoryScanner.js";
import type { SemanticCodeRole } from "./repositorySemanticIndex.js";

export interface GroundedSupportingContextCandidate {
  file: ProjectInventoryFile;
  score: number;
  reason: string;
  semanticRoles: SemanticCodeRole[];
  symbols: string[];
}

interface SupportRequest {
  clause: string;
  kinds: SupportKind[];
  entityTokens: string[];
}

type SupportKind =
  | "api"
  | "storage"
  | "repository"
  | "service"
  | "client"
  | "state"
  | "hook"
  | "component"
  | "utility"
  | "schema"
  | "contract";

const SUPPORT_KIND_ALIASES: Record<SupportKind, string[]> = {
  api: [
    "api",
    "endpoint",
    "route",
    "router",
    "апи",
    "эндпоинт",
    "маршрут",
    "роут",
    "api-клієнт",
    "ендпоінт",
  ],
  storage: [
    "storage",
    "persistence",
    "database",
    "db",
    "хранилище",
    "хранилища",
    "хранилищ",
    "база",
    "бд",
    "сховище",
    "сховища",
    "зберігання",
  ],
  repository: [
    "repository",
    "repositories",
    "repo",
    "репозиторий",
    "репозитория",
    "репозитор",
    "репозиторій",
  ],
  service: ["service", "services", "сервис", "сервиса", "сервіс", "сервісу"],
  client: ["client", "sdk", "клиент", "клиента", "клієнт", "клієнта"],
  state: ["state", "store", "reducer", "состояние", "стор", "стан", "сховище стану"],
  hook: ["hook", "hooks", "хук", "хуки"],
  component: ["component", "components", "компонент", "компонента"],
  utility: ["helper", "utility", "util", "хелпер", "утилита", "утиліту"],
  schema: ["schema", "model", "схема", "модель"],
  contract: ["contract", "type", "types", "interface", "контракт", "тип", "интерфейс", "інтерфейс"],
};

const SUPPORT_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "already",
  "available",
  "build",
  "call",
  "current",
  "existing",
  "for",
  "from",
  "implementation",
  "in",
  "it",
  "its",
  "on",
  "only",
  "reuse",
  "reused",
  "using",
  "use",
  "the",
  "with",
  "without",
  "готов",
  "готовый",
  "готовую",
  "использовать",
  "используй",
  "используя",
  "переиспользовать",
  "переиспользуй",
  "существующая",
  "существующий",
  "существующую",
  "существующее",
  "существующей",
  "текущий",
  "текущую",
  "уже",
  "використай",
  "використовуй",
  "використовуючи",
  "існуюча",
  "існуючий",
  "існуючу",
  "наявний",
  "наявну",
  "перевикористай",
  "поточний",
  "поточну",
]);

const GENERIC_ENTITY_TOKENS = new Set([
  "apps",
  "backend",
  "client",
  "component",
  "components",
  "desktop",
  "code",
  "data",
  "endpoint",
  "file",
  "frontend",
  "implementation",
  "page",
  "pages",
  "renderer",
  "index",
  "module",
  "new",
  "route",
  "routes",
  "server",
  "src",
  "source",
  "system",
  "target",
  "value",
  "api",
  "код",
  "данные",
  "данных",
  "модуль",
  "новый",
  "новую",
  "сервер",
  "файл",
  "дані",
  "модуль",
  "новий",
  "нову",
]);

function normalizePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\.\//u, "").toLocaleLowerCase();
}

function tokenize(value: string) {
  return value
    .normalize("NFKC")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}_$-]+/u)
    .map((token) => token.replace(/^[-_$]+|[-_$]+$/gu, "").trim())
    .filter((token) => token.length >= 2);
}

function uniqueStrings(values: string[], limit = values.length) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim().toLocaleLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function tokenEquivalent(left: string, right: string) {
  if (left === right) return true;
  if (left.length < 4 || right.length < 4) return false;
  const trimPlural = (value: string) => {
    if (/^[a-z0-9_-]+$/u.test(value)) {
      if (value.endsWith("ies") && value.length > 5) return `${value.slice(0, -3)}y`;
      if (value.endsWith("es") && value.length > 5) return value.slice(0, -2);
      if (value.endsWith("s") && value.length > 4) return value.slice(0, -1);
    }
    return value;
  };
  const a = trimPlural(left);
  const b = trimPlural(right);
  if (a === b) return true;
  const prefix = Math.min(6, a.length, b.length);
  return prefix >= 4 && a.slice(0, prefix) === b.slice(0, prefix);
}

function hasMatchingToken(pool: Iterable<string>, expected: string) {
  for (const token of pool) if (tokenEquivalent(token, expected)) return true;
  return false;
}

function extractSupportClauses(rawTask: string) {
  const normalized = rawTask.normalize("NFKC");
  const patterns = [
    /\b(?:reuse|use|using|rely\s+on|build\s+on|call)\b[^.!?\n]{0,180}/giu,
    /(?:переиспользуй|переиспользовать|используй|использовать|используя|опирайся\s+на|возьми)[^.!?\n]{0,180}/giu,
    /(?:перевикористай|використай|використовуй|використовуючи|спирайся\s+на)[^.!?\n]{0,180}/giu,
  ];
  return uniqueStrings(
    patterns.flatMap((pattern) => Array.from(normalized.matchAll(pattern), (match) => match[0] ?? "")),
    6,
  );
}

function extractSupportRequests(rawTask: string): SupportRequest[] {
  const allKindAliases = new Set(
    Object.values(SUPPORT_KIND_ALIASES).flatMap((aliases) => aliases.flatMap(tokenize)),
  );
  const requests: SupportRequest[] = [];

  for (const clause of extractSupportClauses(rawTask)) {
    const clauseTokens = tokenize(clause);
    const hasExistingSignal =
      /\b(?:reuse|reused|existing|current|already\s+available)\b|(?:переиспольз|существующ|уже\s+есть|готов\p{L}*)|(?:перевикорист|існуюч|наявн\p{L}*)/iu.test(
        clause,
      );
    if (!hasExistingSignal) continue;

    const kinds = (Object.keys(SUPPORT_KIND_ALIASES) as SupportKind[]).filter((kind) =>
      SUPPORT_KIND_ALIASES[kind].some((alias) => {
        const aliasTokens = tokenize(alias);
        return aliasTokens.every((aliasToken) => hasMatchingToken(clauseTokens, aliasToken));
      }),
    );
    if (kinds.length === 0) continue;

    const entityTokens = uniqueStrings(
      clauseTokens.filter(
        (token) =>
          token.length >= 3 &&
          !SUPPORT_STOP_WORDS.has(token) &&
          !GENERIC_ENTITY_TOKENS.has(token) &&
          !allKindAliases.has(token) &&
          !/^\d+$/u.test(token),
      ),
      8,
    );
    requests.push({ clause, kinds, entityTokens });
  }

  return requests;
}

function inferRoleForTargetPath(pathValue: string): ProjectInventoryFileRole | null {
  const path = normalizePath(pathValue);
  if (/(?:^|\/)routes?(?:\/|$)/u.test(path)) return "api-route";
  if (/(?:^|\/)services?(?:\/|$)/u.test(path)) return "service";
  if (/(?:^|\/)repositories?(?:\/|$)/u.test(path)) return "repository";
  if (/(?:^|\/)(?:stores?|state)(?:\/|$)/u.test(path)) return "store";
  if (/(?:^|\/)hooks?(?:\/|$)/u.test(path)) return "hook";
  if (/(?:^|\/)types?(?:\/|$)/u.test(path)) return "types";
  if (/(?:^|\/)pages?(?:\/|$)/u.test(path)) return "page";
  if (/(?:^|\/)components?(?:\/|$)/u.test(path)) return "component";
  return null;
}

function supportRoleForKinds(kinds: SupportKind[]): SemanticCodeRole[] {
  const roles: SemanticCodeRole[] = [];
  if (kinds.some((kind) => kind === "storage" || kind === "repository")) roles.push("storage");
  if (kinds.some((kind) => kind === "api" || kind === "client" || kind === "service")) roles.push("route");
  if (kinds.some((kind) => kind === "state" || kind === "hook")) roles.push("state-owner");
  if (kinds.some((kind) => kind === "schema" || kind === "contract")) roles.push("contract");
  if (roles.length === 0) roles.push("reference");
  return uniqueStrings(roles) as SemanticCodeRole[];
}

function isBackendOnlyTask(rawTask: string) {
  return /\b(?:backend|server)\s+only\b|\bdo\s+not\s+(?:modify|change|touch)\s+(?:the\s+)?(?:renderer|frontend|ui)\b|(?:только\s+(?:backend|бэкенд|бекенд|сервер)|не\s+(?:меняй|изменяй|трогай)[^.!?\n]{0,60}(?:renderer|frontend|ui|интерфейс))|(?:лише\s+(?:backend|бекенд|сервер)|не\s+(?:змінюй|чіпай)[^.!?\n]{0,60}(?:renderer|frontend|ui|інтерфейс))/iu.test(
    rawTask,
  );
}

function isUiOnlyTask(rawTask: string) {
  return /\b(?:frontend|ui|client)\s+only\b|\bdo\s+not\s+(?:modify|change|touch)\s+(?:the\s+)?(?:server|backend|storage|database)\b|(?:только\s+(?:frontend|ui|интерфейс)|не\s+(?:меняй|изменяй|трогай)[^.!?\n]{0,60}(?:server|backend|бэкенд|бекенд|storage|хранилищ|бд))|(?:лише\s+(?:frontend|ui|інтерфейс)|не\s+(?:змінюй|чіпай)[^.!?\n]{0,60}(?:server|backend|бекенд|storage|сховищ|бд))/iu.test(
    rawTask,
  );
}

function isBackendFile(file: ProjectInventoryFile) {
  const path = normalizePath(file.path);
  return (
    /(?:^|\/)(?:server|backend)(?:\/|$)/u.test(path) ||
    ["api-route", "server-entry", "service", "repository", "db-schema"].includes(file.role)
  );
}

function isUiFile(file: ProjectInventoryFile) {
  const path = normalizePath(file.path);
  return (
    /(?:^|\/)(?:renderer|frontend|client)(?:\/|$)/u.test(path) ||
    ["page", "layout", "component", "ui-component", "client-api"].includes(file.role)
  );
}

function candidatePools(file: ProjectInventoryFile) {
  const pathTokens = tokenize(file.path);
  const nameTokens = tokenize(file.name.replace(/\.[^.]+$/u, ""));
  const symbolTokens = [
    ...(file.exports ?? []),
    ...(file.symbols ?? []),
    ...(file.semanticFacts?.declarations ?? []),
  ].flatMap(tokenize);
  const importTokens = (file.imports ?? []).flatMap(tokenize);
  const referenceTokens = [
    ...(file.textHints ?? []),
    ...(file.semanticFacts?.references ?? []),
    ...(file.semanticFacts?.assignments ?? []),
    ...(file.semanticFacts?.objectProperties ?? []),
    ...(file.semanticFacts?.typeFields ?? []),
    ...(file.semanticFacts?.routePaths ?? []),
  ].flatMap(tokenize);
  return { pathTokens, nameTokens, symbolTokens, importTokens, referenceTokens };
}


function roleMatchesSupportKind(
  role: ProjectInventoryFileRole,
  kind: SupportKind,
) {
  return (
    (kind === "api" && ["api-route", "client-api", "server-entry"].includes(role)) ||
    (kind === "storage" && ["repository", "db-schema", "store"].includes(role)) ||
    (kind === "repository" && role === "repository") ||
    (kind === "service" && role === "service") ||
    (kind === "client" && role === "client-api") ||
    (kind === "state" && ["store", "hook"].includes(role)) ||
    (kind === "hook" && role === "hook") ||
    (kind === "component" && ["component", "ui-component", "page", "layout"].includes(role)) ||
    (kind === "schema" && ["types", "db-schema"].includes(role)) ||
    (kind === "contract" && role === "types") ||
    (kind === "utility" && role === "utility")
  );
}

function kindEvidenceScore(
  file: ProjectInventoryFile,
  pools: ReturnType<typeof candidatePools>,
  kinds: SupportKind[],
) {
  let score = 0;
  const matchedKinds: SupportKind[] = [];
  const allStructuralTokens = [
    ...pools.pathTokens,
    ...pools.nameTokens,
    ...pools.symbolTokens,
    ...pools.importTokens,
  ];

  for (const kind of kinds) {
    const aliases = SUPPORT_KIND_ALIASES[kind].flatMap(tokenize);
    const aliasMatched = aliases.some((alias) => hasMatchingToken(allStructuralTokens, alias));
    const roleMatched = roleMatchesSupportKind(file.role, kind);
    if (!aliasMatched && !roleMatched) continue;
    matchedKinds.push(kind);
    score += roleMatched ? 90 : 65;
    if (aliases.some((alias) => hasMatchingToken(pools.importTokens, alias))) score += 85;
    if (aliases.some((alias) => hasMatchingToken(pools.pathTokens, alias))) score += 55;
  }

  return { score, matchedKinds };
}

function entityEvidenceScore(
  pools: ReturnType<typeof candidatePools>,
  entityTokens: string[],
) {
  let score = 0;
  const matched: string[] = [];
  for (const entity of entityTokens) {
    let tokenScore = 0;
    if (hasMatchingToken(pools.nameTokens, entity)) tokenScore = Math.max(tokenScore, 145);
    if (hasMatchingToken(pools.pathTokens, entity)) tokenScore = Math.max(tokenScore, 115);
    if (hasMatchingToken(pools.symbolTokens, entity)) tokenScore = Math.max(tokenScore, 80);
    if (hasMatchingToken(pools.referenceTokens, entity)) tokenScore = Math.max(tokenScore, 38);
    if (hasMatchingToken(pools.importTokens, entity)) tokenScore = Math.max(tokenScore, 25);
    if (tokenScore > 0) {
      score += tokenScore;
      matched.push(entity);
    }
  }
  return { score, matched };
}

function targetDirectoryAffinity(file: ProjectInventoryFile, targetPaths: string[]) {
  const fileDir = normalizePath(file.path).split("/").slice(0, -1).join("/");
  return targetPaths.some((target) => {
    const targetDir = normalizePath(target).split("/").slice(0, -1).join("/");
    return Boolean(targetDir && targetDir === fileDir);
  });
}

function scoreCandidate(
  file: ProjectInventoryFile,
  request: SupportRequest,
  targetPaths: string[],
  targetEntityTokens: string[],
) {
  const pools = candidatePools(file);
  const kindEvidence = kindEvidenceScore(file, pools, request.kinds);
  if (kindEvidence.matchedKinds.length === 0) return null;

  const entityEvidence = entityEvidenceScore(pools, request.entityTokens);
  const targetEntityEvidence = entityEvidenceScore(pools, targetEntityTokens);
  if (
    request.entityTokens.length > 0 &&
    entityEvidence.matched.length === 0 &&
    targetEntityEvidence.matched.length === 0
  ) {
    return null;
  }

  let score =
    kindEvidence.score +
    entityEvidence.score +
    Math.min(120, targetEntityEvidence.score * 0.65);
  const expectedRoles = new Set(
    targetPaths
      .map(inferRoleForTargetPath)
      .filter((role): role is ProjectInventoryFileRole => Boolean(role)),
  );
  if (expectedRoles.has(file.role)) score += 75;
  if (targetDirectoryAffinity(file, targetPaths)) score += 55;

  // Provider-specific roles must outrank consumers that merely import or mention
  // the provider. This is especially important for UI tasks: a page using the
  // API client is evidence of usage, but the client module is the reusable
  // implementation the user explicitly asked to preserve.
  if (request.kinds.includes("client")) {
    if (file.role === "client-api") score += 240;
    else if (["page", "layout", "component", "ui-component"].includes(file.role)) score -= 180;
  }
  if (request.kinds.includes("service")) {
    if (file.role === "service") score += 190;
    else if (["page", "layout", "component", "ui-component"].includes(file.role)) score -= 120;
  }
  if (request.kinds.includes("repository") && file.role === "repository") score += 210;
  if (request.kinds.includes("hook") && file.role === "hook") score += 190;
  if (request.kinds.includes("state") && ["store", "hook"].includes(file.role)) score += 170;
  if (request.kinds.includes("contract") && file.role === "types") score += 190;
  if (request.kinds.includes("schema") && ["types", "db-schema"].includes(file.role)) score += 180;

  const importsRequestedProvider = request.kinds.some((kind) =>
    SUPPORT_KIND_ALIASES[kind]
      .flatMap(tokenize)
      .some((alias) => hasMatchingToken(pools.importTokens, alias)),
  );
  if (importsRequestedProvider && ["api-route", "service", "client-api"].includes(file.role)) {
    score += 90;
  }

  if (file.sizeBytes > 120_000) score -= 155;
  else if (file.sizeBytes > 70_000) score -= 95;
  else if (file.sizeBytes > 40_000) score -= 45;
  else if (file.sizeBytes <= 15_000) score += 20;

  if (score < 170) return null;

  const matchedDescription = uniqueStrings([
    ...entityEvidence.matched,
    ...targetEntityEvidence.matched,
    ...kindEvidence.matchedKinds,
  ]).join(", ");
  return {
    file,
    score,
    reason: `User explicitly requested reuse of existing supporting context; repository evidence matched ${matchedDescription || "the requested provider"} in ${file.path}. The file is retained as inspect-only and is not an edit target.`,
    semanticRoles: supportRoleForKinds(request.kinds),
    symbols: uniqueStrings(
      [
        ...(file.exports ?? []),
        ...(file.symbols ?? []),
        ...(file.semanticFacts?.declarations ?? []),
      ],
      8,
    ),
  } satisfies GroundedSupportingContextCandidate;
}

export function resolveGroundedSupportingContext(input: {
  rawTask: string;
  inventory: ProjectInventory;
  targetPaths: string[];
  excludedPaths?: string[];
  maxFiles?: number;
}): GroundedSupportingContextCandidate[] {
  const requests = extractSupportRequests(input.rawTask);
  if (requests.length === 0) return [];

  const targetKeys = new Set(input.targetPaths.map(normalizePath));
  const targetEntityTokens = uniqueStrings(
    input.targetPaths
      .flatMap((targetPath) => tokenize(targetPath.replace(/\.[^.]+$/u, "")))
      .filter(
        (token) =>
          token.length >= 3 &&
          !GENERIC_ENTITY_TOKENS.has(token) &&
          !SUPPORT_STOP_WORDS.has(token) &&
          !Object.values(SUPPORT_KIND_ALIASES)
            .flatMap((aliases) => aliases.flatMap(tokenize))
            .includes(token),
      ),
    10,
  );
  const excludedKeys = new Set((input.excludedPaths ?? []).map(normalizePath));
  const backendOnly = isBackendOnlyTask(input.rawTask);
  const uiOnly = isUiOnlyTask(input.rawTask);
  const candidates = new Map<string, GroundedSupportingContextCandidate>();

  for (const file of input.inventory.files) {
    const key = normalizePath(file.path);
    if (
      targetKeys.has(key) ||
      excludedKeys.has(key) ||
      file.isLikelyGenerated ||
      !file.canReadText ||
      ["test", "docs", "style", "asset", "runtime"].includes(file.kind)
    ) {
      continue;
    }
    if (backendOnly && !isBackendFile(file)) continue;
    if (uiOnly && !isUiFile(file)) continue;

    for (const request of requests) {
      const candidate = scoreCandidate(
        file,
        request,
        input.targetPaths,
        targetEntityTokens,
      );
      if (!candidate) continue;
      const existing = candidates.get(key);
      if (!existing || candidate.score > existing.score) candidates.set(key, candidate);
    }
  }

  const limit = Math.max(0, input.maxFiles ?? 2);
  const ranked = [...candidates.values()].sort(
    (left, right) =>
      right.score - left.score || left.file.path.localeCompare(right.file.path),
  );
  const selected: GroundedSupportingContextCandidate[] = [];
  const selectedRoles = new Set<ProjectInventoryFileRole>();
  const requestedKinds = uniqueStrings(
    requests.flatMap((request) => request.kinds),
  ) as SupportKind[];
  const hasDirectProviderRole = ranked.some((candidate) =>
    requestedKinds.some((kind) => roleMatchesSupportKind(candidate.file.role, kind)),
  );
  for (const candidate of ranked) {
    if (
      hasDirectProviderRole &&
      !requestedKinds.some((kind) => roleMatchesSupportKind(candidate.file.role, kind))
    ) {
      continue;
    }
    if (selected.length >= limit) break;
    // A reuse-existing directive normally needs one usage example per technical
    // role, not several near-duplicate route files that happen to import the
    // same provider. Preserve the highest-scoring route and spend any remaining
    // budget on the provider/contract layer instead.
    if (selectedRoles.has(candidate.file.role)) continue;
    selected.push(candidate);
    selectedRoles.add(candidate.file.role);
  }
  return selected;
}
