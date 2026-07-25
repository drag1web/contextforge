import {
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import {
  Bot,
  CheckCircle2,
  Cloud,
  Code2,
  Cpu,
  ExternalLink,
  GitBranch,
  Github,
  KeyRound,
  Layers3,
  Loader2,
  LockKeyhole,
  PlugZap,
  Puzzle,
  RefreshCw,
  Save,
  Server,
  Settings2,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  WifiOff,
  Workflow,
} from "lucide-react";
import { siOllama } from "simple-icons/icons";

import {
  getAiIntegrationModels,
  getAiIntegrationStatus,
  getAppSettings,
  updateAppSettings,
} from "../api/client";
import { AiToolLogo } from "../components/ai/AiToolLogo";
import {
  getAiToolDescription,
  getAiToolLabel,
} from "../components/ai/aiToolOptions";
import { WorkspacePageHeader } from "../components/layout/WorkspacePageHeader";
import { Button } from "../components/ui/Button";
import { CustomSelect, type SelectOption } from "../components/ui/CustomSelect";
import { HorizontalSlidingSelector } from "../components/ui/SlidingSelectors";
import type {
  AiProviderId,
  AiProviderModel,
  AiProviderStatus,
  AppSettings,
} from "../types";

type IntegrationTab = "overview" | "providers" | "connections" | "security";

const TAB_TRANSITION = {
  duration: 0.22,
  ease: [0.16, 1, 0.3, 1],
} as const;

const PROVIDER_CARD_TRANSITION = {
  type: "spring",
  stiffness: 560,
  damping: 44,
  mass: 0.55,
} as const;

const PROVIDER_IDS: AiProviderId[] = [
  "ollama",
  "openai-compatible",
  "anthropic",
  "gemini",
];

function providerName(provider: AiProviderId) {
  if (provider === "openai-compatible") {
    return "OpenAI-compatible";
  }

  if (provider === "anthropic") {
    return "Claude API";
  }

  if (provider === "gemini") {
    return "Gemini";
  }

  return "Ollama";
}

interface SimpleBrandIcon {
  title: string;
  path: string;
}

function MonochromeBrandLogo({
  icon,
  contrast = false,
}: {
  icon: SimpleBrandIcon;
  contrast?: boolean;
}) {
  return (
    <span
      className={[
        "grid size-9 shrink-0 place-items-center rounded-2xl border",
        contrast
          ? "border-black/10 bg-black/5 text-black"
          : "border-neutral-800 bg-neutral-950 text-neutral-200",
      ].join(" ")}
      title={icon.title}
    >
      <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
        <path fill="currentColor" d={icon.path} />
      </svg>
    </span>
  );
}

function providerIcon(provider: AiProviderId, contrast = false) {
  if (provider === "openai-compatible") {
    return (
      <AiToolLogo
        tool="openai"
        size="lg"
        contrast={contrast ? "onLight" : "default"}
        className={
          contrast
            ? "!border-black/10 !bg-black/5 [&>svg]:brightness-0"
            : "!border-neutral-800 !bg-neutral-950 [&>svg]:brightness-0 [&>svg]:invert"
        }
      />
    );
  }

  if (provider === "anthropic") {
    return (
      <AiToolLogo
        tool="anthropic"
        size="lg"
        contrast={contrast ? "onLight" : "default"}
        className={
          contrast
            ? "!border-black/10 !bg-black/5 [&>svg]:brightness-0"
            : "!border-neutral-800 !bg-neutral-950 [&>svg]:brightness-0 [&>svg]:invert"
        }
      />
    );
  }

  if (provider === "gemini") {
    return (
      <AiToolLogo
        tool="gemini"
        size="lg"
        contrast={contrast ? "onLight" : "default"}
        className={
          contrast
            ? "!border-black/10 !bg-black/5 [&>svg]:brightness-0"
            : "!border-neutral-800 !bg-neutral-950 [&>svg]:brightness-0 [&>svg]:invert"
        }
      />
    );
  }

  return (
    <MonochromeBrandLogo
      icon={siOllama as SimpleBrandIcon}
      contrast={contrast}
    />
  );
}

function formatModelSize(size?: number, unknownLabel = "Unknown size") {
  if (!size) {
    return unknownLabel;
  }

  const gb = size / 1024 / 1024 / 1024;

  if (gb >= 1) {
    return `${gb.toFixed(1)} GB`;
  }

  return `${(size / 1024 / 1024).toFixed(0)} MB`;
}

function withSettingsDefaults(settings: AppSettings): AppSettings {
  return {
    ...settings,
    aiProvider: settings.aiProvider ?? "ollama",
    openAiCompatibleBaseUrl:
      settings.openAiCompatibleBaseUrl ?? "http://localhost:1234/v1",
    openAiCompatibleModel: settings.openAiCompatibleModel ?? null,
    openAiCompatibleApiKeyConfigured:
      settings.openAiCompatibleApiKeyConfigured ?? false,
    geminiBaseUrl:
      settings.geminiBaseUrl ??
      "https://generativelanguage.googleapis.com/v1beta",
    geminiModel: settings.geminiModel ?? "gemini-1.5-flash",
    geminiApiKeyConfigured: settings.geminiApiKeyConfigured ?? false,
    anthropicBaseUrl:
      settings.anthropicBaseUrl ?? "https://api.anthropic.com/v1",
    anthropicModel: settings.anthropicModel ?? "claude-3-5-sonnet-latest",
    anthropicApiKeyConfigured: settings.anthropicApiKeyConfigured ?? false,
  };
}

function SurfaceCard({
  icon,
  eyebrow,
  title,
  description,
  action,
  children,
  className = "",
  iconTone = "neutral",
}: {
  icon: ReactNode;
  eyebrow: string;
  title: string;
  description?: string;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  iconTone?: "neutral" | "emerald" | "violet" | "sky" | "amber";
}) {
  void iconTone;
  const iconToneClass =
    "border-neutral-800 bg-neutral-950 text-neutral-300";

  return (
    <article className={["cf-card p-5", className].join(" ")}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={[
              "grid size-10 shrink-0 place-items-center rounded-2xl border",
              iconToneClass,
            ].join(" ")}
          >
            {icon}
          </span>
          <div className="min-w-0">
            <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
              {eyebrow}
            </p>
            <h3 className="mt-1 text-lg font-semibold tracking-[-0.025em] text-white">
              {title}
            </h3>
            {description ? (
              <p className="mt-1 max-w-3xl text-sm leading-6 text-neutral-500">
                {description}
              </p>
            ) : null}
          </div>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children ? <div className="mt-5">{children}</div> : null}
    </article>
  );
}

