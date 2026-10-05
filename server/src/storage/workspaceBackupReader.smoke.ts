import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  computeTaskPackRevisionContentHash, type TaskPackAggregateLifecycleEvent,
  type TaskPackRevision, type TaskPackRevisionReviewEvent,
} from "../taskPacks/taskPackLifecycle.js";
import { buildLegacyTaskPackRevisionContent, deriveTaskPackRevisionReviewState } from "./taskPackLifecyclePersistence.js";
import { parseWorkspaceBackup } from "./workspaceBackupReader.js";
import {
  WorkspaceBackupReadError, type WorkspaceBackupV1, type WorkspaceBackupV2,
} from "./workspaceBackupFormat.js";
import { validateWorkspaceBackup, WORKSPACE_BACKUP_MAX_DEPTH, WORKSPACE_BACKUP_MAX_NODES } from "./workspaceBackupValidation.js";

const scenarios: { name: string; run: () => void }[] = [];
const scenario = (name: string, run: () => void) => scenarios.push({ name, run });
const readFixture = (name: string) => fs.readFileSync(new URL(`fixtures/workspaceBackup.${name}.json`, import.meta.url), "utf8");
const earlyText = readFixture("v1.early"), currentText = readFixture("v1.current"), v2Text = readFixture("v2");
const early = JSON.parse(earlyText) as WorkspaceBackupV1;
const current = JSON.parse(currentText) as WorkspaceBackupV1;
const base = JSON.parse(v2Text) as WorkspaceBackupV2;
type Mutable<T> = { -readonly [K in keyof T]: T[K] extends readonly (infer U)[] ? Mutable<U>[] :
  T[K] extends object ? Mutable<T[K]> : T[K] };
const clone = <T>(value: T): Mutable<T> => structuredClone(value) as Mutable<T>;
const parse = (value: unknown) => parseWorkspaceBackup(JSON.stringify(value));
function legacy(value: unknown = current) {
  const result = parse(value);
  assert.equal(result.formatVersion, 1);
  if (result.formatVersion !== 1) throw new Error("fixture version");
  return result;
}
function modern(value: unknown = base) {
  const result = parse(value);
  assert.equal(result.formatVersion, 2);
  if (result.formatVersion !== 2) throw new Error("fixture version");
  return result.backup;
}
function rejects(value: unknown, code = "WORKSPACE_BACKUP_INVALID") {
  assert.throws(() => parse(value), (error: unknown) => {
    assert.ok(error instanceof WorkspaceBackupReadError);
    assert.equal(error.code, code);
    assert.equal("cause" in error, false);
    assert.doesNotMatch(error.message, /SQL|driver|Synthetic|githubIssue|private payload/u);
    return true;
  });
}
const badV1 = (name: string, mutate: (value: Mutable<WorkspaceBackupV1>) => void) => scenario(name, () => {
  const value = clone(current); mutate(value); rejects(value);
});
const badV2 = (name: string, mutate: (value: Mutable<WorkspaceBackupV2>) => void) => scenario(name, () => {
  const value = clone(multi()); mutate(value); rejects(value);
});
const t = (seconds: number) => new Date(Date.UTC(2030, 0, 1) + seconds * 1000).toISOString();
function rehash(revision: TaskPackRevision): string {
  const { id, taskPackId, revisionNumber, baseRevisionId, contentHash, createdAt, generatedAt, ...content } = revision;
  return computeTaskPackRevisionContentHash(content);
}
function multi(): Mutable<WorkspaceBackupV2> {
  const value = clone(base), first = value.data.taskPackRevisions[0];
  const second = { ...clone(first), id: 201, revisionNumber: 2, baseRevisionId: first.id,
    sourceKind: "manual_edit" as const, rawTask: "  Второе\r\n\tизменение  ", createdAt: t(3) };
  second.contentHash = rehash(second);
  value.data.taskPackRevisions.push(second);
  value.data.taskPackAggregates[0].currentRevisionId = second.id;
  value.data.taskPackAggregates[0].updatedAt = t(3);
  value.counts.revisions = 2;
  return value;
}
function review(value: Mutable<WorkspaceBackupV2>, revisionId: number, state: "accepted" | "changes_requested" = "accepted") {
  const events: TaskPackRevisionReviewEvent[] = [
    { id: `review-${revisionId}-start`, taskPackId: 30, revisionId, eventType: "review_started",
      fromState: "unreviewed", toState: "in_review", source: "user", actorId: "synthetic actor",
      createdAt: t(4), metadata: { note: "Exact historical metadata", githubIssue: { number: 12 } } },
    { id: `review-${revisionId}-end`, taskPackId: 30, revisionId, eventType: state,
      fromState: "in_review", toState: state, source: "user", actorId: null, createdAt: t(5), metadata: null },
  ];
  value.data.taskPackReviewEvents.push(...clone(events)); value.counts.reviewEvents += events.length;
  value.data.taskPackAggregates[0].lifecycleVersion += events.length;
  if (state === "accepted") value.data.taskPackAggregates[0].acceptedRevisionId = revisionId;
  return value;
}
function life(value: Mutable<WorkspaceBackupV2>, actions: TaskPackAggregateLifecycleEvent["eventType"][]) {
  const aggregate = value.data.taskPackAggregates[0];
  let seconds = 10;
  for (const action of actions) {
    const fromState = aggregate.lifecycle.state;
    const toState = action === "completed" ? "completed" : action === "archived" ? "archived" :
      action === "reopened" ? "active" : aggregate.lifecycle.archivedFromState!;
    const event: TaskPackAggregateLifecycleEvent = { id: `life-${seconds}`, taskPackId: 30,
      eventType: action, fromState, toState, revisionId: action === "completed" ? aggregate.currentRevisionId : null,
      source: "user", actorId: "synthetic actor", createdAt: t(seconds++), metadata: { note: "Unredacted event" } };
    value.data.taskPackLifecycleEvents.push(clone(event)); value.counts.lifecycleEvents++;
    aggregate.lifecycle = toState === "archived" ? { state: "archived", archivedFromState: fromState as "active" | "completed" } :
      { state: toState, archivedFromState: null };
    aggregate.updatedAt = event.createdAt; aggregate.lifecycleVersion++;
    aggregate.archivedAt = action === "archived" ? event.createdAt : null;
    if (action === "completed") aggregate.completedAt = event.createdAt;
  }
  return value;
}

