import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Activity,
  AlertTriangle,
  Archive,
  ArrowLeft,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  Clipboard,
  Clock3,
  Code2,
  Copy,
  Eye,
  Edit3,
  ExternalLink,
  FileText,
  Github,
  ListChecks,
  Loader2,
  MoreHorizontal,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  Target,
  Wrench,
  X,
} from "lucide-react";

import type { TaskPack } from "../types";
import {
  createGitHubIssueFromTaskPack,
  updateTaskPackContent,
} from "../api/client";
import { AiToolLogo } from "../components/ai/AiToolLogo";
import { TaskPackExportActions } from "../components/taskPacks/TaskPackExportActions";
import { Button } from "../components/ui/Button";
import { Modal } from "../components/ui/Modal";
import { HorizontalSlidingSelector } from "../components/ui/SlidingSelectors";
import { SelectorDiagnosticsModal } from "../components/selector/SelectorDiagnosticsModal";
import { GenerationDiagnosticsModal } from "../components/generation/GenerationDiagnosticsModal";
import { PerformanceDiagnosticsModal } from "../components/performance/PerformanceDiagnosticsModal";

interface TaskPackResultPageProps {
  taskPack: TaskPack;
  onClose: () => void;
  onOpenArchive: () => void;
  onTaskPackUpdated?: (taskPack: TaskPack) => void;
  onOpenInBuilder?: (taskPack: TaskPack) => void;
}

type PromptViewMode = "preview" | "raw";

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

const TARGET_LABELS: Record<string, string> = {
  codex: "Codex",
  cursor: "Cursor",
  claude: "Claude Code",
  claudecode: "Claude Code",
  gemini: "Gemini",
  generic: "Generic",
};

const TASK_TYPE_KEYS: Record<string, string> = {
  general: "taskPackResult.taskTypes.general",
  ui: "taskPackResult.taskTypes.ui",
  backend: "taskPackResult.taskTypes.backend",
  fullstack: "taskPackResult.taskTypes.fullstack",
  build: "taskPackResult.taskTypes.build",
  bugfix: "taskPackResult.taskTypes.bugfix",
  refactor: "taskPackResult.taskTypes.refactor",
  docs: "taskPackResult.taskTypes.docs",
  tests: "taskPackResult.taskTypes.tests",
};

function formatDuration(
  durationMs: number | null | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  if (!durationMs) {
    return t("taskPackResult.noDuration");
  }

  if (durationMs < 1000) {
    return t("taskPackResult.milliseconds", { value: durationMs });
  }

  return t("taskPackResult.seconds", {
    value: (durationMs / 1000).toFixed(1),
  });
}

function formatDate(value: string, language: string) {
  return new Date(value).toLocaleString(
    language.toLowerCase().startsWith("ru") ? "ru-RU" : "en-US",
    {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    },
  );
}

function getTargetLabel(value: string) {
  return TARGET_LABELS[String(value).toLowerCase()] ?? value;
}

function getTaskTypeLabel(
  value: string,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  const key = TASK_TYPE_KEYS[String(value).toLowerCase()];
  return key ? t(key) : value;
}

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

function Pill({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "success" | "warning";
}) {
  const className =
    tone === "success"
      ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
      : tone === "warning"
        ? "border-amber-400/20 bg-amber-400/10 text-amber-200"
        : "border-neutral-800 bg-neutral-950 text-neutral-400";

  return (
    <span
      className={[
        "inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium",
        className,
      ].join(" ")}
    >
      {children}
    </span>
  );
}

