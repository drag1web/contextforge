import { motion } from "framer-motion";
import type { ReactNode } from "react";

export interface SegmentedFilterOption<TValue extends string = string> {
  value: TValue;
  label: string;
  description?: string;
  icon?: ReactNode;
}

interface SegmentedFilterProps<TValue extends string = string> {
  value: TValue;
  options: SegmentedFilterOption<TValue>[];
  onChange: (value: TValue) => void;
  className?: string;
}

const SEGMENT_TRANSITION = {
  type: "spring",
  stiffness: 560,
  damping: 44,
  mass: 0.55
} as const;

export function SegmentedFilter<TValue extends string = string>({
  value,
  options,
  onChange,
  className = ""
}: SegmentedFilterProps<TValue>) {
  const activeIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value)
  );

  if (options.length === 0) {
    return null;
  }

  return (
    <div
      className={[
        "relative grid h-14 overflow-hidden rounded-2xl border border-white/10 bg-black/55 p-1",
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.055)]",
        className
      ].join(" ")}
      style={{
        gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`
      }}
    >
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.055),rgba(255,255,255,0.01)_44%,rgba(255,255,255,0.004))]" />

      <motion.div
        aria-hidden="true"
        className="absolute bottom-1 left-1 top-1 rounded-[0.95rem] bg-white shadow-[0_14px_34px_rgba(255,255,255,0.14)]"
        style={{
          width: `calc((100% - 8px) / ${options.length})`,
          willChange: "transform"
        }}
        initial={false}
        animate={{
          x: `${activeIndex * 100}%`
        }}
        transition={SEGMENT_TRANSITION}
      />

      {options.map((option) => {
        const isActive = option.value === value;

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={[
              "group relative z-10 min-w-0 rounded-[0.95rem] px-3 text-left transition-colors duration-150",
              isActive ? "text-black" : "text-neutral-500 hover:text-white"
            ].join(" ")}
          >
            <span className="relative z-10 flex min-w-0 items-center gap-2">
              {option.icon && (
                <span
                  className={[
                    "shrink-0 transition-colors",
                    isActive ? "text-black" : "text-neutral-600 group-hover:text-white"
                  ].join(" ")}
                >
                  {option.icon}
                </span>
              )}

              <span className="min-w-0">
                <span
                  className={[
                    "block truncate text-xs font-semibold transition-colors duration-150",
                    isActive ? "text-black" : "text-neutral-300 group-hover:text-white"
                  ].join(" ")}
                >
                  {option.label}
                </span>

                {option.description && (
                  <span
                    className={[
                      "mt-0.5 block truncate text-[10px] transition-colors duration-150",
                      isActive
                        ? "text-black/55"
                        : "text-neutral-700 group-hover:text-neutral-500"
                    ].join(" ")}
                  >
                    {option.description}
                  </span>
                )}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}