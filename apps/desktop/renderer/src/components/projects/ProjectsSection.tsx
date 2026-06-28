import { useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  FolderOpen,
  Gauge,
  Layers3,
  Search,
  SlidersHorizontal,
  X
} from "lucide-react";

import type { Project } from "../../types";
import { Button } from "../ui/Button";
import {
  SegmentedFilter,
  type SegmentedFilterOption
} from "../ui/SegmentedFilter";
import {
  CustomSelect,
  type SelectOption
} from "../ui/CustomSelect";
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

type ReadinessFilter = "all" | "low" | "medium" | "high";
type SortMode = "lastScan" | "readinessLow" | "readinessHigh" | "name";

const readinessOptions: SegmentedFilterOption<ReadinessFilter>[] = [
  {
    value: "all",
    label: "All",
    description: "Every project"
  },
  {
    value: "low",
    label: "Low",
    description: "Below 50"
  },
  {
    value: "medium",
    label: "Medium",
    description: "50–79"
  },
  {
    value: "high",
    label: "High",
    description: "80–100"
  }
];

const sortOptions: SelectOption<SortMode>[] = [
  {
    value: "lastScan",
    label: "Latest scan",
    description: "Recently scanned or updated projects first"
  },
  {
    value: "readinessLow",
    label: "Readiness low first",
    description: "Projects requiring attention first"
  },
  {
    value: "readinessHigh",
    label: "Readiness high first",
    description: "Most AI-ready projects first"
  },
  {
    value: "name",
    label: "Name",
    description: "Alphabetical project order"
  }
];

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

function getTopStack(projects: Project[]) {
  const counts = new Map<string, number>();

  for (const project of projects) {
    for (const item of project.detectedStack) {
      counts.set(item, (counts.get(item) ?? 0) + 1);
    }
  }

  const [stack] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];

  return stack ?? "—";
}

function MetricCard({
  icon,
  label,
  value,
  caption
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  caption: string;
}) {
  return (
    <article className="cf-card p-5">
      <div className="mb-4 flex size-9 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-200">
        {icon}
      </div>

      <p className="cf-tech-label text-xs uppercase text-neutral-500">
        {label}
      </p>

      <p className="cf-display-font mt-2 truncate text-4xl font-semibold leading-none text-white">
        {value}
      </p>

      <p className="mt-2 truncate text-sm text-neutral-500">{caption}</p>
    </article>
  );
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
  const [query, setQuery] = useState("");
  const [readinessFilter, setReadinessFilter] = useState<ReadinessFilter>("all");
  const [stackFilter, setStackFilter] = useState("all");
  const [packageFilter, setPackageFilter] = useState("all");
  const [sortMode, setSortMode] = useState<SortMode>("lastScan");

  const stackOptions: SelectOption<string>[] = useMemo(() => {
    const stacks = [
      ...new Set(projects.flatMap((project) => project.detectedStack))
    ]
      .filter(Boolean)
      .sort();

    return [
      {
        value: "all",
        label: "All stacks",
        description: "React, Electron, Node, TypeScript..."
      },
      ...stacks.map((stack) => ({
        value: stack,
        label: stack,
        description: "Detected stack signal"
      }))
    ];
  }, [projects]);

  const packageOptions: SelectOption<string>[] = useMemo(() => {
    const packageManagers = [
      ...new Set(projects.map((project) => project.packageManager ?? "Unknown"))
    ]
      .filter(Boolean)
      .sort();

    return [
      {
        value: "all",
        label: "All package managers",
        description: "npm, pnpm, yarn, bun, unknown..."
      },
      ...packageManagers.map((manager) => ({
        value: manager,
        label: manager,
        description: "Detected package manager"
      }))
    ];
  }, [projects]);

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
          (project.packageManager ?? "Unknown") === packageFilter;

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
  }, [packageFilter, projects, query, readinessFilter, sortMode, stackFilter]);

  const averageReadiness = getAverageReadiness(projects);
  const lowReadinessCount = projects.filter((project) => project.readinessScore < 50).length;
  const topStack = getTopStack(projects);

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
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.012)_48%,rgba(255,255,255,0.006))] p-6 shadow-[0_16px_52px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.045)]">
        <div className="mb-4 flex flex-wrap gap-2">
          <span className="cf-badge">
            <FolderOpen size={13} />
            Project Operations
          </span>
          <span className="cf-badge">Local repositories</span>
          <span className="cf-badge">AI readiness</span>
        </div>

        <h2 className="max-w-4xl text-[34px] font-semibold leading-[1.05] tracking-[-0.05em] text-white">
          Manage scanned projects and prepare them for AI coding agents.
        </h2>

        <p className="mt-3 max-w-3xl text-sm leading-6 text-neutral-400">
          Search repositories, review readiness, rescan project structure, generate AGENTS.md,
          and create Task Packs from one place.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        <MetricCard
          icon={<FolderOpen size={18} />}
          label="Projects"
          value={projects.length}
          caption="scanned repositories"
        />

        <MetricCard
          icon={<Gauge size={18} />}
          label="Avg readiness"
          value={averageReadiness ?? "—"}
          caption="average AI score"
        />

        <MetricCard
          icon={<AlertTriangle size={18} />}
          label="Need attention"
          value={lowReadinessCount}
          caption="below 50/100"
        />

        <MetricCard
          icon={<Layers3 size={18} />}
          label="Top stack"
          value={topStack}
          caption="most detected stack"
        />
      </div>

      <div className="cf-card min-h-[252px] p-5">
        <div className="mb-5 flex min-h-9 flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <SlidersHorizontal size={15} className="text-neutral-500" />
            <h3 className="text-sm font-semibold text-white">Project filters</h3>
          </div>

          <motion.span
            key={filteredProjects.length}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.16 }}
            className="cf-badge ml-auto"
          >
            {filteredProjects.length} results
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
            Clear filters
          </button>
        </div>

        <div className="relative mb-4">
          <Search
            size={16}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-neutral-600"
          />

          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by project name, path, stack, package manager..."
            className="h-12 w-full rounded-2xl border border-neutral-900 bg-black/45 pl-11 pr-4 text-sm text-white outline-none transition placeholder:text-neutral-700 hover:border-neutral-800 focus:border-white/40 focus:bg-black/70 focus:ring-4 focus:ring-white/5"
          />
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(360px,1.35fr)_repeat(3,minmax(0,1fr))]">
          <SegmentedFilter
            value={readinessFilter}
            options={readinessOptions}
            onChange={(value) => setReadinessFilter(value as ReadinessFilter)}
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
            options={sortOptions}
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

            <h5 className="text-base font-medium text-white">No matching projects</h5>

            <p className="mt-2 max-w-md text-sm leading-6 text-neutral-500">
              Try changing the search query or clearing one of the filters.
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
            className="grid gap-4"
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
                  isExpanded={expandedProjectId === project.id}
                  isLoading={isLoading}
                  onToggleReport={() => onToggleProject(project.id)}
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