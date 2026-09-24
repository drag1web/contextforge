import { randomUUID } from "node:crypto";

import {
  TaskPackDraftStorageError,
  type StorageAdapter,
} from "../storage/types.js";
import type {
  PersistedTaskPackDraft,
  TaskPackDraftContent,
  TaskPackDraftLifecycle,
  TaskPackDraftState,
} from "./taskPackLifecycle.js";

export type TaskPackDraftApplicationServiceStorage = Pick<
  StorageAdapter,
  | "listActiveTaskPackDrafts"
  | "getTaskPackDraftById"
  | "createTaskPackDraft"
  | "updateTaskPackDraft"
  | "discardTaskPackDraft"
  | "getProjectById"
>;

export interface TaskPackDraftView extends PersistedTaskPackDraft {
  readonly projectName: string;
}

export interface TaskPackDraftSummary {
  readonly id: string;
  readonly projectId: number;
  readonly projectName: string;
  readonly taskPackId: number | null;
  readonly baseRevisionId: number | null;
  readonly lifecycle: TaskPackDraftLifecycle;
  readonly draftVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt: string | null;
}

export interface CreateTaskPackDraftApplicationInput {
  readonly projectId: number;
  readonly taskPackId: number | null;
  readonly baseRevisionId: number | null;
  readonly content: TaskPackDraftContent;
}

export interface UpdateTaskPackDraftApplicationInput {
  readonly draftId: string;
  readonly expectedDraftVersion: number;
  readonly content: TaskPackDraftContent;
}

export interface DiscardTaskPackDraftApplicationInput {
  readonly draftId: string;
  readonly expectedDraftVersion: number;
}

export interface TaskPackDraftApplicationService {
  listActiveDrafts(projectId?: number): Promise<TaskPackDraftSummary[]>;
  getDraft(draftId: string): Promise<TaskPackDraftView | null>;
  createDraft(input: CreateTaskPackDraftApplicationInput): Promise<TaskPackDraftView>;
  updateDraft(input: UpdateTaskPackDraftApplicationInput): Promise<TaskPackDraftView>;
  discardDraft(input: DiscardTaskPackDraftApplicationInput): Promise<TaskPackDraftView>;
}

export type TaskPackDraftApplicationErrorCode =
  | "TASK_PACK_DRAFT_INVALID"
  | "TASK_PACK_DRAFT_NOT_FOUND"
  | "TASK_PACK_DRAFT_CONFLICT"
  | "TASK_PACK_DRAFT_NOT_EDITABLE"
  | "TASK_PACK_DRAFT_VERSION_EXHAUSTED"
  | "TASK_PACK_DRAFT_PROJECT_NOT_FOUND"
  | "TASK_PACK_DRAFT_TASK_PACK_NOT_FOUND"
  | "TASK_PACK_DRAFT_OWNERSHIP_INVALID"
  | "TASK_PACK_DRAFT_BASE_REVISION_INVALID"
  | "TASK_PACK_DRAFT_STATE_INVALID";

export class TaskPackDraftApplicationError extends Error {
  constructor(
    readonly code: TaskPackDraftApplicationErrorCode,
    readonly draftId?: string,
    readonly expectedDraftVersion?: number,
    readonly actualDraftVersion?: number,
    readonly lifecycleState?: TaskPackDraftState,
  ) {
    super(applicationErrorMessage(code));
    this.name = "TaskPackDraftApplicationError";
  }
}

