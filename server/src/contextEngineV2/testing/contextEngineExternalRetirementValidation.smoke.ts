import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  deriveExternalRetirementExecutionInput,
  hashNormalizedExternalRetirementManifestBytes,
  parseExternalRetirementManifestBytes,
  runExternalRetirementValidation,
  runExternalRetirementValidationFile,
} from "../../commands/contextEngineExternalRetirementHarness.js";
import {
  formatExternalRetirementValidationCliSummary,
  runExternalRetirementValidationCli,
} from "../../commands/contextEngineExternalRetirementValidation.js";
import { buildDeterministicTaskIntentFallback } from "../../ollama/taskIntentAnalyzer.js";
import { scanProjectInventory, type ProjectInventory } from "../../scanner/projectInventoryScanner.js";
import { groundTaskCurrentState } from "../../taskPacks/taskCurrentStateGrounding.js";
import { TASK_PACK_CANARY_PREPARATION_LIMITS } from "../canary/index.js";
import {
  createContextEngineShadowExecutionTracker,
} from "../shadow/index.js";
import {
  createTaskPackPrimaryService,
  type TaskPackPrimaryRuntimeDependencies,
} from "../retirement/index.js";
import {
  createExternalObservationReport,
  createExternalRetirementReport,
  serializeExternalObservationReportJson,
  validateExternalRetirementManifest,
  validateExternalObservationReport,
  type ExternalObservationValidationReport,
} from "../validation/index.js";

let scenarios = 0;
async function scenario(name: string, run: () => void | Promise<void>): Promise<void> {
  await run();
  assert.ok(name.length > 0);
  scenarios += 1;
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), "context-engine-external-validation-"));
await fs.mkdir(path.join(root, "src"), { recursive: true });
const serviceSource = "export function handleRequest() { return 'grounded-marker'; }\n";
const entrySource = "import { handleRequest } from './service';\nexport const result = handleRequest();\n";
await fs.writeFile(path.join(root, "src", "service.ts"), serviceSource, "utf8");
await fs.writeFile(path.join(root, "src", "entry.ts"), entrySource, "utf8");

const groundedCase = {
  id: "grounded-service",
  title: "Grounded service update",
  repositoryShape: "service",
  task: "Update handleRequest in src/service.ts",
  requestedTaskType: "backend",
  expectations: {
    expectedOutcome: "grounded_selection",
    allowedStatuses: ["v2_applied"],
    requiredPaths: ["src/service.ts"],
    forbiddenPaths: [],
    ambiguityExpected: false,
    expectedRollbackReason: null,
  },
} as const;
const safeCase = {
  id: "safe-unknown-owner",
  title: "Unknown owner remains safe",
  repositoryShape: "no-grounded-target",
  task: "Update unknownMissingOwner",
  requestedTaskType: "backend",
  expectations: {
    expectedOutcome: "safe_no_selection",
    allowedStatuses: ["v2_no_selection", "clarification_required", "review_required", "safe_fail"],
    requiredPaths: [],
    forbiddenPaths: ["src/service.ts"],
    ambiguityExpected: false,
    expectedRollbackReason: null,
  },
} as const;
const manifest = {
  schemaVersion: 1,
  manifestId: "external-smoke",
  title: "External validation smoke",
  candidateFallbackRateThreshold: 0.05,
  projects: [{ id: "generic-project", rootPath: root, cases: [groundedCase, safeCase] }],
} as const;

await scenario("valid external manifest is accepted", () => {
  const validated = validateExternalRetirementManifest(manifest);
  assert.equal(validated.projects.length, 1);
  assert.equal(validated.projects[0]?.cases.length, 2);
});
await scenario("unsupported schema version fails closed", () => assert.throws(() =>
  validateExternalRetirementManifest({ ...manifest, schemaVersion: 2 })));
await scenario("missing project root fails closed", () => {
  const missing = structuredClone(manifest) as Record<string, unknown>;
  delete (missing.projects as Array<Record<string, unknown>>)[0]!.rootPath;
  assert.throws(() => validateExternalRetirementManifest(missing));
});
await scenario("duplicate project ids fail closed", () => assert.throws(() =>
  validateExternalRetirementManifest({ ...manifest, projects: [...manifest.projects, ...manifest.projects] })));
await scenario("duplicate case ids fail closed", () => assert.throws(() =>
  validateExternalRetirementManifest({
    ...manifest,
    projects: [{ ...manifest.projects[0], cases: [groundedCase, groundedCase] }],
  })));
