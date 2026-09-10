import type {
  ContextComposerPreview,
  TaskPackDraft,
  TaskUnderstandingResponse,
} from "../types";

export type TaskPackHealthStatus =
  | "clear"
  | "attention"
  | "action_required"
  | "checking";

export type TaskPackHealthSignalState =
  | "ok"
  | "attention"
  | "required"
  | "pending"
  | "neutral";

export type TaskPackHealthSignalId =
  | "task"
  | "recipe"
  | "rules"
  | "acceptance"
  | "understanding"
  | "context"
  | "generation";

export interface TaskPackHealthSignal {
  id: TaskPackHealthSignalId;
  state: TaskPackHealthSignalState;
  detail:
    | "provided"
    | "missing"
    | "configured"
    | "partial"
    | "enabled"
    | "none"
    | "checking"
    | "needs_clarification"
    | "review"
    | "ready"
    | "reviewed_snapshot"
    | "snapshot_pending"
    | "not_run"
    | "not_analyzed"
    | "stale"
    | "v2_ready"
    | "v2_review_required"
    | "safety_blocked"
    | "legacy_fallback"
    | "legacy"
    | "legacy_quality"
    | "warning"
    | "blocked"
    | "busy"
    | "available"
    | "unavailable";
}

export interface TaskPackHealthResult {
  status: TaskPackHealthStatus;
  signals: TaskPackHealthSignal[];
  requiredCount: number;
  attentionCount: number;
  pendingCount: number;
  generationAvailable: boolean;
  contextCurrent: boolean;
}

export interface TaskPackHealthInput {
  draft: TaskPackDraft;
  taskLength: number;
  canGenerate: boolean;
  isLoading: boolean;
  isUnderstanding: boolean;
  hasTemplate: boolean;
  hasProfile: boolean;
  enabledRulesCount: number;
  totalCriteriaCount: number;
  understandingResponse: TaskUnderstandingResponse | null;
  contextPreview?: ContextComposerPreview | null;
}

function sameClarifications(
  left: TaskPackDraft["clarifications"],
  right: ContextComposerPreview["task"]["clarifications"],
) {
  return JSON.stringify(left ?? []) === JSON.stringify(right ?? []);
}

export function contextPreviewMatchesDraft(
  preview: ContextComposerPreview | null | undefined,
  draft: TaskPackDraft,
) {
  if (!preview) return false;

  return (
    preview.project.id === draft.projectId &&
    preview.task.originalRawTask === draft.rawTask &&
    preview.task.requestedTaskType === draft.taskType &&
    preview.task.targetTool === draft.targetTool &&
    sameClarifications(draft.clarifications, preview.task.clarifications)
  );
}

function getUnderstandingSignal(
  draft: TaskPackDraft,
  response: TaskUnderstandingResponse | null,
  isUnderstanding: boolean,
): TaskPackHealthSignal {
  if (isUnderstanding) {
    return { id: "understanding", state: "pending", detail: "checking" };
  }

  const snapshotId = draft.understandingSnapshotId;
  const reviewedSnapshotId = draft.reviewedUnderstandingSnapshotId;

  if (snapshotId && reviewedSnapshotId === snapshotId) {
    return { id: "understanding", state: "ok", detail: "reviewed_snapshot" };
  }

  const currentResponse =
    response && snapshotId && response.understandingSnapshotId === snapshotId
      ? response
      : null;

  if (currentResponse) {
    const understanding = currentResponse.taskUnderstanding;

    if (
      !understanding.canProceed ||
      understanding.readiness === "needs_clarification" ||
      currentResponse.interaction.action === "clarify"
    ) {
      return {
        id: "understanding",
        state: "required",
        detail: "needs_clarification",
      };
    }

    if (
      currentResponse.interaction.action === "review" ||
      understanding.readiness === "review" ||
      understanding.reviewStatus === "pending"
    ) {
      return { id: "understanding", state: "attention", detail: "review" };
    }

    return { id: "understanding", state: "ok", detail: "ready" };
  }

  if (snapshotId) {
    return { id: "understanding", state: "pending", detail: "snapshot_pending" };
  }

  return { id: "understanding", state: "pending", detail: "not_run" };
}

