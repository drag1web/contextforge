import type { StructuredIntentTarget, TaskIntentAnalysis } from "../ollama/taskIntentAnalyzer.js";
import type {
  ProjectInventory,
  ProjectInventoryFile,
  ProjectInventoryStructuredEntry,
} from "../scanner/projectInventoryScanner.js";

interface ReplacementPair {
  oldValue: string;
  newValue: string;
  kind: "shortcut";
}

interface GroundedEntryMatch {
  file: ProjectInventoryFile;
  entry: ProjectInventoryStructuredEntry;
  currentValue: string;
  identity: string;
  enabled: boolean | null;
}

function normalizeWhitespace(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function normalizeSearch(value: unknown) {
  return normalizeWhitespace(value)
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function normalizeShortcut(value: unknown) {
  const tokens = normalizeWhitespace(value)
    .replace(/control/giu, "ctrl")
    .replace(/command|cmd/giu, "meta")
    .split(/\s*\+\s*|\s+/u)
    .map((token) => token.trim().toLocaleLowerCase())
    .filter(Boolean);

  if (tokens.length < 2) return "";
  const modifiers = ["ctrl", "meta", "alt", "shift"].filter((modifier) =>
    tokens.includes(modifier),
  );
  const keys = tokens.filter((token) => !["ctrl", "meta", "alt", "shift"].includes(token));
  if (keys.length !== 1) return "";
  return [...modifiers, keys[0]].join("+");
}

function extractShortcutReplacementPair(rawTask: string): ReplacementPair | null {
  const shortcut = String.raw`(?:Ctrl|Control|Cmd|Command|Meta|Alt|Shift)(?:\s*\+\s*(?:Ctrl|Control|Cmd|Command|Meta|Alt|Shift|[A-Za-z0-9,.;/\\-]))+`;
  const patterns = [
    new RegExp(`(?:^|[\\s,:;])(?:с|из)\\s+(${shortcut})\\s+на\\s+(${shortcut})(?=$|[\\s,.!?;])`, "iu"),
    new RegExp(`\\bfrom\\s+(${shortcut})\\s+to\\s+(${shortcut})(?=$|[\\s,.!?;])`, "iu"),
  ];

  for (const pattern of patterns) {
    const match = rawTask.match(pattern);
    if (!match) continue;
    const oldValue = normalizeShortcut(match[1]);
    const newValue = normalizeShortcut(match[2]);
    if (oldValue && newValue && oldValue !== newValue) {
      return { oldValue, newValue, kind: "shortcut" };
    }
  }

  return null;
}

function extractShortcutSubject(rawTask: string) {
  const patterns = [
    /(?:горяч\p{L}*\s+клавиш\p{L}*\s+(?:открытия|для|вызова)\s+)(.{2,100}?)(?=\s+(?:с|из)\s+(?:Ctrl|Control|Cmd|Command|Meta|Alt|Shift))/iu,
    /(?:shortcut|hotkey)\s+(?:for|to\s+open)\s+(.{2,100}?)(?=\s+from\s+(?:Ctrl|Control|Cmd|Command|Meta|Alt|Shift))/iu,
  ];
  for (const pattern of patterns) {
    const match = rawTask.match(pattern);
    const value = normalizeWhitespace(match?.[1]);
    if (value) return value;
  }
  return "";
}

function entryValue(entry: ProjectInventoryStructuredEntry, keys: string[]) {
  const wanted = new Set(keys.map((key) => key.toLocaleLowerCase()));
  return entry.values.find((item) => wanted.has(item.key.toLocaleLowerCase()))?.value ?? "";
}

function entryIdentity(entry: ProjectInventoryStructuredEntry) {
  const ordered = ["label", "title", "name", "id", "action", "key", "type", "kind"];
  for (const key of ordered) {
    const value = entryValue(entry, [key]);
    if (value) return value;
  }
  return entry.values.slice(0, 3).map((item) => item.value).join(" ");
}

function entryEnabled(entry: ProjectInventoryStructuredEntry) {
  const value = entryValue(entry, ["enabled", "active"]);
  if (!value) return null;
  if (value.toLocaleLowerCase() === "true") return true;
  if (value.toLocaleLowerCase() === "false") return false;
  return null;
}

function entryShortcut(entry: ProjectInventoryStructuredEntry) {
  const preferred = entryValue(entry, [
    "displayKeys",
    "shortcut",
    "hotkey",
    "accelerator",
    "keys",
  ]);
  const preferredNormalized = normalizeShortcut(preferred);
  if (preferredNormalized) return preferredNormalized;

  for (const item of entry.values) {
    const normalized = normalizeShortcut(item.value);
    if (normalized) return normalized;
  }
  return "";
}

function fileStructuredEntries(file: ProjectInventoryFile) {
  return file.semanticFacts?.structuredEntries ?? [];
}

function findSubjectEntry(
  inventory: ProjectInventory,
  subject: string,
): GroundedEntryMatch | null {
  const subjectKey = normalizeSearch(subject);
  if (!subjectKey) return null;
  const subjectTokens = subjectKey.split(/\s+/u).filter((token) => token.length >= 3);

  const candidates: Array<GroundedEntryMatch & { score: number }> = [];
  for (const file of inventory.files) {
    for (const entry of fileStructuredEntries(file)) {
      const identity = entryIdentity(entry);
      const searchable = normalizeSearch(entry.values.map((item) => item.value).join(" "));
      const identitySearch = normalizeSearch(identity);
      const currentValue = entryShortcut(entry);
      if (!currentValue) continue;

      const exact = identitySearch === subjectKey || searchable.includes(subjectKey);
      const tokenMatches = subjectTokens.filter((token) => searchable.includes(token)).length;
      if (!exact && tokenMatches === 0) continue;

      const score =
        (identitySearch === subjectKey ? 300 : 0) +
        (searchable.includes(subjectKey) ? 180 : 0) +
        tokenMatches * 35 +
        (/shortcut|keyboard|hotkey|keybinding/iu.test(file.path) ? 60 : 0) +
        (file.role === "config" ? 30 : 0);
      candidates.push({
        file,
        entry,
        currentValue,
        identity,
        enabled: entryEnabled(entry),
        score,
      });
    }
  }

  candidates.sort((left, right) => right.score - left.score);
  const best = candidates[0];
  const second = candidates[1];
  if (!best || (second && best.score - second.score < 40)) return null;
  return best;
}

function findShortcutConflict(
  inventory: ProjectInventory,
  requestedValue: string,
  subjectMatch: GroundedEntryMatch,
) {
  for (const file of inventory.files) {
    for (const entry of fileStructuredEntries(file)) {
      if (file.path === subjectMatch.file.path && entry === subjectMatch.entry) continue;
      const currentValue = entryShortcut(entry);
      if (currentValue !== requestedValue) continue;
      return {
        file,
        identity: entryIdentity(entry),
        enabled: entryEnabled(entry),
      };
    }
  }
  return null;
}

function displayShortcut(value: string) {
  return value
    .split("+")
    .map((token) => token.length === 1 ? token.toUpperCase() : token[0]!.toUpperCase() + token.slice(1))
    .join("+");
}

function uniqueStrings(values: string[], limit = 12) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = normalizeWhitespace(raw);
    const key = normalizeSearch(value);
    if (!value || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= limit) break;
  }
  return result;
}

