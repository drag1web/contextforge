import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import {
  Bot,
  ChevronDown,
  CheckCircle2,
  Circle,
  Cpu,
  Download,
  Gauge,
  Keyboard,
  Languages,
  Layers3,
  Loader2,
  MessageSquareText,
  PanelLeft,
  RefreshCw,
  Save,
  Server,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  WandSparkles,
  XCircle,
  type LucideIcon
} from "lucide-react";

import {
  exportWorkspaceBackup,
  clearSelectorDiagnosticsHistory,
  getAppSettings,
  getSelectorDiagnosticsHistory,
  getStorageAudit,
  getOllamaModels,
  getOllamaStatus,
  updateAppSettings
} from "../api/client";

import type { AppSettings, OllamaModel, OllamaStatus, SelectorPipelineDiagnostics, StorageAuditResult, WorkspaceBackupExportResult } from "../types";
import { CustomSelect } from "../components/ui/CustomSelect";
import { Button } from "../components/ui/Button";
import { HorizontalSlidingSelector, VerticalSlidingSelector } from "../components/ui/SlidingSelectors";
import { WorkspacePageHeader } from "../components/layout/WorkspacePageHeader";
import { appMeta } from "../config/appMeta";
import { keyboardShortcuts } from "../config/keyboardShortcuts";
import { TARGET_TOOL_OPTIONS } from "../components/ai/aiToolOptions";
import {
  getSelectorModeCopy,
  SELECTOR_PIPELINE_MODES,
} from "../components/selector/selectorPipelinePresentation";
import {
  applyAppLanguage,
  resolveAppLanguage,
  type AppLanguage
} from "../i18n";

type SettingsSectionId =
  | "general"
  | "ai"
  | "generation"
  | "composer"
  | "interface"
  | "shortcuts"
  | "system"
  | "privacy"
  | "storage"
  | "updates";

type ComposerLimitKey = keyof AppSettings["composerFileLimits"];

const SETTINGS_SECTIONS: Array<{
  id: SettingsSectionId;
  label: string;
  labelKey?: string;
  icon: LucideIcon;
  status?: "soon";
}> = [
    {
      id: "general",
      label: "General",
      labelKey: "settings.general",
      icon: Settings
    },
    {
      id: "ai",
      label: "AI Engine",
      labelKey: "settings.aiEngine",
      icon: Bot
    },
    {
      id: "generation",
      label: "Generation",
      labelKey: "settings.generation",
      icon: SlidersHorizontal
    },
    {
      id: "composer",
      label: "Composer",
      labelKey: "settings.composer",
      icon: WandSparkles
    },
    {
      id: "interface",
      label: "Interface",
      labelKey: "settings.interface",
      icon: PanelLeft
    },
    {
      id: "shortcuts",
      label: "Shortcuts",
      labelKey: "settings.shortcuts",
      icon: Keyboard
    },
    {
      id: "privacy",
      label: "Privacy",
      labelKey: "settings.privacy",
      icon: ShieldCheck,
      status: "soon"
    },
    {
      id: "storage",
      label: "Storage",
      labelKey: "settings.storage",
      icon: Server
    },
    {
      id: "updates",
      label: "Updates",
      labelKey: "settings.updates",
      icon: RefreshCw,
      status: "soon"
    },
    {
      id: "system",
      label: "System",
      labelKey: "settings.system",
      icon: ShieldCheck
    }
  ];

function getSettingsSectionLabel(section: (typeof SETTINGS_SECTIONS)[number], t: (key: string, options?: Record<string, unknown>) => string) {
  return section.labelKey ? t(section.labelKey) : section.label;
}

const SETTINGS_PLACEHOLDER_SECTIONS = ["privacy", "updates"] as const;
type PlaceholderSectionId = (typeof SETTINGS_PLACEHOLDER_SECTIONS)[number];

const DEFAULT_COMPOSER_FILE_LIMITS: AppSettings["composerFileLimits"] = {
  default: 8,
  ui: 7,
  backend: 8,
  fullstack: 10,
  build: 7,
  bugfix: 7,
  refactor: 8,
  docs: 6,
  tests: 7
};

const COMPOSER_LIMIT_MIN = 3;
const COMPOSER_LIMIT_MAX = 24;

const COMPOSER_LIMIT_PRESETS: Array<{
  id: string;
  label: string;
  caption: string;
  limits: AppSettings["composerFileLimits"];
}> = [
    {
      id: "focused",
      label: "Focused",
      caption: "Less noise",
      limits: {
        default: 6,
        ui: 5,
        backend: 6,
        fullstack: 8,
        build: 6,
        bugfix: 5,
        refactor: 6,
        docs: 4,
        tests: 6
      }
    },
    {
      id: "balanced",
      label: "Balanced",
      caption: "Recommended",
      limits: DEFAULT_COMPOSER_FILE_LIMITS
    },
    {
      id: "extended",
      label: "Extended",
      caption: "More context",
      limits: {
        default: 12,
        ui: 10,
        backend: 12,
        fullstack: 16,
        build: 10,
        bugfix: 10,
        refactor: 12,
        docs: 8,
        tests: 10
      }
    }
  ];

const COMPOSER_LIMIT_ROWS: Array<{
  key: ComposerLimitKey;
  label: string;
  caption: string;
}> = [
    {
      key: "default",
      label: "Default",
      caption: "Fallback limit when task area is unknown."
    },
    {
      key: "ui",
      label: "UI / UX",
      caption: "Pages, components, layouts and styles."
    },
    {
      key: "backend",
      label: "Backend",
      caption: "Routes, services, database and server files."
    },
    {
      key: "fullstack",
      label: "Fullstack",
      caption: "Client, API bridge and backend files."
    },
    {
      key: "build",
      label: "Build",
      caption: "Package, config, aliases and entry files."
    },
    {
      key: "bugfix",
      label: "Bugfix",
      caption: "Focused context for broken behavior."
    },
    {
      key: "refactor",
      label: "Refactor",
      caption: "Enough files to preserve behavior safely."
    },
    {
      key: "docs",
      label: "Docs",
      caption: "README, docs, setup and package metadata."
    },
    {
      key: "tests",
      label: "Tests",
      caption: "Test files plus related source context."
    }
  ];

const PAGE_TRANSITION = {
  duration: 0.16,
  ease: [0.16, 1, 0.3, 1]
} as const;

function formatModelSize(size?: number) {
  if (!size) {
    return "—";
  }

  const gb = size / 1024 / 1024 / 1024;

  if (gb >= 1) {
    return `${gb.toFixed(1)} GB`;
  }

  const mb = size / 1024 / 1024;
  return `${mb.toFixed(0)} MB`;
}

function withSettingsDefaults(settings: AppSettings): AppSettings {
  return {
    ...settings,
    language: settings.language ?? "system",
    sidebarShowDescriptions: settings.sidebarShowDescriptions ?? false,
    onboardingEnabled: settings.onboardingEnabled ?? true,
    onboardingShowEveryLaunch: settings.onboardingShowEveryLaunch ?? true,
    contextQualityMode: settings.contextQualityMode ?? "balanced",
    selectorPipelineMode: settings.selectorPipelineMode ?? "legacy",
    taskUnderstandingInteractionMode:
      settings.taskUnderstandingInteractionMode ?? "balanced",
    composerFileLimits: {
      ...DEFAULT_COMPOSER_FILE_LIMITS,
      ...(settings.composerFileLimits ?? {})
    }
  };
}

function isSameSettings(
  current: AppSettings | null,
  draft: AppSettings | null
) {
  return JSON.stringify(current) === JSON.stringify(draft);
}

function clampLimit(value: number, fallback = 8) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(
    COMPOSER_LIMIT_MAX,
    Math.max(COMPOSER_LIMIT_MIN, Math.round(value))
  );
}

function isSameComposerLimits(
  left: AppSettings["composerFileLimits"],
  right: AppSettings["composerFileLimits"]
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function getActivePreset(limits: AppSettings["composerFileLimits"]) {
  return COMPOSER_LIMIT_PRESETS.find((preset) =>
    isSameComposerLimits(preset.limits, limits)
  );
}


function SettingsChoiceCardContent({
  icon: Icon,
  label,
  caption,
  isActive
}: {
  icon: LucideIcon;
  label: string;
  caption: string;
  isActive: boolean;
}) {
  return (
    <div className="flex h-full flex-col p-4 text-left">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span
          className={[
            "grid size-9 place-items-center rounded-xl border transition-colors duration-150",
            isActive
              ? "border-black/10 bg-black/5 text-black"
              : "border-neutral-800 bg-neutral-950 text-neutral-500 group-hover:border-white/15 group-hover:text-white"
          ].join(" ")}
        >
          <Icon size={15} />
        </span>

        <CheckCircle2
          size={16}
          className={[
            "shrink-0 transition-opacity duration-150",
            isActive ? "text-black opacity-100" : "opacity-0"
          ].join(" ")}
        />
      </div>

      <p
        className={[
          "text-sm font-semibold transition-colors duration-150",
          isActive ? "text-black" : "text-white group-hover:text-white"
        ].join(" ")}
      >
        {label}
      </p>

      <p
        className={[
          "mt-1 text-xs leading-5 transition-colors duration-150",
          isActive
            ? "text-black/55"
            : "text-neutral-600 group-hover:text-neutral-400"
        ].join(" ")}
      >
        {caption}
      </p>
    </div>
  );
}

function InterfaceChoiceContent({
  icon: Icon,
  label,
  caption,
  meta,
  isActive
}: {
  icon: LucideIcon;
  label: string;
  caption: string;
  meta?: string;
  isActive: boolean;
}) {
  return (
    <div className="flex h-full min-h-[104px] items-start gap-3 p-4 text-left">
      <span
        className={[
          "mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl border transition-colors duration-150",
          isActive
            ? "border-black/10 bg-black/5 text-black"
            : "border-neutral-800 bg-neutral-950 text-neutral-500 group-hover:border-white/15 group-hover:text-white"
        ].join(" ")}
      >
        <Icon size={15} />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-3">
          <span
            className={[
              "text-sm font-semibold transition-colors duration-150",
              isActive ? "text-black" : "text-white"
            ].join(" ")}
          >
            {label}
          </span>

          {meta && (
            <span
              className={[
                "cf-tech-label shrink-0 text-[9px] uppercase transition-colors duration-150",
                isActive ? "text-black/45" : "text-neutral-700"
              ].join(" ")}
            >
              {meta}
            </span>
          )}
        </span>

        <span
          className={[
            "mt-1 block text-xs leading-5 transition-colors duration-150",
            isActive
              ? "text-black/55"
              : "text-neutral-600 group-hover:text-neutral-400"
          ].join(" ")}
        >
          {caption}
        </span>
      </span>

      <CheckCircle2
        size={16}
        className={[
          "mt-1 shrink-0 transition-opacity duration-150",
          isActive ? "text-black opacity-100" : "opacity-0"
        ].join(" ")}
      />
    </div>
  );
}

function PlannedInterfaceFeature({
  icon: Icon,
  title,
  description,
  badge
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  badge: string;
}) {
  return (
    <div
      aria-disabled="true"
      className="settings-inner-surface min-h-[132px] rounded-2xl border p-4 opacity-80"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-500">
          <Icon size={15} />
        </span>

        <div className="min-w-0 flex-1">
          <p className="cf-tech-label text-[9px] uppercase tracking-[0.16em] text-neutral-700">
            {badge}
          </p>
          <p className="mt-2 text-sm font-semibold text-neutral-300">{title}</p>
          <p className="mt-1 text-xs leading-5 text-neutral-600">{description}</p>
        </div>
      </div>
    </div>
  );
}

function SettingCard({
  icon,
  label,
  title,
  description,
  children,
  defaultOpen = true,
  className = "",
  storageId
}: {
  icon: ReactNode;
  label: string;
  title: string;
  description: string;
  children?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  storageId?: string;
}) {
  const hasContent = Boolean(children);
  const storageKey = useMemo(
    () =>
      `contextforge:settings-card:${storageId ?? `${label}:${title}`}`
        .toLowerCase()
        .replace(/[^a-z0-9а-яё:_-]+/gi, "-"),
    [label, storageId, title]
  );
  const [isOpen, setIsOpen] = useState(() => {
    if (typeof window === "undefined") {
      return defaultOpen;
    }

    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored === "open") {
        return true;
      }
      if (stored === "closed") {
        return false;
      }
    } catch {
      // Keep settings usable if localStorage is unavailable.
    }

    return defaultOpen;
  });

  function toggleOpen() {
    setIsOpen((current) => {
      const next = !current;

      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(storageKey, next ? "open" : "closed");
        } catch {
          // Ignore persistence errors; the visual state still updates.
        }
      }

      return next;
    });
  }

  return (
    <article
      className={[
        "cf-card settings-collapsible-card group/card self-start overflow-hidden p-0 text-render-crisp",
        className
      ].join(" ")}
    >
      <div className="flex w-full items-start justify-between gap-4 p-4 text-left transition duration-200">
        <div className="min-w-0">
          <div className="mb-3 flex size-9 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-200 transition duration-200 group-hover/card:border-white/15 group-hover/card:text-white">
            {icon}
          </div>

          <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
            {label}
          </p>

          <h3 className="mt-2 text-base font-semibold text-white">
            {title}
          </h3>

          <p className="mt-1 max-w-2xl text-sm leading-6 text-neutral-500">
            {description}
          </p>
        </div>

        {hasContent && (
          <button
            type="button"
            onClick={toggleOpen}
            aria-expanded={isOpen}
            aria-label={isOpen ? `Collapse ${title}` : `Expand ${title}`}
            className="mt-1 grid size-9 shrink-0 place-items-center rounded-2xl border border-neutral-900 bg-black/35 text-neutral-500 transition duration-200 hover:border-white/20 hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
          >
            <motion.span
              initial={false}
              animate={{ rotate: isOpen ? 180 : 0 }}
              transition={{ type: "spring", stiffness: 520, damping: 36, mass: 0.6 }}
              style={{ willChange: "transform" }}
            >
              <ChevronDown size={16} />
            </motion.span>
          </button>
        )}
      </div>

      <AnimatePresence initial={false}>
        {hasContent && isOpen && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
            style={{ willChange: "height, opacity" }}
          >
            <div className="px-4 pb-4">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </article>
  );
}

