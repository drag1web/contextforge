import {
  keyboardShortcuts,
  type KeyboardShortcut,
  type ShortcutActionId,
} from "../config/keyboardShortcuts";

export type KeyboardShortcutBinding = Pick<
  KeyboardShortcut,
  "key" | "code" | "ctrl" | "shift" | "alt" | "displayKeys"
>;

export type ShortcutBindingResult =
  | { ok: true }
  | {
      ok: false;
      reason: "conflict";
      conflictId: ShortcutActionId;
    };

const STORAGE_KEY = "contextforge.keyboard-shortcut-overrides.v1";
const CHANGE_EVENT = "contextforge:keyboard-shortcuts-changed";

type ShortcutOverrides = Partial<
  Record<ShortcutActionId, KeyboardShortcutBinding>
>;

let captureActive = false;

function canUseWindow() {
  return typeof window !== "undefined";
}

function readOverrides(): ShortcutOverrides {
  if (!canUseWindow()) return {};

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};

    const result: ShortcutOverrides = {};

    for (const shortcut of keyboardShortcuts) {
      const candidate = parsed[shortcut.id];

      if (
        !candidate ||
        typeof candidate !== "object" ||
        typeof candidate.key !== "string" ||
        typeof candidate.displayKeys !== "string"
      ) {
        continue;
      }

      result[shortcut.id] = {
        key: candidate.key,
        code:
          typeof candidate.code === "string"
            ? candidate.code
            : undefined,
        ctrl: candidate.ctrl === true,
        shift: candidate.shift === true,
        alt: candidate.alt === true,
        displayKeys: candidate.displayKeys,
      };
    }

    return result;
  } catch {
    return {};
  }
}

function writeOverrides(overrides: ShortcutOverrides) {
  if (!canUseWindow()) return;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // Local shortcut preferences are optional and fail-silent.
  }
}

function emitChanged() {
  if (!canUseWindow()) return;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function shortcutSignature(
  binding: Pick<
    KeyboardShortcutBinding,
    "key" | "code" | "ctrl" | "shift" | "alt"
  >,
) {
  const keyIdentity = binding.code || binding.key.toLowerCase();

  return [
    binding.ctrl === true ? "1" : "0",
    binding.shift === true ? "1" : "0",
    binding.alt === true ? "1" : "0",
    keyIdentity,
  ].join("|");
}

function getCodeLabel(code: string, key: string) {
  if (/^Key[A-Z]$/.test(code)) {
    return code.slice(3);
  }

  if (/^Digit[0-9]$/.test(code)) {
    return code.slice(5);
  }

  if (/^F(?:[1-9]|1[0-2])$/.test(code)) {
    return code;
  }

  const labels: Record<string, string> = {
    Comma: ",",
    Period: ".",
    Slash: "/",
    Semicolon: ";",
    Quote: "'",
    BracketLeft: "[",
    BracketRight: "]",
    Backslash: "\\",
    Minus: "-",
    Equal: "=",
    Space: "Space",
    Enter: "Enter",
    Tab: "Tab",
    Backspace: "Backspace",
    Delete: "Delete",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
  };

  return labels[code] ?? key.toUpperCase();
}

export function getEffectiveKeyboardShortcuts(): KeyboardShortcut[] {
  const overrides = readOverrides();

  return keyboardShortcuts.map((shortcut) => {
    const override = overrides[shortcut.id];
    return override ? { ...shortcut, ...override } : shortcut;
  });
}

export function getEffectiveKeyboardShortcut(
  id: ShortcutActionId,
): KeyboardShortcut | undefined {
  return getEffectiveKeyboardShortcuts().find(
    (shortcut) => shortcut.id === id,
  );
}

export function isKeyboardShortcutOverridden(id: ShortcutActionId) {
  return Boolean(readOverrides()[id]);
}

export function setKeyboardShortcutCaptureActive(active: boolean) {
  captureActive = active;
}

export function isKeyboardShortcutCaptureActive() {
  return captureActive;
}

export function keyboardEventToDisplayParts(
  event: KeyboardEvent,
): string[] {
  const parts: string[] = [];

  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");

  const modifierCodes = new Set([
    "ControlLeft",
    "ControlRight",
    "ShiftLeft",
    "ShiftRight",
    "AltLeft",
    "AltRight",
    "MetaLeft",
    "MetaRight",
  ]);

  if (!modifierCodes.has(event.code) && event.code) {
    parts.push(
      getCodeLabel(
        event.code,
        String(event.key ?? "").toLowerCase(),
      ),
    );
  }

  return parts;
}

export function splitKeyboardShortcutDisplay(
  displayKeys: string,
): string[] {
  return displayKeys
    .split(/\s+/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function keyboardEventToBinding(
  event: KeyboardEvent,
): KeyboardShortcutBinding | null {
  if (event.metaKey) {
    return null;
  }

  const modifierCodes = new Set([
    "ControlLeft",
    "ControlRight",
    "ShiftLeft",
    "ShiftRight",
    "AltLeft",
    "AltRight",
    "MetaLeft",
    "MetaRight",
  ]);

  if (modifierCodes.has(event.code)) {
    return null;
  }

  const functionKey = /^F(?:[1-9]|1[0-2])$/.test(event.code);
  const hasModifier =
    event.ctrlKey || event.shiftKey || event.altKey;

  if (!functionKey && !hasModifier) {
    return null;
  }

  if (event.altKey && event.code === "F4") {
    return null;
  }

  const key = String(event.key ?? "").toLowerCase();
  const displayParts = keyboardEventToDisplayParts(event);

  return {
    key,
    code: event.code || undefined,
    ctrl: event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
    displayKeys: displayParts.join(" "),
  };
}

export function setKeyboardShortcutBinding(
  id: ShortcutActionId,
  binding: KeyboardShortcutBinding,
): ShortcutBindingResult {
  const target = keyboardShortcuts.find(
    (shortcut) => shortcut.id === id,
  );

  if (!target || !target.enabled) {
    return { ok: true };
  }

  const signature = shortcutSignature(binding);
  const conflict = getEffectiveKeyboardShortcuts().find(
    (shortcut) =>
      shortcut.enabled &&
      shortcut.id !== id &&
      shortcutSignature(shortcut) === signature,
  );

  if (conflict) {
    return {
      ok: false,
      reason: "conflict",
      conflictId: conflict.id,
    };
  }

  const overrides = readOverrides();
  overrides[id] = binding;
  writeOverrides(overrides);
  emitChanged();

  return { ok: true };
}

export function resetKeyboardShortcutBinding(id: ShortcutActionId) {
  const overrides = readOverrides();

  if (!overrides[id]) {
    return;
  }

  delete overrides[id];
  writeOverrides(overrides);
  emitChanged();
}

export function resetAllKeyboardShortcutBindings() {
  if (!canUseWindow()) return;

  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Local shortcut preferences are optional and fail-silent.
  }

  emitChanged();
}

export function subscribeKeyboardShortcutChanges(
  handler: () => void,
) {
  if (!canUseWindow()) {
    return () => {};
  }

  window.addEventListener(CHANGE_EVENT, handler);

  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
  };
}
