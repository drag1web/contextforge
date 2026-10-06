import type { TaskPack } from "../types";
import type { DesktopSyncCloudTaskPack } from "../types/desktopSync";

type OriginPair = { originTaskPackId: number; originRevisionId: number }
  | { originTaskPackId?: never; originRevisionId?: never };

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** No revision read: identity belongs to the same current flat projection. */
export function getDesktopSyncPublishOriginIdentity(taskPack: Pick<TaskPack, "id" | "currentRevisionId">): OriginPair {
  return isPositiveSafeInteger(taskPack.currentRevisionId)
    ? { originTaskPackId: taskPack.id, originRevisionId: taskPack.currentRevisionId }
    : {};
}

/** Electron validates the pair; never downgrade a partial runtime value here. */
export function getDesktopSyncImportOriginIdentity(taskPack: Pick<DesktopSyncCloudTaskPack, "originTaskPackId" | "originRevisionId">): OriginPair {
  if (taskPack.originTaskPackId === undefined && taskPack.originRevisionId === undefined) return {};
  if (!isPositiveSafeInteger(taskPack.originTaskPackId) || !isPositiveSafeInteger(taskPack.originRevisionId)) {
    throw new Error("Invalid Task Pack origin identity.");
  }
  return { originTaskPackId: taskPack.originTaskPackId, originRevisionId: taskPack.originRevisionId };
}
