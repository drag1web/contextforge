import { isDeepStrictEqual } from "node:util";
import {
  assertTaskPackAggregate,
  assertTaskPackAggregateLifecycleEvent,
  assertTaskPackRevision,
  assertTaskPackRevisionReviewEvent,
  computeTaskPackRevisionContentHash,
  transitionTaskPackAggregateLifecycle,
  TaskPackLifecycleDomainError,
  type TaskPackAggregate,
  type TaskPackAggregateLifecycleEvent,
  type TaskPackJsonObject,
  type TaskPackRevision,
  type TaskPackRevisionContent,
  type TaskPackRevisionReviewEvent,
} from "../taskPacks/taskPackLifecycle.js";
import { parseJsonValue } from "./json.js";
import {
  TaskPackLifecycleStorageError,
  type CreateTaskPackInput,
  type TransitionTaskPackAggregateLifecycleInput,
  type TransitionTaskPackAggregateLifecycleResult,
} from "./types.js";

export function assertTaskPackLifecycleTransitionInput(input: TransitionTaskPackAggregateLifecycleInput): void {
  if (!Number.isSafeInteger(input?.taskPackId) || input.taskPackId < 1 ||
    !Number.isSafeInteger(input.expectedLifecycleVersion) || input.expectedLifecycleVersion < 1) {
    throw new TaskPackLifecycleStorageError("TASK_PACK_LIFECYCLE_STATE_INVALID");
  }
  const transition = input.transition;
  if (!transition || typeof transition !== "object" || Array.isArray(transition) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(transition)) ||
    Object.keys(transition).length !== 1 || !Object.hasOwn(transition, "type") ||
    !["complete", "reopen", "archive", "unarchive"].includes(transition.type)) {
    throw new TaskPackLifecycleStorageError("TASK_PACK_LIFECYCLE_INVALID_TRANSITION", input.taskPackId);
  }
}

/** Safe error surface: never attach driver/domain messages, SQL, or error causes. */
export function taskPackLifecycleStorageError(error: unknown, taskPackId: number): TaskPackLifecycleStorageError {
  if (error instanceof TaskPackLifecycleStorageError) return error;
  return new TaskPackLifecycleStorageError(
    "TASK_PACK_LIFECYCLE_STATE_INVALID",
    Number.isSafeInteger(taskPackId) && taskPackId > 0 ? taskPackId : undefined,
  );
}

/** Shared preparation; the domain remains the only transition state machine. */
export function prepareTaskPackAggregateLifecycleTransition(
  current: TaskPackAggregate,
  input: TransitionTaskPackAggregateLifecycleInput,
): TransitionTaskPackAggregateLifecycleResult {
  assertTaskPackAggregate(current);
  if (current.id !== input.taskPackId) throw new TaskPackLifecycleStorageError("TASK_PACK_LIFECYCLE_STATE_INVALID", input.taskPackId);
  if (current.lifecycleVersion !== input.expectedLifecycleVersion) {
    throw new TaskPackLifecycleStorageError("TASK_PACK_LIFECYCLE_CONFLICT", current.id,
      input.expectedLifecycleVersion, current.lifecycleVersion);
  }
  if (current.lifecycleVersion === Number.MAX_SAFE_INTEGER) {
    throw new TaskPackLifecycleStorageError("TASK_PACK_LIFECYCLE_VERSION_EXHAUSTED", current.id);
  }
  let lifecycle: TaskPackAggregate["lifecycle"];
  try {
    lifecycle = transitionTaskPackAggregateLifecycle(current, input.transition);
  } catch (error) {
    if (error instanceof TaskPackLifecycleDomainError && error.code === "invalid_transition") {
      throw new TaskPackLifecycleStorageError("TASK_PACK_LIFECYCLE_INVALID_TRANSITION", current.id);
    }
    throw error;
  }
  const aggregate: TaskPackAggregate = {
    ...current, lifecycle, lifecycleVersion: current.lifecycleVersion + 1, updatedAt: input.createdAt,
    completedAt: input.transition.type === "complete" ? input.createdAt : current.completedAt,
    archivedAt: input.transition.type === "archive" ? input.createdAt : null,
  };
  const eventTypes = { complete: "completed", reopen: "reopened", archive: "archived", unarchive: "unarchived" } as const;
  const event: TaskPackAggregateLifecycleEvent = {
    id: input.eventId, taskPackId: current.id, eventType: eventTypes[input.transition.type],
    fromState: current.lifecycle.state, toState: lifecycle.state,
    revisionId: input.transition.type === "complete" ? current.currentRevisionId : null,
    source: input.source, actorId: input.actorId, createdAt: input.createdAt, metadata: input.metadata,
  };
  assertTaskPackAggregate(aggregate);
  assertTaskPackAggregateLifecycleEvent(event, { aggregate: current });
  // Snapshot validated JSON before awaiting writes; JSONB may reorder object keys.
  return { aggregate, event: { ...event, metadata: event.metadata === null ? null : JSON.parse(JSON.stringify(event.metadata)) } };
}

