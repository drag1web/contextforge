import { createHash } from "node:crypto";
import path from "node:path";

import { adaptLegacyInventoryToRepositorySnapshot } from "../adapters/legacyInventory/legacyInventorySnapshotAdapter.js";
import type {
  ExplicitTargetConstraint,
  InvestigationBudget,
  NegativeConstraint,
  RepositorySnapshot,
} from "../contracts/index.js";
import type { ProjectInventory } from "../../scanner/projectInventoryScanner.js";
import type {
  ContextComposerCanonicalExecutionInput,
  ContextComposerExecutionBasis,
} from "./composerTypes.js";
import type { ContextEnginePlannerMode } from "../contracts/index.js";
import type { ModelPlannerObservation } from "../contracts/index.js";
import type { ModelPlannerPort } from "../ports/index.js";
import type { ModelPlannerRequestTracker } from "../planner/index.js";

export const DEFAULT_CONTEXT_COMPOSER_V2_BUDGET: Readonly<InvestigationBudget> = Object.freeze({
  maxOperations: 18,
  maxFileReads: 7,
  maxFileBytes: 384_000,
  maxParsedFiles: 5,
  maxRelationshipHops: 12,
  maxWallTimeMs: 1_250,
  maxPlannerRounds: 9,
  maxConcurrentOperations: 1,
});
export const DEFAULT_CONTEXT_COMPOSER_V2_TIMEOUT_MS = 1_500;

export const CONTEXT_COMPOSER_PLANNER_IDENTIFIER =
  "deterministic-investigation-planner:v1";
export const CONTEXT_COMPOSER_MODEL_PLANNER_IDENTIFIER =
  "model-assisted-investigation-planner:v1";
export const CONTEXT_COMPOSER_EXTRACTOR_REGISTRY_IDENTIFIER = "typescript-javascript-manifest:v1";
export const CONTEXT_COMPOSER_PLANNER_POLICY = Object.freeze({
  maxOperationsPerRound: 1,
  searchResultLimit: 20,
  maxFailedOperationRetries: 1,
});

const BUDGET_FIELDS = [
  "maxOperations",
  "maxFileReads",
  "maxFileBytes",
  "maxParsedFiles",
  "maxRelationshipHops",
  "maxWallTimeMs",
  "maxPlannerRounds",
  "maxConcurrentOperations",
] as const;
const preparedInputs = new WeakSet<object>();

function fail(): never {
  throw new Error("canonical_input_mismatch");
}

function hash(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function record(value: unknown, fields?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== "string")) fail();
  for (const descriptor of Object.values(descriptors)) {
    if (descriptor.get || descriptor.set || !("value" in descriptor) || !descriptor.enumerable) fail();
  }
  if (fields) {
    const actual = Object.keys(descriptors).sort();
    const expected = [...fields].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail();
  }
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
}

function denseArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) fail();
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) fail();
  }
  return value;
}

function safeText(value: unknown, maximum = 300): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) fail();
  return value.trim();
}

function clonePlainData<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || value === undefined || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail();
    return value;
  }
  if (typeof value !== "object" || seen.has(value)) fail();
  seen.add(value);
  if (Array.isArray(value)) {
    const output = denseArray(value).map((entry) => clonePlainData(entry, seen));
    seen.delete(value);
    return output as T;
  }
  const source = record(value);
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) output[key] = clonePlainData(source[key], seen);
  seen.delete(value);
  return output as T;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function stableSerialize(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail();
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${denseArray(value).map(stableSerialize).join(",")}]`;
  const source = record(value);
  return `{${Object.keys(source).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(source[key])}`).join(",")}}`;
}

