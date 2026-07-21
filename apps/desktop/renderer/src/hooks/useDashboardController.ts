import { useEffect, useState } from "react";
import {
  ApiRequestError,
  addProject,
  createContextComposerPreview,
  createTaskPack,
  getAgentsPreview,
  getAppSettings,
  getProjectContextFile,
  getProjectGitStatus,
  getProjects,
  getTaskPacks,
  rescanProject,
  saveAgentsFile,
} from "../api/client";
import { getAverageReadinessScore } from "../lib/score";
import type {
  AgentsPreview,
  ContextComposerPreview,
  Project,
  ProjectContextFile,
  TaskPack,
  TaskPackDraft,
} from "../types";
import i18n from "../i18n";
import { buildChangesDraftTask } from "../utils/localChangesNote";

function parseMultilineRules(value?: string) {
  return Array.from(
    new Set(
      String(value ?? "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  );
}

function getClarificationSignature(draft: Pick<TaskPackDraft, "clarifications">) {
  return JSON.stringify(
    (draft.clarifications ?? []).map((item) => ({
      question: item.question.trim(),
      answer: item.answer.trim(),
    })),
  );
}

function getBlockedContextMessage(error: ApiRequestError) {
  const data = error.data;

  if (!data || typeof data !== "object") {
    return error.message;
  }

  const selectionQuality = (
    data as {
      selectionQuality?: {
        blockingReasons?: unknown;
        warnings?: unknown;
        score?: unknown;
      };
    }
  ).selectionQuality;

  const reasons = Array.isArray(selectionQuality?.blockingReasons)
    ? selectionQuality.blockingReasons.map(String).filter(Boolean)
    : [];

  const warnings = Array.isArray(selectionQuality?.warnings)
    ? selectionQuality.warnings.map(String).filter(Boolean)
    : [];

  const firstReason = reasons[0] ?? warnings[0];
  const score = Number(selectionQuality?.score);
  const scorePart = Number.isFinite(score)
    ? ` Context score: ${score}/100.`
    : "";

  return firstReason
    ? `Context needs manual review. ${firstReason}${scorePart}`
    : error.message;
}

export function useDashboardController() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [taskPacks, setTaskPacks] = useState<TaskPack[]>([]);
  const [expandedProjectId, setExpandedProjectId] = useState<number | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  const [agentsPreview, setAgentsPreview] = useState<AgentsPreview | null>(
    null,
  );
  const [taskPackDraft, setTaskPackDraftState] = useState<TaskPackDraft | null>(
    null,
  );
  const [generatedTaskPack, setGeneratedTaskPack] = useState<TaskPack | null>(
    null,
  );

  const [contextComposerPreview, setContextComposerPreview] =
    useState<ContextComposerPreview | null>(null);
  const [taskPackContextPreview, setTaskPackContextPreview] =
    useState<ContextComposerPreview | null>(null);

  const readinessScore = getAverageReadinessScore(
    projects.map((project) => project.readinessScore),
  );

  function setTaskPackDraft(nextDraft: TaskPackDraft | null) {
    setTaskPackDraftState(() => {
      const next = nextDraft;

      setTaskPackContextPreview((previousPreview) => {
        if (!next || !previousPreview) {
          return null;
        }

        const sameDraftContext =
          previousPreview.project.id === next.projectId &&
          previousPreview.task.originalRawTask === next.rawTask &&
          JSON.stringify(previousPreview.task.clarifications ?? []) ===
            getClarificationSignature(next) &&
          previousPreview.task.requestedTaskType === next.taskType &&
          previousPreview.task.targetTool === next.targetTool;

        return sameDraftContext ? previousPreview : null;
      });

      return next;
    });
  }

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
      setStatusMessage(
        i18n.t("common.statusProjectAdded", { name: project.name }),
      );
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : i18n.t("common.unknownError"),
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRescanProject(project: Project) {
    try {
      setIsLoading(true);
      setStatusMessage(
        i18n.t("common.statusRescanningProject", { name: project.name }),
      );

      await rescanProject(project.id);

      await refreshDashboard();
      setExpandedProjectId(project.id);
      setStatusMessage(
        i18n.t("common.statusProjectRescanned", { name: project.name }),
      );
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : i18n.t("common.unknownError"),
      );
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
          ? i18n.t("common.statusGeneratingAgentsOllama", {
              model: settings.defaultOllamaModel,
            })
          : i18n.t("common.statusGeneratingAgents", { name: project.name }),
      );

      const preview = await getAgentsPreview(project.id);

      setAgentsPreview({
        projectId: project.id,
        projectName: project.name,
        markdown: preview.markdown,
        generation: preview.generation,
        agentsFile: preview.agentsFile,
      });

      setStatusMessage(
        i18n.t("common.statusAgentsGenerated", { name: project.name }),
      );
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : i18n.t("common.unknownError"),
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function handleOpenProjectContextFile(
    project: Project,
    fileName: ProjectContextFile["fileName"],
  ) {
    try {
      setIsLoading(true);
      setStatusMessage(
        i18n.t("common.statusLoadingContextFile", { name: fileName }),
      );

      const { markdown, contextFile } = await getProjectContextFile(
        project.id,
        fileName,
      );

      setAgentsPreview({
        projectId: project.id,
        projectName: project.name,
        markdown,
        generation: {
          content: markdown,
          mode: "template",
          model: null,
          usedFallback: false,
          message: `Loaded ${fileName} from project context history.`,
        },
        agentsFile: {
          path: contextFile.path,
          exists: contextFile.exists,
        },
      });

      setStatusMessage(
        i18n.t("common.statusContextFileLoaded", { name: fileName }),
      );
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : i18n.t("common.unknownError"),
      );
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
          ? i18n.t("common.statusRegeneratingAgentsOllama", {
              model: settings.defaultOllamaModel,
            })
          : i18n.t("common.statusRegeneratingAgents", {
              name: agentsPreview.projectName,
            }),
      );

      const preview = await getAgentsPreview(agentsPreview.projectId, {
        bypassCache: true,
      });

      setAgentsPreview({
        projectId: agentsPreview.projectId,
        projectName: agentsPreview.projectName,
        markdown: preview.markdown,
        generation: preview.generation,
        agentsFile: preview.agentsFile,
      });

      setStatusMessage(
        i18n.t("common.statusAgentsRegenerated", {
          name: agentsPreview.projectName,
        }),
      );
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : i18n.t("common.unknownError"),
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSaveAgentsFile(
    markdown?: string,
    fileName: "AGENTS.md" | "AGENTS.generated.md" = "AGENTS.md",
  ) {
    if (!agentsPreview) {
      return;
    }

    try {
      setIsLoading(true);
      setStatusMessage(
        i18n.t("common.statusSavingAgents", {
          name: agentsPreview.projectName,
        }),
      );

      await saveAgentsFile(
        agentsPreview.projectId,
        markdown ?? agentsPreview.markdown,
        {
          fileName,
        },
      );

      await refreshDashboard();
      setStatusMessage(
        i18n.t("common.statusAgentsSaved", { name: agentsPreview.projectName }),
      );
      setAgentsPreview(null);
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : i18n.t("common.unknownError"),
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function generateTaskPackFromDraft(
    selectedFilePaths?: string[],
    draftOverride?: TaskPackDraft,
  ) {
    const activeDraft = draftOverride ?? taskPackDraft;

    if (!activeDraft) {
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
                model: settings.defaultOllamaModel,
              })
            : i18n.t("common.statusGeneratingTaskPackOllama", {
                model: settings.defaultOllamaModel,
              })
          : selectedCount > 0
            ? i18n.t("common.statusGeneratingTaskPackFiles", {
                count: selectedCount,
                name: activeDraft.projectName,
              })
            : i18n.t("common.statusGeneratingTaskPack", {
                name: activeDraft.projectName,
              }),
      );

      const taskPack = await createTaskPack({
        projectId: activeDraft.projectId,
        rawTask: activeDraft.rawTask,
        taskType: activeDraft.taskType,
        targetTool: activeDraft.targetTool,
        selectedFilePaths,
        clarifications: activeDraft.clarifications,
        performanceSessionId: activeDraft.performanceSessionId,
        understandingSnapshotId: activeDraft.understandingSnapshotId,
        reviewedUnderstandingSnapshotId:
          activeDraft.reviewedUnderstandingSnapshotId,

        templateId: activeDraft.templateId || undefined,
        ruleProfileId: activeDraft.ruleProfileId || undefined,
        enabledRuleIds: activeDraft.enabledRuleIds,
        customRules: parseMultilineRules(activeDraft.customRulesText),
        acceptanceCriteriaPresetId:
          activeDraft.acceptanceCriteriaPresetId || undefined,
        acceptanceCriteria: parseMultilineRules(
          activeDraft.acceptanceCriteriaText,
        ),
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
            projectId: activeDraft.projectId,
            rawTask: activeDraft.rawTask,
            taskType: activeDraft.taskType,
            targetTool: activeDraft.targetTool,
            clarifications: activeDraft.clarifications,
            understandingSnapshotId: activeDraft.understandingSnapshotId,
            reviewedUnderstandingSnapshotId:
              activeDraft.reviewedUnderstandingSnapshotId,
          });

          setContextComposerPreview(preview);
          setStatusMessage(getBlockedContextMessage(error));
        } catch (previewError) {
          setStatusMessage(
            previewError instanceof Error
              ? `${getBlockedContextMessage(error)} ${previewError.message}`
              : getBlockedContextMessage(error),
          );
        }
      } else {
        setStatusMessage(
          error instanceof Error
            ? error.message
            : i18n.t("common.unknownError"),
        );
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreateTaskPackDraft(project: Project) {
    try {
      setIsLoading(true);
      setStatusMessage(
        i18n.t("common.statusLoadingTaskDefaults", { name: project.name }),
      );

      const settings = await getAppSettings();

      setTaskPackDraft({
        projectId: project.id,
        projectName: project.name,
        rawTask: "",
        taskType: settings.defaultTaskType,
        targetTool: settings.defaultTargetTool,
        enabledRuleIds: [],
        customRulesText: "",
        acceptanceCriteriaText: "",
      });

      setStatusMessage(
        i18n.t("common.statusTaskDraftOpened", { name: project.name }),
      );
    } catch (error) {
      setTaskPackDraft({
        projectId: project.id,
        projectName: project.name,
        rawTask: "",
        taskType: "general",
        targetTool: "codex",
        enabledRuleIds: [],
        customRulesText: "",
        acceptanceCriteriaText: "",
      });

      setStatusMessage(
        error instanceof Error
          ? `${i18n.t("common.statusSettingsUnavailable")} ${error.message}`
          : i18n.t("common.statusSettingsUnavailable"),
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreateTaskPackDraftFromChanges(project: Project) {
    try {
      setIsLoading(true);
      setStatusMessage(`Reading local changes for ${project.name}...`);

      const [settings, gitStatus] = await Promise.all([
        getAppSettings().catch(() => null),
        getProjectGitStatus(project.id),
      ]);

      const rawTask = buildChangesDraftTask(gitStatus);

      setTaskPackDraft({
        projectId: project.id,
        projectName: project.name,
        rawTask,
        taskType: settings?.defaultTaskType ?? "general",
        targetTool: settings?.defaultTargetTool ?? "codex",
        enabledRuleIds: [],
        customRulesText: "",
        acceptanceCriteriaText: "",
      });

      setStatusMessage(
        rawTask
          ? `Task draft opened from local changes for ${project.name}.`
          : `No local changes found for ${project.name}. Opened a blank Task Pack draft.`,
      );
    } catch (error) {
      setTaskPackDraft({
        projectId: project.id,
        projectName: project.name,
        rawTask: "",
        taskType: "general",
        targetTool: "codex",
        enabledRuleIds: [],
        customRulesText: "",
        acceptanceCriteriaText: "",
      });

      setStatusMessage(
        error instanceof Error
          ? `Could not read local changes. Opened a blank Task Pack draft. ${error.message}`
          : "Could not read local changes. Opened a blank Task Pack draft.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function createTaskContextPreview(draftOverride?: TaskPackDraft) {
    const activeDraft = draftOverride ?? taskPackDraft;

    if (!activeDraft) {
      return null;
    }

    const preview = await createContextComposerPreview({
      projectId: activeDraft.projectId,
      rawTask: activeDraft.rawTask,
      taskType: activeDraft.taskType,
      targetTool: activeDraft.targetTool,
      clarifications: activeDraft.clarifications,
      understandingSnapshotId: activeDraft.understandingSnapshotId,
      reviewedUnderstandingSnapshotId:
        activeDraft.reviewedUnderstandingSnapshotId,
    });

    setTaskPackContextPreview(preview);
    return preview;
  }

  async function handleAnalyzeTaskContext(draftOverride?: TaskPackDraft) {
    const activeDraft = draftOverride ?? taskPackDraft;

    if (!activeDraft) {
      return null;
    }

    try {
      setIsLoading(true);
      setStatusMessage(
        i18n.t("common.statusAnalyzingContext", {
          name: activeDraft.projectName,
        }),
      );

      const preview = await createTaskContextPreview(activeDraft);

      setStatusMessage(
        i18n.t("common.statusContextReady", {
          name: activeDraft.projectName,
        }),
      );
      return preview;
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : i18n.t("common.unknownError"),
      );
      return null;
    } finally {
      setIsLoading(false);
    }
  }

  async function handleOpenTaskContextComposer() {
    if (!taskPackDraft) {
      return;
    }

    try {
      setIsLoading(true);
      setStatusMessage(
        i18n.t("common.statusAnalyzingContext", {
          name: taskPackDraft.projectName,
        }),
      );

      const preview =
        taskPackContextPreview ?? (await createTaskContextPreview());

      if (preview) {
        setContextComposerPreview(preview);
        setStatusMessage(
          i18n.t("common.statusContextReady", {
            name: taskPackDraft.projectName,
          }),
        );
      }
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : i18n.t("common.unknownError"),
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreateTaskPack(draftOverride?: TaskPackDraft) {
    await generateTaskPackFromDraft(undefined, draftOverride);
  }

  async function handleCreateTaskPackFromComposer(selectedFilePaths: string[]) {
    if (selectedFilePaths.length === 0) {
      setStatusMessage(i18n.t("common.statusSelectComposerFile"));
      return;
    }

    await generateTaskPackFromDraft(selectedFilePaths);
  }

  function handleExternalTaskPackCreated(taskPack: TaskPack) {
    setTaskPacks((currentTaskPacks) => [
      taskPack,
      ...currentTaskPacks.filter((item) => item.id !== taskPack.id),
    ]);
    setGeneratedTaskPack(taskPack);
    setTaskPackDraft(null);
    setContextComposerPreview(null);
    setTaskPackContextPreview(null);
    setStatusMessage("Task Pack created from GitHub issue.");
  }

  function handleExternalTaskPackUpdated(taskPack: TaskPack) {
    setTaskPacks((currentTaskPacks) =>
      currentTaskPacks.map((item) =>
        item.id === taskPack.id ? taskPack : item,
      ),
    );
    setGeneratedTaskPack((currentTaskPack) =>
      currentTaskPack?.id === taskPack.id ? taskPack : currentTaskPack,
    );
    setStatusMessage("Task Pack linked to a GitHub issue.");
  }

  function handleToggleProject(projectId: number) {
    setExpandedProjectId((currentId) =>
      currentId === projectId ? null : projectId,
    );
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
    taskPackContextPreview,

    setAgentsPreview,
    setTaskPackDraft,
    setGeneratedTaskPack,
    setContextComposerPreview,

    handleSelectProject,
    handleRescanProject,
    handleGenerateAgentsPreview,
    handleOpenProjectContextFile,
    handleRegenerateAgentsPreview,
    handleSaveAgentsFile,
    handleCreateTaskPackDraft,
    handleCreateTaskPackDraftFromChanges,
    handleAnalyzeTaskContext,
    handleOpenTaskContextComposer,
    handleCreateTaskPackFromComposer,
    handleCreateTaskPack,
    handleExternalTaskPackCreated,
    handleExternalTaskPackUpdated,
    handleToggleProject,
  };
}
