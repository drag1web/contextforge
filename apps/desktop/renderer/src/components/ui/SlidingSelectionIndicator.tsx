import { motion, type Transition } from "framer-motion";

type SlidingSelectionIndicatorProps = {
  activeIndex: number;
  itemHeight: number;
  itemGap?: number;
  className: string;
  glowClassName?: string;
  transition?: Transition;
};

const DEFAULT_TRANSITION: Transition = {
  type: "spring",
  stiffness: 500,
  damping: 42,
  mass: 0.55
};

export function SlidingSelectionIndicator({
  activeIndex,
  itemHeight,
  itemGap = 4,
  className,
  glowClassName,
  transition = DEFAULT_TRANSITION
}: SlidingSelectionIndicatorProps) {
  if (activeIndex < 0) {
    return null;
  }

  const y = activeIndex * (itemHeight + itemGap);
  const sharedStyle = {
    height: itemHeight,
    willChange: "transform"
  } as const;

  return (
    <>
      {glowClassName && (
        <motion.span
          aria-hidden="true"
          className={glowClassName}
          style={sharedStyle}
          initial={false}
          animate={{ y }}
          transition={transition}
        />
      )}

      <motion.span
        aria-hidden="true"
        className={className}
        style={sharedStyle}
        initial={false}
        animate={{ y }}
        transition={transition}
      />
    </>
  );
}
