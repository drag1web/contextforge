import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type {
  EntityId,
  EvidenceId,
  FileDescriptor,
  FindingId,
  InvestigationId,
  RepositoryEntity,
  RepositorySnapshot,
  SnapshotId,
} from "../contracts/index.js";
import type { InvestigationRunnerResult } from "../application/index.js";
import type { ClockPort, InvestigationCancellationPort } from "../ports/index.js";
import {
  GoldenTraceError,
  ValidationReportError,
  ValidationManifestError,
  ValidationRunGateError,
  applyGoldenMode,
  compareDeterministicReplays,
  compareGoldenTraces,
  createContextEngineValidationRunner,
  createGoldenTraceSummary,
  createFileGoldenStore,
  createDeterministicValidationInvestigationExecutor,
  createOfflineValidationProjectLoader,
  evaluateValidationGate,
  evaluateValidationExpectations,
  renderValidationReportMarkdown,
  serializeValidationReportJson,
  translateLegacyValidationCase,
  validateContextEngineValidationManifest,
  validateContextEngineValidationReport,
  validateGoldenTraceSummary,
  isTrustedDeterministicValidationExecutor,
  writeValidationReport,
  type ContextEngineValidationCase,
  type ContextEngineValidationManifest,
  type GoldenStore,
  type GoldenTraceSummary,
  type ValidationExecutionArtifacts,
} from "../validation/index.js";

const snapshotId = "snapshot-validation" as SnapshotId;
const investigationId = "investigation-validation" as InvestigationId;
let scenarios = 0;

async function scenario(name: string, run: () => void | Promise<void>): Promise<void> {
  try {
    await run();
    scenarios += 1;
  } catch (error) {
    throw new Error(`Validation scenario failed: ${name}`, { cause: error });
  }
}

function descriptor(input: {
  id: string;
  path: string;
  generated?: boolean;
  readable?: boolean;
  secretRisk?: FileDescriptor["secretRisk"];
}): FileDescriptor {
  return {
    id: input.id as EntityId,
    snapshotId,
    path: input.path,
    normalizedPath: input.path,
    extension: ".ts",
    language: "typescript",
    kind: "source",
    sizeBytes: 64,
    contentFingerprint: `sha256:${input.id.padEnd(64, "0").slice(0, 64)}`,
    readable: input.readable ?? true,
    generated: input.generated ?? false,
    secretRisk: input.secretRisk ?? "none",
    attributes: {},
  };
}

const targetFile = descriptor({ id: "file-target", path: "src/target.ts" });
const testFile = descriptor({ id: "file-test", path: "src/target.test.ts" });
const forbiddenFile = descriptor({ id: "file-forbidden", path: "src/private/target.ts" });
const secretFile = descriptor({ id: "file-secret", path: "src/secret.ts", secretRisk: "known" });

function repositorySnapshot(): RepositorySnapshot {
  return {
    id: snapshotId,
    projectId: "synthetic-project",
    rootUri: "repository://synthetic-project",
    rootFingerprint: "root:synthetic-validation-fixture",
    createdAt: "2026-01-01T00:00:00.000Z",
    source: "test_fixture",
    files: [forbiddenFile, secretFile, targetFile, testFile]
      .sort((left, right) => left.normalizedPath.localeCompare(right.normalizedPath)),
    limits: { excludedPatterns: [] },
    truncation: { truncated: false, reasons: [] },
    metadata: {},
  };
}

class FixedValidationClock implements ClockPort {
  nowIso(): string { return "2026-01-01T00:00:00.000Z"; }
  monotonicMs(): number { return 0; }
}

class NeverCancelled implements InvestigationCancellationPort {
  isCancellationRequested(): boolean { return false; }
}

function budgetState(): InvestigationRunnerResult["budgetState"] {
  return {
    budget: {
      maxOperations: 10,
      maxFileReads: 10,
      maxFileBytes: 10_000,
      maxParsedFiles: 10,
      maxRelationshipHops: 5,
      maxWallTimeMs: 10_000,
      maxPlannerRounds: 5,
      maxConcurrentOperations: 1,
    },
    usage: {
      operations: 1,
      fileReads: 1,
      fileBytes: 64,
      parsedFiles: 1,
      relationshipHops: 0,
      wallTimeMs: 5,
      plannerRounds: 1,
    },
    exhausted: [],
  };
}

function entity(file: FileDescriptor, suffix = "target"): RepositoryEntity {
  return {
    id: `entity-${suffix}` as EntityId,
    snapshotId,
    kind: suffix === "test" ? "test_case" : "function",
    displayName: suffix === "test" ? "target test" : "TargetService",
    fileId: file.id,
    attributes: {},
  };
}

function groundedResult(input: {
  file?: FileDescriptor;
  findingType?: "implementation_target" | "test_target" | "supporting_context";
  stopReason?: InvestigationRunnerResult["stop"]["reason"];
  safe?: boolean;
  includeFinding?: boolean;
  evidenceRole?: "supports" | "contradicts" | "context_only";
  evidenceStrength?: "conclusive" | "substantial" | "corroborating" | "lead";
  operations?: number;
} = {}): InvestigationRunnerResult {
  const file = input.file ?? targetFile;
  const suffix = input.findingType === "test_target" ? "test" : file.id.replace("file-", "");
  const recordEntity = entity(file, suffix);
  const safe = input.safe ?? true;
  const includeFinding = input.includeFinding ?? safe;
  const evidenceId = `evidence-${suffix}` as EvidenceId;
  const findingId = `finding-${suffix}` as FindingId;
  const state = budgetState();
  state.usage.operations = input.operations ?? 1;
  const evidence: InvestigationRunnerResult["evidence"] = includeFinding ? [{
    id: evidenceId,
    snapshotId,
    role: input.evidenceRole ?? "supports",
    factIds: [],
    sourceSpans: [{
      kind: "source_span",
      snapshotId,
      fileId: file.id,
      path: file.normalizedPath,
      startLine: 1,
      startColumn: 1,
      endLine: 1,
      endColumn: 1,
      contentFingerprint: file.contentFingerprint,
    }],
    summary: "Verified synthetic evidence.",
    strength: input.evidenceStrength ?? "substantial",
    independenceGroup: `group-${suffix}`,
    freshness: { snapshotId, current: true, reason: "snapshot_match" },
    limitations: [],
  }] : [];
  const findings: InvestigationRunnerResult["findings"] = includeFinding ? [{
    id: findingId,
    snapshotId,
    type: input.findingType ?? "implementation_target",
    statement: "Verified synthetic finding.",
    entityIds: [recordEntity.id],
    evidenceIds: [evidenceId],
    status: "confirmed",
    limitations: [],
    authorizationHint: "eligible",
  }] : [];
  const stopReason = input.stopReason ?? (safe ? "sufficient_evidence" : "no_grounded_lead");
  return {
    investigationId,
    snapshotId,
    phase: "stopped",
    questions: [],
    claims: [],
    hypotheses: [],
    entities: includeFinding ? [recordEntity] : [],
    facts: [],
    evidence,
    findings,
    contradictions: [],
    knowledgeGaps: [],
    coverage: {
      criticalQuestionsTotal: 1,
      criticalQuestionsAnswered: safe ? 1 : 0,
      questionsTotal: 1,
      questionsAnswered: safe ? 1 : 0,
      hypothesesTotal: 1,
      hypothesesSupported: safe ? 1 : 0,
      hypothesesRejected: 0,
      hypothesesUnresolved: safe ? 0 : 1,
      filesConsidered: 1,
      filesRead: 1,
      filesParsed: 1,
      relationshipHops: 0,
      evidenceIndependentGroups: evidence.length,
      snapshotTruncated: false,
      blockedScopes: [],
    },
    budgetState: state,
    operationRecords: [],
    trace: [],
    stop: {
      reason: stopReason,
      message: "Synthetic stop decision.",
      blockingGapIds: [],
      contradictionIds: [],
      budgetState: structuredClone(state),
      safeToProject: safe,
    },
    safeToProject: safe,
  };
}

