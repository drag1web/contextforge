import type { Project, TaskPack } from "../types";

export type DashboardProjectAction = "buildContext" | "scan" | "createPack";

export const DASHBOARD_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

function hasIssue(project: Project, keywords: readonly string[]) {
  const text = [
    ...(project.readinessReport?.issues ?? []),
    ...(project.readinessReport?.checks?.map(
      (check) => `${check.key} ${check.label} ${check.message}`,
    ) ?? []),
  ]
    .join(" ")
    .toLowerCase();

  return keywords.some((keyword) => text.includes(keyword.toLowerCase()));
}

export function isDashboardProjectStale(
  project: Project,
  now = Date.now(),
) {
  if (!project.lastScanAt) return true;

  const scannedAt = new Date(project.lastScanAt).getTime();
  return !Number.isFinite(scannedAt) || now - scannedAt > DASHBOARD_STALE_AFTER_MS;
}

export function getDashboardAttentionProjects(
  projects: readonly Project[],
  now = Date.now(),
) {
  return [...projects]
    .filter(
      (project) =>
        project.readinessScore < 60 ||
        isDashboardProjectStale(project, now) ||
        (project.readinessReport?.issues?.length ?? 0) > 0,
    )
    .sort((a, b) => {
      const scoreDiff = a.readinessScore - b.readinessScore;
      if (scoreDiff !== 0) return scoreDiff;

      return (
        new Date(a.lastScanAt ?? 0).getTime() -
        new Date(b.lastScanAt ?? 0).getTime()
      );
    });
}

export function getDashboardProjectAction(
  project: Project,
  now = Date.now(),
): DashboardProjectAction {
  if (hasIssue(project, ["agents", "agents.md", "instructions"])) {
    return "buildContext";
  }

  if (isDashboardProjectStale(project, now)) return "scan";
  if (project.readinessScore < 60) return "buildContext";
  return "createPack";
}

export function getDashboardRecentTaskPacks(taskPacks: readonly TaskPack[]) {
  return [...taskPacks]
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
    .slice(0, 3);
}

export function getDashboardPrimaryProject(
  projects: readonly Project[],
  taskPacks: readonly TaskPack[],
  attentionProjects: readonly Project[],
) {
  const latestTaskPack = getDashboardRecentTaskPacks(taskPacks)[0];
  const latestTaskPackProject = latestTaskPack
    ? projects.find((project) => project.id === latestTaskPack.projectId)
    : null;

  return (
    attentionProjects[0] ??
    latestTaskPackProject ??
    [...projects].sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )[0] ??
    null
  );
}

const AWARENESS_ORDER = {
  changed: 0,
  comparison_limited: 1,
  first_observation: 2,
  unavailable: 3,
  unchanged: 4,
} as const;

export function getDashboardAwarenessProjects(projects: readonly Project[]) {
  return [...projects].sort((a, b) => {
    const aStatus = a.awareness?.status ?? "unavailable";
    const bStatus = b.awareness?.status ?? "unavailable";
    const statusDiff = AWARENESS_ORDER[aStatus] - AWARENESS_ORDER[bStatus];
    if (statusDiff !== 0) return statusDiff;

    const observedDiff =
      new Date(b.awareness?.lastObservedAt ?? b.lastScanAt ?? 0).getTime() -
      new Date(a.awareness?.lastObservedAt ?? a.lastScanAt ?? 0).getTime();
    if (observedDiff !== 0) return observedDiff;
    return a.id - b.id;
  });
}

export function getDashboardAwarenessCounts(projects: readonly Project[]) {
  let changed = 0;
  let limited = 0;
  let firstObservation = 0;
  let unavailable = 0;

  for (const project of projects) {
    if (!project.awareness) {
      unavailable += 1;
    } else if (project.awareness.status === "changed") {
      changed += 1;
    } else if (project.awareness.status === "comparison_limited") {
      limited += 1;
    } else if (project.awareness.status === "first_observation") {
      firstObservation += 1;
    }
  }

  return { changed, limited, firstObservation, unavailable };
}
