import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  FileText,
  FolderOpen,
  Gauge,
  Search,
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

function normalize(value: unknown) {
  return String(value ?? "").toLowerCase();
}

function getProjectStatus(score: number) {
  if (score >= 80) return "Ready for AI agents";
  if (score >= 50) return "Needs context polish";
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

function getPassedChecks(project: Project) {
  return project.readinessReport.checks.filter((check) => check.passed).length;
}

function getMainIssue(project: Project) {
  return project.readinessReport.issues[0] ?? "No major AI-readiness issues detected.";
}

export function ContextBuilderPage({
  projects,
  isLoading,
  onAddProject,
  onGenerateAgents,
  onCreateTaskPack
}: ContextBuilderPageProps) {
  const [query, setQuery] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(
    projects[0]?.id ?? null
  );

  const filteredProjects = useMemo(() => {
    const normalizedQuery = normalize(query).trim();

    if (!normalizedQuery) {
      return projects;
    }

    return projects.filter((project) => {
      const text = [
        project.name,
        project.localPath,
        project.packageManager,
        project.detectedStack.join(" "),
        project.readinessScore
      ]
        .map(normalize)
        .join(" ");

      return text.includes(normalizedQuery);
    });
  }, [projects, query]);

  const selectedProject = useMemo(() => {
    return (
      projects.find((project) => project.id === selectedProjectId) ??
      filteredProjects[0] ??
      projects[0] ??
      null
    );
  }, [filteredProjects, projects, selectedProjectId]);

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
    <section className="space-y-5">
      <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.012)_48%,rgba(255,255,255,0.006))] p-6 shadow-[0_16px_52px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.045)]">
        <div className="mb-4 flex flex-wrap gap-2">
          <span className="cf-badge">
            <Sparkles size={13} />
            Context Builder
          </span>
          <span className="cf-badge">AGENTS.md</span>
          <span className="cf-badge">Task Pack source</span>
        </div>

        <h2 className="max-w-4xl text-[34px] font-semibold leading-[1.05] tracking-[-0.05em] text-white">
          Build project context before sending tasks to AI coding agents.
        </h2>

        <p className="mt-3 max-w-3xl text-sm leading-6 text-neutral-400">
          Select a scanned repository, review its AI-readiness signals, generate
          AGENTS.md, or start a task-specific prompt pack.
        </p>
      </div>

      <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="cf-card h-fit p-5">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <p className="cf-tech-label mb-2 text-xs uppercase text-neutral-600">
                Projects
              </p>
              <h3 className="text-base font-semibold text-white">
                Select context source
              </h3>
              <p className="mt-1 text-sm text-neutral-500">
                Choose which local repository should become the source for AI context.
              </p>
            </div>

            <span className="cf-badge">{projects.length}</span>
          </div>

          <div className="relative mb-4">
            <Search
              size={15}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-600"
            />

            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search projects..."
              className="h-10 w-full rounded-2xl border border-neutral-900 bg-black/45 pl-10 pr-4 text-sm text-white outline-none transition placeholder:text-neutral-700 hover:border-neutral-800 focus:border-white/40 focus:bg-black/70 focus:ring-4 focus:ring-white/5"
            />
          </div>

          <div className="space-y-2">
            {filteredProjects.map((project) => {
              const isSelected = selectedProject?.id === project.id;

              return (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => setSelectedProjectId(project.id)}
                  className={[
                    "group flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition duration-200",
                    isSelected
                      ? "border-white bg-white text-black shadow-[0_12px_34px_rgba(255,255,255,0.10)]"
                      : "border-neutral-900 bg-black/35 text-neutral-400 hover:border-white hover:bg-white hover:text-black hover:shadow-[0_12px_34px_rgba(255,255,255,0.10)]"
                  ].join(" ")}
                >
                  <span
                    className={[
                      "grid size-9 shrink-0 place-items-center rounded-xl border transition",
                      isSelected
                        ? "border-black/10 bg-black/5 text-black"
                        : "border-neutral-800 bg-neutral-950 text-neutral-500 group-hover:border-black/10 group-hover:bg-black/5 group-hover:text-black"
                    ].join(" ")}
                  >
                    <Bot size={15} />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span
                      className={[
                        "block truncate text-sm font-semibold transition",
                        isSelected ? "text-black" : "text-white group-hover:text-black"
                      ].join(" ")}
                    >
                      {project.name}
                    </span>

                    <span
                      className={[
                        "mt-0.5 block truncate text-xs transition",
                        isSelected
                          ? "text-black/55"
                          : "text-neutral-600 group-hover:text-black/55"
                      ].join(" ")}
                    >
                      AI {project.readinessScore}/100 · {project.packageManager ?? "Unknown"}
                    </span>
                  </span>
                </button>
              );
            })}

            {filteredProjects.length === 0 && (
              <div className="rounded-2xl border border-neutral-900 bg-black/35 p-5 text-center">
                <p className="text-sm font-medium text-white">No matching projects</p>
                <p className="mt-1 text-sm text-neutral-500">
                  Try another project name or stack.
                </p>
              </div>
            )}
          </div>
        </aside>

        {selectedProject && (
          <div className="space-y-5">
            <div className="cf-card p-5">
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
                <div className="min-w-0">
                  <div className="mb-3 flex items-start gap-3">
                    <div className="grid size-11 shrink-0 place-items-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-300">
                      <Bot size={19} />
                    </div>

                    <div className="min-w-0">
                      <h3 className="truncate text-xl font-semibold tracking-[-0.03em] text-white">
                        {selectedProject.name}
                      </h3>

                      <p className="mt-1 truncate text-sm text-neutral-600">
                        {selectedProject.localPath}
                      </p>
                    </div>
                  </div>

                  <div className="mb-5 flex flex-wrap gap-2">
                    {(selectedProject.detectedStack.length > 0
                      ? selectedProject.detectedStack
                      : ["Unknown stack"]
                    ).map((item) => (
                      <span key={item} className="cf-badge">
                        {item}
                      </span>
                    ))}

                    <span className="cf-badge">
                      {selectedProject.packageManager ?? "Unknown package manager"}
                    </span>
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
                      <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                        Readiness
                      </p>
                      <p className="cf-display-font mt-1 text-2xl font-semibold text-white">
                        {selectedProject.readinessScore}/100
                      </p>
                    </div>

                    <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
                      <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                        Checks passed
                      </p>
                      <p className="cf-display-font mt-1 text-2xl font-semibold text-white">
                        {getPassedChecks(selectedProject)}/
                        {selectedProject.readinessReport.checks.length}
                      </p>
                    </div>

                    <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
                      <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                        Issues
                      </p>
                      <p className="cf-display-font mt-1 text-2xl font-semibold text-white">
                        {selectedProject.readinessReport.issues.length}
                      </p>
                    </div>
                  </div>
                </div>

                <aside className="rounded-[1.4rem] border border-neutral-900 bg-black/35 p-4">
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                      <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                        Context readiness
                      </p>

                      <p className="mt-1 text-sm font-medium text-white">
                        {getProjectStatus(selectedProject.readinessScore)}
                      </p>
                    </div>

                    <span className="cf-display-font text-3xl font-semibold leading-none text-white">
                      {selectedProject.readinessScore}
                    </span>
                  </div>

                  <div className="mb-5 rounded-full border border-white/10 bg-black p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.055)]">
                    <div className="cf-health-track">
                      <div
                        className={[
                          "cf-health-fill",
                          getReadinessTone(selectedProject.readinessScore)
                        ].join(" ")}
                        style={{
                          width: getReadinessWidth(selectedProject.readinessScore)
                        }}
                      />
                    </div>
                  </div>

                  <div className="grid gap-2">
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
                      Create Task Pack
                    </Button>
                  </div>
                </aside>
              </div>
            </div>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="cf-card p-5">
                <div className="mb-5 flex items-start justify-between gap-4">
                  <div>
                    <p className="cf-tech-label mb-2 text-xs uppercase text-neutral-600">
                      Readiness checks
                    </p>

                    <h3 className="text-base font-semibold text-white">
                      What ContextForge found
                    </h3>

                    <p className="mt-1 text-sm text-neutral-500">
                      These signals define how safe and useful the generated context will be.
                    </p>
                  </div>

                  <span className="cf-badge">
                    {getPassedChecks(selectedProject)} passed
                  </span>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  {selectedProject.readinessReport.checks.map((check) => (
                    <div
                      key={check.key}
                      className="rounded-2xl border border-neutral-900 bg-black/40 p-4"
                    >
                      <div className="flex items-start gap-3">
                        {check.passed ? (
                          <CheckCircle2
                            size={16}
                            className="mt-0.5 text-emerald-300"
                          />
                        ) : (
                          <XCircle size={16} className="mt-0.5 text-neutral-600" />
                        )}

                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-medium text-white">
                              {check.label}
                            </p>

                            <span className="shrink-0 text-xs text-neutral-600">
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
              </div>

              <aside className="space-y-5">
                <article className="cf-card p-5">
                  <div className="mb-4 flex size-9 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-200">
                    <Gauge size={18} />
                  </div>

                  <p className="cf-tech-label text-xs uppercase text-neutral-500">
                    Main recommendation
                  </p>

                  <p className="mt-3 text-sm leading-6 text-neutral-400">
                    {getMainIssue(selectedProject)}
                  </p>
                </article>

                <article className="cf-card p-5">
                  <div className="mb-4 flex size-9 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-200">
                    <AlertTriangle size={18} />
                  </div>

                  <p className="cf-tech-label text-xs uppercase text-neutral-500">
                    Next best action
                  </p>

                  <p className="mt-3 text-sm leading-6 text-neutral-400">
                    {selectedProject.readinessScore >= 70
                      ? "Generate AGENTS.md first, then create a task-specific Task Pack."
                      : "Improve project context files first, then rescan the project."}
                  </p>
                </article>
              </aside>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}