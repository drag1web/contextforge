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
} from "./taskPackLifecycle.js";
import {
  prepareGeneratedTaskPackMaterial,
  type GeneratedRevisionContentInput,
} from "./taskPackGeneratedMaterial.js";

export { TaskPackGeneratedCreateInputError } from "./taskPackGeneratedMaterial.js";

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

export class TaskPackGitHubCreatedIssueAlreadyLinkedError extends Error {
  readonly code = "TASK_PACK_GITHUB_CREATED_ISSUE_LINK_EXISTS" as const;

  constructor() {
    super("This Task Pack is already linked to a created GitHub issue.");
    this.name = "TaskPackGitHubCreatedIssueAlreadyLinkedError";
  }
}

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
      const prepared = prepareGeneratedTaskPackMaterial(input);
      const storageInput: CreateTaskPackWithInitialRevisionInput = {
        projectId: input.projectId,
        title: input.title,
        revisionContent: prepared.revisionContent,
        generatedAt: input.generatedAt,
        compatibilityGenerationRecipe:
          prepared.compatibilityGenerationRecipe,
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
