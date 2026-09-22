import {
  buildTaskPackGitHubCreatedIssueCompatibilityLink,
  TaskPackCurrentStateStorageError,
  TaskPackGitHubCreatedIssueLinkStorageError,
  TaskPackRevisionAppendStorageError,
} from "../storage/types.js";
import type {
  CreateTaskPackGitHubCreatedIssueLinkInput,
  CreateTaskPackWithInitialRevisionInput,
  StorageAdapter,
  TaskPackAggregateRecord,
  TaskPackCurrentRecord,
  TaskPackRecord,
  TaskPackRevisionRecord,
} from "../storage/types.js";
import type { GitHubCreatedIssueLink } from "../github/githubTypes.js";
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
  | "appendTaskPackRevision"
  | "getTaskPackGitHubCreatedIssueLink"
  | "createTaskPackGitHubCreatedIssueLink"
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

export interface EditTaskPackContentInput {
  readonly taskPackId: number;
  readonly expectedCurrentRevisionId: number;
  readonly rawTask?: string;
  readonly generatedPrompt?: string;
}

export interface TaskPackApplicationService {
  listCurrentTaskPacks(): Promise<TaskPackCurrentRecord[]>;
  getCurrentTaskPack(taskPackId: number): Promise<TaskPackCurrentRecord | null>;
  getTaskPackAggregate(taskPackId: number): Promise<TaskPackAggregateRecord | null>;
  getCurrentTaskPackRevision(taskPackId: number): Promise<TaskPackRevisionRecord | null>;
  createGeneratedTaskPack(input: CreateGeneratedTaskPackInput): Promise<TaskPackRecord>;
  editTaskPackContent(input: EditTaskPackContentInput): Promise<TaskPackCurrentRecord>;
  getGitHubCreatedIssueLink(taskPackId: number): Promise<GitHubCreatedIssueLink | null>;
  linkCreatedGitHubIssue(
    input: CreateTaskPackGitHubCreatedIssueLinkInput,
  ): Promise<GitHubCreatedIssueLink>;
}

export class TaskPackNotFoundError extends Error {
  readonly code = "TASK_PACK_NOT_FOUND" as const;

  constructor(readonly taskPackId: number) {
    super("Task Pack not found.");
    this.name = "TaskPackNotFoundError";
  }
}

export class TaskPackRevisionConflictError extends Error {
  readonly code = "TASK_PACK_REVISION_CONFLICT" as const;

  constructor(
    readonly taskPackId: number,
    readonly expectedCurrentRevisionId: number,
    readonly actualCurrentRevisionId: number,
  ) {
    super(
      "Task Pack changed after this editor was opened. Close and reopen the editor to edit the latest revision.",
    );
    this.name = "TaskPackRevisionConflictError";
  }
}

export class TaskPackNotEditableError extends Error {
  readonly code = "TASK_PACK_NOT_EDITABLE" as const;

  constructor(readonly taskPackId: number) {
    super("Only an active Task Pack can be edited.");
    this.name = "TaskPackNotEditableError";
  }
}

export class TaskPackEditInputError extends Error {
  readonly code = "TASK_PACK_EDIT_INVALID" as const;

  constructor(message: string) {
    super(message);
    this.name = "TaskPackEditInputError";
  }
}

export class TaskPackGeneratedCreateInputError extends Error {
  readonly code = "TASK_PACK_GENERATED_CREATE_INVALID" as const;

  constructor(message: string) {
    super(message);
    this.name = "TaskPackGeneratedCreateInputError";
  }
}

export class TaskPackGitHubCreatedIssueAlreadyLinkedError extends Error {
  readonly code = "TASK_PACK_GITHUB_CREATED_ISSUE_LINK_EXISTS" as const;

  constructor() {
    super("This Task Pack is already linked to a created GitHub issue.");
    this.name = "TaskPackGitHubCreatedIssueAlreadyLinkedError";
  }
}

const RECIPE_DIAGNOSTIC_FIELDS = [
  "selectorDiagnostics",
  "generationDiagnostics",
  "performanceDiagnostics",
  "githubCreatedIssue",
] as const;

const MANUAL_EDIT_RECIPE_FIELDS = [
  "template",
  "ruleProfile",
  "enabledRules",
  "customRules",
  "acceptanceCriteriaPreset",
  "acceptanceCriteria",
  "counts",
] as const;

function cloneJsonValue(value: TaskPackJsonValue): TaskPackJsonValue {
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneJsonValue(item)]),
    );
  }
  return value;
}

