import { createHash } from "node:crypto";
import path from "node:path";

import { adaptLegacyInventoryToRepositorySnapshot } from "../adapters/legacyInventory/index.js";
import type {
  ExplicitTargetConstraint,
  NegativeConstraint,
} from "../contracts/index.js";
import type { ProjectInventory } from "../../scanner/projectInventoryScanner.js";
import type {
  ContextEngineShadowCanonicalInput,
  ContextEngineShadowExecutionBasis,
} from "./shadowTypes.js";
import {
  assertContextEngineShadowExecutionBasis,
  contextEngineShadowConfigurationFingerprint,
  normalizeContextEngineShadowExecutionBasis,
} from "./shadowExecutionBasis.js";

export interface ShadowStructuredTarget {
  kind: string;
  value: string;
  path?: string;
  name?: string;
  provenance?: string;
}

export interface PrepareContextEngineShadowInput {
  projectId: string;
  projectRoot: string;
  inventory: ProjectInventory;
  normalizedTask: string;
  clarificationBasis?: readonly { questionId: string; answer: string }[];
  structuredTargets: readonly ShadowStructuredTarget[];
  protectedScopes: readonly string[];
  executionBasis: ContextEngineShadowExecutionBasis;
  createdAt: string;
}

const preparedCanonicalInputs = new WeakSet<object>();

export function isPreparedContextEngineShadowInput(
  value: ContextEngineShadowCanonicalInput,
): boolean {
  return preparedCanonicalInputs.has(value);
}

