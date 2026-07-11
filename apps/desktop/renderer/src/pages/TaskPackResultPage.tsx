import { useEffect, useMemo, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Archive,
  ArrowLeft,
  Bot,
  Check,
  Clipboard,
  Clock3,
  Code2,
  Copy,
  Eye,
  ExternalLink,
  FileText,
  Github,
  ListChecks,
  Loader2,
  ShieldCheck,
  Sparkles,
  Target,
  Wrench,
} from "lucide-react";

import type { TaskPack } from "../types";
import { createGitHubIssueFromTaskPack } from "../api/client";
import { TaskPackExportActions } from "../components/taskPacks/TaskPackExportActions";
import { Button } from "../components/ui/Button";
import { Modal } from "../components/ui/Modal";
import {
  getSelectorPipelineLabel,
  SelectorDiagnosticsModal,
} from "../components/selector/SelectorDiagnosticsModal";
import { GenerationDiagnosticsModal } from "../components/generation/GenerationDiagnosticsModal";

interface TaskPackResultPageProps {
  taskPack: TaskPack;
  onClose: () => void;
  onOpenArchive: () => void;
  onTaskPackUpdated?: (taskPack: TaskPack) => void;
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

.cf-markdown-preview hr {
  margin: 2rem 0;
  border: 0;
  border-top: 1px solid rgb(38 38 38);
}
`;

const PAGE_TRANSITION = {
  duration: 0.18,
  ease: [0.16, 1, 0.3, 1],
} as const;

function formatDuration(durationMs: number | null | undefined) {
  if (!durationMs) {
    return "—";
  }

  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  return `${(durationMs / 1000).toFixed(1)} sec`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

function getTaskPackBodyLabel(taskPack: TaskPack, t: (key: string) => string) {
  if (
    taskPack.generationMode === "ollama" &&
    !taskPack.generationUsedFallback
  ) {
    return t("labels.ollamaRefined");
  }

  return t("labels.safeTemplate");
}

function getTaskPackBodyDescription(
  taskPack: TaskPack,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  if (
    taskPack.generationMode === "ollama" &&
    !taskPack.generationUsedFallback
  ) {
    return taskPack.generationMessage || t("taskPackResult.ollamaDescription");
  }

  return taskPack.generationMessage
    ? t("taskPackResult.fallbackDescriptionWithMessage", {
        message: taskPack.generationMessage,
      })
    : t("taskPackResult.fallbackDescription");
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
    <div className="relative inline-flex overflow-hidden rounded-[1.35rem] border border-white/10 bg-black/70 p-1 shadow-[0_18px_52px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.055)]">
      {options.map((option) => {
        const isActive = value === option.value;

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={[
              "relative h-10 min-w-[132px] overflow-hidden rounded-[1.05rem] px-4 text-sm font-medium transition",
              isActive ? "text-black" : "text-neutral-500 hover:text-white",
            ].join(" ")}
          >
            {isActive && (
              <motion.span
                layoutId="task-pack-result-view-switch"
                className="absolute inset-0 rounded-[1.05rem] bg-white shadow-[0_10px_30px_rgba(255,255,255,0.16)]"
                transition={{
                  type: "spring",
                  stiffness: 420,
                  damping: 34,
                }}
              />
            )}

            <span className="relative z-10 flex items-center justify-center gap-2">
              {option.icon}
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function MetricCard({
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
    <div className="rounded-2xl border border-neutral-900 bg-black/35 p-3.5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="grid size-8 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-300">
          {icon}
        </span>

        <span className="cf-display-font truncate text-lg font-semibold text-white">
          {value}
        </span>
      </div>

      <p className="cf-tech-label truncate text-[10px] uppercase text-neutral-600">
        {label}
      </p>

      <p className="mt-1 truncate text-[11px] text-neutral-600">{caption}</p>
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
  const [title, setTitle] = useState(() =>
    getDefaultGitHubIssueTitle(taskPack),
  );
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
      setMessage("Title and body are required.");
      return;
    }

    try {
      setIsCreating(true);
      setMessage("Creating GitHub issue...");

      const result = await createGitHubIssueFromTaskPack(taskPack.id, {
        title: title.trim(),
        body: body.trim(),
        labels,
      });

      onCreated(result.taskPack);
      setMessage(`Created GitHub issue #${result.issue.number}.`);
      await openGitHubUrl(result.issue.htmlUrl);
      onClose();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Failed to create issue.",
      );
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <Modal
      title="Create GitHub issue"
      eyebrow="Stage 13.4 · Task Pack → Issue"
      maxWidth="max-w-5xl"
      onClose={onClose}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs leading-5 text-neutral-500">
            Creates one issue in the linked repository. Source files are not
            uploaded.
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} disabled={isCreating}>
              Cancel
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
              Create issue
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid gap-5 p-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <label className="block">
            <span className="cf-tech-label text-[10px] uppercase text-neutral-600">
              Issue title
            </span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value.slice(0, 256))}
              className="mt-2 w-full rounded-2xl border border-neutral-800 bg-black/40 px-4 py-3 text-sm font-medium text-white outline-none transition placeholder:text-neutral-700 focus:border-white/25"
              placeholder="GitHub issue title"
            />
          </label>

          <label className="block">
            <span className="cf-tech-label text-[10px] uppercase text-neutral-600">
              Labels
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
              Issue body
            </span>
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value.slice(0, 60000))}
              className="mt-2 h-[420px] w-full resize-none rounded-2xl border border-neutral-800 bg-black/45 px-4 py-3 font-mono text-xs leading-6 text-neutral-200 outline-none transition placeholder:text-neutral-700 focus:border-white/25"
              placeholder="GitHub issue markdown"
            />
          </label>
        </div>

        <aside className="space-y-3">
          <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
            <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
              Destination
            </p>
            <p className="mt-2 text-sm font-semibold text-white">
              Linked GitHub repository
            </p>
            <p className="mt-1 text-xs leading-5 text-neutral-500">
              ContextForge will use the Task Pack project link from Stage 13.2.
              If the project is not linked, the backend will block creation.
            </p>
          </div>

          <div className="rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.055] p-4">
            <p className="cf-tech-label text-[10px] uppercase text-emerald-300/80">
              Source safety
            </p>
            <p className="mt-2 text-xs leading-5 text-emerald-100/75">
              The issue contains the generated brief and metadata only.
              ContextForge does not upload repository files in this workflow.
            </p>
          </div>

          <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
            <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
              Preview stats
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-xl border border-neutral-900 bg-black/35 p-3">
                <p className="text-neutral-600">Labels</p>
                <p className="mt-1 font-semibold text-white">{labels.length}</p>
              </div>
              <div className="rounded-xl border border-neutral-900 bg-black/35 p-3">
                <p className="text-neutral-600">Body</p>
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

