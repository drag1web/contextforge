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
  AlertTriangle,
  Archive,
  ArrowRight,
  CheckCircle2,
  Clipboard,
  Eye,
  FileText,
  FolderOpen,
  Gauge,
  Settings2,
  Sparkles,
  Zap,
} from "lucide-react";
import type { TFunction } from "i18next";

import { WorkspacePageHeader } from "../components/layout/WorkspacePageHeader";
import { ProjectAwarenessSummary } from "../components/projects/ProjectAwarenessPanel";
import { localizeReadinessIssueTitle } from "../components/projects/projectDetailsI18n";
import { Button } from "../components/ui/Button";
import { WorkspaceDisclosure } from "../components/workspace/WorkspaceDisclosure";
import { TaskPackFreshnessBadge } from "../components/taskPacks/TaskPackFreshness";
import type { Project, ReadinessCheck, TaskPack } from "../types";
import type { TaskPackFreshness } from "../utils/taskPackFreshness";
import {
  getDashboardAttentionProjects,
  getDashboardAwarenessCounts,
  getDashboardAwarenessProjects,
  getDashboardPrimaryProject,
  getDashboardProjectAction,
  getDashboardRecentTaskPacks,
  type DashboardProjectAction,
} from "../utils/dashboardWorkspace";

interface DashboardHomePageProps {
  projects: Project[];
  taskPacks: TaskPack[];
  freshnessByTaskPackId: ReadonlyMap<number, TaskPackFreshness>;
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
  onOpenProjectDetails: (project: Project) => void;
  onQuickPeekProject: (project: Project) => void;
}

