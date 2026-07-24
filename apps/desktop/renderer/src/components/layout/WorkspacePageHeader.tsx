import { motion } from "framer-motion";
import type { ReactNode } from "react";

const HEADER_TRANSITION = {
  duration: 0.24,
  ease: [0.16, 1, 0.3, 1],
} as const;

interface WorkspacePageHeaderProps {
  icon: ReactNode;
  eyebrow: string;
  title: string;
  description: string;
  aside?: ReactNode;
  className?: string;
  headingLevel?: 1 | 2;
}

export function WorkspacePageHeader({
  icon,
  eyebrow,
  title,
  description,
  aside,
  className = "",
  headingLevel = 2,
}: WorkspacePageHeaderProps) {
  const Heading = headingLevel === 1 ? "h1" : "h2";

  return (
    <motion.header
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={HEADER_TRANSITION}
      className={[
        "rounded-[1.75rem] border border-neutral-900 bg-black/25 p-5",
        className,
      ].join(" ")}
    >
      <div className="flex flex-wrap items-center justify-between gap-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-2xl border border-neutral-800 bg-neutral-950 text-neutral-300">
            {icon}
          </span>

          <div className="min-w-0">
            <p className="cf-tech-label text-[10px] uppercase text-neutral-600">
              {eyebrow}
            </p>
            <Heading className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-white">
              {title}
            </Heading>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-neutral-500">
              {description}
            </p>
          </div>
        </div>

        {aside ? (
          <div className="w-full min-w-0 xl:w-auto xl:shrink-0">{aside}</div>
        ) : null}
      </div>
    </motion.header>
  );
}