function buildManualEditGenerationRecipe(
  recipe: TaskPackJsonObject | null,
): TaskPackJsonObject | null {
  if (recipe === null) return null;
  const retained: Record<string, TaskPackJsonValue> = {};
  for (const field of MANUAL_EDIT_RECIPE_FIELDS) {
    if (Object.hasOwn(recipe, field)) {
      retained[field] = cloneJsonValue(recipe[field]!);
    }
  }
  return Object.keys(retained).length > 0 ? retained : null;
}

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

    async editTaskPackContent(input) {
      if (
        !Number.isSafeInteger(input.taskPackId) ||
        input.taskPackId <= 0 ||
        !Number.isSafeInteger(input.expectedCurrentRevisionId) ||
        input.expectedCurrentRevisionId <= 0 ||
        (input.rawTask === undefined && input.generatedPrompt === undefined)
      ) {
        throw new TaskPackEditInputError("Task Pack edit input is invalid.");
      }

      const current = await readCurrentTaskPack(input.taskPackId);
      if (!current) throw new TaskPackNotFoundError(input.taskPackId);
      if (current.currentRevisionId !== input.expectedCurrentRevisionId) {
        throw new TaskPackRevisionConflictError(
          input.taskPackId,
          input.expectedCurrentRevisionId,
          current.currentRevisionId,
        );
      }

      const aggregate = await storage.getTaskPackAggregate(input.taskPackId);
      if (!aggregate) throw new TaskPackNotFoundError(input.taskPackId);
      if (aggregate.currentRevisionId !== input.expectedCurrentRevisionId) {
        throw new TaskPackRevisionConflictError(
          input.taskPackId,
          input.expectedCurrentRevisionId,
          aggregate.currentRevisionId,
        );
      }
      if (aggregate.lifecycle.state !== "active") {
        throw new TaskPackNotEditableError(input.taskPackId);
      }

      const base = await storage.getTaskPackRevisionById(
        input.taskPackId,
        input.expectedCurrentRevisionId,
      );
      if (
        !base ||
        base.id !== input.expectedCurrentRevisionId ||
        base.taskPackId !== input.taskPackId
      ) {
        throw new TaskPackCurrentStateError();
      }

      const rawTask = input.rawTask ?? base.rawTask;
      const generatedPrompt = input.generatedPrompt ?? base.generatedPrompt;
      if (rawTask === base.rawTask && generatedPrompt === base.generatedPrompt) {
        return current;
      }

      try {
        await storage.appendTaskPackRevision({
          taskPackId: input.taskPackId,
          baseRevisionId: input.expectedCurrentRevisionId,
          sourceKind: "manual_edit",
          rawTask,
          taskType: base.taskType,
          targetTool: base.targetTool,
          generatedPrompt,
          generationMode: base.generationMode,
          generationModel: null,
          generationMessage: null,
          generationUsedFallback: false,
          generationDurationMs: null,
          generationRecipe: buildManualEditGenerationRecipe(
            base.generationRecipe,
          ),
          diagnostics: null,
          groundedContextSnapshot: null,
          freshnessBasis: null,
          createdAt: new Date().toISOString(),
          generatedAt: null,
        });
      } catch (error) {
        if (error instanceof TaskPackCurrentStateStorageError) {
          throw new TaskPackCurrentStateError();
        }
        if (error instanceof TaskPackRevisionAppendStorageError) {
          if (error.code === "TASK_PACK_NOT_FOUND") {
            throw new TaskPackNotFoundError(input.taskPackId);
          }
          if (error.code === "TASK_PACK_NOT_ACTIVE") {
            throw new TaskPackNotEditableError(input.taskPackId);
          }
          if (error.code === "TASK_PACK_REVISION_CONFLICT") {
            if (
              !Number.isSafeInteger(error.expectedCurrentRevisionId) ||
              !Number.isSafeInteger(error.actualCurrentRevisionId) ||
              (error.expectedCurrentRevisionId ?? 0) <= 0 ||
              (error.actualCurrentRevisionId ?? 0) <= 0
            ) {
              throw new TaskPackCurrentStateError();
            }
            throw new TaskPackRevisionConflictError(
              input.taskPackId,
              error.expectedCurrentRevisionId!,
              error.actualCurrentRevisionId!,
            );
          }
          throw new TaskPackCurrentStateError();
        }
        throw error;
      }

      const latest = await readCurrentTaskPack(input.taskPackId);
      if (!latest) throw new TaskPackCurrentStateError();
      return latest;
    },

    async getGitHubCreatedIssueLink(taskPackId) {
      const link = await storage.getTaskPackGitHubCreatedIssueLink(taskPackId);
      return link
        ? buildTaskPackGitHubCreatedIssueCompatibilityLink(link)
        : null;
    },

    async linkCreatedGitHubIssue(input) {
      try {
        const link = await storage.createTaskPackGitHubCreatedIssueLink(input);
        return buildTaskPackGitHubCreatedIssueCompatibilityLink(link);
      } catch (error) {
        if (
          error instanceof TaskPackGitHubCreatedIssueLinkStorageError &&
          error.code === "TASK_PACK_GITHUB_CREATED_ISSUE_LINK_EXISTS"
        ) {
          throw new TaskPackGitHubCreatedIssueAlreadyLinkedError();
        }
        throw error;
      }
    },
  };
}
