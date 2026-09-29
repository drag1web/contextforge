import { useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { Bot, ChevronDown, ChevronUp, Clipboard, Clock3, Edit3, ExternalLink, FileText, Github, ListChecks, ShieldCheck, Sparkles, Target, Wrench } from "lucide-react";
import type { TaskPack } from "../../types";
import type { TaskPackFreshness } from "../../utils/taskPackFreshness";
import { AiToolLogo } from "../ai/AiToolLogo";
import { TaskPackFreshnessNotice } from "./TaskPackFreshness";

interface Props {
  taskPack: TaskPack;
  freshness: TaskPackFreshness;
  onReviewProject: () => void;
  onEditOriginal: () => void;
  onOpenGitHubUrl: (url: string) => void;
  canEdit: boolean;
  editExplanation: string;
}

/** Secondary information has one scroll owner; cards do not scroll independently. */
export function TaskPackDetailsView({ taskPack, freshness, onReviewProject, onEditOriginal, onOpenGitHubUrl, canEdit, editExplanation }: Props) {
  return <div className="h-full min-h-0 min-w-0 overflow-y-auto pr-1" data-task-pack-view="details">
    <div className="mx-auto max-w-6xl space-y-6 px-2 pb-6 sm:px-4">
      <div className="grid items-start gap-6 lg:grid-cols-2" data-details-summary>
        <GenerationSummaryCard taskPack={taskPack} />
        <div className="min-w-0 space-y-4">
          <OriginalTaskCard taskPack={taskPack} onEdit={onEditOriginal} canEdit={canEdit} editExplanation={editExplanation} />
          <TaskPackFreshnessNotice quietUnknown freshness={freshness} onReviewProject={onReviewProject} />
        </div>
      </div>
      <div data-details-contract>
        <GenerationContractCard taskPack={taskPack} onOpenGitHubUrl={onOpenGitHubUrl} />
      </div>
    </div>
  </div>;
}

const PAGE_TRANSITION = { duration: 0.2, ease: [0.16, 1, 0.3, 1] } as const;

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
    <div className="min-w-0 rounded-xl bg-white/[0.025] p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="shrink-0 text-neutral-400" aria-hidden="true">
          {icon}
        </span>
        <span className="min-w-0 break-words text-right text-sm font-semibold text-neutral-100">{value}</span>
      </div>
      <p className="cf-tech-label mt-3 break-words text-[10px] uppercase text-neutral-400">
        {label}
      </p>
      <p className="mt-1 break-words text-[11px] text-neutral-500">{caption}</p>
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
    <div className="flex min-w-0 items-start gap-3 py-2">
      <span className="mt-0.5 shrink-0 text-neutral-400" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="cf-tech-label break-words text-[10px] uppercase text-neutral-400">
          {label}
        </p>
        <p className="mt-1 break-words text-sm font-medium text-neutral-100">{value}</p>
        {caption ? (
          <p className="mt-1 break-words text-xs leading-5 text-neutral-500">{caption}</p>
        ) : null}
      </div>
    </div>
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
    <section className="min-w-0 rounded-2xl bg-white/[0.025] p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <AiToolLogo
          tool={taskPack.targetTool === "claude" ? "claudecode" : taskPack.targetTool}
          size="lg"
          tone="monochrome"
        />
        <div className="min-w-0">
          <p className="cf-tech-label text-[10px] uppercase text-neutral-400">
            {t("taskPackResult.generationSummary")}
          </p>
          <h2 className="mt-1 break-words text-base font-semibold text-white">
            {targetLabel} · {taskTypeLabel}
          </h2>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
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

      <div className="mt-5 flex items-center gap-2 text-xs leading-5 text-neutral-500">
        <FileText size={13} className="shrink-0" />
        <span className="min-w-0 break-words">
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
  canEdit,
  editExplanation,
}: {
  taskPack: TaskPack;
  onEdit: () => void;
  canEdit: boolean;
  editExplanation: string;
}) {
  const { t } = useTranslation();

  return (
    <section className="min-w-0 rounded-2xl bg-white/[0.025] p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="shrink-0 text-neutral-400" aria-hidden="true">
            <Clipboard size={15} />
          </span>
          <div className="min-w-0">
            <p className="cf-tech-label text-[10px] uppercase text-neutral-400">
              {t("taskPackResult.originalTask")}
            </p>
            <h3 className="mt-1 break-words text-base font-semibold text-white">
              {t("taskPackResult.originalTaskTitle")}
            </h3>
          </div>
        </div>

        <button
          type="button"
          onClick={onEdit}
          disabled={!canEdit}
          title={editExplanation || t("taskPackResult.editOriginalTask")}
          className="grid size-8 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-500 transition hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={t("taskPackResult.editOriginalTask")}
        >
          <Edit3 size={13} />
        </button>
      </div>

      <p className="mt-5 whitespace-pre-wrap break-words text-sm leading-6 text-neutral-300">
        {taskPack.rawTask || t("taskPackResult.originalTaskEmpty")}
      </p>
      {!canEdit ? <p className="mt-2 text-xs leading-5 text-neutral-400">{editExplanation}</p> : null}
    </section>
  );
}

