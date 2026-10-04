import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Activity,
  AlertTriangle,
  Library,
  Bot,
  Edit3,
  Eye,
  ExternalLink,
  Github,
  Loader2,
  RotateCcw,
  Save,
  ScanSearch,
  ShieldCheck,
  Wrench,
  X,
} from "lucide-react";

import type { TaskPack } from "../types";
import {
  createGitHubIssueFromTaskPack,
  getTaskPack,
  updateTaskPackContent,
} from "../api/client";
import { TaskPackWorkflowCard } from "../components/taskPacks/TaskPackWorkflowCard";
import { TaskPackRevisionHistoryPanel } from "../components/taskPacks/TaskPackRevisionHistoryPanel";
import { TaskPackWorkspaceHeader, type TaskPackWorkspaceView } from "../components/taskPacks/TaskPackWorkspaceHeader";
import { TaskPackDocumentView, type PromptViewMode } from "../components/taskPacks/TaskPackDocumentView";
import { TaskPackDetailsView } from "../components/taskPacks/TaskPackDetailsView";
import { useTaskPackWorkflow } from "../hooks/useTaskPackWorkflow";
import { useTaskPackRevisionHistory } from "../hooks/useTaskPackRevisionHistory";
import { refreshTaskPackWorkflowProjectionAfterActivity } from "../utils/taskPackWorkflowIndex";
import { Button } from "../components/ui/Button";
import { Modal } from "../components/ui/Modal";
import { HorizontalSlidingSelector } from "../components/ui/SlidingSelectors";
import { SelectorDiagnosticsModal } from "../components/selector/SelectorDiagnosticsModal";
import { GenerationDiagnosticsModal } from "../components/generation/GenerationDiagnosticsModal";
import { PerformanceDiagnosticsModal } from "../components/performance/PerformanceDiagnosticsModal";
import type { TaskPackFreshness } from "../utils/taskPackFreshness";
import {
  buildTaskPackEditorUpdate,
  createTaskPackEditorSession,
  type TaskPackEditorKind,
  type TaskPackEditorSession,
} from "../utils/taskPackEditorSession";

interface TaskPackResultPageProps {
  taskPack: TaskPack;
  onClose: () => void;
  onOpenArchive: () => void;
  onInspectTaskPack: (taskPack: TaskPack) => void;
  onTaskPackUpdated?: (taskPack: TaskPack) => void;
  onWorkflowActivity?: () => Promise<void>;
  onOpenInBuilder?: (taskPack: TaskPack) => void;
  freshness: TaskPackFreshness;
  onReviewProject: (projectId: number) => void;
}

const MARKDOWN_PREVIEW_STYLES = `
.cf-markdown-preview {
  color: rgb(212 212 212);
  font-size: 0.875rem;
  line-height: 1.75;
}

.cf-markdown-preview > :first-child {
  margin-top: 0;
}

.cf-markdown-preview > :last-child {
  margin-bottom: 0;
}

.cf-markdown-preview h1 {
  margin: 0 0 1.25rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid rgb(38 38 38);
  color: white;
  font-size: 1.5rem;
  line-height: 2rem;
  font-weight: 650;
  letter-spacing: -0.025em;
}

.cf-markdown-preview h2 {
  margin: 2rem 0 0.75rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid rgb(23 23 23);
  color: white;
  font-size: 1.125rem;
  line-height: 1.75rem;
  font-weight: 650;
}

.cf-markdown-preview h3 {
  margin: 1.5rem 0 0.5rem;
  color: rgb(245 245 245);
  font-size: 1rem;
  line-height: 1.5rem;
  font-weight: 650;
}

.cf-markdown-preview p {
  margin: 0.75rem 0;
  color: rgb(212 212 212);
}

.cf-markdown-preview strong {
  color: white;
  font-weight: 650;
}

.cf-markdown-preview ul,
.cf-markdown-preview ol {
  margin: 0.75rem 0;
  padding-left: 1.5rem;
}

.cf-markdown-preview ul {
  list-style: disc;
}

.cf-markdown-preview ol {
  list-style: decimal;
}

.cf-markdown-preview li {
  margin: 0.35rem 0;
  padding-left: 0.25rem;
}

.cf-markdown-preview code {
  border: 1px solid rgb(38 38 38);
  border-radius: 0.45rem;
  background: rgb(10 10 10);
  color: rgb(245 245 245);
  padding: 0.12rem 0.35rem;
  font-size: 0.92em;
}

.cf-markdown-preview pre {
  margin: 1rem 0;
  overflow: auto;
  border: 1px solid rgb(23 23 23);
  border-radius: 1rem;
  background: rgba(0, 0, 0, 0.72);
  padding: 1rem;
  color: rgb(229 229 229);
  font-size: 0.8125rem;
  line-height: 1.55;
}

.cf-markdown-preview pre code {
  border: 0;
  border-radius: 0;
  background: transparent;
  color: inherit;
  padding: 0;
  font-size: inherit;
}

.cf-markdown-preview blockquote {
  margin: 1rem 0;
  border-left: 2px solid rgb(82 82 82);
  padding-left: 1rem;
  color: rgb(163 163 163);
}

.cf-markdown-preview table {
  width: 100%;
  margin: 1rem 0;
  border-collapse: collapse;
  overflow: hidden;
  border: 1px solid rgb(38 38 38);
  border-radius: 0.75rem;
}

.cf-markdown-preview th,
.cf-markdown-preview td {
  border: 1px solid rgb(38 38 38);
  padding: 0.65rem 0.75rem;
  text-align: left;
}

.cf-markdown-preview th {
  background: rgb(10 10 10);
  color: white;
}

.cf-markdown-preview hr {
  margin: 2rem 0;
  border: 0;
  border-top: 1px solid rgb(38 38 38);
}
`;

