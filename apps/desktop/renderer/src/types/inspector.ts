import type {
  ContextComposerEngineFileView,
  ContextComposerEvidenceView,
  ContextComposerPreview,
  TaskPack,
} from "./index";
import type { QuickPeekTarget } from "./quickPeek";

export type InspectorFileTarget = Extract<QuickPeekTarget, { kind: "file" }>;

export type InspectorTarget =
  | {
      kind: "file";
      file: InspectorFileTarget;
      contextFile?: ContextComposerEngineFileView;
    }
  | {
      kind: "context";
      preview: ContextComposerPreview;
    }
  | {
      kind: "evidence";
      projectId: number;
      projectName: string;
      evidence: ContextComposerEvidenceView;
      contextFile?: ContextComposerEngineFileView;
    }
  | {
      kind: "task-pack";
      taskPack: TaskPack;
    };