function StatusBadge({ status }: { status: OllamaStatus | null }) {
  const { t } = useTranslation();
  const isOnline = Boolean(status?.online);

  return (
    <span
      className={[
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs",
        isOnline
          ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
          : "border-red-400/25 bg-red-400/10 text-red-300"
      ].join(" ")}
    >
      <span
        className={[
          "size-1.5 rounded-full",
          isOnline
            ? "bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,0.9)]"
            : "bg-red-400 shadow-[0_0_12px_rgba(248,113,113,0.8)]"
        ].join(" ")}
      />
      {isOnline ? t("settings.ollamaOnline") : t("settings.ollamaOffline")}
    </span>
  );
}

function SettingsActionButton({
  icon: Icon,
  label,
  loadingLabel,
  loading,
  disabled,
  variant,
  pulse,
  onClick
}: {
  icon: LucideIcon;
  label: string;
  loadingLabel: string;
  loading: boolean;
  disabled: boolean;
  variant: "primary" | "secondary";
  pulse?: boolean;
  onClick: () => void;
}) {
  const isPrimary = variant === "primary";

  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      className={[
        "group relative h-10 overflow-hidden rounded-full border px-4 text-sm font-medium transition duration-200",
        "disabled:pointer-events-none disabled:opacity-50",
        isPrimary
          ? "border-white bg-white text-black shadow-[0_12px_34px_rgba(255,255,255,0.12)]"
          : "border-neutral-800 bg-black/40 text-neutral-300 hover:border-white hover:bg-white hover:text-black",
        pulse && !disabled
          ? "shadow-[0_0_0_1px_rgba(255,255,255,0.12),0_0_28px_rgba(255,255,255,0.10)]"
          : ""
      ].join(" ")}
    >
      {pulse && !loading && !disabled && (
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full border border-white/20"
        />
      )}

      <span className="relative z-10 flex items-center gap-2">
        <span
          className={[
            "grid size-6 place-items-center rounded-full transition",
            isPrimary
              ? "bg-black/5 text-black"
              : "bg-neutral-950 text-neutral-400 group-hover:bg-black/5 group-hover:text-black"
          ].join(" ")}
        >
          {loading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Icon size={14} />
          )}
        </span>

        <motion.span
          key={loading ? loadingLabel : label}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.14 }}
        >
          {loading ? loadingLabel : label}
        </motion.span>
      </span>
    </motion.button>
  );
}

const SETTINGS_NAV_ITEM_HEIGHT = 44;
const SETTINGS_NAV_ITEM_GAP = 4;

function SettingsSidebar({
  activeSection,
  hasUnsavedChanges,
  onChange
}: {
  activeSection: SettingsSectionId;
  hasUnsavedChanges: boolean;
  onChange: (section: SettingsSectionId) => void;
}) {
  const { t } = useTranslation();
  const activeIndex = Math.max(
    0,
    SETTINGS_SECTIONS.findIndex((section) => section.id === activeSection)
  );

  return (
    <aside className="settings-control-panel sticky top-5 h-fit overflow-hidden rounded-[1.6rem] border border-neutral-900 bg-black/20 p-2 text-render-crisp">
      <div className="mb-2 px-3 py-3">
        <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
          {t("settings.title")}
        </p>

        <div className="mt-1 flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-white">
            {t("settings.controlCenter")}
          </p>
          <span className="rounded-full border border-neutral-900 bg-black/35 px-2 py-0.5 text-[10px] text-neutral-600">
            {SETTINGS_SECTIONS.length}
          </span>
        </div>
      </div>

      <VerticalSlidingSelector
        items={SETTINGS_SECTIONS}
        activeIndex={activeIndex}
        itemHeight={SETTINGS_NAV_ITEM_HEIGHT}
        itemGap={SETTINGS_NAV_ITEM_GAP}
        getItemKey={(section) => section.id}
        onSelect={(section) => onChange(section.id)}
        ariaLabel={t("settings.title")}
        indicatorClassName="border border-white/[0.18] shadow-[0_10px_26px_rgba(0,0,0,0.42)]"
        itemClassName="flex items-center gap-3 overflow-hidden rounded-2xl px-3 text-left"
        renderItem={(section, isActive) => {
          const Icon = section.icon;

          return (
            <>
              <span
                className={[
                  "grid size-7 shrink-0 place-items-center rounded-xl border transition-colors duration-150",
                  isActive
                    ? "border-black/10 bg-black/5 text-black"
                    : "border-neutral-900 bg-black/40 text-neutral-600 group-hover:border-white/15 group-hover:text-white"
                ].join(" ")}
              >
                <Icon size={14} />
              </span>

              <span
                className={[
                  "truncate text-sm font-medium transition-colors duration-150",
                  isActive ? "text-black" : "text-neutral-400 group-hover:text-white"
                ].join(" ")}
              >
                {getSettingsSectionLabel(section, t)}
              </span>

              {section.status === "soon" && (
                <span
                  className={[
                    "ml-auto shrink-0 rounded-full border px-2 py-0.5 text-[10px] leading-none transition-colors duration-150",
                    isActive
                      ? "border-black/10 bg-black/5 text-black/70"
                      : "border-neutral-800 bg-black/35 text-neutral-600 group-hover:border-white/15 group-hover:text-neutral-300"
                  ].join(" ")}
                >
                  {t("common.soon")}
                </span>
              )}
            </>
          );
        }}
      />

      <div className="mt-3 rounded-2xl border border-neutral-900 bg-black/40 p-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-neutral-600">{t("settings.state")}</span>

          <span
            className={[
              "rounded-full border px-2 py-0.5 text-[10px]",
              hasUnsavedChanges
                ? "border-white/20 bg-white/10 text-white"
                : "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
            ].join(" ")}
          >
            {hasUnsavedChanges ? t("common.unsaved") : t("common.saved")}
          </span>
        </div>
      </div>
    </aside>
  );
}

function SectionHeader({
  icon,
  label,
  title,
  description
}: {
  icon: ReactNode;
  label: string;
  title: string;
  description: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className="rounded-[1.6rem] border border-neutral-900 bg-black/20 p-5"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-400">
          {icon}
        </span>
        <div className="min-w-0">
          <p className="cf-tech-label text-[10px] uppercase text-neutral-600">{label}</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-white">
            {title}
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-neutral-500">
            {description}
          </p>
        </div>
      </div>
    </motion.div>
  );
}

function ComposerLimitRow({
  label,
  caption,
  value,
  onChange
}: {
  label: string;
  caption: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const [inputValue, setInputValue] = useState(String(value));

  useEffect(() => {
    setInputValue(String(value));
  }, [value]);

  const safeValue = clampLimit(value);
  const percent =
    ((safeValue - COMPOSER_LIMIT_MIN) /
      (COMPOSER_LIMIT_MAX - COMPOSER_LIMIT_MIN)) *
    100;

  function commitInputValue() {
    const trimmed = inputValue.trim();

    if (!trimmed) {
      setInputValue(String(value));
      return;
    }

    const parsed = Number(trimmed);
    const nextValue = clampLimit(parsed, value);

    setInputValue(String(nextValue));
    onChange(nextValue);
  }

  function handleTextChange(rawValue: string) {
    const nextValue = rawValue.replace(/[^\d]/g, "");

    setInputValue(nextValue);

    if (!nextValue) {
      return;
    }

    const parsed = Number(nextValue);

    if (
      Number.isFinite(parsed) &&
      parsed >= COMPOSER_LIMIT_MIN &&
      parsed <= COMPOSER_LIMIT_MAX
    ) {
      onChange(parsed);
    }
  }

  function handleRangeChange(rawValue: string) {
    const nextValue = clampLimit(Number(rawValue), value);

    setInputValue(String(nextValue));
    onChange(nextValue);
  }

  return (
    <div className="rounded-2xl border border-neutral-900 bg-black/40 p-4">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">{label}</p>
          <p className="mt-1 text-xs leading-5 text-neutral-600">{caption}</p>
        </div>

        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={inputValue}
          onChange={(event) => handleTextChange(event.target.value)}
          onBlur={commitInputValue}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitInputValue();
              event.currentTarget.blur();
            }

            if (event.key === "Escape") {
              event.preventDefault();
              setInputValue(String(value));
              event.currentTarget.blur();
            }
          }}
          className="h-9 w-16 rounded-xl border border-neutral-800 bg-neutral-950 px-2 text-center text-sm font-semibold text-white outline-none transition focus:border-white/40 focus:ring-4 focus:ring-white/5"
        />
      </div>

      <div className="flex items-center gap-3">
        <span className="text-[10px] text-neutral-700">
          {COMPOSER_LIMIT_MIN}
        </span>

        <div className="relative h-9 flex-1">
          <div className="absolute left-0 right-0 top-1/2 h-2 -translate-y-1/2 rounded-full border border-white/10 bg-black shadow-[inset_0_1px_0_rgba(255,255,255,0.045)]" />

          <motion.div
            className="absolute left-0 top-1/2 h-2 origin-left -translate-y-1/2 rounded-full bg-white"
            initial={false}
            animate={{ width: `${percent}%` }}
            transition={{
              type: "spring",
              stiffness: 420,
              damping: 36,
              mass: 0.65
            }}
          />

          <motion.div
            aria-hidden="true"
            className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/20 bg-white shadow-[0_8px_18px_rgba(0,0,0,0.38)]"
            initial={false}
            animate={{ left: `${percent}%` }}
            transition={{
              type: "spring",
              stiffness: 420,
              damping: 36,
              mass: 0.65
            }}
          />

          <input
            type="range"
            min={COMPOSER_LIMIT_MIN}
            max={COMPOSER_LIMIT_MAX}
            value={safeValue}
            onChange={(event) => handleRangeChange(event.target.value)}
            className="absolute inset-0 h-9 w-full cursor-pointer opacity-0"
          />
        </div>

        <span className="text-[10px] text-neutral-700">
          {COMPOSER_LIMIT_MAX}
        </span>
      </div>
    </div>
  );
}

