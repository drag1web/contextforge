import type { InvestigationTrace } from "../investigation/investigationTraceEngine.js";
import {
  buildInvestigationRelationshipIndex,
  canonicalInvestigationSymbol,
  normalizeInvestigationPath,
  type InvestigationFileFacts,
} from "../investigation/typescriptRelationshipAdapter.js";
import type {
  SelectedTaskFile,
  SelectedTaskFileUsage,
} from "../ollama/taskFileSelector.js";
import type { TaskIntentAnalysis } from "../ollama/taskIntentAnalyzer.js";
import type {
  ProjectInventory,
  ProjectInventoryFile,
} from "../scanner/projectInventoryScanner.js";
import type {
  TaskExecutionContract,
  TaskExecutionLayer,
} from "../taskPacks/taskExecutionContract.js";
import type {
  FileSelectionEvidence,
  SemanticEvidenceLink,
} from "./repositorySemanticIndex.js";
import {
  classifyTaskSelectionProfile,
  type TaskSelectionProfile,
} from "./taskSelectionProfile.js";
import {
  extractClassifiedFileMentions,
  resolveExplicitFileMentions,
} from "./explicitFileMentions.js";
import { extractSymbolRenameIntent } from "./symbolRename.js";
import { resolveGroundedSupportingContext } from "./supportingContextGrounding.js";

export interface FinalSelectionDecision {
  selectedFiles: SelectedTaskFile[];
  profile: TaskSelectionProfile;
  deterministicImplementationReady: boolean;
  forceInvestigation?: boolean;
  canonicalSelectionApplied?: boolean;
  requiredLayersOverride?: TaskExecutionLayer[];
  notes: string[];
}

function normalizePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\.\//u, "").toLowerCase();
}

function normalizeLiteral(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
}

function normalizeIdentifier(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_./:-]+/g, " ")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function canonicalIdentifier(value: string) {
  return normalizeIdentifier(value).replace(/\s+/g, "");
}

function uniqueStrings(values: string[], limit = values.length) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = String(raw ?? "").trim();
    const key = value.toLocaleLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= limit) break;
  }
  return result;
}

function isUiFile(file: ProjectInventoryFile) {
  const path = normalizePath(file.path);
  return (
    ["page", "layout", "component", "ui-component"].includes(file.role) ||
    /(?:^|\/)(?:renderer|frontend|client)(?:\/|$)/u.test(path) ||
    /\.(?:tsx|jsx|vue|svelte)$/u.test(path)
  );
}

function fileMatchesRequiredLayer(
  file: ProjectInventoryFile,
  layer: TaskExecutionLayer,
) {
  const path = normalizePath(file.path);
  const role = file.role.toLocaleLowerCase();
  if (layer === "ui") {
    return isUiFile(file) && !/(?:\/api\/|client\.[cm]?[jt]sx?$)/u.test(path);
  }
  if (layer === "client-api") {
    return (
      role === "client-api" ||
      /(?:\/api\/|api\/client|client\.[cm]?[jt]sx?$)/u.test(path)
    );
  }
  if (layer === "backend") {
    return (
      /(?:^|\/)(?:server|backend)(?:\/|$)/u.test(path) ||
      ["api-route", "server-entry", "service"].includes(role)
    );
  }
  if (layer === "state") {
    return (
      ["store", "hook"].includes(role) ||
      /(?:\/hooks?\/|\/stores?\/|\/state\/|controller|reducer|cache|session)/u.test(
        path,
      )
    );
  }
  if (layer === "storage") {
    return (
      role === "repository" ||
      /(?:\/storage\/|\/db\/|\/database\/|\/repositories?\/|schema|migration)/u.test(
        path,
      )
    );
  }
  if (layer === "tests")
    return (
      file.kind === "test" || /(?:test|spec|smoke|replay|fixture)/u.test(path)
    );
  if (layer === "config")
    return (
      file.kind === "config" ||
      /(?:package\.json|tsconfig|vite|config)/u.test(path)
    );
  if (layer === "docs")
    return file.kind === "docs" || /(?:\.md$|\/docs\/|readme)/u.test(path);
  return false;
}

function isLocalizationResource(file: ProjectInventoryFile) {
  const path = normalizePath(file.path);
  const role = file.role.toLocaleLowerCase();
  return (
    /(?:^|\/)(?:i18n|locales?|translations?|messages)(?:\/|$)|(?:^|[._-])(?:i18n|locale|translation|messages)[._-]/u.test(
      path,
    ) || /(?:i18n|locale|translation|messages)/u.test(role)
  );
}

function taskAllowsFileKind(
  profile: TaskSelectionProfile,
  file: ProjectInventoryFile,
  taskIntent?: TaskIntentAnalysis,
) {
  const path = normalizePath(file.path);
  const asksForTests = profile.kind === "tests" || profile.needsTestContext;
  const asksForDocs = profile.kind === "docs";
  const asksForConfig = profile.kind === "config" || profile.needsConfigContext;
  const asksForVisual =
    profile.kind === "visual-ui" ||
    taskIntent?.structuredIntent.needsStyles === true;

  const explicitlyRemovedBackup =
    taskIntent?.taskUnderstanding.action === "remove" &&
    taskIntent.taskUnderstanding.targetHints.some((hint) => {
      const normalizedHint = normalizePath(hint);
      const basename = path.split("/").pop() ?? path;
      return (
        normalizedHint === path ||
        normalizedHint.endsWith(`/${path}`) ||
        normalizedHint === basename
      );
    });
  if (
    /\.backup(?:\.|$)|backup\.(?:txt|tsx?|jsx?)$/u.test(path) &&
    !explicitlyRemovedBackup
  )
    return false;
  if (file.kind === "asset") return false;
  if (
    (file.kind === "test" ||
      /(?:\.test\.|\.spec\.|\.smoke\.|\.replay\.|\/__tests__\/)/u.test(path)) &&
    !asksForTests
  )
    return false;
  if (
    (file.kind === "docs" || /(?:\.md$|\/docs?\/|readme)/u.test(path)) &&
    !asksForDocs
  )
    return false;
  if (
    (file.kind === "style" || /\.(?:css|scss|sass|less)$/u.test(path)) &&
    !asksForVisual
  )
    return false;
  if (
    (file.kind === "config" ||
      /package\.json$|tsconfig|vite\.config|webpack/u.test(path)) &&
    !asksForConfig &&
    !asksForTests &&
    !(profile.kind === "exact-text" && isLocalizationResource(file))
  )
    return false;
  return !file.isLikelyGenerated;
}

function isConditionalRemovalTask(
  rawTask: string,
  taskIntent?: TaskIntentAnalysis,
) {
  const removes =
    taskIntent?.taskUnderstanding.action === "remove" ||
    /\b(?:delete|remove)\b|(?:удал|убер)/iu.test(rawTask);
  const conditional =
    /\b(?:if|only\s+if)\b[^.!?\n]{0,100}\b(?:unused|not\s+used|no\s+longer\s+used|unreferenced)\b/iu.test(
      rawTask,
    ) ||
    /(?:если|только\s+если)[^.!?\n]{0,100}(?:не\s+использ|не\s+нуж|нет\s+ссылок|не\s+подключ)/iu.test(
      rawTask,
    );
  return removes && conditional;
}

function resolveConditionalRemovalSelection(input: {
  rawTask: string;
  taskIntent?: TaskIntentAnalysis;
  selectedFiles: SelectedTaskFile[];
  profile: TaskSelectionProfile;
  maxFiles: number;
}): FinalSelectionDecision | null {
  if (!isConditionalRemovalTask(input.rawTask, input.taskIntent)) return null;
  const targetHints = (
    input.taskIntent?.taskUnderstanding.targetHints ?? []
  ).map(normalizePath);
  const target = input.selectedFiles.find((file) => {
    const filePath = normalizePath(file.path);
    const basename = filePath.split("/").pop() ?? filePath;
    return targetHints.some(
      (hint) =>
        hint === filePath || hint.endsWith(`/${filePath}`) || hint === basename,
    );
  });
  if (!target) return null;

  const implementationReady =
    target.selectionEvidence?.targetSource === "user_text" &&
    target.selectionEvidence.pathValidity === "inventory_exact" &&
    target.selectionEvidence.ownershipEvidence === "reference_graph" &&
    target.selectionEvidence.actionConfidence === "confirmed_edit" &&
    target.selectionEvidence.negativeConstraintConflicts.length === 0;
  const selected: SelectedTaskFile[] = [
    {
      ...target,
      usage: (implementationReady
        ? "inspect-and-edit"
        : "inspect-only") as SelectedTaskFileUsage,
    },
    ...input.selectedFiles
      .filter((file) => normalizePath(file.path) !== normalizePath(target.path))
      .map((file) => ({
        ...file,
        usage: "inspect-only" as const,
      })),
  ].slice(0, Math.max(1, input.maxFiles));

  return {
    selectedFiles: selected,
    profile: input.profile,
    deterministicImplementationReady: implementationReady,
    canonicalSelectionApplied: true,
    notes: [
      implementationReady
        ? `Conditional removal was authorized only for ${target.path} after complete inventory reference analysis proved the predicate.`
        : `Conditional removal remains investigation-only for ${target.path}; no deletion is authorized until the unused predicate is proven.`,
      "All user-protected or referencing files remain inspect-only.",
    ],
  };
}

function taskIdentityTokens(rawTask: string, taskIntent?: TaskIntentAnalysis) {
  const stopWords = new Set([
    "add",
    "change",
    "replace",
    "update",
    "remove",
    "fix",
    "text",
    "label",
    "copy",
    "state",
    "empty",
    "добавь",
    "замени",
    "измени",
    "обнови",
    "удали",
    "исправь",
    "текст",
    "подпись",
    "пустого",
    "состояния",
    "разделе",
    "раздел",
    "странице",
    "страница",
    "компоненте",
    "компонент",
    "на",
    "в",
    "из",
    "для",
    "the",
  ]);
  const source = [
    rawTask,
    ...(taskIntent?.taskUnderstanding.targetHints ?? []),
    ...(taskIntent?.mentionedEntities ?? []),
    ...(taskIntent?.recommendedSearchTerms ?? []),
    ...(taskIntent?.structuredIntent.primaryTargets ?? []).flatMap((target) => [
      target.value,
      target.name ?? "",
      target.path ?? "",
    ]),
  ].join(" ");
  return uniqueStrings(
    normalizeIdentifier(source)
      .split(/\s+/u)
      .filter((token) => token.length >= 3 && !stopWords.has(token)),
    32,
  );
}

function fileIdentityScore(file: ProjectInventoryFile, tokens: string[]) {
  const identity = normalizeIdentifier(
    [
      file.path,
      file.name,
      file.role,
      ...(file.exports ?? []),
      ...(file.symbols ?? []),
      ...(file.textHints ?? []),
    ].join(" "),
  );
  let score = 0;
  for (const token of tokens) {
    if (identity.split(/\s+/u).includes(token)) score += 20;
    else if (token.length >= 5 && identity.includes(token)) score += 8;
  }
  return score;
}

function behavioralOwnerScore(file: ProjectInventoryFile, rawTask: string) {
  const task = normalizeIdentifier(rawTask);
  const identity = normalizeIdentifier(
    [
      file.path,
      file.name,
      file.role,
      ...(file.exports ?? []),
      ...(file.symbols ?? []),
      ...(file.semanticFacts?.declarations ?? []),
    ].join(" "),
  );
  let score = 0;
  const concepts: Array<[RegExp, RegExp, number]> = [
    [/(?:\bexport|download|archive\b|экспорт|скач|архив)/iu, /(?:export|download|archive)/u, 120],
    [/(?:\bfile(?:name)?|prefix|suffix|name\b|имя|названи|префикс|суффикс)/iu, /(?:filename|file name|namepart|sanitizefilename|prefix|suffix)/u, 120],
    [/(?:\btask\s*packs?\b|таск\s*пак)/iu, /task pack/u, 90],
    [/(?:\bvalidation\b|валидац)/iu, /validation/u, 90],
    [/(?:\breports?\b|отч[её]т)/iu, /report/u, 90],
    [/(?:\bsettings?\b|настройк)/iu, /setting/u, 90],
    [/(?:\bsearch\b|поиск)/iu, /search/u, 90],
    [/(?:\bshortcut|hotkey|keyboard\b|горяч\w*\s+клавиш)/iu, /shortcut|hotkey|keyboard/u, 110],
    [/(?:\bbackup\b|резервн)/iu, /backup/u, 90],
  ];
  for (const [taskPattern, identityPattern, weight] of concepts) {
    if (taskPattern.test(task) && identityPattern.test(identity)) score += weight;
  }
  const asksTaskPack = /(?:\btask\s*packs?\b|таск\s*пак)/iu.test(task);
  const asksFileName = /(?:\bfile(?:name)?|prefix|suffix|name\b|имя|названи|префикс|суффикс)/iu.test(task);
  const asksExport = /(?:\bexport|download|archive\b|экспорт|скач|архив)/iu.test(task);
  if (
    asksTaskPack &&
    asksFileName &&
    asksExport &&
    /task pack/u.test(identity) &&
    /(?:export|download)/u.test(identity) &&
    /(?:filename|file name|namepart)/u.test(identity)
  ) {
    score += 320;
    if (/(?:task pack export|export task pack)/u.test(identity)) score += 260;
  }
  return score;
}

function translationNamespaceScore(keys: string[], taskTokens: string[]) {
  const taskTokenSet = new Set(
    taskTokens.map((token) => token.toLocaleLowerCase()),
  );
  let score = 0;
  for (const key of keys) {
    const parts = key.split(".");
    const namespace = parts.slice(0, -1).join(" ");
    for (const token of normalizeIdentifier(namespace).split(/\s+/u)) {
      if (token.length >= 3 && taskTokenSet.has(token)) score += 140;
    }
  }
  return score;
}

function exactTextEvidence(input: {
  owner: ProjectInventoryFile;
  consumer?: ProjectInventoryFile;
  keys: string[];
  literals: string[];
}): FileSelectionEvidence {
  const chain: SemanticEvidenceLink[] = input.keys.slice(0, 8).map((key) => ({
    symbol: key,
    role: "producer",
    path: input.owner.path,
    relatedPath: input.consumer?.path,
    evidence: "symbol_exact",
    relation: "translation_key",
  }));
  return {
    targetSource: "ranking",
    pathValidity: "inventory_exact",
    ownershipEvidence: "symbol_exact",
    actionConfidence: "inspect_then_edit",
    semanticRoles: ["producer"],
    symbols: uniqueStrings([...input.keys, ...input.literals], 12),
    chain,
    negativeConstraintConflicts: [],
    reason: input.consumer
      ? `Exact user-visible literal matched a translation entry, and ${input.consumer.path} consumes the related translation key.`
      : "Exact user-visible literal matched a translation resource entry in the real project inventory.",
  };
}

function exactTextConsumerEvidence(input: {
  consumer: ProjectInventoryFile;
  owner: ProjectInventoryFile;
  keys: string[];
}): FileSelectionEvidence {
  return {
    targetSource: "ranking",
    pathValidity: "inventory_exact",
    ownershipEvidence: "reference_graph",
    actionConfidence: "inspect_only",
    semanticRoles: ["display", "consumer"],
    symbols: input.keys.slice(0, 12),
    chain: input.keys.slice(0, 8).map((key) => ({
      symbol: key,
      role: "display",
      path: input.consumer.path,
      relatedPath: input.owner.path,
      evidence: "reference_graph",
      relation: "translation_key",
    })),
    negativeConstraintConflicts: [],
    reason: `UI consumer uses the translation key owned by ${input.owner.path}.`,
  };
}

function exactTextScopeConsumerEvidence(input: {
  consumer: ProjectInventoryFile;
  owner: ProjectInventoryFile;
  literals: string[];
}): FileSelectionEvidence {
  return {
    targetSource: "user_text",
    pathValidity: "inventory_exact",
    ownershipEvidence: "content_supported",
    actionConfidence: "inspect_only",
    semanticRoles: ["display", "consumer"],
    symbols: input.literals.slice(0, 12),
    chain: input.literals.slice(0, 8).map((literal) => ({
      symbol: literal,
      role: "display",
      path: input.consumer.path,
      relatedPath: input.owner.path,
      evidence: "content_supported",
      relation: "same_file",
    })),
    negativeConstraintConflicts: [],
    reason: `User-named UI scope is retained for inspection while the exact literal owner is ${input.owner.path}.`,
  };
}

function directLiteralEvidence(
  file: ProjectInventoryFile,
  literals: string[],
): FileSelectionEvidence {
  return {
    targetSource: "ranking",
    pathValidity: "inventory_exact",
    ownershipEvidence: "symbol_exact",
    actionConfidence: "inspect_then_edit",
    semanticRoles: isLocalizationResource(file)
      ? ["contract", "producer"]
      : isUiFile(file)
        ? ["display", "producer"]
        : ["producer"],
    symbols: literals.slice(0, 12),
    chain: literals.slice(0, 8).map((literal) => ({
      symbol: literal,
      role: "producer",
      path: file.path,
      evidence: "symbol_exact",
      relation: "same_file",
    })),
    negativeConstraintConflicts: [],
    reason:
      "Exact user-provided literal appears directly in this real source file.",
  };
}

