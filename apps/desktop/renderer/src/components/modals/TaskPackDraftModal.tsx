import { useMemo } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Lightbulb,
  Sparkles,
  Target,
  WandSparkles
} from "lucide-react";

import type { TaskPackDraft } from "../../types";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { CustomSelect } from "../ui/CustomSelect";

interface TaskPackDraftModalProps {
  draft: TaskPackDraft;
  isLoading: boolean;
  onChange: (draft: TaskPackDraft) => void;
  onClose: () => void;
  onAnalyzeContext: () => void;
  onGenerate: () => void;
}

const TASK_EXAMPLES = [
  {
    label: "UI polish",
    value:
      "Improve the selected page UI without changing backend behavior. Keep the current functionality, make the layout cleaner, add smooth interactions, and preserve the existing design system."
  },
  {
    label: "Bugfix",
    value:
      "Find and fix the issue described below. Keep the solution minimal, explain the root cause, and avoid unrelated refactoring."
  },
  {
    label: "Refactor",
    value:
      "Refactor this area to improve readability and maintainability without changing user-visible behavior. Preserve existing APIs and add notes about any risky assumptions."
  },
  {
    label: "Backend",
    value:
      "Implement the backend changes for this feature, including API behavior, validation, error handling, and any required persistence updates."
  }
];

function getTaskQuality(rawTask: string) {
  const length = rawTask.trim().length;

  if (length >= 120) {
    return {
      label: "Good task",
      description: "Enough detail for file selection and prompt generation.",
      icon: <CheckCircle2 size={15} className="text-emerald-300" />
    };
  }

  if (length >= 30) {
    return {
      label: "Needs more detail",
      description: "Add constraints, expected behavior, and what not to change.",
      icon: <AlertTriangle size={15} className="text-red-400" />
    };
  }

  return {
    label: "Too short",
    description: "Describe the task before generating a Task Pack.",
    icon: <AlertTriangle size={15} className="text-red-400" />
  };
}

