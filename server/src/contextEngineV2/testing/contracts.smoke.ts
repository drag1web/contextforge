import assert from "node:assert/strict";

import {
  ContextEngineNotImplementedError,
  InvalidInvestigationRequestError,
  createContextEngineV2,
  type ClaimRecord,
  type ContextEngineV2,
  type EvidenceRecord,
  type FactId,
  type Finding,
  type InvestigationRequest,
  type InvestigationRequestId,
  type RepositoryEntity,
  type RepositoryFact,
  type RepositoryRelation,
  type RepositorySnapshot,
  type SnapshotId,
  type EntityId,
  type EvidenceId,
  type FindingId,
} from "../index.js";
import {
  InvariantViolationError,
  assertEvidenceSnapshotConsistency,
  assertFactSnapshotConsistency,
  assertFindingEvidenceConsistency,
  isJsonSafeValue,
  validateInvestigationRequest,
  validateRepositorySnapshot,
} from "../domain/index.js";
import {
  CollectingTraceSink,
  FixedClock,
  SequenceIdGenerator,
} from "./fakes.js";

function id<Id extends string>(value: string): Id {
  return value as Id;
}

const snapshotId = id<SnapshotId>("snapshot-fixture-1");
const fileId = id<EntityId>("entity-file-1");
const entityId = id<EntityId>("entity-symbol-1");
const factId = id<FactId>("fact-1");

function snapshot(): RepositorySnapshot {
  return {
    id: snapshotId,
    projectId: "project-fixture",
    rootUri: "repository://fixture",
    rootFingerprint: "root-fingerprint-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    source: "test_fixture",
    files: [
      {
        id: fileId,
        snapshotId,
        path: "src/feature.ts",
        normalizedPath: "src/feature.ts",
        extension: ".ts",
        language: "typescript",
        kind: "source",
        sizeBytes: 42,
        contentFingerprint: "content-fingerprint-1",
        readable: true,
        generated: false,
        secretRisk: "none",
        attributes: {},
      },
    ],
    limits: { excludedPatterns: [] },
    truncation: { truncated: false, reasons: [] },
    metadata: {},
  };
}

function request(): InvestigationRequest {
  return {
    requestId: id<InvestigationRequestId>("request-1"),
    projectId: "project-fixture",
    task: { normalizedTask: "Identify the owner of the requested behavior." },
    snapshot: snapshot(),
    explicitTargets: [],
    negativeConstraints: [],
    budget: {
      maxOperations: 1,
      maxFileReads: 1,
      maxFileBytes: 1024,
      maxParsedFiles: 1,
      maxRelationshipHops: 1,
      maxWallTimeMs: 100,
      maxPlannerRounds: 1,
      maxConcurrentOperations: 1,
    },
    purpose: "implementation_context",
  };
}

function entity(): RepositoryEntity {
  return {
    id: entityId,
    snapshotId,
    kind: "symbol",
    displayName: "performWork",
    fileId,
  };
}

function fact(): RepositoryFact {
  return {
    kind: "fact",
    id: factId,
    snapshotId,
    subject: entity(),
    predicate: "exports",
    object: { type: "boolean", value: true },
    source: {
      kind: "source_span",
      snapshotId,
      fileId,
      path: "src/feature.ts",
      startLine: 1,
      startColumn: 1,
      endLine: 1,
      endColumn: 10,
      contentFingerprint: "content-fingerprint-1",
    },
    provenance: {
      extractorId: "fixture-extractor",
      extractorVersion: "1",
      method: "parser",
      observedAt: "2026-01-01T00:00:00.000Z",
    },
    strength: "exact",
    status: "active",
    attributes: {},
  };
}

function evidence(): EvidenceRecord {
  return {
    id: id<EvidenceId>("evidence-1"),
    snapshotId,
    role: "supports",
    factIds: [factId],
    sourceSpans: [],
    summary: "Fixture evidence",
    strength: "conclusive",
    independenceGroup: "fixture-source-1",
    freshness: {
      snapshotId,
      current: true,
      reason: "snapshot_match",
    },
    limitations: [],
  };
}

function factWithSpan(
  overrides: Partial<{
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  }>,
): RepositoryFact {
  const currentFact = fact();
  if (currentFact.source.kind !== "source_span") {
    throw new Error("Expected source-span fixture.");
  }
  return {
    ...currentFact,
    source: {
      ...currentFact.source,
      ...overrides,
    },
  };
}

