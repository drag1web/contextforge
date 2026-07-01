import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import {
  Archive,
  Bot,
  Check,
  Clipboard,
  FileText,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  X
} from "lucide-react";

import type { TaskPack } from "../types";
import { Button } from "../components/ui/Button";
import {
  makeAiToolSelectOption
} from "../components/ai/aiToolOptions";
import {
  CustomSelect,
  type SelectOption
} from "../components/ui/CustomSelect";

interface TaskPacksPageProps {
  taskPacks: TaskPack[];
  onOpenTaskPack: (taskPack: TaskPack) => void;
}

type TaskTypeFilter =
  | "all"
  | "general"
  | "ui"
  | "backend"
  | "fullstack"
  | "build"
  | "bugfix"
  | "refactor"
  | "docs"
  | "tests";

type BodyModeFilter = "all" | "ollama" | "template" | "cached" | "fallback";
type SortMode = "newest" | "oldest" | "title" | "project";

const TASK_PACK_TRANSITION = {
  duration: 0.2,
  ease: [0.16, 1, 0.3, 1]
} as const;

function normalize(value: unknown) {
  return String(value ?? "").toLowerCase();
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

function getDateValue(taskPack: TaskPack) {
  return new Date(taskPack.createdAt).getTime();
}

function getTaskPackBodyBadge(taskPack: TaskPack, t: (key: string) => string) {
  if (taskPack.generationMode === "ollama" && !taskPack.generationUsedFallback) {
    return t("labels.ollamaRefined");
  }

  return t("labels.safeTemplate");
}

function getTaskPackProjectName(
  taskPack: TaskPack,
  t: (key: string, options?: Record<string, unknown>) => string
) {
  return taskPack.projectName ?? t("labels.projectFallback", { id: taskPack.projectId });
}

function getMostUsedTarget(taskPacks: TaskPack[]) {
  const counts = new Map<string, number>();

  for (const taskPack of taskPacks) {
    counts.set(taskPack.targetTool, (counts.get(taskPack.targetTool) ?? 0) + 1);
  }

  const [target] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];

  return target ?? "—";
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

function Pill({
  children,
  tone = "default"
}: {
  children: React.ReactNode;
  tone?: "default" | "success" | "warning";
}) {
  const className =
    tone === "success"
      ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
      : tone === "warning"
        ? "border-amber-400/20 bg-amber-400/10 text-amber-200"
        : "border-neutral-800 bg-neutral-950 text-neutral-400";

  return (
    <span
      className={[
        "inline-flex h-6 max-w-full items-center gap-1.5 truncate rounded-full border px-2.5 text-[11px] font-medium",
        className
      ].join(" ")}
    >
      {children}
    </span>
  );
}

function MetricCard({
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
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-300">
          {icon}
        </span>

        <span className="cf-display-font text-2xl font-semibold text-white">
          {value}
        </span>
      </div>

      <p className="cf-tech-label truncate text-[10px] uppercase text-neutral-600">
        {label}
      </p>

      <p className="mt-1 truncate text-xs text-neutral-600">
        {caption}
      </p>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  description
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <section className="grid h-full min-h-[360px] place-items-center rounded-[1.5rem] border border-dashed border-neutral-800 bg-black/25 p-8 text-center">
      <div>
        <div className="mx-auto mb-5 grid size-12 place-items-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-300">
          {icon}
        </div>

        <h3 className="text-base font-semibold text-white">
          {title}
        </h3>

        <p className="mt-2 max-w-md text-sm leading-6 text-neutral-500">
          {description}
        </p>
      </div>
    </section>
  );
}

function TaskPackCard({
  taskPack,
  isCopied,
  projectName,
  bodyBadge,
  onCopy,
  onOpen
}: {
  taskPack: TaskPack;
  isCopied: boolean;
  projectName: string;
  bodyBadge: string;
  onCopy: () => void;
  onOpen: () => void;
}) {
  const recipe = taskPack.generationRecipe;

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={TASK_PACK_TRANSITION}
      className="group rounded-[1.5rem] border border-neutral-900 bg-black/35 p-5 transition hover:border-white/15 hover:bg-white/[0.035]"
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap gap-2">
            <Pill>{bodyBadge}</Pill>

            {recipe && (
              <Pill tone="success">
                v0.5 recipe
              </Pill>
            )}
          </div>

          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-300">
              <FileText size={15} />
            </span>

            <div className="min-w-0">
              <h4 className="line-clamp-2 text-base font-semibold leading-6 text-white">
                {taskPack.title}
              </h4>

              <p className="mt-1 truncate text-xs text-neutral-600">
                {projectName}
              </p>
            </div>
          </div>
        </div>
      </div>

      <p className="line-clamp-3 text-sm leading-6 text-neutral-500">
        {taskPack.rawTask}
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        <Pill>{taskPack.targetTool}</Pill>
        <Pill>{taskPack.taskType}</Pill>

        {recipe?.template && (
          <Pill>
            Template: {recipe.template.name}
          </Pill>
        )}

        {recipe?.ruleProfile && (
          <Pill>
            Profile: {recipe.ruleProfile.name}
          </Pill>
        )}

        {recipe && (
          <Pill tone="success">
            Rules: {recipe.counts.enabledRules}
          </Pill>
        )}
      </div>

      {recipe && (
        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-neutral-900 bg-black/35 p-2.5">
            <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
              Rules
            </p>

            <p className="mt-1 text-sm font-semibold text-white">
              {recipe.counts.enabledRules}
            </p>
          </div>

          <div className="rounded-xl border border-neutral-900 bg-black/35 p-2.5">
            <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
              Custom
            </p>

            <p className="mt-1 text-sm font-semibold text-white">
              {recipe.counts.customRules}
            </p>
          </div>

          <div className="rounded-xl border border-neutral-900 bg-black/35 p-2.5">
            <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
              Criteria
            </p>

            <p className="mt-1 text-sm font-semibold text-white">
              {recipe.counts.acceptanceCriteria}
            </p>
          </div>
        </div>
      )}

      <div className="mt-5 flex items-center justify-between gap-4 border-t border-neutral-900 pt-4">
        <p className="truncate text-xs text-neutral-700">
          {formatDate(taskPack.createdAt)}
        </p>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="secondary"
            onClick={onCopy}
          >
            {isCopied ? <Check size={15} /> : <Clipboard size={15} />}
            {isCopied ? "Copied" : "Copy"}
          </Button>

          <Button
            variant="primary"
            onClick={onOpen}
          >
            Open
          </Button>
        </div>
      </div>
    </motion.article>
  );
}