await scenario("manifest accessor is not executed", () => {
  let executed = false;
  const malformed = Object.create(null);
  Object.defineProperty(malformed, "schemaVersion", { enumerable: true, get() { executed = true; return 1; } });
  assert.throws(() => validateExternalRetirementManifest(malformed));
  assert.equal(executed, false);
});
const manifestJson = JSON.stringify(manifest);
await scenario("UTF-8 manifest JSON without BOM is accepted", () => {
  assert.deepEqual(parseExternalRetirementManifestBytes(Buffer.from(manifestJson, "utf8")), manifest);
});
await scenario("UTF-8 manifest JSON with BOM is accepted", () => {
  const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(manifestJson, "utf8")]);
  assert.deepEqual(parseExternalRetirementManifestBytes(bytes), manifest);
});
await scenario("file harness executes a UTF-8 BOM manifest", async () => {
  const manifestPath = path.join(root, "bom-manifest.json");
  const outputDirectory = path.join(root, "bom-output");
  await fs.writeFile(manifestPath, Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(manifestJson, "utf8"),
  ]));
  const bomReport = await runExternalRetirementValidationFile({
    manifestPath,
    outputDirectory,
    caseFilter: [safeCase.id],
  });
  assert.equal(bomReport.metrics.totalCases, 1);
  assert.equal(bomReport.metrics.executedCases, 1);
  assert.equal(bomReport.metrics.notRunCases, 0);
  assert.equal(bomReport.manifest.normalizedContentHash, hashNormalizedExternalRetirementManifestBytes(Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(manifestJson, "utf8"),
  ])));
});
await scenario("malformed manifest JSON fails closed", () => assert.throws(() =>
  parseExternalRetirementManifestBytes(Buffer.from('{"schemaVersion":', "utf8")),
  /invalid_external_retirement_manifest/u));
await scenario("unsupported manifest encoding fails closed", () => assert.throws(() =>
  parseExternalRetirementManifestBytes(Buffer.from(manifestJson, "utf16le")),
  /invalid_external_retirement_manifest/u));
await scenario("external harness uses bounded preparation before primary execution", async () => {
  const source = await fs.readFile(new URL("../../commands/contextEngineExternalRetirementHarness.ts", import.meta.url), "utf8");
  const started = source.indexOf("const primaryStarted = input.monotonicMs()");
  const prepared = source.indexOf("prepareBoundedTaskPackCanaryInput({", started);
  const executed = source.indexOf("await input.runPrimary({", prepared);
  assert.ok(started >= 0 && prepared > started && executed > prepared);
});
await scenario("manifest authority overrides fail closed", () => assert.throws(() =>
  validateExternalRetirementManifest({
    ...manifest,
    projects: [{
      ...manifest.projects[0],
      cases: [{ ...groundedCase, explicitTargets: [{ kind: "path", path: "src/service.ts" }] }],
    }],
  })));

let scans = 0;
let observedInventory: ProjectInventory | null = null;
const report = await runExternalRetirementValidation(manifest, {
  nowIso: () => "2026-08-28T00:00:00.000Z",
  scanInventory: async (projectRoot) => {
    scans += 1;
    observedInventory = await scanProjectInventory(projectRoot);
    return observedInventory;
  },
});
function recreateObservationReport(input: {
  basis: ExternalObservationValidationReport;
  manifestId: string;
  cases: ExternalObservationValidationReport["cases"];
  createdAt?: string;
  repositories?: ExternalObservationValidationReport["repositories"];
  manifestContentHash?: string;
}): ExternalObservationValidationReport {
  return createExternalObservationReport({
    manifestId: input.manifestId,
    manifestContentHash: input.manifestContentHash ?? input.basis.manifest.normalizedContentHash,
    createdAt: input.createdAt ?? input.basis.createdAt,
    contextForgeVersion: input.basis.run.contextForgeVersion,
    contextForgeGitCommit: input.basis.run.contextForgeGitCommit,
    contextForgeWorkingTreeClean: input.basis.run.contextForgeWorkingTreeClean,
    ce2SourceFingerprint: input.basis.run.ce2SourceFingerprint,
    observationToolingFingerprint: input.basis.run.observationToolingFingerprint,
    repositories: input.repositories ?? input.basis.repositories,
    cases: input.cases,
    runTotalMs: input.basis.performance.runTotalMs,
  });
}

function distinctFingerprint(current: string, preferred: "a" | "b" | "c"): string {
  const candidate = `sha256:${preferred.repeat(64)}`;
  return candidate === current ? `sha256:${(preferred === "a" ? "b" : "a").repeat(64)}` : candidate;
}

