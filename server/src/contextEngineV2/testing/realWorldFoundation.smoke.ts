import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

import {
  createRealWorldFoundation, MAX_FOUNDATION_CASES, MAX_FOUNDATION_DIAGNOSTICS,
  MAX_MECHANICAL_TASK_CHARS, RealWorldFoundationError,
} from "../validation/realWorld/realWorldFoundation.js";
import {
  REAL_WORLD_EFFECTS, REAL_WORLD_FOUNDATION_PROFILE, REAL_WORLD_STAGES,
  REAL_WORLD_TECHNICAL_STATUSES,
} from "../validation/realWorld/realWorldTypes.js";
import type { RealWorldFoundationPlan } from "../validation/realWorld/realWorldTypes.js";

let scenarios = 0;
function check(name: string, test: () => void): void {
  test();
  scenarios += 1;
  process.stdout.write(`PASS ${name}\n`);
}
const digest = `sha256:${"a".repeat(64)}`;
const task = { rawTask: "Inert mechanical input only.\t\r\n", taskType: "bugfix", targetTool: "generic" };
function plan(): RealWorldFoundationPlan {
  return {
    profileId: REAL_WORLD_FOUNDATION_PROFILE, runId: "mechanical-run-001", protocolDigest: digest,
    sourceBasis: { kind: "synthetic_inert", projectAlias: "fixture-001", manifestDigest: digest,
      authorization: "mechanical_only", authorizationEvidenceDigest: digest },
    runtimeIdentity: { contextforgeCommit: "b".repeat(40), toolingDigest: digest, settingsBasis: "synthetic_inert",
      safeSettingsDigest: digest, productionPolicyDigest: digest, intendedEngineMode: "primary",
      intendedPlannerMode: "deterministic", understandingAvailability: "unresolved" },
    plannedCaseIds: ["mechanical-001", "mechanical-002", "mechanical-003"],
    dependencies: REAL_WORLD_EFFECTS.map((effect) => ({ effect, disposition: "unresolved", evidenceDigest: null })),
  };
}
function invalid(mutator: (value: RealWorldFoundationPlan) => void): void {
  const input = plan();
  mutator(input);
  assert.throws(() => createRealWorldFoundation(input), (error: unknown) =>
    error instanceof RealWorldFoundationError && error.code === "invalid_plan" && error.message === "invalid_plan");
}

