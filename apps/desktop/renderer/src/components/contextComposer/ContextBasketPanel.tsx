import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  FileText,
  Layers3,
  ScanSearch,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import type {
  ContextComposerFileReference,
  ContextComposerSnippet,
} from "../../types";
import {
  formatContextFileKind,
  formatContextFileRole,
  formatContextFileUsage,
} from "../../utils/contextFileLabels";
import { WorkspaceDisclosure } from "../workspace/WorkspaceDisclosure";

export interface ContextBasketFileItem {
  file: ContextComposerFileReference;
  manual: boolean;
  reviewed: boolean;
  explicitTarget: boolean;
}

interface ContextBasketPanelProps {
  open: boolean;
  files: ContextBasketFileItem[];
  snippets: ContextComposerSnippet[];
  blocked: boolean;
  selectionStatus: "ready" | "warning" | "blocked";
  onClose: () => void;
  onRemoveFile: (path: string) => void;
  onQuickPeekFile: (path: string) => void;
  onInspectFile: (path: string) => void;
  onOpenSnippet: (path: string) => void;
  onClearFiles: () => void;
}

function structuralPath(path: string) {
  return path.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

export function ContextBasketPanel({
  open,
  files,
  snippets,
  blocked,
  selectionStatus,
  onClose,
  onRemoveFile,
  onQuickPeekFile,
  onInspectFile,
  onOpenSnippet,
  onClearFiles,
}: ContextBasketPanelProps) {
  const { t } = useTranslation();

  const isEmpty = files.length === 0;
  const statusKey =
    selectionStatus === "blocked"
      ? "contextComposerPage.selectionStatus.manualReview"
      : selectionStatus === "warning"
        ? "contextComposerPage.selectionStatus.reviewSuggested"
        : "contextComposerPage.selectionStatus.ready";

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose, open]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[140] flex items-end justify-center p-3 sm:items-center sm:p-6"
          initial="closed"
          animate="open"
          exit="closed"
        >
          <motion.button
            type="button"
            aria-label={t("contextComposerPage.basket.close")}
            className="absolute inset-0 z-0 cursor-default bg-black/70 backdrop-blur-sm"
            onClick={onClose}
            variants={{
              closed: { opacity: 0 },
              open: { opacity: 1 },
            }}
            transition={{ duration: 0.16 }}
            tabIndex={-1}
          />

          <motion.section
            role="dialog"
            aria-modal="true"
            aria-label={t("contextComposerPage.basket.title")}
            initial={{ opacity: 0, y: 18, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.99 }}
            transition={{ type: "spring", stiffness: 430, damping: 38, mass: 0.62 }}
            className="relative z-10 flex max-h-[78vh] w-full max-w-4xl flex-col overflow-hidden rounded-[1.65rem] border border-white/10 bg-neutral-950 shadow-[0_28px_120px_rgba(0,0,0,0.72),inset_0_1px_0_rgba(255,255,255,0.05)]"
          >
            <header className="flex items-start justify-between gap-4 border-b border-neutral-900 px-5 py-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="grid size-9 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-neutral-300">
                    <Layers3 size={16} />
                  </span>
                  <div>
                    <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                      {t("contextComposerPage.basket.kicker")}
                    </p>
                    <h2 className="mt-0.5 text-lg font-semibold text-white">
                      {t("contextComposerPage.basket.title")}
                    </h2>
                  </div>
                </div>

                <p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-500">
                  {t("contextComposerPage.basket.description")}
                </p>
              </div>

              <button
                type="button"
                onClick={onClose}
                aria-label={t("contextComposerPage.basket.close")}
                className="grid size-9 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-black/35 text-neutral-500 transition hover:border-white/20 hover:text-white"
              >
                <X size={15} />
              </button>
            </header>

            <div className="flex flex-wrap items-center gap-2 border-b border-neutral-900 bg-black/30 px-5 py-3">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-800 bg-neutral-950 px-2.5 py-1 text-[11px] text-neutral-300">
                <FileText size={12} />
                {t("contextComposerPage.workspace.fileCount", { count: files.length })}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-800 bg-neutral-950 px-2.5 py-1 text-[11px] text-neutral-400">
                <Sparkles size={12} />
                {t("contextComposerPage.workspace.snippetCount", { count: snippets.length })}
              </span>
              <span
                className={[
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]",
                  blocked
                    ? "border-amber-300/20 bg-amber-300/10 text-amber-200"
                    : selectionStatus === "ready"
                      ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
                      : "border-white/15 bg-white/[0.05] text-neutral-300",
                ].join(" ")}
              >
                {blocked ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />}
                {t(statusKey)}
              </span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {isEmpty ? (
                <div className="grid min-h-[220px] place-items-center rounded-2xl border border-dashed border-neutral-800 bg-black/20 px-6 text-center">
                  <div>
                    <Layers3 size={22} className="mx-auto text-neutral-700" />
                    <p className="mt-3 text-sm font-semibold text-white">
                      {t("contextComposerPage.basket.emptyTitle")}
                    </p>
                    <p className="mx-auto mt-1 max-w-lg text-sm leading-6 text-neutral-500">
                      {t("contextComposerPage.basket.emptyDescription")}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-5">
                  <section>
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white">
                          {t("contextComposerPage.basket.filesTitle")}
                        </p>
                        <p className="mt-0.5 text-xs text-neutral-600">
                          {t("contextComposerPage.basket.filesDescription")}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={onClearFiles}
                        className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-neutral-800 bg-black/35 px-3 text-[11px] text-neutral-500 transition hover:border-red-400/25 hover:text-red-200"
                      >
                        <Trash2 size={12} />
                        {t("contextComposerPage.basket.clear")}
                      </button>
                    </div>

                    <div className="space-y-2">
                      {files.map((item) => (
                        <motion.article
                          layout
                          key={item.file.path}
                          className="rounded-2xl border border-neutral-900 bg-black/30 px-4 py-3"
                        >
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="break-all text-sm font-semibold text-white">
                                  {structuralPath(item.file.path)}
                                </p>

                                {item.explicitTarget && (
                                  <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-2 py-0.5 text-[10px] text-amber-200">
                                    {t("contextComposerPage.contextFiles.explicitTarget")}
                                  </span>
                                )}

                                {item.manual && (
                                  <span className="rounded-full border border-white/15 bg-white/[0.05] px-2 py-0.5 text-[10px] text-neutral-300">
                                    {t("contextComposerPage.contextFiles.manual")}
                                  </span>
                                )}

                                {item.reviewed && !item.manual && (
                                  <span className="rounded-full border border-emerald-400/15 bg-emerald-400/[0.06] px-2 py-0.5 text-[10px] text-emerald-200/80">
                                    {t("contextComposerPage.fileCard.reviewed")}
                                  </span>
                                )}
                              </div>

                              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-neutral-500">
                                <span>
                                  {item.file.contextRole
                                    ? formatContextFileRole(item.file.contextRole, t)
                                    : formatContextFileKind(item.file.kind, t)}
                                </span>
                                <span className="text-neutral-800">·</span>
                                <span>{formatContextFileUsage(item.file.usage, t)}</span>
                                {item.file.source && (
                                  <>
                                    <span className="text-neutral-800">·</span>
                                    <span>{t(`settings.composerEngineSource_${item.file.source}`)}</span>
                                  </>
                                )}
                                {item.file.reviewRequired && (
                                  <>
                                    <span className="text-neutral-800">·</span>
                                    <span className="text-amber-200/75">
                                      {t("contextComposerPage.basket.reviewRequired")}
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>

                            <div className="flex shrink-0 flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => onQuickPeekFile(item.file.path)}
                                className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-[11px] text-neutral-500 transition hover:border-white hover:bg-white hover:text-black"
                              >
                                <Eye size={12} />
                                {t("quickPeek.title")}
                              </button>
                              <button
                                type="button"
                                onClick={() => onInspectFile(item.file.path)}
                                className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-neutral-800 bg-neutral-950 px-3 text-[11px] text-neutral-500 transition hover:border-white hover:bg-white hover:text-black"
                              >
                                <ScanSearch size={12} />
                                {t("inspector.inspect")}
                              </button>
                              <button
                                type="button"
                                onClick={() => onRemoveFile(item.file.path)}
                                className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-red-400/15 bg-red-400/[0.04] px-3 text-[11px] text-red-200/75 transition hover:border-red-300/30 hover:text-red-100"
                              >
                                <Trash2 size={12} />
                                {t("contextComposerPage.basket.remove")}
                              </button>
                            </div>
                          </div>
                        </motion.article>
                      ))}
                    </div>
                  </section>

                  <WorkspaceDisclosure
                    title={t("contextComposerPage.basket.snippetsTitle")}
                    summary={t("contextComposerPage.basket.snippetsDescription")}
                    badge={(
                      <span className="cf-badge">
                        {t("contextComposerPage.workspace.snippetCount", { count: snippets.length })}
                      </span>
                    )}
                    className="border-neutral-900"
                  >
                    {snippets.length > 0 ? (
                      <div className="grid gap-2 md:grid-cols-2">
                        {snippets.map((snippet) => (
                          <button
                            key={snippet.relativePath}
                            type="button"
                            onClick={() => onOpenSnippet(snippet.relativePath)}
                            className="group rounded-2xl border border-neutral-900 bg-black/30 px-4 py-3 text-left transition hover:border-white/15 hover:bg-white/[0.025]"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="break-all text-xs font-semibold text-white">
                                  {structuralPath(snippet.relativePath)}
                                </p>
                                <p className="mt-1 text-[11px] text-neutral-600">
                                  {snippet.language}
                                  {snippet.truncated
                                    ? ` · ${t("contextComposerPage.basket.truncated")}`
                                    : ""}
                                </p>
                              </div>
                              <Sparkles
                                size={13}
                                className="mt-0.5 shrink-0 text-neutral-700 transition group-hover:text-neutral-400"
                              />
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-neutral-900 bg-black/20 px-4 py-4 text-sm text-neutral-600">
                        {t("contextComposerPage.basket.noSnippets")}
                      </div>
                    )}
                  </WorkspaceDisclosure>
                </div>
              )}
            </div>

            <footer className="border-t border-neutral-900 bg-black/35 px-5 py-3">
              <p className="text-[11px] leading-5 text-neutral-600">
                {t("contextComposerPage.basket.footer")}
              </p>
            </footer>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
