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
  composerFileLimits: {
    default: number;
    ui: number;
    backend: number;
    fullstack: number;
    build: number;
    bugfix: number;
    refactor: number;
    docs: number;
    tests: number;
  };
  sidebarShowDescriptions: boolean;
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

export type WorkspaceSearchResultType = "project" | "taskPack" | "file";

export interface WorkspaceSearchResult {
  id: string;
  type: WorkspaceSearchResultType;
  title: string;
  subtitle: string;
  projectId?: number;
  projectName?: string;
  taskPackId?: number;
  absolutePath?: string;
  relativePath?: string;
  line?: number;
  snippet?: string;
  score: number;
}

export interface WorkspaceSearchResponse {
  query: string;
  results: WorkspaceSearchResult[];
}

export interface ContextComposerFileReference {
  path: string;
  kind: string;
  usage: string;
  reason: string;
  confidence: number;
  canReadText: boolean;
  sizeBytes: number;
}

export interface ContextComposerSnippet {
  relativePath: string;
  language: string;
  content: string;
  truncated: boolean;
}

export interface ContextComposerPreview {
  project: {
    id: number;
    name: string;
    localPath: string;
    packageManager: string | null;
    detectedStack: string[];
    readinessScore: number;
  };
  task: {
    rawTask: string;
    requestedTaskType: string;
    effectiveTaskArea: string;
    targetTool: string;
  };
  taskIntent: {
    source: string;
    taskArea: string;
    riskLevel: string;
    confidence: number;
    intentTags: string[];
    domainTerms: string[];
    fileRoleHints: string[];
  };
  fileSelection: {
    source: string;
    usedFallback: boolean;
    durationMs: number;
    rejectedModelPaths: string[];
    notes: string[];
  };
  selectedFiles: ContextComposerFileReference[];
  snippets: ContextComposerSnippet[];
  inventorySummary: {
    totalFiles: number;
    scannedFiles: number;
    truncated: boolean;
    notes: string[];
  };
  notes: string[];
}

export interface ContextComposerFileSearchResult
  extends ContextComposerFileReference {
  score: number;
  alreadySelected: boolean;
}

export interface ContextComposerFileSearchResponse {
  project: {
    id: number;
    name: string;
    localPath: string;
  };
  query: string;
  results: ContextComposerFileSearchResult[];
}

export interface ContextComposerFileSnippetResponse {
  file: ContextComposerFileReference;
  snippet: ContextComposerSnippet | null;
}