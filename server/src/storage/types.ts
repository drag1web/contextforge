import type { ReadinessReport, ScannedProject } from "../scanner/projectScanner.js";
import type { RulesAndTemplatesStore } from "../rules/types.js";
import type {
  PersistedTaskPackDraft,
  TaskPackAggregate,
  TaskPackAggregateLifecycleEvent,
  TaskPackDraftContent,
  TaskPackDraftState,
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

export type TaskPackRevisionAppendStorageErrorCode =
  | "TASK_PACK_NOT_FOUND"
  | "TASK_PACK_NOT_ACTIVE"
  | "TASK_PACK_REVISION_CONFLICT"
  | "TASK_PACK_BASE_REVISION_INVALID";

export class TaskPackRevisionAppendStorageError extends Error {
  constructor(
    readonly code: TaskPackRevisionAppendStorageErrorCode,
    readonly taskPackId: number,
    readonly expectedCurrentRevisionId?: number,
    readonly actualCurrentRevisionId?: number,
  ) {
    super(code);
    this.name = "TaskPackRevisionAppendStorageError";
  }
}

export type TaskPackDraftRecord = PersistedTaskPackDraft;

export interface CreateTaskPackDraftInput {
  readonly id: string;
  readonly projectId: number;
  readonly taskPackId: number | null;
  readonly baseRevisionId: number | null;
  readonly content: TaskPackDraftContent;
  readonly expiresAt: string | null;
}

export interface UpdateTaskPackDraftInput {
  readonly draftId: string;
  readonly expectedDraftVersion: number;
  readonly content: TaskPackDraftContent;
}

export interface DiscardTaskPackDraftInput {
  readonly draftId: string;
  readonly expectedDraftVersion: number;
}

export type TaskPackDraftStorageErrorCode =
  | "TASK_PACK_DRAFT_NOT_FOUND"
  | "TASK_PACK_DRAFT_ALREADY_EXISTS"
  | "TASK_PACK_DRAFT_CONFLICT"
  | "TASK_PACK_DRAFT_NOT_EDITABLE"
  | "TASK_PACK_DRAFT_VERSION_EXHAUSTED"
  | "TASK_PACK_DRAFT_PROJECT_NOT_FOUND"
  | "TASK_PACK_DRAFT_TASK_PACK_NOT_FOUND"
  | "TASK_PACK_DRAFT_OWNERSHIP_INVALID"
  | "TASK_PACK_DRAFT_BASE_REVISION_INVALID"
  | "TASK_PACK_DRAFT_STATE_INVALID";

export class TaskPackDraftStorageError extends Error {
  constructor(
    readonly code: TaskPackDraftStorageErrorCode,
    readonly draftId?: string,
    readonly expectedDraftVersion?: number,
    readonly actualDraftVersion?: number,
    readonly lifecycleState?: TaskPackDraftState,
  ) {
    super(code);
    this.name = "TaskPackDraftStorageError";
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

export type TaskPackGitHubIssueState = "open" | "closed";

export interface TaskPackGitHubCreatedIssueLinkRecord {
  readonly taskPackId: number;
  readonly owner: string;
  readonly repo: string;
  readonly fullName: string;
  readonly issueNumber: number;
  readonly issueTitle: string;
  readonly issueUrl: string;
  readonly issueState: TaskPackGitHubIssueState;
  readonly labels: string[];
  readonly repositoryUrl: string;
  readonly createdAt: string;
}

export type CreateTaskPackGitHubCreatedIssueLinkInput =
  TaskPackGitHubCreatedIssueLinkRecord;

export type TaskPackGitHubCreatedIssueLinkStorageErrorCode =
  | "TASK_PACK_NOT_FOUND"
  | "TASK_PACK_GITHUB_CREATED_ISSUE_LINK_EXISTS"
  | "TASK_PACK_GITHUB_CREATED_ISSUE_LINK_INVALID";

export class TaskPackGitHubCreatedIssueLinkStorageError extends Error {
  constructor(readonly code: TaskPackGitHubCreatedIssueLinkStorageErrorCode) {
    super(code);
    this.name = "TaskPackGitHubCreatedIssueLinkStorageError";
  }
}

export interface TaskPackGitHubCreatedIssueCompatibilityLink {
  readonly type: "github-created-issue";
  readonly owner: string;
  readonly repo: string;
  readonly fullName: string;
  readonly issueNumber: number;
  readonly issueTitle: string;
  readonly issueUrl: string;
  readonly issueState: TaskPackGitHubIssueState;
  readonly labels: string[];
  readonly repositoryUrl: string;
  readonly createdAt: string;
  readonly createdFromTaskPackId: number;
}

const GITHUB_CREATED_ISSUE_COMPATIBILITY_FIELDS = new Set([
  "type",
  "owner",
  "repo",
  "fullName",
  "issueNumber",
  "issueTitle",
  "issueUrl",
  "issueState",
  "labels",
  "repositoryUrl",
  "createdAt",
  "createdFromTaskPackId",
]);

export function assertTaskPackGitHubCreatedIssueLinkInput(
  input: CreateTaskPackGitHubCreatedIssueLinkInput,
): void {
  if (!Number.isSafeInteger(input.taskPackId) || input.taskPackId <= 0) {
    throw new TaskPackGitHubCreatedIssueLinkStorageError(
      "TASK_PACK_GITHUB_CREATED_ISSUE_LINK_INVALID",
    );
  }
  if (!Number.isSafeInteger(input.issueNumber) || input.issueNumber <= 0) {
    throw new TaskPackGitHubCreatedIssueLinkStorageError(
      "TASK_PACK_GITHUB_CREATED_ISSUE_LINK_INVALID",
    );
  }
  for (const value of [
    input.owner,
    input.repo,
    input.fullName,
    input.issueTitle,
  ]) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new TaskPackGitHubCreatedIssueLinkStorageError(
        "TASK_PACK_GITHUB_CREATED_ISSUE_LINK_INVALID",
      );
    }
  }
  if (
    input.issueState !== "open" &&
    input.issueState !== "closed"
  ) {
    throw new TaskPackGitHubCreatedIssueLinkStorageError(
      "TASK_PACK_GITHUB_CREATED_ISSUE_LINK_INVALID",
    );
  }
  if (
    !Array.isArray(input.labels) ||
    input.labels.some(
      (label) => typeof label !== "string" || label.trim().length === 0,
    )
  ) {
    throw new TaskPackGitHubCreatedIssueLinkStorageError(
      "TASK_PACK_GITHUB_CREATED_ISSUE_LINK_INVALID",
    );
  }
  for (const url of [input.issueUrl, input.repositoryUrl]) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        throw new Error("unsupported protocol");
      }
    } catch {
      throw new TaskPackGitHubCreatedIssueLinkStorageError(
        "TASK_PACK_GITHUB_CREATED_ISSUE_LINK_INVALID",
      );
    }
  }
  if (
    typeof input.createdAt !== "string" ||
    input.createdAt.length === 0 ||
    !Number.isFinite(Date.parse(input.createdAt))
  ) {
    throw new TaskPackGitHubCreatedIssueLinkStorageError(
      "TASK_PACK_GITHUB_CREATED_ISSUE_LINK_INVALID",
    );
  }
}

