import type { TaskPack } from "../types";

export type TaskPackEditorKind = "task" | "prompt";

export interface TaskPackEditorSession {
  readonly kind: TaskPackEditorKind;
  readonly taskPack: TaskPack;
  readonly taskPackId: number;
  readonly expectedCurrentRevisionId: number;
  readonly sourceValue: string;
}

export function createTaskPackEditorSession(
  taskPack: TaskPack,
  kind: TaskPackEditorKind,
): TaskPackEditorSession {
  const expectedCurrentRevisionId = taskPack.currentRevisionId;
  if (
    !Number.isSafeInteger(expectedCurrentRevisionId) ||
    expectedCurrentRevisionId === undefined ||
    expectedCurrentRevisionId <= 0
  ) {
    throw new Error("Task Pack current revision is unavailable.");
  }

  return Object.freeze({
    kind,
    taskPack: { ...taskPack },
    taskPackId: taskPack.id,
    expectedCurrentRevisionId,
    sourceValue: kind === "task" ? taskPack.rawTask : taskPack.generatedPrompt,
  });
}

export function buildTaskPackEditorUpdate(
  session: TaskPackEditorSession,
  value: string,
): {
  readonly expectedCurrentRevisionId: number;
  readonly rawTask?: string;
  readonly generatedPrompt?: string;
} {
  return session.kind === "task"
    ? { expectedCurrentRevisionId: session.expectedCurrentRevisionId, rawTask: value }
    : {
        expectedCurrentRevisionId: session.expectedCurrentRevisionId,
        generatedPrompt: value,
      };
}