function hash(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function normalizePath(value: string): string | null {
  const normalized = value.replace(/\\/gu, "/").replace(/^\.\//u, "").trim();
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[a-z]:/iu.test(normalized) ||
    normalized.split("/").some((segment) => !segment || segment === "..")
  ) {
    return null;
  }
  return normalized;
}

function uniqueSorted<T>(values: readonly T[], key: (value: T) => string): T[] {
  return [...new Map(values.map((value) => [key(value), value])).values()]
    .sort((left, right) => key(left).localeCompare(key(right)));
}

export function deriveShadowExplicitTargets(
  targets: readonly ShadowStructuredTarget[],
): ExplicitTargetConstraint[] {
  const result: ExplicitTargetConstraint[] = [];
  for (const target of targets) {
    if (!target || !["user_confirmed", "inventory_exact"].includes(target.provenance ?? "")) {
      continue;
    }
    const targetPath = target.path === undefined ? null : normalizePath(target.path);
    if (targetPath) {
      result.push({ kind: "path", path: targetPath });
      continue;
    }
    if (
      ["symbol", "component", "entity", "service"].includes(target.kind) &&
      typeof (target.name ?? target.value) === "string" &&
      (target.name ?? target.value).trim()
    ) {
      result.push({ kind: "symbol", symbol: (target.name ?? target.value).trim() });
    }
  }
  return uniqueSorted(result, (target) =>
    target.kind === "path" ? `path:${target.path}` : `symbol:${target.symbol}`,
  );
}

export function deriveShadowNegativeConstraints(
  protectedScopes: readonly string[],
): NegativeConstraint[] {
  const constraints: NegativeConstraint[] = [];
  for (const scope of protectedScopes) {
    if (typeof scope !== "string" || !scope.trim()) continue;
    const normalized = normalizePath(scope);
    const pathLike = normalized && (/[/*?]/u.test(normalized) || /\.[a-z0-9]+$/iu.test(normalized));
    constraints.push(pathLike
      ? { kind: "path", pattern: normalized }
      : { kind: "semantic", description: scope.trim().slice(0, 300) });
  }
  return uniqueSorted(
    constraints,
    (constraint) =>
      constraint.kind === "path"
        ? `path:${constraint.pattern}`
        : `semantic:${constraint.description}`,
  );
}

function inventoryBasis(inventory: ProjectInventory): string {
  return JSON.stringify({
    totalFiles: inventory.totalFiles,
    scannedFiles: inventory.scannedFiles,
    truncated: inventory.truncated,
    files: inventory.files
      .map((file) => ({
        path: file.path.replace(/\\/gu, "/"),
        sizeBytes: file.sizeBytes,
        readable: file.canReadText,
        generated: file.isLikelyGenerated,
        kind: file.kind,
        imports: [...(file.imports ?? [])].sort(),
        exports: [...(file.exports ?? [])].sort(),
        symbols: [...(file.symbols ?? [])].sort(),
      }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  });
}

export function prepareContextEngineShadowInput(
  input: PrepareContextEngineShadowInput,
): ContextEngineShadowCanonicalInput {
  assertContextEngineShadowExecutionBasis(input.executionBasis);
  const executionBasis = normalizeContextEngineShadowExecutionBasis(input.executionBasis);
  if (
    typeof input.projectRoot !== "string" ||
    typeof input.inventory.rootPath !== "string" ||
    path.resolve(input.projectRoot) !== path.resolve(input.inventory.rootPath)
  ) {
    throw new Error("canonical_input_mismatch");
  }
  const normalizedTask = input.normalizedTask.replace(/\r\n/gu, "\n").trim();
  if (!normalizedTask || /## User Clarifications|User answer:|Question:/iu.test(normalizedTask)) {
    throw new Error("Canonical shadow task must be backend-owned semantic input.");
  }
  const explicitTargets = deriveShadowExplicitTargets(input.structuredTargets);
  const negativeConstraints = deriveShadowNegativeConstraints(input.protectedScopes);
  const clarificationBasis = [...(input.clarificationBasis ?? [])]
    .map((item) => ({ questionId: item.questionId.trim(), answer: item.answer.trim() }))
    .sort((left, right) => left.questionId.localeCompare(right.questionId));
  const projectKey = createHash("sha256").update(input.projectId, "utf8").digest("hex").slice(0, 24);
  const snapshot = adaptLegacyInventoryToRepositorySnapshot({
    inventory: input.inventory,
    projectId: input.projectId,
    rootUri: `repository://project/${projectKey}`,
    createdAt: input.createdAt,
    excludedPatterns: negativeConstraints
      .filter((constraint): constraint is Extract<NegativeConstraint, { kind: "path" }> => constraint.kind === "path")
      .map((constraint) => constraint.pattern),
  });
  const prepared = Object.freeze({
    projectId: input.projectId,
    projectRoot: input.projectRoot,
    inventory: input.inventory,
    normalizedTask,
    clarificationBasis: Object.freeze(clarificationBasis),
    explicitTargets: Object.freeze(explicitTargets) as unknown as ExplicitTargetConstraint[],
    negativeConstraints: Object.freeze(negativeConstraints) as unknown as NegativeConstraint[],
    snapshot,
    taskFingerprint: hash(normalizedTask),
    clarificationFingerprint: hash(JSON.stringify({
      clarificationBasis,
      explicitTargets,
      negativeConstraints,
    })),
    inventoryFingerprint: hash(inventoryBasis(input.inventory)),
    snapshotFingerprint: hash(snapshot.rootFingerprint),
    configurationFingerprint: contextEngineShadowConfigurationFingerprint(executionBasis),
    executionBasis,
  });
  preparedCanonicalInputs.add(prepared);
  return prepared;
}

export function assertContextEngineShadowInputEquivalent(
  input: ContextEngineShadowCanonicalInput,
): void {
  assertContextEngineShadowExecutionBasis(input.executionBasis);
  const taskFingerprint = hash(input.normalizedTask.replace(/\r\n/gu, "\n").trim());
  const clarificationFingerprint = hash(JSON.stringify({
    clarificationBasis: [...input.clarificationBasis].sort(
      (left, right) => left.questionId.localeCompare(right.questionId),
    ),
    explicitTargets: [...input.explicitTargets].sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right))),
    negativeConstraints: [...input.negativeConstraints].sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right))),
  }));
  const inventoryFingerprint = hash(inventoryBasis(input.inventory));
  const snapshotFingerprint = hash(input.snapshot.rootFingerprint);
  const configurationFingerprint = contextEngineShadowConfigurationFingerprint(input.executionBasis);
  const inventoryPaths = input.inventory.files.map((file) => file.path.replace(/\\/gu, "/")).sort();
  const snapshotPaths = input.snapshot.files.map((file) => file.normalizedPath).sort();
  const rebuiltSnapshot = adaptLegacyInventoryToRepositorySnapshot({
    inventory: input.inventory,
    projectId: input.projectId,
    rootUri: input.snapshot.rootUri,
    createdAt: input.snapshot.createdAt,
    excludedPatterns: input.negativeConstraints
      .filter((constraint): constraint is Extract<NegativeConstraint, { kind: "path" }> => constraint.kind === "path")
      .map((constraint) => constraint.pattern),
  });
  if (
    input.snapshot.projectId !== input.projectId ||
    typeof input.projectRoot !== "string" ||
    typeof input.inventory.rootPath !== "string" ||
    path.resolve(input.projectRoot) !== path.resolve(input.inventory.rootPath) ||
    taskFingerprint !== input.taskFingerprint ||
    clarificationFingerprint !== input.clarificationFingerprint ||
    inventoryFingerprint !== input.inventoryFingerprint ||
    snapshotFingerprint !== input.snapshotFingerprint ||
    configurationFingerprint !== input.configurationFingerprint ||
    JSON.stringify(inventoryPaths) !== JSON.stringify(snapshotPaths) ||
    rebuiltSnapshot.id !== input.snapshot.id ||
    rebuiltSnapshot.rootFingerprint !== input.snapshot.rootFingerprint ||
    JSON.stringify(rebuiltSnapshot.files) !== JSON.stringify(input.snapshot.files)
  ) {
    throw new Error("canonical_input_mismatch");
  }
}
