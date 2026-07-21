import type {
  StructuredTaskIntent,
  StructuredIntentTargetProvenance,
  TaskArea,
  TaskIntentAnalysis,
} from "../ollama/taskIntentAnalyzer.js";
import type {
  TaskUnderstanding,
  TaskUnderstandingAction,
} from "../ollama/taskUnderstanding.js";
import { classifyTaskSelectionProfile } from "../selection/taskSelectionProfile.js";
import { extractClassifiedFileMentions } from "../selection/explicitFileMentions.js";
import type {
  FileSelectionEvidence,
  SelectionActionConfidence,
  SelectionOwnershipEvidence,
  SelectionPathValidity,
  SelectionTargetSource,
} from "../selection/repositorySemanticIndex.js";

export type TaskExecutionLayer =
  | "ui"
  | "client-api"
  | "backend"
  | "state"
  | "storage"
  | "tests"
  | "config"
  | "docs";

export type TaskExecutionMode =
  "implementation" | "investigation" | "clarification_required";

export type TaskEvidenceLevel = StructuredIntentTargetProvenance;

export interface TaskExecutionTargetEvidence {
  target: string;
  path?: string;
  evidenceLevel: TaskEvidenceLevel;
  confirmedForImplementation: boolean;
  reason: string;
  targetSource?: SelectionTargetSource;
  pathValidity?: SelectionPathValidity;
  ownershipEvidence?: SelectionOwnershipEvidence;
  actionConfidence?: SelectionActionConfidence;
}

export interface TaskExecutionAuthorization {
  intentAccepted: boolean;
  intentAcceptanceSource: "task_ready" | "user_review" | "none";
  scopeConfirmed: boolean;
  scopeGroundingAllowed?: boolean;
  scopeConfirmationSource:
    "exact_task" | "bounded_task" | "grounded_selection" | "none";
  targetAuthorization: "confirmed" | "unconfirmed";
  authorizedTargets: string[];
}

export interface TaskExecutionContract {
  schemaVersion: 1 | 2;
  mode: TaskExecutionMode;
  requiredLayers: TaskExecutionLayer[];
  candidateLayerCoverage?: TaskExecutionLayer[];
  confirmedLayerCoverage?: TaskExecutionLayer[];
  missingConfirmedLayers?: TaskExecutionLayer[];
  confirmedTargets: string[];
  targetEvidence: TaskExecutionTargetEvidence[];
  proposedTargets: string[];
  unresolvedDecisions: string[];
  forbiddenAssumptions: string[];
  allowImplementationGuidance: boolean;
  requiresLayerCoverage: boolean;
  implementationGateReasons: string[];
  reasons: string[];
  authorization?: TaskExecutionAuthorization;
}

interface BuildTaskExecutionContractInput {
  rawTask: string;
  projectTree: string[];
  taskArea: TaskArea | string;
  understanding: TaskUnderstanding;
  structuredIntent?: StructuredTaskIntent | null;
  fileRoleHints?: string[];
}

function normalizePath(value: string) {
  return value.replace(/\\/g, "/").trim();
}

function normalizeForCompare(value: string) {
  return normalizePath(value).toLowerCase();
}

function uniqueStrings(values: string[], limit = 16) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = String(value ?? "")
      .trim()
      .replace(/\s+/g, " ");
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= limit) break;
  }

  return result;
}

