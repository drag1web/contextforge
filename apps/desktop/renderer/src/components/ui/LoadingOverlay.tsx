import { AnimatePresence, motion } from "framer-motion";
import { Bot, Loader2 } from "lucide-react";

interface LoadingOverlayProps {
  isVisible: boolean;
  message: string;
}

export function LoadingOverlay({ isVisible, message }: LoadingOverlayProps) {
  const isOllamaGeneration = message.toLowerCase().includes("ollama");

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          className="fixed inset-0 z-[9997] flex items-center justify-center bg-black/45 px-6 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
        >
          <motion.div
            className="cf-floating-popover w-full max-w-md rounded-2xl p-5"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="flex items-start gap-4">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-200">
                {isOllamaGeneration ? (
                  <Bot size={20} />
                ) : (
                  <Loader2 size={20} className="animate-spin" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white">
                  {isOllamaGeneration ? "Ollama is generating" : "Working"}
                </p>

                <p className="mt-2 text-sm leading-6 text-neutral-400">
                  {message}
                </p>

                {isOllamaGeneration && (
                  <div className="mt-4 rounded-xl border border-neutral-900 bg-black/50 px-3 py-2 text-xs leading-5 text-neutral-500">
                    Local models may take 30–120 seconds on CPU. Cached results will
                    open instantly next time.
                  </div>
                )}
              </div>

              <Loader2 size={18} className="mt-1 shrink-0 animate-spin text-neutral-500" />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}