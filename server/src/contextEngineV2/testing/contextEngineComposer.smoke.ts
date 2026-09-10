import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { scanProjectInventory } from "../../scanner/projectInventoryScanner.js";
import { readContextComposerEngineMode } from "../../settings/settingsService.js";
import {
  createContextComposerExecutionTracker,
  aggregateContextComposerComparisons,
  createLegacyContextComposerEngineResolution,
  deriveContextComposerExplicitTargets,
  deriveContextComposerNegativeConstraints,
  deriveContextComposerTraceIdentity,
  executeContextComposerV2,
  normalizeContextComposerEngineMode,
  prepareContextComposerCanonicalInput,
  assertContextComposerCanonicalInput,
  resolveContextComposerEngine,
  validateContextComposerEngineView,
  type ContextComposerEngineView,
  type ContextComposerEngineResolution,
  type ContextComposerV2ExecutionInput,
} from "../composer/index.js";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
type Scenario = { name: string; run(): void | Promise<void> };
const scenarios: Scenario[] = [];

async function loadComposerUiSemantics(): Promise<{
  usesLegacySelectorSemantics(preview: Record<string, unknown>): boolean;
  getContextComposerFileReasonTranslationKey(file: Record<string, unknown>): string | null;
}> {
  const moduleUrl = pathToFileURL(path.join(
    repositoryRoot,
    "apps/desktop/renderer/src/components/contextComposer/ContextComposerUiSemantics.ts",
  )).href;
  return import(moduleUrl) as Promise<{
    usesLegacySelectorSemantics(preview: Record<string, unknown>): boolean;
    getContextComposerFileReasonTranslationKey(file: Record<string, unknown>): string | null;
  }>;
}

async function loadWorkspaceDensitySemantics(): Promise<{
  resolveWorkspaceDensity(input: {
    preference: "adaptive" | "comfortable" | "compact";
    isWorkflowSurface: boolean;
    isFocusModeActive: boolean;
    hasAuxiliaryWorkspace: boolean;
  }): "comfortable" | "balanced" | "compact";
  getWorkspaceDensityPadding(
    density: "comfortable" | "balanced" | "compact",
    isFocusModeActive: boolean,
  ): number;
}> {
  const moduleUrl = pathToFileURL(path.join(
    repositoryRoot,
    "apps/desktop/renderer/src/utils/workspaceDensity.ts",
  )).href;

  return import(moduleUrl) as Promise<{
    resolveWorkspaceDensity(input: {
      preference: "adaptive" | "comfortable" | "compact";
      isWorkflowSurface: boolean;
      isFocusModeActive: boolean;
      hasAuxiliaryWorkspace: boolean;
    }): "comfortable" | "balanced" | "compact";
    getWorkspaceDensityPadding(
      density: "comfortable" | "balanced" | "compact",
      isFocusModeActive: boolean,
    ): number;
  }>;
}

function scenario(name: string, run: Scenario["run"]): void {
  scenarios.push({ name, run });
}

function legacySelection(paths: string[] = []): NonNullable<ContextComposerEngineResolution["selection"]> {
  return {
    selectedFiles: paths.map((filePath) => ({
      path: filePath,
      kind: "source",
      usage: "inspect-and-edit",
      reason: "Legacy grounded candidate.",
      confidence: 0.8,
    })),
    rejectedModelPaths: [], source: "fallback", usedFallback: true, durationMs: 0,
    notes: [], effectiveTaskArea: "general", assetMode: "none",
  };
}

const fixtureRoot = path.join(repositoryRoot, ".composer-fixture-root");

function fixtureExecutionInput(
  overrides: Partial<ContextComposerV2ExecutionInput> = {},
): ContextComposerV2ExecutionInput {
  return {
    projectId: "fixture",
    projectRoot: fixtureRoot,
    inventory: {
      rootPath: fixtureRoot,
      files: [],
      totalFiles: 0,
      scannedFiles: 0,
      truncated: false,
      notes: [],
    },
    normalizedTask: "change fixture",
    structuredTargets: [],
    protectedScopes: [],
    requestedTaskType: "general",
    effectiveTaskArea: "general",
    ...overrides,
  };
}

function validView(): ContextComposerEngineView {
  return {
    schemaVersion: 1,
    requestedMode: "v2_primary",
    effectiveSource: "v2",
    status: "v2_ready",
    stopReason: "sufficient_evidence",
    fallbackReason: null,
    files: [{
      path: "src/service.ts", role: "target", usage: "inspect-and-edit", source: "v2",
      reviewRequired: false, reasonCode: "confirmed_implementation_target",
      reasonCodes: ["confirmed_implementation_target"], findingIds: ["finding-1"], evidenceIds: ["evidence-1"],
      findings: [{
        findingId: "finding-1", type: "implementation_target",
        statement: "Current evidence identifies the implementation target.", status: "confirmed",
        authorizationHint: "eligible", limitations: [], evidenceIds: ["evidence-1"],
      }],
      evidence: [{
        evidenceId: "evidence-1", role: "supports", strength: "substantial",
        predicate: "contains", relationKind: "relation", path: "src/service.ts",
        startLine: 1, endLine: 2, reasonCode: "confirmed_implementation_target",
      }],
    }],
    unresolvedQuestions: [], limitations: [],
    comparison: {
      outcome: "insufficient_evaluation_data", exactEditablePaths: ["src/service.ts"],
      legacyOnlyEditablePaths: [], v2OnlyEditablePaths: [], safeBlockAgreement: true,
      explicitTargetDisagreements: [],
    },
  };
}

async function loadContextDiffSemantics(): Promise<{
  advanceContextDiffSession(current: any, preview: any): any;
  createContextDiffSnapshot(preview: any): any;
  compareContextDiffSnapshots(previous: any, current: any): any;
  contextDiffPathIdentity(path: string): string;
}> {
  const moduleUrl = pathToFileURL(path.join(
    repositoryRoot,
    "apps/desktop/renderer/src/components/workspace/contextDiff.ts",
  )).href;
  return import(moduleUrl) as Promise<{
    advanceContextDiffSession(current: any, preview: any): any;
    createContextDiffSnapshot(preview: any): any;
    compareContextDiffSnapshots(previous: any, current: any): any;
    contextDiffPathIdentity(path: string): string;
  }>;
}

function validTimeline(): NonNullable<ContextComposerEngineView["timeline"]> {
  const emptyEventFields: Omit<
    NonNullable<ContextComposerEngineView["timeline"]>["events"][number],
    "sequence" | "type"
  > = {
    round: null,
    operationId: null,
    operationType: null,
    operationSource: null,
    status: null,
    previousStatus: null,
    stage: null,
    decision: null,
    stopReason: null,
    reasonCode: null,
    paths: [],
    startLine: null,
    endLine: null,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    findingIds: [],
    evidenceIds: [],
  };
  return {
    events: [
      { sequence: 1, type: "seed_interpreted", ...emptyEventFields },
      {
        sequence: 2,
        type: "operation_completed",
        ...emptyEventFields,
        round: 1,
        operationId: "operation-1",
        operationType: "read_file",
        status: "completed",
        paths: ["src/service.ts"],
        startedAt: "2026-09-08T00:00:00.000Z",
        completedAt: "2026-09-08T00:00:00.010Z",
        durationMs: 10,
        evidenceIds: ["evidence-1"],
      },
      {
        sequence: 3,
        type: "stop_checked",
        ...emptyEventFields,
        round: 1,
        stage: "final",
        decision: "stop",
        stopReason: "sufficient_evidence",
      },
    ],
    coverage: {
      criticalQuestionsTotal: 1,
      criticalQuestionsAnswered: 1,
      questionsTotal: 1,
      questionsAnswered: 1,
      hypothesesTotal: 1,
      hypothesesSupported: 1,
      hypothesesRejected: 0,
      hypothesesUnresolved: 0,
      filesConsidered: 1,
      filesRead: 1,
      filesParsed: 0,
      relationshipHops: 0,
      evidenceIndependentGroups: 1,
      snapshotTruncated: false,
    },
  };
}

function contextDiffPreview(
  view: ContextComposerEngineView | null = validView(),
  overrides: {
    projectId?: number;
    rawTask?: string;
    clarifications?: Array<{ question: string; answer: string }>;
    taskType?: string;
    targetTool?: string;
  } = {},
) {
  return {
    project: { id: overrides.projectId ?? 1 },
    task: {
      originalRawTask: overrides.rawTask ?? "Update service",
      clarifications: overrides.clarifications ?? [],
      requestedTaskType: overrides.taskType ?? "general",
      targetTool: overrides.targetTool ?? "codex",
    },
    ...(view === null ? {} : { contextEngine: view }),
  };
}

function renamedContextFile(
  source: ContextComposerEngineView["files"][number],
  pathValue: string,
  suffix: string,
): ContextComposerEngineView["files"][number] {
  const file = structuredClone(source);
  file.path = pathValue;
  file.findingIds = file.findingIds.map((id) => `${id}-${suffix}`);
  file.evidenceIds = file.evidenceIds.map((id) => `${id}-${suffix}`);
  file.findings = file.findings.map((finding) => ({
    ...finding,
    findingId: `${finding.findingId}-${suffix}`,
    evidenceIds: finding.evidenceIds.map((id) => `${id}-${suffix}`),
  }));
  file.evidence = file.evidence.map((evidence) => ({
    ...evidence,
    evidenceId: `${evidence.evidenceId}-${suffix}`,
    ...(evidence.path === undefined ? {} : { path: pathValue }),
  }));
  return file;
}

for (const [name, value, expected] of [
  ["mode legacy", "legacy", "legacy"],
  ["mode shadow", "shadow_compare", "shadow_compare"],
  ["mode v2", "v2_primary", "v2_primary"],
  ["invalid mode", "primary", "legacy"],
  ["null mode", null, "legacy"],
  ["object mode", { value: "v2_primary" }, "legacy"],
] as const) scenario(name, () => assert.equal(normalizeContextComposerEngineMode(value), expected));
scenario("persisted invalid mode defaults legacy", async () => assert.equal(await readContextComposerEngineMode(async () => "invalid" as never), "legacy"));
scenario("mode is read per call", async () => {
  let value: unknown = "v2_primary";
  const read = async () => value as never;
  assert.equal(await readContextComposerEngineMode(read), "v2_primary");
  value = "legacy";
  assert.equal(await readContextComposerEngineMode(read), "legacy");
});

scenario("path explicit target", () => assert.deepEqual(deriveContextComposerExplicitTargets([
  { kind: "path", value: "src/a.ts", path: "src/a.ts", provenance: "user_confirmed" },
]), [{ kind: "path", path: "src/a.ts" }]));
scenario("backslash explicit target", () => assert.deepEqual(deriveContextComposerExplicitTargets([
  { kind: "path", value: "src\\a.ts", path: "src\\a.ts", provenance: "inventory_exact" },
]), [{ kind: "path", path: "src/a.ts" }]));
scenario("symbol explicit target", () => assert.deepEqual(deriveContextComposerExplicitTargets([
  { kind: "symbol", value: "CandidateService", provenance: "user_confirmed" },
]), [{ kind: "symbol", symbol: "CandidateService" }]));
scenario("component explicit target", () => assert.deepEqual(deriveContextComposerExplicitTargets([
  { kind: "component", value: "Card", name: "Card", provenance: "inventory_exact" },
]), [{ kind: "symbol", symbol: "Card" }]));
scenario("model target excluded", () => assert.deepEqual(deriveContextComposerExplicitTargets([
  { kind: "symbol", value: "Guess", provenance: "model_proposed" },
]), []));
scenario("ranked target excluded", () => assert.deepEqual(deriveContextComposerExplicitTargets([
  { kind: "symbol", value: "Guess", provenance: "ranked_candidate" },
]), []));
scenario("absolute path excluded", () => assert.deepEqual(deriveContextComposerExplicitTargets([
  { kind: "path", value: "C:/private/a.ts", path: "C:/private/a.ts", provenance: "user_confirmed" },
]), []));
scenario("parent path excluded", () => assert.deepEqual(deriveContextComposerExplicitTargets([
  { kind: "path", value: "../a.ts", path: "../a.ts", provenance: "user_confirmed" },
]), []));
scenario("target duplicates idempotent", () => assert.equal(deriveContextComposerExplicitTargets([
  { kind: "path", value: "src/a.ts", path: "src/a.ts", provenance: "user_confirmed" },
  { kind: "path", value: "src/a.ts", path: "src/a.ts", provenance: "user_confirmed" },
]).length, 1));
scenario("target order deterministic", () => assert.deepEqual(
  deriveContextComposerExplicitTargets([
    { kind: "path", value: "src/b.ts", path: "src/b.ts", provenance: "user_confirmed" },
    { kind: "path", value: "src/a.ts", path: "src/a.ts", provenance: "user_confirmed" },
  ]),
  deriveContextComposerExplicitTargets([
    { kind: "path", value: "src/a.ts", path: "src/a.ts", provenance: "user_confirmed" },
    { kind: "path", value: "src/b.ts", path: "src/b.ts", provenance: "user_confirmed" },
  ]),
));
scenario("target getter is not executed", () => {
  let invoked = false;
  const target = Object.defineProperty({}, "kind", { enumerable: true, get() { invoked = true; return "path"; } });
  assert.throws(() => deriveContextComposerExplicitTargets([target as never]));
  assert.equal(invoked, false);
});

