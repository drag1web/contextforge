import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Brain,
  Bot,
  CheckCircle2,
  Eye,
  FileClock,
  FileText,
  FolderOpen,
  Gauge,
  Search,
  Sparkles,
  WandSparkles,
  XCircle
} from "lucide-react";

import type { Project, ProjectContextFile, ProjectMemory, ProjectMemoryInput } from "../types";
import {
  createProjectMemory,
  deleteProjectMemory,
  getProjectContextFiles,
  getProjectMemories,
  updateProjectMemory
} from "../api/client";
import { Button } from "../components/ui/Button";
import { ProjectMemoryModal } from "../components/modals/ProjectMemoryModal";

interface ContextBuilderPageProps {
  projects: Project[];
  isLoading: boolean;
  onAddProject: () => void;
  onGenerateAgents: (project: Project) => void;
  onOpenContextFile: (project: Project, fileName: ProjectContextFile["fileName"]) => void;
  onCreateTaskPack: (project: Project) => void;
}

const PAGE_TRANSITION = {
  duration: 0.18,
  ease: [0.16, 1, 0.3, 1]
} as const;

const ACTIVE_PROJECT_TRANSITION = {
  type: "spring",
  stiffness: 520,
  damping: 42,
  mass: 0.55
} as const;

function normalize(value: unknown) {
  return String(value ?? "").toLowerCase();
}

function getProjectStatus(score: number, t: (key: string) => string) {
  if (score >= 80) return t("contextBuilder.readyForAgents");
  if (score >= 50) return t("contextBuilder.needsContextPolish");
  return t("contextBuilder.needsAttention");
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

function getMainIssue(project: Project, t: (key: string) => string) {
  return project.readinessReport.issues[0] ?? t("contextBuilder.noMajorIssues");
}

function ProjectListButton({
  project,
  isSelected,
  onClick,
  packageManagerLabel
}: {
  project: Project;
  isSelected: boolean;
  onClick: () => void;
  packageManagerLabel: string;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ scale: isSelected ? 1 : 1.01 }}
      whileTap={{ scale: 0.992 }}
      transition={PAGE_TRANSITION}
      className={[
        "group relative flex w-full items-center gap-3 overflow-hidden rounded-2xl border px-3 py-3 text-left transition duration-200",
        isSelected
          ? "border-transparent text-black shadow-[0_12px_34px_rgba(255,255,255,0.10)]"
          : "border-neutral-900 bg-black/35 text-neutral-400 hover:border-white hover:bg-white hover:text-black hover:shadow-[0_12px_34px_rgba(255,255,255,0.10)]"
      ].join(" ")}
    >
      {isSelected && (
        <motion.span
          layoutId="context-builder-active-project"
          className="absolute inset-0 rounded-2xl bg-white"
          transition={ACTIVE_PROJECT_TRANSITION}
        />
      )}

      <span
        className={[
          "relative z-10 grid size-9 shrink-0 place-items-center rounded-xl border transition",
          isSelected
            ? "border-black/10 bg-black/5 text-black"
            : "border-neutral-800 bg-neutral-950 text-neutral-500 group-hover:border-black/10 group-hover:bg-black/5 group-hover:text-black"
        ].join(" ")}
      >
        <Bot size={15} />
      </span>

      <span className="relative z-10 min-w-0 flex-1">
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
          AI {project.readinessScore}/100 ·{" "}
          {project.packageManager ?? packageManagerLabel}
        </span>
      </span>
    </motion.button>
  );
}

function MetricCard({
  label,
  value
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-neutral-900 bg-black/35 p-4">
      <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
        {label}
      </p>

      <p className="cf-display-font mt-1 text-2xl font-semibold text-white">
        {value}
      </p>
    </div>
  );
}

