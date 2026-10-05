import type { RulesAndTemplatesStore } from "../rules/types.js";
import type {
  TaskPackAggregate, TaskPackAggregateLifecycleEvent, TaskPackJsonObject, TaskPackJsonValue,
  TaskPackRevision, TaskPackRevisionContent, TaskPackRevisionReviewEvent,
} from "../taskPacks/taskPackLifecycle.js";
import type { ProjectMemoryRecord, ProjectRecord } from "./types.js";

export const WORKSPACE_BACKUP_FORMAT = "contextforge.workspace.backup" as const;
export const WORKSPACE_BACKUP_SAFE_SETTING_KEYS = [
  "generation_mode", "ai_provider", "default_target_tool", "default_task_type",
  "default_ollama_model", "language", "theme", "composer_file_limits", "sidebar_show_descriptions",
] as const;

export interface WorkspaceBackupCounts {
  readonly projects: number;
  readonly taskPacks: number;
  readonly projectMemories: number;
  readonly ruleTemplates: number;
  readonly settings: number;
}
export interface WorkspaceBackupEnvelope {
  readonly format: typeof WORKSPACE_BACKUP_FORMAT;
  readonly appVersion: string;
  readonly exportedAt: string;
  readonly storage: {
    readonly driver: "sqlite" | "postgres";
    readonly sqliteFirst: boolean;
    readonly schema: null | {
      readonly currentVersion: number;
      readonly latestVersion: number;
      readonly status: "ready" | "needs_migration" | "unknown";
      readonly appliedMigrations: readonly {
        readonly id: string; readonly version: number; readonly name: string; readonly appliedAt: string;
      }[];
    };
  };
  /** Informational copy, never proof of integrity or absence of private content. */
  readonly included: readonly string[];
  readonly excluded: readonly string[];
  readonly warnings: readonly string[];
}
export interface WorkspaceBackupCommonData {
  readonly projects: readonly ProjectRecord[];
  readonly projectMemory: readonly {
    readonly projectId: number; readonly memories: readonly ProjectMemoryRecord[];
  }[];
  readonly rulesAndTemplates: RulesAndTemplatesStore | null;
  /** Structural key allowlist only. Applying these values is a future restore decision. */
  readonly safeSettings: Readonly<Record<typeof WORKSPACE_BACKUP_SAFE_SETTING_KEYS[number], TaskPackJsonValue>>;
}
export interface WorkspaceBackupV1TaskPack {
  readonly id: number; readonly projectId: number; readonly projectName?: string;
  readonly title: string; readonly rawTask: string; readonly taskType: string; readonly targetTool: string;
  readonly generatedPrompt: string; readonly generationMode: "template" | "ollama";
  readonly generationModel: string | null; readonly generationMessage: string | null;
  readonly generationUsedFallback: boolean; readonly generationDurationMs: number | null;
  readonly generationRecipe: TaskPackJsonObject | null;
  readonly createdAt: string; readonly updatedAt: string;
}
export interface WorkspaceBackupV1 extends WorkspaceBackupEnvelope {
  readonly formatVersion: 1;
  readonly counts: WorkspaceBackupCounts;
  readonly data: WorkspaceBackupCommonData & { readonly taskPacks: readonly WorkspaceBackupV1TaskPack[] };
}
/** Private, lossless content: IDs are source-backup references, NOT destination insert authority.
 * No flat projection, derived reviewState, integration stores or persisted drafts here. */
export interface WorkspaceBackupV2 extends WorkspaceBackupEnvelope {
  readonly formatVersion: 2;
  readonly counts: WorkspaceBackupCounts & {
    readonly revisions: number; readonly lifecycleEvents: number; readonly reviewEvents: number;
  };
  readonly data: WorkspaceBackupCommonData & {
    readonly taskPackAggregates: readonly TaskPackAggregate[];
    readonly taskPackRevisions: readonly TaskPackRevision[];
    readonly taskPackLifecycleEvents: readonly TaskPackAggregateLifecycleEvent[];
    readonly taskPackReviewEvents: readonly TaskPackRevisionReviewEvent[];
  };
}
export interface WorkspaceBackupLegacyBundle {
  readonly sourceAggregateId: number;
  readonly sourceProjectId: number;
  readonly title: string;
  readonly lifecycle: { readonly state: "active"; readonly archivedFromState: null };
  readonly lifecycleVersion: 1;
  readonly currentRevisionIndex: 0;
  readonly acceptedRevisionIndex: null;
  readonly createdAt: string; readonly updatedAt: string;
  readonly completedAt: null; readonly archivedAt: null;
  readonly revisions: readonly [{
    readonly sourceRevisionId: null;
    readonly revisionIndex: 0;
    readonly revisionNumber: 1;
    readonly baseRevisionIndex: null;
    readonly content: TaskPackRevisionContent;
    readonly contentHash: string;
    readonly createdAt: string;
    readonly generatedAt: null;
  }];
  readonly lifecycleEvents: readonly [];
  readonly reviewEvents: readonly [];
}
/** A read result is not an import command. V1 normalization has no historical revision ID.
 * V2 needs no second representation: its document already is authoritative. */
export type WorkspaceBackupReadResult =
  | { readonly formatVersion: 1; readonly backup: WorkspaceBackupV1;
      readonly compatibilityTaskPacks: readonly WorkspaceBackupLegacyBundle[] }
  | { readonly formatVersion: 2; readonly backup: WorkspaceBackupV2 };

export type WorkspaceBackupReadErrorCode =
  | "WORKSPACE_BACKUP_JSON_INVALID" | "WORKSPACE_BACKUP_FORMAT_UNSUPPORTED"
  | "WORKSPACE_BACKUP_INVALID" | "WORKSPACE_BACKUP_SAFETY_LIMIT";
export class WorkspaceBackupReadError extends Error {
  constructor(readonly code: WorkspaceBackupReadErrorCode) {
    super({
      WORKSPACE_BACKUP_JSON_INVALID: "Workspace backup JSON is invalid.",
      WORKSPACE_BACKUP_FORMAT_UNSUPPORTED: "Workspace backup format or version is unsupported.",
      WORKSPACE_BACKUP_INVALID: "Workspace backup content is invalid.",
      WORKSPACE_BACKUP_SAFETY_LIMIT: "Workspace backup exceeds implementation safety limits.",
    }[code]);
    this.name = "WorkspaceBackupReadError";
  }
}
