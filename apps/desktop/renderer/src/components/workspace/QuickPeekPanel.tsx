import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";
import {
  Archive,
  Check,
  Clipboard,
  Code2,
  ExternalLink,
  FileText,
  FolderKanban,
  Gauge,
  Loader2,
  Package,
  PanelRightOpen,
  ScanSearch,
  X,
} from "lucide-react";

import { readContextComposerFileSnippet } from "../../api/client";
import type { ContextComposerSnippet, TaskPack } from "../../types";
import type { QuickPeekTarget } from "../../types/quickPeek";
import type { TaskPackFreshness } from "../../utils/taskPackFreshness";
import { ProjectAwarenessSummary } from "../projects/ProjectAwarenessPanel";
import { TaskPackFreshnessNotice } from "../taskPacks/TaskPackFreshness";
import { Button } from "../ui/Button";
import { ProjectFileDragHandle } from "./ProjectFileDragHandle";

interface QuickPeekPanelProps {
  target: QuickPeekTarget;
  mode?: "quick-peek" | "split-view";
  onClose: () => void;
  onInspect?: (target: QuickPeekTarget) => void;
  onOpenInSplitView?: (target: QuickPeekTarget) => void;
  onOpenProject: (projectId: number) => void;
  onOpenTaskPack: (taskPack: TaskPack) => void;
  taskPackFreshness?: TaskPackFreshness;
}

function formatDate(value: string | null | undefined, locale: string) {
  if (!value) return "—";

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";

  return new Intl.DateTimeFormat(
    locale.startsWith("ru") ? "ru-RU" : "en-US",
    {
      dateStyle: "medium",
      timeStyle: "short",
    },
  ).format(date);
}

