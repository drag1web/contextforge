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

const modalSource = read("apps/desktop/renderer/src/components/ui/Modal.tsx");
const disclosureSource = read(
  "apps/desktop/renderer/src/components/workspace/WorkspaceDisclosure.tsx",
);
const commandPaletteSource = read(
  "apps/desktop/renderer/src/components/modals/CommandPaletteModal.tsx",
);
const globalSearchSource = read(
  "apps/desktop/renderer/src/components/modals/GlobalSearchModal.tsx",
);
const dashboardSource = read("apps/desktop/renderer/src/pages/DashboardPage.tsx");
const titlebarSource = read(
  "apps/desktop/renderer/src/components/layout/AppTitleBar.tsx",
);
const generationDiagnosticsSource = read(
  "apps/desktop/renderer/src/components/generation/GenerationDiagnosticsModal.tsx",
);
const performanceDiagnosticsSource = read(
  "apps/desktop/renderer/src/components/performance/PerformanceDiagnosticsModal.tsx",
);
const selectorDiagnosticsSource = read(
  "apps/desktop/renderer/src/components/selector/SelectorDiagnosticsModal.tsx",
);
const settingsSource = read("apps/desktop/renderer/src/pages/SettingsPage.tsx");
const taskPackBuilderSource = read(
  "apps/desktop/renderer/src/pages/TaskPackBuilderPage.tsx",
);
const zoomSource = read("apps/desktop/renderer/src/hooks/useWorkspaceZoom.ts");
const dropGuardSource = read(
  "apps/desktop/renderer/src/hooks/useGlobalDropNavigationGuard.ts",
);
const preloadSource = read("apps/desktop/electron/preload.cjs");
const electronMainSource = read("apps/desktop/electron/main.cjs");
const translationsSource = read("apps/desktop/renderer/src/i18n/index.ts");
const onboardingSource = read(
  "apps/desktop/renderer/src/components/onboarding/FirstRunOnboardingOverlay.tsx",
);
const reducedMotionPanels = [
  "apps/desktop/renderer/src/components/workspace/QuickPeekPanel.tsx",
  "apps/desktop/renderer/src/components/workspace/PersistentInspectorPanel.tsx",
  "apps/desktop/renderer/src/components/workspace/ExplainabilityLensPanel.tsx",
  "apps/desktop/renderer/src/components/workspace/ContextMapPanel.tsx",
].map(read);

scenario("generic modal traps and restores focus", () => {
  assert.match(modalSource, /role="dialog"/);
  assert.match(modalSource, /aria-modal="true"/);
  assert.match(modalSource, /event\.key !== "Tab"/);
  assert.match(modalSource, /previousFocusRef\.current/);
  assert.match(modalSource, /previousFocus\.focus\(\)/);
});

scenario("generic modal close lifecycle cleans timers and respects reduced motion", () => {
  assert.match(modalSource, /closeTimeoutRef/);
  assert.match(modalSource, /window\.clearTimeout\(closeTimeoutRef\.current\)/);
  assert.match(modalSource, /useReducedMotion\(\)/);
  assert.match(modalSource, /motion-reduce:transition-none/);
});

scenario("generic modal fallback close label is localized", () => {
  assert.match(modalSource, /t\("common\.closeDialog"\)/);
  assert.doesNotMatch(modalSource, /closeLabel = "Close modal"/);
  assert.ok((translationsSource.match(/closeDialog:/g)?.length ?? 0) >= 2);
});

scenario("diagnostics use central i18n rather than local bilingual adapters", () => {
  for (const source of [
    generationDiagnosticsSource,
    performanceDiagnosticsSource,
    selectorDiagnosticsSource,
  ]) {
    assert.doesNotMatch(source, /isRu|isRussian|i18n\.language/);
  }
  assert.match(generationDiagnosticsSource, /generationDiagnostics\.ui\.overview/);
  assert.match(performanceDiagnosticsSource, /performanceDiagnostics\.ui\.overview/);
  assert.match(selectorDiagnosticsSource, /selectorDiagnostics\.ui\.overview/);
});

