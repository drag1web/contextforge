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
  /(?:page|screen|component|route|section|view)\s+(?:named\s+)?[«"“'`]?(.{2,80}?)(?=\s+(?:replace|change|update|edit|modify|improve|make|add|remove|fix|under|below|where|that|which)|[\n,.!?;]|$)/giu;
const RUSSIAN_FORWARD_TARGET_PATTERN =
  /(?:на\s+)?(страниц\p{L}*|экран\p{L}*|компонент\p{L}*|маршрут\p{L}*|секци\p{L}*|раздел\p{L}*)\s+(?:с\s+названием\s+)?[«"“'`]?(.{2,80}?)(?=\s+(?:замени|заменить|измени|изменить|обнови|обновить|сделай|добавь|добавить|удали|удалить|убери|убрать|исправь|исправить|под|где|которая|который|которое)|[\n,.!?;]|$)/giu;
const REVERSE_TARGET_PATTERN =
  /[«"“'`]?([A-ZА-ЯЁ][\p{L}\p{N}_.-]{1,80})[»"”'`]?\s+(page|screen|component|route|view)\b/giu;
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

export function extractExplicitNamedTargets(rawTask: string) {
  const targets: ExplicitNamedTarget[] = [];

  ENGLISH_FORWARD_TARGET_PATTERN.lastIndex = 0;
  for (const match of rawTask.matchAll(ENGLISH_FORWARD_TARGET_PATTERN)) {
    const type = normalizeWhitespace(match[0]).split(/\s+/u)[0] ?? "page";
    const value = normalizeWhitespace(match[1] ?? "")
      .replace(/^[«"“'`]|[»"”'`]$/gu, "")
      .trim();
    if (!value) continue;
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
    if (!value) continue;
    targets.push({
      kind: mapTargetKind(type),
      value,
      evidence: normalizeWhitespace(match[0]),
      priority: 100,
    });
  }

  REVERSE_TARGET_PATTERN.lastIndex = 0;
  for (const match of rawTask.matchAll(REVERSE_TARGET_PATTERN)) {
    const value = normalizeWhitespace(match[1] ?? "");
    if (!value) continue;
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
    if (!value) continue;
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
  const explicitTargets = extractExplicitNamedTargets(rawTask);
  const best = matches[0];
  const second = matches[1];
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

  return {
    ...taskIntent,
    taskArea:
      taskIntent.taskArea === "general" &&
      ["page", "layout", "component", "ui-component"].includes(match.file.role)
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
  return {
    path: match.file.path,
    kind: match.file.kind,
    usage: editRequested ? "inspect-and-edit" : "inspect-only",
    reason: `Explicit target guard matched the user-named ${match.target.kind} "${match.target.value}" to a real inventory file (${match.evidence.join(", ")}).`,
    confidence: 0.98,
  };
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

  const enrichedIntent = mergeIntentTarget(input.taskIntent, strongMatch);
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

  const enrichedIntent = mergeIntentTarget(input.taskIntent, strongMatch);
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
    enrichedIntent.structuredIntent.needsBackend === true ||
    enrichedIntent.taskArea === "backend" ||
    enrichedIntent.taskArea === "fullstack";
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
            reason:
              `Localization resource candidate retained for explicit target ${guarded.path}; visible text is resolved through localization indirection. Candidate rank only; needs confirmation.`,
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
    input.selection.effectiveTaskArea === "general" &&
    enrichedIntent.taskArea === "ui"
      ? "ui"
      : input.selection.effectiveTaskArea;
  const finalNotes = [
    ...sanitizeNotesAfterExplicitTargetGuard(input.selection.notes),
    note,
    supportNote,
  ].filter(Boolean);

  return {
    taskIntent: enrichedIntent,
    selection: {
      ...input.selection,
      selectedFiles: [
        existing
          ? {
              ...existing,
              ...guarded,
            }
          : guarded,
        ...remaining,
      ],
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
    },
    status: "matched",
    matchedPath: guarded.path,
    targetLabels: explicitTargets.map((target) => target.value),
    notes: [note, supportNote].filter(Boolean),
  };
}
