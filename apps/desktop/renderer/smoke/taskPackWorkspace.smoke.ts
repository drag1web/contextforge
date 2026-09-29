import assert from "node:assert/strict";
import fs from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TaskPackDocumentView } from "../src/components/taskPacks/TaskPackDocumentView";
import { TaskPackDetailsView } from "../src/components/taskPacks/TaskPackDetailsView";
import { TaskPackFreshnessNotice } from "../src/components/taskPacks/TaskPackFreshness";
import { TaskPackWorkflowCard, TaskPackWorkflowBadges } from "../src/components/taskPacks/TaskPackWorkflowCard";
import { TASK_PACK_WORKSPACE_VIEWS } from "../src/components/taskPacks/TaskPackWorkspaceHeader";
import type { TaskPack, TaskPackWorkflowState } from "../src/types";
import type { TaskPackFreshness } from "../src/utils/taskPackFreshness";
import i18n from "../src/i18n";

let scenarios = 0;
function scenario(name: string, run: () => void) { run(); scenarios++; process.stdout.write(`PASS ${name}\n`); }
const source = (file: string) => fs.readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
const page = source("pages/TaskPackResultPage.tsx");
const header = source("components/taskPacks/TaskPackWorkspaceHeader.tsx");
const documentView = source("components/taskPacks/TaskPackDocumentView.tsx");
const detailsView = source("components/taskPacks/TaskPackDetailsView.tsx");
const reviewView = source("components/taskPacks/TaskPackWorkflowCard.tsx");
const dropdown = source("components/ui/DropdownMenu.tsx");
const hook = source("hooks/useTaskPackWorkflow.ts");
const pack: TaskPack = { id: 7, currentRevisionId: 16, projectId: 2, projectName: "Fixture project",
  title: "Fixture pack", rawTask: "ORIGINAL_AUTHOR_REQUEST", generatedPrompt: "# GENERATED_DOCUMENT\n\n**Exact Markdown**",
  taskType: "general", targetTool: "generic", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
const current: TaskPackFreshness = { taskPackId: 7, projectId: 2, status: "current", reason: "known_state_unchanged",
  selectedPaths: [], affectedPaths: [], createdAt: pack.createdAt, previousObservedAt: null, currentObservedAt: null };
const state: TaskPackWorkflowState = { taskPackId: 7, currentRevisionId: 16, acceptedRevisionId: null,
  lifecycle: { state: "active", archivedFromState: null }, lifecycleVersion: 782391,
  currentReviewState: "unreviewed", completedAt: null, archivedAt: null };
let callbacks = 0;
const action = () => { callbacks++; };
const renderDocument = (freshness = current, canEdit = true, viewMode: "preview" | "raw" = "preview") => renderToStaticMarkup(createElement(TaskPackDocumentView, {
  taskPack: pack, freshness, onReviewProject: action, onEdit: action, canEdit, editExplanation: canEdit ? "" : "EDIT_BLOCKED",
  viewMode, onViewModeChange: action,
}));
const renderDetails = (canEdit = true, taskPack = pack) => renderToStaticMarkup(createElement(TaskPackDetailsView, {
  taskPack, freshness: current, onReviewProject: action, onEditOriginal: action, onOpenGitHubUrl: action,
  canEdit, editExplanation: canEdit ? "" : "EDIT_BLOCKED",
}));
const renderReview = (workflow = state, blocked = false) => renderToStaticMarkup(createElement(TaskPackWorkflowCard, {
  workflow, loading: false, refreshing: false, activeAction: null, issue: null, blocked,
  onRefresh: async () => { action(); }, onExecute: async () => { action(); }, onClearIssue: action,
}));

await i18n.changeLanguage("en");
scenario("workspace has exactly Document, Review, Details and defaults to Document", () => {
  assert.deepEqual(TASK_PACK_WORKSPACE_VIEWS, ["document", "review", "details"]);
  assert.match(page, /useState<TaskPackWorkspaceView>\("document"\)/);
  assert.match(page, /setWorkspaceView\("document"\); \}, \[taskPack.id\]/);
});
scenario("Document renders real Markdown and compact local exports", () => {
  const html = renderDocument();
  assert.match(html, /<h1>GENERATED_DOCUMENT<\/h1>/);
  assert.match(html, /<strong>Exact Markdown<\/strong>/);
  assert.match(html, /\.md/); assert.match(html, /\.txt/);
  assert.match(html, /Only saved in ContextForge|local/i);
});
scenario("raw document preserves Markdown instead of rendering headings", () => {
  const html = renderDocument(current, true, "raw");
  assert.match(html, /# GENERATED_DOCUMENT/); assert.match(html, /\*\*Exact Markdown\*\*/);
  assert.doesNotMatch(html, /<h1>GENERATED_DOCUMENT/);
});
scenario("Document uses short workspace-specific labels without truncation", () => {
  const html = renderDocument();
  assert.match(html, />Preview<\/span>/); assert.match(html, />Markdown<\/span>/);
  assert.match(documentView, /taskPackWorkspace\.preview/);
  assert.match(documentView, /taskPackWorkspace\.markdown/);
  assert.doesNotMatch(documentView, /taskPackResult\.(?:preview|rawMarkdown)|truncate|text-ellipsis/);
});
scenario("Document has no permanent metadata or workflow controls", () => {
  const html = renderDocument();
  assert.doesNotMatch(documentView, /GenerationSummaryCard|OriginalTaskCard|GenerationContractCard|TaskPackWorkflowCard|lifecycleVersion/);
  assert.doesNotMatch(html, /ORIGINAL_AUTHOR_REQUEST|Start review|Accept<|Lifecycle|782391/);
  assert.doesNotMatch(page, /xl:grid-cols-\[340px|<aside className="min-h-0 space-y-3/);
});
scenario("current freshness adds no document warning", () => {
  assert.doesNotMatch(renderDocument(), /data-task-pack-freshness-notice/);
});
for (const freshness of [
  { ...current, status: "unknown", reason: "no_awareness" },
  { ...current, status: "review_recommended", reason: "comparison_limited" },
  { ...current, status: "affected", reason: "removed_context_path", affectedPaths: ["src/example.ts"] },
] as TaskPackFreshness[]) scenario(`${freshness.status} freshness remains before generated content and export`, () => {
  const html = renderDocument(freshness);
  const notice = html.indexOf(`data-task-pack-freshness-notice="${freshness.status}"`);
  assert.ok(notice >= 0 && notice < html.indexOf("GENERATED_DOCUMENT"));
  assert.ok(notice < html.indexOf('aria-label=".md"'));
  assert.match(documentView, /TaskPackFreshnessNotice compact/);
  if (freshness.status === "affected") assert.match(html, /src\/example.ts/);
});
scenario("Document Edit is disabled with an explanation when authority is unavailable", () => {
  assert.match(renderDocument(current, false), /disabled="" title="EDIT_BLOCKED"/);
  assert.match(renderDocument(current, false), />EDIT_BLOCKED<\/p>/);
  assert.doesNotMatch(renderDocument(), /EDIT_BLOCKED/);
});
scenario("quiet unknown freshness keeps its status/reason, while actionable notices stay unchanged", () => {
  const unknown: TaskPackFreshness = { ...current, status: "unknown", reason: "no_awareness" };
  const renderNotice = (freshness: TaskPackFreshness, quietUnknown?: boolean) => renderToStaticMarkup(createElement(TaskPackFreshnessNotice, {
    freshness, quietUnknown, onReviewProject: action,
  }));
  const quiet = renderNotice(unknown, true), normal = renderNotice(unknown);
  assert.match(quiet, /data-task-pack-freshness-notice="unknown"/);
  const text = (html: string) => html.replace(/<[^>]*>/g, "");
  assert.equal(text(quiet), text(normal));
  assert.notEqual(quiet, normal); // presentation opt-in only, not a new semantic state
  assert.doesNotMatch(quiet, /class="[^"]*\bborder\b/);
  assert.equal(normal, renderNotice(unknown, false));
  for (const status of ["affected", "review_recommended", "current"] as const) {
    const freshness = { ...current, status };
    assert.equal(renderNotice(freshness, true), renderNotice(freshness));
  }
});
scenario("Review owns review and lifecycle actions, no generation metadata", () => {
  const html = renderReview();
  for (const text of ["Start review", "Accept", "Archive", "Current revision", "#16"]) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /ORIGINAL_AUTHOR_REQUEST|GENERATED_DOCUMENT|782391|Lifecycle version/);
  assert.match(page, /data-task-pack-view="review"[\s\S]*?<TaskPackWorkflowCard/);
});
scenario("Review explains two distinct concepts without invented history", () => {
  const html = renderReview();
  assert.match(html, /<section[^>]*aria-label="Revision review"/);
  assert.match(html, /<section[^>]*aria-label="Task Pack lifecycle"/);
  assert.match(html, /Review applies to the current revision/);
  assert.match(html, /Completion is a separate action from acceptance/);
  assert.match(html, /aria-label="Refresh workflow" title="Refresh workflow"/);
  assert.doesNotMatch(html, /2026-|reviewer|timeline|event history/i);
  assert.doesNotMatch(reviewView, /new Date|\.createdAt|\.completedAt|\.archivedAt/);
});
scenario("accepted current revision offers Complete without another review action", () => {
  const html = renderReview({ ...state, currentReviewState: "accepted", acceptedRevisionId: 16 });
  assert.match(html, /Complete/); assert.doesNotMatch(html, /Start review|>Accept<|Request changes/);
});
scenario("previous accepted revision is shown only when different from current", () => {
  assert.match(renderReview({ ...state, acceptedRevisionId: 15 }), /Previously accepted revision/);
  assert.match(renderReview({ ...state, acceptedRevisionId: 15 }), /#15/);
  assert.doesNotMatch(renderReview({ ...state, currentReviewState: "accepted", acceptedRevisionId: 16 }), /Previously accepted revision/);
});
scenario("terminal changes-requested review has no review action", () => {
  assert.doesNotMatch(renderReview({ ...state, currentReviewState: "changes_requested" }), /Start review|>Accept<|Request changes/);
});
for (const lifecycle of [
  { state: "completed", archivedFromState: null },
  { state: "archived", archivedFromState: "completed" },
] as TaskPackWorkflowState["lifecycle"][]) scenario(`${lifecycle.state} exposes its existing lifecycle actions`, () => {
  const html = renderReview({ ...state, lifecycle, currentReviewState: "accepted", acceptedRevisionId: 16 });
  assert.match(html, lifecycle.state === "completed" ? /Reopen/ : /Unarchive/);
  assert.doesNotMatch(html, /Start review|>Accept<|>Complete<|782391/);
});
scenario("blocked Review retains status and disables actions", () => {
  const html = renderReview(state, true);
  assert.match(html, /Unreviewed/); assert.match(html, /disabled=""[^>]*>[\s\S]*?Start review/);
});
scenario("Details contains generation summary, original request, contract and freshness", () => {
  const html = renderDetails();
  assert.match(detailsView, /<GenerationSummaryCard/); assert.match(detailsView, /<OriginalTaskCard/); assert.match(detailsView, /<GenerationContractCard/);
  assert.match(html, /ORIGINAL_AUTHOR_REQUEST/); assert.match(html, /data-task-pack-freshness-notice="current"/);
  assert.doesNotMatch(html, /GENERATED_DOCUMENT|Start review|782391/);
});
scenario("Details original-task editor keeps disabled state and reason", () => {
  const html = renderDetails(false);
  assert.match(html, /disabled="" title="EDIT_BLOCKED"/); assert.match(html, />EDIT_BLOCKED<\/p>/);
});
scenario("Generation Contract is a full-width sibling after the top summary group", () => {
  // Inspect real rendered element nesting, not a particular CSS grid/padding spelling.
  const html = renderDetails();
  const stack: string[] = [];
  let summaryParent: string[] | undefined, contractParent: string[] | undefined;
  for (const match of html.matchAll(/<div\b[^>]*>|<\/div>/g)) {
    const tag = match[0];
    if (tag === "</div>") { stack.pop(); continue; }
    if (tag.includes("data-details-summary")) summaryParent = [...stack];
    if (tag.includes("data-details-contract")) contractParent = [...stack];
    stack.push(tag);
  }
  assert.ok(summaryParent && contractParent);
  assert.deepEqual(contractParent, summaryParent);
  assert.ok(html.indexOf("data-details-contract") > html.indexOf("data-details-summary"));
  assert.match(detailsView, /<div data-details-contract>\s*<GenerationContractCard/);
});
scenario("contract disclosure and complete original request remain available without card scrolling", () => {
  const taskPack: TaskPack = { ...pack, rawTask: "LONG_ORIGINAL_START\n" + "author text ".repeat(200) + "LONG_ORIGINAL_END",
    generationRecipe: { template: null, ruleProfile: null, enabledRules: [], customRules: [],
      acceptanceCriteriaPreset: null, acceptanceCriteria: [], counts: { enabledRules: 0, customRules: 0, acceptanceCriteria: 0 } } };
  const html = renderDetails(true, taskPack);
  assert.ok(html.includes(taskPack.rawTask));
  assert.match(html, /aria-expanded="false"/);
  assert.match(detailsView, /onClick=\{\(\) => setIsExpanded\(\(value\) => !value\)\}/);
  for (const field of ["taskClarifications", "enabledRules", "customRules", "acceptanceCriteria", "githubIssue", "githubCreatedIssue"]) assert.ok(detailsView.includes(`recipe.${field}`));
  assert.doesNotMatch(detailsView, /max-h-|overflow-y-scroll|line-clamp/);
});
scenario("lifecycleVersion stays invisible in all workspace presentation", () => {
  assert.doesNotMatch(header + documentView + detailsView + reviewView, /lifecycleVersion|taskPackWorkflow\.version/);
});
scenario("compact header badges render lifecycle/review only", () => {
  const html = renderToStaticMarkup(createElement(TaskPackWorkflowBadges, { workflow: state }));
  assert.match(html, /Active/); assert.match(html, /Unreviewed/);
  assert.doesNotMatch(html, /Document ready|782391|#16|Freshness/);
  assert.match(header, /<TaskPackWorkflowBadges/);
  assert.match(page, /workflow=\{workflowController.blocked \? null : workflow\}/);
});
scenario("header is quiet and Copy remains its primary visible action", () => {
  assert.doesNotMatch(header, /documentReady|TaskPackFreshness|workspaceDescription|onOpenArchive|onInspectTaskPack/);
  assert.match(header, /variant="primary" onClick=\{onCopy\}/);
  assert.equal((header.match(/<Button/g) ?? []).length, 2); // Back + Copy; shared menu trigger is secondary.
  assert.match(header, /<DropdownMenu size="wide"/);
});
scenario("shared More trigger opts into a visible label without changing existing callers", () => {
  assert.match(header, /triggerLabel=\{t\("taskPackWorkspace.more"\)\}/);
  assert.match(dropdown, /triggerLabel\?: string/);
  assert.match(dropdown, /triggerLabel \? [^\n]+ : "size-8"/);
  assert.match(dropdown, /createPortal\(/);
  assert.match(dropdown, /getDropdownMenuPosition\(/);
  assert.match(dropdown, /buttonRef.current\?\.focus\(\)/);
});
scenario("workspace selector retains keyboard buttons and pairs icons with readable labels", () => {
  assert.match(header, /<HorizontalSlidingSelector/);
  assert.match(header, /document: FileText, review: ListChecks, details: SlidersHorizontal/);
  assert.match(header, /<Icon[^>]*aria-hidden="true"/);
  assert.match(header, /taskPackWorkspace\.\$\{item\}/);
  assert.doesNotMatch(header, /truncate|text-ellipsis/);
});
scenario("More preserves library, Inspector, Builder, both GitHub and all diagnostics actions", () => {
  for (const id of ["open-archive", "inspect", "open-in-builder", "source-issue", "created-issue", "create-issue", "selector-diagnostics", "generation-diagnostics", "performance-diagnostics"]) assert.ok(page.includes(`id: "${id}"`), id);
  assert.match(page, /onClick: onOpenArchive/); assert.match(page, /onInspectTaskPack\(currentTaskPack\)/);
  assert.match(page, /onOpenInBuilder\(currentTaskPack\)/);
  assert.match(header, /actions=\{actions.map/);
});
scenario("one top-level workflow owner survives all view switches", () => {
  assert.equal((page.match(/useTaskPackWorkflow\(/g) ?? []).length, 1);
  assert.match(page, /onViewChange=\{setWorkspaceView\}/);
  assert.doesNotMatch(header + documentView + detailsView + reviewView, /useTaskPackWorkflow|createTaskPackWorkflowController/);
  assert.doesNotMatch(hook, /workspaceView/); assert.match(hook, /\[taskPackId, currentRevisionId\]/);
  for (const view of TASK_PACK_WORKSPACE_VIEWS) assert.ok(page.includes(`hidden={workspaceView !== "${view}"}`));
  assert.doesNotMatch(page, /workspaceView === "(?:document|review|details)"\s*\?\s*</); // no view-based remounts
});
scenario("editor authority and response reconciliation remain at page boundary", () => {
  assert.match(page, /workflow.lifecycle.state === "active"/);
  assert.match(page, /!workflowController.blocked && !workflowController.loading/);
  assert.match(page, /!workflowController.refreshing && !workflowController.activeAction/);
  assert.match(page, /taskPackForSession.currentRevisionId !== editAuthority.current.revisionId/);
  assert.match(page, /input.expectedCurrentRevisionId !== session.expectedCurrentRevisionId/);
  assert.match(page, /setCurrentTaskPack\(nextTaskPack\);\s*onTaskPackUpdated\?\.\(nextTaskPack\)/);
  assert.match(page, /currentTaskPack.currentRevisionId : taskPack.currentRevisionId/);
});
scenario("modal instances and editor stay outside workspace-view visibility", () => {
  const end = page.indexOf("</main>");
  for (const component of ["CreateGitHubIssueModal", "SelectorDiagnosticsModal", "GenerationDiagnosticsModal", "PerformanceDiagnosticsModal", "TaskPackEditorDrawer"]) {
    assert.equal((page.match(new RegExp(`<${component}\\b`, "g")) ?? []).length, 1);
    assert.ok(page.indexOf(`<${component}`, end) > end, component);
  }
  assert.match(reviewView, /<ConfirmDialog/);
  assert.match(reviewView, /setConfirmation\(captured\)/);
  assert.match(page, /key=\{`\$\{taskPack.id\}:\$\{currentTaskPack.currentRevisionId/); // no tab key
});
scenario("scroll ownership and responsive widths are per-view, without metadata sidebar", () => {
  assert.match(page, /grid-rows-\[auto_minmax\(0,1fr\)\]/);
  assert.equal((documentView.match(/overflow-y-auto/g) ?? []).length, 1);
  assert.equal((detailsView.match(/overflow-y-auto/g) ?? []).length, 1);
  assert.doesNotMatch(reviewView, /overflow-y-auto/);
  assert.match(detailsView, /lg:grid-cols-2/); assert.match(reviewView, /md:grid-cols-2/);
  assert.match(header, /flex-wrap/); assert.match(documentView, /flex-wrap/);
});
scenario("pure presentation does not call HTTP/storage or perform actions on render", () => {
  assert.doesNotMatch(header + documentView + detailsView + reviewView, /fetch\(|storage\.|\.\.\/api\/|setInterval/);
  assert.equal(callbacks, 0);
});
scenario("EN/RU workspace keys synchronize and product modes are translated", () => {
  const en = i18n.getResourceBundle("en", "translation"), ru = i18n.getResourceBundle("ru", "translation");
  assert.deepEqual(Object.keys(en.taskPackWorkspace).sort(), Object.keys(ru.taskPackWorkspace).sort());
  assert.deepEqual(TASK_PACK_WORKSPACE_VIEWS.map(key => en.taskPackWorkspace[key]), ["Document", "Review", "Details"]);
  assert.deepEqual(TASK_PACK_WORKSPACE_VIEWS.map(key => ru.taskPackWorkspace[key]), ["Документ", "Проверка", "Детали"]);
  assert.notEqual(ru.taskPackResult.openInBuilder, ru.taskPackWorkflow.actions.reopen);
});
await i18n.changeLanguage("ru");
scenario("Russian Document uses full short Preview/Markdown labels and localized More", () => {
  const html = renderDocument();
  assert.match(html, />Просмотр<\/span>/); assert.match(html, />Markdown<\/span>/);
  assert.doesNotMatch(html, /Предпросмотр|Исходный Markdown/);
  assert.equal(i18n.t("taskPackWorkspace.more"), "Ещё");
});
scenario("Russian Review renders translated actions without internal version", () => {
  const html = renderReview();
  assert.match(html, /Начать проверку/); assert.match(html, /Архивировать/);
  assert.doesNotMatch(html, /782391|Версия состояния|Lifecycle version/);
});
process.stdout.write(`Task Pack workspace smoke passed: ${scenarios} scenarios (rendered markup plus ownership/wiring; not visual Desktop QA).\n`);
