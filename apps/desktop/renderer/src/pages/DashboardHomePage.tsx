import { type ReactNode, useMemo } from "react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Archive,
  ArrowRight,
  CheckCircle2,
  Clipboard,
  Clock3,
  FolderOpen,
  Gauge,
  RefreshCw,
  Settings2,
  Sparkles,
  WandSparkles,
  Zap
} from "lucide-react";

import { Button } from "../components/ui/Button";
import type { Project, TaskPack } from "../types";

interface DashboardHomePageProps {
  projects: Project[];
  taskPacks: TaskPack[];
  readinessScore: number | null;
  statusMessage: string;
  isLoading: boolean;
  onAddProject: () => void;
  onOpenProjects: () => void;
  onOpenContextBuilder: () => void;
  onOpenTaskPacks: () => void;
  onOpenSettings: () => void;
  onRescanProject: (project: Project) => void | Promise<void>;
  onGenerateAgents: (project: Project) => void | Promise<void>;
  onCreateTaskPack: (project: Project) => void | Promise<void>;
  onOpenTaskPack: (taskPack: TaskPack) => void;
}

const CARD_TRANSITION = {
  duration: 0.18,
  ease: [0.16, 1, 0.3, 1]
} as const;

type BreakdownItem = {
  label: string;
  value: number;
};

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function formatRelativeTime(
  value: string | null | undefined,
  t: (key: string, options?: Record<string, unknown>) => string
) {
  if (!value) {
    return t("time.never");
  }

  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();

  if (!Number.isFinite(diffMs) || diffMs < 0) {
    return t("time.justNow");
  }

  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) {
    return t("time.justNow");
  }

  if (diffMs < hour) {
    return t("time.minutesAgo", { count: Math.round(diffMs / minute) });
  }

  if (diffMs < day) {
    return t("time.hoursAgo", { count: Math.round(diffMs / hour) });
  }

  return t("time.daysAgo", { count: Math.round(diffMs / day) });
}

function getLatestScanLabel(
  projects: Project[],
  t: (key: string, options?: Record<string, unknown>) => string
) {
  const latestScan = projects
    .map((project) => project.lastScanAt)
    .filter(Boolean)
    .sort((a, b) => new Date(b as string).getTime() - new Date(a as string).getTime())[0];

  return formatRelativeTime(latestScan, t);
}

function getProjectIssues(
  project: Project,
  t: (key: string, options?: Record<string, unknown>) => string
) {
  const reportIssues = project.readinessReport?.issues ?? [];
  const failedChecks =
    project.readinessReport?.checks
      ?.filter((check) => !check.passed)
      .map((check) => check.message || check.label)
      .filter(Boolean) ?? [];

  const issues = [...reportIssues, ...failedChecks];

  if (issues.length > 0) {
    return Array.from(new Set(issues)).slice(0, 3);
  }

  if (project.readinessScore < 50) {
    return [t("dashboard.projectContextNeedsAttention")];
  }

  if (!project.scripts?.test) {
    return [t("dashboard.noTestScriptDetected")];
  }

  return [t("dashboard.readyForAiWorkflow")];
}

function hasIssue(project: Project, keywords: string[]) {
  const text = [
    ...(project.readinessReport?.issues ?? []),
    ...(project.readinessReport?.checks?.map((check) => `${check.key} ${check.label} ${check.message}`) ?? [])
  ]
    .join(" ")
    .toLowerCase();

  return keywords.some((keyword) => text.includes(keyword.toLowerCase()));
}

function isStaleProject(project: Project) {
  if (!project.lastScanAt) {
    return true;
  }

  const scanDate = new Date(project.lastScanAt).getTime();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;

  return Date.now() - scanDate > sevenDays;
}

function getAttentionProjects(projects: Project[]) {
  return [...projects]
    .filter((project) => {
      return (
        project.readinessScore < 60 ||
        isStaleProject(project) ||
        (project.readinessReport?.issues?.length ?? 0) > 0
      );
    })
    .sort((a, b) => {
      const scoreDiff = a.readinessScore - b.readinessScore;

      if (scoreDiff !== 0) {
        return scoreDiff;
      }

      return new Date(a.lastScanAt ?? 0).getTime() - new Date(b.lastScanAt ?? 0).getTime();
    })
    .slice(0, 5);
}

