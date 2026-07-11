import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import {
  Bot,
  ChevronDown,
  Check,
  CheckCircle2,
  Circle,
  Cpu,
  Download,
  Gauge,
  Keyboard,
  Languages,
  Layers3,
  Loader2,
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
import { SlidingSelectionIndicator } from "../components/ui/SlidingSelectionIndicator";
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
      icon: ShieldCheck,
      status: "soon"
    },
    {
      id: "storage",
      label: "Storage",
      icon: Server
    },
    {
      id: "updates",
      label: "Updates",
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

const SETTINGS_PLACEHOLDERS: Record<Exclude<SettingsSectionId, "ai" | "generation" | "composer" | "interface" | "shortcuts" | "system">, {
  label: string;
  title: string;
  description: string;
  cards: Array<{
    label: string;
    title: string;
    description: string;
    points: string[];
  }>;
}> = {
  privacy: {
    label: "Security",
    title: "Privacy and safety controls",
    description: "Future controls for sensitive files, secret handling, and safe local project scanning.",
    cards: [
      {
        label: "Planned",
        title: "Secret-aware scanning",
        description: "Guard rails for .env files, tokens, private keys, and generated local databases.",
        points: ["Sensitive file review", "Redaction rules", "Local-only safety notes"]
      },
      {
        label: "Planned",
        title: "Project trust levels",
        description: "Per-project policies for how much context may be scanned and included in Task Packs.",
        points: ["Strict project mode", "Allowed folders", "Forbidden patterns"]
      }
    ]
  },
  storage: {
    label: "Workspace",
    title: "Storage and cache settings",
    description: "Future controls for inventory cache, generated Task Pack history, and workspace cleanup.",
    cards: [
      {
        label: "Planned",
        title: "Inventory cache",
        description: "Speed up repeated generations by reusing file metadata and only rescanning changed files.",
        points: ["File hash cache", "Project metadata cache", "Manual cache reset"]
      },
      {
        label: "Planned",
        title: "Task Pack history",
        description: "Manage saved generations, exported prompts, and review history from one place.",
        points: ["Retention controls", "Export cleanup", "Local database tools"]
      }
    ]
  },
  updates: {
    label: "Product",
    title: "Updates and release channel",
    description: "Future controls for version checks, release notes, and update behavior.",
    cards: [
      {
        label: "Planned",
        title: "Release channel",
        description: "Choose between stable, beta, and local developer builds when auto-update arrives.",
        points: ["Stable channel", "Beta builds", "Manual update check"]
      },
      {
        label: "Planned",
        title: "Release notes",
        description: "Show what changed in the current version and what is planned next.",
        points: ["Core fixes", "UI polish", "Known limitations"]
      }
    ]
  }
};

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
    return "Unknown size";
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

function SettingCard({
  icon,
  label,
  title,
  description,
  children,
  defaultOpen = true
}: {
  icon: ReactNode;
  label: string;
  title: string;
  description: string;
  children?: ReactNode;
  defaultOpen?: boolean;
}) {
  const hasContent = Boolean(children);
  const storageKey = useMemo(
    () =>
      `contextforge:settings-card:${label}:${title}`
        .toLowerCase()
        .replace(/[^a-z0-9а-яё:_-]+/gi, "-"),
    [label, title]
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
    <article className="cf-card settings-collapsible-card group/card self-start p-0 text-render-crisp">
      <div className="flex w-full items-start justify-between gap-5 p-5 text-left transition duration-200">
        <div className="min-w-0">
          <div className="mb-3 flex size-10 items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-200 transition duration-200 group-hover/card:border-white/15 group-hover/card:text-white">
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
            <div className="px-5 pb-5">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </article>
  );
}

function StatusBadge({ status }: { status: OllamaStatus | null }) {
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
      {isOnline ? "Online" : "Offline"}
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

  const navHeight =
    SETTINGS_SECTIONS.length * SETTINGS_NAV_ITEM_HEIGHT +
    (SETTINGS_SECTIONS.length - 1) * SETTINGS_NAV_ITEM_GAP;

  return (
    <aside className="settings-control-panel sticky top-5 h-fit overflow-hidden rounded-[1.6rem] border border-neutral-900 p-2 text-render-crisp">
      <div className="mb-2 px-3 py-3">
        <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
          {t("settings.title")}
        </p>

        <p className="mt-1 text-sm font-medium text-white">
          {t("settings.controlCenter")}
        </p>
      </div>

      <div
        className="relative grid gap-1 overflow-hidden"
        style={{ height: navHeight }}
      >
        <SlidingSelectionIndicator
          activeIndex={activeIndex}
          itemHeight={SETTINGS_NAV_ITEM_HEIGHT}
          itemGap={SETTINGS_NAV_ITEM_GAP}
          glowClassName="settings-nav-active-glow"
          className="settings-nav-active-pill"
        />

        {SETTINGS_SECTIONS.map((section) => {
          const Icon = section.icon;
          const isActive = activeSection === section.id;

          return (
            <button
              key={section.id}
              type="button"
              onClick={() => onChange(section.id)}
              className={[
                "group relative z-10 flex w-full items-center gap-3 overflow-hidden rounded-2xl px-3 text-left transition-colors duration-150",
                isActive ? "text-black" : "text-neutral-500 hover:text-white"
              ].join(" ")}
              style={{ height: SETTINGS_NAV_ITEM_HEIGHT }}
            >
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
                  Soon
                </span>
              )}
            </button>
          );
        })}
      </div>

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
    <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.012)_48%,rgba(255,255,255,0.006))] p-6 shadow-[0_16px_52px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.045)]">
      <div className="mb-4 flex flex-wrap gap-2">
        <span className="cf-badge">
          {icon}
          {label}
        </span>
      </div>

      <h2 className="max-w-4xl text-[34px] font-semibold leading-[1.05] tracking-[-0.05em] text-white">
        {title}
      </h2>

      <p className="mt-3 max-w-3xl text-sm leading-6 text-neutral-400">
        {description}
      </p>
    </div>
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

