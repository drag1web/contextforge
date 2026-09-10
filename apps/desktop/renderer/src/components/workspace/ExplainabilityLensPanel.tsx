import type { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";
import {
  CircleHelp,
  FileCode2,
  GitCompareArrows,
  ListChecks,
  PanelRightOpen,
  ScanSearch,
  ShieldCheck,
  TriangleAlert,
  X,
} from "lucide-react";

import type {
  ContextComposerEngineFileView,
  ContextComposerEngineView,
  ContextComposerEvidenceView,
  ContextComposerInvestigationEventView,
} from "../../types";
import { Button } from "../ui/Button";
import {
  compareContextDiffSnapshots,
  contextDiffPathIdentity,
  type ContextDiffFieldChange,
  type ContextDiffSnapshot,
  type ContextDiffValue,
} from "./contextDiff";
import { WorkspaceDisclosure } from "./WorkspaceDisclosure";

interface ExplainabilityLensPanelProps {
  view: ContextComposerEngineView;
  projectName: string;
  contextDiff?: {
    previous: ContextDiffSnapshot | null;
    current: ContextDiffSnapshot | null;
  } | null;
  onClose: () => void;
  onInspectFile: (file: ContextComposerEngineFileView) => void;
  onInspectEvidence: (
    file: ContextComposerEngineFileView,
    evidence: ContextComposerEvidenceView,
  ) => void;
  onOpenSource: (path: string, line?: number) => void;
}

function LensSection({
  title,
  icon,
  children,
  summary,
  badge,
  collapsible = false,
  defaultOpen = false,
  revealWhen = false,
  tone = "neutral",
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  summary?: ReactNode;
  badge?: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  revealWhen?: boolean;
  tone?: "neutral" | "attention" | "blocking";
}) {
  if (collapsible) {
    return (
      <WorkspaceDisclosure
        title={title}
        icon={icon}
        summary={summary}
        badge={badge}
        defaultOpen={defaultOpen}
        revealWhen={revealWhen}
        tone={tone}
      >
        {children}
      </WorkspaceDisclosure>
    );
  }

  return (
    <section className="rounded-2xl border border-neutral-900 bg-black/30 p-4">
      <div className="flex items-center gap-2 text-neutral-500">
        {icon}
        <h3 className="cf-tech-label text-[9px] uppercase">{title}</h3>
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function LensMetric({
  label,
  value,
  code,
}: {
  label: string;
  value: ReactNode;
  code?: string;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-neutral-900 bg-black/35 px-3 py-3">
      <p className="cf-tech-label text-[8px] uppercase text-neutral-600">
        {label}
      </p>
      <div className="mt-1.5 min-w-0 break-words text-xs font-semibold leading-5 text-neutral-200">
        {value}
      </div>
      {code ? (
        <p className="mt-1 break-all font-mono text-[9px] leading-4 text-neutral-600">
          {code}
        </p>
      ) : null}
    </div>
  );
}

function TraceList({
  items,
  emptyText,
}: {
  items: string[];
  emptyText: string;
}) {
  if (items.length === 0) {
    return <p className="text-xs leading-5 text-neutral-600">{emptyText}</p>;
  }

  return (
    <div className="space-y-1.5">
      {items.map((item) => (
        <p
          key={item}
          className="break-words rounded-lg border border-neutral-900 bg-black/30 px-2.5 py-2 font-mono text-[10px] leading-4 text-neutral-400"
        >
          {item}
        </p>
      ))}
    </div>
  );
}

function formatLineRange(evidence: ContextComposerEvidenceView) {
  if (!evidence.startLine) return "—";
  if (evidence.endLine && evidence.endLine !== evidence.startLine) {
    return `${evidence.startLine}–${evidence.endLine}`;
  }
  return String(evidence.startLine);
}

function EvidenceTraceCard({
  file,
  evidence,
  onInspectEvidence,
  onOpenSource,
}: {
  file: ContextComposerEngineFileView;
  evidence: ContextComposerEvidenceView;
  onInspectEvidence: ExplainabilityLensPanelProps["onInspectEvidence"];
  onOpenSource: ExplainabilityLensPanelProps["onOpenSource"];
}) {
  const { t } = useTranslation();

  return (
    <article className="rounded-xl border border-neutral-900 bg-black/40 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 break-all font-mono text-[10px] leading-4 text-neutral-300">
          {evidence.evidenceId}
        </p>
        <button
          type="button"
          onClick={() => onInspectEvidence(file, evidence)}
          aria-label={t("explainability.inspectEvidence")}
          title={t("explainability.inspectEvidence")}
          className="grid size-7 shrink-0 place-items-center rounded-lg border border-neutral-900 text-neutral-600 transition hover:border-neutral-700 hover:text-white"
        >
          <ScanSearch size={12} />
        </button>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-[10px] leading-4">
        <div>
          <p className="text-neutral-600">{t("inspector.role")}</p>
          <p className="text-neutral-300">
            {t(`settings.composerEngineEvidenceRole_${evidence.role}`)}
          </p>
        </div>
        <div>
          <p className="text-neutral-600">{t("inspector.strength")}</p>
          <p className="text-neutral-300">
            {t(`settings.composerEngineStrength_${evidence.strength}`)}
          </p>
        </div>
        <div>
          <p className="text-neutral-600">{t("inspector.predicate")}</p>
          <p className="break-all font-mono text-neutral-300">
            {evidence.predicate ?? "—"}
          </p>
        </div>
        <div>
          <p className="text-neutral-600">{t("inspector.relationKind")}</p>
          <p className="font-mono text-neutral-300">
            {evidence.relationKind ?? "—"}
          </p>
        </div>
        <div>
          <p className="text-neutral-600">{t("inspector.lines")}</p>
          <p className="font-mono text-neutral-300">
            {formatLineRange(evidence)}
          </p>
        </div>
        <div>
          <p className="text-neutral-600">{t("inspector.reason")}</p>
          <p className="break-all font-mono text-neutral-300">
            {evidence.reasonCode}
          </p>
        </div>
      </div>

      <div className="mt-2 border-t border-neutral-900 pt-2">
        <p className="cf-tech-label text-[8px] uppercase text-neutral-600">
          {t("inspector.provenance")}
        </p>
        <p className="mt-1 break-all font-mono text-[10px] leading-4 text-neutral-500">
          {evidence.path ?? t("inspector.noPath")}
        </p>
      </div>

      {evidence.path ? (
        <button
          type="button"
          onClick={() => onOpenSource(evidence.path!, evidence.startLine)}
          className="mt-2 inline-flex items-center gap-1.5 text-[10px] font-medium text-neutral-400 transition hover:text-white"
        >
          <PanelRightOpen size={11} />
          {t("inspector.openSource")}
        </button>
      ) : null}
    </article>
  );
}

function FindingEvidenceRelationships({
  file,
  onInspectEvidence,
  onOpenSource,
}: {
  file: ContextComposerEngineFileView;
  onInspectEvidence: ExplainabilityLensPanelProps["onInspectEvidence"];
  onOpenSource: ExplainabilityLensPanelProps["onOpenSource"];
}) {
  const { t } = useTranslation();
  const evidenceById = new Map(
    file.evidence.map((evidence) => [evidence.evidenceId, evidence]),
  );
  const linkedEvidenceIds = new Set(
    file.findings.flatMap((finding) => finding.evidenceIds),
  );
  const unlinkedEvidence = file.evidence.filter(
    (evidence) => !linkedEvidenceIds.has(evidence.evidenceId),
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="cf-tech-label text-[8px] uppercase text-neutral-600">
          {t("explainability.findingsAndEvidence")}
        </p>
        <span className="font-mono text-[9px] text-neutral-600">
          {file.findings.length}
        </span>
      </div>

      {file.findings.length > 0 ? (
        <div className="space-y-2">
          {file.findings.map((finding, findingIndex) => {
            const linkedEvidence = finding.evidenceIds
              .map((evidenceId) => evidenceById.get(evidenceId))
              .filter((evidence): evidence is ContextComposerEvidenceView => Boolean(evidence));

            return (
              <details
                key={finding.findingId}
                open={findingIndex === 0}
                className="group/finding rounded-xl border border-white/10 bg-white/[0.02]"
              >
                <summary className="cursor-pointer list-none px-3 py-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="break-all font-mono text-[10px] leading-4 text-neutral-300">
                        {finding.findingId}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <span className="cf-badge">
                          {t(`explainability.findingType_${finding.type}`)}
                        </span>
                        <span className="cf-badge">
                          {t(`explainability.findingStatus_${finding.status}`)}
                        </span>
                        <span className="cf-badge">
                          {t("explainability.linkedEvidenceCount", {
                            count: finding.evidenceIds.length,
                          })}
                        </span>
                      </div>
                    </div>
                    <span className="mt-1 text-[10px] text-neutral-600 transition group-open/finding:rotate-90">
                      ›
                    </span>
                  </div>
                </summary>

                <div className="space-y-3 border-t border-neutral-900 px-3 py-3">
                  <div>
                    <p className="cf-tech-label text-[8px] uppercase text-neutral-600">
                      {t("explainability.findingStatement")}
                    </p>
                    <p className="mt-1.5 text-[11px] leading-5 text-neutral-300">
                      {finding.statement}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <LensMetric
                      label={t("explainability.findingType")}
                      value={t(`explainability.findingType_${finding.type}`)}
                      code={finding.type}
                    />
                    <LensMetric
                      label={t("explainability.findingStatus")}
                      value={t(`explainability.findingStatus_${finding.status}`)}
                      code={finding.status}
                    />
                    <LensMetric
                      label={t("explainability.authorizationHint")}
                      value={t(`explainability.authorizationHint_${finding.authorizationHint}`)}
                      code={finding.authorizationHint}
                    />
                  </div>

                  {finding.limitations.length > 0 ? (
                    <div>
                      <p className="cf-tech-label mb-2 text-[8px] uppercase text-neutral-600">
                        {t("explainability.findingLimitations")}
                      </p>
                      <TraceList
                        items={finding.limitations}
                        emptyText={t("explainability.noneExposed")}
                      />
                    </div>
                  ) : null}

                  <div aria-hidden="true" className="text-center text-[11px] text-neutral-700">
                    ↓
                  </div>

                  <div>
                    <p className="cf-tech-label mb-2 text-[8px] uppercase text-neutral-600">
                      {t("explainability.linkedEvidence")}
                    </p>
                    {linkedEvidence.length > 0 ? (
                      <div className="space-y-2">
                        {linkedEvidence.map((evidence) => (
                          <EvidenceTraceCard
                            key={evidence.evidenceId}
                            file={file}
                            evidence={evidence}
                            onInspectEvidence={onInspectEvidence}
                            onOpenSource={onOpenSource}
                          />
                        ))}
                      </div>
                    ) : (
                      <p className="rounded-xl border border-neutral-900 bg-black/30 px-3 py-3 text-xs leading-5 text-neutral-600">
                        {finding.evidenceIds.length > 0
                          ? t("explainability.linkedEvidenceDetailsUnavailable")
                          : t("explainability.noLinkedEvidence")}
                      </p>
                    )}
                  </div>
                </div>
              </details>
            );
          })}
        </div>
      ) : (
        <p className="rounded-xl border border-neutral-900 bg-black/30 px-3 py-3 text-xs leading-5 text-neutral-600">
          {file.findingIds.length > 0
            ? t("explainability.findingDetailsUnavailable")
            : t("explainability.noFindings")}
        </p>
      )}

      {unlinkedEvidence.length > 0 ? (
        <details className="rounded-xl border border-neutral-900 bg-black/25">
          <summary className="cursor-pointer list-none px-3 py-3 text-[10px] font-medium text-neutral-500">
            {t("explainability.unlinkedEvidence", { count: unlinkedEvidence.length })}
          </summary>
          <div className="space-y-2 border-t border-neutral-900 px-3 py-3">
            <p className="text-[10px] leading-4 text-neutral-600">
              {t("explainability.unlinkedEvidenceDescription")}
            </p>
            {unlinkedEvidence.map((evidence) => (
              <EvidenceTraceCard
                key={evidence.evidenceId}
                file={file}
                evidence={evidence}
                onInspectEvidence={onInspectEvidence}
                onOpenSource={onOpenSource}
              />
            ))}
          </div>
        </details>
      ) : null}

      <details className="rounded-xl border border-neutral-900 bg-black/25">
        <summary className="cursor-pointer list-none px-3 py-3 text-[10px] font-medium text-neutral-500">
          {t("explainability.rawTraceIds")}
        </summary>
        <div className="grid gap-3 border-t border-neutral-900 px-3 py-3 sm:grid-cols-2">
          <div>
            <p className="cf-tech-label mb-2 text-[8px] uppercase text-neutral-600">
              {t("explainability.findingIds")}
            </p>
            <TraceList
              items={file.findingIds}
              emptyText={t("explainability.noneExposed")}
            />
          </div>
          <div>
            <p className="cf-tech-label mb-2 text-[8px] uppercase text-neutral-600">
              {t("explainability.evidenceIds")}
            </p>
            <TraceList
              items={file.evidenceIds}
              emptyText={t("explainability.noneExposed")}
            />
          </div>
        </div>
      </details>
    </div>
  );
}

function eventTitleKey(type: ContextComposerInvestigationEventView["type"]) {
  return `explainability.timelineEvent_${type}`;
}

function InvestigationTimeline({
  view,
  onInspectEvidence,
  onOpenSource,
}: {
  view: ContextComposerEngineView;
  onInspectEvidence: ExplainabilityLensPanelProps["onInspectEvidence"];
  onOpenSource: ExplainabilityLensPanelProps["onOpenSource"];
}) {
  const { t } = useTranslation();
  const timeline = view.timeline;
  const evidenceLocations = new Map<
    string,
    Array<{ file: ContextComposerEngineFileView; evidence: ContextComposerEvidenceView }>
  >();
  for (const file of view.files) {
    for (const evidence of file.evidence) {
      const locations = evidenceLocations.get(evidence.evidenceId) ?? [];
      locations.push({ file, evidence });
      evidenceLocations.set(evidence.evidenceId, locations);
    }
  }

  if (!timeline) {
    return (
      <p className="rounded-xl border border-neutral-900 bg-black/30 px-3 py-4 text-xs leading-5 text-neutral-500">
        {t("explainability.timelineUnavailable")}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-[10px] leading-4 text-neutral-500">
        {t("explainability.timelineDescription")}
      </p>

      {timeline.events.length > 0 ? (
        <ol className="space-y-1.5">
          {timeline.events.map((event) => {
            const primaryValue = event.paths[0] ?? event.status ?? event.stopReason;
            return (
              <li key={event.sequence} className="relative pl-8">
                <span className="absolute left-0 top-2 font-mono text-[9px] text-neutral-700">
                  {String(event.sequence).padStart(2, "0")}
                </span>
                <details className="group/timeline rounded-xl border border-neutral-900 bg-black/30">
                  <summary className="cursor-pointer list-none px-3 py-2.5">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-medium leading-4 text-neutral-300">
                          {t(eventTitleKey(event.type))}
                        </p>
                        {primaryValue ? (
                          <p className="mt-1 truncate font-mono text-[9px] leading-4 text-neutral-600" title={primaryValue}>
                            {primaryValue}
                          </p>
                        ) : null}
                      </div>
                      <span className="mt-0.5 text-[10px] text-neutral-700 transition group-open/timeline:rotate-90">
                        ›
                      </span>
                    </div>
                  </summary>

                  <div className="space-y-3 border-t border-neutral-900 px-3 py-3">
                    <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[10px] leading-4">
                      <div>
                        <p className="text-neutral-600">{t("explainability.eventType")}</p>
                        <p className="break-all font-mono text-neutral-300">{event.type}</p>
                      </div>
                      <div>
                        <p className="text-neutral-600">{t("explainability.round")}</p>
                        <p className="font-mono text-neutral-300">{event.round ?? "—"}</p>
                      </div>
                      {[
                        [t("explainability.operationId"), event.operationId],
                        [t("explainability.operationType"), event.operationType],
                        [t("explainability.operationSource"), event.operationSource],
                        [t("explainability.eventStatus"), event.status],
                        [t("explainability.previousStatus"), event.previousStatus],
                        [t("explainability.stage"), event.stage],
                        [t("explainability.decision"), event.decision],
                        [t("explainability.stopReason"), event.stopReason],
                        [t("explainability.reasonCode"), event.reasonCode],
                        [t("explainability.startedAt"), event.startedAt],
                        [t("explainability.completedAt"), event.completedAt],
                        [t("explainability.duration"), event.durationMs === null ? null : `${event.durationMs} ms`],
                      ].map(([label, value]) => value ? (
                        <div key={label}>
                          <p className="text-neutral-600">{label}</p>
                          <p className="break-all font-mono text-neutral-300">{value}</p>
                        </div>
                      ) : null)}
                    </div>

                    {event.paths.length > 0 ? (
                      <div>
                        <p className="cf-tech-label mb-2 text-[8px] uppercase text-neutral-600">
                          {t("explainability.sourcePaths")}
                        </p>
                        <div className="space-y-1.5">
                          {event.paths.map((path) => (
                            <button
                              key={path}
                              type="button"
                              onClick={() => onOpenSource(path, event.startLine ?? undefined)}
                              className="flex w-full min-w-0 items-center gap-2 rounded-lg border border-neutral-900 px-2.5 py-2 text-left transition hover:border-neutral-700"
                            >
                              <PanelRightOpen size={11} className="shrink-0 text-neutral-600" />
                              <span className="min-w-0 flex-1 truncate font-mono text-[9px] text-neutral-400" title={path}>
                                {path}
                              </span>
                              {event.startLine ? (
                                <span className="shrink-0 font-mono text-[9px] text-neutral-700">
                                  {event.startLine}{event.endLine && event.endLine !== event.startLine ? `–${event.endLine}` : ""}
                                </span>
                              ) : null}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {event.findingIds.length > 0 ? (
                      <div>
                        <p className="cf-tech-label mb-2 text-[8px] uppercase text-neutral-600">
                          {t("explainability.relatedFindings")}
                        </p>
                        <TraceList items={event.findingIds} emptyText={t("explainability.noneExposed")} />
                      </div>
                    ) : null}

                    {event.evidenceIds.length > 0 ? (
                      <div>
                        <p className="cf-tech-label mb-2 text-[8px] uppercase text-neutral-600">
                          {t("explainability.relatedEvidence")}
                        </p>
                        <div className="space-y-1.5">
                          {event.evidenceIds.map((evidenceId) => {
                            const locations = evidenceLocations.get(evidenceId) ?? [];
                            const location = locations.length === 1 ? locations[0] : null;
                            return (
                              <div key={evidenceId} className="flex items-center gap-2 rounded-lg border border-neutral-900 px-2.5 py-2">
                                <span className="min-w-0 flex-1 break-all font-mono text-[9px] leading-4 text-neutral-400">
                                  {evidenceId}
                                </span>
                                {location ? (
                                  <button
                                    type="button"
                                    onClick={() => onInspectEvidence(location.file, location.evidence)}
                                    aria-label={t("explainability.inspectEvidence")}
                                    title={t("explainability.inspectEvidence")}
                                    className="grid size-7 shrink-0 place-items-center rounded-lg text-neutral-600 transition hover:text-white"
                                  >
                                    <ScanSearch size={11} />
                                  </button>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </details>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="rounded-xl border border-neutral-900 bg-black/30 px-3 py-4 text-xs leading-5 text-neutral-500">
          {t("explainability.timelineEmpty")}
        </p>
      )}

      <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-3">
        <p className="cf-tech-label text-[8px] uppercase text-neutral-600">
          {t("explainability.contextEngineResult")}
        </p>
        <p className="mt-1.5 text-[11px] font-medium text-neutral-300">
          {t(`settings.composerEngineStatus_${view.status}`)}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5 font-mono text-[9px] text-neutral-500">
          <span>{view.status}</span>
          <span aria-hidden="true">·</span>
          <span>{view.effectiveSource}</span>
          {view.stopReason ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{view.stopReason}</span>
            </>
          ) : null}
        </div>
      </div>

      <details className="rounded-xl border border-neutral-900 bg-black/25">
        <summary className="cursor-pointer list-none px-3 py-3 text-[10px] font-medium text-neutral-500">
          {t("explainability.finalCoverage")}
        </summary>
        <div className="grid grid-cols-2 gap-2 border-t border-neutral-900 px-3 py-3">
          <LensMetric
            label={t("explainability.questionsCoverage")}
            value={`${timeline.coverage.questionsAnswered} / ${timeline.coverage.questionsTotal}`}
          />
          <LensMetric
            label={t("explainability.hypothesesCoverage")}
            value={`${timeline.coverage.hypothesesSupported} / ${timeline.coverage.hypothesesTotal}`}
          />
          <LensMetric label={t("explainability.filesRead")} value={timeline.coverage.filesRead} />
          <LensMetric label={t("explainability.filesParsed")} value={timeline.coverage.filesParsed} />
          <LensMetric label={t("explainability.relationshipHops")} value={timeline.coverage.relationshipHops} />
          <LensMetric label={t("explainability.evidenceGroups")} value={timeline.coverage.evidenceIndependentGroups} />
          <LensMetric
            label={t("explainability.snapshotTruncated")}
            value={timeline.coverage.snapshotTruncated ? t("explainability.yes") : t("explainability.no")}
          />
        </div>
      </details>
    </div>
  );
}

function formatDiffValue(value: ContextDiffValue, yes: string, no: string) {
  if (value === null) return "—";
  if (typeof value === "boolean") return value ? yes : no;
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "[]";
  return String(value);
}

function DiffFieldChanges({ changes }: { changes: ContextDiffFieldChange[] }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1.5">
      {changes.map((change) => (
        <div key={change.field} className="rounded-lg border border-neutral-900 bg-black/30 px-2.5 py-2">
          <p className="font-mono text-[9px] text-neutral-600">{change.field}</p>
          <p className="mt-1 break-words font-mono text-[9px] leading-4 text-neutral-400">
            {formatDiffValue(change.before, t("explainability.yes"), t("explainability.no"))}
            <span className="px-1.5 text-neutral-700">→</span>
            {formatDiffValue(change.after, t("explainability.yes"), t("explainability.no"))}
          </p>
        </div>
      ))}
    </div>
  );
}

function ContextDiffFileRow({
  path,
  changes,
  currentFile,
  onInspectFile,
  onOpenSource,
}: {
  path: string;
  changes?: ContextDiffFieldChange[];
  currentFile?: ContextComposerEngineFileView;
  onInspectFile: ExplainabilityLensPanelProps["onInspectFile"];
  onOpenSource: ExplainabilityLensPanelProps["onOpenSource"];
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border border-neutral-900 bg-black/30 px-3 py-2.5">
      <p className="break-all font-mono text-[10px] leading-4 text-neutral-300">{path}</p>
      {changes && changes.length > 0 ? (
        <div className="mt-2"><DiffFieldChanges changes={changes} /></div>
      ) : null}
      {currentFile ? (
        <div className="mt-2 flex flex-wrap gap-2 border-t border-neutral-900 pt-2">
          <button
            type="button"
            onClick={() => onInspectFile(currentFile)}
            className="inline-flex items-center gap-1.5 text-[10px] text-neutral-500 transition hover:text-white"
          >
            <ScanSearch size={11} />
            {t("explainability.inspectFile")}
          </button>
          <button
            type="button"
            onClick={() => onOpenSource(currentFile.path)}
            className="inline-flex items-center gap-1.5 text-[10px] text-neutral-500 transition hover:text-white"
          >
            <PanelRightOpen size={11} />
            {t("inspector.openInSplitView")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ContextDiffIdGroup({
  title,
  added,
  removed,
  changed,
  unchanged,
}: {
  title: string;
  added: string[];
  removed: string[];
  changed: Array<{ id: string; changes: ContextDiffFieldChange[] }>;
  unchanged: string[];
}) {
  const { t } = useTranslation();
  return (
    <details className="rounded-xl border border-neutral-900 bg-black/25">
      <summary className="cursor-pointer list-none px-3 py-3 text-[10px] font-medium text-neutral-500">
        {title}
        <span className="ml-2 font-mono text-[9px] text-neutral-700">
          +{added.length} −{removed.length} ~{changed.length} ={unchanged.length}
        </span>
      </summary>
      <div className="space-y-3 border-t border-neutral-900 px-3 py-3">
        {[
          [t("explainability.diffAdded"), added],
          [t("explainability.diffRemoved"), removed],
          [t("explainability.diffUnchanged"), unchanged],
        ].map(([label, ids]) => (ids as string[]).length > 0 ? (
          <div key={label as string}>
            <p className="cf-tech-label mb-1.5 text-[8px] uppercase text-neutral-600">{label as string}</p>
            <TraceList items={ids as string[]} emptyText={t("explainability.noneExposed")} />
          </div>
        ) : null)}
        {changed.length > 0 ? (
          <div>
            <p className="cf-tech-label mb-1.5 text-[8px] uppercase text-neutral-600">{t("explainability.diffChanged")}</p>
            <div className="space-y-2">
              {changed.map((record) => (
                <div key={record.id} className="rounded-lg border border-neutral-900 p-2.5">
                  <p className="break-all font-mono text-[9px] text-neutral-400">{record.id}</p>
                  <div className="mt-2"><DiffFieldChanges changes={record.changes} /></div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {added.length + removed.length + changed.length + unchanged.length === 0 ? (
          <p className="text-xs text-neutral-600">{t("explainability.diffNoRecords")}</p>
        ) : null}
      </div>
    </details>
  );
}

function ContextDiffView({
  view,
  contextDiff,
  onInspectFile,
  onOpenSource,
}: {
  view: ContextComposerEngineView;
  contextDiff: ExplainabilityLensPanelProps["contextDiff"];
  onInspectFile: ExplainabilityLensPanelProps["onInspectFile"];
  onOpenSource: ExplainabilityLensPanelProps["onOpenSource"];
}) {
  const { t } = useTranslation();
  if (!contextDiff?.current) {
    return <p className="rounded-xl border border-neutral-900 bg-black/30 px-3 py-4 text-xs leading-5 text-neutral-500">{t("explainability.contextDiffUnavailable")}</p>;
  }
  if (!contextDiff.previous) {
    return (
      <div className="rounded-xl border border-neutral-900 bg-black/30 px-3 py-4">
        <p className="text-xs leading-5 text-neutral-500">{t("explainability.contextDiffNoPrevious")}</p>
        <p className="mt-2 text-[10px] leading-4 text-neutral-700">{t("explainability.contextDiffSessionOnly")}</p>
      </div>
    );
  }

  const diff = compareContextDiffSnapshots(contextDiff.previous, contextDiff.current);
  const currentFiles = new Map(view.files.map((file) => [contextDiffPathIdentity(file.path), file]));
  const fileGroups = [
    { key: "added", title: t("explainability.diffAdded"), records: diff.files.added, current: true },
    { key: "removed", title: t("explainability.diffRemoved"), records: diff.files.removed, current: false },
    { key: "changed", title: t("explainability.diffChanged"), records: diff.files.changed.map((record) => record.after), current: true },
    { key: "unchanged", title: t("explainability.diffUnchanged"), records: diff.files.unchanged, current: true },
  ] as const;

  return (
    <div className="space-y-3">
      <p className="text-[10px] leading-4 text-neutral-500">{t("explainability.contextDiffSessionOnly")}</p>
      <div className="grid grid-cols-4 gap-1.5">
        {[
          ["+", diff.files.added.length, t("explainability.diffAdded")],
          ["−", diff.files.removed.length, t("explainability.diffRemoved")],
          ["~", diff.files.changed.length, t("explainability.diffChanged")],
          ["=", diff.files.unchanged.length, t("explainability.diffUnchanged")],
        ].map(([symbol, count, label]) => (
          <div key={symbol as string} className="min-w-0 rounded-lg border border-neutral-900 bg-black/35 px-2 py-2 text-center">
            <p className="font-mono text-sm text-neutral-300">{symbol}{count}</p>
            <p className="mt-0.5 truncate text-[8px] text-neutral-700" title={label as string}>{label as string}</p>
          </div>
        ))}
      </div>

      {diff.engineChanges.length > 0 ? (
        <details open className="rounded-xl border border-white/10 bg-white/[0.02]">
          <summary className="cursor-pointer list-none px-3 py-3 text-[10px] font-medium text-neutral-500">{t("explainability.engineResultChanges")}</summary>
          <div className="border-t border-neutral-900 px-3 py-3"><DiffFieldChanges changes={diff.engineChanges} /></div>
        </details>
      ) : null}

      {fileGroups.map((group) => group.records.length > 0 ? (
        <details key={group.key} open={group.key !== "unchanged"} className="rounded-xl border border-neutral-900 bg-black/25">
          <summary className="cursor-pointer list-none px-3 py-3 text-[10px] font-medium text-neutral-500">
            {group.title} <span className="ml-1 font-mono text-neutral-700">{group.records.length}</span>
          </summary>
          <div className="space-y-2 border-t border-neutral-900 px-3 py-3">
            {group.records.map((file) => {
              const changed = group.key === "changed"
                ? diff.files.changed.find((record) => record.after.normalizedPath === file.normalizedPath)?.changes
                : undefined;
              return (
                <ContextDiffFileRow
                  key={file.normalizedPath}
                  path={file.path}
                  changes={changed}
                  currentFile={group.current ? currentFiles.get(file.normalizedPath) : undefined}
                  onInspectFile={onInspectFile}
                  onOpenSource={onOpenSource}
                />
              );
            })}
          </div>
        </details>
      ) : null)}

      {diff.files.added.length + diff.files.removed.length + diff.files.changed.length === 0 ? (
        <p className="rounded-xl border border-neutral-900 bg-black/30 px-3 py-3 text-xs leading-5 text-neutral-500">{t("explainability.contextFilesUnchanged")}</p>
      ) : null}

      <ContextDiffIdGroup
        title={t("explainability.diffFindings")}
        added={diff.findings.added.map((record) => record.findingId)}
        removed={diff.findings.removed.map((record) => record.findingId)}
        changed={diff.findings.changed.map((record) => ({ id: record.after.findingId, changes: record.changes }))}
        unchanged={diff.findings.unchanged.map((record) => record.findingId)}
      />
      <ContextDiffIdGroup
        title={t("explainability.diffEvidence")}
        added={diff.evidence.added.map((record) => record.evidenceId)}
        removed={diff.evidence.removed.map((record) => record.evidenceId)}
        changed={diff.evidence.changed.map((record) => ({ id: record.after.evidenceId, changes: record.changes }))}
        unchanged={diff.evidence.unchanged.map((record) => record.evidenceId)}
      />

      <details className="rounded-xl border border-neutral-900 bg-black/25">
        <summary className="cursor-pointer list-none px-3 py-3 text-[10px] font-medium text-neutral-500">{t("explainability.diffOtherChanges")}</summary>
        <div className="space-y-3 border-t border-neutral-900 px-3 py-3">
          <div>
            <p className="cf-tech-label mb-1.5 text-[8px] uppercase text-neutral-600">{t("explainability.limitations")}</p>
            <TraceList
              items={[
                ...diff.limitations.added.map((value) => `+ ${value}`),
                ...diff.limitations.removed.map((value) => `− ${value}`),
              ]}
              emptyText={t("explainability.diffNoChanges")}
            />
          </div>
          <div>
            <p className="cf-tech-label mb-1.5 text-[8px] uppercase text-neutral-600">{t("explainability.unresolvedQuestions")}</p>
            <TraceList
              items={[
                ...diff.unresolvedQuestions.added.map((value) => `+ ${value.category}:${value.status}`),
                ...diff.unresolvedQuestions.removed.map((value) => `− ${value.category}:${value.status}`),
              ]}
              emptyText={t("explainability.diffNoChanges")}
            />
          </div>
        </div>
      </details>
    </div>
  );
}

export function ExplainabilityLensPanel({
  view,
  projectName,
  contextDiff,
  onClose,
  onInspectFile,
  onInspectEvidence,
  onOpenSource,
}: ExplainabilityLensPanelProps) {
  const { t } = useTranslation();
  const prefersReducedMotion = useReducedMotion();
  const isBlocked = view.status === "safety_blocked";
  const evidenceReferenceCount = view.files.reduce(
    (total, file) => total + file.evidenceIds.length,
    0,
  );
  const evidenceDetailCount = view.files.reduce(
    (total, file) => total + file.evidence.length,
    0,
  );
  const comparableDiff = contextDiff?.previous && contextDiff.current
    ? compareContextDiffSnapshots(contextDiff.previous, contextDiff.current)
    : null;
  const contextDiffSummary = !contextDiff?.current
    ? t("explainability.contextDiffUnavailable")
    : !contextDiff.previous
      ? t("explainability.contextDiffNoPrevious")
      : t("explainability.contextDiffSummary", {
          added: comparableDiff?.files.added.length ?? 0,
          removed: comparableDiff?.files.removed.length ?? 0,
          changed: comparableDiff?.files.changed.length ?? 0,
          unchanged: comparableDiff?.files.unchanged.length ?? 0,
        });
  const hasContextDiffChanges = Boolean(comparableDiff && (
    comparableDiff.engineChanges.length > 0
    || comparableDiff.files.added.length > 0
    || comparableDiff.files.removed.length > 0
    || comparableDiff.files.changed.length > 0
    || comparableDiff.findings.added.length > 0
    || comparableDiff.findings.removed.length > 0
    || comparableDiff.findings.changed.length > 0
    || comparableDiff.evidence.added.length > 0
    || comparableDiff.evidence.removed.length > 0
    || comparableDiff.evidence.changed.length > 0
    || comparableDiff.limitations.added.length > 0
    || comparableDiff.limitations.removed.length > 0
    || comparableDiff.unresolvedQuestions.added.length > 0
    || comparableDiff.unresolvedQuestions.removed.length > 0
  ));
  const timelineSummary = view.timeline
    ? t("explainability.timelineSummary", { count: view.timeline.events.length })
    : t("explainability.timelineUnavailable");

  const translatedStopReason = view.stopReason
    ? t(`settings.composerEngineStop_${view.stopReason}`, {
        defaultValue: view.stopReason,
      })
    : null;
  const translatedFallbackReason = view.fallbackReason
    ? t(`settings.composerEngineReason_${view.fallbackReason}`, {
        defaultValue: view.fallbackReason,
      })
    : null;

  return (
    <motion.aside
      aria-label={t("explainability.title")}
      initial={prefersReducedMotion ? false : { opacity: 0, x: 22 }}
      animate={{ opacity: 1, x: 0 }}
      exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: 18 }}
      transition={
        prefersReducedMotion
          ? { duration: 0 }
          : { type: "spring", stiffness: 430, damping: 40, mass: 0.7 }
      }
      className="fixed bottom-[27px] right-0 top-[48px] z-[82] flex w-[min(480px,calc(100vw-18px))] flex-col overflow-hidden border-l border-white/[0.10] bg-black/98 shadow-[-24px_0_80px_rgba(0,0,0,0.58)] xl:relative xl:bottom-auto xl:right-auto xl:top-auto xl:z-10 xl:w-[clamp(320px,38vw,480px)] xl:shrink-0 xl:shadow-none"
    >
      <header className="shrink-0 border-b border-neutral-900 bg-black/96 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <CircleHelp size={13} className="text-neutral-500" />
              <span className="cf-tech-label text-[9px] uppercase text-neutral-500">
                {t("explainability.eyebrow")}
              </span>
              <span className="size-1 rounded-full bg-neutral-800" />
              <span className="truncate text-[9px] uppercase tracking-[0.1em] text-neutral-600">
                {projectName}
              </span>
            </div>

            <h2 className="mt-2 text-base font-semibold leading-6 text-white">
              {t("explainability.title")}
            </h2>
            <p className="mt-1 text-[10px] leading-4 text-neutral-500">
              {t("explainability.description")}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={t("explainability.close")}
            title={t("explainability.close")}
            className="grid size-8 shrink-0 place-items-center rounded-xl border border-neutral-900 bg-black text-neutral-600 transition hover:border-neutral-700 hover:text-white"
          >
            <X size={14} />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        <LensSection
          title={t("explainability.resultState")}
          icon={
            isBlocked ? (
              <TriangleAlert size={13} className="text-red-300" />
            ) : (
              <ShieldCheck size={13} />
            )
          }
        >
          <div className="grid grid-cols-2 gap-2">
            <LensMetric
              label={t("explainability.requestedMode")}
              value={t(`settings.composerEngineMode_${view.requestedMode}`)}
              code={view.requestedMode}
            />
            <LensMetric
              label={t("explainability.decisionSource")}
              value={t(`settings.composerEngineSource_${view.effectiveSource}`)}
              code={view.effectiveSource}
            />
            <LensMetric
              label={t("explainability.status")}
              value={t(`settings.composerEngineStatus_${view.status}`)}
              code={view.status}
            />
            <LensMetric
              label={t("explainability.contextFiles")}
              value={view.files.length}
            />
          </div>

          {view.stopReason ? (
            <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.025] px-3 py-3">
              <p className="cf-tech-label text-[8px] uppercase text-neutral-600">
                {t("explainability.stopReason")}
              </p>
              <p className="mt-1.5 text-xs leading-5 text-neutral-300">
                {translatedStopReason}
              </p>
              <p className="mt-1 break-all font-mono text-[9px] text-neutral-600">
                {view.stopReason}
              </p>
            </div>
          ) : null}

          {view.fallbackReason ? (
            <div className="mt-2 rounded-xl border border-white/10 bg-white/[0.025] px-3 py-3">
              <p className="cf-tech-label text-[8px] uppercase text-neutral-600">
                {t("explainability.fallbackReason")}
              </p>
              <p className="mt-1.5 text-xs leading-5 text-neutral-300">
                {translatedFallbackReason}
              </p>
              <p className="mt-1 break-all font-mono text-[9px] text-neutral-600">
                {view.fallbackReason}
              </p>
            </div>
          ) : null}
        </LensSection>

        <LensSection
          title={t("explainability.contextDiff")}
          icon={<GitCompareArrows size={13} />}
          summary={contextDiffSummary}
          collapsible
          defaultOpen={hasContextDiffChanges}
          revealWhen={hasContextDiffChanges}
        >
          <ContextDiffView
            view={view}
            contextDiff={contextDiff}
            onInspectFile={onInspectFile}
            onOpenSource={onOpenSource}
          />
        </LensSection>

        <LensSection
          title={t("explainability.investigationTimeline")}
          icon={<ListChecks size={13} />}
          summary={timelineSummary}
          badge={view.timeline ? <span className="cf-badge">{view.timeline.events.length}</span> : null}
          collapsible
        >
          <InvestigationTimeline
            view={view}
            onInspectEvidence={onInspectEvidence}
            onOpenSource={onOpenSource}
          />
        </LensSection>

        <LensSection
          title={t("explainability.limitations")}
          icon={<ListChecks size={13} />}
          summary={t("explainability.limitationsSummary", { count: view.limitations.length })}
          badge={<span className="cf-badge">{view.limitations.length}</span>}
          collapsible
          defaultOpen={view.limitations.length > 0}
          revealWhen={view.limitations.length > 0}
          tone={view.limitations.length > 0 ? "attention" : "neutral"}
        >
          <TraceList
            items={view.limitations}
            emptyText={t("explainability.noLimitations")}
          />
        </LensSection>

        <LensSection
          title={t("explainability.unresolvedQuestions")}
          icon={<CircleHelp size={13} />}
          summary={t("explainability.unresolvedQuestionsSummary", { count: view.unresolvedQuestions.length })}
          badge={<span className="cf-badge">{view.unresolvedQuestions.length}</span>}
          collapsible
          defaultOpen={view.unresolvedQuestions.length > 0}
          revealWhen={view.unresolvedQuestions.length > 0}
          tone={view.unresolvedQuestions.length > 0 ? "attention" : "neutral"}
        >
          {view.unresolvedQuestions.length > 0 ? (
            <div className="space-y-2">
              {view.unresolvedQuestions.map((question, index) => (
                <div
                  key={`${question.category}:${question.status}:${index}`}
                  className="grid grid-cols-2 gap-2 rounded-xl border border-neutral-900 bg-black/30 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="cf-tech-label text-[8px] uppercase text-neutral-600">
                      {t("explainability.category")}
                    </p>
                    <p className="mt-1 break-words font-mono text-[10px] text-neutral-300">
                      {question.category}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="cf-tech-label text-[8px] uppercase text-neutral-600">
                      {t("explainability.questionStatus")}
                    </p>
                    <p className="mt-1 break-words font-mono text-[10px] text-neutral-300">
                      {question.status}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs leading-5 text-neutral-600">
              {t("explainability.noUnresolvedQuestions")}
            </p>
          )}
        </LensSection>

        <LensSection
          title={t("explainability.contextFiles")}
          icon={<FileCode2 size={13} />}
          summary={t("explainability.contextFilesSummary", {
            files: view.files.length,
            evidence: evidenceReferenceCount,
            review: view.files.filter((file) => file.reviewRequired).length,
          })}
        >
          {view.files.length > 0 ? (
            <div className="space-y-2.5">
              {view.files.map((file, fileIndex) => (
                <details
                  key={`${file.role}:${file.path}`}
                  open={fileIndex === 0}
                  className="group rounded-xl border border-neutral-900 bg-black/35"
                >
                  <summary className="cursor-pointer list-none px-3 py-3">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="break-all font-mono text-[11px] leading-5 text-neutral-200">
                          {file.path}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <span className="cf-badge">
                            {t(`settings.composerEngineRole_${file.role}`)}
                          </span>
                          <span className="cf-badge">
                            {t(`explainability.usage_${file.usage}`)}
                          </span>
                          <span className="cf-badge">
                            {t(`settings.composerEngineSource_${file.source}`)}
                          </span>
                          {file.reviewRequired ? (
                            <span className="rounded-full border border-amber-300/20 bg-amber-300/5 px-2 py-1 text-[9px] text-amber-200">
                              {t("explainability.reviewRequired")}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <span className="mt-1 text-[10px] text-neutral-600 transition group-open:rotate-90">
                        ›
                      </span>
                    </div>
                  </summary>

                  <div className="space-y-3 border-t border-neutral-900 px-3 py-3">
                    <div className="grid grid-cols-2 gap-2">
                      <LensMetric
                        label={t("inspector.role")}
                        value={t(`settings.composerEngineRole_${file.role}`)}
                        code={file.role}
                      />
                      <LensMetric
                        label={t("inspector.usage")}
                        value={t(`explainability.usage_${file.usage}`)}
                        code={file.usage}
                      />
                      <LensMetric
                        label={t("inspector.source")}
                        value={t(`settings.composerEngineSource_${file.source}`)}
                        code={file.source}
                      />
                      <LensMetric
                        label={t("inspector.review")}
                        value={
                          file.reviewRequired
                            ? t("explainability.reviewRequired")
                            : t("explainability.reviewNotRequired")
                        }
                      />
                    </div>

                    <div>
                      <p className="cf-tech-label text-[8px] uppercase text-neutral-600">
                        {t("explainability.primaryReason")}
                      </p>
                      <p className="mt-1.5 break-all font-mono text-[10px] text-neutral-300">
                        {file.reasonCode}
                      </p>
                      <p className="mt-1 text-[10px] leading-4 text-neutral-500">
                        {t(`settings.composerEngineReason_${file.reasonCode}`, {
                          defaultValue: file.reasonCode,
                        })}
                      </p>
                    </div>

                    <div>
                      <p className="cf-tech-label mb-2 text-[8px] uppercase text-neutral-600">
                        {t("explainability.reasonCodes")}
                      </p>
                      <TraceList
                        items={file.reasonCodes}
                        emptyText={t("explainability.noneExposed")}
                      />
                    </div>

                    <FindingEvidenceRelationships
                      file={file}
                      onInspectEvidence={onInspectEvidence}
                      onOpenSource={onOpenSource}
                    />

                    <div className="flex flex-wrap gap-2 border-t border-neutral-900 pt-3">
                      <Button
                        variant="secondary"
                        onClick={() => onInspectFile(file)}
                      >
                        <ScanSearch size={13} />
                        {t("explainability.inspectFile")}
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => onOpenSource(file.path)}
                      >
                        <PanelRightOpen size={13} />
                        {t("inspector.openInSplitView")}
                      </Button>
                    </div>
                  </div>
                </details>
              ))}
            </div>
          ) : (
            <p className="rounded-xl border border-neutral-900 bg-black/30 px-3 py-4 text-xs leading-5 text-neutral-500">
              {t("explainability.noContextFiles")}
            </p>
          )}

          {evidenceReferenceCount === 0 && evidenceDetailCount === 0 ? (
            <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.025] px-3 py-4 text-center">
              <CircleHelp size={16} className="mx-auto text-neutral-600" />
              <p className="mt-2 text-xs leading-5 text-neutral-500">
                {t("explainability.noEvidence")}
              </p>
            </div>
          ) : null}
        </LensSection>

        <LensSection
          title={t("explainability.comparison")}
          icon={<GitCompareArrows size={13} />}
          summary={view.comparison
            ? t("settings.composerEngineComparison", {
                matched: view.comparison.exactEditablePaths.length,
                disagreements: view.comparison.explicitTargetDisagreements.length,
              })
            : t("explainability.comparisonUnavailable")}
          collapsible
        >
          {view.comparison ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <LensMetric
                  label={t("explainability.outcome")}
                  value={view.comparison.outcome}
                />
                <LensMetric
                  label={t("explainability.safeBlockAgreement")}
                  value={
                    view.comparison.safeBlockAgreement
                      ? t("explainability.yes")
                      : t("explainability.no")
                  }
                />
              </div>

              {[
                [
                  t("explainability.exactEditablePaths"),
                  view.comparison.exactEditablePaths,
                ],
                [
                  t("explainability.legacyOnlyEditablePaths"),
                  view.comparison.legacyOnlyEditablePaths,
                ],
                [
                  t("explainability.v2OnlyEditablePaths"),
                  view.comparison.v2OnlyEditablePaths,
                ],
                [
                  t("explainability.explicitTargetDisagreements"),
                  view.comparison.explicitTargetDisagreements,
                ],
              ].map(([label, items]) => (
                <div key={label as string}>
                  <p className="cf-tech-label mb-2 text-[8px] uppercase text-neutral-600">
                    {label as string}
                  </p>
                  <TraceList
                    items={items as string[]}
                    emptyText={t("explainability.noneExposed")}
                  />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs leading-5 text-neutral-600">
              {t("explainability.comparisonUnavailable")}
            </p>
          )}
        </LensSection>
      </div>

      <footer className="shrink-0 border-t border-neutral-900 bg-black/96 px-4 py-3">
        <p className="text-[10px] leading-4 text-neutral-600">
          {t("explainability.historyHint")}
        </p>
      </footer>
    </motion.aside>
  );
}