check("unresolved dependencies hard-stop every production stage", () => {
  const session = createRealWorldFoundation(plan());
  const result = session.assessCase("mechanical-001", task);
  assert.equal(result.technicalStatus, "not_run");
  assert.deepEqual(result.reasonCodes, ["adapters_not_wired", "dependency_unresolved"]);
  assert.deepEqual(result.unresolvedEffects, REAL_WORLD_EFFECTS);
  const report = session.finalize();
  assert.equal(report.executionEnabled, false);
  assert.equal(report.fullProductionParity, false);
  assert.deepEqual(report.parity.map((item) => item.stage), REAL_WORLD_STAGES);
  assert.ok(report.parity.every((item) => item.status === "blocked"));
});
for (const effect of REAL_WORLD_EFFECTS) {
  check(`write-capable ${effect} rejected without execution`, () => {
    const input = plan();
    input.dependencies = input.dependencies.map((item) => item.effect === effect ? { ...item, disposition: "write_capable" } : item);
    const result = createRealWorldFoundation(input).assessCase("mechanical-001", task);
    assert.equal(result.technicalStatus, "not_run");
    assert.ok(result.reasonCodes.includes("write_capability_rejected"));
    assert.deepEqual(result.writeCapableEffects, [effect]);
    assert.equal(result.engineInvoked, false);
  });
}
check("documentary isolation claims cannot enable adapters", () => {
  const input = plan();
  input.dependencies = input.dependencies.map((item) => ({ ...item, disposition: "isolated", evidenceDigest: digest }));
  const session = createRealWorldFoundation(input);
  assert.deepEqual(session.assessCase("mechanical-001", task).reasonCodes, ["adapters_not_wired"]);
  assert.equal(session.finalize().accounting.engineInvocations, 0);
});
check("excluded dependencies still cannot enable adapters", () => {
  const input = plan();
  input.dependencies = input.dependencies.map((item) => ({ ...item, disposition: "excluded", evidenceDigest: digest }));
  assert.equal(createRealWorldFoundation(input).assessCase("mechanical-001", task).technicalStatus, "not_run");
});
check("no executable dependency/callback can be injected", () => {
  let called = 0;
  for (const effect of REAL_WORLD_EFFECTS) {
    const input = { ...plan(), [effect]: () => { called += 1; } };
    assert.throws(() => createRealWorldFoundation(input), RealWorldFoundationError);
  }
  const input = plan();
  Object.assign(input.dependencies[0], { execute: () => { called += 1; } });
  assert.throws(() => createRealWorldFoundation(input), RealWorldFoundationError);
  assert.equal(called, 0);
});
check("plan accessors rejected without invoking them", () => {
  let called = 0;
  const input = plan();
  Object.defineProperty(input.runtimeIdentity, "toolingDigest", { enumerable: true, get: () => { called += 1; return digest; } });
  assert.throws(() => createRealWorldFoundation(input), RealWorldFoundationError);
  assert.equal(called, 0);
});
check("task accessors rejected without invoking them", () => {
  let called = 0;
  const input = { ...task };
  Object.defineProperty(input, "rawTask", { enumerable: true, get: () => { called += 1; return "private"; } });
  assert.equal(createRealWorldFoundation(plan()).assessCase("mechanical-001", input).technicalStatus, "invalid_input");
  assert.equal(called, 0);
});
check("oracle and evaluator fields never enter runner-visible data", () => {
  for (const field of ["oracle", "expectations", "requiredOwners", "semanticVerdict", "evaluator", "sourceRoot"]) {
    const result = createRealWorldFoundation(plan()).assessCase("mechanical-001", { ...task, [field]: "PRIVATE_SENTINEL" });
    assert.equal(result.technicalStatus, "invalid_input");
    assert.ok(!JSON.stringify(result).includes("PRIVATE_SENTINEL"));
    assert.throws(() => createRealWorldFoundation({ ...plan(), [field]: "PRIVATE_SENTINEL" }), RealWorldFoundationError);
  }
});
check("nested arbitrary settings/endpoints/roots rejected", () => {
  invalid((input) => { Object.assign(input.runtimeIdentity, { endpoint: "PRIVATE_SENTINEL" }); });
  invalid((input) => { Object.assign(input.sourceBasis, { root: "PRIVATE_SENTINEL" }); });
});
check("raw input never retained in diagnostics/report", () => {
  const input = { ...task, rawTask: "PRIVATE_TASK_SENTINEL\nUnicode: Ж 🙂\t\r\n" };
  const before = structuredClone(input);
  const session = createRealWorldFoundation(plan());
  session.assessCase("mechanical-001", input);
  input.rawTask = "CHANGED_PRIVATE_SENTINEL";
  const report = JSON.stringify(session.finalize());
  assert.ok(!report.includes("PRIVATE_TASK_SENTINEL"));
  assert.ok(!report.includes("CHANGED_PRIVATE_SENTINEL"));
  assert.ok(!report.includes("rawTask"));
  assert.equal(before.rawTask, "PRIVATE_TASK_SENTINEL\nUnicode: Ж 🙂\t\r\n");
});
check("caller plan/task are not mutated or frozen", () => {
  const input = plan();
  const raw = { ...task };
  const before = structuredClone(input);
  createRealWorldFoundation(input).assessCase("mechanical-001", raw);
  assert.deepEqual(input, before);
  assert.deepEqual(raw, task);
  assert.equal(Object.isFrozen(input), false);
  assert.equal(Object.isFrozen(raw), false);
});
check("later caller mutation cannot replace captured identities", () => {
  const input = plan();
  const session = createRealWorldFoundation(input);
  input.plannedCaseIds = ["mechanical-999"];
  input.runtimeIdentity.toolingDigest = `sha256:${"c".repeat(64)}`;
  assert.equal(session.finalize().identity.runtimeIdentity.toolingDigest, digest);
  assert.equal(session.finalize().accounting.planned, 3);
});
check("all slots accounted in planned order including skipped/invalid/untouched", () => {
  const session = createRealWorldFoundation(plan());
  session.skipCase("mechanical-003");
  session.assessCase("mechanical-002", { ...task, oracle: {} });
  const report = session.finalize();
  assert.deepEqual(report.cases.map((item) => item.caseId), plan().plannedCaseIds);
  assert.deepEqual(report.cases.map((item) => item.technicalStatus), ["not_run", "invalid_input", "skipped"]);
  assert.equal(report.accounting.accounted, 3);
  assert.equal(report.accounting.statusCounts.not_run, 1);
  assert.equal(report.accounting.statusCounts.invalid_input, 1);
  assert.equal(report.accounting.statusCounts.skipped, 1);
  assert.equal(Object.values(report.accounting.statusCounts).reduce((sum, count) => sum + count, 0), 3);
  for (const status of ["completed", "timeout", "engine_error", "source_changed", "oracle_pending"] as const) assert.equal(report.accounting.statusCounts[status], 0);
  assert.equal(report.accounting.qualityMeasurement, null);
  assert.equal(report.accounting.semanticEvaluations, 0);
  assert.ok(report.cases.every((item) => item.semanticVerdict === null && item.durationMs === null && item.engineOutcome === null));
});
check("no silent retry/result overwrite", () => {
  const session = createRealWorldFoundation(plan());
  session.assessCase("mechanical-001", task);
  assert.throws(() => session.assessCase("mechanical-001", task), { code: "already_accounted" });
  assert.throws(() => session.skipCase("mechanical-001"), { code: "already_accounted" });
});
check("unknown case rejected with safe error", () => {
  assert.throws(() => createRealWorldFoundation(plan()).assessCase("PRIVATE_SENTINEL", task), { code: "unknown_case", message: "unknown_case" });
});
check("finalization seals immutable evidence and is idempotent", () => {
  const session = createRealWorldFoundation(plan());
  const report = session.finalize();
  assert.equal(session.finalize(), report);
  assert.throws(() => session.assessCase("mechanical-001", task), { code: "session_sealed" });
  assert.ok(Object.isFrozen(report.identity.sourceBasis));
  assert.ok(Object.isFrozen(report.cases[0].reasonCodes));
  assert.ok(Object.isFrozen(report.diagnostics.records));
  assert.throws(() => { (report.cases[0].reasonCodes as unknown as string[]).push("explicit_skip"); }, TypeError);
});
check("identical mechanical input produces identical accounting", () => {
  function replay() {
    const session = createRealWorldFoundation(plan());
    session.assessCase("mechanical-001", task);
    return session.finalize();
  }
  assert.deepEqual(replay(), replay()); // Foundation determinism, NOT CE2 replay qualification.
});
check("diagnostics bounded; overflow explicitly counted, cases never omitted", () => {
  const input = plan();
  input.plannedCaseIds = Array.from({ length: MAX_FOUNDATION_CASES }, (_, index) => `mechanical-${String(index).padStart(3, "0")}`);
  const report = createRealWorldFoundation(input).finalize();
  assert.equal(report.cases.length, MAX_FOUNDATION_CASES);
  assert.equal(report.diagnostics.records.length, MAX_FOUNDATION_DIAGNOSTICS);
  assert.equal(report.diagnostics.droppedRecords, MAX_FOUNDATION_CASES * 2 - MAX_FOUNDATION_DIAGNOSTICS);
  assert.equal(report.diagnostics.persistence, "memory_only");
});
check("case/input bounds fail without truncation", () => {
  invalid((input) => { input.plannedCaseIds = Array.from({ length: MAX_FOUNDATION_CASES + 1 }, (_, index) => `mechanical-${String(index).padStart(3, "0")}`); });
  const session = createRealWorldFoundation(plan());
  assert.equal(session.assessCase("mechanical-001", { ...task, rawTask: "x".repeat(MAX_MECHANICAL_TASK_CHARS + 1) }).technicalStatus, "invalid_input");
});
check("missing/malformed/duplicate metadata and dependencies fail closed", () => {
  invalid((input) => { input.plannedCaseIds = ["mechanical-001", "mechanical-001"]; });
  invalid((input) => { input.dependencies = input.dependencies.slice(1); });
  invalid((input) => { input.dependencies = input.dependencies.map(() => input.dependencies[0]); });
  invalid((input) => { input.protocolDigest = "not-a-digest"; });
  invalid((input) => { input.runtimeIdentity.contextforgeCommit = "unknown"; });
  invalid((input) => { input.dependencies = input.dependencies.map((item) => ({ ...item, disposition: "isolated" })); });
  assert.throws(() => createRealWorldFoundation(null), RealWorldFoundationError);
});
check("real corpus, other algorithms and ready-understanding claims not accepted", () => {
  invalid((input) => { Object.assign(input.sourceBasis, { kind: "local_project" }); });
  invalid((input) => { input.plannedCaseIds = ["CAL-001"]; });
  invalid((input) => { Object.assign(input, { profileId: "human-task-production-equivalent" }); });
  invalid((input) => { Object.assign(input.runtimeIdentity, { intendedEngineMode: "legacy" }); });
  invalid((input) => { Object.assign(input.runtimeIdentity, { intendedPlannerMode: "model_assisted" }); });
  invalid((input) => { Object.assign(input.runtimeIdentity, { understandingAvailability: "fallback" }); });
});
check("arrays reject accessors/sparse/custom iterator/symbol fields", () => {
  let called = 0;
  invalid((input) => { Object.defineProperty(input.plannedCaseIds, "0", { enumerable: true, get: () => { called += 1; return "mechanical-001"; } }); });
  invalid((input) => { input.plannedCaseIds = new Array(3); });
  invalid((input) => { Object.assign(input.plannedCaseIds, { [Symbol.iterator]: () => { called += 1; return [][Symbol.iterator](); } }); });
  invalid((input) => { Object.assign(input, { [Symbol("oracle")]: "private" }); });
  assert.equal(called, 0);
});
check("policy/stage/status registries are immutable", () => {
  assert.ok(Object.isFrozen(REAL_WORLD_EFFECTS));
  assert.ok(Object.isFrozen(REAL_WORLD_STAGES));
  assert.ok(Object.isFrozen(REAL_WORLD_TECHNICAL_STATUSES));
});
check("AST boundary: only local foundation imports; no side-effect primitives", () => {
  for (const name of ["realWorldFoundation", "realWorldTypes"]) {
    // Read only these two repository modules, never an external project or oracle.
    const source = ts.createSourceFile(`${name}.ts`, fs.readFileSync(new URL(`../validation/realWorld/${name}.ts`, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
    const forbidden = new Set(["fetch", "eval", "Function", "require", "process", "globalThis", "setTimeout", "setInterval", "import"]);
    function visit(node: ts.Node): void {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        if (node.moduleSpecifier) assert.ok(ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === "./realWorldTypes.js");
      }
      if (ts.isCallExpression(node)) assert.notEqual(node.expression.kind, ts.SyntaxKind.ImportKeyword);
      if (ts.isIdentifier(node)) assert.ok(!forbidden.has(node.text), `Forbidden primitive: ${node.text}`);
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
});

process.stdout.write(`Real-world foundation smoke passed: ${scenarios} scenarios; zero CE2 invocations.\n`);
