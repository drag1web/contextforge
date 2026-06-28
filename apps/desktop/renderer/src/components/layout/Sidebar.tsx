import { motion } from "framer-motion";
import {
  BarChart3,
  Bot,
  FileText,
  FolderKanban,
  LayoutDashboard,
  Layers3,
  PlugZap,
  Settings,
  WandSparkles,
  type LucideIcon
} from "lucide-react";

import { appMeta } from "../../config/appMeta";

export type AppPageId =
  | "dashboard"
  | "projects"
  | "context"
  | "taskPacks"
  | "agents"
  | "templates"
  | "integrations"
  | "reports"
  | "settings";

export interface NavigationItem {
  id: AppPageId;
  label: string;
  description: string;
  icon: LucideIcon;
  status?: "alpha" | "soon" | "planned";
}

export interface NavigationSection {
  title: string;
  items: NavigationItem[];
}

export const navigationSections: NavigationSection[] = [
  {
    title: "Core",
    items: [
      {
        id: "dashboard",
        label: "Dashboard",
        description: "Welcome screen, product workflow and quick start actions.",
        icon: LayoutDashboard,
        status: "alpha"
      },
      {
        id: "projects",
        label: "Projects",
        description: "Scanned local repositories, stack signals, readiness reports.",
        icon: FolderKanban,
        status: "alpha"
      },
      {
        id: "context",
        label: "Context Builder",
        description: "Generate AGENTS.md-style project context and AI instructions.",
        icon: WandSparkles,
        status: "alpha"
      },
      {
        id: "taskPacks",
        label: "Task Packs",
        description: "Searchable archive of generated prompts for coding agents.",
        icon: FileText,
        status: "alpha"
      }
    ]
  },
  {
    title: "AI Workflow",
    items: [
      {
        id: "agents",
        label: "Agents",
        description: "Future profiles for Claude, Codex, Cursor, Ollama and custom tools.",
        icon: Bot,
        status: "soon"
      },
      {
        id: "templates",
        label: "Templates",
        description: "Reusable task, prompt and project-context templates.",
        icon: Layers3,
        status: "planned"
      },
      {
        id: "integrations",
        label: "Integrations",
        description: "Future MCP, CLI, export and external agent connections.",
        icon: PlugZap,
        status: "planned"
      },
      {
        id: "reports",
        label: "Reports",
        description: "Quality analytics for readiness, Task Packs and project history.",
        icon: BarChart3,
        status: "alpha"
      }
    ]
  },
  {
    title: "System",
    items: [
      {
        id: "settings",
        label: "Settings",
        description: "Ollama URL, generation mode, defaults and application preferences.",
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

interface SidebarProps {
  activePage: AppPageId;
  onNavigate: (page: AppPageId) => void;
}

function getStatusLabel(status?: NavigationItem["status"]) {
  if (status === "alpha") {
    return "Alpha";
  }

  if (status === "soon") {
    return "Soon";
  }

  if (status === "planned") {
    return "Planned";
  }

  return null;
}

export function Sidebar({ activePage, onNavigate }: SidebarProps) {
  return (
    <aside className="flex h-full min-h-0 w-64 shrink-0 flex-col border-r border-neutral-900 bg-black px-4 pb-5 pt-5">
      <nav className="min-h-0 flex-1 space-y-5 overflow-auto pr-1 text-sm">
        {navigationSections.map((section) => (
          <section key={section.title}>
            <p className="cf-tech-label mb-2 px-2 text-[10px] uppercase text-neutral-700">
              {section.title}
            </p>

            <div className="space-y-1">
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive = activePage === item.id;
                const statusLabel = getStatusLabel(item.status);

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onNavigate(item.id)}
                    className={[
                      "group relative flex w-full items-center gap-3 overflow-hidden rounded-2xl px-3 py-2.5 text-left transition duration-200",
                      isActive
                        ? "text-black"
                        : "text-neutral-500 hover:text-black"
                    ].join(" ")}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="sidebar-active-page"
                        className="absolute inset-0 rounded-2xl bg-white shadow-[0_16px_42px_rgba(255,255,255,0.10)]"
                        transition={{
                          type: "spring",
                          stiffness: 420,
                          damping: 34
                        }}
                      />
                    )}

                    {!isActive && (
                      <span className="absolute inset-0 rounded-2xl bg-white opacity-0 transition duration-200 group-hover:opacity-100" />
                    )}

                    <span
                      className={[
                        "relative z-10 grid size-8 shrink-0 place-items-center rounded-xl border transition",
                        isActive
                          ? "border-black/10 bg-black/5 text-black"
                          : "border-neutral-900 bg-neutral-950/70 text-neutral-500 group-hover:border-black/10 group-hover:bg-black/5 group-hover:text-black"
                      ].join(" ")}
                    >
                      <Icon size={15} />
                    </span>

                    <span className="relative z-10 min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {item.label}
                      </span>

                      <span
                        className={[
                          "mt-0.5 block truncate text-[11px]",
                          isActive ? "text-black/55" : "text-neutral-700 group-hover:text-black/55"
                        ].join(" ")}
                      >
                        {item.status === "alpha" ? "Ready module" : "Future module"}
                      </span>
                    </span>

                    {statusLabel && item.status !== "alpha" && (
                      <span
                        className={[
                          "relative z-10 shrink-0 rounded-full px-2 py-0.5 text-[10px]",
                          isActive
                            ? "bg-black/10 text-black/60"
                            : "border border-neutral-900 bg-neutral-950 text-neutral-600 group-hover:border-black/10 group-hover:bg-black/5 group-hover:text-black/55"
                        ].join(" ")}
                      >
                        {statusLabel}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </nav>

      <div className="mt-5 rounded-2xl border border-neutral-900 bg-neutral-950/60 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
        <p className="cf-tech-label mb-2 text-[10px] uppercase text-neutral-600">
          MVP Status
        </p>

        <p className="text-sm leading-5 text-neutral-300">
          {appMeta.phase} — {appMeta.phaseTitle}
        </p>

        <p className="cf-tech-label mt-2 text-xs text-neutral-600">
          v{appMeta.version}
        </p>
      </div>
    </aside>
  );
}