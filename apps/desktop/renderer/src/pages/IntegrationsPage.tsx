import { useEffect, useMemo, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  Bot,
  CheckCircle2,
  Cloud,
  Code2,
  Cpu,
  GitBranch,
  KeyRound,
  Loader2,
  LockKeyhole,
  PlugZap,
  Puzzle,
  RefreshCw,
  Save,
  Server,
  ShieldCheck,
  Sparkles,
  WifiOff,
  Workflow,
} from "lucide-react";

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
  TARGET_TOOL_OPTIONS,
} from "../components/ai/aiToolOptions";
import { Button } from "../components/ui/Button";
import { CustomSelect, type SelectOption } from "../components/ui/CustomSelect";
import type {
  AiProviderId,
  AiProviderModel,
  AiProviderStatus,
  AppSettings,
  TargetTool,
} from "../types";

const GENERATION_MODE_OPTIONS: SelectOption<AppSettings["generationMode"]>[] = [
  {
    value: "template",
    label: "Template only",
    description: "Deterministic prompts without AI calls.",
    icon: <ShieldCheck size={15} />,
  },
  {
    value: "ollama",
    label: "AI-assisted",
    description: "Use the selected provider with template fallback.",
    icon: <Sparkles size={15} />,
  },
];

const TARGET_TOOL_SELECT_OPTIONS: SelectOption<TargetTool>[] =
  TARGET_TOOL_OPTIONS.map((option) => ({
    value: option.value,
    label: getAiToolLabel(option.value),
    description: getAiToolDescription(option.value),
    icon: <AiToolLogo tool={option.value} size="sm" />,
    activeIcon: <AiToolLogo tool={option.value} size="sm" contrast="onLight" />,
  }));

const PRIMARY_CODING_TARGETS: TargetTool[] = ["codex", "cursor", "claude"];

const CONNECTORS = [
  {
    title: "GitHub",
    description:
      "Create issues from Task Packs and link work back to repositories.",
    status: "v0.6 planned",
    icon: <GitBranch size={16} />,
  },
  {
    title: "MCP / Tool permissions",
    description:
      "Future control layer for safe tool access and approval flows.",
    status: "later",
    icon: <Puzzle size={16} />,
  },
  {
    title: "Cloud sync",
    description:
      "Optional account sync for templates, devices and shared settings.",
    status: "later",
    icon: <Cloud size={16} />,
  },
];

