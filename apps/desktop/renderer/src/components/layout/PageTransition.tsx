import type { ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

type PageTransitionProps = {
  pageKey: string;
  direction?: number;
  children: ReactNode;
};

const pageVariants = {
  initial: (direction: number) => ({
    opacity: 0,
    x: direction > 0 ? 10 : -10,
    y: 4,
    scale: 0.996,
    filter: "blur(2px)"
  }),
  animate: {
    opacity: 1,
    x: 0,
    y: 0,
    scale: 1,
    filter: "blur(0px)"
  },
  exit: (direction: number) => ({
    opacity: 0,
    x: direction > 0 ? -8 : 8,
    y: -2,
    scale: 0.998,
    filter: "blur(1px)"
  })
};

export function PageTransition({
  pageKey,
  direction = 1,
  children
}: PageTransitionProps) {
  const reducedMotion = useReducedMotion();

  if (reducedMotion) {
    return <div key={pageKey} className="min-h-full">{children}</div>;
  }

  return (
    <AnimatePresence mode="popLayout" initial={false} custom={direction}>
      <motion.div
        layout={false}
        key={pageKey}
        custom={direction}
        variants={pageVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={{
          opacity: { duration: 0.16, ease: "easeOut" },
          x: { duration: 0.2, ease: [0.16, 1, 0.3, 1] },
          y: { duration: 0.2, ease: [0.16, 1, 0.3, 1] },
          scale: { duration: 0.2, ease: [0.16, 1, 0.3, 1] },
          filter: { duration: 0.16, ease: "easeOut" }
        }}
        style={{
          transformOrigin: "50% 18%"
        }}
        className="min-h-full transform-gpu will-change-[opacity,transform,filter]"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
