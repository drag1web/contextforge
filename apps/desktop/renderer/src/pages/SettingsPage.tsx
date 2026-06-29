import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  Circle,
  Cpu,
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
  WandSparkles,
  XCircle,
  type LucideIcon
} from "lucide-react";

import {
  getAppSettings,
  getOllamaModels,
  getOllamaStatus,
  updateAppSettings
} from "../api/client";

import type { AppSettings, OllamaModel, OllamaStatus } from "../types";
import { CustomSelect } from "../components/ui/CustomSelect";
import { appMeta } from "../config/appMeta";
import { keyboardShortcuts } from "../config/keyboardShortcuts";
import { TARGET_TOOL_OPTIONS } from "../components/ai/aiToolOptions";
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
  | "system";

type ComposerLimitKey = keyof AppSettings["composerFileLimits"];

const SETTINGS_SECTIONS: Array<{
  id: SettingsSectionId;
  label: string;
  labelKey: string;
  icon: LucideIcon;
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
      id: "system",
      label: "System",
      labelKey: "settings.system",
      icon: ShieldCheck
    }
  ];

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
  children
}: {
  icon: ReactNode;
  label: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <article className="cf-card p-5">
      <div className="mb-5 flex items-start justify-between gap-5">
        <div className="min-w-0">
          <div className="mb-3 flex size-10 items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-200">
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
      </div>

      {children}
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
      whileHover={disabled ? undefined : { y: -1 }}
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
      <span className="pointer-events-none absolute inset-0 opacity-0 transition duration-300 group-hover:opacity-100">
        <span className="absolute inset-y-0 -left-10 w-10 rotate-12 bg-white/30 blur-md transition duration-500 group-hover:left-[115%]" />
      </span>

      {pulse && !loading && !disabled && (
        <motion.span
          aria-hidden="true"
          className="absolute inset-0 rounded-full border border-white/30"
          animate={{
            opacity: [0.45, 0],
            scale: [1, 1.12]
          }}
          transition={{
            duration: 1.4,
            repeat: Infinity,
            ease: "easeOut"
          }}
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

function SettingsToast({
  type,
  title,
  message,
  actionLabel,
  onAction,
  disabled
}: {
  type: "warning" | "success" | "error";
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  disabled?: boolean;
}) {
  const Icon =
    type === "success"
      ? CheckCircle2
      : type === "error"
        ? XCircle
        : AlertTriangle;

  return (
    <motion.div
      initial={{ opacity: 0, y: 18, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 12, scale: 0.98 }}
      transition={{
        type: "spring",
        stiffness: 420,
        damping: 34,
        mass: 0.7
      }}
      className="fixed bottom-6 right-7 z-50 w-[360px] overflow-hidden rounded-[1.35rem] border border-white/10 bg-neutral-950/95 p-4 shadow-[0_24px_70px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.055)] backdrop-blur-xl"
    >
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.055),rgba(255,255,255,0.012)_45%,rgba(255,255,255,0.004))]" />

      <div className="relative z-10 flex items-start gap-3">
        <span
          className={[
            "grid size-10 shrink-0 place-items-center rounded-2xl border",
            type === "success"
              ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
              : type === "error"
                ? "border-red-400/25 bg-red-400/10 text-red-300"
                : "border-white/15 bg-white/10 text-white"
          ].join(" ")}
        >
          <Icon size={17} />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">{title}</p>

          <p className="mt-1 text-sm leading-5 text-neutral-500">
            {message}
          </p>

          {actionLabel && onAction && (
            <button
              type="button"
              onClick={onAction}
              disabled={disabled}
              className="cf-invert-action mt-3 inline-flex h-8 items-center rounded-full px-3 text-xs disabled:pointer-events-none disabled:opacity-50"
            >
              {actionLabel}
            </button>
          )}
        </div>
      </div>
    </motion.div>
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
    <aside className="cf-card sticky top-5 h-fit p-2">
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
        <motion.span
          aria-hidden="true"
          className="absolute left-0 right-0 top-0 rounded-2xl bg-white shadow-[0_14px_34px_rgba(255,255,255,0.12)]"
          style={{
            height: SETTINGS_NAV_ITEM_HEIGHT,
            willChange: "transform"
          }}
          initial={false}
          animate={{
            y:
              activeIndex *
              (SETTINGS_NAV_ITEM_HEIGHT + SETTINGS_NAV_ITEM_GAP)
          }}
          transition={{
            type: "spring",
            stiffness: 520,
            damping: 42,
            mass: 0.55
          }}
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
                {t(section.labelKey)}
              </span>
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
            className="absolute left-0 top-1/2 h-2 origin-left -translate-y-1/2 rounded-full bg-white shadow-[0_0_18px_rgba(255,255,255,0.32),0_0_34px_rgba(255,255,255,0.12)]"
            initial={false}
            animate={{ width: `${percent}%` }}
            transition={{
              type: "spring",
              stiffness: 420,
              damping: 36,
              mass: 0.65
            }}
            style={{ willChange: "width" }}
          />

          <motion.div
            aria-hidden="true"
            className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/20 bg-white shadow-[0_0_18px_rgba(255,255,255,0.38)]"
            initial={false}
            animate={{ left: `${percent}%` }}
            transition={{
              type: "spring",
              stiffness: 420,
              damping: 36,
              mass: 0.65
            }}
            style={{ willChange: "left" }}
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

export function SettingsPage() {
  const { t } = useTranslation();
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("ai");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<AppSettings | null>(null);
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null);
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [notice, setNotice] = useState(() => t("settings.readyNotice"));

  const [activeAction, setActiveAction] = useState<"refresh" | "save" | null>(null);
  const [toast, setToast] = useState<{
    type: "success" | "error";
    title: string;
    message: string;
  } | null>(null);

  const hasUnsavedChanges = useMemo(() => {
    return !isSameSettings(settings, settingsDraft);
  }, [settings, settingsDraft]);

  const composerLimits = settingsDraft?.composerFileLimits ?? DEFAULT_COMPOSER_FILE_LIMITS;
  const activePreset = getActivePreset(composerLimits);
  const currentLanguage = (settingsDraft?.language ?? "system") as AppLanguage;
  const resolvedLanguage = resolveAppLanguage(currentLanguage);

  function handleLanguageChange(language: AppLanguage) {
    updateSettingsDraft({ language });
    void applyAppLanguage(language);
  }

  function updateSettingsDraft(patch: Partial<AppSettings>) {
    setToast(null);

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

      const [appSettings, status, modelList] = await Promise.all([
        getAppSettings(),
        getOllamaStatus(),
        getOllamaModels()
      ]);

      const normalizedSettings = withSettingsDefaults(appSettings);

      setSettings(normalizedSettings);
      setSettingsDraft(normalizedSettings);
      void applyAppLanguage(normalizedSettings.language ?? "system");
      setOllamaStatus(status);
      setModels(modelList);
      setNotice(t("settings.loadedNotice"));

      setToast({
        type: "success",
        title: t("settings.refreshedTitle"),
        message: t("settings.refreshedMessage")
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("settings.loadFailed");

      setNotice(message);

      setToast({
        type: "error",
        title: t("settings.refreshFailed"),
        message
      });
    } finally {
      setIsLoading(false);
      setActiveAction(null);
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
      setNotice(t("settings.savedNotice"));

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

      setToast({
        type: "success",
        title: t("settings.savedTitle"),
        message: t("settings.savedMessage")
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("settings.saveFailedMessage");

      setNotice(message);

      setToast({
        type: "error",
        title: t("settings.saveFailed"),
        message
      });
    } finally {
      setIsLoading(false);
      setActiveAction(null);
    }
  }

  useEffect(() => {
    loadOllamaInfo();
  }, []);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setToast(null);
    }, 2400);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [toast]);

  return (
    <section className="space-y-5">
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

      <div className="rounded-2xl border border-neutral-900 bg-black/45 px-4 py-3 text-sm text-neutral-400">
        {notice}
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
              style={{ willChange: "opacity, transform" }}
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
                          ollama pull llama3.1
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

                  <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
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
                            options={[
                              {
                                value: "",
                                label: t("settings.noModelSelected"),
                                description: t("settings.useTemplateOnly")
                              },
                              ...models.map((model) => ({
                                value: model.name,
                                label: model.name,
                                description: formatModelSize(model.size)
                              }))
                            ]}
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

                  <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
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

              {activeSection === "system" && (
                <>
                  <SectionHeader
                    icon={<ShieldCheck size={13} />}
                    label={t("settings.system")}
                    title={t("settings.systemTitle")}
                    description={t("settings.systemDescription")}
                  />

                  <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
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
      <AnimatePresence>
        {toast?.type === "error" ? (
          <SettingsToast
            key="settings-error-toast"
            type="error"
            title={toast.title}
            message={toast.message}
          />
        ) : hasUnsavedChanges ? (
          <SettingsToast
            key="settings-unsaved-toast"
            type="warning"
            title={t("settings.unsavedTitle")}
            message={t("settings.unsavedMessage")}
            actionLabel={t("common.saveChanges")}
            onAction={handleSaveSettings}
            disabled={isLoading || !settingsDraft}
          />
        ) : toast?.type === "success" ? (
          <SettingsToast
            key="settings-success-toast"
            type="success"
            title={toast.title}
            message={toast.message}
          />
        ) : null}
      </AnimatePresence>
    </section>
  );
}
