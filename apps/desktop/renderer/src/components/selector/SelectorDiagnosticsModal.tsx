import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, GitCompareArrows, ShieldCheck, Timer, Workflow } from "lucide-react";

import type { SelectorPipelineDiagnostics } from "../../types";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
export { getSelectorPipelineLabel } from "./selectorPipelinePresentation";
import { getSelectorModeCopy, getSelectorPipelineLabel } from "./selectorPipelinePresentation";

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
      <p className="cf-tech-label text-[10px] uppercase text-neutral-600">{label}</p>
      <p className="mt-1 text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

export function SelectorDiagnosticsModal({
  diagnostics,
  onClose,
}: {
  diagnostics: SelectorPipelineDiagnostics;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const comparison = diagnostics.comparison;
  const requestedMode = getSelectorModeCopy(diagnostics.requestedMode, t).label;
  const effectivePipeline = diagnostics.effectivePipeline === "shadow"
    ? t("selectorDiagnostics.badges.shadow")
    : t("selectorDiagnostics.badges.legacy");
  const stateKey = diagnostics.status === "manual-review" ? "manualReview" : diagnostics.status;

  async function copyDiagnostics() {
    await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <Modal
      title={t("selectorDiagnostics.title")}
      eyebrow={t("selectorDiagnostics.eyebrow")}
      maxWidth="max-w-4xl"
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={copyDiagnostics}>
          {copied ? <Check size={15} /> : <Copy size={15} />}
          {copied ? t("selectorDiagnostics.copied") : t("selectorDiagnostics.copyJson")}
        </Button>
      }
    >
      <div className="space-y-5 p-6">
        <section className="rounded-[1.5rem] border border-neutral-900 bg-black/35 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Workflow size={16} />
                {getSelectorPipelineLabel(diagnostics, t)}
              </div>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">
                {diagnostics.selectionOrigin === "manual_override"
                  ? t("selectorDiagnostics.requestedSuggested", {
                      requested: requestedMode,
                      suggested: effectivePipeline,
                    })
                  : t("selectorDiagnostics.requestedActual", {
                      requested: requestedMode,
                      actual: effectivePipeline,
                    })}
              </p>
              {diagnostics.selectionOrigin === "manual_override" && (
                <p className="mt-2 text-xs leading-5 text-amber-200/70">
                  {t("selectorDiagnostics.manualOverrideNotice")}
                </p>
              )}
            </div>
            <span className="cf-badge">{t(`selectorDiagnostics.states.${stateKey}`)}</span>
          </div>

          {diagnostics.fallback && (
            <div className="mt-4 rounded-2xl border border-amber-500/25 bg-amber-500/5 p-4 text-sm text-amber-100">
              <strong>{t("selectorDiagnostics.fallbackTitle")} · {diagnostics.fallback.code}</strong>
              <p className="mt-1 text-amber-100/65">{diagnostics.fallback.message}</p>
            </div>
          )}

          {diagnostics.shadowFailure && (
            <div className="mt-4 rounded-2xl border border-sky-500/25 bg-sky-500/5 p-4 text-sm text-sky-100">
              <strong>{t("selectorDiagnostics.compareFailureTitle")} · {diagnostics.shadowFailure.code}</strong>
              <p className="mt-1 text-sky-100/65">{diagnostics.shadowFailure.message}</p>
            </div>
          )}
        </section>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label={t("selectorDiagnostics.metrics.area")} value={diagnostics.actual.implementationArea} />
          <Metric label={t("selectorDiagnostics.metrics.confidence")} value={`${diagnostics.actual.confidence}/100`} />
          <Metric
            label={t("selectorDiagnostics.metrics.quality")}
            value={diagnostics.actual.quality == null ? t("selectorDiagnostics.notScored") : `${diagnostics.actual.quality}/100`}
          />
          <Metric label={t("selectorDiagnostics.metrics.elapsed")} value={`${diagnostics.timings.totalMs} ms`} />
        </div>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-[1.5rem] border border-neutral-900 bg-black/35 p-5">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-white">
              <ShieldCheck size={15} /> {t("selectorDiagnostics.selectionState")}
            </h4>
            <div className="mt-4 space-y-2 text-sm text-neutral-500">
              <p>{t("selectorDiagnostics.primary")}: <span className="text-neutral-200">{diagnostics.actual.primaryTarget ?? t("selectorDiagnostics.none")}</span></p>
              <p>{t("selectorDiagnostics.safetyBlocked")}: <span className="text-neutral-200">{diagnostics.actual.blocked ? t("selectorDiagnostics.yes") : t("selectorDiagnostics.no")}</span></p>
              <p>{t("selectorDiagnostics.manualReview")}: <span className="text-neutral-200">{diagnostics.actual.manualReview ? t("selectorDiagnostics.yes") : t("selectorDiagnostics.no")}</span></p>
              <p>{t("selectorDiagnostics.missingTarget")}: <span className="text-neutral-200">{diagnostics.actual.missingTarget ? t("selectorDiagnostics.yes") : t("selectorDiagnostics.no")}</span></p>
            </div>
          </div>

          <div className="rounded-[1.5rem] border border-neutral-900 bg-black/35 p-5">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-white">
              <Timer size={15} /> {t("selectorDiagnostics.timings")}
            </h4>
            <div className="mt-4 space-y-2 text-sm text-neutral-500">
              <p>Legacy: <span className="text-neutral-200">{diagnostics.timings.legacyMs == null ? t("selectorDiagnostics.notRun") : `${diagnostics.timings.legacyMs} ms`}</span></p>
              <p>Shadow: <span className="text-neutral-200">{diagnostics.timings.shadowMs == null ? t("selectorDiagnostics.notRun") : `${diagnostics.timings.shadowMs} ms`}</span></p>
              <p>{t("selectorDiagnostics.candidates")}: <span className="text-neutral-200">{diagnostics.actual.candidateCount}</span></p>
            </div>
          </div>
        </section>

        {comparison && (
          <section className="rounded-[1.5rem] border border-neutral-900 bg-black/35 p-5">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-white">
              <GitCompareArrows size={15} /> {t("selectorDiagnostics.legacyVsShadow")}
            </h4>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label={t("selectorDiagnostics.metrics.pathOverlap")} value={`${Math.round(comparison.selectedPathOverlap * 100)}%`} />
              <Metric label={t("selectorDiagnostics.metrics.editOverlap")} value={`${Math.round(comparison.editTargetOverlap * 100)}%`} />
              <Metric label={t("selectorDiagnostics.metrics.primary")} value={comparison.primaryTargetAgreement ? t("selectorDiagnostics.agrees") : t("selectorDiagnostics.differs")} />
              <Metric label={t("selectorDiagnostics.metrics.safety")} value={comparison.safetyDecisionAgreement ? t("selectorDiagnostics.agrees") : t("selectorDiagnostics.differs")} />
            </div>
            {(comparison.legacyOnlyPaths.length > 0 || comparison.shadowOnlyPaths.length > 0) && (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-neutral-900 p-4">
                  <p className="cf-tech-label text-[10px] uppercase text-neutral-600">{t("selectorDiagnostics.legacyOnly")}</p>
                  <p className="mt-2 break-words text-xs leading-5 text-neutral-400">
                    {comparison.legacyOnlyPaths.join(", ") || t("selectorDiagnostics.none")}
                  </p>
                </div>
                <div className="rounded-2xl border border-neutral-900 p-4">
                  <p className="cf-tech-label text-[10px] uppercase text-neutral-600">{t("selectorDiagnostics.shadowOnly")}</p>
                  <p className="mt-2 break-words text-xs leading-5 text-neutral-400">
                    {comparison.shadowOnlyPaths.join(", ") || t("selectorDiagnostics.none")}
                  </p>
                </div>
              </div>
            )}
          </section>
        )}

        <section className="rounded-[1.5rem] border border-neutral-900 bg-black/35 p-5">
          <h4 className="text-sm font-semibold text-white">{t("selectorDiagnostics.selectedPaths")}</h4>
          <div className="mt-4 space-y-2">
            {diagnostics.actual.selectedFiles.length === 0 ? (
              <p className="text-sm text-neutral-600">{t("selectorDiagnostics.noFiles")}</p>
            ) : diagnostics.actual.selectedFiles.map((file) => (
              <div key={`${file.path}:${file.usage}`} className="flex items-center justify-between gap-4 rounded-xl border border-neutral-900 px-3 py-2">
                <code className="min-w-0 truncate text-xs text-neutral-300">{file.path}</code>
                <span className="cf-badge shrink-0">{file.usage}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </Modal>
  );
}