function StatusPill({
  label,
  tone = "neutral",
  icon,
}: {
  label: string;
  tone?: "positive" | "warning" | "neutral";
  icon?: ReactNode;
}) {
  const toneClass =
    tone === "positive"
      ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
      : tone === "warning"
        ? "border-amber-400/20 bg-amber-400/10 text-amber-200"
        : "border-neutral-800 bg-neutral-950 text-neutral-500";

  return (
    <span
      className={[
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium",
        toneClass,
      ].join(" ")}
    >
      {icon}
      {label}
    </span>
  );
}

function SummaryMetric({
  label,
  value,
  caption,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: string;
  caption: string;
  icon: ReactNode;
  tone?: "neutral" | "emerald" | "violet" | "sky" | "amber";
}) {
  void tone;
  const iconToneClass =
    "border-neutral-800 bg-neutral-950 text-neutral-500";

  return (
    <div className="relative overflow-hidden rounded-2xl border border-neutral-900 bg-black/30 p-4">
      <div
        aria-hidden="true"
        className={[
          "absolute inset-x-4 top-0 h-px opacity-70",
          "bg-white/10",
        ].join(" ")}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="cf-tech-label text-[9px] uppercase text-neutral-700">
            {label}
          </p>
          <p className="mt-2 truncate text-base font-semibold text-white">
            {value}
          </p>
          <p className="mt-1 truncate text-xs text-neutral-600">{caption}</p>
        </div>
        <span
          className={[
            "grid size-9 shrink-0 place-items-center rounded-xl border",
            iconToneClass,
          ].join(" ")}
        >
          {icon}
        </span>
      </div>
    </div>
  );
}