function getProjectAction(project: Project): "buildContext" | "scan" | "createPack" {
  if (hasIssue(project, ["agents", "agents.md", "instructions"])) {
    return "buildContext";
  }

  if (isStaleProject(project)) {
    return "scan";
  }

  if (project.readinessScore < 60) {
    return "buildContext";
  }

  return "createPack";
}

function getRecentTaskPacks(taskPacks: TaskPack[]) {
  return [...taskPacks]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 4);
}

function getCategoryScore(
  projects: Project[],
  matcher: (project: Project) => boolean
) {
  if (projects.length === 0) {
    return 0;
  }

  const passed = projects.filter(matcher).length;
  return clampScore((passed / projects.length) * 100);
}

function getCheckCategoryScore(
  projects: Project[],
  keywords: string[],
  fallback: (project: Project) => boolean
) {
  const matchingChecks = projects.flatMap((project) => {
    return (
      project.readinessReport?.checks?.filter((check) => {
        const text = `${check.key} ${check.label} ${check.message}`.toLowerCase();
        return keywords.some((keyword) => text.includes(keyword.toLowerCase()));
      }) ?? []
    );
  });

  if (matchingChecks.length > 0) {
    const passed = matchingChecks.filter((check) => check.passed).length;
    return clampScore((passed / matchingChecks.length) * 100);
  }

  return getCategoryScore(projects, fallback);
}

function getReadinessBreakdown(projects: Project[]): BreakdownItem[] {
  return [
    {
      label: "Docs",
      value: getCheckCategoryScore(
        projects,
        ["readme", "docs", "documentation", "architecture"],
        (project) => !hasIssue(project, ["readme", "docs", "architecture"])
      )
    },
    {
      label: "Scripts",
      value: getCheckCategoryScore(
        projects,
        ["script", "build", "dev", "command"],
        (project) => Boolean(project.scripts?.build || project.scripts?.dev)
      )
    },
    {
      label: "Tests",
      value: getCheckCategoryScore(
        projects,
        ["test"],
        (project) => Boolean(project.scripts?.test)
      )
    },
    {
      label: "Env example",
      value: getCheckCategoryScore(
        projects,
        ["env", "environment"],
        (project) => !hasIssue(project, [".env", "env example", "environment"])
      )
    },
    {
      label: "AGENTS.md",
      value: getCheckCategoryScore(
        projects,
        ["agents", "instructions"],
        (project) => !hasIssue(project, ["agents.md", "agents", "ai instructions"])
      )
    },
    {
      label: "Inventory",
      value: getCategoryScore(
        projects,
        (project) =>
          project.detectedStack.length > 0 &&
          Boolean(project.packageManager) &&
          Boolean(project.localPath)
      )
    }
  ];
}

function SmallMetric({
  label,
  value,
  caption
}: {
  label: string;
  value: string | number;
  caption: string;
}) {
  return (
    <div className="rounded-2xl border border-neutral-900 bg-black/35 px-4 py-3">
      <p className="cf-tech-label text-[10px] uppercase text-neutral-700">
        {label}
      </p>

      <p className="mt-1 text-[26px] font-semibold leading-none tracking-[-0.05em] text-white">
        {value}
      </p>

      <p className="mt-1 truncate text-xs text-neutral-600">
        {caption}
      </p>
    </div>
  );
}

function SectionCard({
  title,
  caption,
  action,
  children
}: {
  title: string;
  caption?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[1.35rem] border border-neutral-900 bg-black/35 p-4">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-[-0.025em] text-white">
            {title}
          </h2>

          {caption && (
            <p className="mt-1 text-xs leading-5 text-neutral-600">
              {caption}
            </p>
          )}
        </div>

        {action}
      </div>

      {children}
    </section>
  );
}

