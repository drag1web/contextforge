import type { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";
import {
  Archive,
  CheckCircle2,
  ExternalLink,
  FileCode2,
  FileQuestion,
  Gauge,
  ListTree,
  PanelRightOpen,
  Route,
  ShieldCheck,
  TriangleAlert,
  X,
} from "lucide-react";

import type { QuickPeekTarget } from "../../types/quickPeek";
import type { InspectorTarget } from "../../types/inspector";
import {
  formatContextFileRole,
  formatContextFileSource,
  formatContextFileUsage,
  formatEvidenceRole,
  formatEvidenceStrength,
} from "../../utils/contextFileLabels";
import { Button } from "../ui/Button";
import { ProjectFileDragHandle } from "./ProjectFileDragHandle";

interface PersistentInspectorPanelProps {
  target: InspectorTarget;
  onClose: () => void;
  onOpenInSplitView: (target: QuickPeekTarget) => void;
  onOpenProject: (projectId: number) => void;
  onOpenTaskPack: (
    taskPack: Extract<InspectorTarget, { kind: "task-pack" }>["taskPack"],
  ) => void;
}

function getFileName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function formatDate(value: string | null | undefined, language: string) {
  if (!value) return "—";

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";

  return new Intl.DateTimeFormat(
    language.startsWith("ru") ? "ru-RU" : "en-US",
    {
      dateStyle: "medium",
      timeStyle: "short",
    },
  ).format(date);
}

function InspectorMetric({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-xl border border-neutral-900 bg-black/35 px-3 py-3">
      <p className="cf-tech-label text-[8px] uppercase text-neutral-700">
        {label}
      </p>
      <p
        title={String(value)}
        className="mt-1.5 min-w-0 break-words text-xs font-semibold leading-5 text-neutral-200"
      >
        {value}
      </p>
    </div>
  );
}

function InspectorSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-neutral-900 bg-black/30 p-4">
      <div className="flex items-center gap-2 text-neutral-600">
        {icon}
        <p className="cf-tech-label text-[9px] uppercase">{title}</p>
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function createEvidenceFileTarget(
  target: Extract<InspectorTarget, { kind: "evidence" }>,
): QuickPeekTarget | null {
  const path = target.evidence.path;

  if (!path) {
    return null;
  }

  return {
    kind: "file",
    title: getFileName(path),
    displayPath: path,
    filePath: path,
    projectId: target.projectId,
    projectName: target.projectName,
    line: target.evidence.startLine,
  };
}

function createParentContextFileTarget(
  target: Extract<InspectorTarget, { kind: "evidence" }>,
): QuickPeekTarget | null {
  const path = target.contextFile?.path;

  if (!path) {
    return null;
  }

  return {
    kind: "file",
    title: getFileName(path),
    displayPath: path,
    filePath: path,
    projectId: target.projectId,
    projectName: target.projectName,
  };
}

function getTargetTitle(target: InspectorTarget) {
  if (target.kind === "file") {
    return target.file.title;
  }

  if (target.kind === "context") {
    return target.preview.project.name;
  }

  if (target.kind === "evidence") {
    return target.evidence.path
      ? getFileName(target.evidence.path)
      : target.evidence.evidenceId;
  }

  return target.taskPack.title;
}

function getTargetKindKey(target: InspectorTarget) {
  if (target.kind === "file") return "inspector.file";
  if (target.kind === "context") return "inspector.context";
  if (target.kind === "evidence") return "inspector.evidence";
  return "inspector.taskPack";
}

export function PersistentInspectorPanel({
  target,
  onClose,
  onOpenInSplitView,
  onOpenProject,
  onOpenTaskPack,
}: PersistentInspectorPanelProps) {
  const { t, i18n } = useTranslation();
  const prefersReducedMotion = useReducedMotion();
  const evidenceFileTarget =
    target.kind === "evidence" ? createEvidenceFileTarget(target) : null;
  const parentContextFileTarget =
    target.kind === "evidence"
      ? createParentContextFileTarget(target)
      : null;

  return (
    <motion.aside
      aria-label={t("inspector.title")}
      initial={prefersReducedMotion ? false : { opacity: 0, x: 22 }}
      animate={{ opacity: 1, x: 0 }}
      exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: 18 }}
      transition={
        prefersReducedMotion
          ? { duration: 0 }
          : { type: "spring", stiffness: 430, damping: 40, mass: 0.7 }
      }
      className="fixed bottom-[27px] right-0 top-[48px] z-[82] flex w-[min(390px,calc(100vw-18px))] flex-col overflow-hidden border-l border-white/[0.10] bg-black/98 shadow-[-24px_0_80px_rgba(0,0,0,0.58)] xl:relative xl:bottom-auto xl:right-auto xl:top-auto xl:z-10 xl:w-[clamp(300px,30vw,390px)] xl:shrink-0 xl:shadow-none"
    >
      <header className="shrink-0 border-b border-neutral-900 bg-black/96 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="cf-tech-label text-[9px] uppercase text-neutral-600">
                {t("inspector.eyebrow")}
              </span>
              <span className="size-1 rounded-full bg-neutral-800" />
              <span className="text-[9px] uppercase tracking-[0.1em] text-neutral-700">
                {t(getTargetKindKey(target))}
              </span>
            </div>

            <h2
              title={getTargetTitle(target)}
              className="mt-2 break-words text-base font-semibold leading-6 text-white"
            >
              {getTargetTitle(target)}
            </h2>

            <p className="mt-1 text-[10px] leading-4 text-neutral-600">
              {t("inspector.persistentHint")}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {target.kind === "file" && target.file.projectId ? (
              <ProjectFileDragHandle
                projectId={target.file.projectId}
                path={target.file.filePath ?? target.file.displayPath}
                label={t("dragAndDrop.dragFileToBasket", {
                  path: target.file.displayPath,
                })}
                className="size-8 rounded-xl border border-neutral-900 bg-black"
              />
            ) : null}

            <button
              type="button"
              onClick={onClose}
              aria-label={t("inspector.close")}
              title={t("inspector.close")}
              className="grid size-8 shrink-0 place-items-center rounded-xl border border-neutral-900 bg-black text-neutral-600 transition hover:border-neutral-700 hover:text-white"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {target.kind === "file" ? (
          <>
            <InspectorSection
              title={t("inspector.identity")}
              icon={<FileCode2 size={13} />}
            >
              <p className="break-all font-mono text-[11px] leading-5 text-neutral-300">
                {target.file.displayPath}
              </p>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <InspectorMetric
                  label={t("inspector.project")}
                  value={target.file.projectName ?? "—"}
                />
                <InspectorMetric
                  label={t("inspector.line")}
                  value={target.file.line ?? "—"}
                />
              </div>
            </InspectorSection>

            {target.contextFile ? (
              <>
                <InspectorSection
                  title={t("inspector.contextMetadata")}
                  icon={<ListTree size={13} />}
                >
                  <div className="grid grid-cols-2 gap-2">
                    <InspectorMetric
                      label={t("inspector.role")}
                      value={formatContextFileRole(target.contextFile.role, t)}
                    />
                    <InspectorMetric
                      label={t("inspector.usage")}
                      value={formatContextFileUsage(target.contextFile.usage, t)}
                    />
                    <InspectorMetric
                      label={t("inspector.source")}
                      value={formatContextFileSource(target.contextFile.source, t)}
                    />
                    <InspectorMetric
                      label={t("inspector.review")}
                      value={
                        target.contextFile.reviewRequired
                          ? t("inspector.reviewRequired")
                          : t("inspector.reviewNotRequired")
                      }
                    />
                  </div>
                </InspectorSection>

                <InspectorSection
                  title={t("inspector.proofSummary")}
                  icon={<ShieldCheck size={13} />}
                >
                  <div className="grid grid-cols-2 gap-2">
                    <InspectorMetric
                      label={t("inspector.findings")}
                      value={target.contextFile.findingIds.length}
                    />
                    <InspectorMetric
                      label={t("inspector.evidenceCount")}
                      value={target.contextFile.evidenceIds.length}
                    />
                  </div>

                  {target.contextFile.reasonCodes.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {target.contextFile.reasonCodes.map((reasonCode) => (
                        <span
                          key={reasonCode}
                          className="rounded-full border border-neutral-800 bg-neutral-950 px-2 py-1 font-mono text-[9px] text-neutral-500"
                        >
                          {reasonCode}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </InspectorSection>
              </>
            ) : (
              <InspectorSection
                title={t("inspector.contextMetadata")}
                icon={<FileQuestion size={13} />}
              >
                <p className="text-xs leading-5 text-neutral-600">
                  {t("inspector.noContextMetadata")}
                </p>
              </InspectorSection>
            )}
          </>
        ) : null}

        {target.kind === "task-pack" ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <InspectorMetric
                label={t("inspector.project")}
                value={
                  target.taskPack.projectName ??
                  t("inspector.projectNumber", {
                    number: target.taskPack.projectId,
                  })
                }
              />
              <InspectorMetric
                label={t("inspector.targetTool")}
                value={target.taskPack.targetTool}
              />
              <InspectorMetric
                label={t("inspector.taskType")}
                value={target.taskPack.taskType}
              />
              <InspectorMetric
                label={t("inspector.generation")}
                value={
                  target.taskPack.generationMode === "ollama"
                    ? target.taskPack.generationModel ?? "Ollama"
                    : t("inspector.templateGeneration")
                }
              />
            </div>

            <InspectorSection
              title={t("inspector.task")}
              icon={<Archive size={13} />}
            >
              <p className="whitespace-pre-wrap text-xs leading-5 text-neutral-300">
                {target.taskPack.rawTask}
              </p>
            </InspectorSection>

            <div className="grid grid-cols-2 gap-2">
              <InspectorMetric
                label={t("inspector.created")}
                value={formatDate(target.taskPack.createdAt, i18n.language)}
              />
              <InspectorMetric
                label={t("inspector.updated")}
                value={formatDate(target.taskPack.updatedAt, i18n.language)}
              />
            </div>
          </>
        ) : null}

        {target.kind === "context" ? (
          <>
            <InspectorSection
              title={t("inspector.contextState")}
              icon={<Gauge size={13} />}
            >
              <div className="grid grid-cols-2 gap-2">
                <InspectorMetric
                  label={t("inspector.project")}
                  value={target.preview.project.name}
                />
                <InspectorMetric
                  label={t("inspector.taskArea")}
                  value={target.preview.task.effectiveTaskArea}
                />
                <InspectorMetric
                  label={t("inspector.targetTool")}
                  value={target.preview.task.targetTool}
                />
                <InspectorMetric
                  label={t("inspector.selectionStatus")}
                  value={t(
                    target.preview.selectionQuality.status === "ready"
                      ? "contextComposerPage.selectionStatus.ready"
                      : target.preview.selectionQuality.status === "warning"
                        ? "contextComposerPage.selectionStatus.reviewSuggested"
                        : "contextComposerPage.selectionStatus.manualReview",
                  )}
                />
              </div>
            </InspectorSection>

            <InspectorSection
              title={t("inspector.inventory")}
              icon={<ListTree size={13} />}
            >
              <div className="grid grid-cols-3 gap-2">
                <InspectorMetric
                  label={t("inspector.selected")}
                  value={target.preview.selectedFiles.length}
                />
                <InspectorMetric
                  label={t("inspector.scanned")}
                  value={target.preview.inventorySummary.scannedFiles}
                />
                <InspectorMetric
                  label={t("inspector.total")}
                  value={target.preview.inventorySummary.totalFiles}
                />
              </div>
            </InspectorSection>

            {target.preview.contextEngine ? (
              <InspectorSection
                title={t("inspector.engine")}
                icon={<ShieldCheck size={13} />}
              >
                <div className="grid grid-cols-2 gap-2">
                  <InspectorMetric
                    label={t("inspector.source")}
                    value={t(`settings.composerEngineSource_${target.preview.contextEngine.effectiveSource}`, {
                      defaultValue: target.preview.contextEngine.effectiveSource,
                    })}
                  />
                  <InspectorMetric
                    label={t("inspector.status")}
                    value={t(`settings.composerEngineStatus_${target.preview.contextEngine.status}`, {
                      defaultValue: target.preview.contextEngine.status,
                    })}
                  />
                </div>

                {target.preview.contextEngine.limitations.length > 0 ? (
                  <div className="mt-3 space-y-1.5">
                    {target.preview.contextEngine.limitations.map((item) => (
                      <p
                        key={item}
                        className="text-[11px] leading-4 text-neutral-600"
                      >
                        • {item}
                      </p>
                    ))}
                  </div>
                ) : null}
              </InspectorSection>
            ) : null}
          </>
        ) : null}

        {target.kind === "evidence" ? (
          <>
            <InspectorSection
              title={t("inspector.evidenceState")}
              icon={
                target.evidence.role === "contradicts" ? (
                  <TriangleAlert size={13} />
                ) : (
                  <CheckCircle2 size={13} />
                )
              }
            >
              <div className="grid grid-cols-2 gap-2">
                <InspectorMetric
                  label={t("inspector.evidenceId")}
                  value={target.evidence.evidenceId}
                />
                <InspectorMetric
                  label={t("inspector.role")}
                  value={formatEvidenceRole(target.evidence.role, t)}
                />
                <InspectorMetric
                  label={t("inspector.strength")}
                  value={formatEvidenceStrength(target.evidence.strength, t)}
                />
                <InspectorMetric
                  label={t("inspector.relationKind")}
                  value={target.evidence.relationKind ?? "—"}
                />
                <InspectorMetric
                  label={t("inspector.predicate")}
                  value={target.evidence.predicate ?? "—"}
                />
              </div>
            </InspectorSection>

            <InspectorSection
              title={t("inspector.provenance")}
              icon={<Route size={13} />}
            >
              <p className="break-all font-mono text-[11px] leading-5 text-neutral-300">
                {target.evidence.path ?? t("inspector.noPath")}
              </p>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <InspectorMetric
                  label={t("inspector.lines")}
                  value={
                    target.evidence.startLine
                      ? target.evidence.endLine &&
                        target.evidence.endLine !== target.evidence.startLine
                        ? `${target.evidence.startLine}-${target.evidence.endLine}`
                        : target.evidence.startLine
                      : "—"
                  }
                />
                <InspectorMetric
                  label={t("inspector.reason")}
                  value={target.evidence.reasonCode}
                />
              </div>
            </InspectorSection>

            {target.contextFile ? (
              <InspectorSection
                title={t("inspector.parentContext")}
                icon={<ShieldCheck size={13} />}
              >
                <p className="break-all font-mono text-[11px] leading-5 text-neutral-300">
                  {target.contextFile.path}
                </p>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <InspectorMetric
                    label={t("inspector.role")}
                    value={formatContextFileRole(target.contextFile.role, t)}
                  />
                  <InspectorMetric
                    label={t("inspector.usage")}
                    value={formatContextFileUsage(target.contextFile.usage, t)}
                  />
                  <InspectorMetric
                    label={t("inspector.source")}
                    value={formatContextFileSource(target.contextFile.source, t)}
                  />
                  <InspectorMetric
                    label={t("inspector.findings")}
                    value={target.contextFile.findingIds.length}
                  />
                </div>
              </InspectorSection>
            ) : null}
          </>
        ) : null}
      </div>

      <footer className="shrink-0 border-t border-neutral-900 bg-black/96 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-[180px] text-[10px] leading-4 text-neutral-700">
            {t("inspector.historyHint")}
          </p>

          <div className="flex flex-wrap justify-end gap-2">
          {target.kind === "file" ? (
            <>
              <Button
                variant="secondary"
                onClick={() => onOpenInSplitView(target.file)}
              >
                <PanelRightOpen size={14} />
                {t("inspector.openInSplitView")}
              </Button>

              {target.file.projectId ? (
                <Button
                  variant="primary"
                  onClick={() => onOpenProject(target.file.projectId!)}
                >
                  <ExternalLink size={14} />
                  {t("inspector.openProject")}
                </Button>
              ) : null}
            </>
          ) : null}

          {target.kind === "context" ? (
            <Button
              variant="primary"
              onClick={() => onOpenProject(target.preview.project.id)}
            >
              <ExternalLink size={14} />
              {t("inspector.openProject")}
            </Button>
          ) : null}

          {target.kind === "task-pack" ? (
            <>
              <Button
                variant="secondary"
                onClick={() =>
                  onOpenInSplitView({
                    kind: "task-pack",
                    taskPack: target.taskPack,
                  })
                }
              >
                <PanelRightOpen size={14} />
                {t("inspector.openInSplitView")}
              </Button>

              <Button
                variant="primary"
                onClick={() => onOpenTaskPack(target.taskPack)}
              >
                <Archive size={14} />
                {t("inspector.openTaskPack")}
              </Button>
            </>
          ) : null}

          {target.kind === "evidence" && evidenceFileTarget ? (
            <Button
              variant="secondary"
              onClick={() => onOpenInSplitView(evidenceFileTarget)}
            >
              <PanelRightOpen size={14} />
              {t("inspector.openSource")}
            </Button>
          ) : null}

          {target.kind === "evidence" && parentContextFileTarget ? (
            <Button
              variant={evidenceFileTarget ? "secondary" : "primary"}
              onClick={() => onOpenInSplitView(parentContextFileTarget)}
            >
              <FileCode2 size={14} />
              {t("inspector.openParentContext")}
            </Button>
          ) : null}
          </div>
        </div>
      </footer>
    </motion.aside>
  );
}
