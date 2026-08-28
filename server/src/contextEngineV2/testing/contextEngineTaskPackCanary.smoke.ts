import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createTaskPackCanaryDiagnosticsWriter,
  createTaskPackCanaryHistory,
  createTaskPackCanaryPreparationFailure,
  createTaskPackCanaryPreparationFailureBasis,
  createTaskPackCanaryService,
  decideTaskPackCanaryCohort,
  normalizeContextEngineCanaryConfiguration,
  normalizeContextEngineCanaryPercent,
  normalizeContextEngineCanaryProjectIds,
  hasTaskPackCanarySelectionDelta,
  prepareBoundedTaskPackCanaryInput,
  runLiveTaskPackCanary,
  TASK_PACK_CANARY_PREPARATION_LIMITS,
  TaskPackCanaryPreparationError,
  validateTaskPackCanaryDecision,
} from "../canary/index.js";
import type {
  TaskPackCanaryDecision,
  TaskPackCanaryDownstreamValidation,
  TaskPackCanaryRuntimeInput,
} from "../canary/index.js";
import { createLiveContextEngineExecution } from "../facade/liveContextEngineRuntime.js";
import {
  createContextEngineShadowExecutionBasis,
  createContextEngineShadowExecutionTracker,
  normalizeContextEngineMode,
  prepareContextEngineShadowInput,
} from "../shadow/index.js";
import type { InvestigationId, InvestigationRequestId } from "../contracts/index.js";
import type { ProjectInventory } from "../../scanner/projectInventoryScanner.js";
import type { StructuredIntentTarget, TaskIntentAnalysis } from "../../ollama/taskIntentAnalyzer.js";
import type { ContextSelectionQuality } from "../../selection/contextQuality.js";
import {
  applyValidatedTaskPackCanarySelection,
  buildContextAwareTemplatePrompt,
  buildFileReferences,
  buildRelevantFilesSection,
  buildSelectedFileSnippets,
  buildStableTaskPackRefinementCacheIdentity,
  buildUniversalTaskPackContext,
  finalizeTaskPackEffectiveSelectorDiagnostics,
  sealTaskPackCanaryProductionResolution,
  validateTaskPackCanaryCandidate,
} from "../../routes/taskPacks.js";

let scenarios = 0;
async function scenario(name: string, run: () => void | Promise<void>): Promise<void> {
  await run();
  scenarios += 1;
  assert.ok(name.length > 0);
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), "context-engine-canary-"));
const sourceMarker = "CANARY_SOURCE_MARKER_DO_NOT_EXPORT";
const source = `export function SettingsPage() { return <h1>${sourceMarker}</h1>; }\n`;
const legacySource = "export const legacyA = true;\n";
await fs.mkdir(path.join(root, "apps", "renderer", "src", "pages"), { recursive: true });
await fs.mkdir(path.join(root, "src"), { recursive: true });
await fs.writeFile(path.join(root, "apps", "renderer", "src", "pages", "SettingsPage.tsx"), source, "utf8");
await fs.writeFile(path.join(root, "src", "legacy-a.ts"), legacySource, "utf8");
const sourceBytes = new TextEncoder().encode(source).byteLength;
const legacySourceBytes = new TextEncoder().encode(legacySource).byteLength;
const inventory: ProjectInventory = {
  rootPath: root,
  files: [{
    path: "apps/renderer/src/pages/SettingsPage.tsx", name: "SettingsPage.tsx", extension: ".tsx", kind: "source", role: "page",
    imports: [], exports: ["SettingsPage"], symbols: ["SettingsPage"],
    textHints: ["Settings", "SettingsPage"], contentPreview: source.replace(/\s+/gu, " ").trim(),
    sizeBytes: sourceBytes, depth: 5, canReadText: true, isLikelyGenerated: false,
  }, {
    path: "src/legacy-a.ts", name: "legacy-a.ts", extension: ".ts", kind: "source", role: "utility",
    imports: [], exports: ["legacyA"], symbols: ["legacyA"], textHints: ["legacyA"],
    contentPreview: legacySource.trim(), sizeBytes: legacySourceBytes, depth: 2,
    canReadText: true, isLikelyGenerated: false,
  }],
  totalFiles: 2, scannedFiles: 2, truncated: false, notes: [],
};
const canaryPolicy = {
  budget: {
    maxOperations: 12, maxFileReads: 4, maxFileBytes: 50_000, maxParsedFiles: 4,
    maxRelationshipHops: 8, maxWallTimeMs: 2_000, maxPlannerRounds: 8,
    maxConcurrentOperations: 1,
  },
  timeoutMs: 2_250,
  maxHistoryRecords: 5,
};
const executionBasis = createContextEngineShadowExecutionBasis({
  policy: canaryPolicy,
  requestedTaskType: "general",
  effectiveTaskArea: "general",
});
const structuredTarget: StructuredIntentTarget = {
  kind: "explicit_file", value: "apps/renderer/src/pages/SettingsPage.tsx", path: "apps/renderer/src/pages/SettingsPage.tsx",
  confidence: 1, evidence: "Exact user-confirmed file target.", provenance: "user_confirmed",
};
const canonical = prepareContextEngineShadowInput({
  projectId: "project-1", projectRoot: root, inventory,
  normalizedTask: "On page Settings replace the heading in `apps/renderer/src/pages/SettingsPage.tsx`.",
  clarificationBasis: [{ questionId: "question-1", answer: "Use the existing handler" }],
  structuredTargets: [structuredTarget], protectedScopes: [], executionBasis,
  createdAt: "2026-08-02T00:00:00.000Z",
});
const legacySelection: TaskPackCanaryRuntimeInput["legacySelection"] = {
  selectedFiles: [{
    path: "apps/renderer/src/pages/SettingsPage.tsx", kind: "source", usage: "inspect-and-edit",
    reason: "Exact legacy target.", confidence: 1,
  }],
  rejectedModelPaths: [], source: "deterministic", usedFallback: false,
  durationMs: 0, notes: [], effectiveTaskArea: "general", assetMode: "none",
};
const taskIntent: TaskIntentAnalysis = {
  taskArea: "ui", intentTags: [], domainTerms: ["Settings"],
  mentionedEntities: ["Settings"], fileRoleHints: ["page"],
  recommendedSearchTerms: ["SettingsPage"], riskLevel: "low", confidence: 1,
  notes: [], source: "fallback", durationMs: 0,
  structuredIntent: {
    schemaVersion: 1, primaryTargets: [structuredTarget], positiveActions: ["update"],
    protectedScopes: [], allowedEditScope: "explicit_targets_only", needsStyles: false,
    needsBackend: false, ambiguities: [], modelNotes: [],
  },
  taskUnderstanding: {
    schemaVersion: 1, goal: "Replace Settings heading", action: "replace",
    targetHints: ["apps/renderer/src/pages/SettingsPage.tsx", "Settings"], requestedChanges: ["Replace heading"],
    constraints: [], interpretationRisk: "objective", changeDefinition: "exact",
    explicitValues: [], missingInformation: [], readiness: "ready", canProceed: true,
    clarificationQuestion: null, confidence: 1, source: "merged", reasons: [],
  },
};
const configuration = normalizeContextEngineCanaryConfiguration({ percent: 0, projectIds: ["project-1"] });
const acceptDownstream: TaskPackCanaryRuntimeInput["validateDownstream"] = (selection) => ({
  validatedFiles: [...selection],
  validation: {
    passed: true, qualityStatus: "ready", explicitTargetStatus: "matched",
    authorizationPreserved: true, contextAssemblyEligible: true,
    reasonCodes: ["v2_applied"],
  },
});
const runtimeInput = (overrides: Partial<TaskPackCanaryRuntimeInput> = {}): TaskPackCanaryRuntimeInput => {
  const requestStartedMonotonicMs = Math.floor(performance.now());
  return {
    mode: "canary", configuration, canonical, legacySelection, validateDownstream: acceptDownstream,
    requestStartedMonotonicMs,
    requestDeadlineMonotonicMs: requestStartedMonotonicMs + canaryPolicy.timeoutMs,
    ...overrides,
  };
};

