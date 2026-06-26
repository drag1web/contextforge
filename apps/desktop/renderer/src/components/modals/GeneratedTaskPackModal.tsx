import type { TaskPack } from "../../types";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";

interface GeneratedTaskPackModalProps {
  taskPack: TaskPack;
  onClose: () => void;
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
      <pre className="min-h-0 overflow-auto p-5 text-sm leading-6 text-neutral-300">
        {taskPack.generatedPrompt}
      </pre>
    </Modal>
  );
}