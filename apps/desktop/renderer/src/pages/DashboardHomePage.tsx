import {
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";
import {
  Activity,
  Archive,
  ArrowRight,
  CheckCircle2,
  Clipboard,
  FileText,
  FolderOpen,
  Gauge,
  Settings2,
  Sparkles,
  Zap,
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

type BreakdownItem = {
  label: string;
  value: number;
};

type ProjectAction = "buildContext" | "scan" | "createPack";

const ENTER_TRANSITION = {
  duration: 0.42,
  ease: [0.16, 1, 0.3, 1],
} as const;

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function useAnimatedNumber(value: number, duration = 720) {
  const reduceMotion = useReducedMotion();
  const [displayValue, setDisplayValue] = useState(reduceMotion ? value : 0);
  const previousValueRef = useRef(reduceMotion ? value : 0);

  useEffect(() => {
    if (reduceMotion) {
      previousValueRef.current = value;
      setDisplayValue(value);
      return;
    }

    const from = previousValueRef.current;
    const difference = value - from;
    const startedAt = performance.now();
    let frameId = 0;

    const tick = (timestamp: number) => {
      const elapsed = timestamp - startedAt;
      const progress = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const nextValue = Math.round(from + difference * eased);

      setDisplayValue(nextValue);

      if (progress < 1) {
        frameId = window.requestAnimationFrame(tick);
        return;
      }

      previousValueRef.current = value;
    };

    frameId = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [duration, reduceMotion, value]);

  return displayValue;
}

function formatRelativeTime(
  value: string | null | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
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
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  const latestScan = projects
    .map((project) => project.lastScanAt)
    .filter(Boolean)
    .sort(
      (a, b) =>
        new Date(b as string).getTime() - new Date(a as string).getTime(),
    )[0];

  return formatRelativeTime(latestScan, t);
}

function getProjectIssues(
  project: Project,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  const reportIssues = project.readinessReport?.issues ?? [];
  const failedChecks =
    project.readinessReport?.checks
      ?.filter((check) => !check.passed)
      .map((check) => check.message || check.label)
      .filter(Boolean) ?? [];

  const issues = Array.from(new Set([...reportIssues, ...failedChecks]));

  if (issues.length > 0) {
    return issues.slice(0, 3);
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
    ...(project.readinessReport?.checks?.map(
      (check) => `${check.key} ${check.label} ${check.message}`,
    ) ?? []),
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
    .filter(
      (project) =>
        project.readinessScore < 60 ||
        isStaleProject(project) ||
        (project.readinessReport?.issues?.length ?? 0) > 0,
    )
    .sort((a, b) => {
      const scoreDiff = a.readinessScore - b.readinessScore;

      if (scoreDiff !== 0) {
        return scoreDiff;
      }

      return (
        new Date(a.lastScanAt ?? 0).getTime() -
        new Date(b.lastScanAt ?? 0).getTime()
      );
    });
}

function getProjectAction(project: Project): ProjectAction {
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
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
    .slice(0, 3);
}

function getPrimaryProject(
  projects: Project[],
  taskPacks: TaskPack[],
  attentionProjects: Project[],
) {
  const latestTaskPack = getRecentTaskPacks(taskPacks)[0];
  const latestTaskPackProject = latestTaskPack
    ? projects.find((project) => project.id === latestTaskPack.projectId)
    : null;

  return (
    attentionProjects[0] ??
    latestTaskPackProject ??
    [...projects].sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )[0] ??
    null
  );
}

function getCategoryScore(
  projects: Project[],
  matcher: (project: Project) => boolean,
) {
  if (projects.length === 0) {
    return 0;
  }

  return clampScore(
    (projects.filter(matcher).length / projects.length) * 100,
  );
}

function getCheckCategoryScore(
  projects: Project[],
  keywords: string[],
  fallback: (project: Project) => boolean,
) {
  const matchingChecks = projects.flatMap(
    (project) =>
      project.readinessReport?.checks?.filter((check) => {
        const text = `${check.key} ${check.label} ${check.message}`.toLowerCase();
        return keywords.some((keyword) =>
          text.includes(keyword.toLowerCase()),
        );
      }) ?? [],
  );

  if (matchingChecks.length > 0) {
    return clampScore(
      (matchingChecks.filter((check) => check.passed).length /
        matchingChecks.length) *
        100,
    );
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
        (project) => !hasIssue(project, ["readme", "docs", "architecture"]),
      ),
    },
    {
      label: "Scripts",
      value: getCheckCategoryScore(
        projects,
        ["script", "build", "dev", "command"],
        (project) => Boolean(project.scripts?.build || project.scripts?.dev),
      ),
    },
    {
      label: "Tests",
      value: getCheckCategoryScore(
        projects,
        ["test"],
        (project) => Boolean(project.scripts?.test),
      ),
    },
    {
      label: "Env example",
      value: getCheckCategoryScore(
        projects,
        ["env", "environment"],
        (project) =>
          !hasIssue(project, [".env", "env example", "environment"]),
      ),
    },
    {
      label: "AGENTS.md",
      value: getCheckCategoryScore(
        projects,
        ["agents", "instructions"],
        (project) =>
          !hasIssue(project, ["agents.md", "agents", "ai instructions"]),
      ),
    },
    {
      label: "Inventory",
      value: getCategoryScore(
        projects,
        (project) =>
          project.detectedStack.length > 0 &&
          Boolean(project.packageManager) &&
          Boolean(project.localPath),
      ),
    },
  ];
}

function DashboardCard({
  title,
  caption,
  action,
  children,
  className = "",
  delay = 0,
}: {
  title: string;
  caption?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...ENTER_TRANSITION, delay }}
      className={`flex flex-col rounded-[1.4rem] border border-white/[0.075] bg-white/[0.018] p-4 ${className}`}
    >
      <div className="mb-4 flex shrink-0 items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-[-0.025em] text-white">
            {title}
          </h2>
          {caption ? (
            <p className="mt-1 text-xs leading-5 text-neutral-600">
              {caption}
            </p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </motion.section>
  );
}

function CompactButton({
  children,
  onClick,
  disabled,
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
      className="inline-flex h-8 shrink-0 items-center justify-center rounded-full border border-neutral-800 bg-neutral-950 px-3 text-xs font-medium text-neutral-300 transition-colors hover:border-white hover:bg-white hover:text-black disabled:pointer-events-none disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function AnimatedMetric({
  label,
  value,
  caption,
  delay = 0,
}: {
  label: string;
  value: number;
  caption: string;
  delay?: number;
}) {
  const animatedValue = useAnimatedNumber(value);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...ENTER_TRANSITION, delay }}
      className="rounded-2xl border border-white/[0.065] bg-white/[0.015] px-4 py-3"
    >
      <p className="cf-tech-label text-[10px] uppercase text-neutral-700">
        {label}
      </p>
      <p className="mt-1 text-[27px] font-semibold leading-none tracking-[-0.05em] text-white">
        {animatedValue}
      </p>
      <p className="mt-1 truncate text-xs text-neutral-600">{caption}</p>
    </motion.div>
  );
}

