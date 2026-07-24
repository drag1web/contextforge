import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import {
  Archive,
  Bot,
  Check,
  Clipboard,
  CloudUpload,
  ExternalLink,
  FileText,
  Github,
  Inbox,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";

import type { Project, TaskPack } from "../types";
import type { DesktopSyncTaskPackInboxItem } from "../types/desktopSync";
import { getProjects, importCloudTaskPack } from "../api/client";
import { TaskPackExportActions } from "../components/taskPacks/TaskPackExportActions";
import { Button } from "../components/ui/Button";
import { makeAiToolSelectOption } from "../components/ai/aiToolOptions";
import { CustomSelect, type SelectOption } from "../components/ui/CustomSelect";

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

function Pill({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
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
        "inline-flex h-6 max-w-full items-center gap-1.5 truncate rounded-full border px-2.5 text-[11px] font-medium",
        className,
      ].join(" ")}
    >
      {children}
    </span>
  );
}

function MetricCard({
  icon,
  label,
  value,
  caption,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  caption: string;
}) {
  return (
    <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-300">
          {icon}
        </span>

        <span className="cf-display-font text-2xl font-semibold text-white">
          {value}
        </span>
      </div>

      <p className="cf-tech-label truncate text-[10px] uppercase text-neutral-600">
        {label}
      </p>

      <p className="mt-1 truncate text-xs text-neutral-600">{caption}</p>
    </div>
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

function EmptyState({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <section className="grid h-full min-h-[360px] place-items-center rounded-[1.5rem] border border-dashed border-neutral-800 bg-black/25 p-8 text-center">
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

function TaskPackCard({
  taskPack,
  isCopied,
  projectName,
  bodyBadge,
  onCopy,
  onOpen,
  onPublish,
  publishState,
}: {
  taskPack: TaskPack;
  isCopied: boolean;
  projectName: string;
  bodyBadge: string;
  onCopy: () => void;
  onOpen: () => void;
  onPublish: () => void;
  publishState: "idle" | "publishing" | "published";
}) {
  const { t } = useTranslation();
  const recipe = taskPack.generationRecipe;

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={TASK_PACK_TRANSITION}
      className="group rounded-[1.5rem] border border-neutral-900 bg-black/35 p-5 transition hover:border-white/15 hover:bg-white/[0.035]"
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap gap-2">
            <Pill>{bodyBadge}</Pill>

            {recipe && <Pill tone="success">v0.5 recipe</Pill>}

            {recipe?.githubIssue && (
              <Pill tone="success">
                <Github size={12} />
                Issue #{recipe.githubIssue.issueNumber}
              </Pill>
            )}

            {recipe?.githubCreatedIssue && (
              <Pill tone="success">
                <ExternalLink size={12} />
                Created #{recipe.githubCreatedIssue.issueNumber}
              </Pill>
            )}
          </div>

          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-300">
              <FileText size={15} />
            </span>

            <div className="min-w-0">
              <h4 className="line-clamp-2 text-base font-semibold leading-6 text-white">
                {getTaskPackDisplayTitle(taskPack)}
              </h4>

              <p className="mt-1 truncate text-xs text-neutral-600">
                {projectName}
              </p>
            </div>
          </div>
        </div>
      </div>

      <p className="line-clamp-3 text-sm leading-6 text-neutral-500">
        {getTaskPackArchiveSummary(taskPack)}
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        <Pill>{taskPack.targetTool}</Pill>
        <Pill>{taskPack.taskType}</Pill>

        {recipe?.template && <Pill>Template: {recipe.template.name}</Pill>}

        {recipe?.ruleProfile && <Pill>Profile: {recipe.ruleProfile.name}</Pill>}

        {recipe && (
          <Pill tone="success">Rules: {recipe.counts.enabledRules}</Pill>
        )}
      </div>

      {recipe && (
        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-neutral-900 bg-black/35 p-2.5">
            <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
              Rules
            </p>

            <p className="mt-1 text-sm font-semibold text-white">
              {recipe.counts.enabledRules}
            </p>
          </div>

          <div className="rounded-xl border border-neutral-900 bg-black/35 p-2.5">
            <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
              Custom
            </p>

            <p className="mt-1 text-sm font-semibold text-white">
              {recipe.counts.customRules}
            </p>
          </div>

          <div className="rounded-xl border border-neutral-900 bg-black/35 p-2.5">
            <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
              Criteria
            </p>

            <p className="mt-1 text-sm font-semibold text-white">
              {recipe.counts.acceptanceCriteria}
            </p>
          </div>
        </div>
      )}

      <div className="mt-5 flex items-center justify-between gap-4 border-t border-neutral-900 pt-4">
        <p className="truncate text-xs text-neutral-700">
          {formatDate(taskPack.createdAt)}
        </p>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <TaskPackExportActions taskPack={taskPack} compact />

          <Button
            variant="secondary"
            onClick={onPublish}
            disabled={publishState === "publishing"}
          >
            {publishState === "published" ? <Check size={15} /> : <CloudUpload size={15} />}
            {publishState === "publishing"
              ? t("taskPacksPage.publishing")
              : publishState === "published"
                ? t("taskPacksPage.onWebsite")
                : t("taskPacksPage.publish")}
          </Button>

          {recipe?.githubCreatedIssue && (
            <Button
              variant="secondary"
              onClick={() => openGitHubUrl(recipe.githubCreatedIssue!.issueUrl)}
            >
              <ExternalLink size={15} />
              Issue
            </Button>
          )}

          <Button variant="secondary" onClick={onCopy}>
            {isCopied ? <Check size={15} /> : <Clipboard size={15} />}
            {isCopied ? "Copied" : "Copy"}
          </Button>

          <Button variant="primary" onClick={onOpen}>
            Open
          </Button>
        </div>
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
      setProjectByDelivery((current) => {
        const fallback = String(localProjects[0]?.id ?? "");
        return Object.fromEntries(items.map((item) => [
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

  return (
    <section className="xl:col-span-2 rounded-[1.5rem] border border-white/10 bg-white/[0.025] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-2xl border border-neutral-800 bg-black/45 text-neutral-300">
            <Inbox size={17} />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-white">{t("taskPacksPage.cloudBridge")}</h3>
              <Pill tone={connected ? "success" : "warning"}>
                {connected ? t("taskPacksPage.cloudConnected") : t("taskPacksPage.cloudDisconnected")}
              </Pill>
            </div>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-neutral-500">
              {t("taskPacksPage.cloudBridgeDescription")}
            </p>
            {connected && (
              <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-emerald-400/80">
                <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.65)]" />
                {t("taskPacksPage.autoRefreshActive")}
                {lastCheckedAt ? ` · ${lastCheckedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : ""}
              </p>
            )}
          </div>
        </div>
        <Button variant="secondary" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          {t("taskPacksPage.refreshInbox")}
        </Button>
      </div>

      {error && (
        <p className="mt-3 rounded-xl border border-red-500/20 bg-red-500/[0.07] px-3 py-2 text-xs text-red-200">
          {error}
        </p>
      )}
      {notice && (
        <p className="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.07] px-3 py-2 text-xs text-emerald-200">
          {notice}
        </p>
      )}

      {connected && inbox.length > 0 && (
        <div className="mt-4 grid max-h-[280px] gap-3 overflow-y-auto pr-1 2xl:grid-cols-2">
          {inbox.map((item) => {
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
                  <Pill tone={item.taskPack.integrityValid ? "success" : "warning"}>
                    {item.taskPack.integrityValid ? t("taskPacksPage.integrityVerified") : t("taskPacksPage.integrityFailed")}
                  </Pill>
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
      )}

      {connected && !loading && inbox.length === 0 && (
        <p className="mt-3 text-xs text-neutral-600">{t("taskPacksPage.inboxEmpty")}</p>
      )}
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
  const [copiedTaskPackId, setCopiedTaskPackId] = useState<number | null>(null);
  const [publishStateById, setPublishStateById] = useState<Record<number, "idle" | "publishing" | "published">>({});
  const [publishError, setPublishError] = useState("");

  const localizedTaskTypeOptions = useMemo<SelectOption<TaskTypeFilter>[]>(
    () => [
      {
        value: "all",
        label: t("labels.taskTypeAll"),
        description: t("taskPacksPage.allTypes"),
      },
      {
        value: "general",
        label: t("labels.taskTypeGeneral"),
        description: "General",
      },
      { value: "ui", label: t("labels.taskTypeUi"), description: "Interface" },
      {
        value: "backend",
        label: t("labels.taskTypeBackend"),
        description: "Server",
      },
      {
        value: "fullstack",
        label: t("labels.taskTypeFullstack"),
        description: "Both sides",
      },
      {
        value: "build",
        label: t("labels.taskTypeBuild"),
        description: "Build",
      },
      {
        value: "bugfix",
        label: t("labels.taskTypeBugfix"),
        description: "Fixes",
      },
      {
        value: "refactor",
        label: t("labels.taskTypeRefactor"),
        description: "Cleanup",
      },
      {
        value: "docs",
        label: t("labels.taskTypeDocs"),
        description: "Writing",
      },
      {
        value: "tests",
        label: t("labels.taskTypeTests"),
        description: "Coverage",
      },
    ],
    [t],
  );

  const localizedBodyModeOptions = useMemo<SelectOption<BodyModeFilter>[]>(
    () => [
      {
        value: "all",
        label: t("taskPacksPage.allBodyModes"),
        description: t("taskPacksPage.allBodyModesDesc"),
      },
      {
        value: "ollama",
        label: t("labels.ollamaRefined"),
        description: t("taskPacksPage.ollamaRefinedDesc"),
      },
      {
        value: "template",
        label: t("labels.safeTemplate"),
        description: t("taskPacksPage.safeTemplateDesc"),
      },
      {
        value: "cached",
        label: t("labels.cached"),
        description: t("taskPacksPage.cachedDesc"),
      },
      {
        value: "fallback",
        label: t("labels.fallback"),
        description: t("taskPacksPage.fallbackDesc"),
      },
    ],
    [t],
  );

  const localizedSortOptions = useMemo<SelectOption<SortMode>[]>(
    () => [
      {
        value: "newest",
        label: t("taskPacksPage.newest"),
        description: t("taskPacksPage.newestDesc"),
      },
      {
        value: "oldest",
        label: t("taskPacksPage.oldest"),
        description: t("taskPacksPage.oldestDesc"),
      },
      {
        value: "title",
        label: t("taskPacksPage.titleSort"),
        description: t("taskPacksPage.titleSortDesc"),
      },
      {
        value: "project",
        label: t("taskPacksPage.projectSort"),
        description: t("taskPacksPage.projectSortDesc"),
      },
    ],
    [t],
  );

  const targetOptions: SelectOption<string>[] = useMemo(() => {
    const targets = [
      ...new Set(taskPacks.map((taskPack) => taskPack.targetTool)),
    ]
      .filter(Boolean)
      .sort();
    const allAgentsIcon = makeAiToolSelectOption("generic");

    return [
      {
        value: "all",
        label: t("taskPacksPage.allAgents"),
        description: "Codex, Cursor, Claude, Generic",
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
          normalizedQuery.length === 0 ||
          searchableText.includes(normalizedQuery);

        const matchesTaskType =
          taskTypeFilter === "all" || taskPack.taskType === taskTypeFilter;

        const matchesTarget =
          targetFilter === "all" || taskPack.targetTool === targetFilter;

        const matchesBody = matchesBodyMode(taskPack, bodyModeFilter);

        return matchesQuery && matchesTaskType && matchesTarget && matchesBody;
      })
      .sort((a, b) => {
        if (sortMode === "oldest") {
          return getDateValue(a) - getDateValue(b);
        }

        if (sortMode === "title") {
          return getTaskPackDisplayTitle(a).localeCompare(getTaskPackDisplayTitle(b));
        }

        if (sortMode === "project") {
          return getTaskPackProjectName(a, t).localeCompare(
            getTaskPackProjectName(b, t),
          );
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

  const recipeCount = taskPacks.filter(
    (taskPack) => taskPack.generationRecipe,
  ).length;
  const fallbackCount = taskPacks.filter(
    (taskPack) => taskPack.generationUsedFallback,
  ).length;
  const mostUsedTarget = getMostUsedTarget(taskPacks);

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
    <section className="grid h-[calc(100vh-96px)] min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-4 overflow-hidden">
      <div className="grid shrink-0 gap-4 xl:grid-cols-[minmax(0,1fr)_520px]">
        <div className="overflow-hidden rounded-[1.75rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.012))] p-5 shadow-[0_16px_52px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.045)]">
          <div className="mb-4 flex flex-wrap gap-2">
            <Pill>
              <Archive size={13} />
              {t("taskPacksPage.archive")}
            </Pill>

            <Pill>{t("taskPacksPage.searchablePrompts")}</Pill>
            <Pill>{t("taskPacksPage.agentReadyHistory")}</Pill>

            {recipeCount > 0 && (
              <Pill tone="success">v0.5 recipe metadata</Pill>
            )}
          </div>

          <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-end 2xl:justify-between">
            <div>
              <h2 className="max-w-4xl text-[32px] font-semibold leading-[1.05] tracking-[-0.05em] text-white">
                {t("taskPacksPage.title")}
              </h2>

              <p className="mt-3 max-w-3xl text-sm leading-6 text-neutral-400">
                {t("taskPacksPage.description")}
              </p>
            </div>

            <Pill>{filteredTaskPacks.length} visible</Pill>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <MetricCard
            icon={<FileText size={15} />}
            label="Total"
            value={taskPacks.length}
            caption="saved Task Packs"
          />

          <MetricCard
            icon={<ShieldCheck size={15} />}
            label="Recipes"
            value={recipeCount}
            caption="v0.5 metadata"
          />

          <MetricCard
            icon={<Sparkles size={15} />}
            label="Refined"
            value={refinedCount}
            caption="Ollama bodies"
          />

          <MetricCard
            icon={<Bot size={15} />}
            label="Top target"
            value={mostUsedTarget}
            caption={`${fallbackCount} fallback`}
          />
        </div>

        <CloudTaskPackBridge onImportedTaskPack={onImportedTaskPack} />

        {publishError && (
          <p className="xl:col-span-2 rounded-xl border border-red-500/20 bg-red-500/[0.07] px-3 py-2 text-xs text-red-200">
            {publishError}
          </p>
        )}
      </div>

      <div className="grid min-h-0 gap-4 overflow-hidden xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-[1.5rem] border border-neutral-900 bg-black/35 p-5">
          <div className="mb-5 shrink-0">
            <div className="mb-4 flex size-10 items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-300">
              <SlidersHorizontal size={18} />
            </div>

            <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
              Filter console
            </p>

            <h3 className="mt-2 text-base font-semibold text-white">
              Search and narrow history
            </h3>

            <p className="mt-2 text-sm leading-6 text-neutral-500">
              Filter saved prompts by task type, target agent, generation mode,
              recipe metadata and text content.
            </p>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            <div className="rounded-2xl border border-neutral-900 bg-black/30 p-3">
              <div className="mb-3">
                <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                  Search
                </p>

                <p className="mt-1 text-xs text-neutral-600">
                  Search by task, project, agent, template or rules.
                </p>
              </div>

              <div className="relative">
                <Search
                  size={15}
                  className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-600"
                />

                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Type to search..."
                  className="h-10 w-full rounded-xl border border-neutral-900 bg-black/50 pl-10 pr-3 text-sm text-white outline-none transition placeholder:text-neutral-700 hover:border-neutral-800 focus:border-white/30 focus:bg-black/75 focus:ring-4 focus:ring-white/5"
                />
              </div>
            </div>

            <div className="rounded-2xl border border-neutral-900 bg-black/30 p-3">
              <div className="mb-3">
                <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                  {t("taskPacksPage.taskType")}
                </p>

                <p className="mt-1 text-xs text-neutral-600">
                  {t("taskPacksPage.narrowByTask")}
                </p>
              </div>

              <CustomSelect
                value={taskTypeFilter}
                options={localizedTaskTypeOptions}
                onChange={(value) => setTaskTypeFilter(value as TaskTypeFilter)}
              />
            </div>

            <CustomSelect
              value={targetFilter}
              options={targetOptions}
              onChange={setTargetFilter}
            />

            <CustomSelect
              value={bodyModeFilter}
              options={localizedBodyModeOptions}
              onChange={(value) => setBodyModeFilter(value as BodyModeFilter)}
            />

            <CustomSelect
              value={sortMode}
              options={localizedSortOptions}
              onChange={(value) => setSortMode(value as SortMode)}
            />

            <button
              type="button"
              onClick={clearFilters}
              disabled={!hasActiveFilters}
              className={[
                "cf-invert-action inline-flex h-9 w-full items-center justify-center gap-2 rounded-full px-4 text-xs transition",
                hasActiveFilters
                  ? "opacity-100"
                  : "pointer-events-none opacity-40",
              ].join(" ")}
            >
              <X size={13} />
              {t("taskPacksPage.clearFilters")}
            </button>
          </div>
        </aside>

        <main className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-4 overflow-hidden">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
            <div>
              <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                Archive results
              </p>

              <h3 className="mt-1 text-lg font-semibold text-white">
                {filteredTaskPacks.length} Task Pack(s)
              </h3>
            </div>

            <Pill>{hasActiveFilters ? "Filtered" : "All history"}</Pill>
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
                key={[
                  "list",
                  query.trim(),
                  taskTypeFilter,
                  targetFilter,
                  bodyModeFilter,
                  sortMode,
                ].join(":")}
                className="min-h-0 overflow-y-auto pr-2"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={TASK_PACK_TRANSITION}
              >
                <div className="grid gap-4 2xl:grid-cols-2">
                  {filteredTaskPacks.map((taskPack) => {
                    const isCopied = copiedTaskPackId === taskPack.id;

                    return (
                      <TaskPackCard
                        key={taskPack.id}
                        taskPack={taskPack}
                        isCopied={isCopied}
                        projectName={getTaskPackProjectName(taskPack, t)}
                        bodyBadge={getTaskPackBodyBadge(taskPack, t)}
                        onCopy={() => handleCopy(taskPack)}
                        onOpen={() => onOpenTaskPack(taskPack)}
                        onPublish={() => void handlePublish(taskPack)}
                        publishState={publishStateById[taskPack.id] ?? "idle"}
                      />
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>
    </section>
  );
}
