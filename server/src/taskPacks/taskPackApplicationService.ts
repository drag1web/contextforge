import { TaskPackCurrentStateStorageError } from "../storage/types.js";
import type {
  CreateTaskPackWithInitialRevisionInput,
  StorageAdapter,
  TaskPackAggregateRecord,
  TaskPackCurrentRecord,
  TaskPackRecord,
  TaskPackRevisionRecord,
} from "../storage/types.js";
import type {
  TaskPackJsonObject,
  TaskPackJsonValue,
  TaskPackRevisionContent,
} from "./taskPackLifecycle.js";

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
  | "createTaskPackWithInitialRevision"
>;

type GeneratedRevisionContentInput = Omit<
  TaskPackRevisionContent,
  | "sourceKind"
  | "generationRecipe"
  | "diagnostics"
  | "groundedContextSnapshot"
  | "freshnessBasis"
>;

export interface CreateGeneratedTaskPackInput {
  readonly projectId: number;
  readonly title: string;
  readonly generatedAt: string;
  readonly revisionContent: GeneratedRevisionContentInput;
  readonly generationRecipe: unknown;
  readonly selectorDiagnostics: unknown | null;
  readonly generationDiagnostics: unknown | null;
  readonly performanceDiagnostics: unknown | null;
}

export interface TaskPackApplicationService {
  listCurrentTaskPacks(): Promise<TaskPackCurrentRecord[]>;
  getCurrentTaskPack(taskPackId: number): Promise<TaskPackCurrentRecord | null>;
  getTaskPackAggregate(taskPackId: number): Promise<TaskPackAggregateRecord | null>;
  getCurrentTaskPackRevision(taskPackId: number): Promise<TaskPackRevisionRecord | null>;
  createGeneratedTaskPack(input: CreateGeneratedTaskPackInput): Promise<TaskPackRecord>;
}

export class TaskPackGeneratedCreateInputError extends Error {
  readonly code = "TASK_PACK_GENERATED_CREATE_INVALID" as const;

  constructor(message: string) {
    super(message);
    this.name = "TaskPackGeneratedCreateInputError";
  }
}

const RECIPE_DIAGNOSTIC_FIELDS = [
  "selectorDiagnostics",
  "generationDiagnostics",
  "performanceDiagnostics",
] as const;

function normalizeJsonObject(value: unknown, label: string): TaskPackJsonObject {
  const normalized = normalizeJsonValue(value, label, new WeakSet<object>());
  if (
    normalized === undefined ||
    normalized === null ||
    typeof normalized !== "object" ||
    Array.isArray(normalized)
  ) {
    throw new TaskPackGeneratedCreateInputError(
      `${label} must be a JSON-safe object.`,
    );
  }
  return normalized as TaskPackJsonObject;
}

function normalizeNullableJsonObject(
  value: unknown | null,
  label: string,
): TaskPackJsonObject | null {
  return value === null ? null : normalizeJsonObject(value, label);
}

function normalizeJsonValue(
  value: unknown,
  label: string,
  seen: WeakSet<object>,
): TaskPackJsonValue | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TaskPackGeneratedCreateInputError(
        `${label} cannot contain non-finite numbers.`,
      );
    }
    return value;
  }
  if (typeof value !== "object") {
    throw new TaskPackGeneratedCreateInputError(
      `${label} must contain only JSON-safe values.`,
    );
  }
  if (seen.has(value)) {
    throw new TaskPackGeneratedCreateInputError(`${label} cannot be cyclic.`);
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => {
        const normalized = normalizeJsonValue(item, label, seen);
        if (normalized === undefined) {
          throw new TaskPackGeneratedCreateInputError(
            `${label} arrays cannot contain undefined values.`,
          );
        }
        return normalized;
      });
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TaskPackGeneratedCreateInputError(
        `${label} must contain only plain JSON objects.`,
      );
    }
    const normalized: Record<string, TaskPackJsonValue> = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") {
        throw new TaskPackGeneratedCreateInputError(
          `${label} cannot contain symbol keys.`,
        );
      }
      const item = normalizeJsonValue(
        (value as Record<string, unknown>)[key],
        label,
        seen,
      );
      if (item !== undefined) normalized[key] = item;
    }
    return normalized;
  } finally {
    seen.delete(value);
  }
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

    async createGeneratedTaskPack(input) {
      const generationRecipe = normalizeJsonObject(
        input.generationRecipe,
        "Task Pack generation recipe",
      );
      for (const field of RECIPE_DIAGNOSTIC_FIELDS) {
        if (Object.hasOwn(generationRecipe, field)) {
          throw new TaskPackGeneratedCreateInputError(
            `Task Pack generation recipe cannot contain ${field}.`,
          );
        }
      }

      const selector = normalizeNullableJsonObject(
        input.selectorDiagnostics,
        "Task Pack selector diagnostics",
      );
      const generation = normalizeNullableJsonObject(
        input.generationDiagnostics,
        "Task Pack generation diagnostics",
      );
      const performance = normalizeNullableJsonObject(
        input.performanceDiagnostics,
        "Task Pack performance diagnostics",
      );
      const revisionContent: TaskPackRevisionContent = {
        sourceKind: "generated",
        rawTask: input.revisionContent.rawTask,
        taskType: input.revisionContent.taskType,
        targetTool: input.revisionContent.targetTool,
        generatedPrompt: input.revisionContent.generatedPrompt,
        generationMode: input.revisionContent.generationMode,
        generationModel: input.revisionContent.generationModel,
        generationMessage: input.revisionContent.generationMessage,
        generationUsedFallback: input.revisionContent.generationUsedFallback,
        generationDurationMs: input.revisionContent.generationDurationMs,
        generationRecipe,
        diagnostics: { selector, generation, performance },
        groundedContextSnapshot: null,
        freshnessBasis: null,
      };
      const compatibilityGenerationRecipe: TaskPackJsonObject = {
        ...generationRecipe,
        selectorDiagnostics: selector,
        generationDiagnostics: generation,
        performanceDiagnostics: performance,
      };
      const storageInput: CreateTaskPackWithInitialRevisionInput = {
        projectId: input.projectId,
        title: input.title,
        revisionContent,
        generatedAt: input.generatedAt,
        compatibilityGenerationRecipe,
      };
      return storage.createTaskPackWithInitialRevision(storageInput);
    },
  };
}
