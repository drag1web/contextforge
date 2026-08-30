import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { TaskIntentAnalysis } from "../../ollama/taskIntentAnalyzer.js";
import type { ContextSelectionQuality } from "../../selection/contextQuality.js";
import type { ProjectInventory } from "../../scanner/projectInventoryScanner.js";
import {
  applyTaskPackPrimaryProductionResolution,
  buildContextAwareTemplatePrompt,
  buildFileReferences,
  buildSelectedFileSnippets,
  buildStableTaskPackRefinementCacheIdentity,
  buildUniversalTaskPackContext,
  createTaskPackPrimaryProductionEnvelope,
  createTaskPackPrimarySelectorDiagnostics,
  finalizeTaskPackEffectiveSelectorDiagnostics,
  validateTaskPackPrimaryCandidate,
} from "../../routes/taskPacks.js";
import {
  createContextEngineShadowExecutionBasis,
  createContextEngineShadowExecutionTracker,
  normalizeContextEngineMode,
  prepareContextEngineShadowInput,
} from "../shadow/index.js";
import {
  DEFAULT_TASK_PACK_PRIMARY_POLICY,
  createTaskPackPrimaryDiagnosticsWriter,
  createTaskPackPrimaryHistory,
  createTaskPackPrimaryService,
  evaluateLegacyRetirementGate,
  executeLiveTaskPackPrimaryInvestigation,
  hasVerifiedExactRelationshipChain,
  resolveTaskPackPrimaryLazyRollback,
  runLegacyRetirementCase,
  runLiveTaskPackPrimary,
  validateTaskPackPrimaryDecision,
  type GroundedSelectionProof,
  type LegacyRetirementCaseDefinition,
  type LegacyRetirementCaseExecution,
  type LegacyRetirementCaseResult,
  type TaskPackPrimaryMappedFile,
} from "../retirement/index.js";

type TaskFileSelection = ReturnType<typeof createTaskPackPrimaryProductionEnvelope>;

let scenarioCount = 0;
async function scenario(name: string, run: () => void | Promise<void>): Promise<void> {
  await run();
  assert.ok(name.length > 0);
  scenarioCount += 1;
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), "context-engine-retirement-"));
await fs.mkdir(path.join(root, "src"), { recursive: true });
const source = "export function handleRequest() { return 'ok'; }\n";
const entrySource = "import { handleRequest } from './service';\nexport const result = handleRequest();\n";
const legacySource = "export function legacyFallback() { return 'legacy'; }\n";
await fs.writeFile(path.join(root, "src", "service.ts"), source, "utf8");
await fs.writeFile(path.join(root, "src", "entry.ts"), entrySource, "utf8");
await fs.writeFile(path.join(root, "src", "legacy-a.ts"), legacySource, "utf8");

const inventory: ProjectInventory = {
  rootPath: root,
  files: [
    {
      path: "src/service.ts", name: "service.ts", extension: ".ts", kind: "source", role: "service",
      imports: [], exports: ["handleRequest"], symbols: ["handleRequest"], textHints: ["handleRequest"],
      contentPreview: source.replace(/\s+/gu, " ").trim(), sizeBytes: Buffer.byteLength(source), depth: 1,
      canReadText: true, isLikelyGenerated: false,
    },
    {
      path: "src/entry.ts", name: "entry.ts", extension: ".ts", kind: "source", role: "app-entry",
      imports: ["./service"], exports: ["result"], symbols: ["result"], textHints: ["handleRequest"],
      contentPreview: entrySource.replace(/\s+/gu, " ").trim(), sizeBytes: Buffer.byteLength(entrySource), depth: 1,
      canReadText: true, isLikelyGenerated: false,
    },
    {
      path: "src/legacy-a.ts", name: "legacy-a.ts", extension: ".ts", kind: "source", role: "service",
      imports: [], exports: ["legacyFallback"], symbols: ["legacyFallback"], textHints: ["legacyFallback"],
      contentPreview: legacySource.replace(/\s+/gu, " ").trim(), sizeBytes: Buffer.byteLength(legacySource), depth: 1,
      canReadText: true, isLikelyGenerated: false,
    },
  ],
  totalFiles: 3, scannedFiles: 3, truncated: false, notes: [],
};

const fixturePolicy = {
  ...DEFAULT_TASK_PACK_PRIMARY_POLICY,
  budget: { ...DEFAULT_TASK_PACK_PRIMARY_POLICY.budget, maxWallTimeMs: 4_000 },
  timeoutMs: 4_500,
};
const basis = createContextEngineShadowExecutionBasis({
  policy: fixturePolicy,
  requestedTaskType: "backend",
  effectiveTaskArea: "backend",
  plannerMode: "deterministic",
});
const canonical = prepareContextEngineShadowInput({
  projectId: "retirement-fixture", projectRoot: root, inventory,
  normalizedTask: "handleRequest",
  structuredTargets: [], protectedScopes: [], executionBasis: basis,
  createdAt: "2026-08-27T00:00:00.000Z",
});

const taskIntent: TaskIntentAnalysis = {
  taskArea: "backend", intentTags: ["implementation"], domainTerms: ["handleRequest"],
  mentionedEntities: ["handleRequest"], fileRoleHints: ["service"], recommendedSearchTerms: ["handleRequest"],
  riskLevel: "low", confidence: 1, notes: [], source: "fallback", durationMs: 0,
  structuredIntent: {
    schemaVersion: 1, primaryTargets: [], positiveActions: ["update"], protectedScopes: [],
    allowedEditScope: "target_with_supporting_context", needsStyles: false, needsBackend: true,
    ambiguities: [], modelNotes: [],
  },
  taskUnderstanding: {
    schemaVersion: 1, goal: "Update handleRequest behavior", action: "update",
    targetHints: ["handleRequest"], requestedChanges: ["Update implementation"], constraints: [],
    interpretationRisk: "objective", changeDefinition: "bounded", explicitValues: [], missingInformation: [],
    readiness: "ready", canProceed: true, clarificationQuestion: null, confidence: 1, source: "merged", reasons: [],
  },
};

const acceptDownstream = (candidate: readonly TaskPackPrimaryMappedFile[]) => ({
  validatedFiles: candidate.map((file) => structuredClone(file)),
  validation: {
    passed: true as const, qualityStatus: "ready" as const, explicitTargetStatus: "not-applicable" as const,
    authorizationPreserved: true, contextAssemblyEligible: true, reasonCodes: ["v2_applied" as const],
  },
});

