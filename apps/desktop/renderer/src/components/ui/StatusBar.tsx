import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  Info,
  LoaderCircle,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";

export type StatusTone = "success" | "progress" | "warning" | "error" | "info";

interface StatusBarProps {
  message: string;
  tone?: StatusTone;
  title?: string;
}

interface StatusToastEventDetail {
  message: string;
  tone?: StatusTone;
  title?: string;
}

const STATUS_TOAST_EVENT = "contextforge:status-toast";
const REPEAT_SUPPRESSION_MS = 2400;

export function showStatusToast(
  message: string,
  options: Omit<StatusToastEventDetail, "message"> = {},
) {
  if (typeof window === "undefined" || !message.trim()) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<StatusToastEventDetail>(STATUS_TOAST_EVENT, {
      detail: { message, ...options },
    }),
  );
}

function getStatusTone(message: string): StatusTone {
  const normalized = message.toLowerCase();

  if (
    /failed|failure|error|unavailable|rejected|не удалось|ошиб|недоступ|сбой|отклон/.test(
      normalized,
    )
  ) {
    return "error";
  }

  if (
    /blocked|attention|required|needs review|needs detail|select at least|warning|заблок|требуется|нужно проверить|нужны детали|выберите хотя бы|предупреж/.test(
      normalized,
    )
  ) {
    return "warning";
  }

  if (
    /scanning|rescanning|loading|generating|saving|analyzing|connecting|syncing|updating|processing|сканировани|пересканировани|загрузка|загружа|генерац|сохранени|анализ|подключени|синхронизац|обновлени|обработк/.test(
      normalized,
    )
  ) {
    return "progress";
  }

  if (
    /success|successfully|saved|generated|ready|opened|added|completed|updated|reopened|rescanned|connected|copied|created|loaded|успеш|сохранён|сохранен|готов|открыт|добавлен|завершён|завершен|обновлён|обновлен|пересоздан|пересканирован|подключен|скопирован|создан|загружен/.test(
      normalized,
    )
  ) {
    return "success";
  }

  return "info";
}

function getDismissDelay(tone: StatusTone) {
  if (tone === "success") return 4200;
  if (tone === "info") return 4800;
  if (tone === "warning") return 7200;
  if (tone === "error") return 9000;
  return null;
}