function repositoriesCoveringCases(
  basis: ExternalObservationValidationReport,
  cases: ExternalObservationValidationReport["cases"],
): ExternalObservationValidationReport["repositories"] {
  return basis.repositories.map((repository) => {
    const identities = cases.filter((item) => item.projectId === repository.projectId).flatMap((item) => [
      item.determinism.firstExecutionIdentity,
      item.determinism.replayExecutionIdentity,
    ]).filter((identity): identity is NonNullable<typeof identity> => identity !== null);
    return {
      ...repository,
      inventoryFingerprints: [...new Set(identities.map((identity) => identity.inventoryFingerprint))].sort(),
      snapshotFingerprints: [...new Set(identities.map((identity) => identity.snapshotFingerprint))].sort(),
    };
  });
}
await scenario("external project is scanned once for all cases and replays", () => assert.equal(scans, 1));
await scenario("benchmark expected paths cannot inject user-confirmed authority", () => {
  const rawOnly = {
    ...groundedCase,
    task: "Update the requested service implementation",
    expectations: { ...groundedCase.expectations, requiredPaths: ["src/service.ts"] },
  };
  const derived = deriveExternalRetirementExecutionInput(rawOnly, observedInventory!);
  assert.equal(derived.structuredTargets.some((target) =>
    target.path === "src/service.ts" && target.provenance === "user_confirmed"), false);
});
await scenario("real path named in raw task uses production deterministic grounding", () => {
  const derived = deriveExternalRetirementExecutionInput(groundedCase, observedInventory!);
  assert.equal(derived.structuredTargets.some((target) =>
    target.path === "src/service.ts" && target.provenance === "user_confirmed"), true);
});
await scenario("effective task area is derived from deterministic Task Intent", () => {
  const derived = deriveExternalRetirementExecutionInput({
    ...safeCase,
    task: "Update the backend API endpoint validation",
    requestedTaskType: "general",
  }, observedInventory!);
  assert.equal(derived.effectiveTaskArea, derived.taskIntent.taskArea);
  assert.equal(derived.effectiveTaskArea, "backend");
});
await scenario("execution protected scopes come from task intent rather than forbidden expectations", () => {
  const derived = deriveExternalRetirementExecutionInput({
    ...groundedCase,
    task: "Update src/service.ts without changing backend behavior",
    expectations: { ...groundedCase.expectations, forbiddenPaths: ["src/entry.ts"] },
  }, observedInventory!);
  assert.ok(derived.protectedScopes.includes("backend/api"));
  assert.equal(derived.protectedScopes.includes("src/entry.ts"), false);
});
await scenario("external input applies the production current-state grounding shape", () => {
  const currentStateInventory = structuredClone(observedInventory!);
  currentStateInventory.files[0] = {
    ...currentStateInventory.files[0]!,
    path: "src/keyboardShortcuts.ts",
    name: "keyboardShortcuts.ts",
    semanticFacts: {
      declarations: ["keyboardShortcuts"], references: [], assignments: [],
      objectProperties: ["id", "displayKeys", "enabled"], typeFields: [],
      stateSymbols: [], translationKeys: [], translationEntries: [], routePaths: [],
      structuredEntries: [
        { values: [
          { key: "id", value: "globalSearch" },
          { key: "label", value: "Global Search" },
          { key: "displayKeys", value: "Ctrl F" },
          { key: "enabled", value: "true" },
        ] },
        { values: [
          { key: "id", value: "openTaskPacks" },
          { key: "label", value: "Open Task Packs" },
          { key: "displayKeys", value: "Ctrl Shift P" },
          { key: "enabled", value: "false" },
        ] },
      ],
    },
    contentPreview: "Global Search Ctrl F Open Task Packs Ctrl Shift P",
  };
  const currentStateCase = {
    ...groundedCase,
    task: "Change shortcut for Global Search from Ctrl+K to Ctrl+Shift+P.",
  };
  const fallback = buildDeterministicTaskIntentFallback({
    rawTask: currentStateCase.task,
    taskType: currentStateCase.requestedTaskType,
    projectTree: currentStateInventory.files.map((file) => file.path),
  });
  const productionGrounded = groundTaskCurrentState({
    rawTask: currentStateCase.task,
    inventory: currentStateInventory,
    taskIntent: fallback,
  });
  const external = deriveExternalRetirementExecutionInput(currentStateCase, currentStateInventory);
  assert.deepEqual(
    { ...external.taskIntent, durationMs: 0 },
    { ...productionGrounded, durationMs: 0 },
  );
  assert.equal(external.taskIntent.taskUnderstanding.readiness, "review");
  assert.equal(external.structuredTargets[0]?.path, "src/keyboardShortcuts.ts");
  assert.deepEqual(external.structuredTargets, productionGrounded.structuredIntent.primaryTargets);
  assert.deepEqual(external.protectedScopes, productionGrounded.structuredIntent.protectedScopes);
});
await scenario("grounded production execution is derived as pass", () => {
  const item = report.cases.find((entry) => entry.caseId === groundedCase.id);
  assert.equal(item?.verdict, "PASS", JSON.stringify(item));
  assert.equal(item?.actualStatus, "v2_applied");
  assert.deepEqual(item?.actualPaths, ["src/service.ts"]);
});
await scenario("safe unresolved production execution remains non-critical", () => {
  const item = report.cases.find((entry) => entry.caseId === safeCase.id);
  assert.ok(item?.verdict === "ACCEPTABLE" || item?.verdict === "SAFE_FAIL", JSON.stringify(item));
  assert.deepEqual(item?.actualPaths, []);
  assert.notEqual(item?.actualStatus, "legacy_rollback");
});
await scenario("deterministic replay is derived from repeated executions", () => assert.equal(
  report.cases.every((item) => item.deterministicReplayEquivalent), true));
