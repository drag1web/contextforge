import { ArrowLeftRight, History, Loader2, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRef, type ReactNode } from "react";
import type { TaskPackReviewState } from "../../types";
import type { RevisionComparisonSide, TaskPackRevisionHistorySnapshot } from "../../utils/taskPackRevisionHistory";
import { TaskPackRevisionComparison } from "./TaskPackRevisionComparison";
import { Button } from "../ui/Button";

interface Props extends TaskPackRevisionHistorySnapshot {
  onRefresh: () => Promise<void>;
  onRetryHistory: () => Promise<void>;
  onSelectRevision: (revisionId: number) => Promise<void>;
  onRetryDetail: () => Promise<void>;
  onStartComparison: (revisionId: number) => void;
  onChooseComparisonRevision: (side: RevisionComparisonSide, revisionId: number) => void;
  onCompareSelectedRevisions: () => Promise<void>;
  onSwapComparisonSides: () => void;
  onClearComparison: () => void;
  onRetryComparison: () => Promise<void>;
}

/** Review-only presentation; never invent an aggregate lifecycle for a revision. */
function RevisionReviewBadge({ state }: { state: TaskPackReviewState }) {
  const { t } = useTranslation();
  const tone = state === "accepted" ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
    : state === "in_review" || state === "changes_requested" ? "border-amber-400/20 bg-amber-400/10 text-amber-200"
      : "border-white/10 bg-white/[0.04] text-neutral-300";
  return <span className={`inline-flex rounded-lg border px-2 py-1 text-[11px] font-medium ${tone}`}>
    {t(`taskPackWorkflow.review.${state}`)}
  </span>;
}

