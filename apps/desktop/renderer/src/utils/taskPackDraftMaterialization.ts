import type {
  MaterializeTaskPackDraftResponse, TaskPack, TaskPackDraft, TaskPackDraftSession,
  TaskPackPersistedDraftContent, TaskPackPersistedDraftView, UpdateTaskPackDraftRequest,
} from "../types";
import {
  deserializeTaskPackDraftContent, editTaskPackDraftSession, isTaskPackDraftSessionDirty, serializeTaskPackDraftContent,
  taskPackDraftPersistenceIssue, updateTaskPackDraftSavedBaseline,
  type TaskPackDraftOperation, type TaskPackDraftPersistenceIssue,
} from "./taskPackDraftSession";

export type TaskPackDraftMaterializationPhase = "savingFinal" | "creating";
export interface TaskPackDraftMaterializationOperation {
  readonly sessionId: string;
  readonly draftId: string;
  readonly projectId: number;
  readonly expectedDraftVersion: number;
  readonly content: TaskPackPersistedDraftContent;
  readonly needSave: boolean;
  readonly session: TaskPackDraftSession;
  readonly saveOperation: TaskPackDraftOperation;
}
export interface TaskPackDraftMaterializationIssue extends TaskPackDraftPersistenceIssue {
  readonly phase: TaskPackDraftMaterializationPhase;
}
export interface TaskPackDraftMaterializationApi {
  updateTaskPackDraft(id: string, input: UpdateTaskPackDraftRequest): Promise<TaskPackPersistedDraftView>;
  materializeTaskPackDraft(id: string, version: number): Promise<MaterializeTaskPackDraftResponse>;
}

export class TaskPackDraftMaterializationError extends Error {
  readonly code = "TASK_PACK_DRAFT_STATE_INVALID";
  constructor() { super("Task Pack draft creation response is invalid."); }
}

const positiveSafeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

export function canMaterializeTaskPackDraft(session: TaskPackDraftSession | null): boolean {
  const persisted = session?.persistence;
  return !!persisted && persisted.lifecycle.state === "active" &&
    persisted.taskPackId === null && persisted.baseRevisionId === null &&
    positiveSafeInteger(persisted.draftVersion);
}

/** Snapshot only AFTER Builder understanding/review. Never normalize author text. */
export function captureTaskPackDraftMaterialization(
  current: TaskPackDraftSession | null,
  expectedSessionId: string | undefined,
  finalDraft: TaskPackDraft,
): TaskPackDraftMaterializationOperation | null {
  if (!current || current.sessionId !== expectedSessionId ||
    current.draft.projectId !== finalDraft.projectId || !canMaterializeTaskPackDraft(current)) return null;
  const content = serializeTaskPackDraftContent(finalDraft);
  Object.freeze(content.enabledRuleIds);
  content.clarifications.forEach(Object.freeze);
  Object.freeze(content.clarifications);
  Object.freeze(content);
  // Copy persistence as well: response validation never depends on later UI state.
  const persistence = {
    ...current.persistence!, lifecycle: Object.freeze({ ...current.persistence!.lifecycle }),
    lastSavedContent: structuredClone(current.persistence!.lastSavedContent),
  };
  const session = editTaskPackDraftSession({ ...current, persistence }, finalDraft);
  const saveOperation: TaskPackDraftOperation = Object.freeze({
    kind: "saving", sessionId: current.sessionId, projectId: finalDraft.projectId,
    draftId: persistence.id, expectedDraftVersion: persistence.draftVersion, content,
  });
  return Object.freeze({
    sessionId: current.sessionId, draftId: persistence.id, projectId: finalDraft.projectId,
    expectedDraftVersion: persistence.draftVersion, content,
    needSave: isTaskPackDraftSessionDirty(session), session, saveOperation,
  });
}

function contentMatches(actual: TaskPackPersistedDraftView, expected: TaskPackPersistedDraftContent) {
  // Field order on the wire is immaterial; array order and authored strings are not.
  try {
    return JSON.stringify(serializeTaskPackDraftContent(deserializeTaskPackDraftContent(actual))) === JSON.stringify(expected);
  } catch { return false; }
}

