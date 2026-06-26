import { AnimatePresence, motion } from "framer-motion";
import { MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface DropdownAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

interface DropdownMenuProps {
  actions: DropdownAction[];
}

interface MenuPosition {
  top: number;
  left: number;
  openUp: boolean;
}

const MENU_WIDTH = 220;
const MENU_ITEM_HEIGHT = 38;
const MENU_VERTICAL_OFFSET = 8;

export function DropdownMenu({ actions }: DropdownMenuProps) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition>({
    top: 0,
    left: 0,
    openUp: false
  });

  function updatePosition() {
    const button = buttonRef.current;

    if (!button) {
      return;
    }

    const rect = button.getBoundingClientRect();
    const estimatedMenuHeight = actions.length * MENU_ITEM_HEIGHT + 8;

    const shouldOpenUp =
      rect.bottom + MENU_VERTICAL_OFFSET + estimatedMenuHeight > window.innerHeight;

    const top = shouldOpenUp
      ? Math.max(12, rect.top - estimatedMenuHeight - MENU_VERTICAL_OFFSET)
      : rect.bottom + MENU_VERTICAL_OFFSET;

    const left = Math.min(
      window.innerWidth - MENU_WIDTH - 12,
      Math.max(12, rect.right - MENU_WIDTH)
    );

    setPosition({
      top,
      left,
      openUp: shouldOpenUp
    });
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
  }, [isOpen, actions.length]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleMenu}
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
                aria-label="Close menu"
                className="fixed inset-0 z-[9998] cursor-default bg-transparent"
                onClick={closeMenu}
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
                  width: MENU_WIDTH
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

                      action.onClick();
                      closeMenu();
                    }}
                    className={[
                      "cf-menu-item",
                      action.disabled ? "cf-menu-item-disabled" : ""
                    ].join(" ")}
                  >
                    <span className="truncate">{action.label}</span>
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