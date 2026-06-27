import { useEffect, useState } from "react";
import {
  addProject,
  createTaskPack,
  getAgentsPreview,
  getAppSettings,
  getProjects,
  getTaskPacks,
  rescanProject,
  saveAgentsFile
} from "../api/client";
import { getAverageReadinessScore } from "../lib/score";
import type { AgentsPreview, Project, TaskPack, TaskPackDraft } from "../types";

export function useDashboardController() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [taskPacks, setTaskPacks] = useState<TaskPack[]>([]);
  const [expandedProjectId, setExpandedProjectId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState(
    "Ready to scan your first project."
  );

  const [agentsPreview, setAgentsPreview] = useState<AgentsPreview | null>(null);
  const [taskPackDraft, setTaskPackDraft] = useState<TaskPackDraft | null>(null);
  const [generatedTaskPack, setGeneratedTaskPack] = useState<TaskPack | null>(null);

  const readinessScore = getAverageReadinessScore(
    projects.map((project) => project.readinessScore)
  );

  async function loadProjects() {
    const data = await getProjects();
    setProjects(data);
  }

  async function loadTaskPacks() {
    const data = await getTaskPacks();
    setTaskPacks(data);
  }

  async function refreshDashboard() {
    await Promise.all([loadProjects(), loadTaskPacks()]);
  }

  async function handleSelectProject() {
    const selectedPath = await window.contextforge?.selectProjectFolder?.();

    if (!selectedPath) {
      return;
    }

    try {
      setIsLoading(true);
      setStatusMessage("Scanning project...");

      const project = await addProject(selectedPath);

      await refreshDashboard();
      setExpandedProjectId(project.id);
      setStatusMessage(`Project "${project.name}" added successfully.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRescanProject(project: Project) {
    try {
      setIsLoading(true);
      setStatusMessage(`Rescanning "${project.name}"...`);

      await rescanProject(project.id);

      await refreshDashboard();
      setExpandedProjectId(project.id);
      setStatusMessage(`Project "${project.name}" rescanned successfully.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleGenerateAgentsPreview(project: Project) {
    try {
      setIsLoading(true);
      const settings = await getAppSettings();

      setStatusMessage(
        settings.generationMode === "ollama" && settings.defaultOllamaModel
          ? `Generating AGENTS.md with Ollama (${settings.defaultOllamaModel}). This may take 1–2 minutes on CPU...`
          : `Generating AGENTS.md for "${project.name}"...`
      );

      const preview = await getAgentsPreview(project.id);

      setAgentsPreview({
        projectId: project.id,
        projectName: project.name,
        markdown: preview.markdown,
        generation: preview.generation
      });

      setStatusMessage(`AGENTS.md preview generated for "${project.name}".`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSaveAgentsFile() {
    if (!agentsPreview) {
      return;
    }

    try {
      setIsLoading(true);
      setStatusMessage(`Saving AGENTS.md for "${agentsPreview.projectName}"...`);

      await saveAgentsFile(agentsPreview.projectId, agentsPreview.markdown);

      await refreshDashboard();
      setStatusMessage(`AGENTS.md saved to project "${agentsPreview.projectName}".`);
      setAgentsPreview(null);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreateTaskPackDraft(project: Project) {
    try {
      setIsLoading(true);
      setStatusMessage(`Loading task pack defaults for "${project.name}"...`);

      const settings = await getAppSettings();

      setTaskPackDraft({
        projectId: project.id,
        projectName: project.name,
        rawTask: "",
        taskType: settings.defaultTaskType,
        targetTool: settings.defaultTargetTool
      });

      setStatusMessage(`Task pack draft opened for "${project.name}".`);
    } catch (error) {
      setTaskPackDraft({
        projectId: project.id,
        projectName: project.name,
        rawTask: "",
        taskType: "general",
        targetTool: "codex"
      });

      setStatusMessage(
        error instanceof Error
          ? `Settings unavailable. Using default task pack values. ${error.message}`
          : "Settings unavailable. Using default task pack values."
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreateTaskPack() {
    if (!taskPackDraft) {
      return;
    }

    try {
      setIsLoading(true);
      const settings = await getAppSettings();

      setStatusMessage(
        settings.generationMode === "ollama" && settings.defaultOllamaModel
          ? `Generating task pack with Ollama (${settings.defaultOllamaModel}). This may take 1–2 minutes on CPU...`
          : `Generating task pack for "${taskPackDraft.projectName}"...`
      );

      const taskPack = await createTaskPack({
        projectId: taskPackDraft.projectId,
        rawTask: taskPackDraft.rawTask,
        taskType: taskPackDraft.taskType,
        targetTool: taskPackDraft.targetTool
      });

      await loadTaskPacks();
      setGeneratedTaskPack(taskPack);
      setTaskPackDraft(null);
      setStatusMessage("Task pack generated successfully.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }

  function handleToggleProject(projectId: number) {
    setExpandedProjectId((currentId) => (currentId === projectId ? null : projectId));
  }

  useEffect(() => {
    refreshDashboard().catch(() => {
      setStatusMessage("Failed to load initial data.");
    });
  }, []);

  return {
    projects,
    taskPacks,
    expandedProjectId,
    isLoading,
    statusMessage,
    readinessScore,
    agentsPreview,
    taskPackDraft,
    generatedTaskPack,

    setAgentsPreview,
    setTaskPackDraft,
    setGeneratedTaskPack,

    handleSelectProject,
    handleRescanProject,
    handleGenerateAgentsPreview,
    handleSaveAgentsFile,
    handleCreateTaskPackDraft,
    handleCreateTaskPack,
    handleToggleProject
  };
}