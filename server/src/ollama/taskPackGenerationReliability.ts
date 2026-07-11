import { z } from "zod";

import type { AiProviderId } from "../ai/providerService.js";
import { generateWithConfiguredAi } from "../ai/providerService.js";
import { getAppSettings, type AppSettings } from "../settings/settingsService.js";
import {
  buildGenerationCacheKey,
  getCachedGeneration,
  setCachedGeneration,
} from "./generationCache.js";

const MAX_PROMPT_CHARS = 24_000;
const MAX_REPAIR_RESPONSE_CHARS = 8_000;
const MAX_RETRY_PROMPT_CHARS = 28_000;
const MAX_ITEM_CHARS = 600;

const REFINEMENT_ARRAY_LIMITS = {
  implementationGuidance: 10,
  constraints: 8,
  acceptanceCriteria: 10,
  verificationSteps: 10,
  finalResponseRequirements: 8,
} as const;

const POLICY_REFINEMENT_ARRAY_LIMITS = {
  implementationGuidance: 7,
  constraints: 5,
  acceptanceCriteria: 6,
  verificationSteps: 5,
  finalResponseRequirements: 4,
} as const;

const boundedLineSchema = z
  .string()
  .trim()
  .min(3)
  .max(MAX_ITEM_CHARS)
  .transform((value) => normalizeGuidanceLine(value));

export const taskPackRefinementSchema = z.object({
  implementationGuidance: z
    .array(boundedLineSchema)
    .min(1)
    .max(REFINEMENT_ARRAY_LIMITS.implementationGuidance),
  constraints: z
    .array(boundedLineSchema)
    .max(REFINEMENT_ARRAY_LIMITS.constraints)
    .default([]),
  acceptanceCriteria: z
    .array(boundedLineSchema)
    .min(1)
    .max(REFINEMENT_ARRAY_LIMITS.acceptanceCriteria),
  verificationSteps: z
    .array(boundedLineSchema)
    .min(1)
    .max(REFINEMENT_ARRAY_LIMITS.verificationSteps),
  finalResponseRequirements: z
    .array(boundedLineSchema)
    .min(1)
    .max(REFINEMENT_ARRAY_LIMITS.finalResponseRequirements),
});

export type TaskPackRefinement = z.infer<typeof taskPackRefinementSchema>;

export type TaskPackGenerationParseStage =
  | "direct-json"
  | "fenced-json"
  | "balanced-json"
  | "local-repair"
  | "failed"
  | "not-run";

export type TaskPackGenerationFailureCode =
  | "template_mode"
  | "model_not_configured"
  | "provider_error"
  | "empty_response"
  | "invalid_json"
  | "schema_invalid"
  | "truncated_response"
  | "retry_failed"
  | "composition_failed"
  | "semantic_policy_rejected";

export type TaskPackGenerationPolicyIssueCode =
  | "unauthorized_git_commit"
  | "unauthorized_git_push"
  | "unauthorized_git_merge"
  | "unauthorized_pull_request"
  | "unauthorized_git_tag"
  | "unauthorized_release_publish"
  | "forced_verification_claim"
  | "unselected_file_reference";

export type TaskPackGenerationAmbiguityCode =
  | "missing_replacement_value";

export type TaskPackGenerationConsistencyCode =
  | "clarification_mode_enabled"
  | "completion_requirements_deferred"
  | "verification_deferred"
  | "final_response_rewritten"
  | "semantic_duplicates_removed"
  | "section_limits_applied"
  | "explicit_value_grounded";

export interface TaskPackRefinementPolicyDiagnostics {
  acceptedItems: number;
  rejectedItems: number;
  rewrittenItems: number;
  injectedItems: number;
  consistencyAdjustedItems: number;
  deduplicatedItems: number;
  limitedItems: number;
  rejectionCodes: TaskPackGenerationPolicyIssueCode[];
  ambiguityCodes: TaskPackGenerationAmbiguityCode[];
  consistencyCodes: TaskPackGenerationConsistencyCode[];
}

export type TaskPackGenerationStatus =
  | "template"
  | "generated"
  | "repaired"
  | "retried"
  | "fallback";

export interface TaskPackGenerationAttemptDiagnostics {
  attempt: 1 | 2;
  phase: "initial" | "retry";
  durationMs: number;
  responseChars: number;
  parseStage: TaskPackGenerationParseStage;
  schemaValid: boolean;
  issueCodes: string[];
  providerError: boolean;
}

export interface TaskPackGenerationDiagnostics {
  version: 2;
  status: TaskPackGenerationStatus;
  provider: AiProviderId | null;
  model: string | null;
  cached: boolean;
  fallbackReason: TaskPackGenerationFailureCode | null;
  prompt: {
    originalChars: number;
    finalChars: number;
    budgetChars: number;
    compacted: boolean;
    truncatedFields: string[];
  };
  attempts: TaskPackGenerationAttemptDiagnostics[];
  output: {
    finalChars: number;
    refinementItems: number;
    validationIssueCodes: string[];
    policy: TaskPackRefinementPolicyDiagnostics;
  };
}

export interface ReliableTaskPackGenerationResult {
  content: string;
  mode: "template" | "ollama";
  model: string | null;
  usedFallback: boolean;
  message: string;
  durationMs: number;
  cached: boolean;
  diagnostics: TaskPackGenerationDiagnostics;
}

export interface TaskPackGenerationPromptInput {
  project: {
    name: string;
    packageManager: string | null;
    detectedStack: string[];
    readinessScore: number;
    scripts: Record<string, string>;
  };
  rawTask: string;
  taskType: string;
  targetTool: string;
  effectiveTaskArea: string;
  relevantFiles: Array<{
    path: string;
    usage: string;
    reason: string;
  }>;
  taskIntent?: {
    source?: string;
    taskArea?: string;
    riskLevel?: string;
    confidence?: number;
    structuredIntent?: {
      primaryTargets?: Array<{
        kind?: string;
        path?: string;
        routePath?: string;
        value?: string;
      }>;
      allowedEditScope?: string;
    } | null;
  };
  selectionQuality: {
    status: string;
    score: number;
    requiredManualReview: boolean;
    warnings: string[];
    blockingReasons: string[];
  };
  templatePrompt: string;
}

export interface TaskPackPromptBuildResult {
  prompt: string;
  diagnostics: TaskPackGenerationDiagnostics["prompt"];
}

interface GenerateReliableTaskPackInput extends TaskPackGenerationPromptInput {
  fallbackContent: string;
  bypassCache?: boolean;
  dependencies?: {
    getSettings?: () => Promise<AppSettings>;
    generate?: typeof generateWithConfiguredAi;
  };
}

interface ParsedRefinement {
  refinement: TaskPackRefinement | null;
  parseStage: TaskPackGenerationParseStage;
  issueCodes: string[];
}

