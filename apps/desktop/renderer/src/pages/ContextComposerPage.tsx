import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  Clipboard,
  Code2,
  FileText,
  Gauge,
  Layers3,
  Loader2,
  MousePointer2,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  WandSparkles,
  XCircle
} from "lucide-react";

import {
  readContextComposerFileSnippet,
  searchContextComposerFiles
} from "../api/client";
import type {
  ContextComposerFileReference,
  ContextComposerFileSearchResult,
  ContextComposerPreview,
  ContextComposerSnippet
} from "../types";
import { ContextComposerEnginePanel } from "../components/contextComposer/ContextComposerEnginePanel";
import {
  getContextComposerFileReasonTranslationKey,
  usesLegacySelectorSemantics,
} from "../components/contextComposer/ContextComposerUiSemantics";
import { Button } from "../components/ui/Button";

interface ContextComposerPageProps {
  preview: ContextComposerPreview;
  isLoading?: boolean;
  onClose: () => void;
  onGenerate: (selectedFilePaths: string[]) => void;
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatFileSize(sizeBytes: number) {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${Math.round(sizeBytes / 1024)} KB`;
  }

  return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
}

function getRiskTone(riskLevel: string) {
  const normalized = riskLevel.toLowerCase();

  if (normalized.includes("high")) {
    return "border-red-400/25 bg-red-400/10 text-red-300";
  }

  if (normalized.includes("medium")) {
    return "border-white/20 bg-white/10 text-white";
  }

  return "border-emerald-400/25 bg-emerald-400/10 text-emerald-300";
}

function getSelectionStatusKey(status: string) {
  if (status === "blocked") return "contextComposerPage.selectionStatus.manualReview";
  if (status === "warning") return "contextComposerPage.selectionStatus.reviewSuggested";
  return "contextComposerPage.selectionStatus.ready";
}

function normalizeFileKey(path: string) {
  return path.replace(/\\/g, "/").toLowerCase();
}

function isLikelyBackendPath(path: string) {
  const normalized = normalizeFileKey(path);

  return (
    normalized.includes("/server/") ||
    normalized.includes("/routes/") ||
    normalized.includes("/controllers/") ||
    normalized.includes("/services/") ||
    normalized.includes("/db/") ||
    normalized.includes("/database/") ||
    normalized.includes("/api/") ||
    normalized.endsWith("server.ts") ||
    normalized.endsWith("server.js")
  );
}

function getComposerTargetArea(effectiveTaskArea: string) {
  const normalized = String(effectiveTaskArea || "general").toLowerCase();

  if (["ui", "backend", "tests", "docs", "build"].includes(normalized)) {
    return normalized as "ui" | "backend" | "tests" | "docs" | "build";
  }

  return "general" as const;
}

function StatCard({
  icon,
  label,
  value,
  caption
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  caption: string;
}) {
  return (
    <article className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
      <div className="mb-3 flex size-8 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-300">
        {icon}
      </div>

      <p className="cf-tech-label text-[10px] uppercase text-neutral-500">
        {label}
      </p>

      <p className="cf-display-font mt-1 truncate text-2xl font-semibold text-white">
        {value}
      </p>

      <p className="mt-1 truncate text-xs text-neutral-500">
        {caption}
      </p>
    </article>
  );
}

function mergeFilesByPath<T extends { path: string }>(files: T[]) {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const file of files) {
    const key = normalizeFileKey(file.path);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(file);
  }

  return result;
}

function mergeSnippetsByPath(snippets: ContextComposerSnippet[]) {
  const seen = new Set<string>();
  const result: ContextComposerSnippet[] = [];

  for (const snippet of snippets) {
    const key = normalizeFileKey(snippet.relativePath);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(snippet);
  }

  return result;
}

function ComposerActionButton({
  icon,
  label,
  active = false,
  danger = false,
  onClick
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.96 }}
      transition={{ duration: 0.14 }}
      className={[
        "group relative inline-flex h-8 items-center gap-1.5 overflow-hidden rounded-full border px-3 text-xs font-medium transition duration-200",
        active
          ? "border-white bg-white text-black shadow-[0_10px_28px_rgba(255,255,255,0.10)]"
          : danger
            ? "border-red-400/20 bg-red-400/5 text-red-200 hover:border-white hover:bg-white hover:text-black"
            : "border-neutral-800 bg-neutral-950 text-neutral-400 hover:border-white hover:bg-white hover:text-black"
      ].join(" ")}
    >
      <span className="pointer-events-none absolute inset-0 opacity-0 transition duration-300 group-hover:opacity-100">
        <span className="absolute inset-y-0 -left-10 w-10 rotate-12 bg-white/35 blur-md transition duration-500 group-hover:left-[120%]" />
      </span>

      <span
        className={[
          "relative z-10 transition-transform duration-200 group-hover:scale-110",
          active ? "text-black" : "group-hover:text-black"
        ].join(" ")}
      >
        {icon}
      </span>

      <span className="relative z-10">{label}</span>
    </motion.button>
  );
}

function FileCandidateCard({
  file,
  isSelected,
  isManual,
  manualLabel,
  isCopied,
  onToggle,
  onCopy,
  onRemove
}: {
  file: ContextComposerFileReference;
  isSelected: boolean;
  isManual: boolean;
  manualLabel?: string;
  isCopied: boolean;
  onToggle: () => void;
  onCopy: () => void;
  onRemove?: () => void;
}) {
  const { t } = useTranslation();
  const resolvedManualLabel = manualLabel ?? t("contextComposerPage.fileCard.manuallyReviewed");
  const legacyConfidence = file.confidenceDisplay !== "unavailable" && typeof file.confidence === "number"
    ? file.confidence
    : null;
  const reasonTranslationKey = getContextComposerFileReasonTranslationKey(file);
  const displayReason = reasonTranslationKey ? t(reasonTranslationKey) : file.reason;
  return (
    <motion.article
      layout={false}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.14 }}
      className={[
        "rounded-2xl border p-3 transition duration-200",
        isSelected
          ? "border-white/20 bg-white/[0.035]"
          : "border-neutral-900 bg-black/25 opacity-55 hover:opacity-100"
      ].join(" ")}
    >
      <div className="mb-2 flex items-start gap-3">
        <button
          type="button"
          onClick={onToggle}
          className={[
            "grid size-8 shrink-0 place-items-center rounded-xl border transition",
            isSelected
              ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
              : "border-neutral-800 bg-neutral-950 text-neutral-600 hover:border-white hover:bg-white hover:text-black"
          ].join(" ")}
          aria-label={isSelected
            ? t("contextComposerPage.fileCard.excludeAria")
            : t("contextComposerPage.fileCard.includeAria")}
        >
          {isSelected ? <CheckCircle2 size={14} /> : <FileText size={14} />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="mb-1 flex min-w-0 items-center gap-2">
            <p className="truncate text-sm font-semibold text-white">
              {file.path}
            </p>

            {isManual && (
              <span className="shrink-0 rounded-full border border-white/15 bg-white/10 px-2 py-0.5 text-[10px] text-white">
                {resolvedManualLabel}
              </span>
            )}
          </div>

          <p className="truncate text-xs text-neutral-500">
            {file.kind} · {file.usage} · {formatFileSize(file.sizeBytes)}
          </p>
        </div>
      </div>

      <p className="line-clamp-2 text-xs leading-5 text-neutral-500">
        {displayReason}
      </p>

      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="rounded-full border border-neutral-900 bg-neutral-950 px-2 py-1 text-[11px] text-neutral-500">
          {legacyConfidence === null
            ? [
                t(`settings.composerEngineSource_${file.source ?? "v2"}`),
                file.contextRole ? t(`settings.composerEngineRole_${file.contextRole}`) : null,
                t(`settings.composerEngineEvidenceState_${file.evidenceState ?? "unavailable"}`),
              ].filter(Boolean).join(" · ")
            : formatPercent(legacyConfidence)}
        </span>

        <div className="flex items-center gap-2">
          {isManual && onRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="inline-flex h-7 items-center gap-1.5 rounded-full border border-red-400/20 bg-red-400/5 px-2.5 text-[11px] text-red-200 transition hover:border-white hover:bg-white hover:text-black"
            >
              <Trash2 size={12} />
              {t("contextComposerPage.fileCard.remove")}
            </button>
          )}

          <button
            type="button"
            onClick={onToggle}
            className={[
              "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] transition",
              isSelected
                ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
                : "border-neutral-800 bg-neutral-950 text-neutral-500 hover:border-white hover:bg-white hover:text-black"
            ].join(" ")}
          >
            {isSelected ? <Check size={12} /> : <FileText size={12} />}
            {isSelected
              ? t("contextComposerPage.fileCard.included")
              : t("contextComposerPage.fileCard.include")}
          </button>

          <button
            type="button"
            onClick={onCopy}
            className="cf-invert-action inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11px]"
          >
            {isCopied ? <Check size={12} /> : <Clipboard size={12} />}
            {isCopied
              ? t("contextComposerPage.fileCard.copied")
              : t("contextComposerPage.fileCard.path")}
          </button>
        </div>
      </div>
    </motion.article>
  );
}

function FileCandidateSection({
  title,
  caption,
  count,
  emptyText,
  children
}: {
  title: string;
  caption: string;
  count: number;
  emptyText: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-3 px-1">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-white">{title}</p>
          <p className="truncate text-[11px] text-neutral-500">{caption}</p>
        </div>

        <span className="rounded-full border border-neutral-900 bg-neutral-950 px-2 py-1 text-[10px] text-neutral-500">
          {count}
        </span>
      </div>

      {count === 0 ? (
        <div className="rounded-2xl border border-neutral-900 bg-black/25 p-4 text-xs leading-5 text-neutral-500">
          {emptyText}
        </div>
      ) : (
        children
      )}
    </section>
  );
}

export function ContextComposerPage({
  preview,
  isLoading = false,
  onClose,
  onGenerate
}: ContextComposerPageProps) {
  const { t } = useTranslation();
  const showsLegacyQuality = (preview.qualitySource ?? "legacy_quality") === "legacy_quality";
  const recommendedPaths = useMemo(
    () => preview.selectedFiles.map((file) => file.path),
    [preview.selectedFiles]
  );

  const selectorAbstention = usesLegacySelectorSemantics(preview) && preview.selectorDiagnostics?.actual.outcome === "abstained"
    ? preview.selectorDiagnostics.actual.abstention
    : null;
  const isAbstentionReview = Boolean(selectorAbstention);
  const isBlockedReview = preview.selectionQuality.status === "blocked";
  const initialSelectedPaths = useMemo(
    () => (isBlockedReview ? [] : recommendedPaths),
    [isBlockedReview, recommendedPaths]
  );
  const targetArea = getComposerTargetArea(preview.task.effectiveTaskArea);
  const targetCopy = {
    target: t(`contextComposerPage.targetCopy.${targetArea}.target`),
    targetPlural: t(`contextComposerPage.targetCopy.${targetArea}.targetPlural`),
    searchHint: t(`contextComposerPage.targetCopy.${targetArea}.searchHint`),
    reviewHint: t(`contextComposerPage.targetCopy.${targetArea}.reviewHint`),
    candidateCaption: t(`contextComposerPage.targetCopy.${targetArea}.candidateCaption`)
  };
  const initialFileSearchMessage = isAbstentionReview
    ? t("contextComposerPage.search.initialAbstention", { hint: targetCopy.searchHint })
    : isBlockedReview
      ? t("contextComposerPage.search.initialBlocked", { hint: targetCopy.searchHint })
      : t("contextComposerPage.search.initialReady", { target: targetCopy.target });

  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [extraFiles, setExtraFiles] = useState<ContextComposerFileReference[]>([]);
  const [extraSnippets, setExtraSnippets] = useState<ContextComposerSnippet[]>([]);
  const [isFileSearchOpen, setIsFileSearchOpen] = useState(false);
  const [fileSearchQuery, setFileSearchQuery] = useState(isBlockedReview ? preview.task.rawTask : "");
  const [fileSearchResults, setFileSearchResults] = useState<
    ContextComposerFileSearchResult[]
  >([]);
  const [isSearchingFiles, setIsSearchingFiles] = useState(false);
  const [fileSearchMessage, setFileSearchMessage] = useState(initialFileSearchMessage);
  const [selectedPaths, setSelectedPaths] = useState<string[]>(initialSelectedPaths);
  const [confirmedRecommendedPaths, setConfirmedRecommendedPaths] = useState<string[]>([]);
  const [activeSnippetPath, setActiveSnippetPath] = useState<string | null>(
    preview.snippets[0]?.relativePath ?? null
  );
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  const manualPathSet = useMemo(() => {
    return new Set(extraFiles.map((file) => normalizeFileKey(file.path)));
  }, [extraFiles]);

  const suggestedFiles = useMemo(() => {
    return mergeFilesByPath((preview.suggestedFileGroups ?? []).flatMap((group) => group.files));
  }, [preview.suggestedFileGroups]);

  const suggestedPathSet = useMemo(() => {
    return new Set(suggestedFiles.map((file) => normalizeFileKey(file.path)));
  }, [suggestedFiles]);

  const confirmedRecommendedPathSet = useMemo(() => {
    return new Set(confirmedRecommendedPaths.map(normalizeFileKey));
  }, [confirmedRecommendedPaths]);

  const fileCandidates = useMemo(() => {
    return mergeFilesByPath([...suggestedFiles, ...preview.selectedFiles, ...extraFiles]);
  }, [preview.selectedFiles, extraFiles, suggestedFiles]);

  const suggestedCandidateFiles = useMemo(() => {
    return fileCandidates.filter((file) => {
      const key = normalizeFileKey(file.path);
      return suggestedPathSet.has(key) && !manualPathSet.has(key);
    });
  }, [fileCandidates, manualPathSet, suggestedPathSet]);

  const recommendedFiles = useMemo(() => {
    return fileCandidates.filter((file) => {
      const key = normalizeFileKey(file.path);
      return !manualPathSet.has(key) && !suggestedPathSet.has(key);
    });
  }, [fileCandidates, manualPathSet, suggestedPathSet]);

  const manuallyAddedFiles = useMemo(() => {
    return fileCandidates.filter((file) =>
      manualPathSet.has(normalizeFileKey(file.path))
    );
  }, [fileCandidates, manualPathSet]);

  const snippetCandidates = useMemo(() => {
    return mergeSnippetsByPath([...preview.snippets, ...extraSnippets]);
  }, [preview.snippets, extraSnippets]);

  const fileCandidatePaths = useMemo(() => {
    return fileCandidates.map((file) => file.path);
  }, [fileCandidates]);

  useEffect(() => {
    setExtraFiles([]);
    setExtraSnippets([]);
    setFileSearchQuery(isBlockedReview ? preview.task.rawTask : "");
    setFileSearchResults([]);
    setIsFileSearchOpen(isBlockedReview);
    setIsDetailsOpen(isBlockedReview);
    setConfirmedRecommendedPaths([]);
    setSelectedPaths(initialSelectedPaths);
    setActiveSnippetPath(isBlockedReview ? null : preview.snippets[0]?.relativePath ?? null);
  }, [initialSelectedPaths, isBlockedReview, preview]);

  useEffect(() => {
    setFileSearchMessage(initialFileSearchMessage);
  }, [initialFileSearchMessage, preview]);

  const selectedPathSet = useMemo(() => {
    return new Set(selectedPaths);
  }, [selectedPaths]);

  const selectedFiles = useMemo(() => {
    return fileCandidates.filter((file) => selectedPathSet.has(file.path));
  }, [fileCandidates, selectedPathSet]);

  const selectedSnippets = useMemo(() => {
    return snippetCandidates.filter((snippet) =>
      selectedPathSet.has(snippet.relativePath)
    );
  }, [snippetCandidates, selectedPathSet]);

  const selectedManualFiles = useMemo(() => {
    return selectedFiles.filter((file) => {
      const key = normalizeFileKey(file.path);
      return manualPathSet.has(key) || confirmedRecommendedPathSet.has(key);
    });
  }, [confirmedRecommendedPathSet, selectedFiles, manualPathSet]);

  const selectedWeakAutoFiles = useMemo(() => {
    return selectedFiles.filter((file) => {
      const key = normalizeFileKey(file.path);
      return !manualPathSet.has(key) && !confirmedRecommendedPathSet.has(key);
    });
  }, [confirmedRecommendedPathSet, selectedFiles, manualPathSet]);

  const activeSnippet =
    selectedSnippets.find((snippet) => snippet.relativePath === activeSnippetPath) ??
    selectedSnippets[0] ??
    null;

  const finalWarnings = useMemo(() => {
    const warnings: string[] = [
      ...preview.selectionQuality.blockingReasons,
      ...preview.selectionQuality.warnings
    ];
    const selectedStyleCount = selectedFiles.filter(
      (file) => file.kind === "style"
    ).length;
    const selectedSourceCount = selectedFiles.filter(
      (file) => file.kind === "source"
    ).length;
    const taskText = `${preview.task.rawTask} ${preview.task.effectiveTaskArea}`.toLowerCase();

    if (selectedPaths.length === 0) {
      warnings.push(t("contextComposerPage.warnings.noFiles"));
    }

    if (isBlockedReview && selectedPaths.length > 0 && selectedManualFiles.length === 0) {
      warnings.push(
        isAbstentionReview
          ? t("contextComposerPage.warnings.targetConfirmationRequired")
          : t("contextComposerPage.warnings.blockedReview"),
      );
    }

    if (isBlockedReview && selectedWeakAutoFiles.length > 0) {
      warnings.push(
        isAbstentionReview
          ? t("contextComposerPage.warnings.unconfirmedHints")
          : t("contextComposerPage.warnings.unreviewedWeakFiles"),
      );
    }

    if (selectedPaths.length > 0 && selectedSnippets.length === 0) {
      warnings.push(t("contextComposerPage.warnings.noReadableSnippets"));
    }

    if (
      selectedFiles.length > 0 &&
      selectedStyleCount === selectedFiles.length &&
      taskText.match(/bug|fix|state|logic|behavior|ошиб|баг|логик|поведен/)
    ) {
      warnings.push(t("contextComposerPage.warnings.onlyStyleFiles"));
    }

    if (
      preview.task.effectiveTaskArea === "ui" &&
      selectedFiles.some((file) => isLikelyBackendPath(file.path)) &&
      taskText.match(/do not change backend|backend unchanged|не менять api|не трогать бэк|только ui/)
    ) {
      warnings.push(t("contextComposerPage.warnings.backendConstrained"));
    }

    if (selectedSourceCount === 0 && selectedFiles.length > 0 && selectedStyleCount > 0) {
      warnings.push(t("contextComposerPage.warnings.noSourceFile"));
    }

    return warnings;
  }, [
    preview.selectionQuality.blockingReasons,
    preview.selectionQuality.warnings,
    preview.task.effectiveTaskArea,
    preview.task.rawTask,
    isAbstentionReview,
    isBlockedReview,
    selectedFiles,
    selectedManualFiles.length,
    selectedPaths.length,
    selectedSnippets.length,
    selectedWeakAutoFiles.length,
    t
  ]);

  useEffect(() => {
    if (selectedSnippets.length === 0) {
      setActiveSnippetPath(null);
      return;
    }

    if (
      !activeSnippetPath ||
      !selectedSnippets.some((snippet) => snippet.relativePath === activeSnippetPath)
    ) {
      setActiveSnippetPath(selectedSnippets[0].relativePath);
    }
  }, [activeSnippetPath, selectedSnippets]);

  const runFileSearch = useCallback(async () => {
    if (!isFileSearchOpen) {
      return;
    }

    try {
      setIsSearchingFiles(true);

      const response = await searchContextComposerFiles({
        projectId: preview.project.id,
        query: fileSearchQuery,
        limit: 12,
        excludePaths: fileCandidatePaths
      });

      setFileSearchResults(response.results);
      setFileSearchMessage(
        response.results.length > 0
          ? t("contextComposerPage.search.resultsFound", { count: response.results.length })
          : t("contextComposerPage.search.noResults")
      );
    } catch (error) {
      setFileSearchResults([]);
      setFileSearchMessage(
        error instanceof Error ? error.message : t("contextComposerPage.search.failed")
      );
    } finally {
      setIsSearchingFiles(false);
    }
  }, [
    fileCandidatePaths,
    fileSearchQuery,
    isFileSearchOpen,
    preview.project.id,
    t
  ]);

  useEffect(() => {
    if (!isFileSearchOpen) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      runFileSearch();
    }, 260);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isFileSearchOpen, runFileSearch]);

  async function addFileFromSearch(result: ContextComposerFileSearchResult) {
    if (fileCandidates.some((file) => file.path === result.path)) {
      setSelectedPaths((current) =>
        current.includes(result.path) ? current : [...current, result.path]
      );
      if (isBlockedReview) {
        setConfirmedRecommendedPaths((current) =>
          current.includes(result.path) ? current : [...current, result.path]
        );
      }
      return;
    }

    const nextFile: ContextComposerFileReference = {
      path: result.path,
      kind: result.kind,
      usage: result.usage,
      reason: result.reason,
      confidence: result.confidence,
      canReadText: result.canReadText,
      sizeBytes: result.sizeBytes
    };

    setExtraFiles((current) => mergeFilesByPath([...current, nextFile]));
    setSelectedPaths((current) =>
      current.includes(result.path) ? current : [...current, result.path]
    );

    try {
      const response = await readContextComposerFileSnippet({
        projectId: preview.project.id,
        filePath: result.path
      });

      const snippet = response.snippet;

      if (snippet) {
        setExtraSnippets((current) =>
          mergeSnippetsByPath([...current, snippet])
        );
        setActiveSnippetPath(snippet.relativePath);
      }
    } catch {
      // Non-readable files can still be included as references.
    }

    setFileSearchQuery(isBlockedReview ? preview.task.rawTask : "");
    setFileSearchResults([]);
    setFileSearchMessage(t("contextComposerPage.search.added", { path: result.path }));
  }

  function removeManualFile(path: string) {
    const key = normalizeFileKey(path);

    setExtraFiles((current) =>
      current.filter((file) => normalizeFileKey(file.path) !== key)
    );
    setExtraSnippets((current) =>
      current.filter((snippet) => normalizeFileKey(snippet.relativePath) !== key)
    );
    setSelectedPaths((current) =>
      current.filter((item) => normalizeFileKey(item) !== key)
    );
    setConfirmedRecommendedPaths((current) =>
      current.filter((item) => normalizeFileKey(item) !== key)
    );
    setFileSearchMessage(t("contextComposerPage.search.removed", { path }));
  }

  function togglePath(path: string) {
    setSelectedPaths((current) => {
      if (current.includes(path)) {
        if (isBlockedReview) {
          setConfirmedRecommendedPaths((confirmed) =>
            confirmed.filter((item) => normalizeFileKey(item) !== normalizeFileKey(path))
          );
        }
        return current.filter((item) => item !== path);
      }

      if (isBlockedReview && !manualPathSet.has(normalizeFileKey(path))) {
        setConfirmedRecommendedPaths((confirmed) =>
          confirmed.includes(path) ? confirmed : [...confirmed, path]
        );
      }

      return [...current, path];
    });
  }

  function selectRecommendedPaths() {
    setSelectedPaths(recommendedPaths);
    if (isBlockedReview) {
      setConfirmedRecommendedPaths(recommendedPaths);
    }
  }

  function selectAllPaths() {
    const allPaths = fileCandidates.map((file) => file.path);
    setSelectedPaths(allPaths);
    if (isBlockedReview) {
      setConfirmedRecommendedPaths(
        fileCandidates
          .filter((file) => !manualPathSet.has(normalizeFileKey(file.path)))
          .map((file) => file.path)
      );
    }
  }

  function clearSelectedPaths() {
    setSelectedPaths([]);
    setConfirmedRecommendedPaths([]);
  }

  async function copyPath(path: string) {
    await navigator.clipboard.writeText(path);
    setCopiedPath(path);

    window.setTimeout(() => {
      setCopiedPath(null);
    }, 1400);
  }

  return (
    <section className="space-y-5">
      <div className="rounded-[1.35rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.01))] p-5 shadow-[0_14px_44px_rgba(0,0,0,0.32),inset_0_1px_0_rgba(255,255,255,0.045)]">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap gap-2">
              <span className="cf-badge">
                <Sparkles size={12} />
                {t("contextComposerPage.header.badge")}
              </span>

              <span className="cf-badge">{preview.project.name}</span>
              <span className="cf-badge">{preview.task.effectiveTaskArea}</span>
              <span className="cf-badge">{preview.task.targetTool}</span>
            </div>

            <h1 className="text-[32px] font-semibold leading-[1.04] tracking-[-0.055em] text-white">
              {t("contextComposerPage.header.title")}
            </h1>

            <p className="mt-2 line-clamp-2 max-w-5xl text-sm leading-6 text-neutral-500">
              {preview.task.rawTask}
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={onClose} disabled={isLoading}>
              <ArrowLeft size={15} />
              {t("contextComposerPage.header.backToTask")}
            </Button>

            <Button
              variant="primary"
              onClick={() => onGenerate(selectedPaths)}
              disabled={
                isLoading ||
                selectedPaths.length === 0 ||
                (isBlockedReview && selectedManualFiles.length === 0)
              }
            >
              <WandSparkles size={15} />
              {isLoading
                ? t("contextComposerPage.header.generating")
                : isBlockedReview
                  ? t("contextComposerPage.header.generateReviewed")
                  : t("contextComposerPage.header.generateSelected")}
            </Button>
          </div>
        </div>
      </div>

      {preview.contextEngine && <ContextComposerEnginePanel view={preview.contextEngine} />}

      {preview.selectionQuality.status !== "ready" && (
        <div
          className={[
            "rounded-[1.15rem] border p-4",
            preview.selectionQuality.status === "blocked" && !isAbstentionReview
              ? "border-red-400/25 bg-red-400/10"
              : "border-amber-300/20 bg-amber-300/10"
          ].join(" ")}
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl border border-white/10 bg-black/30 text-white">
              <AlertTriangle size={15} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white">
                {selectorAbstention
                  ? showsLegacyQuality
                    ? t("contextComposerPage.review.targetNotConfirmed", { score: preview.selectionQuality.score })
                    : t(`settings.composerEngineQuality_${preview.qualitySource ?? "review_required"}`)
                  : showsLegacyQuality
                    ? t("contextComposerPage.review.contextReviewStatus", {
                        status: t(getSelectionStatusKey(preview.selectionQuality.status)),
                        score: preview.selectionQuality.score
                      })
                    : t(`settings.composerEngineQuality_${preview.qualitySource ?? "review_required"}`)}
              </p>
              <p className="mt-1 text-xs leading-5 text-neutral-400">
                {selectorAbstention
                  ? selectorAbstention.message
                  : t("contextComposerPage.review.lowConfidenceDescription", {
                      reviewHint: targetCopy.reviewHint
                    })}
              </p>
              {isBlockedReview && (
                <p className={[
                  "mt-1 text-xs leading-5",
                  isAbstentionReview ? "text-amber-100/80" : "text-red-100/80"
                ].join(" ")}>
                  {isAbstentionReview
                    ? t("contextComposerPage.review.targetConfirmationMode")
                    : t("contextComposerPage.review.blockedMode")}
                </p>
              )}
              <div className="mt-3 space-y-1">
                {[...preview.selectionQuality.blockingReasons, ...preview.selectionQuality.warnings].slice(0, 4).map((item) => (
                  <p key={item} className="text-xs leading-5 text-neutral-300">
                    • {item}
                  </p>
                ))}
              </div>

              {showsLegacyQuality && preview.selectionQuality.signals && (
                <div className="mt-3 grid gap-2 sm:grid-cols-4">
                  {[
                    [t("contextComposerPage.review.signalTarget"), preview.selectionQuality.signals.targetConfidence],
                    [t("contextComposerPage.review.signalScope"), preview.selectionQuality.signals.scopeSafety],
                    [t("contextComposerPage.review.signalContext"), preview.selectionQuality.signals.contextCompleteness],
                    [t("contextComposerPage.review.signalSafe"), 100 - preview.selectionQuality.signals.protectedScopeRisk]
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-2xl border border-white/10 bg-black/25 p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
                        {label}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-white">{value}/100</p>
                    </div>
                  ))}
                </div>
              )}

              {[
                ...(selectorAbstention?.nextActions ?? []),
                ...(preview.selectionQuality.signals?.nextActions ?? [])
              ].filter((item, index, items) => items.indexOf(item) === index).length > 0 && (
                <div className="mt-3 rounded-2xl border border-white/10 bg-black/25 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
                    {t("contextComposerPage.review.nextActions")}
                  </p>
                  <div className="mt-2 space-y-1">
                    {[
                      ...(selectorAbstention?.nextActions ?? []),
                      ...(preview.selectionQuality.signals?.nextActions ?? [])
                    ].filter((item, index, items) => items.indexOf(item) === index).map((item) => (
                      <p key={item} className="text-xs leading-5 text-neutral-300">
                        - {item}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {(preview.clarifyingQuestions ?? []).length > 0 && (
                <div className="mt-3 rounded-2xl border border-white/10 bg-black/25 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
                    {t("contextComposerPage.review.clarifyBeforeGenerating")}
                  </p>
                  <div className="mt-2 space-y-1">
                    {(preview.clarifyingQuestions ?? []).map((item) => (
                      <p key={item} className="text-xs leading-5 text-neutral-300">
                        • {item}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-5">
        <StatCard
          icon={<MousePointer2 size={15} />}
          label={t("contextComposerPage.stats.included")}
          value={`${selectedFiles.length}/${fileCandidates.length}`}
          caption={t("contextComposerPage.stats.manualReview")}
        />

        <StatCard
          icon={<Code2 size={15} />}
          label={t("contextComposerPage.stats.snippets")}
          value={selectedSnippets.length}
          caption={t("contextComposerPage.stats.readableFiles")}
        />

        <StatCard
          icon={<Layers3 size={15} />}
          label={t("contextComposerPage.stats.manual")}
          value={selectedManualFiles.length}
          caption={t("contextComposerPage.stats.addedFiles")}
        />

        <StatCard
          icon={<Gauge size={15} />}
          label={showsLegacyQuality ? t("contextComposerPage.stats.confidence") : t("settings.composerEngineEvidenceQuality")}
          value={showsLegacyQuality
            ? formatPercent(preview.taskIntent.confidence)
            : t(`settings.composerEngineQuality_${preview.qualitySource ?? "v2_grounded"}`)}
          caption={showsLegacyQuality ? preview.taskIntent.source : t("settings.composerEngineConfidenceUnavailable")}
        />

        <StatCard
          icon={<ShieldCheck size={15} />}
          label={t("contextComposerPage.stats.quality")}
          value={showsLegacyQuality
            ? `${preview.selectionQuality.score}/100`
            : t(`settings.composerEngineQuality_${preview.qualitySource ?? "v2_grounded"}`)}
          caption={t(getSelectionStatusKey(preview.selectionQuality.status))}
        />
      </div>

      <div className="grid min-h-[720px] gap-5 xl:grid-cols-[430px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-[1.35rem] border border-neutral-900 bg-black/35 p-4">
          <div className="mb-4 flex shrink-0 items-start justify-between gap-4">
            <div>
              <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                {t("contextComposerPage.candidates.kicker")}
              </p>

              <h2 className="mt-1 text-base font-semibold text-white">
                {t("contextComposerPage.candidates.title")}
              </h2>
            </div>

            <span className="cf-badge">
              {selectedFiles.length}/{fileCandidates.length}
            </span>
          </div>

          <div className="mb-3 flex shrink-0 flex-wrap gap-2">
            <ComposerActionButton
              icon={<RotateCcw size={13} />}
              label={isAbstentionReview
                ? t("contextComposerPage.candidates.reviewHints")
                : isBlockedReview
                  ? t("contextComposerPage.candidates.confirmAuto")
                  : t("contextComposerPage.candidates.recommended")}
              danger={isBlockedReview && !isAbstentionReview}
              onClick={selectRecommendedPaths}
            />

            <ComposerActionButton
              icon={<CheckCircle2 size={13} />}
              label={isAbstentionReview
                ? t("contextComposerPage.candidates.reviewAll")
                : isBlockedReview
                  ? t("contextComposerPage.candidates.confirmAll")
                  : t("contextComposerPage.candidates.selectAll")}
              danger={isBlockedReview && !isAbstentionReview}
              onClick={selectAllPaths}
            />

            <ComposerActionButton
              icon={<XCircle size={13} />}
              label={isAbstentionReview
                ? t("contextComposerPage.candidates.clearHints")
                : isBlockedReview
                  ? t("contextComposerPage.candidates.clearWeak")
                  : t("contextComposerPage.candidates.clear")}
              danger
              onClick={clearSelectedPaths}
            />

            <ComposerActionButton
              icon={<Plus size={13} />}
              label={t("contextComposerPage.candidates.addFile")}
              active={isFileSearchOpen}
              onClick={() => setIsFileSearchOpen((current) => !current)}
            />
          </div>

          {isBlockedReview && (
            <div className={[
              "mb-3 rounded-2xl border px-3 py-2 text-xs leading-5",
              isAbstentionReview
                ? "border-amber-300/15 bg-amber-300/5 text-amber-100/75"
                : "border-red-400/15 bg-red-400/5 text-red-100/75"
            ].join(" ")}>
              {isAbstentionReview
                ? t("contextComposerPage.candidates.abstentionHelp")
                : t("contextComposerPage.candidates.blockedHelp")}
            </div>
          )}

          <AnimatePresence initial={false}>
            {isFileSearchOpen && (
              <motion.div
                initial={{ opacity: 0, y: -8, height: 0 }}
                animate={{ opacity: 1, y: 0, height: "auto" }}
                exit={{ opacity: 0, y: -8, height: 0 }}
                transition={{ duration: 0.18 }}
                className="mb-3 shrink-0 overflow-hidden"
              >
                <div className="rounded-2xl border border-neutral-900 bg-black/45 p-3">
                  <div className="flex items-center gap-2 rounded-xl border border-neutral-900 bg-neutral-950 px-3">
                    <Search size={14} className="shrink-0 text-neutral-600" />

                    <input
                      value={fileSearchQuery}
                      onChange={(event) => setFileSearchQuery(event.target.value)}
                      placeholder={t("contextComposerPage.search.placeholder")}
                      className="h-9 min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-neutral-700"
                    />

                    {isSearchingFiles && (
                      <Loader2
                        size={14}
                        className="shrink-0 animate-spin text-neutral-500"
                      />
                    )}
                  </div>

                  <p className="mt-2 text-[11px] text-neutral-500">
                    {fileSearchMessage}
                  </p>

                  {fileSearchResults.length > 0 && (
                    <div className="mt-3 max-h-[170px] space-y-2 overflow-y-auto pr-1">
                      {fileSearchResults.map((result) => (
                        <button
                          key={result.path}
                          type="button"
                          onClick={() => addFileFromSearch(result)}
                          className="group flex w-full items-center gap-3 rounded-xl border border-neutral-900 bg-black/35 p-2 text-left transition hover:border-white hover:bg-white hover:text-black"
                        >
                          <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-neutral-800 bg-neutral-950 text-neutral-500 transition group-hover:border-black/10 group-hover:bg-black/5 group-hover:text-black">
                            <FileText size={13} />
                          </span>

                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-semibold text-white transition group-hover:text-black">
                              {result.path}
                            </span>

                            <span className="mt-0.5 block truncate text-[11px] text-neutral-600 transition group-hover:text-black/55">
                              {result.kind} · {result.usage} ·{" "}
                              {formatFileSize(result.sizeBytes)}
                            </span>
                          </span>

                          <span className="rounded-full border border-neutral-800 bg-neutral-950 px-2 py-1 text-[10px] text-neutral-500 transition group-hover:border-black/10 group-hover:bg-black/5 group-hover:text-black/60">
                            {t("contextComposerPage.fileCard.add")}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
            <FileCandidateSection
              title={isAbstentionReview
                ? t("contextComposerPage.sections.candidateHints")
                : isBlockedReview
                  ? t("contextComposerPage.sections.weakSuggestions")
                  : t("contextComposerPage.sections.suggestedTargets")}
              caption={
                isAbstentionReview
                  ? t("contextComposerPage.sections.candidateHintsCaption", { target: targetCopy.target })
                  : isBlockedReview
                    ? t("contextComposerPage.sections.weakSuggestionsCaption", { target: targetCopy.target })
                    : targetCopy.candidateCaption
              }
              count={suggestedCandidateFiles.length}
              emptyText={
                isAbstentionReview
                  ? t("contextComposerPage.sections.noCandidateHints", { hint: targetCopy.searchHint })
                  : isBlockedReview
                    ? t("contextComposerPage.sections.noWeakSuggestions", { hint: targetCopy.searchHint })
                    : t("contextComposerPage.sections.noSuggestedTargets", {
                        targets: targetCopy.targetPlural,
                        hint: targetCopy.searchHint
                      })
              }
            >
              <AnimatePresence initial={false}>
                {suggestedCandidateFiles.map((file) => {
                  const isCopied = copiedPath === file.path;
                  const isSelected = selectedPathSet.has(file.path);

                  return (
                    <FileCandidateCard
                      key={file.path}
                      file={file}
                      isSelected={isSelected}
                      isManual={confirmedRecommendedPathSet.has(normalizeFileKey(file.path))}
                      manualLabel={t("contextComposerPage.fileCard.reviewed")}
                      isCopied={isCopied}
                      onToggle={() => togglePath(file.path)}
                      onCopy={() => copyPath(file.path)}
                    />
                  );
                })}
              </AnimatePresence>
            </FileCandidateSection>

            <FileCandidateSection
              title={t("contextComposerPage.sections.recommendedContext")}
              caption={
                isAbstentionReview
                  ? t("contextComposerPage.sections.recommendedAbstentionCaption")
                  : isBlockedReview
                    ? t("contextComposerPage.sections.recommendedBlockedCaption")
                    : t("contextComposerPage.sections.recommendedCaption")
              }
              count={recommendedFiles.length}
              emptyText={t("contextComposerPage.sections.noRecommendedFiles")}
            >
              <AnimatePresence initial={false}>
                {recommendedFiles.map((file) => {
                  const isCopied = copiedPath === file.path;
                  const isSelected = selectedPathSet.has(file.path);

                  return (
                    <FileCandidateCard
                      key={file.path}
                      file={file}
                      isSelected={isSelected}
                      isManual={confirmedRecommendedPathSet.has(normalizeFileKey(file.path))}
                      manualLabel={t("contextComposerPage.fileCard.reviewed")}
                      isCopied={isCopied}
                      onToggle={() => togglePath(file.path)}
                      onCopy={() => copyPath(file.path)}
                    />
                  );
                })}
              </AnimatePresence>
            </FileCandidateSection>

            <FileCandidateSection
              title={t("contextComposerPage.sections.addedManually")}
              caption={t("contextComposerPage.sections.manualCaption")}
              count={manuallyAddedFiles.length}
              emptyText={t("contextComposerPage.sections.noManualFiles")}
            >
              <AnimatePresence initial={false}>
                {manuallyAddedFiles.map((file) => {
                  const isCopied = copiedPath === file.path;
                  const isSelected = selectedPathSet.has(file.path);

                  return (
                    <FileCandidateCard
                      key={file.path}
                      file={file}
                      isSelected={isSelected}
                      isManual
                      manualLabel={t("contextComposerPage.fileCard.addedManually")}
                      isCopied={isCopied}
                      onToggle={() => togglePath(file.path)}
                      onCopy={() => copyPath(file.path)}
                      onRemove={() => removeManualFile(file.path)}
                    />
                  );
                })}
              </AnimatePresence>
            </FileCandidateSection>
          </div>
        </aside>

        <main className="flex min-h-0 flex-col overflow-hidden rounded-[1.35rem] border border-neutral-900 bg-black/35 p-4">
          <div className="mb-4 flex shrink-0 items-start justify-between gap-4">
            <div>
              <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                {t("contextComposerPage.snippets.kicker")}
              </p>

              <h2 className="mt-1 text-base font-semibold text-white">
                {t("contextComposerPage.snippets.title")}
              </h2>
            </div>

            <span className="cf-badge">
              {activeSnippet?.language ?? t("contextComposerPage.snippets.noSnippet")}
            </span>
          </div>

          {selectedSnippets.length > 0 && (
            <div className="mb-3 flex shrink-0 gap-2 overflow-x-auto pb-1">
              {selectedSnippets.map((snippet) => {
                const isActive = snippet.relativePath === activeSnippet?.relativePath;

                return (
                  <motion.button
                    key={snippet.relativePath}
                    type="button"
                    onClick={() => setActiveSnippetPath(snippet.relativePath)}
                    whileTap={{ scale: 0.97 }}
                    className={[
                      "group relative shrink-0 overflow-hidden rounded-full border px-3 py-1.5 text-xs font-medium transition duration-200",
                      isActive
                        ? "border-white text-black"
                        : "border-neutral-900 bg-black/45 text-neutral-500 hover:border-white hover:text-white"
                    ].join(" ")}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="composer-snippet-active-pill"
                        className="absolute inset-0 rounded-full bg-white shadow-[0_10px_28px_rgba(255,255,255,0.10)]"
                        transition={{
                          type: "spring",
                          stiffness: 520,
                          damping: 42,
                          mass: 0.55
                        }}
                      />
                    )}

                    <span
                      className={[
                        "relative z-10 transition",
                        isActive ? "text-black" : "group-hover:text-white"
                      ].join(" ")}
                    >
                      {snippet.relativePath}
                    </span>
                  </motion.button>
                );
              })}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-neutral-900 bg-black/60 p-3">
            {activeSnippet ? (
              <AnimatePresence mode="wait" initial={false}>
                <motion.pre
                  key={activeSnippet.relativePath}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                  className="h-full min-h-0 overflow-y-auto whitespace-pre-wrap rounded-xl bg-neutral-950/55 p-4 text-xs leading-6 text-neutral-300"
                  style={{ willChange: "opacity, transform" }}
                >
                  {activeSnippet.content}
                  {activeSnippet.truncated
                    ? `\n\n/* ${t("contextComposerPage.snippets.truncated")} */`
                    : ""}
                </motion.pre>
              </AnimatePresence>
            ) : (
              <div className="flex h-full items-center justify-center rounded-xl bg-neutral-950/55 p-8 text-center">
                <div>
                  <XCircle size={22} className="mx-auto text-neutral-600" />
                  <p className="mt-3 text-sm font-medium text-white">
                    {t("contextComposerPage.snippets.emptyTitle")}
                  </p>
                  <p className="mt-1 text-sm text-neutral-500">
                    {t("contextComposerPage.snippets.emptyDescription")}
                  </p>
                </div>
              </div>
            )}
          </div>

          <section className="mt-4 shrink-0 rounded-2xl border border-neutral-900 bg-black/35 p-4">
            <div className="mb-3 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-white">
                  {t("contextComposerPage.summary.title")}
                </p>
                <p className="mt-1 text-xs text-neutral-500">
                  {t("contextComposerPage.summary.description")}
                </p>
              </div>

              <span
                className={[
                  "rounded-full border px-2.5 py-1 text-[11px]",
                  finalWarnings.length > 0
                    ? "border-white/20 bg-white/10 text-white"
                    : "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
                ].join(" ")}
              >
                {finalWarnings.length > 0
                  ? t("contextComposerPage.summary.warningCount", { count: finalWarnings.length })
                  : t("contextComposerPage.selectionStatus.ready")}
              </span>
            </div>

            <div className="grid gap-2 md:grid-cols-4">
              <div className="rounded-xl border border-neutral-900 bg-black/35 px-3 py-2">
                <p className="text-[10px] uppercase tracking-[0.16em] text-neutral-500">
                  {t("contextComposerPage.summary.files")}
                </p>
                <p className="mt-1 text-sm font-semibold text-white">
                  {selectedFiles.length}
                </p>
              </div>

              <div className="rounded-xl border border-neutral-900 bg-black/35 px-3 py-2">
                <p className="text-[10px] uppercase tracking-[0.16em] text-neutral-500">
                  {t("contextComposerPage.summary.snippets")}
                </p>
                <p className="mt-1 text-sm font-semibold text-white">
                  {selectedSnippets.length}
                </p>
              </div>

              <div className="rounded-xl border border-neutral-900 bg-black/35 px-3 py-2">
                <p className="text-[10px] uppercase tracking-[0.16em] text-neutral-500">
                  {t("contextComposerPage.summary.manual")}
                </p>
                <p className="mt-1 text-sm font-semibold text-white">
                  {selectedManualFiles.length}
                </p>
              </div>

              <div className="rounded-xl border border-neutral-900 bg-black/35 px-3 py-2">
                <p className="text-[10px] uppercase tracking-[0.16em] text-neutral-500">
                  {t("contextComposerPage.summary.area")}
                </p>
                <p className="mt-1 truncate text-sm font-semibold text-white">
                  {preview.task.effectiveTaskArea}
                </p>
              </div>
            </div>

            <AnimatePresence initial={false}>
              {finalWarnings.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.16 }}
                  className="mt-3 space-y-2"
                >
                  {finalWarnings.map((warning) => (
                    <div
                      key={warning}
                      className="flex items-start gap-2 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2"
                    >
                      <AlertTriangle
                        size={13}
                        className="mt-0.5 shrink-0 text-white"
                      />
                      <p className="text-xs leading-5 text-neutral-400">
                        {warning}
                      </p>
                    </div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </section>

          <div className="mt-4 shrink-0 overflow-hidden rounded-2xl border border-neutral-900 bg-black/35">
            <button
              type="button"
              onClick={() => setIsDetailsOpen((current) => !current)}
              className="group flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition hover:bg-white hover:text-black"
            >
              <span className="flex min-w-0 items-center gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-400 transition group-hover:border-black/10 group-hover:bg-black/5 group-hover:text-black">
                  <Bot size={14} />
                </span>

                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-white transition group-hover:text-black">
                    {t("contextComposerPage.details.title")}
                  </span>

                  <span className="block truncate text-xs text-neutral-500 transition group-hover:text-black/55">
                    {t("contextComposerPage.details.description")}
                  </span>
                </span>
              </span>

              <motion.span
                animate={{ rotate: isDetailsOpen ? 180 : 0 }}
                transition={{ duration: 0.18 }}
                className="shrink-0"
              >
                <ChevronDown size={16} />
              </motion.span>
            </button>

            <AnimatePresence initial={false}>
              {isDetailsOpen && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.18 }}
                  className="overflow-hidden border-t border-neutral-900"
                >
                  <div className="grid gap-3 p-4 lg:grid-cols-3">
                    <article className="rounded-2xl border border-neutral-900 bg-black/40 p-4">
                      <div className="mb-3 flex items-center gap-2">
                        <Bot size={15} className="text-neutral-500" />
                        <p className="text-sm font-semibold text-white">
                          {t("contextComposerPage.details.intent")}
                        </p>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-3 rounded-xl border border-neutral-900 bg-black/35 px-3 py-2 text-xs">
                          <span className="text-neutral-500">{t("contextComposerPage.details.area")}</span>
                          <span className="font-medium text-white">
                            {preview.taskIntent.taskArea}
                          </span>
                        </div>

                        <div className="flex items-center justify-between gap-3 rounded-xl border border-neutral-900 bg-black/35 px-3 py-2 text-xs">
                          <span className="text-neutral-500">{t("contextComposerPage.details.risk")}</span>
                          <span
                            className={[
                              "rounded-full border px-2 py-0.5 text-[11px]",
                              getRiskTone(preview.taskIntent.riskLevel)
                            ].join(" ")}
                          >
                            {preview.taskIntent.riskLevel}
                          </span>
                        </div>

                        <div className="flex items-center justify-between gap-3 rounded-xl border border-neutral-900 bg-black/35 px-3 py-2 text-xs">
                          <span className="text-neutral-500">{t("contextComposerPage.details.source")}</span>
                          <span className="font-medium text-white">
                            {preview.taskIntent.source}
                          </span>
                        </div>

                        {preview.taskIntent.structuredIntent && (
                          <div className="rounded-xl border border-neutral-900 bg-black/35 px-3 py-2 text-xs">
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-neutral-500">{t("contextComposerPage.details.structured")}</span>
                              <span className="font-medium text-white">
                                {preview.taskIntent.structuredIntent.allowedEditScope}
                              </span>
                            </div>

                            <div className="mt-2 space-y-1">
                              {preview.taskIntent.structuredIntent.primaryTargets.slice(0, 3).map((target) => (
                                <p
                                  key={`${target.kind}:${target.path ?? target.routePath ?? target.value}`}
                                  className="break-words text-[11px] leading-4 text-neutral-500"
                                >
                                  {target.kind}: {target.path ?? target.routePath ?? target.value}
                                </p>
                              ))}
                              {preview.taskIntent.structuredIntent.primaryTargets.length === 0 && (
                                <p className="text-[11px] leading-4 text-neutral-500">
                                  {t("contextComposerPage.details.noPrimaryTarget")}
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </article>

                    <article className="rounded-2xl border border-neutral-900 bg-black/40 p-4">
                      <div className="mb-3 flex items-center gap-2">
                        <ShieldCheck size={15} className="text-neutral-500" />
                        <p className="text-sm font-semibold text-white">
                          {t("contextComposerPage.details.safetyNotes")}
                        </p>
                      </div>

                      <div className="max-h-[150px] space-y-2 overflow-y-auto pr-1">
                        {preview.notes.slice(0, 8).map((note) => (
                          <p
                            key={note}
                            className="rounded-xl border border-neutral-900 bg-black/35 px-3 py-2 text-xs leading-5 text-neutral-500"
                          >
                            {note}
                          </p>
                        ))}
                      </div>
                    </article>

                    <article className="rounded-2xl border border-neutral-900 bg-black/40 p-4">
                      <div className="mb-3 flex items-center gap-2">
                        <Gauge size={15} className="text-neutral-500" />
                        <p className="text-sm font-semibold text-white">
                          {t("contextComposerPage.details.selectorRuntime")}
                        </p>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-3 rounded-xl border border-neutral-900 bg-black/35 px-3 py-2 text-xs">
                          <span className="text-neutral-500">{t("contextComposerPage.details.version")}</span>
                          <span className="max-w-[62%] truncate font-medium text-white">
                            {preview.fileSelection.diagnostics?.selectorVersion ?? t("contextComposerPage.details.notReported")}
                          </span>
                        </div>

                        <div className="flex items-center justify-between gap-3 rounded-xl border border-neutral-900 bg-black/35 px-3 py-2 text-xs">
                          <span className="text-neutral-500">{t("contextComposerPage.details.profile")}</span>
                          <span className="max-w-[62%] truncate font-medium text-white">
                            {preview.fileSelection.diagnostics?.safetyProfile ?? t("contextComposerPage.details.unknown")}
                          </span>
                        </div>

                        <div className="flex items-center justify-between gap-3 rounded-xl border border-neutral-900 bg-black/35 px-3 py-2 text-xs">
                          <span className="text-neutral-500">{t("contextComposerPage.details.mode")}</span>
                          <span className="font-medium text-white">
                            {preview.fileSelection.diagnostics?.generationMode ?? preview.fileSelection.source}
                          </span>
                        </div>

                        <div className="flex items-center justify-between gap-3 rounded-xl border border-neutral-900 bg-black/35 px-3 py-2 text-xs">
                          <span className="text-neutral-500">{t("contextComposerPage.details.model")}</span>
                          <span className="max-w-[62%] truncate font-medium text-white">
                            {preview.fileSelection.diagnostics?.model ?? t("contextComposerPage.details.templateFallback")}
                          </span>
                        </div>

                        <div className="flex items-center justify-between gap-3 rounded-xl border border-neutral-900 bg-black/35 px-3 py-2 text-xs">
                          <span className="text-neutral-500">{t("contextComposerPage.details.selector")}</span>
                          <span className="font-medium text-white">
                            {preview.fileSelection.source}
                            {preview.fileSelection.usedFallback ? ` ${t("contextComposerPage.details.fallback")}` : ""}
                          </span>
                        </div>
                      </div>
                    </article>

                    <article
                      className={[
                        "rounded-2xl border p-4",
                        selectedPaths.length === 0 ||
                          preview.fileSelection.rejectedModelPaths.length > 0
                          ? "border-red-400/20 bg-red-400/5"
                          : "border-neutral-900 bg-black/40"
                      ].join(" ")}
                    >
                      <div className="mb-3 flex items-center gap-2">
                        <AlertTriangle
                          size={15}
                          className={
                            selectedPaths.length === 0 ||
                              preview.fileSelection.rejectedModelPaths.length > 0
                              ? "text-red-300"
                              : "text-neutral-500"
                          }
                        />
                        <p className="text-sm font-semibold text-white">
                          {t("contextComposerPage.details.validation")}
                        </p>
                      </div>

                      {selectedPaths.length === 0 ? (
                        <p className="text-xs leading-5 text-red-200/75">
                          {t("contextComposerPage.details.validationNoFiles")}
                        </p>
                      ) : preview.fileSelection.rejectedModelPaths.length > 0 ? (
                        <div className="max-h-[150px] space-y-2 overflow-y-auto pr-1">
                          {preview.fileSelection.rejectedModelPaths.map((item) => (
                            <p
                              key={item}
                              className="truncate rounded-xl border border-red-400/10 bg-black/30 px-3 py-2 text-xs text-red-200/80"
                            >
                              {item}
                            </p>
                          ))}
                        </div>
                      ) : preview.selectionQuality.status !== "ready" ? (
                        <div className="max-h-[150px] space-y-2 overflow-y-auto pr-1">
                          {[...preview.selectionQuality.blockingReasons, ...preview.selectionQuality.warnings].map((item) => (
                            <p
                              key={item}
                              className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs leading-5 text-neutral-400"
                            >
                              {item}
                            </p>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs leading-5 text-neutral-500">
                          {t("contextComposerPage.details.validationReady")}
                        </p>
                      )}
                    </article>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </main>
      </div>
    </section>
  );
}