scenario("diagnostic sizes and durations do not leak English-only units", () => {
  assert.doesNotMatch(generationDiagnosticsSource, /`\$\{[^`]+\} chars`|toFixed\(1\)\} sec/);
  assert.doesNotMatch(performanceDiagnosticsSource, />\{formatCount\([^}]+\)\} chars</);
  assert.match(generationDiagnosticsSource, /generationDiagnostics\.characters/);
  assert.match(performanceDiagnosticsSource, /performanceDiagnostics\.seconds/);
});

scenario("Task Pack Builder status and rules labels use localized workspace copy", () => {
  assert.doesNotMatch(taskPackBuilderSource, /eyebrow="Rules & Templates"/);
  assert.doesNotMatch(taskPackBuilderSource, /contextSummary\.status === "ready" \? "ready" : "review"/);
  assert.match(taskPackBuilderSource, /workspaceText\("rulesModal\.eyebrow"\)/);
  assert.match(taskPackBuilderSource, /workspaceText\("context\.ready"\)/);
});

scenario("Storage Settings uses central catalog with truthful raw fallbacks", () => {
  assert.match(settingsSource, /storageSettings\.header\.title/);
  assert.match(settingsSource, /storageSettings\.status/);
  assert.match(settingsSource, /defaultValue:/);
  assert.doesNotMatch(settingsSource, /function copy\(english: string, russian: string\)/);
  assert.ok((translationsSource.match(/\bstorageSettings:/g)?.length ?? 0) >= 2);
});

scenario("workspace disclosure remains accessible and motion-safe", () => {
  assert.match(disclosureSource, /aria-expanded=\{isOpen\}/);
  assert.match(disclosureSource, /aria-controls=\{contentId\}/);
  assert.match(disclosureSource, /focus-visible:/);
  assert.match(disclosureSource, /useReducedMotion\(\)/);
  assert.match(disclosureSource, /motion-reduce:transition-none/);
});

scenario("workspace side panels honor reduced motion", () => {
  for (const source of reducedMotionPanels) {
    assert.match(source, /useReducedMotion/);
    assert.match(source, /prefersReducedMotion \? false/);
    assert.match(source, /prefersReducedMotion\s*\? \{ duration: 0 \}/);
  }
});

scenario("first-run onboarding is a localized motion-safe dialog", () => {
  assert.match(onboardingSource, /role="dialog"/);
  assert.match(onboardingSource, /aria-modal="true"/);
  assert.match(onboardingSource, /onboarding\.dialogLabel/);
  assert.match(onboardingSource, /MotionConfig reducedMotion="user"/);
  assert.match(onboardingSource, /event\.key !== "Tab"/);
  assert.match(onboardingSource, /window\.removeEventListener\("keydown", keepFocusInside, true\)/);
  assert.ok((translationsSource.match(/dialogLabel:/g)?.length ?? 0) >= 2);
});

scenario("Command Palette and Global Search remain distinct and exclusive", () => {
  assert.match(commandPaletteSource, /navigationAssistant/);
  assert.match(globalSearchSource, /globalSearch/);
  assert.match(dashboardSource, /isGlobalSearchOpen[\s\S]{0,220}setIsCommandPaletteOpen\(true\)/);
  assert.match(dashboardSource, /isCommandPaletteOpen[\s\S]{0,220}setIsGlobalSearchOpen\(true\)/);
});

scenario("titlebar keeps Add Project reachable at narrow effective widths", () => {
  assert.match(titlebarSource, /aria-label=\{isLoading \? t\("common\.scanning"\) : t\("common\.addProject"\)\}/);
  assert.match(titlebarSource, /mr-1 inline-flex size-8/);
  assert.match(titlebarSource, /hidden md:inline/);
  assert.doesNotMatch(titlebarSource, /mr-2 hidden h-8 items-center[\s\S]{0,300}common\.addProject/);
});

scenario("zoom animation and global drop listeners clean up", () => {
  assert.match(zoomSource, /window\.cancelAnimationFrame/);
  assert.match(zoomSource, /window\.removeEventListener\("wheel"/);
  assert.match(zoomSource, /prefersReducedMotion/);
  assert.match(dropGuardSource, /window\.removeEventListener\("dragover"/);
  assert.match(dropGuardSource, /window\.removeEventListener\("drop"/);
});

scenario("Electron bridges remain isolated and purpose-specific", () => {
  assert.match(electronMainSource, /contextIsolation: true/);
  assert.match(electronMainSource, /nodeIntegration: false/);
  assert.match(preloadSource, /webUtils\.getPathForFile\(file\)/);
  assert.match(preloadSource, /workspaceZoom:\s*\{/);
  assert.doesNotMatch(preloadSource, /exposeInMainWorld\([^,]+,\s*(ipcRenderer|webFrame|fs|shell)\b/);
});

scenario("obsolete navigation assistant is not mounted by reachable renderer code", () => {
  const rendererRoot = path.join(repositoryRoot, "apps/desktop/renderer/src");
  const legacyPath = path.join(
    rendererRoot,
    "components/modals/NavigationAssistantModal.tsx",
  );
  const references: string[] = [];

  for (const entry of fs.readdirSync(rendererRoot, { recursive: true })) {
    const absolutePath = path.join(rendererRoot, String(entry));
    if (absolutePath === legacyPath || !absolutePath.endsWith(".tsx")) continue;
    if (fs.statSync(absolutePath).isFile()) {
      const source = fs.readFileSync(absolutePath, "utf8");
      if (source.includes("NavigationAssistantModal")) references.push(absolutePath);
    }
  }

  assert.deepEqual(references, []);
});

process.stdout.write(`Final UI audit smoke passed: ${scenarios} scenarios.\n`);
