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

const composerSource = read("apps/desktop/renderer/src/pages/ContextComposerPage.tsx");
const contextFilesSource = read("apps/desktop/renderer/src/components/contextComposer/contextFiles/ContextFilesWorkspace.tsx");
const quickPeekSource = read("apps/desktop/renderer/src/components/workspace/QuickPeekPanel.tsx");
const inspectorSource = read("apps/desktop/renderer/src/components/workspace/PersistentInspectorPanel.tsx");
const contextMapSource = read("apps/desktop/renderer/src/components/workspace/ContextMapPanel.tsx");
const projectsSource = read("apps/desktop/renderer/src/components/projects/ProjectsSection.tsx");
const controllerSource = read("apps/desktop/renderer/src/hooks/useDashboardController.ts");
const guardSource = read("apps/desktop/renderer/src/hooks/useGlobalDropNavigationGuard.ts");
const preloadSource = read("apps/desktop/electron/preload.cjs");
const mainSource = read("apps/desktop/electron/main.cjs");
const translationsSource = read("apps/desktop/renderer/src/i18n/index.ts");

scenario("Context Basket accepts only the typed project-file payload", () => {
  assert.match(composerSource, /readContextForgeDragPayload\(event\.dataTransfer\)/);
  assert.match(composerSource, /classifyContextBasketDrop\(/);
  assert.match(composerSource, /data-contextforge-drop-target="context-basket-project-file"/);
});

scenario("unknown dropped files are inventory-validated before state mutation", () => {
  const dropHandler = composerSource.slice(
    composerSource.indexOf("async function addProjectFileFromDrop"),
    composerSource.indexOf("function handleBasketDragEnter"),
  );
  assert.ok(dropHandler.indexOf("readContextComposerFileSnippet") >= 0);
  assert.ok(dropHandler.indexOf("readContextComposerFileSnippet") < dropHandler.indexOf("setExtraFiles"));
  assert.match(dropHandler, /projectId: preview\.project\.id/);
});

scenario("known files reuse include behavior and duplicates never toggle off", () => {
  assert.match(composerSource, /classification\.status === "known-file"[\s\S]{0,180}includeKnownFile/);
  assert.match(composerSource, /classification\.status === "already-selected"/);
  assert.match(composerSource, /async function addFileFromSearch[\s\S]{0,220}includeKnownFile/);
});

scenario("grounded file surfaces expose explicit compact drag handles", () => {
  for (const source of [contextFilesSource, quickPeekSource, inspectorSource, contextMapSource]) {
    assert.match(source, /ProjectFileDragHandle/);
    assert.match(source, /projectId=/);
  }
});

scenario("basket drag state is bounded and clears on leave drop and drag end", () => {
  assert.match(composerSource, /basketDragDepthRef/);
  assert.match(composerSource, /window\.addEventListener\("dragend", clearDragState\)/);
  assert.match(composerSource, /window\.addEventListener\("drop", clearDragState\)/);
  assert.match(composerSource, /handleBasketDragLeave/);
});

scenario("unsupported file drops cannot navigate the renderer", () => {
  assert.match(guardSource, /event\.preventDefault\(\)/);
  assert.match(guardSource, /event\.dataTransfer\.dropEffect = "none"/);
  assert.match(guardSource, /onUnsupportedDrop\(\)/);
  assert.doesNotMatch(guardSource, /text\/html|getData/);
});

scenario("project folders use webUtils and main-process directory validation", () => {
  assert.match(preloadSource, /webUtils\.getPathForFile\(file\)/);
  assert.match(preloadSource, /drop:resolve-project-folder/);
  assert.match(mainSource, /fs\.promises\.stat\(resolvedPath\)/);
  assert.match(mainSource, /stats\.isDirectory\(\)/);
  assert.match(projectsSource, /webkitGetAsEntry/);
});

scenario("folder drop and dialog selection share Add Project registration", () => {
  assert.match(controllerSource, /async function addProjectFromPath/);
  assert.match(controllerSource, /handleSelectProject[\s\S]{0,240}addProjectFromPath\(selectedPath\)/);
  assert.match(controllerSource, /handleDropProjectFolder[\s\S]{0,360}addProjectFromPath\(selectedPath\)/);
  assert.match(controllerSource, /const project = await addProject\(selectedPath\)/);
});

scenario("project drop UI distinguishes valid hover from invalid feedback", () => {
  assert.match(projectsSource, /getSingleDroppedDirectory/);
  assert.match(projectsSource, /dropEffect =[\s\S]{0,140}\? "copy"[\s\S]{0,40}: "none"/);
  assert.match(projectsSource, /dragAndDrop\.invalidProjectFolder/);
  assert.match(projectsSource, /data-contextforge-drop-target="project-folder"/);
});

scenario("click and keyboard alternatives remain present", () => {
  assert.match(contextFilesSource, /onClick=\{onToggle\}/);
  assert.match(projectsSource, /onClick=\{onAddProject\}/);
  assert.match(composerSource, /onClick=\{\(\) => setIsContextBasketOpen\(true\)\}/);
});

scenario("Electron isolation remains enabled", () => {
  assert.match(mainSource, /contextIsolation: true/);
  assert.match(mainSource, /nodeIntegration: false/);
  assert.doesNotMatch(preloadSource, /require\("node:fs"\)/);
});

scenario("English and Russian drag-and-drop copy stays synchronized", () => {
  for (const key of [
    "dragAndDrop",
    "dragFileToBasket",
    "releaseToAdd",
    "wrongProject",
    "invalidProjectFolder",
    "unsupportedDrop",
  ]) {
    assert.ok(
      (translationsSource.match(new RegExp(`\\b${key}:`, "g"))?.length ?? 0) >= 2,
      key,
    );
  }
});

process.stdout.write(`Drag and Drop UI smoke passed: ${scenarios} scenarios.\n`);