// Modes and cohort.
await scenario("default mode is disabled", () => assert.equal(normalizeContextEngineMode(undefined), "disabled"));
await scenario("primary mode is accepted by shared rollout normalization", () => assert.equal(normalizeContextEngineMode("primary"), "primary"));
await scenario("shadow mode remains accepted", () => assert.equal(normalizeContextEngineMode("shadow"), "shadow"));
await scenario("canary mode is accepted", () => assert.equal(normalizeContextEngineMode("canary"), "canary"));
await scenario("canary percent defaults to zero", () => assert.equal(normalizeContextEngineCanaryPercent(undefined), 0));
await scenario("malformed canary percent normalizes safely", () => assert.equal(normalizeContextEngineCanaryPercent(101), 0));
await scenario("fractional canary percent normalizes safely", () => assert.equal(normalizeContextEngineCanaryPercent(1.5), 0));
await scenario("percent zero excludes non-allowlisted project", () => {
  assert.equal(decideTaskPackCanaryCohort({ projectId: "p", taskFingerprint: canonical.taskFingerprint, snapshotFingerprint: canonical.snapshotFingerprint, configuration: { percent: 0, projectIds: [] } }).included, false);
});
await scenario("percent one means one percent bucket boundary", () => {
  const cohort = decideTaskPackCanaryCohort({ projectId: "p", taskFingerprint: canonical.taskFingerprint, snapshotFingerprint: canonical.snapshotFingerprint, configuration: { percent: 1, projectIds: [] } });
  assert.equal(cohort.included, cohort.bucket < 100);
});
await scenario("percent one hundred includes request", () => {
  assert.equal(decideTaskPackCanaryCohort({ projectId: "p", taskFingerprint: canonical.taskFingerprint, snapshotFingerprint: canonical.snapshotFingerprint, configuration: { percent: 100, projectIds: [] } }).included, true);
});
await scenario("explicit project allowlist includes request", () => {
  assert.equal(decideTaskPackCanaryCohort({ projectId: "p", taskFingerprint: canonical.taskFingerprint, snapshotFingerprint: canonical.snapshotFingerprint, configuration: { percent: 0, projectIds: ["p"] } }).included, true);
});
await scenario("non-allowlisted project remains excluded", () => {
  assert.equal(decideTaskPackCanaryCohort({ projectId: "p", taskFingerprint: canonical.taskFingerprint, snapshotFingerprint: canonical.snapshotFingerprint, configuration: { percent: 0, projectIds: ["q"] } }).included, false);
});
await scenario("duplicate project IDs normalize uniquely", () => assert.deepEqual(normalizeContextEngineCanaryProjectIds(["p", "p", " q "]), ["p", "q"]));
await scenario("malformed project IDs are dropped", () => assert.deepEqual(normalizeContextEngineCanaryProjectIds(["p", "bad path", 1]), ["p"]));
const repeatedCohort = decideTaskPackCanaryCohort({ projectId: "p", taskFingerprint: canonical.taskFingerprint, snapshotFingerprint: canonical.snapshotFingerprint, configuration: { percent: 50, projectIds: [] } });
await scenario("deterministic bucket is stable", () => {
  assert.equal(decideTaskPackCanaryCohort({ projectId: "p", taskFingerprint: canonical.taskFingerprint, snapshotFingerprint: canonical.snapshotFingerprint, configuration: { percent: 50, projectIds: [] } }).bucket, repeatedCohort.bucket);
});
await scenario("cohort basis is privacy-safe hash", () => assert.match(repeatedCohort.basisFingerprint, /^sha256:[a-f0-9]{64}$/u));
await scenario("task change changes cohort basis", () => {
  assert.notEqual(decideTaskPackCanaryCohort({ projectId: "p", taskFingerprint: canonical.snapshotFingerprint, snapshotFingerprint: canonical.snapshotFingerprint, configuration: { percent: 50, projectIds: [] } }).basisFingerprint, repeatedCohort.basisFingerprint);
});
await scenario("snapshot change changes cohort basis", () => {
  assert.notEqual(decideTaskPackCanaryCohort({ projectId: "p", taskFingerprint: canonical.taskFingerprint, snapshotFingerprint: canonical.taskFingerprint, configuration: { percent: 50, projectIds: [] } }).basisFingerprint, repeatedCohort.basisFingerprint);
});
await scenario("rollout configuration changes cohort decision basis", () => {
  assert.notEqual(decideTaskPackCanaryCohort({ projectId: "p", taskFingerprint: canonical.taskFingerprint, snapshotFingerprint: canonical.snapshotFingerprint, configuration: { percent: 51, projectIds: [] } }).basisFingerprint, repeatedCohort.basisFingerprint);
});