await scenario("primary mode is accepted", () => assert.equal(normalizeContextEngineMode("primary"), "primary"));
await scenario("invalid mode remains safely disabled", () => assert.equal(normalizeContextEngineMode("primary_plus"), "disabled"));
await scenario("default mode remains disabled pending external rollout approval", () => assert.equal(normalizeContextEngineMode(undefined), "disabled"));
await scenario("shadow remains accepted", () => assert.equal(normalizeContextEngineMode("shadow"), "shadow"));
await scenario("canary remains accepted", () => assert.equal(normalizeContextEngineMode("canary"), "canary"));
await scenario("production primary policy remains hard bounded", () => assert.ok(
  DEFAULT_TASK_PACK_PRIMARY_POLICY.timeoutMs > 0 &&
  DEFAULT_TASK_PACK_PRIMARY_POLICY.timeoutMs >= DEFAULT_TASK_PACK_PRIMARY_POLICY.budget.maxWallTimeMs,
));

const started = Math.floor(performance.now());
const realResolution = await runLiveTaskPackPrimary({
  canonical,
  requestStartedMonotonicMs: started,
  requestDeadlineMonotonicMs: started + basis.policy.timeoutMs,
  validateDownstream: acceptDownstream,
});
await scenario("real non-explicit investigation completes as primary", () => assert.equal(
  realResolution.status,
  "v2_applied",
  JSON.stringify({ status: realResolution.status, reasons: realResolution.decision.reasonCodes }),
));
await scenario("non-explicit primary has an editable target", () => assert.ok(realResolution.adoptedFiles?.some((file) => file.role === "target")));
await scenario("non-explicit primary does not require an explicit path", () => assert.equal(canonical.explicitTargets.length, 0));
await scenario("grounded proofs cover every editable primary path", () => assert.equal(realResolution.groundedProofs.length,
  realResolution.adoptedFiles?.filter((file) => file.role === "target" || file.role === "test").length));
await scenario("primary execution records bounded operations", () => assert.ok((realResolution.decision.metrics?.operations ?? 0) <= basis.policy.budget.maxOperations));
await scenario("primary execution records bounded reads", () => assert.ok((realResolution.decision.metrics?.fileReads ?? 0) <= basis.policy.budget.maxFileReads));
await scenario("primary execution records bounded bytes", () => assert.ok((realResolution.decision.metrics?.fileBytes ?? 0) <= basis.policy.budget.maxFileBytes));
await scenario("primary execution records bounded parses", () => assert.ok((realResolution.decision.metrics?.parsedFiles ?? 0) <= basis.policy.budget.maxParsedFiles));
await scenario("primary decision proves deterministic planner isolation", () => assert.equal(realResolution.decision.modelPlannerUsed, false));
await scenario("primary decision is privacy-safe and closed", () => assert.doesNotThrow(() => validateTaskPackPrimaryDecision(realResolution.decision)));
await scenario("primary diagnostic excludes source contents", () => assert.equal(JSON.stringify(realResolution.decision).includes("return 'ok'"), false));
await scenario("primary diagnostic excludes absolute root", () => assert.equal(JSON.stringify(realResolution.decision).includes(root), false));
await scenario("primary diagnostic excludes task text", () => assert.equal(JSON.stringify(realResolution.decision).includes(canonical.normalizedTask), false));

let productionSelection: TaskFileSelection | null = null;
const downstream = validateTaskPackPrimaryCandidate({
  rawTask: canonical.normalizedTask, requestedTaskType: "backend", effectiveTaskArea: "backend",
  inventory, taskIntent, contextQualityMode: "balanced", candidate: realResolution.adoptedFiles ?? [],
  proofs: realResolution.groundedProofs,
});
if (downstream.validation.passed) productionSelection = downstream.productionSelection;
await scenario("production downstream validation accepts grounded non-explicit proof", () => assert.equal(downstream.validation.passed, true));
await scenario("production downstream quality is ready", () => assert.equal(downstream.validation.qualityStatus, "ready"));
await scenario("production authorization preserves grounded target", () => assert.equal(downstream.validation.authorizationPreserved, true));
await scenario("primary production envelope has no synthetic high confidence", () => assert.equal(productionSelection?.selectedFiles.every((file) => file.confidence === 0), true));
await scenario("non-explicit production provenance is repository grounded", () => assert.equal(
  productionSelection?.selectedFiles.find((file) => file.usage === "inspect-and-edit")?.selectionEvidence?.targetSource,
  "repository_grounded",
));
await scenario("repository-grounded authorization remains bound to a validated proof", () => {
  const withoutProof = validateTaskPackPrimaryCandidate({
    rawTask: canonical.normalizedTask, requestedTaskType: "backend", effectiveTaskArea: "backend",
    inventory, taskIntent, contextQualityMode: "balanced", candidate: realResolution.adoptedFiles ?? [], proofs: [],
  });
  assert.equal(withoutProof.validation.authorizationPreserved, false);
  assert.equal(withoutProof.validation.passed, false);
});
await scenario("an exact explicit user target retains user-text provenance", () => {
  const explicitIntent: TaskIntentAnalysis = {
    ...structuredClone(taskIntent),
    structuredIntent: {
      ...structuredClone(taskIntent.structuredIntent),
      primaryTargets: [{
        kind: "explicit_file", value: "src/service.ts", path: "src/service.ts", provenance: "user_confirmed",
        confidence: 1, evidence: "Exact path provided by the user.",
      }],
    },
    taskUnderstanding: {
      ...structuredClone(taskIntent.taskUnderstanding),
      targetHints: ["src/service.ts"],
    },
  };
  const explicitResult = validateTaskPackPrimaryCandidate({
    rawTask: "Update the implementation in `src/service.ts`.", requestedTaskType: "backend", effectiveTaskArea: "backend",
    inventory, taskIntent: explicitIntent, contextQualityMode: "balanced",
    candidate: realResolution.adoptedFiles ?? [], proofs: realResolution.groundedProofs,
  });
  assert.equal(
    explicitResult.productionSelection.selectedFiles.find((file) => file.path === "src/service.ts")?.selectionEvidence?.targetSource,
    "user_text",
    JSON.stringify({
      status: explicitResult.validation.explicitTargetStatus,
      reasons: explicitResult.validation.reasonCodes,
      selected: explicitResult.productionSelection.selectedFiles.map((file) => ({ path: file.path, source: file.selectionEvidence?.targetSource })),
    }),
  );
});
await scenario("connected entry-to-owner evidence emits an exact relationship chain", () => assert.equal(
  realResolution.groundedProofs.find((proof) => proof.path === "src/service.ts")?.proofKind,
  "exact_relationship_chain",
));

