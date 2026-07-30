import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createLegacyTaskFileSelectionProjection,
  createOfflineCompatibilityComparison,
  LegacyProjectionError,
  type LegacyProjectionOptions,
  type LegacyProjectionResult,
} from "../adapters/index.js";
import type {
  ContextProjectionResult,
  EntityId,
  EvidenceId,
  FileDescriptor,
  Finding,
  FindingId,
  ProjectionEntityDecision,
  RepositorySnapshot,
  SnapshotId,
} from "../contracts/index.js";

type TaskFileSelection = LegacyProjectionResult["selection"];

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const snapshotId = "snapshot-compatibility" as SnapshotId;

function file(input: {
  id: string;
  path: string;
  kind?: FileDescriptor["kind"];
  readable?: boolean;
  generated?: boolean;
  secretRisk?: FileDescriptor["secretRisk"];
}): FileDescriptor {
  return {
    id: input.id as EntityId,
    snapshotId,
    path: input.path,
    normalizedPath: input.path,
    extension: input.path.includes(".") ? `.${input.path.split(".").at(-1)}` : null,
    language: input.kind === "asset" ? null : "typescript",
    kind: input.kind ?? "source",
    sizeBytes: 64,
    contentFingerprint: `fingerprint:${input.id}`,
    readable: input.readable ?? true,
    generated: input.generated ?? false,
    secretRisk: input.secretRisk ?? "none",
    attributes: {},
  };
}

function snapshot(files: FileDescriptor[]): RepositorySnapshot {
  return {
    id: snapshotId,
    projectId: "compatibility-fixture",
    rootUri: "repository://compatibility-fixture",
    rootFingerprint: "root:compatibility-fixture",
    createdAt: "2026-01-01T00:00:00.000Z",
    source: "test_fixture",
    files: [...files].sort((left, right) => left.normalizedPath.localeCompare(right.normalizedPath)),
    limits: { excludedPatterns: [] },
    truncation: { truncated: false, reasons: [] },
    metadata: {},
  };
}

function decision(input: {
  entityId: string;
  file: FileDescriptor;
  role: NonNullable<ProjectionEntityDecision["role"]>;
  included?: boolean;
  reasonCodes?: ProjectionEntityDecision["reasonCodes"];
  findingId?: string;
  evidenceId?: string;
  reviewRequired?: boolean;
}): ProjectionEntityDecision {
  return {
    entityId: input.entityId as EntityId,
    fileId: input.file.id,
    path: input.file.normalizedPath,
    role: input.role,
    included: input.included ?? true,
    reviewRequired: input.reviewRequired ?? false,
    findingIds: [(input.findingId ?? `finding-${input.entityId}`) as FindingId],
    evidenceIds: [(input.evidenceId ?? `evidence-${input.entityId}`) as EvidenceId],
    reasonCodes: input.reasonCodes ?? [
      input.role === "target"
        ? "confirmed_implementation_target"
        : input.role === "test"
          ? "confirmed_test_target"
          : input.role === "supporting"
            ? "confirmed_supporting_context"
            : "probable_review_only",
    ],
  };
}

function findingFor(decision: ProjectionEntityDecision): Finding {
  return {
    id: decision.findingIds[0]!,
    snapshotId,
    type: decision.role === "target"
      ? "implementation_target"
      : decision.role === "test"
        ? "test_target"
        : "supporting_context",
    statement: "Compatibility fixture finding.",
    entityIds: [decision.entityId],
    evidenceIds: decision.evidenceIds,
    status: decision.role === "reference" ? "probable" : "confirmed",
    limitations: [],
    authorizationHint:
      decision.role === "target" || decision.role === "test"
        ? "eligible"
        : "review_required",
  };
}

function projection(decisions: ProjectionEntityDecision[]): ContextProjectionResult {
  const included = decisions.filter((entry) => entry.included);
  const projected = (entry: ProjectionEntityDecision) => ({
    entityId: entry.entityId,
    role: entry.role!,
    reason: entry.reasonCodes[0]!,
    findingIds: entry.findingIds,
    evidenceIds: entry.evidenceIds,
    reviewRequired: entry.reviewRequired,
  });
  const uniqueFindings = new Map<string, Finding>();
  decisions.forEach((entry) => uniqueFindings.set(entry.findingIds[0]!, findingFor(entry)));
  return {
    projection: {
      snapshotId,
      purpose: "legacy_selection",
      primaryEntities: included.filter((entry) => entry.role === "target").map(projected),
      supportingEntities: included
        .filter((entry) => entry.role === "supporting" || entry.role === "test")
        .map(projected),
      referenceEntities: included.filter((entry) => entry.role === "reference").map(projected),
      excludedEntities: decisions
        .filter((entry) => !entry.included)
        .map((entry) => ({ entityId: entry.entityId, reason: entry.reasonCodes[0]! })),
      findings: [...uniqueFindings.values()].sort((left, right) => left.id.localeCompare(right.id)),
      unresolvedQuestions: [],
      evidenceSummary: {
        evidenceIds: [...new Set(included.flatMap((entry) => entry.evidenceIds))].sort(),
        limitations: [],
      },
    },
    source: {
      stopReason: "sufficient_evidence",
      safeToProject: true,
    },
    diagnostics: [],
    decisions,
  };
}

function options(overrides: Partial<LegacyProjectionOptions> = {}): LegacyProjectionOptions {
  return {
    effectiveTaskArea: "general",
    requestedTaskType: "implementation",
    durationMs: 0,
    negativeConstraints: [],
    ...overrides,
  };
}