function validationCase(input: Partial<ContextEngineValidationCase> & Pick<ContextEngineValidationCase, "id">): ContextEngineValidationCase {
  return {
    id: input.id,
    title: input.title ?? input.id,
    projectId: input.projectId ?? "synthetic-project",
    task: input.task ?? { taskText: "Locate the verified implementation target." },
    purpose: input.purpose ?? "implementation_context",
    explicitTargets: input.explicitTargets ?? [{ kind: "path", path: targetFile.normalizedPath }],
    negativeConstraints: input.negativeConstraints ?? [],
    expectations: input.expectations ?? {
      allowedStopReasons: ["sufficient_evidence"],
      requiredImplementationTargets: [{ kind: "path", path: targetFile.normalizedPath }],
      minimumCriticalQuestionCoverage: 1,
      maximumOperations: 2,
      requireExplicitTargetPreservation: true,
      requireNegativeConstraintCompliance: true,
      expectedSafety: "safe",
      expectedOutcome: "grounded_success",
    },
    labels: input.labels ?? ["synthetic"],
    severityIfFailed: input.severityIfFailed ?? "critical",
    ...(input.budget === undefined ? {} : { budget: input.budget }),
  };
}

function manifest(cases: ContextEngineValidationCase[]): ContextEngineValidationManifest {
  return {
    schemaVersion: 1,
    manifestId: "synthetic-validation-manifest",
    title: "Synthetic CE2 offline validation",
    projects: [
      { id: "synthetic-project", title: "Synthetic project", source: { kind: "synthetic", fixtureId: "generic-small-repository" }, labels: ["sealed"] },
      { id: "unavailable-project", title: "Unavailable project", source: { kind: "local", rootKey: "missing-local-root" }, labels: ["local"] },
    ],
    cases,
  };
}

function artifactsFor(item: ContextEngineValidationCase, result: InvestigationRunnerResult): ValidationExecutionArtifacts {
  const snapshot = repositorySnapshot();
  const purpose = item.purpose === "implementation_context" ? "implementation"
    : item.purpose === "review_context" ? "review"
      : item.purpose === "clarification" ? "clarification" : "legacy_selection";
  const projection = (awaitImportProjectionService()).project({
    result,
    snapshot,
    purpose,
    explicitTargets: item.explicitTargets ?? [],
    negativeConstraints: item.negativeConstraints ?? [],
  });
  return { snapshot, investigation: result, projection, durationMs: 5, stageTimingsMs: { evaluation: 1 } };
}

// Kept behind a function so smoke fixtures exercise the public application boundary.
import { createContextProjectionService } from "../application/index.js";
import {
  createFactExtractorRegistry,
  createInMemoryKnowledgeGraphStore,
  createManifestFactExtractor,
  createTypeScriptJavaScriptFactExtractor,
  createLegacyTaskFileSelectionProjection,
} from "../adapters/index.js";
import { InMemoryRepositoryInvestigationAdapter } from "./inMemoryRepositoryInvestigationAdapter.js";
function awaitImportProjectionService() { return createContextProjectionService(); }

const baseCase = validationCase({ id: "grounded-pass" });
const baseArtifacts = artifactsFor(baseCase, groundedResult());

function artifactsWithAdditionalEditable(): ValidationExecutionArtifacts {
  const artifacts = structuredClone(baseArtifacts);
  const extraEntity = entity(testFile, "additional");
  const extraEvidence = structuredClone(artifacts.investigation.evidence[0]!);
  extraEvidence.id = "evidence-additional" as EvidenceId;
  extraEvidence.independenceGroup = "group-additional";
  extraEvidence.sourceSpans = [{
    kind: "source_span", snapshotId, fileId: testFile.id, path: testFile.normalizedPath,
    startLine: 1, startColumn: 1, endLine: 1, endColumn: 1,
    contentFingerprint: testFile.contentFingerprint,
  }];
  const extraFinding = structuredClone(artifacts.investigation.findings[0]!);
  extraFinding.id = "finding-additional" as FindingId;
  extraFinding.entityIds = [extraEntity.id];
  extraFinding.evidenceIds = [extraEvidence.id];
  artifacts.investigation.entities.push(extraEntity);
  artifacts.investigation.evidence.push(extraEvidence);
  artifacts.investigation.findings.push(extraFinding);
  const decision = structuredClone(artifacts.projection.decisions[0]!);
  decision.entityId = extraEntity.id;
  decision.path = testFile.normalizedPath;
  decision.role = "target";
  decision.included = true;
  decision.findingIds = [extraFinding.id];
  decision.evidenceIds = [extraEvidence.id];
  artifacts.projection.decisions.push(decision);
  return artifacts;
}

