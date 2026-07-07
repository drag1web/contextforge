export type GitFileChangeKind =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "unmerged"
  | "untracked"
  | "unknown";

export interface GitChangedFile {
  path: string;
  originalPath?: string | null;
  status: GitFileChangeKind;
  indexStatus: string;
  workingTreeStatus: string;
}

export interface GitLatestCommit {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  date: string;
}

export interface GitChangeSummary {
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  totalChanged: number;
  isTruncated: boolean;
}

export interface GitStatusResult {
  isGitRepo: boolean;
  projectRoot: string;
  repositoryRoot: string | null;
  branch: string | null;
  isDetachedHead: boolean;
  dirty: boolean;
  staged: GitChangedFile[];
  unstaged: GitChangedFile[];
  untracked: GitChangedFile[];
  latestCommit: GitLatestCommit | null;
  summary: GitChangeSummary;
  warnings: string[];
}

export type GitDiffScope = "staged" | "unstaged" | "untracked";

export interface GitDiffFileSummary {
  path: string;
  originalPath?: string | null;
  status: GitFileChangeKind;
  scope: GitDiffScope;
  additions: number | null;
  deletions: number | null;
  binary: boolean;
}

export interface GitDiffTotals {
  filesChanged: number;
  additions: number;
  deletions: number;
  binaryFiles: number;
  stagedFiles: number;
  unstagedFiles: number;
  untrackedFiles: number;
  isTruncated: boolean;
}

export interface GitDiffSummaryResult {
  isGitRepo: boolean;
  projectRoot: string;
  repositoryRoot: string | null;
  branch: string | null;
  dirty: boolean;
  files: GitDiffFileSummary[];
  totals: GitDiffTotals;
  warnings: string[];
  generatedAt: string;
}
