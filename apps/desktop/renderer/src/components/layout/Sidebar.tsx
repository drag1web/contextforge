import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import {
  BarChart3,
  Bot,
  ChevronLeft,
  ChevronRight,
  FileText,
  FolderKanban,
  Github,
  LayoutDashboard,
  Layers3,
  PanelLeftClose,
  PanelLeftOpen,
  PlugZap,
  Search,
  Settings,
  WandSparkles,
  type LucideIcon
} from "lucide-react";

import { appMeta } from "../../config/appMeta";
import { SlidingSelectionIndicator } from "../ui/SlidingSelectionIndicator";

export type AppPageId =
  | "dashboard"
  | "projects"
  | "scanners"
  | "context"
  | "taskPacks"
  | "agents"
  | "templates"
  | "integrations"
  | "github"
  | "reports"
  | "settings";

export interface NavigationItem {
  id: AppPageId;
  label: string;
  labelKey: string;
  description: string;
  descriptionKey: string;
  icon: LucideIcon;
  status?: "alpha" | "soon" | "planned";
}

export interface NavigationSection {
  title: string;
  titleKey: string;
  items: NavigationItem[];
}

export const navigationSections: NavigationSection[] = [
  {
    title: "Core",
    titleKey: "nav.core",
    items: [
      {
        id: "dashboard",
        label: "Dashboard",
        labelKey: "nav.dashboard",
        description: "Welcome screen, product workflow and quick start actions.",
        descriptionKey: "nav.dashboardDesc",
        icon: LayoutDashboard,
        status: "alpha"
      },
      {
        id: "projects",
        label: "Projects",
        labelKey: "nav.projects",
        description: "Scanned local repositories, stack signals, readiness reports.",
        descriptionKey: "nav.projectsDesc",
        icon: FolderKanban,
        status: "alpha"
      },
      {
        id: "scanners",
        label: "Scanners",
        labelKey: "nav.scanners",
        description: "Detailed scanner evidence, commands, docs, tests, CI and structure signals.",
        descriptionKey: "nav.scannersDesc",
        icon: Search,
        status: "alpha"
      },
      {
        id: "context",
        label: "Context Builder",
        labelKey: "nav.context",
        description: "Generate AGENTS.md-style project context and AI instructions.",
        descriptionKey: "nav.contextDesc",
        icon: WandSparkles,
        status: "alpha"
      },
      {
        id: "taskPacks",
        label: "Task Packs",
        labelKey: "nav.taskPacks",
        description: "Searchable archive of generated prompts for coding agents.",
        descriptionKey: "nav.taskPacksDesc",
        icon: FileText,
        status: "alpha"
      }
    ]
  },
  {
    title: "AI Workflow",
    titleKey: "nav.aiWorkflow",
    items: [
      {
        id: "agents",
        label: "Agents",
        labelKey: "nav.agents",
        description: "Agent profiles for Codex, Cursor, Claude Code, Gemini and Generic Task Packs.",
        descriptionKey: "nav.agentsDesc",
        icon: Bot,
        status: "alpha"
      },
      {
        id: "templates",
        label: "Templates",
        labelKey: "nav.templates",
        description: "Reusable task, prompt and project-context templates.",
        descriptionKey: "nav.templatesDesc",
        icon: Layers3,
        status: "alpha"
      },
      {
        id: "integrations",
        label: "Integrations",
        labelKey: "nav.integrations",
        description: "AI providers, model endpoints, CLI exports and future connectors.",
        descriptionKey: "nav.integrationsDesc",
        icon: PlugZap,
        status: "alpha"
      },
      {
        id: "github",
        label: "GitHub",
        labelKey: "nav.github",
        description: "Browser pairing, repository linking and issue workflows.",
        descriptionKey: "nav.githubDesc",
        icon: Github,
        status: "alpha"
      },
      {
        id: "reports",
        label: "Reports",
        labelKey: "nav.reports",
        description: "Quality analytics for readiness, Task Packs and project history.",
        descriptionKey: "nav.reportsDesc",
        icon: BarChart3,
        status: "alpha"
      }
    ]
  },
  {
    title: "System",
    titleKey: "nav.system",
    items: [
      {
        id: "settings",
        label: "Settings",
        labelKey: "nav.settings",
        description: "Ollama URL, generation mode, defaults and application preferences.",
        descriptionKey: "nav.settingsDesc",
        icon: Settings,
        status: "alpha"
      }
    ]
  }
];

export const pageMetaMap = navigationSections
  .flatMap((section) => section.items)
  .reduce(
    (acc, item) => {
      acc[item.id] = item;
      return acc;
    },
    {} as Record<AppPageId, NavigationItem>
  );

const SIDEBAR_NAV_ITEM_HEIGHT = 52;
const SIDEBAR_NAV_ITEM_GAP = 4;

interface SidebarProps {
  activePage: AppPageId;
  showDescriptions?: boolean;
  onNavigate: (page: AppPageId) => void;
}

function getStatusLabel(
  status: NavigationItem["status"] | undefined,
  t: (key: string) => string
) {
  if (status === "alpha") {
    return t("common.alpha");
  }

  if (status === "soon") {
    return t("common.soon");
  }

  if (status === "planned") {
    return t("common.planned");
  }

  return null;
}

function getInitialCollapsedState() {
  if (typeof window === "undefined") {
    return false;
  }

  return window.localStorage.getItem("contextforge.sidebarCollapsed") === "true";
}

