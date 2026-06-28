import { useMemo, useState } from "react";
import {
    ArrowRight,
    FileText,
    FolderOpen,
    Search,
    Settings,
    WandSparkles
} from "lucide-react";

import { Modal } from "../ui/Modal";
import {
    navigationSections,
    type AppPageId
} from "../layout/Sidebar";

interface NavigationAssistantModalProps {
    activePage: AppPageId;
    onNavigate: (page: AppPageId) => void;
    onClose: () => void;
    onAddProject?: () => void;
}

function getStatusLabel(status?: string) {
    if (status === "alpha") return "Alpha";
    if (status === "soon") return "Soon";
    if (status === "planned") return "Planned";

    return "Ready";
}

export function NavigationAssistantModal({
    activePage,
    onNavigate,
    onClose,
    onAddProject
}: NavigationAssistantModalProps) {
    const [query, setQuery] = useState("");

    const visibleSections = useMemo(() => {
        const normalizedQuery = query.trim().toLowerCase();

        if (!normalizedQuery) {
            return navigationSections;
        }

        return navigationSections
            .map((section) => ({
                ...section,
                items: section.items.filter((item) => {
                    const text = `${item.label} ${item.description} ${item.status ?? ""}`.toLowerCase();
                    return text.includes(normalizedQuery);
                })
            }))
            .filter((section) => section.items.length > 0);
    }, [query]);

    function handleNavigate(page: AppPageId) {
        onNavigate(page);
        onClose();
    }

    function handleAddProject() {
        onAddProject?.();
        onClose();
    }

    return (
        <Modal
            title="Navigation Assistant"
            eyebrow="ContextForge command map"
            maxWidth="max-w-[880px]"
            scrollable={false}
            onClose={onClose}
        >
            <div className="p-5">
                <div className="relative mb-4">
                    <Search
                        size={15}
                        className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-600"
                    />

                    <input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Search pages, modules, reports, integrations..."
                        className="h-10 w-full rounded-2xl border border-neutral-900 bg-black/45 pl-10 pr-4 text-sm text-white outline-none transition placeholder:text-neutral-700 hover:border-neutral-800 focus:border-white/40 focus:bg-black/70 focus:ring-4 focus:ring-white/5"
                    />
                </div>

                <section className="mb-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                        <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                            Quick actions
                        </p>

                        <p className="text-[11px] text-neutral-700">
                            Fast jumps and common workflow actions
                        </p>
                    </div>

                    <div className="grid gap-2 md:grid-cols-4">
                        {onAddProject && (
                            <button
                                type="button"
                                onClick={handleAddProject}
                                className="cf-invert-action group flex h-9 items-center gap-2 rounded-xl px-3 text-left text-sm"
                            >
                                <FolderOpen size={14} className="text-neutral-600 transition group-hover:text-black" />
                                Add project
                            </button>
                        )}

                        <button
                            type="button"
                            onClick={() => handleNavigate("taskPacks")}
                            className="cf-invert-action group flex h-9 items-center gap-2 rounded-xl px-3 text-left text-sm"
                        >
                            <FileText size={14} className="text-neutral-600 transition group-hover:text-black" />
                            Task Packs
                        </button>

                        <button
                            type="button"
                            onClick={() => handleNavigate("context")}
                            className="cf-invert-action group flex h-9 items-center gap-2 rounded-xl px-3 text-left text-sm"
                        >
                            <WandSparkles size={14} className="text-neutral-600 transition group-hover:text-black" />
                            Context Builder
                        </button>

                        <button
                            type="button"
                            onClick={() => handleNavigate("settings")}
                            className="cf-invert-action group flex h-9 items-center gap-2 rounded-xl px-3 text-left text-sm"
                        >
                            <Settings size={14} className="text-neutral-600 transition group-hover:text-black" />
                            Settings
                        </button>
                    </div>
                </section>

                <div className="grid gap-4 lg:grid-cols-3">
                    {visibleSections.map((section) => (
                        <section key={section.title} className="min-w-0">
                            <p className="cf-tech-label mb-2 text-[10px] uppercase text-neutral-600">
                                {section.title}
                            </p>

                            <div className="space-y-2">
                                {section.items.map((item) => {
                                    const Icon = item.icon;
                                    const isActive = item.id === activePage;

                                    return (
                                        <button
                                            key={item.id}
                                            type="button"
                                            onClick={() => handleNavigate(item.id)}
                                            className={[
                                                "group flex h-[54px] w-full items-center gap-3 rounded-2xl border px-3 text-left transition duration-200",
                                                isActive
                                                    ? "border-white bg-white text-black shadow-[0_12px_34px_rgba(255,255,255,0.10)]"
                                                    : "border-neutral-900 bg-black/35 text-neutral-400 hover:border-white hover:bg-white hover:text-black hover:shadow-[0_12px_34px_rgba(255,255,255,0.10)]"
                                            ].join(" ")}
                                        >
                                            <span
                                                className={[
                                                    "grid size-8 shrink-0 place-items-center rounded-xl border transition",
                                                    isActive
                                                        ? "border-black/10 bg-black/5 text-black"
                                                        : "border-neutral-800 bg-neutral-950 text-neutral-500 group-hover:border-black/10 group-hover:bg-black/5 group-hover:text-black"
                                                ].join(" ")}
                                            >
                                                <Icon size={14} />
                                            </span>

                                            <span className="min-w-0 flex-1">
                                                <span className="flex min-w-0 items-center gap-2">
                                                    <span
                                                        className={[
                                                            "truncate text-sm font-semibold transition",
                                                            isActive ? "text-black" : "text-white group-hover:text-black"
                                                        ].join(" ")}
                                                    >
                                                        {item.label}
                                                    </span>

                                                    <span
                                                        className={[
                                                            "shrink-0 rounded-full px-1.5 py-0.5 text-[9px]",
                                                            isActive
                                                                ? "bg-black/10 text-black/55"
                                                                : "border border-neutral-900 bg-neutral-950 text-neutral-600 group-hover:border-black/10 group-hover:bg-black/5 group-hover:text-black/55"
                                                        ].join(" ")}
                                                    >
                                                        {getStatusLabel(item.status)}
                                                    </span>
                                                </span>

                                                <span
                                                    className={[
                                                        "mt-0.5 block truncate text-[11px] transition",
                                                        isActive ? "text-black/55" : "text-neutral-600 group-hover:text-black/55"
                                                    ].join(" ")}
                                                >
                                                    {item.description}
                                                </span>
                                            </span>

                                            <ArrowRight
                                                size={13}
                                                className={[
                                                    "shrink-0 transition",
                                                    isActive
                                                        ? "text-black/45"
                                                        : "text-neutral-700 group-hover:translate-x-0.5 group-hover:text-black/45"
                                                ].join(" ")}
                                            />
                                        </button>
                                    );
                                })}
                            </div>
                        </section>
                    ))}
                </div>

                {visibleSections.length === 0 && (
                    <div className="rounded-2xl border border-neutral-900 bg-black/35 p-6 text-center">
                        <p className="text-sm font-medium text-white">Nothing found</p>
                        <p className="mt-2 text-sm text-neutral-500">
                            Try another page name, module, or workflow keyword.
                        </p>
                    </div>
                )}

                <div className="mt-4 flex items-center justify-between border-t border-neutral-900 pt-3">
                    <p className="text-xs text-neutral-700">
                        Search and jump between current and future modules.
                    </p>

                    <span className="rounded-full border border-neutral-900 bg-neutral-950 px-2.5 py-1 text-[11px] text-neutral-600">
                        Esc closes
                    </span>
                </div>
            </div>
        </Modal>
    );
}