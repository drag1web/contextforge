import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Archive,
  Bot,
  Check,
  Clipboard,
  FileText,
  Search,
  SlidersHorizontal,
  Sparkles,
  X
} from "lucide-react";

import type { TaskPack } from "../types";
import { Button } from "../components/ui/Button";
import {
  CustomSelect,
  type SelectOption
} from "../components/ui/CustomSelect";
import {
  SegmentedFilter,
  type SegmentedFilterOption
} from "../components/ui/SegmentedFilter";

interface TaskPacksPageProps {
  taskPacks: TaskPack[];
  onOpenTaskPack: (taskPack: TaskPack) => void;
}

type TaskTypeFilter =
  | "all"
  | "ui"
  | "backend"
  | "fullstack"
  | "bugfix"
  | "refactor"
  | "docs"
  | "tests"
  | "build"
  | "assets";

type BodyModeFilter = "all" | "ollama" | "template" | "cached" | "fallback";
type SortMode = "newest" | "oldest" | "title" | "project";

const TASK_PACK_TRANSITION = {
  duration: 0.22,
  ease: [0.16, 1, 0.3, 1]
} as const;

const taskTypeOptions: SegmentedFilterOption<TaskTypeFilter>[] = [
  {
    value: "all",
    label: "All",
    description: "Every type"
  },
  {
    value: "ui",
    label: "UI / UX",
    description: "Interface"
  },
  {
    value: "backend",
    label: "Backend",
    description: "Server"
  },
  {
    value: "fullstack",
    label: "Fullstack",
    description: "Both sides"
  },
  {
    value: "bugfix",
    label: "Bugfix",
    description: "Fixes"
  },
  {
    value: "refactor",
    label: "Refactor",
    description: "Cleanup"
  },
  {
    value: "docs",
    label: "Docs",
    description: "Writing"
  },
  {
    value: "tests",
    label: "Tests",
    description: "Coverage"
  }
];

const bodyModeOptions: SelectOption<BodyModeFilter>[] = [
  {
    value: "all",
    label: "All body modes",
    description: "Show every generated body type"
  },
  {
    value: "ollama",
    label: "Ollama refined",
    description: "Final body refined by local model"
  },
  {
    value: "template",
    label: "Safe Template",
    description: "Stable ContextForge template body"
  },
  {
    value: "cached",
    label: "Cached",
    description: "Generated from cached result"
  },
  {
    value: "fallback",
    label: "Fallback",
    description: "Ollama fallback to template"
  }
];

const sortOptions: SelectOption<SortMode>[] = [
  {
    value: "newest",
    label: "Newest first",
    description: "Recently generated Task Packs first"
  },
  {
    value: "oldest",
    label: "Oldest first",
    description: "Oldest generated Task Packs first"
  },
  {
    value: "title",
    label: "Title",
    description: "Alphabetical task title"
  },
  {
    value: "project",
    label: "Project",
    description: "Group by project name"
  }
];

function normalize(value: unknown) {
  return String(value ?? "").toLowerCase();
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

function getDateValue(taskPack: TaskPack) {
  return new Date(taskPack.createdAt).getTime();
}

function getTaskPackBodyBadge(taskPack: TaskPack) {
  if (taskPack.generationMode === "ollama" && !taskPack.generationUsedFallback) {
    return "Ollama refined";
  }

  return "Safe Template";
}

function getTaskPackProjectName(taskPack: TaskPack) {
  return taskPack.projectName ?? `Project #${taskPack.projectId}`;
}

function getMostUsedTarget(taskPacks: TaskPack[]) {
  const counts = new Map<string, number>();

  for (const taskPack of taskPacks) {
    counts.set(taskPack.targetTool, (counts.get(taskPack.targetTool) ?? 0) + 1);
  }

  const [target] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];

  return target ?? "—";
}

function getTaskTypeLabel(value: string) {
  const option = taskTypeOptions.find((item) => item.value === value);
  return option?.label ?? value;
}

