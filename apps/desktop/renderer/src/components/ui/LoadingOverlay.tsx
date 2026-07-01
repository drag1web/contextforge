import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bot, CheckCircle2, FileSearch, Loader2, ShieldCheck, Sparkles } from "lucide-react";

interface LoadingOverlayProps {
  isVisible: boolean;
  message: string;
}

const GENERATION_STAGES = [
  {
    label: "Analyze task",
    detail: "Reading intent, constraints, and target agent.",
    icon: Sparkles
  },
  {
    label: "Select context",
    detail: "Ranking real files and filtering unsafe candidates.",
    icon: FileSearch
  },
  {
    label: "Validate contract",
    detail: "Applying rules, checks, and review safeguards.",
    icon: ShieldCheck
  },
  {
    label: "Compose prompt",
    detail: "Building the final Task Pack body.",
    icon: Bot
  }
] as const;

function isGenerationMessage(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("task pack")
    || normalized.includes("generat")
    || normalized.includes("ollama")
    || normalized.includes("selected file")
    || normalized.includes("context");
}

function getStageIndex(progress: number) {
  if (progress < 30) return 0;
  if (progress < 56) return 1;
  if (progress < 80) return 2;
  return 3;
}

export function LoadingOverlay({ isVisible, message }: LoadingOverlayProps) {
  const [progress, setProgress] = useState(10);
  const isOllamaGeneration = message.toLowerCase().includes("ollama");
  const isPromptGeneration = isGenerationMessage(message);
  const activeStageIndex = getStageIndex(progress);

  useEffect(() => {
    if (!isVisible) {
      setProgress(10);
      return;
    }

    setProgress(12);
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const slowCap = isOllamaGeneration ? 92 : 88;
      const next = Math.min(slowCap, 12 + Math.log10(1 + elapsed / 180) * 34 + elapsed / 2400);
      setProgress(next);
    }, 220);

    return () => window.clearInterval(timer);
  }, [isOllamaGeneration, isVisible]);

  const activeStage = useMemo(
    () => GENERATION_STAGES[activeStageIndex] ?? GENERATION_STAGES[0],
    [activeStageIndex]
  );

  const ActiveIcon = activeStage.icon;
  const safeProgress = Math.max(8, Math.min(96, progress));

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          className="fixed inset-0 z-[9997] flex items-center justify-center bg-black/55 px-6 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <motion.div
            className="relative w-full max-w-xl overflow-hidden rounded-[1.75rem] border border-white/10 bg-neutral-950/92 p-6 shadow-[0_34px_120px_rgba(0,0,0,0.72),inset_0_1px_0_rgba(255,255,255,0.08)]"
            initial={{ opacity: 0, y: 18, scale: 0.975 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.12),transparent_22rem)]" />
            <motion.div
              className="pointer-events-none absolute -left-24 top-0 h-28 w-52 rotate-12 bg-white/[0.035] blur-2xl"
              animate={{ x: ["0%", "240%"], opacity: [0.1, 0.35, 0.1] }}
              transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
            />

            <div className="relative">
              <div className="flex items-start gap-4">
                <div className="relative grid size-14 shrink-0 place-items-center rounded-2xl border border-white/10 bg-black/55 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                  <motion.span
                    className="absolute inset-0 rounded-2xl border border-white/20"
                    animate={{ scale: [0.94, 1.12], opacity: [0.6, 0] }}
                    transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
                  />
                  <ActiveIcon size={22} />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-white">
                        {isPromptGeneration ? "Generating Task Pack" : isOllamaGeneration ? "Ollama is generating" : "Working"}
                      </p>
                      <p className="mt-1 text-xs text-neutral-500">
                        {activeStage.label} · {Math.round(safeProgress)}%
                      </p>
                    </div>

                    <Loader2 size={18} className="shrink-0 animate-spin text-neutral-500" />
                  </div>

                  <p className="mt-4 text-sm leading-6 text-neutral-300">
                    {message}
                  </p>
                </div>
              </div>

              <div className="mt-6 overflow-hidden rounded-full border border-white/10 bg-black/70 p-1">
                <motion.div
                  className="h-2 rounded-full bg-gradient-to-r from-neutral-500 via-white to-neutral-400 shadow-[0_0_24px_rgba(255,255,255,0.22)]"
                  initial={{ width: "8%" }}
                  animate={{ width: `${safeProgress}%` }}
                  transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                />
              </div>

              <div className="mt-5 grid gap-2 sm:grid-cols-4">
                {GENERATION_STAGES.map((stage, index) => {
                  const StageIcon = stage.icon;
                  const isDone = index < activeStageIndex;
                  const isActive = index === activeStageIndex;

                  return (
                    <div
                      key={stage.label}
                      className={[
                        "rounded-2xl border p-3 transition",
                        isActive
                          ? "border-white/20 bg-white/[0.07] text-white shadow-[0_0_24px_rgba(255,255,255,0.06)]"
                          : isDone
                            ? "border-white/10 bg-white/[0.035] text-neutral-300"
                            : "border-white/5 bg-black/35 text-neutral-600"
                      ].join(" ")}
                    >
                      <div className="mb-2 flex items-center gap-2">
                        {isDone ? <CheckCircle2 size={14} /> : <StageIcon size={14} />}
                        <span className="text-[11px] font-medium">{stage.label}</span>
                      </div>
                      <p className="text-[10px] leading-4 text-neutral-500">{stage.detail}</p>
                    </div>
                  );
                })}
              </div>

              {isOllamaGeneration && (
                <div className="mt-5 rounded-2xl border border-white/10 bg-black/45 px-4 py-3 text-xs leading-5 text-neutral-500">
                  Local models can take 30-120 seconds on CPU. ContextForge keeps the UI responsive while the prompt is being prepared.
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
