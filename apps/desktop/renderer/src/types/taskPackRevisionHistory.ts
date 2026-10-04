import type { TaskPackReviewState } from "./index";

/** Closed public read DTOs, deliberately separate from the editable TaskPack. */
export interface TaskPackRevisionHistoryItem {
  readonly id: number;
  readonly revisionNumber: number;
  readonly baseRevisionId: number | null;
  readonly sourceKind: "generated" | "manual_edit" | "regenerated" | "imported" | "split" | "legacy_snapshot";
  readonly createdAt: string;
  readonly generatedAt: string | null;
  readonly contentHash: string;
  readonly generationMode: "template" | "ollama";
  readonly generationModel: string | null;
  readonly generationUsedFallback: boolean;
  readonly reviewState: TaskPackReviewState;
}

export interface TaskPackRevisionHistory {
  readonly taskPackId: number;
  readonly currentRevisionId: number;
  readonly revisions: readonly TaskPackRevisionHistoryItem[];
}

export interface TaskPackRevisionDetailItem extends TaskPackRevisionHistoryItem {
  readonly rawTask: string;
  readonly taskType: string;
  readonly targetTool: string;
  readonly generatedPrompt: string;
}

export interface TaskPackRevisionDetail {
  readonly taskPackId: number;
  readonly currentRevisionId: number;
  readonly revision: TaskPackRevisionDetailItem;
}
