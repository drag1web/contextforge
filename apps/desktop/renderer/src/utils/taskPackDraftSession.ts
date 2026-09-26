import type {
  TaskPackDraft,
  TaskPackDraftPersistenceState,
  TaskPackDraftSession,
  TaskPackPersistedDraftContent,
  TaskPackPersistedDraftView,
  CreateTaskPackDraftRequest,
  UpdateTaskPackDraftRequest,
} from "../types";

/** Fixed-field projection: no generation normalization, identity or display metadata. */
function copyContent(
  content: TaskPackDraft | TaskPackPersistedDraftContent,
): TaskPackPersistedDraftContent {
  return {
    rawTask: content.rawTask,
    taskType: content.taskType,
    targetTool: content.targetTool,
    templateId: content.templateId ?? null,
    ruleProfileId: content.ruleProfileId ?? null,
    enabledRuleIds: [...(content.enabledRuleIds ?? [])],
    customRulesText: content.customRulesText ?? null,
    acceptanceCriteriaPresetId: content.acceptanceCriteriaPresetId ?? null,
    acceptanceCriteriaText: content.acceptanceCriteriaText ?? null,
    clarifications: (content.clarifications ?? []).map(({ question, answer }) => ({
      question,
      answer,
    })),
    performanceSessionId: content.performanceSessionId ?? null,
    understandingSnapshotId: content.understandingSnapshotId ?? null,
    reviewedUnderstandingSnapshotId: content.reviewedUnderstandingSnapshotId ?? null,
  };
}

export function serializeTaskPackDraftContent(
  draft: TaskPackDraft,
): TaskPackPersistedDraftContent {
  return copyContent(draft);
}

export function deserializeTaskPackDraftContent(
  view: TaskPackPersistedDraftView,
): TaskPackDraft {
  const content = view.content;
  return {
    projectId: view.projectId,
    projectName: view.projectName,
    rawTask: content.rawTask,
    taskType: content.taskType,
    targetTool: content.targetTool,
    templateId: content.templateId ?? undefined,
    ruleProfileId: content.ruleProfileId ?? undefined,
    enabledRuleIds: [...content.enabledRuleIds],
    customRulesText: content.customRulesText ?? undefined,
    acceptanceCriteriaPresetId: content.acceptanceCriteriaPresetId ?? undefined,
    acceptanceCriteriaText: content.acceptanceCriteriaText ?? undefined,
    clarifications: content.clarifications.map(({ question, answer }) => ({ question, answer })),
    performanceSessionId: content.performanceSessionId ?? undefined,
    understandingSnapshotId: content.understandingSnapshotId ?? undefined,
    reviewedUnderstandingSnapshotId: content.reviewedUnderstandingSnapshotId ?? undefined,
  };
}

function copyEditableDraft(draft: TaskPackDraft): TaskPackDraft {
  return {
    ...draft,
    enabledRuleIds: draft.enabledRuleIds?.slice(),
    clarifications: draft.clarifications?.map(({ question, answer }) => ({ question, answer })),
  };
}

function persistenceFromView(view: TaskPackPersistedDraftView): TaskPackDraftPersistenceState {
  return {
    id: view.id,
    draftVersion: view.draftVersion,
    lifecycle: { ...view.lifecycle },
    taskPackId: view.taskPackId,
    baseRevisionId: view.baseRevisionId,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
    expiresAt: view.expiresAt,
    lastSavedContent: copyContent(view.content),
  };
}

function assertSessionId(sessionId: string, persistedId?: string): void {
  if (!sessionId.trim() || sessionId === persistedId) {
    throw new Error("A separate renderer draft session identity is required.");
  }
}

/** The caller supplies local identity; helpers perform no randomness, clock reads or I/O. */
export function createTransientTaskPackDraftSession(
  sessionId: string,
  draft: TaskPackDraft,
): TaskPackDraftSession {
  assertSessionId(sessionId);
  return { sessionId, draft: copyEditableDraft(draft), persistence: null };
}

