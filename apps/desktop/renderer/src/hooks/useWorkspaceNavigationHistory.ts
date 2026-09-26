import { useCallback, useState } from "react";

import type { AppPageId } from "../components/layout/Sidebar";
import type {
  ContextComposerPreview,
  TaskPack,
  TaskPackDraftSession,
  TaskPackPersistedDraftView,
} from "../types";
import type { ContextComposerNavigationState } from "../types/navigation";
import { taskContextDraftsMatch } from "../utils/contextComposerReviewedDraft";
import { applyTaskPackDraftOperationResult, type TaskPackDraftOperation } from "../utils/taskPackDraftSession";

export type WorkspaceNavigationLocation =
  | {
      page: AppPageId;
      surface: "page";
    }
  | {
      page: "projects";
      surface: "project-details";
      projectId: number;
    }
  | {
      page: AppPageId;
      surface: "task-pack-builder";
      session: TaskPackDraftSession;
    }
  | {
      page: AppPageId;
      surface: "context-composer";
      session: TaskPackDraftSession;
      preview: ContextComposerPreview;
      state?: ContextComposerNavigationState;
    }
  | {
      page: AppPageId;
      surface: "task-pack-result";
      taskPack: TaskPack;
    };

export interface WorkspaceNavigationHistoryState {
  entries: WorkspaceNavigationLocation[];
  index: number;
}

/** Keep every snapshot of a logical session on the same content/baseline/token. */
export function synchronizeDraftSessionHistory(
  history: WorkspaceNavigationHistoryState,
  session: TaskPackDraftSession,
): WorkspaceNavigationHistoryState {
  let changed = false;
  const entries = history.entries.map((entry): WorkspaceNavigationLocation => {
    if (!("session" in entry) || entry.session.sessionId !== session.sessionId || entry.session === session) return entry;
    changed = true;
    if (entry.surface === "context-composer" && !taskContextDraftsMatch(entry.session.draft, session.draft)) {
      return { page: entry.page, surface: "task-pack-builder", session };
    }
    return { ...entry, session };
  });
  return changed ? { ...history, entries } : history;
}

export function invalidateDraftSessionHistory(
  history: WorkspaceNavigationHistoryState,
  sessionId: string,
  projectId: number,
): WorkspaceNavigationHistoryState {
  const entries: WorkspaceNavigationLocation[] = [];
  let index = history.index;
  history.entries.forEach((entry, entryIndex) => {
    const matches = "session" in entry && entry.session.sessionId === sessionId;
    if (entryIndex === history.index) {
      index = entries.length;
      entries.push(matches ? { page: "projects", surface: "project-details", projectId } : entry);
    } else if (!matches) entries.push(entry);
  });
  return { entries, index };
}

export function applyDraftOperationToHistory(
  history: WorkspaceNavigationHistoryState,
  operation: TaskPackDraftOperation,
  view: TaskPackPersistedDraftView,
): WorkspaceNavigationHistoryState {
  if (operation.kind === "discarding") {
    return invalidateDraftSessionHistory(history, operation.sessionId, operation.projectId);
  }
  return { ...history, entries: history.entries.map((entry): WorkspaceNavigationLocation => {
    if (!("session" in entry) || entry.session.sessionId !== operation.sessionId) return entry;
    const session = applyTaskPackDraftOperationResult(entry.session, operation, view)!;
    // Explicit reload invalidates any old analysis/navigation preview, even for equal text.
    return operation.kind === "reloading"
      ? { page: entry.page, surface: "task-pack-builder", session }
      : { ...entry, session };
  }) };
}

const MAX_HISTORY_ENTRIES = 32;

function createPageLocation(page: AppPageId): WorkspaceNavigationLocation {
  return {
    page,
    surface: "page",
  };
}

function isSameLocation(
  left: WorkspaceNavigationLocation,
  right: WorkspaceNavigationLocation,
) {
  if (left.page !== right.page || left.surface !== right.surface) {
    return false;
  }

  if (
    left.surface === "project-details" &&
    right.surface === "project-details"
  ) {
    return left.projectId === right.projectId;
  }

  if (
    left.surface === "task-pack-result" &&
    right.surface === "task-pack-result"
  ) {
    return left.taskPack.id === right.taskPack.id;
  }

  if (
    left.surface === "task-pack-builder" &&
    right.surface === "task-pack-builder"
  ) {
    return left.session === right.session;
  }

  if (
    left.surface === "context-composer" &&
    right.surface === "context-composer"
  ) {
    return left.session.sessionId === right.session.sessionId && left.preview === right.preview;
  }

  return left.surface === "page" && right.surface === "page";
}

