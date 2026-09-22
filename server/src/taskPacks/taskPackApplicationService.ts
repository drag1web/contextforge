import { TaskPackCurrentStateStorageError } from "../storage/types.js";
import type {
  StorageAdapter,
  TaskPackAggregateRecord,
  TaskPackCurrentRecord,
  TaskPackRevisionRecord,
} from "../storage/types.js";

export const TASK_PACK_CURRENT_STATE_INVALID =
  "TASK_PACK_CURRENT_STATE_INVALID" as const;

export class TaskPackCurrentStateError extends Error {
  readonly code = TASK_PACK_CURRENT_STATE_INVALID;

  constructor() {
    super("Task Pack current state is invalid.");
    this.name = "TaskPackCurrentStateError";
  }
}

export type TaskPackApplicationServiceStorage = Pick<
  StorageAdapter,
  | "listTaskPackCurrentRecords"
  | "getTaskPackCurrentRecordById"
  | "getTaskPackAggregate"
  | "getTaskPackRevisionById"
>;

export interface TaskPackApplicationService {
  listCurrentTaskPacks(): Promise<TaskPackCurrentRecord[]>;
  getCurrentTaskPack(taskPackId: number): Promise<TaskPackCurrentRecord | null>;
  getTaskPackAggregate(taskPackId: number): Promise<TaskPackAggregateRecord | null>;
  getCurrentTaskPackRevision(taskPackId: number): Promise<TaskPackRevisionRecord | null>;
}

function validateCurrentRecord(
  record: TaskPackCurrentRecord,
): TaskPackCurrentRecord {
  if (
    !Number.isSafeInteger(record.currentRevisionId) ||
    record.currentRevisionId <= 0
  ) {
    throw new TaskPackCurrentStateError();
  }
  return record;
}

function translateStorageCurrentStateError(error: unknown): never {
  if (error instanceof TaskPackCurrentStateStorageError) {
    throw new TaskPackCurrentStateError();
  }
  throw error;
}

export function createTaskPackApplicationService(
  storage: TaskPackApplicationServiceStorage,
): TaskPackApplicationService {
  async function readCurrentTaskPack(
    taskPackId: number,
  ): Promise<TaskPackCurrentRecord | null> {
    try {
      const record = await storage.getTaskPackCurrentRecordById(taskPackId);
      return record ? validateCurrentRecord(record) : null;
    } catch (error) {
      return translateStorageCurrentStateError(error);
    }
  }

  async function readAggregate(
    taskPackId: number,
  ): Promise<TaskPackAggregateRecord | null> {
    const current = await readCurrentTaskPack(taskPackId);
    if (!current) return null;
    const aggregate = await storage.getTaskPackAggregate(taskPackId);
    if (
      !aggregate ||
      aggregate.id !== current.id ||
      aggregate.currentRevisionId !== current.currentRevisionId
    ) {
      throw new TaskPackCurrentStateError();
    }
    return aggregate;
  }

  return {
    async listCurrentTaskPacks() {
      try {
        return (await storage.listTaskPackCurrentRecords()).map(
          validateCurrentRecord,
        );
      } catch (error) {
        return translateStorageCurrentStateError(error);
      }
    },

    async getCurrentTaskPack(taskPackId) {
      return readCurrentTaskPack(taskPackId);
    },

    getTaskPackAggregate(taskPackId) {
      return readAggregate(taskPackId);
    },

    async getCurrentTaskPackRevision(taskPackId) {
      const aggregate = await readAggregate(taskPackId);
      if (!aggregate) return null;

      const revision = await storage.getTaskPackRevisionById(
        aggregate.id,
        aggregate.currentRevisionId,
      );
      if (
        !revision ||
        revision.id !== aggregate.currentRevisionId ||
        revision.taskPackId !== aggregate.id
      ) {
        throw new TaskPackCurrentStateError();
      }
      return revision;
    },
  };
}