function baseline(): {
  snapshot: RepositorySnapshot;
  projection: ContextProjectionResult;
  target: FileDescriptor;
  support: FileDescriptor;
} {
  const target = file({ id: "file-target", path: "src/target.ts" });
  const support = file({ id: "file-support", path: "src/support.ts" });
  return {
    target,
    support,
    snapshot: snapshot([target, support]),
    projection: projection([
      decision({ entityId: "entity-target", file: target, role: "target" }),
      decision({ entityId: "entity-support", file: support, role: "supporting" }),
    ]),
  };
}

function legacySelection(paths: Array<{
  path: string;
  usage: TaskFileSelection["selectedFiles"][number]["usage"];
  kind?: TaskFileSelection["selectedFiles"][number]["kind"];
}>): TaskFileSelection {
  return {
    selectedFiles: paths.map((entry) => ({
      path: entry.path,
      kind: entry.kind ?? "source",
      usage: entry.usage,
      reason: "Legacy fixture selection.",
      confidence: 0.5,
    })),
    rejectedModelPaths: [],
    source: "deterministic",
    usedFallback: false,
    durationMs: 0,
    notes: [],
    effectiveTaskArea: "general",
    assetMode: "none",
  };
}

let scenarioCount = 0;
function scenario(name: string, run: () => void): void {
  run();
  scenarioCount += 1;
  assert.ok(name.length > 0);
}

const adapter = createLegacyTaskFileSelectionProjection();
const comparison = createOfflineCompatibilityComparison();

scenario("legacy DTO satisfies current TaskFileSelection shape", () => {
  const fixture = baseline();
  const result: TaskFileSelection = adapter.project(fixture.projection, fixture.snapshot, options()).selection;
  assert.ok(Array.isArray(result.selectedFiles));
  assert.equal(result.effectiveTaskArea, "general");
});

scenario("target maps to inspect-and-edit", () => {
  const fixture = baseline();
  const result = adapter.project(fixture.projection, fixture.snapshot, options());
  assert.equal(result.selection.selectedFiles.find((entry) => entry.path === "src/target.ts")?.usage, "inspect-and-edit");
});

scenario("test maps to inspect-and-edit", () => {
  const testFile = file({ id: "file-test", path: "test/target.test.ts", kind: "test" });
  const result = adapter.project(projection([decision({ entityId: "entity-test", file: testFile, role: "test" })]), snapshot([testFile]), options());
  assert.equal(result.selection.selectedFiles[0]?.usage, "inspect-and-edit");
});

scenario("supporting maps to inspect-only", () => {
  const fixture = baseline();
  const result = adapter.project(fixture.projection, fixture.snapshot, options());
  assert.equal(result.selection.selectedFiles.find((entry) => entry.path === "src/support.ts")?.usage, "inspect-only");
});

scenario("asset and configuration references map explicitly", () => {
  const asset = file({ id: "file-asset", path: "assets/icon.svg", kind: "asset" });
  const config = file({ id: "file-config", path: "config/app.json", kind: "configuration" });
  const result = adapter.project(
    projection([
      decision({ entityId: "entity-asset", file: asset, role: "reference" }),
      decision({ entityId: "entity-config", file: config, role: "reference" }),
    ]),
    snapshot([asset, config]),
    options(),
  );
  assert.equal(result.selection.selectedFiles.find((entry) => entry.path === asset.path)?.usage, "asset-reference");
  assert.equal(result.selection.selectedFiles.find((entry) => entry.path === config.path)?.usage, "config-reference");
});

scenario("file kind mapping is exhaustive", () => {
  const kinds: FileDescriptor["kind"][] = [
    "source", "test", "configuration", "documentation", "asset", "data", "generated", "unknown",
  ];
  const files = kinds.map((kind, index) => file({
    id: `file-${kind}`,
    path: `kind/${index}-${kind}.txt`,
    kind,
    generated: kind === "generated",
  }));
  const result = adapter.project(
    projection(files.map((entry, index) => decision({ entityId: `entity-${index}`, file: entry, role: "reference" }))),
    snapshot(files),
    options(),
  );
  assert.deepEqual(
    result.selection.selectedFiles.map((entry) => entry.kind).sort(),
    ["asset", "config", "data", "docs", "runtime", "source", "test", "unknown"].sort(),
  );
});

scenario("unresolved target is never selected", () => {
  const fixture = baseline();
  fixture.projection.decisions[0]!.included = false;
  fixture.projection.decisions[0]!.reasonCodes = ["unresolved_ineligible"];
  fixture.projection.projection.primaryEntities = [];
  fixture.projection.projection.excludedEntities.push({ entityId: "entity-target" as EntityId, reason: "unresolved_ineligible" });
  assert.equal(adapter.project(fixture.projection, fixture.snapshot, options()).selection.selectedFiles.some((entry) => entry.path === fixture.target.path), false);
});

scenario("negative path is never selected", () => {
  const fixture = baseline();
  const result = adapter.project(fixture.projection, fixture.snapshot, options({ negativeConstraints: [{ kind: "path", pattern: "src/target.ts" }] }));
  assert.equal(result.selection.selectedFiles.some((entry) => entry.path === fixture.target.path), false);
});

scenario("secret unreadable and generated targets are never selected", () => {
  const secret = file({ id: "file-secret", path: "src/secret.ts", secretRisk: "known" });
  const unreadable = file({ id: "file-unreadable", path: "src/unreadable.ts", readable: false });
  const generated = file({ id: "file-generated", path: "dist/output.js", kind: "generated", generated: true });
  const result = adapter.project(
    projection([
      decision({ entityId: "entity-secret", file: secret, role: "target" }),
      decision({ entityId: "entity-unreadable", file: unreadable, role: "target" }),
      decision({ entityId: "entity-generated", file: generated, role: "target" }),
    ]),
    snapshot([secret, unreadable, generated]),
    options(),
  );
  assert.deepEqual(result.selection.selectedFiles, []);
});

