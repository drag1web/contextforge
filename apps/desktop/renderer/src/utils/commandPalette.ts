import type { ShortcutActionId } from "../config/keyboardShortcuts";
import type { Project, TaskPack } from "../types";
import type { TaskPackFreshness } from "./taskPackFreshness";
import {
  navigationSections,
  type AppPageId,
} from "../components/layout/Sidebar";

export type CommandPaletteCategory =
  | "project"
  | "task_pack"
  | "workspace"
  | "navigation";

export type CommandPaletteIcon =
  | "add"
  | "archive"
  | "arrow-left"
  | "arrow-right"
  | "focus"
  | "page"
  | "project"
  | "rescan"
  | "search"
  | "settings"
  | "task-pack"
  | "zoom-in"
  | "zoom-out"
  | "zoom-reset";

export interface CommandPaletteCommand {
  id: string;
  label: string;
  description: string;
  category: CommandPaletteCategory;
  keywords: string[];
  icon: CommandPaletteIcon;
  shortcutId?: ShortcutActionId;
  enabled: boolean;
  disabledReason?: string;
  contextual: boolean;
  showWhenEmpty: boolean;
  priority: number;
  execute: () => void;
}

export interface CommandPaletteBuilderInput {
  activePage: AppPageId;
  projects: readonly Project[];
  taskPacks: readonly TaskPack[];
  currentProject: Project | null;
  taskPackFreshnessById: ReadonlyMap<number, TaskPackFreshness>;
  canGoBack: boolean;
  canGoForward: boolean;
  isWorkspaceBusy: boolean;
  isFocusModeAvailable: boolean;
  isFocusModeActive: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
  onNavigate: (page: AppPageId) => void;
  onOpenProject: (projectId: number) => void;
  onAddProject: () => void;
  onRescanProject: (project: Project) => void;
  onCreateTaskPack: (project: Project) => void;
  onOpenTaskPack: (taskPack: TaskPack) => void;
  onOpenGlobalSearch: () => void;
  onBack: () => void;
  onForward: () => void;
  onToggleFocusMode: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
}

interface RankedCommand {
  command: CommandPaletteCommand;
  matchRank: number;
  sourceIndex: number;
}

export const COMMAND_PALETTE_RESULT_LIMIT = 12;

export function normalizeCommandPaletteText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

function compareText(left: string, right: string) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function isSubsequence(needle: string, haystack: string) {
  if (!needle) return true;
  let cursor = 0;

  for (const character of haystack) {
    if (character === needle[cursor]) cursor += 1;
    if (cursor === needle.length) return true;
  }

  return false;
}

function commandMatchRank(command: CommandPaletteCommand, query: string) {
  const label = normalizeCommandPaletteText(command.label);
  const description = normalizeCommandPaletteText(command.description);
  const keywords = command.keywords.map(normalizeCommandPaletteText);
  const searchable = [label, description, ...keywords].join(" ");

  if (label === query) return 0;
  if (label.startsWith(query)) return 1;
  if (label.split(" ").some((word) => word.startsWith(query))) return 2;
  if (label.includes(query)) return 3;
  if (keywords.some((keyword) => keyword === query || keyword.startsWith(query))) {
    return 4;
  }
  if (searchable.includes(query)) return 5;

  const tokens = query.split(" ").filter(Boolean);
  if (tokens.length > 1 && tokens.every((token) => searchable.includes(token))) {
    return 6;
  }

  const compactQuery = query.replace(/\s+/gu, "");
  const compactSearchable = searchable.replace(/\s+/gu, "");
  return compactQuery.length >= 2 && isSubsequence(compactQuery, compactSearchable)
    ? 7
    : null;
}