scenario("wildcard negative path", () => assert.deepEqual(deriveContextComposerNegativeConstraints(["src/private/*"]), [{ kind: "path", pattern: "src/private/*" }]));
scenario("exact negative path", () => assert.deepEqual(deriveContextComposerNegativeConstraints(["src/private.ts"]), [{ kind: "path", pattern: "src/private.ts" }]));
scenario("backslash negative path", () => assert.deepEqual(deriveContextComposerNegativeConstraints(["src\\private\\*"]), [{ kind: "path", pattern: "src/private/*" }]));
scenario("semantic negative preserved", () => assert.deepEqual(deriveContextComposerNegativeConstraints(["do not change backend"]), [{ kind: "semantic", description: "do not change backend" }]));
scenario("negative duplicates idempotent", () => assert.equal(deriveContextComposerNegativeConstraints(["src/private/*", "src/private/*"]).length, 1));
scenario("negative empty ignored", () => assert.deepEqual(deriveContextComposerNegativeConstraints(["", "  "]), []));
scenario("negative order deterministic", () => assert.deepEqual(deriveContextComposerNegativeConstraints(["z/*", "a/*"]), deriveContextComposerNegativeConstraints(["a/*", "z/*"])));
scenario("semantic not positive target", () => assert.equal(deriveContextComposerExplicitTargets([{ kind: "constraint", value: "do not change api", provenance: "user_confirmed" }]).length, 0));
scenario("negative path stays relative", () => assert.equal(deriveContextComposerNegativeConstraints(["/private/root"]).every((entry) => entry.kind !== "path"), true));
scenario("negative bounded description", () => assert.ok((deriveContextComposerNegativeConstraints(["x".repeat(400)])[0] as { description: string }).description.length <= 300));

scenario("canonical Composer input is deeply frozen", () => {
  const prepared = prepareContextComposerCanonicalInput(fixtureExecutionInput());
  assert.equal(Object.isFrozen(prepared), true);
  assert.equal(Object.isFrozen(prepared.executionBasis), true);
  assert.equal(Object.isFrozen(prepared.inventory), true);
  assert.equal(Object.isFrozen(prepared.snapshot.files), true);
});
scenario("inventory root and runtime root must match", () => {
  assert.throws(() => prepareContextComposerCanonicalInput(fixtureExecutionInput({
    projectRoot: path.join(fixtureRoot, "other-project"),
  })), /canonical_input_mismatch/u);
});
scenario("identical files from another project root are rejected", async () => {
  const rootA = fs.mkdtempSync(path.join(os.tmpdir(), "composer-root-a-"));
  const rootB = fs.mkdtempSync(path.join(os.tmpdir(), "composer-root-b-"));
  fs.writeFileSync(path.join(rootA, "same.ts"), "export const same = true;\n", "utf8");
  fs.writeFileSync(path.join(rootB, "same.ts"), "export const same = true;\n", "utf8");
  const inventoryA = await scanProjectInventory(rootA);
  assert.throws(() => prepareContextComposerCanonicalInput(fixtureExecutionInput({
    projectRoot: rootB,
    inventory: inventoryA,
  })), /canonical_input_mismatch/u);
  fs.rmSync(rootA, { recursive: true, force: true });
  fs.rmSync(rootB, { recursive: true, force: true });
});
scenario("forged configuration fingerprint is rejected", () => {
  const prepared = prepareContextComposerCanonicalInput(fixtureExecutionInput());
  assert.throws(() => assertContextComposerCanonicalInput({
    ...prepared,
    configurationFingerprint: "sha256:" + "0".repeat(64),
  }), /canonical_input_mismatch/u);
});
scenario("constraint change changes fingerprint and trace identity", () => {
  const first = prepareContextComposerCanonicalInput(fixtureExecutionInput({ protectedScopes: ["src/private/*"] }));
  const second = prepareContextComposerCanonicalInput(fixtureExecutionInput({ protectedScopes: ["src/generated/*"] }));
  assert.notEqual(first.constraintFingerprint, second.constraintFingerprint);
  assert.notEqual(deriveContextComposerTraceIdentity(first).requestId, deriveContextComposerTraceIdentity(second).requestId);
  assert.notEqual(deriveContextComposerTraceIdentity(first).investigationId, deriveContextComposerTraceIdentity(second).investigationId);
});
scenario("requested task type cannot change after preparation", () => {
  const prepared = prepareContextComposerCanonicalInput(fixtureExecutionInput());
  const executionBasis = { ...prepared.executionBasis, requestedTaskType: "backend" };
  assert.throws(() => assertContextComposerCanonicalInput({ ...prepared, executionBasis }), /canonical_input_mismatch/u);
});
scenario("effective task area cannot change after preparation", () => {
  const prepared = prepareContextComposerCanonicalInput(fixtureExecutionInput());
  const executionBasis = { ...prepared.executionBasis, effectiveTaskArea: "backend" };
  assert.throws(() => assertContextComposerCanonicalInput({ ...prepared, executionBasis }), /canonical_input_mismatch/u);
});