await scenario("versioned closed manifest validates", () => {
  assert.equal(validateContextEngineValidationManifest(manifest([baseCase])).schemaVersion, 1);
});
await scenario("synthetic fixture project loader returns a validated clone", async () => {
  const loader = createOfflineValidationProjectLoader({ syntheticFixtures: {
    "generic-small-repository": {
      status: "available", snapshot: repositorySnapshot(),
      projectFingerprint: repositorySnapshot().rootFingerprint,
    },
  } });
  const loaded = await loader.load({ project: manifest([baseCase]).projects[0]!, runtimeRoots: {} });
  assert.equal(loaded.status, "available");
  if (loaded.status === "available") assert.notEqual(loaded.snapshot, repositorySnapshot());
});
await scenario("missing local root is unavailable and privacy safe", async () => {
  const loader = createOfflineValidationProjectLoader({ syntheticFixtures: {} });
  const project = manifest([baseCase]).projects[1]!;
  const loaded = await loader.load({ project, runtimeRoots: { "missing-local-root": path.join(os.tmpdir(), "definitely-missing-ce2-project") } });
  assert.equal(loaded.status, "unavailable");
  if (loaded.status === "unavailable") assert.equal(loaded.message.includes(os.tmpdir()), false);
});
await scenario("duplicate project ids reject", () => {
  const raw = manifest([baseCase]); raw.projects.push(structuredClone(raw.projects[0]!));
  assert.throws(() => validateContextEngineValidationManifest(raw), ValidationManifestError);
});
await scenario("duplicate case ids reject", () => {
  assert.throws(() => validateContextEngineValidationManifest(manifest([baseCase, structuredClone(baseCase)])), ValidationManifestError);
});
await scenario("accessor is not executed", () => {
  let reads = 0; const raw = manifest([baseCase]);
  Object.defineProperty(raw, "title", { enumerable: true, get() { reads += 1; throw new Error("unsafe"); } });
  assert.throws(() => validateContextEngineValidationManifest(raw), ValidationManifestError);
  assert.equal(reads, 0);
});
await scenario("absolute expected path rejects", () => {
  const raw = manifest([validationCase({ id: "absolute", expectations: {
    ...baseCase.expectations, requiredImplementationTargets: [{ kind: "path", path: `${os.tmpdir()}\\secret.ts` }],
  } })]);
  assert.throws(() => validateContextEngineValidationManifest(raw), ValidationManifestError);
});
await scenario("finite percentage enforced", () => {
  const raw = manifest([validationCase({ id: "nan", expectations: { ...baseCase.expectations, minimumCriticalQuestionCoverage: Number.NaN } })]);
  assert.throws(() => validateContextEngineValidationManifest(raw), ValidationManifestError);
});

