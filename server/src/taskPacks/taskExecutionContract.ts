import type {
  StructuredTaskIntent,
  StructuredIntentTargetProvenance,
  TaskArea,
  TaskIntentAnalysis,
} from "../ollama/taskIntentAnalyzer.js";
import type { TaskUnderstanding } from "../ollama/taskUnderstanding.js";

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
  | "implementation"
  | "investigation"
  | "clarification_required";

export type TaskEvidenceLevel = StructuredIntentTargetProvenance;

export interface TaskExecutionTargetEvidence {
  target: string;
  path?: string;
  evidenceLevel: TaskEvidenceLevel;
  confirmedForImplementation: boolean;
  reason: string;
}

export interface TaskExecutionContract {
  schemaVersion: 1 | 2;
  mode: TaskExecutionMode;
  requiredLayers: TaskExecutionLayer[];
  confirmedTargets: string[];
  targetEvidence: TaskExecutionTargetEvidence[];
  proposedTargets: string[];
  unresolvedDecisions: string[];
  forbiddenAssumptions: string[];
  allowImplementationGuidance: boolean;
  requiresLayerCoverage: boolean;
  implementationGateReasons: string[];
  reasons: string[];
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
    const normalized = String(value ?? "").trim().replace(/\s+/g, " ");
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= limit) break;
  }

  return result;
}

function pathStem(pathValue: string) {
  return normalizePath(pathValue)
    .split("/")
    .pop()
    ?.replace(/\.[a-z0-9]+$/iu, "") ?? "";
}

function taskExplicitlyNamesTarget(rawTask: string, pathValue: string) {
  const taskText = normalizeForCompare(rawTask);
  const normalizedPath = normalizeForCompare(pathValue);
  const basename = normalizedPath.split("/").pop() ?? normalizedPath;
  const stem = pathStem(pathValue);
  if (!stem) return false;

  if (taskText.includes(normalizedPath) || taskText.includes(basename) || taskText.includes(normalizeForCompare(stem))) return true;

  const escapedStem = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const namedTargetPattern = new RegExp(
    `(?:component|page|screen|service|route|file|module|hook|store|компонент\\w*|страниц\\w*|экран\\w*|сервис\\w*|маршрут\\w*|файл\\w*|модул\\w*|хук\\w*|стор\\w*)[^\\n.!?]{0,36}\\b${escapedStem}\\b`,
    "iu",
  );
  return namedTargetPattern.test(rawTask);
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
  structuredIntent?: StructuredTaskIntent | null,
) {
  const projectPaths = new Map(
    projectTree.map((filePath) => [normalizeForCompare(filePath), normalizePath(filePath)]),
  );
  const evidence: TaskExecutionTargetEvidence[] = [];
  const seen = new Set<string>();
  const add = (item: TaskExecutionTargetEvidence) => {
    const key = normalizeForCompare(`${item.path ?? ""}:${item.target}:${item.evidenceLevel}`);
    if (!key || seen.has(key)) return;
    seen.add(key);
    evidence.push(item);
  };

  for (const target of structuredIntent?.primaryTargets ?? []) {
    const path = target.path ? findProjectPath(projectPaths, target.path) : undefined;
    const value = path ?? target.routePath ?? target.value;
    if (!value) continue;
    const explicitlyNamedPath = Boolean(path && taskExplicitlyNamesTarget(rawTask, path));
    const provenance = explicitlyNamedPath
      ? "user_confirmed"
      : target.provenance ?? "model_proposed";
    const userConfirmed = provenance === "user_confirmed" && Boolean(path);
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
        reason: "Understanding target hint was not resolved to an explicit user-named project path.",
      });
      continue;
    }
    const userConfirmed = taskExplicitlyNamesTarget(rawTask, path);
    add({
      target: path,
      path,
      evidenceLevel: userConfirmed ? "user_confirmed" : "inventory_exact",
      confirmedForImplementation: userConfirmed,
      reason: userConfirmed
        ? "The user explicitly named this real project target."
        : "The path exists in inventory, but ownership was inferred rather than confirmed by the user.",
    });
  }

  return evidence.slice(0, 16);
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
  const layers: TaskExecutionLayer[] = [];
  const add = (layer: TaskExecutionLayer) => {
    if (!layers.includes(layer)) layers.push(layer);
  };

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

  if (/(?:\b(?:frontend|renderer|ui|interface|screen|page|component)\b|интерфейс|фронтенд|рендерер|экран|страниц|компонент)/iu.test(taskText)) add("ui");
  if (/(?:\bbackend\b|сервер|бэкенд)/iu.test(taskText)) add("backend");
  if (/(?:\b(?:client api|api client|frontend api|renderer api)\b|клиентск\w*\s+api|api[- ]клиент)/iu.test(taskText)) add("client-api");
  if (/(?:\b(?:state|store|cache|cached|stale|reducer|controller|session)\b|состояни|кеш|кэш|устаревш|контроллер|сесси)/iu.test(taskText)) add("state");
  if (/(?:\b(?:database|storage|repository|migration|schema|sqlite|postgres|persist)\b|баз\w*\s+данн|хранилищ|репозитор|миграц|схем|сохран)/iu.test(taskText)) add("storage");
  if (/(?:\b(?:test|tests|spec|coverage)\b|тест|покрыт)/iu.test(taskText)) add("tests");
  if (/(?:\b(?:config|configuration|settings file)\b|конфиг|файл\w*\s+настро)/iu.test(taskText)) add("config");
  if (/(?:\b(?:docs|documentation|readme)\b|документ|ридми)/iu.test(taskText)) add("docs");

  if (layers.length === 0) {
    if (roleHints.has("api") || roleHints.has("route") || roleHints.has("service")) add("backend");
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

  return layers;
}

