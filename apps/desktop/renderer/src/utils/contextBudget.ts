import type {
  ContextComposerFileReference,
  ContextComposerPreview,
  ContextComposerSnippet,
} from "../types";

export interface ContextBudgetSelection {
  selectedFiles: ContextComposerFileReference[];
  snippets: ContextComposerSnippet[];
}

export type ContextBudgetSnapshot =
  | {
      status: "unavailable";
      tokenAccounting: "unavailable";
      tokenUsage: null;
      tokenLimit: null;
    }
  | {
      status: "measured";
      selectedFiles: number;
      selectedFileBytes: number;
      readableFiles: number;
      editableFiles: number;
      inspectOnlyFiles: number;
      referenceFiles: number;
      snippets: number;
      snippetCharacters: number;
      truncatedSnippets: number;
      tokenAccounting: "unavailable";
      tokenUsage: null;
      tokenLimit: null;
    };

function safeFileBytes(value: number) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function classifyUsage(usage: string) {
  const normalized = usage.toLowerCase();

  if (normalized.includes("edit") || normalized.includes("create")) {
    return "editable" as const;
  }

  if (normalized.includes("reference") || normalized.includes("config")) {
    return "reference" as const;
  }

  return "inspect" as const;
}

export function evaluateContextBudget(
  preview?: ContextComposerPreview | null,
  reviewedSelection?: ContextBudgetSelection | null,
): ContextBudgetSnapshot {
  if (!preview) {
    return {
      status: "unavailable",
      tokenAccounting: "unavailable",
      tokenUsage: null,
      tokenLimit: null,
    };
  }

  const selectedFiles = reviewedSelection?.selectedFiles ?? preview.selectedFiles;
  const snippets = reviewedSelection?.snippets ?? preview.snippets;

  let selectedFileBytes = 0;
  let readableFiles = 0;
  let editableFiles = 0;
  let inspectOnlyFiles = 0;
  let referenceFiles = 0;

  for (const file of selectedFiles) {
    selectedFileBytes += safeFileBytes(file.sizeBytes);
    if (file.canReadText) readableFiles += 1;

    const usage = classifyUsage(file.usage);
    if (usage === "editable") editableFiles += 1;
    else if (usage === "reference") referenceFiles += 1;
    else inspectOnlyFiles += 1;
  }

  let snippetCharacters = 0;
  let truncatedSnippets = 0;

  for (const snippet of snippets) {
    snippetCharacters += snippet.content.length;
    if (snippet.truncated) truncatedSnippets += 1;
  }

  return {
    status: "measured",
    selectedFiles: selectedFiles.length,
    selectedFileBytes,
    readableFiles,
    editableFiles,
    inspectOnlyFiles,
    referenceFiles,
    snippets: snippets.length,
    snippetCharacters,
    truncatedSnippets,
    tokenAccounting: "unavailable",
    tokenUsage: null,
    tokenLimit: null,
  };
}
