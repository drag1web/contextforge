import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState
} from "react";
import { useTranslation } from "react-i18next";
import {
    ArrowLeft,
    ArrowRight,
    Check,
    ChevronDown,
    ChevronRight,
    CircleAlert,
    Copy,
    Cpu,
    FolderOpen,
    Info,
    Loader2,
    Maximize2,
    Minimize2,
    Minus,
    RefreshCw,
    Settings2,
    Sparkles,
    X
} from "lucide-react";

import {
    getAiIntegrationStatus,
    getAppSettings
} from "../../api/client";
import { appMeta } from "../../config/appMeta";
import type {
    AiProviderId,
    AiProviderStatus,
    AppSettings
} from "../../types";
import contextforgeMarkWhite from "../../assets/brand/contextforge-mark-white.png";
import {
    pageMetaMap,
    type AppPageId
} from "./Sidebar";

interface AppTitleBarProps {
    activePage?: AppPageId;
    isLoading?: boolean;
    canGoBack?: boolean;
    canGoForward?: boolean;
    onAddProject?: () => void;
    onNavigate?: (page: AppPageId) => void;
    onNavigateBack?: () => void;
    onNavigateForward?: () => void;
    onOpenNavigationAssistant?: () => void;
    isFocusModeAvailable?: boolean;
    isFocusModeActive?: boolean;
    onToggleFocusMode?: () => void;
}

type OpenTitlebarPanel = "version" | "ai" | null;
type AiCheckState = "checking" | "ready" | "error";
type AiStatusTone = "success" | "warning" | "danger" | "neutral";

const PROVIDER_LABELS: Record<AiProviderId, string> = {
    ollama: "Ollama",
    "openai-compatible": "OpenAI-compatible",
    anthropic: "Anthropic",
    gemini: "Gemini"
};

function minimizeWindow() {
    window.contextforge?.windowControls?.minimize();
}

function toggleMaximizeWindow() {
    window.contextforge?.windowControls?.toggleMaximize();
}

function closeWindow() {
    window.contextforge?.windowControls?.close();
}

function getConfiguredModel(settings: AppSettings | null) {
    if (!settings) return null;

    switch (settings.aiProvider) {
        case "openai-compatible":
            return settings.openAiCompatibleModel;
        case "anthropic":
            return settings.anthropicModel;
        case "gemini":
            return settings.geminiModel;
        case "ollama":
        default:
            return settings.defaultOllamaModel;
    }
}

function getToneClasses(tone: AiStatusTone) {
    if (tone === "success") {
        return {
            dot: "bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,0.58)]",
            icon: "text-emerald-300",
            value: "text-emerald-200"
        };
    }

    if (tone === "warning") {
        return {
            dot: "bg-amber-300 shadow-[0_0_10px_rgba(252,211,77,0.42)]",
            icon: "text-amber-300",
            value: "text-amber-200"
        };
    }

    if (tone === "danger") {
        return {
            dot: "bg-red-400 shadow-[0_0_10px_rgba(248,113,113,0.45)]",
            icon: "text-red-300",
            value: "text-red-200"
        };
    }

    return {
        dot: "bg-neutral-500",
        icon: "text-neutral-400",
        value: "text-neutral-300"
    };
}

