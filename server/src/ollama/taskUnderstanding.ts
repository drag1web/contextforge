import {
  classifyTaskValue,
  extractExplicitReplacementValue,
  hasMissingReplacementValue,
  type TaskValueKind,
} from "./taskValueGrounding.js";
import { extractExplicitFileTargetMentions } from "../selection/explicitFileMentions.js";

export type TaskUnderstandingReadiness =
  | "ready"
  | "review"
  | "needs_clarification";

export type TaskUnderstandingInterpretationRisk =
  | "objective"
  | "subjective"
  | "uncertain";

export type TaskUnderstandingChangeDefinition =
  | "exact"
  | "bounded"
  | "open_ended";

export type TaskUnderstandingAction =
  | "create"
  | "update"
  | "replace"
  | "remove"
  | "fix"
  | "refactor"
  | "review"
  | "test"
  | "document"
  | "configure"
  | "investigate"
  | "unknown";

export type TaskUnderstandingSource = "fallback" | "merged";

export type TaskUnderstandingReviewStatus =
  | "not_required"
  | "pending"
  | "accepted";

export type TaskUnderstandingMissingCode =
  | "replacement_value"
  | "target_confirmation"
  | "architecture_decision";

export interface TaskUnderstandingExplicitValue {
  kind: TaskValueKind;
  value: string;
  exact: true;
  source: "user";
}

export interface TaskUnderstandingMissingInformation {
  code: TaskUnderstandingMissingCode;
  description: string;
  required: boolean;
}

export interface TaskUnderstanding {
  schemaVersion: 1;
  goal: string;
  action: TaskUnderstandingAction;
  targetHints: string[];
  requestedChanges: string[];
  constraints: string[];
  ambiguities?: string[];
  interpretationRisk: TaskUnderstandingInterpretationRisk;
  changeDefinition: TaskUnderstandingChangeDefinition;
  explicitValues: TaskUnderstandingExplicitValue[];
  missingInformation: TaskUnderstandingMissingInformation[];
  readiness: TaskUnderstandingReadiness;
  canProceed: boolean;
  clarificationQuestion: string | null;
  confidence: number;
  source: TaskUnderstandingSource;
  reviewStatus?: TaskUnderstandingReviewStatus;
  reasons: string[];
}

interface StructuredIntentLike {
  primaryTargets?: Array<{
    kind?: string;
    value?: string;
    path?: string;
    routePath?: string;
    name?: string;
  }>;
  positiveActions?: string[];
  protectedScopes?: string[];
  allowedEditScope?: string;
  ambiguities?: string[];
}

interface BuildTaskUnderstandingInput {
  rawTask: string;
  taskArea: string;
  taskType: string;
  confidence: number;
  projectTree: string[];
  structuredIntent: StructuredIntentLike;
}

interface NormalizeTaskUnderstandingInput extends BuildTaskUnderstandingInput {
  modelValue: unknown;
  fallback: TaskUnderstanding;
}

const ALLOWED_ACTIONS = new Set<TaskUnderstandingAction>([
  "create",
  "update",
  "replace",
  "remove",
  "fix",
  "refactor",
  "review",
  "test",
  "document",
  "configure",
  "investigate",
  "unknown",
]);

const ALLOWED_INTERPRETATION_RISKS =
  new Set<TaskUnderstandingInterpretationRisk>([
    "objective",
    "subjective",
    "uncertain",
  ]);

const ALLOWED_CHANGE_DEFINITIONS =
  new Set<TaskUnderstandingChangeDefinition>([
    "exact",
    "bounded",
    "open_ended",
  ]);