scenario("early historical V1 fixture parses", () => assert.deepEqual(legacy(early).backup, early));
scenario("current pre-V2 V1 fixture parses", () => assert.deepEqual(legacy().backup, current));
scenario("early/current V1 informational copy differs without a schema/version change", () => {
  assert.notDeepEqual(early.excluded, current.excluded); assert.notDeepEqual(early.warnings, current.warnings);
  assert.equal(legacy(early).formatVersion, legacy().formatVersion);
});
scenario("V1 informational arrays can change or claim exclusions without suppressing actual content", () => {
  const value = clone(current); value.included = []; value.excluded = ["everything"]; value.warnings = ["future wording"];
  assert.deepEqual(legacy(value).backup.data.taskPacks[0].generationRecipe, current.data.taskPacks[0].generationRecipe);
});
scenario("V1 exactly one compatibility revision per pack, without fake revision identity", () => {
  const result = legacy(); assert.equal(result.compatibilityTaskPacks.length, result.backup.data.taskPacks.length);
  const bundle = result.compatibilityTaskPacks[0], revision = bundle.revisions[0];
  assert.equal(bundle.sourceAggregateId, 30); assert.equal(bundle.sourceProjectId, 10);
  assert.equal(bundle.revisions.length, 1); assert.equal(revision.sourceRevisionId, null);
  assert.equal(revision.revisionIndex, 0); assert.equal(bundle.currentRevisionIndex, 0);
  assert.equal(revision.revisionNumber, 1); assert.equal(revision.baseRevisionIndex, null);
});
scenario("V1 active/version 1, no acceptance/completion/archive/events", () => {
  const bundle = legacy().compatibilityTaskPacks[0];
  assert.deepEqual(bundle.lifecycle, { state: "active", archivedFromState: null });
  assert.equal(bundle.lifecycleVersion, 1); assert.equal(bundle.acceptedRevisionIndex, null);
  assert.equal(bundle.completedAt, null); assert.equal(bundle.archivedAt, null);
  assert.deepEqual(bundle.lifecycleEvents, []); assert.deepEqual(bundle.reviewEvents, []);
  // Established replay's zero-event state is unreviewed, not inferred from generation mode.
  assert.equal(deriveTaskPackRevisionReviewState(base.data.taskPackAggregates[0], base.data.taskPackRevisions[0], []), "unreviewed");
});
scenario("V1 timestamps preserved; generatedAt remains unknown/null", () => {
  const bundle = legacy().compatibilityTaskPacks[0], pack = current.data.taskPacks[0];
  assert.equal(bundle.createdAt, pack.createdAt); assert.equal(bundle.updatedAt, pack.updatedAt);
  assert.equal(bundle.revisions[0].createdAt, pack.createdAt); assert.equal(bundle.revisions[0].generatedAt, null);
});
scenario("V1 uses existing TP-LC-02 legacy builder and deterministic canonical hash", () => {
  const pack = current.data.taskPacks[0], revision = legacy().compatibilityTaskPacks[0].revisions[0];
  const content = buildLegacyTaskPackRevisionContent({ id: pack.id, raw_task: pack.rawTask, task_type: pack.taskType,
    target_tool: pack.targetTool, generated_prompt: pack.generatedPrompt, generation_mode: pack.generationMode,
    generation_model: pack.generationModel, generation_message: pack.generationMessage,
    generation_used_fallback: pack.generationUsedFallback, generation_duration_ms: pack.generationDurationMs,
    generation_recipe: pack.generationRecipe, created_at: pack.createdAt });
  assert.deepEqual(revision.content, content); assert.equal(revision.content.sourceKind, "legacy_snapshot");
  assert.equal(revision.contentHash, computeTaskPackRevisionContentHash(content));
  assert.equal(legacy().compatibilityTaskPacks[0].revisions[0].contentHash, revision.contentHash);
});
scenario("V1 exact cloud handoff prefix alone maps to imported", () => {
  const value = clone(current); value.data.taskPacks[0].generationMessage = "ContextForge cloud handoff: synthetic";
  assert.equal(legacy(value).compatibilityTaskPacks[0].revisions[0].content.sourceKind, "imported");
  value.data.taskPacks[0].generationMessage = " ContextForge cloud handoff: synthetic";
  assert.equal(legacy(value).compatibilityTaskPacks[0].revisions[0].content.sourceKind, "legacy_snapshot");
});
scenario("V1 authored whitespace/CRLF/tabs/Unicode are exact", () => {
  const content = legacy().compatibilityTaskPacks[0].revisions[0].content, pack = current.data.taskPacks[0];
  assert.equal(content.rawTask, pack.rawTask); assert.equal(content.generatedPrompt, pack.generatedPrompt);
});
scenario("V1 recipe/GitHub provenance remains inert historical content", () => {
  const result = legacy(), content = result.compatibilityTaskPacks[0].revisions[0].content;
  assert.deepEqual(content.generationRecipe, current.data.taskPacks[0].generationRecipe);
  assert.ok(content.generationRecipe?.githubIssue); assert.ok(content.generationRecipe?.githubCreatedIssue);
  assert.doesNotMatch(JSON.stringify(result), /task_pack_github_created_issue_links|destinationId/u);
});
scenario("V1 recipe diagnostic subtrees are not reinterpreted as dedicated modern evidence", () => {
  const value = clone(current); value.data.taskPacks[0].generationRecipe = { diagnostics: { historical: true } };
  const content = legacy(value).compatibilityTaskPacks[0].revisions[0].content;
  assert.deepEqual(content.generationRecipe, value.data.taskPacks[0].generationRecipe);
  assert.equal(content.diagnostics, null); assert.equal(content.groundedContextSnapshot, null); assert.equal(content.freshnessBasis, null);
});
scenario("V1 preserves JSON values under known safe keys, independent of UI enums", () => {
  const value = clone(current);
  value.data.safeSettings.generation_mode = { future: ["unknown enum", null, 42, true] };
  assert.deepEqual(legacy(value).backup.data.safeSettings, value.data.safeSettings);
});
scenario("malformed JSON has a fixed typed error without parser content/cause", () => {
  assert.throws(() => parseWorkspaceBackup('{"private payload"'), error =>
    error instanceof WorkspaceBackupReadError && error.code === "WORKSPACE_BACKUP_JSON_INVALID" &&
    error.message === "Workspace backup JSON is invalid." && !("cause" in error));
});
badV1("V1 unknown structural data field rejected", value => Object.assign(value.data, { credentials: {} }));
badV1("V1 missing required top-level field rejected", value => Reflect.deleteProperty(value, "warnings"));
badV1("V1 missing required nullable field rejected", value => Reflect.deleteProperty(value.data.taskPacks[0], "generationModel"));
badV1("V1 unsafe identity rejected", value => { value.data.taskPacks[0].id = Number.MAX_SAFE_INTEGER + 1; });
badV1("V1 foreign project reference rejected", value => { value.data.taskPacks[0].projectId = 999; });
badV1("V1 duplicate task pack identity rejected", value => { value.data.taskPacks.push(clone(value.data.taskPacks[0])); value.counts.taskPacks++; });
badV1("V1 duplicate project identity rejected", value => { value.data.projects.push(clone(value.data.projects[0])); value.counts.projects++; });
badV1("V1 blank title rejected", value => { value.data.taskPacks[0].title = "  "; });
badV1("V1 unknown safeSettings key rejected", value => Object.assign(value.data.safeSettings, { github_access_token: "synthetic" }));
badV1("V1 missing safeSettings key rejected", value => Reflect.deleteProperty(value.data.safeSettings, "theme"));
badV1("V1 counts mismatch not repaired", value => { value.counts.taskPacks = 100; });
for (const key of ["projects", "projectMemories", "ruleTemplates", "settings"] as const)
  badV1(`V1 ${key} count cross-checked`, value => { value.counts[key]++; });
