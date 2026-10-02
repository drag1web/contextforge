import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Archive, ArchiveRestore, Check, CheckCheck, CircleDot, ClipboardCheck, Loader2, MessageSquareWarning, RefreshCw, RotateCcw } from "lucide-react";
import type { TaskPackWorkflowState } from "../../types";
import { captureTaskPackWorkflowOperation, getTaskPackWorkflowCapabilities,
  type TaskPackWorkflowAction, type TaskPackWorkflowOperation, type TaskPackWorkflowSnapshot } from "../../utils/taskPackWorkflow";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";

const icons = { start_review: ClipboardCheck, accept: Check, request_changes: MessageSquareWarning,
  complete: CheckCheck, reopen: RotateCcw, archive: Archive, unarchive: ArchiveRestore };
function statusTone(value: string) {
  return value === "accepted" || value === "completed" ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
    : value === "changes_requested" || value === "in_review" ? "border-amber-400/20 bg-amber-400/10 text-amber-200"
    : "border-white/10 bg-white/[0.04] text-neutral-300";
}
function StatusPill({ value, label }: { value: string; label: string }) {
  return <span className={`inline-flex items-center rounded-lg border px-2 py-1 text-[11px] font-medium ${statusTone(value)}`}>{label}</span>;
}

/** Separate from generated-document readiness, including in the Result header. */
export function TaskPackWorkflowBadges({ workflow }: { workflow: Pick<TaskPackWorkflowState, "lifecycle" | "currentReviewState"> }) {
  const { t } = useTranslation();
  return <span className="inline-flex flex-wrap items-center gap-1.5" aria-label={t("taskPackWorkflow.title")}>
    <StatusPill value={workflow.lifecycle.state} label={t(`taskPackWorkflow.lifecycle.${workflow.lifecycle.state}`)} />
    <StatusPill value={workflow.currentReviewState} label={t(`taskPackWorkflow.review.${workflow.currentReviewState}`)} />
  </span>;
}

