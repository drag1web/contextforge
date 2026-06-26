import type { TaskPackDraft } from "../../types";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { CustomSelect } from "../ui/CustomSelect";

interface TaskPackDraftModalProps {
  draft: TaskPackDraft;
  isLoading: boolean;
  onChange: (draft: TaskPackDraft) => void;
  onClose: () => void;
  onGenerate: () => void;
}

export function TaskPackDraftModal({
  draft,
  isLoading,
  onChange,
  onClose,
  onGenerate
}: TaskPackDraftModalProps) {
  return (
    <Modal
      title={`New task for ${draft.projectName}`}
      eyebrow="Task Pack Builder"
      maxWidth="max-w-3xl"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>

          <Button
            variant="primary"
            onClick={onGenerate}
            disabled={isLoading || draft.rawTask.trim().length < 3}
          >
            Generate task pack
          </Button>
        </>
      }
    >
      <div className="space-y-4 p-5">
        <div>
          <label className="mb-2 block text-sm text-neutral-400">
            Task description
          </label>

          <textarea
            value={draft.rawTask}
            onChange={(event) =>
              onChange({
                ...draft,
                rawTask: event.target.value
              })
            }
            placeholder="Example: Redesign login page with smooth language switch animation, but do not change backend auth API."
            className="min-h-36 w-full resize-none rounded-xl border border-neutral-800 bg-neutral-950 p-4 text-sm leading-6 text-white outline-none transition placeholder:text-neutral-700 focus:border-neutral-600"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-2 block text-sm text-neutral-400">Task type</label>

            <CustomSelect
              value={draft.taskType}
              onChange={(value) =>
                onChange({
                  ...draft,
                  taskType: value
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
              onChange={(value) =>
                onChange({
                  ...draft,
                  targetTool: value
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
        </div>
      </div>
    </Modal>
  );
}