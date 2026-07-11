import type { ProjectInventoryFileRole } from "../scanner/projectInventoryScanner.js";
import type { CandidateRetrievalResult, RetrievedCandidate } from "./candidateRetrieval.js";
import type { SemanticGraphEdge } from "./projectSemanticGraph.js";

export interface ContextAssemblyResult {
  candidates: RetrievedCandidate[];
  anchorIds: Set<string>;
  diagnostics: string[];
}

const FRONTEND_ROLES = new Set<ProjectInventoryFileRole>([
  "page", "component", "ui-component", "layout", "style", "hook", "client-api", "app-entry",
]);
const BACKEND_ROLES = new Set<ProjectInventoryFileRole>([
  "api-route", "service", "repository", "db-schema", "store", "types", "utility", "server-entry",
]);
const BACKEND_ENTRY_ROLES = new Set<ProjectInventoryFileRole>(["api-route", "server-entry"]);
const BACKEND_LOGIC_ROLES = new Set<ProjectInventoryFileRole>(["service", "utility"]);
const PERSISTENCE_ROLES = new Set<ProjectInventoryFileRole>(["repository", "db-schema", "store"]);
const SUPPORT_EDGE_PRIORITY = new Map<string, number>([
  ["test-target", 9_000],
  ["proposed-test", 8_500],
  ["service-import", 8_000],
  ["utility-import", 7_800],
  ["storage-import", 7_500],
  ["types-import", 7_200],
  ["client-api-import", 7_000],
  ["hook-import", 6_500],
  ["component-import", 6_000],
  ["style-import", 5_500],
  ["route-local", 5_000],
  ["import", 4_000],
  ["imported-by", 3_500],
]);

