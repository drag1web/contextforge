import type { TaskIntentAnalysis } from "../ollama/taskIntentAnalyzer.js";
import type { TaskUnderstanding } from "../ollama/taskUnderstanding.js";
import { extractClassifiedFileMentions } from "./explicitFileMentions.js";
import { extractSymbolRenameIntent } from "./symbolRename.js";

export type TaskSelectionProfileKind =
  | "exact-text"
  | "visual-ui"
  | "bounded-ui"
  | "structured-value"
  | "symbol-rename"
  | "state-behavior"
  | "api-contract"
  | "fullstack-feature"
  | "tests"
  | "docs"
  | "config"
  | "general";

export interface TaskSelectionProfile {
  kind: TaskSelectionProfileKind;
  exactLiterals: string[];
  maxPrimaryFiles: number;
  needsConfigContext: boolean;
  needsTestContext: boolean;
  reasons: string[];
}

function normalizeWhitespace(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function uniqueStrings(values: string[], limit = 16) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = normalizeWhitespace(raw);
    const key = value.toLocaleLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= limit) break;
  }
  return result;
}

function quotedLiterals(rawTask: string) {
  const values: string[] = [];
  for (const match of rawTask.matchAll(/[«„“"'`]([^»“”"'`\n]{1,180})[»“”"'`]/gu)) {
    values.push(match[1] ?? "");
  }
  return uniqueStrings(values, 12);
}

function exactValues(understanding?: TaskUnderstanding) {
  return (understanding?.explicitValues ?? [])
    .filter((value) => value.exact && (value.kind === "text" || value.kind === "literal"))
    .map((value) => value.value);
}

function replacementSourceLiterals(rawTask: string) {
  const values: string[] = [];
  const patterns = [
    /\b(?:text|label|copy|title|heading|caption|message)\s+([A-Z][A-Za-z0-9 _.-]{1,80}?)\s+\b(?:with|to)\b/gu,
    /(?:текст|подпис\w*|надпис\w*|заголов\w*|сообщени\w*)\s+([A-ZА-ЯЁ][\p{L}\p{N} _.-]{1,80}?)\s+(?:на|в)\s+[«„“"'`]/gu,
  ];
  for (const pattern of patterns) {
    for (const match of rawTask.matchAll(pattern)) values.push(match[1] ?? "");
  }
  return uniqueStrings(values, 8);
}

function positiveLexicalText(value: string) {
  return normalizeWhitespace(value
    .replace(
      /(?:^|[;.!?]\s*)(?:do\s+not|don't|dont|without\s+changing|never)\b[^;.!?\n]*/giu,
      " ",
    )
    .replace(
      /(?:^|[;.!?]\s*)не\s+(?:добав\p{L}*|созд\p{L}*|мен\p{L}*|измен\p{L}*|трог\p{L}*|редактир\p{L}*|дода\p{L}*|створ\p{L}*|змін\p{L}*|чіп\p{L}*|редаг\p{L}*)\b[^;.!?\n]*/giu,
      " ",
    )
    .replace(
      /(?:\bbackend\b|\bapi\b|\bserver\b|\bstorage\b|\bdatabase\b|\broute\b|\bendpoint\b|бэкенд|бекенд|сервер|хранилищ\p{L}*|эндпоинт\p{L}*|маршрут\p{L}*)[^;.!?\n]{0,120}(?:do\s+not\s+(?:change|edit|touch)|не\s+(?:мен\p{L}*|измен\p{L}*|трог\p{L}*|редактир\p{L}*))[^;.!?\n]*/giu,
      " ",
    )
    .replace(
      /(?:\bui\b|\bfrontend\b|\bfront-end\b|\binterface\b|\bscreen\b|\bpage\b|интерфейс|фронтенд|экран|страниц\p{L}*)[^;.!?\n]{0,100}(?:do\s+not\s+(?:change|edit|touch)|не\s+(?:мен\p{L}*|измен\p{L}*|трог\p{L}*|редактир\p{L}*))[^;.!?\n]*/giu,
      " ",
    ));
}

function isExactTextTask(rawTask: string, understanding?: TaskUnderstanding) {
  if (!understanding) return false;
  if (understanding.changeDefinition !== "exact") return false;
  if (!["replace", "update", "remove", "refactor"].includes(understanding.action)) return false;

  const literals = uniqueStrings([
    ...quotedLiterals(rawTask),
    ...replacementSourceLiterals(rawTask),
    ...exactValues(understanding),
  ]);
  if (literals.length === 0) return false;

  const text = [
    rawTask,
    understanding.goal,
    ...understanding.requestedChanges,
  ].join(" ");
  return /\b(?:text|label|copy|title|heading|caption|message|translation|translate|locali[sz]e|empty\s+state|file(?:name)?|name|prefix|suffix)\b|(?:текст|подпис|надпис|заголов|сообщени|перевод|локализац|пуст\w*\s+состояни|имя|названи|префикс|суффикс)/iu.test(text);
}


function hasStructuredValueReplacement(rawTask: string) {
  const shortcut = String.raw`(?:Ctrl|Control|Cmd|Command|Meta|Alt|Shift)(?:\s*\+\s*(?:Ctrl|Control|Cmd|Command|Meta|Alt|Shift|[A-Za-z0-9,.;/\\-]))+`;
  return [
    new RegExp(String.raw`(?:^|[\s,:;])(?:с|из)\s+${shortcut}\s+на\s+${shortcut}(?=$|[\s,.!?;])`, "iu"),
    new RegExp(String.raw`\bfrom\s+${shortcut}\s+to\s+${shortcut}(?=$|[\s,.!?;])`, "iu"),
  ].some((pattern) => pattern.test(rawTask));
}

function isBoundedUiTask(rawTask: string, text: string, action?: string) {
  const boundedAction = ["remove", "update", "replace"].includes(action ?? "");
  const directUiTarget = /\b(?:action|button|control|card|menu item|link|toggle)\b|(?:действи|кнопк|элемент\w*\s+управлен|карточк|пункт\w*\s+меню|ссылк|переключател)/iu.test(rawTask);
  const scopedConstraint = /\b(?:only|keep|leave|preserve|do not change|don't change|do not create|don't create|without changing)\b|(?:только|оставь|сохрани|не меняй|не изменяй|не трогай|не создавай|не добавляй|без изменени)/iu.test(rawTask);
  const uiContext = /\b(?:ui|page|screen|component|modal|card|button|frontend)\b|(?:интерфейс|страниц|экран|компонент|модал|карточк|кнопк|фронтенд)/iu.test(text);
  return boundedAction && directUiTarget && scopedConstraint && uiContext;
}

function protectsBackendMutation(
  rawTask: string,
  taskIntent?: TaskIntentAnalysis,
) {
  const text = [
    rawTask,
    ...(taskIntent?.taskUnderstanding.constraints ?? []),
    ...(taskIntent?.structuredIntent.protectedScopes ?? []),
  ].join(" ");
  const backend = String.raw`(?:\b(?:backend|server|api|endpoint|route)\b|бэкенд|бекенд|сервер|апи|эндпоинт\p{L}*|маршрут\p{L}*)`;
  const protection = String.raw`(?:do\s+not|don't|dont|without|never|не\s+(?:добавляй|добавлять|создавай|создавать|меняй|менять|трогай|трогать|изменяй|изменять|додавай|додавати|створюй|створювати|змінюй|змінювати|чіпай|чіпати|редагуй|редагувати)|без\s+змін|запрещ)`;
  return new RegExp(`${protection}[^.!?\n]{0,120}${backend}`, "iu").test(text) ||
    new RegExp(`${backend}[^.!?\n]{0,120}${protection}`, "iu").test(text);
}

export function classifyTaskSelectionProfile(input: {
  rawTask: string;
  taskType?: string;
  taskIntent?: TaskIntentAnalysis;
}): TaskSelectionProfile {
  const understanding = input.taskIntent?.taskUnderstanding;
  const rawTask = normalizeWhitespace(input.rawTask);
  const positiveTask = positiveLexicalText(rawTask);
  const text = [
    positiveTask,
    input.taskType ?? "",
    understanding?.goal ?? "",
    ...(understanding?.requestedChanges ?? []).map(positiveLexicalText),
  ].join(" ");
  const exactLiterals = uniqueStrings([
    ...quotedLiterals(rawTask),
    ...replacementSourceLiterals(rawTask),
    ...exactValues(understanding),
  ]);
  const explicitDocumentationTarget = extractClassifiedFileMentions(rawTask)
    .some(
      (mention) =>
        mention.role !== "artifact-reference" &&
        /\.(?:md|mdx)$/iu.test(mention.path),
    );
  const explicitOnlyDocumentationTask =
    explicitDocumentationTarget &&
    input.taskIntent?.structuredIntent.allowedEditScope ===
      "explicit_targets_only";
  const docsFocused =
    explicitDocumentationTarget ||
    /\b(?:docs|documentation|readme)\b|(?:документ|ридми)/iu.test(text);
  const verificationPlanning =
    /\b(?:prepare|create|build)\b[^.]{0,80}\b(?:verification|validation)\b|\b(?:verification|validation)\b[^.]{0,80}\btask\s+pack\b|(?:подготов|собер|созд)[^.]{0,80}(?:провер|валидац)/iu.test(text);
  const needsConfigContext = !explicitOnlyDocumentationTask && (
    /\b(?:package|packages|dependency|dependencies|library|libraries|npm|yarn|pnpm|bun|install|installation|installing)\b|(?:пакет|библиотек|зависимост|установ)/iu.test(text) ||
    verificationPlanning ||
    (docsFocused && /\b(?:run|running|build|building|start|startup|setup|script|scripts|command|commands)\b|(?:запуск|сборк|скрипт|команд)/iu.test(text))
  );
  const needsTestContext =
    !explicitOnlyDocumentationTask &&
    /\b(?:selector|selection|ranking|scoring|fallback|safety\s+policy|manual\s+review|pipeline)\b|(?:селектор|ранжирован|оценк\w*\s+кандидат|резервн\w*\s+выбор|политик\w*\s+безопасност|ручн\w*\s+провер)/iu.test(text);

  // Exact code-symbol renames are stronger than the model's generic wording
  // such as "update the old type name". Resolve them before visible-text
  // classification so a literal identifier never becomes an exact-copy task.
  if (extractSymbolRenameIntent(rawTask)) {
    return {
      kind: "symbol-rename",
      exactLiterals,
      maxPrimaryFiles: 10,
      needsConfigContext: false,
      needsTestContext: false,
      reasons: [
        "The task explicitly renames one code symbol and requests its references to be updated.",
      ],
    };
  }

  if (isExactTextTask(rawTask, understanding)) {
    return {
      kind: "exact-text",
      exactLiterals,
      maxPrimaryFiles: 3,
      needsConfigContext,
      needsTestContext,
      reasons: [
        "The task requests an exact visible-text change with user-provided literal values.",
        "State, backend, and storage ownership are not required unless the code proves that the text is produced there.",
      ],
    };
  }

  if (hasStructuredValueReplacement(rawTask)) {
    return {
      kind: "structured-value",
      exactLiterals,
      maxPrimaryFiles: 4,
      needsConfigContext: true,
      needsTestContext,
      reasons: [
        "The task replaces a concrete structured setting value and must verify the current code value before editing consumers.",
      ],
    };
  }

  if (isBoundedUiTask(rawTask, text, understanding?.action)) {
    return {
      kind: "bounded-ui",
      exactLiterals,
      maxPrimaryFiles: 5,
      needsConfigContext,
      needsTestContext,
      reasons: [
        "The task changes one nested UI action while preserving a neighboring surface or protected subsystem.",
      ],
    };
  }

  if (explicitDocumentationTarget) {
    return { kind: "docs", exactLiterals, maxPrimaryFiles: 6, needsConfigContext, needsTestContext, reasons: ["The task explicitly names a documentation file as its edit target."] };
  }
  if (/\b(?:test|tests|spec|coverage|regression)\b|(?:тест|покрыти|регрессион)/iu.test(text)) {
    return { kind: "tests", exactLiterals, maxPrimaryFiles: 7, needsConfigContext: true, needsTestContext: true, reasons: ["The task is verification/test focused."] };
  }
  if (docsFocused) {
    return { kind: "docs", exactLiterals, maxPrimaryFiles: 6, needsConfigContext, needsTestContext, reasons: ["The task is documentation focused."] };
  }
  if (/\b(?:config|configuration|tsconfig|vite|webpack|environment)\b|(?:конфиг|настройк\w*\s+сборк|переменн\w*\s+окружени)/iu.test(text)) {
    return { kind: "config", exactLiterals, maxPrimaryFiles: 6, needsConfigContext, needsTestContext, reasons: ["The task is configuration/build focused."] };
  }

  const mentionsUi = /\b(?:frontend|renderer|ui|interface|screen|page|component|modal|button)\b|(?:интерфейс|фронтенд|рендерер|экран|страниц|компонент|модал|кнопк|сторінц|клієнтськ|фільтр)/iu.test(text);
  const mentionsBackend = /\b(?:backend|server|endpoint|route|api|handler)\b|(?:бэкенд|бекенд|сервер|эндпоинт|маршрут|обработчик|апи)/iu.test(text);
  const mentionsStorage = /\b(?:database|storage|repository|persist|session)\b|(?:баз\w*\s+данн|хранилищ|репозитор|сесси|сохран)/iu.test(text);
  const mentionsStateBehavior = /\b(?:state|store|cache|cached|stale|refresh|reload|rescan|reducer|controller|session)\b|(?:состояни|кеш|кэш|устаревш|обновлени|перезагруз|повторн\w*\s+скан|контроллер|сесси)/iu.test(text);
  const mentionsApiContract = /\b(?:field|property|flag|boolean|response|payload|contract|metric)\b|(?:пол[ея]|свойств|флаг|булев|ответ|контракт|метрик)/iu.test(text) && mentionsBackend;
  const visualLanguage = /\b(?:visual|style|layout|spacing|color|animation|modern|compact|polished)\b|(?:визуаль|стил|внешн\w*\s+вид|отступ|цвет|анимац|современн|компактн|аккуратн)/iu.test(text);

  if (mentionsApiContract && !mentionsUi) {
    return { kind: "api-contract", exactLiterals, maxPrimaryFiles: 5, needsConfigContext, needsTestContext, reasons: ["The task changes an API or data contract."] };
  }
  const backendIsProtected = protectsBackendMutation(rawTask, input.taskIntent);
  const modelFullstackIsGrounded =
    input.taskIntent?.taskArea === "fullstack" &&
    !backendIsProtected &&
    (mentionsBackend || input.taskIntent.structuredIntent.needsBackend === true);
  const crossLayerInteraction =
    !backendIsProtected &&
    mentionsUi &&
    mentionsBackend &&
    (input.taskIntent?.structuredIntent.needsBackend === true ||
      /\b(?:connect|call|request|fetch|load|submit|send|trigger)\b|(?:подключ|вызов|запрос|загруз|отправ|триггер)/iu.test(text));
  if (
    (modelFullstackIsGrounded && mentionsUi) ||
    crossLayerInteraction ||
    ((!backendIsProtected && mentionsUi && mentionsBackend) &&
      (mentionsStorage || mentionsStateBehavior || understanding?.action === "create"))
  ) {
    return { kind: "fullstack-feature", exactLiterals, maxPrimaryFiles: 10, needsConfigContext, needsTestContext, reasons: ["The task explicitly spans UI and backend behavior."] };
  }
  if (mentionsApiContract) {
    return { kind: "api-contract", exactLiterals, maxPrimaryFiles: 5, needsConfigContext, needsTestContext, reasons: ["The task changes an API or data contract."] };
  }
  if (understanding?.action === "fix" || understanding?.action === "investigate" || input.taskIntent?.taskArea === "bugfix" || mentionsStateBehavior) {
    return { kind: "state-behavior", exactLiterals, maxPrimaryFiles: 7, needsConfigContext, needsTestContext, reasons: ["The task concerns behavior, refresh, cache, session, or state flow."] };
  }
  if (mentionsUi && visualLanguage) {
    return { kind: "visual-ui", exactLiterals, maxPrimaryFiles: 5, needsConfigContext, needsTestContext, reasons: ["The task is a visual UI change."] };
  }

  return { kind: "general", exactLiterals, maxPrimaryFiles: 8, needsConfigContext, needsTestContext, reasons: ["No narrower task profile was proven."] };
}