function detectContradictoryTaskRequirements(rawTask: string) {
  const text = rawTask.normalize("NFKC").replace(/\s+/g, " ").trim();
  const destructiveThenPreserve =
    /(?:\b(?:fully|completely)?\s*(?:remove|delete|disable|hide)\b|(?:полностью\s+)?(?:удал|убер|скрой|отключ)\p{L}*)[^.!?\n]{0,180}(?:\bbut\b|\bwhile\b|\bи\s+при\s+этом\b|\bно\b)[^.!?\n]{0,180}(?:\b(?:keep|leave|preserve|retain|remain|available|accessible)\b|(?:остав|сохран|доступ|без\s+изменения\s+поведения)\p{L}*)/iu.test(
      text,
    );
  const positiveThenNegatedSameAction =
    /(?:\b(?:create|add|enable|register)\b|(?:созд|добав|включ|зарегистрир)\p{L}*)[^.!?\n]{0,160}(?:\bbut\b|\bно\b)[^.!?\n]{0,120}(?:\b(?:do\s+not|don't|dont)\s+(?:create|add|enable|register)\b|(?:не\s+(?:созда|добав|включ|регистрир))\p{L}*)/iu.test(
      text,
    );

  return uniqueStrings(
    [
      destructiveThenPreserve
        ? "Contradictory requirement: the task asks to remove or disable a surface while also preserving its availability or behavior."
        : "",
      positiveThenNegatedSameAction
        ? "Contradictory requirement: the task both requests and forbids the same creation or registration action."
        : "",
    ],
    4,
  );
}

function pathStem(pathValue: string) {
  return (
    normalizePath(pathValue)
      .split("/")
      .pop()
      ?.replace(/\.[a-z0-9]+$/iu, "") ?? ""
  );
}

function taskExplicitlyNamesTarget(
  rawTask: string,
  pathValue: string,
  structuredKind?: string,
) {
  const taskText = normalizeForCompare(rawTask);
  const normalizedPath = normalizeForCompare(pathValue);
  const basename = normalizedPath.split("/").pop() ?? normalizedPath;
  const stem = pathStem(pathValue);
  if (!stem) return false;

  if (taskText.includes(normalizedPath) || taskText.includes(basename))
    return true;

  const escapedStem = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const typedCodeTarget = new Set([
    "component",
    "page",
    "route",
    "file",
    "module",
    "service",
    "hook",
    "store",
  ]).has(String(structuredKind ?? "").toLowerCase());
  if (typedCodeTarget) {
    const directNamePattern = new RegExp(
      `(?:^|[^\p{L}\p{N}_])${escapedStem}(?:$|[^\p{L}\p{N}_])`,
      "iu",
    );
    if (directNamePattern.test(rawTask)) return true;
  }
  const namedTargetPattern = new RegExp(
    `(?:component|page|screen|service|route|file|module|hook|store|компонент\\w*|страниц\\w*|экран\\w*|сервис\\w*|маршрут\\w*|файл\\w*|модул\\w*|хук\\w*|стор\\w*)[^\\n.!?]{0,36}\\b${escapedStem}\\b`,
    "iu",
  );
  return namedTargetPattern.test(rawTask);
}

const IMPLEMENTATION_ACTIONS = new Set<TaskUnderstandingAction>([
  "create",
  "update",
  "replace",
  "remove",
  "fix",
  "refactor",
  "configure",
]);

function taskProtectsTarget(rawTask: string, pathValue: string) {
  const normalizedPath = normalizePath(pathValue);
  const basename = normalizedPath.split("/").pop() ?? normalizedPath;
  const stem = pathStem(normalizedPath);
  const candidates = uniqueStrings([normalizedPath, basename, stem], 3);

  // Classify the concrete occurrence before using the broad proximity
  // fallback. Otherwise a protected supporting file later in the same clause
  // can accidentally revoke authorization for the positive target before it.
  const classifiedMention = extractClassifiedFileMentions(rawTask).find(
    (mention) => {
      const mentionPath = normalizeForCompare(mention.path);
      const targetPath = normalizeForCompare(normalizedPath);
      const mentionName = mentionPath.split("/").pop() ?? mentionPath;
      return (
        mentionPath === targetPath ||
        mentionPath.endsWith(`/${targetPath}`) ||
        targetPath.endsWith(`/${mentionPath}`) ||
        mentionName === normalizeForCompare(basename)
      );
    },
  );
  if (classifiedMention) {
    return classifiedMention.role === "artifact-reference";
  }

  const protection = String.raw`(?:do\s+not|don't|dont|without\s+(?:changing|editing|modifying|touching)|keep|leave|preserve|retain|не\s+(?:меняй|менять|трогай|трогать|редактируй|редактировать|изменяй|изменять)|оставь|оставить|сохрани|сохранить)`;

  return candidates.some((candidate) => {
    if (!candidate) return false;
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(
      `(?:${protection})[^.!?\\n]{0,140}${escaped}|${escaped}[^.!?\\n]{0,140}(?:${protection})`,
      "iu",
    ).test(rawTask);
  });
}

function taskAuthorizesTarget(
  rawTask: string,
  pathValue: string,
  action: TaskUnderstandingAction,
  structuredKind?: string,
) {
  return (
    IMPLEMENTATION_ACTIONS.has(action) &&
    taskExplicitlyNamesTarget(rawTask, pathValue, structuredKind) &&
    !taskProtectsTarget(rawTask, pathValue)
  );
}

function deriveExecutionAuthorization(
  understanding: TaskUnderstanding,
): TaskExecutionAuthorization {
  const intentAccepted =
    understanding.readiness === "ready" ||
    (understanding.readiness === "review" &&
      understanding.reviewStatus === "accepted");
  const scopeConfirmed = understanding.changeDefinition !== "open_ended";
  const scopeGroundingAllowed =
    understanding.interpretationRisk === "objective" &&
    understanding.action !== "refactor" &&
    (understanding.ambiguities?.length ?? 0) === 0 &&
    !(understanding.missingInformation ?? []).some((item) => item.required);

  return {
    intentAccepted,
    intentAcceptanceSource:
      understanding.readiness === "ready"
        ? "task_ready"
        : understanding.reviewStatus === "accepted"
          ? "user_review"
          : "none",
    scopeConfirmed,
    scopeGroundingAllowed,
    scopeConfirmationSource:
      understanding.changeDefinition === "exact"
        ? "exact_task"
        : understanding.changeDefinition === "bounded"
          ? "bounded_task"
          : "none",
    targetAuthorization: "unconfirmed",
    authorizedTargets: [],
  };
}

function findProjectPath(projectPaths: Map<string, string>, candidate: string) {
  const normalized = normalizeForCompare(candidate);
  if (!normalized) return undefined;
  const exact = projectPaths.get(normalized);
  if (exact) return exact;

  const matches = [...projectPaths.entries()].filter(([pathValue]) => {
    const basename = pathValue.split("/").pop() ?? pathValue;
    const stem = basename.replace(/\.[a-z0-9]+$/iu, "");
    return (
      pathValue.endsWith(`/${normalized}`) ||
      basename === normalized ||
      stem === normalized
    );
  });
  return matches.length === 1 ? matches[0]![1] : undefined;
}

function getTargetEvidence(
  rawTask: string,
  projectTree: string[],
  understanding: TaskUnderstanding,
  executionAuthorized: boolean,
  structuredIntent?: StructuredTaskIntent | null,
) {
  const projectPaths = new Map(
    projectTree.map((filePath) => [
      normalizeForCompare(filePath),
      normalizePath(filePath),
    ]),
  );
  const evidence: TaskExecutionTargetEvidence[] = [];
  const seen = new Set<string>();
  const add = (item: TaskExecutionTargetEvidence) => {
    const key = normalizeForCompare(
      `${item.path ?? ""}:${item.target}:${item.evidenceLevel}`,
    );
    if (!key || seen.has(key)) return;
    seen.add(key);
    evidence.push(item);
  };

  for (const target of structuredIntent?.primaryTargets ?? []) {
    const path = target.path
      ? findProjectPath(projectPaths, target.path)
      : undefined;
    const value = path ?? target.routePath ?? target.value;
    if (!value) continue;
    const explicitlyNamedPath = Boolean(
      path && taskExplicitlyNamesTarget(rawTask, path, target.kind),
    );
    const provenance = path
      ? explicitlyNamedPath
        ? "user_confirmed"
        : target.provenance === "user_confirmed"
          ? "inventory_exact"
          : (target.provenance ?? "inventory_exact")
      : (target.provenance ?? "model_proposed");
    const userConfirmed = Boolean(
      provenance === "user_confirmed" &&
      path &&
      executionAuthorized &&
      taskAuthorizesTarget(rawTask, path, understanding.action, target.kind),
    );
    add({
      target: value,
      path,
      evidenceLevel: provenance,
      confirmedForImplementation: userConfirmed,
      reason: target.evidence || "Structured target evidence.",
    });
  }

  for (const hint of understanding.targetHints) {
    const path = findProjectPath(projectPaths, hint);
    if (!path) {
      add({
        target: hint,
        evidenceLevel: "model_proposed",
        confirmedForImplementation: false,
        reason:
          "Understanding target hint was not resolved to an explicit user-named project path.",
      });
      continue;
    }
    const explicitlyNamed = taskExplicitlyNamesTarget(rawTask, path);
    const userConfirmed =
      executionAuthorized &&
      taskAuthorizesTarget(rawTask, path, understanding.action);
    add({
      target: path,
      path,
      evidenceLevel: explicitlyNamed ? "user_confirmed" : "inventory_exact",
      confirmedForImplementation: userConfirmed,
      reason: userConfirmed
        ? "The user explicitly requested a bounded implementation change on this real project target."
        : explicitlyNamed
          ? "The user named this real target, but intent or scope authorization is still incomplete."
          : "The path exists in inventory, but ownership was inferred rather than confirmed by the user.",
    });
  }

  return evidence.slice(0, 16);
}

function classifyExecutionTaskProfile({
  rawTask,
  taskArea,
  understanding,
  structuredIntent,
  fileRoleHints,
}: Pick<
  BuildTaskExecutionContractInput,
  | "rawTask"
  | "taskArea"
  | "understanding"
  | "structuredIntent"
  | "fileRoleHints"
>) {
  const area = String(taskArea || "general").toLowerCase();
  return classifyTaskSelectionProfile({
    rawTask,
    taskType: area,
    taskIntent: {
      taskArea: area as TaskIntentAnalysis["taskArea"],
      intentTags: [],
      domainTerms: [],
      mentionedEntities: [],
      fileRoleHints: fileRoleHints ?? [],
      recommendedSearchTerms: [],
      riskLevel: "low",
      confidence: understanding.confidence,
      notes: [],
      structuredIntent: structuredIntent ?? {
        schemaVersion: 1,
        primaryTargets: [],
        positiveActions: [],
        protectedScopes: [],
        allowedEditScope: "unknown",
        needsStyles: null,
        needsBackend: null,
        ambiguities: [],
        modelNotes: [],
      },
      taskUnderstanding: understanding,
      source: "fallback",
      durationMs: 0,
    },
  });
}

function inferRequiredLayers({
  rawTask,
  taskArea,
  understanding,
  structuredIntent,
  fileRoleHints,
}: Pick<
  BuildTaskExecutionContractInput,
  | "rawTask"
  | "taskArea"
  | "understanding"
  | "structuredIntent"
  | "fileRoleHints"
>) {
  const area = String(taskArea || "general").toLowerCase();
  const taskText = String(rawTask || "").toLowerCase();
  const roleHints = new Set(
    (fileRoleHints ?? []).map((value) => String(value).trim().toLowerCase()),
  );
  const profile = classifyExecutionTaskProfile({
    rawTask,
    taskArea,
    understanding,
    structuredIntent,
    fileRoleHints,
  });
  const layers: TaskExecutionLayer[] = [];
  const add = (layer: TaskExecutionLayer) => {
    if (!layers.includes(layer)) layers.push(layer);
  };
  const protectedText = [
    taskText,
    ...(structuredIntent?.protectedScopes ?? []),
    ...(understanding.constraints ?? []),
  ]
    .join(" ")
    .toLowerCase();
  const protectedLayers = new Set<TaskExecutionLayer>();
  if (
    /(?:\bbackend\b|server|api|endpoint|route|сервер|бэк|бекенд|бэкенд|эндпоинт|маршрут)[^.!?\n]{0,80}(?:не\s+(?:добавляй|добавлять|создавай|создавать|трогай|трогать|меняй|менять|изменяй|изменять|редактируй|редактировать)|do not|don't|dont|without)/iu.test(
      protectedText,
    ) ||
    /(?:не\s+(?:добавляй|добавлять|создавай|создавать|трогай|трогать|меняй|менять|изменяй|изменять|редактируй|редактировать)|do not|don't|dont|without)[^.!?\n]{0,80}(?:\bbackend\b|server|api|endpoint|route|сервер|бэк|бекенд|бэкенд|эндпоинт|маршрут)/iu.test(
      protectedText,
    ) ||
    /(?:\b(?:no|without)\s+(?:new|separate|additional)\s+(?:backend|server|api|endpoint|route)\b|без\s+(?:нов\p{L}*|отдельн\p{L}*|дополнительн\p{L}*)\s+(?:бэк\p{L}*|бек\p{L}*|backend|server|api|апи|сервер\p{L}*|эндпоинт\p{L}*|маршрут\p{L}*))/iu.test(
      protectedText,
    ) ||
    /(?:\b(?:backend|server|api|endpoint|route)\b|бэк\p{L}*|бек\p{L}*|апи|сервер\p{L}*|эндпоинт\p{L}*|маршрут\p{L}*)[^.!?\n]{0,100}(?:(?:create|add|introduce|register)(?:ing)?\s+(?:is\s+)?not\s+(?:needed|required)|(?:создавать|добавлять|регистрировать)\s+не\s+(?:нужно|требуется))/iu.test(
      protectedText,
    )
  ) {
    protectedLayers.add("backend");
  }
  if (
    /(?:\b(?:database|storage|repository|schema|persistence)\b|баз\w*\s+данн|хранилищ|репозитор|схем|формат\w*\s+хранени)[^.!?\n]{0,100}(?:не\s+(?:трогай|трогать|меняй|менять|изменяй|изменять|редактируй|редактировать)|do not|don't|dont|without|запрещ)/iu.test(
      protectedText,
    ) ||
    /(?:не\s+(?:трогай|трогать|меняй|менять|изменяй|изменять|редактируй|редактировать)|do not|don't|dont|without|запрещ)[^.!?\n]{0,100}(?:\b(?:database|storage|repository|schema|persistence)\b|баз\w*\s+данн|хранилищ|репозитор|схем|формат\w*\s+хранени)/iu.test(
      protectedText,
    )
  ) {
    protectedLayers.add("storage");
  }
  if (
    /(?:\b(?:frontend|ui|client)\b|фронт|интерфейс|клиент)[^.!?\n]{0,80}(?:не\s+(?:трогай|трогать|меняй|менять|изменяй|изменять|редактируй|редактировать)|do not|don't|dont|without)/iu.test(
      protectedText,
    ) ||
    /(?:не\s+(?:трогай|трогать|меняй|менять|изменяй|изменять|редактируй|редактировать)|do not|don't|dont|without)[^.!?\n]{0,80}(?:\b(?:frontend|ui|client)\b|фронт|интерфейс|клиент)/iu.test(
      protectedText,
    )
  ) {
    protectedLayers.add("ui");
    protectedLayers.add("client-api");
  }

  // Under an explicit-only edit scope, named file paths define the technical
  // layer. Command names and code examples written inside a documentation task
  // must not expand the contract to tests, build config, or application code.
  const explicitTargetPaths = uniqueStrings(
    extractClassifiedFileMentions(rawTask)
      .filter((mention) => mention.role !== "artifact-reference")
      .map((mention) => mention.path),
    12,
  );
  if (
    structuredIntent?.allowedEditScope === "explicit_targets_only" &&
    explicitTargetPaths.length > 0
  ) {
    const explicitLayers: TaskExecutionLayer[] = [];
    const addExplicitLayer = (layer: TaskExecutionLayer) => {
      if (!explicitLayers.includes(layer)) explicitLayers.push(layer);
    };
    for (const targetPath of explicitTargetPaths) {
      if (pathMatchesLayer(targetPath, "docs")) addExplicitLayer("docs");
      else if (pathMatchesLayer(targetPath, "tests")) addExplicitLayer("tests");
      else if (pathMatchesLayer(targetPath, "config"))
        addExplicitLayer("config");
      else if (pathMatchesLayer(targetPath, "storage"))
        addExplicitLayer("storage");
      else if (pathMatchesLayer(targetPath, "client-api"))
        addExplicitLayer("client-api");
      else if (pathMatchesLayer(targetPath, "backend"))
        addExplicitLayer("backend");
      else if (pathMatchesLayer(targetPath, "ui")) addExplicitLayer("ui");
    }
    return explicitLayers.filter((layer) => !protectedLayers.has(layer));
  }

  // Exact visible-text replacement is an ownership problem, not a state-flow
  // problem. Phrases such as "empty state" / "пустого состояния" must not
  // force a controller/store layer when the requested change is only a literal.
  if (profile.kind === "exact-text" || profile.kind === "symbol-rename") {
    return [];
  }

  // API/data-contract work follows the value across the server boundary. A
  // cache/reuse word may describe where the value comes from (for example,
  // "was this result returned from cache") without making UI/controller state
  // part of the requested change. Keep the default contract narrow and only
  // add client/UI/state/storage layers when the user explicitly asks for them.
  if (profile.kind === "api-contract") {
    add("backend");

    const explicitlyRequestsClientApi =
      /(?:\b(?:client api|api client|frontend api|renderer api|client contract|client type)\b|клиентск\w*\s+api|api[- ]клиент|клиентск\w*\s+контракт|тип\w*\s+клиент)/iu.test(
        taskText,
      );
    const explicitlyRequestsUi =
      /(?:\b(?:frontend|renderer|ui|interface|screen|page|component|modal|display|show in)\b|интерфейс|фронтенд|рендерер|экран|страниц|компонент|модал|покажи\w*\s+в)/iu.test(
        taskText,
      );
    const explicitlyRequestsStorage =
      /(?:\b(?:database|storage|repository|migration|schema|sqlite|postgres|persist|save to)\b|баз\w*\s+данн|хранилищ|репозитор|миграц|схем|сохран\w*\s+в)/iu.test(
        taskText,
      );
    const explicitlyRequestsStateFlow =
      /(?:\b(?:stale|refresh|reload|invalidate|clear cache|cache invalidation|controller|reducer|store update|session state)\b|устаревш|обновлени\w*\s+состояни|перезагруз|инвалидац|очист\w*\s+(?:кеш|кэш)|контроллер|редьюсер|состояни\w*\s+сесси)/iu.test(
        taskText,
      );

    if (explicitlyRequestsClientApi || explicitlyRequestsUi) add("client-api");
    if (explicitlyRequestsUi) add("ui");
    if (explicitlyRequestsStorage) add("storage");
    if (explicitlyRequestsStateFlow) add("state");
    if (/(?:\b(?:test|tests|spec|coverage)\b|тест|покрыт)/iu.test(taskText))
      add("tests");

    return layers.filter((layer) => !protectedLayers.has(layer));
  }

  if (area === "ui") add("ui");
  if (area === "backend") add("backend");
  if (area === "fullstack") {
    add("backend");
    add("client-api");
    add("ui");
  }
  if (area === "tests") add("tests");
  if (area === "docs") add("docs");
  if (area === "build") add("config");

  if (structuredIntent?.needsBackend === true) add("backend");
  if (structuredIntent?.needsStyles === true) add("ui");

  if (
    /(?:\b(?:frontend|renderer|ui|interface|screen|page|component)\b|интерфейс|фронтенд|рендерер|экран|страниц|компонент)/iu.test(
      taskText,
    )
  )
    add("ui");
  if (/(?:\bbackend\b|сервер|бэкенд)/iu.test(taskText)) add("backend");
  if (
    /(?:\b(?:client api|api client|frontend api|renderer api)\b|клиентск\w*\s+api|api[- ]клиент)/iu.test(
      taskText,
    )
  )
    add("client-api");
  const exactFileRemoval =
    understanding.action === "remove" &&
    understanding.targetHints.some((hint) => /\.[a-z0-9]{1,10}$/iu.test(hint));
  const explicitStateSemantics =
    /(?:\b(?:state|store|cache|cached|reducer|controller|session)\b|состояни|кеш|кэш|контроллер|сесси)/iu.test(
      taskText,
    );
  const staleBehaviorSemantics =
    /\b(?:stale|outdated)\b|устаревш/iu.test(taskText) && !exactFileRemoval;
  if (explicitStateSemantics || staleBehaviorSemantics) add("state");
  if (
    /(?:\b(?:database|storage|repository|migration|schema|sqlite|postgres|persist)\b|баз\w*\s+данн|хранилищ|репозитор|миграц|схем|сохран)/iu.test(
      taskText,
    )
  )
    add("storage");
  if (/(?:\b(?:test|tests|spec|coverage)\b|тест|покрыт)/iu.test(taskText))
    add("tests");
  if (
    /(?:\b(?:config|configuration|settings file)\b|конфиг|файл\w*\s+настро)/iu.test(
      taskText,
    )
  )
    add("config");
  if (/(?:\b(?:docs|documentation|readme)\b|документ|ридми)/iu.test(taskText))
    add("docs");

  if (layers.length === 0) {
    if (
      roleHints.has("api") ||
      roleHints.has("route") ||
      roleHints.has("service")
    )
      add("backend");
    if (roleHints.has("state")) add("state");
    if (roleHints.has("test")) add("tests");
    if (roleHints.has("config")) add("config");
  }

  if (
    understanding.action === "fix" ||
    understanding.action === "investigate" ||
    area === "bugfix"
  ) {
    add("state");
  }

  return layers.filter((layer) => !protectedLayers.has(layer));
}

function pathMatchesLayer(pathValue: string, layer: TaskExecutionLayer) {
  const pathText = normalizeForCompare(pathValue);
  if (layer === "ui")
    return (
      /(?:\/pages?\/|\/components?\/|\/renderer\/)/u.test(pathText) &&
      !/(?:\/api\/|client\.ts$)/u.test(pathText)
    );
  if (layer === "client-api")
    return (
      /(?:\/api\/|api\/client|client\.ts$)/u.test(pathText) &&
      /(?:renderer|frontend|client|apps\/desktop)/u.test(pathText)
    );
  if (layer === "backend")
    return /(?:^|\/)(?:server|backend)(?:\/|$)/u.test(pathText);
  if (layer === "state")
    return /(?:\/hooks?\/|\/stores?\/|\/state\/|controller|reducer|cache|session)/u.test(
      pathText,
    );
  if (layer === "storage")
    return /(?:\/storage\/|\/db\/|\/database\/|\/repositories?\/|schema|migration)/u.test(
      pathText,
    );
  if (layer === "tests")
    return /(?:test|spec|smoke|replay|fixture)/u.test(pathText);
  if (layer === "config")
    return /(?:package\.json|tsconfig|jsconfig|vite|webpack|rollup|eslint|prettier|tailwind|postcss|docker-compose|dockerfile|makefile|(?:^|\/)\.env(?:\.|$)|\.ya?ml$|\.toml$|config)/u.test(
      pathText,
    );
  if (layer === "docs") return /(?:\.md$|\/docs\/|readme)/u.test(pathText);
  return false;
}

function evidenceConfirmsOwnership(evidence?: FileSelectionEvidence) {
  if (!evidence || evidence.actionConfidence === "inspect_only") return false;
  if (
    evidence.actionConfidence === "confirmed_edit" &&
    (evidence.targetSource === "user_text" ||
      evidence.targetSource === "clarification") &&
    (evidence.pathValidity === "inventory_exact" ||
      evidence.pathValidity === "synthetic") &&
    evidence.negativeConstraintConflicts.length === 0
  ) {
    return true;
  }
  return ["symbol_exact", "route_graph", "state_graph"].includes(
    evidence.ownershipEvidence,
  );
}

function isConditionalRemovalTask(rawTask: string) {
  return (
    /\b(?:delete|remove)\b|(?:удал|убер)/iu.test(rawTask) &&
    (/\b(?:if|only\s+if)\b[^.!?\n]{0,100}\b(?:unused|not\s+used|no\s+longer\s+used|unreferenced)\b/iu.test(
      rawTask,
    ) ||
      /(?:если|только\s+если)[^.!?\n]{0,100}(?:не\s+использ|не\s+нуж|нет\s+ссылок|не\s+подключ)/iu.test(
        rawTask,
      ))
  );
}

function requiresExistingImplementationProof(rawTask: string | undefined) {
  if (!rawTask) return false;
  return (
    /\b(?:use|reuse)\b[^.!?\n]{0,120}\bexisting\b[^.!?\n]{0,160}\b(?:if|when)\b[^.!?\n]{0,80}\b(?:exists?|available|present)\b/iu.test(
      rawTask,
    ) ||
    /(?:используй|использовать)[^.!?\n]{0,120}существующ[^.!?\n]{0,160}(?:если|когда)[^.!?\n]{0,80}(?:есть|существ|доступн)/iu.test(
      rawTask,
    )
  );
}

function conditionalRemovalEvidenceIsSatisfied(
  rawTask: string | undefined,
  selectedFiles: Array<{
    usage: string;
    selectionEvidence?: FileSelectionEvidence;
  }>,
) {
  if (!rawTask || !isConditionalRemovalTask(rawTask)) return true;
  return selectedFiles.some((file) => {
    const evidence = file.selectionEvidence;
    return (
      file.usage === "inspect-and-edit" &&
      evidence?.targetSource === "user_text" &&
      evidence.pathValidity === "inventory_exact" &&
      evidence.ownershipEvidence === "reference_graph" &&
      evidence.actionConfidence === "confirmed_edit" &&
      evidence.negativeConstraintConflicts.length === 0
    );
  });
}

function evidenceConfirmsLayer(
  file: {
    path: string;
    evidenceLevel?: TaskEvidenceLevel;
    selectionEvidence?: FileSelectionEvidence;
  },
  layer: TaskExecutionLayer,
) {
  if (!pathMatchesLayer(file.path, layer)) return false;
  if (file.evidenceLevel === "user_confirmed") return true;
  const evidence = file.selectionEvidence;
  const groundedInspectOnlySupport =
    evidence?.actionConfidence === "inspect_only" &&
    evidence.pathValidity === "inventory_exact" &&
    ["symbol_exact", "reference_graph", "route_graph", "state_graph"].includes(
      evidence.ownershipEvidence,
    ) &&
    evidence.negativeConstraintConflicts.length === 0;
  if (!evidenceConfirmsOwnership(evidence) && !groundedInspectOnlySupport) {
    return false;
  }
  if (layer === "storage") {
    return Boolean(evidence?.semanticRoles.includes("storage"));
  }
  return true;
}

function buildUnresolvedDecisions(
  understanding: TaskUnderstanding,
  structuredIntent?: StructuredTaskIntent | null,
) {
  return uniqueStrings(
    [
      ...understanding.missingInformation
        .filter((item) => item.required)
        .map((item) => item.description),
      ...(understanding.ambiguities ?? []),
      ...(structuredIntent?.ambiguities ?? []),
    ],
    8,
  );
}

export function buildTaskExecutionContract({
  rawTask,
  projectTree,
  taskArea,
  understanding,
  structuredIntent,
  fileRoleHints,
}: BuildTaskExecutionContractInput): TaskExecutionContract {
  const authorization = deriveExecutionAuthorization(understanding);
  const executionAuthorized =
    authorization.intentAccepted && authorization.scopeConfirmed;
  const profile = classifyExecutionTaskProfile({
    rawTask,
    taskArea,
    understanding,
    structuredIntent,
    fileRoleHints,
  });
  const targetEvidence = getTargetEvidence(
    rawTask,
    projectTree,
    understanding,
    executionAuthorized,
    structuredIntent,
  );
  const confirmedTargets = uniqueStrings(
    targetEvidence
      .filter((item) => item.confirmedForImplementation && item.path)
      .map((item) => item.path!),
    12,
  );
  const proposedTargets = uniqueStrings(
    targetEvidence
      .filter((item) => !item.confirmedForImplementation)
      .map((item) => item.path ?? item.target),
    12,
  );
  const unresolvedDecisions = buildUnresolvedDecisions(
    understanding,
    structuredIntent,
  );
  const requiredLayers = inferRequiredLayers({
    rawTask,
    taskArea,
    understanding,
    structuredIntent,
    fileRoleHints,
  });
  const confirmedLayerCoverage = new Set(
    requiredLayers.filter((layer) =>
      confirmedTargets.some((target) => pathMatchesLayer(target, layer)),
    ),
  );
  const isBugInvestigation =
    String(taskArea).toLowerCase() === "bugfix" ||
    understanding.action === "fix" ||
    understanding.action === "investigate";
  const requiresClarification =
    understanding.readiness === "needs_clarification" ||
    !understanding.canProceed;

  const implementationGateReasons = uniqueStrings(
    [
      !authorization.intentAccepted && !requiresClarification
        ? "Task interpretation has not been accepted for this reviewed snapshot."
        : "",
      !authorization.scopeConfirmed && !requiresClarification
        ? "Open-ended task scope is not confirmed; accepting an interpretation does not authorize a guessed implementation scope."
        : "",
      isBugInvestigation
        ? "Bugfix ownership is not assumed before tracing the real state/control-flow chain."
        : "",
      isConditionalRemovalTask(rawTask)
        ? "Conditional file removal requires complete repository evidence that the exact target is unused."
        : "",
      ...detectContradictoryTaskRequirements(rawTask),
    ],
    8,
  );

  const mode: TaskExecutionMode = requiresClarification
    ? "clarification_required"
    : implementationGateReasons.length > 0
      ? "investigation"
      : "implementation";
  const allowImplementationGuidance =
    mode === "implementation" && understanding.canProceed;

  const forbiddenAssumptions = uniqueStrings(
    [
      "Do not invent files, endpoints, providers, state owners, storage behavior, or code relationships that are not grounded in the selected project context.",
      "Model-proposed targets and ranked candidates are not confirmed implementation owners.",
      mode !== "implementation"
        ? "Do not convert an unresolved task into a file-specific implementation plan. Investigate or clarify first."
        : "",
      confirmedTargets.length === 0
        ? "Do not restrict edits to a single guessed file when no implementation target has been confirmed by the user or code graph."
        : "",
      requiredLayers.length > 1
        ? "Do not drop a required technical layer merely because another layer has a stronger lexical match."
        : "",
      profile.kind === "api-contract"
        ? "Before creating a new API field or value, verify whether an equivalent producer value already exists. Reuse or expose the existing source of truth instead of duplicating its semantics."
        : "",
      ...understanding.constraints.map(
        (constraint) => `User safeguard: ${constraint}`,
      ),
      ...(structuredIntent?.protectedScopes ?? []).map(
        (scope) => `Protected scope: ${scope}`,
      ),
    ],
    10,
  );

  return {
    schemaVersion: 2,
    mode,
    requiredLayers,
    candidateLayerCoverage: requiredLayers.filter((layer) =>
      [...confirmedTargets, ...proposedTargets].some((target) =>
        pathMatchesLayer(target, layer),
      ),
    ),
    confirmedLayerCoverage: [...confirmedLayerCoverage],
    missingConfirmedLayers: requiredLayers.filter(
      (layer) => !confirmedLayerCoverage.has(layer),
    ),
    confirmedTargets,
    targetEvidence,
    proposedTargets,
    unresolvedDecisions,
    forbiddenAssumptions,
    allowImplementationGuidance,
    requiresLayerCoverage: requiredLayers.length > 1,
    implementationGateReasons,
    reasons: uniqueStrings(
      [
        `Execution mode: ${mode}.`,
        confirmedTargets.length > 0
          ? `Confirmed ${confirmedTargets.length} user-grounded real target path(s).`
          : "No user-grounded implementation target path was confirmed.",
        proposedTargets.length > 0
          ? `Retained ${proposedTargets.length} model/inventory proposal(s) as unconfirmed evidence.`
          : "No unconfirmed target proposal was retained.",
        requiredLayers.length > 0
          ? `Required technical layers: ${requiredLayers.join(", ")}.`
          : "No mandatory technical layer was inferred.",
        unresolvedDecisions.length > 0
          ? `Unresolved decision count: ${unresolvedDecisions.length}.`
          : "No unresolved execution decision was retained.",
        ...implementationGateReasons,
      ],
      12,
    ),
    authorization: {
      ...authorization,
      targetAuthorization:
        mode === "implementation" && confirmedTargets.length > 0
          ? "confirmed"
          : "unconfirmed",
      authorizedTargets: mode === "implementation" ? confirmedTargets : [],
    },
  };
}

export function applySelectionEvidenceGate(input: {
  contract: TaskExecutionContract;
  rawTask?: string;
  selectedFiles: Array<{
    path: string;
    usage: string;
    evidenceLevel?: TaskEvidenceLevel;
    selectionEvidence?: FileSelectionEvidence;
  }>;
  missingRequiredLayers?: TaskExecutionLayer[];
  existingImplementationCandidates?: string[];
  existingImplementationRequiresReview?: boolean;
}): TaskExecutionContract {
  const selectionGroundsReviewedScope = Boolean(
    input.contract.authorization?.intentAccepted &&
    !input.contract.authorization.scopeConfirmed &&
    input.contract.authorization.scopeGroundingAllowed !== false &&
    input.contract.unresolvedDecisions.length === 0 &&
    (input.missingRequiredLayers ?? []).length === 0 &&
    input.selectedFiles.some((file) => {
      const evidence = file.selectionEvidence;
      return (
        (file.usage === "inspect-and-edit" ||
          file.usage === "create-and-edit") &&
        evidence?.targetSource === "user_text" &&
        evidence.pathValidity === "inventory_exact" &&
        evidenceConfirmsOwnership(evidence) &&
        evidence.negativeConstraintConflicts.length === 0
      );
    }),
  );
  const executionAuthorized = input.contract.authorization
    ? input.contract.authorization.intentAccepted &&
      (input.contract.authorization.scopeConfirmed ||
        selectionGroundsReviewedScope)
    : true;
  const selectedPaths = new Set(
    input.selectedFiles.map((file) => normalizeForCompare(file.path)),
  );
  const normalizedContractTargetEvidence = input.contract.targetEvidence.map(
    (target) => {
      if (!executionAuthorized && target.confirmedForImplementation) {
        return {
          ...target,
          confirmedForImplementation: false,
          reason:
            "Target ownership evidence exists, but task intent or scope authorization is incomplete.",
        };
      }
      if (
        input.rawTask &&
        target.path &&
        target.evidenceLevel === "user_confirmed" &&
        !taskExplicitlyNamesTarget(input.rawTask, target.path)
      ) {
        return {
          ...target,
          evidenceLevel: "inventory_exact" as const,
          confirmedForImplementation: false,
          reason:
            "The path exists in inventory, but the user did not explicitly name this file or path.",
        };
      }
      return target;
    },
  );
  const normalizedContractConfirmedTargets =
    input.contract.confirmedTargets.filter((target) => {
      const evidence = normalizedContractTargetEvidence.find(
        (item) =>
          item.path &&
          normalizeForCompare(item.path) === normalizeForCompare(target),
      );
      if (evidence) return evidence.confirmedForImplementation;
      return input.rawTask
        ? taskExplicitlyNamesTarget(input.rawTask, target)
        : true;
    });
  const missingRequiredLayers = input.missingRequiredLayers ?? [];
  const editable = input.selectedFiles.filter(
    (file) =>
      file.usage === "inspect-and-edit" || file.usage === "create-and-edit",
  );
  const hasTrustedEditableEvidence = editable.some((file) => {
    if (file.evidenceLevel === "user_confirmed") return true;
    const evidence = file.selectionEvidence;
    return evidenceConfirmsOwnership(evidence);
  });
  const missingConfirmedTargets = normalizedContractConfirmedTargets.filter(
    (target) => !selectedPaths.has(normalizeForCompare(target)),
  );
  const candidateLayerCoverage = input.contract.requiredLayers.filter((layer) =>
    input.selectedFiles.some((file) => pathMatchesLayer(file.path, layer)),
  );
  const confirmedLayerCoverage = input.contract.requiredLayers.filter((layer) =>
    input.selectedFiles.some((file) => evidenceConfirmsLayer(file, layer)),
  );
  const missingConfirmedLayers = input.contract.requiredLayers.filter(
    (layer) => !confirmedLayerCoverage.includes(layer),
  );
  const gateReasons = uniqueStrings(
    [
      ...input.contract.implementationGateReasons.filter((reason) =>
        /Bugfix ownership is not assumed before tracing|Contradictory requirement/iu.test(
          reason,
        ),
      ),
      input.contract.authorization &&
      !input.contract.authorization.intentAccepted
        ? "Task interpretation has not been accepted for this reviewed snapshot."
        : "",
      input.contract.authorization &&
      !input.contract.authorization.scopeConfirmed &&
      !selectionGroundsReviewedScope
        ? "Open-ended task scope is not confirmed; accepting an interpretation does not authorize a guessed implementation scope."
        : "",
      input.contract.unresolvedDecisions.length > 0 &&
      !selectionGroundsReviewedScope
        ? "Unresolved execution decisions still require investigation or clarification."
        : "",
      !conditionalRemovalEvidenceIsSatisfied(input.rawTask, input.selectedFiles)
        ? "Conditional file removal remains investigative until the complete inventory proves that the exact target is unused."
        : "",
      input.existingImplementationRequiresReview &&
      requiresExistingImplementationProof(input.rawTask)
        ? "The task is conditional on existing implementation data; trace and confirm that producer/consumer chain before authorizing UI edits."
        : "",
      missingRequiredLayers.length > 0
        ? `Required layer coverage is incomplete: ${missingRequiredLayers.join(", ")}.`
        : "",
      missingConfirmedLayers.length > 0 &&
      input.contract.requiredLayers.length > 0
        ? `Confirmed layer coverage is incomplete: ${missingConfirmedLayers.join(", ")}.`
        : "",
      missingConfirmedTargets.length > 0 && !hasTrustedEditableEvidence
        ? `Final selection omitted confirmed target(s): ${missingConfirmedTargets.join(", ")}.`
        : "",
      editable.length > 0 && !hasTrustedEditableEvidence
        ? "Editable candidates do not have user-confirmed or code-confirmed ownership evidence; ownership still needs code evidence and implementation must remain investigative."
        : "",
      input.existingImplementationRequiresReview && !hasTrustedEditableEvidence
        ? "Existing implementation evidence matches an add/create request; inspect the ownership evidence chain before adding duplicate behavior."
        : (input.existingImplementationCandidates?.length ?? 0) > 0 &&
            !hasTrustedEditableEvidence
          ? "Existing implementation evidence was found and must be inspected before adding duplicate behavior."
          : "",
    ],
    12,
  );

  const targetEvidence = normalizedContractTargetEvidence
    .filter((target) => {
      if (!target.path) {
        return !(
          hasTrustedEditableEvidence &&
          !target.confirmedForImplementation &&
          target.evidenceLevel !== "user_confirmed"
        );
      }
      return selectedPaths.has(normalizeForCompare(target.path));
    })
    .map((target) => {
      const matching = input.selectedFiles.find(
        (file) =>
          target.path &&
          normalizeForCompare(file.path) === normalizeForCompare(target.path),
      );
      if (!matching?.selectionEvidence) {
        if (
          matching &&
          matching.usage !== "inspect-and-edit" &&
          matching.usage !== "create-and-edit"
        ) {
          return {
            ...target,
            confirmedForImplementation: false,
            reason:
              "The target is present only as inspect-only context in the final selection.",
          };
        }
        return target;
      }
      const confirmedForImplementation =
        executionAuthorized &&
        (matching.usage === "inspect-and-edit" ||
          matching.usage === "create-and-edit") &&
        evidenceConfirmsOwnership(matching.selectionEvidence);
      return {
        ...target,
        evidenceLevel: matching.evidenceLevel ?? target.evidenceLevel,
        confirmedForImplementation,
        targetSource: matching.selectionEvidence.targetSource,
        pathValidity: matching.selectionEvidence.pathValidity,
        ownershipEvidence: matching.selectionEvidence.ownershipEvidence,
        actionConfidence: matching.selectionEvidence.actionConfidence,
        reason: matching.selectionEvidence.reason,
      };
    });
  for (const file of input.selectedFiles) {
    if (!file.selectionEvidence) continue;
    if (
      targetEvidence.some(
        (target) =>
          target.path &&
          normalizeForCompare(target.path) === normalizeForCompare(file.path),
      )
    )
      continue;
    const confirmedForImplementation =
      executionAuthorized &&
      (file.usage === "inspect-and-edit" || file.usage === "create-and-edit") &&
      evidenceConfirmsOwnership(file.selectionEvidence);
    targetEvidence.push({
      target: file.path,
      path: file.path,
      evidenceLevel: file.evidenceLevel ?? "model_proposed",
      confirmedForImplementation,
      reason: file.selectionEvidence.reason,
      targetSource: file.selectionEvidence.targetSource,
      pathValidity: file.selectionEvidence.pathValidity,
      ownershipEvidence: file.selectionEvidence.ownershipEvidence,
      actionConfidence: file.selectionEvidence.actionConfidence,
    });
  }

  const confirmedTargets = uniqueStrings(
    targetEvidence
      .filter((target) => target.confirmedForImplementation && target.path)
      .map((target) => target.path!),
    12,
  );
  const proposedTargets = uniqueStrings(
    targetEvidence
      .filter(
        (target) =>
          !target.confirmedForImplementation &&
          target.actionConfidence !== "inspect_only",
      )
      .map((target) => target.path ?? target.target),
    12,
  );

  const finalGateReasons = uniqueStrings(
    [
      ...gateReasons,
      confirmedTargets.length === 0
        ? "No implementation target is confirmed by the final user/code evidence."
        : "",
    ],
    12,
  );

  const finalMode: TaskExecutionMode =
    input.contract.mode === "clarification_required"
      ? "clarification_required"
      : finalGateReasons.length > 0
        ? "investigation"
        : "implementation";
  const unresolvedDecisions = selectionGroundsReviewedScope
    ? []
    : input.contract.unresolvedDecisions;
  const allowImplementationGuidance =
    finalMode === "implementation" && unresolvedDecisions.length === 0;
  const forbiddenAssumptions = uniqueStrings(
    input.contract.forbiddenAssumptions.filter((assumption) => {
      if (
        confirmedTargets.length > 0 &&
        /Do not restrict edits to a single guessed file/iu.test(assumption)
      )
        return false;
      if (
        finalMode === "implementation" &&
        /Do not convert an unresolved task/iu.test(assumption)
      )
        return false;
      if (
        input.contract.requiredLayers.length <= 1 &&
        /Do not drop a required technical layer/iu.test(assumption)
      )
        return false;
      return true;
    }),
    12,
  );

  const reasons = uniqueStrings(
    [
      `Execution mode: ${finalMode}.`,
      confirmedTargets.length > 0
        ? `Confirmed ${confirmedTargets.length} implementation target(s) from current user/code evidence.`
        : "No implementation target is confirmed by current user/code evidence.",
      proposedTargets.length > 0
        ? `Retained ${proposedTargets.length} unconfirmed target proposal(s).`
        : "No unconfirmed target proposal was retained.",
      input.contract.requiredLayers.length > 0
        ? `Required technical layers: ${input.contract.requiredLayers.join(", ")}.`
        : "No mandatory technical layer was inferred.",
      unresolvedDecisions.length > 0
        ? `Unresolved decision(s): ${unresolvedDecisions.join("; ")}.`
        : "No unresolved execution decision was retained.",
      ...finalGateReasons.map((reason) => `Implementation gate: ${reason}`),
    ],
    18,
  );

  return {
    ...input.contract,
    mode: finalMode,
    allowImplementationGuidance,
    candidateLayerCoverage,
    confirmedLayerCoverage,
    missingConfirmedLayers,
    confirmedTargets,
    proposedTargets,
    targetEvidence,
    unresolvedDecisions,
    forbiddenAssumptions,
    implementationGateReasons: finalGateReasons,
    reasons,
    authorization: input.contract.authorization
      ? {
          ...input.contract.authorization,
          scopeConfirmed:
            input.contract.authorization.scopeConfirmed ||
            selectionGroundsReviewedScope,
          scopeConfirmationSource: selectionGroundsReviewedScope
            ? "grounded_selection"
            : input.contract.authorization.scopeConfirmationSource,
          targetAuthorization:
            finalMode === "implementation" && confirmedTargets.length > 0
              ? "confirmed"
              : "unconfirmed",
          authorizedTargets:
            finalMode === "implementation" ? confirmedTargets : [],
        }
      : undefined,
  };
}

export function buildTaskExecutionContractFromIntent(input: {
  rawTask: string;
  projectTree: string[];
  taskIntent: TaskIntentAnalysis;
  effectiveTaskArea?: TaskArea | string;
}) {
  return buildTaskExecutionContract({
    rawTask: input.rawTask,
    projectTree: input.projectTree,
    taskArea: input.effectiveTaskArea ?? input.taskIntent.taskArea,
    understanding: input.taskIntent.taskUnderstanding,
    structuredIntent: input.taskIntent.structuredIntent,
    fileRoleHints: input.taskIntent.fileRoleHints,
  });
}
