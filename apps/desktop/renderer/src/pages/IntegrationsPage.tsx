import { useEffect, useMemo, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  CheckCircle2,
  Cpu,
  KeyRound,
  Loader2,
  PlugZap,
  RefreshCw,
  Save,
  Server,
  ShieldCheck,
  Sparkles,
  WifiOff
} from "lucide-react";

import {
  getAiIntegrationModels,
  getAiIntegrationStatus,
  getAppSettings,
  updateAppSettings
} from "../api/client";
import { AiToolLogo } from "../components/ai/AiToolLogo";
import {
  getAiToolDescription,
  getAiToolLabel,
  TARGET_TOOL_OPTIONS
} from "../components/ai/aiToolOptions";
import type {
  AiProviderId,
  AiProviderModel,
  AiProviderStatus,
  AppSettings,
  TargetTool
} from "../types";

function providerLabel(provider: AiProviderId) {
  if (provider === "openai-compatible") {
    return "OpenAI-compatible";
  }

  if (provider === "gemini") {
    return "Gemini";
  }

  return "Ollama";
}

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
      settings.geminiBaseUrl ?? "https://generativelanguage.googleapis.com/v1beta",
    geminiModel: settings.geminiModel ?? "gemini-1.5-flash",
    geminiApiKeyConfigured: settings.geminiApiKeyConfigured ?? false
  };
}

function StatusPill({
  pending = false,
  status
}: {
  pending?: boolean;
  status: AiProviderStatus | null;
}) {
  if (pending) {
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-xs font-medium text-amber-200">
        <RefreshCw size={13} />
        Not checked
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
          : "border-neutral-800 bg-neutral-950 text-neutral-500"
      ].join(" ")}
    >
      {online ? <CheckCircle2 size={13} /> : <WifiOff size={13} />}
      {online ? "Connected" : "Not connected"}
    </span>
  );
}

function ProviderCard({
  provider,
  active,
  title,
  description,
  icon,
  meta,
  onSelect
}: {
  provider: AiProviderId;
  active: boolean;
  title: string;
  description: string;
  icon: ReactNode;
  meta: string;
  onSelect: (provider: AiProviderId) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(provider)}
      className={[
        "group relative overflow-hidden rounded-[1.5rem] border p-5 text-left transition duration-200",
        active
          ? "border-white bg-white text-black shadow-[0_18px_52px_rgba(255,255,255,0.08)]"
          : "border-neutral-900 bg-black/35 text-neutral-400 hover:border-white/20 hover:bg-neutral-950 hover:text-white"
      ].join(" ")}
    >
      <div className="mb-5 flex items-start justify-between gap-4">
        <span
          className={[
            "grid size-11 place-items-center rounded-2xl border transition",
            active
              ? "border-black/10 bg-black/5 text-black"
              : "border-neutral-800 bg-neutral-950 text-neutral-500 group-hover:border-white/15 group-hover:text-white"
          ].join(" ")}
        >
          {icon}
        </span>

        {active && <CheckCircle2 size={18} className="text-black" />}
      </div>

      <span
        className={[
          "mb-3 inline-flex rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em]",
          active
            ? "border-black/10 text-black/55"
            : "border-neutral-800 text-neutral-600"
        ].join(" ")}
      >
        {meta}
      </span>

      <h3
        className={[
          "text-base font-semibold",
          active ? "text-black" : "text-white"
        ].join(" ")}
      >
        {title}
      </h3>

      <p
        className={[
          "mt-2 text-sm leading-6",
          active ? "text-black/60" : "text-neutral-500"
        ].join(" ")}
      >
        {description}
      </p>
    </button>
  );
}

function AgentTargetCard({
  tool,
  active,
  onSelect
}: {
  tool: TargetTool;
  active: boolean;
  onSelect: (tool: TargetTool) => void;
}) {
  const label = getAiToolLabel(tool);
  const description = getAiToolDescription(tool);

  return (
    <button
      type="button"
      onClick={() => onSelect(tool)}
      className={[
        "group flex min-w-0 items-center gap-3 rounded-2xl border px-4 py-3 text-left transition duration-200",
        active
          ? "border-white bg-white text-black"
          : "border-neutral-900 bg-black/35 text-neutral-400 hover:border-white/20 hover:bg-neutral-950 hover:text-white"
      ].join(" ")}
    >
      <AiToolLogo
        tool={tool}
        size="lg"
        className={active ? "border-black/10 bg-black/5" : ""}
      />

      <span className="min-w-0 flex-1">
        <span
          className={[
            "block truncate text-sm font-semibold",
            active ? "text-black" : "text-white"
          ].join(" ")}
        >
          {label}
        </span>
        <span
          className={[
            "block truncate text-xs",
            active ? "text-black/55" : "text-neutral-600"
          ].join(" ")}
        >
          {description}
        </span>
      </span>

      {active && <CheckCircle2 size={16} className="shrink-0 text-black" />}
    </button>
  );
}

