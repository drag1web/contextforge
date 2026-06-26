import { motion } from "framer-motion";
import { CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import type { Project } from "../../types";
import { DropdownMenu } from "../ui/DropdownMenu";
import { IconButton } from "../ui/IconButton";
import { ProjectReadinessReport } from "./ProjectReadinessReport";

interface ProjectCardProps {
  project: Project;
  isExpanded: boolean;
  isLoading: boolean;
  onToggleReport: () => void;
  onRescan: () => void;
  onGenerateAgents: () => void;
  onCreateTaskPack: () => void;
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
  return (
    <article className="cf-card cf-card-menu p-4">
      <div className="flex items-start justify-between gap-5">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center gap-2">
            <CheckCircle2 size={15} className="shrink-0 text-neutral-300" />

            <h5 className="truncate text-sm font-medium text-white">
              {project.name}
            </h5>
          </div>

          <p className="truncate text-xs text-neutral-500">
            {project.localPath}
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            {project.detectedStack.map((item) => (
              <span key={item} className="cf-badge">
                {item}
              </span>
            ))}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div className="hidden items-center gap-2 lg:flex">
            <span className="inline-flex h-8 items-center rounded-lg border border-neutral-900 bg-neutral-950/70 px-3 text-xs font-medium text-neutral-200">
              AI {project.readinessScore}/100
            </span>

            <span className="inline-flex h-8 items-center rounded-lg border border-neutral-900 bg-neutral-950/70 px-3 text-xs text-neutral-400">
              {project.packageManager ?? "Unknown"}
            </span>
          </div>

          <IconButton
            type="button"
            onClick={onToggleReport}
            title={isExpanded ? "Hide readiness report" : "Show readiness report"}
          >
            {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </IconButton>

          <DropdownMenu
            actions={[
              {
                label: "Generate AGENTS.md",
                onClick: onGenerateAgents,
                disabled: isLoading
              },
              {
                label: "Create task pack",
                onClick: onCreateTaskPack,
                disabled: isLoading
              },
              {
                label: "Rescan project",
                onClick: onRescan,
                disabled: isLoading
              }
            ]}
          />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 lg:hidden">
        <span className="cf-badge">AI {project.readinessScore}/100</span>
        <span className="cf-badge">{project.packageManager ?? "Unknown"}</span>
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