for (const key of ["included", "excluded", "warnings"] as const)
  badV1(`V1 ${key} must be a string array`, value => { Object.assign(value, { [key]: [null] }); });

scenario("empty V2 workspace parses", () => {
  const value = clone(base); value.data.projects = []; value.data.projectMemory = [];
  value.data.taskPackAggregates = []; value.data.taskPackRevisions = [];
  value.counts.projects = 0; value.counts.taskPacks = 0; value.counts.revisions = 0;
  assert.deepEqual(modern(value), value);
});
scenario("one aggregate/one revision V2 fixture preserves every original field", () => assert.deepEqual(modern(), base));
scenario("multiple revisions/manual-edit ancestry; IDs are not ordinals", () => {
  const value = modern(multi()); assert.deepEqual(value.data.taskPackRevisions.map(r => r.revisionNumber), [1, 2]);
  assert.deepEqual(value.data.taskPackRevisions.map(r => r.id), [187, 201]);
});
scenario("historical accepted revision independent of current revision validates", () => {
  const value = modern(review(multi(), 187)); assert.equal(value.data.taskPackAggregates[0].acceptedRevisionId, 187);
  assert.equal(value.data.taskPackAggregates[0].currentRevisionId, 201);
});
scenario("multiple historical accepted revisions preserve full independent review chains", () => {
  const value = review(review(multi(), 187), 201); assert.deepEqual(modern(value), value);
});
scenario("changes_requested history validates without accepted pointer", () => {
  const value = review(multi(), 187, "changes_requested"); assert.deepEqual(modern(value), value);
});
scenario("complete validates accepted current revision and evidence", () => {
  const value = life(review(multi(), 201), ["completed"]); assert.deepEqual(modern(value), value);
});
scenario("archived from active validates exact prior state", () => {
  const value = life(multi(), ["archived"]); assert.deepEqual(modern(value), value);
});
scenario("archived from completed preserves completion evidence", () => {
  const value = life(review(multi(), 201), ["completed", "archived"]); assert.deepEqual(modern(value), value);
});
scenario("full lifecycle chain complete/archive/unarchive/reopen/archive/unarchive replays from initial active", () => {
  const value = life(review(multi(), 201), ["completed", "archived", "unarchived", "reopened", "archived", "unarchived"]);
  assert.deepEqual(modern(value), value); assert.equal(value.data.taskPackAggregates[0].lifecycle.state, "active");
});
scenario("stored lifecycleVersion is not inferred from event count", () => {
  const value = life(multi(), ["archived"]); value.data.taskPackAggregates[0].lifecycleVersion = Number.MAX_SAFE_INTEGER;
  assert.equal(modern(value).data.taskPackAggregates[0].lifecycleVersion, Number.MAX_SAFE_INTEGER);
});
scenario("same event ID across distinct lifecycle/review tables is not a new forbidden policy", () => {
  const value = life(review(multi(), 201), ["completed"]);
  value.data.taskPackLifecycleEvents[0].id = value.data.taskPackReviewEvents[0].id;
  assert.deepEqual(modern(value), value);
});
scenario("V2 content hash verified/preserved, never replaced", () => {
  const value = modern(); assert.equal(value.data.taskPackRevisions[0].contentHash, base.data.taskPackRevisions[0].contentHash);
  assert.equal(value.data.taskPackRevisions[0].contentHash, rehash(value.data.taskPackRevisions[0]));
});
scenario("V2 exact Unicode/CRLF/tabs/trailing whitespace and null fields/timing preserved", () => {
  const revision = modern().data.taskPackRevisions[0], original = base.data.taskPackRevisions[0];
  assert.equal(revision.rawTask, original.rawTask); assert.equal(revision.generatedPrompt, original.generatedPrompt);
  assert.equal(revision.generationModel, null); assert.equal(revision.generationMessage, null);
  assert.equal(revision.generationDurationMs, 12.5); assert.deepEqual(revision.diagnostics, original.diagnostics);
});
scenario("V2 complete immutable recipe and embedded GitHub content preserved without redaction", () => {
  const value = clone(base), revision = value.data.taskPackRevisions[0];
  revision.generationRecipe = { githubIssue: { url: "https://example.invalid/history", login: "synthetic-user" },
    githubCreatedIssue: { number: 13, url: "https://example.invalid/created" }, userAuthored: { api_key: "synthetic authored string" } };
  revision.contentHash = rehash(revision);
  assert.deepEqual(modern(value), value);
});
scenario("V2 context/freshness/diagnostic/timing records remain complete", () => {
  const value = clone(base), revision = value.data.taskPackRevisions[0];
  revision.groundedContextSnapshot = { schemaVersion: 1, selectorEngine: "manual",
    selectorConfigurationFingerprint: null, repositoryObservationFingerprint: null,
    repositorySnapshotFingerprint: null, selectorSnapshotFingerprint: null,
    selectedFiles: [{ path: "src/synthetic.ts", role: "reference", usage: "inspect-only",
      evidenceStrength: "reference", proofClasses: ["inventory_exact"] }] };
  revision.freshnessBasis = { schemaVersion: 1, stateAtCreation: "unknown", projectAwarenessFingerprint: null,
    inventoryFingerprint: null, policyVersion: null, comparisonLimited: true, observedAt: t(1), previousObservedAt: null };
  revision.contentHash = rehash(revision); assert.deepEqual(modern(value), value);
});
scenario("V2 generation message, model, fallback and noninteger timing remain exact", () => {
  const value = clone(base), revision = value.data.taskPackRevisions[0];
  revision.generationMode = "ollama"; revision.generationModel = "synthetic model";
  revision.generationMessage = " Exact\r\n\tmessage "; revision.generationUsedFallback = true; revision.generationDurationMs = 0.125;
  revision.contentHash = rehash(revision); assert.deepEqual(modern(value), value);
});
scenario("V2 informational copy never overrides actual private content", () => {
  const value = clone(base); value.included = []; value.excluded = ["githubIssue", "all content"]; value.warnings = [];
  assert.deepEqual(modern(value), value);
});
scenario("V2 private Project Memory/custom rules/templates are preserved exactly", () => {
  const value = clone(base);
  value.data.projectMemory[0].memories = [{ id: 42, projectId: 10, title: "Synthetic memory",
    content: "  Историческое\r\n\tсодержимое  ", category: "custom", isEnabled: false, createdAt: t(0), updatedAt: t(1) }];
  value.data.rulesAndTemplates = { version: 1,
    templates: [{ id: "template", name: "Synthetic", description: "", targetTool: "generic", taskType: "tests",
      content: " Exact template\r\n", isBuiltin: false }],
    ruleItems: [{ id: "rule", title: "Synthetic", description: "", category: "general", content: "Exact rule", isBuiltin: false }],
    ruleProfiles: [{ id: "profile", name: "Synthetic", description: "", taskType: "tests", enabledRuleIds: ["rule"],
      customRules: ["\tExact custom rule  "], acceptanceCriteriaPresetId: "preset", isBuiltin: false, createdAt: t(0) }],
    acceptanceCriteriaPresets: [{ id: "preset", name: "Synthetic", description: "", taskType: "tests",
      criteria: ["Exact criteria"], isBuiltin: false, updatedAt: t(1) }] };
  value.counts.projectMemories = 1; value.counts.ruleTemplates = 4;
  assert.deepEqual(modern(value), value);
});
scenario("source project paths are private backup content, never filesystem access authority", () => {
  const value = clone(base); value.data.projects[0].localPath = "/synthetic/absolute/local/project";
  assert.equal(modern(value).data.projects[0].localPath, value.data.projects[0].localPath);
});
scenario("V2 complete events preserve actor/source/timestamp/arbitrary JSON metadata", () => {
  const value = life(review(multi(), 201), ["completed"]);
  value.data.taskPackLifecycleEvents[0].source = "import";
  value.data.taskPackLifecycleEvents[0].metadata = { authored: "\tExact\r\n", sourceReference: 187 };
  assert.deepEqual(modern(value), value);
});
scenario("multiple aggregates with independently owned history validate", () => {
  const value = multi(), otherRevision = { ...clone(value.data.taskPackRevisions[0]), id: 401, taskPackId: 31 };
  const other = { ...clone(value.data.taskPackAggregates[0]), id: 31, currentRevisionId: 401 };
  value.data.taskPackAggregates.push(other); value.data.taskPackRevisions.push(otherRevision);
  value.counts.taskPacks++; value.counts.revisions++; assert.deepEqual(modern(value), value);
});
scenario("generated revision retains its generatedAt without fabricating history", () => {
  const value = clone(base), revision = value.data.taskPackRevisions[0];
  revision.sourceKind = "generated"; revision.generatedAt = t(1); revision.contentHash = rehash(revision);
  assert.deepEqual(modern(value), value);
});
scenario("scalar source IDs inside arbitrary immutable JSON are never recursively remapped", () => {
  const value = clone(base), revision = value.data.taskPackRevisions[0];
  revision.generationRecipe = { taskPackId: 30, revisionId: 187, projectId: 10, nested: [187, "30"] };
  revision.contentHash = rehash(revision); assert.deepEqual(modern(value), value);
});
badV2("V2 mismatching canonical content hash fails", value => { value.data.taskPackRevisions[0].rawTask += "tampered"; });
badV2("V2 malformed hash fails", value => { value.data.taskPackRevisions[0].contentHash = "invalid"; });
badV2("V2 corrupt current revision pointer fails", value => { value.data.taskPackAggregates[0].currentRevisionId = 999; });
badV2("V2 corrupt accepted revision pointer fails", value => { value.data.taskPackAggregates[0].acceptedRevisionId = 999; });
badV2("V2 accepted pointer requires accepted review evidence", value => { value.data.taskPackAggregates[0].acceptedRevisionId = 187; });
badV2("V2 foreign aggregate project fails", value => { value.data.taskPackAggregates[0].projectId = 999; });
badV2("V2 foreign current pointer to an existing revision fails", value => {
  const revision = { ...clone(value.data.taskPackRevisions[0]), id: 401, taskPackId: 31 };
  value.data.taskPackRevisions.push(revision);
  value.data.taskPackAggregates.push({ ...clone(value.data.taskPackAggregates[0]), id: 31, currentRevisionId: 401 });
  value.counts.revisions++; value.counts.taskPacks++; value.data.taskPackAggregates[0].currentRevisionId = 401;
});
badV2("V2 orphan/foreign revision fails", value => { value.data.taskPackRevisions[0].taskPackId = 999; });
badV2("V2 missing first revision fails", value => { value.data.taskPackRevisions.shift(); value.counts.revisions--; });
badV2("V2 invalid base ancestry fails", value => { value.data.taskPackRevisions[1].baseRevisionId = 999; });
badV2("V2 self base ancestry fails", value => { value.data.taskPackRevisions[1].baseRevisionId = 201; });
badV2("V2 revision order fails without repair/sort", value => { value.data.taskPackRevisions.reverse(); });
badV2("V2 duplicate revision identity fails", value => { value.data.taskPackRevisions[1].id = 187; });
badV2("V2 duplicate aggregate identity fails", value => { value.data.taskPackAggregates.push(clone(value.data.taskPackAggregates[0])); value.counts.taskPacks++; });
badV2("V2 duplicate project identity fails", value => { value.data.projects.push(clone(value.data.projects[0])); value.counts.projects++; });
badV2("V2 foreign review event fails", value => { review(value, 187); value.data.taskPackReviewEvents[0].taskPackId = 999; });
badV2("V2 orphan review event fails", value => { review(value, 187); value.data.taskPackReviewEvents[0].revisionId = 999; });
badV2("V2 duplicate review event ID fails", value => { review(value, 187); value.data.taskPackReviewEvents[1].id = value.data.taskPackReviewEvents[0].id; });
badV2("V2 invalid full review chain fails", value => { review(value, 187); value.data.taskPackReviewEvents.shift(); value.counts.reviewEvents--; });
badV2("V2 out-of-order review event time fails", value => { review(value, 187); value.data.taskPackReviewEvents[1].createdAt = t(2); });
badV2("V2 foreign lifecycle event fails", value => { life(value, ["archived"]); value.data.taskPackLifecycleEvents[0].taskPackId = 999; });
badV2("V2 orphan completion revision fails", value => { life(review(value, 201), ["completed"]); value.data.taskPackLifecycleEvents[0].revisionId = 999; });
badV2("V2 duplicate lifecycle event ID fails", value => { life(value, ["archived", "unarchived"]); value.data.taskPackLifecycleEvents[1].id = value.data.taskPackLifecycleEvents[0].id; });
badV2("V2 lifecycle valid individual events in invalid sequence fail", value => {
  life(value, ["archived", "unarchived", "archived"]);
  value.data.taskPackLifecycleEvents.splice(1, 1); value.counts.lifecycleEvents--;
});
badV2("V2 lifecycle event order fails", value => {
  life(value, ["archived", "unarchived"]); value.data.taskPackLifecycleEvents[1].createdAt = t(1);
});
badV2("V2 final lifecycle projection mismatch fails", value => {
  life(value, ["archived", "unarchived"]); value.data.taskPackLifecycleEvents.pop(); value.counts.lifecycleEvents--;
});
badV2("V2 unarchive cannot choose a different prior state", value => {
  life(review(value, 201), ["completed", "archived", "unarchived"]);
  value.data.taskPackLifecycleEvents[2].toState = "active";
  value.data.taskPackAggregates[0].lifecycle = { state: "active", archivedFromState: null };
});
badV2("V2 fabricated completedAt without lifecycle events fails", value => { value.data.taskPackAggregates[0].completedAt = t(8); });
badV2("V2 mismatched archivedAt evidence fails", value => { life(value, ["archived"]); value.data.taskPackAggregates[0].archivedAt = t(9); });
badV2("V2 zero lifecycleVersion fails", value => { value.data.taskPackAggregates[0].lifecycleVersion = 0; });
badV2("V2 unsafe lifecycleVersion fails", value => { value.data.taskPackAggregates[0].lifecycleVersion = Number.MAX_SAFE_INTEGER + 1; });
badV2("V2 invalid nullable generation field fails", value => { Reflect.deleteProperty(value.data.taskPackRevisions[0], "generationModel"); });
badV2("V2 unknown aggregate typed field fails", value => { Object.assign(value.data.taskPackAggregates[0], { secret: "synthetic" }); });
badV2("V2 unknown revision typed field fails", value => { Object.assign(value.data.taskPackRevisions[0], { reviewState: "accepted" }); });
badV2("V2 unknown lifecycle event typed field fails", value => { life(value, ["archived"]); Object.assign(value.data.taskPackLifecycleEvents[0], { secret: true }); });
badV2("V2 unknown review event typed field fails", value => { review(value, 187); Object.assign(value.data.taskPackReviewEvents[0], { extra: true }); });
badV2("V2 malformed event identity fails", value => { life(value, ["archived"]); value.data.taskPackLifecycleEvents[0].id = "invalid\u0000identity"; });
badV2("V2 malformed event source fails", value => { review(value, 187); Object.assign(value.data.taskPackReviewEvents[0], { source: "invalid" }); });
badV2("V2 malformed event metadata fails", value => { life(value, ["archived"]); Object.assign(value.data.taskPackLifecycleEvents[0], { metadata: [] }); });
badV2("V2 malformed actor nullability fails", value => { review(value, 187); Object.assign(value.data.taskPackReviewEvents[0], { actorId: 42 }); });
badV2("V2 malformed revision timestamp fails", value => { value.data.taskPackRevisions[0].createdAt = "not a timestamp"; });
badV2("V2 invalid diagnostic shape fails", value => { Object.assign(value.data.taskPackRevisions[0], { diagnostics: { unexpected: true } }); });
badV2("V2 negative timing fails", value => { value.data.taskPackRevisions[0].generationDurationMs = -1; });
badV2("V2 unknown dedicated setting fails", value => { Object.assign(value.data.safeSettings, { ollama_url: "https://example.invalid" }); });
badV2("V2 unknown project typed field fails", value => { Object.assign(value.data.projects[0], { rawSource: "synthetic" }); });
badV2("V2 project memory foreign ownership fails", value => {
  value.data.projectMemory[0].memories.push({ id: 42, projectId: 999, title: "Synthetic", content: "Exact",
    category: "custom", isEnabled: true, createdAt: t(0), updatedAt: t(0) }); value.counts.projectMemories++;
});
badV2("V2 dedicated integration/secret structural section fails", value => { Object.assign(value.data, { githubAccounts: [] }); });
badV2("V2 flat data.taskPacks is forbidden second authority", value => { Object.assign(value.data, { taskPacks: [] }); });
badV2("V2 persisted drafts remain excluded", value => { Object.assign(value.data, { taskPackDrafts: [] }); });
badV2("V2 unknown top-level structural field fails", value => { Object.assign(value, { providerCredentials: {} }); });
for (const key of ["taskPacks", "revisions", "lifecycleEvents", "reviewEvents"] as const)
  badV2(`V2 ${key} count mismatch fails`, value => { value.counts[key]++; });
