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

const disclosureSource = read("apps/desktop/renderer/src/components/workspace/WorkspaceDisclosure.tsx");
const composerSource = read("apps/desktop/renderer/src/pages/ContextComposerPage.tsx");
const enginePanelSource = read("apps/desktop/renderer/src/components/contextComposer/ContextComposerEnginePanel.tsx");
const basketSource = read("apps/desktop/renderer/src/components/contextComposer/ContextBasketPanel.tsx");
const lensSource = read("apps/desktop/renderer/src/components/workspace/ExplainabilityLensPanel.tsx");
const dashboardSource = read("apps/desktop/renderer/src/pages/DashboardPage.tsx");
const translationsSource = read("apps/desktop/renderer/src/i18n/index.ts");

scenario("workspace disclosure exposes accessible expanded state", () => {
  assert.match(disclosureSource, /aria-expanded=\{isOpen\}/);
  assert.match(disclosureSource, /aria-controls=\{contentId\}/);
  assert.match(disclosureSource, /useReducedMotion\(\)/);
});

scenario("Composer blocking review remains before engine diagnostics", () => {
  const blockingReview = composerSource.indexOf('preview.selectionQuality.status !== "ready"');
  const enginePanel = composerSource.indexOf("<ContextComposerEnginePanel", blockingReview);
  assert.ok(blockingReview >= 0);
  assert.ok(enginePanel > blockingReview);
});

scenario("Composer disclosure controls expose their content relationships", () => {
  for (const contentId of [
    "context-composer-review-technical-details",
    "context-composer-summary-warnings",
    "context-composer-details",
  ]) {
    assert.match(composerSource, new RegExp(`aria-controls="${contentId}"`), contentId);
    assert.match(composerSource, new RegExp(`id="${contentId}"`), contentId);
  }
});

scenario("engine warnings reveal technical evidence while healthy details collapse", () => {
  assert.match(enginePanelSource, /defaultOpen=\{warning\}/);
  assert.match(enginePanelSource, /revealWhen=\{warning\}/);
  assert.match(enginePanelSource, /tone=\{blocked \? "blocking" : warning \? "attention" : "neutral"\}/);
});

scenario("Context Basket keeps files primary and discloses snippets secondarily", () => {
  const filesTitle = basketSource.indexOf('t("contextComposerPage.basket.filesTitle")');
  const snippetsDisclosure = basketSource.indexOf("<WorkspaceDisclosure", filesTitle);
  assert.ok(filesTitle >= 0);
  assert.ok(snippetsDisclosure > filesTitle);
  assert.match(basketSource.slice(snippetsDisclosure), /contextComposerPage\.basket\.snippetsTitle/);
});

scenario("Explainability result stays visible and deep traces use disclosure", () => {
  const resultSection = lensSource.indexOf('title={t("explainability.resultState")}');
  const diffSection = lensSource.indexOf('title={t("explainability.contextDiff")}');
  const timelineSection = lensSource.indexOf('title={t("explainability.investigationTimeline")}');
  assert.ok(resultSection >= 0 && diffSection > resultSection && timelineSection > diffSection);
  assert.doesNotMatch(lensSource.slice(resultSection, diffSection), /collapsible/);
  assert.match(lensSource.slice(diffSection, timelineSection), /collapsible/);
  assert.match(lensSource.slice(timelineSection, lensSource.indexOf('title={t("explainability.limitations")}', timelineSection)), /collapsible/);
});

scenario("Explainability limitations and questions reveal when actionable", () => {
  assert.match(lensSource, /revealWhen=\{view\.limitations\.length > 0\}/);
  assert.match(lensSource, /revealWhen=\{view\.unresolvedQuestions\.length > 0\}/);
});

scenario("new hierarchy labels are synchronized in English and Russian", () => {
  for (const key of [
    "timelineSummary",
    "contextDiffSummary",
    "limitationsSummary",
    "unresolvedQuestionsSummary",
    "contextFilesSummary",
    "composerEngineTechnicalDetails",
  ]) {
    assert.equal(translationsSource.match(new RegExp(`\\b${key}:`, "g"))?.length, 2, key);
  }
});

scenario("existing workspace auxiliary components remain wired", () => {
  for (const component of [
    "QuickPeekPanel",
    "PersistentInspectorPanel",
    "ExplainabilityLensPanel",
    "ContextMapPanel",
  ]) {
    assert.match(dashboardSource, new RegExp(`<${component}\\b`), component);
  }
  assert.match(composerSource, /<ContextBasketPanel\b/);
});

process.stdout.write(`Workspace hierarchy smoke passed: ${scenarios} scenarios.\n`);
