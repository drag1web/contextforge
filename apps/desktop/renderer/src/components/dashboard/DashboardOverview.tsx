import {
    AlertTriangle,
    Bot,
    Clipboard,
    Gauge,
    GitBranch,
    TrendingUp
} from "lucide-react";

import type { Project, TaskPack } from "../../types";
import { getScoreLabel } from "../../lib/score";

interface DashboardOverviewProps {
    projects: Project[];
    taskPacks: TaskPack[];
    readinessScore: number | null;
    statusMessage: string;
    onOpenTaskPack: (taskPack: TaskPack) => void;
}

type AnyRecord = Record<string, unknown>;

function asRecord(value: unknown): AnyRecord {
    return value && typeof value === "object" ? (value as AnyRecord) : {};
}

function getProjectName(project: Project) {
    const record = asRecord(project);

    return String(
        record.name ??
        record.projectName ??
        record.displayName ??
        record.rootName ??
        `Project #${record.id ?? "unknown"}`
    );
}

function getProjectPath(project: Project) {
    const record = asRecord(project);

    return String(record.localPath ?? record.path ?? record.rootPath ?? "");
}

function getProjectReadiness(project: Project) {
    const record = asRecord(project);

    const value =
        record.readinessScore ??
        record.aiReadinessScore ??
        record.aiScore ??
        record.score ??
        null;

    if (typeof value === "number" && Number.isFinite(value)) {
        return Math.max(0, Math.min(100, Math.round(value)));
    }

    return null;
}

function getProjectStack(project: Project) {
    const record = asRecord(project);
    const stack = record.stack ?? record.detectedStack ?? record.technologies ?? record.tags;

    if (Array.isArray(stack)) {
        return stack.map(String).filter(Boolean).slice(0, 5);
    }

    if (typeof stack === "string" && stack.trim()) {
        return stack
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
            .slice(0, 5);
    }

    return ["Unknown"];
}

function getTaskPackBodyBadge(taskPack: TaskPack) {
    if (taskPack.generationMode === "ollama" && !taskPack.generationUsedFallback) {
        return "Ollama refined";
    }

    return "Safe Template";
}

function formatDate(value: string) {
    return new Date(value).toLocaleString();
}

function isThisWeek(value: string) {
    const date = new Date(value);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    return diff >= 0 && diff <= 7 * 24 * 60 * 60 * 1000;
}

function getMostUsedTarget(taskPacks: TaskPack[]) {
    const counts = new Map<string, number>();

    for (const taskPack of taskPacks) {
        counts.set(taskPack.targetTool, (counts.get(taskPack.targetTool) ?? 0) + 1);
    }

    const [target] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];

    return target ?? "—";
}

function getReadinessWidth(score: number | null) {
    if (score === null) {
        return "4%";
    }

    return `${Math.max(4, Math.min(100, score))}%`;
}

function getReadinessTone(score: number | null) {
    if (score === null) {
        return "bg-neutral-500 shadow-[0_0_18px_rgba(115,115,115,0.35)]";
    }

    if (score < 50) {
        return "bg-[#ff1744] shadow-[0_0_18px_rgba(255,23,68,0.78),0_0_38px_rgba(255,23,68,0.32)]";
    }

    if (score < 80) {
        return "bg-white shadow-[0_0_18px_rgba(255,255,255,0.52),0_0_34px_rgba(255,255,255,0.20)]";
    }

    return "bg-[#00ff9d] shadow-[0_0_18px_rgba(0,255,157,0.62),0_0_34px_rgba(0,255,157,0.22)]";
}