scenario("valid view frozen", () => assert.equal(Object.isFrozen(validateContextComposerEngineView(validView())), true));
scenario("valid nested view frozen", () => assert.equal(Object.isFrozen(validateContextComposerEngineView(validView()).files[0]), true));
scenario("old view without investigation timeline remains valid", () => {
  assert.equal(validateContextComposerEngineView(validView()).timeline, undefined);
});
scenario("valid investigation timeline preserves canonical event order", () => {
  const value = validView();
  value.timeline = validTimeline();
  const validated = validateContextComposerEngineView(value);
  assert.deepEqual(validated.timeline?.events.map((event) => event.sequence), [1, 2, 3]);
  assert.deepEqual(validated.timeline?.events.map((event) => event.type), [
    "seed_interpreted", "operation_completed", "stop_checked",
  ]);
});
scenario("timeline unknown field rejected", () => {
  const value = validView() as ContextComposerEngineView & { timeline: Record<string, unknown> };
  value.timeline = { ...validTimeline(), privateReasoning: "hidden" };
  assert.throws(() => validateContextComposerEngineView(value));
});
scenario("timeline event unknown field rejected", () => {
  const value = validView();
  value.timeline = validTimeline();
  (value.timeline.events[0] as unknown as Record<string, unknown>).privateReasoning = "hidden";
  assert.throws(() => validateContextComposerEngineView(value));
});
scenario("timeline sequence reordering rejected", () => {
  const value = validView();
  value.timeline = validTimeline();
  value.timeline.events[1]!.sequence = 3;
  assert.throws(() => validateContextComposerEngineView(value));
});
scenario("timeline absolute source path rejected", () => {
  const value = validView();
  value.timeline = validTimeline();
  value.timeline.events[1]!.paths = ["C:/private/service.ts"];
  assert.throws(() => validateContextComposerEngineView(value));
});
scenario("timeline unexposed evidence rejected", () => {
  const value = validView();
  value.timeline = validTimeline();
  value.timeline.events[1]!.evidenceIds = ["evidence-private"];
  assert.throws(() => validateContextComposerEngineView(value));
});
scenario("timeline final stop mismatch rejected", () => {
  const value = validView();
  value.timeline = validTimeline();
  value.timeline.events[2]!.stopReason = "safety_blocked";
  assert.throws(() => validateContextComposerEngineView(value));
});
scenario("timeline inferred duration is not accepted without stored timestamps", () => {
  const value = validView();
  value.timeline = validTimeline();
  value.timeline.events[1]!.startedAt = null;
  assert.throws(() => validateContextComposerEngineView(value));
});
scenario("Context Diff first analysis has no fabricated previous snapshot", async () => {
  const semantics = await loadContextDiffSemantics();
  const preview = contextDiffPreview();
  const session = semantics.advanceContextDiffSession(null, preview);
  assert.equal(session.previous, null);
  assert.ok(session.current);
  assert.equal(Object.isFrozen(session.current), true);
  assert.equal(Object.isFrozen(session.current.files), true);
});
scenario("Context Diff advances only for a new preview in the same exact task scope", async () => {
  const semantics = await loadContextDiffSemantics();
  const firstPreview = contextDiffPreview();
  const first = semantics.advanceContextDiffSession(null, firstPreview);
  assert.equal(semantics.advanceContextDiffSession(first, firstPreview), first);
  const secondPreview = contextDiffPreview(structuredClone(validView()));
  const second = semantics.advanceContextDiffSession(first, secondPreview);
  assert.equal(second.previous, first.current);
  assert.notEqual(second.current, first.current);
  const anotherTask = semantics.advanceContextDiffSession(
    second,
    contextDiffPreview(structuredClone(validView()), { rawTask: "Another task" }),
  );
  assert.equal(anotherTask.previous, null);
});
scenario("Context Diff missing legacy engine view remains unavailable", async () => {
  const semantics = await loadContextDiffSemantics();
  const session = semantics.advanceContextDiffSession(null, contextDiffPreview(null));
  assert.equal(session.previous, null);
  assert.equal(session.current, null);
});
scenario("Context Diff identical analyses report only unchanged stable records", async () => {
  const semantics = await loadContextDiffSemantics();
  const previous = semantics.createContextDiffSnapshot(contextDiffPreview());
  const current = semantics.createContextDiffSnapshot(contextDiffPreview(structuredClone(validView())));
  const diff = semantics.compareContextDiffSnapshots(previous, current);
  assert.equal(diff.files.added.length, 0);
  assert.equal(diff.files.removed.length, 0);
  assert.equal(diff.files.changed.length, 0);
  assert.equal(diff.files.unchanged.length, 1);
  assert.equal(diff.findings.unchanged.length, 1);
  assert.equal(diff.evidence.unchanged.length, 1);
});
scenario("Context Diff deduplicates identical stable finding and evidence IDs", async () => {
  const semantics = await loadContextDiffSemantics();
  const view = structuredClone(validView());
  const secondFile = structuredClone(view.files[0]!);
  secondFile.path = "src/second.ts";
  view.files.push(secondFile);
  const snapshot = semantics.createContextDiffSnapshot(contextDiffPreview(view));
  assert.equal(snapshot.files.length, 2);
  assert.equal(snapshot.findings.length, 1);
  assert.equal(snapshot.evidence.length, 1);
});
scenario("Context Diff reports exact added and removed file paths", async () => {
  const semantics = await loadContextDiffSemantics();
  const previousView = validView();
  const currentView = structuredClone(previousView);
  currentView.files = [renamedContextFile(previousView.files[0]!, "src/added.ts", "added")];
  const previous = semantics.createContextDiffSnapshot(contextDiffPreview(previousView));
  const current = semantics.createContextDiffSnapshot(contextDiffPreview(currentView));
  const diff = semantics.compareContextDiffSnapshots(previous, current);
  assert.deepEqual(diff.files.added.map((file: { path: string }) => file.path), ["src/added.ts"]);
  assert.deepEqual(diff.files.removed.map((file: { path: string }) => file.path), ["src/service.ts"]);
});
scenario("Context Diff matches files only by normalized exact path and reports real field changes", async () => {
  const semantics = await loadContextDiffSemantics();
  const currentView = structuredClone(validView());
  currentView.files[0]!.path = "src\\service.ts";
  currentView.files[0]!.role = "supporting";
  currentView.files[0]!.usage = "inspect-only";
  const previous = semantics.createContextDiffSnapshot(contextDiffPreview());
  const current = semantics.createContextDiffSnapshot(contextDiffPreview(currentView));
  const diff = semantics.compareContextDiffSnapshots(previous, current);
  assert.equal(diff.files.added.length, 0);
  assert.equal(diff.files.removed.length, 0);
  assert.equal(diff.files.changed.length, 1);
  assert.deepEqual(diff.files.changed[0].changes.map((change: { field: string }) => change.field), ["role", "usage"]);
});
scenario("Context Diff preserves case-distinct repository-relative path identities", async () => {
  const semantics = await loadContextDiffSemantics();
  assert.equal(semantics.contextDiffPathIdentity("src\\Foo.ts"), "src/Foo.ts");
  assert.notEqual(
    semantics.contextDiffPathIdentity("src/Foo.ts"),
    semantics.contextDiffPathIdentity("src/foo.ts"),
  );

  const previousView = validView();
  previousView.files = [renamedContextFile(previousView.files[0]!, "src/Foo.ts", "upper")];
  const currentView = validView();
  currentView.files = [renamedContextFile(currentView.files[0]!, "src/foo.ts", "lower")];
  const previous = semantics.createContextDiffSnapshot(contextDiffPreview(previousView));
  const current = semantics.createContextDiffSnapshot(contextDiffPreview(currentView));
  const diff = semantics.compareContextDiffSnapshots(previous, current);

  assert.deepEqual(diff.files.added.map((file: { path: string }) => file.path), ["src/foo.ts"]);
  assert.deepEqual(diff.files.removed.map((file: { path: string }) => file.path), ["src/Foo.ts"]);
  assert.equal(diff.files.changed.length, 0);
  assert.equal(diff.files.unchanged.length, 0);
});
scenario("Context Diff never pairs different finding or evidence IDs heuristically", async () => {
  const semantics = await loadContextDiffSemantics();
  const currentView = structuredClone(validView());
  currentView.files[0] = renamedContextFile(currentView.files[0]!, "src/service.ts", "new");
  const previous = semantics.createContextDiffSnapshot(contextDiffPreview());
  const current = semantics.createContextDiffSnapshot(contextDiffPreview(currentView));
  const diff = semantics.compareContextDiffSnapshots(previous, current);
  assert.equal(diff.findings.added.length, 1);
  assert.equal(diff.findings.removed.length, 1);
  assert.equal(diff.findings.changed.length, 0);
  assert.equal(diff.evidence.added.length, 1);
  assert.equal(diff.evidence.removed.length, 1);
  assert.equal(diff.evidence.changed.length, 0);
});
scenario("Context Diff reports allowlisted changes for the same stable finding and evidence IDs", async () => {
  const semantics = await loadContextDiffSemantics();
  const currentView = structuredClone(validView());
  currentView.files[0]!.findings[0]!.status = "probable";
  currentView.files[0]!.evidence[0]!.strength = "conclusive";
  const previous = semantics.createContextDiffSnapshot(contextDiffPreview());
  const current = semantics.createContextDiffSnapshot(contextDiffPreview(currentView));
  const diff = semantics.compareContextDiffSnapshots(previous, current);
  assert.deepEqual(diff.findings.changed[0].changes.map((change: { field: string }) => change.field), ["status"]);
  assert.deepEqual(diff.evidence.changed[0].changes.map((change: { field: string }) => change.field), ["strength"]);
});
scenario("Context Diff safety block exposes removed prior files but no forbidden current file", async () => {
  const semantics = await loadContextDiffSemantics();
  const blocked = structuredClone(validView());
  blocked.status = "safety_blocked";
  blocked.stopReason = "safety_blocked";
  blocked.files = [];
  blocked.limitations = ["blocking_gap"];
  const previous = semantics.createContextDiffSnapshot(contextDiffPreview());
  const current = semantics.createContextDiffSnapshot(contextDiffPreview(blocked));
  const diff = semantics.compareContextDiffSnapshots(previous, current);
  assert.deepEqual(diff.files.removed.map((file: { path: string }) => file.path), ["src/service.ts"]);
  assert.equal(current.files.length, 0);
  assert.equal(diff.engineChanges.some((change: { field: string; after: string }) =>
    change.field === "status" && change.after === "safety_blocked"), true);
});
scenario("Context Diff presentation model invents no confidence relevance or health", async () => {
  const semantics = await loadContextDiffSemantics();
  const snapshot = semantics.createContextDiffSnapshot(contextDiffPreview());
  const serialized = JSON.stringify(snapshot).toLowerCase();
  assert.equal(serialized.includes("confidence"), false);
  assert.equal(serialized.includes("relevance"), false);
  assert.equal(serialized.includes("health"), false);
});
scenario("Context Diff supports exact legacy presentation snapshots when both exist", async () => {
  const semantics = await loadContextDiffSemantics();
  const legacyView = structuredClone(validView());
  legacyView.effectiveSource = "legacy";
  legacyView.status = "legacy";
  legacyView.stopReason = null;
  legacyView.files[0]!.source = "legacy";
  const previous = semantics.createContextDiffSnapshot(contextDiffPreview(legacyView));
  const current = semantics.createContextDiffSnapshot(contextDiffPreview(structuredClone(legacyView)));
  const diff = semantics.compareContextDiffSnapshots(previous, current);
  assert.equal(diff.files.unchanged.length, 1);
  assert.equal(diff.engineChanges.length, 0);
});
scenario("view validation does not mutate caller input", () => {
  const input = validView();
  validateContextComposerEngineView(input);
  assert.equal(Object.isFrozen(input), false);
  assert.equal(Object.isFrozen(input.files[0]), false);
});
scenario("legacy resolution source", () => assert.equal(createLegacyContextComposerEngineResolution({ mode: "legacy", legacySelection: legacySelection(["src/a.ts"]) }).view.effectiveSource, "legacy"));
scenario("legacy resolution retains path", () => assert.equal(createLegacyContextComposerEngineResolution({ mode: "legacy", legacySelection: legacySelection(["src/a.ts"]) }).selection?.selectedFiles[0]?.path, "src/a.ts"));
scenario("unknown top-level field rejected", () => assert.throws(() => validateContextComposerEngineView({ ...validView(), sourceContent: "private" })));
scenario("unknown file field rejected", () => {
  const value = structuredClone(validView()) as ContextComposerEngineView & { files: Array<Record<string, unknown>> };
  value.files[0]!.sourceContent = "private";
  assert.throws(() => validateContextComposerEngineView(value));
});
scenario("unknown evidence field rejected", () => {
  const value = structuredClone(validView()) as ContextComposerEngineView & { files: Array<{ evidence: Array<Record<string, unknown>> }> };
  value.files[0]!.evidence[0]!.snippet = "private";
  assert.throws(() => validateContextComposerEngineView(value));
});
scenario("unknown finding field rejected", () => {
  const value = structuredClone(validView()) as ContextComposerEngineView & { files: Array<{ findings: Array<Record<string, unknown>> }> };
  value.files[0]!.findings[0]!.rawTask = "private";
  assert.throws(() => validateContextComposerEngineView(value));
});
scenario("absolute Windows path rejected", () => { const value = structuredClone(validView()); value.files[0]!.path = "C:/private/a.ts"; assert.throws(() => validateContextComposerEngineView(value)); });
scenario("absolute Unix path rejected", () => { const value = structuredClone(validView()); value.files[0]!.path = "/private/a.ts"; assert.throws(() => validateContextComposerEngineView(value)); });
scenario("parent path rejected", () => { const value = structuredClone(validView()); value.files[0]!.path = "../a.ts"; assert.throws(() => validateContextComposerEngineView(value)); });
scenario("unknown role rejected", () => { const value = structuredClone(validView()) as any; value.files[0].role = "owner"; assert.throws(() => validateContextComposerEngineView(value)); });
scenario("unknown usage rejected", () => { const value = structuredClone(validView()) as any; value.files[0].usage = "edit"; assert.throws(() => validateContextComposerEngineView(value)); });
scenario("unknown status rejected", () => { const value = structuredClone(validView()) as any; value.status = "ready"; assert.throws(() => validateContextComposerEngineView(value)); });
scenario("unknown stop rejected", () => { const value = structuredClone(validView()) as any; value.stopReason = "done"; assert.throws(() => validateContextComposerEngineView(value)); });
scenario("unknown reason rejected", () => { const value = structuredClone(validView()) as any; value.files[0].reasonCode = "raw_error"; assert.throws(() => validateContextComposerEngineView(value)); });
scenario("unknown predicate rejected", () => { const value = structuredClone(validView()); value.files[0]!.evidence[0]!.predicate = "raw_user_text"; assert.throws(() => validateContextComposerEngineView(value)); });
scenario("source identity predicate accepted", () => {
  const value = structuredClone(validView());
  value.files[0]!.evidence[0]!.predicate = "source_identity";
  assert.equal(validateContextComposerEngineView(value).files[0]!.evidence[0]!.predicate, "source_identity");
});
scenario("source identity predicate near miss rejected", () => {
  const value = structuredClone(validView());
  value.files[0]!.evidence[0]!.predicate = "source-identity";
  assert.throws(() => validateContextComposerEngineView(value));
});
scenario("arbitrary injected predicate rejected", () => {
  const value = structuredClone(validView());
  value.files[0]!.evidence[0]!.predicate = "source_identity;drop_boundary";
  assert.throws(() => validateContextComposerEngineView(value));
});
scenario("lead-only target evidence rejected", () => { const value = structuredClone(validView()); value.files[0]!.evidence[0]!.strength = "lead"; assert.throws(() => validateContextComposerEngineView(value)); });
scenario("context-only target evidence rejected", () => { const value = structuredClone(validView()); value.files[0]!.evidence[0]!.role = "context_only"; assert.throws(() => validateContextComposerEngineView(value)); });
scenario("decision evidence trace mismatch rejected", () => { const value = structuredClone(validView()); value.files[0]!.evidence[0]!.evidenceId = "evidence-other"; assert.throws(() => validateContextComposerEngineView(value)); });
scenario("finding detail trace mismatch rejected", () => { const value = structuredClone(validView()); value.files[0]!.findings[0]!.findingId = "finding-other"; assert.throws(() => validateContextComposerEngineView(value)); });
scenario("finding evidence outside file trace rejected", () => { const value = structuredClone(validView()); value.files[0]!.findings[0]!.evidenceIds = ["evidence-other"]; assert.throws(() => validateContextComposerEngineView(value)); });
scenario("duplicate file path rejected", () => { const value = structuredClone(validView()); value.files.push(structuredClone(value.files[0]!)); assert.throws(() => validateContextComposerEngineView(value)); });
scenario("duplicate finding IDs rejected", () => { const value = structuredClone(validView()); value.files[0]!.findingIds = ["finding-1", "finding-1"]; assert.throws(() => validateContextComposerEngineView(value)); });
scenario("unsorted IDs rejected", () => { const value = structuredClone(validView()); value.files[0]!.findingIds = ["finding-z", "finding-a"]; assert.throws(() => validateContextComposerEngineView(value)); });
scenario("sparse files rejected", () => { const value = structuredClone(validView()); value.files.length = 2; assert.throws(() => validateContextComposerEngineView(value)); });
scenario("negative line rejected", () => { const value = structuredClone(validView()); value.files[0]!.evidence[0]!.startLine = -1; assert.throws(() => validateContextComposerEngineView(value)); });
scenario("NaN line rejected", () => { const value = structuredClone(validView()); value.files[0]!.evidence[0]!.startLine = Number.NaN; assert.throws(() => validateContextComposerEngineView(value)); });
scenario("getter not executed", () => {
  let invoked = false;
  const value = Object.defineProperty({}, "schemaVersion", { enumerable: true, get() { invoked = true; return 1; } });
  assert.throws(() => validateContextComposerEngineView(value));
  assert.equal(invoked, false);
});
scenario("custom prototype rejected", () => { const value = Object.assign(Object.create({ unsafe: true }), validView()); assert.throws(() => validateContextComposerEngineView(value)); });
scenario("control text rejected", () => { const value = structuredClone(validView()); value.files[0]!.findingIds = ["bad\u0000id"]; assert.throws(() => validateContextComposerEngineView(value)); });
scenario("path-like finding ID rejected", () => { const value = structuredClone(validView()); value.files[0]!.findingIds = ["C:/private/finding"]; assert.throws(() => validateContextComposerEngineView(value)); });

