import { GitCompareArrows, ShieldCheck, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { ContextComposerEngineView } from "../../types";

export function ContextComposerEnginePanel({
  view,
  compact = false,
}: {
  view?: ContextComposerEngineView;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  if (!view) return null;

  const warning = view.status === "safety_blocked" || view.status === "legacy_fallback" || view.status === "v2_review_required";
  const reasonText = (reasonCode: string) => t(`settings.composerEngineReason_${reasonCode}`, {
    defaultValue: t("settings.composerEngineReason_v2_not_grounded"),
  });
  const stopText = view.stopReason
    ? t(`settings.composerEngineStop_${view.stopReason}`, {
        defaultValue: t("settings.composerEngineStop_unknown"),
      })
    : null;
  const primaryReasonCode = view.files[0]?.reasonCode ?? view.fallbackReason ?? view.limitations[0] ?? null;

  return (
    <section className={`rounded-2xl border ${warning ? "border-amber-300/20 bg-amber-300/5" : "border-emerald-300/15 bg-emerald-300/5"} p-3`}>
      <div className="flex flex-wrap items-center gap-2">
        {warning ? <TriangleAlert size={14} className="text-amber-300" /> : <ShieldCheck size={14} className="text-emerald-300" />}
        <span className="text-xs font-semibold text-white">{t("settings.composerEnginePanelTitle")}</span>
        <span className="cf-badge">{t(`settings.composerEngineMode_${view.requestedMode}`)}</span>
        <span className="cf-badge">{t(`settings.composerEngineStatus_${view.status}`)}</span>
        <span className="text-[11px] text-neutral-500">
          {t("settings.composerEngineSource", { source: t(`settings.composerEngineSource_${view.effectiveSource}`) })}
        </span>
        {stopText && <span className="text-[11px] text-neutral-500">{stopText}</span>}
      </div>

      {primaryReasonCode && (
        <p className="mt-2 text-[11px] leading-5 text-neutral-500">{reasonText(primaryReasonCode)}</p>
      )}

      {compact && view.files.length > 0 && (
        <p className="mt-2 text-[10px] text-neutral-600">
          {t("settings.composerEngineCompactSummary", {
            roles: [...new Set(view.files.map((file) => t(`settings.composerEngineRole_${file.role}`)))].join(", "),
            evidence: view.files.reduce((total, file) => total + file.evidenceIds.length, 0),
            review: view.files.filter((file) => file.reviewRequired).length,
          })}
        </p>
      )}

      {!compact && view.files.length > 0 && (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {view.files.slice(0, 8).map((file) => (
            <details key={`${file.role}:${file.path}`} className="min-w-0 rounded-xl border border-white/5 bg-black/25 px-3 py-2">
              <summary className="cursor-pointer list-none">
                <div className="flex items-center gap-2">
                  <span className="cf-badge shrink-0">{t(`settings.composerEngineRole_${file.role}`)}</span>
                  <span className="truncate text-xs text-neutral-300">{file.path}</span>
                  {file.reviewRequired && <span className="text-[10px] text-amber-300">{t("settings.composerEngineReview")}</span>}
                </div>
                <p className="mt-1 line-clamp-2 text-[10px] text-neutral-500">
                  {reasonText(file.reasonCode)} · {t("settings.composerEngineEvidenceCount", { count: file.evidenceIds.length })}
                </p>
              </summary>

              {file.evidence.length > 0 && (
                <div className="mt-2 space-y-2 border-t border-white/5 pt-2">
                  {file.evidence.map((evidence) => (
                    <div key={evidence.evidenceId} className="text-[10px] leading-4 text-neutral-500">
                      <p>
                        {t(`settings.composerEngineEvidenceRole_${evidence.role}`)} · {t(`settings.composerEngineStrength_${evidence.strength}`)}
                        {evidence.predicate ? ` · ${evidence.predicate}` : ""}
                      </p>
                      {evidence.path && (
                        <p className="truncate text-neutral-600">
                          {evidence.path}
                          {evidence.startLine ? `:${evidence.startLine}${evidence.endLine && evidence.endLine !== evidence.startLine ? `-${evidence.endLine}` : ""}` : ""}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </details>
          ))}
        </div>
      )}

      {view.comparison && (
        <div className="mt-2 flex items-center gap-2 text-[10px] text-neutral-600">
          <GitCompareArrows size={12} />
          <span>{t("settings.composerEngineComparison", {
            matched: view.comparison.exactEditablePaths.length,
            disagreements: view.comparison.explicitTargetDisagreements.length,
          })}</span>
        </div>
      )}
    </section>
  );
}