function pathMatchesLayer(pathValue: string, layer: TaskExecutionLayer) {
  const pathText = normalizeForCompare(pathValue);
  if (layer === "ui") return /(?:\/pages?\/|\/components?\/|\/renderer\/)/u.test(pathText) && !/(?:\/api\/|client\.ts$)/u.test(pathText);
  if (layer === "client-api") return /(?:\/api\/|api\/client|client\.ts$)/u.test(pathText) && /(?:renderer|frontend|client|apps\/desktop)/u.test(pathText);
  if (layer === "backend") return /(?:^|\/)(?:server|backend)(?:\/|$)/u.test(pathText);
  if (layer === "state") return /(?:\/hooks?\/|\/stores?\/|\/state\/|controller|reducer|cache|session)/u.test(pathText);
  if (layer === "storage") return /(?:\/storage\/|\/db\/|\/database\/|\/repositories?\/|schema|migration)/u.test(pathText);
  if (layer === "tests") return /(?:test|spec|smoke|replay|fixture)/u.test(pathText);
  if (layer === "config") return /(?:package\.json|tsconfig|vite|config)/u.test(pathText);
  if (layer === "docs") return /(?:\.md$|\/docs\/|readme)/u.test(pathText);
  return false;
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
  const targetEvidence = getTargetEvidence(
    rawTask,
    projectTree,
    understanding,
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
  const weakOpenEndedGrounding =
    understanding.changeDefinition === "open_ended" &&
    confirmedTargets.length === 0;
  const weakReviewGrounding =
    understanding.readiness === "review" &&
    (confirmedTargets.length === 0 ||
      requiredLayers.some((layer) => !confirmedLayerCoverage.has(layer)));
  const requiresClarification =
    understanding.readiness === "needs_clarification" ||
    !understanding.canProceed;

  const implementationGateReasons = uniqueStrings([
    isBugInvestigation ? "Bugfix ownership is not assumed before tracing the real state/control-flow chain." : "",
    weakOpenEndedGrounding ? "Open-ended task has no user-confirmed implementation target." : "",
    weakReviewGrounding ? "Review task does not have user-confirmed coverage for every required layer." : "",
  ], 8);

  const mode: TaskExecutionMode = requiresClarification
    ? "clarification_required"
    : implementationGateReasons.length > 0
      ? "investigation"
      : "implementation";
  const allowImplementationGuidance =
    mode === "implementation" && understanding.canProceed;

  const forbiddenAssumptions = uniqueStrings(
    [
      "Do not invent files, endpoints, providers, state owners, storage behavior, or data flow that are not grounded in the selected project context.",
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
    ],
    10,
  );

  return {
    schemaVersion: 2,
    mode,
    requiredLayers,
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
  };
}

export function applySelectionEvidenceGate(input: {
  contract: TaskExecutionContract;
  selectedFiles: Array<{
    path: string;
    usage: string;
    evidenceLevel?: TaskEvidenceLevel;
  }>;
  missingRequiredLayers?: TaskExecutionLayer[];
  existingImplementationCandidates?: string[];
}) {
  const selectedPaths = new Set(
    input.selectedFiles.map((file) => normalizeForCompare(file.path)),
  );
  const missingRequiredLayers = input.missingRequiredLayers ?? [];
  const editable = input.selectedFiles.filter((file) =>
    file.usage === "inspect-and-edit" || file.usage === "create-and-edit",
  );
  const hasTrustedEditableEvidence = editable.some((file) =>
    file.evidenceLevel === "user_confirmed" || file.evidenceLevel === "graph_supported",
  );
  const missingConfirmedTargets = input.contract.confirmedTargets.filter(
    (target) => !selectedPaths.has(normalizeForCompare(target)),
  );
  const gateReasons = uniqueStrings([
    ...input.contract.implementationGateReasons,
    missingRequiredLayers.length > 0
      ? `Required layer coverage is incomplete: ${missingRequiredLayers.join(", ")}.`
      : "",
    missingConfirmedTargets.length > 0
      ? `Final selection omitted confirmed target(s): ${missingConfirmedTargets.join(", ")}.`
      : "",
    editable.length > 0 && !hasTrustedEditableEvidence
      ? "Editable candidates are only model-proposed, inventory-exact, or rank-based; ownership still needs code evidence."
      : "",
    (input.existingImplementationCandidates?.length ?? 0) > 0 && !hasTrustedEditableEvidence
      ? "Existing implementation evidence was found and must be inspected before adding duplicate behavior."
      : "",
  ], 12);

  if (input.contract.mode === "clarification_required") return input.contract;
  if (gateReasons.length === 0) return input.contract;

  return {
    ...input.contract,
    mode: "investigation" as const,
    allowImplementationGuidance: false,
    implementationGateReasons: gateReasons,
    reasons: uniqueStrings([
      ...input.contract.reasons,
      ...gateReasons.map((reason) => `Implementation gate: ${reason}`),
    ], 18),
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