const SECTION_REFINEMENTS: Array<{
  section: string;
  subsection: string;
  key: keyof TaskPackRefinement;
}> = [
  {
    section: "Agent Instructions",
    subsection: "AI-refined implementation guidance",
    key: "implementationGuidance",
  },
  {
    section: "Constraints",
    subsection: "Task-specific safeguards",
    key: "constraints",
  },
  {
    section: "Acceptance Criteria",
    subsection: "Task-specific acceptance checks",
    key: "acceptanceCriteria",
  },
  {
    section: "Verification",
    subsection: "Suggested verification",
    key: "verificationSteps",
  },
  {
    section: "Expected Final Response",
    subsection: "Additional response requirements",
    key: "finalResponseRequirements",
  },
];

function nowDuration(startedAt: number) {
  return Date.now() - startedAt;
}

function normalizeGuidanceLine(value: string) {
  return value
    .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, "")
    .replace(/^#{1,6}\s+/, "")
    .replace(/```/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_ITEM_CHARS);
}

function uniqueGuidanceLines(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const rawValue of values) {
    const value = normalizeGuidanceLine(rawValue);
    const key = value.toLowerCase();

    if (!value || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(value);
  }

  return result;
}

function normalizeStringArray(value: unknown) {
  if (typeof value === "string") {
    return uniqueGuidanceLines(
      value
        .split(/\r?\n|;/)
        .map((item) => item.trim())
        .filter(Boolean),
    );
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return uniqueGuidanceLines(
    value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

type RefinementKey = keyof TaskPackRefinement;

export interface TaskPackRefinementPolicyResult {
  refinement: TaskPackRefinement;
  diagnostics: TaskPackRefinementPolicyDiagnostics;
}

const GIT_ACTION_POLICIES: Array<{
  code: TaskPackGenerationPolicyIssueCode;
  pattern: RegExp;
}> = [
  {
    code: "unauthorized_git_commit",
    pattern:
      /(?:\b(?:commit\s+(?:the|these|your|this|changes?|work|update)|make\s+(?:a\s+)?commit|create\s+(?:a\s+)?commit|git\s+commit)\b|закоммит(?:ь|ить|ьте)|сдела(?:й|ть)\s+коммит|созда(?:й|ть)\s+коммит|зафиксиру(?:й|йте)\s+изменения)/iu,
  },
  {
    code: "unauthorized_git_push",
    pattern:
      /(?:\b(?:push(?:\s+(?:the|these|your|this))?\s+(?:changes|branch|commit)|git\s+push)\b|запуш(?:ь|ить|ьте)|отправ(?:ь|ить|ьте)\s+изменения\s+в\s+(?:git|github))/iu,
  },
  {
    code: "unauthorized_git_merge",
    pattern:
      /(?:\b(?:merge(?:\s+(?:the|this))?\s+(?:branch|pull request|pr|changes)|git\s+merge)\b|смёрж(?:ь|ить|ьте)|слей\s+(?:ветк|изменен))/iu,
  },
  {
    code: "unauthorized_pull_request",
    pattern:
      /(?:\b(?:open|create|submit)\s+(?:a\s+)?(?:pull request|pr)\b|созда(?:й|ть|йте)\s+(?:pull request|pr)|откро(?:й|ть|йте)\s+(?:pull request|pr))/iu,
  },
  {
    code: "unauthorized_git_tag",
    pattern:
      /(?:\b(?:(?:create|add|push)\s+(?:a\s+)?(?:git\s+)?tag|git\s+tag)\b|созда(?:й|ть|йте)\s+(?:git\s+)?тег|запуш(?:ь|ить|ьте)\s+тег)/iu,
  },
  {
    code: "unauthorized_release_publish",
    pattern:
      /(?:\b(?:(?:publish|create)\s+(?:a\s+)?release|publish\s+(?:the\s+)?package)\b|опублику(?:й|йте|ть)\s+релиз|созда(?:й|ть|йте)\s+релиз)/iu,
  },
];

const FORCED_VERIFICATION_CLAIM_PATTERNS = [
  /\b(?:confirm|state|report|claim|declare)\b[\s\S]{0,120}\b(?:successful(?:ly)?|passed|succeeded|works|verified|completed)\b/iu,
  /(?:подтверд(?:и|ить|ите)|заяв(?:и|ить|ите)|укаж(?:и|ите)|сообщ(?:и|ите))[\s\S]{0,120}(?:успешн|пройден|выполнен|работает|проверен|завершен)\w*/iu,
];

const PATH_REFERENCE_PATTERN = /(?:^|[\s("'`])((?:[A-Za-z0-9_@.-]+[\\/])+[A-Za-z0-9_@().-]+\.[A-Za-z0-9]{1,10})/g;
const FILE_REFERENCE_PATTERN = /\b([A-Za-z0-9_@().-]+\.(?:tsx?|jsx?|mjs|cjs|css|scss|sass|less|json|ya?ml|md|sql|py|java|cs|cpp|c|h|hpp))\b/g;

function emptyPolicyDiagnostics(): TaskPackRefinementPolicyDiagnostics {
  return {
    acceptedItems: 0,
    rejectedItems: 0,
    rewrittenItems: 0,
    injectedItems: 0,
    consistencyAdjustedItems: 0,
    deduplicatedItems: 0,
    limitedItems: 0,
    rejectionCodes: [],
    ambiguityCodes: [],
    consistencyCodes: [],
  };
}

function addUniqueCode<T extends string>(target: T[], code: T) {
  if (!target.includes(code)) {
    target.push(code);
  }
}

