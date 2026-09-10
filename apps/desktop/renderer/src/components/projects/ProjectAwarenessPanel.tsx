import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  FileMinus2,
  FilePlus2,
  History,
  ScanSearch,
} from "lucide-react";

import type { Project, ProjectAwareness } from "../../types";
import { WorkspaceDisclosure } from "../workspace/WorkspaceDisclosure";
import { localizeReadinessCheckLabel } from "./projectDetailsI18n";

function formatObservedAt(value: string | null, language: string) {
  if (!value) return "—";

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";

  return new Intl.DateTimeFormat(
    language.startsWith("ru") ? "ru-RU" : "en-US",
    { dateStyle: "medium", timeStyle: "short" },
  ).format(date);
}

function readinessIcon(direction: "improved" | "unchanged" | "decreased") {
  if (direction === "improved") return <ArrowUpRight size={14} />;
  if (direction === "decreased") return <ArrowDownRight size={14} />;
  return <ArrowRight size={14} />;
}

function awarenessIcon(awareness: ProjectAwareness | null | undefined) {
  if (!awareness) return <History size={14} />;
  if (awareness.status === "first_observation") return <ScanSearch size={14} />;
  if (awareness.status === "comparison_limited") return <AlertTriangle size={14} />;
  if (awareness.status === "changed") return <History size={14} />;
  return <CheckCircle2 size={14} />;
}

function awarenessSummaryKey(awareness: ProjectAwareness | null | undefined) {
  if (!awareness) return "projectAwareness.unavailableSummary";
  if (awareness.status === "first_observation") return "projectAwareness.firstSummary";
  if (awareness.status === "comparison_limited") return "projectAwareness.limitedSummary";
  if (awareness.status === "changed") return "projectAwareness.changedSummary";
  return "projectAwareness.unchangedSummary";
}

function FilePathList({
  paths,
  icon,
}: {
  paths: string[];
  icon: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      {paths.map((filePath) => (
        <div
          key={filePath}
          className="flex min-w-0 items-start gap-2 rounded-xl border border-neutral-900 bg-black/35 px-3 py-2"
        >
          <span className="mt-0.5 shrink-0 text-neutral-600" aria-hidden="true">
            {icon}
          </span>
          <span className="min-w-0 break-all font-mono text-[11px] leading-5 text-neutral-400">
            {filePath}
          </span>
        </div>
      ))}
    </div>
  );
}

export function ProjectAwarenessSummary({
  project,
  className = "",
}: {
  project: Project;
  className?: string;
}) {
  const { t } = useTranslation();
  const awareness = project.awareness;
  const added = awareness?.fileChanges?.added.length ?? 0;
  const removed = awareness?.fileChanges?.removed.length ?? 0;

  return (
    <div
      className={`flex min-w-0 items-start gap-2 text-xs text-neutral-500 ${className}`}
      data-project-awareness-summary
    >
      <span className="mt-0.5 shrink-0 text-neutral-600" aria-hidden="true">
        {awarenessIcon(awareness)}
      </span>
      <span className="min-w-0 leading-5">
        {t(awarenessSummaryKey(awareness), { added, removed })}
      </span>
    </div>
  );
}

