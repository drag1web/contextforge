import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  FileText,
  Gauge,
  GitBranch,
  LayoutDashboard,
  Package,
  RefreshCw,
  ScanSearch,
  ShieldCheck,
  WandSparkles,
  XCircle
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { Project } from "../types";
import { GitContextCard } from "../components/projects/GitContextCard";
import { GitDiffSummaryCard } from "../components/projects/GitDiffSummaryCard";
import {
  ProjectReadinessReport,
  ProjectScannerSignalsPanel
} from "../components/projects/ProjectReadinessReport";
import { buildLocalizedReadinessPriorities } from "../components/projects/projectDetailsI18n";
import { Button } from "../components/ui/Button";
import { HorizontalSlidingSelector } from "../components/ui/SlidingSelectors";

interface ProjectDetailsPageProps {
  project: Project;
  isLoading: boolean;
  onBack: () => void;
  onRescan: (project: Project) => void;
  onGenerateAgents: (project: Project) => void;
  onCreateTaskPack: (project: Project) => void | Promise<void>;
  onCreateTaskPackFromChanges: (project: Project) => void | Promise<void>;
}

type ProjectDetailsView = "overview" | "readiness" | "changes";
type LocalChangesView = "working-tree" | "review";

function formatDate(value: string | null, locale: string, neverLabel: string) {
  if (!value) {
    return neverLabel;
  }

  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
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

function SummaryMetric({
  label,
  value,
  caption,
  icon
}: {
  label: string;
  value: string | number;
  caption: string;
  icon: ReactNode;
}) {
  return (
    <article className="flex min-w-0 items-center gap-3 rounded-2xl border border-neutral-900 bg-black/30 px-4 py-3">
      <div className="grid size-9 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-400">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="cf-tech-label text-[9px] uppercase text-neutral-600">{label}</p>
        <div className="mt-0.5 flex min-w-0 items-baseline gap-2">
          <p className="cf-display-font text-xl font-semibold leading-none text-white">{value}</p>
          <p className="truncate text-xs text-neutral-600">{caption}</p>
        </div>
      </div>
    </article>
  );
}

function ProjectProfile({ project }: { project: Project }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage?.startsWith("ru") ? "ru-RU" : "en-US";
  const stackItems =
    project.detectedStack.length > 0
      ? project.detectedStack
      : [t("projectDetailsPage.profile.unknownStack")];
  const visibleStack = stackItems.slice(0, 6);
  const hiddenStackCount = Math.max(0, stackItems.length - visibleStack.length);
  const scriptCount = Object.keys(project.scripts ?? {}).length;

  const rows = [
    {
      label: t("projectDetailsPage.profile.packageManager"),
      value: project.packageManager ?? t("projectDetailsPage.notDetected")
    },
    {
      label: t("projectDetailsPage.profile.lastScan"),
      value: formatDate(
        project.lastScanAt,
        locale,
        t("projectDetailsPage.never")
      )
    },
    {
      label: t("projectDetailsPage.profile.packageScripts"),
      value: t("projectDetailsPage.counts.detected", { count: scriptCount })
    }
  ];

  return (
    <section className="rounded-[1.5rem] border border-neutral-900 bg-black/25 p-5">
      <div className="mb-5 flex items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-300">
          <Package size={17} />
        </div>
        <div>
          <p className="text-sm font-semibold text-white">
            {t("projectDetailsPage.profile.title")}
          </p>
          <p className="mt-1 text-sm leading-5 text-neutral-600">
            {t("projectDetailsPage.profile.description")}
          </p>
        </div>
      </div>

      <div className="space-y-1 rounded-2xl border border-neutral-900 bg-black/30 p-2">
        {rows.map((row) => (
          <div
            key={row.label}
            className="grid gap-1 rounded-xl px-3 py-2.5 sm:grid-cols-[140px_minmax(0,1fr)] sm:items-center"
          >
            <p className="text-xs text-neutral-600">{row.label}</p>
            <p className="truncate text-sm text-neutral-300">{row.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-4">
        <p className="cf-tech-label mb-2 text-[9px] uppercase text-neutral-600">
          {t("projectDetailsPage.profile.detectedStack")}
        </p>
        <div className="flex flex-wrap gap-2">
          {visibleStack.map((item) => (
            <span key={item} className="cf-badge">
              {item}
            </span>
          ))}
          {hiddenStackCount > 0 && <span className="cf-badge">+{hiddenStackCount}</span>}
        </div>
      </div>
    </section>
  );
}

export function ProjectDetailsPage({
  project,
  isLoading,
  onBack,
  onRescan,
  onGenerateAgents,
  onCreateTaskPack,
  onCreateTaskPackFromChanges
}: ProjectDetailsPageProps) {
  const { t } = useTranslation();
  const [activeView, setActiveView] = useState<ProjectDetailsView>("overview");
  const [localChangesView, setLocalChangesView] =
    useState<LocalChangesView>("working-tree");

  const detailsViews = useMemo(
    () => [
      {
        id: "overview" as const,
        label: t("projectDetailsPage.tabs.overview"),
        caption: t("projectDetailsPage.tabs.overviewDesc"),
        icon: LayoutDashboard
      },
      {
        id: "readiness" as const,
        label: t("projectDetailsPage.tabs.readiness"),
        caption: t("projectDetailsPage.tabs.readinessDesc"),
        icon: ShieldCheck
      },
      {
        id: "changes" as const,
        label: t("projectDetailsPage.tabs.changes"),
        caption: t("projectDetailsPage.tabs.changesDesc"),
        icon: GitBranch
      }
    ],
    [t]
  );

  const localChangesViews = useMemo(
    () => [
      {
        id: "working-tree" as const,
        label: t("projectDetailsPage.localTabs.workingTree"),
        caption: t("projectDetailsPage.localTabs.workingTreeDesc"),
        icon: GitBranch
      },
      {
        id: "review" as const,
        label: t("projectDetailsPage.localTabs.review"),
        caption: t("projectDetailsPage.localTabs.reviewDesc"),
        icon: ScanSearch
      }
    ],
    [t]
  );

  useEffect(() => {
    setActiveView("overview");
    setLocalChangesView("working-tree");
  }, [project.id]);

  const readinessLabel =
    project.readinessScore >= 80
      ? t("projectDetailsPage.readiness.ready")
      : project.readinessScore >= 50
        ? t("projectDetailsPage.readiness.needsPolish")
        : t("projectDetailsPage.readiness.needsAttention");
  const passedChecks = project.readinessReport.checks.filter(
    (check) => check.passed
  ).length;
  const scriptsCount = Object.keys(project.scripts ?? {}).length;
  const allAttentionItems = useMemo(
    () => buildLocalizedReadinessPriorities(t, project.readinessReport),
    [project.readinessReport, t]
  );
  const attentionItems = allAttentionItems.slice(0, 4);
  const issueCount = allAttentionItems.length;
  const activeViewIndex = detailsViews.findIndex((view) => view.id === activeView);
  const localChangesViewIndex = localChangesViews.findIndex(
    (view) => view.id === localChangesView
  );

  return (
    <section className="space-y-4">
      <header className="rounded-[1.75rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.01)_52%,rgba(255,255,255,0.004))] p-5 shadow-[0_18px_55px_rgba(0,0,0,0.32),inset_0_1px_0_rgba(255,255,255,0.045)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={onBack}
              className="mt-0.5 shrink-0 px-2.5"
            >
              <ArrowLeft size={15} />
              {t("projectDetailsPage.projects")}
            </Button>

            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="cf-tech-label text-[9px] uppercase text-neutral-600">
                  {t("projectDetailsPage.workspace")}
                </span>
                <span className="size-1 rounded-full bg-neutral-800" />
                <span className="text-xs text-neutral-600">
                  {t("projectDetailsPage.localRepository")}
                </span>
              </div>
              <h2 className="truncate text-[31px] font-semibold leading-none tracking-[-0.045em] text-white">
                {project.name}
              </h2>
              <p className="mt-2 truncate text-sm text-neutral-600">{project.localPath}</p>
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="primary"
              disabled={isLoading}
              onClick={() => onCreateTaskPack(project)}
            >
              <WandSparkles size={15} />
              {t("projectDetailsPage.actions.createTaskPack")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={isLoading}
              onClick={() => onGenerateAgents(project)}
            >
              <FileText size={15} />
              AGENTS.md
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={isLoading}
              onClick={() => onRescan(project)}
            >
              <RefreshCw size={15} />
              {t("projectDetailsPage.actions.rescan")}
            </Button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 xl:grid-cols-[minmax(0,1fr)_330px]">
          <div className="grid gap-3 sm:grid-cols-3">
            <SummaryMetric
              label={t("projectDetailsPage.summary.checks")}
              value={`${passedChecks}/${project.readinessReport.checks.length}`}
              caption={t("projectDetailsPage.summary.passed")}
              icon={<ShieldCheck size={15} />}
            />
            <SummaryMetric
              label={t("projectDetailsPage.summary.attention")}
              value={issueCount}
              caption={t("projectDetailsPage.counts.issue", { count: issueCount })}
              icon={<AlertTriangle size={15} />}
            />
            <SummaryMetric
              label={t("projectDetailsPage.summary.scripts")}
              value={scriptsCount}
              caption={t("projectDetailsPage.summary.detected")}
              icon={<Package size={15} />}
            />
          </div>

          <aside className="rounded-2xl border border-neutral-900 bg-black/35 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
                  {t("projectDetailsPage.readiness.aiReadiness")}
                </p>
                <p className="mt-1 text-sm font-medium text-white">{readinessLabel}</p>
              </div>
              <p className="cf-display-font text-3xl font-semibold leading-none text-white">
                {project.readinessScore}
              </p>
            </div>
            <div className="mt-3 rounded-full border border-neutral-800/80 bg-black p-1">
              <div className="cf-health-track">
                <div
                  className={[
                    "cf-health-fill",
                    getReadinessTone(project.readinessScore)
                  ].join(" ")}
                  style={{ width: getReadinessWidth(project.readinessScore) }}
                />
              </div>
            </div>
          </aside>
        </div>
      </header>

      <HorizontalSlidingSelector
        items={detailsViews}
        activeIndex={activeViewIndex}
        getItemKey={(view) => view.id}
        onSelect={(view) => setActiveView(view.id)}
        ariaLabel={t("projectDetailsPage.aria.detailsView")}
        className="rounded-[1.35rem]"
        itemClassName="min-h-[64px] px-4 py-2"
        renderItem={(view, isActive) => {
          const Icon = view.icon;

          return (
            <span className="flex min-w-0 items-center justify-center gap-3 text-left">
              <span
                className={[
                  "grid size-8 shrink-0 place-items-center rounded-xl border transition-colors duration-150",
                  isActive
                    ? "border-black/10 bg-black/[0.045] text-black"
                    : "border-neutral-800 bg-neutral-950 text-neutral-500 group-hover:text-white"
                ].join(" ")}
              >
                <Icon size={15} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{view.label}</span>
                <span
                  className={
                    isActive
                      ? "block truncate text-xs text-black/50"
                      : "block truncate text-xs text-neutral-700"
                  }
                >
                  {view.caption}
                </span>
              </span>
            </span>
          );
        }}
      />

      {activeView === "overview" && (
        <div className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.08fr)_minmax(340px,0.92fr)]">
            <section className="rounded-[1.5rem] border border-neutral-900 bg-black/25 p-5">
              <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-300">
                    {attentionItems.length > 0 ? (
                      <AlertTriangle size={17} />
                    ) : (
                      <CheckCircle2 size={17} />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">
                      {t("projectDetailsPage.attention.title")}
                    </p>
                    <p className="mt-1 text-sm leading-5 text-neutral-600">
                      {attentionItems.length > 0
                        ? t("projectDetailsPage.attention.description")
                        : t("projectDetailsPage.attention.clearDescription")}
                    </p>
                  </div>
                </div>

                <span className="cf-badge">
                  {attentionItems.length > 0
                    ? t("projectDetailsPage.counts.priorityItem", {
                        count: issueCount
                      })
                    : t("projectDetailsPage.attention.noBlockers")}
                </span>
              </div>

              {attentionItems.length > 0 ? (
                <div className="grid gap-2">
                  {attentionItems.map((item, index) => (
                    <article
                      key={item.key}
                      className="flex min-w-0 items-start gap-3 rounded-2xl border border-neutral-900 bg-black/30 px-4 py-3"
                    >
                      <span className="grid size-7 shrink-0 place-items-center rounded-full border border-neutral-800 bg-neutral-950 text-neutral-500">
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <XCircle size={14} className="shrink-0 text-neutral-500" />
                          <p className="truncate text-sm font-medium text-neutral-200">
                            {item.title}
                          </p>
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-neutral-600">
                          {item.caption}
                        </p>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.06] p-4 text-sm leading-6 text-emerald-100/75">
                  {t("projectDetailsPage.attention.readyCallout")}
                </div>
              )}
            </section>

            <ProjectProfile project={project} />
          </div>

          <ProjectScannerSignalsPanel
            signals={project.readinessReport.signals}
            compact
          />
        </div>
      )}

      {activeView === "readiness" && (
        <section className="rounded-[1.5rem] border border-neutral-900 bg-black/25 p-5">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-300">
                <Gauge size={17} />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">
                  {t("projectDetailsPage.readiness.evidenceTitle")}
                </p>
                <p className="mt-1 text-sm leading-5 text-neutral-600">
                  {t("projectDetailsPage.readiness.evidenceDescription")}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-2xl border border-neutral-900 bg-black/30 px-4 py-3">
              <div>
                <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
                  {t("projectDetailsPage.readiness.currentScore")}
                </p>
                <p className="mt-1 text-sm text-neutral-300">{readinessLabel}</p>
              </div>
              <p className="cf-display-font text-3xl font-semibold text-white">
                {project.readinessScore}
              </p>
            </div>
          </div>

          <ProjectReadinessReport report={project.readinessReport} />
        </section>
      )}

      {activeView === "changes" && (
        <section className="rounded-[1.5rem] border border-neutral-900 bg-black/25 p-5">
          <div className="mb-1 flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-300">
                <GitBranch size={17} />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">
                  {t("projectDetailsPage.localChanges.title")}
                </p>
                <p className="mt-1 max-w-2xl text-sm leading-5 text-neutral-600">
                  {t("projectDetailsPage.localChanges.description")}
                </p>
              </div>
            </div>

            <Button
              type="button"
              variant="primary"
              disabled={isLoading}
              onClick={() => onCreateTaskPackFromChanges(project)}
              className="shrink-0"
            >
              <ScanSearch size={15} />
              {t("projectDetailsPage.actions.createFromChanges")}
            </Button>
          </div>

          <HorizontalSlidingSelector
            items={localChangesViews}
            activeIndex={localChangesViewIndex}
            getItemKey={(view) => view.id}
            onSelect={(view) => setLocalChangesView(view.id)}
            ariaLabel={t("projectDetailsPage.aria.localChangesView")}
            className="mt-5 rounded-[1.2rem]"
            itemClassName="min-h-[58px] px-4 py-2"
            renderItem={(view, isActive) => {
              const Icon = view.icon;

              return (
                <span className="flex min-w-0 items-center justify-center gap-3 text-left">
                  <span
                    className={[
                      "grid size-8 shrink-0 place-items-center rounded-xl border transition-colors duration-150",
                      isActive
                        ? "border-black/10 bg-black/[0.045] text-black"
                        : "border-neutral-800 bg-neutral-950 text-neutral-500 group-hover:text-white"
                    ].join(" ")}
                  >
                    <Icon size={15} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">
                      {view.label}
                    </span>
                    <span
                      className={
                        isActive
                          ? "block truncate text-xs text-black/50"
                          : "block truncate text-xs text-neutral-700"
                      }
                    >
                      {view.caption}
                    </span>
                  </span>
                </span>
              );
            }}
          />

          {localChangesView === "working-tree" && (
            <GitContextCard projectId={project.id} enabled />
          )}
          {localChangesView === "review" && (
            <GitDiffSummaryCard projectId={project.id} enabled />
          )}
        </section>
      )}
    </section>
  );
}
