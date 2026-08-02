import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createLiveShadowRepositoryAdapter } from "../adapters/index.js";
import {
  assertContextEngineShadowInputEquivalent,
  createContextEngineShadowHistory,
  createContextEngineShadowDiagnosticsWriter,
  createContextEngineShadowExecutionBasis,
  createContextEngineShadowExecutionTracker,
  deriveShadowExplicitTargets,
  deriveShadowNegativeConstraints,
  normalizeContextEngineMode,
  prepareContextEngineShadowInput,
  runContextEngineShadowSidecar,
  settleContextEngineShadowExecution,
  runLiveContextEngineShadow,
  validateContextEngineShadowComparison,
} from "../shadow/index.js";
import { containsAbsoluteShadowPath } from "../shadow/shadowPrivacy.js";
import type { ProjectInventory } from "../../scanner/projectInventoryScanner.js";

let scenarioCount = 0;
async function scenario(name: string, run: () => void | Promise<void>): Promise<void> {
  await run();
  scenarioCount += 1;
  assert.ok(name.length > 0);
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), "context-engine-shadow-"));
const sourceMarker = "SHADOW_SOURCE_MARKER_DO_NOT_EXPORT";
const source = `export function handleRequest() { return ${JSON.stringify(sourceMarker)}; }\n`;
const sameSizeMutatedSource = source.replace("handleRequest", "handleRejectx");
assert.equal(
  new TextEncoder().encode(sameSizeMutatedSource).byteLength,
  new TextEncoder().encode(source).byteLength,
);
await fs.mkdir(path.join(root, "src"), { recursive: true });
await fs.writeFile(path.join(root, "src", "service.ts"), source, "utf8");
const sourceBytes = new TextEncoder().encode(source).byteLength;

const inventory: ProjectInventory = {
  rootPath: root,
  files: [{
    path: "src/service.ts", name: "service.ts", extension: ".ts", kind: "source", role: "service",
    imports: [], exports: ["handleRequest"], symbols: ["handleRequest"],
    textHints: ["handleRequest"], contentPreview: source.replace(/\s+/gu, " ").trim(), sizeBytes: sourceBytes,
    depth: 1, canReadText: true, isLikelyGenerated: false,
  }],
  totalFiles: 1, scannedFiles: 1, truncated: false, notes: [],
};
const policy = {
  budget: {
    maxOperations: 12, maxFileReads: 4, maxFileBytes: 50_000, maxParsedFiles: 4,
    maxRelationshipHops: 8, maxWallTimeMs: 2_000, maxPlannerRounds: 8,
    maxConcurrentOperations: 1,
  },
  timeoutMs: 2_250,
  maxHistoryRecords: 3,
};
const executionBasis = createContextEngineShadowExecutionBasis({
  policy,
  requestedTaskType: "general",
  effectiveTaskArea: "general",
});
const canonical = prepareContextEngineShadowInput({
  projectId: "project-1", projectRoot: root, inventory,
  normalizedTask: "Update handleRequest in src/service.ts",
  clarificationBasis: [{ questionId: "question-1", answer: "Use the existing handler" }],
  structuredTargets: [{ kind: "explicit_file", value: "src/service.ts", path: "src/service.ts", provenance: "user_confirmed" }],
  protectedScopes: [], executionBasis, createdAt: "2026-08-02T00:00:00.000Z",
});
const legacySelection: Parameters<typeof runLiveContextEngineShadow>[0]["legacySelection"] = {
  selectedFiles: [{ path: "src/service.ts", kind: "source", usage: "inspect-and-edit", reason: "Exact legacy target.", confidence: 1 }],
  rejectedModelPaths: [], source: "deterministic", usedFallback: false, durationMs: 0,
  notes: [], effectiveTaskArea: "general", assetMode: "none",
};

