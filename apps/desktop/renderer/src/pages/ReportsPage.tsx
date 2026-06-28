import { useMemo, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Archive,
  BarChart3,
  Bot,
  CheckCircle2,
  Clock3,
  FolderOpen,
  Gauge,
  Layers3,
  TrendingUp
} from "lucide-react";

import type { Project, TaskPack } from "../types";
import { Button } from "../components/ui/Button";

interface ReportsPageProps {
  projects: Project[];
  taskPacks: TaskPack[];
  readinessScore: number | null;
  statusMessage: string;
  onOpenProjects: () => void;
  onOpenTaskPacks: () => void;
  onOpenTaskPack: (taskPack: TaskPack) => void;
}

const REPORT_TRANSITION = {
  duration: 0.22,
  ease: [0.16, 1, 0.3, 1]
} as const;

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
    return "bg-neutral-600 shadow-[0_0_18px_rgba(115,115,115,0.35)]";
  }

  if (score < 50) {
    return "bg-[#ff1744] shadow-[0_0_18px_rgba(255,23,68,0.72),0_0_38px_rgba(255,23,68,0.28)]";
  }

  if (score < 80) {
    return "bg-white shadow-[0_0_18px_rgba(255,255,255,0.48),0_0_34px_rgba(255,255,255,0.18)]";
  }

  return "bg-[#00ff9d] shadow-[0_0_18px_rgba(0,255,157,0.58),0_0_34px_rgba(0,255,157,0.2)]";
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
    return "Ollama refined";
  }

  return "Safe Template";
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

function MetricCard({
  icon,
  label,
  value,
  caption
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  caption: string;
}) {
  return (
    <article className="cf-card p-5">
      <div className="mb-4 flex size-10 items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-200">
        {icon}
      </div>

      <p className="cf-tech-label text-xs uppercase text-neutral-500">
        {label}
      </p>

      <p className="cf-display-font mt-2 truncate text-4xl font-semibold leading-none text-white">
        {value}
      </p>

      <p className="mt-2 truncate text-sm text-neutral-500">
        {caption}
      </p>
    </article>
  );
}

