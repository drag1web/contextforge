import type { ReactNode } from "react";

interface ModalProps {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: string;
  onClose: () => void;
}

export function Modal({
  title,
  eyebrow,
  children,
  footer,
  maxWidth = "max-w-5xl",
  onClose
}: ModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-8 backdrop-blur-sm">
      <div
        className={[
          "flex max-h-[82vh] w-full flex-col overflow-hidden rounded-2xl",
          "border border-neutral-800 bg-black shadow-2xl",
          maxWidth
        ].join(" ")}
      >
        <div className="flex items-center justify-between border-b border-neutral-900 px-5 py-4">
          <div>
            {eyebrow && (
              <p className="text-[11px] uppercase tracking-[0.18em] text-neutral-600">
                {eyebrow}
              </p>
            )}
            <h3 className="mt-1 text-sm font-medium text-white">{title}</h3>
          </div>

          <button
            onClick={onClose}
            className="rounded-lg border border-neutral-900 bg-neutral-950 px-3 py-2 text-sm text-neutral-400 transition hover:text-white"
          >
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">{children}</div>

        {footer && (
          <div className="flex items-center justify-end gap-3 border-t border-neutral-900 px-5 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}