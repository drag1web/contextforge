import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
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

function GitMetric({
  label,
  value,
  caption,
  withDivider = false
}: {
  label: string;
  value: number;
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

function GitBadge({
  children,
  tone = "muted"
}: {
  children: ReactNode;
  tone?: "success" | "warning" | "muted";
}) {
  const toneClass =
    tone === "success"
      ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
      : tone === "warning"
        ? "border-amber-300/20 bg-amber-300/10 text-amber-100"
        : "border-neutral-800 bg-black/35 text-neutral-400";

  return (
    <span
      className={[
        "inline-flex min-w-0 items-center gap-1 rounded-full border px-2 py-1 text-[11px]",
        toneClass
      ].join(" ")}
    >
      {children}
    </span>
  );
}

export function GitContextCard({ projectId, enabled }: GitContextCardProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage?.startsWith("ru") ? "ru-RU" : "en-US";
  const [status, setStatus] = useState<GitStatusResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasRequested, setHasRequested] = useState(false);

  const bucketMeta: Record<GitBucket, { label: string; caption: string }> = {
    staged: {
      label: t("projectDetailsPage.gitStatus.staged"),
      caption: t("projectDetailsPage.gitStatus.stagedDesc")
    },
    unstaged: {
      label: t("projectDetailsPage.gitStatus.unstaged"),
      caption: t("projectDetailsPage.gitStatus.unstagedDesc")
    },
    untracked: {
      label: t("projectDetailsPage.gitStatus.untracked"),
      caption: t("projectDetailsPage.gitStatus.untrackedDesc")
    }
  };

  const loadStatus = useCallback(async () => {
    if (!enabled) return;

    setIsLoading(true);
    setError(null);

    try {
      const nextStatus = await getProjectGitStatus(projectId);
      setStatus(nextStatus);
      setHasRequested(true);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : t("projectDetailsPage.gitStatus.readError")
      );
      setHasRequested(true);
    } finally {
      setIsLoading(false);
    }
  }, [enabled, projectId, t]);

  useEffect(() => {
    if (!enabled || hasRequested) return;
    void loadStatus();
  }, [enabled, hasRequested, loadStatus]);

  useEffect(() => {
    setStatus(null);
    setError(null);
    setHasRequested(false);
  }, [projectId]);

  const statusLabel = status
    ? !status.isGitRepo
      ? t("projectDetailsPage.gitStatus.noRepo")
      : !status.dirty
        ? t("projectDetailsPage.gitStatus.cleanWorkingTree")
        : t("projectDetailsPage.counts.changed", {
            count: status.summary.totalChanged
          })
    : isLoading
      ? t("projectDetailsPage.gitStatus.readingStatus")
      : t("projectDetailsPage.gitStatus.notLoaded");

  return (
    <section className="mt-4 rounded-[1.35rem] border border-neutral-900 bg-black/30 p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-300">
            <GitBranch size={16} />
          </div>

          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium text-white">
                {t("projectDetailsPage.gitStatus.title")}
              </p>
              <GitBadge
                tone={
                  status && !status.dirty && status.isGitRepo
                    ? "success"
                    : status?.dirty
                      ? "warning"
                      : "muted"
                }
              >
                {isLoading && !status ? <Loader2 size={12} className="animate-spin" /> : null}
                {statusLabel}
              </GitBadge>
            </div>

            <p className="text-xs leading-5 text-neutral-600">
              {t("projectDetailsPage.gitStatus.description")}
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
          {t("projectDetailsPage.actions.refresh")}
        </Button>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-400/15 bg-red-400/10 p-4 text-sm leading-5 text-red-100">
          <div className="mb-1 flex items-center gap-2 font-medium">
            <AlertTriangle size={15} />
            {t("projectDetailsPage.gitStatus.unavailable")}
          </div>
          {error}
        </div>
      )}

      {!error && !status && (
        <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4 text-sm leading-5 text-neutral-500">
          {isLoading
            ? t("projectDetailsPage.gitStatus.readingLocal")
            : t("projectDetailsPage.gitStatus.openToLoad")}
        </div>
      )}

      {!error && status && !status.isGitRepo && (
        <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-white">
            <GitPullRequestDraft size={15} />
            {t("projectDetailsPage.gitStatus.noRepoTitle")}
          </div>
          <p className="text-sm leading-5 text-neutral-500">
            {t("projectDetailsPage.gitStatus.noRepoDescription")}
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
                    {status.isDetachedHead
                      ? t("projectDetailsPage.gitStatus.detached")
                      : status.branch ?? t("projectDetailsPage.gitStatus.unknownBranch")}
                  </GitBadge>
                  <GitBadge tone={status.dirty ? "warning" : "success"}>
                    {status.dirty
                      ? t("projectDetailsPage.gitStatus.uncommitted")
                      : t("projectDetailsPage.gitStatus.clean")}
                  </GitBadge>
                  {status.summary.isTruncated && (
                    <GitBadge tone="warning">
                      {t("projectDetailsPage.gitStatus.largeStatus")}
                    </GitBadge>
                  )}
                </div>

                {status.latestCommit ? (
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="grid size-8 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-300">
                      <GitCommitHorizontal size={14} />
                    </div>
                    <div className="min-w-0">
                      <p className="cf-tech-label mb-1 text-[9px] uppercase text-neutral-700">
                        {t("projectDetailsPage.gitStatus.latestCommit")}
                      </p>
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
                        {new Intl.DateTimeFormat(locale, {
                          dateStyle: "medium",
                          timeStyle: "short"
                        }).format(new Date(status.latestCommit.date))}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm leading-5 text-neutral-500">
                    {t("projectDetailsPage.gitStatus.commitUnavailable")}
                  </p>
                )}
              </div>

              <div className="rounded-xl border border-neutral-900 bg-black/25 px-3 py-2 text-right">
                <p className="cf-tech-label text-[9px] uppercase text-neutral-700">
                  {t("projectDetailsPage.gitStatus.changedFiles")}
                </p>
                <p className="mt-1 text-xl font-semibold text-white">
                  {status.summary.totalChanged}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 border-t border-neutral-900">
              <GitMetric
                label={bucketMeta.staged.label}
                value={status.summary.stagedCount}
                caption={bucketMeta.staged.caption}
              />
              <GitMetric
                label={bucketMeta.unstaged.label}
                value={status.summary.unstagedCount}
                caption={bucketMeta.unstaged.caption}
                withDivider
              />
              <GitMetric
                label={bucketMeta.untracked.label}
                value={status.summary.untrackedCount}
                caption={bucketMeta.untracked.caption}
                withDivider
              />
            </div>
          </div>

          {status.warnings.length > 0 && (
            <div className="rounded-2xl border border-amber-300/15 bg-amber-300/10 p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-100">
                <AlertTriangle size={15} />
                {t("projectDetailsPage.gitStatus.notes")}
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