const PAGE_TRANSITION = {
  duration: 0.2,
  ease: [0.16, 1, 0.3, 1],
} as const;

function truncateForGitHubIssue(value: string, maxLength = 52000) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength).trimEnd()}\n\n<!-- ContextForge truncated this Task Pack preview before sending it to GitHub. Export the full .md from ContextForge if needed. -->`;
}

function getDefaultGitHubIssueTitle(taskPack: TaskPack) {
  const sourceIssue = taskPack.generationRecipe?.githubIssue;

  if (sourceIssue) {
    return `Follow-up for issue #${sourceIssue.issueNumber}: ${sourceIssue.issueTitle}`.slice(
      0,
      256,
    );
  }

  return taskPack.title.slice(0, 256);
}

function getSuggestedGitHubLabels(taskPack: TaskPack) {
  return Array.from(
    new Set(
      ["contextforge", taskPack.taskType]
        .concat(taskPack.generationRecipe?.githubIssue?.labels ?? [])
        .map((label) => label.trim().toLowerCase())
        .filter(Boolean),
    ),
  ).slice(0, 8);
}

function buildClarificationsMarkdown(taskPack: TaskPack) {
  const clarifications = taskPack.generationRecipe?.taskClarifications ?? [];

  if (clarifications.length === 0) {
    return null;
  }

  return [
    "## User Clarifications",
    "",
    ...clarifications.flatMap((item, index) => [
      `### Clarification ${index + 1}`,
      "",
      `Question: ${item.question}`,
      "",
      `Answer: ${item.answer}`,
      "",
    ]),
  ].join("\n");
}

