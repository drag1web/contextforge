import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  Bot,
  Check,
  Clock3,
  Copy,
  Database,
  Gauge,
  Layers3,
  Snowflake,
  Timer,
  Zap,
} from "lucide-react";

import type {
  PerformanceAiCallDiagnostics,
  PerformanceRequestDiagnostics,
  PerformanceSessionDiagnostics,
} from "../../types";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";

function formatDuration(value: number) {
  if (value < 1000) {
    return `${Math.round(value)} ms`;
  }

  return `${(value / 1000).toFixed(1)} sec`;
}

function formatCount(value: number) {
  return value.toLocaleString();
}

function operationLabel(
  operation: PerformanceRequestDiagnostics["operation"],
  t: (key: string) => string,
) {
  return operation === "task_understanding_preflight"
    ? t("performanceDiagnostics.operations.preflight")
    : t("performanceDiagnostics.operations.generation");
}

function modelStateLabel(
  state: PerformanceAiCallDiagnostics["modelState"],
  t: (key: string) => string,
) {
  return t(`performanceDiagnostics.modelStates.${state}`);
}

function Metric({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
      <div className="flex items-center gap-2 text-neutral-500">
        {icon}
        <p className="cf-tech-label text-[10px] uppercase">{label}</p>
      </div>
      <p className="mt-2 text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

function AiCallCard({
  call,
  index,
}: {
  call: PerformanceAiCallDiagnostics;
  index: number;
}) {
  const { t } = useTranslation();

  return (
    <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
            {t("performanceDiagnostics.aiCall", { number: index + 1 })}
          </p>
          <p className="mt-1 text-sm font-semibold text-white">
            {call.purpose}
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            {call.provider} ·{" "}
            {call.model ?? t("performanceDiagnostics.notAvailable")}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <span className="rounded-full border border-neutral-800 bg-neutral-950 px-2.5 py-1 text-[10px] font-semibold text-neutral-300">
            {formatDuration(call.durationMs)}
          </span>
          <span className="rounded-full border border-neutral-800 bg-neutral-950 px-2.5 py-1 text-[10px] font-semibold text-neutral-300">
            {modelStateLabel(call.modelState, t)}
          </span>
          <span
            className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
              call.success
                ? "border-emerald-400/20 bg-emerald-400/[0.07] text-emerald-200"
                : "border-red-400/20 bg-red-400/[0.07] text-red-200"
            }`}
          >
            {call.success
              ? t("performanceDiagnostics.success")
              : t("performanceDiagnostics.failed")}
          </span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <div className="rounded-xl border border-neutral-900 bg-black/35 p-3">
          <p className="text-[10px] uppercase text-neutral-600">
            {t("performanceDiagnostics.prompt")}
          </p>
          <p className="mt-1 text-xs font-semibold text-white">
            {formatCount(call.promptChars)} chars
          </p>
        </div>
        <div className="rounded-xl border border-neutral-900 bg-black/35 p-3">
          <p className="text-[10px] uppercase text-neutral-600">
            {t("performanceDiagnostics.response")}
          </p>
          <p className="mt-1 text-xs font-semibold text-white">
            {formatCount(call.responseChars)} chars
          </p>
        </div>
        <div className="rounded-xl border border-neutral-900 bg-black/35 p-3">
          <p className="text-[10px] uppercase text-neutral-600">
            {t("performanceDiagnostics.modelLoad")}
          </p>
          <p className="mt-1 text-xs font-semibold text-white">
            {call.modelLoadMs == null
              ? t("performanceDiagnostics.notAvailable")
              : formatDuration(call.modelLoadMs)}
          </p>
        </div>
        <div className="rounded-xl border border-neutral-900 bg-black/35 p-3">
          <p className="text-[10px] uppercase text-neutral-600">
            {t("performanceDiagnostics.tokens")}
          </p>
          <p className="mt-1 text-xs font-semibold text-white">
            {call.promptTokens ?? "—"} / {call.responseTokens ?? "—"}
          </p>
        </div>
      </div>

      {(call.promptEvalMs != null || call.generationMs != null) && (
        <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-neutral-500">
          <span>
            {t("performanceDiagnostics.promptEval")}:{" "}
            {call.promptEvalMs == null
              ? "—"
              : formatDuration(call.promptEvalMs)}
          </span>
          <span>
            {t("performanceDiagnostics.tokenGeneration")}:{" "}
            {call.generationMs == null
              ? "—"
              : formatDuration(call.generationMs)}
          </span>
        </div>
      )}
    </div>
  );
}

export function PerformanceDiagnosticsModal({
  diagnostics,
  onClose,
}: {
  diagnostics: PerformanceSessionDiagnostics;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const aiCalls = useMemo(
    () => diagnostics.requests.flatMap((request) => request.aiCalls),
    [diagnostics.requests],
  );
  const cacheEvents = useMemo(
    () => diagnostics.requests.flatMap((request) => request.cacheEvents),
    [diagnostics.requests],
  );

  async function copyDiagnostics() {
    await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <Modal
      title={t("performanceDiagnostics.title")}
      eyebrow={t("performanceDiagnostics.eyebrow")}
      onClose={onClose}
      maxWidth="max-w-6xl"
    >
      <div className="space-y-5 p-6">
        <p className="text-xs leading-5 text-neutral-500">
          {t("performanceDiagnostics.description")}
        </p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-2xl border border-white/10 bg-white/[0.05] text-white">
              <Activity size={20} />
            </span>
            <div>
              <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                {t("performanceDiagnostics.eyebrow")}
              </p>
              <p className="mt-1 text-sm font-semibold text-white">
                {t("performanceDiagnostics.sessionSummary", {
                  requests: diagnostics.requestCount,
                  calls: diagnostics.summary.aiCallCount,
                })}
              </p>
            </div>
          </div>

          <Button variant="secondary" onClick={copyDiagnostics}>
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied
              ? t("performanceDiagnostics.copied")
              : t("performanceDiagnostics.copyJson")}
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Metric
            icon={<Clock3 size={14} />}
            label={t("performanceDiagnostics.metrics.total")}
            value={formatDuration(diagnostics.totalObservedDurationMs)}
          />
          <Metric
            icon={<Bot size={14} />}
            label={t("performanceDiagnostics.metrics.aiCalls")}
            value={String(diagnostics.summary.aiCallCount)}
          />
          <Metric
            icon={<Timer size={14} />}
            label={t("performanceDiagnostics.metrics.aiTime")}
            value={formatDuration(diagnostics.summary.aiDurationMs)}
          />
          <Metric
            icon={<Database size={14} />}
            label={t("performanceDiagnostics.metrics.inventory")}
            value={`${diagnostics.summary.inventoryScans} · ${formatDuration(
              diagnostics.summary.inventoryDurationMs,
            )}`}
          />
          <Metric
            icon={<Zap size={14} />}
            label={t("performanceDiagnostics.metrics.cache")}
            value={`${diagnostics.summary.cacheHits}/${diagnostics.summary.cacheMisses}`}
          />
        </div>

        <section className="rounded-[1.5rem] border border-neutral-900 bg-black/25 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Layers3 size={16} className="text-neutral-400" />
            <h3 className="text-sm font-semibold text-white">
              {t("performanceDiagnostics.requestTimeline")}
            </h3>
          </div>

          <div className="space-y-4">
            {diagnostics.requests.map((request, requestIndex) => (
              <div
                key={request.id}
                className="rounded-2xl border border-neutral-900 bg-black/35 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                      {t("performanceDiagnostics.request", {
                        number: requestIndex + 1,
                      })}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-white">
                      {operationLabel(request.operation, t)}
                    </p>
                  </div>
                  <span className="rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1 text-[10px] font-semibold text-neutral-300">
                    {formatDuration(request.totalDurationMs)}
                  </span>
                </div>

                <div className="mt-4 space-y-2">
                  {request.stages.map((stage) => (
                    <div
                      key={stage.id}
                      className="flex items-center justify-between gap-4 rounded-xl border border-neutral-900 bg-black/30 px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-neutral-200">
                          {stage.label}
                        </p>
                        <p className="mt-0.5 text-[10px] text-neutral-600">
                          +{formatDuration(stage.startOffsetMs)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {stage.status === "error" && (
                          <span className="text-[10px] font-semibold text-red-300">
                            {t("performanceDiagnostics.failed")}
                          </span>
                        )}
                        <span className="shrink-0 text-xs font-semibold text-white">
                          {formatDuration(stage.durationMs)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Gauge size={16} className="text-neutral-400" />
            <h3 className="text-sm font-semibold text-white">
              {t("performanceDiagnostics.aiTimeline")}
            </h3>
          </div>

          {aiCalls.length > 0 ? (
            aiCalls.map((call, index) => (
              <AiCallCard key={call.id} call={call} index={index} />
            ))
          ) : (
            <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4 text-xs text-neutral-500">
              {t("performanceDiagnostics.noAiCalls")}
            </div>
          )}
        </section>

        {cacheEvents.length > 0 && (
          <section className="rounded-[1.5rem] border border-neutral-900 bg-black/25 p-4">
            <div className="mb-3 flex items-center gap-2">
              <Zap size={16} className="text-neutral-400" />
              <h3 className="text-sm font-semibold text-white">
                {t("performanceDiagnostics.cacheEvents")}
              </h3>
            </div>
            <div className="flex flex-wrap gap-2">
              {cacheEvents.map((event) => (
                <span
                  key={event.id}
                  className="rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-[10px] font-semibold text-neutral-300"
                >
                  {event.layer}: {event.outcome}
                </span>
              ))}
            </div>
          </section>
        )}

        {(diagnostics.summary.coldAiCalls > 0 ||
          diagnostics.summary.warmAiCalls > 0) && (
          <div className="rounded-2xl border border-sky-400/15 bg-sky-400/[0.045] p-4">
            <div className="flex items-start gap-3">
              <Snowflake size={17} className="mt-0.5 text-sky-200" />
              <div>
                <p className="text-xs font-semibold text-sky-100">
                  {t("performanceDiagnostics.modelStateSummary", {
                    cold: diagnostics.summary.coldAiCalls,
                    warm: diagnostics.summary.warmAiCalls,
                  })}
                </p>
                <p className="mt-1 text-[11px] leading-5 text-sky-100/60">
                  {t("performanceDiagnostics.modelStateDescription")}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.045] p-4 text-[11px] leading-5 text-emerald-100/65">
          {t("performanceDiagnostics.privacyNotice")}
        </div>
      </div>
    </Modal>
  );
}