function testPublicContractsCompileAndSerialize(): void {
  const relatedEntity: RepositoryEntity = {
    ...entity(),
    id: id<EntityId>("entity-module-1"),
    kind: "module",
    displayName: "feature",
  };
  const relation: RepositoryRelation = {
    ...fact(),
    kind: "relation",
    object: relatedEntity,
    predicate: "contains",
  };
  const claim: ClaimRecord = {
    id: id("claim-1"),
    snapshotId,
    type: "behavior",
    statement: "The module contains the symbol.",
    subject: relatedEntity,
    object: entity(),
    supportingEvidenceIds: [],
    contradictingEvidenceIds: [],
    status: "proposed",
    derivation: {
      ruleId: "fixture-rule",
      ruleVersion: "1",
      inputFactIds: [relation.id],
    },
  };
  const serialized = JSON.stringify({ snapshot: snapshot(), relation, claim });
  assert.deepEqual(JSON.parse(serialized).relation.kind, "relation");
}

function testRequestValidationIsPredictable(): void {
  const empty = validateInvestigationRequest({});
  assert.equal(empty.valid, false);
  assert.ok(empty.issues.some((issue) => issue.path === "requestId"));
  assert.ok(empty.issues.some((issue) => issue.path === "snapshot"));

  const minimal = validateInvestigationRequest(request());
  assert.deepEqual(minimal, { valid: true, issues: [] });
}

async function testValidRequestReportsNotImplemented(): Promise<void> {
  const traceSink = new CollectingTraceSink();
  const engine: ContextEngineV2 = createContextEngineV2({
    clock: new FixedClock("2026-01-01T00:00:00.000Z"),
    ids: new SequenceIdGenerator(),
    traceSink,
  });
  let returned = false;
  let caught: unknown;
  try {
    await engine.investigate(request());
    returned = true;
  } catch (error) {
    caught = error;
  }

  assert.equal(returned, false);
  assert.ok(caught instanceof ContextEngineNotImplementedError);
  if (!(caught instanceof ContextEngineNotImplementedError)) {
    throw caught;
  }
  assert.equal(caught.code, "not_implemented");
  assert.equal(caught.stage, "CE2-00");
  assert.match(caught.message, /execution path is not implemented/i);
  assert.notEqual(caught.code, "internal_error");
  assert.deepEqual(traceSink.events, []);
}

async function testInvalidRequestStillFailsValidation(): Promise<void> {
  const engine = createContextEngineV2({
    clock: new FixedClock("2026-01-01T00:00:00.000Z"),
    ids: new SequenceIdGenerator(),
  });
  await assert.rejects(
    engine.investigate({} as InvestigationRequest),
    (error: unknown) =>
      error instanceof InvalidInvestigationRequestError &&
      error.code === "invalid_contract",
  );
}

function testCrossSnapshotFactFails(): void {
  const invalidFact: RepositoryFact = {
    ...fact(),
    snapshotId: id<SnapshotId>("snapshot-other"),
  };
  assert.throws(
    () => assertFactSnapshotConsistency(invalidFact, snapshot()),
    InvariantViolationError,
  );
}

function testModelProposedFactFails(): void {
  const invalidFact = {
    ...fact(),
    strength: "weak",
    provenance: {
      ...fact().provenance,
      method: "model_proposed",
    },
  } as unknown as RepositoryFact;
  assert.throws(
    () => assertFactSnapshotConsistency(invalidFact, snapshot()),
    InvariantViolationError,
  );
}

function testReversedSameLineSourceSpanFails(): void {
  const invalidFact = factWithSpan({
    startLine: 1,
    startColumn: 10,
    endLine: 1,
    endColumn: 1,
  });
  assert.throws(
    () => assertFactSnapshotConsistency(invalidFact, snapshot()),
    InvariantViolationError,
  );
}

function testNaNSourceSpanCoordinateFails(): void {
  assert.throws(
    () =>
      assertFactSnapshotConsistency(
        factWithSpan({ startLine: Number.NaN }),
        snapshot(),
      ),
    InvariantViolationError,
  );
}

function testInfiniteSourceSpanCoordinateFails(): void {
  assert.throws(
    () =>
      assertFactSnapshotConsistency(
        factWithSpan({ endColumn: Number.POSITIVE_INFINITY }),
        snapshot(),
      ),
    InvariantViolationError,
  );
}