function buildDefaultGitHubIssueBody(taskPack: TaskPack) {
  const sourceIssue = taskPack.generationRecipe?.githubIssue;
  const createdAt = new Date().toISOString();
  const prompt = truncateForGitHubIssue(taskPack.generatedPrompt ?? "");

  return [
    "## ContextForge Task Pack",
    "",
    `Task Pack: #${taskPack.id} — ${taskPack.title}`,
    `Project: ${taskPack.projectName ?? `Project #${taskPack.projectId}`}`,
    `Task type: ${taskPack.taskType}`,
    `Target: ${taskPack.targetTool}`,
    `Generated: ${taskPack.createdAt}`,
    `GitHub issue draft created: ${createdAt}`,
    "",
    sourceIssue
      ? `Source issue: ${sourceIssue.fullName}#${sourceIssue.issueNumber} — ${sourceIssue.issueUrl}`
      : null,
    "",
    "## Original Task",
    "",
    taskPack.rawTask,
    "",
    buildClarificationsMarkdown(taskPack),
    "",
    "## Generated Task Pack",
    "",
    "<details>",
    "<summary>Open generated prompt</summary>",
    "",
    prompt,
    "",
    "</details>",
    "",
    "---",
    "Created from ContextForge. Project source files stay local; this issue contains only the generated task brief.",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

async function openGitHubUrl(url: string) {
  if (window.contextforge?.openExternalUrl) {
    await window.contextforge.openExternalUrl(url);
    return;
  }

  window.open(url, "_blank", "noopener,noreferrer");
}

function CreateGitHubIssueModal({
  taskPack,
  onClose,
  onCreated,
}: {
  taskPack: TaskPack;
  onClose: () => void;
  onCreated: (taskPack: TaskPack) => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(() => getDefaultGitHubIssueTitle(taskPack));
  const [body, setBody] = useState(() => buildDefaultGitHubIssueBody(taskPack));
  const [labelsText, setLabelsText] = useState(() =>
    getSuggestedGitHubLabels(taskPack).join(", "),
  );
  const [message, setMessage] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const labels = useMemo(
    () =>
      Array.from(
        new Set(
          labelsText
            .split(",")
            .map((label) => label.trim())
            .filter(Boolean),
        ),
      ).slice(0, 20),
    [labelsText],
  );

  async function handleCreateIssue() {
    if (!title.trim() || !body.trim()) {
      setMessage(t("taskPackResult.issueRequired"));
      return;
    }

    try {
      setIsCreating(true);
      setMessage(t("taskPackResult.issueCreating"));

      const result = await createGitHubIssueFromTaskPack(taskPack.id, {
        title: title.trim(),
        body: body.trim(),
        labels,
      });

      onCreated(result.taskPack);
      setMessage(
        t("taskPackResult.issueCreated", { number: result.issue.number }),
      );
      await openGitHubUrl(result.issue.htmlUrl);
      onClose();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : t("taskPackResult.issueCreateFailed"),
      );
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <Modal
      title={t("taskPackResult.createIssueTitle")}
      eyebrow={t("taskPackResult.githubIssueEyebrow")}
      maxWidth="max-w-5xl"
      onClose={onClose}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <p className="text-xs leading-5 text-neutral-500">
            {t("taskPackResult.issuePrivacy")}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} disabled={isCreating}>
              {t("taskPackResult.cancel")}
            </Button>
            <Button
              variant="primary"
              onClick={handleCreateIssue}
              disabled={isCreating || !title.trim() || !body.trim()}
            >
              {isCreating ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Github size={15} />
              )}
              {t("taskPackResult.createIssue")}
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid gap-5 p-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <label className="block">
            <span className="cf-tech-label text-[10px] uppercase text-neutral-600">
              {t("taskPackResult.issueTitle")}
            </span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value.slice(0, 256))}
              className="mt-2 w-full rounded-2xl border border-neutral-800 bg-black/40 px-4 py-3 text-sm font-medium text-white outline-none transition placeholder:text-neutral-700 focus:border-white/25"
              placeholder={t("taskPackResult.issueTitlePlaceholder")}
            />
          </label>

          <label className="block">
            <span className="cf-tech-label text-[10px] uppercase text-neutral-600">
              {t("taskPackResult.issueLabels")}
            </span>
            <input
              value={labelsText}
              onChange={(event) => setLabelsText(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-neutral-800 bg-black/40 px-4 py-3 text-sm text-white outline-none transition placeholder:text-neutral-700 focus:border-white/25"
              placeholder="contextforge, ui, bug"
            />
          </label>

          <label className="block">
            <span className="cf-tech-label text-[10px] uppercase text-neutral-600">
              {t("taskPackResult.issueBody")}
            </span>
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value.slice(0, 60000))}
              className="mt-2 h-[420px] w-full resize-none rounded-2xl border border-neutral-800 bg-black/45 px-4 py-3 font-mono text-xs leading-6 text-neutral-200 outline-none transition placeholder:text-neutral-700 focus:border-white/25"
              placeholder={t("taskPackResult.issueBodyPlaceholder")}
            />
          </label>
        </div>

        <aside className="space-y-3">
          <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
            <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
              {t("taskPackResult.destination")}
            </p>
            <p className="mt-2 text-sm font-semibold text-white">
              {t("taskPackResult.linkedRepository")}
            </p>
            <p className="mt-1 text-xs leading-5 text-neutral-500">
              {t("taskPackResult.linkedRepositoryDescription")}
            </p>
          </div>

          <div className="rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.055] p-4">
            <p className="cf-tech-label text-[10px] uppercase text-emerald-300/80">
              {t("taskPackResult.sourceSafety")}
            </p>
            <p className="mt-2 text-xs leading-5 text-emerald-100/75">
              {t("taskPackResult.sourceSafetyDescription")}
            </p>
          </div>

          <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
            <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
              {t("taskPackResult.issuePreviewStats")}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-xl border border-neutral-900 bg-black/35 p-3">
                <p className="text-neutral-600">
                  {t("taskPackResult.issueLabels")}
                </p>
                <p className="mt-1 font-semibold text-white">{labels.length}</p>
              </div>
              <div className="rounded-xl border border-neutral-900 bg-black/35 p-3">
                <p className="text-neutral-600">
                  {t("taskPackResult.issueBody")}
                </p>
                <p className="mt-1 font-semibold text-white">
                  {body.length.toLocaleString()}
                </p>
              </div>
            </div>
          </div>

          {message && (
            <div className="rounded-2xl border border-neutral-800 bg-black/45 p-4 text-xs leading-5 text-neutral-300">
              {message}
            </div>
          )}
        </aside>
      </div>
    </Modal>
  );
}

