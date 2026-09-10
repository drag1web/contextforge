import assert from "node:assert/strict";

import {
  keyboardShortcuts,
  matchesKeyboardShortcut,
} from "../apps/desktop/renderer/src/config/keyboardShortcuts.ts";
import {
  clampWorkspaceZoom,
  readStoredWorkspaceZoom,
  resetWorkspaceZoom,
  sanitizeWorkspaceZoom,
  stepWorkspaceZoom,
  storeWorkspaceZoom,
  WORKSPACE_ZOOM_DEFAULT,
  WORKSPACE_ZOOM_MAX,
  WORKSPACE_ZOOM_MIN,
  workspaceZoomPercent,
  type WorkspaceZoomStorage,
} from "../apps/desktop/renderer/src/lib/workspaceZoom.ts";

class MemoryStorage implements WorkspaceZoomStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

let scenarios = 0;
function scenario(name: string, run: () => void) {
  run();
  scenarios += 1;
  process.stdout.write(`PASS ${name}\n`);
}

scenario("workspace zoom defaults to 100 percent", () => {
  assert.equal(readStoredWorkspaceZoom(new MemoryStorage()), WORKSPACE_ZOOM_DEFAULT);
  assert.equal(workspaceZoomPercent(WORKSPACE_ZOOM_DEFAULT), 100);
});

scenario("workspace zoom clamps its supported range", () => {
  assert.equal(clampWorkspaceZoom(0.1), WORKSPACE_ZOOM_MIN);
  assert.equal(clampWorkspaceZoom(4), WORKSPACE_ZOOM_MAX);
});

scenario("workspace zoom increments and decrements by five percent", () => {
  assert.equal(stepWorkspaceZoom(1, 1), 1.05);
  assert.equal(stepWorkspaceZoom(1, -1), 0.95);
});

scenario("workspace zoom resets to 100 percent", () => {
  assert.equal(resetWorkspaceZoom(), WORKSPACE_ZOOM_DEFAULT);
});

scenario("workspace zoom boundaries do not overflow", () => {
  assert.equal(stepWorkspaceZoom(WORKSPACE_ZOOM_MIN, -1), WORKSPACE_ZOOM_MIN);
  assert.equal(stepWorkspaceZoom(WORKSPACE_ZOOM_MAX, 1), WORKSPACE_ZOOM_MAX);
});

scenario("workspace zoom persistence restores a valid value", () => {
  const storage = new MemoryStorage();
  storeWorkspaceZoom(1.25, storage);
  assert.equal(readStoredWorkspaceZoom(storage), 1.25);
});

scenario("workspace zoom storage clamps out-of-range values", () => {
  const storage = new MemoryStorage();
  storage.setItem("contextforge.workspaceZoom.v1", "2.5");
  assert.equal(readStoredWorkspaceZoom(storage), WORKSPACE_ZOOM_MAX);
});

scenario("workspace zoom rejects malformed stored values", () => {
  assert.equal(sanitizeWorkspaceZoom("not-a-number"), WORKSPACE_ZOOM_DEFAULT);
  const storage = new MemoryStorage();
  storage.setItem("contextforge.workspaceZoom.v1", "NaN");
  assert.equal(readStoredWorkspaceZoom(storage), WORKSPACE_ZOOM_DEFAULT);
});

scenario("workspace zoom shortcuts are registered centrally", () => {
  const shortcuts = new Map(keyboardShortcuts.map((shortcut) => [shortcut.id, shortcut]));
  assert.equal(shortcuts.get("zoomIn")?.code, "Equal");
  assert.equal(shortcuts.get("zoomIn")?.shiftOptional, true);
  assert.equal(shortcuts.get("zoomOut")?.code, "Minus");
  assert.equal(shortcuts.get("zoomReset")?.code, "Digit0");
});

scenario("workspace zoom-in accepts Ctrl plus and Ctrl equals", () => {
  Object.defineProperty(globalThis, "HTMLElement", {
    configurable: true,
    value: class HTMLElement {},
  });
  const shortcut = keyboardShortcuts.find((candidate) => candidate.id === "zoomIn");
  assert.ok(shortcut);
  const baseEvent = {
    target: null,
    key: "=",
    code: "Equal",
    ctrlKey: true,
    metaKey: false,
    shiftKey: false,
    altKey: false,
  } as KeyboardEvent;
  assert.equal(matchesKeyboardShortcut(baseEvent, shortcut), true);
  assert.equal(
    matchesKeyboardShortcut(
      { ...baseEvent, key: "+", shiftKey: true } as KeyboardEvent,
      shortcut,
    ),
    true,
  );
});

process.stdout.write(`Workspace zoom smoke passed: ${scenarios} scenarios.\n`);