export function createTaskPackDraftApplicationService(
  storage: TaskPackDraftApplicationServiceStorage,
): TaskPackDraftApplicationService {
  async function resolveProjectName(
    draft: PersistedTaskPackDraft,
    cache?: Map<number, string>,
  ): Promise<string> {
    const cached = cache?.get(draft.projectId);
    if (cached !== undefined) return cached;
    const project = await storage.getProjectById(draft.projectId);
    if (
      !project ||
      project.id !== draft.projectId ||
      typeof project.name !== "string" ||
      project.name.trim().length === 0
    ) {
      throw new TaskPackDraftApplicationError(
        "TASK_PACK_DRAFT_STATE_INVALID",
        draft.id,
      );
    }
    cache?.set(draft.projectId, project.name);
    return project.name;
  }

  async function toView(draft: PersistedTaskPackDraft): Promise<TaskPackDraftView> {
    return { ...draft, projectName: await resolveProjectName(draft) };
  }

  return {
    async listActiveDrafts(projectId) {
      if (projectId !== undefined) assertPositiveIdentity(projectId);
      try {
        const drafts = await storage.listActiveTaskPackDrafts(projectId);
        const projectNames = new Map<number, string>();
        return Promise.all(
          drafts.map(async (draft): Promise<TaskPackDraftSummary> => ({
            id: draft.id,
            projectId: draft.projectId,
            projectName: await resolveProjectName(draft, projectNames),
            taskPackId: draft.taskPackId,
            baseRevisionId: draft.baseRevisionId,
            lifecycle: draft.lifecycle,
            draftVersion: draft.draftVersion,
            createdAt: draft.createdAt,
            updatedAt: draft.updatedAt,
            expiresAt: draft.expiresAt,
          })),
        );
      } catch (error) {
        return translateStorageError(error);
      }
    },

    async getDraft(draftId) {
      assertDraftId(draftId);
      try {
        const draft = await storage.getTaskPackDraftById(draftId);
        return draft ? toView(draft) : null;
      } catch (error) {
        return translateStorageError(error);
      }
    },

    async createDraft(input) {
      assertPositiveIdentity(input.projectId);
      assertNullablePositiveIdentity(input.taskPackId);
      assertNullablePositiveIdentity(input.baseRevisionId);
      if (input.baseRevisionId !== null && input.taskPackId === null) {
        throw invalidInput();
      }
      try {
        const draft = await storage.createTaskPackDraft({
          id: randomUUID(),
          projectId: input.projectId,
          taskPackId: input.taskPackId,
          baseRevisionId: input.baseRevisionId,
          content: input.content,
          expiresAt: null,
        });
        return toView(draft);
      } catch (error) {
        return translateStorageError(error);
      }
    },

    async updateDraft(input) {
      assertDraftId(input.draftId);
      assertPositiveIdentity(input.expectedDraftVersion);
      try {
        const draft = await storage.updateTaskPackDraft(input);
        return toView(draft);
      } catch (error) {
        return translateStorageError(error);
      }
    },

    async discardDraft(input) {
      assertDraftId(input.draftId);
      assertPositiveIdentity(input.expectedDraftVersion);
      try {
        const draft = await storage.discardTaskPackDraft(input);
        return toView(draft);
      } catch (error) {
        return translateStorageError(error);
      }
    },
  };
}

function assertPositiveIdentity(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw invalidInput();
}

function assertNullablePositiveIdentity(value: number | null): void {
  if (value !== null) assertPositiveIdentity(value);
}

function assertDraftId(value: string): void {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > 200 ||
    /[\u0000-\u001f]/u.test(value)
  ) {
    throw invalidInput();
  }
}

function invalidInput(): TaskPackDraftApplicationError {
  return new TaskPackDraftApplicationError("TASK_PACK_DRAFT_INVALID");
}

function translateStorageError(error: unknown): never {
  if (!(error instanceof TaskPackDraftStorageError)) throw error;
  if (error.code === "TASK_PACK_DRAFT_ALREADY_EXISTS") {
    throw new TaskPackDraftApplicationError(
      "TASK_PACK_DRAFT_STATE_INVALID",
      error.draftId,
    );
  }
  if (error.code === "TASK_PACK_DRAFT_CONFLICT") {
    if (
      !error.draftId ||
      !Number.isSafeInteger(error.expectedDraftVersion) ||
      (error.expectedDraftVersion ?? 0) <= 0 ||
      !Number.isSafeInteger(error.actualDraftVersion) ||
      (error.actualDraftVersion ?? 0) <= 0
    ) {
      throw new TaskPackDraftApplicationError("TASK_PACK_DRAFT_STATE_INVALID");
    }
  }
  throw new TaskPackDraftApplicationError(
    error.code,
    error.draftId,
    error.expectedDraftVersion,
    error.actualDraftVersion,
    error.lifecycleState,
  );
}

function applicationErrorMessage(code: TaskPackDraftApplicationErrorCode): string {
  switch (code) {
    case "TASK_PACK_DRAFT_INVALID":
      return "Task Pack draft input is invalid.";
    case "TASK_PACK_DRAFT_NOT_FOUND":
      return "Task Pack draft not found.";
    case "TASK_PACK_DRAFT_CONFLICT":
      return "Task Pack draft changed after it was opened.";
    case "TASK_PACK_DRAFT_NOT_EDITABLE":
      return "Only an active Task Pack draft can be changed.";
    case "TASK_PACK_DRAFT_VERSION_EXHAUSTED":
      return "Task Pack draft version is exhausted.";
    case "TASK_PACK_DRAFT_PROJECT_NOT_FOUND":
      return "Task Pack draft project not found.";
    case "TASK_PACK_DRAFT_TASK_PACK_NOT_FOUND":
      return "Task Pack not found.";
    case "TASK_PACK_DRAFT_OWNERSHIP_INVALID":
      return "Task Pack draft ownership is invalid.";
    case "TASK_PACK_DRAFT_BASE_REVISION_INVALID":
      return "Task Pack draft base revision is invalid.";
    case "TASK_PACK_DRAFT_STATE_INVALID":
      return "Task Pack draft state is invalid.";
  }
}
