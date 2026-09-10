import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Copy,
  FileCheck2,
  Gauge,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Timer,
} from "lucide-react";

import type {
  TaskPackGenerationDiagnostics,
  TaskPackGenerationFailureCode,
} from "../../types";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";

type Translate = (key: string, options?: Record<string, unknown>) => string;

function formatDuration(value: number, t: Translate) {
  if (value < 1000) {
    return t("generationDiagnostics.milliseconds", { value });
  }

  return t("generationDiagnostics.seconds", {
    value: (value / 1000).toFixed(1),
  });
}

function formatCharacters(value: number, t: Translate) {
  return t("generationDiagnostics.characters", {
    value: value.toLocaleString(),
  });
}

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
      <p className="mt-2 break-words text-sm font-semibold text-white">{value}</p>
      {caption && (
        <p className="mt-1 text-[10px] leading-4 text-neutral-600">{caption}</p>
      )}
    </div>
  );
}

function failureLabel(
  code: TaskPackGenerationFailureCode,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  return t(`generationDiagnostics.failureCodes.${code}`, {
    defaultValue: code,
  });
}

function policyLabel(
  code: string,
  kind: "rejections" | "ambiguities" | "consistency",
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  return t(`generationDiagnostics.policy.${kind}.${code}`, {
    defaultValue: code,
  });
}

