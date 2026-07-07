import type { GitChangedFile, GitStatusResult } from "../types";

export const LOCAL_CHANGES_NOTE_HEADING = "Current local changes for awareness only";

export function getGitChangedFiles(status?: GitStatusResult | null) {
  if (!status?.isGitRepo) {
    return [];
  }

  const seen = new Set<string>();
  const files: GitChangedFile[] = [];

  for (const file of [...status.staged, ...status.unstaged, ...status.untracked]) {
    if (seen.has(file.path)) {
      continue;
    }

    seen.add(file.path);
    files.push(file);
  }

  return files;
}

export function getGitChangeLabel(file: GitChangedFile) {
  if (file.status === "untracked") {
    return "untracked";
  }

  if (file.status === "added") {
    return "added";
  }

  if (file.status === "deleted") {
    return "deleted";
  }

  if (file.status === "renamed") {
    return "renamed";
  }

  if (file.status === "copied") {
    return "copied";
  }

  if (file.status === "unmerged") {
    return "conflict";
  }

  return "modified";
}

export function buildLocalChangesNote(status: GitStatusResult) {
  const files = getGitChangedFiles(status);

  if (!status.isGitRepo || files.length === 0) {
    return "";
  }

  const branch = status.isDetachedHead
    ? `detached HEAD${status.branch ? ` (${status.branch})` : ""}`
    : status.branch ?? "unknown branch";
  const visibleFiles = files.slice(0, 14);
  const hiddenCount = files.length - visibleFiles.length;
  const lines = visibleFiles.map((file) => `- ${getGitChangeLabel(file)}: ${file.path}`);

  if (hiddenCount > 0) {
    lines.push(`- …and ${hiddenCount} more local change${hiddenCount === 1 ? "" : "s"}`);
  }

  return [
    LOCAL_CHANGES_NOTE_HEADING + ":",
    `Branch: ${branch}`,
    `Summary: ${status.summary.totalChanged} changed · ${status.summary.stagedCount} staged · ${status.summary.unstagedCount} unstaged · ${status.summary.untrackedCount} untracked`,
    "These are existing local working-tree changes. They are background context, not automatic edit targets.",
    ...lines
  ].join("\n");
}

export function mergeLocalChangesNote(rawTask: string, note: string) {
  const trimmedTask = rawTask.trim();

  if (!note) {
    return rawTask;
  }

  const headingIndex = trimmedTask.indexOf(LOCAL_CHANGES_NOTE_HEADING);

  if (headingIndex >= 0) {
    return `${trimmedTask.slice(0, headingIndex).trim()}\n\n${note}`.trim();
  }

  return [trimmedTask, note].filter(Boolean).join("\n\n");
}

export function buildChangesDraftTask(status: GitStatusResult) {
  const note = buildLocalChangesNote(status);

  if (!note) {
    return "";
  }

  return mergeLocalChangesNote(
    [
      "Use the current local changes as awareness only.",
      "Replace this sentence with the exact follow-up task before generating the final Task Pack."
    ].join(" "),
    note
  );
}
