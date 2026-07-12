const REPLACEMENT_VERB_PATTERN =
  /(?:\b(?:change|replace|update|rename|set|edit|modify|rewrite)\b|измени|изменить|замени|заменить|обнови|обновить|переименуй|переименовать|поменяй|поменять|перепиши|переписать|установи|установить|задай|задать)/iu;
const REPLACEABLE_VALUE_PATTERN =
  /(?:\b(?:text|copy|label|title|heading|description|message|placeholder|value|name|color|icon|wording|url|endpoint|timeout|limit|version|email|path|port|size)\b|текст|пояснен\w*|надпис\w*|заголов\w*|описан\w*|сообщен\w*|плейсхолдер\w*|значен\w*|назван\w*|цвет\w*|икон\w*|формулиров\w*|url|адрес\w*|эндпоинт\w*|таймаут\w*|лимит\w*|верси\w*|почт\w*|путь|порт\w*|размер\w*)/iu;
const TRANSFORMATION_GOAL_PATTERN =
  /(?:\b(?:shorter|clearer|more\s+concise|more\s+helpful|friendlier|accessible)\b|короче|понятнее|яснее|информативнее|дружелюбнее|лаконичнее)/iu;
const LOCATION_VALUE_PREFIX_PATTERN =
  /^(?:(?:the\s+)?(?:page|screen|component|file|section|field|button|card|modal|form|table|panel|route|module)\b|(?:страниц[\p{L}\p{N}_-]*|экран[\p{L}\p{N}_-]*|компонент[\p{L}\p{N}_-]*|файл[\p{L}\p{N}_-]*|секци[\p{L}\p{N}_-]*|раздел[\p{L}\p{N}_-]*|пол(?:е|я|ю|ем)|кнопк[\p{L}\p{N}_-]*|карточк[\p{L}\p{N}_-]*|модал[\p{L}\p{N}_-]*|форм[\p{L}\p{N}_-]*|таблиц[\p{L}\p{N}_-]*|панел[\p{L}\p{N}_-]*|маршрут[\p{L}\p{N}_-]*|модул[\p{L}\p{N}_-]*)(?=$|[^\p{L}\p{N}_-]))/iu;
const REPLACEMENT_CONNECTORS = new Set(["to", "with", "as", "на"]);
const QUOTE_PAIRS = [
  ['"', '"'],
  ["'", "'"],
  ['`', '`'],
  ['«', '»'],
  ['“', '”'],
  ['‘', '’'],
] as const;
const CLARIFICATION_VALUE_PATTERN =
  /User-provided clarification value \(JSON\):\s*("(?:\\.|[^"\\])*")/giu;

export type TaskValueKind =
  | "text"
  | "color"
  | "url"
  | "number"
  | "version"
  | "email"
  | "path"
  | "boolean"
  | "literal";

export interface ExplicitReplacementValue {
  provided: boolean;
  exactValue: string | null;
}

function stripTrailingTaskPunctuation(value: string) {
  return value.trim().replace(/[\s,;.!?]+$/u, "").trim();
}

function extractLeadingQuotedValue(value: string) {
  const trimmed = value.trimStart();
  for (const [open, close] of QUOTE_PAIRS) {
    if (!trimmed.startsWith(open)) {
      continue;
    }
    const end = trimmed.indexOf(close, open.length);
    if (end < 0) {
      return null;
    }
    const content = trimmed.slice(open.length, end).trim();
    return content.length > 0 ? content : null;
  }
  return null;
}

function isExactUnquotedLiteral(value: string) {
  return (
    /^(?:https?:\/\/\S+|mailto:\S+|#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla)\([^\n]+\)|[+-]?(?:\d+(?:[.,]\d+)?)(?:ms|s|sec|seconds?|px|rem|em|%|mb|gb|kb)?|v?\d+(?:\.\d+){1,3}|[\w.+-]+@[\w.-]+\.[a-z]{2,}|true|false|null)$/iu.test(
      value,
    ) ||
    /^[\p{L}_][\p{L}\p{N}_.-]{0,79}$/u.test(value)
  );
}

