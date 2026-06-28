import { useState } from "react";
import {
    BrainCircuit,
    ChevronDown,
    ChevronRight,
    FolderOpen,
    Maximize2,
    Minus,
    X
} from "lucide-react";

import { appMeta } from "../../config/appMeta";
import { NavigationAssistantModal } from "../modals/NavigationAssistantModal";
import {
    pageMetaMap,
    type AppPageId
} from "./Sidebar";

interface AppTitleBarProps {
    activePage?: AppPageId;
    isLoading?: boolean;
    onAddProject?: () => void;
    onNavigate?: (page: AppPageId) => void;
}

function minimizeWindow() {
    window.contextforge?.windowControls?.minimize();
}

function toggleMaximizeWindow() {
    window.contextforge?.windowControls?.toggleMaximize();
}

function closeWindow() {
    window.contextforge?.windowControls?.close();
}

export function AppTitleBar({
    activePage = "dashboard",
    isLoading = false,
    onAddProject,
    onNavigate
}: AppTitleBarProps) {
    const [isNavigationOpen, setIsNavigationOpen] = useState(false);
    const currentPage = pageMetaMap[activePage] ?? pageMetaMap.dashboard;

    return (
        <>
            <header className="app-drag relative z-50 flex h-12 shrink-0 items-center justify-between border-b border-neutral-900/90 bg-black/85 px-3 shadow-[0_1px_0_rgba(255,255,255,0.03)] backdrop-blur-2xl">
                <div className="flex min-w-0 items-center gap-3">
                    <div className="flex size-8 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-950 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                        <BrainCircuit size={17} />
                    </div>

                    <div className="flex min-w-0 items-center gap-2">
                        <p className="cf-display-font truncate text-lg font-semibold text-white">
                            {appMeta.name}
                        </p>

                        <span className="cf-tech-label rounded-full border border-neutral-800 bg-neutral-950 px-2 py-0.5 text-[11px] text-neutral-500">
                            v{appMeta.version}
                        </span>
                    </div>
                </div>

                <button
                    type="button"
                    onClick={() => setIsNavigationOpen(true)}
                    disabled={!onNavigate}
                    className="app-no-drag group absolute left-1/2 top-1/2 hidden h-7 -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.035] px-2.5 text-[11px] text-neutral-500 shadow-[0_0_20px_rgba(255,255,255,0.035),inset_0_1px_0_rgba(255,255,255,0.04)] transition duration-200 hover:border-white hover:bg-white hover:text-black hover:shadow-[0_12px_34px_rgba(255,255,255,0.12)] disabled:pointer-events-none disabled:opacity-60 lg:flex"
                    title="Open navigation assistant"
                >
                    <span className="transition group-hover:text-black/55">ContextForge</span>
                    <ChevronRight size={11} className="text-neutral-700 transition group-hover:text-black/40" />
                    <span className="font-medium text-neutral-200 transition group-hover:text-black">
                        {currentPage.label}
                    </span>
                    <ChevronDown size={11} className="text-neutral-700 transition group-hover:text-black/45" />
                </button>

                <div className="app-no-drag flex items-center gap-2">
                    {onAddProject && (
                        <button
                            type="button"
                            onClick={onAddProject}
                            disabled={isLoading}
                            className="mr-2 hidden h-8 items-center gap-2 rounded-full bg-white px-3.5 text-xs font-medium text-black shadow-[0_12px_32px_rgba(255,255,255,0.10)] transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-60 md:inline-flex"
                        >
                            <FolderOpen size={14} />
                            {isLoading ? "Scanning..." : "Add project"}
                        </button>
                    )}

                    <div className="mr-2 hidden items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-3 py-1 text-[11px] text-white shadow-[0_0_24px_rgba(255,255,255,0.08),inset_0_1px_0_rgba(255,255,255,0.06)] xl:flex">
                        <span className="size-1.5 rounded-full bg-white shadow-[0_0_12px_rgba(255,255,255,0.9)]" />
                        AI workflow ready
                    </div>

                    <button
                        type="button"
                        onClick={minimizeWindow}
                        className="grid size-8 place-items-center rounded-lg text-neutral-500 transition hover:bg-neutral-900 hover:text-white"
                        aria-label="Minimize window"
                    >
                        <Minus size={15} />
                    </button>

                    <button
                        type="button"
                        onClick={toggleMaximizeWindow}
                        className="grid size-8 place-items-center rounded-lg text-neutral-500 transition hover:bg-neutral-900 hover:text-white"
                        aria-label="Maximize window"
                    >
                        <Maximize2 size={14} />
                    </button>

                    <button
                        type="button"
                        onClick={closeWindow}
                        className="grid size-8 place-items-center rounded-lg text-neutral-500 transition hover:bg-red-500/15 hover:text-red-300"
                        aria-label="Close window"
                    >
                        <X size={15} />
                    </button>
                </div>
            </header>

            {isNavigationOpen && onNavigate && (
                <NavigationAssistantModal
                    activePage={activePage}
                    onNavigate={onNavigate}
                    onAddProject={onAddProject}
                    onClose={() => setIsNavigationOpen(false)}
                />
            )}
        </>
    );
}