function providerLabel(provider: AiProviderId) {
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

function providerTagline(provider: AiProviderId) {
  if (provider === "openai-compatible") {
    return "Local proxy or compatible /v1 gateway";
  }

  if (provider === "anthropic") {
    return "Anthropic provider with server-side key storage";
  }

  if (provider === "gemini") {
    return "Google model provider with server-side key storage";
  }

  return "Local-first model provider for private workflows";
}

const PROVIDER_CARD_OPTIONS: Array<{
  provider: AiProviderId;
  title: string;
  description: string;
  meta: string;
  notes: string[];
  icon: ReactNode;
  activeIcon?: ReactNode;
}> = [
  {
    provider: "ollama",
    title: "Ollama",
    description:
      "Run local models on your machine. Best when privacy and offline work matter.",
    meta: "Local",
    notes: ["No cloud by default", "Great for private repos"],
    icon: <Cpu size={18} />,
  },
  {
    provider: "openai-compatible",
    title: "OpenAI-compatible",
    description:
      "Use any /v1-compatible endpoint, local gateway, proxy, or hosted provider.",
    meta: "Endpoint",
    notes: ["Flexible gateway", "Optional API key"],
    icon: <AiToolLogo tool="openai" size="lg" />,
    activeIcon: <AiToolLogo tool="openai" size="lg" contrast="onLight" />,
  },
  {
    provider: "anthropic",
    title: "Claude API",
    description:
      "Connect Anthropic Claude for prompt refinement, summaries, and future review flows.",
    meta: "Cloud",
    notes: ["Server-side key", "Strong coding context"],
    icon: <AiToolLogo tool="anthropic" size="lg" />,
    activeIcon: <AiToolLogo tool="anthropic" size="lg" contrast="onLight" />,
  },
  {
    provider: "gemini",
    title: "Gemini",
    description:
      "Connect Google Gemini for assisted prompt refinement and future review flows.",
    meta: "Cloud",
    notes: ["Server-side key", "Manual model id supported"],
    icon: <AiToolLogo tool="gemini" size="lg" />,
    activeIcon: <AiToolLogo tool="gemini" size="lg" contrast="onLight" />,
  },
];

const PROVIDER_CARD_TRANSITION = {
  type: "spring",
  stiffness: 560,
  damping: 44,
  mass: 0.55,
} as const;

function formatModelSize(size?: number) {
  if (!size) {
    return "Unknown size";
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

function StatusPill({
  pending = false,
  status,
}: {
  pending?: boolean;
  status: AiProviderStatus | null;
}) {
  if (pending) {
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-xs font-medium text-amber-200">
        <RefreshCw size={13} />
        Save needed
      </span>
    );
  }

  const online = Boolean(status?.online);

  return (
    <span
      className={[
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium",
        online
          ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
          : "border-neutral-800 bg-neutral-950 text-neutral-500",
      ].join(" ")}
    >
      {online ? <CheckCircle2 size={13} /> : <WifiOff size={13} />}
      {online ? "Connected" : "Not connected"}
    </span>
  );
}

function MiniMetric({
  label,
  value,
  caption,
  icon,
}: {
  label: string;
  value: string;
  caption: string;
  icon: ReactNode;
}) {
  return (
    <div className="rounded-[1.35rem] border border-neutral-900 bg-black/35 p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <span className="grid size-9 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-400">
          {icon}
        </span>
        <span className="cf-tech-label text-[9px] uppercase text-neutral-700">
          {label}
        </span>
      </div>
      <p className="truncate text-lg font-semibold text-white">{value}</p>
      <p className="mt-1 truncate text-xs text-neutral-600">{caption}</p>
    </div>
  );
}

function ProviderCardSelector({
  value,
  disabled = false,
  onChange,
}: {
  value: AiProviderId;
  disabled?: boolean;
  onChange: (provider: AiProviderId) => void;
}) {
  const activeIndex = Math.max(
    0,
    PROVIDER_CARD_OPTIONS.findIndex((option) => option.provider === value),
  );

  return (
    <div className="overflow-x-auto pb-1">
      <div className="relative grid min-w-[760px] grid-cols-4 overflow-hidden rounded-[1.65rem] border border-white/10 bg-black/55 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.055)]">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.055),rgba(255,255,255,0.01)_44%,rgba(255,255,255,0.004))]" />

        <motion.div
          aria-hidden="true"
          className="absolute bottom-1 left-1 top-1 rounded-[1.35rem] bg-white shadow-[0_18px_46px_rgba(255,255,255,0.14)]"
          style={{
            width: `calc((100% - 8px) / ${PROVIDER_CARD_OPTIONS.length})`,
            willChange: "transform",
          }}
          initial={false}
          animate={{ x: `${activeIndex * 100}%` }}
          transition={PROVIDER_CARD_TRANSITION}
        />

        {PROVIDER_CARD_OPTIONS.map((option) => {
          const active = option.provider === value;

          return (
            <button
              key={option.provider}
              type="button"
              onClick={() => onChange(option.provider)}
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
                  {active && option.activeIcon ? option.activeIcon : option.icon}
                </span>

                {active && <CheckCircle2 size={17} className="text-black" />}
              </div>

              <span
                className={[
                  "mb-3 inline-flex rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] transition-colors duration-150",
                  active
                    ? "border-black/10 text-black/55"
                    : "border-neutral-800 text-neutral-600 group-hover:text-neutral-400",
                ].join(" ")}
              >
                {option.meta}
              </span>

              <h3
                className={[
                  "truncate text-base font-semibold transition-colors duration-150",
                  active ? "text-black" : "text-white group-hover:text-white",
                ].join(" ")}
              >
                {option.title}
              </h3>

              <p
                className={[
                  "mt-2 line-clamp-2 text-sm leading-6 transition-colors duration-150",
                  active
                    ? "text-black/60"
                    : "text-neutral-600 group-hover:text-neutral-400",
                ].join(" ")}
              >
                {option.description}
              </p>

              <div className="mt-5 space-y-2">
                {option.notes.map((note) => (
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

function AgentTargetPreview({ tool }: { tool: TargetTool }) {
  return (
    <div className="rounded-[1.35rem] border border-neutral-900 bg-black/35 p-4">
      <div className="flex items-start gap-3">
        <AiToolLogo tool={tool} size="lg" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">
            {getAiToolLabel(tool)} format
          </p>
          <p className="mt-1 text-xs leading-5 text-neutral-500">
            {getAiToolDescription(tool)}
          </p>
        </div>
      </div>
    </div>
  );
}

function AgentTargetCard({
  tool,
  active,
  disabled = false,
  onSelect,
}: {
  tool: TargetTool;
  active: boolean;
  disabled?: boolean;
  onSelect: (tool: TargetTool) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(tool)}
      disabled={disabled}
      className={[
        "group flex min-w-0 items-start gap-3 rounded-[1.2rem] border p-4 text-left transition duration-200 disabled:pointer-events-none disabled:opacity-50",
        active
          ? "border-white bg-white text-black shadow-[0_18px_52px_rgba(255,255,255,0.08)]"
          : "border-neutral-900 bg-black/35 text-neutral-400 hover:border-white/20 hover:bg-neutral-950 hover:text-white",
      ].join(" ")}
    >
      <AiToolLogo
        tool={tool}
        size="lg"
        contrast={active ? "onLight" : "default"}
        className={active ? "border-black/10 bg-black/5" : ""}
      />

      <span className="min-w-0 flex-1">
        <span
          className={[
            "flex items-center gap-2 text-sm font-semibold",
            active ? "text-black" : "text-white",
          ].join(" ")}
        >
          {getAiToolLabel(tool)}
          {active && <CheckCircle2 size={14} />}
        </span>
        <span
          className={[
            "mt-1 block text-xs leading-5",
            active
              ? "text-black/55"
              : "text-neutral-600 group-hover:text-neutral-400",
          ].join(" ")}
        >
          {getAiToolDescription(tool)}
        </span>
      </span>
    </button>
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
      {caption && (
        <p className="mt-2 text-xs leading-5 text-neutral-600">{caption}</p>
      )}
    </label>
  );
}

function PipelineStep({
  index,
  title,
  description,
  active = false,
}: {
  index: number;
  title: string;
  description: string;
  active?: boolean;
}) {
  return (
    <div className="flex gap-3">
      <span
        className={[
          "grid size-8 shrink-0 place-items-center rounded-xl border text-xs font-semibold",
          active
            ? "border-white bg-white text-black"
            : "border-neutral-800 bg-neutral-950 text-neutral-500",
        ].join(" ")}
      >
        {index}
      </span>
      <div className="min-w-0 pb-4">
        <p className="text-sm font-semibold text-white">{title}</p>
        <p className="mt-1 text-xs leading-5 text-neutral-500">{description}</p>
      </div>
    </div>
  );
}

function ConnectorTile({
  title,
  description,
  status,
  icon,
}: {
  title: string;
  description: string;
  status: string;
  icon: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <span className="grid size-9 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-500">
          {icon}
        </span>
        <span className="rounded-full border border-neutral-800 bg-black/40 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-neutral-600">
          {status}
        </span>
      </div>
      <p className="text-sm font-semibold text-white">{title}</p>
      <p className="mt-2 text-xs leading-5 text-neutral-500">{description}</p>
    </div>
  );
}

export function IntegrationsPage() {
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
  const [activeAction, setActiveAction] = useState<"refresh" | "save" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const selectedModel = useMemo(() => {
    if (!draft) {
      return null;
    }

    if (draft.aiProvider === "gemini") {
      return draft.geminiModel;
    }

    if (draft.aiProvider === "anthropic") {
      return draft.anthropicModel;
    }

    return draft.aiProvider === "openai-compatible"
      ? draft.openAiCompatibleModel
      : draft.defaultOllamaModel;
  }, [draft]);

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
        apiKeyDraft.trim().length > 0 ||
        clearApiKey
      );
    }

    if (draft.aiProvider === "anthropic") {
      return (
        settings.anthropicBaseUrl !== draft.anthropicBaseUrl ||
        anthropicApiKeyDraft.trim().length > 0 ||
        clearAnthropicApiKey
      );
    }

    if (draft.aiProvider === "gemini") {
      return (
        settings.geminiBaseUrl !== draft.geminiBaseUrl ||
        geminiApiKeyDraft.trim().length > 0 ||
        clearGeminiApiKey
      );
    }

    return false;
  }, [
    apiKeyDraft,
    clearApiKey,
    clearGeminiApiKey,
    clearAnthropicApiKey,
    draft,
    geminiApiKeyDraft,
    anthropicApiKeyDraft,
    settings,
  ]);

  const statusMatchesDraft = Boolean(
    draft &&
    status &&
    status.provider === draft.aiProvider &&
    !providerConfigChanged,
  );

  const visibleStatus = statusMatchesDraft ? status : null;

  const visibleModels = useMemo(() => {
    if (!draft || !statusMatchesDraft) {
      return [];
    }

    return models.filter((model) => model.provider === draft.aiProvider);
  }, [draft, models, statusMatchesDraft]);

  const providerStatusMessage = useMemo(() => {
    if (!draft) {
      return "Connection status has not been checked yet.";
    }

    if (providerConfigChanged) {
      return `Save integration to check ${providerLabel(draft.aiProvider)}.`;
    }

    return (
      visibleStatus?.message ?? "Connection status has not been checked yet."
    );
  }, [draft, providerConfigChanged, visibleStatus]);

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

  const providerSecurityLabel = useMemo(() => {
    if (!draft) {
      return "Loading";
    }

    if (draft.aiProvider === "ollama") {
      return "No API key";
    }

    if (draft.aiProvider === "openai-compatible") {
      return draft.openAiCompatibleApiKeyConfigured
        ? "Key saved"
        : "No key saved";
    }

    if (draft.aiProvider === "anthropic") {
      return draft.anthropicApiKeyConfigured ? "Key saved" : "No key saved";
    }

    return draft.geminiApiKeyConfigured ? "Key saved" : "No key saved";
  }, [draft]);

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
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to load integrations.",
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
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to save integrations.",
      );
    } finally {
      setIsLoading(false);
      setActiveAction(null);
    }
  }

  function updateDraft(patch: Partial<AppSettings>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  function selectProvider(provider: AiProviderId) {
    updateDraft({ aiProvider: provider });
  }

  function selectModel(modelName: string | null) {
    if (!draft) {
      return;
    }

    if (draft.aiProvider === "openai-compatible") {
      updateDraft({ openAiCompatibleModel: modelName });
      return;
    }

    if (draft.aiProvider === "gemini") {
      updateDraft({ geminiModel: modelName });
      return;
    }

    if (draft.aiProvider === "anthropic") {
      updateDraft({ anthropicModel: modelName });
      return;
    }

    updateDraft({ defaultOllamaModel: modelName });
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <section className="space-y-5 text-render-crisp">
      <div className="cf-hero">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0">
            <div className="mb-4 flex flex-wrap gap-2">
              <span className="cf-badge">
                <PlugZap size={13} />
                Integrations
              </span>
              <span className="cf-badge">Local-first</span>
              <span className="cf-badge">Provider safe</span>
            </div>

            <h2 className="max-w-4xl text-[34px] font-semibold leading-[1.05] tracking-[-0.05em] text-white">
              Connect internal AI providers and prepare Task Packs for the right
              coding agent.
            </h2>

            <p className="mt-3 max-w-3xl text-sm leading-6 text-neutral-400">
              Internal providers can refine prompts when AI-assisted mode is
              enabled. Agent targets only control the final Task Pack format for
              Codex, Cursor, Claude Code, Gemini, or a generic coding assistant.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <StatusPill
              status={visibleStatus}
              pending={providerConfigChanged}
            />

            <Button
              type="button"
              variant="secondary"
              onClick={refresh}
              disabled={isLoading}
            >
              {activeAction === "refresh" ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <RefreshCw size={15} />
              )}
              Refresh
            </Button>

            <Button
              type="button"
              variant="primary"
              onClick={save}
              disabled={isLoading || !draft || !hasUnsavedChanges}
              className="disabled:pointer-events-none disabled:opacity-45"
            >
              {activeAction === "save" ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Save size={15} />
              )}
              Save integration
            </Button>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MiniMetric
            label="Provider"
            value={draft ? providerLabel(draft.aiProvider) : "Loading"}
            caption={
              draft ? providerTagline(draft.aiProvider) : "Loading settings"
            }
            icon={<Server size={16} />}
          />
          <MiniMetric
            label="Mode"
            value={
              draft?.generationMode === "ollama" ? "AI-assisted" : "Template"
            }
            caption="How prompts are generated"
            icon={<Workflow size={16} />}
          />
          <MiniMetric
            label="Target"
            value={draft ? getAiToolLabel(draft.defaultTargetTool) : "Loading"}
            caption="Default Task Pack format"
            icon={<Bot size={16} />}
          />
          <MiniMetric
            label="Secrets"
            value={providerSecurityLabel}
            caption="Keys are stored server-side"
            icon={<LockKeyhole size={16} />}
          />
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-400/25 bg-red-950/20 p-4 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          <article className="cf-card p-5">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                  Model providers
                </p>
                <h3 className="mt-2 text-lg font-semibold text-white">
                  Choose the internal AI provider for ContextForge.
                </h3>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-neutral-500">
                  Providers can refine prompts, improve AGENTS.md and assist
                  with context analysis. They are separate from the coding agent
                  you export to.
                </p>
              </div>

              <span className="rounded-full border border-neutral-800 bg-black/40 px-3 py-1 text-xs text-neutral-500">
                {providerConfigChanged ? "Draft" : "Active"}:{" "}
                {draft ? providerLabel(draft.aiProvider) : "Loading"}
              </span>
            </div>

            <ProviderCardSelector
              value={draft?.aiProvider ?? "ollama"}
              disabled={!draft}
              onChange={selectProvider}
            />
          </article>

          <article className="cf-card p-5">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                  Provider setup
                </p>
                <h3 className="mt-2 text-lg font-semibold text-white">
                  {draft ? providerLabel(draft.aiProvider) : "Loading provider"}
                </h3>
                <p className="mt-1 text-sm leading-6 text-neutral-500">
                  {providerStatusMessage}
                </p>
              </div>

              <StatusPill
                status={visibleStatus}
                pending={providerConfigChanged}
              />
            </div>

            {draft?.aiProvider === "ollama" && (
              <div className="grid gap-4 md:grid-cols-2">
                <Field
                  label="Ollama URL"
                  caption="Usually http://localhost:11434 for the local Ollama service."
                >
                  <input
                    className="cf-input"
                    value={draft.ollamaUrl}
                    onChange={(event) =>
                      updateDraft({ ollamaUrl: event.target.value })
                    }
                    placeholder="http://localhost:11434"
                  />
                </Field>

                <Field
                  label="Generation mode"
                  caption="Template mode is safest. AI-assisted uses the selected provider and keeps template fallback."
                >
                  <CustomSelect
                    value={draft.generationMode}
                    options={GENERATION_MODE_OPTIONS}
                    onChange={(generationMode) =>
                      updateDraft({ generationMode })
                    }
                  />
                </Field>
              </div>
            )}

            {draft?.aiProvider === "openai-compatible" && (
              <div className="grid gap-4 md:grid-cols-2">
                <Field
                  label="Base URL"
                  caption="Use a /v1 base URL. Example: http://localhost:1234/v1."
                >
                  <input
                    className="cf-input"
                    value={draft.openAiCompatibleBaseUrl}
                    onChange={(event) =>
                      updateDraft({
                        openAiCompatibleBaseUrl: event.target.value,
                      })
                    }
                    placeholder="http://localhost:1234/v1"
                  />
                </Field>

                <Field
                  label="API key"
                  caption={
                    draft.openAiCompatibleApiKeyConfigured
                      ? "A key is already saved locally. Enter a new key to replace it, or clear it below."
                      : "Optional for local endpoints. Required for most remote gateways."
                  }
                >
                  <div className="flex gap-2">
                    <input
                      className="cf-input"
                      type="password"
                      value={apiKeyDraft}
                      onChange={(event) => {
                        setApiKeyDraft(event.target.value);
                        setClearApiKey(false);
                      }}
                      placeholder={
                        draft.openAiCompatibleApiKeyConfigured
                          ? "Saved key configured"
                          : "API key"
                      }
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setApiKeyDraft("");
                        setClearApiKey(true);
                      }}
                      disabled={!draft.openAiCompatibleApiKeyConfigured}
                      className="rounded-xl border border-neutral-800 px-3 text-xs text-neutral-400 transition hover:border-white/20 hover:text-white disabled:pointer-events-none disabled:opacity-40"
                    >
                      Clear
                    </button>
                  </div>
                </Field>

                <Field
                  label="Generation mode"
                  caption="Cloud-compatible providers are only used when AI-assisted generation is enabled."
                >
                  <CustomSelect
                    value={draft.generationMode}
                    options={GENERATION_MODE_OPTIONS}
                    onChange={(generationMode) =>
                      updateDraft({ generationMode })
                    }
                  />
                </Field>
              </div>
            )}

            {draft?.aiProvider === "anthropic" && (
              <div className="grid gap-4 md:grid-cols-2">
                <Field
                  label="Claude API base URL"
                  caption="Default is https://api.anthropic.com/v1 for the Anthropic Messages API."
                >
                  <input
                    className="cf-input"
                    value={draft.anthropicBaseUrl}
                    onChange={(event) =>
                      updateDraft({ anthropicBaseUrl: event.target.value })
                    }
                    placeholder="https://api.anthropic.com/v1"
                  />
                </Field>

                <Field
                  label="Claude API key"
                  caption={
                    draft.anthropicApiKeyConfigured
                      ? "A Claude API key is saved locally. Enter a new key to replace it, or clear it below."
                      : "Required for Claude API requests. The key is stored server-side and is not returned to the UI."
                  }
                >
                  <div className="flex gap-2">
                    <input
                      className="cf-input"
                      type="password"
                      value={anthropicApiKeyDraft}
                      onChange={(event) => {
                        setAnthropicApiKeyDraft(event.target.value);
                        setClearAnthropicApiKey(false);
                      }}
                      placeholder={
                        draft.anthropicApiKeyConfigured
                          ? "Saved key configured"
                          : "Claude API key"
                      }
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setAnthropicApiKeyDraft("");
                        setClearAnthropicApiKey(true);
                      }}
                      disabled={!draft.anthropicApiKeyConfigured}
                      className="rounded-xl border border-neutral-800 px-3 text-xs text-neutral-400 transition hover:border-white/20 hover:text-white disabled:pointer-events-none disabled:opacity-40"
                    >
                      Clear
                    </button>
                  </div>
                </Field>

                <Field
                  label="Generation mode"
                  caption="Keep template mode if you only want to store Claude settings for later."
                >
                  <CustomSelect
                    value={draft.generationMode}
                    options={GENERATION_MODE_OPTIONS}
                    onChange={(generationMode) =>
                      updateDraft({ generationMode })
                    }
                  />
                </Field>
              </div>
            )}

            {draft?.aiProvider === "gemini" && (
              <div className="grid gap-4 md:grid-cols-2">
                <Field
                  label="Gemini API base URL"
                  caption="Default is the Google Generative Language API v1beta endpoint."
                >
                  <input
                    className="cf-input"
                    value={draft.geminiBaseUrl}
                    onChange={(event) =>
                      updateDraft({ geminiBaseUrl: event.target.value })
                    }
                    placeholder="https://generativelanguage.googleapis.com/v1beta"
                  />
                </Field>

                <Field
                  label="Gemini API key"
                  caption={
                    draft.geminiApiKeyConfigured
                      ? "A Gemini key is saved locally. Enter a new key to replace it, or clear it below."
                      : "Required for Gemini API requests. The key is not returned to the UI after saving."
                  }
                >
                  <div className="flex gap-2">
                    <input
                      className="cf-input"
                      type="password"
                      value={geminiApiKeyDraft}
                      onChange={(event) => {
                        setGeminiApiKeyDraft(event.target.value);
                        setClearGeminiApiKey(false);
                      }}
                      placeholder={
                        draft.geminiApiKeyConfigured
                          ? "Saved key configured"
                          : "Gemini API key"
                      }
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setGeminiApiKeyDraft("");
                        setClearGeminiApiKey(true);
                      }}
                      disabled={!draft.geminiApiKeyConfigured}
                      className="rounded-xl border border-neutral-800 px-3 text-xs text-neutral-400 transition hover:border-white/20 hover:text-white disabled:pointer-events-none disabled:opacity-40"
                    >
                      Clear
                    </button>
                  </div>
                </Field>

                <Field
                  label="Generation mode"
                  caption="Keep template mode if you only want to store Gemini settings for later."
                >
                  <CustomSelect
                    value={draft.generationMode}
                    options={GENERATION_MODE_OPTIONS}
                    onChange={(generationMode) =>
                      updateDraft({ generationMode })
                    }
                  />
                </Field>
              </div>
            )}
          </article>

          <article className="cf-card p-5">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                  Models
                </p>
                <h3 className="mt-2 text-lg font-semibold text-white">
                  Select the default assisted generation model.
                </h3>
                <p className="mt-1 text-sm leading-6 text-neutral-500">
                  Detected models come from the active provider. Manual model
                  ids are available for cloud-compatible endpoints.
                </p>
              </div>

              <span className="rounded-full border border-neutral-800 bg-black/40 px-3 py-1 text-xs text-neutral-500">
                {visibleModels.length} detected
              </span>
            </div>

            {draft?.aiProvider !== "ollama" && (
              <div className="mb-4">
                <Field
                  label="Manual model"
                  caption="Use this when the endpoint cannot list models or when you already know the model id."
                >
                  <input
                    className="cf-input"
                    value={
                      draft?.aiProvider === "gemini"
                        ? (draft.geminiModel ?? "")
                        : draft?.aiProvider === "anthropic"
                          ? (draft.anthropicModel ?? "")
                          : (draft?.openAiCompatibleModel ?? "")
                    }
                    onChange={(event) =>
                      selectModel(event.target.value || null)
                    }
                    placeholder={
                      draft?.aiProvider === "gemini"
                        ? "gemini-1.5-flash"
                        : draft?.aiProvider === "anthropic"
                          ? "claude-3-5-sonnet-latest"
                          : "model-id"
                    }
                  />
                </Field>
              </div>
            )}

            {providerConfigChanged ? (
              <div className="rounded-2xl border border-amber-400/15 bg-amber-400/5 p-5">
                <p className="text-sm font-medium text-white">
                  Save integration to refresh models.
                </p>
                <p className="mt-2 text-sm leading-6 text-neutral-500">
                  ContextForge will check{" "}
                  {draft ? providerLabel(draft.aiProvider) : "this provider"}{" "}
                  after saving this provider configuration.
                </p>
              </div>
            ) : visibleModels.length === 0 ? (
              <div className="rounded-2xl border border-neutral-900 bg-black/35 p-5">
                <p className="text-sm font-medium text-white">
                  No models detected yet.
                </p>
                <p className="mt-2 text-sm leading-6 text-neutral-500">
                  Check the provider URL, start the local service, add a
                  provider key, or type a model id manually for cloud-compatible
                  endpoints.
                </p>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {visibleModels.map((model) => {
                  const isActive = selectedModel === model.name;

                  return (
                    <button
                      key={`${model.provider}:${model.name}`}
                      type="button"
                      onClick={() => selectModel(model.name)}
                      className={[
                        "group flex min-w-0 items-center gap-3 rounded-2xl border px-4 py-3 text-left transition duration-200",
                        isActive
                          ? "border-white bg-white text-black"
                          : "border-neutral-900 bg-black/35 text-neutral-400 hover:border-white/20 hover:bg-neutral-950 hover:text-white",
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "grid size-9 shrink-0 place-items-center rounded-xl border",
                          isActive
                            ? "border-black/10 bg-black/5 text-black"
                            : "border-neutral-800 bg-neutral-950 text-neutral-500",
                        ].join(" ")}
                      >
                        <Server size={15} />
                      </span>

                      <span className="min-w-0 flex-1">
                        <span
                          className={[
                            "block truncate text-sm font-semibold",
                            isActive ? "text-black" : "text-white",
                          ].join(" ")}
                        >
                          {model.name}
                        </span>
                        <span
                          className={[
                            "block truncate text-xs",
                            isActive ? "text-black/55" : "text-neutral-600",
                          ].join(" ")}
                        >
                          {model.description ?? providerLabel(model.provider)}
                          {model.size
                            ? ` · ${formatModelSize(model.size)}`
                            : ""}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </article>

          <article className="cf-card p-5">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-2xl">
                <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                  Agent targets
                </p>
                <h3 className="mt-2 text-lg font-semibold text-white">
                  Choose the default output format for generated Task Packs.
                </h3>
                <p className="mt-1 text-sm leading-6 text-neutral-500">
                  The target changes prompt framing only. It does not choose the
                  model provider or send code anywhere.
                </p>
              </div>

              <div className="w-full sm:w-[320px]">
                <CustomSelect
                  value={draft?.defaultTargetTool ?? "generic"}
                  options={TARGET_TOOL_SELECT_OPTIONS}
                  onChange={(defaultTargetTool) =>
                    updateDraft({ defaultTargetTool })
                  }
                  disabled={!draft}
                />
              </div>
            </div>

            <div className="mb-4 grid gap-3 lg:grid-cols-3">
              {PRIMARY_CODING_TARGETS.map((tool) => (
                <AgentTargetCard
                  key={tool}
                  tool={tool}
                  active={draft?.defaultTargetTool === tool}
                  disabled={!draft}
                  onSelect={(defaultTargetTool) =>
                    updateDraft({ defaultTargetTool })
                  }
                />
              ))}
            </div>

            <div className="mb-4 rounded-2xl border border-neutral-900 bg-black/25 px-4 py-3 text-xs leading-5 text-neutral-500">
              Codex, Cursor and Claude Code are the primary coding-agent
              formats. Gemini and Generic remain available in the dropdown for
              broader workflows.
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {draft && <AgentTargetPreview tool={draft.defaultTargetTool} />}
              <div className="rounded-[1.35rem] border border-neutral-900 bg-black/35 p-4">
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-400">
                    <Code2 size={16} />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-white">
                      Export-only workflow
                    </p>
                    <p className="mt-1 text-xs leading-5 text-neutral-500">
                      ContextForge prepares prompts, rules and context. The
                      external agent still performs the coding work.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </article>
        </div>

        <aside className="space-y-5">
          <article className="cf-card p-5">
            <div className="mb-4 flex size-10 items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-300">
              <Workflow size={18} />
            </div>
            <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
              Current pipeline
            </p>
            <h3 className="mt-2 text-base font-semibold text-white">
              {draft?.generationMode === "ollama"
                ? "AI-assisted generation"
                : "Template generation"}
            </h3>
            <p className="mt-2 text-sm leading-6 text-neutral-500">
              {draft?.generationMode === "ollama"
                ? `ContextForge will try ${draft ? providerLabel(draft.aiProvider) : "the provider"} and keep template fallback if the request fails.`
                : "ContextForge will use deterministic templates. Provider settings stay ready for later."}
            </p>

            <div className="mt-5 space-y-1">
              <PipelineStep
                index={1}
                title="Local project context"
                description="Scanner, AGENTS.md, Project Memory and selected files stay local."
                active
              />
              <PipelineStep
                index={2}
                title="Optional provider"
                description="Only AI-assisted mode calls the selected model provider."
                active={draft?.generationMode === "ollama"}
              />
              <PipelineStep
                index={3}
                title="Agent-ready output"
                description="Task Pack is formatted for the selected external coding agent."
                active
              />
            </div>
          </article>

          <article className="cf-card p-5">
            <div className="mb-4 flex size-10 items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-300">
              <KeyRound size={18} />
            </div>
            <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
              Safety model
            </p>
            <h3 className="mt-2 text-base font-semibold text-white">
              Keys stay server-side.
            </h3>
            <div className="mt-3 space-y-2 text-sm text-neutral-500">
              <p>API keys are accepted only through settings updates.</p>
              <p>
                Saved keys are not returned to the renderer or exported prompts.
              </p>
              <p>Template generation still works without any provider.</p>
            </div>
          </article>

          <article className="cf-card p-5">
            <div className="mb-4 flex size-10 items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-300">
              <PlugZap size={18} />
            </div>
            <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
              Connectors later
            </p>
            <h3 className="mt-2 text-base font-semibold text-white">
              Next integration layer.
            </h3>
            <div className="mt-4 grid gap-3">
              {CONNECTORS.map((connector) => (
                <ConnectorTile key={connector.title} {...connector} />
              ))}
            </div>
          </article>
        </aside>
      </div>

      {isLoading && !draft && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-2xl border border-neutral-900 bg-black/40 p-5 text-sm text-neutral-500"
        >
          Loading integrations...
        </motion.div>
      )}
    </section>
  );
}
