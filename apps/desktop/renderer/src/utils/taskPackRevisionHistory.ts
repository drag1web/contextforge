import { ApiRequestError } from "../api/client";
import type { TaskPackRevisionDetail, TaskPackRevisionHistory, TaskPackRevisionHistoryItem } from "../types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const isId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const isTimestamp = (value: unknown): value is string => typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
const metadataKeys = ["id", "revisionNumber", "baseRevisionId", "sourceKind", "createdAt", "generatedAt", "contentHash",
  "generationMode", "generationModel", "generationUsedFallback", "reviewState"] as const;
const bodyKeys = ["rawTask", "taskType", "targetTool", "generatedPrompt"] as const;
class RevisionHistoryResponseError extends Error {
  constructor() { super("Invalid Task Pack revision history response."); }
}

export function assertTaskPackRevisionReadId(value: number): void {
  if (!isId(value)) throw new RevisionHistoryResponseError();
}

function parseItem(value: unknown, detail = false): TaskPackRevisionHistoryItem {
  if (!isRecord(value) || !exactKeys(value, detail ? [...metadataKeys, ...bodyKeys] : metadataKeys) ||
    !isId(value.id) || !isId(value.revisionNumber) || !(value.baseRevisionId === null || isId(value.baseRevisionId)) ||
    typeof value.sourceKind !== "string" || !["generated", "manual_edit", "regenerated", "imported", "split", "legacy_snapshot"].includes(value.sourceKind) ||
    !isTimestamp(value.createdAt) || !(value.generatedAt === null || isTimestamp(value.generatedAt)) ||
    typeof value.contentHash !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value.contentHash) ||
    !(value.generationMode === "template" || value.generationMode === "ollama") ||
    !(value.generationModel === null || typeof value.generationModel === "string") ||
    typeof value.generationUsedFallback !== "boolean" ||
    typeof value.reviewState !== "string" || !["unreviewed", "in_review", "accepted", "changes_requested"].includes(value.reviewState) ||
    (detail && !bodyKeys.every(key => typeof value[key] === "string"))) throw new RevisionHistoryResponseError();
  // Copy only allowed fields; never retain the incoming object or arbitrary nested JSON.
  return Object.freeze({
    id: value.id, revisionNumber: value.revisionNumber, baseRevisionId: value.baseRevisionId,
    sourceKind: value.sourceKind, createdAt: value.createdAt, generatedAt: value.generatedAt,
    contentHash: value.contentHash, generationMode: value.generationMode, generationModel: value.generationModel,
    generationUsedFallback: value.generationUsedFallback, reviewState: value.reviewState,
    ...(detail ? { rawTask: value.rawTask, taskType: value.taskType, targetTool: value.targetTool,
      generatedPrompt: value.generatedPrompt } : {}),
  }) as TaskPackRevisionHistoryItem;
}

export function parseTaskPackRevisionHistory(value: unknown, taskPackId: number): TaskPackRevisionHistory {
  assertTaskPackRevisionReadId(taskPackId);
  if (!isRecord(value) || !exactKeys(value, ["taskPackId", "currentRevisionId", "revisions"]) ||
    value.taskPackId !== taskPackId || !isId(value.currentRevisionId) || !Array.isArray(value.revisions)) {
    throw new RevisionHistoryResponseError();
  }
  const revisions = value.revisions.map(item => parseItem(item));
  if (new Set(revisions.map(item => item.id)).size !== revisions.length ||
    new Set(revisions.map(item => item.revisionNumber)).size !== revisions.length) throw new RevisionHistoryResponseError();
  return Object.freeze({ taskPackId, currentRevisionId: value.currentRevisionId, revisions: Object.freeze(revisions) });
}

export function parseTaskPackRevisionDetail(value: unknown, taskPackId: number, revisionId: number): TaskPackRevisionDetail {
  assertTaskPackRevisionReadId(taskPackId);
  assertTaskPackRevisionReadId(revisionId);
  if (!isRecord(value) || !exactKeys(value, ["taskPackId", "currentRevisionId", "revision"]) ||
    value.taskPackId !== taskPackId || !isId(value.currentRevisionId)) throw new RevisionHistoryResponseError();
  const revision = parseItem(value.revision, true) as TaskPackRevisionDetail["revision"];
  if (revision.id !== revisionId) throw new RevisionHistoryResponseError();
  return Object.freeze({ taskPackId, currentRevisionId: value.currentRevisionId, revision });
}