function normalizePath(value: string): string | null {
  const normalized = value.replace(/\\/gu, "/").replace(/^\.\//u, "").trim();
  if (!normalized || normalized.startsWith("/") || /^[a-z]:/iu.test(normalized) || normalized.split("/").some((part) => !part || part === "..")) return null;
  return normalized;
}

function uniqueSorted<T>(values: readonly T[], key: (value: T) => string): T[] {
  return [...new Map(values.map((value) => [key(value), value])).values()]
    .sort((left, right) => key(left).localeCompare(key(right)));
}

export interface ContextComposerStructuredTarget {
  kind: string;
  value: string;
  path?: string;
  name?: string;
  provenance?: string;
}

export interface ContextComposerV2ExecutionInput {
  projectId: string;
  projectRoot: string;
  inventory: ProjectInventory;
  normalizedTask: string;
  structuredTargets: readonly ContextComposerStructuredTarget[];
  protectedScopes: readonly string[];
  requestedTaskType: string;
  effectiveTaskArea: string;
  budget?: InvestigationBudget;
  timeoutMs?: number;
  tracker?: import("./composerExecutionTracker.js").ContextComposerExecutionTracker;
  plannerMode?: ContextEnginePlannerMode;
  modelPlanner?: ModelPlannerPort;
  modelPlannerTracker?: ModelPlannerRequestTracker;
  observeModelPlanner?: (observation: ModelPlannerObservation) => void;
}

export function deriveContextComposerExplicitTargets(
  targets: readonly ContextComposerStructuredTarget[],
): ExplicitTargetConstraint[] {
  const result: ExplicitTargetConstraint[] = [];
  for (const targetValue of denseArray(targets)) {
    const target = record(targetValue, ["kind", "value", ...Object.keys(record(targetValue)).filter((key) => ["path", "name", "provenance"].includes(key))]);
    if (typeof target.kind !== "string" || typeof target.value !== "string" ||
        !["user_confirmed", "inventory_exact"].includes(typeof target.provenance === "string" ? target.provenance : "")) continue;
    const targetPath = typeof target.path === "string" ? normalizePath(target.path) : null;
    if (targetPath) result.push({ kind: "path", path: targetPath });
    else if (["symbol", "component", "entity", "service"].includes(target.kind)) {
      const symbol = (typeof target.name === "string" ? target.name : target.value).trim();
      if (symbol) result.push({ kind: "symbol", symbol });
    }
  }
  return uniqueSorted(result, (target) => target.kind === "path" ? `path:${target.path}` : `symbol:${target.symbol}`);
}

export function deriveContextComposerNegativeConstraints(scopes: readonly string[]): NegativeConstraint[] {
  const result: NegativeConstraint[] = [];
  for (const raw of denseArray(scopes)) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    const pathValue = normalizePath(raw);
    const isPath = pathValue && (/[/*?]/u.test(pathValue) || /\.[a-z0-9]+$/iu.test(pathValue));
    result.push(isPath
      ? { kind: "path", pattern: pathValue }
      : { kind: "semantic", description: raw.trim().slice(0, 300) });
  }
  return uniqueSorted(result, (constraint) => constraint.kind === "path" ? `path:${constraint.pattern}` : `semantic:${constraint.description}`);
}

function normalizeBudget(value: InvestigationBudget | undefined): Readonly<InvestigationBudget> {
  const source = value === undefined ? DEFAULT_CONTEXT_COMPOSER_V2_BUDGET : record(value, BUDGET_FIELDS);
  const output = Object.fromEntries(BUDGET_FIELDS.map((field) => {
    const fieldValue = source[field];
    if (!Number.isSafeInteger(fieldValue) || (fieldValue as number) < 0) fail();
    return [field, fieldValue];
  })) as unknown as InvestigationBudget;
  return deepFreeze(output);
}

function normalizeExecutionBasis(input: ContextComposerV2ExecutionInput): ContextComposerExecutionBasis {
  const timeoutMs = input.timeoutMs ?? DEFAULT_CONTEXT_COMPOSER_V2_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000) fail();
  return deepFreeze({
    schemaVersion: 1,
    policy: { budget: normalizeBudget(input.budget), timeoutMs },
    requestedTaskType: safeText(input.requestedTaskType, 120),
    effectiveTaskArea: safeText(input.effectiveTaskArea, 120),
    plannerIdentifier: input.plannerMode === "model_assisted"
      ? CONTEXT_COMPOSER_MODEL_PLANNER_IDENTIFIER
      : CONTEXT_COMPOSER_PLANNER_IDENTIFIER,
    plannerPolicy: { ...CONTEXT_COMPOSER_PLANNER_POLICY },
    extractorRegistryIdentifier: CONTEXT_COMPOSER_EXTRACTOR_REGISTRY_IDENTIFIER,
  });
}

function assertExecutionBasis(value: unknown): asserts value is ContextComposerExecutionBasis {
  const basis = record(value, ["schemaVersion", "policy", "requestedTaskType", "effectiveTaskArea", "plannerIdentifier", "plannerPolicy", "extractorRegistryIdentifier"]);
  if (basis.schemaVersion !== 1 ||
      (basis.plannerIdentifier !== CONTEXT_COMPOSER_PLANNER_IDENTIFIER &&
       basis.plannerIdentifier !== CONTEXT_COMPOSER_MODEL_PLANNER_IDENTIFIER) ||
      basis.extractorRegistryIdentifier !== CONTEXT_COMPOSER_EXTRACTOR_REGISTRY_IDENTIFIER) fail();
  safeText(basis.requestedTaskType, 120);
  safeText(basis.effectiveTaskArea, 120);
  const policy = record(basis.policy, ["budget", "timeoutMs"]);
  normalizeBudget(policy.budget as InvestigationBudget);
  if (!Number.isSafeInteger(policy.timeoutMs) || (policy.timeoutMs as number) < 1 || (policy.timeoutMs as number) > 10_000) fail();
  const planner = record(basis.plannerPolicy, ["maxOperationsPerRound", "searchResultLimit", "maxFailedOperationRetries"]);
  if (stableSerialize(planner) !== stableSerialize(CONTEXT_COMPOSER_PLANNER_POLICY)) fail();
}

function projectRootUri(projectId: string): string {
  return `repository://project/${createHash("sha256").update(projectId, "utf8").digest("hex").slice(0, 24)}`;
}

function rebuildSnapshot(input: ContextComposerCanonicalExecutionInput): RepositorySnapshot {
  return adaptLegacyInventoryToRepositorySnapshot({
    inventory: input.inventory,
    projectId: input.projectId,
    rootUri: input.snapshot.rootUri,
    createdAt: input.snapshot.createdAt,
    excludedPatterns: input.negativeConstraints.flatMap((constraint) => constraint.kind === "path" ? [constraint.pattern] : []),
  });
}

function snapshotsEquivalent(left: RepositorySnapshot, right: RepositorySnapshot): boolean {
  return left.id === right.id && left.projectId === right.projectId && left.rootUri === right.rootUri &&
    left.rootFingerprint === right.rootFingerprint && stableSerialize(left.files) === stableSerialize(right.files) &&
    stableSerialize(left.limits) === stableSerialize(right.limits) && stableSerialize(left.truncation) === stableSerialize(right.truncation);
}

export function prepareContextComposerCanonicalInput(input: ContextComposerV2ExecutionInput): ContextComposerCanonicalExecutionInput {
  record(input, ["projectId", "projectRoot", "inventory", "normalizedTask", "structuredTargets", "protectedScopes", "requestedTaskType", "effectiveTaskArea", ...Object.keys(record(input)).filter((key) => ["budget", "timeoutMs", "tracker", "plannerMode", "modelPlanner", "modelPlannerTracker", "observeModelPlanner"].includes(key))]);
  const projectId = safeText(input.projectId, 160);
  const projectRoot = safeText(input.projectRoot, 1_000);
  const inventory = deepFreeze(clonePlainData(input.inventory));
  if (path.resolve(projectRoot) !== path.resolve(safeText(inventory.rootPath, 1_000))) fail();
  const normalizedTask = input.normalizedTask.replace(/\r\n/gu, "\n").trim();
  if (!normalizedTask || /## User Clarifications|User answer:|Question:/iu.test(normalizedTask)) throw new Error("invalid_composer_semantic_task");
  const explicitTargets = deepFreeze(clonePlainData(deriveContextComposerExplicitTargets(input.structuredTargets)));
  const negativeConstraints = deepFreeze(clonePlainData(deriveContextComposerNegativeConstraints(input.protectedScopes)));
  const executionBasis = normalizeExecutionBasis(input);
  const snapshot = deepFreeze(adaptLegacyInventoryToRepositorySnapshot({
    inventory,
    projectId,
    rootUri: projectRootUri(projectId),
    createdAt: new Date().toISOString(),
    excludedPatterns: negativeConstraints.flatMap((constraint) => constraint.kind === "path" ? [constraint.pattern] : []),
  }));
  const prepared = deepFreeze({
    schemaVersion: 1 as const,
    projectId,
    projectRoot,
    inventory,
    snapshot,
    normalizedTask,
    explicitTargets,
    negativeConstraints,
    executionBasis,
    taskFingerprint: hash(normalizedTask),
    constraintFingerprint: hash(stableSerialize({ explicitTargets, negativeConstraints })),
    inventoryFingerprint: hash(stableSerialize(inventory)),
    snapshotFingerprint: hash(snapshot.rootFingerprint),
    configurationFingerprint: hash(stableSerialize(executionBasis)),
  });
  preparedInputs.add(prepared);
  return prepared;
}

export function assertContextComposerCanonicalInput(input: ContextComposerCanonicalExecutionInput): void {
  record(input, ["schemaVersion", "projectId", "projectRoot", "inventory", "snapshot", "normalizedTask", "explicitTargets", "negativeConstraints", "executionBasis", "taskFingerprint", "constraintFingerprint", "inventoryFingerprint", "snapshotFingerprint", "configurationFingerprint"]);
  if (input.schemaVersion !== 1) fail();
  assertExecutionBasis(input.executionBasis);
  if (path.resolve(input.projectRoot) !== path.resolve(input.inventory.rootPath)) fail();
  const rebuilt = rebuildSnapshot(input);
  if (
    input.snapshot.projectId !== input.projectId ||
    !snapshotsEquivalent(input.snapshot, rebuilt) ||
    input.taskFingerprint !== hash(input.normalizedTask) ||
    input.constraintFingerprint !== hash(stableSerialize({ explicitTargets: input.explicitTargets, negativeConstraints: input.negativeConstraints })) ||
    input.inventoryFingerprint !== hash(stableSerialize(input.inventory)) ||
    input.snapshotFingerprint !== hash(input.snapshot.rootFingerprint) ||
    input.configurationFingerprint !== hash(stableSerialize(input.executionBasis)) ||
    !preparedInputs.has(input)
  ) fail();
}

export function contextComposerStableSerialize(value: unknown): string {
  return stableSerialize(value);
}

export function contextComposerSnapshotsEquivalent(left: RepositorySnapshot, right: RepositorySnapshot): boolean {
  return snapshotsEquivalent(left, right);
}
