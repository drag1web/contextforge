import { z } from "zod";

import type { ProjectScanObservation } from "../scanner/projectScanner.js";
import type { ProjectRecord, StorageAdapter } from "../storage/types.js";

const PROJECT_AWARENESS_VERSION = 1 as const;
const MAX_OBSERVED_FILES = 6500;

const readinessCheckSnapshotSchema = z
  .object({
    key: z.string().min(1).max(120),
    passed: z.boolean(),
    points: z.number().finite()
  })
  .strict();

const projectAwarenessSnapshotSchema = z
  .object({
    version: z.literal(PROJECT_AWARENESS_VERSION),
    observedAt: z.string().datetime(),
    readinessScore: z.number().int().min(0).max(100),
    readinessChecks: z.array(readinessCheckSnapshotSchema).max(100),
    filePaths: z.array(z.string().min(1).max(1024)).max(MAX_OBSERVED_FILES),
    inventoryTruncated: z.boolean()
  })
  .strict();

const projectAwarenessStateSchema = z
  .object({
    version: z.literal(PROJECT_AWARENESS_VERSION),
    previous: projectAwarenessSnapshotSchema.nullable(),
    current: projectAwarenessSnapshotSchema
  })
  .strict();

export type ProjectAwarenessStatus =
  | "first_observation"
  | "unchanged"
  | "changed"
  | "comparison_limited";

export type ReadinessDirection = "improved" | "unchanged" | "decreased";

export interface ProjectAwarenessReadinessChange {
  previous: number;
  current: number;
  direction: ReadinessDirection;
}

export interface ProjectAwarenessReadinessCheckChange {
  key: string;
  previousPassed: boolean | null;
  currentPassed: boolean | null;
  previousPoints: number | null;
  currentPoints: number | null;
}

export interface ProjectAwarenessView {
  status: ProjectAwarenessStatus;
  lastObservedAt: string;
  previousObservedAt: string | null;
  knownFileCount: number;
  inventoryTruncated: boolean;
  fileComparison: "available" | "limited";
  fileChanges: {
    added: string[];
    removed: string[];
  } | null;
  readinessChange: ProjectAwarenessReadinessChange | null;
  readinessCheckChanges: ProjectAwarenessReadinessCheckChange[];
}

export type ProjectAwarenessSnapshot = z.infer<
  typeof projectAwarenessSnapshotSchema
>;
export type ProjectAwarenessState = z.infer<typeof projectAwarenessStateSchema>;

function awarenessSettingKey(projectId: number) {
  return `project-awareness.v${PROJECT_AWARENESS_VERSION}.${projectId}`;
}

