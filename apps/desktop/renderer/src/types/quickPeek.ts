import type { Project, TaskPack } from "./index";

export type QuickPeekTarget =
  | {
      kind: "file";
      title: string;
      displayPath: string;
      filePath?: string;
      absolutePath?: string;
      projectId?: number;
      projectName?: string;
      line?: number;
      snippet?: string;
    }
  | {
      kind: "project";
      project: Project;
    }
  | {
      kind: "task-pack";
      taskPack: TaskPack;
    };