function Field({
  label,
  children,
  caption
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

export function IntegrationsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [status, setStatus] = useState<AiProviderStatus | null>(null);
  const [models, setModels] = useState<AiProviderModel[]>([]);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [geminiApiKeyDraft, setGeminiApiKeyDraft] = useState("");
  const [clearApiKey, setClearApiKey] = useState(false);
  const [clearGeminiApiKey, setClearGeminiApiKey] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [activeAction, setActiveAction] = useState<"refresh" | "save" | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  const selectedModel = useMemo(() => {
    if (!draft) {
      return null;
    }

    if (draft.aiProvider === "gemini") {
      return draft.geminiModel;
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
        settings.openAiCompatibleBaseUrl !==
          draft.openAiCompatibleBaseUrl ||
        apiKeyDraft.trim().length > 0 ||
        clearApiKey
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
    draft,
    geminiApiKeyDraft,
    settings
  ]);

  const statusMatchesDraft = Boolean(
    draft &&
      status &&
      status.provider === draft.aiProvider &&
      !providerConfigChanged
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
      clearApiKey ||
      clearGeminiApiKey
    );
  }, [apiKeyDraft, clearApiKey, clearGeminiApiKey, draft, geminiApiKeyDraft, settings]);

  async function refresh() {
    try {
      setError(null);
      setIsLoading(true);
      setActiveAction("refresh");

      const [nextSettings, nextStatus, nextModels] = await Promise.all([
        getAppSettings(),
        getAiIntegrationStatus(),
        getAiIntegrationModels()
      ]);

      const normalized = withSettingsDefaults(nextSettings);

      setSettings(normalized);
      setDraft(normalized);
      setStatus(nextStatus);
      setModels(nextModels);
      setApiKeyDraft("");
      setGeminiApiKeyDraft("");
      setClearApiKey(false);
      setClearGeminiApiKey(false);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to load integrations."
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
          clearGeminiApiKey
        })
      );

      window.dispatchEvent(
        new CustomEvent("contextforge:settings-updated", {
          detail: updatedSettings
        })
      );

      const [nextStatus, nextModels] = await Promise.all([
        getAiIntegrationStatus(),
        getAiIntegrationModels()
      ]);

      setSettings(updatedSettings);
      setDraft(updatedSettings);
      setStatus(nextStatus);
      setModels(nextModels);
      setApiKeyDraft("");
      setGeminiApiKeyDraft("");
      setClearApiKey(false);
      setClearGeminiApiKey(false);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to save integrations."
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
    updateDraft({
      aiProvider: provider
    });
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

    updateDraft({ defaultOllamaModel: modelName });
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <section className="space-y-5 text-render-crisp">
      <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.012)_48%,rgba(255,255,255,0.006))] p-6 shadow-[0_16px_52px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.045)]">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0">
            <div className="mb-4 flex flex-wrap gap-2">
              <span className="cf-badge">
                <PlugZap size={13} />
                Integrations
              </span>
              <span className="cf-badge">Model providers</span>
              <span className="cf-badge">Agent targets</span>
            </div>

            <h2 className="max-w-4xl text-[34px] font-semibold leading-[1.05] tracking-[-0.05em] text-white">
              Connect the models and coding agents around ContextForge.
            </h2>

            <p className="mt-3 max-w-3xl text-sm leading-6 text-neutral-400">
              Model providers power analysis and refinement. Agent targets shape
              the final Task Pack for Codex, Claude Code, Cursor, Gemini, or a
              generic coding assistant.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <StatusPill
              status={visibleStatus}
              pending={providerConfigChanged}
            />

            <button
              type="button"
              onClick={refresh}
              disabled={isLoading}
              className="inline-flex h-10 items-center gap-2 rounded-full border border-neutral-800 bg-black/40 px-4 text-sm font-medium text-neutral-300 transition hover:border-white/20 hover:bg-white hover:text-black disabled:pointer-events-none disabled:opacity-50"
            >
              {activeAction === "refresh" ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <RefreshCw size={15} />
              )}
              Refresh
            </button>

            <button
              type="button"
              onClick={save}
              disabled={isLoading || !draft || !hasUnsavedChanges}
              className="inline-flex h-10 items-center gap-2 rounded-full border border-white bg-white px-4 text-sm font-semibold text-black transition disabled:pointer-events-none disabled:opacity-45"
            >
              {activeAction === "save" ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Save size={15} />
              )}
              Save integration
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-400/25 bg-red-950/20 p-4 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <article className="cf-card p-5">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                  Model providers
                </p>
                <h3 className="mt-2 text-lg font-semibold text-white">
                  Choose which LLM ContextForge uses internally.
                </h3>
              </div>

              <span className="rounded-full border border-neutral-800 bg-black/40 px-3 py-1 text-xs text-neutral-500">
                {providerConfigChanged ? "Selected" : "Active"}:{" "}
                {draft ? providerLabel(draft.aiProvider) : "Loading"}
              </span>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <ProviderCard
                provider="ollama"
                active={draft?.aiProvider === "ollama"}
                title="Ollama"
                description="Local models running on your machine. Best for private and offline workflows."
                meta="Local"
                icon={<Cpu size={18} />}
                onSelect={selectProvider}
              />

              <ProviderCard
                provider="openai-compatible"
                active={draft?.aiProvider === "openai-compatible"}
                title="OpenAI-compatible"
                description="Any endpoint with /v1/models and /v1/chat/completions, including local proxies."
                meta="Endpoint"
                icon={<AiToolLogo tool="openai" size="lg" />}
                onSelect={selectProvider}
              />

              <ProviderCard
                provider="gemini"
                active={draft?.aiProvider === "gemini"}
                title="Gemini"
                description="Google Gemini API through a server-side key. Useful when you want Google models."
                meta="Cloud"
                icon={<AiToolLogo tool="gemini" size="lg" />}
                onSelect={selectProvider}
              />
            </div>
          </article>

          <article className="cf-card p-5">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                  Active provider
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
                  caption="Template remains the safe fallback. AI-assisted uses the selected provider."
                >
                  <select
                    className="cf-input"
                    value={draft.generationMode}
                    onChange={(event) =>
                      updateDraft({
                        generationMode:
                          event.target.value as AppSettings["generationMode"]
                      })
                    }
                  >
                    <option value="template">Template only</option>
                    <option value="ollama">AI-assisted</option>
                  </select>
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
                        openAiCompatibleBaseUrl: event.target.value
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
                      updateDraft({
                        geminiBaseUrl: event.target.value
                      })
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
                        ? draft.geminiModel ?? ""
                        : draft?.openAiCompatibleModel ?? ""
                    }
                    onChange={(event) => selectModel(event.target.value || null)}
                    placeholder={
                      draft?.aiProvider === "gemini"
                        ? "gemini-1.5-flash"
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
                  Check the provider URL, start the local service, add a provider
                  key, or type a model id manually for cloud-compatible endpoints.
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
                          : "border-neutral-900 bg-black/35 text-neutral-400 hover:border-white/20 hover:bg-neutral-950 hover:text-white"
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "grid size-9 shrink-0 place-items-center rounded-xl border",
                          isActive
                            ? "border-black/10 bg-black/5 text-black"
                            : "border-neutral-800 bg-neutral-950 text-neutral-500"
                        ].join(" ")}
                      >
                        <Server size={15} />
                      </span>

                      <span className="min-w-0 flex-1">
                        <span
                          className={[
                            "block truncate text-sm font-semibold",
                            isActive ? "text-black" : "text-white"
                          ].join(" ")}
                        >
                          {model.name}
                        </span>
                        <span
                          className={[
                            "block truncate text-xs",
                            isActive ? "text-black/55" : "text-neutral-600"
                          ].join(" ")}
                        >
                          {model.description ?? providerLabel(model.provider)}
                          {model.size ? ` · ${formatModelSize(model.size)}` : ""}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </article>

          <article className="cf-card p-5">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                  Agent targets
                </p>
                <h3 className="mt-2 text-lg font-semibold text-white">
                  Choose the default agent format for generated Task Packs.
                </h3>
                <p className="mt-1 text-sm leading-6 text-neutral-500">
                  This does not change the model provider. It changes how the
                  final prompt is framed for the coding tool you plan to use.
                </p>
              </div>

              <span className="rounded-full border border-neutral-800 bg-black/40 px-3 py-1 text-xs text-neutral-500">
                Default: {draft ? getAiToolLabel(draft.defaultTargetTool) : "Loading"}
              </span>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {TARGET_TOOL_OPTIONS.map((option) => (
                <AgentTargetCard
                  key={option.value}
                  tool={option.value}
                  active={draft?.defaultTargetTool === option.value}
                  onSelect={(tool) => updateDraft({ defaultTargetTool: tool })}
                />
              ))}
            </div>
          </article>
        </div>

        <aside className="space-y-5">
          <article className="cf-card p-5">
            <div className="mb-4 flex size-10 items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-300">
              <Sparkles size={18} />
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
                ? `ContextForge will try ${providerLabel(draft.aiProvider)} first and use template fallback if the provider fails.`
                : "ContextForge will use deterministic templates. Provider settings stay ready for later."}
            </p>
          </article>

          <article className="cf-card p-5">
            <div className="mb-4 flex size-10 items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-300">
              <ShieldCheck size={18} />
            </div>
            <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
              Safety
            </p>
            <h3 className="mt-2 text-base font-semibold text-white">
              Keys stay server-side.
            </h3>
            <p className="mt-2 text-sm leading-6 text-neutral-500">
              Provider keys are accepted only through settings updates and are
              never returned by settings, status, model, or generation responses.
            </p>
          </article>

          <article className="cf-card p-5">
            <div className="mb-4 flex size-10 items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-300">
              <KeyRound size={18} />
            </div>
            <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
              Integration map
            </p>
            <div className="mt-3 space-y-3 text-sm text-neutral-500">
              <p>Ollama, OpenAI-compatible and Gemini can power AI-assisted generation.</p>
              <p>Codex, Claude Code, Cursor, Gemini and Generic define output format.</p>
              <p>MCP connectors and CLI launch actions can plug into this page later.</p>
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
