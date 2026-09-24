import {
  assertPersistedTaskPackDraft,
  type PersistedTaskPackDraft,
  type TaskPackDraftContent,
  type TaskPackDraftState,
} from "../taskPacks/taskPackLifecycle.js";
import { TaskPackDraftStorageError } from "./types.js";

export interface TaskPackDraftPersistenceRow extends Record<string, unknown> {
  readonly id: unknown;
  readonly project_id: unknown;
  readonly task_pack_id: unknown;
  readonly base_revision_id: unknown;
  readonly content: unknown;
  readonly lifecycle_state: unknown;
  readonly materialized_revision_id: unknown;
  readonly draft_version: unknown;
  readonly created_at: unknown;
  readonly updated_at: unknown;
  readonly expires_at: unknown;
}

/** Fixed-field JSON projection for mutable draft persistence and semantic no-op comparison. */
export function serializeTaskPackDraftContent(content: TaskPackDraftContent): string {
  return JSON.stringify({
    rawTask: content.rawTask,
    taskType: content.taskType,
    targetTool: content.targetTool,
    templateId: content.templateId,
    ruleProfileId: content.ruleProfileId,
    enabledRuleIds: [...content.enabledRuleIds],
    customRulesText: content.customRulesText,
    acceptanceCriteriaPresetId: content.acceptanceCriteriaPresetId,
    acceptanceCriteriaText: content.acceptanceCriteriaText,
    clarifications: content.clarifications.map(({ question, answer }) => ({ question, answer })),
    performanceSessionId: content.performanceSessionId,
    understandingSnapshotId: content.understandingSnapshotId,
    reviewedUnderstandingSnapshotId: content.reviewedUnderstandingSnapshotId,
  });
}

export function taskPackDraftContentsEqual(
  left: TaskPackDraftContent,
  right: TaskPackDraftContent,
): boolean {
  return serializeTaskPackDraftContent(left) === serializeTaskPackDraftContent(right);
}

export function assertTaskPackDraftRecordForStorage(
  record: PersistedTaskPackDraft,
): void {
  try {
    assertPersistedTaskPackDraft(record);
  } catch {
    throw new TaskPackDraftStorageError("TASK_PACK_DRAFT_STATE_INVALID", record.id);
  }
}

export function assertTaskPackDraftVersionToken(draftId: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TaskPackDraftStorageError("TASK_PACK_DRAFT_STATE_INVALID", draftId);
  }
}

export function nextTaskPackDraftUpdatedAt(current: string): string {
  const now = Date.now();
  const currentMs = Date.parse(current);
  return new Date(Number.isFinite(currentMs) && now <= currentMs ? currentMs + 1 : now).toISOString();
}

export function mapTaskPackDraftPersistenceRow(
  row: TaskPackDraftPersistenceRow,
): PersistedTaskPackDraft {
  const draftId = typeof row.id === "string" ? row.id : undefined;
  try {
    const lifecycleState = row.lifecycle_state as TaskPackDraftState;
    const content = parseContent(row.content);
    const draftVersion = Number(row.draft_version);
    const record: PersistedTaskPackDraft = {
      id: row.id as string,
      projectId: row.project_id as number,
      taskPackId: row.task_pack_id === null ? null : (row.task_pack_id as number),
      baseRevisionId: row.base_revision_id === null ? null : (row.base_revision_id as number),
      content,
      lifecycle:
        lifecycleState === "materialized"
          ? {
              state: "materialized",
              materializedRevisionId: row.materialized_revision_id as number,
            }
          : {
              state: lifecycleState as "active" | "discarded",
              materializedRevisionId: null,
            },
      draftVersion,
      createdAt: timestamp(row.created_at),
      updatedAt: timestamp(row.updated_at),
      expiresAt: row.expires_at === null ? null : timestamp(row.expires_at),
    };
    assertPersistedTaskPackDraft(record);
    return record;
  } catch (error) {
    if (error instanceof TaskPackDraftStorageError) throw error;
    throw new TaskPackDraftStorageError("TASK_PACK_DRAFT_STATE_INVALID", draftId);
  }
}

function parseContent(value: unknown): TaskPackDraftContent {
  if (typeof value === "string") return JSON.parse(value) as TaskPackDraftContent;
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as TaskPackDraftContent;
  }
  throw new Error("Invalid persisted Task Pack draft content.");
}

function timestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  throw new Error("Invalid persisted Task Pack draft timestamp.");
}
