import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftRight, Loader2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TaskPackRevisionDetail, TaskPackRevisionHistory } from "../../types";
import { compareTaskPackRevisions, type RevisionTextComparison, type RevisionTextLine,
  type RevisionChangeKind, type RevisionScalarField } from "../../utils/taskPackRevisionComparison";
import type { RevisionComparisonSide, TaskPackRevisionComparisonState } from "../../utils/taskPackRevisionHistory";
import { Button } from "../ui/Button";

interface Props {
  history: TaskPackRevisionHistory;
  comparison: TaskPackRevisionComparisonState;
  onChooseRevision: (side: RevisionComparisonSide, revisionId: number) => void;
  onCompare: () => Promise<void>;
  onSwap: () => void;
  onExit: () => void;
  onRetry: () => Promise<void>;
}
function ChangeLabel({ kind }: { kind: RevisionChangeKind }) {
  const { t } = useTranslation();
  return <span className="text-xs font-medium text-neutral-400">{t(`taskPackRevisionComparison.changes.${kind}`)}</span>;
}
function RevisionHeader({ detail, side }: { detail: TaskPackRevisionDetail; side: RevisionComparisonSide }) {
  const { t, i18n } = useTranslation();
  const revision = detail.revision;
  return <header className="min-w-0 space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-3" data-comparison-side={side}>
    <p className="text-xs font-medium text-neutral-500">{t(`taskPackRevisionComparison.${side}`)}</p>
    <h4 className="text-sm font-semibold text-neutral-200">{t("taskPackRevisionHistory.revision", { number: revision.revisionNumber })}</h4>
    <div className="flex flex-wrap gap-2 text-xs text-neutral-400">
      <span>{t(revision.id === detail.currentRevisionId ? "taskPackRevisionHistory.current" : "taskPackRevisionComparison.historical")}</span>
      <span className="rounded-md border border-white/10 px-1.5" aria-label={t("taskPackWorkflow.reviewLabel")}>
        {t(`taskPackWorkflow.review.${revision.reviewState}`)}</span>
    </div>
    <p className="text-xs text-neutral-500">{t("taskPackRevisionHistory.source")}: {t(`taskPackRevisionHistory.sources.${revision.sourceKind}`)}</p>
    <p className="text-xs text-neutral-500">{t("taskPackRevisionHistory.created")}: <time dateTime={revision.createdAt}>{new Date(revision.createdAt).toLocaleString(i18n.language)}</time></p>
    {revision.generatedAt !== null && <p className="text-xs text-neutral-500">{t("taskPackRevisionHistory.generated")}: <time dateTime={revision.generatedAt}>{new Date(revision.generatedAt).toLocaleString(i18n.language)}</time></p>}
    <p className="break-words text-xs text-neutral-500">{t("taskPackRevisionHistory.mode")}: {t(`taskPackRevisionHistory.modes.${revision.generationMode}`)}
      {revision.generationModel !== null && <> · {t("taskPackRevisionHistory.model")}: {revision.generationModel}</>}</p>
    <p className="break-all font-mono text-[10px] text-neutral-600">{t("taskPackRevisionHistory.hash")}: {revision.contentHash}</p>
  </header>;
}

function DiffLine({ line, side, kind, showWhitespace }: { line: RevisionTextLine | null; side: RevisionComparisonSide;
  kind: "equal" | "changed" | "added" | "removed"; showWhitespace: boolean }) {
  const { t } = useTranslation();
  const semantic = kind === "equal" ? "unchanged" : side === "left" ? "removed" : "added";
  const marker = semantic === "unchanged" ? "=" : semantic === "removed" ? "−" : "+";
  const tone = !line || semantic === "unchanged" ? "bg-white/[0.02]" : semantic === "removed" ? "bg-red-400/[0.07]" : "bg-emerald-400/[0.07]";
  return <div className={`min-w-0 border-t border-white/5 px-3 py-2 ${tone}`} data-diff-side={side}>
    {line ? <>
      <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] text-neutral-500">
        <span>{t(`taskPackRevisionComparison.${side}`)}</span>
        <span aria-hidden="true">{marker}</span><span>{t(`taskPackRevisionComparison.changes.${semantic}`)}</span>
        <span>{t("taskPackRevisionComparison.line", { number: line.number })}</span>
        <span>{line.ending === "" ? t("taskPackRevisionComparison.noEnding") : line.ending === "\r\n" ? "CRLF" : line.ending === "\r" ? "CR" : "LF"}</span>
      </div>
      <pre className="min-h-5 whitespace-pre-wrap break-words text-xs leading-relaxed text-neutral-300">{showWhitespace
        ? line.content.replace(/ /gu, "·").replace(/\t/gu, "⇥") : line.content}</pre>
    </> : <span className="text-xs text-neutral-600" aria-label={t("taskPackRevisionComparison.noLine")}>—</span>}
  </div>;
}

