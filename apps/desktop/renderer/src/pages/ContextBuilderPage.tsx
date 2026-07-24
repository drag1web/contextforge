import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Bot,
  Brain,
  CheckCircle2,
  ChevronDown,
  Eye,
  FileClock,
  FileText,
  FolderOpen,
  Gauge,
  History,
  LayoutDashboard,
  Search,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  createProjectMemory,
  deleteProjectMemory,
  getProjectContextFiles,
  getProjectMemories,
  updateProjectMemory,
} from "../api/client";
import { ProjectMemoryWorkspace } from "../components/projects/ProjectMemoryWorkspace";
import { Button } from "../components/ui/Button";
import {
  HorizontalSlidingSelector,
  VerticalSlidingSelector,
} from "../components/ui/SlidingSelectors";
import type {
  Project,
  ProjectContextFile,
  ProjectMemory,
  ProjectMemoryInput,
} from "../types";

interface ContextBuilderPageProps {
  projects: Project[];
  isLoading: boolean;
  onAddProject: () => void;
  onGenerateAgents: (project: Project) => void;
  onOpenContextFile: (
    project: Project,
    fileName: ProjectContextFile["fileName"],
  ) => void;
  onCreateTaskPack: (project: Project) => void;
}

type WorkspaceMode = "overview" | "checks" | "memory" | "history";

const PAGE_TRANSITION = {
  duration: 0.18,
  ease: [0.16, 1, 0.3, 1],
} as const;

const PROJECT_ITEM_HEIGHT = 58;
const PROJECT_ITEM_GAP = 8;

function normalize(value: unknown) {
  return String(value ?? "").toLowerCase();
}

type Translate = (key: string, options?: Record<string, unknown>) => string;
type ReadinessCheck = Project["readinessReport"]["checks"][number];

const CHECK_LABEL_KEY_BY_ID: Record<string, string> = {
  readme: "readme",
  agents: "agents",
  "build-script": "buildScript",
  "dev-script": "devScript",
  "test-script": "testScript",
  "env-example": "environmentExample",
  "typescript-config": "typescriptConfig",
  tests: "testsStructure",
  docs: "documentation",
  ci: "ciWorkflow",
};

function getLocalizedCheckLabel(check: ReadinessCheck, t: Translate) {
  const key = CHECK_LABEL_KEY_BY_ID[check.key];
  return key ? t(`contextBuilder.checkLabels.${key}`) : check.label;
}

function getLocalizedCheckMessage(check: ReadinessCheck, t: Translate) {
  const key = CHECK_LABEL_KEY_BY_ID[check.key];
  if (!key) return check.message;

  return t(`contextBuilder.checkMessages.${key}.${check.passed ? "passed" : "missing"}`);
}

function getProjectStatus(score: number, t: (key: string) => string) {
  if (score >= 80) return t("contextBuilder.readyForAgents");
  if (score >= 50) return t("contextBuilder.needsContextPolish");
  return t("contextBuilder.needsAttention");
}

function getPassedChecks(project: Project) {
  return project.readinessReport.checks.filter((check) => check.passed).length;
}

function getMainIssue(project: Project, t: Translate) {
  const firstMissingCheck = project.readinessReport.checks.find((check) => !check.passed);
  if (firstMissingCheck) return getLocalizedCheckMessage(firstMissingCheck, t);
  return t("contextBuilder.noMajorIssues");
}

function getMissingChecks(project: Project) {
  return project.readinessReport.checks.filter((check) => !check.passed);
}

function formatRelativeDate(value: string | null, t: (key: string, options?: Record<string, unknown>) => string) {
  if (!value) return t("contextBuilder.neverScanned");

  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return value;

  const delta = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(delta / 60_000);
  const hours = Math.floor(delta / 3_600_000);
  const days = Math.floor(delta / 86_400_000);

  if (minutes < 1) return t("contextBuilder.justNow");
  if (minutes < 60) return t("contextBuilder.minutesAgo", { count: minutes });
  if (hours < 24) return t("contextBuilder.hoursAgo", { count: hours });
  return t("contextBuilder.daysAgo", { count: days });
}

function formatContextFileSize(sizeBytes: number) {
  if (sizeBytes <= 0) return "0 B";
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  return `${Math.round(sizeBytes / 1024)} KB`;
}