/** Verify authoritative readback, including every unchanged aggregate field. */
export function validateTaskPackAggregateLifecycleTransitionResult(
  current: TaskPackAggregate,
  expected: TransitionTaskPackAggregateLifecycleResult,
  aggregate: TaskPackAggregate,
  event: TaskPackAggregateLifecycleEvent,
): TransitionTaskPackAggregateLifecycleResult {
  assertTaskPackAggregate(aggregate);
  assertTaskPackAggregateLifecycleEvent(event, { aggregate: current });
  // PostgreSQL TIMESTAMPTZ/pg Date canonicalizes whole seconds to .000Z. Preserve
  // the caller's valid UTC representation only AFTER verifying the stored instant.
  const timestamp = (actual: string | null, wanted: string | null) =>
    actual !== null && wanted !== null && Date.parse(actual) === Date.parse(wanted) ? wanted : actual;
  const result = {
    aggregate: { ...aggregate,
      createdAt: timestamp(aggregate.createdAt, expected.aggregate.createdAt)!,
      updatedAt: timestamp(aggregate.updatedAt, expected.aggregate.updatedAt)!,
      completedAt: timestamp(aggregate.completedAt, expected.aggregate.completedAt),
      archivedAt: timestamp(aggregate.archivedAt, expected.aggregate.archivedAt),
    },
    event: { ...event, createdAt: timestamp(event.createdAt, expected.event.createdAt)! },
  };
  if (!isDeepStrictEqual(result, expected)) {
    throw new TaskPackLifecycleStorageError("TASK_PACK_LIFECYCLE_STATE_INVALID", current.id);
  }
  return result;
}

export const CLOUD_HANDOFF_GENERATION_MESSAGE_PREFIX = "ContextForge cloud handoff:";

export interface LegacyTaskPackPersistenceRow extends Record<string, unknown> {
  readonly id: number;
  readonly raw_task: string;
  readonly task_type: string;
  readonly target_tool: string;
  readonly generated_prompt: string;
  readonly generation_mode: "template" | "ollama" | null;
  readonly generation_model: string | null;
  readonly generation_message: string | null;
  readonly generation_used_fallback: number | boolean | null;
  readonly generation_duration_ms: number | null;
  readonly generation_recipe: unknown | null;
  readonly created_at: string | Date;
}

export interface TaskPackAggregatePersistenceRow extends Record<string, unknown> {
  readonly id: number;
  readonly project_id: number;
  readonly title: string;
  readonly lifecycle_state: "active" | "completed" | "archived";
  readonly archived_from_state: "active" | "completed" | null;
  readonly current_revision_id: number;
  readonly accepted_revision_id: number | null;
  readonly lifecycle_version: number;
  readonly created_at: string | Date;
  readonly updated_at: string | Date;
  readonly completed_at: string | Date | null;
  readonly archived_at: string | Date | null;
}