// Canonical request basis.
await scenario("one inventory instance is reused", () => assert.equal(canonical.inventory, inventory));
await scenario("snapshot and inventory file sets match", () => assert.deepEqual(canonical.snapshot.files.map((file) => file.normalizedPath), inventory.files.map((file) => file.path)));
for (const [name, value] of [
  ["task fingerprint is canonical", canonical.taskFingerprint],
  ["constraint fingerprint is canonical", canonical.clarificationFingerprint],
  ["inventory fingerprint is canonical", canonical.inventoryFingerprint],
  ["snapshot fingerprint is canonical", canonical.snapshotFingerprint],
  ["configuration fingerprint is canonical", canonical.configurationFingerprint],
] as const) {
  await scenario(name, () => assert.match(value, /^sha256:[a-f0-9]{64}$/u));
}
await scenario("root mismatch is rejected", () => {
  assert.throws(() => prepareContextEngineShadowInput({
    projectId: "p", projectRoot: path.join(root, "other"), inventory,
    normalizedTask: "Update apps/renderer/src/pages/SettingsPage.tsx", structuredTargets: [structuredTarget],
    protectedScopes: [], executionBasis, createdAt: new Date().toISOString(),
  }));
});
await scenario("presentation clarification Markdown is rejected", () => {
  assert.throws(() => prepareContextEngineShadowInput({
    projectId: "p", projectRoot: root, inventory,
    normalizedTask: "Update\n## User Clarifications\nQuestion: hidden", structuredTargets: [],
    protectedScopes: [], executionBasis, createdAt: new Date().toISOString(),
  }));
});
await scenario("structured clarification is preserved in memory", () => assert.equal(canonical.clarificationBasis[0]?.questionId, "question-1"));
await scenario("clarification answer is absent from fingerprints", () => assert.equal(canonical.clarificationFingerprint.includes("Use the existing handler"), false));
await scenario("canonical root is runtime-only", () => assert.equal(JSON.stringify({ taskFingerprint: canonical.taskFingerprint }).includes(root), false));
const protectedCanonical = prepareContextEngineShadowInput({
  projectId: "project-1", projectRoot: root, inventory,
  normalizedTask: canonical.normalizedTask, structuredTargets: [structuredTarget],
  protectedScopes: ["src/private/*"], executionBasis, createdAt: canonical.snapshot.createdAt,
});
await scenario("constraint change changes fingerprint", () => assert.notEqual(protectedCanonical.clarificationFingerprint, canonical.clarificationFingerprint));
await scenario("constraint change changes snapshot basis", () => assert.notEqual(protectedCanonical.snapshotFingerprint, canonical.snapshotFingerprint));
const boundedPreparationInput = {
  projectId: "project-1", projectRoot: root, inventory,
  normalizedTask: canonical.normalizedTask,
  clarificationBasis: [{ questionId: "question-1", answer: "Use the existing handler" }],
  structuredTargets: [structuredTarget], protectedScopes: [], executionBasis,
  createdAt: canonical.snapshot.createdAt,
};
await scenario("bounded preparation accepts the real fixture", () => assert.equal(
  prepareBoundedTaskPackCanaryInput({
    preparationInput: boundedPreparationInput,
    deadlineMonotonicMs: 100,
    monotonicMs: () => 0,
    prepare: prepareContextEngineShadowInput,
  }).snapshot.id,
  canonical.snapshot.id,
));
await scenario("oversized inventory is rejected before canonical preparation", () => {
  let prepareCalled = false;
  const oversizedInventory: ProjectInventory = {
    ...inventory,
    files: Array.from({ length: TASK_PACK_CANARY_PREPARATION_LIMITS.maxInventoryFiles + 1 }, () => inventory.files[0]!),
    scannedFiles: TASK_PACK_CANARY_PREPARATION_LIMITS.maxInventoryFiles + 1,
    totalFiles: TASK_PACK_CANARY_PREPARATION_LIMITS.maxInventoryFiles + 1,
  };
  assert.throws(() => prepareBoundedTaskPackCanaryInput({
    preparationInput: { ...boundedPreparationInput, inventory: oversizedInventory },
    deadlineMonotonicMs: 100,
    monotonicMs: () => 0,
    prepare: (value) => { prepareCalled = true; return prepareContextEngineShadowInput(value); },
  }), (error) => error instanceof TaskPackCanaryPreparationError && error.code === "preparation_limit_exceeded");
  assert.equal(prepareCalled, false);
});
await scenario("oversized failure diagnostics do not enumerate rejected files", () => {
  let ownKeysCalls = 0;
  const hugeFiles = new Proxy(new Array(TASK_PACK_CANARY_PREPARATION_LIMITS.maxInventoryFiles * 20), {
    ownKeys() {
      ownKeysCalls += 1;
      throw new Error("oversized inventory must not be enumerated");
    },
  }) as ProjectInventory["files"];
  const oversizedInventory: ProjectInventory = {
    ...inventory,
    files: hugeFiles,
    scannedFiles: hugeFiles.length,
    totalFiles: hugeFiles.length,
  };
  assert.throws(() => prepareBoundedTaskPackCanaryInput({
    preparationInput: { ...boundedPreparationInput, inventory: oversizedInventory },
    deadlineMonotonicMs: 100,
    monotonicMs: () => 0,
    prepare: () => { throw new Error("canonical preparation must not run"); },
  }), (error) => error instanceof TaskPackCanaryPreparationError && error.code === "preparation_limit_exceeded");
  const basis = createTaskPackCanaryPreparationFailureBasis({
    totalFiles: hugeFiles.length,
    reasonCode: "preparation_limit_exceeded",
  });
  const failure = createTaskPackCanaryPreparationFailure({
    projectId: "project-1",
    failureBasis: basis,
    legacySelection,
    executionBasis,
    configuration,
    createdAt: "2026-08-02T00:00:00.000Z",
  });
  assert.equal(ownKeysCalls, 0);
  assert.equal(failure.legacy.files.length, 0);
  assert.equal(JSON.stringify(failure).includes("legacy-a.ts"), false);
});
await scenario("oversized failure basis is constant-size", () => assert.deepEqual(
  Object.keys(createTaskPackCanaryPreparationFailureBasis({
    totalFiles: 1_000_000,
    reasonCode: "preparation_limit_exceeded",
  })).sort(),
  ["configuredFileLimit", "reasonCode", "schemaVersion", "totalFiles", "truncated"],
));
await scenario("slow synchronous preparation falls back after the bounded phase", () => {
  let now = 0;
  assert.throws(() => prepareBoundedTaskPackCanaryInput({
    preparationInput: boundedPreparationInput,
    deadlineMonotonicMs: 100,
    monotonicMs: () => now,
    prepare: () => { now = 101; return canonical; },
  }), (error) => error instanceof TaskPackCanaryPreparationError && error.code === "execution_timeout");
});

// Real engine execution and actual Task Pack downstream validation.
const legacyA: TaskPackCanaryRuntimeInput["legacySelection"] = {
  ...legacySelection,
  selectedFiles: [{
    path: "src/legacy-a.ts", kind: "source", usage: "inspect-and-edit",
    reason: "Legacy baseline A.", confidence: 0.9,
  }, {
    path: "apps/renderer/src/pages/SettingsPage.tsx", kind: "source", usage: "inspect-only",
    reason: "Legacy supporting B.", confidence: 0.7,
  }],
};
let realProductionSelection: TaskPackCanaryRuntimeInput["legacySelection"] | null = null;
const realResolution = await runLiveTaskPackCanary({
  ...runtimeInput({ legacySelection: legacyA }),
  validateDownstream: (candidate) => {
    const result = validateTaskPackCanaryCandidate({
      rawTask: canonical.normalizedTask,
      requestedTaskType: "general",
      effectiveTaskArea: "general",
      inventory,
      taskIntent,
      contextQualityMode: "balanced",
      candidate,
    });
    realProductionSelection = result.productionSelection;
    return { validatedFiles: result.validatedFiles, validation: result.validation };
  },
});
const realEffectiveSelection = applyValidatedTaskPackCanarySelection({
  legacySelection: legacyA,
  resolution: realResolution,
  productionSelection: realProductionSelection,
});
await scenario("real grounded canary executes", () => assert.notEqual(realResolution.decision.status, "legacy_fallback"));
await scenario("real grounded canary applies v2", () => assert.equal(realResolution.applied, true));
await scenario("real grounded canary status is v2_applied", () => assert.equal(realResolution.decision.status, "v2_applied"));
await scenario("real grounded target is selected", () => assert.equal(realEffectiveSelection.selectedFiles[0]?.path, "apps/renderer/src/pages/SettingsPage.tsx"));
await scenario("real target usage is editable", () => assert.equal(realEffectiveSelection.selectedFiles[0]?.usage, "inspect-and-edit"));
await scenario("canary resolution exposes only path usage and kind", () => assert.deepEqual(Object.keys(realResolution.adoptedFiles?.[0] ?? {}).sort(), ["kind", "path", "usage"]));
await scenario("real mapping has production authorization contract", () => assert.equal(realEffectiveSelection.diagnostics?.executionContract?.allowImplementationGuidance, true));
await scenario("real downstream quality is ready", () => assert.equal(realResolution.decision.downstreamValidation?.qualityStatus, "ready"));
await scenario("real downstream explicit target is matched", () => assert.equal(realResolution.decision.downstreamValidation?.explicitTargetStatus, "matched"));
await scenario("real downstream authorization is preserved", () => assert.equal(realResolution.decision.downstreamValidation?.authorizationPreserved, true));
await scenario("real context assembly is eligible", () => assert.equal(realResolution.decision.downstreamValidation?.contextAssemblyEligible, true));
await scenario("decision contains no source marker", () => assert.equal(JSON.stringify(realResolution.decision).includes(sourceMarker), false));
await scenario("decision contains no absolute root", () => assert.equal(JSON.stringify(realResolution.decision).includes(root), false));
await scenario("decision contains no raw task", () => assert.equal(JSON.stringify(realResolution.decision).includes(canonical.normalizedTask), false));
await scenario("decision contains no finding IDs", () => assert.equal(JSON.stringify(realResolution.decision).includes("finding"), false));
await scenario("decision contains no evidence IDs", () => assert.equal(JSON.stringify(realResolution.decision).includes("evidence"), false));
await scenario("decision record is deeply frozen", () => assert.equal(Object.isFrozen(realResolution.decision), true));
await scenario("v2 decision summary contains only paths and usages", () => assert.deepEqual(Object.keys(realResolution.decision.v2?.files[0] ?? {}).sort(), ["path", "usage"]));
await scenario("cohort allowlist is recorded", () => assert.equal(realResolution.decision.cohort.allowlisted, true));
await scenario("decision ID is portable", () => assert.match(realResolution.decision.decisionId, /^canary-[a-f0-9-]+$/u));
await scenario("decision validates as closed artifact", () => assert.doesNotThrow(() => validateTaskPackCanaryDecision(realResolution.decision)));

