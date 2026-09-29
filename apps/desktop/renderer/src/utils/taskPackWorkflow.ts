import { ApiRequestError } from "../api/client";
import type { TaskPackLifecycleRequest, TaskPackReviewRequest, TaskPackReviewState, TaskPackWorkflowState } from "../types";

export type TaskPackWorkflowAction = TaskPackLifecycleRequest["action"] | TaskPackReviewRequest["action"];
export interface TaskPackWorkflowOperation {
  readonly taskPackId: number;
  readonly currentRevisionId: number;
  readonly expectedLifecycleVersion: number;
  readonly expectedReviewState: TaskPackReviewState;
  readonly action: TaskPackWorkflowAction;
}
export interface TaskPackWorkflowApi {
  getTaskPackWorkflow(id: number): Promise<unknown>;
  transitionTaskPackLifecycle(id: number, input: TaskPackLifecycleRequest): Promise<unknown>;
  transitionTaskPackRevisionReview(id: number, revisionId: number, input: TaskPackReviewRequest): Promise<unknown>;
}
const reviewStates = ["unreviewed", "in_review", "accepted", "changes_requested"] as const;
const isIdentity = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const isReview = (value: unknown): value is TaskPackReviewState => reviewStates.includes(value as TaskPackReviewState);
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const isTimestamp = (value: unknown) => value === null || (typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(value) && Number.isFinite(Date.parse(value)));
class WorkflowResponseError extends Error {
  constructor() { super("Invalid workflow response"); }
}

/** Validate the read DTO, not backend transition policy. Never retain extra fields. */
export function parseTaskPackWorkflow(value: unknown, taskPackId?: number): TaskPackWorkflowState {
  if (!isRecord(value) || !hasExactKeys(value, ["taskPackId", "lifecycle", "lifecycleVersion", "currentRevisionId",
    "acceptedRevisionId", "completedAt", "archivedAt", "currentReviewState"]) ||
    !isIdentity(value.taskPackId) || (taskPackId !== undefined && value.taskPackId !== taskPackId) ||
    !isIdentity(value.lifecycleVersion) || !isIdentity(value.currentRevisionId) ||
    !(value.acceptedRevisionId === null || isIdentity(value.acceptedRevisionId)) ||
    !isReview(value.currentReviewState) || !isTimestamp(value.completedAt) || !isTimestamp(value.archivedAt) ||
    !isRecord(value.lifecycle) || !hasExactKeys(value.lifecycle, ["state", "archivedFromState"])) throw new WorkflowResponseError();
  const lifecycle = value.lifecycle;
  if (!((lifecycle.state === "active" || lifecycle.state === "completed") && lifecycle.archivedFromState === null) &&
    !(lifecycle.state === "archived" && (lifecycle.archivedFromState === "active" || lifecycle.archivedFromState === "completed"))) {
    throw new WorkflowResponseError();
  }
  return Object.freeze({ ...value, lifecycle: Object.freeze({ ...lifecycle }) }) as unknown as TaskPackWorkflowState;
}

/** UX guidance only; storage remains the authority for every submitted transition. */
export function getTaskPackWorkflowCapabilities(state: TaskPackWorkflowState) {
  const lifecycle: TaskPackLifecycleRequest["action"][] = state.lifecycle.state === "active"
    ? (state.currentReviewState === "accepted" && state.acceptedRevisionId === state.currentRevisionId ? ["complete", "archive"] : ["archive"])
    : state.lifecycle.state === "completed" ? ["reopen", "archive"] : ["unarchive"];
  const review: TaskPackReviewRequest["action"][] = state.currentReviewState === "unreviewed" ? ["start_review", "accept"]
    : state.currentReviewState === "in_review" ? ["accept", "request_changes"] : [];
  return { lifecycle, review, canEdit: state.lifecycle.state === "active" };
}