await scenario("report counts derive from actual case executions", () => {
  assert.equal(report.metrics.totalCases, 2);
  assert.equal(report.metrics.executedCases, 2);
  assert.equal(report.metrics.groundedApplied, 1);
  assert.equal(report.metrics.semanticLegacyFallbackCount, 0);
  assert.equal(report.readiness.hardSafetyGatesPassed, true);
});
await scenario("observation report uses explicit schema v2 identity", () => {
  assert.equal(report.schemaVersion, 2);
  assert.equal(report.run.harnessMode, "external_primary_observation");
  assert.equal(report.engine.ce2Mode, "primary");
  assert.equal(report.engine.plannerMode, "deterministic");
  assert.equal(report.engine.globalDefaultState, "disabled");
  assert.match(report.run.ce2SourceFingerprint ?? "", /^sha256:[a-f0-9]{64}$/u);
  assert.match(report.run.observationToolingFingerprint ?? "", /^sha256:[a-f0-9]{64}$/u);
});
await scenario("manifest hashing is BOM and newline portable", () => {
  const lf = Buffer.from(`${manifestJson}\n`, "utf8");
  const crlf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(`${manifestJson}\r\n`, "utf8")]);
  assert.equal(hashNormalizedExternalRetirementManifestBytes(lf), hashNormalizedExternalRetirementManifestBytes(crlf));
  assert.match(hashNormalizedExternalRetirementManifestBytes(lf), /^sha256:[a-f0-9]{64}$/u);
});
await scenario("repository and snapshot identities are stable and linked", () => {
  const repository = report.repositories[0]!;
  const identities = report.cases.flatMap((item) => [
    item.determinism.firstExecutionIdentity,
    item.determinism.replayExecutionIdentity,
  ]).filter((identity): identity is NonNullable<typeof identity> => identity !== null);
  assert.ok(identities.length > 0);
  assert.deepEqual(repository.inventoryFingerprints, [...new Set(identities.map((item) => item.inventoryFingerprint))].sort());
  assert.deepEqual(repository.snapshotFingerprints, [...new Set(identities.map((item) => item.snapshotFingerprint))].sort());
});
await scenario("identical observation identity produces a stable run id", () => {
  const repeated = recreateObservationReport({ basis: report, manifestId: report.manifestId, cases: report.cases });
  assert.equal(repeated.runId, report.runId);
  assert.deepEqual(repeated.engine.configurationFingerprints, report.engine.configurationFingerprints);
});
await scenario("run id is observation identity rather than verdict data", () => {
  const changedOutcome = structuredClone(report.cases);
  changedOutcome[0]!.verdict = changedOutcome[0]!.verdict === "PASS" ? "ACCEPTABLE" : "PASS";
  const recreated = recreateObservationReport({ basis: report, manifestId: report.manifestId, cases: changedOutcome });
  assert.equal(recreated.runId, report.runId);
  assert.notDeepEqual(recreated.metrics.verdicts, report.metrics.verdicts);
});
await scenario("dirty and clean repository observations have distinct run identities", () => {
  const baseRepository = {
    ...report.repositories[0]!,
    gitHead: "a".repeat(40),
    gitIdentityUnavailableReason: null,
  };
  const clean = recreateObservationReport({
    basis: report, manifestId: "external-clean-identity", cases: report.cases,
    repositories: [{ ...baseRepository, workingTreeClean: true }],
  });
  const dirty = recreateObservationReport({
    basis: report, manifestId: "external-clean-identity", cases: report.cases,
    repositories: [{ ...baseRepository, workingTreeClean: false }],
  });
  assert.notEqual(clean.runId, dirty.runId);
});
await scenario("grounded proof distribution and applied target count are retained", () => {
  const item = report.cases.find((entry) => entry.caseId === groundedCase.id)!;
  assert.ok(item.proofs.counts.direct_source_identity > 0);
  assert.equal(item.proofs.appliedGroundedTargetCount, 1);
  assert.equal(report.summary.proofClassCounts.direct_source_identity >= item.proofs.counts.direct_source_identity, true);
});
await scenario("selection roles and usages are retained", () => {
  const item = report.cases.find((entry) => entry.caseId === groundedCase.id)!;
  assert.deepEqual(item.selection.appliedFiles, [{ path: "src/service.ts", role: "target", usage: "inspect-and-edit" }]);
  assert.equal(report.summary.appliedRoleCounts.target, 1);
  assert.equal(report.summary.appliedUsageCounts["inspect-and-edit"], 1);
  assert.ok(report.summary.projectedPathCount >= report.summary.appliedPathCount);
});
await scenario("downstream authorization is reported without expanding authority", () => {
  const item = report.cases.find((entry) => entry.caseId === groundedCase.id)!;
  assert.deepEqual(item.authorization.authorizedEditPaths, ["src/service.ts"]);
  assert.equal(item.authorization.projectedAuthorizationMatchesApplied, true);
  assert.equal(item.authorization.unauthorizedEditableTarget, false);
  assert.equal(report.summary.unauthorizedEditableTargetCount, 0);
});
await scenario("unavailable detailed metrics are represented as unavailable", () => {
  const item = report.cases.find((entry) => entry.caseId === groundedCase.id)!;
  assert.equal(item.contradictions.count, null);
  assert.equal(item.contradictions.unavailableReason, "downstream_contract_not_exposed");
  assert.equal(item.operations.uniqueFilesRead, null);
  assert.equal(report.summary.contradictionCount, null);
  assert.equal(report.summary.detailedOperationMetricsUnavailableReason, "downstream_contract_not_exposed");
});
await scenario("operation and timing telemetry retains both deterministic executions", () => {
  const item = report.cases.find((entry) => entry.caseId === groundedCase.id)!;
  assert.ok(item.operations.first);
  assert.ok(item.operations.replay);
  assert.ok(item.operations.first!.operations >= 0);
  assert.ok(item.timing.firstExecutionMs !== null && item.timing.firstExecutionMs >= 0);
  assert.ok(item.timing.replayExecutionMs !== null && item.timing.replayExecutionMs >= 0);
  assert.ok(report.performance.runTotalMs >= 0);
  assert.equal(report.performance.coldWarmClassification, null);
});
await scenario("determinism is explicitly same-process and same-snapshot", () => {
  const item = report.cases.find((entry) => entry.caseId === groundedCase.id)!;
  assert.equal(item.determinism.scope, "same_process_same_snapshot");
  assert.deepEqual(item.determinism.firstExecutionIdentity, item.determinism.replayExecutionIdentity);
  assert.equal(item.determinism.executionBasisEquivalent, true);
  assert.equal(item.determinism.resultEquivalent, true);
  assert.equal(item.determinism.equivalent, true);
  assert.equal(item.determinism.firstResultIdentity, item.determinism.replayResultIdentity);
  assert.equal(report.determinism.crossProcessEstablished, false);
  assert.equal(report.determinism.failureCount, 0);
});
await scenario("fallback and rollback concepts remain separate", () => {
  assert.equal(report.fallback.infrastructureRollbackCount, 0);
  assert.equal(report.fallback.semanticLegacyFallbackCount, 0);
  assert.equal(report.fallback.legacySelectorInvocationCount, 0);
  assert.equal(report.fallback.legacySelectorFallbackRate, null);
  assert.equal(report.fallback.legacySelectorFallbackUnavailableReason, "legacy_selector_not_invoked");
  assert.equal(report.fallback.legacyComparisonEligibleCount, null);
});
await scenario("historical schema v1 report construction remains available", () => {
  const legacy = createExternalRetirementReport({
    manifestId: "external-v1-readable",
    createdAt: "2026-08-28T00:00:00.000Z",
    cases: report.cases.map((item) => ({
      projectId: item.projectId,
      caseId: item.caseId,
      repositoryShape: item.repositoryShape,
      availability: item.availability,
      actualStatus: item.actualStatus,
      actualPaths: item.actualPaths,
      reasonCodes: item.reasonCodes,
      rollbackReason: item.rollbackReason,
      verdict: item.verdict,
      unsafeAutomaticAdoption: item.unsafeAutomaticAdoption,
      negativeConstraintViolation: item.negativeConstraintViolation,
      restrictedEditableSelection: item.restrictedEditableSelection,
      silentHybridSelection: item.silentHybridSelection,
      modelPlannerUsed: item.modelPlannerUsed,
      deterministicReplayEquivalent: item.deterministicReplayEquivalent,
      semanticAmbiguityHandledSafely: item.semanticAmbiguityHandledSafely,
      groundedRolesSupported: item.groundedRolesSupported,
    })),
  });
  assert.equal(legacy.schemaVersion, 1);
});