function UtilityActionButton({
  icon,
  title,
  caption,
  onClick,
  disabled,
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
      className="flex min-h-[58px] items-center gap-3 rounded-[0.95rem] border border-white/[0.065] bg-black/35 px-3.5 py-2.5 text-left transition-colors hover:border-white/20 hover:bg-white/[0.03] disabled:pointer-events-none disabled:opacity-50"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-neutral-800 bg-neutral-950 text-neutral-300">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-white">
          {title}
        </span>
        <span className="mt-0.5 block truncate text-xs text-neutral-600">
          {caption}
        </span>
      </span>
      <ArrowRight className="ml-auto shrink-0 text-neutral-700" size={14} />
    </button>
  );
}

function ReadinessProgress({
  score,
  label,
  status,
}: {
  score: number;
  label: string;
  status: string;
}) {
  const animatedScore = useAnimatedNumber(score, 900);

  return (
    <div className="min-w-0">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
            {label}
          </p>
          <p className="mt-1 text-[36px] font-semibold leading-none tracking-[-0.065em] text-white">
            {animatedScore}
            <span className="ml-1 text-base tracking-normal text-neutral-600">
              /100
            </span>
          </p>
        </div>
        <p className="pb-1 text-xs text-neutral-600">
          {status}
        </p>
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full border border-white/[0.065] bg-black">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${Math.max(2, score)}%` }}
          transition={{
            type: "spring",
            stiffness: 110,
            damping: 24,
            mass: 0.85,
          }}
          className="h-full rounded-full bg-neutral-300 shadow-[0_0_14px_rgba(255,255,255,0.16)]"
        />
      </div>
    </div>
  );
}

