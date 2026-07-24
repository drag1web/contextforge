import { useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  FolderOpen,
  Gauge,
  Search,
  SlidersHorizontal,
  X
} from "lucide-react";

import type { Project } from "../../types";
import { WorkspacePageHeader } from "../layout/WorkspacePageHeader";
import { Button } from "../ui/Button";
import { HorizontalSlidingSelector } from "../ui/SlidingSelectors";
import {
  CustomSelect,
  type SelectOption
} from "../ui/CustomSelect";
import { ProjectCard } from "./ProjectCard";

interface ProjectsSectionProps {
  projects: Project[];
  isLoading: boolean;
  onAddProject: () => void;
  onRescanProject: (project: Project) => void;
  onGenerateAgents: (project: Project) => void;
  onCreateTaskPack: (project: Project) => void | Promise<void>;
  onOpenProjectDetails: (project: Project) => void;
}

type ReadinessFilter = "all" | "low" | "medium" | "high";
type SortMode = "lastScan" | "readinessLow" | "readinessHigh" | "name";

interface ReadinessOption {
  value: ReadinessFilter;
  label: string;
  description: string;
}

const PROJECT_CARD_TRANSITION = {
  duration: 0.22,
  ease: [0.16, 1, 0.3, 1]
} as const;

function normalize(value: unknown) {
  return String(value ?? "").toLowerCase();
}

function getAverageReadiness(projects: Project[]) {
  if (projects.length === 0) {
    return null;
  }

  const total = projects.reduce((sum, project) => sum + project.readinessScore, 0);

  return Math.round(total / projects.length);
}

function getDateValue(project: Project) {
  return new Date(
    project.lastScanAt ?? project.updatedAt ?? project.createdAt
  ).getTime();
}

function getReadinessLabel(score: number) {
  if (score >= 80) return "High";
  if (score >= 50) return "Medium";
  return "Low";
}

function WorkspaceStat({
  icon,
  label,
  value
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <div className="min-w-0 p-4 lg:border-l lg:border-neutral-900 lg:first:border-l-0">
      <div className="mb-3 flex items-center gap-2 text-neutral-600">
        {icon}
        <span className="cf-tech-label truncate text-[10px] uppercase">{label}</span>
      </div>
      <p className="cf-display-font truncate text-3xl font-semibold leading-none text-white">
        {value}
      </p>
    </div>
  );
}