function resolveExactTextSelection(input: {
  rawTask: string;
  taskIntent?: TaskIntentAnalysis;
  inventory: ProjectInventory;
  selectedFiles: SelectedTaskFile[];
  trace?: InvestigationTrace;
  profile: TaskSelectionProfile;
  maxFiles: number;
}): FinalSelectionDecision | null {
  const orderedLiterals = uniqueStrings(
    input.profile.exactLiterals
      .map(normalizeLiteral)
      .filter((value) => value.length >= 2),
    12,
  );
  const literalSet = new Set(orderedLiterals);
  if (literalSet.size === 0) return null;
  const sourceLiteral = orderedLiterals[0] ?? "";

  const selectedPaths = new Set(
    input.selectedFiles.map((file) => normalizePath(file.path)),
  );
  const traceReferencePaths = new Set(
    (input.trace?.outcome.references ?? []).map(normalizePath),
  );
  const tokens = taskIdentityTokens(input.rawTask, input.taskIntent);
  const rawTaskTokens = taskIdentityTokens(input.rawTask);
  const explicitIntentPaths = new Set(
    (input.taskIntent?.structuredIntent.primaryTargets ?? [])
      .map((target) => normalizePath(target.path ?? ""))
      .filter(Boolean),
  );

  // Prefer a unique literal owner in source code before falling back to a
  // localization resource. This keeps tasks such as changing an export
  // filename prefix or a hard-coded metric label grounded in the file that
  // actually produces the value, while translated UI copy still resolves to
  // its translation resource because the consumer does not contain the
  // literal itself.
  const directSourceMatches = input.inventory.files
    .filter(
      (file) =>
        file.canReadText &&
        !isLocalizationResource(file) &&
        taskAllowsFileKind(input.profile, file, input.taskIntent),
    )
    .map((file) => {
      const text = normalizeLiteral(
        [
          file.contentPreview ?? "",
          ...(file.textHints ?? []),
          ...(file.semanticFacts?.stringLiterals ?? []),
        ].join(" "),
      );
      const allLiterals = [...literalSet].filter((literal) =>
        text.includes(literal),
      );
      const containsSource = sourceLiteral
        ? allLiterals.includes(sourceLiteral)
        : false;
      const literals = sourceLiteral
        ? containsSource
          ? [sourceLiteral]
          : []
        : allLiterals;
      let score =
        literals.length * 100 +
        fileIdentityScore(file, tokens) +
        fileIdentityScore(file, rawTaskTokens) * 3 +
        behavioralOwnerScore(file, input.rawTask);
      if (containsSource) score += 180;
      if (isUiFile(file)) score += 35;
      if (selectedPaths.has(normalizePath(file.path))) score += 15;
      if (explicitIntentPaths.has(normalizePath(file.path))) score += 260;
      return { file, literals, score };
    })
    .filter((item) => item.literals.length > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.file.path.localeCompare(right.file.path),
    );

  if (directSourceMatches.length > 0) {
    const owner = directSourceMatches[0]!;
    const second = directSourceMatches[1];
    if (!second || owner.score - second.score >= 35) {
      const evidence = directLiteralEvidence(owner.file, owner.literals);
      return {
        selectedFiles: [
          {
            path: owner.file.path,
            kind: owner.file.kind,
            usage: "inspect-and-edit",
            reason: evidence.reason,
            confidence: 0.92,
            evidenceLevel: "graph_supported",
            selectionEvidence: evidence,
          },
        ],
        profile: input.profile,
        deterministicImplementationReady: true,
        canonicalSelectionApplied: true,
        notes: [
          `Final selection was rebuilt from a unique exact literal owner: ${owner.file.path}.`,
        ],
      };
    }
  }

  const resourceCandidates = input.inventory.files
    .filter(
      (file) =>
        isLocalizationResource(file) &&
        taskAllowsFileKind(input.profile, file, input.taskIntent),
    )
    .map((file) => {
      const allEntries = (file.semanticFacts?.translationEntries ?? []).filter(
        (entry) => literalSet.has(normalizeLiteral(entry.value)),
      );
      const sourceEntries = allEntries.filter(
        (entry) => normalizeLiteral(entry.value) === sourceLiteral,
      );
      return { file, allEntries, sourceEntries };
    })
    .filter((item) => item.allEntries.length > 0);
  const hasSourceResource = resourceCandidates.some(
    (item) => item.sourceEntries.length > 0,
  );
  const resourceMatches = resourceCandidates
    .map((item) => {
      const entries = hasSourceResource ? item.sourceEntries : item.allEntries;
      const score =
        fileIdentityScore(item.file, tokens) +
        (selectedPaths.has(normalizePath(item.file.path)) ? 15 : 0) +
        entries.length * 80;
      return { file: item.file, entries, score };
    })
    .filter((item) => item.entries.length > 0)
    .sort((left, right) => right.score - left.score);

  if (resourceMatches.length > 0) {
    const owner = resourceMatches[0]!.file;
    const keys = uniqueStrings(
      resourceMatches[0]!.entries.map((entry) => entry.key),
      12,
    );
    const canonicalKeys = new Set(keys.map(canonicalIdentifier));
    const consumers = input.inventory.files
      .filter(
        (file) =>
          file.path !== owner.path &&
          isUiFile(file) &&
          taskAllowsFileKind(input.profile, file, input.taskIntent),
      )
      .map((file) => {
        const matchedKeys = (file.semanticFacts?.translationKeys ?? []).filter(
          (key) => {
            const canonical = canonicalIdentifier(key);
            return [...canonicalKeys].some(
              (ownerKey) =>
                canonical === ownerKey ||
                canonical.endsWith(ownerKey) ||
                ownerKey.endsWith(canonical),
            );
          },
        );
        let score = fileIdentityScore(file, tokens);
        score += translationNamespaceScore(matchedKeys, tokens);
        // Initial shortlist membership is weak evidence. It may be the very
        // mistake this final decision is meant to correct, so it only breaks
        // close ties instead of outweighing task/key ownership.
        if (selectedPaths.has(normalizePath(file.path))) score += 15;
        if (traceReferencePaths.has(normalizePath(file.path))) score += 25;
        score += matchedKeys.length * 60;
        return { file, matchedKeys, score };
      })
      .filter((item) => item.matchedKeys.length > 0)
      .sort((left, right) => right.score - left.score);

    const firstConsumer = consumers[0];
    const secondConsumer = consumers[1];
    const primaryConsumer =
      firstConsumer &&
      (!secondConsumer || firstConsumer.score - secondConsumer.score >= 30)
        ? firstConsumer
        : undefined;
    const ownerEvidence = exactTextEvidence({
      owner,
      consumer: primaryConsumer?.file,
      keys,
      literals: [...literalSet],
    });
    const selected: SelectedTaskFile[] = [
      {
        path: owner.path,
        kind: owner.kind,
        usage: "inspect-and-edit",
        reason: ownerEvidence.reason,
        confidence: 0.92,
        evidenceLevel: "graph_supported",
        selectionEvidence: ownerEvidence,
      },
    ];
    // Keep one strongest UI consumer. Translation extraction may only expose a
    // leaf key (for example `noProjects`), which can be reused by unrelated
    // namespaces. Extra consumers stay discoverable during inspection instead
    // of occupying primary Task Pack slots without a full-key proof.
    for (const consumer of primaryConsumer && input.maxFiles > 1
      ? [primaryConsumer]
      : []) {
      const evidence = exactTextConsumerEvidence({
        consumer: consumer.file,
        owner,
        keys: consumer.matchedKeys,
      });
      selected.push({
        path: consumer.file.path,
        kind: consumer.file.kind,
        usage: "inspect-only",
        reason: evidence.reason,
        confidence: 0.82,
        evidenceLevel: "graph_supported",
        selectionEvidence: evidence,
      });
    }

    return {
      selectedFiles: selected.slice(
        0,
        Math.min(input.maxFiles, input.profile.maxPrimaryFiles),
      ),
      profile: input.profile,
      deterministicImplementationReady: true,
      notes: [
        `Final selection was rebuilt from exact text evidence: ${owner.path} owns the matching translation entry.`,
        primaryConsumer
          ? `Translation consumer retained as reference: ${primaryConsumer.file.path}.`
          : "No unique UI consumer was proven; the exact translation owner remains the implementation target.",
      ],
    };
  }

  const directMatches = input.inventory.files
    .filter(
      (file) =>
        file.canReadText &&
        taskAllowsFileKind(input.profile, file, input.taskIntent),
    )
    .map((file) => {
      const text = normalizeLiteral(
        [
          file.contentPreview ?? "",
          ...(file.textHints ?? []),
          ...(file.semanticFacts?.stringLiterals ?? []),
        ].join(" "),
      );
      const allLiterals = [...literalSet].filter((literal) =>
        text.includes(literal),
      );
      const containsSource = sourceLiteral
        ? allLiterals.includes(sourceLiteral)
        : false;
      const literals = sourceLiteral
        ? containsSource
          ? [sourceLiteral]
          : []
        : allLiterals;
      let score =
        literals.length * 100 +
        fileIdentityScore(file, tokens) +
        fileIdentityScore(file, rawTaskTokens) * 3 +
        behavioralOwnerScore(file, input.rawTask);
      if (containsSource) score += 160;
      if (isUiFile(file)) score += 50;
      if (selectedPaths.has(normalizePath(file.path))) score += 15;
      if (explicitIntentPaths.has(normalizePath(file.path))) score += 260;
      return { file, literals, score };
    })
    .filter((item) => item.literals.length > 0)
    .sort((left, right) => right.score - left.score);

  if (directMatches.length > 0) {
    const owner = directMatches[0]!;
    const second = directMatches[1];
    const uniqueOwner = !second || owner.score - second.score >= 35;
    if (uniqueOwner) {
      const evidence = directLiteralEvidence(owner.file, owner.literals);
      const selected: SelectedTaskFile[] = [
        {
          path: owner.file.path,
          kind: owner.file.kind,
          usage: "inspect-and-edit",
          reason: evidence.reason,
          confidence: 0.9,
          evidenceLevel: "graph_supported",
          selectionEvidence: evidence,
        },
      ];
      let explicitScope = input.selectedFiles
        .map((file) => ({
          selected: file,
          inventoryFile: input.inventory.files.find(
            (candidate) =>
              normalizePath(candidate.path) === normalizePath(file.path),
          ),
        }))
        .filter(
          (
            item,
          ): item is {
            selected: SelectedTaskFile;
            inventoryFile: ProjectInventoryFile;
          } => {
            const inventoryFile = item.inventoryFile;
            if (!inventoryFile) return false;
            return (
              normalizePath(item.selected.path) !==
                normalizePath(owner.file.path) &&
              isUiFile(inventoryFile) &&
              (item.selected.evidenceLevel === "user_confirmed" ||
                item.selected.selectionEvidence?.targetSource === "user_text")
            );
          },
        )
        .sort(
          (left, right) =>
            fileIdentityScore(right.inventoryFile, tokens) -
            fileIdentityScore(left.inventoryFile, tokens),
        )[0];
      if (!explicitScope) {
        const literalScope = input.inventory.files
          .filter(
            (file) =>
              normalizePath(file.path) !== normalizePath(owner.file.path) &&
              isUiFile(file),
          )
          .map((file) => ({
            file,
            score: literalUiSurfaceScore(file, input.rawTask, input.taskIntent),
          }))
          .filter((item) => item.score >= 420)
          .sort(
            (left, right) =>
              right.score - left.score ||
              left.file.path.localeCompare(right.file.path),
          )[0]?.file;
        if (literalScope) {
          explicitScope = {
            selected: {
              path: literalScope.path,
              kind: literalScope.kind,
              usage: "inspect-only",
              reason: "User-named UI scope retained for exact-text verification.",
              confidence: 0.82,
              evidenceLevel: "graph_supported",
            },
            inventoryFile: literalScope,
          };
        }
      }
      if (explicitScope && input.maxFiles > 1) {
        const scopeEvidence = exactTextScopeConsumerEvidence({
          consumer: explicitScope.inventoryFile,
          owner: owner.file,
          literals: owner.literals,
        });
        selected.push({
          path: explicitScope.inventoryFile.path,
          kind: explicitScope.inventoryFile.kind,
          usage: "inspect-only",
          reason: scopeEvidence.reason,
          confidence: 0.82,
          evidenceLevel: "graph_supported",
          selectionEvidence: scopeEvidence,
        });
      }
      return {
        selectedFiles: selected.slice(
          0,
          Math.min(input.maxFiles, input.profile.maxPrimaryFiles),
        ),
        profile: input.profile,
        deterministicImplementationReady: true,
        notes: [
          isLocalizationResource(owner.file)
            ? `Final selection was rebuilt from a unique exact literal match in localization resource ${owner.file.path}.`
            : `Final selection was rebuilt from a unique exact literal match in ${owner.file.path}.`,
          ...(explicitScope
            ? [
                `User-named UI scope retained as reference: ${explicitScope.inventoryFile.path}.`,
              ]
            : []),
        ],
      };
    }

    const candidates = directMatches
      .slice(0, Math.min(input.maxFiles, input.profile.maxPrimaryFiles))
      .map((item) => {
        const evidence = directLiteralEvidence(item.file, item.literals);
        return {
          path: item.file.path,
          kind: item.file.kind,
          usage: "inspect-only" as const,
          reason:
            "The exact literal appears here, but multiple plausible owners remain; inspect task scope before editing.",
          confidence: 0.68,
          evidenceLevel: "graph_supported" as const,
          selectionEvidence: {
            ...evidence,
            actionConfidence: "inspect_only" as const,
            reason:
              "Multiple real files contain the exact literal; ownership is unresolved.",
          },
        };
      });
    return {
      selectedFiles: candidates,
      profile: input.profile,
      deterministicImplementationReady: false,
      notes: [
        "Multiple real files contain the exact literal and no unique owner was proven; final mode remains investigation.",
      ],
    };
  }

  return null;
}

interface ApiContractConcepts {
  aliases: Set<string>;
  subjectTokens: string[];
  cacheProvenance: boolean;
  reuseProvenance: boolean;
}

function apiContractTaskText(rawTask: string, taskIntent?: TaskIntentAnalysis) {
  return [
    rawTask,
    taskIntent?.taskUnderstanding.goal ?? "",
    ...(taskIntent?.taskUnderstanding.requestedChanges ?? []),
    ...(taskIntent?.domainTerms ?? []),
    ...(taskIntent?.recommendedSearchTerms ?? []),
  ].join(" ");
}

