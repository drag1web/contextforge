import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  Activity,
  AlertTriangle,
  Archive,
  ArrowUpRight,
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
  TestTube2,
  WandSparkles,
} from "lucide-react";

import type { Project, TaskPack } from "../types";
import { AiToolLogo } from "../components/ai/AiToolLogo";
import { getAiToolLabel } from "../components/ai/aiToolOptions";
import { WorkspacePageHeader } from "../components/layout/WorkspacePageHeader";
import { ValidationLab } from "../components/reports/ValidationLab";
import { Button } from "../components/ui/Button";
import { HorizontalSlidingSelector } from "../components/ui/SlidingSelectors";
import {
  exportWorkspaceReport,
  type WorkspaceReportExportFormat,
} from "../utils/workspaceReportExport";

interface ReportsPageProps {
  projects: Project[];
  taskPacks: TaskPack[];
  readinessScore: number | null;
  onOpenProjects: () => void;
  onOpenTaskPacks: () => void;
  onOpenTaskPack: (taskPack: TaskPack) => void;
  onPresenceActivityChange?: (activity: "reports" | "validation_lab") => void;
}

type ReportsTab = "overview" | "readiness" | "activity" | "validation";
type ProjectLens = "all" | "attention" | "ready";

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

const CONTENT_TRANSITION = {
  duration: 0.22,
  ease: [0.16, 1, 0.3, 1],
} as const;

function getAverageReadiness(projects: Project[]) {
  if (projects.length === 0) {
    return null;
  }

  const total = projects.reduce(
    (sum, project) => sum + project.readinessScore,
    0,
  );
  return Math.round(total / projects.length);
}

function getReadinessKey(score: number | null) {
  if (score === null) return "empty";
  if (score >= 80) return "ready";
  if (score >= 60) return "stable";
  if (score >= 40) return "attention";
  return "weak";
}

function getScoreWidth(score: number | null) {
  if (score === null) {
    return "4%";
  }

  return `${Math.max(4, Math.min(100, score))}%`;
}

function getScoreFillClass(score: number | null) {
  if (score !== null && score >= 80) {
    return "bg-emerald-400";
  }

  if (score !== null && score < 50) {
    return "bg-neutral-500";
  }

  return "bg-white";
}

function formatDate(value: string, locale: string) {
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function getTaskPackModeLabel(taskPack: TaskPack, t: TFunction) {
  if (
    taskPack.generationMode === "ollama" &&
    !taskPack.generationUsedFallback
  ) {
    return t("reportsWorkspace.taskPackMode.assisted");
  }

  if (
    taskPack.generationMode === "ollama" &&
    taskPack.generationUsedFallback
  ) {
    return t("reportsWorkspace.taskPackMode.fallback");
  }

  return t("reportsWorkspace.taskPackMode.template");
}

function getTaskPackProjectName(taskPack: TaskPack, t: TFunction) {
  return (
    taskPack.projectName ??
    t("reportsWorkspace.activity.unknownProject", {
      id: taskPack.projectId,
    })
  );
}

function getTaskTypeLabel(value: string, t: TFunction) {
  if (!value) {
    return t("reportsWorkspace.taskTypes.unknown");
  }

  return t(`reportsWorkspace.taskTypes.${value}`, {
    defaultValue: value.charAt(0).toUpperCase() + value.slice(1),
  });
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
    counts.set(
      taskPack.targetTool,
      (counts.get(taskPack.targetTool) ?? 0) + 1,
    );
  }

  const [target] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
  return target ?? "—";
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

function getLocalizedIssueLabel(label: string, t: TFunction) {
  const normalized = label.trim().toLowerCase();
  const mappings: Array<[RegExp, string]> = [
    [/^readme$/, "readme"],
    [/agent|agents/, "agents"],
    [/build command/, "buildCommand"],
    [/dev command|development command/, "devCommand"],
    [/test command/, "testCommand"],
    [/environment example|env example/, "environmentExample"],
    [/typescript config|typescript configuration/, "typescriptConfig"],
    [/tests structure|test structure/, "testStructure"],
    [/documentation/, "documentation"],
    [/ci workflow|ci-process|ci process/, "ciWorkflow"],
  ];

  const match = mappings.find(([pattern]) => pattern.test(normalized));

  return match
    ? t(`reportsWorkspace.issueLabels.${match[1]}`)
    : label;
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
        projects: [project.name],
      });
    }
  }

  return [...issueMap.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 7);
}

function getCountSignals(
  values: string[],
  formatter = (value: string) => value,
): CountSignal[] {
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
      count: 1,
    });
  }

  return [...counts.values()].sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label),
  );
}

function getRecommendedActions(
  projects: Project[],
  issues: IssueSignal[],
  t: TFunction,
) {
  const actions: string[] = [];
  const weakestProject = [...projects].sort(
    (a, b) => a.readinessScore - b.readinessScore,
  )[0];

  if (weakestProject) {
    actions.push(
      t("reportsWorkspace.actions.lowest", {
        name: weakestProject.name,
        score: weakestProject.readinessScore,
      }),
    );
  }

  for (const issue of issues.slice(0, 3)) {
    actions.push(
      t("reportsWorkspace.actions.issue", {
        label: issue.label,
        count: issue.count,
      }),
    );
  }

  if (actions.length === 0) {
    actions.push(t("reportsWorkspace.actions.empty"));
  }

  return actions.slice(0, 4);
}