scenario("each selected file has structured v2 traceability", () => {
  const fixture = baseline();
  const result = adapter.project(fixture.projection, fixture.snapshot, options());
  assert.deepEqual(result.files["src/target.ts"]?.findingIds, ["finding-entity-target"]);
  assert.deepEqual(result.files["src/target.ts"]?.evidenceIds, ["evidence-entity-target"]);
});

scenario("confidence is marked compatibility-derived", () => {
  const fixture = baseline();
  const result = adapter.project(fixture.projection, fixture.snapshot, options());
  assert.ok(result.diagnostics.some((entry) => entry.code === "compatibility_confidence_derived"));
  assert.equal(result.files["src/target.ts"]?.compatibilityDerivedConfidence, 0.99);
});

scenario("compatibility confidence does not alter finding truth", () => {
  const fixture = baseline();
  const before = JSON.stringify(fixture.projection.projection.findings);
  adapter.project(fixture.projection, fixture.snapshot, options());
  assert.equal(JSON.stringify(fixture.projection.projection.findings), before);
});

scenario("source is deterministic and fallback is false", () => {
  const fixture = baseline();
  const selection = adapter.project(fixture.projection, fixture.snapshot, options()).selection;
  assert.equal(selection.source, "deterministic");
  assert.equal(selection.usedFallback, false);
  assert.equal(selection.diagnostics?.selectionSource, "shadow-deterministic");
});

scenario("rejectedModelPaths remains empty", () => {
  const fixture = baseline();
  assert.deepEqual(adapter.project(fixture.projection, fixture.snapshot, options()).selection.rejectedModelPaths, []);
});

scenario("legacy file ordering is stable", () => {
  const fixture = baseline();
  const selected = adapter.project(fixture.projection, fixture.snapshot, options()).selection.selectedFiles;
  assert.deepEqual(selected.map((entry) => entry.path), ["src/target.ts", "src/support.ts"]);
});

scenario("duplicate file roles merge deterministically", () => {
  const shared = file({ id: "file-shared", path: "src/shared.ts" });
  const result = adapter.project(
    projection([
      decision({ entityId: "entity-support", file: shared, role: "supporting" }),
      decision({ entityId: "entity-target", file: shared, role: "target" }),
    ]),
    snapshot([shared]),
    options(),
  );
  assert.equal(result.selection.selectedFiles.length, 1);
  assert.equal(result.files[shared.path]?.role, "target");
  assert.equal(result.files[shared.path]?.findingIds.length, 2);
});

scenario("explicit eligible target remains selected", () => {
  const fixture = baseline();
  fixture.projection.diagnostics.push({
    code: "explicit_target_eligible",
    message: "Explicit target is eligible.",
    entityId: "entity-target" as EntityId,
    evidenceIds: ["evidence-entity-target" as EvidenceId],
    path: fixture.target.path,
    targetKey: "path:src/target.ts",
  });
  assert.equal(adapter.project(fixture.projection, fixture.snapshot, options()).selection.selectedFiles[0]?.path, fixture.target.path);
});

scenario("explicit unresolved target emits exclusion diagnostic", () => {
  const fixture = baseline();
  fixture.projection.decisions[0]!.included = false;
  fixture.projection.decisions[0]!.reasonCodes = ["explicit_target_unresolved"];
  fixture.projection.projection.primaryEntities = [];
  const result = adapter.project(fixture.projection, fixture.snapshot, options());
  assert.ok(result.diagnostics.some((entry) => entry.reasonCode === "explicit_target_unresolved"));
});

scenario("target overlap is computed exactly", () => {
  const fixture = baseline();
  const projected = adapter.project(fixture.projection, fixture.snapshot, options());
  const result = comparison.compare({
    legacySelection: legacySelection([{ path: "src/target.ts", usage: "inspect-and-edit" }]),
    v2Projection: fixture.projection,
    snapshot: fixture.snapshot,
    negativeConstraints: [],
    explicitTargets: [],
  });
  assert.deepEqual(result.overlap.exactTargetPaths, [projected.selection.selectedFiles[0]!.path]);
});

scenario("supporting overlap is computed exactly", () => {
  const fixture = baseline();
  const result = comparison.compare({
    legacySelection: legacySelection([{ path: "src/support.ts", usage: "inspect-only" }]),
    v2Projection: fixture.projection,
    snapshot: fixture.snapshot,
    negativeConstraints: [],
    explicitTargets: [],
  });
  assert.deepEqual(result.overlap.supportingOrReferenceOverlap, ["src/support.ts"]);
});

scenario("safety violations are reported", () => {
  const fixture = baseline();
  const result = comparison.compare({
    legacySelection: legacySelection([{ path: "src/target.ts", usage: "inspect-and-edit" }]),
    v2Projection: fixture.projection,
    snapshot: fixture.snapshot,
    negativeConstraints: [{ kind: "path", pattern: "src/target.ts" }],
    explicitTargets: [],
  });
  assert.deepEqual(result.safety.legacyNegativeConstraintViolations, ["src/target.ts"]);
  assert.deepEqual(result.safety.v2NegativeConstraintViolations, ["src/target.ts"]);
});

scenario("no expert basis yields insufficient evaluation data", () => {
  const fixture = baseline();
  const result = comparison.compare({
    legacySelection: legacySelection([]),
    v2Projection: fixture.projection,
    snapshot: fixture.snapshot,
    negativeConstraints: [],
    explicitTargets: [],
  });
  assert.equal(result.outcome, "insufficient_evaluation_data");
});