export function createTaskPackDraftSessionFromPersisted(
  sessionId: string,
  view: TaskPackPersistedDraftView,
): TaskPackDraftSession {
  assertSessionId(sessionId, view.id);
  return {
    sessionId,
    draft: deserializeTaskPackDraftContent(view),
    persistence: persistenceFromView(view),
  };
}

/** Restart is not an exact round-trip: old process analysis is not current evidence. */
export function createRestoredTaskPackDraftSession(
  sessionId: string,
  view: TaskPackPersistedDraftView,
): TaskPackDraftSession {
  if (view.lifecycle.state !== "active" || view.taskPackId !== null || view.baseRevisionId !== null) {
    throw new Error("Only active unbound drafts can be restored.");
  }
  const session = createTaskPackDraftSessionFromPersisted(sessionId, view);
  return { ...session, draft: {
    ...session.draft,
    performanceSessionId: undefined,
    understandingSnapshotId: undefined,
    reviewedUnderstandingSnapshotId: undefined,
  } };
}

/**
 * Apply a successful response to its captured session, retaining current local edits.
 * Callers must associate responses with the originating session before applying them.
 * A no-op save may return the same version; never infer a version increment here.
 */
export function updateTaskPackDraftSavedBaseline(
  session: TaskPackDraftSession,
  view: TaskPackPersistedDraftView,
): TaskPackDraftSession {
  assertSessionId(session.sessionId, view.id);
  if (
    session.draft.projectId !== view.projectId ||
    (session.persistence !== null &&
      (session.persistence.id !== view.id || view.draftVersion < session.persistence.draftVersion))
  ) {
    throw new Error("The saved draft does not match the current draft session.");
  }
  return {
    sessionId: session.sessionId,
    draft: copyEditableDraft(session.draft),
    persistence: persistenceFromView(view),
  };
}

export function isPersistedTaskPackDraftSession(
  session: TaskPackDraftSession,
): session is TaskPackDraftSession & { readonly persistence: TaskPackDraftPersistenceState } {
  return session.persistence !== null;
}

/** Transient drafts have no saved baseline (even a blank shell); eligibility is separate. */
export function isTaskPackDraftSessionDirty(session: TaskPackDraftSession): boolean {
  return session.persistence === null ||
    JSON.stringify(serializeTaskPackDraftContent(session.draft)) !==
      JSON.stringify(copyContent(session.persistence.lastSavedContent));
}

export function canPersistTaskPackDraft(draft: TaskPackDraft): boolean {
  return draft.rawTask.trim().length > 0;
}

export interface TaskPackDraftOperation {
  readonly kind: "saving" | "discarding" | "reloading";
  readonly sessionId: string;
  readonly projectId: number;
  readonly draftId: string | null;
  readonly expectedDraftVersion: number | null;
  readonly content: TaskPackPersistedDraftContent;
}

export interface TaskPackDraftPersistenceIssue {
  readonly sessionId: string;
  readonly code: string;
  readonly conflict?: {
    readonly draftId: string;
    readonly expectedDraftVersion: number;
    readonly actualDraftVersion?: number;
  };
}

export interface TaskPackDraftPersistenceApi {
  createTaskPackDraft(input: CreateTaskPackDraftRequest): Promise<TaskPackPersistedDraftView>;
  updateTaskPackDraft(id: string, input: UpdateTaskPackDraftRequest): Promise<TaskPackPersistedDraftView>;
  discardTaskPackDraft(id: string, version: number): Promise<TaskPackPersistedDraftView>;
  getTaskPackDraft(id: string): Promise<TaskPackPersistedDraftView>;
}

export function editTaskPackDraftSession(
  session: TaskPackDraftSession,
  draft: TaskPackDraft,
): TaskPackDraftSession {
  if (session.draft.projectId !== draft.projectId) {
    throw new Error("Cannot move a draft editing session to another project.");
  }
  return { ...session, draft: copyEditableDraft(draft) };
}

