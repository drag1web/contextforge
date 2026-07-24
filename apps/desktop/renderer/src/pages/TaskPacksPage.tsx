import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import {
  Archive,
  Check,
  ChevronDown,
  Clipboard,
  CloudUpload,
  Download,
  ExternalLink,
  FileText,
  Filter,
  HelpCircle,
  Inbox,
  RefreshCw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  X,
} from "lucide-react";

import type { Project, TaskPack } from "../types";
import type { DesktopSyncTaskPackInboxItem } from "../types/desktopSync";
import { getProjects, importCloudTaskPack } from "../api/client";
import { makeAiToolSelectOption } from "../components/ai/aiToolOptions";
import { Button } from "../components/ui/Button";
import { CustomSelect, type SelectOption } from "../components/ui/CustomSelect";
import { DropdownMenu } from "../components/ui/DropdownMenu";
import { HorizontalSlidingSelector } from "../components/ui/SlidingSelectors";
import { exportTaskPack } from "../utils/taskPackExport";

interface TaskPacksPageProps {
  taskPacks: TaskPack[];
  onOpenTaskPack: (taskPack: TaskPack) => void;
  onImportedTaskPack: (taskPack: TaskPack) => void;
}

type TaskTypeFilter =
  | "all"
  | "general"
  | "ui"
  | "backend"
  | "fullstack"
  | "build"
  | "bugfix"
  | "refactor"
  | "docs"
  | "tests";

type BodyModeFilter = "all" | "ollama" | "template" | "cached" | "fallback";
type SortMode = "newest" | "oldest" | "title" | "project";
type PublishState = "idle" | "publishing" | "published";

const TASK_PACK_TRANSITION = {
  duration: 0.2,
  ease: [0.16, 1, 0.3, 1],
} as const;

function normalize(value: unknown) {
  return String(value ?? "").toLowerCase();
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

function getDateValue(taskPack: TaskPack) {
  return new Date(taskPack.createdAt).getTime();
}

function getTaskPackBodyBadge(taskPack: TaskPack, t: (key: string) => string) {
  if (
    taskPack.generationMode === "ollama" &&
    !taskPack.generationUsedFallback
  ) {
    return t("labels.ollamaRefined");
  }

  if (taskPack.generationCached) {
    return t("labels.cached");
  }

  if (taskPack.generationUsedFallback) {
    return t("labels.fallback");
  }

  return t("labels.safeTemplate");
}

async function openGitHubUrl(url: string) {
  if (window.contextforge?.openExternalUrl) {
    await window.contextforge.openExternalUrl(url);
    return;
  }

  window.open(url, "_blank", "noopener,noreferrer");
}

function getTaskPackProjectName(
  taskPack: TaskPack,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  return (
    taskPack.projectName ??
    t("labels.projectFallback", { id: taskPack.projectId })
  );
}

function getMostUsedTarget(taskPacks: TaskPack[]) {
  const counts = new Map<string, number>();

  for (const taskPack of taskPacks) {
    counts.set(taskPack.targetTool, (counts.get(taskPack.targetTool) ?? 0) + 1);
  }

  const [target] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];

  return target ?? "—";
}

function matchesBodyMode(taskPack: TaskPack, filter: BodyModeFilter) {
  if (filter === "all") {
    return true;
  }

  if (filter === "cached") {
    return Boolean(taskPack.generationCached);
  }

  if (filter === "fallback") {
    return Boolean(taskPack.generationUsedFallback);
  }

  if (filter === "ollama") {
    return (
      taskPack.generationMode === "ollama" && !taskPack.generationUsedFallback
    );
  }

  return (
    taskPack.generationMode !== "ollama" ||
    Boolean(taskPack.generationUsedFallback)
  );
}

function getTaskPackDisplayTitle(taskPack: TaskPack) {
  const sourceIssue = taskPack.generationRecipe?.githubIssue;

  if (sourceIssue) {
    return `Issue #${sourceIssue.issueNumber}: ${sourceIssue.issueTitle}`;
  }

  return taskPack.title;
}

function getTaskPackArchiveSummary(taskPack: TaskPack) {
  const sourceIssue = taskPack.generationRecipe?.githubIssue;
  const createdIssue = taskPack.generationRecipe?.githubCreatedIssue;

  if (sourceIssue && createdIssue) {
    return `Created GitHub issue #${createdIssue.issueNumber} from source issue #${sourceIssue.issueNumber} in ${createdIssue.fullName}.`;
  }

  if (sourceIssue) {
    return `Imported from ${sourceIssue.fullName}#${sourceIssue.issueNumber}: ${sourceIssue.issueTitle}`;
  }

  if (createdIssue) {
    return `Linked to created GitHub issue #${createdIssue.issueNumber} in ${createdIssue.fullName}.`;
  }

  return taskPack.rawTask;
}