const OPEN_ENDED_QUALITATIVE_PATTERNS = [
  /(?:\b(?:less|more)\s+(?:wooden|clunky|awkward|dated|generic|plain|stiff|boring|modern|beautiful|polished|premium|professional|pleasant|lively|smooth|compact|minimal|airy|clean|clear)\b|(?:^|[^\p{L}])(?:менее|более)\s+(?:деревянн\w*|топорн\w*|неуклюж\w*|устаревш\w*|шаблонн\w*|скучн\w*|современн\w*|красив\w*|аккуратн\w*|компактн\w*|легк\w*|чист\w*|понятн\w*|воздушн\w*|минималистичн\w*|премиальн\w*|профессиональн\w*|приятн\w*|жив\w*|плавн\w*))/iu,
  /(?:\b(?:visually\s+)?(?:lighter|cleaner|simpler|clearer|neater|airier|smoother|more\s+compact|more\s+modern|more\s+polished|more\s+minimal|more\s+premium|more\s+professional)\b|(?:^|[^\p{L}])(?:визуальн\w*\s+)?(?:легче|чище|проще|понятнее|аккуратнее|компактнее|современнее|красивее|приятнее|плавнее|воздушнее|минималистичнее|гармоничнее|профессиональнее|премиальнее|выразительнее|свежее)(?=$|[^\p{L}]))/iu,
  /(?:\b(?:polish|beautify|modernize)\b[^.!?]{0,100}\b(?:ui|design|layout|card|section|screen|page|header|sidebar|navigation)\b|(?:(?:отполируй|осовремени|улучши)\b[^.!?]{0,100}\b(?:интерфейс|дизайн|визуал|внешн\w+\s+вид|блок|секци\w*|страниц\w*|панел\w*|навигац\w*)))/iu,
] as const;

function hasOpenEndedQualitativeLanguage(rawTask: string) {
  return OPEN_ENDED_QUALITATIVE_PATTERNS.some((pattern) =>
    pattern.test(rawTask),
  );
}

const OPEN_ENDED_ARCHITECTURE_CHOICE_PATTERN =
  /(?:\b(?:new|another|additional)\s+(?:way|method|flow|strategy|provider|integration|mechanism)\b|(?:^|[^\p{L}])(?:нов(?:ый|ую|ое)|друг(?:ой|ую|ое)|дополнительн(?:ый|ую|ое))\s+(?:способ|метод|flow|поток|стратеги\w*|провайдер|интеграц\w*|механизм)(?=$|[^\p{L}]))/iu;

function hasOpenEndedArchitectureChoice(rawTask: string) {
  return OPEN_ENDED_ARCHITECTURE_CHOICE_PATTERN.test(rawTask);
}

const INTERACTIVE_CHECK_CONTROL_ADD_PATTERN =
  /(?:\b(?:add|create|introduce|implement)\b[^.!?]{0,120}\b(?:button|control|action|toggle|switch)\b|(?:^|[^\p{L}])(?:добав(?:ь|ить)|созда(?:й|ть)|реализу(?:й|ть))[^.!?]{0,120}(?:кнопк\w*|элемент\w*\s+управлен\w*|действи\w*|переключател\w*))/iu;

const INTERACTIVE_CHECK_OPERATION_PATTERN =
  /(?:\b(?:check|test|verify|validate|probe)\b|(?:^|[^\p{L}])(?:провер\w*|тестир\w*|валидир\w*|диагностир\w*))/iu;

const INTERACTIVE_FEEDBACK_CONTRACT_PATTERN =
  /(?:\b(?:show|display|render|surface|return)\b[^.!?]{0,80}\b(?:success|failure|error|message|toast|status|result|feedback|indicator|spinner)\b|\b(?:disable|enable)\b[^.!?]{0,40}\b(?:button|control)\b|\b(?:loading|pending)\s+(?:state|indicator|spinner)\b|(?:^|[^\p{L}])(?:показ\w*|покаж\w*|отобраз\w*|вывед\w*)[^.!?]{0,80}(?:успех\w*|ошибк\w*|сообщен\w*|статус\w*|результат\w*|индикатор\w*|спиннер\w*)|(?:(?:кнопк\w*|элемент\w*\s+управлен\w*)[^.!?]{0,50}(?:блокир\w*|отключ\w*|активир\w*)|(?:блокир\w*|отключ\w*|активир\w*)[^.!?]{0,50}(?:кнопк\w*|элемент\w*\s+управлен\w*))|(?:состоян\w*\s+загрузк\w*|индикатор\w*\s+загрузк\w*))/iu;

function hasUnderspecifiedInteractiveCheckBehavior(rawTask: string) {
  return (
    INTERACTIVE_CHECK_CONTROL_ADD_PATTERN.test(rawTask) &&
    INTERACTIVE_CHECK_OPERATION_PATTERN.test(rawTask) &&
    !INTERACTIVE_FEEDBACK_CONTRACT_PATTERN.test(rawTask)
  );
}