scenario("supplied manifest label is preserved", () => {
  const fixture = baseline();
  const result = comparison.compare({
    legacySelection: legacySelection([]),
    v2Projection: fixture.projection,
    snapshot: fixture.snapshot,
    negativeConstraints: [],
    explicitTargets: [],
    evaluationBasis: {
      kind: "manifest",
      referenceId: "manifest-case-1",
      outcome: "v2_better_supported",
    },
  });
  assert.equal(result.outcome, "v2_better_supported");
  assert.equal(result.evaluationBasis?.referenceId, "manifest-case-1");
});

scenario("overlap alone never creates a better-supported verdict", () => {
  const fixture = baseline();
  const result = comparison.compare({
    legacySelection: legacySelection([
      { path: "src/target.ts", usage: "inspect-and-edit" },
      { path: "src/support.ts", usage: "inspect-only" },
    ]),
    v2Projection: fixture.projection,
    snapshot: fixture.snapshot,
    negativeConstraints: [],
    explicitTargets: [],
  });
  assert.equal(result.outcome, "insufficient_evaluation_data");
});

scenario("diagnostics contain no raw source", () => {
  const fixture = baseline();
  const rawMarker = "raw source must not appear";
  const result = adapter.project(fixture.projection, fixture.snapshot, options());
  assert.equal(JSON.stringify(result).includes(rawMarker), false);
});

scenario("input permutation produces identical comparison", () => {
  const fixture = baseline();
  const first = comparison.compare({
    legacySelection: legacySelection([
      { path: "src/target.ts", usage: "inspect-and-edit" },
      { path: "src/support.ts", usage: "inspect-only" },
    ]),
    v2Projection: fixture.projection,
    snapshot: fixture.snapshot,
    negativeConstraints: [],
    explicitTargets: [],
  });
  const permutedProjection = structuredClone(fixture.projection);
  permutedProjection.decisions.reverse();
  permutedProjection.projection.primaryEntities.reverse();
  permutedProjection.projection.supportingEntities.reverse();
  const second = comparison.compare({
    legacySelection: legacySelection([
      { path: "src/support.ts", usage: "inspect-only" },
      { path: "src/target.ts", usage: "inspect-and-edit" },
    ]),
    v2Projection: permutedProjection,
    snapshot: fixture.snapshot,
    negativeConstraints: [],
    explicitTargets: [],
  });
  assert.deepEqual(first, second);
});

scenario("production selector implementation is not invoked", () => {
  const source = fs.readFileSync(
    path.join(repositoryRoot, "server/src/contextEngineV2/adapters/legacySelection/legacyTaskFileSelectionProjection.ts"),
    "utf8",
  );
  assert.equal(source.includes("selectTaskFiles"), false);
  assert.equal(source.includes("finalSelectionDecision"), false);
});

scenario("Context Composer and Task Pack remain untouched", () => {
  const adapterSources = fs.readdirSync(
    path.join(repositoryRoot, "server/src/contextEngineV2/adapters/legacySelection"),
  ).map((name) => fs.readFileSync(
    path.join(repositoryRoot, "server/src/contextEngineV2/adapters/legacySelection", name),
    "utf8",
  )).join("\n");
  assert.equal(adapterSources.includes("contextComposer"), false);
  assert.equal(adapterSources.includes("taskPacks"), false);
});

scenario("v2 execution failure has an explicit outcome", () => {
  const fixture = baseline();
  const result = comparison.compare({
    legacySelection: legacySelection([]),
    v2Projection: fixture.projection,
    snapshot: fixture.snapshot,
    negativeConstraints: [],
    explicitTargets: [],
    v2ExecutionFailed: true,
  });
  assert.equal(result.outcome, "v2_execution_failure");
});

scenario("unsafe included target is rejected by adapter boundary", () => {
  const fixture = baseline();
  fixture.projection.source.safeToProject = false;
  assert.throws(
    () => adapter.project(fixture.projection, fixture.snapshot, options()),
    (error: unknown) => error instanceof LegacyProjectionError && error.code === "invalid_projection",
  );
});

scenario("unsafe included test is rejected by adapter boundary", () => {
  const testFile = file({ id: "file-unsafe-test", path: "test/unsafe.test.ts", kind: "test" });
  const projected = projection([decision({ entityId: "entity-unsafe-test", file: testFile, role: "test" })]);
  projected.source.safeToProject = false;
  assert.throws(() => adapter.project(projected, snapshot([testFile]), options()), LegacyProjectionError);
});

scenario("review-required editable decision is rejected", () => {
  const fixture = baseline();
  fixture.projection.decisions[0]!.reviewRequired = true;
  fixture.projection.projection.primaryEntities[0]!.reviewRequired = true;
  assert.throws(() => adapter.project(fixture.projection, fixture.snapshot, options()), LegacyProjectionError);
});

scenario("review-required test decision is rejected", () => {
  const testFile = file({ id: "file-review-required-test", path: "test/review-required.test.ts", kind: "test" });
  const projected = projection([decision({ entityId: "entity-review-required-test", file: testFile, role: "test", reviewRequired: true })]);
  assert.throws(() => adapter.project(projected, snapshot([testFile]), options()), LegacyProjectionError);
});

scenario("non-sufficient source stop rejects editable projection", () => {
  const fixture = baseline();
  fixture.projection.source.stopReason = "safety_blocked";
  assert.throws(() => adapter.project(fixture.projection, fixture.snapshot, options()), LegacyProjectionError);
});

scenario("target decision missing from primary entities is rejected", () => {
  const fixture = baseline();
  fixture.projection.projection.primaryEntities = [];
  assert.throws(() => adapter.project(fixture.projection, fixture.snapshot, options()), LegacyProjectionError);
});