function testFractionalSourceSpanCoordinateFails(): void {
  assert.throws(
    () =>
      assertFactSnapshotConsistency(
        factWithSpan({ startColumn: 1.5 }),
        snapshot(),
      ),
    InvariantViolationError,
  );
}

function testJsonSafetyRules(): void {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;

  assert.equal(
    isJsonSafeValue({
      text: "value",
      enabled: true,
      empty: null,
      count: 1,
      nested: [{ value: "ok" }],
    }),
    true,
  );
  for (const unsafe of [
    undefined,
    () => "unsafe",
    Symbol("unsafe"),
    1n,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    new Date("2026-01-01T00:00:00.000Z"),
    cyclic,
  ]) {
    assert.equal(isJsonSafeValue(unsafe), false);
  }
}

function testRepositoryRelativePosixPaths(): void {
  for (const invalidPath of [
    "/repo/feature.ts",
    "src//feature.ts",
    "src/feature.ts/",
    "src/\u0000feature.ts",
    "src/./feature.ts",
    "src/../feature.ts",
    "../feature.ts",
    "C:\\repo\\feature.ts",
  ]) {
    const currentSnapshot = snapshot();
    const validation = validateRepositorySnapshot({
      ...currentSnapshot,
      files: [
        {
          ...currentSnapshot.files[0],
          path: invalidPath,
          normalizedPath: invalidPath,
        },
      ],
    });
    assert.equal(validation.valid, false, `Expected ${invalidPath} to fail.`);
  }
  assert.deepEqual(validateRepositorySnapshot(snapshot()), {
    valid: true,
    issues: [],
  });
}

function testJsonArrayWithHiddenFunctionPropertyFails(): void {
  const value: unknown[] = ["safe"];
  Object.defineProperty(value, "hidden", {
    value: () => "unsafe",
    enumerable: false,
  });
  assert.equal(isJsonSafeValue(value), false);
}

function testJsonArrayWithHiddenAccessorFails(): void {
  const value: unknown[] = ["safe"];
  let accessed = false;
  Object.defineProperty(value, "hidden", {
    get() {
      accessed = true;
      return "unsafe";
    },
    enumerable: false,
  });
  assert.equal(isJsonSafeValue(value), false);
  assert.equal(accessed, false);
}

function testSparseSnapshotFilesFail(): void {
  const files = new Array<RepositorySnapshot["files"][number]>(1);
  const validation = validateRepositorySnapshot({ ...snapshot(), files });
  assert.equal(validation.valid, false);
  assert.ok(
    validation.issues.some(
      (entry) =>
        entry.path === "snapshot.files" && entry.code === "invalid_value",
    ),
  );
}

function testSparseExcludedPatternsFail(): void {
  const excludedPatterns = new Array<string>(1);
  const validation = validateRepositorySnapshot({
    ...snapshot(),
    limits: { excludedPatterns },
  });
  assert.equal(validation.valid, false);
  assert.ok(
    validation.issues.some(
      (entry) =>
        entry.path === "snapshot.limits.excludedPatterns" &&
        entry.code === "invalid_value",
    ),
  );
}

function testDenseJsonArrayPasses(): void {
  assert.equal(
    isJsonSafeValue(["value", 1, true, null, { nested: ["ok"] }]),
    true,
  );
}

function testUnsafeSnapshotMetadataFails(): void {
  const validation = validateRepositorySnapshot({
    ...snapshot(),
    metadata: { nested: { callback: () => "unsafe" } },
  });
  assert.equal(validation.valid, false);
  assert.ok(
    validation.issues.some(
      (entry) =>
        entry.path === "snapshot.metadata" && entry.code === "not_json_safe",
    ),
  );
}

function testNonFiniteSnapshotMetadataFails(): void {
  const validation = validateRepositorySnapshot({
    ...snapshot(),
    metadata: {
      notANumber: Number.NaN,
      positiveInfinity: Number.POSITIVE_INFINITY,
      negativeInfinity: Number.NEGATIVE_INFINITY,
    },
  });
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((entry) => entry.path === "snapshot.metadata"));
}

function testDuplicateNormalizedPathsFail(): void {
  const currentSnapshot = snapshot();
  const validation = validateRepositorySnapshot({
    ...currentSnapshot,
    files: [
      currentSnapshot.files[0],
      {
        ...currentSnapshot.files[0],
        id: id<EntityId>("entity-file-2"),
        path: "src/feature-copy.ts",
      },
    ],
  });
  assert.equal(validation.valid, false);
  assert.ok(
    validation.issues.some(
      (entry) =>
        entry.path === "snapshot.files[1].normalizedPath" &&
        entry.code === "duplicate",
    ),
  );
}