function parseReplacementCandidate(
  rawCandidate: string,
): ExplicitReplacementValue {
  const candidate = rawCandidate.trimStart();
  if (!candidate || LOCATION_VALUE_PREFIX_PATTERN.test(candidate)) {
    return { provided: false, exactValue: null };
  }

  const startsWithQuote = QUOTE_PAIRS.some(([open]) =>
    candidate.startsWith(open),
  );
  const quoted = extractLeadingQuotedValue(candidate);
  if (startsWithQuote) {
    return quoted !== null
      ? { provided: true, exactValue: quoted }
      : { provided: false, exactValue: null };
  }

  const firstLine = stripTrailingTaskPunctuation(
    candidate.split(/(?:\r?\n|;)/u, 1)[0] ?? "",
  );
  if (!firstLine) {
    return { provided: false, exactValue: null };
  }

  return {
    provided: true,
    exactValue: isExactUnquotedLiteral(firstLine) ? firstLine : null,
  };
}

export function extractExplicitReplacementValue(
  rawTask: string,
): ExplicitReplacementValue {
  const value = rawTask.trim();
  const verbMatch = REPLACEMENT_VERB_PATTERN.exec(value);
  if (!verbMatch || verbMatch.index === undefined) {
    return { provided: false, exactValue: null };
  }

  let clarificationMatch: RegExpExecArray | null = null;
  CLARIFICATION_VALUE_PATTERN.lastIndex = 0;
  for (const match of value.matchAll(CLARIFICATION_VALUE_PATTERN)) {
    clarificationMatch = match;
  }

  if (clarificationMatch?.[1]) {
    try {
      const exactValue = JSON.parse(clarificationMatch[1]);
      if (typeof exactValue === "string" && exactValue.trim()) {
        return { provided: true, exactValue };
      }
    } catch {
      // Ignore malformed clarification markers and keep evaluating the task.
    }
  }

  const tail = value.slice(verbMatch.index + verbMatch[0].length);
  for (const token of tail.matchAll(/[\p{L}\p{N}_]+/gu)) {
    const connector = token[0].toLowerCase();
    if (!REPLACEMENT_CONNECTORS.has(connector) || token.index === undefined) {
      continue;
    }
    const parsed = parseReplacementCandidate(
      tail.slice(token.index + token[0].length),
    );
    if (parsed.provided) {
      return parsed;
    }
  }

  const assignment = /(?:=|:)\s*([\s\S]+)$/u.exec(tail);
  if (assignment) {
    const parsed = parseReplacementCandidate(assignment[1]);
    if (parsed.provided) {
      return parsed;
    }
  }

  return { provided: false, exactValue: null };
}

export function taskRequestsReplaceableValue(rawTask: string) {
  const value = rawTask.trim();
  return (
    REPLACEMENT_VERB_PATTERN.test(value) &&
    REPLACEABLE_VALUE_PATTERN.test(value)
  );
}

export function hasTransformationGoal(rawTask: string) {
  return TRANSFORMATION_GOAL_PATTERN.test(rawTask.trim());
}

export function hasMissingReplacementValue(rawTask: string) {
  const explicitReplacement = extractExplicitReplacementValue(rawTask);
  return (
    taskRequestsReplaceableValue(rawTask) &&
    !explicitReplacement.provided &&
    !hasTransformationGoal(rawTask)
  );
}

export function classifyTaskValue(value: string): TaskValueKind {
  const normalized = value.trim();
  if (/^https?:\/\/\S+$/iu.test(normalized)) return "url";
  if (/^#[0-9a-f]{3,8}$/iu.test(normalized) || /^(?:rgb|rgba|hsl|hsla)\(/iu.test(normalized)) return "color";
  if (/^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/iu.test(normalized)) return "email";
  if (/^(?:true|false|null)$/iu.test(normalized)) return "boolean";
  if (/^v?\d+(?:\.\d+){1,3}$/iu.test(normalized)) return "version";
  if (/^[+-]?(?:\d+(?:[.,]\d+)?)(?:ms|s|sec|seconds?|px|rem|em|%|mb|gb|kb)?$/iu.test(normalized)) return "number";
  if (/^(?:[A-Za-z]:)?(?:[^\s/\\]+[\\/])+[^\s/\\]+$/u.test(normalized)) return "path";
  if (/\s/u.test(normalized) || normalized.length > 80) return "text";
  return "literal";
}