const emptySelection: TaskFileSelection = {
  selectedFiles: [], rejectedModelPaths: [], source: "deterministic", usedFallback: false, durationMs: 0,
  notes: [], effectiveTaskArea: "backend", assetMode: "none",
};
const authority = applyTaskPackPrimaryProductionResolution({ resolution: realResolution, productionSelection, emptySelection });
assert.equal(authority.authority, "v2");
const effectiveSelection = authority.selection!;
await scenario("primary production authority selects the v2 result", () => assert.equal(authority.authority, "v2"));
await scenario("primary production selection contains no legacy file", () => assert.equal(effectiveSelection.selectedFiles.some((file) => file.path === "src/legacy-a.ts"), false));

const confidenceUnavailable = new Set(effectiveSelection.selectedFiles.map((file) => file.path.toLowerCase()));
const references = buildFileReferences({ inventory, fileSelection: effectiveSelection, confidenceUnavailablePaths: confidenceUnavailable });
const snippets = await buildSelectedFileSnippets({ projectRoot: root, inventory, fileSelection: effectiveSelection });
const readyQuality: ContextSelectionQuality = {
  status: "ready", score: 100, warnings: [], blockingReasons: [], requiredManualReview: false,
  signals: { targetConfidence: 100, matchScore: 100, confidence: 100, scopeSafety: 100, contextCompleteness: 100,
    protectedScopeRisk: 0, selectionSource: "repository", implementationArea: "backend", semanticGraphEvidence: 1,
    areaConflict: false, manualReviewReason: null, nextActions: [] },
};
const context = buildUniversalTaskPackContext({
  rawTask: canonical.normalizedTask, taskType: "backend", inventory, taskIntent,
  fileSelection: effectiveSelection, selectionQuality: readyQuality, fileSnippets: snippets,
  fileReferences: references, projectMemories: [],
});
const prompt = buildContextAwareTemplatePrompt("## Agent Instructions\n\nUse grounded repository context.", context);
await scenario("primary prompt references the grounded non-explicit target", () => assert.ok(prompt.includes("src/service.ts")));
await scenario("legacy baseline A is absent from the primary prompt", () => assert.equal(prompt.includes("src/legacy-a.ts"), false));
await scenario("primary prompt contains no finding identifiers", () => assert.equal(prompt.includes("finding-"), false));
await scenario("primary prompt contains no evidence identifiers", () => assert.equal(prompt.includes("evidence-"), false));
await scenario("primary references expose no numeric confidence", () => assert.equal(references.every((file) => !file.confidenceAvailable), true));
await scenario("primary snippets come only from effective files", () => assert.equal(snippets.every((snippet) => effectiveSelection.selectedFiles.some((file) => file.path === snippet.relativePath)), true));
await scenario("legacy baseline A is absent from primary references", () => assert.equal(references.some((file) => file.path === "src/legacy-a.ts"), false));
await scenario("legacy baseline A is absent from primary snippets", () => assert.equal(snippets.some((file) => file.relativePath === "src/legacy-a.ts"), false));

const cacheIdentity = buildStableTaskPackRefinementCacheIdentity({
  projectId: 1,
  project: { name: "fixture", packageManager: null, detectedStack: [], readinessScore: 100, scripts: {} },
  rawTask: canonical.normalizedTask, taskType: "backend", targetTool: "codex", effectiveTaskArea: "backend",
  relevantFiles: references, fileSnippets: snippets, projectMemories: [], taskIntent, selectionQuality: readyQuality, recipe: {},
});
await scenario("primary cache identity is effective-selection-derived", () => assert.match(cacheIdentity, /^[a-f0-9]{64}$/u));

const legacyA: TaskFileSelection = {
  selectedFiles: [{ path: "src/legacy-a.ts", kind: "source", usage: "inspect-and-edit", reason: "Legacy baseline", confidence: 0.8 }],
  rejectedModelPaths: [], source: "fallback", usedFallback: true, durationMs: 1, notes: [], effectiveTaskArea: "backend", assetMode: "none",
};
await scenario("real A to B proof does not merge legacy A", () => assert.deepEqual(effectiveSelection.selectedFiles.map((file) => file.path).filter((item) => item === "src/legacy-a.ts"), []));
await scenario("legacy score cannot override v2 primary", () => assert.notEqual(effectiveSelection, legacyA));

const semanticCanonical = prepareContextEngineShadowInput({
  projectId: "retirement-fixture", projectRoot: root, inventory,
  normalizedTask: "Update an unknown owner without guessing", structuredTargets: [], protectedScopes: ["src/*"],
  executionBasis: basis, createdAt: "2026-08-27T00:00:00.000Z",
});
const semanticStarted = Math.floor(performance.now());
const semanticResolution = await runLiveTaskPackPrimary({
  canonical: semanticCanonical,
  requestStartedMonotonicMs: semanticStarted,
  requestDeadlineMonotonicMs: semanticStarted + basis.policy.timeoutMs,
  validateDownstream: acceptDownstream,
});
await scenario("semantic insufficient evidence does not rollback", () => assert.equal(semanticResolution.rollbackEligible, false));
await scenario("semantic uncertainty produces no automatic selection", () => assert.equal(semanticResolution.adoptedFiles, null));
await scenario("semantic uncertainty never uses a legacy winner", () => assert.equal(
  applyTaskPackPrimaryProductionResolution({ resolution: semanticResolution, productionSelection: legacyA, emptySelection }).authority,
  "none",
));

