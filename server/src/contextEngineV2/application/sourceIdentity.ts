import type {
  ExplicitTargetConstraint,
  FactRecord,
  FileDescriptor,
  InvestigationOperation,
  NegativeConstraint,
  RepositoryEntity,
  RepositorySnapshot,
  SourceSpan,
} from "../contracts/index.js";
import { pathMatchesNegativeConstraints } from "./negativeConstraintMatcher.js";
import { deterministicApplicationId } from "./operationIdentity.js";

export const SOURCE_IDENTITY_PREDICATE = "source_identity";

interface SourceIdentityContext {
  normalizedTask: string;
  explicitTargets: readonly ExplicitTargetConstraint[];
  negativeConstraints: readonly NegativeConstraint[];
}

function normalizePath(value: string): string {
  return value.normalize("NFKC").replaceAll("\\", "/").replace(/^\.\//u, "").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function taskNamesExactPath(task: string, path: string): boolean {
  const normalizedTask = task.normalize("NFKC").replaceAll("\\", "/");
  const normalizedPath = normalizePath(path);
  if (!normalizedPath) return false;
  return new RegExp(
    `(?:^|[^\\p{L}\\p{N}_./-])${escapeRegExp(normalizedPath)}(?:$|[^\\p{L}\\p{N}_./-])`,
    "iu",
  ).test(normalizedTask);
}

export function isExactExplicitSourceTarget(input: {
  context: SourceIdentityContext;
  file: FileDescriptor;
}): boolean {
  const { context, file } = input;
  return file.kind === "source" &&
    file.readable &&
    !file.generated &&
    file.secretRisk === "none" &&
    context.explicitTargets.some((target) =>
      target.kind === "path" && normalizePath(target.path) === file.normalizedPath) &&
    taskNamesExactPath(context.normalizedTask, file.normalizedPath) &&
    !pathMatchesNegativeConstraints(file.normalizedPath, context.negativeConstraints);
}

function sourceEntityId(snapshotId: string, fileId: string): RepositoryEntity["id"] {
  return deterministicApplicationId("entity", {
    snapshotId,
    fileId,
    basis: SOURCE_IDENTITY_PREDICATE,
  }) as RepositoryEntity["id"];
}

function sourceFactId(input: {
  snapshotId: string;
  fileId: string;
  operationId: string;
  contentFingerprint: string;
}): FactRecord["id"] {
  return deterministicApplicationId("fact", {
    ...input,
    predicate: SOURCE_IDENTITY_PREDICATE,
  }) as FactRecord["id"];
}

export function createExactSourceIdentity(input: {
  context: SourceIdentityContext;
  file: FileDescriptor;
  source: SourceSpan;
  operation: InvestigationOperation;
  observedAt: string;
}): { entity: RepositoryEntity; fact: FactRecord } | null {
  const { context, file, source, operation } = input;
  if (
    operation.type !== "parse_file" ||
    !isExactExplicitSourceTarget({ context, file }) ||
    source.snapshotId !== file.snapshotId ||
    source.fileId !== file.id ||
    source.path !== file.normalizedPath ||
    source.contentFingerprint !== file.contentFingerprint
  ) {
    return null;
  }
  const entity: RepositoryEntity = {
    id: sourceEntityId(file.snapshotId, file.id),
    snapshotId: file.snapshotId,
    kind: "file",
    displayName: file.normalizedPath,
    canonicalName: file.normalizedPath,
    fileId: file.id,
    attributes: {
      fileKind: "source",
      identityBasis: "snapshot_verified_parse",
    },
  };
  const fact: FactRecord = {
    id: sourceFactId({
      snapshotId: file.snapshotId,
      fileId: file.id,
      operationId: operation.id,
      contentFingerprint: file.contentFingerprint,
    }),
    snapshotId: file.snapshotId,
    kind: "fact",
    subject: entity,
    predicate: SOURCE_IDENTITY_PREDICATE,
    object: { type: "boolean", value: true },
    source,
    provenance: {
      extractorId: "ce2.source-identity",
      extractorVersion: "1",
      method: "deterministic_text",
      observedAt: input.observedAt,
      operationId: operation.id,
    },
    strength: "exact",
    status: "active",
    attributes: { identityBasis: "snapshot_verified_parse" },
  };
  return { entity, fact };
}

export function isSnapshotBoundSourceIdentityFact(input: {
  fact: FactRecord;
  snapshot: RepositorySnapshot;
}): boolean {
  const { fact, snapshot } = input;
  if (
    fact.kind !== "fact" ||
    fact.status !== "active" ||
    fact.snapshotId !== snapshot.id ||
    fact.predicate !== SOURCE_IDENTITY_PREDICATE ||
    fact.object.type !== "boolean" ||
    fact.object.value !== true ||
    fact.subject.kind !== "file" ||
    fact.subject.fileId === undefined ||
    fact.subject.id !== sourceEntityId(snapshot.id, fact.subject.fileId) ||
    fact.subject.attributes?.fileKind !== "source" ||
    fact.subject.attributes?.identityBasis !== "snapshot_verified_parse" ||
    fact.attributes.identityBasis !== "snapshot_verified_parse" ||
    fact.source.kind !== "source_span" ||
    fact.provenance.extractorId !== "ce2.source-identity" ||
    fact.provenance.extractorVersion !== "1" ||
    fact.provenance.method !== "deterministic_text" ||
    fact.provenance.operationId === undefined ||
    fact.id !== sourceFactId({
      snapshotId: snapshot.id,
      fileId: fact.subject.fileId,
      operationId: fact.provenance.operationId,
      contentFingerprint: fact.source.contentFingerprint,
    })
  ) {
    return false;
  }
  const file = snapshot.files.find((candidate) => candidate.id === fact.subject.fileId);
  return Boolean(
    file &&
    file.kind === "source" &&
    file.readable &&
    !file.generated &&
    file.secretRisk === "none" &&
    fact.source.snapshotId === snapshot.id &&
    fact.source.fileId === file.id &&
    fact.source.path === file.normalizedPath &&
    fact.source.contentFingerprint === file.contentFingerprint,
  );
}

export function isExactSourceIdentityFact(input: {
  fact: FactRecord;
  snapshot: RepositorySnapshot;
  context: SourceIdentityContext;
}): boolean {
  const { fact, snapshot, context } = input;
  if (!isSnapshotBoundSourceIdentityFact({ fact, snapshot }) || fact.subject.fileId === undefined) {
    return false;
  }
  const file = snapshot.files.find((candidate) => candidate.id === fact.subject.fileId);
  return Boolean(
    file &&
    isExactExplicitSourceTarget({ context, file }) &&
    fact.source.kind === "source_span" && fact.source.path === file.normalizedPath,
  );
}