scenario("tracker accepts execution", async () => {
  const tracker = createContextComposerExecutionTracker({ maximumActiveExecutions: 1 });
  const execution = tracker.tryTrack({ abortController: new AbortController(), start: async () => 7 });
  assert.equal(await execution, 7);
  assert.equal(tracker.state().active, 0);
});
scenario("tracker capacity bounded", () => {
  const tracker = createContextComposerExecutionTracker({ maximumActiveExecutions: 1 });
  tracker.tryTrack({ abortController: new AbortController(), start: () => new Promise(() => {}) });
  assert.equal(tracker.tryTrack({ abortController: new AbortController(), start: async () => 1 }), null);
  assert.equal(tracker.state().capacity, 1);
});
scenario("tracker counts skipped", () => {
  const tracker = createContextComposerExecutionTracker({ maximumActiveExecutions: 1 });
  tracker.tryTrack({ abortController: new AbortController(), start: () => new Promise(() => {}) });
  tracker.tryTrack({ abortController: new AbortController(), start: async () => 1 });
  assert.equal(tracker.state().skipped, 1);
});
scenario("tracker rejection observed", async () => {
  const tracker = createContextComposerExecutionTracker();
  await assert.rejects(tracker.tryTrack({ abortController: new AbortController(), start: async () => { throw new Error("expected"); } })!);
  assert.equal(tracker.state().active, 0);
});
scenario("tracker close bounded", async () => {
  const tracker = createContextComposerExecutionTracker();
  tracker.tryTrack({ abortController: new AbortController(), start: () => new Promise(() => {}) });
  assert.equal(await tracker.close(5), false);
  assert.equal(tracker.state().closed, true);
});
scenario("closed tracker skips", async () => {
  const tracker = createContextComposerExecutionTracker();
  await tracker.close(0);
  assert.equal(tracker.tryTrack({ abortController: new AbortController(), start: async () => 1 }), null);
});

for (const [name, message, expected] of [
  ["execution error fallback", "boom", "v2_execution_error"],
  ["timeout fallback", "v2_execution_timeout", "v2_execution_timeout"],
  ["capacity fallback", "v2_capacity_exhausted", "v2_capacity_exhausted"],
] as const) scenario(name, async () => {
  const resolution = await resolveContextComposerEngine({
    mode: "v2_primary",
    legacySelection: legacySelection(["src/legacy.ts"]),
    executionInput: fixtureExecutionInput(),
    executor: async () => { throw new Error(message); },
  });
  assert.equal(resolution.view.status, "legacy_fallback");
  assert.equal(resolution.view.fallbackReason, expected);
  assert.equal(resolution.selection?.selectedFiles[0]?.path, "src/legacy.ts");
});

scenario("canonical input mismatch never returns legacy candidates", async () => {
  const resolution = await resolveContextComposerEngine({
    mode: "v2_primary",
    legacySelection: legacySelection(["src/legacy.ts"]),
    executionInput: fixtureExecutionInput({ projectRoot: path.join(fixtureRoot, "wrong") }),
    executor: async () => { throw new Error("must_not_run"); },
  });
  assert.equal(resolution.view.status, "safety_blocked");
  assert.deepEqual(resolution.view.limitations, ["canonical_input_mismatch"]);
  assert.equal(resolution.selection, null);
  assert.equal(resolution.useLegacySelection, false);
});

scenario("shadow failure preserves legacy", async () => {
  const selection = legacySelection(["src/legacy.ts"]);
  const resolution = await resolveContextComposerEngine({
    mode: "shadow_compare", legacySelection: selection,
    executionInput: fixtureExecutionInput(),
    executor: async () => { throw new Error("expected"); },
  });
  assert.equal(resolution.useLegacySelection, true);
  assert.equal(resolution.selection, selection);
});
scenario("legacy mode invokes no v2 work", async () => {
  let calls = 0;
  const resolution = await resolveContextComposerEngine({
    mode: "legacy", legacySelection: legacySelection(["src/legacy.ts"]),
    executionInput: fixtureExecutionInput(),
    executor: async () => { calls += 1; throw new Error("must not run"); },
  });
  assert.equal(calls, 0);
  assert.equal(resolution.view.status, "legacy");
});
scenario("arbitrary executor error is redacted", async () => {
  const marker = "SECRET_TOKEN_SOURCE_FRAGMENT";
  const resolution = await resolveContextComposerEngine({
    mode: "v2_primary", legacySelection: legacySelection(),
    executionInput: fixtureExecutionInput(),
    executor: async () => { throw new Error(marker); },
  });
  assert.equal(JSON.stringify(resolution.view).includes(marker), false);
  assert.equal(resolution.view.fallbackReason, "v2_execution_error");
});
scenario("presentation markdown is rejected by live executor", async () => {
  await assert.rejects(executeContextComposerV2(fixtureExecutionInput({
    normalizedTask: "## User Clarifications\nQuestion: target?\nUser answer: secret",
  })), /invalid_composer_semantic_task/u);
});
scenario("live execution input accessor is not executed", async () => {
  let invoked = false;
  const value = Object.defineProperty({}, "normalizedTask", { enumerable: true, get() { invoked = true; return "change"; } });
  await assert.rejects(executeContextComposerV2(value as never), /canonical_input_mismatch/u);
  assert.equal(invoked, false);
});

