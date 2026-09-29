import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Check, Copy, FileText, ListChecks, SlidersHorizontal } from "lucide-react";
import type { TaskPack, TaskPackWorkflowState } from "../../types";
import { Button } from "../ui/Button";
import { DropdownMenu } from "../ui/DropdownMenu";
import { HorizontalSlidingSelector } from "../ui/SlidingSelectors";
import { TaskPackWorkflowBadges } from "./TaskPackWorkflowCard";

export const TASK_PACK_WORKSPACE_VIEWS = ["document", "review", "details"] as const;
export type TaskPackWorkspaceView = typeof TASK_PACK_WORKSPACE_VIEWS[number];
const viewIcons = { document: FileText, review: ListChecks, details: SlidersHorizontal };
interface Props {
  taskPack: TaskPack;
  workflow: TaskPackWorkflowState | null;
  view: TaskPackWorkspaceView;
  onViewChange: (view: TaskPackWorkspaceView) => void;
  onBack: () => void;
  onCopy: () => void;
  isCopied: boolean;
  actions: Array<{ id: string; label: string; icon: ReactNode; onClick: () => void }>;
  editorOpenError: string;
}

/** Quiet workspace chrome: secondary capabilities stay in the shared, viewport-clamped menu. */
export function TaskPackWorkspaceHeader({ taskPack, workflow, view, onViewChange, onBack, onCopy, isCopied, actions, editorOpenError }: Props) {
  const { t } = useTranslation();
  return <header className="relative z-30 min-w-0 shrink-0 border-b border-white/[0.06]">
    <div className="flex min-w-0 flex-wrap items-start justify-between gap-4 px-2 pb-4 pt-1 sm:px-4">
      <div className="min-w-0 flex-1 basis-64">
        <p className="cf-tech-label break-words text-[10px] uppercase text-neutral-500">
          {t("taskPackResult.workspaceEyebrow", { project: taskPack.projectName ?? t("taskPackResult.projectFallback", { id: taskPack.projectId }) })}
        </p>
        <h1 className="mt-2 line-clamp-2 break-words text-2xl font-semibold leading-tight tracking-tight text-white sm:text-[27px]">{taskPack.title}</h1>
        {workflow ? <div className="mt-3"><TaskPackWorkflowBadges workflow={workflow} /></div> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={onBack}><ArrowLeft size={15} />{t("taskPackResult.back")}</Button>
        <Button variant="primary" onClick={onCopy}>
          {isCopied ? <Check size={15} /> : <Copy size={15} />}
          {t(isCopied ? "taskPackResult.copied" : "taskPackResult.copyPrompt")}
        </Button>
        <DropdownMenu size="wide" ariaLabel={t("taskPackResult.moreActions")}
          triggerLabel={t("taskPackWorkspace.more")}
          actions={actions.map(({ label, icon, onClick }) => ({ label, icon, onClick }))} />
      </div>
    </div>
    <div className="px-2 pb-3 sm:px-4">
      <HorizontalSlidingSelector items={TASK_PACK_WORKSPACE_VIEWS}
        activeIndex={TASK_PACK_WORKSPACE_VIEWS.indexOf(view)} getItemKey={(item) => item} onSelect={onViewChange}
        ariaLabel={t("taskPackWorkspace.viewLabel")} className="h-11 w-full max-w-xl" itemClassName="rounded-[0.95rem]"
        renderItem={(item, isActive) => {
          const Icon = viewIcons[item];
          return <span className={`flex items-center justify-center gap-2 px-2 text-xs font-semibold ${isActive ? "text-black" : "text-neutral-300"}`}>
            <Icon size={15} className="shrink-0" aria-hidden="true" />{t(`taskPackWorkspace.${item}`)}
          </span>;
        }} />
    </div>
    {editorOpenError ? <div role="alert" className="border-t border-red-400/15 px-4 py-3 text-xs text-red-200">{editorOpenError}</div> : null}
  </header>;
}