// Production adoption is a whole-selection switch, independent of metadata.
assert.ok(realProductionSelection);
let actualEnqueueCount = 0;
const actualSeal = sealTaskPackCanaryProductionResolution({
  legacySelection: legacyA,
  resolution: realResolution,
  productionSelection: realProductionSelection,
  requestStartedMonotonicMs: 0,
  requestDeadlineMonotonicMs: 1_000,
  monotonicMs: () => 100,
  enqueue: () => { actualEnqueueCount += 1; return "enqueued"; },
});
const switchedToB = actualSeal.effectiveSelection;
await scenario("actual adoption is sealed through the Task Pack route boundary", () => assert.equal(actualSeal.canaryApplied, true));
await scenario("successful actual adoption enqueues exactly one final decision", () => assert.equal(actualEnqueueCount, 1));
await scenario("successful actual adoption emits final v2_applied", () => assert.equal(actualSeal.finalResolution.decision.status, "v2_applied"));
await scenario("legacy A is replaced by validated v2 B", () => assert.deepEqual(switchedToB.selectedFiles.map((file) => file.path), ["apps/renderer/src/pages/SettingsPage.tsx"]));
await scenario("successful production switch contains no legacy A", () => assert.equal(switchedToB.selectedFiles.some((file) => file.path === "src/legacy-a.ts"), false));
await scenario("successful production switch never contains A plus B", () => assert.equal(switchedToB.selectedFiles.length, 1));
await scenario("ineligible resolution preserves legacy A", () => {
  const selected = applyValidatedTaskPackCanarySelection({
    legacySelection: legacyA,
    resolution: { applied: false, adoptedFiles: null },
    productionSelection: realProductionSelection,
  });
  assert.equal(selected, legacyA);
});
await scenario("mismatched downstream envelope preserves legacy A", () => {
  const selected = applyValidatedTaskPackCanarySelection({
    legacySelection: legacyA,
    resolution: realResolution,
    productionSelection: legacyA,
  });
  assert.equal(selected, legacyA);
});

let noOpProductionSelection: TaskPackCanaryRuntimeInput["legacySelection"] | null = null;
const noOpResolution = await runLiveTaskPackCanary({
  ...runtimeInput(),
  validateDownstream: (candidate) => {
    const result = validateTaskPackCanaryCandidate({
      rawTask: canonical.normalizedTask,
      requestedTaskType: "general",
      effectiveTaskArea: "general",
      inventory,
      taskIntent,
      contextQualityMode: "balanced",
      candidate,
    });
    noOpProductionSelection = result.productionSelection;
    return { validatedFiles: result.validatedFiles, validation: result.validation };
  },
});
let noOpEnqueueCount = 0;
const noOpSeal = sealTaskPackCanaryProductionResolution({
  legacySelection,
  resolution: noOpResolution,
  productionSelection: noOpProductionSelection,
  requestStartedMonotonicMs: 0,
  requestDeadlineMonotonicMs: 1_000,
  monotonicMs: () => 100,
  enqueue: () => { noOpEnqueueCount += 1; return "enqueued"; },
});
await scenario("equal normalized path usage has no semantic delta", () => assert.equal(
  hasTaskPackCanarySelectionDelta(legacySelection, [{ path: "./apps/renderer/src/pages/SettingsPage.tsx", kind: "source", usage: "inspect-and-edit" }]),
  false,
));
await scenario("path usage delta comparison is input-order independent", () => assert.equal(
  hasTaskPackCanarySelectionDelta(legacyA, [
    { path: "apps/renderer/src/pages/SettingsPage.tsx", kind: "source", usage: "inspect-only" },
    { path: "src/legacy-a.ts", kind: "source", usage: "inspect-and-edit" },
  ]),
  false,
));
await scenario("same legacy and v2 selection preserves the original object", () => assert.equal(noOpSeal.effectiveSelection, legacySelection));
await scenario("same selection records passed gates without production adoption", () => {
  assert.equal(noOpSeal.finalResolution.gatesPassed, true);
  assert.equal(noOpSeal.finalResolution.selectionDelta, false);
  assert.equal(noOpSeal.finalResolution.decision.status, "v2_confirmed_no_change");
});
await scenario("same selection enqueues one final no-change decision", () => assert.equal(noOpEnqueueCount, 1));
await scenario("same selection creates no confidence-unavailable override", () => assert.equal(noOpSeal.confidenceUnavailablePaths.size, 0));
const legacyNoOpReferences = buildFileReferences({ inventory, fileSelection: legacySelection });
const sealedNoOpReferences = buildFileReferences({
  inventory,
  fileSelection: noOpSeal.effectiveSelection,
  confidenceUnavailablePaths: noOpSeal.confidenceUnavailablePaths,
});
await scenario("same selection file references remain deep-equal to legacy", () => assert.deepEqual(sealedNoOpReferences, legacyNoOpReferences));
const legacyNoOpPrompt = buildRelevantFilesSection({ fileReferences: legacyNoOpReferences } as Parameters<typeof buildRelevantFilesSection>[0]);
const sealedNoOpPrompt = buildRelevantFilesSection({ fileReferences: sealedNoOpReferences } as Parameters<typeof buildRelevantFilesSection>[0]);
await scenario("same selection prompt remains byte-equal to legacy", () => assert.equal(sealedNoOpPrompt, legacyNoOpPrompt));

const productionReferences = buildFileReferences({
  inventory,
  fileSelection: switchedToB,
  confidenceUnavailablePaths: actualSeal.confidenceUnavailablePaths,
});
const productionPromptSection = buildRelevantFilesSection({
  fileReferences: productionReferences,
} as Parameters<typeof buildRelevantFilesSection>[0]);
for (const forbidden of [
  "finding", "evidence ID", "Repository-grounded editable implementation target",
  "context-engine-v2-ce2-05", "roleAdjustments", "compatibility-derived confidence",
  "selection signal: 0%",
]) {
  await scenario(`production prompt omits ${forbidden}`, () => assert.equal(productionPromptSection.includes(forbidden), false));
}
await scenario("unavailable confidence renders without a percentage", () => assert.match(productionPromptSection, /grounded automatic selection passed production validation/u));
await scenario("unavailable confidence renders no numeric evidence percentage", () => assert.equal(/evidence:[^\n]*%/u.test(productionPromptSection), false));
await scenario("legacy A is absent from the v2 production prompt section", () => assert.equal(productionPromptSection.includes("src/legacy-a.ts"), false));
await scenario("only v2 B appears in production context references", () => assert.deepEqual(
  productionReferences.map((file) => file.path),
  ["apps/renderer/src/pages/SettingsPage.tsx"],
));
const productionSnippets = await buildSelectedFileSnippets({
  projectRoot: root,
  inventory,
  fileSelection: switchedToB,
});
await scenario("legacy A is absent from production snippet input", () => assert.equal(
  productionSnippets.some((snippet) => snippet.relativePath === "src/legacy-a.ts"),
  false,
));

