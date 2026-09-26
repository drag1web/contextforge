import { useEffect, useRef, useState } from "react";
import {
  ApiRequestError,
  addProject,
  createContextComposerPreview,
  createTaskPack,
  createTaskPackDraft,
  updateTaskPackDraft,
  discardTaskPackDraft,
  getTaskPackDraft,
  materializeTaskPackDraft,
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
  TaskPackDraftSession,
  TaskPackPersistedDraftView,
  MaterializeTaskPackDraftResponse,
} from "../types";
import i18n from "../i18n";
import { buildChangesDraftTask } from "../utils/localChangesNote";
import {
  applyTaskPackDraftOperationResult,
  canOrdinaryGenerateTaskPackDraft,
  captureTaskPackDraftOperation,
  createTransientTaskPackDraftSession,
  createRestoredTaskPackDraftSession,
  editTaskPackDraftSession,
  executeTaskPackDraftOperation,
  taskPackDraftPersistenceIssue,
  type TaskPackDraftOperation,
  type TaskPackDraftPersistenceIssue,
} from "../utils/taskPackDraftSession";
import { restorableDraftIssue } from "../utils/taskPackDraftDiscovery";
import {
  captureTaskPackDraftMaterialization, executeTaskPackDraftMaterialization,
  TaskPackDraftMaterializationError, taskPackDraftMaterializationIssue, upsertMaterializedTaskPack,
  ownsTaskPackDraftMaterialization,
  type TaskPackDraftMaterializationOperation, type TaskPackDraftMaterializationPhase,
  type TaskPackDraftMaterializationIssue,
} from "../utils/taskPackDraftMaterialization";

const draftPersistenceApi = {
  createTaskPackDraft, updateTaskPackDraft, discardTaskPackDraft, getTaskPackDraft,
};

interface DraftSessionCallbacks {
  isDraftBuilderActive?: (sessionId: string) => boolean;
  onSessionChange?: (session: TaskPackDraftSession) => void;
  onPersistenceResult?: (operation: TaskPackDraftOperation, view: TaskPackPersistedDraftView) => void;
  onMaterializationResult?: (operation: TaskPackDraftMaterializationOperation, result: MaterializeTaskPackDraftResponse) => void;
}

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
    ? ` ${i18n.t("common.statusContextScore", { score })}`
    : "";

  return firstReason
    ? `${i18n.t("common.statusContextNeedsManualReview", {
        reason: firstReason,
      })}${scorePart}`
    : error.message;
}