scenario("unknown format fails safely", () => rejects({ ...base, format: "unknown" }, "WORKSPACE_BACKUP_FORMAT_UNSUPPORTED"));
scenario("unknown version fails safely", () => rejects({ ...base, formatVersion: 3 }, "WORKSPACE_BACKUP_FORMAT_UNSUPPORTED"));
scenario("nonobject JSON fails safely", () => rejects(null, "WORKSPACE_BACKUP_FORMAT_UNSUPPORTED"));
scenario("nonfinite JSON number fails before domain validation", () => {
  assert.throws(() => parseWorkspaceBackup(v2Text.replace('"generationDurationMs": 12.5', '"generationDurationMs": 1e999')),
    error => error instanceof WorkspaceBackupReadError && error.code === "WORKSPACE_BACKUP_INVALID");
});
scenario("private content keys including __proto__ are preserved as JSON, not scanned/rewritten", () => {
  const value = clone(base), revision = value.data.taskPackRevisions[0];
  revision.generationRecipe = JSON.parse('{"__proto__":{"synthetic":true},"constructor":"authored","secret":"synthetic"}');
  revision.contentHash = rehash(revision); assert.deepEqual(modern(value).data.taskPackRevisions[0].generationRecipe, revision.generationRecipe);
  assert.equal(({} as Record<string, unknown>).synthetic, undefined);
});
scenario("pure validation never mutates caller's V1/V2 values", () => {
  for (const value of [current, multi()]) {
    const before = structuredClone(value); validateWorkspaceBackup(value); assert.deepEqual(value, before);
  }
});
scenario("pathological depth is a typed implementation safety limit, not truncation", () => {
  const value = clone(base); let nested: unknown = null;
  for (let i = 0; i < WORKSPACE_BACKUP_MAX_DEPTH + 1; i++) nested = [nested];
  Object.assign(value.data.safeSettings, { theme: nested }); rejects(value, "WORKSPACE_BACKUP_SAFETY_LIMIT");
});
scenario("conservative node budget rejects pathological structure explicitly", () => {
  assert.equal(WORKSPACE_BACKUP_MAX_NODES, 10_000_000);
  assert.throws(() => validateWorkspaceBackup(Array(WORKSPACE_BACKUP_MAX_NODES).fill(null)), error =>
    error instanceof WorkspaceBackupReadError && error.code === "WORKSPACE_BACKUP_SAFETY_LIMIT");
});
scenario("nesting safety ignores brackets/escaped quotes inside exact authored strings", () => {
  const value = clone(current);
  value.data.taskPacks[0].rawTask = '[{"' + "[".repeat(WORKSPACE_BACKUP_MAX_DEPTH * 2) + '\\"}]';
  assert.equal(legacy(value).compatibilityTaskPacks[0].revisions[0].content.rawTask, value.data.taskPacks[0].rawTask);
});
scenario("ordinary nested JSON values remain exact below the implementation depth limit", () => {
  const value = clone(current); let nested: unknown = " Exact authored value ";
  for (let i = 0; i < 40; i++) nested = { nested };
  Object.assign(value.data.safeSettings, { theme: nested });
  assert.deepEqual(legacy(value).backup.data.safeSettings, value.data.safeSettings);
});
scenario("no 64 MiB wire ceiling; ordinary large authored values preserve exact data", () => {
  const value = clone(current), text = "x".repeat(65 * 1024 * 1024);
  value.data.taskPacks[0].rawTask = text;
  assert.equal(legacy(value).compatibilityTaskPacks[0].revisions[0].content.rawTask, text);
});
scenario("pure boundary has no adapter/filesystem/network/restore/renderer runtime dependency", () => {
  const visited = new Set<string>();
  function inspect(url: URL) {
    const file = fileURLToPath(url); if (visited.has(file)) return; visited.add(file);
    const source = fs.readFileSync(url, "utf8");
    assert.doesNotMatch(source, /from ["'](?:node:fs|node:fs\/promises|node:http|node:https|pg|sql\.js)|\b(?:fetch|randomUUID)\s*\(|new (?:SqliteStorageAdapter|PostgresStorageAdapter)|apps\/desktop/u);
    for (const match of source.matchAll(/import\s+(?!type\b)[\s\S]*?from\s+["'](\.[^"']+)["']/gu)) {
      const target = new URL(match[1].replace(/\.js$/u, ".ts"), url);
      assert.doesNotMatch(target.pathname, /\/(?:index|SqliteStorageAdapter|PostgresStorageAdapter|workspaceBackup)\.ts$/u);
      inspect(target);
    }
  }
  inspect(new URL("workspaceBackupReader.ts", import.meta.url));
  assert.ok(visited.size >= 5);
});

for (const { name, run } of scenarios) { run(); console.log(`PASS ${name}`); }
console.log(`Workspace backup reader smoke passed (${scenarios.length} scenarios).`);
