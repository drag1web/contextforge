import { Check, FileText, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import type { createTaskPackDraftDiscovery, DraftDiscoveryState } from "../../utils/taskPackDraftDiscovery";

interface Props {
  state: DraftDiscoveryState;
  owner: ReturnType<typeof createTaskPackDraftDiscovery>;
  activeDraftId: string | null;
  projectName?: string;
}

export function TaskPackDraftChooserModal({ state, owner, activeDraftId, projectName }: Props) {
  const { t, i18n } = useTranslation();
  const text = (key: string) => t(`taskPackDraftDiscovery.${key}`);
  const actions = useRef<HTMLDivElement>(null);
  useEffect(() => { actions.current?.querySelector<HTMLButtonElement>("button")?.focus(); }, [!!state.confirmation]);
  const date = (value: string) => Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
  const items = state.summaries.filter(item => state.scope === null || item.projectId === state.scope);
  const busy = state.pending !== null;
  const activeSelected = activeDraftId !== null && state.selectedId === activeDraftId;

  // One Modal shell at a time: competing focus traps must never be mounted together.
  if (state.confirmation) {
    const discard = state.confirmation.kind === "discard";
    return <ConfirmDialog
      title={text(discard ? "discardTitle" : "replaceTitle")}
      description={text(discard ? "discardDescription" : "replaceDescription")}
      intent={discard ? "danger" : "warning"}
      cancelLabel={text("cancel")}
      confirmLabel={text(discard ? "discard" : "continue")}
      confirmDisabled={busy}
      onClose={owner.cancelConfirmation}
      onConfirm={() => void owner.confirm()}
    />;
  }
  return <Modal title={text("title")} maxWidth="max-w-3xl" onClose={owner.close}
    footer={<div ref={actions} className="flex w-full flex-wrap items-center justify-end gap-2">
      <Button variant="secondary" onClick={owner.close}>{text("cancel")}</Button>
      <Button variant="secondary" disabled={busy || !state.detail || activeSelected || state.detailLoading}
        title={activeSelected ? text("activeDraft") : undefined}
        className="!text-red-200 hover:!bg-red-500/10 hover:!text-red-100"
        onClick={owner.requestDiscard}><Trash2 size={15} aria-hidden="true" />{text("discard")}</Button>
      <Button variant="primary" disabled={busy || !state.detail || state.detailLoading || state.loading}
        onClick={() => void owner.continueDraft()}>
        {state.pending === "continuing" && <Loader2 size={15} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
        {text(state.pending === "continuing" ? "continuing" : "continue")}
      </Button>
    </div>}
  >
    <div className="space-y-4 px-6 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm leading-6 text-neutral-300">{state.scope === null ? text("globalDescription") : projectName}</p>
          <p className="mt-1 text-xs leading-5 text-neutral-500">{text("privateHint")}</p>
        </div>
        <Button variant="secondary" disabled={busy || state.loading} onClick={() => void owner.refresh()}>
          <RefreshCw size={14} aria-hidden="true" />{text("refresh")}
        </Button>
      </div>
      {state.listIssue && <p role="alert" className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-sm leading-6 text-amber-100">{text(state.listIssue)}</p>}
      {state.issue && <p role="alert" className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-sm leading-6 text-amber-100">{text(state.issue)}</p>}
      {state.notice === "discarded" && <p role="status" className="text-sm text-neutral-300">{text("discarded")}</p>}
      {state.loading ? <p role="status" className="flex items-center gap-2 py-8 text-sm text-neutral-400">
        <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />{text("loading")}
      </p> : items.length === 0 && !state.listIssue ? <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-8 text-center">
        <FileText size={24} className="mx-auto mb-3 text-neutral-500" aria-hidden="true" />
        <p role="status" className="text-sm text-neutral-300">{text("empty")}</p>
        <p className="mt-2 text-xs leading-5 text-neutral-500">{text("emptyHint")}</p>
      </div> : <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="max-h-80 space-y-2 overflow-y-auto pr-1" aria-label={text("select")}>
          {items.map((item, index) => <button key={item.id} type="button" disabled={busy}
            aria-pressed={state.selectedId === item.id} onClick={() => void owner.select(item.id)}
            className={`w-full rounded-xl border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 ${state.selectedId === item.id
              ? "border-white/20 bg-white/[0.07]" : "border-white/5 bg-white/[0.02] hover:bg-white/[0.04]"}`}>
            <span className="flex items-start gap-2 text-sm text-neutral-200">
              {state.selectedId === item.id ? <Check size={16} className="mt-0.5 shrink-0" aria-hidden="true" /> : <FileText size={16} className="mt-0.5 shrink-0 text-neutral-500" aria-hidden="true" />}
              <span className="min-w-0 break-words">{item.projectName}</span>
            </span>
            <span className="mt-2 block text-xs text-neutral-400">{t("taskPackDraftDiscovery.draftNumber", { count: index + 1 })} · {text("active")}</span>
            <span className="mt-1 block text-xs leading-5 text-neutral-500">{text("updated")} · {date(item.updatedAt)}</span>
          </button>)}
        </div>
        <div className="min-w-0 rounded-2xl border border-white/5 bg-black/25 p-4">
          {state.detailLoading ? <p role="status" className="flex items-center gap-2 text-sm text-neutral-400"><Loader2 size={15} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />{text("loadingDetail")}</p>
            : state.detail ? <>
              <p className="break-words text-sm font-medium text-neutral-200">{state.detail.projectName}</p>
              <p className="mt-1 text-xs leading-5 text-neutral-500">{text("updated")} · {date(state.detail.updatedAt)}</p>
              <h4 className="mb-2 mt-4 text-xs font-medium text-neutral-400">{text("preview")}</h4>
              <p className="max-h-60 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-6 text-neutral-300">{state.detail.content.rawTask}</p>
              {activeSelected && <p className="mt-3 text-xs leading-5 text-amber-200">{text("activeDraft")}</p>}
            </> : <p className="text-sm leading-6 text-neutral-500">{text("select")}</p>}
        </div>
      </div>}
      {state.pending && <p role="status" className="text-sm text-neutral-400">{text(state.pending)}</p>}
    </div>
  </Modal>;
}
