import { appMeta } from "../../config/appMeta";

export type AppPageId = "dashboard" | "projects" | "context" | "taskPacks" | "settings";

interface SidebarProps {
  activePage: AppPageId;
  onNavigate: (page: AppPageId) => void;
}

const navItems: {
  id: AppPageId;
  label: string;
}[] = [
    { id: "dashboard", label: "Dashboard" },
    { id: "projects", label: "Projects" },
    { id: "context", label: "Context Builder" },
    { id: "taskPacks", label: "Task Packs" },
    { id: "settings", label: "Settings" }
  ];

export function Sidebar({ activePage, onNavigate }: SidebarProps) {
  return (
    <aside className="flex h-full min-h-0 w-64 shrink-0 flex-col border-r border-neutral-900 bg-black px-5 pb-5 pt-6">
      <nav className="space-y-1 text-sm">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={[
              "w-full rounded-xl px-3.5 py-2.5 text-left transition",
              activePage === item.id
                ? "bg-white text-black shadow-[0_10px_30px_rgba(255,255,255,0.08)]"
                : "text-neutral-400 hover:bg-neutral-950 hover:text-white"
            ].join(" ")}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="mt-auto rounded-2xl border border-neutral-900 bg-neutral-950/60 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
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