export function parseTaskPackRevisionHistoryResponse(value: unknown, taskPackId: number): TaskPackRevisionHistory {
  if (!isRecord(value) || !exactKeys(value, ["ok", "history"]) || value.ok !== true) throw new RevisionHistoryResponseError();
  return parseTaskPackRevisionHistory(value.history, taskPackId);
}
export function parseTaskPackRevisionDetailResponse(value: unknown, taskPackId: number, revisionId: number): TaskPackRevisionDetail {
  if (!isRecord(value) || !exactKeys(value, ["ok", "revision"]) || value.ok !== true) throw new RevisionHistoryResponseError();
  return parseTaskPackRevisionDetail(value.revision, taskPackId, revisionId);
}

export type RevisionHistoryReadStatus = "idle" | "loading" | "ready" | "failed";
export interface TaskPackRevisionHistorySnapshot {
  readonly taskPackId: number;
  readonly status: RevisionHistoryReadStatus;
  readonly history: TaskPackRevisionHistory | null;
  readonly selectedRevisionId: number | null;
  readonly detailStatus: RevisionHistoryReadStatus;
  readonly detail: TaskPackRevisionDetail | null;
  readonly detailUnavailable: boolean;
}
export interface TaskPackRevisionHistoryApi {
  getTaskPackRevisionHistory(taskPackId: number): Promise<unknown>;
  getTaskPackRevisionDetail(taskPackId: number, revisionId: number): Promise<unknown>;
}

/** Result-local read owner. No current document, mutation authority or persistent detail cache. */
export function createTaskPackRevisionHistoryController(taskPackId: number, api: TaskPackRevisionHistoryApi) {
  assertTaskPackRevisionReadId(taskPackId);
  let state: TaskPackRevisionHistorySnapshot = { taskPackId, status: "idle", history: null,
    selectedRevisionId: null, detailStatus: "idle", detail: null, detailUnavailable: false };
  let alive = false;
  let historyRequest = 0;
  let detailRequest = 0;
  const listeners = new Set<() => void>();
  const publish = (next: Partial<TaskPackRevisionHistorySnapshot>) => {
    state = { ...state, ...next }; listeners.forEach(listener => listener());
  };
  function clearSelection() {
    ++detailRequest;
    publish({ selectedRevisionId: null, detailStatus: "idle", detail: null, detailUnavailable: false });
  }
  async function refresh() {
    if (!alive || state.status === "loading") return;
    const request = ++historyRequest;
    clearSelection();
    publish({ status: "loading", history: null });
    try {
      const history = parseTaskPackRevisionHistory(await api.getTaskPackRevisionHistory(taskPackId), taskPackId);
      if (alive && request === historyRequest) publish({ status: "ready", history });
    } catch {
      if (alive && request === historyRequest) publish({ status: "failed", history: null });
    }
  }
  async function selectRevision(revisionId: number) {
    if (!alive || state.status !== "ready" || !state.history?.revisions.some(item => item.id === revisionId) ||
      (state.selectedRevisionId === revisionId && state.detailStatus === "loading")) return;
    const request = ++detailRequest;
    publish({ selectedRevisionId: revisionId, detailStatus: "loading", detail: null, detailUnavailable: false });
    try {
      const detail = parseTaskPackRevisionDetail(await api.getTaskPackRevisionDetail(taskPackId, revisionId), taskPackId, revisionId);
      if (alive && request === detailRequest) publish({ detailStatus: "ready", detail });
    } catch (error) {
      if (alive && request === detailRequest) publish({ detailStatus: "failed", detail: null,
        detailUnavailable: error instanceof ApiRequestError && error.status === 404 });
    }
  }
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    activate: () => {
      if (alive) return Promise.resolve();
      alive = true;
      publish({ status: "idle" }); // React StrictMode disposal invalidated any preceding request.
      return refresh();
    },
    refresh,
    retryHistory: refresh,
    selectRevision,
    retryDetail: () => state.selectedRevisionId === null ? Promise.resolve() : selectRevision(state.selectedRevisionId),
    clearSelection,
    dispose: () => { alive = false; ++historyRequest; ++detailRequest; },
  };
}