export function captureTaskPackWorkflowOperation(state: TaskPackWorkflowState, action: TaskPackWorkflowAction): TaskPackWorkflowOperation {
  const snapshot = parseTaskPackWorkflow(state);
  const available = getTaskPackWorkflowCapabilities(snapshot);
  if (![...available.lifecycle, ...available.review].includes(action)) throw new WorkflowResponseError();
  return Object.freeze({ taskPackId: snapshot.taskPackId, currentRevisionId: snapshot.currentRevisionId,
    expectedLifecycleVersion: snapshot.lifecycleVersion, expectedReviewState: snapshot.currentReviewState, action });
}

export type TaskPackWorkflowIssueKind = "conflict" | "not_found" | "invalid_transition" | "version_exhausted" |
  "state_invalid" | "event_exists" | "request_failed" | "revision_changed";
const issueCodes = {
  TASK_PACK_NOT_FOUND: "not_found",
  TASK_PACK_LIFECYCLE_NOT_FOUND: "not_found", TASK_PACK_REVIEW_NOT_FOUND: "not_found", TASK_PACK_REVIEW_REVISION_NOT_FOUND: "not_found",
  TASK_PACK_LIFECYCLE_CONFLICT: "conflict", TASK_PACK_REVIEW_CONFLICT: "conflict",
  TASK_PACK_LIFECYCLE_INVALID_TRANSITION: "invalid_transition", TASK_PACK_REVIEW_INVALID_TRANSITION: "invalid_transition",
  TASK_PACK_LIFECYCLE_VERSION_EXHAUSTED: "version_exhausted", TASK_PACK_REVIEW_VERSION_EXHAUSTED: "version_exhausted",
  TASK_PACK_CURRENT_STATE_INVALID: "state_invalid", TASK_PACK_LIFECYCLE_STATE_INVALID: "state_invalid", TASK_PACK_REVIEW_STATE_INVALID: "state_invalid",
  TASK_PACK_LIFECYCLE_EVENT_EXISTS: "event_exists", TASK_PACK_REVIEW_EVENT_EXISTS: "event_exists",
  TASK_PACK_WORKFLOW_FAILED: "request_failed", TASK_PACK_WORKFLOW_INVALID: "request_failed",
  TASK_PACK_LIFECYCLE_PRECONDITION_REQUIRED: "request_failed", TASK_PACK_REVIEW_PRECONDITION_REQUIRED: "request_failed",
} as const;
export interface TaskPackWorkflowIssue {
  readonly kind: TaskPackWorkflowIssueKind;
  readonly phase: "load" | "refresh" | "mutation";
  readonly status?: number;
  readonly code?: keyof typeof issueCodes;
  readonly evidence?: Readonly<{
    taskPackId?: number; revisionId?: number; expectedLifecycleVersion?: number; actualLifecycleVersion?: number;
    expectedReviewState?: TaskPackReviewState; actualReviewState?: TaskPackReviewState;
  }>;
  readonly refreshFailed?: boolean;
}
export function taskPackWorkflowIssue(error: unknown, phase: TaskPackWorkflowIssue["phase"]): TaskPackWorkflowIssue {
  if (error instanceof WorkflowResponseError) return { kind: "state_invalid", phase };
  if (!(error instanceof ApiRequestError)) return { kind: "request_failed", phase };
  const code = error.code && Object.hasOwn(issueCodes, error.code) ? error.code as keyof typeof issueCodes : undefined;
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : undefined;
  const safe: Record<string, number | TaskPackReviewState> = {};
  if (isRecord(error.data)) {
    for (const key of ["taskPackId", "revisionId", "expectedLifecycleVersion", "actualLifecycleVersion"] as const) {
      if (isIdentity(error.data[key])) safe[key] = error.data[key];
    }
    for (const key of ["expectedReviewState", "actualReviewState"] as const) {
      if (isReview(error.data[key])) safe[key] = error.data[key];
    }
  }
  return { kind: code ? issueCodes[code] : status === 404 ? "not_found" : status === 409 ? "conflict" : "request_failed",
    phase, ...(status !== undefined ? { status } : {}), ...(code ? { code } : {}), evidence: Object.freeze(safe) };
}

