import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bot,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  FileText,
  Gauge,
  Layers3,
  Network,
  ScanSearch,
  ShieldCheck,
  Sparkles,
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
import type { ContextComposerNavigationState } from "../types/navigation";
import type { QuickPeekTarget } from "../types/quickPeek";
import type { InspectorTarget } from "../types/inspector";
import { ContextComposerEnginePanel } from "../components/contextComposer/ContextComposerEnginePanel";
import { ContextBasketPanel } from "../components/contextComposer/ContextBasketPanel";
import { ContextFilesWorkspace, type ContextFilesWorkspaceItem } from "../components/contextComposer/contextFiles/ContextFilesWorkspace";
import { ContextFileSearchPalette } from "../components/contextComposer/contextFiles/ContextFileSearchPalette";
import {
  usesLegacySelectorSemantics,
} from "../components/contextComposer/ContextComposerUiSemantics";
import { Button } from "../components/ui/Button";
import { HorizontalSlidingSelector } from "../components/ui/SlidingSelectors";
import {
  classifyContextBasketDrop,
  hasContextForgeProjectFileDrag,
  readContextForgeDragPayload,
} from "../utils/dragAndDrop";

type ContextComposerWorkspaceTab = "files" | "snippets" | "review";
type BasketDropFeedback = {
  tone: "success" | "warning" | "error";
  message: string;
};