function testSnapshotScalarAndAttributeFieldsAreValidated(): void {
  const currentSnapshot = snapshot();
  const validation = validateRepositorySnapshot({
    ...currentSnapshot,
    files: [
      {
        ...currentSnapshot.files[0],
        extension: 1,
        language: {},
        attributes: { missing: undefined },
      },
    ],
    limits: { excludedPatterns: ["dist/**", 1] },
  });
  assert.equal(validation.valid, false);
  for (const expectedPath of [
    "snapshot.files[0].extension",
    "snapshot.files[0].language",
    "snapshot.files[0].attributes",
    "snapshot.limits.excludedPatterns[1]",
  ]) {
    assert.ok(validation.issues.some((entry) => entry.path === expectedPath));
  }
}

function testFactJsonPayloadsAreValidated(): void {
  const unsafeAttributes = {
    ...fact(),
    attributes: { callback: () => "unsafe" },
  } as unknown as RepositoryFact;
  assert.throws(
    () => assertFactSnapshotConsistency(unsafeAttributes, snapshot()),
    InvariantViolationError,
  );

  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const unsafeLiteral = {
    ...fact(),
    object: { type: "json", value: cyclic },
  } as unknown as RepositoryFact;
  assert.throws(
    () => assertFactSnapshotConsistency(unsafeLiteral, snapshot()),
    InvariantViolationError,
  );
}

function testEvidenceRejectsCrossSnapshotFact(): void {
  const otherSnapshotId = id<SnapshotId>("snapshot-other");
  const crossSnapshotFact: RepositoryFact = {
    ...fact(),
    snapshotId: otherSnapshotId,
    subject: { ...entity(), snapshotId: otherSnapshotId },
    source: { ...fact().source, snapshotId: otherSnapshotId },
  };
  assert.throws(
    () =>
      assertEvidenceSnapshotConsistency(
        evidence(),
        [crossSnapshotFact],
        snapshot(),
      ),
    InvariantViolationError,
  );
}

function testContradictoryFreshnessFlagsFail(): void {
  for (const freshness of [
    { snapshotId, current: true, reason: "stale" as const },
    { snapshotId, current: false, reason: "snapshot_match" as const },
  ]) {
    assert.throws(
      () =>
        assertEvidenceSnapshotConsistency(
          { ...evidence(), freshness },
          [fact()],
          snapshot(),
        ),
      InvariantViolationError,
    );
  }
}

function testConfirmedFindingRequiresEvidence(): void {
  const finding: Finding = {
    id: id<FindingId>("finding-1"),
    snapshotId,
    type: "implementation_target",
    statement: "The symbol owns the behavior.",
    entityIds: [entityId],
    evidenceIds: [],
    status: "confirmed",
    limitations: [],
    authorizationHint: "eligible",
  };
  assert.throws(
    () => assertFindingEvidenceConsistency(finding, [], snapshot()),
    InvariantViolationError,
  );
}

async function main(): Promise<void> {
  testPublicContractsCompileAndSerialize();
  testRequestValidationIsPredictable();
  await testValidRequestReportsNotImplemented();
  await testInvalidRequestStillFailsValidation();
  testCrossSnapshotFactFails();
  testModelProposedFactFails();
  testReversedSameLineSourceSpanFails();
  testNaNSourceSpanCoordinateFails();
  testInfiniteSourceSpanCoordinateFails();
  testFractionalSourceSpanCoordinateFails();
  testJsonSafetyRules();
  testRepositoryRelativePosixPaths();
  testJsonArrayWithHiddenFunctionPropertyFails();
  testJsonArrayWithHiddenAccessorFails();
  testSparseSnapshotFilesFail();
  testSparseExcludedPatternsFail();
  testDenseJsonArrayPasses();
  testUnsafeSnapshotMetadataFails();
  testNonFiniteSnapshotMetadataFails();
  testDuplicateNormalizedPathsFail();
  testSnapshotScalarAndAttributeFieldsAreValidated();
  testFactJsonPayloadsAreValidated();
  testEvidenceRejectsCrossSnapshotFact();
  testContradictoryFreshnessFlagsFail();
  testConfirmedFindingRequiresEvidence();
  console.log("Context Engine v2 contracts smoke passed: 25 scenarios.");
}

await main();
