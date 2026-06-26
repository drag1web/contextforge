import { useEffect, useState } from "react";
import { Bot, CheckCircle2, RefreshCw, Save, Server, Settings, XCircle } from "lucide-react";
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

export function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<AppSettings | null>(null);
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null);
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [notice, setNotice] = useState("Settings are ready.");

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
    <section className="space-y-6">
      <div className="cf-card p-6">
        <div className="flex items-start justify-between gap-8">
          <div>
            <p className="cf-badge mb-4">
              <Settings size={13} />
              Settings
            </p>

            <h3 className="max-w-3xl text-3xl font-semibold tracking-[-0.04em] text-white">
              Configure local AI integrations and generation preferences.
            </h3>

            <p className="mt-4 max-w-2xl text-sm leading-6 text-neutral-400">
              ContextForge can work in template mode now, and later use Ollama to
              improve generated AGENTS.md files and task packs locally.
            </p>
          </div>

          <div className="flex gap-3">
            <Button variant="secondary" onClick={loadOllamaInfo} disabled={isLoading}>
              <RefreshCw size={15} />
              Refresh
            </Button>

            <Button
              variant="primary"
              onClick={handleSaveSettings}
              disabled={isLoading || !settingsDraft}
            >
              <Save size={15} />
              Save
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-neutral-900 bg-neutral-950/50 px-4 py-3 text-sm text-neutral-400">
        {notice}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <div className="cf-card p-5">
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <Bot size={16} className="text-neutral-300" />
                  <h4 className="text-sm font-medium text-white">Ollama integration</h4>
                </div>

                <p className="text-sm leading-6 text-neutral-500">
                  Local model provider for improved prompt generation.
                </p>
              </div>

              <div
                className={[
                  "rounded-full border px-3 py-1 text-xs",
                  ollamaStatus?.online
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                    : "border-neutral-800 bg-neutral-950 text-neutral-500"
                ].join(" ")}
              >
                {ollamaStatus?.online ? "Online" : "Offline"}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-neutral-900 bg-black/40 p-4">
                <label className="text-[10px] uppercase tracking-[0.22em] text-neutral-600">
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
                <p className="text-[10px] uppercase tracking-[0.22em] text-neutral-600">
                  Status message
                </p>

                <p className="mt-3 text-sm text-neutral-300">
                  {ollamaStatus?.message ?? "Checking Ollama..."}
                </p>
              </div>
            </div>
          </div>

          <div className="cf-card p-5">
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <Server size={16} className="text-neutral-300" />
                  <h4 className="text-sm font-medium text-white">Local models</h4>
                </div>

                <p className="text-sm leading-6 text-neutral-500">
                  Models detected from your local Ollama instance.
                </p>
              </div>

              <p className="text-sm text-neutral-500">{models.length} models</p>
            </div>

            {models.length === 0 ? (
              <div className="rounded-2xl border border-neutral-900 bg-black/40 p-5">
                <p className="text-sm font-medium text-white">No models detected</p>

                <p className="mt-2 text-sm leading-6 text-neutral-500">
                  Start Ollama and pull a model, for example:
                </p>

                <pre className="mt-4 overflow-auto rounded-xl border border-neutral-900 bg-black p-4 text-sm text-neutral-300">
                  ollama pull llama3.1
                </pre>
              </div>
            ) : (
              <div className="grid gap-3">
                {models.map((model) => (
                  <div
                    key={model.name}
                    className="rounded-2xl border border-neutral-900 bg-black/40 p-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-white">
                          {model.name}
                        </p>

                        <p className="mt-1 text-xs text-neutral-600">
                          {model.model ?? "local model"}
                        </p>
                      </div>

                      <span className="cf-badge">{formatModelSize(model.size)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <aside className="space-y-4">
          <div className="cf-card p-5">
            <p className="mb-3 text-sm font-medium text-white">Application</p>

            <div className="space-y-3 text-sm">
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
            </div>

            <p className="mt-4 text-sm leading-6 text-neutral-500">
              {appMeta.description}
            </p>
          </div>
          <div className="cf-card p-5">
            <p className="mb-4 text-sm font-medium text-white">Generation preferences</p>

            <div className="space-y-4">
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
                      description: "Improve prompts with local model"
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
                      description: "API, DB, server logic"
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
          </div>

          <div className="cf-card p-5">
            <p className="mb-3 text-sm font-medium text-white">Generation modes</p>

            <div className="space-y-3">
              <div className="rounded-2xl border border-neutral-800 bg-neutral-950/70 p-4">
                <div className="flex items-start gap-3">
                  <CheckCircle2 size={16} className="mt-0.5 text-emerald-400" />

                  <div>
                    <p className="text-sm font-medium text-white">Template mode</p>
                    <p className="mt-1 text-sm leading-5 text-neutral-500">
                      Works now. Generates deterministic AGENTS.md and task packs.
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-neutral-900 bg-black/40 p-4">
                <div className="flex items-start gap-3">
                  {ollamaStatus?.online ? (
                    <CheckCircle2 size={16} className="mt-0.5 text-emerald-400" />
                  ) : (
                    <XCircle size={16} className="mt-0.5 text-neutral-600" />
                  )}

                  <div>
                    <p className="text-sm font-medium text-white">Ollama-assisted mode</p>
                    <p className="mt-1 text-sm leading-5 text-neutral-500">
                      Next step. Will improve generated prompts using a local model.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>

      <p className="hidden">{settings?.generationMode}</p>
    </section>
  );
}