/** Capture content and CAS token before the first await. No automatic persistence. */
export function captureTaskPackDraftOperation(
  session: TaskPackDraftSession,
  kind: TaskPackDraftOperation["kind"],
): TaskPackDraftOperation | null {
  if (kind !== "saving" && !session.persistence) return null;
  if (kind !== "reloading" && session.persistence &&
    session.persistence.lifecycle.state !== "active") return null;
  if (kind === "saving" && !canPersistTaskPackDraft(session.draft)) return null;
  return {
    kind,
    sessionId: session.sessionId,
    projectId: session.draft.projectId,
    draftId: session.persistence?.id ?? null,
    expectedDraftVersion: session.persistence?.draftVersion ?? null,
    content: serializeTaskPackDraftContent(session.draft),
  };
}

export async function executeTaskPackDraftOperation(
  operation: TaskPackDraftOperation,
  api: TaskPackDraftPersistenceApi,
): Promise<TaskPackPersistedDraftView> {
  let view: TaskPackPersistedDraftView;
  if (operation.kind === "saving") {
    view = operation.draftId === null
      ? await api.createTaskPackDraft({
          projectId: operation.projectId, taskPackId: null, baseRevisionId: null,
          content: operation.content,
        })
      : await api.updateTaskPackDraft(operation.draftId, {
          expectedDraftVersion: operation.expectedDraftVersion!, content: operation.content,
        });
  } else if (operation.kind === "discarding") {
    view = await api.discardTaskPackDraft(operation.draftId!, operation.expectedDraftVersion!);
  } else {
    view = await api.getTaskPackDraft(operation.draftId!);
  }
  if (view.projectId !== operation.projectId ||
    (operation.draftId !== null && view.id !== operation.draftId) ||
    (operation.kind === "discarding" && view.lifecycle.state !== "discarded")) {
    throw new Error("Invalid draft operation response.");
  }
  return view;
}

/** A late response can update only its originating session, never the current replacement. */
export function applyTaskPackDraftOperationResult(
  current: TaskPackDraftSession | null,
  operation: TaskPackDraftOperation,
  view: TaskPackPersistedDraftView,
): TaskPackDraftSession | null {
  if (!current || current.sessionId !== operation.sessionId) return current;
  if (operation.kind === "discarding") return null;
  if (operation.kind === "reloading") {
    if (current.persistence?.id !== view.id || current.draft.projectId !== view.projectId) {
      throw new Error("Reload response does not match the draft session.");
    }
    return createTaskPackDraftSessionFromPersisted(current.sessionId, view);
  }
  return updateTaskPackDraftSavedBaseline(current, view);
}

/** Never copy server messages (which may contain internals) or adopt its conflict token. */
export function taskPackDraftPersistenceIssue(
  operation: TaskPackDraftOperation,
  code: string | undefined,
  data: unknown,
): TaskPackDraftPersistenceIssue {
  const actual = data && typeof data === "object" && "actualDraftVersion" in data
    ? data.actualDraftVersion : undefined;
  return {
    sessionId: operation.sessionId,
    code: code ?? "TASK_PACK_DRAFT_REQUEST_FAILED",
    ...(code === "TASK_PACK_DRAFT_CONFLICT" && operation.draftId !== null ? {
      conflict: {
        draftId: operation.draftId,
        expectedDraftVersion: operation.expectedDraftVersion!,
        ...(typeof actual === "number" && Number.isSafeInteger(actual) && actual > 0
          ? { actualDraftVersion: actual } : {}),
      },
    } : {}),
  };
}

/** Intermediate workflow: persisted drafts must never ordinary-create, including Composer. */
export function canOrdinaryGenerateTaskPackDraft(session: TaskPackDraftSession | null): boolean {
  return session !== null && session.persistence === null;
}

export function taskPackDraftSessionKey(session: TaskPackDraftSession): string {
  return `task-pack-draft-${session.sessionId}`;
}