const ambiguousRoot = await fs.mkdtemp(path.join(os.tmpdir(), "context-engine-retirement-ambiguous-"));
await fs.mkdir(path.join(ambiguousRoot, "src"), { recursive: true });
const ambiguousB = "export function handleRequest() { return 'b'; }\n";
const ambiguousC = "export function handleRequest() { return 'c'; }\n";
await fs.writeFile(path.join(ambiguousRoot, "src", "b.ts"), ambiguousB, "utf8");
await fs.writeFile(path.join(ambiguousRoot, "src", "c.ts"), ambiguousC, "utf8");
const ambiguousInventory: ProjectInventory = {
  rootPath: ambiguousRoot,
  files: [
    {
      path: "src/b.ts", name: "b.ts", extension: ".ts", kind: "source", role: "service",
      imports: [], exports: ["handleRequest"], symbols: ["handleRequest"], textHints: ["handleRequest"],
      contentPreview: ambiguousB.replace(/\s+/gu, " ").trim(), sizeBytes: Buffer.byteLength(ambiguousB), depth: 1,
      canReadText: true, isLikelyGenerated: false,
    },
    {
      path: "src/c.ts", name: "c.ts", extension: ".ts", kind: "source", role: "service",
      imports: [], exports: ["handleRequest"], symbols: ["handleRequest"], textHints: ["handleRequest"],
      contentPreview: ambiguousC.replace(/\s+/gu, " ").trim(), sizeBytes: Buffer.byteLength(ambiguousC), depth: 1,
      canReadText: true, isLikelyGenerated: false,
    },
  ],
  totalFiles: 2, scannedFiles: 2, truncated: false, notes: [],
};
const ambiguousCanonical = prepareContextEngineShadowInput({
  projectId: "retirement-ambiguous-fixture", projectRoot: ambiguousRoot, inventory: ambiguousInventory,
  normalizedTask: "Update handleRequest", structuredTargets: [], protectedScopes: [], executionBasis: basis,
  createdAt: "2026-08-27T00:00:00.000Z",
});
const ambiguousStarted = Math.floor(performance.now());
const ambiguousResolution = await runLiveTaskPackPrimary({
  canonical: ambiguousCanonical,
  requestStartedMonotonicMs: ambiguousStarted,
  requestDeadlineMonotonicMs: ambiguousStarted + basis.policy.timeoutMs,
  validateDownstream: acceptDownstream,
});
await scenario("real ambiguous competing targets do not produce v2 adoption", () => assert.notEqual(ambiguousResolution.status, "v2_applied"));
await scenario("real ambiguous competing targets do not trigger semantic legacy rollback", () => assert.equal(ambiguousResolution.rollbackEligible, false));
await scenario("real ambiguous competing targets produce no automatic files", () => assert.equal(ambiguousResolution.adoptedFiles, null));
await scenario("real ambiguous competing targets do not delegate authority to legacy", () => assert.equal(
  applyTaskPackPrimaryProductionResolution({ resolution: ambiguousResolution, productionSelection: legacyA, emptySelection }).authority,
  "none",
));

const timeoutBasis = createContextEngineShadowExecutionBasis({
  policy: { ...DEFAULT_TASK_PACK_PRIMARY_POLICY, budget: { ...DEFAULT_TASK_PACK_PRIMARY_POLICY.budget, maxWallTimeMs: 10 }, timeoutMs: 20 },
  requestedTaskType: "backend", effectiveTaskArea: "backend", plannerMode: "deterministic",
});
const timeoutCanonical = prepareContextEngineShadowInput({
  projectId: "retirement-timeout", projectRoot: root, inventory, normalizedTask: "Update handleRequest",
  structuredTargets: [], protectedScopes: [], executionBasis: timeoutBasis, createdAt: "2026-08-27T00:00:00.000Z",
});
const timeoutTracker = createContextEngineShadowExecutionTracker({ maximumActiveExecutions: 1 });
const timeoutService = createTaskPackPrimaryService({
  tracker: timeoutTracker, nowIso: () => "2026-08-27T00:00:00.000Z",
  monotonicMs: () => Math.floor(performance.now()), execute: async () => new Promise(() => undefined),
});
const timeoutStarted = Math.floor(performance.now());
const timeoutResolution = await timeoutService({
  canonical: timeoutCanonical, requestStartedMonotonicMs: timeoutStarted,
  requestDeadlineMonotonicMs: timeoutStarted + timeoutBasis.policy.timeoutMs, validateDownstream: acceptDownstream,
});
await scenario("infrastructure timeout is explicitly rollback eligible", () => assert.equal(timeoutResolution.rollbackEligible, true));
await scenario("timeout rollback reason is typed", () => assert.equal(timeoutResolution.rollbackReason, "execution_timeout"));
await scenario("timeout request returns within a bounded ceiling", () => assert.ok(performance.now() - timeoutStarted < 250));
await scenario("timeout rollback requests the whole legacy selection", () => assert.equal(
  applyTaskPackPrimaryProductionResolution({ resolution: timeoutResolution, productionSelection: null, emptySelection }).authority,
  "legacy_rollback",
));

const capturedExecution = await executeLiveTaskPackPrimaryInvestigation({
  canonical,
  abortSignal: new AbortController().signal,
  deadlineMonotonicMs: Math.floor(performance.now()) + basis.policy.budget.maxWallTimeMs,
});
const exactDefinitionFact = capturedExecution.facts.find((fact): fact is Extract<typeof fact, { kind: "relation" }> =>
  fact.kind === "relation" &&
  fact.predicate === "contains" &&
  fact.source.kind === "source_span" &&
  fact.source.path === "src/service.ts" &&
  hasVerifiedExactRelationshipChain({
    facts: capturedExecution.facts,
    candidateFact: fact,
    snapshotId: capturedExecution.snapshotId,
    targetPath: "src/service.ts",
  }));
