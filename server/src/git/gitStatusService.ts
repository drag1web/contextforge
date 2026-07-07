import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  GitChangedFile,
  GitDiffFileSummary,
  GitDiffScope,
  GitDiffSummaryResult,
  GitFileChangeKind,
  GitLatestCommit,
  GitStatusResult
} from "./gitTypes.js";

const execFileAsync = promisify(execFile);
const GIT_COMMAND_TIMEOUT_MS = 5000;
const GIT_COMMAND_MAX_BUFFER_BYTES = 1024 * 1024;
const MAX_RETURNED_FILES_PER_BUCKET = 120;
const MAX_RETURNED_DIFF_FILES = 180;

interface GitCommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  errorMessage: string | null;
}

async function runGit(projectRoot: string, args: string[]): Promise<GitCommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync("git", ["-C", projectRoot, ...args], {
      encoding: "utf8",
      timeout: GIT_COMMAND_TIMEOUT_MS,
      maxBuffer: GIT_COMMAND_MAX_BUFFER_BYTES,
      windowsHide: true
    });

    return {
      ok: true,
      stdout,
      stderr,
      errorMessage: null
    };
  } catch (error) {
    const maybeError = error as Error & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
      signal?: string;
    };

    return {
      ok: false,
      stdout: maybeError.stdout ?? "",
      stderr: maybeError.stderr ?? "",
      errorMessage: maybeError.message
    };
  }
}

function trimOutput(value: string) {
  return value.trim();
}

function normalizeGitPath(value: string) {
  return value.replaceAll("\\\\", "/").trim();
}

function mapStatusCode(statusCode: string): GitFileChangeKind {
  switch (statusCode) {
    case "A":
      return "added";
    case "M":
      return "modified";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "U":
      return "unmerged";
    case "?":
      return "untracked";
    case " ":
      return "unknown";
    default:
      return statusCode.trim() ? "unknown" : "unknown";
  }
}

function buildChangedFile(
  filePath: string,
  indexStatus: string,
  workingTreeStatus: string,
  preferredStatus: string,
  originalPath?: string | null
): GitChangedFile {
  return {
    path: normalizeGitPath(filePath),
    originalPath: originalPath ? normalizeGitPath(originalPath) : null,
    status: mapStatusCode(preferredStatus),
    indexStatus,
    workingTreeStatus
  };
}

function parsePorcelainStatus(stdout: string) {
  const staged: GitChangedFile[] = [];
  const unstaged: GitChangedFile[] = [];
  const untracked: GitChangedFile[] = [];
  const entries = stdout.split("\0").filter(Boolean);

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];

    if (entry.length < 4) {
      continue;
    }

    const indexStatus = entry[0] ?? " ";
    const workingTreeStatus = entry[1] ?? " ";
    const filePath = entry.slice(3);
    const hasSecondaryPath = indexStatus === "R" || indexStatus === "C";
    const secondaryPath = hasSecondaryPath ? entries[index + 1] ?? null : null;

    if (hasSecondaryPath) {
      index += 1;
    }

    if (indexStatus === "?" && workingTreeStatus === "?") {
      untracked.push(buildChangedFile(filePath, indexStatus, workingTreeStatus, "?", secondaryPath));
      continue;
    }

    if (indexStatus !== " " && indexStatus !== "?") {
      staged.push(buildChangedFile(filePath, indexStatus, workingTreeStatus, indexStatus, secondaryPath));
    }

    if (workingTreeStatus !== " " && workingTreeStatus !== "?") {
      unstaged.push(buildChangedFile(filePath, indexStatus, workingTreeStatus, workingTreeStatus, secondaryPath));
    }
  }

  return { staged, unstaged, untracked };
}

function limitFiles(files: GitChangedFile[]) {
  return files.slice(0, MAX_RETURNED_FILES_PER_BUCKET);
}

function parseLatestCommit(stdout: string): GitLatestCommit | null {
  const parts = trimOutput(stdout).split("\u001f");

  if (parts.length < 5 || !parts[0]) {
    return null;
  }

  return {
    hash: parts[0],
    shortHash: parts[1],
    subject: parts[2],
    author: parts[3],
    date: parts[4]
  };
}

function buildUnavailableResult(projectRoot: string, warning: string): GitStatusResult {
  return {
    isGitRepo: false,
    projectRoot,
    repositoryRoot: null,
    branch: null,
    isDetachedHead: false,
    dirty: false,
    staged: [],
    unstaged: [],
    untracked: [],
    latestCommit: null,
    summary: {
      stagedCount: 0,
      unstagedCount: 0,
      untrackedCount: 0,
      totalChanged: 0,
      isTruncated: false
    },
    warnings: [warning]
  };
}

