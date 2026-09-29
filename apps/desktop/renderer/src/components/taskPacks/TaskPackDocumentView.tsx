import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Code2, Edit3, Eye } from "lucide-react";
import type { TaskPack } from "../../types";
import type { TaskPackFreshness } from "../../utils/taskPackFreshness";
import { HorizontalSlidingSelector } from "../ui/SlidingSelectors";
import { TaskPackExportActions } from "./TaskPackExportActions";
import { TaskPackFreshnessNotice } from "./TaskPackFreshness";

export type PromptViewMode = "preview" | "raw";
interface Props {
  taskPack: TaskPack;
  viewMode: PromptViewMode;
  onViewModeChange: (value: PromptViewMode) => void;
  freshness: TaskPackFreshness;
  onReviewProject: () => void;
  onEdit: () => void;
  canEdit: boolean;
  editExplanation: string;
}

/** Document-only surface. Workflow ownership and edit authority stay in the Result page. */
export function TaskPackDocumentView({ taskPack, viewMode, onViewModeChange, freshness, onReviewProject, onEdit, canEdit, editExplanation }: Props) {
  const { t } = useTranslation();
  const generatedPrompt = taskPack.generatedPrompt ?? "";
  return <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl bg-black/25"
    data-task-pack-view="document" aria-label={t("taskPackWorkspace.document")}>
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/[0.05] px-4 py-3 sm:px-6">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-white">{t("taskPackResult.documentTitle")}</h2>
        <p className="mt-1 text-[10px] text-neutral-500">{t("taskPackResult.documentCaption", { chars: generatedPrompt.length.toLocaleString() })}</p>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <button type="button" onClick={onEdit} disabled={!canEdit}
          title={editExplanation || t("taskPackResult.editTaskPack")}
          className="inline-flex h-9 items-center gap-2 rounded-full border border-neutral-800 bg-neutral-950 px-3 text-xs font-medium text-neutral-300 transition hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-40">
          <Edit3 size={13} />{t("taskPackResult.editTaskPack")}
        </button>
        <ViewModeSwitch value={viewMode} onChange={onViewModeChange} t={t} />
      </div>
    </div>
    {!canEdit ? <p className="shrink-0 px-4 py-2 text-xs leading-5 text-neutral-400 sm:px-6">{editExplanation}</p> : null}
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-3" data-document-scroll>
      {freshness.status !== "current" ? <TaskPackFreshnessNotice compact quietUnknown freshness={freshness} onReviewProject={onReviewProject} /> : null}
      <PromptPanel viewMode={viewMode} generatedPrompt={generatedPrompt} />
    </div>
    <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-white/[0.05] px-4 py-2.5 sm:px-6">
      <span className="text-[10px] text-neutral-500">{t("taskPackResult.localOnly")}</span>
      <TaskPackExportActions taskPack={taskPack} compact />
    </footer>
  </section>;
}

const PAGE_TRANSITION = { duration: 0.2, ease: [0.16, 1, 0.3, 1] } as const;

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
      label: t("taskPackWorkspace.preview"),
      icon: <Eye size={14} />,
    },
    {
      value: "raw",
      label: t("taskPackWorkspace.markdown"),
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
      className="h-10 w-64 max-w-full"
      itemClassName="rounded-[0.95rem]"
      renderItem={(option, isActive) => (
        <span className="flex h-full items-center justify-center gap-2 px-3">
          <span aria-hidden="true" className={isActive ? "shrink-0 text-black" : "shrink-0 text-neutral-400"}>
            {option.icon}
          </span>
          <span className={`text-xs font-semibold ${isActive ? "text-black" : "text-neutral-300"}`}>{option.label}</span>
        </span>
      )}
    />
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
    <div className="min-w-0">
      {viewMode === "preview" ? (
        <motion.article
          key="preview"
          className="min-w-0 px-3 py-6 text-sm sm:px-6 sm:py-8"
          initial={{ opacity: 0, y: 8, scale: 0.995 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={PAGE_TRANSITION}
        >
          <div className="cf-markdown-preview mx-auto max-w-5xl break-words">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {generatedPrompt}
            </ReactMarkdown>
          </div>
        </motion.article>
      ) : (
        <motion.pre
          key="raw"
          className="min-w-0 whitespace-pre-wrap break-words rounded-[1rem] p-3 font-mono text-xs leading-6 text-neutral-300 sm:p-5"
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