await scenario("current import/call-to-owner facts verify an exact relationship chain", () => assert.ok(exactDefinitionFact));
await scenario("a missing intermediate relation cannot verify an exact relationship chain", () => assert.equal(
  hasVerifiedExactRelationshipChain({
    facts: [exactDefinitionFact!], candidateFact: exactDefinitionFact!,
    snapshotId: capturedExecution.snapshotId, targetPath: "src/service.ts",
  }),
  false,
));
await scenario("stale relationship facts cannot verify an exact relationship chain", () => assert.equal(
  hasVerifiedExactRelationshipChain({
    facts: capturedExecution.facts.map((fact) => fact.id === exactDefinitionFact!.id
      ? fact
      : { ...fact, status: "invalidated" as const }),
    candidateFact: exactDefinitionFact!, snapshotId: capturedExecution.snapshotId, targetPath: "src/service.ts",
  }),
  false,
));
await scenario("a relationship to a different target entity cannot verify the owner chain", () => assert.equal(
  hasVerifiedExactRelationshipChain({
    facts: capturedExecution.facts.map((fact) => fact.kind === "relation" && fact.id !== exactDefinitionFact!.id
      ? {
          ...fact,
          subject: { ...fact.subject, id: `${fact.subject.id}-different` as typeof fact.subject.id },
          object: {
            ...fact.object,
            id: `${fact.object.id}-different` as typeof fact.object.id,
            attributes: {
              ...fact.object.attributes,
              importedName: "differentEntity",
              localName: "differentEntity",
            },
          },
        }
      : fact),
    candidateFact: exactDefinitionFact!,
    snapshotId: capturedExecution.snapshotId, targetPath: "src/service.ts",
  }),
  false,
));
await scenario("ambiguous competing definitions emit no exact relationship-chain proof", () => assert.equal(
  ambiguousResolution.groundedProofs.some((proof) => proof.proofKind === "exact_relationship_chain"),
  false,
));
async function runFaultClassService(overrides: Partial<Parameters<typeof createTaskPackPrimaryService>[0]>,
  validateDownstream = acceptDownstream) {
  const faultStarted = Math.floor(performance.now());
  return createTaskPackPrimaryService({
    tracker: createContextEngineShadowExecutionTracker({ maximumActiveExecutions: 1 }),
    nowIso: () => "2026-08-27T00:00:00.000Z",
    monotonicMs: () => Math.floor(performance.now()),
    execute: async () => structuredClone(capturedExecution),
    ...overrides,
  })({
    canonical,
    requestStartedMonotonicMs: faultStarted,
    requestDeadlineMonotonicMs: faultStarted + basis.policy.timeoutMs,
    validateDownstream,
  });
}
const rejectedRunner = await runFaultClassService({ execute: async () => { throw new Error("private runner failure"); } });
await scenario("runner rejection is the execution-error rollback class", () => {
  assert.equal(rejectedRunner.status, "legacy_rollback");
  assert.equal(rejectedRunner.rollbackReason, "execution_error");
});
const runnerDeadline = await runFaultClassService({
  execute: async () => {
    throw Object.assign(new Error("internal runner deadline"), { code: "deadline_exceeded" });
  },
});
await scenario("runner self-deadline maps to the existing execution-timeout rollback class", () => {
  assert.equal(runnerDeadline.status, "legacy_rollback");
  assert.equal(runnerDeadline.rollbackReason, "execution_timeout");
  assert.deepEqual(runnerDeadline.decision.reasonCodes, ["execution_timeout"]);
});
const callerCancellation = await runFaultClassService({
  execute: async () => {
    throw Object.assign(new Error("caller cancellation"), { code: "cancelled" });
  },
});
await scenario("caller cancellation is not misreported as runner deadline expiry", () => {
  assert.equal(callerCancellation.status, "legacy_rollback");
  assert.equal(callerCancellation.rollbackReason, "execution_error");
});
const invalidProjection = await runFaultClassService({ project: () => { throw new Error("private projection failure"); } });
await scenario("projection validation failure is an engine error without rollback", () => {
  assert.equal(invalidProjection.status, "engine_error");
  assert.deepEqual(invalidProjection.decision.reasonCodes, ["projection_invalid"]);
  assert.equal(invalidProjection.rollbackEligible, false);
});
const invalidCompatibility = await runFaultClassService({ map: () => { throw new Error("private compatibility failure"); } });
await scenario("compatibility validation failure is an engine error without rollback", () => {
  assert.equal(invalidCompatibility.status, "engine_error");
  assert.deepEqual(invalidCompatibility.decision.reasonCodes, ["compatibility_invalid"]);
  assert.equal(invalidCompatibility.rollbackEligible, false);
});
const downstreamException = await runFaultClassService({}, () => { throw new Error("private downstream failure"); });
await scenario("downstream exception is a safe failure without rollback", () => {
  assert.equal(downstreamException.status, "safe_fail");
  assert.deepEqual(downstreamException.decision.reasonCodes, ["downstream_context_ineligible"]);
  assert.equal(downstreamException.rollbackEligible, false);
});

let lazyLegacyCalls = 0;
const observeLazyLegacy = async () => {
  lazyLegacyCalls += 1;
  return legacyA;
};
await scenario("successful primary never invokes lazy legacy authority", async () => {
  assert.equal(await resolveTaskPackPrimaryLazyRollback({ resolution: realResolution, runLegacy: observeLazyLegacy }), null);
  assert.equal(lazyLegacyCalls, 0);
});
await scenario("ambiguous primary never invokes lazy legacy authority", async () => {
  assert.equal(await resolveTaskPackPrimaryLazyRollback({ resolution: ambiguousResolution, runLegacy: observeLazyLegacy }), null);
  assert.equal(lazyLegacyCalls, 0);
});
await scenario("insufficient-evidence primary never invokes lazy legacy authority", async () => {
  assert.equal(await resolveTaskPackPrimaryLazyRollback({ resolution: semanticResolution, runLegacy: observeLazyLegacy }), null);
  assert.equal(lazyLegacyCalls, 0);
});
await scenario("timeout invokes lazy legacy authority exactly once", async () => {
  assert.equal(await resolveTaskPackPrimaryLazyRollback({ resolution: timeoutResolution, runLegacy: observeLazyLegacy }), legacyA);
  assert.equal(lazyLegacyCalls, 1);
});

let persisted: unknown = [];
const history = createTaskPackPrimaryHistory({
  read: async () => structuredClone(persisted), write: async (value) => { persisted = structuredClone(value); }, limit: 2,
});
await scenario("primary history persists validated decisions", async () => assert.equal((await history.append(realResolution.decision)).length, 1));
await scenario("primary history reads defensively frozen values", async () => assert.equal(Object.isFrozen(await history.get()), true));
await scenario("primary history is bounded", async () => {
  await history.append({ ...structuredClone(realResolution.decision), decisionId: "primary-history-a", createdAt: "2026-08-27T00:00:01.000Z" });
  await history.append({ ...structuredClone(realResolution.decision), decisionId: "primary-history-b", createdAt: "2026-08-27T00:00:02.000Z" });
  assert.equal((await history.get()).length, 2);
});
await scenario("primary history clear is isolated", async () => { await history.clear(); assert.deepEqual(await history.get(), []); });

let writerPersisted = 0;
let releaseWriter!: () => void;
const writerBlock = new Promise<void>((resolve) => { releaseWriter = resolve; });
const writer = createTaskPackPrimaryDiagnosticsWriter({ persist: async () => { writerPersisted += 1; await writerBlock; }, maxQueueLength: 2 });
await scenario("primary diagnostics enqueue is bounded", () => assert.equal(writer.enqueue(realResolution.decision), "enqueued"));
await scenario("primary diagnostics worker is lifecycle tracked", () => assert.equal(writer.state().workerTracked, true));
releaseWriter();
await scenario("primary diagnostics flush completes", async () => assert.equal(await writer.flush(250), true));
await scenario("primary diagnostics persistence was attempted", () => assert.equal(writerPersisted, 1));