await scenario("default Context Engine mode is disabled", () => {
  assert.equal(normalizeContextEngineMode(undefined), "disabled");
});
await scenario("invalid Context Engine mode is disabled", () => {
  assert.equal(normalizeContextEngineMode("shadow_primary"), "disabled");
});
await scenario("shadow mode is independent and accepted", () => {
  assert.equal(normalizeContextEngineMode("shadow"), "shadow");
});
await scenario("explicit path is preserved", () => {
  assert.deepEqual(deriveShadowExplicitTargets([{ kind: "explicit_file", value: "x", path: "src/service.ts", provenance: "user_confirmed" }]), [{ kind: "path", path: "src/service.ts" }]);
});
await scenario("model proposed target is not promoted", () => {
  assert.deepEqual(deriveShadowExplicitTargets([{ kind: "symbol", value: "Guess", provenance: "model_proposed" }]), []);
});
await scenario("exact symbol target is preserved", () => {
  assert.deepEqual(deriveShadowExplicitTargets([{ kind: "symbol", value: "handleRequest", provenance: "user_confirmed" }]), [{ kind: "symbol", symbol: "handleRequest" }]);
});
await scenario("backslashes normalize in exact target", () => {
  assert.equal((deriveShadowExplicitTargets([{ kind: "explicit_file", value: "x", path: "src\\service.ts", provenance: "user_confirmed" }])[0] as { path: string }).path, "src/service.ts");
});
await scenario("duplicate targets are deterministic", () => {
  assert.equal(deriveShadowExplicitTargets([
    { kind: "explicit_file", value: "x", path: "src/service.ts", provenance: "user_confirmed" },
    { kind: "explicit_file", value: "x", path: "src/service.ts", provenance: "user_confirmed" },
  ]).length, 1);
});
await scenario("wildcard protected path remains a negative constraint", () => {
  assert.deepEqual(deriveShadowNegativeConstraints(["src/private/*"]), [{ kind: "path", pattern: "src/private/*" }]);
});
await scenario("semantic protected scope is not used as positive path", () => {
  assert.deepEqual(deriveShadowNegativeConstraints(["do not change billing behavior"]), [{ kind: "semantic", description: "do not change billing behavior" }]);
});
await scenario("canonical task excludes presentation markdown", () => {
  assert.equal(canonical.normalizedTask.includes("## User Clarifications"), false);
});
await scenario("presentation clarification markdown is rejected", () => {
  assert.throws(() => prepareContextEngineShadowInput({
    projectId: "p", projectRoot: root, inventory,
    normalizedTask: "Task\n## User Clarifications\nQuestion: secret",
    structuredTargets: [], protectedScopes: [], executionBasis, createdAt: new Date().toISOString(),
  }));
});
await scenario("same inventory is adapted without another scan", () => {
  assert.equal(canonical.inventory, inventory);
  assert.equal(canonical.snapshot.files.length, inventory.files.length);
});
await scenario("canonical task fingerprint is deterministic", () => {
  const repeated = prepareContextEngineShadowInput({
    projectId: "project-1", projectRoot: root, inventory,
    normalizedTask: "Update handleRequest in src/service.ts", clarificationBasis: canonical.clarificationBasis,
    structuredTargets: [{ kind: "explicit_file", value: "src/service.ts", path: "src/service.ts", provenance: "user_confirmed" }],
    protectedScopes: [], executionBasis, createdAt: "2027-01-01T00:00:00.000Z",
  });
  assert.equal(repeated.taskFingerprint, canonical.taskFingerprint);
  assert.equal(repeated.snapshotFingerprint, canonical.snapshotFingerprint);
});
await scenario("canonical fingerprints bind clarifications", () => {
  assert.match(canonical.clarificationFingerprint, /^sha256:[a-f0-9]{64}$/u);
});
await scenario("canonical fingerprints bind inventory", () => {
  assert.match(canonical.inventoryFingerprint, /^sha256:[a-f0-9]{64}$/u);
});
await scenario("canonical fingerprints bind policy", () => {
  assert.match(canonical.configurationFingerprint, /^sha256:[a-f0-9]{64}$/u);
});
await scenario("canonical execution basis is deeply immutable", () => {
  assert.equal(Object.isFrozen(executionBasis), true);
  assert.equal(Object.isFrozen(executionBasis.policy), true);
  assert.equal(Object.isFrozen(executionBasis.policy.budget), true);
  assert.equal(Object.isFrozen(executionBasis.plannerPolicy), true);
});
await scenario("canonical equivalence accepts untouched input", () => {
  assert.doesNotThrow(() => assertContextEngineShadowInputEquivalent(canonical));
});
await scenario("canonical mismatch is detected", () => {
  assert.throws(() => assertContextEngineShadowInputEquivalent({ ...canonical, taskFingerprint: canonical.snapshotFingerprint }));
});