export function ProjectsSection({
  projects,
  isLoading,
  onAddProject,
  onRescanProject,
  onGenerateAgents,
  onCreateTaskPack,
  onOpenProjectDetails
}: ProjectsSectionProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [readinessFilter, setReadinessFilter] = useState<ReadinessFilter>("all");
  const [stackFilter, setStackFilter] = useState("all");
  const [packageFilter, setPackageFilter] = useState("all");
  const [sortMode, setSortMode] = useState<SortMode>("lastScan");

  const readinessOptions = useMemo<ReadinessOption[]>(
    () => [
      {
        value: "all",
        label: t("projectsPage.all"),
        description: t("projectsPage.everyProject")
      },
      {
        value: "low",
        label: t("projectsPage.low"),
        description: t("projectsPage.below50")
      },
      {
        value: "medium",
        label: t("projectsPage.medium"),
        description: t("projectsPage.range50")
      },
      {
        value: "high",
        label: t("projectsPage.high"),
        description: t("projectsPage.range80")
      }
    ],
    [t]
  );

  const localizedSortOptions = useMemo<SelectOption<SortMode>[]>(
    () => [
      {
        value: "lastScan",
        label: t("projectsPage.latestScan"),
        description: t("projectsPage.latestScanDesc")
      },
      {
        value: "readinessLow",
        label: t("projectsPage.readinessLowFirst"),
        description: t("projectsPage.readinessLowFirstDesc")
      },
      {
        value: "readinessHigh",
        label: t("projectsPage.readinessHighFirst"),
        description: t("projectsPage.readinessHighFirstDesc")
      },
      {
        value: "name",
        label: t("projectsPage.name"),
        description: t("projectsPage.nameDesc")
      }
    ],
    [t]
  );

  const stackOptions: SelectOption<string>[] = useMemo(() => {
    const stacks = [
      ...new Set(projects.flatMap((project) => project.detectedStack))
    ]
      .filter(Boolean)
      .sort();

    return [
      {
        value: "all",
        label: t("projectsPage.allStacks"),
        description: t("projectsPage.stackDescription")
      },
      ...stacks.map((stack) => ({
        value: stack,
        label: stack,
        description: t("projectsPage.detectedStackSignal")
      }))
    ];
  }, [projects, t]);

  const packageOptions: SelectOption<string>[] = useMemo(() => {
    const packageManagers = [
      ...new Set(projects.map((project) => project.packageManager ?? t("common.unknown")))
    ]
      .filter(Boolean)
      .sort();

    return [
      {
        value: "all",
        label: t("projectsPage.allPackageManagers"),
        description: t("projectsPage.packageDescription")
      },
      ...packageManagers.map((manager) => ({
        value: manager,
        label: manager,
        description: t("projectsPage.detectedPackageManager")
      }))
    ];
  }, [projects, t]);

  const filteredProjects = useMemo(() => {
    const normalizedQuery = normalize(query).trim();

    return [...projects]
      .filter((project) => {
        const searchableText = [
          project.name,
          project.localPath,
          project.packageManager,
          project.detectedStack.join(" "),
          project.readinessScore,
          getReadinessLabel(project.readinessScore)
        ]
          .map(normalize)
          .join(" ");

        const matchesQuery =
          normalizedQuery.length === 0 || searchableText.includes(normalizedQuery);

        const matchesReadiness =
          readinessFilter === "all" ||
          (readinessFilter === "low" && project.readinessScore < 50) ||
          (readinessFilter === "medium" &&
            project.readinessScore >= 50 &&
            project.readinessScore < 80) ||
          (readinessFilter === "high" && project.readinessScore >= 80);

        const matchesStack =
          stackFilter === "all" || project.detectedStack.includes(stackFilter);

        const matchesPackage =
          packageFilter === "all" ||
          (project.packageManager ?? t("common.unknown")) === packageFilter;

        return matchesQuery && matchesReadiness && matchesStack && matchesPackage;
      })
      .sort((a, b) => {
        if (sortMode === "readinessLow") {
          return a.readinessScore - b.readinessScore;
        }

        if (sortMode === "readinessHigh") {
          return b.readinessScore - a.readinessScore;
        }

        if (sortMode === "name") {
          return a.name.localeCompare(b.name);
        }

        return getDateValue(b) - getDateValue(a);
      });
  }, [packageFilter, projects, query, readinessFilter, sortMode, stackFilter, t]);

  const averageReadiness = getAverageReadiness(projects);
  const lowReadinessCount = projects.filter((project) => project.readinessScore < 50).length;
  const activeReadinessIndex = readinessOptions.findIndex(
    (option) => option.value === readinessFilter
  );

  const hasActiveFilters =
    query.trim().length > 0 ||
    readinessFilter !== "all" ||
    stackFilter !== "all" ||
    packageFilter !== "all" ||
    sortMode !== "lastScan";

  function clearFilters() {
    setQuery("");
    setReadinessFilter("all");
    setStackFilter("all");
    setPackageFilter("all");
    setSortMode("lastScan");
  }

  if (projects.length === 0) {
    return (
      <section className="cf-card flex min-h-72 flex-col items-center justify-center p-8 text-center">
        <div className="mb-5 flex size-12 items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-300">
          <FolderOpen size={22} />
        </div>

        <h5 className="text-base font-medium text-white">{t("projectsPage.noProjects")}</h5>

        <p className="mt-2 max-w-md text-sm leading-6 text-neutral-500">
          {t("projectsPage.noProjectsDescription")}
        </p>

        <Button
          onClick={onAddProject}
          disabled={isLoading}
          variant="secondary"
          className="mt-6"
        >
          <FolderOpen size={16} />
          {t("projectsPage.selectFolder")}
        </Button>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <WorkspacePageHeader
        icon={<FolderOpen size={18} />}
        eyebrow={t("projectsPage.workspaceKicker")}
        title={t("projectsPage.projects")}
        description={t("projectsPage.workspaceDescription")}
        aside={
          <div className="grid w-full grid-cols-3 overflow-hidden rounded-2xl border border-neutral-900 bg-black/30 xl:w-[420px]">
            <WorkspaceStat
              icon={<FolderOpen size={14} />}
              label={t("projectsPage.projects")}
              value={projects.length}
            />
            <WorkspaceStat
              icon={<Gauge size={14} />}
              label={t("projectsPage.avgReadiness")}
              value={averageReadiness ?? "—"}
            />
            <WorkspaceStat
              icon={<AlertTriangle size={14} />}
              label={t("projectsPage.needAttention")}
              value={lowReadinessCount}
            />
          </div>
        }
      />

      <div className="cf-card p-4">
        <div className="mb-3 flex min-h-9 flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <SlidersHorizontal size={15} className="text-neutral-500" />
            <h3 className="text-sm font-semibold text-white">{t("projectsPage.filters")}</h3>
          </div>

          <motion.span
            key={filteredProjects.length}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.16 }}
            className="cf-badge ml-auto"
          >
            {t("projectsPage.results", { count: filteredProjects.length })}
          </motion.span>

          <button
            type="button"
            onClick={clearFilters}
            disabled={!hasActiveFilters}
            tabIndex={hasActiveFilters ? 0 : -1}
            aria-hidden={!hasActiveFilters}
            className={[
              "cf-invert-action inline-flex h-8 w-[128px] items-center justify-center gap-1.5 rounded-full px-3 text-xs",
              "transition duration-200",
              hasActiveFilters
                ? "opacity-100"
                : "pointer-events-none opacity-0"
            ].join(" ")}
          >
            <X size={13} />
            {t("projectsPage.clearFilters")}
          </button>
        </div>

        <div className="relative mb-3">
          <Search
            size={16}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-neutral-600"
          />

          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("projectsPage.searchPlaceholder")}
            className="h-11 w-full rounded-2xl border border-neutral-900 bg-black/45 pl-11 pr-4 text-sm text-white outline-none transition placeholder:text-neutral-700 hover:border-neutral-800 focus:border-white/40 focus:bg-black/70 focus:ring-4 focus:ring-white/5"
          />
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(360px,1.3fr)_repeat(3,minmax(0,1fr))]">
          <HorizontalSlidingSelector
            items={readinessOptions}
            activeIndex={activeReadinessIndex}
            getItemKey={(option) => option.value}
            onSelect={(option) => setReadinessFilter(option.value)}
            ariaLabel={t("projectsPage.filters")}
            itemClassName="h-12 px-2 text-left"
            renderItem={(option, isActive) => (
              <div className="min-w-0 px-1">
                <p className={[
                  "truncate text-xs font-semibold",
                  isActive ? "text-black" : "text-neutral-200"
                ].join(" ")}>
                  {option.label}
                </p>
                <p className={[
                  "mt-0.5 truncate text-[10px]",
                  isActive ? "text-neutral-500" : "text-neutral-700"
                ].join(" ")}>
                  {option.description}
                </p>
              </div>
            )}
          />

          <CustomSelect
            value={stackFilter}
            options={stackOptions}
            onChange={setStackFilter}
          />

          <CustomSelect
            value={packageFilter}
            options={packageOptions}
            onChange={setPackageFilter}
          />

          <CustomSelect
            value={sortMode}
            options={localizedSortOptions}
            onChange={(value) => setSortMode(value as SortMode)}
          />
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {filteredProjects.length === 0 ? (
          <motion.div
            key="empty"
            initial={{ opacity: 0, y: 14, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.985 }}
            transition={PROJECT_CARD_TRANSITION}
            className="cf-card flex min-h-60 flex-col items-center justify-center p-8 text-center"
          >
            <div className="mb-5 flex size-12 items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-300">
              <Search size={22} />
            </div>

            <h5 className="text-base font-medium text-white">{t("projectsPage.noMatching")}</h5>

            <p className="mt-2 max-w-md text-sm leading-6 text-neutral-500">
              {t("projectsPage.noMatchingDescription")}
            </p>
          </motion.div>
        ) : (
          <motion.div
            key={[
              "list",
              query.trim(),
              readinessFilter,
              stackFilter,
              packageFilter,
              sortMode
            ].join(":")}
            className="grid gap-3"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={PROJECT_CARD_TRANSITION}
          >
            {filteredProjects.map((project, index) => (
              <motion.div
                key={project.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{
                  opacity: 1,
                  y: 0,
                  transition: {
                    ...PROJECT_CARD_TRANSITION,
                    delay: Math.min(index * 0.018, 0.09)
                  }
                }}
                style={{ willChange: "opacity, transform" }}
              >
                <ProjectCard
                  project={project}
                  isLoading={isLoading}
                  onOpenDetails={() => onOpenProjectDetails(project)}
                  onRescan={() => onRescanProject(project)}
                  onGenerateAgents={() => onGenerateAgents(project)}
                  onCreateTaskPack={() => onCreateTaskPack(project)}
                />
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
