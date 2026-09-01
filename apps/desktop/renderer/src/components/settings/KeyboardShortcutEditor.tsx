import {
  AnimatePresence,
  motion,
} from "framer-motion";
import {
  AlertTriangle,
  Check,
  Keyboard,
  RotateCcw,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ShortcutActionId } from "../../config/keyboardShortcuts";
import {
  getEffectiveKeyboardShortcuts,
  isKeyboardShortcutOverridden,
  keyboardEventToBinding,
  keyboardEventToDisplayParts,
  resetAllKeyboardShortcutBindings,
  resetKeyboardShortcutBinding,
  setKeyboardShortcutBinding,
  setKeyboardShortcutCaptureActive,
  splitKeyboardShortcutDisplay,
  subscribeKeyboardShortcutChanges,
} from "../../lib/keyboardShortcutPreferences";

function KeyCaps({
  keys,
  active = false,
}: {
  keys: string[];
  active?: boolean;
}) {
  if (keys.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {keys.map((key, index) => (
        <div
          key={`${key}-${index}`}
          className="flex items-center gap-1.5"
        >
          {index > 0 && (
            <span className="text-[10px] text-neutral-700">+</span>
          )}

          <motion.kbd
            layout
            initial={active ? { opacity: 0, y: 4, scale: 0.9 } : false}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{
              duration: 0.14,
              ease: [0.22, 1, 0.36, 1],
            }}
            className={[
              "grid min-h-7 min-w-7 place-items-center rounded-lg border px-2",
              "font-mono text-[10px] font-semibold tracking-tight",
              active
                ? "border-white/25 bg-white text-black shadow-[0_0_20px_rgba(255,255,255,0.08)]"
                : "border-neutral-800 bg-neutral-950 text-neutral-300 shadow-[inset_0_-1px_0_rgba(255,255,255,0.03)]",
            ].join(" ")}
          >
            {key}
          </motion.kbd>
        </div>
      ))}
    </div>
  );
}

