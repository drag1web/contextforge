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
scenario("absolute Windows path rejected", () => { const value = structuredClone(validView()); value.files[0]!.path = "C:/private/a.ts"; assert.throws(() => validateContextComposerEngineView(value)); });
scenario("absolute Unix path rejected", () => { const value = structuredClone(validView()); value.files[0]!.path = "/private/a.ts"; assert.throws(() => validateContextComposerEngineView(value)); });
scenario("parent path rejected", () => { const value = structuredClone(validView()); value.files[0]!.path = "../a.ts"; assert.throws(() => validateContextComposerEngineView(value)); });
scenario("unknown role rejected", () => { const value = structuredClone(validView()) as any; value.files[0].role = "owner"; assert.throws(() => validateContextComposerEngineView(value)); });
scenario("unknown usage rejected", () => { const value = structuredClone(validView()) as any; value.files[0].usage = "edit"; assert.throws(() => validateContextComposerEngineView(value)); });
scenario("unknown status rejected", () => { const value = structuredClone(validView()) as any; value.status = "ready"; assert.throws(() => validateContextComposerEngineView(value)); });
scenario("unknown stop rejected", () => { const value = structuredClone(validView()) as any; value.stopReason = "done"; assert.throws(() => validateContextComposerEngineView(value)); });
scenario("unknown reason rejected", () => { const value = structuredClone(validView()) as any; value.files[0].reasonCode = "raw_error"; assert.throws(() => validateContextComposerEngineView(value)); });
scenario("unknown predicate rejected", () => { const value = structuredClone(validView()); value.files[0]!.evidence[0]!.predicate = "raw_user_text"; assert.throws(() => validateContextComposerEngineView(value)); });
scenario("lead-only target evidence rejected", () => { const value = structuredClone(validView()); value.files[0]!.evidence[0]!.strength = "lead"; assert.throws(() => validateContextComposerEngineView(value)); });
scenario("context-only target evidence rejected", () => { const value = structuredClone(validView()); value.files[0]!.evidence[0]!.role = "context_only"; assert.throws(() => validateContextComposerEngineView(value)); });
scenario("decision evidence trace mismatch rejected", () => { const value = structuredClone(validView()); value.files[0]!.evidence[0]!.evidenceId = "evidence-other"; assert.throws(() => validateContextComposerEngineView(value)); });
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
  assert.equal(resolution.view.status, "v2_ready");
  assert.equal(resolution.selection?.selectedFiles[0]?.path, "src/candidate.ts");
  assert.equal(resolution.view.comparison?.outcome, "insufficient_evaluation_data");
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
scenario("Page hides percentage for v2 files", () => {
  const source = fs.readFileSync(path.join(repositoryRoot, "apps/desktop/renderer/src/pages/ContextComposerPage.tsx"), "utf8");
  assert.match(source, /confidenceDisplay\s*!==\s*"unavailable"/u);
  assert.match(source, /legacyConfidence\s*===\s*null/u);
  assert.doesNotMatch(source, /formatPercent\(file\.confidence\)/u);
});
scenario("legacy confidence display remains available", () => {
  const modal = fs.readFileSync(path.join(repositoryRoot, "apps/desktop/renderer/src/components/modals/ContextComposerModal.tsx"), "utf8");
  const page = fs.readFileSync(path.join(repositoryRoot, "apps/desktop/renderer/src/pages/ContextComposerPage.tsx"), "utf8");
  assert.match(modal, /formatPercent\(legacyConfidence\)/u);
  assert.match(page, /formatPercent\(legacyConfidence\)/u);
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
  assert.match(modal, /preview\.contextEngine\s*&&\s*<ContextComposerEnginePanel/u);
  assert.match(page, /preview\.contextEngine\s*&&\s*<ContextComposerEnginePanel/u);
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
