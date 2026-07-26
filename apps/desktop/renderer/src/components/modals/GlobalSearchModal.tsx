import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  Check,
  Code2,
  Copy,
  FileText,
  FolderKanban,
  Loader2,
  Plus,
  Search,
  Settings,
  type LucideIcon
} from "lucide-react";

import type { Project, TaskPack, WorkspaceSearchResult } from "../../types";
import { searchWorkspace } from "../../api/client";
import { keyboardShortcuts, type ShortcutActionId } from "../../config/keyboardShortcuts";
import {
  navigationSections,
  type AppPageId
} from "../layout/Sidebar";
import { Modal } from "../ui/Modal";

interface GlobalSearchModalProps {
  activePage: AppPageId;
  projects: Project[];
  taskPacks: TaskPack[];
  onNavigate: (page: AppPageId) => void;
  onOpenTaskPack: (taskPack: TaskPack) => void;
  onAddProject: () => void;
  onClose: () => void;
}

interface SearchItem {
  id: string;
  title: string;
  subtitle: string;
  kind: string;
  keywords: string;
  icon: LucideIcon;
  status?: string;
  actionType?: "open" | "copy";
  action: () => void;
}

function normalize(value: unknown) {
  return String(value ?? "").toLocaleLowerCase();
}

function getShortcutLabelKey(id: ShortcutActionId) {
  return `globalSearch.shortcuts.${id}`;
}