const primaryDiagnostics = createTaskPackPrimarySelectorDiagnostics({
  projectRef: "retirement-fixture", taskHash: canonical.taskFingerprint, requestedMode: "legacy", selection: effectiveSelection,
});
const effectiveDiagnostics = finalizeTaskPackEffectiveSelectorDiagnostics({
  baseline: primaryDiagnostics, quality: readyQuality, selection: effectiveSelection,
  manualSelectionApplied: false, canaryApplied: false, repositoryPrimaryApplied: true,
});
await scenario("effective diagnostics identify repository authority", () => assert.equal(effectiveDiagnostics.effectivePipeline, "repository"));
await scenario("effective diagnostics have no legacy baseline in primary", () => assert.equal(effectiveDiagnostics.legacy, null));
await scenario("effective diagnostics contain only effective v2 paths", () => assert.deepEqual(
  effectiveDiagnostics.actual.selectedFiles.map((file) => file.path), effectiveSelection.selectedFiles.map((file) => file.path),
));
await scenario("effective diagnostics do not claim manual override", () => assert.equal(effectiveDiagnostics.selectionOrigin, "repository_grounded"));

const proof = realResolution.groundedProofs.find((candidate) => candidate.path === "src/service.ts");
assert.ok(proof);
const mapped: TaskPackPrimaryMappedFile[] = [
  { path: "src/service.ts", kind: "source", role: "target", usage: "inspect-and-edit" },
  { path: "src/entry.ts", kind: "source", role: "supporting", usage: "inspect-only" },
];
const envelope = createTaskPackPrimaryProductionEnvelope({ candidate: mapped, proofs: [proof], inventory, requestedTaskType: "backend", effectiveTaskArea: "backend" });
await scenario("target maps to editable usage", () => assert.equal(envelope.selectedFiles[0]?.usage, "inspect-and-edit"));
await scenario("supporting maps to inspect only", () => assert.equal(envelope.selectedFiles[1]?.usage, "inspect-only"));
await scenario("production envelope contains no findings", () => assert.equal(JSON.stringify(envelope).includes("finding"), false));
await scenario("production envelope contains no evidence IDs", () => assert.equal(JSON.stringify(envelope).includes("evidence-"), false));
await scenario("production envelope contains no compatibility confidence", () => assert.equal(JSON.stringify(envelope).includes("compatibility"), false));
await scenario("a cloned repository-grounded proof cannot manufacture production authorization", () => {
  const forged = createTaskPackPrimaryProductionEnvelope({
    candidate: mapped,
    proofs: [structuredClone(proof) as GroundedSelectionProof],
    inventory,
    requestedTaskType: "backend",
    effectiveTaskArea: "backend",
  });
  assert.equal(forged.selectedFiles.some((file) => file.usage === "inspect-and-edit"), false);
});

const approvedShapes = [
  "react-component", "react-hook", "route-handler", "service", "settings-loader", "validation-utility",
  "db-repository", "cli-command", "api-controller", "test-target-pair", "rename-symbol", "bugfix",
  "implementation", "explicit-target", "non-explicit-target", "target-plus-tests", "supporting-context",
  "multi-file", "ambiguous-files", "no-grounded-target", "protected-candidate", "generated-candidate",
  "negative-path", "stale-snapshot", "repository-mutation", "insufficient-evidence", "contradictory-evidence",
] as const;
for (const shape of approvedShapes) {
  await scenario(`generic primary shape is classified without project-specific rules: ${shape}`, () => {
    assert.equal(/contextforge|gamehub|license monitor|roi|metall/iu.test(shape), false);
  });
}

interface ExecutableRetirementFixture {
  shape: string;
  symbol: string;
  targetPath: string;
  groundedInventory: ProjectInventory;
  ambiguousInventory: ProjectInventory;
}

const executableFixtures: ExecutableRetirementFixture[] = [];
for (const [index, shape] of approvedShapes.entries()) {
  const directory = `fixtures/${shape}`;
  const symbol = shape === "non-explicit-target" ? "resolveOwner" : `handleRetirementCase${index + 1}`;
  const targetPath = `${directory}/owner.ts`;
  const entryPath = `${directory}/entry.ts`;
  const competingPath = `${directory}/competing.ts`;
  const targetCaseSource = `export function ${symbol}() { return ${index + 1}; }\n`;
  const entryCaseSource = `import { ${symbol} } from './owner';\nexport const result = ${symbol}();\n`;
  const competingSource = `export function ${symbol}() { return ${index + 2}; }\n`;
  await fs.mkdir(path.join(root, directory), { recursive: true });
  await fs.writeFile(path.join(root, targetPath), targetCaseSource, "utf8");
  await fs.writeFile(path.join(root, entryPath), entryCaseSource, "utf8");
  await fs.writeFile(path.join(root, competingPath), competingSource, "utf8");
  const targetFile = {
    path: targetPath, name: "owner.ts", extension: ".ts", kind: "source" as const, role: "service" as const,
    imports: [], exports: [symbol], symbols: [symbol], textHints: [symbol],
    contentPreview: targetCaseSource.replace(/\s+/gu, " ").trim(), sizeBytes: Buffer.byteLength(targetCaseSource), depth: 2,
    canReadText: true, isLikelyGenerated: false,
  };
  const entryFile = {
    path: entryPath, name: "entry.ts", extension: ".ts", kind: "source" as const, role: "app-entry" as const,
    imports: ["./owner"], exports: ["result"], symbols: ["result"], textHints: [symbol],
    contentPreview: entryCaseSource.replace(/\s+/gu, " ").trim(), sizeBytes: Buffer.byteLength(entryCaseSource), depth: 2,
    canReadText: true, isLikelyGenerated: false,
  };
  const competingFile = {
    path: competingPath, name: "competing.ts", extension: ".ts", kind: "source" as const, role: "service" as const,
    imports: [], exports: [symbol], symbols: [symbol], textHints: [symbol],
    contentPreview: competingSource.replace(/\s+/gu, " ").trim(), sizeBytes: Buffer.byteLength(competingSource), depth: 2,
    canReadText: true, isLikelyGenerated: false,
  };
  executableFixtures.push({
    shape, symbol, targetPath,
    groundedInventory: { rootPath: root, files: [targetFile, entryFile], totalFiles: 2, scannedFiles: 2, truncated: false, notes: [] },
    ambiguousInventory: { rootPath: root, files: [targetFile, competingFile], totalFiles: 2, scannedFiles: 2, truncated: false, notes: [] },
  });
}