type BreakdownItem = {
  label: string;
  value: number;
};

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
  t: TFunction,
) {
  const report = project.readinessReport;
  const failedChecks = report?.checks?.filter((check) => !check.passed) ?? [];
  const reportIssues = (report?.issues ?? []).map((issue) => {
    const matchingCheck = failedChecks.find((check) =>
      readinessIssueMatchesCheck(issue, check),
    );

    return matchingCheck && report
      ? localizeReadinessIssueTitle(t, report, matchingCheck)
      : issue;
  });
  const localizedFailedChecks = report
    ? failedChecks.map((check) =>
        localizeReadinessIssueTitle(t, report, check),
      )
    : [];

  const issues = Array.from(
    new Set([...reportIssues, ...localizedFailedChecks]),
  );

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

const KNOWN_READINESS_ISSUES_BY_CHECK: Readonly<
  Record<string, readonly string[]>
> = {
  agents: [
    "No AI agent instruction file found. Add AGENTS.md to make the project easier for AI tools.",
  ],
  "test-script": [
    "Test files/config were detected, but no package script exposes them. Add a test script for AI verification.",
    "No test script found. AI agents will not know how to verify changes.",
  ],
  tests: [
    "A test script exists, but no test files or test config were detected in the scanned project paths.",
    "Tests structure is missing.",
  ],
  "env-example": [
    "No .env.example file found. Environment setup may be unclear.",
  ],
  "build-script": [
    "No build script found. AI agents may not know how to validate production build.",
  ],
  "dev-script": ["Dev command is missing."],
};

function readinessIssueMatchesCheck(issue: string, check: ReadinessCheck) {
  return (
    issue === check.message ||
    issue === `${check.label} is missing.` ||
    (KNOWN_READINESS_ISSUES_BY_CHECK[check.key] ?? []).includes(issue)
  );
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

function getReadinessBreakdown(
  projects: Project[],
  t: TFunction,
): BreakdownItem[] {
  return [
    {
      label: t("dashboard.breakdownDocs"),
      value: getCheckCategoryScore(
        projects,
        ["readme", "docs", "documentation", "architecture"],
        (project) => !hasIssue(project, ["readme", "docs", "architecture"]),
      ),
    },
    {
      label: t("dashboard.breakdownScripts"),
      value: getCheckCategoryScore(
        projects,
        ["script", "build", "dev", "command"],
        (project) => Boolean(project.scripts?.build || project.scripts?.dev),
      ),
    },
    {
      label: t("dashboard.breakdownTests"),
      value: getCheckCategoryScore(
        projects,
        ["test"],
        (project) => Boolean(project.scripts?.test),
      ),
    },
    {
      label: t("dashboard.breakdownEnvExample"),
      value: getCheckCategoryScore(
        projects,
        ["env", "environment"],
        (project) =>
          !hasIssue(project, [".env", "env example", "environment"]),
      ),
    },
    {
      label: t("dashboard.breakdownAgents"),
      value: getCheckCategoryScore(
        projects,
        ["agents", "instructions"],
        (project) =>
          !hasIssue(project, ["agents.md", "agents", "ai instructions"]),
      ),
    },
    {
      label: t("dashboard.breakdownInventory"),
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
            <p className="mt-1 text-xs leading-5 text-neutral-500">
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
      <p className="cf-tech-label text-[10px] uppercase text-neutral-500">
        {label}
      </p>
      <p className="mt-1 text-[27px] font-semibold leading-none tracking-[-0.05em] text-white">
        {animatedValue}
      </p>
      <p className="mt-1 truncate text-xs text-neutral-500">{caption}</p>
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
        <span className="mt-0.5 block truncate text-xs text-neutral-500">
          {caption}
        </span>
      </span>
      <ArrowRight className="ml-auto shrink-0 text-neutral-700" size={14} />
    </button>
  );
}

function getActionLabel(
  action: DashboardProjectAction,
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
  freshnessByTaskPackId,
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
  onOpenProjectDetails,
  onQuickPeekProject,
}: DashboardHomePageProps) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const attentionProjects = useMemo(
    () => getDashboardAttentionProjects(projects),
    [projects],
  );
  const recentTaskPacks = useMemo(
    () => getDashboardRecentTaskPacks(taskPacks),
    [taskPacks],
  );
  const taskPackReviewCount = useMemo(
    () =>
      [...freshnessByTaskPackId.values()].filter(
        (freshness) =>
          freshness.status === "affected" ||
          freshness.status === "review_recommended",
      ).length,
    [freshnessByTaskPackId],
  );
  const breakdown = useMemo(
    () => getReadinessBreakdown(projects, t),
    [projects, t],
  );
  const primaryProject = useMemo(
    () =>
      getDashboardPrimaryProject(projects, taskPacks, attentionProjects),
    [attentionProjects, projects, taskPacks],
  );
  const awarenessProjects = useMemo(
    () => getDashboardAwarenessProjects(projects),
    [projects],
  );
  const awarenessCounts = useMemo(
    () => getDashboardAwarenessCounts(projects),
    [projects],
  );
  const awarenessHighlights = useMemo(
    () =>
      awarenessProjects
        .filter((project) => project.awareness?.status !== "unchanged")
        .slice(0, 4),
    [awarenessProjects],
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
    const action = getDashboardProjectAction(project);

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
    ? getDashboardProjectAction(primaryProject)
    : "buildContext";
  const primaryIssue = primaryProject
    ? getProjectIssues(primaryProject, t)[0]
    : t("dashboard.noUrgentDetected");
  const motionDelay = (value: number) => (reduceMotion ? 0 : value);

  return (
    <section className="space-y-5 pb-2">
      <WorkspacePageHeader
        icon={<Gauge size={18} />}
        eyebrow={t("dashboard.workspaceKicker")}
        title={t("dashboard.workspaceOverview")}
        description={t("dashboard.intelligenceWorkspaceDescription")}
        headingLevel={1}
        aside={
          <div className="flex w-full min-w-0 flex-wrap items-center justify-start gap-2 xl:max-w-[420px] xl:justify-end">
            <span className="cf-badge">
              {t("dashboard.projectCount", { count: projects.length })}
            </span>
            <span className="cf-badge">
              {t("dashboard.lastScan", { time: latestScanLabel })}
            </span>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <AnimatedMetric
          label={t("dashboard.needAttention")}
          value={attentionProjects.length}
          caption={
            attentionProjects.length > 0
              ? t("dashboard.attentionActionableCaption")
              : t("dashboard.attentionClearCaption")
          }
          delay={motionDelay(0.06)}
        />
        <AnimatedMetric
          label={t("dashboard.changedProjects")}
          value={awarenessCounts.changed}
          caption={
            awarenessCounts.changed > 0
              ? t("dashboard.changedProjectsCaption")
              : t("dashboard.noObservedChangesCaption")
          }
          delay={motionDelay(0.09)}
        />
        <AnimatedMetric
          label={t("dashboard.avgReadiness")}
          value={readinessValue}
          caption={t("dashboard.workspaceScore")}
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
          caption={t("dashboard.nextPriorityCaption")}
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
                  <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-neutral-500">
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
                  <ProjectAwarenessSummary
                    project={primaryProject}
                    className="mt-3 max-w-2xl"
                  />
                </div>

                <div className="w-full max-w-[210px] shrink-0">
                  <div className="flex items-center justify-between text-xs text-neutral-500">
                    <span>{t("dashboard.projectReadiness")}</span>
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
                <CompactButton
                  onClick={() => onOpenProjectDetails(primaryProject)}
                >
                  {t("dashboard.openProject")}
                </CompactButton>
                <button
                  type="button"
                  onClick={() => onQuickPeekProject(primaryProject)}
                  className="inline-flex h-8 items-center gap-2 rounded-full px-3 text-xs font-medium text-neutral-500 transition-colors hover:bg-white/[0.045] hover:text-white"
                >
                  <Eye size={13} />
                  {t("dashboard.quickPeek")}
                </button>
              </div>
            </div>
          ) : null}
        </DashboardCard>

        <DashboardCard
          title={t("dashboard.attentionQueue")}
          caption={t("dashboard.attentionQueueCaption")}
          delay={motionDelay(0.21)}
          action={
            <CompactButton onClick={onOpenProjects}>
              {t("dashboard.viewAllProjects")}
            </CompactButton>
          }
        >
          {attentionProjects.length === 0 ? (
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
              {attentionProjects.slice(0, 4).map((project) => {
                const action = getDashboardProjectAction(project);
                const issue = getProjectIssues(project, t)[0];

                return (
                  <div
                    key={project.id}
                    className="grid min-w-0 gap-3 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">
                        {project.name}
                      </p>
                      <p className="mt-1 line-clamp-1 text-xs text-neutral-500">
                        {issue}
                      </p>
                    </div>
                    <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
                      <span className="shrink-0 text-xs font-medium text-neutral-400">
                        {project.readinessScore}/100
                      </span>
                      <CompactButton
                        onClick={() => runProjectAction(project)}
                        disabled={isLoading}
                      >
                        {getActionLabel(action, t)}
                      </CompactButton>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </DashboardCard>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
        <DashboardCard
          title={t("dashboard.whatChanged")}
          caption={t("dashboard.whatChangedCaption")}
          delay={motionDelay(0.24)}
          action={
            <CompactButton onClick={onOpenProjects}>
              {t("dashboard.viewProjects")}
            </CompactButton>
          }
        >
          {awarenessHighlights.length === 0 ? (
            <div className="rounded-[1.1rem] border border-white/[0.065] bg-black/35 p-5">
              <div className="mb-3 grid size-10 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-400">
                <CheckCircle2 size={17} />
              </div>
              <p className="text-sm font-semibold text-white">
                {t("dashboard.noAwarenessChanges")}
              </p>
              <p className="mt-1 text-sm leading-6 text-neutral-500">
                {t("dashboard.noAwarenessChangesDescription")}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-white/[0.055] overflow-hidden rounded-[1.1rem] border border-white/[0.065] bg-black/35">
              {awarenessHighlights.map((project) => {
                const readiness = project.awareness?.readinessChange;

                return (
                  <div
                    key={project.id}
                    className="grid min-w-0 gap-3 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                  >
                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <p className="min-w-0 truncate text-sm font-semibold text-white">
                          {project.name}
                        </p>
                        {readiness ? (
                          <span className="shrink-0 rounded-full border border-white/[0.07] bg-white/[0.025] px-2 py-0.5 text-[10px] text-neutral-500">
                            {readiness.previous} → {readiness.current}
                          </span>
                        ) : null}
                      </div>
                      <ProjectAwarenessSummary
                        project={project}
                        className="mt-1.5"
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                      <button
                        type="button"
                        onClick={() => onQuickPeekProject(project)}
                        className="grid size-8 place-items-center rounded-full border border-neutral-800 bg-neutral-950 text-neutral-400 transition-colors hover:border-white hover:bg-white hover:text-black"
                        title={t("dashboard.quickPeek")}
                        aria-label={t("dashboard.quickPeekProject", {
                          name: project.name,
                        })}
                      >
                        <Eye size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenProjectDetails(project)}
                        className="grid size-8 place-items-center rounded-full border border-neutral-800 bg-neutral-950 text-neutral-400 transition-colors hover:border-white hover:bg-white hover:text-black"
                        title={t("dashboard.openProject")}
                        aria-label={t("dashboard.openProjectNamed", {
                          name: project.name,
                        })}
                      >
                        <ArrowRight size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {awarenessCounts.limited > 0 ? (
            <div className="mt-3 flex min-w-0 items-start gap-2 rounded-xl border border-amber-300/15 bg-amber-300/[0.035] px-3 py-2.5 text-xs leading-5 text-amber-100/70">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>
                {t("dashboard.limitedAwarenessCount", {
                  count: awarenessCounts.limited,
                })}
              </span>
            </div>
          ) : null}
        </DashboardCard>

        <DashboardCard
          title={t("dashboard.recentWork")}
          caption={t("dashboard.recentWorkCaption")}
          delay={motionDelay(0.27)}
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
                  <p className="cf-tech-label text-[10px] uppercase tracking-[0.12em] text-neutral-500">
                    {t("dashboard.workspaceStatus")}
                  </p>
                  <p className="mt-1 line-clamp-1 text-xs leading-5 text-neutral-400">
                    {statusMessage}
                  </p>
                </div>
              </div>
            ) : null}

            {taskPackReviewCount > 0 ? (
              <button
                type="button"
                onClick={onOpenTaskPacks}
                className="flex w-full min-w-0 items-center gap-3 border-b border-amber-300/10 bg-amber-300/[0.025] px-4 py-3 text-left transition-colors hover:bg-amber-300/[0.045]"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-full border border-amber-300/15 text-amber-100/70">
                  <AlertTriangle size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold text-amber-100/80">
                    {t("dashboard.taskPackFreshnessAttention", {
                      count: taskPackReviewCount,
                    })}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-4 text-neutral-500">
                    {t("dashboard.taskPackFreshnessAttentionCaption")}
                  </span>
                </span>
                <ArrowRight size={14} className="shrink-0 text-neutral-600" />
              </button>
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
                      <p className="cf-tech-label text-[10px] uppercase tracking-[0.12em] text-neutral-500">
                        {t("dashboard.taskPackCreated")}
                      </p>
                      <p className="mt-1 truncate text-sm font-semibold text-white">
                        {taskPack.title}
                      </p>
                      {freshnessByTaskPackId.get(taskPack.id) ? (
                        <TaskPackFreshnessBadge
                          freshness={freshnessByTaskPackId.get(taskPack.id)!}
                          className="mt-2 max-w-full"
                        />
                      ) : null}
                    </div>
                    <p className="truncate text-xs text-neutral-500">
                      {taskPack.projectName ??
                        t("labels.projectFallback", { id: taskPack.projectId })}
                    </p>
                    <p className="text-xs text-neutral-500">
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

      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...ENTER_TRANSITION, delay: motionDelay(0.3) }}
      >
        <WorkspaceDisclosure
          title={t("dashboard.readinessBreakdown")}
          summary={t("dashboard.readinessBreakdownSummary", {
            readiness: readinessValue,
            ready: readyProjectsCount,
            count: projects.length,
          })}
          badge={<span className="cf-badge">{readinessValue}/100</span>}
          icon={<Gauge size={14} />}
          defaultOpen={false}
        >
          <div className="grid gap-x-5 gap-y-3 md:grid-cols-2 xl:grid-cols-3">
            {breakdown.map((item) => (
              <div
                key={item.label}
                className="grid min-w-0 grid-cols-[92px_minmax(0,1fr)_44px] items-center gap-3"
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
        </WorkspaceDisclosure>
      </motion.div>

      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...ENTER_TRANSITION, delay: motionDelay(0.33) }}
        className="rounded-[1.25rem] border border-white/[0.075] bg-white/[0.018] p-3"
      >
        <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-center">
          <div className="px-1">
            <h2 className="text-sm font-semibold tracking-[-0.025em] text-white">
              {t("dashboard.utilities")}
            </h2>
            <p className="mt-1 text-xs leading-5 text-neutral-500">
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