function formatContextFileDate(value: string | null) {
  if (!value) return "—";

  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function ProjectListContent({
  project,
  isSelected,
}: {
  project: Project;
  isSelected: boolean;
}) {
  return (
    <span className="flex h-full items-center gap-3">
      <span
        className={[
          "grid size-9 shrink-0 place-items-center rounded-xl border transition-colors duration-150",
          isSelected
            ? "border-black/10 bg-black/5 text-black"
            : "border-neutral-800 bg-neutral-950 text-neutral-500 group-hover:border-neutral-700 group-hover:text-neutral-300",
        ].join(" ")}
      >
        <Bot size={15} />
      </span>

      <span className="min-w-0 flex-1 text-left">
        <span
          className={[
            "block truncate text-sm font-semibold transition-colors duration-150",
            isSelected ? "text-black" : "text-white",
          ].join(" ")}
        >
          {project.name}
        </span>
        <span
          className={[
            "mt-0.5 block truncate text-xs transition-colors duration-150",
            isSelected ? "text-black/55" : "text-neutral-600",
          ].join(" ")}
        >
          {project.readinessScore}/100 · {project.detectedStack[0] ?? project.packageManager ?? "—"}
        </span>
      </span>
    </span>
  );
}

function ReadinessBar({ score }: { score: number }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-neutral-900">
      <motion.div
        className="h-full rounded-full bg-neutral-200"
        initial={{ width: 0 }}
        animate={{ width: `${Math.max(3, Math.min(100, score))}%` }}
        transition={{ duration: 0.72, ease: [0.16, 1, 0.3, 1] }}
      />
    </div>
  );
}

function ContextHistoryWorkspace({
  files,
  isLoading,
  onGenerateAgents,
  onOpenFile,
}: {
  files: ProjectContextFile[];
  isLoading: boolean;
  onGenerateAgents: () => void;
  onOpenFile: (fileName: ProjectContextFile["fileName"]) => void;
}) {
  const { t } = useTranslation();
  const existingCount = files.filter((file) => file.exists).length;

  return (
    <div className="space-y-4">
      <section className="rounded-[1.6rem] border border-neutral-900 bg-black/35 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="grid size-11 place-items-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-300">
              <History size={18} />
            </span>
            <div>
              <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                {t("contextBuilder.contextHistoryKicker")}
              </p>
              <h3 className="mt-1 text-lg font-semibold tracking-[-0.03em] text-white">
                {t("contextBuilder.contextHistoryTitle")}
              </h3>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-neutral-500">
                {t("contextBuilder.contextHistoryDescription")}
              </p>
            </div>
          </div>

          <Button type="button" variant="primary" disabled={isLoading} onClick={onGenerateAgents}>
            <FileText size={15} />
            {t("contextBuilder.contextHistoryGenerate")}
          </Button>
        </div>

        <div className="mt-5 flex items-center gap-3 text-xs text-neutral-600">
          <span>{t("contextBuilder.contextFilesSaved", { count: existingCount })}</span>
          <span>·</span>
          <span>{t("contextBuilder.contextFilesLocation")}</span>
        </div>
      </section>

      <div className="grid gap-3 lg:grid-cols-2">
        {files.map((file) => (
          <article
            key={file.fileName}
            className={[
              "rounded-[1.5rem] border p-4",
              file.exists
                ? "border-neutral-800 bg-black/40"
                : "border-neutral-900 bg-black/20",
            ].join(" ")}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-300">
                  <FileClock size={16} />
                </span>
                <div className="min-w-0">
                  <h4 className="truncate text-sm font-semibold text-white">{file.fileName}</h4>
                  <p className="mt-1 text-xs text-neutral-600">
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
                >
                  <Eye size={14} />
                  {t("contextBuilder.contextHistoryPreview")}
                </Button>
              ) : null}
            </div>

            <p className="mt-4 text-sm leading-6 text-neutral-500">
              {file.fileName === "AGENTS.md"
                ? t("contextBuilder.agentsFileDescription")
                : t("contextBuilder.generatedAgentsFileDescription")}
            </p>
          </article>
        ))}
      </div>
    </div>
  );
}