export function filterCommandPaletteCommands(
  commands: readonly CommandPaletteCommand[],
  rawQuery: string,
  limit = COMMAND_PALETTE_RESULT_LIMIT,
) {
  const query = normalizeCommandPaletteText(rawQuery);

  const ranked = commands.flatMap<RankedCommand>((command, sourceIndex) => {
    if (!query) {
      return command.showWhenEmpty
        ? [{ command, matchRank: 0, sourceIndex }]
        : [];
    }

    const matchRank = commandMatchRank(command, query);
    return matchRank === null ? [] : [{ command, matchRank, sourceIndex }];
  });

  return ranked
    .sort((left, right) => {
      if (left.matchRank !== right.matchRank) {
        return left.matchRank - right.matchRank;
      }
      if (left.command.contextual !== right.command.contextual) {
        return left.command.contextual ? -1 : 1;
      }
      if (left.command.priority !== right.command.priority) {
        return left.command.priority - right.command.priority;
      }
      const labelOrder = compareText(left.command.label, right.command.label);
      return labelOrder !== 0 ? labelOrder : left.sourceIndex - right.sourceIndex;
    })
    .slice(0, Math.max(0, limit))
    .map(({ command }) => command);
}

export function hasDuplicateCommandIds(
  commands: readonly CommandPaletteCommand[],
) {
  const ids = new Set<string>();
  for (const command of commands) {
    if (ids.has(command.id)) return true;
    ids.add(command.id);
  }
  return false;
}

export function executeCommandPaletteCommand(command: CommandPaletteCommand) {
  if (!command.enabled) return false;
  command.execute();
  return true;
}

