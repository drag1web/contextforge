import { useMemo, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Archive,
  BarChart3,
  Bot,
  CheckCircle2,
  CircleDot,
  Clock3,
  Download,
  FileText,
  FileWarning,
  FolderOpen,
  Gauge,
  Layers3,
  ListChecks,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  WandSparkles
} from "lucide-react";

import type { Project, TaskPack } from "../types";
import { Button } from "../components/ui/Button";
import { SegmentedFilter, type SegmentedFilterOption } from "../components/ui/SegmentedFilter";
import { AiToolLogo } from "../components/ai/AiToolLogo";
import { getAiToolLabel } from "../components/ai/aiToolOptions";
import { ValidationLab } from "../components/reports/ValidationLab";
import { exportWorkspaceReport, type WorkspaceReportExportFormat } from "../utils/workspaceReportExport";

interface ReportsPageProps {
  projects: Project[];
  taskPacks: TaskPack[];
  readinessScore: number | null;
  statusMessage: string;
  onOpenProjects: () => void;
  onOpenTaskPacks: () => void;
  onOpenTaskPack: (taskPack: TaskPack) => void;
}

type ProjectLens = "attention" | "all" | "ready";

type IssueSignal = {
  key: string;
  label: string;
  count: number;
  projects: string[];
};

type CountSignal = {
  key: string;
  label: string;
  count: number;
};

const REPORT_TRANSITION = {
  duration: 0.2,
  ease: [0.16, 1, 0.3, 1]
} as const;

const PROJECT_LENS_OPTIONS: SegmentedFilterOption<ProjectLens>[] = [
  {
    value: "attention",
    label: "Needs attention",
    description: "Below 50"
  },
  {
    value: "all",
    label: "All projects",
    description: "Workspace"
  },
  {
    value: "ready",
    label: "Ready",
    description: "80+ score"
  }
];

function getAverageReadiness(projects: Project[]) {
  if (projects.length === 0) {
    return null;
  }

  const total = projects.reduce((sum, project) => sum + project.readinessScore, 0);
  return Math.round(total / projects.length);
}

function getReadinessLabel(score: number | null) {
  if (score === null) return "No scan data";
  if (score >= 80) return "Strong AI readiness";
  if (score >= 50) return "Moderate readiness";
  return "Needs context work";
}

function getScoreFillClass(score: number | null) {
  if (score === null) {
    return "bg-neutral-600";
  }

  if (score < 50) {
    return "bg-[#ff1744]";
  }

  if (score < 80) {
    return "bg-white";
  }

  return "bg-[#00ff9d]";
}

