import type { TaskPack, TaskPackLifecycle, TaskPackReviewState, TaskPackWorkflowSummary } from "../types";

export type LifecycleFilter = "all" | "active" | "completed" | "archived";
type TaskPackIdentity = Pick<TaskPack, "id" | "currentRevisionId">;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const isId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const reviews: readonly TaskPackReviewState[] = ["unreviewed", "in_review", "accepted", "changes_requested"];

/** Closed library read DTO: no content, history, or mutation authority can survive parsing. */
export function parseTaskPackWorkflowIndex(value: unknown): readonly TaskPackWorkflowSummary[] {
  const invalid = () => { throw new Error("Invalid Task Pack workflow index response."); };
  if (!isRecord(value) || !exactKeys(value, ["ok", "workflows"]) || value.ok !== true || !Array.isArray(value.workflows)) return invalid();
  const seen = new Set<number>();
  return Object.freeze(value.workflows.map((item: unknown) => {
    if (!isRecord(item) || !exactKeys(item, ["taskPackId", "currentRevisionId", "lifecycle", "currentReviewState"]) ||
      !isId(item.taskPackId) || !isId(item.currentRevisionId) || seen.has(item.taskPackId) ||
      !reviews.includes(item.currentReviewState as TaskPackReviewState) || !isRecord(item.lifecycle) ||
      !exactKeys(item.lifecycle, ["state", "archivedFromState"])) return invalid();
    const { state, archivedFromState } = item.lifecycle;
    if (!((state === "active" || state === "completed") && archivedFromState === null) &&
      !(state === "archived" && (archivedFromState === "active" || archivedFromState === "completed"))) return invalid();
    seen.add(item.taskPackId);
    return Object.freeze({ taskPackId: item.taskPackId, currentRevisionId: item.currentRevisionId,
      lifecycle: Object.freeze({ state, archivedFromState }) as TaskPackLifecycle,
      currentReviewState: item.currentReviewState as TaskPackReviewState });
  }));
}

/** Independent collection/index reads only pair when BOTH identities agree. */
export function pairTaskPacksWithWorkflowSummaries(
  taskPacks: readonly TaskPackIdentity[], summaries: ReadonlyMap<number, TaskPackWorkflowSummary>,
): ReadonlyMap<number, TaskPackWorkflowSummary> {
  const paired = new Map<number, TaskPackWorkflowSummary>();
  for (const pack of taskPacks) {
    const summary = summaries.get(pack.id);
    if (summary?.taskPackId === pack.id && summary.currentRevisionId === pack.currentRevisionId) paired.set(pack.id, summary);
  }
  return paired;
}

export function getTaskPackLifecycleCounts(taskPacks: readonly TaskPackIdentity[], paired: ReadonlyMap<number, TaskPackWorkflowSummary>) {
  const counts = { all: taskPacks.length, active: 0, completed: 0, archived: 0 };
  for (const pack of taskPacks) {
    const summary = paired.get(pack.id);
    if (summary) counts[summary.lifecycle.state]++;
  }
  return counts;
}

export function filterTaskPacksByLifecycle<T extends TaskPackIdentity>(
  taskPacks: readonly T[], paired: ReadonlyMap<number, TaskPackWorkflowSummary>, filter: LifecycleFilter,
): T[] {
  return taskPacks.filter(pack => filter === "all" || paired.get(pack.id)?.lifecycle.state === filter);
}

/** Set identity, not array identity or ordering: imports/revisions invalidate once. */
export function taskPackWorkflowCollectionSignature(taskPacks: readonly TaskPackIdentity[]): string {
  return JSON.stringify(taskPacks.map(pack => [pack.id, pack.currentRevisionId ?? null] as const).sort((a, b) => a[0] - b[0]));
}

export interface TaskPackWorkflowIndexApi {
  getCurrentTaskPackWorkflowSummaries(): Promise<readonly TaskPackWorkflowSummary[]>;
}
export interface TaskPackWorkflowIndexSnapshot {
  readonly status: "loading" | "ready" | "failed";
  readonly signature: string | null;
  readonly byTaskPackId: ReadonlyMap<number, TaskPackWorkflowSummary>;
}

/** Workspace-owned, already paired read projection. No transition tokens or authority. */
export interface TaskPackWorkflowProjection {
  readonly status: TaskPackWorkflowIndexSnapshot["status"];
  readonly byTaskPackId: ReadonlyMap<number, TaskPackWorkflowSummary>;
  readonly retry: () => Promise<void>;
}

/** Cached Peek/Inspector targets may be older than the workspace collection. */
export function resolveTaskPackWorkflowSummary(taskPack: TaskPackIdentity, projection: TaskPackWorkflowProjection) {
  if (projection.status !== "ready") return undefined;
  const summary = projection.byTaskPackId.get(taskPack.id);
  return summary?.taskPackId === taskPack.id && summary.currentRevisionId === taskPack.currentRevisionId ? summary : undefined;
}

/** Result remains authoritative and responsive even if the shared read fails or stays pending. */
export async function refreshTaskPackWorkflowProjectionAfterActivity(
  activity: () => Promise<void>, refresh?: () => Promise<void>,
) {
  try { await activity(); }
  finally {
    try { void refresh?.().catch(() => {}); }
    catch { /* Shared read failure must not change the Result operation outcome. */ }
  }
}

/** Observable read-only owner. Failures retain no backend message, cause, stack, or evidence. */
export function createTaskPackWorkflowIndexController(api: TaskPackWorkflowIndexApi) {
  let snapshot: TaskPackWorkflowIndexSnapshot = { status: "loading", signature: null, byTaskPackId: new Map() };
  let alive = false;
  let generation = 0;
  const listeners = new Set<() => void>();
  const publish = (next: TaskPackWorkflowIndexSnapshot) => { snapshot = next; listeners.forEach(listener => listener()); };
  async function load(signature: string) {
    const request = ++generation;
    publish({ status: "loading", signature, byTaskPackId: new Map() });
    try {
      const summaries = await api.getCurrentTaskPackWorkflowSummaries();
      if (alive && generation === request) publish({ status: "ready", signature,
        byTaskPackId: new Map(summaries.map(summary => [summary.taskPackId, summary])) });
    } catch {
      if (alive && generation === request) publish({ status: "failed", signature, byTaskPackId: new Map() });
    }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    activate: (signature: string) => {
      if (alive && snapshot.signature === signature) return Promise.resolve();
      alive = true;
      return load(signature);
    },
    retry: () => alive && snapshot.status !== "loading" && snapshot.signature !== null ? load(snapshot.signature) : Promise.resolve(),
    // Explicit workflow activity can invalidate an in-flight read of the SAME collection.
    refresh: () => alive && snapshot.signature !== null ? load(snapshot.signature) : Promise.resolve(),
    dispose: () => { alive = false; ++generation; },
  };
}