function getFriendlyWebsiteError(
  error: string,
  t: (key: string) => string,
) {
  if (!error) {
    return "";
  }

  if (
    error.includes("WEBSITE_OFFLINE") ||
    error.includes("Could not reach the ContextForge website")
  ) {
    return t("taskPacksPage.websiteUnavailableDescription");
  }

  return t("taskPacksPage.cloudRequestFailedFriendly");
}

function EmptyState({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <section className="grid h-full min-h-[320px] place-items-center rounded-[1.5rem] border border-dashed border-neutral-800 bg-black/25 p-8 text-center">
      <div>
        <div className="mx-auto mb-5 grid size-12 place-items-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-300">
          {icon}
        </div>

        <h3 className="text-base font-semibold text-white">{title}</h3>

        <p className="mt-2 max-w-md text-sm leading-6 text-neutral-500">
          {description}
        </p>
      </div>
    </section>
  );
}

function SummaryMetric({
  value,
  label,
}: {
  value: string | number;
  label: string;
}) {
  return (
    <div className="min-w-0 px-4 first:pl-0 last:pr-0">
      <p className="cf-display-font truncate text-xl font-semibold text-white">
        {value}
      </p>
      <p className="mt-0.5 truncate text-[11px] text-neutral-600">{label}</p>
    </div>
  );
}