export function TaskPacksPage({ taskPacks, onOpenTaskPack }: TaskPacksPageProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [taskTypeFilter, setTaskTypeFilter] = useState<TaskTypeFilter>("all");
  const [targetFilter, setTargetFilter] = useState("all");
  const [bodyModeFilter, setBodyModeFilter] = useState<BodyModeFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [copiedTaskPackId, setCopiedTaskPackId] = useState<number | null>(null);

  const localizedTaskTypeOptions = useMemo<SelectOption<TaskTypeFilter>[]>(
    () => [
      { value: "all", label: t("labels.taskTypeAll"), description: t("taskPacksPage.allTypes") },
      { value: "general", label: t("labels.taskTypeGeneral"), description: "General" },
      { value: "ui", label: t("labels.taskTypeUi"), description: "Interface" },
      { value: "backend", label: t("labels.taskTypeBackend"), description: "Server" },
      { value: "fullstack", label: t("labels.taskTypeFullstack"), description: "Both sides" },
      { value: "build", label: t("labels.taskTypeBuild"), description: "Build" },
      { value: "bugfix", label: t("labels.taskTypeBugfix"), description: "Fixes" },
      { value: "refactor", label: t("labels.taskTypeRefactor"), description: "Cleanup" },
      { value: "docs", label: t("labels.taskTypeDocs"), description: "Writing" },
      { value: "tests", label: t("labels.taskTypeTests"), description: "Coverage" }
    ],
    [t]
  );

  const localizedBodyModeOptions = useMemo<SelectOption<BodyModeFilter>[]>(
    () => [
      { value: "all", label: t("taskPacksPage.allBodyModes"), description: t("taskPacksPage.allBodyModesDesc") },
      { value: "ollama", label: t("labels.ollamaRefined"), description: t("taskPacksPage.ollamaRefinedDesc") },
      { value: "template", label: t("labels.safeTemplate"), description: t("taskPacksPage.safeTemplateDesc") },
      { value: "cached", label: t("labels.cached"), description: t("taskPacksPage.cachedDesc") },
      { value: "fallback", label: t("labels.fallback"), description: t("taskPacksPage.fallbackDesc") }
    ],
    [t]
  );

  const localizedSortOptions = useMemo<SelectOption<SortMode>[]>(
    () => [
      { value: "newest", label: t("taskPacksPage.newest"), description: t("taskPacksPage.newestDesc") },
      { value: "oldest", label: t("taskPacksPage.oldest"), description: t("taskPacksPage.oldestDesc") },
      { value: "title", label: t("taskPacksPage.titleSort"), description: t("taskPacksPage.titleSortDesc") },
      { value: "project", label: t("taskPacksPage.projectSort"), description: t("taskPacksPage.projectSortDesc") }
    ],
    [t]
  );

  const targetOptions: SelectOption<string>[] = useMemo(() => {
    const targets = [...new Set(taskPacks.map((taskPack) => taskPack.targetTool))]
      .filter(Boolean)
      .sort();

    return [
      {
        value: "all",
        label: t("taskPacksPage.allAgents"),
        description: "Codex, Cursor, Claude, Generic",
        icon: makeAiToolSelectOption("generic").icon
      },
      ...targets.map((target) => makeAiToolSelectOption(target))
    ];
  }, [taskPacks, t]);

  const filteredTaskPacks = useMemo(() => {
    const normalizedQuery = normalize(query).trim();

    return [...taskPacks]
      .filter((taskPack) => {
        const recipe = taskPack.generationRecipe;

        const searchableText = [
          taskPack.title,
          taskPack.rawTask,
          taskPack.generatedPrompt,
          getTaskPackProjectName(taskPack, t),
          taskPack.taskType,
          taskPack.targetTool,
          getTaskPackBodyBadge(taskPack, t),
          recipe?.template?.name,
          recipe?.ruleProfile?.name,
          recipe?.enabledRules.map((rule) => rule.title).join(" "),
          recipe?.customRules.join(" "),
          recipe?.acceptanceCriteria.join(" ")
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
          return getTaskPackProjectName(a, t).localeCompare(getTaskPackProjectName(b, t));
        }

        return getDateValue(b) - getDateValue(a);
      });
  }, [bodyModeFilter, query, sortMode, targetFilter, taskPacks, taskTypeFilter, t]);

  const refinedCount = taskPacks.filter(
    (taskPack) => taskPack.generationMode === "ollama" && !taskPack.generationUsedFallback
  ).length;

  const recipeCount = taskPacks.filter((taskPack) => taskPack.generationRecipe).length;
  const fallbackCount = taskPacks.filter((taskPack) => taskPack.generationUsedFallback).length;
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
      <section className="grid h-[calc(100vh-96px)] place-items-center overflow-hidden">
        <EmptyState
          icon={<FileText size={22} />}
          title={t("taskPacksPage.noTaskPacks")}
          description={t("taskPacksPage.noTaskPacksDescription")}
        />
      </section>
    );
  }

  return (
    <section className="grid h-[calc(100vh-96px)] min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-4 overflow-hidden">
      <div className="grid shrink-0 gap-4 xl:grid-cols-[minmax(0,1fr)_520px]">
        <div className="overflow-hidden rounded-[1.75rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.012))] p-5 shadow-[0_16px_52px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.045)]">
          <div className="mb-4 flex flex-wrap gap-2">
            <Pill>
              <Archive size={13} />
              {t("taskPacksPage.archive")}
            </Pill>

            <Pill>{t("taskPacksPage.searchablePrompts")}</Pill>
            <Pill>{t("taskPacksPage.agentReadyHistory")}</Pill>

            {recipeCount > 0 && (
              <Pill tone="success">
                v0.5 recipe metadata
              </Pill>
            )}
          </div>

          <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-end 2xl:justify-between">
            <div>
              <h2 className="max-w-4xl text-[32px] font-semibold leading-[1.05] tracking-[-0.05em] text-white">
                {t("taskPacksPage.title")}
              </h2>

              <p className="mt-3 max-w-3xl text-sm leading-6 text-neutral-400">
                {t("taskPacksPage.description")}
              </p>
            </div>

            <Pill>
              {filteredTaskPacks.length} visible
            </Pill>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <MetricCard
            icon={<FileText size={15} />}
            label="Total"
            value={taskPacks.length}
            caption="saved Task Packs"
          />

          <MetricCard
            icon={<ShieldCheck size={15} />}
            label="Recipes"
            value={recipeCount}
            caption="v0.5 metadata"
          />

          <MetricCard
            icon={<Sparkles size={15} />}
            label="Refined"
            value={refinedCount}
            caption="Ollama bodies"
          />

          <MetricCard
            icon={<Bot size={15} />}
            label="Top target"
            value={mostUsedTarget}
            caption={`${fallbackCount} fallback`}
          />
        </div>
      </div>

      <div className="grid min-h-0 gap-4 overflow-hidden xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-[1.5rem] border border-neutral-900 bg-black/35 p-5">
          <div className="mb-5 shrink-0">
            <div className="mb-4 flex size-10 items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-300">
              <SlidersHorizontal size={18} />
            </div>

            <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
              Filter console
            </p>

            <h3 className="mt-2 text-base font-semibold text-white">
              Search and narrow history
            </h3>

            <p className="mt-2 text-sm leading-6 text-neutral-500">
              Filter saved prompts by task type, target agent, generation mode, recipe metadata and text content.
            </p>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            <div className="rounded-2xl border border-neutral-900 bg-black/30 p-3">
              <div className="mb-3">
                <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                  Search
                </p>

                <p className="mt-1 text-xs text-neutral-600">
                  Search by task, project, agent, template or rules.
                </p>
              </div>

              <div className="relative">
                <Search
                  size={15}
                  className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-600"
                />

                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Type to search..."
                  className="h-10 w-full rounded-xl border border-neutral-900 bg-black/50 pl-10 pr-3 text-sm text-white outline-none transition placeholder:text-neutral-700 hover:border-neutral-800 focus:border-white/30 focus:bg-black/75 focus:ring-4 focus:ring-white/5"
                />
              </div>
            </div>

            <div className="rounded-2xl border border-neutral-900 bg-black/30 p-3">
              <div className="mb-3">
                <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                  {t("taskPacksPage.taskType")}
                </p>

                <p className="mt-1 text-xs text-neutral-600">
                  {t("taskPacksPage.narrowByTask")}
                </p>
              </div>

              <CustomSelect
                value={taskTypeFilter}
                options={localizedTaskTypeOptions}
                onChange={(value) => setTaskTypeFilter(value as TaskTypeFilter)}
              />
            </div>

            <CustomSelect
              value={targetFilter}
              options={targetOptions}
              onChange={setTargetFilter}
            />

            <CustomSelect
              value={bodyModeFilter}
              options={localizedBodyModeOptions}
              onChange={(value) => setBodyModeFilter(value as BodyModeFilter)}
            />

            <CustomSelect
              value={sortMode}
              options={localizedSortOptions}
              onChange={(value) => setSortMode(value as SortMode)}
            />

            <button
              type="button"
              onClick={clearFilters}
              disabled={!hasActiveFilters}
              className={[
                "cf-invert-action inline-flex h-9 w-full items-center justify-center gap-2 rounded-full px-4 text-xs transition",
                hasActiveFilters
                  ? "opacity-100"
                  : "pointer-events-none opacity-40"
              ].join(" ")}
            >
              <X size={13} />
              {t("taskPacksPage.clearFilters")}
            </button>
          </div>
        </aside>

        <main className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-4 overflow-hidden">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
            <div>
              <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                Archive results
              </p>

              <h3 className="mt-1 text-lg font-semibold text-white">
                {filteredTaskPacks.length} Task Pack(s)
              </h3>
            </div>

            <Pill>
              {hasActiveFilters ? "Filtered" : "All history"}
            </Pill>
          </div>

          <AnimatePresence mode="wait" initial={false}>
            {filteredTaskPacks.length === 0 ? (
              <motion.div
                key="empty"
                initial={{ opacity: 0, y: 14, scale: 0.985 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.985 }}
                transition={TASK_PACK_TRANSITION}
                className="min-h-0 overflow-hidden"
              >
                <EmptyState
                  icon={<Search size={22} />}
                  title={t("taskPacksPage.noMatching")}
                  description={t("taskPacksPage.noMatchingDescription")}
                />
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
                className="min-h-0 overflow-y-auto pr-2"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={TASK_PACK_TRANSITION}
              >
                <div className="grid gap-4 2xl:grid-cols-2">
                  {filteredTaskPacks.map((taskPack) => {
                    const isCopied = copiedTaskPackId === taskPack.id;

                    return (
                      <TaskPackCard
                        key={taskPack.id}
                        taskPack={taskPack}
                        isCopied={isCopied}
                        projectName={getTaskPackProjectName(taskPack, t)}
                        bodyBadge={getTaskPackBodyBadge(taskPack, t)}
                        onCopy={() => handleCopy(taskPack)}
                        onOpen={() => onOpenTaskPack(taskPack)}
                      />
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>
    </section>
  );
}