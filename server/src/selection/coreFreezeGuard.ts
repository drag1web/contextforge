import path from "node:path";

import type { SelectedTaskFile } from "../ollama/taskFileSelector.js";
import type { TaskIntentAnalysis } from "../ollama/taskIntentAnalyzer.js";
import type {
  ProjectInventory,
  ProjectInventoryFile,
} from "../scanner/projectInventoryScanner.js";
import { extractClassifiedFileMentions } from "./explicitFileMentions.js";

function normalizePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\.\//u, "").trim().toLowerCase();
}

function compact(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const rawValue of values) {
    const value = String(rawValue ?? "").trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripEntityNoise(value: string) {
  return value
    .replace(/^[\s,;:—-]+|[\s,;:—-]+$/gu, "")
    .replace(/^(?:the|this|that|these|those|all|every|both|either|any|a|an)\s+/iu, "")
    .replace(/^(?:этот|эта|это|эти|все|оба|обе|любой|любые)\s+/iu, "")
    .replace(/\b(?:exactly as (?:it|they) (?:is|are)|unchanged|без изменений)\b[\s\S]*$/iu, "")
    .trim();
}

function splitProtectedEntityList(value: string) {
  const normalized = stripEntityNoise(value)
    .replace(/\b(?:and|or)\b/giu, ",")
    .replace(/\b(?:и|или|либо)\b/giu, ",");
  return uniqueStrings(
    normalized
      .split(/[,;]/u)
      .map(stripEntityNoise)
      .filter((item) => item.length > 0 && !/^(?:it|them|they|их|им|ними)$/iu.test(item)),
  );
}

function collectProtectedEntityPhrases(
  rawTask: string,
  taskIntent?: TaskIntentAnalysis,
) {
  const text = [
    rawTask,
    ...(taskIntent?.structuredIntent.protectedScopes ?? []),
  ].join("\n");
  const phrases: string[] = [];

  const referencePatterns = [
    /\b(?:use|treat|keep)\s+(.{1,120}?)\s+only\s+as\s+(?:(?:a|an|the)\s+)?(?:[\p{L}\p{N}_+./-]+\s+){0,4}(?:reference|source\s+of\s+(?:facts?|truth))/giu,
    /\b(?:use|treat|keep)\s+(.{1,120}?)\s+as\s+(?:(?:a|an|the)\s+)?(?:[\p{L}\p{N}_+./-]+\s+){0,4}reference\s+only/giu,
    /(?:используй|использовать|використовуй|використовувати)\s+(.{1,120}?)\s+(?:только|лишь|тільки|лише)\s+(?:как|як)?\s*(?:справк\p{L}*|референс\p{L}*|пример\p{L}*|источник\p{L}*\s+факт\p{L}*|довідк\p{L}*|джерел\p{L}*\s+факт\p{L}*)/giu,
  ];

  for (const pattern of referencePatterns) {
    for (const match of text.matchAll(pattern)) {
      phrases.push(...splitProtectedEntityList(match[1] ?? ""));
    }
  }

  const negativePatterns = [
    /\b(?:do\s+not|don't|dont|must\s+not|should\s+not|never)\s+(?:change|modify|alter|edit|touch|update)\s+([^.!?\n]{1,180})/giu,
    /([^.!?\n]{1,180}?)\s+\b(?:must\s+not|should\s+not)\s+(?:change|be\s+changed|be\s+modified|be\s+edited)/giu,
    /([^.!?\n]{1,180}?)\s+не\s+(?:меняй|менять|изменяй|изменять|редактируй|редактировать|трогай|трогать|обновляй|обновлять)/giu,
    /(?:не\s+(?:меняй|менять|изменяй|изменять|редактируй|редактировать|трогай|трогать|обновляй|обновлять))\s+([^.!?\n]{1,180})/giu,
  ];

  for (const pattern of negativePatterns) {
    for (const match of text.matchAll(pattern)) {
      phrases.push(...splitProtectedEntityList(match[1] ?? ""));
    }
  }

  return uniqueStrings(phrases);
}

function fileStem(filePath: string) {
  const name = path.basename(normalizePath(filePath));
  return name.replace(/\.[^.]+$/u, "");
}

function matchesProtectedEntity(
  file: ProjectInventoryFile | undefined,
  filePath: string,
  rawEntity: string,
) {
  const normalizedPath = normalizePath(filePath);
  const stem = fileStem(filePath);
  const normalizedEntity = rawEntity.toLowerCase().trim();
  const entityCompact = compact(normalizedEntity);
  const stemCompact = compact(stem);
  const basenameCompact = compact(path.basename(normalizedPath));
  const role = String(file?.role ?? "").toLowerCase();

  if (!entityCompact) return false;

  const fileLikeEntity = /(?:^|[\/])[^\/]+\.[A-Za-z0-9]{1,12}$/u.test(
    normalizedEntity,
  );
  if (fileLikeEntity) {
    const normalizedEntityPath = normalizePath(normalizedEntity);
    if (normalizedEntityPath.includes("/")) {
      return (
        normalizedPath === normalizedEntityPath ||
        normalizedPath.endsWith(`/${normalizedEntityPath}`)
      );
    }
    return path.basename(normalizedPath) === normalizedEntityPath;
  }

  if (/shared\s+ui\s+components?/iu.test(normalizedEntity)) {
    return /\/components\/ui\//u.test(normalizedPath) || role === "ui-component";
  }
  if (/company\s+(?:data|content)/iu.test(normalizedEntity)) {
    return stemCompact === "company" || /\/content\/company(?:\.|\/)/u.test(normalizedPath);
  }
  if (/home\s+page|главн\p{L}*\s+страниц/iu.test(normalizedEntity)) {
    return (
      stemCompact === "page" ||
      stemCompact === "homepage" ||
      /\/pages?\/home(?:page)?\./u.test(normalizedPath)
    );
  }
  if (/electron\s+shortcuts?/iu.test(normalizedEntity)) {
    return normalizedPath.includes("electron") && normalizedPath.includes("shortcut");
  }
  if (/^(?:layout|layouts|лейаут\p{L}*)$/iu.test(normalizedEntity)) {
    return stemCompact === "layout" || role === "layout";
  }
  if (/^(?:page|pages|страниц\p{L}*)$/iu.test(normalizedEntity)) {
    return stemCompact === "page" || stemCompact.endsWith("page") || role === "page";
  }
  if (/^(?:forms?|форм\p{L}*)$/iu.test(normalizedEntity)) {
    return stemCompact.includes("form") || role === "form";
  }
  if (/^(?:routes?|endpoints?|роут\p{L}*|маршрут\p{L}*)$/iu.test(normalizedEntity)) {
    return stemCompact === "route" || normalizedPath.includes("/api/") || role === "route";
  }
  if (/^(?:schema|schemas|схем\p{L}*)$/iu.test(normalizedEntity)) {
    return /(?:schema|prisma|migration|database)/u.test(normalizedPath);
  }
  if (/^(?:api|backend(?:\s+api)?|апи|бэкенд)$/iu.test(normalizedEntity)) {
    return normalizedPath.includes("/api/") || /(?:^|\/)(?:api|server|route)\./u.test(normalizedPath);
  }

  if (entityCompact === stemCompact || entityCompact === basenameCompact) return true;
  if (entityCompact.length >= 5 && stemCompact.includes(entityCompact)) return true;

  const meaningfulWords = normalizedEntity
    .split(/[^\p{L}\p{N}]+/u)
    .map(compact)
    .filter((word) => word.length >= 4 && !["only", "reference", "consumer", "provider", "data", "file", "component"].includes(word));
  return meaningfulWords.some(
    (word) => stemCompact.includes(word) || compact(normalizedPath).includes(word),
  );
}

function inventoryFileByPath(inventory: ProjectInventory | undefined, filePath: string) {
  if (!inventory) return undefined;
  const normalized = normalizePath(filePath);
  return inventory.files.find((file) => normalizePath(file.path) === normalized);
}

export function resolveProtectedSelectedPaths(input: {
  rawTask: string;
  taskIntent?: TaskIntentAnalysis;
  inventory?: ProjectInventory;
  selectedFiles: SelectedTaskFile[];
}) {
  const phrases = collectProtectedEntityPhrases(input.rawTask, input.taskIntent);
  const protectedPaths = input.selectedFiles
    .filter((selected) => {
      const file = inventoryFileByPath(input.inventory, selected.path);
      return phrases.some((phrase) => matchesProtectedEntity(file, selected.path, phrase));
    })
    .map((selected) => selected.path);

  return {
    phrases,
    protectedPaths: uniqueStrings(protectedPaths),
  };
}

function occurrenceContexts(rawTask: string, mention: string) {
  const normalizedMention = mention.replace(/\\/g, "/");
  const mentionName = path.basename(normalizedMention);
  const alternatives = uniqueStrings([normalizedMention, mentionName]).sort(
    (left, right) => right.length - left.length,
  );
  const matcher = new RegExp(
    `(?:${alternatives
      .map((value) => escapeRegExp(value).replace(/\//g, String.raw`[\\/]`))
      .join("|")})`,
    "giu",
  );
  return [...rawTask.matchAll(matcher)].map((match) => {
    const start = match.index ?? 0;
    const end = start + (match[0]?.length ?? mention.length);
    return {
      before: rawTask.slice(Math.max(0, start - 180), start),
      after: rawTask.slice(end, Math.min(rawTask.length, end + 220)),
    };
  });
}

function isDirectMutationMention(rawTask: string, mention: string) {
  const action = String.raw`(?:edit|change|update|modify|fix|replace|rename|move|remove|delete|set|add|wire|редактир\p{L}*|измен\p{L}*|обнов\p{L}*|исправ\p{L}*|замен\p{L}*|переимен\p{L}*|удал\p{L}*|добав\p{L}*)`;
  const ownership = String.raw`(?:ownership|parsing|typed\s+parameters?|pagination\s+controls?|validation|handling|logic|query\s+update|implementation|владен\p{L}*|парсинг|параметр\p{L}*|валидац\p{L}*|логик\p{L}*)`;
  return occurrenceContexts(rawTask, mention).some(({ before, after }) => {
    return (
      new RegExp(`${action}[^.!?\\n]{0,80}$`, "iu").test(before) ||
      new RegExp(`(?:^|\\b(?:in|inside|within|в)\\s*)${action}\\b`, "iu").test(after.trimStart()) ||
      new RegExp(`^\\s*(?:,|:|-)?\\s*${action}\\b`, "iu").test(after) ||
      new RegExp(`${ownership}\\s+(?:in|inside|within|в)\\s*$`, "iu").test(before) ||
      /(?:^|\b)(?:in|inside|within|в)\s*$/iu.test(before) &&
        new RegExp(`^\\s*${action}\\b`, "iu").test(after)
    );
  });
}

function resolveInventoryMention(
  inventory: ProjectInventory,
  rawMention: string,
) {
  const normalized = normalizePath(rawMention);
  const exact = inventory.files.find((file) => normalizePath(file.path) === normalized);
  if (exact) return exact.path;

  if (normalized.includes("/")) {
    const suffixMatches = inventory.files.filter((file) =>
      normalizePath(file.path).endsWith(`/${normalized}`),
    );
    return suffixMatches.length === 1 ? suffixMatches[0]!.path : undefined;
  }

  const nameMatches = inventory.files.filter(
    (file) => path.basename(normalizePath(file.path)) === normalized,
  );
  return nameMatches.length === 1 ? nameMatches[0]!.path : undefined;
}

export function resolveDirectExistingMutationTargets(input: {
  rawTask: string;
  inventory?: ProjectInventory;
  taskIntent?: TaskIntentAnalysis;
}) {
  if (!input.inventory) return [];
  const protectedPhrases = collectProtectedEntityPhrases(input.rawTask, input.taskIntent);
  const targets: string[] = [];

  for (const mention of extractClassifiedFileMentions(input.rawTask)) {
    if (!isDirectMutationMention(input.rawTask, mention.path)) continue;
    const matchedPath = resolveInventoryMention(input.inventory, mention.path);
    if (!matchedPath) continue;
    const file = inventoryFileByPath(input.inventory, matchedPath);
    if (protectedPhrases.some((phrase) => matchesProtectedEntity(file, matchedPath, phrase))) {
      continue;
    }
    targets.push(matchedPath);
  }

  return uniqueStrings(targets);
}

function subjectAnchors(value: string) {
  return value
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((token) => token.replace(/-(?:only|specific|dependent)$/u, ""))
    .filter(
      (token) =>
        token.length >= 4 &&
        ![
          "role",
          "field",
          "feature",
          "type",
          "state",
          "permission",
          "application",
          "приложения",
          "роль",
          "поле",
          "функцию",
        ].includes(token),
    );
}

export function detectDestructivePreservationContradiction(rawTask: string) {
  const destructiveSubjects: string[] = [];
  const englishDestructive = /\b(?:remove|delete|eliminate|drop)\s+(?:the\s+)?([^.!?\n]{1,100}?)(?=\s+(?:from|while|but|and\s+preserv|and\s+keep)|[.!?\n]|$)/giu;
  const slavicDestructive = /(?:удалить|убрать|исключить)\s+([^.!?\n]{1,100}?)(?=\s+(?:из|при|но|сохранив|и\s+сохран)|[.!?\n]|$)/giu;
  for (const pattern of [englishDestructive, slavicDestructive]) {
    for (const match of rawTask.matchAll(pattern)) destructiveSubjects.push(match[1] ?? "");
  }

  const preservationClauses: string[] = [];
  const preservation = /(?:preserv\p{L}*|keep|retain|leave|сохран\p{L}*|остав\p{L}*)\s+(?:every|all|все|кажд\p{L}*)\s+([^.!?\n]{1,260}?)(?:\s+(?:exactly\s+as\s+(?:it|they)\s+(?:is|are)|unchanged|without\s+(?:any\s+)?changes?|без\s+изменений)|[.!?\n]|$)/giu;
  for (const match of rawTask.matchAll(preservation)) preservationClauses.push(match[1] ?? "");

  for (const subject of destructiveSubjects) {
    const anchors = subjectAnchors(subject);
    if (anchors.length === 0) continue;
    for (const clause of preservationClauses) {
      const clauseCompact = compact(clause);
      const shared = anchors.find((anchor) => clauseCompact.includes(compact(anchor)));
      if (shared) {
        return {
          blocked: true,
          reasons: [
            `The task removes “${stripEntityNoise(subject)}” while requiring all ${shared}-dependent behavior to remain unchanged.`,
            "The requested removal and preservation constraints cannot both be satisfied without a clarified scope.",
          ],
        };
      }
    }
  }

  return { blocked: false, reasons: [] as string[] };
}

export interface CoreFreezeGuardResult {
  protectedPaths: string[];
  directExistingTargets: string[];
  missingDirectAuthorizedTargets: string[];
  contradictionReasons: string[];
}

export function evaluateCoreFreezeGuard(input: {
  rawTask: string;
  taskIntent?: TaskIntentAnalysis;
  inventory?: ProjectInventory;
  selectedFiles: SelectedTaskFile[];
  authorizedTargets: string[];
}): CoreFreezeGuardResult {
  const protectedSelection = resolveProtectedSelectedPaths(input);
  const directExistingTargets = resolveDirectExistingMutationTargets(input);
  const authorized = new Set(input.authorizedTargets.map(normalizePath));
  const contradiction = detectDestructivePreservationContradiction(input.rawTask);

  return {
    protectedPaths: protectedSelection.protectedPaths,
    directExistingTargets,
    missingDirectAuthorizedTargets: directExistingTargets.filter(
      (target) => !authorized.has(normalizePath(target)),
    ),
    contradictionReasons: contradiction.reasons,
  };
}
