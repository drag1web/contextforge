import { Gauge, GitBranch, Package } from "lucide-react";
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
    <div className="grid grid-cols-3 gap-4">
      <div className="cf-card p-5">
        <div className="mb-4 flex size-9 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-200">
          <Gauge size={18} />
        </div>
        <p className="text-sm text-neutral-500">AI Readiness</p>
        <p className="mt-2 text-2xl font-semibold tracking-tight text-white">
          {readinessScore ?? "—"}
        </p>
        {readinessScore !== null && (
          <p className="mt-1 text-sm text-neutral-500">{getScoreLabel(readinessScore)}</p>
        )}
      </div>

      <div className="cf-card p-5">
        <div className="mb-4 flex size-9 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-200">
          <Package size={18} />
        </div>
        <p className="text-sm text-neutral-500">Projects</p>
        <p className="mt-2 text-2xl font-semibold tracking-tight text-white">
          {projectsCount}
        </p>
      </div>

      <div className="cf-card p-5">
        <div className="mb-4 flex size-9 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-200">
          <GitBranch size={18} />
        </div>
        <p className="text-sm text-neutral-500">Task Packs</p>
        <p className="mt-2 text-2xl font-semibold tracking-tight text-white">
          {taskPacksCount}
        </p>
      </div>
    </div>
  );
}