export interface TaskPackRevisionPersistenceRow extends Record<string, unknown> {
  readonly id: number;
  readonly task_pack_id: number;
  readonly revision_number: number;
  readonly base_revision_id: number | null;
  readonly source_kind: TaskPackRevision["sourceKind"];
  readonly raw_task: string;
  readonly task_type: string;
  readonly target_tool: string;
  readonly generated_prompt: string;
  readonly generation_mode: TaskPackRevision["generationMode"];
  readonly generation_model: string | null;
  readonly generation_message: string | null;
  readonly generation_used_fallback: number | boolean;
  readonly generation_duration_ms: number | null;
  readonly generation_recipe: unknown | null;
  readonly diagnostics: unknown | null;
  readonly grounded_context_snapshot: unknown | null;
  readonly freshness_basis: unknown | null;
  readonly content_hash: string;
  readonly created_at: string | Date;
  readonly generated_at: string | Date | null;
}

export interface TaskPackLifecycleEventPersistenceRow extends Record<string, unknown> {
  readonly id: string;
  readonly task_pack_id: number;
  readonly revision_id: number | null;
  readonly event_type: TaskPackAggregateLifecycleEvent["eventType"];
  readonly from_state: TaskPackAggregateLifecycleEvent["fromState"];
  readonly to_state: TaskPackAggregateLifecycleEvent["toState"];
  readonly source: TaskPackAggregateLifecycleEvent["source"];
  readonly actor_id: string | null;
  readonly created_at: string | Date;
  readonly metadata: unknown | null;
}

export interface TaskPackReviewEventPersistenceRow extends Record<string, unknown> {
  readonly id: string;
  readonly task_pack_id: number;
  readonly revision_id: number;
  readonly event_type: TaskPackRevisionReviewEvent["eventType"];
  readonly from_state: TaskPackRevisionReviewEvent["fromState"];
  readonly to_state: TaskPackRevisionReviewEvent["toState"];
  readonly source: TaskPackRevisionReviewEvent["source"];
  readonly actor_id: string | null;
  readonly created_at: string | Date;
  readonly metadata: unknown | null;
}

export function buildLegacyTaskPackRevisionContent(
  row: LegacyTaskPackPersistenceRow,
): TaskPackRevisionContent {
  return {
    sourceKind:
      typeof row.generation_message === "string" &&
      row.generation_message.startsWith(CLOUD_HANDOFF_GENERATION_MESSAGE_PREFIX)
        ? "imported"
        : "legacy_snapshot",
    rawTask: row.raw_task,
    taskType: row.task_type,
    targetTool: row.target_tool,
    generatedPrompt: row.generated_prompt,
    generationMode: row.generation_mode ?? "template",
    generationModel: row.generation_model,
    generationMessage: row.generation_message,
    generationUsedFallback: Boolean(row.generation_used_fallback),
    generationDurationMs: row.generation_duration_ms,
    generationRecipe: parseNullableJsonObject(row.generation_recipe, "generation recipe"),
    diagnostics: null,
    groundedContextSnapshot: null,
    freshnessBasis: null,
  };
}

export function buildCreatedTaskPackRevisionContent(
  input: CreateTaskPackInput,
): TaskPackRevisionContent {
  const imported = input.generationMessage?.startsWith(
    CLOUD_HANDOFF_GENERATION_MESSAGE_PREFIX,
  ) === true;
  return {
    sourceKind: imported ? "imported" : "generated",
    rawTask: input.rawTask,
    taskType: input.taskType,
    targetTool: input.targetTool,
    generatedPrompt: input.generatedPrompt,
    generationMode: input.generationMode,
    generationModel: input.generationModel,
    generationMessage: input.generationMessage,
    generationUsedFallback: input.generationUsedFallback,
    generationDurationMs: input.generationDurationMs ?? null,
    generationRecipe: parseNullableJsonObject(input.generationRecipe ?? null, "generation recipe"),
    diagnostics: null,
    groundedContextSnapshot: null,
    freshnessBasis: null,
  };
}

export function contentHashForRevision(content: TaskPackRevisionContent): string {
  return computeTaskPackRevisionContentHash(content);
}