function matchesBodyMode(taskPack: TaskPack, filter: BodyModeFilter) {
  if (filter === "all") {
    return true;
  }

  if (filter === "cached") {
    return Boolean(taskPack.generationCached);
  }

  if (filter === "fallback") {
    return Boolean(taskPack.generationUsedFallback);
  }

  if (filter === "ollama") {
    return taskPack.generationMode === "ollama" && !taskPack.generationUsedFallback;
  }

  return taskPack.generationMode !== "ollama" || Boolean(taskPack.generationUsedFallback);
}

function MetricRow({
  icon,
  label,
  value,
  caption
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  caption: string;
}) {
  return (
    <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-300">
            {icon}
          </span>

          <span className="min-w-0">
            <span className="cf-tech-label block truncate text-[10px] uppercase text-neutral-600">
              {label}
            </span>

            <span className="mt-0.5 block truncate text-xs text-neutral-500">
              {caption}
            </span>
          </span>
        </div>

        <span className="cf-display-font shrink-0 text-2xl font-semibold text-white">
          {value}
        </span>
      </div>
    </div>
  );
}

export function TaskPacksPage({ taskPacks, onOpenTaskPack }: TaskPacksPageProps) {
  const [query, setQuery] = useState("");
  const [taskTypeFilter, setTaskTypeFilter] = useState<TaskTypeFilter>("all");
  const [targetFilter, setTargetFilter] = useState("all");
  const [bodyModeFilter, setBodyModeFilter] = useState<BodyModeFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [copiedTaskPackId, setCopiedTaskPackId] = useState<number | null>(null);

  const targetOptions: SelectOption<string>[] = useMemo(() => {
    const targets = [...new Set(taskPacks.map((taskPack) => taskPack.targetTool))]
      .filter(Boolean)
      .sort();

    return [
      {
        value: "all",
        label: "All agents",
        description: "Codex, Cursor, Claude, generic..."
      },
      ...targets.map((target) => ({
        value: target,
        label: target,
        description: "Target coding agent"
      }))
    ];
  }, [taskPacks]);

  const filteredTaskPacks = useMemo(() => {
    const normalizedQuery = normalize(query).trim();

    return [...taskPacks]
      .filter((taskPack) => {
        const searchableText = [
          taskPack.title,
          taskPack.rawTask,
          taskPack.generatedPrompt,
          getTaskPackProjectName(taskPack),
          taskPack.taskType,
          taskPack.targetTool,
          getTaskPackBodyBadge(taskPack)
        ]
          .map(normalize)
          .join(" ");

        const matchesQuery =
          normalizedQuery.length === 0 || searchableText.includes(normalizedQuery);

        const matchesTaskType =
          taskTypeFilter === "all" || taskPack.taskType === taskTypeFilter;

        const matchesTarget =
          targetFilter === "all" || taskPack.targetTool === targetFilter;

        const matchesBody = matchesBodyMode(taskPack, bodyModeFilter);

        return matchesQuery && matchesTaskType && matchesTarget && matchesBody;
      })
      .sort((a, b) => {
        if (sortMode === "oldest") {
          return getDateValue(a) - getDateValue(b);
        }

        if (sortMode === "title") {
          return a.title.localeCompare(b.title);
        }

        if (sortMode === "project") {
          return getTaskPackProjectName(a).localeCompare(getTaskPackProjectName(b));
        }

        return getDateValue(b) - getDateValue(a);
      });
  }, [bodyModeFilter, query, sortMode, targetFilter, taskPacks, taskTypeFilter]);

  const refinedCount = taskPacks.filter(
    (taskPack) => taskPack.generationMode === "ollama" && !taskPack.generationUsedFallback
  ).length;

  const templateCount = taskPacks.length - refinedCount;
  const mostUsedTarget = getMostUsedTarget(taskPacks);

  const hasActiveFilters =
    query.trim().length > 0 ||
    taskTypeFilter !== "all" ||
    targetFilter !== "all" ||
    bodyModeFilter !== "all" ||
    sortMode !== "newest";

  function clearFilters() {
    setQuery("");
    setTaskTypeFilter("all");
    setTargetFilter("all");
    setBodyModeFilter("all");
    setSortMode("newest");
  }

  async function handleCopy(taskPack: TaskPack) {
    await navigator.clipboard.writeText(taskPack.generatedPrompt);
    setCopiedTaskPackId(taskPack.id);

    window.setTimeout(() => {
      setCopiedTaskPackId(null);
    }, 1400);
  }

  if (taskPacks.length === 0) {
    return (
      <section className="cf-card flex min-h-72 flex-col items-center justify-center p-8 text-center">
        <div className="mb-5 flex size-12 items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-300">
          <FileText size={22} />
        </div>

        <h3 className="text-base font-medium text-white">No Task Packs yet</h3>

        <p className="mt-2 max-w-md text-sm leading-6 text-neutral-500">
          Create a Task Pack from any project card. ContextForge will generate a structured
          prompt for Codex, Cursor, Claude Code, or another AI agent.
        </p>
      </section>
    );
  }

  return (
    <section className="grid gap-5 xl:grid-cols-[330px_minmax(0,1fr)]">
      <aside className="cf-card h-fit p-5">
        <p className="cf-tech-label text-xs uppercase text-neutral-600">
          Archive metrics
        </p>

        <h3 className="mt-2 text-base font-semibold text-white">
          Task Pack storage
        </h3>

        <p className="mt-2 text-sm leading-6 text-neutral-500">
          Saved prompts, body modes, visible results, and most used agent.
        </p>

        <div className="mt-5 space-y-3">
          <MetricRow
            icon={<FileText size={16} />}
            label="Visible"
            value={filteredTaskPacks.length}
            caption={`of ${taskPacks.length} generated`}
          />

          <MetricRow
            icon={<Archive size={16} />}
            label="Total"
            value={taskPacks.length}
            caption="saved Task Packs"
          />

          <MetricRow
            icon={<Sparkles size={16} />}
            label="Refined"
            value={refinedCount}
            caption="Ollama-shaped bodies"
          />

          <MetricRow
            icon={<Archive size={16} />}
            label="Template"
            value={templateCount}
            caption="stable safe bodies"
          />

          <MetricRow
            icon={<Bot size={16} />}
            label="Top target"
            value={mostUsedTarget}
            caption="most used agent"
          />
        </div>
      </aside>

      <div className="min-w-0 space-y-5">
        <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.012)_48%,rgba(255,255,255,0.006))] p-6 shadow-[0_16px_52px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.045)]">
          <div className="mb-4 flex flex-wrap gap-2">
            <span className="cf-badge">
              <Archive size={13} />
              Task Pack Archive
            </span>
            <span className="cf-badge">Searchable prompts</span>
            <span className="cf-badge">Agent-ready history</span>
          </div>

          <h2 className="max-w-4xl text-[34px] font-semibold leading-[1.05] tracking-[-0.05em] text-white">
            Manage generated prompts across projects and coding agents.
          </h2>

          <p className="mt-3 max-w-3xl text-sm leading-6 text-neutral-400">
            Search, filter, copy, and reopen saved Task Packs generated from your local projects.
            Use this page as an archive of AI-ready development tasks.
          </p>
        </div>

        <div className="cf-card min-h-[276px] p-5">
          <div className="mb-5 flex min-h-9 flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <SlidersHorizontal size={15} className="text-neutral-500" />
              <h3 className="text-sm font-semibold text-white">Filter console</h3>
            </div>

            <motion.span
              key={filteredTaskPacks.length}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.16 }}
              className="cf-badge ml-auto"
            >
              {filteredTaskPacks.length} results
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
              placeholder="Search by task, project, agent, prompt type..."
              className="h-12 w-full rounded-2xl border border-neutral-900 bg-black/45 pl-11 pr-4 text-sm text-white outline-none transition placeholder:text-neutral-700 hover:border-neutral-800 focus:border-white/40 focus:bg-black/70 focus:ring-4 focus:ring-white/5"
            />
          </div>

          <div className="mb-4 rounded-2xl border border-neutral-900 bg-black/30 p-3">
            <div className="mb-3 flex items-center justify-between gap-4">
              <div>
                <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                  Task type
                </p>

                <p className="mt-1 text-xs text-neutral-600">
                  Quickly narrow the archive by the kind of coding task.
                </p>
              </div>

              <span className="cf-badge">
                {taskTypeFilter === "all"
                  ? "All types"
                  : getTaskTypeLabel(taskTypeFilter)}
              </span>
            </div>

            <SegmentedFilter
              value={taskTypeFilter}
              options={taskTypeOptions}
              onChange={(value) => setTaskTypeFilter(value as TaskTypeFilter)}
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <CustomSelect
              value={targetFilter}
              options={targetOptions}
              onChange={setTargetFilter}
            />

            <CustomSelect
              value={bodyModeFilter}
              options={bodyModeOptions}
              onChange={(value) => setBodyModeFilter(value as BodyModeFilter)}
            />

            <CustomSelect
              value={sortMode}
              options={sortOptions}
              onChange={(value) => setSortMode(value as SortMode)}
            />
          </div>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          {filteredTaskPacks.length === 0 ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0, y: 14, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.985 }}
              transition={TASK_PACK_TRANSITION}
              className="cf-card flex min-h-60 flex-col items-center justify-center p-8 text-center"
            >
              <div className="mb-5 flex size-12 items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-300">
                <Search size={22} />
              </div>

              <h5 className="text-base font-medium text-white">No matching Task Packs</h5>

              <p className="mt-2 max-w-md text-sm leading-6 text-neutral-500">
                Try changing the search query or clearing one of the filters.
              </p>
            </motion.div>
          ) : (
            <motion.div
              key={[
                "list",
                query.trim(),
                taskTypeFilter,
                targetFilter,
                bodyModeFilter,
                sortMode
              ].join(":")}
              className="grid gap-4 2xl:grid-cols-2"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={TASK_PACK_TRANSITION}
            >
              {filteredTaskPacks.map((taskPack, index) => {
                const isCopied = copiedTaskPackId === taskPack.id;

                return (
                  <motion.article
                    key={taskPack.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{
                      opacity: 1,
                      y: 0,
                      transition: {
                        ...TASK_PACK_TRANSITION,
                        delay: Math.min(index * 0.018, 0.09)
                      }
                    }}
                    style={{ willChange: "opacity, transform" }}
                    className="cf-card flex min-h-[230px] flex-col p-5"
                  >
                    <div className="mb-5 flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="mb-2 flex items-start gap-2">
                          <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border border-neutral-800 bg-neutral-950 text-neutral-300">
                            <FileText size={14} />
                          </span>

                          <div className="min-w-0">
                            <h4 className="line-clamp-2 text-sm font-semibold leading-5 text-white">
                              {taskPack.title}
                            </h4>

                            <p className="mt-1 truncate text-xs text-neutral-600">
                              {getTaskPackProjectName(taskPack)}
                            </p>
                          </div>
                        </div>
                      </div>

                      <span className="cf-badge shrink-0">
                        {getTaskPackBodyBadge(taskPack)}
                      </span>
                    </div>

                    <p className="line-clamp-3 text-sm leading-6 text-neutral-500">
                      {taskPack.rawTask}
                    </p>

                    <div className="mt-auto pt-5">
                      <div className="mb-4 flex flex-wrap gap-2">
                        <span className="cf-badge">{taskPack.targetTool}</span>
                        <span className="cf-badge">{taskPack.taskType}</span>
                        <span className="cf-badge">{formatDate(taskPack.createdAt)}</span>
                      </div>

                      <div className="flex items-center justify-between gap-4 border-t border-neutral-900 pt-4">
                        <p className="text-xs text-neutral-700">
                          Ready for copy/paste into coding agent
                        </p>

                        <div className="flex shrink-0 items-center gap-2">
                          <Button
                            variant="secondary"
                            onClick={() => handleCopy(taskPack)}
                          >
                            {isCopied ? <Check size={15} /> : <Clipboard size={15} />}
                            {isCopied ? "Copied" : "Copy"}
                          </Button>

                          <Button
                            variant="primary"
                            onClick={() => onOpenTaskPack(taskPack)}
                          >
                            Open
                          </Button>
                        </div>
                      </div>
                    </div>
                  </motion.article>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}