export function useDashboardController(draftCallbacks: DraftSessionCallbacks = {}) {
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
  const [taskPackDraftSession, setTaskPackDraftSessionState] = useState<TaskPackDraftSession | null>(
    null,
  );
  // Synchronous mirror of the single session state, only written by commitDraftSession.
  const draftSessionRef = useRef<TaskPackDraftSession | null>(null);
  const taskPackDraft = taskPackDraftSession?.draft ?? null;
  const [draftPersistenceOperation, setDraftPersistenceOperation] = useState<TaskPackDraftOperation | null>(null);
  const draftOperationRef = useRef<TaskPackDraftOperation | null>(null);
  const [draftPersistenceIssue, setDraftPersistenceIssue] = useState<TaskPackDraftPersistenceIssue | null>(null);
  const materializationRef = useRef<TaskPackDraftMaterializationOperation | null>(null);
  const [draftMaterializationOperation, setDraftMaterializationOperation] = useState<{
    operation: TaskPackDraftMaterializationOperation;
    phase: TaskPackDraftMaterializationPhase;
  } | null>(null);
  const [draftMaterializationIssue, setDraftMaterializationIssue] = useState<TaskPackDraftMaterializationIssue | null>(null);
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

  function commitDraftSession(next: TaskPackDraftSession | null) {
    if (next?.sessionId !== draftSessionRef.current?.sessionId) setDraftPersistenceIssue(null);
    if (next?.sessionId !== draftSessionRef.current?.sessionId) setDraftMaterializationIssue(null);
    draftSessionRef.current = next;
    setTaskPackDraftSessionState(next);
    if (next) draftCallbacks.onSessionChange?.(next);
  }

  function setTaskPackDraftSession(nextSession: TaskPackDraftSession | null) {
    const next = nextSession?.draft ?? null;
    const sameSession = nextSession?.sessionId === draftSessionRef.current?.sessionId;
    setTaskPackContextPreview((previousPreview) => {
      if (!sameSession || !next || !previousPreview) {
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
    commitDraftSession(nextSession);
  }

  function setTaskPackDraft(nextDraft: TaskPackDraft | null, expectedSessionId?: string) {
    const current = draftSessionRef.current;
    if (expectedSessionId !== undefined && current?.sessionId !== expectedSessionId) return;
    if (!nextDraft) return setTaskPackDraftSession(null);
    if (!current) return;
    if (materializationRef.current?.sessionId === current.sessionId) return;
    if (current.persistence && current.persistence.lifecycle.state !== "active") return;
    const operation = draftOperationRef.current;
    if (operation?.sessionId === current.sessionId && operation.kind !== "saving") return;
    setTaskPackDraftSession(editTaskPackDraftSession(current, nextDraft));
  }

  function startTransientDraft(draft: TaskPackDraft) {
    const session = createTransientTaskPackDraftSession(crypto.randomUUID(), draft);
    setTaskPackDraftSession(session);
    return session;
  }

  function restorePersistedTaskPackDraft(view: TaskPackPersistedDraftView) {
    if (draftSessionRef.current !== taskPackDraftSession || isLoading || draftOperationRef.current || materializationRef.current ||
      restorableDraftIssue(view, view, projects.map(project => project.id))) return null;
    const session = createRestoredTaskPackDraftSession(crypto.randomUUID(), view);
    setDraftPersistenceIssue(null);
    setTaskPackContextPreview(null);
    setContextComposerPreview(null);
    setGeneratedTaskPack(null);
    commitDraftSession(session);
    setStatusMessage(i18n.t("taskPackDraftDiscovery.restored"));
    return session;
  }

  async function handleDraftPersistence(
    kind: TaskPackDraftOperation["kind"],
    expectedSessionId: string,
  ): Promise<boolean> {
    const current = draftSessionRef.current;
    if (!current || current.sessionId !== expectedSessionId || draftOperationRef.current || materializationRef.current || isLoading) return false;
    const operation = captureTaskPackDraftOperation(current, kind);
    if (!operation) return false;
    draftOperationRef.current = operation;
    setDraftPersistenceOperation(operation);
    setDraftPersistenceIssue(null);
    setDraftMaterializationIssue(null);
    try {
      const view = await executeTaskPackDraftOperation(operation, draftPersistenceApi);
      const active = draftSessionRef.current;
      const next = applyTaskPackDraftOperationResult(active, operation, view);
      // Also seal history if the originating session is no longer the active surface.
      draftCallbacks.onPersistenceResult?.(operation, view);
      if (active?.sessionId !== operation.sessionId) return false;
      if (kind === "saving") {
        commitDraftSession(next); // Persistence only: do not invalidate analysis or author text.
        setStatusMessage(i18n.t("taskPackDraftPersistence.saveSuccess"));
      } else {
        setTaskPackContextPreview(null);
        setContextComposerPreview(null);
        setGeneratedTaskPack(null);
        setTaskPackDraftSession(next);
        setStatusMessage(i18n.t(kind === "discarding"
          ? "taskPackDraftPersistence.discardSuccess" : "taskPackDraftPersistence.reloadSuccess"));
      }
      setDraftPersistenceIssue(null);
      return true;
    } catch (error) {
      if (draftSessionRef.current?.sessionId !== operation.sessionId) return false;
      setDraftPersistenceIssue(taskPackDraftPersistenceIssue(
        operation,
        error instanceof ApiRequestError ? error.code : undefined,
        error instanceof ApiRequestError ? error.data : undefined,
      ));
      return false;
    } finally {
      if (draftOperationRef.current === operation) {
        draftOperationRef.current = null;
        setDraftPersistenceOperation(null);
      }
    }
  }

  function dismissDraftPersistenceIssue(sessionId: string) {
    if (draftSessionRef.current?.sessionId === sessionId) {
      setDraftPersistenceIssue(null);
      setDraftMaterializationIssue(null);
    }
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

  async function addProjectFromPath(selectedPath: string) {
    try {
      setIsLoading(true);
      setStatusMessage(i18n.t("common.statusScanningProject"));

      const project = await addProject(selectedPath);

      await refreshDashboard();
      setExpandedProjectId(project.id);
      setStatusMessage(
        i18n.t("common.statusProjectAdded", { name: project.name }),
      );
      return true;
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : i18n.t("common.unknownError"),
      );
      return false;
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSelectProject() {
    const selectedPath = await window.contextforge?.selectProjectFolder?.();

    if (!selectedPath) {
      return false;
    }

    return addProjectFromPath(selectedPath);
  }

  async function handleDropProjectFolder(file: File) {
    try {
      const selectedPath =
        await window.contextforge?.resolveDroppedProjectFolder?.(file);

      if (!selectedPath) {
        setStatusMessage(i18n.t("dragAndDrop.invalidProjectFolder"));
        return false;
      }

      return addProjectFromPath(selectedPath);
    } catch {
      setStatusMessage(i18n.t("dragAndDrop.invalidProjectFolder"));
      return false;
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
          message: i18n.t("common.statusContextFileLoaded", {
            name: fileName,
          }),
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
    expectedSessionId = taskPackDraftSession?.sessionId,
  ) {
    const generationSession = draftSessionRef.current;
    if (generationSession?.sessionId !== expectedSessionId) return null;
    if (!canOrdinaryGenerateTaskPackDraft(generationSession) || draftOperationRef.current || materializationRef.current) {
      if (generationSession?.persistence) setStatusMessage(i18n.t("taskPackDraftPersistence.generationUnavailable"));
      return null;
    }
    const activeDraft = draftOverride ?? generationSession?.draft;

    if (!activeDraft) {
      return null;
    }

    try {
      setIsLoading(true);
      const settings = await getAppSettings();

      if (draftSessionRef.current?.sessionId !== generationSession?.sessionId ||
        !canOrdinaryGenerateTaskPackDraft(draftSessionRef.current) || draftOperationRef.current) return null;

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
      if (draftSessionRef.current?.sessionId !== generationSession?.sessionId) return null;
      setGeneratedTaskPack(taskPack);
      setTaskPackDraft(null);
      setContextComposerPreview(null);
      setStatusMessage(i18n.t("common.statusTaskPackGenerated"));
      return { kind: "generated" as const, taskPack };
    } catch (error) {
      if (draftSessionRef.current?.sessionId !== generationSession?.sessionId) return null;
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

          if (draftSessionRef.current?.sessionId !== generationSession?.sessionId) return null;
          setContextComposerPreview(preview);
          setStatusMessage(getBlockedContextMessage(error));
          return { kind: "context-review" as const, preview, session: draftSessionRef.current! };
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
      const nextDraft: TaskPackDraft = {
        projectId: project.id,
        projectName: project.name,
        rawTask: "",
        taskType: settings.defaultTaskType,
        targetTool: settings.defaultTargetTool,
        enabledRuleIds: [],
        customRulesText: "",
        acceptanceCriteriaText: "",
      };

      const session = startTransientDraft(nextDraft);
      setStatusMessage(
        i18n.t("common.statusTaskDraftOpened", { name: project.name }),
      );
      return session;
    } catch (error) {
      const nextDraft: TaskPackDraft = {
        projectId: project.id,
        projectName: project.name,
        rawTask: "",
        taskType: "general",
        targetTool: "codex",
        enabledRuleIds: [],
        customRulesText: "",
        acceptanceCriteriaText: "",
      };

      const session = startTransientDraft(nextDraft);
      setStatusMessage(
        error instanceof Error
          ? `${i18n.t("common.statusSettingsUnavailable")} ${error.message}`
          : i18n.t("common.statusSettingsUnavailable"),
      );
      return session;
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreateTaskPackDraftFromChanges(project: Project) {
    try {
      setIsLoading(true);
      setStatusMessage(
        i18n.t("common.statusReadingLocalChanges", { name: project.name }),
      );

      const [settings, gitStatus] = await Promise.all([
        getAppSettings().catch(() => null),
        getProjectGitStatus(project.id),
      ]);

      const rawTask = buildChangesDraftTask(gitStatus);
      const nextDraft: TaskPackDraft = {
        projectId: project.id,
        projectName: project.name,
        rawTask,
        taskType: settings?.defaultTaskType ?? "general",
        targetTool: settings?.defaultTargetTool ?? "codex",
        enabledRuleIds: [],
        customRulesText: "",
        acceptanceCriteriaText: "",
      };

      const session = startTransientDraft(nextDraft);
      setStatusMessage(
        rawTask
          ? i18n.t("common.statusTaskDraftOpenedFromChanges", {
              name: project.name,
            })
          : i18n.t("common.statusNoLocalChangesDraftOpened", {
              name: project.name,
            }),
      );
      return session;
    } catch (error) {
      const nextDraft: TaskPackDraft = {
        projectId: project.id,
        projectName: project.name,
        rawTask: "",
        taskType: "general",
        targetTool: "codex",
        enabledRuleIds: [],
        customRulesText: "",
        acceptanceCriteriaText: "",
      };

      const session = startTransientDraft(nextDraft);

      const fallbackMessage = i18n.t(
        "common.statusLocalChangesReadFailed",
      );
      setStatusMessage(
        error instanceof Error
          ? `${fallbackMessage} ${error.message}`
          : fallbackMessage,
      );
      return session;
    } finally {
      setIsLoading(false);
    }
  }

  async function createTaskContextPreview(draftOverride?: TaskPackDraft) {
    const expectedSessionId = taskPackDraftSession?.sessionId;
    if (draftSessionRef.current?.sessionId !== expectedSessionId) return null;
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

    if (draftSessionRef.current?.sessionId !== expectedSessionId) return null;
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
      if (!preview) return null;

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
    if (!taskPackDraft || draftSessionRef.current?.sessionId !== taskPackDraftSession?.sessionId) {
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

      if (preview && draftSessionRef.current?.sessionId === taskPackDraftSession?.sessionId) {
        setContextComposerPreview(preview);
        setStatusMessage(
          i18n.t("common.statusContextReady", {
            name: taskPackDraft.projectName,
          }),
        );
        return { preview, session: draftSessionRef.current! };
      }
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : i18n.t("common.unknownError"),
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function materializePersistedDraft(finalDraft: TaskPackDraft, expectedSessionId: string) {
    if (materializationRef.current || draftOperationRef.current || isLoading) return null;
    const operation = captureTaskPackDraftMaterialization(draftSessionRef.current, expectedSessionId, finalDraft);
    if (!operation) return null;
    materializationRef.current = operation; // Synchronous duplicate-click and authoring guard.
    commitDraftSession(operation.session);
    setDraftPersistenceIssue(null);
    setDraftMaterializationIssue(null);
    setIsLoading(true);
    let phase: TaskPackDraftMaterializationPhase = operation.needSave ? "savingFinal" : "creating";
    let version = operation.expectedDraftVersion;
    try {
      const result = await executeTaskPackDraftMaterialization(operation, { updateTaskPackDraft, materializeTaskPackDraft }, {
        onPhase(next) {
          phase = next;
          setDraftMaterializationOperation({ operation, phase });
          if (ownsTaskPackDraftMaterialization(draftSessionRef.current, operation)) {
            setStatusMessage(i18n.t(`taskPackDraftMaterialization.${phase}`));
          }
        },
        onSaved(view) {
          version = view.draftVersion;
          const active = draftSessionRef.current;
          const next = applyTaskPackDraftOperationResult(active, operation.saveOperation, view);
          // Save is real, even if creation fails or the originating surface has been left.
          draftCallbacks.onPersistenceResult?.(operation.saveOperation, view);
          if (ownsTaskPackDraftMaterialization(active, operation)) commitDraftSession(next);
        },
      });
      setTaskPacks(current => upsertMaterializedTaskPack(current, result.taskPack));
      draftCallbacks.onMaterializationResult?.(operation, result);
      if (!ownsTaskPackDraftMaterialization(draftSessionRef.current, operation)) return null;
      setTaskPackDraftSession(null);
      setTaskPackContextPreview(null);
      setContextComposerPreview(null);
      if (draftCallbacks.isDraftBuilderActive?.(operation.sessionId) === false) {
        setGeneratedTaskPack(null);
        return null;
      }
      setGeneratedTaskPack(result.taskPack);
      setDraftMaterializationIssue(null);
      setDraftPersistenceIssue(null);
      setStatusMessage(i18n.t("taskPackDraftMaterialization.success"));
      return { kind: "generated" as const, taskPack: result.taskPack };
    } catch (error) {
      if (!ownsTaskPackDraftMaterialization(draftSessionRef.current, operation)) return null;
      const code = error instanceof ApiRequestError || error instanceof TaskPackDraftMaterializationError ? error.code : undefined;
      setDraftMaterializationIssue(taskPackDraftMaterializationIssue(
        operation, phase, version, code, error instanceof ApiRequestError ? error.data : undefined,
      ));
      setStatusMessage(i18n.t(code === "CONTEXT_SELECTION_BLOCKED"
        ? "taskPackDraftMaterialization.blocked" : "taskPackDraftMaterialization.failed"));
      if (code === "CONTEXT_SELECTION_BLOCKED") {
        try {
          const preview = await createContextComposerPreview({
            projectId: operation.projectId, rawTask: operation.session.draft.rawTask,
            taskType: operation.session.draft.taskType, targetTool: operation.session.draft.targetTool,
            clarifications: operation.session.draft.clarifications,
            understandingSnapshotId: operation.session.draft.understandingSnapshotId,
            reviewedUnderstandingSnapshotId: operation.session.draft.reviewedUnderstandingSnapshotId,
          });
          if (!ownsTaskPackDraftMaterialization(draftSessionRef.current, operation) ||
            draftCallbacks.isDraftBuilderActive?.(operation.sessionId) === false) return null;
          setContextComposerPreview(preview);
          return { kind: "context-review" as const, preview, session: draftSessionRef.current! };
        } catch {
          // Keep the localized blocked issue and successfully saved baseline. No raw errors.
        }
      }
      return null;
    } finally {
      if (materializationRef.current === operation) {
        materializationRef.current = null;
        setDraftMaterializationOperation(null);
        setIsLoading(false);
      }
    }
  }

  async function handleCreateTaskPack(draftOverride?: TaskPackDraft) {
    // This closure belongs to the Builder session that started understanding, not a later B.
    const expectedSessionId = taskPackDraftSession?.sessionId;
    const current = draftSessionRef.current;
    if (!current || current.sessionId !== expectedSessionId ||
      (draftOverride && draftOverride.projectId !== current.draft.projectId)) return null;
    if (current.persistence !== null) {
      return materializePersistedDraft(draftOverride ?? current.draft, current.sessionId);
    }
    return generateTaskPackFromDraft(undefined, draftOverride, expectedSessionId);
  }

  async function handleCreateTaskPackFromComposer(selectedFilePaths: string[]) {
    if (selectedFilePaths.length === 0) {
      setStatusMessage(i18n.t("common.statusSelectComposerFile"));
      return null;
    }

    return generateTaskPackFromDraft(selectedFilePaths);
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
    setStatusMessage(i18n.t("common.statusTaskPackCreatedFromGitHubIssue"));
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
    setStatusMessage(i18n.t("common.statusTaskPackUpdated"));
  }

  function handleOpenTaskPackInBuilder(taskPack: TaskPack) {
    const recipe = taskPack.generationRecipe;
    const nextDraft: TaskPackDraft = {
      projectId: taskPack.projectId,
      projectName:
        taskPack.projectName ??
        i18n.t("labels.projectFallback", { id: taskPack.projectId }),
      rawTask: taskPack.rawTask,
      taskType: taskPack.taskType,
      targetTool: taskPack.targetTool,
      templateId: recipe?.template?.id,
      ruleProfileId: recipe?.ruleProfile?.id,
      enabledRuleIds: recipe?.enabledRules?.map((rule) => rule.id) ?? [],
      customRulesText: recipe?.customRules?.join("\n") ?? "",
      acceptanceCriteriaPresetId: recipe?.acceptanceCriteriaPreset?.id,
      acceptanceCriteriaText: recipe?.acceptanceCriteria?.join("\n") ?? "",
      clarifications: recipe?.taskClarifications,
    };

    setGeneratedTaskPack(null);
    setContextComposerPreview(null);
    setTaskPackContextPreview(null);
    const session = startTransientDraft(nextDraft);
    setStatusMessage(i18n.t("common.statusTaskPackReopened"));
    return session;
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
    taskPackDraftSession,
    draftPersistenceOperation,
    draftPersistenceIssue,
    draftMaterializationOperation,
    draftMaterializationIssue,
    handleDraftPersistence,
    restorePersistedTaskPackDraft,
    dismissDraftPersistenceIssue,
    generatedTaskPack,
    contextComposerPreview,
    taskPackContextPreview,

    setAgentsPreview,
    setTaskPackDraft,
    setTaskPackDraftSession,
    setGeneratedTaskPack,
    setContextComposerPreview,

    handleSelectProject,
    handleDropProjectFolder,
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
    handleOpenTaskPackInBuilder,
    handleToggleProject,
  };
}