const live = await runLiveContextEngineShadow({
  canonical, legacySelection,
});
await scenario("shadow invokes the real investigation runner", () => {
  assert.equal(live.status, "completed");
  assert.ok((live.budgetUsage?.operations ?? 0) > 0);
});
await scenario("grounded real shadow reaches sufficient evidence", () => {
  assert.equal(live.stopReason, "sufficient_evidence");
  assert.equal(live.safeToProject, true);
  assert.ok(live.v2?.editablePaths.includes("src/service.ts"));
});
await scenario("real shadow records bounded operation budget", () => {
  assert.ok((live.budgetUsage?.operations ?? 0) <= policy.budget.maxOperations);
});
await scenario("real shadow records bounded reads", () => {
  assert.ok((live.budgetUsage?.fileReads ?? 0) <= policy.budget.maxFileReads);
});
await scenario("real shadow records bounded bytes", () => {
  assert.ok((live.budgetUsage?.fileBytes ?? 0) <= policy.budget.maxFileBytes);
});
await scenario("real shadow records bounded parses", () => {
  assert.ok((live.budgetUsage?.parsedFiles ?? 0) <= policy.budget.maxParsedFiles);
});
await scenario("comparison has no automatic quality winner", () => {
  assert.equal(live.outcome, "insufficient_evaluation_data");
});
await scenario("comparison fingerprints match canonical input", () => {
  assert.equal(live.taskFingerprint, canonical.taskFingerprint);
  assert.equal(live.snapshotFingerprint, canonical.snapshotFingerprint);
});
await scenario("comparison has finite timings", () => {
  assert.equal(Object.entries(live.timing).every(([key, value]) =>
    key === "persistenceMs" ? value === null : Number.isFinite(value) && (value as number) >= 0), true);
});
await scenario("comparison records clarification and manual-review agreement", () => {
  assert.equal(typeof live.manualReviewAgreement, "boolean");
});
await scenario("comparison is descriptor-safe and closed", () => {
  assert.doesNotThrow(() => validateContextEngineShadowComparison(live));
});
await scenario("arbitrary source text is absent from diagnostics", () => {
  assert.equal(JSON.stringify(live).includes(sourceMarker), false);
});
await scenario("absolute project root is absent from diagnostics", () => {
  assert.equal(JSON.stringify(live).includes(root), false);
});
await scenario("raw task is absent from diagnostics", () => {
  assert.equal(JSON.stringify(live).includes(canonical.normalizedTask), false);
});
await scenario("clarification answer is absent from diagnostics", () => {
  assert.equal(JSON.stringify(live).includes("Use the existing handler"), false);
});
await scenario("malformed persisted record is rejected", () => {
  assert.throws(() => validateContextEngineShadowComparison({ ...live, rawTask: canonical.normalizedTask }));
});
await scenario("diagnostic accessor is not executed", () => {
  let accessed = false;
  const forged = Object.create(null) as Record<string, unknown>;
  Object.defineProperty(forged, "schemaVersion", { enumerable: true, get() { accessed = true; return 1; } });
  assert.throws(() => validateContextEngineShadowComparison(forged));
  assert.equal(accessed, false);
});

let persisted: unknown = [];
let historyWriteCount = 0;
const history = createContextEngineShadowHistory({
  read: async () => structuredClone(persisted),
  write: async (value) => { historyWriteCount += 1; persisted = structuredClone(value); },
  limit: 3,
});
await scenario("separate shadow history appends records", async () => {
  assert.equal((await history.append(live)).length, 1);
  assert.equal(historyWriteCount, 1);
});
await scenario("shadow history performs exactly one storage write per append", async () => {
  const before = historyWriteCount;
  await history.append({ ...structuredClone(live), comparisonId: "shadow-single-write" });
  assert.equal(historyWriteCount - before, 1);
  assert.equal(live.timing.persistenceMs, null);
});
await scenario("shadow history returns defensive snapshots", async () => {
  const first = await history.get();
  assert.equal(Object.isFrozen(first), true);
  assert.notEqual(first, persisted);
});
await scenario("bounded history enforces the configured limit", async () => {
  for (let index = 0; index < 5; index += 1) {
    await history.append({ ...structuredClone(live), comparisonId: `shadow-copy-${index}`, createdAt: `2026-08-02T00:00:0${index}.000Z` });
  }
  assert.equal((await history.get()).length, 3);
});
await scenario("concurrent append preserves both records", async () => {
  await Promise.all([
    history.append({ ...structuredClone(live), comparisonId: "shadow-concurrent-a", createdAt: "2099-08-02T00:01:00.000Z" }),
    history.append({ ...structuredClone(live), comparisonId: "shadow-concurrent-b", createdAt: "2099-08-02T00:01:01.000Z" }),
  ]);
  const ids = (await history.get()).map((record) => record.comparisonId);
  assert.ok(ids.includes("shadow-concurrent-a"));
  assert.ok(ids.includes("shadow-concurrent-b"));
});
await scenario("newest shadow diagnostic is first", async () => {
  assert.equal((await history.get())[0]?.comparisonId, "shadow-concurrent-b");
});
await scenario("clear removes only shadow history", async () => {
  await history.clear();
  assert.deepEqual(await history.get(), []);
});

