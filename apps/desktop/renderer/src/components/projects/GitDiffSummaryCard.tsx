import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileCode2,
  GitCompareArrows,
  Link2,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  ShieldCheck
} from "lucide-react";

import { getProjectGitDiffSummary, getTaskPacks } from "../../api/client";
import type { GitDiffFileSummary, GitDiffSummaryResult, TaskPack } from "../../types";
import { Button } from "../ui/Button";

interface GitDiffSummaryCardProps {
  projectId: number;
  enabled: boolean;
}

const DIFF_PREVIEW_LIMIT = 8;

type DiffBadgeTone = "success" | "warning" | "danger" | "muted";
type ReviewVerdict = "none" | "looks-good" | "needs-changes" | "blocked";
type AlignmentStatus = "loading" | "no-task-pack" | "no-context" | "aligned" | "partial" | "outside" | "clean" | "unavailable";

interface DiffReviewSignal {
  id: string;
  label: string;
  description: string;
  tone: DiffBadgeTone;
}

interface TaskPackDiffAlignment {
  status: AlignmentStatus;
  taskPack: TaskPack | null;
  selectedPaths: string[];
  changedPaths: string[];
  overlapPaths: string[];
  outsidePaths: string[];
  selectedOnlyCount: number;
}

const SCOPE_LABELS: Record<GitDiffFileSummary["scope"], string> = {
  staged: "staged",
  unstaged: "unstaged",
  untracked: "untracked"
};

const STATUS_LABELS: Record<GitDiffFileSummary["status"], string> = {
  added: "added",
  modified: "modified",
  deleted: "deleted",
  renamed: "renamed",
  copied: "copied",
  unmerged: "unmerged",
  untracked: "new",
  unknown: "changed"
};

const VERDICT_OPTIONS: Array<{ id: ReviewVerdict; label: string; caption: string }> = [
  { id: "looks-good", label: "Looks good", caption: "Ready to continue" },
  { id: "needs-changes", label: "Needs changes", caption: "Review before export" },
  { id: "blocked", label: "Blocked", caption: "Do not continue yet" }
];

function DiffBadge({ children, tone = "muted" }: { children: ReactNode; tone?: DiffBadgeTone }) {
  const toneClass =
    tone === "success"
      ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
      : tone === "warning"
        ? "border-amber-300/20 bg-amber-300/10 text-amber-100"
        : tone === "danger"
          ? "border-red-400/20 bg-red-400/10 text-red-100"
          : "border-neutral-800 bg-black/35 text-neutral-400";

  return (
    <span className={["inline-flex min-w-0 items-center gap-1 rounded-full border px-2 py-1 text-[11px]", toneClass].join(" ")}> 
      {children}
    </span>
  );
}

function DiffMetric({
  label,
  value,
  caption,
  withDivider = false
}: {
  label: string;
  value: string | number;
  caption: string;
  withDivider?: boolean;
}) {
  return (
    <div className={["min-w-0 px-4 py-3", withDivider ? "border-l border-neutral-900" : ""].join(" ")}>
      <p className="cf-tech-label text-[10px] uppercase text-neutral-600">{label}</p>
      <p className="cf-display-font mt-1 text-xl font-semibold text-white">{value}</p>
      <p className="mt-1 truncate text-xs text-neutral-600">{caption}</p>
    </div>
  );
}

function formatLineCount(value: number | null, prefix: string) {
  if (value === null) {
    return null;
  }

  return `${prefix}${value}`;
}

function getLineStatLabel(file: GitDiffFileSummary) {
  if (file.additions === null || file.deletions === null) {
    return file.binary ? "binary" : "not measured";
  }

  if (file.status === "untracked") {
    return "not measured";
  }

  return null;
}

function buildScopeSummary(diffSummary: GitDiffSummaryResult) {
  const parts = [
    `${diffSummary.totals.stagedFiles} staged`,
    `${diffSummary.totals.unstagedFiles} unstaged`,
    `${diffSummary.totals.untrackedFiles} untracked`
  ];

  return parts.join(" · ");
}

