import type {
  TaskPackDraft,
  TaskPackDraftPersistenceState,
  TaskPackDraftSession,
  TaskPackPersistedDraftContent,
  TaskPackPersistedDraftView,
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
