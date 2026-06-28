import { motion } from "framer-motion";
import {
  Bot,
  FileCode2,
  Layers3,
  ShieldCheck,
  Sparkles,
  WandSparkles
} from "lucide-react";

const heroBadges = [
  "Local-first",
  "Ollama-assisted",
  "Validated files",
  "Agent-ready prompts"
];

export function HeroSection() {
  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="mb-7 overflow-hidden rounded-[2rem] border border-neutral-900 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.08),transparent_30rem),linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.012))] p-7 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
    >
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0">
          <div className="mb-5 flex flex-wrap gap-2">
            {heroBadges.map((badge) => (
              <span key={badge} className="cf-badge">
                <Sparkles size={12} />
                {badge}
              </span>
            ))}
          </div>

          <h3 className="max-w-5xl text-[42px] font-semibold leading-[1.02] tracking-[-0.055em] text-white">
            Prepare AI-ready project context before your coding agent touches the code.
          </h3>

          <p className="mt-5 max-w-3xl text-sm leading-7 text-neutral-400">
            ContextForge scans local projects, understands the task, validates real files,
            and generates structured Task Packs for Codex, Cursor, Claude Code, and other
            AI coding agents.
          </p>

          <div className="mt-7 grid max-w-3xl gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
              <ShieldCheck size={17} className="mb-3 text-neutral-300" />
              <p className="text-sm font-medium text-white">Safe context</p>
              <p className="mt-1 text-xs leading-5 text-neutral-500">
                Fake paths and weak files are filtered before the prompt is created.
              </p>
            </div>

            <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
              <Layers3 size={17} className="mb-3 text-neutral-300" />
              <p className="text-sm font-medium text-white">Task-aware</p>
              <p className="mt-1 text-xs leading-5 text-neutral-500">
                UI, backend, docs, build, assets, and fullstack tasks get different context.
              </p>
            </div>

            <div className="rounded-2xl border border-neutral-900 bg-black/35 p-4">
              <Bot size={17} className="mb-3 text-neutral-300" />
              <p className="text-sm font-medium text-white">Agent-ready</p>
              <p className="mt-1 text-xs leading-5 text-neutral-500">
                Copy the final Task Pack into Claude, Cursor, Codex, or another agent.
              </p>
            </div>
          </div>
        </div>

        <div className="hidden min-h-full xl:block">
          <div className="relative h-full overflow-hidden rounded-[1.6rem] border border-neutral-900 bg-black/55 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
                  <WandSparkles size={16} className="text-white" />
                </div>

                <div>
                  <p className="text-sm font-medium text-white">Task Pack Pipeline</p>
                  <p className="text-xs text-neutral-600">live context flow</p>
                </div>
              </div>

              <span className="rounded-full border border-white/15 bg-white/[0.04] px-3 py-1 text-[11px] text-white shadow-[0_0_20px_rgba(255,255,255,0.08)]">
                Ready
              </span>
            </div>

            <div className="space-y-3">
              {[
                ["01", "Scan project inventory", "Detect stack, scripts, files, and readiness signals."],
                ["02", "Analyze task intent", "Infer UI/backend/fullstack/docs/build/assets area."],
                ["03", "Select relevant files", "Validate real paths and reject hallucinated candidates."],
                ["04", "Generate Task Pack", "Create a safe Markdown prompt for external coding agents."]
              ].map(([index, title, description]) => (
                <div
                  key={index}
                  className="rounded-2xl border border-neutral-900 bg-neutral-950/70 p-4"
                >
                  <div className="mb-2 flex items-center gap-3">
                    <span className="cf-tech-label text-xs text-neutral-600">
                      {index}
                    </span>
                    <FileCode2 size={14} className="text-neutral-500" />
                    <p className="text-sm font-medium text-neutral-200">{title}</p>
                  </div>

                  <p className="pl-12 text-xs leading-5 text-neutral-500">
                    {description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </motion.section>
  );
}