export async function executeTaskPackWorkflowOperation(operation: TaskPackWorkflowOperation, api: TaskPackWorkflowApi) {
  const read = async () => parseTaskPackWorkflow(await api.getTaskPackWorkflow(operation.taskPackId), operation.taskPackId);
  try {
    const { action } = operation;
    if (action === "start_review" || action === "accept" || action === "request_changes") {
      await api.transitionTaskPackRevisionReview(operation.taskPackId, operation.currentRevisionId, {
        expectedLifecycleVersion: operation.expectedLifecycleVersion, expectedReviewState: operation.expectedReviewState, action,
      });
    } else {
      await api.transitionTaskPackLifecycle(operation.taskPackId, { expectedLifecycleVersion: operation.expectedLifecycleVersion, action });
    }
  } catch (error) {
    const issue = taskPackWorkflowIssue(error, "mutation");
    if (issue.status === 409) {
      try { return { workflow: await read(), issue }; }
      catch { return { workflow: null, issue: { ...issue, refreshFailed: true } }; }
    }
    return { workflow: null, issue };
  }
  try { return { workflow: await read(), issue: null }; }
  catch (error) { return { workflow: null, issue: taskPackWorkflowIssue(error, "refresh") }; }
}

export interface TaskPackWorkflowSnapshot {
  readonly workflow: TaskPackWorkflowState | null;
  readonly loading: boolean;
  readonly refreshing: boolean;
  readonly activeAction: TaskPackWorkflowAction | null;
  readonly issue: TaskPackWorkflowIssue | null;
  readonly blocked: boolean;
}

/** Observable owner, allowing executable race/duplicate-click tests without a DOM framework. */
export function createTaskPackWorkflowController(
  taskPackId: number, currentRevisionId: number | undefined, api: TaskPackWorkflowApi,
) {
  let state: TaskPackWorkflowSnapshot = { workflow: null, loading: true, refreshing: false, activeAction: null, issue: null, blocked: true };
  let generation = 0;
  let alive = true;
  const listeners = new Set<() => void>();
  const publish = (next: Partial<TaskPackWorkflowSnapshot>) => { state = { ...state, ...next }; listeners.forEach(listener => listener()); };
  const owns = (request: number) => alive && generation === request;
  const reconcile = (workflow: TaskPackWorkflowState | null, issue: TaskPackWorkflowIssue | null) => {
    const mismatch = workflow !== null && currentRevisionId !== undefined && workflow.currentRevisionId !== currentRevisionId;
    publish({ workflow: workflow ?? state.workflow, issue: mismatch ? { kind: "revision_changed", phase: "refresh" } : issue,
      blocked: !workflow || mismatch, loading: false, refreshing: false, activeAction: null });
  };
  async function refresh() {
    if (!alive || state.activeAction) return;
    const request = ++generation;
    const phase = state.workflow ? "refresh" : "load";
    publish({ loading: !state.workflow, refreshing: !!state.workflow, blocked: true });
    try {
      const workflow = parseTaskPackWorkflow(await api.getTaskPackWorkflow(taskPackId), taskPackId);
      if (owns(request)) reconcile(workflow, null);
    } catch (error) {
      if (owns(request)) reconcile(null, taskPackWorkflowIssue(error, phase));
    }
  }
  async function execute(input: TaskPackWorkflowAction | TaskPackWorkflowOperation) {
    if (!alive || state.blocked || state.loading || state.refreshing || state.activeAction || !state.workflow) return;
    const operation = typeof input === "string" ? captureTaskPackWorkflowOperation(state.workflow, input) : input;
    if (operation.taskPackId !== taskPackId || operation.currentRevisionId !== state.workflow.currentRevisionId) return;
    const request = ++generation;
    publish({ activeAction: operation.action, issue: null }); // synchronous duplicate-click lock
    const result = await executeTaskPackWorkflowOperation(operation, api);
    if (owns(request)) reconcile(result.workflow, result.issue);
  }
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh, execute,
    clearIssue: () => publish({ issue: null }),
    activate: () => { alive = true; publish({ activeAction: null }); return refresh(); },
    dispose: () => { alive = false; ++generation; },
  };
}
