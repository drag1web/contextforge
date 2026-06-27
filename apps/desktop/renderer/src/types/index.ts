export interface ReadinessCheck {
  key: string;
  label: string;
  passed: boolean;
  points: number;
  message: string;
}

export interface ReadinessReport {
  score: number;
  checks: ReadinessCheck[];
  issues: string[];
}

export interface Project {
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

export interface TaskPack {
  id: number;
  projectId: number;
  projectName?: string;
  title: string;
  rawTask: string;
  taskType: string;
  targetTool: string;
  generatedPrompt: string;
  generationMode?: "template" | "ollama";
  generationModel?: string | null;
  generationMessage?: string | null;
  generationUsedFallback?: boolean;
  generationDurationMs?: number | null;
  generationCached?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentsPreview {
  projectId: number;
  projectName: string;
  markdown: string;
  generation?: GenerationMetadata;
}

export interface TaskPackDraft {
  projectId: number;
  projectName: string;
  rawTask: string;
  taskType: string;
  targetTool: string;
}

export interface OllamaStatus {
  online: boolean;
  url: string;
  message: string;
}

export interface OllamaModel {
  name: string;
  model?: string;
  modified_at?: string;
  size?: number;
  digest?: string;
}

export interface AppSettings {
  ollamaUrl: string;
  generationMode: "template" | "ollama";
  defaultTargetTool: "codex" | "cursor" | "claude" | "generic";
  defaultTaskType: "general" | "ui" | "backend" | "bugfix" | "refactor" | "docs" | "tests";
  defaultOllamaModel: string | null;
}

export interface GenerationMetadata {
  content: string;
  mode: "template" | "ollama";
  model: string | null;
  usedFallback: boolean;
  message: string;
  durationMs?: number;
  cached?: boolean;
}