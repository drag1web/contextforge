import { AnimatePresence, motion } from "framer-motion";
import { MoreHorizontal } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

interface DropdownAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  icon?: ReactNode;
  tone?: "default" | "danger";
}

interface DropdownMenuProps {
  actions: DropdownAction[];
  ariaLabel?: string;
  size?: "default" | "wide";
}

interface MenuPosition {
  top: number;
  left: number;
  openUp: boolean;
  width: number;
}

const MENU_WIDTH = 220;
const WIDE_MENU_WIDTH = 320;
const MENU_ITEM_HEIGHT = 38;
const MENU_VERTICAL_OFFSET = 8;
const VIEWPORT_PADDING = 12;

/** Match the rendered width to positioning, including narrow/zoomed viewports. */
export function getDropdownMenuPosition(
  trigger: Pick<DOMRect, "top" | "bottom" | "right">,
  actionCount: number,
  viewport: { width: number; height: number },
  size: NonNullable<DropdownMenuProps["size"]> = "default",
  measuredHeight?: number,
): MenuPosition {
  const width = Math.min(size === "wide" ? WIDE_MENU_WIDTH : MENU_WIDTH,
    Math.max(0, viewport.width - VIEWPORT_PADDING * 2));
  const menuHeight = measuredHeight ?? actionCount * MENU_ITEM_HEIGHT + 8;
  const openUp = trigger.bottom + MENU_VERTICAL_OFFSET + menuHeight > viewport.height;
  return {
    width,
    left: Math.max(VIEWPORT_PADDING, Math.min(viewport.width - width - VIEWPORT_PADDING, trigger.right - width)),
    top: openUp ? Math.max(VIEWPORT_PADDING, trigger.top - menuHeight - MENU_VERTICAL_OFFSET)
      : trigger.bottom + MENU_VERTICAL_OFFSET,
    openUp,
  };
}

export function DropdownMenu({ actions, ariaLabel, size = "default" }: DropdownMenuProps) {
  const { t } = useTranslation();
  const resolvedAriaLabel = ariaLabel ?? t("common.moreActions");
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition>({
    top: 0,
    left: 0,
    openUp: false,
    width: size === "wide" ? WIDE_MENU_WIDTH : MENU_WIDTH,
  });

  function updatePosition() {
    const button = buttonRef.current;

    if (!button) {
      return;
    }

    setPosition(getDropdownMenuPosition(
      button.getBoundingClientRect(), actions.length,
      { width: window.innerWidth, height: window.innerHeight }, size,
      menuRef.current?.offsetHeight || undefined,
    ));
  }

  function openMenu() {
    updatePosition();
    setIsOpen(true);
  }

  function closeMenu() {
    setIsOpen(false);
  }

  function toggleMenu() {
    if (isOpen) {
      closeMenu();
    } else {
      openMenu();
    }
  }

  // Wide labels can wrap when zoomed: position using the actual layout height.
  useLayoutEffect(() => {
    if (isOpen) updatePosition();
  }, [isOpen, size, position.width, actions.length]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeMenu();
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
  }, [isOpen, actions.length, size]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleMenu}
        aria-label={resolvedAriaLabel}
        title={resolvedAriaLabel}
        className={[
          "inline-flex size-8 items-center justify-center rounded-lg",
          "border border-neutral-900 bg-neutral-950/80 text-neutral-500",
          "outline-none transition hover:border-neutral-700 hover:bg-neutral-950 hover:text-white",
          "focus-visible:border-white focus-visible:ring-4 focus-visible:ring-white/10",
          isOpen ? "border-neutral-700 bg-neutral-950 text-white" : ""
        ].join(" ")}
      >
        <MoreHorizontal size={16} />
      </button>

      {createPortal(
        <AnimatePresence>
          {isOpen && (
            <>
              <motion.button
                type="button"
                aria-label={t("common.closeMenu")}
                className="fixed inset-0 z-[9998] cursor-default bg-transparent"
                onClick={closeMenu}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                tabIndex={-1}
              />

              <motion.div
                ref={menuRef}
                className="cf-floating-popover fixed z-[9999] overflow-hidden rounded-xl p-1"
                style={{
                  top: position.top,
                  left: position.left,
                  width: position.width,
                  maxHeight: "calc(100vh - 24px)",
                  overflowY: "auto",
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
                {actions.map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    disabled={action.disabled}
                    onClick={() => {
                      if (action.disabled) {
                        return;
                      }

                      // A dialog opened by this action must restore focus to a surviving trigger.
                      buttonRef.current?.focus();
                      action.onClick();
                      closeMenu();
                    }}
                    className={[
                      "cf-menu-item group",
                      action.tone === "danger"
                        ? "!text-red-200 hover:!bg-red-500/10 hover:!text-red-100 focus-visible:!bg-red-500/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-red-300/30"
                        : "",
                      action.disabled ? "cf-menu-item-disabled" : ""
                    ].join(" ")}
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      {action.icon && (
                        <span className={action.tone === "danger"
                          ? "shrink-0 text-red-300/80 transition-colors group-hover:text-red-200"
                          : "shrink-0 text-neutral-500 transition-colors group-hover:text-white"}>
                          {action.icon}
                        </span>
                      )}
                      <span className={size === "wide" ? "min-w-0 whitespace-normal break-words leading-5" : "truncate"}>{action.label}</span>
                    </span>
                  </button>
                ))}
              </motion.div>
            </>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}
