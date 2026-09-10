import { motion } from "framer-motion";
import {
  ArrowDown,
  ArrowUp,
  Check,
  FileText,
  Loader2,
  Plus,
  Search,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import type { ContextComposerFileSearchResult } from "../../../types";
import {
  formatContextFileKind,
  formatContextFileUsage,
} from "../../../utils/contextFileLabels";

interface ContextFileSearchPaletteProps {
  open: boolean;
  query: string;
  results: ContextComposerFileSearchResult[];
  isSearching: boolean;
  message: string;
  explicitTargetPaths: string[];
  onQueryChange: (query: string) => void;
  onAdd: (result: ContextComposerFileSearchResult) => void;
  onClose: () => void;
}

function structuralPath(path: string) {
  return path.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function formatFileSize(sizeBytes: number) {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${Math.round(sizeBytes / 1024)} KB`;
  return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
}

export function ContextFileSearchPalette({
  open,
  query,
  results,
  isSearching,
  message,
  explicitTargetPaths,
  onQueryChange,
  onAdd,
  onClose,
}: ContextFileSearchPaletteProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [addedPath, setAddedPath] = useState<string | null>(null);
  const [isClosing, setIsClosing] = useState(false);

  const explicitTargets = useMemo(
    () => new Set(explicitTargetPaths.map(structuralPath)),
    [explicitTargetPaths],
  );

  const orderedResults = useMemo(() => {
    const exact: ContextComposerFileSearchResult[] = [];
    const other: ContextComposerFileSearchResult[] = [];

    for (const result of results) {
      if (explicitTargets.has(structuralPath(result.path))) {
        exact.push(result);
      } else {
        other.push(result);
      }
    }

    return [...exact, ...other];
  }, [explicitTargets, results]);

  const exactResultCount = useMemo(
    () =>
      orderedResults.filter((result) =>
        explicitTargets.has(structuralPath(result.path)),
      ).length,
    [explicitTargets, orderedResults],
  );

  const requestClose = useCallback((delayMs = 0) => {
    if (isClosing) return;

    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }

    const beginExit = () => {
      setIsClosing(true);

      closeTimerRef.current = window.setTimeout(() => {
        closeTimerRef.current = null;
        onClose();
      }, 180);
    };

    if (delayMs > 0) {
      closeTimerRef.current = window.setTimeout(() => {
        closeTimerRef.current = null;
        beginExit();
      }, delayMs);
      return;
    }

    beginExit();
  }, [isClosing, onClose]);

  const handleAdd = useCallback((result: ContextComposerFileSearchResult) => {
    if (addedPath || isClosing) return;

    setAddedPath(result.path);
    onAdd(result);
    requestClose(160);
  }, [addedPath, isClosing, onAdd, requestClose]);

  useEffect(() => {
    if (!open) return;

    setActiveIndex(0);
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((current) =>
          orderedResults.length === 0 ? 0 : Math.min(orderedResults.length - 1, current + 1),
        );
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((current) => Math.max(0, current - 1));
        return;
      }

      if (event.key === "Enter" && orderedResults[activeIndex]) {
        event.preventDefault();
        handleAdd(orderedResults[activeIndex]);
      }
    }

    window.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [activeIndex, handleAdd, open, orderedResults, requestClose]);

  useEffect(() => {
    if (activeIndex >= orderedResults.length) {
      setActiveIndex(Math.max(0, orderedResults.length - 1));
    }
  }, [activeIndex, orderedResults.length]);

  useEffect(() => {
    if (open) {
      setIsClosing(false);
      return;
    }

    setAddedPath(null);
    setIsClosing(false);

    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  return createPortal(
    open ? (
      <motion.div
        className={[
          "fixed inset-0 z-[130] flex items-start justify-center p-6 pt-[9vh]",
          isClosing ? "pointer-events-none" : "pointer-events-auto",
        ].join(" ")}
      >
        <motion.button
          type="button"
          aria-label={t("contextComposerPage.fileSearchPalette.close")}
          className="absolute inset-0 cursor-default bg-black/75 backdrop-blur-sm"
          onClick={() => requestClose()}
          initial={{ opacity: 0 }}
          animate={{ opacity: isClosing ? 0 : 1 }}
          transition={{ duration: 0.18 }}
          tabIndex={-1}
          disabled={isClosing}
        />

        <motion.section
          className="relative z-10 flex max-h-[78vh] w-full max-w-3xl flex-col overflow-hidden rounded-[1.75rem] border border-white/10 bg-neutral-950 shadow-[0_30px_110px_rgba(0,0,0,0.75),inset_0_1px_0_rgba(255,255,255,0.05)]"
          initial={{ opacity: 0, y: 14, scale: 0.985 }}
          animate={
            isClosing
              ? { opacity: 0, y: 10, scale: 0.988 }
              : { opacity: 1, y: 0, scale: 1 }
          }
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
            <div className="border-b border-neutral-900 px-5 pb-4 pt-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                    {t("contextComposerPage.fileSearchPalette.kicker")}
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-white">
                    {t("contextComposerPage.fileSearchPalette.title")}
                  </h2>
                  <p className="mt-1 text-xs leading-5 text-neutral-500">
                    {t("contextComposerPage.fileSearchPalette.description")}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => requestClose()}
                  className="grid size-9 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-500 transition hover:border-white hover:bg-white hover:text-black"
                  aria-label={t("contextComposerPage.fileSearchPalette.close")}
                >
                  <X size={15} />
                </button>
              </div>

              <div className="mt-4 flex h-12 items-center gap-3 rounded-2xl border border-white/10 bg-black/50 px-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)] focus-within:border-white/25">
                <Search size={16} className="shrink-0 text-neutral-600" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(event) => onQueryChange(event.target.value)}
                  placeholder={t("contextComposerPage.search.placeholder")}
                  className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-neutral-700"
                />
                {isSearching && <Loader2 size={15} className="animate-spin text-neutral-500" />}
              </div>

              <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-neutral-600">
                <span className="truncate">{message}</span>
                <span className="hidden shrink-0 items-center gap-2 sm:flex">
                  <span className="inline-flex items-center gap-1"><ArrowUp size={11} /><ArrowDown size={11} /></span>
                  {t("contextComposerPage.fileSearchPalette.navigate")}
                  <span className="rounded border border-neutral-800 px-1.5 py-0.5 text-[10px]">Enter</span>
                  {t("contextComposerPage.fileSearchPalette.add")}
                </span>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {orderedResults.length > 0 ? (
                <div className="space-y-1.5">
                  {orderedResults.map((result, index) => {
                    const explicit = explicitTargets.has(structuralPath(result.path));
                    const active = index === activeIndex;
                    const added = addedPath === result.path;
                    const showExactLabel = exactResultCount > 0 && index === 0;
                    const showOtherLabel =
                      exactResultCount > 0 &&
                      exactResultCount < orderedResults.length &&
                      index === exactResultCount;

                    return (
                      <div key={result.path}>
                        {showExactLabel && (
                          <p className="px-2 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-200/70">
                            {t("contextComposerPage.fileSearchPalette.exactMatches")}
                          </p>
                        )}

                        {showOtherLabel && (
                          <p className="px-2 pb-2 pt-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-600">
                            {t("contextComposerPage.fileSearchPalette.otherFiles")}
                          </p>
                        )}

                        <motion.button
                          type="button"
                          onMouseEnter={() => setActiveIndex(index)}
                          onClick={() => handleAdd(result)}
                          layout
                          animate={added ? { scale: [1, 0.992, 1] } : { scale: 1 }}
                          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                          disabled={Boolean(addedPath)}
                          className={[
                            "group flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition",
                            added
                              ? "border-emerald-400/25 bg-emerald-400/[0.07]"
                              : active
                                ? "border-white/15 bg-white/[0.055]"
                                : "border-transparent bg-black/15 hover:border-neutral-800 hover:bg-white/[0.025]",
                          ].join(" ")}
                        >
                          <span className={[
                            "grid size-10 shrink-0 place-items-center rounded-xl border transition",
                            added
                              ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
                              : active
                                ? "border-white/15 bg-white/[0.06] text-white"
                                : "border-neutral-900 bg-neutral-950 text-neutral-600",
                          ].join(" ")}>
                            {added ? <Check size={15} /> : <FileText size={15} />}
                          </span>

                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="break-all text-sm font-semibold text-white">
                                {structuralPath(result.path)}
                              </span>
                              {explicit && (
                                <span className="shrink-0 rounded-full border border-amber-300/20 bg-amber-300/10 px-2 py-0.5 text-[10px] text-amber-200">
                                  {t("contextComposerPage.contextFiles.explicitTarget")}
                                </span>
                              )}
                            </span>
                            <span className="mt-1 block text-[11px] text-neutral-500">
                              {formatContextFileKind(result.kind, t)} · {formatContextFileUsage(result.usage, t)} · {formatFileSize(result.sizeBytes)}
                            </span>
                          </span>

                          <span className={[
                            "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition",
                            added
                              ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
                              : active
                                ? "border-white/15 bg-white text-black"
                                : "border-neutral-800 bg-neutral-950 text-neutral-400 group-hover:border-white/15 group-hover:bg-white group-hover:text-black",
                          ].join(" ")}>
                            {added ? <Check size={12} /> : active ? <Check size={12} /> : <Plus size={12} />}
                            {added
                              ? t("contextComposerPage.fileSearchPalette.added")
                              : t("contextComposerPage.fileSearchPalette.addFile")}
                          </span>
                        </motion.button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex min-h-[320px] items-center justify-center p-8 text-center">
                  <div className="max-w-sm">
                    <div className="mx-auto grid size-12 place-items-center rounded-2xl border border-neutral-900 bg-black/35 text-neutral-700">
                      <Search size={19} />
                    </div>
                    <p className="mt-4 text-sm font-semibold text-white">
                      {isSearching
                        ? t("contextComposerPage.fileSearchPalette.searching")
                        : t("contextComposerPage.fileSearchPalette.emptyTitle")}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-neutral-600">
                      {isSearching
                        ? t("contextComposerPage.fileSearchPalette.searchingDescription")
                        : t("contextComposerPage.fileSearchPalette.emptyDescription")}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex shrink-0 items-center justify-between gap-4 border-t border-neutral-900 bg-black/35 px-5 py-3 text-[11px] text-neutral-600">
              <span>
                {t("contextComposerPage.fileSearchPalette.resultCount", {
                  count: results.length,
                })}
              </span>
              <span>
                <span className="rounded border border-neutral-800 px-1.5 py-0.5 text-[10px]">Esc</span>
                {" "}
                {t("contextComposerPage.fileSearchPalette.closeHint")}
              </span>
            </div>
        </motion.section>
      </motion.div>
    ) : null,
    document.body,
  );
}