export function QuickPeekPanel({
  target,
  mode = "quick-peek",
  onClose,
  onInspect,
  onOpenInSplitView,
  onOpenProject,
  onOpenTaskPack,
  taskPackFreshness,
}: QuickPeekPanelProps) {
  const { t, i18n } = useTranslation();
  const prefersReducedMotion = useReducedMotion();
  const copyResetTimerRef = useRef<number | null>(null);
  const [fileSnippet, setFileSnippet] =
    useState<ContextComposerSnippet | null>(null);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [fileError, setFileError] = useState("");
  const [isCopied, setIsCopied] = useState(false);
  const isSplitView = mode === "split-view";

  useEffect(
    () => () => {
      if (copyResetTimerRef.current !== null) {
        window.clearTimeout(copyResetTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (isSplitView) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;

      event.preventDefault();
      event.stopPropagation();
      onClose();
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isSplitView, onClose]);

  useEffect(() => {
    setFileSnippet(null);
    setFileError("");
    setIsCopied(false);

    if (
      target.kind !== "file" ||
      !target.projectId ||
      !target.filePath
    ) {
      setIsLoadingFile(false);
      return;
    }

    let cancelled = false;
    setIsLoadingFile(true);

    void readContextComposerFileSnippet({
      projectId: target.projectId,
      filePath: target.filePath,
    })
      .then((response) => {
        if (cancelled) return;
        setFileSnippet(response.snippet);
      })
      .catch(() => {
        if (cancelled) return;
        setFileError(t("quickPeek.fileError"));
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingFile(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [t, target]);

  const fileContent = useMemo(() => {
    if (target.kind !== "file") return "";
    return fileSnippet?.content ?? target.snippet ?? "";
  }, [fileSnippet, target]);

  async function handleCopyPath() {
    if (target.kind !== "file") return;

    const value =
      target.absolutePath ??
      target.displayPath ??
      target.filePath ??
      target.title;

    try {
      await navigator.clipboard.writeText(value);
      setIsCopied(true);
      if (copyResetTimerRef.current !== null) {
        window.clearTimeout(copyResetTimerRef.current);
      }
      copyResetTimerRef.current = window.setTimeout(() => {
        setIsCopied(false);
        copyResetTimerRef.current = null;
      }, 1400);
    } catch {
      setIsCopied(false);
    }
  }

  const targetTitle =
    target.kind === "file"
      ? target.title
      : target.kind === "project"
        ? target.project.name
        : target.taskPack.title;
  const targetKindLabel =
    target.kind === "file"
      ? t("quickPeek.file")
      : target.kind === "project"
        ? t("quickPeek.project")
        : t("quickPeek.taskPack");

  return (
    <motion.aside
      aria-label={t(isSplitView ? "quickPeek.splitViewTitle" : "quickPeek.title")}
      initial={prefersReducedMotion ? false : { opacity: 0, x: isSplitView ? 24 : 48 }}
      animate={{ opacity: 1, x: 0 }}
      exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: isSplitView ? 18 : 42 }}
      transition={
        prefersReducedMotion
          ? { duration: 0 }
          : { type: "spring", stiffness: 430, damping: 40, mass: 0.72 }
      }
      className={[
        "flex min-h-0 flex-col overflow-hidden border-l border-white/[0.10] bg-black/98 backdrop-blur-2xl",
        isSplitView
          ? "fixed bottom-[27px] right-0 top-[48px] z-[82] w-[min(540px,calc(100vw-18px))] shadow-[-24px_0_80px_rgba(0,0,0,0.58)] xl:relative xl:bottom-auto xl:right-auto xl:top-auto xl:z-10 xl:w-[clamp(320px,38vw,540px)] xl:shrink-0 xl:shadow-none"
          : "fixed bottom-[27px] right-0 top-[42px] z-[82] w-[min(540px,calc(100vw-18px))] shadow-[-24px_0_80px_rgba(0,0,0,0.58)]",
      ].join(" ")}
    >
      <header className="shrink-0 border-b border-neutral-900 bg-black/96 px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="cf-tech-label text-[9px] uppercase text-neutral-600">
                {t(
                  isSplitView
                    ? "quickPeek.splitViewEyebrow"
                    : "quickPeek.eyebrow",
                )}
              </span>
              <span className="size-1 rounded-full bg-neutral-800" />
              <span className="text-[10px] uppercase tracking-[0.12em] text-neutral-700">
                {targetKindLabel}
              </span>
            </div>

            <h2 className="mt-2 truncate text-lg font-semibold text-white">
              {targetTitle}
            </h2>

            {target.kind === "file" ? (
              <p className="mt-1 truncate font-mono text-[11px] text-neutral-600">
                {target.displayPath}
              </p>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {target.kind === "file" &&
            target.projectId &&
            (target.filePath || target.displayPath) ? (
              <ProjectFileDragHandle
                projectId={target.projectId}
                path={target.filePath ?? target.displayPath}
                label={t("dragAndDrop.dragFileToBasket", {
                  path: target.displayPath,
                })}
                className="size-9 rounded-xl border border-neutral-900 bg-black"
              />
            ) : null}

            <button
              type="button"
              onClick={onClose}
              aria-label={t(
                isSplitView ? "quickPeek.closeSplitView" : "quickPeek.close",
              )}
              title={t(
                isSplitView ? "quickPeek.closeSplitView" : "quickPeek.close",
              )}
              className="grid size-9 shrink-0 place-items-center rounded-xl border border-neutral-900 bg-black text-neutral-600 transition hover:border-neutral-700 hover:bg-neutral-950 hover:text-white"
            >
              <X size={15} />
            </button>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {target.kind === "file" ? (
          <div className="space-y-4">
            <section className="rounded-2xl border border-neutral-900 bg-white/[0.018] p-4">
              <div className="flex flex-wrap items-center gap-2 text-[10px] text-neutral-600">
                <span className="inline-flex items-center gap-1.5">
                  <Code2 size={12} />
                  {target.projectName ?? t("quickPeek.file")}
                </span>
                {target.line ? (
                  <>
                    <span className="size-1 rounded-full bg-neutral-800" />
                    <span>{t("quickPeek.line", { line: target.line })}</span>
                  </>
                ) : null}
                {fileSnippet?.language ? (
                  <>
                    <span className="size-1 rounded-full bg-neutral-800" />
                    <span>{fileSnippet.language}</span>
                  </>
                ) : null}
              </div>
            </section>

            <section className="overflow-hidden rounded-2xl border border-neutral-900 bg-black/55">
              <div className="flex items-center justify-between gap-3 border-b border-neutral-900 px-4 py-3">
                <div className="flex items-center gap-2">
                  <FileText size={14} className="text-neutral-600" />
                  <p className="text-xs font-semibold text-neutral-300">
                    {t("quickPeek.filePreview")}
                  </p>
                </div>

                {fileSnippet?.truncated ? (
                  <span className="rounded-full border border-amber-400/15 bg-amber-400/[0.06] px-2 py-1 text-[9px] text-amber-200/70">
                    {t("quickPeek.truncated")}
                  </span>
                ) : null}
              </div>

              {isLoadingFile ? (
                <div className="flex min-h-[220px] items-center justify-center gap-2 px-5 py-8 text-xs text-neutral-600">
                  <Loader2 size={14} className="animate-spin" />
                  {t("quickPeek.loadingFile")}
                </div>
              ) : fileContent ? (
                <pre className="max-h-[54vh] overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-[11px] leading-5 text-neutral-400">
                  {fileContent}
                </pre>
              ) : (
                <div className="px-5 py-8 text-center">
                  <p className="text-sm font-medium text-neutral-300">
                    {t("quickPeek.fileUnavailable")}
                  </p>
                  <p className="mt-2 text-xs leading-5 text-neutral-600">
                    {fileError || t("quickPeek.fileUnavailableDescription")}
                  </p>
                </div>
              )}
            </section>
          </div>
        ) : null}

        {target.kind === "project" ? (
          <div className="space-y-4">
            <section className="rounded-2xl border border-neutral-900 bg-white/[0.018] p-4">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-400">
                  <FolderKanban size={17} />
                </span>
                <div className="min-w-0">
                  <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
                    {t("quickPeek.localRepository")}
                  </p>
                  <p className="mt-1 truncate font-mono text-[11px] text-neutral-400">
                    {target.project.localPath}
                  </p>
                </div>
              </div>
            </section>

            <div className="grid gap-3 sm:grid-cols-2">
              <section className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
                <div className="flex items-center gap-2 text-neutral-600">
                  <Gauge size={14} />
                  <span className="cf-tech-label text-[9px] uppercase">
                    {t("quickPeek.readiness")}
                  </span>
                </div>
                <p className="mt-3 text-2xl font-semibold text-white">
                  {target.project.readinessScore}/100
                </p>
              </section>

              <section className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
                <div className="flex items-center gap-2 text-neutral-600">
                  <Package size={14} />
                  <span className="cf-tech-label text-[9px] uppercase">
                    {t("quickPeek.packageManager")}
                  </span>
                </div>
                <p className="mt-3 truncate text-sm font-semibold text-neutral-200">
                  {target.project.packageManager ?? t("quickPeek.notAvailable")}
                </p>
              </section>
            </div>

            <section className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
              <div className="flex items-center gap-2 text-neutral-600">
                <Code2 size={14} />
                <span className="cf-tech-label text-[9px] uppercase">
                  {t("quickPeek.stack")}
                </span>
              </div>
              <p className="mt-3 text-sm leading-6 text-neutral-300">
                {target.project.detectedStack.length > 0
                  ? target.project.detectedStack.join(" · ")
                  : t("quickPeek.noStack")}
              </p>
            </section>

            <section className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
              <div className="flex items-center gap-2 text-neutral-600">
                <ScanSearch size={14} />
                <span className="cf-tech-label text-[9px] uppercase">
                  {t("quickPeek.lastScan")}
                </span>
              </div>
              <p className="mt-3 text-sm text-neutral-300">
                {formatDate(target.project.lastScanAt, i18n.language)}
              </p>
            </section>

            <section className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
              <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
                {t("projectAwareness.title")}
              </p>
              <ProjectAwarenessSummary project={target.project} className="mt-2" />
            </section>
          </div>
        ) : null}

        {target.kind === "task-pack" ? (
          <div className="space-y-4">
            {taskPackFreshness ? (
              <TaskPackFreshnessNotice
                freshness={taskPackFreshness}
                onReviewProject={() => onOpenProject(target.taskPack.projectId)}
                compact
              />
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <section className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
                <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
                  {t("quickPeek.project")}
                </p>
                <p className="mt-2 truncate text-sm font-semibold text-neutral-200">
                  {target.taskPack.projectName ??
                    t("globalSearch.projectNumber", {
                      number: target.taskPack.projectId,
                    })}
                </p>
              </section>

              <section className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
                <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
                  {t("quickPeek.generation")}
                </p>
                <p className="mt-2 truncate text-sm font-semibold text-neutral-200">
                  {target.taskPack.generationMode === "ollama"
                    ? target.taskPack.generationModel ?? "Ollama"
                    : t("globalSearch.templateMode")}
                </p>
              </section>
            </div>

            <section className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
                    {t("quickPeek.taskType")}
                  </p>
                  <p className="mt-2 text-sm font-semibold text-neutral-200">
                    {target.taskPack.taskType}
                  </p>
                </div>
                <div>
                  <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
                    {t("quickPeek.targetTool")}
                  </p>
                  <p className="mt-2 text-sm font-semibold text-neutral-200">
                    {target.taskPack.targetTool}
                  </p>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
              <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
                {t("quickPeek.task")}
              </p>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-neutral-300">
                {target.taskPack.rawTask}
              </p>
            </section>

            <section className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
              <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
                {t("quickPeek.prompt")}
              </p>
              <pre className="mt-3 max-h-[34vh] overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-neutral-500">
                {target.taskPack.generatedPrompt}
              </pre>
            </section>

            <div className="grid gap-3 sm:grid-cols-2">
              <section className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
                <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
                  {t("quickPeek.created")}
                </p>
                <p className="mt-2 text-xs text-neutral-400">
                  {formatDate(target.taskPack.createdAt, i18n.language)}
                </p>
              </section>
              <section className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
                <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
                  {t("quickPeek.updated")}
                </p>
                <p className="mt-2 text-xs text-neutral-400">
                  {formatDate(target.taskPack.updatedAt, i18n.language)}
                </p>
              </section>
            </div>
          </div>
        ) : null}
      </div>

      <footer className="shrink-0 border-t border-neutral-900 bg-black/96 px-5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[10px] text-neutral-700">
            {t(
              isSplitView
                ? "quickPeek.splitHistoryHint"
                : "quickPeek.historyHint",
            )}
          </p>

          <div className="flex flex-wrap gap-2">
            {!isSplitView &&
            onInspect &&
            (target.kind === "file" || target.kind === "task-pack") ? (
              <Button
                variant="secondary"
                onClick={() => onInspect(target)}
              >
                <ScanSearch size={14} />
                {t("inspector.inspect")}
              </Button>
            ) : null}

            {!isSplitView && onOpenInSplitView ? (
              <Button
                variant="secondary"
                onClick={() => onOpenInSplitView(target)}
              >
                <PanelRightOpen size={14} />
                {t("quickPeek.openInSplitView")}
              </Button>
            ) : null}

            {target.kind === "file" ? (
              <>
                <Button variant="secondary" onClick={handleCopyPath}>
                  {isCopied ? <Check size={14} /> : <Clipboard size={14} />}
                  {isCopied ? t("quickPeek.copied") : t("quickPeek.copyPath")}
                </Button>

                {target.projectId ? (
                  <Button
                    variant="primary"
                    onClick={() => onOpenProject(target.projectId)}
                  >
                    <ExternalLink size={14} />
                    {t("quickPeek.openProject")}
                  </Button>
                ) : null}
              </>
            ) : null}

            {target.kind === "project" ? (
              <Button
                variant="primary"
                onClick={() => onOpenProject(target.project.id)}
              >
                <ExternalLink size={14} />
                {t("quickPeek.openProject")}
              </Button>
            ) : null}

            {target.kind === "task-pack" ? (
              <Button
                variant="primary"
                onClick={() => onOpenTaskPack(target.taskPack)}
              >
                <Archive size={14} />
                {t("quickPeek.openTaskPack")}
              </Button>
            ) : null}
          </div>
        </div>
      </footer>
    </motion.aside>
  );
}