type TaskPackEditorView = "edit" | "preview";

function TaskPackEditorDrawer({
  session,
  onClose,
  onSave,
  onOpenInBuilder,
  canEdit,
  editExplanation,
}: {
  session: TaskPackEditorSession;
  canEdit: boolean;
  editExplanation: string;
  onClose: () => void;
  onSave: (input: {
    expectedCurrentRevisionId: number;
    rawTask?: string;
    generatedPrompt?: string;
  }) => Promise<TaskPack>;
  onOpenInBuilder?: (taskPack: TaskPack) => void;
}) {
  const { t } = useTranslation();
  const { kind, sourceValue, taskPack } = session;
  const [value, setValue] = useState(sourceValue);
  const [editorView, setEditorView] = useState<TaskPackEditorView>("edit");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSaving) onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSaving, onClose]);

  const trimmedValue = value.trim();
  const hasChanges = value !== sourceValue;
  const minimumLength = kind === "task" ? 3 : 3;
  const canSave = canEdit && trimmedValue.length >= minimumLength && hasChanges && !isSaving;
  const viewItems = [
    {
      id: "edit" as const,
      label: t("taskPackResult.editorEdit"),
      caption: t("taskPackResult.editorEditCaption"),
      icon: <Edit3 size={14} />,
    },
    {
      id: "preview" as const,
      label: t("taskPackResult.editorPreview"),
      caption: t("taskPackResult.editorPreviewCaption"),
      icon: <Eye size={14} />,
    },
  ];

  async function saveCurrentValue() {
    if (!canEdit) throw new Error(editExplanation);
    if (!canSave) return taskPack;

    setIsSaving(true);
    setError("");

    try {
      return await onSave(
        buildTaskPackEditorUpdate(session, trimmedValue),
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : t("taskPackResult.editorSaveFailed"),
      );
      throw saveError;
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSave() {
    try {
      await saveCurrentValue();
      onClose();
    } catch {
      // Error is displayed in the drawer.
    }
  }

  async function handleOpenBuilder() {
    if (!onOpenInBuilder) return;

    try {
      const updatedTaskPack = hasChanges
        ? await saveCurrentValue()
        : taskPack;
      onOpenInBuilder(updatedTaskPack);
    } catch {
      // Error is displayed in the drawer.
    }
  }

  return (
    <>
      <motion.div
        className="fixed inset-y-[42px] right-0 z-[88] w-full bg-black/65 backdrop-blur-[3px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={isSaving ? undefined : onClose}
      />

      <motion.aside
        className="fixed bottom-0 right-0 top-[42px] z-[90] w-[min(860px,calc(100vw-24px))] overflow-hidden border-l border-white/10 bg-black/98 shadow-[0_0_110px_rgba(0,0,0,0.92)] backdrop-blur-2xl"
        initial={{ opacity: 0, x: 48 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 48 }}
        transition={{ type: "spring", stiffness: 430, damping: 40, mass: 0.7 }}
      >
        <div className="flex h-full min-h-0 flex-col">
          <header className="shrink-0 border-b border-neutral-900 bg-black/96 px-5 py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="cf-tech-label text-[9px] uppercase text-neutral-700">
                  {t("taskPackResult.editorEyebrow")}
                </p>
                <h2 className="mt-1 truncate text-xl font-semibold tracking-[-0.04em] text-white">
                  {kind === "task"
                    ? t("taskPackResult.editTaskTitle")
                    : t("taskPackResult.editPromptTitle")}
                </h2>
                <p className="mt-1 text-xs text-neutral-600">
                  {kind === "task"
                    ? t("taskPackResult.editTaskDescription")
                    : t("taskPackResult.editPromptDescription")}
                </p>
              </div>

              <button
                type="button"
                onClick={onClose}
                disabled={isSaving}
                className="grid size-10 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-500 transition hover:border-white hover:bg-white hover:text-black disabled:opacity-50"
                aria-label={t("taskPackResult.closeEditor")}
              >
                <X size={16} />
              </button>
            </div>

            {kind === "prompt" ? (
              <HorizontalSlidingSelector
                items={viewItems}
                activeIndex={viewItems.findIndex((item) => item.id === editorView)}
                getItemKey={(item) => item.id}
                onSelect={(item) => setEditorView(item.id)}
                renderItem={(item, active) => (
                  <span className="flex min-h-11 items-center justify-center gap-2 px-3">
                    <span
                      className={[
                        "grid size-7 shrink-0 place-items-center rounded-xl border",
                        active
                          ? "border-black/10 bg-black/5 text-black"
                          : "border-neutral-800 bg-neutral-950 text-neutral-500",
                      ].join(" ")}
                    >
                      {item.icon}
                    </span>
                    <span className="min-w-0 text-left">
                      <span
                        className={[
                          "block truncate text-xs font-semibold",
                          active ? "text-black" : "text-current",
                        ].join(" ")}
                      >
                        {item.label}
                      </span>
                      <span
                        className={[
                          "mt-0.5 block truncate text-[10px]",
                          active ? "text-black/55" : "text-neutral-700",
                        ].join(" ")}
                      >
                        {item.caption}
                      </span>
                    </span>
                  </span>
                )}
                className="mt-4"
                ariaLabel={t("taskPackResult.editorViewMode")}
              />
            ) : null}
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {!canEdit ? <p role="status" className="mb-4 rounded-xl border border-amber-300/15 bg-amber-400/[0.05] p-3 text-xs leading-5 text-amber-100">{editExplanation}</p> : null}
            <section className="mb-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
                <p className="cf-tech-label text-[9px] uppercase text-neutral-700">
                  {t("taskPackResult.editorCharacters")}
                </p>
                <p className="mt-2 text-lg font-semibold text-white">
                  {value.length.toLocaleString()}
                </p>
              </div>
              <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
                <p className="cf-tech-label text-[9px] uppercase text-neutral-700">
                  {t("taskPackResult.editorState")}
                </p>
                <p className="mt-2 text-sm font-semibold text-white">
                  {hasChanges
                    ? t("taskPackResult.editorChanged")
                    : taskPack.updatedAt !== taskPack.createdAt
                      ? t("taskPackResult.editorSavedLocal")
                      : t("taskPackResult.editorUnchanged")}
                </p>
              </div>
              <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
                <p className="cf-tech-label text-[9px] uppercase text-neutral-700">
                  {t("taskPackResult.editorStorage")}
                </p>
                <p className="mt-2 text-sm font-semibold text-white">
                  {t("taskPackResult.editorLocal")}
                </p>
              </div>
            </section>

            <div className="mb-4 flex items-start gap-3 rounded-2xl border border-amber-400/15 bg-amber-400/[0.055] px-4 py-3 text-xs leading-5 text-amber-100/75">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-300" />
              <span>
                {kind === "task"
                  ? t("taskPackResult.editTaskNotice")
                  : t("taskPackResult.editPromptNotice")}
              </span>
            </div>

            {error ? (
              <div className="mb-4 rounded-2xl border border-red-400/20 bg-red-400/[0.055] px-4 py-3 text-xs leading-5 text-red-200">
                {error}
              </div>
            ) : null}

            <AnimatePresence mode="wait" initial={false}>
              {kind === "task" || editorView === "edit" ? (
                <motion.div
                  key="editor"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={PAGE_TRANSITION}
                  className="overflow-hidden rounded-[1.5rem] border border-neutral-900 bg-black/40 p-2.5"
                >
                  <textarea
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                    spellCheck={kind === "task"}
                    className={[
                      "w-full resize-none rounded-[1.05rem] border border-transparent bg-black/55 p-5 outline-none transition placeholder:text-neutral-700 focus:border-white/10",
                      kind === "task"
                        ? "h-[430px] text-sm leading-7 text-white"
                        : "h-[560px] font-mono text-xs leading-6 text-neutral-200",
                    ].join(" ")}
                    placeholder={
                      kind === "task"
                        ? t("taskPackResult.editTaskPlaceholder")
                        : t("taskPackResult.editPromptPlaceholder")
                    }
                  />
                </motion.div>
              ) : (
                <motion.article
                  key="preview"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={PAGE_TRANSITION}
                  className="min-h-[560px] rounded-[1.5rem] border border-neutral-900 bg-neutral-950/45 px-7 py-6"
                >
                  <div className="cf-markdown-preview mx-auto max-w-4xl">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {value}
                    </ReactMarkdown>
                  </div>
                </motion.article>
              )}
            </AnimatePresence>
          </div>

          <footer className="shrink-0 border-t border-neutral-900 bg-black/96 px-5 py-3.5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-neutral-600">
                {hasChanges
                  ? t("taskPackResult.editorUnsaved")
                  : t("taskPackResult.editorNoChanges")}
              </p>

              <div className="flex flex-wrap items-center justify-end gap-2">
                {hasChanges ? (
                  <Button
                    variant="secondary"
                    onClick={() => setValue(sourceValue)}
                    disabled={isSaving}
                  >
                    <RotateCcw size={15} />
                    {t("taskPackResult.editorReset")}
                  </Button>
                ) : null}

                <Button variant="secondary" onClick={onClose} disabled={isSaving}>
                  {t("taskPackResult.cancel")}
                </Button>

                {kind === "task" && onOpenInBuilder ? (
                  <Button
                    variant="secondary"
                    onClick={handleOpenBuilder}
                    disabled={isSaving || trimmedValue.length < minimumLength || (hasChanges && !canEdit)}
                  >
                    <Wrench size={15} />
                    {t("taskPackResult.openInBuilder")}
                  </Button>
                ) : null}

                <Button variant="primary" onClick={handleSave} disabled={!canSave}>
                  {isSaving ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <Save size={15} />
                  )}
                  {t("taskPackResult.saveLocalEdit")}
                </Button>
              </div>
            </div>
          </footer>
        </div>
      </motion.aside>
    </>
  );
}