const excludedCanonical = prepareContextEngineShadowInput({
  projectId: "project-1", projectRoot: root, inventory,
  normalizedTask: "Update src/service.ts", structuredTargets: [],
  protectedScopes: ["src/*"], executionBasis, createdAt: new Date().toISOString(),
});
const excludedLive = await runLiveContextEngineShadow({
  canonical: excludedCanonical,
  legacySelection,
});
await scenario("real negative-constraint shadow stays safely unresolved", () => {
  assert.equal(excludedLive.status, "completed");
  assert.equal(excludedLive.v2?.editablePaths.length ?? 0, 0);
  assert.equal(excludedLive.safeToProject, false);
});
const cancelled = { isCancellationRequested: () => true };
const cancelledRepository = createLiveShadowRepositoryAdapter({
  projectRoot: root, inventory, snapshot: canonical.snapshot,
  negativeConstraints: [], cancellation: cancelled,
});
await scenario("cancelled search performs no repository work", async () => {
  assert.deepEqual(await cancelledRepository.search.searchPaths({ snapshotId: canonical.snapshot.id, query: "service", limit: 10 }), []);
});
await scenario("cancelled read fails without source content", async () => {
  const file = canonical.snapshot.files[0]!;
  const result = await cancelledRepository.reader.readFile({
    snapshotId: canonical.snapshot.id, fileId: file.id, path: file.normalizedPath,
    expectedFingerprint: file.contentFingerprint, maxBytes: 50_000,
  });
  assert.equal(result.status, "failure");
});
await scenario("negative constraints block search leads", async () => {
  const adapter = createLiveShadowRepositoryAdapter({
    projectRoot: root, inventory, snapshot: excludedCanonical.snapshot,
    negativeConstraints: excludedCanonical.negativeConstraints,
    cancellation: { isCancellationRequested: () => false },
  });
  assert.deepEqual(await adapter.search.searchPaths({ snapshotId: excludedCanonical.snapshot.id, query: "service", limit: 10 }), []);
});
await scenario("negative constraints block execution reads", async () => {
  const adapter = createLiveShadowRepositoryAdapter({
    projectRoot: root, inventory, snapshot: excludedCanonical.snapshot,
    negativeConstraints: excludedCanonical.negativeConstraints,
    cancellation: { isCancellationRequested: () => false },
  });
  const file = excludedCanonical.snapshot.files[0]!;
  const result = await adapter.reader.readFile({ snapshotId: excludedCanonical.snapshot.id, fileId: file.id, path: file.normalizedPath, expectedFingerprint: file.contentFingerprint, maxBytes: 50_000 });
  assert.equal(result.status, "failure");
});
await scenario("fingerprint mismatch is rejected before extraction", async () => {
  const adapter = createLiveShadowRepositoryAdapter({ projectRoot: root, inventory, snapshot: canonical.snapshot, negativeConstraints: [], cancellation: { isCancellationRequested: () => false } });
  const file = canonical.snapshot.files[0]!;
  const result = await adapter.reader.readFile({ snapshotId: canonical.snapshot.id, fileId: file.id, path: file.normalizedPath, expectedFingerprint: "forged", maxBytes: 50_000 });
  assert.equal(result.status === "failure" && result.reason === "fingerprint_mismatch", true);
});
await scenario("path traversal is never a repository candidate", async () => {
  const adapter = createLiveShadowRepositoryAdapter({ projectRoot: root, inventory, snapshot: canonical.snapshot, negativeConstraints: [], cancellation: { isCancellationRequested: () => false } });
  const file = canonical.snapshot.files[0]!;
  const result = await adapter.reader.readFile({ snapshotId: canonical.snapshot.id, fileId: file.id, path: "../secret", expectedFingerprint: file.contentFingerprint, maxBytes: 50_000 });
  assert.equal(result.status, "failure");
});
await scenario("oversized full read is rejected before filesystem open", async () => {
  const adapter = createLiveShadowRepositoryAdapter({
    projectRoot: root,
    inventory,
    snapshot: canonical.snapshot,
    negativeConstraints: [],
    cancellation: { isCancellationRequested: () => false },
  });
  const file = canonical.snapshot.files[0]!;
  const sourcePath = path.join(root, file.normalizedPath);
  const hiddenPath = `${sourcePath}.temporarily-hidden`;
  await fs.rename(sourcePath, hiddenPath);
  try {
    const result = await adapter.reader.readFile({
      snapshotId: canonical.snapshot.id,
      fileId: file.id,
      path: file.normalizedPath,
      expectedFingerprint: file.contentFingerprint,
      maxBytes: 1,
    });
    assert.equal(result.status === "failure" && result.reason === "byte_limit", true);
  } finally {
    await fs.rename(hiddenPath, sourcePath);
  }
});
await scenario("oversized metadata-derived range is rejected before filesystem open", async () => {
  const adapter = createLiveShadowRepositoryAdapter({
    projectRoot: root,
    inventory,
    snapshot: canonical.snapshot,
    negativeConstraints: [],
    cancellation: { isCancellationRequested: () => false },
  });
  const file = canonical.snapshot.files[0]!;
  const sourcePath = path.join(root, file.normalizedPath);
  const hiddenPath = `${sourcePath}.range-hidden`;
  await fs.rename(sourcePath, hiddenPath);
  try {
    const result = await adapter.reader.readRange({
      snapshotId: canonical.snapshot.id,
      fileId: file.id,
      path: file.normalizedPath,
      expectedFingerprint: file.contentFingerprint,
      maxBytes: 1,
      startLine: 1,
      endLine: 1,
    });
    assert.equal(result.status === "failure" && result.reason === "byte_limit", true);
  } finally {
    await fs.rename(hiddenPath, sourcePath);
  }
});
await scenario("same-size mutation makes full read fail fingerprint validation", async () => {
  const adapter = createLiveShadowRepositoryAdapter({
    projectRoot: root, inventory, snapshot: canonical.snapshot,
    negativeConstraints: [], cancellation: { isCancellationRequested: () => false },
  });
  const file = canonical.snapshot.files[0]!;
  await fs.writeFile(path.join(root, file.normalizedPath), sameSizeMutatedSource, "utf8");
  try {
    const result = await adapter.reader.readFile({
      snapshotId: canonical.snapshot.id, fileId: file.id, path: file.normalizedPath,
      expectedFingerprint: file.contentFingerprint, maxBytes: sourceBytes,
    });
    assert.equal(result.status === "failure" && result.reason === "fingerprint_mismatch", true);
  } finally {
    await fs.writeFile(path.join(root, file.normalizedPath), source, "utf8");
  }
});
await scenario("same-size mutation cannot return stale-fingerprint range success", async () => {
  const adapter = createLiveShadowRepositoryAdapter({
    projectRoot: root, inventory, snapshot: canonical.snapshot,
    negativeConstraints: [], cancellation: { isCancellationRequested: () => false },
  });
  const file = canonical.snapshot.files[0]!;
  await fs.writeFile(path.join(root, file.normalizedPath), sameSizeMutatedSource, "utf8");
  try {
    const result = await adapter.reader.readRange({
      snapshotId: canonical.snapshot.id, fileId: file.id, path: file.normalizedPath,
      expectedFingerprint: file.contentFingerprint, maxBytes: sourceBytes,
      startLine: 1, endLine: 1,
    });
    assert.equal(result.status === "failure" && result.reason === "fingerprint_mismatch", true);
  } finally {
    await fs.writeFile(path.join(root, file.normalizedPath), source, "utf8");
  }
});
await scenario("verified unchanged small file range remains successful", async () => {
  const adapter = createLiveShadowRepositoryAdapter({
    projectRoot: root, inventory, snapshot: canonical.snapshot,
    negativeConstraints: [], cancellation: { isCancellationRequested: () => false },
  });
  const file = canonical.snapshot.files[0]!;
  const result = await adapter.reader.readRange({
    snapshotId: canonical.snapshot.id, fileId: file.id, path: file.normalizedPath,
    expectedFingerprint: file.contentFingerprint, maxBytes: sourceBytes,
    startLine: 1, endLine: 1,
  });
  assert.equal(result.status, "success");
  if (result.status === "success") assert.equal(result.content, source.trimEnd());
});
await scenario("stale same-size content cannot authorize runner facts or evidence", async () => {
  const file = canonical.snapshot.files[0]!;
  await fs.writeFile(path.join(root, file.normalizedPath), sameSizeMutatedSource, "utf8");
  try {
    const result = await runLiveContextEngineShadow({ canonical, legacySelection });
    assert.equal(result.v2?.editablePaths.length ?? 0, 0);
    assert.equal(result.safeToProject, false);
  } finally {
    await fs.writeFile(path.join(root, file.normalizedPath), source, "utf8");
  }
});
await scenario("cancellation prevents subsequent repository work", async () => {
  let cancelledAfterConstruction = false;
  const adapter = createLiveShadowRepositoryAdapter({
    projectRoot: root,
    inventory,
    snapshot: canonical.snapshot,
    negativeConstraints: [],
    cancellation: { isCancellationRequested: () => cancelledAfterConstruction },
  });
  cancelledAfterConstruction = true;
  const file = canonical.snapshot.files[0]!;
  assert.deepEqual(await adapter.search.searchPaths({
    snapshotId: canonical.snapshot.id,
    query: "service",
    limit: 10,
  }), []);
  const result = await adapter.reader.readFile({
    snapshotId: canonical.snapshot.id,
    fileId: file.id,
    path: file.normalizedPath,
    expectedFingerprint: file.contentFingerprint,
    maxBytes: 50_000,
  });
  assert.equal(result.status, "failure");
});
await scenario("input mismatch produces a critical typed diagnostic", async () => {
  const result = await runLiveContextEngineShadow({
    canonical: { ...canonical, inventoryFingerprint: canonical.taskFingerprint },
    legacySelection,
  });
  assert.equal(result.status, "input_mismatch");
  assert.deepEqual(result.issues, [{ code: "canonical_input_mismatch", severity: "critical" }]);
});
await scenario("forged configuration fingerprint is rejected", async () => {
  const result = await runLiveContextEngineShadow({
    canonical: { ...canonical, configurationFingerprint: canonical.taskFingerprint },
    legacySelection,
  });
  assert.equal(result.status, "input_mismatch");
});
await scenario("execution policy cannot diverge from prepared policy", async () => {
  const alternateBasis = createContextEngineShadowExecutionBasis({
    policy: { ...policy, timeoutMs: policy.timeoutMs + 1 },
    requestedTaskType: "general",
    effectiveTaskArea: "general",
  });
  const result = await runLiveContextEngineShadow({
    canonical: { ...canonical, executionBasis: alternateBasis },
    legacySelection,
  });
  assert.equal(result.status, "input_mismatch");
});
await scenario("requested task type mismatch is rejected", async () => {
  const alternateBasis = createContextEngineShadowExecutionBasis({
    policy,
    requestedTaskType: "bugfix",
    effectiveTaskArea: "general",
  });
  const result = await runLiveContextEngineShadow({
    canonical: { ...canonical, executionBasis: alternateBasis },
    legacySelection,
  });
  assert.equal(result.status, "input_mismatch");
});
await scenario("effective task area mismatch is rejected", async () => {
  const alternateBasis = createContextEngineShadowExecutionBasis({
    policy,
    requestedTaskType: "general",
    effectiveTaskArea: "backend",
  });
  const result = await runLiveContextEngineShadow({
    canonical: { ...canonical, executionBasis: alternateBasis },
    legacySelection,
  });
  assert.equal(result.status, "input_mismatch");
});
await scenario("project root must match inventory root", () => {
  assert.throws(() => prepareContextEngineShadowInput({
    projectId: "project-1",
    projectRoot: path.join(root, "different-root"),
    inventory,
    normalizedTask: "Inspect src/service.ts",
    structuredTargets: [],
    protectedScopes: [],
    executionBasis,
    createdAt: new Date().toISOString(),
  }), /canonical_input_mismatch/u);
});
await scenario("forged runtime project root is rejected", async () => {
  const result = await runLiveContextEngineShadow({
    canonical: { ...canonical, projectRoot: path.dirname(root) },
    legacySelection,
  });
  assert.equal(result.status, "input_mismatch");
});
await scenario("fabricated shadow-shaped data cannot mutate legacy selection", () => {
  const before = structuredClone(legacySelection);
  const fabricated = { selectedFiles: [{ path: "src/private/secret.ts" }], blocked: true, clarification: "invented" };
  void fabricated;
  assert.deepEqual(legacySelection, before);
});
await scenario("disabled and shadow production contracts remain deep-equal", async () => {
  const disabledProduction = {
    selectedFiles: structuredClone(legacySelection.selectedFiles),
    generatedPrompt: "legacy-only-prompt",
    executionContract: { mode: "implementation", targets: ["src/service.ts"] },
    cacheIdentity: "legacy-cache-identity",
    storedTaskPack: { rawTask: "legacy task", generatedPrompt: "legacy-only-prompt" },
  };
  const shadowProduction = structuredClone(disabledProduction);
  await runContextEngineShadowSidecar("shadow", { timeoutMs: 100, execute: async () => {
    const fabricated = {
      selectedFiles: [{ path: "src/private/secret.ts" }],
      generatedPrompt: "shadow prompt",
      executionContract: { mode: "blocked" },
      cacheIdentity: "shadow-cache",
      storedTaskPack: { diagnostics: live },
    };
    void fabricated;
  } });
  assert.deepEqual(shadowProduction, disabledProduction);
  assert.equal(shadowProduction.generatedPrompt.includes("shadow"), false);
  assert.equal("diagnostics" in shadowProduction.storedTaskPack, false);
});
const taskPackRouteSource = await fs.readFile(
  new URL("../../routes/taskPacks.ts", import.meta.url),
  "utf8",
);
await scenario("production selection after the sidecar never reads comparison output", () => {
  const productionContinuation = taskPackRouteSource.slice(
    taskPackRouteSource.indexOf("const selectionQuality ="),
  );
  assert.equal(/contextEngine|shadow|comparison/iu.test(productionContinuation), false);
});
await scenario("Task Pack boundary uses bounded enqueue instead of awaiting storage", () => {
  assert.match(taskPackRouteSource, /enqueueContextEngineShadowDiagnostics\s*\(/u);
  assert.equal(/await\s+appendContextEngineShadowDiagnostics\s*\(/u.test(taskPackRouteSource), false);
});
await scenario("prompt and cache assembly contain no shadow diagnostics", () => {
  const productionContinuation = taskPackRouteSource.slice(
    taskPackRouteSource.indexOf("const selectionQuality ="),
  );
  assert.equal(/generatedPrompt\s*:\s*(?:comparison|shadow)/u.test(productionContinuation), false);
  assert.equal(/cacheIdentity\s*:\s*(?:comparison|shadow)/u.test(productionContinuation), false);
});
await scenario("Task Pack response and persistence contain no v2 field", () => {
  const productionContinuation = taskPackRouteSource.slice(
    taskPackRouteSource.indexOf("const selectionQuality ="),
  );
  assert.equal(/contextEngineV2|shadowDiagnostics|shadowComparison/u.test(productionContinuation), false);
});
await scenario("shadow diagnostics never enter a production selection DTO", () => {
  assert.equal("contextEngineV2" in legacySelection, false);
  assert.equal("shadow" in legacySelection, false);
});
await scenario("shadow mode can switch to disabled between requests", () => {
  assert.equal(normalizeContextEngineMode("shadow"), "shadow");
  assert.equal(normalizeContextEngineMode("disabled"), "disabled");
});
await scenario("selector pipeline mode does not enable Context Engine shadow", () => {
  assert.equal(normalizeContextEngineMode("shadow_compare"), "disabled");
});
await scenario("disabled sidecar never invokes v2", async () => {
  let calls = 0;
  let clockCalls = 0;
  const tracker = createContextEngineShadowExecutionTracker({ maximumActiveExecutions: 1 });
  await runContextEngineShadowSidecar("disabled", {
    timeoutMs: 100,
    execute: async () => { calls += 1; },
    monotonicMs: () => { clockCalls += 1; return 0; },
    tracker,
  });
  assert.equal(calls, 0);
  assert.equal(clockCalls, 0);
  assert.deepEqual(tracker.state(), { active: 0, capacity: 1, skipped: 0, closed: false });
});
await scenario("shadow sidecar invokes diagnostics exactly once", async () => {
  let calls = 0;
  await runContextEngineShadowSidecar("shadow", { timeoutMs: 100, execute: async () => { calls += 1; } });
  assert.equal(calls, 1);
});
await scenario("shadow exception cannot replace a production value", async () => {
  const production = structuredClone(legacySelection);
  await runContextEngineShadowSidecar("shadow", { timeoutMs: 100, execute: async () => {
    throw new Error(`${root} ${sourceMarker}`);
  } });
  assert.deepEqual(production, legacySelection);
});
const neverSettlingExecutionTracker = createContextEngineShadowExecutionTracker({
  maximumActiveExecutions: 2,
});
await scenario("non-cooperative shadow execution returns at the hard deadline", async () => {
  const started = performance.now();
  await runContextEngineShadowSidecar("shadow", {
    timeoutMs: 20,
    tracker: neverSettlingExecutionTracker,
    execute: () => new Promise<void>(() => undefined),
  });
  const elapsed = performance.now() - started;
  assert.ok(elapsed >= 15 && elapsed < 100, `Expected bounded timeout, got ${elapsed}ms.`);
});
await scenario("non-cooperative timed-out execution remains lifecycle-tracked", () => {
  assert.equal(neverSettlingExecutionTracker.state().active, 1);
});
const capacityExecutionTracker = createContextEngineShadowExecutionTracker({
  maximumActiveExecutions: 1,
});
await scenario("execution tracker capacity is fixed and bounded", async () => {
  await runContextEngineShadowSidecar("shadow", {
    timeoutMs: 5,
    tracker: capacityExecutionTracker,
    execute: () => new Promise<void>(() => undefined),
  });
  assert.deepEqual(capacityExecutionTracker.state(), {
    active: 1, capacity: 1, skipped: 0, closed: false,
  });
});
await scenario("capacity exhaustion skips new shadow execution", async () => {
  let calls = 0;
  await runContextEngineShadowSidecar("shadow", {
    timeoutMs: 20,
    tracker: capacityExecutionTracker,
    execute: async () => { calls += 1; },
  });
  assert.equal(calls, 0);
  assert.equal(capacityExecutionTracker.state().skipped, 1);
});
await scenario("tracked rejection is observed without an unhandled rejection", async () => {
  const tracker = createContextEngineShadowExecutionTracker({ maximumActiveExecutions: 1 });
  let unhandled = false;
  const onUnhandled = (): void => { unhandled = true; };
  process.once("unhandledRejection", onUnhandled);
  await runContextEngineShadowSidecar("shadow", {
    timeoutMs: 50,
    tracker,
    execute: async () => { throw new Error(`${root} ${sourceMarker}`); },
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  process.removeListener("unhandledRejection", onUnhandled);
  assert.equal(unhandled, false);
  assert.equal(tracker.state().active, 0);
});
await scenario("cooperative execution settles and leaves the tracker", async () => {
  const tracker = createContextEngineShadowExecutionTracker({ maximumActiveExecutions: 1 });
  await runContextEngineShadowSidecar("shadow", {
    timeoutMs: 50,
    tracker,
    execute: async () => undefined,
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(tracker.state().active, 0);
});
await scenario("shutdown drain remains bounded with non-cooperative execution", async () => {
  const started = performance.now();
  assert.equal(await capacityExecutionTracker.close(5), false);
  assert.ok(performance.now() - started < 50);
  assert.equal(capacityExecutionTracker.state().closed, true);
});
await scenario("timeout cancellation remains request-local", async () => {
  const tracker = createContextEngineShadowExecutionTracker({ maximumActiveExecutions: 2 });
  let secondAborted = false;
  await Promise.all([
    runContextEngineShadowSidecar("shadow", {
      timeoutMs: 5,
      tracker,
      execute: () => new Promise<void>(() => undefined),
    }),
    runContextEngineShadowSidecar("shadow", {
      timeoutMs: 100,
      tracker,
      execute: async ({ signal }) => {
        signal.addEventListener("abort", () => { secondAborted = true; }, { once: true });
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
      },
    }),
  ]);
  assert.equal(secondAborted, false);
  assert.equal(tracker.state().active, 1);
  assert.equal(await tracker.close(1), false);
});
await scenario("never-resolving diagnostics persistence does not stall the request boundary", async () => {
  const writer = createContextEngineShadowDiagnosticsWriter({
    persist: () => new Promise(() => undefined),
    maxQueueLength: 2,
  });
  const started = performance.now();
  await runContextEngineShadowSidecar("shadow", {
    timeoutMs: 50,
    execute: async () => { assert.equal(writer.enqueue(live), "enqueued"); },
  });
  assert.ok(performance.now() - started < 100);
  assert.equal(writer.state().inFlight, true);
  assert.equal(writer.state().workerTracked, true);
  assert.equal(await writer.flush(1), false);
  assert.equal(await writer.close(1), false);
  assert.equal(writer.state().closed, true);
});
await scenario("stalled diagnostics persistence has a deterministic bounded queue", () => {
  const writer = createContextEngineShadowDiagnosticsWriter({
    persist: () => new Promise(() => undefined),
    maxQueueLength: 2,
  });
  assert.equal(writer.enqueue(live), "enqueued");
  assert.equal(writer.enqueue({ ...structuredClone(live), comparisonId: "shadow-queued-a" }), "enqueued");
  assert.equal(writer.enqueue({ ...structuredClone(live), comparisonId: "shadow-queued-b" }), "enqueued");
  assert.equal(writer.enqueue({ ...structuredClone(live), comparisonId: "shadow-dropped" }), "dropped");
  assert.equal(writer.state().queued, 2);
  assert.equal(writer.state().dropped, 1);
  assert.equal(writer.state().workerTracked, true);
});
await scenario("diagnostics persistence rejection is failure-contained", async () => {
  const production = structuredClone(legacySelection);
  const writer = createContextEngineShadowDiagnosticsWriter({
    persist: async () => { throw new Error(`${root} ${sourceMarker}`); },
  });
  assert.equal(writer.enqueue(live), "enqueued");
  assert.equal(await writer.flush(50), true);
  assert.deepEqual(production, legacySelection);
});
await scenario("end-to-end sidecar overhead remains bounded", async () => {
  const started = performance.now();
  await runContextEngineShadowSidecar("shadow", {
    timeoutMs: 25,
    execute: async ({ signal }) => {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 5);
        signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
      });
    },
  });
  assert.ok(performance.now() - started < 75);
});
for (const absolutePath of [
  "/home/user/project",
  "/opt/project",
  "/data/private/repo",
  "/workspace/project",
  "/usr/local/project",
  "/app/private",
  "/custom/root/project",
  "C:\\Users\\project",
  "C:/Users/project",
  "\\\\server\\share\\project",
  "file:///project",
]) {
  await scenario(`generic privacy boundary rejects ${absolutePath}`, () => {
    assert.equal(containsAbsoluteShadowPath(absolutePath), true);
    assert.throws(() => validateContextEngineShadowComparison({
      ...structuredClone(live),
      projectId: absolutePath,
    }));
  });
}
await scenario("hard deadline aborts repository work", async () => {
  const controller = new AbortController();
  let settledAfterAbort = false;
  const execution = new Promise<string>((resolve) => {
    controller.signal.addEventListener("abort", () => {
      settledAfterAbort = true;
      resolve("cancelled");
    }, { once: true });
  });
  const outcome = await settleContextEngineShadowExecution({
    execution,
    abortController: controller,
    timeoutMs: 1,
  });
  assert.equal(outcome.status, "timeout");
  assert.equal(controller.signal.aborted, true);
  assert.equal(settledAfterAbort, true);
});
await scenario("controlled deadline leaves no unsettled execution", async () => {
  const controller = new AbortController();
  let alive = true;
  const execution = new Promise<void>((resolve) => {
    controller.signal.addEventListener("abort", () => {
      alive = false;
      resolve();
    }, { once: true });
  });
  await settleContextEngineShadowExecution({ execution, abortController: controller, timeoutMs: 1 });
  assert.equal(alive, false);
});
await scenario("execution failure is normalized without exposing its message", async () => {
  const controller = new AbortController();
  const outcome = await settleContextEngineShadowExecution({
    execution: Promise.reject(new Error(`${root} ${sourceMarker}`)),
    abortController: controller,
    timeoutMs: 50,
  });
  assert.deepEqual(outcome, { status: "execution_error" });
});
await scenario("two canonical requests retain isolated project identities", () => {
  const second = prepareContextEngineShadowInput({
    projectId: "project-2", projectRoot: root, inventory, normalizedTask: "Inspect src/service.ts",
    structuredTargets: [], protectedScopes: [], executionBasis, createdAt: new Date().toISOString(),
  });
  assert.notEqual(second.snapshot.id, canonical.snapshot.id);
  assert.notEqual(second.taskFingerprint, canonical.taskFingerprint);
});
await scenario("comparison IDs are request-local", async () => {
  const [left, right] = await Promise.all([
    runLiveContextEngineShadow({ canonical, legacySelection }),
    runLiveContextEngineShadow({ canonical, legacySelection }),
  ]);
  assert.notEqual(left.comparisonId, right.comparisonId);
});

await fs.rm(root, { recursive: true, force: true });
assert.ok(scenarioCount >= 50, `Expected at least 50 shadow scenarios, got ${scenarioCount}.`);
console.log(`Context Engine v2 shadow smoke: ${scenarioCount} scenarios passed.`);