scenario("test decision placed in reference entities is rejected", () => {
  const testFile = file({ id: "file-misplaced-test", path: "test/misplaced.test.ts", kind: "test" });
  const projected = projection([decision({ entityId: "entity-misplaced-test", file: testFile, role: "test" })]);
  projected.projection.referenceEntities = projected.projection.supportingEntities;
  projected.projection.supportingEntities = [];
  assert.throws(() => adapter.project(projected, snapshot([testFile]), options()), LegacyProjectionError);
});

scenario("projected entity and decision traces must match exactly", () => {
  const fixture = baseline();
  fixture.projection.projection.primaryEntities[0]!.evidenceIds = [];
  assert.throws(() => adapter.project(fixture.projection, fixture.snapshot, options()), LegacyProjectionError);
});

scenario("entity cannot appear in incompatible projection arrays", () => {
  const fixture = baseline();
  fixture.projection.projection.referenceEntities.push({
    ...structuredClone(fixture.projection.projection.primaryEntities[0]!),
    role: "reference",
    reviewRequired: true,
  });
  assert.throws(() => adapter.project(fixture.projection, fixture.snapshot, options()), LegacyProjectionError);
});

scenario("review-purpose test remains inspect-only", () => {
  const testFile = file({ id: "file-review-test", path: "test/review.test.ts", kind: "test" });
  const referenceDecision = decision({ entityId: "entity-review-test", file: testFile, role: "reference", reviewRequired: true });
  const projected = projection([referenceDecision]);
  projected.projection.purpose = "review";
  projected.projection.findings[0]!.type = "test_target";
  projected.projection.findings[0]!.status = "confirmed";
  projected.projection.findings[0]!.authorizationHint = "not_eligible";
  const result = adapter.project(projected, snapshot([testFile]), options());
  assert.equal(result.selection.selectedFiles[0]?.usage, "inspect-only");
});

scenario("legacy target and blocked v2 disagree", () => {
  const fixture = baseline();
  fixture.projection.decisions[0]!.included = false;
  fixture.projection.projection.primaryEntities = [];
  const result = comparison.compare({
    legacySelection: legacySelection([{ path: "src/target.ts", usage: "inspect-and-edit" }]),
    v2Projection: fixture.projection,
    snapshot: fixture.snapshot,
    negativeConstraints: [],
    explicitTargets: [],
  });
  assert.equal(result.safety.safeBlockAgreement, false);
});

scenario("blocked legacy and v2 target disagree", () => {
  const fixture = baseline();
  const result = comparison.compare({
    legacySelection: legacySelection([]),
    v2Projection: fixture.projection,
    snapshot: fixture.snapshot,
    negativeConstraints: [],
    explicitTargets: [],
  });
  assert.equal(result.safety.safeBlockAgreement, false);
});

scenario("both targetless sides agree as blocked", () => {
  const fixture = baseline();
  fixture.projection.decisions[0]!.included = false;
  fixture.projection.projection.primaryEntities = [];
  const result = comparison.compare({
    legacySelection: legacySelection([]),
    v2Projection: fixture.projection,
    snapshot: fixture.snapshot,
    negativeConstraints: [],
    explicitTargets: [],
  });
  assert.equal(result.safety.safeBlockAgreement, true);
});

scenario("both target-bearing sides agree as unblocked", () => {
  const fixture = baseline();
  const result = comparison.compare({
    legacySelection: legacySelection([{ path: "src/target.ts", usage: "inspect-and-edit" }]),
    v2Projection: fixture.projection,
    snapshot: fixture.snapshot,
    negativeConstraints: [],
    explicitTargets: [],
  });
  assert.equal(result.safety.safeBlockAgreement, true);
});

scenario("v2 safety block disagrees with legacy target", () => {
  const fixture = baseline();
  fixture.projection.source.safeToProject = false;
  fixture.projection.source.stopReason = "safety_blocked";
  const result = comparison.compare({
    legacySelection: legacySelection([{ path: "src/target.ts", usage: "inspect-and-edit" }]),
    v2Projection: fixture.projection,
    snapshot: fixture.snapshot,
    negativeConstraints: [],
    explicitTargets: [],
  });
  assert.equal(result.safety.safeBlockAgreement, false);
});

scenario("legacy manual review agrees with v2 safety block", () => {
  const fixture = baseline();
  fixture.projection.source.safeToProject = false;
  fixture.projection.source.stopReason = "safety_blocked";
  const legacy = legacySelection([]);
  legacy.diagnostics = {
    selectorVersion: "fixture",
    safetyProfile: "fixture",
    generationMode: "template",
    model: null,
    requestedTaskType: "implementation",
    effectiveTaskArea: "general",
    usedFallback: false,
    selectionSource: "manual-review",
  };
  const result = comparison.compare({
    legacySelection: legacy,
    v2Projection: fixture.projection,
    snapshot: fixture.snapshot,
    negativeConstraints: [],
    explicitTargets: [],
  });
  assert.equal(result.safety.safeBlockAgreement, true);
});

scenario("backslash legacy path overlaps canonical v2 path", () => {
  const fixture = baseline();
  const result = comparison.compare({
    legacySelection: legacySelection([{ path: "src\\target.ts", usage: "inspect-and-edit" }]),
    v2Projection: fixture.projection,
    snapshot: fixture.snapshot,
    negativeConstraints: [],
    explicitTargets: [],
  });
  assert.deepEqual(result.overlap.exactTargetPaths, ["src/target.ts"]);
});

scenario("explicit path preserved by both sides", () => {
  const fixture = baseline();
  const result = comparison.compare({
    legacySelection: legacySelection([{ path: "src/target.ts", usage: "inspect-and-edit" }]),
    v2Projection: fixture.projection,
    snapshot: fixture.snapshot,
    negativeConstraints: [],
    explicitTargets: [{ kind: "path", path: "src/target.ts" }],
  });
  assert.deepEqual(result.explicitTargetsPreservedByLegacy, ["path:src/target.ts"]);
  assert.deepEqual(result.explicitTargetsPreservedByV2, ["path:src/target.ts"]);
  assert.deepEqual(result.explicitTargetDisagreements, []);
});