function InsightCard({
  icon,
  title,
  description
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <article className="cf-card p-5">
      <div className="mb-4 flex size-10 items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-200">
        {icon}
      </div>

      <h3 className="text-base font-semibold text-white">{title}</h3>

      <p className="mt-2 text-sm leading-6 text-neutral-500">
        {description}
      </p>
    </article>
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

export function ReportsPage({
  projects,
  taskPacks,
  readinessScore,
  statusMessage,
  onOpenProjects,
  onOpenTaskPacks,
  onOpenTaskPack
}: ReportsPageProps) {
  const averageReadiness = readinessScore ?? getAverageReadiness(projects);

  const lowReadinessProjects = useMemo(() => {
    return [...projects]
      .filter((project) => project.readinessScore < 50)
      .sort((a, b) => a.readinessScore - b.readinessScore)
      .slice(0, 6);
  }, [projects]);

  const strongestProjects = useMemo(() => {
    return [...projects]
      .sort((a, b) => b.readinessScore - a.readinessScore)
      .slice(0, 4);
  }, [projects]);

  const recentTaskPacks = useMemo(() => {
    return [...taskPacks]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5);
  }, [taskPacks]);

  const buckets = useMemo(() => {
    const scores = projects.map((project) => project.readinessScore);

    return [
      {
        label: "0–25",
        caption: "Critical",
        count: scores.filter((score) => score <= 25).length,
        score: 18
      },
      {
        label: "26–50",
        caption: "Needs work",
        count: scores.filter((score) => score > 25 && score <= 50).length,
        score: 40
      },
      {
        label: "51–75",
        caption: "Moderate",
        count: scores.filter((score) => score > 50 && score <= 75).length,
        score: 62
      },
      {
        label: "76–100",
        caption: "Ready",
        count: scores.filter((score) => score > 75).length,
        score: 90
      }
    ];
  }, [projects]);

  const maxBucketCount = Math.max(1, ...buckets.map((bucket) => bucket.count));
  const topStack = getTopStack(projects);
  const topTarget = getMostUsedTarget(taskPacks);

  return (
    <section className="space-y-5">
      <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.014)_48%,rgba(255,255,255,0.006))] p-6 shadow-[0_16px_52px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.045)]">
        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div>
            <div className="mb-4 flex flex-wrap gap-2">
              <span className="cf-badge">
                <BarChart3 size={13} />
                Reports
              </span>
              <span className="cf-badge">Workspace analytics</span>
              <span className="cf-badge">Readiness insights</span>
            </div>

            <h2 className="max-w-4xl text-[34px] font-semibold leading-[1.05] tracking-[-0.05em] text-white">
              Analyze project readiness, generated prompts and AI workflow health.
            </h2>

            <p className="mt-3 max-w-3xl text-sm leading-6 text-neutral-400">
              Reports keeps the heavy analytics separate from Dashboard. Use it to find
              weak projects, review Task Pack activity, and understand how prepared your
              workspace is for AI coding agents.
            </p>
          </div>

          <aside className="rounded-[1.5rem] border border-neutral-900 bg-black/40 p-5">
            <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
              Current status
            </p>

            <h3 className="mt-2 text-base font-semibold text-white">
              {getReadinessLabel(averageReadiness)}
            </h3>

            <p className="mt-2 line-clamp-3 text-sm leading-6 text-neutral-500">
              {statusMessage || "Reports are ready."}
            </p>

            <div className="mt-5">
              <ScoreBar score={averageReadiness} />
            </div>
          </aside>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        <MetricCard
          icon={<FolderOpen size={18} />}
          label="Projects"
          value={projects.length}
          caption="scanned repositories"
        />

        <MetricCard
          icon={<Gauge size={18} />}
          label="Avg readiness"
          value={averageReadiness === null ? "—" : `${averageReadiness}`}
          caption="workspace AI score"
        />

        <MetricCard
          icon={<AlertTriangle size={18} />}
          label="Need attention"
          value={lowReadinessProjects.length}
          caption="projects below 50/100"
        />

        <MetricCard
          icon={<Archive size={18} />}
          label="Task Packs"
          value={taskPacks.length}
          caption="generated prompts"
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(380px,0.85fr)]">
        <article className="cf-card p-5">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <p className="cf-tech-label mb-2 text-xs uppercase text-neutral-600">
                Readiness health
              </p>

              <h3 className="text-base font-semibold text-white">
                Projects needing context work
              </h3>

              <p className="mt-1 text-sm text-neutral-500">
                Lowest scoring projects appear first.
              </p>
            </div>

            <Button variant="secondary" onClick={onOpenProjects}>
              <FolderOpen size={15} />
              Open Projects
            </Button>
          </div>

          {lowReadinessProjects.length === 0 ? (
            <div className="rounded-2xl border border-neutral-900 bg-black/35 p-5">
              <div className="mb-3 flex items-center gap-2">
                <CheckCircle2 size={16} className="text-emerald-300" />
                <p className="text-sm font-medium text-white">
                  No weak projects detected
                </p>
              </div>

              <p className="text-sm leading-6 text-neutral-500">
                All scanned projects are currently above the low readiness threshold.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {lowReadinessProjects.map((project) => (
                <motion.div
                  key={project.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={REPORT_TRANSITION}
                  className="rounded-2xl border border-neutral-900 bg-black/35 p-4"
                >
                  <div className="mb-3 flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">
                        {project.name}
                      </p>

                      <p className="mt-1 truncate text-xs text-neutral-600">
                        {project.localPath}
                      </p>
                    </div>

                    <span className="cf-tech-label shrink-0 text-xs text-neutral-400">
                      {project.readinessScore}/100
                    </span>
                  </div>

                  <ScoreBar score={project.readinessScore} />

                  <p className="mt-3 line-clamp-2 text-sm leading-6 text-neutral-500">
                    {project.readinessReport.issues[0] ||
                      "Improve README, scripts, AGENTS.md, tests, or environment examples."}
                  </p>
                </motion.div>
              ))}
            </div>
          )}
        </article>

        <div className="space-y-5">
          <article className="cf-card p-5">
            <div className="mb-5">
              <p className="cf-tech-label mb-2 text-xs uppercase text-neutral-600">
                Distribution
              </p>

              <h3 className="text-base font-semibold text-white">
                Readiness spread
              </h3>

              <p className="mt-1 text-sm text-neutral-500">
                How your repositories are distributed by score.
              </p>
            </div>

            <div className="space-y-4">
              {buckets.map((bucket) => (
                <div key={bucket.label}>
                  <div className="mb-2 flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-white">
                        {bucket.label}
                      </p>

                      <p className="text-xs text-neutral-600">
                        {bucket.caption}
                      </p>
                    </div>

                    <span className="cf-display-font text-xl font-semibold text-white">
                      {bucket.count}
                    </span>
                  </div>

                  <div className="rounded-full border border-white/10 bg-black p-1">
                    <div className="h-2.5 overflow-hidden rounded-full bg-white/[0.075]">
                      <div
                        className={[
                          "h-full rounded-full transition-[width] duration-500 ease-out",
                          getScoreFillClass(bucket.score)
                        ].join(" ")}
                        style={{
                          width: `${Math.max(4, (bucket.count / maxBucketCount) * 100)}%`
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="cf-card p-5">
            <p className="cf-tech-label mb-2 text-xs uppercase text-neutral-600">
              Stack / agent signals
            </p>

            <div className="grid gap-3">
              <div className="flex items-center justify-between gap-4 rounded-2xl border border-neutral-900 bg-black/35 px-4 py-3">
                <span className="text-sm text-neutral-500">Top stack</span>
                <span className="font-medium text-white">{topStack}</span>
              </div>

              <div className="flex items-center justify-between gap-4 rounded-2xl border border-neutral-900 bg-black/35 px-4 py-3">
                <span className="text-sm text-neutral-500">Top target</span>
                <span className="font-medium text-white">{topTarget}</span>
              </div>

              <div className="flex items-center justify-between gap-4 rounded-2xl border border-neutral-900 bg-black/35 px-4 py-3">
                <span className="text-sm text-neutral-500">Strong projects</span>
                <span className="font-medium text-white">
                  {projects.filter((project) => project.readinessScore >= 80).length}
                </span>
              </div>
            </div>
          </article>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <article className="cf-card p-5">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <p className="cf-tech-label mb-2 text-xs uppercase text-neutral-600">
                Recent activity
              </p>

              <h3 className="text-base font-semibold text-white">
                Latest generated Task Packs
              </h3>

              <p className="mt-1 text-sm text-neutral-500">
                Most recent prompt outputs from your archive.
              </p>
            </div>

            <Button variant="secondary" onClick={onOpenTaskPacks}>
              <Archive size={15} />
              Open Archive
            </Button>
          </div>

          {recentTaskPacks.length === 0 ? (
            <div className="rounded-2xl border border-neutral-900 bg-black/35 p-5 text-sm text-neutral-500">
              No Task Packs generated yet.
            </div>
          ) : (
            <div className="space-y-3">
              {recentTaskPacks.map((taskPack) => (
                <button
                  key={taskPack.id}
                  type="button"
                  onClick={() => onOpenTaskPack(taskPack)}
                  className="group w-full rounded-2xl border border-neutral-900 bg-black/35 p-4 text-left transition hover:border-white hover:bg-white hover:text-black"
                >
                  <div className="mb-2 flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="line-clamp-1 text-sm font-semibold text-white transition group-hover:text-black">
                        {taskPack.title}
                      </p>

                      <p className="mt-1 truncate text-xs text-neutral-600 transition group-hover:text-black/55">
                        {getTaskPackProjectName(taskPack)}
                      </p>
                    </div>

                    <span className="shrink-0 rounded-full border border-neutral-800 bg-neutral-950 px-2.5 py-1 text-[11px] text-neutral-400 transition group-hover:border-black/10 group-hover:bg-black/5 group-hover:text-black/60">
                      {getTaskPackBodyBadge(taskPack)}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="rounded-full border border-neutral-900 bg-black/45 px-2 py-1 text-[11px] text-neutral-500 transition group-hover:border-black/10 group-hover:bg-black/5 group-hover:text-black/60">
                      {taskPack.targetTool}
                    </span>

                    <span className="rounded-full border border-neutral-900 bg-black/45 px-2 py-1 text-[11px] text-neutral-500 transition group-hover:border-black/10 group-hover:bg-black/5 group-hover:text-black/60">
                      {taskPack.taskType}
                    </span>

                    <span className="rounded-full border border-neutral-900 bg-black/45 px-2 py-1 text-[11px] text-neutral-500 transition group-hover:border-black/10 group-hover:bg-black/5 group-hover:text-black/60">
                      {formatDate(taskPack.createdAt)}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </article>

        <aside className="space-y-5">
          <InsightCard
            icon={<TrendingUp size={18} />}
            title="Best project candidates"
            description={
              strongestProjects.length > 0
                ? `${strongestProjects.map((project) => project.name).join(", ")} are currently the strongest AI-ready repositories.`
                : "Scan projects to discover your strongest AI-ready repositories."
            }
          />

          <InsightCard
            icon={<Bot size={18} />}
            title="Prompt workflow usage"
            description={
              taskPacks.length > 0
                ? `Most generated prompts currently target ${topTarget}. Use Task Pack archive to inspect and reuse them.`
                : "Generate Task Packs to start building prompt workflow history."
            }
          />

          <InsightCard
            icon={<Layers3 size={18} />}
            title="Context quality direction"
            description="Reports should become the place for trends, weak signals, project quality history and future team/export analytics."
          />

          <InsightCard
            icon={<Clock3 size={18} />}
            title="Next analytics step"
            description="Later we can add readiness history, scan timeline, file coverage, task categories and exportable reports."
          />
        </aside>
      </div>
    </section>
  );
}