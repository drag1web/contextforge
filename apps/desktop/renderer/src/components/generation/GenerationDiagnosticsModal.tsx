import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bot,
  Check,
  Copy,
  Gauge,
  RefreshCw,
  ShieldCheck,
  Timer,
} from "lucide-react";

import type {
  TaskPackGenerationDiagnostics,
  TaskPackGenerationFailureCode,
} from "../../types";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
      <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
        {label}
      </p>
      <p className="mt-1 break-words text-sm font-semibold text-white">
        {value}
      </p>
    </div>
  );
}

function formatDuration(value: number) {
  if (value < 1000) {
    return `${value} ms`;
  }

  return `${(value / 1000).toFixed(1)} sec`;
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

  async function copyDiagnostics() {
    await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <Modal
      title={t("generationDiagnostics.title")}
      eyebrow={t("generationDiagnostics.eyebrow")}
      maxWidth="max-w-4xl"
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={copyDiagnostics}>
          {copied ? <Check size={15} /> : <Copy size={15} />}
          {copied
            ? t("generationDiagnostics.copied")
            : t("generationDiagnostics.copyJson")}
        </Button>
      }
    >
      <div className="space-y-5 p-6">
        <section className="rounded-[1.5rem] border border-neutral-900 bg-black/35 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Bot size={16} />
                {t(`generationDiagnostics.statuses.${diagnostics.status}`)}
              </div>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">
                {t("generationDiagnostics.summary", {
                  provider:
                    diagnostics.provider ??
                    t("generationDiagnostics.notAvailable"),
                  model:
                    diagnostics.model ??
                    t("generationDiagnostics.notAvailable"),
                })}
              </p>
            </div>

            <span className="cf-badge">
              {diagnostics.cached
                ? t("generationDiagnostics.cached")
                : t("generationDiagnostics.live")}
            </span>
          </div>

          {diagnostics.fallbackReason && (
            <div className="mt-4 rounded-2xl border border-amber-500/25 bg-amber-500/5 p-4 text-sm text-amber-100">
              <strong className="flex items-center gap-2">
                <ShieldCheck size={15} />
                {t("generationDiagnostics.fallbackTitle")} ·{" "}
                {failureLabel(diagnostics.fallbackReason, t)}
              </strong>
              <p className="mt-1 text-amber-100/65">
                {t("generationDiagnostics.fallbackDescription")}
              </p>
            </div>
          )}

          {diagnostics.output.validationIssueCodes.length > 0 && (
            <div className="mt-3 rounded-2xl border border-neutral-800 bg-neutral-950/60 p-4">
              <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                {t("generationDiagnostics.finalValidationIssues")}
              </p>
              <p className="mt-2 break-words text-xs leading-5 text-neutral-400">
                {diagnostics.output.validationIssueCodes.join(", ")}
              </p>
            </div>
          )}

          {diagnostics.output.policy &&
            (diagnostics.output.policy.rejectedItems > 0 ||
              diagnostics.output.policy.rewrittenItems > 0 ||
              diagnostics.output.policy.injectedItems > 0 ||
              (diagnostics.output.policy.consistencyAdjustedItems ?? 0) > 0 ||
              (diagnostics.output.policy.deduplicatedItems ?? 0) > 0 ||
              (diagnostics.output.policy.limitedItems ?? 0) > 0 ||
              diagnostics.output.policy.ambiguityCodes.length > 0 ||
              (diagnostics.output.policy.consistencyCodes?.length ?? 0) > 0) && (
              <div className="mt-3 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-amber-100">
                  <ShieldCheck size={15} />
                  {t("generationDiagnostics.policy.title")}
                </div>

                <div className="mt-3 grid gap-2 text-xs text-amber-100/70 sm:grid-cols-2 lg:grid-cols-4">
                  <span>
                    {t("generationDiagnostics.policy.accepted")}: {" "}
                    <strong className="text-amber-50">
                      {diagnostics.output.policy.acceptedItems}
                    </strong>
                  </span>
                  <span>
                    {t("generationDiagnostics.policy.rejected")}: {" "}
                    <strong className="text-amber-50">
                      {diagnostics.output.policy.rejectedItems}
                    </strong>
                  </span>
                  <span>
                    {t("generationDiagnostics.policy.rewritten")}: {" "}
                    <strong className="text-amber-50">
                      {diagnostics.output.policy.rewrittenItems}
                    </strong>
                  </span>
                  <span>
                    {t("generationDiagnostics.policy.injected")}: {" "}
                    <strong className="text-amber-50">
                      {diagnostics.output.policy.injectedItems}
                    </strong>
                  </span>
                  <span>
                    {t("generationDiagnostics.policy.consistencyAdjusted")}: {" "}
                    <strong className="text-amber-50">
                      {diagnostics.output.policy.consistencyAdjustedItems ?? 0}
                    </strong>
                  </span>
                  <span>
                    {t("generationDiagnostics.policy.deduplicated")}: {" "}
                    <strong className="text-amber-50">
                      {diagnostics.output.policy.deduplicatedItems ?? 0}
                    </strong>
                  </span>
                  <span>
                    {t("generationDiagnostics.policy.limited")}: {" "}
                    <strong className="text-amber-50">
                      {diagnostics.output.policy.limitedItems ?? 0}
                    </strong>
                  </span>
                </div>

                {diagnostics.output.policy.rejectionCodes.length > 0 && (
                  <div className="mt-3">
                    <p className="cf-tech-label text-[10px] uppercase text-amber-200/45">
                      {t("generationDiagnostics.policy.rejectionReasons")}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-amber-100/65">
                      {diagnostics.output.policy.rejectionCodes
                        .map((code) =>
                          policyLabel(code, "rejections", t),
                        )
                        .join(", ")}
                    </p>
                  </div>
                )}

                {diagnostics.output.policy.ambiguityCodes.length > 0 && (
                  <div className="mt-3">
                    <p className="cf-tech-label text-[10px] uppercase text-amber-200/45">
                      {t("generationDiagnostics.policy.ambiguitiesTitle")}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-amber-100/65">
                      {diagnostics.output.policy.ambiguityCodes
                        .map((code) =>
                          policyLabel(code, "ambiguities", t),
                        )
                        .join(", ")}
                    </p>
                  </div>
                )}

                {(diagnostics.output.policy.consistencyCodes?.length ?? 0) > 0 && (
                  <div className="mt-3">
                    <p className="cf-tech-label text-[10px] uppercase text-amber-200/45">
                      {t("generationDiagnostics.policy.consistencyTitle")}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-amber-100/65">
                      {diagnostics.output.policy.consistencyCodes
                        ?.map((code) =>
                          policyLabel(code, "consistency", t),
                        )
                        .join(", ")}
                    </p>
                  </div>
                )}

                <p className="mt-3 text-xs leading-5 text-amber-100/50">
                  {t("generationDiagnostics.policy.description")}
                </p>
              </div>
            )}
        </section>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            label={t("generationDiagnostics.metrics.attempts")}
            value={String(diagnostics.attempts.length)}
          />
          <Metric
            label={t("generationDiagnostics.metrics.prompt")}
            value={`${diagnostics.prompt.finalChars.toLocaleString()} chars`}
          />
          <Metric
            label={t("generationDiagnostics.metrics.output")}
            value={`${diagnostics.output.finalChars.toLocaleString()} chars`}
          />
          <Metric
            label={t("generationDiagnostics.metrics.refinements")}
            value={String(diagnostics.output.refinementItems)}
          />
        </div>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-[1.5rem] border border-neutral-900 bg-black/35 p-5">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-white">
              <Gauge size={15} />
              {t("generationDiagnostics.promptBudget")}
            </h4>

            <div className="mt-4 space-y-2 text-sm text-neutral-500">
              <p>
                {t("generationDiagnostics.originalPrompt")}: {" "}
                <span className="text-neutral-200">
                  {diagnostics.prompt.originalChars.toLocaleString()} chars
                </span>
              </p>
              <p>
                {t("generationDiagnostics.finalPrompt")}: {" "}
                <span className="text-neutral-200">
                  {diagnostics.prompt.finalChars.toLocaleString()} chars
                </span>
              </p>
              <p>
                {t("generationDiagnostics.budget")}: {" "}
                <span className="text-neutral-200">
                  {diagnostics.prompt.budgetChars.toLocaleString()} chars
                </span>
              </p>
              <p>
                {t("generationDiagnostics.compacted")}: {" "}
                <span className="text-neutral-200">
                  {diagnostics.prompt.compacted
                    ? t("generationDiagnostics.yes")
                    : t("generationDiagnostics.no")}
                </span>
              </p>
            </div>

            {diagnostics.prompt.truncatedFields.length > 0 && (
              <div className="mt-4 rounded-xl border border-neutral-900 px-3 py-3">
                <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                  {t("generationDiagnostics.truncatedFields")}
                </p>
                <p className="mt-2 break-words text-xs leading-5 text-neutral-400">
                  {diagnostics.prompt.truncatedFields.join(", ")}
                </p>
              </div>
            )}
          </div>

          <div className="rounded-[1.5rem] border border-neutral-900 bg-black/35 p-5">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-white">
              <Timer size={15} />
              {t("generationDiagnostics.attemptTimeline")}
            </h4>

            <div className="mt-4 space-y-3">
              {diagnostics.attempts.length === 0 ? (
                <p className="text-sm text-neutral-600">
                  {t(
                    diagnostics.cached
                      ? "generationDiagnostics.noAttemptsCached"
                      : "generationDiagnostics.noAttemptsTemplate",
                  )}
                </p>
              ) : (
                diagnostics.attempts.map((attempt) => (
                  <div
                    key={`${attempt.attempt}:${attempt.phase}`}
                    className="rounded-xl border border-neutral-900 px-3 py-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-xs font-semibold text-neutral-200">
                        <RefreshCw size={13} />
                        {t("generationDiagnostics.attempt", {
                          number: attempt.attempt,
                        })}
                      </span>
                      <span className="cf-badge">
                        {attempt.schemaValid
                          ? t("generationDiagnostics.valid")
                          : t("generationDiagnostics.invalid")}
                      </span>
                    </div>

                    <div className="mt-2 grid gap-1 text-xs leading-5 text-neutral-500 sm:grid-cols-2">
                      <span>
                        {t("generationDiagnostics.phase")}: {attempt.phase}
                      </span>
                      <span>
                        {t("generationDiagnostics.duration")}: {" "}
                        {formatDuration(attempt.durationMs)}
                      </span>
                      <span>
                        {t("generationDiagnostics.parseStage")}: {" "}
                        {attempt.parseStage}
                      </span>
                      <span>
                        {t("generationDiagnostics.responseSize")}: {" "}
                        {attempt.responseChars.toLocaleString()} chars
                      </span>
                    </div>

                    {attempt.issueCodes.length > 0 && (
                      <p className="mt-2 break-words text-xs leading-5 text-amber-200/60">
                        {attempt.issueCodes.join(", ")}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        <p className="text-xs leading-5 text-neutral-600">
          {t("generationDiagnostics.privacyNotice")}
        </p>
      </div>
    </Modal>
  );
}