export function AppTitleBar({
    activePage = "dashboard",
    isLoading = false,
    canGoBack = false,
    canGoForward = false,
    onAddProject,
    onNavigate,
    onNavigateBack,
    onNavigateForward,
    onOpenNavigationAssistant,
    isFocusModeAvailable = false,
    isFocusModeActive = false,
    onToggleFocusMode
}: AppTitleBarProps) {
    const { t, i18n } = useTranslation();
    const [openPanel, setOpenPanel] = useState<OpenTitlebarPanel>(null);
    const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
    const [aiStatus, setAiStatus] = useState<AiProviderStatus | null>(null);
    const [aiCheckState, setAiCheckState] = useState<AiCheckState>("checking");
    const [lastAiCheckAt, setLastAiCheckAt] = useState<Date | null>(null);
    const [isBuildInfoCopied, setIsBuildInfoCopied] = useState(false);
    const brandPanelRef = useRef<HTMLDivElement>(null);
    const aiPanelRef = useRef<HTMLDivElement>(null);
    const copiedResetTimerRef = useRef<number | null>(null);
    const currentPage = pageMetaMap[activePage] ?? pageMetaMap.dashboard;
    const currentPageLabel = t(currentPage.labelKey);
    const [versionNumber, versionChannel = "alpha"] = appMeta.version.split("-");

    const refreshAiWorkflow = useCallback(async () => {
        setAiCheckState("checking");

        const [settingsResult, statusResult] = await Promise.allSettled([
            getAppSettings(),
            getAiIntegrationStatus()
        ]);

        if (settingsResult.status === "fulfilled") {
            setAppSettings(settingsResult.value);
        }

        if (statusResult.status === "fulfilled") {
            setAiStatus(statusResult.value);
            setAiCheckState("ready");
        } else {
            setAiStatus(null);
            setAiCheckState("error");
        }

        setLastAiCheckAt(new Date());
    }, []);

    useEffect(() => {
        void refreshAiWorkflow();

        const handleSettingsUpdated = (event: Event) => {
            const customEvent = event as CustomEvent<AppSettings>;

            if (customEvent.detail) {
                setAppSettings(customEvent.detail);
            }

            void refreshAiWorkflow();
        };

        window.addEventListener("contextforge:settings-updated", handleSettingsUpdated);

        return () => {
            window.removeEventListener("contextforge:settings-updated", handleSettingsUpdated);
        };
    }, [refreshAiWorkflow]);

    useEffect(() => {
        if (isFocusModeActive) {
            setOpenPanel(null);
        }
    }, [isFocusModeActive]);

    useEffect(() => {
        if (!openPanel) return undefined;

        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target as Node;

            if (
                brandPanelRef.current?.contains(target) ||
                aiPanelRef.current?.contains(target)
            ) {
                return;
            }

            setOpenPanel(null);
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setOpenPanel(null);
            }
        };

        document.addEventListener("pointerdown", handlePointerDown);
        document.addEventListener("keydown", handleKeyDown);

        return () => {
            document.removeEventListener("pointerdown", handlePointerDown);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [openPanel]);

    useEffect(() => {
        return () => {
            if (copiedResetTimerRef.current !== null) {
                window.clearTimeout(copiedResetTimerRef.current);
            }
        };
    }, []);

    const configuredModel = getConfiguredModel(appSettings);
    const providerId = aiStatus?.provider ?? appSettings?.aiProvider ?? "ollama";
    const providerLabel = PROVIDER_LABELS[providerId];
    const displayedModel = aiStatus?.model ?? configuredModel;

    const aiDisplay = useMemo(() => {
        if (aiCheckState === "checking") {
            return {
                label: t("titlebar.aiChecking"),
                detail: t("titlebar.aiCheckingDescription"),
                tone: "neutral" as const,
                status: t("titlebar.aiStatusChecking")
            };
        }

        if (appSettings?.generationMode === "template") {
            return {
                label: t("titlebar.aiTemplateMode"),
                detail: t("titlebar.aiTemplateModeDescription"),
                tone: "neutral" as const,
                status: t("titlebar.aiStatusTemplate")
            };
        }

        if (aiCheckState === "error") {
            return {
                label: t("titlebar.aiUnavailable"),
                detail: t("titlebar.aiUnavailableDescription"),
                tone: "danger" as const,
                status: t("titlebar.aiStatusOffline")
            };
        }

        if (!displayedModel) {
            return {
                label: t("titlebar.aiNeedsSetup"),
                detail: t("titlebar.aiNeedsSetupDescription"),
                tone: "warning" as const,
                status: t("titlebar.aiStatusNotConfigured")
            };
        }

        if (aiStatus?.online) {
            return {
                label: t("titlebar.aiReady"),
                detail: t("titlebar.aiReadyDescription"),
                tone: "success" as const,
                status: t("titlebar.aiStatusOnline")
            };
        }

        return {
            label: t("titlebar.aiUnavailable"),
            detail: aiStatus?.message || t("titlebar.aiUnavailableDescription"),
            tone: "danger" as const,
            status: t("titlebar.aiStatusOffline")
        };
    }, [aiCheckState, aiStatus, appSettings?.generationMode, displayedModel, t]);

    const toneClasses = getToneClasses(aiDisplay.tone);
    const resolvedLocale = i18n.resolvedLanguage?.startsWith("ru") ? "ru-RU" : "en-US";
    const lastCheckedLabel = lastAiCheckAt
        ? new Intl.DateTimeFormat(resolvedLocale, {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        }).format(lastAiCheckAt)
        : t("titlebar.aiNeverChecked");

    async function copyBuildInfo() {
        const buildInfo = [
            `${appMeta.name} Desktop`,
            `${t("titlebar.versionLabel")}: ${appMeta.version}`,
            `${t("titlebar.versionChannel")}: ${versionChannel.toUpperCase()}`,
            `${t("titlebar.versionPhase")}: ${t("titlebar.versionMilestone")}`
        ].join("\n");

        try {
            await navigator.clipboard.writeText(buildInfo);
            setIsBuildInfoCopied(true);

            if (copiedResetTimerRef.current !== null) {
                window.clearTimeout(copiedResetTimerRef.current);
            }

            copiedResetTimerRef.current = window.setTimeout(() => {
                setIsBuildInfoCopied(false);
            }, 1800);
        } catch {
            setIsBuildInfoCopied(false);
        }
    }

    function navigateFromPanel(page: AppPageId) {
        setOpenPanel(null);
        onNavigate?.(page);
    }

    return (
        <>
            <header className="app-drag relative z-50 flex h-12 shrink-0 items-center justify-between border-b border-white/[0.075] bg-black px-3 shadow-[0_1px_0_rgba(255,255,255,0.025)]">
                <div ref={brandPanelRef} className="app-no-drag relative flex min-w-0 items-center gap-1">
                    <button
                        type="button"
                        onClick={() => onNavigate?.("dashboard")}
                        disabled={!onNavigate}
                        className="group flex min-w-0 items-center gap-2.5 rounded-xl bg-transparent px-1.5 py-1 transition-colors duration-200 hover:bg-white/[0.035] disabled:pointer-events-none"
                        title={t("titlebar.brandHome")}
                    >
                        <span className="flex size-7 shrink-0 items-center justify-center">
                            <img
                                src={contextforgeMarkWhite}
                                alt=""
                                aria-hidden="true"
                                draggable={false}
                                className="size-[21px] object-contain transition-transform duration-300 ease-out group-hover:-rotate-3 group-hover:scale-105"
                            />
                        </span>

                        <span className="cf-brand-font truncate text-lg font-semibold text-white transition-colors group-hover:text-neutral-100">
                            {appMeta.name}
                        </span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setOpenPanel((current) => current === "version" ? null : "version")}
                        aria-expanded={openPanel === "version"}
                        className="group flex h-7 shrink-0 items-center gap-1.5 rounded-lg bg-white/[0.035] px-2 text-neutral-500 transition-[background-color,color] duration-200 hover:bg-white/[0.075] hover:text-neutral-300"
                        title={t("titlebar.versionDetails")}
                    >
                        <span className="cf-tech-label text-[9px] uppercase tracking-[0.14em] text-neutral-600 transition-colors group-hover:text-neutral-400">
                            {versionChannel}
                        </span>
                        <span className="font-mono text-[10px]">{versionNumber}</span>
                        <ChevronDown
                            size={10}
                            className={[
                                "transition-transform duration-200",
                                openPanel === "version" ? "rotate-180" : ""
                            ].join(" ")}
                        />
                    </button>

                    <span
                        aria-hidden="true"
                        className="mx-1 h-4 w-px shrink-0 bg-white/[0.09]"
                    />

                    <div className="flex shrink-0 items-center gap-0.5">
                        <button
                            type="button"
                            onClick={onNavigateBack}
                            disabled={!canGoBack || !onNavigateBack}
                            aria-label={t("titlebar.navigationBack")}
                            title={`${t("titlebar.navigationBack")} · Alt+←`}
                            className="grid size-7 place-items-center rounded-lg text-neutral-600 transition-[background-color,color,opacity] duration-150 hover:bg-white/[0.055] hover:text-neutral-200 disabled:pointer-events-none disabled:opacity-25"
                        >
                            <ArrowLeft size={14} />
                        </button>
                        <button
                            type="button"
                            onClick={onNavigateForward}
                            disabled={!canGoForward || !onNavigateForward}
                            aria-label={t("titlebar.navigationForward")}
                            title={`${t("titlebar.navigationForward")} · Alt+→`}
                            className="grid size-7 place-items-center rounded-lg text-neutral-600 transition-[background-color,color,opacity] duration-150 hover:bg-white/[0.055] hover:text-neutral-200 disabled:pointer-events-none disabled:opacity-25"
                        >
                            <ArrowRight size={14} />
                        </button>
                    </div>

                    {openPanel === "version" && (
                        <div className="absolute left-0 top-[calc(100%+9px)] z-[80] w-[330px] overflow-hidden rounded-2xl border border-white/10 bg-neutral-950/98 p-3 shadow-[0_22px_65px_rgba(0,0,0,0.72)] backdrop-blur-xl">
                            <div className="rounded-xl border border-white/[0.06] bg-black/35 p-4">
                                <div className="flex items-start gap-3">
                                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/[0.055] text-neutral-300">
                                        <Info size={16} />
                                    </span>
                                    <div className="min-w-0">
                                        <p className="text-sm font-semibold text-white">{appMeta.name} Desktop</p>
                                        <p className="mt-1 text-xs leading-5 text-neutral-600">
                                            {t("titlebar.versionDescription")}
                                        </p>
                                    </div>
                                </div>

                                <div className="mt-4 grid grid-cols-2 gap-2">
                                    <div className="rounded-xl bg-white/[0.035] px-3 py-2.5">
                                        <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
                                            {t("titlebar.versionLabel")}
                                        </p>
                                        <p className="mt-1 font-mono text-xs text-neutral-300">{appMeta.version}</p>
                                    </div>
                                    <div className="rounded-xl bg-white/[0.035] px-3 py-2.5">
                                        <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
                                            {t("titlebar.versionBuild")}
                                        </p>
                                        <p className="mt-1 text-xs text-neutral-300">
                                            {t("titlebar.versionLocalBuild")}
                                        </p>
                                    </div>
                                </div>

                                <div className="mt-2 rounded-xl bg-white/[0.035] px-3 py-2.5">
                                    <p className="cf-tech-label text-[9px] uppercase text-neutral-600">
                                        {t("titlebar.versionLatestChanges")}
                                    </p>
                                    <p className="mt-1 text-xs leading-5 text-neutral-300">
                                        {t("titlebar.versionMilestone")}
                                    </p>
                                </div>
                            </div>

                            <div className="mt-2 grid grid-cols-2 gap-2">
                                <button
                                    type="button"
                                    onClick={() => navigateFromPanel("settings")}
                                    disabled={!onNavigate}
                                    className="cf-pressable flex h-9 items-center justify-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.035] text-xs text-neutral-300 transition hover:border-white/15 hover:bg-white/[0.075] hover:text-white disabled:opacity-50"
                                >
                                    <Settings2 size={13} />
                                    {t("titlebar.versionOpenSettings")}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void copyBuildInfo()}
                                    className="cf-pressable flex h-9 items-center justify-center gap-2 rounded-xl bg-white text-xs font-medium text-black transition hover:bg-neutral-200"
                                >
                                    {isBuildInfoCopied ? <Check size={13} /> : <Copy size={13} />}
                                    {isBuildInfoCopied
                                        ? t("titlebar.versionCopied")
                                        : t("titlebar.versionCopy")}
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                <button
                    type="button"
                    onClick={onOpenNavigationAssistant}
                    disabled={!onNavigate || !onOpenNavigationAssistant}
                    className={[
                        "app-no-drag group absolute left-1/2 top-1/2 hidden h-7 w-[238px] -translate-x-1/2 -translate-y-1/2 items-center justify-center gap-1.5 overflow-hidden rounded-full border border-white/10 bg-white/[0.035] px-2.5 text-[11px] text-neutral-500 shadow-[0_8px_22px_rgba(0,0,0,0.30)] transition-[border-color,background-color,color,box-shadow,opacity] duration-200 hover:border-white hover:bg-white hover:text-black hover:shadow-[0_10px_26px_rgba(0,0,0,0.38)] disabled:pointer-events-none disabled:opacity-60 lg:flex",
                        isFocusModeActive ? "pointer-events-none opacity-0" : "opacity-100"
                    ].join(" ")}
                    title={t("titlebar.openNavigationAssistant")}
                >
                    <span className="shrink-0 transition-colors group-hover:text-black/70">ContextForge</span>
                    <ChevronRight size={11} className="text-neutral-700 transition group-hover:text-black/45" />
                    <span className="min-w-0 truncate font-medium text-neutral-200 transition-colors group-hover:text-black">
                        {currentPageLabel}
                    </span>
                    <ChevronDown size={11} className="shrink-0 text-neutral-700 transition group-hover:text-black/45" />
                </button>

                <div className="app-no-drag flex items-center gap-2">
                    {isFocusModeAvailable && onToggleFocusMode && (
                        <button
                            type="button"
                            onClick={onToggleFocusMode}
                            aria-pressed={isFocusModeActive}
                            aria-label={
                                isFocusModeActive
                                    ? t("titlebar.focusModeExit")
                                    : t("titlebar.focusModeEnter")
                            }
                            title={
                                isFocusModeActive
                                    ? t("titlebar.focusModeExit")
                                    : t("titlebar.focusModeEnter")
                            }
                            className={[
                                "cf-pressable flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[10.5px] font-medium backdrop-blur-sm transition-[border-color,background-color,color,box-shadow,transform] duration-200",
                                isFocusModeActive
                                    ? "border border-white/15 bg-white/[0.09] text-white shadow-[0_8px_24px_rgba(0,0,0,0.34)] hover:border-white/25 hover:bg-white/[0.13]"
                                    : "border border-white/[0.08] bg-white/[0.025] text-neutral-500 hover:border-white/20 hover:bg-white/[0.07] hover:text-white"
                            ].join(" ")}
                        >
                            {isFocusModeActive ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                            <span className="hidden 2xl:inline">
                                {isFocusModeActive
                                    ? t("titlebar.focusModeExit")
                                    : t("titlebar.focusModeEnter")}
                            </span>
                        </button>
                    )}

                    {!isFocusModeActive && onAddProject && (
                        <button
                            type="button"
                            onClick={onAddProject}
                            disabled={isLoading}
                            aria-label={isLoading ? t("common.scanning") : t("common.addProject")}
                            title={isLoading ? t("common.scanning") : t("common.addProject")}
                            className="cf-pressable group mr-1 inline-flex size-8 shrink-0 items-center justify-center gap-2 rounded-full bg-neutral-100 text-xs font-medium text-black shadow-[0_12px_30px_rgba(0,0,0,0.42)] transition-[background-color,box-shadow,transform] duration-200 hover:bg-white hover:shadow-[0_14px_34px_rgba(0,0,0,0.52)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none motion-reduce:active:scale-100 md:mr-2 md:h-8 md:w-auto md:px-3.5"
                        >
                            <FolderOpen
                                size={14}
                                className="transition-transform duration-200 group-hover:-translate-y-px group-hover:-rotate-3"
                            />
                            <span className="hidden md:inline">
                                {isLoading ? t("common.scanning") : t("common.addProject")}
                            </span>
                        </button>
                    )}

                    {!isFocusModeActive && (
                    <div ref={aiPanelRef} className="relative mr-2 hidden xl:block">
                        <button
                            type="button"
                            onClick={() => setOpenPanel((current) => current === "ai" ? null : "ai")}
                            aria-expanded={openPanel === "ai"}
                            aria-label={t("titlebar.aiStatusAria")}
                            className="group flex h-8 items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.025] px-3 text-[11px] text-neutral-300 transition-[border-color,background-color,color] duration-200 hover:border-white/15 hover:bg-white/[0.06] hover:text-white"
                        >
                            <span className={["size-1.5 shrink-0 rounded-full", toneClasses.dot].join(" ")} />
                            <span>{aiDisplay.label}</span>
                            <ChevronDown
                                size={10}
                                className={[
                                    "text-neutral-600 transition-transform duration-200 group-hover:text-neutral-400",
                                    openPanel === "ai" ? "rotate-180" : ""
                                ].join(" ")}
                            />
                        </button>

                        {openPanel === "ai" && (
                            <div className="absolute right-0 top-[calc(100%+9px)] z-[80] w-[350px] overflow-hidden rounded-2xl border border-white/10 bg-neutral-950/98 p-3 shadow-[0_22px_65px_rgba(0,0,0,0.72)] backdrop-blur-xl">
                                <div className="rounded-xl border border-white/[0.06] bg-black/35 p-4">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="flex min-w-0 items-start gap-3">
                                            <span className={["grid size-9 shrink-0 place-items-center rounded-xl bg-white/[0.055]", toneClasses.icon].join(" ")}>
                                                {aiCheckState === "checking"
                                                    ? <Loader2 size={16} className="animate-spin" />
                                                    : aiDisplay.tone === "danger" || aiDisplay.tone === "warning"
                                                        ? <CircleAlert size={16} />
                                                        : <Sparkles size={16} />}
                                            </span>
                                            <div className="min-w-0">
                                                <p className="text-sm font-semibold text-white">
                                                    {t("titlebar.aiPanelTitle")}
                                                </p>
                                                <p className="mt-1 text-xs leading-5 text-neutral-600">
                                                    {aiDisplay.detail}
                                                </p>
                                            </div>
                                        </div>
                                        <span className={["mt-0.5 size-2 shrink-0 rounded-full", toneClasses.dot].join(" ")} />
                                    </div>

                                    <div className="mt-4 space-y-1 rounded-xl bg-white/[0.025] p-2">
                                        <div className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-3 rounded-lg px-2 py-2">
                                            <span className="text-xs text-neutral-600">{t("titlebar.aiProvider")}</span>
                                            <span className="truncate text-xs text-neutral-300">{providerLabel}</span>
                                        </div>
                                        <div className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-3 rounded-lg px-2 py-2">
                                            <span className="text-xs text-neutral-600">{t("titlebar.aiModel")}</span>
                                            <span className="truncate font-mono text-[11px] text-neutral-300">
                                                {displayedModel || t("titlebar.aiNotConfigured")}
                                            </span>
                                        </div>
                                        <div className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-3 rounded-lg px-2 py-2">
                                            <span className="text-xs text-neutral-600">{t("titlebar.aiMode")}</span>
                                            <span className="truncate text-xs text-neutral-300">
                                                {appSettings?.generationMode === "template"
                                                    ? t("titlebar.aiModeTemplate")
                                                    : t("titlebar.aiModeAssisted")}
                                            </span>
                                        </div>
                                        <div className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-3 rounded-lg px-2 py-2">
                                            <span className="text-xs text-neutral-600">{t("titlebar.aiStatus")}</span>
                                            <span className={["truncate text-xs", toneClasses.value].join(" ")}>
                                                {aiDisplay.status}
                                            </span>
                                        </div>
                                        <div className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-3 rounded-lg px-2 py-2">
                                            <span className="text-xs text-neutral-600">{t("titlebar.aiLastChecked")}</span>
                                            <span className="truncate text-xs text-neutral-400">{lastCheckedLabel}</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-2 grid grid-cols-2 gap-2">
                                    <button
                                        type="button"
                                        onClick={() => void refreshAiWorkflow()}
                                        disabled={aiCheckState === "checking"}
                                        className="cf-pressable flex h-9 items-center justify-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.035] text-xs text-neutral-300 transition hover:border-white/15 hover:bg-white/[0.075] hover:text-white disabled:cursor-wait disabled:opacity-50"
                                    >
                                        <RefreshCw
                                            size={13}
                                            className={aiCheckState === "checking" ? "animate-spin" : ""}
                                        />
                                        {t("titlebar.aiCheckAgain")}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => navigateFromPanel("integrations")}
                                        disabled={!onNavigate}
                                        className="cf-pressable flex h-9 items-center justify-center gap-2 rounded-xl bg-white text-xs font-medium text-black transition hover:bg-neutral-200 disabled:opacity-50"
                                    >
                                        <Cpu size={13} />
                                        {t("titlebar.aiOpenSettings")}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                    )}

                    <button
                        type="button"
                        onClick={minimizeWindow}
                        className="cf-pressable grid size-8 place-items-center rounded-lg text-neutral-500 transition hover:bg-white hover:text-black"
                        aria-label={t("titlebar.minimizeWindow")}
                    >
                        <Minus size={15} />
                    </button>

                    <button
                        type="button"
                        onClick={toggleMaximizeWindow}
                        className="cf-pressable grid size-8 place-items-center rounded-lg text-neutral-500 transition hover:bg-white hover:text-black"
                        aria-label={t("titlebar.maximizeWindow")}
                    >
                        <Maximize2 size={14} />
                    </button>

                    <button
                        type="button"
                        onClick={closeWindow}
                        className="cf-pressable grid size-8 place-items-center rounded-lg text-neutral-500 transition hover:bg-red-500/15 hover:text-red-300"
                        aria-label={t("titlebar.closeWindow")}
                    >
                        <X size={15} />
                    </button>
                </div>
            </header>

        </>
    );
}
