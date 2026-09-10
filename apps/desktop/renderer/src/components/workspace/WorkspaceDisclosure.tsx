import type { ReactNode } from "react";
import { useEffect, useId, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronDown } from "lucide-react";

interface WorkspaceDisclosureProps {
  title: string;
  children: ReactNode;
  summary?: ReactNode;
  badge?: ReactNode;
  icon?: ReactNode;
  defaultOpen?: boolean;
  revealWhen?: boolean;
  tone?: "neutral" | "attention" | "blocking";
  className?: string;
  contentClassName?: string;
}

const toneClasses = {
  neutral: "border-neutral-900 bg-black/30",
  attention: "border-amber-300/20 bg-amber-300/[0.04]",
  blocking: "border-red-400/25 bg-red-400/[0.06]",
} as const;

export function WorkspaceDisclosure({
  title,
  children,
  summary,
  badge,
  icon,
  defaultOpen = false,
  revealWhen = false,
  tone = "neutral",
  className = "",
  contentClassName = "",
}: WorkspaceDisclosureProps) {
  const contentId = useId();
  const prefersReducedMotion = useReducedMotion();
  const [isOpen, setIsOpen] = useState(defaultOpen || revealWhen);

  useEffect(() => {
    if (revealWhen) setIsOpen(true);
  }, [revealWhen]);

  return (
    <section
      className={`min-w-0 overflow-hidden rounded-2xl border ${toneClasses[tone]} ${className}`}
    >
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={contentId}
        onClick={() => setIsOpen((value) => !value)}
        className="flex w-full min-w-0 items-start gap-3 px-4 py-3 text-left outline-none transition hover:bg-white/[0.025] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white/40"
      >
        {icon ? (
          <span className="mt-0.5 shrink-0 text-neutral-500" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="min-w-0 text-xs font-semibold text-neutral-200">
              {title}
            </span>
            {badge ? <span className="shrink-0">{badge}</span> : null}
          </span>
          {summary ? (
            <span className="mt-1 block min-w-0 text-[10px] leading-4 text-neutral-500">
              {summary}
            </span>
          ) : null}
        </span>
        <ChevronDown
          size={14}
          className={`mt-0.5 shrink-0 text-neutral-600 transition-transform duration-150 motion-reduce:transition-none ${
            isOpen ? "rotate-180" : ""
          }`}
          aria-hidden="true"
        />
      </button>

      <AnimatePresence initial={false}>
        {isOpen ? (
          <motion.div
            id={contentId}
            initial={prefersReducedMotion ? false : { gridTemplateRows: "0fr", opacity: 0 }}
            animate={{ gridTemplateRows: "1fr", opacity: 1 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { gridTemplateRows: "0fr", opacity: 0 }}
            transition={{ duration: prefersReducedMotion ? 0 : 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="grid min-w-0"
          >
            <div className="min-h-0 min-w-0 overflow-hidden">
              <div className={`border-t border-white/[0.06] px-4 py-4 ${contentClassName}`}>
                {children}
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}
