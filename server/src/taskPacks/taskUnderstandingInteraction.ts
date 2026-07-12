import type { TaskUnderstanding } from "../ollama/taskUnderstanding.js";
import type { TaskUnderstandingInteractionMode } from "../settings/settingsService.js";

export type TaskUnderstandingInteractionAction =
  | "continue"
  | "review"
  | "clarify";

export interface TaskUnderstandingInteractionDecision {
  mode: TaskUnderstandingInteractionMode;
  action: TaskUnderstandingInteractionAction;
  reason:
    | "required_information_missing"
    | "semantic_review_requested"
    | "automatic_review_bypass"
    | "confirm_all_tasks"
    | "task_ready";
}

export function resolveTaskUnderstandingInteraction(
  understanding: Pick<TaskUnderstanding, "readiness" | "canProceed">,
  mode: TaskUnderstandingInteractionMode,
): TaskUnderstandingInteractionDecision {
  if (
    understanding.readiness === "needs_clarification" ||
    !understanding.canProceed
  ) {
    return {
      mode,
      action: "clarify",
      reason: "required_information_missing",
    };
  }

  if (mode === "confirm_all") {
    return {
      mode,
      action: "review",
      reason: "confirm_all_tasks",
    };
  }

  if (understanding.readiness === "review") {
    return mode === "automatic"
      ? {
          mode,
          action: "continue",
          reason: "automatic_review_bypass",
        }
      : {
          mode,
          action: "review",
          reason: "semantic_review_requested",
        };
  }

  return {
    mode,
    action: "continue",
    reason: "task_ready",
  };
}
