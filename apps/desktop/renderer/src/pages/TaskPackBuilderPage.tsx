import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  Bug,
  Check,
  CheckCircle2,
  Code2,
  Eye,
  FileText,
  GitBranch,
  PlusCircle,
  Lightbulb,
  Loader2,
  Palette,
  Repeat2,
  Rocket,
  RotateCcw,
  Search,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TestTube2,
  WandSparkles
} from "lucide-react";

import {
  getProjectGitStatus,
  getRuleProfilesCatalog,
  getTemplates,
  understandTaskPack
} from "../api/client";
import type {
  AcceptanceCriteriaPreset,
  ContextComposerFileReference,
  ContextComposerPreview,
  GitStatusResult,
  PromptTemplate,
  RuleItem,
  RuleProfile,
  TaskClarification,
  TaskPackDraft,
  TaskUnderstandingResponse,
  TemplateTaskType
} from "../types";
import { Button } from "../components/ui/Button";
import { Modal } from "../components/ui/Modal";
import { CustomSelect } from "../components/ui/CustomSelect";
import { TaskUnderstandingModal } from "../components/modals/TaskUnderstandingModal";
import { SegmentedFilter, type SegmentedFilterOption } from "../components/ui/SegmentedFilter";
import { HorizontalSlidingSelector } from "../components/ui/SlidingSelectors";
import { TARGET_TOOL_OPTIONS } from "../components/ai/aiToolOptions";
import {
  analyzeTaskPackIntent,
  evaluateTaskPackQuality,
  type TaskPackIntentResult,
  type TaskPackIntentStatus,
  type TaskPackQualityResult,
  type TaskPackQualityStatus
} from "../utils/taskPackQuality";
import {
  LOCAL_CHANGES_NOTE_HEADING,
  buildLocalChangesNote,
  mergeLocalChangesNote
} from "../utils/localChangesNote";

function createPerformanceSessionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `perf-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

interface TaskPackBuilderPageProps {
  draft: TaskPackDraft;
  isLoading: boolean;
  onChange: (draft: TaskPackDraft) => void;
  onClose: () => void;
  contextPreview?: ContextComposerPreview | null;
  onAnalyzeContext: (
    draftOverride?: TaskPackDraft
  ) => void | Promise<ContextComposerPreview | void>;
  onOpenContextComposer?: () => void | Promise<void>;
  onGenerate: (draftOverride?: TaskPackDraft) => void | Promise<void>;
}

const TASK_EXAMPLES = [
  {
    label: "UI polish",
    value:
      "Improve the selected page UI without changing backend behavior. Keep the current functionality, make the layout cleaner, add smooth interactions, and preserve the existing design system."
  },
  {
    label: "Bugfix",
    value:
      "Find and fix the issue described below. Keep the solution minimal, explain the root cause, and avoid unrelated refactoring."
  },
  {
    label: "Refactor",
    value:
      "Refactor this area to improve readability and maintainability without changing user-visible behavior. Preserve existing APIs and add notes about any risky assumptions."
  },
  {
    label: "Backend",
    value:
      "Implement the backend changes for this feature, including API behavior, validation, error handling, and any required persistence updates."
  }
];

const TASK_TYPE_OPTIONS: Array<{
  value: TemplateTaskType;
  label: string;
  description: string;
}> = [
    { value: "general", label: "General", description: "Universal task" },
    { value: "ui", label: "UI / UX", description: "Interface work" },
    { value: "backend", label: "Backend", description: "API / DB / server" },
    { value: "fullstack", label: "Fullstack", description: "UI + backend" },
    { value: "build", label: "Build", description: "Build / config" },
    { value: "bugfix", label: "Bugfix", description: "Minimal fix" },
    { value: "refactor", label: "Refactor", description: "No behavior change" },
    { value: "docs", label: "Docs", description: "Documentation" },
    { value: "tests", label: "Tests", description: "Verification" }
  ];

type BuilderSection = "task" | "recipe" | "rules" | "acceptance" | "context";
type TaskUnderstandingPendingAction = "analyze" | "generate" | null;

interface BuilderSectionNavigationItem {
  value: BuilderSection;
  label: string;
  description: string;
  icon: ReactNode;
}

type PackStatusTone = "ready" | "warning" | "pending";

interface PackStatusItem {
  section: BuilderSection;
  label: string;
  value: string;
  caption: string;
  tone: PackStatusTone;
  icon: ReactNode;
}

const CONTEXT_BUDGET_MODE_OPTIONS: SegmentedFilterOption<ContextBudgetMode>[] = [
  {
    value: "compact",
    label: "Compact",
    description: "tight",
    icon: <SlidersHorizontal size={13} />
  },
  {
    value: "standard",
    label: "Standard",
    description: "balanced",
    icon: <CheckCircle2 size={13} />
  },
  {
    value: "detailed",
    label: "Detailed",
    description: "broader",
    icon: <BookOpen size={13} />
  }
];


const CONTEXT_REVIEW_ITEMS: Array<{
  value: ContextReviewMode;
  label: string;
  description: string;
  icon: ReactNode;
}> = [
  {
    value: "files",
    label: "Files",
    description: "Selected context",
    icon: <FileText size={14} />
  },
  {
    value: "budget",
    label: "Budget",
    description: "Context pressure",
    icon: <SlidersHorizontal size={14} />
  },
  {
    value: "signals",
    label: "Signals",
    description: "Warnings and source",
    icon: <AlertTriangle size={14} />
  }
];

interface BuilderTaskPreset {
  id: string;
  title: string;
  eyebrow: string;
  description: string;
  taskType: TemplateTaskType;
  targetTool: string;
  icon: ReactNode;
  focus: string;
  starterTask: string;
  acceptanceText: string;
}

type TaskPresetIndicatorRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const TASK_PRESET_TRANSITION = {
  type: "spring",
  stiffness: 520,
  damping: 44,
  mass: 0.55
} as const;

const BUILDER_TASK_PRESETS: BuilderTaskPreset[] = [
  {
    id: "default",
    title: "Default setup",
    eyebrow: "Default",
    description: "Safe general Task Pack with Codex and standard rules.",
    taskType: "general",
    targetTool: "codex",
    icon: <Sparkles size={15} />,
    focus: "general task, Codex format, safe baseline rules",
    starterTask: "",
    acceptanceText: ""
  },
  {
    id: "ui-redesign",
    title: "UI/UX redesign",
    eyebrow: "Interface",
    description: "Improve layout, motion and hierarchy without changing behavior.",
    taskType: "ui",
    targetTool: "codex",
    icon: <Palette size={15} />,
    focus: "existing UI components, animation states, no backend changes",
    starterTask:
      "Improve the selected UI/UX using existing components and motion patterns. Keep backend/API behavior unchanged, preserve routing/data flow, and list changed files plus manual checks.",
    acceptanceText:
      "Visual states match the current ContextForge design system.\nNo backend/API behavior was changed.\nFinal response lists changed UI files, manual checks and risks."
  },
  {
    id: "bug-fix",
    title: "Bug fix",
    eyebrow: "Repair",
    description: "Find root cause, apply a narrow fix and avoid unrelated edits.",
    taskType: "bugfix",
    targetTool: "codex",
    icon: <Bug size={15} />,
    focus: "root cause, minimal patch, regression check",
    starterTask:
      "Find and fix the described bug with the smallest safe change. Explain the root cause, avoid unrelated refactors, and provide verification steps.",
    acceptanceText:
      "Root cause is explained briefly.\nPatch is limited to the relevant files.\nRegression path is covered by a test or manual check."
  },
  {
    id: "backend-api",
    title: "Backend API",
    eyebrow: "Server",
    description: "Change routes, validation or persistence with compatibility in mind.",
    taskType: "backend",
    targetTool: "claude",
    icon: <Code2 size={15} />,
    focus: "API contract, validation, storage, compatibility",
    starterTask:
      "Implement the backend/API change with validation, safe error handling and compatibility notes. Keep unrelated UI and generated sections untouched.",
    acceptanceText:
      "API behavior and validation are documented.\nPersistence or schema changes are called out explicitly.\nVerification commands and edge cases are listed."
  },
  {
    id: "add-tests",
    title: "Add tests",
    eyebrow: "Verification",
    description: "Add focused tests around existing behavior and commands.",
    taskType: "tests",
    targetTool: "codex",
    icon: <TestTube2 size={15} />,
    focus: "existing behavior, focused coverage, runnable checks",
    starterTask:
      "Add focused tests for the current behavior using the project's existing test style. Do not rewrite implementation unless a test setup issue requires it.",
    acceptanceText:
      "Tests follow the existing project style.\nVerification commands are listed.\nNo unrelated implementation changes were made."
  },
  {
    id: "refactor",
    title: "Refactor",
    eyebrow: "Cleanup",
    description: "Improve structure while preserving user-visible behavior.",
    taskType: "refactor",
    targetTool: "claude",
    icon: <Repeat2 size={15} />,
    focus: "readability, boundaries, no behavior change",
    starterTask:
      "Refactor the selected area to improve readability and maintainability without changing user-visible behavior or public contracts.",
    acceptanceText:
      "User-visible behavior is unchanged.\nPublic APIs and data contracts are preserved.\nFinal response lists risks and verification steps."
  },
  {
    id: "docs-update",
    title: "Docs update",
    eyebrow: "Docs",
    description: "Update docs from real project behavior and current scripts.",
    taskType: "docs",
    targetTool: "gemini",
    icon: <BookOpen size={15} />,
    focus: "real scripts, source facts, practical developer docs",
    starterTask:
      "Update the documentation using only real project behavior, current scripts and source facts. Do not invent unsupported features.",
    acceptanceText:
      "Docs match current scripts/configuration.\nNo speculative roadmap is presented as shipped behavior.\nAssumptions are listed clearly."
  },
  {
    id: "security-audit",
    title: "Security audit",
    eyebrow: "Safety",
    description: "Review secrets, unsafe changes and sensitive surfaces before implementation.",
    taskType: "backend",
    targetTool: "claude",
    icon: <ShieldAlert size={15} />,
    focus: "secrets, auth, unsafe writes, local-first boundaries",
    starterTask:
      "Review the selected change for security and safety risks before implementation. Focus on secrets, auth, unsafe writes, local-first boundaries and verification.",
    acceptanceText:
      "Secrets are not exposed or logged.\nRisky write paths are called out.\nVerification includes security-relevant checks."
  },
  {
    id: "release-checklist",
    title: "Release checklist",
    eyebrow: "Ship",
    description: "Prepare build, docs and verification steps for a clean desktop release.",
    taskType: "build",
    targetTool: "codex",
    icon: <Rocket size={15} />,
    focus: "build commands, release notes, installer/portable checks",
    starterTask:
      "Prepare the release checklist for this project. Include build commands, desktop packaging checks, docs/release notes and any remaining risks.",
    acceptanceText:
      "Build and packaging commands are listed.\nRelease notes or docs updates are identified.\nKnown blockers and manual checks are explicit."
  }
];

function getTaskQuality(rawTask: string, t: (key: string) => string) {
  const length = rawTask.trim().length;

  if (length >= 120) {
    return {
      label: t("taskPackBuilder.goodTask"),
      description: t("taskPackBuilder.goodTaskDesc"),
      tone: "text-emerald-300",
      icon: <CheckCircle2 size={15} />
    };
  }

  if (length >= 30) {
    return {
      label: t("taskPackBuilder.needsMoreDetail"),
      description: t("taskPackBuilder.needsMoreDetailDesc"),
      tone: "text-white",
      icon: <AlertTriangle size={15} />
    };
  }

  return {
    label: t("taskPackBuilder.tooShort"),
    description: t("taskPackBuilder.tooShortDesc"),
    tone: "text-red-400",
    icon: <AlertTriangle size={15} />
  };
}

function findDefaultTemplate(
  templates: PromptTemplate[],
  targetTool: string,
  taskType: string
) {
  return (
    templates.find(
      (template) =>
        template.targetTool === targetTool && template.taskType === taskType
    ) ??
    templates.find(
      (template) =>
        template.targetTool === targetTool && template.taskType === "general"
    ) ??
    templates.find(
      (template) =>
        template.targetTool === "generic" && template.taskType === taskType
    ) ??
    templates.find(
      (template) =>
        template.targetTool === "generic" && template.taskType === "general"
    ) ??
    templates[0]
  );
}

function findDefaultProfile(profiles: RuleProfile[], taskType: string) {
  const map: Record<string, string> = {
    general: "profile.safe-general",
    ui: "profile.safe-ui-task",
    backend: "profile.backend-safe-change",
    fullstack: "profile.backend-safe-change",
    build: "profile.backend-safe-change",
    bugfix: "profile.bugfix-minimal-change",
    refactor: "profile.refactor-no-behavior-change",
    docs: "profile.docs-update",
    tests: "profile.tests-verification"
  };

  return (
    profiles.find((profile) => profile.id === map[taskType]) ??
    profiles.find((profile) => profile.id === "profile.safe-general") ??
    profiles[0]
  );
}

function getLinesCount(value?: string) {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean).length;
}

function getTaskTypeLabel(value: string) {
  return TASK_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function getTargetToolLabel(value: string) {
  return TARGET_TOOL_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function Pill({
  children,
  tone = "default"
}: {
  children: ReactNode;
  tone?: "default" | "success" | "warning";
}) {
  const className =
    tone === "success"
      ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
      : tone === "warning"
        ? "border-amber-400/20 bg-amber-400/10 text-amber-200"
        : "border-neutral-800 bg-neutral-950 text-neutral-400";

  return (
    <span
      className={[
        "inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium",
        className
      ].join(" ")}
    >
      {children}
    </span>
  );
}

function CompactMetric({
  label,
  value,
  caption
}: {
  label: string;
  value: string | number;
  caption: string;
}) {
  return (
    <div className="rounded-xl border border-neutral-900 bg-black/35 p-2.5">
      <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
        {label}
      </p>

      <p className="mt-1 truncate text-sm font-semibold text-white">
        {value}
      </p>

      <p className="mt-0.5 truncate text-[10px] text-neutral-600">
        {caption}
      </p>
    </div>
  );
}

function LocalChangesCompactStrip({
  status,
  isLoading,
  error,
  onRefresh,
  onAddNote,
  onViewDetails,
  hasNote
}: {
  status: GitStatusResult | null;
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
  onAddNote: () => void;
  onViewDetails: () => void;
  hasNote: boolean;
}) {
  const canAddNote = Boolean(status?.isGitRepo && status.summary.totalChanged > 0);
  const branchLabel = status?.isDetachedHead
    ? "Detached HEAD"
    : status?.branch ?? "No branch";

  if (error) {
    return (
      <section className="flex min-h-[104px] min-w-0 flex-col justify-between rounded-2xl border border-red-400/20 bg-red-400/[0.055] p-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-red-400/20 bg-red-400/10 text-red-200">
            <AlertTriangle size={14} />
          </span>
          <div className="min-w-0">
            <p className="cf-tech-label text-[9px] uppercase text-red-200/70">
              Local state
            </p>
            <p className="mt-1 truncate text-sm font-semibold text-red-100">
              Git status unavailable
            </p>
            <p className="mt-1 text-[11px] text-red-100/55">
              Retry without leaving the task editor.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onRefresh}
          className="mt-3 inline-flex h-7 w-fit items-center gap-1.5 rounded-full border border-red-300/20 bg-black/20 px-2.5 text-[11px] font-medium text-red-100 transition hover:border-red-200/40"
        >
          <RotateCcw size={11} />
          Retry
        </button>
      </section>
    );
  }

  const stateLabel = isLoading
    ? "Checking working tree..."
    : status?.isGitRepo
      ? `${branchLabel} · ${status.summary.totalChanged} changed`
      : "No local Git repository";

  const stateCaption = status?.isGitRepo && !isLoading
    ? `${status.summary.stagedCount} staged · ${status.summary.unstagedCount} unstaged · ${status.summary.untrackedCount} untracked`
    : "Background awareness only";

  return (
    <section className="flex min-h-[104px] min-w-0 flex-col justify-between rounded-2xl border border-neutral-900 bg-black/25 p-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-300">
          {isLoading ? <Loader2 size={14} className="animate-spin" /> : <GitBranch size={14} />}
        </span>

        <div className="min-w-0">
          <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
            Local state
          </p>
          <p className="mt-1 truncate text-sm font-semibold text-white">
            {stateLabel}
          </p>
          <p className="mt-1 truncate text-[11px] text-neutral-600">
            {stateCaption}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={onRefresh}
          disabled={isLoading}
          className="inline-flex h-7 items-center gap-1.5 rounded-full border border-neutral-800 bg-neutral-950 px-2.5 text-[11px] font-medium text-neutral-400 transition hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RotateCcw size={11} />
          Refresh
        </button>

        <button
          type="button"
          onClick={onViewDetails}
          className="inline-flex h-7 items-center gap-1.5 rounded-full border border-neutral-800 bg-neutral-950 px-2.5 text-[11px] font-medium text-neutral-400 transition hover:border-white/20 hover:text-white"
        >
          <Eye size={11} />
          Review
        </button>

        <button
          type="button"
          onClick={onAddNote}
          disabled={!canAddNote || isLoading}
          className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-full border border-neutral-800 bg-neutral-950 px-2.5 text-[11px] font-medium text-neutral-300 transition hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <PlusCircle size={12} />
          {hasNote ? "Update note" : "Add note"}
        </button>
      </div>
    </section>
  );
}


function ContextLocalStateBar({
  status,
  isLoading,
  error,
  onRefresh,
  onAddNote,
  hasNote
}: {
  status: GitStatusResult | null;
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
  onAddNote: () => void;
  hasNote: boolean;
}) {
  const canAddNote = Boolean(status?.isGitRepo && status.summary.totalChanged > 0);
  const branchLabel = status?.isDetachedHead
    ? "Detached HEAD"
    : status?.branch ?? "No branch";

  const stateLabel = error
    ? "Local Git state unavailable"
    : isLoading
      ? "Checking working tree..."
      : status?.isGitRepo
        ? `${branchLabel} · ${status.summary.totalChanged} changed`
        : "No local Git repository";

  const stateCaption = error
    ? "Context analysis can still run without Git metadata."
    : status?.isGitRepo && !isLoading
      ? `${status.summary.stagedCount} staged · ${status.summary.unstagedCount} unstaged · ${status.summary.untrackedCount} untracked`
      : "Repository state is supporting context only.";

  return (
    <section
      className={[
        "flex flex-col gap-3 rounded-2xl border px-3.5 py-3 lg:flex-row lg:items-center lg:justify-between",
        error
          ? "border-red-400/20 bg-red-400/[0.055]"
          : "border-neutral-900 bg-black/25"
      ].join(" ")}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={[
            "grid size-9 shrink-0 place-items-center rounded-xl border",
            error
              ? "border-red-400/20 bg-red-400/10 text-red-200"
              : "border-neutral-800 bg-neutral-950 text-neutral-300"
          ].join(" ")}
        >
          {isLoading ? <Loader2 size={14} className="animate-spin" /> : error ? <AlertTriangle size={14} /> : <GitBranch size={14} />}
        </span>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-xs font-semibold text-white">
              {stateLabel}
            </p>
            {hasNote && (
              <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-[9px] font-semibold text-emerald-300">
                note attached
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-[10px] text-neutral-600">
            {stateCaption} · does not define automatic edit scope
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onRefresh}
          disabled={isLoading}
          className="inline-flex h-7 items-center gap-1.5 rounded-full border border-neutral-800 bg-neutral-950 px-2.5 text-[11px] font-medium text-neutral-400 transition hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RotateCcw size={11} />
          {error ? "Retry" : "Refresh"}
        </button>

        <button
          type="button"
          onClick={onAddNote}
          disabled={!canAddNote || isLoading}
          className="inline-flex h-7 items-center gap-1.5 rounded-full border border-neutral-800 bg-neutral-950 px-2.5 text-[11px] font-medium text-neutral-300 transition hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <PlusCircle size={12} />
          {hasNote ? "Update note" : "Add note"}
        </button>
      </div>
    </section>
  );
}

type ContextFileMode = "edit" | "inspect" | "create" | "reference";
type ContextFileFilter = "all" | "edit" | "inspect" | "warnings";
type ContextBudgetMode = "compact" | "standard" | "detailed";
type ContextReviewMode = "files" | "budget" | "signals";

type ContextReviewSummary = {
  isAnalyzed: boolean;
  label: string;
  summary: string;
  status: "empty" | "ready" | "warning" | "blocked";
  files: ContextComposerFileReference[];
  editCount: number;
  inspectCount: number;
  referenceCount: number;
  snippetsCount: number;
  budgetScore: number;
  budgetLabel: string;
  source: string;
  riskLabel: string;
};

function getContextFileMode(file: ContextComposerFileReference): ContextFileMode {
  const usage = file.usage.toLowerCase();

  if (usage.includes("create")) {
    return "create";
  }

  if (usage.includes("edit")) {
    return "edit";
  }

  if (usage.includes("reference") || usage.includes("config")) {
    return "reference";
  }

  return "inspect";
}

function getContextModeLabel(mode: ContextFileMode) {
  if (mode === "edit") {
    return "Edit candidate";
  }

  if (mode === "create") {
    return "Create / edit";
  }

  if (mode === "reference") {
    return "Reference";
  }

  return "Inspect-only";
}

function getContextModeTone(mode: ContextFileMode) {
  if (mode === "edit" || mode === "create") {
    return "border-emerald-400/20 bg-emerald-400/10 text-emerald-300";
  }

  if (mode === "reference") {
    return "border-white/15 bg-white/10 text-white";
  }

  return "border-neutral-800 bg-neutral-950 text-neutral-400";
}

function getContextStatusTone(status: ContextReviewSummary["status"]) {
  if (status === "ready") {
    return {
      border: "border-emerald-400/20",
      bg: "bg-emerald-400/10",
      text: "text-emerald-300",
      icon: "text-emerald-300"
    };
  }

  if (status === "blocked" || status === "warning") {
    return {
      border: "border-red-400/20",
      bg: "bg-red-400/10",
      text: "text-red-300",
      icon: "text-red-300"
    };
  }

  return {
    border: "border-neutral-800",
    bg: "bg-neutral-950",
    text: "text-neutral-400",
    icon: "text-neutral-500"
  };
}

function formatConfidence(value: number) {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function buildContextReviewSummary(preview?: ContextComposerPreview | null): ContextReviewSummary {
  if (!preview) {
    return {
      isAnalyzed: false,
      label: "Not analyzed",
      summary: "Run Analyze Context to see selected files, reasons and context budget before exporting.",
      status: "empty",
      files: [],
      editCount: 0,
      inspectCount: 0,
      referenceCount: 0,
      snippetsCount: 0,
      budgetScore: 0,
      budgetLabel: "Pending",
      source: "Not started",
      riskLabel: "Unknown"
    };
  }

  const files = preview.selectedFiles;
  const editCount = files.filter((file) => {
    const mode = getContextFileMode(file);
    return mode === "edit" || mode === "create";
  }).length;
  const inspectCount = files.filter((file) => getContextFileMode(file) === "inspect").length;
  const referenceCount = files.filter((file) => getContextFileMode(file) === "reference").length;
  const snippetsCount = preview.snippets.length;
  const selectedCount = files.length;
  const rawScore = Math.round(Math.min(100, selectedCount * 9 + snippetsCount * 7 + referenceCount * 3));
  const status = preview.selectionQuality.status === "blocked"
    ? "blocked"
    : preview.selectionQuality.status === "warning"
      ? "warning"
      : "ready";
  const budgetScore = Math.max(10, rawScore);

  return {
    isAnalyzed: true,
    label: status === "ready" ? "Context ready" : status === "blocked" ? "Manual review needed" : "Review suggested",
    summary: status === "ready"
      ? "Selected files are ready to review before generating the Task Pack."
      : "Context was analyzed, but warnings should be reviewed before exporting.",
    status,
    files,
    editCount,
    inspectCount,
    referenceCount,
    snippetsCount,
    budgetScore,
    budgetLabel: budgetScore >= 75 ? "Detailed" : budgetScore >= 40 ? "Standard" : "Compact",
    source: preview.fileSelection.usedFallback ? "Fallback selector" : preview.fileSelection.source,
    riskLabel: preview.taskIntent.riskLevel || preview.selectionQuality.status
  };
}

function getFileDisplayName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function getFileReason(file: ContextComposerFileReference, preview?: ContextComposerPreview | null) {
  if (file.reason?.trim()) {
    return file.reason;
  }

  const taskArea = preview?.task.effectiveTaskArea ?? "task";
  const mode = getContextFileMode(file);

  if (mode === "edit" || mode === "create") {
    return `Selected as a likely ${taskArea} edit candidate from the scanned project inventory.`;
  }

  if (mode === "reference") {
    return "Included as supporting configuration or project metadata for the generated Task Pack.";
  }

  return "Included for inspection so the coding agent can understand nearby behavior without editing it directly.";
}

function getContextFileMetaLine(file: ContextComposerFileReference) {
  const parts = [file.kind || "file", formatConfidence(file.confidence), file.canReadText ? "snippet readable" : "snippet unavailable"];
  return parts.join(" · ");
}

function isTechnicalContextSignal(message: string) {
  const normalized = message.toLowerCase();

  return (
    normalized.includes("engine version") ||
    normalized.includes("selector engine") ||
    normalized.includes("safety profile") ||
    normalized.includes("generation mode") ||
    normalized.includes("model:")
  );
}

function getCompactContextWarning(message: string) {
  const normalized = message.toLowerCase();

  if (normalized.includes("fallback")) {
    return "Fallback selector was used. Review file choices before exporting.";
  }

  if (normalized.includes("invalid output") || normalized.includes("failed")) {
    return "AI file selector did not return a safe result; ranked fallback context was used.";
  }

  return message;
}

function getBudgetModeFromLabel(label: string): ContextBudgetMode {
  const normalized = label.toLowerCase();

  if (normalized.includes("compact")) {
    return "compact";
  }

  if (normalized.includes("detailed")) {
    return "detailed";
  }

  return "standard";
}

function getContextBudgetGuidance(mode: ContextBudgetMode) {
  if (mode === "compact") {
    return {
      title: "Compact",
      description: "Best for small fixes. Keeps only high-confidence edit files and essential references.",
      target: "2–4 files",
      risk: "Lowest noise"
    };
  }

  if (mode === "detailed") {
    return {
      title: "Detailed",
      description: "Best when the task spans several areas. Adds more references, but review noise carefully.",
      target: "8–14 files",
      risk: "Higher context load"
    };
  }

  return {
    title: "Standard",
    description: "Balanced mode for most Task Packs. Keeps edit candidates plus nearby inspect-only context.",
    target: "5–8 files",
    risk: "Balanced"
  };
}

function getBudgetPressureTone(score: number) {
  if (score >= 90) {
    return {
      label: "High pressure",
      text: "text-red-200",
      bar: "bg-red-300",
      border: "border-red-400/20",
      bg: "bg-red-400/10"
    };
  }

  if (score >= 65) {
    return {
      label: "Review load",
      text: "text-white",
      bar: "bg-white",
      border: "border-white/15",
      bg: "bg-white/10"
    };
  }

  return {
    label: "Light context",
    text: "text-emerald-200",
    bar: "bg-emerald-300",
    border: "border-emerald-400/20",
    bg: "bg-emerald-400/10"
  };
}

function ContextBudgetBar({
  label,
  value,
  caption
}: {
  label: string;
  value: number;
  caption: string;
}) {
  const safeValue = Math.max(0, Math.min(100, value));
  const tone = getBudgetPressureTone(safeValue);

  return (
    <div className="rounded-xl border border-neutral-900 bg-black/30 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-white">
            {label}
          </p>
          <p className="mt-0.5 text-[10px] text-neutral-600">
            {caption}
          </p>
        </div>

        <span className={["text-xs font-semibold", tone.text].join(" ")}>
          {safeValue}%
        </span>
      </div>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-neutral-900">
        <motion.div
          className={["h-full rounded-full", tone.bar].join(" ")}
          initial={false}
          animate={{ width: `${safeValue}%` }}
          transition={{ type: "spring", stiffness: 420, damping: 38, mass: 0.6 }}
        />
      </div>
    </div>
  );
}

function ContextBudgetPanel({
  summary,
  selectedMode,
  onModeChange,
  enabledRulesCount,
  criteriaCount
}: {
  summary: ContextReviewSummary;
  selectedMode: ContextBudgetMode;
  onModeChange: (mode: ContextBudgetMode) => void;
  enabledRulesCount: number;
  criteriaCount: number;
}) {
  const recommendedMode = getBudgetModeFromLabel(summary.budgetLabel);
  const guidance = getContextBudgetGuidance(selectedMode);
  const pressureTone = getBudgetPressureTone(summary.budgetScore);
  const filePressure = Math.min(100, Math.round((summary.files.length / 12) * 100));
  const snippetPressure = Math.min(100, Math.round((summary.snippetsCount / 10) * 100));
  const rulePressure = Math.min(100, Math.round(((enabledRulesCount + criteriaCount) / 14) * 100));
  const inspectPressure = Math.min(100, Math.round(((summary.inspectCount + summary.referenceCount) / Math.max(1, summary.files.length)) * 100));

  return (
    <section className="rounded-2xl border border-neutral-900 bg-black/30 p-4">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
              Context budget
            </p>

            <span className={["rounded-full border px-2 py-1 text-[10px] font-semibold", pressureTone.border, pressureTone.bg, pressureTone.text].join(" ")}>
              {pressureTone.label}
            </span>
          </div>

          <h3 className="mt-1 text-base font-semibold text-white">
            {summary.budgetLabel} · {summary.budgetScore}% context pressure
          </h3>

          <p className="mt-2 max-w-2xl text-xs leading-5 text-neutral-500">
            Budget is a local estimate of how much context the Task Pack will carry. It does not change generation yet, but it helps decide whether the pack is too sparse or too noisy.
          </p>
        </div>

        <div className="w-full shrink-0 xl:w-[360px]">
          <SegmentedFilter
            value={selectedMode}
            onChange={(value) => onModeChange(value as ContextBudgetMode)}
            options={CONTEXT_BUDGET_MODE_OPTIONS}
            className="h-11"
          />
        </div>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_260px]">
        <div className="grid gap-3 sm:grid-cols-2">
          <ContextBudgetBar
            label="Files"
            value={filePressure}
            caption={`${summary.files.length} selected · ${summary.editCount} edit candidates`}
          />
          <ContextBudgetBar
            label="Snippets"
            value={snippetPressure}
            caption={`${summary.snippetsCount} readable snippets`}
          />
          <ContextBudgetBar
            label="Rules & checks"
            value={rulePressure}
            caption={`${enabledRulesCount} rules · ${criteriaCount} checks`}
          />
          <ContextBudgetBar
            label="Inspect-only load"
            value={inspectPressure}
            caption={`${summary.inspectCount + summary.referenceCount} read-only references`}
          />
        </div>

        <div className="rounded-xl border border-neutral-900 bg-black/35 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
                Planning mode
              </p>
              <h4 className="mt-1 text-sm font-semibold text-white">
                {guidance.title}
              </h4>
            </div>

            <span className="rounded-full border border-neutral-800 bg-neutral-950 px-2 py-1 text-[10px] text-neutral-400">
              {recommendedMode === selectedMode ? "recommended" : "preview"}
            </span>
          </div>

          <p className="mt-3 text-xs leading-5 text-neutral-500">
            {guidance.description}
          </p>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <CompactMetric label="Target" value={guidance.target} caption="future budget" />
            <CompactMetric label="Noise" value={guidance.risk} caption="expected" />
          </div>

          <p className="mt-3 text-[10px] leading-4 text-neutral-600">
            Stage 10.4 is UI-only: selector behavior stays unchanged until budget modes are wired into core selection.
          </p>
        </div>
      </div>
    </section>
  );
}

function ContextFileReasonCard({
  file,
  preview
}: {
  file: ContextComposerFileReference;
  preview?: ContextComposerPreview | null;
}) {
  const mode = getContextFileMode(file);

  return (
    <article className="rounded-2xl border border-neutral-900 bg-black/35 p-3.5 transition-colors hover:border-neutral-800">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="grid size-7 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-300">
              <FileText size={14} />
            </span>

            <div className="min-w-0">
              <h4 className="truncate text-sm font-semibold text-white">
                {getFileDisplayName(file.path)}
              </h4>

              <p className="truncate text-[11px] text-neutral-600">
                {file.path}
              </p>
            </div>
          </div>
        </div>

        <span className={["shrink-0 rounded-full border px-2 py-1 text-[10px] font-medium", getContextModeTone(mode)].join(" ") }>
          {getContextModeLabel(mode)}
        </span>
      </div>

      <p className="mt-3 line-clamp-2 text-xs leading-5 text-neutral-500">
        {getFileReason(file, preview)}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-neutral-900 pt-3 text-[10px] text-neutral-600">
        <span className="rounded-full border border-neutral-900 bg-black/30 px-2 py-1 text-neutral-500">
          {getContextFileMetaLine(file)}
        </span>
      </div>
    </article>
  );
}

function getQualityStatusClasses(status: TaskPackQualityStatus) {
  if (status === "pass") {
    return {
      ring: "text-emerald-300",
      border: "border-emerald-400/20",
      bg: "bg-emerald-400/10",
      text: "text-emerald-300",
      muted: "text-emerald-200/70"
    };
  }

  if (status === "improve") {
    return {
      ring: "text-white",
      border: "border-white/15",
      bg: "bg-white/10",
      text: "text-white",
      muted: "text-neutral-300"
    };
  }

  return {
    ring: "text-red-300",
    border: "border-red-400/20",
    bg: "bg-red-400/10",
    text: "text-red-300",
    muted: "text-red-200/70"
  };
}

function QualityStatusIcon({ status, size = 14 }: { status: TaskPackQualityStatus; size?: number }) {
  if (status === "pass") {
    return <CheckCircle2 size={size} />;
  }

  if (status === "improve") {
    return <Lightbulb size={size} />;
  }

  return <AlertTriangle size={size} />;
}

function AnimatedScoreNumber({ value }: { value: number }) {
  const [displayValue, setDisplayValue] = useState(value);
  const previousValueRef = useRef(value);

  useEffect(() => {
    const from = previousValueRef.current;
    const to = value;

    if (from === to) {
      setDisplayValue(to);
      return;
    }

    let frameId = 0;
    const startedAt = performance.now();
    const durationMs = 680;

    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);

      setDisplayValue(Math.round(from + (to - from) * eased));

      if (progress < 1) {
        frameId = requestAnimationFrame(tick);
      } else {
        previousValueRef.current = to;
      }
    };

    frameId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frameId);
      previousValueRef.current = to;
    };
  }, [value]);

  return (
    <motion.p
      className="text-xl font-semibold tracking-[-0.06em] text-white"
      initial={false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      key={`quality-score-${value}`}
      transition={{ duration: 0.18, ease: "easeOut" }}
    >
      {displayValue}
    </motion.p>
  );
}

function QualityScoreRing({ score, status }: { score: number; status: TaskPackQualityStatus }) {
  const classes = getQualityStatusClasses(status);
  const radius = 35;
  const circumference = 2 * Math.PI * radius;
  const clampedScore = Math.max(0, Math.min(100, score));
  const dashOffset = circumference - (clampedScore / 100) * circumference;

  return (
    <div className={["relative grid size-20 shrink-0 place-items-center rounded-full", classes.ring].join(" ")}>
      <motion.div
        className={["absolute inset-0 rounded-full blur-md", classes.bg].join(" ")}
        initial={false}
        animate={{ opacity: [0.35, 0.72, 0.35], scale: [0.94, 1.04, 0.94] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
      />

      <svg className="absolute inset-0 size-full -rotate-90" viewBox="0 0 80 80" aria-hidden="true">
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="5"
        />
        <motion.circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="5"
          strokeDasharray={circumference}
          initial={false}
          animate={{ strokeDashoffset: dashOffset }}
          transition={{ type: "spring", stiffness: 120, damping: 22, mass: 0.8 }}
        />
      </svg>

      <motion.div
        className="absolute inset-[7px] rounded-full border border-neutral-900 bg-neutral-950/95"
        initial={false}
        animate={{ boxShadow: `0 0 ${score >= 80 ? 20 : 14}px rgba(255,255,255,0.05)` }}
        transition={{ duration: 0.3 }}
      />

      <div className="relative text-center">
        <AnimatedScoreNumber value={score} />
        <p className="cf-tech-label text-[8px] uppercase text-neutral-600">/ 100</p>
      </div>
    </div>
  );
}

function getPackStatusToneClasses(tone: PackStatusTone) {
  if (tone === "ready") {
    return {
      dot: "bg-emerald-300",
      text: "text-emerald-300"
    };
  }

  if (tone === "warning") {
    return {
      dot: "bg-red-300",
      text: "text-red-300"
    };
  }

  return {
    dot: "bg-neutral-600",
    text: "text-neutral-500"
  };
}

function PackStatusCard({
  quality,
  items,
  activeSection,
  onSelect,
  onOpenDetails
}: {
  quality: TaskPackQualityResult;
  items: readonly PackStatusItem[];
  activeSection: BuilderSection;
  onSelect: (section: BuilderSection) => void;
  onOpenDetails: () => void;
}) {
  const classes = getQualityStatusClasses(quality.status);

  return (
    <section className="rounded-[1.5rem] border border-neutral-900 bg-black/45 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 pt-1">
          <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
            Pack status
          </p>

          <h2 className="mt-1 text-base font-semibold text-white">
            {quality.label}
          </h2>

          <p className="mt-1 line-clamp-2 text-xs leading-5 text-neutral-600">
            {quality.summary}
          </p>
        </div>

        <QualityScoreRing score={quality.score} status={quality.status} />
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-neutral-900 bg-black/30">
        {items.map((item) => {
          const tone = getPackStatusToneClasses(item.tone);
          const isActive = item.section === activeSection;

          return (
            <button
              key={item.section}
              type="button"
              onClick={() => onSelect(item.section)}
              className={[
                "flex w-full items-center gap-3 border-b border-neutral-900 px-3 py-3 text-left transition last:border-b-0",
                isActive
                  ? "bg-white/[0.065]"
                  : "bg-transparent hover:bg-white/[0.035]"
              ].join(" ")}
            >
              <span
                className={[
                  "grid size-8 shrink-0 place-items-center rounded-xl border transition",
                  isActive
                    ? "border-white/15 bg-white/10 text-white"
                    : "border-neutral-900 bg-neutral-950 text-neutral-500"
                ].join(" ")}
              >
                {item.icon}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-white">
                  {item.label}
                </span>
                <span className="mt-0.5 block truncate text-[10px] text-neutral-600">
                  {item.caption}
                </span>
              </span>

              <span className="shrink-0 text-right">
                <span className={["flex items-center justify-end gap-1.5 text-[11px] font-medium", tone.text].join(" ")}>
                  <span className={["size-1.5 rounded-full", tone.dot].join(" ")} />
                  {item.value}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onOpenDetails}
        className="cf-invert-action mt-4 inline-flex h-9 w-full items-center justify-center gap-2 rounded-full px-3 text-xs"
      >
        <Lightbulb size={13} />
        View quality details
      </button>

      <p className={["mt-3 text-[10px] leading-4", classes.muted].join(" ")}>
        Local readiness only · generation logic is unchanged.
      </p>
    </section>
  );
}

function getIntentStatusClasses(status: TaskPackIntentStatus) {
  if (status === "match") {
    return {
      icon: "border-emerald-400/20 bg-emerald-400/10 text-emerald-300",
      pill: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200",
      accent: "text-emerald-300",
      border: "border-emerald-400/15"
    };
  }

  if (status === "warning") {
    return {
      icon: "border-red-400/20 bg-red-400/10 text-red-300",
      pill: "border-red-400/25 bg-red-400/10 text-red-200",
      accent: "text-red-300",
      border: "border-red-400/15"
    };
  }

  if (status === "review") {
    return {
      icon: "border-white/15 bg-white/10 text-white",
      pill: "border-white/15 bg-white/10 text-white",
      accent: "text-white",
      border: "border-white/10"
    };
  }

  return {
    icon: "border-neutral-800 bg-neutral-950 text-neutral-400",
    pill: "border-neutral-800 bg-neutral-950 text-neutral-400",
    accent: "text-neutral-300",
    border: "border-neutral-900"
  };
}

function TaskIntentCard({
  intent,
  onOpenRecipe,
  onOpenContext
}: {
  intent: TaskPackIntentResult;
  onOpenRecipe: () => void;
  onOpenContext: () => void;
}) {
  const classes = getIntentStatusClasses(intent.status);
  const primaryMismatch = intent.mismatches[0];
  const hasContextMismatch = intent.mismatches.some((item) => item.id.startsWith("context-"));

  return (
    <article className={["rounded-2xl border bg-black/25 p-3", classes.border].join(" ")}>
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className={["grid size-9 shrink-0 place-items-center rounded-xl border", classes.icon].join(" ")}>
            {intent.status === "match" ? (
              <CheckCircle2 size={15} />
            ) : intent.status === "warning" ? (
              <AlertTriangle size={15} />
            ) : (
              <Lightbulb size={15} />
            )}
          </span>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
                Task understanding
              </p>
              <span className={["rounded-full border px-2 py-0.5 text-[9px] font-semibold", classes.pill].join(" ")}>
                {intent.confidence}%
              </span>
            </div>

            <h3 className="mt-1 truncate text-sm font-semibold text-white">
              {intent.label}
            </h3>

            <p className="mt-1 line-clamp-1 text-xs leading-5 text-neutral-500">
              {intent.summary}
            </p>
          </div>
        </div>

        <div className="grid shrink-0 grid-cols-3 gap-1.5 xl:w-[330px]">
          {intent.signals.map((signal) => (
            <div key={signal.label} className="rounded-xl border border-neutral-900 bg-black/35 px-2.5 py-2">
              <p className="cf-tech-label truncate text-[8px] uppercase text-neutral-700">
                {signal.label}
              </p>
              <p
                className={[
                  "mt-1 truncate text-[11px] font-semibold",
                  signal.tone === "positive"
                    ? "text-emerald-300"
                    : signal.tone === "warning"
                      ? "text-red-300"
                      : "text-white"
                ].join(" ")}
              >
                {signal.value}
              </p>
            </div>
          ))}
        </div>
      </div>

      {primaryMismatch ? (
        <div className="mt-3 flex flex-col gap-3 border-t border-neutral-900 pt-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-2">
            <AlertTriangle
              size={13}
              className={primaryMismatch.severity === "warning" ? "mt-0.5 shrink-0 text-red-300" : "mt-0.5 shrink-0 text-neutral-300"}
            />
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-white">
                {primaryMismatch.title}
              </p>
              <p className="mt-0.5 line-clamp-1 text-[11px] text-neutral-600">
                {primaryMismatch.message}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              type="button"
              onClick={onOpenRecipe}
              className="cf-invert-action inline-flex h-7 items-center rounded-full px-2.5 text-[11px]"
            >
              Open recipe
            </button>

            {hasContextMismatch && (
              <button
                type="button"
                onClick={onOpenContext}
                className="inline-flex h-7 items-center rounded-full border border-neutral-800 bg-neutral-950 px-2.5 text-[11px] font-medium text-neutral-300 transition hover:border-white/20 hover:text-white"
              >
                Review context
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-3 border-t border-emerald-400/10 pt-3 text-[11px] leading-5 text-emerald-200/75">
          Recipe and task intent look aligned. Keep boundaries and verification visible before exporting.
        </div>
      )}
    </article>
  );
}

function BackendTaskUnderstandingCard({
  response,
  onOpen
}: {
  response: TaskUnderstandingResponse;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const understanding = response.taskUnderstanding;
  const confidence = Math.round(understanding.confidence * 100);
  const isReady = understanding.readiness === "ready";
  const needsClarification = understanding.readiness === "needs_clarification";

  return (
    <button
      type="button"
      onClick={onOpen}
      className={[
        "w-full rounded-2xl border bg-black/25 p-3 text-left transition hover:bg-white/[0.035]",
        isReady
          ? "border-emerald-400/15 hover:border-emerald-300/25"
          : needsClarification
            ? "border-amber-300/20 hover:border-amber-200/30"
            : "border-white/10 hover:border-white/20"
      ].join(" ")}
    >
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={[
              "grid size-9 shrink-0 place-items-center rounded-xl border",
              isReady
                ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
                : needsClarification
                  ? "border-amber-300/20 bg-amber-300/10 text-amber-300"
                  : "border-white/15 bg-white/10 text-white"
            ].join(" ")}
          >
            {isReady ? (
              <CheckCircle2 size={15} />
            ) : needsClarification ? (
              <AlertTriangle size={15} />
            ) : (
              <Lightbulb size={15} />
            )}
          </span>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
                {t("taskUnderstanding.eyebrow")}
              </p>
              <span className="rounded-full border border-neutral-800 bg-black/45 px-2 py-0.5 text-[9px] font-semibold text-neutral-300">
                {confidence}%
              </span>
            </div>

            <h3 className="mt-1 truncate text-sm font-semibold text-white">
              {needsClarification
                ? t("taskUnderstanding.statusClarification")
                : understanding.readiness === "review"
                  ? t("taskUnderstanding.statusReview")
                  : t("taskUnderstanding.statusReady")}
            </h3>

            <p className="mt-1 line-clamp-1 text-xs leading-5 text-neutral-500">
              {understanding.goal}
            </p>
          </div>
        </div>

        <div className="grid shrink-0 grid-cols-4 gap-1.5 xl:w-[430px]">
          <div className="rounded-xl border border-neutral-900 bg-black/35 px-2.5 py-2">
            <p className="cf-tech-label text-[8px] uppercase text-neutral-700">Action</p>
            <p className="mt-1 truncate text-[11px] font-semibold text-white">{understanding.action}</p>
          </div>
          <div className="rounded-xl border border-neutral-900 bg-black/35 px-2.5 py-2">
            <p className="cf-tech-label text-[8px] uppercase text-neutral-700">Targets</p>
            <p className="mt-1 text-[11px] font-semibold text-white">{understanding.targetHints.length}</p>
          </div>
          <div className="rounded-xl border border-neutral-900 bg-black/35 px-2.5 py-2">
            <p className="cf-tech-label text-[8px] uppercase text-neutral-700">Values</p>
            <p className="mt-1 text-[11px] font-semibold text-white">{understanding.explicitValues.length}</p>
          </div>
          <div className="rounded-xl border border-neutral-900 bg-black/35 px-2.5 py-2">
            <p className="cf-tech-label text-[8px] uppercase text-neutral-700">Questions</p>
            <p className="mt-1 text-[11px] font-semibold text-white">{response.clarifications.length}</p>
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-neutral-900 pt-3 text-[11px] text-neutral-500">
        <span>{t("taskUnderstanding.clarificationCount", { count: response.clarifications.length })}</span>
        <span className="font-medium text-neutral-300">{t("taskUnderstanding.openDetails")}</span>
      </div>
    </button>
  );
}


function getQualityCheckSection(checkId: string): BuilderSection {
  if (checkId === "recipe") {
    return "recipe";
  }

  if (checkId === "constraints" || checkId === "safety") {
    return "rules";
  }

  if (checkId === "verification") {
    return "acceptance";
  }

  return "task";
}

function getQualitySuggestionSection(message: string): BuilderSection {
  const normalized = message.toLowerCase();

  if (/acceptance|verification|build|test|lint|manual|checklist/.test(normalized)) {
    return "acceptance";
  }

  if (/template|profile|recipe|preset|agent/.test(normalized)) {
    return "recipe";
  }

  if (/rule|constraint|boundary|avoid|preserve|files not to touch/.test(normalized)) {
    return "rules";
  }

  if (/context|selected files|inspect-only|edit candidate/.test(normalized)) {
    return "context";
  }

  return "task";
}

function getBuilderSectionLabel(section: BuilderSection) {
  if (section === "recipe") return "Recipe";
  if (section === "rules") return "Rules";
  if (section === "acceptance") return "Acceptance";
  if (section === "context") return "Context";
  return "Task";
}

function QualityDetailsModal({
  quality,
  onClose,
  onNavigate
}: {
  quality: TaskPackQualityResult;
  onClose: () => void;
  onNavigate: (section: BuilderSection) => void;
}) {
  const passedChecks = quality.checks.filter((check) => check.status === "pass").length;
  const topIssues = quality.checks.filter((check) => check.status !== "pass").slice(0, 3);
  const actionCandidates = [
    ...topIssues.map((check) => ({
      label: check.message,
      section: getQualityCheckSection(check.id)
    })),
    ...quality.suggestions.map((suggestion) => ({
      label: suggestion,
      section: getQualitySuggestionSection(suggestion)
    }))
  ];
  const nextActions = Array.from(
    new Map(actionCandidates.map((action) => [action.label, action])).values()
  ).slice(0, 3);

  const openSection = (section: BuilderSection) => {
    onNavigate(section);
    onClose();
  };

  return (
    <Modal
      title="Task Pack Quality"
      eyebrow="Stage 10.1"
      maxWidth="max-w-4xl"
      scrollable={true}
      onClose={onClose}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <p className="hidden text-xs text-neutral-600 md:block">
            Local readiness score · choose an item to open the relevant workflow step.
          </p>

          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      }
    >
      <div className="space-y-4 p-5">
        <section className="rounded-[1.6rem] border border-neutral-900 bg-black/35 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <QualityScoreRing score={quality.score} status={quality.status} />

              <div className="min-w-0">
                <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                  Quality overview
                </p>

                <h3 className="mt-1 text-xl font-semibold tracking-[-0.04em] text-white">
                  {quality.label}
                </h3>

                <p className="mt-1 max-w-xl text-sm leading-6 text-neutral-500">
                  {quality.summary}
                </p>
              </div>
            </div>

            <div className="grid min-w-[280px] grid-cols-4 gap-2 lg:max-w-sm">
              <CompactMetric label="Checks" value={`${passedChecks}/${quality.checks.length}`} caption="passed" />
              <CompactMetric label="Task" value={quality.stats.taskWords} caption="words" />
              <CompactMetric label="Rules" value={quality.stats.enabledRules} caption="enabled" />
              <CompactMetric label="Criteria" value={quality.stats.criteria} caption="checks" />
            </div>
          </div>
        </section>

        <section className="rounded-[1.6rem] border border-neutral-900 bg-black/35 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                Next best actions
              </p>

              <h3 className="mt-1 text-base font-semibold text-white">
                Fix the strongest gaps first.
              </h3>
            </div>

            <span className="inline-flex h-7 items-center rounded-full border border-white/10 bg-white/[0.04] px-3 text-[11px] text-neutral-400">
              {nextActions.length > 0 ? `${nextActions.length} suggested` : "No blockers"}
            </span>
          </div>

          <div className="mt-4 grid gap-2 lg:grid-cols-3">
            {nextActions.length > 0 ? (
              nextActions.map((action, index) => {
                const isCritical = quality.status === "fail" || quality.status === "warn";

                return (
                  <button
                    key={action.label}
                    type="button"
                    onClick={() => openSection(action.section)}
                    className={[
                      "group rounded-2xl border p-3 text-left transition hover:border-white/20 hover:bg-white/[0.055]",
                      isCritical && index === 0
                        ? "border-red-400/20 bg-red-400/[0.06]"
                        : "border-white/10 bg-white/[0.035]"
                    ].join(" ")}
                  >
                    <div className="flex items-start gap-2">
                      <span
                        className={[
                          "grid size-6 shrink-0 place-items-center rounded-lg border text-[11px] font-semibold",
                          isCritical && index === 0
                            ? "border-red-400/20 bg-red-400/10 text-red-300"
                            : "border-white/10 bg-white/10 text-white"
                        ].join(" ")}
                      >
                        {index + 1}
                      </span>

                      <div className="min-w-0 flex-1">
                        <p className="text-xs leading-5 text-neutral-300">
                          {action.label}
                        </p>
                        <p className="mt-2 text-[10px] font-semibold text-neutral-600 transition group-hover:text-white">
                          Open {getBuilderSectionLabel(action.section)} →
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06] p-3 lg:col-span-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-emerald-300">
                  <CheckCircle2 size={15} />
                  Looks ready
                </div>

                <p className="mt-1 text-xs leading-5 text-emerald-200/70">
                  The Task Pack has clear setup, constraints and enough verification signals.
                </p>
              </div>
            )}
          </div>
        </section>

        <section className="rounded-[1.6rem] border border-neutral-900 bg-black/35 p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                Readiness checks
              </p>

              <h3 className="mt-1 text-base font-semibold text-white">
                What the score is based on
              </h3>
            </div>

            <span className="rounded-full border border-neutral-800 bg-neutral-950 px-3 py-1 text-[11px] text-neutral-500">
              {quality.score}/100
            </span>
          </div>

          <div className="grid gap-2 lg:grid-cols-2">
            {quality.checks.map((check) => {
              const classes = getQualityStatusClasses(check.status);
              const percent = Math.round((check.points / check.maxPoints) * 100);
              const section = getQualityCheckSection(check.id);

              return (
                <button
                  key={check.id}
                  type="button"
                  onClick={() => openSection(section)}
                  className="group rounded-2xl border border-neutral-900 bg-black/35 p-3 text-left transition hover:border-white/20 hover:bg-white/[0.035]"
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={[
                        "grid size-8 shrink-0 place-items-center rounded-xl border",
                        classes.border,
                        classes.bg,
                        classes.text
                      ].join(" ")}
                    >
                      <QualityStatusIcon status={check.status} />
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate text-sm font-semibold text-white">
                          {check.label}
                        </p>

                        <span className="shrink-0 text-[11px] text-neutral-500">
                          {check.points}/{check.maxPoints}
                        </span>
                      </div>

                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                        <div
                          className={[
                            "h-full rounded-full transition-[width] duration-500 ease-out",
                            check.status === "pass"
                              ? "bg-emerald-300"
                              : check.status === "improve"
                                ? "bg-white"
                                : "bg-red-300"
                          ].join(" ")}
                          style={{ width: `${percent}%` }}
                        />
                      </div>

                      <p className="mt-2 line-clamp-2 text-xs leading-5 text-neutral-600">
                        {check.message}
                      </p>

                      <p className="mt-2 text-[10px] font-semibold text-neutral-700 transition group-hover:text-white">
                        Open {getBuilderSectionLabel(section)} →
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </Modal>
  );
}

function getBuilderPresetForTaskType(taskType: string) {
  return (
    BUILDER_TASK_PRESETS.find((preset) => preset.taskType === taskType) ??
    BUILDER_TASK_PRESETS[0]
  );
}

function TaskPresetSelector({
  activePreset,
  onSelect
}: {
  activePreset: BuilderTaskPreset;
  onSelect: (preset: BuilderTaskPreset) => void;
}) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [indicatorRect, setIndicatorRect] = useState<TaskPresetIndicatorRect | null>(null);

  const updateIndicator = useCallback(() => {
    const container = gridRef.current;
    const activeItem = itemRefs.current[activePreset.id];

    if (!container || !activeItem) {
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const itemRect = activeItem.getBoundingClientRect();

    setIndicatorRect({
      x: itemRect.left - containerRect.left,
      y: itemRect.top - containerRect.top,
      width: itemRect.width,
      height: itemRect.height
    });
  }, [activePreset.id]);

  useLayoutEffect(() => {
    updateIndicator();
  }, [updateIndicator]);

  useEffect(() => {
    updateIndicator();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateIndicator);
      return () => window.removeEventListener("resize", updateIndicator);
    }

    const observer = new ResizeObserver(updateIndicator);

    if (gridRef.current) {
      observer.observe(gridRef.current);
    }

    Object.values(itemRefs.current).forEach((item) => {
      if (item) {
        observer.observe(item);
      }
    });

    window.addEventListener("resize", updateIndicator);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateIndicator);
    };
  }, [updateIndicator]);

  return (
    <section className="mb-4 rounded-2xl border border-neutral-900 bg-black/35 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
      <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap gap-2">
            <Pill>
              <ClipboardCheckIcon />
              Stage 9.3
            </Pill>
            <Pill>Template preset</Pill>
          </div>

          <h3 className="text-sm font-semibold text-white">
            Choose a task preset to auto-wire template, profile and checks.
          </h3>
        </div>

        <p className="max-w-sm text-[11px] leading-4 text-neutral-600">
          Presets update the recipe only. Your written task stays untouched unless it is empty.
        </p>
      </div>

      <div
        ref={gridRef}
        className="relative grid gap-1.5 overflow-hidden rounded-[1.35rem] border border-white/10 bg-black/55 p-1.5 sm:grid-cols-2 2xl:grid-cols-4"
      >
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.008)_52%,rgba(255,255,255,0.003))]" />

        {indicatorRect && (
          <motion.span
            aria-hidden="true"
            className="absolute rounded-[1.05rem] bg-white shadow-[0_16px_40px_rgba(255,255,255,0.12)]"
            initial={false}
            animate={{
              x: indicatorRect.x,
              y: indicatorRect.y,
              width: indicatorRect.width,
              height: indicatorRect.height
            }}
            transition={TASK_PRESET_TRANSITION}
            style={{ willChange: "transform,width,height" }}
          />
        )}

        {BUILDER_TASK_PRESETS.map((preset) => {
          const isActive = preset.id === activePreset.id;

          return (
            <button
              key={preset.id}
              ref={(node) => {
                itemRefs.current[preset.id] = node;
              }}
              type="button"
              onClick={() => onSelect(preset)}
              className={[
                "group relative z-10 min-h-[78px] rounded-[1.05rem] p-3 text-left transition-colors duration-150",
                isActive ? "text-black" : "text-neutral-500 hover:text-white"
              ].join(" ")}
            >
              <span className="flex h-full flex-col justify-between gap-2">
                <span className="flex items-start justify-between gap-3">
                  <span
                    className={[
                      "grid size-8 shrink-0 place-items-center rounded-xl border transition-colors duration-150",
                      isActive
                        ? "border-black/10 bg-black/[0.045] text-black"
                        : "border-neutral-800 bg-neutral-950 text-neutral-500 group-hover:border-white/15 group-hover:text-white"
                    ].join(" ")}
                  >
                    {preset.icon}
                  </span>

                  <span
                    className={[
                      "rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] transition-colors duration-150",
                      isActive
                        ? "border-black/10 bg-black/[0.035] text-black/50"
                        : "border-neutral-800 bg-neutral-950 text-neutral-600 group-hover:text-neutral-300"
                    ].join(" ")}
                  >
                    {preset.eyebrow}
                  </span>
                </span>

                <span>
                  <span className="block truncate text-xs font-semibold">
                    {preset.title}
                  </span>
                  <span
                    className={[
                      "mt-1 block line-clamp-2 text-[11px] leading-4 transition-colors duration-150",
                      isActive ? "text-black/58" : "text-neutral-600"
                    ].join(" ")}
                  >
                    {preset.description}
                  </span>
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(0,1fr)_170px]">
        <div className="rounded-xl border border-neutral-900 bg-black/35 px-3 py-2">
          <p className="cf-tech-label text-[9px] uppercase text-neutral-600">Preset focus</p>
          <p className="mt-1 truncate text-xs text-neutral-400">{activePreset.focus}</p>
        </div>

        <div className="rounded-xl border border-neutral-900 bg-black/35 px-3 py-2">
          <p className="cf-tech-label text-[9px] uppercase text-neutral-600">Auto recipe</p>
          <p className="mt-1 truncate text-xs font-semibold text-white">
            {getTaskTypeLabel(activePreset.taskType)} · {getTargetToolLabel(activePreset.targetTool)}
          </p>
        </div>
      </div>
    </section>
  );
}

function ClipboardCheckIcon() {
  return <CheckCircle2 size={12} />;
}


function PresetPickerModal({
  activePreset,
  onSelect,
  onResetDefaults,
  onClose
}: {
  activePreset: BuilderTaskPreset;
  onSelect: (preset: BuilderTaskPreset) => void;
  onResetDefaults: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title="Choose task preset"
      eyebrow="Stage 9.3"
      maxWidth="max-w-6xl"
      scrollable={false}
      onClose={onClose}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <p className="hidden text-xs text-neutral-600 md:block">
            Presets update the recipe. Existing task text stays untouched.
          </p>

          <div className="flex shrink-0 items-center gap-3">
            <Button variant="secondary" onClick={onResetDefaults}>
              <RotateCcw size={15} />
              Reset defaults
            </Button>

            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      }
    >
      <div className="p-5">
        <TaskPresetSelector
          activePreset={activePreset}
          onSelect={(preset) => {
            onSelect(preset);
          }}
        />
      </div>
    </Modal>
  );
}

function RecipeSetupModal({
  draft,
  taskTypeOptions,
  targetToolOptions,
  templateOptions,
  profileOptions,
  selectedTemplate,
  selectedProfile,
  enabledRulesCount,
  customRulesCount,
  totalCriteriaCount,
  onTaskTypeChange,
  onTargetToolChange,
  onTemplateChange,
  onProfileChange,
  onClose
}: {
  draft: TaskPackDraft;
  taskTypeOptions: typeof TASK_TYPE_OPTIONS;
  targetToolOptions: typeof TARGET_TOOL_OPTIONS;
  templateOptions: Array<{ value: string; label: string; description: string }>;
  profileOptions: Array<{ value: string; label: string; description: string }>;
  selectedTemplate: PromptTemplate | undefined;
  selectedProfile: RuleProfile | undefined;
  enabledRulesCount: number;
  customRulesCount: number;
  totalCriteriaCount: number;
  onTaskTypeChange: (taskType: string) => void;
  onTargetToolChange: (targetTool: string) => void;
  onTemplateChange: (templateId: string) => void;
  onProfileChange: (profileId: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title="Recipe setup"
      eyebrow="Templates & rules"
      maxWidth="max-w-5xl"
      scrollable={false}
      onClose={onClose}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <p className="hidden text-xs text-neutral-600 md:block">
            This controls the generated Task Pack format, rule profile and checks.
          </p>

          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      }
    >
      <div className="grid gap-5 p-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <section className="rounded-[1.5rem] border border-neutral-900 bg-black/35 p-5">
          <div className="mb-5 flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-300">
              <Settings2 size={18} />
            </span>

            <div>
              <h3 className="text-base font-semibold text-white">
                Template and rule profile
              </h3>

              <p className="mt-1 max-w-2xl text-xs leading-5 text-neutral-600">
                Choose the task type, target coding agent, prompt template and rule profile for this pack.
              </p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-xs text-neutral-500">
                Task type
              </label>

              <CustomSelect
                value={draft.taskType}
                onChange={onTaskTypeChange}
                options={taskTypeOptions}
              />
            </div>

            <div>
              <label className="mb-2 block text-xs text-neutral-500">
                Target AI tool
              </label>

              <CustomSelect
                value={draft.targetTool}
                onChange={onTargetToolChange}
                options={targetToolOptions}
              />
            </div>

            <div>
              <label className="mb-2 block text-xs text-neutral-500">
                Prompt template
              </label>

              <CustomSelect
                value={draft.templateId ?? ""}
                onChange={onTemplateChange}
                options={templateOptions}
              />
            </div>

            <div>
              <label className="mb-2 block text-xs text-neutral-500">
                Rule profile
              </label>

              <CustomSelect
                value={draft.ruleProfileId ?? ""}
                onChange={onProfileChange}
                options={profileOptions}
              />
            </div>
          </div>
        </section>

        <aside className="rounded-[1.5rem] border border-neutral-900 bg-black/35 p-5">
          <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
            Applied recipe
          </p>

          <h3 className="mt-1 text-base font-semibold text-white">
            What will be inserted
          </h3>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <CompactMetric
              label="Task"
              value={getTaskTypeLabel(draft.taskType)}
              caption={getTargetToolLabel(draft.targetTool)}
            />

            <CompactMetric
              label="Rules"
              value={enabledRulesCount}
              caption="toggle"
            />

            <CompactMetric
              label="Custom"
              value={customRulesCount}
              caption="rules"
            />

            <CompactMetric
              label="Checks"
              value={totalCriteriaCount}
              caption="criteria"
            />
          </div>

          <div className="mt-4 space-y-2">
            <div className="rounded-2xl border border-neutral-900 bg-black/35 p-3">
              <p className="text-xs font-semibold text-white">
                {selectedTemplate?.name ?? "No template selected"}
              </p>

              <p className="mt-1 truncate text-[11px] text-neutral-600">
                Prompt template
              </p>
            </div>

            <div className="rounded-2xl border border-neutral-900 bg-black/35 p-3">
              <p className="text-xs font-semibold text-white">
                {selectedProfile?.name ?? "No rule profile selected"}
              </p>

              <p className="mt-1 truncate text-[11px] text-neutral-600">
                Rule profile
              </p>
            </div>
          </div>
        </aside>
      </div>
    </Modal>
  );
}

function RuleToggleRow({
  rule,
  checked,
  onToggle
}: {
  rule: RuleItem;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={[
        "group flex w-full items-start gap-3 rounded-xl border p-3 text-left transition",
        checked
          ? "border-white/20 bg-white/[0.055]"
          : "border-neutral-900 bg-black/25 hover:border-white/20 hover:bg-white/[0.035]"
      ].join(" ")}
    >
      <span
        className={[
          "mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border transition",
          checked
            ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
            : "border-neutral-800 bg-neutral-950 text-neutral-700 group-hover:text-white"
        ].join(" ")}
      >
        {checked && <Check size={12} />}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-xs font-semibold text-white">
            {rule.title}
          </span>

          <span className="rounded-full border border-neutral-800 bg-neutral-950 px-2 py-0.5 text-[10px] text-neutral-500">
            {rule.category}
          </span>
        </span>

        <span className="mt-1 block line-clamp-2 text-[11px] leading-4 text-neutral-600">
          {rule.description}
        </span>
      </span>
    </button>
  );
}

function SelectedRulePreview({
  rule
}: {
  rule: RuleItem;
}) {
  return (
    <div className="rounded-xl border border-neutral-900 bg-black/35 px-3 py-2">
      <div className="flex items-center gap-2">
        <CheckCircle2 size={13} className="shrink-0 text-emerald-300" />

        <p className="truncate text-xs font-medium text-white">
          {rule.title}
        </p>
      </div>

      <p className="mt-1 truncate text-[11px] text-neutral-600">
        {rule.category}
      </p>
    </div>
  );
}

function RulesManagerModal({
  visibleRuleItems,
  selectedRuleItems,
  enabledRuleIds,
  enabledRuleIdSet,
  selectedProfile,
  onToggle,
  onResetToProfile,
  onClose
}: {
  visibleRuleItems: RuleItem[];
  selectedRuleItems: RuleItem[];
  enabledRuleIds: string[];
  enabledRuleIdSet: Set<string>;
  selectedProfile: RuleProfile | undefined;
  onToggle: (ruleId: string) => void;
  onResetToProfile: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const categories = useMemo(
    () => Array.from(new Set(visibleRuleItems.map((rule) => rule.category))),
    [visibleRuleItems]
  );

  const filteredRules = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return visibleRuleItems.filter((rule) => {
      const matchesQuery =
        !normalizedQuery ||
        [rule.title, rule.description, rule.content, rule.category]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);

      const matchesCategory =
        categoryFilter === "all" || rule.category === categoryFilter;

      return matchesQuery && matchesCategory;
    });
  }, [categoryFilter, query, visibleRuleItems]);

  return (
    <Modal
      title="Manage enabled rules"
      eyebrow="Rules & Templates"
      maxWidth="max-w-7xl"
      scrollable={false}
      onClose={onClose}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <div className="hidden min-w-0 md:block">
            <p className="text-xs font-medium text-white">
              {enabledRuleIds.length} rule(s) will be inserted into the Task Pack.
            </p>

            <p className="mt-0.5 text-[11px] text-neutral-600">
              Backend validates selected rule IDs before rendering the final prompt.
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <Button
              variant="secondary"
              onClick={onResetToProfile}
              disabled={!selectedProfile}
            >
              <RotateCcw size={15} />
              Profile defaults
            </Button>

            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid h-[min(760px,calc(100vh-190px))] min-h-0 gap-5 p-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-[1.75rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.012))] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.045)]">
          <div className="shrink-0">
            <div className="mb-4 flex items-center justify-between gap-3">
              <span className="grid size-11 place-items-center rounded-2xl border border-neutral-800 bg-neutral-950 text-emerald-300">
                <ShieldCheck size={19} />
              </span>

              <Pill tone="success">
                {enabledRuleIds.length} enabled
              </Pill>
            </div>

            <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
              Current selection
            </p>

            <h3 className="mt-1 text-xl font-semibold tracking-[-0.04em] text-white">
              Selected constraints
            </h3>

            <p className="mt-2 text-xs leading-5 text-neutral-600">
              This list is exactly what the generated Task Pack will receive as toggle rules.
            </p>

            {selectedProfile && (
              <div className="mt-4 rounded-2xl border border-neutral-900 bg-black/35 p-3">
                <p className="text-xs font-semibold text-white">
                  {selectedProfile.name}
                </p>

                <p className="mt-1 text-[11px] leading-4 text-neutral-600">
                  Current rule profile · {selectedProfile.enabledRuleIds.length} default rule(s)
                </p>
              </div>
            )}
          </div>

          <div className="mt-4 min-h-0 flex-1 overflow-hidden rounded-2xl border border-neutral-900 bg-black/25 p-2">
            <div className="h-full space-y-2 overflow-y-auto pr-1">
              {selectedRuleItems.length > 0 ? (
                selectedRuleItems.map((rule) => (
                  <button
                    key={rule.id}
                    type="button"
                    onClick={() => onToggle(rule.id)}
                    className="group flex w-full items-start gap-3 rounded-xl border border-neutral-900 bg-black/35 px-3 py-2.5 text-left transition hover:border-red-400/25 hover:bg-red-400/[0.035]"
                  >
                    <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border border-emerald-400/25 bg-emerald-400/10 text-emerald-300 transition group-hover:border-red-400/25 group-hover:bg-red-400/10 group-hover:text-red-200">
                      <Check size={12} />
                    </span>

                    <span className="min-w-0">
                      <span className="block truncate text-xs font-semibold text-white">
                        {rule.title}
                      </span>

                      <span className="mt-1 block truncate text-[11px] text-neutral-600">
                        {rule.category} · click to disable
                      </span>
                    </span>
                  </button>
                ))
              ) : (
                <div className="grid h-full place-items-center rounded-xl border border-dashed border-neutral-800 p-5 text-center">
                  <div>
                    <p className="text-sm font-semibold text-white">
                      No rules enabled
                    </p>

                    <p className="mt-2 text-xs leading-5 text-neutral-600">
                      Select rules from the right panel or restore profile defaults.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </aside>

        <section className="flex min-h-0 flex-col overflow-hidden rounded-[1.75rem] border border-white/10 bg-black/35 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
          <div className="shrink-0">
            <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-start 2xl:justify-between">
              <div>
                <div className="mb-4 flex size-11 items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-300">
                  <SlidersHorizontal size={19} />
                </div>

                <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                  Available rules
                </p>

                <h3 className="mt-1 text-xl font-semibold tracking-[-0.04em] text-white">
                  Toggle workflow constraints
                </h3>

                <p className="mt-2 max-w-2xl text-xs leading-5 text-neutral-600">
                  Pick only the rules that matter for this task. Keep the enabled set focused to avoid prompt noise.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-2 rounded-2xl border border-neutral-900 bg-black/30 p-2">
                <CompactMetric
                  label="Visible"
                  value={filteredRules.length}
                  caption="rules"
                />

                <CompactMetric
                  label="Enabled"
                  value={enabledRuleIds.length}
                  caption="selected"
                />

                <CompactMetric
                  label="Profile"
                  value={selectedProfile?.enabledRuleIds.length ?? 0}
                  caption="defaults"
                />
              </div>
            </div>

            <div className="mt-5 grid gap-3 xl:grid-cols-[minmax(0,1fr)_220px]">
              <div className="relative">
                <Search
                  size={15}
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-neutral-600"
                />

                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search rules..."
                  className="h-11 w-full rounded-2xl border border-neutral-900 bg-black/45 pl-10 pr-4 text-sm text-white outline-none transition placeholder:text-neutral-700 hover:border-neutral-800 focus:border-white/30 focus:bg-black/70 focus:ring-4 focus:ring-white/5"
                />
              </div>

              <CustomSelect
                value={categoryFilter}
                onChange={setCategoryFilter}
                options={[
                  {
                    value: "all",
                    label: "All categories",
                    description: "Show all visible rules"
                  },
                  ...categories.map((category) => ({
                    value: category,
                    label: category,
                    description: "Rule category"
                  }))
                ]}
              />
            </div>
          </div>

          <div className="mt-5 min-h-0 flex-1 overflow-hidden rounded-2xl border border-neutral-900 bg-black/20 p-3">
            <div className="h-full overflow-y-auto pr-1">
              {filteredRules.length > 0 ? (
                <div className="grid gap-3 2xl:grid-cols-2">
                  {filteredRules.map((rule) => (
                    <RuleToggleRow
                      key={rule.id}
                      rule={rule}
                      checked={enabledRuleIdSet.has(rule.id)}
                      onToggle={() => onToggle(rule.id)}
                    />
                  ))}
                </div>
              ) : (
                <div className="grid h-full place-items-center rounded-xl border border-dashed border-neutral-800 p-8 text-center">
                  <div>
                    <p className="text-sm font-semibold text-white">
                      No rules found
                    </p>

                    <p className="mt-2 text-xs leading-5 text-neutral-600">
                      Try a different search query or category filter.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </Modal>
  );
}

export function TaskPackBuilderPage({
  draft,
  isLoading,
  contextPreview = null,
  onChange,
  onClose,
  onAnalyzeContext,
  onOpenContextComposer,
  onGenerate
}: TaskPackBuilderPageProps) {
  const { t } = useTranslation();

  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [ruleProfiles, setRuleProfiles] = useState<RuleProfile[]>([]);
  const [ruleItems, setRuleItems] = useState<RuleItem[]>([]);
  const [acceptancePresets, setAcceptancePresets] = useState<AcceptanceCriteriaPreset[]>([]);
  const [catalogStatus, setCatalogStatus] = useState("Loading rules and templates...");
  const [isRulesModalOpen, setIsRulesModalOpen] = useState(false);
  const [isPresetModalOpen, setIsPresetModalOpen] = useState(false);
  const [isRecipeModalOpen, setIsRecipeModalOpen] = useState(false);
  const [isQualityModalOpen, setIsQualityModalOpen] = useState(false);
  const [isUnderstandingModalOpen, setIsUnderstandingModalOpen] = useState(false);
  const [isUnderstanding, setIsUnderstanding] = useState(false);
  const [understandingResponse, setUnderstandingResponse] =
    useState<TaskUnderstandingResponse | null>(null);
  const [understandingDraft, setUnderstandingDraft] =
    useState<TaskPackDraft | null>(null);
  const [understandingAnswer, setUnderstandingAnswer] = useState("");
  const [understandingError, setUnderstandingError] = useState<string | null>(null);
  const [pendingUnderstandingAction, setPendingUnderstandingAction] =
    useState<TaskUnderstandingPendingAction>(null);
  const [activeBuilderSection, setActiveBuilderSection] = useState<BuilderSection>("task");
  const [contextFileFilter, setContextFileFilter] = useState<ContextFileFilter>("all");
  const [contextReviewMode, setContextReviewMode] = useState<ContextReviewMode>("files");
  const [contextBudgetMode, setContextBudgetMode] = useState<ContextBudgetMode>("standard");
  const [showContextTechnicalDetails, setShowContextTechnicalDetails] = useState(false);
  const [gitStatus, setGitStatus] = useState<GitStatusResult | null>(null);
  const [isGitStatusLoading, setIsGitStatusLoading] = useState(false);
  const [gitStatusError, setGitStatusError] = useState<string | null>(null);
  const [activeTaskPresetId, setActiveTaskPresetId] = useState(
    () => getBuilderPresetForTaskType(draft.taskType).id
  );

  const taskLength = draft.rawTask.trim().length;
  const taskQuality = useMemo(() => getTaskQuality(draft.rawTask, t), [draft.rawTask, t]);
  const canGenerate = taskLength >= 3 && !isLoading && !isUnderstanding;

  const selectedTemplate = templates.find((template) => template.id === draft.templateId);
  const selectedProfile = ruleProfiles.find((profile) => profile.id === draft.ruleProfileId);
  const selectedPreset = acceptancePresets.find(
    (preset) => preset.id === draft.acceptanceCriteriaPresetId
  );
  const activeTaskPreset =
    BUILDER_TASK_PRESETS.find((preset) => preset.id === activeTaskPresetId) ??
    getBuilderPresetForTaskType(draft.taskType);

  const enabledRuleIds = draft.enabledRuleIds ?? [];
  const enabledRuleIdSet = useMemo(() => new Set(enabledRuleIds), [enabledRuleIds]);

  const customRulesCount = getLinesCount(draft.customRulesText);
  const customCriteriaCount = getLinesCount(draft.acceptanceCriteriaText);
  const presetCriteriaCount = selectedPreset?.criteria.length ?? 0;
  const totalCriteriaCount = presetCriteriaCount + customCriteriaCount;

  const selectedRuleItems = useMemo(
    () => ruleItems.filter((rule) => enabledRuleIdSet.has(rule.id)),
    [enabledRuleIdSet, ruleItems]
  );

  const qualityResult = useMemo(
    () =>
      evaluateTaskPackQuality({
        draft,
        selectedTemplate,
        selectedProfile,
        selectedAcceptancePreset: selectedPreset,
        enabledRulesCount: enabledRuleIds.length,
        customRulesCount,
        totalCriteriaCount
      }),
    [
      draft,
      selectedTemplate,
      selectedProfile,
      selectedPreset,
      enabledRuleIds.length,
      customRulesCount,
      totalCriteriaCount
    ]
  );

  const contextSummary = useMemo(
    () => buildContextReviewSummary(contextPreview),
    [contextPreview]
  );

  const builderSectionItems = useMemo<BuilderSectionNavigationItem[]>(
    () => [
      {
        value: "task",
        label: "Task",
        description:
          taskLength >= 120
            ? "Ready"
            : taskLength >= 3
              ? "Needs detail"
              : "Start here",
        icon: <Sparkles size={14} />
      },
      {
        value: "recipe",
        label: "Recipe",
        description: `${getTaskTypeLabel(draft.taskType)} · ${getTargetToolLabel(draft.targetTool)}`,
        icon: <Settings2 size={14} />
      },
      {
        value: "rules",
        label: "Rules",
        description: `${enabledRuleIds.length} enabled`,
        icon: <ShieldCheck size={14} />
      },
      {
        value: "acceptance",
        label: "Acceptance",
        description: `${totalCriteriaCount} ${totalCriteriaCount === 1 ? "check" : "checks"}`,
        icon: <CheckCircle2 size={14} />
      },
      {
        value: "context",
        label: "Context",
        description: contextSummary.isAnalyzed
          ? `${contextSummary.files.length} files`
          : "Not analyzed",
        icon: <Search size={14} />
      }
    ],
    [
      contextSummary.files.length,
      contextSummary.isAnalyzed,
      draft.targetTool,
      draft.taskType,
      enabledRuleIds.length,
      taskLength,
      totalCriteriaCount
    ]
  );

  const activeBuilderSectionIndex = Math.max(
    0,
    builderSectionItems.findIndex((item) => item.value === activeBuilderSection)
  );

  const packStatusItems = useMemo<PackStatusItem[]>(
    () => [
      {
        section: "task",
        label: "Task",
        value:
          taskLength >= 120
            ? "Ready"
            : taskLength >= 3
              ? "Needs detail"
              : "Empty",
        caption: `${taskLength} characters`,
        tone: taskLength >= 120 ? "ready" : taskLength >= 3 ? "warning" : "pending",
        icon: <Sparkles size={14} />
      },
      {
        section: "recipe",
        label: "Setup",
        value: selectedTemplate && selectedProfile ? "Configured" : "Review",
        caption: `${getTargetToolLabel(draft.targetTool)} · ${getTaskTypeLabel(draft.taskType)}`,
        tone: selectedTemplate && selectedProfile ? "ready" : "warning",
        icon: <Settings2 size={14} />
      },
      {
        section: "rules",
        label: "Rules",
        value: `${enabledRuleIds.length} enabled`,
        caption: `${customRulesCount} custom`,
        tone: enabledRuleIds.length > 0 ? "ready" : "pending",
        icon: <ShieldCheck size={14} />
      },
      {
        section: "acceptance",
        label: "Acceptance",
        value: `${totalCriteriaCount} checks`,
        caption: totalCriteriaCount > 0 ? "Final verification" : "Add criteria",
        tone: totalCriteriaCount > 0 ? "ready" : "warning",
        icon: <CheckCircle2 size={14} />
      },
      {
        section: "context",
        label: "Context",
        value: contextSummary.label,
        caption: contextSummary.isAnalyzed
          ? `${contextSummary.files.length} files · ${contextSummary.editCount} edit`
          : "Analyze before export",
        tone: !contextSummary.isAnalyzed
          ? "pending"
          : contextSummary.status === "ready"
            ? "ready"
            : "warning",
        icon: <Search size={14} />
      }
    ],
    [
      contextSummary.editCount,
      contextSummary.files.length,
      contextSummary.isAnalyzed,
      contextSummary.label,
      contextSummary.status,
      customRulesCount,
      draft.targetTool,
      draft.taskType,
      enabledRuleIds.length,
      selectedProfile,
      selectedTemplate,
      taskLength,
      totalCriteriaCount
    ]
  );

  const intentResult = useMemo(
    () =>
      analyzeTaskPackIntent({
        draft,
        selectedTemplate,
        selectedProfile,
        contextIntent: contextPreview?.taskIntent ?? null
      }),
    [draft, selectedTemplate, selectedProfile, contextPreview?.taskIntent]
  );

  const rawContextSignals = useMemo(() => {
    if (!contextPreview) {
      return [];
    }

    return [
      ...contextPreview.selectionQuality.blockingReasons,
      ...contextPreview.selectionQuality.warnings,
      ...contextPreview.fileSelection.notes
    ].filter(Boolean);
  }, [contextPreview]);

  const contextWarnings = useMemo(() => {
    const seen = new Set<string>();

    return rawContextSignals
      .filter((signal) => !isTechnicalContextSignal(signal))
      .map(getCompactContextWarning)
      .filter((signal) => {
        if (seen.has(signal)) {
          return false;
        }

        seen.add(signal);
        return true;
      })
      .slice(0, 3);
  }, [rawContextSignals]);

  const contextTechnicalSignals = useMemo(
    () => rawContextSignals.filter(isTechnicalContextSignal).slice(0, 6),
    [rawContextSignals]
  );

  const hasLocalChangesNote = draft.rawTask.includes(LOCAL_CHANGES_NOTE_HEADING);

  const loadGitStatus = useCallback(async () => {
    setIsGitStatusLoading(true);
    setGitStatusError(null);

    try {
      const status = await getProjectGitStatus(draft.projectId);
      setGitStatus(status);
    } catch (error) {
      setGitStatus(null);
      setGitStatusError(
        error instanceof Error
          ? error.message
          : "Failed to read local Git status."
      );
    } finally {
      setIsGitStatusLoading(false);
    }
  }, [draft.projectId]);

  useEffect(() => {
    void loadGitStatus();
  }, [loadGitStatus]);

  useEffect(() => {
    if (contextSummary.isAnalyzed) {
      setContextBudgetMode(getBudgetModeFromLabel(contextSummary.budgetLabel));
    }
  }, [contextSummary.budgetLabel, contextSummary.isAnalyzed]);

  const contextFilterOptions = useMemo<SegmentedFilterOption<ContextFileFilter>[]>(
    () => [
      {
        value: "all",
        label: "All",
        description: `${contextSummary.files.length} files`,
        icon: <FileText size={13} />
      },
      {
        value: "edit",
        label: "Edit",
        description: `${contextSummary.editCount} candidates`,
        icon: <WandSparkles size={13} />
      },
      {
        value: "inspect",
        label: "Inspect",
        description: `${contextSummary.inspectCount + contextSummary.referenceCount} read-only`,
        icon: <Eye size={13} />
      },
      {
        value: "warnings",
        label: "Warnings",
        description: `${contextWarnings.length} signals`,
        icon: <AlertTriangle size={13} />
      }
    ],
    [contextSummary.editCount, contextSummary.files.length, contextSummary.inspectCount, contextSummary.referenceCount, contextWarnings.length]
  );

  const visibleContextFiles = useMemo(() => {
    if (contextFileFilter === "warnings") {
      return [];
    }

    return contextSummary.files
      .filter((file) => {
        if (contextFileFilter === "all") {
          return true;
        }

        const mode = getContextFileMode(file);

        if (contextFileFilter === "edit") {
          return mode === "edit" || mode === "create";
        }

        return mode === "inspect" || mode === "reference";
      })
      .slice(0, 8);
  }, [contextFileFilter, contextSummary.files]);

  useEffect(() => {
    if (!contextSummary.isAnalyzed) {
      setContextFileFilter("all");
      setShowContextTechnicalDetails(false);
    }
  }, [contextSummary.isAnalyzed]);

  const clearUnderstandingState = useCallback(() => {
    setUnderstandingResponse(null);
    setUnderstandingDraft(null);
    setUnderstandingAnswer("");
    setUnderstandingError(null);
    setPendingUnderstandingAction(null);
    setIsUnderstandingModalOpen(false);
  }, []);

  const executeUnderstandingAction = useCallback(
    async (
      action: Exclude<TaskUnderstandingPendingAction, null>,
      draftOverride: TaskPackDraft
    ) => {
      if (action === "analyze") {
        await onAnalyzeContext(draftOverride);
        setActiveBuilderSection("context");
        return;
      }

      await onGenerate(draftOverride);
    },
    [onAnalyzeContext, onGenerate]
  );

  const runUnderstandingPreflight = useCallback(
    async (
      action: Exclude<TaskUnderstandingPendingAction, null>,
      draftOverride: TaskPackDraft = draft
    ) => {
      const performanceSessionId =
        draftOverride.performanceSessionId ?? createPerformanceSessionId();
      const sessionDraft: TaskPackDraft = {
        ...draftOverride,
        performanceSessionId
      };

      if (!draftOverride.performanceSessionId) {
        onChange(sessionDraft);
      }

      setIsUnderstanding(true);
      setUnderstandingError(null);
      setPendingUnderstandingAction(action);
      setUnderstandingDraft(sessionDraft);

      try {
        const response = await understandTaskPack({
          projectId: sessionDraft.projectId,
          rawTask: sessionDraft.rawTask,
          taskType: sessionDraft.taskType,
          targetTool: sessionDraft.targetTool,
          clarifications: sessionDraft.clarifications,
          performanceSessionId,
          understandingSnapshotId: sessionDraft.understandingSnapshotId
        });

        const resolvedDraft: TaskPackDraft = {
          ...sessionDraft,
          clarifications: response.clarifications,
          understandingSnapshotId: response.understandingSnapshotId,
          reviewedUnderstandingSnapshotId:
            sessionDraft.reviewedUnderstandingSnapshotId ===
            response.understandingSnapshotId
              ? sessionDraft.reviewedUnderstandingSnapshotId
              : undefined
        };

        setUnderstandingResponse(response);
        setUnderstandingDraft(resolvedDraft);
        onChange(resolvedDraft);

        if (response.interaction.action === "continue") {
          setIsUnderstandingModalOpen(false);
          await executeUnderstandingAction(action, resolvedDraft);
          return;
        }

        setIsUnderstandingModalOpen(true);
      } catch (error) {
        setUnderstandingError(
          error instanceof Error
            ? error.message
            : t("taskUnderstanding.preflightFailed")
        );
        setActiveBuilderSection("task");
      } finally {
        setIsUnderstanding(false);
      }
    },
    [draft, executeUnderstandingAction, onChange, t]
  );

  const handleAnalyzeContext = useCallback(async () => {
    await runUnderstandingPreflight("analyze");
  }, [runUnderstandingPreflight]);

  const handleGenerateTaskPack = useCallback(async () => {
    await runUnderstandingPreflight("generate");
  }, [runUnderstandingPreflight]);

  const handleSubmitClarification = useCallback(async () => {
    if (!understandingResponse || !pendingUnderstandingAction) {
      return;
    }

    const answer = understandingAnswer.trim();
    if (!answer) {
      return;
    }

    const question =
      understandingResponse.taskUnderstanding.clarificationQuestion ??
      t("taskUnderstanding.fallbackQuestion");
    const baseDraft = understandingDraft ?? draft;
    const clarification: TaskClarification = { question, answer };
    const nextDraft: TaskPackDraft = {
      ...baseDraft,
      clarifications: [...(baseDraft.clarifications ?? []), clarification]
    };

    onChange(nextDraft);
    setUnderstandingAnswer("");
    await runUnderstandingPreflight(pendingUnderstandingAction, nextDraft);
  }, [
    draft,
    onChange,
    pendingUnderstandingAction,
    runUnderstandingPreflight,
    t,
    understandingAnswer,
    understandingDraft,
    understandingResponse
  ]);

  const handleContinueUnderstanding = useCallback(async () => {
    const action = pendingUnderstandingAction;
    const activeDraft = understandingDraft ?? draft;
    const reviewedDraft: TaskPackDraft = understandingResponse
      ? {
          ...activeDraft,
          reviewedUnderstandingSnapshotId:
            understandingResponse.understandingSnapshotId
        }
      : activeDraft;

    setIsUnderstandingModalOpen(false);

    if (action) {
      onChange(reviewedDraft);
      await executeUnderstandingAction(action, reviewedDraft);
    }
  }, [
    draft,
    executeUnderstandingAction,
    onChange,
    pendingUnderstandingAction,
    understandingDraft,
    understandingResponse
  ]);

  const handleEditTaskFromUnderstanding = useCallback(() => {
    setIsUnderstandingModalOpen(false);
    setPendingUnderstandingAction(null);
    setActiveBuilderSection("task");
  }, []);

  const handleOpenFullContextComposer = useCallback(async () => {
    if (onOpenContextComposer) {
      await onOpenContextComposer();
    }
  }, [onOpenContextComposer]);

  const visibleRuleItems = useMemo(() => {
    const taskType = draft.taskType;

    return ruleItems.filter((rule) => {
      if (
        rule.category === "general" ||
        rule.category === "verification" ||
        rule.category === "assets"
      ) {
        return true;
      }

      return rule.category === taskType;
    });
  }, [draft.taskType, ruleItems]);

  const taskExamples = useMemo(
    () =>
      TASK_EXAMPLES.map((example) => ({
        ...example,
        label:
          example.label === "UI polish"
            ? t("taskPackBuilder.exampleUi")
            : example.label === "Bugfix"
              ? t("taskPackBuilder.exampleBugfix")
              : example.label === "Refactor"
                ? t("taskPackBuilder.exampleRefactor")
                : t("taskPackBuilder.exampleBackend")
      })),
    [t]
  );

  const templateOptions = useMemo(
    () =>
      templates.map((template) => ({
        value: template.id,
        label: template.name,
        description: `${template.targetTool} · ${template.taskType}${template.isBuiltin ? " · built-in" : " · custom"}`
      })),
    [templates]
  );

  const profileOptions = useMemo(
    () =>
      ruleProfiles.map((profile) => ({
        value: profile.id,
        label: profile.name,
        description: `${profile.taskType}${profile.isBuiltin ? " · built-in" : " · custom"}`
      })),
    [ruleProfiles]
  );

  const presetOptions = useMemo(
    () => [
      {
        value: "",
        label: "No preset",
        description: "Only custom acceptance criteria"
      },
      ...acceptancePresets.map((preset) => ({
        value: preset.id,
        label: preset.name,
        description: `${preset.taskType}${preset.isBuiltin ? " · built-in" : " · custom"}`
      }))
    ],
    [acceptancePresets]
  );

  function updateDraft(patch: Partial<TaskPackDraft>) {
    const rawTaskChanged =
      typeof patch.rawTask === "string" && patch.rawTask !== draft.rawTask;
    const understandingInputChanged =
      rawTaskChanged ||
      (typeof patch.taskType === "string" && patch.taskType !== draft.taskType) ||
      (typeof patch.targetTool === "string" &&
        patch.targetTool !== draft.targetTool);

    if (understandingInputChanged) {
      clearUnderstandingState();
    }

    onChange({
      ...draft,
      ...patch,
      reviewedUnderstandingSnapshotId: understandingInputChanged
        ? undefined
        : patch.reviewedUnderstandingSnapshotId ??
          draft.reviewedUnderstandingSnapshotId,
      clarifications:
        rawTaskChanged && patch.clarifications === undefined
          ? []
          : patch.clarifications ?? draft.clarifications
    });
  }

  function handleAddLocalChangesNote() {
    if (!gitStatus) {
      return;
    }

    const note = buildLocalChangesNote(gitStatus);

    if (!note) {
      return;
    }

    updateDraft({
      rawTask: mergeLocalChangesNote(draft.rawTask, note)
    });
  }

  function applyGenerationDefaults(nextDraft: TaskPackDraft) {
    clearUnderstandingState();

    const template = findDefaultTemplate(
      templates,
      nextDraft.targetTool,
      nextDraft.taskType
    );

    const profile = findDefaultProfile(ruleProfiles, nextDraft.taskType);

    onChange({
      ...nextDraft,
      templateId: template?.id,
      ruleProfileId: profile?.id,
      enabledRuleIds: profile?.enabledRuleIds ?? [],
      acceptanceCriteriaPresetId: profile?.acceptanceCriteriaPresetId ?? ""
    });
  }

  function applyTaskPreset(preset: BuilderTaskPreset) {
    clearUnderstandingState();
    setActiveTaskPresetId(preset.id);

    const template = findDefaultTemplate(
      templates,
      preset.targetTool,
      preset.taskType
    );

    const profile = findDefaultProfile(ruleProfiles, preset.taskType);
    const shouldSeedTask = Boolean(preset.starterTask) && draft.rawTask.trim().length < 3;
    const shouldSeedCriteria = Boolean(preset.acceptanceText) && !draft.acceptanceCriteriaText?.trim();

    onChange({
      ...draft,
      taskType: preset.taskType,
      targetTool: preset.targetTool,
      rawTask: shouldSeedTask ? preset.starterTask : draft.rawTask,
      clarifications: shouldSeedTask ? [] : draft.clarifications,
      templateId: template?.id,
      ruleProfileId: profile?.id,
      enabledRuleIds: profile?.enabledRuleIds ?? [],
      acceptanceCriteriaPresetId: profile?.acceptanceCriteriaPresetId ?? "",
      acceptanceCriteriaText: shouldSeedCriteria
        ? preset.acceptanceText
        : draft.acceptanceCriteriaText
    });
  }

  function resetRecipeDefaults() {
    clearUnderstandingState();
    const defaultTaskType = "general";
    const defaultTargetTool = "codex";
    const template = findDefaultTemplate(
      templates,
      defaultTargetTool,
      defaultTaskType
    );

    const profile = findDefaultProfile(ruleProfiles, defaultTaskType);

    setActiveTaskPresetId("default");

    onChange({
      ...draft,
      taskType: defaultTaskType,
      targetTool: defaultTargetTool,
      templateId: template?.id,
      ruleProfileId: profile?.id,
      enabledRuleIds: profile?.enabledRuleIds ?? [],
      acceptanceCriteriaPresetId: profile?.acceptanceCriteriaPresetId ?? "",
      acceptanceCriteriaText: ""
    });
  }

  function handleTaskTypeChange(taskType: string) {
    setActiveTaskPresetId(getBuilderPresetForTaskType(taskType).id);

    applyGenerationDefaults({
      ...draft,
      taskType
    });
  }

  function handleTargetToolChange(targetTool: string) {
    applyGenerationDefaults({
      ...draft,
      targetTool
    });
  }

  function handleRuleProfileChange(ruleProfileId: string) {
    const profile = ruleProfiles.find((item) => item.id === ruleProfileId);

    updateDraft({
      ruleProfileId,
      enabledRuleIds: profile?.enabledRuleIds ?? [],
      acceptanceCriteriaPresetId: profile?.acceptanceCriteriaPresetId ?? ""
    });
  }

  function toggleRule(ruleId: string) {
    const next = enabledRuleIdSet.has(ruleId)
      ? enabledRuleIds.filter((item) => item !== ruleId)
      : [...enabledRuleIds, ruleId];

    updateDraft({
      enabledRuleIds: next
    });
  }

  function resetRulesFromProfile() {
    updateDraft({
      enabledRuleIds: selectedProfile?.enabledRuleIds ?? [],
      acceptanceCriteriaPresetId:
        selectedProfile?.acceptanceCriteriaPresetId ??
        draft.acceptanceCriteriaPresetId
    });
  }

  useEffect(() => {
    setActiveTaskPresetId((currentPresetId) => {
      const currentPreset = BUILDER_TASK_PRESETS.find(
        (preset) => preset.id === currentPresetId
      );

      if (currentPreset?.taskType === draft.taskType) {
        return currentPresetId;
      }

      return getBuilderPresetForTaskType(draft.taskType).id;
    });
  }, [draft.taskType]);

  useEffect(() => {
    let isMounted = true;

    async function loadCatalog() {
      try {
        setCatalogStatus("Loading rules and templates...");

        const [templatesData, ruleCatalog] = await Promise.all([
          getTemplates(),
          getRuleProfilesCatalog()
        ]);

        if (!isMounted) {
          return;
        }

        setTemplates(templatesData);
        setRuleProfiles(ruleCatalog.ruleProfiles);
        setRuleItems(ruleCatalog.ruleItems);
        setAcceptancePresets(ruleCatalog.acceptanceCriteriaPresets);
        setCatalogStatus("Rules and templates loaded.");
      } catch (error) {
        setCatalogStatus(
          error instanceof Error
            ? error.message
            : "Failed to load rules and templates."
        );
      }
    }

    loadCatalog();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (templates.length === 0 || ruleProfiles.length === 0) {
      return;
    }

    if (draft.templateId && draft.ruleProfileId) {
      return;
    }

    const template = findDefaultTemplate(templates, draft.targetTool, draft.taskType);
    const profile = findDefaultProfile(ruleProfiles, draft.taskType);

    onChange({
      ...draft,
      templateId: draft.templateId ?? template?.id,
      ruleProfileId: draft.ruleProfileId ?? profile?.id,
      enabledRuleIds:
        draft.enabledRuleIds && draft.enabledRuleIds.length > 0
          ? draft.enabledRuleIds
          : profile?.enabledRuleIds ?? [],
      acceptanceCriteriaPresetId:
        draft.acceptanceCriteriaPresetId ??
        profile?.acceptanceCriteriaPresetId ??
        ""
    });
  }, [templates, ruleProfiles]);

  return (
    <section className="h-[calc(100vh-96px)] min-h-0 overflow-hidden pr-1">
      <div className="flex h-full min-h-0 flex-col gap-4 pb-4">
        <header className="shrink-0 rounded-[1.5rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.01))] p-4 shadow-[0_14px_44px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.04)]">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-neutral-600">
                <Sparkles size={13} />
                <p className="cf-tech-label text-[10px] uppercase">
                  Task Pack workspace · {draft.projectName}
                </p>
              </div>

              <h1 className="mt-2 text-[27px] font-semibold leading-[1.05] tracking-[-0.05em] text-white">
                Build an agent-ready Task Pack.
              </h1>

              <p className="mt-1.5 max-w-3xl text-xs leading-5 text-neutral-500">
                Define the task, confirm the setup, review context, and export one focused instruction pack.
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                <Pill>
                  {getTaskTypeLabel(draft.taskType)} · {getTargetToolLabel(draft.targetTool)}
                </Pill>
                <Pill>{enabledRuleIds.length} rules</Pill>
                <Pill>{totalCriteriaCount} checks</Pill>
                <Pill tone={catalogStatus === "Rules and templates loaded." ? "success" : "default"}>
                  {catalogStatus}
                </Pill>
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap gap-2">
              <Button variant="secondary" onClick={onClose}>
                <ArrowLeft size={15} />
                {t("taskPackBuilder.back")}
              </Button>

              <Button
                variant="secondary"
                onClick={handleAnalyzeContext}
                disabled={!canGenerate}
              >
                <Sparkles size={15} />
                {t("taskPackBuilder.analyzeContext")}
              </Button>

              <Button
                variant="primary"
                onClick={handleGenerateTaskPack}
                disabled={!canGenerate}
              >
                {isLoading || isUnderstanding ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <WandSparkles size={15} />
                )}
                {isUnderstanding
                  ? t("taskUnderstanding.analyzing")
                  : isLoading
                    ? t("taskPackBuilder.generating")
                    : t("taskPackBuilder.generateTaskPack")}
              </Button>
            </div>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_310px]">
          <main className="flex min-h-0 flex-col overflow-hidden rounded-[1.5rem] border border-neutral-900 bg-black/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
            <div className="shrink-0 border-b border-neutral-900/80 p-3">
              <HorizontalSlidingSelector
                items={builderSectionItems}
                activeIndex={activeBuilderSectionIndex}
                getItemKey={(item) => item.value}
                onSelect={(item) => setActiveBuilderSection(item.value)}
                ariaLabel="Task Pack workflow sections"
                className="h-14"
                itemClassName="rounded-[0.95rem]"
                renderItem={(item, isActive) => (
                  <div className="flex h-full min-w-0 items-center justify-center gap-2.5 px-2 text-left">
                    <span
                      className={[
                        "grid size-7 shrink-0 place-items-center rounded-xl border transition-colors",
                        isActive
                          ? "border-black/10 bg-black/[0.045] text-black"
                          : "border-neutral-800 bg-neutral-950 text-neutral-500"
                      ].join(" ")}
                    >
                      {item.icon}
                    </span>

                    <span className="min-w-0">
                      <span className={[
                        "block truncate text-xs font-semibold",
                        isActive ? "text-black" : "text-neutral-300"
                      ].join(" ")}>
                        {item.label}
                      </span>
                      <span className={[
                        "mt-0.5 block truncate text-[10px]",
                        isActive ? "text-black/50" : "text-neutral-600"
                      ].join(" ")}>
                        {item.description}
                      </span>
                    </span>
                  </div>
                )}
              />
            </div>

            <motion.div
              key={activeBuilderSection}
              className="min-h-0 flex-1 overflow-y-auto p-4"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
            >
              {activeBuilderSection === "task" && (
                <section className="flex h-full min-h-[480px] flex-col">
                  <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                        Task
                      </p>

                      <h2 className="mt-2 text-xl font-semibold tracking-[-0.035em] text-white">
                        Describe what the coding agent should do.
                      </h2>

                      <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-500">
                        Keep the request concrete. Preset, recipe and repository context stay visible below without competing with the editor.
                      </p>
                    </div>

                    <div className="flex items-center gap-2 rounded-2xl border border-neutral-900 bg-black/35 px-3 py-2">
                      <span className={taskQuality.tone}>
                        {taskQuality.icon}
                      </span>

                      <div>
                        <p className="text-xs font-semibold text-white">
                          {taskQuality.label}
                        </p>

                        <p className="text-[11px] text-neutral-600">
                          {taskLength} chars
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex flex-wrap gap-2">
                      {taskExamples.map((example) => (
                        <button
                          key={example.label}
                          type="button"
                          onClick={() => updateDraft({ rawTask: example.value })}
                          className="inline-flex h-8 items-center rounded-full border border-neutral-800 bg-neutral-950 px-3 text-xs font-medium text-neutral-400 transition hover:border-white/20 hover:text-white"
                        >
                          {example.label}
                        </button>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => setIsPresetModalOpen(true)}
                      className="inline-flex h-8 items-center gap-2 rounded-full border border-neutral-800 bg-neutral-950 px-3 text-xs font-medium text-neutral-300 transition hover:border-white/20 hover:text-white"
                    >
                      <Sparkles size={13} />
                      Change preset
                    </button>
                  </div>

                  <div className="flex min-h-[300px] flex-1 flex-col overflow-hidden rounded-[1.5rem] border border-neutral-900 bg-black/45 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-900 px-4 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="grid size-8 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-300">
                          <FileText size={14} />
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-white">Task brief</p>
                          <p className="mt-0.5 text-[10px] text-neutral-600">
                            Main instruction sent into Understanding and generation
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 text-[10px] text-neutral-600">
                        <span>{taskLength} characters</span>
                        <span className="size-1 rounded-full bg-neutral-800" />
                        <span>{taskQuality.label}</span>
                      </div>
                    </div>

                    <textarea
                      value={draft.rawTask}
                      onChange={(event) => updateDraft({ rawTask: event.target.value })}
                      placeholder={t("taskPackBuilder.placeholder")}
                      className="min-h-[250px] flex-1 resize-none overflow-y-auto bg-transparent px-5 py-4 text-sm leading-7 text-white outline-none placeholder:text-neutral-700"
                    />
                  </div>

                  <section className="mt-4 rounded-[1.5rem] border border-neutral-900 bg-black/30 p-3">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-1">
                      <div>
                        <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
                          Task setup
                        </p>
                        <p className="mt-1 text-xs text-neutral-500">
                          Preset, recipe, repository state and current understanding in one place.
                        </p>
                      </div>

                      <span className="rounded-full border border-neutral-900 bg-black/35 px-2.5 py-1 text-[10px] text-neutral-600">
                        Supporting context · not automatic edit scope
                      </span>
                    </div>

                    <div className="grid gap-2 xl:grid-cols-[minmax(0,1.15fr)_minmax(220px,0.8fr)_minmax(0,1.25fr)]">
                      <button
                        type="button"
                        onClick={() => setIsPresetModalOpen(true)}
                        className="flex min-h-[104px] min-w-0 flex-col justify-between rounded-2xl border border-neutral-900 bg-black/25 p-3 text-left transition hover:border-white/15 hover:bg-white/[0.035]"
                      >
                        <div className="flex min-w-0 items-start gap-3">
                          <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-300">
                            {activeTaskPreset.icon}
                          </span>
                          <div className="min-w-0">
                            <p className="cf-tech-label text-[9px] uppercase text-neutral-600">Preset</p>
                            <p className="mt-1 truncate text-sm font-semibold text-white">{activeTaskPreset.title}</p>
                            <p className="mt-1 line-clamp-1 text-[11px] text-neutral-600">{activeTaskPreset.focus}</p>
                          </div>
                        </div>
                        <span className="mt-3 text-[11px] font-medium text-neutral-400">Change preset</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setActiveBuilderSection("recipe")}
                        className="flex min-h-[104px] min-w-0 flex-col justify-between rounded-2xl border border-neutral-900 bg-black/25 p-3 text-left transition hover:border-white/15 hover:bg-white/[0.035]"
                      >
                        <div>
                          <p className="cf-tech-label text-[9px] uppercase text-neutral-600">Recipe</p>
                          <p className="mt-2 truncate text-sm font-semibold text-white">
                            {getTaskTypeLabel(draft.taskType)} · {getTargetToolLabel(draft.targetTool)}
                          </p>
                          <p className="mt-1 truncate text-[11px] text-neutral-600">
                            {selectedTemplate?.name ?? "No template"}
                          </p>
                        </div>
                        <span className="mt-3 text-[11px] font-medium text-neutral-400">Review setup</span>
                      </button>

                      <LocalChangesCompactStrip
                        status={gitStatus}
                        isLoading={isGitStatusLoading}
                        error={gitStatusError}
                        onRefresh={() => void loadGitStatus()}
                        onAddNote={handleAddLocalChangesNote}
                        onViewDetails={() => setActiveBuilderSection("context")}
                        hasNote={hasLocalChangesNote}
                      />
                    </div>

                    <div className="mt-2">
                      {understandingResponse ? (
                        <BackendTaskUnderstandingCard
                          response={understandingResponse}
                          onOpen={() => {
                            setPendingUnderstandingAction(null);
                            setUnderstandingDraft(draft);
                            setIsUnderstandingModalOpen(true);
                          }}
                        />
                      ) : (
                        <TaskIntentCard
                          intent={intentResult}
                          onOpenRecipe={() => setActiveBuilderSection("recipe")}
                          onOpenContext={() => setActiveBuilderSection("context")}
                        />
                      )}
                    </div>
                  </section>

                  {understandingError && (
                    <div className="mt-3 rounded-2xl border border-red-400/20 bg-red-400/[0.055] p-3 text-xs leading-5 text-red-100">
                      {understandingError}
                    </div>
                  )}
                </section>
              )}

              {activeBuilderSection === "recipe" && (
                <section className="space-y-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                        Recipe
                      </p>

                      <h2 className="mt-2 text-xl font-semibold tracking-[-0.035em] text-white">
                        Template and agent setup.
                      </h2>

                      <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-500">
                        Choose how ContextForge frames the Task Pack before it is exported to an external coding agent.
                      </p>
                    </div>

                    <div className="flex gap-2">
                      <Button variant="secondary" onClick={() => setIsPresetModalOpen(true)}>
                        <Sparkles size={15} />
                        Preset
                      </Button>

                      <Button variant="secondary" onClick={resetRecipeDefaults}>
                        <RotateCcw size={15} />
                        Defaults
                      </Button>
                    </div>
                  </div>

                  <section className="overflow-hidden rounded-[1.5rem] border border-neutral-900 bg-black/35">
                    <div className="grid md:grid-cols-2">
                      <div className="border-b border-neutral-900 p-4 md:border-r">
                        <label className="mb-2 block text-xs font-medium text-neutral-400">
                          Task type
                        </label>
                        <p className="mb-3 text-[11px] leading-5 text-neutral-600">
                          Defines the structure and intent expected in the exported instruction.
                        </p>

                        <CustomSelect
                          value={draft.taskType}
                          onChange={handleTaskTypeChange}
                          options={TASK_TYPE_OPTIONS}
                        />
                      </div>

                      <div className="border-b border-neutral-900 p-4">
                        <label className="mb-2 block text-xs font-medium text-neutral-400">
                          Target AI tool
                        </label>
                        <p className="mb-3 text-[11px] leading-5 text-neutral-600">
                          Selects the coding-agent format used for the final Task Pack.
                        </p>

                        <CustomSelect
                          value={draft.targetTool}
                          onChange={handleTargetToolChange}
                          options={TARGET_TOOL_OPTIONS}
                        />
                      </div>

                      <div className="border-b border-neutral-900 p-4 md:border-b-0 md:border-r">
                        <label className="mb-2 block text-xs font-medium text-neutral-400">
                          Prompt template
                        </label>
                        <p className="mb-3 text-[11px] leading-5 text-neutral-600">
                          Provides the reusable instruction frame for this task and agent.
                        </p>

                        <CustomSelect
                          value={draft.templateId ?? ""}
                          onChange={(value) => updateDraft({ templateId: value })}
                          options={templateOptions}
                        />
                      </div>

                      <div className="p-4">
                        <label className="mb-2 block text-xs font-medium text-neutral-400">
                          Rule profile
                        </label>
                        <p className="mb-3 text-[11px] leading-5 text-neutral-600">
                          Supplies the baseline safety and workflow constraints.
                        </p>

                        <CustomSelect
                          value={draft.ruleProfileId ?? ""}
                          onChange={handleRuleProfileChange}
                          options={profileOptions}
                        />
                      </div>
                    </div>

                    <div className="border-t border-neutral-900 bg-white/[0.015] p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                          <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
                            Applied output
                          </p>
                          <p className="mt-1 text-sm font-semibold text-white">
                            What will be inserted into the Task Pack
                          </p>
                        </div>

                        <div className="flex flex-wrap gap-2 text-[11px] text-neutral-500">
                          <span>{enabledRuleIds.length} enabled rules</span>
                          <span className="text-neutral-800">•</span>
                          <span>{customRulesCount} custom rules</span>
                          <span className="text-neutral-800">•</span>
                          <span>{totalCriteriaCount} checks</span>
                        </div>
                      </div>

                      <div className="mt-4 grid divide-y divide-neutral-900 overflow-hidden rounded-2xl border border-neutral-900 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                        <div className="min-w-0 p-3">
                          <p className="cf-tech-label text-[9px] uppercase text-neutral-600">Prompt template</p>
                          <p className="mt-1 truncate text-xs font-semibold text-white">
                            {selectedTemplate?.name ?? "No template selected"}
                          </p>
                        </div>

                        <div className="min-w-0 p-3">
                          <p className="cf-tech-label text-[9px] uppercase text-neutral-600">Rule profile</p>
                          <p className="mt-1 truncate text-xs font-semibold text-white">
                            {selectedProfile?.name ?? "No rule profile selected"}
                          </p>
                        </div>
                      </div>
                    </div>
                  </section>
                </section>
              )}

              {activeBuilderSection === "rules" && (
                <section className="space-y-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                        Rules
                      </p>

                      <h2 className="mt-2 text-xl font-semibold tracking-[-0.035em] text-white">
                        Constraints and project boundaries.
                      </h2>

                      <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-500">
                        Keep reusable profile rules visible while adding only the task-specific limits this request needs.
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <Pill tone={customRulesCount > 0 ? "success" : "default"}>
                        {customRulesCount} custom
                      </Pill>

                      <button
                        type="button"
                        onClick={() => setIsRulesModalOpen(true)}
                        className="cf-invert-action inline-flex h-9 shrink-0 items-center gap-2 rounded-full px-4 text-xs"
                      >
                        <SlidersHorizontal size={13} />
                        Manage rules
                      </button>
                    </div>
                  </div>

                  <section className="overflow-hidden rounded-[1.5rem] border border-neutral-900 bg-black/35">
                    <div className="grid xl:grid-cols-[minmax(0,1fr)_360px]">
                      <div className="p-4 xl:border-r xl:border-neutral-900">
                        <div className="mb-3 flex items-start justify-between gap-4">
                          <div>
                            <p className="text-sm font-semibold text-white">Extra constraints</p>
                            <p className="mt-1 text-[11px] leading-5 text-neutral-600">
                              One instruction per line works best. These are added after the selected rule profile.
                            </p>
                          </div>
                        </div>

                        <textarea
                          value={draft.customRulesText ?? ""}
                          onChange={(event) => updateDraft({ customRulesText: event.target.value })}
                          placeholder={[
                            "Do not change backend/API behavior.",
                            "Do not add new dependencies.",
                            "Keep AppTitleBar untouched."
                          ].join("\n")}
                          className="h-[280px] w-full resize-none overflow-y-auto rounded-2xl border border-neutral-900 bg-black/55 p-4 text-sm leading-6 text-white outline-none placeholder:text-neutral-700 focus:border-white/20"
                        />
                      </div>

                      <aside className="border-t border-neutral-900 p-4 xl:border-t-0">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-white">Enabled profile rules</p>
                            <p className="mt-1 text-[11px] text-neutral-600">
                              {enabledRuleIds.length} constraints currently active
                            </p>
                          </div>
                          <Pill tone={enabledRuleIds.length > 0 ? "success" : "default"}>
                            {enabledRuleIds.length}
                          </Pill>
                        </div>

                        <div className="max-h-[310px] space-y-2 overflow-y-auto pr-1">
                          {selectedRuleItems.length > 0 ? (
                            selectedRuleItems.map((rule) => (
                              <SelectedRulePreview key={rule.id} rule={rule} />
                            ))
                          ) : (
                            <div className="rounded-xl border border-neutral-900 bg-black/35 p-3 text-xs leading-5 text-neutral-600">
                              No toggle rules enabled. Select a profile or open the rule manager.
                            </div>
                          )}
                        </div>
                      </aside>
                    </div>
                  </section>
                </section>
              )}

              {activeBuilderSection === "acceptance" && (
                <section className="space-y-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                        Acceptance
                      </p>

                      <h2 className="mt-2 text-xl font-semibold tracking-[-0.035em] text-white">
                        Checks for the final answer.
                      </h2>

                      <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-500">
                        Define what the coding agent must verify before the task can be considered complete.
                      </p>
                    </div>

                    <Pill tone={customCriteriaCount > 0 ? "success" : "default"}>
                      {totalCriteriaCount} checks
                    </Pill>
                  </div>

                  <section className="overflow-hidden rounded-[1.5rem] border border-neutral-900 bg-black/35">
                    <div className="grid xl:grid-cols-[minmax(0,1fr)_360px]">
                      <div className="p-4 xl:border-r xl:border-neutral-900">
                        <div className="mb-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_220px] md:items-end">
                          <div>
                            <label className="mb-2 block text-xs font-medium text-neutral-400">
                              Acceptance preset
                            </label>
                            <CustomSelect
                              value={draft.acceptanceCriteriaPresetId ?? ""}
                              onChange={(value) => updateDraft({ acceptanceCriteriaPresetId: value || undefined })}
                              options={presetOptions}
                            />
                          </div>

                          <div className="rounded-2xl border border-neutral-900 bg-black/35 px-3 py-2.5">
                            <p className="cf-tech-label text-[9px] uppercase text-neutral-600">Custom checks</p>
                            <p className="mt-1 text-sm font-semibold text-white">{customCriteriaCount}</p>
                          </div>
                        </div>

                        <div className="mb-3">
                          <p className="text-sm font-semibold text-white">Additional verification</p>
                          <p className="mt-1 text-[11px] leading-5 text-neutral-600">
                            Add only the checks that are unique to this task. Preset checks remain visible on the right.
                          </p>
                        </div>

                        <textarea
                          value={draft.acceptanceCriteriaText ?? ""}
                          onChange={(event) => updateDraft({ acceptanceCriteriaText: event.target.value })}
                          placeholder={[
                            "Add extra acceptance criteria here.",
                            "Example: final response must list verification steps."
                          ].join("\n")}
                          className="h-[260px] w-full resize-none overflow-y-auto rounded-2xl border border-neutral-900 bg-black/55 p-4 text-sm leading-6 text-white outline-none placeholder:text-neutral-700 focus:border-white/20"
                        />
                      </div>

                      <aside className="border-t border-neutral-900 p-4 xl:border-t-0">
                        <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
                          Current preset
                        </p>

                        <h3 className="mt-1 text-sm font-semibold text-white">
                          {selectedPreset?.name ?? "No preset selected"}
                        </h3>

                        <p className="mt-1 text-[11px] leading-5 text-neutral-600">
                          {selectedPreset?.criteria?.length
                            ? `${selectedPreset.criteria.length} reusable checks will be included automatically.`
                            : "Choose a preset or add custom checks manually."}
                        </p>

                        <div className="mt-4 max-h-[320px] space-y-2 overflow-y-auto pr-1">
                          {selectedPreset?.criteria?.length ? (
                            selectedPreset.criteria.map((criteria, index) => (
                              <div
                                key={criteria}
                                className="flex items-start gap-3 rounded-xl border border-neutral-900 bg-black/35 p-3 text-xs leading-5 text-neutral-400"
                              >
                                <span className="grid size-5 shrink-0 place-items-center rounded-full border border-neutral-800 text-[10px] text-neutral-500">
                                  {index + 1}
                                </span>
                                <span>{criteria}</span>
                              </div>
                            ))
                          ) : (
                            <div className="rounded-xl border border-neutral-900 bg-black/35 p-3 text-xs leading-5 text-neutral-600">
                              No reusable checks are currently selected.
                            </div>
                          )}
                        </div>
                      </aside>
                    </div>
                  </section>
                </section>
              )}

              {activeBuilderSection === "context" && (
                <section className="space-y-4">
                  <article className="rounded-[1.5rem] border border-neutral-900 bg-black/35 p-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="flex items-start gap-4">
                        <span className={["grid size-12 shrink-0 place-items-center rounded-2xl border", getContextStatusTone(contextSummary.status).border, getContextStatusTone(contextSummary.status).bg, getContextStatusTone(contextSummary.status).icon].join(" ") }>
                          <Search size={20} />
                        </span>

                        <div>
                          <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                            Context review
                          </p>

                          <h2 className="mt-1 text-xl font-semibold tracking-[-0.035em] text-white">
                            {contextSummary.isAnalyzed ? "Review the selected context before export." : "Analyze context before exporting."}
                          </h2>

                          <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">
                            {contextSummary.summary}
                          </p>
                        </div>
                      </div>

                      <div className="flex shrink-0 flex-wrap gap-2">
                        <Button variant="secondary" onClick={handleAnalyzeContext} disabled={!canGenerate}>
                          {isLoading ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                          {contextSummary.isAnalyzed ? "Refresh context" : "Analyze Context"}
                        </Button>

                        {contextSummary.isAnalyzed && onOpenContextComposer && (
                          <Button variant="secondary" onClick={handleOpenFullContextComposer}>
                            <Eye size={15} />
                            Full review
                          </Button>
                        )}
                      </div>
                    </div>

                    <div className="mt-5 grid gap-2 md:grid-cols-4">
                      <CompactMetric label="Status" value={contextSummary.label} caption={contextSummary.source} />
                      <CompactMetric label="Files" value={contextSummary.files.length} caption={`${contextSummary.editCount} edit · ${contextSummary.inspectCount} inspect`} />
                      <CompactMetric label="Snippets" value={contextSummary.snippetsCount} caption="readable" />
                      <CompactMetric label="Budget" value={`${contextSummary.budgetScore}%`} caption={contextSummary.budgetLabel} />
                    </div>

                    <div className="mt-3">
                      <ContextLocalStateBar
                        status={gitStatus}
                        isLoading={isGitStatusLoading}
                        error={gitStatusError}
                        onRefresh={() => void loadGitStatus()}
                        onAddNote={handleAddLocalChangesNote}
                        hasNote={hasLocalChangesNote}
                      />
                    </div>

                    <HorizontalSlidingSelector
                      items={CONTEXT_REVIEW_ITEMS}
                      activeIndex={CONTEXT_REVIEW_ITEMS.findIndex((item) => item.value === contextReviewMode)}
                      getItemKey={(item) => item.value}
                      onSelect={(item) => setContextReviewMode(item.value)}
                      ariaLabel="Context review mode"
                      className="mt-4"
                      itemClassName="h-[58px] px-3"
                      renderItem={(item, isActive) => {
                        const description = item.value === "files"
                          ? contextSummary.isAnalyzed
                            ? `${contextSummary.files.length} selected`
                            : "Not analyzed"
                          : item.value === "budget"
                            ? contextSummary.isAnalyzed
                              ? `${contextSummary.budgetScore}% · ${contextSummary.budgetLabel}`
                              : "Pending analysis"
                            : contextSummary.isAnalyzed
                              ? contextWarnings.length > 0
                                ? `${contextWarnings.length} warning${contextWarnings.length === 1 ? "" : "s"}`
                                : "No warnings"
                              : "Selection health";

                        return (
                          <span className="flex h-full items-center justify-center gap-3">
                            <span
                              className={[
                                "grid size-8 shrink-0 place-items-center rounded-xl border transition",
                                isActive
                                  ? "border-black/10 bg-black/[0.045] text-black"
                                  : "border-neutral-800 bg-neutral-950 text-neutral-500"
                              ].join(" ")}
                            >
                              {item.icon}
                            </span>
                            <span className="min-w-0 text-left">
                              <span className="block truncate text-xs font-semibold">
                                {item.label}
                              </span>
                              <span className={[
                                "mt-0.5 block truncate text-[10px]",
                                isActive ? "text-black/50" : "text-neutral-700"
                              ].join(" ")}>
                                {description}
                              </span>
                            </span>
                          </span>
                        );
                      }}
                    />

                    {contextReviewMode === "files" && (
                      <div className="mt-4 rounded-2xl border border-neutral-900 bg-black/20 p-4">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                          <div>
                            <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                              Selected files
                            </p>
                            <h3 className="mt-1 text-base font-semibold text-white">
                              Edit targets and supporting references
                            </h3>
                            <p className="mt-1 text-xs leading-5 text-neutral-600">
                              File roles come from context analysis. Local Git changes remain supporting awareness only.
                            </p>
                          </div>

                          {contextSummary.isAnalyzed && (
                            <Pill tone={contextSummary.status === "ready" ? "success" : "warning"}>
                              {contextSummary.status === "ready" ? "ready" : "review"}
                            </Pill>
                          )}
                        </div>

                        {contextSummary.isAnalyzed ? (
                          <>
                            <SegmentedFilter
                              value={contextFileFilter}
                              onChange={(value) => setContextFileFilter(value as ContextFileFilter)}
                              options={contextFilterOptions}
                              className="mt-4 h-12"
                            />

                            {contextFileFilter === "warnings" ? (
                              <div className="mt-4 space-y-2">
                                {contextWarnings.length > 0 ? contextWarnings.map((warning) => (
                                  <div key={warning} className="rounded-2xl border border-red-400/20 bg-red-400/10 p-4 text-xs leading-5 text-red-200">
                                    <div className="mb-1 flex items-center gap-2 text-red-100">
                                      <AlertTriangle size={13} />
                                      <span className="font-semibold">Review before exporting</span>
                                    </div>
                                    {warning}
                                  </div>
                                )) : (
                                  <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4 text-xs leading-5 text-emerald-200">
                                    No context warnings returned. Selected files look ready for export.
                                  </div>
                                )}
                              </div>
                            ) : visibleContextFiles.length > 0 ? (
                              <div className="mt-4 grid gap-3 xl:grid-cols-2">
                                {visibleContextFiles.map((file) => (
                                  <ContextFileReasonCard
                                    key={file.path}
                                    file={file}
                                    preview={contextPreview}
                                  />
                                ))}
                              </div>
                            ) : (
                              <div className="mt-4 rounded-2xl border border-dashed border-neutral-800 bg-black/25 p-6 text-sm leading-6 text-neutral-500">
                                No files match this filter. Open full review or adjust the task before generating.
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="mt-4 rounded-2xl border border-dashed border-neutral-800 bg-black/25 p-6 text-sm leading-6 text-neutral-500">
                            Run Analyze Context to see edit candidates, inspect-only references and the reason each file was selected.
                          </div>
                        )}
                      </div>
                    )}

                    {contextReviewMode === "budget" && (
                      <div className="mt-4 rounded-2xl border border-neutral-900 bg-black/20 p-4">
                        <div>
                          <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                            Context budget
                          </p>
                          <h3 className="mt-1 text-base font-semibold text-white">
                            Keep the instruction focused without losing evidence
                          </h3>
                        </div>

                        {contextSummary.isAnalyzed ? (
                          <div className="mt-4">
                            <ContextBudgetPanel
                              summary={contextSummary}
                              selectedMode={contextBudgetMode}
                              onModeChange={setContextBudgetMode}
                              enabledRulesCount={enabledRuleIds.length}
                              criteriaCount={totalCriteriaCount}
                            />
                          </div>
                        ) : (
                          <div className="mt-4 rounded-2xl border border-dashed border-neutral-800 bg-black/25 p-6 text-sm leading-6 text-neutral-500">
                            Budget pressure is calculated after context analysis. It does not change selector behavior or generation logic.
                          </div>
                        )}
                      </div>
                    )}

                    {contextReviewMode === "signals" && (
                      <div className="mt-4 rounded-2xl border border-neutral-900 bg-black/20 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                              Review signals
                            </p>
                            <h3 className="mt-1 text-base font-semibold text-white">
                              Selection health and technical notes
                            </h3>
                          </div>

                          {contextSummary.isAnalyzed && (
                            <Pill tone={contextSummary.status === "ready" ? "success" : "warning"}>
                              {contextSummary.status === "ready" ? "clear" : "check"}
                            </Pill>
                          )}
                        </div>

                        {contextSummary.isAnalyzed ? (
                          <div className="mt-4 space-y-3">
                            <div className="grid gap-2 md:grid-cols-3">
                              <CompactMetric label="Source" value={contextSummary.source} caption={contextPreview?.fileSelection.usedFallback ? "fallback" : "selector"} />
                              <CompactMetric label="Read only" value={contextSummary.inspectCount + contextSummary.referenceCount} caption="inspect + reference" />
                              <CompactMetric label="Risk" value={contextSummary.riskLabel} caption="task intent" />
                            </div>

                            {contextWarnings.length > 0 ? (
                              <div className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-xs leading-5 text-red-200">
                                <div className="mb-1 flex items-center gap-2 text-red-100">
                                  <AlertTriangle size={13} />
                                  <span className="font-semibold">Review recommended</span>
                                </div>
                                {contextWarnings[0]}
                              </div>
                            ) : (
                              <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-xs leading-5 text-emerald-200">
                                No blocking context warnings returned.
                              </div>
                            )}

                            {contextTechnicalSignals.length > 0 && (
                              <div className="rounded-xl border border-neutral-900 bg-black/30 p-3">
                                <button
                                  type="button"
                                  onClick={() => setShowContextTechnicalDetails((value) => !value)}
                                  className="flex w-full items-center justify-between gap-3 text-left text-xs font-semibold text-neutral-300 hover:text-white"
                                >
                                  Technical details
                                  <span className="text-[10px] text-neutral-600">
                                    {showContextTechnicalDetails ? "Hide" : `Show ${contextTechnicalSignals.length}`}
                                  </span>
                                </button>

                                {showContextTechnicalDetails && (
                                  <div className="mt-3 space-y-2">
                                    {contextTechnicalSignals.map((signal) => (
                                      <div key={signal} className="rounded-lg border border-neutral-900 bg-black/35 p-2 text-[11px] leading-5 text-neutral-500">
                                        {signal}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="mt-4 grid gap-2 md:grid-cols-2">
                            {[
                              "Selected files and relevance",
                              "Edit candidates vs inspect-only",
                              "Context budget pressure",
                              "Why each file was included"
                            ].map((item) => (
                              <div key={item} className="flex items-center gap-2 rounded-xl border border-neutral-900 bg-black/35 p-3 text-xs text-neutral-400">
                                <CheckCircle2 size={13} className="text-emerald-300" />
                                {item}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                </section>
              )}
            </motion.div>
          </main>

          <aside className="min-h-0 overflow-y-auto pr-1">
            <div className="sticky top-0">
              <PackStatusCard
                quality={qualityResult}
                items={packStatusItems}
                activeSection={activeBuilderSection}
                onSelect={setActiveBuilderSection}
                onOpenDetails={() => setIsQualityModalOpen(true)}
              />
            </div>
          </aside>
        </div>
      </div>

      {isUnderstandingModalOpen && understandingResponse && (
        <TaskUnderstandingModal
          draft={understandingDraft ?? draft}
          response={understandingResponse}
          answer={understandingAnswer}
          error={understandingError}
          isSubmitting={isUnderstanding}
          onAnswerChange={setUnderstandingAnswer}
          onSubmitClarification={() => void handleSubmitClarification()}
          onContinue={() => void handleContinueUnderstanding()}
          onEditTask={handleEditTaskFromUnderstanding}
          onClose={() => setIsUnderstandingModalOpen(false)}
        />
      )}

      {isQualityModalOpen && (
        <QualityDetailsModal
          quality={qualityResult}
          onClose={() => setIsQualityModalOpen(false)}
          onNavigate={setActiveBuilderSection}
        />
      )}

      {isPresetModalOpen && (
        <PresetPickerModal
          activePreset={activeTaskPreset}
          onSelect={applyTaskPreset}
          onResetDefaults={resetRecipeDefaults}
          onClose={() => setIsPresetModalOpen(false)}
        />
      )}

      {isRecipeModalOpen && (
        <RecipeSetupModal
          draft={draft}
          taskTypeOptions={TASK_TYPE_OPTIONS}
          targetToolOptions={TARGET_TOOL_OPTIONS}
          templateOptions={templateOptions}
          profileOptions={profileOptions}
          selectedTemplate={selectedTemplate}
          selectedProfile={selectedProfile}
          enabledRulesCount={enabledRuleIds.length}
          customRulesCount={customRulesCount}
          totalCriteriaCount={totalCriteriaCount}
          onTaskTypeChange={handleTaskTypeChange}
          onTargetToolChange={handleTargetToolChange}
          onTemplateChange={(value) => updateDraft({ templateId: value })}
          onProfileChange={handleRuleProfileChange}
          onClose={() => setIsRecipeModalOpen(false)}
        />
      )}

      {isRulesModalOpen && (
        <RulesManagerModal
          visibleRuleItems={visibleRuleItems}
          selectedRuleItems={selectedRuleItems}
          enabledRuleIds={enabledRuleIds}
          enabledRuleIdSet={enabledRuleIdSet}
          selectedProfile={selectedProfile}
          onToggle={toggleRule}
          onResetToProfile={resetRulesFromProfile}
          onClose={() => setIsRulesModalOpen(false)}
        />
      )}
    </section>
  );
}