await scenario("grounded confirmed target passes", () => {
  assert.equal(evaluateValidationExpectations({ validationCase: baseCase, artifacts: baseArtifacts }).verdict, "PASS");
});
await scenario("correct safety block passes", () => {
  const item = validationCase({ id: "safety-block", explicitTargets: [], expectations: {
    allowedStopReasons: ["safety_blocked"], expectedSafety: "blocked", expectedOutcome: "safety_block",
  } });
  assert.equal(evaluateValidationExpectations({ validationCase: item, artifacts: artifactsFor(item, groundedResult({ safe: false, includeFinding: false, stopReason: "safety_blocked" })) }).verdict, "PASS");
});
await scenario("expected safe unresolved passes", () => {
  const item = validationCase({ id: "safe-unresolved", explicitTargets: [], expectations: {
    allowedStopReasons: ["no_grounded_lead"], expectedSafety: "blocked", expectedOutcome: "safe_unresolved",
  } });
  assert.equal(evaluateValidationExpectations({ validationCase: item, artifacts: artifactsFor(item, groundedResult({ safe: false, includeFinding: false })) }).verdict, "PASS");
});
await scenario("required target missing is safe fail", () => {
  const result = groundedResult({ safe: false, includeFinding: false });
  const item = validationCase({ id: "missing-required", explicitTargets: [], expectations: {
    ...baseCase.expectations, requireExplicitTargetPreservation: false,
  } });
  const evaluated = evaluateValidationExpectations({ validationCase: item, artifacts: artifactsFor(item, result) });
  assert.equal(evaluated.verdict, "SAFE_FAIL");
});
await scenario("wrong editable target is critical", () => {
  const item = validationCase({ id: "wrong", explicitTargets: [{ kind: "path", path: forbiddenFile.normalizedPath }], expectations: {
    ...baseCase.expectations,
    requireExplicitTargetPreservation: false,
    forbiddenEditableTargets: [{ kind: "path", path: forbiddenFile.normalizedPath }],
  } });
  const evaluated = evaluateValidationExpectations({ validationCase: item, artifacts: artifactsFor(item, groundedResult({ file: forbiddenFile })) });
  assert.equal(evaluated.verdict, "CRITICAL_FAIL");
});
await scenario("required target plus unexpected editable is critical", () => {
  const evaluated = evaluateValidationExpectations({
    validationCase: baseCase,
    artifacts: artifactsWithAdditionalEditable(),
  });
  assert.equal(evaluated.verdict, "CRITICAL_FAIL");
  assert.equal(evaluated.metrics.projection.unexpectedEditablePaths, 1);
  assert.ok(evaluated.failures.some((failure) => failure.code === "unexpected_editable_target"));
});
await scenario("declared additional editable remains allowed", () => {
  const item = validationCase({ id: "allowed-additional", expectations: {
    ...baseCase.expectations,
    allowedAdditionalEditableTargets: [{ kind: "path", path: testFile.normalizedPath }],
  } });
  assert.equal(evaluateValidationExpectations({
    validationCase: item,
    artifacts: artifactsWithAdditionalEditable(),
  }).verdict, "PASS");
});
await scenario("forbidden matcher remains a hard failure", () => {
  const item = validationCase({ id: "forbidden-additional", expectations: {
    ...baseCase.expectations,
    allowedAdditionalEditableTargets: [{ kind: "path", path: testFile.normalizedPath }],
    forbiddenEditableTargets: [{ kind: "path", path: testFile.normalizedPath }],
  } });
  assert.equal(evaluateValidationExpectations({
    validationCase: item,
    artifacts: artifactsWithAdditionalEditable(),
  }).verdict, "CRITICAL_FAIL");
});
await scenario("negative constraint violation is critical", () => {
  const forged = structuredClone(baseArtifacts);
  forged.projection.decisions[0]!.path = "src/private/target.ts";
  forged.projection.decisions[0]!.included = true;
  forged.projection.decisions[0]!.role = "target";
  const item = validationCase({ id: "negative", negativeConstraints: [{ kind: "path", pattern: "src/private/*" }] });
  assert.equal(evaluateValidationExpectations({ validationCase: item, artifacts: forged }).verdict, "CRITICAL_FAIL");
});
await scenario("secret target is critical", () => {
  const forged = structuredClone(baseArtifacts);
  forged.projection.decisions[0]!.path = secretFile.normalizedPath;
  assert.equal(evaluateValidationExpectations({ validationCase: baseCase, artifacts: forged }).verdict, "CRITICAL_FAIL");
});
await scenario("unsupported confirmed finding is critical", () => {
  const forged = structuredClone(baseArtifacts);
  forged.investigation.evidence = [];
  assert.equal(evaluateValidationExpectations({ validationCase: baseCase, artifacts: forged }).verdict, "CRITICAL_FAIL");
});
await scenario("explicit target silently dropped is critical", () => {
  const forged = structuredClone(baseArtifacts);
  forged.projection.diagnostics = forged.projection.diagnostics.filter((record) => record.code !== "explicit_target_eligible");
  assert.equal(evaluateValidationExpectations({ validationCase: baseCase, artifacts: forged }).verdict, "CRITICAL_FAIL");
});
await scenario("expected clarification passes", () => {
  const item = validationCase({ id: "clarification", explicitTargets: [], expectations: {
    allowedStopReasons: ["clarification_required"], expectedSafety: "blocked", expectedOutcome: "clarification",
  } });
  assert.equal(evaluateValidationExpectations({ validationCase: item, artifacts: artifactsFor(item, groundedResult({ safe: false, includeFinding: false, stopReason: "clarification_required" })) }).verdict, "PASS");
});
await scenario("unnecessary clarification safely fails", () => {
  const item = validationCase({ id: "unnecessary-clarification", explicitTargets: [], expectations: {
    ...baseCase.expectations, requireExplicitTargetPreservation: false,
  } });
  const evaluated = evaluateValidationExpectations({ validationCase: item, artifacts: artifactsFor(item, groundedResult({ safe: false, includeFinding: false, stopReason: "clarification_required" })) });
  assert.equal(evaluated.verdict, "SAFE_FAIL");
});
await scenario("valid test target passes", () => {
  const item = validationCase({ id: "test", explicitTargets: [{ kind: "path", path: testFile.normalizedPath }], expectations: {
    allowedStopReasons: ["sufficient_evidence"], requiredTests: [{ kind: "path", path: testFile.normalizedPath }],
    requireExplicitTargetPreservation: true, expectedSafety: "safe", expectedOutcome: "grounded_success",
  } });
  assert.equal(evaluateValidationExpectations({ validationCase: item, artifacts: artifactsFor(item, groundedResult({ file: testFile, findingType: "test_target" })) }).verdict, "PASS");
});
await scenario("test projected as support fails expectation", () => {
  const item = validationCase({ id: "test-support", explicitTargets: [{ kind: "path", path: testFile.normalizedPath }], expectations: {
    allowedStopReasons: ["sufficient_evidence"], requiredTests: [{ kind: "path", path: testFile.normalizedPath }],
    expectedSafety: "safe", expectedOutcome: "grounded_success",
  } });
  assert.equal(evaluateValidationExpectations({ validationCase: item, artifacts: artifactsFor(item, groundedResult({ file: testFile, findingType: "supporting_context" })) }).verdict, "SAFE_FAIL");
});
await scenario("missing supporting context is acceptable", () => {
  const item = validationCase({ id: "support-missing", expectations: { ...baseCase.expectations, requiredSupporting: [{ kind: "path", path: "src/support.ts" }] } });
  assert.equal(evaluateValidationExpectations({ validationCase: item, artifacts: baseArtifacts }).verdict, "ACCEPTABLE");
});
await scenario("operation ceiling violation is safe fail", () => {
  const item = validationCase({ id: "budget", expectations: { ...baseCase.expectations, maximumOperations: 0 } });
  assert.equal(evaluateValidationExpectations({ validationCase: item, artifacts: artifactsFor(item, groundedResult({ operations: 4 })) }).verdict, "SAFE_FAIL");
});
await scenario("expected budget exhaustion passes", () => {
  const item = validationCase({ id: "expected-budget", explicitTargets: [], expectations: {
    allowedStopReasons: ["operation_budget_exhausted"], expectedSafety: "blocked", expectedOutcome: "budget_exhausted",
  } });
  assert.equal(evaluateValidationExpectations({ validationCase: item, artifacts: artifactsFor(item, groundedResult({ safe: false, includeFinding: false, stopReason: "operation_budget_exhausted" })) }).verdict, "PASS");
});
await scenario("mixed snapshot is critical", () => {
  const forged = structuredClone(baseArtifacts);
  forged.investigation.entities[0]!.snapshotId = "snapshot-other" as SnapshotId;
  assert.equal(evaluateValidationExpectations({ validationCase: baseCase, artifacts: forged }).verdict, "CRITICAL_FAIL");
});