scenario("explicit path preserved only by legacy is visible", () => {
  const fixture = baseline();
  fixture.projection.decisions[0]!.included = false;
  fixture.projection.projection.primaryEntities = [];
  const result = comparison.compare({
    legacySelection: legacySelection([{ path: "src/target.ts", usage: "inspect-and-edit" }]),
    v2Projection: fixture.projection,
    snapshot: fixture.snapshot,
    negativeConstraints: [],
    explicitTargets: [{ kind: "path", path: "src/target.ts" }],
  });
  assert.deepEqual(result.explicitTargetDisagreements, ["path:src/target.ts"]);
  assert.equal(result.explicitTargets[0]?.legacyStatus, "preserved");
  assert.equal(result.explicitTargets[0]?.v2Status, "dropped");
});

scenario("explicit path preserved only by v2 is visible", () => {
  const fixture = baseline();
  const result = comparison.compare({
    legacySelection: legacySelection([]),
    v2Projection: fixture.projection,
    snapshot: fixture.snapshot,
    negativeConstraints: [],
    explicitTargets: [{ kind: "path", path: "src/target.ts" }],
  });
  assert.equal(result.explicitTargets[0]?.legacyStatus, "dropped");
  assert.equal(result.explicitTargets[0]?.v2Status, "preserved");
});

scenario("path target does not borrow a global legacy unresolved status", () => {
  const fixture = baseline();
  fixture.projection.decisions[0]!.included = false;
  fixture.projection.projection.primaryEntities = [];
  fixture.projection.diagnostics = [{
    code: "explicit_target_unresolved",
    message: "Explicit target remains unresolved.",
    evidenceIds: [],
    path: "src/target.ts",
    targetKey: "path:src/target.ts",
  }];
  const legacy = legacySelection([]);
  legacy.diagnostics = {
    selectorVersion: "fixture",
    safetyProfile: "fixture",
    generationMode: "template",
    model: null,
    requestedTaskType: "implementation",
    effectiveTaskArea: "general",
    usedFallback: false,
    explicitTargetStatus: "unresolved",
  };
  const result = comparison.compare({
    legacySelection: legacy,
    v2Projection: fixture.projection,
    snapshot: fixture.snapshot,
    negativeConstraints: [],
    explicitTargets: [{ kind: "path", path: "src/target.ts" }],
  });
  assert.equal(result.explicitTargets[0]?.legacyStatus, "dropped");
  assert.equal(result.explicitTargets[0]?.v2Status, "unresolved");
});

scenario("explicit disagreement does not invent a quality winner", () => {
  const fixture = baseline();
  const result = comparison.compare({
    legacySelection: legacySelection([]),
    v2Projection: fixture.projection,
    snapshot: fixture.snapshot,
    negativeConstraints: [],
    explicitTargets: [{ kind: "path", path: "src/target.ts" }],
  });
  assert.equal(result.explicitTargetDisagreements.length, 1);
  assert.equal(result.outcome, "insufficient_evaluation_data");
});

scenario("unresolved symbol comparison remains honestly unknown", () => {
  const fixture = baseline();
  const result = comparison.compare({
    legacySelection: legacySelection([]),
    v2Projection: fixture.projection,
    snapshot: fixture.snapshot,
    negativeConstraints: [],
    explicitTargets: [{ kind: "symbol", symbol: "UnresolvedSymbol" }],
  });
  assert.equal(result.explicitTargets[0]?.legacyStatus, "unknown");
  assert.equal(result.explicitTargets[0]?.v2Status, "unknown");
  assert.equal(result.explicitTargets[0]?.resolvedPath, undefined);
});

scenario("finding attached to another entity is rejected", () => {
  const fixture = baseline();
  fixture.projection.projection.findings[0]!.entityIds = ["entity-other" as EntityId];
  assert.throws(() => adapter.project(fixture.projection, fixture.snapshot, options()), LegacyProjectionError);
});

scenario("decision evidence absent from its findings is rejected", () => {
  const fixture = baseline();
  fixture.projection.projection.findings[0]!.evidenceIds = [];
  assert.throws(() => adapter.project(fixture.projection, fixture.snapshot, options()), LegacyProjectionError);
});

scenario("cross-snapshot finding is rejected", () => {
  const fixture = baseline();
  fixture.projection.projection.findings[0]!.snapshotId = "snapshot-other" as SnapshotId;
  assert.throws(() => adapter.project(fixture.projection, fixture.snapshot, options()), LegacyProjectionError);
});

scenario("blocking editable finding limitation is rejected", () => {
  const fixture = baseline();
  fixture.projection.projection.findings
    .find((finding) => finding.type === "implementation_target")!
    .limitations = ["blocking_projection_gap"];
  assert.throws(() => adapter.project(fixture.projection, fixture.snapshot, options()), LegacyProjectionError);
});

scenario("supporting reason alone cannot authorize target", () => {
  const fixture = baseline();
  fixture.projection.decisions[0]!.reasonCodes = ["confirmed_supporting_context"];
  fixture.projection.projection.primaryEntities[0]!.reason = "confirmed_supporting_context";
  assert.throws(() => adapter.project(fixture.projection, fixture.snapshot, options()), LegacyProjectionError);
});

scenario("test cannot use implementation-target finding", () => {
  const testFile = file({ id: "file-wrong-test-finding", path: "test/wrong.test.ts", kind: "test" });
  const projected = projection([decision({ entityId: "entity-wrong-test-finding", file: testFile, role: "test" })]);
  projected.projection.findings[0]!.type = "implementation_target";
  assert.throws(() => adapter.project(projected, snapshot([testFile]), options()), LegacyProjectionError);
});