function oversizedInventory(source: ProjectInventory): ProjectInventory {
  const first = source.files[0]!;
  const files = Array.from({ length: TASK_PACK_CANARY_PREPARATION_LIMITS.maxInventoryFiles + 1 }, (_, index) => ({
    ...structuredClone(first),
    path: `src/generated-fixture-${index}.ts`,
    name: `generated-fixture-${index}.ts`,
  }));
  return { ...structuredClone(source), files, totalFiles: files.length, scannedFiles: files.length };
}

let rejectedPreparationExecutions = 0;
const preparationLimitReport = await runExternalRetirementValidation({
  ...manifest,
  manifestId: "external-preparation-limit",
  projects: [{ ...manifest.projects[0], cases: [groundedCase] }],
}, {
  nowIso: () => "2026-08-28T00:00:00.000Z",
  scanInventory: async () => oversizedInventory(observedInventory!),
  runPrimary: async () => {
    rejectedPreparationExecutions += 1;
    throw new Error("primary_must_not_execute_after_preparation_rejection");
  },
});
await scenario("production preparation limit rejects before primary execution", () => {
  assert.equal(rejectedPreparationExecutions, 0);
  assert.equal(preparationLimitReport.cases[0]?.actualStatus, "engine_error");
  assert.deepEqual(preparationLimitReport.cases[0]?.reasonCodes, ["preparation_limit_exceeded"]);
  assert.equal(preparationLimitReport.metrics.infrastructureRollbackCount, 0);
  assert.equal(preparationLimitReport.metrics.semanticLegacyFallbackCount, 0);
  assert.equal(preparationLimitReport.readiness.hardSafetyGatesPassed, false);
});

