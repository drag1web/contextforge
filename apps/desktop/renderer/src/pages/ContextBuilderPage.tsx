import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
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

      <motion.p
        key={String(value)}
        initial={{ opacity: 0.55, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={PAGE_TRANSITION}
        className="cf-display-font mt-1 text-2xl font-semibold text-white"
      >
        {value}
      </motion.p>
    </div>
  );
}

function ReadinessCheckCard({
  check,
  index,
  missingLabel,
  selectedProjectId
}: {
  check: Project["readinessReport"]["checks"][number];
  index: number;
  missingLabel: string;
  selectedProjectId: number;
}) {
  return (
    <motion.div
      layout
      transition={{
        layout: {
          duration: 0.2,
          ease: [0.16, 1, 0.3, 1]
        }
      }}
      className="relative overflow-hidden rounded-2xl border border-neutral-900 bg-black/40 p-4"
    >
      <motion.span
        key={`${selectedProjectId}-${check.key}-sweep`}
        aria-hidden="true"
        initial={{ x: "-120%", opacity: 0 }}
        animate={{ x: "140%", opacity: [0, 0.18, 0] }}
        transition={{
          delay: 0.015 * index,
          duration: 0.42,
          ease: [0.16, 1, 0.3, 1]
        }}
        className="pointer-events-none absolute inset-y-0 left-0 w-20 rotate-12 bg-white/20 blur-2xl"
      />

      <div className="relative z-10 flex items-start gap-3">
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
            {check.passed ? check.message : missingLabel}
          </p>
        </div>
      </div>
    </motion.div>
  );
}

export function ContextBuilderPage({
  projects,
  isLoading,
  onAddProject,
  onGenerateAgents,
  onCreateTaskPack
}: ContextBuilderPageProps) {
  const { t } = useTranslation();
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
              <motion.span
                key={`project-card-sweep-${selectedProject.id}`}
                aria-hidden="true"
                initial={{ x: "-120%", opacity: 0 }}
                animate={{ x: "140%", opacity: [0, 0.16, 0] }}
                transition={{
                  duration: 0.48,
                  ease: [0.16, 1, 0.3, 1]
                }}
                className="pointer-events-none absolute inset-y-0 left-0 w-28 rotate-12 bg-white/20 blur-3xl"
              />

              <div className="relative z-10 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
                <div className="min-w-0">
                  <div className="mb-3 flex items-start gap-3">
                    <div className="grid size-11 shrink-0 place-items-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-300">
                      <Bot size={19} />
                    </div>

                    <div className="min-w-0">
                      <motion.h3
                        key={`title-${selectedProject.id}`}
                        initial={{ opacity: 0.65, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={PAGE_TRANSITION}
                        className="truncate text-xl font-semibold tracking-[-0.03em] text-white"
                      >
                        {selectedProject.name}
                      </motion.h3>

                      <motion.p
                        key={`path-${selectedProject.id}`}
                        initial={{ opacity: 0.55, y: 3 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={PAGE_TRANSITION}
                        className="mt-1 truncate text-sm text-neutral-600"
                      >
                        {selectedProject.localPath}
                      </motion.p>
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

                      <motion.p
                        key={`status-${selectedProject.id}`}
                        initial={{ opacity: 0.65, y: 3 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={PAGE_TRANSITION}
                        className="mt-1 text-sm font-medium text-white"
                      >
                        {getProjectStatus(selectedProject.readinessScore, t)}
                      </motion.p>
                    </div>

                    <motion.span
                      key={`score-${selectedProject.id}`}
                      initial={{ opacity: 0.6, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={PAGE_TRANSITION}
                      className="cf-display-font text-3xl font-semibold leading-none text-white"
                    >
                      {selectedProject.readinessScore}
                    </motion.span>
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

                  <motion.span
                    key={`passed-${selectedProject.id}`}
                    initial={{ opacity: 0.6, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={PAGE_TRANSITION}
                    className="cf-badge"
                  >
                    {t("contextBuilder.passed", {
                      count: getPassedChecks(selectedProject)
                    })}
                  </motion.span>
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
                  <motion.span
                    key={`recommendation-sweep-${selectedProject.id}`}
                    aria-hidden="true"
                    initial={{ x: "-120%", opacity: 0 }}
                    animate={{ x: "140%", opacity: [0, 0.13, 0] }}
                    transition={{
                      duration: 0.42,
                      ease: [0.16, 1, 0.3, 1],
                      delay: 0.04
                    }}
                    className="pointer-events-none absolute inset-y-0 left-0 w-20 rotate-12 bg-white/20 blur-2xl"
                  />

                  <div className="relative z-10">
                    <div className="mb-4 flex size-9 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-200">
                      <Gauge size={18} />
                    </div>

                    <p className="cf-tech-label text-xs uppercase text-neutral-500">
                      {t("contextBuilder.mainRecommendation")}
                    </p>

                    <motion.p
                      key={`main-issue-${selectedProject.id}`}
                      initial={{ opacity: 0.55, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={PAGE_TRANSITION}
                      className="mt-3 text-sm leading-6 text-neutral-400"
                    >
                      {getMainIssue(selectedProject, t)}
                    </motion.p>
                  </div>
                </article>

                <article className="cf-card relative overflow-hidden p-5">
                  <motion.span
                    key={`action-sweep-${selectedProject.id}`}
                    aria-hidden="true"
                    initial={{ x: "-120%", opacity: 0 }}
                    animate={{ x: "140%", opacity: [0, 0.13, 0] }}
                    transition={{
                      duration: 0.42,
                      ease: [0.16, 1, 0.3, 1],
                      delay: 0.08
                    }}
                    className="pointer-events-none absolute inset-y-0 left-0 w-20 rotate-12 bg-white/20 blur-2xl"
                  />

                  <div className="relative z-10">
                    <div className="mb-4 flex size-9 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-200">
                      <AlertTriangle size={18} />
                    </div>

                    <p className="cf-tech-label text-xs uppercase text-neutral-500">
                      {t("contextBuilder.nextBestAction")}
                    </p>

                    <motion.p
                      key={`next-action-${selectedProject.id}`}
                      initial={{ opacity: 0.55, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={PAGE_TRANSITION}
                      className="mt-3 text-sm leading-6 text-neutral-400"
                    >
                      {selectedProject.readinessScore >= 70
                        ? t("contextBuilder.readyAction")
                        : t("contextBuilder.improveAction")}
                    </motion.p>
                  </div>
                </article>
              </aside>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}