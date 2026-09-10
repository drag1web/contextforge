import type { Project, ProjectAwareness, TaskPack } from "../types";

export type TaskPackFreshnessStatus =
  | "current"
  | "review_recommended"
  | "affected"
  | "unknown";

export type TaskPackFreshnessReason =
  | "created_after_latest_observation"
  | "known_state_unchanged"
  | "project_changed_after_task_pack"
  | "removed_context_path"
  | "comparison_limited"
  | "no_awareness"
  | "no_comparison_baseline"
  | "analysis_inside_observation_interval"
  | "invalid_timestamp"
  | "invalid_awareness"
  | "project_mismatch";

export interface TaskPackFreshness {
  taskPackId: number;
  projectId: number;
  status: TaskPackFreshnessStatus;
  reason: TaskPackFreshnessReason;
  selectedPaths: string[];
  affectedPaths: string[];
  createdAt: string;
  previousObservedAt: string | null;
  currentObservedAt: string | null;
}

interface ProjectFreshnessContext {
  projectId: number;
  awareness: ProjectAwareness | null;
  previousObservedAtMs: number | null;
  currentObservedAtMs: number | null;
  removedPaths: Set<string>;
}

function compareText(left: string, right: string) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function parseTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function normalizeTaskPackFreshnessPath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/{2,}/g, "/");
}