function ScoreTrack({ score }: { score: number | null }) {
  return (
    <div className="rounded-full border border-white/10 bg-black p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.055)]">
      <div className="h-2 overflow-hidden rounded-full bg-white/[0.075]">
        <motion.div
          className={["h-full rounded-full", getScoreFillClass(score)].join(" ")}
          initial={false}
          animate={{ width: getScoreWidth(score) }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
          {eyebrow}
        </p>
        <h3 className="mt-1 text-base font-semibold text-white">{title}</h3>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm leading-6 text-neutral-500">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function CompactMetric({
  icon,
  label,
  value,
  caption,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  caption: string;
}) {
  return (
    <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="cf-tech-label truncate text-[10px] uppercase text-neutral-600">
            {label}
          </p>
          <p className="cf-display-font mt-2 text-2xl font-semibold leading-none text-white">
            {value}
          </p>
          <p className="mt-2 line-clamp-2 text-xs leading-5 text-neutral-600">
            {caption}
          </p>
        </div>
        <span className="grid size-9 shrink-0 place-items-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-400">
          {icon}
        </span>
      </div>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-[1.35rem] border border-dashed border-white/10 bg-black/25 p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-400">
          {icon}
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-neutral-500">
            {description}
          </p>
          {action ? <div className="mt-4">{action}</div> : null}
        </div>
      </div>
    </div>
  );
}

function CountBar({
  signal,
  max,
  icon,
  compact = false,
}: {
  signal: CountSignal | IssueSignal;
  max: number;
  icon?: ReactNode;
  compact?: boolean;
}) {
  const width = `${Math.max(
    5,
    Math.min(100, (signal.count / Math.max(1, max)) * 100),
  )}%`;

  return (
    <div
      className={[
        "rounded-2xl border border-neutral-900 bg-black/35",
        compact ? "p-3.5" : "p-4",
      ].join(" ")}
    >
      <div
        className={[
          "flex items-start justify-between gap-4",
          compact ? "mb-2" : "mb-3",
        ].join(" ")}
      >
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            {icon ? (
              <span className="shrink-0 text-neutral-500">{icon}</span>
            ) : null}
            <p className="truncate text-sm font-semibold text-white">
              {signal.label}
            </p>
          </div>
          {"projects" in signal ? (
            <p className="mt-1 line-clamp-1 text-xs text-neutral-600">
              {signal.projects.slice(0, 4).join(", ")}
            </p>
          ) : null}
        </div>
        <span
          className={[
            "cf-display-font shrink-0 font-semibold text-white",
            compact ? "text-lg" : "text-xl",
          ].join(" ")}
        >
          {signal.count}
        </span>
      </div>
      <div
        className={[
          "overflow-hidden rounded-full bg-white/[0.075]",
          compact ? "h-1" : "h-1.5",
        ].join(" ")}
      >
        <motion.div
          className="h-full rounded-full bg-white"
          initial={false}
          animate={{ width }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>
    </div>
  );
}

function DistributionBand({
  label,
  caption,
  count,
  width,
  ready,
}: {
  label: string;
  caption: string;
  count: number;
  width: string;
  ready: boolean;
}) {
  return (
    <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">{label}</p>
          <p className="mt-0.5 text-xs text-neutral-600">{caption}</p>
        </div>
        <span className="cf-display-font text-xl font-semibold text-white">
          {count}
        </span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.075]">
        <motion.div
          className={[
            "h-full rounded-full",
            ready ? "bg-emerald-400" : "bg-white",
          ].join(" ")}
          initial={false}
          animate={{ width }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>
    </div>
  );
}

function ProjectReportCard({
  project,
  onOpen,
  t,
}: {
  project: Project;
  onOpen: () => void;
  t: TFunction;
}) {
  const issuePreview = getProjectFailingLabels(project)
    .slice(0, 2)
    .map((label) => getLocalizedIssueLabel(label, t))
    .join(" · ");

  return (
    <motion.button
      type="button"
      onClick={onOpen}
      initial={{ opacity: 0, y: 7 }}
      animate={{ opacity: 1, y: 0 }}
      transition={CONTENT_TRANSITION}
      className="group w-full rounded-[1.35rem] border border-neutral-900 bg-black/35 p-4 text-left transition hover:border-white/20 hover:bg-white/[0.03]"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-sm font-semibold text-white">
              {project.name}
            </p>
            <ArrowUpRight
              size={13}
              className="shrink-0 text-neutral-700 transition group-hover:text-neutral-300"
            />
          </div>
          <p
            className="mt-1 truncate text-xs text-neutral-600"
            title={project.localPath}
          >
            {project.localPath}
          </p>
        </div>
        <span className="cf-display-font shrink-0 text-2xl font-semibold text-white">
          {project.readinessScore}
        </span>
      </div>
      <div className="mt-3">
        <ScoreTrack score={project.readinessScore} />
      </div>
      <p className="mt-3 line-clamp-2 text-sm leading-6 text-neutral-500">
        {issuePreview || t("reportsWorkspace.readiness.noIssue")}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {project.detectedStack.slice(0, 3).map((item) => (
          <span
            key={item}
            className="rounded-full border border-neutral-900 bg-black/45 px-2.5 py-1 text-[11px] text-neutral-500"
          >
            {item}
          </span>
        ))}
      </div>
    </motion.button>
  );
}

function TaskPackActivityItem({
  taskPack,
  onOpen,
  locale,
  t,
}: {
  taskPack: TaskPack;
  onOpen: (taskPack: TaskPack) => void;
  locale: string;
  t: TFunction;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(taskPack)}
      className="group w-full rounded-[1.35rem] border border-neutral-900 bg-black/35 p-4 text-left transition hover:border-white/20 hover:bg-white/[0.03]"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p
            className="line-clamp-2 min-h-[2.5rem] text-sm font-semibold leading-5 text-white"
            title={taskPack.title}
          >
            {taskPack.title}
          </p>
          <p
            className="mt-1 truncate text-xs text-neutral-600"
            title={`${getTaskPackProjectName(taskPack, t)} · ${formatDate(taskPack.createdAt, locale)}`}
          >
            {getTaskPackProjectName(taskPack, t)} · {formatDate(taskPack.createdAt, locale)}
          </p>
        </div>
        <ArrowUpRight
          size={14}
          className="shrink-0 text-neutral-700 transition group-hover:text-neutral-300"
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-900 bg-black/45 px-2.5 py-1 text-[11px] text-neutral-500">
          <AiToolLogo tool={taskPack.targetTool} size="sm" />
          {getAiToolLabel(taskPack.targetTool)}
        </span>
        <span className="rounded-full border border-neutral-900 bg-black/45 px-2.5 py-1 text-[11px] text-neutral-500">
          {getTaskTypeLabel(taskPack.taskType, t)}
        </span>
        <span className="rounded-full border border-neutral-900 bg-black/45 px-2.5 py-1 text-[11px] text-neutral-500">
          {getTaskPackModeLabel(taskPack, t)}
        </span>
      </div>
    </button>
  );
}

export function ReportsPage({
  projects,
  taskPacks,
  readinessScore,
  onOpenProjects,
  onOpenTaskPacks,
  onOpenTaskPack,
  onPresenceActivityChange,
}: ReportsPageProps) {
  const { t, i18n } = useTranslation();
  const [activeTab, setActiveTab] = useState<ReportsTab>("overview");

  useEffect(() => {
    onPresenceActivityChange?.(
      activeTab === "validation" ? "validation_lab" : "reports",
    );

    return () => {
      onPresenceActivityChange?.("reports");
    };
  }, [activeTab, onPresenceActivityChange]);
  const [projectLens, setProjectLens] = useState<ProjectLens>("all");
  const [exportStatusMessage, setExportStatusMessage] = useState<string | null>(
    null,
  );

  const locale = i18n.resolvedLanguage === "ru" ? "ru-RU" : "en-US";
  const averageReadiness = readinessScore ?? getAverageReadiness(projects);
  const topIssues = useMemo(
    () =>
      getTopIssues(projects).map((issue) => ({
        ...issue,
        label: getLocalizedIssueLabel(issue.label, t),
      })),
    [projects, t],
  );
  const recommendedActions = useMemo(
    () => getRecommendedActions(projects, topIssues, t),
    [projects, t, topIssues],
  );

  const lowReadinessProjects = useMemo(
    () =>
      [...projects]
        .filter((project) => project.readinessScore < 50)
        .sort((a, b) => a.readinessScore - b.readinessScore),
    [projects],
  );

  const filteredProjects = useMemo(() => {
    const sorted = [...projects].sort(
      (a, b) => a.readinessScore - b.readinessScore,
    );

    if (projectLens === "attention") {
      return sorted.filter((project) => project.readinessScore < 50).slice(0, 8);
    }

    if (projectLens === "ready") {
      return sorted
        .filter((project) => project.readinessScore >= 80)
        .reverse()
        .slice(0, 8);
    }

    return sorted.slice(0, 10);
  }, [projectLens, projects]);

  const recentTaskPacks = useMemo(
    () =>
      [...taskPacks]
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        )
        .slice(0, 6),
    [taskPacks],
  );

  const buckets = useMemo(() => {
    const scores = projects.map((project) => project.readinessScore);

    return [
      {
        label: "0–39",
        caption: t("reportsWorkspace.readiness.bandWeak"),
        count: scores.filter((score) => score < 40).length,
        ready: false,
      },
      {
        label: "40–59",
        caption: t("reportsWorkspace.readiness.bandAttention"),
        count: scores.filter((score) => score >= 40 && score < 60).length,
        ready: false,
      },
      {
        label: "60–79",
        caption: t("reportsWorkspace.readiness.bandStable"),
        count: scores.filter((score) => score >= 60 && score < 80).length,
        ready: false,
      },
      {
        label: "80–100",
        caption: t("reportsWorkspace.readiness.bandReady"),
        count: scores.filter((score) => score >= 80).length,
        ready: true,
      },
    ];
  }, [projects, t]);

  const maxBucketCount = Math.max(1, ...buckets.map((bucket) => bucket.count));
  const topStack = getTopStack(projects);
  const topTarget = getMostUsedTarget(taskPacks);
  const targetSignals = useMemo(
    () =>
      getCountSignals(
        taskPacks.map((taskPack) => taskPack.targetTool),
        getAiToolLabel,
      ).slice(0, 5),
    [taskPacks],
  );
  const taskTypeSignals = useMemo(
    () =>
      getCountSignals(
        taskPacks.map((taskPack) => taskPack.taskType),
        (value) => getTaskTypeLabel(value, t),
      ).slice(0, 5),
    [taskPacks, t],
  );
  const assistedCount = taskPacks.filter(
    (taskPack) =>
      taskPack.generationMode === "ollama" &&
      !taskPack.generationUsedFallback,
  ).length;
  const fallbackCount = taskPacks.filter(
    (taskPack) => taskPack.generationUsedFallback,
  ).length;
  const templateCount = taskPacks.filter(
    (taskPack) => taskPack.generationMode !== "ollama",
  ).length;
  const missingAgentsCount = projects.filter((project) =>
    (project.readinessReport?.checks ?? []).some((check) => {
      const label = check.label.toLowerCase();
      return !check.passed && (label.includes("agent") || label.includes("agents"));
    }),
  ).length;

  const tabs = [
    {
      id: "overview" as const,
      label: t("reportsWorkspace.tabs.overview"),
      caption: t("reportsWorkspace.tabs.overviewCaption"),
      icon: <BarChart3 size={15} />,
    },
    {
      id: "readiness" as const,
      label: t("reportsWorkspace.tabs.readiness"),
      caption: t("reportsWorkspace.tabs.readinessCaption"),
      icon: <Gauge size={15} />,
    },
    {
      id: "activity" as const,
      label: t("reportsWorkspace.tabs.activity"),
      caption: t("reportsWorkspace.tabs.activityCaption"),
      icon: <Activity size={15} />,
    },
    {
      id: "validation" as const,
      label: t("reportsWorkspace.tabs.validation"),
      caption: t("reportsWorkspace.tabs.validationCaption"),
      icon: <TestTube2 size={15} />,
    },
  ];

  const lensOptions = [
    {
      id: "all" as const,
      label: t("reportsWorkspace.readiness.lensAll"),
      caption: t("reportsWorkspace.readiness.lensAllCaption"),
    },
    {
      id: "attention" as const,
      label: t("reportsWorkspace.readiness.lensAttention"),
      caption: t("reportsWorkspace.readiness.lensAttentionCaption"),
    },
    {
      id: "ready" as const,
      label: t("reportsWorkspace.readiness.lensReady"),
      caption: t("reportsWorkspace.readiness.lensReadyCaption"),
    },
  ];

  function handleExportReport(format: WorkspaceReportExportFormat) {
    const fileName = exportWorkspaceReport(
      {
        projects,
        taskPacks,
        readinessScore: averageReadiness,
      },
      format,
    );

    setExportStatusMessage(
      t("reportsWorkspace.export.completed", { fileName }),
    );

    window.setTimeout(() => {
      setExportStatusMessage(null);
    }, 3200);
  }

  const summaryAside = (
    <div className="grid w-full grid-cols-3 overflow-hidden rounded-2xl border border-neutral-900 bg-black/35 xl:min-w-[350px]">
      <div className="border-r border-neutral-900 px-4 py-3">
        <p className="cf-tech-label text-[9px] uppercase text-neutral-700">
          {t("reportsWorkspace.summary.projects")}
        </p>
        <p className="mt-1 text-sm font-semibold text-white">{projects.length}</p>
      </div>
      <div className="border-r border-neutral-900 px-4 py-3">
        <p className="cf-tech-label text-[9px] uppercase text-neutral-700">
          {t("reportsWorkspace.summary.readiness")}
        </p>
        <p className="mt-1 text-sm font-semibold text-white">
          {averageReadiness ?? "—"}
        </p>
      </div>
      <div className="px-4 py-3">
        <p className="cf-tech-label text-[9px] uppercase text-neutral-700">
          {t("reportsWorkspace.summary.taskPacks")}
        </p>
        <p className="mt-1 text-sm font-semibold text-white">
          {taskPacks.length}
        </p>
      </div>
    </div>
  );

  return (
    <section className="space-y-4">
      <WorkspacePageHeader
        icon={<BarChart3 size={18} />}
        eyebrow={t("reportsWorkspace.eyebrow")}
        title={t("reportsWorkspace.title")}
        description={t("reportsWorkspace.description")}
        aside={summaryAside}
      />

      <HorizontalSlidingSelector
        items={tabs}
        activeIndex={tabs.findIndex((tab) => tab.id === activeTab)}
        getItemKey={(tab) => tab.id}
        onSelect={(tab) => setActiveTab(tab.id)}
        ariaLabel={t("reportsWorkspace.tabs.ariaLabel")}
        itemClassName="h-[58px] px-3"
        renderItem={(tab, isActive) => (
          <span className="flex h-full min-w-0 items-center justify-center gap-2.5">
            <span className={isActive ? "text-black" : "text-neutral-600"}>
              {tab.icon}
            </span>
            <span className="min-w-0 text-left">
              <span className="block truncate text-xs font-semibold">
                {tab.label}
              </span>
              <span
                className={[
                  "mt-0.5 block truncate text-[10px]",
                  isActive ? "text-black/50" : "text-neutral-700",
                ].join(" ")}
              >
                {tab.caption}
              </span>
            </span>
          </span>
        )}
      />

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -5 }}
          transition={CONTENT_TRANSITION}
        >
          {activeTab === "overview" ? (
            <div className="space-y-4">
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.12fr)_minmax(380px,0.88fr)]">
                <article className="cf-card p-5">
                  <SectionHeading
                    eyebrow={t("reportsWorkspace.overview.healthEyebrow")}
                    title={t("reportsWorkspace.overview.healthTitle")}
                    description={t("reportsWorkspace.overview.healthDescription")}
                    action={(
                      <span className="rounded-full border border-neutral-800 bg-black/40 px-3 py-1.5 text-xs text-neutral-400">
                        {t(
                          `reportsWorkspace.readiness.labels.${getReadinessKey(averageReadiness)}`,
                        )}
                      </span>
                    )}
                  />

                  <div className="mt-5 flex flex-wrap items-end justify-between gap-4 rounded-[1.4rem] border border-neutral-900 bg-black/35 p-5">
                    <div>
                      <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                        {t("reportsWorkspace.overview.average")}
                      </p>
                      <p className="cf-display-font mt-2 text-5xl font-semibold leading-none text-white">
                        {averageReadiness ?? "—"}
                        <span className="ml-1 text-lg text-neutral-700">/100</span>
                      </p>
                    </div>
                    <div className="min-w-[260px] flex-1">
                      <ScoreTrack score={averageReadiness} />
                      <p className="mt-2 text-right text-xs text-neutral-600">
                        {t("reportsWorkspace.overview.scoreCaption")}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <CompactMetric
                      icon={<FolderOpen size={16} />}
                      label={t("reportsWorkspace.metrics.projects")}
                      value={projects.length}
                      caption={t("reportsWorkspace.metrics.projectsCaption")}
                    />
                    <CompactMetric
                      icon={<AlertTriangle size={16} />}
                      label={t("reportsWorkspace.metrics.attention")}
                      value={lowReadinessProjects.length}
                      caption={t("reportsWorkspace.metrics.attentionCaption")}
                    />
                    <CompactMetric
                      icon={<Archive size={16} />}
                      label={t("reportsWorkspace.metrics.taskPacks")}
                      value={taskPacks.length}
                      caption={t("reportsWorkspace.metrics.taskPacksCaption")}
                    />
                    <CompactMetric
                      icon={<FileWarning size={16} />}
                      label={t("reportsWorkspace.metrics.missingAgents")}
                      value={missingAgentsCount}
                      caption={t("reportsWorkspace.metrics.missingAgentsCaption")}
                    />
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button variant="primary" onClick={onOpenProjects}>
                      <FolderOpen size={15} />
                      {t("reportsWorkspace.actions.openProjects")}
                    </Button>
                    <Button variant="secondary" onClick={onOpenTaskPacks}>
                      <Archive size={15} />
                      {t("reportsWorkspace.actions.openTaskPacks")}
                    </Button>
                  </div>
                </article>

                <article className="cf-card p-5">
                  <SectionHeading
                    eyebrow={t("reportsWorkspace.overview.actionsEyebrow")}
                    title={t("reportsWorkspace.overview.actionsTitle")}
                    description={t("reportsWorkspace.overview.actionsDescription")}
                    action={<Sparkles size={17} className="text-neutral-500" />}
                  />
                  <div className="mt-5 space-y-2.5">
                    {recommendedActions.map((action, index) => (
                      <div
                        key={`${action}-${index}`}
                        className="flex gap-3 rounded-2xl border border-neutral-900 bg-black/35 p-4"
                      >
                        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-white text-xs font-semibold text-black">
                          {index + 1}
                        </span>
                        <p className="text-sm leading-6 text-neutral-400">
                          {action}
                        </p>
                      </div>
                    ))}
                  </div>
                </article>
              </div>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.08fr)_minmax(360px,0.92fr)]">
                <article className="cf-card p-5">
                  <SectionHeading
                    eyebrow={t("reportsWorkspace.readiness.distributionEyebrow")}
                    title={t("reportsWorkspace.readiness.distributionTitle")}
                    description={t("reportsWorkspace.readiness.distributionDescription")}
                  />
                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    {buckets.map((bucket) => (
                      <DistributionBand
                        key={bucket.label}
                        label={bucket.label}
                        caption={bucket.caption}
                        count={bucket.count}
                        ready={bucket.ready}
                        width={`${Math.max(
                          bucket.count === 0 ? 0 : 5,
                          (bucket.count / maxBucketCount) * 100,
                        )}%`}
                      />
                    ))}
                  </div>
                </article>

                <article className="cf-card p-5">
                  <SectionHeading
                    eyebrow={t("reportsWorkspace.overview.signalsEyebrow")}
                    title={t("reportsWorkspace.overview.signalsTitle")}
                    description={t("reportsWorkspace.overview.signalsDescription")}
                  />
                  <div className="mt-5 grid gap-2.5">
                    <div className="flex items-center justify-between gap-4 rounded-2xl border border-neutral-900 bg-black/35 px-4 py-3">
                      <span className="text-sm text-neutral-500">
                        {t("reportsWorkspace.overview.topStack")}
                      </span>
                      <span className="font-medium text-white">{topStack}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4 rounded-2xl border border-neutral-900 bg-black/35 px-4 py-3">
                      <span className="text-sm text-neutral-500">
                        {t("reportsWorkspace.overview.topTarget")}
                      </span>
                      <span className="font-medium text-white">
                        {topTarget === "—" ? "—" : getAiToolLabel(topTarget)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-4 rounded-2xl border border-neutral-900 bg-black/35 px-4 py-3">
                      <span className="text-sm text-neutral-500">
                        {t("reportsWorkspace.overview.aiRuns")}
                      </span>
                      <span className="font-medium text-white">
                        {assistedCount}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-4 rounded-2xl border border-neutral-900 bg-black/35 px-4 py-3">
                      <span className="text-sm text-neutral-500">
                        {t("reportsWorkspace.overview.templateFallback")}
                      </span>
                      <span className="font-medium text-white">
                        {fallbackCount}
                      </span>
                    </div>
                  </div>
                </article>
              </div>

              <article className="cf-card p-5">
                <SectionHeading
                  eyebrow={t("reportsWorkspace.activity.recentEyebrow")}
                  title={t("reportsWorkspace.activity.recentTitle")}
                  description={t("reportsWorkspace.activity.recentDescription")}
                  action={(
                    <Button variant="secondary" onClick={onOpenTaskPacks}>
                      <Archive size={15} />
                      {t("reportsWorkspace.activity.openArchive")}
                    </Button>
                  )}
                />
                {recentTaskPacks.length === 0 ? (
                  <div className="mt-5">
                    <EmptyState
                      icon={<WandSparkles size={18} />}
                      title={t("reportsWorkspace.activity.emptyTitle")}
                      description={t("reportsWorkspace.activity.emptyDescription")}
                    />
                  </div>
                ) : (
                  <div className="mt-5 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
                    {recentTaskPacks.slice(0, 3).map((taskPack) => (
                      <TaskPackActivityItem
                        key={taskPack.id}
                        taskPack={taskPack}
                        onOpen={onOpenTaskPack}
                        locale={locale}
                        t={t}
                      />
                    ))}
                  </div>
                )}
              </article>

              <article className="cf-card p-5">
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
                  <div className="flex items-start gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-400">
                      <Download size={17} />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-white">
                        {t("reportsWorkspace.export.title")}
                      </p>
                      <p className="mt-1 max-w-3xl text-sm leading-6 text-neutral-500">
                        {t("reportsWorkspace.export.description")}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => handleExportReport("md")}
                    >
                      <FileText size={14} />
                      {t("reportsWorkspace.export.markdown")}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => handleExportReport("txt")}
                    >
                      <Download size={14} />
                      {t("reportsWorkspace.export.text")}
                    </Button>
                  </div>
                </div>
              </article>
            </div>
          ) : null}

          {activeTab === "readiness" ? (
            <div className="space-y-4">
              <article className="cf-card p-5">
                <SectionHeading
                  eyebrow={t("reportsWorkspace.readiness.mapEyebrow")}
                  title={t("reportsWorkspace.readiness.mapTitle")}
                  description={t("reportsWorkspace.readiness.mapDescription")}
                  action={(
                    <Button variant="secondary" onClick={onOpenProjects}>
                      <FolderOpen size={15} />
                      {t("reportsWorkspace.actions.openProjects")}
                    </Button>
                  )}
                />
                <div className="mt-5 max-w-[650px]">
                  <HorizontalSlidingSelector
                    items={lensOptions}
                    activeIndex={lensOptions.findIndex(
                      (option) => option.id === projectLens,
                    )}
                    getItemKey={(option) => option.id}
                    onSelect={(option) => setProjectLens(option.id)}
                    ariaLabel={t("reportsWorkspace.readiness.lensAria")}
                    itemClassName="h-[52px] px-3"
                    renderItem={(option, isActive) => (
                      <span className="flex h-full flex-col items-start justify-center text-left">
                        <span className="block truncate text-xs font-semibold">
                          {option.label}
                        </span>
                        <span
                          className={[
                            "mt-0.5 block truncate text-[10px]",
                            isActive ? "text-black/50" : "text-neutral-700",
                          ].join(" ")}
                        >
                          {option.caption}
                        </span>
                      </span>
                    )}
                  />
                </div>

                {projects.length === 0 ? (
                  <div className="mt-5">
                    <EmptyState
                      icon={<FolderOpen size={18} />}
                      title={t("reportsWorkspace.readiness.noProjectsTitle")}
                      description={t(
                        "reportsWorkspace.readiness.noProjectsDescription",
                      )}
                      action={(
                        <Button variant="primary" onClick={onOpenProjects}>
                          <FolderOpen size={15} />
                          {t("reportsWorkspace.readiness.addProject")}
                        </Button>
                      )}
                    />
                  </div>
                ) : filteredProjects.length === 0 ? (
                  <div className="mt-5">
                    <EmptyState
                      icon={<CheckCircle2 size={18} />}
                      title={t("reportsWorkspace.readiness.emptyLensTitle")}
                      description={t(
                        "reportsWorkspace.readiness.emptyLensDescription",
                      )}
                    />
                  </div>
                ) : (
                  <div className="mt-5 grid gap-3 lg:grid-cols-2">
                    {filteredProjects.map((project) => (
                      <ProjectReportCard
                        key={project.id}
                        project={project}
                        onOpen={onOpenProjects}
                        t={t}
                      />
                    ))}
                  </div>
                )}
              </article>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.82fr)]">
                <article className="cf-card p-5">
                  <SectionHeading
                    eyebrow={t("reportsWorkspace.readiness.issuesEyebrow")}
                    title={t("reportsWorkspace.readiness.issuesTitle")}
                    description={t("reportsWorkspace.readiness.issuesDescription")}
                    action={(
                      <span className="cf-badge">
                        {t("reportsWorkspace.readiness.signalCount", {
                          signalCount: topIssues.length,
                        })}
                      </span>
                    )}
                  />
                  {topIssues.length === 0 ? (
                    <div className="mt-5">
                      <EmptyState
                        icon={<ShieldCheck size={18} />}
                        title={t("reportsWorkspace.readiness.noIssuesTitle")}
                        description={t(
                          "reportsWorkspace.readiness.noIssuesDescription",
                        )}
                      />
                    </div>
                  ) : (
                    <div className="mt-5 grid gap-3 lg:grid-cols-2">
                      {topIssues.map((issue) => (
                        <CountBar
                          key={issue.key}
                          signal={issue}
                          max={topIssues[0]?.count ?? 1}
                          icon={<CircleDot size={14} />}
                        />
                      ))}
                    </div>
                  )}
                </article>

                <article className="cf-card p-5">
                  <SectionHeading
                    eyebrow={t("reportsWorkspace.readiness.distributionEyebrow")}
                    title={t("reportsWorkspace.readiness.distributionTitle")}
                    description={t("reportsWorkspace.readiness.distributionDescription")}
                  />
                  <div className="mt-5 grid gap-3">
                    {buckets.map((bucket) => (
                      <DistributionBand
                        key={bucket.label}
                        label={bucket.label}
                        caption={bucket.caption}
                        count={bucket.count}
                        ready={bucket.ready}
                        width={`${Math.max(
                          bucket.count === 0 ? 0 : 5,
                          (bucket.count / maxBucketCount) * 100,
                        )}%`}
                      />
                    ))}
                  </div>
                </article>
              </div>
            </div>
          ) : null}

          {activeTab === "activity" ? (
            <div className="space-y-4">
              <article className="cf-card p-5">
                <SectionHeading
                  eyebrow={t("reportsWorkspace.activity.recentEyebrow")}
                  title={t("reportsWorkspace.activity.recentTitle")}
                  description={t("reportsWorkspace.activity.recentDescription")}
                  action={(
                    <Button variant="secondary" onClick={onOpenTaskPacks}>
                      <Archive size={15} />
                      {t("reportsWorkspace.activity.openArchive")}
                    </Button>
                  )}
                />
                {recentTaskPacks.length === 0 ? (
                  <div className="mt-5">
                    <EmptyState
                      icon={<WandSparkles size={18} />}
                      title={t("reportsWorkspace.activity.emptyTitle")}
                      description={t("reportsWorkspace.activity.emptyDescription")}
                      action={(
                        <Button variant="primary" onClick={onOpenProjects}>
                          <FolderOpen size={15} />
                          {t("reportsWorkspace.activity.pickProject")}
                        </Button>
                      )}
                    />
                  </div>
                ) : (
                  <div className="mt-5 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
                    {recentTaskPacks.map((taskPack) => (
                      <TaskPackActivityItem
                        key={taskPack.id}
                        taskPack={taskPack}
                        onOpen={onOpenTaskPack}
                        locale={locale}
                        t={t}
                      />
                    ))}
                  </div>
                )}
              </article>

              <div className="grid items-start gap-4 xl:grid-cols-2">
                <article className="cf-card p-5">
                  <SectionHeading
                    eyebrow={t("reportsWorkspace.activity.targetsEyebrow")}
                    title={t("reportsWorkspace.activity.targetsTitle")}
                  />
                  {targetSignals.length === 0 ? (
                    <p className="mt-5 rounded-2xl border border-neutral-900 bg-black/35 p-4 text-sm text-neutral-500">
                      {t("reportsWorkspace.activity.noTargets")}
                    </p>
                  ) : (
                    <div className="mt-5 space-y-3">
                      {targetSignals.map((signal) => (
                        <CountBar
                          key={signal.key}
                          signal={signal}
                          max={targetSignals[0]?.count ?? 1}
                          icon={<AiToolLogo tool={signal.key} size="sm" />}
                          compact
                        />
                      ))}
                    </div>
                  )}
                </article>

                <article className="cf-card p-5">
                  <SectionHeading
                    eyebrow={t("reportsWorkspace.activity.typesEyebrow")}
                    title={t("reportsWorkspace.activity.typesTitle")}
                  />
                  {taskTypeSignals.length === 0 ? (
                    <p className="mt-5 rounded-2xl border border-neutral-900 bg-black/35 p-4 text-sm text-neutral-500">
                      {t("reportsWorkspace.activity.noTypes")}
                    </p>
                  ) : (
                    <div className="mt-5 space-y-3">
                      {taskTypeSignals.map((signal) => (
                        <CountBar
                          key={signal.key}
                          signal={signal}
                          max={taskTypeSignals[0]?.count ?? 1}
                          icon={<ListChecks size={14} />}
                          compact
                        />
                      ))}
                    </div>
                  )}
                </article>

                <article className="cf-card p-5 xl:col-span-2">
                  <SectionHeading
                    eyebrow={t("reportsWorkspace.activity.modesEyebrow")}
                    title={t("reportsWorkspace.activity.modesTitle")}
                    description={t("reportsWorkspace.activity.modesDescription")}
                  />
                  <div className="mt-5 grid gap-3 md:grid-cols-3">
                    <CompactMetric
                      icon={<Bot size={16} />}
                      label={t("reportsWorkspace.taskPackMode.assisted")}
                      value={assistedCount}
                      caption={t("reportsWorkspace.activity.assistedCaption")}
                    />
                    <CompactMetric
                      icon={<RefreshCw size={16} />}
                      label={t("reportsWorkspace.taskPackMode.fallback")}
                      value={fallbackCount}
                      caption={t("reportsWorkspace.activity.fallbackCaption")}
                    />
                    <CompactMetric
                      icon={<Layers3 size={16} />}
                      label={t("reportsWorkspace.taskPackMode.template")}
                      value={templateCount}
                      caption={t("reportsWorkspace.activity.templateCaption")}
                    />
                  </div>
                </article>
              </div>

              <article className="cf-card p-5">
                <div className="grid gap-4 xl:grid-cols-3">
                  <div className="rounded-[1.35rem] border border-neutral-900 bg-black/35 p-5">
                    <RefreshCw size={18} className="mb-4 text-neutral-500" />
                    <p className="text-sm font-semibold text-white">
                      {t("reportsWorkspace.activity.refreshTitle")}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-neutral-500">
                      {t("reportsWorkspace.activity.refreshDescription")}
                    </p>
                  </div>
                  <div className="rounded-[1.35rem] border border-neutral-900 bg-black/35 p-5">
                    <Layers3 size={18} className="mb-4 text-neutral-500" />
                    <p className="text-sm font-semibold text-white">
                      {t("reportsWorkspace.activity.localTitle")}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-neutral-500">
                      {t("reportsWorkspace.activity.localDescription")}
                    </p>
                  </div>
                  <div className="rounded-[1.35rem] border border-neutral-900 bg-black/35 p-5">
                    <Clock3 size={18} className="mb-4 text-neutral-500" />
                    <p className="text-sm font-semibold text-white">
                      {t("reportsWorkspace.export.title")}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-neutral-500">
                      {t("reportsWorkspace.export.description")}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        onClick={() => handleExportReport("md")}
                      >
                        <FileText size={14} />
                        .md
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => handleExportReport("txt")}
                      >
                        <Download size={14} />
                        .txt
                      </Button>
                    </div>
                  </div>
                </div>
              </article>
            </div>
          ) : null}

          {activeTab === "validation" ? (
            <ValidationLab projects={projects} />
          ) : null}
        </motion.div>
      </AnimatePresence>

      <AnimatePresence>
        {exportStatusMessage ? (
          <motion.div
            className="fixed right-6 top-14 z-[120] flex max-w-[420px] items-center gap-3 rounded-2xl border border-emerald-400/20 bg-black/95 px-4 py-3 text-sm text-neutral-200 shadow-[0_20px_70px_rgba(0,0,0,0.62)] backdrop-blur-xl"
            initial={{ opacity: 0, y: -10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={CONTENT_TRANSITION}
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-300">
              <CheckCircle2 size={16} />
            </span>
            <span>{exportStatusMessage}</span>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}