function RecipeCard({ taskPack }: { taskPack: TaskPack }) {
  const recipe = taskPack.generationRecipe;

  if (!recipe) {
    return (
      <section className="rounded-[1.5rem] border border-neutral-900 bg-black/35 p-5">
        <div className="mb-4 flex size-10 items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-300">
          <ShieldCheck size={18} />
        </div>

        <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
          Rules & Templates
        </p>

        <h3 className="mt-2 text-base font-semibold text-white">
          No recipe metadata
        </h3>

        <p className="mt-2 text-xs leading-5 text-neutral-600">
          This Task Pack was generated before v0.5 recipe metadata was added, or
          the backend did not return recipe details.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-[1.5rem] border border-neutral-900 bg-black/35 p-5">
      <div className="mb-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="grid size-10 place-items-center rounded-2xl border border-neutral-800 bg-neutral-950 text-emerald-300">
            <ShieldCheck size={18} />
          </span>

          <Pill tone="success">{recipe.counts.enabledRules} rules</Pill>
        </div>

        <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
          Rules & Templates recipe
        </p>

        <h3 className="mt-2 text-base font-semibold text-white">
          Generation contract
        </h3>

        <p className="mt-2 text-xs leading-5 text-neutral-600">
          These settings were validated by ContextForge and inserted into the
          final Task Pack prompt.
        </p>
      </div>

      <div className="space-y-3">
        {recipe.githubIssue && (
          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.055] p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-emerald-100">
              <Github size={14} />
              GitHub Issue Source
            </div>
            <p className="truncate text-sm font-semibold text-white">
              #{recipe.githubIssue.issueNumber} ·{" "}
              {recipe.githubIssue.issueTitle}
            </p>
            <p className="mt-1 truncate text-[11px] text-emerald-100/70">
              {recipe.githubIssue.fullName} · {recipe.githubIssue.issueState} ·{" "}
              {recipe.githubIssue.labels.join(", ") || "no labels"}
            </p>
          </div>
        )}

        {recipe.githubCreatedIssue && (
          <button
            type="button"
            onClick={() => openGitHubUrl(recipe.githubCreatedIssue!.issueUrl)}
            className="w-full rounded-2xl border border-white/15 bg-white/[0.06] p-3 text-left transition hover:border-white/30 hover:bg-white/[0.095]"
          >
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-white">
              <ExternalLink size={14} />
              Created GitHub Issue
            </div>
            <p className="truncate text-sm font-semibold text-white">
              #{recipe.githubCreatedIssue.issueNumber} ·{" "}
              {recipe.githubCreatedIssue.issueTitle}
            </p>
            <p className="mt-1 truncate text-[11px] text-neutral-400">
              {recipe.githubCreatedIssue.fullName} ·{" "}
              {recipe.githubCreatedIssue.issueState} ·{" "}
              {recipe.githubCreatedIssue.labels.join(", ") || "no labels"}
            </p>
          </button>
        )}

        <div className="grid grid-cols-3 gap-2">
          <MetricCard
            icon={<ShieldCheck size={14} />}
            label="Rules"
            value={recipe.counts.enabledRules}
            caption="toggle"
          />

          <MetricCard
            icon={<Clipboard size={14} />}
            label="Custom"
            value={recipe.counts.customRules}
            caption="rules"
          />

          <MetricCard
            icon={<ListChecks size={14} />}
            label="Criteria"
            value={recipe.counts.acceptanceCriteria}
            caption="checks"
          />
        </div>

        <div className="rounded-2xl border border-neutral-900 bg-black/35 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-white">
            <FileText size={14} />
            Template
          </div>

          <p className="truncate text-sm font-semibold text-white">
            {recipe.template?.name ?? "No template"}
          </p>

          <p className="mt-1 truncate text-[11px] text-neutral-600">
            {recipe.template
              ? `${recipe.template.targetTool} · ${recipe.template.taskType} · ${
                  recipe.template.isBuiltin ? "built-in" : "custom"
                }`
              : "Template metadata is missing."}
          </p>
        </div>

        <div className="rounded-2xl border border-neutral-900 bg-black/35 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-white">
            <ListChecks size={14} />
            Rule profile
          </div>

          <p className="truncate text-sm font-semibold text-white">
            {recipe.ruleProfile?.name ?? "No profile"}
          </p>

          <p className="mt-1 truncate text-[11px] text-neutral-600">
            {recipe.ruleProfile
              ? `${recipe.ruleProfile.taskType} · ${
                  recipe.ruleProfile.isBuiltin ? "built-in" : "custom"
                }`
              : "Rule profile metadata is missing."}
          </p>
        </div>

        <div className="rounded-2xl border border-neutral-900 bg-black/35 p-3">
          <p className="mb-3 text-xs font-semibold text-white">
            Enabled toggle rules
          </p>

          <div className="flex flex-wrap gap-2">
            {recipe.enabledRules.length > 0 ? (
              recipe.enabledRules.map((rule) => (
                <span
                  key={rule.id}
                  className="rounded-full border border-neutral-800 bg-neutral-950 px-2.5 py-1 text-[11px] text-neutral-400"
                >
                  {rule.title} · {rule.category}
                </span>
              ))
            ) : (
              <span className="text-xs text-neutral-600">
                No toggle rules were enabled.
              </span>
            )}
          </div>
        </div>

        <div className="grid gap-3">
          <div className="rounded-2xl border border-neutral-900 bg-black/35 p-3">
            <p className="mb-3 text-xs font-semibold text-white">
              Custom rules
            </p>

            {recipe.customRules.length > 0 ? (
              <ul className="space-y-2">
                {recipe.customRules.map((rule) => (
                  <li
                    key={rule}
                    className="rounded-xl border border-neutral-900 bg-black/35 px-3 py-2 text-xs leading-5 text-neutral-400"
                  >
                    {rule}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-neutral-600">No custom rules.</p>
            )}
          </div>

          <div className="rounded-2xl border border-neutral-900 bg-black/35 p-3">
            <p className="mb-3 text-xs font-semibold text-white">
              Acceptance criteria
            </p>

            {recipe.acceptanceCriteria.length > 0 ? (
              <ul className="space-y-2">
                {recipe.acceptanceCriteria.map((criterion) => (
                  <li
                    key={criterion}
                    className="rounded-xl border border-neutral-900 bg-black/35 px-3 py-2 text-xs leading-5 text-neutral-400"
                  >
                    {criterion}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-neutral-600">
                No acceptance criteria.
              </p>
            )}
          </div>
        </div>
      </div>
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
    <div className="min-h-0 overflow-hidden rounded-[1.5rem] border border-neutral-900 bg-black/30 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      {viewMode === "preview" ? (
        <motion.article
          key="preview"
          className="h-full min-h-0 overflow-y-auto rounded-[1.1rem] bg-neutral-950/45 px-6 py-5 text-sm"
          initial={{ opacity: 0, y: 8, scale: 0.995 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={PAGE_TRANSITION}
        >
          <div className="cf-markdown-preview">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {generatedPrompt}
            </ReactMarkdown>
          </div>
        </motion.article>
      ) : (
        <motion.pre
          key="raw"
          className="h-full min-h-0 overflow-y-auto whitespace-pre-wrap rounded-[1.1rem] bg-black/75 p-5 text-sm leading-6 text-neutral-300"
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

export function TaskPackResultPage({
  taskPack,
  onClose,
  onOpenArchive,
  onTaskPackUpdated,
}: TaskPackResultPageProps) {
  const { t } = useTranslation();
  const [viewMode, setViewMode] = useState<PromptViewMode>("preview");
  const [isCopied, setIsCopied] = useState(false);
  const [currentTaskPack, setCurrentTaskPack] = useState(taskPack);
  const [isCreateIssueOpen, setIsCreateIssueOpen] = useState(false);
  const [isSelectorDiagnosticsOpen, setIsSelectorDiagnosticsOpen] = useState(false);
  const [isGenerationDiagnosticsOpen, setIsGenerationDiagnosticsOpen] = useState(false);

  useEffect(() => {
    setCurrentTaskPack(taskPack);
  }, [taskPack]);

  const generatedPrompt = currentTaskPack.generatedPrompt ?? "";
  const bodyLabel = useMemo(
    () => getTaskPackBodyLabel(currentTaskPack, t),
    [currentTaskPack, t],
  );
  const bodyDescription = useMemo(
    () => getTaskPackBodyDescription(currentTaskPack, t),
    [currentTaskPack, t],
  );
  const sourceIssue = currentTaskPack.generationRecipe?.githubIssue;
  const createdIssue = currentTaskPack.generationRecipe?.githubCreatedIssue;
  const selectorDiagnostics = currentTaskPack.generationRecipe?.selectorDiagnostics;
  const generationDiagnostics = currentTaskPack.generationRecipe?.generationDiagnostics;

  function handleTaskPackUpdated(nextTaskPack: TaskPack) {
    setCurrentTaskPack(nextTaskPack);
    onTaskPackUpdated?.(nextTaskPack);
  }

  async function handleCopyPrompt() {
    await navigator.clipboard.writeText(generatedPrompt);
    setIsCopied(true);

    window.setTimeout(() => {
      setIsCopied(false);
    }, 1400);
  }

  return (
    <section className="grid h-[calc(100vh-96px)] min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-4 overflow-hidden">
      <style>{MARKDOWN_PREVIEW_STYLES}</style>

      <header className="rounded-[1.5rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.012))] p-5 shadow-[0_14px_44px_rgba(0,0,0,0.32),inset_0_1px_0_rgba(255,255,255,0.045)]">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap gap-2">
              <Pill>
                <Sparkles size={12} />
                {t("taskPackResult.generated")}
              </Pill>

              <Pill>{bodyLabel}</Pill>

              {currentTaskPack.generationModel && (
                <Pill>{currentTaskPack.generationModel}</Pill>
              )}

              {currentTaskPack.generationRecipe && (
                <Pill tone="success">v0.5 recipe</Pill>
              )}

              {selectorDiagnostics && (
                <Pill>{getSelectorPipelineLabel(selectorDiagnostics, t)}</Pill>
              )}

              {currentTaskPack.generationRecipe?.githubIssue && (
                <Pill tone="success">
                  <Github size={12} />
                  Issue #
                  {currentTaskPack.generationRecipe.githubIssue.issueNumber}
                </Pill>
              )}

              {currentTaskPack.generationRecipe?.githubCreatedIssue && (
                <Pill tone="success">
                  <ExternalLink size={12} />
                  Created #
                  {
                    currentTaskPack.generationRecipe.githubCreatedIssue
                      .issueNumber
                  }
                </Pill>
              )}
            </div>

            <h1 className="line-clamp-2 max-w-5xl text-[30px] font-semibold leading-[1.04] tracking-[-0.055em] text-white">
              {currentTaskPack.title}
            </h1>

            <p className="mt-2 max-w-5xl text-sm leading-6 text-neutral-500">
              {bodyDescription}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap gap-3">
            <Button variant="secondary" onClick={onClose}>
              <ArrowLeft size={15} />
              {t("taskPackResult.back")}
            </Button>

            <Button variant="secondary" onClick={onOpenArchive}>
              <Archive size={15} />
              {t("taskPackResult.openArchive")}
            </Button>

            {sourceIssue && (
              <Button
                variant="secondary"
                onClick={() => openGitHubUrl(sourceIssue.issueUrl)}
              >
                <ExternalLink size={15} />
                Source issue
              </Button>
            )}

            {createdIssue ? (
              <Button
                variant="secondary"
                onClick={() => openGitHubUrl(createdIssue.issueUrl)}
              >
                <ExternalLink size={15} />
                Open issue
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={() => setIsCreateIssueOpen(true)}
              >
                <Github size={15} />
                Create issue
              </Button>
            )}

            <TaskPackExportActions taskPack={currentTaskPack} compact />

            {selectorDiagnostics && (
              <Button variant="secondary" onClick={() => setIsSelectorDiagnosticsOpen(true)}>
                <ShieldCheck size={15} />
                {t("taskPackResult.selectorDiagnostics")}
              </Button>
            )}

            {generationDiagnostics && (
              <Button variant="secondary" onClick={() => setIsGenerationDiagnosticsOpen(true)}>
                <Bot size={15} />
                {t("taskPackResult.generationDiagnostics")}
              </Button>
            )}

            <Button variant="primary" onClick={handleCopyPrompt}>
              {isCopied ? <Check size={15} /> : <Copy size={15} />}
              {isCopied
                ? t("taskPackResult.copied")
                : t("taskPackResult.copyPrompt")}
            </Button>
          </div>
        </div>
      </header>

      <div className="grid min-h-0 gap-4 overflow-hidden xl:grid-cols-[390px_minmax(0,1fr)]">
        <aside className="min-h-0 space-y-4 overflow-y-auto pr-1">
          <section className="rounded-[1.5rem] border border-neutral-900 bg-black/35 p-5">
            <div className="mb-4 flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-300">
                <Target size={18} />
              </span>

              <div>
                <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                  Task Pack summary
                </p>

                <h2 className="text-base font-semibold text-white">
                  Generation details
                </h2>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <MetricCard
                icon={<Target size={14} />}
                label={t("taskPackResult.target")}
                value={currentTaskPack.targetTool}
                caption="agent"
              />

              <MetricCard
                icon={<Wrench size={14} />}
                label={t("taskPackResult.taskType")}
                value={currentTaskPack.taskType}
                caption="effective"
              />

              <MetricCard
                icon={<Clock3 size={14} />}
                label={t("taskPackResult.duration")}
                value={formatDuration(currentTaskPack.generationDurationMs)}
                caption="generation"
              />

              <MetricCard
                icon={<Bot size={14} />}
                label={t("taskPackResult.mode")}
                value={currentTaskPack.generationMode ?? "template"}
                caption={
                  currentTaskPack.generationUsedFallback ? "fallback" : "stable"
                }
              />
            </div>

            <p className="mt-4 flex items-center gap-2 text-xs text-neutral-600">
              <FileText size={14} />
              {t("taskPackResult.created", {
                date: formatDate(currentTaskPack.createdAt),
              })}
            </p>
          </section>

          <RecipeCard taskPack={currentTaskPack} />
        </aside>

        <main className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-4 overflow-hidden">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-4">
            <ViewModeSwitch value={viewMode} onChange={setViewMode} t={t} />

            <Pill>{generatedPrompt.length.toLocaleString()} chars</Pill>
          </div>

          <PromptPanel viewMode={viewMode} generatedPrompt={generatedPrompt} />
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
    </section>
  );
}
