import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";

export interface SelectOption<TValue extends string = string> {
  value: TValue;
  label: string;
  description?: string;
  icon?: ReactNode;
  disabled?: boolean;
}

interface CustomSelectProps<TValue extends string = string> {
  value: TValue | string;
  options: SelectOption<TValue>[];
  onChange: (value: TValue) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

interface SelectPosition {
  top: number;
  left: number;
  width: number;
  openUp: boolean;
}

const MENU_VERTICAL_OFFSET = 8;
const MENU_MAX_HEIGHT = 320;
const VIEWPORT_PADDING = 12;

export function CustomSelect<TValue extends string = string>({
  value,
  options,
  onChange,
  placeholder = "Select option",
  disabled = false,
  className = ""
}: CustomSelectProps<TValue>) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<SelectPosition>({
    top: 0,
    left: 0,
    width: 240,
    openUp: false
  });

  const selectedOption = useMemo(() => {
    return options.find((option) => option.value === value) ?? null;
  }, [options, value]);

  function updatePosition() {
    const trigger = triggerRef.current;

    if (!trigger) {
      return;
    }

    const rect = trigger.getBoundingClientRect();
    const estimatedHeight = Math.min(MENU_MAX_HEIGHT, options.length * 62 + 8);

    const shouldOpenUp =
      rect.bottom + MENU_VERTICAL_OFFSET + estimatedHeight >
      window.innerHeight - VIEWPORT_PADDING;

    const width = Math.max(rect.width, 220);
    const left = Math.min(
      window.innerWidth - width - VIEWPORT_PADDING,
      Math.max(VIEWPORT_PADDING, rect.left)
    );

    setPosition({
      top: shouldOpenUp
        ? Math.max(
            VIEWPORT_PADDING,
            rect.top - estimatedHeight - MENU_VERTICAL_OFFSET
          )
        : rect.bottom + MENU_VERTICAL_OFFSET,
      left,
      width,
      openUp: shouldOpenUp
    });
  }

  function openSelect() {
    if (disabled) {
      return;
    }

    updatePosition();
    setIsOpen(true);
  }

  function closeSelect() {
    setIsOpen(false);
  }

  function toggleSelect() {
    if (isOpen) {
      closeSelect();
      return;
    }

    openSelect();
  }

  function handleSelect(option: SelectOption<TValue>) {
    if (option.disabled) {
      return;
    }

    onChange(option.value);
    closeSelect();
  }

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeSelect();
      }
    }

    function handleWindowChange() {
      updatePosition();
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleWindowChange);
    window.addEventListener("scroll", handleWindowChange, true);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleWindowChange);
      window.removeEventListener("scroll", handleWindowChange, true);
    };
  }, [isOpen, options.length]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={toggleSelect}
        className={[
          "app-no-drag flex h-11 w-full items-center justify-between gap-3 rounded-2xl",
          "border border-neutral-900 bg-black/40 px-3.5 text-left",
          "text-sm text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.025)] outline-none transition",
          "hover:border-neutral-700 hover:bg-neutral-950/90",
          "focus-visible:border-white/50 focus-visible:ring-4 focus-visible:ring-white/10",
          "disabled:cursor-not-allowed disabled:opacity-50",
          isOpen
            ? "border-white/25 bg-neutral-950 text-white shadow-[0_0_28px_rgba(255,255,255,0.045),inset_0_1px_0_rgba(255,255,255,0.04)]"
            : "",
          className
        ].join(" ")}
      >
        <span className="flex min-w-0 items-center gap-3">
          {selectedOption?.icon && (
            <span className="shrink-0">
              {selectedOption.icon}
            </span>
          )}

          <span className="block min-w-0">
            <span className="block truncate font-medium">
              {selectedOption?.label ?? placeholder}
            </span>

            {selectedOption?.description && (
              <span className="mt-0.5 block truncate text-[11px] text-neutral-600">
                {selectedOption.description}
              </span>
            )}
          </span>
        </span>

        <ChevronDown
          size={16}
          className={[
            "shrink-0 text-neutral-500 transition duration-200",
            isOpen ? "rotate-180 text-neutral-200" : ""
          ].join(" ")}
        />
      </button>

      {createPortal(
        <AnimatePresence>
          {isOpen && (
            <>
              <motion.button
                type="button"
                aria-label="Close select"
                className="fixed inset-0 z-[9998] cursor-default bg-transparent"
                onClick={closeSelect}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                tabIndex={-1}
              />

              <motion.div
                className="cf-floating-popover fixed z-[9999] overflow-hidden rounded-2xl border border-neutral-800/80 bg-black/95 p-1.5 shadow-[0_24px_80px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-2xl"
                style={{
                  top: position.top,
                  left: position.left,
                  width: position.width,
                  maxHeight: MENU_MAX_HEIGHT
                }}
                initial={{
                  opacity: 0,
                  y: position.openUp ? 8 : -8,
                  scale: 0.98
                }}
                animate={{
                  opacity: 1,
                  y: 0,
                  scale: 1
                }}
                exit={{
                  opacity: 0,
                  y: position.openUp ? 8 : -8,
                  scale: 0.98
                }}
                transition={{
                  duration: 0.16,
                  ease: [0.16, 1, 0.3, 1]
                }}
              >
                <div className="max-h-[320px] overflow-auto">
                  {options.map((option) => {
                    const isSelected = option.value === value;

                    return (
                      <button
                        key={option.value}
                        type="button"
                        disabled={option.disabled}
                        onClick={() => handleSelect(option)}
                        className={[
                          "group flex w-full items-start justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition",
                          isSelected
                            ? "bg-white text-black"
                            : "text-neutral-300 hover:bg-white/[0.055] hover:text-white",
                          option.disabled
                            ? "cursor-not-allowed opacity-45"
                            : ""
                        ].join(" ")}
                      >
                        <span className="flex min-w-0 items-start gap-3">
                          {option.icon && (
                            <span className="mt-0.5 shrink-0">
                              {option.icon}
                            </span>
                          )}

                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">
                              {option.label}
                            </span>

                            {option.description && (
                              <span
                                className={[
                                  "mt-0.5 block line-clamp-2 text-xs leading-5",
                                  isSelected
                                    ? "text-black/60"
                                    : "text-neutral-600 group-hover:text-neutral-400"
                                ].join(" ")}
                              >
                                {option.description}
                              </span>
                            )}
                          </span>
                        </span>

                        {isSelected && (
                          <Check
                            size={15}
                            className="mt-0.5 shrink-0 text-black"
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}