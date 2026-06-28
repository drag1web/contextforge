import { motion } from "framer-motion";
import {
  ChevronDown,
  ChevronUp,
  FileText,
  FolderKanban,
  Package,
  RefreshCw,
  WandSparkles
} from "lucide-react";

import type { Project } from "../../types";
import { Button } from "../ui/Button";
import { ProjectReadinessReport } from "./ProjectReadinessReport";

interface ProjectCardProps {
  project: Project;
  isExpanded: boolean;
  isLoading: boolean;
  onToggleReport: () => void;
  onRescan: () => void;
  onGenerateAgents: () => void;
  onCreateTaskPack: () => void | Promise<void>;
}

function formatDate(value: string | null) {
  if (!value) {
    return "Never";
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

export function ProjectCard({
  project,
  isExpanded,
  isLoading,
  onToggleReport,
  onRescan,
  onGenerateAgents,
  onCreateTaskPack
}: ProjectCardProps) {
  const issuesCount = project.readinessReport.issues.length;

  return (
    <article className="cf-card cf-card-menu p-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <div className="mb-3 flex items-start gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-300">
              <FolderKanban size={18} />
            </div>

            <div className="min-w-0 flex-1">
              <div className="mb-1 flex min-w-0 items-center gap-2">
                <h5 className="truncate text-base font-semibold text-white">
                  {project.name}
                </h5>

                <span className="cf-badge">
                  {getReadinessLabel(project.readinessScore)}
                </span>
              </div>

              <p className="truncate text-xs text-neutral-600">
                {project.localPath}
              </p>
            </div>
          </div>

          <div className="mb-4 flex flex-wrap gap-2">
            {(project.detectedStack.length > 0 ? project.detectedStack : ["Unknown stack"]).map((item) => (
              <span key={item} className="cf-badge">
                {item}
              </span>
            ))}

            <span className="cf-badge">
              <Package size={12} />
              {project.packageManager ?? "Unknown"}
            </span>

            <span className="cf-badge">
              Last scan: {formatDate(project.lastScanAt)}
            </span>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
              <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                Readiness
              </p>
              <p className="cf-display-font mt-1 text-2xl font-semibold text-white">
                {project.readinessScore}/100
              </p>
            </div>

            <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
              <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                Checks
              </p>
              <p className="cf-display-font mt-1 text-2xl font-semibold text-white">
                {project.readinessReport.checks.length}
              </p>
            </div>

            <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
              <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                Issues
              </p>
              <p className="cf-display-font mt-1 text-2xl font-semibold text-white">
                {issuesCount}
              </p>
            </div>
          </div>
        </div>

        <aside className="rounded-[1.4rem] border border-neutral-900 bg-black/35 p-4">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                AI readiness
              </p>

              <p className="mt-1 text-sm font-medium text-white">
                {getReadinessLabel(project.readinessScore)}
              </p>
            </div>

            <span className="cf-display-font text-3xl font-semibold leading-none text-white">
              {project.readinessScore}
            </span>
          </div>

          <div className="mb-5 rounded-full border border-neutral-800/80 bg-black p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.045)]">
            <div className="cf-health-track">
              <div
                className={["cf-health-fill", getReadinessTone(project.readinessScore)].join(" ")}
                style={{ width: getReadinessWidth(project.readinessScore) }}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Button
              variant="primary"
              disabled={isLoading}
              onClick={onCreateTaskPack}
              className="justify-center rounded-xl"
            >
              <WandSparkles size={15} />
              Create Task Pack
            </Button>

            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              <Button
                variant="secondary"
                disabled={isLoading}
                onClick={onGenerateAgents}
                className="justify-center rounded-xl"
              >
                <FileText size={15} />
                AGENTS.md
              </Button>

              <Button
                variant="secondary"
                disabled={isLoading}
                onClick={onRescan}
                className="justify-center rounded-xl"
              >
                <RefreshCw size={15} />
                Rescan
              </Button>
            </div>

            <button
              type="button"
              onClick={onToggleReport}
              className="cf-invert-action mt-1 flex h-9 items-center justify-center gap-2 rounded-xl px-3 text-sm"
              title={isExpanded ? "Hide readiness report" : "Show readiness report"}
            >
              {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              {isExpanded ? "Hide report" : "Show report"}
            </button>
          </div>
        </aside>
      </div>

      {isExpanded && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          transition={{ duration: 0.22 }}
        >
          <ProjectReadinessReport report={project.readinessReport} />
        </motion.div>
      )}
    </article>
  );
}