function buildApiContractConcepts(
  rawTask: string,
  taskIntent?: TaskIntentAnalysis,
): ApiContractConcepts {
  const text = apiContractTaskText(rawTask, taskIntent);
  const normalized = normalizeIdentifier(text);
  const cacheProvenance =
    /\b(?:cache|cached|cache hit|from cache|retrieved from cache|served from cache)\b|(?:кеш|кэш)/iu.test(
      text,
    );
  const reuseProvenance =
    /\b(?:reuse|reused|was reused|snapshot reused)\b|(?:переиспольз|повторн\w*\s+использ)/iu.test(
      text,
    );
  const generic = new Set([
    "add",
    "api",
    "backend",
    "boolean",
    "contract",
    "create",
    "data",
    "field",
    "flag",
    "indicating",
    "property",
    "request",
    "response",
    "return",
    "server",
    "show",
    "showing",
    "value",
    "task",
    "pack",
    "добавь",
    "апи",
    "булево",
    "булев",
    "поле",
    "показывающее",
    "показывает",
    "ответ",
    "сервер",
    "значение",
    "генерации",
    "получен",
    "был",
    "ли",
    "из",
    "кеша",
    "кэша",
  ]);
  const subjectTokens = uniqueStrings(
    [
      ...(text.match(/[A-Za-z_$][A-Za-z0-9_$]{2,}/g) ?? []),
      ...normalized.split(/\s+/u),
    ]
      .map((token) => canonicalInvestigationSymbol(token))
      .filter((token) => token.length >= 4 && !generic.has(token)),
    16,
  );

  const aliases = new Set<string>();
  const addAlias = (value: string) => {
    const canonical = canonicalInvestigationSymbol(value);
    if (canonical.length >= 3) aliases.add(canonical);
  };

  for (const match of text.matchAll(
    /["'`]([A-Za-z_$][A-Za-z0-9_$]{2,})["'`]/g,
  )) {
    addAlias(match[1] ?? "");
  }
  for (const token of text.match(/[A-Za-z_$][A-Za-z0-9_$]{2,}/g) ?? []) {
    if (/[A-Z_$]/u.test(token.slice(1)) || token.includes("_")) addAlias(token);
  }

  const conceptSuffixes: string[] = [];
  if (cacheProvenance) {
    for (const alias of [
      "cached",
      "isCached",
      "wasCached",
      "fromCache",
      "cacheHit",
      "cacheSource",
    ])
      addAlias(alias);
    conceptSuffixes.push("cached", "fromCache", "cacheHit");
  }
  if (reuseProvenance) {
    for (const alias of ["reused", "isReused", "wasReused", "reuseHit"])
      addAlias(alias);
    conceptSuffixes.push("reused", "wasReused");
  }

  for (const subject of subjectTokens.slice(0, 8)) {
    for (const suffix of conceptSuffixes) {
      addAlias(`${subject}${suffix}`);
      addAlias(`is${subject}${suffix}`);
    }
  }

  return { aliases, subjectTokens, cacheProvenance, reuseProvenance };
}

function apiFactSubjectScore(
  facts: InvestigationFileFacts,
  concepts: ApiContractConcepts,
  taskTokens: string[],
) {
  let score = fileIdentityScore(facts.file, taskTokens);
  const factSymbols = [
    ...facts.declarations,
    ...facts.references,
    ...facts.objectProperties,
    ...facts.typeFields,
  ];
  for (const subject of concepts.subjectTokens) {
    if (
      factSymbols.some(
        (symbol) => symbol === subject || symbol.includes(subject),
      )
    ) {
      score += subject.length >= 8 ? 42 : 24;
    }
  }
  return score;
}

function apiFieldMatches(facts: InvestigationFileFacts, aliases: Set<string>) {
  const strongPool = new Set([
    ...facts.objectProperties,
    ...facts.typeFields,
    ...facts.assignments,
    ...facts.declarations,
  ]);
  const strong = [...aliases].filter((alias) => strongPool.has(alias));
  const references = [...aliases].filter(
    (alias) => !strongPool.has(alias) && facts.references.has(alias),
  );
  return { strong, references };
}

function isBackendInventoryFile(file: ProjectInventoryFile) {
  const path = normalizePath(file.path);
  return (
    /(?:^|\/)(?:server|backend)(?:\/|$)/u.test(path) ||
    ["api-route", "server-entry", "service", "repository"].includes(file.role)
  );
}

function isApiBoundaryFacts(facts: InvestigationFileFacts) {
  const path = normalizePath(facts.file.path);
  return (
    facts.file.role === "api-route" ||
    facts.routePaths.size > 0 ||
    /(?:^|\/)(?:routes?|controllers?|handlers?)(?:\/|$)/u.test(path)
  );
}

function isContractTypeFacts(facts: InvestigationFileFacts) {
  const path = normalizePath(facts.file.path);
  return (
    facts.file.role === "types" ||
    facts.typeFields.size > 0 ||
    /(?:^|\/)(?:types?|contracts?|schemas?)(?:\/|$)/u.test(path)
  );
}

function importDistance(
  from: InvestigationFileFacts,
  target: InvestigationFileFacts,
  byPath: Map<string, InvestigationFileFacts>,
) {
  const targetPath = normalizeInvestigationPath(target.file.path);
  if (
    from.imports.some(
      (edge) => normalizeInvestigationPath(edge.to) === targetPath,
    )
  ) {
    return { distance: 1, via: undefined as string | undefined };
  }
  for (const edge of from.imports) {
    const bridge = byPath.get(normalizeInvestigationPath(edge.to));
    if (!bridge) continue;
    if (
      bridge.imports.some(
        (nested) => normalizeInvestigationPath(nested.to) === targetPath,
      )
    ) {
      return { distance: 2, via: bridge.file.path };
    }
  }
  return null;
}

function aliasSpecificity(alias: string, subjectTokens: string[]) {
  let score = Math.min(alias.length, 32);
  if (subjectTokens.some((subject) => alias.includes(subject))) score += 60;
  if (/^(?:is|was)/u.test(alias)) score += 8;
  return score;
}

function resolveApiContractSelection(input: {
  rawTask: string;
  taskIntent?: TaskIntentAnalysis;
  inventory: ProjectInventory;
  selectedFiles: SelectedTaskFile[];
  profile: TaskSelectionProfile;
  maxFiles: number;
}): FinalSelectionDecision | null {
  const taskText = apiContractTaskText(input.rawTask, input.taskIntent);
  const asksForApiField =
    /\b(?:api|endpoint|response|payload|contract)\b|(?:\b(?:field|property|flag|boolean)\b[^.!?]{0,100}\b(?:api|response|payload)\b)|(?:api|апи|ответ|контракт)[^.!?]{0,100}(?:пол[ея]|свойств|флаг|булев)/iu.test(
      taskText,
    );
  if (!asksForApiField) return null;

  const concepts = buildApiContractConcepts(input.rawTask, input.taskIntent);
  if (concepts.aliases.size === 0) return null;

  const taskTokens = taskIdentityTokens(input.rawTask, input.taskIntent);
  const selectedPaths = new Set(
    input.selectedFiles.map((file) => normalizePath(file.path)),
  );
  const { index } = buildInvestigationRelationshipIndex(input.inventory);

  const producerCandidates = index.files
    .filter(
      (facts) =>
        isBackendInventoryFile(facts.file) &&
        !isApiBoundaryFacts(facts) &&
        taskAllowsFileKind(input.profile, facts.file, input.taskIntent),
    )
    .map((facts) => {
      const matches = apiFieldMatches(facts, concepts.aliases);
      const subjectScore = apiFactSubjectScore(facts, concepts, taskTokens);
      const specificMatches = matches.strong.filter((alias) =>
        concepts.subjectTokens.some((subject) => alias.includes(subject)),
      );
      const score =
        matches.strong.length * 180 +
        specificMatches.length * 120 +
        subjectScore * 5 +
        (facts.file.role === "service" ? 80 : 0) +
        (selectedPaths.has(normalizePath(facts.file.path)) ? 20 : 0);
      return { facts, matches, subjectScore, score };
    })
    .filter((item) => item.matches.strong.length > 0 && item.subjectScore >= 20)
    .sort((left, right) => right.score - left.score);

  const producer = producerCandidates[0];
  const secondProducer = producerCandidates[1];
  if (
    !producer ||
    (secondProducer && producer.score - secondProducer.score < 55)
  ) {
    return null;
  }

  const routeCandidates = index.files
    .filter(
      (facts) =>
        isBackendInventoryFile(facts.file) &&
        isApiBoundaryFacts(facts) &&
        taskAllowsFileKind(input.profile, facts.file, input.taskIntent),
    )
    .map((facts) => {
      const connection = importDistance(facts, producer.facts, index.byPath);
      const subjectScore = apiFactSubjectScore(facts, concepts, taskTokens);
      const score =
        subjectScore * 6 +
        (connection?.distance === 1
          ? 600
          : connection?.distance === 2
            ? 340
            : 0) +
        facts.routePaths.size * 35 +
        (selectedPaths.has(normalizePath(facts.file.path)) ? 25 : 0);
      return { facts, connection, subjectScore, score };
    })
    .filter((item) => Boolean(item.connection) && item.subjectScore >= 20)
    .sort((left, right) => right.score - left.score);

  const route = routeCandidates[0];
  const secondRoute = routeCandidates[1];
  if (!route || (secondRoute && route.score - secondRoute.score < 45)) {
    return null;
  }

  const contractCandidates = index.files
    .filter(
      (facts) =>
        facts.file.path !== producer.facts.file.path &&
        facts.file.path !== route.facts.file.path &&
        isContractTypeFacts(facts) &&
        taskAllowsFileKind(input.profile, facts.file, input.taskIntent),
    )
    .map((facts) => {
      const matches = apiFieldMatches(facts, concepts.aliases);
      const subjectScore = apiFactSubjectScore(facts, concepts, taskTokens);
      const bestAliasScore = Math.max(
        0,
        ...matches.strong.map((alias) =>
          aliasSpecificity(alias, concepts.subjectTokens),
        ),
      );
      return {
        facts,
        matches,
        subjectScore,
        score:
          matches.strong.length * 120 + bestAliasScore * 4 + subjectScore * 3,
      };
    })
    .filter((item) => item.matches.strong.length > 0 && item.subjectScore >= 12)
    .sort((left, right) => right.score - left.score);

  const contractType = contractCandidates[0];
  const producerAliases = producer.matches.strong
    .slice()
    .sort(
      (left, right) =>
        aliasSpecificity(right, concepts.subjectTokens) -
        aliasSpecificity(left, concepts.subjectTokens),
    );
  const contractAliases = (contractType?.matches.strong ?? [])
    .slice()
    .sort(
      (left, right) =>
        aliasSpecificity(right, concepts.subjectTokens) -
        aliasSpecificity(left, concepts.subjectTokens),
    );
  const sourceAlias = producerAliases[0] ?? "existingValue";
  const publicAlias = contractAliases[0] ?? sourceAlias;
  const routeMatches = apiFieldMatches(route.facts, concepts.aliases);
  const routeAlreadyExposesValue = routeMatches.strong.includes(publicAlias);

  const producerEvidence: FileSelectionEvidence = {
    targetSource: "ranking",
    pathValidity: "inventory_exact",
    ownershipEvidence: "symbol_exact",
    actionConfidence: "inspect_only",
    semanticRoles: ["producer", "contract"],
    symbols: uniqueStrings([sourceAlias, ...producerAliases], 10),
    chain: [
      {
        symbol: sourceAlias,
        role: "producer",
        path: producer.facts.file.path,
        relatedPath: route.facts.file.path,
        evidence: "symbol_exact",
        relation: "import_graph",
      },
    ],
    negativeConstraintConflicts: [],
    reason: `Existing producer already exposes the related value (${sourceAlias}); reuse it as the source of truth instead of creating a duplicate field inside the generated payload schema.`,
  };

  const routeEvidence: FileSelectionEvidence = {
    targetSource: "user_text",
    pathValidity: "inventory_exact",
    ownershipEvidence: "route_graph",
    actionConfidence: routeAlreadyExposesValue
      ? "inspect_only"
      : "inspect_then_edit",
    semanticRoles: ["route", "contract"],
    symbols: uniqueStrings([publicAlias, sourceAlias], 8),
    chain: [
      {
        symbol: sourceAlias,
        role: "producer",
        path: producer.facts.file.path,
        relatedPath: route.facts.file.path,
        evidence: "symbol_exact",
        relation: "import_graph",
      },
      {
        symbol: publicAlias,
        role: "route",
        path: route.facts.file.path,
        relatedPath: contractType?.facts.file.path,
        evidence: "route_graph",
        relation: "route_local",
      },
    ],
    negativeConstraintConflicts: [],
    reason: routeAlreadyExposesValue
      ? `The API boundary already contains the related public field (${publicAlias}); inspect the route before adding another field.`
      : `API boundary imports the existing producer and is the implementation owner for exposing ${sourceAlias} as the public boolean field ${publicAlias}.`,
  };

  const selected: SelectedTaskFile[] = [
    {
      path: route.facts.file.path,
      kind: route.facts.file.kind,
      usage: routeAlreadyExposesValue ? "inspect-only" : "inspect-and-edit",
      reason: routeEvidence.reason,
      confidence: routeAlreadyExposesValue ? 0.76 : 0.9,
      evidenceLevel: "graph_supported",
      selectionEvidence: routeEvidence,
    },
    {
      path: producer.facts.file.path,
      kind: producer.facts.file.kind,
      usage: "inspect-only",
      reason: producerEvidence.reason,
      confidence: 0.84,
      evidenceLevel: "graph_supported",
      selectionEvidence: producerEvidence,
    },
  ];

  if (
    contractType &&
    selected.length < Math.min(input.maxFiles, input.profile.maxPrimaryFiles)
  ) {
    const contractEvidence: FileSelectionEvidence = {
      targetSource: "ranking",
      pathValidity: "inventory_exact",
      ownershipEvidence: "symbol_exact",
      actionConfidence: "inspect_only",
      semanticRoles: ["contract", "consumer"],
      symbols: uniqueStrings([publicAlias, ...contractAliases], 10),
      chain: [
        {
          symbol: publicAlias,
          role: "contract",
          path: contractType.facts.file.path,
          relatedPath: route.facts.file.path,
          evidence: "symbol_exact",
          relation: "identifier_reference",
        },
      ],
      negativeConstraintConflicts: [],
      reason: `Existing client/shared contract already contains the related public field (${publicAlias}); retain it to verify the API response shape without adding UI state or unrelated display files.`,
    };
    selected.push({
      path: contractType.facts.file.path,
      kind: contractType.facts.file.kind,
      usage: "inspect-only",
      reason: contractEvidence.reason,
      confidence: 0.8,
      evidenceLevel: "graph_supported",
      selectionEvidence: contractEvidence,
    });
  }

  return {
    selectedFiles: selected.slice(
      0,
      Math.min(input.maxFiles, input.profile.maxPrimaryFiles),
    ),
    profile: input.profile,
    deterministicImplementationReady: !routeAlreadyExposesValue,
    canonicalSelectionApplied: true,
    requiredLayersOverride: ["backend"],
    notes: [
      `Final selection was rebuilt from API contract evidence: ${producer.facts.file.path} already produces ${sourceAlias}, and ${route.facts.file.path} owns the API boundary.`,
      routeAlreadyExposesValue
        ? `The API boundary already appears to expose ${publicAlias}; keep the task investigative to avoid duplicating an existing contract field.`
        : `Reuse/expose operation proven: surface the existing producer value through the API boundary instead of adding a second semantic field to the refinement payload.`,
      ...(contractType
        ? [
            `Existing public contract retained as reference: ${contractType.facts.file.path} (${publicAlias}).`,
          ]
        : []),
    ],
  };
}

function resolveDirectApiBoundarySelection(input: {
  rawTask: string;
  taskIntent?: TaskIntentAnalysis;
  inventory: ProjectInventory;
  selectedFiles: SelectedTaskFile[];
  profile: TaskSelectionProfile;
  maxFiles: number;
}): FinalSelectionDecision | null {
  const text = apiContractTaskText(input.rawTask, input.taskIntent);
  const boundedExistingValue =
    /(?:\b(?:existing|already|reuse)\b|существующ|уже\s+существующ|вже\s+існуюч)/iu.test(
      text,
    );
  const asksApiField =
    /\b(?:api|response|payload|contract)\b[^.!?\n]{0,140}\b(?:field|property|flag|boolean)\b|(?:api|апи|ответ|відповід|контракт)[^.!?\n]{0,140}(?:пол[ея]|свойств|флаг|булев)/iu.test(
      text,
    );
  if (!boundedExistingValue || !asksApiField) return null;

  const taskTokens = taskIdentityTokens(input.rawTask);
  const selectedPaths = new Set(
    input.selectedFiles.map((file) => normalizePath(file.path)),
  );
  const routes = input.inventory.files
    .filter(
      (file) =>
        file.role === "api-route" ||
        /(?:^|\/)routes?\/[^/]+\.[cm]?[jt]s$/u.test(normalizePath(file.path)),
    )
    .filter((file) => taskAllowsFileKind(input.profile, file, input.taskIntent))
    .map((file) => {
      let score = fileIdentityScore(file, taskTokens) * 4;
      score += behavioralOwnerScore(file, input.rawTask);
      if (selectedPaths.has(normalizePath(file.path))) score += 120;
      if (file.role === "api-route") score += 80;
      return { file, score };
    })
    .sort(
      (left, right) =>
        right.score - left.score || left.file.path.localeCompare(right.file.path),
    );
  const owner = routes[0];
  const second = routes[1];
  if (!owner || (second && owner.score - second.score < 55)) return null;

  const evidence: FileSelectionEvidence = {
    targetSource: "ranking",
    pathValidity: "inventory_exact",
    ownershipEvidence: "route_graph",
    actionConfidence: "confirmed_edit",
    semanticRoles: ["route", "contract"],
    symbols: uniqueStrings(
      [owner.file.name.replace(/\.[^.]+$/u, ""), ...(owner.file.exports ?? [])],
      10,
    ),
    chain: [],
    negativeConstraintConflicts: [],
    reason:
      "The existing API route is the unique boundary for exposing an already available value; protected UI/storage layers remain outside edit scope.",
  };
  const selected: SelectedTaskFile[] = [
    {
      path: owner.file.path,
      kind: owner.file.kind,
      usage: "inspect-and-edit",
      reason: evidence.reason,
      confidence: 0.9,
      evidenceLevel: "graph_supported",
      selectionEvidence: evidence,
    },
  ];

  const backendSupport = input.selectedFiles
    .filter((file) => normalizePath(file.path) !== normalizePath(owner.file.path))
    .filter((file) => /(?:^|\/)(?:server|backend)(?:\/|$)/u.test(normalizePath(file.path)))
    .filter((file) => file.selectionEvidence?.negativeConstraintConflicts.length === 0)
    .slice(0, Math.max(0, Math.min(2, input.maxFiles - 1)))
    .map((file) => ({
      ...file,
      usage: "inspect-only" as const,
      confidence: Math.min(file.confidence, 0.78),
      selectionEvidence: file.selectionEvidence
        ? {
            ...file.selectionEvidence,
            actionConfidence: "inspect_only" as const,
          }
        : file.selectionEvidence,
    }));

  return {
    selectedFiles: [...selected, ...backendSupport],
    profile: input.profile,
    deterministicImplementationReady: true,
    canonicalSelectionApplied: true,
    requiredLayersOverride: ["backend"],
    notes: [
      `Canonical decision grounded the bounded API mutation to ${owner.file.path}.`,
      "Existing producer context is inspect-only; UI and storage are not authorized.",
    ],
  };
}

interface StateBehaviorConcepts {
  valueAliases: string[];
  entityAliases: string[];
  actionAliases: string[];
  displayAliases: string[];
  staleBehavior: boolean;
}

function stateBehaviorTaskText(
  rawTask: string,
  taskIntent?: TaskIntentAnalysis,
) {
  const semanticValues = [
    ...(taskIntent?.taskUnderstanding.targetHints ?? []),
    ...(taskIntent?.domainTerms ?? []),
    ...(taskIntent?.mentionedEntities ?? []),
    ...(taskIntent?.recommendedSearchTerms ?? []),
  ].filter((value) => !/[\/]|\.[a-z0-9]{1,6}$/iu.test(value));
  return [
    rawTask,
    taskIntent?.taskUnderstanding.goal ?? "",
    ...(taskIntent?.taskUnderstanding.requestedChanges ?? []),
    ...semanticValues,
  ].join(" ");
}

function buildStateBehaviorConcepts(
  rawTask: string,
  taskIntent?: TaskIntentAnalysis,
): StateBehaviorConcepts {
  const text = stateBehaviorTaskText(rawTask, taskIntent);
  const normalized = normalizeIdentifier(text);
  const allTokens = uniqueStrings(
    [
      ...(text.match(/[A-Za-z_$][A-Za-z0-9_$]{2,}/g) ?? []),
      ...normalized.split(/\s+/u),
    ]
      .map(canonicalInvestigationSymbol)
      .filter((token) => token.length >= 3),
    48,
  );

  const actionAliases = new Set<string>();
  const addAction = (...values: string[]) => {
    for (const value of values) {
      const canonical = canonicalInvestigationSymbol(value);
      if (canonical.length >= 3) actionAliases.add(canonical);
    }
  };
  if (
    /\b(?:rescan|scan again|re-scan)\b|(?:повторн\w*\s+скан|перескан|сканирован)/iu.test(
      text,
    )
  ) {
    addAction("rescan", "scan", "refresh");
  }
  if (
    /\b(?:refresh|reload|invalidate|update again)\b|(?:обнов|перезагруз|инвалидац)/iu.test(
      text,
    )
  ) {
    addAction("refresh", "reload", "update", "invalidate");
  }
  if (/\b(?:save|persist)\b|(?:сохран)/iu.test(text))
    addAction("save", "persist");
  if (/\b(?:delete|remove)\b|(?:удал)/iu.test(text))
    addAction("delete", "remove");
  if (/\b(?:create|add)\b|(?:созд|добав)/iu.test(text))
    addAction("create", "add");
  for (const token of allTokens) {
    if (
      /^(?:re)?scan|refresh|reload|invalidate|update|save|persist|delete|remove|create|add/u.test(
        token,
      )
    ) {
      addAction(token);
    }
  }

  const displayAliases = new Set<string>();
  const addDisplay = (...values: string[]) => {
    for (const value of values) {
      const canonical = canonicalInvestigationSymbol(value);
      if (canonical.length >= 3) displayAliases.add(canonical);
    }
  };
  if (/\bcard\b|карточ/iu.test(text)) addDisplay("card");
  if (/\bmodal\b|модал/iu.test(text)) addDisplay("modal");
  if (/\btable\b|таблиц/iu.test(text)) addDisplay("table");
  if (/\blist\b|список/iu.test(text)) addDisplay("list");
  if (/\bpage\b|страниц/iu.test(text)) addDisplay("page");
  if (/\bpanel\b|панел/iu.test(text)) addDisplay("panel");

  const valueAliases = new Set<string>();
  const valueSources = [
    ...(taskIntent?.taskUnderstanding.targetHints ?? []),
    ...(taskIntent?.mentionedEntities ?? []),
    ...(taskIntent?.structuredIntent.primaryTargets ?? []).map(
      (target) => target.name ?? target.value,
    ),
  ];
  for (const value of valueSources) {
    if (/[\/]|\.[a-z0-9]{1,6}$/iu.test(value)) continue;
    const canonical = canonicalInvestigationSymbol(value);
    if (
      canonical.length >= 6 &&
      canonical.length <= 48 &&
      /(?:score|status|count|value|result|data|metric|label|progress)$/u.test(
        canonical,
      )
    )
      valueAliases.add(canonical);
  }
  for (const phrase of text.match(
    /[A-Za-z_$][A-Za-z0-9_$]*(?:\s+[A-Za-z_$][A-Za-z0-9_$]*){0,2}/g,
  ) ?? []) {
    const canonical = canonicalInvestigationSymbol(phrase);
    if (
      canonical.length >= 6 &&
      canonical.length <= 40 &&
      !/(?:tsx|jsx|typescript|javascript)/u.test(canonical) &&
      /(?:score|status|count|value|metric|label|progress)$/u.test(canonical)
    )
      valueAliases.add(canonical);
  }
  for (const token of allTokens) {
    if (
      token.length >= 7 &&
      !["result", "status", "value", "metric", "progress"].includes(token) &&
      /(?:score|status|count|value|metric|label|progress)$/u.test(token)
    )
      valueAliases.add(token);
  }

  const genericEntityTokens = new Set([
    "after",
    "again",
    "before",
    "bug",
    "card",
    "continue",
    "continues",
    "display",
    "displays",
    "error",
    "fix",
    "from",
    "into",
    "old",
    "outdated",
    "readiness",
    "rescan",
    "scan",
    "score",
    "show",
    "showing",
    "stale",
    "state",
    "still",
    "trace",
    "update",
    "where",
    "which",
    "исправь",
    "ошибку",
    "которой",
    "после",
    "повторного",
    "сканирования",
    "карточка",
    "продолжает",
    "показывать",
    "старый",
    "проекта",
  ]);
  const entityAliases = new Set<string>();
  for (const token of allTokens) {
    if (token.length < 4 || genericEntityTokens.has(token)) continue;
    if (
      actionAliases.has(token) ||
      displayAliases.has(token) ||
      valueAliases.has(token)
    )
      continue;
    if (
      [...valueAliases].some(
        (value) => value.includes(token) || token.includes(value),
      )
    )
      continue;
    entityAliases.add(token);
    if (/^[a-z][a-z0-9]+$/u.test(token)) {
      if (token.endsWith("s") && token.length > 4)
        entityAliases.add(token.slice(0, -1));
      else entityAliases.add(`${token}s`);
      for (const display of displayAliases) {
        if (token.endsWith(display) && token.length > display.length + 2) {
          const prefix = token.slice(0, -display.length);
          entityAliases.add(prefix);
          entityAliases.add(`${prefix}s`);
        }
      }
    }
  }

  return {
    valueAliases: [...valueAliases].slice(0, 12),
    entityAliases: [...entityAliases].slice(0, 16),
    actionAliases: [...actionAliases].slice(0, 12),
    displayAliases: [...displayAliases].slice(0, 8),
    staleBehavior:
      /\b(?:stale|old|outdated|unchanged|still shows?)\b|(?:стар|устаревш|не\s+обнов|продолжает\s+показывать)/iu.test(
        text,
      ),
  };
}

function stateFlowFactSymbols(facts: InvestigationFileFacts) {
  return new Set(
    [
      facts.file.path,
      facts.file.name,
      facts.file.role,
      ...(facts.file.exports ?? []),
      ...(facts.file.symbols ?? []),
      ...(facts.file.textHints ?? []),
      ...facts.declarations,
      ...facts.references,
      ...facts.assignments,
      ...facts.objectProperties,
      ...facts.typeFields,
      ...facts.stateSymbols,
      ...facts.callSymbols,
      ...facts.routePaths,
    ]
      .map(canonicalInvestigationSymbol)
      .filter((value) => value.length >= 3),
  );
}

function stateFlowFileIdentitySymbols(facts: InvestigationFileFacts) {
  return new Set(
    [
      facts.file.path,
      facts.file.name,
      facts.file.role,
      ...(facts.file.exports ?? []),
    ]
      .map(canonicalInvestigationSymbol)
      .filter((value) => value.length >= 3),
  );
}

function stateFlowMatches(symbols: Set<string>, aliases: string[]) {
  return aliases.some((alias) => {
    if (alias.length < 3) return false;
    for (const symbol of symbols) {
      if (symbol === alias) return true;
      if (alias.length >= 4 && symbol.includes(alias)) return true;
    }
    return false;
  });
}

function isStateFlowImplementationFile(
  profile: TaskSelectionProfile,
  file: ProjectInventoryFile,
  taskIntent?: TaskIntentAnalysis,
) {
  if (!taskAllowsFileKind(profile, file, taskIntent)) return false;
  if (profile.kind === "tests") return true;
  const path = normalizePath(file.path);
  return (
    !/(?:^|[./_-])(?:test|tests|spec|smoke|replay|benchmark|fixture)(?:[./_-]|$)/iu.test(
      path,
    ) &&
    !/(?:test|spec|smoke|replay|benchmark|fixture)[A-Z]/u.test(file.name) &&
    !/\.backup(?:\.|$)|backup\.(?:txt|tsx?|jsx?)$/u.test(path)
  );
}

function stateFlowEvidence(input: {
  file: InvestigationFileFacts;
  related?: InvestigationFileFacts;
  ownershipEvidence: FileSelectionEvidence["ownershipEvidence"];
  roles: FileSelectionEvidence["semanticRoles"];
  symbols: string[];
  reason: string;
  relation?: SemanticEvidenceLink["relation"];
}): FileSelectionEvidence {
  return {
    targetSource: "ranking",
    pathValidity: "inventory_exact",
    ownershipEvidence: input.ownershipEvidence,
    actionConfidence: "inspect_only",
    semanticRoles: input.roles,
    symbols: uniqueStrings(input.symbols, 10),
    chain: input.symbols.slice(0, 6).map((symbol) => ({
      symbol,
      role: input.roles[0] ?? "reference",
      path: input.file.file.path,
      relatedPath: input.related?.file.path,
      evidence: input.ownershipEvidence,
      relation: input.relation ?? "identifier_reference",
    })),
    negativeConstraintConflicts: [],
    reason: input.reason,
  };
}

function resolveStateBehaviorSelection(input: {
  rawTask: string;
  taskIntent?: TaskIntentAnalysis;
  inventory: ProjectInventory;
  selectedFiles: SelectedTaskFile[];
  profile: TaskSelectionProfile;
  maxFiles: number;
}): FinalSelectionDecision | null {
  const concepts = buildStateBehaviorConcepts(input.rawTask, input.taskIntent);
  if (
    concepts.valueAliases.length === 0 ||
    concepts.entityAliases.length === 0 ||
    concepts.actionAliases.length === 0
  )
    return null;

  const { index } = buildInvestigationRelationshipIndex(input.inventory);
  const selectedPaths = new Set(
    input.selectedFiles.map((file) => normalizePath(file.path)),
  );
  const factsWithSymbols = index.files.map((facts) => ({
    facts,
    symbols: stateFlowFactSymbols(facts),
  }));

  const displayCandidates = factsWithSymbols
    .filter(
      ({ facts, symbols }) =>
        isUiFile(facts.file) &&
        facts.file.role !== "client-api" &&
        isStateFlowImplementationFile(
          input.profile,
          facts.file,
          input.taskIntent,
        ) &&
        stateFlowMatches(symbols, concepts.valueAliases) &&
        stateFlowMatches(symbols, concepts.entityAliases) &&
        (concepts.displayAliases.length === 0 ||
          stateFlowMatches(
            stateFlowFileIdentitySymbols(facts),
            concepts.displayAliases,
          )),
    )
    .map(({ facts, symbols }) => ({
      facts,
      score:
        420 +
        (stateFlowMatches(
          stateFlowFileIdentitySymbols(facts),
          concepts.displayAliases,
        )
          ? 280
          : 0) +
        (facts.file.role === "component" ? 80 : 0) +
        (selectedPaths.has(normalizePath(facts.file.path)) ? 20 : 0),
    }))
    .sort((left, right) => right.score - left.score);
  const display = displayCandidates[0];
  if (
    !display ||
    (displayCandidates[1] && display.score - displayCandidates[1].score < 80)
  )
    return null;

  const stateCandidates = factsWithSymbols
    .filter(
      ({ facts, symbols }) =>
        fileMatchesRequiredLayer(facts.file, "state") &&
        isStateFlowImplementationFile(
          input.profile,
          facts.file,
          input.taskIntent,
        ) &&
        stateFlowMatches(
          new Set([
            ...facts.stateSymbols,
            ...facts.assignments,
            ...facts.declarations,
          ]),
          concepts.entityAliases,
        ) &&
        stateFlowMatches(symbols, concepts.actionAliases),
    )
    .map(({ facts, symbols }) => ({
      facts,
      score:
        500 +
        facts.stateSymbols.size * 35 +
        (stateFlowMatches(symbols, concepts.valueAliases) ? 60 : 0) +
        (facts.file.role === "hook" || facts.file.role === "store" ? 120 : 0) +
        (selectedPaths.has(normalizePath(facts.file.path)) ? 20 : 0),
    }))
    .sort((left, right) => right.score - left.score);
  const stateOwner = stateCandidates[0];
  if (
    !stateOwner ||
    (stateCandidates[1] && stateOwner.score - stateCandidates[1].score < 70)
  )
    return null;

  const parentCandidates = factsWithSymbols
    .filter(
      ({ facts, symbols }) =>
        facts.file.path !== display.facts.file.path &&
        isUiFile(facts.file) &&
        isStateFlowImplementationFile(
          input.profile,
          facts.file,
          input.taskIntent,
        ) &&
        Boolean(importDistance(facts, display.facts, index.byPath)) &&
        stateFlowMatches(symbols, concepts.actionAliases),
    )
    .map(({ facts }) => ({
      facts,
      score:
        420 +
        (facts.file.role === "component" || facts.file.role === "page"
          ? 80
          : 0),
    }))
    .sort((left, right) => right.score - left.score);
  const parent = parentCandidates[0];

  const connectorCandidates = parent
    ? factsWithSymbols
        .filter(
          ({ facts, symbols }) =>
            facts.file.path !== display.facts.file.path &&
            facts.file.path !== parent.facts.file.path &&
            facts.file.path !== stateOwner.facts.file.path &&
            isUiFile(facts.file) &&
            isStateFlowImplementationFile(
              input.profile,
              facts.file,
              input.taskIntent,
            ) &&
            Boolean(importDistance(facts, parent.facts, index.byPath)) &&
            Boolean(importDistance(facts, stateOwner.facts, index.byPath)) &&
            stateFlowMatches(symbols, concepts.actionAliases),
        )
        .map(({ facts }) => ({
          facts,
          score: 560 + (facts.file.role === "page" ? 100 : 0),
        }))
        .sort((left, right) => right.score - left.score)
    : [];
  const connector = connectorCandidates[0];

  const clientCandidates = factsWithSymbols
    .filter(
      ({ facts, symbols }) =>
        fileMatchesRequiredLayer(facts.file, "client-api") &&
        isStateFlowImplementationFile(
          input.profile,
          facts.file,
          input.taskIntent,
        ) &&
        stateFlowMatches(symbols, concepts.actionAliases) &&
        stateFlowMatches(symbols, concepts.entityAliases),
    )
    .map(({ facts }) => {
      const connection = importDistance(stateOwner.facts, facts, index.byPath);
      return {
        facts,
        connection,
        score:
          (connection?.distance === 1
            ? 620
            : connection?.distance === 2
              ? 340
              : 0) + 220,
      };
    })
    .filter((item) => Boolean(item.connection))
    .sort((left, right) => right.score - left.score);
  const clientApi = clientCandidates[0];

  const routeCandidates = factsWithSymbols
    .filter(
      ({ facts, symbols }) =>
        isBackendInventoryFile(facts.file) &&
        (facts.file.role === "api-route" ||
          /(?:^|\/)(?:routes?|controllers?|handlers?)(?:\/|$)/u.test(
            normalizePath(facts.file.path),
          )) &&
        isStateFlowImplementationFile(
          input.profile,
          facts.file,
          input.taskIntent,
        ) &&
        stateFlowMatches(
          new Set([...facts.routePaths, ...symbols]),
          concepts.actionAliases,
        ) &&
        stateFlowMatches(symbols, concepts.entityAliases),
    )
    .map(({ facts }) => ({
      facts,
      score: 460 + facts.routePaths.size * 45,
    }))
    .sort((left, right) => right.score - left.score);
  const backendRoute = routeCandidates[0];

  // A state-flow result is only useful when it forms a coherent path rather
  // than a bag of files that happen to contain the same noun. Require the
  // display + state owner and at least one real action boundary.
  if (!parent && !clientApi && !backendRoute) return null;

  const valueSymbol = concepts.valueAliases[0] ?? "value";
  const actionSymbol = concepts.actionAliases[0] ?? "action";
  const entitySymbol = concepts.entityAliases[0] ?? "entity";
  const selected: SelectedTaskFile[] = [];
  const add = (
    facts: InvestigationFileFacts,
    evidence: FileSelectionEvidence,
    confidence: number,
  ) => {
    if (
      selected.some((file) => normalizePath(file.path) === facts.normalizedPath)
    )
      return;
    selected.push({
      path: facts.file.path,
      kind: facts.file.kind,
      usage: "inspect-only",
      reason: evidence.reason,
      confidence,
      evidenceLevel: "graph_supported",
      selectionEvidence: evidence,
    });
  };

  add(
    stateOwner.facts,
    stateFlowEvidence({
      file: stateOwner.facts,
      related: clientApi?.facts ?? parent?.facts ?? display.facts,
      ownershipEvidence: "state_graph",
      roles: ["state-owner"],
      symbols: [entitySymbol, actionSymbol, valueSymbol],
      relation: clientApi ? "import_graph" : "identifier_reference",
      reason: `State owner keeps the ${entitySymbol} collection and participates in the ${actionSymbol} refresh sequence; inspect this flow before changing local state.`,
    }),
    0.86,
  );
  add(
    display.facts,
    stateFlowEvidence({
      file: display.facts,
      related: parent?.facts ?? stateOwner.facts,
      ownershipEvidence: "reference_graph",
      roles: ["display", "consumer"],
      symbols: [valueSymbol, entitySymbol],
      relation: parent ? "import_graph" : "identifier_reference",
      reason: `Display consumer renders ${valueSymbol} for the user-named ${concepts.displayAliases[0] ?? "UI"} scope; keep it as verification context, not the presumed state owner.`,
    }),
    0.82,
  );
  if (parent) {
    add(
      parent.facts,
      stateFlowEvidence({
        file: parent.facts,
        related: display.facts,
        ownershipEvidence: "reference_graph",
        roles: ["consumer", "display"],
        symbols: [actionSymbol, entitySymbol],
        relation: "import_graph",
        reason: `UI parent imports the display consumer and forwards the ${actionSymbol} action.`,
      }),
      0.8,
    );
  }
  if (connector) {
    add(
      connector.facts,
      stateFlowEvidence({
        file: connector.facts,
        related: stateOwner.facts,
        ownershipEvidence: "reference_graph",
        roles: ["consumer", "state-owner"],
        symbols: [actionSymbol, entitySymbol],
        relation: "import_graph",
        reason: `UI connector imports both the display parent and the state owner, grounding the ${actionSymbol} handler handoff.`,
      }),
      0.8,
    );
  }
  if (clientApi) {
    add(
      clientApi.facts,
      stateFlowEvidence({
        file: clientApi.facts,
        related: stateOwner.facts,
        ownershipEvidence: "route_graph",
        roles: ["route", "producer"],
        symbols: [actionSymbol, entitySymbol],
        relation: "import_graph",
        reason: `Client API boundary is directly imported by the state owner for the ${actionSymbol} operation.`,
      }),
      0.8,
    );
  }
  if (backendRoute) {
    add(
      backendRoute.facts,
      stateFlowEvidence({
        file: backendRoute.facts,
        related: clientApi?.facts,
        ownershipEvidence: "route_graph",
        roles: ["route", "producer"],
        symbols: [actionSymbol, entitySymbol],
        relation: "route_local",
        reason: `Backend route owns the matching ${actionSymbol} request and response boundary; inspect the returned entity before blaming UI state.`,
      }),
      0.78,
    );
  }

  const budget = Math.min(input.maxFiles, input.profile.maxPrimaryFiles, 6);
  return {
    selectedFiles: selected.slice(0, budget),
    profile: input.profile,
    deterministicImplementationReady: false,
    canonicalSelectionApplied: true,
    notes: [
      `Final selection was rebuilt as a connected state-flow chain for ${valueSymbol}: display → UI handoff → state owner → client/backend action boundary.`,
      `Files sharing broad words were discarded unless they participated in the same ${entitySymbol}/${actionSymbol} chain.`,
      concepts.staleBehavior
        ? "The task describes stale behavior, so the chain remains investigative until the first broken update step is confirmed in code."
        : "The state-flow chain remains investigative until the actual broken step is confirmed in code.",
    ],
  };
}


function resolveAnchoredStateInvestigationSelection(input: {
  rawTask: string;
  taskIntent?: TaskIntentAnalysis;
  inventory: ProjectInventory;
  selectedFiles: SelectedTaskFile[];
  profile: TaskSelectionProfile;
  maxFiles: number;
}): FinalSelectionDecision | null {
  if (input.profile.kind !== "state-behavior") return null;
  const explicitStateLanguage =
    /\b(?:state|store|cache|cached|stale|refresh|reload|restart|rescan|reducer|controller|session|response\s+flow)\b|(?:состояни|кеш|кэш|устаревш|обновлени|перезагруз|перезапуск|повторн\w*\s+скан|контроллер|сесси|ответ\w*\s+поток)/iu.test(
      input.rawTask,
    );
  const visualEmptyState =
    /\bempty\s+state\b|(?:пуст[\p{L}]*\s+состояни|порожн[\p{L}]*\s+стан)/iu.test(
      input.rawTask,
    );
  if (
    input.taskIntent?.structuredIntent.needsStyles === true &&
    (!explicitStateLanguage || visualEmptyState)
  ) {
    return null;
  }

  const inventoryByPath = new Map(
    input.inventory.files.map((file) => [normalizePath(file.path), file]),
  );
  const hintedPaths = uniqueStrings([
    ...(input.taskIntent?.taskUnderstanding.targetHints ?? []),
    ...(input.taskIntent?.structuredIntent.primaryTargets ?? [])
      .map((target) => target.path ?? target.value)
      .filter(Boolean),
  ]).map(normalizePath);
  const selectedUiPaths = input.selectedFiles
    .map((file) => normalizePath(file.path))
    .filter((path) => {
      const inventoryFile = inventoryByPath.get(path);
      return inventoryFile ? isUiFile(inventoryFile) : false;
    });
  const surfaceCandidates = input.inventory.files
    .filter((file) => isUiFile(file) && file.role !== "client-api")
    .map((file) => ({
      file,
      score:
        literalUiSurfaceScore(file, input.rawTask, input.taskIntent) +
        (hintedPaths.includes(normalizePath(file.path)) ? 900 : 0) +
        (selectedUiPaths.includes(normalizePath(file.path)) ? 120 : 0),
    }))
    .filter((item) => item.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.file.path.localeCompare(right.file.path),
    );
  const anchor = surfaceCandidates[0]?.file;
  if (!anchor) return null;

  const backendProtected =
    /(?:do\s+not|don't|without|never|не\s+(?:добав|созд|мен|трог|измен|змін|дода|створ|чіп|редаг)|без\s+(?:нов|змін))/iu.test(
      input.rawTask,
    ) &&
    /(?:backend|server|endpoint|route|storage|database|бэкенд|бекенд|сервер|эндпоинт|маршрут|хранилищ|баз\w*\s+данн)/iu.test(
      input.rawTask,
    );
  const allowed = (file: ProjectInventoryFile) => {
    if (!taskAllowsFileKind(input.profile, file, input.taskIntent)) return false;
    if (
      backendProtected &&
      (isBackendInventoryFile(file) ||
        /(?:^|\/)(?:server|backend)(?:\/|$)/u.test(normalizePath(file.path)))
    ) {
      return false;
    }
    return (
      isUiFile(file) ||
      ["hook", "store", "client-api", "types"].includes(file.role)
    );
  };

  const distance = new Map<string, number>([[normalizePath(anchor.path), 0]]);
  const queue: ProjectInventoryFile[] = [anchor];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentDistance = distance.get(normalizePath(current.path)) ?? 0;
    if (currentDistance >= 3) continue;
    for (const candidate of input.inventory.files) {
      const key = normalizePath(candidate.path);
      if (distance.has(key) || !allowed(candidate)) continue;
      if (
        importsInventoryFile(current, candidate) ||
        importsInventoryFile(candidate, current)
      ) {
        distance.set(key, currentDistance + 1);
        queue.push(candidate);
      }
    }
  }

  const tokens = taskIdentityTokens(input.rawTask, input.taskIntent);
  const localizationBehavior =
    /\b(?:language|locale|translation|translate|i18n|localization)\b|(?:язык|мов\p{L}*|перевод|переклад|локализац)/iu.test(
      input.rawTask,
    );
  const counterBehavior =
    /\b(?:counter|count|metric|stat|statistics)\b|(?:сч[её]тчик|количеств|метрик|статистик)/iu.test(
      input.rawTask,
    );
  const taskCanonical = canonicalIdentifier(input.rawTask);
  const localizationScore = (file: ProjectInventoryFile) => {
    if (!localizationBehavior) return 0;
    const pathText = normalizePath(file.path);
    const hasLocalizationIdentity =
      /(?:^|\/)(?:i18n|locales?|translations?)(?:\/|$)/u.test(pathText) ||
      /(?:i18n|locale|translation)/u.test(
        normalizeIdentifier(
          `${file.name} ${(file.exports ?? []).join(" ")} ${(file.symbols ?? []).join(" ")}`,
        ),
      );
    const hasTranslationFacts =
      (file.semanticFacts?.translationEntries?.length ?? 0) > 0 ||
      (file.semanticFacts?.translationKeys?.length ?? 0) > 0;
    return hasLocalizationIdentity && hasTranslationFacts ? 720 : 0;
  };
  const counterDisplayScore = (file: ProjectInventoryFile) => {
    if (!counterBehavior || !isUiFile(file)) return 0;
    const identity = normalizeIdentifier(
      `${file.path} ${file.name} ${(file.exports ?? []).join(" ")}`,
    );
    const content = canonicalIdentifier(fileSearchText(file));
    const countOwner = /(?:stats?|statistics|metric|count|counter|grid)/u.test(
      identity,
    );
    const taskPackMatch =
      taskCanonical.includes("taskpack") && content.includes("taskpack");
    const entityTokens = tokens
      .map(canonicalIdentifier)
      .filter(
        (token) =>
          token.length >= 5 &&
          !/(?:counter|count|metric|dashboard|state|update|refresh|restart|счетчик|количеств|метрик|панел)/u.test(
            token,
          ),
      );
    const entityMatch = entityTokens.some((token) => content.includes(token));
    return countOwner && (taskPackMatch || entityMatch) ? 980 : 0;
  };
  const rolePriority = (file: ProjectInventoryFile) => {
    if (normalizePath(file.path) === normalizePath(anchor.path)) return 1000;
    if (file.role === "hook" || file.role === "store") return 420;
    if (file.role === "client-api") return 360;
    if (file.role === "types") return 300;
    if (file.role === "page") return 220;
    if (file.role === "component") return 180;
    return 100;
  };
  const candidates = input.inventory.files
    .filter(allowed)
    .filter(
      (file) =>
        distance.has(normalizePath(file.path)) ||
        localizationScore(file) > 0 ||
        counterDisplayScore(file) > 0,
    )
    .map((file) => ({
      file,
      distance: distance.get(normalizePath(file.path)) ?? 4,
      score:
        rolePriority(file) +
        fileIdentityScore(file, tokens) * 4 +
        localizationScore(file) +
        counterDisplayScore(file) -
        (distance.get(normalizePath(file.path)) ?? 4) * 35,
    }))
    .sort(
      (left, right) =>
        right.score - left.score || left.file.path.localeCompare(right.file.path),
    );

  const budget = Math.min(input.maxFiles, input.profile.maxPrimaryFiles, 6);
  const prioritizedCandidates: typeof candidates = [];
  const prioritizedPaths = new Set<string>();
  const addPriority = (candidate: (typeof candidates)[number] | undefined) => {
    if (!candidate) return;
    const key = normalizePath(candidate.file.path);
    if (prioritizedPaths.has(key)) return;
    prioritizedPaths.add(key);
    prioritizedCandidates.push(candidate);
  };
  addPriority(
    candidates.find(
      (candidate) =>
        normalizePath(candidate.file.path) === normalizePath(anchor.path),
    ),
  );
  addPriority(
    candidates.find(
      (candidate) =>
        candidate.file.role === "hook" || candidate.file.role === "store",
    ),
  );
  addPriority(
    candidates.find((candidate) => localizationScore(candidate.file) > 0),
  );
  addPriority(
    candidates.find((candidate) => counterDisplayScore(candidate.file) > 0),
  );
  for (const candidate of candidates) addPriority(candidate);

  const selectedFiles = prioritizedCandidates
    .slice(0, budget)
    .map(({ file, distance }) => {
    const evidence: FileSelectionEvidence = {
      targetSource:
        normalizePath(file.path) === normalizePath(anchor.path)
          ? "user_text"
          : "ranking",
      pathValidity: "inventory_exact",
      ownershipEvidence:
        file.role === "hook" || file.role === "store"
          ? "state_graph"
          : "reference_graph",
      actionConfidence: "inspect_only",
      semanticRoles:
        file.role === "hook" || file.role === "store"
          ? ["state-owner", "reference"]
          : file.role === "client-api"
            ? ["route", "reference"]
            : file.role === "types"
              ? ["contract", "reference"]
              : ["display", "reference"],
      symbols: uniqueStrings(
        [file.name.replace(/\.[^.]+$/u, ""), ...(file.symbols ?? [])],
        8,
      ),
      chain:
        normalizePath(file.path) === normalizePath(anchor.path)
          ? []
          : [
              {
                symbol: anchor.name.replace(/\.[^.]+$/u, ""),
                role: "reference",
                path: anchor.path,
                relatedPath: file.path,
                evidence: "reference_graph",
                relation: "import_graph",
              },
            ],
      negativeConstraintConflicts: [],
      reason:
        normalizePath(file.path) === normalizePath(anchor.path)
          ? "User-named UI surface retained as the investigation anchor."
          : localizationScore(file) > 0
            ? "Localization source-of-truth retained as inspect-only context for the language/reactivity investigation."
            : counterDisplayScore(file) > 0
              ? "Counter display owner retained as inspect-only context for the stale metric investigation."
              : `Connected state-flow context retained at import-graph distance ${distance}; ownership remains unconfirmed.`,
    };
    return {
      path: file.path,
      kind: file.kind,
      usage: "inspect-only" as const,
      reason: evidence.reason,
      confidence: Math.max(0.5, 0.76 - distance * 0.06),
      evidenceLevel: "graph_supported" as const,
      selectionEvidence: evidence,
    };
  });

  if (selectedFiles.length === 0) return null;
  return {
    selectedFiles,
    profile: input.profile,
    deterministicImplementationReady: false,
    canonicalSelectionApplied: true,
    requiredLayersOverride: ["ui", "state"],
    notes: [
      `Canonical investigation anchored the unresolved state-flow at ${anchor.path}.`,
      "Only import-connected UI, state, client-contract, and type context was retained; no file was authorized for editing.",
    ],
  };
}

