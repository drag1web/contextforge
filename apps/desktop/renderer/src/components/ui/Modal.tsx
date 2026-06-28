import { useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";

interface ModalProps {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: string;
  scrollable?: boolean;
  onClose: () => void;
}

const MODAL_EXIT_MS = 180;

export function Modal({
  title,
  eyebrow,
  children,
  footer,
  maxWidth = "max-w-5xl",
  scrollable = true,
  onClose
}: ModalProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setIsVisible(true);
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, []);

  function requestClose() {
    if (isClosing) {
      return;
    }

    setIsClosing(true);
    setIsVisible(false);

    window.setTimeout(() => {
      onClose();
    }, MODAL_EXIT_MS);
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isClosing]);

  return (
    <div
      className={[
        "fixed inset-0 z-[120] flex items-center justify-center p-8",
        "transition duration-200 ease-out",
        isVisible
          ? "bg-black/75 backdrop-blur-xl"
          : "bg-black/0 backdrop-blur-0"
      ].join(" ")}
    >
      <div
        className={[
          "relative flex max-h-[calc(100vh-72px)] w-full flex-col overflow-hidden rounded-[2rem]",
          "border border-white/10 bg-black/95",
          "shadow-[0_32px_120px_rgba(0,0,0,0.78),inset_0_1px_0_rgba(255,255,255,0.045)]",
          "before:pointer-events-none before:absolute before:inset-0 before:rounded-[2rem]",
          "before:bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.07),transparent_24rem),linear-gradient(180deg,rgba(255,255,255,0.035),transparent_42%)]",
          "transition duration-200 ease-out",
          isVisible
            ? "translate-y-0 scale-100 opacity-100"
            : "translate-y-3 scale-[0.985] opacity-0",
          maxWidth
        ].join(" ")}
      >
        <div className="relative z-10 flex shrink-0 items-center justify-between gap-5 border-b border-neutral-900 px-6 py-4">
          <div className="min-w-0">
            {eyebrow && (
              <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
                {eyebrow}
              </p>
            )}

            <h3 className="mt-1 truncate text-base font-semibold tracking-tight text-white">
              {title}
            </h3>
          </div>

          <button
            type="button"
            onClick={requestClose}
            className="cf-invert-action grid size-9 shrink-0 place-items-center rounded-xl"
            aria-label="Close modal"
          >
            <X size={16} />
          </button>
        </div>

        <div
          className={[
            "relative z-10 min-h-0 flex-1",
            scrollable ? "overflow-auto" : "overflow-hidden"
          ].join(" ")}
        >
          {children}
        </div>

        {footer && (
          <div className="relative z-10 flex shrink-0 items-center justify-end gap-3 border-t border-neutral-900 bg-black/45 px-6 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}