export function groundTaskCurrentState(input: {
  rawTask: string;
  inventory: ProjectInventory;
  taskIntent: TaskIntentAnalysis;
}): TaskIntentAnalysis {
  const pair = extractShortcutReplacementPair(input.rawTask);
  if (!pair) return input.taskIntent;

  const subject = extractShortcutSubject(input.rawTask);
  const subjectMatch = findSubjectEntry(input.inventory, subject);
  if (!subjectMatch) return input.taskIntent;

  const oldMatches = subjectMatch.currentValue === pair.oldValue;
  const conflict = findShortcutConflict(input.inventory, pair.newValue, subjectMatch);
  if (oldMatches && !conflict) return input.taskIntent;

  const currentDisplay = displayShortcut(subjectMatch.currentValue);
  const requestedOldDisplay = displayShortcut(pair.oldValue);
  const requestedNewDisplay = displayShortcut(pair.newValue);
  const mismatch = !oldMatches
    ? `The task says ${subject || subjectMatch.identity} currently uses ${requestedOldDisplay}, but project code defines ${currentDisplay} in ${subjectMatch.file.path}.`
    : "";
  const conflictText = conflict
    ? `The requested shortcut ${requestedNewDisplay} is already assigned to ${conflict.identity || "another action"} in ${conflict.file.path}${conflict.enabled === false ? " (currently disabled)" : ""}.`
    : "";
  const ambiguity = [mismatch, conflictText].filter(Boolean).join(" ");
  const clarificationQuestion = conflict
    ? `Project code currently uses ${currentDisplay} for ${subject || subjectMatch.identity}, and ${requestedNewDisplay} is already assigned to ${conflict.identity || "another action"}${conflict.enabled === false ? " but disabled" : ""}. Should ${subject || subjectMatch.identity} be changed to ${requestedNewDisplay} while leaving the other action unchanged?`
    : `Project code currently uses ${currentDisplay} for ${subject || subjectMatch.identity}, not ${requestedOldDisplay}. Should it be changed from ${currentDisplay} to ${requestedNewDisplay}?`;

  return {
    ...input.taskIntent,
    taskUnderstanding: {
      ...input.taskIntent.taskUnderstanding,
      goal: `Change ${subject || subjectMatch.identity} from the code-grounded current value ${currentDisplay} to ${requestedNewDisplay}.`,
      ambiguities: uniqueStrings([
        ...(input.taskIntent.taskUnderstanding.ambiguities ?? []),
        ambiguity,
      ]),
      readiness: "review",
      canProceed: true,
      clarificationQuestion,
      reasons: uniqueStrings([
        ...input.taskIntent.taskUnderstanding.reasons,
        mismatch,
        conflictText,
        `Current-state grounding matched ${subject || subjectMatch.identity} to ${subjectMatch.file.path}.`,
      ]),
    },
    structuredIntent: {
      ...input.taskIntent.structuredIntent,
      ambiguities: uniqueStrings([
        ...input.taskIntent.structuredIntent.ambiguities,
        ambiguity,
      ]),
      primaryTargets: [
        {
          kind: "config",
          value: subject || subjectMatch.identity,
          path: subjectMatch.file.path,
          name: subjectMatch.file.name,
          confidence: 0.96,
          evidence: `Current-state grounding matched the requested setting to a structured project entry whose current value is ${currentDisplay}.`,
          provenance: "graph_supported",
        } satisfies StructuredIntentTarget,
        ...input.taskIntent.structuredIntent.primaryTargets.filter(
          (target) => target.path !== subjectMatch.file.path,
        ),
      ].slice(0, 8),
    },
    notes: uniqueStrings([
      ...input.taskIntent.notes,
      mismatch,
      conflictText,
    ], 18),
  };
}