function getScoreWidth(score: number | null) {
  if (score === null) {
    return "4%";
  }

  return `${Math.max(4, Math.min(100, score))}%`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

function getTaskPackBodyBadge(taskPack: TaskPack) {
  if (taskPack.generationMode === "ollama" && !taskPack.generationUsedFallback) {
    return "AI assisted";
  }

  if (taskPack.generationMode === "ollama" && taskPack.generationUsedFallback) {
    return "AI fallback";
  }

  return "Template";
}

function getTaskPackProjectName(taskPack: TaskPack) {
  return taskPack.projectName ?? `Project #${taskPack.projectId}`;
}

function getTopStack(projects: Project[]) {
  const counts = new Map<string, number>();

  for (const project of projects) {
    for (const item of project.detectedStack) {
      counts.set(item, (counts.get(item) ?? 0) + 1);
    }
  }

  const [stack] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
  return stack ?? "—";
}

function getMostUsedTarget(taskPacks: TaskPack[]) {
  const counts = new Map<string, number>();

  for (const taskPack of taskPacks) {
    counts.set(taskPack.targetTool, (counts.get(taskPack.targetTool) ?? 0) + 1);
  }

  const [target] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
  return target ?? "—";
}

function getTaskTypeLabel(value: string) {
  if (!value) return "Unknown";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function getProjectFailingLabels(project: Project) {
  const checks = project.readinessReport?.checks ?? [];
  const failedChecks = checks
    .filter((check) => !check.passed)
    .map((check) => check.label)
    .filter(Boolean);

  if (failedChecks.length > 0) {
    return failedChecks;
  }

  return project.readinessReport?.issues ?? [];
}

function getTopIssues(projects: Project[]): IssueSignal[] {
  const issueMap = new Map<string, IssueSignal>();

  for (const project of projects) {
    const labels = getProjectFailingLabels(project);

    for (const label of labels) {
      const normalized = label.trim();

      if (!normalized) {
        continue;
      }

      const key = normalized.toLowerCase();
      const existing = issueMap.get(key);

      if (existing) {
        existing.count += 1;
        existing.projects.push(project.name);
        continue;
      }

      issueMap.set(key, {
        key,
        label: normalized,
        count: 1,
        projects: [project.name]
      });
    }
  }

  return [...issueMap.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 7);
}

function getCountSignals(values: string[], formatter = (value: string) => value): CountSignal[] {
  const counts = new Map<string, CountSignal>();

  for (const value of values) {
    const key = value || "unknown";
    const existing = counts.get(key);

    if (existing) {
      existing.count += 1;
      continue;
    }

    counts.set(key, {
      key,
      label: formatter(key),
      count: 1
    });
  }

  return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function getRecommendedActions(projects: Project[], issues: IssueSignal[]) {
  const actions: string[] = [];
  const weakestProject = [...projects].sort((a, b) => a.readinessScore - b.readinessScore)[0];

  if (weakestProject) {
    actions.push(`Improve ${weakestProject.name} first: it has the lowest readiness score.`);
  }

  for (const issue of issues.slice(0, 3)) {
    actions.push(`Fix “${issue.label}” across ${issue.count} project${issue.count === 1 ? "" : "s"}.`);
  }

  if (actions.length === 0) {
    actions.push("Scan more projects or generate Task Packs to build workspace analytics.");
  }

  return actions.slice(0, 4);
}

function getProjectIssuePreview(project: Project) {
  const labels = getProjectFailingLabels(project);

  if (labels.length === 0) {
    return "No major readiness issue detected.";
  }

  return labels.slice(0, 3).join(" · ");
}

function MetricCard({
  icon,
  label,
  value,
  caption,
  tone = "default"
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  caption: string;
  tone?: "default" | "danger" | "good";
}) {
  const toneClass =
    tone === "danger"
      ? "text-[#ff4d6d]"
      : tone === "good"
        ? "text-[#00ff9d]"
        : "text-white";

  return (
    <article className="cf-card group p-5 transition duration-200 hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.035]">
      <div className="mb-4 flex size-10 items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-200 transition group-hover:border-white/20 group-hover:text-white">
        {icon}
      </div>

      <p className="cf-tech-label text-xs uppercase text-neutral-500">
        {label}
      </p>

      <p className={["cf-display-font mt-2 truncate text-4xl font-semibold leading-none", toneClass].join(" ")}>
        {value}
      </p>

      <p className="mt-2 truncate text-sm text-neutral-500">
        {caption}
      </p>
    </article>
  );
}

function EmptyState({
  icon,
  title,
  description,
  action
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-[1.5rem] border border-dashed border-white/10 bg-black/30 p-6">
      <div className="mb-4 flex size-10 items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-300">
        {icon}
      </div>

      <h3 className="text-sm font-semibold text-white">{title}</h3>
      <p className="mt-2 max-w-xl text-sm leading-6 text-neutral-500">{description}</p>

      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

function ScoreBar({ score }: { score: number | null }) {
  return (
    <div className="rounded-full border border-white/10 bg-black p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.055)]">
      <div className="h-2.5 overflow-hidden rounded-full bg-white/[0.075]">
        <div
          className={[
            "h-full rounded-full transition-[width] duration-500 ease-out",
            getScoreFillClass(score)
          ].join(" ")}
          style={{ width: getScoreWidth(score) }}
        />
      </div>
    </div>
  );
}

function DistributionBar({
  label,
  caption,
  count,
  width,
  score
}: {
  label: string;
  caption: string;
  count: number;
  width: string;
  score: number;
}) {
  return (
    <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
      <div className="mb-3 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-white">{label}</p>
          <p className="mt-0.5 text-xs text-neutral-600">{caption}</p>
        </div>

        <span className="cf-display-font text-2xl font-semibold text-white">{count}</span>
      </div>

      <div className="rounded-full border border-white/10 bg-black p-1">
        <div className="h-2.5 overflow-hidden rounded-full bg-white/[0.075]">
          <div
            className={[
              "h-full rounded-full transition-[width] duration-500 ease-out",
              getScoreFillClass(score)
            ].join(" ")}
            style={{ width }}
          />
        </div>
      </div>
    </div>
  );
}

function CountBar({
  signal,
  max,
  icon
}: {
  signal: CountSignal | IssueSignal;
  max: number;
  icon?: ReactNode;
}) {
  const width = `${Math.max(5, Math.min(100, (signal.count / Math.max(1, max)) * 100))}%`;

  return (
    <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            {icon && <span className="shrink-0 text-neutral-500">{icon}</span>}
            <p className="truncate text-sm font-semibold text-white">{signal.label}</p>
          </div>

          {"projects" in signal && (
            <p className="mt-1 line-clamp-1 text-xs text-neutral-600">
              {signal.projects.slice(0, 4).join(", ")}
            </p>
          )}
        </div>

        <span className="cf-display-font shrink-0 text-xl font-semibold text-white">{signal.count}</span>
      </div>

      <div className="h-2 overflow-hidden rounded-full bg-white/[0.075]">
        <div
          className="h-full rounded-full bg-white transition-[width] duration-500 ease-out"
          style={{ width }}
        />
      </div>
    </div>
  );
}

function ProjectReportCard({ project }: { project: Project }) {
  return (
    <motion.div
      key={project.id}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={REPORT_TRANSITION}
      className="rounded-[1.35rem] border border-neutral-900 bg-black/35 p-4 transition hover:border-white/20 hover:bg-white/[0.03]"
    >
      <div className="mb-3 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{project.name}</p>
          <p className="mt-1 truncate text-xs text-neutral-600">{project.localPath}</p>
        </div>

        <span className="cf-display-font shrink-0 text-2xl font-semibold text-white">
          {project.readinessScore}
        </span>
      </div>

      <ScoreBar score={project.readinessScore} />

      <p className="mt-3 line-clamp-2 text-sm leading-6 text-neutral-500">
        {getProjectIssuePreview(project)}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {project.detectedStack.slice(0, 4).map((item) => (
          <span key={item} className="rounded-full border border-neutral-900 bg-black/45 px-2.5 py-1 text-[11px] text-neutral-500">
            {item}
          </span>
        ))}
      </div>
    </motion.div>
  );
}

function TaskPackActivityItem({
  taskPack,
  onOpen
}: {
  taskPack: TaskPack;
  onOpen: (taskPack: TaskPack) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(taskPack)}
      className="group w-full rounded-[1.35rem] border border-neutral-900 bg-black/35 p-4 text-left transition duration-150 hover:-translate-y-0.5 hover:border-white/25 hover:bg-white/[0.04]"
    >
      <div className="mb-3 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="line-clamp-1 text-sm font-semibold text-white">
            {taskPack.title}
          </p>

          <p className="mt-1 truncate text-xs text-neutral-600">
            {getTaskPackProjectName(taskPack)} · {formatDate(taskPack.createdAt)}
          </p>
        </div>

        <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-neutral-400">
          {getTaskPackBodyBadge(taskPack)}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-900 bg-black/45 px-2.5 py-1 text-[11px] text-neutral-500">
          <AiToolLogo tool={taskPack.targetTool} size="sm" />
          {getAiToolLabel(taskPack.targetTool)}
        </span>

        <span className="rounded-full border border-neutral-900 bg-black/45 px-2.5 py-1 text-[11px] text-neutral-500">
          {getTaskTypeLabel(taskPack.taskType)}
        </span>
      </div>
    </button>
  );
}

export function ReportsPage({
  projects,
  taskPacks,
  readinessScore,
  statusMessage,
  onOpenProjects,
  onOpenTaskPacks,
  onOpenTaskPack
}: ReportsPageProps) {
  const [projectLens, setProjectLens] = useState<ProjectLens>("attention");
  const [exportStatusMessage, setExportStatusMessage] = useState<string | null>(null);

  const averageReadiness = readinessScore ?? getAverageReadiness(projects);

  const handleExportReport = (format: WorkspaceReportExportFormat) => {
    const fileName = exportWorkspaceReport(
      {
        projects,
        taskPacks,
        readinessScore: averageReadiness
      },
      format
    );

    setExportStatusMessage(`Exported ${fileName}`);

    window.setTimeout(() => {
      setExportStatusMessage(null);
    }, 3200);
  };

  const topIssues = useMemo(() => getTopIssues(projects), [projects]);
  const recommendedActions = useMemo(() => getRecommendedActions(projects, topIssues), [projects, topIssues]);

  const lowReadinessProjects = useMemo(() => {
    return [...projects]
      .filter((project) => project.readinessScore < 50)
      .sort((a, b) => a.readinessScore - b.readinessScore);
  }, [projects]);

  const filteredProjects = useMemo(() => {
    const sorted = [...projects].sort((a, b) => a.readinessScore - b.readinessScore);

    if (projectLens === "attention") {
      return sorted.filter((project) => project.readinessScore < 50).slice(0, 6);
    }

    if (projectLens === "ready") {
      return sorted.reverse().filter((project) => project.readinessScore >= 80).slice(0, 6);
    }

    return sorted.slice(0, 8);
  }, [projectLens, projects]);

  const recentTaskPacks = useMemo(() => {
    return [...taskPacks]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 6);
  }, [taskPacks]);

  const buckets = useMemo(() => {
    const scores = projects.map((project) => project.readinessScore);

    return [
      {
        label: "0–39",
        caption: "Poor",
        count: scores.filter((score) => score < 40).length,
        score: 24
      },
      {
        label: "40–59",
        caption: "Risky",
        count: scores.filter((score) => score >= 40 && score < 60).length,
        score: 48
      },
      {
        label: "60–79",
        caption: "Acceptable",
        count: scores.filter((score) => score >= 60 && score < 80).length,
        score: 68
      },
      {
        label: "80–100",
        caption: "Ready",
        count: scores.filter((score) => score >= 80).length,
        score: 90
      }
    ];
  }, [projects]);

  const maxBucketCount = Math.max(1, ...buckets.map((bucket) => bucket.count));
  const topStack = getTopStack(projects);
  const topTarget = getMostUsedTarget(taskPacks);
  const targetSignals = useMemo(
    () => getCountSignals(taskPacks.map((taskPack) => taskPack.targetTool), getAiToolLabel).slice(0, 5),
    [taskPacks]
  );
  const taskTypeSignals = useMemo(
    () => getCountSignals(taskPacks.map((taskPack) => taskPack.taskType), getTaskTypeLabel).slice(0, 5),
    [taskPacks]
  );
  const assistedCount = taskPacks.filter((taskPack) => taskPack.generationMode === "ollama" && !taskPack.generationUsedFallback).length;
  const fallbackCount = taskPacks.filter((taskPack) => taskPack.generationUsedFallback).length;
  const missingAgentsCount = projects.filter((project) => {
    return (project.readinessReport?.checks ?? []).some((check) => {
      const label = check.label.toLowerCase();
      return !check.passed && (label.includes("agent") || label.includes("agents"));
    });
  }).length;

  return (
    <section className="space-y-5">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={REPORT_TRANSITION}
        className="overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.055),rgba(255,255,255,0.014)_48%,rgba(255,255,255,0.006))] p-6 shadow-[0_16px_52px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.045)]"
      >
        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_410px]">
          <div>
            <div className="mb-4 flex flex-wrap gap-2">
              <span className="cf-badge">
                <BarChart3 size={13} />
                Reports
              </span>
              <span className="cf-badge">Workspace intelligence</span>
              <span className="cf-badge">Local analytics</span>
            </div>

            <h2 className="max-w-4xl text-[34px] font-semibold leading-[1.05] tracking-[-0.05em] text-white">
              Understand project readiness, prompt activity and AI workflow health.
            </h2>

            <p className="mt-3 max-w-3xl text-sm leading-6 text-neutral-400">
              Reports turns your local projects, readiness checks and Task Pack history into a clear action plan. Find weak context, repeated setup gaps and the next safest improvements before sending work to coding agents.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <Button variant="primary" onClick={onOpenProjects}>
                <FolderOpen size={15} />
                Review projects
              </Button>
              <Button variant="secondary" onClick={onOpenTaskPacks}>
                <Archive size={15} />
                Open Task Packs
              </Button>
              <Button variant="ghost" onClick={() => handleExportReport("md")}>
                <FileText size={15} />
                Export .md
              </Button>
              <Button variant="ghost" onClick={() => handleExportReport("txt")}>
                <Download size={15} />
                Export .txt
              </Button>
            </div>

            {exportStatusMessage && (
              <p className="mt-4 inline-flex rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-xs font-medium text-emerald-200">
                {exportStatusMessage}
              </p>
            )}
          </div>

          <aside className="rounded-[1.5rem] border border-neutral-900 bg-black/40 p-5">
            <p className="cf-tech-label text-[10px] uppercase text-neutral-600">Workspace status</p>
            <h3 className="mt-2 text-base font-semibold text-white">{getReadinessLabel(averageReadiness)}</h3>
            <p className="mt-2 line-clamp-3 text-sm leading-6 text-neutral-500">
              {statusMessage || `${projects.length} project${projects.length === 1 ? "" : "s"}, ${taskPacks.length} Task Pack${taskPacks.length === 1 ? "" : "s"} and ${topIssues.length} recurring readiness signal${topIssues.length === 1 ? "" : "s"}.`}
            </p>
            <div className="mt-5">
              <ScoreBar score={averageReadiness} />
            </div>

            <div className="mt-5 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-2xl border border-neutral-900 bg-black/45 p-3">
                <p className="cf-display-font text-xl font-semibold text-white">{projects.length}</p>
                <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-neutral-700">Projects</p>
              </div>
              <div className="rounded-2xl border border-neutral-900 bg-black/45 p-3">
                <p className="cf-display-font text-xl font-semibold text-white">{lowReadinessProjects.length}</p>
                <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-neutral-700">Weak</p>
              </div>
              <div className="rounded-2xl border border-neutral-900 bg-black/45 p-3">
                <p className="cf-display-font text-xl font-semibold text-white">{assistedCount}</p>
                <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-neutral-700">AI runs</p>
              </div>
            </div>
          </aside>
        </div>
      </motion.div>

      <ValidationLab projects={projects} />

      <div className="grid gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <MetricCard icon={<FolderOpen size={18} />} label="Projects" value={projects.length} caption="scanned repositories" />
        <MetricCard icon={<Gauge size={18} />} label="Avg readiness" value={averageReadiness === null ? "—" : averageReadiness} caption="workspace AI score" tone={averageReadiness !== null && averageReadiness >= 80 ? "good" : averageReadiness !== null && averageReadiness < 50 ? "danger" : "default"} />
        <MetricCard icon={<AlertTriangle size={18} />} label="Need attention" value={lowReadinessProjects.length} caption="below 50/100" tone={lowReadinessProjects.length > 0 ? "danger" : "good"} />
        <MetricCard icon={<Archive size={18} />} label="Task Packs" value={taskPacks.length} caption="saved prompts" />
        <MetricCard icon={<Bot size={18} />} label="Top target" value={topTarget === "—" ? "—" : getAiToolLabel(topTarget)} caption="most used agent" />
        <MetricCard icon={<FileWarning size={18} />} label="Missing AGENTS" value={missingAgentsCount} caption="projects without rules" tone={missingAgentsCount > 0 ? "danger" : "good"} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.08fr)_minmax(420px,0.92fr)]">
        <article className="cf-card p-5">
          <div className="mb-5 flex flex-col gap-4 2xl:flex-row 2xl:items-start 2xl:justify-between">
            <div>
              <p className="cf-tech-label mb-2 text-xs uppercase text-neutral-600">Readiness map</p>
              <h3 className="text-base font-semibold text-white">Projects by context quality</h3>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-neutral-500">
                Filter projects by readiness and open the Projects page when you want to rescan, generate AGENTS.md or create a focused Task Pack.
              </p>
            </div>

            <div className="w-full max-w-[520px] 2xl:w-[500px]">
              <SegmentedFilter
                value={projectLens}
                options={PROJECT_LENS_OPTIONS}
                onChange={(value) => setProjectLens(value as ProjectLens)}
              />
            </div>
          </div>

          {projects.length === 0 ? (
            <EmptyState
              icon={<FolderOpen size={18} />}
              title="No projects scanned yet"
              description="Add a local repository to start building readiness reports and workspace-level recommendations."
              action={(
                <Button variant="primary" onClick={onOpenProjects}>
                  <FolderOpen size={15} />
                  Add or scan project
                </Button>
              )}
            />
          ) : filteredProjects.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 size={18} />}
              title="No projects in this lens"
              description="Try another filter or scan more projects to populate this report section."
            />
          ) : (
            <div className="grid gap-3 xl:grid-cols-2">
              {filteredProjects.map((project) => (
                <ProjectReportCard key={project.id} project={project} />
              ))}
            </div>
          )}
        </article>

        <div className="space-y-5">
          <article className="cf-card p-5">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="cf-tech-label mb-2 text-xs uppercase text-neutral-600">Distribution</p>
                <h3 className="text-base font-semibold text-white">Readiness spread</h3>
                <p className="mt-1 text-sm text-neutral-500">Score ranges across your local workspace.</p>
              </div>
              <span className="cf-badge">{projects.length} total</span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {buckets.map((bucket) => (
                <DistributionBar
                  key={bucket.label}
                  label={bucket.label}
                  caption={bucket.caption}
                  count={bucket.count}
                  score={bucket.score}
                  width={`${Math.max(4, (bucket.count / maxBucketCount) * 100)}%`}
                />
              ))}
            </div>
          </article>

          <article className="cf-card p-5">
            <p className="cf-tech-label mb-2 text-xs uppercase text-neutral-600">Workspace signals</p>
            <div className="grid gap-3">
              <div className="flex items-center justify-between gap-4 rounded-2xl border border-neutral-900 bg-black/35 px-4 py-3">
                <span className="text-sm text-neutral-500">Top stack</span>
                <span className="font-medium text-white">{topStack}</span>
              </div>
              <div className="flex items-center justify-between gap-4 rounded-2xl border border-neutral-900 bg-black/35 px-4 py-3">
                <span className="text-sm text-neutral-500">Top target</span>
                <span className="font-medium text-white">{topTarget === "—" ? "—" : getAiToolLabel(topTarget)}</span>
              </div>
              <div className="flex items-center justify-between gap-4 rounded-2xl border border-neutral-900 bg-black/35 px-4 py-3">
                <span className="text-sm text-neutral-500">Template fallback</span>
                <span className="font-medium text-white">{fallbackCount}</span>
              </div>
            </div>
          </article>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(420px,1.05fr)]">
        <article className="cf-card p-5">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <p className="cf-tech-label mb-2 text-xs uppercase text-neutral-600">Common gaps</p>
              <h3 className="text-base font-semibold text-white">Top readiness issues</h3>
              <p className="mt-1 text-sm leading-6 text-neutral-500">Repeated issues are the fastest way to improve the whole workspace.</p>
            </div>
            <span className="cf-badge">{topIssues.length} signals</span>
          </div>

          {topIssues.length === 0 ? (
            <EmptyState
              icon={<ShieldCheck size={18} />}
              title="No recurring issues yet"
              description="Scan projects to collect readiness checks. Once issues appear, this section will rank them by frequency."
            />
          ) : (
            <div className="space-y-3">
              {topIssues.map((issue) => (
                <CountBar key={issue.key} signal={issue} max={topIssues[0]?.count ?? 1} icon={<CircleDot size={14} />} />
              ))}
            </div>
          )}
        </article>

        <article className="cf-card p-5">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <p className="cf-tech-label mb-2 text-xs uppercase text-neutral-600">Next best actions</p>
              <h3 className="text-base font-semibold text-white">What to fix first</h3>
              <p className="mt-1 text-sm leading-6 text-neutral-500">A simple action list derived from readiness checks and low scoring projects.</p>
            </div>
            <Sparkles size={18} className="text-neutral-500" />
          </div>

          <div className="space-y-3">
            {recommendedActions.map((action, index) => (
              <div key={`${action}-${index}`} className="flex gap-3 rounded-2xl border border-neutral-900 bg-black/35 p-4">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-white text-xs font-semibold text-black">
                  {index + 1}
                </span>
                <p className="text-sm leading-6 text-neutral-400">{action}</p>
              </div>
            ))}
          </div>
        </article>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(420px,0.9fr)]">
        <article className="cf-card p-5">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <p className="cf-tech-label mb-2 text-xs uppercase text-neutral-600">Recent activity</p>
              <h3 className="text-base font-semibold text-white">Latest generated Task Packs</h3>
              <p className="mt-1 text-sm text-neutral-500">Recent prompt outputs from your local archive.</p>
            </div>
            <Button variant="secondary" onClick={onOpenTaskPacks}>
              <Archive size={15} />
              Open Archive
            </Button>
          </div>

          {recentTaskPacks.length === 0 ? (
            <EmptyState
              icon={<WandSparkles size={18} />}
              title="No Task Packs generated yet"
              description="Create your first Task Pack to start seeing prompt activity, target usage and generation-mode analytics."
              action={(
                <Button variant="primary" onClick={onOpenProjects}>
                  <FolderOpen size={15} />
                  Pick a project
                </Button>
              )}
            />
          ) : (
            <div className="grid gap-3 xl:grid-cols-2">
              {recentTaskPacks.map((taskPack) => (
                <TaskPackActivityItem key={taskPack.id} taskPack={taskPack} onOpen={onOpenTaskPack} />
              ))}
            </div>
          )}
        </article>

        <div className="space-y-5">
          <article className="cf-card p-5">
            <div className="mb-5">
              <p className="cf-tech-label mb-2 text-xs uppercase text-neutral-600">Agent target usage</p>
              <h3 className="text-base font-semibold text-white">Where prompts are going</h3>
            </div>

            {targetSignals.length === 0 ? (
              <p className="rounded-2xl border border-neutral-900 bg-black/35 p-4 text-sm text-neutral-500">No target usage yet.</p>
            ) : (
              <div className="space-y-3">
                {targetSignals.map((signal) => (
                  <CountBar key={signal.key} signal={signal} max={targetSignals[0]?.count ?? 1} icon={<AiToolLogo tool={signal.key} size="sm" />} />
                ))}
              </div>
            )}
          </article>

          <article className="cf-card p-5">
            <div className="mb-5">
              <p className="cf-tech-label mb-2 text-xs uppercase text-neutral-600">Task categories</p>
              <h3 className="text-base font-semibold text-white">What work is requested</h3>
            </div>

            {taskTypeSignals.length === 0 ? (
              <p className="rounded-2xl border border-neutral-900 bg-black/35 p-4 text-sm text-neutral-500">No task type history yet.</p>
            ) : (
              <div className="space-y-3">
                {taskTypeSignals.map((signal) => (
                  <CountBar key={signal.key} signal={signal} max={taskTypeSignals[0]?.count ?? 1} icon={<ListChecks size={14} />} />
                ))}
              </div>
            )}
          </article>
        </div>
      </div>

      <article className="cf-card p-5">
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="rounded-[1.5rem] border border-neutral-900 bg-black/35 p-5">
            <RefreshCw size={18} className="mb-4 text-neutral-500" />
            <p className="text-sm font-semibold text-white">Refresh by rescanning</p>
            <p className="mt-2 text-sm leading-6 text-neutral-500">Reports use local project metadata. Rescan projects when README, scripts, tests or AGENTS.md change.</p>
          </div>

          <div className="rounded-[1.5rem] border border-neutral-900 bg-black/35 p-5">
            <Layers3 size={18} className="mb-4 text-neutral-500" />
            <p className="text-sm font-semibold text-white">Local-first analytics</p>
            <p className="mt-2 text-sm leading-6 text-neutral-500">Source code, Project Memory, Task Packs and readiness checks stay on this machine unless you explicitly export them.</p>
          </div>

          <div className="rounded-[1.5rem] border border-neutral-900 bg-black/35 p-5">
            <Clock3 size={18} className="mb-4 text-neutral-500" />
            <p className="text-sm font-semibold text-white">Export workspace snapshot</p>
            <p className="mt-2 text-sm leading-6 text-neutral-500">Download a local markdown or text report with readiness gaps, next actions and Task Pack activity.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => handleExportReport("md")}>
                <FileText size={14} />
                .md
              </Button>
              <Button variant="secondary" onClick={() => handleExportReport("txt")}>
                <Download size={14} />
                .txt
              </Button>
            </div>
          </div>
        </div>
      </article>
    </section>
  );
}