export function ownsTaskPackDraftMaterialization(
  current: TaskPackDraftSession | null, operation: TaskPackDraftMaterializationOperation,
): boolean {
  return current?.sessionId === operation.sessionId && current.draft.projectId === operation.projectId &&
    current.persistence?.id === operation.draftId;
}

function validateSavedDraft(operation: TaskPackDraftMaterializationOperation, view: TaskPackPersistedDraftView) {
  if (!view || view.id !== operation.draftId || view.projectId !== operation.projectId ||
    view.lifecycle?.state !== "active" || view.lifecycle.materializedRevisionId !== null ||
    view.taskPackId !== null || view.baseRevisionId !== null ||
    !positiveSafeInteger(view.draftVersion) || view.draftVersion < operation.expectedDraftVersion ||
    !contentMatches(view, operation.content)) throw new TaskPackDraftMaterializationError();
  // Share the ordinary Save boundary: identity, monotonic server token and independent baseline copy.
  return updateTaskPackDraftSavedBaseline(operation.session, view);
}

export function validateTaskPackDraftMaterializationResult(
  operation: TaskPackDraftMaterializationOperation,
  version: number,
  response: MaterializeTaskPackDraftResponse,
): void {
  const draft = response?.draft, revision = response?.revision, taskPack = response?.taskPack;
  if (response?.ok !== true || !draft || !revision || !taskPack ||
    draft.id !== operation.draftId || draft.projectId !== operation.projectId ||
    draft.lifecycle?.state !== "materialized" || draft.lifecycle.materializedRevisionId !== revision.id ||
    !positiveSafeInteger(taskPack.id) || !positiveSafeInteger(revision.id) ||
    taskPack.projectId !== operation.projectId || revision.taskPackId !== taskPack.id ||
    taskPack.currentRevisionId !== revision.id || revision.revisionNumber !== 1 ||
    draft.taskPackId !== taskPack.id || draft.baseRevisionId !== null ||
    !positiveSafeInteger(draft.draftVersion) || draft.draftVersion !== version + 1 ||
    !contentMatches(draft, operation.content)) throw new TaskPackDraftMaterializationError();
}

// A captured command is single-use even after a failure: retry requires a new explicit action.
const executed = new WeakSet<TaskPackDraftMaterializationOperation>();
export async function executeTaskPackDraftMaterialization(
  operation: TaskPackDraftMaterializationOperation,
  api: TaskPackDraftMaterializationApi,
  callbacks: {
    onPhase?: (phase: TaskPackDraftMaterializationPhase) => void;
    onSaved?: (view: TaskPackPersistedDraftView, session: TaskPackDraftSession) => void;
  } = {},
): Promise<MaterializeTaskPackDraftResponse> {
  if (executed.has(operation)) throw new TaskPackDraftMaterializationError();
  executed.add(operation);
  let version = operation.expectedDraftVersion;
  if (operation.needSave) {
    callbacks.onPhase?.("savingFinal");
    const view = await api.updateTaskPackDraft(operation.draftId, {
      expectedDraftVersion: version, content: operation.content,
    });
    const session = validateSavedDraft(operation, view);
    version = view.draftVersion; // A no-op PATCH can return the SAME version.
    callbacks.onSaved?.(view, session); // A successful Save survives subsequent creation failure.
  }
  callbacks.onPhase?.("creating");
  const response = await api.materializeTaskPackDraft(operation.draftId, version);
  validateTaskPackDraftMaterializationResult(operation, version, response);
  return response;
}

export function taskPackDraftMaterializationIssue(
  operation: TaskPackDraftMaterializationOperation,
  phase: TaskPackDraftMaterializationPhase,
  authoritativeVersion: number,
  code?: string,
  data?: unknown,
): TaskPackDraftMaterializationIssue {
  return {
    ...taskPackDraftPersistenceIssue({ ...operation.saveOperation, expectedDraftVersion: authoritativeVersion }, code, data),
    phase,
  };
}

export function upsertMaterializedTaskPack(current: TaskPack[], taskPack: TaskPack): TaskPack[] {
  return [taskPack, ...current.filter(item => item.id !== taskPack.id)];
}
