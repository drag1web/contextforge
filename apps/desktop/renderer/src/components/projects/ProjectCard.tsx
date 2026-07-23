import { useTranslation } from "react-i18next";
import {
  Clock3,
  FileText,
  FolderKanban,
  Info,
  Layers3,
  Package,
  RefreshCw,
  ShieldCheck,
  WandSparkles
} from "lucide-react";

import type { Project } from "../../types";
import { Button } from "../ui/Button";

interface ProjectCardProps {
  project: Project;
  isLoading: boolean;
  onOpenDetails: () => void;
  onRescan: () => void;
  onGenerateAgents: () => void;
  onCreateTaskPack: () => void | Promise<void>;
}

function formatDate(value: string | null, neverLabel: string) {
  if (!value) {
    return neverLabel;
  }

  return new Date(value).toLocaleString();
}

function getReadinessLabel(score: number, t: (key: string) => string) {
  if (score >= 80) return t("projectsPage.ready");
  if (score >= 50) return t("projectsPage.needsPolish");
  return t("projectsPage.needsAttentionStatus");
}

function getReadinessTone(score: number) {
  if (score >= 80) {
    return "cf-health-fill-success";
  }

  if (score >= 50) {
    return "cf-health-fill-warning";
  }

  return "cf-health-fill-danger";
}

function getReadinessWidth(score: number) {
  return `${Math.max(4, Math.min(100, score))}%`;
}

export function ProjectCard({
  project,
  isLoading,
  onOpenDetails,
  onRescan,
  onGenerateAgents,
  onCreateTaskPack
}: ProjectCardProps) {
  const { t } = useTranslation();
  const issuesCount = project.readinessReport.issues.length;
  const readinessLabel = getReadinessLabel(project.readinessScore, t);
  const checksPassed = project.readinessReport.checks.filter((check) => check.passed).length;
  const visibleStack = project.detectedStack.length > 0
    ? project.detectedStack.slice(0, 4)
    : [t("common.unknownStack")];
  const hiddenStackCount = Math.max(0, project.detectedStack.length - visibleStack.length);

  return (
    <article className="cf-card cf-card-menu p-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_286px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-300">
                <FolderKanban size={18} />
              </div>

              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h5 className="truncate text-base font-semibold text-white">
                    {project.name}
                  </h5>
                  <span className="cf-badge">{readinessLabel}</span>
                </div>

                <p className="mt-1 truncate text-xs text-neutral-600">
                  {project.localPath}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-baseline gap-1.5">
              <span className="cf-display-font text-3xl font-semibold leading-none text-white">
                {project.readinessScore}
              </span>
              <span className="text-xs text-neutral-600">/100</span>
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-neutral-500">
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <Layers3 size={13} className="shrink-0 text-neutral-600" />
                  <span className="truncate">
                    {visibleStack.join(" · ")}
                    {hiddenStackCount > 0 ? ` · +${hiddenStackCount}` : ""}
                  </span>
                </span>

                <span className="inline-flex items-center gap-1.5">
                  <Package size={13} className="text-neutral-600" />
                  {project.packageManager ?? t("common.unknown")}
                </span>

                <span className="inline-flex items-center gap-1.5">
                  <Clock3 size={13} className="text-neutral-600" />
                  {formatDate(project.lastScanAt, t("projectsPage.never"))}
                </span>
              </div>

              <div className="mt-4 rounded-full border border-neutral-800/80 bg-black p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.045)]">
                <div className="cf-health-track">
                  <div
                    className={["cf-health-fill", getReadinessTone(project.readinessScore)].join(" ")}
                    style={{ width: getReadinessWidth(project.readinessScore) }}
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 overflow-hidden rounded-2xl border border-neutral-900 bg-black/30">
              <div className="p-3.5">
                <div className="mb-2 flex items-center gap-2 text-neutral-600">
                  <ShieldCheck size={14} />
                  <span className="cf-tech-label text-[10px] uppercase">
                    {t("projectsPage.checks")}
                  </span>
                </div>
                <p className="text-sm font-semibold text-white">
                  {checksPassed}/{project.readinessReport.checks.length}
                </p>
              </div>

              <div className="border-l border-neutral-900 p-3.5">
                <div className="mb-2 flex items-center gap-2 text-neutral-600">
                  <FileText size={14} />
                  <span className="cf-tech-label text-[10px] uppercase">
                    {t("projectsPage.issues")}
                  </span>
                </div>
                <p className="text-sm font-semibold text-white">{issuesCount}</p>
              </div>
            </div>
          </div>
        </div>

        <aside className="grid content-center gap-2 border-t border-neutral-900 pt-4 xl:border-l xl:border-t-0 xl:pl-4 xl:pt-0">
          <Button
            variant="primary"
            disabled={isLoading}
            onClick={onCreateTaskPack}
            className="justify-center rounded-xl"
          >
            <WandSparkles size={15} />
            {t("projectsPage.createTaskPack")}
          </Button>

          <Button
            type="button"
            variant="secondary"
            disabled={isLoading}
            onClick={onOpenDetails}
            className="justify-center rounded-xl"
          >
            <Info size={15} />
            {t("projectsPage.projectDetails")}
          </Button>

          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              disabled={isLoading}
              onClick={onGenerateAgents}
              className="justify-center rounded-xl px-2"
            >
              <FileText size={15} />
              AGENTS.md
            </Button>

            <Button
              variant="secondary"
              disabled={isLoading}
              onClick={onRescan}
              className="justify-center rounded-xl px-2"
            >
              <RefreshCw size={15} />
              {t("projectsPage.rescan")}
            </Button>
          </div>
        </aside>
      </div>
    </article>
  );
}