function normalize(value: string) {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

function stem(pathValue: string) {
  const fileName = normalize(pathValue).split("/").pop() ?? "";
  return fileName.replace(/\.(?:tsx|jsx|ts|js|mjs|cjs|css|scss|sass|less|json|md|mdx)$/i, "");
}

function effectiveRole(candidate: RetrievedCandidate): ProjectInventoryFileRole {
  const pathValue = normalize(candidate.path);
  const fileStem = stem(candidate.path);
  const role = candidate.file.role;

  if (/(?:^|\/)pages\//.test(pathValue) || /(?:^|\/)page\.(?:tsx|jsx|ts|js)$/.test(pathValue)) return "page";
  if (/(?:^|\/)components\/ui\//.test(pathValue)) return "ui-component";
  if (/(?:^|\/)components\//.test(pathValue)) return "component";
  if (/(?:^|\/)(?:layout|template)\.(?:tsx|jsx|ts|js)$/.test(pathValue)) return "layout";
  if (/(?:^|\/)types?\//.test(pathValue) || /(?:^|[.-])types?$/.test(fileStem)) return "types";
  if (/(?:^|\/)(?:utils|utilities|helpers|lib)\//.test(pathValue)) {
    if (/(?:api|client)$/.test(fileStem)) return "client-api";
    return "utility";
  }
  if (/(?:^|\/)services?\//.test(pathValue)) {
    if (/(?:^|\/)(?:web|client|frontend|renderer)\//.test(pathValue)) return "client-api";
    return "service";
  }
  if (/^(?:robots|sitemap|manifest|middleware)$/.test(fileStem)) return "config";
  if (
    (pathValue.startsWith("server/") || pathValue.includes("/server/")) &&
    /^(?:auth|session|queue|worker|processor|provider|manager|ai)$/.test(fileStem)
  ) return "service";
  if (
    /(?:^|\/)(?:db|database|storage|repositories?|persistence)(?:\/|$)/.test(pathValue) &&
    /(?:quer(?:y|ies)|repository|database|storage|schema|model|adapter)/.test(fileStem)
  ) return "repository";
  return role;
}

function isSourceLike(candidate: RetrievedCandidate) {
  return ["source", "style", "test"].includes(candidate.file.kind);
}

function isFrontend(candidate: RetrievedCandidate) {
  return isSourceLike(candidate) && FRONTEND_ROLES.has(effectiveRole(candidate));
}

function isBackend(candidate: RetrievedCandidate) {
  return isSourceLike(candidate) && BACKEND_ROLES.has(effectiveRole(candidate));
}

function isAreaCompatibleAnchor(candidate: RetrievedCandidate, retrieval: CandidateRetrievalResult) {
  const role = effectiveRole(candidate);
  if (retrieval.implementationArea === "ui") return isFrontend(candidate);
  if (retrieval.implementationArea === "backend") return isBackend(candidate);
  if (retrieval.implementationArea === "fullstack") return isFrontend(candidate) || isBackend(candidate);
  if (retrieval.implementationArea === "tests") return isTest(candidate);
  if (retrieval.implementationArea === "docs") return isDocs(candidate);
  if (retrieval.implementationArea === "build") return isConfig(candidate) || ["app-entry", "server-entry", "layout"].includes(role);
  if (retrieval.implementationArea === "bugfix" || retrieval.implementationArea === "refactor") return isSourceLike(candidate);
  return isSourceLike(candidate);
}

function isTest(candidate: RetrievedCandidate) {
  return candidate.file.kind === "test" || effectiveRole(candidate) === "test";
}

function isDocs(candidate: RetrievedCandidate) {
  return candidate.file.kind === "docs" || effectiveRole(candidate) === "docs";
}

function isConfig(candidate: RetrievedCandidate) {
  return candidate.file.kind === "config" || effectiveRole(candidate) === "config";
}

function parentDirectory(pathValue: string) {
  const normalized = normalize(pathValue);
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(0, index) : "";
}

function workspaceRoot(pathValue: string) {
  const parts = normalize(pathValue).split("/").filter(Boolean);
  const srcIndex = parts.indexOf("src");
  if (srcIndex > 0) return parts.slice(0, srcIndex).join("/");
  if (parts[0] === "apps" || parts[0] === "packages") return parts.slice(0, 2).join("/");
  return parts.length > 1 ? parts[0] : "";
}

function graphPriority(candidate: RetrievedCandidate, anchorPaths: Set<string>) {
  let best = 0;
  for (const relationship of candidate.graphRelationships) {
    if (!anchorPaths.has(normalize(relationship.relatedPath))) continue;
    best = Math.max(best, SUPPORT_EDGE_PRIORITY.get(relationship.kind) ?? 3_000);
  }
  return best;
}

function pathAffinity(candidate: RetrievedCandidate, anchorPaths: Set<string>) {
  const candidatePath = normalize(candidate.path);
  const directory = parentDirectory(candidate.path);
  const workspace = workspaceRoot(candidate.path);
  let best = 0;
  for (const anchorPath of anchorPaths) {
    if (directory && directory === parentDirectory(anchorPath)) best = Math.max(best, 3_000);
    if (workspace && workspace === workspaceRoot(anchorPath)) best = Math.max(best, 1_500);
    const left = candidatePath.split("/");
    const right = normalize(anchorPath).split("/");
    let shared = 0;
    while (shared < left.length && shared < right.length && left[shared] === right[shared]) shared += 1;
    best = Math.max(best, shared * 250);
  }
  return best;
}

function roleFit(candidate: RetrievedCandidate, retrieval: CandidateRetrievalResult) {
  const role = effectiveRole(candidate);
  const area = retrieval.implementationArea;
  if (area === "ui") return FRONTEND_ROLES.has(role) ? 5_000 : role === "types" || role === "utility" ? 2_500 : -2_000;
  if (area === "backend") return BACKEND_ROLES.has(role) ? 5_000 : FRONTEND_ROLES.has(role) ? -2_500 : 0;
  if (area === "fullstack") return FRONTEND_ROLES.has(role) || BACKEND_ROLES.has(role) ? 4_500 : 0;
  if (area === "tests") return isTest(candidate) ? 6_000 : 2_000;
  if (area === "docs") return isDocs(candidate) ? 6_000 : isConfig(candidate) ? 3_500 : 1_000;
  if (area === "build") return isConfig(candidate) ? 6_000 : role === "app-entry" || role === "server-entry" || candidate.file.kind === "source" ? 2_500 : 0;
  if (area === "bugfix" || area === "refactor") return candidate.file.kind === "source" ? 4_000 : 0;
  return 0;
}

function anchorPriority(candidate: RetrievedCandidate, retrieval: CandidateRetrievalResult) {
  const role = effectiveRole(candidate);
  const signals = taskSignals(retrieval.rawTask);
  const identity = candidate.filenameMatchCount * 30_000 + candidate.identityMatchCount * 12_000;
  const exact = Number(candidate.explicit) * 1_000_000;
  const intent = Number(candidate.roleIntentMatch) * 18_000;
  const primary = Number(candidate.proposedTechnicalRole === "primary") * 8_000;
  const directTaskMention = taskMentionPriority(candidate, retrieval.rawTask);
  const symbolTaskMention = symbolTaskMentionPriority(candidate, retrieval.rawTask);
  const graphOnlyPenalty = candidate.identityMatchCount === 0 && candidate.filenameMatchCount === 0 && !candidate.explicit
    ? -4_000
    : 0;
  const broadPagePenalty = role === "page" && candidate.identityMatchCount === 0 && candidate.filenameMatchCount === 0
    ? -8_000
    : 0;
  const typeAnchorPenalty =
    (retrieval.implementationArea === "refactor" || retrieval.implementationArea === "bugfix") &&
    role === "types" &&
    !signals.types &&
    !candidate.explicit
      ? -42_000
      : 0;
  const genericEntryPenalty =
    (retrieval.implementationArea === "refactor" || retrieval.implementationArea === "bugfix") &&
    role === "app-entry" &&
    candidate.filenameMatchCount === 0 &&
    !candidate.explicit
      ? -14_000
      : 0;
  const refactorUtilityBonus =
    (retrieval.implementationArea === "refactor" || retrieval.implementationArea === "bugfix") &&
    role === "utility"
      ? 14_000
      : 0;
  const buildConfigBonus = retrieval.implementationArea === "build" && isConfig(candidate) ? 25_000 : 0;
  return exact + identity + intent + primary + directTaskMention + symbolTaskMention + roleFit(candidate, retrieval) +
    graphOnlyPenalty + broadPagePenalty + typeAnchorPenalty + genericEntryPenalty +
    refactorUtilityBonus + buildConfigBonus + candidate.score;
}

function strongIdentity(candidate: RetrievedCandidate) {
  return candidate.explicit || candidate.filenameMatchCount > 0 || candidate.identityMatchCount > 0 || candidate.roleIntentMatch;
}

function taskMentionPriority(candidate: RetrievedCandidate, rawTask: string) {
  const task = normalize(rawTask);
  if (stem(candidate.path) === "app" && /\bApp\b/.test(rawTask)) return 45_000;
  const identityParts = stem(candidate.path)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^a-z0-9]+/i)
    .filter((part) => part.length >= 4)
    .filter((part) => !["controller", "service", "component", "route", "page", "index"].includes(part));
  let earliest = Number.POSITIVE_INFINITY;
  for (const part of identityParts) {
    const index = task.indexOf(part.toLowerCase());
    if (index >= 0) earliest = Math.min(earliest, index);
  }
  if (!Number.isFinite(earliest)) return 0;
  return Math.max(4_000, 30_000 - earliest * 100);
}

function symbolTaskMentionPriority(candidate: RetrievedCandidate, rawTask: string) {
  const compactTask = rawTask.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  let best = 0;
  for (const value of [...(candidate.file.exports ?? []), ...(candidate.file.symbols ?? [])]) {
    const compact = value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    if (compact.length < 5 || !compactTask.includes(compact)) continue;
    best = Math.max(best, compact.length >= 9 ? 55_000 : 28_000);
  }
  return best;
}

function fileNameTokens(candidate: RetrievedCandidate) {
  return candidate.file.name
    .replace(/\.[^.]+$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4)
    .filter((token) => !["page", "component", "controller", "service", "route", "types"].includes(token));
}

function semanticNameAffinity(candidate: RetrievedCandidate, anchorCandidates: RetrievedCandidate[]) {
  const candidateTokens = fileNameTokens(candidate);
  let best = 0;
  for (const anchor of anchorCandidates) {
    const anchorTokens = fileNameTokens(anchor);
    for (const left of candidateTokens) {
      for (const right of anchorTokens) {
        if (left === right) best = Math.max(best, 7_000);
        else if (left.startsWith(right) || right.startsWith(left)) best = Math.max(best, 4_500);
      }
    }
  }
  return best;
}

const GENERIC_PRESENTATION_TOKENS = new Set([
  "card", "cards", "empty", "state", "states", "screen", "screens", "narrow",
  "responsive", "mobile", "desktop", "page", "component", "components", "layout",
  "style", "styles", "display", "data", "shared", "common", "feedback", "block", "blocks",
  "improve", "update", "change", "behavior", "behaviour", "visual", "view",
]);

function normalizedIdentityTokens(values: string[]) {
  return values
    .flatMap((value) => value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/))
    .filter((token) => token.length >= 4 && !GENERIC_PRESENTATION_TOKENS.has(token));
}

function taskDomainSupportPriority(candidate: RetrievedCandidate, rawTask: string) {
  const task = normalize(rawTask);
  const fileTokens = normalizedIdentityTokens([candidate.file.name]);
  const symbolTokens = normalizedIdentityTokens([...(candidate.file.exports ?? []), ...(candidate.file.symbols ?? [])]);
  let priority = 0;
  for (const token of fileTokens) {
    if (task.includes(token)) priority = Math.max(priority, 18_000 + Math.min(8_000, token.length * 500));
  }
  for (const token of symbolTokens) {
    if (task.includes(token)) priority = Math.max(priority, 12_000 + Math.min(7_000, token.length * 400));
  }
  return priority;
}

function relocationRefactorTask(rawTask: string) {
  return /\b(?:move|extract|split|deduplicate|centralize)\b|(?:вынес|перенес|раздел|убер[иь].*дублир|дублирующ)/iu.test(rawTask);
}

function buildAnchorPriority(candidate: RetrievedCandidate, retrieval: CandidateRetrievalResult) {
  const name = candidate.file.name.toLowerCase();
  const pathValue = normalize(candidate.path);
  const task = normalize(retrieval.rawTask);
  let priority = anchorPriority(candidate, retrieval);
  if (/^(?:vite|next|webpack|rollup|tsconfig|eslint|postcss|tailwind|robots|sitemap)/.test(name)) priority += 18_000;
  if (name === "package.json") priority += pathValue.split("/").length <= 2 ? 12_000 : 5_000;
  if (/(?:lock|lockb)$/.test(name)) priority -= 30_000;
  const nameTokens = name.split(/[^a-z0-9]+/).filter((token) => token.length >= 3);
  if (nameTokens.some((token) => task.includes(token))) priority += 12_000;
  return priority;
}

function configMatchesBuildTask(candidate: RetrievedCandidate, rawTask: string) {
  const task = normalize(rawTask);
  const name = candidate.file.name.toLowerCase();
  const pathValue = normalize(candidate.path);
  const stemValue = stem(candidate.path);
  if (stemValue.length >= 4 && task.includes(stemValue)) return true;
  if (/^(?:robots|sitemap)/.test(name) && /\b(?:robots|sitemap|seo)\b|(?:робот|карта сайта|сео)/iu.test(task)) return true;
  if (/^(?:vite|webpack|rollup)/.test(name) && /\b(?:web|bundle|frontend|client|vite|webpack|rollup)\b|(?:веб|бандл|фронтенд|клиент)/iu.test(task)) return true;
  if (/tsconfig/.test(name) && /\b(?:typescript|type script|server|web|build)\b|(?:тайпскрипт|сервер|сборк)/iu.test(task)) return true;
  if (/^next\.config/.test(name) && /\b(?:next|deploy|production|seo|base url)\b|(?:деплой|продакш|сео|базов.*url)/iu.test(task)) return true;
  if (name === "package.json" && /\b(?:build|production|scripts?|run commands?|workspace|monorepo)\b|(?:сборк|продакш|скрипт|команд|монореп)/iu.test(task)) {
    return pathValue.split("/").length <= 2;
  }
  if (/^(?:eslint|postcss|tailwind)/.test(name)) {
    const topic = name.split(/[.-]/)[0];
    return task.includes(topic) ||
      (topic === "postcss" && /\bcss\b|стил/iu.test(task)) ||
      (topic === "tailwind" && /\btailwind\b/iu.test(task)) ||
      (topic === "eslint" && /\b(?:lint|eslint)\b|линт/iu.test(task));
  }
  return false;
}

function chooseAnchors(
  grounded: RetrievedCandidate[],
  retrieval: CandidateRetrievalResult,
) {
  const sorted = [...grounded]
    .filter((candidate) => isAreaCompatibleAnchor(candidate, retrieval))
    .sort((a, b) =>
      anchorPriority(b, retrieval) - anchorPriority(a, retrieval) ||
      b.score - a.score ||
      a.path.localeCompare(b.path),
    );
  const strong = sorted.filter((candidate) =>
    candidate.explicit || candidate.proposedTechnicalRole === "primary" || strongIdentity(candidate),
  );

  if (retrieval.reviewOnly) {
    return strong.slice(0, Math.min(3, strong.length));
  }
  if (retrieval.implementationArea === "tests") {
    const tests = strong.filter(isTest);
    return tests.slice(0, Math.max(1, Math.min(2, tests.filter((candidate) => candidate.explicit).length || 1)));
  }
  if (retrieval.implementationArea === "fullstack") {
    const backendCandidates = strong.filter(isBackend);
    const backendEntries = backendCandidates.filter((candidate) => BACKEND_ENTRY_ROLES.has(effectiveRole(candidate)));
    const backendDomain = backendCandidates.find((candidate) => !BACKEND_ENTRY_ROLES.has(effectiveRole(candidate)));
    const exactEntries = backendEntries.filter((candidate) =>
      candidate.explicit || candidate.filenameMatchCount > 0 || candidate.identityMatchCount > 0 || taskMentionPriority(candidate, retrieval.rawTask) > 0,
    );
    const serverEntries = backendEntries.filter((candidate) => effectiveRole(candidate) === "server-entry");
    const entryPool = exactEntries.length > 0 ? exactEntries : serverEntries.length > 0 ? serverEntries : backendEntries;
    const persistencePaths = new Set(
      sorted
        .filter((candidate) => PERSISTENCE_ROLES.has(effectiveRole(candidate)))
        .map((candidate) => normalize(candidate.path)),
    );
    const entry = [...entryPool]
      .sort((a, b) =>
        pathAffinity(b, persistencePaths) - pathAffinity(a, persistencePaths) ||
        anchorPriority(b, retrieval) - anchorPriority(a, retrieval) ||
        graphPriority(b, new Set(backendDomain ? [normalize(backendDomain.path)] : [])) -
        graphPriority(a, new Set(backendDomain ? [normalize(backendDomain.path)] : [])) ||
        a.path.localeCompare(b.path),
      )[0];
    const signals = taskSignals(retrieval.rawTask);
    const frontend = strong.filter(isFrontend);
    const stronglyGroundedFrontend = frontend.filter((candidate) =>
      candidate.explicit ||
      candidate.filenameMatchCount >= 2 ||
      candidate.identityMatchCount >= 2 ||
      symbolTaskMentionPriority(candidate, retrieval.rawTask) > 0 ||
      candidate.graphRelationships.length > 0,
    );
    const clientBoundary = frontend.find((candidate) =>
      ["client-api", "hook"].includes(effectiveRole(candidate)) && candidate.roleIntentMatch,
    );
    const frontendAnchor = stronglyGroundedFrontend[0] ??
      ((signals.endpoint || signals.dataFlow) ? clientBoundary : undefined) ??
      frontend[0];
    const anchors = [entry ?? backendDomain ?? backendCandidates[0], frontendAnchor]
      .filter((candidate): candidate is RetrievedCandidate => Boolean(candidate));
    const secondFrontend = frontend.find((candidate) =>
      !anchors.some((anchor) => anchor.candidateId === candidate.candidateId) &&
      candidate.proposedTechnicalRole === "primary" &&
      (candidate.explicit || candidate.filenameMatchCount >= 2 || candidate.identityMatchCount >= 2 || candidate.graphRelationships.length > 0),
    );
    if (secondFrontend) anchors.push(secondFrontend);
    return anchors;
  }
  if (retrieval.implementationArea === "ui") {
    const frontend = strong.filter(isFrontend);
    return frontend.slice(0, 1);
  }
  if (retrieval.implementationArea === "backend") {
    const signals = taskSignals(retrieval.rawTask);
    const backend = strong.filter(isBackend).filter((candidate) => signals.types || effectiveRole(candidate) !== "types");
    const domain = backend.find((candidate) => !BACKEND_ENTRY_ROLES.has(effectiveRole(candidate)));
    const entries = backend.filter((candidate) => BACKEND_ENTRY_ROLES.has(effectiveRole(candidate)));
    if (signals.endpoint && entries.length > 0) {
      const domainPaths = new Set(domain ? [normalize(domain.path)] : []);
      const exactEntries = entries.filter((candidate) =>
        candidate.explicit || candidate.filenameMatchCount > 0 || candidate.identityMatchCount > 0 || taskMentionPriority(candidate, retrieval.rawTask) > 0,
      );
      const entryPool = exactEntries.length > 0 ? exactEntries : entries;
      const entry = [...entryPool].sort((a, b) =>
        anchorPriority(b, retrieval) - anchorPriority(a, retrieval) ||
        graphPriority(b, domainPaths) - graphPriority(a, domainPaths) ||
        semanticNameAffinity(b, domain ? [domain] : []) - semanticNameAffinity(a, domain ? [domain] : []) ||
        a.path.localeCompare(b.path),
      )[0];
      return [entry].filter((candidate): candidate is RetrievedCandidate => Boolean(candidate));
    }
    return backend.slice(0, 1);
  }
  if (retrieval.implementationArea === "docs") {
    const docs = strong.filter(isDocs);
    return docs.slice(0, 1);
  }
  if (retrieval.implementationArea === "build") {
    const configs = sorted
      .filter(isConfig)
      .sort((a, b) =>
        buildAnchorPriority(b, retrieval) - buildAnchorPriority(a, retrieval) ||
        a.path.localeCompare(b.path),
      );
    const matching = configs.filter((candidate) => configMatchesBuildTask(candidate, retrieval.rawTask));
    if (matching.length > 0) return matching.slice(0, 3);
    if (configs.length > 0) return configs.slice(0, 1);
    return strong.filter((candidate) => candidate.file.kind === "source").slice(0, 1);
  }
  if (retrieval.implementationArea === "bugfix" || retrieval.implementationArea === "refactor") {
    const source = strong.filter((candidate) => candidate.file.kind === "source" && effectiveRole(candidate) !== "types");
    return source.slice(0, relocationRefactorTask(retrieval.rawTask) ? 2 : 1);
  }
  return strong.slice(0, 1);
}

function taskSignals(rawTask: string) {
  const text = normalize(rawTask);
  return {
    storage: /\b(?:database|storage|repository|schema|sqlite|prisma|query|queries|db)\b|(?:баз[аеуы]|хранилищ|репозитор|схем|запрос)/iu.test(text),
    types: /\b(?:types?|interfaces?|contract|payload|dto)\b|(?:тип(?:ы)?|интерфейс(?:ы)?|контракт|пейлоад)/iu.test(text),
    tests: /\btests?\b|(?:тест(?:ы)?|проверки)/iu.test(text),
    config: /\b(?:config|build|deploy|environment|env|sitemap|robots|vite|tsconfig)\b|(?:конфиг|сборк|деплой|окружен|карта сайта|робот)/iu.test(text),
    docs: /\b(?:readme|docs?|documentation)\b|(?:ридми|документац)/iu.test(text),
    formula: /\b(?:formula|calculation|calculate|calculator)\b|(?:формул|расч[её]т)/iu.test(text),
    input: /\b(?:input|field|form|value|validation|invalid|zero|negative)\b|(?:пол[ея]|форм[аеуы]|значен|валидац|нулев|отриц)/iu.test(text),
    appearance: /\b(?:appearance|style|theme|visual|backdrop|density)\b|(?:внешн(?:ий|его) вид|оформлен|стил|тем[аеуы]|фон|плотност)/iu.test(text),
    responsive: /\b(?:responsive|breakpoint|mobile|adaptive)\b|(?:адаптив|брейкпоинт|мобил)/iu.test(text),
    navigation: /\b(?:navigation|navbar|header|menu|focus|active state)\b|(?:навигац|меню|фокус|активн)/iu.test(text),
    endpoint: /\b(?:endpoint|route|router|handler|api method)\b|(?:эндпоинт|роут|маршрут|обработчик)/iu.test(text),
    interaction: /\b(?:ux|interaction|control|button|dropdown|select|input|form|keyboard|focus)\b|(?:ux|взаимодейств|контрол|кноп|дропдаун|селект|поле|форм|клавиатур|фокус)/iu.test(text),
    dataFlow: /\b(?:load|loading|fetch|request|response|retry|error state|empty state|async)\b|(?:загруз|получен|запрос|ответ|повтор|ошибк|пуст(?:ое|ого) состоян|асинхрон)/iu.test(text),
    security: /\b(?:auth|authentication|authorization|token|session|credential|permission|expiry|expiration)\b|(?:авторизац|аутентификац|токен|сесси|уч[её]тн|разрешен|истечен|срок действия)/iu.test(text),
  };
}

function isSecurityConfigurationSupport(
  candidate: RetrievedCandidate,
  anchors: RetrievedCandidate[],
  retrieval: CandidateRetrievalResult,
) {
  if (!taskSignals(retrieval.rawTask).security || !isConfig(candidate)) return false;
  const candidateDirectory = parentDirectory(candidate.path);
  const candidateWorkspace = workspaceRoot(candidate.path);
  return anchors.some((anchor) =>
    (candidateDirectory.length > 0 && candidateDirectory === parentDirectory(anchor.path)) ||
    (candidateWorkspace.length > 0 && candidateWorkspace === workspaceRoot(anchor.path)),
  );
}

const STRONG_SUPPORT_EDGE_KINDS = new Set([
  "test-target",
  "proposed-test",
  "service-import",
  "utility-import",
  "storage-import",
  "types-import",
  "client-api-import",
  "hook-import",
  "component-import",
  "style-import",
  "route-local",
  "import",
]);

function supportBudgetForTask(retrieval: CandidateRetrievalResult, anchorCount: number) {
  const signals = taskSignals(retrieval.rawTask);
  let supportBudget = 2;

  if (retrieval.implementationArea === "fullstack") supportBudget = 4;
  else if (retrieval.implementationArea === "backend") supportBudget = 4;
  else if (retrieval.implementationArea === "tests") supportBudget = 4;
  else if (retrieval.implementationArea === "docs") supportBudget = 4;
  else if (retrieval.implementationArea === "build") supportBudget = 3;
  else if (retrieval.implementationArea === "bugfix" || retrieval.implementationArea === "refactor") supportBudget = 3;

  if (
    retrieval.implementationArea === "ui" &&
    (signals.navigation || signals.input || signals.appearance || signals.responsive || signals.dataFlow)
  ) {
    supportBudget = 3;
  }

  if (retrieval.reviewOnly) supportBudget = Math.min(supportBudget, 3);
  return Math.max(anchorCount, anchorCount + supportBudget);
}

function supportEvidenceScore(
  candidate: RetrievedCandidate,
  anchors: RetrievedCandidate[],
  retrieval: CandidateRetrievalResult,
) {
  const anchorPaths = new Set(anchors.map((anchor) => normalize(anchor.path)));
  const relationships = candidate.graphRelationships.filter((relationship) =>
    anchorPaths.has(normalize(relationship.relatedPath)),
  );
  const signals = taskSignals(retrieval.rawTask);
  const role = effectiveRole(candidate);
  let score = 0;

  if (candidate.explicit) score += 100;
  if (candidate.filenameMatchCount > 0) score += 32;
  if (candidate.identityMatchCount > 0) score += Math.min(30, candidate.identityMatchCount * 12);
  if (candidate.roleIntentMatch) score += 25;
  if (taskMentionPriority(candidate, retrieval.rawTask) > 0) score += 45;
  if (symbolTaskMentionPriority(candidate, retrieval.rawTask) > 0) score += 55;
  if (taskDomainSupportPriority(candidate, retrieval.rawTask) > 0) score += 35;
  if (semanticNameAffinity(candidate, anchors) > 0) score += 28;
  if (relationships.some((relationship) => STRONG_SUPPORT_EDGE_KINDS.has(relationship.kind))) score += 100;
  else if (relationships.length > 0) score += 12;

  if (retrieval.implementationArea === "docs" && (isConfig(candidate) || isDocs(candidate))) score += 35;
  if (retrieval.implementationArea === "build" && isConfig(candidate)) score += 35;
  if (retrieval.implementationArea === "tests" && candidate.file.name.toLowerCase() === "package.json") score += 25;
  if (signals.types && role === "types") score += 25;
  if (signals.storage && PERSISTENCE_ROLES.has(role)) score += 25;
  if (signals.endpoint && BACKEND_ENTRY_ROLES.has(role)) score += 25;
  if ((retrieval.implementationArea === "backend" || retrieval.implementationArea === "fullstack") && role === "server-entry") score += 48;
  if (retrieval.implementationArea === "fullstack" && role === "client-api") score += 90;
  if ((retrieval.implementationArea === "backend" || retrieval.implementationArea === "fullstack") && PERSISTENCE_ROLES.has(role)) score += 48;
  if (signals.dataFlow && (role === "hook" || role === "client-api" || role === "service" || role === "api-route")) score += 22;
  if ((signals.appearance || signals.responsive) && role === "style") score += 30;
  if (signals.input && (role === "component" || role === "ui-component")) score += 20;
  if (signals.navigation && (role === "layout" || role === "component" || role === "ui-component")) score += 48;
  if (isSecurityConfigurationSupport(candidate, anchors, retrieval)) score += 48;

  const importedByOnly = relationships.length > 0 && relationships.every((relationship) => relationship.kind === "imported-by");
  const importedBySupportsTask = signals.navigation && role === "layout";
  if (importedByOnly && !importedBySupportsTask && semanticNameAffinity(candidate, anchors) === 0 && taskDomainSupportPriority(candidate, retrieval.rawTask) === 0) {
    score -= 35;
  }
  if (role === "page" && relationships.length === 0 && !candidate.explicit) {
    score -= candidate.filenameMatchCount > 0 || candidate.identityMatchCount > 0 ? 55 : 100;
  }
  if (
    retrieval.implementationArea === "ui" &&
    BACKEND_ROLES.has(role) &&
    relationships.length === 0 &&
    !candidate.explicit
  ) {
    score -= 100;
  }
  const migrationPattern = /\b(?:migrate|migration|migrations)\b|(?:миграц)/iu;
  if (migrationPattern.test(normalize(candidate.path)) && !migrationPattern.test(normalize(retrieval.rawTask))) {
    score -= 80;
  }
  return score;
}

function hasAnchorNeighborhoodRelationship(
  candidate: RetrievedCandidate,
  anchors: RetrievedCandidate[],
) {
  const candidatePath = normalize(candidate.path);
  const anchorPaths = new Set(anchors.map((anchor) => normalize(anchor.path)));
  const anchorRelatedPaths = new Set(
    anchors.flatMap((anchor) => anchor.graphRelationships.map((relationship) =>
      normalize(relationship.relatedPath),
    )),
  );

  if (anchorRelatedPaths.has(candidatePath)) return true;
  return candidate.graphRelationships.some((relationship) => {
    const relatedPath = normalize(relationship.relatedPath);
    return (
      anchorPaths.has(relatedPath) ||
      anchorRelatedPaths.has(relatedPath)
    ) && STRONG_SUPPORT_EDGE_KINDS.has(relationship.kind);
  });
}

function isRetentionAreaCompatible(
  candidate: RetrievedCandidate,
  anchors: RetrievedCandidate[],
  retrieval: CandidateRetrievalResult,
) {
  const role = effectiveRole(candidate);
  const signals = taskSignals(retrieval.rawTask);
  if (retrieval.implementationArea === "ui") {
    return isFrontend(candidate) || ["types", "store", "utility"].includes(role);
  }
  if (retrieval.implementationArea === "backend") {
    return isBackend(candidate) ||
      (signals.endpoint && role === "client-api") ||
      isSecurityConfigurationSupport(candidate, anchors, retrieval);
  }
  if (retrieval.implementationArea === "fullstack") {
    return isFrontend(candidate) || isBackend(candidate) || role === "types" ||
      isSecurityConfigurationSupport(candidate, anchors, retrieval);
  }
  if (retrieval.implementationArea === "tests") return isTest(candidate) || isSourceLike(candidate);
  if (retrieval.implementationArea === "docs") return isDocs(candidate) || isConfig(candidate) || isSourceLike(candidate);
  if (retrieval.implementationArea === "build") {
    return isConfig(candidate) || ["layout", "app-entry", "server-entry"].includes(role);
  }
  if (retrieval.implementationArea === "bugfix" || retrieval.implementationArea === "refactor") {
    return candidate.file.kind === "source" || candidate.file.kind === "style";
  }
  return isSourceLike(candidate);
}

function taskRoleRetentionPriority(
  candidate: RetrievedCandidate,
  retrieval: CandidateRetrievalResult,
  anchors: RetrievedCandidate[] = [],
) {
  const role = effectiveRole(candidate);
  const signals = taskSignals(retrieval.rawTask);
  let priority = 0;

  if (
    retrieval.implementationArea === "fullstack" &&
    (role === "client-api" || PERSISTENCE_ROLES.has(role))
  ) {
    priority = Math.max(priority, 8_500);
  }

  if (
    retrieval.implementationArea === "backend" &&
    signals.endpoint &&
    role === "client-api"
  ) {
    priority = Math.max(priority, 8_000);
  }

  if (retrieval.implementationArea === "ui") {
    if (
      (signals.interaction || signals.input) &&
      ["component", "ui-component"].includes(role) &&
      /(?:button|dropdown|select|input|field|slider|form|card|control)/i.test(candidate.file.name)
    ) {
      priority = Math.max(priority, 8_500);
    }
    if (
      signals.dataFlow &&
      ["hook", "client-api", "store", "types"].includes(role)
    ) {
      priority = Math.max(priority, 8_000);
    }
  }

  if (retrieval.implementationArea === "bugfix" || retrieval.implementationArea === "refactor") {
    if ((signals.appearance || signals.responsive) && role === "style") {
      priority = Math.max(priority, 8_500);
    }
    if (
      signals.input &&
      ["component", "ui-component"].includes(role) &&
      /(?:input|field|slider|select|form|card)/i.test(candidate.file.name)
    ) {
      priority = Math.max(priority, 8_500);
    }
  }

  if (isSecurityConfigurationSupport(candidate, anchors, retrieval)) {
    priority = Math.max(priority, 9_000);
  }

  return priority;
}

function supportRetentionPriority(
  candidate: RetrievedCandidate,
  anchors: RetrievedCandidate[],
  retrieval: CandidateRetrievalResult,
) {
  const anchorPaths = new Set(anchors.map((anchor) => normalize(anchor.path)));
  const directAnchorRelationship = candidate.graphRelationships.some((relationship) =>
    anchorPaths.has(normalize(relationship.relatedPath)) &&
    STRONG_SUPPORT_EDGE_KINDS.has(relationship.kind),
  );
  const directTaskPriority = Math.max(
    taskMentionPriority(candidate, retrieval.rawTask),
    symbolTaskMentionPriority(candidate, retrieval.rawTask),
    taskDomainSupportPriority(candidate, retrieval.rawTask),
  );
  const rolePriority = taskRoleRetentionPriority(candidate, retrieval, anchors);

  return (
    Number(candidate.explicit) * 100_000 +
    Number(directTaskPriority > 0) * 90_000 +
    rolePriority * 8 +
    Number(directAnchorRelationship) * 65_000 +
    Number(hasAnchorNeighborhoodRelationship(candidate, anchors)) * 42_000 +
    candidate.filenameMatchCount * 8_000 +
    candidate.identityMatchCount * 3_000 +
    Number(candidate.roleIntentMatch) * 4_000 +
    candidate.score
  );
}

function shouldRetainSupportCandidate(
  candidate: RetrievedCandidate,
  anchors: RetrievedCandidate[],
  retrieval: CandidateRetrievalResult,
  evidenceScore: number,
) {
  if (candidate.explicit) return true;
  if (!isRetentionAreaCompatible(candidate, anchors, retrieval)) return false;

  const role = effectiveRole(candidate);
  const directTaskMention =
    taskMentionPriority(candidate, retrieval.rawTask) > 0 ||
    symbolTaskMentionPriority(candidate, retrieval.rawTask) > 0 ||
    taskDomainSupportPriority(candidate, retrieval.rawTask) > 0;
  const anchorPaths = new Set(anchors.map((anchor) => normalize(anchor.path)));
  const directAnchorRelationship = candidate.graphRelationships.some((relationship) =>
    anchorPaths.has(normalize(relationship.relatedPath)) &&
    STRONG_SUPPORT_EDGE_KINDS.has(relationship.kind),
  );

  if (role === "page" && !directTaskMention && !directAnchorRelationship) {
    return evidenceScore >= 52;
  }
  if (directTaskMention) return true;
  if (taskRoleRetentionPriority(candidate, retrieval, anchors) > 0) return true;
  if (
    retrieval.implementationArea === "ui" &&
    (role === "store" || role === "types") &&
    (
      hasAnchorNeighborhoodRelationship(candidate, anchors) ||
      semanticNameAffinity(candidate, anchors) > 0
    )
  ) {
    return true;
  }
  if (directAnchorRelationship || hasAnchorNeighborhoodRelationship(candidate, anchors)) return true;

  const topAnchorScore = Math.max(1, ...anchors.map((anchor) => anchor.score));
  const relativeCandidateFloor = Math.max(72, topAnchorScore * 0.42);
  return evidenceScore >= 32 || candidate.score >= relativeCandidateFloor;
}

function pruneWeakSupportCandidates(
  candidates: RetrievedCandidate[],
  anchors: RetrievedCandidate[],
  retrieval: CandidateRetrievalResult,
  selectionLimit: number,
) {
  if (candidates.length <= anchors.length) return candidates;
  const anchorIds = new Set(anchors.map((candidate) => candidate.candidateId));
  const softLimit = Math.min(
    selectionLimit,
    supportBudgetForTask(retrieval, anchors.length),
  );
  const availableSupportSlots = Math.max(0, selectionLimit - anchors.length);
  const softSupportSlots = Math.max(0, softLimit - anchors.length);
  const protectedSupportLimit = Math.min(
    availableSupportSlots,
    softSupportSlots + 2,
  );
  const anchorPaths = new Set(anchors.map((anchor) => normalize(anchor.path)));
  const rows = candidates
    .filter((candidate) => !anchorIds.has(candidate.candidateId))
    .map((candidate, originalIndex) => {
      const evidenceScore = supportEvidenceScore(candidate, anchors, retrieval);
      return {
        candidate,
        originalIndex,
        evidenceScore,
        retentionPriority: supportRetentionPriority(candidate, anchors, retrieval),
        protected: shouldRetainSupportCandidate(candidate, anchors, retrieval, evidenceScore),
      };
    });

  const protectedRows = rows
    .filter((row) => row.protected)
    .sort((left, right) =>
      right.retentionPriority - left.retentionPriority ||
      right.evidenceScore - left.evidenceScore ||
      supportPriority(right.candidate, retrieval, anchorPaths) -
        supportPriority(left.candidate, retrieval, anchorPaths) ||
      left.originalIndex - right.originalIndex ||
      left.candidate.path.localeCompare(right.candidate.path),
    )
    .slice(0, protectedSupportLimit);

  const retainedIds = new Set(protectedRows.map((row) => row.candidate.candidateId));
  const optionalSlots = Math.max(0, softSupportSlots - protectedRows.length);
  const optionalRows = rows
    .filter((row) => !retainedIds.has(row.candidate.candidateId))
    .filter((row) => row.evidenceScore >= 32)
    .sort((left, right) =>
      right.evidenceScore - left.evidenceScore ||
      supportPriority(right.candidate, retrieval, anchorPaths) -
        supportPriority(left.candidate, retrieval, anchorPaths) ||
      left.originalIndex - right.originalIndex ||
      left.candidate.path.localeCompare(right.candidate.path),
    )
    .slice(0, optionalSlots);

  const selectedIds = new Set([
    ...protectedRows.map((row) => row.candidate.candidateId),
    ...optionalRows.map((row) => row.candidate.candidateId),
  ]);
  const retainedSupports = rows
    .filter((row) => selectedIds.has(row.candidate.candidateId))
    .sort((left, right) => left.originalIndex - right.originalIndex)
    .map((row) => row.candidate);

  return [...anchors, ...retainedSupports];
}

function supportRoleBonus(candidate: RetrievedCandidate, retrieval: CandidateRetrievalResult) {
  const role = effectiveRole(candidate);
  const signals = taskSignals(retrieval.rawTask);
  let bonus = 0;
  if (BACKEND_LOGIC_ROLES.has(role)) bonus += 2_500;
  if (PERSISTENCE_ROLES.has(role)) bonus += signals.storage ? 4_000 : 1_200;
  if (role === "types") bonus += signals.types ? 3_500 : 1_800;
  if (role === "client-api") bonus += retrieval.implementationArea === "fullstack" || retrieval.implementationArea === "ui" ? 3_500 : 500;
  if (role === "hook") bonus += retrieval.implementationArea === "ui" ? 2_800 : 0;
  if (role === "layout") bonus += retrieval.implementationArea === "ui" || retrieval.implementationArea === "build" ? 2_300 : 0;
  if (role === "style") bonus += signals.appearance || signals.responsive ? 3_200 : 0;
  if ((role === "component" || role === "ui-component") && signals.input && /(?:input|field|slider|select|form|card)/i.test(candidate.file.name)) bonus += 4_500;
  if (isConfig(candidate)) bonus += signals.config || retrieval.implementationArea === "docs" ? 2_500 : 300;
  if (isTest(candidate)) bonus += signals.tests ? 2_500 : -2_000;
  return bonus;
}

function persistenceResponsibilityPriority(candidate: RetrievedCandidate) {
  const pathValue = normalize(candidate.path);
  if (/(?:^|\/)(?:queries?|repositories?)(?:[./]|$)/.test(pathValue)) return 7_000;
  if (/(?:^|\/)(?:database|storage|schema)(?:[./]|$)/.test(pathValue)) return 2_500;
  if (/(?:^|\/)(?:migrate|migrations?)(?:[./]|$)/.test(pathValue)) return -5_000;
  return 0;
}

function supportPriority(
  candidate: RetrievedCandidate,
  retrieval: CandidateRetrievalResult,
  anchorPaths: Set<string>,
) {
  const relation = graphPriority(candidate, anchorPaths);
  const identity = candidate.filenameMatchCount * 7_000 + candidate.identityMatchCount * 3_000;
  const direct = Number(candidate.explicit) * 100_000;
  const role = supportRoleBonus(candidate, retrieval);
  const path = pathAffinity(candidate, anchorPaths);
  const unrelatedPagePenalty =
    effectiveRole(candidate) === "page" && relation === 0 && candidate.identityMatchCount === 0 && candidate.filenameMatchCount === 0
      ? -10_000
      : 0;
  return direct + relation + identity + role + path + unrelatedPagePenalty + candidate.score;
}

function docsManifestPriority(candidate: RetrievedCandidate, anchorPaths: Set<string>) {
  const name = candidate.file.name.toLowerCase();
  const pathValue = normalize(candidate.path);
  const rootDepth = pathValue.split("/").length;
  let priority = 0;
  if (name === "package.json") priority += rootDepth <= 2 ? 10_000 : 6_000;
  if (/^(?:\.env|env)[._-](?:example|sample|template)$/.test(name)) priority += 12_000;
  if (/^(?:pyproject\.toml|cargo\.toml|go\.mod|pom\.xml|composer\.json|requirements.*\.txt)$/.test(name)) priority += 6_500;
  if (/(?:lock|lockb)$/.test(name)) priority -= 8_000;
  priority += Math.max(0, 3_000 - rootDepth * 300);
  priority += pathAffinity(candidate, anchorPaths);
  return priority;
}

function buildSupportPriority(
  candidate: RetrievedCandidate,
  retrieval: CandidateRetrievalResult,
  anchorPaths: Set<string>,
) {
  const name = candidate.file.name.toLowerCase();
  const pathValue = normalize(candidate.path);
  const task = normalize(retrieval.rawTask);
  let priority = supportPriority(candidate, retrieval, anchorPaths);
  if (/^(?:next|vite|webpack|rollup|tsconfig|eslint|postcss|tailwind|robots|sitemap)/.test(name)) priority += 12_000;
  if (name === "package.json") priority += 8_000;
  if (/^(?:layout|app|main|index)\.(?:tsx|jsx|ts|js|mjs|cjs)$/.test(name)) priority += 6_000;
  if (/(?:lock|lockb)$/.test(name)) priority -= 15_000;
  const depth = pathValue.split("/").length;
  priority += Math.max(0, 3_000 - depth * 250);
  const tokens = name.split(/[^a-z0-9]+/).filter((token) => token.length >= 3);
  if (tokens.some((token) => task.includes(token))) priority += 8_000;
  return priority;
}

function directGraphSupportCandidates(
  retrieval: CandidateRetrievalResult,
  anchors: RetrievedCandidate[],
): RetrievedCandidate[] {
  if (!retrieval.graph || anchors.length === 0) return [];
  const candidateByPath = new Map(
    retrieval.candidates.map((candidate) => [normalize(candidate.path), candidate]),
  );
  const anchorPaths = new Set(anchors.map((candidate) => normalize(candidate.path)));
  const seen = new Set<string>();
  const rows: Array<{ candidate: RetrievedCandidate; edge: SemanticGraphEdge }> = [];
  for (const { file, edge } of retrieval.graph.getSupportFiles(anchors.map((candidate) => candidate.path), {
      includeImportedBy: true,
      includeRouteLocal: true,
      maxPerTarget: 12,
    })) {
    const candidate = candidateByPath.get(normalize(file.path));
    if (!candidate || anchorPaths.has(normalize(candidate.path)) || seen.has(candidate.candidateId)) continue;
    seen.add(candidate.candidateId);
    rows.push({ candidate, edge });
  }

  return rows
    .sort((a, b) => {
      const edgeA = SUPPORT_EDGE_PRIORITY.get(a.edge.kind) ?? 3_000;
      const edgeB = SUPPORT_EDGE_PRIORITY.get(b.edge.kind) ?? 3_000;
      return semanticNameAffinity(b.candidate, anchors) - semanticNameAffinity(a.candidate, anchors) ||
        edgeB - edgeA ||
        supportPriority(b.candidate, retrieval, anchorPaths) - supportPriority(a.candidate, retrieval, anchorPaths) ||
        a.candidate.path.localeCompare(b.candidate.path);
    })
    .map(({ candidate }) => candidate);
}

function addCandidate(
  result: RetrievedCandidate[],
  selectedIds: Set<string>,
  candidate: RetrievedCandidate | undefined,
  limit: number,
) {
  if (!candidate || result.length >= limit || selectedIds.has(candidate.candidateId)) return;
  result.push(candidate);
  selectedIds.add(candidate.candidateId);
}

function addRoleCoverage(
  result: RetrievedCandidate[],
  selectedIds: Set<string>,
  pool: RetrievedCandidate[],
  retrieval: CandidateRetrievalResult,
  anchorPaths: Set<string>,
  limit: number,
) {
  const role = (candidate: RetrievedCandidate) => effectiveRole(candidate);
  const best = (predicate: (candidate: RetrievedCandidate) => boolean) =>
    [...pool]
      .filter((candidate) => !selectedIds.has(candidate.candidateId) && predicate(candidate))
      .sort((a, b) =>
        supportPriority(b, retrieval, anchorPaths) - supportPriority(a, retrieval, anchorPaths) ||
        b.score - a.score ||
        a.path.localeCompare(b.path),
      )[0];
  const sharesAnchorWorkspace = (candidate: RetrievedCandidate) => {
    const candidateWorkspace = workspaceRoot(candidate.path);
    return candidateWorkspace.length > 0 && [...anchorPaths].some((anchorPath) =>
      candidateWorkspace === workspaceRoot(anchorPath),
    );
  };

  if (retrieval.implementationArea === "backend") {
    if (!result.some((candidate) => BACKEND_LOGIC_ROLES.has(role(candidate)))) {
      addCandidate(result, selectedIds, best((candidate) => BACKEND_LOGIC_ROLES.has(role(candidate))), limit);
    }
    if (taskSignals(retrieval.rawTask).storage && !result.some((candidate) => PERSISTENCE_ROLES.has(role(candidate)))) {
      addCandidate(result, selectedIds, best((candidate) => PERSISTENCE_ROLES.has(role(candidate))), limit);
    }
    if (
      result.some((candidate) => PERSISTENCE_ROLES.has(role(candidate))) &&
      !result.some((candidate) => BACKEND_ENTRY_ROLES.has(role(candidate)))
    ) {
      addCandidate(result, selectedIds, best((candidate) => BACKEND_ENTRY_ROLES.has(role(candidate))), limit);
    }
    if (
      taskSignals(retrieval.rawTask).security &&
      !result.some(isConfig)
    ) {
      addCandidate(
        result,
        selectedIds,
        best((candidate) => isConfig(candidate) && sharesAnchorWorkspace(candidate)),
        limit,
      );
    }
  }

  if (retrieval.implementationArea === "fullstack") {
    if (!result.some(isBackend)) addCandidate(result, selectedIds, best(isBackend), limit);
    if (!result.some(isFrontend)) addCandidate(result, selectedIds, best(isFrontend), limit);
    if (!result.some((candidate) => role(candidate) === "client-api")) {
      addCandidate(result, selectedIds, best((candidate) => role(candidate) === "client-api"), limit);
    }
    if (!result.some((candidate) => role(candidate) === "types")) {
      const typeCandidate = [...pool]
        .filter((candidate) => !selectedIds.has(candidate.candidateId) && role(candidate) === "types")
        .sort((a, b) =>
          semanticNameAffinity(b, result) - semanticNameAffinity(a, result) ||
          supportPriority(b, retrieval, anchorPaths) - supportPriority(a, retrieval, anchorPaths) ||
          a.path.localeCompare(b.path),
        )[0];
      addCandidate(result, selectedIds, typeCandidate, limit);
    }
    const persistenceCandidate = [...pool]
      .filter((candidate) => !selectedIds.has(candidate.candidateId) && PERSISTENCE_ROLES.has(role(candidate)))
      .sort((a, b) =>
        persistenceResponsibilityPriority(b) - persistenceResponsibilityPriority(a) ||
        supportPriority(b, retrieval, anchorPaths) - supportPriority(a, retrieval, anchorPaths) ||
        a.path.localeCompare(b.path),
      )[0];
    addCandidate(result, selectedIds, persistenceCandidate, limit);
    if (
      taskSignals(retrieval.rawTask).security &&
      !result.some(isConfig)
    ) {
      addCandidate(
        result,
        selectedIds,
        best((candidate) => isConfig(candidate) && sharesAnchorWorkspace(candidate)),
        limit,
      );
    }
  }

  if (retrieval.implementationArea === "ui") {
    addCandidate(result, selectedIds, best((candidate) => role(candidate) === "hook" || role(candidate) === "client-api"), limit);
    addCandidate(result, selectedIds, best((candidate) => role(candidate) === "store"), limit);
    addCandidate(result, selectedIds, best((candidate) => role(candidate) === "types" || role(candidate) === "ui-component" || role(candidate) === "layout"), limit);
    const signals = taskSignals(retrieval.rawTask);
    if (signals.navigation) {
      addCandidate(result, selectedIds, best((candidate) => role(candidate) === "layout"), limit);
    }
    if (signals.input) {
      addCandidate(
        result,
        selectedIds,
        best((candidate) =>
          ["component", "ui-component"].includes(role(candidate)) &&
          /(?:input|field|slider|select|form|card)/i.test(candidate.file.name),
        ),
        limit,
      );
    }
  }

  if (retrieval.implementationArea === "tests") {
    const anchorDirectories = new Set([...anchorPaths].map(parentDirectory));
    const sameDirectorySources = [...pool]
      .filter((candidate) => !selectedIds.has(candidate.candidateId))
      .filter((candidate) => !isTest(candidate) && candidate.file.kind === "source")
      .filter((candidate) => anchorDirectories.has(parentDirectory(candidate.path)))
      .sort((a, b) =>
        symbolTaskMentionPriority(b, retrieval.rawTask) - symbolTaskMentionPriority(a, retrieval.rawTask) ||
        supportPriority(b, retrieval, anchorPaths) - supportPriority(a, retrieval, anchorPaths) ||
        a.path.localeCompare(b.path),
      );
    for (const candidate of sameDirectorySources.slice(0, 4)) {
      addCandidate(result, selectedIds, candidate, limit);
    }
    addCandidate(result, selectedIds, best((candidate) => !isTest(candidate) && graphPriority(candidate, anchorPaths) > 0), limit);
    addCandidate(result, selectedIds, best((candidate) => !isTest(candidate) && strongIdentity(candidate)), limit);
    addCandidate(
      result,
      selectedIds,
      best((candidate) =>
        !isTest(candidate) &&
        (graphPriority(candidate, anchorPaths) > 0 || strongIdentity(candidate)),
      ),
      limit,
    );
  }

  if (retrieval.implementationArea === "docs") {
    const manifests = [...pool]
      .filter((candidate) => !selectedIds.has(candidate.candidateId) && isConfig(candidate))
      .sort((a, b) => docsManifestPriority(b, anchorPaths) - docsManifestPriority(a, anchorPaths));
    const environment = manifests.find((candidate) => /^(?:\.env|env)[._-](?:example|sample|template)$/.test(candidate.file.name.toLowerCase()));
    const rootManifest = manifests.find((candidate) => {
      const name = candidate.file.name.toLowerCase();
      const depth = normalize(candidate.path).split("/").length;
      return depth <= 2 && /^(?:package\.json|pyproject\.toml|cargo\.toml|go\.mod|pom\.xml|composer\.json|requirements.*\.txt)$/.test(name);
    }) ?? manifests.find((candidate) => /^(?:package\.json|pyproject\.toml|cargo\.toml|go\.mod|pom\.xml|composer\.json|requirements.*\.txt)$/.test(candidate.file.name.toLowerCase()));
    addCandidate(result, selectedIds, environment, limit);
    addCandidate(result, selectedIds, rootManifest, limit);

    const signals = taskSignals(retrieval.rawTask);
    if (signals.formula || signals.input || signals.appearance || signals.responsive) {
      const domainSource = [...pool]
        .filter((candidate) => !selectedIds.has(candidate.candidateId))
        .filter((candidate) => !isDocs(candidate) && !isConfig(candidate) && candidate.file.kind === "source")
        .filter((candidate) =>
          candidate.identityMatchCount > 0 ||
          candidate.filenameMatchCount > 0 ||
          effectiveRole(candidate) === "utility" ||
          symbolTaskMentionPriority(candidate, retrieval.rawTask) > 0,
        )
        .sort((a, b) =>
          symbolTaskMentionPriority(b, retrieval.rawTask) - symbolTaskMentionPriority(a, retrieval.rawTask) ||
          Number(effectiveRole(b) === "utility") * 6_000 - Number(effectiveRole(a) === "utility") * 6_000 ||
          supportPriority(b, retrieval, anchorPaths) - supportPriority(a, retrieval, anchorPaths) ||
          a.path.localeCompare(b.path),
        )[0];
      addCandidate(
        result,
        selectedIds,
        domainSource,
        limit,
      );
    }

    for (const candidate of manifests) {
      addCandidate(result, selectedIds, candidate, limit);
    }
  }

  if (retrieval.implementationArea === "build") {
    const buildPool = [...pool]
      .filter((candidate) => !selectedIds.has(candidate.candidateId))
      .sort((a, b) =>
        buildSupportPriority(b, retrieval, anchorPaths) - buildSupportPriority(a, retrieval, anchorPaths) ||
        a.path.localeCompare(b.path),
      );
    addCandidate(result, selectedIds, buildPool.find((candidate) => isConfig(candidate)), limit);
    addCandidate(
      result,
      selectedIds,
      buildPool.find((candidate) => role(candidate) === "layout" || role(candidate) === "app-entry" || role(candidate) === "server-entry"),
      limit,
    );
    addCandidate(result, selectedIds, buildPool.find((candidate) => isConfig(candidate) && !selectedIds.has(candidate.candidateId)), limit);
  }

  if (retrieval.implementationArea === "refactor" || retrieval.implementationArea === "bugfix") {
    const signals = taskSignals(retrieval.rawTask);
    if (signals.appearance || signals.responsive) {
      addCandidate(result, selectedIds, best((candidate) => role(candidate) === "style"), limit);
    }
    if (signals.input) {
      addCandidate(
        result,
        selectedIds,
        best((candidate) =>
          ["component", "ui-component"].includes(role(candidate)) &&
          /(?:input|field|slider|select|form|card)/i.test(candidate.file.name),
        ),
        limit,
      );
    }
    addCandidate(
      result,
      selectedIds,
      best((candidate) =>
        ["page", "component", "ui-component", "style", "hook", "utility"].includes(role(candidate)) &&
        (graphPriority(candidate, anchorPaths) > 0 || strongIdentity(candidate)),
      ),
      limit,
    );
  }
}

export function assembleContextCandidates(
  grounded: RetrievedCandidate[],
  retrieval: CandidateRetrievalResult,
  selectionLimit: number,
): ContextAssemblyResult {
  const anchorPool = [...grounded];
  const anchorPoolIds = new Set(anchorPool.map((candidate) => candidate.candidateId));
  const signals = taskSignals(retrieval.rawTask);
  for (const candidate of retrieval.candidates) {
    if (anchorPoolIds.has(candidate.candidateId)) continue;
    const structuralEntry =
      (retrieval.implementationArea === "backend" || retrieval.implementationArea === "fullstack") &&
      signals.endpoint &&
      BACKEND_ENTRY_ROLES.has(effectiveRole(candidate)) &&
      (candidate.roleIntentMatch || candidate.graphRelationships.length > 0);
    const exactAreaCandidate =
      isAreaCompatibleAnchor(candidate, retrieval) &&
      (candidate.explicit || candidate.filenameMatchCount > 0 || candidate.identityMatchCount > 0);
    if (symbolTaskMentionPriority(candidate, retrieval.rawTask) <= 0 && !structuralEntry && !exactAreaCandidate) continue;
    anchorPool.push(candidate);
    anchorPoolIds.add(candidate.candidateId);
  }
  const anchors = chooseAnchors(anchorPool, retrieval);
  const selectedIds = new Set(anchors.map((candidate) => candidate.candidateId));
  const anchorPaths = new Set(anchors.map((candidate) => normalize(candidate.path)));
  const result = [...anchors];
  const diagnostics: string[] = [];

  if (anchors.length === 0) {
    diagnostics.push("No grounded primary anchor was available for context assembly.");
    return { candidates: [], anchorIds: new Set(), diagnostics };
  }

  const pool = retrieval.candidates.filter((candidate) => !selectedIds.has(candidate.candidateId));
  const directSupportLimit = retrieval.implementationArea === "backend" || retrieval.implementationArea === "fullstack"
    ? 3
    : retrieval.implementationArea === "ui" || retrieval.implementationArea === "tests"
      ? 3
      : retrieval.implementationArea === "refactor" || retrieval.implementationArea === "bugfix"
        ? 2
        : retrieval.implementationArea === "build"
          ? 2
          : 0;
  const directSupport = directGraphSupportCandidates(retrieval, anchors)
    .filter((candidate) => {
      const role = effectiveRole(candidate);
      if (retrieval.implementationArea === "backend") return isBackend(candidate) || role === "types";
      if (retrieval.implementationArea === "fullstack") return isBackend(candidate) || isFrontend(candidate);
      if (retrieval.implementationArea === "ui") return isFrontend(candidate) || role === "types" || role === "store" || role === "utility";
      if (retrieval.implementationArea === "tests") return !isDocs(candidate) && !isConfig(candidate);
      if (retrieval.implementationArea === "build") return isConfig(candidate) || role === "layout" || role === "app-entry" || role === "server-entry";
      if (retrieval.implementationArea === "refactor" || retrieval.implementationArea === "bugfix") return candidate.file.kind === "source" || candidate.file.kind === "style";
      return false;
    });
  const useEarlyLayerCoverage = retrieval.implementationArea === "backend" || retrieval.implementationArea === "fullstack";
  if (useEarlyLayerCoverage) {
    addRoleCoverage(result, selectedIds, pool, retrieval, anchorPaths, selectionLimit);
  }

  if (retrieval.implementationArea === "ui") {
    const featureDomainSupport = [...pool]
      .filter((candidate) => !selectedIds.has(candidate.candidateId))
      .filter((candidate) => {
        const role = effectiveRole(candidate);
        if (!["component", "ui-component", "hook", "store", "types", "utility"].includes(role)) return false;
        const sameWorkspace = [...anchorPaths].some((anchorPath) =>
          workspaceRoot(candidate.path) && workspaceRoot(candidate.path) === workspaceRoot(anchorPath),
        );
        return sameWorkspace || graphPriority(candidate, anchorPaths) > 0;
      })
      .filter((candidate) => taskDomainSupportPriority(candidate, retrieval.rawTask) > 0)
      .sort((a, b) =>
        taskDomainSupportPriority(b, retrieval.rawTask) - taskDomainSupportPriority(a, retrieval.rawTask) ||
        pathAffinity(b, anchorPaths) - pathAffinity(a, anchorPaths) ||
        supportPriority(b, retrieval, anchorPaths) - supportPriority(a, retrieval, anchorPaths) ||
        a.path.localeCompare(b.path),
      )[0];
    addCandidate(result, selectedIds, featureDomainSupport, selectionLimit);
  }

  const taskLinkedSupport = [...pool]
    .filter((candidate) => !selectedIds.has(candidate.candidateId))
    .filter((candidate) => graphPriority(candidate, anchorPaths) > 0 || strongIdentity(candidate))
    .sort((a, b) =>
      taskDomainSupportPriority(b, retrieval.rawTask) - taskDomainSupportPriority(a, retrieval.rawTask) ||
      taskMentionPriority(b, retrieval.rawTask) - taskMentionPriority(a, retrieval.rawTask) ||
      symbolTaskMentionPriority(b, retrieval.rawTask) - symbolTaskMentionPriority(a, retrieval.rawTask) ||
      supportPriority(b, retrieval, anchorPaths) - supportPriority(a, retrieval, anchorPaths) ||
      a.path.localeCompare(b.path),
    );
  const strongestTaskSupport = taskLinkedSupport.find((candidate) =>
    taskMentionPriority(candidate, retrieval.rawTask) > 0 || symbolTaskMentionPriority(candidate, retrieval.rawTask) > 0,
  );
  addCandidate(result, selectedIds, strongestTaskSupport, selectionLimit);

  if (retrieval.implementationArea === "ui" && (signals.interaction || signals.navigation || signals.input)) {
    const interactiveSupport = directSupport
      .filter((candidate) => ["component", "ui-component"].includes(effectiveRole(candidate)))
      .filter((candidate) => /(?:button|dropdown|select|input|field|slider|menu|nav|dialog|modal|control)/i.test(candidate.file.name));
    for (const candidate of interactiveSupport.slice(0, 2)) {
      addCandidate(result, selectedIds, candidate, selectionLimit);
    }
  }

  for (const candidate of directSupport.slice(0, directSupportLimit)) {
    addCandidate(result, selectedIds, candidate, selectionLimit);
  }
  if (!useEarlyLayerCoverage) {
    addRoleCoverage(result, selectedIds, pool, retrieval, anchorPaths, selectionLimit);
  }

  const sortedSupport = [...pool]
    .filter((candidate) => !selectedIds.has(candidate.candidateId))
    .filter((candidate) => {
      const relation = graphPriority(candidate, anchorPaths);
      if (retrieval.implementationArea === "ui" && (isDocs(candidate) || isConfig(candidate))) return false;
      if (relation > 0 || strongIdentity(candidate)) return true;
      if (retrieval.implementationArea === "docs" && isConfig(candidate)) return true;
      if (retrieval.implementationArea === "build" && isConfig(candidate)) return true;
      return supportPriority(candidate, retrieval, anchorPaths) >= 5_500;
    })
    .sort((a, b) =>
      supportPriority(b, retrieval, anchorPaths) - supportPriority(a, retrieval, anchorPaths) ||
      b.score - a.score ||
      a.path.localeCompare(b.path),
    );

  const softSupportLimit = retrieval.reviewOnly
    ? Math.min(selectionLimit, 5)
    : retrieval.implementationArea === "fullstack"
      ? Math.min(selectionLimit, 8)
      : Math.min(selectionLimit, 7);

  for (const candidate of sortedSupport) {
    if (result.length >= softSupportLimit) break;
    if (selectedIds.has(candidate.candidateId)) continue;
    const role = effectiveRole(candidate);
    const relation = graphPriority(candidate, anchorPaths);
    if (
      role === "page" &&
      relation === 0 &&
      !candidate.explicit &&
      candidate.filenameMatchCount === 0 &&
      candidate.identityMatchCount < 2
    ) continue;
    addCandidate(result, selectedIds, candidate, softSupportLimit);
  }

  const prunedResult = pruneWeakSupportCandidates(result, anchors, retrieval, selectionLimit);
  const removedSupportCount = Math.max(0, result.length - prunedResult.length);
  diagnostics.push(`Assembled ${prunedResult.length} files around ${anchors.length} primary anchor(s).`);
  if (removedSupportCount > 0) {
    diagnostics.push(`Pruned ${removedSupportCount} weak supporting candidate(s).`);
  }
  return {
    candidates: prunedResult,
    anchorIds: new Set(anchors.map((candidate) => candidate.candidateId)),
    diagnostics,
  };
}