function ToggleSetting({
  label,
  description,
  checked,
  onChange
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={[
        "group flex w-full items-center justify-between gap-5 rounded-2xl border p-4 text-left transition duration-200",
        checked
          ? "border-emerald-400/25 bg-emerald-400/[0.055] hover:border-emerald-400/35 hover:bg-emerald-400/[0.075]"
          : "border-neutral-900 bg-black/40 hover:border-neutral-700 hover:bg-white/[0.035]"
      ].join(" ")}
    >
      <span className="min-w-0">
        <span className="flex items-center gap-2 text-sm font-semibold text-white">
          {label}

          <span
            className={[
              "rounded-full border px-2 py-0.5 text-[10px]",
              checked
                ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
                : "border-neutral-800 bg-neutral-950 text-neutral-500"
            ].join(" ")}
          >
            {checked ? "On" : "Off"}
          </span>
        </span>

        <span className="mt-1 block text-sm leading-6 text-neutral-500">
          {description}
        </span>
      </span>

      <span
        className={[
          "relative h-7 w-12 shrink-0 rounded-full border transition duration-200",
          checked
            ? "border-emerald-400/30 bg-emerald-400/15 shadow-[0_0_22px_rgba(52,211,153,0.12)]"
            : "border-neutral-800 bg-neutral-950"
        ].join(" ")}
      >
        <motion.span
          className={[
            "absolute left-1 top-1 grid size-5 place-items-center rounded-full transition duration-200",
            checked
              ? "bg-emerald-300 shadow-[0_0_14px_rgba(110,231,183,0.55)]"
              : "bg-neutral-600"
          ].join(" ")}
          initial={false}
          animate={{ x: checked ? 20 : 0 }}
          transition={{
            type: "spring",
            stiffness: 520,
            damping: 38,
            mass: 0.6
          }}
          style={{ willChange: "transform" }}
        />
      </span>
    </button>
  );
}

