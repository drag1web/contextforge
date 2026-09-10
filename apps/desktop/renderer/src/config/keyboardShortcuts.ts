export type ShortcutActionId =
  | "navigationBack"
  | "navigationForward"
  | "toggleFocusMode"
  | "zoomIn"
  | "zoomOut"
  | "zoomReset"
  | "globalSearch"
  | "navigationAssistant"
  | "addProject"
  | "createTaskPack"
  | "openSettings"
  | "openTaskPacks";

export interface KeyboardShortcut {
  id: ShortcutActionId;
  label: string;
  description: string;
  displayKeys: string;

  /**
   * event.key fallback.
   * Can depend on keyboard layout.
   */
  key: string;

  /**
   * event.code is layout-independent.
   * Example: KeyF works for Ctrl+F even on Russian layout.
   */
  code?: string;

  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  enabled: boolean;
  placeholder?: boolean;
  preventDefault?: boolean;
  allowInEditable?: boolean;
  shiftOptional?: boolean;
}

export const keyboardShortcuts: KeyboardShortcut[] = [
  {
    id: "navigationBack",
    label: "Back",
    description: "Go to the previous workspace page.",
    displayKeys: "Alt ←",
    key: "arrowleft",
    code: "ArrowLeft",
    alt: true,
    enabled: true,
    preventDefault: true
  },
  {
    id: "navigationForward",
    label: "Forward",
    description: "Go to the next workspace page.",
    displayKeys: "Alt →",
    key: "arrowright",
    code: "ArrowRight",
    alt: true,
    enabled: true,
    preventDefault: true
  },
  {
    id: "toggleFocusMode",
    label: "Focus Mode",
    description: "Toggle focused Task Pack and Context Composer workspace.",
    displayKeys: "Ctrl Shift F",
    key: "f",
    code: "KeyF",
    ctrl: true,
    shift: true,
    enabled: true,
    preventDefault: true
  },
  {
    id: "globalSearch",
    label: "Global Search",
    description: "Search pages, projects, and Task Packs.",
    displayKeys: "Ctrl F",
    key: "f",
    code: "KeyF",
    ctrl: true,
    enabled: true,
    preventDefault: true,
    allowInEditable: true
  },
  {
    id: "navigationAssistant",
    label: "Command Palette",
    description: "Open commands, projects, navigation, and workspace actions.",
    displayKeys: "Ctrl K",
    key: "k",
    code: "KeyK",
    ctrl: true,
    enabled: true,
    preventDefault: true,
    allowInEditable: true
  },
  {
    id: "addProject",
    label: "Add Project",
    description: "Open project folder picker.",
    displayKeys: "Ctrl Shift O",
    key: "o",
    code: "KeyO",
    ctrl: true,
    shift: true,
    enabled: true,
    preventDefault: true
  },
  {
    id: "createTaskPack",
    label: "Create Task Pack",
    description: "Start Task Pack generation flow.",
    displayKeys: "Ctrl Shift T",
    key: "t",
    code: "KeyT",
    ctrl: true,
    shift: true,
    enabled: false,
    placeholder: true,
    preventDefault: true
  },
  {
    id: "openTaskPacks",
    label: "Open Task Packs",
    description: "Jump to Task Packs archive.",
    displayKeys: "Ctrl Shift P",
    key: "p",
    code: "KeyP",
    ctrl: true,
    shift: true,
    enabled: true,
    preventDefault: true
  },
  {
    id: "openSettings",
    label: "Open Settings",
    description: "Jump to application settings.",
    displayKeys: "Ctrl ,",
    key: ",",
    code: "Comma",
    ctrl: true,
    enabled: true,
    preventDefault: true
  },
  {
    id: "zoomIn",
    label: "Zoom In",
    description: "Increase the workspace page zoom.",
    displayKeys: "Ctrl +",
    key: "=",
    code: "Equal",
    ctrl: true,
    shiftOptional: true,
    enabled: true,
    preventDefault: true,
    allowInEditable: true
  },
  {
    id: "zoomOut",
    label: "Zoom Out",
    description: "Decrease the workspace page zoom.",
    displayKeys: "Ctrl -",
    key: "-",
    code: "Minus",
    ctrl: true,
    enabled: true,
    preventDefault: true,
    allowInEditable: true
  },
  {
    id: "zoomReset",
    label: "Reset Zoom",
    description: "Reset the workspace page zoom to 100%.",
    displayKeys: "Ctrl 0",
    key: "0",
    code: "Digit0",
    ctrl: true,
    enabled: true,
    preventDefault: true,
    allowInEditable: true
  }
];

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();

  return (
    target.isContentEditable ||
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select"
  );
}

export function matchesKeyboardShortcut(
  event: KeyboardEvent,
  shortcut: KeyboardShortcut
) {
  if (!shortcut.enabled) {
    return false;
  }

  if (!shortcut.allowInEditable && isEditableTarget(event.target)) {
    return false;
  }

  const eventKey = event.key.toLowerCase();
  const shortcutKey = shortcut.key.toLowerCase();

  const keyMatches =
    eventKey === shortcutKey ||
    Boolean(shortcut.code && event.code === shortcut.code);

  const ctrlMatches = shortcut.ctrl
    ? event.ctrlKey || event.metaKey
    : !event.ctrlKey && !event.metaKey;

  const shiftMatches = shortcut.shiftOptional
    ? true
    : Boolean(shortcut.shift) === event.shiftKey;
  const altMatches = Boolean(shortcut.alt) === event.altKey;

  return keyMatches && ctrlMatches && shiftMatches && altMatches;
}
