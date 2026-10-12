import assert from "node:assert/strict";
import * as assembly from "../assembly/productionInvestigationRunner.js";
import type { ProductionInvestigationRunnerAssemblyInput } from "../assembly/productionInvestigationRunner.js";

// Actual production constructors only. NEVER call run, extraction or repository ports.
let calls = 0, getters = 0, traps = 0, scenarios = 0;
function unexpected(): never { calls++; throw new Error("unexpected_constructor_port_call"); }
function getter(): never { getters++; throw new Error("unexpected_constructor_getter"); }
const trap = (): never => { traps++; throw new Error("unexpected_constructor_proxy_trap"); };
function input(): ProductionInvestigationRunnerAssemblyInput {
  return {
    clock: { nowIso: unexpected, monotonicMs: unexpected },
    cancellation: { isCancellationRequested: unexpected },
    repositoryReader: { readFile: unexpected, readRange: unexpected },
    repositorySearch: { searchPaths: unexpected, searchText: unexpected, searchSymbols: unexpected },
    extractors: [
      { id: "z-inert", version: "1", supports: unexpected, extract: unexpected },
      { id: "a-inert", version: "1", supports: unexpected, extract: unexpected },
    ],
  };
}
function construct(value: unknown) { return assembly.createProductionInvestigationRunner(value as ProductionInvestigationRunnerAssemblyInput); }
function reject(value: unknown) {
  assert.throws(() => construct(value), (e: unknown) => e instanceof assembly.InvestigationRunnerAssemblyDependencyError &&
    e.code === "investigation_assembly_dependency_invalid" && e.message === e.code);
}
function check(name: string, test: () => void) {
  test(); assert.equal(calls, 0); assert.equal(getters, 0); assert.equal(traps, 0);
  scenarios++; process.stdout.write(`PASS ${name}\n`);
}
check("safe entry exports only constructor and safe admission error", () => {
  assert.deepEqual(Object.keys(assembly).sort(), ["InvestigationRunnerAssemblyDependencyError", "createProductionInvestigationRunner"]);
});
check("real production runner contract constructed without invoking any port", () => {
  const runner = construct(input()); assert.deepEqual(Object.keys(runner), ["run"]); assert.equal(typeof runner.run, "function");
});
check("separate construction returns distinct actual runners, per-call graph wiring verified by static smoke", () => {
  assert.notEqual(construct(input()), construct(input()));
});
check("caller input and extractor order remain unchanged and unfrozen", () => {
  const value = input(), array = value.extractors, objects = [...array];
  construct(value); assert.equal(value.extractors, array); assert.deepEqual(array, objects);
  assert.equal(Object.isFrozen(value), false); assert.equal(Object.isFrozen(array), false);
});
check("frozen caller data remains compatible without mutation", () => {
  const value = input(); value.extractors.forEach(Object.freeze); Object.freeze(value.extractors);
  Object.freeze(value.clock); construct(Object.freeze(value));
});
check("optional action planner and real signal are accepted without calls", () => {
  construct({ ...input(), actionPlanner: { proposeNextOperations: unexpected }, plannerSignal: new AbortController().signal });
});
check("explicit undefined optional fields preserve deterministic construction", () => {
  construct({ ...input(), actionPlanner: undefined, plannerSignal: undefined });
});
check("ordinary prototype-method ports remain production compatible", () => {
  const value = input(); value.clock = Object.create(value.clock); construct(value);
});
check("absent non-object and array packets fail closed", () => {
  for (const value of [undefined, null, 0, "isolated", [], unexpected]) reject(value);
});
for (const key of ["clock", "cancellation", "repositoryReader", "repositorySearch", "extractors"] as const) {
  check(`missing required ${key} rejects construction`, () => { const value = { ...input() }; delete (value as Partial<typeof value>)[key]; reject(value); });
  check(`accessor required ${key} rejected without invocation`, () => { const value = input(); Object.defineProperty(value, key, { get: getter, enumerable: true }); reject(value); });
}
for (const [port, method] of [["clock", "nowIso"], ["clock", "monotonicMs"], ["cancellation", "isCancellationRequested"],
  ["repositoryReader", "readFile"], ["repositoryReader", "readRange"], ["repositorySearch", "searchPaths"],
  ["repositorySearch", "searchText"], ["repositorySearch", "searchSymbols"]] as const) {
  check(`malformed or accessor ${port}.${method} rejects before calls`, () => {
    const value = input(); Object.defineProperty(value[port], method, { value: "isolated", configurable: true }); reject(value);
    Object.defineProperty(value[port], method, { get: getter }); reject(value);
  });
}
for (const key of ["oracle", "expectedOwner", "projectRoot", "provider", "isolated"] as const) {
  check(`unknown authority or evaluator field ${key} rejected`, () => reject({ ...input(), [key]: "inert-private-sentinel" }));
}
check("symbol and non-enumerable packet fields rejected", () => {
  reject({ ...input(), [Symbol("oracle")]: true }); const value = input(); Object.defineProperty(value, "clock", { enumerable: false }); reject(value);
});
check("inherited packet fields do not silently grant capabilities", () => reject(Object.create(input())));
for (const key of ["id", "version", "supports", "extract"] as const) {
  check(`extractor ${key} accessor rejected before registry metadata reads`, () => {
    const value = input(); Object.defineProperty(value.extractors[0], key, { get: getter }); reject(value);
  });
}
check("missing and malformed extractor metadata/methods rejected", () => {
  for (const key of ["id", "version", "supports", "extract"]) {
    for (const replacement of [undefined, null, 0, {}]) {
      const value = input(); Object.defineProperty(value.extractors[0], key, { value: replacement }); reject(value);
    }
  }
  for (const id of ["", " \t\r\n"]) { const value = input(); Object.defineProperty(value.extractors[0], "id", { value: id }); reject(value); }
});
check("duplicate registry identity uses constant sanitized admission error", () => {
  const value = input(); value.extractors = [value.extractors[0], value.extractors[0]]; reject(value);
});
check("empty sparse and accessor extractor arrays rejected", () => {
  reject({ ...input(), extractors: [] }); reject({ ...input(), extractors: new Array(2) });
  const value = input(); Object.defineProperty(value.extractors, "0", { get: getter }); reject(value);
});
check("custom extractor iterators and extra array fields are never invoked", () => {
  const value = input(); Object.defineProperty(value.extractors, Symbol.iterator, { value: unexpected }); reject(value);
  reject({ ...input(), extractors: Object.assign([...input().extractors], { extra: true }) });
});
check("Proxy packet rejected before any reflective trap", () => reject(new Proxy(input(), { get: trap, getPrototypeOf: trap, ownKeys: trap, getOwnPropertyDescriptor: trap })));
check("revoked Proxy rejected without invoking traps", () => { const proxy = Proxy.revocable(input(), {}); proxy.revoke(); reject(proxy.proxy); });
check("Proxy port and Proxy prototype rejected", () => {
  const value = input(); value.clock = new Proxy(value.clock, { get: trap, getPrototypeOf: trap }); reject(value);
  value.clock = Object.create(new Proxy({}, { getPrototypeOf: trap, getOwnPropertyDescriptor: trap })); reject(value);
});
check("Proxy function rejected without execution", () => {
  const value = input(); value.clock.nowIso = new Proxy(unexpected, { apply: trap, get: trap }); reject(value);
});
check("Proxy array and extractor rejected before metadata or iterator access", () => {
  reject({ ...input(), extractors: new Proxy(input().extractors, { get: trap, getPrototypeOf: trap }) });
  reject({ ...input(), extractors: [new Proxy(input().extractors[0], { get: trap, getOwnPropertyDescriptor: trap })] });
});
check("optional planner method and packet accessors rejected", () => {
  reject({ ...input(), actionPlanner: {} }); const planner = {}; Object.defineProperty(planner, "proposeNextOperations", { get: getter });
  reject({ ...input(), actionPlanner: planner }); const value = input(); Object.defineProperty(value, "plannerSignal", { get: getter, enumerable: true }); reject(value);
});
check("malformed and Proxy signals rejected; no signal getter polled", () => {
  reject({ ...input(), plannerSignal: {} }); reject({ ...input(), plannerSignal: new Proxy(new AbortController().signal, { get: trap, getPrototypeOf: trap }) });
});
check("signal prototype check is not native-brand authority: forged shape remains an execution blocker", () => {
  // Explicit limitation: accepted shape is not proof of a trusted live signal.
  construct({ ...input(), plannerSignal: Object.create(AbortSignal.prototype) });
});
check("post-construction caller mutation is not claimed safe for later execution", () => {
  const value = input(); construct(value); value.clock.nowIso = unexpected; Object.defineProperty(value.extractors[0], "id", { get: getter });
  // Never execute the returned runner; lifetime/authority remains unresolved.
});
process.stdout.write(`Production runner inert construction smoke passed: ${scenarios} scenarios; port calls=${calls}; getter calls=${getters}; Proxy traps=${traps}; runner.run calls=0.\n`);