function parseTimestamp(value: string | null | undefined) {
  const timestamp = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function latestTaskPack(taskPacks: readonly TaskPack[]) {
  return [...taskPacks].sort((left, right) => {
    const timestampOrder = parseTimestamp(right.createdAt) - parseTimestamp(left.createdAt);
    return timestampOrder !== 0 ? timestampOrder : right.id - left.id;
  })[0] ?? null;
}

function pageIcon(page: AppPageId): CommandPaletteIcon {
  if (page === "settings") return "settings";
  if (page === "taskPacks") return "archive";
  if (page === "projects") return "project";
  return "page";
}

export function buildCommandPaletteCommands(
  input: CommandPaletteBuilderInput,
): CommandPaletteCommand[] {
  const commands: CommandPaletteCommand[] = [];
  const currentProject = input.currentProject;
  const currentProjectName = currentProject?.name ?? "";
  const latestPack = latestTaskPack(input.taskPacks);
  const freshnessAttentionCount = [...input.taskPackFreshnessById.values()].filter(
    (freshness) =>
      freshness.status === "affected" ||
      freshness.status === "review_recommended",
  ).length;

  commands.push(
    {
      id: "workspace.back",
      label: input.t("commandPalette.commands.back"),
      description: input.t("commandPalette.commands.backDescription"),
      category: "workspace",
      keywords: ["back", "previous", "назад", "предыдущая"],
      icon: "arrow-left",
      shortcutId: "navigationBack",
      enabled: input.canGoBack,
      disabledReason: input.canGoBack
        ? undefined
        : input.t("commandPalette.disabled.noBackHistory"),
      contextual: true,
      showWhenEmpty: true,
      priority: 30,
      execute: input.onBack,
    },
    {
      id: "workspace.forward",
      label: input.t("commandPalette.commands.forward"),
      description: input.t("commandPalette.commands.forwardDescription"),
      category: "workspace",
      keywords: ["forward", "next", "вперёд", "следующая"],
      icon: "arrow-right",
      shortcutId: "navigationForward",
      enabled: input.canGoForward,
      disabledReason: input.canGoForward
        ? undefined
        : input.t("commandPalette.disabled.noForwardHistory"),
      contextual: true,
      showWhenEmpty: true,
      priority: 31,
      execute: input.onForward,
    },
    {
      id: "workspace.global-search",
      label: input.t("commandPalette.commands.globalSearch"),
      description: input.t("commandPalette.commands.globalSearchDescription"),
      category: "workspace",
      keywords: ["search", "files", "code", "поиск", "файлы", "код"],
      icon: "search",
      shortcutId: "globalSearch",
      enabled: true,
      contextual: false,
      showWhenEmpty: true,
      priority: 35,
      execute: input.onOpenGlobalSearch,
    },
    {
      id: "workspace.zoom-in",
      label: input.t("commandPalette.commands.zoomIn"),
      description: input.t("commandPalette.commands.zoomInDescription"),
      category: "workspace",
      keywords: ["zoom", "scale", "increase", "масштаб", "увеличить"],
      icon: "zoom-in",
      shortcutId: "zoomIn",
      enabled: true,
      contextual: false,
      showWhenEmpty: false,
      priority: 70,
      execute: input.onZoomIn,
    },
    {
      id: "workspace.zoom-out",
      label: input.t("commandPalette.commands.zoomOut"),
      description: input.t("commandPalette.commands.zoomOutDescription"),
      category: "workspace",
      keywords: ["zoom", "scale", "decrease", "масштаб", "уменьшить"],
      icon: "zoom-out",
      shortcutId: "zoomOut",
      enabled: true,
      contextual: false,
      showWhenEmpty: false,
      priority: 71,
      execute: input.onZoomOut,
    },
    {
      id: "workspace.zoom-reset",
      label: input.t("commandPalette.commands.zoomReset"),
      description: input.t("commandPalette.commands.zoomResetDescription"),
      category: "workspace",
      keywords: ["zoom", "scale", "100", "reset", "масштаб", "сбросить"],
      icon: "zoom-reset",
      shortcutId: "zoomReset",
      enabled: true,
      contextual: false,
      showWhenEmpty: false,
      priority: 72,
      execute: input.onZoomReset,
    },
  );

  if (input.isFocusModeAvailable) {
    commands.push({
      id: "workspace.focus-mode",
      label: input.t(
        input.isFocusModeActive
          ? "commandPalette.commands.exitFocusMode"
          : "commandPalette.commands.enterFocusMode",
      ),
      description: input.t("commandPalette.commands.focusModeDescription"),
      category: "workspace",
      keywords: ["focus", "mode", "фокус", "режим"],
      icon: "focus",
      shortcutId: "toggleFocusMode",
      enabled: true,
      contextual: true,
      showWhenEmpty: true,
      priority: 12,
      execute: input.onToggleFocusMode,
    });
  }

  commands.push({
    id: "project.add",
    label: input.t("commandPalette.commands.addProject"),
    description: input.t("commandPalette.commands.addProjectDescription"),
    category: "project",
    keywords: ["add", "project", "folder", "добавить", "проект", "папка"],
    icon: "add",
    shortcutId: "addProject",
    enabled: !input.isWorkspaceBusy,
    disabledReason: input.isWorkspaceBusy
      ? input.t("commandPalette.disabled.workspaceBusy")
      : undefined,
    contextual: false,
    showWhenEmpty: input.projects.length === 0,
    priority: 20,
    execute: input.onAddProject,
  });

  for (const project of input.projects) {
    const isCurrent = project.id === currentProject?.id;
    commands.push({
      id: `project.open.${project.id}`,
      label: input.t("commandPalette.commands.openProject", {
        name: project.name,
      }),
      description: input.t("commandPalette.commands.openProjectDescription", {
        readiness: project.readinessScore,
      }),
      category: "project",
      keywords: [
        project.name,
        project.packageManager ?? "",
        project.detectedStack.join(" "),
        "open switch project открыть переключить проект",
      ],
      icon: "project",
      enabled: true,
      contextual: isCurrent,
      showWhenEmpty: isCurrent,
      priority: isCurrent ? 5 : 80,
      execute: () => input.onOpenProject(project.id),
    });
  }

  if (currentProject) {
    commands.push(
      {
        id: `project.rescan.${currentProject.id}`,
        label: input.t("commandPalette.commands.rescanProject", {
          name: currentProjectName,
        }),
        description: input.t("commandPalette.commands.rescanProjectDescription"),
        category: "project",
        keywords: [
          currentProjectName,
          "scan rescan refresh scanner сканировать пересканировать обновить",
        ],
        icon: "rescan",
        enabled: !input.isWorkspaceBusy,
        disabledReason: input.isWorkspaceBusy
          ? input.t("commandPalette.disabled.workspaceBusy")
          : undefined,
        contextual: true,
        showWhenEmpty: true,
        priority: 6,
        execute: () => input.onRescanProject(currentProject),
      },
      {
        id: `project.create-task-pack.${currentProject.id}`,
        label: input.t("commandPalette.commands.createTaskPack", {
          name: currentProjectName,
        }),
        description: input.t("commandPalette.commands.createTaskPackDescription"),
        category: "project",
        keywords: [
          currentProjectName,
          "task pack context create build контекст создать пакет задачи",
        ],
        icon: "task-pack",
        enabled: !input.isWorkspaceBusy,
        disabledReason: input.isWorkspaceBusy
          ? input.t("commandPalette.disabled.workspaceBusy")
          : undefined,
        contextual: true,
        showWhenEmpty: true,
        priority: 7,
        execute: () => input.onCreateTaskPack(currentProject),
      },
    );

    const awareness = currentProject.awareness;
    if (
      awareness?.previousObservedAt &&
      (awareness.status === "changed" ||
        awareness.status === "comparison_limited")
    ) {
      commands.push({
        id: `project.review-changes.${currentProject.id}`,
        label: input.t("commandPalette.commands.reviewProjectChanges", {
          name: currentProjectName,
        }),
        description: input.t(
          awareness.status === "comparison_limited"
            ? "commandPalette.commands.reviewProjectChangesLimitedDescription"
            : "commandPalette.commands.reviewProjectChangesDescription",
        ),
        category: "project",
        keywords: [
          currentProjectName,
          "what changed changes awareness review изменения проверить",
        ],
        icon: "project",
        enabled: true,
        contextual: true,
        showWhenEmpty: true,
        priority: 4,
        execute: () => input.onOpenProject(currentProject.id),
      });
    }
  }

  commands.push({
    id: "task-pack.archive",
    label: input.t("commandPalette.commands.openTaskPacks"),
    description: input.t("commandPalette.commands.openTaskPacksDescription"),
    category: "task_pack",
    keywords: ["task pack archive пакеты задач архив"],
    icon: "archive",
    shortcutId: "openTaskPacks",
    enabled: true,
    contextual: input.activePage === "taskPacks",
    showWhenEmpty: true,
    priority: 40,
    execute: () => input.onNavigate("taskPacks"),
  });

  commands.push({
    id: "task-pack.open-latest",
    label: input.t("commandPalette.commands.openLatestTaskPack"),
    description: latestPack
      ? input.t("commandPalette.commands.openLatestTaskPackDescription", {
          title: latestPack.title,
        })
      : input.t("commandPalette.disabled.noTaskPacks"),
    category: "task_pack",
    keywords: [
      latestPack?.title ?? "",
      latestPack?.projectName ?? "",
      "latest recent task pack последний недавний пакет задачи",
    ],
    icon: "task-pack",
    enabled: latestPack !== null,
    disabledReason: latestPack
      ? undefined
      : input.t("commandPalette.disabled.noTaskPacks"),
    contextual: Boolean(latestPack),
    showWhenEmpty: Boolean(latestPack),
    priority: 15,
    execute: () => {
      if (latestPack) input.onOpenTaskPack(latestPack);
    },
  });

  if (freshnessAttentionCount > 0) {
    commands.push({
      id: "task-pack.review-freshness",
      label: input.t("commandPalette.commands.reviewTaskPackFreshness", {
        count: freshnessAttentionCount,
      }),
      description: input.t(
        "commandPalette.commands.reviewTaskPackFreshnessDescription",
      ),
      category: "task_pack",
      keywords: [
        "task pack freshness affected review stale свежесть изменения проверить",
      ],
      icon: "archive",
      enabled: true,
      contextual: true,
      showWhenEmpty: true,
      priority: 3,
      execute: () => input.onNavigate("taskPacks"),
    });
  }

  for (const section of navigationSections) {
    for (const page of section.items) {
      if (page.id === "taskPacks") continue;

      commands.push({
        id: `navigation.${page.id}`,
        label: input.t("commandPalette.commands.openPage", {
          page: input.t(page.labelKey),
        }),
        description: input.t(page.descriptionKey),
        category: "navigation",
        keywords: [
          page.label,
          page.description,
          input.t(page.labelKey),
          input.t(section.titleKey),
          "navigate page перейти раздел",
        ],
        icon: pageIcon(page.id),
        shortcutId: page.id === "settings" ? "openSettings" : undefined,
        enabled: true,
        contextual: page.id === input.activePage,
        showWhenEmpty: ["dashboard", "projects", "settings"].includes(page.id),
        priority: page.id === input.activePage ? 45 : 55,
        execute: () => input.onNavigate(page.id),
      });
    }
  }

  return commands;
}
