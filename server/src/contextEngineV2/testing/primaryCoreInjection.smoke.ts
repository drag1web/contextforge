import assert from "node:assert/strict";
import fs from "node:fs";
import * as core from "../retirement/taskPackPrimaryCore.js";
import type { TaskPackPrimaryCoreControls } from "../retirement/taskPackPrimaryCore.js";
import type { TaskPackPrimaryRuntimeDependencies } from "../retirement/retirementTypes.js";
import {
  authorizeSyntheticPrimarySource, createPrimaryReadOnlyBoundary,
  createRestrictedPrimaryCapabilities, createSyntheticPrimarySource, PRIMARY_BOUNDARY_PROFILE,
} from "../validation/realWorld/primaryReadOnlyBoundary.js";
import { inspectPrimaryPolicySource } from "../validation/realWorld/primaryBoundaryPolicy.js";

// Constructors only. Neither the returned service nor any injected callback is invoked.
let scenarios = 0;
let portCalls = 0;
let getterCalls = 0;
function unexpected(): never { portCalls += 1; throw new Error("unexpected_inert_port_call"); }
function check(name: string, run: () => void) {
  run();
  assert.equal(portCalls, 0, "construction_must_not_invoke_ports");
  assert.equal(getterCalls, 0, "construction_must_not_invoke_getters");
  scenarios += 1;
  process.stdout.write(`PASS ${name}\n`);
}
function dependencies(): TaskPackPrimaryRuntimeDependencies {
  return {
    execute: unexpected, nowIso: unexpected, monotonicMs: unexpected,
    tracker: { tryTrack: unexpected, flush: unexpected, close: unexpected, state: unexpected },
  };
}
function controls(): TaskPackPrimaryCoreControls {
  return {
    isPrepared: unexpected, assertCanonicalEquivalent: unexpected, settle: unexpected,
    createProjection: unexpected, createMapping: unexpected,
  };
}
function rejected(deps: unknown, mechanics: unknown): void {
  assert.throws(() => core.createTaskPackPrimaryServiceCore(
    deps as TaskPackPrimaryRuntimeDependencies, mechanics as TaskPackPrimaryCoreControls,
  ), (error: unknown) => error instanceof core.TaskPackPrimaryCoreDependencyError &&
    error.code === "primary_dependency_missing" && error.message === "primary_dependency_missing");
}
check("safe module exports no live runner, default tracker or execution permit", () => {
  assert.deepEqual(Object.keys(core).sort(), ["TaskPackPrimaryCoreDependencyError", "createTaskPackPrimaryServiceCore"]);
});
check("explicit inert DI constructs without investigation, clock, validation, projection or tracking", () => {
  assert.equal(typeof core.createTaskPackPrimaryServiceCore(dependencies(), controls()), "function");
});
check("construction accepts frozen dependencies without mutation", () => {
  const deps = dependencies();
  const mechanics = Object.freeze(controls());
  Object.freeze(deps.tracker);
  Object.freeze(deps);
  assert.equal(typeof core.createTaskPackPrimaryServiceCore(deps, mechanics), "function");
});
check("separate constructions have no shared evaluator service singleton", () => {
  assert.notEqual(core.createTaskPackPrimaryServiceCore(dependencies(), controls()),
    core.createTaskPackPrimaryServiceCore(dependencies(), controls()));
});
check("ordinary prototype-method ports remain compatible without invoking them", () => {
  const deps = dependencies();
  deps.tracker = Object.create(deps.tracker) as typeof deps.tracker;
  assert.equal(typeof core.createTaskPackPrimaryServiceCore(deps, controls()), "function");
});
check("no hidden production projection or mapping default is needed at construction", () => {
  const deps = { ...dependencies(), project: unexpected, map: unexpected };
  core.createTaskPackPrimaryServiceCore(deps, controls());
});
check("absent dependency/control packets fail closed", () => {
  rejected(undefined, controls());
  rejected(dependencies(), undefined);
  rejected(null, controls());
  rejected(dependencies(), null);
});
for (const key of ["execute", "nowIso", "monotonicMs", "tracker"] as const) {
  check(`missing runtime port ${key} rejects construction`, () => {
    const input: Partial<TaskPackPrimaryRuntimeDependencies> = dependencies();
    delete input[key];
    rejected(input, controls());
  });
}
for (const key of ["tryTrack", "flush", "close", "state"] as const) {
  check(`missing tracker method ${key} rejects construction`, () => {
    const input = dependencies();
    delete (input.tracker as Partial<typeof input.tracker>)[key];
    rejected(input, controls());
  });
}
for (const key of ["isPrepared", "assertCanonicalEquivalent", "settle", "createProjection", "createMapping"] as const) {
  check(`missing control ${key} rejects construction`, () => {
    const input: Partial<TaskPackPrimaryCoreControls> = controls();
    delete input[key];
    rejected(dependencies(), input);
  });
}
check("metadata cannot replace a function dependency", () => {
  for (const key of Object.keys(controls())) {
    rejected(dependencies(), { ...controls(), [key]: { isolated: true, readOnly: true } });
  }
  rejected({ ...dependencies(), execute: { isolated: true } }, controls());
});
check("dependency accessors reject without executing getters", () => {
  const input = dependencies();
  Object.defineProperty(input, "execute", { get() { getterCalls += 1; return unexpected; } });
  rejected(input, controls());
  const mechanics = controls();
  Object.defineProperty(mechanics, "settle", { get() { getterCalls += 1; return unexpected; } });
  rejected(dependencies(), mechanics);
});

