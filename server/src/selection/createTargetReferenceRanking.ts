import type { TaskIntentAnalysis } from "../ollama/taskIntentAnalyzer.js";
import type {
  ProjectInventoryFile,
  ProjectInventoryFileRole,
} from "../scanner/projectInventoryScanner.js";

export interface RankCreateTargetReferencesInput {
  files: ProjectInventoryFile[];
  rawTask: string;
  positiveTaskText: string;
  taskIntent?: TaskIntentAnalysis;
  plannedTargetPaths: string[];
}

const GENERIC_TOKENS = new Set([
  "add",
  "backend",
  "build",
  "component",
  "components",
  "create",
  "endpoint",
  "file",
  "files",
  "frontend",
  "implement",
  "implementation",
  "index",
  "layout",
  "lib",
  "main",
  "new",
  "page",
  "pages",
  "route",
  "routes",
  "server",
  "shared",
  "source",
  "src",
  "update",
  "view",
  "views",
  "добавь",
  "бэкенд",
  "бекенд",
  "реализовать",
  "роут",
  "сервер",
  "создай",
  "файл",
]);

function normalizePath(value: string) {
  return value.replace(/\\/g, "/").trim().toLocaleLowerCase();
}

function tokenizeIdentifierLike(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLocaleLowerCase()
    .split(/[^a-zа-яё0-9]+/iu)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function extractExactIdentifierAtoms(values: string[]) {
  return new Set(
    values.flatMap((value) =>
      value
        .toLocaleLowerCase()
        .match(/[a-z_$][a-z0-9_$-]*/giu) ?? [],
    ),
  );
}

function inferredRoleForPlannedPath(
  pathValue: string,
): ProjectInventoryFileRole | null {
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

function buildTaskTokens(input: RankCreateTargetReferencesInput) {
  const targetTokens = input.plannedTargetPaths.flatMap((targetPath) =>
    tokenizeIdentifierLike(targetPath.replace(/\.[^.]+$/u, "")),
  );
  const taskTokens = [
    input.positiveTaskText,
    input.taskIntent?.taskUnderstanding.goal ?? "",
    ...(input.taskIntent?.taskUnderstanding.requestedChanges ?? []),
    ...(input.taskIntent?.domainTerms ?? []),
    ...(input.taskIntent?.mentionedEntities ?? []),
    ...(input.taskIntent?.recommendedSearchTerms ?? []),
    ...((input.taskIntent?.structuredIntent.primaryTargets ?? []).flatMap(
      (target) => [
        target.value,
        target.path ?? "",
        target.routePath ?? "",
        target.name ?? "",
      ],
    )),
    ...(input.taskIntent?.structuredIntent.positiveActions ?? []),
  ].flatMap(tokenizeIdentifierLike);

  return uniqueStrings([...targetTokens, ...taskTokens]).filter(
    (token) => token.length >= 3 && !GENERIC_TOKENS.has(token),
  );
}

function scoreReference(
  file: ProjectInventoryFile,
  input: RankCreateTargetReferencesInput,
  taskTokens: string[],
) {
  const pathTokens = new Set(tokenizeIdentifierLike(file.path));
  const nameTokens = new Set(
    tokenizeIdentifierLike(file.name.replace(/\.[^.]+$/u, "")),
  );
  const symbolTokens = new Set(
    [
      ...(file.exports ?? []),
      ...(file.symbols ?? []),
      ...(file.semanticFacts?.declarations ?? []),
    ].flatMap(tokenizeIdentifierLike),
  );
  const hintTokens = new Set(
    [
      ...(file.textHints ?? []),
      ...(file.semanticFacts?.objectProperties ?? []),
      ...(file.semanticFacts?.typeFields ?? []),
      ...(file.semanticFacts?.routePaths ?? []),
      ...(file.semanticFacts?.stringLiterals ?? []),
    ].flatMap(tokenizeIdentifierLike),
  );
  const referenceValues = [
    ...(file.imports ?? []),
    ...(file.semanticFacts?.references ?? []),
    ...(file.semanticFacts?.assignments ?? []),
  ];
  const referenceTokens = new Set(referenceValues.flatMap(tokenizeIdentifierLike));
  const exactHintIdentifiers = extractExactIdentifierAtoms([
    ...(file.textHints ?? []),
    ...(file.semanticFacts?.objectProperties ?? []),
    ...(file.semanticFacts?.typeFields ?? []),
    ...(file.semanticFacts?.routePaths ?? []),
    ...(file.semanticFacts?.stringLiterals ?? []),
  ]);
  const exactReferenceIdentifiers = extractExactIdentifierAtoms(referenceValues);

  let score = 0;
  let evidenceHits = 0;
  for (const token of taskTokens) {
    let matched = false;
    if (nameTokens.has(token)) {
      score += 90;
      matched = true;
    } else if (pathTokens.has(token)) {
      score += 55;
      matched = true;
    }
    if (symbolTokens.has(token)) {
      score += 32;
      matched = true;
    }
    if (hintTokens.has(token)) {
      score += 18;
      matched = true;
    }
    if (referenceTokens.has(token)) {
      score += 7;
      matched = true;
    }
    if (matched) evidenceHits += 1;
  }

  const expectedRoles = new Set(
    input.plannedTargetPaths
      .map(inferredRoleForPlannedPath)
      .filter((role): role is ProjectInventoryFileRole => Boolean(role)),
  );
  if (expectedRoles.has(file.role)) score += 65;

  const targetExtensions = new Set(
    input.plannedTargetPaths
      .map((targetPath) =>
        targetPath.match(/\.[^.\/]+$/u)?.[0]?.toLocaleLowerCase(),
      )
      .filter(Boolean),
  );
  if (targetExtensions.has(file.extension.toLocaleLowerCase())) score += 8;

  const requestedMethods = new Set(
    (input.rawTask.match(/\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/giu) ??
      []).map((method) => method.toLocaleLowerCase()),
  );
  for (const method of requestedMethods) {
    if (referenceTokens.has(method) || hintTokens.has(method)) {
      score += 88;
      evidenceHits += 2;
    }
  }

  const requestedQueryParameters = uniqueStrings(
    Array.from(
      input.rawTask.matchAll(
        /(?:query[\s-]*(?:parameter|param)|query[\s-]*параметр(?:е|ом)?|параметр(?:е|ом)?\s+query)\s*[«„“"'`]?([A-Za-z_$][A-Za-z0-9_$-]{0,31})/giu,
      ),
      (match) => match[1] ?? "",
    ),
  ).map(normalizePath);
  for (const parameter of requestedQueryParameters) {
    // Explicit parameter names are protocol evidence, not ordinary semantic
    // tokens. Preserve one-character identifiers such as `q` instead of
    // dropping them through the general token-length filter.
    if (exactHintIdentifiers.has(parameter)) {
      score += 116;
      evidenceHits += 3;
    } else if (exactReferenceIdentifiers.has(parameter)) {
      score += 42;
      evidenceHits += 1;
    }
  }

  // Focused examples are safer convention references than very large,
  // multi-purpose modules when the file already has task-linked evidence.
  if (evidenceHits > 0) {
    if (file.sizeBytes <= 4_000) score += 70;
    else if (file.sizeBytes <= 12_000) score += 35;
    else if (file.sizeBytes > 40_000) score -= 25;
  }

  return score;
}

export function rankCreateTargetReferenceFiles(
  input: RankCreateTargetReferencesInput,
) {
  const taskTokens = buildTaskTokens(input);
  return input.files.slice().sort((left, right) => {
    const scoreDelta =
      scoreReference(right, input, taskTokens) -
      scoreReference(left, input, taskTokens);
    if (scoreDelta !== 0) return scoreDelta;
    return normalizePath(left.path).localeCompare(normalizePath(right.path));
  });
}
