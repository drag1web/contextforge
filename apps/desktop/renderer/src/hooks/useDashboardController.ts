import { useEffect, useState } from "react";
import {
  ApiRequestError,
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
import i18n from "../i18n";

function parseMultilineRules(value?: string) {
  return Array.from(
    new Set(
      String(value ?? "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
    )
  );
}


function getBlockedContextMessage(error: ApiRequestError) {
  const data = error.data;

  if (!data || typeof data !== "object") {
    return error.message;
  }

  const selectionQuality = (data as {
    selectionQuality?: {
      blockingReasons?: unknown;
      warnings?: unknown;
      score?: unknown;
    };
  }).selectionQuality;

  const reasons = Array.isArray(selectionQuality?.blockingReasons)
    ? selectionQuality.blockingReasons.map(String).filter(Boolean)
    : [];

  const warnings = Array.isArray(selectionQuality?.warnings)
    ? selectionQuality.warnings.map(String).filter(Boolean)
    : [];

  const firstReason = reasons[0] ?? warnings[0];
  const score = Number(selectionQuality?.score);
  const scorePart = Number.isFinite(score) ? ` Context score: ${score}/100.` : "";

  return firstReason
    ? `Context needs manual review. ${firstReason}${scorePart}`
    : error.message;
}

export function useDashboardController() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [taskPacks, setTaskPacks] = useState<TaskPack[]>([]);
  const [expandedProjectId, setExpandedProjectId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState(
    i18n.t("common.statusReady")
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
      setStatusMessage(i18n.t("common.statusScanningProject"));

      const project = await addProject(selectedPath);

      await refreshDashboard();
      setExpandedProjectId(project.id);
      setStatusMessage(i18n.t("common.statusProjectAdded", { name: project.name }));
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : i18n.t("common.unknownError"));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRescanProject(project: Project) {
    try {
      setIsLoading(true);
      setStatusMessage(i18n.t("common.statusRescanningProject", { name: project.name }));

      await rescanProject(project.id);

      await refreshDashboard();
      setExpandedProjectId(project.id);
      setStatusMessage(i18n.t("common.statusProjectRescanned", { name: project.name }));
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : i18n.t("common.unknownError"));
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
          ? i18n.t("common.statusGeneratingAgentsOllama", { model: settings.defaultOllamaModel })
          : i18n.t("common.statusGeneratingAgents", { name: project.name })
      );

      const preview = await getAgentsPreview(project.id);

      setAgentsPreview({
        projectId: project.id,
        projectName: project.name,
        markdown: preview.markdown,
        generation: preview.generation
      });

      setStatusMessage(i18n.t("common.statusAgentsGenerated", { name: project.name }));
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : i18n.t("common.unknownError"));
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
          ? i18n.t("common.statusRegeneratingAgentsOllama", { model: settings.defaultOllamaModel })
          : i18n.t("common.statusRegeneratingAgents", { name: agentsPreview.projectName })
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

      setStatusMessage(i18n.t("common.statusAgentsRegenerated", { name: agentsPreview.projectName }));
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : i18n.t("common.unknownError"));
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
      setStatusMessage(i18n.t("common.statusSavingAgents", { name: agentsPreview.projectName }));

      await saveAgentsFile(agentsPreview.projectId, agentsPreview.markdown);

      await refreshDashboard();
      setStatusMessage(i18n.t("common.statusAgentsSaved", { name: agentsPreview.projectName }));
      setAgentsPreview(null);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : i18n.t("common.unknownError"));
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
            ? i18n.t("common.statusGeneratingTaskPackOllamaFiles", {
              count: selectedCount,
              model: settings.defaultOllamaModel
            })
            : i18n.t("common.statusGeneratingTaskPackOllama", {
              model: settings.defaultOllamaModel
            })
          : selectedCount > 0
            ? i18n.t("common.statusGeneratingTaskPackFiles", {
              count: selectedCount,
              name: taskPackDraft.projectName
            })
            : i18n.t("common.statusGeneratingTaskPack", {
              name: taskPackDraft.projectName
            })
      );

      const taskPack = await createTaskPack({
        projectId: taskPackDraft.projectId,
        rawTask: taskPackDraft.rawTask,
        taskType: taskPackDraft.taskType,
        targetTool: taskPackDraft.targetTool,
        selectedFilePaths,

        templateId: taskPackDraft.templateId || undefined,
        ruleProfileId: taskPackDraft.ruleProfileId || undefined,
        enabledRuleIds: taskPackDraft.enabledRuleIds,
        customRules: parseMultilineRules(taskPackDraft.customRulesText),
        acceptanceCriteriaPresetId:
          taskPackDraft.acceptanceCriteriaPresetId || undefined,
        acceptanceCriteria: parseMultilineRules(taskPackDraft.acceptanceCriteriaText)
      });

      await loadTaskPacks();
      setGeneratedTaskPack(taskPack);
      setTaskPackDraft(null);
      setContextComposerPreview(null);
      setStatusMessage(i18n.t("common.statusTaskPackGenerated"));
    } catch (error) {
      if (
        error instanceof ApiRequestError &&
        error.code === "CONTEXT_SELECTION_BLOCKED" &&
        !selectedFilePaths
      ) {
        try {
          const preview = await createContextComposerPreview({
            projectId: taskPackDraft.projectId,
            rawTask: taskPackDraft.rawTask,
            taskType: taskPackDraft.taskType,
            targetTool: taskPackDraft.targetTool
          });

          setContextComposerPreview(preview);
          setStatusMessage(getBlockedContextMessage(error));
        } catch (previewError) {
          setStatusMessage(
            previewError instanceof Error
              ? `${getBlockedContextMessage(error)} ${previewError.message}`
              : getBlockedContextMessage(error)
          );
        }
      } else {
        setStatusMessage(error instanceof Error ? error.message : i18n.t("common.unknownError"));
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreateTaskPackDraft(project: Project) {
    try {
      setIsLoading(true);
      setStatusMessage(i18n.t("common.statusLoadingTaskDefaults", { name: project.name }));

      const settings = await getAppSettings();

      setTaskPackDraft({
        projectId: project.id,
        projectName: project.name,
        rawTask: "",
        taskType: settings.defaultTaskType,
        targetTool: settings.defaultTargetTool,
        enabledRuleIds: [],
        customRulesText: "",
        acceptanceCriteriaText: ""
      });

      setStatusMessage(i18n.t("common.statusTaskDraftOpened", { name: project.name }));
    } catch (error) {
      setTaskPackDraft({
        projectId: project.id,
        projectName: project.name,
        rawTask: "",
        taskType: "general",
        targetTool: "codex",
        enabledRuleIds: [],
        customRulesText: "",
        acceptanceCriteriaText: ""
      });

      setStatusMessage(
        error instanceof Error
          ? `${i18n.t("common.statusSettingsUnavailable")} ${error.message}`
          : i18n.t("common.statusSettingsUnavailable")
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
      setStatusMessage(i18n.t("common.statusAnalyzingContext", { name: taskPackDraft.projectName }));

      const preview = await createContextComposerPreview({
        projectId: taskPackDraft.projectId,
        rawTask: taskPackDraft.rawTask,
        taskType: taskPackDraft.taskType,
        targetTool: taskPackDraft.targetTool
      });

      setContextComposerPreview(preview);
      setStatusMessage(i18n.t("common.statusContextReady", { name: taskPackDraft.projectName }));
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : i18n.t("common.unknownError"));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreateTaskPack() {
    await generateTaskPackFromDraft();
  }

  async function handleCreateTaskPackFromComposer(selectedFilePaths: string[]) {
    if (selectedFilePaths.length === 0) {
      setStatusMessage(i18n.t("common.statusSelectComposerFile"));
      return;
    }

    await generateTaskPackFromDraft(selectedFilePaths);
  }

  function handleToggleProject(projectId: number) {
    setExpandedProjectId((currentId) => (currentId === projectId ? null : projectId));
  }

  useEffect(() => {
    refreshDashboard().catch(() => {
      setStatusMessage(i18n.t("common.statusInitialLoadFailed"));
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