const readyQuality = {
  status: "ready", requiredManualReview: false, blockingReasons: [], warnings: [], score: 100,
  signals: {
    targetConfidence: 100, matchScore: 100, confidence: 100, scopeSafety: 100,
    contextCompleteness: 100, protectedScopeRisk: 0, selectionSource: "production",
    implementationArea: "general", semanticGraphEvidence: 0, areaConflict: false,
    manualReviewReason: null, nextActions: [],
  },
} satisfies ContextSelectionQuality;
const legacyNoOpSnippets = await buildSelectedFileSnippets({
  projectRoot: root,
  inventory,
  fileSelection: legacySelection,
});
const legacyNoOpContext = buildUniversalTaskPackContext({
  rawTask: canonical.normalizedTask,
  taskType: "general",
  inventory,
  taskIntent,
  fileSelection: legacySelection,
  selectionQuality: readyQuality,
  fileSnippets: legacyNoOpSnippets,
  fileReferences: legacyNoOpReferences,
  projectMemories: [],
});
const sealedNoOpContext = buildUniversalTaskPackContext({
  rawTask: canonical.normalizedTask,
  taskType: "general",
  inventory,
  taskIntent,
  fileSelection: noOpSeal.effectiveSelection,
  selectionQuality: readyQuality,
  fileSnippets: legacyNoOpSnippets,
  fileReferences: sealedNoOpReferences,
  projectMemories: [],
});
await scenario("same selection complete prompt remains byte-equal to legacy", () => assert.equal(
  buildContextAwareTemplatePrompt("## Agent Instructions\n\nUse the selected context.", sealedNoOpContext),
  buildContextAwareTemplatePrompt("## Agent Instructions\n\nUse the selected context.", legacyNoOpContext),
));
await scenario("same selection keeps legacy quality semantics", () => assert.deepEqual(
  sealedNoOpContext.selectionQuality,
  legacyNoOpContext.selectionQuality,
));
const cacheInput = (filePath: string, reason: string): Parameters<typeof buildStableTaskPackRefinementCacheIdentity>[0] => ({
  projectId: 1,
  project: { name: "fixture", packageManager: null, detectedStack: [], readinessScore: 100, scripts: {} },
  rawTask: canonical.normalizedTask,
  taskType: "general",
  targetTool: "codex",
  effectiveTaskArea: "general",
  relevantFiles: [{
    path: filePath, kind: "source", usage: "inspect-and-edit", reason,
    confidenceAvailable: false, canReadText: true, sizeBytes: sourceBytes,
  }],
  fileSnippets: [], projectMemories: [], taskIntent, selectionQuality: readyQuality, recipe: {},
});
const cacheB = buildStableTaskPackRefinementCacheIdentity(cacheInput("apps/renderer/src/pages/SettingsPage.tsx", "reason one"));
const legacyNoOpCache = buildStableTaskPackRefinementCacheIdentity({
  ...cacheInput("apps/renderer/src/pages/SettingsPage.tsx", "ignored"),
  relevantFiles: legacyNoOpReferences,
});
const sealedNoOpCache = buildStableTaskPackRefinementCacheIdentity({
  ...cacheInput("apps/renderer/src/pages/SettingsPage.tsx", "ignored"),
  relevantFiles: sealedNoOpReferences,
});
await scenario("same selection cache identity remains equal to legacy", () => assert.equal(sealedNoOpCache, legacyNoOpCache));
await scenario("cache identity ignores production diagnostic wording", () => assert.equal(
  cacheB,
  buildStableTaskPackRefinementCacheIdentity(cacheInput("apps/renderer/src/pages/SettingsPage.tsx", "reason two")),
));
await scenario("cache identity changes when effective path changes A to B", () => assert.notEqual(
  cacheB,
  buildStableTaskPackRefinementCacheIdentity(cacheInput("src/legacy-a.ts", "reason one")),
));
const productionContext = buildUniversalTaskPackContext({
  rawTask: canonical.normalizedTask,
  taskType: "general",
  inventory,
  taskIntent,
  fileSelection: switchedToB,
  selectionQuality: readyQuality,
  fileSnippets: productionSnippets,
  fileReferences: productionReferences,
  projectMemories: [],
});
const productionPrompt = buildContextAwareTemplatePrompt("## Agent Instructions\n\nUse the selected context.", productionContext);
const productionCache = buildStableTaskPackRefinementCacheIdentity({
  ...cacheInput("apps/renderer/src/pages/SettingsPage.tsx", "ignored"),
  relevantFiles: productionReferences,
  fileSnippets: productionSnippets,
});
await scenario("orchestration prompt excludes legacy A", () => assert.equal(productionPrompt.includes("src/legacy-a.ts"), false));
await scenario("orchestration context references exclude legacy A", () => assert.equal(productionContext.relevantFiles.includes("src/legacy-a.ts"), false));
await scenario("orchestration cache identity excludes legacy A", () => assert.notEqual(
  productionCache,
  buildStableTaskPackRefinementCacheIdentity(cacheInput("src/legacy-a.ts", "legacy")),
));
for (const forbidden of ["findingId", "evidenceId", "roleAdjustments", "compatibilityConfidence", "canaryDecision"]) {
  await scenario(`production orchestration artifacts omit ${forbidden}`, () => assert.equal(
    `${productionPrompt}\n${JSON.stringify(productionContext.executionContract)}`.includes(forbidden),
    false,
  ));
}

const baselineDiagnostics: Parameters<typeof finalizeTaskPackEffectiveSelectorDiagnostics>[0]["baseline"] = {
  id: "selector-baseline", timestamp: "2026-08-02T00:00:00.000Z", projectRef: "project",
  taskHash: "task", requestedMode: "legacy", effectivePipeline: "legacy", status: "manual-review",
  executionStatus: "success", qualityStatus: "warning", selectionOrigin: "pipeline",
  fallback: null, shadowFailure: null, timings: { totalMs: 1, legacyMs: 1, shadowMs: null },
  actual: {
    pipeline: "legacy", selectedFiles: [{ path: "src/legacy-a.ts", usage: "inspect-and-edit", reason: "A", evidenceStrength: "strong" }],
    primaryTarget: "src/legacy-a.ts", implementationArea: "general", confidence: 20, quality: 40,
    blocked: false, manualReview: true, missingTarget: true, candidateCount: 1, outcome: "abstained",
    abstention: { code: "no_grounded_candidates", message: "Legacy did not confirm a target.", nextActions: [] },
  },
  legacy: null, shadow: null, comparison: null,
};
const effectiveDiagnostics = finalizeTaskPackEffectiveSelectorDiagnostics({
  baseline: baselineDiagnostics,
  quality: readyQuality,
  selection: switchedToB,
  manualSelectionApplied: false,
  canaryApplied: true,
});
await scenario("v2 applied diagnostics select B", () => assert.deepEqual(effectiveDiagnostics.actual.selectedFiles.map((file) => file.path), ["apps/renderer/src/pages/SettingsPage.tsx"]));
await scenario("v2 applied diagnostics retain legacy A only as baseline", () => assert.equal(effectiveDiagnostics.legacy?.selectedFiles[0]?.path, "src/legacy-a.ts"));
await scenario("v2 applied diagnostics clear stale missing target", () => assert.equal(effectiveDiagnostics.actual.missingTarget, false));
await scenario("v2 applied diagnostics clear stale manual review", () => assert.equal(effectiveDiagnostics.actual.manualReview, false));
await scenario("v2 applied diagnostics clear stale abstention", () => assert.equal(effectiveDiagnostics.actual.abstention, null));
await scenario("v2 applied diagnostics use the production explicit-target origin", () => assert.equal(effectiveDiagnostics.selectionOrigin, "explicit_target_fast_path"));
const noOpDiagnostics = finalizeTaskPackEffectiveSelectorDiagnostics({
  baseline: baselineDiagnostics,
  quality: readyQuality,
  selection: noOpSeal.effectiveSelection,
  manualSelectionApplied: false,
  canaryApplied: false,
});
const directLegacyDiagnostics = finalizeTaskPackEffectiveSelectorDiagnostics({
  baseline: baselineDiagnostics,
  quality: readyQuality,
  selection: legacySelection,
  manualSelectionApplied: false,
  canaryApplied: false,
});
await scenario("same selection selector diagnostics remain legacy", () => assert.deepEqual(noOpDiagnostics, directLegacyDiagnostics));
await scenario("non-applied diagnostics retain legacy abstention semantics", () => {
  const legacyDiagnostics = finalizeTaskPackEffectiveSelectorDiagnostics({
    baseline: baselineDiagnostics,
    quality: readyQuality,
    selection: legacyA,
    manualSelectionApplied: false,
    canaryApplied: false,
  });
  assert.equal(legacyDiagnostics.actual.missingTarget, true);
  assert.equal(legacyDiagnostics.actual.manualReview, true);
  assert.notEqual(legacyDiagnostics.actual.abstention, null);
});

