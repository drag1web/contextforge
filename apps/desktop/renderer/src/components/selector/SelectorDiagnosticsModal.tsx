import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  CircleHelp,
  Copy,
  Eye,
  FileCode2,
  GitCompareArrows,
  Search,
  ShieldCheck,
  Timer,
  Workflow,
} from "lucide-react";

import type { SelectorPipelineDiagnostics } from "../../types";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
export { getSelectorPipelineLabel } from "./selectorPipelinePresentation";
import {
  getSelectorModeCopy,
  getSelectorPipelineLabel,
} from "./selectorPipelinePresentation";

function Metric({
  icon,
  label,
  value,
  caption,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  caption?: string;
}) {
  return (
    <div className="rounded-2xl border border-neutral-900 bg-black/30 p-3.5">
      <div className="flex items-center gap-2 text-neutral-600">
        {icon}
        <p className="cf-tech-label text-[9px] uppercase">{label}</p>
      </div>
      <p className="mt-2 truncate text-sm font-semibold text-white">{value}</p>
      {caption && <p className="mt-1 truncate text-[10px] text-neutral-600">{caption}</p>}
    </div>
  );
}

const ABSTENTION_ACTION_COUNTS: Record<string, number> = {
  explicit_target_missing: 3,
  no_grounded_candidates: 2,
  no_ranked_candidates: 2,
  ambiguous_target: 2,
  legacy_empty_selection: 2,
};

function isEditUsage(usage: string) {
  const normalized = usage.toLowerCase();
  return normalized.includes("edit") || normalized.includes("create");
}

function FileCard({
  file,
  editLabel,
  inspectLabel,
  evidenceLabel,
}: {
  file: SelectorPipelineDiagnostics["actual"]["selectedFiles"][number];
  editLabel: string;
  inspectLabel: string;
  evidenceLabel: string;
}) {
  const isEdit = isEditUsage(file.usage);
  return (
    <article className="rounded-2xl border border-neutral-900 bg-black/30 p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className={`grid size-8 shrink-0 place-items-center rounded-xl border ${isEdit ? "border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-300" : "border-neutral-800 bg-neutral-950 text-neutral-400"}`}>
            {isEdit ? <FileCode2 size={14} /> : <Eye size={14} />}
          </span>
          <div className="min-w-0">
            <code className="block truncate text-xs font-semibold text-neutral-200">{file.path}</code>
            <p className="mt-1 text-[10px] text-neutral-600">{isEdit ? editLabel : inspectLabel}</p>
          </div>
        </div>

        <span className="shrink-0 rounded-full border border-neutral-800 bg-neutral-950 px-2 py-1 text-[9px] font-semibold text-neutral-400">
          {evidenceLabel}
        </span>
      </div>
      <p className="mt-3 text-xs leading-5 text-neutral-500">{file.reason}</p>
    </article>
  );
}