function ProviderCardSelector({
  value,
  disabled = false,
  onChange,
  getCopy,
}: {
  value: AiProviderId;
  disabled?: boolean;
  onChange: (provider: AiProviderId) => void;
  getCopy: (provider: AiProviderId) => {
    meta: string;
    description: string;
    notes: string[];
  };
}) {
  const activeIndex = Math.max(0, PROVIDER_IDS.indexOf(value));

  return (
    <div className="overflow-x-auto pb-1">
      <div className="relative grid min-w-[760px] grid-cols-4 overflow-hidden rounded-[1.65rem] border border-white/10 bg-black/55 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.055)]">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.055),rgba(255,255,255,0.01)_44%,rgba(255,255,255,0.004))]" />

        <motion.div
          aria-hidden="true"
          className="absolute bottom-1 left-1 top-1 rounded-[1.35rem] bg-white shadow-[0_18px_46px_rgba(255,255,255,0.14)]"
          style={{
            width: `calc((100% - 8px) / ${PROVIDER_IDS.length})`,
            willChange: "transform",
          }}
          initial={false}
          animate={{ x: `${activeIndex * 100}%` }}
          transition={PROVIDER_CARD_TRANSITION}
        />

        {PROVIDER_IDS.map((provider) => {
          const active = provider === value;
          const copy = getCopy(provider);

          return (
            <button
              key={provider}
              type="button"
              onClick={() => onChange(provider)}
              disabled={disabled}
              className={[
                "group relative z-10 min-w-0 rounded-[1.35rem] p-4 text-left transition-colors duration-150 disabled:pointer-events-none disabled:opacity-45",
                active ? "text-black" : "text-neutral-500 hover:text-white",
              ].join(" ")}
            >
              <div className="mb-4 flex items-start justify-between gap-4">
                <span
                  className={[
                    "grid size-10 place-items-center rounded-2xl border transition-colors duration-150",
                    active
                      ? "border-black/10 bg-black/5 text-black"
                      : "border-neutral-800 bg-neutral-950 text-neutral-500 group-hover:border-white/15 group-hover:text-white",
                  ].join(" ")}
                >
                  {providerIcon(provider, active)}
                </span>

                {active ? <CheckCircle2 size={17} className="text-black" /> : null}
              </div>

              <span
                className={[
                  "mb-3 inline-flex rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] transition-colors duration-150",
                  active
                    ? "border-black/10 text-black/55"
                    : "border-neutral-800 text-neutral-600 group-hover:text-neutral-400",
                ].join(" ")}
              >
                {copy.meta}
              </span>

              <h3
                className={[
                  "truncate text-base font-semibold transition-colors duration-150",
                  active ? "text-black" : "text-white group-hover:text-white",
                ].join(" ")}
              >
                {providerName(provider)}
              </h3>

              <p
                className={[
                  "mt-2 line-clamp-2 text-sm leading-6 transition-colors duration-150",
                  active
                    ? "text-black/60"
                    : "text-neutral-600 group-hover:text-neutral-400",
                ].join(" ")}
              >
                {copy.description}
              </p>

              <div className="mt-5 space-y-2">
                {copy.notes.map((note) => (
                  <span
                    key={note}
                    className={[
                      "flex items-center gap-2 text-xs transition-colors duration-150",
                      active
                        ? "text-black/55"
                        : "text-neutral-700 group-hover:text-neutral-500",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "size-1.5 rounded-full",
                        active ? "bg-black/35" : "bg-neutral-700",
                      ].join(" ")}
                    />
                    {note}
                  </span>
                ))}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  caption,
}: {
  label: string;
  children: ReactNode;
  caption?: string;
}) {
  return (
    <label className="block rounded-2xl border border-neutral-900 bg-black/35 p-4">
      <span className="cf-tech-label text-[10px] uppercase text-neutral-600">
        {label}
      </span>
      <div className="mt-3">{children}</div>
      {caption ? (
        <p className="mt-2 text-xs leading-5 text-neutral-600">{caption}</p>
      ) : null}
    </label>
  );
}

function ConnectionCard({
  icon,
  title,
  description,
  status,
  statusTone,
  actionLabel,
  onAction,
  iconTone = "neutral",
}: {
  icon: ReactNode;
  title: string;
  description: string;
  status: string;
  statusTone: "positive" | "warning" | "neutral";
  actionLabel?: string;
  onAction?: () => void;
  iconTone?: "neutral" | "emerald" | "violet" | "sky" | "amber";
}) {
  void iconTone;
  const iconToneClass =
    "border-neutral-800 bg-neutral-950 text-neutral-400";

  return (
    <div className="relative overflow-hidden rounded-[1.35rem] border border-neutral-900 bg-black/30 p-5">
      <div className="flex items-start justify-between gap-4">
        <span
          className={[
            "grid size-10 shrink-0 place-items-center rounded-2xl border",
            iconToneClass,
          ].join(" ")}
        >
          {icon}
        </span>
        <StatusPill label={status} tone={statusTone} />
      </div>
      <h4 className="mt-5 text-base font-semibold text-white">{title}</h4>
      <p className="mt-2 min-h-[48px] text-sm leading-6 text-neutral-500">
        {description}
      </p>
      {actionLabel && onAction ? (
        <Button
          type="button"
          variant="secondary"
          onClick={onAction}
          className="mt-5 w-full"
        >
          <ExternalLink size={14} />
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

function BoundaryList({
  title,
  icon,
  items,
  tone,
}: {
  title: string;
  icon: ReactNode;
  items: string[];
  tone: "local" | "external";
}) {
  return (
    <div className="rounded-[1.35rem] border border-neutral-900 bg-black/30 p-5">
      <div className="flex items-center gap-3">
        <span
          className={[
            "grid size-10 place-items-center rounded-2xl border",
            "border-neutral-800 bg-neutral-950 text-neutral-400",
          ].join(" ")}
        >
          {icon}
        </span>
        <h4 className="text-base font-semibold text-white">{title}</h4>
      </div>
      <div className="mt-5 space-y-2">
        {items.map((item) => (
          <div
            key={item}
            className="flex items-start gap-3 rounded-xl border border-neutral-900 bg-black/30 px-3 py-2.5"
          >
            {tone === "local" ? (
              <CheckCircle2 size={14} className="mt-0.5 text-neutral-300" />
            ) : (
              <ExternalLink size={14} className="mt-0.5 text-neutral-500" />
            )}
            <span className="text-xs leading-5 text-neutral-500">{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function IntegrationsPage({
  onOpenGitHub,
  onOpenSettings,
  onOpenAccountSync,
}: {
  onOpenGitHub?: () => void;
  onOpenSettings?: () => void;
  onOpenAccountSync?: () => void;
}) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<IntegrationTab>("overview");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [status, setStatus] = useState<AiProviderStatus | null>(null);
  const [models, setModels] = useState<AiProviderModel[]>([]);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [geminiApiKeyDraft, setGeminiApiKeyDraft] = useState("");
  const [anthropicApiKeyDraft, setAnthropicApiKeyDraft] = useState("");
  const [clearApiKey, setClearApiKey] = useState(false);
  const [clearGeminiApiKey, setClearGeminiApiKey] = useState(false);
  const [clearAnthropicApiKey, setClearAnthropicApiKey] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [activeAction, setActiveAction] = useState<"refresh" | "save" | null>(null);
  const [saveFeedback, setSaveFeedback] = useState<"idle" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  const tabs = useMemo(
    () => [
      { id: "overview" as const, label: t("integrationsHub.tabs.overview"), icon: <Layers3 size={14} /> },
      { id: "providers" as const, label: t("integrationsHub.tabs.providers"), icon: <Server size={14} /> },
      { id: "connections" as const, label: t("integrationsHub.tabs.connections"), icon: <PlugZap size={14} /> },
      { id: "security" as const, label: t("integrationsHub.tabs.security"), icon: <ShieldCheck size={14} /> },
    ],
    [t],
  );

  const activeTabIndex = Math.max(0, tabs.findIndex((tab) => tab.id === activeTab));

  const generationModeOptions = useMemo<SelectOption<AppSettings["generationMode"]>[]>(
    () => [
      {
        value: "template",
        label: t("integrationsHub.providerSetup.templateMode"),
        description: t("integrationsHub.providerSetup.templateModeDescription"),
        icon: <ShieldCheck size={15} />,
      },
      {
        value: "ollama",
        label: t("integrationsHub.providerSetup.assistedMode"),
        description: t("integrationsHub.providerSetup.assistedModeDescription"),
        icon: <Sparkles size={15} />,
      },
    ],
    [t],
  );

  const providerConfigChanged = useMemo(() => {
    if (!settings || !draft) {
      return false;
    }

    if (settings.aiProvider !== draft.aiProvider) {
      return true;
    }

    if (draft.aiProvider === "ollama") {
      return settings.ollamaUrl !== draft.ollamaUrl;
    }

    if (draft.aiProvider === "openai-compatible") {
      return (
        settings.openAiCompatibleBaseUrl !== draft.openAiCompatibleBaseUrl ||
        settings.openAiCompatibleModel !== draft.openAiCompatibleModel ||
        apiKeyDraft.trim().length > 0 ||
        clearApiKey
      );
    }

    if (draft.aiProvider === "anthropic") {
      return (
        settings.anthropicBaseUrl !== draft.anthropicBaseUrl ||
        settings.anthropicModel !== draft.anthropicModel ||
        anthropicApiKeyDraft.trim().length > 0 ||
        clearAnthropicApiKey
      );
    }

    return (
      settings.geminiBaseUrl !== draft.geminiBaseUrl ||
      settings.geminiModel !== draft.geminiModel ||
      geminiApiKeyDraft.trim().length > 0 ||
      clearGeminiApiKey
    );
  }, [
    apiKeyDraft,
    anthropicApiKeyDraft,
    clearApiKey,
    clearAnthropicApiKey,
    clearGeminiApiKey,
    draft,
    geminiApiKeyDraft,
    settings,
  ]);

  const hasUnsavedChanges = useMemo(() => {
    if (!settings || !draft) {
      return false;
    }

    return (
      JSON.stringify(settings) !== JSON.stringify(draft) ||
      apiKeyDraft.trim().length > 0 ||
      geminiApiKeyDraft.trim().length > 0 ||
      anthropicApiKeyDraft.trim().length > 0 ||
      clearApiKey ||
      clearGeminiApiKey ||
      clearAnthropicApiKey
    );
  }, [
    apiKeyDraft,
    anthropicApiKeyDraft,
    clearApiKey,
    clearAnthropicApiKey,
    clearGeminiApiKey,
    draft,
    geminiApiKeyDraft,
    settings,
  ]);

  const activeProvider = settings?.aiProvider ?? null;
  const selectedProvider = draft?.aiProvider ?? null;
  const providerSelectionChanged = Boolean(
    settings && draft && settings.aiProvider !== draft.aiProvider,
  );
  const activeStatus = Boolean(
    settings && status && status.provider === settings.aiProvider,
  )
    ? status
    : null;

  const statusMatchesDraft = Boolean(
    draft && status && status.provider === draft.aiProvider && !providerConfigChanged,
  );
  const visibleStatus = statusMatchesDraft ? status : null;
  const visibleModels = useMemo(
    () =>
      draft && statusMatchesDraft
        ? models.filter((model) => model.provider === draft.aiProvider)
        : [],
    [draft, models, statusMatchesDraft],
  );

  function getSelectedModel(config: AppSettings | null) {
    if (!config) {
      return null;
    }

    if (config.aiProvider === "openai-compatible") {
      return config.openAiCompatibleModel;
    }

    if (config.aiProvider === "anthropic") {
      return config.anthropicModel;
    }

    if (config.aiProvider === "gemini") {
      return config.geminiModel;
    }

    return config.defaultOllamaModel;
  }

  function getProviderSecurityLabel(config: AppSettings | null) {
    if (!config) {
      return t("common.unknown");
    }

    if (config.aiProvider === "ollama") {
      return t("integrationsHub.summary.noApiKey");
    }

    const configured =
      config.aiProvider === "openai-compatible"
        ? config.openAiCompatibleApiKeyConfigured
        : config.aiProvider === "anthropic"
          ? config.anthropicApiKeyConfigured
          : config.geminiApiKeyConfigured;

    return configured
      ? t("integrationsHub.summary.keySaved")
      : t("integrationsHub.summary.noKeySaved");
  }

  const selectedModel = useMemo(() => getSelectedModel(draft), [draft]);
  const activeModel = useMemo(() => getSelectedModel(settings), [settings]);
  const providerSecurityLabel = useMemo(
    () => getProviderSecurityLabel(draft),
    [draft, t],
  );
  const activeProviderSecurityLabel = useMemo(
    () => getProviderSecurityLabel(settings),
    [settings, t],
  );

  async function refresh() {
    try {
      setError(null);
      setIsLoading(true);
      setActiveAction("refresh");

      const [nextSettings, nextStatus, nextModels] = await Promise.all([
        getAppSettings(),
        getAiIntegrationStatus(),
        getAiIntegrationModels(),
      ]);
      const normalized = withSettingsDefaults(nextSettings);

      setSettings(normalized);
      setDraft(normalized);
      setStatus(nextStatus);
      setModels(nextModels);
      setApiKeyDraft("");
      setGeminiApiKeyDraft("");
      setAnthropicApiKeyDraft("");
      setClearApiKey(false);
      setClearGeminiApiKey(false);
      setClearAnthropicApiKey(false);
      setSaveFeedback("idle");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : t("integrationsHub.errors.load"),
      );
    } finally {
      setIsLoading(false);
      setActiveAction(null);
    }
  }

  async function save() {
    if (!draft) {
      return;
    }

    try {
      setError(null);
      setIsLoading(true);
      setActiveAction("save");

      const updatedSettings = withSettingsDefaults(
        await updateAppSettings({
          ...draft,
          openAiCompatibleApiKey: apiKeyDraft.trim() || undefined,
          clearOpenAiCompatibleApiKey: clearApiKey,
          geminiApiKey: geminiApiKeyDraft.trim() || undefined,
          clearGeminiApiKey,
          anthropicApiKey: anthropicApiKeyDraft.trim() || undefined,
          clearAnthropicApiKey,
        }),
      );

      window.dispatchEvent(
        new CustomEvent("contextforge:settings-updated", {
          detail: updatedSettings,
        }),
      );

      const [nextStatus, nextModels] = await Promise.all([
        getAiIntegrationStatus(),
        getAiIntegrationModels(),
      ]);

      setSettings(updatedSettings);
      setDraft(updatedSettings);
      setStatus(nextStatus);
      setModels(nextModels);
      setApiKeyDraft("");
      setGeminiApiKeyDraft("");
      setAnthropicApiKeyDraft("");
      setClearApiKey(false);
      setClearGeminiApiKey(false);
      setClearAnthropicApiKey(false);
      setSaveFeedback("saved");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : t("integrationsHub.errors.save"),
      );
    } finally {
      setIsLoading(false);
      setActiveAction(null);
    }
  }

  function updateDraft(patch: Partial<AppSettings>) {
    setSaveFeedback("idle");
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (hasUnsavedChanges && saveFeedback === "saved") {
      setSaveFeedback("idle");
    }
  }, [hasUnsavedChanges, saveFeedback]);

  const headerAside = (
    <div className="min-w-[460px] overflow-hidden rounded-2xl border border-neutral-900 bg-black/35">
      <div className="grid grid-cols-3">
        <div className="border-r border-neutral-900 px-4 py-3">
          <p className="cf-tech-label text-[9px] uppercase text-neutral-700">
            {t("integrationsHub.summary.activeProvider")}
          </p>
          <p className="mt-1 text-sm font-semibold text-white">
            {activeProvider ? providerName(activeProvider) : "—"}
          </p>
        </div>
        <div className="border-r border-neutral-900 px-4 py-3">
          <p className="cf-tech-label text-[9px] uppercase text-neutral-700">
            {t("integrationsHub.summary.status")}
          </p>
          <p className="mt-1 flex items-center gap-2 text-sm font-semibold text-white">
            <span
              className={[
                "size-1.5 rounded-full",
                activeStatus?.online ? "bg-emerald-400" : "bg-neutral-700",
              ].join(" ")}
            />
            {activeStatus?.online
              ? t("integrationsHub.status.connected")
              : t("integrationsHub.status.notConnected")}
          </p>
        </div>
        <div className="px-4 py-3">
          <p className="cf-tech-label text-[9px] uppercase text-neutral-700">
            {t("integrationsHub.summary.target")}
          </p>
          <p className="mt-1 text-sm font-semibold text-white">
            {settings ? getAiToolLabel(settings.defaultTargetTool) : "—"}
          </p>
        </div>
      </div>

      {hasUnsavedChanges && selectedProvider ? (
        <div className="flex items-center justify-between gap-4 border-t border-amber-400/15 bg-amber-400/[0.045] px-4 py-2">
          <span className="flex min-w-0 items-center gap-2 text-xs text-amber-100/80">
            <Save size={12} className="shrink-0 text-amber-300" />
            <span className="truncate">
              {t("integrationsHub.summary.draftProvider")}: {providerName(selectedProvider)}
            </span>
          </span>
          <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.14em] text-amber-300/80">
            {t("integrationsHub.status.notApplied")}
          </span>
        </div>
      ) : null}
    </div>
  );

  return (
    <section className="space-y-5 text-render-crisp">
      <WorkspacePageHeader
        icon={<PlugZap size={18} />}
        eyebrow={t("integrationsHub.eyebrow")}
        title={t("integrationsHub.title")}
        description={t("integrationsHub.description")}
        aside={headerAside}
        headingLevel={1}
      />

      {error ? (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between gap-4 rounded-2xl border border-red-400/25 bg-red-950/20 px-4 py-3 text-sm text-red-200"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-xs text-red-200/70 transition hover:text-red-100"
          >
            {t("integrationsHub.actions.dismiss")}
          </button>
        </motion.div>
      ) : null}

      <HorizontalSlidingSelector
        items={tabs}
        activeIndex={activeTabIndex}
        getItemKey={(tab) => tab.id}
        onSelect={(tab) => setActiveTab(tab.id)}
        ariaLabel={t("integrationsHub.tabs.label")}
        itemClassName="min-h-[54px] rounded-xl px-4"
        renderItem={(tab, active) => (
          <span className="flex items-center justify-center gap-2">
            {tab.icon}
            <span className={active ? "font-semibold text-black" : "font-medium"}>
              {tab.label}
            </span>
          </span>
        )}
      />

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -5 }}
          transition={TAB_TRANSITION}
        >
          {activeTab === "overview" ? (
            <div className="space-y-5">
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.65fr)]">
                <SurfaceCard
                  icon={<Workflow size={17} />}
                  eyebrow={t("integrationsHub.overview.pipelineEyebrow")}
                  title={t("integrationsHub.overview.pipelineTitle")}
                  description={t("integrationsHub.overview.pipelineDescription")}
                  iconTone="violet"
                  action={
                    <Button type="button" variant="secondary" onClick={onOpenSettings} disabled={!onOpenSettings}>
                      <Settings2 size={14} />
                      {t("integrationsHub.actions.generationSettings")}
                    </Button>
                  }
                >
                  <div className="grid gap-3 md:grid-cols-4">
                    <SummaryMetric
                      label={t("integrationsHub.overview.contextLabel")}
                      value={t("integrationsHub.overview.localContext")}
                      caption={t("integrationsHub.overview.localContextCaption")}
                      icon={<Layers3 size={15} />}
                      tone="sky"
                    />
                    <SummaryMetric
                      label={t("integrationsHub.overview.providerLabel")}
                      value={settings ? providerName(settings.aiProvider) : "—"}
                      caption={
                        settings?.generationMode === "ollama"
                          ? t("integrationsHub.overview.assistedCaption")
                          : t("integrationsHub.overview.templateCaption")
                      }
                      icon={<Server size={15} />}
                      tone="violet"
                    />
                    <SummaryMetric
                      label={t("integrationsHub.overview.outputLabel")}
                      value={settings ? getAiToolLabel(settings.defaultTargetTool) : "—"}
                      caption={t("integrationsHub.overview.outputCaption")}
                      icon={<Bot size={15} />}
                      tone="amber"
                    />
                    <SummaryMetric
                      label={t("integrationsHub.overview.boundaryLabel")}
                      value={t("integrationsHub.overview.localFirst")}
                      caption={t("integrationsHub.overview.boundaryCaption")}
                      icon={<ShieldCheck size={15} />}
                      tone="emerald"
                    />
                  </div>
                </SurfaceCard>

                <SurfaceCard
                  icon={activeStatus?.online ? <CheckCircle2 size={17} /> : <WifiOff size={17} />}
                  iconTone={activeStatus?.online ? "emerald" : "amber"}
                  eyebrow={t("integrationsHub.overview.healthEyebrow")}
                  title={
                    activeStatus?.online
                      ? t("integrationsHub.overview.healthConnected")
                      : t("integrationsHub.overview.healthOffline")
                  }
                  description={
                    activeStatus?.message ?? t("integrationsHub.overview.healthUnknownDescription")
                  }
                  action={
                    <Button type="button" variant="secondary" onClick={refresh} disabled={isLoading}>
                      {activeAction === "refresh" ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                      {t("common.refresh")}
                    </Button>
                  }
                >
                  {hasUnsavedChanges && selectedProvider ? (
                    <div className="mb-3 flex items-start gap-3 rounded-2xl border border-amber-400/15 bg-amber-400/[0.045] px-3 py-3">
                      <Save size={14} className="mt-0.5 shrink-0 text-amber-300" />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-amber-100">
                          {t("integrationsHub.overview.draftTitle", {
                            provider: providerName(selectedProvider),
                          })}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-neutral-500">
                          {t("integrationsHub.overview.draftDescription")}
                        </p>
                      </div>
                    </div>
                  ) : null}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <SummaryMetric
                      label={t("integrationsHub.summary.model")}
                      value={activeModel ?? t("common.unknown")}
                      caption={t("integrationsHub.summary.activeModel")}
                      icon={<Cpu size={15} />}
                    />
                    <SummaryMetric
                      label={t("integrationsHub.summary.secrets")}
                      value={activeProviderSecurityLabel}
                      caption={t("integrationsHub.summary.serverSide")}
                      icon={<LockKeyhole size={15} />}
                    />
                  </div>
                </SurfaceCard>
              </div>

              <SurfaceCard
                icon={<PlugZap size={17} />}
                iconTone="sky"
                eyebrow={t("integrationsHub.overview.servicesEyebrow")}
                title={t("integrationsHub.overview.servicesTitle")}
                description={t("integrationsHub.overview.servicesDescription")}
              >
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <ConnectionCard
                    icon={<Cpu size={16} />}
                    iconTone="violet"
                    title={t("integrationsHub.connections.aiProviderTitle")}
                    description={t("integrationsHub.connections.aiProviderDescription")}
                    status={activeStatus?.online ? t("integrationsHub.status.connected") : t("integrationsHub.status.notConnected")}
                    statusTone={activeStatus?.online ? "positive" : "neutral"}
                    actionLabel={t("integrationsHub.actions.configure")}
                    onAction={() => setActiveTab("providers")}
                  />
                  <ConnectionCard
                    icon={<Github size={17} />}
                    iconTone="neutral"
                    title="GitHub"
                    description={t("integrationsHub.connections.githubDescription")}
                    status={t("integrationsHub.status.separateWorkspace")}
                    statusTone="neutral"
                    actionLabel={t("integrationsHub.actions.openGithub")}
                    onAction={onOpenGitHub}
                  />
                  <ConnectionCard
                    icon={<Cloud size={16} />}
                    iconTone="sky"
                    title={t("integrationsHub.connections.accountTitle")}
                    description={t("integrationsHub.connections.accountDescription")}
                    status={t("integrationsHub.status.available")}
                    statusTone="positive"
                    actionLabel={t("integrationsHub.actions.openAccount")}
                    onAction={onOpenAccountSync}
                  />
                  <ConnectionCard
                    icon={<Puzzle size={16} />}
                    iconTone="neutral"
                    title={t("integrationsHub.connections.futureTitle")}
                    description={t("integrationsHub.connections.futureDescription")}
                    status={t("common.planned")}
                    statusTone="neutral"
                  />
                </div>
              </SurfaceCard>
            </div>
          ) : null}

          {activeTab === "providers" ? (
            <div className="space-y-5">
              <SurfaceCard
                icon={<Server size={17} />}
                eyebrow={t("integrationsHub.providers.eyebrow")}
                title={t("integrationsHub.providers.title")}
                description={t("integrationsHub.providers.description")}
                iconTone="violet"
                action={
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill
                      label={`${t("integrationsHub.summary.activeProvider")}: ${
                        activeProvider ? providerName(activeProvider) : "—"
                      }`}
                      tone={activeStatus?.online ? "positive" : "neutral"}
                      icon={activeStatus?.online ? <CheckCircle2 size={13} /> : <WifiOff size={13} />}
                    />
                    {hasUnsavedChanges ? (
                      <StatusPill
                        label={t("integrationsHub.status.notApplied")}
                        tone="warning"
                        icon={<Save size={13} />}
                      />
                    ) : null}
                    <Button type="button" variant="secondary" onClick={refresh} disabled={isLoading}>
                      {activeAction === "refresh" ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                      {t("common.refresh")}
                    </Button>
                    <Button type="button" variant="primary" onClick={save} disabled={isLoading || !draft || !hasUnsavedChanges} className="disabled:pointer-events-none disabled:opacity-45">
                      {activeAction === "save" ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : saveFeedback === "saved" ? (
                        <CheckCircle2 size={14} />
                      ) : (
                        <Save size={14} />
                      )}
                      {saveFeedback === "saved"
                        ? t("integrationsHub.actions.saved")
                        : t("integrationsHub.actions.saveProvider")}
                    </Button>
                  </div>
                }
              >
                <ProviderCardSelector
                  value={draft?.aiProvider ?? "ollama"}
                  disabled={!draft}
                  onChange={(aiProvider) => updateDraft({ aiProvider })}
                  getCopy={(provider) => ({
                    meta: t(`integrationsHub.providerCards.${provider}.meta`),
                    description: t(`integrationsHub.providerCards.${provider}.description`),
                    notes: [
                      t(`integrationsHub.providerCards.${provider}.note1`),
                      t(`integrationsHub.providerCards.${provider}.note2`),
                    ],
                  })}
                />

                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <div className="flex items-center justify-between gap-4 rounded-xl border border-emerald-400/15 bg-emerald-400/[0.04] px-3 py-2.5">
                    <span className="flex min-w-0 items-center gap-2 text-xs text-neutral-500">
                      <span className="size-1.5 shrink-0 rounded-full bg-emerald-400" />
                      {t("integrationsHub.summary.activeProvider")}
                    </span>
                    <span className="truncate text-xs font-semibold text-white">
                      {activeProvider ? providerName(activeProvider) : "—"}
                    </span>
                  </div>
                  <div
                    className={[
                      "flex items-center justify-between gap-4 rounded-xl border px-3 py-2.5",
                      providerSelectionChanged
                        ? "border-amber-400/15 bg-amber-400/[0.04]"
                        : "border-neutral-900 bg-black/30",
                    ].join(" ")}
                  >
                    <span className="flex min-w-0 items-center gap-2 text-xs text-neutral-500">
                      <span
                        className={[
                          "size-1.5 shrink-0 rounded-full",
                          providerSelectionChanged ? "bg-amber-300" : "bg-neutral-700",
                        ].join(" ")}
                      />
                      {t("integrationsHub.summary.selectedProvider")}
                    </span>
                    <span className="truncate text-xs font-semibold text-white">
                      {selectedProvider ? providerName(selectedProvider) : "—"}
                    </span>
                  </div>
                </div>
              </SurfaceCard>

              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
                <SurfaceCard
                  icon={<Settings2 size={17} />}
                  iconTone="sky"
                  eyebrow={t("integrationsHub.providerSetup.eyebrow")}
                  title={draft ? providerName(draft.aiProvider) : t("integrationsHub.providerSetup.loading")}
                  description={
                    providerConfigChanged
                      ? t("integrationsHub.providerSetup.saveToCheck")
                      : visibleStatus?.message ?? t("integrationsHub.providerSetup.notChecked")
                  }
                >
                  {draft?.aiProvider === "ollama" ? (
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field label={t("integrationsHub.providerSetup.ollamaUrl")} caption={t("integrationsHub.providerSetup.ollamaUrlCaption")}>
                        <input className="cf-input" value={draft.ollamaUrl} onChange={(event) => updateDraft({ ollamaUrl: event.target.value })} placeholder="http://localhost:11434" />
                      </Field>
                      <Field label={t("integrationsHub.providerSetup.mode")} caption={t("integrationsHub.providerSetup.modeCaption")}>
                        <CustomSelect value={draft.generationMode} options={generationModeOptions} onChange={(generationMode) => updateDraft({ generationMode })} />
                      </Field>
                    </div>
                  ) : null}

                  {draft?.aiProvider === "openai-compatible" ? (
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field label={t("integrationsHub.providerSetup.baseUrl")} caption={t("integrationsHub.providerSetup.openAiUrlCaption")}>
                        <input className="cf-input" value={draft.openAiCompatibleBaseUrl} onChange={(event) => updateDraft({ openAiCompatibleBaseUrl: event.target.value })} placeholder="http://localhost:1234/v1" />
                      </Field>
                      <Field label={t("integrationsHub.providerSetup.apiKey")} caption={draft.openAiCompatibleApiKeyConfigured ? t("integrationsHub.providerSetup.keyConfigured") : t("integrationsHub.providerSetup.keyOptional")}>
                        <div className="flex gap-2">
                          <input className="cf-input" type="password" value={apiKeyDraft} onChange={(event) => { setApiKeyDraft(event.target.value); setClearApiKey(false); }} placeholder={draft.openAiCompatibleApiKeyConfigured ? t("integrationsHub.providerSetup.savedKey") : t("integrationsHub.providerSetup.apiKey")} />
                          <button type="button" onClick={() => { setApiKeyDraft(""); setClearApiKey(true); }} disabled={!draft.openAiCompatibleApiKeyConfigured} className="rounded-xl border border-neutral-800 px-3 text-xs text-neutral-400 transition hover:border-white/20 hover:text-white disabled:pointer-events-none disabled:opacity-40">
                            {t("integrationsHub.actions.clear")}
                          </button>
                        </div>
                      </Field>
                      <Field label={t("integrationsHub.providerSetup.manualModel")} caption={t("integrationsHub.providerSetup.manualModelCaption")}>
                        <input className="cf-input" value={draft.openAiCompatibleModel ?? ""} onChange={(event) => updateDraft({ openAiCompatibleModel: event.target.value || null })} placeholder="model-id" />
                      </Field>
                      <Field label={t("integrationsHub.providerSetup.mode")} caption={t("integrationsHub.providerSetup.modeCaption")}>
                        <CustomSelect value={draft.generationMode} options={generationModeOptions} onChange={(generationMode) => updateDraft({ generationMode })} />
                      </Field>
                    </div>
                  ) : null}

                  {draft?.aiProvider === "anthropic" ? (
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field label={t("integrationsHub.providerSetup.claudeUrl")} caption={t("integrationsHub.providerSetup.claudeUrlCaption")}>
                        <input className="cf-input" value={draft.anthropicBaseUrl} onChange={(event) => updateDraft({ anthropicBaseUrl: event.target.value })} placeholder="https://api.anthropic.com/v1" />
                      </Field>
                      <Field label={t("integrationsHub.providerSetup.claudeKey")} caption={draft.anthropicApiKeyConfigured ? t("integrationsHub.providerSetup.keyConfigured") : t("integrationsHub.providerSetup.keyRequired")}>
                        <div className="flex gap-2">
                          <input className="cf-input" type="password" value={anthropicApiKeyDraft} onChange={(event) => { setAnthropicApiKeyDraft(event.target.value); setClearAnthropicApiKey(false); }} placeholder={draft.anthropicApiKeyConfigured ? t("integrationsHub.providerSetup.savedKey") : t("integrationsHub.providerSetup.claudeKey")} />
                          <button type="button" onClick={() => { setAnthropicApiKeyDraft(""); setClearAnthropicApiKey(true); }} disabled={!draft.anthropicApiKeyConfigured} className="rounded-xl border border-neutral-800 px-3 text-xs text-neutral-400 transition hover:border-white/20 hover:text-white disabled:pointer-events-none disabled:opacity-40">
                            {t("integrationsHub.actions.clear")}
                          </button>
                        </div>
                      </Field>
                      <Field label={t("integrationsHub.providerSetup.manualModel")} caption={t("integrationsHub.providerSetup.manualModelCaption")}>
                        <input className="cf-input" value={draft.anthropicModel ?? ""} onChange={(event) => updateDraft({ anthropicModel: event.target.value || null })} placeholder="claude-3-5-sonnet-latest" />
                      </Field>
                      <Field label={t("integrationsHub.providerSetup.mode")} caption={t("integrationsHub.providerSetup.modeCaption")}>
                        <CustomSelect value={draft.generationMode} options={generationModeOptions} onChange={(generationMode) => updateDraft({ generationMode })} />
                      </Field>
                    </div>
                  ) : null}

                  {draft?.aiProvider === "gemini" ? (
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field label={t("integrationsHub.providerSetup.geminiUrl")} caption={t("integrationsHub.providerSetup.geminiUrlCaption")}>
                        <input className="cf-input" value={draft.geminiBaseUrl} onChange={(event) => updateDraft({ geminiBaseUrl: event.target.value })} placeholder="https://generativelanguage.googleapis.com/v1beta" />
                      </Field>
                      <Field label={t("integrationsHub.providerSetup.geminiKey")} caption={draft.geminiApiKeyConfigured ? t("integrationsHub.providerSetup.keyConfigured") : t("integrationsHub.providerSetup.keyRequired")}>
                        <div className="flex gap-2">
                          <input className="cf-input" type="password" value={geminiApiKeyDraft} onChange={(event) => { setGeminiApiKeyDraft(event.target.value); setClearGeminiApiKey(false); }} placeholder={draft.geminiApiKeyConfigured ? t("integrationsHub.providerSetup.savedKey") : t("integrationsHub.providerSetup.geminiKey")} />
                          <button type="button" onClick={() => { setGeminiApiKeyDraft(""); setClearGeminiApiKey(true); }} disabled={!draft.geminiApiKeyConfigured} className="rounded-xl border border-neutral-800 px-3 text-xs text-neutral-400 transition hover:border-white/20 hover:text-white disabled:pointer-events-none disabled:opacity-40">
                            {t("integrationsHub.actions.clear")}
                          </button>
                        </div>
                      </Field>
                      <Field label={t("integrationsHub.providerSetup.manualModel")} caption={t("integrationsHub.providerSetup.manualModelCaption")}>
                        <input className="cf-input" value={draft.geminiModel ?? ""} onChange={(event) => updateDraft({ geminiModel: event.target.value || null })} placeholder="gemini-1.5-flash" />
                      </Field>
                      <Field label={t("integrationsHub.providerSetup.mode")} caption={t("integrationsHub.providerSetup.modeCaption")}>
                        <CustomSelect value={draft.generationMode} options={generationModeOptions} onChange={(generationMode) => updateDraft({ generationMode })} />
                      </Field>
                    </div>
                  ) : null}
                </SurfaceCard>

                <div className="space-y-5">
                  <SurfaceCard
                    icon={<Cpu size={17} />}
                    iconTone="violet"
                    eyebrow={t("integrationsHub.models.eyebrow")}
                    title={t("integrationsHub.models.title")}
                    description={t("integrationsHub.models.description")}
                    action={
                      <StatusPill
                        label={t("integrationsHub.models.detected", { count: visibleModels.length })}
                        tone="neutral"
                      />
                    }
                  >
                    {providerConfigChanged ? (
                      <div className="rounded-2xl border border-amber-400/15 bg-amber-400/5 p-4 text-sm leading-6 text-neutral-500">
                        {t("integrationsHub.models.saveFirst")}
                      </div>
                    ) : visibleModels.length === 0 ? (
                      <div className="rounded-2xl border border-neutral-900 bg-black/30 p-4 text-sm leading-6 text-neutral-500">
                        {t("integrationsHub.models.empty")}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {visibleModels.slice(0, 5).map((model) => (
                          <div key={`${model.provider}:${model.name}`} className="flex items-center gap-3 rounded-xl border border-neutral-900 bg-black/30 px-3 py-3">
                            <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-500">
                              <Server size={14} />
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-white">{model.name}</p>
                              <p className="truncate text-xs text-neutral-600">
                                {model.description ?? providerName(model.provider)}
                                {model.size ? ` · ${formatModelSize(model.size, t("common.unknownSize"))}` : ""}
                              </p>
                            </div>
                            {selectedModel === model.name ? <CheckCircle2 size={14} className="text-emerald-400" /> : null}
                          </div>
                        ))}
                      </div>
                    )}
                    <Button type="button" variant="ghost" onClick={onOpenSettings} disabled={!onOpenSettings} className="mt-4 w-full">
                      <Settings2 size={14} />
                      {t("integrationsHub.actions.manageDefaults")}
                    </Button>
                  </SurfaceCard>

                  <SurfaceCard
                    icon={<KeyRound size={17} />}
                    iconTone={providerSecurityLabel === t("integrationsHub.summary.noKeySaved") ? "amber" : "emerald"}
                    eyebrow={t("integrationsHub.providers.credentialsEyebrow")}
                    title={providerSecurityLabel}
                    description={t("integrationsHub.providers.credentialsDescription")}
                  />
                </div>
              </div>
            </div>
          ) : null}

          {activeTab === "connections" ? (
            <div className="space-y-5">
              <SurfaceCard
                icon={<Workflow size={17} />}
                iconTone="sky"
                eyebrow={t("integrationsHub.connections.eyebrow")}
                title={t("integrationsHub.connections.title")}
                description={t("integrationsHub.connections.description")}
              >
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <ConnectionCard
                    icon={<Github size={17} />}
                    iconTone="neutral"
                    title="GitHub"
                    description={t("integrationsHub.connections.githubLong")}
                    status={t("integrationsHub.status.separateWorkspace")}
                    statusTone="neutral"
                    actionLabel={t("integrationsHub.actions.openGithub")}
                    onAction={onOpenGitHub}
                  />
                  <ConnectionCard
                    icon={<Cloud size={16} />}
                    iconTone="sky"
                    title={t("integrationsHub.connections.accountTitle")}
                    description={t("integrationsHub.connections.accountLong")}
                    status={t("integrationsHub.status.available")}
                    statusTone="positive"
                    actionLabel={t("integrationsHub.actions.openAccount")}
                    onAction={onOpenAccountSync}
                  />
                  <ConnectionCard
                    icon={<TerminalSquare size={16} />}
                    iconTone="emerald"
                    title={t("integrationsHub.connections.exportTitle")}
                    description={t("integrationsHub.connections.exportDescription")}
                    status={t("integrationsHub.status.local")}
                    statusTone="positive"
                  />
                </div>
              </SurfaceCard>

              <SurfaceCard
                icon={<Puzzle size={17} />}
                iconTone="amber"
                eyebrow={t("integrationsHub.future.eyebrow")}
                title={t("integrationsHub.future.title")}
                description={t("integrationsHub.future.description")}
              >
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {([
                    { id: "mcp", icon: <Puzzle size={16} /> },
                    { id: "cli", icon: <TerminalSquare size={16} /> },
                    { id: "issues", icon: <GitBranch size={16} /> },
                    { id: "cloud", icon: <Cloud size={16} /> },
                  ] as const).map(({ id, icon }) => (
                    <div key={id} className="rounded-[1.2rem] border border-neutral-900 bg-black/30 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <span className="grid size-9 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-500">
                          {icon}
                        </span>
                        <StatusPill label={t("common.planned")} tone="neutral" />
                      </div>
                      <p className="mt-4 text-sm font-semibold text-white">{t(`integrationsHub.future.${id}Title`)}</p>
                      <p className="mt-2 text-xs leading-5 text-neutral-500">{t(`integrationsHub.future.${id}Description`)}</p>
                    </div>
                  ))}
                </div>
              </SurfaceCard>
            </div>
          ) : null}

          {activeTab === "security" ? (
            <div className="space-y-5">
              <SurfaceCard
                icon={<ShieldCheck size={17} />}
                iconTone="emerald"
                eyebrow={t("integrationsHub.security.eyebrow")}
                title={t("integrationsHub.security.title")}
                description={t("integrationsHub.security.description")}
              >
                <div className="grid gap-4 lg:grid-cols-2">
                  <BoundaryList
                    title={t("integrationsHub.security.staysLocal")}
                    icon={<LockKeyhole size={16} />}
                    tone="local"
                    items={[
                      t("integrationsHub.security.local1"),
                      t("integrationsHub.security.local2"),
                      t("integrationsHub.security.local3"),
                      t("integrationsHub.security.local4"),
                    ]}
                  />
                  <BoundaryList
                    title={t("integrationsHub.security.mayLeave")}
                    icon={<ExternalLink size={16} />}
                    tone="external"
                    items={[
                      t("integrationsHub.security.external1"),
                      t("integrationsHub.security.external2"),
                      t("integrationsHub.security.external3"),
                      t("integrationsHub.security.external4"),
                    ]}
                  />
                </div>
              </SurfaceCard>

              <div className="grid gap-5 xl:grid-cols-2">
                <SurfaceCard
                  icon={<KeyRound size={17} />}
                  iconTone="amber"
                  eyebrow={t("integrationsHub.security.credentialsEyebrow")}
                  title={t("integrationsHub.security.credentialsTitle")}
                  description={t("integrationsHub.security.credentialsDescription")}
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    <SummaryMetric
                      label={t("integrationsHub.summary.provider")}
                      value={settings ? providerName(settings.aiProvider) : "—"}
                      caption={t("integrationsHub.security.activeProvider")}
                      icon={<Server size={15} />}
                    />
                    <SummaryMetric
                      label={t("integrationsHub.summary.secrets")}
                      value={activeProviderSecurityLabel}
                      caption={t("integrationsHub.summary.serverSide")}
                      icon={<LockKeyhole size={15} />}
                    />
                  </div>
                </SurfaceCard>

                <SurfaceCard
                  icon={<Code2 size={17} />}
                  iconTone="violet"
                  eyebrow={t("integrationsHub.security.outputEyebrow")}
                  title={t("integrationsHub.security.outputTitle")}
                  description={t("integrationsHub.security.outputDescription")}
                >
                  <div className="flex items-center gap-3 rounded-2xl border border-neutral-900 bg-black/30 p-4">
                    {settings ? (
                      <AiToolLogo
                        tool={settings.defaultTargetTool}
                        size="lg"
                        className="!border-neutral-800 !bg-neutral-950 [&>svg]:brightness-0 [&>svg]:invert"
                      />
                    ) : (
                      <Bot size={18} />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white">
                        {settings ? getAiToolLabel(settings.defaultTargetTool) : "—"}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-neutral-500">
                        {settings ? getAiToolDescription(settings.defaultTargetTool) : t("common.unknown")}
                      </p>
                    </div>
                  </div>
                </SurfaceCard>
              </div>
            </div>
          ) : null}
        </motion.div>
      </AnimatePresence>

      {isLoading && !draft ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-2xl border border-neutral-900 bg-black/40 p-5 text-sm text-neutral-500"
        >
          {t("integrationsHub.loading")}
        </motion.div>
      ) : null}
    </section>
  );
}