function isSafeRepositoryRelativePath(value: string) {
  if (
    !value ||
    value.startsWith("/") ||
    /^[A-Za-z]:\//.test(value) ||
    value.includes("\0")
  ) {
    return false;
  }

  return value
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function normalizePaths(paths: readonly unknown[]) {
  return [
    ...new Set(
      paths
        .filter((path): path is string => typeof path === "string")
        .map(normalizeTaskPackFreshnessPath)
        .filter(isSafeRepositoryRelativePath),
    ),
  ].sort(compareText);
}

export function getTaskPackSelectedPaths(taskPack: TaskPack) {
  const selectedFiles = taskPack.generationRecipe?.selectorDiagnostics?.actual.selectedFiles;
  if (!Array.isArray(selectedFiles)) return [];

  return normalizePaths(
    selectedFiles.flatMap((file) =>
      file && typeof file.path === "string" ? [file.path] : [],
    ),
  );
}

function buildProjectFreshnessContext(project: Project): ProjectFreshnessContext {
  const awareness = project.awareness ?? null;

  return {
    projectId: project.id,
    awareness,
    previousObservedAtMs: parseTimestamp(awareness?.previousObservedAt),
    currentObservedAtMs: parseTimestamp(awareness?.lastObservedAt),
    removedPaths: new Set(
      normalizePaths(
        Array.isArray(awareness?.fileChanges?.removed)
          ? awareness.fileChanges.removed
          : [],
      ),
    ),
  };
}

function result(
  taskPack: TaskPack,
  context: ProjectFreshnessContext,
  selectedPaths: string[],
  status: TaskPackFreshnessStatus,
  reason: TaskPackFreshnessReason,
  affectedPaths: string[] = [],
): TaskPackFreshness {
  return {
    taskPackId: taskPack.id,
    projectId: taskPack.projectId,
    status,
    reason,
    selectedPaths,
    affectedPaths,
    createdAt: taskPack.createdAt,
    previousObservedAt: context.awareness?.previousObservedAt ?? null,
    currentObservedAt: context.awareness?.lastObservedAt ?? null,
  };
}

function deriveWithContext(
  taskPack: TaskPack,
  context: ProjectFreshnessContext,
): TaskPackFreshness {
  const selectedPaths = getTaskPackSelectedPaths(taskPack);

  if (taskPack.projectId !== context.projectId) {
    return result(taskPack, context, selectedPaths, "unknown", "project_mismatch");
  }

  const awareness = context.awareness;
  if (!awareness) {
    return result(taskPack, context, selectedPaths, "unknown", "no_awareness");
  }

  if (
    !["first_observation", "unchanged", "changed", "comparison_limited"].includes(
      awareness.status,
    ) ||
    !["available", "limited"].includes(awareness.fileComparison)
  ) {
    return result(taskPack, context, selectedPaths, "unknown", "invalid_awareness");
  }

  if (!awareness.previousObservedAt || awareness.status === "first_observation") {
    return result(
      taskPack,
      context,
      selectedPaths,
      "unknown",
      "no_comparison_baseline",
    );
  }

  const taskPackCreatedAtMs = parseTimestamp(taskPack.createdAt);
  const { previousObservedAtMs, currentObservedAtMs } = context;
  if (
    taskPackCreatedAtMs === null ||
    previousObservedAtMs === null ||
    currentObservedAtMs === null ||
    previousObservedAtMs > currentObservedAtMs
  ) {
    return result(taskPack, context, selectedPaths, "unknown", "invalid_timestamp");
  }

  if (taskPackCreatedAtMs >= currentObservedAtMs) {
    return result(
      taskPack,
      context,
      selectedPaths,
      "current",
      "created_after_latest_observation",
    );
  }

  if (
    awareness.fileComparison === "limited" ||
    awareness.status === "comparison_limited"
  ) {
    return result(
      taskPack,
      context,
      selectedPaths,
      "review_recommended",
      "comparison_limited",
    );
  }

  const affectedPaths = selectedPaths.filter((path) => context.removedPaths.has(path));
  if (affectedPaths.length > 0) {
    return result(
      taskPack,
      context,
      selectedPaths,
      "affected",
      "removed_context_path",
      affectedPaths,
    );
  }

  if (awareness.status === "unchanged") {
    return result(
      taskPack,
      context,
      selectedPaths,
      "current",
      "known_state_unchanged",
    );
  }

  if (taskPackCreatedAtMs <= previousObservedAtMs) {
    return result(
      taskPack,
      context,
      selectedPaths,
      "review_recommended",
      "project_changed_after_task_pack",
    );
  }

  return result(
    taskPack,
    context,
    selectedPaths,
    "unknown",
    "analysis_inside_observation_interval",
  );
}

export function deriveTaskPackFreshness(
  taskPack: TaskPack,
  project: Project | null | undefined,
): TaskPackFreshness {
  if (!project) {
    return result(
      taskPack,
      {
        projectId: taskPack.projectId,
        awareness: null,
        previousObservedAtMs: null,
        currentObservedAtMs: null,
        removedPaths: new Set(),
      },
      getTaskPackSelectedPaths(taskPack),
      "unknown",
      "no_awareness",
    );
  }

  return deriveWithContext(taskPack, buildProjectFreshnessContext(project));
}

export function buildTaskPackFreshnessIndex(
  taskPacks: readonly TaskPack[],
  projects: readonly Project[],
) {
  const projectContexts = new Map(
    projects.map((project) => [project.id, buildProjectFreshnessContext(project)]),
  );
  const freshnessByTaskPackId = new Map<number, TaskPackFreshness>();

  for (const taskPack of taskPacks) {
    const context = projectContexts.get(taskPack.projectId);
    freshnessByTaskPackId.set(
      taskPack.id,
      context
        ? deriveWithContext(taskPack, context)
        : deriveTaskPackFreshness(taskPack, null),
    );
  }

  return freshnessByTaskPackId;
}

export function getProjectTaskPackFreshness(
  taskPacks: readonly TaskPack[],
  projectId: number,
  freshnessByTaskPackId: ReadonlyMap<number, TaskPackFreshness>,
) {
  return taskPacks
    .filter((taskPack) => taskPack.projectId === projectId)
    .map((taskPack) => ({
      taskPack,
      freshness: freshnessByTaskPackId.get(taskPack.id),
    }))
    .filter(
      (
        item,
      ): item is { taskPack: TaskPack; freshness: TaskPackFreshness } =>
        item.freshness !== undefined,
    )
    .sort((left, right) => {
      const leftTime = parseTimestamp(left.taskPack.createdAt) ?? 0;
      const rightTime = parseTimestamp(right.taskPack.createdAt) ?? 0;
      if (leftTime !== rightTime) return rightTime - leftTime;
      return right.taskPack.id - left.taskPack.id;
    });
}