function evidenceRank(file: SelectedTaskFile) {
  const ownershipRank: Record<string, number> = {
    rank_only: 20,
    model_only: 20,
    content_supported: 80,
    reference_graph: 150,
    route_graph: 260,
    state_graph: 260,
    symbol_exact: 300,
  };
  const actionRank: Record<string, number> = {
    inspect_only: 0,
    inspect_then_edit: 140,
    confirmed_edit: 180,
  };
  const levelRank: Record<string, number> = {
    ranked_candidate: 20,
    model_proposed: 25,
    inventory_exact: 80,
    graph_supported: 180,
    user_confirmed: 400,
  };
  return (
    (ownershipRank[file.selectionEvidence?.ownershipEvidence ?? "rank_only"] ??
      0) +
    (actionRank[file.selectionEvidence?.actionConfidence ?? "inspect_only"] ??
      0) +
    (levelRank[file.evidenceLevel ?? "model_proposed"] ?? 0)
  );
}

function reconcileTraceSelection(input: {
  rawTask: string;
  taskIntent?: TaskIntentAnalysis;
  inventory: ProjectInventory;
  selectedFiles: SelectedTaskFile[];
  trace?: InvestigationTrace;
  contract: TaskExecutionContract;
  profile: TaskSelectionProfile;
  maxFiles: number;
}): FinalSelectionDecision {
  const inventoryByPath = new Map(
    input.inventory.files.map((file) => [normalizePath(file.path), file]),
  );
  const confirmed = new Set(
    (input.trace?.outcome.confirmedOwners ?? []).map(normalizePath),
  );
  const probable = new Set(
    (input.trace?.outcome.probableOwners ?? []).map(normalizePath),
  );
  const references = new Set(
    (input.trace?.outcome.references ?? []).map(normalizePath),
  );
  const structuralEdgeTypes = new Set([
    "imports",
    "imported_by",
    "api_request",
    "route_registration",
    "router_mount",
    "renders_component",
    "passes_prop",
    "receives_prop",
    "state_setter",
    "references_symbol",
    "calls_function",
    "translation_key_use",
    "translation_entry",
  ]);
  const structurallyLinked = new Set<string>();
  for (const edge of input.trace?.edges ?? []) {
    if (!structuralEdgeTypes.has(edge.type)) continue;
    structurallyLinked.add(normalizePath(edge.from));
    structurallyLinked.add(normalizePath(edge.to));
  }
  const traceTriggered = Boolean(input.trace?.triggered);
  const tokens = taskIdentityTokens(input.rawTask, input.taskIntent);
  const maxFiles = Math.max(
    1,
    Math.min(input.maxFiles, input.profile.maxPrimaryFiles),
  );
  const workingSelectedFiles = input.selectedFiles.slice();
  const selectedPathKeys = new Set(
    workingSelectedFiles.map((file) => normalizePath(file.path)),
  );

  const addSupplementalReference = (
    inventoryFile: ProjectInventoryFile | undefined,
    usage: SelectedTaskFileUsage,
    reason: string,
  ) => {
    if (!inventoryFile) return;
    const key = normalizePath(inventoryFile.path);
    if (selectedPathKeys.has(key)) return;
    selectedPathKeys.add(key);
    workingSelectedFiles.push({
      path: inventoryFile.path,
      kind: inventoryFile.kind,
      usage,
      reason,
      confidence: 0.68,
      evidenceLevel: "ranked_candidate",
      selectionEvidence: {
        targetSource: "ranking",
        pathValidity: "inventory_exact",
        ownershipEvidence: "rank_only",
        actionConfidence: "inspect_only",
        semanticRoles: ["reference"],
        symbols: [],
        chain: [],
        negativeConstraintConflicts: [],
        reason,
      },
    });
  };

  const canSupplementSelection =
    workingSelectedFiles.length > 0 &&
    input.contract.unresolvedDecisions.length === 0;

  if (
    canSupplementSelection &&
    input.profile.needsConfigContext &&
    !workingSelectedFiles.some((file) => {
      const inventoryFile = inventoryByPath.get(normalizePath(file.path));
      return inventoryFile
        ? fileMatchesRequiredLayer(inventoryFile, "config")
        : false;
    })
  ) {
    const configCandidate = input.inventory.files
      .filter(
        (file) =>
          taskAllowsFileKind(input.profile, file, input.taskIntent) &&
          fileMatchesRequiredLayer(file, "config"),
      )
      .sort((left, right) => {
        const score = (file: ProjectInventoryFile) => {
          const path = normalizePath(file.path);
          const packagePriority = /(?:^|\/)package\.json$/u.test(path)
            ? 1000
            : 0;
          const rootPriority = path.split("/").length <= 2 ? 120 : 0;
          return (
            packagePriority + rootPriority + fileIdentityScore(file, tokens) * 5
          );
        };
        return score(right) - score(left);
      })[0];
    addSupplementalReference(
      configCandidate,
      "config-reference",
      "Supplemental project configuration retained to ground requested setup, package, or verification commands.",
    );
  }

  if (
    canSupplementSelection &&
    input.profile.needsTestContext &&
    !workingSelectedFiles.some((file) => {
      const inventoryFile = inventoryByPath.get(normalizePath(file.path));
      return inventoryFile
        ? fileMatchesRequiredLayer(inventoryFile, "tests")
        : false;
    })
  ) {
    const testCandidates = input.inventory.files
      .filter(
        (file) =>
          taskAllowsFileKind(input.profile, file, input.taskIntent) &&
          fileMatchesRequiredLayer(file, "tests") &&
          fileIdentityScore(file, tokens) > 0,
      )
      .sort(
        (left, right) =>
          fileIdentityScore(right, tokens) - fileIdentityScore(left, tokens),
      );
    for (const candidate of testCandidates.slice(0, 2)) {
      addSupplementalReference(
        candidate,
        "inspect-only",
        "Supplemental verification context retained because the task changes a tested selector or safety behavior.",
      );
    }
  }

  const requiredLayerCandidateLimit = (layer: TaskExecutionLayer) =>
    layer === "backend" || layer === "tests" ? 2 : 1;
  for (const layer of canSupplementSelection
    ? input.contract.requiredLayers
    : []) {
    const layerCandidates = input.inventory.files
      .filter(
        (file) =>
          taskAllowsFileKind(input.profile, file, input.taskIntent) &&
          fileMatchesRequiredLayer(file, layer) &&
          fileIdentityScore(file, tokens) > 0,
      )
      .sort(
        (left, right) =>
          fileIdentityScore(right, tokens) - fileIdentityScore(left, tokens),
      );
    const strongestIdentity = layerCandidates[0]
      ? fileIdentityScore(layerCandidates[0], tokens)
      : 0;
    for (const [index, candidate] of layerCandidates.entries()) {
      const identity = fileIdentityScore(candidate, tokens);
      if (
        index >= requiredLayerCandidateLimit(layer) ||
        identity < 20 ||
        identity < strongestIdentity * 0.5
      )
        break;
      addSupplementalReference(
        candidate,
        layer === "config" ? "config-reference" : "inspect-only",
        `Supplemental ${layer} context retained because it is strongly linked to the task terms and required execution layer.`,
      );
    }
  }

  const selectedInventoryCandidates = workingSelectedFiles
    .map((file) => ({
      file,
      inventoryFile: inventoryByPath.get(normalizePath(file.path)),
    }))
    .filter(
      (
        item,
      ): item is {
        file: SelectedTaskFile;
        inventoryFile: ProjectInventoryFile;
      } => Boolean(item.inventoryFile),
    );
  const supportLayers: TaskExecutionLayer[] = [
    ...input.contract.requiredLayers,
    ...(input.profile.needsConfigContext &&
    !input.contract.requiredLayers.includes("config")
      ? ["config" as const]
      : []),
    ...(input.profile.needsTestContext &&
    !input.contract.requiredLayers.includes("tests")
      ? ["tests" as const]
      : []),
  ];
  const requiredSupportKeys = new Set<string>();
  for (const layer of supportLayers) {
    const layerCandidates = selectedInventoryCandidates.filter((item) =>
      fileMatchesRequiredLayer(item.inventoryFile, layer),
    );
    const groundedCandidates = layerCandidates.filter(
      (item) =>
        item.file.evidenceLevel === "user_confirmed" ||
        item.file.evidenceLevel === "graph_supported" ||
        item.file.evidenceLevel === "inventory_exact",
    );
    const identityLinkedCandidates = layerCandidates.filter(
      (item) => fileIdentityScore(item.inventoryFile, tokens) > 0,
    );
    const supportPool = layerCandidates.filter(
      (item) =>
        groundedCandidates.includes(item) ||
        identityLinkedCandidates.includes(item),
    );
    const layerRolePriority = (item: {
      inventoryFile: ProjectInventoryFile;
    }) => {
      const role = item.inventoryFile.role.toLocaleLowerCase();
      if (layer === "backend") {
        if (role === "api-route") return 180;
        if (role === "service") return 150;
        if (role === "server-entry") return 90;
        if (role === "repository") return 40;
        if (role === "db-schema") return 0;
      }
      if (layer === "state") {
        if (role === "store" || role === "hook") return 150;
      }
      if (layer === "client-api" && role === "client-api") return 160;
      if (layer === "storage") {
        if (role === "repository") return 160;
        if (role === "db-schema") return 130;
      }
      return 0;
    };
    const sortedSupport = (
      supportPool.length > 0 ? supportPool : layerCandidates
    )
      .slice()
      .sort(
        (left, right) =>
          fileIdentityScore(right.inventoryFile, tokens) * 10 +
          layerRolePriority(right) +
          Math.min(evidenceRank(right.file), 150) -
          (fileIdentityScore(left.inventoryFile, tokens) * 10 +
            layerRolePriority(left) +
            Math.min(evidenceRank(left.file), 150)),
      );
    const strongestIdentity = sortedSupport[0]
      ? fileIdentityScore(sortedSupport[0].inventoryFile, tokens)
      : 0;
    for (const [index, support] of sortedSupport.entries()) {
      const identity = fileIdentityScore(support.inventoryFile, tokens);
      if (
        index > 0 &&
        (index >= 2 || identity < 20 || identity < strongestIdentity * 0.5)
      )
        break;
      requiredSupportKeys.add(normalizePath(support.file.path));
    }
  }
  if (input.profile.kind === "tests") {
    const subjects = selectedInventoryCandidates
      .filter(
        (item) =>
          item.inventoryFile.kind !== "test" &&
          item.inventoryFile.kind !== "config" &&
          item.inventoryFile.kind !== "docs" &&
          fileIdentityScore(item.inventoryFile, tokens) > 0,
      )
      .sort(
        (left, right) =>
          fileIdentityScore(right.inventoryFile, tokens) * 5 +
          evidenceRank(right.file) -
          (fileIdentityScore(left.inventoryFile, tokens) * 5 +
            evidenceRank(left.file)),
      );
    const strongestSubjectIdentity = subjects[0]
      ? fileIdentityScore(subjects[0].inventoryFile, tokens)
      : 0;
    for (const [index, subject] of subjects.entries()) {
      const identity = fileIdentityScore(subject.inventoryFile, tokens);
      if (
        index >= 2 ||
        identity < 20 ||
        identity < strongestSubjectIdentity * 0.5
      )
        break;
      requiredSupportKeys.add(normalizePath(subject.file.path));
    }
  }

  const hasPositiveTraceEvidence =
    confirmed.size > 0 ||
    probable.size > 0 ||
    references.size > 0 ||
    structurallyLinked.size > 0 ||
    requiredSupportKeys.size > 0;
  const fallbackInvestigationKeys = new Set(
    traceTriggered && !hasPositiveTraceEvidence
      ? selectedInventoryCandidates
          .slice()
          .sort(
            (left, right) =>
              evidenceRank(right.file) +
              fileIdentityScore(right.inventoryFile, tokens) -
              (evidenceRank(left.file) +
                fileIdentityScore(left.inventoryFile, tokens)),
          )
          .slice(0, 2)
          .map((item) => normalizePath(item.file.path))
      : [],
  );

  const candidates = workingSelectedFiles
    .map((file) => {
      const key = normalizePath(file.path);
      const inventoryFile = inventoryByPath.get(key);
      if (
        !inventoryFile ||
        !taskAllowsFileKind(input.profile, inventoryFile, input.taskIntent)
      )
        return null;
      const traceEvidence = input.trace?.outcome.evidenceByPath[file.path];
      const traceClassified =
        confirmed.has(key) ||
        probable.has(key) ||
        references.has(key) ||
        structurallyLinked.has(key);
      const hasOnlyGenericFillerConflict = Boolean(
        traceEvidence?.negativeConstraintConflicts.length &&
        traceEvidence.negativeConstraintConflicts.every(
          (conflict) =>
            conflict ===
            "Filler/test/docs/style/config context is reference-only for this task.",
        ),
      );
      const merged: SelectedTaskFile =
        traceEvidence &&
        traceClassified &&
        !(requiredSupportKeys.has(key) && hasOnlyGenericFillerConflict) &&
        evidenceRank({ ...file, selectionEvidence: traceEvidence }) >
          evidenceRank(file)
          ? {
              ...file,
              selectionEvidence: traceEvidence,
              evidenceLevel:
                traceEvidence.actionConfidence === "inspect_then_edit"
                  ? "graph_supported"
                  : file.evidenceLevel,
            }
          : file;
      let score =
        evidenceRank(merged) + fileIdentityScore(inventoryFile, tokens);
      if (confirmed.has(key)) score += 700;
      else if (probable.has(key)) score += 450;
      else if (references.has(key)) score += 180;
      else if (structurallyLinked.has(key)) score += 140;
      if (requiredSupportKeys.has(key)) score += 130;
      if (merged.evidenceLevel === "user_confirmed") score += 700;
      if (merged.selectionEvidence?.negativeConstraintConflicts.length)
        score -= 1000;
      return { file: merged, inventoryFile, key, score };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .filter((item) => {
      if (item.file.evidenceLevel === "user_confirmed") return true;
      if (!traceTriggered) return true;
      if (confirmed.size === 0 && probable.size === 0) {
        return (
          references.has(item.key) ||
          structurallyLinked.has(item.key) ||
          requiredSupportKeys.has(item.key) ||
          fallbackInvestigationKeys.has(item.key) ||
          evidenceRank(item.file) >= 180
        );
      }
      return (
        confirmed.has(item.key) ||
        probable.has(item.key) ||
        references.has(item.key) ||
        structurallyLinked.has(item.key) ||
        requiredSupportKeys.has(item.key)
      );
    })
    .sort((left, right) => right.score - left.score);

  const plannedFiles = workingSelectedFiles.filter(
    (file) =>
      file.usage === "create-and-edit" &&
      !inventoryByPath.has(normalizePath(file.path)),
  );
  const selected: SelectedTaskFile[] = plannedFiles.slice(0, maxFiles);
  const seen = new Set(selected.map((file) => normalizePath(file.path)));

  // Reserve one slot for each required technical layer before filling the
  // remaining budget with higher-scoring trace references. Otherwise a broad
  // import graph can crowd the actual backend/state/config entry point out of
  // the final Task Pack even though the contract explicitly requires it.
  for (const key of requiredSupportKeys) {
    if (selected.length >= maxFiles || seen.has(key)) continue;
    const candidate = candidates.find((item) => item.key === key);
    if (!candidate) continue;
    seen.add(key);
    const investigation = input.contract.mode !== "implementation";
    selected.push({
      ...candidate.file,
      usage: investigation
        ? candidate.file.usage === "asset-reference" ||
          candidate.file.usage === "config-reference"
          ? candidate.file.usage
          : "inspect-only"
        : candidate.file.usage,
      confidence: investigation
        ? Math.min(candidate.file.confidence, 0.68)
        : candidate.file.confidence,
    });
  }

  for (const candidate of candidates) {
    if (selected.length >= maxFiles || seen.has(candidate.key)) continue;
    seen.add(candidate.key);
    const isOwner =
      confirmed.has(candidate.key) ||
      probable.has(candidate.key) ||
      candidate.file.evidenceLevel === "user_confirmed";
    const investigation = input.contract.mode !== "implementation";
    const usage: SelectedTaskFileUsage = investigation
      ? candidate.file.usage === "asset-reference" ||
        candidate.file.usage === "config-reference"
        ? candidate.file.usage
        : "inspect-only"
      : isOwner &&
          candidate.file.selectionEvidence?.actionConfidence ===
            "inspect_then_edit"
        ? "inspect-and-edit"
        : candidate.file.usage;
    selected.push({
      ...candidate.file,
      usage,
      confidence: investigation
        ? Math.min(candidate.file.confidence, 0.68)
        : candidate.file.confidence,
    });
  }

  return {
    selectedFiles: selected,
    profile: input.profile,
    deterministicImplementationReady: false,
    canonicalSelectionApplied: true,
    notes: [
      `Final selection decision used the ${input.profile.kind} task profile and rebuilt the list from current evidence.`,
      traceTriggered
        ? `Trace-governed selection retained ${selected.length} evidence-linked file(s); unlinked ranked/fallback candidates were discarded.`
        : `Selection retained ${selected.length} strongest grounded file(s).`,
    ],
  };
}

interface BoundedTaskSegments {
  change: string;
  preserve: string;
  protectedScope: string;
}

function splitBoundedTaskSegments(rawTask: string): BoundedTaskSegments {
  const preserveMatch = rawTask.match(
    /\b(?:keep|leave|preserve)\b|(?:оставь|сохрани|оставить|сохранить)/iu,
  );
  const protectedMatch = rawTask.match(
    /\b(?:do not change|don't change|dont change|do not touch|without changing)\b|(?:не меняй|не изменяй|не трогай|не менять|не изменять|не трогать)/iu,
  );
  const preserveIndex = preserveMatch?.index ?? rawTask.length;
  const protectedIndex = protectedMatch?.index ?? rawTask.length;
  const changeEnd = Math.min(preserveIndex, protectedIndex);
  const preserveEnd =
    protectedIndex > preserveIndex ? protectedIndex : rawTask.length;
  return {
    change: rawTask.slice(0, changeEnd).trim(),
    preserve:
      preserveIndex < rawTask.length
        ? rawTask.slice(preserveIndex, preserveEnd).trim()
        : "",
    protectedScope:
      protectedIndex < rawTask.length
        ? rawTask.slice(protectedIndex).trim()
        : "",
  };
}

function fileSearchText(file: ProjectInventoryFile) {
  return [
    file.path,
    file.name,
    file.role,
    ...(file.exports ?? []),
    ...(file.symbols ?? []),
    ...(file.textHints ?? []),
    ...(file.semanticFacts?.declarations ?? []),
    ...(file.semanticFacts?.references ?? []),
    ...(file.semanticFacts?.assignments ?? []),
    ...(file.semanticFacts?.objectProperties ?? []),
    ...(file.semanticFacts?.stringLiterals ?? []),
    file.contentPreview ?? "",
  ]
    .join(" ")
    .toLocaleLowerCase();
}

function technicalTaskLiterals(value: string) {
  return uniqueStrings(
    [
      ...(value.match(/[A-Z][A-Z0-9_-]*(?:\.[A-Za-z0-9_-]+)+/g) ?? []),
      ...(value.match(/[«„“"'`]([^»“”"'`\n]{2,120})[»“”"'`]/gu) ?? []).map(
        (item) => item.replace(/^[«„“"'`]|[»“”"'`]$/gu, ""),
      ),
    ],
    8,
  );
}

function structuralUiTerms(value: string) {
  const terms: string[] = [];
  const patterns: Array<[RegExp, string]> = [
    [/\bcard\b|карточк/iu, "card"],
    [/\bmodal\b|модал/iu, "modal"],
    [/\bbutton\b|кнопк/iu, "button"],
    [/\bheader\b|шапк|заголовочн\w*\s+панел/iu, "header"],
    [/\bsidebar\b|боков\w*\s+панел/iu, "sidebar"],
    [/\bform\b|форм/iu, "form"],
    [/\bmenu item\b|пункт\w*\s+меню/iu, "menuitem"],
  ];
  for (const [pattern, term] of patterns)
    if (pattern.test(value)) terms.push(term);
  return terms;
}

function moduleSpecifierResolvesToInventoryFile(
  importer: ProjectInventoryFile,
  specifierRaw: string,
  imported: ProjectInventoryFile,
) {
  const importedBase = normalizePath(imported.path)
    .replace(/\.(?:tsx?|jsx?|mjs|cjs|mts|cts)$/u, "")
    .replace(/\/index$/u, "");
  const importerDir = normalizePath(importer.path)
    .split("/")
    .slice(0, -1)
    .join("/");
  const specifier = specifierRaw
    .replace(/[?#].*$/u, "")
    .replace(/\\/g, "/");
  let resolved = specifier;
  if (specifier.startsWith(".")) {
    const parts = `${importerDir}/${specifier}`.split("/");
    const stack: string[] = [];
    for (const part of parts) {
      if (!part || part === ".") continue;
      if (part === "..") stack.pop();
      else stack.push(part);
    }
    resolved = stack.join("/");
  }
  const normalized = normalizePath(resolved)
    .replace(/\.(?:tsx?|jsx?|mjs|cjs|mts|cts)$/u, "")
    .replace(/\/index$/u, "");
  return normalized === importedBase || importedBase.endsWith(`/${normalized}`);
}

function importsInventoryFile(
  importer: ProjectInventoryFile,
  imported: ProjectInventoryFile,
) {
  return importer.imports.some((specifier) =>
    moduleSpecifierResolvesToInventoryFile(importer, specifier, imported),
  );
}

function boundedUiEvidence(
  file: ProjectInventoryFile,
  role: "owner" | "parent" | "preserve",
  relatedPath?: string,
): FileSelectionEvidence {
  return {
    targetSource: role === "owner" ? "user_text" : "ranking",
    pathValidity: "inventory_exact",
    ownershipEvidence: role === "owner" ? "symbol_exact" : "reference_graph",
    actionConfidence: role === "owner" ? "inspect_then_edit" : "inspect_only",
    semanticRoles:
      role === "owner" ? ["producer", "consumer"] : ["consumer", "reference"],
    symbols: uniqueStrings(
      [file.name.replace(/\.[^.]+$/u, ""), ...(file.symbols ?? [])],
      8,
    ),
    chain: relatedPath
      ? [
          {
            symbol: file.name.replace(/\.[^.]+$/u, ""),
            role: role === "parent" ? "consumer" : "reference",
            path: file.path,
            relatedPath,
            evidence: "reference_graph",
            relation: "import_graph",
          },
        ]
      : [],
    negativeConstraintConflicts: [],
    reason:
      role === "owner"
        ? "The nested UI element named by the change clause is the implementation owner; page/screen names are treated as scope only."
        : role === "preserve"
          ? "Preserved UI surface retained as inspect-only verification context."
          : "Direct UI parent retained to verify the changed child contract and handoff.",
  };
}

function hasContradictoryTaskRequirements(rawTask: string) {
  const destructive =
    /\b(?:remove|delete|eliminate)\b|(?:полностью\s+)?(?:удал|убер|исключ)/iu;
  const preserve =
    /\b(?:keep|leave|retain|preserve|remain|available|without\s+changing\s+behavior)\b|(?:остав|сохран|доступн|без\s+изменени\w*\s+поведени)/iu;
  const connector = /\b(?:but|while|and\s+still)\b|(?:^|[\s,;])(?:но|при\s+этом|однако)(?=$|[\s,;])/iu;
  if (!(destructive.test(rawTask) && preserve.test(rawTask) && connector.test(rawTask))) {
    return false;
  }

  const scopedSurfaceRemoval =
    /(?:\bonly\b[^.!?\n]{0,80}\bfrom\b|только[^.!?\n]{0,80}из)[^.!?\n]{0,100}(?:card|page|screen|component|menu|button|карточк|страниц|экран|компонент|меню|кнопк)[^.!?\n]{0,180}(?:keep|leave|retain|preserve|остав|сохран)[^.!?\n]{0,120}(?:\bon\b|\bin\b|на|в)[^.!?\n]{0,80}(?:card|page|screen|component|menu|button|карточк|страниц|экран|компонент|меню|кнопк)/iu.test(
      rawTask,
    );
  return !scopedSurfaceRemoval;
}

function resolveContradictoryTaskSelection(input: {
  rawTask: string;
  taskIntent?: TaskIntentAnalysis;
  inventory: ProjectInventory;
  selectedFiles: SelectedTaskFile[];
  profile: TaskSelectionProfile;
  maxFiles: number;
}): FinalSelectionDecision | null {
  if (!hasContradictoryTaskRequirements(input.rawTask)) return null;

  const inventoryByPath = new Map(
    input.inventory.files.map((file) => [normalizePath(file.path), file]),
  );
  const hintedPaths = uniqueStrings([
    ...(input.taskIntent?.taskUnderstanding.targetHints ?? []),
    ...(input.taskIntent?.structuredIntent.primaryTargets ?? []).flatMap(
      (target) => [target.path ?? "", target.value],
    ),
  ]);
  const candidates: ProjectInventoryFile[] = [];
  const seen = new Set<string>();
  const addCandidate = (file: ProjectInventoryFile | undefined) => {
    if (!file) return;
    const key = normalizePath(file.path);
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(file);
  };

  for (const hint of hintedPaths) {
    addCandidate(inventoryByPath.get(normalizePath(hint)));
  }
  for (const selected of input.selectedFiles) {
    const file = inventoryByPath.get(normalizePath(selected.path));
    if (!file) continue;
    if (
      selected.selectionEvidence?.targetSource === "user_text" ||
      literalUiSurfaceScore(file, input.rawTask, input.taskIntent) > 0
    ) {
      addCandidate(file);
    }
  }

  const selectedFiles = candidates.slice(0, input.maxFiles).map((file) => {
    const evidence: FileSelectionEvidence = {
      targetSource: "user_text",
      pathValidity: "inventory_exact",
      ownershipEvidence: "content_supported",
      actionConfidence: "inspect_only",
      semanticRoles: ["reference"],
      symbols: uniqueStrings(
        [file.name.replace(/\.[^.]+$/u, ""), ...(file.symbols ?? [])],
        8,
      ),
      chain: [],
      negativeConstraintConflicts: [],
      reason:
        "The named surface is retained only for investigation because the task requirements contradict each other.",
    };
    return {
      path: file.path,
      kind: file.kind,
      usage: "inspect-only" as const,
      reason: evidence.reason,
      confidence: 0.7,
      evidenceLevel: "graph_supported" as const,
      selectionEvidence: evidence,
    };
  });

  const requiredLayersOverride = uniqueStrings(
    candidates
      .map((file) => executionLayerForExplicitTarget(file.path, file))
      .filter((layer): layer is TaskExecutionLayer => Boolean(layer)),
  ) as TaskExecutionLayer[];

  return {
    selectedFiles,
    profile: input.profile,
    deterministicImplementationReady: false,
    canonicalSelectionApplied: true,
    requiredLayersOverride,
    notes: [
      "Canonical decision detected contradictory destructive and preservation requirements.",
      "Named project surfaces remain inspect-only; no edit authorization can be issued until the conflict is resolved.",
    ],
  };
}

function uiSurfaceNames(file: ProjectInventoryFile) {
  const names = uniqueStrings(
    [
      file.name.replace(/\.[^.]+$/u, ""),
      ...(file.exports ?? []),
      ...(file.symbols ?? []).filter((symbol) =>
        /(?:Page|Screen|View|Modal|Card|Section|Panel)$/u.test(symbol),
      ),
    ],
    12,
  );
  return uniqueStrings(
    names.flatMap((name) => {
      const normalized = normalizeIdentifier(name);
      const withoutSuffix = normalized.replace(
        /\s+(?:page|screen|view|modal|card|section|panel)$/u,
        "",
      );
      return [normalized, withoutSuffix];
    }),
    20,
  ).filter((name) => name.length >= 4);
}

function literalUiSurfaceScore(
  file: ProjectInventoryFile,
  rawTask: string,
  taskIntent?: TaskIntentAnalysis,
) {
  if (!isUiFile(file)) return 0;
  const raw = normalizeIdentifier(rawTask);
  const rawCanonical = canonicalIdentifier(rawTask);
  const names = uiSurfaceNames(file);
  const fullStem = normalizeIdentifier(file.name.replace(/\.[^.]+$/u, ""));
  const fullCanonical = canonicalIdentifier(fullStem);
  const pageContext =
    /\b(?:page|screen|view)\b|(?:страниц|сторінц|экран)/iu.test(rawTask);
  const explicitComponentContext =
    /\b(?:component|modal|card|section|panel|button|control)\b|(?:компонент|модал|карточк|секци|раздел|панел|кнопк|элемент\w*\s+управлен)/iu.test(
      rawTask,
    );
  const primaryPaths = new Set(
    (taskIntent?.structuredIntent.primaryTargets ?? [])
      .map((target) => normalizePath(target.path ?? ""))
      .filter(Boolean),
  );
  const isPrimaryPath = primaryPaths.has(normalizePath(file.path));
  let score = 0;
  if (fullCanonical.length >= 6 && rawCanonical.includes(fullCanonical)) {
    score += 900;
  }
  for (const name of names) {
    const canonical = canonicalIdentifier(name);
    if (canonical.length < 5 || !rawCanonical.includes(canonical)) continue;
    const hasSurfaceSuffix = /\s(?:page|screen|view|modal|card|section|panel)$/u.test(
      fullStem,
    );
    const surfaceContext = pageContext || explicitComponentContext || isPrimaryPath;
    if (hasSurfaceSuffix && surfaceContext) score += 520;
    else if (name === fullStem) score += 420;
    else if (surfaceContext) score += 240;
  }
  if (isPrimaryPath && score > 0) score += 260;
  const targetHints = new Set(
    (taskIntent?.taskUnderstanding.targetHints ?? [])
      .map(normalizePath)
      .filter((value) => value.includes("/")),
  );
  if (targetHints.has(normalizePath(file.path)) && score > 0) score += 120;
  if (file.role === "page" && pageContext && score > 0) score += 80;
  if (raw.includes(" only ") || /(?:только|лише)/iu.test(rawTask)) score += 20;
  return score;
}

function resolveLiteralUiSurfaceSelection(input: {
  rawTask: string;
  taskIntent?: TaskIntentAnalysis;
  inventory: ProjectInventory;
  selectedFiles: SelectedTaskFile[];
  profile: TaskSelectionProfile;
  maxFiles: number;
}): FinalSelectionDecision | null {
  const backendMutationProtected =
    /(?:do\s+not|don't|should\s+not|must\s+not|without|не\s+(?:мен|трог|измен|добав|созд|змін|дода|створ|чіп|редаг)|без\s+(?:нов|змін))/iu.test(
      input.rawTask,
    ) &&
    /(?:backend|server|api|route|endpoint|бэкенд|бекенд|сервер|апи|маршрут|эндпоинт)/iu.test(
      input.rawTask,
    );
  if (input.profile.kind === "state-behavior") return null;
  if (
    (input.profile.kind === "fullstack-feature" ||
      input.taskIntent?.structuredIntent.needsBackend === true) &&
    !backendMutationProtected
  ) {
    return null;
  }
  if (hasContradictoryTaskRequirements(input.rawTask)) return null;
  const conditionalCreateOrEdit =
    /(?:if[^.!?]{0,100}(?:exist|already)[^.!?]{0,120}(?:improve|edit|update)[^.!?]{0,120}(?:if not|otherwise)[^.!?]{0,80}create)|(?:если[^.!?]{0,100}(?:есть|существ)[^.!?]{0,120}(?:улучш|измени|обнов)[^.!?]{0,120}(?:если нет|иначе)[^.!?]{0,80}созд)/iu.test(
      input.rawTask,
    );
  if (
    conditionalCreateOrEdit ||
    (input.taskIntent?.structuredIntent.ambiguities.length ?? 0) > 0
  ) {
    return null;
  }
  const understanding = input.taskIntent?.taskUnderstanding;
  const concrete =
    understanding?.changeDefinition === "exact" ||
    understanding?.changeDefinition === "bounded" ||
    understanding?.reviewStatus === "accepted";
  if (!concrete) return null;

  const candidates = input.inventory.files
    .map((file) => ({
      file,
      score: literalUiSurfaceScore(file, input.rawTask, input.taskIntent),
    }))
    .filter((item) => item.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.file.path.localeCompare(right.file.path),
    );
  const owner = candidates[0];
  const second = candidates[1];
  if (!owner || (second && owner.score - second.score < 120)) return null;

  const ownerEvidence: FileSelectionEvidence = {
    targetSource: "user_text",
    pathValidity: "inventory_exact",
    ownershipEvidence: "symbol_exact",
    actionConfidence: "confirmed_edit",
    semanticRoles: ["display", "producer"],
    symbols: uniqueStrings(
      [owner.file.name.replace(/\.[^.]+$/u, ""), ...(owner.file.exports ?? [])],
      8,
    ),
    chain: [],
    negativeConstraintConflicts: [],
    reason:
      "The user literally named this concrete UI surface and the requested mutation is bounded to that surface.",
  };
  const selected: SelectedTaskFile[] = [
    {
      path: owner.file.path,
      kind: owner.file.kind,
      usage: "inspect-and-edit",
      reason: ownerEvidence.reason,
      confidence: 0.97,
      evidenceLevel: "user_confirmed",
      selectionEvidence: ownerEvidence,
    },
  ];

  const asksExistingApi =
    /(?:existing|already|reuse|use\s+the|существующ|уже|використовуючи\s+вже)[^.!?\n]{0,100}(?:api|client|request|endpoint|status)|(?:api|client|request|endpoint|status)[^.!?\n]{0,100}(?:existing|already|reuse|существующ|уже)/iu.test(
      input.rawTask,
    );
  if (asksExistingApi && selected.length < input.maxFiles) {
    const apiReference = input.inventory.files
      .filter((file) => file.path !== owner.file.path)
      .filter(
        (file) =>
          file.role === "client-api" ||
          /(?:^|\/)api\/client\.[cm]?[jt]sx?$/u.test(normalizePath(file.path)),
      )
      .filter((file) => importsInventoryFile(owner.file, file))
      .sort((left, right) => left.path.localeCompare(right.path))[0];
    if (apiReference) {
      const evidence: FileSelectionEvidence = {
        targetSource: "ranking",
        pathValidity: "inventory_exact",
        ownershipEvidence: "reference_graph",
        actionConfidence: "inspect_only",
        semanticRoles: ["contract", "reference"],
        symbols: uniqueStrings(apiReference.exports ?? [], 8),
        chain: [
          {
            symbol: owner.file.name.replace(/\.[^.]+$/u, ""),
            role: "consumer",
            path: owner.file.path,
            relatedPath: apiReference.path,
            evidence: "reference_graph",
            relation: "import_graph",
          },
        ],
        negativeConstraintConflicts: [],
        reason:
          "Existing client API dependency retained as inspect-only context; the task does not authorize changing it.",
      };
      selected.push({
        path: apiReference.path,
        kind: apiReference.kind,
        usage: "inspect-only",
        reason: evidence.reason,
        confidence: 0.82,
        evidenceLevel: "graph_supported",
        selectionEvidence: evidence,
      });
    }
  }

  const selectedPathSet = new Set(selected.map((file) => normalizePath(file.path)));
  const protectsBackend = backendMutationProtected;
  const taskTokens = taskIdentityTokens(input.rawTask);
  const normalizedTaskTokens = new Set(
    taskIdentityTokens(input.rawTask).map((token) =>
      token.length > 4 && token.endsWith("s") ? token.slice(0, -1) : token,
    ),
  );
  const isNamedVisualDependency = (file: ProjectInventoryFile) => {
    if (
      input.taskIntent?.structuredIntent.needsStyles !== true ||
      file.role !== "component"
    ) {
      return false;
    }
    const identityTokens = taskIdentityTokens(
      [file.name.replace(/\.[^.]+$/u, ""), ...(file.symbols ?? [])].join(" "),
    ).map((token) =>
      token.length > 4 && token.endsWith("s") ? token.slice(0, -1) : token,
    );
    return (
      identityTokens.length > 0 &&
      identityTokens.every((token) => normalizedTaskTokens.has(token))
    );
  };
  const directDependencies = input.inventory.files
    .filter((file) => !selectedPathSet.has(normalizePath(file.path)))
    .filter((file) => importsInventoryFile(owner.file, file))
    .filter(
      (file) =>
        !(
          protectsBackend &&
          (/(?:^|\/)(?:server|backend)(?:\/|$)/u.test(
            normalizePath(file.path),
          ) ||
            file.role === "client-api" ||
            /(?:^|\/)api\/client\.[cm]?[jt]sx?$/u.test(
              normalizePath(file.path),
            ))
        ),
    )
    .map((inventoryFile) => {
      const selectedFile = input.selectedFiles.find(
        (file) => normalizePath(file.path) === normalizePath(inventoryFile.path),
      );
      let score = fileIdentityScore(inventoryFile, taskTokens);
      if (selectedFile) score += 35;
      if (inventoryFile.role === "component") score += 45;
      if (isNamedVisualDependency(inventoryFile)) score += 180;
      if (inventoryFile.role === "hook") score += 30;
      if (inventoryFile.role === "client-api") score += asksExistingApi ? 40 : 15;
      if (inventoryFile.kind === "style" || inventoryFile.role === "style") {
        score += input.taskIntent?.structuredIntent.needsStyles ? 35 : 5;
      }
      return { selected: selectedFile, inventory: inventoryFile, score };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.inventory.path.localeCompare(right.inventory.path),
    )
    .slice(
      0,
      Math.max(
        0,
        Math.min(
          input.taskIntent?.structuredIntent.needsStyles === true ? 6 : 2,
          input.maxFiles - selected.length,
        ),
      ),
    );
  for (const dependency of directDependencies) {
    if (selectedPathSet.has(normalizePath(dependency.inventory.path))) continue;
    const namedVisualOwner = isNamedVisualDependency(dependency.inventory);
    const evidence: FileSelectionEvidence = {
      targetSource: namedVisualOwner ? "user_text" : "ranking",
      pathValidity: "inventory_exact",
      ownershipEvidence: namedVisualOwner ? "symbol_exact" : "reference_graph",
      actionConfidence: namedVisualOwner ? "inspect_then_edit" : "inspect_only",
      semanticRoles: namedVisualOwner
        ? ["producer", "display"]
        : ["consumer", "reference"],
      symbols: uniqueStrings(
        [
          dependency.inventory.name.replace(/\.[^.]+$/u, ""),
          ...(dependency.inventory.exports ?? []),
        ],
        8,
      ),
      chain: [
        {
          symbol: owner.file.name.replace(/\.[^.]+$/u, ""),
          role: "consumer",
          path: owner.file.path,
          relatedPath: dependency.inventory.path,
          evidence: "reference_graph",
          relation: "import_graph",
        },
      ],
      negativeConstraintConflicts: [],
      reason: namedVisualOwner
        ? "The user-named visual element is implemented by this directly imported component."
        : "Semantic graph support: direct dependency of the named UI surface retained as inspect-only verification context.",
    };
    selected.push({
      path: dependency.inventory.path,
      kind: dependency.inventory.kind,
      usage: namedVisualOwner ? "inspect-and-edit" : "inspect-only",
      reason: evidence.reason,
      confidence: namedVisualOwner ? 0.9 : 0.78,
      evidenceLevel: "graph_supported",
      selectionEvidence: evidence,
    });
    selectedPathSet.add(normalizePath(dependency.inventory.path));
  }

  if (
    input.taskIntent?.structuredIntent.needsStyles === true &&
    selected.length < input.maxFiles &&
    !selected.some((file) => {
      const inventoryFile = input.inventory.files.find(
        (candidate) => normalizePath(candidate.path) === normalizePath(file.path),
      );
      return inventoryFile?.kind === "style" || inventoryFile?.role === "style";
    })
  ) {
    const styleCandidate = input.inventory.files
      .filter((file) => file.kind === "style" || file.role === "style")
      .map((file) => ({
        file,
        score: fileIdentityScore(file, taskTokens),
      }))
      .filter((item) => item.score > 0)
      .sort(
        (left, right) =>
          right.score - left.score || left.file.path.localeCompare(right.file.path),
      )[0]?.file;
    if (styleCandidate) {
      const evidence: FileSelectionEvidence = {
        targetSource: "ranking",
        pathValidity: "inventory_exact",
        ownershipEvidence: "content_supported",
        actionConfidence: "inspect_then_edit",
        semanticRoles: ["display", "producer"],
        symbols: [],
        chain: [],
        negativeConstraintConflicts: [],
        reason:
          "Visual task requires the stylesheet most strongly linked to the user-named UI surface.",
      };
      selected.push({
        path: styleCandidate.path,
        kind: styleCandidate.kind,
        usage: "inspect-and-edit",
        reason: evidence.reason,
        confidence: 0.82,
        evidenceLevel: "graph_supported",
        selectionEvidence: evidence,
      });
    }
  }

  return {
    selectedFiles: selected.slice(0, input.maxFiles),
    profile: input.profile,
    deterministicImplementationReady: true,
    canonicalSelectionApplied: true,
    requiredLayersOverride: ["ui"],
    notes: [
      `Canonical decision grounded the user-named UI surface ${owner.file.path}.`,
      selected.length > 1
        ? "Existing dependencies remain inspect-only supporting context."
        : "No additional edit target was inferred beyond the named UI surface.",
    ],
  };
}

function resolveBoundedUiSelection(input: {
  rawTask: string;
  taskIntent?: TaskIntentAnalysis;
  inventory: ProjectInventory;
  selectedFiles: SelectedTaskFile[];
  profile: TaskSelectionProfile;
  maxFiles: number;
}): FinalSelectionDecision | null {
  const segments = splitBoundedTaskSegments(input.rawTask);
  const structuralTerms = structuralUiTerms(segments.change);
  if (structuralTerms.length === 0) return null;
  const literals = technicalTaskLiterals(segments.change);
  const actionTokens = uniqueStrings(
    normalizeIdentifier(segments.change)
      .split(/\s+/u)
      .filter((token) =>
        /^(?:generate|create|open|remove|delete|add|hide|show|генер|созд|откр|убер|удал|добав|скры|показ)/iu.test(
          token,
        ),
      ),
    6,
  );
  const literalStems = literals
    .map((literal) => canonicalIdentifier(literal.replace(/\.[^.]+$/u, "")))
    .filter(Boolean);
  const changeTokens = taskIdentityTokens(segments.change);
  const preserveTokens = taskIdentityTokens(segments.preserve);
  const preserveIdentityTokens = uniqueStrings(
    [
      ...preserveTokens,
      ...(/детал/iu.test(segments.preserve) ? ["detail", "details"] : []),
      ...(input.taskIntent?.taskUnderstanding.targetHints ?? []).filter(
        (value) => /detail|детал/iu.test(value),
      ),
      ...(input.taskIntent?.structuredIntent.primaryTargets
        .flatMap((target) => [target.value, target.name ?? ""])
        .filter((value) => /detail|детал/iu.test(value)) ?? []),
    ]
      .map((value) => normalizeIdentifier(value))
      .flatMap((value) => value.split(/\s+/u))
      .filter((value) => value.length >= 5),
    12,
  );
  const selectedPaths = new Set(
    input.selectedFiles.map((file) => normalizePath(file.path)),
  );
  const selectedByPath = new Map(
    input.selectedFiles.map((file) => [normalizePath(file.path), file]),
  );
  const primaryTargetPaths = new Set(
    (input.taskIntent?.structuredIntent.primaryTargets ?? [])
      .filter((target) => target.path)
      .map((target) => normalizePath(target.path!)),
  );
  const protectedBackend =
    /\b(?:backend|server|api)\b|(?:бэкенд|бекенд|сервер|апи)/iu.test(
      segments.protectedScope,
    );

  const scored = input.inventory.files
    .filter(
      (file) =>
        isUiFile(file) &&
        taskAllowsFileKind(input.profile, file, input.taskIntent),
    )
    .filter(
      (file) =>
        !(
          protectedBackend &&
          /(?:^|\/)(?:server|backend)(?:\/|$)|\/api\//u.test(
            normalizePath(file.path),
          )
        ),
    )
    .map((file) => {
      const text = fileSearchText(file);
      const identity = normalizeIdentifier(
        `${file.path} ${file.name} ${file.role} ${(file.exports ?? []).join(" ")}`,
      );
      const structureScore = structuralTerms.reduce(
        (score, term) => score + (identity.includes(term) ? 220 : 0),
        0,
      );
      const literalScore = literals.reduce((score, literal) => {
        const canonical = canonicalIdentifier(literal);
        return (
          score +
          (canonical && canonicalIdentifier(text).includes(canonical) ? 150 : 0)
        );
      }, 0);
      const tokenScore = changeTokens.reduce(
        (score, token) =>
          score + (normalizeIdentifier(text).includes(token) ? 12 : 0),
        0,
      );
      const actionLiteralBindingScore = (
        file.semanticFacts?.references ?? []
      ).reduce((score, reference) => {
        const canonicalReference = canonicalIdentifier(reference);
        const bindsAction = actionTokens.some((action) =>
          canonicalReference.includes(canonicalIdentifier(action)),
        );
        const bindsLiteral = literalStems.some((literal) =>
          canonicalReference.includes(literal),
        );
        return score + (bindsAction && bindsLiteral ? 220 : 0);
      }, 0);
      const preserveScore = preserveTokens.reduce(
        (score, token) =>
          score + (normalizeIdentifier(text).includes(token) ? 18 : 0),
        0,
      );
      const selectedFile = selectedByPath.get(normalizePath(file.path));
      const primaryTargetScore = primaryTargetPaths.has(
        normalizePath(file.path),
      )
        ? 900
        : 0;
      const literalSurfaceScore = literalUiSurfaceScore(
        file,
        input.rawTask,
        input.taskIntent,
      );
      const score =
        structureScore +
        literalScore +
        tokenScore +
        actionLiteralBindingScore +
        primaryTargetScore +
        literalSurfaceScore -
        preserveScore +
        (selectedPaths.has(normalizePath(file.path)) ? 35 : 0) +
        (selectedFile?.usage === "inspect-and-edit" ||
        selectedFile?.usage === "create-and-edit"
          ? 90
          : 0);
      return {
        file,
        score,
        structureScore,
        literalScore,
        actionLiteralBindingScore,
        preserveScore,
        primaryTargetScore,
        literalSurfaceScore,
      };
    })
    .filter(
      (item) =>
        (item.structureScore > 0 &&
          (item.literalScore > 0 || item.score >= 240)) ||
        (item.primaryTargetScore > 0 && item.literalSurfaceScore > 0),
    )
    .sort((left, right) => right.score - left.score);

  const owner = scored[0];
  const second = scored[1];
  if (
    !owner ||
    (second &&
      owner.score - second.score < 45 &&
      owner.primaryTargetScore === 0)
  ) {
    return null;
  }

  const parent = input.inventory.files
    .filter((file) => file.path !== owner.file.path && isUiFile(file))
    .filter((file) => importsInventoryFile(file, owner.file))
    .map((file) => ({ file, score: fileIdentityScore(file, changeTokens) }))
    .sort((left, right) => right.score - left.score)[0]?.file;

  const preserve = segments.preserve
    ? input.inventory.files
        .filter(
          (file) =>
            file.path !== owner.file.path &&
            file.path !== parent?.path &&
            isUiFile(file),
        )
        .map((file) => {
          const text = normalizeIdentifier(fileSearchText(file));
          const identity = normalizeIdentifier(
            `${file.path} ${file.name} ${(file.exports ?? []).join(" ")}`,
          );
          const tokenScore = preserveTokens.reduce(
            (score, token) => score + (text.includes(token) ? 24 : 0),
            0,
          );
          const identityScore = preserveIdentityTokens.reduce(
            (score, token) => score + (identity.includes(token) ? 90 : 0),
            0,
          );
          const literalScore = literals.reduce(
            (score, literal) =>
              score +
              (canonicalIdentifier(text).includes(canonicalIdentifier(literal))
                ? 80
                : 0),
            0,
          );
          return {
            file,
            score: tokenScore + identityScore + literalScore,
            identityScore,
            literalScore,
          };
        })
        .filter((item) => item.identityScore > 0 && item.literalScore > 0)
        .sort((left, right) => right.score - left.score)[0]?.file
    : undefined;

  const ownerEvidence = boundedUiEvidence(owner.file, "owner");
  const selected: SelectedTaskFile[] = [
    {
      path: owner.file.path,
      kind: owner.file.kind,
      usage: "inspect-and-edit",
      reason: ownerEvidence.reason,
      confidence: 0.9,
      evidenceLevel: "graph_supported",
      selectionEvidence: ownerEvidence,
    },
  ];
  if (parent) {
    const evidence = boundedUiEvidence(parent, "parent", owner.file.path);
    selected.push({
      path: parent.path,
      kind: parent.kind,
      usage: "inspect-only",
      reason: evidence.reason,
      confidence: 0.82,
      evidenceLevel: "graph_supported",
      selectionEvidence: evidence,
    });
  }
  const asksExistingApi =
    /(?:existing|already|reuse|use\s+the|существующ|уже|використовуючи\s+вже)[^.!?\n]{0,100}(?:api|client|request|endpoint|status)|(?:api|client|request|endpoint|status)[^.!?\n]{0,100}(?:existing|already|reuse|существующ|уже)/iu.test(
      input.rawTask,
    );
  if (
    asksExistingApi &&
    selected.length < Math.min(input.maxFiles, input.profile.maxPrimaryFiles)
  ) {
    const apiReference = input.inventory.files
      .filter(
        (file) =>
          file.role === "client-api" ||
          /(?:^|\/)api\/client\.[cm]?[jt]sx?$/u.test(normalizePath(file.path)),
      )
      .filter((file) => importsInventoryFile(owner.file, file))
      .sort((left, right) => left.path.localeCompare(right.path))[0];
    if (
      apiReference &&
      !selected.some(
        (file) => normalizePath(file.path) === normalizePath(apiReference.path),
      )
    ) {
      const evidence: FileSelectionEvidence = {
        targetSource: "ranking",
        pathValidity: "inventory_exact",
        ownershipEvidence: "reference_graph",
        actionConfidence: "inspect_only",
        semanticRoles: ["contract", "reference"],
        symbols: uniqueStrings(apiReference.exports ?? [], 8),
        chain: [
          {
            symbol: owner.file.name.replace(/\.[^.]+$/u, ""),
            role: "consumer",
            path: owner.file.path,
            relatedPath: apiReference.path,
            evidence: "reference_graph",
            relation: "import_graph",
          },
        ],
        negativeConstraintConflicts: [],
        reason:
          "Existing client API dependency retained as inspect-only context; protected backend creation is not authorized.",
      };
      selected.push({
        path: apiReference.path,
        kind: apiReference.kind,
        usage: "inspect-only",
        reason: evidence.reason,
        confidence: 0.82,
        evidenceLevel: "graph_supported",
        selectionEvidence: evidence,
      });
    }
  }

  if (
    preserve &&
    selected.length < Math.min(input.maxFiles, input.profile.maxPrimaryFiles)
  ) {
    const evidence = boundedUiEvidence(preserve, "preserve", owner.file.path);
    selected.push({
      path: preserve.path,
      kind: preserve.kind,
      usage: "inspect-only",
      reason: evidence.reason,
      confidence: 0.8,
      evidenceLevel: "graph_supported",
      selectionEvidence: evidence,
    });
  }

  return {
    selectedFiles: selected.slice(
      0,
      Math.min(input.maxFiles, input.profile.maxPrimaryFiles),
    ),
    profile: input.profile,
    deterministicImplementationReady: true,
    canonicalSelectionApplied: true,
    requiredLayersOverride: ["ui"],
    notes: [
      `Final selection separated the nested UI target from its page/screen scope; ${owner.file.path} owns the requested change.`,
      ...(preserve
        ? [
            `Preserved surface retained as verification context: ${preserve.path}.`,
          ]
        : []),
      ...(protectedBackend
        ? [
            "Backend/server files were excluded by the user's protected-scope constraint.",
          ]
        : []),
    ],
  };
}

function structuredSourceValues(rawTask: string) {
  const values: string[] = [];
  const shortcut =
    /(?:Ctrl|Control|Cmd|Command|Meta|Alt|Shift)(?:\s*\+\s*(?:Ctrl|Control|Cmd|Command|Meta|Alt|Shift|[A-Za-z0-9,.;/\\-]))+/giu;
  const shortcuts = rawTask.match(shortcut) ?? [];
  if (shortcuts.length >= 2) values.push(shortcuts[0]!);
  for (const match of rawTask.matchAll(
    /\bfrom\s+([^,.;!?\n]{1,80}?)\s+to\s+([^,.;!?\n]{1,80})|(?:^|[\s,:;])(?:с|из)\s+([^,.;!?\n]{1,80}?)\s+на\s+([^,.;!?\n]{1,80})/giu,
  )) {
    values.push(match[1] ?? match[3] ?? "");
  }
  return uniqueStrings(values.map((value) => value.trim().replace(/\s+/g, " ")), 6);
}

function resolveStructuredValueSelection(input: {
  rawTask: string;
  taskIntent?: TaskIntentAnalysis;
  inventory: ProjectInventory;
  profile: TaskSelectionProfile;
  maxFiles: number;
}): FinalSelectionDecision | null {
  const sourceValues = structuredSourceValues(input.rawTask);
  const primaryPaths = new Set(
    (input.taskIntent?.structuredIntent.primaryTargets ?? [])
      .map((target) => normalizePath(target.path ?? ""))
      .filter(Boolean),
  );
  const hintedPaths = new Set(
    (input.taskIntent?.taskUnderstanding.targetHints ?? [])
      .map(normalizePath)
      .filter((value) => value.includes("/")),
  );
  const taskTokens = taskIdentityTokens(input.rawTask);

  const sourceCandidates = input.inventory.files
    .filter(
      (file) =>
        file.canReadText &&
        taskAllowsFileKind(input.profile, file, input.taskIntent),
    )
    .map((file) => {
      const corpus = canonicalIdentifier(
        [
          file.contentPreview ?? "",
          ...(file.semanticFacts?.stringLiterals ?? []),
          ...(file.textHints ?? []),
        ].join(" "),
      );
      const matchedValues = sourceValues.filter((value) =>
        corpus.includes(canonicalIdentifier(value)),
      );
      let score = matchedValues.length * 420;
      score += fileIdentityScore(file, taskTokens) * 3;
      score += behavioralOwnerScore(file, input.rawTask);
      if (primaryPaths.has(normalizePath(file.path))) score += 280;
      if (hintedPaths.has(normalizePath(file.path))) score += 160;
      return { file, matchedValues, score };
    })
    .filter((item) => item.matchedValues.length > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.file.path.localeCompare(right.file.path),
    );

  let owner: ProjectInventoryFile | undefined = sourceCandidates[0]?.file;
  const secondSource = sourceCandidates[1];
  if (
    owner &&
    secondSource &&
    sourceCandidates[0]!.score - secondSource.score < 50
  ) {
    owner = undefined;
  }

  if (!owner) {
    const groundedPaths = uniqueStrings([
      ...(input.taskIntent?.structuredIntent.primaryTargets ?? [])
        .filter((target) => target.path)
        .map((target) => target.path!),
      ...(input.taskIntent?.taskUnderstanding.targetHints ?? []).filter(
        (value) => value.includes("/"),
      ),
    ]);
    const groundedCandidates = groundedPaths
      .map((path) =>
        input.inventory.files.find(
          (file) => normalizePath(file.path) === normalizePath(path),
        ),
      )
      .filter((file): file is ProjectInventoryFile => Boolean(file))
      .filter((file) =>
        /(?:shortcut|hotkey|keyboard|keybind|setting|config)/iu.test(
          `${file.path} ${file.name} ${(file.exports ?? []).join(" ")} ${(file.symbols ?? []).join(" ")}`,
        ),
      );
    if (groundedCandidates.length === 1) owner = groundedCandidates[0]!;
  }

  if (!owner) return null;

  const ownerEvidence: FileSelectionEvidence = {
    targetSource: "ranking",
    pathValidity: "inventory_exact",
    ownershipEvidence: "symbol_exact",
    actionConfidence: "confirmed_edit",
    semanticRoles: ["contract", "producer"],
    symbols: uniqueStrings(
      [owner.name.replace(/\.[^.]+$/u, ""), ...(owner.symbols ?? [])],
      8,
    ),
    chain: [],
    negativeConstraintConflicts: [],
    reason:
      sourceValues.length > 0
        ? "The real file contains the current structured value and semantically owns the requested setting."
        : "The real configuration owner is uniquely grounded by the structured setting and repository metadata.",
  };
  const selected: SelectedTaskFile[] = [
    {
      path: owner.path,
      kind: owner.kind,
      usage: "inspect-and-edit",
      reason: ownerEvidence.reason,
      confidence: 0.94,
      evidenceLevel: "graph_supported",
      selectionEvidence: ownerEvidence,
    },
  ];

  const consumers = input.inventory.files
    .filter(
      (file) =>
        file.path !== owner.path &&
        taskAllowsFileKind(input.profile, file, input.taskIntent),
    )
    .filter((file) => importsInventoryFile(file, owner))
    .map((file) => ({
      file,
      score:
        fileIdentityScore(file, taskTokens) +
        (file.role === "hook" ? 120 : file.role === "component" ? 60 : 0),
    }))
    .sort(
      (left, right) =>
        right.score - left.score || left.file.path.localeCompare(right.file.path),
    )
    .slice(0, 2);
  for (const consumer of consumers) {
    const evidence: FileSelectionEvidence = {
      targetSource: "ranking",
      pathValidity: "inventory_exact",
      ownershipEvidence: "reference_graph",
      actionConfidence: "inspect_only",
      semanticRoles: ["consumer", "reference"],
      symbols: uniqueStrings(
        [consumer.file.name.replace(/\.[^.]+$/u, ""), ...(consumer.file.symbols ?? [])],
        8,
      ),
      chain: [
        {
          symbol: owner.name.replace(/\.[^.]+$/u, ""),
          role: "consumer",
          path: consumer.file.path,
          relatedPath: owner.path,
          evidence: "reference_graph",
          relation: "import_graph",
        },
      ],
      negativeConstraintConflicts: [],
      reason:
        "Direct consumer retained as inspect-only verification context; only the structured value owner is authorized.",
    };
    selected.push({
      path: consumer.file.path,
      kind: consumer.file.kind,
      usage: "inspect-only",
      reason: evidence.reason,
      confidence: 0.8,
      evidenceLevel: "graph_supported",
      selectionEvidence: evidence,
    });
  }

  return {
    selectedFiles: selected.slice(
      0,
      Math.min(input.maxFiles, input.profile.maxPrimaryFiles),
    ),
    profile: input.profile,
    deterministicImplementationReady: true,
    canonicalSelectionApplied: true,
    requiredLayersOverride: [
      executionLayerForExplicitTarget(owner.path, owner) ??
        (/(?:^|\/)renderer\//u.test(normalizePath(owner.path))
          ? "ui"
          : "config"),
    ],
    notes: [
      `Final selection used code-grounded structured-value ownership: ${owner.path}.`,
      "Consumers remain inspect-only unless a separate hard-coded value is proven.",
    ],
  };
}

function isJavaScriptTypeScriptInventoryFile(file: ProjectInventoryFile) {
  return /\.(?:tsx?|jsx?|mjs|cjs|mts|cts)$/iu.test(file.path);
}

function parserBackedSymbolDeclarations(file: ProjectInventoryFile) {
  const syntax = file.semanticFacts?.symbolSyntax;
  if (isJavaScriptTypeScriptInventoryFile(file)) {
    return syntax?.declarations ?? [];
  }
  return [
    ...(file.semanticFacts?.declarations ?? []),
    ...(file.exports ?? []),
    ...(file.symbols ?? []),
  ];
}

function parserBackedSymbolReferences(file: ProjectInventoryFile) {
  const syntax = file.semanticFacts?.symbolSyntax;
  if (isJavaScriptTypeScriptInventoryFile(file)) {
    return syntax?.references ?? [];
  }
  return file.semanticFacts?.references ?? [];
}

function symbolRenameRequiredLayers(
  rawTask: string,
  declarationFiles: ProjectInventoryFile[],
): TaskExecutionLayer[] {
  if (declarationFiles.length > 0) {
    const allUi = declarationFiles.every((file) => {
      const normalized = normalizePath(file.path);
      return (
        isUiFile(file) ||
        /(?:^|\/)(?:renderer|frontend|client)(?:\/|$)/u.test(normalized)
      );
    });
    if (allUi) return ["ui"];

    const allBackend = declarationFiles.every((file) => {
      const normalized = normalizePath(file.path);
      return (
        /(?:^|\/)(?:server|backend)(?:\/|$)/u.test(normalized) ||
        ["api-route", "server-entry", "service", "repository"].includes(
          file.role,
        )
      );
    });
    if (allBackend) return ["backend"];
  }

  const protectsBackend =
    /\b(?:do not|don't|without)\b[^.!?\n]{0,120}\bbackend\b|\bbackend\b[^.!?\n]{0,120}\b(?:do not|don't|unchanged|preserve)\b|backend[^.!?\n]{0,120}(?:не\s+(?:меняй|изменяй)|не\s+змінюй)/iu.test(
      rawTask,
    );
  if (protectsBackend) return ["ui"];

  if (/\b(?:backend|server-side)\b|(?:бекенд|бэкенд|серверн\w*)/iu.test(rawTask)) {
    return ["backend"];
  }
  return [];
}

function fileImportsRenamedSymbolFromProvider(input: {
  file: ProjectInventoryFile;
  providers: ProjectInventoryFile[];
  symbol: string;
}) {
  const syntax = input.file.semanticFacts?.symbolSyntax;
  if (!syntax) return false;
  const matchingBindings = syntax.imports.filter(
    (binding) =>
      binding.importedName === input.symbol ||
      binding.localName === input.symbol,
  );
  if (matchingBindings.length === 0) return false;
  return matchingBindings.some((binding) =>
    input.providers.some((provider) =>
      moduleSpecifierResolvesToInventoryFile(
        input.file,
        binding.moduleSpecifier,
        provider,
      ),
    ),
  );
}

function fileProvidesRenamedSymbol(
  file: ProjectInventoryFile,
  symbol: string,
) {
  const syntax = file.semanticFacts?.symbolSyntax;
  if (!syntax) return false;
  return (
    syntax.exports.includes(symbol) ||
    syntax.imports.some(
      (binding) =>
        binding.kind === "reexport" &&
        (binding.importedName === symbol || binding.localName === symbol),
    )
  );
}

function resolveSymbolRenameSelection(input: {
  rawTask: string;
  inventory: ProjectInventory;
  profile: TaskSelectionProfile;
  maxFiles: number;
}): FinalSelectionDecision | null {
  const rename = extractSymbolRenameIntent(input.rawTask);
  if (!rename) return null;

  const declarationFiles = input.inventory.files.filter((file) =>
    parserBackedSymbolDeclarations(file).includes(rename.from),
  );
  const requiredLayers = symbolRenameRequiredLayers(
    input.rawTask,
    declarationFiles,
  );

  if (declarationFiles.length === 0) {
    return {
      selectedFiles: [],
      profile: input.profile,
      deterministicImplementationReady: false,
      forceInvestigation: true,
      canonicalSelectionApplied: true,
      requiredLayersOverride: requiredLayers,
      notes: [
        `Parser-backed symbol proof did not find a declaration for ${rename.from}.`,
        "Text in strings, comments, fixtures, diagnostics and documentation is not accepted as symbol ownership evidence.",
      ],
    };
  }

  // A pre-existing destination declaration makes the rename collision-prone.
  // Return a canonical empty investigation instead of allowing ranking noise to
  // choose unrelated files.
  const destinationFiles = input.inventory.files.filter((file) =>
    parserBackedSymbolDeclarations(file).includes(rename.to),
  );
  if (destinationFiles.length > 0) {
    return {
      selectedFiles: [],
      profile: input.profile,
      deterministicImplementationReady: false,
      forceInvestigation: true,
      canonicalSelectionApplied: true,
      requiredLayersOverride: requiredLayers,
      notes: [
        `Parser-backed symbol proof found an existing declaration for destination ${rename.to}.`,
        "The rename remains investigative because authorizing it could create a declaration or import collision.",
      ],
    };
  }

  const declarationPaths = new Set(
    declarationFiles.map((file) => normalizePath(file.path)),
  );
  const referenceFiles: ProjectInventoryFile[] = [];
  const referencePaths = new Set<string>();
  const providers = [...declarationFiles];
  const providerPaths = new Set(
    providers.map((file) => normalizePath(file.path)),
  );

  // Resolve direct imports first, then follow parser-backed re-export barrels.
  // This authorizes only files whose actual module binding can be traced back to
  // a declaration owner, while still supporting common index/barrel layouts.
  let discovered = true;
  while (discovered) {
    discovered = false;
    for (const file of input.inventory.files) {
      const normalizedPath = normalizePath(file.path);
      if (
        declarationPaths.has(normalizedPath) ||
        referencePaths.has(normalizedPath) ||
        (file.kind !== "source" && file.kind !== "test") ||
        !parserBackedSymbolReferences(file).includes(rename.from)
      ) {
        continue;
      }
      if (
        !fileImportsRenamedSymbolFromProvider({
          file,
          providers,
          symbol: rename.from,
        })
      ) {
        continue;
      }
      referenceFiles.push(file);
      referencePaths.add(normalizedPath);
      discovered = true;
      if (
        fileProvidesRenamedSymbol(file, rename.from) &&
        !providerPaths.has(normalizedPath)
      ) {
        providers.push(file);
        providerPaths.add(normalizedPath);
      }
    }
  }

  const selected: SelectedTaskFile[] = [];
  for (const file of declarationFiles) {
    const evidence: FileSelectionEvidence = {
      targetSource: "user_text",
      pathValidity: "inventory_exact",
      ownershipEvidence: "symbol_exact",
      actionConfidence: "confirmed_edit",
      semanticRoles: ["contract"],
      symbols: [rename.from, rename.to],
      chain: [
        {
          symbol: rename.from,
          role: "contract",
          path: file.path,
          evidence: "symbol_exact",
          relation: "same_file",
        },
      ],
      negativeConstraintConflicts: [],
      reason: `This real file contains a parser-backed declaration of ${rename.from}; only the identifier is authorized to change to ${rename.to}.`,
    };
    selected.push({
      path: file.path,
      kind: file.kind,
      usage: "inspect-and-edit",
      reason: evidence.reason,
      confidence: 0.97,
      evidenceLevel: "user_confirmed",
      selectionEvidence: evidence,
    });
  }
  for (const file of referenceFiles) {
    const owner = declarationFiles[0]!;
    const evidence: FileSelectionEvidence = {
      targetSource: "user_text",
      pathValidity: "inventory_exact",
      ownershipEvidence: "reference_graph",
      actionConfidence: "confirmed_edit",
      semanticRoles: ["consumer", "reference"],
      symbols: [rename.from, rename.to],
      chain: [
        {
          symbol: rename.from,
          role: "consumer",
          path: file.path,
          relatedPath: owner.path,
          evidence: "reference_graph",
          relation: "import_graph",
        },
      ],
      negativeConstraintConflicts: [],
      reason: `This file has a parser-backed import or re-export of ${rename.from} from the declaration owner; the user explicitly requested updating imports and type references.`,
    };
    selected.push({
      path: file.path,
      kind: file.kind,
      usage: "inspect-and-edit",
      reason: evidence.reason,
      confidence: 0.92,
      evidenceLevel: "graph_supported",
      selectionEvidence: evidence,
    });
  }

  const budget = Math.min(
    input.maxFiles,
    input.profile.maxPrimaryFiles,
    Math.max(1, selected.length),
  );
  return {
    selectedFiles: selected.slice(0, budget),
    profile: input.profile,
    deterministicImplementationReady: true,
    canonicalSelectionApplied: true,
    notes: [
      `Final selection resolved the explicit symbol rename ${rename.from} → ${rename.to} from parser-backed declarations and import bindings.`,
      `Selected ${declarationFiles.length} declaration file(s) and ${referenceFiles.length} proven import/re-export file(s); strings, comments, JSX text and fixtures were discarded.`,
    ],
  };
}

function resolveExplicitDocumentationSelection(input: {
  rawTask: string;
  taskIntent?: TaskIntentAnalysis;
  inventory: ProjectInventory;
  profile: TaskSelectionProfile;
  maxFiles: number;
}): FinalSelectionDecision | null {
  if (
    input.profile.kind !== "docs" ||
    input.taskIntent?.structuredIntent.allowedEditScope !==
      "explicit_targets_only"
  ) {
    return null;
  }

  const mentions = extractClassifiedFileMentions(input.rawTask).filter(
    (mention) => mention.role !== "artifact-reference",
  );
  if (mentions.length === 0) return null;

  const resolved: ProjectInventoryFile[] = [];
  for (const mention of mentions) {
    const target = normalizePath(mention.path);
    const basename = target.split("/").pop() ?? target;
    const candidates = input.inventory.files.filter((file) => {
      if (file.kind !== "docs" && !/\.(?:md|mdx)$/iu.test(file.path)) {
        return false;
      }
      const candidate = normalizePath(file.path);
      return (
        candidate === target ||
        candidate.endsWith(`/${target}`) ||
        (!target.includes("/") &&
          (candidate.split("/").pop() ?? candidate) === basename)
      );
    });
    // A basename that maps to multiple documents is not a confirmed target.
    // Preserve the normal investigation path instead of guessing one owner.
    if (candidates.length !== 1) return null;
    if (
      !resolved.some(
        (file) =>
          normalizePath(file.path) === normalizePath(candidates[0]!.path),
      )
    ) {
      resolved.push(candidates[0]!);
    }
  }

  if (resolved.length === 0) return null;
  const selected = resolved
    .slice(0, Math.max(1, input.maxFiles))
    .map((file) => {
      const evidence: FileSelectionEvidence = {
        targetSource: "user_text",
        pathValidity: "inventory_exact",
        ownershipEvidence: "content_supported",
        actionConfidence: "confirmed_edit",
        semanticRoles: ["contract"],
        symbols: [file.name],
        chain: [],
        negativeConstraintConflicts: [],
        reason:
          "The user explicitly named this existing documentation file and bounded edits to explicit targets only.",
      };
      return {
        path: file.path,
        kind: file.kind,
        usage: "inspect-and-edit" as const,
        reason: evidence.reason,
        confidence: 0.98,
        evidenceLevel: "user_confirmed" as const,
        selectionEvidence: evidence,
      };
    });

  return {
    selectedFiles: selected,
    profile: input.profile,
    deterministicImplementationReady: true,
    canonicalSelectionApplied: true,
    notes: [
      `Final selection was bounded to ${selected.length} exact user-named documentation target(s).`,
      "Unrelated documentation and audit reports were discarded from the edit scope.",
    ],
  };
}

function inferExplicitTargetKind(
  filePath: string,
): ProjectInventoryFile["kind"] {
  const path = normalizePath(filePath);
  if (/\.(?:md|mdx|txt)$/u.test(path)) return "docs";
  if (/\.(?:css|scss|sass|less)$/u.test(path)) return "style";
  if (
    /(?:^|\/)(?:\.env(?:\.[^/]+)?|dockerfile(?:\.[^/]+)?|makefile)$/u.test(path)
  )
    return "config";
  if (
    /(?:package\.json|tsconfig[^/]*\.json|vite\.config\.[^/]+|webpack|rollup|postcss|tailwind|eslint|prettier|docker-compose|\.ya?ml$|\.toml$)/u.test(
      path,
    )
  )
    return "config";
  if (/(?:\.test\.|\.spec\.|\.smoke\.|\.replay\.|\/__tests__\/)/u.test(path))
    return "test";
  if (/\.(?:json|sql|prisma|graphql|gql|xml)$/u.test(path)) return "data";
  return "source";
}

function isSafeExplicitRelativePath(filePath: string) {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\.\//u, "").trim();
  return (
    Boolean(normalized) &&
    !/^(?:[a-z]:|\/|\\\\)/iu.test(normalized) &&
    !normalized.split("/").some((segment) => segment === "..")
  );
}

function taskRequestsConcreteFileMutation(
  rawTask: string,
  taskIntent?: TaskIntentAnalysis,
) {
  const action = taskIntent?.taskUnderstanding.action;
  if (
    action &&
    [
      "create",
      "update",
      "replace",
      "remove",
      "fix",
      "refactor",
      "document",
      "configure",
    ].includes(action)
  )
    return true;
  return /\b(?:add|create|change|replace|update|remove|delete|fix|refactor|rename|move|write|configure|enable|disable)\b|(?:добав|созд|измен|замен|обнов|удал|убер|исправ|почин|рефактор|переимен|перемест|напиш|настрой|включ|отключ)/iu.test(
    rawTask,
  );
}

function taskRequestsFileCreation(
  rawTask: string,
  taskIntent?: TaskIntentAnalysis,
) {
  return (
    taskIntent?.taskUnderstanding.action === "create" ||
    /\b(?:create|add|introduce|generate|write)\b|(?:созд|добав|сгенерир|напиш)/iu.test(
      rawTask,
    )
  );
}

/**
 * Literal file paths are the strongest scope signal available to the core.
 * Resolve them before profile-specific ranking so Shadow, Legacy and manual
 * review all receive the same canonical edit/create targets. Model-proposed
 * paths never enter this branch because mentions are extracted from raw user
 * text and protected artifact references are filtered out.
 */

function executionLayerForExplicitTarget(
  filePath: string,
  file?: ProjectInventoryFile,
): TaskExecutionLayer | null {
  const path = normalizePath(filePath);
  const kind = file?.kind ?? inferExplicitTargetKind(filePath);
  const role = file?.role.toLocaleLowerCase() ?? "";
  if (kind === "docs") return "docs";
  if (kind === "config") return "config";
  if (kind === "test") return "tests";
  if (role === "client-api" || /(?:^|\/)api\/client\.[cm]?[jt]sx?$/u.test(path))
    return "client-api";
  if (
    role === "store" ||
    role === "hook" ||
    /(?:\/hooks?\/|\/stores?\/|\/state\/|controller|reducer|cache|session)/u.test(
      path,
    )
  )
    return "state";
  if (
    role === "repository" ||
    role === "db-schema" ||
    /(?:\/storage\/|\/db\/|\/database\/|\/repositories?\/|schema|migration)/u.test(
      path,
    )
  )
    return "storage";
  if (
    ["api-route", "server-entry", "service"].includes(role) ||
    /(?:^|\/)(?:server|backend)(?:\/|$)/u.test(path)
  )
    return "backend";
  if (
    ["page", "layout", "component", "ui-component"].includes(role) ||
    /\.(?:tsx|jsx|vue|svelte)$/u.test(path) ||
    /(?:^|\/)(?:pages|components|layouts)(?:\/|$)/u.test(path)
  )
    return "ui";
  return null;
}

function resolveLiteralFileTargetSelection(input: {
  rawTask: string;
  taskIntent?: TaskIntentAnalysis;
  inventory: ProjectInventory;
  selectedFiles: SelectedTaskFile[];
  profile: TaskSelectionProfile;
  maxFiles: number;
}): FinalSelectionDecision | null {
  if (!taskRequestsConcreteFileMutation(input.rawTask, input.taskIntent))
    return null;

  const classified = extractClassifiedFileMentions(input.rawTask).filter(
    (mention) => mention.role !== "artifact-reference",
  );
  if (classified.length === 0) return null;

  const resolution = resolveExplicitFileMentions(
    input.rawTask,
    input.inventory,
  );
  const inventoryByPath = new Map(
    input.inventory.files.map((file) => [normalizePath(file.path), file]),
  );
  const classifiedByPath = new Map(
    classified.map((mention) => [normalizePath(mention.path), mention]),
  );
  const createRequested = taskRequestsFileCreation(
    input.rawTask,
    input.taskIntent,
  );
  const exactTargets: SelectedTaskFile[] = [];
  const targetKeys = new Set<string>();

  for (const mention of resolution.mentions) {
    const mentionKey = normalizePath(mention.raw);
    const semanticMention =
      classifiedByPath.get(mentionKey) ??
      classifiedByPath.get(normalizePath(mention.normalized));
    if (!semanticMention || semanticMention.role === "artifact-reference")
      continue;

    const existing = mention.matchedPath
      ? inventoryByPath.get(normalizePath(mention.matchedPath))
      : undefined;
    const targetPath = existing?.path ?? mention.normalized;
    const targetKey = normalizePath(targetPath);
    if (targetKeys.has(targetKey)) continue;

    const plannedCreate =
      !existing && createRequested && isSafeExplicitRelativePath(targetPath);
    if (!existing && !plannedCreate) continue;

    const evidence: FileSelectionEvidence = {
      targetSource: "user_text",
      pathValidity: existing ? "inventory_exact" : "synthetic",
      ownershipEvidence: "content_supported",
      actionConfidence: "confirmed_edit",
      semanticRoles: [existing?.role === "api-route" ? "route" : "contract"],
      symbols: uniqueStrings(
        [
          existing?.name ?? targetPath.split("/").pop() ?? targetPath,
          ...(existing?.exports ?? []),
        ],
        8,
      ),
      chain: [],
      negativeConstraintConflicts: [],
      reason: existing
        ? "The user explicitly named this exact existing project file as a mutation target."
        : "The user explicitly named this safe missing project path in a create request.",
    };
    exactTargets.push({
      path: targetPath,
      kind: existing?.kind ?? inferExplicitTargetKind(targetPath),
      usage: existing ? "inspect-and-edit" : "create-and-edit",
      reason: evidence.reason,
      confidence: 0.99,
      evidenceLevel: "user_confirmed",
      selectionEvidence: evidence,
    });
    targetKeys.add(targetKey);
  }

  if (exactTargets.length === 0) return null;

  const createTargetDirectories = new Set(
    exactTargets
      .filter((target) => target.usage === "create-and-edit")
      .map((target) =>
        normalizePath(target.path).split("/").slice(0, -1).join("/"),
      ),
  );
  const supportBudget = Math.max(0, input.maxFiles - exactTargets.length);
  const explicitlyRequestedSupport = resolveGroundedSupportingContext({
    rawTask: input.rawTask,
    inventory: input.inventory,
    targetPaths: exactTargets.map((target) => target.path),
    excludedPaths: exactTargets.map((target) => target.path),
    maxFiles: Math.min(1, supportBudget),
  }).map((candidate) => {
    const relatedPath = exactTargets.find((target) =>
      normalizePath(target.path)
        .split("/")
        .slice(0, -1)
        .join("/") ===
      normalizePath(candidate.file.path)
        .split("/")
        .slice(0, -1)
        .join("/"),
    )?.path ?? exactTargets[0]?.path;
    const evidence: FileSelectionEvidence = {
      targetSource: "user_text",
      pathValidity: "inventory_exact",
      ownershipEvidence: "content_supported",
      actionConfidence: "inspect_only",
      semanticRoles: candidate.semanticRoles,
      symbols: candidate.symbols,
      chain: relatedPath
        ? [
            {
              symbol:
                candidate.symbols[0] ??
                candidate.file.name.replace(/\.[^.]+$/u, ""),
              role: candidate.semanticRoles[0] ?? "reference",
              path: candidate.file.path,
              relatedPath,
              evidence: "content_supported",
              relation: "identifier_reference",
            },
          ]
        : [],
      negativeConstraintConflicts: [],
      reason: candidate.reason,
    };
    return {
      path: candidate.file.path,
      kind: candidate.file.kind,
      usage: "inspect-only" as const,
      reason: candidate.reason,
      confidence: Math.min(0.86, Math.max(0.74, candidate.score / 600)),
      evidenceLevel: "graph_supported" as const,
      selectionEvidence: evidence,
    };
  });
  const requestedSupportKeys = new Set(
    explicitlyRequestedSupport.map((file) => normalizePath(file.path)),
  );
  const requestedSupportRoles = new Set(
    explicitlyRequestedSupport
      .map((file) => inventoryByPath.get(normalizePath(file.path))?.role)
      .filter((role): role is ProjectInventoryFile["role"] => Boolean(role)),
  );
  const nearbySupporting = input.selectedFiles
    .filter((file) => !targetKeys.has(normalizePath(file.path)))
    .filter((file) => !requestedSupportKeys.has(normalizePath(file.path)))
    .filter((file) => {
      const inventoryFile = inventoryByPath.get(normalizePath(file.path));
      return !inventoryFile || !requestedSupportRoles.has(inventoryFile.role);
    })
    .filter((file) => {
      const evidence = file.selectionEvidence;
      if (evidence?.negativeConstraintConflicts.length) return false;
      if (createTargetDirectories.size === 0) return false;
      const directory = normalizePath(file.path)
        .split("/")
        .slice(0, -1)
        .join("/");
      return (
        createTargetDirectories.has(directory) &&
        evidence?.targetSource !== "model_inference"
      );
    })
    .sort((left, right) => evidenceRank(right) - evidenceRank(left))
    .slice(
      0,
      Math.min(
        2,
        Math.max(0, supportBudget - explicitlyRequestedSupport.length),
      ),
    )
    .map((file) => ({
      ...file,
      usage:
        file.usage === "asset-reference" || file.usage === "config-reference"
          ? file.usage
          : ("inspect-only" as const),
      confidence: Math.min(file.confidence, 0.78),
      selectionEvidence:
        file.selectionEvidence?.actionConfidence === "confirmed_edit"
          ? {
              ...file.selectionEvidence,
              actionConfidence: "inspect_only" as const,
            }
          : file.selectionEvidence,
    }));
  const supporting = [...explicitlyRequestedSupport, ...nearbySupporting].slice(
    0,
    supportBudget,
  );

  const requiredLayersOverride = uniqueStrings(
    exactTargets
      .map((target) =>
        executionLayerForExplicitTarget(
          target.path,
          inventoryByPath.get(normalizePath(target.path)),
        ),
      )
      .filter((layer): layer is TaskExecutionLayer => Boolean(layer)),
  ) as TaskExecutionLayer[];

  return {
    selectedFiles: [...exactTargets, ...supporting].slice(0, input.maxFiles),
    profile: input.profile,
    deterministicImplementationReady: true,
    canonicalSelectionApplied: true,
    requiredLayersOverride,
    notes: [
      `Canonical decision resolved ${exactTargets.length} literal user-named file target(s) before model/ranking proposals.`,
      supporting.length > 0
        ? `Retained ${supporting.length} non-conflicting file(s) as inspect-only supporting context.`
        : "No ungrounded supporting file was retained beside the literal target(s).",
      explicitlyRequestedSupport.length > 0
        ? `Grounded ${explicitlyRequestedSupport.length} user-requested existing provider/reference file(s) without expanding edit authorization.`
        : "No explicit reuse-existing-context directive required additional provider evidence.",
    ],
  };
}

function resolveExplicitCreateSelection(input: {
  inventory: ProjectInventory;
  selectedFiles: SelectedTaskFile[];
  profile: TaskSelectionProfile;
  maxFiles: number;
}): FinalSelectionDecision | null {
  const createTargets = input.selectedFiles.filter((file) => {
    const evidence = file.selectionEvidence;
    return (
      file.usage === "create-and-edit" &&
      evidence?.targetSource === "user_text" &&
      evidence.pathValidity === "synthetic" &&
      evidence.actionConfidence === "confirmed_edit" &&
      evidence.negativeConstraintConflicts.length === 0
    );
  });
  if (createTargets.length === 0) return null;

  const targetDirectories = new Set(
    createTargets.map((file) => {
      const segments = normalizePath(file.path).split("/");
      return segments.slice(0, -1).join("/");
    }),
  );
  const inventoryByPath = new Map(
    input.inventory.files.map((file) => [normalizePath(file.path), file]),
  );
  const references = input.selectedFiles
    .filter((file) => file.usage !== "create-and-edit")
    .map((file) => ({
      file,
      inventory: inventoryByPath.get(normalizePath(file.path)),
    }))
    .filter(
      (
        item,
      ): item is { file: SelectedTaskFile; inventory: ProjectInventoryFile } =>
        Boolean(item.inventory),
    )
    .filter((item) => {
      const segments = normalizePath(item.inventory.path).split("/");
      return targetDirectories.has(segments.slice(0, -1).join("/"));
    })
    .sort((left, right) => {
      const roleScore = (file: ProjectInventoryFile) =>
        ["api-route", "server-entry", "page", "layout"].includes(file.role)
          ? 20
          : file.kind === "source"
            ? 10
            : 0;
      return (
        roleScore(right.inventory) - roleScore(left.inventory) ||
        left.inventory.path.localeCompare(right.inventory.path)
      );
    })
    .slice(0, Math.max(0, input.maxFiles - createTargets.length))
    .map(({ file }) => {
      const selectionEvidence = file.selectionEvidence;
      return {
        ...file,
        usage: "inspect-only" as const,
        selectionEvidence:
          selectionEvidence?.actionConfidence === "confirmed_edit"
            ? {
                ...selectionEvidence,
                actionConfidence: "inspect_only" as const,
              }
            : selectionEvidence,
      };
    });

  return {
    selectedFiles: [...createTargets, ...references].slice(0, input.maxFiles),
    profile: input.profile,
    deterministicImplementationReady: true,
    canonicalSelectionApplied: true,
    notes: [
      `Final selection preserved ${createTargets.length} exact safe user-named create target(s).`,
      references.length > 0
        ? "Only same-directory project files were retained as inspect-only implementation conventions."
        : "No unrelated fallback file was retained beside the explicit create target.",
    ],
  };
}

export function reconcileFinalSelectionDecision(input: {
  rawTask: string;
  taskType?: string;
  taskIntent?: TaskIntentAnalysis;
  inventory: ProjectInventory;
  selectedFiles: SelectedTaskFile[];
  investigationTrace?: InvestigationTrace;
  contract: TaskExecutionContract;
  maxFiles: number;
}): FinalSelectionDecision {
  const profile = classifyTaskSelectionProfile({
    rawTask: input.rawTask,
    taskType: input.taskType,
    taskIntent: input.taskIntent,
  });

  const contradictoryTask = resolveContradictoryTaskSelection({
    rawTask: input.rawTask,
    taskIntent: input.taskIntent,
    inventory: input.inventory,
    selectedFiles: input.selectedFiles,
    profile,
    maxFiles: input.maxFiles,
  });
  if (contradictoryTask) return contradictoryTask;

  const conditionalRemoval = resolveConditionalRemovalSelection({
    rawTask: input.rawTask,
    taskIntent: input.taskIntent,
    selectedFiles: input.selectedFiles,
    profile,
    maxFiles: input.maxFiles,
  });
  if (conditionalRemoval) return conditionalRemoval;

  const literalFileTargets = resolveLiteralFileTargetSelection({
    rawTask: input.rawTask,
    taskIntent: input.taskIntent,
    inventory: input.inventory,
    selectedFiles: input.selectedFiles,
    profile,
    maxFiles: input.maxFiles,
  });
  if (literalFileTargets) return literalFileTargets;

  const explicitCreate = resolveExplicitCreateSelection({
    inventory: input.inventory,
    selectedFiles: input.selectedFiles,
    profile,
    maxFiles: input.maxFiles,
  });
  if (explicitCreate) return explicitCreate;

  const explicitDocumentation = resolveExplicitDocumentationSelection({
    rawTask: input.rawTask,
    taskIntent: input.taskIntent,
    inventory: input.inventory,
    profile,
    maxFiles: input.maxFiles,
  });
  if (explicitDocumentation) return explicitDocumentation;

  if (profile.kind === "symbol-rename") {
    const symbolRename = resolveSymbolRenameSelection({
      rawTask: input.rawTask,
      inventory: input.inventory,
      profile,
      maxFiles: input.maxFiles,
    });
    if (symbolRename) return symbolRename;
  }

  if (profile.kind === "exact-text") {
    const exact = resolveExactTextSelection({
      rawTask: input.rawTask,
      taskIntent: input.taskIntent,
      inventory: input.inventory,
      selectedFiles: input.selectedFiles,
      trace: input.investigationTrace,
      profile,
      maxFiles: input.maxFiles,
    });
    if (exact) return exact;
  }

  if (profile.kind === "api-contract") {
    const apiContract = resolveApiContractSelection({
      rawTask: input.rawTask,
      taskIntent: input.taskIntent,
      inventory: input.inventory,
      selectedFiles: input.selectedFiles,
      profile,
      maxFiles: input.maxFiles,
    });
    if (apiContract) return apiContract;
    const directApiBoundary = resolveDirectApiBoundarySelection({
      rawTask: input.rawTask,
      taskIntent: input.taskIntent,
      inventory: input.inventory,
      selectedFiles: input.selectedFiles,
      profile,
      maxFiles: input.maxFiles,
    });
    if (directApiBoundary) return directApiBoundary;
  }

  if (profile.kind === "bounded-ui") {
    const boundedUi = resolveBoundedUiSelection({
      rawTask: input.rawTask,
      taskIntent: input.taskIntent,
      inventory: input.inventory,
      selectedFiles: input.selectedFiles,
      profile,
      maxFiles: input.maxFiles,
    });
    if (boundedUi) return boundedUi;
  }

  if (profile.kind === "structured-value") {
    const structuredValue = resolveStructuredValueSelection({
      rawTask: input.rawTask,
      taskIntent: input.taskIntent,
      inventory: input.inventory,
      profile,
      maxFiles: input.maxFiles,
    });
    if (structuredValue) return structuredValue;
  }

  const literalUiSurface = resolveLiteralUiSurfaceSelection({
    rawTask: input.rawTask,
    taskIntent: input.taskIntent,
    inventory: input.inventory,
    selectedFiles: input.selectedFiles,
    profile,
    maxFiles: input.maxFiles,
  });
  if (literalUiSurface) return literalUiSurface;

  if (profile.kind === "state-behavior") {
    const stateBehavior = resolveStateBehaviorSelection({
      rawTask: input.rawTask,
      taskIntent: input.taskIntent,
      inventory: input.inventory,
      selectedFiles: input.selectedFiles,
      profile,
      maxFiles: input.maxFiles,
    });
    if (stateBehavior) return stateBehavior;
    const anchoredInvestigation = resolveAnchoredStateInvestigationSelection({
      rawTask: input.rawTask,
      taskIntent: input.taskIntent,
      inventory: input.inventory,
      selectedFiles: input.selectedFiles,
      profile,
      maxFiles: input.maxFiles,
    });
    if (anchoredInvestigation) return anchoredInvestigation;
  }

  return reconcileTraceSelection({
    rawTask: input.rawTask,
    taskIntent: input.taskIntent,
    inventory: input.inventory,
    selectedFiles: input.selectedFiles,
    trace: input.investigationTrace,
    contract: input.contract,
    profile,
    maxFiles: input.maxFiles,
  });
}