const VAGUE_REFERENCE_PATTERN =
  /(?:\b(?:this|that|it|here|there|thing|stuff|something)\b|(?:^|[^\p{L}])(?:это|эта|эту|этот|тут|здесь|там|штук\w*|фигн\w*|вот\s+это)(?=$|[^\p{L}]))/iu;

const IMPLEMENTATION_ACTIONS = new Set<TaskUnderstandingAction>([
  "create",
  "update",
  "replace",
  "remove",
  "fix",
  "refactor",
  "configure",
  "document",
]);

const NAMED_TARGET_PATTERNS = [
  /(?:\b(?:page|screen|component|section|modal|form|route|service|file)\s+|(?:страниц\w*|экран\w*|компонент\w*|секци\w*|раздел\w*|модал\w*|форм\w*|маршрут\w*|сервис\w*|файл\w*)\s+)([A-ZА-ЯЁ][\p{L}\p{N}_.-]*(?:\s+[A-ZА-ЯЁ][\p{L}\p{N}_.-]*){0,4})/gu,
  /(?:under\s+(?:the\s+)?heading|below\s+(?:the\s+)?heading|под\s+заголовк\w*|под\s+названи\w*)\s+[«"“']?([^\n.!?;»"”']{2,100})/giu,
] as const;

function normalizeWhitespace(value: unknown, maxLength = 320) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, maxLength);
}

function normalizeForCompare(value: string) {
  return value.replace(/\\/g, "/").trim().toLowerCase();
}

export function filterTaskUnderstandingAmbiguities(values: string[]) {
  return values.filter((value) => {
    const normalized = normalizeForCompare(value);
    return !(
      /(?:no|missing|without)\s+(?:an?\s+)?(?:explicit\s+)?(?:inventory\s+)?(?:file\s+)?path/u.test(normalized) ||
      /(?:explicit|exact)\s+(?:file\s+)?path\s+(?:was\s+)?not\s+(?:provided|found|specified)/u.test(normalized) ||
      /(?:не\s+указан|не\s+найден|отсутствует)[^.!?]{0,80}(?:путь|файл)/u.test(normalized)
    );
  });
}

function normalizeConfidence(value: unknown, fallback = 0.5) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(1, Math.max(0, parsed))
    : fallback;
}

function uniqueStrings(values: string[], limit = 12) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalizeWhitespace(value, 240);
    const key = normalizeForCompare(normalized);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function getModelUnderstandingObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  const nested = data.taskUnderstanding ?? data.understanding ?? data.taskSummary;
  if (!nested || typeof nested !== "object" || Array.isArray(nested)) return null;
  return nested as Record<string, unknown>;
}

function normalizeStringArray(value: unknown, max = 12) {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? [value]
      : [];
  return uniqueStrings(values.map((item) => String(item)), max);
}

function taskOrProjectContains(value: string, rawTask: string, projectTree: string[]) {
  const normalized = normalizeForCompare(value);
  if (!normalized) return false;
  if (normalizeForCompare(rawTask).includes(normalized)) return true;
  return projectTree.some((path) => normalizeForCompare(path).includes(normalized));
}

function hasMeaningfulTaskOverlap(value: string, rawTask: string) {
  const taskTokens = new Set(
    normalizeForCompare(rawTask).match(/[\p{L}\p{N}_-]{4,}/gu) ?? [],
  );
  const valueTokens = normalizeForCompare(value).match(/[\p{L}\p{N}_-]{4,}/gu) ?? [];
  return valueTokens.some((token) => taskTokens.has(token));
}

function normalizeGroundedHints(
  values: string[],
  rawTask: string,
  projectTree: string[],
  limit = 10,
) {
  return uniqueStrings(
    values.filter(
      (value) =>
        taskOrProjectContains(value, rawTask, projectTree) ||
        hasMeaningfulTaskOverlap(value, rawTask),
    ),
    limit,
  );
}

function normalizeInterpretationRisk(
  value: unknown,
  fallback: TaskUnderstandingInterpretationRisk,
) {
  const normalized = normalizeForCompare(
    String(value ?? ""),
  ) as TaskUnderstandingInterpretationRisk;
  return ALLOWED_INTERPRETATION_RISKS.has(normalized)
    ? normalized
    : fallback;
}