export function GlobalSearchModal({
  activePage,
  projects,
  taskPacks,
  onNavigate,
  onOpenTaskPack,
  onAddProject,
  onClose
}: GlobalSearchModalProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [query, setQuery] = useState("");
  const [workspaceResults, setWorkspaceResults] = useState<WorkspaceSearchResult[]>([]);
  const [isSearchingWorkspace, setIsSearchingWorkspace] = useState(false);
  const [copiedResultId, setCopiedResultId] = useState<string | null>(null);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 50);

    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    const normalizedQuery = query.trim();

    if (normalizedQuery.length < 2) {
      setWorkspaceResults([]);
      setIsSearchingWorkspace(false);
      return;
    }

    let isCancelled = false;

    const timeoutId = window.setTimeout(async () => {
      try {
        setIsSearchingWorkspace(true);
        const response = await searchWorkspace(normalizedQuery);

        if (!isCancelled) {
          setWorkspaceResults(response.results);
        }
      } catch {
        if (!isCancelled) {
          setWorkspaceResults([]);
        }
      } finally {
        if (!isCancelled) {
          setIsSearchingWorkspace(false);
        }
      }
    }, 220);

    return () => {
      isCancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [query]);

  async function handleCopyWorkspaceResult(result: WorkspaceSearchResult) {
    const value = result.absolutePath ?? result.relativePath ?? result.title;

    try {
      await navigator.clipboard.writeText(value);
      setCopiedResultId(result.id);
      window.setTimeout(() => setCopiedResultId(null), 1400);
    } catch {
      setCopiedResultId(null);
    }
  }

  const localItems = useMemo<SearchItem[]>(() => {
    const pageItems: SearchItem[] = navigationSections.flatMap((section) =>
      section.items.map((item) => ({
        id: `page-${item.id}`,
        title: t(item.labelKey),
        subtitle: t(item.descriptionKey),
        kind: t(section.titleKey),
        keywords: [
          item.label,
          item.description,
          t(item.labelKey),
          t(item.descriptionKey),
          t(section.titleKey),
          item.status ?? ""
        ].join(" "),
        icon: item.icon,
        status: item.id === activePage ? t("globalSearch.currentPage") : undefined,
        actionType: "open" as const,
        action: () => {
          onNavigate(item.id);
          onClose();
        }
      }))
    );

    const projectItems: SearchItem[] = projects.map((project) => ({
      id: `project-${project.id}`,
      title: project.name,
      subtitle: `${project.localPath} · ${
        project.detectedStack.length > 0
          ? project.detectedStack.join(", ")
          : t("globalSearch.unknownStack")
      }`,
      kind: t("globalSearch.kindProject"),
      keywords: [
        project.name,
        project.localPath,
        project.packageManager,
        project.detectedStack.join(" "),
        project.readinessScore
      ].join(" "),
      icon: FolderKanban,
      status: `${project.readinessScore}/100`,
      actionType: "open",
      action: () => {
        onNavigate("projects");
        onClose();
      }
    }));

    const taskPackItems: SearchItem[] = taskPacks.map((taskPack) => ({
      id: `task-pack-${taskPack.id}`,
      title: taskPack.title,
      subtitle: `${
        taskPack.projectName ??
        t("globalSearch.projectNumber", { number: taskPack.projectId })
      } · ${taskPack.taskType} · ${taskPack.targetTool}`,
      kind: t("globalSearch.kindTaskPack"),
      keywords: [
        taskPack.title,
        taskPack.rawTask,
        taskPack.projectName,
        taskPack.taskType,
        taskPack.targetTool,
        taskPack.generationMode
      ].join(" "),
      icon: FileText,
      status:
        taskPack.generationMode === "ollama"
          ? "Ollama"
          : t("globalSearch.templateMode"),
      actionType: "open",
      action: () => {
        onClose();
        onOpenTaskPack(taskPack);
      }
    }));

    const actionItems: SearchItem[] = [
      {
        id: "action-add-project",
        title: t("globalSearch.addProject"),
        subtitle: t("globalSearch.addProjectDescription"),
        kind: t("globalSearch.kindAction"),
        keywords: "add project scan repository folder local добавить проект папка репозиторий",
        icon: Plus,
        status: "Ctrl Shift O",
        actionType: "open",
        action: () => {
          onClose();
          onAddProject();
        }
      },
      {
        id: "action-settings",
        title: t("globalSearch.openSettings"),
        subtitle: t("globalSearch.openSettingsDescription"),
        kind: t("globalSearch.kindAction"),
        keywords: "settings ollama generation defaults model настройки модель генерация",
        icon: Settings,
        status: "Ctrl ,",
        actionType: "open",
        action: () => {
          onNavigate("settings");
          onClose();
        }
      }
    ];

    return [...actionItems, ...pageItems, ...projectItems, ...taskPackItems];
  }, [
    activePage,
    onAddProject,
    onClose,
    onNavigate,
    onOpenTaskPack,
    projects,
    t,
    taskPacks
  ]);

  const filteredLocalItems = useMemo(() => {
    const normalizedQuery = normalize(query).trim();

    if (!normalizedQuery) {
      return localItems.slice(0, 8);
    }

    return localItems.filter((item) =>
      normalize(`${item.title} ${item.subtitle} ${item.kind} ${item.keywords}`).includes(
        normalizedQuery
      )
    );
  }, [localItems, query]);

  const deepItems = useMemo<SearchItem[]>(() => {
    return workspaceResults.map((result) => {
      if (result.type === "file") {
        return {
          id: `workspace-file-${result.id}`,
          title: result.title,
          subtitle: result.subtitle || result.relativePath || result.absolutePath || "",
          kind: t("globalSearch.kindProjectFile"),
          keywords: `${result.title} ${result.subtitle} ${result.relativePath ?? ""} ${result.snippet ?? ""}`,
          icon: Code2,
          status:
            copiedResultId === result.id
              ? t("globalSearch.copied")
              : t("globalSearch.copyPath"),
          actionType: "copy" as const,
          action: () => {
            void handleCopyWorkspaceResult(result);
          }
        };
      }

      if (result.type === "taskPack") {
        const matchingTaskPack = taskPacks.find(
          (taskPack) => taskPack.id === result.taskPackId
        );

        return {
          id: matchingTaskPack
            ? `task-pack-${matchingTaskPack.id}`
            : `workspace-task-pack-${result.id}`,
          title: result.title,
          subtitle: result.subtitle,
          kind: t("globalSearch.kindTaskPack"),
          keywords: `${result.title} ${result.subtitle} ${result.snippet ?? ""}`,
          icon: FileText,
          actionType: "open" as const,
          action: () => {
            onClose();
            if (matchingTaskPack) {
              onOpenTaskPack(matchingTaskPack);
            } else {
              onNavigate("taskPacks");
            }
          }
        };
      }

      return {
        id: result.projectId
          ? `project-${result.projectId}`
          : `workspace-project-${result.id}`,
        title: result.title,
        subtitle: result.subtitle,
        kind: t("globalSearch.kindProject"),
        keywords: `${result.title} ${result.subtitle} ${result.snippet ?? ""}`,
        icon: FolderKanban,
        actionType: "open" as const,
        action: () => {
          onNavigate("projects");
          onClose();
        }
      };
    });
  }, [copiedResultId, onClose, onNavigate, onOpenTaskPack, t, taskPacks, workspaceResults]);

  const displayItems = useMemo(() => {
    const hasQuery = query.trim().length > 0;
    const ordered = hasQuery
      ? [...deepItems.slice(0, 4), ...filteredLocalItems]
      : filteredLocalItems;
    const seen = new Set<string>();

    return ordered
      .filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      })
      .slice(0, 8);
  }, [deepItems, filteredLocalItems, query]);

  const enabledShortcuts = keyboardShortcuts.slice(0, 6);
  const hasQuery = query.trim().length > 0;
  const hasAnyResults = displayItems.length > 0;

  function handleSubmitFirstResult() {
    displayItems[0]?.action();
  }

  return (
    <Modal
      title={t("globalSearch.title")}
      eyebrow={t("globalSearch.eyebrow")}
      maxWidth="max-w-[960px]"
      scrollable={false}
      onClose={onClose}
    >
      <div className="p-4">
        <div className="flex h-12 items-center gap-3 rounded-2xl border border-white/[0.10] bg-black/50 px-4 transition focus-within:border-white/35 focus-within:bg-black/75 focus-within:ring-4 focus-within:ring-white/[0.04]">
          {isSearchingWorkspace ? (
            <Loader2 size={16} className="shrink-0 animate-spin text-neutral-500" />
          ) : (
            <Search size={16} className="shrink-0 text-neutral-500" />
          )}

          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handleSubmitFirstResult();
              }
            }}
            placeholder={t("globalSearch.searchPlaceholder")}
            className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-neutral-700"
          />

          <span className="shrink-0 rounded-lg border border-neutral-900 bg-neutral-950 px-2 py-1 font-mono text-[10px] text-neutral-600">
            Ctrl F
          </span>
        </div>

        <div className="mt-3 flex items-center justify-between gap-4 px-1">
          <p className="truncate text-[11px] text-neutral-600">
            {isSearchingWorkspace
              ? t("globalSearch.searchingWorkspace")
              : t("globalSearch.helper")}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <span className="cf-tech-label text-[9px] uppercase text-neutral-700">
              {hasQuery ? t("globalSearch.results") : t("globalSearch.quickAccess")}
            </span>
            <span className="rounded-full border border-neutral-900 bg-black px-2 py-0.5 text-[10px] text-neutral-600">
              {displayItems.length}
            </span>
          </div>
        </div>

        {hasAnyResults ? (
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {displayItems.map((item) => {
              const Icon = item.icon;
              const isCopyAction = item.actionType === "copy";
              const isCopied = isCopyAction && item.status === t("globalSearch.copied");

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={item.action}
                  className="group flex h-[58px] min-w-0 items-center gap-3 rounded-2xl border border-neutral-900 bg-black/30 px-3 text-left transition duration-150 hover:border-neutral-700 hover:bg-neutral-950"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-neutral-900 bg-black text-neutral-600 transition group-hover:border-neutral-800 group-hover:text-neutral-300">
                    <Icon size={15} />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-[13px] font-semibold text-neutral-200 transition group-hover:text-white">
                        {item.title}
                      </span>
                      <span className="shrink-0 text-[9px] uppercase tracking-[0.08em] text-neutral-700">
                        {item.kind}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-[10px] text-neutral-700 transition group-hover:text-neutral-500">
                      {item.subtitle}
                    </span>
                  </span>

                  {item.status ? (
                    <span
                      className={[
                        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-[9px]",
                        isCopied
                          ? "border-emerald-400/20 bg-emerald-400/[0.07] text-emerald-300"
                          : "border-neutral-900 bg-black text-neutral-600"
                      ].join(" ")}
                    >
                      {isCopied ? <Check size={10} /> : isCopyAction ? <Copy size={10} /> : null}
                      {item.status}
                    </span>
                  ) : (
                    <ArrowRight
                      size={12}
                      className="shrink-0 text-neutral-800 transition group-hover:translate-x-0.5 group-hover:text-neutral-500"
                    />
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="mt-3 rounded-2xl border border-neutral-900 bg-black/30 px-5 py-8 text-center">
            <p className="text-sm font-medium text-white">
              {t("globalSearch.noResultsTitle")}
            </p>
            <p className="mt-1.5 text-sm text-neutral-600">
              {t("globalSearch.noResultsDescription")}
            </p>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-neutral-900 pt-3">
          {enabledShortcuts.map((shortcut) => (
            <span
              key={shortcut.id}
              className={[
                "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px]",
                shortcut.enabled
                  ? "border-neutral-800 bg-neutral-950 text-neutral-400"
                  : "border-neutral-900 bg-black/30 text-neutral-700"
              ].join(" ")}
            >
              <span className="font-mono">{shortcut.displayKeys}</span>
              <span className="text-neutral-800">·</span>
              <span>{t(getShortcutLabelKey(shortcut.id))}</span>
              {shortcut.placeholder && (
                <span className="text-neutral-800">{t("common.soon")}</span>
              )}
            </span>
          ))}
        </div>
      </div>
    </Modal>
  );
}