export function GenerationDiagnosticsModal({
  diagnostics,
  onClose,
}: {
  diagnostics: TaskPackGenerationDiagnostics;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const policy = diagnostics.output.policy;
  const totalPolicyActions = policy
    ? policy.rejectedItems +
      policy.rewrittenItems +
      policy.injectedItems +
      (policy.consistencyAdjustedItems ?? 0) +
      (policy.deduplicatedItems ?? 0) +
      (policy.limitedItems ?? 0)
    : 0;
  const hasPolicyNotes = Boolean(
    policy &&
      (totalPolicyActions > 0 ||
        policy.ambiguityCodes.length > 0 ||
        (policy.consistencyCodes?.length ?? 0) > 0),
  );
  const successfulAttempts = diagnostics.attempts.filter(
    (attempt) => attempt.schemaValid,
  ).length;
  const totalAttemptMs = diagnostics.attempts.reduce(
    (sum, attempt) => sum + attempt.durationMs,
    0,
  );
  const budgetUsage = Math.min(
    100,
    Math.round(
      (diagnostics.prompt.finalChars /
        Math.max(1, diagnostics.prompt.budgetChars)) *
        100,
    ),
  );

  const copy = {
    overview: t("generationDiagnostics.ui.overview"),
    overviewDescription: t("generationDiagnostics.ui.overviewDescription"),
    validated: t("generationDiagnostics.ui.validated"),
    validatedDescription: t("generationDiagnostics.ui.validatedDescription"),
    cached: t("generationDiagnostics.cached"),
    live: t("generationDiagnostics.live"),
    attemptsCaption: t("generationDiagnostics.ui.attemptsCaption", {
      count: successfulAttempts,
    }),
    promptCaption: t("generationDiagnostics.ui.promptCaption", {
      percent: budgetUsage,
    }),
    outputCaption: t("generationDiagnostics.ui.outputCaption"),
    refinementsCaption: t("generationDiagnostics.ui.refinementsCaption"),
    policySummary: t("generationDiagnostics.ui.policySummary"),
    policyClean: t("generationDiagnostics.ui.policyClean"),
    policyChanged: t("generationDiagnostics.ui.policyChanged", {
      count: totalPolicyActions,
    }),
    budgetTitle: t("generationDiagnostics.ui.budgetTitle"),
    budgetDescription: t("generationDiagnostics.ui.budgetDescription"),
    attemptTitle: t("generationDiagnostics.ui.attemptTitle"),
    attemptDescription: t("generationDiagnostics.ui.attemptDescription"),
    noAttempts: t("generationDiagnostics.ui.noAttempts"),
    technical: t("generationDiagnostics.ui.technical"),
    technicalDescription: t("generationDiagnostics.ui.technicalDescription"),
    validationCodes: t("generationDiagnostics.ui.validationCodes"),
    policyCodes: t("generationDiagnostics.ui.policyCodes"),
  };

  async function copyDiagnostics() {
    await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  const statusTone = diagnostics.fallbackReason
    ? "border-amber-400/20 bg-amber-400/[0.06] text-amber-100"
    : "border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-100";

  return (
    <Modal
      title={t("generationDiagnostics.title")}
      eyebrow={t("generationDiagnostics.eyebrow")}
      maxWidth="max-w-5xl"
      onClose={onClose}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <p className="hidden text-[11px] leading-5 text-neutral-600 md:block">
            {t("generationDiagnostics.privacyNotice")}
          </p>
          <Button variant="secondary" onClick={copyDiagnostics}>
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied
              ? t("generationDiagnostics.copied")
              : t("generationDiagnostics.copyJson")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 p-5">
        <section className="rounded-[1.6rem] border border-neutral-900 bg-black/35 p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <span className={`grid size-11 shrink-0 place-items-center rounded-2xl border ${statusTone}`}>
                {diagnostics.fallbackReason ? (
                  <AlertTriangle size={19} />
                ) : (
                  <FileCheck2 size={19} />
                )}
              </span>
              <div className="min-w-0">
                <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
                  {copy.overview}
                </p>
                <h3 className="mt-1 text-base font-semibold text-white">
                  {t(`generationDiagnostics.statuses.${diagnostics.status}`)}
                </h3>
                <p className="mt-1 max-w-2xl text-xs leading-5 text-neutral-500">
                  {copy.overviewDescription}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-[10px] font-semibold text-neutral-300">
                {diagnostics.provider ?? t("generationDiagnostics.notAvailable")}
              </span>
              <span className="rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-[10px] font-semibold text-neutral-300">
                {diagnostics.model ?? t("generationDiagnostics.notAvailable")}
              </span>
              <span className="rounded-full border border-emerald-400/20 bg-emerald-400/[0.07] px-3 py-1.5 text-[10px] font-semibold text-emerald-200">
                {diagnostics.cached ? copy.cached : copy.live}
              </span>
            </div>
          </div>

          {diagnostics.fallbackReason ? (
            <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-400/[0.055] p-3.5">
              <div className="flex items-start gap-3">
                <ShieldCheck size={16} className="mt-0.5 shrink-0 text-amber-200" />
                <div>
                  <p className="text-xs font-semibold text-amber-100">
                    {t("generationDiagnostics.fallbackTitle")} · {failureLabel(diagnostics.fallbackReason, t)}
                  </p>
                  <p className="mt-1 text-[11px] leading-5 text-amber-100/60">
                    {t("generationDiagnostics.fallbackDescription")}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-4 flex items-start gap-3 rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.045] p-3.5">
              <Check size={15} className="mt-0.5 shrink-0 text-emerald-300" />
              <div>
                <p className="text-xs font-semibold text-emerald-100">{copy.validated}</p>
                <p className="mt-1 text-[11px] leading-5 text-emerald-100/60">
                  {copy.validatedDescription}
                </p>
              </div>
            </div>
          )}
        </section>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric
            icon={<RefreshCw size={13} />}
            label={t("generationDiagnostics.metrics.attempts")}
            value={String(diagnostics.attempts.length)}
            caption={copy.attemptsCaption}
          />
          <Metric
            icon={<Gauge size={13} />}
            label={t("generationDiagnostics.metrics.prompt")}
            value={formatCharacters(diagnostics.prompt.finalChars, t)}
            caption={copy.promptCaption}
          />
          <Metric
            icon={<FileCheck2 size={13} />}
            label={t("generationDiagnostics.metrics.output")}
            value={formatCharacters(diagnostics.output.finalChars, t)}
            caption={copy.outputCaption}
          />
          <Metric
            icon={<Sparkles size={13} />}
            label={t("generationDiagnostics.metrics.refinements")}
            value={String(diagnostics.output.refinementItems)}
            caption={copy.refinementsCaption}
          />
        </div>

        <section className="rounded-[1.5rem] border border-neutral-900 bg-black/30 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <ShieldCheck size={15} className={hasPolicyNotes ? "text-amber-200" : "text-emerald-300"} />
                <h4 className="text-sm font-semibold text-white">{copy.policySummary}</h4>
              </div>
              <p className="mt-1 text-[11px] leading-5 text-neutral-600">
                {hasPolicyNotes ? copy.policyChanged : copy.policyClean}
              </p>
            </div>

            {policy && (
              <div className="grid grid-cols-3 gap-2 sm:min-w-[360px]">
                <div className="rounded-xl border border-neutral-900 bg-black/35 px-3 py-2">
                  <p className="text-[9px] uppercase text-neutral-600">{t("generationDiagnostics.policy.accepted")}</p>
                  <p className="mt-1 text-xs font-semibold text-white">{policy.acceptedItems}</p>
                </div>
                <div className="rounded-xl border border-neutral-900 bg-black/35 px-3 py-2">
                  <p className="text-[9px] uppercase text-neutral-600">{t("generationDiagnostics.policy.rewritten")}</p>
                  <p className="mt-1 text-xs font-semibold text-white">{policy.rewrittenItems}</p>
                </div>
                <div className="rounded-xl border border-neutral-900 bg-black/35 px-3 py-2">
                  <p className="text-[9px] uppercase text-neutral-600">{t("generationDiagnostics.policy.injected")}</p>
                  <p className="mt-1 text-xs font-semibold text-white">{policy.injectedItems}</p>
                </div>
              </div>
            )}
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-[1.5rem] border border-neutral-900 bg-black/30 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Gauge size={15} className="text-neutral-400" />
                  <h4 className="text-sm font-semibold text-white">{copy.budgetTitle}</h4>
                </div>
                <p className="mt-1 text-[11px] leading-5 text-neutral-600">{copy.budgetDescription}</p>
              </div>
              <span className="rounded-full border border-neutral-800 bg-neutral-950 px-2.5 py-1 text-[10px] font-semibold text-neutral-300">
                {budgetUsage}%
              </span>
            </div>

            <div className="mt-4 h-2 overflow-hidden rounded-full bg-neutral-900">
              <div
                className="h-full rounded-full bg-white transition-all duration-500"
                style={{ width: `${budgetUsage}%` }}
              />
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-xl border border-neutral-900 bg-black/35 p-3">
                <p className="text-neutral-600">{t("generationDiagnostics.originalPrompt")}</p>
                <p className="mt-1 font-semibold text-white">{formatCharacters(diagnostics.prompt.originalChars, t)}</p>
              </div>
              <div className="rounded-xl border border-neutral-900 bg-black/35 p-3">
                <p className="text-neutral-600">{t("generationDiagnostics.budget")}</p>
                <p className="mt-1 font-semibold text-white">{formatCharacters(diagnostics.prompt.budgetChars, t)}</p>
              </div>
            </div>
          </section>

          <section className="rounded-[1.5rem] border border-neutral-900 bg-black/30 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Timer size={15} className="text-neutral-400" />
                  <h4 className="text-sm font-semibold text-white">{copy.attemptTitle}</h4>
                </div>
                <p className="mt-1 text-[11px] leading-5 text-neutral-600">{copy.attemptDescription}</p>
              </div>
              {diagnostics.attempts.length > 0 && (
                <span className="rounded-full border border-neutral-800 bg-neutral-950 px-2.5 py-1 text-[10px] font-semibold text-neutral-300">
                  {formatDuration(totalAttemptMs, t)}
                </span>
              )}
            </div>

            <div className="mt-4 space-y-2">
              {diagnostics.attempts.length === 0 ? (
                <div className="rounded-xl border border-dashed border-neutral-800 bg-black/20 p-4 text-xs text-neutral-600">
                  {copy.noAttempts}
                </div>
              ) : (
                diagnostics.attempts.map((attempt) => (
                  <div key={`${attempt.attempt}:${attempt.phase}`} className="rounded-xl border border-neutral-900 bg-black/35 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className={`grid size-7 shrink-0 place-items-center rounded-lg border ${attempt.schemaValid ? "border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-300" : "border-red-400/20 bg-red-400/[0.06] text-red-300"}`}>
                          {attempt.schemaValid ? <Check size={13} /> : <AlertTriangle size={13} />}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-white">
                            {t("generationDiagnostics.attempt", { number: attempt.attempt })}
                          </p>
                          <p className="mt-0.5 truncate text-[10px] text-neutral-600">
                            {attempt.phase} · {attempt.parseStage}
                          </p>
                        </div>
                      </div>
                      <span className="shrink-0 text-xs font-semibold text-neutral-300">
                        {formatDuration(attempt.durationMs, t)}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        <section className="overflow-hidden rounded-[1.5rem] border border-neutral-900 bg-black/25">
          <button
            type="button"
            onClick={() => setShowTechnicalDetails((value) => !value)}
            aria-expanded={showTechnicalDetails}
            aria-controls="generation-diagnostics-technical"
            className="flex w-full items-center justify-between gap-4 px-4 py-3.5 text-left outline-none transition hover:bg-white/[0.025] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/25"
          >
            <div>
              <p className="text-xs font-semibold text-white">{copy.technical}</p>
              <p className="mt-1 text-[10px] leading-4 text-neutral-600">{copy.technicalDescription}</p>
            </div>
            <ChevronDown
              size={15}
              className={`shrink-0 text-neutral-500 transition-transform motion-reduce:transition-none ${showTechnicalDetails ? "rotate-180" : ""}`}
            />
          </button>

          {showTechnicalDetails && (
            <div id="generation-diagnostics-technical" className="grid gap-3 border-t border-neutral-900 p-4 lg:grid-cols-2">
              <div className="rounded-xl border border-neutral-900 bg-black/35 p-3">
                <p className="cf-tech-label text-[9px] uppercase text-neutral-600">{copy.validationCodes}</p>
                <p className="mt-2 break-words text-[11px] leading-5 text-neutral-400">
                  {diagnostics.output.validationIssueCodes.length > 0
                    ? diagnostics.output.validationIssueCodes.join(", ")
                    : "—"}
                </p>
              </div>

              <div className="rounded-xl border border-neutral-900 bg-black/35 p-3">
                <p className="cf-tech-label text-[9px] uppercase text-neutral-600">{copy.policyCodes}</p>
                <div className="mt-2 space-y-1 text-[11px] leading-5 text-neutral-400">
                  {policy?.rejectionCodes.length ? (
                    <p>{policy.rejectionCodes.map((code) => policyLabel(code, "rejections", t)).join(", ")}</p>
                  ) : null}
                  {policy?.ambiguityCodes.length ? (
                    <p>{policy.ambiguityCodes.map((code) => policyLabel(code, "ambiguities", t)).join(", ")}</p>
                  ) : null}
                  {policy?.consistencyCodes?.length ? (
                    <p>{policy.consistencyCodes.map((code) => policyLabel(code, "consistency", t)).join(", ")}</p>
                  ) : null}
                  {!policy?.rejectionCodes.length && !policy?.ambiguityCodes.length && !policy?.consistencyCodes?.length && <p>—</p>}
                </div>
              </div>

              {diagnostics.prompt.truncatedFields.length > 0 && (
                <div className="rounded-xl border border-neutral-900 bg-black/35 p-3 lg:col-span-2">
                  <p className="cf-tech-label text-[9px] uppercase text-neutral-600">{t("generationDiagnostics.truncatedFields")}</p>
                  <p className="mt-2 break-words text-[11px] leading-5 text-neutral-400">
                    {diagnostics.prompt.truncatedFields.join(", ")}
                  </p>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}
