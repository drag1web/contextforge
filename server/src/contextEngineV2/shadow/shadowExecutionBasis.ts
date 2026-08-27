import { createHash } from "node:crypto";

import type {
  ContextEngineShadowExecutionBasis,
  ContextEngineShadowPolicy,
} from "./shadowTypes.js";
import type { ContextEnginePlannerMode } from "../contracts/index.js";
import {
  isContextEnginePlannerIdentifier,
  plannerIdentifierForMode,
} from "../planner/plannerMode.js";

const POLICY_BUDGET_KEYS = [
  "maxOperations", "maxFileReads", "maxFileBytes", "maxParsedFiles",
  "maxRelationshipHops", "maxWallTimeMs", "maxPlannerRounds",
  "maxConcurrentOperations",
] as const;

export const DEFAULT_CONTEXT_ENGINE_SHADOW_POLICY: ContextEngineShadowPolicy = Object.freeze({
  budget: Object.freeze({
    maxOperations: 20,
    maxFileReads: 8,
    maxFileBytes: 512_000,
    maxParsedFiles: 6,
    maxRelationshipHops: 12,
    maxWallTimeMs: 1_500,
    maxPlannerRounds: 10,
    maxConcurrentOperations: 1,
  }),
  timeoutMs: 1_750,
  maxHistoryRecords: 50,
});

const DEFAULT_PLANNER_POLICY = Object.freeze({
  maxOperationsPerRound: 1,
  searchResultLimit: 20,
  maxFailedOperationRetries: 1,
});
const EXTRACTOR_REGISTRY_IDENTIFIER = "typescript-javascript+package-manifest-v1";

function fail(): never {
  throw new Error("canonical_input_mismatch");
}

function assertPlainClosed(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== "string")) fail();
  for (const descriptor of Object.values(descriptors)) {
    if (descriptor.get || descriptor.set || !("value" in descriptor) || !descriptor.enumerable) fail();
  }
  const actual = Object.keys(descriptors).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail();
}

function assertSafeInteger(value: unknown, minimum: number, maximum: number): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) fail();
}

function assertPortableConfigurationValue(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > 120 || /[\u0000-\u001f\u007f]/u.test(value)) fail();
}

export function assertContextEngineShadowExecutionBasis(
  value: unknown,
): asserts value is ContextEngineShadowExecutionBasis {
  assertPlainClosed(value, [
    "policy", "requestedTaskType", "effectiveTaskArea", "plannerIdentifier",
    "plannerPolicy", "extractorRegistryIdentifier",
  ]);
  assertPlainClosed(value.policy, ["budget", "timeoutMs", "maxHistoryRecords"]);
  assertPlainClosed(value.policy.budget, POLICY_BUDGET_KEYS);
  for (const key of POLICY_BUDGET_KEYS) {
    assertSafeInteger(value.policy.budget[key], key === "maxConcurrentOperations" ? 1 : 0, 10_000_000);
  }
  assertSafeInteger(value.policy.timeoutMs, 1, 300_000);
  assertSafeInteger(value.policy.maxHistoryRecords, 1, 200);
  assertPortableConfigurationValue(value.requestedTaskType);
  assertPortableConfigurationValue(value.effectiveTaskArea);
  assertPortableConfigurationValue(value.plannerIdentifier);
  assertPortableConfigurationValue(value.extractorRegistryIdentifier);
  if (!isContextEnginePlannerIdentifier(value.plannerIdentifier) ||
      value.extractorRegistryIdentifier !== EXTRACTOR_REGISTRY_IDENTIFIER) fail();
  assertPlainClosed(value.plannerPolicy, [
    "maxOperationsPerRound", "searchResultLimit", "maxFailedOperationRetries",
  ]);
  assertSafeInteger(value.plannerPolicy.maxOperationsPerRound, 1, 1_000);
  assertSafeInteger(value.plannerPolicy.searchResultLimit, 1, 10_000);
  assertSafeInteger(value.plannerPolicy.maxFailedOperationRetries, 0, 100);
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export function createContextEngineShadowExecutionBasis(input: {
  policy?: ContextEngineShadowPolicy;
  requestedTaskType: string;
  effectiveTaskArea: string;
  plannerMode?: ContextEnginePlannerMode;
}): ContextEngineShadowExecutionBasis {
  const policy = input.policy ?? DEFAULT_CONTEXT_ENGINE_SHADOW_POLICY;
  return normalizeContextEngineShadowExecutionBasis({
    policy: {
      budget: { ...policy.budget },
      timeoutMs: policy.timeoutMs,
      maxHistoryRecords: policy.maxHistoryRecords,
    },
    requestedTaskType: input.requestedTaskType,
    effectiveTaskArea: input.effectiveTaskArea,
    plannerIdentifier: plannerIdentifierForMode(input.plannerMode ?? "deterministic"),
    plannerPolicy: { ...DEFAULT_PLANNER_POLICY },
    extractorRegistryIdentifier: EXTRACTOR_REGISTRY_IDENTIFIER,
  });
}

export function normalizeContextEngineShadowExecutionBasis(
  value: ContextEngineShadowExecutionBasis,
): ContextEngineShadowExecutionBasis {
  assertContextEngineShadowExecutionBasis(value);
  return freeze({
    policy: {
      budget: Object.fromEntries(POLICY_BUDGET_KEYS.map((key) => [key, value.policy.budget[key]])) as unknown as ContextEngineShadowPolicy["budget"],
      timeoutMs: value.policy.timeoutMs,
      maxHistoryRecords: value.policy.maxHistoryRecords,
    },
    requestedTaskType: value.requestedTaskType,
    effectiveTaskArea: value.effectiveTaskArea,
    plannerIdentifier: value.plannerIdentifier,
    plannerPolicy: {
      maxOperationsPerRound: value.plannerPolicy.maxOperationsPerRound,
      searchResultLimit: value.plannerPolicy.searchResultLimit,
      maxFailedOperationRetries: value.plannerPolicy.maxFailedOperationRetries,
    },
    extractorRegistryIdentifier: value.extractorRegistryIdentifier,
  });
}

export function contextEngineShadowConfigurationFingerprint(
  basis: ContextEngineShadowExecutionBasis,
): string {
  assertContextEngineShadowExecutionBasis(basis);
  const canonical = JSON.stringify({
    policy: {
      budget: Object.fromEntries(POLICY_BUDGET_KEYS.map((key) => [key, basis.policy.budget[key]])),
      timeoutMs: basis.policy.timeoutMs,
      maxHistoryRecords: basis.policy.maxHistoryRecords,
    },
    requestedTaskType: basis.requestedTaskType,
    effectiveTaskArea: basis.effectiveTaskArea,
    plannerIdentifier: basis.plannerIdentifier,
    plannerPolicy: {
      maxOperationsPerRound: basis.plannerPolicy.maxOperationsPerRound,
      searchResultLimit: basis.plannerPolicy.searchResultLimit,
      maxFailedOperationRetries: basis.plannerPolicy.maxFailedOperationRetries,
    },
    extractorRegistryIdentifier: basis.extractorRegistryIdentifier,
  });
  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}