let realExecution: Awaited<ReturnType<typeof executeContextComposerV2>> | null = null;
let realExecutionInput: ContextComposerV2ExecutionInput | null = null;
let realResolution: ContextComposerEngineResolution | null = null;
scenario("real engine grounded path executes loop", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "contextforge-composer-"));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "candidate.ts"), "export function CandidateService() { return true; }\n", "utf8");
  const inventory = await scanProjectInventory(root);
  realExecutionInput = {
    projectId: "composer-grounded", projectRoot: root, inventory,
    normalizedTask: "Update the implementation in src/candidate.ts",
    structuredTargets: [{ kind: "path", value: "src/candidate.ts", path: "src/candidate.ts", provenance: "user_confirmed" }],
    protectedScopes: [], requestedTaskType: "general", effectiveTaskArea: "general",
    timeoutMs: 3_000,
  };
  realExecution = await executeContextComposerV2(realExecutionInput);
  assert.ok(realExecution.result.operationRecords.some((record) => ["read_file", "parse_file"].includes(record.operation.type)));
  assert.equal(realExecution.snapshot.files.some((file) => file.normalizedPath === "src/candidate.ts"), true);
  fs.rmSync(root, { recursive: true, force: true });
});
scenario("real engine result projects safely or reviews", () => {
  assert.ok(realExecution);
  assert.equal(realExecution.result.stop.reason, "sufficient_evidence");
  assert.equal(realExecution.result.safeToProject, true);
  assert.equal(realExecution.projection.projection.snapshotId, realExecution.snapshot.id);
});
scenario("real grounded v2 primary is ready", async () => {
  assert.ok(realExecution);
  assert.ok(realExecutionInput);
  const resolution = await resolveContextComposerEngine({
    mode: "v2_primary",
    legacySelection: legacySelection(),
    executionInput: realExecutionInput,
    executor: async () => realExecution!,
  });
  realResolution = resolution;
  assert.equal(resolution.view.status, "v2_ready");
  assert.equal(resolution.view.effectiveSource, "v2");
  assert.equal(resolution.view.fallbackReason, null);
  assert.equal(resolution.selection?.selectedFiles[0]?.path, "src/candidate.ts");
  assert.equal(resolution.view.files.length, 1);
  const file = resolution.view.files[0]!;
  assert.equal(file.path, "src/candidate.ts");
  assert.equal(file.role, "target");
  assert.equal(file.usage, "inspect-and-edit");
  assert.equal(file.source, "v2");
  assert.ok(file.findingIds.length > 0);
  assert.equal(file.findings.length, file.findingIds.length);
  assert.ok(file.evidenceIds.length > 0);
  assert.equal(file.evidence.length, 1);
  assert.equal(file.evidence[0]!.predicate, "source_identity");
  assert.equal(file.evidence[0]!.role, "supports");
  assert.notEqual(file.evidence[0]!.strength, "lead");
  assert.equal(file.evidence[0]!.reasonCode, "confirmed_implementation_target");
  const projectedFinding = file.findings[0]!;
  const sourceFinding = realExecution.projection.projection.findings.find(
    (finding) => finding.id as string === projectedFinding.findingId,
  );
  assert.ok(sourceFinding);
  assert.equal(projectedFinding.type, sourceFinding.type);
  assert.equal(projectedFinding.statement, sourceFinding.statement);
  assert.equal(projectedFinding.status, sourceFinding.status);
  assert.equal(projectedFinding.authorizationHint, sourceFinding.authorizationHint);
  assert.deepEqual(
    projectedFinding.evidenceIds,
    sourceFinding.evidenceIds
      .map((evidenceId) => evidenceId as string)
      .filter((evidenceId) => file.evidenceIds.includes(evidenceId))
      .sort(),
  );
  assert.equal(resolution.view.comparison?.outcome, "insufficient_evaluation_data");
});
scenario("real investigation timeline preserves runner order and stored operation metadata", () => {
  assert.ok(realExecution);
  assert.ok(realResolution?.view.timeline);
  const timeline = realResolution.view.timeline;
  assert.deepEqual(
    timeline.events.map((event) => event.type),
    realExecution.result.trace.map((event) => event.type),
  );
  assert.deepEqual(
    timeline.events.map((event) => event.sequence),
    timeline.events.map((_, index) => index + 1),
  );
  const finalEvent = timeline.events.at(-1);
  assert.equal(finalEvent?.type, "stop_checked");
  assert.equal(finalEvent?.stage, "final");
  assert.equal(finalEvent?.decision, "stop");
  assert.equal(finalEvent?.stopReason, realResolution.view.stopReason);
  const completed = timeline.events.find((event) => event.type === "operation_completed" && event.startedAt);
  assert.ok(completed?.operationId);
  const record = realExecution.result.operationRecords.find(
    (candidate) => candidate.operation.id as string === completed.operationId,
  );
  assert.ok(record);
  assert.equal(completed.startedAt, record.startedAt);
  assert.equal(completed.completedAt, record.completedAt);
  assert.equal(completed.durationMs, record.actualCost?.wallTimeMs ?? null);
  assert.equal(completed.paths.every((pathValue) => pathValue === "src/candidate.ts"), true);
  assert.equal("blockedScopes" in timeline.coverage, false);
});
scenario("private runtime trace fields are not serialized into the Composer timeline", async () => {
  assert.ok(realExecution);
  assert.ok(realExecutionInput);
  const marker = "PRIVATE_REASONING_MARKER";
  const execution = structuredClone(realExecution) as typeof realExecution;
  (execution.result.trace[0] as unknown as Record<string, unknown>).privateReasoning = marker;
  const resolution = await resolveContextComposerEngine({
    mode: "v2_primary",
    legacySelection: legacySelection(),
    executionInput: realExecutionInput,
    executor: async () => execution,
  });
  assert.equal(resolution.view.status, "v2_ready");
  assert.equal(JSON.stringify(resolution.view).includes(marker), false);
});
scenario("unknown runtime trace event blocks the Composer view safely", async () => {
  assert.ok(realExecution);
  assert.ok(realExecutionInput);
  const execution = structuredClone(realExecution) as typeof realExecution;
  (execution.result.trace[0] as unknown as Record<string, unknown>).type = "private_reasoning";
  const resolution = await resolveContextComposerEngine({
    mode: "v2_primary",
    legacySelection: legacySelection(["src/legacy.ts"]),
    executionInput: realExecutionInput,
    executor: async () => execution,
  });
  assert.equal(resolution.view.status, "safety_blocked");
  assert.deepEqual(resolution.view.limitations, ["v2_integrity_violation"]);
  assert.equal(resolution.selection, null);
  assert.equal(resolution.view.timeline, undefined);
});
scenario("malformed operation trace linkage blocks the Composer view safely", async () => {
  assert.ok(realExecution);
  assert.ok(realExecutionInput);
  const execution = structuredClone(realExecution) as typeof realExecution;
  const completed = execution.result.trace.find((event) => event.type === "operation_completed");
  assert.ok(completed && completed.type === "operation_completed");
  completed.producedEvidenceIds = [...completed.producedEvidenceIds, "evidence-forged" as typeof completed.producedEvidenceIds[number]];
  const resolution = await resolveContextComposerEngine({
    mode: "v2_primary",
    legacySelection: legacySelection(["src/legacy.ts"]),
    executionInput: realExecutionInput,
    executor: async () => execution,
  });
  assert.equal(resolution.view.status, "safety_blocked");
  assert.deepEqual(resolution.view.limitations, ["v2_integrity_violation"]);
  assert.equal(resolution.selection, null);
});
scenario("malformed comparison blocks safely", async () => {
  assert.ok(realExecution);
  assert.ok(realExecutionInput);
  const malformed = {
    ...realExecution,
    snapshot: { ...realExecution.snapshot, id: "snapshot_wrong" },
  } as never;
  const resolution = await resolveContextComposerEngine({
    mode: "v2_primary", legacySelection: legacySelection(),
    executionInput: realExecutionInput,
    executor: async () => malformed,
  });
  assert.equal(resolution.view.status, "safety_blocked");
  assert.equal(resolution.selection, null);
  assert.equal(JSON.stringify(resolution.view).includes("private"), false);
});
scenario("mixed snapshot executor result blocks safely", async () => {
  assert.ok(realExecution);
  assert.ok(realExecutionInput);
  const mixed = structuredClone(realExecution) as typeof realExecution;
  mixed.result.snapshotId = "snapshot_other" as typeof mixed.result.snapshotId;
  const resolution = await resolveContextComposerEngine({
    mode: "v2_primary",
    legacySelection: legacySelection(["src/legacy.ts"]),
    executionInput: realExecutionInput,
    executor: async () => mixed,
  });
  assert.equal(resolution.view.status, "safety_blocked");
  assert.equal(resolution.selection, null);
});
scenario("invalid evidence provenance blocks safely", async () => {
  assert.ok(realExecution);
  assert.ok(realExecutionInput);
  const malformed = structuredClone(realExecution) as typeof realExecution;
  const evidenceWithSpan = malformed.result.evidence.find((entry) => entry.sourceSpans.length > 0);
  assert.ok(evidenceWithSpan);
  evidenceWithSpan.sourceSpans[0]!.contentFingerprint = "sha256:forged";
  const resolution = await resolveContextComposerEngine({
    mode: "v2_primary",
    legacySelection: legacySelection(["src/legacy.ts"]),
    executionInput: realExecutionInput,
    executor: async () => malformed,
  });
  assert.equal(resolution.view.status, "safety_blocked");
  assert.equal(resolution.selection, null);
});
scenario("projection safety-state mismatch blocks safely", async () => {
  assert.ok(realExecution);
  assert.ok(realExecutionInput);
  const malformed = structuredClone(realExecution) as typeof realExecution;
  malformed.projection.source.safeToProject = false;
  const resolution = await resolveContextComposerEngine({
    mode: "v2_primary",
    legacySelection: legacySelection(["src/legacy.ts"]),
    executionInput: realExecutionInput,
    executor: async () => malformed,
  });
  assert.equal(resolution.view.status, "safety_blocked");
  assert.equal(resolution.selection, null);
});
scenario("safety block never falls back to legacy candidates", async () => {
  assert.ok(realExecution);
  assert.ok(realExecutionInput);
  const blocked = structuredClone(realExecution) as typeof realExecution;
  blocked.result.stop.reason = "safety_blocked";
  blocked.result.stop.safeToProject = false;
  blocked.result.safeToProject = false;
  const resolution = await resolveContextComposerEngine({
    mode: "v2_primary", legacySelection: legacySelection(["src/legacy.ts"]),
    executionInput: realExecutionInput,
    executor: async () => blocked,
  });
  assert.equal(resolution.view.status, "safety_blocked");
  assert.equal(resolution.selection, null);
  assert.equal(resolution.view.files.length, 0);
});
scenario("shadow compare keeps legacy candidates", async () => {
  assert.ok(realExecution);
  assert.ok(realExecutionInput);
  const legacy = legacySelection(["src/legacy.ts"]);
  const resolution = await resolveContextComposerEngine({
    mode: "shadow_compare", legacySelection: legacy,
    executionInput: realExecutionInput,
    executor: async () => realExecution!,
  });
  assert.equal(resolution.selection, legacy);
  assert.equal(resolution.view.effectiveSource, "legacy");
  assert.equal(resolution.view.files.some((file) => file.path === "src/candidate.ts"), true);
});
scenario("mode rollback restores legacy immediately", async () => {
  assert.ok(realExecution);
  assert.ok(realExecutionInput);
  const legacy = legacySelection(["src/legacy.ts"]);
  const v2 = await resolveContextComposerEngine({
    mode: "v2_primary", legacySelection: legacy,
    executionInput: realExecutionInput,
    executor: async () => realExecution!,
  });
  const rolledBack = createLegacyContextComposerEngineResolution({ mode: "legacy", legacySelection: legacy });
  assert.notEqual(v2.selection?.selectedFiles[0]?.path, rolledBack.selection?.selectedFiles[0]?.path);
  assert.equal(rolledBack.selection?.selectedFiles[0]?.path, "src/legacy.ts");
});
scenario("real engine safe unresolved has no editable target", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "contextforge-composer-safe-"));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "unrelated.ts"), "export const unrelated = true;\n", "utf8");
  const inventory = await scanProjectInventory(root);
  const execution = await executeContextComposerV2({
    projectId: "composer-safe", projectRoot: root, inventory,
    normalizedTask: "Investigate the missing owner without changing private code",
    structuredTargets: [], protectedScopes: ["src/private/*"],
    requestedTaskType: "general", effectiveTaskArea: "general", timeoutMs: 3_000,
  });
  assert.notEqual(execution.result.stop.reason, "sufficient_evidence");
  assert.equal(execution.projection.decisions.some((decision) => decision.included && (decision.role === "target" || decision.role === "test")), false);
  fs.rmSync(root, { recursive: true, force: true });
});
scenario("negative explicit target never falls back to editable legacy path", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "contextforge-composer-negative-"));
  fs.mkdirSync(path.join(root, "src", "private"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "private", "secret.ts"), "export const privateValue = true;\n", "utf8");
  const inventory = await scanProjectInventory(root);
  const executionInput = {
    projectId: "composer-negative", projectRoot: root, inventory,
    normalizedTask: "Change src/private/secret.ts",
    structuredTargets: [{ kind: "path", value: "src/private/secret.ts", path: "src/private/secret.ts", provenance: "user_confirmed" }],
    protectedScopes: ["src/private/*"], requestedTaskType: "general", effectiveTaskArea: "general",
    timeoutMs: 3_000,
  } as const;
  const execution = await executeContextComposerV2(executionInput);
  const resolution = await resolveContextComposerEngine({
    mode: "v2_primary", legacySelection: legacySelection(["src/private/secret.ts"]), executionInput,
    executor: async () => execution,
  });
  assert.equal(resolution.view.status, "safety_blocked");
  assert.equal(resolution.selection, null);
  assert.ok(resolution.view.timeline);
  assert.equal(resolution.view.timeline.events.length > 0, true);
  assert.equal(resolution.view.timeline.events.at(-1)?.stopReason, resolution.view.stopReason);
  assert.equal(resolution.view.timeline.events.every((event) =>
    event.paths.length === 0 && event.findingIds.length === 0 && event.evidenceIds.length === 0), true);
  fs.rmSync(root, { recursive: true, force: true });
});
scenario("secret target never becomes Composer editable", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "contextforge-composer-secret-"));
  fs.writeFileSync(path.join(root, ".env"), "API_TOKEN=fixture-secret\n", "utf8");
  const inventory = await scanProjectInventory(root);
  const executionInput = { projectId: "composer-secret", projectRoot: root, inventory, normalizedTask: "Change .env", structuredTargets: [{ kind: "path", value: ".env", path: ".env", provenance: "user_confirmed" }], protectedScopes: [], requestedTaskType: "general", effectiveTaskArea: "general", timeoutMs: 3_000 } as const;
  const execution = await executeContextComposerV2(executionInput);
  const resolution = await resolveContextComposerEngine({ mode: "v2_primary", legacySelection: legacySelection([".env"]), executionInput, executor: async () => execution });
  assert.equal(resolution.selection, null);
  assert.equal(resolution.view.files.some((file) => file.usage === "inspect-and-edit"), false);
  assert.equal(JSON.stringify(resolution.view).includes("fixture-secret"), false);
  fs.rmSync(root, { recursive: true, force: true });
});
scenario("generated target never becomes Composer editable", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "contextforge-composer-generated-"));
  fs.mkdirSync(path.join(root, "src", "generated"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "generated", "auto.ts"), "export const generated = true;\n", "utf8");
  const inventory = await scanProjectInventory(root);
  const executionInput = { projectId: "composer-generated", projectRoot: root, inventory, normalizedTask: "Change src/generated/auto.ts", structuredTargets: [{ kind: "path", value: "src/generated/auto.ts", path: "src/generated/auto.ts", provenance: "user_confirmed" }], protectedScopes: [], requestedTaskType: "general", effectiveTaskArea: "general", timeoutMs: 3_000 } as const;
  const execution = await executeContextComposerV2(executionInput);
  const resolution = await resolveContextComposerEngine({ mode: "v2_primary", legacySelection: legacySelection(["src/generated/auto.ts"]), executionInput, executor: async () => execution });
  assert.equal(resolution.selection, null);
  assert.equal(resolution.view.files.some((file) => file.usage === "inspect-and-edit"), false);
  fs.rmSync(root, { recursive: true, force: true });
});
scenario("unreadable target never becomes Composer editable", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "contextforge-composer-unreadable-"));
  fs.mkdirSync(path.join(root, "assets"), { recursive: true });
  fs.writeFileSync(path.join(root, "assets", "image.png"), Buffer.from([0, 1, 2, 3]));
  const inventory = await scanProjectInventory(root);
  const executionInput = { projectId: "composer-unreadable", projectRoot: root, inventory, normalizedTask: "Change assets/image.png", structuredTargets: [{ kind: "path", value: "assets/image.png", path: "assets/image.png", provenance: "user_confirmed" }], protectedScopes: [], requestedTaskType: "general", effectiveTaskArea: "general", timeoutMs: 3_000 } as const;
  const execution = await executeContextComposerV2(executionInput);
  const resolution = await resolveContextComposerEngine({ mode: "v2_primary", legacySelection: legacySelection(["assets/image.png"]), executionInput, executor: async () => execution });
  assert.equal(resolution.view.files.some((file) => file.usage === "inspect-and-edit"), false);
  fs.rmSync(root, { recursive: true, force: true });
});