export async function getGitStatus(projectRoot: string): Promise<GitStatusResult> {
  const warnings: string[] = [];
  const insideWorkTree = await runGit(projectRoot, ["rev-parse", "--is-inside-work-tree"]);

  if (!insideWorkTree.ok) {
    const message = insideWorkTree.errorMessage?.toLowerCase().includes("enoent")
      ? "Git command is not available on this machine."
      : "Project is not inside a Git repository.";

    return buildUnavailableResult(projectRoot, message);
  }

  if (trimOutput(insideWorkTree.stdout) !== "true") {
    return buildUnavailableResult(projectRoot, "Project is not inside a Git working tree.");
  }

  const repositoryRootResult = await runGit(projectRoot, ["rev-parse", "--show-toplevel"]);
  const repositoryRoot = repositoryRootResult.ok ? trimOutput(repositoryRootResult.stdout) : null;

  if (!repositoryRootResult.ok) {
    warnings.push("Could not resolve the Git repository root.");
  }

  const branchResult = await runGit(projectRoot, ["branch", "--show-current"]);
  let branch = branchResult.ok ? trimOutput(branchResult.stdout) : "";
  let isDetachedHead = false;

  if (!branch) {
    const detachedResult = await runGit(projectRoot, ["rev-parse", "--short", "HEAD"]);

    if (detachedResult.ok && trimOutput(detachedResult.stdout)) {
      branch = trimOutput(detachedResult.stdout);
      isDetachedHead = true;
      warnings.push("Repository is currently in detached HEAD state.");
    } else {
      branch = "";
      warnings.push("Could not resolve the current Git branch.");
    }
  }

  const statusResult = await runGit(projectRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);

  if (!statusResult.ok) {
    warnings.push("Could not read Git working tree status.");
  }

  const parsedStatus = statusResult.ok
    ? parsePorcelainStatus(statusResult.stdout)
    : { staged: [], unstaged: [], untracked: [] };

  const fullStagedCount = parsedStatus.staged.length;
  const fullUnstagedCount = parsedStatus.unstaged.length;
  const fullUntrackedCount = parsedStatus.untracked.length;
  const isTruncated =
    fullStagedCount > MAX_RETURNED_FILES_PER_BUCKET ||
    fullUnstagedCount > MAX_RETURNED_FILES_PER_BUCKET ||
    fullUntrackedCount > MAX_RETURNED_FILES_PER_BUCKET;

  if (isTruncated) {
    warnings.push(
      `Large Git status detected. Showing up to ${MAX_RETURNED_FILES_PER_BUCKET} files per category.`
    );
  }

  const latestCommitResult = await runGit(projectRoot, [
    "log",
    "-1",
    "--pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%aI"
  ]);
  const latestCommit = latestCommitResult.ok ? parseLatestCommit(latestCommitResult.stdout) : null;

  if (!latestCommit) {
    warnings.push("Could not read the latest Git commit.");
  }

  const totalChanged = fullStagedCount + fullUnstagedCount + fullUntrackedCount;

  return {
    isGitRepo: true,
    projectRoot,
    repositoryRoot,
    branch: branch || null,
    isDetachedHead,
    dirty: totalChanged > 0,
    staged: limitFiles(parsedStatus.staged),
    unstaged: limitFiles(parsedStatus.unstaged),
    untracked: limitFiles(parsedStatus.untracked),
    latestCommit,
    summary: {
      stagedCount: fullStagedCount,
      unstagedCount: fullUnstagedCount,
      untrackedCount: fullUntrackedCount,
      totalChanged,
      isTruncated
    },
    warnings
  };
}


interface ParsedNumstatEntry {
  additions: number | null;
  deletions: number | null;
  binary: boolean;
}

function parseNumstat(stdout: string) {
  const statsByPath = new Map<string, ParsedNumstatEntry>();

  for (const line of stdout.split("\n")) {
    const trimmedLine = line.trimEnd();

    if (!trimmedLine) {
      continue;
    }

    const parts = trimmedLine.split("\t");

    if (parts.length < 3) {
      continue;
    }

    const additionsRaw = parts[0] ?? "";
    const deletionsRaw = parts[1] ?? "";
    const filePath = normalizeGitPath(parts.slice(2).join("\t"));
    const binary = additionsRaw === "-" || deletionsRaw === "-";

    statsByPath.set(filePath, {
      additions: binary ? null : Number.parseInt(additionsRaw, 10),
      deletions: binary ? null : Number.parseInt(deletionsRaw, 10),
      binary
    });
  }

  return statsByPath;
}

