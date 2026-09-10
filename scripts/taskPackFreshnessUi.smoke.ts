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

const derivationSource = read(
  "apps/desktop/renderer/src/utils/taskPackFreshness.ts",
);
const componentSource = read(
  "apps/desktop/renderer/src/components/taskPacks/TaskPackFreshness.tsx",
);
const taskPacksPageSource = read(
  "apps/desktop/renderer/src/pages/TaskPacksPage.tsx",
);
const resultPageSource = read(
  "apps/desktop/renderer/src/pages/TaskPackResultPage.tsx",
);
const projectDetailsSource = read(
  "apps/desktop/renderer/src/pages/ProjectDetailsPage.tsx",
);
const dashboardSource = read(
  "apps/desktop/renderer/src/pages/DashboardHomePage.tsx",
);
const quickPeekSource = read(
  "apps/desktop/renderer/src/components/workspace/QuickPeekPanel.tsx",
);
const translationsSource = read("apps/desktop/renderer/src/i18n/index.ts");

scenario("Task Pack list consumes the central freshness model", () => {
  assert.match(taskPacksPageSource, /freshnessByTaskPackId/);
  assert.match(taskPacksPageSource, /<TaskPackFreshnessBadge/);
  assert.match(taskPacksPageSource, /<TaskPackFreshnessNotice/);
});

scenario("affected and review states expose a project-change action", () => {
  assert.match(componentSource, /shouldOfferReview/);
  assert.match(componentSource, /taskPackFreshness\.reviewChanges/);
  assert.match(componentSource, /freshness\.status === "affected"/);
});

scenario("unknown freshness is never labeled stale", () => {
  assert.doesNotMatch(componentSource, />\s*Stale\s*</i);
  assert.doesNotMatch(translationsSource, /taskPackFreshness[\s\S]{0,120}\bstale\b/i);
  assert.match(translationsSource, /unknown: "Freshness unknown"/);
});

scenario("limited comparison cannot expose complete affected-file claims", () => {
  assert.match(derivationSource, /"review_recommended",\s*"comparison_limited"/);
  assert.match(derivationSource, /affectedPaths: string\[\]/);
});

scenario("Task Pack result surfaces freshness before reuse or export", () => {
  assert.match(resultPageSource, /<TaskPackFreshnessBadge/);
  assert.match(resultPageSource, /<TaskPackFreshnessNotice/);
});

scenario("Project Awareness exposes impacted Task Packs progressively", () => {
  assert.match(projectDetailsSource, /<ProjectTaskPackFreshnessPanel/);
  assert.match(componentSource, /<WorkspaceDisclosure/);
});

scenario("Dashboard and Quick Peek reuse the central presentation state", () => {
  assert.match(dashboardSource, /taskPackReviewCount/);
  assert.match(dashboardSource, /<TaskPackFreshnessBadge/);
  assert.match(quickPeekSource, /<TaskPackFreshnessNotice/);
});

scenario("Russian and English freshness keys stay synchronized", () => {
  for (const key of [
    "taskPackFreshness",
    "review_recommended",
    "removed_context_path_one",
    "comparison_limited",
    "no_comparison_baseline",
    "analysis_inside_observation_interval",
    "reviewChanges",
    "projectPanel",
  ]) {
    assert.ok(
      (translationsSource.match(new RegExp(`\\b${key}:`, "g"))?.length ?? 0) >= 2,
      key,
    );
  }
});

process.stdout.write(`Task Pack freshness UI smoke passed: ${scenarios} scenarios.\n`);
