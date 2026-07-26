import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  Bot,
  Check,
  ChevronDown,
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
      <p className="mt-2 text-sm font-semibold text-white">{value}</p>
      {caption && <p className="mt-1 text-[10px] leading-4 text-neutral-600">{caption}</p>}
    </div>
  );
}

function TimelineBar({ value }: { value: number }) {
  const safeValue = Math.max(2, Math.min(100, value));
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-neutral-900">
      <div className="h-full rounded-full bg-white" style={{ width: `${safeValue}%` }} />
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
  const { t, i18n } = useTranslation();
  const isRu = i18n.language.startsWith("ru");

  return (
    <div className="rounded-2xl border border-neutral-900 bg-black/30 p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
            {t("performanceDiagnostics.aiCall", { number: index + 1 })}
          </p>
          <p className="mt-1 truncate text-sm font-semibold text-white">{call.purpose}</p>
          <p className="mt-1 truncate text-[11px] text-neutral-600">
            {call.provider} · {call.model ?? t("performanceDiagnostics.notAvailable")}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <span className="rounded-full border border-neutral-800 bg-neutral-950 px-2.5 py-1 text-[10px] font-semibold text-neutral-300">
            {formatDuration(call.durationMs)}
          </span>
          <span className="rounded-full border border-neutral-800 bg-neutral-950 px-2.5 py-1 text-[10px] font-semibold text-neutral-300">
            {modelStateLabel(call.modelState, t)}
          </span>
          <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${call.success ? "border-emerald-400/20 bg-emerald-400/[0.07] text-emerald-200" : "border-red-400/20 bg-red-400/[0.07] text-red-200"}`}>
            {call.success ? t("performanceDiagnostics.success") : t("performanceDiagnostics.failed")}
          </span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <div className="rounded-xl border border-neutral-900 bg-black/35 p-3">
          <p className="text-[9px] uppercase text-neutral-600">{t("performanceDiagnostics.prompt")}</p>
          <p className="mt-1 text-xs font-semibold text-white">{formatCount(call.promptChars)} chars</p>
        </div>
        <div className="rounded-xl border border-neutral-900 bg-black/35 p-3">
          <p className="text-[9px] uppercase text-neutral-600">{t("performanceDiagnostics.response")}</p>
          <p className="mt-1 text-xs font-semibold text-white">{formatCount(call.responseChars)} chars</p>
        </div>
        <div className="rounded-xl border border-neutral-900 bg-black/35 p-3">
          <p className="text-[9px] uppercase text-neutral-600">{t("performanceDiagnostics.modelLoad")}</p>
          <p className="mt-1 text-xs font-semibold text-white">
            {call.modelLoadMs == null ? "—" : formatDuration(call.modelLoadMs)}
          </p>
        </div>
        <div className="rounded-xl border border-neutral-900 bg-black/35 p-3">
          <p className="text-[9px] uppercase text-neutral-600">{t("performanceDiagnostics.tokens")}</p>
          <p className="mt-1 text-xs font-semibold text-white">{call.promptTokens ?? "—"} / {call.responseTokens ?? "—"}</p>
        </div>
      </div>

      {(call.promptEvalMs != null || call.generationMs != null) && (
        <p className="mt-3 text-[10px] leading-4 text-neutral-600">
          {isRu ? "Обработка промпта" : "Prompt evaluation"}: {call.promptEvalMs == null ? "—" : formatDuration(call.promptEvalMs)} · {isRu ? "генерация" : "generation"}: {call.generationMs == null ? "—" : formatDuration(call.generationMs)}
        </p>
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
  const { t, i18n } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const isRu = i18n.language.startsWith("ru");
  const aiCalls = useMemo(
    () => diagnostics.requests.flatMap((request) => request.aiCalls),
    [diagnostics.requests],
  );
  const cacheEvents = useMemo(
    () => diagnostics.requests.flatMap((request) => request.cacheEvents),
    [diagnostics.requests],
  );
  const allStages = useMemo(
    () => diagnostics.requests.flatMap((request) => request.stages),
    [diagnostics.requests],
  );
  const slowestStages = useMemo(
    () => [...allStages].sort((a, b) => b.durationMs - a.durationMs).slice(0, 4),
    [allStages],
  );
  const aiShare = Math.min(
    100,
    Math.round(
      (diagnostics.summary.aiDurationMs /
        Math.max(1, diagnostics.totalObservedDurationMs)) *
        100,
    ),
  );
  const cacheTotal = diagnostics.summary.cacheHits + diagnostics.summary.cacheMisses;
  const cacheRate = cacheTotal > 0 ? Math.round((diagnostics.summary.cacheHits / cacheTotal) * 100) : 0;

  const copy = isRu
    ? {
        overview: "Сводка производительности",
        overviewDescription:
          "Показывает, где ушло время при подготовке и создании пакета задачи.",
        totalCaption: `${diagnostics.requestCount} запроса`,
        aiCaption: `${aiShare}% общего времени`,
        inventoryCaption: `${diagnostics.summary.inventoryScans} запуска`,
        cacheCaption: `${cacheRate}% попаданий`,
        slowest: "Самые долгие этапы",
        slowestDescription: "Быстрый обзор основных задержек без технического шума.",
        requests: "Ход выполнения",
        requestsDescription: "Запросы и этапы в порядке выполнения.",
        aiCalls: "Реальные обращения к AI",
        aiCallsDescription: "Отдельно показаны только фактические вызовы провайдера.",
        technical: "Технические детали",
        technicalDescription: "События кеша, состояния модели и приватность.",
      }
    : {
        overview: "Performance overview",
        overviewDescription:
          "Shows where time was spent while preparing and generating this Task Pack.",
        totalCaption: `${diagnostics.requestCount} requests`,
        aiCaption: `${aiShare}% of total time`,
        inventoryCaption: `${diagnostics.summary.inventoryScans} runs`,
        cacheCaption: `${cacheRate}% hit rate`,
        slowest: "Slowest stages",
        slowestDescription: "A quick view of the main delays without technical noise.",
        requests: "Execution flow",
        requestsDescription: "Requests and stages in execution order.",
        aiCalls: "Real AI calls",
        aiCallsDescription: "Only actual provider calls are shown here.",
        technical: "Technical details",
        technicalDescription: "Cache events, model state and privacy metadata.",
      };

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
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <p className="hidden text-[11px] leading-5 text-neutral-600 md:block">
            {t("performanceDiagnostics.privacyNotice")}
          </p>
          <Button variant="secondary" onClick={copyDiagnostics}>
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied ? t("performanceDiagnostics.copied") : t("performanceDiagnostics.copyJson")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 p-5">
        <section className="rounded-[1.6rem] border border-neutral-900 bg-black/35 p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/[0.05] text-white">
                <Activity size={19} />
              </span>
              <div>
                <p className="cf-tech-label text-[9px] uppercase text-neutral-600">{copy.overview}</p>
                <h3 className="mt-1 text-base font-semibold text-white">
                  {t("performanceDiagnostics.sessionSummary", {
                    requests: diagnostics.requestCount,
                    calls: diagnostics.summary.aiCallCount,
                  })}
                </h3>
                <p className="mt-1 max-w-2xl text-xs leading-5 text-neutral-500">{copy.overviewDescription}</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {diagnostics.summary.coldAiCalls > 0 && (
                <span className="rounded-full border border-sky-400/20 bg-sky-400/[0.06] px-3 py-1.5 text-[10px] font-semibold text-sky-200">
                  {diagnostics.summary.coldAiCalls} {isRu ? "холодный" : "cold"}
                </span>
              )}
              {diagnostics.summary.warmAiCalls > 0 && (
                <span className="rounded-full border border-emerald-400/20 bg-emerald-400/[0.06] px-3 py-1.5 text-[10px] font-semibold text-emerald-200">
                  {diagnostics.summary.warmAiCalls} {isRu ? "тёплый" : "warm"}
                </span>
              )}
            </div>
          </div>
        </section>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Metric icon={<Clock3 size={13} />} label={t("performanceDiagnostics.metrics.total")} value={formatDuration(diagnostics.totalObservedDurationMs)} caption={copy.totalCaption} />
          <Metric icon={<Bot size={13} />} label={t("performanceDiagnostics.metrics.aiCalls")} value={String(diagnostics.summary.aiCallCount)} caption={`${diagnostics.summary.coldAiCalls}/${diagnostics.summary.warmAiCalls}`} />
          <Metric icon={<Timer size={13} />} label={t("performanceDiagnostics.metrics.aiTime")} value={formatDuration(diagnostics.summary.aiDurationMs)} caption={copy.aiCaption} />
          <Metric icon={<Database size={13} />} label={t("performanceDiagnostics.metrics.inventory")} value={formatDuration(diagnostics.summary.inventoryDurationMs)} caption={copy.inventoryCaption} />
          <Metric icon={<Zap size={13} />} label={t("performanceDiagnostics.metrics.cache")} value={`${diagnostics.summary.cacheHits}/${diagnostics.summary.cacheMisses}`} caption={copy.cacheCaption} />
        </div>

        <section className="rounded-[1.5rem] border border-neutral-900 bg-black/30 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Gauge size={15} className="text-neutral-400" />
                <h3 className="text-sm font-semibold text-white">{copy.slowest}</h3>
              </div>
              <p className="mt-1 text-[11px] leading-5 text-neutral-600">{copy.slowestDescription}</p>
            </div>
            <span className="rounded-full border border-neutral-800 bg-neutral-950 px-2.5 py-1 text-[10px] font-semibold text-neutral-300">AI {aiShare}%</span>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {slowestStages.map((stage) => {
              const share = Math.round((stage.durationMs / Math.max(1, diagnostics.totalObservedDurationMs)) * 100);
              return (
                <div key={stage.id} className="rounded-xl border border-neutral-900 bg-black/35 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate text-xs font-medium text-neutral-200">{stage.label}</p>
                    <span className="shrink-0 text-xs font-semibold text-white">{formatDuration(stage.durationMs)}</span>
                  </div>
                  <div className="mt-3"><TimelineBar value={share} /></div>
                  <p className="mt-2 text-[10px] text-neutral-600">{share}% {isRu ? "общего времени" : "of total time"}</p>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-[1.5rem] border border-neutral-900 bg-black/25 p-4">
          <div className="flex items-start gap-2">
            <Layers3 size={15} className="mt-0.5 text-neutral-400" />
            <div>
              <h3 className="text-sm font-semibold text-white">{copy.requests}</h3>
              <p className="mt-1 text-[11px] leading-5 text-neutral-600">{copy.requestsDescription}</p>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {diagnostics.requests.map((request, requestIndex) => (
              <article key={request.id} className="rounded-2xl border border-neutral-900 bg-black/35 p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
                      {t("performanceDiagnostics.request", { number: requestIndex + 1 })}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-white">{operationLabel(request.operation, t)}</p>
                  </div>
                  <span className="rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1 text-[10px] font-semibold text-neutral-300">{formatDuration(request.totalDurationMs)}</span>
                </div>

                <div className="mt-4 space-y-2">
                  {request.stages.map((stage) => {
                    const share = Math.round((stage.durationMs / Math.max(1, request.totalDurationMs)) * 100);
                    return (
                      <div key={stage.id} className="grid gap-3 rounded-xl border border-neutral-900 bg-black/30 px-3 py-2.5 md:grid-cols-[minmax(0,1fr)_180px_72px] md:items-center">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-neutral-200">{stage.label}</p>
                          <p className="mt-0.5 text-[10px] text-neutral-600">+{formatDuration(stage.startOffsetMs)}</p>
                        </div>
                        <TimelineBar value={share} />
                        <div className="flex items-center justify-between gap-2 md:justify-end">
                          {stage.status === "error" && <span className="text-[9px] font-semibold text-red-300">{t("performanceDiagnostics.failed")}</span>}
                          <span className="text-xs font-semibold text-white">{formatDuration(stage.durationMs)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-[1.5rem] border border-neutral-900 bg-black/25 p-4">
          <div className="flex items-start gap-2">
            <Bot size={15} className="mt-0.5 text-neutral-400" />
            <div>
              <h3 className="text-sm font-semibold text-white">{copy.aiCalls}</h3>
              <p className="mt-1 text-[11px] leading-5 text-neutral-600">{copy.aiCallsDescription}</p>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {aiCalls.length > 0 ? aiCalls.map((call, index) => (
              <AiCallCard key={call.id} call={call} index={index} />
            )) : (
              <div className="rounded-xl border border-dashed border-neutral-800 bg-black/20 p-4 text-xs text-neutral-600">{t("performanceDiagnostics.noAiCalls")}</div>
            )}
          </div>
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
              {cacheEvents.length > 0 && (
                <div className="rounded-xl border border-neutral-900 bg-black/35 p-3">
                  <div className="flex items-center gap-2">
                    <Zap size={13} className="text-neutral-500" />
                    <p className="text-xs font-semibold text-white">{t("performanceDiagnostics.cacheEvents")}</p>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {cacheEvents.map((event) => (
                      <span key={event.id} className="rounded-full border border-neutral-800 bg-neutral-950 px-2.5 py-1 text-[10px] font-semibold text-neutral-300">
                        {event.layer}: {event.outcome}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {(diagnostics.summary.coldAiCalls > 0 || diagnostics.summary.warmAiCalls > 0) && (
                <div className="flex items-start gap-3 rounded-xl border border-sky-400/15 bg-sky-400/[0.045] p-3.5">
                  <Snowflake size={16} className="mt-0.5 shrink-0 text-sky-200" />
                  <div>
                    <p className="text-xs font-semibold text-sky-100">{t("performanceDiagnostics.modelStateSummary", { cold: diagnostics.summary.coldAiCalls, warm: diagnostics.summary.warmAiCalls })}</p>
                    <p className="mt-1 text-[11px] leading-5 text-sky-100/60">{t("performanceDiagnostics.modelStateDescription")}</p>
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
