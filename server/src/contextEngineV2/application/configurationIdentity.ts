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

export const CONFIGURATION_IDENTITY_PREDICATE = "configuration_identity";

interface ConfigurationIdentityContext {
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

function isMachineManagedConfigurationPath(path: string): boolean {
  const name = normalizePath(path).split("/").at(-1)?.toLowerCase() ?? "";
  return /^(?:package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.ya?ml|yarn\.lock|bun\.lockb?|composer\.lock|cargo\.lock|poetry\.lock)$/u.test(name);
}

export function isExactExplicitConfigurationTarget(input: {
  context: ConfigurationIdentityContext;
  file: FileDescriptor;
}): boolean {
  const { context, file } = input;
  return file.kind === "configuration" &&
    file.readable &&
    !file.generated &&
    file.secretRisk === "none" &&
    !isMachineManagedConfigurationPath(file.normalizedPath) &&
    context.explicitTargets.some((target) =>
      target.kind === "path" && normalizePath(target.path) === file.normalizedPath) &&
    taskNamesExactPath(context.normalizedTask, file.normalizedPath) &&
    !pathMatchesNegativeConstraints(file.normalizedPath, context.negativeConstraints);
}

function configurationEntityId(snapshotId: string, fileId: string): RepositoryEntity["id"] {
  return deterministicApplicationId("entity", {
    snapshotId,
    fileId,
    basis: CONFIGURATION_IDENTITY_PREDICATE,
  }) as RepositoryEntity["id"];
}

function configurationFactId(input: {
  snapshotId: string;
  fileId: string;
  operationId: string;
  contentFingerprint: string;
}): FactRecord["id"] {
  return deterministicApplicationId("fact", {
    ...input,
    predicate: CONFIGURATION_IDENTITY_PREDICATE,
  }) as FactRecord["id"];
}

export function createExactConfigurationIdentity(input: {
  context: ConfigurationIdentityContext;
  file: FileDescriptor;
  source: SourceSpan;
  operation: InvestigationOperation;
  observedAt: string;
}): { entity: RepositoryEntity; fact: FactRecord } | null {
  const { context, file, source, operation } = input;
  if (
    !isExactExplicitConfigurationTarget({ context, file }) ||
    source.snapshotId !== file.snapshotId ||
    source.fileId !== file.id ||
    source.path !== file.normalizedPath ||
    source.contentFingerprint !== file.contentFingerprint
  ) {
    return null;
  }
  const entity: RepositoryEntity = {
    id: configurationEntityId(file.snapshotId, file.id),
    snapshotId: file.snapshotId,
    kind: "file",
    displayName: file.normalizedPath,
    canonicalName: file.normalizedPath,
    fileId: file.id,
    attributes: {
      fileKind: "configuration",
      identityBasis: "snapshot_verified_read",
    },
  };
  const fact: FactRecord = {
    id: configurationFactId({
      snapshotId: file.snapshotId,
      fileId: file.id,
      operationId: operation.id,
      contentFingerprint: file.contentFingerprint,
    }),
    snapshotId: file.snapshotId,
    kind: "fact",
    subject: entity,
    predicate: CONFIGURATION_IDENTITY_PREDICATE,
    object: { type: "boolean", value: true },
    source,
    provenance: {
      extractorId: "ce2.configuration-identity",
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

export function isSnapshotBoundConfigurationIdentityFact(input: {
  fact: FactRecord;
  snapshot: RepositorySnapshot;
}): boolean {
  const { fact, snapshot } = input;
  if (
    fact.kind !== "fact" ||
    fact.status !== "active" ||
    fact.snapshotId !== snapshot.id ||
    fact.predicate !== CONFIGURATION_IDENTITY_PREDICATE ||
    fact.object.type !== "boolean" ||
    fact.object.value !== true ||
    fact.subject.kind !== "file" ||
    fact.subject.fileId === undefined ||
    fact.subject.id !== configurationEntityId(snapshot.id, fact.subject.fileId) ||
    fact.source.kind !== "source_span" ||
    fact.provenance.extractorId !== "ce2.configuration-identity" ||
    fact.provenance.extractorVersion !== "1" ||
    fact.provenance.method !== "deterministic_text" ||
    fact.provenance.operationId === undefined ||
    fact.id !== configurationFactId({
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
    file.kind === "configuration" &&
    file.readable &&
    !file.generated &&
    file.secretRisk === "none" &&
    !isMachineManagedConfigurationPath(file.normalizedPath) &&
    fact.source.snapshotId === snapshot.id &&
    fact.source.fileId === file.id &&
    fact.source.path === file.normalizedPath &&
    fact.source.contentFingerprint === file.contentFingerprint,
  );
}

export function isExactConfigurationIdentityFact(input: {
  fact: FactRecord;
  snapshot: RepositorySnapshot;
  context: ConfigurationIdentityContext;
}): boolean {
  const { fact, snapshot, context } = input;
  if (!isSnapshotBoundConfigurationIdentityFact({ fact, snapshot }) || fact.subject.fileId === undefined) {
    return false;
  }
  const file = snapshot.files.find((candidate) => candidate.id === fact.subject.fileId);
  return Boolean(
    file &&
    isExactExplicitConfigurationTarget({ context, file }) &&
    fact.source.kind === "source_span" && fact.source.path === file.normalizedPath,
  );
}
