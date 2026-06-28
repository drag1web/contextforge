import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Bot,
  CheckCircle2,
  Circle,
  Cpu,
  Keyboard,
  RefreshCw,
  Save,
  Server,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  XCircle
} from "lucide-react";

import {
  getAppSettings,
  getOllamaModels,
  getOllamaStatus,
  updateAppSettings
} from "../api/client";

import type { AppSettings, OllamaModel, OllamaStatus } from "../types";
import { Button } from "../components/ui/Button";
import { CustomSelect } from "../components/ui/CustomSelect";
import { appMeta } from "../config/appMeta";
import { keyboardShortcuts } from "../config/keyboardShortcuts";

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

function isSameSettings(
  current: AppSettings | null,
  draft: AppSettings | null
) {
  return JSON.stringify(current) === JSON.stringify(draft);
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

export function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<AppSettings | null>(null);
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null);
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [notice, setNotice] = useState("Settings are ready.");

  const hasUnsavedChanges = useMemo(() => {
    return !isSameSettings(settings, settingsDraft);
  }, [settings, settingsDraft]);

  async function loadOllamaInfo() {
    try {
      setIsLoading(true);

      const [appSettings, status, modelList] = await Promise.all([
        getAppSettings(),
        getOllamaStatus(),
        getOllamaModels()
      ]);

      setSettings(appSettings);
      setSettingsDraft(appSettings);
      setOllamaStatus(status);
      setModels(modelList);
      setNotice("Settings loaded.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Failed to load settings.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSaveSettings() {
    if (!settingsDraft) {
      return;
    }

    try {
      setIsLoading(true);

      const updatedSettings = await updateAppSettings(settingsDraft);

      setSettings(updatedSettings);
      setSettingsDraft(updatedSettings);
      setNotice("Settings saved.");

      const [status, modelList] = await Promise.all([
        getOllamaStatus(),
        getOllamaModels()
      ]);

      setOllamaStatus(status);
      setModels(modelList);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Failed to save settings.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadOllamaInfo();
  }, []);

  return (
    <section className="space-y-5">
      <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.012)_48%,rgba(255,255,255,0.006))] p-6 shadow-[0_16px_52px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.045)]">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0">
            <div className="mb-4 flex flex-wrap gap-2">
              <span className="cf-badge">
                <Settings size={13} />
                Settings
              </span>
              <span className="cf-badge">Local AI engine</span>
              <span className="cf-badge">Generation defaults</span>
            </div>

            <h2 className="max-w-4xl text-[34px] font-semibold leading-[1.05] tracking-[-0.05em] text-white">
              Control local AI generation, defaults and workflow preferences.
            </h2>

            <p className="mt-3 max-w-3xl text-sm leading-6 text-neutral-400">
              Configure Ollama, choose generation behavior, set default task
              options, and review available keyboard shortcuts.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              variant="secondary"
              onClick={loadOllamaInfo}
              disabled={isLoading}
            >
              <RefreshCw size={15} />
              Refresh
            </Button>

            <Button
              variant="primary"
              onClick={handleSaveSettings}
              disabled={isLoading || !settingsDraft || !hasUnsavedChanges}
            >
              <Save size={15} />
              {hasUnsavedChanges ? "Save changes" : "Saved"}
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-neutral-900 bg-black/45 px-4 py-3 text-sm text-neutral-400">
        {notice}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          <SettingCard
            icon={<Bot size={18} />}
            label="AI engine"
            title="Ollama integration"
            description="Local model provider used to refine generated AGENTS.md files and Task Packs without sending project context to a cloud service."
          >
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <StatusBadge status={ollamaStatus} />

              <span className="text-xs text-neutral-600">
                {ollamaStatus?.url ?? settingsDraft?.ollamaUrl ?? "No URL"}
              </span>
            </div>

            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(260px,0.7fr)]">
              <div className="rounded-2xl border border-neutral-900 bg-black/40 p-4">
                <label className="cf-tech-label text-[10px] uppercase text-neutral-600">
                  Ollama URL
                </label>

                <input
                  value={settingsDraft?.ollamaUrl ?? ""}
                  onChange={(event) =>
                    settingsDraft &&
                    setSettingsDraft({
                      ...settingsDraft,
                      ollamaUrl: event.target.value
                    })
                  }
                  className="cf-input mt-3"
                  placeholder="http://localhost:11434"
                />
              </div>

              <div className="rounded-2xl border border-neutral-900 bg-black/40 p-4">
                <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                  Status message
                </p>

                <p className="mt-3 text-sm leading-6 text-neutral-300">
                  {ollamaStatus?.message ?? "Checking Ollama..."}
                </p>
              </div>
            </div>
          </SettingCard>

          <SettingCard
            icon={<Server size={18} />}
            label="Local models"
            title="Detected Ollama models"
            description="Models available from the configured Ollama instance. Select one as default for Ollama-assisted generation."
          >
            {models.length === 0 ? (
              <div className="rounded-2xl border border-neutral-900 bg-black/40 p-5">
                <p className="text-sm font-medium text-white">No models detected</p>

                <p className="mt-2 text-sm leading-6 text-neutral-500">
                  Start Ollama and pull a model first:
                </p>

                <pre className="mt-4 overflow-auto rounded-xl border border-neutral-900 bg-black p-4 text-sm text-neutral-300">
                  ollama pull llama3.1
                </pre>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {models.map((model) => {
                  const isSelected = settingsDraft?.defaultOllamaModel === model.name;

                  return (
                    <button
                      key={model.name}
                      type="button"
                      onClick={() =>
                        settingsDraft &&
                        setSettingsDraft({
                          ...settingsDraft,
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
                            isSelected ? "text-black" : "text-white group-hover:text-black"
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
                          {model.model ?? "local model"} · {formatModelSize(model.size)}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </SettingCard>

          <SettingCard
            icon={<Keyboard size={18} />}
            label="Shortcuts"
            title="Keyboard shortcuts"
            description="Current and planned shortcuts for faster navigation inside ContextForge."
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
                      {shortcut.enabled ? "Enabled" : "Soon"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </SettingCard>
        </div>

        <aside className="space-y-5">
          <article className="cf-card p-5">
            <div className="mb-4 flex size-10 items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-200">
              <SlidersHorizontal size={18} />
            </div>

            <p className="cf-tech-label text-xs uppercase text-neutral-500">
              Generation preferences
            </p>

            <div className="mt-5 space-y-4">
              <div>
                <label className="mb-2 block text-sm text-neutral-400">
                  Generation mode
                </label>

                <CustomSelect
                  value={settingsDraft?.generationMode ?? "template"}
                  onChange={(value) =>
                    settingsDraft &&
                    setSettingsDraft({
                      ...settingsDraft,
                      generationMode: value as AppSettings["generationMode"]
                    })
                  }
                  options={[
                    {
                      value: "template",
                      label: "Template",
                      description: "Fast deterministic generation"
                    },
                    {
                      value: "ollama",
                      label: "Ollama-assisted",
                      description: "Improve prompts with a local model"
                    }
                  ]}
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-neutral-400">
                  Default target AI tool
                </label>

                <CustomSelect
                  value={settingsDraft?.defaultTargetTool ?? "codex"}
                  onChange={(value) =>
                    settingsDraft &&
                    setSettingsDraft({
                      ...settingsDraft,
                      defaultTargetTool: value as AppSettings["defaultTargetTool"]
                    })
                  }
                  options={[
                    {
                      value: "codex",
                      label: "Codex",
                      description: "OpenAI coding agent workflow"
                    },
                    {
                      value: "cursor",
                      label: "Cursor",
                      description: "IDE-first editing workflow"
                    },
                    {
                      value: "claude",
                      label: "Claude Code",
                      description: "Architecture-aware coding workflow"
                    },
                    {
                      value: "generic",
                      label: "Generic AI Agent",
                      description: "Universal prompt format"
                    }
                  ]}
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-neutral-400">
                  Default task type
                </label>

                <CustomSelect
                  value={settingsDraft?.defaultTaskType ?? "general"}
                  onChange={(value) =>
                    settingsDraft &&
                    setSettingsDraft({
                      ...settingsDraft,
                      defaultTaskType: value as AppSettings["defaultTaskType"]
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
                  Default Ollama model
                </label>

                <CustomSelect
                  value={settingsDraft?.defaultOllamaModel ?? ""}
                  onChange={(value) =>
                    settingsDraft &&
                    setSettingsDraft({
                      ...settingsDraft,
                      defaultOllamaModel: value || null
                    })
                  }
                  options={[
                    {
                      value: "",
                      label: "No model selected",
                      description: "Use template mode only"
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
          </article>

          <article className="cf-card p-5">
            <div className="mb-4 flex size-10 items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-200">
              <ShieldCheck size={18} />
            </div>

            <p className="cf-tech-label text-xs uppercase text-neutral-500">
              System
            </p>

            <div className="mt-5 space-y-3 text-sm">
              <div className="flex items-center justify-between gap-4">
                <span className="text-neutral-500">Name</span>
                <span className="font-medium text-white">{appMeta.name}</span>
              </div>

              <div className="flex items-center justify-between gap-4">
                <span className="text-neutral-500">Version</span>
                <span className="font-medium text-white">v{appMeta.version}</span>
              </div>

              <div className="flex items-center justify-between gap-4">
                <span className="text-neutral-500">Phase</span>
                <span className="font-medium text-white">{appMeta.phase}</span>
              </div>

              <div className="flex items-center justify-between gap-4">
                <span className="text-neutral-500">Mode</span>
                <span className="font-medium text-white">Local-first</span>
              </div>
            </div>

            <p className="mt-5 text-sm leading-6 text-neutral-500">
              {appMeta.description}
            </p>
          </article>

          <article className="cf-card p-5">
            <div className="mb-4 flex size-10 items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-200">
              <Sparkles size={18} />
            </div>

            <p className="cf-tech-label text-xs uppercase text-neutral-500">
              Generation modes
            </p>

            <div className="mt-5 space-y-3">
              <div className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-4">
                <div className="flex items-start gap-3">
                  <CheckCircle2 size={16} className="mt-0.5 text-emerald-300" />

                  <div>
                    <p className="text-sm font-medium text-white">Template mode</p>
                    <p className="mt-1 text-sm leading-5 text-neutral-500">
                      Stable fallback. Generates deterministic context and prompts.
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-neutral-900 bg-black/40 p-4">
                <div className="flex items-start gap-3">
                  {ollamaStatus?.online ? (
                    <CheckCircle2 size={16} className="mt-0.5 text-emerald-300" />
                  ) : (
                    <XCircle size={16} className="mt-0.5 text-red-400" />
                  )}

                  <div>
                    <p className="text-sm font-medium text-white">
                      Ollama-assisted mode
                    </p>
                    <p className="mt-1 text-sm leading-5 text-neutral-500">
                      Uses local models to refine generated Task Packs.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </article>
        </aside>
      </div>
    </section>
  );
}