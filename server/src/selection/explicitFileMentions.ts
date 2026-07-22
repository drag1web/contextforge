import path from "node:path";

import type {
  ProjectInventory,
  ProjectInventoryFile,
} from "../scanner/projectInventoryScanner.js";

export interface ExplicitFileMention {
  raw: string;
  normalized: string;
  matchedPath?: string;
  matchKind?:
    "exact" | "absolute-suffix" | "relative-suffix" | "file-name" | "loose-src";
}

export interface ExplicitFileMentionResolution {
  mentions: ExplicitFileMention[];
  existingPaths: string[];
  missingPaths: string[];
}

const FILE_EXTENSION_PATTERN =
  "ts|tsx|js|jsx|mjs|cjs|css|scss|sass|less|html|json|md|mdx|txt|yml|yaml|toml|sql|prisma|graphql|gql|xml|svg";
const SPECIAL_CONFIG_FILE_PATTERN =
  /(?:^|\/)(?:\.env(?:\.[A-Za-z0-9_.-]+)?|dockerfile(?:\.[A-Za-z0-9_.-]+)?|makefile)$/iu;
const PATH_CHARS = "A-Za-z0-9_ .@()\\[\\]{}+~$!#%&=,;:'`^-";

export type FileMentionSemanticRole =
  "editable-target" | "artifact-reference" | "ambiguous";