function CompactButton({
  children,
  onClick,
  disabled
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-8 shrink-0 items-center justify-center rounded-full border border-neutral-800 bg-neutral-950 px-3 text-xs font-medium text-neutral-300 transition hover:border-white hover:bg-white hover:text-black disabled:pointer-events-none disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function AttentionProjectRow({
  project,
  isLoading,
  onOpenContextBuilder,
  onRescanProject,
  onCreateTaskPack
}: {
  project: Project;
  isLoading: boolean;
  onOpenContextBuilder: () => void;
  onRescanProject: (project: Project) => void | Promise<void>;
  onCreateTaskPack: (project: Project) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const issues = getProjectIssues(project, t);
  const action = getProjectAction(project);
  const actionLabel =
    action === "scan"
      ? t("dashboard.scan")
      : action === "createPack"
        ? t("dashboard.createPack")
        : t("dashboard.buildContext");

  function handleAction() {
    if (action === "scan") {
      void onRescanProject(project);
      return;
    }

    if (action === "createPack") {
      void onCreateTaskPack(project);
      return;
    }

    onOpenContextBuilder();
  }

  return (
    <motion.div
      whileHover={{ y: -1 }}
      transition={CARD_TRANSITION}
      className="grid gap-3 rounded-2xl border border-neutral-900 bg-black/35 px-4 py-3 transition hover:border-white/15 hover:bg-white/[0.035] md:grid-cols-[minmax(0,1.1fr)_86px_minmax(0,1.35fr)_auto]"
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-white">
          {project.name}
        </p>

        <p className="mt-1 truncate text-xs text-neutral-700">
          {t("dashboard.lastScanPrefix", {
            time: formatRelativeTime(project.lastScanAt, t)
          })}
        </p>
      </div>

      <div>
        <p className="text-sm font-semibold text-white">
          {project.readinessScore}/100
        </p>

        <div className="mt-2 h-1 overflow-hidden rounded-full bg-neutral-900">
          <div
            className="h-full rounded-full bg-white"
            style={{ width: `${Math.max(4, project.readinessScore)}%` }}
          />
        </div>
      </div>

      <p className="line-clamp-2 text-xs leading-5 text-neutral-500">
        {issues.join(", ")}
      </p>

      <CompactButton
        onClick={handleAction}
        disabled={isLoading}
      >
        {actionLabel}
      </CompactButton>
    </motion.div>
  );
}

function BreakdownRow({ item }: { item: BreakdownItem }) {
  return (
    <div className="grid grid-cols-[92px_minmax(0,1fr)_44px] items-center gap-3">
      <p className="truncate text-xs text-neutral-500">
        {item.label}
      </p>

      <div className="h-2 overflow-hidden rounded-full border border-neutral-900 bg-black">
        <motion.div
          initial={false}
          animate={{ width: `${Math.max(4, item.value)}%` }}
          transition={{
            type: "spring",
            stiffness: 360,
            damping: 34,
            mass: 0.7
          }}
          className="h-full rounded-full bg-white shadow-[0_0_18px_rgba(255,255,255,0.35)]"
        />
      </div>

      <p className="text-right text-xs font-medium text-neutral-400">
        {item.value}%
      </p>
    </div>
  );
}

function RecentTaskPackRow({
  taskPack,
  onOpenTaskPack
}: {
  taskPack: TaskPack;
  onOpenTaskPack: (taskPack: TaskPack) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="grid gap-3 rounded-2xl border border-neutral-900 bg-black/35 px-4 py-3 transition hover:border-white/15 hover:bg-white/[0.035] md:grid-cols-[minmax(0,1fr)_180px_86px_auto]">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-white">
          {taskPack.title}
        </p>

        <p className="mt-1 line-clamp-1 text-xs text-neutral-600">
          {taskPack.rawTask}
        </p>
      </div>

      <p className="truncate text-xs text-neutral-500">
        {taskPack.projectName ?? `Project #${taskPack.projectId}`}
      </p>

      <p className="text-xs text-neutral-600">
        {formatRelativeTime(taskPack.createdAt, t)}
      </p>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => void navigator.clipboard.writeText(taskPack.generatedPrompt)}
          className="grid size-8 place-items-center rounded-full border border-neutral-800 bg-neutral-950 text-neutral-400 transition hover:border-white hover:bg-white hover:text-black"
          title={t("dashboard.copyPrompt")}
        >
          <Clipboard size={14} />
        </button>

        <button
          type="button"
          onClick={() => onOpenTaskPack(taskPack)}
          className="grid size-8 place-items-center rounded-full border border-neutral-800 bg-neutral-950 text-neutral-400 transition hover:border-white hover:bg-white hover:text-black"
          title={t("dashboard.openTaskPack")}
        >
          <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}

function QuickAction({
  icon,
  title,
  caption,
  onClick,
  disabled
}: {
  icon: ReactNode;
  title: string;
  caption: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group flex w-full items-center gap-3 rounded-2xl border border-neutral-900 bg-black/35 p-3 text-left transition hover:border-white hover:bg-white hover:text-black disabled:pointer-events-none disabled:opacity-50"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-300 transition group-hover:border-black/10 group-hover:bg-black/5 group-hover:text-black">
        {icon}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-white transition group-hover:text-black">
          {title}
        </span>

        <span className="mt-0.5 block truncate text-xs text-neutral-600 transition group-hover:text-black/55">
          {caption}
        </span>
      </span>

      <ArrowRight
        size={14}
        className="shrink-0 text-neutral-700 transition group-hover:translate-x-0.5 group-hover:text-black"
      />
    </button>
  );
}

function EmptyDashboard({
  isLoading,
  onAddProject,
  onOpenSettings
}: {
  isLoading: boolean;
  onAddProject: () => void;
  onOpenSettings: () => void;
}) {
  const { t } = useTranslation();

  return (
    <section className="grid min-h-[calc(100vh-112px)] place-items-center">
      <div className="w-full max-w-3xl rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_26rem),linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.012))] p-7 text-center shadow-[0_18px_60px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.05)]">
        <div className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl border border-white/10 bg-black/45 text-white">
          <FolderOpen size={24} />
        </div>

        <div className="mb-4 flex justify-center gap-2">
          <span className="cf-badge">
            <Sparkles size={12} />
            {t("common.localFirst")}
          </span>
          <span className="cf-badge">{t("common.noCloudRequired")}</span>
        </div>

        <h1 className="text-[38px] font-semibold leading-[1.02] tracking-[-0.06em] text-white">
          {t("dashboard.emptyTitle")}
        </h1>

        <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-neutral-500">
          {t("dashboard.emptyDescription")}
        </p>

        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button
            variant="primary"
            onClick={onAddProject}
            disabled={isLoading}
          >
            <FolderOpen size={15} />
            {t("common.addProject")}
          </Button>

          <Button
            variant="secondary"
            onClick={onOpenSettings}
          >
            <Settings2 size={15} />
            {t("common.configureWorkspace")}
          </Button>
        </div>
      </div>
    </section>
  );
}

export function DashboardHomePage({
  projects,
  taskPacks,
  readinessScore,
  statusMessage,
  isLoading,
  onAddProject,
  onOpenProjects,
  onOpenContextBuilder,
  onOpenTaskPacks,
  onOpenSettings,
  onRescanProject,
  onGenerateAgents,
  onCreateTaskPack,
  onOpenTaskPack
}: DashboardHomePageProps) {
  const { t } = useTranslation();
  const attentionProjects = useMemo(() => getAttentionProjects(projects), [projects]);
  const recentTaskPacks = useMemo(() => getRecentTaskPacks(taskPacks), [taskPacks]);
  const breakdown = useMemo(() => getReadinessBreakdown(projects), [projects]);

  const projectsCount = projects.length;
  const needAttentionCount = attentionProjects.length;
  const readinessValue = readinessScore === null ? "—" : `${readinessScore}/100`;
  const latestScanLabel = getLatestScanLabel(projects, t);

  const primaryProject = attentionProjects[0] ?? projects[0] ?? null;
  const staleProjects = projects.filter(isStaleProject).slice(0, 5);
  const missingAgentsProject =
    projects.find((project) => hasIssue(project, ["agents", "agents.md"])) ??
    attentionProjects[0] ??
    null;

  async function handleScanStaleProjects() {
    const targets = staleProjects.length > 0 ? staleProjects : attentionProjects;

    for (const project of targets.slice(0, 5)) {
      await onRescanProject(project);
    }
  }

  if (projects.length === 0) {
    return (
      <EmptyDashboard
        isLoading={isLoading}
        onAddProject={onAddProject}
        onOpenSettings={onOpenSettings}
      />
    );
  }

  return (
    <section className="space-y-5">
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={CARD_TRANSITION}
        className="rounded-[1.35rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.01))] p-5 shadow-[0_14px_44px_rgba(0,0,0,0.32),inset_0_1px_0_rgba(255,255,255,0.045)]"
      >
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap gap-2">
              <span className="cf-badge">
                <Gauge size={12} />
                {t("dashboard.workspaceOverview")}
              </span>
              <span className="cf-badge">
                {t("dashboard.lastScan", { time: latestScanLabel })}
              </span>
            </div>

            <h1 className="text-[32px] font-semibold leading-[1.04] tracking-[-0.055em] text-white">
              {t("dashboard.workspaceOverview")}
            </h1>

            <p className="mt-2 text-sm leading-6 text-neutral-500">
              {t("dashboard.summary", {
                count: needAttentionCount,
                plural: needAttentionCount === 1 ? "" : "s",
                readiness: readinessValue,
                taskPacks: taskPacks.length
              })}
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              variant="primary"
              onClick={onAddProject}
              disabled={isLoading}
            >
              <FolderOpen size={15} />
              {t("common.addProject")}
            </Button>

            <Button
              variant="secondary"
              onClick={() => void handleScanStaleProjects()}
              disabled={isLoading || projects.length === 0}
            >
              <RefreshCw size={15} />
              {t("dashboard.scanStaleProjects")}
            </Button>

            <Button
              variant="ghost"
              onClick={onOpenContextBuilder}
              disabled={isLoading}
            >
              <WandSparkles size={15} />
              {t("dashboard.buildContext")}
            </Button>
          </div>
        </div>
      </motion.section>

      <div className="grid gap-3 md:grid-cols-4">
        <SmallMetric
          label={t("dashboard.projects")}
          value={projectsCount}
          caption={t("dashboard.localWorkspaces")}
        />

        <SmallMetric
          label={t("dashboard.needAttention")}
          value={needAttentionCount}
          caption={t("dashboard.contextOrScanIssues")}
        />

        <SmallMetric
          label={t("dashboard.avgReadiness")}
          value={readinessValue}
          caption={t("dashboard.workspaceScore")}
        />

        <SmallMetric
          label={t("dashboard.taskPacks")}
          value={taskPacks.length}
          caption={t("dashboard.generatedPrompts")}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <SectionCard
            title={t("dashboard.projectsNeedingAttention")}
            caption={t("dashboard.priorityCaption")}
            action={
              <CompactButton onClick={onOpenProjects}>
                {t("dashboard.viewAllProjects")}
              </CompactButton>
            }
          >
            {attentionProjects.length === 0 ? (
              <div className="rounded-2xl border border-neutral-900 bg-black/35 p-5">
                <div className="mb-3 flex size-10 items-center justify-center rounded-xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-300">
                  <CheckCircle2 size={17} />
                </div>

                <p className="text-sm font-semibold text-white">
                  {t("dashboard.noUrgentIssues")}
                </p>

                <p className="mt-1 text-sm leading-6 text-neutral-500">
                  {t("dashboard.noUrgentIssuesDesc")}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {attentionProjects.map((project) => (
                  <AttentionProjectRow
                    key={project.id}
                    project={project}
                    isLoading={isLoading}
                    onOpenContextBuilder={onOpenContextBuilder}
                    onRescanProject={onRescanProject}
                    onCreateTaskPack={onCreateTaskPack}
                  />
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard
            title={t("dashboard.recentTaskPacks")}
            caption={t("dashboard.recentTaskPacksCaption")}
            action={
              <CompactButton onClick={onOpenTaskPacks}>
                {t("dashboard.openArchive")}
              </CompactButton>
            }
          >
            {recentTaskPacks.length === 0 ? (
              <div className="rounded-2xl border border-neutral-900 bg-black/35 p-5">
                <div className="mb-3 flex size-10 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-300">
                  <Archive size={17} />
                </div>

                <p className="text-sm font-semibold text-white">
                  {t("dashboard.noTaskPacks")}
                </p>

                <p className="mt-1 text-sm leading-6 text-neutral-500">
                  {t("dashboard.noTaskPacksDesc")}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {recentTaskPacks.map((taskPack) => (
                  <RecentTaskPackRow
                    key={taskPack.id}
                    taskPack={taskPack}
                    onOpenTaskPack={onOpenTaskPack}
                  />
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard
            title={t("dashboard.readinessBreakdown")}
            caption={t("dashboard.readinessBreakdownCaption")}
          >
            <div className="space-y-3">
              {breakdown.map((item) => (
                <BreakdownRow key={item.label} item={item} />
              ))}
            </div>
          </SectionCard>
        </div>

        <aside className="space-y-5">
          <SectionCard
            title={t("dashboard.quickActions")}
            caption={t("dashboard.quickActionsCaption")}
          >
            <div className="space-y-3">
              <QuickAction
                icon={<WandSparkles size={16} />}
                title={t("dashboard.openContextBuilder")}
                caption={t("dashboard.generateAgentsAndContext")}
                onClick={onOpenContextBuilder}
                disabled={isLoading}
              />

              <QuickAction
                icon={<Zap size={16} />}
                title={t("dashboard.generateMissingAgents")}
                caption={
                  missingAgentsProject
                    ? t("dashboard.forProject", { name: missingAgentsProject.name })
                    : t("dashboard.noObviousMissingContext")
                }
                onClick={() => {
                  if (missingAgentsProject) {
                    void onGenerateAgents(missingAgentsProject);
                    return;
                  }

                  onOpenContextBuilder();
                }}
                disabled={isLoading}
              />

              <QuickAction
                icon={<RefreshCw size={16} />}
                title={t("dashboard.scanStaleProjects")}
                caption={t("dashboard.projectsDetected", {
                  count: staleProjects.length,
                  plural: staleProjects.length === 1 ? "" : "s"
                })}
                onClick={() => void handleScanStaleProjects()}
                disabled={isLoading || projects.length === 0}
              />

              <QuickAction
                icon={<Archive size={16} />}
                title={t("dashboard.createTaskPack")}
                caption={
                  primaryProject
                    ? t("dashboard.forProject", { name: primaryProject.name })
                    : t("dashboard.chooseProject")
                }
                onClick={() => {
                  if (primaryProject) {
                    void onCreateTaskPack(primaryProject);
                    return;
                  }

                  onOpenProjects();
                }}
                disabled={isLoading || !primaryProject}
              />

              <QuickAction
                icon={<Settings2 size={16} />}
                title={t("dashboard.configureOllama")}
                caption={t("dashboard.localAiProvider")}
                onClick={onOpenSettings}
                disabled={isLoading}
              />
            </div>
          </SectionCard>

          <SectionCard
            title={t("dashboard.currentActivity")}
            caption={t("dashboard.latestWorkspaceEvent")}
          >
            <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
              <div className="mb-3 flex items-center gap-2">
                <Clock3 size={15} className="text-neutral-500" />
                <p className="text-sm font-semibold text-white">
                  {t("dashboard.lastStatus")}
                </p>
              </div>

              <p className="text-sm leading-6 text-neutral-500">
                {statusMessage || t("dashboard.readyStatus")}
              </p>
            </div>

            <div className="mt-3 rounded-2xl border border-neutral-900 bg-black/35 p-4">
              <div className="mb-3 flex items-center gap-2">
                <AlertTriangle size={15} className="text-neutral-500" />
                <p className="text-sm font-semibold text-white">
                  {t("dashboard.nextPriority")}
                </p>
              </div>

              <p className="text-sm leading-6 text-neutral-500">
                {attentionProjects[0]
                  ? t("dashboard.improveProject", {
                    name: attentionProjects[0].name,
                    issue: getProjectIssues(attentionProjects[0], t)[0]
                  })
                  : t("dashboard.noUrgentDetected")}
              </p>
            </div>
          </SectionCard>

          <SectionCard
            title={t("dashboard.localAi")}
            caption={t("dashboard.optionalAssistantMode")}
          >
            <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
              <div className="mb-3 flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-white shadow-[0_0_12px_rgba(255,255,255,0.8)]" />
                <p className="text-sm font-semibold text-white">
                  {t("dashboard.aiWorkflowReady")}
                </p>
              </div>

              <p className="text-sm leading-6 text-neutral-500">
                {t("dashboard.templateModeWorks")}
              </p>

              <button
                type="button"
                onClick={onOpenSettings}
                className="mt-4 inline-flex h-8 items-center rounded-full border border-neutral-800 bg-neutral-950 px-3 text-xs font-medium text-neutral-300 transition hover:border-white hover:bg-white hover:text-black"
              >
                {t("common.openSettings")}
              </button>
            </div>
          </SectionCard>
        </aside>
      </div>
    </section>
  );
}
