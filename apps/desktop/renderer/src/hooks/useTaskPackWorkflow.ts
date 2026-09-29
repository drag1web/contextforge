import { useEffect, useMemo, useSyncExternalStore } from "react";
import { getTaskPackWorkflow, transitionTaskPackLifecycle, transitionTaskPackRevisionReview } from "../api/client";
import { createTaskPackWorkflowController } from "../utils/taskPackWorkflow";

const workflowApi = { getTaskPackWorkflow, transitionTaskPackLifecycle, transitionTaskPackRevisionReview };

export function useTaskPackWorkflow(taskPackId: number, currentRevisionId: number | undefined) {
  // A new owner immediately exposes an empty/loading snapshot, never the previous revision badge.
  const controller = useMemo(() => createTaskPackWorkflowController(taskPackId, currentRevisionId, workflowApi),
    [taskPackId, currentRevisionId]);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => { void controller.activate(); return controller.dispose; }, [controller]);
  return { ...snapshot, refresh: controller.refresh, execute: controller.execute, clearIssue: controller.clearIssue };
}