function normalizeChangeDefinition(
  value: unknown,
  fallback: TaskUnderstandingChangeDefinition,
) {
  const normalized = normalizeForCompare(
    String(value ?? ""),
  ) as TaskUnderstandingChangeDefinition;
  return ALLOWED_CHANGE_DEFINITIONS.has(normalized)
    ? normalized
    : fallback;
}

function deriveInterpretationSemantics({
  rawTask,
  action,
  explicitValues,
  hasBoundedExplicitFileTarget,
  modelInterpretationRisk,
  modelChangeDefinition,
}: {
  rawTask: string;
  action: TaskUnderstandingAction;
  explicitValues: TaskUnderstandingExplicitValue[];
  hasBoundedExplicitFileTarget: boolean;
  modelInterpretationRisk?: unknown;
  modelChangeDefinition?: unknown;
}) {
  if (explicitValues.length > 0) {
    return {
      interpretationRisk: "objective" as const,
      changeDefinition: "exact" as const,
    };
  }

  // Adding a diagnostic/check control without defining how the UI presents
  // pending, success, or failure leaves materially different valid UX flows.
  // Keep this as a reviewable open-ended implementation instead of allowing
  // a model response to nondeterministically classify it as bounded.
  if (hasUnderspecifiedInteractiveCheckBehavior(rawTask)) {
    return {
      interpretationRisk: "objective" as const,
      changeDefinition: "open_ended" as const,
    };
  }

  // A concrete file destination plus an implementation verb is a bounded
  // execution contract even when the destination does not exist yet. Missing
  // create targets are planned files, not implicit architecture questions.
  // The caller excludes subjective wording and real unresolved decisions.
  if (hasBoundedExplicitFileTarget && IMPLEMENTATION_ACTIONS.has(action)) {
    return {
      interpretationRisk: "objective" as const,
      changeDefinition: "bounded" as const,
    };
  }

  const fallbackInterpretationRisk: TaskUnderstandingInterpretationRisk =
    action === "unknown"
      ? "uncertain"
      : hasOpenEndedQualitativeLanguage(rawTask)
        ? "subjective"
        : hasOpenEndedArchitectureChoice(rawTask)
          ? "uncertain"
          : "objective";
  const fallbackChangeDefinition: TaskUnderstandingChangeDefinition =
    fallbackInterpretationRisk === "objective" ? "bounded" : "open_ended";
  const normalizedModelRisk = normalizeInterpretationRisk(
    modelInterpretationRisk,
    fallbackInterpretationRisk,
  );
  const normalizedModelDefinition = normalizeChangeDefinition(
    modelChangeDefinition,
    fallbackChangeDefinition,
  );

  const interpretationRisk: TaskUnderstandingInterpretationRisk =
    fallbackInterpretationRisk === "subjective" ||
    normalizedModelRisk === "subjective"
      ? "subjective"
      : fallbackInterpretationRisk === "uncertain" ||
          normalizedModelRisk === "uncertain"
        ? "uncertain"
        : "objective";
  const changeDefinition: TaskUnderstandingChangeDefinition =
    fallbackChangeDefinition === "open_ended" ||
    normalizedModelDefinition === "open_ended" ||
    interpretationRisk !== "objective"
      ? "open_ended"
      : "bounded";

  return { interpretationRisk, changeDefinition };
}