function isNegatedAction(value: string, index: number) {
  const prefix = value.slice(Math.max(0, index - 64), index).toLowerCase();
  return /(?:do\s+not|don't|never|must\s+not|without|не\s+надо|не\s+нужно|не|нельзя|запрещено|без)\s*(?:[\p{L}\p{N}_-]+\s*){0,4}$/iu.test(prefix);
}

function findPositiveAction(value: string, pattern: RegExp) {
  const flags = pattern.flags.includes("g")
    ? pattern.flags
    : `${pattern.flags}g`;
  const matcher = new RegExp(pattern.source, flags);

  for (const match of value.matchAll(matcher)) {
    if (!isNegatedAction(value, match.index ?? 0)) {
      return match;
    }
  }

  return null;
}

function taskAuthorizesAction(rawTask: string, pattern: RegExp) {
  return Boolean(findPositiveAction(rawTask, pattern));
}

function findUnauthorizedGitAction(
  item: string,
  rawTask: string,
): TaskPackGenerationPolicyIssueCode | null {
  for (const policy of GIT_ACTION_POLICIES) {
    const itemAction = findPositiveAction(item, policy.pattern);
    if (!itemAction) {
      continue;
    }

    if (!taskAuthorizesAction(rawTask, policy.pattern)) {
      return policy.code;
    }
  }

  return null;
}

function hasForcedVerificationClaim(item: string) {
  return FORCED_VERIFICATION_CLAIM_PATTERNS.some((pattern) => pattern.test(item));
}

function rewriteVerificationClaim(item: string) {
  const normalized = item.toLowerCase();
  const replacements: string[] = [];

  if (/\b(?:build|test|lint|typecheck|compile|script|command|сборк|тест|линт|тип|команд)\w*/iu.test(normalized)) {
    replacements.push(
      "Run the relevant available verification command and report the actual result; if it is not run or fails, state that clearly.",
    );
  }

  if (/\b(?:manual|manually|visual|visually|ui|page|screen|ручн|визуальн|страниц|экран)\w*/iu.test(normalized)) {
    replacements.push(
      "Perform the relevant manual check when possible and report what was actually verified; if it was not performed, state that clearly.",
    );
  }

  if (replacements.length === 0) {
    replacements.push(
      "Report only verification that was actually performed and its actual result; do not claim success for checks that were not run.",
    );
  }

  return replacements;
}

function collectReferencedFiles(item: string) {
  const references = new Set<string>();
  PATH_REFERENCE_PATTERN.lastIndex = 0;
  FILE_REFERENCE_PATTERN.lastIndex = 0;

  for (const match of item.matchAll(PATH_REFERENCE_PATTERN)) {
    references.add(match[1].replace(/\\/g, "/"));
  }

  for (const match of item.matchAll(FILE_REFERENCE_PATTERN)) {
    references.add(match[1]);
  }

  return Array.from(references);
}

function hasUnknownFileReference(
  item: string,
  relevantFiles: TaskPackGenerationPromptInput["relevantFiles"],
) {
  const references = collectReferencedFiles(item);
  if (references.length === 0) {
    return false;
  }

  const selectedPaths = new Set(
    relevantFiles.map((file) => file.path.replace(/\\/g, "/").toLowerCase()),
  );
  const selectedBasenames = new Set(
    relevantFiles.map((file) =>
      file.path.replace(/\\/g, "/").split("/").pop()!.toLowerCase(),
    ),
  );

  return references.some((reference) => {
    const normalized = reference.replace(/\\/g, "/").toLowerCase();
    const basename = normalized.split("/").pop()!;
    return !selectedPaths.has(normalized) && !selectedBasenames.has(basename);
  });
}

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

function parseReplacementCandidate(rawCandidate: string): ExplicitReplacementValue {
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

export function detectTaskPackAmbiguities(
  rawTask: string,
): TaskPackGenerationAmbiguityCode[] {
  const value = rawTask.trim();
  const explicitReplacement = extractExplicitReplacementValue(value);

  if (
    REPLACEMENT_VERB_PATTERN.test(value) &&
    REPLACEABLE_VALUE_PATTERN.test(value) &&
    !explicitReplacement.provided &&
    !TRANSFORMATION_GOAL_PATTERN.test(value)
  ) {
    return ["missing_replacement_value"];
  }

  return [];
}

type PushRefinementItemResult =
  | "added"
  | "duplicate"
  | "limit"
  | "invalid";

const SEMANTIC_DEDUPE_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "before",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "with",
  "within",
  "after",
  "should",
  "must",
  "ensure",
  "verify",
  "check",
  "и",
  "в",
  "во",
  "на",
  "по",
  "для",
  "из",
  "к",
  "с",
  "со",
  "что",
  "это",
  "до",
  "после",
  "или",
  "как",
  "при",
  "должен",
  "должна",
  "нужно",
  "надо",
  "убедись",
  "проверь",
]);

function semanticTokens(value: string) {
  return Array.from(
    new Set(
      normalizeGuidanceLine(value)
        .toLowerCase()
        .match(/[\p{L}\p{N}_-]{3,}/gu)
        ?.filter((token) => !SEMANTIC_DEDUPE_STOP_WORDS.has(token)) ?? [],
    ),
  );
}

