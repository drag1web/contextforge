import type {
  ContextComposerFileReference,
  ContextComposerPreview,
  ContextComposerSnippet,
  TaskPackDraft,
} from "../types";
import type { ContextComposerNavigationState } from "../types/navigation";

export interface ContextComposerReviewedSelection {
  selectedFiles: ContextComposerFileReference[];
  snippets: ContextComposerSnippet[];
}

function normalizeComposerFileKey(path: string) {
  return path.replace(/\\/g, "/").toLowerCase();
}

function mergeFilesByComposerIdentity<T extends { path: string }>(files: T[]) {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const file of files) {
    const key = normalizeComposerFileKey(file.path);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(file);
  }

  return result;
}

function mergeSnippetsByComposerIdentity(snippets: ContextComposerSnippet[]) {
  const seen = new Set<string>();
  const result: ContextComposerSnippet[] = [];

  for (const snippet of snippets) {
    const key = normalizeComposerFileKey(snippet.relativePath);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(snippet);
  }

  return result;
}

export function taskContextDraftsMatch(
  left: Pick<
    TaskPackDraft,
    "projectId" | "rawTask" | "taskType" | "targetTool" | "clarifications"
  >,
  right: Pick<
    TaskPackDraft,
    "projectId" | "rawTask" | "taskType" | "targetTool" | "clarifications"
  >,
) {
  return (
    left.projectId === right.projectId &&
    left.rawTask === right.rawTask &&
    left.taskType === right.taskType &&
    left.targetTool === right.targetTool &&
    JSON.stringify(left.clarifications ?? []) ===
      JSON.stringify(right.clarifications ?? [])
  );
}

export function buildContextComposerReviewedSelection(
  preview: ContextComposerPreview,
  state?: ContextComposerNavigationState | null,
): ContextComposerReviewedSelection | null {
  if (!state) {
    return null;
  }

  const suggestedFiles = (preview.suggestedFileGroups ?? []).flatMap(
    (group) => group.files,
  );
  const candidates = mergeFilesByComposerIdentity([
    ...suggestedFiles,
    ...preview.selectedFiles,
    ...state.extraFiles,
  ]);
  const selectedPathSet = new Set(state.selectedPaths);
  const selectedFiles = candidates.filter((file) =>
    selectedPathSet.has(file.path),
  );

  const snippetCandidates = mergeSnippetsByComposerIdentity([
    ...preview.snippets,
    ...state.extraSnippets,
  ]);
  const snippets = snippetCandidates.filter((snippet) =>
    selectedPathSet.has(snippet.relativePath),
  );

  return {
    selectedFiles,
    snippets,
  };
}