export function mapTaskPackAggregatePersistenceRow(
  row: TaskPackAggregatePersistenceRow,
): TaskPackAggregate {
  const aggregate: TaskPackAggregate = {
    id: Number(row.id),
    projectId: Number(row.project_id),
    title: row.title,
    lifecycle:
      row.lifecycle_state === "archived"
        ? {
            state: "archived",
            archivedFromState: row.archived_from_state as "active" | "completed",
          }
        : { state: row.lifecycle_state, archivedFromState: null },
    currentRevisionId: Number(row.current_revision_id),
    acceptedRevisionId:
      row.accepted_revision_id === null ? null : Number(row.accepted_revision_id),
    lifecycleVersion: Number(row.lifecycle_version),
    createdAt: toIsoTimestamp(row.created_at),
    updatedAt: toIsoTimestamp(row.updated_at),
    completedAt: nullableIsoTimestamp(row.completed_at),
    archivedAt: nullableIsoTimestamp(row.archived_at),
  };
  assertTaskPackAggregate(aggregate);
  return aggregate;
}

export function mapTaskPackRevisionPersistenceRow(
  row: TaskPackRevisionPersistenceRow,
): TaskPackRevision {
  const revision: TaskPackRevision = {
    id: Number(row.id),
    taskPackId: Number(row.task_pack_id),
    revisionNumber: Number(row.revision_number),
    baseRevisionId: row.base_revision_id === null ? null : Number(row.base_revision_id),
    sourceKind: row.source_kind,
    rawTask: row.raw_task,
    taskType: row.task_type,
    targetTool: row.target_tool,
    generatedPrompt: row.generated_prompt,
    generationMode: row.generation_mode,
    generationModel: row.generation_model,
    generationMessage: row.generation_message,
    generationUsedFallback: Boolean(row.generation_used_fallback),
    generationDurationMs: row.generation_duration_ms,
    generationRecipe: parseNullableJsonObject(row.generation_recipe, "generation recipe"),
    diagnostics: parseNullableJsonObject(row.diagnostics, "revision diagnostics") as TaskPackRevision["diagnostics"],
    groundedContextSnapshot: parseNullableJsonObject(
      row.grounded_context_snapshot,
      "grounded context snapshot",
    ) as TaskPackRevision["groundedContextSnapshot"],
    freshnessBasis: parseNullableJsonObject(
      row.freshness_basis,
      "freshness basis",
    ) as TaskPackRevision["freshnessBasis"],
    contentHash: row.content_hash,
    createdAt: toIsoTimestamp(row.created_at),
    generatedAt: nullableIsoTimestamp(row.generated_at),
  };
  assertTaskPackRevision(revision);
  return revision;
}

export function mapTaskPackLifecycleEventPersistenceRow(
  row: TaskPackLifecycleEventPersistenceRow,
): TaskPackAggregateLifecycleEvent {
  const event: TaskPackAggregateLifecycleEvent = {
    id: row.id,
    taskPackId: Number(row.task_pack_id),
    revisionId: row.revision_id === null ? null : Number(row.revision_id),
    eventType: row.event_type,
    fromState: row.from_state,
    toState: row.to_state,
    source: row.source,
    actorId: row.actor_id,
    createdAt: toIsoTimestamp(row.created_at),
    metadata: parseNullableJsonObject(row.metadata, "lifecycle event metadata"),
  };
  assertTaskPackAggregateLifecycleEvent(event);
  return event;
}

export function mapTaskPackReviewEventPersistenceRow(
  row: TaskPackReviewEventPersistenceRow,
): TaskPackRevisionReviewEvent {
  const event: TaskPackRevisionReviewEvent = {
    id: row.id,
    taskPackId: Number(row.task_pack_id),
    revisionId: Number(row.revision_id),
    eventType: row.event_type,
    fromState: row.from_state,
    toState: row.to_state,
    source: row.source,
    actorId: row.actor_id,
    createdAt: toIsoTimestamp(row.created_at),
    metadata: parseNullableJsonObject(row.metadata, "review event metadata"),
  };
  assertTaskPackRevisionReviewEvent(event);
  return event;
}

function parseNullableJsonObject(value: unknown, label: string): TaskPackJsonObject | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "string" ? parseJsonValue<unknown>(value, undefined) : value;
  if (parsed === null) return null;
  if (parsed === undefined || !isPlainRecord(parsed)) {
    throw new Error(`Task Pack ${label} must be a JSON object or null.`);
  }
  return parsed as TaskPackJsonObject;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function toIsoTimestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function nullableIsoTimestamp(value: string | Date | null): string | null {
  return value === null ? null : toIsoTimestamp(value);
}