function getContextSignal(
  preview: ContextComposerPreview | null | undefined,
  current: boolean,
): TaskPackHealthSignal {
  if (!preview) {
    return { id: "context", state: "pending", detail: "not_analyzed" };
  }

  if (!current) {
    return { id: "context", state: "pending", detail: "stale" };
  }

  const engine = preview.contextEngine;
  if (engine) {
    if (engine.status === "safety_blocked") {
      return { id: "context", state: "required", detail: "safety_blocked" };
    }

    if (engine.status === "v2_review_required") {
      return { id: "context", state: "attention", detail: "v2_review_required" };
    }

    if (engine.status === "v2_ready") {
      return { id: "context", state: "ok", detail: "v2_ready" };
    }

    if (engine.status === "legacy_fallback") {
      return { id: "context", state: "attention", detail: "legacy_fallback" };
    }

    return { id: "context", state: "neutral", detail: "legacy" };
  }

  if (preview.qualitySource === "blocked" || preview.selectionQuality.status === "blocked") {
    return { id: "context", state: "required", detail: "blocked" };
  }

  if (
    preview.qualitySource === "review_required" ||
    preview.selectionQuality.status === "warning"
  ) {
    return { id: "context", state: "attention", detail: "warning" };
  }

  if (preview.qualitySource === "v2_grounded") {
    return { id: "context", state: "ok", detail: "ready" };
  }

  if (preview.qualitySource === "legacy_quality") {
    return { id: "context", state: "neutral", detail: "legacy_quality" };
  }

  return preview.selectionQuality.status === "ready"
    ? { id: "context", state: "neutral", detail: "ready" }
    : { id: "context", state: "attention", detail: "warning" };
}

export function evaluateTaskPackHealth({
  draft,
  taskLength,
  canGenerate,
  isLoading,
  isUnderstanding,
  hasTemplate,
  hasProfile,
  enabledRulesCount,
  totalCriteriaCount,
  understandingResponse,
  contextPreview,
}: TaskPackHealthInput): TaskPackHealthResult {
  const contextCurrent = contextPreviewMatchesDraft(contextPreview, draft);

  const signals: TaskPackHealthSignal[] = [
    taskLength >= 3
      ? { id: "task", state: "ok", detail: "provided" }
      : { id: "task", state: "required", detail: "missing" },
    hasTemplate && hasProfile
      ? { id: "recipe", state: "ok", detail: "configured" }
      : { id: "recipe", state: "attention", detail: "partial" },
    enabledRulesCount > 0
      ? { id: "rules", state: "ok", detail: "enabled" }
      : { id: "rules", state: "neutral", detail: "none" },
    totalCriteriaCount > 0
      ? { id: "acceptance", state: "ok", detail: "configured" }
      : { id: "acceptance", state: "attention", detail: "none" },
    getUnderstandingSignal(draft, understandingResponse, isUnderstanding),
    getContextSignal(contextPreview, contextCurrent),
    isLoading || isUnderstanding
      ? { id: "generation", state: "pending", detail: "busy" }
      : taskLength < 3
        ? { id: "generation", state: "required", detail: "missing" }
        : canGenerate
          ? { id: "generation", state: "ok", detail: "available" }
          : { id: "generation", state: "attention", detail: "unavailable" },
  ];

  const requiredCount = signals.filter((signal) => signal.state === "required").length;
  const attentionCount = signals.filter((signal) => signal.state === "attention").length;
  const pendingCount = signals.filter((signal) => signal.state === "pending").length;

  const status: TaskPackHealthStatus =
    isLoading || isUnderstanding
      ? "checking"
      : requiredCount > 0
        ? "action_required"
        : attentionCount > 0 || pendingCount > 0
          ? "attention"
          : "clear";

  return {
    status,
    signals,
    requiredCount,
    attentionCount,
    pendingCount,
    generationAvailable: canGenerate,
    contextCurrent,
  };
}
