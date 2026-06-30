import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
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

      <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
        {label}
      </p>

      <p className="cf-display-font mt-1 truncate text-2xl font-semibold text-white">
        {value}
      </p>

      <p className="mt-1 truncate text-xs text-neutral-600">
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
      whileHover={{ y: -1 }}
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
  manualLabel = "Manually reviewed",
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
          aria-label={isSelected ? "Exclude file" : "Include file"}
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
                {manualLabel}
              </span>
            )}
          </div>

          <p className="truncate text-xs text-neutral-600">
            {file.kind} · {file.usage} · {formatFileSize(file.sizeBytes)}
          </p>
        </div>
      </div>

      <p className="line-clamp-2 text-xs leading-5 text-neutral-500">
        {file.reason}
      </p>

      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="rounded-full border border-neutral-900 bg-neutral-950 px-2 py-1 text-[11px] text-neutral-500">
          {formatPercent(file.confidence)}
        </span>

        <div className="flex items-center gap-2">
          {isManual && onRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="inline-flex h-7 items-center gap-1.5 rounded-full border border-red-400/20 bg-red-400/5 px-2.5 text-[11px] text-red-200 transition hover:border-white hover:bg-white hover:text-black"
            >
              <Trash2 size={12} />
              Remove
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
            {isSelected ? "Included" : "Include"}
          </button>

          <button
            type="button"
            onClick={onCopy}
            className="cf-invert-action inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11px]"
          >
            {isCopied ? <Check size={12} /> : <Clipboard size={12} />}
            {isCopied ? "Copied" : "Path"}
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
          <p className="truncate text-[11px] text-neutral-600">{caption}</p>
        </div>

        <span className="rounded-full border border-neutral-900 bg-neutral-950 px-2 py-1 text-[10px] text-neutral-500">
          {count}
        </span>
      </div>

      {count === 0 ? (
        <div className="rounded-2xl border border-neutral-900 bg-black/25 p-4 text-xs leading-5 text-neutral-600">
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
  const recommendedPaths = useMemo(
    () => preview.selectedFiles.map((file) => file.path),
    [preview.selectedFiles]
  );

  const isBlockedReview = preview.selectionQuality.status === "blocked";
  const initialSelectedPaths = useMemo(
    () => (isBlockedReview ? [] : recommendedPaths),
    [isBlockedReview, recommendedPaths]
  );
  const initialFileSearchMessage = isBlockedReview
    ? "Automatic file selection was blocked. Search and add the real page/component/service files manually."
    : "Search project files to add more context.";

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
    setFileSearchMessage(initialFileSearchMessage);
    setIsFileSearchOpen(isBlockedReview);
    setIsDetailsOpen(isBlockedReview);
    setConfirmedRecommendedPaths([]);
    setSelectedPaths(initialSelectedPaths);
    setActiveSnippetPath(isBlockedReview ? null : preview.snippets[0]?.relativePath ?? null);
  }, [initialFileSearchMessage, initialSelectedPaths, isBlockedReview, preview]);

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
      warnings.push("No files are included. Select at least one file before generation.");
    }

    if (isBlockedReview && selectedPaths.length > 0 && selectedManualFiles.length === 0) {
      warnings.push("Blocked review mode is active. Include at least one manually added or manually reviewed file before generating.");
    }

    if (isBlockedReview && selectedWeakAutoFiles.length > 0) {
      warnings.push("Weak auto-selected files are still included without manual review. Clear them or click Include on files you explicitly want to confirm.");
    }

    if (selectedPaths.length > 0 && selectedSnippets.length === 0) {
      warnings.push("No readable snippets are included. The Task Pack will contain references only.");
    }

    if (
      selectedFiles.length > 0 &&
      selectedStyleCount === selectedFiles.length &&
      taskText.match(/bug|fix|state|logic|behavior|ошиб|баг|логик|поведен/)
    ) {
      warnings.push("Only style files are selected for a behavior-related task.");
    }

    if (
      preview.task.effectiveTaskArea === "ui" &&
      selectedFiles.some((file) => isLikelyBackendPath(file.path)) &&
      taskText.match(/do not change backend|backend unchanged|не менять api|не трогать бэк|только ui/)
    ) {
      warnings.push("A backend-looking file is selected while backend/API changes are constrained.");
    }

    if (selectedSourceCount === 0 && selectedFiles.length > 0 && selectedStyleCount > 0) {
      warnings.push("No source component/page file is selected.");
    }

    return warnings;
  }, [
    preview.selectionQuality.blockingReasons,
    preview.selectionQuality.warnings,
    preview.task.effectiveTaskArea,
    preview.task.rawTask,
    isBlockedReview,
    selectedFiles,
    selectedManualFiles.length,
    selectedPaths.length,
    selectedSnippets.length,
    selectedWeakAutoFiles.length
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
          ? `${response.results.length} file(s) found.`
          : "No matching files found."
      );
    } catch (error) {
      setFileSearchResults([]);
      setFileSearchMessage(
        error instanceof Error ? error.message : "Failed to search project files."
      );
    } finally {
      setIsSearchingFiles(false);
    }
  }, [
    fileCandidatePaths,
    fileSearchQuery,
    isFileSearchOpen,
    preview.project.id
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
    setFileSearchMessage(`Added ${result.path}.`);
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
    setFileSearchMessage(`Removed ${path}.`);
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
                Context Composer
              </span>

              <span className="cf-badge">{preview.project.name}</span>
              <span className="cf-badge">{preview.task.effectiveTaskArea}</span>
              <span className="cf-badge">{preview.task.targetTool}</span>
            </div>

            <h1 className="text-[32px] font-semibold leading-[1.04] tracking-[-0.055em] text-white">
              Review files before generation
            </h1>

            <p className="mt-2 line-clamp-2 max-w-5xl text-sm leading-6 text-neutral-500">
              {preview.task.rawTask}
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={onClose} disabled={isLoading}>
              <ArrowLeft size={15} />
              Back to task
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
              {isLoading ? "Generating..." : isBlockedReview ? "Generate reviewed context" : "Generate from selected"}
            </Button>
          </div>
        </div>
      </div>

      {preview.selectionQuality.status !== "ready" && (
        <div
          className={[
            "rounded-[1.15rem] border p-4",
            preview.selectionQuality.status === "blocked"
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
                Context quality: {preview.selectionQuality.status} · {preview.selectionQuality.score}/100
              </p>
              <p className="mt-1 text-xs leading-5 text-neutral-400">
                ContextForge is not fully confident in the automatic file selection. Review the files, add the real page/component/service if needed, then generate from selected.
              </p>
              {isBlockedReview && (
                <p className="mt-1 text-xs leading-5 text-red-100/80">
                  Blocked mode: weak auto-selected files are shown for reference only and are not included until you explicitly include them. Manually added files are included automatically.
                </p>
              )}
              <div className="mt-3 space-y-1">
                {[...preview.selectionQuality.blockingReasons, ...preview.selectionQuality.warnings].slice(0, 4).map((item) => (
                  <p key={item} className="text-xs leading-5 text-neutral-300">
                    • {item}
                  </p>
                ))}
              </div>

              {(preview.clarifyingQuestions ?? []).length > 0 && (
                <div className="mt-3 rounded-2xl border border-white/10 bg-black/25 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
                    Clarify before generating
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
          label="Included"
          value={`${selectedFiles.length}/${fileCandidates.length}`}
          caption="manual review"
        />

        <StatCard
          icon={<Code2 size={15} />}
          label="Snippets"
          value={selectedSnippets.length}
          caption="readable files"
        />

        <StatCard
          icon={<Layers3 size={15} />}
          label="Manual"
          value={selectedManualFiles.length}
          caption="added files"
        />

        <StatCard
          icon={<Gauge size={15} />}
          label="Confidence"
          value={formatPercent(preview.taskIntent.confidence)}
          caption={preview.taskIntent.source}
        />

        <StatCard
          icon={<ShieldCheck size={15} />}
          label="Quality"
          value={`${preview.selectionQuality.score}/100`}
          caption={preview.selectionQuality.status}
        />
      </div>

      <div className="grid min-h-[720px] gap-5 xl:grid-cols-[430px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-[1.35rem] border border-neutral-900 bg-black/35 p-4">
          <div className="mb-4 flex shrink-0 items-start justify-between gap-4">
            <div>
              <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                File candidates
              </p>

              <h2 className="mt-1 text-base font-semibold text-white">
                Include / Exclude
              </h2>
            </div>

            <span className="cf-badge">
              {selectedFiles.length}/{fileCandidates.length}
            </span>
          </div>

          <div className="mb-3 flex shrink-0 flex-wrap gap-2">
            <ComposerActionButton
              icon={<RotateCcw size={13} />}
              label={isBlockedReview ? "Confirm auto" : "Recommended"}
              danger={isBlockedReview}
              onClick={selectRecommendedPaths}
            />

            <ComposerActionButton
              icon={<CheckCircle2 size={13} />}
              label={isBlockedReview ? "Confirm all" : "Select all"}
              danger={isBlockedReview}
              onClick={selectAllPaths}
            />

            <ComposerActionButton
              icon={<XCircle size={13} />}
              label={isBlockedReview ? "Clear weak" : "Clear"}
              danger
              onClick={clearSelectedPaths}
            />

            <ComposerActionButton
              icon={<Plus size={13} />}
              label="Add file"
              active={isFileSearchOpen}
              onClick={() => setIsFileSearchOpen((current) => !current)}
            />
          </div>

          {isBlockedReview && (
            <div className="mb-3 rounded-2xl border border-red-400/15 bg-red-400/5 px-3 py-2 text-xs leading-5 text-red-100/75">
              Auto-selection is intentionally cleared. Add the real file through search, or explicitly include recommended files you have reviewed.
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
                      placeholder="Search files, paths, components..."
                      className="h-9 min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-neutral-700"
                    />

                    {isSearchingFiles && (
                      <Loader2
                        size={14}
                        className="shrink-0 animate-spin text-neutral-500"
                      />
                    )}
                  </div>

                  <p className="mt-2 text-[11px] text-neutral-600">
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
                            Add
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
              title={isBlockedReview ? "Weak file suggestions" : "Suggested target files"}
              caption={
                isBlockedReview
                  ? "Automatic selection was blocked. These are search hints only; include a file only after you confirm it is the real target."
                  : "Task-aware candidates ranked from real inventory paths, roles, symbols, hints, and snippets. Include the real target files first."
              }
              count={suggestedCandidateFiles.length}
              emptyText={
                isBlockedReview
                  ? "No weak suggestions were produced. Use search to find the real file."
                  : "No target suggestions were produced. Use search to find the real file."
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
                      manualLabel="Reviewed"
                      isCopied={isCopied}
                      onToggle={() => togglePath(file.path)}
                      onCopy={() => copyPath(file.path)}
                    />
                  );
                })}
              </AnimatePresence>
            </FileCandidateSection>

            <FileCandidateSection
              title="Recommended context"
              caption={
                isBlockedReview
                  ? "Auto-selected files are reference-only until you explicitly include them."
                  : "Selected by ContextForge from project inventory."
              }
              count={recommendedFiles.length}
              emptyText="No recommended files were selected."
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
                      manualLabel="Reviewed"
                      isCopied={isCopied}
                      onToggle={() => togglePath(file.path)}
                      onCopy={() => copyPath(file.path)}
                    />
                  );
                })}
              </AnimatePresence>
            </FileCandidateSection>

            <FileCandidateSection
              title="Added manually"
              caption="Extra files you added through search."
              count={manuallyAddedFiles.length}
              emptyText="No manual files yet. Use Add file when the initial context misses something."
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
                      manualLabel="Added manually"
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
                Snippet preview
              </p>

              <h2 className="mt-1 text-base font-semibold text-white">
                Included context snippets
              </h2>
            </div>

            <span className="cf-badge">
              {activeSnippet?.language ?? "no snippet"}
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
                    whileHover={{ y: -1 }}
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
                    ? "\n\n/* Snippet truncated. Inspect the full file before editing. */"
                    : ""}
                </motion.pre>
              </AnimatePresence>
            ) : (
              <div className="flex h-full items-center justify-center rounded-xl bg-neutral-950/55 p-8 text-center">
                <div>
                  <XCircle size={22} className="mx-auto text-neutral-600" />
                  <p className="mt-3 text-sm font-medium text-white">
                    No snippets included
                  </p>
                  <p className="mt-1 text-sm text-neutral-500">
                    Include a readable text file to preview its snippet here.
                  </p>
                </div>
              </div>
            )}
          </div>

          <section className="mt-4 shrink-0 rounded-2xl border border-neutral-900 bg-black/35 p-4">
            <div className="mb-3 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-white">
                  Final context summary
                </p>
                <p className="mt-1 text-xs text-neutral-600">
                  Quick check before Task Pack generation.
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
                {finalWarnings.length > 0 ? `${finalWarnings.length} warning(s)` : "Ready"}
              </span>
            </div>

            <div className="grid gap-2 md:grid-cols-4">
              <div className="rounded-xl border border-neutral-900 bg-black/35 px-3 py-2">
                <p className="text-[10px] uppercase tracking-[0.16em] text-neutral-700">
                  Files
                </p>
                <p className="mt-1 text-sm font-semibold text-white">
                  {selectedFiles.length}
                </p>
              </div>

              <div className="rounded-xl border border-neutral-900 bg-black/35 px-3 py-2">
                <p className="text-[10px] uppercase tracking-[0.16em] text-neutral-700">
                  Snippets
                </p>
                <p className="mt-1 text-sm font-semibold text-white">
                  {selectedSnippets.length}
                </p>
              </div>

              <div className="rounded-xl border border-neutral-900 bg-black/35 px-3 py-2">
                <p className="text-[10px] uppercase tracking-[0.16em] text-neutral-700">
                  Manual
                </p>
                <p className="mt-1 text-sm font-semibold text-white">
                  {selectedManualFiles.length}
                </p>
              </div>

              <div className="rounded-xl border border-neutral-900 bg-black/35 px-3 py-2">
                <p className="text-[10px] uppercase tracking-[0.16em] text-neutral-700">
                  Area
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
                    Composer details
                  </span>

                  <span className="block truncate text-xs text-neutral-600 transition group-hover:text-black/55">
                    Intent, safety notes and rejected paths
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
                          Intent
                        </p>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-3 rounded-xl border border-neutral-900 bg-black/35 px-3 py-2 text-xs">
                          <span className="text-neutral-600">Area</span>
                          <span className="font-medium text-white">
                            {preview.taskIntent.taskArea}
                          </span>
                        </div>

                        <div className="flex items-center justify-between gap-3 rounded-xl border border-neutral-900 bg-black/35 px-3 py-2 text-xs">
                          <span className="text-neutral-600">Risk</span>
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
                          <span className="text-neutral-600">Source</span>
                          <span className="font-medium text-white">
                            {preview.taskIntent.source}
                          </span>
                        </div>

                        {preview.taskIntent.structuredIntent && (
                          <div className="rounded-xl border border-neutral-900 bg-black/35 px-3 py-2 text-xs">
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-neutral-600">Structured</span>
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
                                <p className="text-[11px] leading-4 text-neutral-600">
                                  no primary target
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
                          Safety notes
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
                          Validation
                        </p>
                      </div>

                      {selectedPaths.length === 0 ? (
                        <p className="text-xs leading-5 text-red-200/75">
                          Include at least one file before generating the Task Pack.
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
                          Selected files are ready for Task Pack generation.
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
