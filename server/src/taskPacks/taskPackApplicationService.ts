import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  buildTaskPackGitHubCreatedIssueCompatibilityLink,
  TaskPackCurrentStateStorageError,
  TaskPackGitHubCreatedIssueLinkStorageError,
  TaskPackRevisionAppendStorageError,
  TaskPackLifecycleStorageError,
  TaskPackReviewStorageError,
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
import { deriveTaskPackRevisionReviewState } from "../storage/taskPackLifecyclePersistence.js";
import type { GitHubCreatedIssueLink } from "../github/githubTypes.js";
import type {
  TaskPackJsonObject,
  TaskPackJsonValue,
  TaskPackAggregate,
  TaskPackAggregateLifecycleEvent,
  TaskPackRevisionReviewEvent,
  TaskPackReviewState,
} from "./taskPackLifecycle.js";
import {
  assertTaskPackAggregate,
  assertTaskPackAggregateLifecycleEvent,
  assertTaskPackRevision,
  assertTaskPackRevisionReviewEvent,
  TaskPackLifecycleDomainError,
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
  | "transitionTaskPackAggregateLifecycle"
  | "transitionTaskPackRevisionReview"
  | "listTaskPackRevisionReviewEvents"
  | "listTaskPackCurrentWorkflowSnapshots"
>;

export interface TaskPackWorkflowRuntime {
  readonly now: () => string;
  readonly createEventId: () => string;
}

const workflowIdentitySchema = z.number().refine(
  (value) => Number.isSafeInteger(value) && value > 0,
);
const reviewStateSchema = z.enum([
  "unreviewed", "in_review", "accepted", "changes_requested",
]);
// Shared closed command shapes; transition policy remains in domain/storage.
export const taskPackLifecycleCommandSchema = z.object({
  taskPackId: workflowIdentitySchema,
  expectedLifecycleVersion: workflowIdentitySchema,
  action: z.enum(["complete", "reopen", "archive", "unarchive"]),
}).strict();
export const taskPackRevisionReviewCommandSchema = z.object({
  taskPackId: workflowIdentitySchema,
  revisionId: workflowIdentitySchema,
  expectedLifecycleVersion: workflowIdentitySchema,
  expectedReviewState: reviewStateSchema,
  action: z.enum(["start_review", "accept", "request_changes"]),
}).strict();
export type TaskPackLifecycleCommandInput = Readonly<
  z.infer<typeof taskPackLifecycleCommandSchema>
>;
export type TaskPackRevisionReviewCommandInput = Readonly<
  z.infer<typeof taskPackRevisionReviewCommandSchema>
>;

export interface TaskPackLifecycleCommandResult {
  readonly aggregate: TaskPackAggregate;
  readonly event: TaskPackAggregateLifecycleEvent;
}
export interface TaskPackRevisionReviewCommandResult {
  readonly aggregate: TaskPackAggregate;
  readonly revision: TaskPackRevisionRecord;
  readonly reviewState: TaskPackReviewState;
  readonly event: TaskPackRevisionReviewEvent;
}
export interface TaskPackCurrentWorkflowState {
  readonly taskPackId: number;
  readonly lifecycle: TaskPackAggregate["lifecycle"];
  readonly lifecycleVersion: number;
  readonly currentRevisionId: number;
  readonly acceptedRevisionId: number | null;
  readonly completedAt: string | null;
  readonly archivedAt: string | null;
  readonly currentReviewState: TaskPackReviewState;
}

/** Public library projection, separate from the flat Task Pack and CAS contracts. */
export interface TaskPackWorkflowSummary {
  readonly taskPackId: number;
  readonly currentRevisionId: number;
  readonly lifecycle: TaskPackAggregate["lifecycle"];
  readonly currentReviewState: TaskPackReviewState;
}

const workflowErrorMessages = {
  TASK_PACK_WORKFLOW_INVALID: "Task Pack workflow input is invalid.",
  TASK_PACK_LIFECYCLE_NOT_FOUND: "Task Pack not found.",
  TASK_PACK_LIFECYCLE_CONFLICT: "Task Pack changed. Refresh its workflow state before trying again.",
  TASK_PACK_LIFECYCLE_VERSION_EXHAUSTED: "Task Pack lifecycle version is exhausted.",
  TASK_PACK_LIFECYCLE_INVALID_TRANSITION: "This lifecycle transition is not allowed.",
  TASK_PACK_LIFECYCLE_STATE_INVALID: "Task Pack lifecycle state is invalid.",
  TASK_PACK_LIFECYCLE_EVENT_EXISTS: "Task Pack lifecycle event identity already exists.",
  TASK_PACK_REVIEW_NOT_FOUND: "Task Pack not found.",
  TASK_PACK_REVIEW_REVISION_NOT_FOUND: "Task Pack revision not found.",
  TASK_PACK_REVIEW_CONFLICT: "Task Pack review changed or the event cannot follow its history. Refresh before trying again.",
  TASK_PACK_REVIEW_VERSION_EXHAUSTED: "Task Pack lifecycle version is exhausted.",
  TASK_PACK_REVIEW_INVALID_TRANSITION: "This review transition is not allowed.",
  TASK_PACK_REVIEW_STATE_INVALID: "Task Pack review state is invalid.",
  TASK_PACK_REVIEW_EVENT_EXISTS: "Task Pack review event identity already exists.",
} as const;
export type TaskPackWorkflowApplicationErrorCode = keyof typeof workflowErrorMessages;
export interface TaskPackWorkflowErrorEvidence {
  readonly taskPackId?: number;
  readonly revisionId?: number;
  readonly expectedLifecycleVersion?: number;
  readonly actualLifecycleVersion?: number;
  readonly expectedReviewState?: TaskPackReviewState;
  readonly actualReviewState?: TaskPackReviewState;
}
export class TaskPackWorkflowApplicationError extends Error {
  readonly evidence: TaskPackWorkflowErrorEvidence;

  constructor(
    readonly code: TaskPackWorkflowApplicationErrorCode,
    evidence: TaskPackWorkflowErrorEvidence = {},
  ) {
    super(workflowErrorMessages[code]);
    this.name = "TaskPackWorkflowApplicationError";
    // Copy only validated machine evidence, never a storage error/cause/message.
    const safe: Record<string, number | TaskPackReviewState> = {};
    for (const key of [
      "taskPackId", "revisionId", "expectedLifecycleVersion", "actualLifecycleVersion",
    ] as const) {
      const value = evidence[key];
      if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
        safe[key] = value;
      }
    }
    for (const key of ["expectedReviewState", "actualReviewState"] as const) {
      const parsed = reviewStateSchema.safeParse(evidence[key]);
      if (parsed.success) safe[key] = parsed.data;
    }
    this.evidence = safe;
  }
}

