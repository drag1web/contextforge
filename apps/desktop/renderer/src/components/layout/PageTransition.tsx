import type { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";

type PageTransitionProps = {
  pageKey: string;
  direction?: number;
  children: ReactNode;
};

const pageTransition = {
  opacity: { duration: 0.14, ease: "easeOut" },
  x: { duration: 0.16, ease: [0.16, 1, 0.3, 1] },
  y: { duration: 0.16, ease: [0.16, 1, 0.3, 1] }
} as const;

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
    <motion.div
      key={pageKey}
      initial={{ opacity: 0, x: direction > 0 ? 4 : -4, y: 2 }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      transition={pageTransition}
      className="min-h-full transform-gpu"
    >
      {children}
    </motion.div>
  );
}