function TaskPackCard({
  taskPack,
  isCopied,
  projectName,
  bodyLabel,
  onCopy,
  onOpen,
  onPublish,
  publishState,
}: {
  taskPack: TaskPack;
  isCopied: boolean;
  projectName: string;
  bodyLabel: string;
  onCopy: () => void;
  onOpen: () => void;
  onPublish: () => void;
  publishState: PublishState;
}) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const recipe = taskPack.generationRecipe;
  const summary = getTaskPackArchiveSummary(taskPack);

  const actions = [
    {
      label: t("taskPacksPage.exportMarkdown"),
      icon: <FileText size={15} />,
      onClick: () => exportTaskPack(taskPack, "md"),
    },
    {
      label: t("taskPacksPage.exportText"),
      icon: <Download size={15} />,
      onClick: () => exportTaskPack(taskPack, "txt"),
    },
    {
      label:
        publishState === "publishing"
          ? t("taskPacksPage.publishing")
          : publishState === "published"
            ? t("taskPacksPage.onWebsite")
            : t("taskPacksPage.publishToWebsite"),
      icon:
        publishState === "published" ? (
          <Check size={15} />
        ) : (
          <CloudUpload size={15} />
        ),
      onClick: onPublish,
      disabled: publishState === "publishing",
    },
    {
      label: isCopied
        ? t("taskPacksPage.copied")
        : t("taskPacksPage.copyPrompt"),
      icon: isCopied ? <Check size={15} /> : <Clipboard size={15} />,
      onClick: onCopy,
    },
    ...(recipe?.githubCreatedIssue
      ? [
          {
            label: t("taskPacksPage.openGitHubIssue"),
            icon: <ExternalLink size={15} />,
            onClick: () =>
              void openGitHubUrl(recipe.githubCreatedIssue!.issueUrl),
          },
        ]
      : []),
  ];

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={TASK_PACK_TRANSITION}
      className="rounded-[1.4rem] border border-neutral-900 bg-black/35 p-4 transition-colors duration-200 hover:border-white/15 hover:bg-white/[0.025]"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-400">
            <FileText size={15} />
          </span>

          <div className="min-w-0">
            <h4 className="line-clamp-2 text-[15px] font-semibold leading-6 text-white">
              {getTaskPackDisplayTitle(taskPack)}
            </h4>

            <p className="mt-1 truncate text-xs text-neutral-600">
              {projectName} <span className="px-1.5 text-neutral-800">·</span>
              {taskPack.targetTool}
              <span className="px-1.5 text-neutral-800">·</span>
              {taskPack.taskType}
              <span className="px-1.5 text-neutral-800">·</span>
              {bodyLabel}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button variant="primary" onClick={onOpen} className="h-9 px-4 text-xs">
            {t("taskPacksPage.open")}
          </Button>
          <DropdownMenu
            ariaLabel={t("taskPacksPage.moreActions")}
            actions={actions}
          />
        </div>
      </div>

      <div className="mt-3 border-t border-neutral-900 pt-2.5">
        <button
          type="button"
          onClick={() => setIsExpanded((current) => !current)}
          aria-expanded={isExpanded}
          className={[
            "group flex w-full items-center gap-2 rounded-xl px-1 py-1.5 text-left text-xs font-medium outline-none transition-colors",
            isExpanded
              ? "text-white"
              : "text-neutral-500 hover:text-white focus-visible:text-white",
          ].join(" ")}
        >
          <motion.span
            className={[
              "grid size-6 shrink-0 place-items-center rounded-full border transition-colors",
              isExpanded
                ? "border-white bg-white text-black"
                : "border-neutral-800 bg-neutral-950 text-neutral-500 group-hover:border-neutral-700",
            ].join(" ")}
            animate={{ rotate: isExpanded ? 180 : 0 }}
            transition={{ type: "spring", stiffness: 560, damping: 42, mass: 0.5 }}
          >
            <ChevronDown size={13} />
          </motion.span>

          <span>
            {isExpanded
              ? t("taskPacksPage.hideDescription")
              : t("taskPacksPage.showDescription")}
          </span>

          <span className="ml-auto text-[10px] font-normal uppercase tracking-[0.12em] text-neutral-700">
            {isExpanded
              ? t("taskPacksPage.detailsExpanded")
              : t("taskPacksPage.detailsCollapsed")}
          </span>
        </button>

        <motion.div
          className="grid"
          initial={false}
          animate={{ gridTemplateRows: isExpanded ? "1fr" : "0fr" }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="overflow-hidden">
            <motion.div
              initial={false}
              animate={{ opacity: isExpanded ? 1 : 0, y: isExpanded ? 0 : -4 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="pt-2"
            >
              <p className="rounded-2xl border border-neutral-900/80 bg-black/25 px-3.5 py-3 text-sm leading-6 text-neutral-500">
                {summary}
              </p>
            </motion.div>
          </div>
        </motion.div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-neutral-900 pt-3">
        <p className="truncate text-[11px] text-neutral-700">
          {formatDate(taskPack.createdAt)}
          {recipe?.githubIssue
            ? ` · GitHub #${recipe.githubIssue.issueNumber}`
            : ""}
        </p>

        <p className="text-[11px] text-neutral-700">
          {publishState === "published"
            ? t("taskPacksPage.onWebsite")
            : t("taskPacksPage.savedLocally")}
        </p>
      </div>
    </motion.article>
  );
}

function CloudTaskPackBridge({
  onImportedTaskPack,
}: {
  onImportedTaskPack: (taskPack: TaskPack) => void;
}) {
  const { t } = useTranslation();
  const [connected, setConnected] = useState(false);
  const [inbox, setInbox] = useState<DesktopSyncTaskPackInboxItem[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectByDelivery, setProjectByDelivery] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);
  const [isInboxOpen, setIsInboxOpen] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);

  const refresh = useCallback(async (silent = false) => {
    const bridge = window.contextforge?.desktopSync;
    if (!bridge) {
      setConnected(false);
      setLoading(false);
      return;
    }

    if (!silent) setLoading(true);
    try {
      const status = await bridge.getStatus();
      setConnected(status.connected);
      if (!status.connected) {
        setInbox([]);
        setError("");
        return;
      }

      const [items, localProjects] = await Promise.all([
        bridge.getTaskPackInbox(),
        getProjects(),
      ]);
      setInbox(items);
      setProjects(localProjects);
      setLastCheckedAt(new Date());
      setIsInboxOpen((current) => current || items.length > 0);
      setProjectByDelivery((current) => {
        const fallback = String(localProjects[0]?.id ?? "");
        return Object.fromEntries(items.map((item: DesktopSyncTaskPackInboxItem) => [
          item.delivery.id,
          current[item.delivery.id] && localProjects.some((project) => String(project.id) === current[item.delivery.id])
            ? current[item.delivery.id]
            : fallback,
        ]));
      });
      setError("");
      if (!silent) setNotice("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("taskPacksPage.cloudRequestFailed"));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh(true);
    };
    const timer = window.setInterval(refreshWhenVisible, 15_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refresh]);

  async function importItem(item: DesktopSyncTaskPackInboxItem) {
    const bridge = window.contextforge?.desktopSync;
    const projectId = Number(projectByDelivery[item.delivery.id]);
    if (!bridge || !item.taskPack.integrityValid || !Number.isInteger(projectId) || projectId <= 0) return;

    setBusyId(item.delivery.id);
    try {
      const result = await importCloudTaskPack({
        projectId,
        deliveryId: item.delivery.id,
        source: {
          taskPackId: item.taskPack.id,
          originInstallationId: item.taskPack.originInstallationId,
          projectName: item.taskPack.projectName,
        },
        taskPack: {
          title: item.taskPack.title,
          rawTask: item.taskPack.rawTask,
          taskType: item.taskPack.taskType,
          targetTool: item.taskPack.targetTool,
          generatedPrompt: item.taskPack.generatedPrompt,
        },
      });
      await bridge.acknowledgeTaskPack(item.delivery.id, "imported", {
        contentHash: item.taskPack.contentHash,
      });
      setInbox((current) => current.filter((candidate) => candidate.delivery.id !== item.delivery.id));
      onImportedTaskPack(result.taskPack);
      setError("");
      setNotice(t("taskPacksPage.importSuccess"));
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : t("taskPacksPage.cloudRequestFailed");
      setError(message);
      try {
        await bridge.acknowledgeTaskPack(item.delivery.id, "failed", { error: message });
        setInbox((current) => current.filter((candidate) => candidate.delivery.id !== item.delivery.id));
      } catch {
        // Keep the delivery in the inbox so an idempotent import can be retried.
      }
    } finally {
      setBusyId(null);
    }
  }

  async function reportIntegrityFailure(item: DesktopSyncTaskPackInboxItem) {
    const bridge = window.contextforge?.desktopSync;
    if (!bridge) return;
    setBusyId(item.delivery.id);
    try {
      await bridge.acknowledgeTaskPack(item.delivery.id, "failed", {
        error: "Task Pack SHA-256 integrity verification failed before import.",
      });
      setInbox((current) => current.filter((candidate) => candidate.delivery.id !== item.delivery.id));
      setError("");
      setNotice(t("taskPacksPage.integrityReported"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("taskPacksPage.cloudRequestFailed"));
    } finally {
      setBusyId(null);
    }
  }

  async function dismissItem(item: DesktopSyncTaskPackInboxItem) {
    const bridge = window.contextforge?.desktopSync;
    if (!bridge) return;
    setBusyId(item.delivery.id);
    try {
      await bridge.acknowledgeTaskPack(item.delivery.id, "dismissed");
      setInbox((current) => current.filter((candidate) => candidate.delivery.id !== item.delivery.id));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("taskPacksPage.cloudRequestFailed"));
    } finally {
      setBusyId(null);
    }
  }

  const friendlyError = getFriendlyWebsiteError(error, t);
  const statusLabel = !connected
    ? t("taskPacksPage.cloudDisconnected")
    : error
      ? t("taskPacksPage.cloudLinkedOffline")
      : t("taskPacksPage.cloudOnline");

  return (
    <section className="rounded-[1.35rem] border border-neutral-900 bg-black/30 px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-400">
            <Inbox size={16} />
          </span>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-white">
                {t("taskPacksPage.desktopLink")}
              </h3>
              <span
                className={[
                  "inline-flex items-center gap-1.5 text-[11px] font-medium",
                  !connected
                    ? "text-neutral-500"
                    : error
                      ? "text-amber-300"
                      : "text-emerald-300",
                ].join(" ")}
              >
                <span
                  className={[
                    "size-1.5 rounded-full",
                    !connected
                      ? "bg-neutral-700"
                      : error
                        ? "bg-amber-300"
                        : "bg-emerald-300",
                  ].join(" ")}
                />
                {statusLabel}
              </span>
            </div>

            <p className="mt-1 truncate text-xs text-neutral-600">
              {friendlyError ||
                (connected
                  ? inbox.length > 0
                    ? t("taskPacksPage.incomingCount", { count: inbox.length })
                    : t("taskPacksPage.inboxEmpty")
                  : t("taskPacksPage.cloudBridgeDescription"))}
              {lastCheckedAt && !error
                ? ` · ${lastCheckedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                : ""}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            onClick={() => setIsGuideOpen((current) => !current)}
            className="h-9 px-3 text-xs"
            aria-expanded={isGuideOpen}
          >
            <HelpCircle size={14} />
            {t("taskPacksPage.howPublishingWorks")}
          </Button>

          {connected && inbox.length > 0 && (
            <Button
              variant="secondary"
              onClick={() => setIsInboxOpen((current) => !current)}
              className="h-9 px-3 text-xs"
            >
              <motion.span
                animate={{ rotate: isInboxOpen ? 180 : 0 }}
                transition={{ type: "spring", stiffness: 560, damping: 42, mass: 0.5 }}
              >
                <ChevronDown size={14} />
              </motion.span>
              {isInboxOpen
                ? t("taskPacksPage.hideInbox")
                : t("taskPacksPage.showInbox")}
            </Button>
          )}

          <Button
            variant="secondary"
            onClick={() => void refresh()}
            disabled={loading}
            className="h-9 px-3 text-xs"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            {error ? t("taskPacksPage.retry") : t("taskPacksPage.refreshInbox")}
          </Button>
        </div>
      </div>

      <motion.div
        className="grid"
        initial={false}
        animate={{ gridTemplateRows: isGuideOpen ? "1fr" : "0fr" }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="overflow-hidden">
          <div className="mt-3 grid gap-3 rounded-2xl border border-neutral-900 bg-black/30 p-3 sm:grid-cols-3">
            <div className="flex items-start gap-3">
              <span className="grid size-7 shrink-0 place-items-center rounded-full border border-neutral-800 bg-neutral-950 text-[11px] font-semibold text-neutral-300">1</span>
              <div>
                <p className="text-xs font-semibold text-white">{t("taskPacksPage.publishStepOneTitle")}</p>
                <p className="mt-1 text-[11px] leading-5 text-neutral-600">{t("taskPacksPage.publishStepOneDescription")}</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <span className="grid size-7 shrink-0 place-items-center rounded-full border border-neutral-800 bg-neutral-950 text-[11px] font-semibold text-neutral-300">2</span>
              <div>
                <p className="text-xs font-semibold text-white">{t("taskPacksPage.publishStepTwoTitle")}</p>
                <p className="mt-1 text-[11px] leading-5 text-neutral-600">{t("taskPacksPage.publishStepTwoDescription")}</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <span className="grid size-7 shrink-0 place-items-center rounded-full border border-neutral-800 bg-neutral-950 text-[11px] font-semibold text-neutral-300">3</span>
              <div>
                <p className="text-xs font-semibold text-white">{t("taskPacksPage.publishStepThreeTitle")}</p>
                <p className="mt-1 text-[11px] leading-5 text-neutral-600">{t("taskPacksPage.publishStepThreeDescription")}</p>
              </div>
            </div>
          </div>

          {error && (
            <p className="mt-2 text-[11px] text-amber-300/80">
              {t("taskPacksPage.publishRequiresWebsite")}
            </p>
          )}
        </div>
      </motion.div>

      {notice && (
        <p className="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.07] px-3 py-2 text-xs text-emerald-200">
          {notice}
        </p>
      )}

      <motion.div
        className="grid"
        initial={false}
        animate={{ gridTemplateRows: isInboxOpen && inbox.length > 0 ? "1fr" : "0fr" }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="overflow-hidden">
          <div className="mt-4 grid max-h-[280px] gap-3 overflow-y-auto pr-1 2xl:grid-cols-2">
            {inbox.map((item: DesktopSyncTaskPackInboxItem) => {
              const projectOptions: SelectOption<string>[] = projects.map((project) => ({
                value: String(project.id),
                label: project.name,
                description: t("taskPacksPage.localImportTarget"),
              }));
              const disabled = busyId === item.delivery.id;

              return (
                <article key={item.delivery.id} className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">{item.taskPack.title}</p>
                      <p className="mt-1 truncate text-xs text-neutral-600">
                        {item.taskPack.projectName || t("taskPacksPage.unknownProject")} · {item.taskPack.targetTool}
                      </p>
                    </div>
                    <span className={item.taskPack.integrityValid ? "text-xs text-emerald-300" : "text-xs text-red-200"}>
                      {item.taskPack.integrityValid ? t("taskPacksPage.integrityVerified") : t("taskPacksPage.integrityFailed")}
                    </span>
                  </div>

                  <p className="mt-3 line-clamp-2 text-xs leading-5 text-neutral-500">{item.taskPack.rawTask}</p>

                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-neutral-600">
                    <span className="rounded-lg border border-white/10 px-2 py-1 font-mono">SHA-256 {item.taskPack.contentHash.slice(0, 12)}…</span>
                    <span>{t("taskPacksPage.deliveryAttempt").replace("{count}", String(item.delivery.attemptCount))}</span>
                  </div>

                  {!item.taskPack.integrityValid && (
                    <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/[0.07] p-3 text-xs leading-5 text-red-200">
                      <ShieldAlert size={15} className="mt-0.5 shrink-0" />
                      <span>{t("taskPacksPage.integrityBlocked")}</span>
                    </div>
                  )}

                  <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
                    {!item.taskPack.integrityValid ? (
                      <p className="text-xs text-red-200">{t("taskPacksPage.importBlocked")}</p>
                    ) : projects.length > 0 ? (
                      <CustomSelect
                        value={projectByDelivery[item.delivery.id] ?? String(projects[0]?.id ?? "")}
                        options={projectOptions}
                        onChange={(value) => setProjectByDelivery((current) => ({ ...current, [item.delivery.id]: value }))}
                      />
                    ) : (
                      <p className="text-xs text-amber-200">{t("taskPacksPage.noLocalProjects")}</p>
                    )}

                    {item.taskPack.integrityValid ? (
                      <Button variant="primary" onClick={() => void importItem(item)} disabled={disabled || projects.length === 0}>
                        <Check size={14} />
                        {disabled ? t("taskPacksPage.importing") : t("taskPacksPage.importHere")}
                      </Button>
                    ) : (
                      <Button variant="secondary" onClick={() => void reportIntegrityFailure(item)} disabled={disabled}>
                        <ShieldAlert size={14} />
                        {t("taskPacksPage.reportIntegrity")}
                      </Button>
                    )}

                    <Button variant="secondary" onClick={() => void dismissItem(item)} disabled={disabled}>
                      <X size={14} />
                      {t("taskPacksPage.dismiss")}
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </motion.div>
    </section>
  );
}

export function TaskPacksPage({
  taskPacks,
  onOpenTaskPack,
  onImportedTaskPack,
}: TaskPacksPageProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [taskTypeFilter, setTaskTypeFilter] = useState<TaskTypeFilter>("all");
  const [targetFilter, setTargetFilter] = useState("all");
  const [bodyModeFilter, setBodyModeFilter] = useState<BodyModeFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [copiedTaskPackId, setCopiedTaskPackId] = useState<number | null>(null);
  const [publishStateById, setPublishStateById] = useState<Record<number, PublishState>>({});
  const [publishError, setPublishError] = useState("");

  const localizedTaskTypeOptions = useMemo<SelectOption<TaskTypeFilter>[]>(
    () => [
      {
        value: "all",
        label: t("labels.taskTypeAll"),
        description: t("taskPacksPage.allTypes"),
      },
      { value: "general", label: t("labels.taskTypeGeneral"), description: "General" },
      { value: "ui", label: t("labels.taskTypeUi"), description: "Interface" },
      { value: "backend", label: t("labels.taskTypeBackend"), description: "Server" },
      { value: "fullstack", label: t("labels.taskTypeFullstack"), description: "Both sides" },
      { value: "build", label: t("labels.taskTypeBuild"), description: "Build" },
      { value: "bugfix", label: t("labels.taskTypeBugfix"), description: "Fixes" },
      { value: "refactor", label: t("labels.taskTypeRefactor"), description: "Cleanup" },
      { value: "docs", label: t("labels.taskTypeDocs"), description: "Writing" },
      { value: "tests", label: t("labels.taskTypeTests"), description: "Coverage" },
    ],
    [t],
  );

  const localizedBodyModeOptions = useMemo<SelectOption<BodyModeFilter>[]>(
    () => [
      { value: "all", label: t("taskPacksPage.allPacks"), description: t("taskPacksPage.allBodyModesDesc") },
      { value: "ollama", label: t("labels.ollamaRefined"), description: t("taskPacksPage.ollamaRefinedDesc") },
      { value: "template", label: t("labels.safeTemplate"), description: t("taskPacksPage.safeTemplateDesc") },
      { value: "cached", label: t("labels.cached"), description: t("taskPacksPage.cachedDesc") },
      { value: "fallback", label: t("labels.fallback"), description: t("taskPacksPage.fallbackDesc") },
    ],
    [t],
  );

  const localizedSortOptions = useMemo<SelectOption<SortMode>[]>(
    () => [
      { value: "newest", label: t("taskPacksPage.newest"), description: t("taskPacksPage.newestDesc") },
      { value: "oldest", label: t("taskPacksPage.oldest"), description: t("taskPacksPage.oldestDesc") },
      { value: "title", label: t("taskPacksPage.titleSort"), description: t("taskPacksPage.titleSortDesc") },
      { value: "project", label: t("taskPacksPage.projectSort"), description: t("taskPacksPage.projectSortDesc") },
    ],
    [t],
  );

  const targetOptions: SelectOption<string>[] = useMemo(() => {
    const targets = [...new Set(taskPacks.map((taskPack) => taskPack.targetTool))]
      .filter(Boolean)
      .sort();
    const allAgentsIcon = makeAiToolSelectOption("generic");

    return [
      {
        value: "all",
        label: t("taskPacksPage.allAgents"),
        description: t("taskPacksPage.allAgentsDesc"),
        icon: allAgentsIcon.icon,
        activeIcon: allAgentsIcon.activeIcon,
      },
      ...targets.map((target) => makeAiToolSelectOption(target)),
    ];
  }, [taskPacks, t]);

  const filteredTaskPacks = useMemo(() => {
    const normalizedQuery = normalize(query).trim();

    return [...taskPacks]
      .filter((taskPack) => {
        const recipe = taskPack.generationRecipe;
        const searchableText = [
          taskPack.title,
          getTaskPackDisplayTitle(taskPack),
          getTaskPackArchiveSummary(taskPack),
          taskPack.rawTask,
          taskPack.generatedPrompt,
          getTaskPackProjectName(taskPack, t),
          taskPack.taskType,
          taskPack.targetTool,
          getTaskPackBodyBadge(taskPack, t),
          recipe?.template?.name,
          recipe?.ruleProfile?.name,
          recipe?.enabledRules.map((rule) => rule.title).join(" "),
          recipe?.customRules.join(" "),
          recipe?.acceptanceCriteria.join(" "),
          recipe?.githubIssue?.issueTitle,
          recipe?.githubIssue?.fullName,
          recipe?.githubIssue?.labels.join(" "),
          recipe?.githubCreatedIssue?.issueTitle,
          recipe?.githubCreatedIssue?.fullName,
          recipe?.githubCreatedIssue?.labels.join(" "),
        ]
          .map(normalize)
          .join(" ");

        const matchesQuery =
          normalizedQuery.length === 0 || searchableText.includes(normalizedQuery);
        const matchesTaskType =
          taskTypeFilter === "all" || taskPack.taskType === taskTypeFilter;
        const matchesTarget =
          targetFilter === "all" || taskPack.targetTool === targetFilter;
        const matchesBody = matchesBodyMode(taskPack, bodyModeFilter);

        return matchesQuery && matchesTaskType && matchesTarget && matchesBody;
      })
      .sort((a, b) => {
        if (sortMode === "oldest") return getDateValue(a) - getDateValue(b);
        if (sortMode === "title") {
          return getTaskPackDisplayTitle(a).localeCompare(getTaskPackDisplayTitle(b));
        }
        if (sortMode === "project") {
          return getTaskPackProjectName(a, t).localeCompare(getTaskPackProjectName(b, t));
        }
        return getDateValue(b) - getDateValue(a);
      });
  }, [
    bodyModeFilter,
    query,
    sortMode,
    targetFilter,
    taskPacks,
    taskTypeFilter,
    t,
  ]);

  const refinedCount = taskPacks.filter(
    (taskPack) =>
      taskPack.generationMode === "ollama" && !taskPack.generationUsedFallback,
  ).length;
  const mostUsedTarget = getMostUsedTarget(taskPacks);

  const advancedFilterCount = [
    taskTypeFilter !== "all",
    targetFilter !== "all",
    sortMode !== "newest",
  ].filter(Boolean).length;

  const hasActiveFilters =
    query.trim().length > 0 ||
    taskTypeFilter !== "all" ||
    targetFilter !== "all" ||
    bodyModeFilter !== "all" ||
    sortMode !== "newest";

  function clearFilters() {
    setQuery("");
    setTaskTypeFilter("all");
    setTargetFilter("all");
    setBodyModeFilter("all");
    setSortMode("newest");
  }

  async function handleCopy(taskPack: TaskPack) {
    await navigator.clipboard.writeText(taskPack.generatedPrompt);
    setCopiedTaskPackId(taskPack.id);

    window.setTimeout(() => {
      setCopiedTaskPackId(null);
    }, 1400);
  }

  async function handlePublish(taskPack: TaskPack) {
    const bridge = window.contextforge?.desktopSync;
    if (!bridge) {
      setPublishError(t("taskPacksPage.cloudUnavailable"));
      return;
    }

    setPublishStateById((current) => ({ ...current, [taskPack.id]: "publishing" }));
    setPublishError("");
    try {
      await bridge.publishTaskPack({
        sourceTaskPackId: String(taskPack.id),
        title: getTaskPackDisplayTitle(taskPack),
        projectName: getTaskPackProjectName(taskPack, t),
        rawTask: taskPack.rawTask,
        taskType: taskPack.taskType,
        targetTool: taskPack.targetTool,
        generatedPrompt: taskPack.generatedPrompt,
        sourceCreatedAt: taskPack.createdAt,
      });
      setPublishStateById((current) => ({ ...current, [taskPack.id]: "published" }));
    } catch (reason) {
      setPublishStateById((current) => ({ ...current, [taskPack.id]: "idle" }));
      setPublishError(reason instanceof Error ? reason.message : t("taskPacksPage.cloudRequestFailed"));
    }
  }

  return (
    <section className="flex h-[calc(100vh-96px)] min-h-0 flex-col gap-3 overflow-hidden">
      <header className="shrink-0 rounded-[1.5rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.01))] px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-5">
          <div className="flex min-w-0 items-center gap-4">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl border border-neutral-800 bg-black/45 text-neutral-300">
              <Archive size={18} />
            </span>
            <div className="min-w-0">
              <h2 className="text-[26px] font-semibold leading-tight tracking-[-0.045em] text-white">
                {t("taskPacksPage.libraryTitle")}
              </h2>
              <p className="mt-1 max-w-2xl truncate text-sm text-neutral-500">
                {t("taskPacksPage.libraryDescription")}
              </p>
            </div>
          </div>

          <div className="flex divide-x divide-neutral-900 rounded-2xl border border-neutral-900 bg-black/25 px-4 py-2.5">
            <SummaryMetric value={taskPacks.length} label={t("taskPacksPage.savedSummary")} />
            <SummaryMetric value={refinedCount} label={t("taskPacksPage.refinedSummary")} />
            <SummaryMetric value={mostUsedTarget} label={t("taskPacksPage.topTargetSummary")} />
          </div>
        </div>
      </header>

      <CloudTaskPackBridge onImportedTaskPack={onImportedTaskPack} />

      {publishError && (
        <div className="shrink-0 rounded-xl border border-amber-500/20 bg-amber-500/[0.07] px-3 py-2 text-xs text-amber-100">
          {getFriendlyWebsiteError(publishError, t)}
        </div>
      )}

      <section className="shrink-0 rounded-[1.4rem] border border-neutral-900 bg-black/30 p-3">
        <div className="grid gap-3 xl:grid-cols-[minmax(260px,1fr)_minmax(480px,640px)_auto] xl:items-center">
          <div className="relative">
            <Search
              size={15}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-600"
            />
            <input
              value={query}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setQuery(event.target.value)
              }
              placeholder={t("taskPacksPage.searchPlaceholder")}
              className="h-11 w-full rounded-2xl border border-neutral-900 bg-black/40 pl-10 pr-3 text-sm text-white outline-none transition placeholder:text-neutral-700 hover:border-neutral-700 focus:border-white/30 focus:bg-black/75 focus:ring-4 focus:ring-white/5"
            />
          </div>

          <HorizontalSlidingSelector
            items={localizedBodyModeOptions}
            activeIndex={localizedBodyModeOptions.findIndex((option) => option.value === bodyModeFilter)}
            getItemKey={(option) => option.value}
            onSelect={(option) => setBodyModeFilter(option.value)}
            ariaLabel={t("taskPacksPage.generationMode")}
            itemClassName="h-10 px-2"
            renderItem={(option, isActive) => (
              <span className={[
                "block truncate text-xs font-semibold",
                isActive ? "text-black" : "text-neutral-400",
              ].join(" ")}>{option.label}</span>
            )}
          />

          <Button
            variant="secondary"
            onClick={() => setFiltersOpen((current) => !current)}
            className="h-11 min-w-[118px] px-4 text-xs"
            aria-expanded={filtersOpen}
          >
            <Filter size={14} />
            {t("taskPacksPage.filters")}
            {advancedFilterCount > 0 ? ` · ${advancedFilterCount}` : ""}
            <motion.span
              animate={{ rotate: filtersOpen ? 180 : 0 }}
              transition={{ type: "spring", stiffness: 560, damping: 42, mass: 0.5 }}
            >
              <ChevronDown size={14} />
            </motion.span>
          </Button>
        </div>

        <motion.div
          className="grid"
          initial={false}
          animate={{ gridTemplateRows: filtersOpen ? "1fr" : "0fr" }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="overflow-hidden">
            <div className="mt-3 grid gap-3 border-t border-neutral-900 pt-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
              <CustomSelect
                value={taskTypeFilter}
                options={localizedTaskTypeOptions}
                onChange={(value) => setTaskTypeFilter(value as TaskTypeFilter)}
              />
              <CustomSelect
                value={targetFilter}
                options={targetOptions}
                onChange={setTargetFilter}
              />
              <CustomSelect
                value={sortMode}
                options={localizedSortOptions}
                onChange={(value) => setSortMode(value as SortMode)}
              />
              <Button
                variant="ghost"
                onClick={clearFilters}
                disabled={!hasActiveFilters}
                className="h-11 px-4 text-xs disabled:cursor-not-allowed disabled:opacity-35"
              >
                <X size={14} />
                {t("taskPacksPage.clearFilters")}
              </Button>
            </div>
          </div>
        </motion.div>
      </section>

      <main className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-3 overflow-hidden">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-1">
          <div className="flex items-center gap-2">
            <SlidersHorizontal size={14} className="text-neutral-600" />
            <h3 className="text-sm font-semibold text-white">
              {t("taskPacksPage.resultCount", { count: filteredTaskPacks.length })}
            </h3>
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs text-neutral-600 transition hover:text-white"
            >
              {t("taskPacksPage.clearFilters")}
            </button>
          )}
        </div>

        <AnimatePresence mode="wait" initial={false}>
          {filteredTaskPacks.length === 0 ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0, y: 14, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.985 }}
              transition={TASK_PACK_TRANSITION}
              className="min-h-0 overflow-hidden"
            >
              <EmptyState
                icon={<Search size={22} />}
                title={t(taskPacks.length === 0 ? "taskPacksPage.noTaskPacks" : "taskPacksPage.noMatching")}
                description={t(taskPacks.length === 0 ? "taskPacksPage.noTaskPacksDescription" : "taskPacksPage.noMatchingDescription")}
              />
            </motion.div>
          ) : (
            <motion.div
              key={["list", query.trim(), taskTypeFilter, targetFilter, bodyModeFilter, sortMode].join(":")}
              className="min-h-0 overflow-y-auto pr-2"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={TASK_PACK_TRANSITION}
            >
              <div className="grid gap-3 2xl:grid-cols-2">
                {filteredTaskPacks.map((taskPack) => (
                  <TaskPackCard
                    key={taskPack.id}
                    taskPack={taskPack}
                    isCopied={copiedTaskPackId === taskPack.id}
                    projectName={getTaskPackProjectName(taskPack, t)}
                    bodyLabel={getTaskPackBodyBadge(taskPack, t)}
                    onCopy={() => void handleCopy(taskPack)}
                    onOpen={() => onOpenTaskPack(taskPack)}
                    onPublish={() => void handlePublish(taskPack)}
                    publishState={publishStateById[taskPack.id] ?? "idle"}
                  />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </section>
  );
}