function workflowEventFields(runtime: TaskPackWorkflowRuntime) {
  const createdAt = runtime.now();
  if (
    typeof createdAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(createdAt) ||
    !Number.isFinite(Date.parse(createdAt)) ||
    new Date(createdAt).toISOString() !== createdAt
  ) {
    throw new TaskPackCurrentStateError();
  }
  return {
    eventId: runtime.createEventId(), createdAt,
    source: "user" as const, actorId: null, metadata: null,
  };
}

function translateWorkflowStorageError(error: unknown): never {
  if (error instanceof TaskPackLifecycleStorageError || error instanceof TaskPackReviewStorageError) {
    throw new TaskPackWorkflowApplicationError(error.code, error);
  }
  throw error;
}

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
  listCurrentTaskPackWorkflowSummaries(): Promise<TaskPackWorkflowSummary[]>;
  getCurrentTaskPackWorkflowState(taskPackId: number): Promise<TaskPackCurrentWorkflowState | null>;
  transitionTaskPackLifecycle(input: TaskPackLifecycleCommandInput): Promise<TaskPackLifecycleCommandResult>;
  transitionTaskPackRevisionReview(input: TaskPackRevisionReviewCommandInput): Promise<TaskPackRevisionReviewCommandResult>;
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
  workflowRuntime: TaskPackWorkflowRuntime = {
    now: () => new Date().toISOString(),
    createEventId: () => randomUUID(),
  },
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
    async listCurrentTaskPackWorkflowSummaries() {
      let snapshots;
      try {
        snapshots = await storage.listTaskPackCurrentWorkflowSnapshots();
      } catch (error) {
        return translateStorageCurrentStateError(error);
      }
      // Only pure snapshot validation here. Operational errors above stay unexpected.
      try {
        const identities = new Set<number>();
        const ordered = [...snapshots].sort((a, b) =>
          Date.parse(b.aggregate.createdAt) - Date.parse(a.aggregate.createdAt) || a.aggregate.id - b.aggregate.id);
        return ordered.map(({ aggregate, revision, reviewEvents }) => {
          assertTaskPackAggregate(aggregate);
          assertTaskPackRevision(revision, { aggregate, verifyContentHash: true });
          if (identities.has(aggregate.id) || revision.id !== aggregate.currentRevisionId || revision.taskPackId !== aggregate.id) {
            throw new TaskPackCurrentStateError();
          }
          identities.add(aggregate.id);
          const currentReviewState = deriveTaskPackRevisionReviewState(aggregate, revision, reviewEvents);
          const lifecycle: TaskPackAggregate["lifecycle"] = aggregate.lifecycle.state === "archived"
            ? { state: "archived", archivedFromState: aggregate.lifecycle.archivedFromState }
            : { state: aggregate.lifecycle.state, archivedFromState: null };
          return { taskPackId: aggregate.id, currentRevisionId: revision.id,
            lifecycle, currentReviewState };
        });
      } catch {
        throw new TaskPackCurrentStateError();
      }
    },

    async getCurrentTaskPackWorkflowState(taskPackId) {
      if (!workflowIdentitySchema.safeParse(taskPackId).success) {
        throw new TaskPackWorkflowApplicationError("TASK_PACK_WORKFLOW_INVALID");
      }
      try {
        const aggregate = await readAggregate(taskPackId);
        if (!aggregate) return null;
        assertTaskPackAggregate(aggregate);
        if (aggregate.id !== taskPackId) throw new TaskPackCurrentStateError();
        const revision = await storage.getTaskPackRevisionById(
          aggregate.id, aggregate.currentRevisionId,
        );
        if (!revision || revision.id !== aggregate.currentRevisionId || revision.taskPackId !== aggregate.id) {
          throw new TaskPackCurrentStateError();
        }
        const events = await storage.listTaskPackRevisionReviewEvents(aggregate.id, revision.id);
        const currentReviewState = deriveTaskPackRevisionReviewState(aggregate, revision, events);
        return {
          taskPackId: aggregate.id,
          lifecycle: aggregate.lifecycle,
          lifecycleVersion: aggregate.lifecycleVersion,
          currentRevisionId: aggregate.currentRevisionId,
          acceptedRevisionId: aggregate.acceptedRevisionId,
          completedAt: aggregate.completedAt,
          archivedAt: aggregate.archivedAt,
          currentReviewState,
        };
      } catch (error) {
        if (error instanceof TaskPackCurrentStateError) throw error;
        if (
          error instanceof TaskPackCurrentStateStorageError ||
          error instanceof TaskPackLifecycleDomainError ||
          (error instanceof TaskPackReviewStorageError && error.code === "TASK_PACK_REVIEW_STATE_INVALID")
        ) {
          throw new TaskPackCurrentStateError();
        }
        // Operational read failures are not evidence of corrupt persisted state.
        // Keep them unexpected; the HTTP boundary supplies the safe generic error.
        throw error;
      }
    },

    async transitionTaskPackLifecycle(input) {
      const parsed = taskPackLifecycleCommandSchema.safeParse(input);
      if (!parsed.success) throw new TaskPackWorkflowApplicationError("TASK_PACK_WORKFLOW_INVALID");
      const command = parsed.data;
      const fields = workflowEventFields(workflowRuntime);
      let result: TaskPackLifecycleCommandResult;
      try {
        result = await storage.transitionTaskPackAggregateLifecycle({
          taskPackId: command.taskPackId,
          expectedLifecycleVersion: command.expectedLifecycleVersion,
          transition: { type: command.action },
          ...fields,
        });
      } catch (error) {
        return translateWorkflowStorageError(error);
      }
      try {
        assertTaskPackAggregate(result.aggregate);
        assertTaskPackAggregateLifecycleEvent(result.event);
        const eventTypes = {
          complete: "completed", reopen: "reopened", archive: "archived", unarchive: "unarchived",
        } as const;
        if (
          result.aggregate.id !== command.taskPackId ||
          result.aggregate.lifecycleVersion !== command.expectedLifecycleVersion + 1 ||
          result.aggregate.updatedAt !== fields.createdAt ||
          result.event.taskPackId !== command.taskPackId ||
          result.event.id !== fields.eventId || result.event.createdAt !== fields.createdAt ||
          result.event.source !== "user" || result.event.actorId !== null || result.event.metadata !== null ||
          result.event.eventType !== eventTypes[command.action] ||
          result.event.toState !== result.aggregate.lifecycle.state ||
          result.event.revisionId !== (command.action === "complete" ? result.aggregate.currentRevisionId : null)
        ) {
          throw new TaskPackCurrentStateError();
        }
        return { aggregate: result.aggregate, event: result.event };
      } catch {
        throw new TaskPackWorkflowApplicationError("TASK_PACK_LIFECYCLE_STATE_INVALID");
      }
    },

    async transitionTaskPackRevisionReview(input) {
      const parsed = taskPackRevisionReviewCommandSchema.safeParse(input);
      if (!parsed.success) throw new TaskPackWorkflowApplicationError("TASK_PACK_WORKFLOW_INVALID");
      const command = parsed.data;
      const fields = workflowEventFields(workflowRuntime);
      let result: TaskPackRevisionReviewCommandResult;
      try {
        result = await storage.transitionTaskPackRevisionReview({
          taskPackId: command.taskPackId,
          revisionId: command.revisionId,
          expectedLifecycleVersion: command.expectedLifecycleVersion,
          expectedReviewState: command.expectedReviewState,
          transition: { type: command.action },
          ...fields,
        });
      } catch (error) {
        return translateWorkflowStorageError(error);
      }
      try {
        assertTaskPackAggregate(result.aggregate);
        assertTaskPackRevision(result.revision, { aggregate: result.aggregate, verifyContentHash: true });
        assertTaskPackRevisionReviewEvent(result.event, { aggregate: result.aggregate, revision: result.revision });
        const eventTypes = {
          start_review: "review_started", accept: "accepted", request_changes: "changes_requested",
        } as const;
        if (
          result.aggregate.id !== command.taskPackId || result.revision.id !== command.revisionId ||
          result.event.id !== fields.eventId || result.event.createdAt !== fields.createdAt ||
          result.event.source !== "user" || result.event.actorId !== null || result.event.metadata !== null ||
          result.event.eventType !== eventTypes[command.action] || result.event.fromState !== command.expectedReviewState ||
          result.event.toState !== result.reviewState ||
          result.aggregate.lifecycleVersion !== command.expectedLifecycleVersion + (command.action === "accept" ? 1 : 0) ||
          (command.action === "accept" && (result.aggregate.acceptedRevisionId !== command.revisionId || result.aggregate.updatedAt !== fields.createdAt))
        ) {
          throw new TaskPackCurrentStateError();
        }
        return {
          aggregate: result.aggregate, revision: result.revision,
          reviewState: result.reviewState, event: result.event,
        };
      } catch {
        throw new TaskPackWorkflowApplicationError("TASK_PACK_REVIEW_STATE_INVALID");
      }
    },

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
