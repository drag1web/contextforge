import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";

interface WorkspaceZoomHudProps {
  visible: boolean;
  percent: number;
}

export function WorkspaceZoomHud({
  visible,
  percent,
}: WorkspaceZoomHudProps) {
  const { t } = useTranslation();
  const prefersReducedMotion = useReducedMotion();

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          key="workspace-zoom-hud"
          role="status"
          aria-live="polite"
          aria-label={t("workspaceZoom.level", { percent })}
          initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -5, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -3, scale: 0.985 }}
          transition={{ duration: prefersReducedMotion ? 0.06 : 0.14, ease: [0.16, 1, 0.3, 1] }}
          className="pointer-events-none fixed right-5 top-16 z-[160] rounded-xl border border-white/15 bg-neutral-950/96 px-3 py-2 font-mono text-[11px] font-semibold tabular-nums text-neutral-100 shadow-[0_14px_40px_rgba(0,0,0,0.58)]"
        >
          <span aria-hidden="true">[ {percent}% ]</span>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