export function Sidebar({
  activePage,
  showDescriptions = false,
  onNavigate
}: SidebarProps) {
  const { t } = useTranslation();
  const [isCollapsed, setIsCollapsed] = useState(getInitialCollapsedState);

  useEffect(() => {
    window.localStorage.setItem(
      "contextforge.sidebarCollapsed",
      String(isCollapsed)
    );
  }, [isCollapsed]);

  return (
    <motion.aside
      animate={{ width: isCollapsed ? 76 : 256 }}
      transition={{
        duration: 0.18,
        ease: [0.16, 1, 0.3, 1]
      }}
      className="flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-r border-white/[0.075] bg-black pb-5 pt-5"
    >
      <div
        className={[
          "mb-4 flex shrink-0 items-center gap-2 px-4",
          isCollapsed ? "justify-center" : "justify-between"
        ].join(" ")}
      >
        {!isCollapsed && (
          <div className="min-w-0">
            <p className="cf-tech-label text-[10px] uppercase text-neutral-700">
              {t("nav.navigation")}
            </p>

            <p className="mt-1 truncate text-sm font-medium text-white">
              {t("nav.workspace")}
            </p>
          </div>
        )}

        <button
          type="button"
          onClick={() => setIsCollapsed((current) => !current)}
          className="cf-pressable group grid size-9 shrink-0 place-items-center rounded-2xl border border-white/[0.075] bg-neutral-950 text-neutral-500 transition hover:border-white hover:bg-white hover:text-black"
          title={isCollapsed ? t("nav.expandSidebar") : t("nav.collapseSidebar")}
          aria-label={isCollapsed ? t("nav.expandSidebar") : t("nav.collapseSidebar")}
        >
          {isCollapsed ? (
            <PanelLeftOpen size={15} />
          ) : (
            <PanelLeftClose size={15} />
          )}
        </button>
      </div>

      <nav
        className={[
          "min-h-0 flex-1 overflow-auto text-sm",
          isCollapsed ? "space-y-4 px-3" : "space-y-5 px-4 pr-3"
        ].join(" ")}
      >
        {navigationSections.map((section) => (
          <section key={section.title}>
            {isCollapsed ? (
              <div className="mb-2 h-px bg-neutral-900" />
            ) : (
              <p className="cf-tech-label mb-2 px-2 text-[10px] uppercase text-neutral-700">
                {t(section.titleKey)}
              </p>
            )}

            <div
              className="relative grid gap-1 overflow-hidden"
              style={{
                height:
                  section.items.length * SIDEBAR_NAV_ITEM_HEIGHT +
                  (section.items.length - 1) * SIDEBAR_NAV_ITEM_GAP
              }}
            >
              <SlidingSelectionIndicator
                activeIndex={section.items.findIndex((item) => item.id === activePage)}
                itemHeight={SIDEBAR_NAV_ITEM_HEIGHT}
                itemGap={SIDEBAR_NAV_ITEM_GAP}
                className="sidebar-nav-active-pill"
              />

              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive = activePage === item.id;
                const statusLabel = getStatusLabel(item.status, t);
                const itemLabel = t(item.labelKey);

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onNavigate(item.id)}
                    title={isCollapsed ? itemLabel : undefined}
                    className={[
                      "cf-pressable group relative z-10 flex w-full items-center overflow-hidden rounded-2xl text-left transition-colors duration-150",
                      isCollapsed ? "justify-center px-0" : "gap-3 px-3",
                      isActive
                        ? "text-black"
                        : "text-neutral-500 hover:text-white"
                    ].join(" ")}
                    style={{ height: SIDEBAR_NAV_ITEM_HEIGHT }}
                  >
                    <span
                      className={[
                        "relative z-10 grid size-8 shrink-0 place-items-center rounded-xl border transition",
                        isActive
                          ? "border-black/10 bg-black/5 text-black"
                          : "border-neutral-900 bg-neutral-950/70 text-neutral-500 group-hover:border-white/15 group-hover:bg-neutral-950 group-hover:text-white"
                      ].join(" ")}
                    >
                      <Icon size={15} />
                    </span>

                    {!isCollapsed && (
                      <>
                        <span className="relative z-10 min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {itemLabel}
                          </span>

                          {showDescriptions && (
                            <span
                              className={[
                                "mt-0.5 block truncate text-[11px]",
                                isActive
                                  ? "text-black/55"
                                  : "text-neutral-700 group-hover:text-neutral-400"
                              ].join(" ")}
                            >
                              {item.status === "alpha"
                                ? t("common.readyModule")
                                : t("common.futureModule")}
                            </span>
                          )}
                        </span>

                        {statusLabel && item.status !== "alpha" && (
                          <span
                            className={[
                              "relative z-10 shrink-0 rounded-full px-2 py-0.5 text-[10px]",
                              isActive
                                ? "bg-black/10 text-black/60"
                                : "border border-neutral-900 bg-neutral-950 text-neutral-600 group-hover:border-white/15 group-hover:text-neutral-300"
                            ].join(" ")}
                          >
                            {statusLabel}
                          </span>
                        )}
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </nav>

      <div className={isCollapsed ? "mt-5 px-3" : "mt-5 px-4"}>
        {isCollapsed ? (
          <div
            className="grid size-10 place-items-center rounded-2xl border border-white/[0.075] bg-neutral-950/60 text-neutral-500"
            title={`${appMeta.phase} — v${appMeta.version}`}
          >
            <ChevronRight size={15} />
          </div>
        ) : (
          <div className="rounded-2xl border border-white/[0.075] bg-neutral-950/60 p-4 shadow-[0_10px_26px_rgba(0,0,0,0.28)]">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                {t("nav.mvpStatus")}
              </p>

              <ChevronLeft size={13} className="text-neutral-700" />
            </div>

            <p className="text-sm leading-5 text-neutral-300">
              {appMeta.phase} — {appMeta.phaseTitle}
            </p>

            <p className="cf-tech-label mt-2 text-xs text-neutral-600">
              v{appMeta.version}
            </p>
          </div>
        )}
      </div>
    </motion.aside>
  );
}
