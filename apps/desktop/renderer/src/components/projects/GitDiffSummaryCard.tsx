import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
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

const SCOPE_LABEL_KEYS: Record<GitDiffFileSummary["scope"], string> = {
  staged: "projectDetailsPage.diff.scope.staged",
  unstaged: "projectDetailsPage.diff.scope.unstaged",
  untracked: "projectDetailsPage.diff.scope.untracked"
};

const STATUS_LABEL_KEYS: Record<GitDiffFileSummary["status"], string> = {
  added: "projectDetailsPage.diff.status.added",
  modified: "projectDetailsPage.diff.status.modified",
  deleted: "projectDetailsPage.diff.status.deleted",
  renamed: "projectDetailsPage.diff.status.renamed",
  copied: "projectDetailsPage.diff.status.copied",
  unmerged: "projectDetailsPage.diff.status.unmerged",
  untracked: "projectDetailsPage.diff.status.new",
  unknown: "projectDetailsPage.diff.status.changed"
};



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

function getLineStatLabel(file: GitDiffFileSummary, t: TFunction) {
  if (file.additions === null || file.deletions === null) {
    return file.binary
      ? t("projectDetailsPage.diff.lineStats.binary")
      : t("projectDetailsPage.diff.lineStats.notMeasured");
  }

  if (file.status === "untracked") {
    return t("projectDetailsPage.diff.lineStats.notMeasured");
  }

  return null;
}

