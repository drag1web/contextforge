import type { TaskClarification, TaskPack, TaskPackDraft } from "./index";

/** The normalized, closed content shape accepted by the persisted-draft REST API. */
export interface TaskPackPersistedDraftContent {
  readonly rawTask: string;
  readonly taskType: string;
  readonly targetTool: string;
  readonly templateId: string | null;
  readonly ruleProfileId: string | null;
  readonly enabledRuleIds: readonly string[];
  readonly customRulesText: string | null;
  readonly acceptanceCriteriaPresetId: string | null;
  readonly acceptanceCriteriaText: string | null;
  readonly clarifications: readonly Readonly<TaskClarification>[];
  readonly performanceSessionId: string | null;
  readonly understandingSnapshotId: string | null;
  readonly reviewedUnderstandingSnapshotId: string | null;
}

export type TaskPackDraftLifecycle =
  | { readonly state: "active"; readonly materializedRevisionId: null }
  | { readonly state: "materialized"; readonly materializedRevisionId: number }
  | { readonly state: "discarded"; readonly materializedRevisionId: null };

/** Discovery deliberately contains no authored draft content. */
export interface TaskPackPersistedDraftSummary {
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

export interface TaskPackPersistedDraftView extends TaskPackPersistedDraftSummary {
  readonly content: TaskPackPersistedDraftContent;
}

export interface CreateTaskPackDraftRequest {
  readonly projectId: number;
  readonly taskPackId: number | null;
  readonly baseRevisionId: number | null;
  readonly content: TaskPackPersistedDraftContent;
}

export interface UpdateTaskPackDraftRequest {
  readonly expectedDraftVersion: number;
  readonly content: TaskPackPersistedDraftContent;
}

export interface DiscardTaskPackDraftRequest {
  readonly expectedDraftVersion: number;
}

export interface MaterializeTaskPackDraftRequest {
  readonly expectedDraftVersion: number;
}

/** The endpoint returns a descriptor, not the full immutable revision payload. */
export interface TaskPackDraftMaterializationRevision {
  readonly id: number;
  readonly taskPackId: number;
  readonly revisionNumber: number;
  readonly contentHash: string;
  readonly createdAt: string;
  readonly generatedAt: string | null;
}

export interface MaterializeTaskPackDraftResponse {
  readonly ok: true;
  readonly taskPack: TaskPack & { readonly currentRevisionId: number };
  readonly revision: TaskPackDraftMaterializationRevision;
  readonly draft: TaskPackPersistedDraftView;
}

export interface TaskPackDraftPersistenceState {
  readonly id: string;
  readonly draftVersion: number;
  readonly lifecycle: TaskPackDraftLifecycle;
  readonly taskPackId: number | null;
  readonly baseRevisionId: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt: string | null;
  readonly lastSavedContent: TaskPackPersistedDraftContent;
}

export interface TaskPackDraftSession {
  /** Caller-owned renderer session identity, independent of the persisted draft ID. */
  readonly sessionId: string;
  readonly draft: TaskPackDraft;
  readonly persistence: TaskPackDraftPersistenceState | null;
}
