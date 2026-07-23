import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Clock3,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequestDraft,
  Loader2,
  RefreshCw
} from "lucide-react";

import { getProjectGitStatus } from "../../api/client";
import type { GitStatusResult } from "../../types";
import { Button } from "../ui/Button";

interface GitContextCardProps {
  projectId: number;
  enabled: boolean;
}

type GitBucket = "staged" | "unstaged" | "untracked";

const BUCKET_META: Record<GitBucket, { label: string; caption: string }> = {
  staged: {
    label: "Staged",
    caption: "ready to commit"
  },
  unstaged: {
    label: "Unstaged",
    caption: "local edits"
  },
  untracked: {
    label: "Untracked",
    caption: "new files"
  }
};

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

function getStatusLabel(status: GitStatusResult) {
  if (!status.isGitRepo) return "No Git repo";
  if (!status.dirty) return "Clean working tree";
  return `${status.summary.totalChanged} changed`;
}

function GitMetric({ label, value, caption, withDivider = false }: { label: string; value: number; caption: string; withDivider?: boolean }) {
  return (
    <div className={["min-w-0 px-4 py-3", withDivider ? "border-l border-neutral-900" : ""].join(" ")}>
      <p className="cf-tech-label text-[10px] uppercase text-neutral-600">{label}</p>
      <p className="cf-display-font mt-1 text-xl font-semibold text-white">{value}</p>
      <p className="mt-1 truncate text-xs text-neutral-600">{caption}</p>
    </div>
  );
}

function GitBadge({ children, tone = "muted" }: { children: ReactNode; tone?: "success" | "warning" | "muted" }) {
  const toneClass =
    tone === "success"
      ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
      : tone === "warning"
        ? "border-amber-300/20 bg-amber-300/10 text-amber-100"
        : "border-neutral-800 bg-black/35 text-neutral-400";

  return (
    <span className={["inline-flex min-w-0 items-center gap-1 rounded-full border px-2 py-1 text-[11px]", toneClass].join(" ")}>
      {children}
    </span>
  );
}

export function GitContextCard({ projectId, enabled }: GitContextCardProps) {
  const [status, setStatus] = useState<GitStatusResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasRequested, setHasRequested] = useState(false);

  const loadStatus = useCallback(async () => {
    if (!enabled) return;

    setIsLoading(true);
    setError(null);

    try {
      const nextStatus = await getProjectGitStatus(projectId);
      setStatus(nextStatus);
      setHasRequested(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to read Git status");
      setHasRequested(true);
    } finally {
      setIsLoading(false);
    }
  }, [enabled, projectId]);

  useEffect(() => {
    if (!enabled || hasRequested) return;
    void loadStatus();
  }, [enabled, hasRequested, loadStatus]);

  useEffect(() => {
    setStatus(null);
    setError(null);
    setHasRequested(false);
  }, [projectId]);

  return (
    <section className="mt-4 rounded-[1.35rem] border border-neutral-900 bg-black/30 p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-300">
            <GitBranch size={16} />
          </div>

          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium text-white">Repository status</p>
              <GitBadge tone={status && !status.dirty && status.isGitRepo ? "success" : status?.dirty ? "warning" : "muted"}>
                {isLoading && !status ? <Loader2 size={12} className="animate-spin" /> : null}
                {status ? getStatusLabel(status) : isLoading ? "Reading status" : "Not loaded"}
              </GitBadge>
            </div>

            <p className="text-xs leading-5 text-neutral-600">
              Branch, latest commit, and local file state. No commits or pushes are performed here.
            </p>
          </div>
        </div>

        <Button
          type="button"
          variant="ghost"
          disabled={isLoading || !enabled}
          onClick={() => void loadStatus()}
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
            Git status unavailable
          </div>
          {error}
        </div>
      )}

      {!error && !status && (
        <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4 text-sm leading-5 text-neutral-500">
          {isLoading ? "Reading local Git status…" : "Open this section to load local Git status."}
        </div>
      )}

      {!error && status && !status.isGitRepo && (
        <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-white">
            <GitPullRequestDraft size={15} />
            No local Git repository detected
          </div>
          <p className="text-sm leading-5 text-neutral-500">
            This project folder does not look like a Git working tree yet. ContextForge will keep working with scanner data, and Git context can appear after the project is initialized with Git.
          </p>
          {status.warnings.length > 0 && (
            <p className="mt-3 text-xs text-neutral-600">{status.warnings[0]}</p>
          )}
        </div>
      )}

      {!error && status?.isGitRepo && (
        <div className="space-y-3">
          <div className="overflow-hidden rounded-2xl border border-neutral-900 bg-black/35">
            <div className="flex flex-wrap items-start justify-between gap-4 p-4">
              <div className="min-w-0">
                <div className="mb-3 flex flex-wrap gap-2">
                <GitBadge tone="muted">
                  <GitBranch size={12} />
                  {status.isDetachedHead ? "Detached" : status.branch ?? "Unknown branch"}
                </GitBadge>
                <GitBadge tone={status.dirty ? "warning" : "success"}>
                  {status.dirty ? "Uncommitted changes" : "Clean"}
                </GitBadge>
                {status.summary.isTruncated && <GitBadge tone="warning">Large status</GitBadge>}
              </div>

                {status.latestCommit ? (
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="grid size-8 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-300">
                      <GitCommitHorizontal size={14} />
                    </div>
                    <div className="min-w-0">
                      <p className="cf-tech-label mb-1 text-[9px] uppercase text-neutral-700">Latest commit</p>
                      <p className="truncate text-sm font-medium text-white">
                        {status.latestCommit.subject}
                      </p>
                      <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-600">
                        <span>{status.latestCommit.shortHash}</span>
                        <span>·</span>
                        <span>{status.latestCommit.author}</span>
                      </p>
                      <p className="mt-1 flex items-center gap-1 text-xs text-neutral-700">
                        <Clock3 size={12} />
                        {formatDate(status.latestCommit.date)}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm leading-5 text-neutral-500">Latest commit could not be read.</p>
                )}
              </div>

              <div className="rounded-xl border border-neutral-900 bg-black/25 px-3 py-2 text-right">
                <p className="cf-tech-label text-[9px] uppercase text-neutral-700">Changed files</p>
                <p className="mt-1 text-xl font-semibold text-white">{status.summary.totalChanged}</p>
              </div>
            </div>

            <div className="grid grid-cols-3 border-t border-neutral-900">
              <GitMetric
                label={BUCKET_META.staged.label}
                value={status.summary.stagedCount}
                caption={BUCKET_META.staged.caption}
              />
              <GitMetric
                label={BUCKET_META.unstaged.label}
                value={status.summary.unstagedCount}
                caption={BUCKET_META.unstaged.caption}
                withDivider
              />
              <GitMetric
                label={BUCKET_META.untracked.label}
                value={status.summary.untrackedCount}
                caption={BUCKET_META.untracked.caption}
                withDivider
              />
            </div>
          </div>

          {status.warnings.length > 0 && (
            <div className="rounded-2xl border border-amber-300/15 bg-amber-300/10 p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-100">
                <AlertTriangle size={15} />
                Git status notes
              </div>
              <ul className="space-y-1 text-sm leading-5 text-amber-100/80">
                {status.warnings.slice(0, 3).map((warning) => (
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