export function useWorkspaceNavigationHistory(initialPage: AppPageId) {
  const [history, setHistory] = useState<WorkspaceNavigationHistoryState>(() => ({
    entries: [createPageLocation(initialPage)],
    index: 0,
  }));

  const activeLocation =
    history.entries[history.index] ?? createPageLocation(initialPage);
  const activePage = activeLocation.page;
  const backLocation =
    history.index > 0 ? history.entries[history.index - 1] ?? null : null;
  const forwardLocation =
    history.index < history.entries.length - 1
      ? history.entries[history.index + 1] ?? null
      : null;

  const navigateToLocation = useCallback(
    (nextLocation: WorkspaceNavigationLocation) => {
      setHistory((current) => {
        const currentLocation =
          current.entries[current.index] ?? createPageLocation(initialPage);

        if (isSameLocation(currentLocation, nextLocation)) {
          return current;
        }

        const forwardTrimmed = [
          ...current.entries.slice(0, current.index + 1),
          nextLocation,
        ];
        const overflow = Math.max(
          0,
          forwardTrimmed.length - MAX_HISTORY_ENTRIES,
        );
        const entries =
          overflow > 0 ? forwardTrimmed.slice(overflow) : forwardTrimmed;

        return {
          entries,
          index: entries.length - 1,
        };
      });
    },
    [initialPage],
  );

  const replaceCurrentLocation = useCallback(
    (nextLocation: WorkspaceNavigationLocation) => {
      setHistory((current) => {
        const entries = [...current.entries];
        entries[current.index] = nextLocation;

        return {
          ...current,
          entries,
        };
      });
    },
    [],
  );

  const synchronizeTaskPackDraftSession = useCallback((session: TaskPackDraftSession) => {
    setHistory((current) => synchronizeDraftSessionHistory(current, session));
  }, []);

  const invalidateTaskPackDraftSession = useCallback((sessionId: string, projectId: number) => {
    setHistory(current => invalidateDraftSessionHistory(current, sessionId, projectId));
  }, []);

  const applyTaskPackDraftPersistenceResult = useCallback((operation: TaskPackDraftOperation, view: TaskPackPersistedDraftView) => {
    setHistory((current) => applyDraftOperationToHistory(current, operation, view));
  }, []);

  const updateCurrentContextComposerState = useCallback(
    (state: ContextComposerNavigationState) => {
      setHistory((current) => {
        const currentLocation = current.entries[current.index];

        if (!currentLocation || currentLocation.surface !== "context-composer") {
          return current;
        }

        const entries = [...current.entries];
        entries[current.index] = {
          ...currentLocation,
          state,
        };

        return {
          ...current,
          entries,
        };
      });
    },
    [],
  );

  const discardForwardHistory = useCallback(() => {
    setHistory((current) => {
      if (current.index >= current.entries.length - 1) {
        return current;
      }

      return {
        entries: current.entries.slice(0, current.index + 1),
        index: current.index,
      };
    });
  }, []);

  const navigate = useCallback(
    (nextPage: AppPageId) => {
      navigateToLocation(createPageLocation(nextPage));
    },
    [navigateToLocation],
  );

  const goBack = useCallback(() => {
    setHistory((current) => {
      if (current.index <= 0) {
        return current;
      }

      return {
        ...current,
        index: current.index - 1,
      };
    });
  }, []);

  const goForward = useCallback(() => {
    setHistory((current) => {
      if (current.index >= current.entries.length - 1) {
        return current;
      }

      return {
        ...current,
        index: current.index + 1,
      };
    });
  }, []);

  return {
    activeLocation,
    activePage,
    backLocation,
    forwardLocation,
    canGoBack: history.index > 0,
    canGoForward: history.index < history.entries.length - 1,
    navigate,
    navigateToLocation,
    replaceCurrentLocation,
    synchronizeTaskPackDraftSession,
    invalidateTaskPackDraftSession,
    applyTaskPackDraftPersistenceResult,
    updateCurrentContextComposerState,
    discardForwardHistory,
    goBack,
    goForward,
  };
}