function compareText(left: string, right: string) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function normalizeObservedProjectPath(value: string) {
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

  return value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function normalizeObservedPaths(paths: string[]) {
  return [...new Set(paths.map(normalizeObservedProjectPath).filter(isSafeRepositoryRelativePath))]
    .sort(compareText);
}

function normalizeReadinessChecks(project: ProjectRecord) {
  return [...project.readinessReport.checks]
    .map((check) => ({
      key: check.key,
      passed: check.passed,
      points: check.points
    }))
    .sort((left, right) => compareText(left.key, right.key));
}

export function parseProjectAwarenessState(value: unknown): ProjectAwarenessState | null {
  const parsed = projectAwarenessStateSchema.safeParse(value);

  if (!parsed.success) {
    return null;
  }

  const snapshots = [parsed.data.previous, parsed.data.current].filter(
    (snapshot): snapshot is ProjectAwarenessSnapshot => snapshot !== null
  );

  const pathsAreCanonical = snapshots.every((snapshot) => {
    const normalizedPaths = normalizeObservedPaths(snapshot.filePaths);

    return (
      normalizedPaths.length === snapshot.filePaths.length &&
      snapshot.filePaths.every((filePath, index) => normalizedPaths[index] === filePath)
    );
  });

  return pathsAreCanonical ? parsed.data : null;
}

export function createProjectAwarenessSnapshot(
  project: ProjectRecord,
  observation: ProjectScanObservation
): ProjectAwarenessSnapshot {
  const observedAt = new Date(project.lastScanAt ?? project.updatedAt).toISOString();

  return {
    version: PROJECT_AWARENESS_VERSION,
    observedAt,
    readinessScore: project.readinessScore,
    readinessChecks: normalizeReadinessChecks(project),
    filePaths: normalizeObservedPaths(observation.filePaths),
    inventoryTruncated: observation.inventoryTruncated
  };
}

export function advanceProjectAwarenessState(
  existing: ProjectAwarenessState | null,
  current: ProjectAwarenessSnapshot
): ProjectAwarenessState {
  return {
    version: PROJECT_AWARENESS_VERSION,
    previous: existing?.current ?? null,
    current
  };
}

function compareReadiness(
  previous: ProjectAwarenessSnapshot,
  current: ProjectAwarenessSnapshot
): ProjectAwarenessReadinessChange {
  return {
    previous: previous.readinessScore,
    current: current.readinessScore,
    direction:
      current.readinessScore > previous.readinessScore
        ? "improved"
        : current.readinessScore < previous.readinessScore
          ? "decreased"
          : "unchanged"
  };
}

function compareReadinessChecks(
  previous: ProjectAwarenessSnapshot,
  current: ProjectAwarenessSnapshot
) {
  const previousByKey = new Map(previous.readinessChecks.map((check) => [check.key, check]));
  const currentByKey = new Map(current.readinessChecks.map((check) => [check.key, check]));
  const keys = [...new Set([...previousByKey.keys(), ...currentByKey.keys()])].sort(compareText);

  return keys.flatMap<ProjectAwarenessReadinessCheckChange>((key) => {
    const previousCheck = previousByKey.get(key);
    const currentCheck = currentByKey.get(key);

    if (
      previousCheck?.passed === currentCheck?.passed &&
      previousCheck?.points === currentCheck?.points
    ) {
      return [];
    }

    return [
      {
        key,
        previousPassed: previousCheck?.passed ?? null,
        currentPassed: currentCheck?.passed ?? null,
        previousPoints: previousCheck?.points ?? null,
        currentPoints: currentCheck?.points ?? null
      }
    ];
  });
}

export function buildProjectAwarenessView(
  state: ProjectAwarenessState
): ProjectAwarenessView {
  const { current, previous } = state;

  if (!previous) {
    return {
      status: "first_observation",
      lastObservedAt: current.observedAt,
      previousObservedAt: null,
      knownFileCount: current.filePaths.length,
      inventoryTruncated: current.inventoryTruncated,
      fileComparison: current.inventoryTruncated ? "limited" : "available",
      fileChanges: null,
      readinessChange: null,
      readinessCheckChanges: []
    };
  }

  const readinessChange = compareReadiness(previous, current);
  const readinessCheckChanges = compareReadinessChecks(previous, current);
  const fileComparison =
    previous.inventoryTruncated || current.inventoryTruncated ? "limited" : "available";
  let fileChanges: ProjectAwarenessView["fileChanges"] = null;

  if (fileComparison === "available") {
    const previousPaths = new Set(previous.filePaths);
    const currentPaths = new Set(current.filePaths);
    fileChanges = {
      added: current.filePaths.filter((filePath) => !previousPaths.has(filePath)),
      removed: previous.filePaths.filter((filePath) => !currentPaths.has(filePath))
    };
  }

  const hasKnownChange =
    readinessChange.direction !== "unchanged" ||
    readinessCheckChanges.length > 0 ||
    Boolean(fileChanges && (fileChanges.added.length > 0 || fileChanges.removed.length > 0));

  return {
    status: hasKnownChange
      ? "changed"
      : fileComparison === "limited"
        ? "comparison_limited"
        : "unchanged",
    lastObservedAt: current.observedAt,
    previousObservedAt: previous.observedAt,
    knownFileCount: current.filePaths.length,
    inventoryTruncated: current.inventoryTruncated,
    fileComparison,
    fileChanges,
    readinessChange,
    readinessCheckChanges
  };
}

export async function readProjectAwareness(
  storage: StorageAdapter,
  projectId: number
): Promise<ProjectAwarenessView | null> {
  const rawState = await storage.getSettingValue<unknown>(awarenessSettingKey(projectId), null);
  const state = parseProjectAwarenessState(rawState);
  return state ? buildProjectAwarenessView(state) : null;
}

export async function recordProjectAwareness(
  storage: StorageAdapter,
  project: ProjectRecord,
  observation: ProjectScanObservation
): Promise<ProjectAwarenessView> {
  const key = awarenessSettingKey(project.id);
  const rawState = await storage.getSettingValue<unknown>(key, null);
  const existing = parseProjectAwarenessState(rawState);
  const current = createProjectAwarenessSnapshot(project, observation);
  const nextState = advanceProjectAwarenessState(existing, current);

  await storage.setSettingValue(key, nextState);
  return buildProjectAwarenessView(nextState);
}
