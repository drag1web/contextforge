import { useMemo, useState } from "react";
import {
  Bot,
  CheckCircle2,
  FileText,
  FolderOpen,
  Sparkles,
  WandSparkles,
  XCircle
} from "lucide-react";
import type { Project } from "../types";
import { Button } from "../components/ui/Button";

interface ContextBuilderPageProps {
  projects: Project[];
  isLoading: boolean;
  onAddProject: () => void;
  onGenerateAgents: (project: Project) => void;
  onCreateTaskPack: (project: Project) => void;
}

function getProjectStatus(score: number) {
  if (score >= 80) return "Ready for AI agents";
  if (score >= 60) return "Mostly ready";
  if (score >= 40) return "Needs context improvements";
  return "Not ready yet";
}

export function ContextBuilderPage({
  projects,
  isLoading,
  onAddProject,
  onGenerateAgents,
  onCreateTaskPack
}: ContextBuilderPageProps) {
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(
    projects[0]?.id ?? null
  );

  const selectedProject = useMemo(() => {
    return projects.find((project) => project.id === selectedProjectId) ?? projects[0] ?? null;
  }, [projects, selectedProjectId]);

  if (projects.length === 0) {
    return (
      <section className="cf-card flex min-h-80 flex-col items-center justify-center p-8 text-center">
        <div className="mb-5 flex size-12 items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-300">
          <FolderOpen size={22} />
        </div>

        <h3 className="text-base font-medium text-white">No projects available</h3>

        <p className="mt-2 max-w-md text-sm leading-6 text-neutral-500">
          Add a local project first. ContextForge will scan it, detect the stack,
          and prepare AI-ready context files.
        </p>

        <Button
          onClick={onAddProject}
          disabled={isLoading}
          variant="primary"
          className="mt-6"
        >
          <FolderOpen size={15} />
          Add project
        </Button>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="cf-card p-6">
        <div className="flex items-start justify-between gap-8">
          <div>
            <p className="cf-badge mb-4">
              <Sparkles size={13} />
              Context Builder
            </p>

            <h3 className="max-w-3xl text-3xl font-semibold tracking-[-0.04em] text-white">
              Build project context for Codex, Cursor, Claude Code and other AI agents.
            </h3>

            <p className="mt-4 max-w-2xl text-sm leading-6 text-neutral-400">
              Generate AGENTS.md, prepare task-specific prompts, and turn project
              structure into instructions AI tools can safely follow.
            </p>
          </div>

          <div className="hidden rounded-2xl border border-neutral-900 bg-black/40 p-4 md:block">
            <p className="text-[10px] uppercase tracking-[0.22em] text-neutral-600">
              Available projects
            </p>
            <p className="mt-2 text-2xl font-semibold text-white">{projects.length}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="cf-card h-fit p-4">
          <div className="mb-4">
            <p className="text-sm font-medium text-white">Projects</p>
            <p className="mt-1 text-sm text-neutral-500">
              Select a project to build AI context.
            </p>
          </div>

          <div className="space-y-2">
            {projects.map((project) => {
              const isSelected = selectedProject?.id === project.id;

              return (
                <button
                  key={project.id}
                  onClick={() => setSelectedProjectId(project.id)}
                  className={[
                    "w-full rounded-xl border px-3 py-3 text-left transition",
                    isSelected
                      ? "border-neutral-700 bg-neutral-950 text-white"
                      : "border-neutral-900 bg-black/30 text-neutral-400 hover:border-neutral-800 hover:text-white"
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm font-medium">{project.name}</span>
                    <span className="shrink-0 text-xs text-neutral-500">
                      {project.readinessScore}/100
                    </span>
                  </div>

                  <p className="mt-1 truncate text-xs text-neutral-600">
                    {project.localPath}
                  </p>
                </button>
              );
            })}
          </div>
        </aside>

        {selectedProject && (
          <div className="space-y-6">
            <div className="cf-card p-6">
              <div className="flex items-start justify-between gap-8">
                <div className="min-w-0">
                  <div className="mb-2 flex items-center gap-2">
                    <Bot size={16} className="text-neutral-300" />
                    <h4 className="truncate text-base font-medium text-white">
                      {selectedProject.name}
                    </h4>
                  </div>

                  <p className="truncate text-sm text-neutral-500">
                    {selectedProject.localPath}
                  </p>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {selectedProject.detectedStack.map((item) => (
                      <span key={item} className="cf-badge">
                        {item}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="shrink-0 text-right">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-neutral-600">
                    AI Readiness
                  </p>

                  <p className="mt-2 text-3xl font-semibold text-white">
                    {selectedProject.readinessScore}/100
                  </p>

                  <p className="mt-1 text-sm text-neutral-500">
                    {getProjectStatus(selectedProject.readinessScore)}
                  </p>
                </div>
              </div>

              <div className="mt-6 grid gap-3 md:grid-cols-2">
                <Button
                  variant="primary"
                  disabled={isLoading}
                  onClick={() => onGenerateAgents(selectedProject)}
                  className="justify-center rounded-xl"
                >
                  <FileText size={15} />
                  Generate AGENTS.md
                </Button>

                <Button
                  variant="secondary"
                  disabled={isLoading}
                  onClick={() => onCreateTaskPack(selectedProject)}
                  className="justify-center rounded-xl"
                >
                  <WandSparkles size={15} />
                  Create task pack
                </Button>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {selectedProject.readinessReport.checks.map((check) => (
                <div
                  key={check.key}
                  className="rounded-2xl border border-neutral-900 bg-black/50 p-4"
                >
                  <div className="flex items-start gap-3">
                    {check.passed ? (
                      <CheckCircle2 size={16} className="mt-0.5 text-emerald-400" />
                    ) : (
                      <XCircle size={16} className="mt-0.5 text-neutral-600" />
                    )}

                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-white">
                          {check.label}
                        </p>

                        <span className="text-xs text-neutral-600">
                          {check.passed ? `+${check.points}` : `0/${check.points}`}
                        </span>
                      </div>

                      <p className="mt-1 text-sm leading-5 text-neutral-500">
                        {check.passed ? check.message : "Missing or not detected."}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="cf-card p-5">
              <p className="mb-3 text-sm font-medium text-white">
                Recommended improvements
              </p>

              {selectedProject.readinessReport.issues.length > 0 ? (
                <ul className="space-y-2">
                  {selectedProject.readinessReport.issues.map((issue) => (
                    <li key={issue} className="text-sm leading-5 text-neutral-500">
                      • {issue}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-neutral-500">
                  No major AI-readiness issues detected.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}