export function TaskPackResultPage({
  taskPack,
  onClose,
  onOpenArchive,
  onInspectTaskPack,
  onTaskPackUpdated,
  onWorkflowActivity,
  onOpenInBuilder,
  freshness,
  onReviewProject,
}: TaskPackResultPageProps) {
  const { t } = useTranslation();
  const [workspaceView, setWorkspaceView] = useState<TaskPackWorkspaceView>("document");
  const [viewMode, setViewMode] = useState<PromptViewMode>("preview");
  const [isCopied, setIsCopied] = useState(false);
  const [currentTaskPack, setCurrentTaskPack] = useState(taskPack);
  const [isCreateIssueOpen, setIsCreateIssueOpen] = useState(false);
  const [isSelectorDiagnosticsOpen, setIsSelectorDiagnosticsOpen] = useState(false);
  const [isGenerationDiagnosticsOpen, setIsGenerationDiagnosticsOpen] = useState(false);
  const [isPerformanceDiagnosticsOpen, setIsPerformanceDiagnosticsOpen] = useState(false);
  const [editorSession, setEditorSession] = useState<TaskPackEditorSession | null>(null);
  const [editorOpenError, setEditorOpenError] = useState("");
  const workflowController = useTaskPackWorkflow(taskPack.id,
    currentTaskPack.id === taskPack.id ? currentTaskPack.currentRevisionId : taskPack.currentRevisionId);
  const { workflow } = workflowController;
  const revisionHistory = useTaskPackRevisionHistory(taskPack.id);
  const canEdit = currentTaskPack.id === taskPack.id && workflow?.taskPackId === currentTaskPack.id &&
    workflow.lifecycle.state === "active" && !workflowController.blocked && !workflowController.loading &&
    !workflowController.refreshing && !workflowController.activeAction;
  const editExplanation = canEdit ? "" : t(workflowController.blocked || workflowController.loading || !workflow
    ? "taskPackWorkflow.editUnavailable" : workflow.lifecycle.state === "completed"
      ? "taskPackWorkflow.editCompleted" : workflow.lifecycle.state === "archived"
        ? "taskPackWorkflow.editArchived" : "taskPackWorkflow.editPending");
  const editAuthority = useRef({ taskPackId: currentTaskPack.id, canEdit, revisionId: workflow?.currentRevisionId });
  editAuthority.current = { taskPackId: currentTaskPack.id, canEdit, revisionId: workflow?.currentRevisionId };

  useEffect(() => {
    setCurrentTaskPack(taskPack);
  }, [taskPack]);

  useEffect(() => { setWorkspaceView("document"); }, [taskPack.id]);

  const generatedPrompt = currentTaskPack.generatedPrompt ?? "";
  const sourceIssue = currentTaskPack.generationRecipe?.githubIssue;
  const createdIssue = currentTaskPack.generationRecipe?.githubCreatedIssue;
  const selectorDiagnostics = currentTaskPack.generationRecipe?.selectorDiagnostics;
  const generationDiagnostics = currentTaskPack.generationRecipe?.generationDiagnostics;
  const performanceDiagnostics = currentTaskPack.generationRecipe?.performanceDiagnostics;
  const secondaryActions = useMemo(() => {
    const actions: Array<{
      id: string;
      label: string;
      icon: ReactNode;
      onClick: () => void;
    }> = [
      { id: "open-archive", label: t("taskPackResult.openArchive"), icon: <Library size={14} />, onClick: onOpenArchive },
      { id: "inspect", label: t("inspector.inspect"), icon: <ScanSearch size={14} />, onClick: () => onInspectTaskPack(currentTaskPack) },
    ];

    if (onOpenInBuilder) {
      actions.push({ id: "open-in-builder", label: t("taskPackResult.openInBuilder"),
        icon: <Wrench size={14} />, onClick: () => onOpenInBuilder(currentTaskPack) });
    }

    if (sourceIssue) {
      actions.push({
        id: "source-issue",
        label: t("taskPackResult.sourceIssue"),
        icon: <ExternalLink size={14} />,
        onClick: () => void openGitHubUrl(sourceIssue.issueUrl),
      });
    }

    if (createdIssue) {
      actions.push({
        id: "created-issue",
        label: t("taskPackResult.openCreatedIssue"),
        icon: <ExternalLink size={14} />,
        onClick: () => void openGitHubUrl(createdIssue.issueUrl),
      });
    } else {
      actions.push({
        id: "create-issue",
        label: t("taskPackResult.createIssue"),
        icon: <Github size={14} />,
        onClick: () => setIsCreateIssueOpen(true),
      });
    }

    if (selectorDiagnostics) {
      actions.push({
        id: "selector-diagnostics",
        label: t("taskPackResult.selectorDiagnostics"),
        icon: <ShieldCheck size={14} />,
        onClick: () => setIsSelectorDiagnosticsOpen(true),
      });
    }

    if (generationDiagnostics) {
      actions.push({
        id: "generation-diagnostics",
        label: t("taskPackResult.generationDiagnostics"),
        icon: <Bot size={14} />,
        onClick: () => setIsGenerationDiagnosticsOpen(true),
      });
    }

    if (performanceDiagnostics) {
      actions.push({
        id: "performance-diagnostics",
        label: t("taskPackResult.performanceDiagnostics"),
        icon: <Activity size={14} />,
        onClick: () => setIsPerformanceDiagnosticsOpen(true),
      });
    }

    return actions;
  }, [
    currentTaskPack,
    onOpenInBuilder,
    onOpenArchive,
    onInspectTaskPack,
    createdIssue,
    generationDiagnostics,
    performanceDiagnostics,
    selectorDiagnostics,
    sourceIssue,
    t,
  ]);

  function handleTaskPackUpdated(nextTaskPack: TaskPack) {
    setCurrentTaskPack(nextTaskPack);
    onTaskPackUpdated?.(nextTaskPack);
  }

  async function handleOpenEditor(kind: TaskPackEditorKind) {
    setEditorOpenError("");
    if (!canEdit) { setEditorOpenError(editExplanation); return; }
    try {
      let taskPackForSession = currentTaskPack;
      if (
        !Number.isSafeInteger(taskPackForSession.currentRevisionId) ||
        (taskPackForSession.currentRevisionId ?? 0) <= 0
      ) {
        taskPackForSession = await getTaskPack(currentTaskPack.id);
        if (!editAuthority.current.canEdit || editAuthority.current.taskPackId !== taskPackForSession.id) return;
        handleTaskPackUpdated(taskPackForSession);
      }
      if (taskPackForSession.currentRevisionId !== editAuthority.current.revisionId) {
        setEditorOpenError(t("taskPackWorkflow.issues.revision_changed"));
        return;
      }
      setEditorSession(createTaskPackEditorSession(taskPackForSession, kind));
    } catch (error) {
      setEditorOpenError(
        error instanceof Error
          ? error.message
          : t("taskPackResult.editorSaveFailed"),
      );
    }
  }

  async function handleSaveEditor(
    session: TaskPackEditorSession,
    input: {
      expectedCurrentRevisionId: number;
      rawTask?: string;
      generatedPrompt?: string;
    },
  ) {
    if (!editAuthority.current.canEdit || editAuthority.current.taskPackId !== session.taskPackId) {
      throw new Error(t("taskPackWorkflow.editUnavailable"));
    }
    if (input.expectedCurrentRevisionId !== session.expectedCurrentRevisionId) {
      throw new Error("Task Pack editor revision token changed unexpectedly.");
    }
    const nextTaskPack = await updateTaskPackContent(session.taskPackId, input);
    handleTaskPackUpdated(nextTaskPack);
    return nextTaskPack;
  }

  async function handleCopyPrompt() {
    await navigator.clipboard.writeText(generatedPrompt);
    setIsCopied(true);

    window.setTimeout(() => {
      setIsCopied(false);
    }, 1400);
  }

  return (
    <section className="grid h-[calc(100vh-96px)] min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-4 overflow-hidden pr-1">
      <style>{MARKDOWN_PREVIEW_STYLES}</style>

      <TaskPackWorkspaceHeader taskPack={currentTaskPack}
        workflow={workflowController.blocked ? null : workflow}
        view={workspaceView} onViewChange={setWorkspaceView} onBack={onClose}
        onCopy={handleCopyPrompt} isCopied={isCopied} actions={secondaryActions} editorOpenError={editorOpenError} />

      {/* Keep view instances alive: switching surfaces does not reset scroll, preview or confirmation state. */}
      <main className="min-h-0 min-w-0 overflow-hidden">
        <div hidden={workspaceView !== "document"} className={workspaceView === "document" ? "h-full min-h-0" : "hidden"}>
          <TaskPackDocumentView taskPack={currentTaskPack} viewMode={viewMode} onViewModeChange={setViewMode}
            freshness={freshness} onReviewProject={() => onReviewProject(currentTaskPack.projectId)}
            onEdit={() => void handleOpenEditor("prompt")} canEdit={canEdit} editExplanation={editExplanation} />
        </div>
        <div hidden={workspaceView !== "review"} className={workspaceView === "review" ? "h-full min-h-0 overflow-y-auto pr-1" : "hidden"}
          data-task-pack-view="review" aria-label={t("taskPackWorkspace.review")}>
          <div className="mx-auto max-w-6xl px-2 pb-6 sm:px-4">
            <TaskPackWorkflowCard key={`${taskPack.id}:${currentTaskPack.currentRevisionId ?? "unknown"}`}
              {...workflowController} disabled={editorSession !== null}
              onRefresh={() => refreshTaskPackWorkflowProjectionAfterActivity(workflowController.refresh, onWorkflowActivity)}
              onExecute={(operation) => refreshTaskPackWorkflowProjectionAfterActivity(() => workflowController.execute(operation), onWorkflowActivity)}
              onClearIssue={workflowController.clearIssue} />
            <TaskPackRevisionHistoryPanel {...revisionHistory} onRefresh={revisionHistory.refresh}
              onRetryHistory={revisionHistory.retryHistory} onSelectRevision={revisionHistory.selectRevision}
              onRetryDetail={revisionHistory.retryDetail} onStartComparison={revisionHistory.startComparison}
              onChooseComparisonRevision={revisionHistory.chooseComparisonRevision} onCompareSelectedRevisions={revisionHistory.compareSelectedRevisions}
              onSwapComparisonSides={revisionHistory.swapComparisonSides} onClearComparison={revisionHistory.clearComparison}
              onRetryComparison={revisionHistory.retryComparison} />
          </div>
        </div>
        <div hidden={workspaceView !== "details"} className={workspaceView === "details" ? "h-full min-h-0" : "hidden"}>
          <TaskPackDetailsView taskPack={currentTaskPack} freshness={freshness}
            onReviewProject={() => onReviewProject(currentTaskPack.projectId)}
            onEditOriginal={() => void handleOpenEditor("task")} onOpenGitHubUrl={(url) => void openGitHubUrl(url)}
            canEdit={canEdit} editExplanation={editExplanation} />
        </div>
      </main>

      {isCreateIssueOpen && (
        <CreateGitHubIssueModal
          taskPack={currentTaskPack}
          onClose={() => setIsCreateIssueOpen(false)}
          onCreated={handleTaskPackUpdated}
        />
      )}

      {isSelectorDiagnosticsOpen && selectorDiagnostics && (
        <SelectorDiagnosticsModal
          diagnostics={selectorDiagnostics}
          onClose={() => setIsSelectorDiagnosticsOpen(false)}
        />
      )}

      {isGenerationDiagnosticsOpen && generationDiagnostics && (
        <GenerationDiagnosticsModal
          diagnostics={generationDiagnostics}
          onClose={() => setIsGenerationDiagnosticsOpen(false)}
        />
      )}

      {isPerformanceDiagnosticsOpen && performanceDiagnostics && (
        <PerformanceDiagnosticsModal
          diagnostics={performanceDiagnostics}
          onClose={() => setIsPerformanceDiagnosticsOpen(false)}
        />
      )}
      <AnimatePresence>
        {editorSession ? (
          <TaskPackEditorDrawer
            key={`${editorSession.taskPackId}:${editorSession.expectedCurrentRevisionId}:${editorSession.kind}`}
            session={editorSession}
            canEdit={canEdit}
            editExplanation={editExplanation}
            onClose={() => setEditorSession(null)}
            onSave={(input) => handleSaveEditor(editorSession, input)}
            onOpenInBuilder={onOpenInBuilder}
          />
        ) : null}
      </AnimatePresence>
    </section>
  );
}
