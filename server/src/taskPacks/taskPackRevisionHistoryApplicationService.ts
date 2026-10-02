import { validateTaskPackRevisionHistorySnapshot } from "../storage/taskPackRevisionHistory.js";
import {
  TaskPackRevisionHistoryStorageError,
  type StorageAdapter,
} from "../storage/types.js";
import type { TaskPackRevision, TaskPackReviewState } from "./taskPackLifecycle.js";

export type TaskPackRevisionHistoryApplicationServiceStorage = Pick<StorageAdapter,
  "getTaskPackRevisionHistorySnapshot">;

export interface TaskPackRevisionHistoryListItem {
  readonly id: number;
  readonly revisionNumber: number;
  readonly baseRevisionId: number | null;
  readonly sourceKind: TaskPackRevision["sourceKind"];
  readonly createdAt: string;
  readonly generatedAt: string | null;
  readonly contentHash: string;
  readonly generationMode: TaskPackRevision["generationMode"];
  readonly generationModel: string | null;
  readonly generationUsedFallback: boolean;
  readonly reviewState: TaskPackReviewState;
}

export interface TaskPackRevisionHistoryList {
  readonly taskPackId: number;
  readonly currentRevisionId: number;
  readonly revisions: readonly TaskPackRevisionHistoryListItem[];
}

export class TaskPackRevisionHistoryApplicationError extends Error {
  constructor(readonly code: "TASK_PACK_REVISION_HISTORY_INPUT_INVALID" | "TASK_PACK_REVISION_HISTORY_STATE_INVALID") {
    super(code === "TASK_PACK_REVISION_HISTORY_INPUT_INVALID"
      ? "Task Pack revision history identity is invalid."
      : "Task Pack revision history is invalid.");
    this.name = "TaskPackRevisionHistoryApplicationError";
  }
}

export interface TaskPackRevisionHistoryApplicationService {
  getTaskPackRevisionHistoryList(taskPackId: number): Promise<TaskPackRevisionHistoryList | null>;
}

export function createTaskPackRevisionHistoryApplicationService(
  storage: TaskPackRevisionHistoryApplicationServiceStorage,
): TaskPackRevisionHistoryApplicationService {
  return {
    async getTaskPackRevisionHistoryList(taskPackId) {
      if (!Number.isSafeInteger(taskPackId) || taskPackId < 1) {
        throw new TaskPackRevisionHistoryApplicationError("TASK_PACK_REVISION_HISTORY_INPUT_INVALID");
      }
      let snapshot;
      try {
        snapshot = await storage.getTaskPackRevisionHistorySnapshot(taskPackId);
      } catch (error) {
        if (error instanceof TaskPackRevisionHistoryStorageError) {
          throw new TaskPackRevisionHistoryApplicationError("TASK_PACK_REVISION_HISTORY_STATE_INVALID");
        }
        // No message inspection or catch-all relabeling of operational failures.
        throw error;
      }
      if (snapshot === null) return null;
      try {
        const reviewStates = validateTaskPackRevisionHistorySnapshot(taskPackId, snapshot);
        return {
          taskPackId: snapshot.aggregate.id,
          currentRevisionId: snapshot.aggregate.currentRevisionId,
          revisions: snapshot.revisions.map(({ revision }, index) => ({
            id: revision.id, revisionNumber: revision.revisionNumber,
            baseRevisionId: revision.baseRevisionId, sourceKind: revision.sourceKind,
            createdAt: revision.createdAt, generatedAt: revision.generatedAt,
            contentHash: revision.contentHash, generationMode: revision.generationMode,
            generationModel: revision.generationModel, generationUsedFallback: revision.generationUsedFallback,
            reviewState: reviewStates[index],
          })),
        };
      } catch {
        // Pure snapshot validation/projection only, with no storage reads here.
        throw new TaskPackRevisionHistoryApplicationError("TASK_PACK_REVISION_HISTORY_STATE_INVALID");
      }
    },
  };
}
