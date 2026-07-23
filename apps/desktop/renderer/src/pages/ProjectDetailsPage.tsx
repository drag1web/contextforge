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

import type { Project } from "../types";
import { GitContextCard } from "../components/projects/GitContextCard";
import { GitDiffSummaryCard } from "../components/projects/GitDiffSummaryCard";
import {
  ProjectReadinessReport,
  ProjectScannerSignalsPanel
} from "../components/projects/ProjectReadinessReport";
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

const DETAILS_VIEWS = [
  {
    id: "overview" as const,
    label: "Overview",
    caption: "Summary and next step",
    icon: LayoutDashboard
  },
  {
    id: "readiness" as const,
    label: "Readiness",
    caption: "Checks and scanner evidence",
    icon: ShieldCheck
  },
  {
    id: "changes" as const,
    label: "Local changes",
    caption: "Git status and diff review",
    icon: GitBranch
  }
] as const;

const LOCAL_CHANGES_VIEWS = [
  {
    id: "working-tree" as const,
    label: "Working tree",
    caption: "Branch, commit, and file state",
    icon: GitBranch
  },
  {
    id: "review" as const,
    label: "Change review",
    caption: "Diff scope and Task Pack alignment",
    icon: ScanSearch
  }
] as const;

function formatDate(value: string | null, neverLabel = "Never") {
  if (!value) {
    return neverLabel;
  }

  return new Date(value).toLocaleString();
}

