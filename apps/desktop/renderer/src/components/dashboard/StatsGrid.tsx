import { Bot, Gauge, GitBranch, Package } from "lucide-react";
import { getScoreLabel } from "../../lib/score";

interface StatsGridProps {
  readinessScore: number | null;
  projectsCount: number;
  taskPacksCount: number;
}

export function StatsGrid({
  readinessScore,
  projectsCount,
  taskPacksCount
}: StatsGridProps) {
  return (
    <div className="grid gap-4 lg:grid-cols-4">
      <div className="cf-card p-5">
        <div className="mb-4 flex size-9 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-200">
          <Gauge size={18} />
        </div>

        <p className="cf-tech-label text-xs uppercase text-neutral-500">
          AI Readiness
        </p>

        <p className="cf-display-font mt-2 text-4xl font-semibold leading-none text-white">
          {readinessScore ?? "—"}
        </p>

        {readinessScore !== null && (
          <p className="mt-2 text-sm text-neutral-500">
            {getScoreLabel(readinessScore)}
          </p>
        )}
      </div>

      <div className="cf-card p-5">
        <div className="mb-4 flex size-9 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-200">
          <Package size={18} />
        </div>

        <p className="cf-tech-label text-xs uppercase text-neutral-500">
          Projects
        </p>

        <p className="cf-display-font mt-2 text-4xl font-semibold leading-none text-white">
          {projectsCount}
        </p>

        <p className="mt-2 text-sm text-neutral-500">local repositories</p>
      </div>

      <div className="cf-card p-5">
        <div className="mb-4 flex size-9 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-200">
          <GitBranch size={18} />
        </div>

        <p className="cf-tech-label text-xs uppercase text-neutral-500">
          Task Packs
        </p>

        <p className="cf-display-font mt-2 text-4xl font-semibold leading-none text-white">
          {taskPacksCount}
        </p>

        <p className="mt-2 text-sm text-neutral-500">generated prompts</p>
      </div>

      <div className="cf-card p-5">
        <div className="mb-4 flex size-9 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-200">
          <Bot size={18} />
        </div>

        <p className="cf-tech-label text-xs uppercase text-neutral-500">
          Local AI
        </p>

        <p className="cf-display-font mt-2 text-4xl font-semibold leading-none text-white">
          ON
        </p>

        <p className="mt-2 text-sm text-neutral-500">Ollama workflow</p>
      </div>
    </div>
  );
}