export function ContextBuilderPage({
  projects,
  isLoading,
  onAddProject,
  onGenerateAgents,
  onOpenContextFile,
  onCreateTaskPack,
}: ContextBuilderPageProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(projects[0]?.id ?? null);
  const [mode, setMode] = useState<WorkspaceMode>("overview");
  const [expandedCheckKey, setExpandedCheckKey] = useState<string | null>(null);
  const [contextFiles, setContextFiles] = useState<ProjectContextFile[]>([]);
  const [isContextHistoryLoading, setIsContextHistoryLoading] = useState(false);
  const [projectMemories, setProjectMemories] = useState<ProjectMemory[]>([]);
  const [isProjectMemoryLoading, setIsProjectMemoryLoading] = useState(false);

  const filteredProjects = useMemo(() => {
    const normalizedQuery = normalize(query).trim();
    if (!normalizedQuery) return projects;

    return projects.filter((project) =>
      [
        project.name,
        project.localPath,
        project.packageManager,
        project.detectedStack.join(" "),
        project.readinessScore,
      ]
        .map(normalize)
        .join(" ")
        .includes(normalizedQuery),
    );
  }, [projects, query]);

  const selectedProject = useMemo(
    () =>
      projects.find((project) => project.id === selectedProjectId) ??
      filteredProjects[0] ??
      projects[0] ??
      null,
    [filteredProjects, projects, selectedProjectId],
  );

  useEffect(() => {
    if (projects.length === 0) {
      setSelectedProjectId(null);
      return;
    }
    if (selectedProjectId && projects.some((project) => project.id === selectedProjectId)) return;
    setSelectedProjectId(projects[0].id);
  }, [projects, selectedProjectId]);

  useEffect(() => {
    let active = true;
    if (!selectedProject) {
      setContextFiles([]);
      return;
    }

    setIsContextHistoryLoading(true);
    getProjectContextFiles(selectedProject.id)
      .then((files) => active && setContextFiles(files))
      .catch(() => active && setContextFiles([]))
      .finally(() => active && setIsContextHistoryLoading(false));

    return () => {
      active = false;
    };
  }, [selectedProject]);

  useEffect(() => {
    let active = true;
    if (!selectedProject) {
      setProjectMemories([]);
      return;
    }

    setIsProjectMemoryLoading(true);
    getProjectMemories(selectedProject.id)
      .then((memories) => active && setProjectMemories(memories))
      .catch(() => active && setProjectMemories([]))
      .finally(() => active && setIsProjectMemoryLoading(false));

    return () => {
      active = false;
    };
  }, [selectedProject]);

  async function refreshProjectMemories(projectId: number) {
    setProjectMemories(await getProjectMemories(projectId));
  }

  async function handleCreateProjectMemory(input: ProjectMemoryInput) {
    if (!selectedProject) return;
    setIsProjectMemoryLoading(true);
    try {
      await createProjectMemory(selectedProject.id, input);
      await refreshProjectMemories(selectedProject.id);
    } finally {
      setIsProjectMemoryLoading(false);
    }
  }

  async function handleUpdateProjectMemory(memoryId: number, input: Partial<ProjectMemoryInput>) {
    if (!selectedProject) return;
    setIsProjectMemoryLoading(true);
    try {
      await updateProjectMemory(selectedProject.id, memoryId, input);
      await refreshProjectMemories(selectedProject.id);
    } finally {
      setIsProjectMemoryLoading(false);
    }
  }

  async function handleDeleteProjectMemory(memoryId: number) {
    if (!selectedProject) return;
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
        <h3 className="text-base font-medium text-white">{t("contextBuilder.noProjects")}</h3>
        <p className="mt-2 max-w-md text-sm leading-6 text-neutral-500">
          {t("contextBuilder.noProjectsDescription")}
        </p>
        <Button onClick={onAddProject} disabled={isLoading} variant="primary" className="mt-6">
          <FolderOpen size={15} />
          {t("common.addProject")}
        </Button>
      </motion.section>
    );
  }

  const workspaceModes: Array<{ value: WorkspaceMode; label: string; icon: typeof LayoutDashboard }> = [
    { value: "overview", label: t("contextBuilder.modeOverview"), icon: LayoutDashboard },
    { value: "checks", label: t("contextBuilder.modeChecks"), icon: ShieldCheck },
    { value: "memory", label: t("contextBuilder.modeMemory"), icon: Brain },
    { value: "history", label: t("contextBuilder.modeHistory"), icon: History },
  ];

  return (
    <section className="grid h-[calc(100vh-96px)] min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-4 overflow-hidden">
      <motion.header
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={PAGE_TRANSITION}
        className="rounded-[1.75rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.01))] px-5 py-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-300">
              <Gauge size={17} />
            </span>
            <div>
              <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                {t("contextBuilder.workspaceKicker")}
              </p>
              <h2 className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-white">
                {t("contextBuilder.workspaceTitle")}
              </h2>
              <p className="mt-1 text-sm text-neutral-500">
                {t("contextBuilder.workspaceDescription")}
              </p>
            </div>
          </div>

          {selectedProject ? (
            <div className="flex items-center gap-5 rounded-2xl border border-neutral-900 bg-black/35 px-4 py-3">
              <div>
                <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
                  {t("contextBuilder.selectedProject")}
                </p>
                <p className="mt-1 max-w-52 truncate text-sm font-semibold text-white">
                  {selectedProject.name}
                </p>
              </div>
              <div className="h-8 w-px bg-neutral-900" />
              <div className="min-w-36">
                <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
                  {t("contextBuilder.lastScanLabel")}
                </p>
                <p className="mt-1 text-sm font-semibold text-white">
                  {formatRelativeDate(selectedProject.lastScanAt, t)}
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </motion.header>

      <div className="grid min-h-0 gap-4 overflow-hidden xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-[1.6rem] border border-neutral-900 bg-black/35 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                {t("contextBuilder.projects")}
              </p>
              <h3 className="mt-1 text-base font-semibold text-white">
                {t("contextBuilder.selectContextSource")}
              </h3>
            </div>
            <span className="cf-badge">{projects.length}</span>
          </div>

          <div className="relative mt-4">
            <Search
              size={15}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-600"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("contextBuilder.searchProjects")}
              className="h-10 w-full rounded-2xl border border-neutral-900 bg-black/45 pl-10 pr-4 text-sm text-white outline-none transition placeholder:text-neutral-700 hover:border-neutral-800 focus:border-white/40 focus:ring-4 focus:ring-white/5"
            />
          </div>

          <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
            {filteredProjects.length > 0 ? (
              <VerticalSlidingSelector
                items={filteredProjects}
                activeIndex={filteredProjects.findIndex((project) => project.id === selectedProject?.id)}
                getItemKey={(project) => project.id}
                onSelect={(project) => {
                  setSelectedProjectId(project.id);
                  setExpandedCheckKey(null);
                }}
                renderItem={(project, isSelected) => (
                  <ProjectListContent project={project} isSelected={isSelected} />
                )}
                itemHeight={PROJECT_ITEM_HEIGHT}
                itemGap={PROJECT_ITEM_GAP}
                itemSurfaceClassName="rounded-2xl border border-neutral-900 bg-black/35"
                itemClassName="rounded-2xl px-3"
                indicatorClassName="shadow-[0_12px_34px_rgba(255,255,255,0.10)]"
                ariaLabel={t("contextBuilder.selectContextSource")}
              />
            ) : (
              <div className="rounded-2xl border border-neutral-900 bg-black/30 p-5 text-center">
                <p className="text-sm font-medium text-white">{t("contextBuilder.noMatchingProjects")}</p>
                <p className="mt-1 text-sm text-neutral-500">{t("contextBuilder.tryAnotherProject")}</p>
              </div>
            )}
          </div>
        </aside>

        {selectedProject ? (
          <main className="min-h-0 overflow-y-auto pr-1">
            <div className="space-y-4 pb-4">
              <section className="rounded-[1.6rem] border border-neutral-900 bg-black/35 p-5">
                <div className="flex flex-col gap-5 2xl:flex-row 2xl:items-center 2xl:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-start gap-3">
                      <span className="grid size-11 shrink-0 place-items-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-300">
                        <Bot size={18} />
                      </span>
                      <div className="min-w-0">
                        <h3 className="truncate text-xl font-semibold tracking-[-0.03em] text-white">
                          {selectedProject.name}
                        </h3>
                        <p className="mt-1 truncate text-sm text-neutral-600">{selectedProject.localPath}</p>
                        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-600">
                          <span>{selectedProject.detectedStack.slice(0, 4).join(" · ") || t("common.unknownStack")}</span>
                          <span>·</span>
                          <span>{selectedProject.packageManager ?? t("common.unknownPackageManager")}</span>
                          <span>·</span>
                          <span>{t("contextBuilder.lastScan", { time: formatRelativeDate(selectedProject.lastScanAt, t) })}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={isLoading}
                      onClick={() => onGenerateAgents(selectedProject)}
                    >
                      <FileText size={15} />
                      {t("contextBuilder.generateAgents")}
                    </Button>
                    <Button
                      type="button"
                      variant="primary"
                      disabled={isLoading}
                      onClick={() => onCreateTaskPack(selectedProject)}
                    >
                      <Bot size={15} />
                      {t("contextBuilder.createTaskPack")}
                    </Button>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-3">
                  <div className="rounded-2xl border border-neutral-900 bg-black/30 p-3">
                    <p className="cf-tech-label text-[9px] uppercase text-neutral-600">{t("contextBuilder.contextReadiness")}</p>
                    <div className="mt-2 flex items-end justify-between gap-3">
                      <p className="text-xl font-semibold text-white">{selectedProject.readinessScore}/100</p>
                      <p className="text-xs text-neutral-600">{getProjectStatus(selectedProject.readinessScore, t)}</p>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-neutral-900 bg-black/30 p-3">
                    <p className="cf-tech-label text-[9px] uppercase text-neutral-600">{t("contextBuilder.checksPassed")}</p>
                    <p className="mt-2 text-xl font-semibold text-white">
                      {getPassedChecks(selectedProject)}/{selectedProject.readinessReport.checks.length}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-neutral-900 bg-black/30 p-3">
                    <p className="cf-tech-label text-[9px] uppercase text-neutral-600">{t("contextBuilder.memoryActive")}</p>
                    <p className="mt-2 text-xl font-semibold text-white">
                      {projectMemories.filter((memory) => memory.isEnabled).length}
                    </p>
                  </div>
                </div>
              </section>

              <HorizontalSlidingSelector
                items={workspaceModes}
                activeIndex={workspaceModes.findIndex((item) => item.value === mode)}
                getItemKey={(item) => item.value}
                onSelect={(item) => setMode(item.value)}
                renderItem={(item, isActive) => {
                  const Icon = item.icon;
                  return (
                    <span className="flex h-11 items-center justify-center gap-2 px-3 text-sm font-semibold">
                      <Icon size={15} className={isActive ? "text-black" : "text-neutral-600"} />
                      <span>{item.label}</span>
                    </span>
                  );
                }}
                ariaLabel={t("contextBuilder.workspaceModes")}
              />

              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={`${selectedProject.id}-${mode}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={PAGE_TRANSITION}
                >
                  {mode === "overview" ? (
                    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
                      <section className="rounded-[1.6rem] border border-neutral-900 bg-black/35 p-5">
                        <div className="flex items-start gap-3">
                          <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-300">
                            <Gauge size={17} />
                          </span>
                          <div>
                            <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                              {t("contextBuilder.mainRecommendation")}
                            </p>
                            <h3 className="mt-2 text-base font-semibold text-white">
                              {getMainIssue(selectedProject, t)}
                            </h3>
                            <p className="mt-2 text-sm leading-6 text-neutral-500">
                              {selectedProject.readinessScore >= 70
                                ? t("contextBuilder.readyAction")
                                : t("contextBuilder.improveAction")}
                            </p>
                          </div>
                        </div>

                        <div className="mt-5">
                          <div className="flex items-center justify-between gap-3 text-xs">
                            <span className="text-neutral-600">{t("contextBuilder.contextReadiness")}</span>
                            <span className="font-semibold text-white">{selectedProject.readinessScore}%</span>
                          </div>
                          <div className="mt-2"><ReadinessBar score={selectedProject.readinessScore} /></div>
                        </div>
                      </section>

                      <section className="rounded-[1.6rem] border border-neutral-900 bg-black/35 p-5">
                        <div className="flex items-start gap-3">
                          <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-300">
                            <AlertTriangle size={17} />
                          </span>
                          <div>
                            <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                              {t("contextBuilder.attentionSummary")}
                            </p>
                            <h3 className="mt-2 text-base font-semibold text-white">
                              {t("contextBuilder.missingSignals", { count: getMissingChecks(selectedProject).length })}
                            </h3>
                          </div>
                        </div>

                        <div className="mt-4 space-y-2">
                          {getMissingChecks(selectedProject).slice(0, 3).map((check) => (
                            <div key={check.key} className="flex items-center gap-2 text-sm text-neutral-500">
                              <XCircle size={14} className="shrink-0 text-neutral-700" />
                              <span className="truncate">{getLocalizedCheckLabel(check, t)}</span>
                            </div>
                          ))}
                          {getMissingChecks(selectedProject).length === 0 ? (
                            <div className="flex items-center gap-2 text-sm text-neutral-500">
                              <CheckCircle2 size={14} className="text-emerald-300" />
                              {t("contextBuilder.noMajorIssues")}
                            </div>
                          ) : null}
                        </div>

                        <button
                          type="button"
                          onClick={() => setMode("checks")}
                          className="mt-5 text-xs font-semibold text-neutral-400 transition hover:text-white"
                        >
                          {t("contextBuilder.reviewAllChecks")} →
                        </button>
                      </section>
                    </div>
                  ) : null}

                  {mode === "checks" ? (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
                        <div>
                          <h3 className="text-base font-semibold text-white">{t("contextBuilder.readinessChecks")}</h3>
                          <p className="mt-1 text-sm text-neutral-500">{t("contextBuilder.signalsDescription")}</p>
                        </div>
                        <span className="cf-badge">{t("contextBuilder.passed", { count: getPassedChecks(selectedProject) })}</span>
                      </div>

                      <div className="grid gap-2">
                        {selectedProject.readinessReport.checks.map((check) => {
                          const isExpanded = expandedCheckKey === check.key;
                          return (
                            <motion.article
                              layout
                              key={check.key}
                              className="overflow-hidden rounded-2xl border border-neutral-900 bg-black/35"
                            >
                              <button
                                type="button"
                                onClick={() => setExpandedCheckKey(isExpanded ? null : check.key)}
                                className="flex w-full items-center gap-3 px-4 py-3 text-left"
                              >
                                {check.passed ? (
                                  <CheckCircle2 size={16} className="shrink-0 text-emerald-300" />
                                ) : (
                                  <XCircle size={16} className="shrink-0 text-neutral-700" />
                                )}
                                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white">{getLocalizedCheckLabel(check, t)}</span>
                                <span className="text-xs text-neutral-600">{check.passed ? `+${check.points}` : `0/${check.points}`}</span>
                                <ChevronDown
                                  size={15}
                                  className={[
                                    "text-neutral-600 transition-transform duration-200",
                                    isExpanded ? "rotate-180" : "",
                                  ].join(" ")}
                                />
                              </button>

                              <AnimatePresence initial={false}>
                                {isExpanded ? (
                                  <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: "auto", opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    transition={PAGE_TRANSITION}
                                    className="overflow-hidden"
                                  >
                                    <p className="border-t border-neutral-900 px-4 py-3 text-sm leading-6 text-neutral-500">
                                      {getLocalizedCheckMessage(check, t)}
                                    </p>
                                  </motion.div>
                                ) : null}
                              </AnimatePresence>
                            </motion.article>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  {mode === "memory" ? (
                    <ProjectMemoryWorkspace
                      project={selectedProject}
                      memories={projectMemories}
                      isLoading={isLoading || isProjectMemoryLoading}
                      onCreate={handleCreateProjectMemory}
                      onUpdate={handleUpdateProjectMemory}
                      onDelete={handleDeleteProjectMemory}
                    />
                  ) : null}

                  {mode === "history" ? (
                    <ContextHistoryWorkspace
                      files={contextFiles}
                      isLoading={isLoading || isContextHistoryLoading}
                      onGenerateAgents={() => onGenerateAgents(selectedProject)}
                      onOpenFile={(fileName) => onOpenContextFile(selectedProject, fileName)}
                    />
                  ) : null}
                </motion.div>
              </AnimatePresence>
            </div>
          </main>
        ) : null}
      </div>
    </section>
  );
}