interface Props extends TaskPackWorkflowSnapshot {
  disabled?: boolean;
  onRefresh: () => Promise<void>;
  onExecute: (operation: TaskPackWorkflowOperation) => Promise<void>;
  onClearIssue: () => void;
}
export function TaskPackWorkflowCard({ workflow, loading, refreshing, activeAction, issue, blocked,
  disabled = false, onRefresh, onExecute, onClearIssue }: Props) {
  const { t } = useTranslation();
  const [confirmation, setConfirmation] = useState<TaskPackWorkflowOperation | null>(null);
  const busy = loading || refreshing || activeAction !== null;
  const capabilities = workflow ? getTaskPackWorkflowCapabilities(workflow) : null;
  function choose(action: TaskPackWorkflowAction) {
    if (!workflow || busy || blocked || disabled) return;
    const captured = captureTaskPackWorkflowOperation(workflow, action);
    if (action === "complete" || action === "archive") setConfirmation(captured);
    else void onExecute(captured);
  }
  const actionButton = (action: TaskPackWorkflowAction) => {
    const Icon = icons[action];
    return <Button key={action} type="button" variant={action === "accept" || action === "complete" ? "primary" : "secondary"}
      className="!min-h-9 !px-3 !text-xs" disabled={busy || blocked || disabled} onClick={() => choose(action)}>
      {activeAction === action ? <Loader2 size={13} className="animate-spin" /> : <Icon size={13} />}
      {t(`taskPackWorkflow.actions.${action}`)}
    </Button>;
  };
  return <section className="min-w-0 py-2"
    aria-label={t("taskPackWorkflow.title")} aria-busy={busy}>
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <CircleDot size={16} className="shrink-0 text-neutral-400" />
        <h2 className="text-sm font-semibold text-white">{t("taskPackWorkflow.title")}</h2>
      </div>
      <Button type="button" variant="ghost" className="!min-h-8 !px-2" aria-label={t("taskPackWorkflow.refresh")}
        title={t("taskPackWorkflow.refresh")} disabled={busy || disabled} onClick={() => void onRefresh()}>
        <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
      </Button>
    </div>
    {loading ? <p role="status" className="mt-4 flex items-center gap-2 text-xs text-neutral-400">
      <Loader2 size={13} className="animate-spin" />{t("taskPackWorkflow.loading")}
    </p> : null}
    {workflow ? <div className="mt-4 grid items-stretch gap-5 md:grid-cols-2">
      <section className="min-w-0 rounded-2xl bg-white/[0.025] p-5 sm:p-6" aria-label={t("taskPackWorkspace.revisionReview")}>
        <h3 className="text-base font-semibold text-white">{t("taskPackWorkspace.revisionReview")}</h3>
        <p className="mt-2 text-xs leading-5 text-neutral-400">{t("taskPackWorkspace.revisionReviewDescription")}</p>
        <dl className="my-6 space-y-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2"><dt className="text-neutral-400">{t("taskPackWorkflow.revision")}</dt><dd className="text-neutral-200">#{workflow.currentRevisionId}</dd></div>
          <div className="flex flex-wrap items-center justify-between gap-2"><dt className="text-neutral-400">{t("taskPackWorkspace.status")}</dt>
            <dd><StatusPill value={workflow.currentReviewState} label={t(`taskPackWorkflow.review.${workflow.currentReviewState}`)} /></dd></div>
          {workflow.acceptedRevisionId !== null && workflow.acceptedRevisionId !== workflow.currentRevisionId ?
            <div className="flex flex-wrap items-center justify-between gap-2"><dt className="text-neutral-400">{t("taskPackWorkspace.acceptedRevision")}</dt><dd className="text-neutral-200">#{workflow.acceptedRevisionId}</dd></div> : null}
        </dl>
        <div className="flex flex-wrap gap-2">{capabilities!.review.map(actionButton)}</div>
        {!capabilities!.review.length ? <p className="text-xs leading-5 text-neutral-400">{t("taskPackWorkflow.reviewTerminal")}</p> : null}
      </section>
      <section className="min-w-0 rounded-2xl bg-white/[0.025] p-5 sm:p-6" aria-label={t("taskPackWorkspace.taskPackLifecycle")}>
        <h3 className="text-base font-semibold text-white">{t("taskPackWorkspace.taskPackLifecycle")}</h3>
        <p className="mt-2 text-xs leading-5 text-neutral-400">{t("taskPackWorkspace.lifecycleDescription")}</p>
        <dl className="my-6 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2"><dt className="text-neutral-400">{t("taskPackWorkspace.status")}</dt>
            <dd><StatusPill value={workflow.lifecycle.state} label={t(`taskPackWorkflow.lifecycle.${workflow.lifecycle.state}`)} /></dd></div>
        </dl>
        <div className="flex flex-wrap gap-2">{capabilities!.lifecycle.map(actionButton)}</div>
        {workflow.lifecycle.state === "active" && !capabilities!.lifecycle.includes("complete") ?
          <p className="mt-3 text-xs leading-5 text-neutral-400">{t("taskPackWorkflow.completionNeedsAcceptance")}</p> : null}
      </section>
    </div> : null}
    {issue ? <div role="alert" className="mt-4 rounded-xl border border-amber-300/15 bg-amber-400/[0.05] p-3 text-xs leading-5 text-amber-100/90">
      {issue.phase === "load" ? <p className="mb-1 font-medium">{t("taskPackWorkflow.loadFailed")}</p> : null}
      {issue.phase === "refresh" || issue.refreshFailed ? <p className="mb-1 font-medium">{t("taskPackWorkflow.refreshFailed")}</p> : null}
      <p>{issue.code === "TASK_PACK_REVIEW_REVISION_NOT_FOUND" ? t("taskPackWorkflow.revisionMissing") : t(`taskPackWorkflow.issues.${issue.kind}`)}</p>
      {issue.status === 409 && issue.kind !== "conflict" ? <p className="mt-1">{t("taskPackWorkflow.issues.conflict")}</p> : null}
      {!blocked ? <Button type="button" variant="ghost" className="mt-2 !min-h-7 !px-0 !text-xs" onClick={onClearIssue}>{t("taskPackWorkflow.dismiss")}</Button> : null}
    </div> : null}
    {confirmation ? <ConfirmDialog
      title={t(`taskPackWorkflow.confirm.${confirmation.action}.title`)}
      description={t(`taskPackWorkflow.confirm.${confirmation.action}.description`)}
      confirmLabel={t(`taskPackWorkflow.actions.${confirmation.action}`)} cancelLabel={t("taskPackResult.cancel")}
      intent="warning" confirmDisabled={busy || blocked || disabled}
      onClose={() => { if (!activeAction) setConfirmation(null); }}
      onConfirm={() => { const captured = confirmation; void onExecute(captured).then(() => setConfirmation(null)); }}
    /> : null}
  </section>;
}
