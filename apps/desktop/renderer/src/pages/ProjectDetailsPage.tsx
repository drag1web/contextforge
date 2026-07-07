import {
  ArrowLeft,
  FileText,
  FolderKanban,
  Gauge,
  GitBranch,
  Package,
  RefreshCw,
  ShieldCheck,
  WandSparkles
} from "lucide-react";
import type { ReactNode } from "react";

import type { Project } from "../types";
import { Button } from "../components/ui/Button";
import { GitContextCard } from "../components/projects/GitContextCard";
import { GitDiffSummaryCard } from "../components/projects/GitDiffSummaryCard";
import { ProjectReadinessReport } from "../components/projects/ProjectReadinessReport";

interface ProjectDetailsPageProps {
  project: Project;
  isLoading: boolean;
  onBack: () => void;
  onRescan: (project: Project) => void;
  onGenerateAgents: (project: Project) => void;
  onCreateTaskPack: (project: Project) => void | Promise<void>;
  onCreateTaskPackFromChanges: (project: Project) => void | Promise<void>;
}

function formatDate(value: string | null, neverLabel = "Never") {
  if (!value) {
    return neverLabel;
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

function DetailsMetric({
  label,
  value,
  caption,
  icon
}: {
  label: string;
  value: string | number;
  caption: string;
  icon: ReactNode;
}) {
  return (
    <article className="rounded-[1.35rem] border border-neutral-900 bg-black/35 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
          {label}
        </p>
        <div className="grid size-8 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-300">
          {icon}
        </div>
      </div>

      <p className="cf-display-font text-3xl font-semibold leading-none text-white">
        {value}
      </p>
      <p className="mt-2 truncate text-xs text-neutral-600">{caption}</p>
    </article>
  );
}

export function ProjectDetailsPage({
  project,
  isLoading,
  onBack,
  onRescan,
  onGenerateAgents,
  onCreateTaskPack,
  onCreateTaskPackFromChanges
}: ProjectDetailsPageProps) {
  const readinessLabel = getReadinessLabel(project.readinessScore);
  const checksPassed = project.readinessReport.checks.filter((check) => check.passed).length;
  const scriptsCount = Object.keys(project.scripts ?? {}).length;
  const stackItems = project.detectedStack.length > 0 ? project.detectedStack : ["Unknown stack"];

  return (
    <section className="space-y-5">
      <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.012)_48%,rgba(255,255,255,0.006))] p-6 shadow-[0_16px_52px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.045)]">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap gap-2">
              <span className="cf-badge">
                <FolderKanban size={13} />
                Project details
              </span>
              <span className="cf-badge">Local workspace</span>
              <span className="cf-badge">{readinessLabel}</span>
            </div>

            <h2 className="truncate text-[34px] font-semibold leading-[1.05] tracking-[-0.05em] text-white">
              {project.name}
            </h2>
            <p className="mt-3 truncate text-sm text-neutral-500">
              {project.localPath}
            </p>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onBack}>
              <ArrowLeft size={15} />
              Back to projects
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={isLoading}
              onClick={() => onCreateTaskPack(project)}
            >
              <WandSparkles size={15} />
              Create Task Pack
            </Button>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0">
            <div className="mb-4 flex flex-wrap gap-2">
              {stackItems.map((item) => (
                <span key={item} className="cf-badge">
                  {item}
                </span>
              ))}
              <span className="cf-badge">
                <Package size={12} />
                {project.packageManager ?? "Unknown package manager"}
              </span>
              <span className="cf-badge">
                Last scan: {formatDate(project.lastScanAt)}
              </span>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <DetailsMetric
                label="Readiness"
                value={`${project.readinessScore}/100`}
                caption={readinessLabel}
                icon={<Gauge size={15} />}
              />
              <DetailsMetric
                label="Checks"
                value={`${checksPassed}/${project.readinessReport.checks.length}`}
                caption="AI readiness checks passed"
                icon={<ShieldCheck size={15} />}
              />
              <DetailsMetric
                label="Issues"
                value={project.readinessReport.issues.length}
                caption={project.readinessReport.issues.length > 0 ? "Review recommended" : "No major issues"}
                icon={<FileText size={15} />}
              />
              <DetailsMetric
                label="Scripts"
                value={scriptsCount}
                caption="Detected package scripts"
                icon={<Package size={15} />}
              />
            </div>
          </div>

          <aside className="rounded-[1.4rem] border border-neutral-900 bg-black/35 p-4">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                  AI readiness
                </p>
                <p className="mt-1 text-sm font-medium text-white">
                  {readinessLabel}
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
                type="button"
                variant="secondary"
                disabled={isLoading}
                onClick={() => onGenerateAgents(project)}
                className="justify-center rounded-xl"
              >
                <FileText size={15} />
                AGENTS.md
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={isLoading}
                onClick={() => onRescan(project)}
                className="justify-center rounded-xl"
              >
                <RefreshCw size={15} />
                Rescan project
              </Button>
            </div>
          </aside>
        </div>
      </div>

      <div className="grid gap-5 2xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="space-y-5">
          <section className="rounded-[1.6rem] border border-neutral-900 bg-black/25 p-5">
            <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-white">
              <GitBranch size={16} />
              Local changes
            </div>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <p className="max-w-2xl text-sm leading-6 text-neutral-500">
                Current working-tree changes for this project. No GitHub account, cloud sync, commits, or pushes.
              </p>
              <Button
                type="button"
                variant="secondary"
                disabled={isLoading}
                onClick={() => onCreateTaskPackFromChanges(project)}
                className="shrink-0 rounded-xl"
              >
                <GitBranch size={15} />
                Create from changes
              </Button>
            </div>
            <GitContextCard projectId={project.id} enabled />
            <GitDiffSummaryCard projectId={project.id} enabled />
          </section>
        </div>

        <section className="rounded-[1.6rem] border border-neutral-900 bg-black/25 p-5">
          <ProjectReadinessReport report={project.readinessReport} />
        </section>
      </div>
    </section>
  );
}