function isSemanticDuplicate(left: string, right: string) {
  const normalizedLeft = normalizeGuidanceLine(left).toLowerCase();
  const normalizedRight = normalizeGuidanceLine(right).toLowerCase();

  if (normalizedLeft === normalizedRight) {
    return true;
  }

  if (
    Math.min(normalizedLeft.length, normalizedRight.length) >= 24 &&
    (normalizedLeft.includes(normalizedRight) ||
      normalizedRight.includes(normalizedLeft))
  ) {
    return true;
  }

  const leftTokens = semanticTokens(normalizedLeft);
  const rightTokens = semanticTokens(normalizedRight);
  if (leftTokens.length < 3 || rightTokens.length < 3) {
    return false;
  }

  const rightSet = new Set(rightTokens);
  const intersection = leftTokens.filter((token) => rightSet.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return intersection >= 3 && union > 0 && intersection / union >= 0.78;
}

function pushRefinementItem(
  target: TaskPackRefinement,
  key: RefinementKey,
  item: string,
): PushRefinementItemResult {
  const normalized = normalizeGuidanceLine(item);
  if (!normalized) {
    return "invalid";
  }

  const current = target[key];
  if (current.some((existing) => isSemanticDuplicate(existing, normalized))) {
    return "duplicate";
  }

  if (current.length >= POLICY_REFINEMENT_ARRAY_LIMITS[key]) {
    return "limit";
  }

  current.push(normalized);
  return "added";
}

const PREPARATORY_GUIDANCE_PATTERN =
  /(?:\b(?:identify|locate|inspect|review|determine|confirm|find)\b|определи|найди|проверь|изучи|уточни)/iu;
const MUTATION_GUIDANCE_PATTERN =
  /(?:\b(?:modify|change|replace|update|edit|add|remove|implement|create|write|set|rename|rewrite|adjust|alter)\b|измени|замени|обнови|добавь|удали|реализуй|создай|переименуй|перепиши|скорректируй)/iu;
const VERIFICATION_GUIDANCE_PATTERN =
  /(?:\b(?:run|build|test|verify|compile|lint|typecheck|render|navigate|execute)\b|запусти|собери|протестируй|проверь\s+(?:сборк|тест|рендер)|скомпилируй)/iu;

function isSafePreparatoryGuidance(item: string) {
  return (
    PREPARATORY_GUIDANCE_PATTERN.test(item) &&
    !MUTATION_GUIDANCE_PATTERN.test(item) &&
    !VERIFICATION_GUIDANCE_PATTERN.test(item)
  );
}

function totalRefinementItems(refinement: TaskPackRefinement) {
  return Object.values(refinement).reduce((sum, items) => sum + items.length, 0);
}

function refinementContainsExactValue(
  refinement: TaskPackRefinement,
  exactValue: string,
) {
  const needle = exactValue.trim().toLowerCase();
  return Object.values(refinement).some((items) =>
    items.some((item) => item.toLowerCase().includes(needle)),
  );
}

function buildExactValueGroundingInstruction(exactValue: string) {
  return `Use the exact user-provided replacement value without paraphrasing: ${JSON.stringify(exactValue)}.`;
}

function applyMissingReplacementConsistency(
  refinement: TaskPackRefinement,
  diagnostics: TaskPackRefinementPolicyDiagnostics,
) {
  const before = totalRefinementItems(refinement);
  const preservedPreparation = refinement.implementationGuidance
    .filter(isSafePreparatoryGuidance)
    .slice(0, 2);
  const preservedConstraints = refinement.constraints.filter(
    (item) =>
      !findPositiveAction(item, MUTATION_GUIDANCE_PATTERN) &&
      !findPositiveAction(item, VERIFICATION_GUIDANCE_PATTERN),
  );

  refinement.implementationGuidance = [];
  refinement.constraints = [];
  refinement.acceptanceCriteria = [];
  refinement.verificationSteps = [];
  refinement.finalResponseRequirements = [];

  for (const item of preservedPreparation) {
    pushRefinementItem(refinement, "implementationGuidance", item);
  }
  pushRefinementItem(
    refinement,
    "implementationGuidance",
    "Identify the selected target and ask the user for the exact replacement text or value before editing.",
  );

  pushRefinementItem(
    refinement,
    "constraints",
    "The exact replacement text or value was not provided. Do not invent it; ask for clarification before editing and leave project files unchanged until the user supplies it.",
  );
  for (const item of preservedConstraints) {
    pushRefinementItem(refinement, "constraints", item);
  }

  pushRefinementItem(
    refinement,
    "acceptanceCriteria",
    "Current-run acceptance gate: obtain the exact replacement value from the user and make no project changes before it is supplied.",
  );
  pushRefinementItem(
    refinement,
    "acceptanceCriteria",
    "After clarification, keep the implementation limited to the selected target and the user-provided value.",
  );

  pushRefinementItem(
    refinement,
    "verificationSteps",
    "Do not run implementation verification before the missing value is provided and a code change is made.",
  );
  pushRefinementItem(
    refinement,
    "verificationSteps",
    "After implementation, run only relevant available checks and report their actual results, including failures or checks not run.",
  );

  pushRefinementItem(
    refinement,
    "finalResponseRequirements",
    "Until clarification is provided, report that no files were changed and ask for the exact replacement text or value.",
  );
  pushRefinementItem(
    refinement,
    "finalResponseRequirements",
    "State that implementation verification was not run because the task is blocked by the missing required value.",
  );

  const after = totalRefinementItems(refinement);
  diagnostics.consistencyAdjustedItems += Math.max(before, after);
  addUniqueCode(diagnostics.consistencyCodes, "clarification_mode_enabled");
  addUniqueCode(diagnostics.consistencyCodes, "completion_requirements_deferred");
  addUniqueCode(diagnostics.consistencyCodes, "verification_deferred");
  addUniqueCode(diagnostics.consistencyCodes, "final_response_rewritten");
}

export function enforceTaskPackRefinementPolicy(
  refinement: TaskPackRefinement,
  input: Pick<TaskPackGenerationPromptInput, "rawTask" | "relevantFiles">,
): TaskPackRefinementPolicyResult {
  const diagnostics = emptyPolicyDiagnostics();
  const safeRefinement: TaskPackRefinement = {
    implementationGuidance: [],
    constraints: [],
    acceptanceCriteria: [],
    verificationSteps: [],
    finalResponseRequirements: [],
  };

  const recordPush = (key: RefinementKey, item: string) => {
    const result = pushRefinementItem(safeRefinement, key, item);
    if (result === "duplicate") {
      diagnostics.deduplicatedItems += 1;
      addUniqueCode(
        diagnostics.consistencyCodes,
        "semantic_duplicates_removed",
      );
    } else if (result === "limit") {
      diagnostics.limitedItems += 1;
      addUniqueCode(diagnostics.consistencyCodes, "section_limits_applied");
    }
    return result;
  };

  const keys = Object.keys(safeRefinement) as RefinementKey[];

  for (const key of keys) {
    for (const item of refinement[key]) {
      const gitIssue = findUnauthorizedGitAction(item, input.rawTask);
      if (gitIssue) {
        diagnostics.rejectedItems += 1;
        addUniqueCode(diagnostics.rejectionCodes, gitIssue);
        continue;
      }

      if (hasUnknownFileReference(item, input.relevantFiles)) {
        diagnostics.rejectedItems += 1;
        addUniqueCode(diagnostics.rejectionCodes, "unselected_file_reference");
        continue;
      }

      if (hasForcedVerificationClaim(item)) {
        diagnostics.rejectedItems += 1;
        diagnostics.rewrittenItems += 1;
        addUniqueCode(diagnostics.rejectionCodes, "forced_verification_claim");
        const targetKey: RefinementKey =
          key === "finalResponseRequirements"
            ? "finalResponseRequirements"
            : "verificationSteps";
        for (const replacement of rewriteVerificationClaim(item)) {
          recordPush(targetKey, replacement);
        }
        continue;
      }

      recordPush(key, item);
    }
  }

  diagnostics.ambiguityCodes = detectTaskPackAmbiguities(input.rawTask);
  const explicitReplacement = extractExplicitReplacementValue(input.rawTask);

  if (diagnostics.ambiguityCodes.includes("missing_replacement_value")) {
    diagnostics.injectedItems += 1;
    applyMissingReplacementConsistency(safeRefinement, diagnostics);
  } else if (
    explicitReplacement.exactValue &&
    !refinementContainsExactValue(
      safeRefinement,
      explicitReplacement.exactValue,
    )
  ) {
    const result = recordPush(
      "constraints",
      buildExactValueGroundingInstruction(explicitReplacement.exactValue),
    );
    if (result === "added") {
      diagnostics.injectedItems += 1;
      addUniqueCode(
        diagnostics.consistencyCodes,
        "explicit_value_grounded",
      );
    }
  }

  diagnostics.acceptedItems = totalRefinementItems(safeRefinement);

  return {
    refinement: safeRefinement,
    diagnostics,
  };
}

function normalizeRefinementObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const input = value as Record<string, unknown>;
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      if (key in input) {
        return input[key];
      }
    }
    return undefined;
  };

  return {
    implementationGuidance: normalizeStringArray(
      pick(
        "implementationGuidance",
        "implementation_guidance",
        "implementationPlan",
        "implementation_plan",
        "agentInstructions",
        "instructions",
      ),
    ),
    constraints: normalizeStringArray(
      pick("constraints", "safeguards", "taskConstraints", "task_constraints"),
    ),
    acceptanceCriteria: normalizeStringArray(
      pick(
        "acceptanceCriteria",
        "acceptance_criteria",
        "acceptanceChecks",
        "acceptance_checks",
      ),
    ),
    verificationSteps: normalizeStringArray(
      pick(
        "verificationSteps",
        "verification_steps",
        "verification",
        "checks",
      ),
    ),
    finalResponseRequirements: normalizeStringArray(
      pick(
        "finalResponseRequirements",
        "final_response_requirements",
        "expectedFinalResponse",
        "expected_final_response",
        "finalResponse",
        "final_response",
      ),
    ),
  };
}

function cleanupJsonCandidate(value: string) {
  return value
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1")
    .replace(/,\s*([}\]])/g, "$1")
    .trim();
}

function parseJsonCandidate(value: string) {
  const candidate = cleanupJsonCandidate(value);

  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    return null;
  }
}

