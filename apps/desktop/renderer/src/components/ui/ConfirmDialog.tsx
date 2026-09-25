import { RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "./Button";
import { Modal } from "./Modal";

interface ConfirmDialogProps {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  intent?: "warning" | "danger";
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/** Presentation only. Modal owns focus/Escape/motion; the caller owns the operation. */
export function ConfirmDialog({
  title, description, confirmLabel, cancelLabel, intent = "warning",
  confirmDisabled = false, onConfirm, onClose,
}: ConfirmDialogProps) {
  const danger = intent === "danger";
  const Icon = danger ? Trash2 : RotateCcw;
  const actionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Modal first captures the opener; then start keyboard navigation on the safe action.
    actionsRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, []);

  return (
    <Modal
      title={title}
      maxWidth="max-w-lg"
      onClose={onClose}
      footer={
        <div ref={actionsRef} className="flex flex-wrap items-center justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={danger ? "secondary" : "primary"}
            disabled={confirmDisabled}
            onClick={onConfirm}
            className={danger
              // Override the shared secondary button's white hover without changing other callers.
              ? "!rounded-xl !border-red-300/20 !bg-red-500/10 !text-red-100 hover:!border-red-200/40 hover:!bg-red-500/15 hover:!text-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300/40 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950"
              : ""}
          >
            <Icon size={15} aria-hidden="true" />
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <div className="flex items-start gap-4 px-6 py-6">
        <span aria-hidden="true" className={[
          "grid size-10 shrink-0 place-items-center rounded-2xl border",
          danger ? "border-red-400/15 bg-red-500/[0.06] text-red-200"
            : "border-amber-400/15 bg-amber-500/[0.06] text-amber-200",
        ].join(" ")}>
          <Icon size={18} />
        </span>
        <p className="min-w-0 pt-0.5 text-sm leading-6 text-neutral-300">{description}</p>
      </div>
    </Modal>
  );
}