interface ContextComposerPageProps {
  preview: ContextComposerPreview;
  isLoading?: boolean;
  navigationState?: ContextComposerNavigationState | null;
  onNavigationStateChange?: (state: ContextComposerNavigationState) => void;
  onQuickPeekFile?: (target: QuickPeekTarget) => void;
  onInspectTarget?: (target: InspectorTarget) => void;
  onExplainContext?: () => void;
  onOpenContextMap?: () => void;
  onClose: () => void;
  onGenerate: (selectedFilePaths: string[]) => void;
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

const REVIEW_DIAGNOSTIC_TRANSLATION_KEYS: Record<string, string> = {
  "No real project files were selected for this task.":
    "contextComposerPage.reviewDiagnostics.noRealProjectFiles",
  "The task mentions an explicit file path that exists in inventory, but it was not selected as context.":
    "contextComposerPage.reviewDiagnostics.explicitPathNotSelected",
  "Context Engine v2 blocked automatic candidates at the repository safety boundary.":
    "contextComposerPage.reviewDiagnostics.engineSafetyBoundary",
  "No source file that could support full-stack work was selected.":
    "contextComposerPage.reviewDiagnostics.noFullStackSource",
  "Selected files do not clearly match the meaningful words from the task or the dynamic inventory hints.":
    "contextComposerPage.reviewDiagnostics.taskMismatch",
  "Search for the exact page, component, form, service, or route before generating.":
    "contextComposerPage.reviewDiagnostics.searchExactTarget",
};

function getReviewDiagnosticTranslationKey(value: string) {
  return REVIEW_DIAGNOSTIC_TRANSLATION_KEYS[value] ?? null;
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

export function ContextComposerPage({
  preview,
  isLoading = false,
  navigationState = null,
  onNavigationStateChange,
  onQuickPeekFile,
  onInspectTarget,
  onExplainContext,
  onOpenContextMap,
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
  const reviewReasons = [
    ...preview.selectionQuality.blockingReasons,
    ...preview.selectionQuality.warnings
  ].filter((item, index, items) => items.indexOf(item) === index);
  const reviewNextActions = [
    ...(selectorAbstention?.nextActions ?? []),
    ...(preview.selectionQuality.signals?.nextActions ?? [])
  ].filter((item, index, items) => items.indexOf(item) === index);
  const localizedPrimaryReasons = reviewReasons.flatMap((item) => {
    const key = getReviewDiagnosticTranslationKey(item);
    return key ? [{ raw: item, label: t(key) }] : [];
  });
  const localizedNextActions = reviewNextActions.flatMap((item) => {
    const key = getReviewDiagnosticTranslationKey(item);
    return key ? [{ raw: item, label: t(key) }] : [];
  });
  const displayReviewDiagnostic = (item: string) => {
    const key = getReviewDiagnosticTranslationKey(item);
    return key ? t(key) : item;
  };
  const initialFileSearchMessage = isAbstentionReview
    ? t("contextComposerPage.search.initialAbstention", { hint: targetCopy.searchHint })
    : isBlockedReview
      ? t("contextComposerPage.search.initialBlocked", { hint: targetCopy.searchHint })
      : t("contextComposerPage.search.initialReady", { target: targetCopy.target });

  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [extraFiles, setExtraFiles] = useState<ContextComposerFileReference[]>(
    () => navigationState?.extraFiles ?? []
  );
  const [extraSnippets, setExtraSnippets] = useState<ContextComposerSnippet[]>(
    () => navigationState?.extraSnippets ?? []
  );
  const [isFileSearchOpen, setIsFileSearchOpen] = useState(
    () => navigationState?.isFileSearchOpen ?? false
  );
  const [fileSearchQuery, setFileSearchQuery] = useState(
    () => navigationState?.fileSearchQuery ?? ""
  );
  const [fileSearchResults, setFileSearchResults] = useState<
    ContextComposerFileSearchResult[]
  >([]);
  const [isSearchingFiles, setIsSearchingFiles] = useState(false);
  const [fileSearchMessage, setFileSearchMessage] = useState(initialFileSearchMessage);
  const [selectedPaths, setSelectedPaths] = useState<string[]>(
    () => navigationState?.selectedPaths ?? initialSelectedPaths
  );
  const [confirmedRecommendedPaths, setConfirmedRecommendedPaths] = useState<string[]>(
    () => navigationState?.confirmedRecommendedPaths ?? []
  );
  const [activeSnippetPath, setActiveSnippetPath] = useState<string | null>(
    () =>
      navigationState?.activeSnippetPath ??
      (isBlockedReview ? null : preview.snippets[0]?.relativePath ?? null)
  );
  const [isDetailsOpen, setIsDetailsOpen] = useState(
    () => navigationState?.isDetailsOpen ?? false
  );
  const [isReviewTechnicalDetailsOpen, setIsReviewTechnicalDetailsOpen] = useState(false);
  const [isSummaryWarningsOpen, setIsSummaryWarningsOpen] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState<ContextComposerWorkspaceTab>("files");
  const [isContextBasketOpen, setIsContextBasketOpen] = useState(false);
  const [isProjectFileDragNearby, setIsProjectFileDragNearby] = useState(false);
  const [isBasketDropActive, setIsBasketDropActive] = useState(false);
  const [basketDropFeedback, setBasketDropFeedback] =
    useState<BasketDropFeedback | null>(null);
  const basketDragDepthRef = useRef(0);
  const previousPreviewRef = useRef(preview);

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

  const recommendedPathSet = useMemo(() => {
    return new Set(recommendedPaths.map(normalizeFileKey));
  }, [recommendedPaths]);

  const explicitTargetPaths = useMemo(() => {
    return (preview.taskIntent.structuredIntent?.primaryTargets ?? [])
      .map((target) => target.path)
      .filter((path): path is string => typeof path === "string" && path.length > 0);
  }, [preview.taskIntent.structuredIntent]);

  const explicitTargetPathSet = useMemo(() => {
    return new Set(
      explicitTargetPaths.map((path) => path.replace(/\\/g, "/").replace(/^\.\/+/, ""))
    );
  }, [explicitTargetPaths]);

  const fileCandidates = useMemo(() => {
    return mergeFilesByPath([...suggestedFiles, ...preview.selectedFiles, ...extraFiles]);
  }, [preview.selectedFiles, extraFiles, suggestedFiles]);

  const snippetCandidates = useMemo(() => {
    return mergeSnippetsByPath([...preview.snippets, ...extraSnippets]);
  }, [preview.snippets, extraSnippets]);

  const fileCandidatePaths = useMemo(() => {
    return fileCandidates.map((file) => file.path);
  }, [fileCandidates]);

  const contextEngineFileByPath = useMemo(() => {
    return new Map(
      (preview.contextEngine?.files ?? []).map((file) => [
        normalizeFileKey(file.path),
        file,
      ]),
    );
  }, [preview.contextEngine]);

  useEffect(() => {
    if (previousPreviewRef.current === preview) {
      return;
    }

    previousPreviewRef.current = preview;
    setExtraFiles(navigationState?.extraFiles ?? []);
    setExtraSnippets(navigationState?.extraSnippets ?? []);
    setFileSearchQuery(navigationState?.fileSearchQuery ?? "");
    setFileSearchResults([]);
    setIsFileSearchOpen(navigationState?.isFileSearchOpen ?? false);
    setIsDetailsOpen(navigationState?.isDetailsOpen ?? false);
    setIsReviewTechnicalDetailsOpen(false);
    setIsSummaryWarningsOpen(false);
    setWorkspaceTab("files");
    setIsContextBasketOpen(false);
    setIsProjectFileDragNearby(false);
    setIsBasketDropActive(false);
    setBasketDropFeedback(null);
    basketDragDepthRef.current = 0;
    setConfirmedRecommendedPaths(
      navigationState?.confirmedRecommendedPaths ?? []
    );
    setSelectedPaths(
      navigationState?.selectedPaths ?? initialSelectedPaths
    );
    setActiveSnippetPath(
      navigationState?.activeSnippetPath ??
        (isBlockedReview ? null : preview.snippets[0]?.relativePath ?? null)
    );
  }, [initialSelectedPaths, isBlockedReview, navigationState, preview]);

  useEffect(() => {
    setFileSearchMessage(initialFileSearchMessage);
  }, [initialFileSearchMessage, preview]);

  useEffect(() => {
    function handleDragStart(event: DragEvent) {
      if (
        event.dataTransfer &&
        hasContextForgeProjectFileDrag(event.dataTransfer)
      ) {
        setIsProjectFileDragNearby(true);
      }
    }

    function clearDragState() {
      basketDragDepthRef.current = 0;
      setIsProjectFileDragNearby(false);
      setIsBasketDropActive(false);
    }

    window.addEventListener("dragstart", handleDragStart);
    window.addEventListener("dragend", clearDragState);
    window.addEventListener("drop", clearDragState);

    return () => {
      window.removeEventListener("dragstart", handleDragStart);
      window.removeEventListener("dragend", clearDragState);
      window.removeEventListener("drop", clearDragState);
    };
  }, []);

  useEffect(() => {
    if (!basketDropFeedback) return;

    const timeout = window.setTimeout(() => {
      setBasketDropFeedback(null);
    }, 2600);

    return () => window.clearTimeout(timeout);
  }, [basketDropFeedback]);

  useEffect(() => {
    onNavigationStateChange?.({
      extraFiles,
      extraSnippets,
      isFileSearchOpen,
      fileSearchQuery,
      selectedPaths,
      confirmedRecommendedPaths,
      activeSnippetPath,
      isDetailsOpen,
    });
  }, [
    activeSnippetPath,
    confirmedRecommendedPaths,
    extraFiles,
    extraSnippets,
    fileSearchQuery,
    isDetailsOpen,
    isFileSearchOpen,
    onNavigationStateChange,
    selectedPaths,
  ]);

  const selectedPathSet = useMemo(() => {
    return new Set(selectedPaths);
  }, [selectedPaths]);

  const contextFileWorkspaceItems = useMemo<ContextFilesWorkspaceItem[]>(() => {
    return fileCandidates.map((file) => {
      const key = normalizeFileKey(file.path);
      const structuralPath = file.path.replace(/\\/g, "/").replace(/^\.\/+/, "");

      return {
        file,
        selected: selectedPathSet.has(file.path),
        manual: manualPathSet.has(key),
        suggested: suggestedPathSet.has(key),
        recommended: recommendedPathSet.has(key),
        reviewed: confirmedRecommendedPathSet.has(key),
        explicitTarget: explicitTargetPathSet.has(structuralPath),
      };
    });
  }, [
    confirmedRecommendedPathSet,
    explicitTargetPathSet,
    fileCandidates,
    manualPathSet,
    recommendedPathSet,
    selectedPathSet,
    suggestedPathSet,
  ]);

  const selectedFiles = useMemo(() => {
    return fileCandidates.filter((file) => selectedPathSet.has(file.path));
  }, [fileCandidates, selectedPathSet]);

  const selectedContextBasketItems = useMemo(() => {
    return selectedFiles.map((file) => {
      const key = normalizeFileKey(file.path);
      const structuralPath = file.path.replace(/\\/g, "/").replace(/^\.\/+/, "");

      return {
        file,
        manual: manualPathSet.has(key),
        reviewed: confirmedRecommendedPathSet.has(key),
        explicitTarget: explicitTargetPathSet.has(structuralPath),
      };
    });
  }, [
    confirmedRecommendedPathSet,
    explicitTargetPathSet,
    manualPathSet,
    selectedFiles,
  ]);

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

  const canGenerate =
    !isLoading &&
    selectedPaths.length > 0 &&
    (!isBlockedReview || selectedManualFiles.length > 0);

  const workspaceTabs = [
    {
      id: "files" as const,
      label: t("contextComposerPage.workspace.files"),
      description: t("contextComposerPage.workspace.filesDescription"),
      count: selectedFiles.length,
      icon: FileText,
    },
    {
      id: "snippets" as const,
      label: t("contextComposerPage.workspace.snippets"),
      description: t("contextComposerPage.workspace.snippetsDescription"),
      count: selectedSnippets.length,
      icon: Sparkles,
    },
    {
      id: "review" as const,
      label: t("contextComposerPage.workspace.review"),
      description: t("contextComposerPage.workspace.reviewDescription"),
      count: finalWarnings.length,
      icon: ShieldCheck,
    },
  ];
  const workspaceTabIndex = Math.max(
    0,
    workspaceTabs.findIndex((tab) => tab.id === workspaceTab)
  );

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

  function openFileSearch(query = "") {
    setFileSearchQuery(query);
    setFileSearchResults([]);
    setFileSearchMessage(initialFileSearchMessage);
    setIsFileSearchOpen(true);
  }

  function closeFileSearch() {
    setIsFileSearchOpen(false);
  }

  function includeKnownFile(path: string) {
    setSelectedPaths((current) =>
      current.includes(path) ? current : [...current, path]
    );
    if (isBlockedReview) {
      setConfirmedRecommendedPaths((current) =>
        current.includes(path) ? current : [...current, path]
      );
    }
  }

  async function addFileFromSearch(result: ContextComposerFileSearchResult) {
    if (fileCandidates.some((file) => file.path === result.path)) {
      includeKnownFile(result.path);
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

    setFileSearchQuery("");
    setFileSearchResults([]);
    setFileSearchMessage(t("contextComposerPage.search.added", { path: result.path }));
  }

  async function addProjectFileFromDrop(
    event: ReactDragEvent<HTMLButtonElement>,
  ) {
    event.preventDefault();
    basketDragDepthRef.current = 0;
    setIsBasketDropActive(false);

    const payload = readContextForgeDragPayload(event.dataTransfer);
    if (!payload) {
      setBasketDropFeedback({
        tone: "error",
        message: t("dragAndDrop.invalidInternalPayload"),
      });
      return;
    }

    if (isLoading) {
      setBasketDropFeedback({
        tone: "warning",
        message: t("dragAndDrop.workspaceBusy"),
      });
      return;
    }

    const classification = classifyContextBasketDrop({
      payload,
      projectId: preview.project.id,
      selectedPaths,
      knownPaths: fileCandidatePaths,
    });

    if (classification.status === "wrong-project") {
      setBasketDropFeedback({
        tone: "error",
        message: t("dragAndDrop.wrongProject"),
      });
      return;
    }

    if (classification.status === "already-selected") {
      setBasketDropFeedback({
        tone: "warning",
        message: t("dragAndDrop.alreadySelected", {
          path: classification.path,
        }),
      });
      setIsContextBasketOpen(true);
      return;
    }

    if (classification.status === "known-file") {
      includeKnownFile(classification.path);
      setBasketDropFeedback({
        tone: "success",
        message: t("dragAndDrop.addedToBasket", {
          path: classification.path,
        }),
      });
      setIsContextBasketOpen(true);
      return;
    }

    setBasketDropFeedback({
      tone: "warning",
      message: t("dragAndDrop.validatingFile"),
    });

    try {
      const response = await readContextComposerFileSnippet({
        projectId: preview.project.id,
        filePath: classification.path,
      });

      setExtraFiles((current) =>
        mergeFilesByPath([...current, response.file])
      );
      includeKnownFile(response.file.path);

      if (response.snippet) {
        setExtraSnippets((current) =>
          mergeSnippetsByPath([...current, response.snippet!])
        );
        setActiveSnippetPath(response.snippet.relativePath);
      }

      setBasketDropFeedback({
        tone: "success",
        message: t("dragAndDrop.addedToBasket", {
          path: response.file.path,
        }),
      });
      setIsContextBasketOpen(true);
    } catch {
      setBasketDropFeedback({
        tone: "error",
        message: t("dragAndDrop.fileRejected"),
      });
    }
  }

  function handleBasketDragEnter(
    event: ReactDragEvent<HTMLButtonElement>,
  ) {
    if (!hasContextForgeProjectFileDrag(event.dataTransfer)) return;

    event.preventDefault();
    basketDragDepthRef.current += 1;
    setIsBasketDropActive(true);
  }

  function handleBasketDragLeave(
    event: ReactDragEvent<HTMLButtonElement>,
  ) {
    if (!hasContextForgeProjectFileDrag(event.dataTransfer)) return;

    basketDragDepthRef.current = Math.max(0, basketDragDepthRef.current - 1);
    if (basketDragDepthRef.current === 0) {
      setIsBasketDropActive(false);
    }
  }

  function handleBasketDragOver(
    event: ReactDragEvent<HTMLButtonElement>,
  ) {
    if (!hasContextForgeProjectFileDrag(event.dataTransfer)) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = isLoading ? "none" : "copy";
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

  function createFileWorkspaceTarget(
    path: string,
    line?: number,
    snippet?: string,
  ): Extract<QuickPeekTarget, { kind: "file" }> {
    const title = path.split(/[\\/]/).filter(Boolean).pop() ?? path;

    return {
      kind: "file",
      title,
      displayPath: path,
      filePath: path,
      projectId: preview.project.id,
      projectName: preview.project.name,
      line,
      snippet,
    };
  }

  function openFileQuickPeek(
    path: string,
    line?: number,
    snippet?: string,
  ) {
    if (!onQuickPeekFile) return;

    onQuickPeekFile(createFileWorkspaceTarget(path, line, snippet));
  }

  function inspectFile(
    path: string,
    line?: number,
    snippet?: string,
  ) {
    if (!onInspectTarget) return;

    onInspectTarget({
      kind: "file",
      file: createFileWorkspaceTarget(path, line, snippet),
      contextFile: contextEngineFileByPath.get(normalizeFileKey(path)),
    });
  }

  function inspectContext() {
    onInspectTarget?.({
      kind: "context",
      preview,
    });
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
            {preview.contextEngine && onExplainContext && (
              <Button
                variant="secondary"
                onClick={onExplainContext}
                disabled={isLoading}
              >
                <CircleHelp size={15} />
                {t("explainability.open")}
              </Button>
            )}

            {preview.contextEngine && onOpenContextMap && (
              <Button
                variant="secondary"
                onClick={onOpenContextMap}
                disabled={isLoading}
              >
                <Network size={15} />
                {t("explainability.contextMapOpen")}
              </Button>
            )}

            {onInspectTarget && (
              <Button
                variant="secondary"
                onClick={inspectContext}
                disabled={isLoading}
              >
                <ScanSearch size={15} />
                {t("inspector.inspect")} · {t("inspector.context")}
              </Button>
            )}

            <Button variant="secondary" onClick={onClose} disabled={isLoading}>
              <ArrowLeft size={15} />
              {t("contextComposerPage.header.backToTask")}
            </Button>

          </div>
        </div>
      </div>

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
            <div className="min-w-0 flex-1">
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

              {isBlockedReview ? (
                <>
                  <div className="mt-3 grid gap-2 lg:grid-cols-2">
                    <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
                        {t("contextComposerPage.review.primaryReasons")}
                      </p>
                      <div className="mt-2 space-y-1">
                        {localizedPrimaryReasons.length > 0 ? (
                          localizedPrimaryReasons.slice(0, 3).map((item) => (
                            <p key={item.raw} className="text-xs leading-5 text-neutral-300">
                              • {item.label}
                            </p>
                          ))
                        ) : (
                          <p className="text-xs leading-5 text-neutral-500">
                            {reviewReasons.length > 0
                              ? t("contextComposerPage.review.technicalReasonAvailable")
                              : t("contextComposerPage.review.noPrimaryReasons")}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
                        {t("contextComposerPage.review.whatToDo")}
                      </p>
                      <div className="mt-2 space-y-1">
                        {localizedNextActions.length > 0 ? (
                          localizedNextActions.slice(0, 2).map((item) => (
                            <p key={item.raw} className="text-xs leading-5 text-neutral-300">
                              • {item.label}
                            </p>
                          ))
                        ) : (
                          <p className="text-xs leading-5 text-neutral-400">
                            {targetCopy.reviewHint}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <p className={[
                      "text-[11px] leading-5",
                      isAbstentionReview ? "text-amber-100/70" : "text-red-100/70"
                    ].join(" ")}>
                      {isAbstentionReview
                        ? t("contextComposerPage.review.targetConfirmationMode")
                        : t("contextComposerPage.review.blockedSummary")}
                    </p>

                    <button
                      type="button"
                      onClick={() => setIsReviewTechnicalDetailsOpen((value) => !value)}
                      aria-expanded={isReviewTechnicalDetailsOpen}
                      aria-controls="context-composer-review-technical-details"
                      className="inline-flex h-8 shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 text-[11px] font-semibold text-neutral-300 outline-none transition hover:border-white/20 hover:text-white focus-visible:ring-1 focus-visible:ring-white/40"
                    >
                      <ChevronDown
                        size={13}
                        className={[
                          "transition-transform",
                          isReviewTechnicalDetailsOpen ? "rotate-180" : ""
                        ].join(" ")}
                      />
                      {isReviewTechnicalDetailsOpen
                        ? t("contextComposerPage.review.hideTechnicalDetails")
                        : t("contextComposerPage.review.showTechnicalDetails")}
                    </button>
                  </div>

                  <AnimatePresence initial={false}>
                    {isReviewTechnicalDetailsOpen && (
                      <motion.div
                        id="context-composer-review-technical-details"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.16 }}
                        className="overflow-hidden"
                      >
                        <div className="mt-3 space-y-3 border-t border-white/10 pt-3">
                          <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
                              {t("contextComposerPage.review.technicalReasons")}
                            </p>
                            <p className="mt-2 text-xs leading-5 text-neutral-500">
                              {isAbstentionReview
                                ? t("contextComposerPage.review.targetConfirmationMode")
                                : t("contextComposerPage.review.blockedMode")}
                            </p>
                            {reviewReasons.length > 0 && (
                              <div className="mt-2 space-y-1">
                                {reviewReasons.map((item) => (
                                  <p key={item} className="text-xs leading-5 text-neutral-300">
                                    • {item}
                                  </p>
                                ))}
                              </div>
                            )}
                          </div>

                          {showsLegacyQuality && preview.selectionQuality.signals && (
                            <div className="grid gap-2 sm:grid-cols-4">
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

                          {reviewNextActions.length > 0 && (
                            <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
                                {t("contextComposerPage.review.nextActions")}
                              </p>
                              <div className="mt-2 space-y-1">
                                {reviewNextActions.map((item) => (
                                  <p key={item} className="text-xs leading-5 text-neutral-300">
                                    • {item}
                                  </p>
                                ))}
                              </div>
                            </div>
                          )}

                          {(preview.clarifyingQuestions ?? []).length > 0 && (
                            <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
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
                      </motion.div>
                    )}
                  </AnimatePresence>
                </>
              ) : (
                <>
                  <div className="mt-3 space-y-1">
                    {reviewReasons.slice(0, 4).map((item) => (
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

                  {reviewNextActions.length > 0 && (
                    <div className="mt-3 rounded-2xl border border-white/10 bg-black/25 p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
                        {t("contextComposerPage.review.nextActions")}
                      </p>
                      <div className="mt-2 space-y-1">
                        {reviewNextActions.map((item) => (
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
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {preview.contextEngine && (
        <ContextComposerEnginePanel
          view={preview.contextEngine}
          onQuickPeekFile={openFileQuickPeek}
          onInspectFile={(file) =>
            onInspectTarget?.({
              kind: "file",
              file: createFileWorkspaceTarget(file.path),
              contextFile: file,
            })
          }
          onInspectEvidence={(contextFile, evidence) =>
            onInspectTarget?.({
              kind: "evidence",
              projectId: preview.project.id,
              projectName: preview.project.name,
              evidence,
              contextFile,
            })
          }
        />
      )}

      <ContextFileSearchPalette
        open={isFileSearchOpen}
        query={fileSearchQuery}
        results={fileSearchResults}
        isSearching={isSearchingFiles}
        message={fileSearchMessage}
        explicitTargetPaths={explicitTargetPaths}
        onQueryChange={setFileSearchQuery}
        onAdd={(result) => {
          void addFileFromSearch(result);
        }}
        onClose={closeFileSearch}
      />

      <ContextBasketPanel
        open={isContextBasketOpen}
        files={selectedContextBasketItems}
        snippets={selectedSnippets}
        blocked={isBlockedReview}
        selectionStatus={preview.selectionQuality.status}
        onClose={() => setIsContextBasketOpen(false)}
        onRemoveFile={togglePath}
        onQuickPeekFile={(path) => {
          setIsContextBasketOpen(false);
          openFileQuickPeek(path);
        }}
        onInspectFile={(path) => {
          setIsContextBasketOpen(false);
          inspectFile(path);
        }}
        onOpenSnippet={(path) => {
          setActiveSnippetPath(path);
          setWorkspaceTab("snippets");
          setIsContextBasketOpen(false);
        }}
        onClearFiles={clearSelectedPaths}
      />

      <div className="space-y-4">
        <HorizontalSlidingSelector
          items={workspaceTabs}
          activeIndex={workspaceTabIndex}
          getItemKey={(tab) => tab.id}
          onSelect={(tab) => setWorkspaceTab(tab.id)}
          ariaLabel={t("contextComposerPage.workspace.tabsAria")}
          className="rounded-[1.35rem]"
          itemClassName="min-h-[64px] rounded-xl px-3"
          renderItem={(tab, active) => {
            const Icon = tab.icon;

            return (
              <span className="flex min-w-0 items-center gap-3">
                <span
                  className={[
                    "grid size-9 shrink-0 place-items-center rounded-xl border transition-colors duration-150",
                    active
                      ? "border-black/10 bg-black/5 text-black"
                      : "border-neutral-800 bg-neutral-950 text-neutral-600 group-hover:border-white/15 group-hover:text-white",
                  ].join(" ")}
                >
                  <Icon size={15} />
                </span>

                <span className="min-w-0 flex-1 text-left">
                  <span
                    className={[
                      "block truncate text-sm transition-colors duration-150",
                      active ? "font-semibold text-black" : "font-medium text-neutral-300 group-hover:text-white",
                    ].join(" ")}
                  >
                    {tab.label}
                  </span>
                  <span
                    className={[
                      "mt-0.5 hidden truncate text-[11px] transition-colors duration-150 md:block",
                      active ? "text-black/55" : "text-neutral-600 group-hover:text-neutral-400",
                    ].join(" ")}
                  >
                    {tab.description}
                  </span>
                </span>

                <span
                  className={[
                    "shrink-0 rounded-full border px-2 py-0.5 text-[10px] transition-colors duration-150",
                    active
                      ? "border-black/10 bg-black/5 text-black/65"
                      : "border-neutral-800 bg-neutral-950 text-neutral-600",
                  ].join(" ")}
                >
                  {tab.count}
                </span>
              </span>
            );
          }}
        />

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={workspaceTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            {workspaceTab === "files" && (
        <ContextFilesWorkspace
          projectId={preview.project.id}
          items={contextFileWorkspaceItems}
          blocked={isBlockedReview}
          abstention={isAbstentionReview}
          copiedPath={copiedPath}
          explicitTargetPaths={explicitTargetPaths}
          onOpenSearch={openFileSearch}
          onToggleFile={togglePath}
          onRemoveManualFile={removeManualFile}
          onCopyPath={(path) => {
            void copyPath(path);
          }}
          onQuickPeek={(path) => {
            const snippet = snippetCandidates.find(
              (candidate) =>
                normalizeFileKey(candidate.relativePath) === normalizeFileKey(path)
            );
            openFileQuickPeek(path, undefined, snippet?.content);
          }}
          onInspect={(path) => {
            const snippet = snippetCandidates.find(
              (candidate) =>
                normalizeFileKey(candidate.relativePath) === normalizeFileKey(path)
            );
            inspectFile(path, undefined, snippet?.content);
          }}
          onSelectRecommended={selectRecommendedPaths}
          onSelectAll={selectAllPaths}
          onClearSelection={clearSelectedPaths}
        />
            )}

            {workspaceTab === "snippets" && (
          <section className="flex min-h-0 flex-col rounded-[1.35rem] border border-neutral-900 bg-black/35 p-4">
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

          <div
            className={[
              "min-h-0 flex-1 overflow-hidden rounded-2xl border border-neutral-900 bg-black/60 p-3",
              activeSnippet ? "min-h-[360px]" : "min-h-0",
            ].join(" ")}
          >
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
              <div className="flex items-center justify-center rounded-xl bg-neutral-950/55 px-6 py-14 text-center">
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
          </section>
            )}

            {workspaceTab === "review" && (
              <div className="space-y-4">
          <section className="shrink-0 rounded-2xl border border-neutral-900 bg-black/35 p-4">
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

            {isBlockedReview ? (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-neutral-900 bg-black/35 px-3 py-2">
                <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-500">
                  {t("contextComposerPage.summary.area")}
                </span>
                <span className="text-xs font-semibold text-white">
                  {preview.task.effectiveTaskArea}
                </span>
                <span className="text-neutral-700">·</span>
                <span className="text-xs text-neutral-500">
                  {t("contextComposerPage.workspace.fileCount", { count: selectedFiles.length })}
                  {" · "}
                  {t("contextComposerPage.workspace.snippetCount", { count: selectedSnippets.length })}
                </span>
              </div>
            ) : (
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
            )}

            {isBlockedReview && finalWarnings.length > 0 && (
              <button
                type="button"
                onClick={() => setIsSummaryWarningsOpen((current) => !current)}
                aria-expanded={isSummaryWarningsOpen}
                aria-controls="context-composer-summary-warnings"
                className="mt-3 inline-flex h-8 items-center gap-2 rounded-xl border border-neutral-900 bg-black/35 px-3 text-[11px] font-semibold text-neutral-400 outline-none transition hover:border-white/20 hover:text-white focus-visible:ring-1 focus-visible:ring-white/40"
              >
                <ChevronDown
                  size={13}
                  className={[
                    "transition-transform",
                    isSummaryWarningsOpen ? "rotate-180" : ""
                  ].join(" ")}
                />
                {isSummaryWarningsOpen
                  ? t("contextComposerPage.summary.hideWarnings")
                  : t("contextComposerPage.summary.showWarnings")}
              </button>
            )}

            <AnimatePresence initial={false}>
              {finalWarnings.length > 0 && (!isBlockedReview || isSummaryWarningsOpen) && (
                <motion.div
                  id="context-composer-summary-warnings"
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
                        {displayReviewDiagnostic(warning)}
                      </p>
                    </div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </section>

          <div className="shrink-0 overflow-hidden rounded-2xl border border-neutral-900 bg-black/35">
            <button
              type="button"
              onClick={() => setIsDetailsOpen((current) => !current)}
              aria-expanded={isDetailsOpen}
              aria-controls="context-composer-details"
              className="group flex w-full items-center justify-between gap-4 px-4 py-3 text-left outline-none transition hover:bg-white hover:text-black focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white/40"
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
                    {isBlockedReview
                      ? t("contextComposerPage.details.blockedDescription")
                      : t("contextComposerPage.details.description")}
                  </span>
                </span>
              </span>

              <span className="flex shrink-0 items-center gap-2">
                {isBlockedReview && (
                  <>
                    <span className="hidden rounded-full border border-neutral-800 bg-neutral-950 px-2 py-1 text-[10px] text-neutral-400 transition group-hover:border-black/10 group-hover:bg-black/5 group-hover:text-black sm:inline-flex">
                      {preview.task.effectiveTaskArea}
                    </span>
                    <span className="hidden rounded-full border border-amber-300/20 bg-amber-300/10 px-2 py-1 text-[10px] text-amber-200 transition group-hover:border-black/10 group-hover:bg-black/5 group-hover:text-black md:inline-flex">
                      {t("contextComposerPage.details.reviewRequired")}
                    </span>
                  </>
                )}

              <motion.span
                animate={{ rotate: isDetailsOpen ? 180 : 0 }}
                transition={{ duration: 0.18 }}
                className="shrink-0"
              >
                <ChevronDown size={16} />
              </motion.span>
              </span>
            </button>

            <AnimatePresence initial={false}>
              {isDetailsOpen && (
                <motion.div
                  id="context-composer-details"
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
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        <div className="sticky bottom-3 z-20">
          <div className="flex flex-col gap-3 rounded-[1.35rem] border border-white/10 bg-neutral-950/[0.92] px-4 py-3 shadow-[0_18px_70px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-white">
                  <FileText size={13} className="text-neutral-500" />
                  {t("contextComposerPage.workspace.fileCount", { count: selectedFiles.length })}
                </span>
                <span className="text-neutral-800">·</span>
                <span className="inline-flex items-center gap-1.5 text-xs text-neutral-400">
                  <Sparkles size={13} className="text-neutral-600" />
                  {t("contextComposerPage.workspace.snippetCount", { count: selectedSnippets.length })}
                </span>
                <span className="text-neutral-800">·</span>
                <span
                  className={[
                    "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px]",
                    isBlockedReview
                      ? "border-amber-300/20 bg-amber-300/10 text-amber-200"
                      : preview.selectionQuality.status === "ready"
                        ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
                        : "border-white/15 bg-white/[0.06] text-neutral-300",
                  ].join(" ")}
                >
                  {isBlockedReview ? <AlertTriangle size={11} /> : <CheckCircle2 size={11} />}
                  {t(getSelectionStatusKey(preview.selectionQuality.status))}
                </span>
              </div>

              <p className="mt-1 truncate text-[11px] text-neutral-600">
                {basketDropFeedback ? (
                  <span
                    role="status"
                    aria-live="polite"
                    className={
                      basketDropFeedback.tone === "error"
                        ? "text-red-300/80"
                        : basketDropFeedback.tone === "success"
                          ? "text-emerald-300/80"
                          : "text-amber-200/80"
                    }
                  >
                    {basketDropFeedback.message}
                  </span>
                ) : isProjectFileDragNearby ? (
                  t("dragAndDrop.basketAvailable")
                ) : workspaceTab === "files" ? (
                  t("contextComposerPage.workspace.filesHint")
                ) : workspaceTab === "snippets" ? (
                  t("contextComposerPage.workspace.snippetsHint")
                ) : (
                  t("contextComposerPage.workspace.reviewHint")
                )}
              </p>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                onClick={() => setIsContextBasketOpen(true)}
                onDragEnter={handleBasketDragEnter}
                onDragLeave={handleBasketDragLeave}
                onDragOver={handleBasketDragOver}
                onDrop={(event) => void addProjectFileFromDrop(event)}
                data-contextforge-drop-target="context-basket-project-file"
                className={[
                  "transition-[border-color,background-color,color,box-shadow] duration-150",
                  isBasketDropActive
                    ? "border-white bg-white text-black shadow-[0_0_0_4px_rgba(255,255,255,0.08)]"
                    : isProjectFileDragNearby
                      ? "border-white/35 bg-white/[0.08] text-white"
                      : "",
                ].join(" ")}
              >
                <Layers3 size={14} />
                {isBasketDropActive
                  ? t("dragAndDrop.releaseToAdd")
                  : isProjectFileDragNearby
                    ? t("dragAndDrop.addToContext")
                    : t("contextComposerPage.basket.open")}
                <span className="rounded-full border border-white/10 bg-white/[0.05] px-1.5 py-0.5 text-[10px] text-neutral-400">
                  {selectedFiles.length}
                </span>
              </Button>

              {workspaceTab === "files" && (
                <Button
                  variant="primary"
                  onClick={() =>
                    setWorkspaceTab(selectedSnippets.length > 0 ? "snippets" : "review")
                  }
                >
                  {selectedSnippets.length > 0
                    ? t("contextComposerPage.workspace.nextSnippets")
                    : t("contextComposerPage.workspace.nextReview")}
                  <ArrowRight size={14} />
                </Button>
              )}

              {workspaceTab === "snippets" && (
                <>
                  <Button variant="secondary" onClick={() => setWorkspaceTab("files")}>
                    <ArrowLeft size={14} />
                    {t("contextComposerPage.workspace.backFiles")}
                  </Button>
                  <Button variant="primary" onClick={() => setWorkspaceTab("review")}>
                    {t("contextComposerPage.workspace.nextReview")}
                    <ArrowRight size={14} />
                  </Button>
                </>
              )}

              {workspaceTab === "review" && (
                <>
                  <Button variant="secondary" onClick={() => setWorkspaceTab("files")}>
                    <ArrowLeft size={14} />
                    {t("contextComposerPage.workspace.backFiles")}
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => onGenerate(selectedPaths)}
                    disabled={!canGenerate}
                  >
                    <WandSparkles size={14} />
                    {isLoading
                      ? t("contextComposerPage.header.generating")
                      : isBlockedReview
                        ? t("contextComposerPage.header.generateReviewed")
                        : t("contextComposerPage.header.generateSelected")}
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

    </section>
  );
}
