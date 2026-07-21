import path from "node:path";

import type {
  TaskIntentAnalysis,
  StructuredIntentTarget,
  StructuredIntentTargetKind,
} from "../ollama/taskIntentAnalyzer.js";
import type {
  SelectedTaskFile,
  TaskFileSelection,
} from "../ollama/taskFileSelector.js";
import type {
  ProjectInventory,
  ProjectInventoryFile,
} from "../scanner/projectInventoryScanner.js";
import type { AppSettings } from "../settings/settingsService.js";
import type { FileSelectionEvidence } from "./repositorySemanticIndex.js";
import { classifyTaskSelectionProfile } from "./taskSelectionProfile.js";
import {
  applySelectionEvidenceGate,
  buildTaskExecutionContractFromIntent,
  type TaskExecutionLayer,
} from "../taskPacks/taskExecutionContract.js";

interface ExplicitNamedTarget {
  kind: "page" | "component" | "route" | "section" | "entity";
  value: string;
  evidence: string;
  priority: number;
}

interface ScoredTargetMatch {
  target: ExplicitNamedTarget;
  file: ProjectInventoryFile;
  score: number;
  evidence: string[];
}

export interface ExplicitTargetGuardResult {
  taskIntent: TaskIntentAnalysis;
  selection: TaskFileSelection;
  status: "not-applicable" | "matched" | "unresolved";
  matchedPath: string | null;
  targetLabels: string[];
  notes: string[];
}

export interface ExplicitTargetFastPathResult {
  taskIntent: TaskIntentAnalysis;
  selection: TaskFileSelection | null;
  status: "not-applicable" | "matched" | "ineligible" | "unresolved";
  matchedPath: string | null;
  targetLabels: string[];
  reason: string;
}

const EDIT_ACTIONS = new Set([
  "create",
  "update",
  "replace",
  "remove",
  "fix",
  "refactor",
  "configure",
]);

