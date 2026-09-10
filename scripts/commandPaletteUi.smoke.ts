import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repositoryRoot = process.cwd();
let scenarios = 0;

function read(relativePath: string) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}

function scenario(name: string, run: () => void) {
  run();
  scenarios += 1;
  process.stdout.write(`PASS ${name}\n`);
}

const dashboardSource = read("apps/desktop/renderer/src/pages/DashboardPage.tsx");
const paletteSource = read(
  "apps/desktop/renderer/src/components/modals/CommandPaletteModal.tsx",
);
const commandSource = read(
  "apps/desktop/renderer/src/utils/commandPalette.ts",
);
const modalSource = read("apps/desktop/renderer/src/components/ui/Modal.tsx");
const globalSearchSource = read(
  "apps/desktop/renderer/src/components/modals/GlobalSearchModal.tsx",
);
const shortcutSource = read(
  "apps/desktop/renderer/src/config/keyboardShortcuts.ts",
);
const translationsSource = read("apps/desktop/renderer/src/i18n/index.ts");

scenario("the existing Ctrl K shortcut now opens Command Palette", () => {
  assert.match(shortcutSource, /id: "navigationAssistant"[\s\S]{0,180}label: "Command Palette"/);
  assert.match(shortcutSource, /id: "navigationAssistant"[\s\S]{0,260}allowInEditable: true/);
  assert.match(dashboardSource, /navigationAssistant: openCommandPalette/);
  assert.match(dashboardSource, /<CommandPaletteModal/);
});

scenario("Global Search remains separate and discoverable", () => {
  assert.match(dashboardSource, /<GlobalSearchModal/);
  assert.match(commandSource, /id: "workspace\.global-search"/);
  assert.match(commandSource, /shortcutId: "globalSearch"/);
  assert.match(globalSearchSource, /closeLabel=\{t\("globalSearch\.close"\)\}/);
});

scenario("palette provides keyboard-only result navigation", () => {
  for (const key of ["ArrowDown", "ArrowUp", "Home", "End", "Enter"]) {
    assert.match(paletteSource, new RegExp(`event\\.key === "${key}"`));
  }
  assert.match(paletteSource, /scrollIntoView\(\{ block: "nearest" \}\)/);
});

scenario("palette exposes valid dialog and combobox semantics", () => {
  assert.match(modalSource, /role="dialog"/);
  assert.match(modalSource, /aria-modal="true"/);
  assert.match(paletteSource, /role="combobox"/);
  assert.match(paletteSource, /role="listbox"/);
  assert.match(paletteSource, /role="option"/);
  assert.match(paletteSource, /aria-activedescendant/);
  assert.match(paletteSource, /aria-disabled/);
});

scenario("focus is restored after the palette closes", () => {
  assert.match(paletteSource, /import \{ Modal \}/);
  assert.match(modalSource, /previousFocusRef/);
  assert.match(modalSource, /previousFocus\?\.isConnected/);
  assert.match(modalSource, /previousFocus\.focus\(\)/);
});

scenario("blocking dialogs prevent competing palette overlays", () => {
  assert.match(dashboardSource, /document\.querySelector\('\[role="dialog"\]\[aria-modal="true"\]'\)/);
  assert.match(dashboardSource, /shouldShowFirstRunOnboarding/);
});

scenario("Workspace Zoom commands reuse the centralized hook actions", () => {
  assert.match(dashboardSource, /onZoomIn: workspaceZoom\.zoomIn/);
  assert.match(dashboardSource, /onZoomOut: workspaceZoom\.zoomOut/);
  assert.match(dashboardSource, /onZoomReset: workspaceZoom\.resetZoom/);
});

scenario("project awareness and Task Pack freshness remain derived inputs", () => {
  assert.match(commandSource, /currentProject\.awareness/);
  assert.match(commandSource, /taskPackFreshnessById\.values\(\)/);
  assert.match(dashboardSource, /taskPackFreshnessById,/);
});

scenario("Russian and English Command Palette keys stay synchronized", () => {
  for (const key of [
    "commandPalette",
    "suggestedCommands",
    "noResultsTitle",
    "reviewProjectChanges",
    "reviewTaskPackFreshness_one",
    "workspaceBusy",
  ]) {
    assert.ok(
      (translationsSource.match(new RegExp(`\\b${key}:`, "g"))?.length ?? 0) >= 2,
      key,
    );
  }
});

scenario("the titlebar and Settings describe Command Palette consistently", () => {
  assert.equal(
    (translationsSource.match(/openNavigationAssistant: "(?:Open command palette|Открыть палитру команд)"/g)?.length ?? 0),
    2,
  );
  assert.ok((translationsSource.match(/navigationAssistant: \{ label: "(?:Command Palette|Палитра команд)"/g)?.length ?? 0) >= 2);
});

process.stdout.write(`Command Palette UI smoke passed: ${scenarios} scenarios.\n`);