function extractBalancedJsonObjects(value: string) {
  const fragments: string[] = [];

  for (let start = 0; start < value.length; start += 1) {
    if (value[start] !== "{") {
      continue;
    }

    let depth = 1;
    let inString = false;
    let escaped = false;

    for (let index = start + 1; index < value.length; index += 1) {
      const char = value[index];

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }

        if (char === "\\") {
          escaped = true;
          continue;
        }

        if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }

      if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
      }

      if (depth === 0) {
        fragments.push(value.slice(start, index + 1));
        break;
      }
    }
  }

  return fragments;
}

function looksTruncated(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return false;
  }

  const opens = (trimmed.match(/{/g) ?? []).length;
  const closes = (trimmed.match(/}/g) ?? []).length;
  const quoteCount = (trimmed.match(/(?<!\\)"/g) ?? []).length;

  return opens > closes || quoteCount % 2 !== 0;
}

function issueCodesFromZod(error: z.ZodError) {
  return Array.from(
    new Set(
      error.issues.map((issue) => {
        const path = issue.path.join(".") || "root";
        return `schema:${path}:${issue.code}`;
      }),
    ),
  );
}

export function parseTaskPackRefinement(value: string): ParsedRefinement {
  const trimmed = value.trim();

  if (!trimmed) {
    return {
      refinement: null,
      parseStage: "failed",
      issueCodes: ["empty_response"],
    };
  }

  const candidates: Array<{
    stage: TaskPackGenerationParseStage;
    value: unknown;
  }> = [];

  const direct = parseJsonCandidate(trimmed);
  if (direct) {
    candidates.push({ stage: "direct-json", value: direct });
  }

  for (const match of trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const parsed = parseJsonCandidate(match[1]);
    if (parsed) {
      candidates.push({ stage: "fenced-json", value: parsed });
    }
  }

  for (const fragment of extractBalancedJsonObjects(trimmed)) {
    const parsed = parseJsonCandidate(fragment);
    if (parsed) {
      candidates.push({ stage: "balanced-json", value: parsed });
    }
  }

  if (candidates.length === 0) {
    return {
      refinement: null,
      parseStage: "failed",
      issueCodes: [looksTruncated(trimmed) ? "truncated_response" : "invalid_json"],
    };
  }

  let firstIssues: string[] = [];

  for (const candidate of candidates) {
    const directSchema = taskPackRefinementSchema.safeParse(candidate.value);
    if (directSchema.success) {
      return {
        refinement: directSchema.data,
        parseStage: candidate.stage,
        issueCodes: [],
      };
    }

    if (firstIssues.length === 0) {
      firstIssues = issueCodesFromZod(directSchema.error);
    }

    const repaired = taskPackRefinementSchema.safeParse(
      normalizeRefinementObject(candidate.value),
    );

    if (repaired.success) {
      return {
        refinement: repaired.data,
        parseStage: "local-repair",
        issueCodes: firstIssues,
      };
    }

    if (firstIssues.length === 0) {
      firstIssues = issueCodesFromZod(repaired.error);
    }
  }

  return {
    refinement: null,
    parseStage: "failed",
    issueCodes: firstIssues.length > 0 ? firstIssues : ["schema_invalid"],
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractSection(markdown: string, title: string) {
  const pattern = new RegExp(`^##\\s+${escapeRegExp(title)}\\s*$`, "m");
  const match = pattern.exec(markdown);

  if (!match) {
    return "";
  }

  const contentStart = match.index + match[0].length;
  const rest = markdown.slice(contentStart);
  const nextHeading = rest.search(/^##\s+/m);
  const content = nextHeading === -1 ? rest : rest.slice(0, nextHeading);

  return content.trim();
}

function truncate(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return value;
  }

  const remaining = Math.max(0, maxChars - 24);
  return `${value.slice(0, remaining).trimEnd()}\n[truncated by ContextForge]`;
}

function getVerificationScripts(scripts: Record<string, string>) {
  const preferred = ["build", "test", "lint", "typecheck", "dev"];
  const selected: Record<string, string> = {};

  const addScript = (key: string, command: string) => {
    const safeKey = truncate(key.trim(), 80);
    const safeCommand = truncate(command.trim(), 500);

    if (safeKey && safeCommand) {
      selected[safeKey] = safeCommand;
    }
  };

  for (const key of preferred) {
    if (typeof scripts[key] === "string" && scripts[key].trim()) {
      addScript(key, scripts[key]);
    }
  }

  if (Object.keys(selected).length > 0) {
    return selected;
  }

  for (const [key, command] of Object.entries(scripts).slice(0, 5)) {
    if (typeof command === "string") {
      addScript(key, command);
    }
  }

  return selected;
}

function buildPromptPayload(
  input: TaskPackGenerationPromptInput,
  options: {
    fileLimit: number;
    reasonChars: number;
    sectionChars: number;
    taskChars: number;
  },
) {
  return {
    project: {
      name: truncate(input.project.name, 200),
      packageManager: input.project.packageManager
        ? truncate(input.project.packageManager, 80)
        : null,
      detectedStack: input.project.detectedStack
        .slice(0, 16)
        .map((item) => truncate(item, 100)),
      readinessScore: input.project.readinessScore,
      verificationScripts: getVerificationScripts(input.project.scripts),
    },
    task: truncate(input.rawTask, options.taskChars),
    taskAmbiguities: detectTaskPackAmbiguities(input.rawTask),
    taskType: input.taskType,
    targetTool: input.targetTool,
    effectiveTaskArea: input.effectiveTaskArea,
    selectedFiles: input.relevantFiles.slice(0, options.fileLimit).map((file) => ({
      path: file.path,
      usage: file.usage,
      reason: truncate(file.reason, options.reasonChars),
    })),
    intent: {
      source: input.taskIntent?.source ?? null,
      taskArea: input.taskIntent?.taskArea ?? null,
      riskLevel: input.taskIntent?.riskLevel ?? null,
      confidence: input.taskIntent?.confidence ?? null,
      targets:
        input.taskIntent?.structuredIntent?.primaryTargets?.slice(0, 8).map((target) => ({
          kind: target.kind,
          value: target.path ?? target.routePath ?? target.value,
        })) ?? [],
      allowedEditScope:
        input.taskIntent?.structuredIntent?.allowedEditScope ?? null,
    },
    selectionQuality: {
      status: input.selectionQuality.status,
      score: input.selectionQuality.score,
      requiredManualReview: input.selectionQuality.requiredManualReview,
      warnings: input.selectionQuality.warnings.slice(0, 6),
      blockingReasons: input.selectionQuality.blockingReasons.slice(0, 6),
    },
    existingSections: {
      agentInstructions: truncate(
        extractSection(input.templatePrompt, "Agent Instructions"),
        options.sectionChars,
      ),
      constraints: truncate(
        extractSection(input.templatePrompt, "Constraints"),
        options.sectionChars,
      ),
      acceptanceCriteria: truncate(
        extractSection(input.templatePrompt, "Acceptance Criteria"),
        options.sectionChars,
      ),
      verification: truncate(
        extractSection(input.templatePrompt, "Verification"),
        options.sectionChars,
      ),
      expectedFinalResponse: truncate(
        extractSection(input.templatePrompt, "Expected Final Response"),
        options.sectionChars,
      ),
    },
  };
}

function renderRefinementPrompt(payload: unknown) {
  return `You are ContextForge's local Task Pack refinement engine.

Return one JSON object only. Do not use Markdown fences or commentary.

Your output must match this exact schema:
{
  "implementationGuidance": ["1-7 concise, grounded instructions"],
  "constraints": ["0-5 task-specific safeguards"],
  "acceptanceCriteria": ["1-6 concrete completion checks"],
  "verificationSteps": ["1-5 commands or manual checks grounded in available scripts"],
  "finalResponseRequirements": ["1-4 items the coding agent must report"]
}

Rules:
- Preserve the user's actual task and scope.
- Use only real selected file paths and project facts from the payload.
- Do not invent files, APIs, scripts, dependencies, environment variables, or architecture.
- Respect inspect-only files: do not instruct the agent to edit them unless the task explicitly requires it.
- Do not repeat generic filler already present in existing sections.
- Do not include source code, snippets, secrets, absolute local paths, or raw project content.
- Do not instruct the coding agent to commit, push, merge, create a pull request, tag, or publish a release unless the user task explicitly requests that action.
- Never require the coding agent to claim that a build, test, or manual check succeeded. Require reporting the actual result, including failures or checks that were not run.
- If taskAmbiguities lists a missing value, switch to clarification mode: do not instruct implementation, do not require completion checks, and do not require build/test/manual verification before the value is supplied.
- In clarification mode, require a response stating that no files were changed and asking for the missing value.
- Avoid near-duplicate guidance across each array and keep only the most useful task-specific items.
- Keep each array item under ${MAX_ITEM_CHARS} characters.
- Verification may mention only scripts present in project.verificationScripts; otherwise use manual checks.
- Output valid JSON only.

Grounded Task Pack payload:
${JSON.stringify(payload, null, 2)}`;
}

export function buildTaskPackRefinementPrompt(
  input: TaskPackGenerationPromptInput,
): TaskPackPromptBuildResult {
  const initialPayload = buildPromptPayload(input, {
    fileLimit: 12,
    reasonChars: 260,
    sectionChars: 2_400,
    taskChars: 12_000,
  });
  const originalPrompt = renderRefinementPrompt(initialPayload);

  if (originalPrompt.length <= MAX_PROMPT_CHARS) {
    return {
      prompt: originalPrompt,
      diagnostics: {
        originalChars: originalPrompt.length,
        finalChars: originalPrompt.length,
        budgetChars: MAX_PROMPT_CHARS,
        compacted: false,
        truncatedFields: [],
      },
    };
  }

  const compactPayload = buildPromptPayload(input, {
    fileLimit: 8,
    reasonChars: 150,
    sectionChars: 1_100,
    taskChars: 8_000,
  });
  let compactPrompt = renderRefinementPrompt(compactPayload);
  const truncatedFields = [
    "selectedFiles",
    "selectionReasons",
    "existingSections",
    "task",
  ];

  if (compactPrompt.length > MAX_PROMPT_CHARS) {
    const minimalPayload = buildPromptPayload(input, {
      fileLimit: 5,
      reasonChars: 80,
      sectionChars: 450,
      taskChars: 4_000,
    });
    compactPrompt = renderRefinementPrompt(minimalPayload);
    truncatedFields.push("minimalPromptPayload");
  }

  if (compactPrompt.length > MAX_PROMPT_CHARS) {
    const emergencyPayload = {
      project: {
        name: truncate(input.project.name, 120),
        packageManager: input.project.packageManager
          ? truncate(input.project.packageManager, 60)
          : null,
        detectedStack: input.project.detectedStack
          .slice(0, 6)
          .map((item) => truncate(item, 60)),
        readinessScore: input.project.readinessScore,
        verificationScripts: Object.fromEntries(
          Object.entries(getVerificationScripts(input.project.scripts))
            .slice(0, 3)
            .map(([key, command]) => [truncate(key, 60), truncate(command, 240)]),
        ),
      },
      task: truncate(input.rawTask, 2_000),
      taskAmbiguities: detectTaskPackAmbiguities(input.rawTask),
      taskType: truncate(input.taskType, 80),
      targetTool: truncate(input.targetTool, 80),
      effectiveTaskArea: truncate(input.effectiveTaskArea, 80),
      selectedFiles: input.relevantFiles.slice(0, 3).map((file) => ({
        path: truncate(file.path, 360),
        usage: truncate(file.usage, 80),
        reason: truncate(file.reason, 80),
      })),
      intent: {
        source: input.taskIntent?.source
          ? truncate(input.taskIntent.source, 80)
          : null,
        taskArea: input.taskIntent?.taskArea
          ? truncate(input.taskIntent.taskArea, 80)
          : null,
        riskLevel: input.taskIntent?.riskLevel
          ? truncate(input.taskIntent.riskLevel, 80)
          : null,
        confidence: input.taskIntent?.confidence ?? null,
        targets:
          input.taskIntent?.structuredIntent?.primaryTargets
            ?.slice(0, 3)
            .map((target) => ({
              kind: target.kind ? truncate(target.kind, 80) : undefined,
              value: truncate(
                target.path ?? target.routePath ?? target.value ?? "",
                360,
              ),
            })) ?? [],
        allowedEditScope: input.taskIntent?.structuredIntent?.allowedEditScope
          ? truncate(input.taskIntent.structuredIntent.allowedEditScope, 240)
          : null,
      },
      selectionQuality: {
        status: truncate(input.selectionQuality.status, 80),
        score: input.selectionQuality.score,
        requiredManualReview: input.selectionQuality.requiredManualReview,
        warnings: input.selectionQuality.warnings
          .slice(0, 2)
          .map((item) => truncate(item, 180)),
        blockingReasons: input.selectionQuality.blockingReasons
          .slice(0, 2)
          .map((item) => truncate(item, 180)),
      },
      existingSections: {},
    };
    compactPrompt = renderRefinementPrompt(emergencyPayload);
    truncatedFields.push("emergencyPromptPayload");
  }

  return {
    prompt: compactPrompt,
    diagnostics: {
      originalChars: originalPrompt.length,
      finalChars: compactPrompt.length,
      budgetChars: MAX_PROMPT_CHARS,
      compacted: true,
      truncatedFields,
    },
  };
}

function buildRetryPrompt({
  originalPrompt,
  invalidResponse,
  issueCodes,
}: {
  originalPrompt: string;
  invalidResponse: string;
  issueCodes: string[];
}) {
  const fixedText = `

The previous response was invalid.
Validation issues: ${issueCodes.join(", ") || "unknown schema error"}

Previous response (possibly truncated):
`;
  const closing = `

Return a corrected JSON object only. Include every required field and no commentary.`;
  const availableResponseChars = Math.max(
    800,
    Math.min(
      MAX_REPAIR_RESPONSE_CHARS,
      MAX_RETRY_PROMPT_CHARS - originalPrompt.length - fixedText.length - closing.length,
    ),
  );

  return `${originalPrompt}${fixedText}${truncate(invalidResponse, availableResponseChars)}${closing}`;
}

function findSectionBounds(markdown: string, title: string) {
  const lines = markdown.split(/\r?\n/);
  const heading = `## ${title}`;
  const start = lines.findIndex((line) => line.trim() === heading);

  if (start === -1) {
    return null;
  }

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) {
      end = index;
      break;
    }
  }

  return { lines, start, end };
}

function appendRefinementSection(
  markdown: string,
  sectionTitle: string,
  subsectionTitle: string,
  items: string[],
) {
  const bounds = findSectionBounds(markdown, sectionTitle);
  const normalizedItems = uniqueGuidanceLines(items);

  if (!bounds || normalizedItems.length === 0) {
    return { markdown, added: 0 };
  }

  const existing = bounds.lines.slice(bounds.start, bounds.end).join("\n").toLowerCase();
  const additions = normalizedItems.filter(
    (item) => !existing.includes(item.toLowerCase()),
  );

  if (additions.length === 0) {
    return { markdown, added: 0 };
  }

  const block = [
    "",
    `### ${subsectionTitle}`,
    "",
    ...additions.map((item) => `- ${item}`),
    "",
  ];

  const nextLines = [
    ...bounds.lines.slice(0, bounds.end),
    ...block,
    ...bounds.lines.slice(bounds.end),
  ];

  return {
    markdown: nextLines.join("\n").replace(/\n{4,}/g, "\n\n\n").trim(),
    added: additions.length,
  };
}

export function applyTaskPackRefinement(
  templatePrompt: string,
  refinement: TaskPackRefinement,
) {
  let content = templatePrompt.trim();
  let refinementItems = 0;

  for (const definition of SECTION_REFINEMENTS) {
    const result = appendRefinementSection(
      content,
      definition.section,
      definition.subsection,
      refinement[definition.key],
    );
    content = result.markdown;
    refinementItems += result.added;
  }

  return {
    content,
    refinementItems,
  };
}

function getMarkdownSections(markdown: string) {
  const sections = new Map<string, string>();
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let title: string | null = null;
  let content: string[] = [];

  const flush = () => {
    if (title) {
      sections.set(title, content.join("\n").trim());
    }
  };

  for (const line of lines) {
    const match = line.match(/^##\s+(.+?)\s*$/);
    if (match) {
      flush();
      title = match[1].trim();
      content = [];
      continue;
    }

    if (title) {
      content.push(line);
    }
  }

  flush();
  return sections;
}

const IMMUTABLE_TASK_PACK_SECTIONS = new Set([
  "Target Tool",
  "Task Type",
  "Task",
  "Project Context",
  "Project Memory",
  "Relevant File Candidates",
  "Code Context Snippets",
  "Non-Text / Asset References",
  "ContextForge Assisted Notes",
  "ContextForge Rules & Criteria",
]);

export function validateFinalTaskPack(
  candidate: string,
  fallbackTemplate: string,
) {
  const issueCodes: string[] = [];

  if (!candidate.trim().startsWith("# AI Task Pack")) {
    issueCodes.push("missing_document_heading");
  }

  const candidateSections = getMarkdownSections(candidate);
  const fallbackSections = getMarkdownSections(fallbackTemplate);

  for (const [title, fallbackContent] of fallbackSections) {
    const candidateContent = candidateSections.get(title);

    if (candidateContent == null) {
      issueCodes.push(`missing_section:${title}`);
      continue;
    }

    if (!candidateContent.trim()) {
      issueCodes.push(`empty_section:${title}`);
    }

    if (
      IMMUTABLE_TASK_PACK_SECTIONS.has(title) &&
      candidateContent.trim() !== fallbackContent.trim()
    ) {
      issueCodes.push(`protected_section_changed:${title}`);
    }
  }

  return {
    ok: issueCodes.length === 0,
    issueCodes,
  };
}

function getConfiguredModel(settings: AppSettings) {
  if (settings.aiProvider === "gemini") {
    return settings.geminiModel;
  }
  if (settings.aiProvider === "anthropic") {
    return settings.anthropicModel;
  }
  if (settings.aiProvider === "openai-compatible") {
    return settings.openAiCompatibleModel;
  }
  return settings.defaultOllamaModel;
}

function getProviderLabel(provider: AiProviderId) {
  if (provider === "openai-compatible") return "OpenAI-compatible";
  if (provider === "anthropic") return "Claude API";
  if (provider === "gemini") return "Gemini";
  return "Ollama";
}

function createBaseDiagnostics(
  prompt: TaskPackGenerationDiagnostics["prompt"],
): TaskPackGenerationDiagnostics {
  return {
    version: 2,
    status: "template",
    provider: null,
    model: null,
    cached: false,
    fallbackReason: null,
    prompt,
    attempts: [],
    output: {
      finalChars: 0,
      refinementItems: 0,
      validationIssueCodes: [],
      policy: emptyPolicyDiagnostics(),
    },
  };
}

function classifyFailure(parsed: ParsedRefinement): TaskPackGenerationFailureCode {
  if (parsed.issueCodes.includes("empty_response")) {
    return "empty_response";
  }
  if (parsed.issueCodes.includes("truncated_response")) {
    return "truncated_response";
  }
  if (parsed.issueCodes.includes("invalid_json")) {
    return "invalid_json";
  }
  return "schema_invalid";
}

export async function generateReliableTaskPack(
  input: GenerateReliableTaskPackInput,
): Promise<ReliableTaskPackGenerationResult> {
  const startedAt = Date.now();
  const promptBuild = buildTaskPackRefinementPrompt(input);
  const diagnostics = createBaseDiagnostics(promptBuild.diagnostics);
  const getSettings = input.dependencies?.getSettings ?? getAppSettings;
  const generate = input.dependencies?.generate ?? generateWithConfiguredAi;
  const settings = await getSettings();
  const configuredModel = getConfiguredModel(settings);
  diagnostics.provider = settings.aiProvider;
  diagnostics.model = configuredModel;

  const fallback = (
    reason: TaskPackGenerationFailureCode,
    message: string,
  ): ReliableTaskPackGenerationResult => {
    diagnostics.status = reason === "template_mode" ? "template" : "fallback";
    diagnostics.fallbackReason = reason === "template_mode" ? null : reason;
    diagnostics.output.finalChars = input.fallbackContent.length;

    return {
      content: input.fallbackContent,
      mode: "template",
      model: configuredModel,
      usedFallback: reason !== "template_mode",
      message,
      durationMs: nowDuration(startedAt),
      cached: false,
      diagnostics,
    };
  };

  if (settings.generationMode !== "ollama") {
    return fallback("template_mode", "Generated with validated template mode.");
  }

  if (!configuredModel) {
    return fallback(
      "model_not_configured",
      `${getProviderLabel(settings.aiProvider)} mode is enabled, but no default model is selected. Used validated template fallback.`,
    );
  }

  const cacheKey = buildGenerationCacheKey({
    model: `${settings.aiProvider}:${configuredModel}:task-pack-refinement-v3`,
    prompt: promptBuild.prompt,
    expectedHeading: "task-pack-refinement-json-v3",
    numPredict: 1200,
    temperature: 0,
  });

  if (!input.bypassCache) {
    const cached = getCachedGeneration(cacheKey);
    if (cached) {
      const parsed = parseTaskPackRefinement(cached.content);
      if (parsed.refinement) {
        const policyResult = enforceTaskPackRefinementPolicy(parsed.refinement, input);
        diagnostics.output.policy = policyResult.diagnostics;
        const composed = applyTaskPackRefinement(
          input.fallbackContent,
          policyResult.refinement,
        );
        diagnostics.status = "generated";
        diagnostics.cached = true;
        diagnostics.model = cached.model;
        const finalValidation = validateFinalTaskPack(
          composed.content,
          input.fallbackContent,
        );
        if (!finalValidation.ok || composed.refinementItems === 0) {
          diagnostics.output.validationIssueCodes =
            composed.refinementItems === 0
              ? ["no_effective_refinement"]
              : finalValidation.issueCodes;
        } else {
          diagnostics.output = {
            finalChars: composed.content.length,
            refinementItems: composed.refinementItems,
            validationIssueCodes: [],
            policy: policyResult.diagnostics,
          };

          return {
            content: composed.content,
            mode: "ollama",
            model: cached.model,
            usedFallback: false,
            message: `Generated from cache with validated ${getProviderLabel(settings.aiProvider)} Task Pack refinement.`,
            durationMs: nowDuration(startedAt),
            cached: true,
            diagnostics,
          };
        }

        // Ignore stale/invalid cache entries and continue with a live generation.
        diagnostics.cached = false;

      }
    }
  }

  let firstRaw = "";
  let firstParsed: ParsedRefinement = {
    refinement: null,
    parseStage: "not-run",
    issueCodes: ["provider_error"],
  };
  let actualModel = configuredModel;

  const runAttempt = async (
    attempt: 1 | 2,
    phase: "initial" | "retry",
    prompt: string,
    responseFormat: "text" | "json" = "json",
  ) => {
    const attemptStartedAt = Date.now();

    try {
      const result = await generate({
        prompt,
        temperature: 0,
        numPredict: attempt === 1 ? 1200 : 1000,
        responseFormat,
        timeoutMs: 120_000,
      });
      actualModel = result.model;
      const parsed = parseTaskPackRefinement(result.content);
      diagnostics.attempts.push({
        attempt,
        phase,
        durationMs: nowDuration(attemptStartedAt),
        responseChars: result.content.length,
        parseStage: parsed.parseStage,
        schemaValid: Boolean(parsed.refinement),
        issueCodes: parsed.issueCodes.slice(0, 12),
        providerError: false,
      });
      return { raw: result.content, parsed };
    } catch {
      diagnostics.attempts.push({
        attempt,
        phase,
        durationMs: nowDuration(attemptStartedAt),
        responseChars: 0,
        parseStage: "not-run",
        schemaValid: false,
        issueCodes: ["provider_error"],
        providerError: true,
      });
      return {
        raw: "",
        parsed: {
          refinement: null,
          parseStage: "not-run" as const,
          issueCodes: ["provider_error"],
        },
      };
    }
  };

  const first = await runAttempt(1, "initial", promptBuild.prompt);
  firstRaw = first.raw;
  firstParsed = first.parsed;

  let successful = first;
  let status: TaskPackGenerationStatus =
    firstParsed.parseStage === "local-repair" ? "repaired" : "generated";

  if (!firstParsed.refinement) {
    const retryPrompt = buildRetryPrompt({
      originalPrompt: promptBuild.prompt,
      invalidResponse: firstRaw,
      issueCodes: firstParsed.issueCodes,
    });
    const retry = await runAttempt(
      2,
      "retry",
      retryPrompt,
      diagnostics.attempts[0]?.providerError ? "text" : "json",
    );
    successful = retry;
    status = "retried";
  }

  if (!successful.parsed.refinement) {
    const firstProviderError = diagnostics.attempts[0]?.providerError;
    const retryProviderError = diagnostics.attempts[1]?.providerError;
    const reason =
      firstProviderError && retryProviderError
        ? "provider_error"
        : successful.parsed.issueCodes.includes("truncated_response")
          ? "truncated_response"
          : successful.parsed.issueCodes.includes("empty_response")
            ? "empty_response"
            : successful.parsed.issueCodes.includes("invalid_json")
              ? "invalid_json"
              : successful.parsed.issueCodes.some((code) => code.startsWith("schema:"))
                ? "schema_invalid"
                : diagnostics.attempts.length > 1
                  ? "retry_failed"
                  : classifyFailure(firstParsed);

    return fallback(
      reason,
      `${getProviderLabel(settings.aiProvider)} Task Pack refinement did not satisfy the validated response contract (${reason}). Used validated template fallback.`,
    );
  }

  try {
    const policyResult = enforceTaskPackRefinementPolicy(
      successful.parsed.refinement,
      input,
    );
    diagnostics.output.policy = policyResult.diagnostics;
    const composed = applyTaskPackRefinement(
      input.fallbackContent,
      policyResult.refinement,
    );
    diagnostics.status = status;
    diagnostics.model = actualModel;
    const finalValidation = validateFinalTaskPack(
      composed.content,
      input.fallbackContent,
    );

    if (!finalValidation.ok || composed.refinementItems === 0) {
      diagnostics.output = {
        finalChars: input.fallbackContent.length,
        refinementItems: composed.refinementItems,
        validationIssueCodes:
          composed.refinementItems === 0
            ? ["no_effective_refinement"]
            : finalValidation.issueCodes,
        policy: policyResult.diagnostics,
      };
      const semanticPolicyRejectedAll =
        composed.refinementItems === 0 &&
        policyResult.diagnostics.rejectedItems > 0;
      return fallback(
        semanticPolicyRejectedAll
          ? "semantic_policy_rejected"
          : "composition_failed",
        semanticPolicyRejectedAll
          ? "AI refinement was structurally valid, but every effective item was rejected by the semantic safety policy. Used validated template fallback."
          : "AI refinement passed response validation, but the final Task Pack contract could not be preserved. Used validated template fallback.",
      );
    }

    diagnostics.output = {
      finalChars: composed.content.length,
      refinementItems: composed.refinementItems,
      validationIssueCodes: [],
      policy: policyResult.diagnostics,
    };

    setCachedGeneration(cacheKey, {
      content: JSON.stringify(successful.parsed.refinement),
      model: actualModel,
    });

    const statusMessage =
      status === "retried"
        ? "after one controlled retry"
        : status === "repaired"
          ? "after local schema repair"
          : "with the strict response schema";

    return {
      content: composed.content,
      mode: "ollama",
      model: actualModel,
      usedFallback: false,
      message: `Generated with ${getProviderLabel(settings.aiProvider)} model ${actualModel} ${statusMessage}.`,
      durationMs: nowDuration(startedAt),
      cached: false,
      diagnostics,
    };
  } catch {
    return fallback(
      "composition_failed",
      "AI refinement passed validation, but ContextForge could not compose the final Task Pack safely. Used validated template fallback.",
    );
  }
}