const ENGLISH_FORWARD_TARGET_PATTERN =
  /(?:page|screen|component|route|section|view)\s+(?:named\s+)?[«"“'`]?(.{2,80}?)(?=\s+(?:replace|rename|change|update|edit|modify|improve|make|add|remove|fix|show|display|render|under|below|where|that|which)|[\n,.!?;]|$)/giu;
const RUSSIAN_FORWARD_TARGET_PATTERN =
  /(?:на\s+)?(страниц\p{L}*|экран\p{L}*|компонент\p{L}*|маршрут\p{L}*|секци\p{L}*|раздел\p{L}*)\s+(?:с\s+названием\s+)?[«"“'`]?(.{2,80}?)(?=\s+(?:замени|заменить|переименуй|переименовать|измени|изменить|обнов\p{L}*|сделай|добавь|добавить|удали|удалить|убери|убрать|исправь|исправить|покажи|показать|отобрази|отобразить|выведи|вывести|под|где|которая|который|которое)|[\n,.!?;]|$)/giu;
const ENGLISH_SCOPED_TARGET_PATTERN =
  /\b(?:in|on)\s+(?:the\s+)?[«"“'`]?([A-Z][\p{L}\p{N}_. -]{1,70}?)(?=\s+(?:add|create|replace|rename|change|update|edit|remove|fix|show|display|render)\b)/gu;
const RUSSIAN_SCOPED_TARGET_PATTERN =
  /(?:^|[.!?;]\s*)[Вв]\s+[«"“'`]?([A-ZА-ЯЁ][\p{L}\p{N}_. -]{1,70}?)(?=\s+(?:добавь|добавить|создай|создать|замени|заменить|переименуй|переименовать|измени|изменить|обнов\p{L}*|удали|удалить|исправь|исправить|покажи|показать|отобрази|отобразить)(?=$|[\s,.;!?]))/gu;
const RUSSIAN_NAMED_SURFACE_PATTERN =
  /(?:^|[.!?;\s])(?:на\s+)?(страниц\p{L}*|экран\p{L}*|раздел\p{L}*|секци\p{L}*)\s+[«"“'`]?([A-ZА-ЯЁ][\p{L}\p{N}_.-]{1,70})[»"”'`]?/gu;
const ENGLISH_NAMED_SURFACE_PATTERN =
  /(?:^|[.!?;\s])(?:on\s+|in\s+)?(?:the\s+)?(page|screen|section|view)\s+[«"“'`]?([A-Z][\p{L}\p{N}_.-]{1,70})[»"”'`]?/gu;
const RUSSIAN_ACTION_SCOPED_TARGET_PATTERN =
  /(?:^|[.!?;]\s*)(?:добавь|добавить|создай|создать|сделай|изменить|измени|обнов\p{L}*|покажи|показать|размести|разместить)\s+(?:[^.!?;\n]{0,50}?\s+)?(?:в|на)\s+[«"“'`]?([A-ZА-ЯЁ][\p{L}\p{N}_.-]{1,70})[»"”'`]?/giu;
const ENGLISH_ACTION_SCOPED_TARGET_PATTERN =
  /(?:^|[.!?;]\s*)(?:add|create|make|update|change|show|place|render)\s+(?:[^.!?;\n]{0,50}?\s+)?(?:in|on)\s+(?:the\s+)?[«"“'`]?([A-Z][\p{L}\p{N}_.-]{1,70})[»"”'`]?/giu;
const REVERSE_TARGET_PATTERN =
  /[«"“'`]?([A-ZА-ЯЁ][\p{L}\p{N}_.-]{1,80})[»"”'`]?\s+(page|screen|component|route|view)\b/gu;
const HEADING_TARGET_PATTERN =
  /(?:under\s+(?:the\s+)?heading|below\s+(?:the\s+)?heading|под\s+заголовк\p{L}*|под\s+названи\p{L}*)\s+[«"“'`]?(.{2,100}?)(?=\s+(?:на|with|to)\s+[«"“'`]|[\n.!?;]|$)/giu;

function normalizeWhitespace(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeCompact(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function uniqueTargets(values: ExplicitNamedTarget[]) {
  const seen = new Set<string>();
  return values.filter((target) => {
    const key = `${target.kind}:${normalizeCompact(target.value)}`;
    if (!normalizeCompact(target.value) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mapTargetKind(value: string): ExplicitNamedTarget["kind"] {
  const normalized = value.toLowerCase();
  if (/route|маршрут/u.test(normalized)) return "route";
  if (/component|компонент/u.test(normalized)) return "component";
  if (/section|секци|раздел/u.test(normalized)) return "section";
  return "page";
}

function isPlausibleNamedTargetValue(value: string) {
  const normalized = normalizeWhitespace(value).toLowerCase();
  if (!normalized) return false;
  return !/^(?:не\s+(?:созда|добав|меня|трог|редактир|измен)|(?:созда|добав)\p{L}*\s+не\s+нужно|do\s+not\s+(?:create|add|change|touch|edit)|(?:create|add)\s+not\s+needed)/iu.test(
    normalized,
  );
}

export function extractExplicitNamedTargets(rawTask: string) {
  const targets: ExplicitNamedTarget[] = [];

  for (const pattern of [
    RUSSIAN_NAMED_SURFACE_PATTERN,
    ENGLISH_NAMED_SURFACE_PATTERN,
  ]) {
    pattern.lastIndex = 0;
    for (const match of rawTask.matchAll(pattern)) {
      const type = normalizeWhitespace(match[1] ?? "page");
      const value = normalizeWhitespace(match[2] ?? "")
        .replace(/^[«"“'`]|[»"”'`]$/gu, "")
        .trim();
      if (!isPlausibleNamedTargetValue(value)) continue;
      targets.push({
        kind: mapTargetKind(type),
        value,
        evidence: normalizeWhitespace(match[0]),
        priority: 110,
      });
    }
  }

  for (const pattern of [
    RUSSIAN_ACTION_SCOPED_TARGET_PATTERN,
    ENGLISH_ACTION_SCOPED_TARGET_PATTERN,
  ]) {
    pattern.lastIndex = 0;
    for (const match of rawTask.matchAll(pattern)) {
      const value = normalizeWhitespace(match[1] ?? "")
        .replace(/^[«"“'`]|[»"”'`]$/gu, "")
        .trim();
      if (!isPlausibleNamedTargetValue(value)) continue;
      targets.push({
        kind: "page",
        value,
        evidence: normalizeWhitespace(match[0]),
        priority: 105,
      });
    }
  }

  ENGLISH_FORWARD_TARGET_PATTERN.lastIndex = 0;
  for (const match of rawTask.matchAll(ENGLISH_FORWARD_TARGET_PATTERN)) {
    const type = normalizeWhitespace(match[0]).split(/\s+/u)[0] ?? "page";
    const value = normalizeWhitespace(match[1] ?? "")
      .replace(/^[«"“'`]|[»"”'`]$/gu, "")
      .trim();
    if (!isPlausibleNamedTargetValue(value)) continue;
    targets.push({
      kind: mapTargetKind(type),
      value,
      evidence: normalizeWhitespace(match[0]),
      priority: 100,
    });
  }

  RUSSIAN_FORWARD_TARGET_PATTERN.lastIndex = 0;
  for (const match of rawTask.matchAll(RUSSIAN_FORWARD_TARGET_PATTERN)) {
    const type = match[1] ?? "страница";
    const value = normalizeWhitespace(match[2] ?? "")
      .replace(/^[«"“'`]|[»"”'`]$/gu, "")
      .trim();
    if (!isPlausibleNamedTargetValue(value)) continue;
    targets.push({
      kind: mapTargetKind(type),
      value,
      evidence: normalizeWhitespace(match[0]),
      priority: 100,
    });
  }

  for (const pattern of [
    ENGLISH_SCOPED_TARGET_PATTERN,
    RUSSIAN_SCOPED_TARGET_PATTERN,
  ]) {
    pattern.lastIndex = 0;
    for (const match of rawTask.matchAll(pattern)) {
      const value = normalizeWhitespace(match[1] ?? "")
        .replace(/^[«"“'`]|[»"”'`]$/gu, "")
        .trim();
      if (!isPlausibleNamedTargetValue(value)) continue;
      targets.push({
        kind: "page",
        value,
        evidence: normalizeWhitespace(match[0]),
        priority: 90,
      });
    }
  }

  REVERSE_TARGET_PATTERN.lastIndex = 0;
  for (const match of rawTask.matchAll(REVERSE_TARGET_PATTERN)) {
    const value = normalizeWhitespace(match[1] ?? "");
    if (!isPlausibleNamedTargetValue(value)) continue;
    targets.push({
      kind: mapTargetKind(match[2] ?? "page"),
      value,
      evidence: normalizeWhitespace(match[0]),
      priority: 95,
    });
  }

  HEADING_TARGET_PATTERN.lastIndex = 0;
  for (const match of rawTask.matchAll(HEADING_TARGET_PATTERN)) {
    const value = normalizeWhitespace(match[1] ?? "")
      .replace(/^[«"“'`]|[»"”'`]$/gu, "")
      .trim();
    if (!isPlausibleNamedTargetValue(value)) continue;
    targets.push({
      kind: "section",
      value,
      evidence: normalizeWhitespace(match[0]),
      priority: 70,
    });
  }

  return uniqueTargets(targets).slice(0, 8);
}

function fileStem(file: ProjectInventoryFile) {
  return file.name
    .replace(/\.[^.]+$/u, "")
    .replace(/(?:page|screen|view|component|layout)$/iu, "");
}

function scoreFileForTarget(
  target: ExplicitNamedTarget,
  file: ProjectInventoryFile,
): ScoredTargetMatch | null {
  const label = normalizeCompact(target.value);
  if (label.length < 2) return null;

  const evidence: string[] = [];
  let score = target.priority;
  const stem = normalizeCompact(fileStem(file));
  const fullName = normalizeCompact(file.name.replace(/\.[^.]+$/u, ""));
  const pathValue = normalizeCompact(file.path);
  const routeValue = normalizeCompact(file.routePath ?? "");
  const symbols = file.symbols.map(normalizeCompact);
  const hints = file.textHints.map(normalizeCompact);
  const preview = normalizeCompact(file.contentPreview ?? "");

  if (stem === label) {
    score += 150;
    evidence.push("file stem exactly matches the named target");
  } else if (fullName === label || fullName === `${label}page`) {
    score += 140;
    evidence.push("file name exactly matches the named target");
  } else if (fullName.includes(label) && label.length >= 4) {
    score += 95;
    evidence.push("file name contains the named target");
  }

  if (routeValue && (routeValue === label || routeValue.endsWith(label))) {
    score +=
      target.kind === "route"
        ? 135
        : target.kind === "page" && file.role === "page"
          ? 100
          : 20;
    evidence.push("route metadata matches the named target");
  }

  if (symbols.some((symbol) => symbol === label || symbol === `${label}page`)) {
    score += 130;
    evidence.push("exported symbol matches the named target");
  } else if (
    symbols.some((symbol) => symbol.includes(label) && label.length >= 4)
  ) {
    score += 70;
    evidence.push("symbol metadata contains the named target");
  }

  if (pathValue.includes(label) && label.length >= 4) {
    score += 55;
    evidence.push("path contains the named target");
  }

  if (hints.some((hint) => hint === label || hint.includes(label))) {
    score += 55;
    evidence.push("inventory text hint matches the named target");
  } else if (preview.includes(label) && label.length >= 6) {
    score += 35;
    evidence.push("content preview contains the named target");
  }

  if (target.kind === "page" && file.role === "page") score += 70;
  if (
    target.kind === "page" &&
    !["page", "layout", "component", "ui-component"].includes(file.role)
  ) {
    score -= 160;
  }
  if (target.kind === "component" && /component/u.test(file.role)) score += 45;
  if (
    target.kind === "component" &&
    !["component", "ui-component", "page", "layout"].includes(file.role)
  ) {
    score -= 120;
  }
  if (target.kind === "route" && file.routePath) score += 35;
  if (target.kind === "section" && file.role === "page") score += 20;
  if (file.isLikelyGenerated || !file.canReadText) score -= 120;

  return evidence.length > 0 ? { target, file, score, evidence } : null;
}

function findStrongMatches(
  rawTask: string,
  inventory: ProjectInventory,
  taskIntent: TaskIntentAnalysis,
) {
  const explicitTargets = extractExplicitNamedTargets(rawTask);
  const fallbackHints = taskIntent.taskUnderstanding.targetHints.map(
    (value) => ({
      kind: "entity" as const,
      value,
      evidence: `Task Understanding target hint: ${value}`,
      priority: 35,
    }),
  );
  const targets = uniqueTargets([...explicitTargets, ...fallbackHints]);
  const matches = targets
    .flatMap((target) =>
      inventory.files
        .map((file) => scoreFileForTarget(target, file))
        .filter((value): value is ScoredTargetMatch => Boolean(value)),
    )
    .sort((left, right) => right.score - left.score);

  const bestByPath = new Map<string, ScoredTargetMatch>();
  for (const match of matches) {
    const existing = bestByPath.get(match.file.path);
    if (!existing || match.score > existing.score) {
      bestByPath.set(match.file.path, match);
    }
  }

  return {
    targets,
    matches: [...bestByPath.values()].sort(
      (left, right) => right.score - left.score,
    ),
  };
}

function isScopeOnlyNamedTarget(rawTask: string, target: ExplicitNamedTarget) {
  if (target.kind !== "page" && target.kind !== "section") return false;
  // A named nested container (card/component/modal/etc.) owns its controls and
  // makes the surrounding page a scope hint. A bare action or button does not:
  // in that case the explicitly named page remains the strongest real owner
  // until repository imports prove a more specific component.
  const directNestedTarget =
    /\b(?:card|component|modal|dialog|form|panel|header|menu)\b|(?:карточк|компонент|модал|диалог|панел|шапк|меню)/iu.test(
      rawTask,
    ) ||
    /(?:^|[^\p{L}])форм(?:а|е|у|ы|ой|ою|ах|ами)(?=$|[^\p{L}])/iu.test(rawTask);
  if (!directNestedTarget) return false;

  const escaped = target.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const scopePattern = new RegExp(
    String.raw`(?:\b(?:on|in)\s+(?:the\s+)?(?:page|screen|section)\s+[«"“']?${escaped}|(?:на|в)\s+(?:страниц\p{L}*|экран\p{L}*|раздел\p{L}*|секци\p{L}*)\s+[«"“']?${escaped})`,
    "iu",
  );
  return scopePattern.test(rawTask);
}

function resolveStrongExplicitTarget(
  rawTask: string,
  inventory: ProjectInventory,
  taskIntent: TaskIntentAnalysis,
) {
  const { targets, matches } = findStrongMatches(
    rawTask,
    inventory,
    taskIntent,
  );
  const extractedTargets = extractExplicitNamedTargets(rawTask);
  const pageBackedSectionKeys = new Set(
    matches
      .filter(
        (match) =>
          match.target.kind === "section" &&
          match.file.role === "page" &&
          match.score >= 220,
      )
      .map(
        (match) =>
          `${match.target.kind}:${normalizeCompact(match.target.value)}`,
      ),
  );
  const explicitTargets = extractedTargets.filter(
    (target) =>
      target.kind !== "entity" &&
      (target.kind !== "section" ||
        pageBackedSectionKeys.has(
          `${target.kind}:${normalizeCompact(target.value)}`,
        )) &&
      !isScopeOnlyNamedTarget(rawTask, target),
  );
  // A UI section label is a scope hint, not a concrete code target. Treating
  // "section Projects" as if the user named projects.ts lets an early lexical
  // match override later repository evidence. Only typed code targets such as a
  // page, component, or route may be authoritative here.
  const authoritativeKeys = new Set(
    explicitTargets.map(
      (target) => `${target.kind}:${normalizeCompact(target.value)}`,
    ),
  );
  const authoritativeMatches = matches.filter((match) =>
    authoritativeKeys.has(
      `${match.target.kind}:${normalizeCompact(match.target.value)}`,
    ),
  );
  const best = authoritativeMatches[0];
  const second = authoritativeMatches[1];
  const strongMatch =
    best &&
    best.score >= 220 &&
    (!second ||
      second.file.path === best.file.path ||
      best.score - second.score >= 25)
      ? best
      : null;

  return { targets, explicitTargets, strongMatch };
}

function targetUsesLocalizationIndirection(file: ProjectInventoryFile) {
  const evidence = [
    file.path,
    file.name,
    ...file.imports,
    ...file.exports,
    ...file.symbols,
    ...file.textHints,
    file.contentPreview ?? "",
  ].join("\n");

  return /(?:react-i18next|useTranslation|\bi18n\b|\bintl\b|locale|translation|labelKey|descriptionKey|titleKey|messageKey|\bt\s*\()/iu.test(
    evidence,
  );
}

function isLocalizationResourceFile(file: ProjectInventoryFile) {
  const evidence = `${file.path}\n${file.role}`;
  return /(?:^|[\/._-])(?:i18n|locale|locales|translation|translations|messages)(?:[\/._-]|$)/iu.test(
    evidence,
  );
}

function isExactLocalizedTextTask(
  taskIntent: TaskIntentAnalysis,
  targetFile: ProjectInventoryFile,
) {
  const understanding = taskIntent.taskUnderstanding;
  return (
    understanding.changeDefinition === "exact" &&
    understanding.explicitValues.some(
      (value) =>
        value.exact === true &&
        (value.kind === "text" || value.kind === "literal"),
    ) &&
    targetUsesLocalizationIndirection(targetFile)
  );
}

function isFastPathEligible(
  taskIntent: TaskIntentAnalysis,
  match: ScoredTargetMatch,
) {
  const understanding = taskIntent.taskUnderstanding;
  const actionEligible = ["replace", "remove", "update"].includes(
    understanding.action,
  );
  const exactValueAvailable =
    understanding.action === "remove" ||
    understanding.explicitValues.some((value) => value.exact === true);
  const targetRoleEligible = [
    "page",
    "layout",
    "component",
    "ui-component",
  ].includes(match.file.role);
  const textValueUsesLocalization = isExactLocalizedTextTask(
    taskIntent,
    match.file,
  );

  return (
    understanding.readiness === "ready" &&
    understanding.canProceed === true &&
    understanding.interpretationRisk === "objective" &&
    understanding.changeDefinition === "exact" &&
    actionEligible &&
    exactValueAvailable &&
    targetRoleEligible &&
    !textValueUsesLocalization &&
    taskIntent.structuredIntent.needsBackend !== true &&
    taskIntent.structuredIntent.needsStyles !== true &&
    taskIntent.structuredIntent.allowedEditScope !== "broad_but_safe"
  );
}

function asStructuredTarget(match: ScoredTargetMatch): StructuredIntentTarget {
  const kind: StructuredIntentTargetKind =
    match.file.role === "page"
      ? "page"
      : /component/u.test(match.file.role)
        ? "component"
        : match.file.routePath
          ? "route"
          : match.target.kind === "section"
            ? "entity"
            : match.target.kind;

  return {
    kind,
    value: match.target.value,
    path: match.file.path,
    routePath: match.file.routePath,
    name: match.file.name,
    confidence: 0.98,
    evidence: `Explicit named target matched real inventory: ${match.evidence.join(", ")}.`,
  };
}

function mergeIntentTarget(
  rawTask: string,
  taskIntent: TaskIntentAnalysis,
  match: ScoredTargetMatch,
): TaskIntentAnalysis {
  const pathKey = match.file.path.toLowerCase();
  const primaryTargets = [
    asStructuredTarget(match),
    ...taskIntent.structuredIntent.primaryTargets.filter(
      (target) => (target.path ?? "").toLowerCase() !== pathKey,
    ),
  ].slice(0, 8);

  const groundedUiTarget = [
    "page",
    "layout",
    "component",
    "ui-component",
  ].includes(match.file.role);
  const serverMutationProtected = taskProtectsServerMutation(
    rawTask,
    taskIntent,
  );
  const groundedBackendRequirement =
    taskIntent.structuredIntent.needsBackend === true &&
    !serverMutationProtected;

  return {
    ...taskIntent,
    taskArea:
      groundedUiTarget && !groundedBackendRequirement
        ? "ui"
        : taskIntent.taskArea,
    recommendedSearchTerms: [
      match.target.value,
      match.file.name,
      match.file.path,
      ...taskIntent.recommendedSearchTerms,
    ]
      .filter((value, index, values) => values.indexOf(value) === index)
      .slice(0, 16),
    structuredIntent: {
      ...taskIntent.structuredIntent,
      primaryTargets,
      needsBackend: serverMutationProtected
        ? false
        : taskIntent.structuredIntent.needsBackend,
      allowedEditScope:
        taskIntent.structuredIntent.allowedEditScope === "unknown" ||
        taskIntent.structuredIntent.allowedEditScope === "broad_but_safe"
          ? "target_with_supporting_context"
          : taskIntent.structuredIntent.allowedEditScope,
    },
    taskUnderstanding: {
      ...taskIntent.taskUnderstanding,
      targetHints: [
        match.target.value,
        match.file.path,
        ...taskIntent.taskUnderstanding.targetHints,
      ]
        .filter((value, index, values) => values.indexOf(value) === index)
        .slice(0, 12),
      reasons: [
        ...taskIntent.taskUnderstanding.reasons,
        `Explicit target guard grounded ${match.target.value} to ${match.file.path}.`,
      ].slice(0, 12),
    },
    notes: [
      ...taskIntent.notes,
      `Explicit target guard grounded ${match.target.value} to ${match.file.path}.`,
    ],
  };
}

function normalizeProjectPath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\.\//u, "").trim();
}

function moduleIdentity(value: string) {
  return normalizeProjectPath(value)
    .toLowerCase()
    .replace(/\.(?:d\.)?(?:tsx?|jsx?|mjs|cjs|css|scss|sass|less)$/u, "")
    .replace(/\/index$/u, "");
}

function resolvesImportToFile(
  target: ProjectInventoryFile,
  candidate: ProjectInventoryFile,
) {
  const candidateIdentity = moduleIdentity(candidate.path);
  const targetDirectory = path.posix.dirname(normalizeProjectPath(target.path));

  return target.imports.some((rawImport) => {
    const specifier = normalizeProjectPath(rawImport)
      .replace(/[?#].*$/u, "")
      .trim();
    if (!specifier) return false;

    if (specifier.startsWith(".")) {
      const resolved = path.posix.normalize(
        path.posix.join(targetDirectory, specifier),
      );
      return moduleIdentity(resolved) === candidateIdentity;
    }

    const specifierIdentity = moduleIdentity(specifier);
    return (
      specifierIdentity === candidateIdentity ||
      candidateIdentity.endsWith(`/${specifierIdentity}`)
    );
  });
}

function isBackendSupportFile(file: ProjectInventoryFile) {
  return [
    "api-route",
    "service",
    "repository",
    "db-schema",
    "server-entry",
  ].includes(file.role);
}

function sanitizeNotesAfterExplicitTargetGuard(notes: string[]) {
  return notes.filter((note) => {
    const normalized = note.trim();

    if (!normalized) return false;

    return !(
      /Selection was augmented with fallback-ranked files/iu.test(normalized) ||
      /Added because Ollama selected too few valid files/iu.test(normalized) ||
      /^Effective task area:/iu.test(normalized) ||
      /^Asset mode:/iu.test(normalized) ||
      /^Composer file limit for /iu.test(normalized) ||
      /^Fallback file selection was used\.?$/iu.test(normalized) ||
      /^Fallback selection is universal/iu.test(normalized) ||
      /^(?:Strong|Grounded review) fallback tokens:/iu.test(normalized) ||
      /^No (?:strong fallback|grounded review) tokens were extracted\.?$/iu.test(
        normalized,
      ) ||
      /^No missing explicit user paths detected\.?$/iu.test(normalized) ||
      /^(?:The user|This task|The task)\b[\s\S]*(?:I(?:'ve| have) selected|selected the core|selected files)/iu.test(
        normalized,
      )
    );
  });
}

function buildGuardedFile(
  match: ScoredTargetMatch,
  editRequested: boolean,
): SelectedTaskFile {
  const semanticRole =
    match.file.role === "page" ||
    match.file.role === "layout" ||
    /component/u.test(match.file.role)
      ? "display"
      : match.file.routePath || match.file.role === "api-route"
        ? "route"
        : "reference";
  const evidenceReason = `The user named this target and the project inventory grounded it to ${match.file.path} (${match.evidence.join(", ")}).`;
  const selectionEvidence: FileSelectionEvidence = {
    targetSource: "user_text",
    pathValidity: "inventory_exact",
    ownershipEvidence: "symbol_exact",
    actionConfidence: editRequested ? "confirmed_edit" : "inspect_only",
    semanticRoles: [semanticRole],
    symbols: [
      match.file.name.replace(/\.[^.]+$/u, ""),
      ...match.file.exports,
      ...match.file.symbols,
    ]
      .filter(
        (value, index, values) => value && values.indexOf(value) === index,
      )
      .slice(0, 10),
    chain: [],
    negativeConstraintConflicts: [],
    reason: evidenceReason,
  };
  return {
    path: match.file.path,
    kind: match.file.kind,
    usage: editRequested ? "inspect-and-edit" : "inspect-only",
    reason: `Explicit target guard matched the user-named ${match.target.kind} "${match.target.value}" to a real inventory file (${match.evidence.join(", ")}).`,
    confidence: 0.98,
    evidenceLevel: "user_confirmed",
    selectionEvidence,
  };
}

function isStateOrContractSupportFile(file: ProjectInventoryFile) {
  const normalizedPath = normalizeProjectPath(file.path).toLowerCase();
  return (
    [
      "hook",
      "store",
      "state",
      "controller",
      "client-api",
      "types",
      "type",
      "config",
    ].includes(file.role) ||
    /(?:^|\/)(?:hooks?|stores?|state|types?|config|i18n|locales?|translations?|messages)(?:\/|$)/u.test(
      normalizedPath,
    ) ||
    /(?:^|\/)api\/client\.[cm]?[jt]sx?$/u.test(normalizedPath)
  );
}

function isServerOrStorageFile(file: ProjectInventoryFile) {
  const normalizedPath = normalizeProjectPath(file.path).toLowerCase();
  return (
    isBackendSupportFile(file) ||
    ["repository", "db-schema", "storage"].includes(file.role) ||
    /(?:^|\/)(?:server|backend|database|db|storage|repositories)(?:\/|$)/u.test(
      normalizedPath,
    )
  );
}

function taskProtectsServerMutation(
  rawTask: string,
  taskIntent: TaskIntentAnalysis,
) {
  const text = [
    rawTask,
    ...taskIntent.structuredIntent.protectedScopes,
    ...taskIntent.taskUnderstanding.constraints,
  ].join(" ");
  const backendSurface = String.raw`(?:\b(?:backend|server|api|endpoint|route)\b|бэкенд|бекенд|сервер|апи|эндпоинт|маршрут)`;
  const protection = String.raw`(?:do\s+not|don't|dont|without|не\s+(?:добавляй|добавлять|создавай|создавать|меняй|менять|трогай|трогать|изменяй|изменять)|запрещ)`;
  const noNewSurface = String.raw`(?:(?:no|without)\s+(?:new|separate|additional)|без\s+(?:нов\p{L}*|отдельн\p{L}*|дополнительн\p{L}*))`;
  const creationNotNeeded = String.raw`(?:(?:create|add|introduce|register)(?:ing)?\s+(?:is\s+)?not\s+(?:needed|required)|(?:создавать|добавлять|регистрировать)\s+не\s+(?:нужно|требуется))`;

  return (
    new RegExp(`${backendSurface}[^.!?\\n]{0,100}${protection}`, "iu").test(
      text,
    ) ||
    new RegExp(`${protection}[^.!?\\n]{0,100}${backendSurface}`, "iu").test(
      text,
    ) ||
    new RegExp(`${noNewSurface}[^.!?\\n]{0,60}${backendSurface}`, "iu").test(
      text,
    ) ||
    new RegExp(
      `${backendSurface}[^.!?\\n]{0,100}${creationNotNeeded}`,
      "iu",
    ).test(text) ||
    new RegExp(
      `${creationNotNeeded}[^.!?\\n]{0,100}${backendSurface}`,
      "iu",
    ).test(text)
  );
}

const CONNECTED_SUPPORT_STOP_WORDS = new Set([
  "add",
  "after",
  "app",
  "application",
  "change",
  "display",
  "existing",
  "fix",
  "from",
  "into",
  "last",
  "page",
  "project",
  "show",
  "the",
  "this",
  "update",
  "use",
  "with",
  "добавь",
  "данные",
  "если",
  "из",
  "исправь",
  "кеш",
  "кэша",
  "на",
  "покажи",
  "после",
  "проекта",
  "странице",
  "существующие",
]);

function connectedSupportTokens(
  rawTask: string,
  taskIntent: TaskIntentAnalysis,
) {
  const text = [
    rawTask,
    taskIntent.taskUnderstanding.goal,
    ...taskIntent.taskUnderstanding.requestedChanges,
    ...taskIntent.taskUnderstanding.targetHints,
    ...taskIntent.domainTerms,
    ...taskIntent.mentionedEntities,
    ...taskIntent.recommendedSearchTerms,
  ].join(" ");
  return Array.from(
    new Set(
      text
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .toLowerCase()
        .split(/[^\p{L}\p{N}_-]+/u)
        .filter(
          (token) =>
            token.length >= 3 && !CONNECTED_SUPPORT_STOP_WORDS.has(token),
        ),
    ),
  ).slice(0, 40);
}

function connectedSupportSearchText(file: ProjectInventoryFile) {
  return [
    file.path,
    file.name,
    file.role,
    ...file.imports,
    ...file.exports,
    ...file.symbols,
    ...file.textHints,
    ...(file.semanticFacts?.declarations ?? []),
    ...(file.semanticFacts?.references ?? []),
    ...(file.semanticFacts?.assignments ?? []),
    ...(file.semanticFacts?.objectProperties ?? []),
    ...(file.semanticFacts?.typeFields ?? []),
    ...(file.semanticFacts?.stateSymbols ?? []),
    file.contentPreview ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

function supportTokenScore(file: ProjectInventoryFile, tokens: string[]) {
  const text = connectedSupportSearchText(file);
  return tokens.reduce(
    (score, token) => score + (text.includes(token) ? 1 : 0),
    0,
  );
}

function connectedSupportEvidence(
  file: ProjectInventoryFile,
  relatedPath: string,
  direction: "imports" | "imported-by",
): FileSelectionEvidence {
  const role =
    file.role === "hook" || file.role === "store"
      ? "state-owner"
      : file.role === "client-api"
        ? "route"
        : file.role === "types" ||
            /(?:^|\/)types?(?:\/|\.)/u.test(
              normalizeProjectPath(file.path).toLowerCase(),
            )
          ? "contract"
          : "reference";
  const symbol =
    file.exports[0] ?? file.symbols[0] ?? file.name.replace(/\.[^.]+$/u, "");
  return {
    targetSource: "ranking",
    pathValidity: "inventory_exact",
    ownershipEvidence: "reference_graph",
    actionConfidence: "inspect_only",
    semanticRoles: [role],
    symbols: [symbol],
    chain: [
      {
        symbol,
        role,
        path: file.path,
        relatedPath,
        evidence: "reference_graph",
        relation: "import_graph",
      },
    ],
    negativeConstraintConflicts: [],
    reason: `Connected ${direction} edge from ${relatedPath} grounds this file as ${role} context for the user-named target.`,
  };
}

function addConnectedInvestigationSupport(input: {
  rawTask: string;
  inventory: ProjectInventory;
  taskIntent: TaskIntentAnalysis;
  target: ProjectInventoryFile;
  selectedFiles: SelectedTaskFile[];
}) {
  const profile = classifyTaskSelectionProfile({
    rawTask: input.rawTask,
    taskIntent: input.taskIntent,
  });
  const requestsExistingFlowContext =
    /\b(?:existing|reuse|status api|api client|response data|rescan)\b|(?:существующ|используй[^.!?\n]{0,80}(?:api|апи|данн)|ответ\p{L}*\s+(?:api|апи|rescan)|провер\p{L}*\s+статус)/iu.test(
      input.rawTask,
    );
  const groundedUiTarget = [
    "page",
    "layout",
    "component",
    "ui-component",
  ].includes(input.target.role);
  if (
    profile.kind !== "state-behavior" &&
    profile.kind !== "api-contract" &&
    !(groundedUiTarget && requestsExistingFlowContext)
  ) {
    return input.selectedFiles;
  }

  const tokens = connectedSupportTokens(input.rawTask, input.taskIntent);
  const serverProtected = taskProtectsServerMutation(
    input.rawTask,
    input.taskIntent,
  );
  const languageFlow =
    /\b(?:language|locale|translation|i18n)\b|(?:язык|локализац|перевод)/iu.test(
      input.rawTask,
    );
  const selected = input.selectedFiles.slice();
  const seen = new Set(
    selected.map((file) => normalizeProjectPath(file.path).toLowerCase()),
  );
  const queue: Array<{ file: ProjectInventoryFile; depth: number }> = [
    { file: input.target, depth: 0 },
  ];
  const queued = new Set([
    normalizeProjectPath(input.target.path).toLowerCase(),
  ]);
  const maxFiles = Math.min(7, profile.maxPrimaryFiles);

  while (queue.length > 0 && selected.length < maxFiles) {
    const current = queue.shift()!;
    if (current.depth >= 3) continue;

    const neighbors: Array<{
      file: ProjectInventoryFile;
      direction: "imports" | "imported-by";
    }> = [];
    for (const candidate of input.inventory.files) {
      if (candidate.path === current.file.path) continue;
      if (resolvesImportToFile(current.file, candidate)) {
        neighbors.push({ file: candidate, direction: "imports" });
        continue;
      }
      if (resolvesImportToFile(candidate, current.file)) {
        neighbors.push({ file: candidate, direction: "imported-by" });
      }
    }

    const rankedNeighbors = neighbors
      .map((neighbor) => {
        const relevance = supportTokenScore(neighbor.file, tokens);
        const role = neighbor.file.role;
        const structuralPriority = [
          "hook",
          "store",
          "state",
          "controller",
        ].includes(role)
          ? 90
          : role === "client-api"
            ? 80
            : role === "types" ||
                /(?:^|\/)types?(?:\/|\.)/u.test(
                  normalizeProjectPath(neighbor.file.path).toLowerCase(),
                )
              ? 65
              : 0;
        const localizationPriority =
          current.depth === 0 &&
          languageFlow &&
          isLocalizationResourceFile(neighbor.file)
            ? 125
            : 0;
        const bridgePriority =
          neighbor.direction === "imported-by" &&
          ["page", "layout", "component", "ui-component"].includes(role)
            ? current.depth === 0
              ? 130
              : 70
            : 0;
        const directionPriority = neighbor.direction === "imports" ? 15 : 0;
        return {
          ...neighbor,
          relevance,
          priority:
            relevance * 24 +
            structuralPriority +
            localizationPriority +
            bridgePriority +
            directionPriority,
        };
      })
      .sort(
        (left, right) =>
          right.priority - left.priority ||
          left.file.path.localeCompare(right.file.path),
      );
    let addedFromCurrent = 0;
    for (const neighbor of rankedNeighbors) {
      const candidate = neighbor.file;
      const key = normalizeProjectPath(candidate.path).toLowerCase();
      if (
        seen.has(key) ||
        candidate.isLikelyGenerated ||
        !candidate.canReadText
      )
        continue;
      if (
        candidate.kind === "test" ||
        candidate.kind === "docs" ||
        candidate.kind === "style" ||
        candidate.kind === "asset"
      )
        continue;
      if (serverProtected && isServerOrStorageFile(candidate)) continue;

      const relevance = neighbor.relevance;
      const directContract =
        current.depth === 0 &&
        (candidate.role === "types" || /(?:^|\/)types?(?:\/|\.)/u.test(key));
      const directLocalization =
        current.depth === 0 &&
        languageFlow &&
        isLocalizationResourceFile(candidate);
      const flowSupport =
        isStateOrContractSupportFile(candidate) && relevance > 0;
      const directUiBridge =
        current.depth === 0 &&
        neighbor.direction === "imported-by" &&
        ["page", "layout", "component", "ui-component"].includes(
          candidate.role,
        );
      const relevantBridge =
        neighbor.direction === "imported-by" && relevance > 0;
      if (
        !directContract &&
        !directLocalization &&
        !flowSupport &&
        !relevantBridge &&
        !directUiBridge
      ) {
        continue;
      }

      const evidence = connectedSupportEvidence(
        candidate,
        current.file.path,
        neighbor.direction,
      );
      selected.push({
        path: candidate.path,
        kind: candidate.kind,
        usage: "inspect-only",
        reason: evidence.reason,
        confidence: directContract ? 0.82 : 0.78,
        evidenceLevel: "graph_supported",
        selectionEvidence: evidence,
      });
      seen.add(key);
      if (!queued.has(key)) {
        queued.add(key);
        queue.push({ file: candidate, depth: current.depth + 1 });
      }
      addedFromCurrent += 1;
      if (addedFromCurrent >= 2) break;
      if (selected.length >= maxFiles) break;
    }
  }

  return selected;
}

function selectedFileMatchesLayer(
  selected: SelectedTaskFile,
  inventoryFile: ProjectInventoryFile | undefined,
  layer: TaskExecutionLayer,
) {
  const pathValue = normalizeProjectPath(selected.path).toLowerCase();
  const role = inventoryFile?.role.toLowerCase() ?? "";
  if (layer === "ui")
    return (
      ["page", "layout", "component", "ui-component"].includes(role) ||
      /\.(?:tsx|jsx)$/u.test(pathValue)
    );
  if (layer === "client-api")
    return (
      role === "client-api" ||
      /(?:^|\/)api\/client\.[cm]?[jt]sx?$/u.test(pathValue)
    );
  if (layer === "backend")
    return (
      ["api-route", "service", "server-entry"].includes(role) ||
      /(?:^|\/)(?:server|backend)(?:\/|$)/u.test(pathValue)
    );
  if (layer === "state")
    return (
      ["hook", "store", "state", "controller"].includes(role) ||
      /(?:^|\/)(?:hooks?|stores?|state)(?:\/|$)|controller|reducer/u.test(
        pathValue,
      )
    );
  if (layer === "storage")
    return (
      ["repository", "db-schema", "storage"].includes(role) ||
      /(?:^|\/)(?:database|db|storage|repositories)(?:\/|$)/u.test(pathValue)
    );
  if (layer === "tests")
    return (
      inventoryFile?.kind === "test" ||
      /(?:test|spec|smoke|replay)\.[cm]?[jt]sx?$/u.test(pathValue)
    );
  if (layer === "config")
    return (
      inventoryFile?.kind === "config" ||
      /(?:^|\/)(?:package\.json|tsconfig[^/]*\.json|vite\.config\.[^/]+)$/u.test(
        pathValue,
      )
    );
  return (
    inventoryFile?.kind === "docs" ||
    /(?:^|\/)(?:readme|agents)\.md$/u.test(pathValue)
  );
}

function refreshGuardedExecutionContract(input: {
  rawTask: string;
  inventory: ProjectInventory;
  taskIntent: TaskIntentAnalysis;
  selection: TaskFileSelection;
}) {
  const base = buildTaskExecutionContractFromIntent({
    rawTask: input.rawTask,
    projectTree: input.inventory.files.map((file) => file.path),
    taskIntent: input.taskIntent,
    effectiveTaskArea: input.selection.effectiveTaskArea,
  });
  const inventoryByPath = new Map(
    input.inventory.files.map((file) => [
      normalizeProjectPath(file.path).toLowerCase(),
      file,
    ]),
  );
  const missingRequiredLayers = base.requiredLayers.filter(
    (layer) =>
      !input.selection.selectedFiles.some((selected) =>
        selectedFileMatchesLayer(
          selected,
          inventoryByPath.get(
            normalizeProjectPath(selected.path).toLowerCase(),
          ),
          layer,
        ),
      ),
  );
  const conditionalEvidenceFirst =
    /\b(?:use|reuse)\s+(?:only\s+)?(?:the\s+)?existing\b|\bif\s+(?:it|they|data)\s+(?:exists?|is\s+available|are\s+available)\b|(?:используй|использовать)[^.!?\n]{0,80}существующ|если[^.!?\n]{0,80}(?:есть|существ)/iu.test(
      input.rawTask,
    );
  const contract = applySelectionEvidenceGate({
    contract: base,
    rawTask: input.rawTask,
    selectedFiles: input.selection.selectedFiles,
    missingRequiredLayers,
    existingImplementationCandidates:
      input.selection.diagnostics?.existingImplementationCandidates ?? [],
    existingImplementationRequiresReview:
      Boolean(
        input.selection.diagnostics?.existingImplementationRequiresReview,
      ) || conditionalEvidenceFirst,
  });
  return { contract, missingRequiredLayers };
}

export function resolveExplicitTargetFastPath(input: {
  rawTask: string;
  taskType: string;
  inventory: ProjectInventory;
  taskIntent: TaskIntentAnalysis;
  settings: AppSettings;
}): ExplicitTargetFastPathResult {
  const { targets, explicitTargets, strongMatch } = resolveStrongExplicitTarget(
    input.rawTask,
    input.inventory,
    input.taskIntent,
  );

  if (explicitTargets.length === 0) {
    return {
      taskIntent: input.taskIntent,
      selection: null,
      status: "not-applicable",
      matchedPath: null,
      targetLabels: targets.map((target) => target.value),
      reason:
        "No explicit page, screen, component, route, or section target was named.",
    };
  }

  if (!strongMatch) {
    return {
      taskIntent: input.taskIntent,
      selection: null,
      status: "unresolved",
      matchedPath: null,
      targetLabels: explicitTargets.map((target) => target.value),
      reason:
        "The explicit target did not produce one unambiguous strong inventory match.",
    };
  }

  if (!isFastPathEligible(input.taskIntent, strongMatch)) {
    return {
      taskIntent: input.taskIntent,
      selection: null,
      status: "ineligible",
      matchedPath: strongMatch.file.path,
      targetLabels: explicitTargets.map((target) => target.value),
      reason:
        "The target matched, but the task still needs broader selector reasoning or supporting context.",
    };
  }

  const enrichedIntent = mergeIntentTarget(
    input.rawTask,
    input.taskIntent,
    strongMatch,
  );
  const guarded = buildGuardedFile(strongMatch, true);
  const note = `Explicit target fast path selected ${guarded.path} without an AI file-selection request.`;
  const effectiveTaskArea =
    enrichedIntent.taskArea === "general" ? "ui" : enrichedIntent.taskArea;
  const configuredModel =
    input.settings.aiProvider === "ollama"
      ? input.settings.defaultOllamaModel
      : input.settings.aiProvider === "openai-compatible"
        ? input.settings.openAiCompatibleModel
        : input.settings.aiProvider === "gemini"
          ? input.settings.geminiModel
          : input.settings.anthropicModel;

  return {
    taskIntent: enrichedIntent,
    selection: {
      selectedFiles: [guarded],
      rejectedModelPaths: [],
      source: "fast-path",
      usedFallback: false,
      durationMs: 0,
      notes: [note],
      effectiveTaskArea,
      assetMode: "none",
      diagnostics: {
        selectorVersion: "explicit-target-fast-path-v2",
        safetyProfile: "strict-explicit-target-v2",
        generationMode: input.settings.generationMode,
        model: configuredModel,
        requestedTaskType: input.taskType,
        effectiveTaskArea,
        usedFallback: false,
        selectionSource: "explicit-target-guard",
        finalConfidence: 0.98,
        explicitTargetStatus: "matched",
        explicitTargetPath: guarded.path,
        explicitTargetLabels: explicitTargets.map((target) => target.value),
        roleAdjustments: [note],
        semanticGraphEvidence: [
          `Explicit named target grounded to ${guarded.path}.`,
        ],
        parseStage: "direct-json",
        parseStages: [],
        repairAttempted: false,
        retryAttempted: false,
        schemaValid: true,
      },
    },
    status: "matched",
    matchedPath: guarded.path,
    targetLabels: explicitTargets.map((target) => target.value),
    reason: note,
  };
}

export function applyExplicitTargetGuard(input: {
  rawTask: string;
  inventory: ProjectInventory;
  taskIntent: TaskIntentAnalysis;
  selection: TaskFileSelection;
}): ExplicitTargetGuardResult {
  if (
    input.selection.diagnostics?.selectionSource === "final-decision" &&
    input.selection.diagnostics.executionContract
  ) {
    return {
      taskIntent: input.taskIntent,
      selection: input.selection,
      status: "not-applicable",
      matchedPath: null,
      targetLabels: [],
      notes: [
        "Canonical final selection already produced the execution contract; the legacy explicit target guard did not override it.",
      ],
    };
  }

  const { targets, explicitTargets, strongMatch } = resolveStrongExplicitTarget(
    input.rawTask,
    input.inventory,
    input.taskIntent,
  );

  if (explicitTargets.length === 0) {
    return {
      taskIntent: input.taskIntent,
      selection: input.selection,
      status: "not-applicable",
      matchedPath: null,
      targetLabels: targets.map((target) => target.value),
      notes: [],
    };
  }

  if (!strongMatch) {
    const note = `Explicit target guard could not ground the user-named target(s): ${explicitTargets
      .map((target) => target.value)
      .join(", ")}.`;
    return {
      taskIntent: input.taskIntent,
      selection: {
        ...input.selection,
        notes: [...input.selection.notes, note],
        diagnostics: input.selection.diagnostics
          ? {
              ...input.selection.diagnostics,
              explicitTargetStatus: "unresolved",
              explicitTargetLabels: explicitTargets.map(
                (target) => target.value,
              ),
            }
          : undefined,
      },
      status: "unresolved",
      matchedPath: null,
      targetLabels: explicitTargets.map((target) => target.value),
      notes: [note],
    };
  }

  const enrichedIntent = mergeIntentTarget(
    input.rawTask,
    input.taskIntent,
    strongMatch,
  );
  const editRequested = EDIT_ACTIONS.has(
    enrichedIntent.taskUnderstanding.action,
  );
  const guarded = buildGuardedFile(strongMatch, editRequested);
  const guardedPath = guarded.path.toLowerCase();
  const existing = input.selection.selectedFiles.find(
    (file) => file.path.toLowerCase() === guardedPath,
  );
  const styleRequested =
    enrichedIntent.structuredIntent.needsStyles === true ||
    /(?:\b(?:style|styles|css|layout|spacing|visual|design)\b|стил\p{L}*|отступ\p{L}*|дизайн\p{L}*|визуал\p{L}*)/iu.test(
      input.rawTask,
    );
  const backendRequested =
    !taskProtectsServerMutation(input.rawTask, enrichedIntent) &&
    (enrichedIntent.structuredIntent.needsBackend === true ||
      enrichedIntent.taskArea === "backend" ||
      enrichedIntent.taskArea === "fullstack");
  const inventoryByPath = new Map(
    input.inventory.files.map((file) => [
      normalizeProjectPath(file.path).toLowerCase(),
      file,
    ]),
  );
  const guardedInventoryFile = inventoryByPath.get(
    normalizeProjectPath(guarded.path).toLowerCase(),
  );
  const localizedTextTask = guardedInventoryFile
    ? isExactLocalizedTextTask(enrichedIntent, guardedInventoryFile)
    : false;
  const supportCandidates = input.selection.selectedFiles.filter(
    (file) => file.path.toLowerCase() !== guardedPath,
  );
  const remaining = supportCandidates
    .flatMap((file) => {
      const inventoryFile = inventoryByPath.get(
        normalizeProjectPath(file.path).toLowerCase(),
      );
      if (!inventoryFile) return [];

      if (backendRequested && isBackendSupportFile(inventoryFile)) {
        return [file];
      }

      if (localizedTextTask && isLocalizationResourceFile(inventoryFile)) {
        return [
          {
            ...file,
            confidence: Math.min(file.confidence, 0.72),
            reason: `Localization resource candidate retained for explicit target ${guarded.path}; visible text is resolved through localization indirection. Candidate rank only; needs confirmation.`,
          },
        ];
      }

      if (
        !guardedInventoryFile ||
        !resolvesImportToFile(guardedInventoryFile, inventoryFile)
      ) {
        return [];
      }

      const directStyleDependency =
        styleRequested && inventoryFile.kind === "style";
      return [
        {
          ...file,
          usage: directStyleDependency ? file.usage : "inspect-only",
          reason: directStyleDependency
            ? `Direct style dependency imported by explicit target ${guarded.path}; retained as grounded styling context.`
            : `Direct dependency imported by explicit target ${guarded.path}; retained as inspect-only supporting context.`,
          confidence: Math.min(file.confidence, 0.84),
        },
      ];
    })
    .slice(0, 5);
  const droppedSupportCount = Math.max(
    0,
    supportCandidates.length - remaining.length,
  );
  const note = `Explicit target guard promoted ${guarded.path} as the primary ${guarded.usage} target.`;
  const supportNote =
    droppedSupportCount > 0
      ? `Explicit target guard discarded ${droppedSupportCount} supporting candidate(s) that were not directly grounded to ${guarded.path}.`
      : "";
  const effectiveTaskArea =
    enrichedIntent.taskArea === "ui" ? "ui" : input.selection.effectiveTaskArea;
  const finalNotes = [
    ...sanitizeNotesAfterExplicitTargetGuard(input.selection.notes),
    note,
    supportNote,
  ].filter(Boolean);

  const guardedSelectedFiles = [
    existing
      ? {
          ...existing,
          ...guarded,
        }
      : guarded,
    ...remaining,
  ];
  const connectedSelectedFiles = guardedInventoryFile
    ? addConnectedInvestigationSupport({
        rawTask: input.rawTask,
        inventory: input.inventory,
        taskIntent: enrichedIntent,
        target: guardedInventoryFile,
        selectedFiles: guardedSelectedFiles,
      })
    : guardedSelectedFiles;
  const guardedSelection: TaskFileSelection = {
    ...input.selection,
    selectedFiles: connectedSelectedFiles,
    notes: finalNotes,
    effectiveTaskArea,
    diagnostics: input.selection.diagnostics
      ? {
          ...input.selection.diagnostics,
          effectiveTaskArea,
          selectionSource: "explicit-target-guard",
          explicitTargetStatus: "matched",
          explicitTargetPath: guarded.path,
          explicitTargetLabels: explicitTargets.map((target) => target.value),
          roleAdjustments: [
            ...(input.selection.diagnostics.roleAdjustments ?? []),
            note,
            supportNote,
          ].filter(Boolean),
        }
      : undefined,
  };
  const refreshed = refreshGuardedExecutionContract({
    rawTask: input.rawTask,
    inventory: input.inventory,
    taskIntent: enrichedIntent,
    selection: guardedSelection,
  });
  const deterministicGuardImplementation =
    refreshed.contract.mode === "implementation" &&
    enrichedIntent.taskUnderstanding.canProceed &&
    enrichedIntent.taskUnderstanding.changeDefinition !== "open_ended" &&
    refreshed.missingRequiredLayers.length === 0 &&
    guarded.selectionEvidence?.actionConfidence === "confirmed_edit";
  const finalSelection: TaskFileSelection = {
    ...guardedSelection,
    source: deterministicGuardImplementation
      ? "deterministic"
      : guardedSelection.source,
    usedFallback: deterministicGuardImplementation
      ? false
      : guardedSelection.usedFallback,
    selectedFiles:
      refreshed.contract.mode === "implementation"
        ? guardedSelection.selectedFiles
        : guardedSelection.selectedFiles.map((file) => ({
            ...file,
            usage:
              file.usage === "inspect-and-edit" ||
              file.usage === "create-and-edit"
                ? ("inspect-only" as const)
                : file.usage,
          })),
    diagnostics: guardedSelection.diagnostics
      ? {
          ...guardedSelection.diagnostics,
          usedFallback: deterministicGuardImplementation
            ? false
            : guardedSelection.diagnostics.usedFallback,
          executionMode: refreshed.contract.mode,
          requiredLayers: refreshed.contract.requiredLayers,
          missingRequiredLayers: refreshed.missingRequiredLayers,
          candidateLayerCoverage: refreshed.contract.candidateLayerCoverage,
          confirmedLayerCoverage: refreshed.contract.confirmedLayerCoverage,
          missingConfirmedLayers: refreshed.contract.missingConfirmedLayers,
          implementationGateReasons:
            refreshed.contract.implementationGateReasons,
          executionContract: refreshed.contract,
        }
      : undefined,
  };

  return {
    taskIntent: enrichedIntent,
    selection: finalSelection,
    status: "matched",
    matchedPath: guarded.path,
    targetLabels: explicitTargets.map((target) => target.value),
    notes: [note, supportNote].filter(Boolean),
  };
}
