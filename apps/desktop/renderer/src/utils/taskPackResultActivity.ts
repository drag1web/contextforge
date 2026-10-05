import type { TaskPack } from "../types";
import type { TaskPackWorkflowOperation } from "./taskPackWorkflow";

/** Instance + activation identity, not just a pack ID (A -> B -> A and StrictMode). */
export function createTaskPackResultActivityOwner(taskPackId: number) {
  let alive = true;
  let generation = 0;
  return {
    taskPackId,
    capture: () => generation,
    owns: (token: number) => alive && token === generation,
    activate: () => { alive = true; },
    dispose: () => { alive = false; ++generation; },
  };
}
type ResultActivityOwner = ReturnType<typeof createTaskPackResultActivityOwner>;
export interface TaskPackResultActivity {
  readonly taskPackId: number;
  readonly isCurrent: () => boolean;
}
export function captureTaskPackResultActivity(owner: ResultActivityOwner, currentOwner: () => ResultActivityOwner): TaskPackResultActivity {
  const token = owner.capture();
  return { taskPackId: owner.taskPackId, isCurrent: () => currentOwner() === owner && owner.owns(token) };
}

/** Historical state is reread, never synthesized from the current document. */
export async function saveTaskPackResultContent(activity: TaskPackResultActivity, save: () => Promise<TaskPack>,
  onUpdated: (taskPack: TaskPack) => void, invalidateHistory: () => Promise<void>): Promise<TaskPack | null> {
  if (!activity.isCurrent()) return null;
  const nextTaskPack = await save();
  if (!activity.isCurrent() || nextTaskPack.id !== activity.taskPackId) return null;
  onUpdated(nextTaskPack);
  if (activity.isCurrent()) void invalidateHistory(); // history failure cannot roll back a successful edit
  return nextTaskPack;
}

/** Called by the workflow success observer, never by attempted/failed mutations. */
export function invalidateTaskPackHistoryAfterReview(activity: TaskPackResultActivity, operation: TaskPackWorkflowOperation,
  invalidateHistory: () => Promise<void>): void {
  if (activity.isCurrent() && operation.taskPackId === activity.taskPackId &&
    (operation.action === "start_review" || operation.action === "accept" || operation.action === "request_changes")) {
    void invalidateHistory();
  }
}
