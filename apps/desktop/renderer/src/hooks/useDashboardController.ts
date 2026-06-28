import { useEffect, useState } from "react";
import {
  addProject,
  createContextComposerPreview,
  createTaskPack,
  getAgentsPreview,
  getAppSettings,
  getProjects,
  getTaskPacks,
  rescanProject,
  saveAgentsFile
} from "../api/client";
import { getAverageReadinessScore } from "../lib/score";
import type {
  AgentsPreview,
  ContextComposerPreview,
  Project,
  TaskPack,
  TaskPackDraft
} from "../types";

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

  const [contextComposerPreview, setContextComposerPreview] =
    useState<ContextComposerPreview | null>(null);

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

  async function handleRegenerateAgentsPreview() {
    if (!agentsPreview) {
      return;
    }

    try {
      setIsLoading(true);

      const settings = await getAppSettings();

      setStatusMessage(
        settings.generationMode === "ollama" && settings.defaultOllamaModel
          ? `Regenerating AGENTS.md with Ollama (${settings.defaultOllamaModel}). Cache will be ignored...`
          : `Regenerating AGENTS.md for "${agentsPreview.projectName}"...`
      );

      const preview = await getAgentsPreview(agentsPreview.projectId, {
        bypassCache: true
      });

      setAgentsPreview({
        projectId: agentsPreview.projectId,
        projectName: agentsPreview.projectName,
        markdown: preview.markdown,
        generation: preview.generation
      });

      setStatusMessage(`AGENTS.md regenerated for "${agentsPreview.projectName}".`);
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

  async function generateTaskPackFromDraft(selectedFilePaths?: string[]) {
    if (!taskPackDraft) {
      return;
    }

    try {
      setIsLoading(true);
      const settings = await getAppSettings();

      const selectedCount = selectedFilePaths?.length ?? 0;

      setStatusMessage(
        settings.generationMode === "ollama" && settings.defaultOllamaModel
          ? selectedCount > 0
            ? `Generating task pack with ${selectedCount} Composer-selected file(s) and Ollama (${settings.defaultOllamaModel}). This may take 1–2 minutes on CPU...`
            : `Generating task pack with Ollama (${settings.defaultOllamaModel}). This may take 1–2 minutes on CPU...`
          : selectedCount > 0
            ? `Generating task pack with ${selectedCount} Composer-selected file(s) for "${taskPackDraft.projectName}"...`
            : `Generating task pack for "${taskPackDraft.projectName}"...`
      );

      const taskPack = await createTaskPack({
        projectId: taskPackDraft.projectId,
        rawTask: taskPackDraft.rawTask,
        taskType: taskPackDraft.taskType,
        targetTool: taskPackDraft.targetTool,
        selectedFilePaths
      });

      await loadTaskPacks();
      setGeneratedTaskPack(taskPack);
      setTaskPackDraft(null);
      setContextComposerPreview(null);
      setStatusMessage("Task pack generated successfully.");
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

  async function handleAnalyzeTaskContext() {
    if (!taskPackDraft) {
      return;
    }

    try {
      setIsLoading(true);
      setStatusMessage(`Analyzing context for "${taskPackDraft.projectName}"...`);

      const preview = await createContextComposerPreview({
        projectId: taskPackDraft.projectId,
        rawTask: taskPackDraft.rawTask,
        taskType: taskPackDraft.taskType,
        targetTool: taskPackDraft.targetTool
      });

      setContextComposerPreview(preview);
      setStatusMessage(`Context preview ready for "${taskPackDraft.projectName}".`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreateTaskPack() {
    await generateTaskPackFromDraft();
  }

  async function handleCreateTaskPackFromComposer(selectedFilePaths: string[]) {
    if (selectedFilePaths.length === 0) {
      setStatusMessage("Select at least one Composer file before generating a Task Pack.");
      return;
    }

    await generateTaskPackFromDraft(selectedFilePaths);
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
    contextComposerPreview,

    setAgentsPreview,
    setTaskPackDraft,
    setGeneratedTaskPack,
    setContextComposerPreview,

    handleSelectProject,
    handleRescanProject,
    handleGenerateAgentsPreview,
    handleRegenerateAgentsPreview,
    handleSaveAgentsFile,
    handleCreateTaskPackDraft,
    handleAnalyzeTaskContext,
    handleCreateTaskPackFromComposer,
    handleCreateTaskPack,
    handleToggleProject
  };
}