function getActionLabel(
  action: ProjectAction,
  t: (key: string) => string,
) {
  if (action === "scan") {
    return t("dashboard.scan");
  }

  if (action === "createPack") {
    return t("dashboard.createPack");
  }

  return t("dashboard.buildContext");
}

function EmptyDashboard({
  isLoading,
  onAddProject,
  onOpenSettings,
}: {
  isLoading: boolean;
  onAddProject: () => void;
  onOpenSettings: () => void;
}) {
  const { t } = useTranslation();

  return (
    <section className="grid min-h-[calc(100vh-112px)] place-items-center">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={ENTER_TRANSITION}
        className="w-full max-w-3xl rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_26rem),linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.012))] p-7 text-center shadow-[0_18px_60px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.05)]"
      >
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
          <Button variant="primary" onClick={onAddProject} disabled={isLoading}>
            <FolderOpen size={15} />
            {t("common.addProject")}
          </Button>
          <Button variant="secondary" onClick={onOpenSettings}>
            <Settings2 size={15} />
            {t("common.configureWorkspace")}
          </Button>
        </div>
      </motion.div>
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
  onOpenTaskPack,
}: DashboardHomePageProps) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const attentionProjects = useMemo(
    () => getAttentionProjects(projects),
    [projects],
  );
  const recentTaskPacks = useMemo(
    () => getRecentTaskPacks(taskPacks),
    [taskPacks],
  );
  const breakdown = useMemo(
    () => getReadinessBreakdown(projects),
    [projects],
  );
  const primaryProject = useMemo(
    () => getPrimaryProject(projects, taskPacks, attentionProjects),
    [attentionProjects, projects, taskPacks],
  );
  const otherAttentionProjects = useMemo(
    () =>
      attentionProjects
        .filter((project) => project.id !== primaryProject?.id)
        .slice(0, 3),
    [attentionProjects, primaryProject?.id],
  );
  const readyProjectsCount = useMemo(
    () => projects.filter((project) => project.readinessScore >= 80).length,
    [projects],
  );

  const readinessValue = clampScore(readinessScore ?? 0);
  const latestScanLabel = getLatestScanLabel(projects, t);
  const missingAgentsProject =
    projects.find((project) => hasIssue(project, ["agents", "agents.md"])) ??
    attentionProjects[0] ??
    null;

  function runProjectAction(project: Project) {
    const action = getProjectAction(project);

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

  if (projects.length === 0) {
    return (
      <EmptyDashboard
        isLoading={isLoading}
        onAddProject={onAddProject}
        onOpenSettings={onOpenSettings}
      />
    );
  }

  const primaryAction = primaryProject
    ? getProjectAction(primaryProject)
    : "buildContext";
  const primaryIssue = primaryProject
    ? getProjectIssues(primaryProject, t)[0]
    : t("dashboard.noUrgentDetected");
  const motionDelay = (value: number) => (reduceMotion ? 0 : value);

  return (
    <section className="space-y-5 pb-2">
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...ENTER_TRANSITION, delay: motionDelay(0.02) }}
        className="relative overflow-hidden rounded-[1.55rem] border border-white/[0.09] bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.012))] p-5 shadow-[0_14px_44px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.04)]"
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_86%_20%,rgba(255,255,255,0.055),transparent_24rem)]" />
        <div className="relative grid gap-7 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-center">
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

            <h1 className="text-[34px] font-semibold leading-[1.02] tracking-[-0.06em] text-white">
              {t("dashboard.workspaceOverview")}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">
              {t("dashboard.commandCenterDescription")}
            </p>

          </div>

          <ReadinessProgress
            score={readinessValue}
            label={t("dashboard.avgReadiness")}
            status={
              readinessValue >= 80
                ? t("contextBuilder.readyForAgents")
                : readinessValue >= 60
                  ? t("contextBuilder.needsContextPolish")
                  : t("contextBuilder.needsAttention")
            }
          />
        </div>
      </motion.section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AnimatedMetric
          label={t("dashboard.projects")}
          value={projects.length}
          caption={t("dashboard.localWorkspaces")}
          delay={motionDelay(0.06)}
        />
        <AnimatedMetric
          label={t("dashboard.needAttention")}
          value={attentionProjects.length}
          caption={t("dashboard.contextOrScanIssues")}
          delay={motionDelay(0.09)}
        />
        <AnimatedMetric
          label={t("dashboard.taskPacks")}
          value={taskPacks.length}
          caption={t("dashboard.generatedPrompts")}
          delay={motionDelay(0.12)}
        />
        <AnimatedMetric
          label={t("dashboard.readyProjects")}
          value={readyProjectsCount}
          caption={t("dashboard.readyProjectsCaption")}
          delay={motionDelay(0.15)}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
        <DashboardCard
          title={t("dashboard.nextPriority")}
          caption={t("dashboard.quickActionsCaption")}
          delay={motionDelay(0.18)}
        >
          {primaryProject ? (
            <div className="flex min-h-0 flex-1 flex-col justify-between gap-5 rounded-[1.1rem] border border-white/[0.065] bg-black/35 p-5">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-lg font-semibold tracking-[-0.035em] text-white">
                      {primaryProject.name}
                    </span>
                    <span className="rounded-full border border-white/[0.075] bg-white/[0.035] px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-neutral-500">
                      {primaryProject.readinessScore}/100
                    </span>
                  </div>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">
                    {primaryIssue}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-neutral-700">
                    <span>
                      {t("dashboard.lastScanPrefix", {
                        time: formatRelativeTime(primaryProject.lastScanAt, t),
                      })}
                    </span>
                    <span>
                      {primaryProject.packageManager ?? t("labels.noValue")}
                    </span>
                    <span>
                      {primaryProject.detectedStack.slice(0, 3).join(" · ") ||
                        t("labels.noValue")}
                    </span>
                  </div>
                </div>

                <div className="w-full max-w-[210px] shrink-0">
                  <div className="flex items-center justify-between text-xs text-neutral-600">
                    <span>{t("dashboard.avgReadiness")}</span>
                    <span>{primaryProject.readinessScore}%</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-900">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{
                        width: `${Math.max(2, primaryProject.readinessScore)}%`,
                      }}
                      transition={{
                        type: "spring",
                        stiffness: 130,
                        damping: 26,
                        mass: 0.8,
                      }}
                      className="h-full rounded-full bg-neutral-300"
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button
                  variant="primary"
                  onClick={() => runProjectAction(primaryProject)}
                  disabled={isLoading}
                >
                  {getActionLabel(primaryAction, t)}
                  <ArrowRight size={15} />
                </Button>
              </div>
            </div>
          ) : null}
        </DashboardCard>

        <DashboardCard
          title={t("dashboard.otherProjectsNeedingAttention")}
          caption={t("dashboard.otherPriorityCaption")}
          delay={motionDelay(0.21)}
          action={
            <CompactButton onClick={onOpenProjects}>
              {t("dashboard.viewAllProjects")}
            </CompactButton>
          }
        >
          {otherAttentionProjects.length === 0 ? (
            <div className="rounded-[1.1rem] border border-white/[0.065] bg-black/35 p-5">
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
            <div className="divide-y divide-white/[0.055] overflow-hidden rounded-[1.1rem] border border-white/[0.065] bg-black/35">
              {otherAttentionProjects.map((project) => {
                const action = getProjectAction(project);
                const issue = getProjectIssues(project, t)[0];

                return (
                  <div
                    key={project.id}
                    className="grid gap-3 px-4 py-3.5 md:grid-cols-[minmax(0,1fr)_70px_auto] md:items-center"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">
                        {project.name}
                      </p>
                      <p className="mt-1 line-clamp-1 text-xs text-neutral-600">
                        {issue}
                      </p>
                    </div>
                    <p className="text-xs font-medium text-neutral-400">
                      {project.readinessScore}/100
                    </p>
                    <CompactButton
                      onClick={() => runProjectAction(project)}
                      disabled={isLoading}
                    >
                      {getActionLabel(action, t)}
                    </CompactButton>
                  </div>
                );
              })}
            </div>
          )}
        </DashboardCard>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
        <DashboardCard
          title={t("dashboard.currentActivity")}
          caption={t("dashboard.activityCaption")}
          delay={motionDelay(0.24)}
          action={
            <CompactButton onClick={onOpenTaskPacks}>
              {t("dashboard.openArchive")}
            </CompactButton>
          }
        >
          <div className="overflow-hidden rounded-[1.1rem] border border-white/[0.065] bg-black/35">
            {statusMessage ? (
              <div className="grid gap-3 border-b border-white/[0.055] px-4 py-3.5 sm:grid-cols-[32px_minmax(0,1fr)] sm:items-center">
                <span className="grid size-8 place-items-center rounded-full border border-white/[0.075] bg-white/[0.035] text-neutral-400">
                  <Activity size={14} />
                </span>
                <div className="min-w-0">
                  <p className="cf-tech-label text-[10px] uppercase tracking-[0.12em] text-neutral-600">
                    {t("dashboard.workspaceStatus")}
                  </p>
                  <p className="mt-1 line-clamp-1 text-xs leading-5 text-neutral-400">
                    {statusMessage}
                  </p>
                </div>
              </div>
            ) : null}

            {recentTaskPacks.length === 0 ? (
              <div className="p-5">
                <div className="mb-3 grid size-10 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-300">
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
              <div className="divide-y divide-white/[0.055]">
                {recentTaskPacks.map((taskPack) => (
                  <div
                    key={taskPack.id}
                    className="grid gap-3 px-4 py-3.5 md:grid-cols-[32px_minmax(0,1fr)_130px_68px_auto] md:items-center"
                  >
                    <span className="grid size-8 place-items-center rounded-full border border-white/[0.075] bg-white/[0.025] text-neutral-500">
                      <FileText size={14} />
                    </span>
                    <div className="min-w-0">
                      <p className="cf-tech-label text-[10px] uppercase tracking-[0.12em] text-neutral-700">
                        {t("dashboard.taskPackCreated")}
                      </p>
                      <p className="mt-1 truncate text-sm font-semibold text-white">
                        {taskPack.title}
                      </p>
                    </div>
                    <p className="truncate text-xs text-neutral-500">
                      {taskPack.projectName ?? `Project #${taskPack.projectId}`}
                    </p>
                    <p className="text-xs text-neutral-700">
                      {formatRelativeTime(taskPack.createdAt, t)}
                    </p>
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          void navigator.clipboard.writeText(
                            taskPack.generatedPrompt,
                          )
                        }
                        className="grid size-8 place-items-center rounded-full border border-neutral-800 bg-neutral-950 text-neutral-400 transition-colors hover:border-white hover:bg-white hover:text-black"
                        title={t("dashboard.copyPrompt")}
                      >
                        <Clipboard size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenTaskPack(taskPack)}
                        className="grid size-8 place-items-center rounded-full border border-neutral-800 bg-neutral-950 text-neutral-400 transition-colors hover:border-white hover:bg-white hover:text-black"
                        title={t("dashboard.openTaskPack")}
                      >
                        <ArrowRight size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DashboardCard>

        <DashboardCard
          title={t("dashboard.readinessBreakdown")}
          caption={t("dashboard.readinessBreakdownCaption")}
          delay={motionDelay(0.27)}
        >
          <div className="space-y-3 rounded-[1.1rem] border border-white/[0.065] bg-black/35 p-4">
            {breakdown.map((item) => (
              <div
                key={item.label}
                className="grid grid-cols-[92px_minmax(0,1fr)_44px] items-center gap-3"
              >
                <p className="truncate text-xs text-neutral-500">
                  {item.label}
                </p>
                <div className="h-1.5 overflow-hidden rounded-full bg-neutral-900">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.max(2, item.value)}%` }}
                    transition={{
                      type: "spring",
                      stiffness: 120,
                      damping: 25,
                      mass: 0.8,
                    }}
                    className="h-full rounded-full bg-neutral-300"
                  />
                </div>
                <p className="text-right text-xs font-medium text-neutral-400">
                  {item.value}%
                </p>
              </div>
            ))}
          </div>
        </DashboardCard>
      </div>

      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...ENTER_TRANSITION, delay: motionDelay(0.3) }}
        className="rounded-[1.25rem] border border-white/[0.075] bg-white/[0.018] p-3"
      >
        <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-center">
          <div className="px-1">
            <h2 className="text-sm font-semibold tracking-[-0.025em] text-white">
              {t("dashboard.utilities")}
            </h2>
            <p className="mt-1 text-xs leading-5 text-neutral-600">
              {t("dashboard.utilitiesCaption")}
            </p>
          </div>

          <div className="grid gap-2 md:grid-cols-2">
            <UtilityActionButton
              icon={<Zap size={15} />}
              title={t("dashboard.generateMissingAgents")}
              caption={
                missingAgentsProject
                  ? t("dashboard.forProject", {
                      name: missingAgentsProject.name,
                    })
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

            <UtilityActionButton
              icon={<Settings2 size={15} />}
              title={t("dashboard.configureOllama")}
              caption={t("dashboard.localAiProvider")}
              onClick={onOpenSettings}
            />
          </div>
        </div>
      </motion.section>

    </section>
  );
}