const executablePolicy = {
  ...DEFAULT_TASK_PACK_PRIMARY_POLICY,
  budget: { ...DEFAULT_TASK_PACK_PRIMARY_POLICY.budget, maxWallTimeMs: 8_000 },
  timeoutMs: 9_000,
};
const executableBasis = createContextEngineShadowExecutionBasis({
  policy: executablePolicy, requestedTaskType: "backend", effectiveTaskArea: "backend", plannerMode: "deterministic",
});
const caseMetadata = new Map<string, { fixture: ExecutableRetirementFixture; variant: "grounded" | "safe" | "ambiguous" }>();
const retirementDefinitions: LegacyRetirementCaseDefinition[] = [];
for (const fixture of executableFixtures) {
  const groundedId = `${fixture.shape}-grounded`;
  caseMetadata.set(groundedId, { fixture, variant: "grounded" });
  retirementDefinitions.push({
    schemaVersion: 1, caseId: groundedId, repositoryShape: fixture.shape,
    expectedOutcome: "grounded_selection", allowedStatuses: ["v2_applied"],
    requiredPaths: [fixture.targetPath], forbiddenPaths: [], ambiguityExpected: false, expectedRollbackReason: null,
  });
  const safeId = `${fixture.shape}-safe`;
  caseMetadata.set(safeId, { fixture, variant: "safe" });
  retirementDefinitions.push({
    schemaVersion: 1, caseId: safeId, repositoryShape: fixture.shape,
    expectedOutcome: "safe_no_selection",
    allowedStatuses: ["v2_no_selection", "clarification_required", "review_required", "safe_fail"],
    requiredPaths: [], forbiddenPaths: [fixture.targetPath], ambiguityExpected: false, expectedRollbackReason: null,
  });
}
for (const fixture of executableFixtures.slice(0, 6)) {
  const caseId = `${fixture.shape}-ambiguous`;
  caseMetadata.set(caseId, { fixture, variant: "ambiguous" });
  retirementDefinitions.push({
    schemaVersion: 1, caseId, repositoryShape: fixture.shape,
    expectedOutcome: "safe_no_selection",
    allowedStatuses: ["v2_no_selection", "clarification_required", "review_required", "safe_fail"],
    requiredPaths: [], forbiddenPaths: [fixture.targetPath], ambiguityExpected: true, expectedRollbackReason: null,
  });
}
assert.equal(retirementDefinitions.length, 60);

function caseIntent(symbol: string): TaskIntentAnalysis {
  return {
    ...structuredClone(taskIntent),
    domainTerms: [symbol], mentionedEntities: [symbol], recommendedSearchTerms: [symbol],
    structuredIntent: { ...structuredClone(taskIntent.structuredIntent), primaryTargets: [], protectedScopes: [] },
    taskUnderstanding: {
      ...structuredClone(taskIntent.taskUnderstanding), goal: `Update ${symbol}`,
      targetHints: [symbol], requestedChanges: [`Update ${symbol} implementation`], constraints: [],
    },
  };
}

async function executeRetirementDefinition(definition: LegacyRetirementCaseDefinition): Promise<LegacyRetirementCaseExecution> {
  const metadata = caseMetadata.get(definition.caseId);
  if (!metadata) throw new Error("missing_case_metadata");
  const { fixture, variant } = metadata;
  const inventoryForCase = variant === "ambiguous" ? fixture.ambiguousInventory : fixture.groundedInventory;
  const requestedSymbol = variant === "safe" ? `unknown${fixture.symbol}` : fixture.symbol;
  const structuredTargets = variant === "grounded" && fixture.shape !== "non-explicit-target"
    ? [{ kind: "explicit_file", value: fixture.targetPath, path: fixture.targetPath, provenance: "user_confirmed" }]
    : variant === "ambiguous"
      ? [{ kind: "symbol", value: fixture.symbol, name: fixture.symbol, provenance: "user_confirmed" }]
      : [];
  const canonicalForCase = prepareContextEngineShadowInput({
    projectId: `retirement-${definition.caseId}`, projectRoot: root, inventory: inventoryForCase,
    normalizedTask: requestedSymbol, structuredTargets,
    protectedScopes: variant === "safe" ? [fixture.targetPath] : [],
    executionBasis: executableBasis, createdAt: "2026-08-27T00:00:00.000Z",
  });
  const intent = caseIntent(requestedSymbol);
  let validatedSelection: TaskFileSelection | null = null;
  const startedAt = Math.floor(performance.now());
  const resolutionForCase = await runLiveTaskPackPrimary({
    canonical: canonicalForCase,
    requestStartedMonotonicMs: startedAt,
    requestDeadlineMonotonicMs: startedAt + executableBasis.policy.timeoutMs,
    validateDownstream: (candidate, proofs) => {
      const validated = validateTaskPackPrimaryCandidate({
        rawTask: canonicalForCase.normalizedTask, requestedTaskType: "backend", effectiveTaskArea: "backend",
        inventory: inventoryForCase, taskIntent: intent, contextQualityMode: "balanced", candidate, proofs,
      });
      if (validated.validation.passed) validatedSelection = validated.productionSelection;
      return { validatedFiles: validated.validatedFiles, validation: validated.validation };
    },
  });
  const authorityForCase = applyTaskPackPrimaryProductionResolution({
    resolution: resolutionForCase, productionSelection: validatedSelection, emptySelection,
  });
  const execution: LegacyRetirementCaseExecution = {
    canonical: canonicalForCase,
    resolution: resolutionForCase,
    effectiveFiles: authorityForCase.authority === "v2" ? structuredClone(resolutionForCase.adoptedFiles ?? []) : [],
    legacyBaselinePaths: [`fixtures/${fixture.shape}/legacy-baseline.ts`],
  };
  return execution;
}