// Execute once through the shared neutral runtime for controlled result mutations.
const testClock = { nowIso: () => "2026-08-02T00:00:00.000Z", monotonicMs: () => Math.floor(performance.now()) };
async function executeFixtureResult(signal = new AbortController().signal) {
  return createLiveContextEngineExecution({
    projectRoot: root, inventory, snapshot: canonical.snapshot,
    negativeConstraints: canonical.negativeConstraints, clock: testClock, abortSignal: signal,
    runnerInput: {
      investigationId: "canary-test-investigation" as InvestigationId,
      snapshot: canonical.snapshot, purpose: "implementation_context",
      request: {
        requestId: "canary-test-request" as InvestigationRequestId,
        projectId: canonical.projectId, task: { normalizedTask: canonical.normalizedTask },
        snapshot: canonical.snapshot, explicitTargets: canonical.explicitTargets,
        negativeConstraints: canonical.negativeConstraints, budget: canaryPolicy.budget,
        purpose: "implementation_context",
      },
      questions: [], claims: [], hypotheses: [], entities: [], facts: [], evidence: [], findings: [],
      contradictions: [], knowledgeGaps: [], operationCandidates: [], budget: canaryPolicy.budget,
      plannerPolicy: executionBasis.plannerPolicy,
      deadlineMonotonicMs: Math.ceil(performance.now() + 2_000),
    },
  });
}
const fixtureResult = await executeFixtureResult();
const serviceFor = (execute: TaskPackCanaryRuntimeInput extends never ? never : () => Promise<typeof fixtureResult>, tracker = createContextEngineShadowExecutionTracker({ maximumActiveExecutions: 2 })) =>
  createTaskPackCanaryService({ execute: async () => execute(), tracker, ...testClock });
const mutate = (change: (value: typeof fixtureResult) => void) => {
  const value = structuredClone(fixtureResult);
  change(value);
  return serviceFor(async () => value)(runtimeInput());
};

let phaseClock = 75;
const phaseService = createTaskPackCanaryService({
  execute: async () => fixtureResult,
  tracker: createContextEngineShadowExecutionTracker({ maximumActiveExecutions: 2 }),
  nowIso: testClock.nowIso,
  monotonicMs: () => phaseClock,
});
const measuredPreparationResolution = await phaseService(runtimeInput({
  requestStartedMonotonicMs: 0,
  requestDeadlineMonotonicMs: canaryPolicy.timeoutMs,
}));
await scenario("canary total timing includes work before service execution", () => assert.ok(measuredPreparationResolution.decision.timing.totalMs >= 75));

phaseClock = 75;
const slowDownstreamResolution = await phaseService(runtimeInput({
  requestStartedMonotonicMs: 0,
  requestDeadlineMonotonicMs: canaryPolicy.timeoutMs,
  validateDownstream: (files) => {
    phaseClock = canaryPolicy.timeoutMs;
    return acceptDownstream(files);
  },
}));
await scenario("downstream completion after deadline cannot apply v2", () => assert.equal(slowDownstreamResolution.applied, false));
await scenario("slow downstream records timeout fallback", () => assert.equal(slowDownstreamResolution.decision.reasonCodes.includes("execution_timeout"), true));
let deadlineEnqueueCount = 0;
const deadlineRecords: TaskPackCanaryDecision[] = [];
const deadlineSeal = sealTaskPackCanaryProductionResolution({
  legacySelection: legacyA,
  resolution: realResolution,
  productionSelection: realProductionSelection,
  requestStartedMonotonicMs: 0,
  requestDeadlineMonotonicMs: 100,
  monotonicMs: () => 100,
  enqueue: (record) => {
    deadlineEnqueueCount += 1;
    deadlineRecords.push(record);
    return "enqueued";
  },
});
await scenario("deadline crossing before final seal enqueues exactly once", () => assert.equal(deadlineEnqueueCount, 1));
await scenario("deadline final record is legacy_fallback", () => assert.equal(deadlineRecords[0]?.status, "legacy_fallback"));
await scenario("deadline final record is never v2_applied", () => assert.equal(deadlineRecords.some((record) => record.status === "v2_applied"), false));
await scenario("deadline final seal preserves the complete legacy baseline", () => assert.equal(deadlineSeal.effectiveSelection, legacyA));

let droppedNoOpRecord: TaskPackCanaryDecision | null = null;
const droppedNoOpSeal = sealTaskPackCanaryProductionResolution({
  legacySelection,
  resolution: noOpResolution,
  productionSelection: noOpProductionSelection,
  requestStartedMonotonicMs: 0,
  requestDeadlineMonotonicMs: 1_000,
  monotonicMs: () => 100,
  enqueue: (record) => { droppedNoOpRecord = record; return "dropped"; },
});
await scenario("queue drop cannot fabricate applied status for legacy output", () => {
  assert.equal(droppedNoOpSeal.effectiveSelection, legacySelection);
  assert.notEqual(droppedNoOpRecord?.status, "v2_applied");
});

const persistenceFailureSeal = sealTaskPackCanaryProductionResolution({
  legacySelection: legacyA,
  resolution: realResolution,
  productionSelection: realProductionSelection,
  requestStartedMonotonicMs: 0,
  requestDeadlineMonotonicMs: 1_000,
  monotonicMs: () => 100,
  enqueue: () => { throw new Error("persistence unavailable"); },
});
await scenario("diagnostics failure cannot change an adopted production selection", () => {
  assert.equal(persistenceFailureSeal.enqueueResult, "failed");
  assert.deepEqual(persistenceFailureSeal.effectiveSelection.selectedFiles.map((file) => file.path), ["apps/renderer/src/pages/SettingsPage.tsx"]);
});

const noExplicitCanonical = prepareContextEngineShadowInput({
  projectId: "project-1", projectRoot: root, inventory,
  normalizedTask: "Update the Settings page heading.", clarificationBasis: [],
  structuredTargets: [], protectedScopes: [], executionBasis,
  createdAt: canonical.snapshot.createdAt,
});
const nonExplicitResolution = await serviceFor(async () => fixtureResult)(runtimeInput({
  canonical: noExplicitCanonical,
}));
await scenario("non-explicit grounded target is not adopted in first canary", () => assert.equal(nonExplicitResolution.applied, false));
await scenario("non-explicit target has explicit-target-only reason", () => assert.equal(nonExplicitResolution.decision.reasonCodes.includes("explicit_target_only_canary"), true));

const disabledResolution = await serviceFor(async () => { throw new Error("must not run"); })(runtimeInput({ mode: "disabled" }));
await scenario("disabled mode does not execute CE2", () => assert.equal(disabledResolution.decision.status, "not_enabled"));
await scenario("disabled mode returns no adopted files", () => assert.equal(disabledResolution.adoptedFiles, null));
const shadowResolution = await serviceFor(async () => { throw new Error("must not run"); })(runtimeInput({ mode: "shadow" }));
await scenario("shadow mode is not canary authority", () => assert.equal(shadowResolution.decision.status, "not_enabled"));
const excludedResolution = await serviceFor(async () => { throw new Error("must not run"); })(runtimeInput({ configuration: { percent: 0, projectIds: [] } }));
await scenario("excluded cohort never executes CE2", () => assert.equal(excludedResolution.decision.status, "not_in_cohort"));
await scenario("excluded cohort returns no adopted files", () => assert.equal(excludedResolution.adoptedFiles, null));
const manualResolution = await serviceFor(async () => { throw new Error("must not run"); })(runtimeInput({ manualSelectionRequested: true }));
await scenario("manual selection remains authoritative", () => assert.equal(manualResolution.decision.reasonCodes.includes("manual_selection_authoritative"), true));

