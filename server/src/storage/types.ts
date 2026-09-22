import type { ReadinessReport, ScannedProject } from "../scanner/projectScanner.js";
import type { RulesAndTemplatesStore } from "../rules/types.js";
import type {
  TaskPackAggregate,
  TaskPackAggregateLifecycleEvent,
  TaskPackJsonObject,
  TaskPackRevision,
  TaskPackRevisionContent,
  TaskPackRevisionReviewEvent,
} from "../taskPacks/taskPackLifecycle.js";

export type StorageDriver = "sqlite" | "postgres";

export interface ProjectRecord {
  id: number;
  name: string;
  localPath: string;
  packageManager: string | null;
  detectedStack: string[];
  scripts: Record<string, string>;
  readinessScore: number;
  readinessReport: ReadinessReport;
  createdAt: string;
  updatedAt: string;
  lastScanAt: string | null;
}


export type ProjectMemoryCategory =
  | "architecture"
  | "do_not_change"
  | "style"
  | "verification"
  | "workflow"
  | "custom";

export interface ProjectMemoryRecord {
  id: number;
  projectId: number;
  title: string;
  content: string;
  category: ProjectMemoryCategory;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectMemoryInput {
  projectId: number;
  title: string;
  content: string;
  category: ProjectMemoryCategory;
  isEnabled?: boolean;
}

export interface UpdateProjectMemoryInput {
  title?: string;
  content?: string;
  category?: ProjectMemoryCategory;
  isEnabled?: boolean;
}

export interface TaskPackRecord {
  id: number;
  projectId: number;
  projectName?: string;
  title: string;
  rawTask: string;
  taskType: string;
  targetTool: string;
  generatedPrompt: string;
  generationMode: "template" | "ollama";
  generationModel: string | null;
  generationMessage: string | null;
  generationUsedFallback: boolean;
  generationDurationMs: number | null;
  generationRecipe: unknown | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Transitional current-read projection. The legacy TaskPackRecord remains
 * unchanged for MCP, backup, and existing storage consumers.
 */
export interface TaskPackCurrentRecord extends TaskPackRecord {
  readonly currentRevisionId: number;
}

export class TaskPackCurrentStateStorageError extends Error {
  readonly code = "TASK_PACK_CURRENT_STATE_INVALID" as const;

  constructor() {
    super("Task Pack current state is invalid.");
    this.name = "TaskPackCurrentStateStorageError";
  }
}

export interface CreateTaskPackInput {
  projectId: number;
  title: string;
  rawTask: string;
  taskType: string;
  targetTool: string;
  generatedPrompt: string;
  generationMode: "template" | "ollama";
  generationModel: string | null;
  generationMessage: string | null;
  generationUsedFallback: boolean;
  generationDurationMs?: number | null;
  generationRecipe?: unknown | null;
}

export interface CreateTaskPackWithInitialRevisionInput {
  readonly projectId: number;
  readonly title: string;
  readonly revisionContent: TaskPackRevisionContent;
  readonly generatedAt: string;
  readonly compatibilityGenerationRecipe: TaskPackJsonObject;
}


export interface UpdateTaskPackContentInput {
  rawTask?: string;
  generatedPrompt?: string;
}

export type TaskPackAggregateRecord = TaskPackAggregate;
export type TaskPackRevisionRecord = TaskPackRevision;
export type TaskPackAggregateLifecycleEventRecord = TaskPackAggregateLifecycleEvent;
export type TaskPackRevisionReviewEventRecord = TaskPackRevisionReviewEvent;

/**
 * Storage assigns the immutable revision identity, monotonically increasing
 * revision number, and canonical content hash inside one transaction.
 */
export interface AppendTaskPackRevisionInput extends TaskPackRevisionContent {
  readonly taskPackId: number;
  readonly baseRevisionId: number;
  readonly createdAt: string;
  readonly generatedAt: string | null;
}

export interface StorageSchemaMigrationRecord {
  id: string;
  version: number;
  name: string;
  description: string | null;
  checksum: string;
  appliedAt: string;
}

export interface StorageSchemaInfo {
  currentVersion: number;
  latestVersion: number;
  status: "ready" | "needs_migration" | "unknown";
  pendingCount: number;
  appliedMigrations: StorageSchemaMigrationRecord[];
  pendingMigrations: Array<{
    id: string;
    version: number;
    name: string;
    description: string;
  }>;
}


export interface RulesAndTemplatesCatalogStats {
  source: "sqlite" | "json" | "unknown";
  importedFromJson: boolean;
  templates: number;
  ruleItems: number;
  ruleProfiles: number;
  acceptanceCriteriaPresets: number;
  total: number;
}

export interface StorageHealth {
  ok: boolean;
  driver: StorageDriver;
  database: Record<string, unknown>;
}

export interface StorageAdapter {
  readonly driver: StorageDriver;

