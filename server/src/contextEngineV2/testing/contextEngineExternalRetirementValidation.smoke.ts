import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  deriveExternalRetirementExecutionInput,
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
  createExternalRetirementReport,
  serializeExternalRetirementReportJson,
  validateExternalRetirementManifest,
  validateExternalRetirementReport,
  type ExternalRetirementValidationReport,
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
  const mismatchReport = createExternalRetirementReport({
    manifestId: "external-replay-mismatch", createdAt: "2026-08-28T00:00:00.000Z", cases: mismatch,
  });
  assert.equal(mismatchReport.readiness.hardSafetyGatesPassed, false);
  assert.ok(mismatchReport.readiness.blockers.includes("deterministic_replay_failures"));
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
  const safeFailReport = createExternalRetirementReport({
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
  const serialized = serializeExternalRetirementReportJson(report);
  assert.equal(serialized.includes(root), false);
  assert.equal(serialized.includes("grounded-marker"), false);
  assert.equal(serialized.includes("provider source fragment"), false);
});
await scenario("validated report is defensively cloned", () => {
  const validated = validateExternalRetirementReport(report);
  validated.cases[0]!.actualPaths.push("src/other.ts");
  assert.deepEqual(report.cases[0]!.actualPaths, ["src/service.ts"]);
});
await scenario("report accessor is rejected without execution", () => {
  let executed = false;
  const malformed = Object.create(null);
  Object.defineProperty(malformed, "schemaVersion", { enumerable: true, get() { executed = true; return 1; } });
  assert.throws(() => validateExternalRetirementReport(malformed));
  assert.equal(executed, false);
});
await scenario("unknown nested report properties fail closed", () => {
  const malformed = structuredClone(report) as ExternalRetirementValidationReport & { metrics: ExternalRetirementValidationReport["metrics"] & { sourceContent?: string } };
  malformed.metrics.sourceContent = serviceSource;
  assert.throws(() => validateExternalRetirementReport(malformed));
});

await fs.rm(root, { recursive: true, force: true });
process.stdout.write(`Context Engine v2 external retirement validation smoke passed: ${scenarios} scenarios.\n`);