function TextComparison({ value, title, field, showWhitespace }: { value: RevisionTextComparison; title: string;
  field: "rawTask" | "generatedPrompt"; showWhitespace: boolean }) {
  const { t } = useTranslation();
  return <section className="min-w-0 space-y-2" aria-label={title} data-comparison-field={field}>
    <div className="flex flex-wrap items-center gap-2"><h4 className="text-sm font-semibold text-neutral-300">{title}</h4><ChangeLabel kind={value.kind} /></div>
    {value.mode === "side_by_side" ? <>
      <p className="text-xs leading-relaxed text-neutral-500">{t("taskPackRevisionComparison.largeFallback")}</p>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2" data-diff-mode="side_by_side">
        {(["left", "right"] as const).map(side => <div key={side} className="min-w-0">
          <h5 className="mb-2 text-xs text-neutral-500">{t(`taskPackRevisionComparison.${side}`)}</h5>
          <pre data-full-text={side} className="whitespace-pre-wrap break-words rounded-xl border border-white/10 bg-black/15 p-3 text-xs leading-relaxed text-neutral-300">{side === "left" ? value.leftText : value.rightText}</pre>
        </div>)}
      </div>
    </> : <div className="min-w-0 overflow-hidden rounded-xl border border-white/10" data-diff-mode="line_diff">
      <div className="grid grid-cols-1 gap-1 px-3 py-2 text-xs text-neutral-500 sm:grid-cols-2">
        <span>{t("taskPackRevisionComparison.left")}</span><span>{t("taskPackRevisionComparison.right")}</span>
      </div>
      {value.rows.length === 0 && <p className="px-3 py-2 text-xs text-neutral-500">{t("taskPackRevisionComparison.noDifferences")}</p>}
      {value.rows.map((row, index) => <div key={index} data-diff-kind={row.kind} className="grid min-w-0 grid-cols-1 sm:grid-cols-2">
        <DiffLine line={row.left} side="left" kind={row.kind} showWhitespace={showWhitespace} />
        <DiffLine line={row.right} side="right" kind={row.kind} showWhitespace={showWhitespace} />
      </div>)}
    </div>}
  </section>;
}