function buildScopeSummary(diffSummary: GitDiffSummaryResult, t: TFunction) {
  const parts = [
    t("projectDetailsPage.diff.scopeCount.staged", { count: diffSummary.totals.stagedFiles }),
    t("projectDetailsPage.diff.scopeCount.unstaged", { count: diffSummary.totals.unstagedFiles }),
    t("projectDetailsPage.diff.scopeCount.untracked", { count: diffSummary.totals.untrackedFiles })
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

function getAlignmentCopy(alignment: TaskPackDiffAlignment, t: TFunction): { label: string; caption: string; tone: DiffBadgeTone } {
  switch (alignment.status) {
    case "loading":
      return { label: t("projectDetailsPage.diff.alignment.checking"), caption: t("projectDetailsPage.diff.alignment.checkingDesc"), tone: "muted" };
    case "no-task-pack":
      return { label: t("projectDetailsPage.diff.alignment.noTaskPack"), caption: t("projectDetailsPage.diff.alignment.noTaskPackDesc"), tone: "muted" };
    case "no-context":
      return { label: t("projectDetailsPage.diff.alignment.noContext"), caption: t("projectDetailsPage.diff.alignment.noContextDesc"), tone: "warning" };
    case "aligned":
      return { label: t("projectDetailsPage.diff.alignment.aligned"), caption: t("projectDetailsPage.diff.alignment.alignedDesc"), tone: "success" };
    case "partial":
      return { label: t("projectDetailsPage.diff.alignment.partial"), caption: t("projectDetailsPage.diff.alignment.partialDesc"), tone: "warning" };
    case "outside":
      return { label: t("projectDetailsPage.diff.alignment.outside"), caption: t("projectDetailsPage.diff.alignment.outsideDesc"), tone: "warning" };
    case "clean":
      return { label: t("projectDetailsPage.diff.alignment.clean"), caption: t("projectDetailsPage.diff.alignment.cleanDesc"), tone: "success" };
    case "unavailable":
      return { label: t("projectDetailsPage.diff.alignment.unavailable"), caption: t("projectDetailsPage.diff.alignment.unavailableDesc"), tone: "muted" };
    default:
      return { label: t("projectDetailsPage.diff.alignment.title"), caption: t("projectDetailsPage.diff.alignment.description"), tone: "muted" };
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

function buildReviewSignals(diffSummary: GitDiffSummaryResult, t: TFunction): DiffReviewSignal[] {
  if (!diffSummary.isGitRepo) return [];

  if (!diffSummary.dirty) {
    return [
      {
        id: "clean",
        label: t("projectDetailsPage.diff.signals.clean"),
        description: t("projectDetailsPage.diff.signals.cleanDesc"),
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
      label: t("projectDetailsPage.diff.signals.large"),
      description: t("projectDetailsPage.diff.signals.largeDesc"),
      tone: "warning"
    });
  }

  if (hasCoreOrApi) {
    signals.push({
      id: "core-api",
      label: t("projectDetailsPage.diff.signals.coreApi"),
      description: t("projectDetailsPage.diff.signals.coreApiDesc"),
      tone: "warning"
    });
  }

  if (hasProtectedOrConfig) {
    signals.push({
      id: "protected-config",
      label: t("projectDetailsPage.diff.signals.protected"),
      description: t("projectDetailsPage.diff.signals.protectedDesc"),
      tone: "warning"
    });
  }

  if (!hasTests) {
    signals.push({
      id: "no-tests",
      label: t("projectDetailsPage.diff.signals.noTests"),
      description: t("projectDetailsPage.diff.signals.noTestsDesc"),
      tone: "muted"
    });
  }

  if (hasUntracked) {
    signals.push({
      id: "untracked",
      label: t("projectDetailsPage.diff.signals.untracked"),
      description: t("projectDetailsPage.diff.signals.untrackedDesc"),
      tone: "warning"
    });
  }

  if (hasBinary) {
    signals.push({
      id: "binary",
      label: t("projectDetailsPage.diff.signals.binary"),
      description: t("projectDetailsPage.diff.signals.binaryDesc"),
      tone: "muted"
    });
  }

  if (signals.length === 0) {
    signals.push({
      id: "small-diff",
      label: t("projectDetailsPage.diff.signals.small"),
      description: t("projectDetailsPage.diff.signals.smallDesc"),
      tone: "success"
    });
  }

  return signals;
}

function buildSuggestedChecks(diffSummary: GitDiffSummaryResult, signals: DiffReviewSignal[], t: TFunction) {
  if (!diffSummary.isGitRepo || !diffSummary.dirty) return [];

  const files = diffSummary.files;
  const hasUi = files.some(touchesUi);
  const hasCoreOrApi = files.some(touchesCoreOrApi);
  const hasProtectedOrConfig = files.some(touchesProtectedOrConfig);
  const signalIds = new Set(signals.map((signal) => signal.id));
  const checks: string[] = [];

  checks.push(t("projectDetailsPage.diff.verification.buildOrTest"));

  if (hasUi) {
    checks.push(t("projectDetailsPage.diff.verification.ui"));
  }

  if (hasCoreOrApi) {
    checks.push(t("projectDetailsPage.diff.verification.backend"));
  }

  if (hasProtectedOrConfig) {
    checks.push(t("projectDetailsPage.diff.verification.config"));
  }

  if (signalIds.has("large-diff")) {
    checks.push(t("projectDetailsPage.diff.verification.scope"));
  }

  if (signalIds.has("untracked")) {
    checks.push(t("projectDetailsPage.diff.verification.untracked"));
  }

  return checks.slice(0, 4);
}

export function GitDiffSummaryCard({ projectId, enabled }: GitDiffSummaryCardProps) {
  const { t } = useTranslation();
  const verdictOptions: Array<{ id: ReviewVerdict; label: string; caption: string }> = [
    { id: "looks-good", label: t("projectDetailsPage.diff.verdict.looksGood"), caption: t("projectDetailsPage.diff.verdict.looksGoodDesc") },
    { id: "needs-changes", label: t("projectDetailsPage.diff.verdict.needsChanges"), caption: t("projectDetailsPage.diff.verdict.needsChangesDesc") },
    { id: "blocked", label: t("projectDetailsPage.diff.verdict.blocked"), caption: t("projectDetailsPage.diff.verdict.blockedDesc") }
  ];
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
            message: requestError instanceof Error ? requestError.message : t("projectDetailsPage.diff.taskPackHistoryError")
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
      setError(requestError instanceof Error ? requestError.message : t("projectDetailsPage.diff.readError"));
      setHasRequested(true);
    } finally {
      setIsLoading(false);
      setIsLoadingTaskPacks(false);
    }
  }, [enabled, projectId, t]);

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
  const reviewSignals = useMemo(() => (diffSummary?.isGitRepo ? buildReviewSignals(diffSummary, t) : []), [diffSummary, t]);
  const suggestedChecks = useMemo(
    () => (diffSummary?.isGitRepo ? buildSuggestedChecks(diffSummary, reviewSignals, t) : []),
    [diffSummary, reviewSignals, t]
  );
  const primarySignals = reviewSignals.slice(0, 3);
  const taskPackAlignment = useMemo(
    () => buildTaskPackAlignment(diffSummary, taskPacks, projectId, isLoadingTaskPacks, taskPackError),
    [diffSummary, isLoadingTaskPacks, projectId, taskPackError, taskPacks]
  );
  const alignmentCopy = useMemo(() => getAlignmentCopy(taskPackAlignment, t), [taskPackAlignment, t]);

  return (
    <section className="mt-4 rounded-[1.35rem] border border-neutral-900 bg-black/30 p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-300">
            <GitCompareArrows size={16} />
          </div>

          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium text-white">{t("projectDetailsPage.diff.title")}</p>
              <DiffBadge tone={diffSummary?.dirty ? "warning" : diffSummary?.isGitRepo ? "success" : "muted"}>
                {isLoading && !diffSummary ? <Loader2 size={12} className="animate-spin" /> : null}
                {diffSummary
                  ? diffSummary.isGitRepo
                    ? diffSummary.dirty
                      ? t("projectDetailsPage.counts.fileSummary", { count: diffSummary.totals.filesChanged })
                      : t("projectDetailsPage.diff.noLocalDiff")
                    : t("projectDetailsPage.gitStatus.noRepo")
                  : isLoading
                    ? t("projectDetailsPage.diff.reading")
                    : t("projectDetailsPage.gitStatus.notLoaded")}
              </DiffBadge>
            </div>

            <p className="text-xs leading-5 text-neutral-600">
              {t("projectDetailsPage.diff.description")}
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
          {t("projectDetailsPage.actions.refresh")}
        </Button>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-400/15 bg-red-400/10 p-4 text-sm leading-5 text-red-100">
          <div className="mb-1 flex items-center gap-2 font-medium">
            <AlertTriangle size={15} />
            {t("projectDetailsPage.diff.unavailable")}
          </div>
          {error}
        </div>
      )}

      {!error && !diffSummary && (
        <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4 text-sm leading-5 text-neutral-500">
          {isLoading ? t("projectDetailsPage.diff.readingLocal") : t("projectDetailsPage.diff.openToLoad")}
        </div>
      )}

      {!error && diffSummary && !diffSummary.isGitRepo && (
        <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-white">
            <GitCompareArrows size={15} />
            {t("projectDetailsPage.gitStatus.noRepoTitle")}
          </div>
          <p className="text-sm leading-5 text-neutral-500">
            {t("projectDetailsPage.diff.noRepoDescription")}
          </p>
        </div>
      )}

      {!error && diffSummary?.isGitRepo && (
        <div className="space-y-3">
          <div className="grid overflow-hidden rounded-2xl border border-neutral-900 bg-black/35 sm:grid-cols-2 lg:grid-cols-4">
            <DiffMetric label={t("projectDetailsPage.diff.metrics.files")} value={diffSummary.totals.filesChanged} caption={buildScopeSummary(diffSummary, t)} />
            <DiffMetric label={t("projectDetailsPage.diff.metrics.added")} value={`+${diffSummary.totals.additions}`} caption={t("projectDetailsPage.diff.metrics.addedDesc")} withDivider />
            <DiffMetric label={t("projectDetailsPage.diff.metrics.deleted")} value={`-${diffSummary.totals.deletions}`} caption={t("projectDetailsPage.diff.metrics.deletedDesc")} withDivider />
            <DiffMetric label={t("projectDetailsPage.diff.metrics.binary")} value={diffSummary.totals.binaryFiles} caption={t("projectDetailsPage.diff.metrics.binaryDesc")} withDivider />
          </div>

          <div className="rounded-2xl border border-neutral-900 bg-black/35 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-400">
                  <Link2 size={14} />
                </span>
                <div className="min-w-0">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <p className="text-xs font-medium text-white">{t("projectDetailsPage.diff.alignment.title")}</p>
                    <DiffBadge tone={alignmentCopy.tone}>
                      {taskPackAlignment.status === "loading" ? <Loader2 size={12} className="animate-spin" /> : null}
                      {alignmentCopy.label}
                    </DiffBadge>
                  </div>
                  <p className="text-xs leading-5 text-neutral-600">
                    {t("projectDetailsPage.diff.alignment.description")}
                  </p>
                  {taskPackAlignment.taskPack && (
                    <p className="mt-1 truncate text-[11px] text-neutral-700">
                      {t("projectDetailsPage.diff.latestTaskPack", { title: truncateText(taskPackAlignment.taskPack.title) })}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid w-full gap-2 sm:w-auto sm:grid-cols-3">
                <div className="rounded-xl border border-neutral-900 bg-black/25 px-3 py-2">
                  <p className="cf-tech-label text-[9px] uppercase text-neutral-700">{t("projectDetailsPage.diff.alignment.overlap")}</p>
                  <p className="mt-1 text-sm font-semibold text-white">{taskPackAlignment.overlapPaths.length}</p>
                </div>
                <div className="rounded-xl border border-neutral-900 bg-black/25 px-3 py-2">
                  <p className="cf-tech-label text-[9px] uppercase text-neutral-700">{t("projectDetailsPage.diff.alignment.outsideCount")}</p>
                  <p className="mt-1 text-sm font-semibold text-white">{taskPackAlignment.outsidePaths.length}</p>
                </div>
                <div className="rounded-xl border border-neutral-900 bg-black/25 px-3 py-2">
                  <p className="cf-tech-label text-[9px] uppercase text-neutral-700">{t("projectDetailsPage.diff.alignment.context")}</p>
                  <p className="mt-1 text-sm font-semibold text-white">{taskPackAlignment.selectedPaths.length}</p>
                </div>
              </div>
            </div>

            <div className="mt-3 rounded-xl border border-neutral-900 bg-black/25 px-3 py-2 text-xs leading-5 text-neutral-500">
              {alignmentCopy.caption}
              {taskPackAlignment.outsidePaths.length > 0 && (
                <span className="mt-2 block text-neutral-600">
                  {t("projectDetailsPage.diff.outsideLatestContext", { files: taskPackAlignment.outsidePaths.slice(0, 3).map((filePath) => truncateText(filePath, 44)).join(", ") })}
                  {taskPackAlignment.outsidePaths.length > 3 ? `, ${t("projectDetailsPage.counts.more", { count: taskPackAlignment.outsidePaths.length - 3 })}` : ""}
                </span>
              )}
              {taskPackError && <span className="mt-2 block text-amber-100/70">{taskPackError}</span>}
            </div>
          </div>

          {diffSummary.dirty && (
            <div className="rounded-2xl border border-neutral-900 bg-black/35 p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="cf-tech-label mr-1 text-[10px] uppercase text-neutral-600">{t("projectDetailsPage.diff.reviewSignals")}</span>
                  {primarySignals.map((signal) => (
                    <DiffBadge key={signal.id} tone={signal.tone}>
                      {signal.tone === "success" ? <CheckCircle2 size={12} /> : signal.tone === "danger" || signal.tone === "warning" ? <AlertTriangle size={12} /> : <ShieldCheck size={12} />}
                      {signal.label}
                    </DiffBadge>
                  ))}
                  {reviewSignals.length > primarySignals.length && (
                    <span className="text-xs text-neutral-600">+{t("projectDetailsPage.counts.more", { count: reviewSignals.length - primarySignals.length })}</span>
                  )}
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setIsReviewOpen((current) => !current)}
                  className="shrink-0"
                >
                  <ShieldCheck size={14} />
                  {isReviewOpen ? t("projectDetailsPage.diff.hideReview") : t("projectDetailsPage.diff.reviewChanges")}
                </Button>
              </div>

              {isReviewOpen && (
                <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1fr_1.1fr]">
                  <div className="rounded-xl border border-neutral-900 bg-black/25 p-3">
                    <p className="mb-2 text-xs font-medium text-white">{t("projectDetailsPage.diff.signalsTitle")}</p>
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
                    <p className="mb-2 text-xs font-medium text-white">{t("projectDetailsPage.diff.suggestedVerification")}</p>
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
                      <p className="text-xs leading-5 text-neutral-600">{t("projectDetailsPage.diff.noExtraVerification")}</p>
                    )}
                  </div>

                  <div className="rounded-xl border border-neutral-900 bg-black/25 p-3">
                    <p className="mb-2 text-xs font-medium text-white">{t("projectDetailsPage.diff.manualVerdict")}</p>
                    <p className="mb-3 text-xs leading-5 text-neutral-600">
                      {t("projectDetailsPage.diff.manualVerdictDescription")}
                    </p>
                    <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
                      {verdictOptions.map((option) => {
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
                  {t("projectDetailsPage.diff.localFiles")}
                </p>
                <p className="text-xs leading-5 text-neutral-600">
                  {t("projectDetailsPage.diff.localFilesDescription")}
                </p>
              </div>
              <DiffBadge tone={diffSummary.dirty ? "warning" : "success"}>
                <ShieldCheck size={12} />
                {diffSummary.dirty ? t("projectDetailsPage.diff.reviewSuggested") : t("projectDetailsPage.gitStatus.clean")}
              </DiffBadge>
            </div>

            {previewFiles.length === 0 ? (
              <div className="rounded-xl border border-emerald-400/15 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-100">
                <CheckCircle2 size={14} className="mr-2 inline" />
                {t("projectDetailsPage.diff.noTrackedDiff")}
              </div>
            ) : (
              <div className="space-y-2">
                {previewFiles.map((file, index) => {
                  const lineStatLabel = getLineStatLabel(file, t);
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
                            <p className="truncate text-[11px] text-neutral-700">{t("projectDetailsPage.diff.fromPath", { path: file.originalPath })}</p>
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
                          {t(SCOPE_LABEL_KEYS[file.scope])}
                        </span>
                        <span className="rounded-full border border-neutral-800 bg-black/35 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-neutral-500">
                          {t(STATUS_LABEL_KEYS[file.status])}
                        </span>
                      </div>
                    </div>
                  );
                })}

                {hiddenCount > 0 && (
                  <p className="px-1 text-xs text-neutral-600">
                    {t("projectDetailsPage.diff.hiddenSummaries", { count: hiddenCount })}
                  </p>
                )}
              </div>
            )}
          </div>

          {diffSummary.warnings.length > 0 && (
            <div className="rounded-2xl border border-amber-300/15 bg-amber-300/10 p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-100">
                <AlertTriangle size={15} />
                {t("projectDetailsPage.diff.notes")}
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