function inferAction(rawTask: string): TaskUnderstandingAction {
  const task = normalizeForCompare(rawTask);
  if (/(?:\b(?:replace|rename|rewrite)\b|замени|заменить|переименуй|переименовать|перепиши|переписать|заміни|замінити|перейменуй|перейменувати|перепиши|переписати)/iu.test(task)) return "replace";
  if (/(?:\b(?:create|add|introduce|implement)\b|создай|создать|добавь|добавить|реализуй|реализовать|створи|створити|додай|додати|реалізуй|реалізувати)/iu.test(task)) return "create";
  if (/(?:\b(?:remove|delete|drop)\b|удали|удалить|убери|убрать|видали|видалити|прибери|прибрати)/iu.test(task)) return "remove";
  if (/(?:\b(?:fix|repair|resolve|bug)\b|исправь|исправить|почини|починить|баг\w*|ошибк\w*|виправ\w*|полагод\w*|помилк\w*)/iu.test(task)) return "fix";
  if (/(?:\b(?:refactor|restructure|cleanup)\b|рефактор\w*|переструктур\w*|почисти|перебудуй|перебудувати)/iu.test(task)) return "refactor";
  if (/(?:\b(?:review|audit|inspect|check)\b|проверь|проверить|аудит\w*|изучи|посмотри|перевір\w*|вивчи|подивись)/iu.test(task)) return "review";
  if (/(?:\b(?:test|cover|verify)\b|тест\w*|покры\w*|покрий\w*)/iu.test(task)) return "test";
  if (/(?:\b(?:document|docs|readme|guide)\b|документ\w*|ридми|інструкц\w*|инструкц\w*)/iu.test(task)) return "document";
  if (/(?:\b(?:configure|config|setup|set)\b|настрой|настроить|налаштуй|налаштувати|конфиг\w*|конфіг\w*|установи|установить|встанови|встановити|задай|задать)/iu.test(task)) return "configure";
  if (/(?:\b(?:investigate|diagnose|find out|trace)\b|разберись|розберися|діагност\w*|диагност\w*|выясни|з'ясуй|з’ясуй|найди\s+причин|знайди\s+причин)/iu.test(task)) return "investigate";
  if (/(?:\b(?:change|update|edit|modify|adjust|improve|make)\b|измени|изменить|обнови|обновить|поменяй|поменять|доработай|улучши|сделай|зміни|змінити|онови|оновити|поміняй|поміняти|доопрацюй|покращ\w*|зроби)/iu.test(task)) return "update";
  return "unknown";
}

function normalizeAction(value: unknown, fallback: TaskUnderstandingAction) {
  const normalized = normalizeForCompare(String(value ?? "")) as TaskUnderstandingAction;
  if (!ALLOWED_ACTIONS.has(normalized)) return fallback;
  if (normalized === "unknown" && fallback !== "unknown") return fallback;
  return normalized;
}

function extractNamedTargetHints(rawTask: string) {
  const hints: string[] = [];
  for (const pattern of NAMED_TARGET_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of rawTask.matchAll(pattern)) {
      const value = normalizeWhitespace(match[1], 120)
        .replace(/^[«"“']|[»"”']$/gu, "")
        .trim();
      if (value) hints.push(value);
    }
  }
  return uniqueStrings(hints, 8);
}

function getStructuredTargetHints(structuredIntent: StructuredIntentLike) {
  return uniqueStrings(
    (structuredIntent.primaryTargets ?? []).flatMap((target) => [
      target.path ?? "",
      target.routePath ?? "",
      target.name ?? "",
      target.value ?? "",
    ]),
    10,
  );
}

function inferGoal(rawTask: string) {
  const compact = normalizeWhitespace(rawTask, 260)
    .replace(/^(?:please\s+|пожалуйста[,.]?\s*)/iu, "")
    .trim();
  return compact || "Understand and complete the requested project change.";
}

function isMostlyRussian(value: string) {
  const cyrillic = (value.match(/[А-Яа-яЁё]/g) ?? []).length;
  const latin = (value.match(/[A-Za-z]/g) ?? []).length;
  return cyrillic >= latin;
}

function buildReplacementQuestion(rawTask: string) {
  return isMostlyRussian(rawTask)
    ? "Какой точный новый текст или значение нужно использовать?"
    : "What exact new text or value should be used?";
}

function buildTargetQuestion(rawTask: string) {
  return isMostlyRussian(rawTask)
    ? "Какую конкретно страницу, компонент или функцию нужно изменить?"
    : "Which exact page, component, or feature should be changed?";
}

function buildArchitectureDecisionQuestion(rawTask: string, ambiguities: string[]) {
  const detail = uniqueStrings(ambiguities, 3).join("; ");
  const russianTask = isMostlyRussian(rawTask);
  const localizedDetail =
    detail && isMostlyRussian(detail) === russianTask ? detail : "";
  if (russianTask) {
    return localizedDetail
      ? `Уточните ключевое решение перед реализацией: ${localizedDetail}`
      : "Уточните, какой именно вариант поведения или пользовательского flow нужно реализовать и какие части системы должны участвовать.";
  }
  return localizedDetail
    ? `Clarify the key implementation decision before proceeding: ${localizedDetail}`
    : "Clarify the exact behavior or user flow to implement and which parts of the system must participate.";
}

function deriveExplicitValues(rawTask: string): TaskUnderstandingExplicitValue[] {
  const replacement = extractExplicitReplacementValue(rawTask);
  if (!replacement.provided || !replacement.exactValue) return [];
  return [
    {
      kind: classifyTaskValue(replacement.exactValue),
      value: replacement.exactValue,
      exact: true,
      source: "user",
    },
  ];
}

function hasGroundedTargetHint(
  targetHints: string[],
  projectTree: string[],
) {
  const normalizedPaths = projectTree.map((filePath) => {
    const normalized = normalizeForCompare(filePath.replace(/\\/g, "/"));
    const basename = normalized.split("/").pop() ?? normalized;
    const stem = basename.replace(/\.[a-z0-9]+$/iu, "");
    return { normalized, basename, stem };
  });

  return targetHints.some((hint) => {
    const normalizedHint = normalizeForCompare(hint.replace(/\\/g, "/"));
    if (!normalizedHint) return false;
    return normalizedPaths.some(
      (candidate) =>
        candidate.normalized === normalizedHint ||
        candidate.normalized.endsWith(`/${normalizedHint}`) ||
        candidate.basename === normalizedHint ||
        candidate.stem === normalizedHint,
    );
  });
}

function deriveMissingInformation({
  rawTask,
  action,
  targetHints,
  ambiguities,
  changeDefinition,
  projectTree,
  hasExplicitFileTarget,
}: {
  rawTask: string;
  action: TaskUnderstandingAction;
  targetHints: string[];
  ambiguities: string[];
  changeDefinition: TaskUnderstandingChangeDefinition;
  projectTree: string[];
  hasExplicitFileTarget: boolean;
}) {
  const missing: TaskUnderstandingMissingInformation[] = [];
  if (hasMissingReplacementValue(rawTask)) {
    missing.push({
      code: "replacement_value",
      description: "The task requests a replacement but does not provide the exact new value.",
      required: true,
    });
  }

  const architectureShapingAction =
    action === "create" || action === "configure";
  const groundedTargetAvailable = hasGroundedTargetHint(
    targetHints,
    projectTree,
  ) || (architectureShapingAction && hasExplicitFileTarget);
  const architectureDecisionMissing =
    changeDefinition === "open_ended" &&
    ((architectureShapingAction &&
      (ambiguities.length > 0 || !groundedTargetAvailable)) ||
      (!architectureShapingAction &&
        ambiguities.length > 0 &&
        !groundedTargetAvailable));
  if (architectureDecisionMissing) {
    missing.push({
      code: "architecture_decision",
      description:
        ambiguities[0] ??
        "The task leaves an implementation-shaping behavior, flow, or system boundary unspecified.",
      required: true,
    });
  }

  return missing;
}

function deriveReadiness({
  rawTask,
  action,
  targetHints,
  missingInformation,
  interpretationRisk,
  changeDefinition,
}: {
  rawTask: string;
  action: TaskUnderstandingAction;
  targetHints: string[];
  missingInformation: TaskUnderstandingMissingInformation[];
  interpretationRisk: TaskUnderstandingInterpretationRisk;
  changeDefinition: TaskUnderstandingChangeDefinition;
}): TaskUnderstandingReadiness {
  if (missingInformation.some((item) => item.required)) {
    return "needs_clarification";
  }
  if (
    action === "unknown" ||
    interpretationRisk !== "objective" ||
    changeDefinition === "open_ended" ||
    (VAGUE_REFERENCE_PATTERN.test(rawTask) && targetHints.length === 0)
  ) {
    return "review";
  }
  return "ready";
}

function buildReasons({
  source,
  action,
  targetHints,
  explicitValues,
  missingInformation,
  interpretationRisk,
  changeDefinition,
  readiness,
}: {
  source: TaskUnderstandingSource;
  action: TaskUnderstandingAction;
  targetHints: string[];
  explicitValues: TaskUnderstandingExplicitValue[];
  missingInformation: TaskUnderstandingMissingInformation[];
  interpretationRisk: TaskUnderstandingInterpretationRisk;
  changeDefinition: TaskUnderstandingChangeDefinition;
  readiness: TaskUnderstandingReadiness;
}) {
  return uniqueStrings(
    [
      `Understanding source: ${source}.`,
      `Detected action: ${action}.`,
      targetHints.length > 0
        ? `Detected ${targetHints.length} grounded target hint(s).`
        : "No exact project path is required for the task to be understandable.",
      explicitValues.length > 0
        ? `Grounded ${explicitValues.length} exact user-provided value(s).`
        : "No exact literal value was grounded from the task.",
      missingInformation.length > 0
        ? `Missing required information: ${missingInformation.map((item) => item.code).join(", ")}.`
        : "No backend-confirmed required information is missing.",
      `Interpretation risk: ${interpretationRisk}.`,
      `Change definition: ${changeDefinition}.`,
      `Readiness: ${readiness}.`,
    ],
    10,
  );
}

function buildDerivedUnderstanding({
  rawTask,
  taskArea,
  taskType,
  confidence,
  projectTree,
  structuredIntent,
  source,
  goal,
  action,
  targetHints,
  requestedChanges,
  constraints,
  modelInterpretationRisk,
  modelChangeDefinition,
}: BuildTaskUnderstandingInput & {
  source: TaskUnderstandingSource;
  goal?: string;
  action?: TaskUnderstandingAction;
  targetHints?: string[];
  requestedChanges?: string[];
  constraints?: string[];
  modelInterpretationRisk?: unknown;
  modelChangeDefinition?: unknown;
}): TaskUnderstanding {
  const fallbackAction = action ?? inferAction(rawTask);
  const fallbackTargetHints = uniqueStrings([
    ...(targetHints ?? []),
    ...getStructuredTargetHints(structuredIntent),
    ...extractExplicitFileTargetMentions(rawTask),
    ...extractNamedTargetHints(rawTask),
  ]);
  const explicitValues = deriveExplicitValues(rawTask);
  const explicitFileTargets = extractExplicitFileTargetMentions(rawTask);
  const ambiguities = uniqueStrings(
    filterTaskUnderstandingAmbiguities(structuredIntent.ambiguities ?? []),
    8,
  );
  const hasBoundedExplicitFileTarget =
    explicitFileTargets.length > 0 &&
    ambiguities.length === 0 &&
    !hasOpenEndedQualitativeLanguage(rawTask) &&
    !hasOpenEndedArchitectureChoice(rawTask);
  let { interpretationRisk, changeDefinition } = deriveInterpretationSemantics({
    rawTask,
    action: fallbackAction,
    explicitValues,
    hasBoundedExplicitFileTarget,
    modelInterpretationRisk,
    modelChangeDefinition,
  });
  const missingInformation = deriveMissingInformation({
    rawTask,
    action: fallbackAction,
    targetHints: fallbackTargetHints,
    ambiguities,
    changeDefinition,
    projectTree,
    hasExplicitFileTarget: explicitFileTargets.length > 0,
  });
  if (missingInformation.some((item) => item.code === "architecture_decision")) {
    interpretationRisk = "uncertain";
    changeDefinition = "open_ended";
  }
  const readiness = deriveReadiness({
    rawTask,
    action: fallbackAction,
    targetHints: fallbackTargetHints,
    missingInformation,
    interpretationRisk,
    changeDefinition,
  });
  const clarificationQuestion =
    readiness !== "needs_clarification"
      ? null
      : missingInformation.some((item) => item.code === "replacement_value")
        ? buildReplacementQuestion(rawTask)
        : missingInformation.some((item) => item.code === "architecture_decision")
          ? buildArchitectureDecisionQuestion(rawTask, ambiguities)
          : buildTargetQuestion(rawTask);
  const baseConfidence = normalizeConfidence(confidence, 0.5);
  const finalConfidence =
    readiness === "review"
      ? Math.min(baseConfidence, 0.62)
      : readiness === "needs_clarification"
        ? Math.max(baseConfidence, 0.8)
        : baseConfidence;

  return {
    schemaVersion: 1,
    goal: normalizeWhitespace(goal ?? inferGoal(rawTask), 260),
    action: fallbackAction,
    targetHints: fallbackTargetHints,
    requestedChanges: uniqueStrings([
      ...(requestedChanges ?? []),
      ...(structuredIntent.positiveActions ?? []),
      inferGoal(rawTask),
    ], 8),
    constraints: uniqueStrings([
      ...(constraints ?? []),
      ...(structuredIntent.protectedScopes ?? []),
      structuredIntent.allowedEditScope
        ? `Allowed edit scope: ${structuredIntent.allowedEditScope}`
        : "",
    ], 10),
    ambiguities,
    interpretationRisk,
    changeDefinition,
    explicitValues,
    missingInformation,
    readiness,
    canProceed: readiness !== "needs_clarification",
    clarificationQuestion,
    confidence: finalConfidence,
    source,
    reviewStatus: readiness === "ready" ? "not_required" : "pending",
    reasons: buildReasons({
      source,
      action: fallbackAction,
      targetHints: fallbackTargetHints,
      explicitValues,
      missingInformation,
      interpretationRisk,
      changeDefinition,
      readiness,
    }),
  };
}

/**
 * Records a UI review decision without changing semantic risk, scope, targets,
 * or missing information. The caller must validate that the decision belongs
 * to the exact Task Understanding snapshot being executed.
 */
export function applyTaskUnderstandingReviewAcceptance(
  understanding: TaskUnderstanding,
  accepted: boolean,
): TaskUnderstanding {
  if (understanding.readiness !== "review") {
    return {
      ...understanding,
      reviewStatus:
        understanding.readiness === "ready" ? "not_required" : "pending",
    };
  }

  return {
    ...understanding,
    reviewStatus: accepted ? "accepted" : "pending",
    reasons: uniqueStrings([
      ...understanding.reasons,
      accepted
        ? "The user accepted this interpretation for the reviewed snapshot."
        : "The interpretation still requires user review.",
    ], 12),
  };
}

export function buildFallbackTaskUnderstanding(
  input: BuildTaskUnderstandingInput,
): TaskUnderstanding {
  return buildDerivedUnderstanding({
    ...input,
    source: "fallback",
  });
}

export function normalizeTaskUnderstanding({
  modelValue,
  fallback,
  rawTask,
  taskArea,
  taskType,
  confidence,
  projectTree,
  structuredIntent,
}: NormalizeTaskUnderstandingInput): TaskUnderstanding {
  const model = getModelUnderstandingObject(modelValue);
  if (!model) {
    return buildDerivedUnderstanding({
      rawTask,
      taskArea,
      taskType,
      confidence,
      projectTree,
      structuredIntent,
      source: fallback.source,
      goal: fallback.goal,
      action: fallback.action,
      targetHints: fallback.targetHints,
      requestedChanges: fallback.requestedChanges,
      constraints: fallback.constraints,
    });
  }

  const modelGoal = normalizeWhitespace(model.goal ?? model.summary, 260);
  const groundedGoal =
    modelGoal && hasMeaningfulTaskOverlap(modelGoal, rawTask)
      ? modelGoal
      : fallback.goal;
  const modelAction = normalizeAction(model.action ?? model.intent, fallback.action);
  const modelTargetHints = normalizeGroundedHints(
    normalizeStringArray(model.targetHints ?? model.targets ?? model.target, 12),
    rawTask,
    projectTree,
  );
  const modelRequestedChanges = normalizeGroundedHints(
    normalizeStringArray(
      model.requestedChanges ?? model.changes ?? model.actions,
      12,
    ),
    rawTask,
    projectTree,
  );
  const modelConstraints = normalizeGroundedHints(
    normalizeStringArray(model.constraints ?? model.protectedScopes, 12),
    rawTask,
    projectTree,
  );

  return buildDerivedUnderstanding({
    rawTask,
    taskArea,
    taskType,
    confidence: Math.max(
      normalizeConfidence(confidence, fallback.confidence),
      normalizeConfidence(model.confidence, fallback.confidence),
    ),
    projectTree,
    structuredIntent,
    source: "merged",
    goal: groundedGoal,
    action: modelAction,
    targetHints: uniqueStrings([
      ...modelTargetHints,
      ...fallback.targetHints,
    ]),
    requestedChanges: uniqueStrings([
      ...modelRequestedChanges,
      ...fallback.requestedChanges,
    ]),
    constraints: uniqueStrings([
      ...modelConstraints,
      ...fallback.constraints,
    ]),
    modelInterpretationRisk:
      model.interpretationRisk ?? model.interpretation_risk,
    modelChangeDefinition:
      model.changeDefinition ?? model.change_definition,
  });
}