function getReadinessLabel(score: number) {
  if (score >= 80) return "Ready";
  if (score >= 50) return "Needs polish";
  return "Needs attention";
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
  const stackItems = project.detectedStack.length > 0 ? project.detectedStack : ["Unknown stack"];
  const visibleStack = stackItems.slice(0, 6);
  const hiddenStackCount = Math.max(0, stackItems.length - visibleStack.length);

  const rows = [
    {
      label: "Package manager",
      value: project.packageManager ?? "Not detected"
    },
    {
      label: "Last scan",
      value: formatDate(project.lastScanAt)
    },
    {
      label: "Package scripts",
      value: `${Object.keys(project.scripts ?? {}).length} detected`
    }
  ];

  return (
    <section className="rounded-[1.5rem] border border-neutral-900 bg-black/25 p-5">
      <div className="mb-5 flex items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-300">
          <Package size={17} />
        </div>
        <div>
          <p className="text-sm font-semibold text-white">Project profile</p>
          <p className="mt-1 text-sm leading-5 text-neutral-600">
            Stable project facts used across scanning, context selection, and Task Pack generation.
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
        <p className="cf-tech-label mb-2 text-[9px] uppercase text-neutral-600">Detected stack</p>
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
  const [activeView, setActiveView] = useState<ProjectDetailsView>("overview");
  const [localChangesView, setLocalChangesView] = useState<LocalChangesView>("working-tree");

  useEffect(() => {
    setActiveView("overview");
    setLocalChangesView("working-tree");
  }, [project.id]);

  const readinessLabel = getReadinessLabel(project.readinessScore);
  const passedChecks = project.readinessReport.checks.filter((check) => check.passed).length;
  const scriptsCount = Object.keys(project.scripts ?? {}).length;
  const issueCount = project.readinessReport.issues.length;
  const activeViewIndex = DETAILS_VIEWS.findIndex((view) => view.id === activeView);
  const localChangesViewIndex = LOCAL_CHANGES_VIEWS.findIndex((view) => view.id === localChangesView);

  const attentionItems = useMemo(() => {
    const issueItems = project.readinessReport.issues.map((message) => ({
      key: `issue-${message}`,
      title: message,
      caption: "Recommended improvement",
      icon: AlertTriangle
    }));

    const failedCheckItems = project.readinessReport.checks.filter((check) => !check.passed).map((check) => ({
      key: `check-${check.key}`,
      title: check.label,
      caption: check.message,
      icon: XCircle
    }));

    return [...issueItems, ...failedCheckItems]
      .filter((item, index, items) => items.findIndex((candidate) => candidate.title === item.title) === index)
      .slice(0, 4);
  }, [project.readinessReport]);

  return (
    <section className="space-y-4">
      <header className="rounded-[1.75rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.01)_52%,rgba(255,255,255,0.004))] p-5 shadow-[0_18px_55px_rgba(0,0,0,0.32),inset_0_1px_0_rgba(255,255,255,0.045)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <Button type="button" variant="ghost" onClick={onBack} className="mt-0.5 shrink-0 px-2.5">
              <ArrowLeft size={15} />
              Projects
            </Button>

            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="cf-tech-label text-[9px] uppercase text-neutral-600">Project workspace</span>
                <span className="size-1 rounded-full bg-neutral-800" />
                <span className="text-xs text-neutral-600">Local repository</span>
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
              Create Task Pack
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
              Rescan
            </Button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 xl:grid-cols-[minmax(0,1fr)_330px]">
          <div className="grid gap-3 sm:grid-cols-3">
            <SummaryMetric
              label="Checks"
              value={`${passedChecks}/${project.readinessReport.checks.length}`}
              caption="passed"
              icon={<ShieldCheck size={15} />}
            />
            <SummaryMetric
              label="Attention"
              value={issueCount}
              caption={issueCount === 1 ? "issue" : "issues"}
              icon={<AlertTriangle size={15} />}
            />
            <SummaryMetric
              label="Scripts"
              value={scriptsCount}
              caption="detected"
              icon={<Package size={15} />}
            />
          </div>

          <aside className="rounded-2xl border border-neutral-900 bg-black/35 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="cf-tech-label text-[9px] uppercase text-neutral-600">AI readiness</p>
                <p className="mt-1 text-sm font-medium text-white">{readinessLabel}</p>
              </div>
              <p className="cf-display-font text-3xl font-semibold leading-none text-white">
                {project.readinessScore}
              </p>
            </div>
            <div className="mt-3 rounded-full border border-neutral-800/80 bg-black p-1">
              <div className="cf-health-track">
                <div
                  className={["cf-health-fill", getReadinessTone(project.readinessScore)].join(" ")}
                  style={{ width: getReadinessWidth(project.readinessScore) }}
                />
              </div>
            </div>
          </aside>
        </div>
      </header>

      <HorizontalSlidingSelector
        items={DETAILS_VIEWS}
        activeIndex={activeViewIndex}
        getItemKey={(view) => view.id}
        onSelect={(view) => setActiveView(view.id)}
        ariaLabel="Project details view"
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
                <span className={isActive ? "block truncate text-xs text-black/50" : "block truncate text-xs text-neutral-700"}>
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
                    {attentionItems.length > 0 ? <AlertTriangle size={17} /> : <CheckCircle2 size={17} />}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">What needs attention</p>
                    <p className="mt-1 text-sm leading-5 text-neutral-600">
                      {attentionItems.length > 0
                        ? "The most useful gaps to review before starting broad implementation work."
                        : "No major readiness gaps were detected. The project is ready for a scoped task."}
                    </p>
                  </div>
                </div>

                <span className="cf-badge">
                  {attentionItems.length > 0 ? `${attentionItems.length} priority items` : "No blockers"}
                </span>
              </div>

              {attentionItems.length > 0 ? (
                <div className="grid gap-2">
                  {attentionItems.map((item, index) => {
                    const Icon = item.icon;

                    return (
                      <article
                        key={item.key}
                        className="flex min-w-0 items-start gap-3 rounded-2xl border border-neutral-900 bg-black/30 px-4 py-3"
                      >
                        <span className="grid size-7 shrink-0 place-items-center rounded-full border border-neutral-800 bg-neutral-950 text-neutral-500">
                          {index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-2">
                            <Icon size={14} className="shrink-0 text-neutral-500" />
                            <p className="truncate text-sm font-medium text-neutral-200">{item.title}</p>
                          </div>
                          <p className="mt-1 line-clamp-2 text-xs leading-5 text-neutral-600">{item.caption}</p>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.06] p-4 text-sm leading-6 text-emerald-100/75">
                  Continue with a focused Task Pack. ContextForge will still apply task-level safety and context checks during generation.
                </div>
              )}
            </section>

            <ProjectProfile project={project} />
          </div>

          <ProjectScannerSignalsPanel signals={project.readinessReport.signals} compact />
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
                <p className="text-sm font-semibold text-white">Readiness evidence</p>
                <p className="mt-1 text-sm leading-5 text-neutral-600">
                  Review the checks and scanner evidence behind the current readiness score.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-2xl border border-neutral-900 bg-black/30 px-4 py-3">
              <div>
                <p className="cf-tech-label text-[9px] uppercase text-neutral-600">Current score</p>
                <p className="mt-1 text-sm text-neutral-300">{readinessLabel}</p>
              </div>
              <p className="cf-display-font text-3xl font-semibold text-white">{project.readinessScore}</p>
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
                <p className="text-sm font-semibold text-white">Local development state</p>
                <p className="mt-1 max-w-2xl text-sm leading-5 text-neutral-600">
                  Inspect the local working tree and compare the current diff with the latest saved Task Pack. Nothing is committed or pushed from this page.
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
              Create from changes
            </Button>
          </div>

          <HorizontalSlidingSelector
            items={LOCAL_CHANGES_VIEWS}
            activeIndex={localChangesViewIndex}
            getItemKey={(view) => view.id}
            onSelect={(view) => setLocalChangesView(view.id)}
            ariaLabel="Local changes view"
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
                    <span className="block truncate text-sm font-semibold">{view.label}</span>
                    <span className={isActive ? "block truncate text-xs text-black/50" : "block truncate text-xs text-neutral-700"}>
                      {view.caption}
                    </span>
                  </span>
                </span>
              );
            }}
          />

          {localChangesView === "working-tree" && <GitContextCard projectId={project.id} enabled />}
          {localChangesView === "review" && <GitDiffSummaryCard projectId={project.id} enabled />}
        </section>
      )}
    </section>
  );
}
