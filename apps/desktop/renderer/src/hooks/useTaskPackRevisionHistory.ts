import { useEffect, useMemo, useSyncExternalStore } from "react";
import { getTaskPackRevisionHistory, getTaskPackRevisionDetail } from "../api/client";
import { createTaskPackRevisionHistoryController } from "../utils/taskPackRevisionHistory";

const historyApi = { getTaskPackRevisionHistory, getTaskPackRevisionDetail };

export function useTaskPackRevisionHistory(taskPackId: number) {
  // New pack => new owner and empty state synchronously, before effects run.
  const controller = useMemo(() => createTaskPackRevisionHistoryController(taskPackId, historyApi), [taskPackId]);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => { void controller.activate(); return controller.dispose; }, [controller]);
  return { ...snapshot, refresh: controller.refresh, retryHistory: controller.retryHistory,
    selectRevision: controller.selectRevision, retryDetail: controller.retryDetail, clearSelection: controller.clearSelection };
}
