import {
  Eye,
  GitCompareArrows,
  ScanSearch,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import type {
  ContextComposerEngineFileView,
  ContextComposerEngineView,
  ContextComposerEvidenceView,
} from "../../types";
import { WorkspaceDisclosure } from "../workspace/WorkspaceDisclosure";

export function ContextComposerEnginePanel({
  view,
  compact = false,
  onQuickPeekFile,
  onInspectFile,
  onInspectEvidence,
}: {
  view?: ContextComposerEngineView;
  compact?: boolean;
  onQuickPeekFile?: (path: string, line?: number) => void;
  onInspectFile?: (file: ContextComposerEngineFileView) => void;
  onInspectEvidence?: (
    file: ContextComposerEngineFileView,
    evidence: ContextComposerEvidenceView,
  ) => void;
}) {
  const { t } = useTranslation();
  if (!view) return null;

  const blocked = view.status === "safety_blocked";
  const warning = blocked || view.status === "legacy_fallback" || view.status === "v2_review_required";
  const evidenceCount = view.files.reduce((total, file) => total + file.evidenceIds.length, 0);
  const reviewCount = view.files.filter((file) => file.reviewRequired).length;
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
    <section className={`rounded-2xl border ${blocked ? "border-red-400/25 bg-red-400/[0.06]" : warning ? "border-amber-300/20 bg-amber-300/5" : "border-emerald-300/15 bg-emerald-300/5"} p-3`}>
      <div className="flex flex-wrap items-center gap-2">
        {warning ? <TriangleAlert size={14} className={blocked ? "text-red-300" : "text-amber-300"} /> : <ShieldCheck size={14} className="text-emerald-300" />}
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
            evidence: evidenceCount,
            review: reviewCount,
          })}
        </p>
      )}

      {!compact && (view.files.length > 0 || view.comparison) && (
        <WorkspaceDisclosure
          title={t("settings.composerEngineTechnicalDetails")}
          summary={t("settings.composerEngineCompactSummary", {
            roles: [...new Set(view.files.map((file) => t(`settings.composerEngineRole_${file.role}`)))].join(", ") || "—",
            evidence: evidenceCount,
            review: reviewCount,
          })}
          badge={<span className="cf-badge">{t("contextComposerPage.workspace.fileCount", { count: view.files.length })}</span>}
          defaultOpen={warning}
          revealWhen={warning}
          tone={blocked ? "blocking" : warning ? "attention" : "neutral"}
          className="mt-3"
          contentClassName="space-y-3"
        >
          {view.files.length > 0 ? (
            <div className="grid gap-2 md:grid-cols-2">
              {view.files.slice(0, 8).map((file) => (
            <details key={`${file.role}:${file.path}`} className="min-w-0 rounded-xl border border-white/5 bg-black/25 px-3 py-2">
              <summary className="cursor-pointer list-none">
                <div className="flex items-center gap-2">
                  <span className="cf-badge shrink-0">{t(`settings.composerEngineRole_${file.role}`)}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-neutral-300">{file.path}</span>
                  {onQuickPeekFile && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onQuickPeekFile(file.path);
                      }}
                      aria-label={t("quickPeek.title")}
                      title={t("quickPeek.title")}
                      className="grid size-6 shrink-0 place-items-center rounded-lg border border-transparent text-neutral-700 transition hover:border-white/10 hover:bg-white/[0.04] hover:text-neutral-300"
                    >
                      <Eye size={11} />
                    </button>
                  )}
                  {onInspectFile && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onInspectFile(file);
                      }}
                      aria-label={t("inspector.inspect")}
                      title={t("inspector.inspect")}
                      className="grid size-6 shrink-0 place-items-center rounded-lg border border-transparent text-neutral-700 transition hover:border-white/10 hover:bg-white/[0.04] hover:text-neutral-300"
                    >
                      <ScanSearch size={11} />
                    </button>
                  )}
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
                      <div className="flex items-start gap-1.5">
                        <p className="min-w-0 flex-1">
                          {t(`settings.composerEngineEvidenceRole_${evidence.role}`)} · {t(`settings.composerEngineStrength_${evidence.strength}`)}
                          {evidence.predicate ? ` · ${evidence.predicate}` : ""}
                        </p>
                        {onInspectEvidence && (
                          <button
                            type="button"
                            onClick={() => onInspectEvidence(file, evidence)}
                            aria-label={t("inspector.inspectEvidence")}
                            title={t("inspector.inspectEvidence")}
                            className="grid size-5 shrink-0 place-items-center rounded-md text-neutral-700 transition hover:bg-white/[0.04] hover:text-neutral-300"
                          >
                            <ScanSearch size={10} />
                          </button>
                        )}
                      </div>
                      {evidence.path && (
                        <div className="flex min-w-0 items-center gap-1.5">
                          <p className="min-w-0 flex-1 truncate text-neutral-600">
                            {evidence.path}
                            {evidence.startLine ? `:${evidence.startLine}${evidence.endLine && evidence.endLine !== evidence.startLine ? `-${evidence.endLine}` : ""}` : ""}
                          </p>
                          {onQuickPeekFile && (
                            <button
                              type="button"
                              onClick={() =>
                                onQuickPeekFile(
                                  evidence.path!,
                                  evidence.startLine,
                                )
                              }
                              aria-label={t("quickPeek.title")}
                              title={t("quickPeek.title")}
                              className="grid size-5 shrink-0 place-items-center rounded-md text-neutral-700 transition hover:bg-white/[0.04] hover:text-neutral-300"
                            >
                              <Eye size={10} />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </details>
              ))}
            </div>
          ) : null}

          {view.comparison ? (
            <div className="flex items-center gap-2 text-[10px] text-neutral-500">
              <GitCompareArrows size={12} />
              <span>{t("settings.composerEngineComparison", {
                matched: view.comparison.exactEditablePaths.length,
                disagreements: view.comparison.explicitTargetDisagreements.length,
              })}</span>
            </div>
          ) : null}
        </WorkspaceDisclosure>
      )}

      {compact && view.comparison && (
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