let deadlineExecutions = 0;
const deadlineClock = [0, 2_000, 0, 2_000];
const preparationDeadlineReport = await runExternalRetirementValidation({
  ...manifest,
  manifestId: "external-preparation-deadline",
  projects: [{ ...manifest.projects[0], cases: [groundedCase] }],
}, {
  nowIso: () => "2026-08-28T00:00:00.000Z",
  monotonicMs: () => deadlineClock.shift() ?? 2_000,
  runPrimary: async () => {
    deadlineExecutions += 1;
    throw new Error("primary_must_not_execute_after_preparation_deadline");
  },
});
await scenario("production preparation deadline fails closed without rollback", () => {
  assert.equal(deadlineExecutions, 0);
  assert.equal(preparationDeadlineReport.cases[0]?.actualStatus, "engine_error");
  assert.deepEqual(preparationDeadlineReport.cases[0]?.reasonCodes, ["execution_timeout"]);
  assert.equal(preparationDeadlineReport.metrics.infrastructureRollbackCount, 0);
  assert.equal(preparationDeadlineReport.metrics.semanticLegacyFallbackCount, 0);
  assert.equal(preparationDeadlineReport.readiness.hardSafetyGatesPassed, false);
});

const rejectedDependencies: TaskPackPrimaryRuntimeDependencies = {
  tracker: createContextEngineShadowExecutionTracker({ maximumActiveExecutions: 1 }),
  nowIso: () => "2026-08-28T00:00:00.000Z",
  monotonicMs: () => Math.floor(performance.now()),
  execute: async () => { throw new Error("provider source fragment must not escape"); },
};
const rollbackManifest = {
  ...manifest,
  manifestId: "external-rollback",
  projects: [{
    ...manifest.projects[0],
    cases: [{
      ...groundedCase,
      id: "infrastructure-rollback",
      expectations: {
        expectedOutcome: "typed_infrastructure_rollback",
        allowedStatuses: ["legacy_rollback"],
        requiredPaths: [], forbiddenPaths: [], ambiguityExpected: false,
        expectedRollbackReason: "execution_error",
      },
    }],
  }],
} as const;
const rollbackReport = await runExternalRetirementValidation(rollbackManifest, {
  nowIso: () => "2026-08-28T00:00:00.000Z",
  runPrimary: createTaskPackPrimaryService(rejectedDependencies),
});
await scenario("infrastructure rollback is observed and accounted", () => {
  assert.equal(rollbackReport.metrics.infrastructureRollbackCount, 1);
  assert.equal(rollbackReport.metrics.rollbackReasons.execution_error, 1);
  assert.equal(rollbackReport.cases[0]?.verdict, "PASS");
});
await scenario("semantic failure does not become legacy fallback", () => assert.equal(
  report.metrics.semanticLegacyFallbackCount, 0));