export function parseTaskPackGitHubCreatedIssueCompatibilityLink(
  value: unknown,
  taskPackId: number,
): TaskPackGitHubCreatedIssueLinkRecord | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    Reflect.ownKeys(record).some(
      (key) =>
        typeof key !== "string" ||
        !GITHUB_CREATED_ISSUE_COMPATIBILITY_FIELDS.has(key),
    ) ||
    record.type !== "github-created-issue" ||
    record.createdFromTaskPackId !== taskPackId
  ) {
    return null;
  }
  const parsed: TaskPackGitHubCreatedIssueLinkRecord = {
    taskPackId,
    owner: record.owner as string,
    repo: record.repo as string,
    fullName: record.fullName as string,
    issueNumber: record.issueNumber as number,
    issueTitle: record.issueTitle as string,
    issueUrl: record.issueUrl as string,
    issueState: record.issueState as TaskPackGitHubIssueState,
    labels: record.labels as string[],
    repositoryUrl: record.repositoryUrl as string,
    createdAt: record.createdAt as string,
  };
  try {
    assertTaskPackGitHubCreatedIssueLinkInput(parsed);
    return parsed;
  } catch {
    return null;
  }
}

export function buildTaskPackGitHubCreatedIssueCompatibilityLink(
  link: TaskPackGitHubCreatedIssueLinkRecord,
): TaskPackGitHubCreatedIssueCompatibilityLink {
  return {
    type: "github-created-issue",
    owner: link.owner,
    repo: link.repo,
    fullName: link.fullName,
    issueNumber: link.issueNumber,
    issueTitle: link.issueTitle,
    issueUrl: link.issueUrl,
    issueState: link.issueState,
    labels: [...link.labels],
    repositoryUrl: link.repositoryUrl,
    createdAt: link.createdAt,
    createdFromTaskPackId: link.taskPackId,
  };
}

export function projectTaskPackGenerationRecipeWithGitHubCreatedIssue(
  generationRecipe: unknown | null,
  link: TaskPackGitHubCreatedIssueLinkRecord | null,
): unknown | null {
  if (!link) return generationRecipe;
  const recipe =
    generationRecipe !== null &&
    typeof generationRecipe === "object" &&
    !Array.isArray(generationRecipe)
      ? { ...(generationRecipe as Record<string, unknown>) }
      : {};
  return {
    ...recipe,
    githubCreatedIssue:
      buildTaskPackGitHubCreatedIssueCompatibilityLink(link),
  };
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

  listActiveTaskPackDrafts(projectId?: number): Promise<TaskPackDraftRecord[]>;
  getTaskPackDraftById(draftId: string): Promise<TaskPackDraftRecord | null>;
  createTaskPackDraft(input: CreateTaskPackDraftInput): Promise<TaskPackDraftRecord>;
  updateTaskPackDraft(input: UpdateTaskPackDraftInput): Promise<TaskPackDraftRecord>;
  discardTaskPackDraft(input: DiscardTaskPackDraftInput): Promise<TaskPackDraftRecord>;

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
  getTaskPackGitHubCreatedIssueLink(
    taskPackId: number
  ): Promise<TaskPackGitHubCreatedIssueLinkRecord | null>;
  createTaskPackGitHubCreatedIssueLink(
    input: CreateTaskPackGitHubCreatedIssueLinkInput
  ): Promise<TaskPackGitHubCreatedIssueLinkRecord>;
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
