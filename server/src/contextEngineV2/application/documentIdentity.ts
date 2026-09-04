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

export const DOCUMENT_IDENTITY_PREDICATE = "document_identity";

interface DocumentIdentityContext {
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

export function isExactExplicitDocumentationTarget(input: {
  context: DocumentIdentityContext;
  file: FileDescriptor;
}): boolean {
  const { context, file } = input;
  return file.kind === "documentation" &&
    file.readable &&
    !file.generated &&
    file.secretRisk === "none" &&
    context.explicitTargets.some((target) =>
      target.kind === "path" && normalizePath(target.path) === file.normalizedPath) &&
    taskNamesExactPath(context.normalizedTask, file.normalizedPath) &&
    !pathMatchesNegativeConstraints(file.normalizedPath, context.negativeConstraints);
}

function documentEntityId(snapshotId: string, fileId: string): RepositoryEntity["id"] {
  return deterministicApplicationId("entity", {
    snapshotId,
    fileId,
    basis: DOCUMENT_IDENTITY_PREDICATE,
  }) as RepositoryEntity["id"];
}

function documentFactId(input: {
  snapshotId: string;
  fileId: string;
  operationId: string;
  contentFingerprint: string;
}): FactRecord["id"] {
  return deterministicApplicationId("fact", {
    ...input,
    predicate: DOCUMENT_IDENTITY_PREDICATE,
  }) as FactRecord["id"];
}

export function createExactDocumentIdentity(input: {
  context: DocumentIdentityContext;
  file: FileDescriptor;
  source: SourceSpan;
  operation: InvestigationOperation;
  observedAt: string;
}): { entity: RepositoryEntity; fact: FactRecord } | null {
  const { context, file, source, operation } = input;
  if (
    !isExactExplicitDocumentationTarget({ context, file }) ||
    source.snapshotId !== file.snapshotId ||
    source.fileId !== file.id ||
    source.path !== file.normalizedPath ||
    source.contentFingerprint !== file.contentFingerprint
  ) {
    return null;
  }
  const entity: RepositoryEntity = {
    id: documentEntityId(file.snapshotId, file.id),
    snapshotId: file.snapshotId,
    kind: "file",
    displayName: file.normalizedPath,
    canonicalName: file.normalizedPath,
    fileId: file.id,
    attributes: {
      fileKind: "documentation",
      identityBasis: "snapshot_verified_read",
    },
  };
  const fact: FactRecord = {
    id: documentFactId({
      snapshotId: file.snapshotId,
      fileId: file.id,
      operationId: operation.id,
      contentFingerprint: file.contentFingerprint,
    }),
    snapshotId: file.snapshotId,
    kind: "fact",
    subject: entity,
    predicate: DOCUMENT_IDENTITY_PREDICATE,
    object: { type: "boolean", value: true },
    source,
    provenance: {
      extractorId: "ce2.document-identity",
      extractorVersion: "1",
      method: "deterministic_text",
      observedAt: input.observedAt,
      operationId: operation.id,
    },
    strength: "exact",
    status: "active",
    attributes: { identityBasis: "snapshot_verified_read" },
  };
  return { entity, fact };
}

export function isSnapshotBoundDocumentIdentityFact(input: {
  fact: FactRecord;
  snapshot: RepositorySnapshot;
}): boolean {
  const { fact, snapshot } = input;
  if (
    fact.kind !== "fact" ||
    fact.status !== "active" ||
    fact.snapshotId !== snapshot.id ||
    fact.predicate !== DOCUMENT_IDENTITY_PREDICATE ||
    fact.object.type !== "boolean" ||
    fact.object.value !== true ||
    fact.subject.kind !== "file" ||
    fact.subject.fileId === undefined ||
    fact.subject.id !== documentEntityId(snapshot.id, fact.subject.fileId) ||
    fact.source.kind !== "source_span" ||
    fact.provenance.extractorId !== "ce2.document-identity" ||
    fact.provenance.extractorVersion !== "1" ||
    fact.provenance.method !== "deterministic_text" ||
    fact.provenance.operationId === undefined ||
    fact.id !== documentFactId({
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
    file.kind === "documentation" &&
    file.readable &&
    !file.generated &&
    file.secretRisk === "none" &&
    fact.source.snapshotId === snapshot.id &&
    fact.source.fileId === file.id &&
    fact.source.path === file.normalizedPath &&
    fact.source.contentFingerprint === file.contentFingerprint,
  );
}

export function isExactDocumentIdentityFact(input: {
  fact: FactRecord;
  snapshot: RepositorySnapshot;
  context: DocumentIdentityContext;
}): boolean {
  const { fact, snapshot, context } = input;
  if (!isSnapshotBoundDocumentIdentityFact({ fact, snapshot }) || fact.subject.fileId === undefined) {
    return false;
  }
  const file = snapshot.files.find((candidate) => candidate.id === fact.subject.fileId);
  return Boolean(
    file &&
    isExactExplicitDocumentationTarget({ context, file }) &&
    fact.source.kind === "source_span" && fact.source.path === file.normalizedPath,
  );
}