export function KeyboardShortcutEditor() {
  const { t, i18n } = useTranslation();
  const isRussian = i18n.language.toLowerCase().startsWith("ru");

  const [revision, setRevision] = useState(0);
  const [recordingId, setRecordingId] =
    useState<ShortcutActionId | null>(null);
  const [previewKeys, setPreviewKeys] = useState<string[]>([]);
  const [savedId, setSavedId] =
    useState<ShortcutActionId | null>(null);
  const [error, setError] = useState<string | null>(null);

  const copy = useMemo(
    () =>
      isRussian
        ? {
            record: "Изменить",
            recording: "Запись сочетания",
            pressKeys: "Нажмите новую комбинацию клавиш",
            waiting: "Ожидание ввода…",
            escape: "Esc — отменить",
            reset: "Сбросить",
            resetAll: "Сбросить все",
            changed: "Изменено",
            default: "По умолчанию",
            saved: "Сохранено",
            unavailable: "Скоро",
            conflict: "Это сочетание уже используется:",
            invalid:
              "Используйте Ctrl, Alt или Shift вместе с клавишей. F1–F12 можно назначать без модификатора.",
            local:
              "Пользовательские сочетания сохраняются только на этом устройстве.",
          }
        : {
            record: "Change",
            recording: "Recording shortcut",
            pressKeys: "Press a new key combination",
            waiting: "Waiting for input…",
            escape: "Esc to cancel",
            reset: "Reset",
            resetAll: "Reset all",
            changed: "Changed",
            default: "Default",
            saved: "Saved",
            unavailable: "Soon",
            conflict: "This shortcut is already used by:",
            invalid:
              "Use Ctrl, Alt or Shift with a key. F1–F12 can be assigned without a modifier.",
            local:
              "Custom shortcuts are stored only on this device.",
          },
    [isRussian],
  );

  const shortcuts = useMemo(
    () => getEffectiveKeyboardShortcuts(),
    [revision],
  );

  useEffect(
    () =>
      subscribeKeyboardShortcutChanges(() => {
        setRevision((current) => current + 1);
      }),
    [],
  );

  useEffect(() => {
    setKeyboardShortcutCaptureActive(recordingId !== null);

    if (!recordingId) {
      setPreviewKeys([]);
      return () => {
        setKeyboardShortcutCaptureActive(false);
      };
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        setRecordingId(null);
        setPreviewKeys([]);
        setError(null);
        return;
      }

      setPreviewKeys(keyboardEventToDisplayParts(event));

      const binding = keyboardEventToBinding(event);

      if (!binding) {
        const modifierOnly = [
          "Control",
          "Shift",
          "Alt",
          "Meta",
        ].includes(event.key);

        if (!modifierOnly) {
          setError(copy.invalid);
        }
        return;
      }

      const result = setKeyboardShortcutBinding(
        recordingId,
        binding,
      );

      if ("conflictId" in result) {
        const conflictId = result.conflictId;
        const conflict = shortcuts.find(
          (shortcut) => shortcut.id === conflictId,
        );

        setError(
          `${copy.conflict} ${
            conflict
              ? t(`settings.shortcut.${conflict.id}.label`)
              : conflictId
          }`,
        );
        return;
      }

      const committedId = recordingId;
      setSavedId(committedId);
      setRecordingId(null);
      setError(null);

      window.setTimeout(() => {
        setSavedId((current) =>
          current === committedId ? null : current,
        );
      }, 1400);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (!recordingId) return;
      setPreviewKeys(keyboardEventToDisplayParts(event));
    };

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
      setKeyboardShortcutCaptureActive(false);
    };
  }, [copy.conflict, copy.invalid, recordingId, shortcuts, t]);

  const startRecording = (id: ShortcutActionId) => {
    setError(null);
    setSavedId(null);
    setPreviewKeys([]);
    setRecordingId(id);
  };

  const cancelRecording = () => {
    setRecordingId(null);
    setPreviewKeys([]);
    setError(null);
  };

  const resetOne = (id: ShortcutActionId) => {
    resetKeyboardShortcutBinding(id);
    setError(null);
    setSavedId(null);

    if (recordingId === id) {
      cancelRecording();
    }
  };

  const resetAll = () => {
    resetAllKeyboardShortcutBindings();
    setRecordingId(null);
    setPreviewKeys([]);
    setSavedId(null);
    setError(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-neutral-900 bg-black/35 px-4 py-3">
        <div className="flex items-center gap-2 text-xs text-neutral-600">
          <Keyboard size={14} />
          <span>{copy.local}</span>
        </div>

        <button
          type="button"
          onClick={resetAll}
          className="inline-flex items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs font-medium text-neutral-400 transition duration-150 hover:border-neutral-700 hover:text-white active:scale-[0.98]"
        >
          <RotateCcw size={13} />
          {copy.resetAll}
        </button>
      </div>

      <AnimatePresence initial={false}>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -6, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: -4, height: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="flex items-start gap-2 rounded-2xl border border-amber-400/15 bg-amber-400/[0.035] px-4 py-3 text-xs leading-5 text-amber-100/70">
              <AlertTriangle
                size={14}
                className="mt-0.5 shrink-0"
              />
              <span>{error}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="overflow-hidden rounded-2xl border border-neutral-900 bg-black/30">
        {shortcuts.map((shortcut, index) => {
          const overridden = isKeyboardShortcutOverridden(
            shortcut.id,
          );
          const recording = recordingId === shortcut.id;
          const saved = savedId === shortcut.id;
          const displayKeys = splitKeyboardShortcutDisplay(
            shortcut.displayKeys,
          );

          return (
            <motion.div
              layout
              key={shortcut.id}
              className={[
                "relative px-4",
                index > 0 ? "border-t border-neutral-900" : "",
                shortcut.enabled ? "" : "opacity-45",
              ].join(" ")}
              animate={{
                backgroundColor: recording
                  ? "rgba(255,255,255,0.018)"
                  : "rgba(0,0,0,0)",
              }}
              transition={{ duration: 0.16 }}
            >
              <div className="flex min-h-[78px] items-center justify-between gap-5 py-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-white">
                      {t(
                        `settings.shortcut.${shortcut.id}.label`,
                      )}
                    </p>

                    {shortcut.enabled && (
                      <AnimatePresence mode="wait" initial={false}>
                        {saved ? (
                          <motion.span
                            key="saved"
                            initial={{ opacity: 0, scale: 0.9, y: 2 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="inline-flex items-center gap-1 rounded-full border border-emerald-400/20 bg-emerald-400/[0.05] px-2 py-0.5 text-[9px] uppercase tracking-[0.1em] text-emerald-300"
                          >
                            <Check size={9} />
                            {copy.saved}
                          </motion.span>
                        ) : (
                          <motion.span
                            key={overridden ? "changed" : "default"}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="rounded-full border border-neutral-800 bg-neutral-950 px-2 py-0.5 text-[9px] uppercase tracking-[0.1em] text-neutral-600"
                          >
                            {overridden
                              ? copy.changed
                              : copy.default}
                          </motion.span>
                        )}
                      </AnimatePresence>
                    )}
                  </div>

                  <p className="mt-1 max-w-3xl text-xs leading-5 text-neutral-600">
                    {t(
                      `settings.shortcut.${shortcut.id}.description`,
                    )}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {shortcut.enabled ? (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          recording
                            ? cancelRecording()
                            : startRecording(shortcut.id)
                        }
                        className={[
                          "group min-w-[146px] rounded-xl border px-3 py-2 transition duration-150",
                          "active:scale-[0.985]",
                          recording
                            ? "border-white/25 bg-white/[0.06] text-white shadow-[0_0_24px_rgba(255,255,255,0.04)]"
                            : "border-neutral-800 bg-neutral-950 hover:border-neutral-700",
                        ].join(" ")}
                      >
                        {recording ? (
                          <span className="flex items-center justify-center gap-2 text-[10px] font-medium uppercase tracking-[0.12em] text-neutral-300">
                            <motion.span
                              className="size-1.5 rounded-full bg-white"
                              animate={{ opacity: [0.25, 1, 0.25] }}
                              transition={{
                                duration: 1.1,
                                repeat: Infinity,
                                ease: "easeInOut",
                              }}
                            />
                            {copy.recording}
                          </span>
                        ) : (
                          <div className="flex justify-center">
                            <KeyCaps keys={displayKeys} />
                          </div>
                        )}
                      </button>

                      {overridden && (
                        <button
                          type="button"
                          title={copy.reset}
                          aria-label={copy.reset}
                          onClick={() =>
                            resetOne(shortcut.id)
                          }
                          className="grid size-9 place-items-center rounded-xl border border-neutral-900 bg-black/35 text-neutral-600 transition duration-150 hover:border-neutral-700 hover:text-white active:scale-[0.96]"
                        >
                          <RotateCcw size={14} />
                        </button>
                      )}
                    </>
                  ) : (
                    <span className="rounded-full border border-neutral-900 bg-black/25 px-3 py-1.5 text-[10px] uppercase tracking-[0.12em] text-neutral-700">
                      {copy.unavailable}
                    </span>
                  )}
                </div>
              </div>

              <AnimatePresence initial={false}>
                {recording && (
                  <motion.div
                    initial={{ height: 0, opacity: 0, y: -6 }}
                    animate={{ height: "auto", opacity: 1, y: 0 }}
                    exit={{ height: 0, opacity: 0, y: -4 }}
                    transition={{
                      duration: 0.2,
                      ease: [0.22, 1, 0.36, 1],
                    }}
                    className="overflow-hidden"
                  >
                    <div className="mb-4 rounded-2xl border border-white/10 bg-white/[0.025] p-4">
                      <div className="flex flex-wrap items-center justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <motion.span
                              className="size-1.5 rounded-full bg-white"
                              animate={{
                                opacity: [0.3, 1, 0.3],
                                scale: [0.9, 1.15, 0.9],
                              }}
                              transition={{
                                duration: 1.15,
                                repeat: Infinity,
                                ease: "easeInOut",
                              }}
                            />
                            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-400">
                              {copy.recording}
                            </p>
                          </div>
                          <p className="mt-1 text-xs text-neutral-600">
                            {copy.pressKeys}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={cancelRecording}
                          className="grid size-8 place-items-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-600 transition hover:border-neutral-700 hover:text-white"
                          title={copy.escape}
                          aria-label={copy.escape}
                        >
                          <X size={13} />
                        </button>
                      </div>

                      <div className="mt-4 flex min-h-12 items-center rounded-xl border border-neutral-900 bg-black/55 px-4">
                        <AnimatePresence mode="popLayout" initial={false}>
                          {previewKeys.length > 0 ? (
                            <motion.div
                              key={previewKeys.join("-")}
                              initial={{ opacity: 0, y: 4 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -3 }}
                              transition={{ duration: 0.12 }}
                            >
                              <KeyCaps
                                keys={previewKeys}
                                active
                              />
                            </motion.div>
                          ) : (
                            <motion.span
                              key="waiting"
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              className="text-xs text-neutral-700"
                            >
                              {copy.waiting}
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </div>

                      <p className="mt-3 text-[10px] text-neutral-700">
                        {copy.escape}
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