const forgedCanonicalResolution = await serviceFor(async () => fixtureResult)(runtimeInput({ canonical: { ...canonical, taskFingerprint: canonical.snapshotFingerprint } }));
await scenario("forged canonical fingerprint is rejected", () => assert.equal(forgedCanonicalResolution.decision.status, "critical_disagreement"));
await scenario("forged canonical input returns legacy", () => assert.equal(forgedCanonicalResolution.applied, false));
const unsafeStop = await mutate((value) => { value.stop = { ...value.stop, reason: "clarification_required", safeToProject: false }; value.safeToProject = false; });
await scenario("clarification_required is ineligible", () => assert.equal(unsafeStop.applied, false));
const budgetStop = await mutate((value) => { value.stop = { ...value.stop, reason: "operation_budget_exhausted", safeToProject: false }; value.safeToProject = false; });
await scenario("budget exhaustion is ineligible", () => assert.equal(budgetStop.applied, false));
const noGrounded = await mutate((value) => { value.stop = { ...value.stop, reason: "no_grounded_lead", safeToProject: false }; value.safeToProject = false; });
await scenario("no grounded lead is ineligible", () => assert.equal(noGrounded.applied, false));
const ineligibleSeal = sealTaskPackCanaryProductionResolution({
  legacySelection: legacyA,
  resolution: noGrounded,
  productionSelection: realProductionSelection,
  requestStartedMonotonicMs: 0,
  requestDeadlineMonotonicMs: 1_000,
  monotonicMs: () => 100,
  enqueue: () => "enqueued",
});
await scenario("ineligible v2 preserves the original legacy production selection", () => assert.equal(ineligibleSeal.effectiveSelection, legacyA));
const contradictory = await mutate((value) => { value.stop = { ...value.stop, reason: "contradictory_evidence", safeToProject: false }; value.safeToProject = false; });
await scenario("contradictory stop is ineligible", () => assert.equal(contradictory.applied, false));
const repositoryChanged = await mutate((value) => { value.stop = { ...value.stop, reason: "repository_changed", safeToProject: false }; value.safeToProject = false; });
await scenario("repository changed is rejected", () => assert.equal(repositoryChanged.applied, false));
const unsafeProjection = await mutate((value) => { value.safeToProject = false; });
await scenario("incoherent safeToProject is rejected", () => assert.equal(unsafeProjection.applied, false));
const mixedSnapshot = await mutate((value) => { value.snapshotId = "snapshot-mixed" as typeof value.snapshotId; });
await scenario("mixed snapshot is rejected", () => assert.equal(mixedSnapshot.applied, false));
await scenario("mixed snapshot is a critical disagreement", () => assert.equal(mixedSnapshot.decision.status, "critical_disagreement"));

const downstreamMutation = await serviceFor(async () => fixtureResult)(runtimeInput({
  validateDownstream: (candidate) => ({
    ...acceptDownstream(candidate),
    validatedFiles: [],
  }),
}));
await scenario("downstream cannot silently mutate selection", () => assert.equal(downstreamMutation.applied, false));
await scenario("downstream mutation reason is recorded", () => assert.equal(downstreamMutation.decision.reasonCodes.includes("downstream_selection_mutated"), true));
const downstreamFailureSeal = sealTaskPackCanaryProductionResolution({
  legacySelection: legacyA,
  resolution: downstreamMutation,
  productionSelection: realProductionSelection,
  requestStartedMonotonicMs: 0,
  requestDeadlineMonotonicMs: 1_000,
  monotonicMs: () => 100,
  enqueue: () => "enqueued",
});
await scenario("downstream validation failure preserves the original legacy production selection", () => assert.equal(downstreamFailureSeal.effectiveSelection, legacyA));
await scenario("downstream failure keeps the entire legacy A selection", () => assert.equal(
  applyValidatedTaskPackCanarySelection({
    legacySelection: legacyA,
    resolution: downstreamMutation,
    productionSelection: realProductionSelection,
  }),
  legacyA,
));
for (const [name, validation] of [
  ["blocked quality falls back", { passed: false, qualityStatus: "blocked", explicitTargetStatus: "matched", authorizationPreserved: false, contextAssemblyEligible: true, reasonCodes: ["downstream_quality_blocked"] }],
  ["manual review falls back", { passed: false, qualityStatus: "warning", explicitTargetStatus: "matched", authorizationPreserved: false, contextAssemblyEligible: true, reasonCodes: ["downstream_manual_review"] }],
  ["unresolved explicit target falls back", { passed: false, qualityStatus: "ready", explicitTargetStatus: "unresolved", authorizationPreserved: false, contextAssemblyEligible: true, reasonCodes: ["downstream_explicit_target_rejected"] }],
  ["authorization rejection falls back", { passed: false, qualityStatus: "ready", explicitTargetStatus: "matched", authorizationPreserved: false, contextAssemblyEligible: true, reasonCodes: ["downstream_authorization_rejected"] }],
  ["context assembly rejection falls back", { passed: false, qualityStatus: "ready", explicitTargetStatus: "matched", authorizationPreserved: true, contextAssemblyEligible: false, reasonCodes: ["downstream_context_ineligible"] }],
] as Array<[string, TaskPackCanaryDownstreamValidation]>) {
  const resolution = await serviceFor(async () => fixtureResult)(runtimeInput({
    validateDownstream: (selection) => ({ validatedFiles: [...selection], validation: structuredClone(validation) }),
  }));
  await scenario(name, () => assert.equal(resolution.applied, false));
}

const failedExecution = await serviceFor(async () => { throw new Error(`private ${sourceMarker} ${root}`); })(runtimeInput());
await scenario("runner exception returns legacy", () => assert.equal(failedExecution.decision.status, "legacy_fallback"));
await scenario("runner exception message is absent", () => assert.equal(JSON.stringify(failedExecution.decision).includes(sourceMarker), false));
await scenario("runner exception path is absent", () => assert.equal(JSON.stringify(failedExecution.decision).includes(root), false));
const neverTracker = createContextEngineShadowExecutionTracker({ maximumActiveExecutions: 1 });
const neverService = createTaskPackCanaryService({ execute: async () => new Promise(() => undefined), tracker: neverTracker, ...testClock });
const timeoutStarted = performance.now();
const timeoutResolution = await neverService(runtimeInput());
await scenario("non-cooperative execution returns within ceiling", () => assert.ok(performance.now() - timeoutStarted < canaryPolicy.timeoutMs + 500));
await scenario("timeout returns legacy", () => assert.equal(timeoutResolution.decision.reasonCodes.includes("execution_timeout"), true));
await scenario("non-cooperative execution remains tracked", () => assert.equal(neverTracker.state().active, 1));
const capacityResolution = await neverService(runtimeInput());
await scenario("tracker capacity is bounded", () => assert.equal(neverTracker.state().capacity, 1));
await scenario("capacity exhaustion returns legacy", () => assert.equal(capacityResolution.decision.reasonCodes.includes("capacity_exhausted"), true));
await scenario("bounded shutdown does not hang", async () => assert.equal(await neverTracker.close(10), false));