scenario("view export excludes raw task", () => assert.equal(JSON.stringify(validateContextComposerEngineView(validView())).includes("change fixture"), false));
scenario("view export excludes source content", () => assert.equal(JSON.stringify(validateContextComposerEngineView(validView())).includes("export function"), false));
scenario("view export excludes absolute root", () => assert.equal(JSON.stringify(validateContextComposerEngineView(validView())).includes(repositoryRoot), false));
scenario("view export excludes prompts", () => assert.equal(JSON.stringify(validateContextComposerEngineView(validView())).toLowerCase().includes("prompt"), false));
scenario("view export excludes confidence", () => assert.equal(JSON.stringify(validateContextComposerEngineView(validView())).toLowerCase().includes("confidence"), false));
scenario("comparison aggregate is deterministic", () => {
  const comparison = validView().comparison!;
  assert.deepEqual(aggregateContextComposerComparisons([comparison, { ...comparison, safeBlockAgreement: false }]), aggregateContextComposerComparisons([{ ...comparison, safeBlockAgreement: false }, comparison]));
});
scenario("comparison aggregate does not invent winner", () => {
  const aggregate = aggregateContextComposerComparisons([validView().comparison!]);
  assert.equal(aggregate.insufficientEvaluationDataCount, 1);
  assert.equal(aggregate.comparisonCount, 1);
});
scenario("comparison aggregate accessor is not executed", () => {
  let invoked = false;
  const comparison = Object.defineProperty({}, "outcome", { enumerable: true, get() { invoked = true; return "insufficient_evaluation_data"; } });
  assert.throws(() => aggregateContextComposerComparisons([comparison as never]));
  assert.equal(invoked, false);
});
scenario("manual modal calls selected paths only", () => {
  const source = fs.readFileSync(path.join(repositoryRoot, "apps/desktop/renderer/src/components/modals/ContextComposerModal.tsx"), "utf8");
  assert.match(source, /onGenerate\(selectedPaths\)/u);
  assert.doesNotMatch(source, /onGenerate\([^)]*contextEngine/u);
});
scenario("manual page calls selected paths only", () => {
  const source = fs.readFileSync(path.join(repositoryRoot, "apps/desktop/renderer/src/pages/ContextComposerPage.tsx"), "utf8");
  assert.match(source, /onGenerate\(selectedPaths\)/u);
  assert.doesNotMatch(source, /onGenerate\([^)]*contextEngine/u);
});
scenario("composer does not import shadow", () => {
  const source = fs.readFileSync(path.join(repositoryRoot, "server/src/contextEngineV2/composer/contextComposerEngine.ts"), "utf8");
  assert.doesNotMatch(source, /\/shadow\//u);
});
scenario("composer does not import validation", () => {
  const source = fs.readFileSync(path.join(repositoryRoot, "server/src/contextEngineV2/composer/contextComposerEngine.ts"), "utf8");
  assert.doesNotMatch(source, /\/validation\//u);
});
scenario("v2 groups do not call legacy scorer", () => {
  const source = fs.readFileSync(path.join(repositoryRoot, "server/src/contextComposer/contextComposerService.ts"), "utf8");
  assert.match(source, /contextEngineResolution\.useLegacySelection\s*\?/u);
  assert.match(source, /buildContextEngineSuggestedFileGroups/u);
});
scenario("v2 groups do not synthesize confidence percentages", () => {
  const source = fs.readFileSync(path.join(repositoryRoot, "server/src/contextComposer/contextComposerService.ts"), "utf8");
  const start = source.indexOf("function buildContextEngineSuggestedFileGroups");
  const end = source.indexOf("async function readFileSnippet", start);
  const body = source.slice(start, end);
  assert.doesNotMatch(body, /0\.99|0\.90|0\.9\b|0\.70|0\.7\b|0\.50|0\.5\b/u);
  assert.match(body, /confidenceDisplay:\s*"unavailable"/u);
});
scenario("Modal hides percentage for v2 files", () => {
  const source = fs.readFileSync(path.join(repositoryRoot, "apps/desktop/renderer/src/components/modals/ContextComposerModal.tsx"), "utf8");
  assert.match(source, /confidenceDisplay\s*!==\s*"unavailable"/u);
  assert.match(source, /legacyConfidence\s*===\s*null/u);
  assert.doesNotMatch(source, /formatPercent\(file\.confidence\)/u);
});
scenario("Context Files workspace hides percentage for v2 files", () => {
  const source = fs.readFileSync(path.join(repositoryRoot, "apps/desktop/renderer/src/components/contextComposer/contextFiles/ContextFilesWorkspace.tsx"), "utf8");
  assert.match(source, /confidenceDisplay\s*!==\s*"unavailable"/u);
  assert.match(source, /legacyConfidence\s*!==\s*null/u);
  assert.match(source, /formatPercent\(legacyConfidence\)/u);
  assert.doesNotMatch(source, /formatPercent\(file\.confidence\)/u);
});
scenario("legacy confidence display remains available", () => {
  const modal = fs.readFileSync(path.join(repositoryRoot, "apps/desktop/renderer/src/components/modals/ContextComposerModal.tsx"), "utf8");
  const workspace = fs.readFileSync(path.join(repositoryRoot, "apps/desktop/renderer/src/components/contextComposer/contextFiles/ContextFilesWorkspace.tsx"), "utf8");
  assert.match(modal, /formatPercent\(legacyConfidence\)/u);
  assert.match(workspace, /formatPercent\(legacyConfidence\)/u);
});
scenario("effective preview quality is evaluated from effective selection", () => {
  const source = fs.readFileSync(path.join(repositoryRoot, "server/src/contextComposer/contextComposerService.ts"), "utf8");
  assert.match(source, /fileSelection:\s*fileSelectionForPreview/u);
  assert.match(source, /qualitySource/u);
  assert.match(source, /status:\s*"ready"/u);
});
scenario("renderer preview accepts absent Context Engine metadata", () => {
  const types = fs.readFileSync(path.join(repositoryRoot, "apps/desktop/renderer/src/types/index.ts"), "utf8");
  const modal = fs.readFileSync(path.join(repositoryRoot, "apps/desktop/renderer/src/components/modals/ContextComposerModal.tsx"), "utf8");
  const page = fs.readFileSync(path.join(repositoryRoot, "apps/desktop/renderer/src/pages/ContextComposerPage.tsx"), "utf8");
  assert.match(types, /contextEngine\?:\s*ContextComposerEngineView/u);
  assert.match(modal, /preview\.contextEngine\s*&&\s*\(?\s*<ContextComposerEnginePanel/u);
  assert.match(page, /preview\.contextEngine\s*&&\s*\(?\s*<ContextComposerEnginePanel/u);
});
for (const [name, preview, expected] of [
  ["v2 ready ignores legacy selector abstention", { contextEngine: { effectiveSource: "v2", status: "v2_ready" }, qualitySource: "v2_grounded" }, false],
  ["v2 review ignores legacy selector abstention", { contextEngine: { effectiveSource: "v2", status: "v2_review_required" }, qualitySource: "review_required" }, false],
  ["v2 safety block ignores legacy selector abstention", { contextEngine: { effectiveSource: "v2", status: "safety_blocked" }, qualitySource: "blocked" }, false],
  ["legacy mode retains selector abstention", { contextEngine: { effectiveSource: "legacy", status: "legacy" }, qualitySource: "legacy_quality" }, true],
  ["shadow compare retains selector abstention", { contextEngine: { effectiveSource: "legacy", status: "v2_ready" }, qualitySource: "legacy_quality" }, true],
  ["legacy fallback retains selector abstention", { contextEngine: { effectiveSource: "legacy", status: "legacy_fallback" }, qualitySource: "legacy_quality" }, true],
  ["old payload retains selector abstention", {}, true],
] as const) scenario(name, async () => {
  const semantics = await loadComposerUiSemantics();
  assert.equal(semantics.usesLegacySelectorSemantics(preview as never), expected);
});
scenario("Page gates selector abstention by effective preview source", () => {
  const page = fs.readFileSync(path.join(repositoryRoot, "apps/desktop/renderer/src/pages/ContextComposerPage.tsx"), "utf8");
  assert.match(page, /usesLegacySelectorSemantics\(preview\)\s*&&\s*preview\.selectorDiagnostics/u);
});
scenario("known v2 reason resolves to localized translation key", async () => {
  const semantics = await loadComposerUiSemantics();
  assert.equal(
    semantics.getContextComposerFileReasonTranslationKey({ source: "v2", engineReasonCode: "confirmed_implementation_target" }),
    "settings.composerEngineReason_confirmed_implementation_target",
  );
});
scenario("unknown v2 reason resolves to localized safe fallback", async () => {
  const semantics = await loadComposerUiSemantics();
  assert.equal(
    semantics.getContextComposerFileReasonTranslationKey({ source: "v2", engineReasonCode: "RAW_PRIVATE_REASON" }),
    "settings.composerEngineReason_v2_not_grounded",
  );
});
scenario("legacy and manual cards retain compatibility reason", async () => {
  const semantics = await loadComposerUiSemantics();
  assert.equal(semantics.getContextComposerFileReasonTranslationKey({ source: "legacy", engineReasonCode: "confirmed_implementation_target" }), null);
  assert.equal(semantics.getContextComposerFileReasonTranslationKey({ source: "manual", engineReasonCode: "confirmed_implementation_target" }), null);
});
scenario("EN and RU contain localized v2 card reason", () => {
  const translations = fs.readFileSync(path.join(repositoryRoot, "apps/desktop/renderer/src/i18n/index.ts"), "utf8");
  assert.equal((translations.match(/composerEngineReason_confirmed_implementation_target:/gu) ?? []).length, 2);
  assert.match(translations, /Confirmed implementation target with current repository evidence\./u);
  assert.match(translations, /Цель реализации подтверждена актуальными доказательствами репозитория\./u);
});
scenario("v2 cards prefer localized engine reason without raw trace IDs", () => {
  const sources = [
    fs.readFileSync(path.join(repositoryRoot, "apps/desktop/renderer/src/components/modals/ContextComposerModal.tsx"), "utf8"),
    fs.readFileSync(path.join(repositoryRoot, "apps/desktop/renderer/src/pages/ContextComposerPage.tsx"), "utf8"),
  ].join("\n");
  assert.match(sources, /getContextComposerFileReasonTranslationKey\(file\)/u);
  assert.match(sources, /reasonTranslationKey\s*\?\s*t\(reasonTranslationKey\)\s*:\s*file\.reason/u);
  assert.doesNotMatch(sources, /findingIds\.join|evidenceIds\.join/u);
});
scenario("engine panel localizes reasons and stop states", () => {
  const panel = fs.readFileSync(path.join(repositoryRoot, "apps/desktop/renderer/src/components/contextComposer/ContextComposerEnginePanel.tsx"), "utf8");
  assert.doesNotMatch(panel, /\{file\.reasonCode\}/u);
  assert.doesNotMatch(panel, />\s*\{view\.stopReason\}\s*</u);
  assert.match(panel, /composerEngineReason_/u);
  assert.match(panel, /composerEngineStop_/u);
  assert.match(panel, /<details/u);
  assert.match(panel, /evidence\.predicate/u);
  assert.match(panel, /evidence\.startLine/u);
});
scenario("Explainability Lens renders the allowlisted timeline without deriving time", () => {
  const panel = fs.readFileSync(
    path.join(repositoryRoot, "apps/desktop/renderer/src/components/workspace/ExplainabilityLensPanel.tsx"),
    "utf8",
  );
  assert.match(panel, /view\.timeline/u);
  assert.match(panel, /timeline\.events\.map/u);
  assert.match(panel, /event\.durationMs/u);
  assert.match(panel, /event\.startedAt/u);
  assert.match(panel, /event\.completedAt/u);
  assert.doesNotMatch(panel, /Date\.parse|new Date\s*\(/u);
  assert.doesNotMatch(panel, /findingIds\s*\[\s*index|evidenceIds\s*\[\s*index/u);
});
scenario("EN and RU contain investigation timeline copy", () => {
  const translations = fs.readFileSync(path.join(repositoryRoot, "apps/desktop/renderer/src/i18n/index.ts"), "utf8");
  assert.equal((translations.match(/investigationTimeline:/gu) ?? []).length, 2);
  assert.match(translations, /Investigation Timeline/u);
  assert.match(translations, /Ход расследования/u);
});
scenario("Context Map derives only exact renderer-visible grounded relations", () => {
  const source = fs.readFileSync(
    path.join(repositoryRoot, "apps/desktop/renderer/src/components/workspace/contextMap.ts"),
    "utf8",
  );
  assert.match(source, /finding\.evidenceIds/u);
  assert.match(source, /file\.findingIds/u);
  assert.match(source, /evidence\.path/u);
  assert.match(source, /contextMapPathIdentity/u);
  assert.doesNotMatch(source, /toLowerCase|toLocaleLowerCase/u);
  assert.doesNotMatch(source, /similarity|relevance|confidence|score/iu);
  assert.doesNotMatch(source, /timeline|operationRecords|trace/u);
});
scenario("Context Map UI reuses Inspector and Split View without inventing a Finding inspector", () => {
  const panel = fs.readFileSync(
    path.join(repositoryRoot, "apps/desktop/renderer/src/components/workspace/ContextMapPanel.tsx"),
    "utf8",
  );
  assert.match(panel, /onInspectFile/u);
  assert.match(panel, /onInspectEvidence/u);
  assert.match(panel, /onOpenSource/u);
  assert.match(panel, /buildContextMapGraph/u);
  assert.doesNotMatch(panel, /onInspectFinding|findingInspector/u);
  assert.doesNotMatch(panel, /Math\.random|Date\.now/u);
});
scenario("Context Basket derives from the existing Composer selection", () => {
  const page = fs.readFileSync(
    path.join(repositoryRoot, "apps/desktop/renderer/src/pages/ContextComposerPage.tsx"),
    "utf8",
  );
  const basket = fs.readFileSync(
    path.join(repositoryRoot, "apps/desktop/renderer/src/components/contextComposer/ContextBasketPanel.tsx"),
    "utf8",
  );

  assert.match(page, /selectedContextBasketItems/u);
  assert.match(page, /files=\{selectedContextBasketItems\}/u);
  assert.match(page, /snippets=\{selectedSnippets\}/u);
  assert.match(page, /onRemoveFile=\{togglePath\}/u);
  assert.match(page, /onClearFiles=\{clearSelectedPaths\}/u);
  assert.match(basket, /ContextComposerFileReference/u);
  assert.match(basket, /ContextComposerSnippet/u);
  assert.doesNotMatch(basket, /selectedFilePaths\s*=|useState<.*selected/u);
});
scenario("Context Basket keeps snippets derived and does not create snippet selection semantics", () => {
  const basket = fs.readFileSync(
    path.join(repositoryRoot, "apps/desktop/renderer/src/components/contextComposer/ContextBasketPanel.tsx"),
    "utf8",
  );

  assert.match(basket, /onOpenSnippet/u);
  assert.doesNotMatch(basket, /onRemoveSnippet|onToggleSnippet|selectedSnippetPaths/u);
  assert.doesNotMatch(basket, /confidence|relevance|health|tokenBudget|tokenCount/iu);
});
scenario("Task Pack Health derives only from exact workflow state and has no score", () => {
  const source = fs.readFileSync(
    path.join(repositoryRoot, "apps/desktop/renderer/src/utils/taskPackHealth.ts"),
    "utf8",
  );

  assert.match(source, /contextPreviewMatchesDraft/u);
  assert.match(source, /preview\.task\.originalRawTask === draft\.rawTask/u);
  assert.match(source, /preview\.task\.requestedTaskType === draft\.taskType/u);
  assert.match(source, /preview\.task\.targetTool === draft\.targetTool/u);
  assert.match(source, /engine\.status === "safety_blocked"/u);
  assert.match(source, /understanding\.canProceed/u);
  assert.match(source, /canGenerate/u);
  assert.doesNotMatch(source, /\bscore\b|confidence|Math\.round|readinessScore|budgetScore/u);
});
scenario("Task Pack primary status keeps grounded Health primary and labels heuristic quality separately", () => {
  const page = fs.readFileSync(
    path.join(repositoryRoot, "apps/desktop/renderer/src/pages/TaskPackBuilderPage.tsx"),
    "utf8",
  );
  const cardStart = page.indexOf("function PackStatusCard");
  const cardEnd = page.indexOf("function getIntentStatusClasses", cardStart);
  const card = page.slice(cardStart, cardEnd);

  assert.ok(cardStart >= 0 && cardEnd > cardStart);
  assert.match(page, /health=\{healthResult\}/u);
  assert.match(page, /quality=\{qualityResult\}/u);
  assert.match(card, /health\.requiredCount/u);
  assert.match(card, /health\.attentionCount/u);
  assert.match(card, /health\.pendingCount/u);
  assert.match(card, /health\.status/u);
  assert.match(card, /QualityScoreRing/u);
  assert.match(card, /quality\.score/u);
  assert.match(card, /quality\.localScore/u);
  assert.match(card, /quality\.openDetailsCompact/u);
  assert.match(card, /line-clamp-2 leading-tight/u);
  assert.doesNotMatch(card, /health\.score|healthScore|readinessScore/u);

  const translations = fs.readFileSync(
    path.join(repositoryRoot, "apps/desktop/renderer/src/i18n/index.ts"),
    "utf8",
  );
  assert.equal((translations.match(/eyebrow: "Task Pack health"/gu) ?? []).length, 1);
  assert.equal((translations.match(/eyebrow: "Состояние Task Pack"/gu) ?? []).length, 1);
  assert.match(translations, /localScore: "Local quality"/u);
  assert.match(translations, /localScore: "Локальное качество"/u);
  assert.match(translations, /openDetailsCompact: "Quality details"/u);
  assert.match(translations, /openDetailsCompact: "Подробнее о качестве"/u);
  assert.match(translations, /View local quality hints/u);
  assert.match(translations, /Открыть локальные подсказки качества/u);
});
scenario("Composer reviewed draft handoff preserves analyzed preview and stays renderer-local", () => {
  const dashboard = fs.readFileSync(
    path.join(repositoryRoot, "apps/desktop/renderer/src/pages/DashboardPage.tsx"),
    "utf8",
  );
  const helper = fs.readFileSync(
    path.join(repositoryRoot, "apps/desktop/renderer/src/utils/contextComposerReviewedDraft.ts"),
    "utf8",
  );
  const restoreStart = dashboard.indexOf("const restoreNavigationLocation");
  const restoreEnd = dashboard.indexOf("const handleNavigateBack", restoreStart);
  const restoreBody = dashboard.slice(restoreStart, restoreEnd);
  const builderBranchStart = restoreBody.indexOf('location.surface === "task-pack-builder"');
  const composerBranchStart = restoreBody.indexOf('location.surface === "context-composer"');
  const builderBranch = restoreBody.slice(builderBranchStart, composerBranchStart);

  assert.ok(restoreStart >= 0 && restoreEnd > restoreStart);
  assert.ok(builderBranchStart >= 0 && composerBranchStart > builderBranchStart);
  assert.match(builderBranch, /setContextComposerPreview\(null\)/u);
  assert.match(builderBranch, /setTaskPackDraft\(location\.draft\)/u);
  assert.doesNotMatch(builderBranch, /setTaskPackDraft\(null\)/u);

  assert.match(dashboard, /buildContextComposerReviewedSelection/u);
  assert.match(dashboard, /reviewedContextSelection=\{reviewedContextSelection\}/u);
  assert.match(helper, /state\.selectedPaths/u);
  assert.match(helper, /state\.extraFiles/u);
  assert.match(helper, /state\.extraSnippets/u);
  assert.match(helper, /selectedPathSet\.has\(file\.path\)/u);
  assert.match(helper, /selectedPathSet\.has\(snippet\.relativePath\)/u);
  assert.doesNotMatch(helper, /selectionQuality\s*:|contextEngine\s*:|qualitySource\s*:/u);
});

scenario("Composer Back/Forward restores the same reviewed draft and a new analysis invalidates it", () => {
  const dashboard = fs.readFileSync(
    path.join(repositoryRoot, "apps/desktop/renderer/src/pages/DashboardPage.tsx"),
    "utf8",
  );
  const history = fs.readFileSync(
    path.join(repositoryRoot, "apps/desktop/renderer/src/hooks/useWorkspaceNavigationHistory.ts"),
    "utf8",
  );
  const openStart = dashboard.indexOf("const handleOpenTaskContextComposerWithNavigation");
  const openEnd = dashboard.indexOf("const handleOpenTaskPackResult", openStart);
  const openBody = dashboard.slice(openStart, openEnd);
  const analyzeStart = dashboard.indexOf("const handleAnalyzeTaskContextWithPresence");
  const analyzeEnd = dashboard.indexOf("const handleCreateTaskPackWithPresence", analyzeStart);
  const analyzeBody = dashboard.slice(analyzeStart, analyzeEnd);

  assert.ok(openStart >= 0 && openEnd > openStart);
  assert.match(openBody, /forwardLocation\?\.surface === "context-composer"/u);
  assert.match(openBody, /taskContextDraftsMatch/u);
  assert.match(openBody, /setContextComposerPreview\(forwardLocation\.preview\)/u);
  assert.match(openBody, /goForward\(\)/u);

  assert.ok(analyzeStart >= 0 && analyzeEnd > analyzeStart);
  assert.match(analyzeBody, /if \(preview\) \{\s*discardForwardHistory\(\)/u);
  assert.match(history, /const discardForwardHistory = useCallback/u);
  assert.match(history, /current\.entries\.slice\(0, current\.index \+ 1\)/u);
});

scenario("Context Budget measures the reviewed Composer selection without changing engine status", () => {
  const source = fs.readFileSync(
    path.join(repositoryRoot, "apps/desktop/renderer/src/utils/contextBudget.ts"),
    "utf8",
  );
  const page = fs.readFileSync(
    path.join(repositoryRoot, "apps/desktop/renderer/src/pages/TaskPackBuilderPage.tsx"),
    "utf8",
  );

  assert.match(source, /reviewedSelection\?\.selectedFiles \?\? preview\.selectedFiles/u);
  assert.match(source, /reviewedSelection\?\.snippets \?\? preview\.snippets/u);
  assert.match(page, /buildContextReviewSummary\(contextPreview, reviewedContextSelection\)/u);
  assert.match(page, /evaluateContextBudget\(contextPreview, reviewedContextSelection\)/u);
  assert.doesNotMatch(source, /selectionQuality|contextEngine|safety_blocked/u);
});

scenario("Context Budget uses exact footprint metrics and no invented pressure score", () => {
  const source = fs.readFileSync(
    path.join(repositoryRoot, "apps/desktop/renderer/src/utils/contextBudget.ts"),
    "utf8",
  );
  const page = fs.readFileSync(
    path.join(repositoryRoot, "apps/desktop/renderer/src/pages/TaskPackBuilderPage.tsx"),
    "utf8",
  );

  assert.match(source, /selectedFileBytes \+= safeFileBytes\(file\.sizeBytes\)/u);
  assert.match(source, /snippetCharacters \+= snippet\.content\.length/u);
  assert.match(source, /truncatedSnippets \+= 1/u);
  assert.match(source, /tokenAccounting: "unavailable"/u);
  assert.match(source, /tokenUsage: null/u);
  assert.match(source, /tokenLimit: null/u);
  assert.doesNotMatch(source, /Math\.round|budgetScore|pressure|estimatedTokens|tokenEstimate/u);
  assert.doesNotMatch(page, /budgetScore|ContextBudgetBar|getBudgetPressureTone|CONTEXT_BUDGET_MODE_OPTIONS/u);
  assert.match(page, /<ContextBudgetPanel budget=\{contextBudget\}/u);
});

scenario("Context Budget never converts bytes or characters into token estimates", () => {
  const source = fs.readFileSync(
    path.join(repositoryRoot, "apps/desktop/renderer/src/utils/contextBudget.ts"),
    "utf8",
  );
  const translations = fs.readFileSync(
    path.join(repositoryRoot, "apps/desktop/renderer/src/i18n/index.ts"),
    "utf8",
  );

  assert.doesNotMatch(source, /\/\s*4|charsPerToken|bytesPerToken|tokenizer|encode\(/u);
  assert.equal((translations.match(/tokenBudget:/gu) ?? []).length, 2);
  assert.match(translations, /Bytes and characters are not converted into estimated tokens\./u);
  assert.match(translations, /Байты и символы не пересчитываются в приблизительные токены\./u);
});

scenario("Adaptive Density persists as a UI-only preference with an adaptive default", () => {
  const rendererTypes = fs.readFileSync(
    path.join(repositoryRoot, "apps/desktop/renderer/src/types/index.ts"),
    "utf8",
  );
  const settingsPage = fs.readFileSync(
    path.join(repositoryRoot, "apps/desktop/renderer/src/pages/SettingsPage.tsx"),
    "utf8",
  );
  const settingsService = fs.readFileSync(
    path.join(repositoryRoot, "server/src/settings/settingsService.ts"),
    "utf8",
  );
  const translations = fs.readFileSync(
    path.join(repositoryRoot, "apps/desktop/renderer/src/i18n/index.ts"),
    "utf8",
  );

  assert.match(rendererTypes, /workspaceDensity: "adaptive" \| "comfortable" \| "compact"/u);
  assert.match(settingsPage, /workspaceDensity: settings\.workspaceDensity \?\? "adaptive"/u);
  assert.match(settingsPage, /settingsDraft\?\.workspaceDensity \?\? "adaptive"/u);
  assert.match(settingsService, /workspaceDensity: "adaptive" \| "comfortable" \| "compact"/u);
  assert.match(settingsService, /workspaceDensity: "adaptive"/u);
  assert.match(settingsService, /workspaceDensity: "workspace_density"/u);
  assert.equal((translations.match(/workspaceDensityTitle:/gu) ?? []).length, 2);
  assert.equal((translations.match(/workspaceDensitySafetyNote:/gu) ?? []).length, 2);
});

scenario("Adaptive Density resolves deterministically from workspace pressure only", async () => {
  const density = await loadWorkspaceDensitySemantics();

  assert.equal(
    density.resolveWorkspaceDensity({
      preference: "adaptive",
      isWorkflowSurface: false,
      isFocusModeActive: false,
      hasAuxiliaryWorkspace: false,
    }),
    "comfortable",
  );
  assert.equal(
    density.resolveWorkspaceDensity({
      preference: "adaptive",
      isWorkflowSurface: true,
      isFocusModeActive: false,
      hasAuxiliaryWorkspace: false,
    }),
    "balanced",
  );
  assert.equal(
    density.resolveWorkspaceDensity({
      preference: "adaptive",
      isWorkflowSurface: true,
      isFocusModeActive: false,
      hasAuxiliaryWorkspace: true,
    }),
    "compact",
  );
  assert.equal(
    density.resolveWorkspaceDensity({
      preference: "adaptive",
      isWorkflowSurface: true,
      isFocusModeActive: true,
      hasAuxiliaryWorkspace: false,
    }),
    "compact",
  );
  assert.equal(
    density.resolveWorkspaceDensity({
      preference: "comfortable",
      isWorkflowSurface: true,
      isFocusModeActive: true,
      hasAuxiliaryWorkspace: true,
    }),
    "comfortable",
  );
  assert.equal(
    density.resolveWorkspaceDensity({
      preference: "compact",
      isWorkflowSurface: false,
      isFocusModeActive: false,
      hasAuxiliaryWorkspace: false,
    }),
    "compact",
  );

  assert.equal(density.getWorkspaceDensityPadding("comfortable", false), 28);
  assert.equal(density.getWorkspaceDensityPadding("balanced", false), 22);
  assert.equal(density.getWorkspaceDensityPadding("compact", false), 16);
  assert.equal(density.getWorkspaceDensityPadding("comfortable", true), 20);
  assert.equal(density.getWorkspaceDensityPadding("balanced", true), 16);
  assert.equal(density.getWorkspaceDensityPadding("compact", true), 12);
});

scenario("Adaptive Density changes shell spacing without hiding grounded workflow state", () => {
  const dashboard = fs.readFileSync(
    path.join(repositoryRoot, "apps/desktop/renderer/src/pages/DashboardPage.tsx"),
    "utf8",
  );
  const translations = fs.readFileSync(
    path.join(repositoryRoot, "apps/desktop/renderer/src/i18n/index.ts"),
    "utf8",
  );

  assert.match(dashboard, /data-workspace-density=\{resolvedWorkspaceDensity\}/u);
  assert.match(dashboard, /data-workspace-density-preference=\{workspaceDensityPreference\}/u);
  assert.match(dashboard, /animate=\{\{ padding: workspaceContentPadding \}\}/u);
  assert.match(dashboard, /splitViewTarget \|\|\s*inspectorTarget \|\|\s*isExplainabilityOpen \|\|\s*isContextMapOpen/u);
  assert.match(
    translations,
    /Warnings, evidence, selected files, review state and generation gates are never hidden/u,
  );
  assert.match(
    translations,
    /Предупреждения, доказательства, выбранные файлы, состояние проверки и ограничения генерации не скрываются/u,
  );
});

scenario("Focus Mode stays session-local while behavior can be persisted independently", () => {
  const dashboard = fs.readFileSync(
    path.join(repositoryRoot, "apps/desktop/renderer/src/pages/DashboardPage.tsx"),
    "utf8",
  );

  assert.match(dashboard, /const \[isFocusModeEnabled, setIsFocusModeEnabled\] = useState\(false\)/u);
  assert.match(dashboard, /const \[isAutomaticFocusSuppressed, setIsAutomaticFocusSuppressed\]/u);
  assert.match(dashboard, /activeLocation\.surface === "task-pack-builder"/u);
  assert.match(dashboard, /activeLocation\.surface === "context-composer"/u);
  assert.match(dashboard, /activeLocation\.surface === "task-pack-result"/u);
  assert.match(dashboard, /const focusModeBehavior = appSettings\?\.focusModeBehavior \?\? "manual"/u);
  assert.match(dashboard, /isAutomaticFocusMode \? !isAutomaticFocusSuppressed : isFocusModeEnabled/u);
  assert.match(dashboard, /toggleFocusMode,/u);
  assert.doesNotMatch(dashboard, /localStorage.*focus/isu);
});

scenario("Focus Mode automatic behavior can be temporarily suppressed without changing the saved preference", () => {
  const dashboard = fs.readFileSync(
    path.join(repositoryRoot, "apps/desktop/renderer/src/pages/DashboardPage.tsx"),
    "utf8",
  );

  assert.match(dashboard, /if \(isAutomaticFocusMode\) \{\s*setIsAutomaticFocusSuppressed/u);
  assert.match(dashboard, /wasFocusSurface && !isFocusModeSurface && isAutomaticFocusMode/u);
  assert.match(dashboard, /setIsAutomaticFocusSuppressed\(false\)/u);
  assert.match(dashboard, /previousFocusModeBehaviorRef/u);
});

scenario("Focus Mode behavior is a persisted UI setting with manual fallback", () => {
  const rendererTypes = fs.readFileSync(
    path.join(repositoryRoot, "apps/desktop/renderer/src/types/index.ts"),
    "utf8",
  );
  const settingsPage = fs.readFileSync(
    path.join(repositoryRoot, "apps/desktop/renderer/src/pages/SettingsPage.tsx"),
    "utf8",
  );
  const settingsService = fs.readFileSync(
    path.join(repositoryRoot, "server/src/settings/settingsService.ts"),
    "utf8",
  );
  const translations = fs.readFileSync(
    path.join(repositoryRoot, "apps/desktop/renderer/src/i18n/index.ts"),
    "utf8",
  );

  assert.match(rendererTypes, /focusModeBehavior: "manual" \| "automatic"/u);
  assert.match(settingsPage, /focusModeBehavior: settings\.focusModeBehavior \?\? "manual"/u);
  assert.match(settingsPage, /settingsDraft\?\.focusModeBehavior \?\? "manual"/u);
  assert.match(settingsService, /focusModeBehavior: "manual" \| "automatic"/u);
  assert.match(settingsService, /focusModeBehavior: "manual"/u);
  assert.match(settingsService, /focusModeBehavior: "focus_mode_behavior"/u);
  assert.equal((translations.match(/focusModeBehaviorTitle:/gu) ?? []).length, 2);
});

scenario("Focus Mode includes Task Pack Result without turning the archive into a focus surface", () => {
  const dashboard = fs.readFileSync(
    path.join(repositoryRoot, "apps/desktop/renderer/src/pages/DashboardPage.tsx"),
    "utf8",
  );

  assert.match(
    dashboard,
    /const isFocusModeSurface =\s*activeLocation\.surface === "task-pack-builder" \|\|\s*activeLocation\.surface === "context-composer" \|\|\s*activeLocation\.surface === "task-pack-result";/u,
  );
  assert.doesNotMatch(
    dashboard,
    /isFocusModeSurface[\s\S]{0,220}activePage === "taskPacks"/u,
  );
});

scenario("Focus Mode collapses only shell presentation and preserves auxiliary workspace panels", () => {
  const dashboard = fs.readFileSync(
    path.join(repositoryRoot, "apps/desktop/renderer/src/pages/DashboardPage.tsx"),
    "utf8",
  );
  const sidebar = fs.readFileSync(
    path.join(repositoryRoot, "apps/desktop/renderer/src/components/layout/Sidebar.tsx"),
    "utf8",
  );

  assert.match(dashboard, /focusMode=\{isFocusModeActive\}/u);
  assert.match(dashboard, /animate=\{\{ padding: workspaceContentPadding \}\}/u);
  assert.match(sidebar, /width: focusMode \? 0 : isCollapsed \? 76 : 256/u);
  assert.match(sidebar, /pointerEvents: focusMode \? "none" : "auto"/u);
  assert.match(sidebar, /window\.localStorage\.setItem\(\s*"contextforge\.sidebarCollapsed"/u);
  assert.match(dashboard, /<PersistentInspectorPanel/u);
  assert.match(dashboard, /<ContextMapPanel/u);
  assert.match(dashboard, /mode="split-view"/u);
});

scenario("Focus Mode has a remappable shortcut and synchronized EN/RU titlebar copy", () => {
  const shortcuts = fs.readFileSync(
    path.join(repositoryRoot, "apps/desktop/renderer/src/config/keyboardShortcuts.ts"),
    "utf8",
  );
  const titlebar = fs.readFileSync(
    path.join(repositoryRoot, "apps/desktop/renderer/src/components/layout/AppTitleBar.tsx"),
    "utf8",
  );
  const translations = fs.readFileSync(
    path.join(repositoryRoot, "apps/desktop/renderer/src/i18n/index.ts"),
    "utf8",
  );

  assert.match(shortcuts, /id: "toggleFocusMode"/u);
  assert.match(shortcuts, /displayKeys: "Ctrl Shift F"/u);
  assert.match(titlebar, /aria-pressed=\{isFocusModeActive\}/u);
  assert.match(titlebar, /h-7 items-center gap-1\.5 rounded-full px-2\.5/u);
  assert.match(titlebar, /bg-white\/\[0\.09\] text-white/u);
  assert.match(titlebar, /titlebar\.focusModeEnter/u);
  assert.match(titlebar, /titlebar\.focusModeExit/u);
  assert.equal((translations.match(/focusModeEnter:/gu) ?? []).length, 2);
  assert.equal((translations.match(/focusModeExit:/gu) ?? []).length, 2);
});

scenario("EN and RU contain grounded Context Map copy", () => {
  const translations = fs.readFileSync(path.join(repositoryRoot, "apps/desktop/renderer/src/i18n/index.ts"), "utf8");
  assert.equal((translations.match(/contextMapOpen:/gu) ?? []).length, 2);
  assert.match(translations, /Context Map/u);
  assert.match(translations, /Карта контекста/u);
});
scenario("Context Diff lifecycle is independent from navigation restore and language", () => {
  const dashboard = fs.readFileSync(
    path.join(repositoryRoot, "apps/desktop/renderer/src/pages/DashboardPage.tsx"),
    "utf8",
  );
  const restoreStart = dashboard.indexOf("const restoreNavigationLocation");
  const restoreEnd = dashboard.indexOf("const handleNavigateBack", restoreStart);
  const restoreBody = dashboard.slice(restoreStart, restoreEnd);
  assert.ok(restoreStart >= 0 && restoreEnd > restoreStart);
  assert.doesNotMatch(restoreBody, /advanceContextDiffSession/u);
  assert.match(dashboard, /handleOpenTaskContextComposerWithNavigation[\s\S]*advanceContextDiffSession/u);
  const semantics = fs.readFileSync(
    path.join(repositoryRoot, "apps/desktop/renderer/src/components/workspace/contextDiff.ts"),
    "utf8",
  );
  assert.doesNotMatch(semantics, /useTranslation|i18n|languageChanged/u);
});
scenario("Context Diff UI preserves removed-file safety and reuses current Inspector actions", () => {
  const panel = fs.readFileSync(
    path.join(repositoryRoot, "apps/desktop/renderer/src/components/workspace/ExplainabilityLensPanel.tsx"),
    "utf8",
  );
  assert.match(panel, /currentFile=\{group\.current\s*\?\s*currentFiles\.get/u);
  assert.match(panel, /currentFile\s*\?/u);
  assert.match(panel, /onInspectFile\(currentFile\)/u);
  assert.match(panel, /contextDiffNoPrevious/u);
  assert.doesNotMatch(panel, /confidence|relevance|health score/iu);
});
scenario("EN and RU contain Context Diff empty-state copy", () => {
  const translations = fs.readFileSync(path.join(repositoryRoot, "apps/desktop/renderer/src/i18n/index.ts"), "utf8");
  assert.equal((translations.match(/contextDiffNoPrevious:/gu) ?? []).length, 2);
  assert.match(translations, /There is no previous analysis to compare yet\./u);
  assert.match(translations, /Предыдущего анализа для сравнения пока нет\./u);
});
scenario("settings expose independent mode", () => {
  const source = fs.readFileSync(path.join(repositoryRoot, "server/src/settings/settingsService.ts"), "utf8");
  assert.match(source, /context_composer_engine_mode/u);
  assert.match(source, /context_engine_mode/u);
  assert.match(source, /selector_pipeline_mode/u);
});
scenario("preview reads settings on every invocation", () => {
  const source = fs.readFileSync(path.join(repositoryRoot, "server/src/contextComposer/contextComposerService.ts"), "utf8");
  const functionStart = source.indexOf("export async function buildContextComposerPreview");
  assert.ok(functionStart >= 0);
  assert.ok(source.indexOf("await getAppSettings()", functionStart) > functionStart);
});
scenario("preview scans inventory exactly once", () => {
  const source = fs.readFileSync(path.join(repositoryRoot, "server/src/contextComposer/contextComposerService.ts"), "utf8");
  const functionBody = source.slice(source.indexOf("export async function buildContextComposerPreview"), source.indexOf("function getUniqueStrings"));
  assert.equal((functionBody.match(/scanProjectInventory\(/gu) ?? []).length, 1);
});
scenario("Task Pack controller never forwards Composer engine metadata", () => {
  const source = fs.readFileSync(path.join(repositoryRoot, "apps/desktop/renderer/src/hooks/useDashboardController.ts"), "utf8");
  const start = source.indexOf("async function handleCreateTaskPackFromComposer");
  const body = source.slice(start, source.indexOf("function handleExternalTaskPackCreated", start));
  assert.match(body, /generateTaskPackFromDraft\(selectedFilePaths\)/u);
  assert.doesNotMatch(body, /contextEngine/u);
});
scenario("Task Pack route does not read Composer engine metadata", () => {
  const source = fs.readFileSync(path.join(repositoryRoot, "server/src/routes/taskPacks.ts"), "utf8");
  assert.doesNotMatch(source, /contextComposerEngine|contextEngineView/u);
});
scenario("Task Pack prompt code does not read Composer engine metadata", () => {
  const sources = fs.readdirSync(path.join(repositoryRoot, "server/src/taskPacks"))
    .filter((name) => name.endsWith(".ts"))
    .map((name) => fs.readFileSync(path.join(repositoryRoot, "server/src/taskPacks", name), "utf8"))
    .join("\n");
  assert.doesNotMatch(sources, /contextComposerEngine|contextEngineView/u);
});
scenario("UI has Russian Composer strings", () => {
  const source = fs.readFileSync(path.join(repositoryRoot, "apps/desktop/renderer/src/i18n/index.ts"), "utf8");
  assert.match(source, /Движок Context Composer/u);
});

for (const item of scenarios) await item.run();
assert.ok(scenarios.length >= 60, `Expected at least 60 scenarios, got ${scenarios.length}.`);
console.log(`Context Engine v2 Composer smoke passed: ${scenarios.length} scenarios.`);