function PlaceholderSettingsPanel({
  sectionId
}: {
  sectionId: PlaceholderSectionId;
}) {
  const { t } = useTranslation();

  const config = sectionId === "privacy"
    ? {
        label: t("settings.privacy"),
        title: t("settings.privacyTitle"),
        description: t("settings.privacyDescription"),
        cards: [
          {
            title: t("settings.secretAwareScanning"),
            description: t("settings.secretAwareScanningDesc"),
            points: [
              t("settings.sensitiveFileReview"),
              t("settings.redactionRules"),
              t("settings.localSafetyNotes")
            ]
          },
          {
            title: t("settings.projectTrustLevels"),
            description: t("settings.projectTrustLevelsDesc"),
            points: [
              t("settings.strictProjectMode"),
              t("settings.allowedFolders"),
              t("settings.forbiddenPatterns")
            ]
          },
          {
            title: t("settings.exportPrivacy"),
            description: t("settings.exportPrivacyDesc"),
            points: [
              t("settings.clipboardWarnings"),
              t("settings.pathRedaction"),
              t("settings.safeExportSummary")
            ]
          }
        ]
      }
    : {
        label: t("settings.updates"),
        title: t("settings.updatesTitle"),
        description: t("settings.updatesDescription"),
        cards: [
          {
            title: t("settings.updatePolicy"),
            description: t("settings.updatePolicyDesc"),
            points: [
              t("settings.backgroundChecks"),
              t("settings.downloadConfirmation"),
              t("settings.restartControl")
            ]
          },
          {
            title: t("settings.releaseNotes"),
            description: t("settings.releaseNotesDesc"),
            points: [
              t("settings.coreChanges"),
              t("settings.uiChanges"),
              t("settings.knownLimitations")
            ]
          },
          {
            title: t("settings.releaseChannelLocation"),
            description: t("settings.releaseChannelLocationDesc"),
            points: [
              t("settings.accountSyncSection"),
              t("settings.channelAwareBuilds"),
              t("settings.directReleaseLinks")
            ]
          }
        ]
      };

  return (
    <>
      <SectionHeader
        icon={<Sparkles size={15} />}
        label={config.label}
        title={config.title}
        description={config.description}
      />

      <div className="grid items-start gap-4 xl:grid-cols-3">
        {config.cards.map((card) => (
          <SettingCard
            key={card.title}
            icon={<Sparkles size={17} />}
            label={t("settings.planned")}
            title={card.title}
            description={card.description}
            defaultOpen={false}
          >
            <div className="grid gap-2">
              {card.points.map((point) => (
                <div
                  key={point}
                  className="settings-inner-surface flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5"
                >
                  <span className="text-sm text-neutral-300">{point}</span>
                  <span className="rounded-full border border-neutral-800 bg-black/35 px-2 py-0.5 text-[9px] uppercase tracking-[0.14em] text-neutral-600">
                    {t("settings.planned")}
                  </span>
                </div>
              ))}
            </div>
          </SettingCard>
        ))}
      </div>
    </>
  );
}


function formatStorageBytes(sizeBytes: number | null) {
  if (sizeBytes === null || !Number.isFinite(sizeBytes)) {
    return "—";
  }

  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  const kb = sizeBytes / 1024;

  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }

  const mb = kb / 1024;

  if (mb < 1024) {
    return `${mb.toFixed(1)} MB`;
  }

  return `${(mb / 1024).toFixed(1)} GB`;
}

function storageStatusClasses(status: string) {
  if (status === "ready" || status === "primary" || status === "done" || status === "pass") {
    return "border-emerald-400/25 bg-emerald-400/10 text-emerald-300";
  }

  if (status === "current") {
    return "border-white/20 bg-white/10 text-white";
  }

  if (status === "external" || status === "legacy" || status === "warning" || status === "review") {
    return "border-amber-300/25 bg-amber-300/10 text-amber-200";
  }

  if (status === "fail" || status === "blocked") {
    return "border-rose-400/25 bg-rose-400/10 text-rose-200";
  }

  return "border-neutral-800 bg-neutral-950 text-neutral-500";
}

