export type ShortcutActionId =
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
}

export const keyboardShortcuts: KeyboardShortcut[] = [
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
    label: "Navigation Assistant",
    description: "Open the page navigation helper.",
    displayKeys: "Ctrl K",
    key: "k",
    code: "KeyK",
    ctrl: true,
    enabled: false,
    placeholder: true,
    preventDefault: true
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
    enabled: false,
    placeholder: true,
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
    enabled: false,
    placeholder: true,
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
    enabled: false,
    placeholder: true,
    preventDefault: true
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

  const shiftMatches = Boolean(shortcut.shift) === event.shiftKey;
  const altMatches = Boolean(shortcut.alt) === event.altKey;

  return keyMatches && ctrlMatches && shiftMatches && altMatches;
}