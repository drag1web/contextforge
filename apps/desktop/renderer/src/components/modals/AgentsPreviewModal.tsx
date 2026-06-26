import type { AgentsPreview } from "../../types";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";

interface AgentsPreviewModalProps {
  preview: AgentsPreview;
  isLoading: boolean;
  onClose: () => void;
  onSave: () => void;
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
      <pre className="min-h-0 overflow-auto p-5 text-sm leading-6 text-neutral-300">
        {preview.markdown}
      </pre>
    </Modal>
  );
}