const unsafeManifest = {
  ...manifest,
  manifestId: "external-critical",
  projects: [{
    ...manifest.projects[0],
    cases: [{
      ...groundedCase,
      id: "forbidden-observed-target",
      expectations: {
        expectedOutcome: "safe_no_selection",
        allowedStatuses: ["v2_no_selection", "safe_fail"],
        requiredPaths: [], forbiddenPaths: ["src/service.ts"], ambiguityExpected: false,
        expectedRollbackReason: null,
      },
    }],
  }],
} as const;
const criticalReport = await runExternalRetirementValidation(unsafeManifest, { nowIso: () => "2026-08-28T00:00:00.000Z" });
await scenario("observed unsafe target derives critical failure and blocks readiness", () => {
  assert.equal(criticalReport.cases[0]?.verdict, "CRITICAL_FAIL");
  assert.equal(criticalReport.readiness.hardSafetyGatesPassed, false);
  assert.ok(criticalReport.readiness.blockers.includes("critical_failures"));
});
await scenario("replay mismatch independently blocks readiness", () => {
  const mismatch = structuredClone(report.cases);
  mismatch[0]!.deterministicReplayEquivalent = false;
  mismatch[0]!.determinism.resultEquivalent = false;
  mismatch[0]!.determinism.equivalent = false;
  mismatch[0]!.determinism.replayResultIdentity = `sha256:${"f".repeat(64)}`;
  const mismatchReport = recreateObservationReport({
    basis: report, manifestId: "external-replay-mismatch", createdAt: "2026-08-28T00:00:00.000Z", cases: mismatch,
  });
  assert.equal(mismatchReport.readiness.hardSafetyGatesPassed, false);
  assert.ok(mismatchReport.readiness.blockers.includes("deterministic_replay_failures"));
});
await scenario("same result with a different replay snapshot fails same-snapshot determinism", () => {
  const cases = structuredClone(report.cases);
  const item = cases[0]!;
  const replayIdentity = item.determinism.replayExecutionIdentity!;
  replayIdentity.snapshotFingerprint = distinctFingerprint(replayIdentity.snapshotFingerprint, "a");
  item.determinism.executionBasisEquivalent = false;
  item.determinism.equivalent = false;
  item.deterministicReplayEquivalent = false;
  const changed = recreateObservationReport({
    basis: report,
    manifestId: report.manifestId,
    cases,
    repositories: repositoriesCoveringCases(report, cases),
  });
  assert.equal(changed.cases[0]!.determinism.resultEquivalent, true);
  assert.equal(changed.cases[0]!.determinism.executionBasisEquivalent, false);
  assert.equal(changed.cases[0]!.determinism.equivalent, false);
  assert.equal(changed.cases[0]!.deterministicReplayEquivalent, false);
  assert.ok(changed.readiness.blockers.includes("deterministic_replay_failures"));
  assert.notEqual(changed.runId, report.runId);
});
await scenario("same result with a different replay configuration fails determinism", () => {
  const cases = structuredClone(report.cases);
  const item = cases[0]!;
  const replayIdentity = item.determinism.replayExecutionIdentity!;
  replayIdentity.configurationFingerprint = distinctFingerprint(replayIdentity.configurationFingerprint, "b");
  item.determinism.executionBasisEquivalent = false;
  item.determinism.equivalent = false;
  item.deterministicReplayEquivalent = false;
  const changed = recreateObservationReport({ basis: report, manifestId: report.manifestId, cases });
  assert.equal(changed.cases[0]!.determinism.resultEquivalent, true);
  assert.equal(changed.determinism.failureCount, 1);
  assert.notEqual(changed.runId, report.runId);
});
await scenario("same result with a different replay task fails determinism", () => {
  const cases = structuredClone(report.cases);
  const item = cases[0]!;
  const replayIdentity = item.determinism.replayExecutionIdentity!;
  replayIdentity.taskFingerprint = distinctFingerprint(replayIdentity.taskFingerprint, "c");
  item.determinism.executionBasisEquivalent = false;
  item.determinism.equivalent = false;
  item.deterministicReplayEquivalent = false;
  const changed = recreateObservationReport({ basis: report, manifestId: report.manifestId, cases });
  assert.equal(changed.cases[0]!.determinism.resultEquivalent, true);
  assert.equal(changed.determinism.failureCount, 1);
});
await scenario("validator rejects forged execution-basis equivalence", () => {
  const forged = structuredClone(report);
  const item = forged.cases[0]!;
  item.determinism.replayExecutionIdentity!.snapshotFingerprint = distinctFingerprint(
    item.determinism.replayExecutionIdentity!.snapshotFingerprint,
    "a",
  );
  assert.equal(item.determinism.executionBasisEquivalent, true);
  assert.throws(() => validateExternalObservationReport(forged));
});
await scenario("validator rejects forged overall equivalence when result equivalence is false", () => {
  const forged = structuredClone(report);
  forged.cases[0]!.determinism.resultEquivalent = false;
  assert.equal(forged.cases[0]!.determinism.equivalent, true);
  assert.throws(() => validateExternalObservationReport(forged));
});
await scenario("validator rejects disagreement between legacy and strong determinism fields", () => {
  const forged = structuredClone(report);
  forged.cases[0]!.deterministicReplayEquivalent = false;
  assert.equal(forged.cases[0]!.determinism.equivalent, true);
  assert.throws(() => validateExternalObservationReport(forged));
});
await scenario("ContextForge provenance is resolved per run before project scanning", async () => {
  let provenanceCalls = 0;
  const events: string[] = [];
  const resolveContextForgeIdentity = async () => {
    provenanceCalls += 1;
    events.push(`identity-${provenanceCalls}`);
    return {
      gitCommit: "d".repeat(40),
      workingTreeClean: false,
      ce2SourceFingerprint: `sha256:${(provenanceCalls === 1 ? "a" : "b").repeat(64)}`,
      observationToolingFingerprint: `sha256:${"c".repeat(64)}`,
    };
  };
  const options = {
    nowIso: () => "2026-08-28T00:00:00.000Z",
    scanInventory: async () => {
      events.push(`scan-${provenanceCalls}`);
      return observedInventory!;
    },
    resolveContextForgeIdentity,
  };
  const first = await runExternalRetirementValidation({
    ...manifest,
    manifestId: "external-provenance-per-run",
    projects: [{ ...manifest.projects[0], cases: [safeCase] }],
  }, options);
  const second = await runExternalRetirementValidation({
    ...manifest,
    manifestId: "external-provenance-per-run",
    projects: [{ ...manifest.projects[0], cases: [safeCase] }],
  }, options);
  assert.equal(provenanceCalls, 2);
  assert.deepEqual(events, ["identity-1", "scan-1", "identity-2", "scan-2"]);
  assert.notEqual(first.run.ce2SourceFingerprint, second.run.ce2SourceFingerprint);
  assert.notEqual(first.runId, second.runId);
});
await scenario("unavailable project is explicitly not run", async () => {
  const unavailable = await runExternalRetirementValidation({
    ...manifest,
    manifestId: "external-unavailable",
    projects: [{ ...manifest.projects[0], rootPath: path.join(root, "missing") }],
  }, { nowIso: () => "2026-08-28T00:00:00.000Z" });
  assert.equal(unavailable.metrics.notRunCases, 2);
  assert.equal(unavailable.cases.every((item) => item.availability === "not_run"), true);
  assert.equal(unavailable.readiness.hardSafetyGatesPassed, false);
  assert.ok(unavailable.readiness.blockers.includes("no_executed_cases"));
  assert.ok(unavailable.readiness.blockers.includes("incomplete_execution"));
});
const mixedManifest = {
  ...manifest,
  manifestId: "external-partial",
  projects: [
    { ...manifest.projects[0], cases: [groundedCase] },
    { id: "missing-project", rootPath: path.join(root, "missing"), cases: [{ ...safeCase, id: "missing-project-case" }] },
  ],
} as const;
const mixedReport = await runExternalRetirementValidation(mixedManifest, { nowIso: () => "2026-08-28T00:00:00.000Z" });
await scenario("mixed executed and not-run scope blocks readiness", () => {
  assert.equal(mixedReport.metrics.executedCases, 1);
  assert.equal(mixedReport.metrics.notRunCases, 1);
  assert.equal(mixedReport.readiness.hardSafetyGatesPassed, false);
  assert.ok(mixedReport.readiness.blockers.includes("incomplete_execution"));
});
await scenario("intentional project filter evaluates only selected complete scope", async () => {
  const filtered = await runExternalRetirementValidation(mixedManifest, {
    nowIso: () => "2026-08-28T00:00:00.000Z",
    projectFilter: ["generic-project"],
  });
  assert.equal(filtered.metrics.totalCases, 1);
  assert.equal(filtered.metrics.notRunCases, 0);
  assert.equal(filtered.readiness.hardSafetyGatesPassed, true);
});
await scenario("CLI returns non-zero for partial selected scope", async () => {
  const manifestPath = path.join(root, "partial-manifest.json");
  const outputDirectory = path.join(root, "partial-output");
  await fs.writeFile(manifestPath, JSON.stringify(mixedManifest), "utf8");
  assert.equal(await runExternalRetirementValidationCli([
    "--manifest", manifestPath,
    "--output", outputDirectory,
  ]), 2);
});
await scenario("CLI returns zero for a fully executed clean scope", async () => {
  const manifestPath = path.join(root, "full-manifest.json");
  const outputDirectory = path.join(root, "full-output");
  await fs.writeFile(manifestPath, JSON.stringify(manifest), "utf8");
  assert.equal(await runExternalRetirementValidationCli([
    "--manifest", manifestPath,
    "--output", outputDirectory,
  ]), 0);
});
await scenario("CLI summary separates hard safety from unevaluated quality acceptance", () => {
  const safeFailReport = recreateObservationReport({
    basis: report,
    manifestId: "external-safe-fail-summary",
    createdAt: "2026-08-29T00:00:00.000Z",
    cases: [{
      ...report.cases[1]!,
      actualStatus: "safe_fail",
      actualPaths: [],
      reasonCodes: ["downstream_authorization_rejected"],
      verdict: "SAFE_FAIL",
      deterministicReplayEquivalent: true,
      groundedRolesSupported: true,
    }],
  });
  const summary = formatExternalRetirementValidationCliSummary(safeFailReport);
  assert.match(summary, /hard safety gates PASS;/u);
  assert.match(summary, /1\/1 cases executed;/u);
  assert.match(summary, /acceptable-or-better 0\.0%;/u);
  assert.match(summary, /quality threshold not evaluated\./u);
  assert.equal(summary.includes("External retirement validation: PASS"), false);
});
await scenario("portable report excludes local root and source content", () => {
  const serialized = serializeExternalObservationReportJson(report);
  assert.equal(serialized.includes(root), false);
  assert.equal(serialized.includes("grounded-marker"), false);
  assert.equal(serialized.includes("provider source fragment"), false);
  assert.equal(serialized.includes(groundedCase.task), false);
  assert.equal(serialized.includes(safeCase.task), false);
});
await scenario("privacy validation rejects secret-bearing observation metadata", () => {
  const malformed = structuredClone(report);
  malformed.run.contextForgeVersion = "token=secret-observation-value";
  assert.throws(() => validateExternalObservationReport(malformed));
});
await scenario("validated report is defensively cloned", () => {
  const validated = validateExternalObservationReport(report);
  validated.cases[0]!.actualPaths.push("src/other.ts");
  assert.deepEqual(report.cases[0]!.actualPaths, ["src/service.ts"]);
});
await scenario("report accessor is rejected without execution", () => {
  let executed = false;
  const malformed = Object.create(null);
  Object.defineProperty(malformed, "schemaVersion", { enumerable: true, get() { executed = true; return 1; } });
  assert.throws(() => validateExternalObservationReport(malformed));
  assert.equal(executed, false);
});
await scenario("unknown nested report properties fail closed", () => {
  const malformed = structuredClone(report) as ExternalObservationValidationReport & { metrics: ExternalObservationValidationReport["metrics"] & { sourceContent?: string } };
  malformed.metrics.sourceContent = serviceSource;
  assert.throws(() => validateExternalObservationReport(malformed));
});

await fs.rm(root, { recursive: true, force: true });
process.stdout.write(`Context Engine v2 external retirement validation smoke passed: ${scenarios} scenarios.\n`);
