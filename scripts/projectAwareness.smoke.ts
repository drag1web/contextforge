import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repositoryRoot = process.cwd();

function read(relativePath: string) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}

let scenarios = 0;

function scenario(name: string, run: () => void) {
  run();
  scenarios += 1;
  process.stdout.write(`PASS ${name}\n`);
}

const scannerSource = read("server/src/scanner/projectScanner.ts");
const awarenessSource = read("server/src/projects/projectAwareness.ts");
const routeSource = read("server/src/routes/projects.ts");
const typesSource = read("apps/desktop/renderer/src/types/index.ts");
const awarenessPanelSource = read(
  "apps/desktop/renderer/src/components/projects/ProjectAwarenessPanel.tsx",
);
const projectCardSource = read(
  "apps/desktop/renderer/src/components/projects/ProjectCard.tsx",
);
const projectDetailsSource = read(
  "apps/desktop/renderer/src/pages/ProjectDetailsPage.tsx",
);
const quickPeekSource = read(
  "apps/desktop/renderer/src/components/workspace/QuickPeekPanel.tsx",
);
const dashboardSource = read(
  "apps/desktop/renderer/src/pages/DashboardHomePage.tsx",
);
const translationsSource = read("apps/desktop/renderer/src/i18n/index.ts");

scenario("ordinary project scan exposes an exact bounded observation", () => {
  assert.match(scannerSource, /export interface ProjectScanObservation/);
  assert.match(scannerSource, /filePaths: \[\.\.\.inventory\.files\]/);
  assert.match(scannerSource, /inventoryTruncated: inventory\.truncated/);
});

scenario("project awareness is persisted locally per project", () => {
  assert.match(awarenessSource, /project-awareness\.v\$\{PROJECT_AWARENESS_VERSION\}\.\$\{projectId\}/);
  assert.match(awarenessSource, /storage\.getSettingValue/);
  assert.match(awarenessSource, /storage\.setSettingValue/);
});

scenario("project routes record scans and expose allowlisted awareness", () => {
  assert.match(routeSource, /recordProjectAwareness/);
  assert.match(routeSource, /readProjectAwareness/);
  assert.match(routeSource, /projects\.map\(withProjectAwareness\)/);
});

scenario("renderer project payload remains compatible when awareness is absent", () => {
  assert.match(typesSource, /awareness\?: ProjectAwareness \| null/);
  assert.match(awarenessPanelSource, /unavailableDescription/);
  assert.match(awarenessPanelSource, /firstDescription/);
});

scenario("project details uses progressive disclosure for exact changes", () => {
  assert.match(projectDetailsSource, /<ProjectAwarenessPanel project=\{project\}/);
  assert.match(awarenessPanelSource, /<WorkspaceDisclosure/);
  assert.match(awarenessPanelSource, /fileChanges\?\.added/);
  assert.match(awarenessPanelSource, /fileChanges\?\.removed/);
});

scenario("compact project awareness is integrated without a Dashboard redesign", () => {
  assert.match(projectCardSource, /<ProjectAwarenessSummary/);
  assert.match(quickPeekSource, /<ProjectAwarenessSummary/);
  assert.match(dashboardSource, /<ProjectAwarenessSummary/);
});

scenario("file-content modification is not fabricated", () => {
  assert.doesNotMatch(awarenessSource, /\bmodified\b/i);
  assert.match(awarenessPanelSource, /scopeNote/);
});

scenario("Project Awareness localization is synchronized", () => {
  for (const key of [
    "projectAwareness",
    "unavailableDescription",
    "firstDescription",
    "limitedDescription",
    "changedSummary",
    "unchangedSummary",
    "scopeNote",
  ]) {
    assert.ok(
      (translationsSource.match(new RegExp(`\\b${key}:`, "g"))?.length ?? 0) >= 2,
      key,
    );
  }
});

process.stdout.write(`Project Awareness UI smoke passed: ${scenarios} scenarios.\n`);