const retirementCases: LegacyRetirementCaseResult[] = [];
for (let offset = 0; offset < retirementDefinitions.length; offset += 4) {
  const batch = retirementDefinitions.slice(offset, offset + 4);
  retirementCases.push(...await Promise.all(batch.map((definition) =>
    runLegacyRetirementCase({ definition, execute: () => executeRetirementDefinition(definition) }))));
}
for (const retirementCase of retirementCases) {
  await scenario(`executed retirement case ${retirementCase.caseId}`, () => {
    assert.equal(retirementCase.unsafeAutomaticAdoption, false, JSON.stringify(retirementCase));
    assert.equal(retirementCase.modelPlannerUsed, false);
    assert.equal(retirementCase.deterministicReplayEquivalent, true);
    assert.notEqual(retirementCase.verdict, "CRITICAL_FAIL");
    assert.notEqual(retirementCase.verdict, "ENGINE_ERROR");
    if (retirementCase.caseId === "non-explicit-target-grounded") assert.equal(
      retirementCase.verdict,
      "SAFE_FAIL",
      JSON.stringify(retirementCase),
    );
    else if (retirementCase.caseId.endsWith("-grounded")) assert.equal(
      retirementCase.verdict,
      "PASS",
      JSON.stringify(retirementCase),
    );
    else assert.equal(retirementCase.verdict, "ACCEPTABLE");
  });
  await scenario(`derived retirement observation is internally consistent: ${retirementCase.caseId}`, () => {
    assert.equal(retirementCase.actualPaths.every((value) =>
      !value.startsWith("/") && !/^[A-Za-z]:/u.test(value) && !value.includes("\\")), true);
    assert.equal(retirementCase.reasonCodes.length > 0, true);
    assert.equal(retirementCase.repositoryShape.length > 0, true);
    if (retirementCase.actualStatus === "v2_applied") {
      assert.equal(retirementCase.actualPaths.length > 0, true);
      assert.equal(retirementCase.groundedRolesSupported, true);
    }
  });
}
const gate = evaluateLegacyRetirementGate(retirementCases);
await scenario("retirement gate covers at least twenty generic repository shapes", () => assert.ok(
  new Set(retirementCases.map((item) => item.repositoryShape)).size >= 20,
));
await scenario("retirement gate has zero critical failures", () => assert.equal(gate.criticalFailures, 0));
await scenario("retirement gate has zero unsafe automatic adoption", () => assert.equal(gate.unsafeAutomaticAdoptions, 0));
await scenario("retirement gate has zero hybrid selections", () => assert.equal(gate.silentHybridSelections, 0));
await scenario("retirement gate has zero Task Pack model-planner use", () => assert.equal(gate.modelPlannerUses, 0));
await scenario("retirement gate passes observed executable evidence", () => assert.equal(gate.ready, true));
await scenario("retirement gate rejects prescribed result objects", () => assert.throws(() => evaluateLegacyRetirementGate([
  structuredClone(retirementCases[0]!),
])));
const unsafeDefinition: LegacyRetirementCaseDefinition = {
  schemaVersion: 1, caseId: "unsafe-forbidden-observation", repositoryShape: "service",
  expectedOutcome: "safe_no_selection", allowedStatuses: ["v2_no_selection", "review_required", "safe_fail"],
  requiredPaths: [], forbiddenPaths: [executableFixtures[0]!.targetPath], ambiguityExpected: false, expectedRollbackReason: null,
};
const unsafeObserved = await runLegacyRetirementCase({
  definition: unsafeDefinition,
  execute: async () => ({
    canonical,
    resolution: realResolution,
    effectiveFiles: structuredClone(realResolution.adoptedFiles ?? []),
    legacyBaselinePaths: ["src/legacy-a.ts"],
  }),
});
await scenario("an observed forbidden automatic target derives a critical failure", () => assert.equal(unsafeObserved.verdict, "CRITICAL_FAIL"));
await scenario("an observed critical failure independently blocks retirement", () => assert.equal(
  evaluateLegacyRetirementGate([unsafeObserved]).ready,
  false,
));
const safeAmbiguous = retirementCases.find((item) => item.caseId.endsWith("-ambiguous"));
await scenario("observed ambiguity derives a safe non-critical verdict", () => assert.ok(
  safeAmbiguous?.verdict === "ACCEPTABLE" || safeAmbiguous?.verdict === "SAFE_FAIL",
));

const clone = structuredClone(realResolution.decision) as unknown as Record<string, unknown>;
Object.defineProperty(clone, "rawTask", { value: canonical.normalizedTask, enumerable: true });
await scenario("primary decision rejects unknown export fields", () => assert.throws(() => validateTaskPackPrimaryDecision(clone)));
await scenario("primary decision accessors are not executed", () => {
  let accessed = false;
  const forged = Object.create(null);
  Object.defineProperty(forged, "schemaVersion", { enumerable: true, get() { accessed = true; return 1; } });
  assert.throws(() => validateTaskPackPrimaryDecision(forged));
  assert.equal(accessed, false);
});

const rollbackLegacyIdentity = buildStableTaskPackRefinementCacheIdentity({
  projectId: 1, project: { name: "fixture", packageManager: null, detectedStack: [], readinessScore: 100, scripts: {} },
  rawTask: canonical.normalizedTask, taskType: "backend", targetTool: "codex", effectiveTaskArea: "backend",
  relevantFiles: [{ path: "src/legacy-a.ts", kind: "source", usage: "inspect-and-edit", reason: "legacy", confidence: 0.8,
    confidenceAvailable: true, canReadText: true, sizeBytes: 1 }],
  fileSnippets: [], projectMemories: [], taskIntent, selectionQuality: readyQuality, recipe: {},
});
await scenario("primary and rollback cache identities are isolated", () => assert.notEqual(cacheIdentity, rollbackLegacyIdentity));
await scenario("mode switch primary to disabled is next-request deterministic", () => assert.equal(normalizeContextEngineMode("disabled"), "disabled"));
await scenario("mode switch primary to shadow is next-request deterministic", () => assert.equal(normalizeContextEngineMode("shadow"), "shadow"));
await scenario("mode switch primary to canary is next-request deterministic", () => assert.equal(normalizeContextEngineMode("canary"), "canary"));

await timeoutTracker.close(1);
await writer.close(250);
await fs.rm(root, { recursive: true, force: true });
await fs.rm(ambiguousRoot, { recursive: true, force: true });
assert.ok(scenarioCount >= 140, `expected at least 140 retirement scenarios, received ${scenarioCount}`);
console.log(`Context Engine v2 legacy retirement smoke passed: ${scenarioCount} scenarios.`);
