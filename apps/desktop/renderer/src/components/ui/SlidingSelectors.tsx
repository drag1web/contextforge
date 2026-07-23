import { motion } from "framer-motion";
import type { Key, ReactNode } from "react";

const SLIDING_SELECTOR_TRANSITION = {
  type: "spring",
  stiffness: 560,
  damping: 44,
  mass: 0.55
} as const;

type SlidingSelectorRenderItem<TItem> = (
  item: TItem,
  isActive: boolean,
  index: number
) => ReactNode;

interface SharedSlidingSelectorProps<TItem> {
  items: readonly TItem[];
  activeIndex: number;
  getItemKey: (item: TItem, index: number) => Key;
  onSelect: (item: TItem, index: number) => void;
  renderItem: SlidingSelectorRenderItem<TItem>;
  className?: string;
  itemClassName?: string;
  indicatorClassName?: string;
  ariaLabel?: string;
}

interface VerticalSlidingSelectorProps<TItem>
  extends SharedSlidingSelectorProps<TItem> {
  itemHeight: number;
  itemGap?: number;
  itemSurfaceClassName?: string;
}

export function VerticalSlidingSelector<TItem>({
  items,
  activeIndex,
  getItemKey,
  onSelect,
  renderItem,
  itemHeight,
  itemGap = 0,
  itemSurfaceClassName = "",
  className = "",
  itemClassName = "",
  indicatorClassName = "",
  ariaLabel
}: VerticalSlidingSelectorProps<TItem>) {
  if (items.length === 0) {
    return null;
  }

  const hasActiveItem = activeIndex >= 0 && activeIndex < items.length;
  const safeActiveIndex = hasActiveItem ? activeIndex : 0;
  const itemStep = itemHeight + itemGap;
  const selectorHeight = items.length * itemHeight + (items.length - 1) * itemGap;

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={["relative grid", className].join(" ")}
      style={{
        height: selectorHeight,
        rowGap: itemGap
      }}
    >
      {itemSurfaceClassName && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-0 grid"
          style={{ rowGap: itemGap }}
        >
          {items.map((item, index) => (
            <span
              key={getItemKey(item, index)}
              className={itemSurfaceClassName}
              style={{ height: itemHeight }}
            />
          ))}
        </div>
      )}

      <motion.span
        aria-hidden="true"
        className={[
          "pointer-events-none absolute left-0 right-0 top-0 z-10 rounded-2xl bg-white",
          indicatorClassName
        ].join(" ")}
        style={{
          height: itemHeight,
          willChange: "transform"
        }}
        initial={false}
        animate={{
          y: safeActiveIndex * itemStep,
          opacity: hasActiveItem ? 1 : 0
        }}
        transition={SLIDING_SELECTOR_TRANSITION}
      />

      {items.map((item, index) => {
        const isActive = hasActiveItem && index === safeActiveIndex;

        return (
          <button
            key={getItemKey(item, index)}
            type="button"
            onClick={() => onSelect(item, index)}
            aria-pressed={isActive}
            className={[
              "group relative z-20 w-full transition-colors duration-150",
              isActive ? "text-black" : "text-neutral-500 hover:text-white",
              itemClassName
            ].join(" ")}
            style={{ height: itemHeight }}
          >
            {renderItem(item, isActive, index)}
          </button>
        );
      })}
    </div>
  );
}

export function HorizontalSlidingSelector<TItem>({
  items,
  activeIndex,
  getItemKey,
  onSelect,
  renderItem,
  className = "",
  itemClassName = "",
  indicatorClassName = "",
  ariaLabel
}: SharedSlidingSelectorProps<TItem>) {
  if (items.length === 0) {
    return null;
  }

  const hasActiveItem = activeIndex >= 0 && activeIndex < items.length;
  const safeActiveIndex = hasActiveItem ? activeIndex : 0;

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={[
        "relative grid overflow-hidden rounded-2xl border border-white/10 bg-black/55 p-1",
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.055)]",
        className
      ].join(" ")}
      style={{
        gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`
      }}
    >
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.055),rgba(255,255,255,0.01)_44%,rgba(255,255,255,0.004))]" />

      <motion.span
        aria-hidden="true"
        className={[
          "pointer-events-none absolute bottom-1 left-1 top-1 z-0 rounded-[0.95rem] bg-white",
          "shadow-[0_14px_34px_rgba(255,255,255,0.14)]",
          indicatorClassName
        ].join(" ")}
        style={{
          width: `calc((100% - 8px) / ${items.length})`,
          willChange: "transform"
        }}
        initial={false}
        animate={{
          x: `${safeActiveIndex * 100}%`,
          opacity: hasActiveItem ? 1 : 0
        }}
        transition={SLIDING_SELECTOR_TRANSITION}
      />

      {items.map((item, index) => {
        const isActive = hasActiveItem && index === safeActiveIndex;

        return (
          <button
            key={getItemKey(item, index)}
            type="button"
            onClick={() => onSelect(item, index)}
            aria-pressed={isActive}
            className={[
              "group relative z-10 min-w-0 transition-colors duration-150",
              isActive ? "text-black" : "text-neutral-500 hover:text-white",
              itemClassName
            ].join(" ")}
          >
            {renderItem(item, isActive, index)}
          </button>
        );
      })}
    </div>
  );
}
