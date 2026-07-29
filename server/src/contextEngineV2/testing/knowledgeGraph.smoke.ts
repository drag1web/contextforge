import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  KnowledgeGraphStoreError,
  createFactExtractorRegistry,
  createInMemoryKnowledgeGraphStore,
  createTypeScriptJavaScriptFactExtractor,
} from "../adapters/index.js";
import type {
  EntityId,
  FactId,
  FactRecord,
  FactStatus,
  RepositoryEntity,
  RepositorySnapshot,
  SnapshotId,
} from "../contracts/index.js";
import {
  assertFactSnapshotConsistency,
  assertRepositoryEntitySnapshotConsistency,
} from "../domain/index.js";
import { containsSecretLikeSemanticValue } from "../domain/semanticLiteralSafety.js";
import { FixedClock } from "./fakes.js";

const timestamp = "2026-01-01T00:00:00.000Z";

function snapshot(
  suffix: string,
  contentFingerprint = `content-sha256:${suffix}`,
): RepositorySnapshot {
  const snapshotId = `snapshot-${suffix}` as SnapshotId;
  return {
    id: snapshotId,
    projectId: `project-${suffix}`,
    rootUri: `repository://${suffix}`,
    rootFingerprint: `root-${suffix}`,
    createdAt: timestamp,
    source: "test_fixture",
    files: [
      {
        id: `file-${suffix}` as EntityId,
        snapshotId,
        path: "src/module.ts",
        normalizedPath: "src/module.ts",
        extension: ".ts",
        language: "typescript",
        kind: "source",
        sizeBytes: 32,
        contentFingerprint,
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

function entity(
  source: RepositorySnapshot,
  suffix: string,
  kind: RepositoryEntity["kind"] = "symbol",
): RepositoryEntity {
  return {
    id: `entity-${source.id}-${suffix}` as EntityId,
    snapshotId: source.id,
    kind,
    displayName: suffix,
    canonicalName: `${source.files[0]?.path}#${suffix}`,
    fileId: source.files[0]!.id,
    attributes: {},
  };
}

function relation(
  source: RepositorySnapshot,
  id: string,
  subject: RepositoryEntity,
  object: RepositoryEntity,
  predicate = "imports",
  status: FactStatus = "active",
): FactRecord {
  return {
    kind: "relation",
    id: id as FactId,
    snapshotId: source.id,
    subject,
    predicate,
    object,
    source: {
      kind: "source_span",
      snapshotId: source.id,
      fileId: source.files[0]!.id,
      path: source.files[0]!.normalizedPath,
      startLine: 1,
      startColumn: 1,
      endLine: 1,
      endColumn: 5,
      contentFingerprint: source.files[0]!.contentFingerprint,
      excerptHash: `sha256:${"a".repeat(64)}`,
    },
    provenance: {
      extractorId: "fixture-extractor",
      extractorVersion: "1",
      method: "compiler_api",
      observedAt: timestamp,
    },
    strength: "exact",
    status,
    attributes: {},
  };
}

function literalFact(
  source: RepositorySnapshot,
  id: string,
  subject: RepositoryEntity,
  object: unknown,
): FactRecord {
  const placeholder = entity(source, `${id}-placeholder`);
  return {
    ...relation(source, id, subject, placeholder, "configures"),
    kind: "fact",
    object,
  } as unknown as FactRecord;
}

function snapshotWithTwoFiles(suffix: string): RepositorySnapshot {
  const source = snapshot(suffix);
  source.files.push({
    ...source.files[0]!,
    id: `file-${suffix}-secondary` as EntityId,
    path: "src/secondary.ts",
    normalizedPath: "src/secondary.ts",
    contentFingerprint: `content-sha256:${suffix}-secondary`,
  });
  return source;
}

function withSourceFile(
  fact: FactRecord,
  source: RepositorySnapshot,
  fileIndex: number,
): FactRecord {
  const file = source.files[fileIndex]!;
  return {
    ...fact,
    source: {
      kind: "source_span",
      snapshotId: source.id,
      fileId: file.id,
      path: file.normalizedPath,
      startLine: 1,
      startColumn: 1,
      endLine: 1,
      endColumn: 5,
      contentFingerprint: file.contentFingerprint,
      excerptHash: `sha256:${"b".repeat(64)}`,
    },
  };
}

async function initializedGraph(suffix: string) {
  const source = snapshot(suffix);
  const store = createInMemoryKnowledgeGraphStore();
  await store.beginSnapshot(source);
  return { source, store };
}

async function testBeginSnapshotCreatesContext(): Promise<void> {
  const { source, store } = await initializedGraph("begin");
  assert.deepEqual(await store.exportTrace(source.id), {
    snapshotId: source.id,
    entities: [],
    facts: [],
  });
}

async function testEntityInsertIsIdempotent(): Promise<void> {
  const { source, store } = await initializedGraph("entity-idempotent");
  const value = entity(source, "owner");
  await store.putEntities([value]);
  await store.putEntities([structuredClone(value)]);
  assert.equal((await store.exportTrace(source.id)).entities.length, 1);
}

async function testFactInsertIsIdempotent(): Promise<void> {
  const { source, store } = await initializedGraph("fact-idempotent");
  const owner = entity(source, "owner");
  const target = entity(source, "target");
  const fact = relation(source, "fact-idempotent", owner, target);
  await store.putEntities([owner, target]);
  await store.putFacts([fact]);
  await store.putFacts([structuredClone(fact)]);
  assert.equal((await store.getFacts({ snapshotId: source.id })).length, 1);
}

async function testConflictingEntityIsRejected(): Promise<void> {
  const { source, store } = await initializedGraph("entity-conflict");
  const original = entity(source, "owner");
  await store.putEntities([original]);
  await assert.rejects(
    store.putEntities([{ ...original, displayName: "different" }]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError && error.code === "record_conflict",
  );
}

async function testConflictingFactIsRejected(): Promise<void> {
  const { source, store } = await initializedGraph("fact-conflict");
  const owner = entity(source, "owner");
  const target = entity(source, "target");
  const original = relation(source, "fact-conflict", owner, target);
  await store.putEntities([owner, target]);
  await store.putFacts([original]);
  await assert.rejects(
    store.putFacts([{ ...original, predicate: "calls" }]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError && error.code === "record_conflict",
  );
}

async function testCrossSnapshotEntityIsRejected(): Promise<void> {
  const first = snapshot("entity-cross-a");
  const second = snapshot("entity-cross-b");
  const store = createInMemoryKnowledgeGraphStore();
  await store.beginSnapshot(first);
  await store.beginSnapshot(second);
  const mixed = { ...entity(first, "mixed"), snapshotId: second.id };
  await assert.rejects(
    store.putEntities([mixed]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError && error.code === "invalid_record",
  );
}

async function testFactBeforeBeginSnapshotIsRejected(): Promise<void> {
  const source = snapshot("not-started");
  const owner = entity(source, "owner");
  const target = entity(source, "target");
  const store = createInMemoryKnowledgeGraphStore();
  await assert.rejects(
    store.putFacts([relation(source, "fact-not-started", owner, target)]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError &&
      error.code === "snapshot_not_started",
  );
}

async function testCrossSnapshotFactIsRejected(): Promise<void> {
  const first = snapshot("fact-cross-a");
  const second = snapshot("fact-cross-b");
  const store = createInMemoryKnowledgeGraphStore();
  await store.beginSnapshot(first);
  await store.beginSnapshot(second);
  const owner = entity(first, "owner");
  const target = entity(first, "target");
  await store.putEntities([owner, target]);
  const mixed = { ...relation(first, "fact-cross", owner, target), snapshotId: second.id };
  await assert.rejects(
    store.putFacts([mixed]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError && error.code === "invalid_record",
  );
}

async function testUnknownSubjectIsRejected(): Promise<void> {
  const { source, store } = await initializedGraph("unknown-subject");
  const owner = entity(source, "owner");
  const target = entity(source, "target");
  await store.putEntities([target]);
  await assert.rejects(
    store.putFacts([relation(source, "fact-unknown-subject", owner, target)]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError && error.code === "unknown_entity",
  );
}

async function testUnknownRelationObjectIsRejected(): Promise<void> {
  const { source, store } = await initializedGraph("unknown-object");
  const owner = entity(source, "owner");
  const target = entity(source, "target");
  await store.putEntities([owner]);
  await assert.rejects(
    store.putFacts([relation(source, "fact-unknown-object", owner, target)]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError && error.code === "unknown_entity",
  );
}

async function testFactQueryFilters(): Promise<void> {
  const { source, store } = await initializedGraph("query");
  const owner = entity(source, "owner");
  const target = entity(source, "target");
  const other = entity(source, "other");
  await store.putEntities([owner, target, other]);
  await store.putFacts([
    relation(source, "fact-query-a", owner, target, "imports"),
    relation(source, "fact-query-b", other, target, "calls"),
    relation(source, "fact-query-c", owner, other, "imports", "invalidated"),
  ]);
  assert.deepEqual(
    (await store.getFacts({ snapshotId: source.id, predicate: "imports", subjectId: owner.id })).map((fact) => fact.id),
    ["fact-query-a"],
  );
  assert.deepEqual(
    (await store.getFacts({ snapshotId: source.id, status: "invalidated" })).map((fact) => fact.id),
    ["fact-query-c"],
  );
}

async function testOutgoingNeighbors(): Promise<void> {
  const { source, store } = await initializedGraph("outgoing");
  const owner = entity(source, "owner");
  const target = entity(source, "target");
  await store.putEntities([owner, target]);
  await store.putFacts([relation(source, "fact-outgoing", owner, target)]);
  const edges = await store.getNeighbors({
    snapshotId: source.id,
    entityId: owner.id,
    direction: "outgoing",
  });
  assert.equal(edges[0]?.fact.id, "fact-outgoing");
  assert.equal(edges[0]?.target.id, target.id);
}

async function testIncomingNeighbors(): Promise<void> {
  const { source, store } = await initializedGraph("incoming");
  const owner = entity(source, "owner");
  const target = entity(source, "target");
  await store.putEntities([owner, target]);
  await store.putFacts([relation(source, "fact-incoming", owner, target)]);
  const edges = await store.getNeighbors({
    snapshotId: source.id,
    entityId: target.id,
    direction: "incoming",
  });
  assert.equal(edges[0]?.source.id, owner.id);
  assert.equal(edges[0]?.direction, "incoming");
}

async function testNeighborOrderingIsDeterministic(): Promise<void> {
  const { source, store } = await initializedGraph("neighbor-order");
  const owner = entity(source, "owner");
  const first = entity(source, "first");
  const second = entity(source, "second");
  await store.putEntities([owner, second, first]);
  await store.putFacts([
    relation(source, "fact-z", owner, second),
    relation(source, "fact-a", owner, first),
  ]);
  assert.deepEqual(
    (await store.getNeighbors({ snapshotId: source.id, entityId: owner.id, direction: "outgoing" })).map((edge) => edge.fact.id),
    ["fact-a", "fact-z"],
  );
}

async function testDefensiveClonesProtectStore(): Promise<void> {
  const { source, store } = await initializedGraph("clones");
  const owner = entity(source, "owner");
  const target = entity(source, "target");
  const fact = relation(source, "fact-clones", owner, target);
  await store.putEntities([owner, target]);
  await store.putFacts([fact]);
  owner.displayName = "mutated-input";
  fact.predicate = "mutated-input";
  const returnedEntity = await store.getEntity(owner.id);
  assert.equal(returnedEntity?.displayName, "owner");
  if (returnedEntity) returnedEntity.displayName = "mutated-output";
  const returnedFacts = await store.getFacts({ snapshotId: source.id });
  returnedFacts[0]!.predicate = "mutated-output";
  assert.equal((await store.getEntity(owner.id))?.displayName, "owner");
  assert.equal((await store.getFacts({ snapshotId: source.id }))[0]?.predicate, "imports");
}

async function testSnapshotIsolation(): Promise<void> {
  const first = snapshot("isolation-a");
  const second = snapshot("isolation-b");
  const store = createInMemoryKnowledgeGraphStore();
  await store.beginSnapshot(first);
  await store.beginSnapshot(second);
  const firstOwner = entity(first, "owner");
  const firstTarget = entity(first, "target");
  const secondOwner = entity(second, "owner");
  const secondTarget = entity(second, "target");
  await store.putEntities([firstOwner, firstTarget, secondOwner, secondTarget]);
  await store.putFacts([
    relation(first, "fact-isolation-a", firstOwner, firstTarget),
    relation(second, "fact-isolation-b", secondOwner, secondTarget),
  ]);
  assert.deepEqual(
    (await store.getFacts({ snapshotId: first.id })).map((fact) => fact.id),
    ["fact-isolation-a"],
  );
}

async function testFingerprintInvalidationIsScoped(): Promise<void> {
  const source = snapshot("invalidation", "fingerprint-old");
  const store = createInMemoryKnowledgeGraphStore();
  await store.beginSnapshot(source);
  const newSource = snapshot("invalidation-new", "fingerprint-new");
  await store.beginSnapshot(newSource);
  const owner = entity(source, "owner");
  const target = entity(source, "target");
  const oldFact = relation(source, "fact-old", owner, target);
  const metadataFact: FactRecord = {
    ...relation(source, "fact-metadata", owner, target, "configures"),
    source: {
      kind: "repository_metadata",
      snapshotId: source.id,
      reference: "fixture-metadata",
      fingerprint: "metadata-new",
    },
  };
  await store.putEntities([owner, target]);
  await store.putFacts([metadataFact, oldFact]);
  const newOwner = entity(newSource, "owner");
  const newTarget = entity(newSource, "target");
  await store.putEntities([newOwner, newTarget]);
  await store.putFacts([
    relation(newSource, "fact-new", newOwner, newTarget),
  ]);
  await store.invalidateByFileFingerprint(
    source.id,
    source.files[0]!.id,
    "fingerprint-old",
  );
  assert.deepEqual(
    (await store.getFacts({ snapshotId: source.id })).map((fact) => fact.id),
    ["fact-metadata"],
  );
  assert.deepEqual(
    (await store.getFacts({ snapshotId: source.id, status: "invalidated" })).map((fact) => fact.id),
    ["fact-old"],
  );
  assert.deepEqual(
    (await store.getFacts({ snapshotId: newSource.id })).map((fact) => fact.id),
    ["fact-new"],
  );
}

async function testInvalidatedFactsAreNotActiveByDefault(): Promise<void> {
  const { source, store } = await initializedGraph("invalidated-default");
  const owner = entity(source, "owner");
  const target = entity(source, "target");
  await store.putEntities([owner, target]);
  await store.putFacts([
    relation(source, "fact-invalidated-default", owner, target, "imports", "invalidated"),
  ]);
  assert.deepEqual(await store.getFacts({ snapshotId: source.id }), []);
}

async function testTraceDoesNotContainRawSource(): Promise<void> {
  const { source, store } = await initializedGraph("trace-redaction");
  const owner = entity(source, "owner");
  const target = entity(source, "target");
  await store.putEntities([owner, target]);
  await store.putFacts([relation(source, "fact-trace", owner, target)]);
  const serialized = JSON.stringify(await store.exportTrace(source.id));
  assert.equal(serialized.includes("raw source fixture"), false);
  assert.equal("content" in (await store.exportTrace(source.id)), false);
}

async function testDerivedFactWithoutParentsIsRejected(): Promise<void> {
  const { source, store } = await initializedGraph("derived-parent");
  const owner = entity(source, "owner");
  const target = entity(source, "target");
  await store.putEntities([owner, target]);
  const derived = relation(source, "fact-derived", owner, target);
  derived.provenance = { ...derived.provenance, method: "derived" };
  await assert.rejects(
    store.putFacts([derived]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError && error.code === "invalid_record",
  );
}

async function testModelProposedFactIsRejected(): Promise<void> {
  const { source, store } = await initializedGraph("model-proposed");
  const owner = entity(source, "owner");
  const target = entity(source, "target");
  await store.putEntities([owner, target]);
  const observed = relation(source, "fact-model-proposed", owner, target);
  const proposed = {
    ...observed,
    provenance: { ...observed.provenance, method: "model_proposed" },
  } as unknown as FactRecord;
  await assert.rejects(
    store.putFacts([proposed]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError && error.code === "invalid_record",
  );
}

async function testStaleSourceFingerprintIsRejected(): Promise<void> {
  const { source, store } = await initializedGraph("stale-source");
  const owner = entity(source, "owner");
  const target = entity(source, "target");
  await store.putEntities([owner, target]);
  const stale = relation(source, "fact-stale-source", owner, target);
  if (stale.source.kind !== "source_span") throw new Error("Expected source span.");
  stale.source.contentFingerprint = "content-sha256:stale";
  await assert.rejects(
    store.putFacts([stale]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError && error.code === "invalid_record",
  );
}

async function testRepeatedExtractionDoesNotDuplicateGraph(): Promise<void> {
  const content = 'import { saveUser } from "./service.js";\nfunction execute() { saveUser(); }';
  const contentFingerprint = `content-sha256:${createHash("sha256").update(content).digest("hex")}`;
  const source = snapshot("extraction", contentFingerprint);
  const extractor = createFactExtractorRegistry([
    createTypeScriptJavaScriptFactExtractor(new FixedClock(timestamp)),
  ]);
  const extraction = await extractor.extract({
    snapshotId: source.id,
    fileId: source.files[0]!.id,
    path: source.files[0]!.path,
    content,
    contentFingerprint,
    language: "typescript",
  });
  const store = createInMemoryKnowledgeGraphStore();
  await store.beginSnapshot(source);
  await store.putEntities(extraction.entities);
  await store.putFacts(extraction.facts);
  await store.putEntities(structuredClone(extraction.entities));
  await store.putFacts(structuredClone(extraction.facts));
  const trace = await store.exportTrace(source.id);
  assert.equal(trace.entities.length, extraction.entities.length);
  assert.equal(trace.facts.length, extraction.facts.length);
}

async function testMalformedFactEnumsAndProvenanceAreRejected(): Promise<void> {
  const variants: Array<(fact: FactRecord) => unknown> = [
    (fact) => ({ ...fact, kind: "unknown_fact_kind" }),
    (fact) => ({ ...fact, strength: "certain" }),
    (fact) => ({ ...fact, status: "current" }),
    (fact) => ({ ...fact, provenance: { ...fact.provenance, method: "model_proposed" } }),
    (fact) => ({ ...fact, provenance: { ...fact.provenance, extractorId: "" } }),
    (fact) => ({ ...fact, provenance: { ...fact.provenance, extractorVersion: "bad version" } }),
    (fact) => ({ ...fact, provenance: { ...fact.provenance, observedAt: "not-a-date" } }),
  ];
  for (const [index, mutate] of variants.entries()) {
    const { source, store } = await initializedGraph(`runtime-enum-${index}`);
    const owner = entity(source, "owner");
    const target = entity(source, "target");
    await store.putEntities([owner, target]);
    const malformed = mutate(relation(source, `fact-runtime-${index}`, owner, target));
    await assert.rejects(
      store.putFacts([malformed as FactRecord]),
      (error: unknown) =>
        error instanceof KnowledgeGraphStoreError && error.code === "invalid_record",
    );
  }
}

async function testMalformedLiteralShapesAreRejected(): Promise<void> {
  const objects: unknown[] = [
    { type: "string", value: false },
    { type: "boolean", value: "true" },
    { type: "null", value: "null" },
    { type: "unknown", value: "value" },
    { type: "number", value: Number.POSITIVE_INFINITY },
    { type: "json", value: { missing: undefined } },
  ];
  for (const [index, object] of objects.entries()) {
    const { source, store } = await initializedGraph(`runtime-literal-${index}`);
    const owner = entity(source, "owner");
    const target = entity(source, "target");
    await store.putEntities([owner, target]);
    const base = relation(source, `fact-literal-${index}`, owner, target);
    const malformed = { ...base, kind: "fact", object } as unknown as FactRecord;
    await assert.rejects(
      store.putFacts([malformed]),
      (error: unknown) =>
        error instanceof KnowledgeGraphStoreError && error.code === "invalid_record",
    );
  }
}

async function testMalformedSourceLocationsAreRejected(): Promise<void> {
  const { source, store } = await initializedGraph("runtime-source");
  const owner = entity(source, "owner");
  const target = entity(source, "target");
  await store.putEntities([owner, target]);
  const invalidHash = relation(source, "fact-invalid-hash", owner, target);
  if (invalidHash.source.kind !== "source_span") throw new Error("Expected source span.");
  invalidHash.source.excerptHash = "sha256:ABC";
  const invalidMetadata = {
    ...relation(source, "fact-invalid-metadata", owner, target),
    source: {
      kind: "repository_metadata",
      snapshotId: source.id,
      reference: "",
      fingerprint: "fixture",
      unexpected: true,
    },
  } as unknown as FactRecord;
  for (const malformed of [invalidHash, invalidMetadata]) {
    await assert.rejects(
      store.putFacts([malformed]),
      (error: unknown) =>
        error instanceof KnowledgeGraphStoreError && error.code === "invalid_record",
    );
  }
}

function derivedRelation(
  source: RepositorySnapshot,
  id: string,
  subject: RepositoryEntity,
  object: RepositoryEntity,
  parentFactIds: FactId[],
): FactRecord {
  const fact = relation(source, id, subject, object, "derived_relation");
  return {
    ...fact,
    provenance: {
      ...fact.provenance,
      method: "derived",
      parentFactIds,
    },
  };
}

async function testDerivedSelfParentIsRejected(): Promise<void> {
  const { source, store } = await initializedGraph("derived-self");
  const owner = entity(source, "owner");
  const target = entity(source, "target");
  await store.putEntities([owner, target]);
  const id = "fact-derived-self" as FactId;
  await assert.rejects(
    store.putFacts([derivedRelation(source, id, owner, target, [id])]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError && error.code === "invalid_record",
  );
}

async function testDerivedBatchCycleIsRejected(): Promise<void> {
  const { source, store } = await initializedGraph("derived-cycle");
  const owner = entity(source, "owner");
  const target = entity(source, "target");
  await store.putEntities([owner, target]);
  const firstId = "fact-derived-cycle-a" as FactId;
  const secondId = "fact-derived-cycle-b" as FactId;
  await assert.rejects(
    store.putFacts([
      derivedRelation(source, firstId, owner, target, [secondId]),
      derivedRelation(source, secondId, owner, target, [firstId]),
    ]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError && error.code === "invalid_record",
  );
}

async function testDerivedCrossSnapshotParentIsRejected(): Promise<void> {
  const first = snapshot("derived-cross-a");
  const second = snapshot("derived-cross-b");
  const store = createInMemoryKnowledgeGraphStore();
  await store.beginSnapshot(first);
  await store.beginSnapshot(second);
  const firstOwner = entity(first, "owner");
  const firstTarget = entity(first, "target");
  const secondOwner = entity(second, "owner");
  const secondTarget = entity(second, "target");
  await store.putEntities([firstOwner, firstTarget, secondOwner, secondTarget]);
  const parent = relation(first, "fact-derived-cross-parent", firstOwner, firstTarget);
  await store.putFacts([parent]);
  await assert.rejects(
    store.putFacts([
      derivedRelation(second, "fact-derived-cross-child", secondOwner, secondTarget, [parent.id]),
    ]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError && error.code === "snapshot_mismatch",
  );
}

async function testDerivedInvalidatedParentIsRejected(): Promise<void> {
  const { source, store } = await initializedGraph("derived-invalidated");
  const owner = entity(source, "owner");
  const target = entity(source, "target");
  await store.putEntities([owner, target]);
  const parent = relation(source, "fact-derived-invalidated-parent", owner, target, "imports", "invalidated");
  await store.putFacts([parent]);
  await assert.rejects(
    store.putFacts([
      derivedRelation(source, "fact-derived-invalidated-child", owner, target, [parent.id]),
    ]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError && error.code === "invalid_record",
  );
}

async function testDerivedAcyclicChainIsAccepted(): Promise<void> {
  const { source, store } = await initializedGraph("derived-chain");
  const owner = entity(source, "owner");
  const target = entity(source, "target");
  await store.putEntities([owner, target]);
  const base = relation(source, "fact-derived-chain-a", owner, target);
  const middle = derivedRelation(source, "fact-derived-chain-b", owner, target, [base.id]);
  const leaf = derivedRelation(source, "fact-derived-chain-c", owner, target, [middle.id]);
  await store.putFacts([leaf, base, middle]);
  assert.deepEqual(
    (await store.getFacts({ snapshotId: source.id })).map((entry) => entry.id),
    [base.id, middle.id, leaf.id],
  );
}

async function testSecretLikeEntityCannotLeakIntoTrace(): Promise<void> {
  const secret = "ghp_abcdefghijklmnop1234";
  const { source, store } = await initializedGraph("secret-trace");
  const unsafe = entity(source, "unsafe");
  unsafe.displayName = secret;
  let message = "";
  await assert.rejects(
    store.putEntities([unsafe]),
    (error: unknown) => {
      if (error instanceof Error) message = error.message;
      return error instanceof KnowledgeGraphStoreError && error.code === "invalid_record";
    },
  );
  assert.equal(message.includes(secret), false);
  assert.equal(JSON.stringify(await store.exportTrace(source.id)).includes(secret), false);
}

async function testStructuredTokenAttributeIsRejected(): Promise<void> {
  const { source, store } = await initializedGraph("structured-token");
  const unsafe = entity(source, "unsafe");
  unsafe.attributes = { token: "abcdefghi" };
  await assert.rejects(
    store.putEntities([unsafe]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError && error.code === "invalid_record",
  );
}

async function testStructuredSecretTraversalHandlesCycles(): Promise<void> {
  const cyclic: Record<string, unknown> = { label: "safe" };
  cyclic.self = cyclic;
  cyclic.config = { accessToken: "abcdefghi" };
  assert.equal(containsSecretLikeSemanticValue(cyclic), true);

  const safeCycle: Record<string, unknown> = { label: "tokenizer" };
  safeCycle.self = safeCycle;
  assert.equal(containsSecretLikeSemanticValue(safeCycle), false);
}

async function testStructuredSecretTraversalDoesNotInvokeGetters(): Promise<void> {
  let getterCalls = 0;
  const value: Record<string, unknown> = {};
  Object.defineProperty(value, "Bearer abcdefghi", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "not-read";
    },
  });
  assert.equal(containsSecretLikeSemanticValue(value), true);
  assert.equal(getterCalls, 0);
}

async function testSecretLikeObjectKeyIsRejected(): Promise<void> {
  const { source, store } = await initializedGraph("secret-key");
  const unsafe = entity(source, "unsafe");
  unsafe.attributes = { "Bearer abcdefghi": "marker" };
  await assert.rejects(
    store.putEntities([unsafe]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError && error.code === "invalid_record",
  );
}

async function testStructuredPasswordJsonLiteralIsRejected(): Promise<void> {
  const { source, store } = await initializedGraph("structured-literal");
  const owner = entity(source, "owner");
  await store.putEntities([owner]);
  await assert.rejects(
    store.putFacts([
      literalFact(source, "fact-structured-literal", owner, {
        type: "json",
        value: { password: "abcdefghi" },
      }),
    ]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError && error.code === "invalid_record",
  );
}

async function testNestedStructuredSecretIsRejected(): Promise<void> {
  const { source, store } = await initializedGraph("structured-nested");
  const unsafe = entity(source, "unsafe");
  unsafe.attributes = { config: { clientSecret: "abcdefghi" } };
  await assert.rejects(
    store.putEntities([unsafe]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError && error.code === "invalid_record",
  );
}

async function testSecretLikeArrayValueIsRejected(): Promise<void> {
  const { source, store } = await initializedGraph("structured-array");
  const unsafe = entity(source, "unsafe");
  unsafe.attributes = { headers: ["Bearer abcdefghi"] };
  await assert.rejects(
    store.putEntities([unsafe]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError && error.code === "invalid_record",
  );
}

async function testSafeTechnicalNamesRemainAllowed(): Promise<void> {
  const { source, store } = await initializedGraph("safe-technical-names");
  const safe = entity(source, "password-reset-page");
  safe.canonicalName = "secret-service";
  safe.attributes = {
    tokenizer: "tokenizer",
    page: "password-reset-page",
    service: "secret-service",
  };
  await store.putEntities([safe]);
  assert.equal((await store.getEntity(safe.id))?.displayName, "password-reset-page");
}

async function testStructuredSecretDoesNotLeakIntoErrorsOrTrace(): Promise<void> {
  const secret = "abcdefghi";
  const { source, store } = await initializedGraph("structured-redaction");
  const unsafe = entity(source, "unsafe");
  unsafe.attributes = { registryToken: secret };
  let message = "";
  await assert.rejects(
    store.putEntities([unsafe]),
    (error: unknown) => {
      if (error instanceof Error) message = error.message;
      return error instanceof KnowledgeGraphStoreError && error.code === "invalid_record";
    },
  );
  assert.equal(message.includes(secret), false);
  assert.equal(JSON.stringify(await store.exportTrace(source.id)).includes(secret), false);
}

async function testNumericCanonicalNameIsRejected(): Promise<void> {
  const { source, store } = await initializedGraph("numeric-canonical-name");
  const malformed = {
    ...entity(source, "owner"),
    canonicalName: 123,
  } as unknown as RepositoryEntity;
  await assert.rejects(
    store.putEntities([malformed]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError && error.code === "invalid_record",
  );
}

async function testExtraEntityFieldIsRejected(): Promise<void> {
  const { source, store } = await initializedGraph("extra-entity-field");
  const malformed = {
    ...entity(source, "owner"),
    unexpected: "value",
  } as unknown as RepositoryEntity;
  await assert.rejects(
    store.putEntities([malformed]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError && error.code === "invalid_record",
  );
}

async function testExtraFactFieldIsRejected(): Promise<void> {
  const { source, store } = await initializedGraph("extra-fact-field");
  const owner = entity(source, "owner");
  const target = entity(source, "target");
  await store.putEntities([owner, target]);
  const malformed = {
    ...relation(source, "fact-extra-field", owner, target),
    unexpected: "value",
  } as unknown as FactRecord;
  await assert.rejects(
    store.putFacts([malformed]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError && error.code === "invalid_record",
  );
}

async function testExtraSourceSpanFieldIsRejected(): Promise<void> {
  const { source, store } = await initializedGraph("extra-source-field");
  const owner = entity(source, "owner");
  const target = entity(source, "target");
  await store.putEntities([owner, target]);
  const fact = relation(source, "fact-extra-source", owner, target);
  fact.source = {
    ...fact.source,
    unexpected: "value",
  } as unknown as typeof fact.source;
  await assert.rejects(
    store.putFacts([fact]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError && error.code === "invalid_record",
  );
}

async function testExtraProvenanceFieldIsRejected(): Promise<void> {
  const { source, store } = await initializedGraph("extra-provenance-field");
  const owner = entity(source, "owner");
  const target = entity(source, "target");
  await store.putEntities([owner, target]);
  const fact = relation(source, "fact-extra-provenance", owner, target);
  fact.provenance = {
    ...fact.provenance,
    unexpected: "value",
  } as typeof fact.provenance;
  await assert.rejects(
    store.putFacts([fact]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError && error.code === "invalid_record",
  );
}

async function testEmbeddedEntitySchemaIsValidated(): Promise<void> {
  const { source, store } = await initializedGraph("embedded-entity-schema");
  const owner = entity(source, "owner");
  const target = entity(source, "target");
  await store.putEntities([owner, target]);
  const malformedSubject = {
    ...owner,
    unexpected: "value",
  } as unknown as RepositoryEntity;
  const malformedObject = {
    ...target,
    unexpected: "value",
  } as unknown as RepositoryEntity;
  await assert.rejects(
    store.putFacts([
      relation(source, "fact-extra-subject", malformedSubject, target),
    ]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError && error.code === "invalid_record",
  );
  await assert.rejects(
    store.putFacts([
      relation(source, "fact-extra-object", owner, malformedObject),
    ]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError && error.code === "invalid_record",
  );
}

async function testNonCanonicalObservedAtIsRejected(): Promise<void> {
  const { source, store } = await initializedGraph("short-timestamp");
  const owner = entity(source, "owner");
  const target = entity(source, "target");
  await store.putEntities([owner, target]);
  const timestamps = [
    "2026",
    "2026-01-01",
    "2026-01-01T00:00:00.000",
    "2026-01-01T00:00:00.000Z trailing",
    "",
  ];
  for (const [index, value] of timestamps.entries()) {
    const fact = relation(source, `fact-short-timestamp-${index}`, owner, target);
    fact.provenance.observedAt = value;
    await assert.rejects(
      store.putFacts([fact]),
      (error: unknown) =>
        error instanceof KnowledgeGraphStoreError && error.code === "invalid_record",
    );
  }
}

async function testImpossibleObservedAtIsRejected(): Promise<void> {
  const { source, store } = await initializedGraph("impossible-timestamp");
  const owner = entity(source, "owner");
  const target = entity(source, "target");
  await store.putEntities([owner, target]);
  const fact = relation(source, "fact-impossible-timestamp", owner, target);
  fact.provenance.observedAt = "2026-02-30T00:00:00.000Z";
  await assert.rejects(
    store.putFacts([fact]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError && error.code === "invalid_record",
  );
}

async function testCanonicalObservedAtAndOperationIdAreAccepted(): Promise<void> {
  const { source, store } = await initializedGraph("canonical-timestamp");
  const owner = entity(source, "owner");
  const target = entity(source, "target");
  await store.putEntities([owner, target]);
  const fact = relation(source, "fact-canonical-timestamp", owner, target);
  fact.provenance.operationId = "operation-1" as typeof fact.provenance.operationId;
  await store.putFacts([fact]);
  assert.equal((await store.getFacts({ snapshotId: source.id }))[0]?.id, fact.id);
}

async function testInvalidOperationIdIsRejected(): Promise<void> {
  const { source, store } = await initializedGraph("invalid-operation-id");
  const owner = entity(source, "owner");
  const target = entity(source, "target");
  await store.putEntities([owner, target]);
  const fact = relation(source, "fact-invalid-operation-id", owner, target);
  fact.provenance.operationId = "bad operation id" as typeof fact.provenance.operationId;
  await assert.rejects(
    store.putFacts([fact]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError && error.code === "invalid_record",
  );
}

async function testUnsafeExtraFieldValueDoesNotLeakIntoError(): Promise<void> {
  const secret = "ghp_abcdefghijklmnop1234";
  const { source, store } = await initializedGraph("unsafe-extra-value");
  const malformed = {
    ...entity(source, "owner"),
    unexpected: secret,
  } as unknown as RepositoryEntity;
  let message = "";
  await assert.rejects(
    store.putEntities([malformed]),
    (error: unknown) => {
      if (error instanceof Error) message = error.message;
      return error instanceof KnowledgeGraphStoreError && error.code === "invalid_record";
    },
  );
  assert.equal(message.includes(secret), false);
}

async function testDerivedInvalidationCascadesToAllDescendants(): Promise<void> {
  const source = snapshotWithTwoFiles("cascade");
  const otherSnapshot = snapshotWithTwoFiles("cascade-other");
  const store = createInMemoryKnowledgeGraphStore();
  await store.beginSnapshot(source);
  await store.beginSnapshot(otherSnapshot);

  const owner = entity(source, "owner");
  const target = entity(source, "target");
  const otherOwner = entity(otherSnapshot, "owner");
  const otherTarget = entity(otherSnapshot, "target");
  await store.putEntities([owner, target, otherOwner, otherTarget]);

  const parent = relation(source, "fact-cascade-parent", owner, target);
  const child = withSourceFile(
    derivedRelation(source, "fact-cascade-child", owner, target, [parent.id]),
    source,
    1,
  );
  const grandchild: FactRecord = {
    ...derivedRelation(source, "fact-cascade-grandchild", owner, target, [child.id]),
    source: {
      kind: "repository_metadata",
      snapshotId: source.id,
      reference: "derived-fixture",
      fingerprint: "metadata-fixture",
    },
  };
  const originalChildProvenance = structuredClone(child.provenance);
  const originalGrandchildProvenance = structuredClone(grandchild.provenance);
  const unrelatedParent = withSourceFile(
    relation(source, "fact-unrelated-parent", owner, target),
    source,
    1,
  );
  const unrelatedChild = withSourceFile(
    derivedRelation(
      source,
      "fact-unrelated-child",
      owner,
      target,
      [unrelatedParent.id],
    ),
    source,
    1,
  );
  const otherParent = relation(
    otherSnapshot,
    "fact-other-parent",
    otherOwner,
    otherTarget,
  );
  const otherChild = derivedRelation(
    otherSnapshot,
    "fact-other-child",
    otherOwner,
    otherTarget,
    [otherParent.id],
  );
  await store.putFacts([
    parent,
    child,
    grandchild,
    unrelatedParent,
    unrelatedChild,
    otherParent,
    otherChild,
  ]);

  await store.invalidateByFileFingerprint(
    source.id,
    source.files[0]!.id,
    source.files[0]!.contentFingerprint,
  );

  const invalidated = await store.getFacts({
    snapshotId: source.id,
    status: "invalidated",
  });
  assert.deepEqual(
    invalidated.map((fact) => fact.id),
    [grandchild.id, child.id, parent.id].sort(),
  );
  assert.equal(invalidated.find((fact) => fact.id === child.id)?.source.kind, "source_span");
  assert.equal(invalidated.find((fact) => fact.id === grandchild.id)?.source.kind, "repository_metadata");
  assert.deepEqual(
    (await store.getFacts({ snapshotId: source.id })).map((fact) => fact.id),
    [unrelatedChild.id, unrelatedParent.id].sort(),
  );
  assert.deepEqual(
    (await store.getFacts({ snapshotId: otherSnapshot.id })).map((fact) => fact.id),
    [otherChild.id, otherParent.id].sort(),
  );
  assert.equal(
    (await store.getNeighbors({
      snapshotId: source.id,
      entityId: owner.id,
      direction: "outgoing",
    })).some((edge) => [parent.id, child.id, grandchild.id].includes(edge.fact.id)),
    false,
  );
  const trace = await store.exportTrace(source.id);
  assert.equal(
    trace.facts
      .filter((fact) => [parent.id, child.id, grandchild.id].includes(fact.id))
      .every((fact) => fact.status === "invalidated"),
    true,
  );
  assert.deepEqual(
    trace.facts.find((fact) => fact.id === child.id)?.provenance,
    originalChildProvenance,
  );
  assert.deepEqual(
    trace.facts.find((fact) => fact.id === grandchild.id)?.provenance,
    originalGrandchildProvenance,
  );
}

async function testEntityAllowedFieldGetterIsNotInvoked(): Promise<void> {
  const { source, store } = await initializedGraph("entity-getter");
  const raw = entity(source, "owner");
  let getterCalls = 0;
  Object.defineProperty(raw, "displayName", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "owner";
    },
  });
  await assert.rejects(
    store.putEntities([raw]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError && error.code === "invalid_record",
  );
  assert.equal(getterCalls, 0);
}

async function testNestedAttributeGetterIsNotInvoked(): Promise<void> {
  const { source, store } = await initializedGraph("attribute-getter");
  const raw = entity(source, "owner");
  const attributes: Record<string, unknown> = {};
  let getterCalls = 0;
  Object.defineProperty(attributes, "label", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "safe";
    },
  });
  raw.attributes = attributes as RepositoryEntity["attributes"];
  await assert.rejects(
    store.putEntities([raw]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError && error.code === "invalid_record",
  );
  assert.equal(getterCalls, 0);
}

async function testFactProvenanceGetterIsNotInvoked(): Promise<void> {
  const { source, store } = await initializedGraph("provenance-getter");
  const owner = entity(source, "owner");
  const target = entity(source, "target");
  await store.putEntities([owner, target]);
  const fact = relation(source, "fact-provenance-getter", owner, target);
  let getterCalls = 0;
  Object.defineProperty(fact.provenance, "extractorId", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "fixture-extractor";
    },
  });
  await assert.rejects(
    store.putFacts([fact]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError && error.code === "invalid_record",
  );
  assert.equal(getterCalls, 0);
}

async function testSourceSpanGetterIsNotInvoked(): Promise<void> {
  const { source, store } = await initializedGraph("source-getter");
  const owner = entity(source, "owner");
  const target = entity(source, "target");
  await store.putEntities([owner, target]);
  const fact = relation(source, "fact-source-getter", owner, target);
  let getterCalls = 0;
  Object.defineProperty(fact.source, "path", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "src/module.ts";
    },
  });
  await assert.rejects(
    store.putFacts([fact]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError && error.code === "invalid_record",
  );
  assert.equal(getterCalls, 0);
}

async function testThrowingSecretGetterIsSafelyRejected(): Promise<void> {
  const secret = "ghp_abcdefghijklmnop1234";
  const { source, store } = await initializedGraph("throwing-getter");
  const raw = entity(source, "owner");
  let getterCalls = 0;
  Object.defineProperty(raw, "id", {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error(secret);
    },
  });
  const captured: { error?: KnowledgeGraphStoreError } = {};
  await assert.rejects(
    store.putEntities([raw]),
    (error: unknown) => {
      if (error instanceof KnowledgeGraphStoreError) captured.error = error;
      return error instanceof KnowledgeGraphStoreError && error.code === "invalid_record";
    },
  );
  assert.equal(getterCalls, 0);
  assert.equal(captured.error?.message.includes(secret), false);
  assert.equal(captured.error?.recordId, undefined);
  assert.equal(JSON.stringify(await store.exportTrace(source.id)).includes(secret), false);
}

async function testSetterOnlyAccessorIsRejected(): Promise<void> {
  const { source, store } = await initializedGraph("setter-only");
  const raw = entity(source, "owner");
  let setterCalls = 0;
  Object.defineProperty(raw, "displayName", {
    enumerable: true,
    set() {
      setterCalls += 1;
    },
  });
  await assert.rejects(
    store.putEntities([raw]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError && error.code === "invalid_record",
  );
  assert.equal(setterCalls, 0);
}

async function testOrdinaryDataDescriptorPassesPreflight(): Promise<void> {
  const { source, store } = await initializedGraph("data-descriptor");
  const raw = entity(source, "owner");
  Object.defineProperty(raw, "displayName", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: "owner",
  });
  await store.putEntities([raw]);
  assert.equal((await store.getEntity(raw.id))?.displayName, "owner");
}

async function testEnumerableSymbolEntityFieldIsRejected(): Promise<void> {
  const { source, store } = await initializedGraph("entity-symbol");
  const raw = entity(source, "owner");
  Object.defineProperty(raw, Symbol("unexpected"), {
    enumerable: true,
    value: "value",
  });
  await assert.rejects(
    store.putEntities([raw]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError && error.code === "invalid_record",
  );
}

async function testEnumerableSymbolFactFieldIsRejected(): Promise<void> {
  const { source, store } = await initializedGraph("fact-symbol");
  const owner = entity(source, "owner");
  const target = entity(source, "target");
  await store.putEntities([owner, target]);
  const fact = relation(source, "fact-symbol-field", owner, target);
  Object.defineProperty(fact, Symbol("unexpected"), {
    enumerable: true,
    value: "value",
  });
  await assert.rejects(
    store.putFacts([fact]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError && error.code === "invalid_record",
  );
}

async function testNonEnumerableExtraSourceFieldIsRejected(): Promise<void> {
  const { source, store } = await initializedGraph("hidden-source-field");
  const owner = entity(source, "owner");
  const target = entity(source, "target");
  await store.putEntities([owner, target]);
  const fact = relation(source, "fact-hidden-source", owner, target);
  Object.defineProperty(fact.source, "unexpected", {
    enumerable: false,
    value: "value",
  });
  await assert.rejects(
    store.putFacts([fact]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError && error.code === "invalid_record",
  );
}

async function testNonEnumerableExtraProvenanceFieldIsRejected(): Promise<void> {
  const { source, store } = await initializedGraph("hidden-provenance-field");
  const owner = entity(source, "owner");
  const target = entity(source, "target");
  await store.putEntities([owner, target]);
  const fact = relation(source, "fact-hidden-provenance", owner, target);
  Object.defineProperty(fact.provenance, "unexpected", {
    enumerable: false,
    value: "value",
  });
  await assert.rejects(
    store.putFacts([fact]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError && error.code === "invalid_record",
  );
}

async function testClassInstanceEntityIsRejected(): Promise<void> {
  class EntityEnvelope {}
  const { source, store } = await initializedGraph("class-entity");
  const raw = Object.assign(new EntityEnvelope(), entity(source, "owner"));
  await assert.rejects(
    store.putEntities([raw as RepositoryEntity]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError && error.code === "invalid_record",
  );
}

async function testClassInstanceFactIsRejected(): Promise<void> {
  class FactEnvelope {}
  const { source, store } = await initializedGraph("class-fact");
  const owner = entity(source, "owner");
  const target = entity(source, "target");
  await store.putEntities([owner, target]);
  const raw = Object.assign(
    new FactEnvelope(),
    relation(source, "fact-class-instance", owner, target),
  );
  await assert.rejects(
    store.putFacts([raw as FactRecord]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError && error.code === "invalid_record",
  );
}

async function testNullPrototypeRecordsPassPreflight(): Promise<void> {
  const { source, store } = await initializedGraph("null-prototype");
  const owner = Object.assign(
    Object.create(null) as Record<string, unknown>,
    entity(source, "owner"),
  ) as RepositoryEntity;
  const target = entity(source, "target");
  await store.putEntities([owner, target]);
  const fact = Object.assign(
    Object.create(null) as Record<string, unknown>,
    relation(source, "fact-null-prototype", owner, target),
  ) as FactRecord;
  await store.putFacts([fact]);
  const trace = await store.exportTrace(source.id);
  assert.equal(trace.facts[0]?.id, fact.id);
  for (const storedEntity of trace.entities) {
    assertRepositoryEntitySnapshotConsistency(storedEntity, source);
  }
  assertFactSnapshotConsistency(trace.facts[0]!, source);
}

async function testCyclicRecordIsRejectedBeforeClone(): Promise<void> {
  const { source, store } = await initializedGraph("cyclic-record");
  const raw = entity(source, "owner");
  const attributes: Record<string, unknown> = {};
  attributes.self = attributes;
  raw.attributes = attributes as RepositoryEntity["attributes"];
  await assert.rejects(
    store.putEntities([raw]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError && error.code === "invalid_record",
  );
}

async function testCloneFailureIsWrappedSafely(): Promise<void> {
  const secret = "ghp_abcdefghijklmnop1234";
  const { source, store } = await initializedGraph("clone-failure");
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "structuredClone",
  );
  Object.defineProperty(globalThis, "structuredClone", {
    configurable: true,
    writable: true,
    value: (() => {
      throw new Error(secret);
    }) as typeof structuredClone,
  });
  const captured: { error?: KnowledgeGraphStoreError } = {};
  try {
    await assert.rejects(
      store.putEntities([entity(source, "owner")]),
      (error: unknown) => {
        if (error instanceof KnowledgeGraphStoreError) captured.error = error;
        return error instanceof KnowledgeGraphStoreError && error.code === "invalid_record";
      },
    );
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, "structuredClone", originalDescriptor);
    }
  }
  assert.equal(captured.error?.message.includes(secret), false);
}

async function testSecretLikeEntityIdIsRejectedSafely(): Promise<void> {
  const secret = "ghp_abcdefghijklmnop1234";
  const { source, store } = await initializedGraph("secret-entity-id");
  const raw = entity(source, "owner");
  raw.id = secret as EntityId;
  const captured: { error?: KnowledgeGraphStoreError } = {};
  await assert.rejects(
    store.putEntities([raw]),
    (error: unknown) => {
      if (error instanceof KnowledgeGraphStoreError) captured.error = error;
      return error instanceof KnowledgeGraphStoreError && error.code === "invalid_record";
    },
  );
  assert.equal(captured.error?.message.includes(secret), false);
  assert.equal(captured.error?.recordId, undefined);
  assert.equal(JSON.stringify(await store.exportTrace(source.id)).includes(secret), false);
}

async function testSecretLikeFactIdIsRejected(): Promise<void> {
  const { source, store } = await initializedGraph("secret-fact-id");
  const owner = entity(source, "owner");
  const target = entity(source, "target");
  await store.putEntities([owner, target]);
  const fact = relation(source, "fact-safe", owner, target);
  fact.id = "sk-proj-abcdefghijklmnop" as FactId;
  await assert.rejects(
    store.putFacts([fact]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError &&
      error.code === "invalid_record" &&
      error.recordId === undefined,
  );
}

async function testSecretLikePredicateIsRejected(): Promise<void> {
  const { source, store } = await initializedGraph("secret-predicate");
  const owner = entity(source, "owner");
  const target = entity(source, "target");
  await store.putEntities([owner, target]);
  const fact = relation(source, "fact-secret-predicate", owner, target);
  fact.predicate = "Bearer abcdefghi";
  await assert.rejects(
    store.putFacts([fact]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError && error.code === "invalid_record",
  );
}

async function testSecretLikeExtractorIdIsRejected(): Promise<void> {
  const { source, store } = await initializedGraph("secret-extractor-id");
  const owner = entity(source, "owner");
  const target = entity(source, "target");
  await store.putEntities([owner, target]);
  const fact = relation(source, "fact-secret-extractor", owner, target);
  fact.provenance.extractorId = "ghp_abcdefghijklmnop1234";
  await assert.rejects(
    store.putFacts([fact]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError && error.code === "invalid_record",
  );
}

async function testSecretLikeExtractorVersionIsRejected(): Promise<void> {
  const { source, store } = await initializedGraph("secret-extractor-version");
  const owner = entity(source, "owner");
  const target = entity(source, "target");
  await store.putEntities([owner, target]);
  const fact = relation(source, "fact-secret-version", owner, target);
  fact.provenance.extractorVersion = "sk_live_abcdefghijklmnop";
  await assert.rejects(
    store.putFacts([fact]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError && error.code === "invalid_record",
  );
}

async function testSecretLikeOperationIdIsRejected(): Promise<void> {
  const { source, store } = await initializedGraph("secret-operation-id");
  const owner = entity(source, "owner");
  const target = entity(source, "target");
  await store.putEntities([owner, target]);
  const fact = relation(source, "fact-secret-operation", owner, target);
  fact.provenance.operationId =
    ["AK", "IA", "ABCDEFGHIJKLMNOP"].join("") as typeof fact.provenance.operationId;
  await assert.rejects(
    store.putFacts([fact]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError && error.code === "invalid_record",
  );
}

async function testSafePortableIdentifiersPass(): Promise<void> {
  const { source, store } = await initializedGraph("safe-identifiers");
  const owner = entity(source, "owner");
  owner.id = "entity-module-1" as EntityId;
  owner.displayName = "password-reset-page";
  owner.canonicalName = "secret-service";
  owner.attributes = { parser: "tokenizer" };
  const target = entity(source, "target");
  await store.putEntities([owner, target]);
  const fact = relation(source, "fact-safe-identifiers", owner, target, "tokenizer");
  fact.provenance.extractorId = "extractor.typescript";
  fact.provenance.extractorVersion = "secret-service";
  fact.provenance.operationId = "operation-42" as typeof fact.provenance.operationId;
  await store.putFacts([fact]);
  assert.equal((await store.getFacts({ snapshotId: source.id }))[0]?.id, fact.id);
}

async function testNonEnumerableEntityDisplayNameIsRejected(): Promise<void> {
  const { source, store } = await initializedGraph("hidden-display-name");
  const raw = entity(source, "owner");
  Object.defineProperty(raw, "displayName", { enumerable: false });
  await assert.rejects(
    store.putEntities([raw]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError && error.code === "invalid_record",
  );
  assert.deepEqual((await store.exportTrace(source.id)).entities, []);
}

async function testNonEnumerableEntityIdIsRejected(): Promise<void> {
  const { source, store } = await initializedGraph("hidden-entity-id");
  const raw = entity(source, "owner");
  Object.defineProperty(raw, "id", { enumerable: false });
  await assert.rejects(
    store.putEntities([raw]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError && error.code === "invalid_record",
  );
  assert.deepEqual((await store.exportTrace(source.id)).entities, []);
}

async function testNonEnumerableOptionalCanonicalNameIsRejected(): Promise<void> {
  const { source, store } = await initializedGraph("hidden-canonical-name");
  const raw = entity(source, "owner");
  Object.defineProperty(raw, "canonicalName", { enumerable: false });
  await assert.rejects(
    store.putEntities([raw]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError && error.code === "invalid_record",
  );
  assert.deepEqual((await store.exportTrace(source.id)).entities, []);
}

async function testNonEnumerableFactPredicateIsRejected(): Promise<void> {
  const { source, store } = await initializedGraph("hidden-predicate");
  const owner = entity(source, "owner");
  const target = entity(source, "target");
  await store.putEntities([owner, target]);
  const fact = relation(source, "fact-hidden-predicate", owner, target);
  Object.defineProperty(fact, "predicate", { enumerable: false });
  await assert.rejects(
    store.putFacts([fact]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError && error.code === "invalid_record",
  );
  assert.deepEqual((await store.exportTrace(source.id)).facts, []);
}

async function testNonEnumerableSourceFingerprintIsRejected(): Promise<void> {
  const { source, store } = await initializedGraph("hidden-source-fingerprint");
  const owner = entity(source, "owner");
  const target = entity(source, "target");
  await store.putEntities([owner, target]);
  const fact = relation(source, "fact-hidden-source-fingerprint", owner, target);
  Object.defineProperty(fact.source, "contentFingerprint", {
    enumerable: false,
  });
  await assert.rejects(
    store.putFacts([fact]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError && error.code === "invalid_record",
  );
  assert.deepEqual((await store.exportTrace(source.id)).facts, []);
}

async function testNonEnumerableObservedAtIsRejected(): Promise<void> {
  const { source, store } = await initializedGraph("hidden-observed-at");
  const owner = entity(source, "owner");
  const target = entity(source, "target");
  await store.putEntities([owner, target]);
  const fact = relation(source, "fact-hidden-observed-at", owner, target);
  Object.defineProperty(fact.provenance, "observedAt", { enumerable: false });
  await assert.rejects(
    store.putFacts([fact]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError && error.code === "invalid_record",
  );
  assert.deepEqual((await store.exportTrace(source.id)).facts, []);
}

async function testNonEnumerableOptionalOperationIdIsRejected(): Promise<void> {
  const { source, store } = await initializedGraph("hidden-operation-id");
  const owner = entity(source, "owner");
  const target = entity(source, "target");
  await store.putEntities([owner, target]);
  const fact = relation(source, "fact-hidden-operation-id", owner, target);
  fact.provenance.operationId = "operation-42" as typeof fact.provenance.operationId;
  Object.defineProperty(fact.provenance, "operationId", { enumerable: false });
  await assert.rejects(
    store.putFacts([fact]),
    (error: unknown) =>
      error instanceof KnowledgeGraphStoreError && error.code === "invalid_record",
  );
  assert.deepEqual((await store.exportTrace(source.id)).facts, []);
}

async function testStoredClonesPassFullDomainInvariants(): Promise<void> {
  const { source, store } = await initializedGraph("clone-domain-validation");
  const owner = entity(source, "owner");
  const target = entity(source, "target");
  const fact = relation(source, "fact-clone-domain-validation", owner, target);
  await store.putEntities([owner, target]);
  await store.putFacts([fact]);
  const trace = await store.exportTrace(source.id);
  for (const storedEntity of trace.entities) {
    assertRepositoryEntitySnapshotConsistency(storedEntity, source);
  }
  for (const storedFact of trace.facts) {
    assertFactSnapshotConsistency(storedFact, source);
    assertRepositoryEntitySnapshotConsistency(storedFact.subject, source);
    if (storedFact.kind === "relation") {
      assertRepositoryEntitySnapshotConsistency(storedFact.object, source);
    }
  }
}

async function testPostCloneEntityShapeIsRevalidated(): Promise<void> {
  const { source, store } = await initializedGraph("post-clone-entity-shape");
  const originalClone = globalThis.structuredClone;
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "structuredClone",
  );
  Object.defineProperty(globalThis, "structuredClone", {
    configurable: true,
    writable: true,
    value: ((value: unknown) => {
      const cloned = originalClone(value) as Record<string, unknown>;
      delete cloned.displayName;
      return cloned;
    }) as typeof structuredClone,
  });
  try {
    await assert.rejects(
      store.putEntities([entity(source, "owner")]),
      (error: unknown) =>
        error instanceof KnowledgeGraphStoreError && error.code === "invalid_record",
    );
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, "structuredClone", originalDescriptor);
    }
  }
  assert.deepEqual((await store.exportTrace(source.id)).entities, []);
}

async function testPostCloneFactShapeIsRevalidated(): Promise<void> {
  const { source, store } = await initializedGraph("post-clone-fact-shape");
  const owner = entity(source, "owner");
  const target = entity(source, "target");
  await store.putEntities([owner, target]);
  const fact = relation(source, "fact-post-clone-shape", owner, target);
  const originalClone = globalThis.structuredClone;
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "structuredClone",
  );
  Object.defineProperty(globalThis, "structuredClone", {
    configurable: true,
    writable: true,
    value: ((value: unknown) => {
      const cloned = originalClone(value) as FactRecord;
      delete (cloned.provenance as { observedAt?: string }).observedAt;
      return cloned;
    }) as typeof structuredClone,
  });
  try {
    await assert.rejects(
      store.putFacts([fact]),
      (error: unknown) =>
        error instanceof KnowledgeGraphStoreError && error.code === "invalid_record",
    );
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, "structuredClone", originalDescriptor);
    }
  }
  assert.deepEqual((await store.exportTrace(source.id)).facts, []);
}

async function main(): Promise<void> {
  await testBeginSnapshotCreatesContext();
  await testEntityInsertIsIdempotent();
  await testFactInsertIsIdempotent();
  await testConflictingEntityIsRejected();
  await testConflictingFactIsRejected();
  await testFactBeforeBeginSnapshotIsRejected();
  await testCrossSnapshotEntityIsRejected();
  await testCrossSnapshotFactIsRejected();
  await testUnknownSubjectIsRejected();
  await testUnknownRelationObjectIsRejected();
  await testFactQueryFilters();
  await testOutgoingNeighbors();
  await testIncomingNeighbors();
  await testNeighborOrderingIsDeterministic();
  await testDefensiveClonesProtectStore();
  await testSnapshotIsolation();
  await testFingerprintInvalidationIsScoped();
  await testInvalidatedFactsAreNotActiveByDefault();
  await testTraceDoesNotContainRawSource();
  await testDerivedFactWithoutParentsIsRejected();
  await testModelProposedFactIsRejected();
  await testStaleSourceFingerprintIsRejected();
  await testRepeatedExtractionDoesNotDuplicateGraph();
  await testMalformedFactEnumsAndProvenanceAreRejected();
  await testMalformedLiteralShapesAreRejected();
  await testMalformedSourceLocationsAreRejected();
  await testDerivedSelfParentIsRejected();
  await testDerivedBatchCycleIsRejected();
  await testDerivedCrossSnapshotParentIsRejected();
  await testDerivedInvalidatedParentIsRejected();
  await testDerivedAcyclicChainIsAccepted();
  await testSecretLikeEntityCannotLeakIntoTrace();
  await testStructuredTokenAttributeIsRejected();
  await testStructuredSecretTraversalHandlesCycles();
  await testStructuredSecretTraversalDoesNotInvokeGetters();
  await testSecretLikeObjectKeyIsRejected();
  await testStructuredPasswordJsonLiteralIsRejected();
  await testNestedStructuredSecretIsRejected();
  await testSecretLikeArrayValueIsRejected();
  await testSafeTechnicalNamesRemainAllowed();
  await testStructuredSecretDoesNotLeakIntoErrorsOrTrace();
  await testNumericCanonicalNameIsRejected();
  await testExtraEntityFieldIsRejected();
  await testExtraFactFieldIsRejected();
  await testExtraSourceSpanFieldIsRejected();
  await testExtraProvenanceFieldIsRejected();
  await testEmbeddedEntitySchemaIsValidated();
  await testNonCanonicalObservedAtIsRejected();
  await testImpossibleObservedAtIsRejected();
  await testCanonicalObservedAtAndOperationIdAreAccepted();
  await testInvalidOperationIdIsRejected();
  await testUnsafeExtraFieldValueDoesNotLeakIntoError();
  await testDerivedInvalidationCascadesToAllDescendants();
  await testEntityAllowedFieldGetterIsNotInvoked();
  await testNestedAttributeGetterIsNotInvoked();
  await testFactProvenanceGetterIsNotInvoked();
  await testSourceSpanGetterIsNotInvoked();
  await testThrowingSecretGetterIsSafelyRejected();
  await testSetterOnlyAccessorIsRejected();
  await testOrdinaryDataDescriptorPassesPreflight();
  await testEnumerableSymbolEntityFieldIsRejected();
  await testEnumerableSymbolFactFieldIsRejected();
  await testNonEnumerableExtraSourceFieldIsRejected();
  await testNonEnumerableExtraProvenanceFieldIsRejected();
  await testClassInstanceEntityIsRejected();
  await testClassInstanceFactIsRejected();
  await testNullPrototypeRecordsPassPreflight();
  await testCyclicRecordIsRejectedBeforeClone();
  await testCloneFailureIsWrappedSafely();
  await testSecretLikeEntityIdIsRejectedSafely();
  await testSecretLikeFactIdIsRejected();
  await testSecretLikePredicateIsRejected();
  await testSecretLikeExtractorIdIsRejected();
  await testSecretLikeExtractorVersionIsRejected();
  await testSecretLikeOperationIdIsRejected();
  await testSafePortableIdentifiersPass();
  await testNonEnumerableEntityDisplayNameIsRejected();
  await testNonEnumerableEntityIdIsRejected();
  await testNonEnumerableOptionalCanonicalNameIsRejected();
  await testNonEnumerableFactPredicateIsRejected();
  await testNonEnumerableSourceFingerprintIsRejected();
  await testNonEnumerableObservedAtIsRejected();
  await testNonEnumerableOptionalOperationIdIsRejected();
  await testStoredClonesPassFullDomainInvariants();
  await testPostCloneEntityShapeIsRevalidated();
  await testPostCloneFactShapeIsRevalidated();
  console.log("Context Engine v2 graph smoke passed: 86 scenarios.");
}

await main();