export interface ClassifiedFileMention {
  path: string;
  role: FileMentionSemanticRole;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getMentionContexts(rawTask: string, rawMention: string) {
  const normalizedMention = normalizePath(rawMention);
  const fileName = path.basename(normalizedMention);
  if (!fileName) return [];

  const collect = (candidate: string) => {
    const matcher = new RegExp(
      `(?:^|[^\\p{L}\\p{N}_])(${escapeRegExp(candidate)})(?=$|[^\\p{L}\\p{N}_])`,
      "giu",
    );
    const contexts: Array<{ before: string; after: string }> = [];
    for (const match of rawTask.matchAll(matcher)) {
      const matched = match[1] ?? candidate;
      const start = (match.index ?? 0) + match[0].indexOf(matched);
      const end = start + matched.length;
      contexts.push({
        before: rawTask.slice(Math.max(0, start - 180), start),
        after: rawTask.slice(end, Math.min(rawTask.length, end + 240)),
      });
    }
    return contexts;
  };

  if (normalizedMention.includes("/")) {
    const exactPathContexts = [
      ...collect(normalizedMention),
      ...collect(normalizedMention.replace(/\//g, "\\")),
    ];
    if (exactPathContexts.length > 0) return exactPathContexts;
  }

  return collect(fileName);
}

function isUiActionArtifactContext(before: string) {
  return /(?:action|button|menu\s+item|command|label|действи\p{L}*|кнопк\p{L}*|пункт\p{L}*|команд\p{L}*|ярлык\p{L}*)[^.!?\n—]{0,90}(?:generate|create|export|download|save|upload|import|preview|build|генерир\p{L}*|созда\p{L}*|экспорт\p{L}*|скач\p{L}*|сохран\p{L}*|загруз\p{L}*|импорт\p{L}*|предпросмотр\p{L}*|собир\p{L}*)\s*$/iu.test(
    before,
  );
}

function isProcessArtifactContext(before: string, after: string) {
  const processBefore =
    /(?:generation|creation|export|download|upload|import|preview|build|saving|генераци\p{L}*|создани\p{L}*|формировани\p{L}*|экспорт\p{L}*|скачиван\p{L}*|загрузк\p{L}*|импорт\p{L}*|предпросмотр\p{L}*|сохранени\p{L}*|сборк\p{L}*)\s+(?:of\s+)?$/iu;
  const processAfter =
    /^\s+(?:generation|creation|export|download|upload|import|preview|build|генераци\p{L}*|создани\p{L}*|формировани\p{L}*|экспорт\p{L}*|скачиван\p{L}*|загрузк\p{L}*|импорт\p{L}*|предпросмотр\p{L}*|сохранени\p{L}*|сборк\p{L}*)/iu;
  return processBefore.test(before) || processAfter.test(after);
}

function isProtectedReferenceContext(before: string, after: string) {
  const protection = String.raw`(?:do\s+not|don't|dont|without\s+(?:changing|editing|modifying|touching)|keep|leave|preserve|retain|не\s+(?:меняй|менять|трогай|трогать|редактируй|редактировать|изменяй|изменять)|оставь|оставить|сохрани|сохранить)`;
  const qualifiedEnglishReference = String.raw`(?:(?:(?:a|an|the)\s+)?(?:[A-Za-z][A-Za-z0-9_+./-]*\s+){0,4}reference(?:\s+provider)?s?|(?:(?:a|an|the)\s+)?(?:sources?|source)\s+of\s+(?:facts?|truth)|(?:(?:a|an|the)\s+)?facts?\s+source)`;
  const sourceOfFactsReference = String.raw`(?:(?:sources?|source)\s+of\s+(?:facts?|truth)|facts?\s+source|источник\p{L}*\s+факт\p{L}*|джерел\p{L}*\s+факт\p{L}*)`;
  const referenceOnly = String.raw`(?:reference(?:\s+provider)?s?\s+only|only\s+as\s+${qualifiedEnglishReference}|as\s+${qualifiedEnglishReference}\s+only|for\s+${qualifiedEnglishReference}\s+only|(?:use|treat|keep)\s+(?:them|these|those|the\s+files?|the\s+components?)?[^.!?\n—]{0,90}\s+as\s+${qualifiedEnglishReference}|${sourceOfFactsReference}\s+only|read[-\s]?only|только\s+(?:как\s+)?(?:справк\p{L}*|референс\p{L}*|пример\p{L}*|источник\p{L}*\s+факт\p{L}*)|лишь\s+(?:как\s+)?(?:справк\p{L}*|референс\p{L}*|пример\p{L}*|источник\p{L}*\s+факт\p{L}*)|лише\s+(?:як\s+)?(?:довідк\p{L}*|референс\p{L}*|приклад\p{L}*|джерел\p{L}*\s+факт\p{L}*)|тільки\s+(?:як\s+)?(?:довідк\p{L}*|референс\p{L}*|приклад\p{L}*|джерел\p{L}*\s+факт\p{L}*))`;
  const pathToken = String.raw`(?:['"\x60])?(?:[A-Za-z]:)?(?:[A-Za-z0-9_.@()\[\]{}+~$!#%&=,'^-]+[\\/])*[A-Za-z0-9_.@()\[\]{}+~$!#%&=,'^-]+\.(?:${FILE_EXTENSION_PATTERN})(?:['"\x60])?`;
  const protectedBefore = new RegExp(`${protection}[^.!?\\n—]{0,120}$`, "iu");
  const protectedAfter = new RegExp(`^[^.!?\\n—]{0,140}${protection}`, "iu");
  const referenceBefore = new RegExp(`${referenceOnly}[^.!?\\n—]{0,90}$`, "iu");
  const referenceAfter = new RegExp(
    `^(?:(?!\\b[A-Za-z0-9_@()\\[\\].-]+\\.(?:${FILE_EXTENSION_PATTERN})\\b)[^!?\\n—]){0,180}${referenceOnly}`,
    "iu",
  );
  const groupedReferenceAfter = new RegExp(
    `^\\s*(?:(?:(?:,\\s*(?:(?:and|or|и|или)\\s+)?|(?:and|or|&|и|или)\\s+))(?:the\\s+)?${pathToken}){1,8}\\s*[^.!?\\n—]{0,90}(?:${referenceOnly}|${protection})`,
    "iu",
  );
  const positiveActionBeforeTrailingProtection =
    /^(?=[^.!?\n—]{0,140}(?:do\s+not|don't|dont|не\s+(?:меняй|менять|трогай|трогать|редактируй|редактировать|изменяй|изменять)))[^.!?\n—]{0,120}(?:edit|change|update|fix|modify|delete|remove|rename|move|create|write|редактир\p{L}*|измен\p{L}*|обнов\p{L}*|исправ\p{L}*|почин\p{L}*|удал\p{L}*|переимен\p{L}*|перемест\p{L}*|созда\p{L}*|напиш\p{L}*)/iu.test(
      after,
    );
  return (
    protectedBefore.test(before) ||
    referenceBefore.test(before) ||
    referenceAfter.test(after) ||
    (groupedReferenceAfter.test(after) &&
      !isDirectFileTargetContext(before)) ||
    (protectedAfter.test(after) && !positiveActionBeforeTrailingProtection)
  );
}

function isProtectedBeforeContext(before: string) {
  const protection = String.raw`(?:do\s+not|don't|dont|without\s+(?:changing|editing|modifying|touching)|keep|leave|preserve|retain|не\s+(?:меняй|менять|трогай|трогать|редактируй|редактировать|изменяй|изменять)|оставь|оставить|сохрани|сохранить)`;
  const qualifiedEnglishReference = String.raw`(?:(?:(?:a|an|the)\s+)?(?:[A-Za-z][A-Za-z0-9_+./-]*\s+){0,4}reference(?:\s+provider)?s?|(?:(?:a|an|the)\s+)?(?:sources?|source)\s+of\s+(?:facts?|truth)|(?:(?:a|an|the)\s+)?facts?\s+source)`;
  const sourceOfFactsReference = String.raw`(?:(?:sources?|source)\s+of\s+(?:facts?|truth)|facts?\s+source|источник\p{L}*\s+факт\p{L}*|джерел\p{L}*\s+факт\p{L}*)`;
  const referenceOnly = String.raw`(?:reference(?:\s+provider)?s?\s+only|only\s+as\s+${qualifiedEnglishReference}|as\s+${qualifiedEnglishReference}\s+only|for\s+${qualifiedEnglishReference}\s+only|(?:use|treat|keep)\s+(?:them|these|those|the\s+files?|the\s+components?)?[^.!?\n—]{0,90}\s+as\s+${qualifiedEnglishReference}|${sourceOfFactsReference}\s+only|read[-\s]?only|только\s+(?:как\s+)?(?:справк\p{L}*|референс\p{L}*|пример\p{L}*|источник\p{L}*\s+факт\p{L}*)|лишь\s+(?:как\s+)?(?:справк\p{L}*|референс\p{L}*|пример\p{L}*|источник\p{L}*\s+факт\p{L}*)|лише\s+(?:як\s+)?(?:довідк\p{L}*|референс\p{L}*|приклад\p{L}*|джерел\p{L}*\s+факт\p{L}*)|тільки\s+(?:як\s+)?(?:довідк\p{L}*|референс\p{L}*|приклад\p{L}*|джерел\p{L}*\s+факт\p{L}*))`;
  return (
    new RegExp(`${protection}[^.!?\\n—]{0,120}$`, "iu").test(before) ||
    new RegExp(`${referenceOnly}[^.!?\\n—]{0,90}$`, "iu").test(before)
  );
}

function isGroupedReferenceOnlyMention(rawTask: string, rawMention: string) {
  const normalizedMention = normalizePath(rawMention);
  const fileName = path.basename(normalizedMention);
  if (!fileName) return false;
  const occurrence = new RegExp(
    `(?:${escapeRegExp(normalizedMention).replace(/\//g, String.raw`[\\/]`)}|${escapeRegExp(fileName)})`,
    "giu",
  );
  const cue = /(?:only\s+as\s+(?:(?:(?:a|an|the)\s+)?(?:[A-Za-z][A-Za-z0-9_+./-]*\s+){0,4}reference(?:\s+provider)?s?|(?:(?:a|an|the)\s+)?sources?\s+of\s+(?:facts?|truth))|as\s+(?:(?:(?:a|an|the)\s+)?(?:[A-Za-z][A-Za-z0-9_+./-]*\s+){0,4}reference(?:\s+provider)?s?|(?:(?:a|an|the)\s+)?sources?\s+of\s+(?:facts?|truth))(?:\s+only)?|reference(?:\s+provider)?s?\s+only|read[-\s]?only|только\s+(?:как\s+)?(?:справк\p{L}*|референс\p{L}*|пример\p{L}*|источник\p{L}*\s+факт\p{L}*)|лишь\s+(?:как\s+)?(?:справк\p{L}*|референс\p{L}*|пример\p{L}*|источник\p{L}*\s+факт\p{L}*))/giu;

  for (const match of rawTask.matchAll(occurrence)) {
    const absoluteStart = match.index ?? 0;
    const prefixText = rawTask.slice(0, absoluteStart);
    const previousStops = [...prefixText.matchAll(/[;!?\n]|\.(?=\s|$)/gu)];
    const previousStop = previousStops.at(-1);
    const clauseStart = previousStop
      ? (previousStop.index ?? 0) + previousStop[0].length
      : 0;
    const suffixText = rawTask.slice(absoluteStart);
    const nextStop = suffixText.match(/[;!?\n]|\.(?=\s|$)/u);
    const clauseEnd = nextStop?.index !== undefined
      ? absoluteStart + nextStop.index
      : rawTask.length;
    const clause = rawTask.slice(clauseStart, clauseEnd);
    const mentionStart = absoluteStart - clauseStart;
    const mentionEnd = mentionStart + (match[0]?.length ?? fileName.length);

    for (const cueMatch of clause.matchAll(cue)) {
      const cueStart = cueMatch.index ?? 0;
      if (cueStart < mentionEnd) continue;
      const prefix = clause.slice(0, cueStart);
      const englishActions = [...prefix.matchAll(/\b(?:use|treat|keep)\b/giu)];
      const englishAction = englishActions.at(-1);
      if (englishAction) {
        const actionEnd = (englishAction.index ?? 0) + englishAction[0].length;
        if (mentionStart >= actionEnd) return true;
        continue;
      }

      const slavicActions = [
        ...prefix.matchAll(/(?:используй|использовать|використовуй|використовувати)/giu),
      ];
      const slavicAction = slavicActions.at(-1);
      if (slavicAction) {
        const actionStart = slavicAction.index ?? 0;
        const actionEnd = actionStart + slavicAction[0].length;
        if (mentionStart >= actionEnd || mentionEnd <= actionStart) return true;
        continue;
      }

      if (mentionEnd <= cueStart) return true;
    }
  }

  return false;
}

function isDirectFileTargetContext(before: string) {
  return (
    /(?:edit|change|update|fix|modify|delete|remove|rename|move|create|generate|write|open|inspect|review|редактир\p{L}*|измен\p{L}*|обнов\p{L}*|исправ\p{L}*|почин\p{L}*|удал\p{L}*|переимен\p{L}*|перемест\p{L}*|созда\p{L}*|сгенерир\p{L}*|напиш\p{L}*|откр\p{L}*|проверь\p{L}*)\s+(?:the\s+)?(?:file\s+|файл\s+)?$/iu.test(
      before,
    ) ||
    /(?:in|inside|within)\s+(?:the\s+)?(?:file\s+)?$/iu.test(before) ||
    /(?:в|внутри)\s+(?:файл(?:е|а)?\s+)?$/iu.test(before) ||
    /(?:file|файл)\s+$/iu.test(before)
  );
}

/**
 * Distinguishes a source-file edit target from a filename used as the name of
 * a generated artifact or UI action. A clear editable occurrence wins; a
 * filename is suppressed only when every occurrence is clearly non-editable.
 */
export function classifyFileMentionSemanticRole(
  rawTask: string,
  rawMention: string,
): FileMentionSemanticRole {
  const normalized = normalizePath(rawMention);
  const contexts = getMentionContexts(rawTask, normalized);
  if (contexts.length === 0) return "ambiguous";
  if (isGroupedReferenceOnlyMention(rawTask, normalized))
    return "artifact-reference";

  let artifactReferences = 0;
  for (const context of contexts) {
    if (
      isUiActionArtifactContext(context.before) ||
      isProtectedBeforeContext(context.before)
    ) {
      artifactReferences += 1;
      continue;
    }

    // Explicit protection must outrank the generic "in <file>" target
    // heuristic. A path used to demonstrate an existing provider remains
    // reference-only when the following clause forbids editing it.
    if (isProtectedReferenceContext(context.before, context.after)) {
      artifactReferences += 1;
      continue;
    }

    if (isDirectFileTargetContext(context.before)) {
      return "editable-target";
    }

    if (isProcessArtifactContext(context.before, context.after)) {
      artifactReferences += 1;
      continue;
    }

  }

  return artifactReferences === contexts.length
    ? "artifact-reference"
    : "ambiguous";
}

export function isExplicitFileTargetMention(
  rawTask: string,
  rawMention: string,
) {
  return (
    classifyFileMentionSemanticRole(rawTask, rawMention) !==
    "artifact-reference"
  );
}


const NEGATIVE_CREATE_ACTION = String.raw`(?:do\s+not|don't|dont|must\s+not|should\s+not|never)\s+(?:create|add|introduce|generate|write|make|build)|(?:не\s+(?:создавай|создавать|добавляй|добавлять|генерируй|генерировать|делай|делать)|никогда\s+не\s+(?:создавай|создавать|добавляй|добавлять))`;

/**
 * Returns true when the raw user wording explicitly forbids creating the
 * named missing path. This is deliberately separate from edit-target
 * classification: an existing file may still be editable, while a missing
 * file must never be synthesized against an explicit "do not create" clause.
 */
export function isExplicitFileCreationForbidden(
  rawTask: string,
  rawMention: string,
) {
  const normalizedMention = normalizePath(rawMention);
  const mentionName = path.basename(normalizedMention);
  const contexts = getMentionContexts(rawTask, normalizedMention);
  const escapedPath = escapeRegExp(normalizedMention).replace(
    /\//g,
    String.raw`[\\/]`,
  );
  const escapedName = escapeRegExp(mentionName);
  const directNamed = new RegExp(
    String.raw`(?:${NEGATIVE_CREATE_ACTION})[^.!?\n—]{0,90}(?:${escapedPath}|${escapedName})(?=$|[^\p{L}\p{N}_])`,
    "iu",
  );
  if (directNamed.test(rawTask)) return true;

  const referent = String.raw`(?:(?:either|both|any|all|none|neither)\s+(?:of\s+)?(?:these|those|the)?\s*)?(?:(?:the|this|that|such)\s+)?(?:file|component|page|route|module|path|screen|view)s?|(?:it|them)|(?:(?:этот|эту|это|данный|такой|указанный)\s+)?(?:файл|компонент|страниц\p{L}*|маршрут|роут|модул\p{L}*|путь|экран)\p{L}*|(?:ни\s+один|оба|все)\s+(?:из\s+)?(?:этих\s+)?(?:файл|компонент|страниц|маршрут|роут|модул)\p{L}*`;
  const directBefore = new RegExp(
    String.raw`(?:${NEGATIVE_CREATE_ACTION})\s+(?:(?:the|this|that)\s+)?(?:file|component|page|route|module|path)?\s*$`,
    "iu",
  );
  const coreferenceAfter = new RegExp(
    String.raw`^[\s\S]{0,220}(?:${NEGATIVE_CREATE_ACTION})\s+(?:${referent})(?=$|[\s,.;:!?])`,
    "iu",
  );

  return contexts.some(
    ({ before, after }) =>
      directBefore.test(before) || coreferenceAfter.test(after),
  );
}


/**
 * Resolves explicit paths that are absent from the real inventory and whose
 * creation the user explicitly forbade. This precondition is intentionally
 * inventory-backed so a model-selected existing file cannot silently replace
 * the missing named target.
 */
export function resolveCreationForbiddenMissingPaths(
  rawTask: string,
  inventory: ProjectInventory,
) {
  return resolveExplicitFileMentions(rawTask, inventory).missingPaths.filter(
    (pathValue) => isExplicitFileCreationForbidden(rawTask, pathValue),
  );
}

function normalizePath(value: string) {
  return value
    .replace(/\\/g, "/")
    .replace(/[“”«»]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim()
    .replace(/^['"`]+|['"`.,;:!?]+$/g, "")
    .replace(/\/+/g, "/");
}

function normalizeForCompare(value: string) {
  return normalizePath(value).toLowerCase();
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const normalized = normalizeForCompare(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalizePath(value));
  }

  return out;
}

function looksLikeFilePath(value: string) {
  const normalized = normalizePath(value);
  if (!normalized) return false;
  if (SPECIAL_CONFIG_FILE_PATTERN.test(normalized)) return true;
  if (!new RegExp(`\\.(${FILE_EXTENSION_PATTERN})$`, "i").test(normalized))
    return false;
  // Avoid treating plain prose with spaces as a file path unless it has a slash.
  if (normalized.includes(" ") && !normalized.includes("/")) return false;
  return true;
}

function extractStrictPathMentions(rawTask: string) {
  const mentions: string[] = [];

  // Prefer a conservative no-whitespace path matcher first. It handles route
  // groups such as app/(site)/admin/page.tsx without swallowing surrounding prose.
  const compactSlashPathRegex = new RegExp(
    `(?:^|[\\s(\\[{'"\`])((?:[A-Za-z]:)?(?:[A-Za-z0-9_.@()\\[\\]{}+~$!#%&=,'\`^-]+[\\\\/])+[A-Za-z0-9_.@()\\[\\]{}+~$!#%&=,'\`^-]+\\.(?:${FILE_EXTENSION_PATTERN}))(?=$|[\\s)\\]}'"\`.,;:!?])`,
    "gi",
  );
  for (const match of rawTask.matchAll(compactSlashPathRegex)) {
    if (match[1]) mentions.push(match[1]);
  }

  // Explicit slash/backslash paths, including Windows absolute paths.
  const slashPathRegex = new RegExp(
    `(?:^|[\\s(\\[{'\"\`])((?:[A-Za-z]:)?[${PATH_CHARS}]+(?:[\\\\/][${PATH_CHARS}]+)+\\.(?:${FILE_EXTENSION_PATTERN}))(?=$|[\\s)\\]}'\"\`.,;:!?])`,
    "gi",
  );

  for (const match of rawTask.matchAll(slashPathRegex)) {
    if (match[1]) mentions.push(match[1]);
  }

  // Standalone filenames with extensions: App.js, README.md, package.json.
  const fileNameRegex = new RegExp(
    `\\b([A-Za-z0-9_@()\\[\\].-]+\\.(?:${FILE_EXTENSION_PATTERN}))\\b`,
    "gi",
  );
  for (const match of rawTask.matchAll(fileNameRegex)) {
    if (match[1]) mentions.push(match[1]);
  }

  return mentions;
}

function extractLoosePathMentions(rawTask: string) {
  const mentions: string[] = [];

  // Human shorthand: "src app.js", "src app js", "components button.tsx".
  const looseRegex = new RegExp(
    `\\b(src|app|apps|client|server|components|component|pages|page|shared|lib|utils|styles|style|api)\\s+([A-Za-z0-9_@()\\[\\].-]+)(?:\\s+(${FILE_EXTENSION_PATTERN}))?\\b`,
    "gi",
  );

  for (const match of rawTask.matchAll(looseRegex)) {
    const folder = match[1];
    const name = match[2];
    const ext = match[3];
    if (!folder || !name) continue;

    const candidateName = name.includes(".")
      ? name
      : ext
        ? `${name}.${ext}`
        : name;
    if (!looksLikeFilePath(candidateName)) continue;
    mentions.push(`${folder}/${candidateName}`);
  }

  return mentions;
}

function extractSpecialConfigMentions(rawTask: string) {
  const mentions: string[] = [];
  const matcher =
    /(?:^|[\s(\[{'"`])((?:(?:[A-Za-z0-9_.@()\[\]{}+~$!#%&=,;:'`^-]+)[\\/])*(?:\.env(?:\.[A-Za-z0-9_.-]+)?|Dockerfile(?:\.[A-Za-z0-9_.-]+)?|Makefile))(?=$|[\s)\]}'"`,;:!?])/giu;
  for (const match of rawTask.matchAll(matcher)) {
    if (match[1]) mentions.push(match[1]);
  }
  return mentions;
}

function extractNamedDocumentMentions(rawTask: string) {
  const mentions: string[] = [];
  if (
    /\breadme(?:\.md)?\b/i.test(rawTask) ||
    /(?:^|\s)ридми(?:\s|$|[.,;:!?])/iu.test(rawTask)
  ) {
    mentions.push("README.md");
  }
  return mentions;
}

/**
 * Extracts file-like targets from the user's wording without requiring the
 * path to exist yet. This is intentionally inventory-independent so create
 * tasks can keep an explicit destination as evidence instead of replacing it
 * with a guessed existing file.
 */
export function extractExplicitFileTargetMentions(rawTask: string) {
  return extractClassifiedFileMentions(rawTask)
    .filter((mention) => mention.role !== "artifact-reference")
    .map((mention) => mention.path);
}

/**
 * Returns every file-like mention together with its semantic role. This keeps
 * protected/reference files available for verification context without ever
 * promoting them to edit targets.
 */
export function extractClassifiedFileMentions(
  rawTask: string,
): ClassifiedFileMention[] {
  const candidates = uniqueStrings([
    ...extractStrictPathMentions(rawTask),
    ...extractLoosePathMentions(rawTask),
    ...extractNamedDocumentMentions(rawTask),
    ...extractSpecialConfigMentions(rawTask),
  ]).filter(looksLikeFilePath);
  const compactPaths = candidates.filter(
    (candidate) => candidate.includes("/") && !candidate.includes(" "),
  );
  const canonicalCandidates = candidates.filter((candidate) => {
    const normalized = normalizeForCompare(candidate);
    if (
      candidate.includes(" ") &&
      compactPaths.some(
        (compact) =>
          normalizeForCompare(compact) !== normalized &&
          normalized.includes(normalizeForCompare(compact)),
      )
    ) {
      return false;
    }
    if (
      !candidate.includes("/") &&
      compactPaths.some(
        (compact) => path.basename(normalizeForCompare(compact)) === normalized,
      )
    ) {
      return false;
    }
    return true;
  });

  return canonicalCandidates.map((filePath) => ({
    path: filePath,
    role: classifyFileMentionSemanticRole(rawTask, filePath),
  }));
}

function getFileName(filePath: string) {
  return normalizePath(filePath).split("/").pop() ?? filePath;
}

function scoreFileNameMatch(file: ProjectInventoryFile) {
  const normalizedPath = normalizeForCompare(file.path);
  let score = 0;

  // Prefer app/source files over tests when a user names App.js.
  if (normalizedPath.includes(".test.") || normalizedPath.includes(".spec."))
    score -= 50;
  if (normalizedPath.startsWith("src/")) score += 12;
  if (normalizedPath.includes("/components/")) score += 5;
  if (normalizedPath.endsWith("package.json")) score += 8;
  if (file.kind === "source") score += 10;
  if (file.kind === "docs") score += 7;
  if (file.kind === "config") score += 4;
  score -= Math.min(20, normalizePath(file.path).split("/").length);

  return score;
}

function findBestInventoryMatch(
  inventory: ProjectInventory,
  rawMention: string,
): ExplicitFileMention {
  const normalized = normalizePath(rawMention);
  const comparable = normalizeForCompare(normalized);
  const files = inventory.files;

  const exact = files.find(
    (file) => normalizeForCompare(file.path) === comparable,
  );
  if (exact) {
    return {
      raw: rawMention,
      normalized,
      matchedPath: exact.path,
      matchKind: "exact",
    };
  }

  const absoluteSuffix = files.find((file) =>
    comparable.endsWith(`/${normalizeForCompare(file.path)}`),
  );
  if (absoluteSuffix) {
    return {
      raw: rawMention,
      normalized,
      matchedPath: absoluteSuffix.path,
      matchKind: "absolute-suffix",
    };
  }

  const relativeSuffix = files.find((file) =>
    normalizeForCompare(file.path).endsWith(`/${comparable}`),
  );
  if (relativeSuffix) {
    return {
      raw: rawMention,
      normalized,
      matchedPath: relativeSuffix.path,
      matchKind: "relative-suffix",
    };
  }

  // A path-like mention is an explicit location contract. Falling back to any
  // file with the same basename (for example another page.tsx) hides missing
  // targets and can produce unsafe substitute edits.
  if (normalized.includes("/")) {
    return { raw: rawMention, normalized };
  }

  const mentionName = path.basename(normalized).toLowerCase();
  const sameFileName = files
    .filter((file) => getFileName(file.path).toLowerCase() === mentionName)
    .map((file) => ({ file, score: scoreFileNameMatch(file) }))
    .sort((a, b) => b.score - a.score)[0]?.file;

  if (sameFileName) {
    return {
      raw: rawMention,
      normalized,
      matchedPath: sameFileName.path,
      matchKind: "file-name",
    };
  }

  return { raw: rawMention, normalized };
}

export function resolveExplicitFileMentions(
  rawTask: string,
  inventory: ProjectInventory,
): ExplicitFileMentionResolution {
  const rawMentions = extractExplicitFileTargetMentions(rawTask);

  const mentions = rawMentions.map((mention) =>
    findBestInventoryMatch(inventory, mention),
  );

  return {
    mentions,
    existingPaths: uniqueStrings(
      mentions.map((mention) => mention.matchedPath ?? "").filter(Boolean),
    ),
    missingPaths: uniqueStrings(
      mentions
        .filter((mention) => !mention.matchedPath)
        .map((mention) => mention.raw),
    ),
  };
}
