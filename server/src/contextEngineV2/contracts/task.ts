import type { SnapshotId } from "./ids.js";

export interface EngineTaskInput {
  taskText: string;
}

export interface EngineTaskUnderstanding {
  normalizedTask: string;
}

export type ExplicitTargetConstraint =
  | { kind: "path"; path: string }
  | { kind: "symbol"; symbol: string };

export type NegativeConstraint =
  | { kind: "path"; pattern: string }
  | { kind: "semantic"; description: string };

export interface PriorKnowledgeReference {
  referenceId: string;
  source: "repository_metadata" | "user_provided" | "previous_investigation";
  snapshotId?: SnapshotId;
}
