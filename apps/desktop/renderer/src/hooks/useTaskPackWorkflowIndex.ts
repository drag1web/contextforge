import { useEffect, useMemo, useSyncExternalStore } from "react";
import { getCurrentTaskPackWorkflowSummaries } from "../api/client";
import type { TaskPack } from "../types";
import { createTaskPackWorkflowIndexController, taskPackWorkflowCollectionSignature } from "../utils/taskPackWorkflowIndex";

const api = { getCurrentTaskPackWorkflowSummaries };
export function useTaskPackWorkflowIndex(taskPacks: readonly TaskPack[]) {
  const signature = taskPackWorkflowCollectionSignature(taskPacks);
  const controller = useMemo(() => createTaskPackWorkflowIndexController(api), []);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => { void controller.activate(signature); return controller.dispose; }, [controller, signature]);
  // The render preceding effect cleanup must not reuse a previous collection's statuses.
  const current = snapshot.signature === signature;
  return { status: current ? snapshot.status : "loading" as const,
    byTaskPackId: useMemo(() => current ? snapshot.byTaskPackId : new Map(), [current, snapshot.byTaskPackId]),
    retry: controller.retry };
}