function GenerationContractCard({ taskPack, onOpenGitHubUrl }: { taskPack: TaskPack; onOpenGitHubUrl: (url: string) => void }) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const recipe = taskPack.generationRecipe;

  if (!recipe) {
    return (
      <section className="min-w-0 rounded-2xl bg-white/[0.025] p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 shrink-0 text-neutral-400" aria-hidden="true">
            <ShieldCheck size={15} />
          </span>
          <div>
            <p className="cf-tech-label text-[10px] uppercase text-neutral-400">
              {t("taskPackResult.generationContract")}
            </p>
            <h3 className="mt-1 text-base font-semibold text-white">
              {t("taskPackResult.noRecipeMetadata")}
            </h3>
            <p className="mt-2 text-xs leading-5 text-neutral-400">
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
    <section className="min-w-0 rounded-2xl bg-white/[0.025] p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 shrink-0 text-neutral-400" aria-hidden="true">
            <ShieldCheck size={15} />
          </span>
          <div className="min-w-0">
            <p className="cf-tech-label text-[10px] uppercase text-neutral-400">
              {t("taskPackResult.generationContract")}
            </p>
            <h3 className="mt-1 break-words text-base font-semibold text-white">
              {t("taskPackResult.contractReady")}
            </h3>
            <p className="mt-2 text-xs leading-5 text-neutral-400">
              {t("taskPackResult.contractDescription")}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-x-8 gap-y-2 sm:grid-cols-2">
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
        aria-expanded={isExpanded}
        className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-full border border-neutral-800 bg-neutral-950 text-xs font-medium text-neutral-400 transition hover:border-white/20 hover:text-white"
      >
        {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        {isExpanded
          ? t("taskPackResult.hideContractDetails")
          : t("taskPackResult.showContractDetails")}
      </button>

      {isExpanded && (
        <motion.div
          className="mt-6 space-y-6 border-t border-white/[0.06] pt-6"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={PAGE_TRANSITION}
        >
          {recipe.taskClarifications && recipe.taskClarifications.length > 0 && (
            <div className="min-w-0">
              <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-white">
                <Sparkles size={13} />
                {t("taskPackResult.userClarifications")}
              </p>
              <div className="space-y-4">
                {recipe.taskClarifications.map((item, index) => (
                  <div
                    key={`${item.question}-${index}`}
                    className="min-w-0 break-words"
                  >
                    <p className="text-xs leading-5 text-neutral-400">
                      {item.question}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-neutral-300">
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
              onClick={() => onOpenGitHubUrl(recipe.githubIssue!.issueUrl)}
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
              onClick={() => onOpenGitHubUrl(recipe.githubCreatedIssue!.issueUrl)}
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

          <div className="min-w-0">
            <p className="text-xs font-semibold text-white">
              {t("taskPackResult.enabledRules")}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {recipe.enabledRules.length > 0 ? (
                recipe.enabledRules.map((rule) => (
                  <span
                    key={rule.id}
                    className="min-w-0 break-words rounded-lg bg-white/[0.05] px-2.5 py-1 text-xs text-neutral-300"
                  >
                    {rule.title}
                  </span>
                ))
              ) : (
                <span className="text-xs text-neutral-500">
                  {t("taskPackResult.noEnabledRules")}
                </span>
              )}
            </div>
          </div>

          {recipe.customRules.length > 0 && (
            <div className="min-w-0">
              <p className="text-xs font-semibold text-white">
                {t("taskPackResult.customRules")}
              </p>
              <ul className="mt-3 list-disc space-y-2 pl-5 marker:text-neutral-500">
                {recipe.customRules.map((rule) => (
                  <li
                    key={rule}
                    className="break-words pl-1 text-sm leading-6 text-neutral-300"
                  >
                    {rule}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="min-w-0">
            <p className="text-xs font-semibold text-white">
              {t("taskPackResult.acceptanceCriteria")}
            </p>
            {recipe.acceptanceCriteria.length > 0 ? (
              <ol className="mt-3 space-y-2">
                {recipe.acceptanceCriteria.map((criterion, index) => (
                  <li
                    key={criterion}
                    className="flex min-w-0 items-start gap-3 text-sm leading-6 text-neutral-300"
                  >
                    <span className="shrink-0 tabular-nums text-neutral-500">
                      {index + 1}
                    </span>
                    <span className="min-w-0 break-words">{criterion}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-3 text-xs text-neutral-500">
                {t("taskPackResult.noAcceptanceCriteria")}
              </p>
            )}
          </div>
        </motion.div>
      )}
    </section>
  );
}