function StorageSettingsPanel({
  audit,
  loading,
  onRefresh
}: {
  audit: StorageAuditResult | null;
  loading: boolean;
  onRefresh: () => void | Promise<void>;
}) {
  const { i18n } = useTranslation();
  const isRussian = i18n.resolvedLanguage?.startsWith("ru") ?? false;
  const copy = (english: string, russian: string) => isRussian ? russian : english;
  const dateTimeFormatter = useMemo(
    () => new Intl.DateTimeFormat(isRussian ? "ru-RU" : "en-US", {
      dateStyle: "medium",
      timeStyle: "short"
    }),
    [isRussian]
  );
  const formatDateTime = (value: string | number | Date) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : dateTimeFormatter.format(date);
  };
  const [activeView, setActiveView] = useState<"overview" | "backups" | "diagnostics">("overview");
  const [backupResult, setBackupResult] = useState<WorkspaceBackupExportResult | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [isBackupExporting, setIsBackupExporting] = useState(false);

  const counts = audit?.counts ?? [];
  const artifacts = audit?.artifacts ?? [];
  const gaps = audit?.gaps ?? [];
  const plan = audit?.plan ?? [];
  const schema = audit?.schema ?? null;
  const releaseReadiness = audit?.releaseReadiness ?? null;

  const views = [
    {
      id: "overview" as const,
      label: copy("Overview", "Обзор"),
      description: copy("Database and local data", "База и локальные данные"),
      icon: Server
    },
    {
      id: "backups" as const,
      label: copy("Backups", "Резервные копии"),
      description: copy("Export and release checks", "Экспорт и проверка готовности"),
      icon: Download
    },
    {
      id: "diagnostics" as const,
      label: copy("Diagnostics", "Диагностика"),
      description: copy("Schema, files and migrations", "Схема, файлы и миграции"),
      icon: ShieldCheck
    }
  ];

  function statusLabel(status: string) {
    const labels: Record<string, [string, string]> = {
      ready: ["Ready", "Готово"],
      primary: ["Primary", "Основное"],
      done: ["Done", "Выполнено"],
      pass: ["Passed", "Пройдено"],
      planned: ["Planned", "В планах"],
      external: ["External", "Внешнее"],
      legacy: ["Legacy", "Переходное"],
      warning: ["Warning", "Внимание"],
      review: ["Review", "Проверить"],
      current: ["Current", "Текущий этап"],
      next: ["Next", "Следующий этап"],
      later: ["Later", "Позже"],
      fail: ["Failed", "Ошибка"],
      blocked: ["Blocked", "Заблокировано"],
      needs_migration: ["Migration needed", "Нужна миграция"],
      unknown: ["Unknown", "Неизвестно"]
    };
    const value = labels[status];
    return value ? copy(value[0], value[1]) : status;
  }

  function countCopy(item: StorageAuditResult["counts"][number]) {
    const values: Record<string, { label: [string, string]; note: [string, string] }> = {
      projects: {
        label: ["Projects", "Проекты"],
        note: ["Local project records are stored in the active database.", "Локальные проекты хранятся в активной базе данных."]
      },
      task_packs: {
        label: ["Task Packs", "Пакеты задач"],
        note: ["Generated history is stored through the active adapter.", "История созданных пакетов задач хранится через активный адаптер."]
      },
      project_memories: {
        label: ["Project Memory", "Память проектов"],
        note: ["Long-term project decisions are stored locally.", "Долгосрочные решения проектов хранятся локально."]
      },
      schema_migrations: {
        label: ["Schema migrations", "Миграции схемы"],
        note: ["SQLite changes are versioned and applied incrementally.", "Изменения SQLite версионируются и применяются поэтапно."]
      },
      rules_templates: {
        label: ["Rules and templates", "Правила и шаблоны"],
        note: ["Custom presets are stored in the local catalog.", "Пользовательские пресеты хранятся в локальном каталоге."]
      },
      exports: {
        label: ["Export history", "История экспорта"],
        note: ["History and cleanup controls are planned.", "История и очистка экспортов запланированы."]
      },
      backups: {
        label: ["Workspace backups", "Резервные копии"],
        note: ["Local secret-safe workspace archives.", "Локальные архивы рабочего пространства без секретов."]
      }
    };
    const value = values[item.key];
    return value
      ? { label: copy(...value.label), note: copy(...value.note) }
      : { label: item.label, note: item.note };
  }

  function artifactCopy(item: StorageAuditResult["artifacts"][number]) {
    const values: Record<string, { label: [string, string]; role: [string, string] }> = {
      sqlite_database: {
        label: ["SQLite workspace database", "База рабочего пространства SQLite"],
        role: ["Primary local storage for desktop mode.", "Основное локальное хранилище Desktop."]
      },
      schema_migrations: {
        label: ["SQLite migration ledger", "Журнал миграций SQLite"],
        role: ["Tracks applied migrations and current schema metadata.", "Хранит применённые миграции и текущую версию схемы."]
      },
      rules_templates_sqlite: {
        label: ["Rules and templates catalog", "Каталог правил и шаблонов"],
        role: ["Local adapter-backed catalog for custom presets.", "Локальный каталог пользовательских пресетов через адаптер."]
      },
      rules_templates_json: {
        label: ["Transition JSON catalog", "Переходный JSON-каталог"],
        role: ["Compatibility backup while SQLite remains the primary catalog.", "Резерв совместимости, пока SQLite остаётся основным каталогом."]
      },
      workspace_backups: {
        label: ["Workspace backup folder", "Папка резервных копий"],
        role: ["Stores local JSON backups created from Settings.", "Хранит локальные JSON-копии, созданные из настроек."]
      },
      postgres_driver: {
        label: ["PostgreSQL adapter", "Адаптер PostgreSQL"],
        role: ["Optional developer adapter; desktop does not require it.", "Необязательный адаптер для разработки; Desktop от него не зависит."]
      }
    };
    const value = values[item.key];
    return value
      ? { label: copy(...value.label), role: copy(...value.role) }
      : { label: item.label, role: item.role };
  }

  function gapCopy(item: StorageAuditResult["gaps"][number]) {
    const values: Record<string, { title: [string, string]; description: [string, string] }> = {
      rules_templates_sqlite: {
        title: ["Rules and templates still use JSON", "Правила и шаблоны ещё используют JSON"],
        description: ["Move custom presets into SQLite before beta.", "Перенесите пользовательские пресеты в SQLite до beta-этапа."]
      },
      workspace_restore: {
        title: ["Restore remains guarded", "Восстановление остаётся защищённым"],
        description: ["Import and restore require a separate confirmation-heavy flow.", "Импорт и восстановление требуют отдельного сценария с явными подтверждениями."]
      }
    };
    const value = values[item.key];
    return value
      ? { title: copy(...value.title), description: copy(...value.description) }
      : { title: item.title, description: item.description };
  }

  function releaseCheckCopy(item: NonNullable<StorageAuditResult["releaseReadiness"]>["checks"][number]) {
    const values: Record<string, { label: [string, string]; note: [string, string] }> = {
      sqlite_first: {
        label: ["SQLite-first storage", "Основное хранилище — SQLite"],
        note: ["Normal Desktop mode uses the local SQLite adapter.", "Обычный режим Desktop использует локальный адаптер SQLite."]
      },
      database_ready: {
        label: ["Workspace database exists", "База рабочего пространства создана"],
        note: ["The local workspace database is available.", "Локальная база рабочего пространства доступна."]
      },
      schema_ready: {
        label: ["Schema is up to date", "Схема базы актуальна"],
        note: ["All known migrations are applied.", "Все известные миграции применены."]
      },
      rules_catalog_ready: {
        label: ["Rules and templates use the adapter", "Правила и шаблоны используют адаптер"],
        note: ["Custom presets are stored in the SQLite catalog.", "Пользовательские пресеты хранятся в каталоге SQLite."]
      },
      backup_export_ready: {
        label: ["Backup export is available", "Экспорт резервной копии доступен"],
        note: ["A local backup can be created from Settings.", "Локальную копию можно создать из настроек."]
      },
      backup_created: {
        label: ["At least one backup exists", "Создана хотя бы одна копия"],
        note: ["A recent workspace backup is available.", "Доступна недавняя резервная копия рабочего пространства."]
      },
      restore_guarded: {
        label: ["Restore is guarded", "Восстановление защищено"],
        note: ["Automatic import is intentionally disabled until a safe flow is ready.", "Автоматический импорт намеренно отключён до появления безопасного сценария."]
      }
    };
    const value = values[item.key];
    return value
      ? { label: copy(...value.label), note: copy(...value.note) }
      : { label: item.label, note: item.note };
  }

  function planCopy(item: StorageAuditResult["plan"][number]) {
    const values: Record<string, { title: [string, string]; description: [string, string] }> = {
      "12.1.1": {
        title: ["Storage audit", "Аудит хранилища"],
        description: ["Map local data and migration targets.", "Проверка локальных данных и целей миграции."]
      },
      "12.1.2": {
        title: ["Schema versioning", "Версионирование схемы"],
        description: ["Apply small and safe SQLite migrations.", "Небольшие и безопасные миграции SQLite."]
      },
      "12.2.1": {
        title: ["Rules and templates catalog", "Каталог правил и шаблонов"],
        description: ["Keep custom presets in adapter-backed SQLite storage.", "Хранение пользовательских пресетов в SQLite через адаптер."]
      },
      "12.3.1": {
        title: ["Workspace backup export", "Экспорт резервной копии"],
        description: ["Create a local secret-safe workspace archive.", "Создание локального архива рабочего пространства без секретов."]
      },
      "12.4": {
        title: ["Release checks", "Проверки перед релизом"],
        description: ["Keep a compact readiness checklist for Desktop storage.", "Компактная проверка готовности локального хранилища Desktop."]
      }
    };
    const value = values[item.id];
    return value
      ? { title: copy(...value.title), description: copy(...value.description) }
      : { title: item.title, description: item.description };
  }

  async function handleExportBackup() {
    try {
      setIsBackupExporting(true);
      setBackupError(null);
      const result = await exportWorkspaceBackup();
      setBackupResult(result);
      await onRefresh();
    } catch (error) {
      setBackupResult(null);
      setBackupError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsBackupExporting(false);
    }
  }

  const backupCount = counts.find((item) => item.key === "backups")?.count ?? 0;

  return (
    <>
      <SectionHeader
        icon={<Server size={13} />}
        label={copy("Workspace", "Рабочее пространство")}
        title={copy("Storage and local data", "Хранилище и локальные данные")}
        description={copy("Review the local database, backups and diagnostics without mixing all storage details on one screen.", "Проверяйте локальную базу, резервные копии и диагностику без перегруженного единого отчёта.")}
      />

      <HorizontalSlidingSelector
        items={views}
        activeIndex={views.findIndex((view) => view.id === activeView)}
        getItemKey={(view) => view.id}
        onSelect={(view) => setActiveView(view.id)}
        ariaLabel={copy("Storage view", "Раздел хранилища")}
        itemClassName="rounded-[0.95rem] text-left"
        renderItem={(view, isActive) => {
          const Icon = view.icon;
          return (
            <div className="flex h-full items-center gap-3 px-4 py-3 text-left">
              <span className={[
                "grid size-8 shrink-0 place-items-center rounded-xl border transition-colors",
                isActive ? "border-black/10 bg-black/5 text-black" : "border-neutral-800 bg-neutral-950 text-neutral-500"
              ].join(" ")}>
                <Icon size={14} />
              </span>
              <span className="min-w-0">
                <span className={[
                  "block text-sm font-semibold",
                  isActive ? "text-black" : "text-white"
                ].join(" ")}>
                  {view.label}
                </span>
                <span className={[
                  "mt-0.5 block text-xs",
                  isActive ? "text-black/55" : "text-neutral-600"
                ].join(" ")}>
                  {view.description}
                </span>
              </span>
            </div>
          );
        }}
      />

      {!audit ? (
        <SettingCard
          icon={<Server size={18} />}
          label={copy("Storage audit", "Аудит хранилища")}
          title={loading ? copy("Loading local data", "Загружаем локальные данные") : copy("Storage audit is not loaded", "Аудит хранилища не загружен")}
          description={copy("Refresh the audit to inspect the local database and backups.", "Обновите аудит, чтобы проверить локальную базу и резервные копии.")}
          storageId="storage-loading-v2"
        >
          <SettingsActionButton
            icon={RefreshCw}
            label={copy("Refresh audit", "Обновить аудит")}
            loadingLabel={copy("Refreshing", "Обновляем")}
            loading={loading}
            disabled={loading}
            variant="secondary"
            onClick={onRefresh}
          />
        </SettingCard>
      ) : (
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={activeView}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={PAGE_TRANSITION}
            className="space-y-5"
          >
            {activeView === "overview" && (
              <>
                <SettingCard
                  icon={<Server size={18} />}
                  label={copy("Local database", "Локальная база")}
                  title={copy("Workspace storage is ready", "Хранилище рабочего пространства готово")}
                  description={copy("A compact overview of the active adapter, database, schema and stored workspace data.", "Компактный обзор активного адаптера, базы, схемы и сохранённых данных рабочего пространства.")}
                  storageId="storage-overview-v2"
                >
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap gap-2">
                      <span className="cf-badge">{audit.driver}</span>
                      <span className="cf-badge">{audit.sqliteFirst ? copy("SQLite-first", "SQLite — основное") : copy("Custom driver", "Другой драйвер")}</span>
                      <span className="cf-badge">{copy("Updated", "Обновлено")}: {formatDateTime(audit.generatedAt)}</span>
                    </div>
                    <SettingsActionButton
                      icon={RefreshCw}
                      label={copy("Refresh", "Обновить")}
                      loadingLabel={copy("Refreshing", "Обновляем")}
                      loading={loading}
                      disabled={loading}
                      variant="secondary"
                      onClick={onRefresh}
                    />
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {[
                      { label: copy("Adapter", "Адаптер"), value: audit.driver, note: copy("active storage", "активное хранилище") },
                      { label: copy("Database", "База данных"), value: audit.databaseExists ? copy("Ready", "Готова") : copy("Missing", "Не найдена"), note: formatStorageBytes(audit.databaseSizeBytes) },
                      { label: copy("Schema", "Схема"), value: schema ? `v${schema.currentVersion}` : "—", note: schema?.pendingCount ? copy(`${schema.pendingCount} pending`, `Ожидает: ${schema.pendingCount}`) : copy("up to date", "актуальна") },
                      { label: copy("Attention", "Требует внимания"), value: String(gaps.length), note: copy("storage items", "пунктов хранилища") }
                    ].map((item) => (
                      <div key={item.label} className="rounded-2xl border border-neutral-900 bg-black/40 p-4">
                        <p className="cf-tech-label text-[10px] uppercase text-neutral-600">{item.label}</p>
                        <p className="mt-2 text-xl font-semibold text-white">{item.value}</p>
                        <p className="mt-1 text-xs text-neutral-600">{item.note}</p>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {counts.map((item) => {
                      const localized = countCopy(item);
                      return (
                        <div key={item.key} className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-white">{localized.label}</p>
                              <p className="mt-1 text-xs leading-5 text-neutral-600">{localized.note}</p>
                            </div>
                            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${storageStatusClasses(item.status)}`}>
                              {statusLabel(item.status)}
                            </span>
                          </div>
                          <p className="mt-3 text-2xl font-semibold text-white">{item.count ?? "—"}</p>
                        </div>
                      );
                    })}
                  </div>
                </SettingCard>

                {gaps.length > 0 && (
                  <SettingCard
                    icon={<ShieldCheck size={18} />}
                    label={copy("Attention", "Требует внимания")}
                    title={copy("Small storage tasks remain", "Остались небольшие задачи хранилища")}
                    description={copy("These items do not block normal local work.", "Эти пункты не блокируют обычную локальную работу.")}
                    defaultOpen={false}
                    storageId="storage-attention-v2"
                  >
                    <div className="grid gap-3 md:grid-cols-2">
                      {gaps.map((gap) => {
                        const localized = gapCopy(gap);
                        return (
                          <div key={gap.key} className="rounded-2xl border border-neutral-900 bg-black/40 p-4">
                            <div className="flex items-start justify-between gap-3">
                              <p className="text-sm font-semibold text-white">{localized.title}</p>
                              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${storageStatusClasses(gap.priority === "now" ? "current" : gap.priority)}`}>
                                {statusLabel(gap.priority)}
                              </span>
                            </div>
                            <p className="mt-2 text-xs leading-5 text-neutral-600">{localized.description}</p>
                          </div>
                        );
                      })}
                    </div>
                  </SettingCard>
                )}
              </>
            )}

            {activeView === "backups" && (
              <>
                <SettingCard
                  icon={<Download size={18} />}
                  label={copy("Workspace backup", "Резервная копия")}
                  title={copy("Export local workspace data", "Экспортируйте локальные данные")}
                  description={copy("Create a secret-safe JSON archive of projects, Task Packs, Project Memory, rules and settings.", "Создайте безопасный JSON-архив проектов, пакетов задач, памяти проектов, правил и настроек без секретов.")}
                  storageId="storage-backup-v2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-neutral-900 bg-black/35 p-4">
                    <div>
                      <p className="text-sm font-semibold text-white">{copy("Available backups", "Доступно резервных копий")}</p>
                      <p className="mt-1 text-2xl font-semibold text-white">{backupCount}</p>
                    </div>
                    <Button onClick={handleExportBackup} disabled={isBackupExporting}>
                      {isBackupExporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                      {isBackupExporting ? copy("Creating backup", "Создаём копию") : copy("Create backup", "Создать резервную копию")}
                    </Button>
                  </div>

                  {backupResult && (
                    <div className="mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
                      <p className="text-sm font-semibold text-emerald-100">{copy("Backup created", "Резервная копия создана")}</p>
                      <p className="mt-1 break-all text-xs leading-5 text-emerald-200/70">{backupResult.filePath}</p>
                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-emerald-100/70">
                        <span>{copy("Projects", "Проекты")}: {backupResult.counts.projects}</span>
                        <span>{copy("Task Packs", "Пакеты задач")}: {backupResult.counts.taskPacks}</span>
                        <span>{copy("Memory", "Память")}: {backupResult.counts.projectMemories}</span>
                        <span>{copy("Rules", "Правила")}: {backupResult.counts.ruleTemplates}</span>
                        <span>{copy("Settings", "Настройки")}: {backupResult.counts.settings}</span>
                      </div>
                    </div>
                  )}

                  {backupError && (
                    <div className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-400/10 p-4">
                      <p className="text-sm font-semibold text-rose-100">{copy("Backup export failed", "Не удалось создать резервную копию")}</p>
                      <p className="mt-1 text-xs leading-5 text-rose-200/70">{backupError}</p>
                    </div>
                  )}
                </SettingCard>

                {releaseReadiness && (
                  <SettingCard
                    icon={<ShieldCheck size={18} />}
                    label={copy("Desktop readiness", "Готовность Desktop")}
                    title={copy("Local storage release checks", "Проверки локального хранилища перед релизом")}
                    description={copy(`${releaseReadiness.passed} passed · ${releaseReadiness.warnings} warnings · ${releaseReadiness.failed} blocked`, `Пройдено: ${releaseReadiness.passed} · предупреждений: ${releaseReadiness.warnings} · заблокировано: ${releaseReadiness.failed}`)}
                    defaultOpen={false}
                    storageId="storage-release-checks-v2"
                  >
                    <div className="grid gap-2 md:grid-cols-2">
                      {releaseReadiness.checks.map((check) => {
                        const localized = releaseCheckCopy(check);
                        return (
                          <div key={check.key} className="rounded-2xl border border-neutral-900 bg-black/35 p-3">
                            <div className="flex items-start justify-between gap-3">
                              <p className="text-xs font-semibold text-white">{localized.label}</p>
                              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${storageStatusClasses(check.status)}`}>
                                {statusLabel(check.status)}
                              </span>
                            </div>
                            <p className="mt-1 text-xs leading-5 text-neutral-600">{localized.note}</p>
                          </div>
                        );
                      })}
                    </div>
                  </SettingCard>
                )}
              </>
            )}

            {activeView === "diagnostics" && (
              <>
                <SettingCard
                  icon={<Server size={18} />}
                  label={copy("Database schema", "Схема базы")}
                  title={copy("SQLite versioning and migrations", "Версионирование и миграции SQLite")}
                  description={schema
                    ? copy(`Schema v${schema.currentVersion} of v${schema.latestVersion}; ${schema.appliedCount} migrations applied.`, `Схема v${schema.currentVersion} из v${schema.latestVersion}; применено миграций: ${schema.appliedCount}.`)
                    : copy("Schema metadata is unavailable for this adapter.", "Данные схемы недоступны для этого адаптера.")}
                  storageId="storage-schema-v2"
                >
                  {schema ? (
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
                        <p className="cf-tech-label text-[10px] uppercase text-neutral-600">{copy("Current version", "Текущая версия")}</p>
                        <p className="mt-2 text-xl font-semibold text-white">v{schema.currentVersion}</p>
                      </div>
                      <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
                        <p className="cf-tech-label text-[10px] uppercase text-neutral-600">{copy("Applied", "Применено")}</p>
                        <p className="mt-2 text-xl font-semibold text-white">{schema.appliedCount}</p>
                      </div>
                      <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
                        <p className="cf-tech-label text-[10px] uppercase text-neutral-600">{copy("Pending", "Ожидает")}</p>
                        <p className="mt-2 text-xl font-semibold text-white">{schema.pendingCount}</p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-neutral-500">{copy("No schema data.", "Нет данных схемы.")}</p>
                  )}
                </SettingCard>

                <SettingCard
                  icon={<Layers3 size={18} />}
                  label={copy("Local data sources", "Локальные источники")}
                  title={copy("Files and adapters", "Файлы и адаптеры")}
                  description={copy(`${artifacts.length} storage artifacts detected.`, `Обнаружено источников: ${artifacts.length}.`)}
                  defaultOpen={false}
                  storageId="storage-artifacts-v2"
                >
                  <div className="grid gap-3 md:grid-cols-2">
                    {artifacts.map((artifact) => {
                      const localized = artifactCopy(artifact);
                      return (
                        <div key={artifact.key} className="rounded-2xl border border-neutral-900 bg-black/40 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-white">{localized.label}</p>
                              <p className="mt-1 break-all text-xs leading-5 text-neutral-700">{artifact.path}</p>
                            </div>
                            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${storageStatusClasses(artifact.migrationStatus)}`}>
                              {statusLabel(artifact.migrationStatus)}
                            </span>
                          </div>
                          <p className="mt-3 text-xs leading-5 text-neutral-600">{localized.role}</p>
                          <p className="mt-2 text-xs text-neutral-700">{artifact.exists ? copy("Found", "Найдено") : copy("Not found", "Не найдено")} · {formatStorageBytes(artifact.sizeBytes)}</p>
                        </div>
                      );
                    })}
                  </div>
                </SettingCard>

                <SettingCard
                  icon={<Sparkles size={18} />}
                  label={copy("Development plan", "План развития")}
                  title={copy("Storage migration order", "Порядок развития хранилища")}
                  description={copy("Small, reversible storage steps with visible status.", "Небольшие обратимые этапы развития хранилища с понятным статусом.")}
                  defaultOpen={false}
                  storageId="storage-plan-v2"
                >
                  <div className="space-y-2">
                    {plan.map((step) => {
                      const localized = planCopy(step);
                      return (
                        <div key={step.id} className="flex items-start justify-between gap-4 rounded-2xl border border-neutral-900 bg-black/40 p-4">
                          <div>
                            <p className="text-sm font-semibold text-white">{step.id} · {localized.title}</p>
                            <p className="mt-1 text-xs leading-5 text-neutral-600">{localized.description}</p>
                          </div>
                          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${storageStatusClasses(step.status)}`}>
                            {statusLabel(step.status)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </SettingCard>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      )}
    </>
  );
}

export function SettingsPage() {
  const { t } = useTranslation();
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("general");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<AppSettings | null>(null);
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null);
  const [storageAudit, setStorageAudit] = useState<StorageAuditResult | null>(null);
  const [isStorageAuditLoading, setIsStorageAuditLoading] = useState(false);
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [selectorDiagnosticsHistory, setSelectorDiagnosticsHistory] = useState<SelectorPipelineDiagnostics[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeAction, setActiveAction] = useState<"refresh" | "save" | null>(null);
  const [isLanguageSaving, setIsLanguageSaving] = useState(false);
  const [languageSaveFailed, setLanguageSaveFailed] = useState(false);
  const languageSaveRequestRef = useRef(0);

  const hasUnsavedChanges = useMemo(() => {
    return !isSameSettings(settings, settingsDraft);
  }, [settings, settingsDraft]);

  const composerLimits = settingsDraft?.composerFileLimits ?? DEFAULT_COMPOSER_FILE_LIMITS;
  const composerLimitValues = Object.values(composerLimits) as number[];
  const activePresetId = getActivePreset(composerLimits)?.id;
  const currentLanguage = (settingsDraft?.language ?? "system") as AppLanguage;
  const resolvedLanguage = resolveAppLanguage(currentLanguage);
  const settingsDateTimeFormatter = useMemo(
    () => new Intl.DateTimeFormat(resolvedLanguage === "ru" ? "ru-RU" : "en-US", {
      dateStyle: "medium",
      timeStyle: "short"
    }),
    [resolvedLanguage]
  );
  const formatSettingsDateTime = (value: string | number | Date) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : settingsDateTimeFormatter.format(date);
  };
  const defaultModelOptions = useMemo(() => {
    const currentModel = settingsDraft?.defaultOllamaModel ?? "";
    const hasCurrentModel = Boolean(currentModel) && models.some((model) => model.name === currentModel);

    return [
      {
        value: "",
        label: t("settings.noModelSelected"),
        description: t("settings.useTemplateOnly")
      },
      ...(currentModel && !hasCurrentModel
        ? [{
            value: currentModel,
            label: currentModel,
            description: t("settings.customModel")
          }]
        : []),
      ...models.map((model) => ({
        value: model.name,
        label: model.name,
        description: `${model.model ?? t("settings.localModel")} - ${formatModelSize(model.size)}`
      }))
    ];
  }, [models, settingsDraft?.defaultOllamaModel, t]);

  const clarificationOptions = useMemo(
    () => [
      {
        value: "automatic" as const,
        label: t("settings.clarificationModeAutomatic"),
        caption: t("settings.clarificationModeAutomaticDesc")
      },
      {
        value: "balanced" as const,
        label: t("settings.clarificationModeBalanced"),
        caption: t("settings.clarificationModeBalancedDesc")
      },
      {
        value: "confirm_all" as const,
        label: t("settings.clarificationModeConfirmAll"),
        caption: t("settings.clarificationModeConfirmAllDesc")
      }
    ],
    [t]
  );

  const selectorModeOptions = useMemo(
    () =>
      SELECTOR_PIPELINE_MODES.map((value) => ({
        value,
        ...getSelectorModeCopy(value, t)
      })),
    [t]
  );

  const contextQualityOptions = useMemo(() => [
    {
      value: "advisory" as const,
      label: t("settings.contextQualityAdvisory"),
      caption: t("settings.contextQualityAdvisoryDesc")
    },
    {
      value: "balanced" as const,
      label: t("settings.contextQualityBalanced"),
      caption: t("settings.contextQualityBalancedDesc")
    },
    {
      value: "strict" as const,
      label: t("settings.contextQualityStrict"),
      caption: t("settings.contextQualityStrictDesc")
    }
  ], [t]);

  const composerLimitPresets = useMemo(() =>
    COMPOSER_LIMIT_PRESETS.map((preset) => ({
      ...preset,
      label: t(`settings.composerPreset.${preset.id}.label`),
      caption: t(`settings.composerPreset.${preset.id}.caption`)
    })),
    [t]
  );

  const composerLimitRows = useMemo(() =>
    COMPOSER_LIMIT_ROWS.map((row) => ({
      ...row,
      label: t(`settings.composerLimit.${row.key}.label`),
      caption: t(`settings.composerLimit.${row.key}.caption`)
    })),
    [t]
  );

  const activePreset = composerLimitPresets.find((preset) => preset.id === activePresetId);

  const targetToolOptions = useMemo(() =>
    TARGET_TOOL_OPTIONS.map((option) => ({
      ...option,
      description: t(`settings.targetTool.${option.value}`)
    })),
    [t]
  );


  const interfaceLanguageOptions = useMemo(
    () => [
      {
        value: "system" as const,
        label: t("settings.languageSystem"),
        caption: t("settings.languageSystemDescription"),
        meta: resolvedLanguage.toUpperCase(),
        icon: Settings
      },
      {
        value: "en" as const,
        label: t("settings.languageEnglish"),
        caption: t("settings.languageEnglishDescription"),
        meta: "EN",
        icon: Languages
      },
      {
        value: "ru" as const,
        label: t("settings.languageRussian"),
        caption: t("settings.languageRussianDescription"),
        meta: "RU",
        icon: Languages
      }
    ],
    [resolvedLanguage, t]
  );

  const navigationDensityOptions = useMemo(
    () => [
      {
        value: false,
        label: t("settings.navigationCompact"),
        caption: t("settings.navigationCompactDescription"),
        meta: t("settings.recommendedChoice"),
        icon: PanelLeft
      },
      {
        value: true,
        label: t("settings.navigationGuided"),
        caption: t("settings.navigationGuidedDescription"),
        meta: t("settings.guided"),
        icon: MessageSquareText
      }
    ],
    [t]
  );

  const launchExperienceOptions = useMemo(
    () => [
      {
        value: "workspace" as const,
        label: t("settings.launchDirect"),
        caption: t("settings.launchDirectDescription"),
        meta: t("settings.fastest"),
        icon: Gauge
      },
      {
        value: "first-run" as const,
        label: t("settings.launchFirstRun"),
        caption: t("settings.launchFirstRunDescription"),
        meta: t("settings.recommendedChoice"),
        icon: Sparkles
      },
      {
        value: "every-launch" as const,
        label: t("settings.launchEveryTime"),
        caption: t("settings.launchEveryTimeDescription"),
        meta: t("settings.alpha"),
        icon: RefreshCw
      }
    ],
    [t]
  );

  const launchExperienceMode = settingsDraft?.onboardingEnabled === false
    ? "workspace"
    : settingsDraft?.onboardingShowEveryLaunch === false
      ? "first-run"
      : "every-launch";

  async function handleLanguageChange(language: AppLanguage) {
    if (!settings || !settingsDraft || language === currentLanguage || isLanguageSaving) {
      return;
    }

    const requestId = ++languageSaveRequestRef.current;
    const previousLanguage = (settings.language ?? "system") as AppLanguage;
    const nextPersistedSettings = withSettingsDefaults({
      ...settings,
      language
    });

    setLanguageSaveFailed(false);
    setIsLanguageSaving(true);
    setSettings(nextPersistedSettings);
    setSettingsDraft((current) => current ? { ...current, language } : current);
    void applyAppLanguage(language);

    try {
      const updatedSettings = withSettingsDefaults(
        await updateAppSettings(nextPersistedSettings)
      );

      if (languageSaveRequestRef.current !== requestId) {
        return;
      }

      setSettings(updatedSettings);
      setSettingsDraft((current) => current
        ? { ...current, language: updatedSettings.language ?? language }
        : updatedSettings
      );
      window.dispatchEvent(
        new CustomEvent("contextforge:settings-updated", {
          detail: updatedSettings
        })
      );
    } catch (error) {
      if (languageSaveRequestRef.current !== requestId) {
        return;
      }

      console.error("Failed to save application language", error);
      setLanguageSaveFailed(true);
      setSettings((current) => current ? { ...current, language: previousLanguage } : current);
      setSettingsDraft((current) => current ? { ...current, language: previousLanguage } : current);
      void applyAppLanguage(previousLanguage);
    } finally {
      if (languageSaveRequestRef.current === requestId) {
        setIsLanguageSaving(false);
      }
    }
  }

  function updateSettingsDraft(patch: Partial<AppSettings>) {
    setSettingsDraft((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        ...patch
      };
    });
  }

  function updateComposerLimits(nextLimits: AppSettings["composerFileLimits"]) {
    updateSettingsDraft({
      composerFileLimits: nextLimits
    });
  }

  function updateComposerLimit(key: ComposerLimitKey, value: number) {
    updateComposerLimits({
      ...composerLimits,
      [key]: clampLimit(value)
    });
  }

  async function loadOllamaInfo() {
    try {
      setIsLoading(true);
      setActiveAction("refresh");

      const [appSettings, status, modelList, diagnosticsHistory] = await Promise.all([
        getAppSettings(),
        getOllamaStatus(),
        getOllamaModels(),
        getSelectorDiagnosticsHistory().catch((error) => {
          console.warn("Failed to load optional selector diagnostics history", error);
          return [];
        })
      ]);

      const normalizedSettings = withSettingsDefaults(appSettings);

      setSettings(normalizedSettings);
      setSettingsDraft(normalizedSettings);
      void applyAppLanguage(normalizedSettings.language ?? "system");
      setOllamaStatus(status);
      setModels(modelList);
      setSelectorDiagnosticsHistory(diagnosticsHistory);

    } catch (error) {
      console.error("Failed to refresh settings", error);
    } finally {
      setIsLoading(false);
      setActiveAction(null);
    }
  }

  async function loadStorageAudit() {
    try {
      setIsStorageAuditLoading(true);
      const audit = await getStorageAudit();
      setStorageAudit(audit);
    } catch (error) {
      console.error("Failed to load storage audit", error);
    } finally {
      setIsStorageAuditLoading(false);
    }
  }

  async function handleSaveSettings() {
    if (!settingsDraft) {
      return;
    }

    try {
      setIsLoading(true);
      setActiveAction("save");

      const updatedSettings = withSettingsDefaults(
        await updateAppSettings(settingsDraft)
      );

      setSettings(updatedSettings);
      setSettingsDraft(updatedSettings);
      void applyAppLanguage(updatedSettings.language ?? "system");
      window.dispatchEvent(
        new CustomEvent("contextforge:settings-updated", {
          detail: updatedSettings
        })
      );

      const [status, modelList] = await Promise.all([
        getOllamaStatus(),
        getOllamaModels()
      ]);

      setOllamaStatus(status);
      setModels(modelList);


    } catch (error) {
      console.error("Failed to save settings", error);
    } finally {
      setIsLoading(false);
      setActiveAction(null);
    }
  }

  async function handleClearSelectorDiagnostics() {
    try {
      await clearSelectorDiagnosticsHistory();
      setSelectorDiagnosticsHistory([]);
    } catch (error) {
      console.error("Failed to clear selector diagnostics", error);
    }
  }

  useEffect(() => {
    loadOllamaInfo();
  }, []);

  useEffect(() => {
    if (activeSection === "storage" && !storageAudit && !isStorageAuditLoading) {
      void loadStorageAudit();
    }
  }, [activeSection, storageAudit, isStorageAuditLoading]);


  return (
    <section className="settings-page space-y-5 text-render-crisp">
      <WorkspacePageHeader
        icon={<Settings size={18} />}
        eyebrow={t("settings.workspaceEyebrow")}
        title={t("settings.workspaceTitle")}
        description={t("settings.workspaceDescription")}
        aside={
          <div className="flex flex-wrap items-center justify-end gap-3">
            <span className="hidden rounded-full border border-neutral-900 bg-black/35 px-3 py-1.5 text-xs text-neutral-600 2xl:inline-flex">
              {getSettingsSectionLabel(SETTINGS_SECTIONS.find((section) => section.id === activeSection) ?? SETTINGS_SECTIONS[0], t)}
            </span>
            <SettingsActionButton
              icon={RefreshCw}
              label={t("common.refresh")}
              loadingLabel={t("common.refreshing")}
              loading={activeAction === "refresh"}
              disabled={isLoading}
              variant="secondary"
              onClick={loadOllamaInfo}
            />
            <AnimatePresence mode="wait" initial={false}>
              {hasUnsavedChanges ? (
                <motion.div
                  key="save-action"
                  initial={{ opacity: 0, x: 6 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 6 }}
                  transition={{ duration: 0.16 }}
                >
                  <SettingsActionButton
                    icon={Save}
                    label={t("common.saveChanges")}
                    loadingLabel={t("common.saving")}
                    loading={activeAction === "save"}
                    disabled={isLoading || isLanguageSaving || !settingsDraft}
                    variant="primary"
                    pulse
                    onClick={handleSaveSettings}
                  />
                </motion.div>
              ) : (
                <motion.div
                  key="saved-state"
                  role="status"
                  initial={{ opacity: 0, x: 6 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 6 }}
                  transition={{ duration: 0.16 }}
                  className="inline-flex h-10 items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-4 text-sm text-emerald-200"
                >
                  <CheckCircle2 size={15} />
                  {t("settings.allChangesSaved")}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[260px_minmax(0,1fr)]">
        <SettingsSidebar
          activeSection={activeSection}
          hasUnsavedChanges={hasUnsavedChanges}
          onChange={setActiveSection}
        />

        <div className="min-w-0">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={activeSection}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={PAGE_TRANSITION}
              className="space-y-5"
              style={{ willChange: "opacity" }}
            >
              {activeSection === "ai" && (
                <>
                  <SectionHeader
                    icon={<Bot size={13} />}
                    label={t("settings.aiEngine")}
                    title={t("settings.aiTitle")}
                    description={t("settings.aiDescription")}
                  />

                  <SettingCard
                    icon={<Bot size={18} />}
                    label={t("settings.aiEngine")}
                    title={t("settings.ollamaIntegration")}
                    description={t("settings.ollamaIntegrationDesc")}
                  >
                    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                      <StatusBadge status={ollamaStatus} />

                      <span className="text-xs text-neutral-600">
                        {ollamaStatus?.url ?? settingsDraft?.ollamaUrl ?? t("settings.noUrl")}
                      </span>
                    </div>

                    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(260px,0.7fr)]">
                      <div className="rounded-2xl border border-neutral-900 bg-black/40 p-4">
                        <label className="cf-tech-label text-[10px] uppercase text-neutral-600">
                          {t("settings.ollamaUrl")}
                        </label>

                        <input
                          value={settingsDraft?.ollamaUrl ?? ""}
                          onChange={(event) =>
                            updateSettingsDraft({
                              ollamaUrl: event.target.value
                            })
                          }
                          className="cf-input mt-3"
                          placeholder="http://localhost:11434"
                        />
                      </div>

                      <div className="rounded-2xl border border-neutral-900 bg-black/40 p-4">
                        <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                          {t("settings.statusMessage")}
                        </p>

                        <p className="mt-3 text-sm leading-6 text-neutral-300">
                          {ollamaStatus?.online ? t("settings.ollamaAvailable") : (ollamaStatus?.message ?? t("settings.checkingOllama"))}
                        </p>
                      </div>
                    </div>
                  </SettingCard>

                  <SettingCard
                    icon={<Server size={18} />}
                    label={t("settings.localModels")}
                    title={t("settings.detectedModels")}
                    description={t("settings.detectedModelsDesc")}
                  >
                    {models.length === 0 ? (
                      <div className="rounded-2xl border border-neutral-900 bg-black/40 p-5">
                        <p className="text-sm font-medium text-white">
                          {t("settings.noModels")}
                        </p>

                        <p className="mt-2 text-sm leading-6 text-neutral-500">
                          {t("settings.pullModelFirst")}
                        </p>

                        <pre className="mt-4 overflow-auto rounded-xl border border-neutral-900 bg-black p-4 text-sm text-neutral-300">
                          ollama pull llama3.1{"\n"}ollama pull gemma3:4b
                        </pre>
                      </div>
                    ) : (
                      <div className="overflow-x-auto pb-1">
                        <HorizontalSlidingSelector
                          items={models}
                          activeIndex={models.findIndex(
                            (model) =>
                              settingsDraft?.defaultOllamaModel === model.name
                          )}
                          getItemKey={(model) => model.name}
                          onSelect={(model) =>
                            updateSettingsDraft({
                              defaultOllamaModel: model.name
                            })
                          }
                          ariaLabel={t("settings.detectedModels")}
                          className={
                            models.length > 2
                              ? "min-w-[840px]"
                              : "min-w-[560px]"
                          }
                          itemClassName="rounded-[0.95rem] text-left"
                          renderItem={(model, isSelected) => (
                            <div className="flex h-full items-center gap-3 px-4 py-3 text-left">
                              <span
                                className={[
                                  "grid size-9 shrink-0 place-items-center rounded-xl border transition-colors duration-150",
                                  isSelected
                                    ? "border-black/10 bg-black/5 text-black"
                                    : "border-neutral-800 bg-neutral-950 text-neutral-500 group-hover:border-white/15 group-hover:text-white"
                                ].join(" ")}
                              >
                                <Cpu size={15} />
                              </span>

                              <span className="min-w-0 flex-1">
                                <span
                                  className={[
                                    "block truncate text-sm font-semibold transition-colors duration-150",
                                    isSelected
                                      ? "text-black"
                                      : "text-white group-hover:text-white"
                                  ].join(" ")}
                                >
                                  {model.name}
                                </span>

                                <span
                                  className={[
                                    "mt-0.5 block truncate text-xs transition-colors duration-150",
                                    isSelected
                                      ? "text-black/55"
                                      : "text-neutral-600 group-hover:text-neutral-400"
                                  ].join(" ")}
                                >
                                  {model.model ?? "local model"} ·{" "}
                                  {formatModelSize(model.size)}
                                </span>
                              </span>
                            </div>
                          )}
                        />
                      </div>
                    )}
                  </SettingCard>
                </>
              )}

              {activeSection === "generation" && (
                <>
                  <SectionHeader
                    icon={<SlidersHorizontal size={13} />}
                    label={t("settings.generation")}
                    title={t("settings.generationTitle")}
                    description={t("settings.generationDescription")}
                  />

                  <div className="grid items-start gap-5">
                    <SettingCard
                      icon={<SlidersHorizontal size={18} />}
                      label={t("settings.generationPreferences")}
                      title={t("settings.defaultTaskPackBehavior")}
                      description={t("settings.defaultTaskPackBehaviorDesc")}
                    >
                      <div className="grid gap-4 md:grid-cols-2">
                        <div>
                          <label className="mb-2 block text-sm text-neutral-400">
                            {t("settings.generationMode")}
                          </label>

                          <CustomSelect
                            value={settingsDraft?.generationMode ?? "template"}
                            onChange={(value) =>
                              updateSettingsDraft({
                                generationMode:
                                  value as AppSettings["generationMode"]
                              })
                            }
                            options={[
                              {
                                value: "template",
                                label: t("settings.template"),
                                description: t("settings.templateDesc")
                              },
                              {
                                value: "ollama",
                                label: t("settings.ollamaAssisted"),
                                description: t("settings.ollamaAssistedDesc")
                              }
                            ]}
                          />
                        </div>

                        <div>
                          <label className="mb-2 block text-sm text-neutral-400">
                            {t("settings.defaultTargetTool")}
                          </label>

                          <CustomSelect
                            value={settingsDraft?.defaultTargetTool ?? "codex"}
                            onChange={(value) =>
                              updateSettingsDraft({
                                defaultTargetTool:
                                  value as AppSettings["defaultTargetTool"]
                              })
                            }
                            options={targetToolOptions}
                          />
                        </div>

                        <div>
                          <label className="mb-2 block text-sm text-neutral-400">
                            {t("settings.defaultTaskType")}
                          </label>

                          <CustomSelect
                            value={settingsDraft?.defaultTaskType ?? "general"}
                            onChange={(value) =>
                              updateSettingsDraft({
                                defaultTaskType:
                                  value as AppSettings["defaultTaskType"]
                              })
                            }
                            options={[
                              { value: "general", label: t("settings.taskType.general.label"), description: t("settings.taskType.general.description") },
                              { value: "ui", label: t("settings.taskType.ui.label"), description: t("settings.taskType.ui.description") },
                              { value: "backend", label: t("settings.taskType.backend.label"), description: t("settings.taskType.backend.description") },
                              { value: "fullstack", label: t("settings.taskType.fullstack.label"), description: t("settings.taskType.fullstack.description") },
                              { value: "build", label: t("settings.taskType.build.label"), description: t("settings.taskType.build.description") },
                              { value: "bugfix", label: t("settings.taskType.bugfix.label"), description: t("settings.taskType.bugfix.description") },
                              { value: "refactor", label: t("settings.taskType.refactor.label"), description: t("settings.taskType.refactor.description") },
                              { value: "docs", label: t("settings.taskType.docs.label"), description: t("settings.taskType.docs.description") },
                              { value: "tests", label: t("settings.taskType.tests.label"), description: t("settings.taskType.tests.description") }
                            ]}
                          />
                        </div>

                        <div>
                          <label className="mb-2 block text-sm text-neutral-400">
                            {t("settings.defaultOllamaModel")}
                          </label>

                          <CustomSelect
                            value={settingsDraft?.defaultOllamaModel ?? ""}
                            onChange={(value) =>
                              updateSettingsDraft({
                                defaultOllamaModel: value || null
                              })
                            }
                            options={defaultModelOptions}
                          />
                        </div>
                      </div>
                    </SettingCard>

                    <SettingCard
                      icon={<Sparkles size={18} />}
                      label={t("settings.generationModes")}
                      title={t("settings.templateVsOllama")}
                      description={t("settings.templateVsOllamaDesc")}
                      defaultOpen={false}
                      storageId="generation-mode-guide-v2"
                    >
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-4">
                          <div className="flex items-start gap-3">
                            <CheckCircle2
                              size={16}
                              className="mt-0.5 text-emerald-300"
                            />

                            <div>
                              <p className="text-sm font-medium text-white">
                                {t("settings.templateMode")}
                              </p>

                              <p className="mt-1 text-sm leading-5 text-neutral-500">
                                {t("settings.templateModeDesc")}
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-neutral-900 bg-black/40 p-4">
                          <div className="flex items-start gap-3">
                            {ollamaStatus?.online ? (
                              <CheckCircle2
                                size={16}
                                className="mt-0.5 text-emerald-300"
                              />
                            ) : (
                              <XCircle
                                size={16}
                                className="mt-0.5 text-red-400"
                              />
                            )}

                            <div>
                              <p className="text-sm font-medium text-white">
                                {t("settings.ollamaMode")}
                              </p>

                              <p className="mt-1 text-sm leading-5 text-neutral-500">
                                {t("settings.ollamaModeDesc")}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </SettingCard>

                    <SettingCard
                      icon={<MessageSquareText size={18} />}
                      label={t("settings.taskUnderstandingBehavior")}
                      title={t("settings.clarificationModeTitle")}
                      description={t("settings.clarificationModeDescription")}
                    >
                      <HorizontalSlidingSelector
                        items={clarificationOptions}
                        activeIndex={clarificationOptions.findIndex(
                          (option) =>
                            option.value ===
                            (settingsDraft?.taskUnderstandingInteractionMode ??
                              "balanced")
                        )}
                        getItemKey={(option) => option.value}
                        onSelect={(option) =>
                          updateSettingsDraft({
                            taskUnderstandingInteractionMode: option.value
                          })
                        }
                        ariaLabel={t("settings.clarificationModeTitle")}
                        itemClassName="rounded-[0.95rem] text-left"
                        renderItem={(option, isActive) => (
                          <SettingsChoiceCardContent
                            icon={MessageSquareText}
                            label={option.label}
                            caption={option.caption}
                            isActive={isActive}
                          />
                        )}
                      />

                      <p className="mt-4 text-xs leading-5 text-neutral-600">
                        {t("settings.clarificationModeSafetyNote")}
                      </p>
                    </SettingCard>
                  </div>
                </>
              )}

              {activeSection === "composer" && (
                <>
                  <SectionHeader
                    icon={<WandSparkles size={13} />}
                    label={t("settings.composer")}
                    title={t("settings.composerTitle")}
                    description={t("settings.composerDescription")}
                  />


                  <SettingCard
                    icon={<Layers3 size={18} />}
                    label={t("settings.selectorExperimentalLabel")}
                    title={t("settings.selectorRolloutTitle")}
                    description={t("settings.selectorRolloutDescription")}
                  >
                    <HorizontalSlidingSelector
                      items={selectorModeOptions}
                      activeIndex={selectorModeOptions.findIndex(
                        (option) =>
                          option.value ===
                          (settingsDraft?.selectorPipelineMode ?? "legacy")
                      )}
                      getItemKey={(option) => option.value}
                      onSelect={(option) =>
                        updateSettingsDraft({
                          selectorPipelineMode: option.value
                        })
                      }
                      ariaLabel={t("settings.selectorRolloutTitle")}
                      itemClassName="rounded-[0.95rem] text-left"
                      renderItem={(option, isActive) => (
                        <SettingsChoiceCardContent
                          icon={Layers3}
                          label={option.label}
                          caption={option.description}
                          isActive={isActive}
                        />
                      )}
                    />

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-neutral-900 bg-black/35 p-4">
                      <div>
                        <p className="text-sm font-medium text-white">{t("settings.selectorHistoryTitle")}</p>
                        <p className="mt-1 text-xs text-neutral-600">
                          {t("settings.selectorHistoryDescription", { count: selectorDiagnosticsHistory.length })}
                        </p>
                      </div>
                      <Button
                        variant="secondary"
                        disabled={selectorDiagnosticsHistory.length === 0}
                        onClick={handleClearSelectorDiagnostics}
                      >
                        <Trash2 size={15} />
                        {t("settings.selectorClearHistory")}
                      </Button>
                    </div>
                    {selectorDiagnosticsHistory.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {selectorDiagnosticsHistory.slice(0, 3).map((record) => (
                          <div key={record.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-900 px-3 py-2">
                            <div className="min-w-0">
                              <p className="truncate text-xs font-medium text-neutral-300">
                                {getSelectorModeCopy(record.requestedMode, t).label} · {record.effectivePipeline}
                              </p>
                              <p className="mt-0.5 text-[10px] text-neutral-700">{formatSettingsDateTime(record.timestamp)}</p>
                            </div>
                            <span className="cf-badge shrink-0">{record.status}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </SettingCard>

                  <SettingCard
                    icon={<ShieldCheck size={18} />}
                    label={t("settings.contextSafety")}
                    title={t("settings.contextBlockingMode")}
                    description={t("settings.contextBlockingModeDesc")}
                  >
                    <HorizontalSlidingSelector
                      items={contextQualityOptions}
                      activeIndex={contextQualityOptions.findIndex(
                        (option) =>
                          option.value ===
                          (settingsDraft?.contextQualityMode ?? "balanced")
                      )}
                      getItemKey={(option) => option.value}
                      onSelect={(option) =>
                        updateSettingsDraft({
                          contextQualityMode: option.value
                        })
                      }
                      ariaLabel={t("settings.contextBlockingMode")}
                      itemClassName="rounded-[0.95rem] text-left"
                      renderItem={(option, isActive) => (
                        <SettingsChoiceCardContent
                          icon={ShieldCheck}
                          label={option.label}
                          caption={option.caption}
                          isActive={isActive}
                        />
                      )}
                    />
                  </SettingCard>

                  <SettingCard
                    icon={<WandSparkles size={18} />}
                    label={t("settings.contextComposer")}
                    title={t("settings.fileCandidateLimits")}
                    description={t("settings.fileCandidateLimitsSummary", {
                      mode: activePreset?.label ?? t("settings.custom"),
                      profiles: composerLimitRows.length,
                      min: Math.min(...composerLimitValues),
                      max: Math.max(...composerLimitValues)
                    })}
                    defaultOpen={false}
                    storageId="composer-file-limits-v2"
                  >
                    <HorizontalSlidingSelector
                      items={composerLimitPresets}
                      activeIndex={composerLimitPresets.findIndex(
                        (preset) => preset.id === activePreset?.id
                      )}
                      getItemKey={(preset) => preset.id}
                      onSelect={(preset) => updateComposerLimits(preset.limits)}
                      ariaLabel={t("settings.fileCandidateLimits")}
                      className="mb-5"
                      itemClassName="rounded-[0.95rem] text-left"
                      renderItem={(preset, isActive) => (
                        <SettingsChoiceCardContent
                          icon={Gauge}
                          label={preset.label}
                          caption={preset.caption}
                          isActive={isActive}
                        />
                      )}
                    />

                    <div className="mb-5 rounded-2xl border border-neutral-900 bg-black/35 p-4">
                      <div className="flex items-start gap-3">
                        <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-400">
                          <Layers3 size={15} />
                        </span>

                        <div>
                          <p className="text-sm font-medium text-white">
                            {t("settings.currentMode", {
                              mode: activePreset?.label ?? t("settings.custom")
                            })}
                          </p>

                          <p className="mt-1 text-sm leading-6 text-neutral-500">
                            {t("settings.fileLimitsExplanation")}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-3 lg:grid-cols-2">
                      {composerLimitRows.map((row) => (
                        <ComposerLimitRow
                          key={row.key}
                          label={row.label}
                          caption={row.caption}
                          value={composerLimits[row.key]}
                          onChange={(value) => updateComposerLimit(row.key, value)}
                        />
                      ))}
                    </div>
                  </SettingCard>
                </>
              )}

              {activeSection === "general" && (
                <>
                  <SectionHeader
                    icon={<Settings size={15} />}
                    label={t("settings.general")}
                    title={t("settings.generalTitle")}
                    description={t("settings.generalDescription")}
                  />

                  <SettingCard
                    icon={<Languages size={18} />}
                    label={t("settings.language")}
                    title={t("settings.languageTitle")}
                    description={t("settings.languageDescription")}
                  >
                    <HorizontalSlidingSelector
                      items={interfaceLanguageOptions}
                      activeIndex={interfaceLanguageOptions.findIndex(
                        (option) => option.value === currentLanguage
                      )}
                      getItemKey={(option) => option.value}
                      onSelect={(option) => handleLanguageChange(option.value)}
                      ariaLabel={t("settings.languageTitle")}
                      itemClassName="rounded-[0.95rem] text-left"
                      renderItem={(option, isActive) => (
                        <InterfaceChoiceContent
                          icon={option.icon}
                          label={option.label}
                          caption={option.caption}
                          meta={option.meta}
                          isActive={isActive}
                        />
                      )}
                    />

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-neutral-900 bg-black/40 px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="grid size-8 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-400">
                          <Languages size={14} />
                        </span>

                        <div>
                          <p className="text-sm font-medium text-white">
                            {t("settings.languageCurrent")}: {resolvedLanguage.toUpperCase()}
                          </p>
                          <p className={[
                            "mt-0.5 text-xs",
                            languageSaveFailed ? "text-rose-300" : "text-neutral-600"
                          ].join(" ")}>
                            {languageSaveFailed
                              ? t("settings.languageSaveFailed")
                              : isLanguageSaving
                                ? t("settings.languageSavingDescription")
                                : t("settings.languageSavedAutomatically")}
                          </p>
                        </div>
                      </div>

                      <span className={[
                        "rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.14em]",
                        languageSaveFailed
                          ? "border-rose-400/20 bg-rose-400/10 text-rose-200"
                          : isLanguageSaving
                            ? "border-white/10 bg-white/[0.045] text-neutral-400"
                            : "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
                      ].join(" ")}>
                        {languageSaveFailed
                          ? t("settings.languageSaveErrorBadge")
                          : isLanguageSaving
                            ? t("settings.languageSavingBadge")
                            : t("settings.languageSavedBadge")}
                      </span>
                    </div>
                  </SettingCard>

                  <SettingCard
                    icon={<Sparkles size={18} />}
                      label={t("settings.onboarding")}
                      title={t("settings.launchExperience")}
                      description={t("settings.launchExperienceDescription")}
                      defaultOpen={false}
                    >
                      <HorizontalSlidingSelector
                        items={launchExperienceOptions}
                        activeIndex={launchExperienceOptions.findIndex(
                          (option) => option.value === launchExperienceMode
                        )}
                        getItemKey={(option) => option.value}
                        onSelect={(option) => {
                          if (option.value === "workspace") {
                            updateSettingsDraft({
                              onboardingEnabled: false,
                              onboardingShowEveryLaunch: false
                            });
                            return;
                          }

                          updateSettingsDraft({
                            onboardingEnabled: true,
                            onboardingShowEveryLaunch:
                              option.value === "every-launch"
                          });
                        }}
                        ariaLabel={t("settings.launchExperience")}
                        itemClassName="rounded-[0.95rem] text-left"
                        renderItem={(option, isActive) => (
                          <InterfaceChoiceContent
                            icon={option.icon}
                            label={option.label}
                            caption={option.caption}
                            meta={option.meta}
                            isActive={isActive}
                          />
                        )}
                      />

                      <div className="mt-4 rounded-2xl border border-neutral-900 bg-black/40 px-4 py-3">
                        <p className="text-sm font-medium text-white">
                          {launchExperienceMode === "workspace"
                            ? t("settings.onboardingLaunchOff")
                            : launchExperienceMode === "first-run"
                              ? t("settings.onboardingFirstRunOnly")
                              : t("settings.onboardingEveryLaunch")}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-neutral-600">
                          {t("settings.onboardingSavedWithSettings")}
                        </p>
                      </div>
                  </SettingCard>

                  <SettingCard
                    icon={<Gauge size={18} />}
                    label={t("settings.workspaceDefaults")}
                    title={t("settings.workspaceDefaultsTitle")}
                    description={t("settings.workspaceDefaultsDescription")}
                    defaultOpen={false}
                  >
                    <div className="grid gap-3 md:grid-cols-3">
                      <PlannedInterfaceFeature
                        icon={PanelLeft}
                        title={t("settings.defaultStartPage")}
                        description={t("settings.defaultStartPageDescription")}
                        badge={t("settings.planned")}
                      />
                      <PlannedInterfaceFeature
                        icon={MessageSquareText}
                        title={t("settings.notificationPreferences")}
                        description={t("settings.notificationPreferencesDescription")}
                        badge={t("settings.planned")}
                      />
                      <PlannedInterfaceFeature
                        icon={ShieldCheck}
                        title={t("settings.confirmationPreferences")}
                        description={t("settings.confirmationPreferencesDescription")}
                        badge={t("settings.planned")}
                      />
                    </div>
                  </SettingCard>
                </>
              )}

              {activeSection === "interface" && (
                <>
                  <SectionHeader
                    icon={<PanelLeft size={15} />}
                    label={t("settings.interface")}
                    title={t("settings.interfaceWorkspaceTitle")}
                    description={t("settings.interfaceWorkspaceDescription")}
                  />

                  <div className="grid items-start gap-4">
                    <SettingCard
                      icon={<PanelLeft size={18} />}
                      label={t("settings.sidebar")}
                      title={t("settings.navigationStyle")}
                      description={t("settings.navigationStyleDescription")}
                    >
                      <HorizontalSlidingSelector
                        items={navigationDensityOptions}
                        activeIndex={navigationDensityOptions.findIndex(
                          (option) =>
                            option.value ===
                            (settingsDraft?.sidebarShowDescriptions ?? false)
                        )}
                        getItemKey={(option) => String(option.value)}
                        onSelect={(option) =>
                          updateSettingsDraft({
                            sidebarShowDescriptions: option.value
                          })
                        }
                        ariaLabel={t("settings.navigationStyle")}
                        itemClassName="rounded-[0.95rem] text-left"
                        renderItem={(option, isActive) => (
                          <InterfaceChoiceContent
                            icon={option.icon}
                            label={option.label}
                            caption={option.caption}
                            meta={option.meta}
                            isActive={isActive}
                          />
                        )}
                      />

                      <div className="mt-4 rounded-2xl border border-neutral-900 bg-black/40 p-4">
                        <div className="flex items-start gap-3">
                          <span className="grid size-8 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-500">
                            <PanelLeft size={14} />
                          </span>

                          <div>
                            <p className="text-sm font-medium text-white">
                              {t("settings.collapsibleSidebar")}
                            </p>
                            <p className="mt-1 text-xs leading-5 text-neutral-600">
                              {t("settings.collapsibleSidebarDesc")}
                            </p>
                          </div>
                        </div>
                      </div>
                    </SettingCard>
                  </div>

                  <SettingCard
                    icon={<SlidersHorizontal size={18} />}
                    label={t("settings.experienceLab")}
                    title={t("settings.experienceLabTitle")}
                    description={t("settings.experienceLabDescription")}
                    defaultOpen={false}
                  >
                    <div className="grid gap-3 md:grid-cols-3">
                      <PlannedInterfaceFeature
                        icon={Gauge}
                        title={t("settings.interfaceScale")}
                        description={t("settings.interfaceScaleDescription")}
                        badge={t("settings.planned")}
                      />

                      <PlannedInterfaceFeature
                        icon={Sparkles}
                        title={t("settings.motionPreference")}
                        description={t("settings.motionPreferenceDescription")}
                        badge={t("settings.planned")}
                      />

                      <PlannedInterfaceFeature
                        icon={ShieldCheck}
                        title={t("settings.focusContrast")}
                        description={t("settings.focusContrastDescription")}
                        badge={t("settings.planned")}
                      />
                    </div>
                  </SettingCard>
                </>
              )}

              {activeSection === "shortcuts" && (
                <>
                  <SectionHeader
                    icon={<Keyboard size={13} />}
                    label={t("settings.shortcuts")}
                    title={t("settings.shortcutsTitle")}
                    description={t("settings.shortcutsDescription")}
                  />

                  <SettingCard
                    icon={<Keyboard size={18} />}
                    label={t("settings.shortcuts")}
                    title={t("settings.keyboardShortcuts")}
                    description={t("settings.keyboardShortcutsDesc")}
                  >
                    <div className="grid gap-3 md:grid-cols-2">
                      {keyboardShortcuts.map((shortcut) => (
                        <div
                          key={shortcut.id}
                          className="rounded-2xl border border-neutral-900 bg-black/40 p-4"
                        >
                          <div className="mb-2 flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-white">
                                {t(`settings.shortcut.${shortcut.id}.label`)}
                              </p>

                              <p className="mt-1 text-sm leading-5 text-neutral-500">
                                {t(`settings.shortcut.${shortcut.id}.description`)}
                              </p>
                            </div>

                            {shortcut.enabled ? (
                              <CheckCircle2
                                size={16}
                                className="mt-0.5 shrink-0 text-emerald-300"
                              />
                            ) : (
                              <Circle
                                size={16}
                                className="mt-0.5 shrink-0 text-neutral-700"
                              />
                            )}
                          </div>

                          <div className="flex items-center justify-between gap-3">
                            <span className="rounded-full border border-neutral-800 bg-neutral-950 px-2.5 py-1 text-[11px] text-neutral-400">
                              {shortcut.displayKeys}
                            </span>

                            <span className="text-xs text-neutral-700">
                              {shortcut.enabled ? t("common.enabled") : t("common.soon")}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </SettingCard>


                  <SettingCard
                    icon={<SlidersHorizontal size={18} />}
                    label={t("settings.planned")}
                    title={t("settings.shortcutEditor")}
                    description={t("settings.shortcutEditorDescription")}
                    defaultOpen={false}
                  >
                    <div className="grid gap-3 md:grid-cols-3">
                      <PlannedInterfaceFeature icon={Keyboard} title={t("settings.shortcutRemapping")} description={t("settings.shortcutRemappingDesc")} badge={t("settings.planned")} />
                      <PlannedInterfaceFeature icon={ShieldCheck} title={t("settings.shortcutConflicts")} description={t("settings.shortcutConflictsDesc")} badge={t("settings.planned")} />
                      <PlannedInterfaceFeature icon={Download} title={t("settings.shortcutProfiles")} description={t("settings.shortcutProfilesDesc")} badge={t("settings.planned")} />
                    </div>
                  </SettingCard>                </>
              )}

              {(activeSection === "privacy" || activeSection === "updates") && (
                <PlaceholderSettingsPanel sectionId={activeSection} />
              )}

              {activeSection === "storage" && (
                <StorageSettingsPanel
                  audit={storageAudit}
                  loading={isStorageAuditLoading}
                  onRefresh={loadStorageAudit}
                />
              )}

              {activeSection === "system" && (
                <>
                  <SectionHeader
                    icon={<ShieldCheck size={13} />}
                    label={t("settings.system")}
                    title={t("settings.systemTitle")}
                    description={t("settings.systemDescription")}
                  />

                  <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
                    <SettingCard
                    icon={<ShieldCheck size={18} />}
                      label={t("settings.system")}
                      title={t("settings.applicationMetadata")}
                      description={t("settings.applicationMetadataDesc")}
                    >
                      <div className="grid gap-3 text-sm md:grid-cols-2">
                        <div className="flex items-center justify-between gap-4 rounded-2xl border border-neutral-900 bg-black/40 px-4 py-3">
                          <span className="text-neutral-500">{t("settings.name")}</span>
                          <span className="font-medium text-white">{appMeta.name}</span>
                        </div>

                        <div className="flex items-center justify-between gap-4 rounded-2xl border border-neutral-900 bg-black/40 px-4 py-3">
                          <span className="text-neutral-500">{t("settings.version")}</span>
                          <span className="font-medium text-white">
                            v{appMeta.version}
                          </span>
                        </div>

                        <div className="flex items-center justify-between gap-4 rounded-2xl border border-neutral-900 bg-black/40 px-4 py-3">
                          <span className="text-neutral-500">{t("settings.phase")}</span>
                          <span className="font-medium text-white">{appMeta.phase}</span>
                        </div>

                        <div className="flex items-center justify-between gap-4 rounded-2xl border border-neutral-900 bg-black/40 px-4 py-3">
                          <span className="text-neutral-500">{t("settings.mode")}</span>
                          <span className="font-medium text-white">{t("common.localFirst")}</span>
                        </div>
                      </div>

                      <p className="mt-5 text-sm leading-6 text-neutral-500">
                        {t("settings.applicationDescription")}
                      </p>
                    </SettingCard>

                    <SettingCard
                      icon={<Sparkles size={18} />}
                      label={t("settings.direction")}
                      title={t("settings.productArchitecture")}
                      description={t("settings.productArchitectureDesc")}
                    >
                      <div className="space-y-3">
                        <div className="rounded-2xl border border-neutral-900 bg-black/40 p-4">
                          <p className="text-sm font-medium text-white">
                            {t("common.localFirst")}
                          </p>

                          <p className="mt-1 text-sm leading-5 text-neutral-500">
                            {t("settings.localFirstDesc")}
                          </p>
                        </div>

                        <div className="rounded-2xl border border-neutral-900 bg-black/40 p-4">
                          <p className="text-sm font-medium text-white">
                            {t("settings.agentReady")}
                          </p>

                          <p className="mt-1 text-sm leading-5 text-neutral-500">
                            {t("settings.agentReadyDesc")}
                          </p>
                        </div>

                        <div className="rounded-2xl border border-neutral-900 bg-black/40 p-4">
                          <p className="text-sm font-medium text-white">
                            {t("settings.composerDriven")}
                          </p>

                          <p className="mt-1 text-sm leading-5 text-neutral-500">
                            {t("settings.composerDrivenDesc")}
                          </p>
                        </div>
                      </div>
                    </SettingCard>
                  </div>


                  <SettingCard
                    icon={<Server size={18} />}
                    label={t("settings.planned")}
                    title={t("settings.systemTools")}
                    description={t("settings.systemToolsDescription")}
                    defaultOpen={false}
                  >
                    <div className="grid gap-3 md:grid-cols-3">
                      <PlannedInterfaceFeature icon={Download} title={t("settings.diagnosticsBundle")} description={t("settings.diagnosticsBundleDesc")} badge={t("settings.planned")} />
                      <PlannedInterfaceFeature icon={Server} title={t("settings.dataLocation")} description={t("settings.dataLocationDesc")} badge={t("settings.planned")} />
                      <PlannedInterfaceFeature icon={Trash2} title={t("settings.resetSettings")} description={t("settings.resetSettingsDesc")} badge={t("settings.planned")} />
                    </div>
                  </SettingCard>                </>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