export function DashboardOverview({
    projects,
    taskPacks,
    readinessScore,
    statusMessage,
    onOpenTaskPack
}: DashboardOverviewProps) {
    const projectScores = projects.map(getProjectReadiness).filter((score): score is number => score !== null);

    const averageReadiness =
        readinessScore ??
        (projectScores.length > 0
            ? Math.round(projectScores.reduce((sum, score) => sum + score, 0) / projectScores.length)
            : null);

    const lowReadinessProjects = projects.filter((project) => {
        const score = getProjectReadiness(project);
        return score !== null && score < 50;
    });

    const taskPacksThisWeek = taskPacks.filter((taskPack) => isThisWeek(taskPack.createdAt)).length;
    const mostUsedTarget = getMostUsedTarget(taskPacks);

    const attentionProjects = [...projects]
        .map((project) => ({
            project,
            score: getProjectReadiness(project)
        }))
        .sort((a, b) => (a.score ?? 999) - (b.score ?? 999))
        .slice(0, 5);

    const recentTaskPacks = taskPacks.slice(0, 5);

    const buckets = [
        {
            label: "0–25",
            count: projectScores.filter((score) => score <= 25).length
        },
        {
            label: "26–50",
            count: projectScores.filter((score) => score > 25 && score <= 50).length
        },
        {
            label: "51–75",
            count: projectScores.filter((score) => score > 50 && score <= 75).length
        },
        {
            label: "76–100",
            count: projectScores.filter((score) => score > 75).length
        }
    ];

    const maxBucketCount = Math.max(1, ...buckets.map((bucket) => bucket.count));

    return (
        <div className="mb-7 space-y-5">
            <section className="overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.012)_48%,rgba(255,255,255,0.006))] p-6 shadow-[0_16px_52px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.045)]">
                <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
                    <div className="min-w-0">
                        <div className="mb-4 flex flex-wrap gap-2">
                            <span className="cf-badge">
                                <Bot size={13} />
                                Local AI workflow
                            </span>
                            <span className="cf-badge">Validated context</span>
                            <span className="cf-badge">Agent-ready prompts</span>
                        </div>

                        <h2 className="max-w-4xl text-[34px] font-semibold leading-[1.05] tracking-[-0.05em] text-white">
                            Project operations dashboard for AI coding workflows.
                        </h2>

                        <p className="mt-3 max-w-3xl text-sm leading-6 text-neutral-400">
                            Track project readiness, monitor generated Task Packs, and spot repositories
                            that need better context before sending work to Codex, Claude, Cursor, or another agent.
                        </p>
                    </div>

                    <div className="w-full rounded-2xl border border-neutral-900 bg-black/40 px-4 py-3 xl:max-w-[360px]">
                        <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                            Current status
                        </p>

                        <p className="mt-1 line-clamp-2 text-sm leading-6 text-neutral-300">
                            {statusMessage || "Ready to scan and generate task packs."}
                        </p>
                    </div>
                </div>
            </section>

            <section className="grid gap-4 lg:grid-cols-4">
                <article className="cf-card p-5">
                    <div className="mb-4 flex size-9 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-200">
                        <Gauge size={18} />
                    </div>

                    <p className="cf-tech-label text-xs uppercase text-neutral-500">
                        Avg readiness
                    </p>

                    <p className="cf-display-font mt-2 text-4xl font-semibold leading-none text-white">
                        {averageReadiness ?? "—"}
                    </p>

                    <p className="mt-2 text-sm text-neutral-500">
                        {averageReadiness !== null ? getScoreLabel(averageReadiness) : "No scan data"}
                    </p>
                </article>

                <article className="cf-card p-5">
                    <div className="mb-4 flex size-9 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-200">
                        <AlertTriangle size={18} />
                    </div>

                    <p className="cf-tech-label text-xs uppercase text-neutral-500">
                        Need attention
                    </p>

                    <p className="cf-display-font mt-2 text-4xl font-semibold leading-none text-white">
                        {lowReadinessProjects.length}
                    </p>

                    <p className="mt-2 text-sm text-neutral-500">
                        projects below 50/100
                    </p>
                </article>

                <article className="cf-card p-5">
                    <div className="mb-4 flex size-9 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-200">
                        <GitBranch size={18} />
                    </div>

                    <p className="cf-tech-label text-xs uppercase text-neutral-500">
                        Task Packs / week
                    </p>

                    <p className="cf-display-font mt-2 text-4xl font-semibold leading-none text-white">
                        {taskPacksThisWeek}
                    </p>

                    <p className="mt-2 text-sm text-neutral-500">
                        recent generated prompts
                    </p>
                </article>

                <article className="cf-card p-5">
                    <div className="mb-4 flex size-9 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-200">
                        <TrendingUp size={18} />
                    </div>

                    <p className="cf-tech-label text-xs uppercase text-neutral-500">
                        Top target
                    </p>

                    <p className="cf-display-font mt-2 truncate text-4xl font-semibold leading-none text-white">
                        {mostUsedTarget}
                    </p>

                    <p className="mt-2 text-sm text-neutral-500">
                        most used coding agent
                    </p>
                </article>
            </section>

            <section className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)]">
                <article className="cf-card p-5">
                    <div className="mb-5 flex items-start justify-between gap-4">
                        <div>
                            <p className="cf-tech-label mb-2 text-xs uppercase text-neutral-600">
                                Analyzer
                            </p>
                            <h3 className="text-base font-semibold text-white">
                                Project readiness health
                            </h3>
                            <p className="mt-1 text-sm text-neutral-500">
                                Lowest readiness projects are shown first.
                            </p>
                        </div>

                        <span className="cf-badge">
                            {projects.length} projects
                        </span>
                    </div>

                    <div className="space-y-4">
                        {attentionProjects.length === 0 ? (
                            <div className="rounded-2xl border border-neutral-900 bg-black/35 p-5 text-sm text-neutral-500">
                                No projects scanned yet. Add a local repository to start collecting readiness data.
                            </div>
                        ) : (
                            attentionProjects.map(({ project, score }) => (
                                <div key={String(asRecord(project).id ?? getProjectName(project))}>
                                    <div className="mb-2 flex items-center justify-between gap-4">
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-medium text-white">
                                                {getProjectName(project)}
                                            </p>
                                            <p className="truncate text-xs text-neutral-600">
                                                {getProjectPath(project)}
                                            </p>
                                        </div>

                                        <span className="cf-tech-label shrink-0 text-xs text-neutral-400">
                                            {score ?? "—"}/100
                                        </span>
                                    </div>

                                    <div className="rounded-full border border-white/10 bg-black p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.055)]">
                                        <div className="h-2.5 overflow-hidden rounded-full bg-white/[0.075]">
                                            <div
                                                className={[
                                                    "h-full rounded-full transition-[width] duration-500 ease-out",
                                                    getReadinessTone(score)
                                                ].join(" ")}
                                                style={{ width: getReadinessWidth(score) }}
                                            />
                                        </div>
                                    </div>

                                    <div className="mt-2 flex flex-wrap gap-2">
                                        {getProjectStack(project).map((item) => (
                                            <span key={item} className="rounded-full bg-white/[0.055] px-2 py-1 text-[11px] text-neutral-400">
                                                {item}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
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
                                How your repositories are distributed by AI-readiness score.
                            </p>
                        </div>

                        <div className="space-y-3">
                            {buckets.map((bucket) => (
                                <div key={bucket.label}>
                                    <div className="mb-1 flex items-center justify-between text-xs">
                                        <span className="text-neutral-500">{bucket.label}</span>
                                        <span className="cf-tech-label text-neutral-400">{bucket.count}</span>
                                    </div>

                                    <div className="h-2 overflow-hidden rounded-full bg-neutral-900">
                                        <div
                                            className="h-full rounded-full bg-white shadow-[0_0_18px_rgba(255,255,255,0.38)]"
                                            style={{ width: `${Math.max(4, (bucket.count / maxBucketCount) * 100)}%` }}
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </article>

                    <article className="cf-card p-5">
                        <div className="mb-5">
                            <p className="cf-tech-label mb-2 text-xs uppercase text-neutral-600">
                                Activity
                            </p>
                            <h3 className="text-base font-semibold text-white">
                                Recent Task Packs
                            </h3>
                        </div>

                        <div className="space-y-3">
                            {recentTaskPacks.length === 0 ? (
                                <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4 text-sm text-neutral-500">
                                    No Task Packs yet. Create one from any project card.
                                </div>
                            ) : (
                                recentTaskPacks.map((taskPack) => (
                                    <button
                                        key={taskPack.id}
                                        type="button"
                                        onClick={() => onOpenTaskPack(taskPack)}
                                        className="w-full rounded-2xl border border-neutral-900 bg-black/30 p-4 text-left transition hover:border-neutral-800 hover:bg-white/[0.035]"
                                    >
                                        <div className="mb-2 flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="truncate text-sm font-medium text-white">
                                                    {taskPack.title}
                                                </p>

                                                <p className="truncate text-xs text-neutral-600">
                                                    {taskPack.projectName ?? `Project #${taskPack.projectId}`}
                                                </p>
                                            </div>

                                            <Clipboard size={14} className="shrink-0 text-neutral-600" />
                                        </div>

                                        <p className="line-clamp-2 text-xs leading-5 text-neutral-500">
                                            {taskPack.rawTask}
                                        </p>

                                        <div className="mt-3 flex flex-wrap gap-2">
                                            <span className="cf-badge">{taskPack.taskType}</span>
                                            <span className="cf-badge">{taskPack.targetTool}</span>
                                            <span className="cf-badge">{getTaskPackBodyBadge(taskPack)}</span>
                                            <span className="cf-badge">{formatDate(taskPack.createdAt)}</span>
                                        </div>
                                    </button>
                                ))
                            )}
                        </div>
                    </article>
                </div>
            </section>
        </div>
    );
}