scenario("exact target finding entity and evidence binding remains editable", () => {
  const fixture = baseline();
  assert.equal(
    adapter.project(fixture.projection, fixture.snapshot, options()).selection.selectedFiles[0]?.usage,
    "inspect-and-edit",
  );
});

scenario("exact test finding entity and evidence binding remains editable", () => {
  const testFile = file({ id: "file-exact-test", path: "test/exact.test.ts", kind: "test" });
  const projected = projection([decision({ entityId: "entity-exact-test", file: testFile, role: "test" })]);
  assert.equal(
    adapter.project(projected, snapshot([testFile]), options()).selection.selectedFiles[0]?.usage,
    "inspect-and-edit",
  );
});

scenario("path target and unknown symbol use their own diagnostics", () => {
  const fixture = baseline();
  fixture.projection.diagnostics = [
    {
      code: "explicit_target_eligible",
      message: "Path is preserved.",
      evidenceIds: ["evidence-entity-target" as EvidenceId],
      path: "src/target.ts",
      targetKey: "path:src/target.ts",
    },
    {
      code: "explicit_target_unknown",
      message: "Symbol is unknown.",
      evidenceIds: [],
      targetKey: "symbol:MissingSymbol",
    },
  ];
  const result = comparison.compare({
    legacySelection: legacySelection([{ path: "src/target.ts", usage: "inspect-and-edit" }]),
    v2Projection: fixture.projection,
    snapshot: fixture.snapshot,
    negativeConstraints: [],
    explicitTargets: [
      { kind: "path", path: "src/target.ts" },
      { kind: "symbol", symbol: "MissingSymbol" },
    ],
  });
  assert.equal(result.explicitTargets.find((entry) => entry.kind === "path")?.v2Status, "preserved");
  assert.equal(result.explicitTargets.find((entry) => entry.kind === "symbol")?.v2Status, "unknown");
});

scenario("two symbols cannot borrow keyed outcomes", () => {
  const fixture = baseline();
  fixture.projection.diagnostics = [
    {
      code: "explicit_target_eligible",
      message: "First symbol is preserved.",
      evidenceIds: ["evidence-entity-target" as EvidenceId],
      path: "src/target.ts",
      targetKey: "symbol:FirstSymbol",
    },
    {
      code: "explicit_target_unresolved",
      message: "Second symbol is unresolved.",
      evidenceIds: [],
      targetKey: "symbol:SecondSymbol",
    },
  ];
  const result = comparison.compare({
    legacySelection: legacySelection([]),
    v2Projection: fixture.projection,
    snapshot: fixture.snapshot,
    negativeConstraints: [],
    explicitTargets: [
      { kind: "symbol", symbol: "FirstSymbol" },
      { kind: "symbol", symbol: "SecondSymbol" },
    ],
  });
  assert.equal(result.explicitTargets.find((entry) => entry.targetKey === "symbol:FirstSymbol")?.v2Status, "preserved");
  assert.equal(result.explicitTargets.find((entry) => entry.targetKey === "symbol:SecondSymbol")?.v2Status, "unresolved");
});

scenario("unrelated path diagnostic cannot hide keyed unresolved target", () => {
  const fixture = baseline();
  fixture.projection.decisions[0]!.included = false;
  fixture.projection.projection.primaryEntities = [];
  fixture.projection.diagnostics = [
    {
      code: "evidence_entity_mismatch",
      message: "Unrelated entity evidence mismatch.",
      evidenceIds: [],
      path: "src/target.ts",
    },
    {
      code: "explicit_target_unresolved",
      message: "Exact target remains unresolved.",
      evidenceIds: [],
      path: "src/target.ts",
      targetKey: "path:src/target.ts",
    },
  ];
  const result = comparison.compare({
    legacySelection: legacySelection([]),
    v2Projection: fixture.projection,
    snapshot: fixture.snapshot,
    negativeConstraints: [],
    explicitTargets: [{ kind: "path", path: "src/target.ts" }],
  });
  assert.equal(result.explicitTargets[0]?.v2Status, "unresolved");
});

scenario("explicit target comparison is input-order independent", () => {
  const fixture = baseline();
  fixture.projection.diagnostics = [
    {
      code: "explicit_target_eligible",
      message: "Path is preserved.",
      evidenceIds: ["evidence-entity-target" as EvidenceId],
      path: "src/target.ts",
      targetKey: "path:src/target.ts",
    },
    {
      code: "explicit_target_unknown",
      message: "Symbol is unknown.",
      evidenceIds: [],
      targetKey: "symbol:MissingSymbol",
    },
  ];
  const explicitTargets = [
    { kind: "path" as const, path: "src/target.ts" },
    { kind: "symbol" as const, symbol: "MissingSymbol" },
  ];
  const compare = (targets: typeof explicitTargets) => comparison.compare({
    legacySelection: legacySelection([{ path: "src/target.ts", usage: "inspect-and-edit" }]),
    v2Projection: fixture.projection,
    snapshot: fixture.snapshot,
    negativeConstraints: [],
    explicitTargets: targets,
  });
  assert.deepEqual(compare(explicitTargets), compare([...explicitTargets].reverse()));
});

scenario("test-only editable projection is unblocked on both sides", () => {
  const testFile = file({ id: "file-comparison-test", path: "test/comparison.test.ts", kind: "test" });
  const projected = projection([
    decision({ entityId: "entity-comparison-test", file: testFile, role: "test" }),
  ]);
  const result = comparison.compare({
    legacySelection: legacySelection([{
      path: testFile.normalizedPath,
      usage: "inspect-and-edit",
      kind: "test",
    }]),
    v2Projection: projected,
    snapshot: snapshot([testFile]),
    negativeConstraints: [],
    explicitTargets: [],
  });
  assert.equal(result.safety.legacyBlocked, false);
  assert.equal(result.safety.v2Blocked, false);
  assert.equal(result.safety.safeBlockAgreement, true);
});