function MoreActionsMenu({
  actions,
  label,
}: {
  actions: Array<{
    id: string;
    label: string;
    icon: ReactNode;
    onClick: () => void;
    tone?: "default" | "accent";
  }>;
  label: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  if (actions.length === 0) {
    return null;
  }

  return (
    <div ref={menuRef} className="relative z-40">
      <Button
        variant="secondary"
        onClick={() => setIsOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        <MoreHorizontal size={15} />
        {label}
        <ChevronDown
          size={13}
          className={["transition-transform", isOpen ? "rotate-180" : ""].join(" ")}
        />
      </Button>

      {isOpen && (
        <motion.div
          role="menu"
          className="absolute right-0 top-[calc(100%+0.55rem)] z-50 w-[260px] overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-950/98 p-1.5 shadow-[0_22px_70px_rgba(0,0,0,0.72)] backdrop-blur-xl"
          initial={{ opacity: 0, y: -6, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={PAGE_TRANSITION}
        >
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              role="menuitem"
              onClick={() => {
                action.onClick();
                setIsOpen(false);
              }}
              className={[
                "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs font-medium transition",
                action.tone === "accent"
                  ? "text-white hover:bg-white/10"
                  : "text-neutral-400 hover:bg-white/[0.055] hover:text-white",
              ].join(" ")}
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-black/45 text-neutral-300">
                {action.icon}
              </span>
              <span className="min-w-0 flex-1 truncate">{action.label}</span>
            </button>
          ))}
        </motion.div>
      )}
    </div>
  );
}

function ViewModeSwitch({
  value,
  onChange,
  t,
}: {
  value: PromptViewMode;
  onChange: (value: PromptViewMode) => void;
  t: (key: string) => string;
}) {
  const options: Array<{
    value: PromptViewMode;
    label: string;
    icon: ReactNode;
  }> = [
    {
      value: "preview",
      label: t("taskPackResult.preview"),
      icon: <Eye size={14} />,
    },
    {
      value: "raw",
      label: t("taskPackResult.rawMarkdown"),
      icon: <Code2 size={14} />,
    },
  ];

  return (
    <HorizontalSlidingSelector
      items={options}
      activeIndex={options.findIndex((option) => option.value === value)}
      getItemKey={(option) => option.value}
      onSelect={(option) => onChange(option.value)}
      ariaLabel={t("taskPackResult.viewMode")}
      className="h-11 w-full sm:w-[310px]"
      itemClassName="rounded-[0.95rem]"
      renderItem={(option, isActive) => (
        <span className="flex h-full items-center justify-center gap-2 px-3">
          <span className={isActive ? "text-black" : "text-neutral-500"}>
            {option.icon}
          </span>
          <span className="truncate text-xs font-semibold">{option.label}</span>
        </span>
      )}
    />
  );
}

function SummaryMetric({
  icon,
  label,
  value,
  caption,
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  caption: string;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-neutral-900 bg-black/35 p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-300">
          {icon}
        </span>
        <span className="truncate text-sm font-semibold text-white">{value}</span>
      </div>
      <p className="cf-tech-label mt-3 truncate text-[9px] uppercase text-neutral-600">
        {label}
      </p>
      <p className="mt-1 truncate text-[10px] text-neutral-600">{caption}</p>
    </div>
  );
}

function MetadataRow({
  label,
  value,
  caption,
  icon,
}: {
  label: string;
  value: string;
  caption?: string;
  icon: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-neutral-900 bg-black/30 p-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-400">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="cf-tech-label truncate text-[9px] uppercase text-neutral-600">
          {label}
        </p>
        <p className="mt-1 truncate text-xs font-semibold text-white">{value}</p>
        {caption ? (
          <p className="mt-0.5 truncate text-[10px] text-neutral-600">{caption}</p>
        ) : null}
      </div>
    </div>
  );
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

function GenerationSummaryCard({ taskPack }: { taskPack: TaskPack }) {
  const { t, i18n } = useTranslation();
  const targetLabel = getTargetLabel(taskPack.targetTool);
  const taskTypeLabel = getTaskTypeLabel(taskPack.taskType, t);
  const modeLabel =
    taskPack.generationMode === "ollama"
      ? t("taskPackResult.ollamaMode")
      : t("taskPackResult.templateMode");

  return (
    <section className="rounded-[1.5rem] border border-neutral-900 bg-black/35 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
      <div className="flex items-center gap-3">
        <AiToolLogo
          tool={taskPack.targetTool === "claude" ? "claudecode" : taskPack.targetTool}
          size="lg"
          tone="monochrome"
        />
        <div className="min-w-0">
          <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
            {t("taskPackResult.generationSummary")}
          </p>
          <h2 className="mt-1 truncate text-base font-semibold text-white">
            {targetLabel} · {taskTypeLabel}
          </h2>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <SummaryMetric
          icon={<Target size={14} />}
          label={t("taskPackResult.target")}
          value={targetLabel}
          caption={t("taskPackResult.agent")}
        />
        <SummaryMetric
          icon={<Wrench size={14} />}
          label={t("taskPackResult.taskType")}
          value={taskTypeLabel}
          caption={t("taskPackResult.effective")}
        />
        <SummaryMetric
          icon={<Clock3 size={14} />}
          label={t("taskPackResult.duration")}
          value={formatDuration(taskPack.generationDurationMs, t)}
          caption={t("taskPackResult.generation")}
        />
        <SummaryMetric
          icon={<Bot size={14} />}
          label={t("taskPackResult.mode")}
          value={modeLabel}
          caption={
            taskPack.generationUsedFallback
              ? t("taskPackResult.fallback")
              : t("taskPackResult.stable")
          }
        />
      </div>

      <div className="mt-3 flex items-center gap-2 rounded-2xl border border-neutral-900 bg-black/25 px-3 py-2.5 text-[11px] text-neutral-600">
        <FileText size={13} className="shrink-0" />
        <span className="truncate">
          {t("taskPackResult.created", {
            date: formatDate(taskPack.createdAt, i18n.resolvedLanguage ?? i18n.language),
          })}
        </span>
      </div>
    </section>
  );
}

function OriginalTaskCard({
  taskPack,
  onEdit,
}: {
  taskPack: TaskPack;
  onEdit: () => void;
}) {
  const { t } = useTranslation();

  return (
    <section className="rounded-[1.5rem] border border-neutral-900 bg-black/35 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-300">
            <Clipboard size={15} />
          </span>
          <div className="min-w-0">
            <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
              {t("taskPackResult.originalTask")}
            </p>
            <h3 className="mt-1 truncate text-sm font-semibold text-white">
              {t("taskPackResult.originalTaskTitle")}
            </h3>
          </div>
        </div>

        <button
          type="button"
          onClick={onEdit}
          className="grid size-8 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-500 transition hover:border-white/20 hover:text-white"
          aria-label={t("taskPackResult.editOriginalTask")}
        >
          <Edit3 size={13} />
        </button>
      </div>

      <p className="mt-3 line-clamp-5 whitespace-pre-wrap text-xs leading-5 text-neutral-500">
        {taskPack.rawTask || t("taskPackResult.originalTaskEmpty")}
      </p>
    </section>
  );
}

function GenerationContractCard({ taskPack }: { taskPack: TaskPack }) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const recipe = taskPack.generationRecipe;

  if (!recipe) {
    return (
      <section className="rounded-[1.5rem] border border-neutral-900 bg-black/35 p-4">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-400">
            <ShieldCheck size={15} />
          </span>
          <div>
            <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
              {t("taskPackResult.generationContract")}
            </p>
            <h3 className="mt-1 text-sm font-semibold text-white">
              {t("taskPackResult.noRecipeMetadata")}
            </h3>
            <p className="mt-2 text-xs leading-5 text-neutral-600">
              {t("taskPackResult.noRecipeMetadataDescription")}
            </p>
          </div>
        </div>
      </section>
    );
  }

  const templateCaption = recipe.template
    ? `${getTargetLabel(recipe.template.targetTool)} · ${getTaskTypeLabel(recipe.template.taskType, t)} · ${
        recipe.template.isBuiltin
          ? t("taskPackResult.builtIn")
          : t("taskPackResult.custom")
      }`
    : t("taskPackResult.templateMissing");

  const profileCaption = recipe.ruleProfile
    ? `${getTaskTypeLabel(recipe.ruleProfile.taskType, t)} · ${
        recipe.ruleProfile.isBuiltin
          ? t("taskPackResult.builtIn")
          : t("taskPackResult.custom")
      }`
    : t("taskPackResult.profileMissing");

  return (
    <section className="rounded-[1.5rem] border border-neutral-900 bg-black/35 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-300">
            <ShieldCheck size={15} />
          </span>
          <div className="min-w-0">
            <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
              {t("taskPackResult.generationContract")}
            </p>
            <h3 className="mt-1 truncate text-sm font-semibold text-white">
              {t("taskPackResult.contractReady")}
            </h3>
            <p className="mt-1 text-[11px] leading-5 text-neutral-600">
              {t("taskPackResult.contractDescription")}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <MetadataRow
          icon={<FileText size={14} />}
          label={t("taskPackResult.template")}
          value={recipe.template?.name ?? t("taskPackResult.noTemplate")}
          caption={templateCaption}
        />
        <MetadataRow
          icon={<ListChecks size={14} />}
          label={t("taskPackResult.ruleProfile")}
          value={recipe.ruleProfile?.name ?? t("taskPackResult.noProfile")}
          caption={profileCaption}
        />
      </div>

      <button
        type="button"
        onClick={() => setIsExpanded((value) => !value)}
        className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-full border border-neutral-800 bg-neutral-950 text-xs font-medium text-neutral-400 transition hover:border-white/20 hover:text-white"
      >
        {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        {isExpanded
          ? t("taskPackResult.hideContractDetails")
          : t("taskPackResult.showContractDetails")}
      </button>

      {isExpanded && (
        <motion.div
          className="mt-4 space-y-3 border-t border-neutral-900 pt-4"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={PAGE_TRANSITION}
        >
          {recipe.taskClarifications && recipe.taskClarifications.length > 0 && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
              <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-white">
                <Sparkles size={13} />
                {t("taskPackResult.userClarifications")}
              </p>
              <div className="space-y-2">
                {recipe.taskClarifications.map((item, index) => (
                  <div
                    key={`${item.question}-${index}`}
                    className="rounded-xl border border-neutral-900 bg-black/35 p-3"
                  >
                    <p className="text-[10px] leading-4 text-neutral-600">
                      {item.question}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-neutral-300">
                      {item.answer}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {recipe.githubIssue && (
            <button
              type="button"
              onClick={() => openGitHubUrl(recipe.githubIssue!.issueUrl)}
              className="w-full rounded-2xl border border-neutral-900 bg-black/30 p-3 text-left transition hover:border-white/15"
            >
              <p className="flex items-center gap-2 text-xs font-semibold text-white">
                <Github size={13} />
                {t("taskPackResult.sourceIssue")}
              </p>
              <p className="mt-2 truncate text-xs text-neutral-400">
                #{recipe.githubIssue.issueNumber} · {recipe.githubIssue.issueTitle}
              </p>
              <p className="mt-1 truncate text-[10px] text-neutral-600">
                {recipe.githubIssue.fullName}
              </p>
            </button>
          )}

          {recipe.githubCreatedIssue && (
            <button
              type="button"
              onClick={() => openGitHubUrl(recipe.githubCreatedIssue!.issueUrl)}
              className="w-full rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.055] p-3 text-left transition hover:border-emerald-300/25"
            >
              <p className="flex items-center gap-2 text-xs font-semibold text-emerald-100">
                <ExternalLink size={13} />
                {t("taskPackResult.createdIssue")}
              </p>
              <p className="mt-2 truncate text-xs text-white">
                #{recipe.githubCreatedIssue.issueNumber} · {recipe.githubCreatedIssue.issueTitle}
              </p>
              <p className="mt-1 truncate text-[10px] text-emerald-100/60">
                {recipe.githubCreatedIssue.fullName}
              </p>
            </button>
          )}

          <div className="rounded-2xl border border-neutral-900 bg-black/30 p-3">
            <p className="text-xs font-semibold text-white">
              {t("taskPackResult.enabledRules")}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {recipe.enabledRules.length > 0 ? (
                recipe.enabledRules.map((rule) => (
                  <span
                    key={rule.id}
                    className="rounded-full border border-neutral-800 bg-neutral-950 px-2.5 py-1 text-[10px] text-neutral-400"
                  >
                    {rule.title}
                  </span>
                ))
              ) : (
                <span className="text-xs text-neutral-600">
                  {t("taskPackResult.noEnabledRules")}
                </span>
              )}
            </div>
          </div>

          {recipe.customRules.length > 0 && (
            <div className="rounded-2xl border border-neutral-900 bg-black/30 p-3">
              <p className="text-xs font-semibold text-white">
                {t("taskPackResult.customRules")}
              </p>
              <ul className="mt-3 space-y-2">
                {recipe.customRules.map((rule) => (
                  <li
                    key={rule}
                    className="rounded-xl border border-neutral-900 bg-black/35 px-3 py-2 text-[11px] leading-5 text-neutral-500"
                  >
                    {rule}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-2xl border border-neutral-900 bg-black/30 p-3">
            <p className="text-xs font-semibold text-white">
              {t("taskPackResult.acceptanceCriteria")}
            </p>
            {recipe.acceptanceCriteria.length > 0 ? (
              <ol className="mt-3 space-y-2">
                {recipe.acceptanceCriteria.map((criterion, index) => (
                  <li
                    key={criterion}
                    className="flex items-start gap-2 rounded-xl border border-neutral-900 bg-black/35 px-3 py-2 text-[11px] leading-5 text-neutral-500"
                  >
                    <span className="grid size-5 shrink-0 place-items-center rounded-full border border-neutral-800 text-[9px] text-neutral-500">
                      {index + 1}
                    </span>
                    <span>{criterion}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-3 text-xs text-neutral-600">
                {t("taskPackResult.noAcceptanceCriteria")}
              </p>
            )}
          </div>
        </motion.div>
      )}
    </section>
  );
}

function PromptPanel({
  viewMode,
  generatedPrompt,
}: {
  viewMode: PromptViewMode;
  generatedPrompt: string;
}) {
  return (
    <div className="h-full min-h-0 overflow-hidden rounded-[1.35rem] border border-neutral-900 bg-black/30 p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      {viewMode === "preview" ? (
        <motion.article
          key="preview"
          className="h-full min-h-0 overflow-y-auto rounded-[1rem] bg-neutral-950/45 px-6 py-5 text-sm"
          initial={{ opacity: 0, y: 8, scale: 0.995 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={PAGE_TRANSITION}
        >
          <div className="cf-markdown-preview mx-auto max-w-4xl">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {generatedPrompt}
            </ReactMarkdown>
          </div>
        </motion.article>
      ) : (
        <motion.pre
          key="raw"
          className="h-full min-h-0 overflow-y-auto whitespace-pre-wrap rounded-[1rem] bg-black/75 p-5 font-mono text-xs leading-6 text-neutral-300"
          initial={{ opacity: 0, y: 8, scale: 0.995 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={PAGE_TRANSITION}
        >
          {generatedPrompt}
        </motion.pre>
      )}
    </div>
  );
}


type TaskPackEditorKind = "task" | "prompt";
type TaskPackEditorView = "edit" | "preview";

function TaskPackEditorDrawer({
  kind,
  taskPack,
  onClose,
  onSave,
  onOpenInBuilder,
}: {
  kind: TaskPackEditorKind;
  taskPack: TaskPack;
  onClose: () => void;
  onSave: (input: {
    rawTask?: string;
    generatedPrompt?: string;
  }) => Promise<TaskPack>;
  onOpenInBuilder?: (taskPack: TaskPack) => void;
}) {
  const { t } = useTranslation();
  const sourceValue =
    kind === "task" ? taskPack.rawTask : taskPack.generatedPrompt;
  const [value, setValue] = useState(sourceValue);
  const [editorView, setEditorView] = useState<TaskPackEditorView>("edit");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setValue(sourceValue);
    setEditorView("edit");
    setError("");
  }, [kind, sourceValue]);

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
  const canSave = trimmedValue.length >= minimumLength && hasChanges && !isSaving;
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
    if (!canSave) return taskPack;

    setIsSaving(true);
    setError("");

    try {
      return await onSave(
        kind === "task"
          ? { rawTask: trimmedValue }
          : { generatedPrompt: trimmedValue },
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
                    disabled={isSaving || trimmedValue.length < minimumLength}
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
  onTaskPackUpdated,
  onOpenInBuilder,
}: TaskPackResultPageProps) {
  const { t } = useTranslation();
  const [viewMode, setViewMode] = useState<PromptViewMode>("preview");
  const [isCopied, setIsCopied] = useState(false);
  const [currentTaskPack, setCurrentTaskPack] = useState(taskPack);
  const [isCreateIssueOpen, setIsCreateIssueOpen] = useState(false);
  const [isSelectorDiagnosticsOpen, setIsSelectorDiagnosticsOpen] = useState(false);
  const [isGenerationDiagnosticsOpen, setIsGenerationDiagnosticsOpen] = useState(false);
  const [isPerformanceDiagnosticsOpen, setIsPerformanceDiagnosticsOpen] = useState(false);
  const [editorKind, setEditorKind] = useState<TaskPackEditorKind | null>(null);

  useEffect(() => {
    setCurrentTaskPack(taskPack);
  }, [taskPack]);

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
      tone?: "default" | "accent";
    }> = [];

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
        tone: "accent",
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

  async function handleSaveEditor(input: {
    rawTask?: string;
    generatedPrompt?: string;
  }) {
    const nextTaskPack = await updateTaskPackContent(currentTaskPack.id, input);
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

      <header className="relative z-30 shrink-0 overflow-visible rounded-[1.5rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.012))] shadow-[0_14px_44px_rgba(0,0,0,0.32),inset_0_1px_0_rgba(255,255,255,0.045)]">
        <div className="flex flex-col gap-4 p-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-neutral-600">
              <Sparkles size={13} />
              <p className="cf-tech-label text-[10px] uppercase">
                {t("taskPackResult.workspaceEyebrow", {
                  project:
                    currentTaskPack.projectName ??
                    t("taskPackResult.projectFallback", {
                      id: currentTaskPack.projectId,
                    }),
                })}
              </p>
              <Pill tone="success">
                <Check size={11} />
                {t("taskPackResult.ready")}
              </Pill>
            </div>

            <h1 className="mt-2 line-clamp-2 max-w-5xl text-[27px] font-semibold leading-[1.05] tracking-[-0.05em] text-white">
              {currentTaskPack.title}
            </h1>

            <p className="mt-2 max-w-4xl text-xs leading-5 text-neutral-500">
              {t("taskPackResult.workspaceDescription")}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap gap-2">
            <Button variant="secondary" onClick={onClose}>
              <ArrowLeft size={15} />
              {t("taskPackResult.back")}
            </Button>
            <Button variant="secondary" onClick={onOpenArchive}>
              <Archive size={15} />
              {t("taskPackResult.openArchive")}
            </Button>
            <Button variant="primary" onClick={handleCopyPrompt}>
              {isCopied ? <Check size={15} /> : <Copy size={15} />}
              {isCopied
                ? t("taskPackResult.copied")
                : t("taskPackResult.copyPrompt")}
            </Button>
            <MoreActionsMenu
              actions={secondaryActions}
              label={t("taskPackResult.moreActions")}
            />
          </div>
        </div>
      </header>

      <div className="grid min-h-0 gap-4 overflow-hidden xl:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="min-h-0 space-y-3 overflow-y-auto pr-1">
          <GenerationSummaryCard taskPack={currentTaskPack} />
          <OriginalTaskCard
            taskPack={currentTaskPack}
            onEdit={() => setEditorKind("task")}
          />
          <GenerationContractCard taskPack={currentTaskPack} />
        </aside>

        <main className="flex min-h-0 flex-col overflow-hidden rounded-[1.5rem] border border-neutral-900 bg-black/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
          <div className="flex shrink-0 flex-col gap-3 border-b border-neutral-900 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3 px-1">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-300">
                <FileText size={16} />
              </span>
              <div className="min-w-0">
                <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
                  {t("taskPackResult.documentEyebrow")}
                </p>
                <h2 className="mt-1 truncate text-sm font-semibold text-white">
                  {t("taskPackResult.documentTitle")}
                </h2>
                <p className="mt-0.5 truncate text-[10px] text-neutral-600">
                  {t("taskPackResult.documentCaption", {
                    chars: generatedPrompt.length.toLocaleString(),
                  })}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setEditorKind("prompt")}
                className="inline-flex h-9 items-center gap-2 rounded-full border border-neutral-800 bg-neutral-950 px-3 text-xs font-medium text-neutral-300 transition hover:border-white/20 hover:text-white"
              >
                <Edit3 size={13} />
                {t("taskPackResult.editTaskPack")}
              </button>
              <ViewModeSwitch value={viewMode} onChange={setViewMode} t={t} />
            </div>
          </div>

          <div className="min-h-0 flex-1 p-3">
            <PromptPanel viewMode={viewMode} generatedPrompt={generatedPrompt} />
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-neutral-900 px-4 py-2.5 text-[10px] text-neutral-600">
            <span className="flex items-center gap-2">
              <Check size={12} className="text-emerald-300" />
              {t("taskPackResult.contentReady")}
            </span>

            <div className="flex flex-wrap items-center gap-3">
              <span>{t("taskPackResult.localOnly")}</span>
              <span className="hidden h-4 w-px bg-neutral-900 sm:block" />
              <TaskPackExportActions taskPack={currentTaskPack} compact />
            </div>
          </div>
        </main>
      </div>

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
        {editorKind ? (
          <TaskPackEditorDrawer
            kind={editorKind}
            taskPack={currentTaskPack}
            onClose={() => setEditorKind(null)}
            onSave={handleSaveEditor}
            onOpenInBuilder={onOpenInBuilder}
          />
        ) : null}
      </AnimatePresence>
    </section>
  );
}
