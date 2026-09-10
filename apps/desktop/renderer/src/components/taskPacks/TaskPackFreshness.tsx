import { AlertTriangle, CheckCircle2, CircleHelp, FileWarning } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { TaskPack } from "../../types";
import type { TaskPackFreshness } from "../../utils/taskPackFreshness";
import { WorkspaceDisclosure } from "../workspace/WorkspaceDisclosure";
import { Button } from "../ui/Button";

function freshnessIcon(status: TaskPackFreshness["status"]) {
  if (status === "affected") return <FileWarning size={13} />;
  if (status === "review_recommended") return <AlertTriangle size={13} />;
  if (status === "current") return <CheckCircle2 size={13} />;
  return <CircleHelp size={13} />;
}

function freshnessTone(status: TaskPackFreshness["status"]) {
  if (status === "affected") {
    return "border-red-300/20 bg-red-300/[0.06] text-red-100/80";
  }
  if (status === "review_recommended") {
    return "border-amber-300/20 bg-amber-300/[0.05] text-amber-100/75";
  }
  if (status === "current") {
    return "border-emerald-300/15 bg-emerald-300/[0.035] text-emerald-100/65";
  }
  return "border-neutral-800 bg-neutral-950 text-neutral-500";
}

export function TaskPackFreshnessBadge({
  freshness,
  className = "",
}: {
  freshness: TaskPackFreshness;
  className?: string;
}) {
  const { t } = useTranslation();

  return (
    <span
      className={`inline-flex min-w-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium ${freshnessTone(freshness.status)} ${className}`}
      data-task-pack-freshness={freshness.status}
    >
      <span className="shrink-0" aria-hidden="true">
        {freshnessIcon(freshness.status)}
      </span>
      <span className="truncate">
        {t(`taskPackFreshness.status.${freshness.status}`)}
      </span>
    </span>
  );
}

export function TaskPackFreshnessNotice({
  freshness,
  onReviewProject,
  compact = false,
}: {
  freshness: TaskPackFreshness;
  onReviewProject?: () => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const shouldOfferReview =
    freshness.status === "affected" || freshness.status === "review_recommended";

  return (
    <section
      className={`min-w-0 rounded-2xl border ${freshnessTone(freshness.status)} ${compact ? "px-3 py-2.5" : "p-4"}`}
      data-task-pack-freshness-notice={freshness.status}
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <span className="mt-0.5 shrink-0" aria-hidden="true">
            {freshnessIcon(freshness.status)}
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold">
              {t(`taskPackFreshness.status.${freshness.status}`)}
            </p>
            <p className="mt-1 text-xs leading-5 opacity-80">
              {t(`taskPackFreshness.reason.${freshness.reason}`, {
                count: freshness.affectedPaths.length,
              })}
            </p>
          </div>
        </div>

        {shouldOfferReview && onReviewProject ? (
          <Button
            variant="secondary"
            onClick={onReviewProject}
            className="h-8 shrink-0 px-3 text-[11px]"
          >
            {t("taskPackFreshness.reviewChanges")}
          </Button>
        ) : null}
      </div>

      {freshness.status === "affected" && freshness.affectedPaths.length > 0 ? (
        <div className="mt-3 space-y-1.5">
          {freshness.affectedPaths.map((path) => (
            <p
              key={path}
              className="min-w-0 break-all rounded-lg border border-current/10 bg-black/20 px-2.5 py-1.5 font-mono text-[10px] leading-4"
            >
              {path}
            </p>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function ProjectTaskPackFreshnessPanel({
  items,
  onOpenTaskPack,
}: {
  items: Array<{ taskPack: TaskPack; freshness: TaskPackFreshness }>;
  onOpenTaskPack: (taskPack: TaskPack) => void;
}) {
  const { t } = useTranslation();
  const reviewItems = items.filter(
    ({ freshness }) =>
      freshness.status === "affected" ||
      freshness.status === "review_recommended",
  );
  const unknownCount = items.filter(
    ({ freshness }) => freshness.status === "unknown",
  ).length;

  if (items.length === 0) return null;

  return (
    <WorkspaceDisclosure
      title={t("taskPackFreshness.projectPanel.title")}
      summary={
        reviewItems.length > 0
          ? t("taskPackFreshness.projectPanel.reviewSummary", {
              count: reviewItems.length,
            })
          : unknownCount > 0
            ? t("taskPackFreshness.projectPanel.unknownSummary", {
                count: unknownCount,
              })
            : t("taskPackFreshness.projectPanel.currentSummary", {
                count: items.length,
              })
      }
      badge={
        reviewItems.length > 0 ? (
          <span className="cf-badge">{reviewItems.length}</span>
        ) : undefined
      }
      icon={<FileWarning size={14} />}
      tone={reviewItems.length > 0 ? "attention" : "neutral"}
      defaultOpen={reviewItems.some(({ freshness }) => freshness.status === "affected")}
    >
      {reviewItems.length > 0 ? (
        <div className="space-y-3">
          <div className="space-y-2">
            {reviewItems.map(({ taskPack, freshness }) => (
              <article
                key={taskPack.id}
                className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-900 bg-black/35 px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-neutral-200">
                    {taskPack.title}
                  </p>
                  <p className="mt-1 text-[11px] leading-4 text-neutral-500">
                    {t(`taskPackFreshness.reason.${freshness.reason}`, {
                      count: freshness.affectedPaths.length,
                    })}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <TaskPackFreshnessBadge freshness={freshness} />
                  <Button
                    variant="secondary"
                    onClick={() => onOpenTaskPack(taskPack)}
                    className="h-8 px-3 text-[11px]"
                  >
                    {t("taskPackFreshness.openTaskPack")}
                  </Button>
                </div>
              </article>
            ))}
          </div>
          {unknownCount > 0 ? (
            <p className="text-[11px] leading-5 text-neutral-600">
              {t("taskPackFreshness.projectPanel.unknownAdditional", {
                count: unknownCount,
              })}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-xs leading-5 text-neutral-500">
          {unknownCount > 0
            ? t("taskPackFreshness.projectPanel.unknownDescription")
            : t("taskPackFreshness.projectPanel.currentDescription")}
        </p>
      )}
    </WorkspaceDisclosure>
  );
}