// Diagnostics, privacy, rollback, and production contract.
let persisted: unknown = [];
const history = createTaskPackCanaryHistory({
  read: async () => structuredClone(persisted),
  write: async (value) => { persisted = structuredClone(value); },
  limit: 3,
});
await scenario("canary history appends separately", async () => assert.equal((await history.append(realResolution.decision)).length, 1));
await scenario("canary history returns frozen clone", async () => assert.equal(Object.isFrozen(await history.get()), true));
await scenario("canary history read is defensive", async () => assert.notEqual(await history.get(), persisted));
await scenario("canary history is newest-first", async () => {
  await history.append({ ...structuredClone(realResolution.decision), decisionId: "canary-later", createdAt: "2099-01-01T00:00:00.000Z" });
  assert.equal((await history.get())[0]?.decisionId, "canary-later");
});
await scenario("concurrent history append preserves decisions", async () => {
  await Promise.all([
    history.append({ ...structuredClone(realResolution.decision), decisionId: "canary-a", createdAt: "2098-01-01T00:00:00.000Z" }),
    history.append({ ...structuredClone(realResolution.decision), decisionId: "canary-b", createdAt: "2098-01-02T00:00:00.000Z" }),
  ]);
  const ids = (await history.get()).map((record) => record.decisionId);
  assert.ok(ids.includes("canary-a") && ids.includes("canary-b"));
});
await scenario("history limit is enforced", async () => assert.equal((await history.get()).length, 3));
await scenario("history clear is isolated", async () => { await history.clear(); assert.deepEqual(await history.get(), []); });
await scenario("malformed decision extra field is rejected", () => assert.throws(() => validateTaskPackCanaryDecision({ ...realResolution.decision, rawTask: canonical.normalizedTask })));
await scenario("forged applied decision without downstream proof is rejected", () => {
  assert.throws(() => validateTaskPackCanaryDecision({ ...realResolution.decision, downstreamValidation: null }));
});
await scenario("editable summary must match editable usages exactly", () => {
  const forged = structuredClone(realResolution.decision) as TaskPackCanaryDecision;
  forged.legacy.editablePaths = [];
  assert.throws(() => validateTaskPackCanaryDecision(forged));
});
await scenario("absolute path in decision is rejected", () => {
  const forged = structuredClone(realResolution.decision) as TaskPackCanaryDecision;
  forged.legacy.files[0]!.path = root;
  assert.throws(() => validateTaskPackCanaryDecision(forged));
});
await scenario("secret token in decision is rejected", () => {
  assert.throws(() => validateTaskPackCanaryDecision({ ...realResolution.decision, decisionId: "sk-secret-token-abcdefghijklmnopqrstuvwxyz" }));
});
await scenario("decision accessor is rejected without execution", () => {
  let accessed = false;
  const forged = Object.create(null) as Record<string, unknown>;
  Object.defineProperty(forged, "schemaVersion", { enumerable: true, get() { accessed = true; return 1; } });
  assert.throws(() => validateTaskPackCanaryDecision(forged));
  assert.equal(accessed, false);
});
let writerPersisted = 0;
let writerPersistedDecision: TaskPackCanaryDecision | null = null;
const writer = createTaskPackCanaryDiagnosticsWriter({
  persist: async (record) => { writerPersisted += 1; writerPersistedDecision = record; },
  maxQueueLength: 2,
});
await scenario("diagnostics writer tracks worker", () => { writer.enqueue(realResolution.decision); assert.equal(writer.state().workerTracked, true); });
await scenario("diagnostics writer flushes", async () => assert.equal(await writer.flush(100), true));
await scenario("diagnostics writer persisted record", () => assert.equal(writerPersisted, 1));
await scenario("persisted timing includes synchronous diagnostics enqueue work", () => assert.ok(
  (writerPersistedDecision?.timing.totalMs ?? -1) >= realResolution.decision.timing.totalMs,
));
await scenario("diagnostics writer closes bounded", async () => assert.equal(await writer.close(100), true));
await scenario("closed writer rejects new records", () => assert.equal(writer.enqueue(realResolution.decision), "closed"));

const rollbackDisabled = await serviceFor(async () => { throw new Error("disabled must not execute"); })(runtimeInput({ mode: "disabled" }));
await scenario("canary to disabled restores legacy next request", () => assert.equal(rollbackDisabled.adoptedFiles, null));
const rollbackShadow = await serviceFor(async () => { throw new Error("shadow must not execute canary"); })(runtimeInput({ mode: "shadow" }));
await scenario("canary to shadow restores legacy authority", () => assert.equal(rollbackShadow.adoptedFiles, null));
await scenario("rollback has no stale candidate", () => assert.equal(rollbackDisabled.applied, false));
const concurrent = await Promise.all([
  serviceFor(async () => fixtureResult)(runtimeInput()),
  serviceFor(async () => fixtureResult)(runtimeInput()),
]);
await scenario("concurrent request decisions are unique", () => assert.notEqual(concurrent[0]?.decision.decisionId, concurrent[1]?.decision.decisionId));
await scenario("concurrent requests retain project identity", () => assert.equal(concurrent.every((item) => item.decision.cohort.allowlisted), true));

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const taskPackSource = await fs.readFile(path.join(repositoryRoot, "server/src/routes/taskPacks.ts"), "utf8");
const selectorSource = await fs.readFile(path.join(repositoryRoot, "server/src/selection/selectorPipelineOrchestrator.ts"), "utf8");
const canaryServiceSource = await fs.readFile(path.join(repositoryRoot, "server/src/contextEngineV2/canary/taskPackCanaryService.ts"), "utf8");
await scenario("Task Pack route imports only public canary facade", () => assert.match(taskPackSource, /from "\.\.\/contextEngineV2\/canary\/index\.js"/u));
await scenario("Task Pack route keeps legacy baseline calculation", () => assert.match(taskPackSource, /runSelectorPipeline\(selectorInput\)/u));
await scenario("Task Pack route applies canary before quality evaluation", () => assert.ok(taskPackSource.indexOf("runLiveTaskPackCanary") < taskPackSource.indexOf("Evaluate context quality")));
await scenario("Task Pack route runs explicit target guard downstream", () => assert.match(taskPackSource, /validateTaskPackCanaryCandidate[\s\S]*applyExplicitTargetGuard/u));
await scenario("Task Pack route runs quality guard downstream", () => assert.match(taskPackSource, /validateTaskPackCanaryCandidate[\s\S]*evaluateContextSelectionQuality/u));
await scenario("Task Pack route runs authorization authority downstream", () => assert.match(taskPackSource, /validateTaskPackCanaryCandidate[\s\S]*enforceExecutionAuthorizationAuthority/u));
await scenario("canary timing starts before canonical preparation", () => assert.ok(taskPackSource.indexOf("canaryRequestStarted") < taskPackSource.lastIndexOf("prepareBoundedTaskPackCanaryInput")));
await scenario("canary diagnostic timing is finalized by the production seal", () => assert.match(taskPackSource, /sealTaskPackCanaryProductionResolution\([\s\S]*enqueue:\s*enqueueContextEngineTaskPackCanaryDecision/u));
await scenario("Task Pack route has no pre-seal canary enqueue", () => assert.ok(taskPackSource.indexOf("sealTaskPackCanaryProductionResolution") < taskPackSource.indexOf("enqueue: enqueueContextEngineTaskPackCanaryDecision")));
await scenario("Task Pack route has no second timeout decision enqueue", () => assert.equal(taskPackSource.includes("canary timeout diagnostics"), false));
await scenario("preparation failure path does not map rejected inventory files", () => assert.equal(
  /createTaskPackCanaryPreparationFailure\([\s\S]{0,800}inventory\.files\.map/u.test(taskPackSource),
  false,
));
await scenario("Task Pack prompt receives no canary decision", () => assert.equal(/buildContextAwareTemplatePrompt\([^)]*canary/iu.test(taskPackSource), false));
await scenario("Task Pack storage receives no canary decision", () => assert.equal(/storage\.createTaskPack\([\s\S]{0,800}canary/iu.test(taskPackSource), false));
await scenario("Task Pack public return contains no canary field", () => assert.equal(/return\s*\{[\s\S]{0,300}canaryDecision/iu.test(taskPackSource), false));
await scenario("selection implementation does not import canary", () => assert.equal(selectorSource.includes("contextEngineV2/canary"), false));
await scenario("production mapping reason contains no trace IDs", () => assert.equal(realEffectiveSelection.selectedFiles.some((file) => /finding|evidence/iu.test(file.reason)), false));
await scenario("effective selection source is deterministic", () => assert.equal(realEffectiveSelection.source, "deterministic"));
await scenario("canary service emits no production reason text", () => assert.equal(canaryServiceSource.includes("Repository-grounded editable implementation target"), false));
await scenario("canary service emits no compatibility confidence", () => assert.equal(canaryServiceSource.includes("compatibility-derived confidence"), false));
await scenario("canary service emits no selector diagnostics", () => assert.equal(canaryServiceSource.includes("selectorVersion"), false));
await scenario("no legacy and v2 lists are merged", () => assert.equal(taskPackSource.includes("...initialFileSelection.selectedFiles"), false));
await scenario("overlap never chooses a winner", () => assert.equal(taskPackSource.includes("v2_better"), false));
await scenario("synthetic fixture does not enable rollout", () => assert.equal(normalizeContextEngineCanaryConfiguration({ percent: undefined, projectIds: undefined }).percent, 0));

assert.ok(scenarios >= 100, `Expected at least 100 canary scenarios, received ${scenarios}.`);
console.log(`Context Engine v2 Task Pack canary smoke: ${scenarios} scenarios passed.`);
await fs.rm(root, { recursive: true, force: true });