export function SelectorDiagnosticsModal({
  diagnostics,
  onClose,
}: {
  diagnostics: SelectorPipelineDiagnostics;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const isRu = i18n.language.startsWith("ru");
  const comparison = diagnostics.comparison;
  const requestedMode = getSelectorModeCopy(diagnostics.requestedMode, t).label;
  const effectivePipeline =
    diagnostics.selectionOrigin === "explicit_target_fast_path"
      ? t("selectorDiagnostics.badges.targetFastPath")
      : diagnostics.effectivePipeline === "shadow"
        ? t("selectorDiagnostics.badges.shadow")
        : t("selectorDiagnostics.badges.legacy");
  const stateKey =
    diagnostics.status === "manual-review" ? "manualReview" : diagnostics.status;

  const editFiles = useMemo(
    () => diagnostics.actual.selectedFiles.filter((file) => isEditUsage(file.usage)),
    [diagnostics.actual.selectedFiles],
  );
  const inspectFiles = useMemo(
    () => diagnostics.actual.selectedFiles.filter((file) => !isEditUsage(file.usage)),
    [diagnostics.actual.selectedFiles],
  );

  const copy = isRu
    ? {
        overview: "Результат выбора контекста",
        overviewDescription:
          "Показывает фактически выбранные файлы, роль каждого файла и состояние безопасности.",
        primary: "Основная цель",
        files: "Выбрано файлов",
        edit: "Цели изменений",
        inspect: "Только для чтения",
        confidenceCaption: "уверенность выбора",
        elapsedCaption: "полный выбор",
        selectionState: "Состояние выбора",
        safe: "Без блокировки",
        blocked: "Заблокировано",
        review: "Нужна проверка",
        automatic: "Автоматически",
        filesTitle: "Выбранный контекст",
        filesDescription:
          "Сначала показаны цели изменений, затем вспомогательные ссылки для понимания проекта.",
        editGroup: "Цели изменений",
        editGroupDescription: "Файлы, в которых агенту разрешено искать место реализации.",
        inspectGroup: "Вспомогательный контекст",
        inspectGroupDescription: "Файлы для чтения и проверки соседнего поведения.",
        editLabel: "цель изменения",
        inspectLabel: "только чтение",
        evidence: {
          strong: "сильное основание",
          supporting: "поддержка",
          reference: "справка",
        },
        technical: "Технические детали",
        technicalDescription:
          "Режим pipeline, тайминги, сравнение Legacy/Shadow и диагностические коды.",
        requested: "Запрошенный режим",
        actual: "Фактический pipeline",
        candidates: "Кандидаты",
        comparison: "Сравнение Legacy / Shadow",
      }
    : {
        overview: "Context selection result",
        overviewDescription:
          "Shows the actual selected files, each file role and the safety state.",
        primary: "Primary target",
        files: "Selected files",
        edit: "Edit targets",
        inspect: "Read only",
        confidenceCaption: "selection confidence",
        elapsedCaption: "full selection",
        selectionState: "Selection state",
        safe: "Not blocked",
        blocked: "Blocked",
        review: "Review required",
        automatic: "Automatic",
        filesTitle: "Selected context",
        filesDescription:
          "Edit targets are shown first, followed by supporting references for project understanding.",
        editGroup: "Edit targets",
        editGroupDescription: "Files where the agent may locate the implementation change.",
        inspectGroup: "Supporting context",
        inspectGroupDescription: "Read-only files used to understand nearby behavior.",
        editLabel: "edit target",
        inspectLabel: "read only",
        evidence: {
          strong: "strong evidence",
          supporting: "supporting",
          reference: "reference",
        },
        technical: "Technical details",
        technicalDescription:
          "Pipeline mode, timings, Legacy/Shadow comparison and diagnostic codes.",
        requested: "Requested mode",
        actual: "Actual pipeline",
        candidates: "Candidates",
        comparison: "Legacy / Shadow comparison",
      };

  function abstentionMessage(
    abstention: NonNullable<SelectorPipelineDiagnostics["actual"]["abstention"]>,
  ) {
    return t(`selectorDiagnostics.abstention.messages.${abstention.code}`, {
      defaultValue: abstention.message,
    });
  }

  function abstentionActions(
    abstention: NonNullable<SelectorPipelineDiagnostics["actual"]["abstention"]>,
  ) {
    const count = ABSTENTION_ACTION_COUNTS[abstention.code] ?? abstention.nextActions.length;
    return Array.from({ length: count }, (_, index) =>
      t(`selectorDiagnostics.abstention.actions.${abstention.code}.${index + 1}`, {
        defaultValue: abstention.nextActions[index] ?? "",
      }),
    ).filter(Boolean);
  }

  async function copyDiagnostics() {
    await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  const statusTone = diagnostics.actual.blocked
    ? "border-red-400/20 bg-red-400/[0.06] text-red-200"
    : diagnostics.actual.manualReview || diagnostics.actual.missingTarget
      ? "border-amber-400/20 bg-amber-400/[0.06] text-amber-200"
      : "border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-200";

  return (
    <Modal
      title={t("selectorDiagnostics.title")}
      eyebrow={t("selectorDiagnostics.eyebrow")}
      maxWidth="max-w-5xl"
      onClose={onClose}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <p className="hidden text-[11px] text-neutral-600 md:block">
            {diagnostics.projectRef}
          </p>
          <Button variant="secondary" onClick={copyDiagnostics}>
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied ? t("selectorDiagnostics.copied") : t("selectorDiagnostics.copyJson")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 p-5">
        <section className="rounded-[1.6rem] border border-neutral-900 bg-black/35 p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <span className={`grid size-11 shrink-0 place-items-center rounded-2xl border ${statusTone}`}>
                {diagnostics.actual.blocked ? <AlertTriangle size={19} /> : <Workflow size={19} />}
              </span>
              <div className="min-w-0">
                <p className="cf-tech-label text-[9px] uppercase text-neutral-600">{copy.overview}</p>
                <h3 className="mt-1 text-base font-semibold text-white">{getSelectorPipelineLabel(diagnostics, t)}</h3>
                <p className="mt-1 max-w-2xl text-xs leading-5 text-neutral-500">{copy.overviewDescription}</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-[10px] font-semibold text-neutral-300">{effectivePipeline}</span>
              <span className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold ${statusTone}`}>
                {t(`selectorDiagnostics.states.${stateKey}`)}
              </span>
            </div>
          </div>

          {diagnostics.selectionOrigin === "manual_override" && (
            <p className="mt-4 rounded-xl border border-amber-400/15 bg-amber-400/[0.045] p-3 text-[11px] leading-5 text-amber-100/65">
              {t("selectorDiagnostics.manualOverrideNotice")}
            </p>
          )}

          {diagnostics.fallback && (
            <div className="mt-4 flex items-start gap-3 rounded-xl border border-amber-400/20 bg-amber-400/[0.055] p-3.5">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-200" />
              <div>
                <p className="text-xs font-semibold text-amber-100">{t("selectorDiagnostics.fallbackTitle")} · {diagnostics.fallback.code}</p>
                <p className="mt-1 text-[11px] leading-5 text-amber-100/60">{diagnostics.fallback.message}</p>
              </div>
            </div>
          )}

          {diagnostics.actual.outcome === "abstained" && diagnostics.actual.abstention && (
            <div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/[0.055] p-3.5">
              <div className="flex items-start gap-3">
                <CircleHelp size={16} className="mt-0.5 shrink-0 text-amber-200" />
                <div>
                  <p className="text-xs font-semibold text-amber-100">{t("selectorDiagnostics.abstention.title")}</p>
                  <p className="mt-1 text-[11px] leading-5 text-amber-100/60">{abstentionMessage(diagnostics.actual.abstention)}</p>
                  {abstentionActions(diagnostics.actual.abstention).length > 0 && (
                    <ul className="mt-3 space-y-1 text-[11px] leading-5 text-amber-100/60">
                      {abstentionActions(diagnostics.actual.abstention).map((action) => <li key={action}>• {action}</li>)}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric icon={<Search size={13} />} label={copy.primary} value={diagnostics.actual.primaryTarget ?? t("selectorDiagnostics.none")} caption={diagnostics.actual.implementationArea} />
          <Metric icon={<FileCode2 size={13} />} label={copy.files} value={String(diagnostics.actual.selectedFiles.length)} caption={`${editFiles.length} / ${inspectFiles.length}`} />
          <Metric icon={<ShieldCheck size={13} />} label={t("selectorDiagnostics.metrics.confidence")} value={`${diagnostics.actual.confidence}/100`} caption={copy.confidenceCaption} />
          <Metric icon={<Timer size={13} />} label={t("selectorDiagnostics.metrics.elapsed")} value={`${diagnostics.timings.totalMs} ms`} caption={copy.elapsedCaption} />
        </div>

        <section className="rounded-[1.5rem] border border-neutral-900 bg-black/30 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <ShieldCheck size={15} className={diagnostics.actual.blocked ? "text-red-300" : "text-emerald-300"} />
                <h3 className="text-sm font-semibold text-white">{copy.selectionState}</h3>
              </div>
              <p className="mt-1 text-[11px] leading-5 text-neutral-600">
                {diagnostics.actual.blocked ? copy.blocked : diagnostics.actual.manualReview ? copy.review : copy.safe}
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2 sm:min-w-[390px]">
              <div className="rounded-xl border border-neutral-900 bg-black/35 px-3 py-2">
                <p className="text-[9px] uppercase text-neutral-600">{copy.edit}</p>
                <p className="mt-1 text-xs font-semibold text-white">{editFiles.length}</p>
              </div>
              <div className="rounded-xl border border-neutral-900 bg-black/35 px-3 py-2">
                <p className="text-[9px] uppercase text-neutral-600">{copy.inspect}</p>
                <p className="mt-1 text-xs font-semibold text-white">{inspectFiles.length}</p>
              </div>
              <div className="rounded-xl border border-neutral-900 bg-black/35 px-3 py-2">
                <p className="text-[9px] uppercase text-neutral-600">{copy.candidates}</p>
                <p className="mt-1 text-xs font-semibold text-white">{diagnostics.actual.candidateCount}</p>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-[1.5rem] border border-neutral-900 bg-black/25 p-4">
          <div>
            <h3 className="text-sm font-semibold text-white">{copy.filesTitle}</h3>
            <p className="mt-1 text-[11px] leading-5 text-neutral-600">{copy.filesDescription}</p>
          </div>

          {diagnostics.actual.selectedFiles.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-neutral-800 bg-black/20 p-5 text-xs text-neutral-600">{t("selectorDiagnostics.noFiles")}</div>
          ) : (
            <div className="mt-4 space-y-4">
              {editFiles.length > 0 && (
                <div>
                  <div className="mb-2">
                    <p className="text-xs font-semibold text-white">{copy.editGroup}</p>
                    <p className="mt-1 text-[10px] text-neutral-600">{copy.editGroupDescription}</p>
                  </div>
                  <div className="grid gap-3 lg:grid-cols-2">
                    {editFiles.map((file) => (
                      <FileCard key={`${file.path}:${file.usage}`} file={file} editLabel={copy.editLabel} inspectLabel={copy.inspectLabel} evidenceLabel={copy.evidence[file.evidenceStrength]} />
                    ))}
                  </div>
                </div>
              )}

              {inspectFiles.length > 0 && (
                <div>
                  <div className="mb-2">
                    <p className="text-xs font-semibold text-white">{copy.inspectGroup}</p>
                    <p className="mt-1 text-[10px] text-neutral-600">{copy.inspectGroupDescription}</p>
                  </div>
                  <div className="grid gap-3 lg:grid-cols-2">
                    {inspectFiles.map((file) => (
                      <FileCard key={`${file.path}:${file.usage}`} file={file} editLabel={copy.editLabel} inspectLabel={copy.inspectLabel} evidenceLabel={copy.evidence[file.evidenceStrength]} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        <section className="overflow-hidden rounded-[1.5rem] border border-neutral-900 bg-black/25">
          <button
            type="button"
            onClick={() => setShowTechnicalDetails((value) => !value)}
            className="flex w-full items-center justify-between gap-4 px-4 py-3.5 text-left transition hover:bg-white/[0.025]"
          >
            <div>
              <p className="text-xs font-semibold text-white">{copy.technical}</p>
              <p className="mt-1 text-[10px] leading-4 text-neutral-600">{copy.technicalDescription}</p>
            </div>
            <ChevronDown size={15} className={`shrink-0 text-neutral-500 transition-transform ${showTechnicalDetails ? "rotate-180" : ""}`} />
          </button>

          {showTechnicalDetails && (
            <div className="space-y-3 border-t border-neutral-900 p-4">
              <div className="grid gap-3 md:grid-cols-3">
                <Metric icon={<Workflow size={13} />} label={copy.requested} value={requestedMode} />
                <Metric icon={<ShieldCheck size={13} />} label={copy.actual} value={effectivePipeline} />
                <Metric icon={<Timer size={13} />} label={t("selectorDiagnostics.timings")} value={`Legacy ${diagnostics.timings.legacyMs ?? "—"} · Shadow ${diagnostics.timings.shadowMs ?? "—"}`} />
              </div>

              {diagnostics.shadowFailure && (
                <div className="rounded-xl border border-sky-400/15 bg-sky-400/[0.045] p-3 text-[11px] leading-5 text-sky-100/65">
                  <strong className="text-sky-100">{t("selectorDiagnostics.compareFailureTitle")} · {diagnostics.shadowFailure.code}</strong>
                  <p className="mt-1">{diagnostics.shadowFailure.message}</p>
                </div>
              )}

              {comparison && (
                <div className="rounded-xl border border-neutral-900 bg-black/35 p-3">
                  <div className="flex items-center gap-2">
                    <GitCompareArrows size={14} className="text-neutral-500" />
                    <p className="text-xs font-semibold text-white">{copy.comparison}</p>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
                    <div className="rounded-lg border border-neutral-900 bg-black/30 p-2.5"><p className="text-[9px] uppercase text-neutral-600">{t("selectorDiagnostics.metrics.pathOverlap")}</p><p className="mt-1 text-xs font-semibold text-white">{Math.round(comparison.selectedPathOverlap * 100)}%</p></div>
                    <div className="rounded-lg border border-neutral-900 bg-black/30 p-2.5"><p className="text-[9px] uppercase text-neutral-600">{t("selectorDiagnostics.metrics.editOverlap")}</p><p className="mt-1 text-xs font-semibold text-white">{Math.round(comparison.editTargetOverlap * 100)}%</p></div>
                    <div className="rounded-lg border border-neutral-900 bg-black/30 p-2.5"><p className="text-[9px] uppercase text-neutral-600">{t("selectorDiagnostics.metrics.primary")}</p><p className="mt-1 text-xs font-semibold text-white">{comparison.primaryTargetAgreement ? t("selectorDiagnostics.agrees") : t("selectorDiagnostics.differs")}</p></div>
                    <div className="rounded-lg border border-neutral-900 bg-black/30 p-2.5"><p className="text-[9px] uppercase text-neutral-600">{t("selectorDiagnostics.metrics.safety")}</p><p className="mt-1 text-xs font-semibold text-white">{comparison.safetyDecisionAgreement ? t("selectorDiagnostics.agrees") : t("selectorDiagnostics.differs")}</p></div>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}