scenario("test path is reported separately and as editable overlap", () => {
  const testFile = file({ id: "file-comparison-test-path", path: "test/path.test.ts", kind: "test" });
  const result = comparison.compare({
    legacySelection: legacySelection([{
      path: testFile.normalizedPath,
      usage: "inspect-and-edit",
      kind: "test",
    }]),
    v2Projection: projection([
      decision({ entityId: "entity-comparison-test-path", file: testFile, role: "test" }),
    ]),
    snapshot: snapshot([testFile]),
    negativeConstraints: [],
    explicitTargets: [],
  });
  assert.deepEqual(result.legacy.testPaths, [testFile.normalizedPath]);
  assert.deepEqual(result.v2.testPaths, [testFile.normalizedPath]);
  assert.deepEqual(result.legacy.editablePaths, [testFile.normalizedPath]);
  assert.deepEqual(result.v2.editablePaths, [testFile.normalizedPath]);
  assert.deepEqual(result.overlap.exactEditablePaths, [testFile.normalizedPath]);
  assert.deepEqual(result.overlap.exactTargetPaths, []);
});

scenario("explicit path resolved as test is preserved by both sides", () => {
  const testFile = file({ id: "file-explicit-comparison-test", path: "test/explicit.test.ts", kind: "test" });
  const projected = projection([
    decision({ entityId: "entity-explicit-comparison-test", file: testFile, role: "test" }),
  ]);
  projected.diagnostics = [{
    code: "explicit_target_eligible",
    message: "Explicit test target is preserved.",
    evidenceIds: ["evidence-entity-explicit-comparison-test" as EvidenceId],
    path: testFile.normalizedPath,
    targetKey: `path:${testFile.normalizedPath}`,
  }];
  const result = comparison.compare({
    legacySelection: legacySelection([{
      path: testFile.normalizedPath,
      usage: "inspect-and-edit",
      kind: "test",
    }]),
    v2Projection: projected,
    snapshot: snapshot([testFile]),
    negativeConstraints: [],
    explicitTargets: [{ kind: "path", path: testFile.normalizedPath }],
  });
  assert.equal(result.explicitTargets[0]?.legacyStatus, "preserved");
  assert.equal(result.explicitTargets[0]?.v2Status, "preserved");
});

function legacyMatchedSymbolSelection(path: string): TaskFileSelection {
  const selection = legacySelection([{ path, usage: "inspect-and-edit" }]);
  selection.diagnostics = {
    selectorVersion: "fixture",
    safetyProfile: "fixture",
    generationMode: "template",
    model: null,
    requestedTaskType: "implementation",
    effectiveTaskArea: "general",
    usedFallback: false,
    explicitTargetStatus: "matched",
    explicitTargetPath: path,
  };
  return selection;
}

scenario("multiple symbols cannot share one global legacy matched path", () => {
  const fixture = baseline();
  const result = comparison.compare({
    legacySelection: legacyMatchedSymbolSelection("src/target.ts"),
    v2Projection: fixture.projection,
    snapshot: fixture.snapshot,
    negativeConstraints: [],
    explicitTargets: [
      { kind: "symbol", symbol: "FirstSymbol" },
      { kind: "symbol", symbol: "SecondSymbol" },
    ],
  });
  assert.deepEqual(result.explicitTargets.map((entry) => entry.legacyStatus), ["unknown", "unknown"]);
});

scenario("single symbol can use one exact legacy matched path", () => {
  const fixture = baseline();
  const result = comparison.compare({
    legacySelection: legacyMatchedSymbolSelection("src/target.ts"),
    v2Projection: fixture.projection,
    snapshot: fixture.snapshot,
    negativeConstraints: [],
    explicitTargets: [{ kind: "symbol", symbol: "OnlySymbol" }],
  });
  assert.equal(result.explicitTargets[0]?.legacyStatus, "preserved");
  assert.equal(result.explicitTargets[0]?.resolvedPath, "src/target.ts");
});

scenario("path target is independent and symbol cannot borrow its legacy result", () => {
  const fixture = baseline();
  const result = comparison.compare({
    legacySelection: legacyMatchedSymbolSelection("src/target.ts"),
    v2Projection: fixture.projection,
    snapshot: fixture.snapshot,
    negativeConstraints: [],
    explicitTargets: [
      { kind: "path", path: "src/target.ts" },
      { kind: "symbol", symbol: "UnrelatedSymbol" },
    ],
  });
  assert.equal(result.explicitTargets.find((entry) => entry.kind === "path")?.legacyStatus, "preserved");
  assert.equal(result.explicitTargets.find((entry) => entry.kind === "symbol")?.legacyStatus, "unknown");
});

scenario("multi-target legacy comparison is input-order independent", () => {
  const fixture = baseline();
  const targets = [
    { kind: "symbol" as const, symbol: "FirstSymbol" },
    { kind: "symbol" as const, symbol: "SecondSymbol" },
    { kind: "path" as const, path: "src/target.ts" },
  ];
  const compare = (explicitTargets: typeof targets) => comparison.compare({
    legacySelection: legacyMatchedSymbolSelection("src/target.ts"),
    v2Projection: fixture.projection,
    snapshot: fixture.snapshot,
    negativeConstraints: [],
    explicitTargets,
  });
  assert.deepEqual(compare(targets), compare([...targets].reverse()));
});

assert.equal(scenarioCount, 71);
console.log(`Context Engine v2 legacy compatibility smoke passed: ${scenarioCount} scenarios.`);