function Metadata({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0"><dt className="text-xs text-neutral-500">{label}</dt>
    <dd className="mt-1 break-words text-xs text-neutral-300">{children}</dd></div>;
}

/** Pure read surface: callbacks can only read history/detail, never edit or transition. */
export function TaskPackRevisionHistoryPanel({ status, history, selectedRevisionId, detailStatus, detail,
  detailUnavailable, comparison, onRefresh, onRetryHistory, onSelectRevision, onRetryDetail,
  onStartComparison, onChooseComparisonRevision, onCompareSelectedRevisions, onSwapComparisonSides, onClearComparison, onRetryComparison }: Props) {
  const { t, i18n } = useTranslation();
  const date = (value: string) => <time dateTime={value}>{new Date(value).toLocaleString(i18n.language)}</time>;
  const item = detail?.revision;
  const comparisonTrigger = useRef<HTMLButtonElement | null>(null);
  function exitComparison() {
    onClearComparison();
    comparisonTrigger.current?.focus(); // existing row button survives comparison unmount
  }
  return <section data-task-pack-revision-history className="mt-6 rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:p-5"
    aria-label={t("taskPackRevisionHistory.title")}>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-200">
        <History size={16} aria-hidden="true" />{t("taskPackRevisionHistory.title")}
      </h2>
      <Button variant="ghost" onClick={() => void onRefresh()} disabled={status === "loading" || status === "idle"}
        className="gap-2 text-xs"><RefreshCw size={13} aria-hidden="true" />{t("taskPackRevisionHistory.refresh")}</Button>
    </div>
    {(status === "idle" || status === "loading") && <p role="status" className="flex items-center gap-2 text-sm text-neutral-400">
      <Loader2 size={14} className="animate-spin" aria-hidden="true" />{t("taskPackRevisionHistory.loadingHistory")}</p>}
    {status === "failed" && <div role="status" className="space-y-3 text-sm text-neutral-400">
      <p>{t("taskPackRevisionHistory.historyUnavailable")}</p>
      <Button variant="secondary" onClick={() => void onRetryHistory()}>{t("taskPackRevisionHistory.retry")}</Button>
    </div>}
    {status === "ready" && history && (history.revisions.length === 0
      ? <p className="text-sm text-neutral-400">{t("taskPackRevisionHistory.empty")}</p>
      : <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <ul className="min-w-0 space-y-2" aria-label={t("taskPackRevisionHistory.title")}>
          {history.revisions.map(revision => <li key={revision.id}>
            <button type="button" aria-pressed={selectedRevisionId === revision.id} onClick={() => void onSelectRevision(revision.id)}
              className={`w-full rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${selectedRevisionId === revision.id
                ? "border-white/25 bg-white/[0.08]" : "border-white/10 bg-white/[0.02] hover:bg-white/[0.06]"}`}>
              <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-neutral-200">
                {t("taskPackRevisionHistory.revision", { number: revision.revisionNumber })}
                {revision.id === history.currentRevisionId && <span className="text-xs text-neutral-400">{t("taskPackRevisionHistory.current")}</span>}
                <RevisionReviewBadge state={revision.reviewState} />
              </span>
              <span className="mt-2 block text-xs leading-relaxed text-neutral-400">
                {t("taskPackRevisionHistory.source")}: {t(`taskPackRevisionHistory.sources.${revision.sourceKind}`)}
              </span>
              <span className="block text-xs leading-relaxed text-neutral-500">{t("taskPackRevisionHistory.created")}: {date(revision.createdAt)}</span>
              {revision.generatedAt !== null && <span className="block text-xs leading-relaxed text-neutral-500">
                {t("taskPackRevisionHistory.generated")}: {date(revision.generatedAt)}</span>}
              <span className="mt-1 block break-words text-xs text-neutral-500">
                {t("taskPackRevisionHistory.mode")}: {t(`taskPackRevisionHistory.modes.${revision.generationMode}`)}
                {revision.generationModel !== null && <> · {t("taskPackRevisionHistory.model")}: {revision.generationModel}</>}
              </span>
            </button>
            <Button variant="ghost" className="mt-1 gap-1.5 text-xs" disabled={history.revisions.length < 2}
              aria-label={t("taskPackRevisionComparison.compareRevision", { number: revision.revisionNumber })}
              onClick={event => { comparisonTrigger.current = event.currentTarget; onStartComparison(revision.id); }}>
              <ArrowLeftRight size={12} aria-hidden="true" />{t("taskPackRevisionComparison.compare")}
            </Button>
          </li>)}
        </ul>
        <div className="min-w-0" aria-live="polite" data-revision-detail>
          {comparison.active && <TaskPackRevisionComparison history={history} comparison={comparison}
            onChooseRevision={onChooseComparisonRevision} onCompare={onCompareSelectedRevisions}
            onSwap={onSwapComparisonSides} onExit={exitComparison} onRetry={onRetryComparison} />}
          {!comparison.active && <>
          {detailStatus === "idle" && <p className="text-sm text-neutral-400">{t("taskPackRevisionHistory.select")}</p>}
          {detailStatus === "loading" && <p role="status" className="flex items-center gap-2 text-sm text-neutral-400">
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />{t("taskPackRevisionHistory.loadingRevision")}</p>}
          {detailStatus === "failed" && <div role="status" className="space-y-3 text-sm text-neutral-400">
            <p>{t(detailUnavailable ? "taskPackRevisionHistory.revisionNotFound" : "taskPackRevisionHistory.revisionUnavailable")}</p>
            <Button variant="secondary" onClick={() => void onRetryDetail()}>{t("taskPackRevisionHistory.retry")}</Button>
          </div>}
          {detailStatus === "ready" && detail && item && <article data-historical-revision className="min-w-0 space-y-5">
            <header className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-neutral-200">{t("taskPackRevisionHistory.revision", { number: item.revisionNumber })}</h3>
                <span className="rounded-md border border-white/10 px-2 py-1 text-xs text-neutral-400">{t("taskPackRevisionHistory.readOnly")}</span>
                <RevisionReviewBadge state={item.reviewState} />
              </div>
              <p className="text-xs leading-relaxed text-neutral-500">
                {t(item.id === detail.currentRevisionId ? "taskPackRevisionHistory.currentReadOnly" : "taskPackRevisionHistory.historical")}
              </p>
            </header>
            <dl className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
              <Metadata label={t("taskPackRevisionHistory.source")}>{t(`taskPackRevisionHistory.sources.${item.sourceKind}`)}</Metadata>
              <Metadata label={t("taskPackWorkflow.reviewLabel")}><RevisionReviewBadge state={item.reviewState} /></Metadata>
              <Metadata label={t("taskPackRevisionHistory.created")}>{date(item.createdAt)}</Metadata>
              <Metadata label={t("taskPackRevisionHistory.generated")}>{item.generatedAt === null ? "—" : date(item.generatedAt)}</Metadata>
              <Metadata label={t("taskPackResult.taskType")}>{item.taskType}</Metadata>
              <Metadata label={t("taskPackResult.target")}>{item.targetTool}</Metadata>
              <Metadata label={t("taskPackRevisionHistory.mode")}>{t(`taskPackRevisionHistory.modes.${item.generationMode}`)}</Metadata>
              <Metadata label={t("taskPackRevisionHistory.model")}>{item.generationModel ?? "—"}</Metadata>
              <Metadata label={t("taskPackRevisionHistory.fallback")}>{t(item.generationUsedFallback ? "taskPackRevisionHistory.yes" : "taskPackRevisionHistory.no")}</Metadata>
              <Metadata label={t("taskPackRevisionHistory.baseId")}>{item.baseRevisionId ?? "—"}</Metadata>
              <div className="min-w-0 sm:col-span-2"><Metadata label={t("taskPackRevisionHistory.hash")}>
                <span className="break-all font-mono">{item.contentHash}</span></Metadata></div>
            </dl>
            <section aria-label={t("taskPackRevisionHistory.rawTask")}>
              <h4 className="mb-2 text-xs font-semibold text-neutral-300">{t("taskPackRevisionHistory.rawTask")}</h4>
              <pre data-historical-raw-task tabIndex={0} aria-label={t("taskPackRevisionHistory.rawTask")}
                className="max-h-96 min-w-0 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-white/10 bg-black/15 p-4 text-sm leading-relaxed text-neutral-300">{item.rawTask}</pre>
            </section>
            <section aria-label={t("taskPackRevisionHistory.generatedDocument")}>
              <h4 className="mb-2 text-xs font-semibold text-neutral-300">{t("taskPackRevisionHistory.generatedDocument")}</h4>
              <pre data-historical-generated-document tabIndex={0} aria-label={t("taskPackRevisionHistory.generatedDocument")}
                className="max-h-96 min-w-0 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-white/10 bg-black/15 p-4 text-sm leading-relaxed text-neutral-300">{item.generatedPrompt}</pre>
            </section>
          </article>}
          </>}
        </div>
      </div>)}
  </section>;
}