/** Historical read-only surface; selection/swap/retry are local/read operations, never workflow authority. */
export function TaskPackRevisionComparison({ history, comparison, onChooseRevision, onCompare, onSwap, onExit, onRetry }: Props) {
  const { t } = useTranslation();
  const [showWhitespace, setShowWhitespace] = useState(false);
  const rightSelect = useRef<HTMLSelectElement>(null);
  useEffect(() => { if (comparison.rightRevisionId === null) rightSelect.current?.focus(); }, [comparison.leftRevisionId, comparison.rightRevisionId]);
  const model = useMemo(() => comparison.status === "ready" && comparison.leftDetail && comparison.rightDetail
    ? compareTaskPackRevisions(comparison.leftDetail, comparison.rightDetail) : null,
  [comparison.status, comparison.leftDetail, comparison.rightDetail]);
  const readyPair = comparison.leftRevisionId !== null && comparison.rightRevisionId !== null;
  const labels: Record<RevisionScalarField, string> = { taskType: "taskPackResult.taskType", targetTool: "taskPackResult.target",
    sourceKind: "taskPackRevisionHistory.source", generationMode: "taskPackRevisionHistory.mode",
    generationModel: "taskPackRevisionHistory.model", generationUsedFallback: "taskPackRevisionHistory.fallback" };
  const scalarValue = (field: RevisionScalarField, value: string | boolean | null) => value === null
    ? t("taskPackRevisionComparison.notSet") : typeof value === "boolean"
      ? t(value ? "taskPackRevisionHistory.yes" : "taskPackRevisionHistory.no") : field === "sourceKind"
        ? t(`taskPackRevisionHistory.sources.${value}`) : field === "generationMode"
          ? t(`taskPackRevisionHistory.modes.${value}`) : value === "" ? t("taskPackRevisionComparison.emptyValue") : value;
  return <section className="min-w-0 space-y-4" data-revision-comparison aria-label={t("taskPackRevisionComparison.title")}>
    <header className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold text-neutral-200">{t("taskPackRevisionComparison.title")}</h3>
      <Button variant="ghost" onClick={onExit} className="gap-1.5 text-xs"><X size={13} aria-hidden="true" />{t("taskPackRevisionComparison.exit")}</Button>
    </header>
    <p className="text-xs leading-relaxed text-neutral-500">{t("taskPackRevisionComparison.orderHint")}</p>
    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
      {(["left", "right"] as const).map(side => <label key={side} className="min-w-0 space-y-1.5 text-xs text-neutral-400">
        <span className="block">{t(`taskPackRevisionComparison.${side}`)}</span>
        <select ref={side === "right" ? rightSelect : undefined} aria-label={t(`taskPackRevisionComparison.${side}`)}
          className="w-full min-w-0 rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          value={(side === "left" ? comparison.leftRevisionId : comparison.rightRevisionId) ?? ""}
          onChange={event => onChooseRevision(side, Number(event.target.value))}>
          <option value="" disabled>{t(side === "left" ? "taskPackRevisionComparison.selectFirst" : "taskPackRevisionComparison.selectSecond")}</option>
          {history.revisions.map(revision => <option key={revision.id} value={revision.id}
            disabled={revision.id === (side === "left" ? comparison.rightRevisionId : comparison.leftRevisionId)}>
            {t("taskPackRevisionHistory.revision", { number: revision.revisionNumber })}
          </option>)}
        </select>
      </label>)}
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" disabled={!readyPair || comparison.status === "loading"} onClick={() => void onCompare()}>{t("taskPackRevisionComparison.compare")}</Button>
      <Button variant="ghost" disabled={!readyPair || comparison.status === "loading"} onClick={onSwap} className="gap-2 text-xs">
        <ArrowLeftRight size={13} aria-hidden="true" />{t("taskPackRevisionComparison.swap")}</Button>
    </div>
    {comparison.status === "idle" && <p role="status" className="text-sm text-neutral-400">
      {t(readyPair ? "taskPackRevisionComparison.readyToCompare" : "taskPackRevisionComparison.selectSecond")}</p>}
    {comparison.status === "loading" && <p role="status" className="flex items-center gap-2 text-sm text-neutral-400">
      <Loader2 size={14} className="animate-spin" aria-hidden="true" />{t("taskPackRevisionComparison.loading")}</p>}
    {comparison.status === "failed" && <div role="status" className="space-y-2 text-sm text-neutral-400">
      <p>{t("taskPackRevisionComparison.unavailable")}</p>
      {(["left", "right"] as const).map(side => comparison[`${side}Issue`] !== null && <p key={side} className="text-xs">
        {t(`taskPackRevisionComparison.${side}`)}: {t(comparison[`${side}Issue`] === "unavailable"
          ? "taskPackRevisionHistory.revisionNotFound" : "taskPackRevisionHistory.revisionUnavailable")}</p>)}
      <Button variant="secondary" onClick={() => void onRetry()}>{t("taskPackRevisionComparison.retry")}</Button>
    </div>}
    {model && comparison.leftDetail && comparison.rightDetail && <div className="min-w-0 space-y-5">
      <div className="grid min-w-0 gap-3 sm:grid-cols-2"><RevisionHeader side="left" detail={comparison.leftDetail} /><RevisionHeader side="right" detail={comparison.rightDetail} /></div>
      {!model.hasContentChanges && <p className="text-sm text-neutral-400">{t("taskPackRevisionComparison.noDifferences")}</p>}
      <section aria-label={t("taskPackRevisionComparison.scalarTitle")} className="space-y-2">
        <h4 className="text-sm font-semibold text-neutral-300">{t("taskPackRevisionComparison.scalarTitle")}</h4>
        {model.scalarChanges.map(change => <div key={change.field} className="min-w-0 rounded-xl border border-white/10 p-3" data-scalar-field={change.field}>
          <div className="mb-2 flex flex-wrap gap-2"><span className="text-xs font-medium text-neutral-400">{t(labels[change.field])}</span><ChangeLabel kind={change.kind} /></div>
          <dl className="grid min-w-0 gap-2 text-xs sm:grid-cols-2">
            {(["left", "right"] as const).map(side => <div key={side} className="min-w-0"><dt className="text-neutral-500">{t(`taskPackRevisionComparison.${side}`)}</dt>
              <dd className="mt-1 whitespace-pre-wrap break-words text-neutral-300">{scalarValue(change.field, change[side])}</dd></div>)}
          </dl>
        </div>)}
      </section>
      <label className="flex items-center gap-2 text-xs text-neutral-400"><input type="checkbox" checked={showWhitespace} onChange={event => setShowWhitespace(event.target.checked)} />{t("taskPackRevisionComparison.showWhitespace")}</label>
      {showWhitespace && <p className="text-xs text-neutral-500">{t("taskPackRevisionComparison.whitespaceHint")}</p>}
      <TextComparison value={model.rawTask} field="rawTask" title={t("taskPackRevisionHistory.rawTask")} showWhitespace={showWhitespace} />
      <TextComparison value={model.generatedPrompt} field="generatedPrompt" title={t("taskPackRevisionHistory.generatedDocument")} showWhitespace={showWhitespace} />
    </div>}
  </section>;
}
