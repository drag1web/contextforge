import { FolderOpen } from "lucide-react";
import type { Project } from "../../types";
import { Button } from "../ui/Button";
import { ProjectCard } from "./ProjectCard";

interface ProjectsSectionProps {
  projects: Project[];
  expandedProjectId: number | null;
  isLoading: boolean;
  onAddProject: () => void;
  onToggleProject: (projectId: number) => void;
  onRescanProject: (project: Project) => void;
  onGenerateAgents: (project: Project) => void;
  onCreateTaskPack: (project: Project) => void | Promise<void>;
}

export function ProjectsSection({
  projects,
  expandedProjectId,
  isLoading,
  onAddProject,
  onToggleProject,
  onRescanProject,
  onGenerateAgents,
  onCreateTaskPack
}: ProjectsSectionProps) {
  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h4 className="text-sm font-medium text-white">Projects</h4>
          <p className="mt-1 text-sm text-neutral-500">
            Scanned local repositories and detected AI-ready context.
          </p>
        </div>
      </div>

      {projects.length === 0 ? (
        <div className="cf-card flex min-h-52 flex-col items-center justify-center p-8 text-center">
          <div className="mb-5 flex size-12 items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-300">
            <FolderOpen size={22} />
          </div>

          <h5 className="text-base font-medium text-white">No projects yet</h5>
          <p className="mt-2 max-w-md text-sm leading-6 text-neutral-500">
            Add your first local project to scan its structure, detect stack,
            and prepare it for AI agents.
          </p>

          <Button
            onClick={onAddProject}
            disabled={isLoading}
            variant="secondary"
            className="mt-6"
          >
            <FolderOpen size={16} />
            Select folder
          </Button>
        </div>
      ) : (
        <div className="grid gap-4">
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              isExpanded={expandedProjectId === project.id}
              isLoading={isLoading}
              onToggleReport={() => onToggleProject(project.id)}
              onRescan={() => onRescanProject(project)}
              onGenerateAgents={() => onGenerateAgents(project)}
              onCreateTaskPack={() => onCreateTaskPack(project)}
            />
          ))}
        </div>
      )}
    </section>
  );
}