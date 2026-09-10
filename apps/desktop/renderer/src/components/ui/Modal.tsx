import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";

interface ModalProps {
  title: string;
  eyebrow?: string;
  closeLabel?: string;
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
  closeLabel,
  children,
  footer,
  maxWidth = "max-w-5xl",
  scrollable = true,
  onClose
}: ModalProps) {
  const { t } = useTranslation();
  const prefersReducedMotion = useReducedMotion();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const closeTimeoutRef = useRef<number | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const frame = window.requestAnimationFrame(() => {
      setIsVisible(true);
      if (!dialogRef.current?.contains(document.activeElement)) {
        dialogRef.current?.focus();
      }
    });

    return () => {
      window.cancelAnimationFrame(frame);
      if (closeTimeoutRef.current !== null) {
        window.clearTimeout(closeTimeoutRef.current);
      }
      const previousFocus = previousFocusRef.current;
      if (previousFocus?.isConnected) {
        previousFocus.focus();
      }
    };
  }, []);

  const requestClose = useCallback(() => {
    if (isClosing) {
      return;
    }

    setIsClosing(true);
    setIsVisible(false);

    closeTimeoutRef.current = window.setTimeout(() => {
      closeTimeoutRef.current = null;
      onClose();
    }, prefersReducedMotion ? 0 : MODAL_EXIT_MS);
  }, [isClosing, onClose, prefersReducedMotion]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) {
        return;
      }

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.getClientRects().length > 0);

      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [requestClose]);

  const modal = (
    <div
      className={[
        "fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-6 lg:p-8",
        "transition duration-200 ease-out motion-reduce:transition-none",
        isVisible
          ? "bg-black/78"
          : "bg-black/0"
      ].join(" ")}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={[
          "relative flex max-h-[calc(100vh-24px)] w-full flex-col overflow-hidden rounded-[2rem] sm:max-h-[calc(100vh-48px)] lg:max-h-[calc(100vh-72px)]",
          "border border-white/10 bg-neutral-950",
          "shadow-[0_24px_72px_rgba(0,0,0,0.72)]",
          "transition duration-200 ease-out motion-reduce:transition-none",
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
            aria-label={closeLabel ?? t("common.closeDialog")}
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

  return createPortal(modal, document.body);
}