function parseNameStatus(stdout: string, scope: GitDiffScope) {
  const files: GitDiffFileSummary[] = [];

  for (const line of stdout.split("\n")) {
    const trimmedLine = line.trimEnd();

    if (!trimmedLine) {
      continue;
    }

    const parts = trimmedLine.split("\t");
    const rawStatus = parts[0] ?? "";
    const statusCode = rawStatus[0] ?? "";
    const isMoveLikeStatus = statusCode === "R" || statusCode === "C";
    const originalPath = isMoveLikeStatus ? parts[1] ?? null : null;
    const filePath = isMoveLikeStatus ? parts[2] ?? parts[1] ?? "" : parts[1] ?? "";

    if (!filePath) {
      continue;
    }

    files.push({
      path: normalizeGitPath(filePath),
      originalPath: originalPath ? normalizeGitPath(originalPath) : null,
      status: mapStatusCode(statusCode),
      scope,
      additions: 0,
      deletions: 0,
      binary: false
    });
  }

  return files;
}

function mergeDiffStats(
  files: GitDiffFileSummary[],
  statsByPath: Map<string, ParsedNumstatEntry>
) {
  return files.map((file) => {
    const stat = statsByPath.get(file.path);

    if (!stat) {
      return file;
    }

    return {
      ...file,
      additions: stat.additions,
      deletions: stat.deletions,
      binary: stat.binary
    };
  });
}

function countNumeric(value: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function buildUnavailableDiffResult(
  projectRoot: string,
  warning: string
): GitDiffSummaryResult {
  return {
    isGitRepo: false,
    projectRoot,
    repositoryRoot: null,
    branch: null,
    dirty: false,
    files: [],
    totals: {
      filesChanged: 0,
      additions: 0,
      deletions: 0,
      binaryFiles: 0,
      stagedFiles: 0,
      unstagedFiles: 0,
      untrackedFiles: 0,
      isTruncated: false
    },
    warnings: [warning],
    generatedAt: new Date().toISOString()
  };
}

async function getScopedDiffFiles(projectRoot: string, scope: Exclude<GitDiffScope, "untracked">) {
  const baseArgs = scope === "staged" ? ["diff", "--cached"] : ["diff"];
  const [nameStatusResult, numstatResult] = await Promise.all([
    runGit(projectRoot, [...baseArgs, "--name-status", "--"]),
    runGit(projectRoot, [...baseArgs, "--numstat", "--"])
  ]);

  const warnings: string[] = [];

  if (!nameStatusResult.ok) {
    warnings.push(`Could not read ${scope} diff file names.`);
  }

  if (!numstatResult.ok) {
    warnings.push(`Could not read ${scope} diff line counts.`);
  }

  const files = nameStatusResult.ok ? parseNameStatus(nameStatusResult.stdout, scope) : [];
  const statsByPath = numstatResult.ok ? parseNumstat(numstatResult.stdout) : new Map<string, ParsedNumstatEntry>();

  return {
    files: mergeDiffStats(files, statsByPath),
    warnings
  };
}

export async function getGitDiffSummary(projectRoot: string): Promise<GitDiffSummaryResult> {
  const status = await getGitStatus(projectRoot);

  if (!status.isGitRepo) {
    return buildUnavailableDiffResult(
      projectRoot,
      status.warnings[0] ?? "Project is not inside a Git working tree."
    );
  }

  const warnings = [...status.warnings];
  const [stagedDiff, unstagedDiff] = await Promise.all([
    getScopedDiffFiles(projectRoot, "staged"),
    getScopedDiffFiles(projectRoot, "unstaged")
  ]);

  warnings.push(...stagedDiff.warnings, ...unstagedDiff.warnings);

  const untrackedFiles: GitDiffFileSummary[] = status.untracked.map((file) => ({
    path: file.path,
    originalPath: file.originalPath ?? null,
    status: "untracked",
    scope: "untracked",
    additions: null,
    deletions: null,
    binary: false
  }));

  const allFiles = [...stagedDiff.files, ...unstagedDiff.files, ...untrackedFiles];
  const isTruncated = allFiles.length > MAX_RETURNED_DIFF_FILES || status.summary.isTruncated;
  const files = allFiles.slice(0, MAX_RETURNED_DIFF_FILES);
  const additions = allFiles.reduce((total, file) => total + countNumeric(file.additions), 0);
  const deletions = allFiles.reduce((total, file) => total + countNumeric(file.deletions), 0);
  const binaryFiles = allFiles.filter((file) => file.binary).length;

  if (isTruncated) {
    warnings.push(`Large local diff detected. Showing up to ${MAX_RETURNED_DIFF_FILES} file summaries.`);
  }

  return {
    isGitRepo: true,
    projectRoot,
    repositoryRoot: status.repositoryRoot,
    branch: status.branch,
    dirty: status.dirty,
    files,
    totals: {
      filesChanged: allFiles.length,
      additions,
      deletions,
      binaryFiles,
      stagedFiles: stagedDiff.files.length,
      unstagedFiles: unstagedDiff.files.length,
      untrackedFiles: status.summary.untrackedCount,
      isTruncated
    },
    warnings,
    generatedAt: new Date().toISOString()
  };
}
