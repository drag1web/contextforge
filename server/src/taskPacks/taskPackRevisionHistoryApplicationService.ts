import { validateTaskPackRevisionHistorySnapshot } from "../storage/taskPackRevisionHistory.js";
import {
  TaskPackRevisionHistoryStorageError,
  type StorageAdapter,
  type TaskPackRevisionHistorySnapshot,
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

export interface TaskPackRevisionDetailItem extends TaskPackRevisionHistoryListItem {
  readonly rawTask: string;
  readonly taskType: string;
  readonly targetTool: string;
  readonly generatedPrompt: string;
}

export interface TaskPackRevisionDetail {
  readonly taskPackId: number;
  readonly currentRevisionId: number;
  readonly revision: TaskPackRevisionDetailItem;
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
  getTaskPackRevisionDetail(taskPackId: number, revisionId: number): Promise<TaskPackRevisionDetail | null>;
}

function assertHistoryIdentity(id: number): void {
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new TaskPackRevisionHistoryApplicationError("TASK_PACK_REVISION_HISTORY_INPUT_INVALID");
  }
}

function projectRevisionMetadata(revision: TaskPackRevision, reviewState: TaskPackReviewState): TaskPackRevisionHistoryListItem {
  return {
    id: revision.id, revisionNumber: revision.revisionNumber,
    baseRevisionId: revision.baseRevisionId, sourceKind: revision.sourceKind,
    createdAt: revision.createdAt, generatedAt: revision.generatedAt,
    contentHash: revision.contentHash, generationMode: revision.generationMode,
    generationModel: revision.generationModel, generationUsedFallback: revision.generationUsedFallback,
    reviewState,
  };
}

export function createTaskPackRevisionHistoryApplicationService(
  storage: TaskPackRevisionHistoryApplicationServiceStorage,
): TaskPackRevisionHistoryApplicationService {
  async function readHistory(taskPackId: number) {
    let snapshot: TaskPackRevisionHistorySnapshot | null;
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
      return { snapshot, reviewStates: validateTaskPackRevisionHistorySnapshot(taskPackId, snapshot) };
    } catch {
      // Pure validation only, never an operational storage error boundary.
      throw new TaskPackRevisionHistoryApplicationError("TASK_PACK_REVISION_HISTORY_STATE_INVALID");
    }
  }

  return {
    async getTaskPackRevisionHistoryList(taskPackId) {
      assertHistoryIdentity(taskPackId);
      const history = await readHistory(taskPackId);
      if (!history) return null;
      const { snapshot, reviewStates } = history;
      return {
        taskPackId: snapshot.aggregate.id,
        currentRevisionId: snapshot.aggregate.currentRevisionId,
        revisions: snapshot.revisions.map(({ revision }, index) => projectRevisionMetadata(revision, reviewStates[index])),
      };
    },

    async getTaskPackRevisionDetail(taskPackId, revisionId) {
      assertHistoryIdentity(taskPackId);
      assertHistoryIdentity(revisionId);
      const history = await readHistory(taskPackId);
      if (!history) return null;
      const { snapshot, reviewStates } = history;
      // Validate the whole history before selecting; corruption is never hidden
      // by returning just a valid-looking requested revision or an early 404.
      const index = snapshot.revisions.findIndex(item => item.revision.id === revisionId);
      if (index === -1) return null;
      const { revision } = snapshot.revisions[index];
      return {
        taskPackId: snapshot.aggregate.id,
        currentRevisionId: snapshot.aggregate.currentRevisionId,
        revision: {
          ...projectRevisionMetadata(revision, reviewStates[index]),
          rawTask: revision.rawTask, taskType: revision.taskType,
          targetTool: revision.targetTool, generatedPrompt: revision.generatedPrompt,
        },
      };
    },
  };
}