export function StatusBar({ message, tone: toneOverride, title: titleOverride }: StatusBarProps) {
  const { t } = useTranslation();
  const shouldReduceMotion = useReducedMotion();
  const normalizedPropMessage = message.trim();
  const [externalToast, setExternalToast] = useState<StatusToastEventDetail | null>(null);
  const [dismissedKey, setDismissedKey] = useState("");
  const recentDismissalsRef = useRef(new Map<string, number>());

  useEffect(() => {
    const handleToast = (event: Event) => {
      const detail = (event as CustomEvent<StatusToastEventDetail>).detail;
      const normalizedMessage = detail?.message?.trim();

      if (!normalizedMessage) {
        return;
      }

      const lastDismissedAt = recentDismissalsRef.current.get(normalizedMessage) ?? 0;
      if (Date.now() - lastDismissedAt < REPEAT_SUPPRESSION_MS) {
        return;
      }

      setExternalToast({ ...detail, message: normalizedMessage });
    };

    window.addEventListener(STATUS_TOAST_EVENT, handleToast);
    return () => window.removeEventListener(STATUS_TOAST_EVENT, handleToast);
  }, []);

  const activeToast = externalToast ?? {
    message: normalizedPropMessage,
    tone: toneOverride,
    title: titleOverride,
  };
  const normalizedMessage = activeToast.message.trim();
  const tone = useMemo(
    () => activeToast.tone ?? getStatusTone(normalizedMessage),
    [activeToast.tone, normalizedMessage],
  );
  const toastKey = `${tone}:${normalizedMessage}`;
  const visible = Boolean(normalizedMessage) && dismissedKey !== toastKey;
  const dismissDelay = getDismissDelay(tone);

  useEffect(() => {
    if (!visible) {
      return;
    }

    if (dismissDelay === null) {
      return;
    }

    const timeout = window.setTimeout(() => {
      recentDismissalsRef.current.set(normalizedMessage, Date.now());
      if (externalToast) {
        setExternalToast(null);
      } else {
        setDismissedKey(toastKey);
      }
    }, dismissDelay);

    return () => window.clearTimeout(timeout);
  }, [dismissDelay, externalToast, normalizedMessage, toastKey, visible]);

  const title =
    activeToast.title ||
    (tone === "success"
      ? t("common.toastSuccessTitle")
      : tone === "progress"
        ? t("common.toastWorkingTitle")
        : tone === "warning"
          ? t("common.toastWarningTitle")
          : tone === "error"
            ? t("common.toastErrorTitle")
            : t("common.toastInfoTitle"));

  const Icon =
    tone === "success"
      ? CheckCircle2
      : tone === "progress"
        ? LoaderCircle
        : tone === "warning"
          ? AlertTriangle
          : tone === "error"
            ? CircleAlert
            : Info;

  const iconToneClass = {
    success: "text-emerald-300",
    progress: "text-neutral-100",
    warning: "text-amber-300",
    error: "text-red-300",
    info: "text-neutral-300",
  }[tone];

  const dismiss = () => {
    recentDismissalsRef.current.set(normalizedMessage, Date.now());
    if (externalToast) {
      setExternalToast(null);
    } else {
      setDismissedKey(toastKey);
    }
  };

  return (
    <AnimatePresence initial={false} mode="wait">
      {visible ? (
        <motion.aside
          key={toastKey}
          initial={
            shouldReduceMotion
              ? { opacity: 0 }
              : { opacity: 0, y: -14, scale: 0.97, filter: "blur(8px)" }
          }
          animate={
            shouldReduceMotion
              ? { opacity: 1 }
              : { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }
          }
          exit={
            shouldReduceMotion
              ? { opacity: 0 }
              : { opacity: 0, y: -8, scale: 0.985, filter: "blur(4px)" }
          }
          transition={
            shouldReduceMotion
              ? { duration: 0.14, ease: "easeOut" }
              : {
                  type: "spring",
                  stiffness: 520,
                  damping: 38,
                  mass: 0.7,
                  opacity: { duration: 0.16, ease: "easeOut" },
                  filter: { duration: 0.18, ease: "easeOut" },
                }
          }
          style={{ transformOrigin: "top center" }}
          role={tone === "error" || tone === "warning" ? "alert" : "status"}
          aria-live={tone === "error" ? "assertive" : "polite"}
          aria-atomic="true"
          className="fixed left-1/2 top-11 z-[140] w-[min(420px,calc(100vw-1.5rem))] -translate-x-1/2 overflow-hidden rounded-2xl border border-white/[0.10] bg-neutral-950/95 shadow-[0_18px_60px_rgba(0,0,0,0.58),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl"
        >
          <div className="flex items-start gap-2.5 px-3.5 py-2.5">
            <motion.span
              initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.72, rotate: -8 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              transition={
                shouldReduceMotion
                  ? { duration: 0 }
                  : { type: "spring", stiffness: 600, damping: 34, delay: 0.035 }
              }
              className={[
                "grid size-8 shrink-0 place-items-center rounded-[0.7rem] border border-white/[0.09] bg-white/[0.045]",
                iconToneClass,
              ].join(" ")}
            >
              <Icon
                size={15}
                strokeWidth={2.1}
                className={tone === "progress" && !shouldReduceMotion ? "animate-spin" : ""}
              />
            </motion.span>

            <motion.div
              initial={shouldReduceMotion ? false : { opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={
                shouldReduceMotion
                  ? { duration: 0 }
                  : { duration: 0.18, ease: "easeOut", delay: 0.045 }
              }
              className="min-w-0 flex-1 pt-px"
            >
              <p className="text-[13px] font-semibold leading-4 tracking-[-0.01em] text-white">
                {title}
              </p>
              <p className="mt-0.5 text-xs leading-4 text-neutral-400">
                {normalizedMessage}
              </p>
            </motion.div>

            <motion.button
              type="button"
              onClick={dismiss}
              aria-label={t("common.dismissNotification")}
              initial={shouldReduceMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: shouldReduceMotion ? 0 : 0.14, delay: 0.07 }}
              whileTap={shouldReduceMotion ? undefined : { scale: 0.92 }}
              className="grid size-7 shrink-0 place-items-center rounded-lg text-neutral-600 transition-colors duration-150 hover:bg-white/[0.055] hover:text-neutral-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
            >
              <X size={14} />
            </motion.button>
          </div>

          {shouldReduceMotion ? (
            <div className="h-px bg-white/[0.10]" />
          ) : tone === "progress" ? (
            <div className="relative h-px overflow-hidden bg-white/[0.055]">
              <motion.div
                className="absolute inset-y-0 w-[28%] bg-white/55"
                animate={{ x: ["-140%", "460%"] }}
                transition={{ duration: 1.3, ease: [0.4, 0, 0.2, 1], repeat: Infinity }}
              />
            </div>
          ) : (
            <motion.div
              className="h-px origin-left bg-white/35"
              initial={{ scaleX: 1 }}
              animate={{ scaleX: 0 }}
              transition={{
                duration: (dismissDelay ?? 4000) / 1000,
                ease: "linear",
              }}
            />
          )}
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}
