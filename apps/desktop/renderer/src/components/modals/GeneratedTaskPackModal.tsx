import type { TaskPack } from "../../types";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";

interface GeneratedTaskPackModalProps {
  taskPack: TaskPack;
  onClose: () => void;
}

function formatDuration(durationMs?: number | null) {
  if (!durationMs) {
    return null;
  }

  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  return `${(durationMs / 1000).toFixed(1)} sec`;
}

export function GeneratedTaskPackModal({
  taskPack,
  onClose
}: GeneratedTaskPackModalProps) {
  return (
    <Modal
      title={taskPack.title}
      eyebrow="Generated Task Pack"
      onClose={onClose}
      footer={
        <Button
          variant="primary"
          onClick={() => navigator.clipboard.writeText(taskPack.generatedPrompt)}
        >
          Copy prompt
        </Button>
      }
    >
      {taskPack.generationMessage && (
        <div className="mb-4 rounded-xl border border-neutral-900 bg-neutral-950/70 px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-neutral-600">
                Generation
              </p>

              <p className="mt-1 text-sm text-neutral-300">
                {taskPack.generationMessage}
              </p>
            </div>

            <span
              className={[
                "shrink-0 rounded-full border px-3 py-1 text-xs",
                taskPack.generationMode === "ollama"
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  : "border-neutral-800 bg-black text-neutral-500"
              ].join(" ")}
            >
              {taskPack.generationMode === "ollama" ? "Ollama" : "Template"}
            </span>
          </div>
        </div>
      )}
      {taskPack.generationDurationMs && (
        <p className="mt-1 text-xs text-neutral-600">
          Duration: {formatDuration(taskPack.generationDurationMs)}
        </p>
      )}
      <pre className="min-h-0 overflow-auto p-5 text-sm leading-6 text-neutral-300">
        {taskPack.generatedPrompt}
      </pre>
    </Modal>
  );
}