const policy = inspectPrimaryPolicySource(fs.readFileSync(new URL("../retirement/primaryPolicy.ts", import.meta.url), "utf8"));
function packet() {
  const source = createSyntheticPrimarySource({ kind: "synthetic_in_memory", files: [{ path: "src/inert.ts", content: "// inert data only\n" }] });
  const authorization = authorizeSyntheticPrimarySource({
    source, sourceDigest: source.sourceDigest, scope: "synthetic_boundary_only", approved: true,
    evidenceDigest: `sha256:${"a".repeat(64)}`,
  });
  const capabilities = createRestrictedPrimaryCapabilities({ source, authorization });
  return { profileId: PRIMARY_BOUNDARY_PROFILE, source, sourceDigest: source.sourceDigest, authorization, capabilities, policy, plannerMode: "deterministic" };
}
check("import-safe construction does not unblock production execution admission", () => {
  core.createTaskPackPrimaryServiceCore(dependencies(), controls());
  const result = createPrimaryReadOnlyBoundary().requestPrimaryExecutionPermit(packet());
  assert.equal(result.status, "blocked");
  assert.equal(result.code, "production_adapter_not_connected");
  assert.equal(result.engineInvoked, false);
  assert.equal(result.permit, null);
});
check("source-read permit remains instance-bound after core construction", () => {
  const input = packet();
  const first = createPrimaryReadOnlyBoundary();
  const second = createPrimaryReadOnlyBoundary();
  const result = first.requestSourceReadPermit(input);
  assert.equal(result.status, "source_read_permitted");
  if (result.status !== "source_read_permitted") throw new Error("inert_admission_failed");
  assert.equal(first.readSource(result.permit, "src/inert.ts")?.content, "// inert data only\n");
  assert.throws(() => second.readSource(result.permit, "src/inert.ts"));
  assert.throws(() => first.readSource({ ...result.permit }, "src/inert.ts"));
  assert.equal(first.requestPrimaryExecutionPermit(result.permit).permit, null);
});
check("oracle data cannot turn the existing evaluation admission into a DI executor", () => {
  const boundary = createPrimaryReadOnlyBoundary();
  for (const field of ["oracle", "expectedOwner", "executor"]) {
    const result = boundary.requestPrimaryExecutionPermit({ ...packet(), [field]: field === "executor" ? unexpected : "inert" });
    assert.equal(result.status, "blocked");
    assert.equal(result.permit, null);
    assert.equal(result.engineInvoked, false);
  }
});
process.stdout.write(`Primary core inert injection smoke passed: ${scenarios} scenarios; service invocations 0, dependency callbacks 0, real investigations 0.\n`);