export function ProjectAwarenessPanel({ project }: { project: Project }) {
  const { t, i18n } = useTranslation();
  const awareness = project.awareness;

  if (!awareness) {
    return (
      <section className="rounded-[1.5rem] border border-neutral-900 bg-black/25 p-5">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-500">
            <History size={17} />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-white">
              {t("projectAwareness.title")}
            </h3>
            <p className="mt-1 text-sm leading-6 text-neutral-500">
              {t("projectAwareness.unavailableDescription")}
            </p>
          </div>
        </div>
      </section>
    );
  }

  const added = awareness.fileChanges?.added ?? [];
  const removed = awareness.fileChanges?.removed ?? [];
  const changedFiles = added.length + removed.length;
  const readiness = awareness.readinessChange;
  const currentChecks = new Map(
    project.readinessReport.checks.map((check) => [check.key, check]),
  );

  return (
    <section
      className="rounded-[1.5rem] border border-neutral-900 bg-black/25 p-5"
      data-project-awareness-panel
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-400">
            {awarenessIcon(awareness)}
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-white">
              {t("projectAwareness.title")}
            </h3>
            <p className="mt-1 text-sm leading-6 text-neutral-500">
              {t(awarenessSummaryKey(awareness), {
                added: added.length,
                removed: removed.length,
              })}
            </p>
          </div>
        </div>

        <span className="cf-badge shrink-0">
          {t("projectAwareness.knownFiles", { count: awareness.knownFileCount })}
        </span>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        <div className="min-w-0 rounded-xl border border-neutral-900 bg-black/30 px-3 py-2.5">
          <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
            {t("projectAwareness.lastObserved")}
          </p>
          <p className="mt-1 truncate text-xs text-neutral-300">
            {formatObservedAt(awareness.lastObservedAt, i18n.language)}
          </p>
        </div>
        <div className="min-w-0 rounded-xl border border-neutral-900 bg-black/30 px-3 py-2.5">
          <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
            {t("projectAwareness.previousObserved")}
          </p>
          <p className="mt-1 truncate text-xs text-neutral-300">
            {formatObservedAt(awareness.previousObservedAt, i18n.language)}
          </p>
        </div>
        <div className="min-w-0 rounded-xl border border-neutral-900 bg-black/30 px-3 py-2.5 sm:col-span-2 xl:col-span-1">
          <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
            {t("projectAwareness.readiness")}
          </p>
          {readiness ? (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-neutral-300">
              <span>{readiness.previous}</span>
              <span className="text-neutral-600" aria-hidden="true">
                {readinessIcon(readiness.direction)}
              </span>
              <span>{readiness.current}</span>
              <span className="text-neutral-500">
                {t(`projectAwareness.readinessDirection.${readiness.direction}`)}
              </span>
            </p>
          ) : (
            <p className="mt-1 text-xs text-neutral-500">
              {t("projectAwareness.noReadinessBaseline")}
            </p>
          )}
        </div>
      </div>

      {awareness.status === "first_observation" ? (
        <p className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.018] px-4 py-3 text-xs leading-5 text-neutral-500">
          {t("projectAwareness.firstDescription")}
        </p>
      ) : null}

      {awareness.fileComparison === "limited" ? (
        <p className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/[0.04] px-4 py-3 text-xs leading-5 text-amber-100/75">
          {t("projectAwareness.limitedDescription")}
        </p>
      ) : null}

      {awareness.previousObservedAt ? (
        <WorkspaceDisclosure
          title={t("projectAwareness.details")}
          summary={t("projectAwareness.detailsSummary", {
            files: changedFiles,
            checks: awareness.readinessCheckChanges.length,
          })}
          badge={changedFiles > 0 ? <span className="cf-badge">{changedFiles}</span> : undefined}
          icon={<History size={14} />}
          defaultOpen={false}
          tone={awareness.status === "comparison_limited" ? "attention" : "neutral"}
          className="mt-4"
        >
          <div className="space-y-4">
            {awareness.fileComparison === "available" ? (
              changedFiles > 0 ? (
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="min-w-0">
                    <p className="mb-2 text-xs font-semibold text-neutral-300">
                      {t("projectAwareness.added", { count: added.length })}
                    </p>
                    {added.length > 0 ? (
                      <FilePathList paths={added} icon={<FilePlus2 size={13} />} />
                    ) : (
                      <p className="text-xs text-neutral-600">
                        {t("projectAwareness.noneAdded")}
                      </p>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="mb-2 text-xs font-semibold text-neutral-300">
                      {t("projectAwareness.removed", { count: removed.length })}
                    </p>
                    {removed.length > 0 ? (
                      <FilePathList paths={removed} icon={<FileMinus2 size={13} />} />
                    ) : (
                      <p className="text-xs text-neutral-600">
                        {t("projectAwareness.noneRemoved")}
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-xs leading-5 text-neutral-500">
                  {t("projectAwareness.noFileCompositionChanges")}
                </p>
              )
            ) : null}

            {awareness.readinessCheckChanges.length > 0 ? (
              <div>
                <p className="mb-2 text-xs font-semibold text-neutral-300">
                  {t("projectAwareness.readinessChecks")}
                </p>
                <div className="space-y-1.5">
                  {awareness.readinessCheckChanges.map((change) => {
                    const check = currentChecks.get(change.key);
                    const label = check
                      ? localizeReadinessCheckLabel(t, check)
                      : change.key;

                    return (
                      <div
                        key={change.key}
                        className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-neutral-900 bg-black/35 px-3 py-2"
                      >
                        <span className="min-w-0 truncate text-xs text-neutral-300">
                          {label}
                        </span>
                        <span className="shrink-0 text-right text-[10px] text-neutral-500">
                          <span className="block">
                            {t("projectAwareness.checkTransition", {
                              previous:
                                change.previousPassed === null
                                  ? t("projectAwareness.notObserved")
                                  : t(
                                      change.previousPassed
                                        ? "projectAwareness.passed"
                                        : "projectAwareness.failed",
                                    ),
                              current:
                                change.currentPassed === null
                                  ? t("projectAwareness.notObserved")
                                  : t(
                                      change.currentPassed
                                        ? "projectAwareness.passed"
                                        : "projectAwareness.failed",
                                    ),
                            })}
                          </span>
                          {change.previousPoints !== change.currentPoints ? (
                            <span className="mt-0.5 block text-neutral-600">
                              {t("projectAwareness.checkPointsTransition", {
                                previous:
                                  change.previousPoints ?? t("projectAwareness.notObserved"),
                                current:
                                  change.currentPoints ?? t("projectAwareness.notObserved"),
                              })}
                            </span>
                          ) : null}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <p className="border-t border-white/[0.06] pt-3 text-[10px] leading-4 text-neutral-600">
              {t("projectAwareness.scopeNote")}
            </p>
          </div>
        </WorkspaceDisclosure>
      ) : null}
    </section>
  );
}