function ReadinessCheckCard({
  check,
  missingLabel
}: {
  check: Project["readinessReport"]["checks"][number];
  index: number;
  missingLabel: string;
  selectedProjectId: number;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-neutral-900 bg-black/40 p-4">
      <div className="flex items-start gap-3">
        {check.passed ? (
          <CheckCircle2 size={16} className="mt-0.5 text-emerald-300" />
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
            {check.passed ? check.message : missingLabel}
          </p>
        </div>
      </div>
    </div>
  );
}

function formatContextFileSize(sizeBytes: number) {
  if (sizeBytes <= 0) {
    return "0 B";
  }

  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  return `${Math.round(sizeBytes / 1024)} KB`;
}

function formatContextFileDate(value: string | null) {
  if (!value) {
    return "not saved yet";
  }

  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function ProjectContextHistory({
  files,
  isLoading,
  t,
  onGenerateAgents,
  onOpenFile
}: {
  files: ProjectContextFile[];
  isLoading: boolean;
  t: (key: string) => string;
  onGenerateAgents: () => void;
  onOpenFile: (fileName: ProjectContextFile["fileName"]) => void;
}) {
  const existingFiles = files.filter((file) => file.exists);

  return (
    <article className="cf-card p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="cf-tech-label mb-2 text-xs uppercase text-neutral-600">
            {t("contextBuilder.contextHistoryKicker")}
          </p>

          <h3 className="text-base font-semibold text-white">
            {t("contextBuilder.contextHistoryTitle")}
          </h3>

          <p className="mt-1 text-sm leading-5 text-neutral-500">
            {t("contextBuilder.contextHistoryDescription")}
          </p>
        </div>

        <span className="cf-badge">{existingFiles.length}</span>
      </div>

      <div className="space-y-2">
        {files.map((file) => (
          <div
            key={file.fileName}
            className={[
              "rounded-2xl border p-3 transition",
              file.exists
                ? "border-neutral-800 bg-black/35"
                : "border-neutral-900 bg-black/20 opacity-75"
            ].join(" ")}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-300">
                  <FileClock size={16} />
                </span>

                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">
                    {file.fileName}
                  </p>

                  <p className="mt-1 truncate text-xs text-neutral-600">
                    {file.exists
                      ? `${formatContextFileSize(file.sizeBytes)} · ${formatContextFileDate(file.updatedAt)}`
                      : t("contextBuilder.contextHistoryNotGenerated")}
                  </p>
                </div>
              </div>

              {file.exists ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={isLoading}
                  onClick={() => onOpenFile(file.fileName)}
                  className="shrink-0 rounded-xl"
                >
                  <Eye size={14} />
                  {t("contextBuilder.contextHistoryPreview")}
                </Button>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <Button
        type="button"
        variant="secondary"
        disabled={isLoading}
        onClick={onGenerateAgents}
        className="mt-4 w-full justify-center rounded-xl"
      >
        <FileText size={15} />
        {t("contextBuilder.contextHistoryGenerate")}
      </Button>
    </article>
  );
}

function getProjectMemoryCategoryLabel(category: ProjectMemory["category"]) {
  switch (category) {
    case "architecture":
      return "Architecture";
    case "do_not_change":
      return "Do not change";
    case "style":
      return "Style";
    case "verification":
      return "Verification";
    case "workflow":
      return "Workflow";
    default:
      return "Custom";
  }
}

function ProjectMemoryPanel({
  memories,
  isLoading,
  onManage
}: {
  memories: ProjectMemory[];
  isLoading: boolean;
  onManage: () => void;
}) {
  const activeMemories = memories.filter((memory) => memory.isEnabled);
  const previewMemories = activeMemories.slice(0, 3);

  return (
    <article className="cf-card p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="cf-tech-label mb-2 text-xs uppercase text-neutral-600">
            Project Memory
          </p>

          <h3 className="text-base font-semibold text-white">
            Decision Log
          </h3>

          <p className="mt-1 text-sm leading-5 text-neutral-500">
            Persistent project rules automatically included in future Task Packs.
          </p>
        </div>

        <span className="cf-badge">{activeMemories.length} active</span>
      </div>

      <div className="space-y-2">
        {previewMemories.length === 0 ? (
          <div className="rounded-2xl border border-neutral-900 bg-black/25 p-4">
            <div className="mb-3 grid size-9 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-300">
              <Brain size={16} />
            </div>
            <p className="text-sm font-medium text-white">No active memory yet</p>
            <p className="mt-1 text-sm leading-5 text-neutral-600">
              Save decisions like “do not change backend API” or “verify with npm run build”.
            </p>
          </div>
        ) : (
          previewMemories.map((memory) => (
            <div
              key={memory.id}
              className="rounded-2xl border border-neutral-900 bg-black/35 p-3"
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="cf-badge">
                  {getProjectMemoryCategoryLabel(memory.category)}
                </span>
              </div>

              <p className="truncate text-sm font-semibold text-white">
                {memory.title}
              </p>
              <p className="mt-1 line-clamp-2 text-sm leading-5 text-neutral-600">
                {memory.content}
              </p>
            </div>
          ))
        )}
      </div>

      <Button
        type="button"
        variant="secondary"
        disabled={isLoading}
        onClick={onManage}
        className="mt-4 w-full justify-center rounded-xl"
      >
        <Brain size={15} />
        Manage memory
      </Button>
    </article>
  );
}

export function ContextBuilderPage({
  projects,
  isLoading,
  onAddProject,
  onGenerateAgents,
  onOpenContextFile,
  onCreateTaskPack
}: ContextBuilderPageProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(
    projects[0]?.id ?? null
  );
  const [contextFiles, setContextFiles] = useState<ProjectContextFile[]>([]);
  const [isContextHistoryLoading, setIsContextHistoryLoading] = useState(false);
  const [projectMemories, setProjectMemories] = useState<ProjectMemory[]>([]);
  const [isProjectMemoryLoading, setIsProjectMemoryLoading] = useState(false);
  const [isProjectMemoryModalOpen, setIsProjectMemoryModalOpen] = useState(false);

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

  const activeProjectMemories = useMemo(
    () => projectMemories.filter((memory) => memory.isEnabled),
    [projectMemories]
  );

  useEffect(() => {
    if (projects.length === 0) {
      setSelectedProjectId(null);
      return;
    }

    if (selectedProjectId && projects.some((project) => project.id === selectedProjectId)) {
      return;
    }

    setSelectedProjectId(projects[0].id);
  }, [projects, selectedProjectId]);

  useEffect(() => {
    let isMounted = true;

    if (!selectedProject) {
      setContextFiles([]);
      return;
    }

    setIsContextHistoryLoading(true);

    getProjectContextFiles(selectedProject.id)
      .then((files) => {
        if (isMounted) {
          setContextFiles(files);
        }
      })
      .catch(() => {
        if (isMounted) {
          setContextFiles([]);
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsContextHistoryLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [selectedProject]);

  useEffect(() => {
    let isMounted = true;

    if (!selectedProject) {
      setProjectMemories([]);
      return;
    }

    setIsProjectMemoryLoading(true);

    getProjectMemories(selectedProject.id)
      .then((memories) => {
        if (isMounted) {
          setProjectMemories(memories);
        }
      })
      .catch(() => {
        if (isMounted) {
          setProjectMemories([]);
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsProjectMemoryLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [selectedProject]);

  async function refreshProjectMemories(projectId: number) {
    const memories = await getProjectMemories(projectId);
    setProjectMemories(memories);
  }

  async function handleCreateProjectMemory(input: ProjectMemoryInput) {
    if (!selectedProject) {
      return;
    }

    setIsProjectMemoryLoading(true);
    try {
      await createProjectMemory(selectedProject.id, input);
      await refreshProjectMemories(selectedProject.id);
    } finally {
      setIsProjectMemoryLoading(false);
    }
  }

  async function handleUpdateProjectMemory(
    memoryId: number,
    input: Partial<ProjectMemoryInput>
  ) {
    if (!selectedProject) {
      return;
    }

    setIsProjectMemoryLoading(true);
    try {
      await updateProjectMemory(selectedProject.id, memoryId, input);
      await refreshProjectMemories(selectedProject.id);
    } finally {
      setIsProjectMemoryLoading(false);
    }
  }

  async function handleDeleteProjectMemory(memoryId: number) {
    if (!selectedProject) {
      return;
    }

    setIsProjectMemoryLoading(true);
    try {
      await deleteProjectMemory(selectedProject.id, memoryId);
      await refreshProjectMemories(selectedProject.id);
    } finally {
      setIsProjectMemoryLoading(false);
    }
  }

  if (projects.length === 0) {
    return (
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={PAGE_TRANSITION}
        className="cf-card flex min-h-80 flex-col items-center justify-center p-8 text-center"
      >
        <div className="mb-5 flex size-12 items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-300">
          <FolderOpen size={22} />
        </div>

        <h3 className="text-base font-medium text-white">
          {t("contextBuilder.noProjects")}
        </h3>

        <p className="mt-2 max-w-md text-sm leading-6 text-neutral-500">
          {t("contextBuilder.noProjectsDescription")}
        </p>

        <Button
          onClick={onAddProject}
          disabled={isLoading}
          variant="primary"
          className="mt-6"
        >
          <FolderOpen size={15} />
          {t("common.addProject")}
        </Button>
      </motion.section>
    );
  }

  return (
    <>
      <section className="space-y-5">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={PAGE_TRANSITION}
        className="overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.012)_48%,rgba(255,255,255,0.006))] p-6 shadow-[0_16px_52px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.045)]"
      >
        <div className="mb-4 flex flex-wrap gap-2">
          <span className="cf-badge">
            <Sparkles size={13} />
            {t("contextBuilder.badge")}
          </span>
          <span className="cf-badge">AGENTS.md</span>
          <span className="cf-badge">
            {t("contextBuilder.taskPackSource")}
          </span>
        </div>

        <h2 className="max-w-4xl text-[34px] font-semibold leading-[1.05] tracking-[-0.05em] text-white">
          {t("contextBuilder.title")}
        </h2>

        <p className="mt-3 max-w-3xl text-sm leading-6 text-neutral-400">
          {t("contextBuilder.description")}
        </p>
      </motion.div>

      <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="cf-card h-fit p-5">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <p className="cf-tech-label mb-2 text-xs uppercase text-neutral-600">
                {t("contextBuilder.projects")}
              </p>

              <h3 className="text-base font-semibold text-white">
                {t("contextBuilder.selectContextSource")}
              </h3>

              <p className="mt-1 text-sm text-neutral-500">
                {t("contextBuilder.selectContextSourceDescription")}
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
              placeholder={t("contextBuilder.searchProjects")}
              className="h-10 w-full rounded-2xl border border-neutral-900 bg-black/45 pl-10 pr-4 text-sm text-white outline-none transition placeholder:text-neutral-700 hover:border-neutral-800 focus:border-white/40 focus:bg-black/70 focus:ring-4 focus:ring-white/5"
            />
          </div>

          <div className="space-y-2">
            {filteredProjects.map((project) => {
              const isSelected = selectedProject?.id === project.id;

              return (
                <ProjectListButton
                  key={project.id}
                  project={project}
                  isSelected={isSelected}
                  packageManagerLabel={t("common.unknown")}
                  onClick={() => setSelectedProjectId(project.id)}
                />
              );
            })}

            {filteredProjects.length === 0 && (
              <div className="rounded-2xl border border-neutral-900 bg-black/35 p-5 text-center">
                <p className="text-sm font-medium text-white">
                  {t("contextBuilder.noMatchingProjects")}
                </p>

                <p className="mt-1 text-sm text-neutral-500">
                  {t("contextBuilder.tryAnotherProject")}
                </p>
              </div>
            )}
          </div>
        </aside>

        {selectedProject && (
          <div className="space-y-5">
            <div className="cf-card relative overflow-hidden p-5">
              <div className="relative z-10 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
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
                      : [t("common.unknownStack")]
                    ).map((item) => (
                      <span key={item} className="cf-badge">
                        {item}
                      </span>
                    ))}

                    <span className="cf-badge">
                      {selectedProject.packageManager ??
                        t("common.unknownPackageManager")}
                    </span>
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    <MetricCard
                      label={t("contextBuilder.readiness")}
                      value={`${selectedProject.readinessScore}/100`}
                    />

                    <MetricCard
                      label={t("contextBuilder.checksPassed")}
                      value={`${getPassedChecks(selectedProject)}/${selectedProject.readinessReport.checks.length}`}
                    />

                    <MetricCard
                      label={t("contextBuilder.issues")}
                      value={selectedProject.readinessReport.issues.length}
                    />
                  </div>
                </div>

                <aside className="rounded-[1.4rem] border border-neutral-900 bg-black/35 p-4">
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                      <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                        {t("contextBuilder.contextReadiness")}
                      </p>

                      <p className="mt-1 text-sm font-medium text-white">
                        {getProjectStatus(selectedProject.readinessScore, t)}
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
                      {t("contextBuilder.generateAgents")}
                    </Button>

                    <Button
                      variant="secondary"
                      disabled={isLoading}
                      onClick={() => onCreateTaskPack(selectedProject)}
                      className="justify-center rounded-xl"
                    >
                      <WandSparkles size={15} />
                      {t("contextBuilder.createTaskPack")}
                    </Button>

                    <Button
                      variant="secondary"
                      disabled={isLoading || isProjectMemoryLoading}
                      onClick={() => setIsProjectMemoryModalOpen(true)}
                      className="justify-center rounded-xl"
                    >
                      <Brain size={15} />
                      Project Memory
                      <span className="ml-1 rounded-full border border-neutral-800 bg-black/35 px-2 py-0.5 text-[11px] text-neutral-500">
                        {activeProjectMemories.length} active
                      </span>
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
                      {t("contextBuilder.readinessChecks")}
                    </p>

                    <h3 className="text-base font-semibold text-white">
                      {t("contextBuilder.whatFound")}
                    </h3>

                    <p className="mt-1 text-sm text-neutral-500">
                      These signals define how safe and useful the generated context will be.
                    </p>
                  </div>

                  <span className="cf-badge">
                    {t("contextBuilder.passed", {
                      count: getPassedChecks(selectedProject)
                    })}
                  </span>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  {selectedProject.readinessReport.checks.map((check, index) => (
                    <ReadinessCheckCard
                      key={check.key}
                      check={check}
                      index={index}
                      selectedProjectId={selectedProject.id}
                      missingLabel={t("contextBuilder.missing")}
                    />
                  ))}
                </div>
              </div>

              <aside className="space-y-5">
                <article className="cf-card relative overflow-hidden p-5">
                  <div className="relative z-10">
                    <div className="mb-4 flex size-9 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-200">
                      <Gauge size={18} />
                    </div>

                    <p className="cf-tech-label text-xs uppercase text-neutral-500">
                      {t("contextBuilder.mainRecommendation")}
                    </p>

                    <p className="mt-3 text-sm leading-6 text-neutral-400">
                      {getMainIssue(selectedProject, t)}
                    </p>
                  </div>
                </article>

                <article className="cf-card relative overflow-hidden p-5">
                  <div className="relative z-10">
                    <div className="mb-4 flex size-9 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-200">
                      <AlertTriangle size={18} />
                    </div>

                    <p className="cf-tech-label text-xs uppercase text-neutral-500">
                      {t("contextBuilder.nextBestAction")}
                    </p>

                    <p className="mt-3 text-sm leading-6 text-neutral-400">
                      {selectedProject.readinessScore >= 70
                        ? t("contextBuilder.readyAction")
                        : t("contextBuilder.improveAction")}
                    </p>
                  </div>
                </article>

                <ProjectMemoryPanel
                  memories={projectMemories}
                  isLoading={isLoading || isProjectMemoryLoading}
                  onManage={() => setIsProjectMemoryModalOpen(true)}
                />

                <ProjectContextHistory
                  files={contextFiles}
                  isLoading={isLoading || isContextHistoryLoading}
                  t={t}
                  onGenerateAgents={() => onGenerateAgents(selectedProject)}
                  onOpenFile={(fileName) => onOpenContextFile(selectedProject, fileName)}
                />
              </aside>
            </div>
          </div>
        )}
      </div>
    </section>
      {selectedProject && isProjectMemoryModalOpen && (
        <ProjectMemoryModal
          project={selectedProject}
          memories={projectMemories}
          isLoading={isLoading || isProjectMemoryLoading}
          onClose={() => setIsProjectMemoryModalOpen(false)}
          onCreate={handleCreateProjectMemory}
          onUpdate={handleUpdateProjectMemory}
          onDelete={handleDeleteProjectMemory}
        />
      )}
    </>
  );
}