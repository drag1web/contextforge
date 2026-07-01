import type { ReadinessReport, ScannedProject } from "../scanner/projectScanner.js";

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

export interface StorageHealth {
  ok: boolean;
  driver: StorageDriver;
  database: Record<string, unknown>;
}

export interface StorageAdapter {
  readonly driver: StorageDriver;

  ensureSchema(): Promise<void>;
  health(): Promise<StorageHealth>;

  listProjects(): Promise<ProjectRecord[]>;
  getProjectById(projectId: number): Promise<ProjectRecord | null>;
  upsertScannedProject(project: ScannedProject): Promise<ProjectRecord>;

  listTaskPacks(): Promise<TaskPackRecord[]>;
  createTaskPack(input: CreateTaskPackInput): Promise<TaskPackRecord>;

  getSettingValue<T>(key: string, fallback: T): Promise<T>;
  setSettingValue(key: string, value: unknown): Promise<void>;
}
