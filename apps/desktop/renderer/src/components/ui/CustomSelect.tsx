import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface SelectOption<TValue extends string = string> {
    value: TValue;
    label: string;
    description?: string;
    disabled?: boolean;
}

interface CustomSelectProps<TValue extends string = string> {
    value: TValue;
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
const MENU_MAX_HEIGHT = 280;

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
        const estimatedHeight = Math.min(MENU_MAX_HEIGHT, options.length * 56 + 8);
        const shouldOpenUp =
            rect.bottom + MENU_VERTICAL_OFFSET + estimatedHeight > window.innerHeight;

        setPosition({
            top: shouldOpenUp
                ? Math.max(12, rect.top - estimatedHeight - MENU_VERTICAL_OFFSET)
                : rect.bottom + MENU_VERTICAL_OFFSET,
            left: Math.min(
                window.innerWidth - rect.width - 12,
                Math.max(12, rect.left)
            ),
            width: rect.width,
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
        } else {
            openSelect();
        }
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
                    "app-no-drag flex h-10 w-full items-center justify-between gap-3 rounded-xl",
                    "border border-neutral-900 bg-neutral-950/80 px-3 text-left",
                    "text-sm text-white shadow-sm outline-none transition",
                    "hover:border-neutral-700 hover:bg-neutral-950",
                    "focus-visible:border-white focus-visible:ring-4 focus-visible:ring-white/10",
                    "disabled:cursor-not-allowed disabled:opacity-50",
                    isOpen ? "border-neutral-600 bg-neutral-950" : "",
                    className
                ].join(" ")}
            >
                <span className="block min-w-0 truncate font-medium">
                    {selectedOption?.label ?? placeholder}
                </span>

                <ChevronDown
                    size={16}
                    className={[
                        "shrink-0 text-neutral-500 transition duration-200",
                        isOpen ? "rotate-180 text-neutral-300" : ""
                    ].join(" ")}
                />
            </button>

            {createPortal(
                <>
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
                                    className="cf-floating-popover fixed z-[9999] overflow-hidden rounded-xl p-1"
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
                                    <div className="max-h-[280px] overflow-auto p-1">
                                        {options.map((option) => {
                                            const isSelected = option.value === value;

                                            return (
                                                <button
                                                    key={option.value}
                                                    type="button"
                                                    disabled={option.disabled}
                                                    onClick={() => {
                                                        if (option.disabled) {
                                                            return;
                                                        }

                                                        onChange(option.value);
                                                        closeSelect();
                                                    }}
                                                    className={[
                                                        "cf-menu-item",
                                                        isSelected ? "cf-menu-item-selected" : "",
                                                        option.disabled ? "cf-menu-item-disabled" : ""
                                                    ].join(" ")}
                                                >
                                                    <span className="block min-w-0 truncate">
                                                        {option.label}
                                                    </span>

                                                    {isSelected && <Check size={15} className="shrink-0" />}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </motion.div>
                            </>
                        )}
                    </AnimatePresence>
                </>,
                document.body
            )}
        </>
    );
}