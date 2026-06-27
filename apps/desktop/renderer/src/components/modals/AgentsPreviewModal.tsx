import type { AgentsPreview } from "../../types";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";

interface AgentsPreviewModalProps {
  preview: AgentsPreview;
  isLoading: boolean;
  onClose: () => void;
  onSave: () => void;
}

function formatDuration(durationMs?: number) {
  if (!durationMs) {
    return null;
  }

  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  return `${(durationMs / 1000).toFixed(1)} sec`;
}

export function AgentsPreviewModal({
  preview,
  isLoading,
  onClose,
  onSave
}: AgentsPreviewModalProps) {
  return (
    <Modal
      title={`AGENTS.md preview — ${preview.projectName}`}
      eyebrow="Context Builder"
      onClose={onClose}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => navigator.clipboard.writeText(preview.markdown)}
          >
            Copy
          </Button>

          <Button variant="primary" onClick={onSave} disabled={isLoading}>
            Save to project
          </Button>
        </>
      }
    >
      {preview.generation && (
        <div className="mx-5 mt-4 rounded-xl border border-neutral-900 bg-neutral-950/70 px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-neutral-600">
                Generation
              </p>

              <p className="mt-1 text-sm text-neutral-300">
                {preview.generation.message}
              </p>

              {preview.generation.durationMs && (
                <p className="mt-1 text-xs text-neutral-600">
                  Duration: {formatDuration(preview.generation.durationMs)}
                </p>
              )}
            </div>

            <span
              className={[
                "shrink-0 rounded-full border px-3 py-1 text-xs",
                preview.generation.mode === "ollama"
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  : "border-neutral-800 bg-black text-neutral-500"
              ].join(" ")}
            >
              {preview.generation.cached
                ? "Cached"
                : preview.generation.mode === "ollama"
                  ? "Ollama"
                  : "Template"}
            </span>
          </div>
        </div>
      )}
      <pre className="min-h-0 overflow-auto p-5 text-sm leading-6 text-neutral-300">
        {preview.markdown}
      </pre>
    </Modal>
  );
}