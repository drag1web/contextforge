import type {
  AppSettings,
  OllamaModel,
  OllamaStatus,
  Project,
  TaskPack
} from "../types";

const API_URL = "http://localhost:4000/api";

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
    throw new Error(data.message ?? "Request failed");
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

export async function getAgentsPreview(projectId: number): Promise<string> {
  const data = await request<{ ok: true; markdown: string }>(
    `/projects/${projectId}/agents-preview`
  );

  return data.markdown;
}

export async function saveAgentsFile(projectId: number): Promise<Project> {
  const data = await request<{ ok: true; project: Project }>(
    `/projects/${projectId}/agents-save`,
    {
      method: "POST"
    }
  );

  return data.project;
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
  input: Partial<AppSettings>
): Promise<AppSettings> {
  const data = await request<{ ok: true; settings: AppSettings }>("/settings", {
    method: "PATCH",
    body: JSON.stringify(input)
  });

  return data.settings;
}