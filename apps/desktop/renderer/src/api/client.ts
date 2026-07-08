import type {
  AcceptanceCriteriaPreset,
  AppSettings,
  GenerationMetadata,
  GitDiffSummaryResult,
  GitStatusResult,
  AiProviderModel,
  AiProviderStatus,
  OllamaModel,
  OllamaStatus,
  Project,
  ProjectContextFile,
  ProjectMemory,
  ProjectMemoryInput,
  PromptTemplate,
  RuleItem,
  RuleProfile,
  RuleProfilesCatalog,
  StorageAuditResult,
  WorkspaceBackupExportResult,
  TaskPack,
  WorkspaceSearchResponse,
  ContextComposerPreview,
  ContextComposerFileSearchResponse,
  ContextComposerFileSnippetResponse,
  UpdateAppSettingsInput,
} from "../types";

const API_URL = "http://localhost:4000/api";

export class ApiRequestError extends Error {
  status: number;
  code?: string;
  data: unknown;

  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.data = data;
    this.code =
      data && typeof data === "object" && "code" in data
        ? String((data as { code?: unknown }).code ?? "")
        : undefined;
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${url}`, {
    headers: {
      "Content-Type": "application/json",
      ...options?.headers
    },
    ...options
  });

  const data = await response.json();

  if (!data.ok) {
    throw new ApiRequestError(data.message ?? "Request failed", response.status, data);
  }

  return data;
}

export async function getProjects(): Promise<Project[]> {
  const data = await request<{ ok: true; projects: Project[] }>("/projects");
  return data.projects;
}

export async function addProject(localPath: string): Promise<Project> {
  const data = await request<{ ok: true; project: Project }>("/projects", {
    method: "POST",
    body: JSON.stringify({ localPath })
  });

  return data.project;
}

export async function rescanProject(projectId: number): Promise<Project> {
  const data = await request<{ ok: true; project: Project }>(
    `/projects/${projectId}/rescan`,
    {
      method: "POST"
    }
  );

  return data.project;
}


export async function getProjectGitStatus(projectId: number): Promise<GitStatusResult> {
  const data = await request<{ ok: true; status: GitStatusResult }>(
    `/projects/${projectId}/git/status`
  );

  return data.status;
}

export async function getProjectGitDiffSummary(projectId: number): Promise<GitDiffSummaryResult> {
  const data = await request<{ ok: true; diffSummary: GitDiffSummaryResult }>(
    `/projects/${projectId}/git/diff-summary`
  );

  return data.diffSummary;
}

export async function getProjectContextFiles(
  projectId: number
): Promise<ProjectContextFile[]> {
  const data = await request<{
    ok: true;
    files: ProjectContextFile[];
  }>(`/projects/${projectId}/context-files`);

  return data.files;
}

export async function getProjectContextFile(
  projectId: number,
  fileName: ProjectContextFile["fileName"]
): Promise<{ markdown: string; contextFile: ProjectContextFile }> {
  const data = await request<{
    ok: true;
    markdown: string;
    contextFile: ProjectContextFile;
  }>(`/projects/${projectId}/context-files/${encodeURIComponent(fileName)}`);

  return {
    markdown: data.markdown,
    contextFile: data.contextFile
  };
}

export async function getProjectMemories(projectId: number): Promise<ProjectMemory[]> {
  const data = await request<{ ok: true; memories: ProjectMemory[] }>(
    `/projects/${projectId}/memories`
  );

  return data.memories;
}

export async function createProjectMemory(
  projectId: number,
  input: ProjectMemoryInput
): Promise<ProjectMemory> {
  const data = await request<{ ok: true; memory: ProjectMemory }>(
    `/projects/${projectId}/memories`,
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );

  return data.memory;
}

export async function updateProjectMemory(
  projectId: number,
  memoryId: number,
  input: Partial<ProjectMemoryInput>
): Promise<ProjectMemory> {
  const data = await request<{ ok: true; memory: ProjectMemory }>(
    `/projects/${projectId}/memories/${memoryId}`,
    {
      method: "PATCH",
      body: JSON.stringify(input)
    }
  );

  return data.memory;
}

export async function deleteProjectMemory(
  projectId: number,
  memoryId: number
): Promise<void> {
  await request<{ ok: true }>(`/projects/${projectId}/memories/${memoryId}`, {
    method: "DELETE"
  });
}

export async function getAgentsPreview(
  projectId: number,
  options: { bypassCache?: boolean } = {}
): Promise<{
  markdown: string;
  generation?: GenerationMetadata;
  projectMemories?: ProjectMemory[];
  agentsFile?: { path: string; exists: boolean };
}> {
  const searchParams = new URLSearchParams();

  if (options.bypassCache) {
    searchParams.set("bypassCache", "true");
  }

  const query = searchParams.toString();
  const url = `/projects/${projectId}/agents-preview${query ? `?${query}` : ""}`;

  const data = await request<{
    ok: true;
    markdown: string;
    generation?: GenerationMetadata;
    projectMemories?: ProjectMemory[];
    agentsFile?: { path: string; exists: boolean };
  }>(url);

  return {
    markdown: data.markdown,
    generation: data.generation,
    projectMemories: data.projectMemories ?? [],
    agentsFile: data.agentsFile
  };
}

export async function saveAgentsFile(
  projectId: number,
  markdown?: string,
  options: { fileName?: "AGENTS.md" | "AGENTS.generated.md" } = {}
) {
  const data = await request<{
    ok: true;
    message: string;
    path: string;
  }>(`/projects/${projectId}/agents-save`, {
    method: "POST",
    body: JSON.stringify({
      markdown,
      fileName: options.fileName
    })
  });

  return data;
}


export async function getStorageAudit(): Promise<StorageAuditResult> {
  const data = await request<{ ok: true; audit: StorageAuditResult }>(
    "/storage/audit"
  );

  return data.audit;
}

export async function exportWorkspaceBackup(): Promise<WorkspaceBackupExportResult> {
  const data = await request<{ ok: true; backup: WorkspaceBackupExportResult }>(
    "/storage/backups/export",
    { method: "POST" }
  );

  return data.backup;
}

export async function getTaskPacks(): Promise<TaskPack[]> {
  const data = await request<{ ok: true; taskPacks: TaskPack[] }>("/task-packs");
  return data.taskPacks;
}

export async function createTaskPack(input: {
  projectId: number;
  rawTask: string;
  taskType: string;
  targetTool: string;
  selectedFilePaths?: string[];

  templateId?: string;
  ruleProfileId?: string;
  enabledRuleIds?: string[];
  customRules?: string[];
  acceptanceCriteriaPresetId?: string;
  acceptanceCriteria?: string[];
}): Promise<TaskPack> {
  const data = await request<{ ok: true; taskPack: TaskPack }>("/task-packs", {
    method: "POST",
    body: JSON.stringify(input)
  });

  return data.taskPack;
}

export async function getOllamaStatus(): Promise<OllamaStatus> {
  const data = await request<{ ok: true; ollama: OllamaStatus }>("/ollama/health");
  return data.ollama;
}

export async function getOllamaModels(): Promise<OllamaModel[]> {
  const data = await request<{ ok: true; models: OllamaModel[] }>("/ollama/models");
  return data.models;
}

export async function getAppSettings(): Promise<AppSettings> {
  const data = await request<{ ok: true; settings: AppSettings }>("/settings");
  return data.settings;
}

export async function updateAppSettings(
  input: UpdateAppSettingsInput
): Promise<AppSettings> {
  const data = await request<{ ok: true; settings: AppSettings }>("/settings", {
    method: "PATCH",
    body: JSON.stringify(input)
  });

  return data.settings;
}

export async function getAiIntegrationStatus(): Promise<AiProviderStatus> {
  const data = await request<{ ok: true; status: AiProviderStatus }>(
    "/integrations/ai/status"
  );
  return data.status;
}

export async function getAiIntegrationModels(): Promise<AiProviderModel[]> {
  const data = await request<{ ok: true; models: AiProviderModel[] }>(
    "/integrations/ai/models"
  );
  return data.models;
}

export async function searchWorkspace(query: string): Promise<WorkspaceSearchResponse> {
  const searchParams = new URLSearchParams();

  searchParams.set("q", query);

  const data = await request<{
    ok: true;
    query: string;
    results: WorkspaceSearchResponse["results"];
  }>(`/search?${searchParams.toString()}`);

  return {
    query: data.query,
    results: data.results
  };
}

export async function createContextComposerPreview(input: {
  projectId: number;
  rawTask: string;
  taskType: string;
  targetTool: string;
}): Promise<ContextComposerPreview> {
  const data = await request<{
    ok: true;
    preview: ContextComposerPreview;
  }>("/context-composer/preview", {
    method: "POST",
    body: JSON.stringify(input)
  });

  return data.preview;
}

export async function searchContextComposerFiles(input: {
  projectId: number;
  query: string;
  limit?: number;
  excludePaths?: string[];
}): Promise<ContextComposerFileSearchResponse> {
  const data = await request<
    {
      ok: true;
    } & ContextComposerFileSearchResponse
  >("/context-composer/files", {
    method: "POST",
    body: JSON.stringify(input)
  });

  return {
    project: data.project,
    query: data.query,
    results: data.results
  };
}

export async function readContextComposerFileSnippet(input: {
  projectId: number;
  filePath: string;
}): Promise<ContextComposerFileSnippetResponse> {
  const data = await request<
    {
      ok: true;
    } & ContextComposerFileSnippetResponse
  >("/context-composer/snippet", {
    method: "POST",
    body: JSON.stringify(input)
  });

  return {
    file: data.file,
    snippet: data.snippet
  };
}

export async function getTemplates(): Promise<PromptTemplate[]> {
  const data = await request<{ ok: true; templates: PromptTemplate[] }>("/templates");
  return data.templates;
}

export async function createTemplate(input: {
  name: string;
  description?: string;
  targetTool: string;
  taskType: string;
  content: string;
}): Promise<PromptTemplate> {
  const data = await request<{ ok: true; template: PromptTemplate }>("/templates", {
    method: "POST",
    body: JSON.stringify(input)
  });

  return data.template;
}

export async function updateTemplate(
  id: string,
  input: Partial<Pick<PromptTemplate, "name" | "description" | "targetTool" | "taskType" | "content">>
): Promise<PromptTemplate> {
  const data = await request<{ ok: true; template: PromptTemplate }>(`/templates/${id}`, {
    method: "PUT",
    body: JSON.stringify(input)
  });

  return data.template;
}

export async function deleteTemplate(id: string): Promise<void> {
  await request<{ ok: true }>(`/templates/${id}`, {
    method: "DELETE"
  });
}

export async function getRuleProfilesCatalog(): Promise<RuleProfilesCatalog> {
  const data = await request<
    {
      ok: true;
      ruleProfiles: RuleProfile[];
      ruleItems: RuleItem[];
      acceptanceCriteriaPresets: AcceptanceCriteriaPreset[];
    }
  >("/rule-profiles");

  return {
    ruleProfiles: data.ruleProfiles,
    ruleItems: data.ruleItems,
    acceptanceCriteriaPresets: data.acceptanceCriteriaPresets
  };
}

export async function createRuleProfile(input: {
  name: string;
  description?: string;
  taskType: string;
  enabledRuleIds?: string[];
  customRules?: string[];
  acceptanceCriteriaPresetId?: string | null;
}): Promise<RuleProfile> {
  const data = await request<{ ok: true; ruleProfile: RuleProfile }>("/rule-profiles", {
    method: "POST",
    body: JSON.stringify(input)
  });

  return data.ruleProfile;
}

export async function updateRuleProfile(
  id: string,
  input: Partial<Pick<RuleProfile, "name" | "description" | "taskType" | "enabledRuleIds" | "customRules" | "acceptanceCriteriaPresetId">>
): Promise<RuleProfile> {
  const data = await request<{ ok: true; ruleProfile: RuleProfile }>(`/rule-profiles/${id}`, {
    method: "PUT",
    body: JSON.stringify(input)
  });

  return data.ruleProfile;
}

export async function deleteRuleProfile(id: string): Promise<void> {
  await request<{ ok: true }>(`/rule-profiles/${id}`, {
    method: "DELETE"
  });
}
