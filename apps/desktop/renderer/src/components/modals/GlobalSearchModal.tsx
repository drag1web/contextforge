import { useEffect, useMemo, useRef, useState } from "react";
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
import { keyboardShortcuts } from "../../config/keyboardShortcuts";
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
  action: () => void;
}

function normalize(value: unknown) {
  return String(value ?? "").toLowerCase();
}

function getProjectStack(project: Project) {
  return project.detectedStack.length > 0
    ? project.detectedStack.join(", ")
    : "Unknown stack";
}

function getResultIcon(result: WorkspaceSearchResult) {
  if (result.type === "file") {
    return Code2;
  }

  if (result.type === "taskPack") {
    return FileText;
  }

  return FolderKanban;
}

function getResultKind(result: WorkspaceSearchResult) {
  if (result.type === "file") {
    return "Project file";
  }

  if (result.type === "taskPack") {
    return "Task Pack";
  }

  return "Project";
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
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [query, setQuery] = useState("");
  const [workspaceResults, setWorkspaceResults] = useState<WorkspaceSearchResult[]>([]);
  const [isSearchingWorkspace, setIsSearchingWorkspace] = useState(false);
  const [copiedResultId, setCopiedResultId] = useState<string | null>(null);

  useEffect(() => {
    window.setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
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

  const searchItems = useMemo<SearchItem[]>(() => {
    const pageItems: SearchItem[] = navigationSections.flatMap((section) =>
      section.items.map((item) => ({
        id: `page-${item.id}`,
        title: item.label,
        subtitle: item.description,
        kind: section.title,
        keywords: `${item.label} ${item.description} ${item.status ?? ""}`,
        icon: item.icon,
        status: item.id === activePage ? "Current page" : item.status,
        action: () => {
          onNavigate(item.id);
          onClose();
        }
      }))
    );

    const projectItems: SearchItem[] = projects.map((project) => ({
      id: `project-${project.id}`,
      title: project.name,
      subtitle: `${project.localPath} · ${getProjectStack(project)} · AI ${project.readinessScore}/100`,
      kind: "Project",
      keywords: [
        project.name,
        project.localPath,
        project.packageManager,
        project.detectedStack.join(" "),
        project.readinessScore
      ].join(" "),
      icon: FolderKanban,
      status: `AI ${project.readinessScore}/100`,
      action: () => {
        onNavigate("projects");
        onClose();
      }
    }));

    const taskPackItems: SearchItem[] = taskPacks.map((taskPack) => ({
      id: `task-pack-${taskPack.id}`,
      title: taskPack.title,
      subtitle: `${taskPack.projectName ?? `Project #${taskPack.projectId}`} · ${taskPack.taskType} · ${taskPack.targetTool}`,
      kind: "Task Pack",
      keywords: [
        taskPack.title,
        taskPack.rawTask,
        taskPack.projectName,
        taskPack.taskType,
        taskPack.targetTool,
        taskPack.generationMode
      ].join(" "),
      icon: FileText,
      status: taskPack.generationMode === "ollama" ? "Ollama" : "Template",
      action: () => {
        onClose();
        onOpenTaskPack(taskPack);
      }
    }));

    const actionItems: SearchItem[] = [
      {
        id: "action-add-project",
        title: "Add project",
        subtitle: "Select a local repository folder and scan it.",
        kind: "Action",
        keywords: "add project scan repository folder local",
        icon: Plus,
        status: "Ctrl Shift O",
        action: () => {
          onClose();
          onAddProject();
        }
      },
      {
        id: "action-settings",
        title: "Open Settings",
        subtitle: "Ollama URL, generation mode and application defaults.",
        kind: "Action",
        keywords: "settings ollama generation defaults model",
        icon: Settings,
        status: "Ctrl ,",
        action: () => {
          onNavigate("settings");
          onClose();
        }
      }
    ];

    return [
      ...actionItems,
      ...pageItems,
      ...projectItems,
      ...taskPackItems
    ];
  }, [
    activePage,
    onAddProject,
    onClose,
    onNavigate,
    onOpenTaskPack,
    projects,
    taskPacks
  ]);

  const visibleLocalResults = useMemo(() => {
    const normalizedQuery = normalize(query).trim();

    if (!normalizedQuery) {
      return searchItems.slice(0, 8);
    }

    return searchItems
      .filter((item) => {
        const text = `${item.title} ${item.subtitle} ${item.kind} ${item.keywords}`;
        return normalize(text).includes(normalizedQuery);
      })
      .slice(0, 8);
  }, [query, searchItems]);

  const fileResults = useMemo(() => {
    return workspaceResults
      .filter((result) => result.type === "file")
      .slice(0, 8);
  }, [workspaceResults]);

  const backendTaskPackResults = useMemo(() => {
    return workspaceResults
      .filter((result) => result.type === "taskPack")
      .slice(0, 4);
  }, [workspaceResults]);

  const enabledShortcuts = keyboardShortcuts.slice(0, 6);
  const hasQuery = query.trim().length >= 2;
  const hasAnyResults =
    visibleLocalResults.length > 0 ||
    fileResults.length > 0 ||
    backendTaskPackResults.length > 0;

  function handleSubmitFirstResult() {
    if (visibleLocalResults[0]) {
      visibleLocalResults[0].action();
      return;
    }

    if (fileResults[0]) {
      handleCopyWorkspaceResult(fileResults[0]);
    }
  }

  async function handleCopyWorkspaceResult(result: WorkspaceSearchResult) {
    const value =
      result.absolutePath ??
      result.relativePath ??
      result.title;

    await navigator.clipboard.writeText(value);
    setCopiedResultId(result.id);

    window.setTimeout(() => {
      setCopiedResultId(null);
    }, 1400);
  }

  return (
    <Modal
      title="Global Search"
      eyebrow="ContextForge shortcut"
      maxWidth="max-w-[980px]"
      scrollable={false}
      onClose={onClose}
    >
      <div className="flex h-[calc(100vh-190px)] min-h-[560px] flex-col overflow-hidden p-5">
        <div className="relative mb-4 shrink-0">
          <Search
            size={16}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-neutral-600"
          />

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
            placeholder="Search pages, projects, Task Packs, files, code snippets..."
            className="h-12 w-full rounded-2xl border border-neutral-900 bg-black/45 pl-11 pr-4 text-sm text-white outline-none transition placeholder:text-neutral-700 hover:border-neutral-800 focus:border-white/40 focus:bg-black/70 focus:ring-4 focus:ring-white/5"
          />
        </div>

        <div className="mb-4 flex shrink-0 items-center justify-between gap-3">
          <p className="text-xs text-neutral-600">
            Press Enter to open the first local result. File results copy the path.
          </p>

          <div className="flex items-center gap-2">
            {isSearchingWorkspace && (
              <span className="inline-flex items-center gap-2 rounded-full border border-neutral-900 bg-neutral-950 px-2.5 py-1 text-[11px] text-neutral-500">
                <Loader2 size={12} className="animate-spin" />
                Searching files
              </span>
            )}

            <span className="rounded-full border border-neutral-900 bg-neutral-950 px-2.5 py-1 text-[11px] text-neutral-600">
              Ctrl F
            </span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {!hasAnyResults && hasQuery && !isSearchingWorkspace ? (
            <div className="rounded-2xl border border-neutral-900 bg-black/35 p-8 text-center">
              <p className="text-sm font-medium text-white">Nothing found</p>
              <p className="mt-2 text-sm text-neutral-500">
                Try another page, project, task type, file path, or code keyword.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {visibleLocalResults.length > 0 && (
                <section>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                      Local navigation
                    </p>

                    <span className="text-xs text-neutral-700">
                      {visibleLocalResults.length}
                    </span>
                  </div>

                  <div className="grid min-w-0 gap-2 md:grid-cols-2">
                    {visibleLocalResults.map((item) => {
                      const Icon = item.icon;

                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={item.action}
                          className="group flex h-[64px] items-center gap-3 rounded-2xl border border-neutral-900 bg-black/35 px-3 text-left text-neutral-400 transition duration-200 hover:border-white hover:bg-white hover:text-black hover:shadow-[0_12px_34px_rgba(255,255,255,0.10)]"
                        >
                          <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-500 transition group-hover:border-black/10 group-hover:bg-black/5 group-hover:text-black">
                            <Icon size={15} />
                          </span>

                          <span className="min-w-0 flex-1">
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="truncate text-sm font-semibold text-white transition group-hover:text-black">
                                {item.title}
                              </span>

                              {item.status && (
                                <span className="shrink-0 rounded-full border border-neutral-900 bg-neutral-950 px-1.5 py-0.5 text-[9px] text-neutral-600 transition group-hover:border-black/10 group-hover:bg-black/5 group-hover:text-black/55">
                                  {item.status}
                                </span>
                              )}
                            </span>

                            <span className="mt-0.5 block truncate text-[11px] text-neutral-600 transition group-hover:text-black/55">
                              {item.kind} · {item.subtitle}
                            </span>
                          </span>

                          <ArrowRight
                            size={13}
                            className="shrink-0 text-neutral-700 transition group-hover:translate-x-0.5 group-hover:text-black/45"
                          />
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}

              {fileResults.length > 0 && (
                <section>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                      Project files
                    </p>

                    <span className="text-xs text-neutral-700">
                      {fileResults.length}
                    </span>
                  </div>

                  <div className="grid gap-2">
                    {fileResults.map((result) => {
                      const Icon = getResultIcon(result);
                      const isCopied = copiedResultId === result.id;

                      return (
                        <div
                          key={result.id}
                          className="group rounded-2xl border border-neutral-900 bg-black/35 p-3 transition duration-200 hover:border-white hover:bg-white hover:text-black hover:shadow-[0_12px_34px_rgba(255,255,255,0.10)]"
                        >
                          <div className="flex items-start gap-3">
                            <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-500 transition group-hover:border-black/10 group-hover:bg-black/5 group-hover:text-black">
                              <Icon size={15} />
                            </span>

                            <div className="min-w-0 flex-1">
                              <div className="flex min-w-0 items-center gap-2">
                                <p className="truncate text-sm font-semibold text-white transition group-hover:text-black">
                                  {result.title}
                                </p>

                                <span className="shrink-0 rounded-full border border-neutral-900 bg-neutral-950 px-1.5 py-0.5 text-[9px] text-neutral-600 transition group-hover:border-black/10 group-hover:bg-black/5 group-hover:text-black/55">
                                  {getResultKind(result)}
                                </span>
                              </div>

                              <p className="mt-0.5 truncate text-[11px] text-neutral-600 transition group-hover:text-black/55">
                                {result.subtitle}
                              </p>

                              {result.snippet && (
                                <p className="mt-2 line-clamp-2 text-xs leading-5 text-neutral-500 transition group-hover:text-black/60">
                                  {result.snippet}
                                </p>
                              )}
                            </div>

                            <button
                              type="button"
                              onClick={() => handleCopyWorkspaceResult(result)}
                              className="cf-invert-action inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs"
                            >
                              {isCopied ? <Check size={13} /> : <Copy size={13} />}
                              {isCopied ? "Copied" : "Path"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {backendTaskPackResults.length > 0 && (
                <section>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                      Deep Task Pack matches
                    </p>

                    <span className="text-xs text-neutral-700">
                      {backendTaskPackResults.length}
                    </span>
                  </div>

                  <div className="grid gap-2 md:grid-cols-2">
                    {backendTaskPackResults.map((result) => {
                      const matchingTaskPack = taskPacks.find(
                        (taskPack) => taskPack.id === result.taskPackId
                      );

                      return (
                        <button
                          key={result.id}
                          type="button"
                          onClick={() => {
                            if (matchingTaskPack) {
                              onClose();
                              onOpenTaskPack(matchingTaskPack);
                            }
                          }}
                          className="group flex h-[68px] min-w-0 items-center gap-3 overflow-hidden rounded-2xl border border-neutral-900 bg-black/35 px-3 text-left text-neutral-400 transition duration-200 hover:border-white hover:bg-white hover:text-black hover:shadow-[0_12px_34px_rgba(255,255,255,0.10)]"
                        >
                          <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-500 transition group-hover:border-black/10 group-hover:bg-black/5 group-hover:text-black">
                            <FileText size={15} />
                          </span>

                          <span className="min-w-0 flex-1 overflow-hidden">
                            <span className="block max-w-full truncate text-sm font-semibold leading-5 text-white transition group-hover:text-black">
                              {result.title}
                            </span>

                            <span className="mt-0.5 block max-w-full truncate text-[11px] leading-4 text-neutral-600 transition group-hover:text-black/55">
                              {result.subtitle}
                            </span>
                          </span>

                          <ArrowRight
                            size={13}
                            className="shrink-0 text-neutral-700 transition group-hover:translate-x-0.5 group-hover:text-black/45"
                          />
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>

        <div className="mt-4 shrink-0 border-t border-neutral-900 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            {enabledShortcuts.map((shortcut) => (
              <span
                key={shortcut.id}
                className={[
                  "inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px]",
                  shortcut.enabled
                    ? "border-neutral-800 bg-neutral-950 text-neutral-400"
                    : "border-neutral-900 bg-black/30 text-neutral-700"
                ].join(" ")}
              >
                <span>{shortcut.displayKeys}</span>
                <span className="text-neutral-700">·</span>
                <span>{shortcut.label}</span>
                {shortcut.placeholder && (
                  <span className="text-neutral-700">soon</span>
                )}
              </span>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}