  ensureSchema(): Promise<void>;
  health(): Promise<StorageHealth>;
  getSchemaInfo?(): Promise<StorageSchemaInfo>;
  readRulesAndTemplatesCatalog?(): Promise<RulesAndTemplatesStore>;
  writeRulesAndTemplatesCatalog?(store: RulesAndTemplatesStore): Promise<void>;
  importRulesAndTemplatesCatalog?(store: RulesAndTemplatesStore): Promise<{ imported: boolean; count: number }>;
  getRulesAndTemplatesCatalogStats?(): Promise<RulesAndTemplatesCatalogStats>;

  listProjects(): Promise<ProjectRecord[]>;
  getProjectById(projectId: number): Promise<ProjectRecord | null>;
  upsertScannedProject(project: ScannedProject): Promise<ProjectRecord>;

  listTaskPacks(): Promise<TaskPackRecord[]>;
  getTaskPackById(taskPackId: number): Promise<TaskPackRecord | null>;
  listTaskPackCurrentRecords(): Promise<TaskPackCurrentRecord[]>;
  getTaskPackCurrentRecordById(
    taskPackId: number
  ): Promise<TaskPackCurrentRecord | null>;
  createTaskPack(input: CreateTaskPackInput): Promise<TaskPackRecord>;
  createTaskPackWithInitialRevision(
    input: CreateTaskPackWithInitialRevisionInput
  ): Promise<TaskPackRecord>;
  updateTaskPackGenerationRecipe(
    taskPackId: number,
    generationRecipe: unknown | null
  ): Promise<TaskPackRecord | null>;
  updateTaskPackContent(
    taskPackId: number,
    input: UpdateTaskPackContentInput
  ): Promise<TaskPackRecord | null>;

  getTaskPackAggregate(taskPackId: number): Promise<TaskPackAggregateRecord | null>;
  getCurrentTaskPackRevision(taskPackId: number): Promise<TaskPackRevisionRecord | null>;
  getTaskPackRevisionById(
    taskPackId: number,
    revisionId: number
  ): Promise<TaskPackRevisionRecord | null>;
  listTaskPackRevisions(taskPackId: number): Promise<TaskPackRevisionRecord[]>;
  appendTaskPackRevision(input: AppendTaskPackRevisionInput): Promise<TaskPackRevisionRecord>;
  appendTaskPackAggregateLifecycleEvent(
    event: TaskPackAggregateLifecycleEventRecord
  ): Promise<void>;
  listTaskPackAggregateLifecycleEvents(
    taskPackId: number
  ): Promise<TaskPackAggregateLifecycleEventRecord[]>;
  appendTaskPackRevisionReviewEvent(event: TaskPackRevisionReviewEventRecord): Promise<void>;
  listTaskPackRevisionReviewEvents(
    taskPackId: number,
    revisionId?: number
  ): Promise<TaskPackRevisionReviewEventRecord[]>;

  listProjectMemories(projectId: number): Promise<ProjectMemoryRecord[]>;
  createProjectMemory(input: CreateProjectMemoryInput): Promise<ProjectMemoryRecord>;
  updateProjectMemory(
    projectId: number,
    memoryId: number,
    input: UpdateProjectMemoryInput
  ): Promise<ProjectMemoryRecord | null>;
  deleteProjectMemory(projectId: number, memoryId: number): Promise<boolean>;

  getSettingValue<T>(key: string, fallback: T): Promise<T>;
  setSettingValue(key: string, value: unknown): Promise<void>;
}
