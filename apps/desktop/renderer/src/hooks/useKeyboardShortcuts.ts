import { useEffect } from "react";
import {
  keyboardShortcuts,
  matchesKeyboardShortcut,
  type ShortcutActionId
} from "../config/keyboardShortcuts";

type ShortcutHandlers = Partial<Record<ShortcutActionId, () => void>>;

export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const shortcut = keyboardShortcuts.find((item) =>
        matchesKeyboardShortcut(event, item)
      );

      if (!shortcut) {
        return;
      }

      const handler = handlers[shortcut.id];

      if (shortcut.preventDefault) {
        event.preventDefault();
        event.stopPropagation();
      }

      if (!handler) {
        return;
      }

      handler();
    }

    window.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [handlers]);
}