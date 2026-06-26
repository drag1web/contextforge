import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";

export function HeroSection() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="mb-7"
    >
      <p className="cf-badge mb-4">
        <Sparkles size={13} />
        Local-first AI workflow manager
      </p>

      <h3 className="max-w-4xl text-[38px] font-semibold leading-[1.03] tracking-[-0.045em] text-white">
        Prepare your projects for Codex, Cursor, Claude Code and other AI agents.
      </h3>

      <p className="mt-4 max-w-2xl text-sm leading-6 text-neutral-400">
        ContextForge scans your project, builds AI-ready context, generates task packs,
        and helps prevent AI agents from breaking your architecture.
      </p>
    </motion.div>
  );
}