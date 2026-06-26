import { useEffect, useState } from "react";
import {
  addProject,
  createTaskPack,
  getAgentsPreview,
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
      setStatusMessage(`Generating AGENTS.md for "${project.name}"...`);

      const markdown = await getAgentsPreview(project.id);

      setAgentsPreview({
        projectId: project.id,
        projectName: project.name,
        markdown
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

      await saveAgentsFile(agentsPreview.projectId);

      await refreshDashboard();
      setStatusMessage(`AGENTS.md saved to project "${agentsPreview.projectName}".`);
      setAgentsPreview(null);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }

  function handleCreateTaskPackDraft(project: Project) {
    setTaskPackDraft({
      projectId: project.id,
      projectName: project.name,
      rawTask: "",
      taskType: "general",
      targetTool: "codex"
    });
  }

  async function handleCreateTaskPack() {
    if (!taskPackDraft) {
      return;
    }

    try {
      setIsLoading(true);
      setStatusMessage(`Generating task pack for "${taskPackDraft.projectName}"...`);

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