import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, LoaderCircle, X } from "lucide-react";
import { useTranslation } from "react-i18next";

interface StatusBarProps {
  message: string;
}

type StatusTone = "success" | "progress" | "attention";

function getStatusTone(message: string): StatusTone {
  const normalized = message.toLowerCase();

  if (
    /failed|error|unavailable|blocked|ошиб|не удалось|недоступ|заблок/.test(
      normalized,
    )
  ) {
    return "attention";
  }

  if (
    /scanning|rescanning|loading|generating|saving|analyzing|сканирование|пересканирование|загрузка|генерация|сохранение|анализ/.test(
      normalized,
    )
  ) {
    return "progress";
  }

  if (
    /success|successfully|saved|generated|ready|opened|added|completed|создан|сохранён|сохранен|готов|открыт|добавлен|завершён|завершен|успешно/.test(
      normalized,
    )
  ) {
    return "success";
  }

  return "progress";
}

export function StatusBar({ message }: StatusBarProps) {
  const { t } = useTranslation();
  const normalizedMessage = message.trim();
  const [dismissedMessage, setDismissedMessage] = useState("");
  const previousMessageRef = useRef("");
  const tone = useMemo(() => getStatusTone(normalizedMessage), [normalizedMessage]);
  const visible = Boolean(normalizedMessage) && dismissedMessage !== normalizedMessage;


  useEffect(() => {
    if (previousMessageRef.current === normalizedMessage) {
      return;
    }

    previousMessageRef.current = normalizedMessage;
    setDismissedMessage("");
  }, [normalizedMessage]);

  useEffect(() => {
    if (!normalizedMessage || tone === "progress") {
      return;
    }

    const timeout = window.setTimeout(
      () => setDismissedMessage(normalizedMessage),
      tone === "attention" ? 8000 : 4600,
    );

    return () => window.clearTimeout(timeout);
  }, [normalizedMessage, tone]);

  const title =
    tone === "success"
      ? t("common.toastSuccessTitle")
      : tone === "attention"
        ? t("common.toastAttentionTitle")
        : t("common.toastWorkingTitle");

  const Icon =
    tone === "success"
      ? CheckCircle2
      : tone === "attention"
        ? AlertTriangle
        : LoaderCircle;

  return (
    <AnimatePresence initial={false}>
      {visible ? (
        <motion.aside
          key={normalizedMessage}
          initial={{ opacity: 0, x: 22, scale: 0.98 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 16, scale: 0.98 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          role={tone === "attention" ? "alert" : "status"}
          aria-live={tone === "attention" ? "assertive" : "polite"}
          className="fixed right-6 top-14 z-[85] w-[min(420px,calc(100vw-3rem))] overflow-hidden rounded-2xl border border-white/15 bg-neutral-950/95 shadow-[0_24px_70px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.07)] backdrop-blur-xl"
        >
          <div className="flex items-start gap-3 px-4 py-3.5">
            <span
              className={[
                "mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl border",
                tone === "success"
                  ? "border-emerald-300/20 bg-emerald-300/[0.08] text-emerald-300"
                  : tone === "attention"
                    ? "border-amber-300/20 bg-amber-300/[0.08] text-amber-200"
                    : "border-white/10 bg-white/[0.05] text-white",
              ].join(" ")}
            >
              <Icon size={16} className={tone === "progress" ? "animate-spin" : ""} />
            </span>

            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white">{title}</p>
              <p className="mt-1 text-xs leading-5 text-neutral-400">
                {normalizedMessage}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setDismissedMessage(normalizedMessage)}
              aria-label={t("common.dismissNotification")}
              className="grid size-8 shrink-0 place-items-center rounded-xl text-neutral-600 transition-colors duration-150 hover:bg-white/[0.05] hover:text-white"
            >
              <X size={15} />
            </button>
          </div>

          {tone !== "progress" ? (
            <motion.div
              className={[
                "h-px origin-left",
                tone === "success" ? "bg-emerald-300/45" : "bg-amber-300/45",
              ].join(" ")}
              initial={{ scaleX: 1 }}
              animate={{ scaleX: 0 }}
              transition={{ duration: tone === "attention" ? 8 : 4.6, ease: "linear" }}
            />
          ) : null}
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}