const golden = createGoldenTraceSummary({ caseId: baseCase.id, artifacts: baseArtifacts });
await scenario("deterministic repeated traces equivalent", () => {
  assert.equal(compareDeterministicReplays([golden, structuredClone(golden)]).equivalent, true);
});
await scenario("golden ignores runtime timestamp and duration", () => {
  const changed = structuredClone(baseArtifacts);
  changed.durationMs = 99_999;
  changed.investigation.stop.message = "Different safe runtime message.";
  assert.equal(compareGoldenTraces(golden, createGoldenTraceSummary({ caseId: baseCase.id, artifacts: changed })).equivalent, true);
});
await scenario("golden semantic drift fails", () => {
  const changed = structuredClone(golden); changed.stopReason = "clarification_required";
  assert.deepEqual(compareGoldenTraces(golden, changed), { equivalent: false, changedFields: ["stopReason"] });
});
await scenario("generated golden uses a canonical snapshot hash", () => {
  assert.match(golden.snapshotFingerprint, /^snapshot-sha256:[0-9a-f]{64}$/u);
  assert.equal(golden.snapshotFingerprint.includes(repositorySnapshot().rootFingerprint), false);
});
await scenario("golden rejects raw Windows fingerprint paths", () => {
  const malformed = structuredClone(golden);
  malformed.snapshotFingerprint = "C:\\Users\\alice\\private-source.ts";
  assert.throws(() => validateGoldenTraceSummary(malformed), GoldenTraceError);
});
await scenario("golden rejects raw Unix fingerprint paths", () => {
  const malformed = structuredClone(golden);
  malformed.snapshotFingerprint = "/home/alice/private-source.ts";
  assert.throws(() => validateGoldenTraceSummary(malformed), GoldenTraceError);
});
await scenario("golden rejects file URI fingerprints", () => {
  const malformed = structuredClone(golden);
  malformed.snapshotFingerprint = "file:///private/source.ts";
  assert.throws(() => validateGoldenTraceSummary(malformed), GoldenTraceError);
});
await scenario("golden rejects malformed snapshot hashes", () => {
  const malformed = structuredClone(golden);
  malformed.snapshotFingerprint = "snapshot-sha256:not-a-hash";
  assert.throws(() => validateGoldenTraceSummary(malformed), GoldenTraceError);
});
await scenario("golden rejects token-like snapshot fingerprints", () => {
  const malformed = structuredClone(golden);
  malformed.snapshotFingerprint = "sk-live-fixture-secret-token";
  assert.throws(() => validateGoldenTraceSummary(malformed), GoldenTraceError);
});
await scenario("golden update without reason rejects", async () => {
  const store: GoldenStore = { read: async () => null, write: async () => undefined };
  await assert.rejects(() => applyGoldenMode({ store, caseId: baseCase.id, summary: golden, mode: "update_golden" }), GoldenTraceError);
});
await scenario("golden update records explicit reason", async () => {
  let reason = "";
  const store: GoldenStore = { read: async () => null, write: async (_id, _summary, value) => { reason = value; } };
  await applyGoldenMode({ store, caseId: baseCase.id, summary: golden, mode: "update_golden", reason: "reviewed semantic change" });
  assert.equal(reason, "reviewed semantic change");
});
await scenario("golden nested sourceContent field is rejected", () => {
  const malformed = structuredClone(golden) as GoldenTraceSummary & { findings: Array<Record<string, unknown>> };
  malformed.findings[0]!.sourceContent = "FIXTURE_SOURCE_CONTENT_MARKER";
  assert.throws(() => validateGoldenTraceSummary(malformed), GoldenTraceError);
});
await scenario("golden nested accessor is rejected without execution", () => {
  let reads = 0;
  const malformed = structuredClone(golden);
  Object.defineProperty(malformed.findings[0]!, "status", {
    enumerable: true,
    get() { reads += 1; throw new Error("FIXTURE_SOURCE_CONTENT_MARKER"); },
  });
  assert.throws(() => validateGoldenTraceSummary(malformed), GoldenTraceError);
  assert.equal(reads, 0);
});
await scenario("file golden store writes validated clone only", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ce2-golden-store-"));
  try {
    const store = createFileGoldenStore(directory);
    await store.write(baseCase.id, golden, "reviewed deterministic baseline");
    const written = await fs.readFile(path.join(directory, `${baseCase.id}.json`), "utf8");
    assert.deepEqual(JSON.parse(written), validateGoldenTraceSummary(golden));
    assert.equal(written.includes("FIXTURE_SOURCE_CONTENT_MARKER"), false);
    assert.equal(written.includes(repositorySnapshot().rootFingerprint), false);
    assert.equal(written.includes("C:\\Users\\alice"), false);
    assert.equal(written.includes("/home/alice"), false);
    assert.equal(written.includes("sk-live-fixture-secret"), false);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
await scenario("unsafe golden update reason is rejected", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ce2-golden-reason-"));
  try {
    const store = createFileGoldenStore(directory);
    await assert.rejects(() => store.write(baseCase.id, golden, "Bearer fixture-secret-token"));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

async function assertRejectedGoldenReason(reason: string): Promise<void> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ce2-golden-private-reason-"));
  try {
    const store = createFileGoldenStore(directory);
    await assert.rejects(() => store.write(baseCase.id, golden, reason));
    assert.deepEqual(await fs.readdir(directory), []);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

await scenario("review reason rejects opt absolute path", () =>
  assertRejectedGoldenReason("/opt/contextforge/private/repo"));
await scenario("review reason rejects etc absolute path", () =>
  assertRejectedGoldenReason("/etc/contextforge/secret"));
await scenario("review reason rejects srv absolute path", () =>
  assertRejectedGoldenReason("/srv/project/root"));
await scenario("review reason rejects mnt absolute path", () =>
  assertRejectedGoldenReason("/mnt/data/private"));
await scenario("review reason rejects private absolute path", () =>
  assertRejectedGoldenReason("/private/var/project"));
await scenario("review reason rejects Windows drive paths", async () => {
  await assertRejectedGoldenReason("C:\\Users\\fixture\\project");
  await assertRejectedGoldenReason("C:/Users/fixture/project");
});
await scenario("review reason rejects UNC paths", () =>
  assertRejectedGoldenReason("\\\\server\\share\\project"));
await scenario("review reason rejects file URI", () =>
  assertRejectedGoldenReason("file:///private/project"));
await scenario("review reason accepts ordinary operation words and stores trimmed metadata", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ce2-golden-safe-reason-"));
  try {
    const store = createFileGoldenStore(directory);
    await store.write(baseCase.id, golden, "  search/read/parse reviewed baseline regression  ");
    const review = JSON.parse(await fs.readFile(
      path.join(directory, `${baseCase.id}.review.json`),
      "utf8",
    )) as { reason: string };
    assert.equal(review.reason, "search/read/parse reviewed baseline regression");
    assert.deepEqual(
      (await fs.readdir(directory)).sort(),
      [`${baseCase.id}.json`, `${baseCase.id}.review.json`],
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

const realSnapshotId = "snapshot-real-validation" as SnapshotId;
const realContent = 'export function handleRequest() { return "ok"; }';
const realFile: FileDescriptor = {
  id: "file-real-service" as EntityId,
  snapshotId: realSnapshotId,
  path: "src/service.ts",
  normalizedPath: "src/service.ts",
  extension: ".ts",
  language: "typescript",
  kind: "source",
  sizeBytes: new TextEncoder().encode(realContent).byteLength,
  contentFingerprint: "content-real-service-v1",
  readable: true,
  generated: false,
  secretRisk: "none",
  attributes: {},
};
const realSnapshot: RepositorySnapshot = {
  id: realSnapshotId,
  projectId: "real-engine-project",
  rootUri: "repository://real-engine-project",
  rootFingerprint: "root:real-engine-project-v1",
  createdAt: "2026-01-01T00:00:00.000Z",
  source: "test_fixture",
  files: [realFile],
  limits: { excludedPatterns: [] },
  truncation: { truncated: false, reasons: [] },
  metadata: {},
};
const realGroundedCase: ContextEngineValidationCase = {
  id: "real-grounded-target",
  title: "Real engine grounded target",
  projectId: "real-engine-project",
  task: { taskText: "Update handleRequest in src/service.ts" },
  purpose: "implementation_context",
  budget: {
    maxOperations: 30, maxFileReads: 10, maxFileBytes: 100_000, maxParsedFiles: 10,
    maxRelationshipHops: 8, maxWallTimeMs: 10_000, maxPlannerRounds: 20,
    maxConcurrentOperations: 1,
  },
  explicitTargets: [{ kind: "symbol", symbol: "handleRequest" }],
  negativeConstraints: [],
  expectations: {
    allowedStopReasons: ["sufficient_evidence"],
    requiredImplementationTargets: [{ kind: "path", path: "src/service.ts" }],
    requiredPredicates: ["contains"],
    minimumCriticalQuestionCoverage: 1,
    requireExplicitTargetPreservation: true,
    requireNegativeConstraintCompliance: true,
    expectedSafety: "safe",
    expectedOutcome: "grounded_success",
  },
  labels: ["real_engine", "sealed", "synthetic"],
  severityIfFailed: "critical",
};
const realSafeCase: ContextEngineValidationCase = {
  ...structuredClone(realGroundedCase),
  id: "real-safe-block",
  title: "Real engine safe block",
  task: { taskText: "Update src/service.ts without reading the excluded file" },
  explicitTargets: [{ kind: "path", path: "src/service.ts" }],
  negativeConstraints: [{ kind: "path", pattern: "src/service.ts" }],
  expectations: {
    allowedStopReasons: ["safety_blocked", "no_grounded_lead", "clarification_required"],
    forbiddenEditableTargets: [{ kind: "path", path: "src/service.ts" }],
    requireNegativeConstraintCompliance: true,
    expectedSafety: "blocked",
    expectedOutcome: "safe_unresolved",
  },
};
const realManifest: ContextEngineValidationManifest = {
  schemaVersion: 1,
  manifestId: "real-engine-synthetic-baseline",
  title: "Real CE2 synthetic baseline",
  projects: [{
    id: "real-engine-project",
    title: "Real engine fixture",
    source: { kind: "synthetic", fixtureId: "real-engine-repository" },
    labels: ["sealed", "synthetic"],
  }],
  cases: [realGroundedCase, realSafeCase],
};
const realClock = new FixedValidationClock();
const realRepository = new InMemoryRepositoryInvestigationAdapter(realSnapshot, [{
  fileId: realFile.id,
  path: realFile.normalizedPath,
  content: realContent,
  contentFingerprint: realFile.contentFingerprint,
}]);
const realExecutor = createDeterministicValidationInvestigationExecutor({
  clock: realClock,
  cancellation: new NeverCancelled(),
  repositoryReader: realRepository,
  repositorySearch: realRepository,
  factExtractor: createFactExtractorRegistry([
    createManifestFactExtractor(realClock),
    createTypeScriptJavaScriptFactExtractor(realClock),
  ]),
  graphStore: createInMemoryKnowledgeGraphStore(),
});
await scenario("factory-created validation executor is frozen and trusted", () => {
  assert.equal(Object.isFrozen(realExecutor), true);
  assert.equal(isTrustedDeterministicValidationExecutor(realExecutor), true);
});
await scenario("trusted executor execute method cannot be replaced", () => {
  const original = realExecutor.execute;
  const replaced = Reflect.set(realExecutor, "execute", async () => ({
    result: groundedResult(),
  }));
  assert.equal(replaced, false);
  assert.equal(realExecutor.execute, original);
});
await scenario("trusted executor marker cannot be replaced", () => {
  const replaced = Reflect.set(realExecutor, "executionMarker", "fixture_result");
  assert.equal(replaced, false);
  assert.equal(realExecutor.executionMarker, "real_engine");
});
await scenario("spread and proxy executor wrappers do not inherit trust", () => {
  assert.equal(isTrustedDeterministicValidationExecutor({ ...realExecutor }), false);
  assert.equal(isTrustedDeterministicValidationExecutor(new Proxy(realExecutor, {})), false);
});
const realRunner = createContextEngineValidationRunner({
  projectLoader: createOfflineValidationProjectLoader({
    syntheticFixtures: {
      "real-engine-repository": {
        status: "available",
        snapshot: realSnapshot,
        projectFingerprint: realSnapshot.rootFingerprint,
        verifyUnchanged: () => true,
      },
    },
  }),
  executor: realExecutor,
});
const realBaselineReport = await realRunner.run(realManifest, { repeatCount: 2 });

await scenario("real engine grounded case reaches PASS", () => {
  const result = realBaselineReport.cases.find((row) => row.caseId === realGroundedCase.id);
  assert.equal(result?.executionMarker, "real_engine");
  assert.equal(result?.verdict, "PASS");
  assert.ok(result?.trace?.operations.some((operation) => operation.type.startsWith("search_")));
  assert.ok(result?.trace?.operations.some((operation) => operation.type === "read_file"));
  assert.ok(result?.trace?.operations.some((operation) => operation.type === "parse_file"));
});
await scenario("real engine safe case reaches PASS without editable target", () => {
  const result = realBaselineReport.cases.find((row) => row.caseId === realSafeCase.id);
  assert.equal(result?.executionMarker, "real_engine");
  assert.equal(result?.verdict, "PASS");
  assert.equal(result?.trace?.projected.some((entry) => entry.role === "target" || entry.role === "test"), false);
});
await scenario("real clean baseline contains only real-engine cases", () => {
  assert.equal(realBaselineReport.cases.every((row) => row.executionMarker === "real_engine"), true);
  assert.equal(realBaselineReport.metrics.verdicts.PASS, 2);
  assert.equal(realBaselineReport.metrics.baselineVerdicts.PASS, 2);
  assert.equal(realBaselineReport.metrics.realEngineCaseCount, 2);
  assert.equal(realBaselineReport.metrics.fixtureCaseCount, 0);
  assert.equal(realBaselineReport.metrics.baselineEligible, true);
  assert.equal(realBaselineReport.gate.passed, true);
});
await scenario("real-engine golden repeats are deterministic", () => {
  assert.equal(realBaselineReport.metrics.deterministicReplayEquivalence, 1);
});

const realCriticalCase: ContextEngineValidationCase = {
  ...structuredClone(realGroundedCase),
  id: "real-critical-target",
  title: "Real engine critical target violation",
  expectations: {
    ...structuredClone(realGroundedCase.expectations),
    forbiddenEditableTargets: [{ kind: "path", path: realFile.normalizedPath }],
  },
};
const realCriticalReport = await realRunner.run({
  ...structuredClone(realManifest),
  manifestId: "real-engine-critical-baseline",
  cases: [realCriticalCase],
});
await scenario("real critical failure blocks the trusted baseline gate", () => {
  assert.equal(realCriticalReport.cases[0]?.executionMarker, "real_engine");
  assert.equal(realCriticalReport.cases[0]?.verdict, "CRITICAL_FAIL");
  assert.equal(realCriticalReport.metrics.realEngineCaseCount, 1);
  assert.equal(realCriticalReport.metrics.baselineVerdicts.CRITICAL_FAIL, 1);
  assert.equal(realCriticalReport.gate.passed, false);
  assert.ok(realCriticalReport.gate.blockingReasons.includes("critical_validation_failure"));
});
await scenario("fail-on-critical applies to trusted engine failures", async () => {
  await assert.rejects(
    () => realRunner.run({
      ...structuredClone(realManifest),
      manifestId: "real-engine-critical-command-gate",
      cases: [realCriticalCase],
    }, { failOnCritical: true }),
    (error) => error instanceof ValidationRunGateError &&
      error.report.cases[0]?.executionMarker === "real_engine" &&
      error.report.cases[0]?.verdict === "CRITICAL_FAIL",
  );
});
await scenario("aggregate percentage cannot hide a real critical failure", () => {
  const metrics = structuredClone(realCriticalReport.metrics);
  metrics.acceptableOrBetterPercentage = 100;
  assert.equal(evaluateValidationGate(metrics).passed, false);
});

const runnerManifest = manifest([
  baseCase,
  validationCase({ id: "safe-run", explicitTargets: [], expectations: {
    allowedStopReasons: ["no_grounded_lead"], expectedSafety: "blocked", expectedOutcome: "safe_unresolved",
  } }),
  validationCase({ id: "engine-error" }),
  validationCase({ id: "unsafe-error-code" }),
  validationCase({ id: "unknown-stage-timing" }),
  validationCase({ id: "negative-duration" }),
  validationCase({ id: "nan-duration" }),
  validationCase({ id: "not-run", projectId: "unavailable-project" }),
]);
const legacySelection = createLegacyTaskFileSelectionProjection().project(
  createContextProjectionService().project({
    result: groundedResult(), snapshot: repositorySnapshot(), purpose: "legacy_selection",
    explicitTargets: [{ kind: "path", path: targetFile.normalizedPath }], negativeConstraints: [],
  }),
  repositorySnapshot(),
  { effectiveTaskArea: "general", requestedTaskType: "implementation", negativeConstraints: [] },
).selection;
const runner = createContextEngineValidationRunner({
  projectLoader: {
    async load({ project }) {
      return project.source.kind === "local"
        ? { status: "unavailable", reasonCode: "project_unavailable", message: "Local source unavailable." }
        : { status: "available", snapshot: repositorySnapshot(), projectFingerprint: "root:synthetic-validation-fixture", verifyUnchanged: () => true };
    },
  },
  executor: {
    executionMarker: "real_engine",
    async execute({ validationCase: item }) {
      if (item.id === "engine-error") throw new Error("synthetic exception");
      if (item.id === "unsafe-error-code") {
        throw Object.assign(new Error("FIXTURE_SOURCE_CONTENT_MARKER"), {
          code: "FIXTURE_SOURCE_CONTENT_MARKER:C:\\Users\\fixture\\secret.ts",
        });
      }
      if (item.id === "unknown-stage-timing") return {
        result: groundedResult(),
        stageTimingsMs: { sourceContent: 1 } as never,
      };
      if (item.id === "negative-duration") return { result: groundedResult(), durationMs: -1 };
      if (item.id === "nan-duration") return { result: groundedResult(), durationMs: Number.NaN };
      return {
        result: item.id === "safe-run" ? groundedResult({ safe: false, includeFinding: false }) : groundedResult(),
        ...(item.id === baseCase.id ? { legacySelection } : {}),
        durationMs: 7,
      };
    },
  },
});
const report = await runner.run(runnerManifest, { repeatCount: 2 });
await scenario("runner golden update requires reason", async () => {
  const store: GoldenStore = { read: async () => null, write: async () => undefined };
  await assert.rejects(() => runner.run(manifest([baseCase]), { mode: "update_golden", goldenStore: store }));
});
await scenario("runner accepts explicit golden update reason", async () => {
  let writes = 0;
  const store: GoldenStore = { read: async () => null, write: async () => { writes += 1; } };
  await runner.run(manifest([baseCase]), {
    mode: "update_golden", updateReason: "reviewed baseline", goldenStore: store,
  });
  assert.equal(writes, 1);
});
await scenario("offline runner emits pass", () => assert.equal(report.cases.find((row) => row.caseId === baseCase.id)?.verdict, "PASS"));
await scenario("legacy comparison preserves exact target overlap", () => {
  const comparison = report.cases.find((row) => row.caseId === baseCase.id)?.compatibility;
  assert.deepEqual(comparison?.overlap.exactTargetPaths, [targetFile.normalizedPath]);
  assert.equal(comparison?.outcome, "insufficient_evaluation_data");
});
await scenario("unavailable project is not run", () => assert.equal(report.cases.find((row) => row.caseId === "not-run")?.verdict, "NOT_RUN"));
await scenario("engine exception is engine error", () => assert.equal(report.cases.find((row) => row.caseId === "engine-error")?.verdict, "ENGINE_ERROR"));
await scenario("arbitrary executor error code is normalized", () => {
  assert.equal(report.cases.find((row) => row.caseId === "unsafe-error-code")?.errorCode, "unexpected_execution_failure");
});
await scenario("arbitrary executor code is absent from reports", () => {
  const exported = `${serializeValidationReportJson(report)}\n${renderValidationReportMarkdown(report)}`;
  assert.equal(exported.includes("FIXTURE_SOURCE_CONTENT_MARKER"), false);
  assert.equal(exported.includes("C:\\Users\\fixture"), false);
});
await scenario("unknown stage timing key is rejected safely", () => {
  assert.equal(report.cases.find((row) => row.caseId === "unknown-stage-timing")?.verdict, "ENGINE_ERROR");
});
await scenario("negative and NaN durations are rejected safely", () => {
  assert.equal(report.cases.find((row) => row.caseId === "negative-duration")?.verdict, "ENGINE_ERROR");
  assert.equal(report.cases.find((row) => row.caseId === "nan-duration")?.verdict, "ENGINE_ERROR");
});
await scenario("fixture engine errors remain visible without becoming engine gate failures", async () => {
  const fixtureErrorReport = await runner.run(runnerManifest, { failOnEngineError: true });
  assert.ok(fixtureErrorReport.cases.some((row) => row.verdict === "ENGINE_ERROR"));
  assert.equal(fixtureErrorReport.metrics.baselineVerdicts.ENGINE_ERROR, 0);
  assert.deepEqual(fixtureErrorReport.gate.blockingReasons, ["no_real_engine_baseline_cases"]);
});
await scenario("fixture critical remains visible without becoming engine quality", async () => {
  const criticalCase = validationCase({ id: "critical-run", expectations: {
    ...baseCase.expectations,
    forbiddenEditableTargets: [{ kind: "path", path: targetFile.normalizedPath }],
  } });
  const fixtureCriticalReport = await runner.run(manifest([criticalCase]), { failOnCritical: true });
  assert.equal(fixtureCriticalReport.cases[0]?.verdict, "CRITICAL_FAIL");
  assert.equal(fixtureCriticalReport.cases[0]?.executionMarker, "fixture_result");
  assert.equal(fixtureCriticalReport.metrics.verdicts.CRITICAL_FAIL, 1);
  assert.equal(fixtureCriticalReport.metrics.baselineVerdicts.CRITICAL_FAIL, 0);
  assert.equal(fixtureCriticalReport.metrics.realEngineCaseCount, 0);
  assert.deepEqual(fixtureCriticalReport.gate.blockingReasons, ["no_real_engine_baseline_cases"]);
});
await scenario("report is frozen", () => assert.equal(Object.isFrozen(report), true));
await scenario("JSON report stable", () => assert.equal(serializeValidationReportJson(report), serializeValidationReportJson(report)));
await scenario("Markdown report stable", () => assert.equal(renderValidationReportMarkdown(report), renderValidationReportMarkdown(report)));
await scenario("JSON and Markdown report files are generated", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ce2-validation-report-"));
  try {
    const written = await writeValidationReport(report, directory);
    assert.equal(path.basename(written.jsonPath), "results.json");
    assert.equal(path.basename(written.markdownPath), "report.md");
    assert.equal((await fs.readFile(written.jsonPath, "utf8")).includes('"schemaVersion": 1'), true);
    assert.equal((await fs.readFile(written.markdownPath, "utf8")).startsWith("# Context Engine v2"), true);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
await scenario("export excludes absolute root and source marker", () => {
  const exported = `${serializeValidationReportJson(report)}\n${renderValidationReportMarkdown(report)}`;
  assert.equal(exported.includes(os.tmpdir()), false);
  assert.equal(exported.includes("FIXTURE_SOURCE_CONTENT_MARKER"), false);
  assert.equal(exported.includes("sk-live-fixture-secret"), false);
});
await scenario("report getter rejected without execution", () => {
  let reads = 0; const raw = structuredClone(report) as typeof report;
  Object.defineProperty(raw, "cases", { enumerable: true, get() { reads += 1; throw new Error("secret"); } });
  assert.throws(() => validateContextEngineValidationReport(raw));
  assert.equal(reads, 0);
});
await scenario("malformed nested report record is rejected", () => {
  const raw = structuredClone(report) as typeof report & { projects: Array<Record<string, unknown>> };
  raw.projects[0]!.sourceContent = "FIXTURE_SOURCE_CONTENT_MARKER";
  assert.throws(() => validateContextEngineValidationReport(raw), ValidationReportError);
});
await scenario("nested report accessor is rejected without execution", () => {
  let reads = 0;
  const raw = structuredClone(report);
  Object.defineProperty(raw.projects[0]!, "available", {
    enumerable: true,
    get() { reads += 1; throw new Error("fixture-secret-token"); },
  });
  assert.throws(() => validateContextEngineValidationReport(raw), ValidationReportError);
  assert.equal(reads, 0);
});

await scenario("legacy translation preserves exclusions", () => {
  const translated = translateLegacyValidationCase({ legacyCase: {
    id: "legacy-case", task: "Update explicit target", projectId: "synthetic-project",
    expected: { forbiddenEdit: ["src/private.ts"], explicitTargets: [{ kind: "path", path: "src/target.ts" }] },
  }, defaultProjectId: "synthetic-project" });
  assert.deepEqual(translated.validationCase.expectations.forbiddenEditableTargets, [{ kind: "path", path: "src/private.ts" }]);
});
await scenario("unsupported translated fields become notes", () => {
  const translated = translateLegacyValidationCase({ legacyCase: {
    id: "legacy-notes", task: "Review target", expected: { customScore: 0.9 },
  }, defaultProjectId: "synthetic-project" });
  assert.ok(translated.compatibilityNotes.some((note) => note.includes("customScore")));
});
await scenario("input case permutation is stable", async () => {
  const reversed = structuredClone(runnerManifest); reversed.cases.reverse();
  const second = await runner.run(reversed, { repeatCount: 2 });
  assert.deepEqual(second.cases.map((row) => row.caseId), report.cases.map((row) => row.caseId));
});
await scenario("no expert basis keeps comparison unevaluated", () => {
  assert.equal(report.cases.every((row) => row.compatibility === undefined || row.compatibility.outcome === "insufficient_evaluation_data"), true);
});
await scenario("fixture-result unit cases remain explicitly marked", async () => {
  const fixtureUnitReport = await runner.run(manifest([
    baseCase,
    validationCase({ id: "safe-run", explicitTargets: [], expectations: {
      allowedStopReasons: ["no_grounded_lead"], expectedSafety: "blocked", expectedOutcome: "safe_unresolved",
    } }),
  ]), { repeatCount: 2 });
  assert.equal(fixtureUnitReport.cases.every((row) => row.executionMarker === "fixture_result"), true);
  assert.equal(fixtureUnitReport.metrics.verdicts.PASS, 2);
  assert.equal(fixtureUnitReport.metrics.baselineVerdicts.PASS, 0);
  assert.equal(fixtureUnitReport.metrics.realEngineCaseCount, 0);
  assert.equal(fixtureUnitReport.metrics.fixtureCaseCount, 2);
  assert.equal(fixtureUnitReport.metrics.baselineEligible, false);
  assert.equal(fixtureUnitReport.gate.passed, false);
  assert.ok(fixtureUnitReport.gate.blockingReasons.includes("no_real_engine_baseline_cases"));
});
await scenario("caller-controlled real-engine marker is not trusted", () => {
  assert.equal(report.cases.every((row) => row.executionMarker === "fixture_result"), true);
  assert.equal(report.metrics.realEngineCaseCount, 0);
  assert.equal(report.metrics.fixtureCaseCount, report.cases.length);
  assert.equal(report.metrics.baselineEligible, false);
});
await scenario("production selector and Task Pack routes are not invoked", () => {
  assert.equal(report.run.mode, "verify");
  assert.equal(report.redaction.sourceContentExcluded, true);
});

console.log(`Context Engine v2 validation smoke passed: ${scenarios} scenarios.`);