function normalizeDisplayPath(path: string) {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

function normalizeComparablePath(path: string) {
  return normalizeDisplayPath(path).toLowerCase();
}

function truncateText(value: string, maxLength = 72) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function parseRelevantFileCandidates(markdown: string) {
  const sectionMatch = markdown.match(/## Relevant File Candidates\n([\s\S]*?)(?=\n## |$)/i);

  if (!sectionMatch) {
    return [];
  }

  return sectionMatch[1]
    .split(/\r?\n/)
    .map((line) => line.match(/^-\s+(.+)$/)?.[1]?.trim() ?? "")
    .filter((value) => value && !value.toLowerCase().startsWith("no relevant"))
    .map((value) => normalizeDisplayPath(value))
    .filter((value) => value && !value.includes(":"))
    .filter((value, index, array) => array.findIndex((item) => normalizeComparablePath(item) === normalizeComparablePath(value)) === index);
}

function getLatestProjectTaskPack(taskPacks: TaskPack[], projectId: number) {
  return taskPacks
    .filter((taskPack) => taskPack.projectId === projectId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] ?? null;
}

function buildTaskPackAlignment(
  diffSummary: GitDiffSummaryResult | null,
  taskPacks: TaskPack[] | null,
  projectId: number,
  isLoadingTaskPacks: boolean,
  taskPackError: string | null
): TaskPackDiffAlignment {
  if (taskPackError) {
    return {
      status: "unavailable",
      taskPack: null,
      selectedPaths: [],
      changedPaths: [],
      overlapPaths: [],
      outsidePaths: [],
      selectedOnlyCount: 0
    };
  }

  if (isLoadingTaskPacks || taskPacks === null) {
    return {
      status: "loading",
      taskPack: null,
      selectedPaths: [],
      changedPaths: [],
      overlapPaths: [],
      outsidePaths: [],
      selectedOnlyCount: 0
    };
  }

  const latestTaskPack = getLatestProjectTaskPack(taskPacks, projectId);

  if (!latestTaskPack) {
    return {
      status: "no-task-pack",
      taskPack: null,
      selectedPaths: [],
      changedPaths: [],
      overlapPaths: [],
      outsidePaths: [],
      selectedOnlyCount: 0
    };
  }

  const selectedPaths = parseRelevantFileCandidates(latestTaskPack.generatedPrompt);
  const changedPaths = diffSummary?.isGitRepo
    ? diffSummary.files.map((file) => normalizeDisplayPath(file.path))
    : [];

  if (changedPaths.length === 0) {
    return {
      status: "clean",
      taskPack: latestTaskPack,
      selectedPaths,
      changedPaths,
      overlapPaths: [],
      outsidePaths: [],
      selectedOnlyCount: selectedPaths.length
    };
  }

  if (selectedPaths.length === 0) {
    return {
      status: "no-context",
      taskPack: latestTaskPack,
      selectedPaths,
      changedPaths,
      overlapPaths: [],
      outsidePaths: changedPaths,
      selectedOnlyCount: 0
    };
  }

  const selectedSet = new Set(selectedPaths.map(normalizeComparablePath));
  const changedSet = new Set(changedPaths.map(normalizeComparablePath));
  const overlapPaths = changedPaths.filter((filePath) => selectedSet.has(normalizeComparablePath(filePath)));
  const outsidePaths = changedPaths.filter((filePath) => !selectedSet.has(normalizeComparablePath(filePath)));
  const selectedOnlyCount = selectedPaths.filter((filePath) => !changedSet.has(normalizeComparablePath(filePath))).length;

  return {
    status: overlapPaths.length === changedPaths.length ? "aligned" : overlapPaths.length > 0 ? "partial" : "outside",
    taskPack: latestTaskPack,
    selectedPaths,
    changedPaths,
    overlapPaths,
    outsidePaths,
    selectedOnlyCount
  };
}

function getAlignmentCopy(alignment: TaskPackDiffAlignment): { label: string; caption: string; tone: DiffBadgeTone } {
  switch (alignment.status) {
    case "loading":
      return { label: "Checking alignment", caption: "Reading the latest saved Task Pack for this project.", tone: "muted" };
    case "no-task-pack":
      return { label: "No Task Pack yet", caption: "Generate a Task Pack to compare planned context with local changes.", tone: "muted" };
    case "no-context":
      return { label: "No selected context", caption: "The latest Task Pack has no parsed file candidates to compare.", tone: "warning" };
    case "aligned":
      return { label: "Aligned", caption: "Changed files match the latest Task Pack context.", tone: "success" };
    case "partial":
      return { label: "Partially aligned", caption: "Some local changes are outside the latest Task Pack context.", tone: "warning" };
    case "outside":
      return { label: "Outside context", caption: "Local changes do not overlap with the latest Task Pack context.", tone: "warning" };
    case "clean":
      return { label: "No local diff", caption: "There are no local changed files to compare.", tone: "success" };
    case "unavailable":
      return { label: "Alignment unavailable", caption: "Task Pack history could not be loaded for comparison.", tone: "muted" };
    default:
      return { label: "Alignment", caption: "Compare local changes with the latest Task Pack.", tone: "muted" };
  }
}

function normalizePath(path: string) {
  return path.replace(/\\/g, "/").toLowerCase();
}

function touchesUi(file: GitDiffFileSummary) {
  const path = normalizePath(file.path);
  return (
    path.includes("/pages/") ||
    path.includes("/components/") ||
    path.includes("/renderer/") ||
    path.includes("/client/") ||
    path.endsWith(".tsx") ||
    path.endsWith(".jsx") ||
    path.endsWith(".css") ||
    path.endsWith(".scss") ||
    path.endsWith(".sass")
  );
}

function touchesCoreOrApi(file: GitDiffFileSummary) {
  const path = normalizePath(file.path);
  return (
    path.startsWith("server/") ||
    path.startsWith("src/server") ||
    path.includes("/routes/") ||
    path.includes("/api") ||
    path.includes("/db/") ||
    path.includes("/database") ||
    path.includes("/selector") ||
    path.includes("/composer") ||
    path.includes("/pipeline")
  );
}

function touchesTests(file: GitDiffFileSummary) {
  const path = normalizePath(file.path);
  return (
    path.includes("__tests__") ||
    path.includes("/tests/") ||
    path.includes("/test/") ||
    path.includes(".test.") ||
    path.includes(".spec.") ||
    path.includes("vitest") ||
    path.includes("playwright") ||
    path.includes("cypress")
  );
}

function touchesProtectedOrConfig(file: GitDiffFileSummary) {
  const path = normalizePath(file.path);
  const fileName = path.split("/").pop() ?? path;

  return (
    fileName === ".env" ||
    fileName.startsWith(".env.") ||
    fileName === "agents.md" ||
    fileName === "package.json" ||
    fileName === "package-lock.json" ||
    fileName === "pnpm-lock.yaml" ||
    fileName === "yarn.lock" ||
    fileName === "bun.lockb" ||
    fileName.startsWith("tsconfig") ||
    fileName.startsWith("vite.config") ||
    fileName.startsWith("electron-builder") ||
    fileName === "docker-compose.yml" ||
    fileName === "docker-compose.yaml" ||
    path.includes("/.github/workflows/")
  );
}

function buildReviewSignals(diffSummary: GitDiffSummaryResult): DiffReviewSignal[] {
  if (!diffSummary.isGitRepo) return [];

  if (!diffSummary.dirty) {
    return [
      {
        id: "clean",
        label: "Clean working tree",
        description: "No staged, unstaged, or untracked changes were detected.",
        tone: "success"
      }
    ];
  }

  const totalLineChurn = diffSummary.totals.additions + diffSummary.totals.deletions;
  const hasLargeDiff = diffSummary.totals.filesChanged >= 10 || totalLineChurn >= 800;
  const hasCoreOrApi = diffSummary.files.some(touchesCoreOrApi);
  const hasProtectedOrConfig = diffSummary.files.some(touchesProtectedOrConfig);
  const hasTests = diffSummary.files.some(touchesTests);
  const hasUntracked = diffSummary.totals.untrackedFiles > 0;
  const hasBinary = diffSummary.totals.binaryFiles > 0;

  const signals: DiffReviewSignal[] = [];

  if (hasLargeDiff) {
    signals.push({
      id: "large-diff",
      label: "Large diff",
      description: "The local change set is broad. Review the scope before asking an AI agent to continue.",
      tone: "warning"
    });
  }

  if (hasCoreOrApi) {
    signals.push({
      id: "core-api",
      label: "Core/API touched",
      description: "Backend, API, data, selector, composer, or pipeline files appear in the local changes.",
      tone: "warning"
    });
  }

  if (hasProtectedOrConfig) {
    signals.push({
      id: "protected-config",
      label: "Config/protected files",
      description: "Project config, lockfiles, env files, CI workflows, or AI instruction files appear in the local changes.",
      tone: "warning"
    });
  }

  if (!hasTests) {
    signals.push({
      id: "no-tests",
      label: "No tests changed",
      description: "No obvious test/spec files were changed. Run existing verification manually if needed.",
      tone: "muted"
    });
  }

  if (hasUntracked) {
    signals.push({
      id: "untracked",
      label: "Untracked files",
      description: "New files are present locally. Confirm they are intentional before exporting or committing.",
      tone: "warning"
    });
  }

  if (hasBinary) {
    signals.push({
      id: "binary",
      label: "Binary changes",
      description: "Binary changes cannot be summarized by line additions and deletions.",
      tone: "muted"
    });
  }

  if (signals.length === 0) {
    signals.push({
      id: "small-diff",
      label: "Small local diff",
      description: "The current change set looks compact from metadata only.",
      tone: "success"
    });
  }

  return signals;
}

function buildSuggestedChecks(diffSummary: GitDiffSummaryResult, signals: DiffReviewSignal[]) {
  if (!diffSummary.isGitRepo || !diffSummary.dirty) return [];

  const files = diffSummary.files;
  const hasUi = files.some(touchesUi);
  const hasCoreOrApi = files.some(touchesCoreOrApi);
  const hasProtectedOrConfig = files.some(touchesProtectedOrConfig);
  const signalIds = new Set(signals.map((signal) => signal.id));
  const checks: string[] = [];

  checks.push("Run the existing build or test command before exporting the Task Pack.");

  if (hasUi) {
    checks.push("Open affected UI screens/components and check the layout manually.");
  }

  if (hasCoreOrApi) {
    checks.push("Verify backend/API behavior and response contracts if these changes continue.");
  }

  if (hasProtectedOrConfig) {
    checks.push("Review config, env, lockfile, CI, or AGENTS.md changes before sharing or exporting context.");
  }

  if (signalIds.has("large-diff")) {
    checks.push("Add a precise task note if the AI should review only part of this change set.");
  }

  if (signalIds.has("untracked")) {
    checks.push("Confirm untracked files are intentional before committing or sharing context.");
  }

  return checks.slice(0, 4);
}

export function GitDiffSummaryCard({ projectId, enabled }: GitDiffSummaryCardProps) {
  const [diffSummary, setDiffSummary] = useState<GitDiffSummaryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasRequested, setHasRequested] = useState(false);
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const [reviewVerdict, setReviewVerdict] = useState<ReviewVerdict>("none");
  const [taskPacks, setTaskPacks] = useState<TaskPack[] | null>(null);
  const [taskPackError, setTaskPackError] = useState<string | null>(null);
  const [isLoadingTaskPacks, setIsLoadingTaskPacks] = useState(false);

  const loadDiffSummary = useCallback(async () => {
    if (!enabled) return;

    setIsLoading(true);
    setIsLoadingTaskPacks(true);
    setError(null);
    setTaskPackError(null);

    try {
      const [nextDiffSummary, nextTaskPacksResult] = await Promise.all([
        getProjectGitDiffSummary(projectId),
        getTaskPacks()
          .then((items) => ({ ok: true as const, items }))
          .catch((requestError) => ({
            ok: false as const,
            message: requestError instanceof Error ? requestError.message : "Failed to read Task Pack history"
          }))
      ]);

      setDiffSummary(nextDiffSummary);

      if ("items" in nextTaskPacksResult) {
        setTaskPacks(nextTaskPacksResult.items);
        setTaskPackError(null);
      } else {
        setTaskPacks([]);
        setTaskPackError(nextTaskPacksResult.message);
      }

      setHasRequested(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to read local diff summary");
      setHasRequested(true);
    } finally {
      setIsLoading(false);
      setIsLoadingTaskPacks(false);
    }
  }, [enabled, projectId]);

  useEffect(() => {
    if (!enabled || hasRequested) return;
    void loadDiffSummary();
  }, [enabled, hasRequested, loadDiffSummary]);

  useEffect(() => {
    setDiffSummary(null);
    setError(null);
    setHasRequested(false);
    setIsReviewOpen(false);
    setReviewVerdict("none");
    setTaskPacks(null);
    setTaskPackError(null);
    setIsLoadingTaskPacks(false);
  }, [projectId]);

  const previewFiles = useMemo(
    () => (diffSummary?.isGitRepo ? diffSummary.files.slice(0, DIFF_PREVIEW_LIMIT) : []),
    [diffSummary]
  );
  const hiddenCount = diffSummary ? Math.max(0, diffSummary.totals.filesChanged - previewFiles.length) : 0;
  const reviewSignals = useMemo(() => (diffSummary?.isGitRepo ? buildReviewSignals(diffSummary) : []), [diffSummary]);
  const suggestedChecks = useMemo(
    () => (diffSummary?.isGitRepo ? buildSuggestedChecks(diffSummary, reviewSignals) : []),
    [diffSummary, reviewSignals]
  );
  const primarySignals = reviewSignals.slice(0, 3);
  const taskPackAlignment = useMemo(
    () => buildTaskPackAlignment(diffSummary, taskPacks, projectId, isLoadingTaskPacks, taskPackError),
    [diffSummary, isLoadingTaskPacks, projectId, taskPackError, taskPacks]
  );
  const alignmentCopy = useMemo(() => getAlignmentCopy(taskPackAlignment), [taskPackAlignment]);

  return (
    <section className="mt-4 rounded-[1.35rem] border border-neutral-900 bg-black/30 p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-300">
            <GitCompareArrows size={16} />
          </div>

          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium text-white">Diff summary</p>
              <DiffBadge tone={diffSummary?.dirty ? "warning" : diffSummary?.isGitRepo ? "success" : "muted"}>
                {isLoading && !diffSummary ? <Loader2 size={12} className="animate-spin" /> : null}
                {diffSummary
                  ? diffSummary.isGitRepo
                    ? diffSummary.dirty
                      ? `${diffSummary.totals.filesChanged} file summaries`
                      : "No local diff"
                    : "No Git repo"
                  : isLoading
                    ? "Reading diff"
                    : "Not loaded"}
              </DiffBadge>
            </div>

            <p className="text-xs leading-5 text-neutral-600">
              Metadata-only local diff summary. Raw patch content is not sent or shown here.
            </p>
          </div>
        </div>

        <Button
          type="button"
          variant="ghost"
          disabled={isLoading || !enabled}
          onClick={() => void loadDiffSummary()}
          className="shrink-0"
        >
          <RefreshCw size={14} className={isLoading ? "animate-spin" : ""} />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-400/15 bg-red-400/10 p-4 text-sm leading-5 text-red-100">
          <div className="mb-1 flex items-center gap-2 font-medium">
            <AlertTriangle size={15} />
            Diff summary unavailable
          </div>
          {error}
        </div>
      )}

      {!error && !diffSummary && (
        <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4 text-sm leading-5 text-neutral-500">
          {isLoading ? "Reading local diff summary…" : "Open this section to load local diff metadata."}
        </div>
      )}

      {!error && diffSummary && !diffSummary.isGitRepo && (
        <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-white">
            <GitCompareArrows size={15} />
            No local Git repository detected
          </div>
          <p className="text-sm leading-5 text-neutral-500">
            Diff Review Lite needs a local Git working tree. ContextForge can still build Task Packs from scanner data.
          </p>
        </div>
      )}

      {!error && diffSummary?.isGitRepo && (
        <div className="space-y-3">
          <div className="grid overflow-hidden rounded-2xl border border-neutral-900 bg-black/35 sm:grid-cols-2 lg:grid-cols-4">
            <DiffMetric label="Files" value={diffSummary.totals.filesChanged} caption={buildScopeSummary(diffSummary)} />
            <DiffMetric label="Added" value={`+${diffSummary.totals.additions}`} caption="tracked line additions" withDivider />
            <DiffMetric label="Deleted" value={`-${diffSummary.totals.deletions}`} caption="tracked line deletions" withDivider />
            <DiffMetric label="Binary" value={diffSummary.totals.binaryFiles} caption="binary file changes" withDivider />
          </div>

          <div className="rounded-2xl border border-neutral-900 bg-black/35 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-400">
                  <Link2 size={14} />
                </span>
                <div className="min-w-0">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <p className="text-xs font-medium text-white">Task Pack alignment</p>
                    <DiffBadge tone={alignmentCopy.tone}>
                      {taskPackAlignment.status === "loading" ? <Loader2 size={12} className="animate-spin" /> : null}
                      {alignmentCopy.label}
                    </DiffBadge>
                  </div>
                  <p className="text-xs leading-5 text-neutral-600">
                    Compares this local diff with the latest saved Task Pack context. Metadata only; it does not judge code quality.
                  </p>
                  {taskPackAlignment.taskPack && (
                    <p className="mt-1 truncate text-[11px] text-neutral-700">
                      Latest: {truncateText(taskPackAlignment.taskPack.title)}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid w-full gap-2 sm:w-auto sm:grid-cols-3">
                <div className="rounded-xl border border-neutral-900 bg-black/25 px-3 py-2">
                  <p className="cf-tech-label text-[9px] uppercase text-neutral-700">Overlap</p>
                  <p className="mt-1 text-sm font-semibold text-white">{taskPackAlignment.overlapPaths.length}</p>
                </div>
                <div className="rounded-xl border border-neutral-900 bg-black/25 px-3 py-2">
                  <p className="cf-tech-label text-[9px] uppercase text-neutral-700">Outside</p>
                  <p className="mt-1 text-sm font-semibold text-white">{taskPackAlignment.outsidePaths.length}</p>
                </div>
                <div className="rounded-xl border border-neutral-900 bg-black/25 px-3 py-2">
                  <p className="cf-tech-label text-[9px] uppercase text-neutral-700">Context</p>
                  <p className="mt-1 text-sm font-semibold text-white">{taskPackAlignment.selectedPaths.length}</p>
                </div>
              </div>
            </div>

            <div className="mt-3 rounded-xl border border-neutral-900 bg-black/25 px-3 py-2 text-xs leading-5 text-neutral-500">
              {alignmentCopy.caption}
              {taskPackAlignment.outsidePaths.length > 0 && (
                <span className="mt-2 block text-neutral-600">
                  Outside latest context: {taskPackAlignment.outsidePaths.slice(0, 3).map((filePath) => truncateText(filePath, 44)).join(", ")}
                  {taskPackAlignment.outsidePaths.length > 3 ? `, +${taskPackAlignment.outsidePaths.length - 3} more` : ""}
                </span>
              )}
              {taskPackError && <span className="mt-2 block text-amber-100/70">{taskPackError}</span>}
            </div>
          </div>

          {diffSummary.dirty && (
            <div className="rounded-2xl border border-neutral-900 bg-black/35 p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="cf-tech-label mr-1 text-[10px] uppercase text-neutral-600">Review signals</span>
                  {primarySignals.map((signal) => (
                    <DiffBadge key={signal.id} tone={signal.tone}>
                      {signal.tone === "success" ? <CheckCircle2 size={12} /> : signal.tone === "danger" || signal.tone === "warning" ? <AlertTriangle size={12} /> : <ShieldCheck size={12} />}
                      {signal.label}
                    </DiffBadge>
                  ))}
                  {reviewSignals.length > primarySignals.length && (
                    <span className="text-xs text-neutral-600">+{reviewSignals.length - primarySignals.length} more</span>
                  )}
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setIsReviewOpen((current) => !current)}
                  className="shrink-0"
                >
                  <ShieldCheck size={14} />
                  {isReviewOpen ? "Hide review" : "Review changes"}
                </Button>
              </div>

              {isReviewOpen && (
                <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1fr_1.1fr]">
                  <div className="rounded-xl border border-neutral-900 bg-black/25 p-3">
                    <p className="mb-2 text-xs font-medium text-white">Signals</p>
                    <div className="space-y-2">
                      {reviewSignals.map((signal) => (
                        <div key={signal.id} className="rounded-lg border border-neutral-900 bg-black/25 p-2">
                          <div className="mb-1 flex items-center gap-2 text-xs font-medium text-neutral-200">
                            {signal.tone === "success" ? <CheckCircle2 size={13} className="text-emerald-300" /> : signal.tone === "danger" || signal.tone === "warning" ? <AlertTriangle size={13} className="text-amber-200" /> : <ShieldCheck size={13} className="text-neutral-500" />}
                            {signal.label}
                          </div>
                          <p className="text-[11px] leading-4 text-neutral-600">{signal.description}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl border border-neutral-900 bg-black/25 p-3">
                    <p className="mb-2 text-xs font-medium text-white">Suggested verification</p>
                    {suggestedChecks.length > 0 ? (
                      <ul className="space-y-2 text-xs leading-5 text-neutral-400">
                        {suggestedChecks.map((check) => (
                          <li key={check} className="flex gap-2">
                            <CheckCircle2 size={13} className="mt-1 shrink-0 text-neutral-600" />
                            <span>{check}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs leading-5 text-neutral-600">No extra verification hints for this clean working tree.</p>
                    )}
                  </div>

                  <div className="rounded-xl border border-neutral-900 bg-black/25 p-3">
                    <p className="mb-2 text-xs font-medium text-white">Manual verdict</p>
                    <p className="mb-3 text-xs leading-5 text-neutral-600">
                      Local marker only. It does not commit, push, or change project files.
                    </p>
                    <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
                      {VERDICT_OPTIONS.map((option) => {
                        const isSelected = reviewVerdict === option.id;
                        return (
                          <button
                            key={option.id}
                            type="button"
                            aria-pressed={isSelected}
                            onClick={() => setReviewVerdict(isSelected ? "none" : option.id)}
                            className={[
                              "rounded-xl border px-3 py-2 text-left transition",
                              isSelected
                                ? option.id === "looks-good"
                                  ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
                                  : option.id === "blocked"
                                    ? "border-red-400/30 bg-red-400/10 text-red-100"
                                    : "border-amber-300/30 bg-amber-300/10 text-amber-100"
                                : "border-neutral-900 bg-black/25 text-neutral-500 hover:border-neutral-700 hover:text-neutral-200"
                            ].join(" ")}
                          >
                            <span className="block text-xs font-medium">{option.label}</span>
                            <span className="mt-1 block text-[10px] leading-4 opacity-70">{option.caption}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="cf-tech-label mb-1 text-[10px] uppercase text-neutral-600">
                  Local diff files
                </p>
                <p className="text-xs leading-5 text-neutral-600">
                  Use this to review what is already changed before asking an AI agent for follow-up work.
                </p>
              </div>
              <DiffBadge tone={diffSummary.dirty ? "warning" : "success"}>
                <ShieldCheck size={12} />
                {diffSummary.dirty ? "Review suggested" : "Clean"}
              </DiffBadge>
            </div>

            {previewFiles.length === 0 ? (
              <div className="rounded-xl border border-emerald-400/15 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-100">
                <CheckCircle2 size={14} className="mr-2 inline" />
                No staged or unstaged diff detected.
              </div>
            ) : (
              <div className="space-y-2">
                {previewFiles.map((file, index) => {
                  const lineStatLabel = getLineStatLabel(file);
                  const additionsLabel = formatLineCount(file.additions, "+");
                  const deletionsLabel = formatLineCount(file.deletions, "-");

                  return (
                    <div
                      key={`${file.scope}-${file.path}-${index}`}
                      className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-neutral-900 bg-black/25 px-3 py-2"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <FileCode2 size={13} className="shrink-0 text-neutral-500" />
                        <div className="min-w-0">
                          <p className="truncate text-xs text-neutral-300">{file.path}</p>
                          {file.originalPath && (
                            <p className="truncate text-[11px] text-neutral-700">from {file.originalPath}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {lineStatLabel ? (
                          <span className="hidden rounded-full border border-neutral-800 bg-black/35 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-neutral-500 sm:inline-flex">
                            {lineStatLabel}
                          </span>
                        ) : (
                          <>
                            <span className="hidden rounded-full border border-emerald-400/15 bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-100 sm:inline-flex">
                              <Plus size={10} />
                              {additionsLabel}
                            </span>
                            <span className="hidden rounded-full border border-red-400/15 bg-red-400/10 px-2 py-0.5 text-[10px] text-red-100 sm:inline-flex">
                              <Minus size={10} />
                              {deletionsLabel}
                            </span>
                          </>
                        )}
                        <span className="rounded-full border border-neutral-800 bg-black/35 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-neutral-500">
                          {SCOPE_LABELS[file.scope]}
                        </span>
                        <span className="rounded-full border border-neutral-800 bg-black/35 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-neutral-500">
                          {STATUS_LABELS[file.status]}
                        </span>
                      </div>
                    </div>
                  );
                })}

                {hiddenCount > 0 && (
                  <p className="px-1 text-xs text-neutral-600">
                    +{hiddenCount} more changed file summaries hidden from this compact preview.
                  </p>
                )}
              </div>
            )}
          </div>

          {diffSummary.warnings.length > 0 && (
            <div className="rounded-2xl border border-amber-300/15 bg-amber-300/10 p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-100">
                <AlertTriangle size={15} />
                Diff notes
              </div>
              <ul className="space-y-1 text-sm leading-5 text-amber-100/80">
                {diffSummary.warnings.slice(0, 3).map((warning) => (
                  <li key={warning}>• {warning}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