function PlaceholderSettingsPanel({
  sectionId
}: {
  sectionId: Exclude<SettingsSectionId, "ai" | "generation" | "composer" | "interface" | "shortcuts" | "system">;
}) {
  const config = SETTINGS_PLACEHOLDERS[sectionId];

  return (
    <>
      <SectionHeader
        icon={<Sparkles size={13} />}
        label={config.label}
        title={config.title}
        description={config.description}
      />

      <div className="grid items-start gap-5 xl:grid-cols-2">
        {config.cards.map((card) => (
          <SettingCard
            key={card.title}
            icon={<Sparkles size={18} />}
            label={card.label}
            title={card.title}
            description={card.description}
            defaultOpen={false}
          >
            <div className="grid gap-3">
              {card.points.map((point) => (
                <div
                  key={point}
                  className="settings-inner-surface flex items-center justify-between gap-4 rounded-2xl border px-4 py-3"
                >
                  <span className="text-sm text-neutral-300">{point}</span>
                  <span className="rounded-full border border-neutral-800 bg-black/35 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-neutral-600">
                    Planned
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
    return "Unknown";
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
  const counts = audit?.counts ?? [];
  const artifacts = audit?.artifacts ?? [];
  const gaps = audit?.gaps ?? [];
  const plan = audit?.plan ?? [];
  const schema = audit?.schema ?? null;
  const releaseReadiness = audit?.releaseReadiness ?? null;
  const [backupResult, setBackupResult] = useState<WorkspaceBackupExportResult | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [isBackupExporting, setIsBackupExporting] = useState(false);

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

  return (
    <>
      <SectionHeader
        icon={<Server size={13} />}
        label="Workspace"
        title="Storage and desktop persistence"
        description="Review where ContextForge stores local workspace data before deeper SQLite migrations and release-readiness work."
      />

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <SettingCard
            icon={<Server size={18} />}
            label="Storage audit"
            title="SQLite-first workspace state"
            description="Live local audit of projects, Task Packs, memory, rules/templates and the remaining migration gaps."
          >
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                <span className="cf-badge">
                  {audit?.driver ?? "sqlite"}
                </span>
                <span className="cf-badge">
                  {audit?.sqliteFirst ? "SQLite-first" : "Non-default driver"}
                </span>
                {audit?.databaseExists && <span className="cf-badge">Database found</span>}
                {schema && (
                  <span className="cf-badge">
                    Schema v{schema.currentVersion}/{schema.latestVersion}
                  </span>
                )}
              </div>

              <SettingsActionButton
                icon={RefreshCw}
                label="Refresh audit"
                loadingLabel="Refreshing"
                loading={loading}
                disabled={loading}
                variant="secondary"
                onClick={onRefresh}
              />
            </div>

            {!audit ? (
              <div className="rounded-2xl border border-neutral-900 bg-black/40 p-5">
                <p className="text-sm font-medium text-white">
                  {loading ? "Loading storage audit..." : "Storage audit is not loaded yet."}
                </p>
                <p className="mt-2 text-sm leading-6 text-neutral-500">
                  Refresh this section to inspect local persistence before migration work.
                </p>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl border border-neutral-900 bg-black/40 p-4">
                    <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                      Driver
                    </p>
                    <p className="mt-2 text-xl font-semibold text-white">
                      {audit.driver}
                    </p>
                    <p className="mt-1 text-xs text-neutral-600">
                      active adapter
                    </p>
                  </div>

                  <div className="rounded-2xl border border-neutral-900 bg-black/40 p-4">
                    <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                      Database
                    </p>
                    <p className="mt-2 text-xl font-semibold text-white">
                      {audit.databaseExists ? "Ready" : "Missing"}
                    </p>
                    <p className="mt-1 text-xs text-neutral-600">
                      {formatStorageBytes(audit.databaseSizeBytes)}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-neutral-900 bg-black/40 p-4">
                    <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                      Schema
                    </p>
                    <p className="mt-2 text-xl font-semibold text-white">
                      {schema ? `v${schema.currentVersion}` : "Unknown"}
                    </p>
                    <p className="mt-1 text-xs text-neutral-600">
                      {schema
                        ? schema.pendingCount > 0
                          ? `${schema.pendingCount} pending`
                          : "up to date"
                        : "migration metadata"}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-neutral-900 bg-black/40 p-4">
                    <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                      Gaps
                    </p>
                    <p className="mt-2 text-xl font-semibold text-white">
                      {gaps.length}
                    </p>
                    <p className="mt-1 text-xs text-neutral-600">
                      migration items
                    </p>
                  </div>
                </div>

                {schema && (
                  <div className="rounded-2xl border border-neutral-900 bg-black/40 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white">
                          SQLite schema versioning
                        </p>
                        <p className="mt-1 text-xs leading-5 text-neutral-600">
                          Applied {schema.appliedCount} migration{schema.appliedCount === 1 ? "" : "s"}; latest schema target is v{schema.latestVersion}.
                        </p>
                      </div>
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${storageStatusClasses(schema.status)}`}>
                        {schema.status === "ready" ? "ready" : "needs migration"}
                      </span>
                    </div>
                    {schema.latestMigration && (
                      <p className="mt-3 text-xs leading-5 text-neutral-700">
                        Latest: {schema.latestMigration.id} · {schema.latestMigration.name}
                      </p>
                    )}
                  </div>
                )}

                <div className="grid gap-3 md:grid-cols-2">
                  {counts.map((item) => (
                    <div
                      key={item.key}
                      className="rounded-2xl border border-neutral-900 bg-black/40 p-4"
                    >
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-white">
                            {item.label}
                          </p>
                          <p className="mt-1 text-xs leading-5 text-neutral-600">
                            {item.note}
                          </p>
                        </div>
                        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${storageStatusClasses(item.status)}`}>
                          {item.status}
                        </span>
                      </div>

                      <p className="text-2xl font-semibold text-white">
                        {item.count === null ? "—" : item.count}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="rounded-2xl border border-neutral-900 bg-black/40 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white">
                        Workspace backup export
                      </p>
                      <p className="mt-1 max-w-2xl text-xs leading-5 text-neutral-600">
                        Create a local JSON backup with projects, Task Packs, Project Memory, rules/templates and safe settings. API keys, provider URLs, source files and raw diffs are excluded.
                      </p>
                    </div>

                    <SettingsActionButton
                      icon={Download}
                      label="Export backup"
                      loadingLabel="Exporting"
                      loading={isBackupExporting}
                      disabled={isBackupExporting}
                      variant="primary"
                      onClick={handleExportBackup}
                    />
                  </div>

                  {backupResult && (
                    <div className="mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-emerald-100">
                            Backup created
                          </p>
                          <p className="mt-1 break-all text-xs leading-5 text-emerald-200/70">
                            {backupResult.filePath}
                          </p>
                        </div>
                        <span className="shrink-0 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-200">
                          {formatStorageBytes(backupResult.sizeBytes)}
                        </span>
                      </div>

                      <div className="mt-3 grid gap-2 text-xs text-emerald-100/80 sm:grid-cols-2 lg:grid-cols-5">
                        <span>Projects: {backupResult.counts.projects}</span>
                        <span>Task Packs: {backupResult.counts.taskPacks}</span>
                        <span>Memory: {backupResult.counts.projectMemories}</span>
                        <span>Rules: {backupResult.counts.ruleTemplates}</span>
                        <span>Settings: {backupResult.counts.settings}</span>
                      </div>
                    </div>
                  )}

                  {backupError && (
                    <div className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-400/10 p-4">
                      <p className="text-sm font-semibold text-rose-100">
                        Backup export failed
                      </p>
                      <p className="mt-1 text-xs leading-5 text-rose-200/70">
                        {backupError}
                      </p>
                    </div>
                  )}
                </div>

                {releaseReadiness && (
                  <div className="rounded-2xl border border-neutral-900 bg-black/40 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white">
                          Desktop release readiness
                        </p>
                        <p className="mt-1 max-w-2xl text-xs leading-5 text-neutral-600">
                          Compact local-storage checklist before onboarding, installer work and GitHub integration.
                        </p>
                      </div>
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${storageStatusClasses(releaseReadiness.status)}`}>
                        {releaseReadiness.status}
                      </span>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                      <div className="rounded-2xl border border-neutral-900 bg-black/35 p-3">
                        <p className="cf-tech-label text-[10px] uppercase text-neutral-600">Passed</p>
                        <p className="mt-1 text-xl font-semibold text-emerald-200">{releaseReadiness.passed}</p>
                      </div>
                      <div className="rounded-2xl border border-neutral-900 bg-black/35 p-3">
                        <p className="cf-tech-label text-[10px] uppercase text-neutral-600">Warnings</p>
                        <p className="mt-1 text-xl font-semibold text-amber-200">{releaseReadiness.warnings}</p>
                      </div>
                      <div className="rounded-2xl border border-neutral-900 bg-black/35 p-3">
                        <p className="cf-tech-label text-[10px] uppercase text-neutral-600">Blocked</p>
                        <p className="mt-1 text-xl font-semibold text-rose-200">{releaseReadiness.failed}</p>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-2 md:grid-cols-2">
                      {releaseReadiness.checks.map((check) => (
                        <div
                          key={check.key}
                          className="rounded-2xl border border-neutral-900 bg-black/35 p-3"
                        >
                          <div className="mb-1 flex items-start justify-between gap-3">
                            <p className="text-xs font-semibold text-white">{check.label}</p>
                            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${storageStatusClasses(check.status)}`}>
                              {check.status}
                            </span>
                          </div>
                          <p className="text-xs leading-5 text-neutral-600">{check.note}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </SettingCard>

          <SettingCard
            icon={<Layers3 size={18} />}
            label="Migration targets"
            title="Local data artifacts"
            description="Current files and adapters that matter for desktop persistence."
            defaultOpen={false}
          >
            <div className="space-y-3">
              {artifacts.map((artifact) => (
                <div
                  key={artifact.key}
                  className="rounded-2xl border border-neutral-900 bg-black/40 p-4"
                >
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white">
                        {artifact.label}
                      </p>
                      <p className="mt-1 break-all text-xs leading-5 text-neutral-600">
                        {artifact.path}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${storageStatusClasses(artifact.migrationStatus)}`}>
                      {artifact.migrationStatus}
                    </span>
                  </div>
                  <p className="text-sm leading-6 text-neutral-500">
                    {artifact.role}
                  </p>
                  <p className="mt-2 text-xs text-neutral-700">
                    {artifact.exists ? "Found" : "Not found"} · {formatStorageBytes(artifact.sizeBytes)}
                  </p>
                </div>
              ))}
            </div>
          </SettingCard>
        </div>

        <div className="space-y-5">
          <SettingCard
            icon={<ShieldCheck size={18} />}
            label="Gaps"
            title="What remains before release readiness"
            description="Small storage tasks to complete before ContextForge feels like a normal desktop app."
          >
            <div className="space-y-3">
              {gaps.map((gap) => (
                <div
                  key={gap.key}
                  className="rounded-2xl border border-neutral-900 bg-black/40 p-4"
                >
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <p className="text-sm font-semibold text-white">
                      {gap.title}
                    </p>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${storageStatusClasses(gap.priority === "now" ? "current" : gap.priority)}`}>
                      {gap.priority}
                    </span>
                  </div>
                  <p className="text-sm leading-6 text-neutral-500">
                    {gap.description}
                  </p>
                </div>
              ))}
            </div>
          </SettingCard>

          <SettingCard
            icon={<Sparkles size={18} />}
            label="12.x plan"
            title="Migration order"
            description="The next storage patches should stay small and reversible."
            defaultOpen={false}
          >
            <div className="space-y-3">
              {plan.map((step) => (
                <div
                  key={step.id}
                  className="rounded-2xl border border-neutral-900 bg-black/40 p-4"
                >
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white">
                        {step.id} · {step.title}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${storageStatusClasses(step.status)}`}>
                      {step.status}
                    </span>
                  </div>
                  <p className="text-sm leading-6 text-neutral-500">
                    {step.description}
                  </p>
                </div>
              ))}
            </div>
          </SettingCard>
        </div>
      </div>
    </>
  );
}

export function SettingsPage() {
  const { t } = useTranslation();
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("ai");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<AppSettings | null>(null);
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null);
  const [storageAudit, setStorageAudit] = useState<StorageAuditResult | null>(null);
  const [isStorageAuditLoading, setIsStorageAuditLoading] = useState(false);
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [selectorDiagnosticsHistory, setSelectorDiagnosticsHistory] = useState<SelectorPipelineDiagnostics[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeAction, setActiveAction] = useState<"refresh" | "save" | null>(null);

  const hasUnsavedChanges = useMemo(() => {
    return !isSameSettings(settings, settingsDraft);
  }, [settings, settingsDraft]);

  const composerLimits = settingsDraft?.composerFileLimits ?? DEFAULT_COMPOSER_FILE_LIMITS;
  const activePreset = getActivePreset(composerLimits);
  const currentLanguage = (settingsDraft?.language ?? "system") as AppLanguage;
  const resolvedLanguage = resolveAppLanguage(currentLanguage);
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

  function handleLanguageChange(language: AppLanguage) {
    updateSettingsDraft({ language });
    void applyAppLanguage(language);
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
      <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.012)_48%,rgba(255,255,255,0.006))] p-6 shadow-[0_16px_52px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.045)]">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0">
            <div className="mb-4 flex flex-wrap gap-2">
              <span className="cf-badge">
                <Settings size={13} />
                {t("settings.title")}
              </span>
              <span className="cf-badge">{t("settings.heroBadgeGithub")}</span>
              <span className="cf-badge">{t("settings.heroBadgeLocal")}</span>
            </div>

            <h2 className="max-w-4xl text-[34px] font-semibold leading-[1.05] tracking-[-0.05em] text-white">
              {t("settings.heroTitle")}
            </h2>

            <p className="mt-3 max-w-3xl text-sm leading-6 text-neutral-400">
              {t("settings.heroDescription")}
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <SettingsActionButton
              icon={RefreshCw}
              label={t("common.refresh")}
              loadingLabel={t("common.refreshing")}
              loading={activeAction === "refresh"}
              disabled={isLoading}
              variant="secondary"
              onClick={loadOllamaInfo}
            />

            <SettingsActionButton
              icon={hasUnsavedChanges ? Save : Check}
              label={hasUnsavedChanges ? t("common.saveChanges") : t("common.saved")}
              loadingLabel={t("common.saving")}
              loading={activeAction === "save"}
              disabled={isLoading || !settingsDraft || !hasUnsavedChanges}
              variant="primary"
              pulse={hasUnsavedChanges}
              onClick={handleSaveSettings}
            />
          </div>
        </div>
      </div>


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
                          {ollamaStatus?.message ?? t("settings.checkingOllama")}
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
                      <div className="grid gap-3 md:grid-cols-2">
                        {models.map((model) => {
                          const isSelected =
                            settingsDraft?.defaultOllamaModel === model.name;

                          return (
                            <button
                              key={model.name}
                              type="button"
                              onClick={() =>
                                updateSettingsDraft({
                                  defaultOllamaModel: model.name
                                })
                              }
                              className={[
                                "group flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition duration-200",
                                isSelected
                                  ? "border-white bg-white text-black shadow-[0_12px_34px_rgba(255,255,255,0.10)]"
                                  : "border-neutral-900 bg-black/35 text-neutral-400 hover:border-white hover:bg-white hover:text-black hover:shadow-[0_12px_34px_rgba(255,255,255,0.10)]"
                              ].join(" ")}
                            >
                              <span
                                className={[
                                  "grid size-9 shrink-0 place-items-center rounded-xl border transition",
                                  isSelected
                                    ? "border-black/10 bg-black/5 text-black"
                                    : "border-neutral-800 bg-neutral-950 text-neutral-500 group-hover:border-black/10 group-hover:bg-black/5 group-hover:text-black"
                                ].join(" ")}
                              >
                                <Cpu size={15} />
                              </span>

                              <span className="min-w-0 flex-1">
                                <span
                                  className={[
                                    "block truncate text-sm font-semibold transition",
                                    isSelected
                                      ? "text-black"
                                      : "text-white group-hover:text-black"
                                  ].join(" ")}
                                >
                                  {model.name}
                                </span>

                                <span
                                  className={[
                                    "mt-0.5 block truncate text-xs transition",
                                    isSelected
                                      ? "text-black/55"
                                      : "text-neutral-600 group-hover:text-black/55"
                                  ].join(" ")}
                                >
                                  {model.model ?? "local model"} ·{" "}
                                  {formatModelSize(model.size)}
                                </span>
                              </span>
                            </button>
                          );
                        })}
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

                  <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
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
                            options={TARGET_TOOL_OPTIONS}
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
                              {
                                value: "general",
                                label: "General",
                                description: "Universal task"
                              },
                              {
                                value: "ui",
                                label: "UI / UX",
                                description: "Interface and interaction task"
                              },
                              {
                                value: "backend",
                                label: "Backend",
                                description: "API, database, server logic"
                              },
                              {
                                value: "fullstack",
                                label: "Fullstack",
                                description: "Client + API/server work"
                              },
                              {
                                value: "build",
                                label: "Build / Config",
                                description: "Build, imports, config and tooling"
                              },
                              {
                                value: "bugfix",
                                label: "Bugfix",
                                description: "Find and fix a problem"
                              },
                              {
                                value: "refactor",
                                label: "Refactor",
                                description: "Improve code without changing behavior"
                              },
                              {
                                value: "docs",
                                label: "Docs",
                                description: "Documentation task"
                              },
                              {
                                value: "tests",
                                label: "Tests",
                                description: "Testing and verification task"
                              }
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
                    >
                      <div className="space-y-3">
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
                    <div className="grid gap-3 md:grid-cols-3">
                      {SELECTOR_PIPELINE_MODES.map((value) => {
                        const option = getSelectorModeCopy(value, t);
                        const isActive = (settingsDraft?.selectorPipelineMode ?? "legacy") === value;
                        return (
                          <button
                            key={value}
                            type="button"
                            onClick={() => updateSettingsDraft({ selectorPipelineMode: value })}
                            className={[
                              "group rounded-2xl border p-4 text-left transition duration-200",
                              isActive
                                ? "border-white bg-white text-black"
                                : "border-neutral-900 bg-black/35 text-neutral-400 hover:border-white hover:bg-white hover:text-black"
                            ].join(" ")}
                          >
                            <div className="mb-3 flex items-center justify-between gap-3">
                              <span className={[
                                "grid size-9 place-items-center rounded-xl border transition",
                                isActive
                                  ? "border-black/10 bg-black/5 text-black"
                                  : "border-neutral-800 bg-neutral-950 text-neutral-500 group-hover:border-black/10 group-hover:bg-black/5 group-hover:text-black"
                              ].join(" ")}>
                                <Layers3 size={15} />
                              </span>
                              {isActive && <CheckCircle2 size={16} className="text-black" />}
                            </div>
                            <p className={["text-sm font-semibold", isActive ? "text-black" : "text-white group-hover:text-black"].join(" ")}>{option.label}</p>
                            <p className={["mt-1 text-xs leading-5", isActive ? "text-black/55" : "text-neutral-600 group-hover:text-black/55"].join(" ")}>{option.description}</p>
                          </button>
                        );
                      })}
                    </div>

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
                              <p className="mt-0.5 text-[10px] text-neutral-700">{new Date(record.timestamp).toLocaleString()}</p>
                            </div>
                            <span className="cf-badge shrink-0">{record.status}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </SettingCard>

                  <SettingCard
                    icon={<ShieldCheck size={18} />}
                    label="Context safety"
                    title="Context blocking mode"
                    description="Control when ContextForge should stop automatic prompt generation and ask for manual file review."
                  >
                    <div className="grid gap-3 md:grid-cols-3">
                      {[
                        {
                          value: "advisory" as const,
                          label: "Warn only",
                          caption: "Fastest. Never blocks automatic Task Packs; weak context is shown as warnings."
                        },
                        {
                          value: "balanced" as const,
                          label: "Balanced",
                          caption: "Recommended. Blocks only clearly unsafe context, allows plausible fallback selections."
                        },
                        {
                          value: "strict" as const,
                          label: "Strict",
                          caption: "Most careful. Blocks low-confidence selections more often."
                        }
                      ].map((option) => {
                        const isActive = (settingsDraft?.contextQualityMode ?? "balanced") === option.value;

                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => updateSettingsDraft({ contextQualityMode: option.value })}
                            className={[
                              "group rounded-2xl border p-4 text-left transition duration-200",
                              isActive
                                ? "border-white bg-white text-black shadow-[0_12px_34px_rgba(255,255,255,0.10)]"
                                : "border-neutral-900 bg-black/35 text-neutral-400 hover:border-white hover:bg-white hover:text-black hover:shadow-[0_12px_34px_rgba(255,255,255,0.10)]"
                            ].join(" ")}
                          >
                            <div className="mb-3 flex items-center justify-between gap-3">
                              <span
                                className={[
                                  "grid size-9 place-items-center rounded-xl border transition",
                                  isActive
                                    ? "border-black/10 bg-black/5 text-black"
                                    : "border-neutral-800 bg-neutral-950 text-neutral-500 group-hover:border-black/10 group-hover:bg-black/5 group-hover:text-black"
                                ].join(" ")}
                              >
                                <ShieldCheck size={15} />
                              </span>

                              {isActive && <CheckCircle2 size={16} className="text-black" />}
                            </div>

                            <p className={["text-sm font-semibold transition", isActive ? "text-black" : "text-white group-hover:text-black"].join(" ")}>{option.label}</p>
                            <p className={["mt-1 text-xs leading-5 transition", isActive ? "text-black/55" : "text-neutral-600 group-hover:text-black/55"].join(" ")}>{option.caption}</p>
                          </button>
                        );
                      })}
                    </div>
                  </SettingCard>

                  <SettingCard
                    icon={<WandSparkles size={18} />}
                    label="Context Composer"
                    title={t("settings.fileCandidateLimits")}
                    description={t("settings.fileCandidateLimitsDesc")}
                  >
                    <div className="mb-5 grid gap-3 md:grid-cols-3">
                      {COMPOSER_LIMIT_PRESETS.map((preset) => {
                        const isActive = activePreset?.id === preset.id;

                        return (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() => updateComposerLimits(preset.limits)}
                            className={[
                              "group rounded-2xl border p-4 text-left transition duration-200",
                              isActive
                                ? "border-white bg-white text-black shadow-[0_12px_34px_rgba(255,255,255,0.10)]"
                                : "border-neutral-900 bg-black/35 text-neutral-400 hover:border-white hover:bg-white hover:text-black hover:shadow-[0_12px_34px_rgba(255,255,255,0.10)]"
                            ].join(" ")}
                          >
                            <div className="mb-3 flex items-center justify-between gap-3">
                              <span
                                className={[
                                  "grid size-9 place-items-center rounded-xl border transition",
                                  isActive
                                    ? "border-black/10 bg-black/5 text-black"
                                    : "border-neutral-800 bg-neutral-950 text-neutral-500 group-hover:border-black/10 group-hover:bg-black/5 group-hover:text-black"
                                ].join(" ")}
                              >
                                <Gauge size={15} />
                              </span>

                              {isActive && (
                                <CheckCircle2 size={16} className="text-black" />
                              )}
                            </div>

                            <p
                              className={[
                                "text-sm font-semibold transition",
                                isActive ? "text-black" : "text-white group-hover:text-black"
                              ].join(" ")}
                            >
                              {preset.label}
                            </p>

                            <p
                              className={[
                                "mt-1 text-xs transition",
                                isActive
                                  ? "text-black/55"
                                  : "text-neutral-600 group-hover:text-black/55"
                              ].join(" ")}
                            >
                              {preset.caption}
                            </p>
                          </button>
                        );
                      })}
                    </div>

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
                      {COMPOSER_LIMIT_ROWS.map((row) => (
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

              {activeSection === "interface" && (
                <>
                  <SectionHeader
                    icon={<PanelLeft size={13} />}
                    label={t("settings.interface")}
                    title={t("settings.navigationDensity")}
                    description={t("settings.navigationDensityDescription")}
                  />

                  <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
                    <div className="space-y-5">
                      <SettingCard
                        icon={<Languages size={18} />}
                        label={t("settings.language")}
                        title={t("settings.languageTitle")}
                        description={t("settings.languageDescription")}
                      >
                        <div className="grid gap-3 md:grid-cols-3">
                          {[
                            {
                              value: "system" as const,
                              label: t("settings.languageSystem")
                            },
                            {
                              value: "en" as const,
                              label: t("settings.languageEnglish")
                            },
                            {
                              value: "ru" as const,
                              label: t("settings.languageRussian")
                            }
                          ].map((option) => {
                            const isActive = currentLanguage === option.value;

                            return (
                              <button
                                key={option.value}
                                type="button"
                                onClick={() => handleLanguageChange(option.value)}
                                className={[
                                  "group relative overflow-hidden rounded-2xl border px-4 py-3 text-left transition duration-200",
                                  isActive
                                    ? "border-white bg-white text-black shadow-[0_12px_34px_rgba(255,255,255,0.10)]"
                                    : "border-neutral-900 bg-black/35 text-neutral-400 hover:border-white hover:bg-white hover:text-black"
                                ].join(" ")}
                              >
                                {isActive && (
                                  <motion.span
                                    layoutId="settings-language-active"
                                    className="absolute inset-0 bg-white"
                                    transition={{
                                      type: "spring",
                                      stiffness: 520,
                                      damping: 42,
                                      mass: 0.55
                                    }}
                                  />
                                )}

                                <span className="relative z-10 flex items-center justify-between gap-3">
                                  <span className="font-medium">
                                    {option.label}
                                  </span>

                                  <span className="cf-tech-label text-[10px] uppercase opacity-60">
                                    {option.value === "system"
                                      ? resolvedLanguage.toUpperCase()
                                      : option.value.toUpperCase()}
                                  </span>
                                </span>
                              </button>
                            );
                          })}
                        </div>

                        <div className="mt-4 rounded-2xl border border-neutral-900 bg-black/40 p-4">
                          <p className="text-sm font-medium text-white">
                            {t("settings.languageCurrent")}: {resolvedLanguage.toUpperCase()}
                          </p>

                          <p className="mt-1 text-sm leading-6 text-neutral-500">
                            {t("settings.languageSavedWithSettings")}
                          </p>
                        </div>
                      </SettingCard>

                      <SettingCard
                        icon={<PanelLeft size={18} />}
                        label={t("settings.sidebar")}
                        title={t("settings.navigationDensity")}
                        description={t("settings.navigationDensityDescription")}
                      >
                        <div className="space-y-3">
                          <ToggleSetting
                            label={t("settings.showSidebarDescriptions")}
                            description={t("settings.showSidebarDescriptionsDesc")}
                            checked={settingsDraft?.sidebarShowDescriptions ?? false}
                            onChange={(checked) =>
                              updateSettingsDraft({
                                sidebarShowDescriptions: checked
                              })
                            }
                          />
                        </div>
                      </SettingCard>

                      <SettingCard
                        icon={<Sparkles size={18} />}
                        label={t("settings.onboarding")}
                        title={t("settings.onboardingTitle")}
                        description={t("settings.onboardingDescription")}
                      >
                        <div className="space-y-3">
                          <ToggleSetting
                            label={t("settings.showOnboardingOnLaunch")}
                            description={t("settings.showOnboardingOnLaunchDesc")}
                            checked={settingsDraft?.onboardingEnabled ?? true}
                            onChange={(checked) =>
                              updateSettingsDraft({
                                onboardingEnabled: checked
                              })
                            }
                          />

                          <ToggleSetting
                            label={t("settings.repeatOnboardingDuringAlpha")}
                            description={t("settings.repeatOnboardingDuringAlphaDesc")}
                            checked={settingsDraft?.onboardingShowEveryLaunch ?? true}
                            onChange={(checked) =>
                              updateSettingsDraft({
                                onboardingShowEveryLaunch: checked
                              })
                            }
                          />
                        </div>

                        <div className="mt-4 rounded-2xl border border-neutral-900 bg-black/40 p-4">
                          <p className="text-sm font-medium text-white">
                            {settingsDraft?.onboardingEnabled === false
                              ? t("settings.onboardingLaunchOff")
                              : settingsDraft?.onboardingShowEveryLaunch === false
                                ? t("settings.onboardingFirstRunOnly")
                                : t("settings.onboardingEveryLaunch")}
                          </p>

                          <p className="mt-1 text-sm leading-6 text-neutral-500">
                            {t("settings.onboardingSavedWithSettings")}
                          </p>
                        </div>
                      </SettingCard>
                    </div>

                    <SettingCard
                      icon={<Sparkles size={18} />}
                      label={t("settings.layoutTip")}
                      title={t("settings.collapsibleSidebar")}
                      description={t("settings.collapsibleSidebarDesc")}
                    >
                      <div className="rounded-2xl border border-neutral-900 bg-black/40 p-4">
                        <p className="text-sm font-medium text-white">
                          {t("settings.recommendedSetup")}
                        </p>

                        <p className="mt-2 text-sm leading-6 text-neutral-500">
                          {t("settings.recommendedSetupDesc")}
                        </p>
                      </div>
                    </SettingCard>
                  </div>
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
                                {shortcut.label}
                              </p>

                              <p className="mt-1 text-sm leading-5 text-neutral-500">
                                {shortcut.description}
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
                </>
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
                        {appMeta.description}
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
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
