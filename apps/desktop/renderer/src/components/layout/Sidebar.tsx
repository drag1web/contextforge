import { BrainCircuit } from "lucide-react";
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
    <aside className="flex w-64 flex-col border-r border-neutral-900 bg-black p-5">
      <div className="mb-9 flex items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-950 text-white">
          <BrainCircuit size={19} />
        </div>

        <div>
          <h1 className="text-sm font-semibold tracking-tight text-white">
            {appMeta.name}
          </h1>
          <p className="text-xs text-neutral-500">{appMeta.subtitle}</p>
        </div>
      </div>

      <nav className="space-y-1 text-sm">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={[
              "w-full rounded-lg px-3 py-2 text-left transition",
              activePage === item.id
                ? "bg-neutral-900 text-white"
                : "text-neutral-400 hover:bg-neutral-950 hover:text-white"
            ].join(" ")}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="mt-auto rounded-2xl border border-neutral-900 bg-neutral-950/60 p-4">
        <p className="mb-2 text-[10px] uppercase tracking-[0.22em] text-neutral-600">
          MVP Status
        </p>
        <p className="text-sm text-neutral-300">
          {appMeta.phase} — {appMeta.phaseTitle}
        </p>

        <p className="mt-2 text-xs text-neutral-600">
          v{appMeta.version}
        </p>
      </div>
    </aside>
  );
}