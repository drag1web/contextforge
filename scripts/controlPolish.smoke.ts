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

const switchSource = read("apps/desktop/renderer/src/components/ui/Switch.tsx");
const desktopExperienceSource = read(
  "apps/desktop/renderer/src/components/settings/DesktopExperiencePanel.tsx",
);
const mcpSource = read(
  "apps/desktop/renderer/src/components/integrations/McpIntegrationPanel.tsx",
);
const shortcutEditorSource = read(
  "apps/desktop/renderer/src/components/settings/KeyboardShortcutEditor.tsx",
);
const slidingSelectorSource = read(
  "apps/desktop/renderer/src/components/ui/SlidingSelectors.tsx",
);
const taskUnderstandingSource = read(
  "apps/desktop/renderer/src/components/modals/TaskUnderstandingModal.tsx",
);
const loadingOverlaySource = read(
  "apps/desktop/renderer/src/components/ui/LoadingOverlay.tsx",
);
const dropdownSource = read(
  "apps/desktop/renderer/src/components/ui/DropdownMenu.tsx",
);
const onboardingSource = read(
  "apps/desktop/renderer/src/components/onboarding/FirstRunOnboardingOverlay.tsx",
);
const aiToolLogoSource = read(
  "apps/desktop/renderer/src/components/ai/AiToolLogo.tsx",
);
const contextFileLabelsSource = read(
  "apps/desktop/renderer/src/utils/contextFileLabels.ts",
);
const contextMapSource = read(
  "apps/desktop/renderer/src/components/workspace/ContextMapPanel.tsx",
);
const taskPackBuilderSource = read(
  "apps/desktop/renderer/src/pages/TaskPackBuilderPage.tsx",
);
const translationsSource = read("apps/desktop/renderer/src/i18n/index.ts");
const shortcutRegistrySource = read(
  "apps/desktop/renderer/src/config/keyboardShortcuts.ts",
);

scenario("shared Switch exposes accessible state and disabled semantics", () => {
  assert.match(switchSource, /role="switch"/);
  assert.match(switchSource, /aria-checked=\{checked\}/);
  assert.match(switchSource, /aria-label=\{label\}/);
  assert.match(switchSource, /data-state=\{checked \? "checked" : "unchecked"\}/);
  assert.match(switchSource, /disabled=\{disabled\}/);
});

scenario("shared Switch has visible focus and reduced-motion treatment", () => {
  assert.match(switchSource, /focus-visible:/);
  assert.match(switchSource, /motion-reduce:transition-none/);
  assert.doesNotMatch(switchSource, /emerald|rose|blue|cyan/);
});

scenario("desktop and MCP preferences reuse one Switch language", () => {
  assert.match(desktopExperienceSource, /import \{ Switch \}/);
  assert.match(mcpSource, /import \{ Switch \}/);
  assert.doesNotMatch(desktopExperienceSource, /function DesktopToggle/);
  assert.doesNotMatch(mcpSource, /function Toggle/);
});

scenario("multi-option selectors retain pressed-state semantics", () => {
  assert.ok((slidingSelectorSource.match(/aria-pressed=\{isActive\}/g)?.length ?? 0) >= 2);
  assert.match(slidingSelectorSource, /role="group"/);
});

scenario("desktop and shortcut settings use central i18n", () => {
  assert.doesNotMatch(desktopExperienceSource, /isRussian|const copy/);
  assert.doesNotMatch(shortcutEditorSource, /isRussian|const copy/);
  assert.match(desktopExperienceSource, /desktopExperience\.preferenceToggle/);
  assert.match(shortcutEditorSource, /keyboardShortcutEditor\.conflict/);
});

scenario("stable task-understanding enums are formatted before display", () => {
  for (const rawExpression of [
    "understanding.readiness}</DetailPill>",
    "understanding.action}</DetailPill>",
    "understanding.interpretationRisk}</DetailPill>",
    "understanding.changeDefinition}</DetailPill>",
  ]) {
    assert.ok(!taskUnderstandingSource.includes(rawExpression), rawExpression);
  }
  assert.match(taskUnderstandingSource, /getTechnicalValueLabel/);
  assert.match(taskUnderstandingSource, /getTechnicalValueLabel\("targetKind", target\.kind, t\)/);
  assert.match(taskUnderstandingSource, /getTechnicalValueLabel\("valueKind", item\.kind, t\)/);
});

scenario("context file formatters are allowlisted and preserve unknown values", () => {
  assert.match(contextFileLabelsSource, /FILE_KIND_KEYS/);
  assert.match(contextFileLabelsSource, /FILE_USAGE_KEYS/);
  assert.match(contextFileLabelsSource, /return key \? t\(.+\) : kind/);
  assert.match(contextFileLabelsSource, /return key \? t\(.+\) : usage/);
  assert.doesNotMatch(contextMapSource, />\{item\.contextFile\.role\}<\/MapBadge>/);
  assert.match(taskPackBuilderSource, /formatContextFileKind\(file\.kind/);
  assert.doesNotMatch(taskPackBuilderSource, /caption="inspect \+ reference"|caption="task intent"/);
});

scenario("loading and dropdown shell copy no longer hardcode English", () => {
  assert.doesNotMatch(loadingOverlaySource, /"Generating Task Pack"|"Analyze task"|Local models can take/);
  assert.match(loadingOverlaySource, /loadingOverlay\.stages/);
  assert.doesNotMatch(dropdownSource, /aria-label="Close menu"|= "More actions"/);
  assert.match(dropdownSource, /common\.closeMenu/);
});

scenario("generic AI icon tooltip uses localized product copy", () => {
  assert.doesNotMatch(aiToolLogoSource, /title="Generic AI agent"/);
  assert.match(aiToolLogoSource, /settings\.targetTool\.generic/);
});

scenario("first-run onboarding consumes synchronized translations", () => {
  assert.match(onboardingSource, /useTranslation\(\)/);
  assert.match(onboardingSource, /onboarding\.tour\.steps/);
  assert.match(onboardingSource, /onboarding\.actions\.enterDashboard/);
  assert.doesNotMatch(onboardingSource, />First-run guide|>Workspace ready|>Back\s*</);
});

scenario("new control and onboarding namespaces exist in English and Russian", () => {
  for (const key of [
    "desktopExperience",
    "keyboardShortcutEditor",
    "loadingOverlay",
    "contextFile",
    "onboarding",
    "projectsDetected_one",
    "preferenceToggle",
  ]) {
    assert.ok(
      (translationsSource.match(new RegExp(`\\b${key}:`, "g"))?.length ?? 0) >= 2,
      key,
    );
  }
});

scenario("workspace shortcut identities remain unchanged", () => {
  for (const id of [
    "navigationAssistant",
    "globalSearch",
    "toggleFocusMode",
    "zoomIn",
    "zoomOut",
    "zoomReset",
  ]) {
    assert.match(shortcutRegistrySource, new RegExp(`id: "${id}"`), id);
  }
});

scenario("settings enum transport values remain literal contract values", () => {
  const settingsSource = read("apps/desktop/renderer/src/pages/SettingsPage.tsx");
  for (const value of [
    'value: "adaptive"',
    'value: "comfortable"',
    'value: "compact"',
    'value: "manual"',
    'value: "automatic"',
  ]) {
    assert.ok(settingsSource.includes(value), value);
  }
  assert.match(settingsSource, /settings\.workspaceDensityAdaptive/);
  assert.match(settingsSource, /settings\.focusModeManual/);
});

process.stdout.write(`Control and localization polish smoke passed: ${scenarios} scenarios.\n`);
