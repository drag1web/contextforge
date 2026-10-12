import { isProxy } from "node:util/types";
import { createInvestigationRunner } from "../application/investigationRunner.js";
import { createFactExtractorRegistry } from "../adapters/extraction/factExtractorRegistry.js";
import { createInMemoryKnowledgeGraphStore } from "../adapters/knowledge/inMemoryKnowledgeGraphStore.js";
import type { InvestigationRunner, InvestigationRunnerDependencies } from "../application/investigationRunnerTypes.js";
import type { FactExtractorPort } from "../ports/factExtractorPort.js";

export interface ProductionInvestigationRunnerAssemblyInput {
  clock: InvestigationRunnerDependencies["clock"];
  cancellation: InvestigationRunnerDependencies["cancellation"];
  repositoryReader: InvestigationRunnerDependencies["repositoryReader"];
  repositorySearch: InvestigationRunnerDependencies["repositorySearch"];
  extractors: readonly FactExtractorPort[];
  actionPlanner?: InvestigationRunnerDependencies["actionPlanner"];
  plannerSignal?: AbortSignal;
}

export class InvestigationRunnerAssemblyDependencyError extends Error {
  readonly code = "investigation_assembly_dependency_invalid" as const;
  constructor() {
    super("investigation_assembly_dependency_invalid");
    this.name = "InvestigationRunnerAssemblyDependencyError";
  }
}

function invalid(): never { throw new InvestigationRunnerAssemblyDependencyError(); }

// Native Proxy detection precedes reflection, including on prototypes. This is
// constructor admission under trusted intrinsics, NOT a sandbox or port trust.
function ordinaryObject(value: unknown): object {
  if (!value || typeof value !== "object" || isProxy(value)) invalid();
  let current: object | null = value;
  for (let depth = 0; current; depth += 1) {
    if (depth >= 64 || isProxy(current)) invalid();
    current = Object.getPrototypeOf(current);
  }
  return value;
}

function dataProperty(value: object, key: string): unknown {
  for (let current: object | null = value; current; current = Object.getPrototypeOf(current)) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) {
      if (!("value" in descriptor)) invalid();
      return descriptor.value;
    }
  }
  invalid();
}

function port(value: unknown, methods: readonly string[]): object {
  const object = ordinaryObject(value);
  for (const method of methods) {
    const candidate = dataProperty(object, method);
    if (typeof candidate !== "function" || isProxy(candidate)) invalid();
  }
  return object;
}

function captureExtractors(value: unknown): FactExtractorPort[] {
  const object = ordinaryObject(value);
  if (!Array.isArray(object) || Object.getPrototypeOf(object) !== Array.prototype) invalid();
  const length = dataProperty(object, "length");
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 1) invalid();
  const keys = Reflect.ownKeys(object);
  if (keys.length !== length + 1) invalid(); // Reject holes, iterators and extra properties.
  const captured: FactExtractorPort[] = [];
  const identities = new Set<string>();
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(object, String(index));
    if (!descriptor || !("value" in descriptor)) invalid();
    const extractor = port(descriptor.value, ["supports", "extract"]);
    const id = dataProperty(extractor, "id");
    const version = dataProperty(extractor, "version");
    if (typeof id !== "string" || !id.trim() || typeof version !== "string" || !version.trim()) invalid();
    const identity = `${id}\0${version}`;
    if (identities.has(identity)) invalid();
    identities.add(identity);
    captured.push(extractor as FactExtractorPort);
  }
  return captured;
}

/**
 * Construct the real production runner without invoking any supplied method.
 * Ports remain external execution capabilities; admission does not authorize run().
 * No extractor implementation, source acquisition or configured provider is loaded.
 * Caller mutation after construction is not prevented: future execution must own
 * and authorize the complete port lifetime (including the genuine TS compiler).
 */
export function createProductionInvestigationRunner(
  input: ProductionInvestigationRunnerAssemblyInput,
): InvestigationRunner {
  const packet = ordinaryObject(input);
  const prototype = Object.getPrototypeOf(packet);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const allowed = new Set(["clock", "cancellation", "repositoryReader", "repositorySearch", "extractors", "actionPlanner", "plannerSignal"]);
  const captured = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(packet)) {
    if (typeof key !== "string" || !allowed.has(key)) invalid();
    const descriptor = Object.getOwnPropertyDescriptor(packet, key)!;
    if (!("value" in descriptor) || !descriptor.enumerable) invalid();
    captured[key] = descriptor.value;
  }
  port(captured.clock, ["nowIso", "monotonicMs"]);
  port(captured.cancellation, ["isCancellationRequested"]);
  port(captured.repositoryReader, ["readFile", "readRange"]);
  port(captured.repositorySearch, ["searchPaths", "searchText", "searchSymbols"]);
  const extractors = captureExtractors(captured.extractors);
  if (captured.actionPlanner !== undefined) port(captured.actionPlanner, ["proposeNextOperations"]);
  if (captured.plannerSignal !== undefined) {
    const signal = ordinaryObject(captured.plannerSignal);
    // Shape/prototype admission only, not native-brand or authority verification.
    if (!(signal instanceof AbortSignal)) invalid();
  }
  const dependencies = captured as unknown as ProductionInvestigationRunnerAssemblyInput;
  return createInvestigationRunner({
    clock: dependencies.clock,
    cancellation: dependencies.cancellation,
    repositoryReader: dependencies.repositoryReader,
    repositorySearch: dependencies.repositorySearch,
    factExtractor: createFactExtractorRegistry(extractors),
    graphStore: createInMemoryKnowledgeGraphStore(),
    planner: undefined,
    actionPlanner: dependencies.actionPlanner,
    plannerSignal: dependencies.plannerSignal,
  });
}