export function TaskPackDraftModal({
  draft,
  isLoading,
  onChange,
  onClose,
  onAnalyzeContext,
  onGenerate
}: TaskPackDraftModalProps) {
  const taskLength = draft.rawTask.trim().length;
  const taskQuality = useMemo(() => getTaskQuality(draft.rawTask), [draft.rawTask]);
  const canGenerate = taskLength >= 3 && !isLoading;

  function updateDraft(patch: Partial<TaskPackDraft>) {
    onChange({
      ...draft,
      ...patch
    });
  }

  return (
    <Modal
      title={`New task — ${draft.projectName}`}
      eyebrow="Task Pack Builder"
      maxWidth="max-w-[980px]"
      scrollable={false}
      onClose={onClose}
      footer={
        <div className="flex w-full items-center justify-between gap-4">
          <p className="hidden text-xs leading-5 text-neutral-600 md:block">
            A clearer task produces better file selection and a safer prompt.
          </p>

          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>

            <Button
              variant="secondary"
              onClick={onAnalyzeContext}
              disabled={!canGenerate}
            >
              <Sparkles size={15} />
              Analyze Context
            </Button>

            <Button
              variant="primary"
              onClick={onGenerate}
              disabled={!canGenerate}
            >
              <WandSparkles size={15} />
              {isLoading ? "Generating..." : "Generate Task Pack"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid h-[calc(100vh-220px)] min-h-[520px] gap-5 overflow-hidden p-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-[1.5rem] border border-neutral-900 bg-black/35 p-5">
          <div className="mb-5 flex flex-wrap gap-2">
            <span className="cf-badge">
              <Sparkles size={13} />
              Task source
            </span>
            <span className="cf-badge">{draft.projectName}</span>
            <span className="cf-badge">{draft.targetTool}</span>
          </div>

          <div className="mb-4">
            <h3 className="text-2xl font-semibold tracking-[-0.04em] text-white">
              Describe what the AI agent should do.
            </h3>

            <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-500">
              Include the desired result, constraints, files or areas to focus on,
              and anything the agent must not change.
            </p>
          </div>

          <div className="mb-4 flex flex-wrap gap-2">
            {TASK_EXAMPLES.map((example) => (
              <button
                key={example.label}
                type="button"
                onClick={() => updateDraft({ rawTask: example.value })}
                className="cf-invert-action inline-flex h-8 items-center rounded-full px-3 text-xs"
              >
                {example.label}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-neutral-900 bg-black/55 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
            <textarea
              value={draft.rawTask}
              onChange={(event) => updateDraft({ rawTask: event.target.value })}
              placeholder="Example: Redesign the login page with smoother language switch animation. Keep auth API unchanged, preserve current localization logic, remove old visual clutter, and make the UI match the new ContextForge design style."
              className="h-full min-h-0 w-full resize-none rounded-xl border border-transparent bg-transparent p-4 text-sm leading-7 text-white outline-none placeholder:text-neutral-700 focus:border-white/10"
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {taskQuality.icon}

              <div>
                <p className="text-sm font-medium text-white">
                  {taskQuality.label}
                </p>

                <p className="text-xs text-neutral-600">
                  {taskQuality.description}
                </p>
              </div>
            </div>

            <span className="rounded-full border border-neutral-900 bg-neutral-950 px-2.5 py-1 text-[11px] text-neutral-500">
              {taskLength} chars
            </span>
          </div>
        </section>

        <aside className="flex min-h-0 flex-col gap-5 overflow-hidden">
          <article className="cf-card p-5">
            <div className="mb-4 flex size-10 items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-200">
              <Target size={18} />
            </div>

            <p className="cf-tech-label text-xs uppercase text-neutral-500">
              Generation target
            </p>

            <div className="mt-5 space-y-4">
              <div>
                <label className="mb-2 block text-sm text-neutral-400">
                  Task type
                </label>

                <CustomSelect
                  value={draft.taskType}
                  onChange={(value) => updateDraft({ taskType: value })}
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
                      description: "Improve code safely"
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
                  Target AI tool
                </label>

                <CustomSelect
                  value={draft.targetTool}
                  onChange={(value) => updateDraft({ targetTool: value })}
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
            </div>
          </article>

          <article className="cf-card p-5">
            <div className="mb-4 flex size-10 items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-200">
              <Lightbulb size={18} />
            </div>

            <p className="cf-tech-label text-xs uppercase text-neutral-500">
              Better task prompt
            </p>

            <div className="mt-4 space-y-3 text-sm leading-6 text-neutral-500">
              <p>
                Good tasks usually include:
              </p>

              <ul className="space-y-2">
                <li>• expected result;</li>
                <li>• constraints and forbidden changes;</li>
                <li>• UI/backend area to focus on;</li>
                <li>• acceptance criteria.</li>
              </ul>
            </div>
          </article>

          <article className="cf-card p-5">
            <div className="mb-4 flex size-10 items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-200">
              <Bot size={18} />
            </div>

            <p className="cf-tech-label text-xs uppercase text-neutral-500">
              Pipeline
            </p>

            <div className="mt-4 space-y-3">
              <div className="flex items-start gap-3">
                <CheckCircle2 size={15} className="mt-0.5 text-emerald-300" />
                <p className="text-sm leading-5 text-neutral-500">
                  Analyze task intent.
                </p>
              </div>

              <div className="flex items-start gap-3">
                <CheckCircle2 size={15} className="mt-0.5 text-emerald-300" />
                <p className="text-sm leading-5 text-neutral-500">
                  Select relevant project files.
                </p>
              </div>

              <div className="flex items-start gap-3">
                <CheckCircle2 size={15} className="mt-0.5 text-emerald-300" />
                <p className="text-sm leading-5 text-neutral-500">
                  Generate validated Task Pack.
                </p>
              </div>
            </div>
          </article>
        </aside>
      </div>
    </Modal>
  );
}